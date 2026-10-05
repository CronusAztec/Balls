import type { DesktopApi } from "../contract";
import type { ChatModel } from "./agent";

/*
 * --- desktop-exe --- The page's chat model: the app's AI (the local GGUF model or the cloud provider the user set up) over
 * the bridge. Each call is one `ai.chat` request with its own id; the app streams its tokens back as `aiToken` events, and
 * aborting the signal cancels the request in the app.
 */

let counter = 0;

export function bridgeChatModel(bridge: Pick<DesktopApi, "ai" | "on">): ChatModel {
  return {
    async complete(messages, options) {
      const requestId = `ai-${Date.now().toString(36)}-${++counter}`;
      const off = bridge.on("aiToken", (event) => {
        if (event.requestId === requestId) options.onToken?.(event.text);
      });
      const onAbort = () => void bridge.ai.cancel(requestId);
      options.signal?.addEventListener("abort", onAbort);
      try {
        const result = await bridge.ai.chat({ requestId, messages, schema: options.schema as Record<string, unknown> | undefined, maxTokens: options.maxTokens, temperature: options.temperature, ...(options.task ? { task: options.task } : {}) }); // --- desktop-ai-fix --- (the job, for the app's log)
        if (result.cancelled || options.signal?.aborted) throw new DOMException("cancelled", "AbortError");
        return result.text;
      } finally {
        off();
        options.signal?.removeEventListener("abort", onAbort);
      }
    },
  };
}
