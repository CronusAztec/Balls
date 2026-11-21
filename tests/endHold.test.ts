import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { endHoldsSec } from "@/lib/bot/planner";
import { END_BANNER_HOLD_MODES, END_BANNER_HOLD_MS, endBannerHoldMs } from "@/lib/endHold";
import { END_STOP_DELAY_MS, ExportEndTracker, NO_END_HOLDS } from "@/lib/recording/fastRenderPlan";
import { END_BANNER_HOLD_MS as CANVAS_BANNER_HOLD_MS, EndBannerLayer } from "@/components/simulator/endBanner";
import { FL_END_CHORD_HZ, FL_WIN_HOLD_SEC, flHoldStartMs } from "@/lib/physics/modes/fightLeague";
import { fakeCanvas } from "./fakeCanvas";
import { collapseDone } from "@/components/simulator/shatterRenderer";
import { DROP_SETTLED_HZ } from "@/lib/physics/modes/drop";
import { plTonicHz } from "@/lib/physics/modes/powerLayers";

/*
 * --- end-hold --- (Lane E, E5; E5 review) The end banner's hold (lib/endHold.ts): an ending whose banner comes with the run's last
 * step keeps its final picture END_BANNER_HOLD_MS before the end screen. The canvas holds it (its EndBannerLayer, `fresh()`), and
 * the page and the fast export wait for that alone: a clip ends 2 s after such an ending, never 3.5 s. The planner and a found
 * run's clip length read the same hold, and never in a clip with captions of its own (every plan keeps its length).
 * --- end-sting --- And the endings that ended in silence ring: Ball Drop's SETTLED! and Power Layers' FREEDOM! play the
 * completion chord as their banner comes in, Fight League's verdict card as its hold starts.
 */

const WORLD = { width: 800, height: 450 };

/** The start look's engine of `mode` (a bare studio visit) for `seed`. */
function startEngine(mode: SimulatorSettings["mode"], seed: number): PhysicsEngine {
  const s = { ...defaultSettings(mode), ...clipStartSettings(mode) };
  const f = finderRequestOfSettings(s, WORLD, 60);
  return createEngineForSettings(f.physicsConfig, f.mode, f.modeSettings, seed) as PhysicsEngine;
}

/** Each mode's end banner as Canvas.tsx draws it: the condition its bigBanner() reads. */
const BANNER_SHOWN: Partial<Record<SimulatorSettings["mode"], (e: PhysicsEngine) => boolean>> = {
  accumulation: (e) => e.hasAccumulationEscaped(),
  portal: (e) => e.hasPortalEscaped(),
  shatter: (e) => e.hasShatterEscaped() && collapseDone(e.getShatterView()),
  colorMatch: (e) => e.hasColorMatchEscaped(),
  target: (e) => e.isCountdownMode() && e.isCountdownComplete(),
  drop: (e) => e.getDropProgress().finished,
  box: (e) => e.getBoxProgress().finished,
  pendulum: (e) => e.getPendulumProgress().finished,
  polyrhythm: (e) => e.getPolyrhythmProgress().finished,
  grow: (e) => {
    const v = e.getGrowView();
    return v.phase === "done" && v.firstFillMs >= 0;
  },
};

