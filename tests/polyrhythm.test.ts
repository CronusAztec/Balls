import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_POLYRHYTHM_SETTINGS,
  DEFAULT_POLY_CUSTOM,
  MAX_ALIGN_PITCHES,
  MAX_CUSTOM_RATIOS,
  MAX_STEP_PITCHES,
  POLYRHYTHM_RANGES,
  POLY_LAYOUTS,
  alignmentsInStep,
  buildPolyGeometry,
  buildTempoSeries,
  ceilDiv,
  customRatiosOf,
  cycleFraction,
  finalStep,
  floorDiv,
  gcd,
  parseCustomRatios,
  placeVoice,
  polygonSides,
  polyrhythmAlignSeconds,
  polyrhythmCycleSeconds,
  polyrhythmPitch,
  polyrhythmSettingFields,
  polyrhythmSettingsOf,
  resolvePolyrhythmSettings,
  sanitizeCustomRatios,
  spreadPitches,
  tickPhaseMod2,
  tickTriangle,
  ticksInStep,
  type PolyrhythmSettings,
  type VoicePlacement,
} from "@/lib/physics/modes/polyrhythm";
import { pendulumPitch } from "@/lib/physics/modes/pendulum";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { midiToFrequency } from "@/lib/audio/scales";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

/**
 * Metronomes & Polyrhythms (lib/physics/modes/polyrhythm.ts): the exact tempo series (harmonic, arithmetic, custom),
 * the integer tick / alignment detection inside 60 Hz steps, the pitch mapping, the four layouts staying inside the
 * field, the mode in the engine (analytic positions, notes and chords, alignments, accents, the finish, live
 * changes, determinism, 400 voices), the finder (fixed length, endless) and the settings (URL, presets, ranges).
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;
const SPS = 60;

function polyEngine(polyrhythm: Partial<PolyrhythmSettings>, seed = 7, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "polyrhythm", { ...modeSettings, polyrhythm }, seed);
}

/** Runs `frames` 60 Hz steps and collects every sound event. */
function run(engine: PhysicsEngine, frames: number): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

const settingsOf = (patch: Partial<PolyrhythmSettings>) => resolvePolyrhythmSettings({ ...DEFAULT_POLYRHYTHM_SETTINGS, ...patch });

describe("exact arithmetic", () => {
  it("divides whole numbers exactly, far beyond the size where p / q rounds", () => {
    expect(floorDiv(7, 2)).toBe(3);
    expect(ceilDiv(7, 2)).toBe(4);
    expect(ceilDiv(8, 2)).toBe(4);
    expect(ceilDiv(0, 5)).toBe(0);
    // 2^52 − 1 over a divisor just above a million: the float quotient rounds up to the next whole number, floorDiv does not.
    const p = 2 ** 52 - 1;
    const q = 1048577;
    expect(floorDiv(p, q) * q + (p % q)).toBe(p);
    expect(ceilDiv(p, q)).toBe(floorDiv(p, q) + 1);
    expect(gcd(12, 18)).toBe(6);
    expect(gcd(0, 7)).toBe(7);
    expect(gcd(600, 610)).toBe(10);
  });
});

