import type { SocialPostRequest, SocialQueueBy, SocialQueueStatus } from "./contract";
import type { InsightLane } from "@/lib/insights/stats";
import type { LearnerDecision, RenderWatermark, SlotRole } from "@/lib/insights/learner";
import type { LearnerSettings } from "@/lib/insights/learnerSettings";
import type { DialId } from "@/lib/insights/dials";
import type { ClipReview } from "@/lib/crew/review";
import { AUTOPILOT_PER_DAY_MAX, AUTOPILOT_PER_DAY_MIN, inQuietMinutes } from "./autopilot";
import { YOUTUBE_VISIBILITIES, channelProblems, familyOf, providerSettingsOf, type CardChannel, type CardProblem, type YouTubeVisibility } from "./socialCard";
import { classifyPostizError, isAccountHealth } from "./postizErrors";
import { textProblems, type TextFacts, type TextLanguage, type TextProblem } from "./autonomyText";
import { PAIR_GAP_H, PAIRS_PER_DAY_MAX, TRIAL_LIMIT_PAUSE_H } from "@/lib/insights/learnerRules";

/*
 * --- autonomy --- "Fully autonomous" as pure rules (the learner plan's C11): with the owner's switch on, the app approves and
 * posts the learner's own proposals, and nobody is asked first. This file decides, from what the app's main process hands it,
 * which proposals the app may approve on its own, when each goes out, and whether autonomy must pause or turn off, and why.
 * Nothing imports it yet: the main process's approver (desktop/src/social/autonomy.ts, its own 5-minute tick) and the consent
 * screen wire it in later (L2).
 *
 * It is built to post less than a person could approve, never more:
 *  - Off by default, for everyone. A consent record turns it on: the date, the copy version, the app version, the Postiz
 *    workspace, and for each ticked account its Postiz id, identifier and profile, the posts a day, the Trial Reel pairs and,
 *    on YouTube, the visibility and made-for-kids chosen once. Anything that widens it asks again; Off clears it.
 *  - Instagram and YouTube only (AUTONOMY_PLATFORMS, by Postiz identifier). TikTok, TikTok Business and every other platform
 *    always wait for the person: TikTok asks for a preview and a choice on each post.
 *  - Only the learner's own proposals: stamped in the main process by social.queue.proposePass (origin "learnerPass", the
 *    pass, the role, the test, each channel's lane and a hash), unchanged since (the hash is taken again), not held, not
 *    edited, from the newest pass, at most 24 hours old, made after the consent, the last Resume and the last time learning
 *    was paused, turned off or switched back on, and after the practice day (the clocks' allowed difference counted as practice), with their
 *    test still open and no verdict written since, and no other proposal of the same clip.
 *  - What the owner changed on the Learning card since, which the learner reads on its next pass only: a Trial Reel waits for
 *    good once Trial Reels are switched off, set to no pairs a day or Instagram's automatic sharing is no longer confirmed
 *    off, once the learner stops trials on its account, and once Postiz says the account cannot post them or hit its Trial
 *    Reel limit (24 hours); a test, check or Trial Reel waits for good once the owner skipped its question or fixed its dial.
 *  - The lane rules: a Trial Reel has exactly one Instagram channel, a Reel (post_type "post"), is_trial_reel and MANUAL; a
 *    test clip, a check's old clip and a newcomer test's rotation clip go only to scored channels (Instagram normal Reels;
 *    TikTok's part is split off); YouTube takes the best settings only, a best clip or a check's new clip (the new best, as
 *    the learner sends it); a best clip carries no trial field; a test, check or Trial Reel carries its test or block, a
 *    Trial Reel its pair; no account is listed twice.
 *  - Only clips the crew kept: a post-stage keep, quick or thorough, with no failed gate, on this very file (its SHA-256 and
 *    size), rendered sealed (never free or sealedTest), never the battle family; words that pass the text gate
 *    (lib/desktop/autonomyText.ts); and the card's own rules for the request it builds itself.
 *  - Just in time: a post is created only when its time is 60 to 90 minutes away by Postiz's clock, picked just before each
 *    create attempt (scheduleFor), inside the slot's window, outside quiet hours, strictly before the licence's end, 20
 *    minutes from every other post on the account on both sides, 2 hours from the other reel of a Trial Reel pair, within
 *    the day's cap over the local day and any 24 hours (counting every post on the account, whoever made it), and never the
 *    same video twice on an account.
 *  - It pauses itself, and says why: on any failed post of its own, on any warning from the platform about a consented
 *    account (48 hours before Resume or a new consent, kept apart from the consent so Off does not end it, a warning from
 *    before the consent or the last Resume counted too, every account warned in one read named, and its own still-scheduled
 *    posts on each of them removed unless the owner chose "only tell me": listed again on every tick while the warning's
 *    pause or its 48 hours run, until the app has removed them, so a post Postiz lists only after the warning goes too), on
 *    an error text Postiz's table does not know (lib/desktop/postizErrors.ts, fail closed),
 *    on one of its posts deleted in Postiz, on a change the learner sent back, when Pro ends, when the key or an account
 *    changes, on a new consent version, and after more than 48 hours without running. What happens while it is paused is
 *    noted on the pause, so the banner says it before Resume. An app older than the one that recorded the consent turns it
 *    Off.
 *
 * Pure and deterministic: no clock (the PC's time and Postiz's come in), no randomness, no file. The hash function, the
 * crew's number reader and the PC's UTC offset at a moment (DST) are passed in. It imports only light modules the main process
 * can bundle (the autopilot's rules, the card's rules, the error table, the text gate and the learner's rules) and types
 * (tests/autonomy.test.ts reads its imports).
 */

// --- autonomy ---

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** The consent screen's copy version: a new one asks again. */
export const AUTONOMY_CONSENT_VERSION = 1;
/** The Postiz identifiers the app may post to on its own. */
export const AUTONOMY_PLATFORMS = ["instagram", "instagram-standalone", "youtube"] as const;
export type AutonomyPlatform = (typeof AUTONOMY_PLATFORMS)[number];
/** A post is created only when its time is this far away, at least ... */
export const AUTONOMY_LEAD_MS = 60 * MINUTE_MS;
/** ... and at most this far: Postiz never holds more than the next 90 minutes of the app's own posts. */
export const AUTONOMY_MAX_LEAD_MS = 90 * MINUTE_MS;
/** The approver's own tick in the main process. */
export const AUTONOMY_TICK_MS = 5 * MINUTE_MS;
/** The outcome watcher reads GET /posts this often while one of its posts is pending or was published in the last 24 hours. */
export const AUTONOMY_WATCH_MS = 15 * MINUTE_MS;
/** How long after its last publication the watcher keeps reading a post of its own. */
export const AUTONOMY_WATCH_AFTER_MS = 24 * HOUR_MS;
/** An item older than this waits for the person. */
export const AUTONOMY_ITEM_MAX_AGE_MS = 24 * HOUR_MS;
/** Never more posts than this on one account in a day, whoever made them. */
export const AUTONOMY_CHANNEL_DAY_MAX = 7;
/** After a warning about an account, Resume waits this long. */
export const AUTONOMY_HEALTH_COOLDOWN_MS = 48 * HOUR_MS;
/** More than this without the approver running brings it back paused. */
export const AUTONOMY_GAP_MS = 48 * HOUR_MS;
/** The PC's clock and Postiz's may differ by this much; more, and posting on its own waits. */
export const AUTONOMY_CLOCK_SKEW_MS = 5 * MINUTE_MS;
/** The practice day: every check runs, nothing is sent, and its items are never sent later. */
export const AUTONOMY_PRACTICE_MS = 24 * HOUR_MS;
/**
 * One post per account every 20 minutes, on both sides of every post (C7). The same number as desktop/src/social/audit.ts
 * CHANNEL_COOLDOWN_MS, which this file cannot import (it is the app's own code): desktop/tests/autonomyRules.test.ts keeps
 * them equal.
 */
export const AUTONOMY_SPACING_MS = 20 * MINUTE_MS;
/** The two reels of a Trial Reel pair go out at least this far apart (the learner's own gap, learnerRules.ts PAIR_GAP_H). */
export const AUTONOMY_PAIR_GAP_MS = PAIR_GAP_H * HOUR_MS;
/** Create calls an hour from one key the app stays under: audit.ts CREATE_CALLS_PER_HOUR, kept equal by the same test. */
export const AUTONOMY_CREATES_PER_HOUR = 60;
/** Trial Reel pairs a day the consent may name on an Instagram account: the learner's own most (learnerRules.ts). */
export const AUTONOMY_TRIAL_PAIRS_MAX = PAIRS_PER_DAY_MAX;
/** Accounts one consent may name. */
export const AUTONOMY_ACCOUNTS_MAX = 20;

/* ------------------------------------------------------------------ the stored block */

/** YouTube's audience choices, made once on the consent screen with no default. */
export interface AutonomyYouTube {
  type: YouTubeVisibility;
  selfDeclaredMadeForKids: "yes" | "no";
}

/** One account the owner ticked on the consent screen. */
export interface AutonomyAccount {
  /** Postiz's integration id. */
  channelId: string;
  /** Postiz's provider identifier when the owner ticked it. */
  platform: AutonomyPlatform;
  /** Postiz's profile (the account's user name) when the owner ticked it: a change pauses. */
  profile: string;
  /** Normal posts a day (the autopilot's 1 to 5). */
  perDay: number;
  /** Trial Reel pairs a day on Instagram (0 to 2), 0 elsewhere. */
  trialPairs: number;
  /** YouTube's choices (YouTube only, required there). */
  youtube: AutonomyYouTube | null;
}

/** The owner's recorded consent: what turning the switch on approved in advance. */
export interface AutonomyConsent {
  version: number;
  /** ISO time it was given. */
  at: string;
  /** The app that recorded it: an older app turns autonomy Off. */
  appVersion: string;
  /** The Postiz workspace it was given for: another one is a changed key. */
  postiz: { baseUrl: string; organizationId: string };
  accounts: AutonomyAccount[];
  /** "Practise for a day first". */
  practise: boolean;
}

/** Why autonomy paused (a banner, a notification and an audit line say it). */
export const AUTONOMY_PAUSE_REASONS = [
  "user", // Pause posting, in the Posts tab or the tray
  "accountHealth", // a warning from the platform about a consented account, or the account off or needing a reconnect
  "ownPostFailed", // a post of its own failed (refused at create, or ERROR at publish time)
  "unknownError", // an error text Postiz's table does not know
  "ownPostDeleted", // one of its scheduled posts is gone from Postiz before its time
  "wentBack", // a learner check sent a change back
  "proEnded", // the licence is not Pro, or it ended
  "keyRemoved", // the Postiz key was removed
  "keyChanged", // the Postiz key was saved again, or points to another workspace
  "accountChanged", // a consented account is gone, or its identifier or profile changed
  "consentVersion", // the consent screen's copy changed: it asks again
  "gap", // more than 48 hours without the approver running
  "trialCheckFailed", // the per-post route failed just before a Trial Reel
] as const;
export type AutonomyPauseReason = (typeof AUTONOMY_PAUSE_REASONS)[number];

