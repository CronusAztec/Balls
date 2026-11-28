import { describe, expect, it, vi } from "vitest";
import { fakeCanvas } from "./fakeCanvas";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { WT_TITLE_DIM, WT_TITLE_FADE_SEC, sectionRootHz, waveTankSettingsOf, waveTankTitleAlpha, type WaveTankSettings } from "@/lib/physics/waveTank";
import { WT_BELL_CHORD_BELLS, WT_FRONT_COLUMNS, WT_GLOW_FLOOR } from "@/lib/physics/modes/waveTank";
import { WT_CHORD_FLASH, WT_CHORD_FLASH_SEC, WT_LOOK, WT_PILLARS, WT_PILLAR_FLASH, WT_PILLAR_FLASH_SEC, WT_WATER, WaveTankLayer, glowStep, pillarFlash } from "@/components/simulator/waveTankRenderer";
import { drawLoopHud, loopHudCount, loopHudFrame, loopHudLayout } from "@/lib/loop/hud";
import { clipStartSettings } from "@/lib/clipPacing";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

/*
 * --- wave-chapters --- --- wave-glow --- The Wave Tank as a clip (lib/physics/modes/waveTank.ts, components/simulator/
 * waveTankRenderer.ts, lib/clipPacing.ts): every section change is heard (the wall's strike and a step on the new root, the
 * completion chord into the climax), the climax rings the loudest bells together once a second, the water carries its
 * interference pattern (the glow) and the screen across the front edge, the picture is lit by it, and the start look opens on
 * the double slit's stripes and climbs to the grating's beams inside one 30 s loop. None of it moves the pinned ball.
 */

vi.setConfig({ testTimeout: 120_000 });

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;

function wtEngine(patch: Partial<WaveTankSettings> = {}, seed = 7): PhysicsEngine {
  return createEngineForSettings(config, "waveTank", { ...base, waveTank: patch }, seed);
}

/** The engine settings of the page's start look. */
function startLook(): Partial<WaveTankSettings> {
  return waveTankSettingsOf({ ...defaultSettings("waveTank"), ...clipStartSettings("waveTank") } as SimulatorSettings);
}

/** Steps `engine` `frames` times, collecting every sound event with the time it came. */
function run(engine: PhysicsEngine, frames: number): { t: number; e: SoundEvent }[] {
  const out: { t: number; e: SoundEvent }[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(STEP, 0);
    for (const e of engine.consumeSoundEvents()) out.push({ t: engine.getElapsedMs() / 1000, e });
  }
  return out;
}

