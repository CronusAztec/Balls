import type { DesktopApi } from "@/lib/desktop/contract";
import type { ClipEditSpec } from "@/lib/clipEdit/spec";
import { snapClipEdit, type ClipBeats } from "@/lib/clipEdit/propose";
import { runAgent } from "@/lib/desktop/ai/agent";
import { bridgeChatModel } from "@/lib/desktop/ai/bridgeModel";
import { clipEditTask } from "@/lib/desktop/ai/studio";

/*
 * --- ai-cut --- "Suggest with AI" in the Clip editor, on the Windows app: the cut task (lib/desktop/ai/studio.ts
 * `clipEditTask`) run on the app's model over the bridge, for one finished clip's beats (lib/clipEdit/propose.ts – from the
 * plan it was rendered from, or only its length, mode and hook for an older Library file). The answer comes back as the
 * editor's spec, snapped once more against the file and with the user's address (`base.url`): the model never writes it.
 * The app serialises requests, so a suggestion during a panel run simply waits its turn.
 */

/**
 * A cut proposed by the app's AI for a clip of `beats`, starting from `base` (the user's remembered spec) with `ideas` as
 * hook examples (the dialog's own). Throws the loop's error (the model's failure, "cancelled" on the signal).
 */
export async function suggestCut(bridge: Pick<DesktopApi, "ai" | "on">, locale: string, beats: ClipBeats, base: ClipEditSpec, ideas: readonly string[], request = "", signal?: AbortSignal): Promise<{ spec: ClipEditSpec; summary: string }> {
  const out = await runAgent(bridgeChatModel(bridge), clipEditTask(request, { locale, beats, base, ideas }), { signal });
  if (!out.ok) throw new Error(out.error);
  return { spec: snapClipEdit(out.result, beats, base), summary: out.result.summary };
}
