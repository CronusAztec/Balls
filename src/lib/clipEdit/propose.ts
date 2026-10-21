/*
 * --- ai-cut --- What a cut (spec.ts) can be worked out from without seeing a single frame: the beats of the run – when the
 * first impact comes, when the payoff lands, whether the clip ends before it (a cliffhanger), whether it loops seamlessly –
 * and the real length of the rendered file. `suggestClipEdit` turns those into a sound cut by rule; the Windows app's local
 * AI (lib/desktop/ai/studio.ts `clipEditTask`, and Make videos when it is asked for cuts) is shown that suggestion and
 * adjusts it, and `snapClipEdit` fits whatever a small model answers – strings for numbers, a zoom off the steps, a hook
 * that runs long, a length past the file – so a slip costs no retry. Pure, website-safe: the page uses the same rules.
 */
import { fitText } from "@/lib/desktop/ai/normalise";
import { CLIP_EDIT_TEXT_MAX, SHORTEST_CUT_SEC, fitClipEdit, parseClipEdit, type ClipEditSpec } from "./spec";

/** The beats of a clip, as far as they are known (null: not measured). */
export interface ClipBeats {
  /** The rendered file's length. */
  durationSec: number;
  mode: string;
  /** When the first impact or note comes. */
  firstImpactSec: number | null;
  /** When the payoff lands – the escape, the last wall, the winner. */
  payoffSec: number | null;
  /** Seconds from the clip's end to a payoff the clip ends before (a cliffhanger), else null. */
  cutGapSec: number | null;
  ending: "resolved" | "cliffhanger" | null;
  /** The run loops seamlessly (a cut would break the seam). */
  seamlessLoop: boolean;
  /** The clip's own hook, the seed for the on-frame hook. */
  hook: string | null;
}

/** The cut's own measures: 8 to 15 s of action, a moment after the payoff, a breath before the first motion. */
export const CUT_SEC = { min: 8, max: 15, afterPayoff: 1.5, beforeMotion: 0.3, noBeatsStart: 0.5 } as const;

/** The crop-ins and end-card lengths a model picks from (the grammar holds an enum; a number off the steps snaps to the nearest). */
export const ZOOM_STEPS = [1, 1.15, 1.25, 1.4, 1.6] as const;
export const CARD_STEPS = [0, 1, 1.5, 2] as const;

const tenth = (v: number) => Math.round(v * 10) / 10;

/** The beats of a bot / AI plan (lib/bot/planner.ts `ClipPlan`), `renderedSec` being the file's real length when it is known. */
export function beatsOfPlan(plan: { mode: string; hook: string; ending: "resolved" | "cliffhanger"; payoff: { atSec: number | null; cutGapSec: number | null }; timing: { clipSec: number; firstImpactSec: number | null }; settings: { dpFan?: boolean; dpPalindrome?: boolean; hpReturn?: boolean } }, renderedSec?: number | null): ClipBeats {
  const durationSec = renderedSec !== undefined && renderedSec !== null && Number.isFinite(renderedSec) && renderedSec > 0 ? renderedSec : plan.timing.clipSec;
  const cutGapSec = plan.payoff.cutGapSec !== null && plan.payoff.cutGapSec > 0 ? plan.payoff.cutGapSec : null;
  return {
    durationSec,
    mode: plan.mode,
    firstImpactSec: plan.timing.firstImpactSec,
    payoffSec: plan.payoff.atSec,
    cutGapSec,
    ending: plan.ending,
    // the palindrome (a chaos-fan field) and the return are on by default in every mode's settings: only the modes that play them loop
    seamlessLoop: (plan.mode === "doublePendulum" && plan.settings.dpFan === true && plan.settings.dpPalindrome === true) || (plan.mode === "hoops" && plan.settings.hpReturn === true),
    hook: plan.hook || null,
  };
}

/** The beats of a Library clip made before its run was measured: only its length, mode and hook are known. */
export function beatsOfLibraryItem(item: { durationSec: number | null; meta: { mode: string; hook: string | null } }, durationSec?: number | null): ClipBeats {
  const length = durationSec ?? item.durationSec;
  return { durationSec: length !== null && Number.isFinite(length) && length > 0 ? length : 0, mode: item.meta.mode, firstImpactSec: null, payoffSec: null, cutGapSec: null, ending: null, seamlessLoop: false, hook: item.meta.hook || null };
}

/** The step nearest to `v` (a tie goes to the later step: a 0.5 s card becomes 1 s, not none). */
const nearest = (steps: readonly number[], v: number): number => steps.reduce((best, s) => (Math.abs(s - v) <= Math.abs(best - v) ? s : best), steps[0]);

/** A hook fitted to the pill: one line of at most CLIP_EDIT_TEXT_MAX characters, cut at a space, "" when there is none. */
export function fitHook(value: unknown): string {
  const text = fitText(typeof value === "string" ? value.replace(/\s+/g, " ") : value, CLIP_EDIT_TEXT_MAX);
  return typeof text === "string" ? text : "";
}

