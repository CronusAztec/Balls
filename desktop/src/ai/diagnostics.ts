import os from "os";
import type { AiCheck, AiCheckLevel, AiDiagnoseOptions, AiDiagnosis, AiLastError, CloudProvider, DesktopPrefs, ModelEntry } from "@/lib/desktop/contract";
import { describeError, errorCodes } from "@/lib/desktop/errors";
import type { LocalProbe, LocalRuntime, LocalStatus } from "./local";

/*
 * --- desktop-ai-fix --- The AI status panel's checks (IPC `ai:diagnose`). 1.0.2 could only say "doesn't work": the panel
 * now names each part the AI needs, green / amber / red with the reason, and builds a report the user can copy.
 *
 *  - Runtime: node-llama-cpp imports; the GPU types this PC supports (CUDA / Vulkan / CPU); the backend llama.cpp chose, the
 *    GPU it sees, its free VRAM and the RAM.
 *  - Model: the selected model, its file and checksum note – and, deep, that it loads with the real context size and answers
 *    an 8-token grammar-held test (tokens/s).
 *  - Provider: the cloud endpoint reached through Electron's net.fetch (the HTTP status, or the error code), a key stored,
 *    secure storage available.
 *  - Network: huggingface.co through net.fetch (Chromium: the system proxy and certificate store) and through Node's fetch –
 *    one working and the other failing on its certificate is an antivirus HTTPS scan or a proxy intercepting TLS.
 *  - Last error: the last failed request (its message, job and time).
 *
 * A quick run (the panel's first look) uses only what is known already; a deep one (Run checks) starts llama.cpp, loads the
 * model and goes online. The report never holds the API key: it is used only as the endpoint test's header and is
 * scrubbed from the report, whose log tail is scrubbed of anything key-like too.
 */

export interface DiagnosticsDeps {
  prefs: () => DesktopPrefs;
  cloud: () => { provider: CloudProvider; baseUrl: string; model: string };
  /** The stored API key – for the endpoint test's header only, never reported (null: none). */
  key: () => string | null;
  encryption: () => boolean;
  /** The selected local model's entry (null: not in the list any more). */
  modelEntry: (id: string) => Promise<ModelEntry | null>;
  runtime: (gpu: "auto" | "off", start: boolean) => Promise<LocalRuntime>;
  probe: (modelPath: string, gpu: "auto" | "off") => Promise<LocalProbe>;
  localStatus: () => LocalStatus;
  lastErrors: () => { local: AiLastError | null; cloud: AiLastError | null };
  /** Electron's net.fetch (Chromium's network stack) and Node's own fetch, each on its own (the Network row compares them). */
  netFetch: typeof fetch;
  nodeFetch: typeof fetch;
  /** What the app's requests go through (net.fetch with Node's fetch as the fallback) – the Provider row's test. */
  appFetch?: typeof fetch;
  /** App, Electron and OS facts for the report. */
  facts: () => Record<string, unknown>;
  /** Chromium's GPUs for the report. */
  gpu: () => Promise<unknown>;
  /** The last lines of main.log. */
  logTail: () => Promise<string[]>;
  now?: () => number;
  /** Each network test's time limit (ms). */
  timeoutMs?: number;
  /** Hides the user's home folder in paths that reach the report ("~"). */
  redact?: (text: string) => string;
  /** The PC's memory (default: the OS's). */
  ram?: () => { total: number; free: number };
}

/** The page the Network row reaches (where the models come from). */
export const NETWORK_TEST_URL = "https://huggingface.co/api/models/Qwen/Qwen2.5-1.5B-Instruct-GGUF";
const TLS_CODES = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_(?:GET|VERIFY)/;

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function check(id: AiCheck["id"], level: AiCheckLevel, code: string, params: Record<string, string | number> = {}, details: string[] = []): AiCheck {
  return { id, level, code, params, details };
}

/** One GET through `fetchImpl`: its HTTP status and time, or the error with its codes. */
export async function probeUrl(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, timeoutMs = 10000, now: () => number = Date.now): Promise<{ ok: boolean; status: number | null; ms: number; error: string | null; codes: string[] }> {
  const t0 = now();
  try {
    const response = await fetchImpl(url, { method: "GET", redirect: "follow", ...init, signal: AbortSignal.timeout(timeoutMs) });
    await response.body?.cancel().catch(() => {});
    return { ok: true, status: response.status, ms: now() - t0, error: null, codes: [] };
  } catch (err) {
    return { ok: false, status: null, ms: now() - t0, error: describeError(err), codes: errorCodes(err) };
  }
}

