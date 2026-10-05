import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "crypto";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import type { AiMessage, DesktopPrefs, ModelEntry } from "@/lib/desktop/contract";
import { IPC, type IpcChannel } from "@/lib/desktop/contract";
import { CONTEXT_MARGIN, LOCAL_CONTEXT_MIN, LOCAL_CONTEXT_SIZE, LocalModelRunner, NOT_ENOUGH_MEMORY, contextSizeFor, isInsufficientMemory, toChatHistory, type LlamaModuleLike } from "../src/ai/local";
import { AiService, DEFAULT_CLOUD, type CloudSettings } from "../src/ai/service";
import { anthropicClient, completeAnthropic, completeOpenAi, openAiBody, splitSystem } from "../src/ai/cloud";
import { SecretBox, type SafeStorageLike } from "../src/ai/secrets";
import { DEFAULT_PREFS } from "../src/prefs";
import { ModelManager } from "../src/models/manager";
import type { ModelSpec } from "../src/models/catalog";
import { createModelServices } from "../src/ai/modelServices"; // --- review fix (desktop-ai-fix) ---
import { networkDeps, withFallback } from "../src/net";
import { NETWORK_TEST_URL, runAiDiagnostics, scrubSecrets, type DiagnosticsDeps } from "../src/ai/diagnostics";
import { describeHandlerFailure, registerHandlers, type HandlerTable } from "../src/handlers";
import { mirrorConsole, stripAnsi } from "../src/consoleMirror";

/* --- desktop-ai-fix --- the Windows app's AI fixes in the main process: the context floor and the memory fallback, one chat
   session per loaded model, unload behind the busy chain, llama.cpp's logger, net.fetch for every request, the explained
   cause codes, the last error in ai:status, the model auto-select, the diagnose handler, the logged IPC failures, the
   console mirror and the unsigned-update packaging rule */

const SECRET = "sk-ant-api03-SUPERSECRETKEY1234567890";

class FakeInsufficientMemoryError extends Error {}

interface FakeOptions {
  /** Throw InsufficientMemoryError from createContext for these GPU layer counts (or for every count when true). */
  contextFails?: (layers: number, gpu: "auto" | false) => boolean;
  /** The context size llama.cpp grants: the request's max (a roomy PC) or its min (a PC short of memory). */
  grant?: "max" | "min";
  replies?: string[];
  /** Holds every prompt until released (unload must wait for it). */
  gate?: Promise<void>;
  /** Streams each reply: its first two characters after `firstMs`, the rest `restMs` later (default: all at once). */
  stream?: { firstMs: number; restMs: number };
}

function fakeLlamaModule(options: FakeOptions = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const histories: unknown[] = [];
  const prompts: { text: string; temperature?: number; maxTokens?: number }[] = [];
  const counts = { sequences: 0, sessions: 0, getLlama: 0 };
  const replies = options.replies ?? [];
  let disposed = false;
  const llama = (gpu: "auto" | false) => ({
    gpu: gpu === false ? (false as const) : ("vulkan" as const),
    cpuMathCores: 4,
    getGpuDeviceNames: async () => (gpu === false ? [] : ["AMD Radeon RX 6600"]),
    getVramState: async () => ({ total: 8 * 1024 ** 3, used: 1024 ** 3, free: 7 * 1024 ** 3 }),
    loadModel: async ({ gpuLayers }: { modelPath: string; gpuLayers?: "auto" | number }) => {
      const layers = gpuLayers === "auto" || gpuLayers === undefined ? 29 : gpuLayers;
      calls.push(`loadModel ${gpu === false ? "cpu" : "auto"} ${String(gpuLayers)}`);
      return {
        gpuLayers: layers,
        tokenize: (text: string) => Array.from({ length: Math.ceil(text.length / 4) }),
        createContext: async ({ contextSize }: { contextSize?: number | { min?: number; max?: number } }) => {
          const size = contextSize as { min: number; max: number };
          calls.push(`createContext ${size.min}-${size.max} (${layers} layers)`);
          if (options.contextFails?.(layers, gpu)) throw new FakeInsufficientMemoryError(`A context size of ${size.min} is too large for the available VRAM`);
          disposed = false;
          return {
            contextSize: options.grant === "min" ? size.min : size.max,
            getSequence: () => (counts.sequences++, {}),
            dispose: async () => {
              disposed = true;
              calls.push("context.dispose");
            },
          };
        },
        dispose: async () => void calls.push("model.dispose"),
      };
    },
    createGrammarForJsonSchema: async () => ({}),
    getGrammarFor: async () => ({}),
    dispose: async () => void calls.push("llama.dispose"),
  });
  class Session {
    constructor() {
      counts.sessions++;
    }
    setChatHistory(history: unknown) {
      histories.push(history);
    }
    async prompt(text: string, o: { temperature?: number; maxTokens?: number; onTextChunk?: (t: string) => void }) {
      if (disposed) throw new Error("Object is disposed");
      prompts.push({ text, temperature: o.temperature, maxTokens: o.maxTokens });
      await options.gate;
      if (disposed) throw new Error("Object is disposed");
      const reply = replies.shift() ?? '{"ok":true}';
      if (options.stream) {
        await new Promise((r) => setTimeout(r, options.stream?.firstMs));
        o.onTextChunk?.(reply.slice(0, 2));
        await new Promise((r) => setTimeout(r, options.stream?.restMs));
        o.onTextChunk?.(reply.slice(2));
      } else o.onTextChunk?.(reply);
      return reply;
    }
    dispose() {}
  }
  const mod: LlamaModuleLike = {
    getLlama: async (o) => {
      counts.getLlama++;
      calls.push(`getLlama ${o.gpu === false ? "cpu" : "auto"}${o.logger ? " +logger" : ""}`);
      o.logger?.("warn", "ggml_vulkan: Found 1 Vulkan devices");
      o.logger?.("warn", "ggml_vulkan: Found 1 Vulkan devices"); // repeated: logged once
      return llama(o.gpu);
    },
    LlamaChatSession: Session as unknown as LlamaModuleLike["LlamaChatSession"],
    InsufficientMemoryError: FakeInsufficientMemoryError as never,
    getLlamaGpuTypes: async () => ["vulkan", false],
  };
  const runner = new LocalModelRunner(async () => mod, (m) => logs.push(m));
  return { runner, calls, logs, histories, prompts, counts };
}