/** What else happened while paused: each is a banner line, a notification and an audit line, and Resume clears them all. */
export interface AutonomyPauseNote {
  reason: AutonomyPauseReason;
  /** ISO time it was recorded. */
  at: string;
  channelId: string | null;
}

export interface AutonomyPause {
  reason: AutonomyPauseReason;
  /** ISO time it paused. */
  at: string;
  /** Resume waits until then (ISO), after a warning about an account; null: as soon as the cause is gone. */
  until: string | null;
  /** The account it concerns, when one. */
  channelId: string | null;
  /** A warning's pause: the other accounts warned with it, or before it while it was on. Absent: none. */
  otherChannels?: string[];
  /** What happened after it paused (a post of its own failed, an unknown error, one of its posts gone, a change sent back), and the pause a warning about an account replaced. Absent: nothing. */
  also?: AutonomyPauseNote[];
}

/** The 48 hours after a warning about an account. Kept apart from the consent and the pause: Off and a new consent keep it. */
export interface AutonomyCooldown {
  /** ISO time it was last recorded: the warnings seen by then are counted. */
  at: string;
  /** ISO time it ends: no new consent, no Resume and no post of its own before then. */
  until: string;
  /** The account the latest warning was about. */
  channelId: string | null;
  /** The other accounts warned while it ran (its own still-scheduled posts there are removed too). Absent: none. */
  otherChannels?: string[];
}

/** The config's "autonomy" block. */
export interface AutonomySettings {
  /** Null: off (the default, and after Off). */
  consent: AutonomyConsent | null;
  pause: AutonomyPause | null;
  /** ISO time of the last Resume. */
  resumedAt: string | null;
  /** After a warning about an account, remove the app's own still-scheduled posts there (the plan's default; the owner may say "only tell me"). */
  deleteOnWarning: boolean;
  /** ISO time the approver last ran. */
  lastRunAt: string | null;
  /** The account-health cooldown, if one was ever recorded (an ended one stays, harmless). */
  cooldown: AutonomyCooldown | null;
}

export const DEFAULT_AUTONOMY: AutonomySettings = { consent: null, pause: null, resumedAt: null, deleteOnWarning: true, lastRunAt: null, cooldown: null };

/** The most notes one pause keeps (the newest). */
export const AUTONOMY_PAUSE_NOTES_MAX = 20;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const own = (o: Record<string, unknown>, key: string): unknown => (Object.prototype.hasOwnProperty.call(o, key) ? o[key] : undefined);
const isoOrNull = (v: unknown): string | null => (typeof v === "string" && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(v) && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const boundedString = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
const ms = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : NaN);

export function isAutonomyPlatform(value: unknown): value is AutonomyPlatform {
  return typeof value === "string" && (AUTONOMY_PLATFORMS as readonly string[]).includes(value);
}

/** One stored account, or null when any part of it is not valid (an account is dropped, never widened). */
export function sanitizeAccount(raw: unknown): AutonomyAccount | null {
  if (!isObj(raw)) return null;
  const channelId = boundedString(own(raw, "channelId"), 511);
  const platform = own(raw, "platform");
  const profile = typeof own(raw, "profile") === "string" && (own(raw, "profile") as string).length <= 200 ? (own(raw, "profile") as string) : null;
  const perDay = own(raw, "perDay");
  const trialPairs = own(raw, "trialPairs");
  if (!channelId || !isAutonomyPlatform(platform) || profile === null) return null;
  if (typeof perDay !== "number" || !Number.isInteger(perDay) || perDay < AUTOPILOT_PER_DAY_MIN || perDay > AUTOPILOT_PER_DAY_MAX) return null;
  if (typeof trialPairs !== "number" || !Number.isInteger(trialPairs) || trialPairs < 0 || trialPairs > AUTONOMY_TRIAL_PAIRS_MAX) return null;
  if (trialPairs > 0 && familyOf(platform) !== "instagram") return null;
  const yt = own(raw, "youtube");
  let youtube: AutonomyYouTube | null = null;
  if (platform === "youtube") {
    if (!isObj(yt)) return null;
    const type = own(yt, "type");
    const kids = own(yt, "selfDeclaredMadeForKids");
    if (!(YOUTUBE_VISIBILITIES as readonly unknown[]).includes(type) || (kids !== "yes" && kids !== "no")) return null;
    youtube = { type: type as YouTubeVisibility, selfDeclaredMadeForKids: kids };
  } else if (yt !== undefined && yt !== null) return null;
  return { channelId, platform, profile, perDay, trialPairs, youtube };
}

/**
 * The Postiz workspace a consent is bound to: its address and its organisation id, both known (a key that moves to another
 * workspace pauses). One rule for both sides: the consent screen refuses Turn on without it ("workspaceUnknown"), and a
 * stored consent without it loads as none.
 */
export function consentWorkspace(postiz: { baseUrl?: unknown; organizationId?: unknown }): AutonomyConsent["postiz"] | null {
  const baseUrl = boundedString(postiz.baseUrl, 500);
  const organizationId = boundedString(postiz.organizationId, 511);
  return baseUrl && organizationId ? { baseUrl, organizationId } : null;
}

/** A stored consent, or null: no date, no version, no workspace, or no valid account is no consent. */
export function sanitizeConsent(raw: unknown): AutonomyConsent | null {
  if (!isObj(raw)) return null;
  const version = own(raw, "version");
  const at = isoOrNull(own(raw, "at"));
  const appVersion = boundedString(own(raw, "appVersion"), 40);
  const postiz = own(raw, "postiz");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || !at || !appVersion || !/^\d+\.\d+\.\d+/.test(appVersion) || !isObj(postiz)) return null;
  const workspace = consentWorkspace({ baseUrl: own(postiz, "baseUrl"), organizationId: own(postiz, "organizationId") });
  if (!workspace) return null;
  const { baseUrl, organizationId } = workspace;
  const rawAccounts = own(raw, "accounts");
  const accounts: AutonomyAccount[] = [];
  if (Array.isArray(rawAccounts)) {
    for (const a of rawAccounts.slice(0, AUTONOMY_ACCOUNTS_MAX)) {
      const clean = sanitizeAccount(a);
      if (clean && !accounts.some((x) => x.channelId === clean.channelId)) accounts.push(clean);
    }
  }
  if (accounts.length === 0) return null;
  const practise = own(raw, "practise");
  return { version, at, appVersion, postiz: { baseUrl, organizationId }, accounts, practise: practise !== false };
}

/** A stored pause note, or null. */
function sanitizeNote(raw: unknown): AutonomyPauseNote | null {
  if (!isObj(raw)) return null;
  const reason = own(raw, "reason");
  const at = isoOrNull(own(raw, "at"));
  if (!(AUTONOMY_PAUSE_REASONS as readonly unknown[]).includes(reason) || !at) return null;
  return { reason: reason as AutonomyPauseReason, at, channelId: boundedString(own(raw, "channelId"), 511) };
}

/** The accounts a warning's pause or cooldown is about: its account, then the others. */
const channelsOf = (c: Pick<AutonomyCooldown, "channelId" | "otherChannels"> | null | undefined): string[] => (c ? [...(c.channelId ? [c.channelId] : []), ...(c.otherChannels ?? [])] : []);

/** `channelId` and `otherChannels` of a list of accounts: the first, then the rest, each once (no `otherChannels` when none). */
function accountsOf(channels: readonly string[]): Pick<AutonomyCooldown, "channelId" | "otherChannels"> {
  const unique = [...new Set(channels)];
  return { channelId: unique[0] ?? null, ...(unique.length > 1 ? { otherChannels: unique.slice(1) } : {}) };
}

/** A stored list of other accounts: bounded ids, each once, none of them `channelId` (absent when none). */
function sanitizeOthers(raw: unknown, channelId: string | null): Pick<AutonomyCooldown, "otherChannels"> {
  if (!Array.isArray(raw)) return {};
  const ids = [...new Set(raw.map((v) => boundedString(v, 511)).filter((v): v is string => v !== null && v !== channelId))].slice(0, AUTONOMY_ACCOUNTS_MAX);
  return ids.length ? { otherChannels: ids } : {};
}

/** The stored block over the defaults: unknown keys dropped, a consent without a date or an account dropped (so: off). */
export function sanitizeAutonomy(raw: unknown): AutonomySettings {
  if (!isObj(raw)) return { ...DEFAULT_AUTONOMY };
  const consent = sanitizeConsent(own(raw, "consent"));
  const p = own(raw, "pause");
  let pause: AutonomyPause | null = null;
  if (isObj(p)) {
    const head = sanitizeNote(p);
    if (head) {
      const rawAlso = own(p, "also");
      const also = Array.isArray(rawAlso) ? rawAlso.map(sanitizeNote).filter((n): n is AutonomyPauseNote => n !== null).slice(-AUTONOMY_PAUSE_NOTES_MAX) : [];
      const others = head.reason === "accountHealth" ? sanitizeOthers(own(p, "otherChannels"), head.channelId) : {};
      pause = { reason: head.reason, at: head.at, until: isoOrNull(own(p, "until")), channelId: head.channelId, ...others, ...(also.length ? { also } : {}) };
    }
  }
  const c = own(raw, "cooldown");
  let cooldown: AutonomyCooldown | null = null;
  if (isObj(c)) {
    const at = isoOrNull(own(c, "at"));
    const until = isoOrNull(own(c, "until"));
    const channelId = boundedString(own(c, "channelId"), 511);
    if (at && until) cooldown = { at, until, channelId, ...sanitizeOthers(own(c, "otherChannels"), channelId) };
  }
  return {
    consent,
    // a pause without a consent is no pause: off is off
    pause: consent ? pause : null,
    resumedAt: isoOrNull(own(raw, "resumedAt")),
    deleteOnWarning: own(raw, "deleteOnWarning") !== false,
    lastRunAt: isoOrNull(own(raw, "lastRunAt")),
    // the cooldown outlives the consent; a warning's pause stored without one (an older block) still carries it
    cooldown: laterCooldown(cooldown, healthCooldownOf(pause)),
  };
}

/** The cooldown an account-health pause carries (one stored without its end: 48 hours from it), or null. */
function healthCooldownOf(pause: AutonomyPause | null): AutonomyCooldown | null {
  if (!pause || pause.reason !== "accountHealth") return null;
  return { at: pause.at, until: pause.until ?? new Date(ms(pause.at) + AUTONOMY_HEALTH_COOLDOWN_MS).toISOString(), ...accountsOf(channelsOf(pause)) };
}

/**
 * Two cooldowns as one: recorded at the later time, ending at the later end, about the latest warning's account first. The
 * older one's accounts stay on it while it still ran when the newer was recorded (two accounts warned a day apart are both
 * cooling down); an older one that had ended by then is over.
 */