/**
 * A sound cut by rule. A seamless loop is kept whole (start 0, the whole file, no card). Otherwise the cut starts a breath
 * before the first motion, ends a moment after the payoff – or at the file's end for a cliffhanger, which gets no card: the
 * question is the ending – and keeps 8 to 15 s of action when the file allows it. Crop-in, card and address come from `base`
 * (the user's remembered spec); the hook is the clip's own, fitted, else the base's.
 */
export function suggestClipEdit(beats: ClipBeats, base: ClipEditSpec): ClipEditSpec {
  const d = beats.durationSec > 0 ? beats.durationSec : base.startSec + base.lengthSec;
  const hook = beats.hook ? fitHook(beats.hook) || base.hook : base.hook;
  // the crop-in and the card on their steps: the suggestion is what a model is shown and the grammar lets it answer
  const zoom = nearest(ZOOM_STEPS, base.zoom);
  if (beats.seamlessLoop) return fitClipEdit({ ...base, startSec: 0, lengthSec: tenth(d), zoom, hook, cardSec: 0 }, d);
  const motion = beats.firstImpactSec !== null && beats.firstImpactSec >= 0 ? Math.max(0, beats.firstImpactSec - CUT_SEC.beforeMotion) : CUT_SEC.noBeatsStart;
  const cliffhanger = beats.ending === "cliffhanger" || beats.cutGapSec !== null;
  const payoff = beats.payoffSec !== null && beats.payoffSec >= 0 ? beats.payoffSec : null;
  let end: number;
  if (cliffhanger) end = d;
  else if (payoff !== null) end = Math.min(d, payoff + CUT_SEC.afterPayoff);
  else end = Math.min(d, motion + Math.max(CUT_SEC.min, Math.min(CUT_SEC.max, base.lengthSec)));
  let start = Math.max(motion, end - CUT_SEC.max);
  if (end - start < CUT_SEC.min) start = Math.max(0, end - CUT_SEC.min);
  if (start > end) start = Math.max(0, end - 1);
  return fitClipEdit({ ...base, startSec: tenth(start), lengthSec: tenth(Math.max(0.5, end - start)), zoom, hook, cardSec: cliffhanger ? 0 : nearest(CARD_STEPS, base.cardSec) }, d);
}

/** A number as a model wrote it (a string one coerced), else `fallback`: the floors are parseClipEdit's. */
const numOr = (v: unknown, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
};

/**
 * Whatever a model answered, as a spec the editor can render: numbers coerced from strings and floored (parseClipEdit; one
 * missing or not a number is the base's), the crop-in and the card snapped to their steps, the hook fitted (an empty one
 * falls back to the clip's own, then the base's), the address always the base's (never the model's), the cut fitted to the
 * file's length.
 */
export function snapClipEdit(raw: unknown, beats: ClipBeats, base: ClipEditSpec): ClipEditSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  // the hook is fitted before the floors: parseClipEdit's own trim is a hard slice at the limit, fitHook cuts at a space
  const hook = fitHook(typeof r.hook === "string" ? r.hook : base.hook) || (beats.hook ? fitHook(beats.hook) : "") || base.hook;
  const parsed = parseClipEdit({ startSec: numOr(r.startSec, base.startSec), lengthSec: numOr(r.lengthSec, base.lengthSec), zoom: numOr(r.zoom, base.zoom), cardSec: numOr(r.cardSec, base.cardSec), hook, url: base.url });
  const spec: ClipEditSpec = { ...parsed, zoom: nearest(ZOOM_STEPS, parsed.zoom), cardSec: nearest(CARD_STEPS, parsed.cardSec), hook, url: base.url };
  if (beats.durationSec <= 0) return spec;
  // a start in the file's last moments is pulled back so the schema's shortest cut (lengthSec at least its floor) survives
  // the fit: otherwise the answer would fail its own check on every retry (a file shorter than the floor is kept whole)
  const floor = SHORTEST_CUT_SEC;
  if (beats.durationSec >= floor) spec.startSec = Math.min(spec.startSec, Math.floor((beats.durationSec - floor) * 10 + 1e-9) / 10);
  return fitClipEdit(spec, beats.durationSec);
}

/**
 * The cut of a plan refitted to the file that was actually rendered: a run that ended sooner gives a shorter file, and a
 * cut that reached the planned end keeps its length and ends where the file does; any other cut is only kept inside it.
 */
export function refitClipEdit(spec: ClipEditSpec, plannedSec: number, realSec: number): ClipEditSpec {
  if (!Number.isFinite(realSec) || realSec <= 0) return spec;
  const reachedEnd = Number.isFinite(plannedSec) && plannedSec > 0 && spec.startSec + spec.lengthSec >= plannedSec - 0.05;
  if (reachedEnd && realSec < plannedSec) {
    const startSec = tenth(Math.max(0, realSec - spec.lengthSec));
    return fitClipEdit({ ...spec, startSec, lengthSec: tenth(realSec - startSec) }, realSec);
  }
  return fitClipEdit(spec, realSec);
}