const conversation = (n = 1): AiMessage[] => [
  { role: "system", content: "rules ".repeat(200) },
  { role: "user", content: "go" },
  ...Array.from({ length: n - 1 }, (_, i): AiMessage[] => [
    { role: "assistant", content: `{"action":"tool","tool":"t","args":{"i":${i}}}` },
    { role: "user", content: `Result of t: ${"x".repeat(50)}` },
  ]).flat(),
];

describe("the local runner", () => {
  it("floors the context: at least 4,096 tokens and room for the prompt and the reply", () => {
    expect(contextSizeFor(300, 1200)).toEqual({ min: LOCAL_CONTEXT_MIN, max: LOCAL_CONTEXT_SIZE });
    // 1.0.2's Settings prompt was 3,765 tokens: with a 600-token reply it needs more than 4,096.
    expect(contextSizeFor(3765, 600)).toEqual({ min: 3765 + 600 + CONTEXT_MARGIN, max: 8192 });
    expect(contextSizeFor(9000, 1500)).toEqual({ min: 10628, max: 10628 });
    expect(isInsufficientMemory(new FakeInsufficientMemoryError("x"), { InsufficientMemoryError: FakeInsufficientMemoryError as never })).toBe(true);
    expect(isInsufficientMemory(new Error("A context size of 4096 is too large for the available VRAM"))).toBe(true);
    expect(isInsufficientMemory(new Error("file not found"))).toBe(false);
  });

  it("keeps one chat session on one sequence, so every turn reuses the evaluated prefix, and logs what it runs on", async () => {
    const f = fakeLlamaModule({ replies: ["a", "b", "c"] });
    for (const n of [1, 2, 3]) await f.runner.complete("/m.gguf", "auto", conversation(n), { maxTokens: 600 });
    expect(f.counts).toEqual({ sequences: 1, sessions: 1, getLlama: 1 });
    expect(f.histories).toHaveLength(3); // the whole conversation every turn – node-llama-cpp keeps the matching prefix
    expect(f.calls.filter((c) => c.startsWith("createContext"))).toEqual([`createContext ${LOCAL_CONTEXT_MIN}-${LOCAL_CONTEXT_SIZE} (29 layers)`]);
    expect(f.calls[0]).toBe("getLlama auto +logger");
    expect(f.logs.filter((l) => l.startsWith("llama.cpp warn"))).toEqual(["llama.cpp warn: ggml_vulkan: Found 1 Vulkan devices"]);
    const loaded = f.logs.find((l) => l.startsWith("local model loaded"));
    expect(loaded).toMatch(/backend vulkan on "AMD Radeon RX 6600", 29 GPU layers, context 8192 tokens \(asked 4096–8192\), VRAM free 7\.0 GB of 8\.0 GB/);
    expect(f.logs.some((l) => /^llama\.cpp ready .*backend vulkan .*GPU "AMD Radeon RX 6600", VRAM free 7\.0 GB of 8\.0 GB, 4 CPU math cores/.test(l))).toBe(true);
    expect(f.runner.status()).toMatchObject({ loaded: true, backend: "vulkan", gpuLayers: 29, contextSize: 8192, gpuDevice: "AMD Radeon RX 6600" });
  });

  it("grows the context when a conversation outgrows it (a PC short of memory gets only the floor)", async () => {
    const f = fakeLlamaModule({ grant: "min" });
    await f.runner.complete("/m.gguf", "auto", conversation(1), { maxTokens: 600 });
    expect(f.runner.status().contextSize).toBe(LOCAL_CONTEXT_MIN);
    const long: AiMessage[] = [...conversation(1), { role: "assistant", content: "{}" }, { role: "user", content: "y".repeat(16000) }];
    await f.runner.complete("/m.gguf", "auto", long, { maxTokens: 600 });
    expect(f.runner.status().contextSize).toBeGreaterThan(4000 + 600);
    expect(f.calls.filter((c) => c.startsWith("loadModel"))).toHaveLength(1); // the same model, a bigger context
    expect(f.logs.some((l) => l.startsWith("context grown to"))).toBe(true);
  });

  it("falls back to half the GPU layers, then the CPU, and then says plainly that memory is short", async () => {
    const half = fakeLlamaModule({ contextFails: (layers, gpu) => gpu !== false && layers > 14 });
    await half.runner.complete("/m.gguf", "auto", conversation(), {});
    expect(half.calls.filter((c) => c.startsWith("loadModel") || c.startsWith("createContext"))).toEqual(["loadModel auto auto", "createContext 4096-8192 (29 layers)", "loadModel auto 14", "createContext 4096-8192 (14 layers)"]);
    expect(half.runner.status()).toMatchObject({ backend: "vulkan", gpuLayers: 14 });
    const cpu = fakeLlamaModule({ contextFails: (_layers, gpu) => gpu !== false });
    await cpu.runner.complete("/m.gguf", "auto", conversation(), {});
    expect(cpu.calls.filter((c) => c.startsWith("getLlama") || c.startsWith("loadModel"))).toEqual(["getLlama auto +logger", "loadModel auto auto", "loadModel auto 14", "getLlama cpu +logger", "loadModel cpu 0"]);
    expect(cpu.runner.status()).toMatchObject({ backend: "cpu", gpuLayers: 0 });
    const none = fakeLlamaModule({ contextFails: () => true });
    await expect(none.runner.complete("/m.gguf", "auto", conversation(), {})).rejects.toThrow(NOT_ENOUGH_MEMORY);
    expect(none.runner.status().error).toMatch(/close other apps or pick a smaller model/);
    const cpuOnly = fakeLlamaModule({ contextFails: () => true });
    await expect(cpuOnly.runner.complete("/m.gguf", "off", conversation(), {})).rejects.toThrow(/Not enough free memory/);
    expect(cpuOnly.calls.filter((c) => c.startsWith("loadModel"))).toEqual(["loadModel cpu 0"]);
  });

  it("unloads only after the reply in progress (no 'Object is disposed' mid-reply)", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const f = fakeLlamaModule({ gate });
    const reply = f.runner.complete("/m.gguf", "auto", conversation(), {});
    await vi.waitFor(() => expect(f.prompts).toHaveLength(1));
    const unloading = f.runner.unload();
    await new Promise((r) => setTimeout(r, 20));
    expect(f.calls).not.toContain("context.dispose");
    release();
    await expect(reply).resolves.toEqual({ text: '{"ok":true}', cancelled: false });
    await unloading;
    expect(f.calls.slice(-3)).toEqual(["context.dispose", "model.dispose", "llama.dispose"]);
    expect(f.runner.status().loaded).toBe(false);
  });

  it("folds the app's retry note into the prompt and answers the status panel's runtime and model checks", async () => {
    expect(toChatHistory([{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: "bad" }, { role: "system", content: "Your reply was not valid" }])).toEqual({
      history: [{ type: "system", text: "s" }, { type: "user", text: "u" }, { type: "model", response: ["bad"] }],
      prompt: "Your reply was not valid",
    });
    const f = fakeLlamaModule();
    expect(await f.runner.runtime("auto", false)).toEqual({ imported: true, supported: ["vulkan", "cpu"], backend: null, devices: [], vram: null, cpuCores: null, error: null });
    expect(await f.runner.runtime("auto", true)).toMatchObject({ backend: "vulkan", devices: ["AMD Radeon RX 6600"], vram: { total: 8 * 1024 ** 3 }, cpuCores: 4 });
    const probe = await f.runner.probe("/m.gguf", "auto");
    expect(probe).toMatchObject({ ok: true, backend: "vulkan", gpuLayers: 29, contextSize: 8192, reply: '{"ok":true}' });
    expect(probe.tokensPerSec).toBeGreaterThan(0);
    expect(f.prompts.at(-1)).toMatchObject({ maxTokens: 8, temperature: 0 });
    // The speed is the generation's: the wait for the first token (reading the prompt) is not in it.
    const streamed = await fakeLlamaModule({ stream: { firstMs: 300, restMs: 40 } }).runner.probe("/m.gguf", "auto");
    expect(streamed.firstTokenMs).toBeGreaterThanOrEqual(250);
    expect(streamed.tokensPerSec).toBeGreaterThan((streamed.tokens * 1000) / streamed.replyMs);
    const broken = new LocalModelRunner(async () => Promise.reject(new Error("Cannot find module 'node-llama-cpp'")));
    expect(await broken.runtime("auto", true)).toMatchObject({ imported: false, error: "Cannot find module 'node-llama-cpp'" });
  });
});

