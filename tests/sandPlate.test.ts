import { describe, expect, it } from "vitest";
import {
  ARP_COUNT,
  DEFAULT_SAND_PLATE_SETTINGS,
  FINALE_DAMP_SEC,
  FINALE_DELAY_SEC,
  FINALE_HOLD_SEC,
  MAX_HZ,
  SAND_PLATE_KEYS,
  SAND_PLATE_FINALE,
  SAND_PLATE_LADDER,
  SAND_PLATE_RANGES,
  START_LEVEL,
  arrangeFigures,
  defaultSandPlateFields,
  figureDiagonals,
  foldUnit,
  hopOf,
  plateWave,
  resolveSandPlateFields,
  resolveSandPlateSettings,
  rungOf,
  sandNoteHz,
  sandPlateChordSec,
  sandPlateCycleSec,
  sandPlateModeDefaults,
  sandPlateSettingsOf,
  sandPluckHz,
  type SandFigure,
  type SandPlateSettings,
} from "@/lib/physics/modes/sandPlate";
import {
  BANNER_AFTER_SEC,
  DEFAULT_SAND_PLATE_LABELS,
  GLOW_MAX,
  LIFT_SEC,
  LIFT_SIDE,
  NOTE_HUES,
  SAND_PLATE_DATA_KEYS,
  SandPlateDataset,
  SandPlateLayer,
  drawnFrame,
  noteHue,
  plateGlow,
  plateSwing,
  sandPlateBannerShows,
} from "@/components/simulator/sandPlateRenderer";
import { layoutEndBanner, placeEndBanner } from "@/components/simulator/endBanner";
import { readFileSync } from "node:fs";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, fixedRunDurationSec, runNeverFinishes, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { assistantSettings } from "@/lib/desktop/ai/settingsPatch";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { MODE_SEARCH_WORDS } from "@/lib/modeSearch";
import { MODE_SHELVES, MODE_SINCE } from "@/lib/siteDesign";
import type { PhysicsEngine } from "@/lib/physics/engine";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * Sand Plate (feature sand-plate): the settings, the link and the presets, the figures and the scale as pure functions, the
 * mode in the engine (the sand settling on each note's still lines, the re-flow at every new note, the full chord on the
 * finest figure, the fixed length, the loop that comes back to its first scatter exactly), its sound (every pitch under
 * 800 Hz, about 3 events a second, the chord once), determinism (a seed replays, another differs, a restart replays), the
 * finder's fixed length and the renderer.
 */

const config: PhysicsConfig = {
  width: 450,
  height: 800,
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

function plateEngine(sandPlate: Partial<SandPlateSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "sandPlate", { ...modeSettings, sandPlate }, seed);
}

interface Timed {
  t: number;
  ev: SoundEvent;
}

/** Runs until the run finishes (or `maxSec`), collecting every sound event with its simulation time. */
function run(engine: PhysicsEngine, maxSec = 60, onStep?: (engine: PhysicsEngine) => void): { events: Timed[]; finishedAt: number } {
  const events: Timed[] = [];
  for (let i = 1; i <= maxSec * 60; i++) {
    engine.update(STEP, 0);
    const t = engine.getElapsedMs() / 1000;
    for (const ev of engine.consumeSoundEvents()) events.push({ t, ev });
    onStep?.(engine);
    if (engine.isSimulationFinished()) return { events, finishedAt: t };
  }
  return { events, finishedAt: -1 };
}

/** A hash of every grain's position (to the micro-unit) and heat. */
function grainHash(engine: PhysicsEngine): number {
  const v = engine.getSandPlateView();
  let h = 2166136261;
  for (let i = 0; i < v.count; i++) {
    h = Math.imul(h ^ Math.round(v.gx[i] * 1e6), 16777619);
    h = Math.imul(h ^ Math.round(v.gy[i] * 1e6), 16777619);
    h = Math.imul(h ^ v.heat[i], 16777619);
  }
  return h >>> 0;
}

