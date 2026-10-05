import { describe, expect, it } from "vitest";
import { SEAM_EPS_MS, WholeLoopCut, cutsToWholeLoops, frameSeconds, wholeLoopError, wholeLoops } from "@/lib/loop/loopContract";
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
    for (const mode of MODE_IDS) if (mode !== "grow" && mode !== "starChords" /* --- chord-stars --- (it loops from its start: tests/starChords.test.ts) */) expect([mode, createEngineForSettings(config, mode, modeSettings, 3).getLoopSeams()]).toEqual([mode, null]);
  });
});

describe("the loop settings: Export whole loops and the loop HUD", () => {
  it("defaults to whole loops on and the HUD off, and round-trips through links and presets", () => {
    expect(DEFAULT_LOOP_FIELDS).toEqual({ exportWholeLoops: true, loopHud: false, loopHudTitle: "", loopHudSubtitle: "" });
    for (const mode of MODE_IDS) expect(defaultSettings(mode)).toMatchObject(mode === "starChords" ? { ...DEFAULT_LOOP_FIELDS, loopHud: true } : DEFAULT_LOOP_FIELDS); // --- chord-stars --- (its look starts with the HUD on)
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
