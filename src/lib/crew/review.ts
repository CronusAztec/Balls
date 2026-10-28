import type { GateId } from "./clarity";
import type { Confidence, Distraction, FixId, MakesSense, ObjectionKind, PanelDepth, PanelStage, Verdict, ViewerRead } from "./roles";

/*
 * --- crew --- The review record (ClipReview v1): what the crew decided about one clip, as a small closed record that can travel
 * with the clip – into the render queue's job, the Library (LibraryMeta.review, a later step) and the toolbox's studio folder.
 * It keeps the verdict and why in enums and numbers: the depth and the stage, the verdict (keep, fix, drop, split between two
 * reviewers, or not reviewed), the confidence, the viewer's makesSense, the Simple, Playbook and pick scores, the gates that
 * fail, the issues (at most 6), the fixes and what became of them, each role's line (who answered – a model, the rules, or
 * nobody – its verdict in its enum, a note of at most 140 characters), the model's id (at most 64 characters), a 16-hex hash of
 * the prompt, the date and who reviewed (the app or Claude), and whether the roles ran in contexts of their own.
 *
 * Model verdicts are not deterministic, so they live here and only here: never in a clip's genes, digests or fingerprints.
 *
 * sanitizeReview() is run on every write and load (as genes.ts sanitizeGenes is): closed enums, numbers kept to 0–100 at one
 * decimal (NaN and the infinities become null), lists filtered, de-duplicated and capped, notes stripped of control characters
 * and cut, ids from a strict alphabet, anything unknown dropped, and the JSON at most 2 KB (notes shortened first). This file
 * imports types only, so the app's main process can bundle it without the page's modules; the lists mirror roles.ts and
 * clarity.ts, and tests/crewReviewSanitize.test.ts keeps them equal.
 */

// --- crew ---

export const REVIEW_VERSION = 1;
/** The most a review record may weigh as JSON (UTF-8 bytes). */
export const REVIEW_MAX_JSON = 2048;
export const REVIEW_NOTE_MAX = 140;
export const REVIEW_MODEL_MAX = 64;
export const REVIEW_ISSUES_MAX = 6;

export const REVIEW_DEPTHS = ["quick", "thorough", "rules"] as const satisfies readonly PanelDepth[];
export const REVIEW_STAGES = ["pre", "post"] as const satisfies readonly PanelStage[];
/** The verdict: a model's (keep, fix, drop), "split" when two reviewers disagree, "notReviewed" when there was no time. */
export const REVIEW_VERDICTS = ["keep", "fix", "drop", "split", "notReviewed"] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
export const REVIEW_CONFIDENCES = ["low", "medium", "high"] as const satisfies readonly Confidence[];
export const REVIEW_MAKES_SENSE = ["yes", "partly", "no"] as const satisfies readonly MakesSense[];
export const REVIEW_GATES = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const satisfies readonly GateId[];
export const REVIEW_OBJECTION_KINDS = [
  "payoffMissing",
  "payoffLate",
  "payoffEarly",
  "slowStart",
  "hookMismatch",
  "hookUntrue",
  "twoIdeas",
  "tooBusy",
  "textUnreadable",
  "endingConfusing",
  "notShareable",
  "sameAsOther",
] as const satisfies readonly ObjectionKind[];
export const REVIEW_DISTRACTIONS = ["text", "effects", "hud", "background", "shake", "watermarkOverlap", "nothingHappens", "tooFast"] as const satisfies readonly Distraction[];
/** An issue: an objection's kind, the viewer's misread or its "would scroll away", or a distraction a measure confirmed. */
export const REVIEW_ISSUES = [...REVIEW_OBJECTION_KINDS, "misread", "wouldScroll", ...REVIEW_DISTRACTIONS] as const;
export type ReviewIssue = (typeof REVIEW_ISSUES)[number];
export const REVIEW_FIXES = ["simplifyLook", "oneTextAtATime", "dropCountdownCaption", "rewriteHook", "retimePayoff", "reseedEarlyMotion", "switchEnding", "changeLength", "turnOff"] as const satisfies readonly FixId[];
/** What became of the fixes: applied (the clip kept is the fixed one), reverted (it made things worse), offered (after a render: "Make the fixed version"), refused (they did not compile). */
export const REVIEW_FIX_STATES = ["applied", "reverted", "offered", "refused"] as const;
export type ReviewFixState = (typeof REVIEW_FIX_STATES)[number];
/**
 * Why a clip was not reviewed: the budget ran out, enough clips were kept, the cap on reviewed candidates, a cancel, or a model
 * whose replies stayed invalid (broken: the rules alone looked, and found nothing to drop it for).
 */