describe("Sand Plate: settings, link and presets", () => {
  it("is a mode of the rhythm family with a card after Song Ring, a shelf, a version, search words and a hero moment", () => {
    expect(MODE_IDS).toContain("sandPlate");
    expect(MODE_CATEGORIES.sandPlate).toBe("rhythm");
    expect(MODE_CARD_ORDER[MODE_CARD_ORDER.indexOf("songRing") + 1]).toBe("sandPlate");
    expect(MODE_SHELVES.sandPlate).toBe("loops");
    expect(MODE_SINCE.sandPlate).toBe("1.18.0");
    expect(MODE_SEARCH_WORDS.sandPlate.en.split(" ").length).toBeGreaterThanOrEqual(2);
    expect(HERO_MOMENTS.sandPlate.atSec).toBeGreaterThan(0);
  });

  it("has defaults, ranges on the RANGES table and a resolver that puts every value on its step, with no maximum but the memory ceilings", () => {
    expect(DEFAULT_SAND_PLATE_SETTINGS).toEqual({ notes: 8, noteSec: 2, grains: 3000, shake: 1, loop: false });
    for (const key of Object.keys(SAND_PLATE_RANGES)) expect(RANGES[key as keyof typeof RANGES]).toEqual(SAND_PLATE_RANGES[key as keyof typeof SAND_PLATE_RANGES]);
    expect(resolveSandPlateSettings({ notes: 9.4, noteSec: 2.26, grains: 4049.6, shake: 1.04 })).toMatchObject({ notes: 9, noteSec: 2.3, grains: 4050, shake: 1 });
    // past the sliders' ends: kept (uncapped), but the counts that size an allocation stop at their memory ceilings
    expect(resolveSandPlateSettings({ noteSec: 12, shake: 40 })).toMatchObject({ noteSec: 12, shake: 40 });
    expect(resolveSandPlateSettings({ notes: 1e9, grains: 1e12 })).toMatchObject({ notes: MEMORY_CEILINGS.spNotes, grains: MEMORY_CEILINGS.spGrains });
    // below a slider's start: its start; nonsense: the default
    expect(resolveSandPlateSettings({ notes: 0, noteSec: -3, grains: 2, shake: 0 })).toMatchObject({ notes: 3, noteSec: 1, grains: 500, shake: 0.3 });
    expect(resolveSandPlateSettings({ notes: Number.NaN, loop: "yes" as unknown as boolean })).toMatchObject({ notes: 8, loop: false });
    expect(sandPlateModeDefaults("sandPlate")).toEqual({});
    expect(resolveSandPlateFields({})).toEqual(defaultSandPlateFields());
  });

  it("writes only what differs from the defaults into a link and reads it back, through presetToSettings too", () => {
    const d = defaultSettings("sandPlate");
    expect([...settingsToSearchParams(d).keys()].filter((k) => k.startsWith("sp"))).toEqual([]);
    const s = { ...d, spNotes: 9, spNoteSec: 2.5, spGrains: 5000, spShake: 1.4, spLoop: true };
    const params = settingsToSearchParams(s);
    expect([params.get("spn"), params.get("spt"), params.get("spg"), params.get("spk"), params.get("spl")]).toEqual(["9", "2.5", "5000", "1.4", "1"]); // --- link-keys --- (the note length's own key: `sps` is the splat size's)
    const back = settingsFromSearchParams(params);
    expect([back.spNotes, back.spNoteSec, back.spGrains, back.spShake, back.spLoop]).toEqual([9, 2.5, 5000, 1.4, true]);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=sandPlate&spn=abc&spt=0&spg=-1&spk=x&spl=7"));
    expect([bad.spNotes, bad.spNoteSec, bad.spGrains, bad.spShake, bad.spLoop]).toEqual([8, 1, 500, 1, false]);
    const preset = presetToSettings({ mode: "sandPlate", spNotes: "11", spLoop: 1 } as never);
    expect([preset.spNotes, preset.spLoop]).toEqual([11, false]);
    expect(modeSettingsOfSettings({ ...d, spNotes: 5 }).sandPlate).toEqual({ ...sandPlateSettingsOf(d), notes: 5 });
    // the app's AI tunes it by its prefix
    expect(assistantSettings(d).map(([k]) => k).filter((k) => /^sp[A-Z]/.test(k)).sort()).toEqual(["spGrains", "spLoop", "spNoteSec", "spNotes", "spShake"]);
  });
});