function laterCooldown(a: AutonomyCooldown | null, b: AutonomyCooldown | null): AutonomyCooldown | null {
  if (!a || !b) return a ?? b;
  const [older, newer] = ms(a.at) <= ms(b.at) ? [a, b] : [b, a];
  const channels = ms(older.until) > ms(newer.at) ? [...channelsOf(newer), ...channelsOf(older)] : channelsOf(newer);
  return { at: newer.at, until: ms(older.until) > ms(newer.until) ? older.until : newer.until, ...accountsOf(channels) };
}

/** The account-health cooldown as it stands: the stored one, and the pause's own when it is a warning's. */
export function cooldownOf(state: Pick<AutonomySettings, "cooldown" | "pause">): AutonomyCooldown | null {
  return laterCooldown(state.cooldown, healthCooldownOf(state.pause));
}

/** Whether the account-health cooldown still runs at `now`. */
export function coolingDown(state: Pick<AutonomySettings, "cooldown" | "pause">, now: number): boolean {
  const c = cooldownOf(state);
  return !!c && ms(c.until) > now;
}

/* ------------------------------------------------------------------ what the main process hands in */

/** A channel as Postiz lists it now (GET /integrations, read by the main process at consent time and before each create). */
export interface AutonomyLiveChannel {
  id: string;
  platform: string;
  /** The account's user name, as Postiz keeps it. */
  profile: string | null;
  disabled: boolean;
  /** Postiz asks for the channel to be connected again. */
  refreshNeeded: boolean;
}

/** One channel of a queued item, with the lane proposePass stamped on it. */
export interface AutonomyItemChannel {
  integrationId: string;
  platform: string;
  text: string;
  settings: Record<string, unknown>;
  lane: InsightLane;
}

/** What proposePass stamped on a learner proposal in the main process. */
export interface AutonomyStamp {
  passId: string;
  /** The pass's day, "YYYY-MM-DD". */
  date: string;
  role: SlotRole;
  /** The test, check or block the clip belongs to (null: no test). */
  testId: string | null;
  /**
   * The slot's arm, as its test membership says it (lib/insights/learner.ts TestMembership.arm): a test's dial arm, a check's
   * "old" or "new", a reel's levels, a newcomer test's best arm "rotation". Null or absent: no test.
   */
  arm?: string | null;
  /** The pair of a Trial Reel. */
  pair: number | null;
  /** The slot's window (ISO times); null: the planned time only. */
  window: { from: string; to: string } | null;
  /** The main process's hash of stampText(item), taken when it was stamped. */
  hash: string;
}

/** A queued item as the approver reads it. */
export interface AutonomyItem {
  id: string;
  clipId: string;
  video: string | null;
  status: SocialQueueStatus;
  /** Who wrote the words as they stand ("user" after an edit). */
  by: SocialQueueBy;
  /** Who made it: the planner or the AI panel ("ai", through propose), the person ("user"), or the learner (through proposePass). */
  origin: SocialQueueBy | "learnerPass";
  /** ISO time, stamped by the main process. */
  createdAt: string;
  /** The person opened its card: it waits for them for good. */
  held: boolean;
  /** The learner item this part was split off: it waits for the person. */
  splitFrom: string | null;
  /** The slot's planned time (ISO). */
  when: string | null;
  thumbnailMs?: number;
  channels: AutonomyItemChannel[];
  pass: AutonomyStamp | null;
}

/** A file as the main process measured it: its SHA-256 (hex) and its size. */
export interface AutonomyFile {
  sha256: string;
  bytes: number;
}

/** The clip an item would post, as the main process reads it from the Library. */
export interface AutonomyClip {
  id: string;
  exists: boolean;
  /** The file that would be uploaded, measured again just now (null: it could not be read). */
  file: AutonomyFile | null;
  /** The crew's saved review, with the file it reviewed and the person's "Keep anyway". */
  review: (Pick<ClipReview, "verdict" | "stage" | "depth" | "gates"> & { file: AutonomyFile | null; keepAnyway?: boolean }) | null;
  /** How it was rendered (its genes; null: unknown). */
  watermark: RenderWatermark | null;
  /** Its genes' family and mode (the battle family never goes out on its own). */
  family: string | null;
  mode: string | null;
  /** What the clip says, for the text gate. */
  facts: TextFacts;
}

/** One post on an account, from the audit and from Postiz's own list (so posts made in Postiz itself count too). */
export interface AccountPost {
  channelId: string;
  postId: string | null;
  /** Postiz's publishDate (a "now" post: the moment it was made). */
  at: string;
  /** Postiz's state, or "intent": a create whose answer never came (counted as posted until Postiz's list settles it). */
  state: "QUEUE" | "PUBLISHED" | "ERROR" | "DRAFT" | "intent";
  /** Approved by the app on its own, by the person in the app, or made outside the app (Postiz's editor, another tool). */
  by: "app" | "user" | "outside";
  platform?: string | null;
  video?: string | null;
  clipId?: string | null;
  lane?: InsightLane | null;
  error?: string | null;
  /** When the watcher first saw its error, or saw it gone (ISO). */
  seenAt?: string | null;
  /** One of the app's own scheduled posts is gone from Postiz before its time, and the app did not delete it. */
  gone?: boolean;
  /** The app deleted it itself, after a warning about its account (AutonomyCheck.deleteOwn): it takes up nothing, and is never listed for deletion again. */
  removed?: boolean;
  /** Its learner test and Trial Reel pair, for the pair's gap. */
  testId?: string | null;
  pair?: number | null;
}

/** The page's signed licence, verified in the main process. */
export interface AutonomyLicence {
  pro: boolean;
  /** The verifier ran with the committed TEST key: never posts on its own. */
  testMode: boolean;
  /** ISO end, null: none. */
  expiresAt: string | null;
}

export interface AutonomyContext {
  /** The PC's clock (ms). */
  now: number;
  /** Postiz's clock now: the Date of its latest answer (the upload's, before a create) carried on with a monotonic clock. */
  postizNow: number | null;
  /** The PC's offset from UTC at a moment (minutes east): the local day and quiet hours, DST included. */
  offsetMinAt: (at: number) => number;
  appVersion: string;
  /** The build verifies licences with the real key (desktop/scripts/build.mjs). */
  realKey: boolean;
  /** Null: the page has not handed it since the app started. */
  licence: AutonomyLicence | null;
  postiz: {
    configured: boolean;
    baseUrl: string;
    organizationId: string | null;
    /** ISO time the key was last saved. */
    keySavedAt: string | null;
    /** The per-post route answers (Postiz 2.18 or newer); null: not asked yet. */
    postNumbers: boolean | null;
    /** The per-post route, asked again just before a Trial Reel's create; null: not asked. */
    trialRoute: boolean | null;
    channels: readonly AutonomyLiveChannel[];
  };
  /**
   * The learner as the main process reads it: its settings block (desktop/src/social/learner.ts), the newest pass and the
   * decision log. The owner's switches and locks come in as they stand now, since the learner reads them on its next pass
   * only: Trial Reels on, the pairs a day and the automatic-sharing confirmation, "Ask again" for Trial Reels (trialRetryAt),
   * the skipped questions and the fixed dials.
   */
  learner: Pick<LearnerSettings, "learn" | "paused" | "trialReels" | "pairsPerDay" | "autoShareOff" | "trialRetryAt" | "skipped" | "fixed"> & {
    /**
     * ISO time learning was last paused, turned off or switched back on (null: never): every item made before it waits for
     * the person, those of a pass made before the stop at once and any made while it was stopped once it is back on.
     */
    switchedAt: string | null;
    /** The newest pass id the main process recorded. */
    newestPassId: string | null;
    decisions: readonly Pick<LearnerDecision, "testId" | "decidedAt" | "verdict">[];
    /**
     * The channels the learner lets post Trial Reels now (lib/insights/learner.ts LearnerChannel.trialReels: Postiz 2.18 or
     * newer, the owner's pilot passed, and not turned off by "This account doesn't support Trial Reels").
     */
    trialChannels: readonly string[];
  };
  autopilot: { quietFrom: string; quietTo: string; language: TextLanguage };
  /** The whole posting queue (other proposals of the same clip count). */
  queue: readonly AutonomyItem[];
  /** Every post on the consented accounts: the audit's and Postiz's list. */
  posts: readonly AccountPost[];
  /** The app's create calls in the last hour (the audit). */
  createCallsLastHour: number;
  /** The main process's SHA-256 (hex) of a text. */
  digest: (text: string) => string;
  /** The crew's number reader (src/lib/crew/clip.ts numbersIn). */
  readNumbers: (text: string) => readonly number[];
  /** Names no post may carry (the Fight League roster's, other creators'). */
  names?: readonly string[];
}

/* ------------------------------------------------------------------ the stamp */

/** A value as JSON with its object keys sorted, so the same item always gives the same text. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v === undefined ? null : v)).join(",")}]`;
  if (isObj(value)) {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** What proposePass hashes, and the approver hashes again before each create: everything that would go out, and the stamp. */
export function stampText(item: Pick<AutonomyItem, "clipId" | "video" | "channels" | "when" | "thumbnailMs" | "createdAt"> & { pass: Omit<AutonomyStamp, "hash"> | AutonomyStamp | null }): string {
  const pass = item.pass ? { passId: item.pass.passId, date: item.pass.date, role: item.pass.role, testId: item.pass.testId, arm: item.pass.arm ?? null, pair: item.pass.pair, window: item.pass.window } : null;
  return stableJson({
    v: 1,
    clipId: item.clipId,
    video: item.video,
    channels: item.channels.map((c) => ({ integrationId: c.integrationId, platform: c.platform, text: c.text, settings: c.settings, lane: c.lane })),
    when: item.when,
    thumbnailMs: item.thumbnailMs ?? null,
    createdAt: item.createdAt,
    pass,
  });
}

/* ------------------------------------------------------------------ reasons */