// --- cut-reedit --- "Edit for TikTok" on a Library item: a cut file has its look in its frames already, so it never gets a second one

/** A Library item as far as the editor's opening needs it (lib/desktop/contract.ts `LibraryItem`). */
export interface LibraryEditItem {
  durationSec: number | null;
  exists: boolean;
  meta: { queueJobId: string | null; cut?: ClipEditSpec };
}

/** What "Edit for TikTok" opens: the item whose file the editor reads, the spec it starts from, and whether that file is a cut. */
export interface LibraryEditOpen<T extends LibraryEditItem> {
  item: T;
  spec: Partial<ClipEditSpec> | undefined;
  /** The file is a cut whose master is not in the Library: its look is burned in, so the editor adds none (no fan-made badge either). */
  cutFile: boolean;
}

const CUT_SUFFIX = "-cut";
/** A cut file's length when the Library could not measure it: longer than any clip, so the editor's fit keeps the whole file. */
const WHOLE_FILE_SEC = 24 * 60 * 60;

/**
 * --- cut-reedit --- What "Edit for TikTok" opens for `item`, out of the Library's `items`. A master opens with the cut it
 * carries (the AI's proposal). A cut file (the queue and the editor name its `queueJobId` `<job>-cut`) already shows its
 * crop-in, hook, address, end card and badge, so none of them goes on it again: a queue cut opens its master instead (the
 * item whose `queueJobId` is `<job>`) with the whole spec it was cut with, refitted to the master as the queue refits it;
 * a cut with no master to open (the editor's own, or one whose master was forgotten or deleted) opens as it is, with nothing
 * added. Never the address of a cut: a master's stays the user's remembered one, and a bare cut file gets none (its own is
 * in the frame).
 */
export function libraryEditOpen<T extends LibraryEditItem>(item: T, items: readonly T[]): LibraryEditOpen<T> {
  const job = item.meta.queueJobId;
  if (!job?.endsWith(CUT_SUFFIX)) {
    const cut = item.meta.cut;
    return { item, spec: cut ? { startSec: cut.startSec, lengthSec: cut.lengthSec, zoom: cut.zoom, hook: cut.hook, cardSec: cut.cardSec } : undefined, cutFile: false };
  }
  const masterJob = job.slice(0, -CUT_SUFFIX.length);
  const master = items.find((other) => other !== item && other.exists && other.meta.queueJobId === masterJob);
  if (master) {
    const cut = item.meta.cut;
    if (!cut) return libraryEditOpen(master, items);
    const fitted = master.durationSec ? refitClipEdit(cut, cut.startSec + cut.lengthSec, master.durationSec) : cut;
    return { item: master, spec: { startSec: fitted.startSec, lengthSec: fitted.lengthSec, zoom: fitted.zoom, hook: fitted.hook, cardSec: fitted.cardSec }, cutFile: false };
  }
  // the whole file, no crop-in, no words, no card: the editor only trims it (it fits the length to the file it opens)
  return { item, spec: { startSec: 0, lengthSec: item.durationSec ?? WHOLE_FILE_SEC, zoom: 1, hook: "", url: "", cardSec: 0 }, cutFile: true };
}

/** What is wrong with a cut, in words a model can act on ([] when nothing is). */
export function cutProblems(spec: ClipEditSpec, beats: ClipBeats): string[] {
  const problems: string[] = [];
  const end = spec.startSec + spec.lengthSec;
  if (beats.durationSec > 0 && spec.startSec >= beats.durationSec) problems.push(`startSec ${spec.startSec} is past the end of the source (${tenth(beats.durationSec)} s): start earlier`);
  const payoff = beats.payoffSec;
  if (beats.ending === "resolved" && payoff !== null && payoff >= 0 && (beats.durationSec <= 0 || payoff <= beats.durationSec) && (payoff < spec.startSec || payoff > end)) {
    problems.push(`the payoff lands at ${tenth(payoff)} s: keep startSec <= ${tenth(payoff)} <= startSec + lengthSec`);
  }
  return problems;
}

/** One line about the clip for a prompt: "source 16.2 s, mode glass, motion from 0.8 s, payoff at 12.4 s (resolved), no loop". */
export function describeBeats(beats: ClipBeats): string {
  const parts = [`source ${tenth(beats.durationSec)} s`, `mode ${beats.mode}`];
  parts.push(beats.firstImpactSec !== null ? `motion from ${tenth(beats.firstImpactSec)} s` : "first motion not measured");
  if (beats.payoffSec !== null) parts.push(`payoff at ${tenth(beats.payoffSec)} s (${beats.cutGapSec !== null ? `cliffhanger: the source ends ${tenth(beats.cutGapSec)} s before it` : (beats.ending ?? "resolved")})`);
  else parts.push("no payoff measured");
  parts.push(beats.seamlessLoop ? "a seamless loop: cut it whole or not at all" : "no loop");
  if (beats.hook) parts.push(`its hook: "${beats.hook}"`);
  return parts.join(", ");
}
