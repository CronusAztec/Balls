import { LIMITS } from "@/lib/publish/platforms";
import type { AgentTask } from "./agent";
import type { JsonSchema } from "./jsonSchema";
import { HASHTAG_MAX_CHARS, fitText, normaliseHashtags } from "./normalise";
import { languageName } from "./studio";
import { PLAN_HORIZON_MS, inQuietHours, type PlanClip } from "../autopilot";
import { captionLimitOf, familyOf, utf8Bytes } from "../socialCard";
import type { PostizChannel, SocialPostOutcome } from "../contract";

/*
 * --- social-autopilot --- The "plan" job of the AI studio (phase 4 of docs/SOCIAL-AUTOPILOT.md): the Library's finished
 * clips that are not yet posted or proposed, the autopilot's channels, the day's budget and quiet hours, the local time, an
 * excerpt of the virality playbook (--- trends --- and what is trending: src/content/trends.json, its title formats and
 * words first) and what recently went out (PUBLISHED / ERROR) → proposals: which clip, per channel the
 * text (with a title for YouTube and hashtags), when within the next 48 hours and outside the quiet hours, and one sentence
 * why. Pure, like copyTask: the model is injected and the answer is held to a schema (clip and channel ids are enums, texts
 * bounded, at most `perDay` proposals) and to `checkFinal` (unknown ids, a text over the platform's limit, a time in the
 * quiet hours or beyond 48 h, the same clip twice, and TikTok's privacy or interaction settings if a model tries to add them).
 *
 * The planner only proposes: its answer goes to the queue as `proposed`, where the user reviews it on the approval card –
 * which collects TikTok's choices – before anything reaches Postiz.
 */

export interface PlanOutcome {
  channelId: string;
  platform: string;
  state: SocialPostOutcome["state"];
  /** ISO time. */
  at: string;
  text: string;
}

export interface PlanOptions {
  locale: string;
  /** The caption language (the autopilot's setting). */
  language: string;
  clips: readonly PlanClip[];
  channels: readonly Pick<PostizChannel, "id" | "platform" | "name">[];
  perDay: number;
  quietFrom: string;
  quietTo: string;
  /** This PC's time, ms since the epoch (the planner reasons in local time). */
  now: number;
  playbook: string;
  outcomes: readonly PlanOutcome[];
  /** --- trends --- What is trending (playbookContext.ts trendingContext, the copy focus): "" or absent for none. */
  trending?: string;
}

export interface PlanChannel {
  integrationId: string;
  text: string;
  title?: string;
  hashtags?: string[];
}

export interface PlanProposal {
  clipId: string;
  channels: PlanChannel[];
  /** "now" or an ISO time. */
  when: string;
  reason: string;
}

export interface PlanResult {
  proposals: PlanProposal[];
}

/** The most clips and channels the prompt lists (a small local model's context). */
export const PLAN_MAX_CLIPS = 12;
export const PLAN_MAX_OUTCOMES = 12;
export const PLAN_REASON_MAX = 200;
/** The longest channel text the schema allows (the platform's own limit is checked in `checkFinal`). */
export const PLAN_TEXT_MAX = 2200;

const HASHTAG: JsonSchema = { type: "string", minLength: 2, maxLength: HASHTAG_MAX_CHARS + 1, pattern: "^#[^\\s#]{1,60}$" };

