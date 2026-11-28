import { describe, expect, it } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { FINAL_HOLD_MS, conveyorEscapePitch, conveyorFinishChord } from "@/lib/physics/modes/conveyor";
import { CONVEYOR_COUNT_POP_MS, DEFAULT_CONVEYOR_LABELS, conveyorBannerAt, conveyorBannerShown, conveyorCount, conveyorCountPop, ConveyorLayer } from "@/components/simulator/conveyorRenderer";
import { CONVEYOR_RING_CORE_ALPHA, CONVEYOR_RING_HALOS, CONVEYOR_RING_PULSE_MS, conveyorRingPulse, conveyorRingWidth, type ConveyorRenderOptions } from "@/components/simulator/conveyorRenderer"; // --- conveyor-glow ---
import { simulateFacts } from "@/lib/bot/planner";
import { clipStartSettings } from "@/lib/clipPacing";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import type { SoundEvent } from "@/lib/physics/types";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- conveyor-count --- --- conveyor-climb --- (Lane E, E6) The Conveyor Belt reads in a second and builds: a big "3 / 8" over OUT
 * at the top right of the field (components/simulator/conveyorRenderer.ts), the end banner above the arena, every escape a step
 * higher up the scale than the one before into ALL OUT!'s chord (lib/physics/modes/conveyor.ts), and a start look whose run ends
 * inside the 30 s clip (lib/clipPacing.ts).
 */

const WORLD = { width: 800, height: 450 };

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}): PhysicsEngine {
  const s = { ...defaultSettings("conveyor"), ...patch } as SimulatorSettings;
  const f = finderRequestOfSettings(s, WORLD, 60);
  return createEngineForSettings(f.physicsConfig, f.mode, f.modeSettings, seed) as PhysicsEngine;
}

function runAll(e: PhysicsEngine, maxSec = 60): { ms: number; ev: SoundEvent }[] {
  const out: { ms: number; ev: SoundEvent }[] = [];
  for (let frame = 0; frame < maxSec * 60 && !e.isSimulationFinished(); frame++) {
    e.update(1000 / 60, 0);
    for (const ev of e.consumeSoundEvents()) out.push({ ms: e.getElapsedMs(), ev });
  }
  return out;
}

