import { describe, expect, it } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { CTF_RISER_HZ, CTF_RISER_SEC, CTF_TICK_HZ, CTF_TICK_MS, ctfTickHz } from "@/lib/physics/modes/ctf";
import { FANFARE } from "@/lib/physics/modes/arenaGames";
import { ArenaLayer, CTF_CARRIED_FLAG, CTF_HALF_TINT, CTF_SCORE_POP_MS, CTF_STREAK_ALPHA, DEFAULT_ARENA_LABELS, ctfScorePop, type ArenaRenderOptions } from "@/components/simulator/arenaRenderer";
import { fakeCanvas } from "./fakeCanvas";
import { clipStartSettings } from "@/lib/clipPacing";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import type { SoundEvent } from "@/lib/physics/types";

/*
 * --- ctf-flag-run --- (Lane E, E6) Capture the Flag tells its story: each phase has a voice of its own (a riser under a pickup, a
 * tick while a flag is carried that climbs as the carrier nears home, the race's fanfare over a capture's chords: lib/physics/
 * modes/ctf.ts), the carrier flies a big flag and the score pops (components/simulator/arenaRenderer.ts), and a bare visit plays
 * three a side at ball speed 600: a fuller field and fewer games on the clock (lib/clipPacing.ts).
 */

const WORLD = { width: 800, height: 450 };

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}): PhysicsEngine {
  const s = { ...defaultSettings("ctf"), ...patch } as SimulatorSettings;
  const f = finderRequestOfSettings(s, WORLD, 60);
  return createEngineForSettings(f.physicsConfig, f.mode, f.modeSettings, seed) as PhysicsEngine;
}

function runAll(e: PhysicsEngine, maxSec = 40): { ms: number; ev: SoundEvent; carrying: number[] }[] {
  const out: { ms: number; ev: SoundEvent; carrying: number[] }[] = [];
  for (let frame = 0; frame < maxSec * 60 && !e.isSimulationFinished(); frame++) {
    e.update(1000 / 60, 0);
    const carrying = [...e.getArenaView()!.carrying];
    for (const ev of e.consumeSoundEvents()) out.push({ ms: e.getElapsedMs(), ev, carrying });
  }
  return out;
}

describe("Capture the Flag's voices", () => {
  it("rises under every pickup, ticks while a flag is carried, and plays the race's fanfare over every capture's chords", () => {
    for (const seed of [1, 4]) {
      const e = engineOf(seed);
      const sounds = runAll(e);
      const p = e.getCtfProgress();
      expect(p.finished).toBe(true);
      const extra = sounds.filter((x) => x.ev.ringVoice === "extra");
      // every one a sound of its own: the crew's moments and a visitor's own sound leave them out
      for (const x of extra) expect(x.ev.melody).toBe(false);
      const risers = extra.filter((x) => x.ev.loop === "riser");
      // (every capture was carried home after a pickup)
      expect(risers.length).toBeGreaterThanOrEqual(p.captures);
      for (const r of risers) expect([r.ev.frequency, r.ev.loopSec]).toEqual([CTF_RISER_HZ, CTF_RISER_SEC]);
      // the capture: the race's fanfare in the step of the goal fanfare's first chord
      const fanfares = extra.filter((x) => x.ev.race === "fanfare");
      expect(fanfares).toHaveLength(p.captures);
      const firstChords = sounds.filter((x) => x.ev.chord && x.ev.chord.length === FANFARE[0].length && x.ev.chord.every((f, i) => f === FANFARE[0][i]));
      expect(firstChords.map((x) => x.ms)).toEqual(fanfares.map((x) => x.ms));
      // the ticks: only while a square carries a flag, in the progress bar's register (an octave from CTF_TICK_HZ)
      const ticks = extra.filter((x) => x.ev.loop === "step");
      expect(ticks.length).toBeGreaterThan(0);
      for (const t of ticks) {
        expect(t.carrying.some((c) => c >= 0)).toBe(true);
        expect(t.ev.frequency!).toBeGreaterThanOrEqual(CTF_TICK_HZ - 1e-9);
        expect(t.ev.frequency!).toBeLessThanOrEqual(2 * CTF_TICK_HZ + 1e-9);
      }
    }
  }, 60_000);

  it("ticks higher the nearer the carrier is to its own base", () => {
    expect(ctfTickHz(0)).toBeCloseTo(CTF_TICK_HZ, 9);
    expect(ctfTickHz(1)).toBeCloseTo(2 * CTF_TICK_HZ, 9);
    expect(ctfTickHz(0.5)).toBeGreaterThan(ctfTickHz(0.25));
    expect(ctfTickHz(-3)).toBe(ctfTickHz(0));
    expect(CTF_TICK_MS).toBeLessThan(1000);
  });
});