describe("tempo series", () => {
  it("harmonic: voice i ticks i + 1 times per cycle and every voice is back in phase after one cycle", () => {
    const series = buildTempoSeries(settingsOf({ tempos: "harmonic", count: 5, cycleSeconds: 30 }));
    expect(series.count).toBe(5);
    expect(series.perCycle).toEqual([1, 2, 3, 4, 5]);
    expect(series.cycleSec).toBe(30);
    expect(series.alignSec).toBe(30);
    expect(series.bpm).toEqual([2, 4, 6, 8, 10]);
    // Half-second cycles stay exact.
    const half = buildTempoSeries(settingsOf({ tempos: "harmonic", count: 3, cycleSeconds: 2.5 }));
    expect(half.cycleSec).toBe(2.5);
    expect(half.alignSec).toBe(2.5);
  });

  it("arithmetic: base BPM + i × step, a cycle is the alignment period D / gcd", () => {
    const one = buildTempoSeries(settingsOf({ tempos: "arithmetic", count: 10, baseBpm: 60, bpmStep: 1 }));
    expect(one.bpm).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69]);
    expect(one.alignSec).toBe(60);
    expect(one.cycleSec).toBe(60);
    expect(one.perCycle).toEqual([60, 61, 62, 63, 64, 65, 66, 67, 68, 69]);
    const half = buildTempoSeries(settingsOf({ tempos: "arithmetic", count: 4, baseBpm: 60, bpmStep: 0.5 }));
    expect(half.bpm).toEqual([60, 60.5, 61, 61.5]);
    expect(half.alignSec).toBe(120);
    const tenth = buildTempoSeries(settingsOf({ tempos: "arithmetic", count: 3, baseBpm: 60, bpmStep: 0.1 }));
    expect(tenth.alignSec).toBe(600);
    const even = buildTempoSeries(settingsOf({ tempos: "arithmetic", count: 3, baseBpm: 120, bpmStep: 10 }));
    expect(even.alignSec).toBe(6); // 120, 130, 140 BPM: gcd 10 BPM → together every 6 s
    // Every voice ticks a whole number of times per cycle.
    for (const s of [one, half, tenth, even]) {
      for (let i = 0; i < s.count; i++) {
        expect(Number.isInteger(s.perCycle[i])).toBe(true);
        expect((s.bpm[i] / 60) * s.cycleSec).toBeCloseTo(s.perCycle[i], 9);
      }
    }
  });

  it("custom: one voice per whole-number ratio, aligned every cycle / gcd", () => {
    const s = buildTempoSeries(settingsOf({ tempos: "custom", custom: "3,4,5,7", cycleSeconds: 4 }));
    expect(s.perCycle).toEqual([3, 4, 5, 7]);
    expect(s.cycleSec).toBe(4);
    expect(s.alignSec).toBe(4);
    const shared = buildTempoSeries(settingsOf({ tempos: "custom", custom: "2 4 6", cycleSeconds: 30 }));
    expect(shared.alignSec).toBe(15);
    expect(shared.cycleSec).toBe(30);
    // The count setting does not apply to a custom list.
    expect(buildTempoSeries(settingsOf({ tempos: "custom", custom: "3:4", count: 100 })).count).toBe(2);
    expect(polyrhythmCycleSeconds({ tempos: "custom", custom: "2,4,6", cycleSeconds: 30 })).toBe(30);
    expect(polyrhythmAlignSeconds({ tempos: "custom", custom: "2,4,6", cycleSeconds: 30 })).toBe(15);
  });

  it("parses and sanitises custom ratio lists", () => {
    expect(parseCustomRatios("3,4,5,7")).toEqual([3, 4, 5, 7]);
    expect(parseCustomRatios(" 3 : 4 ; 5/7 ,, ")).toEqual([3, 4, 5, 7]);
    expect(parseCustomRatios("0, 1.5, 1000, 2, abc")).toEqual([2]);
    expect(parseCustomRatios("")).toEqual([]);
    expect(customRatiosOf("nothing")).toEqual([3, 4, 5, 7]);
    expect(parseCustomRatios(Array.from({ length: 500 }, (_, i) => (i % 9) + 1).join(","))).toHaveLength(MAX_CUSTOM_RATIOS);
    expect(sanitizeCustomRatios("3,4<script>,5")).toBe("3,4,5");
    expect(sanitizeCustomRatios("3,4,")).toBe("3,4,"); // typing is never disturbed
    expect(sanitizeCustomRatios(42)).toBe(DEFAULT_POLY_CUSTOM);
  });
});

