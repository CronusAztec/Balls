import type { AiChatRequest, AiChatResult, AiLastError, AiStatus, CloudConfigInput, CloudProvider, DesktopPrefs } from "@/lib/desktop/contract";
import { describeError, errorChain } from "@/lib/desktop/errors"; // --- desktop-ai-fix ---
import { CLOUD_DEFAULTS, anthropicClient, completeAnthropic, completeOpenAi, type AnthropicLike } from "./cloud";
import type { LocalModelRunner } from "./local";
import type { SecretBox } from "./secrets";

/*
 * --- desktop-exe --- Routes the page's AI requests: the local model (the selected GGUF through node-llama-cpp) or the cloud
 * provider the user configured, streaming tokens back as `ai:token` events, one AbortController per request so the
 * panel's Stop cancels it.
 *
 * --- desktop-ai-fix --- Every request is logged (job, provider, model, size; the reply's time to the first token and in all)
 * and every failure with its cause chain and stack – 1.0.2 wrote nothing, so a failure left no trace. The last failure of
 * each path (local / cloud) is kept and returned by `status()` for the AI status panel; the message the page gets carries
 * the explained cause codes. `ensureSelectedModel()` selects a ready model when the selected one is not downloaded (after
 * a download finishes, and at start for a 1.0.2 install whose download was never "used").
 */

export interface CloudSettings {
  provider: CloudProvider;
  baseUrl: string;
  model: string;
  /** The API key sealed by SecretBox (base64), "" when none. */
  keySealed: string;
}

export const DEFAULT_CLOUD: CloudSettings = { provider: "anthropic", baseUrl: CLOUD_DEFAULTS.anthropic.baseUrl, model: CLOUD_DEFAULTS.anthropic.model, keySealed: "" };

export interface AiServiceDeps {
  prefs: () => DesktopPrefs;
  setPrefs: (patch: Partial<DesktopPrefs>) => void;
  cloud: () => CloudSettings;
  setCloud: (cloud: CloudSettings) => void;
  secrets: SecretBox;
  local: LocalModelRunner;
  /** The file of the selected local model when it is ready. */
  modelPath: (id: string) => Promise<string | null>;
  emitToken: (requestId: string, text: string) => void;
  /** The cloud's fetch (--- desktop-ai-fix --- main.ts: Electron's net.fetch). */
  fetch?: typeof fetch;
  anthropic?: (apiKey: string, baseUrl: string) => AnthropicLike;
  /** --- desktop-ai-fix --- main.log. */
  log?: (level: "info" | "warn" | "error", message: string) => void;
  /** --- desktop-ai-fix --- The ids of the local models that are ready to load, in the catalog's order. */
  readyModels?: () => Promise<string[]>;
  now?: () => number;
}

export class AiService {
  private readonly running = new Map<string, AbortController>();
  /** --- desktop-ai-fix --- The last failed request of each path. */
  private readonly lastErrors: { local: AiLastError | null; cloud: AiLastError | null } = { local: null, cloud: null };

  constructor(private readonly deps: AiServiceDeps) {}

  private log(level: "info" | "warn" | "error", message: string): void {
    this.deps.log?.(level, message);
  }

  /** --- desktop-ai-fix --- The last failure of each path (a copy). */
  lastFailures(): { local: AiLastError | null; cloud: AiLastError | null } {
    return { local: this.lastErrors.local, cloud: this.lastErrors.cloud };
  }

  /**
   * --- desktop-ai-fix --- The selected local model if it is ready; otherwise `preferred` (a download that just finished) or
   * the first ready model is selected – 1.0.2 left Run disabled after downloading any model but the preselected one.
   */
  async ensureSelectedModel(preferred?: string): Promise<string | null> {
    const prefs = this.deps.prefs();
    if (await this.deps.modelPath(prefs.localModel)) return prefs.localModel;
    const ready = (await this.deps.readyModels?.()) ?? [];
    const pick = preferred && ready.includes(preferred) ? preferred : ready[0];
    if (!pick) return null;
    this.deps.setPrefs({ localModel: pick });
    await this.deps.local.unload();
    this.log("info", `selected the local model ${pick}: the selected ${prefs.localModel} is not downloaded`);
    return pick;
  }

  async status(): Promise<AiStatus> {
    const prefs = this.deps.prefs();
    const cloud = this.deps.cloud();
    const hasKey = this.deps.secrets.open(cloud.keySealed) !== null;
    const path = await this.deps.modelPath(prefs.localModel);
    const local = this.deps.local.status();
    // A local server (Ollama, LM Studio) on localhost needs no key.
    const keyless = /^http:\/\/(localhost|127\.0\.0\.1)/.test(cloud.baseUrl);
    return {
      provider: prefs.aiProvider,
      ready: prefs.aiProvider === "cloud" ? hasKey || keyless : path !== null,
      local: { model: prefs.localModel, loaded: local.loaded, backend: local.backend, gpuLayers: local.gpuLayers, error: local.error, contextSize: local.contextSize ?? null, gpuDevice: local.gpuDevice ?? null }, // --- desktop-ai-fix --- (context, GPU)
      cloud: { provider: cloud.provider, baseUrl: cloud.baseUrl, model: cloud.model, hasKey, encryption: this.deps.secrets.available },
      lastError: this.lastFailures(), // --- desktop-ai-fix ---
    };
  }