describe("Sand Plate: the figures, the clock and the scale", () => {
  it("climbs a ladder of finer figures from a middle rung, the last one the finest", () => {
    expect(rungOf(0)).toBe(START_LEVEL);
    expect(rungOf(1000)).toBe(SAND_PLATE_LADDER.length - 1);
    for (let r = 1; r < SAND_PLATE_LADDER.length; r++) {
      const fine = (rung: readonly (readonly [number, number])[]) => Math.min(...rung.map(([m, n]) => m * m + n * n));
      expect([r, fine(SAND_PLATE_LADDER[r]) >= fine(SAND_PLATE_LADDER[r - 1])]).toEqual([r, true]);
    }
    // a figure's lines are where the plate stands still, and a fine figure hops less than a coarse one
    const f = { m: 2, n: 3, sign: 1 as const, mirror: false };
    expect(plateWave(f, 0, 0)).toBeCloseTo(2, 9);
    expect(Math.abs(plateWave(f, 0.5, 0.5))).toBeLessThan(1e-9);
    expect(hopOf({ m: 5, n: 7 }, 1)).toBeLessThan(hopOf({ m: 1, n: 4 }, 1));
  });

  it("folds any hop back onto the plate, however far (an uncapped shake)", () => {
    for (const v of [-0.25, 1.25, 2.5, -3.75, 1e9 + 0.25, -1e9 - 0.25]) {
      const u = foldUnit(v);
      expect([v, u >= 0 && u <= 1]).toEqual([v, true]);
    }
    expect(foldUnit(1.25)).toBeCloseTo(0.75, 12);
    expect(foldUnit(-0.25)).toBeCloseTo(0.25, 12);
  });

  it("lasts its notes and the finale's hold, whatever the seed; the chord lands on the last note", () => {
    expect(sandPlateCycleSec(DEFAULT_SAND_PLATE_SETTINGS)).toBeCloseTo(8 * 2 + FINALE_HOLD_SEC, 9);
    expect(sandPlateChordSec(DEFAULT_SAND_PLATE_SETTINGS)).toBeCloseTo(7 * 2 + FINALE_DELAY_SEC, 9);
    expect(fixedRunDurationSec("sandPlate", { sandPlate: {} } as never)).toBeCloseTo(17.8, 9);
    expect(fixedRunDurationSec("sandPlate", { sandPlate: { loop: true } } as never)).toBeNull();
    expect(runNeverFinishes("sandPlate", { sandPlate: { loop: true } } as never)).toBe(true);
    expect(runNeverFinishes("sandPlate", { sandPlate: {} } as never)).toBe(false);
  });

  it("keeps every pitch under 800 Hz, rising up the scale", () => {
    for (const key of SAND_PLATE_KEYS)
      for (let k = 0; k < 12; k++) {
        expect(sandNoteHz(key, k)).toBeLessThanOrEqual(MAX_HZ);
        for (let j = 0; j < ARP_COUNT; j++) expect(sandPluckHz(key, k, j)).toBeLessThanOrEqual(MAX_HZ);
        if (k > 0 && k < 9) expect(sandNoteHz(key, k)).toBeGreaterThan(sandNoteHz(key, k - 1));
      }
  });
});

