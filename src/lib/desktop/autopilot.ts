import { AUTOPILOT_LANGUAGES, SOCIAL_PROPOSAL_MAX_AGE_DAYS, type AutopilotLanguage, type AutopilotSettings, type LibraryItem, type PostizChannel, type SocialAuditEntry, type SocialProposalInput, type SocialQueueItem } from "./contract";

/*
 * --- social-autopilot --- The autopilot's rules, pure so the main process (the settings block, the queue) and the page (the
 * 15-minute trigger, the Autopilot card) share one copy and the tests run them without Electron or React:
 *
 *  - the settings and their sanitising (unknown keys dropped, every value checked, "HH:MM" quiet hours, 1..5 a day, a
 *    planning run at most every 1..48 hours);
 *  - quiet hours: a span that may cross midnight (22:00–08:00), and the first allowed time at or after a given moment;
 *  - `shouldPlanNow(settings, queue, now)`: the page's trigger – enabled, a channel ticked, the last run older than
 *    `proposeHours`, and fewer than `perDay` proposals made today;
 *  - which Library clips are still open for a proposal, and how a planner's answer becomes queue proposals (the TikTok
 *    choices never travel: the card collects them).
 *
 * The autopilot only proposes. Nothing here, and nothing it feeds, creates a post: `queue.approve` runs the card's request
 * and nothing else does.
 */

export const DEFAULT_AUTOPILOT: AutopilotSettings = {
  enabled: false,
  channels: [],
  perDay: 1,
  quietFrom: "22:00",
  quietTo: "08:00",
  language: "en",
  proposeHours: 6,
  lastPlannedAt: null,
};

export const AUTOPILOT_PER_DAY_MIN = 1;
export const AUTOPILOT_PER_DAY_MAX = 5;
export const AUTOPILOT_PROPOSE_HOURS_MIN = 1;
export const AUTOPILOT_PROPOSE_HOURS_MAX = 48;
/** The page looks every 15 minutes whether a planning run is due. */
export const AUTOPILOT_CHECK_MS = 15 * 60_000;
/** A proposed time lies within the next 48 hours. */
export const PLAN_HORIZON_MS = 48 * 60 * 60_000;
export const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

export function isAutopilotLanguage(value: unknown): value is AutopilotLanguage {
  return typeof value === "string" && (AUTOPILOT_LANGUAGES as readonly string[]).includes(value);
}

/** "HH:MM", 00:00 to 23:59. */
export function isHHMM(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** Minutes since midnight of an "HH:MM". */
export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * The valid part of a patch (unknown keys and wrongly typed values dropped; numbers rounded into their range; channel ids
 * bounded strings, de-duplicated, at most 50; an unparsable `lastPlannedAt` becomes null). Like prefs.ts' sanitizePrefs.
 */
export function sanitizeAutopilot(patch: unknown): Partial<AutopilotSettings> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const p = patch as Record<string, unknown>;
  const out: Partial<AutopilotSettings> = {};
  if (typeof p.enabled === "boolean") out.enabled = p.enabled;
  if (Array.isArray(p.channels)) out.channels = [...new Set(p.channels.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length < 512))].slice(0, 50);
  if (typeof p.perDay === "number" && Number.isFinite(p.perDay)) out.perDay = Math.min(AUTOPILOT_PER_DAY_MAX, Math.max(AUTOPILOT_PER_DAY_MIN, Math.round(p.perDay)));
  if (isHHMM(p.quietFrom)) out.quietFrom = p.quietFrom;
  if (isHHMM(p.quietTo)) out.quietTo = p.quietTo;
  if (isAutopilotLanguage(p.language)) out.language = p.language;
  if (typeof p.proposeHours === "number" && Number.isFinite(p.proposeHours)) out.proposeHours = Math.min(AUTOPILOT_PROPOSE_HOURS_MAX, Math.max(AUTOPILOT_PROPOSE_HOURS_MIN, Math.round(p.proposeHours)));
  if (p.lastPlannedAt === null) out.lastPlannedAt = null;
  else if (typeof p.lastPlannedAt === "string" && p.lastPlannedAt.length <= 40 && Number.isFinite(Date.parse(p.lastPlannedAt))) out.lastPlannedAt = new Date(Date.parse(p.lastPlannedAt)).toISOString();
  return out;
}

/** Stored settings over the defaults (a damaged block falls back field by field); `language` defaults to the app's. */
export function resolveAutopilot(stored: unknown, defaultLanguage: AutopilotLanguage = "en"): AutopilotSettings {
  return { ...DEFAULT_AUTOPILOT, language: defaultLanguage, ...sanitizeAutopilot(stored) };
}

/* ------------------------------------------------------------------ quiet hours */

/** Whether a minute of the day (local) lies in the quiet span; `from === to` means no quiet hours. */
export function inQuietMinutes(minuteOfDay: number, quietFrom: string, quietTo: string): boolean {
  const from = minutesOf(quietFrom);
  const to = minutesOf(quietTo);
  if (from === to) return false;
  return from < to ? minuteOfDay >= from && minuteOfDay < to : minuteOfDay >= from || minuteOfDay < to;
}

/** Whether a moment (this PC's local time) lies in the quiet hours. */
export function inQuietHours(at: Date, quietFrom: string, quietTo: string): boolean {
  return inQuietMinutes(at.getHours() * 60 + at.getMinutes(), quietFrom, quietTo);
}