/* ------------------------------------------------------------------ net.fetch, the services, the cause codes */

const plainStorage: SafeStorageLike = { isEncryptionAvailable: () => true, encryptString: (t) => Buffer.from(`enc:${t}`), decryptString: (b) => b.toString().replace(/^enc:/, "") };

function serviceWith(extra: Partial<ConstructorParameters<typeof AiService>[0]> = {}, prefsPatch: Partial<DesktopPrefs> = {}) {
  let prefs: DesktopPrefs = { ...DEFAULT_PREFS, ...prefsPatch };
  let cloud: CloudSettings = { ...DEFAULT_CLOUD };
  const logs: string[] = [];
  const unloads: number[] = [];
  const local = fakeLlamaModule().runner;
  const svc = new AiService({
    prefs: () => prefs,
    setPrefs: (p) => (prefs = { ...prefs, ...p }),
    cloud: () => cloud,
    setCloud: (c) => (cloud = c),
    secrets: new SecretBox(plainStorage),
    local: Object.assign(local, { unload: async () => void unloads.push(1) }) as LocalModelRunner,
    modelPath: async (id) => (id === "qwen2.5-1.5b-instruct-q4km" ? "/models/qwen.gguf" : null),
    emitToken: () => {},
    log: (level, message) => logs.push(`${level}: ${message}`),
    ...extra,
  });
  return { svc, logs, unloads, prefs: () => prefs, setCloud: (c: Partial<CloudSettings>) => (cloud = { ...cloud, ...c }) };
}

const sse = (events: [string, unknown][]) => events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");