/** Why an item waits for the person (or waits a little). `final`: it waits for the person for good. */
export const AUTONOMY_REASONS = {
  // provenance
  notLearner: true, // made by propose (Plan posts, Send to Posts tab) or by the person
  notProposed: true,
  held: true, // its card was opened
  edited: true,
  splitOff: true, // the part of a learner proposal the app may not post (TikTok and the rest)
  noStamp: true,
  hashChanged: true,
  olderPass: true, // the learner changed its plan since
  tooOld: true,
  beforeConsent: true, // proposed before the switch was turned on, or before the last Resume
  learningStopped: true, // proposed before learning was last paused, turned off or switched back on
  practised: true, // proposed during the practice day
  noTest: true, // a test, check or Trial Reel stamped without its test or block
  noPair: true, // a Trial Reel stamped without its pair
  testClosed: true, // its test or block has a verdict
  planChanged: true, // a verdict was written after it was made
  testSkipped: true, // the owner skipped its test's question, or fixed one of its dials
  trialsOff: true, // Trial Reels switched off, no pairs a day, automatic sharing not confirmed off, or the learner stopped them on its account
  trialUnsupported: true, // Postiz said the account cannot post Trial Reels
  trialLimit: true, // the account reached its Trial Reel limit less than 24 hours before its time
  otherProposal: true, // another proposal of the same clip is in the queue
  noTime: true,
  // lanes
  trialChannels: true, // a Trial Reel lists anything but one Instagram channel
  trialSettings: true, // a Trial Reel without is_trial_reel or MANUAL, or not a Reel (post_type "post")
  testChannels: true, // what is not the best settings (a test clip, a check's old clip, a rotation clip) lists YouTube or an unscored channel
  trialFieldOutsideTrial: true,
  laneMismatch: true, // a channel's stamped lane does not match the role
  story: true,
  typeMismatch: true, // settings.__type differs from the channel's platform
  // the clip
  clipMissing: true,
  notReviewed: true,
  rulesOnly: true,
  split: true,
  dropped: true,
  notKept: true, // the crew asked for a fix
  keepAnyway: true,
  stagePre: true,
  gateFailed: true,
  reviewFileMismatch: true, // the crew reviewed another file (a cut, a re-render, an editor output)
  watermarkFree: true,
  watermarkTest: true,
  watermarkUnknown: true,
  battleFamily: true,
  words: true, // the text gate (lib/desktop/autonomyText.ts)
  cardRules: true, // the card's own rules for the request (caption length, hashtags, the YouTube title)
  // accounts
  noAccount: true, // no channel of the item may be posted on its own
  repeatedAccount: true, // one account listed twice: two posts of one video at once
  platformNotAllowed: true,
  notConsented: true,
  accountGone: true,
  platformChanged: true,
  accountDisabled: true,
  profileChanged: true,
  youtubeChoices: true,
  postizOld: true, // Postiz is older than 2.18
  // time and volume
  missedTime: true, // nothing fits in its window any more
  duplicate: true, // this video was posted on the account before (a master and its cut are one)
  notYet: false, // its time is more than 90 minutes away
  // the whole approver, this tick
  paused: false,
  licenceMissing: false, // the page has not handed its licence since the app started
  testMode: false, // a build in licence test mode never posts on its own
  learningOff: false,
  learningPaused: false,
  clockUnknown: false, // no answer from Postiz yet to read its clock from
  clockOff: false, // the PC's clock differs from Postiz's by more than 5 minutes
  unsettled: false, // a create whose answer never came: nothing more until Postiz's list settles it
  createLimit: false, // 60 create calls in the last hour
  postizUnchecked: false, // Postiz's version is not known yet
  trialRouteUnchecked: false, // the per-post route was not asked again before this Trial Reel
} as const satisfies Record<string, boolean>;
export type AutonomyReason = keyof typeof AUTONOMY_REASONS;

/** Whether a reason makes an item wait for the person for good. */
export const isFinalReason = (r: AutonomyReason): boolean => AUTONOMY_REASONS[r];

/* ------------------------------------------------------------------ helpers */

const MANUAL = "MANUAL";
const TRIAL_ROLES: readonly SlotRole[] = ["trialA", "trialB"];
const TEST_ROLES: readonly SlotRole[] = ["test", "check"];
const isTrialRole = (role: SlotRole) => TRIAL_ROLES.includes(role);
const hasTrialField = (s: Record<string, unknown>) => own(s, "is_trial_reel") !== undefined || own(s, "graduation_strategy") !== undefined || own(s, "trial_params") !== undefined;
const accountOf = (consent: AutonomyConsent, channelId: string) => consent.accounts.find((a) => a.channelId === channelId) ?? null;

/** "1.7.0" against "1.6.12": negative when a is older. Anything after the three numbers is ignored. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (/^(\d+)\.(\d+)\.(\d+)/.exec(v) ?? []).slice(1, 4).map(Number);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** A moment's local minute of the day and local day number, with the PC's offset at that moment. */
export function localOf(at: number, offsetMinAt: (at: number) => number): { day: number; minute: number } {
  const local = at + offsetMinAt(at) * MINUTE_MS;
  const day = Math.floor(local / DAY_MS);
  return { day, minute: Math.floor((local - day * DAY_MS) / MINUTE_MS) };
}

/** Whether a post takes up its account: pending, out, or a create whose answer never came (not a draft, a failure or a deleted one). */
const occupies = (p: AccountPost) => (p.state === "QUEUE" || p.state === "PUBLISHED" || p.state === "intent") && !p.gone && !p.removed;

/** The channels of an item the app may post on its own (allowed platform, ticked in the consent), and the rest. */
export function splitChannels<C extends { integrationId: string; platform: string }>(channels: readonly C[], consent: AutonomyConsent | null): { auto: C[]; person: C[] } {
  const auto: C[] = [];
  const person: C[] = [];
  for (const c of channels) (consent && isAutonomyPlatform(c.platform) && accountOf(consent, c.integrationId) ? auto : person).push(c);
  return { auto, person };
}

/* ------------------------------------------------------------------ the lane rules */

/**
 * The lane rules for a learner proposal, on its channels as stamped (before anything is split off, and again before each
 * create): a Trial Reel has exactly one channel, Instagram, a Reel with is_trial_reel and MANUAL in the trial lane; what is
 * not the best settings lists only scored channels (Instagram normal Reels and TikTok) in the normal lane: a test clip, a
 * check's old clip (and a check stamped without its arm) and a newcomer test's rotation clip; YouTube and every other channel
 * take the best settings only, a best clip or a check's new clip, which is the new best (the learner sends a check's new clips
 * to every channel, lib/insights/learner.ts channelsFor, as every slot of the day is a check slot while a check runs); a best
 * clip carries no trial field; no Instagram story; settings.__type is the channel's platform. `arm` is the stamp's.
 */
export function laneProblems(role: SlotRole, channels: readonly Pick<AutonomyItemChannel, "platform" | "settings" | "lane">[], arm: string | null = null): AutonomyReason[] {
  const out = new Set<AutonomyReason>();
  if (channels.some((c) => own(c.settings, "__type") !== c.platform)) out.add("typeMismatch");
  if (channels.some((c) => familyOf(c.platform) === "instagram" && own(c.settings, "post_type") === "story")) out.add("story");
  if (isTrialRole(role)) {
    if (channels.length !== 1 || familyOf(channels[0].platform) !== "instagram") out.add("trialChannels");
    for (const c of channels) {
      if (c.lane !== "trialReel") out.add("laneMismatch");
      const postType = own(c.settings, "post_type");
      if (own(c.settings, "is_trial_reel") !== true || own(c.settings, "graduation_strategy") !== MANUAL || (postType !== undefined && postType !== "post")) out.add("trialSettings");
    }
  } else {
    const bestSettings = (role === "best" && arm !== "rotation") || (role === "check" && arm === "new");
    for (const c of channels) {
      if (c.lane !== "normal") out.add("laneMismatch");
      if (hasTrialField(c.settings)) out.add("trialFieldOutsideTrial");
      if (!bestSettings && familyOf(c.platform) !== "instagram" && c.platform !== "tiktok") out.add("testChannels");
    }
  }
  return [...out];
}

/**
 * The questions of a learner test id, as lib/insights/learner.ts testIdOf writes them ("n3.length.standard.short", a block's
 * "t2.<question>~<question>", a check's "c4.<its test's id>", a generation after "Forget my numbers" as "n0g1."), each with its
 * dial and its question key (lib/insights/dials.ts questionKey: the dial, its two arms in a fixed order and a newcomer's
 * template). Empty: not a test id the learner writes. tests/autonomy.test.ts keeps it equal to the learner's own parser,
 * which this file cannot import (the main process bundles it alone).
 */
export function testQuestionsOf(testId: string | null | undefined): { dial: string; key: string }[] {
  const m = typeof testId === "string" ? /^([ntc])(\d{1,6})(?:g([1-9]\d{0,3}))?\.(.+)$/.exec(testId) : null;
  if (!m) return [];
  if (m[1] === "c") return m[4].startsWith("c") ? [] : testQuestionsOf(m[4]);
  const out: { dial: string; key: string }[] = [];
  for (const text of m[4].split("~")) {
    const [dial, a, b, subject, ...rest] = text.split(".");
    if (!dial || !a || !b || rest.length || subject === "") return [];
    const pair = [a, b].sort().join("~");
    out.push({ dial, key: subject ? `${dial}:${pair}:${subject}` : `${dial}:${pair}` });
  }
  return out;
}

/**
 * What the owner changed on the Learning card since an item was stamped: the learner reads it on its next pass only, so an
 * item stamped before it waits for the person for good.
 *  - A Trial Reel: Trial Reels switched off, no pairs a day, or Instagram's automatic sharing no longer confirmed off; its
 *    account no longer among the learner's Trial Reel channels; Postiz's "This account doesn't support Trial Reels" on any
 *    post of the account, the person's too, since the owner last asked for Trial Reels again (the plan: trials go off for that
 *    account); and Instagram's Trial Reel limit on any post of the account less than 24 hours before the item's time (the
 *    plan: trials pause 24 hours there).
 *  - A test, check or Trial Reel: one of its test's questions skipped, or one of its dials fixed.
 */
export function learnerStopProblems(item: Pick<AutonomyItem, "channels" | "when" | "pass">, ctx: Pick<AutonomyContext, "learner" | "posts">): AutonomyReason[] {
  const pass = item.pass;
  if (!pass) return [];
  const learner = ctx.learner;
  const out = new Set<AutonomyReason>();
  if (isTrialRole(pass.role)) {
    if (!learner.trialReels || !(learner.pairsPerDay >= 1) || !learner.autoShareOff) out.add("trialsOff");
    const retry = ms(learner.trialRetryAt);
    const since = Number.isFinite(retry) ? retry : -Infinity;
    const planned = ms(item.when);
    for (const c of item.channels) {
      if (!learner.trialChannels.includes(c.integrationId)) out.add("trialsOff");
      for (const p of ctx.posts) {
        if (p.channelId !== c.integrationId || p.state !== "ERROR") continue;
        const kind = classifyPostizError(p.error, p.platform ?? c.platform).kind;
        if (kind === "trialUnsupported" && eventTime(p) > since) out.add("trialUnsupported");
        if (kind === "trialLimit" && !(planned >= eventTime(p) + TRIAL_LIMIT_PAUSE_H * HOUR_MS)) out.add("trialLimit");
      }
    }
  }
  if (TEST_ROLES.includes(pass.role) || isTrialRole(pass.role)) {
    const fixed = (dial: string) => !!own(learner.fixed as Record<string, unknown>, dial as DialId);
    if (testQuestionsOf(pass.testId).some((q) => learner.skipped.includes(q.key) || fixed(q.dial))) out.add("testSkipped");
  }
  return [...out];
}

/**
 * What the stamp itself must carry for its role: a test, check or Trial Reel its test or block (or its verdict could never
 * close it), and a Trial Reel its pair (or the pair's 2 hours could never be kept).
 */
export function stampProblems(pass: Pick<AutonomyStamp, "role" | "testId" | "pair">): AutonomyReason[] {
  const out: AutonomyReason[] = [];
  if ((TEST_ROLES.includes(pass.role) || isTrialRole(pass.role)) && !pass.testId) out.push("noTest");
  if (isTrialRole(pass.role) && (pass.pair === null || !Number.isInteger(pass.pair))) out.push("noPair");
  return out;
}

