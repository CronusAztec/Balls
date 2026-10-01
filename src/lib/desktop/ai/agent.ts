import type { AiMessage } from "../contract";
import { extractJson, validateJson, type JsonSchema } from "./jsonSchema";

/*
 * --- desktop-exe --- The AI studio's tool-call loop. Pure: the model and the tools are injected, so the loop is tested
 * with a scripted model (tests/desktopAi.test.ts) and runs unchanged with the app's local model or a cloud one.
 *
 * Protocol: every reply of the model is ONE JSON object – either a tool call `{"action":"tool","tool":…,"args":{…}}` or the
 * answer `{"action":"final","result":{…}}` (an optional short "note" is allowed). Each reply is parsed and validated: the
 * envelope, the tool's argument schema and its own checks, the final answer's schema and the task's checks. An invalid
 * reply is never acted on – the errors go back to the model and it tries again, at most `maxRetries` times in a row;
 * then the run fails and nothing is applied. A tool's result (or its error) goes back as the next message, and the loop
 * goes on until a valid final answer or `maxSteps` model turns.
 */

export interface ChatOptions {
  /** The JSON schema of the reply (the app turns it into a grammar for the local model). */
  schema?: JsonSchema;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
}

/** A chat model: the messages so far in, the reply text out. */
export interface ChatModel {
  complete(messages: AiMessage[], options: ChatOptions): Promise<string>;
}

export interface ToolContext {
  signal?: AbortSignal;
  /** A line of progress for the panel ("searching seeds 12/40"). */
  progress: (text: string) => void;
}

export interface AgentTool {
  name: string;
  description: string;
  args: JsonSchema;
  /** Checks beyond the schema (an id that must exist…): error messages, empty when fine. */
  check?: (args: Record<string, unknown>) => string[];
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface AgentTask<F> {
  system: string;
  user: string;
  tools: readonly AgentTool[];
  /** The schema of the final answer (`result`). */
  final: JsonSchema;
  /** Checks of the final answer beyond the schema. */
  checkFinal?: (result: F) => string[];
  maxSteps?: number;
  maxRetries?: number;
  maxTokens?: number;
  temperature?: number;
}

export type AgentEvent =
  | { type: "turn"; step: number }
  | { type: "token"; text: string }
  | { type: "invalid"; attempt: number; errors: string[] }
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "progress"; text: string }
  | { type: "toolResult"; name: string; result: unknown }
  | { type: "toolError"; name: string; error: string }
  | { type: "final"; result: unknown };

export type AgentOutcome<F> = { ok: true; result: F; steps: number; retries: number } | { ok: false; error: string; cancelled: boolean; steps: number; retries: number };

export const DEFAULT_MAX_STEPS = 8;
export const DEFAULT_MAX_RETRIES = 3;
/** Tool results are cut to this many characters before they go back to the model. */
export const MAX_TOOL_RESULT_CHARS = 4000;

/** The reply envelope: a tool call or the final answer, for this task's tools and answer. */
export function replySchema(tools: readonly AgentTool[], final: JsonSchema): JsonSchema {
  const note: JsonSchema = { type: "string", maxLength: 400 };
  const alternatives: JsonSchema[] = [
    {
      type: "object",
      properties: { action: { const: "final" }, note, result: final },
      required: ["action", "result"],
      additionalProperties: false,
    },
  ];
  for (const tool of tools) {
    alternatives.push({
      type: "object",
      properties: { action: { const: "tool" }, note, tool: { const: tool.name }, args: tool.args },
      required: ["action", "tool", "args"],
      additionalProperties: false,
    });
  }
  return alternatives.length === 1 ? alternatives[0] : { oneOf: alternatives };
}

