import type { AiChatRequest, AiChatResult, AiStatus, CloudConfigInput, CloudProvider, DesktopPrefs } from "@/lib/desktop/contract";
import { CLOUD_DEFAULTS, anthropicClient, completeAnthropic, completeOpenAi, type AnthropicLike } from "./cloud";
import type { LocalModelRunner } from "./local";
import type { SecretBox } from "./secrets";

/*
 * --- desktop-exe --- Routes the page's AI requests: the local model (the selected GGUF through node-llama-cpp) or the cloud
 * provider the user configured, streaming tokens back as `ai:token` events, one AbortController per request so the
 * panel's Stop cancels it.
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
  fetch?: typeof fetch;
  anthropic?: (apiKey: string, baseUrl: string) => AnthropicLike;
}

export class AiService {
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly deps: AiServiceDeps) {}

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
      local: { model: prefs.localModel, loaded: local.loaded, backend: local.backend, gpuLayers: local.gpuLayers, error: local.error },
      cloud: { provider: cloud.provider, baseUrl: cloud.baseUrl, model: cloud.model, hasKey, encryption: this.deps.secrets.available },
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
    const onToken = (text: string) => this.deps.emitToken(request.requestId, text);
    const prefs = this.deps.prefs();
    try {
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
        return { text, provider: "cloud", model: cloud.model, cancelled: controller.signal.aborted };
      }
      const path = await this.deps.modelPath(prefs.localModel);
      if (!path) throw new Error("No local model yet: download one in the AI panel (or pick a GGUF file)");
      const reply = await this.deps.local.complete(path, prefs.aiGpu, request.messages, { schema: request.schema as never, maxTokens: request.maxTokens, temperature: request.temperature, signal: controller.signal, onToken });
      return { text: reply.text, provider: "local", model: prefs.localModel, cancelled: reply.cancelled };
    } catch (err) {
      if (controller.signal.aborted) return { text: "", provider: prefs.aiProvider, model: "", cancelled: true };
      throw err;
    } finally {
      this.running.delete(request.requestId);
    }
  }
}
