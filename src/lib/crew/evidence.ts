import { CLARITY, type Clarity } from "./clarity";
import { claimSeen, shownSecOf, type Claim, type CrewClip } from "./clip";
import { hasRingWalls } from "./hudFlags";
import { crowding, overlaysOf, SIMPLE_BANDS } from "./simplicity";
import { FIX_BOUNDS, MEASURABLE_KINDS, type Distraction, type MakesSense, type ObjectionKind, type SkepticObjection, type ViewerRead } from "./roles";

/*
 * --- crew --- The evidence check: the skeptic's objections held against the clip's measured facts, by code, before the reviewer
 * sees them. Each objection gets a mark:
 *
 *  - confirmed: a measurable kind whose fact crosses its threshold (EVIDENCE) – it stands, at full weight, and a confirmed
 *    fatal one blocks a keep;
 *  - refuted: the fact contradicts it – dropped, and logged as "not supported by the run";
 *  - opinion: a judgement kind with no deterministic test (hookMismatch, twoIdeas, endingConfusing, notShareable, sameAsOther),
 *    or a measurable one whose fact is not known (no run, nothing measured) – it counts at half weight, is never a blocker and
 *    stands only at major or fatal.
 *
 * The thresholds (the plan's): payoffLate – the payoff past 90 % of the clip, or a cut more than 1 s before it, or too little
 * shown after it (gate G2's NotShown); payoffEarly – before 66 % (the reviewer's retime band starts there), or on a cliffhanger
 * the payoff shown before the cut; payoffMissing – no payoff in the run, or the run does not show the claim; slowStart – the
 * first impact after 1 s (after a render: the measured first motion after 1.5 s, or none); tooBusy – Simple below 80 or two
 * messages on screen at once; textUnreadable – gate G5 fails; hookUntrue – a number in the hook the clip does not have, or a
 * winner named that the run does not have (gate G4).
 *
 * The cited keys are DOSSIER_KEYS (the schema holds them to it); the mark is the measure's, whichever key is cited, and a mark's
 * `basis` says which fact decided it. The viewer's side is here too: makesSense (its read against the claim) and the
 * distractions a measure confirms.
 *
 * Pure: the clip and its clarity check in, the marks out.
 */

// --- crew ---

export const EVIDENCE = {
  payoffLateFrom: 0.9,
  cutGapLateSec: 1,
  payoffEarlyBelow: FIX_BOUNDS.retimeFrom,
  slowStartSec: CLARITY.firstImpactSec,
  measuredSlowStartSec: CLARITY.measuredFirstMotionSec,
  busySimpleBelow: SIMPLE_BANDS.simple,
  busyAtOnce: 2,
} as const;

export type EvidenceMark = "confirmed" | "refuted" | "opinion";

