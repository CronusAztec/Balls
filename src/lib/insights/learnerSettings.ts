import { PAIRS_PER_DAY_DEFAULT, PAIRS_PER_DAY_MAX } from "./learnerRules";
import { DIAL_IDS, isDialArm, type DialId } from "./dials";

/*
 * --- learner --- The learner's settings: the owner's switches and locks, as the app keeps them (the electron-store block
 * "learner", desktop/src/social/learner.ts, a later step) and as the Learning card changes them. No model, no posterior and no
 * number is stored here: what the learner learned is the decision log alone (lib/insights/learner.ts LearnerDecision).
 *
 *  - learn: off until the owner switches it on (the owner's answer 5);
 *  - measure: on by default for people who connected Postiz, with a one-time notice (`measureNoticeSeen`) and a switch to stop
 *    it (the owner's answer 5);
 *  - paused: "Pause learning" keeps measuring but stops every change;
 *  - trialReels and pairsPerDay: one Trial Reel pair a day on top of the posts a day, the switch already on (the owner's
 *    answer 1), 0 to 2 pairs; autoShareOff: the owner confirmed that Instagram's "Share to everyone automatically" is off,
 *    without which the lab does not open;
 *  - makeClips: "Make clips by itself", off;
 *  - fixed: a dial held at an arm (Fix, or Undo's lock); skipped: the questions the owner skipped (their question keys).
 *
 * Pure, like lib/desktop/autopilot.ts sanitizeAutopilot: a patch keeps only valid values, and stored settings fall back to the
 * defaults field by field.
 */

// --- learner ---

export interface LearnerSettings {
  learn: boolean;
  measure: boolean;
  measureNoticeSeen: boolean;
  paused: boolean;
  trialReels: boolean;
  pairsPerDay: number;
  autoShareOff: boolean;
  makeClips: boolean;
  fixed: Partial<Record<DialId, string>>;
  skipped: string[];
}

export const DEFAULT_LEARNER: LearnerSettings = {
  learn: false,
  measure: true,
  measureNoticeSeen: false,
  paused: false,
  trialReels: true,
  pairsPerDay: PAIRS_PER_DAY_DEFAULT,
  autoShareOff: false,
  makeClips: false,
  fixed: {},
  skipped: [],
};

/** The most skipped questions kept. */
export const SKIPPED_MAX = 100;
const QUESTION_KEY = /^[a-zA-Z]+:[a-zA-Z0-9-]+~[a-zA-Z0-9-]+(?::[a-z0-9-]{1,80})?$/;

/** The valid part of a patch: unknown keys and wrongly typed values dropped, pairs a day rounded into 0..PAIRS_PER_DAY_MAX. */
export function sanitizeLearner(patch: unknown): Partial<LearnerSettings> {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return {};
  const p = patch as Record<string, unknown>;
  const out: Partial<LearnerSettings> = {};
  for (const key of ["learn", "measure", "measureNoticeSeen", "paused", "trialReels", "autoShareOff", "makeClips"] as const) if (typeof p[key] === "boolean") out[key] = p[key] as boolean;
  if (typeof p.pairsPerDay === "number" && Number.isFinite(p.pairsPerDay)) out.pairsPerDay = Math.max(0, Math.min(PAIRS_PER_DAY_MAX, Math.round(p.pairsPerDay)));
  if (p.fixed && typeof p.fixed === "object" && !Array.isArray(p.fixed)) {
    const fixed: Partial<Record<DialId, string>> = {};
    const raw = p.fixed as Record<string, unknown>;
    for (const dial of DIAL_IDS) if (Object.prototype.hasOwnProperty.call(raw, dial) && isDialArm(dial, raw[dial])) fixed[dial] = raw[dial] as string;
    out.fixed = fixed;
  }
  if (Array.isArray(p.skipped)) out.skipped = [...new Set(p.skipped.filter((s): s is string => typeof s === "string" && s.length <= 160 && QUESTION_KEY.test(s)))].slice(0, SKIPPED_MAX);
  return out;
}

/** Stored settings over the defaults (a damaged block falls back field by field). */
export function resolveLearner(stored: unknown): LearnerSettings {
  return { ...DEFAULT_LEARNER, fixed: {}, skipped: [], ...sanitizeLearner(stored) };
}

// --- end learner ---
