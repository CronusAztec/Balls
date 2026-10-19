// --- ai-cut --- A cut worked out from a clip's beats (lib/clipEdit/propose): the beats of a plan and of a Library item, the
// rule-made suggestion the local AI starts from, the snap that fits whatever a small model answers, the refit to the file that
// was really rendered, the problems a model is told about and the one-line description it reads. Expected numbers are worked
// out by hand from the rules (CUT_SEC: 8 to 15 s, 1.5 s after the payoff, 0.3 s before the first motion, 0.5 s with no beats).
import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { CARD_STEPS, CUT_SEC, ZOOM_STEPS, beatsOfLibraryItem, beatsOfPlan, cutProblems, describeBeats, fitHook, refitClipEdit, snapClipEdit, suggestClipEdit, type ClipBeats } from "@/lib/clipEdit/propose";
import { CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT, parseClipEdit, type ClipEditSpec } from "@/lib/clipEdit/spec";
import type { LibraryItem } from "@/lib/desktop/contract";

const ROOT = path.join(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

/** A resolved glass escape: 16.2 s rendered, the first bounce at 0.8 s, the escape at 12.4 s. */
const beats = (over: Partial<ClipBeats> = {}): ClipBeats => ({ durationSec: 16.2, mode: "glass", firstImpactSec: 0.8, payoffSec: 12.4, cutGapSec: null, ending: "resolved", seamlessLoop: false, hook: "Can it escape?", ...over });
/** The user's remembered spec, off the defaults in every field the suggestion must copy. */
const mine: ClipEditSpec = { ...DEFAULT_CLIP_EDIT, zoom: 1.4, url: "my.site", cardSec: 2, hook: "Red or blue?" };
/** 96 characters, a space at 58: the fit cuts there. */
const LONG = "Which of the five balls breaks out of the glass ring first and what happens to the rest of them?";
const LONG_FIT = "Which of the five balls breaks out of the glass ring first";

type PlanLike = Parameters<typeof beatsOfPlan>[0];
const plan = (over: Partial<PlanLike> = {}): PlanLike => ({ mode: "glass", hook: "Can it escape?", ending: "resolved", payoff: { atSec: 12.4, cutGapSec: null }, timing: { clipSec: 16.2, firstImpactSec: 0.8 }, settings: {}, ...over });

const end = (s: ClipEditSpec) => s.startSec + s.lengthSec;

describe("the beats of a plan", () => {
  it("carries the plan's timing, payoff, ending and hook", () => {
    expect(beatsOfPlan(plan())).toEqual({ durationSec: 16.2, mode: "glass", firstImpactSec: 0.8, payoffSec: 12.4, cutGapSec: null, ending: "resolved", seamlessLoop: false, hook: "Can it escape?" });
    expect(beatsOfPlan(plan({ hook: "" })).hook).toBeNull();
    expect(beatsOfPlan(plan({ timing: { clipSec: 20, firstImpactSec: null }, payoff: { atSec: null, cutGapSec: null } }))).toMatchObject({ durationSec: 20, firstImpactSec: null, payoffSec: null });
  });

  it("takes the rendered length over the planned one, but only a real one", () => {
    expect(beatsOfPlan(plan(), 14.9).durationSec).toBe(14.9);
    expect(beatsOfPlan(plan(), 30).durationSec).toBe(30);
    for (const notReal of [undefined, null, 0, -3, NaN, Infinity]) expect(beatsOfPlan(plan(), notReal).durationSec, String(notReal)).toBe(16.2);
  });

  it("keeps the cut gap only when the clip really ends before its payoff", () => {
    const cliff = plan({ ending: "cliffhanger", payoff: { atSec: 12.8, cutGapSec: 0.8 }, timing: { clipSec: 12, firstImpactSec: 1 } });
    expect(beatsOfPlan(cliff)).toMatchObject({ durationSec: 12, payoffSec: 12.8, cutGapSec: 0.8, ending: "cliffhanger" });
    expect(beatsOfPlan(plan({ payoff: { atSec: 12.4, cutGapSec: 0 } })).cutGapSec).toBeNull();
    expect(beatsOfPlan(plan({ payoff: { atSec: 12.4, cutGapSec: -1 } })).cutGapSec).toBeNull();
    // the ending is the plan's word even without a gap
    expect(beatsOfPlan(plan({ ending: "cliffhanger", payoff: { atSec: null, cutGapSec: null } })).ending).toBe("cliffhanger");
  });

  it("reads a seamless loop only from the modes that play one: the chaos fan's palindrome, the hoops' return", () => {
    expect(beatsOfPlan(plan({ mode: "doublePendulum", settings: { dpFan: true, dpPalindrome: true } })).seamlessLoop).toBe(true);
    expect(beatsOfPlan(plan({ mode: "hoops", settings: { hpReturn: true } })).seamlessLoop).toBe(true);
    // both flags are on by default in every mode's settings (lib/settings.ts): a classic or glass run is no loop
    expect(beatsOfPlan(plan({ settings: { dpFan: true, dpPalindrome: true, hpReturn: true } })).seamlessLoop).toBe(false);
    expect(beatsOfPlan(plan({ mode: "classic", settings: { dpPalindrome: true, hpReturn: true } })).seamlessLoop).toBe(false);
    expect(beatsOfPlan(plan({ mode: "doublePendulum", settings: { dpFan: false, dpPalindrome: true } })).seamlessLoop).toBe(false);
    expect(beatsOfPlan(plan({ mode: "hoops", settings: { hpReturn: false } })).seamlessLoop).toBe(false);
    expect(beatsOfPlan(plan({ settings: {} })).seamlessLoop).toBe(false);
  });
});

describe("the beats of a Library item", () => {
  const item: LibraryItem = { id: "a", path: "/x/a.mp4", fileName: "a.mp4", bytes: 1, durationSec: 23.4, width: 1080, height: 1920, createdAt: 0, thumbnail: null, exists: true, encoder: null, meta: { title: "a", mode: "orbit", seed: 1, link: "", platform: null, hook: "Red or blue?", caption: null, hashtags: [], queueJobId: null } };

  it("knows only the length, the mode and the hook: no motion, no payoff, no loop", () => {
    expect(beatsOfLibraryItem(item)).toEqual({ durationSec: 23.4, mode: "orbit", firstImpactSec: null, payoffSec: null, cutGapSec: null, ending: null, seamlessLoop: false, hook: "Red or blue?" });
  });

  it("takes the length it is handed (the opened file's) over the stored one, and 0 when neither is known", () => {
    expect(beatsOfLibraryItem(item, 9.1).durationSec).toBe(9.1);
    expect(beatsOfLibraryItem({ ...item, durationSec: null }).durationSec).toBe(0);
    expect(beatsOfLibraryItem({ ...item, durationSec: -2 }).durationSec).toBe(0);
    expect(beatsOfLibraryItem({ ...item, durationSec: null }, NaN).durationSec).toBe(0);
    expect(beatsOfLibraryItem({ ...item, meta: { ...item.meta, hook: null } }).hook).toBeNull();
    expect(beatsOfLibraryItem({ ...item, meta: { ...item.meta, hook: "" } }).hook).toBeNull();
  });
});

describe("the suggested cut", () => {
  it("ends 1.5 s after a payoff in the middle of the clip, starts a breath before the first motion, and copies the base's crop-in, card and address", () => {
    // motion 1.2 - 0.3 = 0.9, end 14 + 1.5 = 15.5, 14.6 s between them (8 to 15)
    const s = suggestClipEdit(beats({ durationSec: 30, firstImpactSec: 1.2, payoffSec: 14 }), mine);
    expect(s).toEqual({ startSec: 0.9, lengthSec: 14.6, zoom: 1.4, hook: "Can it escape?", url: "my.site", cardSec: 2 });
    expect(end(s)).toBeCloseTo(14 + CUT_SEC.afterPayoff, 9);
    expect(s.startSec).toBeGreaterThanOrEqual(1.2 - CUT_SEC.beforeMotion - 1e-9);
    expect(cutProblems(s, beats({ durationSec: 30, firstImpactSec: 1.2, payoffSec: 14 }))).toEqual([]);
    // the engine's own default on the fixture: 0.5 s before the first bounce to 1.5 s after the escape
    expect(suggestClipEdit(beats(), DEFAULT_CLIP_EDIT)).toEqual({ ...DEFAULT_CLIP_EDIT, startSec: 0.5, lengthSec: 13.4, hook: "Can it escape?" });
  });

  it("keeps at most 15 s: a payoff far from the first motion moves the start later, not the end", () => {
    const s = suggestClipEdit(beats({ durationSec: 30, firstImpactSec: 1.2, payoffSec: 25 }), DEFAULT_CLIP_EDIT);
    expect(s).toMatchObject({ startSec: 11.5, lengthSec: 15 });
    expect(end(s)).toBeCloseTo(26.5, 9);
  });

  it("would rather be short than show the dead tail: an early payoff ends 1.5 s after it, from 0", () => {
    // motion 0.7, end 6.5: 8 s cannot fit without a tail past the payoff or a start before 0
    expect(suggestClipEdit(beats({ durationSec: 30, firstImpactSec: 1, payoffSec: 5 }), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0, lengthSec: 6.5 });
  });

  it("ends at the file's end when the payoff lands near it", () => {
    const s = suggestClipEdit(beats({ payoffSec: 15.4 }), DEFAULT_CLIP_EDIT); // 15.4 + 1.5 is past the 16.2 s file
    expect(s).toMatchObject({ startSec: 1.2, lengthSec: 15 });
    expect(end(s)).toBeCloseTo(16.2, 9);
    // a payoff the real file ends before (the run ended sooner): the end is the file's, nothing past it
    const sooner = suggestClipEdit(beats({ durationSec: 11, payoffSec: 12.4 }), DEFAULT_CLIP_EDIT);
    expect(end(sooner)).toBeCloseTo(11, 9);
  });

  it("runs a cliffhanger to the file's end with no card: the question is the ending", () => {
    const cliff = beats({ durationSec: 12, firstImpactSec: 1, payoffSec: 12.8, cutGapSec: 0.8, ending: "cliffhanger" });
    expect(suggestClipEdit(cliff, mine)).toEqual({ startSec: 0.7, lengthSec: 11.3, zoom: 1.4, hook: "Can it escape?", url: "my.site", cardSec: 0 });
    // the ending's word alone, or the gap alone, is enough
    expect(suggestClipEdit(beats({ durationSec: 20, firstImpactSec: 0.5, payoffSec: null, cutGapSec: null, ending: "cliffhanger" }), mine)).toMatchObject({ startSec: 5, lengthSec: 15, cardSec: 0 });
    expect(suggestClipEdit(beats({ durationSec: 12, firstImpactSec: 1, payoffSec: 12.8, cutGapSec: 0.8, ending: null }), mine)).toMatchObject({ startSec: 0.7, lengthSec: 11.3, cardSec: 0 });
  });

  it("starts on the motion and keeps the base's length when no payoff is known, within 8 to 15 s and within the file", () => {
    const quiet = beats({ durationSec: 30, firstImpactSec: 2, payoffSec: null, ending: null });
    expect(suggestClipEdit(quiet, DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 1.7, lengthSec: 11, cardSec: 1.5 });
    expect(suggestClipEdit(quiet, { ...DEFAULT_CLIP_EDIT, lengthSec: 5 })).toMatchObject({ startSec: 1.7, lengthSec: 8 });
    expect(suggestClipEdit(quiet, { ...DEFAULT_CLIP_EDIT, lengthSec: 40 })).toMatchObject({ startSec: 1.7, lengthSec: 15 });
    expect(suggestClipEdit({ ...quiet, durationSec: 10 }, DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 1.7, lengthSec: 8.3 });
    // a first impact right at 0 starts at 0, not before it
    expect(suggestClipEdit({ ...quiet, firstImpactSec: 0 }, DEFAULT_CLIP_EDIT).startSec).toBe(0);
  });

  it("keeps a seamless loop whole: from 0, the whole file, no card, however long", () => {
    const loop = beats({ durationSec: 9.4, seamlessLoop: true, payoffSec: 7 });
    expect(suggestClipEdit(loop, mine)).toEqual({ startSec: 0, lengthSec: 9.4, zoom: 1.4, hook: "Can it escape?", url: "my.site", cardSec: 0 });
    expect(suggestClipEdit({ ...loop, durationSec: 22 }, mine)).toMatchObject({ startSec: 0, lengthSec: 22, cardSec: 0 });
    // the loop wins over a cliffhanger's or a payoff's rules
    expect(suggestClipEdit({ ...loop, ending: "cliffhanger", cutGapSec: 0.5 }, mine)).toMatchObject({ startSec: 0, lengthSec: 9.4 });
  });

  it("takes the whole usable file when it is shorter than 8 s, and never runs past its end", () => {
    const short = beats({ durationSec: 6.4, firstImpactSec: 0.9, payoffSec: null, ending: null });
    expect(suggestClipEdit(short, DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0, lengthSec: 6.4 });
    expect(suggestClipEdit({ ...short, payoffSec: 4, ending: "resolved" }, DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0, lengthSec: 5.5 });
    expect(suggestClipEdit({ ...short, durationSec: 2.5 }, DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0, lengthSec: 2.5 });
    for (const d of [1, 2.5, 4, 6.4, 7.9]) {
      const s = suggestClipEdit({ ...short, durationSec: d }, DEFAULT_CLIP_EDIT);
      expect(end(s), String(d)).toBeLessThanOrEqual(d + 1e-9);
      expect(s.lengthSec, String(d)).toBeGreaterThan(0);
    }
  });

  it("starts half a second in when nothing about the run is known, the hook the base's", () => {
    const blind = beats({ durationSec: 20, firstImpactSec: null, payoffSec: null, ending: null, hook: null });
    expect(suggestClipEdit(blind, DEFAULT_CLIP_EDIT)).toEqual({ ...DEFAULT_CLIP_EDIT, startSec: CUT_SEC.noBeatsStart, lengthSec: 11 });
    expect(suggestClipEdit(blind, mine)).toEqual({ ...mine, startSec: 0.5, lengthSec: 11 });
    // a negative first impact is no measurement either
    expect(suggestClipEdit({ ...blind, firstImpactSec: -1 }, DEFAULT_CLIP_EDIT).startSec).toBe(0.5);
    // no length known at all (an unread file): the base's own span stands in for the file, nothing breaks
    expect(suggestClipEdit({ ...blind, durationSec: 0 }, DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0.5, lengthSec: 11 });
  });

  it("fits the clip's own hook to the pill, cut at a space, else takes the base's", () => {
    expect(suggestClipEdit(beats({ hook: LONG }), DEFAULT_CLIP_EDIT).hook).toBe(LONG_FIT);
    expect(LONG_FIT.length).toBeLessThanOrEqual(CLIP_EDIT_TEXT_MAX);
    expect(suggestClipEdit(beats({ hook: null }), mine).hook).toBe("Red or blue?");
    expect(suggestClipEdit(beats({ hook: "   " }), mine).hook).toBe("Red or blue?");
    expect(suggestClipEdit(beats({ hook: "Red\n or   blue?" }), DEFAULT_CLIP_EDIT).hook).toBe("Red or blue?");
    expect(fitHook("x".repeat(90))).toHaveLength(60); // no space to cut at: a hard cut
    expect(fitHook(42)).toBe("");
  });

  it("always keeps the base's address and, outside a cliffhanger, its card", () => {
    for (const b of [beats(), beats({ seamlessLoop: true }), beats({ payoffSec: null }), beats({ firstImpactSec: null, payoffSec: null, ending: null })]) {
      expect(suggestClipEdit(b, mine).url).toBe("my.site");
      expect(suggestClipEdit(b, DEFAULT_CLIP_EDIT).url).toBe(DEFAULT_CLIP_EDIT.url);
    }
    expect(suggestClipEdit(beats(), mine).cardSec).toBe(2);
    expect(suggestClipEdit(beats({ payoffSec: null }), mine).cardSec).toBe(2);
    expect(suggestClipEdit(beats({ ending: "cliffhanger" }), mine).cardSec).toBe(0);
  });

  it("never starts before 0, never leaves the file, keeps 8 to 15 s when the beats allow it, and never fails its own checks (a sweep)", () => {
    for (const durationSec of [2.5, 6.4, 8, 10, 12.3, 16.2, 20, 30, 45, 90])
      for (const firstImpactSec of [null, 0, 0.8, 2.6, 5])
        for (const payoffSec of [null, 4, 7.5, 12.4, 19, 28, 60])
          for (const ending of ["resolved", "cliffhanger", null] as const)
            for (const seamlessLoop of [false, true])
              for (const base of [DEFAULT_CLIP_EDIT, mine, { ...DEFAULT_CLIP_EDIT, lengthSec: 40 }]) {
                const b = beats({ durationSec, firstImpactSec, payoffSec, ending, cutGapSec: ending === "cliffhanger" ? 0.8 : null, seamlessLoop });
                const s = suggestClipEdit(b, base);
                const label = JSON.stringify({ durationSec, firstImpactSec, payoffSec, ending, seamlessLoop, base: base.lengthSec });
                expect(s.startSec, label).toBeGreaterThanOrEqual(0);
                expect(s.lengthSec, label).toBeGreaterThanOrEqual(0.5);
                expect(end(s), label).toBeLessThanOrEqual(durationSec + 0.051); // fitClipEdit rounds the length to a tenth
                expect(s.url, label).toBe(base.url);
                expect(cutProblems(s, b), label).toEqual([]);
                if (seamlessLoop) {
                  expect(s, label).toMatchObject({ startSec: 0, cardSec: 0 });
                  expect(s.lengthSec, label).toBeCloseTo(durationSec, 9);
                  continue;
                }
                expect(s.lengthSec, label).toBeLessThanOrEqual(CUT_SEC.max + 1e-9);
                const cutEnd = ending === "cliffhanger" ? durationSec : payoffSec === null ? durationSec : Math.min(durationSec, payoffSec + CUT_SEC.afterPayoff);
                if (cutEnd >= CUT_SEC.min) expect(s.lengthSec, label).toBeGreaterThanOrEqual(CUT_SEC.min - 1e-9);
                if (ending === "resolved" && payoffSec !== null && payoffSec <= durationSec) {
                  expect(s.startSec, label).toBeLessThanOrEqual(payoffSec);
                  expect(end(s), label).toBeGreaterThanOrEqual(payoffSec - 1e-9);
                }
              }
  });
});

describe("the snap of a model's answer", () => {
  it("coerces strings, floors the numbers and snaps the crop-in and the card to their steps", () => {
    expect(snapClipEdit({ startSec: "2", lengthSec: "10", zoom: "1.3", hook: "Which pane?", cardSec: "1.2" }, beats(), DEFAULT_CLIP_EDIT)).toEqual({ ...DEFAULT_CLIP_EDIT, startSec: 2, lengthSec: 10, zoom: 1.25, hook: "Which pane?", cardSec: 1 });
    expect(snapClipEdit({ startSec: -2, lengthSec: 1, zoom: 0.3, hook: "x", cardSec: -1 }, beats(), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0, lengthSec: 3, zoom: 1, cardSec: 0 });
  });

  it("suggests a crop-in and a card on the steps a model may answer, a half-second card rounding up to a card", () => {
    const odd = { ...DEFAULT_CLIP_EDIT, zoom: 1.3, cardSec: 0.5 };
    expect(suggestClipEdit(beats(), odd)).toMatchObject({ zoom: 1.25, cardSec: 1 });
    expect(suggestClipEdit(beats({ ending: "cliffhanger", cutGapSec: 0.8 }), odd)).toMatchObject({ zoom: 1.25, cardSec: 0 });
    expect(suggestClipEdit(beats({ seamlessLoop: true }), odd)).toMatchObject({ zoom: 1.25, cardSec: 0 });
    expect(snapClipEdit({ startSec: 0, lengthSec: 8, zoom: 1, hook: "x", cardSec: 0.5 }, beats(), DEFAULT_CLIP_EDIT).cardSec).toBe(1);
  });

  it("snaps the zoom to the nearest step and the card to the nearest length", () => {
    const zoom = (z: unknown) => snapClipEdit({ startSec: 0, lengthSec: 8, zoom: z, hook: "x", cardSec: 1 }, beats(), DEFAULT_CLIP_EDIT).zoom;
    expect(zoom(1.3)).toBe(1.25);
    expect([1.4, 1.6]).toContain(zoom(1.5));
    expect(zoom(1.18)).toBe(1.15);
    expect(zoom(9)).toBe(1.6);
    expect(zoom("1.15")).toBe(1.15);
    for (const z of [1, 1.15, 1.25, 1.4, 1.6, 1.03, 1.2, 1.33, 1.5, 2, "1.7", 0]) expect(ZOOM_STEPS, String(z)).toContain(zoom(z));
    const card = (c: unknown) => snapClipEdit({ startSec: 0, lengthSec: 8, zoom: 1, hook: "x", cardSec: c }, beats(), DEFAULT_CLIP_EDIT).cardSec;
    expect(card(1.2)).toBe(1);
    expect(card(1.3)).toBe(1.5);
    expect(card(0.4)).toBe(0);
    expect(card(0.6)).toBe(1);
    expect(card(9)).toBe(2);
    expect(card("2")).toBe(2);
    for (const c of [0, 0.5, 1, 1.2, 1.5, 1.8, 2, 3, "0.9"]) expect(CARD_STEPS, String(c)).toContain(card(c));
  });

  it("fits a hook that runs long at a space, and an empty one falls back to the clip's own hook, then the base's", () => {
    const snap = (hook: unknown, b = beats(), base = DEFAULT_CLIP_EDIT) => snapClipEdit({ startSec: 0, lengthSec: 8, zoom: 1, hook, cardSec: 1 }, b, base).hook;
    expect(snap(LONG)).toBe(LONG_FIT);
    expect(snap(LONG).length).toBeLessThanOrEqual(CLIP_EDIT_TEXT_MAX);
    expect(LONG.startsWith(snap(LONG) + " ")).toBe(true); // cut at a word's end, not inside one
    const repeated = "Will it escape? ".repeat(6).trim();
    expect(snap(repeated)).toBe("Will it escape? Will it escape? Will it escape? Will it");
    expect(snap("")).toBe("Can it escape?");
    expect(snap("   ")).toBe("Can it escape?");
    expect(snap("", beats({ hook: LONG }))).toBe(LONG_FIT);
    expect(snap("", beats({ hook: null }), mine)).toBe("Red or blue?");
    expect(snap("", beats({ hook: "" }), mine)).toBe("Red or blue?");
    expect(snap(undefined, beats(), mine)).toBe("Red or blue?"); // no hook at all: the base's, as it was
    expect(snap(42, beats(), mine)).toBe("Red or blue?");
    expect(snap("Red\nor  blue?")).toBe("Red or blue?");
  });

  it("never takes the model's address: it is always the base's", () => {
    const raw = { startSec: 1, lengthSec: 9, zoom: 1, hook: "x", cardSec: 0, url: "evil.example" };
    expect(snapClipEdit(raw, beats(), DEFAULT_CLIP_EDIT).url).toBe(DEFAULT_CLIP_EDIT.url);
    expect(snapClipEdit(raw, beats(), mine).url).toBe("my.site");
    expect(snapClipEdit(raw, beats(), { ...mine, url: "" }).url).toBe("");
  });

  it("fits the cut to the file: a huge length or start is fitted, never past the end", () => {
    expect(snapClipEdit({ startSec: -2, lengthSec: 999, zoom: 1.25, hook: "x", cardSec: 1.5 }, beats(), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 0, lengthSec: 16.2 });
    // a start in the file's last moments is pulled back so the schema's shortest cut (3 s) survives the fit: the answer
    // must pass its own check, else the run would retry into the same wall every time
    const late = snapClipEdit({ startSec: 500, lengthSec: 999, zoom: 1.25, hook: "x", cardSec: 1.5 }, beats(), DEFAULT_CLIP_EDIT);
    expect(late.startSec).toBeCloseTo(13.2, 9);
    expect(late.lengthSec).toBeCloseTo(3, 9);
    expect(snapClipEdit({ startSec: 15, lengthSec: 2, zoom: 1.25, hook: "x", cardSec: 1.5 }, beats(), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 13.2, lengthSec: 3 });
    // a file shorter than the floor is kept whole
    expect(snapClipEdit({ startSec: 1, lengthSec: 5, zoom: 1.25, hook: "x", cardSec: 1.5 }, beats({ durationSec: 2.4 }), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 1, lengthSec: 1.4 });
    const nan = snapClipEdit({ startSec: "abc", lengthSec: Infinity, zoom: NaN, hook: "x", cardSec: {} }, beats(), mine);
    expect(nan).toMatchObject({ startSec: 3, lengthSec: 11, zoom: 1.4, cardSec: 2 }); // not numbers: the base's
  });

  it("falls back to the base, fitted, on a null or garbage answer or a missing field", () => {
    expect(snapClipEdit(null, beats(), DEFAULT_CLIP_EDIT)).toEqual(DEFAULT_CLIP_EDIT);
    expect(snapClipEdit(undefined, beats(), mine)).toEqual(mine);
    expect(snapClipEdit("garbage", beats(), mine)).toEqual(mine);
    expect(snapClipEdit(42, beats(), mine)).toEqual(mine);
    expect(snapClipEdit([], beats(), mine)).toEqual(mine);
    expect(snapClipEdit({ lengthSec: "9" }, beats(), mine)).toEqual({ ...mine, lengthSec: 9 });
    // the base's own numbers are fitted to the file too
    expect(snapClipEdit(null, beats({ durationSec: 10 }), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 3, lengthSec: 7 });
    // an answer never adds a field: the spec has the editor's six and no more
    expect(Object.keys(snapClipEdit({ startSec: 1, lengthSec: 9, zoom: 1, hook: "x", cardSec: 0, summary: "s", extra: 1 }, beats(), mine)).sort()).toEqual(["cardSec", "hook", "lengthSec", "startSec", "url", "zoom"]);
  });

  it("caps nothing at a slider's end (uncap-all): a 999 s length survives when the file is long enough, and with no length known", () => {
    expect(snapClipEdit({ startSec: 0, lengthSec: 999, zoom: 1, hook: "x", cardSec: 0 }, beats({ durationSec: 2000 }), DEFAULT_CLIP_EDIT).lengthSec).toBe(999);
    expect(snapClipEdit({ startSec: 1500, lengthSec: 999, zoom: 1, hook: "x", cardSec: 0 }, beats({ durationSec: 2000 }), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 1500, lengthSec: 500 });
    expect(snapClipEdit({ startSec: 700, lengthSec: 999, zoom: 1, hook: "x", cardSec: 0 }, beats({ durationSec: 0 }), DEFAULT_CLIP_EDIT)).toMatchObject({ startSec: 700, lengthSec: 999 });
    // the same path parseClipEdit takes: floors only
    expect(parseClipEdit({ startSec: 700, lengthSec: 999 })).toMatchObject({ startSec: 700, lengthSec: 999 });
    const src = read("src/lib/clipEdit/propose.ts");
    expect(src).not.toMatch(/_RANGES?\b/);
    expect(src).not.toMatch(/Math\.min\(\s*(?:range|r|R|RANGES\.\w+|\w+_RANGES(?:\.\w+)?|\w+_RANGE)\.max\b/); // the uncap guard's own pattern: CUT_SEC is a measure of the cut, not a slider
    expect(src).toContain("export const CUT_SEC");
  });
});

describe("the refit to the file that was really rendered", () => {
  const cut: ClipEditSpec = { ...DEFAULT_CLIP_EDIT, startSec: 5, lengthSec: 10 }; // ends at 15

  it("keeps the length of a cut that reached the planned end and anchors it on a shorter real end", () => {
    expect(refitClipEdit(cut, 15, 12)).toEqual({ ...cut, startSec: 2, lengthSec: 10 });
    expect(refitClipEdit(cut, 15, 12.34)).toMatchObject({ startSec: 2.3, lengthSec: 10 });
    // within the tolerance of the planned end
    expect(refitClipEdit({ ...cut, lengthSec: 9.97 }, 15, 12)).toMatchObject({ startSec: 2, lengthSec: 10 });
    // the queue's call: the cut's own end as the planned one
    expect(refitClipEdit(DEFAULT_CLIP_EDIT, end(DEFAULT_CLIP_EDIT), 12.5)).toEqual({ ...DEFAULT_CLIP_EDIT, startSec: 1.5, lengthSec: 11 });
  });

  it("takes the whole file when it is shorter than the cut", () => {
    expect(refitClipEdit(cut, 15, 6)).toEqual({ ...cut, startSec: 0, lengthSec: 6 });
  });

  it("only fits a cut that ends inside the planned clip", () => {
    const inside: ClipEditSpec = { ...DEFAULT_CLIP_EDIT, startSec: 2, lengthSec: 8 }; // ends at 10 of 20
    expect(refitClipEdit(inside, 20, 15)).toEqual(inside);
    expect(refitClipEdit(inside, 20, 9)).toEqual({ ...inside, startSec: 2, lengthSec: 7 }); // fitted, not moved to 1
    expect(refitClipEdit(inside, 20, 2.5)).toEqual({ ...inside, startSec: 1.5, lengthSec: 1 });
  });

  it("leaves a cut alone when the real file is as long or longer", () => {
    expect(refitClipEdit(cut, 15, 15)).toEqual(cut);
    expect(refitClipEdit(cut, 15, 20)).toEqual(cut);
    expect(refitClipEdit(cut, 15, 15.04)).toEqual(cut);
  });

  it("returns the cut untouched when the real length is not a number, and only fits it when the planned one is not", () => {
    for (const bad of [NaN, 0, -1, Infinity]) expect(refitClipEdit(cut, 15, bad), String(bad)).toBe(cut);
    expect(refitClipEdit(cut, NaN, 12)).toEqual({ ...cut, startSec: 5, lengthSec: 7 });
    expect(refitClipEdit(cut, 0, 12)).toEqual({ ...cut, startSec: 5, lengthSec: 7 });
  });
});

describe("the problems a model is told about", () => {
  it("names the payoff's second once when a resolved cut misses it, before or after", () => {
    const b = beats();
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, b)).toEqual(["the payoff lands at 12.4 s: keep startSec <= 12.4 <= startSec + lengthSec"]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 13, lengthSec: 3 }, b)).toHaveLength(1);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 13, lengthSec: 3 }, b)[0]).toMatch(/12\.4 s/);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 4, lengthSec: 10 }, b)).toEqual([]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 12.4, lengthSec: 3 }, b)).toEqual([]); // the payoff on the first frame counts
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 4.4, lengthSec: 8 }, b)).toEqual([]); // and on the last
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, beats({ payoffSec: 12.449 }))[0]).toMatch(/at 12\.4 s/);
    // the suggestion itself never earns the complaint
    expect(cutProblems(suggestClipEdit(b, DEFAULT_CLIP_EDIT), b)).toEqual([]);
  });

  it("never complains about the payoff of a cliffhanger, nor about one the file ends before", () => {
    const cliff = beats({ durationSec: 12, payoffSec: 12.8, cutGapSec: 0.8, ending: "cliffhanger" });
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, cliff)).toEqual([]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, beats({ ending: "cliffhanger", cutGapSec: null }))).toEqual([]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, beats({ ending: null }))).toEqual([]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, beats({ payoffSec: 20 }))).toEqual([]); // past the 16.2 s file
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, beats({ payoffSec: null }))).toEqual([]);
    // with no length known the payoff still has to be inside
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 0, lengthSec: 8 }, beats({ durationSec: 0 }))).toHaveLength(1);
  });

  it("tells a start past the end of the source to start earlier", () => {
    const problems = cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 20, lengthSec: 5 }, beats());
    expect(problems[0]).toBe("startSec 20 is past the end of the source (16.2 s): start earlier");
    expect(problems).toHaveLength(2); // and the payoff is outside such a cut too
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 16.2, lengthSec: 5 }, beats({ ending: null, payoffSec: null }))).toEqual(["startSec 16.2 is past the end of the source (16.2 s): start earlier"]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 16.1, lengthSec: 5 }, beats({ ending: null, payoffSec: null }))).toEqual([]);
    expect(cutProblems({ ...DEFAULT_CLIP_EDIT, startSec: 20, lengthSec: 5 }, beats({ durationSec: 0, ending: null, payoffSec: null }))).toEqual([]); // no length known: nothing to be past
  });
});

