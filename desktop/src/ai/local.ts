import type { AiMessage } from "@/lib/desktop/contract";
import type { JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { foldSystemNotes } from "@/lib/desktop/ai/conversation"; // --- desktop-ai-fix ---
import { describeError } from "@/lib/desktop/errors"; // --- desktop-ai-fix ---
import { toGrammarSchema } from "./gbnf";

/*
 * --- desktop-exe --- The local model: llama.cpp through node-llama-cpp, loaded on first use (the module is imported lazily,
 * so the app starts – and works without AI – even where its native binary cannot load). `getLlama({ gpu: "auto" })`
 * picks CUDA, Vulkan or Metal when the GPU and driver allow and falls back to the CPU; the model offloads as many layers
 * as fit in VRAM (`gpuLayers: "auto"`). Every reply is constrained by a grammar built from the reply's JSON schema (or,
 * when the schema is beyond the grammar builder, by plain JSON), streamed token by token and cancellable.
 *
 * --- desktop-ai-fix --- What made 1.0.2's local AI slow, fragile and silent, and what the runner does now:
 *  - One chat session on one context sequence for as long as the model stays loaded: every request sets the whole
 *    conversation and node-llama-cpp reuses the evaluated prefix (the 3–4k-token system prompt is read once per job, not on
 *    every turn – 1.0.2 disposed the sequence after each reply, so each turn re-read everything).
 *  - The context has a floor: at least 4,096 tokens and room for the prompt plus the reply (`contextSizeFor()`), at most
 *    8,192 unless a request needs more – `{ max: 8192 }` alone let llama.cpp pick a context smaller than the prompt on a PC
 *    short of memory, and every run failed at once. When the model or its context does not fit
 *    (InsufficientMemoryError), it is loaded again with half the GPU layers, then on the CPU, then the request fails with
 *    "Not enough free memory for this model: close other apps or pick a smaller model (Qwen2.5 1.5B is the smallest)".
 *  - llama.cpp's own messages go to main.log (`getLlama({ logger })`), and every load logs the backend, the GPU, its free
 *    VRAM, the layers on the GPU and the context size.
 *  - `unload()` waits for the request in progress (queued on the same chain), so changing the model or the CPU/GPU choice
 *    mid-reply no longer disposes a context in use ("Object is disposed"), and quitting can wait for it.
 *  - `runtime()` and `probe()` answer the AI status panel (the backend, the GPUs and memory; an 8-token grammar test).
 */

interface GrammarLike {
  readonly __grammar?: true;
}
interface SequenceLike {
  clearHistory?(): Promise<void>;
  dispose?(): void;
}
interface ContextLike {
  getSequence(): SequenceLike;
  dispose(): Promise<void>;
  /** --- desktop-ai-fix --- The size llama.cpp gave the context (tokens). */
  readonly contextSize?: number;
}
interface ModelLike {
  readonly gpuLayers: number;
  createContext(options: { contextSize?: number | { min?: number; max?: number } }): Promise<ContextLike>;
  dispose(): Promise<void>;
  /** --- desktop-ai-fix --- The model's tokenizer (the prompt's size before it is evaluated). */
  tokenize?(text: string): readonly unknown[];
}
interface LlamaLike {
  readonly gpu: string | false;
  loadModel(options: { modelPath: string; gpuLayers?: "auto" | number }): Promise<ModelLike>;
  createGrammarForJsonSchema(schema: unknown): Promise<GrammarLike>;
  getGrammarFor(type: "json"): Promise<GrammarLike>;
  /** A grammar from GBNF text (the plain-JSON fallback inside the asar archive). */
  createGrammar?(options: { grammar: string; trimWhitespaceSuffix?: boolean }): Promise<GrammarLike>;
  dispose(): Promise<void>;
  /** --- desktop-ai-fix --- What the status panel shows: the GPUs llama.cpp sees, their memory, the CPU cores it computes on. */
  getGpuDeviceNames?(): Promise<string[]>;
  getVramState?(): Promise<{ total: number; used: number; free: number }>;
  readonly cpuMathCores?: number;
}

/**
 * --- review fix (desktop-exe) --- llama.cpp's JSON grammar (node-llama-cpp's llama/grammars/json.gbnf, MIT). Inside the
 * packaged app `getGrammarFor("json")` cannot find its grammars folder – Electron's asar support answers `fs.access` on a
 * directory in the archive with ENOENT – so the plain-JSON fallback builds the same grammar from this text.
 */
export const JSON_GBNF = "root   ::= object\nvalue  ::= object | array | string | number | (\"true\" | \"false\" | \"null\") ws\n\nobject ::=\n  \"{\" ws (\n            string \":\" ws value\n    (\",\" ws string \":\" ws value)*\n  )? \"}\" ws\n\narray  ::=\n  \"[\" ws (\n            value\n    (\",\" ws value)*\n  )? \"]\" ws\n\nstring ::=\n  \"\\\"\" (\n    [^\"\\\\\\x7F\\x00-\\x1F] |\n    \"\\\\\" ([\"\\\\bfnrt] | \"u\" [0-9a-fA-F]{4}) # escapes\n  )* \"\\\"\" ws\n\nnumber ::= (\"-\"? ([0-9] | [1-9] [0-9]{0,15})) (\".\" [0-9]+)? ([eE] [-+]? [0-9] [1-9]{0,15})? ws\n\n# Optional space: by convention, applied in this grammar after literal chars when allowed\nws ::= | \" \" | \"\\n\" [ \\t]{0,20}\n";

/** The plain-JSON grammar: node-llama-cpp's own, or – where its grammars folder cannot be read (the asar archive) – `JSON_GBNF`. */
export async function jsonGrammar(llama: Pick<LlamaLike, "getGrammarFor" | "createGrammar">): Promise<GrammarLike> {
  try {
    return await llama.getGrammarFor("json");
  } catch (err) {
    if (!llama.createGrammar) throw err;
    return await llama.createGrammar({ grammar: JSON_GBNF, trimWhitespaceSuffix: true });
  }
}
type HistoryItem = { type: "system"; text: string } | { type: "user"; text: string } | { type: "model"; response: string[] };
interface SessionLike {
  setChatHistory(history: HistoryItem[]): void;
  prompt(text: string, options: { grammar?: GrammarLike; maxTokens?: number; temperature?: number; signal?: AbortSignal; stopOnAbortSignal?: boolean; onTextChunk?: (text: string) => void }): Promise<string>;
  dispose(options?: { disposeSequence?: boolean }): void;
}
export interface LlamaModuleLike {
  getLlama(options: { gpu: "auto" | false; logger?: (level: string, message: string) => void }): Promise<LlamaLike>;
  LlamaChatSession: new (options: { contextSequence: SequenceLike }) => SessionLike;
  /** --- desktop-ai-fix --- node-llama-cpp's error for a model or context that does not fit in memory. */
  InsufficientMemoryError?: new (...args: never[]) => Error;
  /** --- desktop-ai-fix --- The GPU types this PC supports ("cuda", "vulkan", false for the CPU). */
  getLlamaGpuTypes?(include: "supported" | "allValid"): Promise<(string | false)[]>;
}

export const LOCAL_CONTEXT_SIZE = 8192;

/** What `checkLocalAi()` found: the module loaded, its CPU backend started and built the JSON grammar – or the error. */
export interface LocalAiCheck {
  ok: boolean;
  backend: string | null;
  error: string | null;
}

/**
 * --- review fix (desktop-exe) --- The packaged app's check that the local AI can start at all (the smoke run's): node-llama-cpp
 * imports – its index reads llama/binariesGithubRelease.json while it loads, so a package without the small llama/ files
 * fails right here – its prebuilt CPU backend starts without building anything, and it builds both grammars a reply can be
 * held to (from a JSON schema, and plain JSON – `jsonGrammar()`). No model is needed. `load` is `() => import("node-llama-cpp")`.
 */
export async function checkLocalAi(load: () => Promise<unknown>): Promise<LocalAiCheck> {
  let llama: (Partial<Pick<LlamaLike, "createGrammarForJsonSchema" | "getGrammarFor" | "createGrammar">> & { gpu?: string | false; dispose?(): Promise<void> }) | null = null;
  try {
    const mod = (await load()) as { getLlama?: (options: { gpu: false; build: "never" }) => Promise<typeof llama> };
    if (typeof mod?.getLlama !== "function") throw new Error("node-llama-cpp has no getLlama()");
    llama = await mod.getLlama({ gpu: false, build: "never" });
    if (!llama) throw new Error("getLlama() returned nothing");
    // The two grammars a reply can be held to: one from a reply's JSON schema, and the plain-JSON fallback.
    await llama.createGrammarForJsonSchema?.({ type: "object", properties: { ok: { type: "boolean" } } });
    if (llama.getGrammarFor) await jsonGrammar(llama as Pick<LlamaLike, "getGrammarFor" | "createGrammar">);
    return { ok: true, backend: llama.gpu || "cpu", error: null };
  } catch (err) {
    return { ok: false, backend: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    await llama?.dispose?.().catch(() => {});
  }
}

/**
 * The chat history node-llama-cpp keeps (all but the last user message, which is the prompt). --- desktop-ai-fix --- The app's
 * notes after the conversation started (system messages) are folded into user turns first (conversation.ts).
 */
export function toChatHistory(messages: readonly AiMessage[]): { history: HistoryItem[]; prompt: string } {
  const folded = foldSystemNotes(messages);
  const last = folded[folded.length - 1];
  if (!last || last.role !== "user") throw new Error("The last message must be the user's");
  const history: HistoryItem[] = [];
  for (const m of folded.slice(0, -1)) {
    if (m.role === "system") history.push({ type: "system", text: m.content });
    else if (m.role === "user") history.push({ type: "user", text: m.content });
    else history.push({ type: "model", response: [m.content] });
  }
  return { history, prompt: last.content };
}


export interface LocalStatus {
  model: string | null;
  loaded: boolean;
  backend: string | null;
  gpuLayers: number | null;
  error: string | null;
  /** --- desktop-ai-fix --- The loaded context's size (tokens) and the GPU llama.cpp found first. */
  contextSize: number | null;
  gpuDevice: string | null;
}

/* ------------------------------------------------------------------ --- desktop-ai-fix --- context floor, memory fallback */

/** The context a request gets at least (tokens): the Settings and Make videos prompts alone are 3–4k tokens. */
export const LOCAL_CONTEXT_MIN = 4096;
/** Tokens of slack on top of prompt + reply (the chat template's own tokens, the grammar's whitespace). */
export const CONTEXT_MARGIN = 128;
export const DEFAULT_LOCAL_MAX_TOKENS = 1500;
export const NOT_ENOUGH_MEMORY = "Not enough free memory for this model: close other apps or pick a smaller model (Qwen2.5 1.5B is the smallest)";

/** The context size for a request: at least 4,096 tokens and room for the prompt and the reply; at most 8,192 unless that is too small. */
export function contextSizeFor(promptTokens: number, maxTokens: number): { min: number; max: number } {
  const need = Math.ceil(Math.max(0, promptTokens) + Math.max(0, maxTokens) + CONTEXT_MARGIN);
  const min = Math.max(LOCAL_CONTEXT_MIN, need);
  return { min, max: Math.max(LOCAL_CONTEXT_SIZE, min) };
}

/** Whether node-llama-cpp (or llama.cpp) refused for lack of RAM or VRAM. */
export function isInsufficientMemory(err: unknown, mod?: Pick<LlamaModuleLike, "InsufficientMemoryError"> | null): boolean {
  if (mod?.InsufficientMemoryError && err instanceof mod.InsufficientMemoryError) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /insufficient memory|too large for the available|not enough (?:v?ram|memory)|out of (?:device )?memory|failed to allocate|ErrorOutOfDeviceMemory/i.test(message);
}

/** What `runtime()` found: the module, the GPU types this PC supports, the backend llama.cpp chose and what it sees. */
export interface LocalRuntime {
  imported: boolean;
  /** "cuda", "vulkan", "metal", "cpu" – the types node-llama-cpp finds usable here (null: not asked). */
  supported: string[] | null;
  /** The backend in use ("vulkan", "cpu"…), null when llama.cpp was not started. */
  backend: string | null;
  devices: string[];
  vram: { total: number; free: number } | null;
  cpuCores: number | null;
  error: string | null;
}

/** The status panel's model check: loaded with the real context size and an 8-token grammar-held reply. */
export interface LocalProbe {
  ok: boolean;
  backend: string | null;
  gpuLayers: number | null;
  contextSize: number | null;
  /** Load (or reuse) time and the test reply's time, ms. */
  loadMs: number;
  replyMs: number;
  /** When the reply's first text came (reading the prompt), ms after asking; null: no text. */
  firstTokenMs: number | null;
  tokens: number;
  /** The generation speed: the tokens after the first over the time after it (the whole reply's rate when it came in one piece). */
  tokensPerSec: number | null;
  reply: string;
  error: string | null;
}

type LoadAttempt = { gpu: "auto" | false; layers: "auto" | number };

export class LocalModelRunner {
  private llama: LlamaLike | null = null;
  private llamaGpu: "auto" | false | null = null;
  private model: ModelLike | null = null;
  private context: ContextLike | null = null;
  private sequence: SequenceLike | null = null;
  private session: SessionLike | null = null;
  private loadedPath: string | null = null;
  private loadedGpu: "auto" | "off" | null = null;
  private lastError: string | null = null;
  private gpuDevice: string | null = null;
  private busy: Promise<unknown> = Promise.resolve();
  private lastLlamaLine = "";

  constructor(private readonly load: () => Promise<LlamaModuleLike>, private readonly log: (message: string) => void = () => {}) {}

  status(): LocalStatus {
    return {
      model: this.loadedPath,
      loaded: this.model !== null,
      backend: this.llama ? this.llama.gpu || "cpu" : null,
      gpuLayers: this.model ? this.model.gpuLayers : null,
      error: this.lastError,
      contextSize: this.context ? this.contextTokens() : null,
      gpuDevice: this.gpuDevice,
    };
  }

  /** Runs `fn` after everything queued before it (one context: one request, load or unload at a time). */
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.busy.then(fn, fn);
    this.busy = next.catch(() => {});
    return next;
  }

  private contextTokens(): number {
    return this.context?.contextSize ?? LOCAL_CONTEXT_SIZE;
  }

  /** llama.cpp's messages into main.log (a message repeated line after line is written once). */
  private readonly llamaLogger = (level: string, message: string) => {
    const line = String(message).trim();
    if (!line || line === this.lastLlamaLine) return;
    this.lastLlamaLine = line;
    this.log(`llama.cpp ${level}: ${line}`);
  };

  /** The llama.cpp instance for this GPU choice (created on first use; another choice disposes the old one first). */
  private async llamaFor(mod: LlamaModuleLike, gpu: "auto" | false): Promise<LlamaLike> {
    if (this.llama && (this.llamaGpu === gpu || (gpu === false && !this.llama.gpu))) return this.llama;
    if (this.llama) await this.disposeAll();
    const t0 = Date.now();
    const llama = await mod.getLlama({ gpu, logger: this.llamaLogger });
    this.llama = llama;
    this.llamaGpu = gpu;
    const devices = (await llama.getGpuDeviceNames?.().catch(() => [] as string[])) ?? [];
    const vram = (await llama.getVramState?.().catch(() => null)) ?? null;
    this.gpuDevice = llama.gpu ? (devices[0] ?? null) : null;
    this.log(
      `llama.cpp ready in ${Date.now() - t0} ms: backend ${llama.gpu || "cpu"} (asked: ${gpu === false ? "cpu only" : "auto"})` +
        `${devices.length ? `, GPU ${devices.map((d) => `"${d}"`).join(", ")}` : ", no GPU"}` +
        `${vram && llama.gpu ? `, VRAM free ${gb(vram.free)} of ${gb(vram.total)}` : ""}` +
        `${llama.cpuMathCores ? `, ${llama.cpuMathCores} CPU math cores` : ""}`,
    );
    return llama;
  }

  /** Loads the model with a context of `size`, falling back to half the GPU layers, then the CPU, when memory is short. */
  private async loadWithFallback(mod: LlamaModuleLike, modelPath: string, gpu: "auto" | "off", size: { min: number; max: number }): Promise<void> {
    const attempts: LoadAttempt[] = gpu === "off" ? [{ gpu: false, layers: 0 }] : [{ gpu: "auto", layers: "auto" }];
    let lastErr: unknown = null;
    for (let i = 0; i < attempts.length && i < 4; i++) {
      const attempt = attempts[i];
      const t0 = Date.now();
      const llama = await this.llamaFor(mod, attempt.gpu);
      let model: ModelLike | null = null;
      try {
        model = await llama.loadModel({ modelPath, gpuLayers: attempt.layers });
        const context = await model.createContext({ contextSize: size });
        this.model = model;
        this.context = context;
        const vram = llama.gpu ? ((await llama.getVramState?.().catch(() => null)) ?? null) : null;
        this.log(
          `local model loaded in ${Date.now() - t0} ms: ${modelPath} (backend ${llama.gpu || "cpu"}${this.gpuDevice ? ` on "${this.gpuDevice}"` : ""}, ` +
            `${model.gpuLayers} GPU layers, context ${this.contextTokens()} tokens (asked ${size.min}–${size.max})${vram ? `, VRAM free ${gb(vram.free)} of ${gb(vram.total)}` : ""})`,
        );
        return;
      } catch (err) {
        const offloaded = model?.gpuLayers ?? 0;
        await model?.dispose().catch(() => {});
        if (!isInsufficientMemory(err, mod)) throw err;
        lastErr = err;
        // Next: half the GPU layers (once), then the CPU.
        if (attempt.gpu !== false) {
          const layers = attempt.layers === "auto" ? offloaded : attempt.layers;
          if (attempt.layers === "auto" && layers > 1) attempts.push({ gpu: "auto", layers: Math.floor(layers / 2) });
          if (!attempts.some((a) => a.gpu === false)) attempts.push({ gpu: false, layers: 0 });
        }
        const next = attempts[i + 1];
        this.log(`not enough memory for ${modelPath} with ${attempt.gpu === false ? "the CPU" : `${attempt.layers} GPU layers`} and a context of ${size.min}+ tokens (${describeError(err)})${next ? `; trying ${next.gpu === false ? "the CPU" : `${next.layers} GPU layers`}` : ""}`);
      }
    }
    throw new Error(`${NOT_ENOUGH_MEMORY} (it needs a context of ${size.min} tokens – ${describeError(lastErr)})`);
  }

  /** The model loaded with a context of at least `size.min` tokens (a bigger context for the same model if needed). */
  private async ensure(modelPath: string, gpu: "auto" | "off", size: { min: number; max: number }): Promise<void> {
    const mod = await this.load();
    if (this.model && this.context && this.loadedPath === modelPath && this.loadedGpu === gpu) {
      if (this.contextTokens() >= size.min) return;
      // The same model, a longer conversation: a bigger context.
      await this.disposeContext();
      try {
        this.context = await this.model.createContext({ contextSize: size });
        this.log(`context grown to ${this.contextTokens()} tokens (asked ${size.min}–${size.max})`);
        return;
      } catch (err) {
        if (!isInsufficientMemory(err, mod)) {
          await this.disposeAll();
          throw err;
        }
        this.log(`a context of ${size.min} tokens does not fit next to the model (${describeError(err)}); loading it again`);
      }
    }
    // Another model (or GPU choice): the old one goes; llama.cpp itself stays unless the GPU choice changes (llamaFor).
    await this.disposeModel();
    try {
      await this.loadWithFallback(mod, modelPath, gpu, size);
      this.loadedPath = modelPath;
      this.loadedGpu = gpu;
      this.lastError = null;
    } catch (err) {
      this.lastError = describeError(err);
      this.log(`local model failed to load: ${modelPath}: ${this.lastError}`);
      await this.disposeAll();
      throw err;
    }
  }

  /** The prompt's size in tokens: the model's own tokenizer once it is loaded, else an estimate (~3.2 characters a token). */
  private countTokens(messages: readonly AiMessage[]): number {
    let total = 0;
    for (const m of messages) {
      let n: number;
      try {
        n = this.model?.tokenize ? this.model.tokenize(m.content).length : Math.ceil(m.content.length / 3.2);
      } catch {
        n = Math.ceil(m.content.length / 3.2);
      }
      total += n + 8;
    }
    return total;
  }

  /** The chat session on the context's one sequence (kept, so the evaluated prefix is reused). */
  private chatSession(mod: LlamaModuleLike): SessionLike {
    if (!this.context) throw new Error("The local model is not loaded");
    this.sequence ??= this.context.getSequence();
    this.session ??= new mod.LlamaChatSession({ contextSequence: this.sequence });
    return this.session;
  }

  /** One reply for the conversation; requests run one at a time (one context). */
  complete(modelPath: string, gpu: "auto" | "off", messages: readonly AiMessage[], options: { schema?: JsonSchema; maxTokens?: number; temperature?: number; signal?: AbortSignal; onToken?: (text: string) => void }): Promise<{ text: string; cancelled: boolean }> {
    return this.enqueue(async () => {
      const { history, prompt } = toChatHistory(messages);
      const maxTokens = options.maxTokens ?? DEFAULT_LOCAL_MAX_TOKENS;
      await this.ensure(modelPath, gpu, contextSizeFor(this.countTokens(messages), maxTokens));
      // With the model's own tokenizer now: a prompt the estimate undercounted gets a bigger context.
      const promptTokens = this.countTokens(messages);
      const size = contextSizeFor(promptTokens, maxTokens);
      if (size.min > this.contextTokens()) await this.ensure(modelPath, gpu, size);
      const mod = await this.load();
      const llama = this.llama as LlamaLike;
      let grammar: GrammarLike | undefined;
      if (options.schema) {
        try {
          grammar = await llama.createGrammarForJsonSchema(toGrammarSchema(options.schema));
        } catch (err) {
          this.log(`grammar from schema failed (${err instanceof Error ? err.message : String(err)}); using the JSON grammar`);
          grammar = await jsonGrammar(llama);
        }
      }
      const session = this.chatSession(mod);
      session.setChatHistory(history);
      const t0 = Date.now();
      let firstMs: number | null = null;
      let chars = 0;
      const text = await session.prompt(prompt, {
        grammar,
        maxTokens,
        temperature: options.temperature ?? 0.4,
        signal: options.signal,
        stopOnAbortSignal: true,
        onTextChunk: (chunk) => {
          if (firstMs === null) firstMs = Date.now() - t0;
          chars += chunk.length;
          options.onToken?.(chunk);
        },
      });
      this.log(`local reply: ${promptTokens} prompt tokens (context ${this.contextTokens()}), first token after ${firstMs ?? "–"} ms, ${chars} characters in ${Date.now() - t0} ms${options.signal?.aborted ? " (stopped)" : ""}`);
      return { text, cancelled: options.signal?.aborted === true };
    });
  }

  /** --- desktop-ai-fix --- What llama.cpp runs on here (starts it when `start` and it is not running yet). */
  async runtime(gpu: "auto" | "off", start: boolean): Promise<LocalRuntime> {
    let mod: LlamaModuleLike;
    try {
      mod = await this.load();
    } catch (err) {
      return { imported: false, supported: null, backend: null, devices: [], vram: null, cpuCores: null, error: describeError(err) };
    }
    const supported = mod.getLlamaGpuTypes ? ((await mod.getLlamaGpuTypes("supported").catch(() => null))?.map((t) => (t === false ? "cpu" : String(t))) ?? null) : null;
    try {
      const llama = this.llama ?? (start ? await this.enqueue(() => this.llamaFor(mod, gpu === "off" ? false : "auto")) : null);
      if (!llama) return { imported: true, supported, backend: null, devices: [], vram: null, cpuCores: null, error: null };
      const devices = (await llama.getGpuDeviceNames?.().catch(() => [] as string[])) ?? [];
      const vram = (await llama.getVramState?.().catch(() => null)) ?? null;
      return { imported: true, supported, backend: llama.gpu || "cpu", devices, vram: vram ? { total: vram.total, free: vram.free } : null, cpuCores: llama.cpuMathCores ?? null, error: null };
    } catch (err) {
      return { imported: true, supported, backend: null, devices: [], vram: null, cpuCores: null, error: describeError(err) };
    }
  }

  /** --- desktop-ai-fix --- The status panel's model check: load it (with the context floor) and an 8-token grammar-held reply. */
  probe(modelPath: string, gpu: "auto" | "off"): Promise<LocalProbe> {
    return this.enqueue(async () => {
      const t0 = Date.now();
      try {
        await this.ensure(modelPath, gpu, contextSizeFor(0, 0));
        const loadMs = Date.now() - t0;
        const mod = await this.load();
        const llama = this.llama as LlamaLike;
        const grammar = await llama.createGrammarForJsonSchema({ type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }).catch(() => jsonGrammar(llama));
        const session = this.chatSession(mod);
        session.setChatHistory([]);
        const t1 = Date.now();
        const first: { ms: number | null } = { ms: null };
        const reply = await session.prompt('Answer with the JSON object {"ok": true} and nothing else.', { grammar, maxTokens: 8, temperature: 0, onTextChunk: () => void (first.ms ??= Date.now() - t1) });
        const replyMs = Date.now() - t1;
        let tokens = Math.max(1, Math.ceil(reply.length / 3.2));
        try {
          if (this.model?.tokenize) tokens = Math.max(1, this.model.tokenize(reply).length);
        } catch {
          /* the estimate stays */
        }
        // The generation speed, without the wait for the first token (reading the prompt – on a CPU most of an 8-token test).
        const afterFirstMs = first.ms === null ? 0 : replyMs - first.ms;
        const tokensPerSec = tokens > 1 && afterFirstMs > 0 ? ((tokens - 1) * 1000) / afterFirstMs : (tokens * 1000) / Math.max(1, replyMs);
        this.log(`model check: ${tokens} tokens in ${replyMs} ms, the first after ${first.ms ?? "–"} ms (${tokensPerSec.toFixed(1)} tokens/s), load ${loadMs} ms`);
        return { ok: true, backend: llama.gpu || "cpu", gpuLayers: this.model?.gpuLayers ?? null, contextSize: this.contextTokens(), loadMs, replyMs, firstTokenMs: first.ms, tokens, tokensPerSec: Math.round(tokensPerSec * 10) / 10, reply: reply.slice(0, 80), error: null };
      } catch (err) {
        return { ok: false, backend: this.llama ? this.llama.gpu || "cpu" : null, gpuLayers: null, contextSize: null, loadMs: Date.now() - t0, replyMs: 0, firstTokenMs: null, tokens: 0, tokensPerSec: null, reply: "", error: describeError(err) };
      }
    });
  }

  /** Unloads the model and llama.cpp after the request in progress (if any) – never under a running reply. */
  unload(): Promise<void> {
    return this.enqueue(() => this.disposeAll());
  }

  private async disposeContext(): Promise<void> {
    const { session, context } = this;
    this.session = null;
    this.sequence = null;
    this.context = null;
    try {
      session?.dispose({ disposeSequence: true });
    } catch {
      /* already gone */
    }
    await context?.dispose().catch(() => {});
  }

  private async disposeModel(): Promise<void> {
    await this.disposeContext();
    const { model } = this;
    this.model = null;
    this.loadedPath = null;
    this.loadedGpu = null;
    await model?.dispose().catch(() => {});
  }

  private async disposeAll(): Promise<void> {
    await this.disposeModel();
    const { llama } = this;
    this.llama = null;
    this.llamaGpu = null;
    this.gpuDevice = null;
    await llama?.dispose().catch(() => {});
  }
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
