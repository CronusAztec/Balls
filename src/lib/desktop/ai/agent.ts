import type { AiMessage } from "../contract";
import { extractJson, validateJson, type JsonSchema } from "./jsonSchema";
import { describeError } from "../errors"; // --- desktop-ai-fix --- the IPC prefix stripped, the cause codes explained

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
 *
 * --- desktop-ai-fix --- What 1.0.2's small local models got wrong, and what the loop does about it now:
 *  - The reply envelope is rebuilt on every turn from the run's state (`AgentTask.turn`): Make videos offers no answer until
 *    plan_clips has returned plans, then its planIds are an enum of those plans – a grammar-held model can no longer answer
 *    on turn 1 with invented ids.
 *  - A task's normaliser fixes obvious slips before the checks (`normaliseFinal`, `AgentTool.normalise`: hashtags without
 *    "#", a slugless file name…), so they cost no retry.
 *  - A retry differs from the try before: the errors come as the app's note (a `system` message, which every transport
 *    folds into the next user turn – conversation.ts) with the turn's hint, and the temperature goes up 0.1 per invalid
 *    reply in a row (identical replies kept repeating at a fixed temperature).
 *  - A tool may describe its arguments in a line (`argsHint`) instead of printing its JSON schema into the prompt.
 */

export interface ChatOptions {
  /** The JSON schema of the reply (the app turns it into a grammar for the local model). */
  schema?: JsonSchema;
  onToken?: (text: string) => void;
  signal?: AbortSignal;
  maxTokens?: number;
  temperature?: number;
  /** --- desktop-ai-fix --- The job ("videos", "copy"…): the app logs it and keeps it with the last error. */
  task?: string;
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
  /** --- desktop-ai-fix --- The arguments in a line for the prompt, instead of their JSON schema (a big oneOf costs thousands of prompt tokens; the grammar and the checks still use `args`). */
  argsHint?: string;
  /** --- desktop-ai-fix --- Fixes obvious slips in the arguments before they are checked. */
  normalise?: (args: Record<string, unknown>) => Record<string, unknown>;
}

