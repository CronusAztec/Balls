import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { clipPacingDefaults, clipStartSettings } from "@/lib/clipPacing";
import { GALLERY } from "@/content/gallery";
import { MultiplyMode, RACE_BOUNCE_GAP_MS, RACE_CHORD_HZ, RACE_ESCAPE_GAP_MS, RACE_HOLD_MS, aimAtGap, flightTo, raceChord, racePluckHz } from "@/lib/physics/modes/multiply";
import { DOUBLE_POP_MS, SWARM_PALETTE, SwarmLayer, doublePopScale, generationColor, swarmShare } from "@/components/simulator/multiplySwarmRenderer";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { modeDetail } from "@/lib/agentKit/modeCatalog";
import en from "../messages/en.json";
import { createEngineForSettings, runNeverFinishes } from "@/lib/simulation/finder";
import { outcomeContextOfSettings } from "@/lib/simulation/outcomeContext";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- multiply-race --- Multiply as a clip (lib/physics/modes/multiply.ts, components/simulator/multiplySwarmRenderer.ts):
 *  - the link base plays as it did (the bot's count-multiply plans and the crew's corpus run it); the race to the limit is a
 *    setting (`multiplyRace`, URL `mrace`) that the studio's start look and the Swarm Race card turn on (--- review fix (B5) ---
 *    through the page's gap of 0.3, with a pacer that keeps one ball aimed at the gap and balls that pass through each other);
 *  - the race's start ball leaves through the gap at once, the swarm reaches its limit and the run ends inside the clip;
 *  - its sound is the swarm's own: an arpeggio per escape and a pluck per bounce, each gated, the chord at the limit;
 *  - every run's balls carry their generation, which the canvas colours, and its count doubles on a meter.
 */

const STEP = 1000 / 60;
const PHONE = { width: 450, height: 450 };
const LAPTOP = { width: 800, height: 450 };

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}, world = PHONE): PhysicsEngine {
  const s = { ...defaultSettings("multiply"), ...patch } as SimulatorSettings;
  const request = finderRequestOfSettings(s, world, 60);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

const START = clipStartSettings("multiply");

function runOf(engine: PhysicsEngine, maxSec = 40) {
  const events: { t: number; ev: SoundEvent }[] = [];
  let firstEscape = -1;
  for (let i = 1; i <= maxSec * 60 && !engine.isSimulationFinished(); i++) {
    engine.update(STEP, 0);
    for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs(), ev });
    if (firstEscape < 0 && engine.getMultiplyView().escapes > 0) firstEscape = engine.getElapsedMs();
  }
  return { events, firstEscape, view: engine.getMultiplyView(), finished: engine.isSimulationFinished(), endMs: engine.getElapsedMs() };
}

describe("the link base and the start look", () => {
  it("keeps the link base: the race off, the gap 0.3, a bare link the same; the start look and the card turn the race on", () => {
    const d = defaultSettings("multiply");
    expect([d.multiplyRace, d.gapSize, d.multiplySpawnCount, d.swarmLimit]).toEqual([false, 0.3, 3, 200]);
    expect(settingsToSearchParams(d).toString()).toBe("mode=multiply");
    expect(clipPacingDefaults("multiply")).toEqual({});
    expect(START).toEqual({ multiplyRace: true });
    const start = { ...d, ...START } as SimulatorSettings;
    expect(settingsToSearchParams(start).toString()).toBe("mode=multiply&mrace=1");
    expect(settingsFromSearchParams(settingsToSearchParams(start))).toMatchObject(START);
    const card = GALLERY.find((p) => p.id === "swarm-race")!;
    expect(settingsFromSearchParams(new URLSearchParams(card.query))).toMatchObject({ mode: "multiply", ...START });
    // the finder has a length to search only in a race
    expect(runNeverFinishes("multiply", { ...finderRequestOfSettings(d, PHONE, 30).modeSettings })).toBe(true);
    expect(runNeverFinishes("multiply", { ...finderRequestOfSettings(start, PHONE, 30).modeSettings })).toBe(false);
    expect(outcomeContextOfSettings(d).endless).toBe(true);
    expect(outcomeContextOfSettings(start).endless).toBe(false);
    // a plan's request is what it was: no race key unless the race is on
    expect("multiplyRace" in finderRequestOfSettings(d, PHONE, 30).modeSettings).toBe(false);
  });

  it("--- review fix (B5) --- resolves the race in presetToSettings: a real boolean or the default, so links, presets and files agree", () => {
    expect(presetToSettings({ mode: "multiply", multiplyRace: true }).multiplyRace).toBe(true);
    expect(presetToSettings({ mode: "multiply" }).multiplyRace).toBe(false);
    for (const bad of [1, "true", "false", null]) expect(presetToSettings({ mode: "multiply", multiplyRace: bad } as unknown as Partial<SimulatorSettings>).multiplyRace, String(bad)).toBe(false);
    expect(modeDetail("multiply", en)!.linkProblems.filter((problem) => problem.startsWith("multiplyRace"))).toEqual([]);
    expect(modeDetail("grow", en)!.linkProblems).toEqual([]);
  });

  it("plays the link base as before: a crash per escape, no end, and no race sounds", () => {
    const { events, view, finished } = runOf(engineOf(3), 30);
    expect(finished).toBe(false);
    expect(view.race).toBe(false);
    expect(view.fullMs).toBe(-1);
    const gaps = events.filter(({ ev }) => ev.type === "gap").length;
    expect(gaps).toBe(view.escapes);
    expect(events.some(({ ev }) => ev.type === "multiplier")).toBe(false);
  });
});

