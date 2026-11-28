import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { clipPacingDefaults, clipStartSettings } from "@/lib/clipPacing";
import { GALLERY } from "@/content/gallery";
import { GROW_BURST_MS, GROW_FULL_SNAP_PX, GrowLayer, growBurstAt, growCoverage, growMeterShare, growShowsShare } from "@/components/simulator/growRenderer";
import { GROW_PULSE_MS, GROW_PULSE_POP, growPulseAt } from "@/components/simulator/growRenderer"; // --- grow-chimes ---
import { GROW_CHIME_LEVEL, GROW_MILESTONES, GROW_MILESTONE_MIDI } from "@/lib/physics/modes/grow"; // --- grow-chimes ---
import { midiToFrequency } from "@/lib/audio/scales"; // --- grow-chimes ---
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { Ball, SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- grow-fill-clip --- Fill and Grow as a clip: the fill-and-finish Grow that was built and switched off is the studio's start
 * look and the Fill the Ring card (the link base stays: the bot's fill-grow plans and the crew's corpus run it). The start look
 * fills inside a clip on every seed with a pluck a bounce, never buzzing; every Grow run shows how full the ring is and lands
 * its fill with a flash and a shockwave (draw only).
 */

const STEP = 1000 / 60;
const START = clipStartSettings("grow");

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}, world = { width: 450, height: 450 }): PhysicsEngine {
  const s = { ...defaultSettings("grow"), ...patch } as SimulatorSettings;
  const request = finderRequestOfSettings(s, world, 60);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

describe("the start look", () => {
  it("is the multiply law at 4 % from 15 % of the ring, the run ending at the fill, colour, markers and pitch by size – the link base untouched", () => {
    expect(START).toEqual({ growLaw: "multiply", growStep: 4, growStart: 15, growOnFill: "finish", growHue: true, growMarkers: true, growPitch: true });
    const d = defaultSettings("grow");
    expect([d.growLaw, d.growOnFill, d.growHue, d.growMarkers, d.growPitch]).toEqual(["approach", "stay", false, false, false]);
    expect(settingsToSearchParams(d).toString()).toBe("mode=grow");
    expect(clipPacingDefaults("grow")).toEqual({});
    const card = GALLERY.find((p) => p.id === "fill-the-ring")!;
    expect(settingsFromSearchParams(new URLSearchParams(card.query))).toMatchObject({ mode: "grow", ...START });
    // (--- gallery-in-clip --- round two A6) the gallery's Matrix Growth card plays the multiply law to the fill too, at the mode's
    // own 11 % a bounce from 5 %: before, the classic Grow it played never ended
    const matrix = settingsFromSearchParams(new URLSearchParams(GALLERY.find((p) => p.id === "matrix-grow")!.query));
    expect([matrix.growLaw, matrix.growOnFill]).toEqual(["multiply", "finish"]);
  });

  it("fills the ring inside the clip on every seed, in both worlds, with a pluck a bounce and no buzz", () => {
    for (const world of [{ width: 450, height: 450 }, { width: 800, height: 450 }]) {
      for (let seed = 1; seed <= 8; seed++) {
        const engine = engineOf(seed, START, world);
        const events: { t: number; ev: SoundEvent }[] = [];
        while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) {
          engine.update(STEP, 0);
          for (const ev of engine.consumeSoundEvents()) events.push({ t: engine.getElapsedMs(), ev });
        }
        const v = engine.getGrowView();
        // measured when this was written (seeds 1–12, both worlds): full at 17.6–20.2 s (--- review fix (B5) --- from 15 % at 4 %)
        expect(v.firstFillMs, `seed ${seed}`).toBeGreaterThan(15_000);
        expect(v.firstFillMs, `seed ${seed}`).toBeLessThan(25_000);
        expect(v.phase).toBe("done");
        expect(engine.isSimulationFinished()).toBe(true);
        const perSec = new Map<number, number>();
        let last = 0;
        let quiet = 0;
        for (const { t } of events) {
          perSec.set(Math.floor(t / 1000), (perSec.get(Math.floor(t / 1000)) ?? 0) + 1);
          quiet = Math.max(quiet, t - last);
          last = t;
        }
        expect(Math.max(...perSec.values()), `seed ${seed}`).toBeLessThanOrEqual(10);
        expect(quiet, `seed ${seed}`).toBeLessThan(1500);
        expect(events.filter(({ ev }) => ev.loop === "chord")).toHaveLength(1);
      }
    }
  });
});

