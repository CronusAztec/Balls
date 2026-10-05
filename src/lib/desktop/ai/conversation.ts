import type { AiMessage } from "../contract";

/*
 * --- desktop-ai-fix --- The conversation as each transport needs it. The agent sends the app's own notes (a reply that
 * failed the checks, what to fix) as `system` messages after the conversation has started – a note from the app, not a
 * user's words. Chat templates and APIs disagree about system messages mid-conversation (Anthropic takes one system prompt;
 * some OpenAI-compatible servers' templates reject a late system message; node-llama-cpp's prompt must end with the user's
 * turn), so every transport folds them the same way: the leading system messages stay the system prompt, a later one
 * becomes a user turn (merged with a neighbouring user turn). The same conversation therefore renders to the same tokens on
 * every turn, which keeps the local model's evaluated prefix reusable.
 */

/** The leading system messages, then the rest with every later system note turned into (or merged with) a user turn. */
export function foldSystemNotes(messages: readonly AiMessage[]): AiMessage[] {
  const out: AiMessage[] = [];
  let started = false;
  for (const m of messages) {
    if (!started && m.role === "system") {
      out.push({ role: "system", content: m.content });
      continue;
    }
    started = true;
    const role = m.role === "system" ? "user" : m.role;
    const last = out[out.length - 1];
    if (role === "user" && last && last.role === "user") last.content = `${last.content}\n\n${m.content}`;
    else out.push({ role, content: m.content });
  }
  return out;
}