describe("the Conveyor Belt's climb", () => {
  it("plays every escape a step higher than the one before, the last one accented, with ALL OUT!'s chord", () => {
    for (const seed of [1, 2]) {
      const e = engineOf(seed, clipStartSettings("conveyor"));
      const sounds = runAll(e);
      const v = e.getConveyorView();
      expect(v).toMatchObject({ escaped: 8, allDone: true, finished: true, timedOut: false });
      const climb = sounds.filter((x) => x.ev.ringVoice === "extra" && x.ev.loop !== "chord");
      expect(climb).toHaveLength(8);
      climb.forEach((x, k) => {
        expect(x.ev.frequency).toBeCloseTo(conveyorEscapePitch(k, v.settings.scale, v.settings.rootNote), 9);
        expect(x.ev.melody).toBe(false);
        expect(!!x.ev.accent).toBe(k === 7);
        if (k > 0) expect(x.ev.frequency!).toBeGreaterThan(climb[k - 1].ev.frequency!);
      });
      // each with its escape's wall-break sound, in the same step
      const breaks = sounds.filter((x) => x.ev.type === "gap");
      expect(breaks.map((x) => x.ms)).toEqual(climb.map((x) => x.ms));
      // the octave climbed lands on the chord's root, in the same step (--- conveyor-all-out --- E6 review: not once the last ball
      // has rolled down and ridden off, 0.5–4.2 s later)
      const chord = sounds.find((x) => x.ev.chord && x.ev.accent)!;
      expect(chord.ms).toBe(climb[7].ms);
      expect(conveyorEscapePitch(7, v.settings.scale, v.settings.rootNote)).toBeCloseTo(conveyorFinishChord(v.settings.scale, v.settings.rootNote)[0], 6);
      // and the completion chord rings through the banner's hold, in the same step, two octaves under it
      const ring = sounds.filter((x) => x.ev.loop === "chord");
      expect(ring.map((x) => [x.ms, x.ev.ringVoice, x.ev.frequency])).toEqual([[chord.ms, "extra", chord.ev.chord![0] / 4]]);
    }
  }, 60_000);

  // --- conveyor-all-out --- (Lane E, E6 review) the counter read 8 / 8 OUT, then the rings sat empty and silent for up to 4.2 s while
  // the last ball rolled down onto the bottom belt and rode off, and only then came ALL OUT! and its chord
  it("brings ALL OUT! and its chord in the step of the last escape, on every seed, and keeps the run's end where it was", () => {
    const rideOffs: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const e = engineOf(seed, clipStartSettings("conveyor"));
      const v = e.getConveyorView();
      const layer = new ConveyorLayer();
      let outStep = -1;
      let shownStep = -1;
      let chordStep = -1;
      let ringStep = -1;
      let tremolo = false;
      let counterAfter = 0;
      for (let step = 1; step <= 60 * 60 && !e.isSimulationFinished(); step++) {
        e.update(1000 / 60, 0);
        for (const ev of e.consumeSoundEvents()) {
          if (ev.chord && ev.accent) chordStep = step;
          if (ev.loop === "chord") {
            ringStep = step;
            tremolo = !!ev.loopTremolo;
          }
        }
        if (outStep < 0 && v.escaped >= v.max) outStep = step;
        if (shownStep < 0 && conveyorBannerShown(v)) shownStep = step;
        if (shownStep > 0 && !v.allDone) {
          const canvas = fakeCanvas(WORLD.width, WORLD.height);
          layer.drawOverlay(canvas.ctx as unknown as CanvasRenderingContext2D, v, DEFAULT_CONVEYOR_LABELS, WORLD.width, WORLD.height);
          counterAfter += canvas.ctx.calls.filter((c) => c.name === "fillText").length;
        }
      }
      expect([seed, v.finished, v.escaped, v.carried, v.timedOut]).toEqual([seed, true, 8, 8, false]);
      // the banner, its chord and the completion chord ringing on (held, with its tremolo) in the last escape's step
      expect([seed, shownStep, chordStep, ringStep, tremolo]).toEqual([seed, outStep, outStep, outStep, true]);
      expect(Math.abs(v.outAtMs - v.lastEscapeMs)).toBeLessThanOrEqual(1000 / 60 + 1e-6);
      // the counter has stepped aside for it, while the last ball still rides off
      expect([seed, counterAfter]).toEqual([seed, 0]);
      // the run still ends FINAL_HOLD_MS after the last ball has ridden off the field: the links and the finder's lengths keep it
      expect(v.doneAtMs).toBeGreaterThanOrEqual(v.outAtMs);
      expect(v.finishedMs - v.doneAtMs).toBeGreaterThanOrEqual(FINAL_HOLD_MS - 1e-6);
      expect(v.finishedMs - v.doneAtMs).toBeLessThan(FINAL_HOLD_MS + 1000 / 60);
      rideOffs.push(v.doneAtMs - v.outAtMs);
    }
    // seeds 1–12 of the start look: the last ball rode off 0.5–4.2 s after its escape, where the banner used to wait
    expect(Math.min(...rideOffs)).toBeGreaterThan(400);
    expect(Math.max(...rideOffs)).toBeGreaterThan(4000);
    // the planner times a clip's payoff on the banner too (MARK_MODES: the conveyor's last ball out)
    const s = { ...defaultSettings("conveyor"), ...clipStartSettings("conveyor") } as SimulatorSettings;
    const facts = simulateFacts(finderRequestOfSettings(s, WORLD, 40), 9, { strategy: "finish" }, 40);
    const nine = engineOf(9, clipStartSettings("conveyor"));
    runAll(nine, 40);
    expect(facts.markSec! * 1000).toBeCloseTo(nine.getConveyorView().outAtMs, 6);
    expect(facts.finishSec * 1000).toBeCloseTo(nine.getConveyorView().finishedMs, 6);
    // the bowl and the pegs: their banner comes once the arena has settled, as before
    for (const cvArena of ["bowl", "pegs"] as const) {
      const a = engineOf(1, { cvArena, cvMaxBalls: 6, cvInterval: 1 });
      runAll(a, 60);
      const av = a.getConveyorView();
      expect([cvArena, av.finished, av.outAtMs]).toEqual([cvArena, true, av.doneAtMs]);
    }
  }, 120_000);

  it("starts a bare visit at a ball every 2 s, so ALL OUT! lands inside the 30 s clip (the link base keeps 3 s)", () => {
    expect(clipStartSettings("conveyor")).toEqual({ cvInterval: 2 });
    expect(defaultSettings("conveyor").cvInterval).toBe(3);
    for (const seed of [1, 2, 3, 4]) {
      const e = engineOf(seed, clipStartSettings("conveyor"));
      runAll(e, 40);
      const v = e.getConveyorView();
      // the banner with its 2 s (the run's own 1.5 s hold and the recorder's stop) inside 30 s
      expect([seed, v.finished, v.doneAtMs / 1000 + 2 <= 30]).toEqual([seed, true, true]);
    }
  }, 60_000);
});

