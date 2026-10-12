import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas } from "./fakeCanvas";
import { createEngineForSettings, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import {
  WT_CELL_CEILING,
  WT_SPONGE_MIN,
  WaveField,
  bellGain,
  gapCenters,
  huygensPhasor,
  huygensSources,
  lineSourceGain,
  pingPong,
  spongeCells,
  substepsFor,
  waveGridSize,
  type Phasor,
} from "@/lib/simulation/waveField";
import {
  DEFAULT_WAVE_TANK_FIELDS,
  WT_PRESET_IDS,
  WT_RANGES,
  parseWaveSections,
  resolveWaveTankFields,
  resolveWaveTankSettings,
  sectionAtFrame,
  sectionChangeTimes,
  sectionRootHz,
  waveBellFrequencies,
  waveSchedule,
  waveTankPresetPatch,
  type WaveTankSettings,
} from "@/lib/physics/waveTank";
import { SCAN_FLOOR, scanGain } from "@/lib/audio/loopTones";
import { WAVE_TANK_DATA_KEYS, WaveTankLayer, waveTankExtentPx, waveTankProjection, writeWaveTankDataset } from "@/components/simulator/waveTankRenderer";
import { resetWaveTankPrerollCache } from "@/lib/physics/modes/waveTank";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { LOOP_HUD_MODE_TEXT, loopHudCount } from "@/lib/loop/hud";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- wave-tank --- Wave Tank (lib/simulation/waveField.ts, lib/physics/waveTank.ts, lib/physics/modes/waveTank.ts): the
 * solver's promises – bounded energy without damping, a mirror-symmetric field for a symmetric barrier, the two-gap minima where
 * the far-field formula puts them, sections on their exact frames, bells that rise with the water, a grid that is lowered
 * instead of refused – then the run in the engine (the loop, the seam, the frame rate, no randomness), the sounds through a
 * real ToneGenerator, the settings and the renderer.
 */

vi.setConfig({ testTimeout: 120_000 });

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;

function wtEngine(patch: Partial<WaveTankSettings> = {}, seed = 7, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "waveTank", { ...base, waveTank: patch }, seed);
}

/** The engine settings of a preset. */
function presetSettings(id: (typeof WT_PRESET_IDS)[number]): Partial<WaveTankSettings> {
  const p = waveTankPresetPatch(id);
  return { model: p.wtModel, source: p.wtSource, gaps: p.wtGaps, width: p.wtWidth, widthEnd: p.wtWidthEnd, spacing: p.wtSpacing, wavelengthPct: p.wtWavelength, speed: p.wtSpeed, damping: p.wtDamping, cols: p.wtCols, sectionSec: p.wtSection, wrapSec: p.wtWrap, ridges: p.wtRidges, tilt: p.wtTilt };
}