describe("how full the ring is, on screen (every Grow run)", () => {
  const ball = (radius: number): Ball => ({ id: 1, radius }) as unknown as Ball;

  it("reads how full the ring is (the ball's width against the most it can grow to) and times the burst on the simulation clock", () => {
    expect(growCoverage([ball(50)], 100)).toBeCloseTo(0.5, 9);
    expect(growCoverage([ball(100)], 100)).toBe(1);
    expect(growCoverage([ball(100), ball(50)], 100)).toBeCloseTo(0.5, 9);
    expect(growCoverage([], 100)).toBe(0);
    expect(growBurstAt(-1)).toBeNull();
    expect(growBurstAt(0)).toBe(0);
    expect(growBurstAt(GROW_BURST_MS)).toBeNull();
  });

  it("draws the wash, the meter with its number and the fill's burst from the view alone: the same frame for the same moment", () => {
    const engine = engineOf(7, START);
    while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) engine.update(STEP, 0);
    const v = engine.getGrowView();
    const layer = new GrowLayer();
    const draw = (now: number) => {
      const canvas = fakeCanvas(450, 450);
      const ctx = canvas.ctx as unknown as CanvasRenderingContext2D;
      layer.drawWorld(ctx, v, engine.getBalls(), now, "#4af0ff", 225, 225);
      layer.drawEffects(ctx, v, now, "#4af0ff", 225, 225);
      return canvas.ctx.calls;
    };
    const atFill = draw(v.lastFillMs + 100);
    expect(JSON.stringify(atFill)).toBe(JSON.stringify(draw(v.lastFillMs + 100)));
    expect(atFill.some((c) => c.name === "fillText" && c.args[0] === "100%")).toBe(true);
    // the burst is over GROW_BURST_MS after the fill: fewer strokes
    const later = draw(v.lastFillMs + GROW_BURST_MS + 50);
    expect(later.filter((c) => c.name === "stroke").length).toBeLessThan(atFill.filter((c) => c.name === "stroke").length);
  });
});

describe("--- review fix (B5) --- the share's number", () => {
  const ball = (radius: number): Ball => ({ id: 1, radius }) as unknown as Ball;

  it("is drawn only where a fill can happen, and reads full within 1.5 px of the cap", () => {
    const classic = engineOf(3).getGrowView();
    expect([classic.law, classic.onFill]).toEqual(["approach", "stay"]);
    expect(growShowsShare(classic)).toBe(false);
    const start = engineOf(3, START).getGrowView();
    expect(growShowsShare(start)).toBe(true);
    expect(growShowsShare({ ...classic, onFill: "finish" })).toBe(true);
    const growing = { ...start, phase: "grow" as const, cap: 150 };
    expect(growMeterShare(growing, [ball(150 - GROW_FULL_SNAP_PX)])).toBe(1);
    expect(growMeterShare(growing, [ball(145)])).toBeCloseTo(145 / 150, 9);
    expect(growMeterShare({ ...growing, phase: "hold" as const }, [ball(10)])).toBe(1);
  });

  it("sits inside the ring under its top edge, over the ball, and the classic Grow draws no number", () => {
    const texts = (patch: Partial<SimulatorSettings>) => {
      const engine = engineOf(7, patch);
      for (let i = 0; i < 5 * 60; i++) engine.update(STEP, 0);
      const v = engine.getGrowView();
      const canvas = fakeCanvas(450, 450);
      new GrowLayer().drawEffects(canvas.ctx as unknown as CanvasRenderingContext2D, v, engine.getElapsedMs(), "#4af0ff", 225, 225, engine.getBalls());
      return { v, calls: canvas.ctx.calls.filter((c) => c.name === "fillText") };
    };
    const { v, calls } = texts(START);
    expect(calls).toHaveLength(1);
    expect(String(calls[0].args[0])).toMatch(/^\d+%$/);
    expect(Number(calls[0].args[2])).toBeGreaterThan(225 - v.ring);
    expect(Number(calls[0].args[2])).toBeLessThan(225 - 0.5 * v.ring);
    expect(texts({}).calls).toEqual([]);
  });
});