describe("the Wave Tank's chapters (wave-chapters)", () => {
  it("strikes the wall and steps on the new root at every section change, and rings the completion chord into the climax", () => {
    const engine = wtEngine({ cols: 64 }, 1);
    const events = run(engine, 30 * 60);
    const v = engine.getWaveTankView();
    // the default sections: 1 gap wrapping to 5 s, 2 gaps to 15 s, 7 gaps (the climax) to 25 s, then 1 gap again
    const impacts = events.filter((x) => x.e.loop === "impact");
    expect(impacts.map((x) => Math.round(x.t))).toEqual([5, 15, 25]);
    expect(v.impacts).toBe(3);
    for (const x of impacts) expect(x.e.chord?.length).toBe(3);
    const steps = events.filter((x) => x.e.loop === "step");
    const chords = events.filter((x) => x.e.loop === "chord");
    expect(steps.map((x) => Math.round(x.t))).toEqual([5, 25]);
    expect(chords.map((x) => Math.round(x.t))).toEqual([15]);
    // the step climbs on the section's own root (I, IV, V: never snapped to the bells' scale), the chord on the climax's
    expect(steps.map((x) => x.e.frequency)).toEqual([8 * sectionRootHz(1), 8 * sectionRootHz(0)]);
    expect([...steps, ...chords].every((x) => x.e.loopExact === true && x.e.melody === false)).toBe(true);
    expect(chords[0].e.frequency).toBeCloseTo(2 * sectionRootHz(2), 9);
  });

  it("rings the three loudest bells together once a second in the climax, and only there", () => {
    const engine = wtEngine({ cols: 64 }, 1);
    const events = run(engine, 30 * 60);
    const v = engine.getWaveTankView();
    const chimes = events.filter((x) => x.e.loop === "chime");
    expect(chimes.length).toBeGreaterThan(0);
    // every chime falls inside the climax (15 to 25 s), at most three on one whole second, each a bell's own pitch
    expect(chimes.every((x) => x.t >= 15 - 1e-6 && x.t < 25 - 1e-6)).toBe(true);
    const bySecond = new Map<number, number>();
    for (const x of chimes) bySecond.set(Math.floor(x.t + 1e-9), (bySecond.get(Math.floor(x.t + 1e-9)) ?? 0) + 1);
    expect([...bySecond.values()].every((n) => n >= 1 && n <= WT_BELL_CHORD_BELLS)).toBe(true);
    expect(bySecond.size).toBeGreaterThanOrEqual(8);
    expect(chimes.every((x) => v.bellHz.includes(x.e.frequency!))).toBe(true);
    expect(v.chords).toBe(bySecond.size);
    // the scanned bells are as many as before: a chime is never a strike
    expect(events.filter((x) => x.e.loop === "scan").length).toBe(v.strikes);
  });

  // --- review fix (D1) --- the start look's gaps are centred, so its bells ring in mirrored pairs of equal amplitude: a chord counts
  // an amplitude once and flashes both twins (it flashed bells 2, 4 and 1 while 8, 6 and 9, as loud, stayed brass)
  it("flashes a chord's bells in mirrored pairs where the gaps are centred, with at most three pitches", () => {
    const engine = wtEngine({ ...startLook(), cols: 64 }, 1);
    let checked = 0;
    let pairs = 0;
    for (let k = 0; k < 26 * 60; k++) {
      engine.update(STEP, 0);
      const chimes = engine.consumeSoundEvents().filter((e) => e.loop === "chime");
      if (chimes.length === 0) continue;
      const view = engine.getWaveTankView();
      const n = view.bells;
      const lit = Array.from({ length: n }, (_, b) => view.bellStrikeSec[b] === view.chordSec);
      expect(chimes.length).toBeLessThanOrEqual(WT_BELL_CHORD_BELLS);
      expect(new Set(chimes.map((e) => e.frequency)).size).toBe(chimes.length);
      expect(lit.filter(Boolean).length).toBeGreaterThanOrEqual(chimes.length);
      for (let b = 0; b < n; b++) {
        if (b === n - 1 - b || Math.abs(view.bellAmp[b] - view.bellAmp[n - 1 - b]) > 1e-9 * view.bellAmp[b]) continue;
        expect([view.chordSec, b, lit[b]]).toEqual([view.chordSec, b, lit[n - 1 - b]]);
        if (lit[b]) pairs++;
      }
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(8);
    expect(pairs).toBeGreaterThan(0);
  });

  it("keeps a sound going: no stretch longer than half a second without one", () => {
    const engine = wtEngine({ ...startLook(), cols: 64 }, 1);
    let quiet = 0;
    let longest = 0;
    for (let k = 0; k < 30 * 60; k++) {
      engine.update(STEP, 0);
      if (engine.consumeSoundEvents().length === 0) longest = Math.max(longest, ++quiet);
      else quiet = 0;
    }
    expect(longest * STEP).toBeLessThan(500);
  });
});

describe("the lit water (wave-glow)", () => {
  it("carries the smoothed amplitude at every ridge sample and across the front edge, finite and from the floor up", () => {
    for (const patch of [{ cols: 64 }, { model: "huygens" as const }]) {
      const engine = wtEngine(patch, 1);
      run(engine, 6 * 60);
      const v = engine.getWaveTankView();
      expect(v.glow.length).toBe(v.heights.length);
      expect(v.front.length).toBe(WT_FRONT_COLUMNS);
      expect(Array.from(v.glow).every((g) => Number.isFinite(g) && g >= 0)).toBe(true);
      expect(Array.from(v.front).every((g) => Number.isFinite(g) && g >= 0)).toBe(true);
      expect(v.glowReference).toBeGreaterThanOrEqual(WT_GLOW_FLOOR);
      expect(Math.max(...v.front)).toBeGreaterThan(0.05);
    }
  });

  it("shows the double slit's stripes on the screen: a bright middle band between dark ones, bright again at the sides", () => {
    // the start look's two gaps on the page's grid, 6 s in: the middle (the zeroth order) bright, a dark band on each side of
    // it (the first minima), the screen's brightest column more than twice its darkest
    const engine = wtEngine(startLook(), 1);
    run(engine, 6 * 60);
    const v = engine.getWaveTankView();
    expect(v.gaps).toBe(2);
    const front = Array.from(v.front);
    const max = Math.max(...front);
    const n = front.length;
    expect(max).toBeGreaterThan(2 * Math.min(...front));
    expect(Math.max(...front.slice(n / 2 - 4, n / 2 + 4))).toBeGreaterThan(0.6 * max);
    expect(Math.min(...front.slice(4, n / 2 - 4))).toBeLessThan(0.4 * max);
    expect(Math.min(...front.slice(n / 2 + 4, n - 4))).toBeLessThan(0.4 * max);
    expect(Math.max(front[0], front[1])).toBeGreaterThan(0.5 * max);
  });

  it("lights the picture by the pattern: the water in its six light steps, the pillars of the screen, the same frame twice", () => {
    // the climax's beams on the page's grid
    const engine = wtEngine(startLook(), 1);
    run(engine, 24 * 60);
    const view = engine.getWaveTankView();
    const draw = () => {
      const canvas = fakeCanvas(800, 600);
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args?: unknown[] }[] };
      const layer = new WaveTankLayer();
      layer.drawStage(ctx, view, view.timeSec, { dpr: 1, showGlow: false, background: "#070b17" });
      return { layer, calls: ctx.calls.map((c) => c.name) };
    };
    const a = draw();
    expect(a.layer.litPillars).toBeGreaterThan(0);
    expect(a.layer.waterLight).toBeGreaterThan(1);
    expect(a.layer.waterLight).toBeLessThanOrEqual(WT_WATER.length - 1);
    expect(draw().calls).toEqual(a.calls);
    expect([glowStep(0, 1, 6), glowStep(1, 1, 6), glowStep(5, 1, 6), glowStep(0.5, 0, 6)]).toEqual([0, 5, 5, 0]);
  });

  // --- review fix (D1) --- the crests of the ridges behind the wall stood taller than their spacing and their faces covered the
  // golden bar drawn after the first one: it is drawn after the last of them now, as a paddle standing a crest above the water
  it("draws the wave-maker after the water behind the wall and before the wall, standing above the water line", () => {
    const engine = wtEngine(startLook(), 1);
    run(engine, 4 * 60);
    const view = engine.getWaveTankView();
    const ctx = fakeCanvas(800, 600).getContext("2d") as unknown as Record<string, unknown>;
    // (the fills in order, each with its colour and the y of its path's points)
    const fills: string[] = [];
    const ys: number[][] = [];
    let path: number[] = [];
    const logged = new Proxy(ctx, {
      get(target, key) {
        if (key === "beginPath") return () => { path = []; };
        if (key === "moveTo" || key === "lineTo") return (_x: number, y: number) => { path.push(y); };
        if (key === "fill") return () => { fills.push(String(target.fillStyle)); ys.push(path); };
        const value = target[key as string];
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    }) as unknown as CanvasRenderingContext2D;
    new WaveTankLayer().drawStage(logged, view, view.timeSec, { dpr: 1, showGlow: false, background: "#070b17" });
    const paddle = fills.indexOf(WT_LOOK.sourceGlow);
    const wall = fills.indexOf(WT_LOOK.slateFace);
    expect(paddle).toBeGreaterThan(0);
    expect(wall).toBeGreaterThan(paddle);
    // no water face is drawn between the paddle and the wall: every ridge behind the wall came before it
    expect(fills.slice(paddle + 1, wall).some((f) => (WT_WATER as readonly string[]).includes(f))).toBe(false);
    // the paddle stands up from the water line: its top edge (its last two points) above its foot (its first two)
    const [footL, footR, topR, topL] = ys[paddle];
    expect(Math.max(topR, topL)).toBeLessThan(Math.min(footL, footR) - 2);
  });
});