/** --- desktop-ai-fix --- What the model may answer on one turn. */
export interface AgentTurn {
  /** The tools it may call (default: all of the task's). */
  tools?: readonly AgentTool[];
  /** The answer's schema this turn; null: no answer yet (default: the task's `final`). */
  final?: JsonSchema | null;
  /** One line added to the note after an invalid reply ("call plan_clips first"). */
  hint?: string;
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
  /** --- desktop-ai-fix --- The job's name, sent with every request (the app logs it). */
  name?: string;
  /** --- desktop-ai-fix --- The envelope of each turn from the run's state (default: every tool and the answer, every turn). */
  turn?: () => AgentTurn;
  /** --- desktop-ai-fix --- Fixes the answer's obvious slips before the checks (normalise.ts). */
  normaliseFinal?: (result: unknown) => unknown;
  /** --- desktop-ai-fix --- The answer's shape in a line for the prompt, instead of its JSON schema (the grammar and the checks still use `final`). */
  finalHint?: string;
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
/** --- desktop-ai-fix --- The transports' temperature when a task sets none, the step a retry adds and the ceiling. */
export const DEFAULT_TEMPERATURE = 0.4;
export const RETRY_TEMPERATURE_STEP = 0.1;
export const MAX_TEMPERATURE = 1.5;
/** Tool results are cut to this many characters before they go back to the model. */
export const MAX_TOOL_RESULT_CHARS = 4000;

/** The reply envelope: a tool call or the final answer, for this task's tools and answer (--- desktop-ai-fix --- `final` null: tool calls only). */
export function replySchema(tools: readonly AgentTool[], final: JsonSchema | null): JsonSchema {
  const note: JsonSchema = { type: "string", maxLength: 400 };
  const alternatives: JsonSchema[] = [];
  if (final || tools.length === 0) {
    alternatives.push({
      type: "object",
      properties: { action: { const: "final" }, note, result: final ?? {} },
      required: ["action", "result"],
      additionalProperties: false,
    });
  }
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

/** The protocol and the tools, appended to the task's system prompt (--- desktop-ai-fix --- `finalHint`: the answer's shape in a line). */
export function protocolPrompt(tools: readonly AgentTool[], final: JsonSchema, finalHint?: string): string {
  const lines = [
    "Reply with ONE JSON object and nothing else.",
    tools.length
      ? 'To use a tool: {"action":"tool","tool":"<name>","args":{...},"note":"<why, one short sentence>"}. You will get its result, then reply again.'
      : "You have no tools.",
    ...(finalHint ? [`To answer: {"action":"final","result":${finalHint}}`] : ['To answer: {"action":"final","result":{...}} where result follows this JSON schema:', JSON.stringify(final)]),
  ];
  if (tools.length) {
    lines.push("Tools:");
    for (const tool of tools) lines.push(`- ${tool.name}: ${tool.description} ${tool.argsHint ? `Args: ${tool.argsHint}` : `Args schema: ${JSON.stringify(tool.args)}`}`); // --- desktop-ai-fix --- (argsHint)
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

/** --- desktop-ai-fix --- The task's normalisers on a reply in the envelope's shape (the answer's, or the called tool's arguments). */
function normaliseFields(value: unknown, task: Pick<AgentTask<unknown>, "normaliseFinal">, tools: readonly AgentTool[]): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const v = value as Record<string, unknown>;
  if (v.action === "final" && task.normaliseFinal) return { ...v, result: task.normaliseFinal(v.result) };
  if (v.action === "tool") {
    const tool = tools.find((t) => t.name === v.tool);
    if (tool?.normalise && v.args && typeof v.args === "object" && !Array.isArray(v.args)) return { ...v, args: tool.normalise(v.args as Record<string, unknown>) };
  }
  return value;
}

/** Runs the loop. Never throws for the model's mistakes: the outcome says what went wrong. */
export async function runAgent<F>(model: ChatModel, task: AgentTask<F>, hooks: { onEvent?: (e: AgentEvent) => void; signal?: AbortSignal } = {}): Promise<AgentOutcome<F>> {
  const { onEvent, signal } = hooks;
  const emit = (e: AgentEvent) => onEvent?.(e);
  const maxSteps = task.maxSteps ?? DEFAULT_MAX_STEPS;
  const maxRetries = task.maxRetries ?? DEFAULT_MAX_RETRIES;
  // The envelope is also what the model is constrained to (the app turns it into a llama.cpp grammar; a cloud model gets
  // it in the prompt) – replies are validated against it all the same. --- desktop-ai-fix --- rebuilt every turn (`task.turn`);
  // the prompt keeps describing every tool and the answer, so the conversation's prefix stays the same from turn to turn.
  const messages: AiMessage[] = [
    { role: "system", content: `${task.system}\n\n${protocolPrompt(task.tools, task.final, task.finalHint)}` },
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
    // --- desktop-ai-fix --- this turn's envelope, and a temperature that rises with every invalid reply in a row
    const spec = task.turn?.() ?? {};
    const turnTools = spec.tools ?? task.tools;
    const turnFinal = spec.final === undefined ? task.final : spec.final;
    const envelope = replySchema(turnTools, turnFinal);
    const temperature = invalidInARow > 0 ? Math.min(MAX_TEMPERATURE, (task.temperature ?? DEFAULT_TEMPERATURE) + RETRY_TEMPERATURE_STEP * invalidInARow) : task.temperature;
    let text: string;
    try {
      text = await model.complete(messages, { schema: envelope, onToken: (t) => emit({ type: "token", text: t }), signal, maxTokens: task.maxTokens, temperature, ...(task.name ? { task: task.name } : {}) });
    } catch (err) {
      if (signal?.aborted) return cancelled();
      return { ok: false, error: `model: ${describeError(err)}`, cancelled: false, steps, retries };
    }
    if (signal?.aborted) return cancelled();
    messages.push({ role: "assistant", content: text });

    // 1. Parse and check the reply – nothing is run or applied unless it passes.
    const parsed = extractJson(text);
    let errors: string[] = [];
    let reply: Record<string, unknown> | null = null;
    if (!parsed.ok) errors = [parsed.error];
    else {
      const value = normaliseFields(normaliseReply(parsed.value), task, turnTools);
      errors = validateJson(envelope, value);
      if (errors.length === 0) {
        reply = value as Record<string, unknown>;
        if (reply.action === "tool") {
          const tool = turnTools.find((t) => t.name === reply?.tool);
          errors = tool?.check ? tool.check(reply.args as Record<string, unknown>) : [];
        } else if (task.checkFinal) errors = task.checkFinal(reply.result as F);
      }
    }
    if (errors.length > 0 || !reply) {
      retries++;
      invalidInARow++;
      emit({ type: "invalid", attempt: invalidInARow, errors });
      if (invalidInARow > maxRetries) return { ok: false, error: `the model's replies were invalid ${invalidInARow} times in a row: ${errors.slice(0, 3).join("; ")}`, cancelled: false, steps, retries };
      // --- desktop-ai-fix --- the app's note (a system message, folded into the next user turn by every transport), with the turn's hint
      messages.push({ role: "system", content: `Your reply was not valid:\n- ${errors.slice(0, 8).join("\n- ")}\n${spec.hint ? `${spec.hint}\n` : ""}Reply again with ONE JSON object in the required format – not the same reply as before.` });
      continue;
    }
    invalidInARow = 0;

    // 2. The final answer.
    if (reply.action === "final") {
      emit({ type: "final", result: reply.result });
      return { ok: true, result: reply.result as F, steps, retries };
    }

    // 3. A tool call: run it, hand its result (or error) back.
    const tool = turnTools.find((t) => t.name === reply?.tool) as AgentTool; // --- desktop-ai-fix --- (this turn's version of the tool)
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