describe("the Conveyor Belt's counter and banner", () => {
  it("counts the balls out (rings), loaded (the bowl) or landed (pegs) of all, popping as the count goes up", () => {
    const rings = engineOf(1).getConveyorView();
    expect(conveyorCount(rings, DEFAULT_CONVEYOR_LABELS)).toMatchObject({ n: 0, of: 8, word: "OUT" });
    const bowl = engineOf(1, { cvArena: "bowl" }).getConveyorView();
    expect(conveyorCount(bowl, DEFAULT_CONVEYOR_LABELS)).toMatchObject({ word: "LOADED", of: 8 });
    const pegs = engineOf(1, { cvArena: "pegs" }).getConveyorView();
    expect(conveyorCount(pegs, DEFAULT_CONVEYOR_LABELS)).toMatchObject({ word: "LANDED", of: 8 });
    expect(conveyorCountPop(0)).toBeCloseTo(1.35, 9);
    expect(conveyorCountPop(CONVEYOR_COUNT_POP_MS)).toBe(1);
    expect(conveyorCountPop(Infinity)).toBe(1);
    expect(conveyorCountPop(-1)).toBe(1);
    expect(DEFAULT_CONVEYOR_LABELS.spilled(3)).toBe("3 spilled");
  });

  it("draws the count big at the top right of the field while the run goes, and steps aside for the end banner", () => {
    const e = engineOf(1, clipStartSettings("conveyor"));
    for (let i = 0; i < 60 * 8; i++) e.update(1000 / 60, 0);
    const v = e.getConveyorView();
    const canvas = fakeCanvas(WORLD.width, WORLD.height);
    const layer = new ConveyorLayer();
    layer.drawOverlay(canvas.ctx as unknown as CanvasRenderingContext2D, v, DEFAULT_CONVEYOR_LABELS, WORLD.width, WORLD.height);
    const texts = canvas.ctx.calls.filter((c) => c.name === "fillText");
    expect(texts.map((c) => c.args[0])).toEqual([" / 8", String(v.escaped), "OUT"]);
    // inside the field, at its top right, clear of the belt and the rings
    const side = Math.min(WORLD.width, WORLD.height);
    const L = v.layout!;
    // (the count is drawn at the origin of its own translate: the pop scales it about its right end)
    const at = (c: { name: string; args: unknown[] }, i: number) => (c.args[1] === 0 && c.args[2] === 0 ? (canvas.ctx.calls.filter((x) => x.name === "translate").at(-1)!.args[i - 1] as number) : (c.args[i] as number));
    for (const c of texts) {
      expect(at(c, 1)).toBeLessThanOrEqual(L.right);
      expect(at(c, 1)).toBeGreaterThan(L.cx);
      expect(at(c, 2)).toBeLessThan(L.cy - L.ringRadii[L.ringRadii.length - 1]);
    }
    expect(side).toBe(450);
    runAll(e, 40);
    const done = fakeCanvas(WORLD.width, WORLD.height);
    layer.drawOverlay(done.ctx as unknown as CanvasRenderingContext2D, e.getConveyorView(), DEFAULT_CONVEYOR_LABELS, WORLD.width, WORLD.height);
    expect(done.ctx.calls.filter((c) => c.name === "fillText")).toEqual([]);
  }, 60_000);

  it("puts the end banner above the rings and the pegs, and under the bowl", () => {
    const side = Math.min(WORLD.width, WORLD.height);
    const rings = engineOf(1).getConveyorView();
    const L = rings.layout!;
    const ringTop = (L.cy - L.ringRadii[L.ringRadii.length - 1] - (WORLD.height - side) / 2) / side;
    const at = conveyorBannerAt(rings, WORLD.width, WORLD.height)!;
    expect(at).toBeCloseTo((0.02 + ringTop) / 2, 9);
    expect(at).toBeLessThan(ringTop);
    expect(conveyorBannerAt(engineOf(1, { cvArena: "bowl" }).getConveyorView(), WORLD.width, WORLD.height)).toBe(0.78);
    const pegs = engineOf(1, { cvArena: "pegs" }).getConveyorView();
    expect(conveyorBannerAt(pegs, WORLD.width, WORLD.height)!).toBeLessThan(0.25);
  });
});