/** The first moment at or after `at` that is outside the quiet hours (local), to the minute. */
export function nextAllowedTime(at: Date, quietFrom: string, quietTo: string): Date {
  if (!inQuietHours(at, quietFrom, quietTo)) return at;
  const to = minutesOf(quietTo);
  const d = new Date(at.getTime());
  d.setSeconds(0, 0);
  const minute = d.getHours() * 60 + d.getMinutes();
  if (minute >= to) d.setDate(d.getDate() + 1);
  d.setHours(Math.floor(to / 60), to % 60, 0, 0);
  return d;
}

/* ------------------------------------------------------------------ the page's trigger */

/** Midnight (local) of the day `now` lies in. */
export function startOfLocalDay(now: number): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** The queue's proposals the autopilot made today (still proposed or already acted on: each counts against `perDay`). */
export function proposalsToday(queue: readonly SocialQueueItem[], now: number): SocialQueueItem[] {
  const day = startOfLocalDay(now);
  return queue.filter((i) => i.origin === "ai" && Date.parse(i.createdAt) >= day && Date.parse(i.createdAt) <= now + 60_000);
}

/** Why a planning run is not due (null: run it). */
export function planRefusal(settings: AutopilotSettings, queue: readonly SocialQueueItem[], now: number): "disabled" | "noChannels" | "tooSoon" | "dayFull" | null {
  if (!settings.enabled) return "disabled";
  if (settings.channels.length === 0) return "noChannels";
  const last = settings.lastPlannedAt ? Date.parse(settings.lastPlannedAt) : NaN;
  if (Number.isFinite(last) && now - last < settings.proposeHours * HOUR_MS) return "tooSoon";
  if (proposalsToday(queue, now).length >= settings.perDay) return "dayFull";
  return null;
}

/** The page's 15-minute check: whether the autopilot should plan now. */
export function shouldPlanNow(settings: AutopilotSettings, queue: readonly SocialQueueItem[], now: number): boolean {
  return planRefusal(settings, queue, now) === null;
}

/** How many proposals a run may still make today. */
export function proposalsLeftToday(settings: AutopilotSettings, queue: readonly SocialQueueItem[], now: number): number {
  return Math.max(0, settings.perDay - proposalsToday(queue, now).length);
}

/* ------------------------------------------------------------------ what the planner may pick */

/** What the planner sees of a clip. */
export interface PlanClip {
  id: string;
  title: string;
  caption: string | null;
  hashtags: string[];
  /** The preset the clip was rendered for (tiktok / reels / shorts…), null when unknown. */
  platform: string | null;
  durationSec: number | null;
  /** ISO time. */
  createdAt: string;
}

/** The Library's finished clips not yet posted (the audit log) or in the queue (any status but skipped). */
export function unpostedClips(library: readonly LibraryItem[], queue: readonly SocialQueueItem[], audit: readonly SocialAuditEntry[]): PlanClip[] {
  const taken = new Set<string>();
  for (const i of queue) if (i.status !== "skipped") taken.add(i.clipId);
  for (const e of audit) if (e.action === "createPosts" && e.clipId) taken.add(e.clipId);
  return library
    .filter((i) => i.exists && !taken.has(i.id))
    .map((i) => ({ id: i.id, title: i.meta.title || i.fileName, caption: i.meta.caption, hashtags: i.meta.hashtags, platform: i.meta.platform, durationSec: i.durationSec, createdAt: new Date(i.createdAt).toISOString() }));
}

/** The autopilot's channels as the planner sees them (ticked, known to Postiz, not disabled). */
export function plannerChannels(settings: Pick<AutopilotSettings, "channels">, channels: readonly PostizChannel[]): PostizChannel[] {
  return channels.filter((c) => settings.channels.includes(c.id) && !c.disabled);
}

/** The settings a proposal may carry for a channel: `__type` and, for YouTube, the title. Never TikTok's choices. */
export function proposedSettingsFor(platform: string, title: string | undefined): Record<string, unknown> {
  const settings: Record<string, unknown> = { __type: platform };
  if (platform === "youtube" && title && title.trim()) settings.title = title.trim().slice(0, 100);
  return settings;
}

/** A planner's channel text with its hashtags appended (none twice). */
export function proposedText(text: string, hashtags: readonly string[] | undefined): string {
  const tags = (hashtags ?? []).filter((h) => h && !text.includes(h));
  return tags.length ? `${text.trim()}\n\n${tags.join(" ")}` : text.trim();
}

/** The planner's answer as queue proposals. */
export interface PlannedProposal {
  clipId: string;
  channels: { integrationId: string; text: string; title?: string; hashtags?: string[] }[];
  when: string;
  reason: string;
}

export function toQueueProposals(proposals: readonly PlannedProposal[], channels: readonly PostizChannel[]): SocialProposalInput[] {
  return proposals.flatMap((p) => {
    const picked = p.channels.flatMap((c) => {
      const channel = channels.find((ch) => ch.id === c.integrationId);
      return channel ? [{ integrationId: channel.id, platform: channel.platform, text: proposedText(c.text, c.hashtags), settings: proposedSettingsFor(channel.platform, c.title) }] : [];
    });
    return picked.length ? [{ clipId: p.clipId, channels: picked, when: p.when, reason: p.reason.slice(0, 300) }] : [];
  });
}

/** Whether a proposal is too old to keep. */
export function proposalExpired(item: SocialQueueItem, now: number): boolean {
  return item.status === "proposed" && now - Date.parse(item.createdAt) > SOCIAL_PROPOSAL_MAX_AGE_DAYS * DAY_MS;
}