describe("tick and alignment detection", () => {
  it("finds every tick exactly once in consecutive 60 Hz steps, at k · D / a", () => {
    for (const patch of [
      { tempos: "harmonic", count: 7, cycleSeconds: 3 },
      { tempos: "arithmetic", count: 5, baseBpm: 97, bpmStep: 3.7 },
      { tempos: "custom", custom: "3,4,5,7,11", cycleSeconds: 2.5 },
    ] as Partial<PolyrhythmSettings>[]) {
      const series = buildTempoSeries(settingsOf(patch));
      const out = { first: 0, end: 0 };
      for (let i = 0; i < series.count; i++) {
        const seen: number[] = [];
        for (let step = 0; step < 900; step++) {
          ticksInStep(series.a[i], series.D, step, SPS, out);
          for (let k = out.first; k < out.end; k++) {
            seen.push(k);
            const t = (k * series.D) / series.a[i];
            expect(t).toBeGreaterThanOrEqual(step / SPS - 1e-12);
            expect(t).toBeLessThan((step + 1) / SPS + 1e-12);
          }
        }
        // 0, 1, 2 … without gaps or repeats, up to the last tick before 15 s.
        expect(seen).toEqual(Array.from({ length: seen.length }, (_, k) => k));
        expect(seen.length).toBe(Math.ceil((15 * series.a[i]) / series.D));
      }
    }
  });

  it("detects an alignment exactly in the steps where every voice ticks at the same instant", () => {
    const series = buildTempoSeries(settingsOf({ tempos: "custom", custom: "3,4,5", cycleSeconds: 2 }));
    const aligned: number[] = [];
    for (let step = 0; step < 600; step++) if (alignmentsInStep(series.g, series.D, step, SPS) > 0) aligned.push(step);
    // Every 2 s, i.e. every 120 steps, starting at the downbeat.
    expect(aligned).toEqual([0, 120, 240, 360, 480]);
    // Brute force: the tick times of all three voices coincide exactly at those instants and nowhere else.
    const ticks = series.a.map((a) => new Set(Array.from({ length: 40 }, (_, k) => Math.round(((k * series.D) / a) * 1e6))));
    const common = [...ticks[0]].filter((t) => ticks[1].has(t) && ticks[2].has(t)).sort((x, y) => x - y);
    expect(common.slice(0, 4)).toEqual([0, 2e6, 4e6, 6e6]);
    // Arithmetic: 60 and 61 BPM (and 62) all tick together every 60 s.
    const bpm = buildTempoSeries(settingsOf({ tempos: "arithmetic", count: 3, baseBpm: 60, bpmStep: 1 }));
    expect(alignmentsInStep(bpm.g, bpm.D, 3600, SPS)).toBe(1);
    expect(alignmentsInStep(bpm.g, bpm.D, 1800, SPS)).toBe(0);
    expect(alignmentsInStep(bpm.g, bpm.D, 3599, SPS)).toBe(0);
  });

  it("knows the phase of every voice and of the cycle exactly, however long the run", () => {
    const series = buildTempoSeries(settingsOf({ tempos: "harmonic", count: 4, cycleSeconds: 30 }));
    // After 10 000 cycles (3 000 000 steps) voice 3 has done exactly 40 000 ticks: phase 0, cycle fraction 0.
    expect(tickPhaseMod2(series.a[3], series.D, 30 * 60 * 10000, SPS)).toBe(0);
    expect(cycleFraction(series, 30 * 60 * 10000, SPS)).toBe(0);
    expect(tickPhaseMod2(series.a[0], series.D, 15 * 60, SPS)).toBe(0.5);
    expect(tickPhaseMod2(series.a[1], series.D, 15 * 60, SPS)).toBe(1);
    expect(cycleFraction(series, 7.5 * 60, SPS)).toBe(0.25);
    expect(finalStep(series, 1, SPS)).toBe(1800);
    expect(finalStep(series, 3, SPS)).toBe(5400);
  });
});

describe("pitch", () => {
  it("maps a voice to a scale degree by index, or its tempo ratio to a harmonic of C3 folded into four octaves", () => {
    for (let i = 0; i < 20; i++) expect(polyrhythmPitch(i, 20, i + 1, "index")).toBe(pendulumPitch(i, 20, "up"));
    const c3 = midiToFrequency(48);
    expect(polyrhythmPitch(0, 3, 1, "ratio")).toBeCloseTo(c3, 9);
    expect(polyrhythmPitch(0, 3, 3, "ratio")).toBeCloseTo(3 * c3, 9); // G4
    expect(polyrhythmPitch(0, 3, 4, "ratio")).toBeCloseTo(4 * c3, 9); // C5
    expect(polyrhythmPitch(0, 3, 5, "ratio")).toBeCloseTo(5 * c3, 9); // E5
    // Harmonic 16 folds down an octave; nothing leaves the four-octave window.
    expect(polyrhythmPitch(0, 3, 16, "ratio")).toBeCloseTo(8 * c3, 9);
    for (let r = 1; r < 400; r += 7) {
      const f = polyrhythmPitch(0, 1, r, "ratio");
      expect(f).toBeGreaterThanOrEqual(c3 - 1e-9);
      expect(f).toBeLessThan(16 * c3);
    }
  });

  it("spreads a chord's pitches evenly when there are too many, keeping the lowest and the highest", () => {
    const pitches = Array.from({ length: 30 }, (_, i) => 100 + i);
    const chosen = spreadPitches(pitches, 8);
    expect(chosen).toHaveLength(8);
    expect(chosen[0]).toBe(100);
    expect(chosen[7]).toBe(129);
    expect([...chosen].sort((a, b) => a - b)).toEqual(chosen);
    expect(spreadPitches([1, 2, 3], 8)).toEqual([1, 2, 3]);
  });
});