/* ------------------------------------------------------------------ the item */

/** Why an item is not the learner's own, unchanged, current proposal (empty: it is). */
export function eligibilityProblems(item: AutonomyItem, state: AutonomySettings, ctx: AutonomyContext): AutonomyReason[] {
  const out: AutonomyReason[] = [];
  const consent = state.consent;
  if (item.origin !== "learnerPass") out.push("notLearner");
  if (item.splitFrom) out.push("splitOff");
  if (item.status !== "proposed") out.push("notProposed");
  if (item.held) out.push("held");
  if (item.by !== "ai") out.push("edited");
  if (!item.pass) {
    out.push("noStamp");
    return out;
  }
  if (ctx.digest(stampText(item)) !== item.pass.hash) out.push("hashChanged");
  out.push(...stampProblems(item.pass));
  if (!ctx.learner.newestPassId || item.pass.passId !== ctx.learner.newestPassId) out.push("olderPass");
  const created = ms(item.createdAt);
  if (!Number.isFinite(created) || ctx.now - created > AUTONOMY_ITEM_MAX_AGE_MS) out.push("tooOld");
  // Pause learning, or learning off, sends every item made before it back to the person for good, and so does switching it
  // back on (an unreadable time: every item)
  const switched = ms(ctx.learner.switchedAt);
  if (ctx.learner.switchedAt !== null && !(created > switched)) out.push("learningStopped");
  if (consent) {
    const since = Math.max(ms(consent.at), Number.isFinite(ms(state.resumedAt)) ? ms(state.resumedAt) : -Infinity);
    if (!(created > since)) out.push("beforeConsent");
    // the practice day ends on Postiz's clock, and the item's time is the PC's: the 5 minutes the two may differ count as
    // practice too, so an item that could have been shown "Would go out at" is never sent later
    if (consent.practise && created < ms(consent.at) + AUTONOMY_PRACTICE_MS + AUTONOMY_CLOCK_SKEW_MS && !practising(state, ctx)) out.push("practised");
  }
  const decisions = ctx.learner.decisions;
  if (item.pass.testId && decisions.some((d) => d.testId === item.pass!.testId)) out.push("testClosed");
  if (decisions.some((d) => ms(d.decidedAt) > created)) out.push("planChanged");
  const video = item.video;
  if (ctx.queue.some((q) => q.id !== item.id && q.splitFrom !== item.id && q.status !== "skipped" && (q.clipId === item.clipId || (video !== null && q.video === video)))) out.push("otherProposal");
  if (!item.when || !Number.isFinite(ms(item.when))) out.push("noTime");
  return out;
}

/** Why the clip may not go out unread: the crew's keep on this very file, a sealed render, not the battle family. */
export function clipProblems(clip: AutonomyClip | null | undefined): AutonomyReason[] {
  if (!clip || !clip.exists) return ["clipMissing"];
  const out: AutonomyReason[] = [];
  const r = clip.review;
  if (!r || r.verdict === "notReviewed") out.push("notReviewed");
  else {
    if (r.depth === "rules") out.push("rulesOnly");
    if (r.verdict === "split") out.push("split");
    if (r.verdict === "drop") out.push("dropped");
    if (r.verdict === "fix") out.push("notKept");
    if (r.keepAnyway) out.push("keepAnyway");
    if (r.stage !== "post") out.push("stagePre");
    if (r.gates.length > 0) out.push("gateFailed");
    if (!r.file || !clip.file || r.file.sha256.toLowerCase() !== clip.file.sha256.toLowerCase() || r.file.bytes !== clip.file.bytes) out.push("reviewFileMismatch");
  }
  if (clip.watermark === "free") out.push("watermarkFree");
  else if (clip.watermark === "sealedTest") out.push("watermarkTest");
  else if (clip.watermark !== "sealed") out.push("watermarkUnknown");
  if (clip.family === "battle" || clip.mode === "fightLeague") out.push("battleFamily");
  return out;
}

/** Why the item's accounts may not be posted to on its own: the consent, the allow-list and Postiz's live list. */
export function accountProblems(item: Pick<AutonomyItem, "channels">, consent: AutonomyConsent, ctx: Pick<AutonomyContext, "postiz">): AutonomyReason[] {
  const out = new Set<AutonomyReason>();
  if (item.channels.length === 0) out.add("noAccount");
  // as the card's own check (checkSocialPostRequest): Postiz would make two posts of one video on one account at once
  if (new Set(item.channels.map((c) => c.integrationId)).size !== item.channels.length) out.add("repeatedAccount");
  for (const c of item.channels) {
    if (!isAutonomyPlatform(c.platform)) {
      out.add("platformNotAllowed");
      continue;
    }
    const account = accountOf(consent, c.integrationId);
    if (!account) {
      out.add("notConsented");
      continue;
    }
    const live = ctx.postiz.channels.find((l) => l.id === c.integrationId);
    if (!live) {
      out.add("accountGone");
      continue;
    }
    if (live.platform !== c.platform || live.platform !== account.platform || own(c.settings, "__type") !== live.platform) out.add("platformChanged");
    if (live.disabled || live.refreshNeeded) out.add("accountDisabled");
    if ((live.profile ?? "") !== account.profile) out.add("profileChanged");
    if (account.platform === "youtube" && !account.youtube) out.add("youtubeChoices");
  }
  return [...out];
}

/** The card channels the request is built from: the stamped words, the card's settings, and YouTube's choices from the consent only. */
function cardChannelsOf(item: Pick<AutonomyItem, "channels" | "pass">, consent: AutonomyConsent): CardChannel[] {
  return item.channels.map((c) => {
    const account = accountOf(consent, c.integrationId);
    if (familyOf(c.platform) === "youtube") {
      const title = typeof own(c.settings, "title") === "string" ? (own(c.settings, "title") as string) : "";
      return { id: c.integrationId, platform: c.platform, name: "", text: c.text, settings: { __type: "youtube", title, type: account?.youtube?.type, selfDeclaredMadeForKids: account?.youtube?.selfDeclaredMadeForKids } };
    }
    return { id: c.integrationId, platform: c.platform, name: "", text: c.text, settings: { __type: c.platform as "instagram" | "instagram-standalone", post_type: "post" } };
  });
}

/**
 * The request the main process sends for an item it approved itself: what the card would send for the same choices
 * (lib/desktop/socialCard.ts providerSettingsOf), YouTube's visibility and made-for-kids from the consent only, and on a
 * Trial Reel Instagram's two trial fields with MANUAL. `at` is the time scheduleFor picked.
 */
export function requestOfProposal(item: Pick<AutonomyItem, "clipId" | "channels" | "pass" | "thumbnailMs">, at: number, consent: AutonomyConsent): SocialPostRequest {
  const trial = !!item.pass && isTrialRole(item.pass.role);
  return {
    clipId: item.clipId,
    channels: cardChannelsOf(item, consent).map((c) => {
      const settings = providerSettingsOf(c);
      return { id: c.id, platform: c.platform, text: c.text, settings: trial && familyOf(c.platform) === "instagram" ? { ...settings, is_trial_reel: true, graduation_strategy: MANUAL } : settings };
    }),
    when: new Date(at).toISOString(),
    ...(item.thumbnailMs !== undefined ? { thumbnailMs: item.thumbnailMs } : {}),
  };
}

/** The card's own rules on the request the app would send (caption length, Instagram's hashtags, YouTube's title and choices). */
export function cardRuleProblems(item: Pick<AutonomyItem, "channels" | "pass">, consent: AutonomyConsent): CardProblem[] {
  return cardChannelsOf(item, consent).flatMap((c) => channelProblems(c));
}

/** The words the text gate reads: each channel's text and, on YouTube, its title. */
export function wordsOf(item: Pick<AutonomyItem, "channels">, clip: Pick<AutonomyClip, "facts">, ctx: Pick<AutonomyContext, "autopilot" | "names" | "readNumbers">): TextProblem[] {
  return textProblems({
    channels: item.channels.map((c) => ({ id: c.integrationId, platform: c.platform, text: c.text, title: typeof own(c.settings, "title") === "string" ? (own(c.settings, "title") as string) : null })),
    language: ctx.autopilot.language,
    facts: clip.facts,
    names: ctx.names,
    readNumbers: ctx.readNumbers,
  });
}

/** Every reason an item may not go out on its own, before its time is picked (empty: it may, if a time fits). */
export function autonomyProblems(item: AutonomyItem, clip: AutonomyClip | null | undefined, state: AutonomySettings, ctx: AutonomyContext): { reasons: AutonomyReason[]; words: TextProblem[]; card: CardProblem[] } {
  const reasons = new Set<AutonomyReason>(eligibilityProblems(item, state, ctx));
  const consent = state.consent;
  if (item.pass) for (const r of laneProblems(item.pass.role, item.channels, item.pass.arm ?? null)) reasons.add(r);
  for (const r of learnerStopProblems(item, ctx)) reasons.add(r);
  for (const r of clipProblems(clip)) reasons.add(r);
  let words: TextProblem[] = [];
  let card: CardProblem[] = [];
  if (consent) {
    for (const r of accountProblems(item, consent, ctx)) reasons.add(r);
    card = cardRuleProblems(item, consent);
    if (card.length) reasons.add("cardRules");
  }
  if (clip) {
    words = wordsOf(item, clip, ctx);
    if (words.length) reasons.add("words");
  }
  if (ctx.postiz.postNumbers === false) reasons.add("postizOld");
  for (const c of item.channels) {
    if (ctx.posts.some((p) => p.channelId === c.integrationId && ((item.video !== null && p.video === item.video) || p.clipId === item.clipId))) reasons.add("duplicate");
  }
  return { reasons: [...reasons], words, card };
}

/* ------------------------------------------------------------------ the time */

/** What stopped a time from fitting. */
export type ScheduleBlock = "window" | "licenceEnd" | "quiet" | "spacing" | "dayFull" | "trialPairsFull" | "pairGap";
export type Schedule = { kind: "at"; at: number } | { kind: "later"; at: number } | { kind: "none"; reason: ScheduleBlock };