/** The answer's schema for these clips and channels: ids as enums, at most `perDay` proposals. */
export function planFinal(clipIds: readonly string[], channelIds: readonly string[], perDay: number): JsonSchema {
  const max = Math.max(1, Math.min(5, Math.round(perDay)));
  return {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        minItems: 1,
        maxItems: Math.min(max, Math.max(1, clipIds.length)),
        items: {
          type: "object",
          properties: {
            clipId: { enum: [...clipIds] },
            channels: {
              type: "array",
              minItems: 1,
              maxItems: Math.max(1, channelIds.length),
              items: {
                type: "object",
                properties: {
                  integrationId: { enum: [...channelIds] },
                  text: { type: "string", minLength: 1, maxLength: PLAN_TEXT_MAX },
                  title: { type: "string", minLength: 2, maxLength: LIMITS.youtube.title },
                  hashtags: { type: "array", minItems: 0, maxItems: 15, items: HASHTAG },
                },
                required: ["integrationId", "text"],
                additionalProperties: false,
              },
            },
            when: { type: "string", minLength: 3, maxLength: 40, pattern: "^(now|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d+)?)?(Z|[+-]\\d{2}:\\d{2})?)$" },
            reason: { type: "string", minLength: 1, maxLength: PLAN_REASON_MAX },
          },
          required: ["clipId", "channels", "when", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["proposals"],
    additionalProperties: false,
  };
}

/** --- the per-platform copy guidance copyTask gives, addressed to Postiz's channel identifiers */
export function platformGuidance(platform: string): string {
  switch (familyOf(platform)) {
    case "tiktok":
      return `TikTok: punchy caption, a specific question, 3–6 hashtags, at most ${LIMITS.tiktok.caption} characters.`;
    case "instagram":
      return `Instagram Reels: keywords in the caption, a question, 5–10 hashtags, at most ${LIMITS.instagram.caption} characters and ${LIMITS.instagram.hashtags} hashtags.`;
    case "youtube":
      return `YouTube Shorts: a searchable title (2–${LIMITS.youtube.title} characters) and a description with keywords and #Shorts.`;
    default:
      return `${platform}: a short caption with a question and 2–4 hashtags.`;
  }
}

/** "yyyy-MM-dd HH:mm" in this PC's time zone. */
export function localStamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The ISO form the model should write for a local moment (UTC, so Postiz reads it right). */
export function isoOf(ms: number): string {
  return new Date(ms).toISOString();
}

/** Why a proposed time is not usable (null: fine). */
export function whenProblem(when: string, options: Pick<PlanOptions, "now" | "quietFrom" | "quietTo">): string | null {
  if (when === "now") return inQuietHours(new Date(options.now), options.quietFrom, options.quietTo) ? `"now" falls in the quiet hours ${options.quietFrom}–${options.quietTo}: give an ISO time after them` : null;
  const at = Date.parse(when);
  if (!Number.isFinite(at)) return `when "${when}" is not an ISO time`;
  if (at <= options.now) return `when ${when} is in the past (now is ${isoOf(options.now)})`;
  if (at > options.now + PLAN_HORIZON_MS) return `when ${when} is more than 48 hours away`;
  if (inQuietHours(new Date(at), options.quietFrom, options.quietTo)) return `when ${when} falls in the quiet hours ${options.quietFrom}–${options.quietTo} (local ${localStamp(at)})`;
  return null;
}

/** The checks beyond the schema. */
export function checkPlanResult(result: PlanResult, options: PlanOptions): string[] {
  const errors: string[] = [];
  const clips = new Map(options.clips.map((c) => [c.id, c]));
  const channels = new Map(options.channels.map((c) => [c.id, c]));
  const seenClips = new Set<string>();
  if (!Array.isArray(result?.proposals)) return ["proposals must be a list"];
  if (result.proposals.length > options.perDay) errors.push(`at most ${options.perDay} proposal(s) today, not ${result.proposals.length}`);
  for (const p of result.proposals) {
    if (!clips.has(p.clipId)) errors.push(`unknown clipId "${p.clipId}" – use one of the listed clips`);
    if (seenClips.has(p.clipId)) errors.push(`clip "${p.clipId}" is proposed twice`);
    seenClips.add(p.clipId);
    const seenChannels = new Set<string>();
    for (const c of p.channels ?? []) {
      const channel = channels.get(c.integrationId);
      if (!channel) {
        errors.push(`unknown integrationId "${c.integrationId}" – use one of the listed channels`);
        continue;
      }
      if (seenChannels.has(c.integrationId)) errors.push(`channel "${c.integrationId}" is listed twice for clip "${p.clipId}"`);
      seenChannels.add(c.integrationId);
      const family = familyOf(channel.platform);
      const full = `${c.text}\n\n${(c.hashtags ?? []).join(" ")}`;
      const limit = captionLimitOf(channel.platform);
      if (family === "youtube") {
        if (utf8Bytes(full) > LIMITS.youtube.descriptionBytes) errors.push(`the YouTube description for clip "${p.clipId}" is over ${LIMITS.youtube.descriptionBytes} bytes`);
        if (!c.title || c.title.trim().length < 2 || /[<>]/.test(c.title)) errors.push(`YouTube channel "${c.integrationId}" needs a title of 2–${LIMITS.youtube.title} characters without < or >`);
      } else if (limit !== null && full.length > limit) errors.push(`the text for channel "${c.integrationId}" is over ${limit} characters`);
      if (family === "instagram" && (c.hashtags ?? []).length > LIMITS.instagram.hashtags) errors.push(`Instagram takes at most ${LIMITS.instagram.hashtags} hashtags`);
      // TikTok's privacy and interaction settings are the user's choice on the card: a model that adds them is refused
      const settings = (c as unknown as { settings?: unknown }).settings;
      if (settings && typeof settings === "object") {
        const keys = Object.keys(settings as Record<string, unknown>).filter((k) => ["privacy_level", "comment", "duet", "stitch"].includes(k));
        if (keys.length) errors.push(`never propose TikTok's ${keys.join(", ")}: the user chooses them on the card`);
        else errors.push("do not add settings: only text, title and hashtags");
      }
    }
    const when = whenProblem(p.when, options);
    if (when) errors.push(when);
  }
  return errors;
}

/** Obvious slips fixed before the checks: trimmed texts, hashtags with "#", "now" spelt loosely. */
export function normalisePlanResult(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const r = result as Record<string, unknown>;
  if (!Array.isArray(r.proposals)) return result;
  return {
    proposals: r.proposals.map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
      const p = { ...(raw as Record<string, unknown>) };
      if (typeof p.when === "string") p.when = /^now$/i.test(p.when.trim()) ? "now" : p.when.trim();
      if ("reason" in p) p.reason = fitText(p.reason, PLAN_REASON_MAX);
      if (Array.isArray(p.channels))
        p.channels = p.channels.map((c) => {
          if (!c || typeof c !== "object" || Array.isArray(c)) return c;
          const ch = { ...(c as Record<string, unknown>) };
          if ("text" in ch) ch.text = fitText(ch.text, PLAN_TEXT_MAX);
          if ("title" in ch) ch.title = fitText(ch.title, LIMITS.youtube.title);
          if ("hashtags" in ch) ch.hashtags = normaliseHashtags(ch.hashtags);
          return ch;
        });
      return p;
    }),
  };
}

