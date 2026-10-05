import Anthropic from "@anthropic-ai/sdk";
import { CLOUD_DEFAULTS, type AiMessage } from "@/lib/desktop/contract";
import { foldSystemNotes } from "@/lib/desktop/ai/conversation"; // --- desktop-ai-fix ---
import { describeError } from "@/lib/desktop/errors"; // --- desktop-ai-fix ---

export { CLOUD_DEFAULTS };

/*
 * --- desktop-exe --- The optional cloud provider: Anthropic (the official SDK, streaming Messages API) or any
 * OpenAI-compatible endpoint (streamed chat completions over SSE – OpenAI itself, or a local server such as Ollama or LM
 * Studio). The API key is the one the user typed; the main process keeps it encrypted (secrets.ts) and it never reaches
 * the page. Replies are plain text; the page's validator checks the JSON in them like a local model's.
 *
 * --- desktop-ai-fix --- Both go over the `fetch` main.ts hands in – Electron's net.fetch, Chromium's network stack with the
 * system proxy and the Windows certificate store, instead of Node's fetch, which failed with a bare "fetch failed" behind an
 * antivirus HTTPS scan or a company proxy. A network failure says what happened (describeError: the cause codes explained),
 * and the app's notes later in the conversation (system messages) become user turns (conversation.ts).
 */

/** Anthropic models that take the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

export interface CloudRequest {
  messages: readonly AiMessage[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  onToken?: (text: string) => void;
}

/** The leading system messages become the system prompt; the rest keep their order (--- desktop-ai-fix --- a later system note is a user turn). */
export function splitSystem(messages: readonly AiMessage[]): { system: string; turns: { role: "user" | "assistant"; content: string }[] } {
  const folded = foldSystemNotes(messages);
  const system = folded.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const turns = folded.filter((m) => m.role !== "system").map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return { system, turns };
}

/** The minimal slice of the SDK the completer uses (a fake in tests). */
export interface AnthropicLike {
  beta: {
    messages: {
      stream(body: Record<string, unknown>, options?: { signal?: AbortSignal }): {
        on(event: "text", listener: (text: string) => void): unknown;
        finalMessage(): Promise<{ stop_reason: string | null; stop_details?: { category?: string | null } | null; content: { type: string; text?: string }[] }>;
      };
    };
  };
}

export function anthropicBody(model: string, request: CloudRequest): Record<string, unknown> {
  const { system, turns } = splitSystem(request.messages);
  const body: Record<string, unknown> = {
    model,
    // Adaptive thinking counts against max_tokens on the current models: leave room for it and the JSON answer.
    max_tokens: Math.max(16000, request.maxTokens ?? 0),
    messages: turns,
    output_config: { effort: "medium" },
  };
  if (system) body.system = system;
  if (FALLBACK_MODELS.has(model)) {
    body.betas = ["server-side-fallback-2026-07-01"];
    body.fallbacks = "default";
  }
  return body;
}

export async function completeAnthropic(client: AnthropicLike, model: string, request: CloudRequest): Promise<string> {
  const stream = client.beta.messages.stream(anthropicBody(model, request), { signal: request.signal });
  if (request.onToken) stream.on("text", request.onToken);
  const message = await stream.finalMessage();
  if (message.stop_reason === "refusal") throw new Error(`The cloud model declined the request${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}`);
  return message.content.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
}

/** The SDK's client; --- desktop-ai-fix --- over `fetchImpl` when given (main.ts: Electron's net.fetch). */
export function anthropicClient(apiKey: string, baseUrl: string, fetchImpl?: typeof fetch): AnthropicLike {
  return new Anthropic({ apiKey, baseURL: baseUrl || CLOUD_DEFAULTS.anthropic.baseUrl, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) }) as unknown as AnthropicLike;
}

/* ------------------------------------------------------------------ OpenAI-compatible */

/** --- desktop-ai-fix --- The host of a URL for a message ("" when it is not one). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** Splits an SSE buffer into complete `data:` payloads and the unfinished rest. */
export function parseSse(buffer: string): { data: string[]; rest: string } {
  const data: string[] = [];
  const blocks = buffer.split(/\r?\n\r?\n/);
  const rest = blocks.pop() ?? "";
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart());
    if (lines.length) data.push(lines.join("\n"));
  }
  return { data, rest };
}

export function openAiBody(model: string, request: CloudRequest): Record<string, unknown> {
  // --- desktop-ai-fix --- a late system note as a user turn: some local servers' chat templates reject a system message mid-conversation
  return { model, messages: foldSystemNotes(request.messages).map((m) => ({ role: m.role, content: m.content })), stream: true, temperature: request.temperature ?? 0.4, max_tokens: request.maxTokens ?? 1500 };
}

export async function completeOpenAi(fetchImpl: typeof fetch, baseUrl: string, apiKey: string, model: string, request: CloudRequest): Promise<string> {
  const url = `${(baseUrl || CLOUD_DEFAULTS.openai.baseUrl).replace(/\/+$/, "")}/chat/completions`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify(openAiBody(model, request)),
      signal: request.signal,
    });
  } catch (err) {
    if (request.signal?.aborted) throw err;
    // --- desktop-ai-fix --- "fetch failed" alone said nothing: the cause codes, explained, and where it was going
    throw new Error(`Could not reach the cloud provider at ${hostOf(url)}: ${describeError(err)}`, { cause: err });
  }
  if (!response.ok || !response.body) {
    const detail = await response.text().catch(() => "");
    throw new Error(`The cloud provider answered HTTP ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSse(buffer);
    buffer = parsed.rest;
    for (const payload of parsed.data) {
      if (payload === "[DONE]") return text;
      try {
        const json = JSON.parse(payload) as { choices?: { delta?: { content?: string } }[]; error?: { message?: string } };
        if (json.error) throw new Error(json.error.message ?? "provider error");
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          request.onToken?.(delta);
        }
      } catch (err) {
        if (err instanceof SyntaxError) continue;
        throw err;
      }
    }
  }
  return text;
}