describe("the Wave Tank's start look (wave-chapters)", () => {
  it("opens on two gaps, climbs to the grating's beams and loops in 30 s; its link carries the look and replays it", () => {
    const start = clipStartSettings("waveTank");
    expect(start).toEqual({ wtGaps: "2@13, 1@8, 7@9", wtWrap: 5, wtSpacing: 2.5 });
    const engine = wtEngine({ ...startLook(), cols: 64 }, 1);
    const v = engine.getWaveTankView();
    expect([v.loopSec, v.gaps]).toEqual([30, 2]);
    // all seven gaps of the climax fit in the tank at 2.5 wavelengths apart
    run(engine, 17 * 60);
    expect([engine.getWaveTankView().gaps, engine.getWaveTankView().gapX.length, engine.getWaveTankView().climax]).toEqual([7, 7, true]);
    const page = { ...defaultSettings("waveTank"), ...start } as SimulatorSettings;
    const link = settingsToSearchParams(page);
    expect(settingsFromSearchParams(link)).toMatchObject(start);
    // the link base is what it was
    expect(defaultSettings("waveTank")).toMatchObject({ wtGaps: "1, 2, 7", wtWrap: 5, wtSpacing: 2 });
  });
});

// --- pillar-flash --- --- wave-chapters --- (round two, B8) the climax's pillars flash white; the title dims away from the double slit
describe("the climax's flash and the title through the chapters (round two, B8)", () => {
  it("flashes the pillars white as the climax comes in and softer on each of its bell chords, never outside it", () => {
    expect(pillarFlash({ climax: false, changeSec: 15, chordSec: 15 }, 15)).toBe(0);
    expect(pillarFlash({ climax: true, changeSec: 15, chordSec: -1 }, 15)).toBeCloseTo(WT_PILLAR_FLASH, 12);
    expect(pillarFlash({ climax: true, changeSec: 15, chordSec: -1 }, 15 + WT_PILLAR_FLASH_SEC / 2)).toBeCloseTo(WT_PILLAR_FLASH / 2, 12);
    expect(pillarFlash({ climax: true, changeSec: 15, chordSec: -1 }, 15 + WT_PILLAR_FLASH_SEC)).toBe(0);
    expect(pillarFlash({ climax: true, changeSec: 15, chordSec: 18 }, 18)).toBeCloseTo(WT_CHORD_FLASH, 12);
    expect(pillarFlash({ climax: true, changeSec: 15, chordSec: 18 }, 18 + WT_CHORD_FLASH_SEC)).toBe(0);
    // in the engine: the default sections' climax comes in at 15 s with its chord, the pillars drawn again in white over the screen
    const engine = wtEngine({ cols: 64 }, 1);
    const drawAt = () => {
      const view = engine.getWaveTankView();
      const fills: unknown[] = [];
      const canvas = fakeCanvas(800, 600);
      const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
      const fill = (ctx as unknown as { fill: () => void }).fill.bind(ctx);
      (ctx as unknown as { fill: () => void }).fill = () => {
        fills.push(`${String(ctx.fillStyle)}@${ctx.globalAlpha}`);
        fill();
      };
      const layer = new WaveTankLayer();
      layer.drawStage(ctx, view, view.timeSec, { dpr: 1, showGlow: false, background: "#070b17" });
      return { layer, fills, view };
    };
    // (the pillars' own fills: their steps at 0.25, then at 0.55 + 0.15 × step; the flash: white at its own light, after them)
    const lastPillar = (fills: unknown[]) => Math.max(...WT_PILLARS.map((c, k) => fills.lastIndexOf(`${c}@${0.55 + 0.15 * k}`)));
    run(engine, 14 * 60);
    const before = drawAt();
    expect([before.view.climax, before.layer.pillarFlash]).toEqual([false, 0]);
    expect(lastPillar(before.fills)).toBeGreaterThan(0);
    run(engine, 60 + 2);
    const into = drawAt();
    expect(into.view.climax).toBe(true);
    expect(into.layer.pillarFlash).toBeGreaterThan(0.5 * WT_PILLAR_FLASH);
    expect(into.fills.indexOf(`${WT_LOOK.wallFlash}@${into.layer.pillarFlash}`)).toBeGreaterThan(lastPillar(into.fills));
    run(engine, 60);
    expect(drawAt().layer.pillarFlash).toBeLessThanOrEqual(WT_CHORD_FLASH + 1e-12);
  });

  it("keeps the title full on the double slit and dims it, never out, in the other chapters; the label names the chapter", () => {
    const engine = wtEngine({ ...startLook(), cols: 64 }, 1);
    const view = engine.getWaveTankView();
    expect(view.gaps).toBe(2);
    expect(waveTankTitleAlpha(view)).toBe(1);
    let dimmed = 0;
    let full = 0;
    let last = waveTankTitleAlpha(view);
    for (let k = 0; k < 30 * 60; k++) {
      run(engine, 1);
      const a = waveTankTitleAlpha(view);
      expect(a).toBeGreaterThanOrEqual(WT_TITLE_DIM - 1e-12);
      expect(a).toBeLessThanOrEqual(1);
      // a fade, never a jump: at most the whole step over WT_TITLE_FADE_SEC, eased (× 1.5 at its steepest)
      expect(Math.abs(a - last)).toBeLessThanOrEqual((1.5 * (1 - WT_TITLE_DIM)) / (WT_TITLE_FADE_SEC * 60) + 1e-9);
      last = a;
      const settled = view.timeSec - view.changeSec >= WT_TITLE_FADE_SEC;
      if (settled && view.gaps === 2) expect(a).toBe(1);
      if (settled && view.gaps !== 2) expect(a).toBe(WT_TITLE_DIM);
      if (a === WT_TITLE_DIM) dimmed++;
      if (a === 1) full++;
      // the HUD's frame: the title at that light, the section's label as before
      const count = loopHudCount(engine);
      const frame = loopHudFrame({ title: "the double slit, in water", subtitle: "", counter: "{count, plural, one {{count} gap} other {{count} gaps}}", light: false }, count, "en");
      expect(frame.counter).toBe(view.gaps === 1 ? "1 gap" : `${view.gaps} gaps`);
      expect(frame.titleAlpha ?? 1).toBeCloseTo(a, 12);
      if (a === 1) expect(count).toBe(view.gaps);
    }
    expect(dimmed).toBeGreaterThan(10 * 60);
    expect(full).toBeGreaterThan(10 * 60);
    // the drawn title at its light, the rest of the HUD at full
    const alphas: number[] = [];
    const canvas = fakeCanvas(1080, 1920);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
    const fillText = ctx.fillText.bind(ctx);
    ctx.fillText = (text: string, x: number, y: number) => {
      alphas.push(ctx.globalAlpha);
      fillText(text, x, y);
    };
    drawLoopHud(ctx, 1080, { title: "the double slit, in water", subtitle: "", counter: "7 gaps", light: false, titleAlpha: WT_TITLE_DIM }, loopHudLayout(1080, 1920));
    expect(alphas).toEqual([WT_TITLE_DIM, 1]);
  });

  it("keeps the title full in a run of one section, in a run without a double slit and with point sources", () => {
    for (const patch of [{ gaps: "2" }, { gaps: "1, 1, 7" }, { gaps: "2, 1, 7", source: "points" as const }]) {
      const engine = wtEngine({ ...patch, cols: 64 }, 1);
      for (let k = 0; k < 30; k++) {
        run(engine, 60);
        expect(waveTankTitleAlpha(engine.getWaveTankView())).toBe(1);
        expect(typeof (loopHudCount(engine) ?? 0)).toBe("number");
      }
    }
  });
});

