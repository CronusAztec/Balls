import { describe, expect, it, vi } from "vitest";
import { createTranslator } from "next-intl"; // --- low-findings ---
import { fastExportDoneDetail } from "@/components/simulator/sections/FastExportSection"; // --- low-findings ---
import enMessages from "../messages/en.json";
import plMessages from "../messages/pl.json";
import esMessages from "../messages/es.json";
import { SEAM_EPS_MS, WholeLoopCut, cutsToWholeLoops, frameSeconds, waitForDrawnFrame, wholeLoopError, wholeLoops } from "@/lib/loop/loopContract";
import { DEFAULT_LOOP_FIELDS, LOOP_HUD_TEXT_MAX, cleanHudText, readLoopParams, resolveLoopFields, writeLoopParams } from "@/lib/loop/loopSettings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { MODE_IDS, type LoopSeams, type PhysicsConfig } from "@/lib/physics/types";

/*
 * --- loop-foundation --- The loop contract (lib/loop/loopContract.ts): a looping run reports its cycle and its seams, and a
 * recording with "Export whole loops" on ends just before the seam that closes its last whole cycle – the same rule frame by
 * frame live and offline.
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 0, bounce: 1, damping: 0, ballSpeed: 560, rotationSpeed: 0, wallCount: 1, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {}, cinematicEnabled: false };
const FILL_LOOP = { law: "multiply" as const, step: 11, startPct: 5, onFill: "loop" as const, holdSec: 1.6, shrinkSec: 1, pitch: true };

/** Frames of a recording `durationSec` long of a Fill and loop run at `fps`, cut by the contract as the fast export cuts it. */
function cutRun(durationSec: number, fps: number, seed = 5, grow: Partial<typeof FILL_LOOP> = FILL_LOOP) {
  const engine = createEngineForSettings(config, "grow", { ...modeSettings, grow }, seed);
  const cut = new WholeLoopCut(durationSec, 1 / fps);
  let exported = 0;
  for (let simFrame = 0; simFrame < 60 * (durationSec + 1); simFrame++) {
    const t = (simFrame * 1000) / 60;
    if (simFrame > 0 && t >= 1000 * durationSec && t >= 1000 * cut.limitSec) break;
    if (simFrame > 0) engine.update(1000 / 60, 0);
    if (cut.frame(t / 1000, engine.getElapsedMs(), engine.getLoopSeams()) === "stop") break;
    // the export frames this simulation frame carries (one at 60 fps, every other one at 30)
    const first = Math.ceil((t / 1000) * fps - 1e-9);
    const end = Math.ceil(((t + 1000 / 60) / 1000) * fps - 1e-9);
    exported = Math.max(exported, end > first ? end : exported);
  }
  return { seconds: exported / fps, cut, engine };
}

