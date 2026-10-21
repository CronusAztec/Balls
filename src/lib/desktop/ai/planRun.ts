import type { AutopilotSettings, PostizChannel, SocialProposalInput, SocialQueueItem } from "../contract";
import type { SocialBridge } from "../capabilities"; // --- old-bridge --- (an app with Postiz, the queue and the autopilot)
import { plannerChannels, proposalsLeftToday, toQueueProposals, unpostedClips } from "../autopilot";
import { runAgent, type AgentEvent, type ChatModel } from "./agent";
import { planTask, type PlanOutcome, type PlanResult } from "./plan";
import { selectPlaybookContext } from "./playbookContext";

/*
 * --- social-autopilot --- One planning run from the page: the inputs gathered over the bridge (the Library, the queue, the
 * audit log, the channels, the autopilot's settings, the last two weeks of outcomes, the playbook), the "plan" task run on
 * the app's model through the tool-call loop, and the answer turned into queue proposals. Used by the AI panel's "Plan
 * posts" job (streaming into the panel) and by the autopilot's 15-minute trigger (silently). Neither posts: the proposals go
 * to the queue as `proposed`.
 */

export type PlanRunOutcome = { ok: true; result: PlanResult; proposals: SocialProposalInput[]; channels: PostizChannel[] } | { ok: false; reason: "noChannels" | "noClips" | "dayFull"; error: null } | { ok: false; reason: "model"; error: string };

export interface PlanRunOptions {
  locale: string;
  signal?: AbortSignal;
  onEvent?: (e: AgentEvent) => void;
  /** The playbook text (read once per session by the caller). */
  playbook: string;
  now?: number;
  /** The autopilot's settings when the caller has them (else read over the bridge). */
  settings?: AutopilotSettings;
  queue?: SocialQueueItem[];
  /** "Propose now" ignores today's budget being spent (at least one proposal is made). */
  ignoreBudget?: boolean;
  /** --- ai-cut --- The render queue's jobs whose TikTok cut is still being made (renderQueue.ts cutsPending): their video waits. */
  pendingCuts?: readonly string[];
}

export async function runPlanner(bridge: Pick<SocialBridge, "library" | "social" | "ai">, model: ChatModel, options: PlanRunOptions): Promise<PlanRunOutcome> {
  const now = options.now ?? Date.now();
  const settings = options.settings ?? (await bridge.social.autopilot.get());
  const [library, queue, audit, allChannels, posts] = await Promise.all([bridge.library.list(), options.queue ?? bridge.social.queue.list(), bridge.social.audit(500), bridge.social.channels.list(), bridge.social.posts(14).catch(() => [])]);
  const channels = plannerChannels(settings, allChannels);
  if (channels.length === 0) return { ok: false, reason: "noChannels", error: null };
  const clips = unpostedClips(library, queue, audit, { preferCut: channels.some((c) => c.platform === "tiktok"), pendingCuts: options.pendingCuts }); // --- ai-cut --- a master and its TikTok cut are one clip
  if (clips.length === 0) return { ok: false, reason: "noClips", error: null };
  const left = options.ignoreBudget ? Math.max(1, proposalsLeftToday(settings, queue, now)) : proposalsLeftToday(settings, queue, now);
  if (left === 0) return { ok: false, reason: "dayFull", error: null };
  const outcomes: PlanOutcome[] = posts
    .filter((p) => p.channel && (p.state === "PUBLISHED" || p.state === "ERROR"))
    .map((p) => ({ channelId: p.channel!.id, platform: p.channel!.platform, state: p.state, at: p.publishDate, text: p.content }));
  const playbook = selectPlaybookContext(options.playbook, `best time to post schedule ${channels.map((c) => c.platform).join(" ")} ${clips.map((c) => c.title).join(" ")}`, 3000);
  const task = planTask({ locale: options.locale, language: settings.language, clips, channels, perDay: Math.min(settings.perDay, left), quietFrom: settings.quietFrom, quietTo: settings.quietTo, now, playbook, outcomes });
  const out = await runAgent(model, task, { onEvent: options.onEvent, signal: options.signal });
  if (!out.ok) return { ok: false, reason: "model", error: out.error };
  return { ok: true, result: out.result, proposals: toQueueProposals(out.result.proposals, channels, library), channels };
}
