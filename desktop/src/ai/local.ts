import type { AiMessage } from "@/lib/desktop/contract";
import type { JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { toGrammarSchema } from "./gbnf";

/*
 * --- desktop-exe --- The local model: llama.cpp through node-llama-cpp, loaded on first use (the module is imported lazily,
 * so the app starts – and works without AI – even where its native binary cannot load). `getLlama({ gpu: "auto" })`
 * picks CUDA, Vulkan or Metal when the GPU and driver allow and falls back to the CPU; the model offloads as many layers
 * as fit in VRAM (`gpuLayers: "auto"`). Every reply is constrained by a grammar built from the reply's JSON schema (or,
 * when the schema is beyond the grammar builder, by plain JSON), streamed token by token and cancellable.
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
}
interface ModelLike {
  readonly gpuLayers: number;
  createContext(options: { contextSize?: number | { min?: number; max?: number } }): Promise<ContextLike>;
  dispose(): Promise<void>;
}
interface LlamaLike {
  readonly gpu: string | false;
  loadModel(options: { modelPath: string; gpuLayers?: "auto" | number }): Promise<ModelLike>;
  createGrammarForJsonSchema(schema: unknown): Promise<GrammarLike>;
  getGrammarFor(type: "json"): Promise<GrammarLike>;
  /** A grammar from GBNF text (the plain-JSON fallback inside the asar archive). */
  createGrammar?(options: { grammar: string; trimWhitespaceSuffix?: boolean }): Promise<GrammarLike>;
  dispose(): Promise<void>;
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
  getLlama(options: { gpu: "auto" | false }): Promise<LlamaLike>;
  LlamaChatSession: new (options: { contextSequence: SequenceLike }) => SessionLike;
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

/** The chat history node-llama-cpp keeps (all but the last user message, which is the prompt). */
export function toChatHistory(messages: readonly AiMessage[]): { history: HistoryItem[]; prompt: string } {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") throw new Error("The last message must be the user's");
  const history: HistoryItem[] = [];
  for (const m of messages.slice(0, -1)) {
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
}

export class LocalModelRunner {
  private llama: LlamaLike | null = null;
  private model: ModelLike | null = null;
  private context: ContextLike | null = null;
  private loadedPath: string | null = null;
  private loadedGpu: "auto" | "off" | null = null;
  private loading: Promise<void> | null = null;
  private lastError: string | null = null;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private readonly load: () => Promise<LlamaModuleLike>, private readonly log: (message: string) => void = () => {}) {}

  status(): LocalStatus {
    return { model: this.loadedPath, loaded: this.model !== null, backend: this.llama ? (this.llama.gpu || "cpu") : null, gpuLayers: this.model ? this.model.gpuLayers : null, error: this.lastError };
  }

  private async ensure(modelPath: string, gpu: "auto" | "off"): Promise<void> {
    if (this.model && this.loadedPath === modelPath && this.loadedGpu === gpu) return;
    if (this.loading) await this.loading.catch(() => {});
    if (this.model && this.loadedPath === modelPath && this.loadedGpu === gpu) return;
    this.loading = (async () => {
      await this.unload();
      try {
        const mod = await this.load();
        this.llama = await mod.getLlama({ gpu: gpu === "off" ? false : "auto" });
        this.model = await this.llama.loadModel({ modelPath, gpuLayers: gpu === "off" ? 0 : "auto" });
        this.context = await this.model.createContext({ contextSize: { max: LOCAL_CONTEXT_SIZE } });
        this.loadedPath = modelPath;
        this.loadedGpu = gpu;
        this.lastError = null;
        this.log(`local model loaded: ${modelPath} (backend ${this.llama.gpu || "cpu"}, ${this.model.gpuLayers} GPU layers)`);
      } catch (err) {
        this.lastError = err instanceof Error ? err.message : String(err);
        await this.unload();
        throw err;
      }
    })();
    try {
      await this.loading;
    } finally {
      this.loading = null;
    }
  }

  /** One reply for the conversation; requests run one at a time (one context). */
  complete(modelPath: string, gpu: "auto" | "off", messages: readonly AiMessage[], options: { schema?: JsonSchema; maxTokens?: number; temperature?: number; signal?: AbortSignal; onToken?: (text: string) => void }): Promise<{ text: string; cancelled: boolean }> {
    const run = async () => {
      await this.ensure(modelPath, gpu);
      const llama = this.llama as LlamaLike;
      const context = this.context as ContextLike;
      const mod = await this.load();
      let grammar: GrammarLike | undefined;
      if (options.schema) {
        try {
          grammar = await llama.createGrammarForJsonSchema(toGrammarSchema(options.schema));
        } catch (err) {
          this.log(`grammar from schema failed (${err instanceof Error ? err.message : String(err)}); using the JSON grammar`);
          grammar = await jsonGrammar(llama);
        }
      }
      const sequence = context.getSequence();
      const session = new mod.LlamaChatSession({ contextSequence: sequence });
      try {
        const { history, prompt } = toChatHistory(messages);
        session.setChatHistory(history);
        const text = await session.prompt(prompt, { grammar, maxTokens: options.maxTokens ?? 1500, temperature: options.temperature ?? 0.4, signal: options.signal, stopOnAbortSignal: true, onTextChunk: options.onToken });
        return { text, cancelled: options.signal?.aborted === true };
      } finally {
        session.dispose({ disposeSequence: true });
      }
    };
    const next = this.busy.then(run, run);
    this.busy = next.catch(() => {});
    return next;
  }

  async unload(): Promise<void> {
    const { context, model, llama } = this;
    this.context = null;
    this.model = null;
    this.llama = null;
    this.loadedPath = null;
    this.loadedGpu = null;
    await context?.dispose().catch(() => {});
    await model?.dispose().catch(() => {});
    await llama?.dispose().catch(() => {});
  }
}