// --- wave-chapters --- (B-g4 review) the title stays full until the double slit has played, and a visitor's own title stays full
describe("the title before the double slit and a visitor's own title (B-g4 review)", () => {
  const spec = { title: "the double slit, in water", subtitle: "", counter: "{count, plural, one {{count} gap} other {{count} gaps}}", light: false };

  it("keeps the link base's title full through its 1-gap opening and its double slit, then dims it in the other chapters", () => {
    const engine = wtEngine({ cols: 64 }, 1); // (the link base: 1, 2, 7)
    const view = engine.getWaveTankView();
    expect(view.schedule.sections.map((s) => s.gaps)).toEqual([1, 2, 7]);
    let seenTwo = false;
    let leftTwo = false;
    let dimmed = 0;
    for (let k = 0; k < 45 * 60; k++) {
      run(engine, 1);
      const a = waveTankTitleAlpha(view);
      if (view.gaps === 2) seenTwo = true;
      if (seenTwo && view.gaps !== 2) leftTwo = true;
      if (!leftTwo) expect(a).toBe(1);
      else if (view.timeSec - view.changeSec >= WT_TITLE_FADE_SEC) expect(a).toBe(view.gaps === 2 ? 1 : WT_TITLE_DIM);
      if (a === WT_TITLE_DIM) dimmed++;
    }
    expect(seenTwo && leftTwo).toBe(true);
    expect(dimmed).toBeGreaterThan(5 * 60);
  });

  it("leaves a visitor's own title full while the mode's own dims", () => {
    const engine = wtEngine({ ...startLook(), cols: 64 }, 1);
    const view = engine.getWaveTankView();
    while (!(waveTankTitleAlpha(view) === WT_TITLE_DIM)) run(engine, 1);
    const count = loopHudCount(engine);
    expect(loopHudFrame(spec, count, "en").titleAlpha).toBe(WT_TITLE_DIM);
    const own = loopHudFrame({ ...spec, title: "my waves", customTitle: true }, count, "en");
    expect(own.titleAlpha).toBeUndefined();
    expect(own.counter).toBe(view.gaps === 1 ? "1 gap" : `${view.gaps} gaps`);
  });
});