describe("layouts", () => {
  it("keeps every dot inside the field at every phase, for every layout, voice count and ball size", () => {
    const out: VoicePlacement = { x: 0, y: 0, param: 0 };
    for (const [w, h] of [
      [800, 600],
      [1080, 1920],
    ]) {
      for (const layout of POLY_LAYOUTS) {
        for (const arcStyle of layout === "arcs" ? (["chords", "semicircles"] as const) : (["chords"] as const)) {
          for (const count of [1, 2, 16, 400]) {
            for (const ballRadius of [4, 8, 30]) {
              for (const dir of [-1, 1]) {
                const g = buildPolyGeometry(w, h, layout, arcStyle, count, ballRadius, dir);
                const f = g.field;
                expect(g.dotRadius).toBeGreaterThan(0);
                let worst = Infinity; // smallest clearance between a dot's edge and the field's edge
                for (let i = 0; i < count; i += Math.max(1, Math.floor(count / 20))) {
                  for (let u = 0; u < 2; u += 0.125) {
                    placeVoice(g, i, u, dir, -Math.PI / 2 + u, layout === "rings" ? 5 : 0, out);
                    worst = Math.min(worst, out.x - g.dotRadius - f.left, f.right - out.x - g.dotRadius, out.y - g.dotRadius - f.top, f.bottom - out.y - g.dotRadius);
                  }
                }
                expect(worst, `${layout} ${arcStyle} n=${count} r=${ballRadius} dir=${dir}`).toBeGreaterThanOrEqual(-1e-6);
              }
            }
          }
        }
      }
    }
  });

  it("puts a tick exactly where the layout ticks: 12 o'clock, the tick point on the spiral, an end of the path, an extreme of the swing", () => {
    const out: VoicePlacement = { x: 0, y: 0, param: 0 };
    const rings = buildPolyGeometry(800, 600, "rings", "chords", 8, 8, 1);
    for (const u of [0, 1]) {
      placeVoice(rings, 5, u, 1, 0, 0, out);
      expect(out.x).toBeCloseTo(rings.cx, 9);
      expect(out.y).toBeCloseTo(rings.cy - rings.radius[5], 9);
    }
    placeVoice(rings, 5, 0.25, 1, 0, 0, out); // a quarter turn clockwise: 3 o'clock
    expect(out.x).toBeCloseTo(rings.cx + rings.radius[5], 9);
    placeVoice(rings, 5, 0.25, -1, 0, 0, out); // … or 9 o'clock the other way round
    expect(out.x).toBeCloseTo(rings.cx - rings.radius[5], 9);
    const spiral = buildPolyGeometry(800, 600, "spiral", "chords", 5, 8, 1);
    expect(spiral.tickAngle[0]).toBeCloseTo(-Math.PI / 2, 12);
    expect(spiral.tickAngle[2]).toBeCloseTo(Math.PI / 2, 12); // half way along a one-turn spiral
    placeVoice(spiral, 2, 0, 1, 0, 0, out);
    expect(out.y).toBeCloseTo(spiral.cy + spiral.radius[2], 9);
    const chords = buildPolyGeometry(800, 600, "arcs", "chords", 5, 8, 1);
    expect(tickTriangle(0)).toBe(1);
    expect(tickTriangle(1)).toBe(-1);
    expect(tickTriangle(0.5)).toBe(0);
    expect(tickTriangle(1.5)).toBe(0);
    placeVoice(chords, 2, 0, 1, 0, 0, out);
    expect(out.x).toBeCloseTo(chords.cx + chords.radius[2], 9);
    placeVoice(chords, 2, 1, 1, 0, 0, out);
    expect(out.x).toBeCloseTo(chords.cx - chords.radius[2], 9);
    const semi = buildPolyGeometry(800, 600, "arcs", "semicircles", 5, 8, 1);
    placeVoice(semi, 3, 1, 1, 0, 0, out);
    expect(out.y).toBeCloseTo(semi.baselineY, 9);
    expect(out.x).toBeCloseTo(semi.cx - semi.radius[3], 9);
    placeVoice(semi, 3, 0.5, 1, 0, 0, out);
    expect(out.y).toBeCloseTo(semi.baselineY - semi.radius[3], 9); // the top of the arc half way
    const metro = buildPolyGeometry(800, 600, "metronomes", "chords", 9, 8, 1);
    expect(metro.cols).toBe(3);
    placeVoice(metro, 4, 0, 1, 0, 0, out);
    expect(out.param).toBeCloseTo(metro.amplitude, 12);
    placeVoice(metro, 4, 1, 1, 0, 0, out);
    expect(out.param).toBeCloseTo(-metro.amplitude, 12);
    placeVoice(metro, 4, 0.5, 1, 0, 0, out);
    expect(out.param).toBeCloseTo(0, 12);
  });

  it("draws a ring as a polygon only for ratios 3–48", () => {
    expect(polygonSides(1)).toBe(0);
    expect(polygonSides(2)).toBe(0);
    expect(polygonSides(3)).toBe(3);
    expect(polygonSides(48)).toBe(48);
    expect(polygonSides(60)).toBe(0);
    expect(polygonSides(2.5)).toBe(0);
  });
});