export interface MarkedObjection extends SkepticObjection {
  mark: EvidenceMark;
  /** It stays for the reviewer: confirmed, or an opinion at major or fatal. */
  stands: boolean;
  /** Its weight: 1 confirmed, 0.5 an opinion that stands, 0 otherwise. */
  weight: number;
  /** A confirmed fatal objection: no keep while it stands. */
  blocker: boolean;
  /** The fact that decided the mark ("payoff 93% > 90%"), or what is unknown. */
  basis: string;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct = (n: number) => `${Math.round(100 * n)}%`;
const isMeasurable = (kind: ObjectionKind) => (MEASURABLE_KINDS as readonly string[]).includes(kind);
const gate = (clarity: Clarity, id: string) => clarity.gates.find((g) => g.id === id);

/** The measure of one measurable kind: true (crossed), false (contradicted), null (the fact is not known). */
function measure(kind: ObjectionKind, clip: CrewClip, clarity: Clarity): { crossed: boolean | null; basis: string } {
  const p = clip.payoff;
  const cliff = clip.ending === "cliffhanger";
  switch (kind) {
    case "payoffLate": {
      if (p.atSec === null) return { crossed: false, basis: "no payoff in the run to be late" };
      if (cliff) return p.cutGapSec === null ? { crossed: null, basis: "cut gap unknown" } : { crossed: p.cutGapSec > EVIDENCE.cutGapLateSec + 1e-9, basis: `cut ${r1(p.cutGapSec)} s before the payoff` };
      const notShown = gate(clarity, "G2")?.problems.includes("payoffLandsNotShown") ?? false;
      if (p.position === null) return { crossed: null, basis: "payoff position unknown" };
      return { crossed: p.position > EVIDENCE.payoffLateFrom + 1e-9 || notShown, basis: notShown ? `payoff at ${pct(p.position)}, too little shown after it` : `payoff at ${pct(p.position)}` };
    }
    case "payoffEarly": {
      if (p.atSec === null) return { crossed: false, basis: "no payoff in the run to be early" };
      if (cliff) return p.cutGapSec === null ? { crossed: null, basis: "cut gap unknown" } : { crossed: p.cutGapSec < -1e-9, basis: p.cutGapSec < 0 ? "the payoff is shown before the cut" : `cut ${r1(p.cutGapSec)} s before the payoff` };
      if (p.position === null) return { crossed: null, basis: "payoff position unknown" };
      return { crossed: p.position < EVIDENCE.payoffEarlyBelow - 1e-9, basis: `payoff at ${pct(p.position)}` };
    }
    case "payoffMissing": {
      if (p.atSec === null) return { crossed: clip.simulated ? true : null, basis: clip.simulated ? "no payoff within the run" : "the run was not simulated" };
      if (cliff) return { crossed: false, basis: `payoff ${p.cutGapSec !== null ? `${r1(p.cutGapSec)} s ` : ""}after the cut, as a cliffhanger wants` };
      const seen = claimSeen(clip);
      if (seen === null) return { crossed: null, basis: "the run's facts are not known" };
      return { crossed: !seen, basis: seen ? `payoff at ${r1(p.atSec)} s, the run shows it` : "the run does not show the claim" };
    }
    case "slowStart": {
      const f = clip.measured?.features ?? null;
      if (f) {
        const first = f.firstMotionSec;
        return { crossed: first === null || first > EVIDENCE.measuredSlowStartSec + 1e-9, basis: first === null ? "no motion measured" : `first motion measured at ${r1(first)} s` };
      }
      const impact = clip.timing.firstImpactSec;
      if (impact === null) return { crossed: null, basis: "first impact unknown" };
      return { crossed: impact > EVIDENCE.slowStartSec + 1e-9, basis: `first impact at ${r1(impact)} s` };
    }
    case "hookUntrue": {
      const g4 = gate(clarity, "G4");
      const untrue = (g4?.problems ?? []).filter((k) => /HookNumber$|WrongWinner$|NoWinner$/.test(k));
      return { crossed: untrue.length > 0, basis: untrue.length ? untrue.join(", ") : "every number and name is the run's" };
    }
    case "tooBusy": {
      const { most } = crowding(overlaysOf(clip), shownSecOf(clip));
      const simple = clarity.simple.score;
      return { crossed: simple < EVIDENCE.busySimpleBelow || most >= EVIDENCE.busyAtOnce, basis: `Simple ${simple}, ${most} at once at most` };
    }
    case "textUnreadable": {
      const g5 = gate(clarity, "G5");
      return { crossed: !!g5 && !g5.ok, basis: g5 && !g5.ok ? g5.problems.join(", ") : "every text readable" };
    }
    default:
      return { crossed: null, basis: "a judgement" };
  }
}

/** The mark of one objection (see the header). */
export function markObjection(objection: SkepticObjection, clip: CrewClip, clarity: Clarity): MarkedObjection {
  const opinionStands = objection.severity !== "minor";
  if (isMeasurable(objection.kind)) {
    const { crossed, basis } = measure(objection.kind, clip, clarity);
    if (crossed === true) return { ...objection, mark: "confirmed", stands: true, weight: 1, blocker: objection.severity === "fatal", basis };
    if (crossed === false) return { ...objection, mark: "refuted", stands: false, weight: 0, blocker: false, basis: `not supported by the run: ${basis}` };
    return { ...objection, mark: "opinion", stands: opinionStands, weight: opinionStands ? 0.5 : 0, blocker: false, basis };
  }
  return { ...objection, mark: "opinion", stands: opinionStands, weight: opinionStands ? 0.5 : 0, blocker: false, basis: "a judgement" };
}

export function markObjections(objections: readonly SkepticObjection[], clip: CrewClip, clarity: Clarity): MarkedObjection[] {
  return objections.map((o) => markObjection(o, clip, clarity));
}

/** The objections that stand (for the reviewer). */
export function standing(marks: readonly MarkedObjection[]): MarkedObjection[] {
  return marks.filter((m) => m.stands);
}

/** Whether the viewer read the clip as its claim: yes, partly (not sure, or a clip without a claim) or no. */
export function makesSenseOf(read: ViewerRead, claim: Claim | null): MakesSense {
  if (read === "nothing") return "no";
  if (read === "notSure") return "partly";
  if (claim === null) return "partly";
  return read === claim ? "yes" : "no";
}

/** The distractions the viewer named that a measure confirms (the others are its impression only). */
export function confirmedDistractions(distractions: readonly Distraction[], clip: CrewClip, clarity: Clarity): Distraction[] {
  const s = clip.settings;
  const d = new Set<string>(clarity.simple.deductions.map((x) => x.id));
  const g5 = gate(clarity, "G5");
  const g1 = gate(clarity, "G1");
  const ring = hasRingWalls(s.mode);
  const test: Record<Distraction, () => boolean> = {
    text: () => d.has("textAtOnce") || d.has("busyShare") || d.has("persistent") || d.has("hookWords"),
    effects: () => ["wallGlow", "thickTrails", "colorTrail", "rainbowWalls", "rainbowBall", "cinematic", "burstParticles", "wallBreak"].some((k) => d.has(k)),
    hud: () => d.has("hud") || d.has("countdownBesideHud"),
    background: () => s.reactiveBackground,
    shake: () => ring && s.screenShake > 0,
    watermarkOverlap: () => !!g5 && g5.problems.some((k) => /Unsafe$/.test(k)),
    nothingHappens: () => !!g1 && !g1.ok,
    tooFast: () => d.has("measuredMotion") || (!!g5 && g5.problems.includes("readableHurried")),
  };
  return distractions.filter((x, i) => distractions.indexOf(x) === i && test[x]());
}
// --- end crew ---