function run(engine: PhysicsEngine, frames: number, frameMs = STEP): SoundEvent[] {
  const out: SoundEvent[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(frameMs, 0);
    out.push(...engine.consumeSoundEvents());
  }
  return out;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Wave Tank solver (waveField.ts)", () => {
  it("1. keeps the energy bounded over 10,000 steps with γ = 0 (no sponge, no source: a closed box)", () => {
    const field = new WaveField({ cols: 48, wavelength: 0.1, speed: 0.3, damping: 0, sponge: false });
    const { nx, ny } = field.size;
    // a smooth bump at rest in the middle of the box
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const dx = (i - nx / 2) / 5;
        const dy = (j - ny / 2) / 5;
        const v = Math.exp(-(dx * dx + dy * dy));
        field.u[j * nx + i] = v;
        field.prev[j * nx + i] = v;
      }
    }
    field.step();
    const e0 = field.energy();
    let lo = e0;
    let hi = e0;
    for (let n = 0; n < 10_000; n++) {
      field.step();
      if (n % 25 === 0) {
        const e = field.energy();
        lo = Math.min(lo, e);
        hi = Math.max(hi, e);
      }
    }
    expect(e0).toBeGreaterThan(0);
    expect(hi / e0).toBeLessThan(1.25);
    expect(lo / e0).toBeGreaterThan(0.75);
    expect(field.stats().nonFinite).toBe(0);
    // the chosen sub-step keeps the Courant number at 0.5 or under
    expect(Math.sqrt(field.nu2)).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(substepsFor(1 / 60, 1.5, 1 / 1024)).toBe(Math.ceil((1.5 / 60) / (0.5 / 1024)));
  });

  it("2. gives a mirror-symmetric field for a symmetric barrier (to 1e-6)", () => {
    for (const [gaps, width] of [[2, 0.03], [7, 0.02], [1, 0.005]] as const) {
      const field = new WaveField({ cols: 96, wavelength: 0.08, speed: 0.3, damping: 0.02 });
      field.setLineSource(0.05);
      field.setBarrier(0.15, 0.162, gapCenters(gaps, 0.13), width);
      const omega = 2 * Math.PI * (0.3 / 0.08);
      const g = lineSourceGain(1, 0.3, field.size.h);
      for (let n = 0; n < 1500; n++) field.step(g * omega * Math.cos(omega * n * field.dt));
      const { nx, ny } = field.size;
      let worst = 0;
      let peak = 0;
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          worst = Math.max(worst, Math.abs(field.u[j * nx + i] - field.u[j * nx + nx - 1 - i]));
          peak = Math.max(peak, Math.abs(field.u[j * nx + i]));
        }
      }
      expect(peak).toBeGreaterThan(0.1);
      expect(worst).toBeLessThan(1e-6);
    }
  });

  it("3. puts the two-gap far-field minima at sin θ = (m + ½) λ / d, within one cell", () => {
    // a plane wave on two narrow gaps d = 4 λ apart (16 cells a wavelength); the amplitude along a row 12 λ past the barrier,
    // in a tank 32 λ wide so the minima lie far from its absorbing sides
    const lambda = 1 / 32;
    const speed = 0.3;
    const field = new WaveField({ cols: 512, depthRatio: 0.85, wavelength: lambda, speed, damping: 0 });
    const z0 = 0.06;
    const z1 = z0 + 2 * field.size.h;
    const d = 4 * lambda;
    field.setLineSource(0.03);
    field.setBarrier(z0, z1, gapCenters(2, d), 0.5 * lambda);
    const omega = (2 * Math.PI * speed) / lambda;
    const g = lineSourceGain(1, speed, field.size.h);
    const j = Math.round(field.rowAt(z1 + 12 * lambda));
    const L = (j - field.size.sponge + 0.5) * field.size.h - z1;
    const { nx } = field.size;
    const settle = Math.ceil((z1 + 12 * lambda + 0.5) / speed / field.dt);
    const period = Math.ceil((2 * Math.PI) / omega / field.dt);
    const amp = new Float64Array(nx);
    for (let n = 0; n < settle + 2 * period; n++) {
      field.step(g * omega * Math.cos(omega * n * field.dt));
      if (n >= settle) for (let i = 0; i < nx; i++) amp[i] = Math.max(amp[i], Math.abs(field.u[j * nx + i]));
    }
    const centre = Math.max(...amp.slice(Math.round(field.colAt(0)) - 2, Math.round(field.colAt(0)) + 3));
    /** The deepest point of the amplitude within two wavelengths of `x`. */
    const deepest = (x: number) => {
      let best = -1;
      for (let i = 0; i < nx; i++) if (Math.abs(field.xOfCol(i) - x) < 2 * lambda && (best < 0 || amp[i] < amp[best])) best = i;
      return best;
    };
    // order 0 on both sides: within one cell of the far-field direction
    for (const side of [1, -1]) {
      const xPred = side * L * Math.tan(Math.asin((0.5 * lambda) / d));
      const best = deepest(xPred);
      expect(Math.abs(field.xOfCol(best) - xPred)).toBeLessThanOrEqual(field.size.h + 1e-12);
      expect(amp[best]).toBeLessThan(0.2 * centre);
    }
    // order 1: the grid's five-point stencil bends oblique waves a little (its dispersion depends on the direction), so its
    // nodal line sits within a few cells of the far-field direction; the Huygens sum below puts it there exactly
    const x1 = L * Math.tan(Math.asin((1.5 * lambda) / d));
    expect(Math.abs(field.xOfCol(deepest(x1)) - x1)).toBeLessThanOrEqual(3 * field.size.h);
    expect(amp[deepest(x1)]).toBeLessThan(0.4 * centre);
    // the Huygens sum: the minima of orders 0 and 1 within one cell (of the 512-cell row) of sin θ = (m + ½) λ / d, far out
    const sources = huygensSources(gapCenters(2, d), 0.5 * lambda, 0, lambda, 1, false);
    const out: Phasor = { c: 0, s: 0 };
    const R = 60 * lambda;
    const at = (x: number) => Math.hypot(huygensPhasor(x, R, sources, lambda, 0, false, out).c, out.s);
    for (const m of [0, 1]) {
      const xPred = R * Math.tan(Math.asin(((m + 0.5) * lambda) / d));
      let best = xPred;
      for (let x = xPred - 2 * lambda; x <= xPred + 2 * lambda; x += field.size.h / 8) if (at(x) < at(best)) best = x;
      expect(Math.abs(best - xPred)).toBeLessThanOrEqual(field.size.h);
      expect(at(best)).toBeLessThan(0.05 * at(0));
    }
  });

  it("6. lowers a grid past the memory-safety ceiling instead of refusing it", () => {
    const huge = waveGridSize(1e9, 4 / 3, 0.06);
    expect(huge.clamped).toBe(true);
    expect(huge.cells).toBeLessThanOrEqual(WT_CELL_CEILING);
    expect(huge.cols).toBeGreaterThan(1000);
    const small = waveGridSize(64, 4 / 3, 0.06, 5_000);
    expect(small.clamped).toBe(true);
    expect(small.cells).toBeLessThanOrEqual(5_000);
    const field = new WaveField({ cols: 5000, wavelength: 0.06, speed: 0.3, ceiling: 20_000 });
    expect(field.size.cells).toBeLessThanOrEqual(20_000);
    field.step(1);
    expect(field.stats().nonFinite).toBe(0);
    expect(waveGridSize(192).clamped).toBe(false);
    expect([waveGridSize(192).cols, waveGridSize(192).rows]).toEqual([192, 256]);
    expect(spongeCells(4)).toBe(WT_SPONGE_MIN);
    expect(spongeCells(100)).toBe(75);
    // the settings keep the typed value; the engine runs the ceiling
    expect(resolveWaveTankSettings({ cols: 1e9 }).cols).toBe(MEMORY_CEILINGS.wtCols);
    expect(resolveWaveTankFields({ wtCols: 1e9 }).wtCols).toBe(1e9);
  });
});