describe("Sand Plate: the run", () => {
  it("draws each note's figure: the sand flows when a note starts and rests on its lines by the next", () => {
    for (const seed of [1, 2, 3]) {
      const e = plateEngine({}, seed);
      const at: number[][] = [];
      let last = -1;
      run(e, 30, (eng) => {
        const v = eng.getSandPlateView();
        const tau = v.localSec - v.noteStartSec;
        if (v.note !== last) {
          last = v.note;
          at[v.note] = [];
        }
        for (const s of [0.25, 1.9]) if (Math.abs(tau - s) < 0.5 / 60) at[v.note].push(v.moving);
      });
      for (let k = 1; k < 8; k++) {
        const [early, late] = at[k];
        // the re-flow is the event: far more sand moves just after a note starts than just before the next
        expect([seed, k, early > 1.6 * late]).toEqual([seed, k, true]);
        expect([seed, k, late < 0.3]).toEqual([seed, k, true]);
      }
    }
  });

  it("ends at its fixed length with the full chord once on the last figure, about 3 sounds a second, every pitch under 800 Hz", () => {
    const e = plateEngine({}, 5);
    const { events, finishedAt } = run(e);
    expect(finishedAt).toBeCloseTo(sandPlateCycleSec(DEFAULT_SAND_PLATE_SETTINGS), 1);
    const v = e.getSandPlateView();
    expect(v.chordSec).toBeCloseTo(sandPlateChordSec(DEFAULT_SAND_PLATE_SETTINGS), 1);
    expect(v.note).toBe(7);
    expect(events.filter((x) => x.ev.loop === "chord")).toHaveLength(1);
    expect(events.filter((x) => x.ev.loop === "bar")).toHaveLength(8);
    for (const x of events) if (x.ev.frequency !== undefined && x.ev.loop !== "chord" && x.ev.loop !== "root") expect(x.ev.frequency).toBeLessThanOrEqual(MAX_HZ);
    const perSec = events.length / finishedAt;
    expect(perSec).toBeGreaterThan(2);
    expect(perSec).toBeLessThan(4);
    // never a dead stretch: the longest gap between two sounds is under the note's length
    let gap = 0;
    for (let i = 1; i < events.length; i++) gap = Math.max(gap, events[i].t - events[i - 1].t);
    expect(gap).toBeLessThan(DEFAULT_SAND_PLATE_SETTINGS.noteSec);
    // the held voices stop by the end
    expect(events.some((x) => x.ev.loop === "hissStop")).toBe(true);
    expect(events.some((x) => x.ev.loop === "rootStop")).toBe(true);
  });

  it("replays a seed exactly, another seed draws another run, and a restart replays", () => {
    const a = plateEngine({}, 11);
    const b = plateEngine({}, 11);
    const c = plateEngine({}, 12);
    const ra = run(a);
    const rb = run(b);
    run(c);
    expect(grainHash(a)).toBe(grainHash(b));
    expect(ra.events.map((x) => [x.t, x.ev.loop, x.ev.frequency, x.ev.level])).toEqual(rb.events.map((x) => [x.t, x.ev.loop, x.ev.frequency, x.ev.level]));
    expect(grainHash(c)).not.toBe(grainHash(a));
    const fa = a.getSandPlateView().figures.map((f) => `${f.m},${f.n},${f.sign},${f.mirror}`).join(" ");
    const fc = c.getSandPlateView().figures.map((f) => `${f.m},${f.n},${f.sign},${f.mirror}`).join(" ");
    expect(fc === fa && c.getSandPlateView().keyMidi === a.getSandPlateView().keyMidi && grainHash(c) === grainHash(a)).toBe(false);
    // a restart of the same seed: the same run again
    a.setSeed(11);
    a.initMode("sandPlate");
    run(a);
    expect(grainHash(a)).toBe(grainHash(b));
  });

  it("pins the default run's sand (seed 12345, 600 steps): the mode's own fingerprint", () => {
    const e = plateEngine({}, 12345, { ...config, width: 800, height: 600 });
    for (let i = 0; i < 600; i++) e.update(STEP, 0);
    const v = e.getSandPlateView();
    expect([v.count, v.note, v.keyMidi, v.figures.map((f) => `${f.m},${f.n}`).join(" ")]).toEqual(SAND_PIN.head);
    expect(grainHash(e)).toBe(SAND_PIN.hash);
  });

  it("plays the same run in a phone's world and a laptop's (the sand lives in plate units)", () => {
    const phone = plateEngine({}, 3, { ...config, width: 450, height: 450 });
    const laptop = plateEngine({}, 3, { ...config, width: 800, height: 450 });
    run(phone);
    run(laptop);
    expect(grainHash(phone)).toBe(grainHash(laptop));
  });

  it("with Loop on never ends, and every seam brings the sand back to its first scatter exactly", () => {
    const e = plateEngine({ notes: 3, noteSec: 1.5, loop: true }, 4);
    const cycle = sandPlateCycleSec({ notes: 3, noteSec: 1.5 });
    const { finishedAt } = run(e, 3 * cycle + 0.5);
    expect(finishedAt).toBe(-1);
    const v = e.getSandPlateView();
    expect(v.seams).toBe(3);
    expect(v.seamError).toBeLessThan(1e-6);
    expect(e.getCycleSeconds()).toBeCloseTo(cycle, 9);
  });

  it("runs the most grains its ceiling allows without a NaN, and a run of many notes climbs to the top rung", () => {
    const e = plateEngine({ grains: 20000, notes: 14, noteSec: 1, shake: 3 }, 9);
    run(e);
    const v = e.getSandPlateView();
    expect(v.count).toBe(20000);
    for (let i = 0; i < v.count; i += 97) expect(Number.isFinite(v.gx[i]) && v.gx[i] >= 0 && v.gx[i] <= 1 && v.gy[i] >= 0 && v.gy[i] <= 1).toBe(true);
    expect(v.figures).toHaveLength(14);
    const top = SAND_PLATE_LADDER[SAND_PLATE_LADDER.length - 1].map(([m, n]) => `${m},${n}`);
    expect(top).toContain(`${v.figures[12].m},${v.figures[12].n}`);
    // (--- review fix (C3) --- the last note rings the top rung's mandala)
    const [m, n] = SAND_PLATE_FINALE[SAND_PLATE_LADDER.length - 1];
    expect(v.figures[13]).toEqual({ m, n, sign: 1, mirror: false });
  });
});