/** Anything key-like in a text (the stored key itself, sk-…, Bearer …, x-api-key …) replaced. */
export function scrubSecrets(text: string, key: string | null): string {
  let out = key && key.length >= 6 ? text.split(key).join("[key removed]") : text;
  out = out
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[key removed]")
    .replace(/(bearer\s+)(?!\[key removed\])[^\s"']+/gi, "$1[key removed]")
    .replace(/(x-api-key["']?\s*[:=]\s*["']?)(?!\[key removed\])[^\s"',}]+/gi, "$1[key removed]");
  return out;
}

async function runtimeCheck(deps: DiagnosticsDeps, gpu: "auto" | "off", deep: boolean): Promise<{ check: AiCheck; runtime: LocalRuntime }> {
  const rt = await deps.runtime(gpu, deep);
  const details = [
    `node-llama-cpp: ${rt.imported ? "loads" : `does not load – ${rt.error ?? "?"}`}`,
    `GPU types this PC supports: ${rt.supported?.join(", ") ?? "not checked"}`,
    `run the model on: ${gpu === "off" ? "CPU only" : "auto (GPU when one works)"}`,
  ];
  if (rt.backend) details.push(`backend: ${rt.backend}`);
  if (rt.devices.length) details.push(`GPU: ${rt.devices.join(", ")}`);
  if (rt.vram && rt.backend && rt.backend !== "cpu") details.push(`VRAM: ${gb(rt.vram.free)} free of ${gb(rt.vram.total)}`);
  if (rt.cpuCores) details.push(`CPU math cores: ${rt.cpuCores}`);
  const ram = (deps.ram ?? (() => ({ total: os.totalmem(), free: os.freemem() })))();
  details.push(`RAM: ${gb(ram.free)} free of ${gb(ram.total)}`);
  if (!rt.imported) return { runtime: rt, check: check("runtime", "fail", "runtimeMissing", { error: rt.error ?? "?" }, details) };
  if (rt.error) return { runtime: rt, check: check("runtime", "fail", "runtimeFailed", { error: rt.error }, details) };
  if (!rt.backend) return { runtime: rt, check: check("runtime", "skip", "runtimeNotStarted", { supported: rt.supported?.join(", ") ?? "?" }, details) };
  if (rt.backend === "cpu") {
    return gpu === "off"
      ? { runtime: rt, check: check("runtime", "ok", "runtimeCpuChosen", { cores: rt.cpuCores ?? "?" }, details) }
      : { runtime: rt, check: check("runtime", "warn", "runtimeCpuFallback", { supported: rt.supported?.join(", ") ?? "?" }, details) };
  }
  return { runtime: rt, check: check("runtime", "ok", "runtimeGpu", { backend: rt.backend, device: rt.devices[0] ?? "GPU", vram: rt.vram ? gb(rt.vram.free) : "?" }, details) };
}

async function modelCheck(deps: DiagnosticsDeps, prefs: DesktopPrefs, deep: boolean): Promise<{ check: AiCheck; entry: ModelEntry | null; probe: LocalProbe | null }> {
  const id = prefs.localModel;
  const entry = await deps.modelEntry(id);
  const local = prefs.aiProvider === "local";
  if (!entry) return { entry, probe: null, check: check("model", local ? "fail" : "skip", "modelUnknown", { id }, [`selected: ${id}`]) };
  const details = [`selected: ${entry.name} (${id})`, `file: ${entry.path ? (deps.redact ?? String)(entry.path) : "not on this PC"}${entry.state === "ready" ? ` – ${gb(entry.size)}` : ""}`];
  details.push(entry.custom ? "checksum: your own file (not checked)" : entry.state === "ready" ? `checksum: SHA-256 verified (${(entry.sha256 ?? "").slice(0, 12)}…)` : `state: ${entry.state}`);
  if (entry.state === "missing") return { entry, probe: null, check: check("model", local ? "fail" : "skip", "modelMissing", { name: entry.name }, details) };
  if (entry.state === "partial") return { entry, probe: null, check: check("model", local ? "warn" : "skip", "modelPartial", { name: entry.name, percent: Math.floor((entry.downloaded / Math.max(1, entry.size)) * 100) }, details) };
  if (entry.state === "downloading" || entry.state === "verifying") return { entry, probe: null, check: check("model", "warn", "modelDownloading", { name: entry.name }, details) };
  if (entry.state === "corrupt") return { entry, probe: null, check: check("model", "fail", "modelCorrupt", { name: entry.name }, details) };
  const status = deps.localStatus();
  if (!deep || !entry.path) {
    if (status.loaded) details.push(`loaded: ${status.backend}, ${status.gpuLayers ?? 0} GPU layers, context ${status.contextSize ?? "?"} tokens`);
    return { entry, probe: null, check: check("model", "ok", status.loaded ? "modelLoaded" : "modelReady", { name: entry.name, context: status.contextSize ?? "?" }, details) };
  }
  const probe = await deps.probe(entry.path, prefs.aiGpu);
  if (!probe.ok) {
    details.push(`load: failed after ${probe.loadMs} ms`);
    return { entry, probe, check: check("model", "fail", "modelLoadFailed", { name: entry.name, error: probe.error ?? "?" }, [...details, probe.error ?? ""]) };
  }
  details.push(`loads in ${probe.loadMs} ms on ${probe.backend}, ${probe.gpuLayers ?? 0} GPU layers, context ${probe.contextSize ?? "?"} tokens`);
  details.push(`grammar test: ${probe.tokens} tokens in ${probe.replyMs} ms, the first after ${probe.firstTokenMs ?? "?"} ms (then ${probe.tokensPerSec ?? "?"} tokens/s): ${probe.reply}`);
  const slow = probe.tokensPerSec !== null && probe.tokensPerSec < 2;
  return { entry, probe, check: check("model", slow ? "warn" : "ok", slow ? "modelSlow" : "modelTested", { name: entry.name, tps: probe.tokensPerSec ?? "?", context: probe.contextSize ?? "?", layers: probe.gpuLayers ?? 0 }, details) };
}

async function providerCheck(deps: DiagnosticsDeps, prefs: DesktopPrefs, deep: boolean): Promise<AiCheck> {
  const cloud = deps.cloud();
  const key = deps.key();
  const keyless = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(cloud.baseUrl);
  const inUse = prefs.aiProvider === "cloud";
  const encryption = deps.encryption();
  const details = [`provider: ${cloud.provider === "anthropic" ? "Anthropic" : "OpenAI-compatible"}`, `endpoint: ${cloud.baseUrl}`, `model: ${cloud.model}`, `key stored: ${key ? "yes" : keyless ? "not needed (localhost)" : "no"}`, `secure key storage: ${encryption ? "available" : "not available"}`, `answers now: ${inUse ? "the cloud provider" : "the local model"}`];
  if (!key && !keyless) {
    if (!encryption) return check("provider", inUse ? "fail" : "skip", "providerNoEncryption", {}, details);
    return check("provider", inUse ? "fail" : "skip", inUse ? "providerNoKey" : "providerNotSetUp", {}, details);
  }
  if (!deep) return check("provider", "skip", "providerNotTested", { provider: cloud.provider }, details);
  const base = cloud.baseUrl.replace(/\/+$/, "");
  const url = cloud.provider === "anthropic" ? `${base}/v1/models` : `${base}/models`;
  const headers: Record<string, string> = cloud.provider === "anthropic" ? { "anthropic-version": "2023-06-01", ...(key ? { "x-api-key": key } : {}) } : key ? { authorization: `Bearer ${key}` } : {};
  const r = await probeUrl(deps.appFetch ?? deps.netFetch, url, { headers }, deps.timeoutMs, deps.now);
  details.push(`GET ${url.replace(base, "")} through the app's connection (net.fetch, Node's fetch as the fallback): ${r.ok ? `HTTP ${r.status}` : `failed – ${r.error}`} in ${r.ms} ms`);
  if (!r.ok) return check("provider", inUse ? "fail" : "warn", "providerUnreachable", { error: r.error ?? "?" }, details);
  if (r.status === 401 || r.status === 403) return check("provider", inUse ? "fail" : "warn", "providerKeyRejected", { status: r.status ?? 0 }, details);
  if (r.status !== null && r.status >= 200 && r.status < 300) return check("provider", "ok", "providerOk", { status: r.status, ms: r.ms }, details);
  return check("provider", "warn", "providerHttp", { status: r.status ?? 0 }, details);
}

async function networkCheck(deps: DiagnosticsDeps, deep: boolean): Promise<AiCheck> {
  if (!deep) return check("network", "skip", "networkNotTested", {}, []);
  const [viaNet, viaNode] = await Promise.all([probeUrl(deps.netFetch, NETWORK_TEST_URL, {}, deps.timeoutMs, deps.now), probeUrl(deps.nodeFetch, NETWORK_TEST_URL, {}, deps.timeoutMs, deps.now)]);
  const details = [
    `huggingface.co through net.fetch (the system's proxy and certificates): ${viaNet.ok ? `HTTP ${viaNet.status}` : `failed – ${viaNet.error}`} in ${viaNet.ms} ms`,
    `huggingface.co through Node's fetch: ${viaNode.ok ? `HTTP ${viaNode.status}` : `failed – ${viaNode.error}`} in ${viaNode.ms} ms`,
  ];
  // net.fetch gets nowhere but Node's fetch does: the app's requests take the fallback, so downloads still work.
  if (!viaNet.ok && viaNode.ok) return check("network", "warn", "networkFallback", { error: viaNet.error ?? "?" }, details);
  if (!viaNet.ok) return check("network", "fail", "networkBlocked", { error: viaNet.error ?? "?" }, details);
  if (!viaNode.ok && viaNode.codes.some((c) => TLS_CODES.test(c))) return check("network", "warn", "networkIntercepted", { code: viaNode.codes.find((c) => TLS_CODES.test(c)) ?? "TLS" }, details);
  return check("network", "ok", "networkOk", { ms: viaNet.ms }, details);
}

function lastErrorCheck(deps: DiagnosticsDeps): AiCheck {
  const { local, cloud } = deps.lastErrors();
  const all = [local, cloud].filter((e): e is AiLastError => !!e).sort((a, b) => b.at.localeCompare(a.at));
  if (all.length === 0) return check("lastError", "ok", "lastErrorNone", {}, []);
  const last = all[0];
  return check(
    "lastError",
    "warn",
    "lastErrorSome",
    { message: last.message, task: last.task ?? "–", at: last.at, provider: last.provider },
    all.map((e) => `${e.at} ${e.task ?? "–"} on ${e.provider} ${e.model}: ${e.message}`),
  );
}

/** The panel's rows and the copyable report. */
export async function runAiDiagnostics(deps: DiagnosticsDeps, options: AiDiagnoseOptions = {}): Promise<AiDiagnosis> {
  const deep = options.deep === true;
  const prefs = deps.prefs();
  // Online checks in parallel with the local ones (which share llama.cpp's queue).
  const [local, provider, network] = await Promise.all([
    (async () => {
      const rt = await runtimeCheck(deps, prefs.aiGpu, deep);
      const model = rt.runtime.imported && !rt.runtime.error ? await modelCheck(deps, prefs, deep) : { check: check("model", "skip", "modelNotTested", {}, []), entry: null, probe: null };
      return { rt, model };
    })(),
    providerCheck(deps, prefs, deep),
    networkCheck(deps, deep),
  ]);
  const checks = [local.rt.check, local.model.check, provider, network, lastErrorCheck(deps)];
  const cloud = deps.cloud();
  const at = new Date(deps.now?.() ?? Date.now()).toISOString();
  const tail = await deps.logTail().catch(() => [] as string[]);
  const key = deps.key();
  const report: Record<string, unknown> = {
    report: "JumpingBallsLive AI status",
    generatedAt: at,
    deep,
    ...deps.facts(),
    gpu: await deps.gpu().catch((err: unknown) => describeError(err)),
    ai: {
      answers: prefs.aiProvider,
      localModel: prefs.localModel,
      runModelOn: prefs.aiGpu === "off" ? "cpu only" : "auto",
      local: { ...deps.localStatus(), model: deps.localStatus().model ? (deps.redact ?? String)(deps.localStatus().model as string) : null },
      runtime: local.rt.runtime,
      model: local.model.entry ? { id: local.model.entry.id, name: local.model.entry.name, state: local.model.entry.state, size: local.model.entry.size, custom: local.model.entry.custom, path: local.model.entry.path ? (deps.redact ?? String)(local.model.entry.path) : null } : null,
      modelTest: local.model.probe,
    },
    cloud: { provider: cloud.provider, baseUrl: cloud.baseUrl, model: cloud.model, keyStored: !!key, secureStorage: deps.encryption() },
    checks: checks.map((c) => ({ id: c.id, level: c.level, code: c.code, params: c.params, details: c.details })),
    lastErrors: deps.lastErrors(),
    logTail: tail,
  };
  // The key never leaves: scrubbed from every string of the report (its own text and the log's).
  const scrubbed = JSON.parse(scrubSecrets(JSON.stringify(report), key)) as Record<string, unknown>;
  return { at, deep, checks: checks.map((c) => ({ ...c, details: c.details.map((d) => scrubSecrets(d, key)) })), report: scrubbed };
}