describe("Capture the Flag's picture", () => {
  it("flies a flag twice the size it was and pops the scorer's number on a capture", () => {
    expect(CTF_CARRIED_FLAG).toBeGreaterThanOrEqual(3);
    expect(ctfScorePop(0)).toBeCloseTo(1.8, 9);
    expect(ctfScorePop(CTF_SCORE_POP_MS / 2)).toBeGreaterThan(1);
    expect(ctfScorePop(CTF_SCORE_POP_MS)).toBe(1);
    expect(ctfScorePop(-Infinity)).toBe(1);
  });

  it("starts a bare visit with three a side at ball speed 600: fewer games end on the clock than with the link base", () => {
    expect(clipStartSettings("ctf")).toEqual({ ctfPerTeam: 3, ballSpeed: 600 });
    expect(defaultSettings("ctf")).toMatchObject({ ctfPerTeam: 2, ballSpeed: 400 });
    let start = 0;
    let base = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const a = engineOf(seed, clipStartSettings("ctf"));
      runAll(a);
      expect(a.getArenaView()!.count).toBe(6);
      if (a.getCtfProgress().byTime) start++;
      const b = engineOf(seed);
      runAll(b);
      if (b.getCtfProgress().byTime) base++;
    }
    // measured on seeds 1–40 (the laptop world; the phone world's 450 × 450 gives the same): 9 on the clock with the start look, 14 with the link base
    expect([start, base]).toEqual([9, 14]);
  }, 120_000);
});

// --- ctf-fill --- (Lane E, E6 review) six small squares on a dark field: every square now streaks and glows in its team's colour
// over brighter halves, and a carrier's run stops drawing once the game is over, under DRAW! or the winner card
describe("Capture the Flag's field", () => {
  const OPTIONS: ArenaRenderOptions = { wallColor: () => "#ffffff", wallThickness: 4, showWallGlow: true, showGlow: false, showTrails: true, roster: null, showNames: false, numbers: true, labels: DEFAULT_ARENA_LABELS };

  /** The bodies of one frame: every stroke's and fill's opacity and dash, and every arc's radius. */
  function bodiesOf(e: PhysicsEngine) {
    const canvas = fakeCanvas(WORLD.width, WORLD.height);
    const ctx = canvas.ctx;
    const strokes: { alpha: number; dashed: boolean; width: number }[] = [];
    const arcs: number[] = [];
    let dash: number[] = [];
    ctx.setLineDash = (d: number[]) => {
      dash = d;
    };
    const stroke = ctx.stroke as (...a: unknown[]) => void;
    ctx.stroke = (...a: unknown[]) => {
      strokes.push({ alpha: ctx.globalAlpha, dashed: dash.length > 0, width: ctx.lineWidth });
      return stroke(...a);
    };
    const arc = ctx.arc as (...a: unknown[]) => void;
    ctx.arc = (...a: unknown[]) => {
      arcs.push(a[2] as number);
      return arc(...a);
    };
    new ArenaLayer().drawBodies(ctx as unknown as CanvasRenderingContext2D, e.getBalls(), e.getArenaView()!, OPTIONS);
    return { strokes, arcs };
  }

  it("streaks and glows every square in its team's colour over brighter halves, the carrier boldest", () => {
    expect(CTF_HALF_TINT).toBeGreaterThan(0.07);
    const e = engineOf(7, clipStartSettings("ctf"));
    let seen = false;
    for (let frame = 0; frame < 40 * 60 && !e.isSimulationFinished() && !seen; frame++) {
      e.update(1000 / 60, 0);
      const v = e.getArenaView()!;
      if (frame < 60 || !v.carrying.some((c) => c >= 0)) continue;
      seen = true;
      const { strokes, arcs } = bodiesOf(e);
      const h = e.getBalls()[0].radius;
      // a halo round each of the six squares (two layers, the outer 2.5 half sizes out)
      expect(arcs.filter((r) => Math.abs(r - 2.5 * h) < 1e-6)).toHaveLength(6);
      // a streak behind every square: the five without a flag at CTF_STREAK_ALPHA at most, the carrier's bolder, with its dashed line home
      const faint = strokes.filter((x) => !x.dashed && x.alpha <= CTF_STREAK_ALPHA + 1e-9 && x.alpha > 0.2);
      const bold = strokes.filter((x) => !x.dashed && x.alpha > CTF_STREAK_ALPHA + 1e-9 && x.alpha <= 0.55 + 1e-9);
      expect(faint.length).toBeGreaterThanOrEqual(5);
      expect(bold.length).toBeGreaterThanOrEqual(1);
      expect(strokes.filter((x) => x.dashed)).toHaveLength(v.carrying.filter((c) => c >= 0).length);
    }
    expect(seen).toBe(true);
  }, 60_000);

  it("draws no streak and no dashed line home once the game is over, a flag still carried or not", () => {
    for (const seed of [1, 7]) {
      const e = engineOf(seed, clipStartSettings("ctf"));
      runAll(e);
      expect(e.getCtfProgress().finished).toBe(true);
      // a square that still holds a flag when the clock or the last capture ends the game
      const v = e.getArenaView()!;
      v.carrying[0] = 1;
      const { strokes } = bodiesOf(e);
      expect([seed, strokes.filter((x) => x.dashed).length]).toEqual([seed, 0]);
      // what strokes is the squares' own outline (and the flag's pole and cloth), never a streak's fading segments
      expect([seed, strokes.filter((x) => x.alpha < 0.55 && x.alpha > 0).length]).toEqual([seed, 0]);
    }
  }, 60_000);
});