describe("the end banner's hold", () => {
  it("holds an ending whose banner comes with the run's last step, never in a clip with captions or a loop clip", () => {
    for (const mode of END_BANNER_HOLD_MODES) {
      const hold = endBannerHoldMs({ mode, captioned: false, loopHud: false, mergeRingOverflow: true });
      expect([mode, hold]).toEqual([mode, END_BANNER_HOLD_MS]);
      expect(endBannerHoldMs({ mode, captioned: true, loopHud: false, mergeRingOverflow: true })).toBe(0);
      expect(endBannerHoldMs({ mode, captioned: false, loopHud: true, mergeRingOverflow: true })).toBe(0);
    }
    expect(END_BANNER_HOLD_MS).toBe(1500);
    // Merge Ring holds its OVERFLOW only: its FINAL FORM holds 2 s of its own
    expect(endBannerHoldMs({ mode: "mergeRing", captioned: false, loopHud: false, mergeRingOverflow: false })).toBe(0);
    // the modes whose banner comes earlier keep their own holds
    for (const mode of ["classic", "glass", "journey", "bullseye", "maze", "powerLayers", "multiply", "battle"]) expect([mode, endBannerHoldMs({ mode, captioned: false, loopHud: false })]).toEqual([mode, 0]);
    // one number with the canvas' own hold, which the page and every export wait for
    expect(CANVAS_BANNER_HOLD_MS).toBe(END_BANNER_HOLD_MS);
  });

  it("is for the right modes: each one's banner comes on its run's last frame (the start look, seeds 1 and 2)", () => {
    for (const [mode, shown] of Object.entries(BANNER_SHOWN) as [SimulatorSettings["mode"], (e: PhysicsEngine) => boolean][]) {
      expect(END_BANNER_HOLD_MODES).toContain(mode);
      for (const seed of [1, 2]) {
        const e = startEngine(mode, seed);
        let frame = 0;
        let bannerAt = -1;
        while (frame < 60 * 60 && !e.isSimulationFinished()) {
          e.update(1000 / 60, 0);
          e.consumeSoundEvents();
          frame++;
          if (bannerAt < 0 && shown(e)) bannerAt = frame;
        }
        expect([mode, seed, e.isSimulationFinished(), bannerAt]).toEqual([mode, seed, true, frame]);
        expect(endBannerHoldMs({ mode, captioned: false, loopHud: false })).toBe(END_BANNER_HOLD_MS);
      }
    }
  }, 120_000);

  it("is the planner's too: a clip without captions is held 1.5 s more, a plan (its captions drawn) keeps its length", () => {
    for (const mode of END_BANNER_HOLD_MODES) {
      const s = defaultSettings(mode);
      if (mode === "mergeRing") {
        expect(endHoldsSec(s)).toBe(END_STOP_DELAY_MS / 1000); // (its OVERFLOW is not known before the run)
        continue;
      }
      expect([mode, endHoldsSec(s)]).toEqual([mode, (END_BANNER_HOLD_MS + END_STOP_DELAY_MS) / 1000]);
      expect([mode, endHoldsSec(s, true)]).toEqual([mode, END_STOP_DELAY_MS / 1000]);
      expect([mode, endHoldsSec({ ...s, loopHud: true })]).toEqual([mode, END_STOP_DELAY_MS / 1000]);
    }
    // with a roster the longest hold plays: the teams' 3 s banner
    expect(endHoldsSec({ ...defaultSettings("shatter"), teams: [{ name: "A", color: "#fff" }] as unknown as SimulatorSettings["teams"] })).toBe(3.5);
    expect(endHoldsSec(defaultSettings("classic"))).toBe(0.5);
  });

  /**
   * The fast export's end of a run that finishes at `finishMs` in a 30 s clip, its banner drawn by a real EndBannerLayer from the
   * finishing frame on and the canvas' hold (`fresh()`) fed to the end tracker as the canvas reports it: the clip's tail (ms).
   */
  function exportTail(finishMs: number, holds = NO_END_HOLDS): number {
    const step = 1000 / 60;
    const g = fakeCanvas(1080, 1080).ctx as unknown as CanvasRenderingContext2D;
    const layer = new EndBannerLayer();
    const words = { title: "COMPLETE!", sub: "Counted down from 50", color: "#22d3ee" };
    const tracker = new ExportEndTracker(30_000);
    for (let t = 0; t < tracker.endMs; t += step) {
      const finished = t >= finishMs;
      if (finished) layer.draw(g, words, 540, 540, 1080, step);
      layer.endFrame();
      tracker.frame(t, finished, layer.fresh(), finished ? holds : NO_END_HOLDS);
    }
    return tracker.endMs - finishMs;
  }

  it("ends the export 2 s after a banner that comes with the run's last step: the canvas' hold and the recorder's stop, once", () => {
    const step = 1000 / 60;
    for (const finishMs of [10_700, 29_800]) {
      const tail = exportTail(finishMs);
      // the canvas' 1.5 s and the recorder's 0.5 s: 2 s to a frame, never the 3.5 s of a second hold after the first
      expect(tail).toBeGreaterThanOrEqual(END_BANNER_HOLD_MS + END_STOP_DELAY_MS - step);
      expect(tail).toBeLessThanOrEqual(END_BANNER_HOLD_MS + END_STOP_DELAY_MS + 2 * step);
    }
    // a hold of the page's own after it would add up: what the page and the export no longer do for these endings
    expect(exportTail(10_700, { preMs: 0, postMs: END_BANNER_HOLD_MS })).toBeGreaterThanOrEqual(2 * END_BANNER_HOLD_MS + END_STOP_DELAY_MS - step);
  });

  it("leaves the hold to the canvas on the page and in the fast export, and reads it as a length for a found run's clip (Simulator.tsx)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "Simulator.tsx"), "utf8");
    // the fast export's post hold and the live finish detection's hold: the teams' and the multipliers' alone
    expect(src).toMatch(/const postMs = Math\.max\(teamsPlay \? WINNER_HOLD_MS : 0, engine\.endsWithMultiplierFinish\(\) \? MULT_FINISH_HOLD_MS : 0\);/);
    expect(src).toMatch(/const holdMs = done \? Math\.max\(teamsPlayRef\.current \? WINNER_HOLD_MS : 0, engine\.endsWithMultiplierFinish\(\) \? MULT_FINISH_HOLD_MS : 0\) : 0;/);
    expect(src).toMatch(/endHolds: \(engine\) => fastExportEndHolds\(engine, teamsPlay\),/);
    expect(src).not.toMatch(/endBannerHoldOf/);
    // the found run's recording length covers the canvas' hold
    expect(src).toMatch(/const holdMs = Math\.max\([^;]*endBannerHoldMs\(\{ mode: settings\.mode, captioned: settings\.captions\.length > 0, loopHud: settings\.loopHud \}\)/);
  });
});