describe("Wave Tank sections and bells", () => {
  it("parses the gap lists: counts, seconds, the default and the width sweep", () => {
    expect(parseWaveSections("1, 2, 7", 10, 0.6).map((s) => [s.gaps, s.frames])).toEqual([[1, 600], [2, 600], [7, 600]]);
    expect(parseWaveSections("1@11, 2@9; 7@10", 10, 0.6).map((s) => s.frames)).toEqual([660, 540, 600]);
    expect(parseWaveSections("", 10, 0.6).map((s) => s.gaps)).toEqual([1, 2, 7]);
    expect(parseWaveSections("x, 3, -2", 4, 0.6).map((s) => [s.gaps, s.frames])).toEqual([[3, 240]]);
    expect(parseWaveSections("0", 4, 0.6)[0].gaps).toBe(1);
    const widths = parseWaveSections("1, 1, 1", 5, 0.3, 3).map((s) => s.width);
    expect(widths[0]).toBe(0.3);
    expect(widths[1]).toBeCloseTo(1.65, 12);
    expect(widths[2]).toBeCloseTo(3, 12);
    expect(parseWaveSections("1e9", 5, 0.3)[0].gaps).toBe(4096);
  });

  it("4. switches sections on their exact frames (the reference: 6, 15 and 25 s of a 30 s loop), at any frame rate", () => {
    const ref = waveSchedule(parseWaveSections("1@11, 2@9, 7@10", 10, 0.6), 5);
    expect(ref.loopFrames).toBe(1800);
    expect(sectionChangeTimes(ref)).toEqual([6, 15, 25]);
    expect([359, 360, 899, 900, 1499, 1500, 1799, 1800].map((f) => sectionAtFrame(ref, f))).toEqual([0, 1, 1, 2, 2, 0, 0, 0]);
    expect(sectionChangeTimes(waveSchedule(parseWaveSections("1, 2, 7", 10, 0.6), 5))).toEqual([5, 15, 25]);
    for (const model of ["grid", "huygens"] as const) {
      for (const frameMs of [1000 / 30, 1000 / 60, 1000 / 120]) {
        const engine = wtEngine({ ...presetSettings("doubleSlit"), model, cols: 64 });
        run(engine, Math.round((31 * 1000) / frameMs), frameMs);
        expect([model, frameMs, engine.getWaveTankView().changeFrames]).toEqual([model, frameMs, [360, 900, 1500]]);
      }
    }
  });

  it("5. rings a bell louder as the water under it rises (and never past 1)", () => {
    let last = -1;
    for (let a = 0; a <= 2; a += 0.01) {
      const g = bellGain(a, 1);
      expect(g).toBeGreaterThanOrEqual(last);
      expect(g).toBeLessThanOrEqual(1);
      expect(g).toBeCloseTo(scanGain(a, 1), 12);
      last = g;
    }
    expect(bellGain(-0.5, 1)).toBe(bellGain(0.5, 1));
    expect([bellGain(0, 1), bellGain(1, 1), bellGain(NaN, 1), bellGain(1, 0)]).toEqual([0, 1, 0, 0]);
    expect(bellGain(Math.pow(SCAN_FLOOR, 2 / 3) * 0.99, 1)).toBeLessThan(SCAN_FLOOR);
  });

  it("scans the bells back and forth, low to high left to right in A major pentatonic", () => {
    expect(Array.from({ length: 24 }, (_, k) => pingPong(k, 4))).toEqual([0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1]);
    expect(pingPong(5, 1)).toBe(0);
    const hz = waveBellFrequencies(11);
    expect(hz[0]).toBeCloseTo(220, 6);
    expect(hz[10]).toBeCloseTo(880, 6);
    for (let i = 1; i < hz.length; i++) expect(hz[i]).toBeGreaterThan(hz[i - 1]);
    expect([0, 1, 2].map((i) => Math.round(sectionRootHz(i) * 100) / 100)).toEqual([55, 73.42, 82.41]);
  });
});