/** What stops `at` on the item's accounts (null: it fits): quiet hours, the spacing on both sides, the day's caps, the pair's gap. */
function blockAt(at: number, item: AutonomyItem, consent: AutonomyConsent, ctx: AutonomyContext, posts: readonly AccountPost[], siblingAt: number | null): ScheduleBlock | null {
  if (inQuietMinutes(localOf(at, ctx.offsetMinAt).minute, ctx.autopilot.quietFrom, ctx.autopilot.quietTo)) return "quiet";
  const trial = !!item.pass && isTrialRole(item.pass.role);
  for (const c of item.channels) {
    const account = accountOf(consent, c.integrationId);
    if (!account) continue;
    const mine = posts.filter((p) => p.channelId === c.integrationId && occupies(p));
    if (mine.some((p) => Math.abs(ms(p.at) - at) < AUTONOMY_SPACING_MS)) return "spacing";
    // the pairs the consent named, and no more than the owner's pairs a day on the Learning card now
    const learnerPairs = Number.isFinite(ctx.learner.pairsPerDay) ? Math.max(0, Math.floor(ctx.learner.pairsPerDay)) : 0;
    const pairs = familyOf(account.platform) === "instagram" ? Math.min(account.trialPairs, learnerPairs) : 0;
    const total = Math.min(account.perDay + 2 * pairs, AUTONOMY_CHANNEL_DAY_MAX);
    const isTrialPost = (p: AccountPost) => p.lane === "trialReel";
    if (countOver(mine, at, ctx) + 1 > total) return "dayFull";
    if (trial) {
      if (familyOf(c.platform) !== "instagram" || countOver(mine.filter(isTrialPost), at, ctx) + 1 > 2 * pairs) return "trialPairsFull";
    } else if (countOver(mine.filter((p) => p.by === "app" && !isTrialPost(p)), at, ctx) + 1 > account.perDay) return "dayFull";
  }
  if (trial && siblingAt !== null && Math.abs(siblingAt - at) < AUTONOMY_PAIR_GAP_MS) return "pairGap";
  return null;
}

/**
 * The most posts of a list that share a day with `at`: its local day, and any 24 hours that hold it (every window that holds
 * `at` is checked, so posts before and after it count, across midnight and a DST change alike).
 *
 * The windows [s, s + 24 h) that hold `at` start in (at - 24 h, at]. As s moves forward a window only loses a post when s
 * passes it, so its count is highest at the first start or where a later post comes in; moving such a start forward to the
 * next post at or before `at`, or to `at` itself, loses nothing. So those starts are all there is to try: the first, every
 * earlier post's, and `at`'s own (the window that holds the posts after `at`, on the next day too).
 */
export function countOver(posts: readonly AccountPost[], at: number, ctx: Pick<AutonomyContext, "offsetMinAt">): number {
  const times = posts.map((p) => ms(p.at)).filter((t) => Number.isFinite(t));
  const day = localOf(at, ctx.offsetMinAt).day;
  const sameDay = times.filter((t) => localOf(t, ctx.offsetMinAt).day === day).length;
  const starts = [at - DAY_MS + 1, ...times.filter((t) => t > at - DAY_MS && t <= at), at];
  let rolling = 0;
  for (const s of starts) rolling = Math.max(rolling, times.filter((t) => t >= s && t < s + DAY_MS).length);
  return Math.max(sameDay, rolling);
}

/** The other reel of a Trial Reel pair: its time, from the posts already made or the queue. */
function siblingTime(item: AutonomyItem, ctx: AutonomyContext, posts: readonly AccountPost[]): number | null {
  const pass = item.pass;
  if (!pass || !isTrialRole(pass.role) || pass.testId === null || pass.pair === null) return null;
  const post = posts.find((p) => p.testId === pass.testId && p.pair === pass.pair && p.clipId !== item.clipId && occupies(p));
  if (post) return ms(post.at);
  const other = ctx.queue.find((q) => q.id !== item.id && q.pass && q.pass.testId === pass.testId && q.pass.pair === pass.pair && q.pass.role !== pass.role && q.status === "proposed" && q.when);
  return other?.when ? ms(other.when) : null;
}

/**
 * The time an item goes out, picked just before each create attempt (the 429 retry included): its planned time when that is
 * at least 60 minutes away by Postiz's clock and fits; else the earliest minute at least 60 minutes away inside the slot's
 * window that fits (outside quiet hours, the spacing on both sides, the day's caps, 2 hours from its pair), strictly before
 * the licence's end. "at": create it now (the time is 60 to 90 minutes away); "later": a time fits but is more than 90 minutes
 * away; "none": nothing fits any more ("Missed its time"), with what stopped the first time it tried.
 */
export function scheduleFor(item: AutonomyItem, state: AutonomySettings, ctx: AutonomyContext, postizNow: number, posts: readonly AccountPost[] = ctx.posts): Schedule {
  const consent = state.consent;
  const planned = ms(item.when);
  if (!consent || !Number.isFinite(planned)) return { kind: "none", reason: "window" };
  const from = item.pass?.window ? ms(item.pass.window.from) : planned;
  const windowTo = item.pass?.window ? ms(item.pass.window.to) : planned;
  const licenceEnd = ctx.licence?.expiresAt ? ms(ctx.licence.expiresAt) : Infinity;
  // The window's end is a time a post may take; the licence's end is not: at that very moment Pro has ended (pauseCheck,
  // resumeProblems and consentProblems all count expiresAt <= now as ended), so a post's time stays strictly before it.
  const inside = (at: number) => at >= from && at <= windowTo && at < licenceEnd;
  const earliest = Math.ceil((postizNow + AUTONOMY_LEAD_MS) / MINUTE_MS) * MINUTE_MS;
  const sibling = siblingTime(item, ctx, posts);
  const verdict = (at: number): Schedule => (at - postizNow <= AUTONOMY_MAX_LEAD_MS ? { kind: "at", at } : { kind: "later", at });
  let first: ScheduleBlock | null = null;
  if (planned >= earliest && inside(planned)) {
    const block = blockAt(planned, item, consent, ctx, posts, sibling);
    if (!block) return verdict(planned);
    first = block;
  }
  const start = Math.max(earliest, Math.ceil(from / MINUTE_MS) * MINUTE_MS);
  for (let at = start; inside(at) && at <= start + DAY_MS; at += MINUTE_MS) {
    const block = blockAt(at, item, consent, ctx, posts, sibling);
    if (!block) return verdict(at);
    if (first === null) first = block;
  }
  if (first !== null) return { kind: "none", reason: first };
  // nothing was tried: the window had passed, or the licence ends before its first minute that is an hour away
  return { kind: "none", reason: start <= windowTo && start >= licenceEnd ? "licenceEnd" : "window" };
}

/* ------------------------------------------------------------------ pausing and the whole approver */

/** Whether the practice day runs (by Postiz's clock when known). */
export function practising(state: AutonomySettings, ctx: Pick<AutonomyContext, "now" | "postizNow">): boolean {
  const c = state.consent;
  return !!c && c.practise && (ctx.postizNow ?? ctx.now) < ms(c.at) + AUTONOMY_PRACTICE_MS;
}

/** Why autonomy turns Off (the consent is cleared, and the next on asks again). */
export type AutonomyOffReason = "appOlder";

export interface AutonomyCheck {
  off: AutonomyOffReason | null;
  /** A pause to record now (null: none new; an existing pause stays). */
  pause: AutonomyPause | null;
  /**
   * Its own still-scheduled posts to remove after a warning about an account (only when deleteOnWarning): every one Postiz
   * lists on any account a warning's pause or its 48 hours are about, on every tick they run (after Off too), until the app has
   * removed it (AccountPost.removed), so a post Postiz lists only after the warning (a create in flight, a create whose answer
   * came late) and one whose time has passed but that Postiz has not published yet go too. Each once per list.
   */
  deleteOwn: { channelId: string; postId: string }[];
}

/** When an event happened: when the watcher first saw it (an error, a post gone), else the post's own time. */
function eventTime(p: AccountPost): number {
  const seen = ms(p.seenAt);
  return Number.isFinite(seen) ? seen : ms(p.at);
}

/** The events a pause records from the posts and the learner's log: each pauses, or is noted on the pause that is on. */
const EVENT_REASONS: readonly AutonomyPauseReason[] = ["ownPostFailed", "unknownError", "ownPostDeleted", "wentBack"];
const isEventReason = (r: AutonomyPauseReason) => EVENT_REASONS.includes(r);

/**
 * Whether autonomy must turn Off or pause now, and why, and which of its own posts to remove. Conditions (the licence, the
 * key, the accounts, the consent version, the gap) and events after the consent and the last Resume (failed posts, warnings
 * about an account, its own posts gone, a change sent back).
 *  - A warning about an account counts for 48 hours whenever it came, before the consent or the last Resume too, and over
 *    any pause; the warnings seen when the cooldown was last recorded are counted already. Every consented account warned in
 *    one read is named on the pause (the first as its account, the rest as `otherChannels`), and so are the accounts of the
 *    warning's pause it replaces. While the stored cooldown runs (a warning, then Off and on again), it pauses for the rest
 *    of it.
 *  - While a warning's pause is on or its 48 hours run, its own still-scheduled posts on those accounts are listed for
 *    removal on every tick (`deleteOwn`), not only on the tick that records the warning.
 *  - While paused, an event comes back too, once: `paused` notes it on the pause, so the banner says it before Resume, and
 *    the events the pause has recorded are not taken again.
 */