export const REVIEW_NOT_REVIEWED = ["budget", "enough", "cap", "cancelled", "broken"] as const;
export type ReviewNotReviewed = (typeof REVIEW_NOT_REVIEWED)[number];
export const REVIEW_ROLES = ["skeptic", "viewer", "reviewer"] as const;
export type ReviewRole = (typeof REVIEW_ROLES)[number];
/** Who answered a role: a model, the rules (no model, or a broken one, or no budget), or nobody (the role was not needed). */
export const REVIEW_SOURCES = ["model", "rules", "skipped"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
/** The skeptic's verdict: its worst objection's severity after the evidence check ("none": nothing stands). */
export const REVIEW_SKEPTIC_VERDICTS = ["none", "minor", "major", "fatal"] as const;
export const REVIEW_VIEWER_VERDICTS = ["out", "break", "full", "count", "winner", "hit", "inSync", "beat", "picture", "gameRule", "notSure", "nothing"] as const satisfies readonly ViewerRead[];
export const REVIEW_REVIEWER_VERDICTS = ["keep", "fix", "drop"] as const satisfies readonly Verdict[];
export const REVIEW_WHO = ["app", "claude"] as const;
/** The roles ran in conversations of their own (the app, Claude Code's subagents), or in one (Claude Desktop). */
export const REVIEW_SEPARATIONS = ["contexts", "sameContext"] as const;

export interface ClipReviewRole {
  role: ReviewRole;
  source: ReviewSource;
  /** skeptic: its worst standing severity; viewer: its read; reviewer: its verdict; null when it did not answer. */
  verdict: string | null;
  /** Its line, at most 140 characters ("" for none). */
  note: string;
}

export interface ClipReview {
  v: typeof REVIEW_VERSION;
  depth: PanelDepth;
  stage: PanelStage;
  verdict: ReviewVerdict;
  confidence: Confidence | null;
  makesSense: MakesSense | null;
  simple: number | null;
  playbook: number | null;
  pick: number | null;
  /** The gates the clip fails. */
  gates: GateId[];
  issues: ReviewIssue[];
  fixes: FixId[];
  fixState: ReviewFixState | null;
  notReviewed: ReviewNotReviewed | null;
  roles: ClipReviewRole[];
  model: string | null;
  promptHash: string | null;
  /** YYYY-MM-DD, or an ISO time in UTC. */
  date: string | null;
  who: (typeof REVIEW_WHO)[number];
  separation: (typeof REVIEW_SEPARATIONS)[number];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
const listOf = <T extends string>(list: readonly T[], v: unknown, max: number): T[] => {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const x of v) {
    const k = oneOf(list, x);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= max) break;
  }
  return out;
};
const score = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(Math.max(0, Math.min(100, v)) * 10) / 10 : null);
// control characters and the Unicode line / paragraph separators
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
/** A note as kept: no control characters, spaces collapsed, at most `max` characters (whole code points). */
export function cleanNote(v: unknown, max = REVIEW_NOTE_MAX): string {
  if (typeof v !== "string" || max <= 0) return "";
  const flat = v.replace(CONTROL, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join("").trimEnd()}…` : flat;
}
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,63}$/;
const HASH = /^[0-9a-f]{16}$/;
const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?Z)?$/;

/** The UTF-8 length of a string (no TextEncoder needed). */
export function utf8Bytes(text: string): number {
  let n = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    n += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return n;
}

function roleVerdict(role: ReviewRole, v: unknown): string | null {
  if (role === "skeptic") return oneOf(REVIEW_SKEPTIC_VERDICTS, v);
  if (role === "viewer") return oneOf(REVIEW_VIEWER_VERDICTS, v);
  return oneOf(REVIEW_REVIEWER_VERDICTS, v);
}

/** A review record as stored (see the header); null when it is not one (no object, another version, no verdict). */
export function sanitizeReview(raw: unknown): ClipReview | null {
  if (!isObj(raw) || raw.v !== REVIEW_VERSION) return null;
  const depth = oneOf(REVIEW_DEPTHS, raw.depth);
  const stage = oneOf(REVIEW_STAGES, raw.stage);
  const verdict = oneOf(REVIEW_VERDICTS, raw.verdict);
  const who = oneOf(REVIEW_WHO, raw.who);
  if (!depth || !stage || !verdict || !who) return null;
  const roles: ClipReviewRole[] = [];
  if (Array.isArray(raw.roles)) {
    for (const r of raw.roles) {
      if (!isObj(r)) continue;
      const role = oneOf(REVIEW_ROLES, r.role);
      const source = oneOf(REVIEW_SOURCES, r.source);
      if (!role || !source || roles.some((x) => x.role === role)) continue;
      roles.push({ role, source, verdict: roleVerdict(role, r.verdict), note: cleanNote(r.note) });
    }
  }
  roles.sort((a, b) => REVIEW_ROLES.indexOf(a.role) - REVIEW_ROLES.indexOf(b.role));
  const review: ClipReview = {
    v: REVIEW_VERSION,
    depth,
    stage,
    verdict,
    confidence: oneOf(REVIEW_CONFIDENCES, raw.confidence),
    makesSense: oneOf(REVIEW_MAKES_SENSE, raw.makesSense),
    simple: score(raw.simple),
    playbook: score(raw.playbook),
    pick: score(raw.pick),
    gates: listOf(REVIEW_GATES, raw.gates, REVIEW_GATES.length),
    issues: listOf(REVIEW_ISSUES, raw.issues, REVIEW_ISSUES_MAX),
    fixes: listOf(REVIEW_FIXES, raw.fixes, 3),
    fixState: oneOf(REVIEW_FIX_STATES, raw.fixState),
    notReviewed: oneOf(REVIEW_NOT_REVIEWED, raw.notReviewed),
    roles,
    model: typeof raw.model === "string" && MODEL_ID.test(raw.model) ? raw.model : null,
    promptHash: typeof raw.promptHash === "string" && HASH.test(raw.promptHash) ? raw.promptHash : null,
    date: typeof raw.date === "string" && DATE.test(raw.date) ? raw.date : null,
    who,
    separation: oneOf(REVIEW_SEPARATIONS, raw.separation) ?? "contexts",
  };
  // the size: notes shortened first, then dropped
  for (const max of [REVIEW_NOTE_MAX, 60, 0]) {
    const candidate = max === REVIEW_NOTE_MAX ? review : { ...review, roles: review.roles.map((r) => ({ ...r, note: cleanNote(r.note, max) })) };
    if (utf8Bytes(JSON.stringify(candidate)) <= REVIEW_MAX_JSON) return candidate;
  }
  return null;
}
// --- end crew ---