describe("Wave Tank in the engine", () => {
  it("loops through its sections forever, closing on its first frame (the seam check), with no NaN and no randomness", () => {
    const a = wtEngine({}, 1);
    const b = wtEngine({}, 99);
    expect(a.getCycleSeconds?.() ?? a.getWaveTankView().loopSec).toBe(30);
    expect(a.getLoopSeams()).toMatchObject({ count: 0, lastMs: -1, nextMs: 30000 });
    run(a, 1801);
    run(b, 1801);
    const va = a.getWaveTankView();
    const vb = b.getWaveTankView();
    expect(va.seams).toBe(1);
    expect(va.seamError).toBeGreaterThanOrEqual(0);
    expect(va.seamError).toBeLessThan(0.03);
    expect(va.nonFinite).toBe(0);
    expect(va.maxAbs).toBeGreaterThan(0.5);
    expect(Array.from(vb.heights)).toEqual(Array.from(va.heights));
    expect(runNeverFinishes("waveTank", { drop: {}, box: {}, pendulum: {}, polyrhythm: {}, doublePendulum: {}, illusion: {}, runner: {}, paddle: {}, vortex: {}, paintPicture: false, orbGrid: {} } as never)).toBe(true);
    // the source's frequency is snapped to whole cycles a loop
    expect(va.cycles).toBe(150);
    expect(va.frequency * va.loopSec).toBeCloseTo(va.cycles, 9);
  });

  it("starts a restart of the same run from the kept pre-rolled water, bit for bit what a fresh pre-roll gives", () => {
    const state = (engine: PhysicsEngine) => {
      const v = engine.getWaveTankView();
      return { reused: v.prerollReused, preroll: v.prerollSec, h: Array.from(v.heights), amp: Array.from(v.bellAmp), level: Array.from(v.bellLevel), reference: v.reference };
    };
    resetWaveTankPrerollCache();
    const fresh = wtEngine({ cols: 64, gaps: "1@2, 2@2" }, 1);
    const first = state(fresh);
    const again = wtEngine({ cols: 64, gaps: "1@2, 2@2" }, 5);
    const second = state(again);
    expect([first.reused, second.reused]).toEqual([false, true]);
    expect({ ...second, reused: false }).toEqual(first);
    run(fresh, 300);
    run(again, 300);
    expect(state(again).h).toEqual(state(fresh).h);
    // another run (more bells) pre-rolls again
    expect(wtEngine({ cols: 64, gaps: "1@2, 2@2", bells: 12 }, 1).getWaveTankView().prerollReused).toBe(false);
    resetWaveTankPrerollCache();
  });

  it("replays the same water at 30, 60 and 120 fps", () => {
    const at = (frameMs: number) => {
      const engine = wtEngine({ cols: 64 }, 3);
      run(engine, Math.round(4000 / frameMs), frameMs);
      const v = engine.getWaveTankView();
      return { t: v.timeSec, h: Array.from(v.heights.slice(0, 200)), bells: Array.from(v.bellAmp) };
    };
    const ref = at(1000 / 60);
    expect(at(1000 / 30)).toEqual(ref);
    expect(at(1000 / 120)).toEqual(ref);
  });

  it("is periodic by construction with the Huygens model (the seam is exact) and lights the centre bells of the grating", () => {
    const engine = wtEngine({ model: "huygens" }, 1);
    run(engine, 1801);
    const v = engine.getWaveTankView();
    expect(v.seamError).toBe(0);
    expect(v.nonFinite).toBe(0);
    const grating = wtEngine({ ...presetSettings("doubleSlit"), model: "huygens" }, 1);
    run(grating, 20 * 60);
    const g = grating.getWaveTankView();
    expect(g.gaps).toBe(7);
    // the zeroth-order beam lands on the middle bells
    expect(g.bellLevel[5]).toBeGreaterThan(0.6);
  });

  it("strikes the bells at the scan rate as loud as the water, skips quiet ones, crossfades the root at each section", () => {
    const engine = wtEngine({}, 1);
    const events = run(engine, 30 * 60 - 1);
    const v = engine.getWaveTankView();
    const scans = events.filter((e) => e.loop === "scan");
    const roots = events.filter((e) => e.loop === "root");
    expect(scans.length + v.skipped).toBe(240);
    expect(scans.length).toBe(v.strikes);
    for (const e of scans) {
      expect(e.level).toBeGreaterThan(0);
      expect(e.level).toBeLessThanOrEqual(1);
      expect(scanGain(e.level ?? 0, 1)).toBeGreaterThanOrEqual(SCAN_FLOOR);
      expect(v.bellHz).toContain(e.frequency);
    }
    expect(roots.map((e) => Math.round(e.frequency! * 100) / 100)).toEqual([55, 73.42, 82.41, 55]);
    expect(engine.getWaveTankView().roots).toBe(4);
    // the bass off: a stop, then no roots
    engine.setWaveTankSettings({ bass: false });
    const later = run(engine, 120);
    expect(later.filter((e) => e.loop === "rootStop").length).toBe(1);
    expect(later.filter((e) => e.loop === "root").length).toBe(0);
  });

  it("schedules its sounds on a ToneGenerator at the context's time (fakeAudio): the bells' pitches and the section root", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    const playLoop = vi.spyOn(tone, "playLoop");
    const engine = wtEngine({ model: "huygens" }, 3);
    let sent = 0;
    for (let k = 0; k < 600; k++) {
      engine.update(STEP, 0);
      graph.ctx.currentTime = engine.getElapsedMs() / 1000;
      for (const ev of engine.consumeSoundEvents()) {
        playSoundEvent(tone, ev, () => undefined);
        sent++;
      }
    }
    expect(playLoop).toHaveBeenCalledTimes(sent);
    expect(playLoop.mock.calls.some((c) => c[0] === "root")).toBe(true);
    const bells = engine.getWaveTankView().bellHz;
    expect(graph.oscillators.some((o) => bells.some((f) => Math.abs(o.frequency - f) < 1e-6))).toBe(true);
    // the root: a sine at 55 Hz and its octave
    expect(graph.oscillators.some((o) => o.type === "sine" && Math.abs(o.frequency - 55) < 1e-9)).toBe(true);
    expect(graph.oscillators.some((o) => o.type === "sine" && Math.abs(o.frequency - 110) < 1e-9)).toBe(true);
    tone.resetLoop();
  });

  it("plays the owner's clips in place of the synthesis: the bar-strike clip for a scanned bell, the drone clip for the root", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    const buffer = graph.ctx.createBuffer(1, 48000, 48000) as unknown as AudioBuffer;
    tone.getLoopClips().set("barStrike", buffer, "bell.wav");
    tone.getLoopClips().set("drone", buffer, "drone.wav");
    graph.ctx.currentTime = 1;
    const sources = graph.sources.length;
    const oscillators = graph.oscillators.length;
    tone.playLoop("scan", 440, 0.5);
    tone.playLoop("root", 55, 1);
    graph.ctx.currentTime = 2;
    tone.playLoop("root", 73.42, 1); // a section change: the drone clip keeps looping, no second copy
    expect(graph.sources.length - sources).toBe(2);
    expect(graph.oscillators.length).toBe(oscillators);
    tone.playLoop("rootStop");
    tone.resetLoop();
  });

  it("reports the HUD's section label and follows the bells, the scan and the ridges live", () => {
    const engine = wtEngine(presetSettings("doubleSlit"), 1);
    run(engine, 7 * 60);
    expect(loopHudCount(engine)).toBe(2);
    engine.setWaveTankSettings({ label: false });
    expect(loopHudCount(engine)).toBeNull();
    engine.setWaveTankSettings({ label: true, bells: 15, ridges: 60 });
    run(engine, 2);
    const v = engine.getWaveTankView();
    expect([v.bells, v.bellHz.length, v.ridges, v.heights.length]).toEqual([15, 15, 60, 60 * v.samples]);
    expect(engine.getWaveTankView().changeFrames).toEqual([360]);
  });

  it("runs the two-source look and the presets without a NaN", () => {
    for (const id of WT_PRESET_IDS) {
      const engine = wtEngine({ ...presetSettings(id), cols: Math.min(96, presetSettings(id).cols ?? 96) }, 1);
      run(engine, 180);
      const v = engine.getWaveTankView();
      expect([id, v.nonFinite]).toEqual([id, 0]);
      expect(v.maxAbs).toBeGreaterThan(0);
    }
    const points = wtEngine({ source: "points", gaps: "2" }, 1);
    run(points, 60);
    expect(points.getWaveTankView().source).toBe("points");
  });
});