describe("the end sting", () => {
  /** The sound events of the start look's run of `mode` (seed `seed`) on its last frame. */
  function lastFrameSounds(mode: SimulatorSettings["mode"], seed: number, at: (e: PhysicsEngine) => boolean): SoundEvent[] {
    const e = startEngine(mode, seed);
    for (let frame = 0; frame < 60 * 60; frame++) {
      e.update(1000 / 60, 0);
      const events = e.consumeSoundEvents();
      if (at(e)) return events;
    }
    return [];
  }

  it("rings the completion chord as Ball Drop's SETTLED! comes in, a sound of its own the crew's moments leave out", () => {
    for (const seed of [1, 2]) {
      const events = lastFrameSounds("drop", seed, (e) => e.isSimulationFinished());
      expect(events.filter((x) => x.loop === "chord")).toEqual([{ type: "hit", wallIndex: 0, loop: "chord", frequency: DROP_SETTLED_HZ, level: 1, melody: false, ringVoice: "extra" }]);
    }
  });

  it("rings the completion chord on the level's tonic as Power Layers' FREEDOM! comes in", () => {
    let tonic = 0;
    const events = lastFrameSounds("powerLayers", 1, (e) => {
      const v = e.getPowerLayersView();
      if (v.freed) tonic = plTonicHz(v.settings.scale, v.settings.rootNote);
      return v.freed;
    });
    expect(tonic).toBeGreaterThan(0);
    expect(events.filter((x) => x.loop === "chord")).toEqual([{ type: "hit", wallIndex: 0, loop: "chord", frequency: tonic, level: 1, melody: false, ringVoice: "extra" }]);
    expect(plTonicHz("major", 0)).toBeCloseTo(130.81, 1);
    for (const root of [0, 5, 11]) {
      const f = plTonicHz("major", root);
      expect(f >= 98 && f < 196).toBe(true);
    }
  });

  it("rings the completion chord as Fight League's verdict card starts its hold, once, a sound of its own", () => {
    for (const seed of [1, 2]) {
      const e = startEngine("fightLeague", seed);
      const chords: { frame: number; ev: SoundEvent }[] = [];
      let holdFrom = -1;
      let frame = 0;
      for (; frame < 90 * 60; frame++) {
        e.update(1000 / 60, 0);
        for (const ev of e.consumeSoundEvents()) if (ev.loop === "chord") chords.push({ frame, ev });
        const v = e.getFightLeagueView();
        if (holdFrom < 0 && v.finished && v.timeMs >= flHoldStartMs(v) - 1e-6) holdFrom = frame;
        if (holdFrom >= 0 && frame > holdFrom + 60 * FL_WIN_HOLD_SEC) break;
      }
      expect(holdFrom).toBeGreaterThan(0);
      expect(chords).toEqual([{ frame: holdFrom, ev: { type: "hit", wallIndex: 0, loop: "chord", frequency: FL_END_CHORD_HZ, level: 1, melody: false, ringVoice: "extra" } }]);
    }
  }, 120_000);
});