  async setCloud(input: CloudConfigInput): Promise<AiStatus> {
    const current = this.deps.cloud();
    const next: CloudSettings = { provider: input.provider, baseUrl: input.baseUrl.trim(), model: input.model.trim(), keySealed: current.keySealed };
    if (input.apiKey !== undefined && input.apiKey.trim()) next.keySealed = this.deps.secrets.seal(input.apiKey.trim());
    this.deps.setCloud(next);
    this.deps.setPrefs({ aiProvider: input.use ? "cloud" : "local" });
    return this.status();
  }

  async clearCloudKey(): Promise<AiStatus> {
    this.deps.setCloud({ ...this.deps.cloud(), keySealed: "" });
    if (this.deps.prefs().aiProvider === "cloud") this.deps.setPrefs({ aiProvider: "local" });
    return this.status();
  }

  cancel(requestId: string): void {
    this.running.get(requestId)?.abort();
  }

  cancelAll(): void {
    for (const c of this.running.values()) c.abort();
  }

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    if (this.running.has(request.requestId)) throw new Error("duplicate request id");
    const controller = new AbortController();
    this.running.set(request.requestId, controller);
    // --- desktop-ai-fix --- timings and a log line per request
    const now = this.deps.now ?? Date.now;
    const t0 = now();
    let firstTokenMs: number | null = null;
    const onToken = (text: string) => {
      if (firstTokenMs === null) firstTokenMs = now() - t0;
      this.deps.emitToken(request.requestId, text);
    };
    const prefs = this.deps.prefs();
    const cloudNow = prefs.aiProvider === "cloud" ? this.deps.cloud() : null;
    const providerName = cloudNow ? cloudNow.provider : "local";
    const modelName = cloudNow ? cloudNow.model : prefs.localModel;
    const task = typeof request.task === "string" ? request.task : null;
    const chars = request.messages.reduce((n, m) => n + m.content.length, 0);
    this.log("info", `ai request ${request.requestId}: ${task ?? "–"} on ${providerName} ${modelName}${cloudNow ? "" : ` (${prefs.aiGpu === "off" ? "cpu only" : "gpu auto"})`}, ${request.messages.length} messages, ${chars} characters`);
    try {
      const done = (result: AiChatResult): AiChatResult => {
        this.log("info", `ai reply ${request.requestId}: ${result.text.length} characters in ${now() - t0} ms (first token after ${firstTokenMs ?? "–"} ms)${result.cancelled ? ", stopped" : ""}`);
        return result;
      };
      if (prefs.aiProvider === "cloud") {
        const cloud = this.deps.cloud();
        const key = this.deps.secrets.open(cloud.keySealed) ?? "";
        const common = { messages: request.messages, maxTokens: request.maxTokens, temperature: request.temperature, signal: controller.signal, onToken };
        let text: string;
        if (cloud.provider === "anthropic") {
          if (!key) throw new Error("No API key stored for the cloud provider");
          text = await completeAnthropic((this.deps.anthropic ?? anthropicClient)(key, cloud.baseUrl), cloud.model, common);
        } else {
          text = await completeOpenAi(this.deps.fetch ?? fetch, cloud.baseUrl, key, cloud.model, common);
        }
        return done({ text, provider: "cloud", model: cloud.model, cancelled: controller.signal.aborted });
      }
      const path = await this.deps.modelPath(prefs.localModel);
      if (!path) throw new Error("No local model yet: download one in the AI panel (or pick a GGUF file)");
      const reply = await this.deps.local.complete(path, prefs.aiGpu, request.messages, { schema: request.schema as never, maxTokens: request.maxTokens, temperature: request.temperature, signal: controller.signal, onToken });
      return done({ text: reply.text, provider: "local", model: prefs.localModel, cancelled: reply.cancelled });
    } catch (err) {
      if (controller.signal.aborted) {
        this.log("info", `ai request ${request.requestId} stopped after ${now() - t0} ms`);
        return { text: "", provider: prefs.aiProvider, model: "", cancelled: true };
      }
      // --- desktop-ai-fix --- kept for the status panel, logged with its cause chain, and the page gets the codes explained
      const message = describeError(err);
      this.lastErrors[prefs.aiProvider === "cloud" ? "cloud" : "local"] = { message, at: new Date().toISOString(), task, provider: providerName, model: modelName };
      this.log("error", `ai request ${request.requestId} failed after ${now() - t0} ms (${task ?? "–"} on ${providerName} ${modelName}): ${errorChain(err)}`);
      throw new Error(message, { cause: err });
    } finally {
      this.running.delete(request.requestId);
    }
  }
}