describe("Wave Tank settings, links, words and picture", () => {
  it("round-trips its fields through links and presets, uncapped from the slider's minimum", () => {
    const s = { ...defaultSettings("waveTank"), wtModel: "huygens" as const, wtSource: "points" as const, wtGaps: "3@4, 5", wtWidth: 7.5, wtWidthEnd: 2, wtSpacing: 33, wtWavelength: 2.5, wtSpeed: 9, wtDamping: 0.5, wtCols: 2048, wtSection: 300, wtWrap: 1.5, wtBells: 99, wtScanRate: 40, wtRidges: 999, wtTilt: 85, wtBass: false, wtLabel: false };
    const back = settingsFromSearchParams(settingsToSearchParams(s));
    for (const key of Object.keys(DEFAULT_WAVE_TANK_FIELDS) as (keyof typeof DEFAULT_WAVE_TANK_FIELDS)[]) expect([key, back[key]]).toEqual([key, s[key]]);
    expect(presetToSettings(JSON.parse(JSON.stringify(s))).wtRidges).toBe(999);
    // the defaults write nothing; a value under the minimum is lifted onto it
    expect([...settingsToSearchParams(defaultSettings("waveTank")).keys()].filter((k) => k.startsWith("wt"))).toEqual([]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=waveTank&wtW=-3&wtN=2")).wtWidth).toBe(WT_RANGES.wtWidth.min);
    expect(settingsFromSearchParams(new URLSearchParams("mode=waveTank&wtN=2")).wtCols).toBe(WT_RANGES.wtCols.min);
    expect(settingsFromSearchParams(new URLSearchParams("mode=waveTank&wtM=nope&wtSrc=points")).wtModel).toBe("grid");
    // the mode's look: the navy page and the loop HUD
    expect(defaultSettings("waveTank")).toMatchObject({ backgroundType: "solid", backgroundColors: ["#070b17", "#070b17"], loopHud: true });
    expect(defaultSettings("classic").backgroundColors).not.toEqual(["#070b17", "#070b17"]);
    for (const id of WT_PRESET_IDS) expect(waveTankPresetPatch(id).loopHud).toBe(true);
    expect(waveTankPresetPatch("doubleSlit").wtGaps).toBe("1@11, 2@9, 7@10");
  });

  it("joins the rhythm family after Beat Machines, with its HUD words, its caption and every message in en / pl / es", () => {
    expect(MODE_CATEGORIES.waveTank).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("waveTank")).toBe(MODE_CARD_ORDER.indexOf("beatMachine") + 1);
    expect(LOOP_HUD_MODE_TEXT.waveTank?.title).toBe("WaveTank.canvasTitle");
    expect(loopCaptionContext({ mode: "waveTank", recordingDuration: 30 } as never)).toMatchObject({ hookKey: "waveTank", factKey: "waveTankFact", count: null });
    const keys = (o: unknown): string[] => (o && typeof o === "object" ? Object.entries(o).flatMap(([k, v]) => (typeof v === "object" ? keys(v).map((x) => `${k}.${x}`) : [k])) : []);
    const ns = (m: Record<string, unknown>) => keys(m.WaveTank).sort();
    expect(ns(pl as Record<string, unknown>)).toEqual(ns(en as Record<string, unknown>));
    expect(ns(es as Record<string, unknown>)).toEqual(ns(en as Record<string, unknown>));
    const wt = (en as unknown as Record<string, Record<string, string>>).WaveTank;
    expect(wt.canvasTitle).toBe("the double slit, in water");
    expect(wt.sectionOne).toBe("{count} gap");
    for (const [locale, m] of Object.entries({ en, pl, es }) as unknown as [string, Record<string, Record<string, unknown>>][]) {
      expect(typeof m.Controls.modeWaveTank).toBe("string");
      expect(typeof (m.Modes.waveTank as Record<string, string>).name).toBe("string");
      // the mode card's one-liner within the copy pass's budget (60–110 characters in English, 40–140 in Polish and Spanish)
      const line = [...(m.Modes.waveTank as Record<string, string>).description].length;
      expect([locale, line >= (locale === "en" ? 60 : 40) && line <= (locale === "en" ? 110 : 140)]).toEqual([locale, true]);
      // the panel's intro and tips keep the house style (docs/COPY-STYLE.md): no sentence dashes, no semicolons
      for (const text of Object.values(m.WaveTank as Record<string, string>)) expect([text, / – |—|;/.test(text)]).toEqual([text, false]);
      for (const key of ["waveTank", "waveTankFact", "waveTankPoints", "waveTankPointsFact"]) expect(typeof m.LoopCaption[key]).toBe("string");
    }
  });

  it("draws the tank without throwing, keeps hidden lines hidden, and mirrors the run on the canvas (data-wt-*)", () => {
    const engine = wtEngine(presetSettings("doubleSlit"), 3);
    run(engine, 20 * 60);
    const view = engine.getWaveTankView();
    const canvas = fakeCanvas(800, 600);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string }[] };
    const layer = new WaveTankLayer();
    layer.drawStage(ctx, view, view.timeSec, { dpr: 1, showGlow: true, background: "#070b17" });
    // every ridge but those inside the wall, each filled (the hidden lines) before its strokes
    const inWall = Array.from(view.ridgeZ).filter((z) => z >= view.barrierZ0 && z <= view.barrierZ1).length;
    expect(layer.ridgesDrawn).toBe(view.ridges - inWall);
    expect(ctx.calls.filter((c) => c.name === "fill").length).toBeGreaterThan(layer.ridgesDrawn);
    expect(layer.strokes).toBeGreaterThanOrEqual(layer.ridgesDrawn);
    const p = waveTankProjection(view);
    expect(p.frontY).toBeGreaterThan(p.top);
    expect(p.bellY).toBeGreaterThan(p.frontY);
    expect(waveTankExtentPx(view)).toBeGreaterThan(0);
    expect(waveTankExtentPx(view)).toBeLessThanOrEqual(view.frame.side / 2);
    const data: Record<string, string> = {};
    writeWaveTankDataset(view, layer, (k, v) => (data[k] = v));
    expect(Object.keys(data).sort()).toEqual([...WAVE_TANK_DATA_KEYS].sort());
    expect([data.wtGaps, data.wtChanges, data.wtNan, data.wtGrid]).toEqual(["7", "360,900", "0", "192x256"]);
    expect(data.wtLevels.split(",")).toHaveLength(11);
    // a steeper tilt draws the same tank within the same square
    engine.setWaveTankSettings({ tilt: 75 });
    expect(waveTankExtentPx(engine.getWaveTankView())).toBeLessThanOrEqual(view.frame.side / 2);
  });
});