describe("the mode in the engine", () => {
  it("is a ring-less rhythm-family mode registered everywhere", () => {
    expect(MODE_IDS).toContain("polyrhythm");
    expect(MODE_CARD_ORDER).toContain("polyrhythm");
    expect(MODE_CATEGORIES.polyrhythm).toBe("rhythm");
    expect(modesInCategory("rhythm")).toContain("polyrhythm");
    expect(modesInCategory("escape")).not.toContain("polyrhythm");
    const engine = polyEngine({});
    expect(engine.getCurrentModeName()).toBe("polyrhythm");
    expect(engine.isPolyrhythmMode()).toBe(true);
    expect(engine.getCircularWalls()).toEqual([]);
    expect(engine.getBalls()).toHaveLength(16);
  });

  it("places every dot analytically from the clock: the default rings tick at 12 o'clock after whole revolutions", () => {
    const engine = polyEngine({ count: 6, cycleSeconds: 6, cycles: 0 }, 3);
    const view = engine.getPolyrhythmView();
    const g = view.geometry!;
    run(engine, 6 * 60); // one cycle: voice i did i + 1 revolutions
    for (let i = 0; i < 6; i++) {
      expect(view.x[i]).toBeCloseTo(g.cx, 6);
      expect(view.y[i]).toBeCloseTo(g.cy - g.radius[i], 6);
      const ball = engine.getBalls()[i];
      expect(ball.x).toBe(view.x[i]);
      expect(ball.y).toBe(view.y[i]);
    }
    run(engine, 90); // 1.5 s more: voice 1 (2 per 6 s) is half a turn round
    expect(view.x[1]).toBeCloseTo(g.cx, 6);
    expect(view.y[1]).toBeCloseTo(g.cy + g.radius[1], 6);
  });

  it("plays one note or chord per step, a downbeat and a final alignment chord, and counts every tick", () => {
    const engine = polyEngine({ tempos: "custom", custom: "3,4,5", cycleSeconds: 2, cycles: 2 });
    const events = run(engine, 400);
    const view = engine.getPolyrhythmView();
    expect(engine.isSimulationFinished()).toBe(true);
    // Two cycles of 3 + 4 + 5 ticks, plus the final alignment.
    expect(view.tickCount).toBe(2 * 12 + 3);
    expect(view.alignCount).toBe(3); // 0 s, 2 s, 4 s
    expect(view.cyclesDone).toBe(2);
    expect(view.step).toBe(241);
    // The downbeat is a full, accented chord of the three voices' pitches.
    const first = events[0];
    expect(first.type).toBe("hit");
    expect(first.accent).toBe(true);
    expect(first.chord).toEqual([...view.pitch].sort((a, b) => a - b));
    const last = events[events.length - 1];
    expect(last.accent).toBe(true);
    expect(last.chord).toHaveLength(3);
    // Every event is a "hit" carrying a pitch of one of the voices; single ticks are single notes.
    for (const e of events) {
      expect(e.type).toBe("hit");
      expect(view.pitch).toContain(e.frequency);
      if (e.chord) for (const f of e.chord) expect(view.pitch).toContain(f);
    }
    expect(events.filter((e) => !e.chord).length).toBeGreaterThan(10);
    // Nothing after the finish.
    expect(run(engine, 60)).toEqual([]);
  });

  it("accents every k-th tick of a voice", () => {
    const engine = polyEngine({ tempos: "custom", custom: "4", cycleSeconds: 4, accentEvery: 4, cycles: 0 });
    const events = run(engine, 8 * 60);
    // One voice at one tick per second: ticks 0, 4, 8 are accented, the others not.
    expect(events).toHaveLength(8);
    expect(events.map((e) => !!e.accent)).toEqual([true, false, false, false, true, false, false, false]);
  });

  it("pitches by ratio: a custom or harmonic voice plays its own ratio as a harmonic of C3, a BPM-steps voice its tempo over the slowest", () => {
    const c3 = midiToFrequency(48);
    // The advertised example: 3:4:5 is the chord G4–C5–E5 (harmonics 3, 4 and 5 of C3), not C3–F3–A3.
    const custom = polyEngine({ tempos: "custom", custom: "3,4,5", cycleSeconds: 2, pitchBy: "ratio", cycles: 0 });
    const view = custom.getPolyrhythmView();
    expect(view.pitch).toHaveLength(3);
    expect(view.pitch[0]).toBeCloseTo(3 * c3, 9);
    expect(view.pitch[1]).toBeCloseTo(4 * c3, 9);
    expect(view.pitch[2]).toBeCloseTo(5 * c3, 9);
    // The downbeat sounds exactly that chord.
    const downbeat = run(custom, 1)[0];
    expect(downbeat.chord).toHaveLength(3);
    expect(downbeat.chord![0]).toBeCloseTo(3 * c3, 9);
    expect(downbeat.chord![1]).toBeCloseTo(4 * c3, 9);
    expect(downbeat.chord![2]).toBeCloseTo(5 * c3, 9);
    // A list whose smallest ratio is not 1 keeps its absolute ratios (2:3 is C4–G4); 16 folds down an octave.
    const fifth = polyEngine({ tempos: "custom", custom: "2,3,16", pitchBy: "ratio", cycles: 0 }).getPolyrhythmView();
    expect(fifth.pitch[0]).toBeCloseTo(2 * c3, 9);
    expect(fifth.pitch[1]).toBeCloseTo(3 * c3, 9);
    expect(fifth.pitch[2]).toBeCloseTo(8 * c3, 9);
    // The harmonic series is ratios 1…N.
    const harmonic = polyEngine({ tempos: "harmonic", count: 5, pitchBy: "ratio", cycles: 0 }).getPolyrhythmView();
    for (let i = 0; i < 5; i++) expect(harmonic.pitch[i]).toBeCloseTo((i + 1) * c3, 9);
    // BPM steps: 60, 70, 80 BPM play 1, 7/6 and 4/3 of C3.
    const steps = polyEngine({ tempos: "arithmetic", count: 3, baseBpm: 60, bpmStep: 10, pitchBy: "ratio", cycles: 0 }).getPolyrhythmView();
    expect(steps.pitch[0]).toBeCloseTo(c3, 9);
    expect(steps.pitch[1]).toBeCloseTo((7 / 6) * c3, 9);
    expect(steps.pitch[2]).toBeCloseTo((4 / 3) * c3, 9);
  });

  it("caps the chord of a crowded step but keeps its range", () => {
    const engine = polyEngine({ count: 400, cycleSeconds: 1, cycles: 0 });
    const events = run(engine, 120);
    for (const e of events) {
      expect(e.chord?.length ?? 1).toBeLessThanOrEqual(e.accent ? MAX_ALIGN_PITCHES : MAX_STEP_PITCHES);
    }
    // At most one sound event per step.
    expect(events.length).toBeLessThanOrEqual(120);
    const downbeat = events[0];
    expect(downbeat.chord).toHaveLength(MAX_ALIGN_PITCHES);
  });

  it("finishes after the chosen cycles with every voice in phase, or never", () => {
    const engine = polyEngine({ count: 8, cycleSeconds: 3, cycles: 2 });
    let frames = 0;
    while (!engine.isSimulationFinished() && frames < 2000) {
      engine.update(STEP, 0);
      frames++;
    }
    expect(frames).toBe(361);
    expect(engine.getPolyrhythmProgress()).toMatchObject({ cycles: 2, total: 2, alignments: 3, count: 8, finished: true });
    const endless = polyEngine({ count: 8, cycleSeconds: 3, cycles: 0 });
    run(endless, 1200);
    expect(endless.isSimulationFinished()).toBe(false);
    expect(endless.getPolyrhythmView().alignCount).toBe(7);
    expect(endless.getPolyrhythmSecondsToAlignment()).toBeCloseTo(1, 9);
  });

  it("switches the layout, polygons and numbers live without touching the rhythm", () => {
    const engine = polyEngine({ count: 12, cycles: 0 });
    run(engine, 100);
    const view = engine.getPolyrhythmView();
    const ticks = view.tickCount;
    const step = view.step;
    engine.setPolyrhythmSettings({ layout: "metronomes", numbers: true, polygon: true });
    expect(view.settings.layout).toBe("metronomes");
    expect(view.settings.numbers).toBe(true);
    expect(view.geometry!.layout).toBe("metronomes");
    expect(view.step).toBe(step);
    run(engine, 1);
    expect(engine.getBalls()[0].radius).toBeCloseTo(view.geometry!.dotRadius, 9);
    expect(view.tickCount).toBeGreaterThanOrEqual(ticks);
    // A tempo change waits for the next init.
    engine.setPolyrhythmSettings({ count: 30 });
    expect(view.count).toBe(12);
    engine.initPolyrhythm();
    expect(view.count).toBe(30);
    expect(engine.getBalls()).toHaveLength(30);
  });

  it("follows a live ball-size change and a canvas resize", () => {
    const engine = polyEngine({ count: 4, cycles: 0 });
    run(engine, 10);
    const view = engine.getPolyrhythmView();
    const before = view.geometry!.dotRadius;
    engine.setConfig({ ballRadius: 16 });
    run(engine, 1);
    expect(view.geometry!.dotRadius).toBeGreaterThan(before);
    expect(engine.getBalls()[0].radius).toBeCloseTo(view.geometry!.dotRadius, 9);
    engine.setConfig({ width: 1080, height: 1920 });
    expect(view.geometry!.cx).toBe(540);
    for (let i = 0; i < 4; i++) expect(engine.getBalls()[i].x).toBe(view.x[i]);
  });

  it("is deterministic for a seed, sound events included, and the seed picks the direction", () => {
    const a = polyEngine({ layout: "spiral", count: 40, tempos: "arithmetic", accentEvery: 3 }, 99);
    const b = polyEngine({ layout: "spiral", count: 40, tempos: "arithmetic", accentEvery: 3 }, 99);
    expect(run(a, 500)).toEqual(run(b, 500));
    expect(a.getBalls().map((x) => [x.x, x.y])).toEqual(b.getBalls().map((x) => [x.x, x.y]));
    const directions = new Set<number>();
    for (let seed = 1; seed <= 20; seed++) directions.add(polyEngine({}, seed).getPolyrhythmView().direction);
    expect(directions).toEqual(new Set([-1, 1]));
  });

  it("keeps 400 voices cheap: a 30 s run of every layout simulates in well under a second", () => {
    for (const layout of POLY_LAYOUTS) {
      const engine = polyEngine({ count: 400, layout, cycles: 0 });
      const t0 = performance.now();
      run(engine, 30 * 60);
      const ms = performance.now() - t0;
      expect(ms, layout).toBeLessThan(1500);
      // Every voice's ticks in [0, 30 s): 1 + 2 + … + 400.
      expect(engine.getPolyrhythmView().tickCount).toBe((400 * 401) / 2);
    }
  });
});