function describeClip(c: PlanClip): string {
  const parts = [`id ${c.id}`, `"${c.title}"`, c.platform ? `made for ${c.platform}` : "", c.durationSec ? `${Math.round(c.durationSec)} s` : "", `made ${c.createdAt.slice(0, 10)}`, c.caption ? `caption: ${c.caption.slice(0, 160)}` : "", c.hashtags.length ? `hashtags: ${c.hashtags.slice(0, 8).join(" ")}` : ""];
  return `- ${parts.filter(Boolean).join(", ")}`;
}

export function planTask(options: PlanOptions): AgentTask<PlanResult> {
  const clips = options.clips.slice(0, PLAN_MAX_CLIPS);
  const outcomes = options.outcomes.slice(0, PLAN_MAX_OUTCOMES);
  const system = [
    "You schedule short-form posts for JumpingBallsLive, a satisfying ball-physics simulator whose clips go to TikTok, Instagram Reels and YouTube Shorts through Postiz. You only propose: a person reviews every proposal and chooses TikTok's audience and interaction settings. Never write those.",
    `Pick at most ${options.perDay} clip(s) for today from the list, each for one or more of the channels, with a text per channel, a title for YouTube, 3–10 hashtags, a time and one sentence why (why this clip, why this time).`,
    `Time: it is ${localStamp(options.now)} on this PC (${isoOf(options.now)} UTC). Quiet hours ${options.quietFrom}–${options.quietTo} local: never propose a time inside them. A time is "now" or an ISO time in UTC within the next 48 hours, e.g. ${isoOf(options.now + 3 * 60 * 60_000)}. Prefer evenings and weekends when the research below says so.`,
    `Write the texts in ${languageName(options.language)}. ${[...new Set(options.channels.map((c) => c.platform))].map(platformGuidance).join(" ")}`,
    "Channels (integrationId, platform, name):",
    ...options.channels.map((c) => `- ${c.id}, ${c.platform}, ${c.name}`),
    "Clips not yet posted:",
    ...clips.map(describeClip),
    outcomes.length ? "Recent posts (state, local time, platform, text) – repeat what was PUBLISHED and avoid what got ERROR:" : "No posts went out yet.",
    ...outcomes.map((o) => `- ${o.state}, ${localStamp(Date.parse(o.at))}, ${o.platform}, ${o.text.slice(0, 80)}`),
    options.playbook ? "Research (virality playbook):" : "",
    options.playbook,
    // --- trends --- what other creators' trending simulation videos do, for the titles, captions and hashtags
    options.trending ?? "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    system,
    user: `Propose today's post${options.perDay > 1 ? "s" : ""}.`,
    tools: [],
    final: planFinal(
      clips.map((c) => c.id),
      options.channels.map((c) => c.id),
      options.perDay,
    ),
    finalHint: `{"proposals":[{"clipId":"<a listed clip id>","channels":[{"integrationId":"<a listed channel id>","text":"<caption>","title":"<YouTube only>","hashtags":["#…"]}],"when":"now" or "<ISO UTC time>","reason":"<one sentence>"}]} – at most ${options.perDay} proposal(s)`,
    checkFinal: (result) => checkPlanResult(result, { ...options, clips }),
    normaliseFinal: normalisePlanResult,
    maxSteps: 4,
    temperature: 0.6,
    maxTokens: 1500,
    name: "plan",
  };
}