// --- review fix (C3) --- the last figure held sharp, a new diagonal at every note, the mandala at the end
describe("Sand Plate: the figures as played", () => {
  /** The share of grains on the ringing figure's lines (|w|/2 under 0.08). */
  function onLines(engine: PhysicsEngine): number {
    const v = engine.getSandPlateView();
    const f = v.figures[v.note];
    let on = 0;
    for (let i = 0; i < v.count; i++) if (0.5 * Math.abs(plateWave(f, v.gx[i], v.gy[i])) < 0.08) on++;
    return on / v.count;
  }

  it("holds the last figure as sharp as the chord found it, to the run's end (the floor hop follows the plate's ring)", () => {
    for (const seed of [1, 2, 3]) {
      const e = plateEngine({}, seed);
      let atChord = -1;
      const { finishedAt } = run(e, 30, (eng) => {
        if (atChord < 0 && eng.getSandPlateView().chordSec >= 0) atChord = onLines(eng);
      });
      expect(finishedAt).toBeGreaterThan(0);
      const atEnd = onLines(e);
      // (before the fix the sand random-walked off its lines once the plate stopped: 0.53–0.56 at the end, from 0.80 at the chord)
      expect([seed, atChord > 0.75, atEnd >= atChord]).toEqual([seed, true, true]);
      expect(e.getSandPlateView().drive).toBeCloseTo(0.3, 9);
    }
  });

  it("knows a figure's corner-to-corner lines: the ones where the plate stands still", () => {
    for (const [m, n] of [[1, 4], [2, 3], [3, 5], [4, 7], [5, 7], [6, 9]] as const)
      for (const sign of [1, -1] as const)
        for (const mirror of [false, true]) {
          const f: SandFigure = { m, n, sign, mirror };
          let main = true;
          let anti = true;
          for (let i = 1; i < 20; i++) {
            const t = i / 20;
            if (Math.abs(plateWave(f, t, t)) > 1e-9) main = false;
            if (Math.abs(plateWave(f, 1 - t, t)) > 1e-9) anti = false;
          }
          expect([m, n, sign, mirror, figureDiagonals(f)]).toEqual([m, n, sign, mirror, (main ? 1 : 0) | (anti ? 2 : 0)]);
        }
  });

  it("never keeps a corner-to-corner line across a note change, and ends on its rung's mandala, over 30 seeds", () => {
    const finales = new Set<string>();
    for (let seed = 1; seed <= 30; seed++)
      for (const notes of [8, 5, 12]) {
        const figures = plateEngine({ notes }, seed).getSandPlateView().figures;
        expect(figures).toHaveLength(notes);
        for (let k = 1; k < notes; k++) expect([seed, notes, k, figureDiagonals(figures[k]) & figureDiagonals(figures[k - 1])]).toEqual([seed, notes, k, 0]);
        const last = figures[notes - 1];
        const [m, n] = SAND_PLATE_FINALE[rungOf(notes - 1)];
        expect([seed, notes, last]).toEqual([seed, notes, { m, n, sign: 1, mirror: false }]);
        expect(figureDiagonals(last)).toBe(0);
        if (notes === 8) finales.add(`${last.m},${last.n}`);
      }
    expect([...finales]).toEqual(["7,9"]);
    // every mandala is at least as fine as its rung's finest figure
    for (let r = 0; r < SAND_PLATE_LADDER.length; r++) {
      const [m, n] = SAND_PLATE_FINALE[r];
      expect([r, (m + n) % 2, m * m + n * n >= Math.min(...SAND_PLATE_LADDER[r].map(([a, b]) => a * a + b * b))]).toEqual([r, 0, true]);
    }
    // arranging draws nothing and changes nothing it need not: a run of one-diagonal figures that already alternate
    const alternate: SandFigure[] = [
      { m: 1, n: 4, sign: -1, mirror: false },
      { m: 2, n: 3, sign: 1, mirror: false },
      { m: 1, n: 6, sign: -1, mirror: false },
    ];
    const kept = alternate.slice(0, 2).map((f) => ({ ...f }));
    arrangeFigures(alternate);
    expect(alternate.slice(0, 2)).toEqual(kept);
  });
});