// --- grow-chimes --- (round two, B9b) the first 8 s of the start look barely moved (15 % to 26 %, m1-grow-hook): every milestone of the
// fill – 25, 50 and 75 % – now chimes on a rising ladder and pulses the ring, so the climb reads before the burst
describe("--- grow-chimes --- the fill's milestones", () => {
  const LADDER = GROW_MILESTONE_MIDI.map(midiToFrequency);
  interface Step {
    t: number;
    events: SoundEvent[];
    share: number;
  }
  /** A run to its end (or `maxMs`): every step's events and the meter's share (r / cap of the smallest ball) after it. */
  function steps(engine: PhysicsEngine, maxMs = 40_000): Step[] {
    const out: Step[] = [];
    while (!engine.isSimulationFinished() && engine.getElapsedMs() < maxMs) {
      engine.update(STEP, 0);
      const v = engine.getGrowView();
      out.push({ t: engine.getElapsedMs(), events: engine.consumeSoundEvents(), share: v.phase === "grow" ? growCoverage(engine.getBalls(), v.cap) : 1 });
    }
    return out;
  }
  const chimesOf = (run: Step[]) => run.flatMap((s, i) => s.events.filter((e) => e.loop === "chime").map((e) => ({ i, e })));

  it("chimes 25, 50 and 75 % on a rising ladder as decorative hits, each in its bounce's step with the pluck, never first", () => {
    for (const world of [{ width: 450, height: 450 }, { width: 800, height: 450 }]) {
      for (const seed of [1, 2, 3]) {
        const engine = engineOf(seed, START, world);
        const run = steps(engine);
        const chimes = chimesOf(run);
        expect(chimes.map(({ e }) => e.frequency)).toEqual(LADDER);
        chimes.forEach(({ i, e }, k) => {
          expect(e).toMatchObject({ type: "hit", wallIndex: 0, loop: "chime", level: GROW_CHIME_LEVEL, melody: false, ringVoice: "extra" });
          // the step the meter passed its milestone, with that bounce's pluck
          expect(run[i].share).toBeGreaterThanOrEqual(GROW_MILESTONES[k] - 1e-12);
          expect(run[i - 1].share).toBeLessThan(GROW_MILESTONES[k]);
          expect(run[i].events.some((x) => x.loop === "pluck")).toBe(true);
        });
        // the run's first sound is a contact, as the planner's first impact and the crew read it
        const first = run.find((s) => s.events.length > 0)!;
        expect(first.events.some((x) => x.ringVoice !== "extra")).toBe(true);
        const v = engine.getGrowView();
        expect([v.milestones, v.milestoneMs]).toEqual([3, run[chimes[2].i].t]);
        expect(v.phase).toBe("done");
      }
    }
  });

  it("leaves out the milestones its start size has passed, and a loop chimes every cycle alike", () => {
    const late = chimesOf(steps(engineOf(4, { ...START, growStart: 30 })));
    expect(late.map(({ e }) => e.frequency)).toEqual(LADDER.slice(1));
    const past = engineOf(4, { ...START, growStart: 80 });
    const none = steps(past);
    expect(chimesOf(none)).toEqual([]);
    expect(past.getGrowView().milestones).toBe(3);
    // a loop: every cycle plays the ladder again, from its relaunch
    const engine = engineOf(2, { growLaw: "multiply", growOnFill: "loop", growPitch: true, growStep: 11 });
    const run = steps(engine, 45_000);
    const seams: number[] = [];
    for (const s of run) for (const e of s.events) if (e.loop === "glide") seams.push(s.t);
    expect(seams.length).toBeGreaterThanOrEqual(2);
    const chimes = chimesOf(run).map(({ i, e }) => ({ t: run[i].t, hz: e.frequency }));
    const cycle = (from: number, to: number) => chimes.filter((c) => c.t > from && c.t <= to).map((c) => c.hz);
    expect(cycle(0, seams[0])).toEqual(LADDER);
    expect(cycle(seams[0], seams[1])).toEqual(LADDER);
  });

  it("chimes the classic Grow's milestones too, after its first contact, and replays them exactly", () => {
    const a = steps(engineOf(5), 60_000);
    const b = steps(engineOf(5), 60_000);
    const chimes = chimesOf(a);
    expect(chimes.length).toBeGreaterThanOrEqual(2);
    expect(chimes.map(({ e }) => e.frequency)).toEqual(LADDER.slice(0, chimes.length));
    expect(JSON.stringify(chimesOf(b))).toBe(JSON.stringify(chimes));
    const firstSound = a.findIndex((s) => s.events.length > 0);
    expect(firstSound).toBeLessThan(chimes[0].i);
  });

  it("draws the milestones' ticks and a pulse from the view alone: the meter flashes, a ring leaves the rim and the number pops", () => {
    expect(growPulseAt(-1)).toBeNull();
    expect(growPulseAt(0)).toBe(0);
    expect(growPulseAt(GROW_PULSE_MS)).toBeNull();
    const engine = engineOf(7, START);
    while (engine.getGrowView().milestones < 1) engine.update(STEP, 0);
    const v = engine.getGrowView();
    const at = v.milestoneMs;
    expect(at).toBe(engine.getElapsedMs());
    const layer = new GrowLayer();
    const draw = (now: number) => {
      const canvas = fakeCanvas(450, 450);
      const ctx = canvas.ctx as unknown as CanvasRenderingContext2D;
      layer.drawWorld(ctx, v, engine.getBalls(), now, "#4af0ff", 225, 225);
      const world = canvas.ctx.calls.length;
      layer.drawEffects(ctx, v, now, "#4af0ff", 225, 225, engine.getBalls());
      return { calls: canvas.ctx.calls, world, font: canvas.ctx.font };
    };
    const pulse = draw(at + 50);
    const calm = draw(at + GROW_PULSE_MS + 50);
    expect(JSON.stringify(pulse.calls)).toBe(JSON.stringify(draw(at + 50).calls));
    // the ticks: three across the meter in both; the pulse adds the rim's flash and the ring leaving it
    const strokes = (calls: typeof calm.calls, from = 0, to = calls.length) => calls.slice(from, to).filter((c) => c.name === "stroke").length;
    expect(strokes(pulse.calls, 0, pulse.world)).toBe(strokes(calm.calls, 0, calm.world));
    expect(strokes(calm.calls, 0, calm.world)).toBeGreaterThanOrEqual(GROW_MILESTONES.length + 2);
    expect(strokes(pulse.calls, pulse.world)).toBe(strokes(calm.calls, calm.world) + 2);
    const rings = pulse.calls.slice(pulse.world).filter((c) => c.name === "arc").map((c) => c.args[2] as number);
    expect(Math.max(...rings)).toBeGreaterThan(v.ring);
    // the number: bigger at the pulse, back to its size after it
    const size = (font: string) => Number(/(\d+)px/.exec(font)![1]);
    expect(size(pulse.font)).toBeGreaterThan(size(calm.font));
    expect(size(draw(at).font)).toBe(Math.round(GROW_PULSE_POP * Math.max(12, 0.16 * v.ring)));
  });
});