/** The protocol and the tools, appended to the task's system prompt. */
export function protocolPrompt(tools: readonly AgentTool[], final: JsonSchema): string {
  const lines = [
    "Reply with ONE JSON object and nothing else.",
    tools.length
      ? 'To use a tool: {"action":"tool","tool":"<name>","args":{...},"note":"<why, one short sentence>"}. You will get its result, then reply again.'
      : "You have no tools.",
    'To answer: {"action":"final","result":{...}} where result follows this JSON schema:',
    JSON.stringify(final),
  ];
  if (tools.length) {
    lines.push("Tools:");
    for (const tool of tools) lines.push(`- ${tool.name}: ${tool.description} Args schema: ${JSON.stringify(tool.args)}`);
  }
  return lines.join("\n");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…(cut)` : text;
}

/** A normalised reply: a flat shape some models produce ("tool":"", "result":null next to each other) folded into the envelope `replySchema` checks. */
export function normaliseReply(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  const note = typeof v.note === "string" && v.note ? { note: v.note } : {};
  if (v.action === "final") return { action: "final", ...note, result: v.result };
  if (v.action === "tool") return { action: "tool", ...note, tool: v.tool, args: v.args ?? {} };
  return value;
}

/** Runs the loop. Never throws for the model's mistakes: the outcome says what went wrong. */
export async function runAgent<F>(model: ChatModel, task: AgentTask<F>, hooks: { onEvent?: (e: AgentEvent) => void; signal?: AbortSignal } = {}): Promise<AgentOutcome<F>> {
  const { onEvent, signal } = hooks;
  const emit = (e: AgentEvent) => onEvent?.(e);
  const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxRetries = task.maxRetries ?? DEFAULT_MAX_RETRIES;
  // The envelope is also what the model is constrained to (the app turns it into a llama.cpp grammar; a cloud model gets
  // it in the prompt) – replies are validated against it all the same.
  const envelope = replySchema(task.tools, task.final);
  const messages: AiMessage[] = [
    { role: "system", content: `${task.system}\n\n${protocolPrompt(task.tools, task.final)}` },
    { role: "user", content: task.user },
  ];
  let steps = 0;
  let retries = 0;
  let invalidInARow = 0;
  const cancelled = () => ({ ok: false as const, error: "cancelled", cancelled: true, steps, retries });
  while (steps < maxSteps) {
    if (signal?.aborted) return cancelled();
    steps++;
    emit({ type: "turn", step: steps });
    let text: string;
    try {
      text = await model.complete(messages, { schema: envelope, onToken: (t) => emit({ type: "token", text: t }), signal, maxTokens: task.maxTokens, temperature: task.temperature });
    } catch (err) {
      if (signal?.aborted) return cancelled();
      return { ok: false, error: `model: ${err instanceof Error ? err.message : String(err)}`, cancelled: false, steps, retries };
    }
    if (signal?.aborted) return cancelled();
    messages.push({ role: "assistant", content: text });

    // 1. Parse and check the reply – nothing is run or applied unless it passes.
    const parsed = extractJson(text);
    let errors: string[] = [];
    let reply: Record<string, unknown> | null = null;
    if (!parsed.ok) errors = [parsed.error];
    else {
      const value = normaliseReply(parsed.value);
      errors = validateJson(envelope, value);
      if (errors.length === 0) {
        reply = value as Record<string, unknown>;
        if (reply.action === "tool") {
          const tool = task.tools.find((t) => t.name === reply?.tool);
          errors = tool?.check ? tool.check(reply.args as Record<string, unknown>) : [];
        } else if (task.checkFinal) errors = task.checkFinal(reply.result as F);
      }
    }
    if (errors.length > 0 || !reply) {
      retries++;
      invalidInARow++;
      emit({ type: "invalid", attempt: invalidInARow, errors });
      if (invalidInARow > maxRetries) return { ok: false, error: `the model's replies were invalid ${invalidInARow} times in a row: ${errors.slice(0, 3).join("; ")}`, cancelled: false, steps, retries };
      messages.push({ role: "user", content: `Your reply was not valid:\n- ${errors.slice(0, 8).join("\n- ")}\nReply again with ONE JSON object in the required format.` });
      continue;
    }
    invalidInARow = 0;

    // 2. The final answer.
    if (reply.action === "final") {
      emit({ type: "final", result: reply.result });
      return { ok: true, result: reply.result as F, steps, retries };
    }

    // 3. A tool call: run it, hand its result (or error) back.
    const tool = task.tools.find((t) => t.name === reply?.tool) as AgentTool;
    const args = (reply.args ?? {}) as Record<string, unknown>;
    emit({ type: "tool", name: tool.name, args });
    try {
      const result = await tool.run(args, { signal, progress: (text) => emit({ type: "progress", text }) });
      if (signal?.aborted) return cancelled();
      emit({ type: "toolResult", name: tool.name, result });
      messages.push({ role: "user", content: `Result of ${tool.name}: ${clip(JSON.stringify(result), MAX_TOOL_RESULT_CHARS)}` });
    } catch (err) {
      if (signal?.aborted) return cancelled();
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "toolError", name: tool.name, error: message });
      messages.push({ role: "user", content: `${tool.name} failed: ${clip(message, 500)}. Change the arguments or answer without it.` });
    }
  }
  return { ok: false, error: `no final answer after ${maxSteps} turns`, cancelled: false, steps, retries };
}