describe("Sand Plate: the canvas", () => {
  /** A canvas context that counts what it draws (every call a no-op). */
  function fakeContext() {
    const calls: Record<string, number> = {};
    const target: Record<string, unknown> = {};
    return {
      calls,
      ctx: new Proxy(target, {
        get(_t, prop: string) {
          if (prop in target) return target[prop];
          return () => {
            calls[prop] = (calls[prop] ?? 0) + 1;
          };
        },
        set(_t, prop: string, value) {
          target[prop] = value;
          return true;
        },
      }) as unknown as CanvasRenderingContext2D,
    };
  }

  it("draws the plate, the sand in a few batched paths, the dots and the chord's flash, and writes its dataset", () => {
    const e = plateEngine({}, 2);
    const layer = new SandPlateLayer();
    run(e, 17);
    const v = e.getSandPlateView();
    expect(v.chordSec).toBeGreaterThan(0);
    const { ctx, calls } = fakeContext();
    layer.drawWorld(ctx, v);
    layer.drawEffects(ctx, v);
    layer.drawOverlay(ctx, v);
    // every grain a rect, at most 3 + 12 fills of them (the heats and the flood's bands), plus the plate's and the dots'
    expect(calls.rect).toBe(v.count);
    expect(calls.fill).toBeLessThanOrEqual(15 + 2 + 1 + v.settings.notes);
    expect(calls.shadowBlur ?? 0).toBe(0);
    expect(layer.hudBox.w).toBeGreaterThan(0);
    const data: Record<string, string> = {};
    new SandPlateDataset().write(v, (k, val) => (data[k] = val));
    expect(Object.keys(data).sort()).toEqual([...SAND_PLATE_DATA_KEYS].sort());
    expect([data.sandChord, data.sandNotes, data.sandGrains]).toEqual(["1", "8", "3000"]);
    expect(noteHue(0, 7)).toBe(NOTE_HUES[0]);
    expect(noteHue(6, 7)).toBe(NOTE_HUES[NOTE_HUES.length - 1]);
    expect(DEFAULT_SAND_PLATE_LABELS.doneSub(7)).toBe("7 notes, 7 shapes");
  });

  // --- review fix (C3) --- the plate rises out of the banner's way, the banner waits for it, the glow follows the plate's ring
  it("lifts the plate clear of the end banner before the banner shows, in every locale's words", () => {
    const e = plateEngine({}, 4);
    const before: number[] = [];
    let chordFrame: { top: number; side: number } | null = null;
    let lifted: { top: number; side: number } | null = null;
    let bannerFrom = -1;
    const out = { cx: 0, cy: 0, square: 0, left: 0, top: 0, side: 0 };
    run(e, 30, (eng) => {
      const v = eng.getSandPlateView();
      const f = drawnFrame(v, out);
      if (v.chordSec < 0) before.push(f.side - v.frame.side, f.top - v.frame.top);
      else if (!chordFrame) chordFrame = { top: f.top, side: f.side };
      if (v.chordSec >= 0 && v.localSec - v.chordSec >= LIFT_SEC && !lifted) lifted = { top: f.top, side: f.side };
      if (bannerFrom < 0 && sandPlateBannerShows(v)) bannerFrom = v.localSec - v.chordSec;
    });
    const v = e.getSandPlateView();
    expect(before.every((d) => d === 0)).toBe(true);
    expect(chordFrame!.side).toBeGreaterThan(0.83 * v.frame.square);
    expect(lifted!.side).toBeCloseTo(LIFT_SIDE * v.frame.square, 6);
    expect(bannerFrom).toBeGreaterThanOrEqual(BANNER_AFTER_SEC - 1e-9);
    expect(bannerFrom).toBeLessThan(BANNER_AFTER_SEC + 1 / 60);
    // the canvas' banner: centred at 0.92 of the square, kept inside it (Canvas.tsx, placeEndBanner); its top lies under the lifted plate
    const S = v.frame.square;
    const squareTop = v.frame.cy - S / 2;
    let font = "";
    const measurer = {
      get font() {
        return font;
      },
      set font(f: string) {
        font = f;
      },
      measureText: (t: string) => ({ width: 0.62 * Number(/([\d.]+)px/.exec(font)?.[1] ?? 10) * t.length }),
    } as unknown as CanvasRenderingContext2D;
    for (const m of [en, pl, es] as unknown as { SandPlate: { canvasTitle: string } }[]) {
      const lay = layoutEndBanner(measurer, { title: m.SandPlate.canvasTitle, sub: DEFAULT_SAND_PLATE_LABELS.doneSub(8), color: "#fde68a" }, S);
      const top = placeEndBanner(squareTop + 0.92 * S - lay.height / 2, lay.height, squareTop + 0.02 * S, squareTop + 0.98 * S, v.frame.cy - lay.height / 2);
      expect([m.SandPlate.canvasTitle, lifted!.top + lifted!.side < top]).toEqual([m.SandPlate.canvasTitle, true]);
    }
  });

  it("glows where the plate shakes: a hum, a flash at every strike and lobes that take turns, from the simulation clock, gone after the chord", () => {
    const e = plateEngine({}, 6);
    const glows: { t: number; g: number; strike: number; swing: number }[] = [];
    run(e, 30, (eng) => {
      const v = eng.getSandPlateView();
      glows.push({ t: v.localSec, g: plateGlow(v), strike: v.strikeSec, swing: plateSwing(v) });
    });
    const v = e.getSandPlateView();
    for (const x of glows) expect(x.g >= 0 && x.g <= GLOW_MAX).toBe(true);
    // brighter just after a strike than a step before it
    const struck = glows.filter((x, i) => i > 0 && x.strike !== glows[i - 1].strike && x.t < v.chordSec);
    expect(struck.length).toBeGreaterThanOrEqual(v.settings.notes);
    for (const x of struck) {
      const i = glows.indexOf(x);
      expect(x.g).toBeGreaterThan(glows[i - 1].g);
    }
    // the lobes take turns within every note, while the sand rests too (the settled picture is not still), and the plate is
    // dark once the chord has rung
    for (let k = 1; k < v.settings.notes - 1; k++) {
      const late = glows.filter((x) => x.t >= k * 2 + 1 && x.t < k * 2 + 2).map((x) => x.swing);
      expect([k, Math.max(...late) > 0.9, Math.min(...late) < -0.9]).toEqual([k, true, true]);
    }
    expect(glows.filter((x) => x.t > v.chordSec + FINALE_DAMP_SEC).every((x) => x.g === 0)).toBe(true);
  });

  it("names its own fixed length to the finder, in en, pl and es", () => {
    for (const m of [en, pl, es] as unknown as { Simulator: Record<string, string>; Controls: Record<string, string> }[]) {
      expect(m.Simulator.finderFixedSandPlate).toContain("{duration}");
      expect(m.Controls.spFixedRunLength).toContain("{duration}");
    }
    expect(en.Simulator.finderFixedSandPlate).toContain("Sand Plate");
    const page = readFileSync("src/components/simulator/Simulator.tsx", "utf8");
    expect(page).toContain('settings.mode === "sandPlate" ? "Simulator.finderFixedSandPlate"');
    expect(page).toContain('settings.mode === "sandPlate" ? "Controls.spFixedRunLength"');
  });

  it("says its name, its line, its section and its banner in en, pl and es", () => {
    for (const m of [en, pl, es] as unknown as { Controls: Record<string, string>; Modes: Record<string, { name: string; description: string }>; SandPlate: Record<string, string> }[]) {
      expect(m.Controls.modeSandPlate).toBe(m.Modes.sandPlate.name);
      for (const key of ["spTitle", "spDesc", "spNotes", "spNotesTip", "spNoteSec", "spNoteSecTip", "spGrains", "spGrainsTip", "spShake", "spShakeTip", "spLoop", "spLoopTip", "spRunInfo", "spRunLoop"]) expect(m.Controls[key]?.length ?? 0).toBeGreaterThan(0);
      expect(m.SandPlate.canvasTitle.length).toBeGreaterThan(0);
      expect(m.SandPlate.canvasDoneSub).toContain("{count, plural,");
    }
  });
});

/**
 * The default run's sand at seed 12345 after 600 steps (800 × 600): recorded when the mode was added, and again with the C3
 * review's fixes (eight notes of 2 s, the floor hop as strong as the plate rings, the arranged figures and the last note's
 * mandala: the same draws, the same first seven figures).
 */
const SAND_PIN = { head: [3000, 5, 57, "1,4 3,4 1,6 2,7 3,7 4,7 5,8 7,9"] as (number | string)[], hash: 1518926292 };