// --- grow-chimes --- (B-g4 review) under pitch by size the ball also grows on a silent overlap (the approach law at a high rate):
// a milestone passed there chimed alone in its step; it now chimes with the next bounce's pluck
describe("--- grow-chimes --- a chime always shares its step with a contact's sound", () => {
  it("chimes only in a step that plucks, on the approach law with pitch by size at a high rate, in three worlds, replayed exactly", () => {
    let chimes = 0;
    for (const world of [{ width: 450, height: 450 }, { width: 800, height: 450 }, { width: 390, height: 390 }]) {
      for (let seed = 1; seed <= 8; seed++) {
        const run = (): string[] => {
          const engine = engineOf(seed, { growPitch: true, growRate: 10 }, world);
          const log: string[] = [];
          while (!engine.isSimulationFinished() && engine.getElapsedMs() < 40_000) {
            engine.update(STEP, 0);
            const events = engine.consumeSoundEvents();
            const chime = events.filter((e) => e.loop === "chime");
            if (chime.length > 0) expect(events.some((e) => e.ringVoice !== "extra")).toBe(true);
            chimes += chime.length;
            for (const e of chime) log.push(`${engine.getElapsedMs().toFixed(3)}:${e.frequency}`);
          }
          return log;
        };
        expect(run()).toEqual(run());
      }
    }
    expect(chimes).toBeGreaterThan(0);
  });
});