describe("the race to the limit", () => {
  it("aims the start ball at the gap: out within a second on every seed, in both worlds", () => {
    for (const world of [PHONE, LAPTOP]) {
      for (let seed = 1; seed <= 12; seed++) {
        const engine = engineOf(seed, START, world);
        for (let i = 0; i < 60 && engine.getMultiplyView().escapes === 0; i++) engine.update(STEP, 0);
        expect(engine.getMultiplyView().escapes, `seed ${seed} ${world.width}`).toBeGreaterThan(0);
        expect(engine.getElapsedMs()).toBeLessThan(1000);
      }
    }
  });

  it("reaches the swarm's limit and ends inside the clip: the full swarm, the hold, the run over", { timeout: 60_000 }, () => {
    let inside = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const { view, finished, endMs } = runOf(engineOf(seed, START), 40);
      expect(finished, `seed ${seed}`).toBe(true);
      expect(view.fullMs).toBeGreaterThan(0);
      expect(view.limit).toBe(200);
      expect(endMs).toBeCloseTo(view.fullMs + RACE_HOLD_MS, -2);
      if (endMs <= 27_000) inside++;
    }
    // measured when this was written (seeds 1–30, both worlds): 30 of 30 over by 27 s, median 17.7 s (--- review fix (B5) --- with
    // the pacer through the gap of 0.3: 30 of 30 over at 17.3–24.4 s, median 19.5 s)
    expect(inside).toBe(5);
  });

  it("--- review fix (B5) --- keeps the count climbing: a pacer aimed at the gap and balls passing through each other", { timeout: 60_000 }, () => {
    for (const world of [PHONE, LAPTOP]) {
      for (let seed = 1; seed <= 6; seed++) {
        const engine = engineOf(seed, START, world);
        let peak = 0;
        let rise = 0;
        let still = 0;
        for (let i = 1; i <= 10 * 60; i++) {
          engine.update(STEP, 0);
          const n = engine.getMultiplyView().count;
          if (n > peak) {
            still = Math.max(still, engine.getElapsedMs() - rise);
            peak = n;
            rise = engine.getElapsedMs();
          }
        }
        still = Math.max(still, engine.getElapsedMs() - rise);
        // measured when this was written (seeds 1–30): never still for more than 1.6 s in the first 10 s (before: 3–8 s)
        expect(still, `seed ${seed} ${world.width}`).toBeLessThan(2500);
        const { endMs, finished } = runOf(engine, 40);
        expect(finished, `seed ${seed}`).toBe(true);
        expect(endMs, `seed ${seed}`).toBeGreaterThan(15_000);
        expect(endMs, `seed ${seed}`).toBeLessThan(25_000);
      }
    }
    // only a race passes through: the link base keeps its rebounds
    const mode = new MultiplyMode();
    expect(mode.ballsPassThrough).toBe(false);
    mode.setRace(true);
    expect(mode.ballsPassThrough).toBe(true);
  });

  it("ends at the Swarm Limit as set, never at a slider's maximum", () => {
    const { view, finished } = runOf(engineOf(2, { ...START, swarmLimit: 40 }), 40);
    expect(finished).toBe(true);
    expect(view.limit).toBe(40);
    expect(view.count).toBeGreaterThanOrEqual(40);
  });

  it("sounds like the swarm: gated arpeggios and plucks that thicken, the chord at the limit, never a buzz or a long silence", { timeout: 60_000 }, () => {
    for (const seed of [4, 7]) {
      const { events, view, endMs } = runOf(engineOf(seed, START), 40);
      const arps = events.filter(({ ev }) => ev.type === "multiplier");
      const plucks = events.filter(({ ev }) => ev.type === "hit" && !ev.loop);
      expect(arps.length).toBeGreaterThan(10);
      for (let i = 1; i < arps.length; i++) expect(arps[i].t - arps[i - 1].t).toBeGreaterThanOrEqual(RACE_ESCAPE_GAP_MS - 1e-6);
      for (let i = 1; i < plucks.length; i++) expect(plucks[i].t - plucks[i - 1].t).toBeGreaterThanOrEqual(RACE_BOUNCE_GAP_MS - 1e-6);
      // the arpeggio climbs with the count
      expect(arps[arps.length - 1].ev.multiplier!).toBeGreaterThan(arps[0].ev.multiplier!);
      // the plucks thicken: chords once the swarm passed 16
      expect(plucks.some(({ ev }) => (ev.chord?.length ?? 1) >= 2)).toBe(true);
      // no crash before the limit, the crash and the chord at it
      expect(events.filter(({ ev, t }) => ev.type === "gap" && t < view.fullMs)).toEqual([]);
      const atFull = events.filter(({ t }) => t === view.fullMs).map(({ ev }) => ev);
      expect(atFull.some((ev) => ev.type === "gap")).toBe(true);
      expect(atFull.find((ev) => ev.loop === "chord")).toMatchObject({ frequency: RACE_CHORD_HZ, loopTremolo: true });
      expect(events.length / (endMs / 1000), `seed ${seed}`).toBeLessThan(8);
      let last = 0;
      let quiet = 0;
      for (const { t } of events) {
        quiet = Math.max(quiet, t - last);
        last = t;
      }
      expect(quiet, `seed ${seed}`).toBeLessThan(1500);
    }
  });

  it("aims by a flight under gravity that meets the ring where the gap will be", () => {
    const hit = flightTo(Math.PI / 2, 400, 300, 160)!;
    expect(hit.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(hit.t).toBeGreaterThan(0.3);
    expect(hit.t).toBeLessThan(0.4);
    const a = aimAtGap(400, 300, 160, 1, 0.8);
    const at = flightTo(a, 400, 300, 160)!;
    expect(Math.abs(at.angle - (1 + 0.8 * at.t))).toBeLessThan(0.02);
    expect(racePluckHz(0)).toBeCloseTo(261.63, 2);
    expect(racePluckHz(10)).toBeCloseTo(2 * 261.63, 2);
    expect(raceChord(300, 4)).toEqual([300]);
    expect(raceChord(300, 20)).toEqual([300, 450]);
    expect(raceChord(300, 100)).toEqual([300, 450, 600]);
  });
});