describe("the one line a model reads", () => {
  it("names the source's length, the mode, the first motion, the payoff and its ending, the loop and the hook", () => {
    expect(describeBeats(beats())).toBe('source 16.2 s, mode glass, motion from 0.8 s, payoff at 12.4 s (resolved), no loop, its hook: "Can it escape?"');
    expect(describeBeats(beats({ durationSec: 16.23, firstImpactSec: 0.84, payoffSec: 12.36 }))).toContain("source 16.2 s, mode glass, motion from 0.8 s, payoff at 12.4 s");
  });

  it("says a cliffhanger ends before its payoff, by how much", () => {
    const line = describeBeats(beats({ durationSec: 12, payoffSec: 12.8, cutGapSec: 0.8, ending: "cliffhanger" }));
    expect(line).toContain("source 12 s");
    expect(line).toContain("payoff at 12.8 s (cliffhanger: the source ends 0.8 s before it)");
    expect(describeBeats(beats({ ending: "cliffhanger" }))).toContain("payoff at 12.4 s (cliffhanger)");
  });

  it("says what was not measured, and that a loop is cut whole or not at all", () => {
    const line = describeBeats({ durationSec: 9.4, mode: "orbit", firstImpactSec: null, payoffSec: null, cutGapSec: null, ending: null, seamlessLoop: true, hook: null });
    expect(line).toBe("source 9.4 s, mode orbit, first motion not measured, no payoff measured, a seamless loop: cut it whole or not at all");
    expect(line).not.toContain("hook");
    expect(describeBeats(beats({ seamlessLoop: false }))).toContain("no loop");
  });
});

describe("the steps and the measures the other modules import", () => {
  it("are the memo's, defined once in propose.ts", () => {
    expect(ZOOM_STEPS).toEqual([1, 1.15, 1.25, 1.4, 1.6]);
    expect(CARD_STEPS).toEqual([0, 1, 1.5, 2]);
    expect(CUT_SEC).toMatchObject({ min: 8, max: 15, afterPayoff: 1.5, beforeMotion: 0.3, noBeatsStart: 0.5 });
    expect(ZOOM_STEPS).toContain(DEFAULT_CLIP_EDIT.zoom);
    expect(CARD_STEPS).toContain(DEFAULT_CLIP_EDIT.cardSec);
    const studio = read("src/lib/desktop/ai/studio.ts");
    expect(studio).not.toMatch(/const (ZOOM_STEPS|CARD_STEPS)\s*=/);
    expect(studio).toMatch(/import \{[^}]*\bZOOM_STEPS\b[^}]*\} from "@\/lib\/clipEdit\/propose"/);
  });
});