describe("the loop contract: whole cycles", () => {
  it("counts the whole cycles that fit, with a frame of slack", () => {
    expect(wholeLoops(40, 17.4)).toEqual({ cycles: 2, seconds: 34.8 });
    expect(wholeLoops(17.4 - 1 / 120, 17.4, 1 / 60)).toEqual({ cycles: 1, seconds: 17.4 });
    expect(wholeLoops(10, 17.4)).toBeNull();
    expect(wholeLoops(10, 0)).toBeNull();
    expect(wholeLoopError(34.8, 17.4)).toBeCloseTo(0, 12);
    expect(wholeLoopError(35, 17.4)).toBeCloseTo(0.2, 12);
    expect(frameSeconds(30)).toBeCloseTo(1 / 30, 12);
    expect(frameSeconds(0)).toBeCloseTo(1 / 60, 12);
    expect(cutsToWholeLoops(true, { count: 0, lastMs: -1, nextMs: -1 })).toBe(true);
    expect(cutsToWholeLoops(true, null)).toBe(false);
    expect(cutsToWholeLoops(false, { count: 0, lastMs: -1, nextMs: -1 })).toBe(false);
  });

  it("cuts on the seam whose next cycle would not fit, and runs on to a seam a frame or two past the clip", () => {
    // seams every 10 s (the frames at 10, 20, 30 s show the run's start again)
    const seamsAt = (t: number): LoopSeams => {
      const count = Math.floor((t + 1e-9) / 10);
      const next = (count + 1) * 10 * 1000;
      return { count, lastMs: count > 0 ? count * 10000 : -1, nextMs: t * 1000 >= next - 2000 ? next : -1 };
    };
    const run = (duration: number) => {
      const cut = new WholeLoopCut(duration, 1 / 60);
      for (let f = 0; f < 60 * (duration + 15); f++) {
        const t = f / 60;
        // the frame at a seam: the state is the start's, the seam counted from the next step on
        const seams = seamsAt(t - 1e-9);
        if (cut.frame(t, t * 1000, seams) === "stop") return { at: t, cut };
      }
      return { at: Infinity, cut };
    };
    expect(run(25).at).toBeCloseTo(20, 9); // two whole cycles fit in 25 s
    expect(run(25).cut.cycles).toBe(2);
    expect(run(25).cut.cutOnSeam).toBe(true);
    expect(run(30).at).toBeCloseTo(30, 9); // the third seam lands on the clip's end
    expect(run(29.99).at).toBeCloseTo(30, 9); // a seam a frame past the clip: the recording runs on to it
    expect(run(8).at).toBeCloseTo(8, 9); // no whole cycle fits: the clip keeps its length
    expect(run(8).cut.cutOnSeam).toBe(false);
    expect(SEAM_EPS_MS).toBeGreaterThan(0);
  });

  it("exports a Fill and loop run as a whole number of its cycles, within a frame, at 60 and 30 fps", () => {
    for (const [duration, fps] of [[40, 60], [40, 30], [55, 60], [18, 60]] as const) {
      const { seconds, cut, engine } = cutRun(duration, fps);
      // the cycle the cut measured (the run's own clock: the engine reports a cycle once its first relaunch is past)
      const cycle = cut.cycleSec;
      expect(cycle).toBeGreaterThan(5);
      if (cut.cycles > 1) expect(Math.abs(engine.getCycleSeconds()! - cycle)).toBeLessThanOrEqual(1 / 60 + 1e-6);
      expect(cut.cutOnSeam, `${duration} s at ${fps} fps`).toBe(true);
      expect(seconds).toBeLessThanOrEqual(duration + 2 / fps);
      expect(wholeLoopError(seconds, cycle), `${duration} s at ${fps} fps: ${seconds} s, cycle ${cycle}`).toBeLessThanOrEqual(1 / fps + 1e-6);
      expect(Math.round(seconds / cycle)).toBe(Math.floor((duration + 1 / fps) / cycle + 1e-9));
    }
    // a run that does not loop is not cut (the classic Grow, Finish)
    for (const grow of [{}, { ...FILL_LOOP, onFill: "finish" as const }]) {
      const engine = createEngineForSettings(config, "grow", { ...modeSettings, grow }, 5);
      expect(engine.getLoopSeams()).toBeNull();
      expect(engine.getCycleSeconds()).toBeNull();
    }
    for (const mode of MODE_IDS) if (mode !== "grow" && mode !== "starChords" /* --- chord-stars --- (it loops from its start: tests/starChords.test.ts) */ && mode !== "hoops" /* --- bead-hoops --- (it loops by default: below) */ && mode !== "ellipseFoci" /* --- ellipse-foci --- (a refire run loops from its start: below) */ && mode !== "colourSort" /* --- colour-sort --- (it always loops: tests/colourSort.test.ts checks its seams) */) expect([mode, createEngineForSettings(config, mode, modeSettings, 3).getLoopSeams()]).toEqual([mode, null]);
    // --- bead-hoops --- Spinning Hoops loops by default (its return ramp: a seamless cycle of whole turns); without the return it
    // reports no seams, like every mode that does not loop
    expect(createEngineForSettings(config, "hoops", modeSettings, 3).getLoopSeams()).toMatchObject({ count: 0, lastMs: -1 });
    expect(createEngineForSettings(config, "hoops", { ...modeSettings, hoops: { returnLoop: false } }, 3).getLoopSeams()).toBeNull();
    // --- ellipse-foci --- Focus Shot loops from its start (a fresh volley every 4 passes of 4 s); a swarm left to collapse never does
    expect(createEngineForSettings(config, "ellipseFoci", modeSettings, 3).getLoopSeams()).toMatchObject({ count: 0, lastMs: -1, nextMs: 16000 });
    expect(createEngineForSettings(config, "ellipseFoci", { ...modeSettings, ellipseFoci: { reset: "collapse" } }, 3).getLoopSeams()).toBeNull();
  });
});