describe("finder", () => {
  it("knows a run lasts cycles × cycle length whatever the seed, and never with the cycles at 0", () => {
    expect(fixedRunDurationSec("polyrhythm", { polyrhythm: { cycles: 2, cycleSeconds: 45 } })).toBe(90);
    expect(fixedRunDurationSec("polyrhythm", { polyrhythm: { tempos: "arithmetic", baseBpm: 60, bpmStep: 0.5, cycles: 1 } })).toBe(120);
    expect(fixedRunDurationSec("polyrhythm", { polyrhythm: { cycles: 0 } })).toBeNull();
    expect(fixedRunDurationSec("polyrhythm", {})).toBe(30);
    expect(runNeverFinishes("polyrhythm", { drop: {}, box: {}, polyrhythm: { cycles: 0 } })).toBe(true);
    expect(runNeverFinishes("polyrhythm", { drop: {}, box: {}, polyrhythm: { cycles: 1 } })).toBe(false);
    expect(runNeverFinishes("polyrhythm", { drop: {}, box: {} })).toBe(false);
    const request: FinderRequest = { targetDurationSec: 6, toleranceSec: 0.5, maxSeeds: 5, maxSimTimeSec: 40, physicsConfig: config, mode: "polyrhythm", modeSettings: { ...modeSettings, polyrhythm: { cycleSeconds: 3, cycles: 2 } } };
    expect(simulateSeed(5, request, 40_000)).toBeCloseTo(6000 + STEP, 3);
  });

  it("says so instead of searching when the fixed length misses the target, and finds the first seed when it matches", async () => {
    let progress = 0;
    const miss = await findSimulation({ targetDurationSec: 45, toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "polyrhythm", modeSettings: { ...modeSettings, polyrhythm: {} } }, () => progress++);
    expect(miss).toEqual({ found: false, seed: 0, duration: 30, seedsTested: 0, fixedDuration: true });
    const endless = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1000, maxSimTimeSec: 60, physicsConfig: config, mode: "polyrhythm", modeSettings: { ...modeSettings, polyrhythm: { cycles: 0 } } }, () => progress++);
    expect(endless).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0, endless: true });
    expect(progress).toBe(0);
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      const hit = await findSimulation({ targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 10, maxSimTimeSec: 40, physicsConfig: config, mode: "polyrhythm", modeSettings: { ...modeSettings, polyrhythm: {} } }, () => progress++);
      expect(hit.found).toBe(true);
      expect(hit.seedsTested).toBe(1);
      expect(hit.duration).toBeCloseTo(30, 1);
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});