describe("net.fetch for every main-process request", () => {
  it("hands Electron's net.fetch to the model manager, the OpenAI-compatible adapter and the Anthropic SDK", async () => {
    const seen: string[] = [];
    const netFetch = async (input: string | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      seen.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/v1/messages?beta=true")) {
        const body = sse([
          ["message_start", { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 3, output_tokens: 1 } } }],
          ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
          ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: '{"ok":true}' } }],
          ["content_block_stop", { type: "content_block_stop", index: 0 }],
          ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } }],
          ["message_stop", { type: "message_stop" }],
        ]);
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      if (url.endsWith("/chat/completions")) return new Response('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n', { status: 200 });
      return new Response(Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(1000)]), { status: 200 });
    };
    const deps = networkDeps(netFetch);
    // The Anthropic SDK (the real one) over the injected fetch.
    const text = await completeAnthropic(deps.anthropic("sk-test", "https://api.anthropic.com"), "claude-opus-5-5", { messages: [{ role: "user", content: "hi" }] });
    expect(text).toBe('{"ok":true}');
    // The OpenAI-compatible adapter through AiService.
    const { svc } = serviceWith({ fetch: deps.aiFetch }, { aiProvider: "cloud" });
    await svc.setCloud({ provider: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.2", use: true });
    expect((await svc.chat({ requestId: "c", messages: [{ role: "user", content: "x" }] })).text).toBe("hi");
    // The model manager's download.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-net-"));
    const payload = Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(1000)]);
    const spec: ModelSpec = { id: "tiny", name: "Tiny", file: "tiny.gguf", url: "https://huggingface.co/x/tiny.gguf", size: payload.length, sha256: createHash("sha256").update(payload).digest("hex"), licence: "MIT", licenceUrl: "", commercial: true, params: "1" };
    await new ModelManager({ dir, catalog: [spec], fetch: deps.modelFetch }).download("tiny");
    fs.rmSync(dir, { recursive: true, force: true });
    expect(seen).toEqual(["POST https://api.anthropic.com/v1/messages?beta=true", "POST http://localhost:11434/v1/chat/completions", "GET https://huggingface.co/x/tiny.gguf"]);
    // The client the app builds without an injected fetch still works (the SDK's own).
    expect(anthropicClient("k", "")).toBeTruthy();
  });

  it("says why a request failed: the cause codes, in the download's progress event and in a cloud error", async () => {
    const tlsFailure = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("self-signed certificate in certificate chain"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }) });
    };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-tls-"));
    const events: { error?: string }[] = [];
    const spec: ModelSpec = { id: "tiny", name: "Tiny", file: "tiny.gguf", url: "https://huggingface.co/x/tiny.gguf", size: 10, sha256: "0", licence: "MIT", licenceUrl: "", commercial: true, params: "1" };
    const manager = new ModelManager({ dir, catalog: [spec], fetch: tlsFailure as unknown as typeof fetch, onProgress: (e) => events.push(e) });
    await expect(manager.download("tiny")).rejects.toThrow(/Download failed: fetch failed \(SELF_SIGNED_CERT_IN_CHAIN: the TLS certificate is not trusted/);
    expect(events.at(-1)?.error).toMatch(/SELF_SIGNED_CERT_IN_CHAIN/);
    fs.rmSync(dir, { recursive: true, force: true });
    const refused = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5612"), { code: "ECONNREFUSED" }) });
    };
    await expect(completeOpenAi(refused as unknown as typeof fetch, "http://127.0.0.1:5612/v1", "", "m", { messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      "Could not reach the cloud provider at 127.0.0.1:5612: fetch failed (ECONNREFUSED: nothing answers at that address (is the server running?))",
    );
  });

  it("falls back to Node's fetch when net.fetch gets no answer (a CA only Node knows), never for an HTTP error or a stop", async () => {
    const certError = async () => {
      throw new Error("net::ERR_CERT_AUTHORITY_INVALID");
    };
    const calls: string[] = [];
    const node = (async (url: string) => (calls.push(`node ${url}`), new Response("ok", { status: 200 }))) as unknown as typeof fetch;
    const logs: string[] = [];
    const f = withFallback(certError as unknown as typeof fetch, node, (m) => logs.push(m));
    expect((await f("https://huggingface.co/x")).status).toBe(200);
    expect(calls).toEqual(["node https://huggingface.co/x"]);
    expect(logs[0]).toMatch(/^net\.fetch could not reach huggingface\.co \(net::ERR_CERT_AUTHORITY_INVALID \(the TLS certificate is not trusted/);
    // An HTTP answer (even an error status) is an answer: no second try.
    const http404 = withFallback((async () => new Response("", { status: 404 })) as unknown as typeof fetch, node);
    expect((await http404("https://huggingface.co/y")).status).toBe(404);
    expect(calls).toHaveLength(1);
    // Both fail: the message says both.
    const nodeFails = (async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    }) as unknown as typeof fetch;
    await expect(withFallback(certError as unknown as typeof fetch, nodeFails)("https://huggingface.co/z")).rejects.toThrow(/^net::ERR_CERT_AUTHORITY_INVALID \(.*\); through Node's fetch: fetch failed \(ENOTFOUND: /);
    // A stopped request is not tried again.
    const controller = new AbortController();
    controller.abort();
    const aborting = (async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(withFallback(aborting, node)("https://huggingface.co/w", { signal: controller.signal })).rejects.toThrow(/aborted/);
    expect(calls).toHaveLength(1);
    // networkDeps wires the fallback behind every client.
    const deps = networkDeps(certError, node);
    expect((await deps.modelFetch("https://huggingface.co/m")).status).toBe(200);
  });

  it("folds the app's notes into user turns for Anthropic and OpenAI-compatible servers", () => {
    const messages: AiMessage[] = [{ role: "system", content: "rules" }, { role: "user", content: "go" }, { role: "assistant", content: "bad" }, { role: "system", content: "Your reply was not valid" }];
    expect(splitSystem(messages)).toEqual({ system: "rules", turns: [{ role: "user", content: "go" }, { role: "assistant", content: "bad" }, { role: "user", content: "Your reply was not valid" }] });
    expect((openAiBody("m", { messages }).messages as { role: string }[]).map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
  });
});

describe("AiService: logs, the last error in ai:status, the model auto-select", () => {
  it("keeps the last failure of each path for the status and logs it with its cause chain", async () => {
    const { svc, logs, setCloud } = serviceWith({ fetch: (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch }, { aiProvider: "cloud" });
    setCloud({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", keySealed: Buffer.from(`enc:${SECRET}`).toString("base64") });
    await expect(svc.chat({ requestId: "r1", messages: [{ role: "user", content: "x" }], task: "copy" })).rejects.toThrow(/HTTP 401: bad key/);
    const status = await svc.status();
    expect(status.lastError?.cloud).toMatchObject({ message: "The cloud provider answered HTTP 401: bad key", task: "copy", provider: "openai", model: "gpt-4o-mini" });
    expect(status.lastError?.cloud?.at).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(status.lastError?.local).toBeNull();
    expect(logs.some((l) => /^info: ai request r1: copy on openai gpt-4o-mini, 1 messages, 1 characters$/.test(l))).toBe(true);
    expect(logs.some((l) => /^error: ai request r1 failed after \d+ ms \(copy on openai gpt-4o-mini\): Error: The cloud provider answered HTTP 401: bad key @ /.test(l))).toBe(true);
    expect(logs.join("\n")).not.toContain(SECRET);
    // A local failure goes to the local path.
    const local = serviceWith({}, { localModel: "missing" });
    await expect(local.svc.chat({ requestId: "r2", messages: [{ role: "user", content: "x" }], task: "settings" })).rejects.toThrow(/No local model yet/);
    expect((await local.svc.status()).lastError?.local).toMatchObject({ task: "settings", provider: "local", model: "missing" });
  });

  it("selects a finished download when the selected model is not ready (and keeps a ready selection)", async () => {
    const ready = ["qwen2.5-1.5b-instruct-q4km"];
    const a = serviceWith({ readyModels: async () => ready });
    expect(a.prefs().localModel).toBe("llama-3.2-3b-instruct-q4km");
    expect(await a.svc.ensureSelectedModel("qwen2.5-1.5b-instruct-q4km")).toBe("qwen2.5-1.5b-instruct-q4km");
    expect(a.prefs().localModel).toBe("qwen2.5-1.5b-instruct-q4km");
    expect(a.unloads).toHaveLength(1);
    expect((await a.svc.status()).ready).toBe(true); // Run is enabled now (1.0.2 kept it disabled until "Use")
    // Already ready: nothing changes.
    expect(await a.svc.ensureSelectedModel("other")).toBe("qwen2.5-1.5b-instruct-q4km");
    expect(a.unloads).toHaveLength(1);
    // At start, a 1.0.2 install whose download was never "used": the first ready model.
    const b = serviceWith({ readyModels: async () => ready });
    expect(await b.svc.ensureSelectedModel()).toBe("qwen2.5-1.5b-instruct-q4km");
    const c = serviceWith({ readyModels: async () => [] });
    expect(await c.svc.ensureSelectedModel()).toBeNull();
    expect(c.prefs().localModel).toBe(DEFAULT_PREFS.localModel);
  });
});

/* ------------------------------------------------------------------ --- review fix (desktop-ai-fix) --- a download, as the page sees it */

describe("a finished download reaches the page already selected", () => {
  const payload = Buffer.concat([Buffer.from("GGUF"), Buffer.alloc(40_000, 5)]);
  const small: ModelSpec = { id: "qwen2.5-1.5b-instruct-q4km", name: "Qwen2.5 1.5B", file: "qwen.gguf", url: "https://huggingface.co/x/qwen.gguf", size: payload.length, sha256: createHash("sha256").update(payload).digest("hex"), licence: "Apache-2.0", licenceUrl: "", commercial: true, params: "1.5B" };
  const preselected: ModelSpec = { ...small, id: DEFAULT_PREFS.localModel, name: "Llama 3.2 3B", file: "llama.gguf" };
  const serve = (async () => new Response(new Uint8Array(payload), { status: 200 })) as unknown as typeof fetch;

  interface PageView {
    event: string;
    /** The app's selection when the event left it. */
    selectedAtEvent: string;
    ready?: boolean;
    model?: string | null;
    inUse?: string[];
  }

  /**
   * The app's model services exactly as main.ts wires them (createModelServices), and the page: on a model's "ready" (or
   * failed) event it refreshes once – ai:status and ai:models, answered by the main process the moment they arrive.
   */
  function appWithPage(dir: string, fetchImpl: typeof fetch = serve, setPrefsFails = false) {
    let prefs: DesktopPrefs = { ...DEFAULT_PREFS };
    let cloud: CloudSettings = { ...DEFAULT_CLOUD };
    const logs: string[] = [];
    const views: PageView[] = [];
    const refreshes: Promise<unknown>[] = [];
    const { models, ai } = createModelServices({
      manager: {
        dir,
        catalog: [preselected, small],
        fetch: fetchImpl,
        onProgress: (e) => {
          if (e.state !== "ready" && !e.error) return;
          const view: PageView = { event: `${e.id} ${e.error ? `failed: ${e.error}` : e.state}`, selectedAtEvent: prefs.localModel };
          views.push(view);
          refreshes.push(
            Promise.all([ai.status(), models.list(prefs.localModel)]).then(([status, list]) => {
              view.ready = status.ready;
              view.model = status.local.model;
              view.inUse = list.filter((m) => m.selected && m.state === "ready").map((m) => m.id);
            }),
          );
        },
      },
      service: {
        prefs: () => prefs,
        setPrefs: (p) => {
          if (setPrefsFails) throw new Error("the settings file is locked");
          prefs = { ...prefs, ...p };
        },
        cloud: () => cloud,
        setCloud: (c) => (cloud = c),
        secrets: new SecretBox(plainStorage),
        local: Object.assign(fakeLlamaModule().runner, { unload: async () => {} }) as LocalModelRunner,
        emitToken: () => {},
        log: (level, message) => logs.push(`${level}: ${message}`),
      },
    });
    return { models, ai, views, logs, settled: () => Promise.all(refreshes), prefs: () => prefs, select: (id: string) => (prefs = { ...prefs, localModel: id }) };
  }

  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-select-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("selects a download of another model before its ready event, so the page's one refresh enables Run", async () => {
    const app = appWithPage(dir);
    expect((await app.ai.status()).ready).toBe(false); // the preselected 2 GB model is not on this PC
    // The IPC handler's download: the event goes out, then the download returns (1.0.3 selected only after the return).
    const entry = await app.models.download(small.id);
    await app.settled();
    expect(entry.state).toBe("ready");
    expect(app.views).toEqual([{ event: `${small.id} ready`, selectedAtEvent: small.id, ready: true, model: small.id, inUse: [small.id] }]);
    expect(app.logs).toContain(`info: selected the local model ${small.id}: the selected ${preselected.id} is not downloaded`);
    // A model already on disk (a second click on a list that was not refreshed): selected the same way, and the page told.
    app.select(preselected.id);
    await app.models.download(small.id);
    await app.settled();
    expect(app.views.at(-1)).toEqual({ event: `${small.id} ready`, selectedAtEvent: small.id, ready: true, model: small.id, inUse: [small.id] });
    // A ready selection stays: another download does not take it over.
    await app.models.download(preselected.id);
    await app.settled();
    expect(app.views.at(-1)).toEqual({ event: `${preselected.id} ready`, selectedAtEvent: small.id, ready: true, model: small.id, inUse: [small.id] });
  });

  it("enables Run for the preselected model's own download, keeps a verified model when the selection fails, and selects nothing for a failed one", async () => {
    const own = appWithPage(dir);
    await own.models.download(preselected.id);
    await own.settled();
    expect(own.views).toEqual([{ event: `${preselected.id} ready`, selectedAtEvent: preselected.id, ready: true, model: preselected.id, inUse: [preselected.id] }]);
    // The selection fails (the settings file cannot be written): the download is still verified and ready, the log says why.
    const locked = appWithPage(fs.mkdtempSync(path.join(dir, "locked-")), serve, true);
    expect((await locked.models.download(small.id)).state).toBe("ready");
    await locked.settled();
    expect(locked.views).toEqual([{ event: `${small.id} ready`, selectedAtEvent: preselected.id, ready: false, model: preselected.id, inUse: [] }]);
    expect(locked.logs).toContain(`warn: selecting ${small.id}: the settings file is locked`);
    // A failed download: the page hears the error and nothing is selected.
    const failed = appWithPage(fs.mkdtempSync(path.join(dir, "failed-")), (async () => new Response("", { status: 503 })) as unknown as typeof fetch);
    await expect(failed.models.download(small.id)).rejects.toThrow(/HTTP 503/);
    await failed.settled();
    expect(failed.views).toEqual([{ event: `${small.id} failed: Download failed: HTTP 503`, selectedAtEvent: preselected.id, ready: false, model: preselected.id, inUse: [] }]);
    expect(failed.prefs().localModel).toBe(preselected.id);
  });
});

/* ------------------------------------------------------------------ the diagnose handler */

function diagnosticsDeps(patch: Partial<DiagnosticsDeps> = {}, prefsPatch: Partial<DesktopPrefs> = {}): DiagnosticsDeps {
  const entry: ModelEntry = { id: DEFAULT_PREFS.localModel, name: "Llama 3.2 3B Instruct (Q4_K_M)", size: 2_019_377_696, sha256: "6c1a2b41161032677be168d354123594c0e6e67d2b9227c84f296ad037c728ff", licence: "Llama", licenceUrl: "", url: "u", state: "ready", downloaded: 2_019_377_696, path: "/home/someone/models/llama.gguf", custom: false, selected: true };
  return {
    prefs: () => ({ ...DEFAULT_PREFS, ...prefsPatch }),
    cloud: () => ({ provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5" }),
    key: () => SECRET,
    encryption: () => true,
    modelEntry: async () => entry,
    runtime: async (_gpu, start) => ({ imported: true, supported: ["vulkan", "cpu"], backend: start ? "vulkan" : null, devices: start ? ["AMD Radeon RX 6600"] : [], vram: start ? { total: 8 * 1024 ** 3, free: 7 * 1024 ** 3 } : null, cpuCores: 4, error: null }),
    probe: async () => ({ ok: true, backend: "vulkan", gpuLayers: 29, contextSize: 8192, loadMs: 2100, replyMs: 400, firstTokenMs: 70, tokens: 6, tokensPerSec: 15, reply: '{"ok":true}', error: null }),
    localStatus: () => ({ model: null, loaded: false, backend: null, gpuLayers: null, error: null, contextSize: null, gpuDevice: null }),
    lastErrors: () => ({ local: null, cloud: null }),
    netFetch: (async (url: string, init?: RequestInit) => new Response("{}", { status: String(url).includes("anthropic") ? ((init?.headers as Record<string, string>)["x-api-key"] === SECRET ? 200 : 401) : 200 })) as unknown as typeof fetch,
    nodeFetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch,
    facts: () => ({ app: { version: "1.0.3", electron: "44.5.1" }, os: { platform: "win32", ram: "9.0 GB free of 16.0 GB" } }),
    ram: () => ({ total: 16 * 1024 ** 3, free: 9 * 1024 ** 3 }),
    gpu: async () => [{ name: "AMD Radeon RX 6600" }],
    logTail: async () => ["2026-10-04T10:00:00Z INFO start", `2026-10-04T10:00:01Z WARN header x-api-key: ${SECRET} authorization: Bearer ${SECRET}`],
    ...patch,
  };
}

describe("the diagnose handler (the AI status panel)", () => {
  it("answers the quick look from what is known, without network or model load", async () => {
    const probe = vi.fn();
    const net = vi.fn();
    const d = await runAiDiagnostics(diagnosticsDeps({ probe, netFetch: net as unknown as typeof fetch }));
    expect(d.deep).toBe(false);
    expect(d.checks.map((c) => [c.id, c.level, c.code])).toEqual([
      ["runtime", "skip", "runtimeNotStarted"],
      ["model", "ok", "modelReady"],
      ["provider", "skip", "providerNotTested"],
      ["network", "skip", "networkNotTested"],
      ["lastError", "ok", "lastErrorNone"],
    ]);
    expect(probe).not.toHaveBeenCalled();
    expect(net).not.toHaveBeenCalled();
  });

  it("runs every check deep: GPU, model test, endpoint with the key, network, last error – and the report never holds the key", async () => {
    const d = await runAiDiagnostics(diagnosticsDeps({ lastErrors: () => ({ local: { message: "Not enough free memory for this model", at: "2026-10-04T10:00:00.000Z", task: "videos", provider: "local", model: "llama" }, cloud: null }) }), { deep: true });
    expect(d.checks.map((c) => [c.id, c.level, c.code])).toEqual([
      ["runtime", "ok", "runtimeGpu"],
      ["model", "ok", "modelTested"],
      ["provider", "ok", "providerOk"],
      ["network", "ok", "networkOk"],
      ["lastError", "warn", "lastErrorSome"],
    ]);
    expect(d.checks[0].params).toMatchObject({ backend: "vulkan", device: "AMD Radeon RX 6600", vram: "7.0 GB" });
    expect(d.checks[0].details).toEqual(expect.arrayContaining(["backend: vulkan", "GPU: AMD Radeon RX 6600", "VRAM: 7.0 GB free of 8.0 GB", "RAM: 9.0 GB free of 16.0 GB"]));
    expect(d.checks[1].params).toMatchObject({ tps: 15, context: 8192, layers: 29 });
    expect(d.checks[1].details.join("\n")).toMatch(/grammar test: 6 tokens in 400 ms, the first after 70 ms \(then 15 tokens\/s\)/);
    expect(d.checks[4].params).toMatchObject({ task: "videos", message: "Not enough free memory for this model" });
    const report = JSON.stringify(d.report);
    expect(report).not.toContain(SECRET);
    expect(report).toContain("[key removed]");
    expect(d.report).toMatchObject({ app: { version: "1.0.3" }, cloud: { provider: "anthropic", keyStored: true }, ai: { runtime: { backend: "vulkan" } } });
    expect((d.report.logTail as string[])[1]).toBe("2026-10-04T10:00:01Z WARN header x-api-key: [key removed] authorization: Bearer [key removed]");
    expect(JSON.stringify(d.checks)).not.toContain(SECRET);
  });

  it("names what fails: no backend, a missing model, a rejected key, TLS interception, no network", async () => {
    const tls = async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "SELF_SIGNED_CERT_IN_CHAIN", message: "self-signed certificate in certificate chain" } });
    };
    const d = await runAiDiagnostics(
      diagnosticsDeps({
        runtime: async () => ({ imported: true, supported: ["cpu"], backend: "cpu", devices: [], vram: null, cpuCores: 4, error: null }),
        modelEntry: async (id) => ({ id, name: "Llama", size: 1, sha256: "x", licence: "", licenceUrl: "", url: "u", state: "missing", downloaded: 0, path: null, custom: false, selected: true }),
        netFetch: (async (url: string) => new Response("", { status: String(url).includes("anthropic") ? 401 : 200 })) as unknown as typeof fetch,
        nodeFetch: tls as unknown as typeof fetch,
      }),
      { deep: true },
    );
    expect(d.checks.map((c) => [c.id, c.level, c.code])).toEqual([
      ["runtime", "warn", "runtimeCpuFallback"],
      ["model", "fail", "modelMissing"],
      ["provider", "warn", "providerKeyRejected"],
      ["network", "warn", "networkIntercepted"],
      ["lastError", "ok", "lastErrorNone"],
    ]);
    expect(d.checks[3].params.code).toBe("SELF_SIGNED_CERT_IN_CHAIN");
    expect(d.checks[3].details.join("\n")).toMatch(/through Node's fetch: failed – fetch failed \(SELF_SIGNED_CERT_IN_CHAIN/);
    const offline = await runAiDiagnostics(diagnosticsDeps({ netFetch: tls as unknown as typeof fetch, nodeFetch: tls as unknown as typeof fetch, key: () => null, modelEntry: async () => null }, { aiProvider: "cloud" }), { deep: true });
    expect(offline.checks.map((c) => [c.id, c.level, c.code])).toEqual([
      ["runtime", "ok", "runtimeGpu"],
      ["model", "skip", "modelUnknown"],
      ["provider", "fail", "providerNoKey"],
      ["network", "fail", "networkBlocked"],
      ["lastError", "ok", "lastErrorNone"],
    ]);
    // net.fetch cannot get through but Node's fetch can (this development machine's re-signing CA): the fallback carries the downloads.
    const fallback = await runAiDiagnostics(diagnosticsDeps({ netFetch: tls as unknown as typeof fetch, nodeFetch: (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch }), { deep: true });
    expect(fallback.checks[3]).toMatchObject({ level: "warn", code: "networkFallback" });
    const broken = await runAiDiagnostics(diagnosticsDeps({ runtime: async () => ({ imported: false, supported: null, backend: null, devices: [], vram: null, cpuCores: null, error: "Cannot find module" }) }));
    expect(broken.checks.slice(0, 2).map((c) => [c.level, c.code])).toEqual([["fail", "runtimeMissing"], ["skip", "modelNotTested"]]);
    expect(NETWORK_TEST_URL).toMatch(/^https:\/\/huggingface\.co\//);
    expect(scrubSecrets(`token sk-abcdefghijklmnop and ${SECRET}`, SECRET)).toBe("token [key removed] and [key removed]");
  });
});

/* ------------------------------------------------------------------ IPC failures in main.log, the console mirror, packaging */

describe("the main process's logs", () => {
  it("logs every rejected handler with its channel, message, cause chain and stack – and still rejects", async () => {
    const table = Object.fromEntries(Object.values(IPC).map((c) => [c, vi.fn(async () => "ok")])) as unknown as HandlerTable;
    (table as Record<string, unknown>)[IPC.aiChat] = async () => {
      throw new Error("Could not reach the cloud provider", { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5612"), { code: "ECONNREFUSED" }) });
    };
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const logged: string[] = [];
    registerHandlers({ handle: (c, l) => handlers.set(c, l as never), on: () => {} }, table, (m) => logged.push(m));
    const page = { senderFrame: { url: "app://jumpingballslive/en/simulator/" } };
    await expect(handlers.get(IPC.aiChat)!(page, { requestId: "r", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/Could not reach/);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^ipc ai:chat failed: Error: Could not reach the cloud provider @ .*aiFix\.test\.ts.* ⟵ caused by: Error \[ECONNREFUSED\]: connect ECONNREFUSED 127\.0\.0\.1:5612/);
    await expect(handlers.get(IPC.pickMedia)!(page, "exe")).rejects.toThrow(/invalid arguments/);
    expect(logged[1]).toMatch(/^ipc dialog:pick-media failed: IpcRejected: dialog:pick-media: invalid arguments/);
    await expect(handlers.get(IPC.aiDiagnose)!(page, { deep: true })).resolves.toBe("ok");
    expect(describeHandlerFailure("x" as IpcChannel, "plain")).toBe("ipc x failed: plain");
  });

  it("mirrors node-llama-cpp's console lines into main.log without colours, and never loops", () => {
    const printed: string[] = [];
    const fakeConsole = { log: (...a: unknown[]) => printed.push(a.join(" ")), info: (...a: unknown[]) => printed.push(a.join(" ")), warn: (...a: unknown[]) => printed.push(a.join(" ")), error: (...a: unknown[]) => printed.push(a.join(" ")) } as unknown as Console;
    const written: string[] = [];
    // The logger itself prints errors to the console: the mirror must not log them again.
    const restore = mirrorConsole(fakeConsole, (level, message) => {
      written.push(`${level} ${message}`);
      if (level === "error") fakeConsole.error(message);
    });
    fakeConsole.warn("\u001b[33m[node-llama-cpp]\u001b[39m The prebuilt binary with Vulkan support is not compatible with the current system, falling back to using no GPU");
    fakeConsole.error("[node-llama-cpp] Failed to load a prebuilt binary", new Error("boom"));
    fakeConsole.log("an ordinary line");
    restore();
    fakeConsole.warn("[node-llama-cpp] after restore");
    expect(written).toEqual([
      "warn [node-llama-cpp] The prebuilt binary with Vulkan support is not compatible with the current system, falling back to using no GPU",
      expect.stringMatching(/^error \[node-llama-cpp\] Failed to load a prebuilt binary Error: boom/),
    ]);
    expect(printed).toHaveLength(5);
    expect(stripAnsi("\u001b[1mbold\u001b[22m")).toBe("bold");
  });
});

describe("packaging: unsigned builds can update each other", () => {
  const configPath = path.join(__dirname, "..", "electron-builder.config.cjs");
  const load = () => {
    const require = createRequire(import.meta.url);
    delete require.cache[require.resolve(configPath)];
    return require(configPath) as { win: { signtoolOptions?: { publisherName?: string } }; files: string[]; asarUnpack: string[]; extraResources: unknown[] };
  };
  let saved: string | undefined;
  beforeEach(() => (saved = process.env.WIN_CSC_LINK));
  afterEach(() => {
    if (saved === undefined) delete process.env.WIN_CSC_LINK;
    else process.env.WIN_CSC_LINK = saved;
  });
  it("sets the publisher name (which electron-updater then demands a signature for) only with a certificate", () => {
    delete process.env.WIN_CSC_LINK;
    const unsigned = load();
    expect(unsigned.win.signtoolOptions).toBeUndefined();
    process.env.WIN_CSC_LINK = "base64-pfx";
    expect(load().win.signtoolOptions).toEqual({ publisherName: "JumpingBallsLive" });
    // files / asarUnpack / extraResources stay as 1.0.2 shipped them (verified complete).
    expect(unsigned.asarUnpack).toEqual(["node_modules/ffmpeg-static/**", "node_modules/node-llama-cpp/bins/**", "node_modules/node-llama-cpp/llama/**", "node_modules/@node-llama-cpp/**"]);
    expect(unsigned.extraResources).toHaveLength(2);
  });
});
