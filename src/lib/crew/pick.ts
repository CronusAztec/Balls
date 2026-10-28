import type { GateId } from "./clarity";
import type { Confidence } from "./roles";

/*
 * --- crew --- The picker: the N best clips of a run, by code – deterministic, free, and the same every replay (an LLM director was
 * rejected: rules rank for nothing and replay exactly).
 *
 *  - pickScore = 0.45 × Playbook + 0.45 × Simple + 0.10 × confidence (low 40, medium 70, high 100; a keep no reviewer weighed –
 *    rules only, or a Quick look that found nothing to decide – counts 70). These weights are priors until the owner's own post
 *    statistics exist.
 *  - A clip that fails a gate, or that the crew dropped, is never picked (drops are listed with their reason, never rendered).
 *  - Reviewed clips come before clips the crew had no time for ("not reviewed"), which are picked only to fill the N and are
 *    never passed off as seen; --- crew --- a keep no model looked at (the rules alone weighed it: Rules only, its roles off)
 *    is picked as "rules", never as "reviewed" (the studio's second review round, finding 7).
 *  - Diversity: at most one clip per template in a batch of three or fewer, unless the request named one template.
 *  - Ties break on Simple, then Playbook, then plan order.
 *
 * Pure: the candidates' scores and verdicts in, the order out.
 */

// --- crew ---

export const PICK_WEIGHTS = { playbook: 0.45, simple: 0.45, confidence: 0.1 } as const;
export const CONFIDENCE_POINTS: Readonly<Record<Confidence, number>> = { low: 40, medium: 70, high: 100 };
/** What a keep no reviewer weighed counts for its confidence. */
export const RULES_CONFIDENCE_POINTS = 70;
/** The largest batch the one-clip-per-template rule applies to. */
export const DIVERSE_BATCH_MAX = 3;

/** The pick score of a clip (0–100, one decimal). */
export function pickScore(playbook: number, simple: number, confidence: Confidence | null): number {
  const c = confidence === null ? RULES_CONFIDENCE_POINTS : CONFIDENCE_POINTS[confidence];
  const raw = PICK_WEIGHTS.playbook * playbook + PICK_WEIGHTS.simple * simple + PICK_WEIGHTS.confidence * c;
  return Math.round(Math.max(0, Math.min(100, raw)) * 10) / 10;
}

export interface PickCandidate {
  id: string;
  /** Its place in plan order (ties break on it). */
  order: number;
  /** What the diversity rule counts: its template (else its recipe, else its mode). */
  template: string;
  /** The gates it fails now (empty: it passes). */
  failed: readonly GateId[];
  playbook: number;
  simple: number;
  /** The crew's verdict: keep (a fixed clip too), drop, or not reviewed (no time). */
  verdict: "keep" | "drop" | "notReviewed";
  confidence: Confidence | null;
  /** Why it was dropped (a key: "gate:G2", "reviewer", "fixReverted"…). */
  dropWhy?: string | null;
  /** --- crew --- A model answered one of its roles (panel.ts lookedAt); false: the rules alone weighed it. Absent: true. */
  seen?: boolean;
}

export interface PickEntry {
  id: string;
  score: number;
  /** keeps: "reviewed" (a model looked), "rules" (the rules alone weighed it) or "notReviewed"; left: "sameTemplate" or "enough"; drops: the reason. */
  reason: string;
}

export interface Picked {
  /** The clips to render, best first. */
  keeps: PickEntry[];
  /** Clips that could be kept but were not picked (another of their template, or N reached). */
  left: PickEntry[];
  /** Clips that are never rendered: a failed gate or the crew's drop. */
  drops: PickEntry[];
}

/** Picks the `n` best clips (see the header). `namedTemplate`: the request named one template (no diversity rule). */
export function pick(candidates: readonly PickCandidate[], n: number, options: { namedTemplate?: boolean } = {}): Picked {
  const drops: PickEntry[] = [];
  const eligible: (PickCandidate & { score: number })[] = [];
  for (const c of candidates) {
    const score = pickScore(c.playbook, c.simple, c.confidence);
    if (c.failed.length) drops.push({ id: c.id, score, reason: `gate:${c.failed[0]}` });
    else if (c.verdict === "drop") drops.push({ id: c.id, score, reason: c.dropWhy || "dropped" });
    else eligible.push({ ...c, score });
  }
  const tier = (c: PickCandidate) => (c.verdict === "keep" ? 0 : 1);
  eligible.sort((a, b) => tier(a) - tier(b) || b.score - a.score || b.simple - a.simple || b.playbook - a.playbook || a.order - b.order);
  const want = Math.max(0, Math.floor(n));
  const diverse = want <= DIVERSE_BATCH_MAX && !options.namedTemplate;
  const keeps: PickEntry[] = [];
  const left: PickEntry[] = [];
  const used = new Set<string>();
  for (const c of eligible) {
    if (keeps.length >= want) left.push({ id: c.id, score: c.score, reason: "enough" });
    else if (diverse && used.has(c.template)) left.push({ id: c.id, score: c.score, reason: "sameTemplate" });
    else {
      keeps.push({ id: c.id, score: c.score, reason: c.verdict !== "keep" ? "notReviewed" : c.seen === false ? "rules" : "reviewed" });
      used.add(c.template);
    }
  }
  return { keeps, left, drops };
}
// --- end crew ---
