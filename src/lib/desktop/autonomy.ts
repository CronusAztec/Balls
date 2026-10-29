import type { SocialPostRequest, SocialQueueBy, SocialQueueStatus } from "./contract";
import type { InsightLane } from "@/lib/insights/stats";
import type { LearnerDecision, RenderWatermark, SlotRole } from "@/lib/insights/learner";
import type { ClipReview } from "@/lib/crew/review";
import { AUTOPILOT_PER_DAY_MAX, AUTOPILOT_PER_DAY_MIN, inQuietMinutes } from "./autopilot";
import { YOUTUBE_VISIBILITIES, channelProblems, familyOf, providerSettingsOf, type CardChannel, type CardProblem, type YouTubeVisibility } from "./socialCard";
import { classifyPostizError, isAccountHealth } from "./postizErrors";
import { textProblems, type TextFacts, type TextLanguage, type TextProblem } from "./autonomyText";

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
 *    edited, from the newest pass, at most 24 hours old, made after the consent and the last Resume and after the practice
 *    day, with their test still open and no verdict written since, and no other proposal of the same clip.
 *  - The lane rules: a Trial Reel has exactly one Instagram channel, a Reel (post_type "post"), is_trial_reel and MANUAL; a
 *    test or check clip goes only to scored channels (Instagram normal Reels; TikTok's part is split off); YouTube takes best
 *    clips only; a best clip carries no trial field.
 *  - Only clips the crew kept: a post-stage keep, quick or thorough, with no failed gate, on this very file (its SHA-256 and
 *    size), rendered sealed (never free or sealedTest), never the battle family; words that pass the text gate
 *    (lib/desktop/autonomyText.ts); and the card's own rules for the request it builds itself.
 *  - Just in time: a post is created only when its time is 60 to 90 minutes away by Postiz's clock, picked just before each
 *    create attempt (scheduleFor), inside the slot's window, outside quiet hours, never after the licence's end, 20 minutes from
 *    every other post on the account on both sides, 2 hours from the other reel of a Trial Reel pair, within the day's cap
 *    over the local day and any 24 hours (counting every post on the account, whoever made it), and never the same video
 *    twice on an account.
 *  - It pauses itself, and says why: on any failed post of its own, on any warning from the platform about a consented
 *    account (48 hours before Resume, and its own still-scheduled posts on that account removed unless the owner chose "only
 *    tell me"), on an error text Postiz's table does not know (lib/desktop/postizErrors.ts, fail closed), on one of its posts
 *    deleted in Postiz, on a change the learner sent back, when Pro ends, when the key or an account changes, on a new consent
 *    version, and after more than 48 hours without running. An app older than the one that recorded the consent turns it
 *    Off.
 *
 * Pure and deterministic: no clock (the PC's time and Postiz's come in), no randomness, no file. The hash function, the
 * crew's number reader and the PC's UTC offset at a moment (DST) are passed in. It imports only light modules the main process
 * can bundle (the contract and the autopilot's rules, the card's rules, the error table and the text gate) and types.
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
/** One post per account every 20 minutes, on both sides of every post (desktop/src/social/audit.ts CHANNEL_COOLDOWN_MS, C7). */
export const AUTONOMY_SPACING_MS = 20 * MINUTE_MS;
/** The two reels of a Trial Reel pair go out at least this far apart. */
export const AUTONOMY_PAIR_GAP_MS = 2 * HOUR_MS;
/** Create calls an hour from one key the app stays under (desktop/src/social/audit.ts CREATE_CALLS_PER_HOUR). */
export const AUTONOMY_CREATES_PER_HOUR = 60;
/** Trial Reel pairs a day the consent may name on an Instagram account (lib/insights/learnerRules.ts PAIRS_PER_DAY_MAX). */
export const AUTONOMY_TRIAL_PAIRS_MAX = 2;
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

export interface AutonomyPause {
  reason: AutonomyPauseReason;
  /** ISO time it paused. */
  at: string;
  /** Resume waits until then (ISO), after a warning about an account; null: as soon as the cause is gone. */
  until: string | null;
  /** The account it concerns, when one. */
  channelId: string | null;
}

/** The config's "autonomy" block. */
export interface AutonomyState {
  /** Null: off (the default, and after Off). */
  consent: AutonomyConsent | null;
  pause: AutonomyPause | null;
  /** ISO time of the last Resume. */
  resumedAt: string | null;
  /** After a warning about an account, remove the app's own still-scheduled posts there (the plan's default; the owner may say "only tell me"). */
  deleteOnWarning: boolean;
  /** ISO time the approver last ran. */
  lastRunAt: string | null;
}

export const DEFAULT_AUTONOMY: AutonomyState = { consent: null, pause: null, resumedAt: null, deleteOnWarning: true, lastRunAt: null };

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

/** A stored consent, or null: no date, no version, no workspace, or no valid account is no consent. */
export function sanitizeConsent(raw: unknown): AutonomyConsent | null {
  if (!isObj(raw)) return null;
  const version = own(raw, "version");
  const at = isoOrNull(own(raw, "at"));
  const appVersion = boundedString(own(raw, "appVersion"), 40);
  const postiz = own(raw, "postiz");
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1 || !at || !appVersion || !/^\d+\.\d+\.\d+/.test(appVersion) || !isObj(postiz)) return null;
  const baseUrl = boundedString(own(postiz, "baseUrl"), 500);
  const organizationId = boundedString(own(postiz, "organizationId"), 511);
  if (!baseUrl || !organizationId) return null;
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

/** The stored block over the defaults: unknown keys dropped, a consent without a date or an account dropped (so: off). */
export function sanitizeAutonomy(raw: unknown): AutonomyState {
  if (!isObj(raw)) return { ...DEFAULT_AUTONOMY };
  const consent = sanitizeConsent(own(raw, "consent"));
  const p = own(raw, "pause");
  let pause: AutonomyPause | null = null;
  if (isObj(p)) {
    const reason = own(p, "reason");
    const at = isoOrNull(own(p, "at"));
    if ((AUTONOMY_PAUSE_REASONS as readonly unknown[]).includes(reason) && at) {
      const channelId = boundedString(own(p, "channelId"), 511);
      pause = { reason: reason as AutonomyPauseReason, at, until: isoOrNull(own(p, "until")), channelId };
    }
  }
  return {
    consent,
    // a pause without a consent is no pause: off is off
    pause: consent ? pause : null,
    resumedAt: isoOrNull(own(raw, "resumedAt")),
    deleteOnWarning: own(raw, "deleteOnWarning") !== false,
    lastRunAt: isoOrNull(own(raw, "lastRunAt")),
  };
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
  learner: {
    learn: boolean;
    paused: boolean;
    /** The newest pass id the main process recorded. */
    newestPassId: string | null;
    decisions: readonly Pick<LearnerDecision, "testId" | "decidedAt" | "verdict">[];
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
  const pass = item.pass ? { passId: item.pass.passId, date: item.pass.date, role: item.pass.role, testId: item.pass.testId, pair: item.pass.pair, window: item.pass.window } : null;
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
  practised: true, // proposed during the practice day
  testClosed: true, // its test or block has a verdict
  planChanged: true, // a verdict was written after it was made
  otherProposal: true, // another proposal of the same clip is in the queue
  noTime: true,
  // lanes
  trialChannels: true, // a Trial Reel lists anything but one Instagram channel
  trialSettings: true, // a Trial Reel without is_trial_reel or MANUAL, or not a Reel (post_type "post")
  testChannels: true, // a test or check clip lists YouTube or an unscored channel
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
const occupies = (p: AccountPost) => (p.state === "QUEUE" || p.state === "PUBLISHED" || p.state === "intent") && !p.gone;

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
 * create): a Trial Reel has exactly one channel, Instagram, a Reel with is_trial_reel and MANUAL in the trial lane; a test or
 * check clip lists only scored channels (Instagram normal Reels and TikTok) in the normal lane; a best clip carries no
 * trial field; no Instagram story; settings.__type is the channel's platform.
 */
export function laneProblems(role: SlotRole, channels: readonly Pick<AutonomyItemChannel, "platform" | "settings" | "lane">[]): AutonomyReason[] {
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
    for (const c of channels) {
      if (c.lane !== "normal") out.add("laneMismatch");
      if (hasTrialField(c.settings)) out.add("trialFieldOutsideTrial");
      if (TEST_ROLES.includes(role) && familyOf(c.platform) !== "instagram" && c.platform !== "tiktok") out.add("testChannels");
    }
  }
  return [...out];
}

/* ------------------------------------------------------------------ the item */

/** Why an item is not the learner's own, unchanged, current proposal (empty: it is). */
export function eligibilityProblems(item: AutonomyItem, state: AutonomyState, ctx: AutonomyContext): AutonomyReason[] {
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
  if (!ctx.learner.newestPassId || item.pass.passId !== ctx.learner.newestPassId) out.push("olderPass");
  const created = ms(item.createdAt);
  if (!Number.isFinite(created) || ctx.now - created > AUTONOMY_ITEM_MAX_AGE_MS) out.push("tooOld");
  if (consent) {
    const since = Math.max(ms(consent.at), Number.isFinite(ms(state.resumedAt)) ? ms(state.resumedAt) : -Infinity);
    if (!(created > since)) out.push("beforeConsent");
    if (consent.practise && created < ms(consent.at) + AUTONOMY_PRACTICE_MS && !practising(state, ctx)) out.push("practised");
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
export function autonomyProblems(item: AutonomyItem, clip: AutonomyClip | null | undefined, state: AutonomyState, ctx: AutonomyContext): { reasons: AutonomyReason[]; words: TextProblem[]; card: CardProblem[] } {
  const reasons = new Set<AutonomyReason>(eligibilityProblems(item, state, ctx));
  const consent = state.consent;
  if (item.pass) for (const r of laneProblems(item.pass.role, item.channels)) reasons.add(r);
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
    const total = Math.min(account.perDay + (familyOf(account.platform) === "instagram" ? 2 * account.trialPairs : 0), AUTONOMY_CHANNEL_DAY_MAX);
    const isTrialPost = (p: AccountPost) => p.lane === "trialReel";
    if (countOver(mine, at, ctx) + 1 > total) return "dayFull";
    if (trial) {
      if (familyOf(c.platform) !== "instagram" || countOver(mine.filter(isTrialPost), at, ctx) + 1 > 2 * account.trialPairs) return "trialPairsFull";
    } else if (countOver(mine.filter((p) => p.by === "app" && !isTrialPost(p)), at, ctx) + 1 > account.perDay) return "dayFull";
  }
  if (trial && siblingAt !== null && Math.abs(siblingAt - at) < AUTONOMY_PAIR_GAP_MS) return "pairGap";
  return null;
}

/**
 * The most posts of a list that share a day with `at`: its local day, and any 24 hours that hold it (every window that holds
 * `at` is checked, so posts before and after it count, across midnight and a DST change alike).
 */
export function countOver(posts: readonly AccountPost[], at: number, ctx: Pick<AutonomyContext, "offsetMinAt">): number {
  const times = posts.map((p) => ms(p.at)).filter((t) => Number.isFinite(t));
  const day = localOf(at, ctx.offsetMinAt).day;
  const sameDay = times.filter((t) => localOf(t, ctx.offsetMinAt).day === day).length;
  const starts = [at - DAY_MS + 1, ...times.filter((t) => t > at - DAY_MS && t <= at)];
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
 * window that fits (outside quiet hours, the spacing on both sides, the day's caps, 2 hours from its pair), never after the
 * licence's end. "at": create it now (the time is 60 to 90 minutes away); "later": a time fits but is more than 90 minutes
 * away; "none": nothing fits any more ("Missed its time"), with what stopped the first time it tried.
 */
export function scheduleFor(item: AutonomyItem, state: AutonomyState, ctx: AutonomyContext, postizNow: number, posts: readonly AccountPost[] = ctx.posts): Schedule {
  const consent = state.consent;
  const planned = ms(item.when);
  if (!consent || !Number.isFinite(planned)) return { kind: "none", reason: "window" };
  const from = item.pass?.window ? ms(item.pass.window.from) : planned;
  const windowTo = item.pass?.window ? ms(item.pass.window.to) : planned;
  const licenceEnd = ctx.licence?.expiresAt ? ms(ctx.licence.expiresAt) : Infinity;
  const to = Math.min(windowTo, licenceEnd);
  const earliest = Math.ceil((postizNow + AUTONOMY_LEAD_MS) / MINUTE_MS) * MINUTE_MS;
  const sibling = siblingTime(item, ctx, posts);
  const verdict = (at: number): Schedule => (at - postizNow <= AUTONOMY_MAX_LEAD_MS ? { kind: "at", at } : { kind: "later", at });
  let first: ScheduleBlock | null = null;
  if (planned >= earliest && planned >= from && planned <= to) {
    const block = blockAt(planned, item, consent, ctx, posts, sibling);
    if (!block) return verdict(planned);
    first = block;
  }
  const start = Math.max(earliest, Math.ceil(from / MINUTE_MS) * MINUTE_MS);
  for (let at = start; at <= to && at <= start + DAY_MS; at += MINUTE_MS) {
    const block = blockAt(at, item, consent, ctx, posts, sibling);
    if (!block) return verdict(at);
    if (first === null) first = block;
  }
  if (first !== null) return { kind: "none", reason: first };
  return { kind: "none", reason: licenceEnd < windowTo && start <= windowTo ? "licenceEnd" : "window" };
}

/* ------------------------------------------------------------------ pausing and the whole approver */

/** Whether the practice day runs (by Postiz's clock when known). */
export function practising(state: AutonomyState, ctx: Pick<AutonomyContext, "now" | "postizNow">): boolean {
  const c = state.consent;
  return !!c && c.practise && (ctx.postizNow ?? ctx.now) < ms(c.at) + AUTONOMY_PRACTICE_MS;
}

/** Why autonomy turns Off (the consent is cleared, and the next on asks again). */
export type AutonomyOffReason = "appOlder";

export interface AutonomyCheck {
  off: AutonomyOffReason | null;
  /** A pause to record now (null: none new; an existing pause stays). */
  pause: AutonomyPause | null;
  /** Its own still-scheduled posts to remove after a warning about an account (only when deleteOnWarning). */
  deleteOwn: { channelId: string; postId: string }[];
}

/** When an event happened: when the watcher first saw it (an error, a post gone), else the post's own time. */
function eventTime(p: AccountPost): number {
  const seen = ms(p.seenAt);
  return Number.isFinite(seen) ? seen : ms(p.at);
}

/**
 * Whether autonomy must turn Off or pause now, and why. Conditions (the licence, the key, the accounts, the consent version,
 * the gap) and events after the consent and the last Resume (failed posts, warnings about an account, its own posts gone, a
 * change sent back). While paused, only a warning about an account is recorded over the pause, so its cooldown and the
 * removal of its own scheduled posts still happen.
 */
export function pauseCheck(state: AutonomyState, ctx: AutonomyContext): AutonomyCheck {
  const none: AutonomyCheck = { off: null, pause: null, deleteOwn: [] };
  const consent = state.consent;
  if (!consent) return none;
  if (compareVersions(ctx.appVersion, consent.appVersion) < 0) return { ...none, off: "appOlder" };
  const nowIso = new Date(ctx.now).toISOString();
  const pause = (reason: AutonomyPauseReason, channelId: string | null = null, until: number | null = null): AutonomyPause => ({ reason, at: nowIso, until: until === null ? null : new Date(until).toISOString(), channelId });
  const resumed = ms(state.resumedAt);
  const since = Math.max(ms(consent.at), Number.isFinite(resumed) ? resumed : -Infinity);
  const after = state.pause ? Math.max(since, ms(state.pause.at)) : since;
  const consented = new Set(consent.accounts.map((a) => a.channelId));

  // a warning about an account: on any post of a consented account, whoever made it, or the account off in Postiz
  const healthPost = ctx.posts.find((p) => consented.has(p.channelId) && p.state === "ERROR" && eventTime(p) > after && isAccountHealth(classifyPostizError(p.error, p.platform).kind));
  const offChannel = consent.accounts.find((a) => {
    const live = ctx.postiz.channels.find((l) => l.id === a.channelId);
    return !!live && (live.disabled || live.refreshNeeded);
  });
  const healthChannel = healthPost?.channelId ?? offChannel?.channelId ?? null;
  const alreadyHealth = state.pause?.reason === "accountHealth" && state.pause.channelId === healthChannel && (healthPost === undefined || ms(state.pause.at) >= eventTime(healthPost));
  if (healthChannel !== null && !alreadyHealth) {
    const deleteOwn = state.deleteOnWarning ? ctx.posts.filter((p) => p.channelId === healthChannel && p.by === "app" && p.state === "QUEUE" && !p.gone && p.postId && ms(p.at) > ctx.now).map((p) => ({ channelId: p.channelId, postId: p.postId! })) : [];
    return { off: null, pause: pause("accountHealth", healthChannel, ctx.now + AUTONOMY_HEALTH_COOLDOWN_MS), deleteOwn };
  }
  if (state.pause) return none;

  if (consent.version < AUTONOMY_CONSENT_VERSION) return { ...none, pause: pause("consentVersion") };
  if (!ctx.postiz.configured) return { ...none, pause: pause("keyRemoved") };
  if (ms(ctx.postiz.keySavedAt) > since || ctx.postiz.baseUrl !== consent.postiz.baseUrl || (ctx.postiz.organizationId !== null && ctx.postiz.organizationId !== consent.postiz.organizationId)) return { ...none, pause: pause("keyChanged") };
  for (const a of consent.accounts) {
    const live = ctx.postiz.channels.find((l) => l.id === a.channelId);
    if (!live || live.platform !== a.platform || (live.profile ?? "") !== a.profile) return { ...none, pause: pause("accountChanged", a.channelId) };
  }
  if (ctx.licence && (!ctx.licence.pro || (ctx.licence.expiresAt !== null && ms(ctx.licence.expiresAt) <= ctx.now))) return { ...none, pause: pause("proEnded") };
  const lastRun = Number.isFinite(ms(state.lastRunAt)) ? ms(state.lastRunAt) : ms(consent.at);
  if (ctx.now - lastRun > AUTONOMY_GAP_MS) return { ...none, pause: pause("gap") };
  const failed = ctx.posts.find((p) => p.by === "app" && p.state === "ERROR" && eventTime(p) > since);
  if (failed) return { ...none, pause: pause(classifyPostizError(failed.error, failed.platform).kind === "unknown" ? "unknownError" : "ownPostFailed", failed.channelId) };
  const unknown = ctx.posts.find((p) => consented.has(p.channelId) && p.state === "ERROR" && eventTime(p) > since && classifyPostizError(p.error, p.platform).kind === "unknown");
  if (unknown) return { ...none, pause: pause("unknownError", unknown.channelId) };
  const gone = ctx.posts.find((p) => p.by === "app" && p.gone && eventTime(p) > since);
  if (gone) return { ...none, pause: pause("ownPostDeleted", gone.channelId) };
  if (ctx.learner.decisions.some((d) => d.verdict === "wentBack" && ms(d.decidedAt) > since)) return { ...none, pause: pause("wentBack") };
  return none;
}

/** Why Resume is not available yet (empty: one press resumes). */
export function resumeProblems(state: AutonomyState, ctx: AutonomyContext): ("off" | "cooldown" | "consentVersion" | "appOlder" | "proEnded" | "testMode" | "keyRemoved" | "otherWorkspace" | "accountChanged" | "accountDisabled" | "learningOff")[] {
  const consent = state.consent;
  if (!consent) return ["off"];
  const out: ReturnType<typeof resumeProblems> = [];
  if (state.pause?.until && ms(state.pause.until) > ctx.now) out.push("cooldown");
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

/** The state after Resume (the caller checked resumeProblems is empty): no pause, and items made before now never qualify. */
export function resumed(state: AutonomyState, now: number): AutonomyState {
  return { ...state, pause: null, resumedAt: new Date(now).toISOString() };
}

/** The state after a pause: an existing pause stays unless the new one is a warning about an account. */
export function paused(state: AutonomyState, pause: AutonomyPause): AutonomyState {
  if (state.pause && pause.reason !== "accountHealth") return state;
  return { ...state, pause };
}

/** The state after Off: the consent cleared, so the next on asks again. The owner's "only tell me" choice stays. */
export function turnedOff(state: AutonomyState): AutonomyState {
  return { ...DEFAULT_AUTONOMY, deleteOnWarning: state.deleteOnWarning };
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
function itemOutcome(item: AutonomyItem, clip: AutonomyClip | undefined, state: AutonomyState, ctx: AutonomyContext, wait: AutonomyReason | null, practice: boolean, posts: readonly AccountPost[]): ItemOutcome & { trialRouteFailed?: boolean } {
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
export function decideAutonomy(state: AutonomyState, ctx: AutonomyContext, clips: ReadonlyMap<string, AutonomyClip>): AutonomyDecision {
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
export function checkBeforeCreate(itemId: string, state: AutonomyState, ctx: AutonomyContext, clips: ReadonlyMap<string, AutonomyClip>): { check: AutonomyCheck; outcome: ItemOutcome | null } {
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
  return posts.some((p) => p.by === "app" && (p.state === "QUEUE" || p.state === "intent" || (p.state === "PUBLISHED" && now - ms(p.at) <= AUTONOMY_WATCH_AFTER_MS)));
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

/** Why Turn on stays disabled (empty: it may turn on). */
export function consentProblems(draft: ConsentDraft, ctx: Pick<AutonomyContext, "now" | "licence" | "realKey" | "postiz" | "learner">): ("pro" | "testMode" | "noKey" | "learningOff" | "noAccount" | "accountNotAllowed" | "accountGone" | "accountDisabled" | "youtubeChoices" | "perDay" | "trialPairs" | "notUnderstood")[] {
  const out: ReturnType<typeof consentProblems> = [];
  if (!ctx.realKey || ctx.licence?.testMode) out.push("testMode");
  if (!ctx.licence || !ctx.licence.pro || (ctx.licence.expiresAt !== null && ms(ctx.licence.expiresAt) <= ctx.now)) out.push("pro");
  if (!ctx.postiz.configured) out.push("noKey");
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
  return [...new Set(out)];
}

/** The accounts the consent screen may offer a tick for: Instagram and YouTube only, live and on. Every other one "Waits for you". */
export function tickableChannels(channels: readonly AutonomyLiveChannel[]): { tickable: AutonomyLiveChannel[]; waits: AutonomyLiveChannel[] } {
  const tickable: AutonomyLiveChannel[] = [];
  const waits: AutonomyLiveChannel[] = [];
  for (const c of channels) (isAutonomyPlatform(c.platform) && !c.disabled ? tickable : waits).push(c);
  return { tickable, waits };
}

/** The consent record of a draft the owner turned on (consentProblems was empty), with each account's profile as Postiz has it. */
export function makeConsent(draft: ConsentDraft, ctx: Pick<AutonomyContext, "now" | "appVersion" | "postiz">): AutonomyConsent {
  return {
    version: AUTONOMY_CONSENT_VERSION,
    at: new Date(ctx.now).toISOString(),
    appVersion: ctx.appVersion,
    postiz: { baseUrl: ctx.postiz.baseUrl, organizationId: ctx.postiz.organizationId ?? "" },
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