describe("the loop settings: Export whole loops and the loop HUD", () => {
  it("defaults to whole loops on and the HUD off, and round-trips through links and presets", () => {
    expect(DEFAULT_LOOP_FIELDS).toEqual({ exportWholeLoops: true, loopHud: false, loopHudTitle: "", loopHudSubtitle: "" });
    for (const mode of MODE_IDS) expect(defaultSettings(mode)).toMatchObject(mode === "starChords" || mode === "ellipseFoci" /* --- ellipse-foci --- */ || mode === "colourSort" /* --- colour-sort --- (its counter is the mode: its own defaults turn the HUD on) */ ? { ...DEFAULT_LOOP_FIELDS, loopHud: true } : DEFAULT_LOOP_FIELDS); // --- chord-stars --- (its look starts with the HUD on)
    const s = { ...defaultSettings("grow"), exportWholeLoops: false, loopHud: true, loopHudTitle: "Every bounce, bigger", loopHudSubtitle: "watch the end" };
    const params = settingsToSearchParams(s);
    expect([params.get("wl"), params.get("lh"), params.get("lht"), params.get("lhs")]).toEqual(["0", "1", "Every bounce, bigger", "watch the end"]);
    expect(settingsFromSearchParams(params)).toMatchObject({ exportWholeLoops: false, loopHud: true, loopHudTitle: "Every bounce, bigger", loopHudSubtitle: "watch the end" });
    expect(presetToSettings(JSON.parse(JSON.stringify(s)))).toMatchObject({ loopHud: true, loopHudTitle: "Every bounce, bigger" });
    expect(settingsToSearchParams(defaultSettings("grow")).has("wl")).toBe(false);
    // clean texts: one line, at most the page's text limit; bad values fall back
    expect(cleanHudText("a\\nb\\u0007c")).toBe("a\\nb\\u0007c");
    expect(cleanHudText("a\nb\u0007c")).toBe("a b c");
    expect(cleanHudText("x".repeat(200)).length).toBe(LOOP_HUD_TEXT_MAX);
    expect(resolveLoopFields({ exportWholeLoops: "yes", loopHud: 1, loopHudTitle: 42 })).toEqual(DEFAULT_LOOP_FIELDS);
    const fields = { ...DEFAULT_LOOP_FIELDS };
    const p = new URLSearchParams();
    writeLoopParams({ ...fields, loopHud: true }, fields, p);
    readLoopParams(new URLSearchParams("lh=1&wl=2&lht=%20hi%20"), fields);
    expect(fields).toEqual({ exportWholeLoops: true, loopHud: true, loopHudTitle: "hi", loopHudSubtitle: "" });
    expect(p.toString()).toBe("lh=1");
  });
});

// --- low-findings --- the fast export's done line says when the clip was cut to whole loops, and by how much its sound was levelled
describe("--- low-findings --- the fast export's done line", () => {
  const done = { status: "done" as const, durationSec: 38.55, wallMs: 9000, extension: "mp4", bytes: 1, digest: "x" };
  it("names the whole loops and the normaliser's gain when there are any", () => {
    expect(fastExportDoneDetail({ ...done, loopCycles: 3, loopCycleSec: 12.8497, loudnessGainDb: 1.14 })).toEqual({ loops: { count: 3, cycle: "12.85" }, gain: "+1.1" });
    expect(fastExportDoneDetail({ ...done, loudnessGainDb: -2.34 })).toEqual({ loops: null, gain: "−2.3" });
    // a run that does not loop, a clip left at its level, no sound to measure
    expect(fastExportDoneDetail({ ...done, loudnessGainDb: 0.04 })).toEqual({ loops: null, gain: null });
    expect(fastExportDoneDetail({ ...done, loopCycles: 0, loopCycleSec: 12, loudnessGainDb: Number.NaN })).toEqual({ loops: null, gain: null });
    expect(fastExportDoneDetail(done)).toEqual({ loops: null, gain: null });
  });

  it("says it in every language", () => {
    for (const [locale, messages] of [["en", enMessages], ["pl", plMessages], ["es", esMessages]] as const) {
      const t = createTranslator({ locale, messages, namespace: "FastExport" });
      for (const count of [1, 3, 5]) {
        const line = t("doneLoops", { count, cycle: "12.85" });
        expect(line, `${locale} ${count}`).toContain(String(count));
        expect(line, `${locale} ${count}`).toContain("12.85");
      }
      expect(t("doneGain", { gain: "+1.1" }), locale).toContain("+1.1 dB");
      expect(t("doneGain", { gain: "+1.1" }), locale).toContain("−14 LUFS");
    }
    expect(createTranslator({ locale: "en", messages: enMessages, namespace: "FastExport" })("doneLoops", { count: 1, cycle: "5.00" })).toBe("Cut to 1 whole loop of 5.00 s, so it loops seamlessly.");
    expect(createTranslator({ locale: "pl", messages: plMessages, namespace: "FastExport" })("doneLoops", { count: 3, cycle: "5.00" })).toContain("3 pełnych pętli");
  });
});

// --- low-findings --- a whole-loop Record Video waits for the canvas to show the held seam before the recorder copies its first frame
describe("--- low-findings --- waiting for the held start's frame", () => {
  it("resolves on the first frame the canvas draws after the restart – not before", async () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    try {
      let drawn = 41;
      let done = false;
      const wait = waitForDrawnFrame(() => drawn, 41, 500).then(() => void (done = true));
      for (let i = 0; i < 3; i++) frames.splice(0).forEach((cb) => cb(0)); // animation frames without a drawn frame: still waiting
      await Promise.resolve();
      expect(done).toBe(false);
      drawn = 42; // the canvas drew the held seam
      frames.splice(0).forEach((cb) => cb(0));
      await wait;
      expect(done).toBe(true);
      expect(frames).toHaveLength(0); // and stops asking for frames
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("gives up after its cap when no frame comes (a hidden tab runs no animation frames)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", () => 0);
    try {
      let done = false;
      const wait = waitForDrawnFrame(() => 0, 0, 500).then(() => void (done = true));
      await vi.advanceTimersByTimeAsync(499);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await wait;
      expect(done).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });
});