export function pauseCheck(state: AutonomySettings, ctx: AutonomyContext): AutonomyCheck {
  const consent = state.consent;
  const cooldown = cooldownOf(state);
  const pausedFor = state.pause?.reason === "accountHealth" ? channelsOf(state.pause) : [];
  const removals = (warned: readonly string[]): AutonomyCheck["deleteOwn"] => {
    if (!state.deleteOnWarning) return [];
    const on = new Set([...warned, ...pausedFor, ...(cooldown && ms(cooldown.until) > ctx.now ? channelsOf(cooldown) : [])]);
    const out: AutonomyCheck["deleteOwn"] = [];
    for (const p of ctx.posts) {
      if (!on.has(p.channelId) || p.by !== "app" || p.state !== "QUEUE" || p.gone || p.removed || !p.postId) continue;
      if (!out.some((d) => d.channelId === p.channelId && d.postId === p.postId)) out.push({ channelId: p.channelId, postId: p.postId });
    }
    return out;
  };
  const check = (off: AutonomyOffReason | null, pause: AutonomyPause | null, warned: readonly string[] = []): AutonomyCheck => ({ off, pause, deleteOwn: removals(warned) });
  if (!consent) return check(null, null);
  if (compareVersions(ctx.appVersion, consent.appVersion) < 0) return check("appOlder", null);
  const nowIso = new Date(ctx.now).toISOString();
  const pause = (reason: AutonomyPauseReason, channelId: string | null = null, until: number | null = null): AutonomyPause => ({ reason, at: nowIso, until: until === null ? null : new Date(until).toISOString(), channelId });
  const healthPause = (channels: readonly string[], until: number): AutonomyPause => ({ reason: "accountHealth", at: nowIso, until: new Date(until).toISOString(), ...accountsOf(channels) });
  const resumed = ms(state.resumedAt);
  const since = Math.max(ms(consent.at), Number.isFinite(resumed) ? resumed : -Infinity);
  const consented = new Set(consent.accounts.map((a) => a.channelId));
  const isHealth = (p: AccountPost) => consented.has(p.channelId) && p.state === "ERROR" && isAccountHealth(classifyPostizError(p.error, p.platform).kind);

  // a warning about an account: on any post of a consented account, whoever made it, or the account off in Postiz. Every
  // account warned since the cooldown was recorded, and every account off that the warning's pause on now is not about yet
  const healthFrom = Math.max(Math.min(since, ctx.now - AUTONOMY_HEALTH_COOLDOWN_MS), cooldown ? ms(cooldown.at) : -Infinity);
  const offChannels = consent.accounts
    .filter((a) => {
      const live = ctx.postiz.channels.find((l) => l.id === a.channelId);
      return !!live && (live.disabled || live.refreshNeeded);
    })
    .map((a) => a.channelId);
  const warned = [...new Set([...ctx.posts.filter((p) => isHealth(p) && eventTime(p) > healthFrom).map((p) => p.channelId), ...offChannels.filter((c) => !pausedFor.includes(c))])];
  // the accounts of the warning's pause it replaces stay on it, so they are not taken as new on the next tick
  if (warned.length) return check(null, healthPause([...warned, ...pausedFor], ctx.now + AUTONOMY_HEALTH_COOLDOWN_MS), warned);
  if (!state.pause && cooldown && ms(cooldown.until) > ctx.now) return check(null, healthPause(channelsOf(cooldown), ms(cooldown.until)));

  // the events after the consent and the last Resume, and after those the pause on now has recorded
  const recorded = state.pause ? [state.pause, ...(state.pause.also ?? [])].filter((n) => isEventReason(n.reason)).map((n) => ms(n.at)) : [];
  const from = Math.max(since, ...recorded);
  const event = ((): AutonomyPause | null => {
    // a warning's own post is the warning's (above), not a failure of its own as well
    const failed = ctx.posts.find((p) => p.by === "app" && p.state === "ERROR" && !isHealth(p) && eventTime(p) > from);
    if (failed) return pause(classifyPostizError(failed.error, failed.platform).kind === "unknown" ? "unknownError" : "ownPostFailed", failed.channelId);
    const unknown = ctx.posts.find((p) => consented.has(p.channelId) && p.state === "ERROR" && eventTime(p) > from && classifyPostizError(p.error, p.platform).kind === "unknown");
    if (unknown) return pause("unknownError", unknown.channelId);
    const gone = ctx.posts.find((p) => p.by === "app" && p.gone && !p.removed && eventTime(p) > from);
    if (gone) return pause("ownPostDeleted", gone.channelId);
    if (ctx.learner.decisions.some((d) => d.verdict === "wentBack" && ms(d.decidedAt) > from)) return pause("wentBack");
    return null;
  })();
  if (state.pause) return check(null, event);

  if (consent.version < AUTONOMY_CONSENT_VERSION) return check(null, pause("consentVersion"));
  if (!ctx.postiz.configured) return check(null, pause("keyRemoved"));
  if (ms(ctx.postiz.keySavedAt) > since || ctx.postiz.baseUrl !== consent.postiz.baseUrl || (ctx.postiz.organizationId !== null && ctx.postiz.organizationId !== consent.postiz.organizationId)) return check(null, pause("keyChanged"));
  for (const a of consent.accounts) {
    const live = ctx.postiz.channels.find((l) => l.id === a.channelId);
    if (!live || live.platform !== a.platform || (live.profile ?? "") !== a.profile) return check(null, pause("accountChanged", a.channelId));
  }
  if (ctx.licence && (!ctx.licence.pro || (ctx.licence.expiresAt !== null && ms(ctx.licence.expiresAt) <= ctx.now))) return check(null, pause("proEnded"));
  const lastRun = Number.isFinite(ms(state.lastRunAt)) ? ms(state.lastRunAt) : ms(consent.at);
  if (ctx.now - lastRun > AUTONOMY_GAP_MS) return check(null, pause("gap"));
  return check(null, event);
}

/** Why Resume is not available yet (empty: one press resumes). */
export type ResumeProblem = "off" | "cooldown" | "consentVersion" | "appOlder" | "proEnded" | "testMode" | "keyRemoved" | "otherWorkspace" | "accountChanged" | "accountDisabled" | "learningOff" | "accountHealth" | "ownPostFailed" | "unknownError" | "ownPostDeleted" | "wentBack";

/**
 * Why Resume is not available yet (empty: one press resumes). A warning or an event the pause has not recorded yet comes
 * back by its reason: recorded first (pauseCheck, then paused), it is on the banner before the press that clears it.
 */
export function resumeProblems(state: AutonomySettings, ctx: AutonomyContext): ResumeProblem[] {
  const consent = state.consent;
  if (!consent) return ["off"];
  const out: ResumeProblem[] = [];
  if ((state.pause?.until && ms(state.pause.until) > ctx.now) || coolingDown(state, ctx.now)) out.push("cooldown");
  const fresh = pauseCheck(state, ctx).pause;
  if (state.pause && fresh && (fresh.reason === "accountHealth" || isEventReason(fresh.reason))) out.push(fresh.reason as ResumeProblem);
  if (consent.version < AUTONOMY_CONSENT_VERSION) out.push("consentVersion");
  if (compareVersions(ctx.appVersion, consent.appVersion) < 0) out.push("appOlder");
  if (!ctx.licence || !ctx.licence.pro || (ctx.licence.expiresAt !== null && ms(ctx.licence.expiresAt) <= ctx.now)) out.push("proEnded");
  if (!ctx.realKey || ctx.licence?.testMode) out.push("testMode");
  if (!ctx.postiz.configured) out.push("keyRemoved");
  else if (ctx.postiz.baseUrl !== consent.postiz.baseUrl || (ctx.postiz.organizationId !== null && ctx.postiz.organizationId !== consent.postiz.organizationId)) out.push("otherWorkspace");
  for (const a of consent.accounts) {
    const live = ctx.postiz.channels.find((l) => l.id === a.channelId);
    if (!live || live.platform !== a.platform || (live.profile ?? "") !== a.profile) out.push("accountChanged");
    else if (live.disabled || live.refreshNeeded) out.push("accountDisabled");
  }
  if (!ctx.learner.learn) out.push("learningOff");
  return [...new Set(out)];
}

/** The state after Resume (the caller checked resumeProblems is empty): no pause, and items made before now never qualify. The cooldown stays on record. */
export function resumed(state: AutonomySettings, now: number): AutonomySettings {
  return { ...state, pause: null, resumedAt: new Date(now).toISOString(), cooldown: cooldownOf(state) };
}

/**
 * The state after a pause pauseCheck returned. A warning about an account replaces the pause that is on (which it keeps as
 * a note) and records the cooldown; an event (a post of its own failed, an unknown error, one of its posts gone, a change
 * sent back) is noted on the pause that is on; any other pause never replaces one.
 */
export function paused(state: AutonomySettings, pause: AutonomyPause): AutonomySettings {
  const note = (p: AutonomyPause): AutonomyPauseNote => ({ reason: p.reason, at: p.at, channelId: p.channelId });
  const withNotes = (p: AutonomyPause, notes: AutonomyPauseNote[]): AutonomyPause => {
    const kept = notes.slice(-AUTONOMY_PAUSE_NOTES_MAX);
    const head: AutonomyPause = { reason: p.reason, at: p.at, until: p.until, channelId: p.channelId, ...(p.otherChannels?.length ? { otherChannels: p.otherChannels } : {}) };
    return kept.length ? { ...head, also: kept } : head;
  };
  if (pause.reason === "accountHealth") {
    const cooldown = laterCooldown(cooldownOf(state), healthCooldownOf(pause));
    return { ...state, pause: state.pause ? withNotes(pause, [...(state.pause.also ?? []), note(state.pause)]) : pause, cooldown };
  }
  if (!state.pause) return { ...state, pause };
  if (isEventReason(pause.reason)) return { ...state, pause: withNotes(state.pause, [...(state.pause.also ?? []), note(pause)]) };
  return state;
}

/** The state after Off: the consent cleared, so the next on asks again. The owner's "only tell me" choice and the account-health cooldown stay. */
export function turnedOff(state: AutonomySettings): AutonomySettings {
  return { ...DEFAULT_AUTONOMY, deleteOnWarning: state.deleteOnWarning, cooldown: cooldownOf(state) };
}

/** What the approver does with one item this tick. */
export type ItemOutcome =
  | { itemId: string; kind: "create"; at: number; request: SocialPostRequest }
  | { itemId: string; kind: "practise"; at: number }
  | { itemId: string; kind: "later"; at: number; reason: AutonomyReason }
  | { itemId: string; kind: "wait"; reasons: AutonomyReason[]; final: boolean; words: TextProblem[]; card: CardProblem[]; block?: ScheduleBlock };

export interface AutonomyDecision {
  status: "off" | "paused" | "waiting" | "practising" | "on";
  check: AutonomyCheck;
  /** Why nothing is created this tick, when the whole approver waits. */
  wait: AutonomyReason | null;
  items: ItemOutcome[];
}

/** Why the whole approver waits this tick (null: it may create), apart from a pause. */
export function globalWait(ctx: AutonomyContext): AutonomyReason | null {
  if (!ctx.realKey || ctx.licence?.testMode) return "testMode";
  if (!ctx.licence) return "licenceMissing";
  if (!ctx.learner.learn) return "learningOff";
  if (ctx.learner.paused) return "learningPaused";
  if (ctx.postizNow === null) return "clockUnknown";
  if (Math.abs(ctx.now - ctx.postizNow) > AUTONOMY_CLOCK_SKEW_MS) return "clockOff";
  if (ctx.postiz.postNumbers === null) return "postizUnchecked";
  if (ctx.posts.some((p) => p.state === "intent" && p.by === "app")) return "unsettled";
  if (ctx.createCallsLastHour >= AUTONOMY_CREATES_PER_HOUR) return "createLimit";
  return null;
}