describe("the swarm on screen (every run)", () => {
  it("knows every ball's generation: a child is its parent's plus one, and no id outlives its ball", () => {
    const engine = engineOf(5, START);
    let shown = 0;
    for (let i = 0; i < 8 * 60; i++) {
      engine.update(STEP, 0);
      // the count a viewer reads never drops (a ball that flew out leaves the field 2–3 s later)
      expect(engine.getMultiplyView().count).toBeGreaterThanOrEqual(shown);
      expect(engine.getMultiplyView().count).toBeGreaterThanOrEqual(engine.getBalls().length);
      shown = engine.getMultiplyView().count;
    }
    const view = engine.getMultiplyView();
    const balls = engine.getBalls();
    expect(view.topGen).toBeGreaterThanOrEqual(2);
    expect(view.genOf.size).toBeLessThanOrEqual(balls.length);
    const ids = new Set(balls.map((b) => b.id));
    for (const id of view.genOf.keys()) expect(ids.has(id)).toBe(true);
    expect(Math.max(...view.genOf.values())).toBe(view.topGen);
    // the doublings: the last power of two the count reached
    expect(view.doubled).toBeLessThanOrEqual(view.count);
    expect(2 * view.doubled).toBeGreaterThan(view.count);
  });

  it("colours by generation and fills a doubling meter, the same frame for the same moment", () => {
    expect(generationColor(0, "#ffffff")).toBe("#ffffff");
    expect(generationColor(1, "#ffffff")).toBe(SWARM_PALETTE[0]);
    expect(generationColor(SWARM_PALETTE.length + 1, "#ffffff")).toBe(SWARM_PALETTE[0]);
    expect(swarmShare(1, 200)).toBe(0);
    expect(swarmShare(200, 200)).toBe(1);
    expect(swarmShare(16, 256)).toBeCloseTo(0.5, 9);
    expect(swarmShare(50, Infinity)).toBe(0);
    expect(doublePopScale(0)).toBeCloseTo(1.35, 9);
    expect(doublePopScale(DOUBLE_POP_MS)).toBe(1);
    const engine = engineOf(5, START);
    for (let i = 0; i < 6 * 60; i++) engine.update(STEP, 0);
    const view = engine.getMultiplyView();
    const layer = new SwarmLayer();
    const draw = () => {
      const canvas = fakeCanvas(450, 450);
      const ctx = canvas.ctx as unknown as CanvasRenderingContext2D;
      layer.drawWorld(ctx, view, 225, 225, 168, "#ffffff");
      layer.drawEffects(ctx, view, 225, 225, 168, "#ffffff");
      return canvas.ctx.calls;
    };
    const a = draw();
    expect(JSON.stringify(a)).toBe(JSON.stringify(draw()));
    expect(a.some((c) => c.name === "fillText" && c.args[0] === String(view.count))).toBe(true);
    const child = engine.getBalls().find((b) => (view.genOf.get(b.id) ?? 0) >= 1)!;
    expect(layer.colorOf(child, view)).toBe(generationColor(view.genOf.get(child.id)!, child.color));
  });
});