describe("Metronomes & Polyrhythms settings", () => {
  it("resolve to the defaults, clamp the numbers and reject unknown options", () => {
    expect(resolvePolyrhythmSettings(undefined)).toEqual(DEFAULT_POLYRHYTHM_SETTINGS);
    const r = resolvePolyrhythmSettings({
      count: 999,
      layout: "hexagon" as PolyrhythmSettings["layout"],
      arcStyle: "zigzag" as PolyrhythmSettings["arcStyle"],
      tempos: "random" as PolyrhythmSettings["tempos"],
      custom: "3,4,x5",
      cycleSeconds: 12.3,
      baseBpm: 500,
      bpmStep: 0.04,
      polygon: true,
      accentEvery: 3.6,
      pitchBy: "colour" as PolyrhythmSettings["pitchBy"],
      numbers: true,
      cycles: -2,
    });
    expect(r).toEqual({ count: 400, layout: "rings", arcStyle: "chords", tempos: "harmonic", custom: "3,4,5", cycleSeconds: 12.5, baseBpm: 240, bpmStep: 0.1, polygon: true, accentEvery: 4, pitchBy: "index", numbers: true, cycles: 0 });
    expect(resolvePolyrhythmSettings({ count: Number.NaN }).count).toBe(DEFAULT_POLYRHYTHM_SETTINGS.count);
    for (const key of Object.keys(POLYRHYTHM_RANGES) as (keyof typeof POLYRHYTHM_RANGES)[]) expect(RANGES[key]).toEqual(POLYRHYTHM_RANGES[key]);
  });

  it("map to and from the SimulatorSettings fields, with the defaults in every mode", () => {
    for (const mode of MODE_IDS) expect(polyrhythmSettingsOf(defaultSettings(mode))).toEqual(DEFAULT_POLYRHYTHM_SETTINGS);
    expect(polyrhythmSettingFields(DEFAULT_POLYRHYTHM_SETTINGS)).toEqual({ prCount: 16, prLayout: "rings", prArcStyle: "chords", prTempos: "harmonic", prCustom: "3,4,5,7", prCycleSeconds: 30, prBaseBpm: 60, prBpmStep: 1, prPolygon: false, prAccentEvery: 0, prPitchBy: "index", prNumbers: false, prCycles: 1 });
  });

  it("round-trip through the URL keys, skipping the defaults", () => {
    const s: SimulatorSettings = { ...defaultSettings("polyrhythm"), prCount: 120, prLayout: "arcs", prArcStyle: "semicircles", prTempos: "custom", prCustom: "3,4,5", prCycleSeconds: 7.5, prBaseBpm: 90, prBpmStep: 0.5, prPolygon: true, prAccentEvery: 4, prPitchBy: "ratio", prNumbers: true, prCycles: 3 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("polyrhythm");
    expect(params.get("prn")).toBe("120");
    expect(params.get("prl")).toBe("arcs");
    expect(params.get("pras")).toBe("semicircles");
    expect(params.get("prt")).toBe("custom");
    expect(params.get("prcu")).toBe("3,4,5");
    expect(params.get("prcs")).toBe("7.5");
    expect(params.get("prb")).toBe("90");
    expect(params.get("prbs")).toBe("0.5");
    expect(params.get("prp")).toBe("1");
    expect(params.get("pra")).toBe("4");
    expect(params.get("prpb")).toBe("ratio");
    expect(params.get("prnum")).toBe("1");
    expect(params.get("prc")).toBe("3");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const defaults = settingsToSearchParams(defaultSettings("polyrhythm"));
    for (const key of ["prn", "prl", "pras", "prt", "prcu", "prcs", "prb", "prbs", "prp", "pra", "prpb", "prnum", "prc"]) expect(defaults.has(key)).toBe(false);
  });

  it("fall back for bad URL values and presets", () => {
    const fromUrl = settingsFromSearchParams(new URLSearchParams("mode=polyrhythm&prn=1&prl=cube&pras=x&prt=fast&prcu=%3Cb%3E2%2C3&prcs=0&prb=9&prbs=99&pra=-1&prpb=loud&prc=50"));
    expect(polyrhythmSettingsOf(fromUrl)).toEqual({ ...DEFAULT_POLYRHYTHM_SETTINGS, count: 2, custom: "2,3", cycleSeconds: 1, baseBpm: 20, bpmStep: 10, accentEvery: 0, cycles: 20 });
    const preset = presetToSettings({ mode: "polyrhythm", prCount: 1000, prLayout: "spiral", prTempos: "arithmetic", prCustom: 12, prPolygon: "yes", prCycles: 2 } as unknown as Partial<SimulatorSettings>);
    expect(polyrhythmSettingsOf(preset)).toEqual({ ...DEFAULT_POLYRHYTHM_SETTINGS, count: 400, layout: "spiral", tempos: "arithmetic", cycles: 2 });
  });
});