/** The approver's learner items, in the order they are taken: by planned time, then age, then id. */
function ordered(queue: readonly AutonomyItem[]): AutonomyItem[] {
  const at = (i: AutonomyItem) => (Number.isFinite(ms(i.when)) ? ms(i.when) : Infinity);
  return queue
    .filter((i) => i.origin === "learnerPass" && i.status === "proposed")
    .sort((a, b) => at(a) - at(b) || ms(a.createdAt) - ms(b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** One item's outcome, with the approver's wait (a pause included) and the posts as they stand (the creates before it counted). */
function itemOutcome(item: AutonomyItem, clip: AutonomyClip | undefined, state: AutonomySettings, ctx: AutonomyContext, wait: AutonomyReason | null, practice: boolean, posts: readonly AccountPost[]): ItemOutcome & { trialRouteFailed?: boolean } {
  const { reasons, words, card } = autonomyProblems(item, clip, state, { ...ctx, posts });
  if (reasons.some(isFinalReason)) return { itemId: item.id, kind: "wait", reasons, final: true, words, card };
  if (wait !== null || ctx.postizNow === null || !state.consent) return { itemId: item.id, kind: "wait", reasons: [...reasons, wait ?? "clockUnknown"], final: false, words, card };
  const schedule = scheduleFor(item, state, ctx, ctx.postizNow, posts);
  if (schedule.kind === "none") return { itemId: item.id, kind: "wait", reasons: ["missedTime"], final: true, words, card, block: schedule.reason };
  if (schedule.kind === "later") return { itemId: item.id, kind: "later", at: schedule.at, reason: "notYet" };
  if (practice) return { itemId: item.id, kind: "practise", at: schedule.at };
  if (item.pass && isTrialRole(item.pass.role)) {
    // the per-post route is asked again just before a Trial Reel: unasked, it waits; failed, autonomy pauses
    if (ctx.postiz.trialRoute === null) return { itemId: item.id, kind: "wait", reasons: ["trialRouteUnchecked"], final: false, words, card };
    if (ctx.postiz.trialRoute === false) return { itemId: item.id, kind: "wait", reasons: ["paused"], final: false, words, card, trialRouteFailed: true };
  }
  return { itemId: item.id, kind: "create", at: schedule.at, request: requestOfProposal(item, schedule.at, state.consent) };
}

/** The pause of a Trial Reel whose per-post route failed just before its create. */
const trialPause = (now: number): AutonomyPause => ({ reason: "trialCheckFailed", at: new Date(now).toISOString(), until: null, channelId: null });

/**
 * One tick of the approver: whether autonomy turns Off or pauses (and which of its own posts to remove), and for every
 * learner item what happens now. An item that passes every rule and whose time is 60 to 90 minutes away is created (each
 * create counted against the next, as the main process makes them one at a time); one further away waits for a later tick;
 * the practice day only says when each would go out. Everything else waits for the person, with why (`final`: for good).
 */
export function decideAutonomy(state: AutonomySettings, ctx: AutonomyContext, clips: ReadonlyMap<string, AutonomyClip>): AutonomyDecision {
  const check = pauseCheck(state, ctx);
  if (!state.consent || check.off) return { status: "off", check, wait: null, items: [] };
  const isPaused = !!state.pause || !!check.pause;
  const wait = isPaused ? "paused" : globalWait(ctx);
  const practice = practising(state, ctx);
  const posts: AccountPost[] = [...ctx.posts];
  const items: ItemOutcome[] = [];
  let trialFailed = false;
  for (const item of ordered(ctx.queue)) {
    const { trialRouteFailed, ...outcome } = itemOutcome(item, clips.get(item.clipId), state, ctx, trialFailed ? "paused" : wait, practice, posts);
    items.push(outcome);
    if (trialRouteFailed) trialFailed = true;
    if (outcome.kind !== "create") continue;
    // the next item sees this one as made (the spacing, the caps, the pair's gap)
    for (const c of item.channels) posts.push({ channelId: c.integrationId, postId: null, at: new Date(outcome.at).toISOString(), state: "intent", by: "app", platform: c.platform, video: item.video, clipId: item.clipId, lane: c.lane, testId: item.pass?.testId ?? null, pair: item.pass?.pair ?? null });
  }
  if (trialFailed) {
    // nothing is created this tick: the pause comes first
    const held = items.map((o): ItemOutcome => (o.kind === "create" ? { itemId: o.itemId, kind: "wait", reasons: ["paused"], final: false, words: [], card: [] } : o));
    return { status: "paused", check: { ...check, pause: trialPause(ctx.now) }, wait: "paused", items: held };
  }
  const status: AutonomyDecision["status"] = isPaused ? "paused" : wait !== null ? "waiting" : practice ? "practising" : "on";
  return { status, check, wait, items };
}

/**
 * Just before a create attempt (and again before the 429 retry): every rule for that one item, with Postiz's clock taken from
 * the upload's own answer, and the time picked again. "create" with the time and the request, or why not; a pause or Off
 * found now comes back in `check`. Null: the item is not a learner proposal waiting in the queue.
 */
export function checkBeforeCreate(itemId: string, state: AutonomySettings, ctx: AutonomyContext, clips: ReadonlyMap<string, AutonomyClip>): { check: AutonomyCheck; outcome: ItemOutcome | null } {
  const check = pauseCheck(state, ctx);
  const item = ordered(ctx.queue).find((i) => i.id === itemId);
  if (!item) return { check, outcome: null };
  if (!state.consent || check.off) return { check, outcome: { itemId, kind: "wait", reasons: ["paused"], final: false, words: [], card: [] } };
  const wait = state.pause || check.pause ? "paused" : globalWait(ctx);
  const { trialRouteFailed, ...outcome } = itemOutcome(item, clips.get(item.clipId), state, ctx, wait, practising(state, ctx), ctx.posts);
  return trialRouteFailed && !check.pause && !state.pause ? { check: { ...check, pause: trialPause(ctx.now) }, outcome } : { check, outcome };
}

/** Whether the outcome watcher should read Postiz's list: one of its own posts is pending, or was published in the last 24 hours. */
export function watchNeeded(posts: readonly AccountPost[], now: number): boolean {
  return posts.some((p) => p.by === "app" && !p.removed && (p.state === "QUEUE" || p.state === "intent" || (p.state === "PUBLISHED" && now - ms(p.at) <= AUTONOMY_WATCH_AFTER_MS)));
}

/* ------------------------------------------------------------------ the consent screen */

/** What the owner chose on the consent screen. */
export interface ConsentDraft {
  accounts: AutonomyAccount[];
  /** "I understand the app will post for me without asking each time". */
  understood: boolean;
  /** "Practise for a day first" (ticked by default). */
  practise: boolean;
}

/** What the consent screen checks a draft against: the main process's context, and the stored block's account-health cooldown (cooldownOf). */
export type ConsentScreenContext = Pick<AutonomyContext, "now" | "appVersion" | "licence" | "realKey" | "postiz" | "learner"> & Pick<AutonomySettings, "cooldown">;

/** A value as JSON with its keys sorted, so two records compare by content alone. */
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));

/**
 * Why Turn on stays disabled (empty: it may turn on). A warning's 48 hours outlive Off, so a new consent waits them out. The
 * record makeConsent writes must be the one the next load reads back (sanitizeAutonomy), or the switch would turn Off with no
 * reason said: a workspace Postiz did not name ("workspaceUnknown") or anything else the stored block cannot hold
 * ("notRecordable") keeps it off.
 */
export function consentProblems(draft: ConsentDraft, ctx: ConsentScreenContext): ("cooldown" | "pro" | "testMode" | "noKey" | "workspaceUnknown" | "learningOff" | "noAccount" | "accountNotAllowed" | "accountGone" | "accountDisabled" | "youtubeChoices" | "perDay" | "trialPairs" | "notUnderstood" | "notRecordable")[] {
  const out: ReturnType<typeof consentProblems> = [];
  if (ctx.cooldown && ms(ctx.cooldown.until) > ctx.now) out.push("cooldown");
  if (!ctx.realKey || ctx.licence?.testMode) out.push("testMode");
  if (!ctx.licence || !ctx.licence.pro || (ctx.licence.expiresAt !== null && ms(ctx.licence.expiresAt) <= ctx.now)) out.push("pro");
  if (!ctx.postiz.configured) out.push("noKey");
  else if (!consentWorkspace(ctx.postiz)) out.push("workspaceUnknown");
  if (!ctx.learner.learn) out.push("learningOff");
  if (draft.accounts.length === 0) out.push("noAccount");
  for (const a of draft.accounts) {
    const live = ctx.postiz.channels.find((l) => l.id === a.channelId);
    if (!live) out.push("accountGone");
    else if (!isAutonomyPlatform(live.platform) || live.platform !== a.platform) out.push("accountNotAllowed");
    else if (live.disabled || live.refreshNeeded) out.push("accountDisabled");
    if (a.platform === "youtube" && !(a.youtube && (YOUTUBE_VISIBILITIES as readonly string[]).includes(a.youtube.type) && (a.youtube.selfDeclaredMadeForKids === "yes" || a.youtube.selfDeclaredMadeForKids === "no"))) out.push("youtubeChoices");
    if (!Number.isInteger(a.perDay) || a.perDay < AUTOPILOT_PER_DAY_MIN || a.perDay > AUTOPILOT_PER_DAY_MAX) out.push("perDay");
    if (!Number.isInteger(a.trialPairs) || a.trialPairs < 0 || a.trialPairs > AUTONOMY_TRIAL_PAIRS_MAX || (a.trialPairs > 0 && familyOf(a.platform) !== "instagram")) out.push("trialPairs");
  }
  if (!draft.understood) out.push("notUnderstood");
  if (!out.length) {
    const made = makeConsent(draft, ctx);
    if (!made || canonical(sanitizeConsent(JSON.parse(JSON.stringify(made)))) !== canonical(made)) out.push("notRecordable");
  }
  return [...new Set(out)];
}

/** The accounts the consent screen may offer a tick for: Instagram and YouTube only, live and on. Every other one "Waits for you". */
export function tickableChannels(channels: readonly AutonomyLiveChannel[]): { tickable: AutonomyLiveChannel[]; waits: AutonomyLiveChannel[] } {
  const tickable: AutonomyLiveChannel[] = [];
  const waits: AutonomyLiveChannel[] = [];
  for (const c of channels) (isAutonomyPlatform(c.platform) && !c.disabled ? tickable : waits).push(c);
  return { tickable, waits };
}

/**
 * The consent record of a draft the owner turned on (consentProblems was empty), with each account's profile as Postiz has it.
 * Null without a known workspace (consentWorkspace): no record is made that the next load would drop.
 */
export function makeConsent(draft: ConsentDraft, ctx: Pick<AutonomyContext, "now" | "appVersion" | "postiz">): AutonomyConsent | null {
  const workspace = consentWorkspace(ctx.postiz);
  if (!workspace) return null;
  return {
    version: AUTONOMY_CONSENT_VERSION,
    at: new Date(ctx.now).toISOString(),
    appVersion: ctx.appVersion,
    postiz: workspace,
    accounts: draft.accounts.map((a) => ({ ...a, profile: ctx.postiz.channels.find((l) => l.id === a.channelId)?.profile ?? "", youtube: a.platform === "youtube" ? a.youtube : null, trialPairs: familyOf(a.platform) === "instagram" ? a.trialPairs : 0 })),
    practise: draft.practise,
  };
}

const VISIBILITY_REACH: Readonly<Record<YouTubeVisibility, number>> = { private: 0, unlisted: 1, public: 2 };

/** Whether a new choice widens the consent, so the screen asks again: no consent yet, a new account, more posts or pairs, a wider YouTube audience, another made-for-kids answer, or a newer copy version. Narrowing never asks. */
export function consentWidens(prev: AutonomyConsent | null, next: Pick<AutonomyConsent, "accounts"> & { version?: number }): boolean {
  if (!prev) return true;
  if ((next.version ?? AUTONOMY_CONSENT_VERSION) > prev.version) return true;
  for (const a of next.accounts) {
    const before = prev.accounts.find((p) => p.channelId === a.channelId);
    if (!before || before.platform !== a.platform) return true;
    if (a.perDay > before.perDay || a.trialPairs > before.trialPairs) return true;
    if (a.youtube && before.youtube) {
      if (VISIBILITY_REACH[a.youtube.type] > VISIBILITY_REACH[before.youtube.type] || a.youtube.selfDeclaredMadeForKids !== before.youtube.selfDeclaredMadeForKids) return true;
    } else if (a.youtube && !before.youtube) return true;
  }
  return false;
}

// --- end autonomy ---