// --- conveyor-glow --- (round two, B9b) the rings lit: the darkest clip of its group read as thin rings at 60 % until the first ball
// got out; now every ring the canvas drew gets two halos and a core in its own colour, studs at its gap's ends, brighter on every OUT
describe("--- conveyor-glow --- the lit rings", () => {
  const TWO_PI = Math.PI * 2;
  /** The layer's world pass over the view with the canvas' walls, logging each ring stroke's (ring, alpha) and the lines' widths. */
  function drawLit(e: PhysicsEngine, patch: Partial<ConveyorRenderOptions> = {}) {
    const canvas = fakeCanvas(WORLD.width, WORLD.height);
    const ctx = canvas.ctx;
    const styles: [number, number][] = [];
    const widths: number[] = [];
    const stroke = ctx.stroke as (...a: unknown[]) => void;
    ctx.stroke = (...a: unknown[]) => {
      widths.push(ctx.lineWidth);
      stroke(...a);
    };
    const opts: ConveyorRenderOptions = {
      wallAlpha: (a) => `rgba(255, 255, 255, ${a})`,
      wallThickness: 2,
      showWallGlow: true,
      walls: e.getCircularWalls(),
      rotations: e.getWallRotations(),
      ringStyle: (i, a) => {
        styles.push([i, a]);
        return `hsla(${i}, 100%, 60%, ${a})`;
      },
      ...patch,
    };
    new ConveyorLayer().drawWorld(ctx as unknown as CanvasRenderingContext2D, e.getConveyorView(), opts);
    return { calls: ctx.calls, styles, widths };
  }

  it("strokes every ring the canvas drew with two halos and a core, between its gap, turned as drawn, and studs its gap's ends", () => {
    const e = engineOf(7, clipStartSettings("conveyor"));
    for (let i = 0; i < 90; i++) e.update(1000 / 60, 0);
    const walls = e.getCircularWalls();
    const rotations = e.getWallRotations();
    expect(walls.length).toBeGreaterThan(2);
    expect(rotations.some((r) => r !== 0)).toBe(true); // (the rings have turned: the lit arcs must turn with them)
    const { calls, styles, widths } = drawLit(e);
    const passes = CONVEYOR_RING_HALOS.length + 1;
    expect(styles).toHaveLength(passes * walls.length);
    // the halos widest and faintest first, the core last, every ring in each pass
    for (let pass = 0; pass < passes; pass++) {
      const alpha = pass < CONVEYOR_RING_HALOS.length ? CONVEYOR_RING_HALOS[pass].alpha : CONVEYOR_RING_CORE_ALPHA;
      expect(styles.slice(pass * walls.length, (pass + 1) * walls.length)).toEqual(walls.map((_, i) => [i, alpha]));
    }
    const core = conveyorRingWidth(2, Math.min(WORLD.width, WORLD.height));
    expect(widths.slice(0, passes * walls.length)).toEqual([...walls.map(() => CONVEYOR_RING_HALOS[0].width * core), ...walls.map(() => CONVEYOR_RING_HALOS[1].width * core), ...walls.map(() => core)]);
    // each ring's wall: from its gap's end round to its start, turned by the ring's rotation (the gap left open), as the canvas
    // walks it from 0 (a ring whose gap starts past 0 in two arcs)
    const L = e.getConveyorView().layout!;
    walls.forEach((wall, i) => {
      const gap = wall.gaps[0];
      const per = gap.startAngle > 0 ? 2 : 1;
      const arcs = calls.filter((c) => c.name === "arc" && c.args[2] === wall.radius);
      expect(arcs).toHaveLength(passes * per);
      for (let pass = 0; pass < passes; pass++) {
        const mine = arcs.slice(pass * per, (pass + 1) * per);
        for (const a of mine) expect([a.args[0], a.args[1]]).toEqual([L.cx, L.cy]);
        const swept = mine.reduce((sum, a) => sum + ((a.args[4] as number) - (a.args[3] as number)), 0);
        expect(swept).toBeCloseTo(TWO_PI - (gap.endAngle - gap.startAngle), 9);
        expect(mine.at(-1)!.args[3] as number).toBeCloseTo(gap.endAngle + rotations[i], 9);
        if (per === 2) expect(mine[0].args[4] as number).toBeCloseTo(gap.startAngle + rotations[i], 9);
      }
    });
    // a stud at both ends of every gap, filled once
    const studs = calls.filter((c) => c.name === "arc" && c.args[2] === 0.7 * core);
    expect(studs).toHaveLength(2 * walls.length);
    const g0 = walls[0].gaps[0];
    expect(studs[0].args[0] as number).toBeCloseTo(L.cx + walls[0].radius * Math.cos(g0.startAngle + rotations[0]), 9);
    expect(studs[1].args[1] as number).toBeCloseTo(L.cy + walls[0].radius * Math.sin(g0.endAngle + rotations[0]), 9);
    // the same picture for the same moment
    expect(JSON.stringify(drawLit(e).calls)).toBe(JSON.stringify(calls));
  });

  it("lights nothing without the canvas' walls, nor in the bowl or the peg field", () => {
    const rings = engineOf(7, clipStartSettings("conveyor"));
    rings.update(1000 / 60, 0);
    const ringArcs = (calls: { name: string; args: unknown[] }[], e: PhysicsEngine) => calls.filter((c) => c.name === "arc" && e.getCircularWalls().some((w) => w.radius === c.args[2])).length;
    expect(ringArcs(drawLit(rings, { walls: undefined }).calls, rings)).toBe(0);
    expect(drawLit(rings, { ringStyle: undefined }).styles).toEqual([]);
    for (const arena of ["bowl", "pegs"] as const) {
      const e = engineOf(7, { cvArena: arena });
      e.update(1000 / 60, 0);
      expect(e.getCircularWalls()).toEqual([]);
      expect(drawLit(e, { walls: rings.getCircularWalls(), rotations: rings.getWallRotations() }).styles).toEqual([]);
    }
  });

  it("brightens and widens the rings on every ball out, for CONVEYOR_RING_PULSE_MS of simulation time", () => {
    expect(conveyorRingPulse(0)).toBe(1);
    expect(conveyorRingPulse(-1)).toBe(0);
    expect(conveyorRingPulse(-Infinity)).toBe(0);
    expect(conveyorRingPulse(Infinity)).toBe(0);
    expect(conveyorRingPulse(CONVEYOR_RING_PULSE_MS)).toBe(0);
    for (let t = 10; t < CONVEYOR_RING_PULSE_MS; t += 10) expect(conveyorRingPulse(t)).toBeLessThan(conveyorRingPulse(t - 10));
    // the core: the Wall Thickness and at most 4 px more, at least 0.55 % of the square (no ceiling on the thickness)
    expect(conveyorRingWidth(2, 450)).toBe(4);
    expect(conveyorRingWidth(1, 450)).toBeCloseTo(2.475, 12);
    expect(conveyorRingWidth(10, 450)).toBe(14);
    expect(conveyorRingWidth(40, 450)).toBe(44);
    expect(conveyorRingWidth(Number.NaN, 450)).toBe(4);
    // in a run: the step a ball gets out, the halos are brighter and every line wider than a moment later
    const e = engineOf(3, clipStartSettings("conveyor"));
    const v = e.getConveyorView();
    let out: ReturnType<typeof drawLit> | null = null;
    for (let step = 0; step < 60 * 40 && !out; step++) {
      e.update(1000 / 60, 0);
      if (v.escaped > 0 && v.timeMs - v.lastEscapeMs < 1) out = drawLit(e);
    }
    expect(out).not.toBeNull();
    for (let i = 0; i < Math.ceil(CONVEYOR_RING_PULSE_MS / (1000 / 60)) + 1; i++) e.update(1000 / 60, 0);
    expect(v.timeMs - v.lastEscapeMs).toBeGreaterThanOrEqual(CONVEYOR_RING_PULSE_MS); // (no other ball out meanwhile on this seed)
    const calm = drawLit(e);
    const n = e.getCircularWalls().length;
    expect(out!.styles[0][1]).toBeGreaterThan(calm.styles[0][1]);
    expect(out!.widths[0]).toBeGreaterThan(calm.widths[0]);
    expect(out!.widths[2 * n]).toBeCloseTo(1.35 * calm.widths[2 * n], 6);
  });
});
