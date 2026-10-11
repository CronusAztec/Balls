/**
 * --- fl-overhaul --- Fight League probes (a helper, not a test file): the numbers the weapon contract and the fairness checks
 * are judged by, measured headlessly on the fixed 60 Hz step. They read the public view only (fighters, weapons and their hit
 * counters, the projectile pool) and wrap the mode's `launch()` for the burst probe, so the same code measured the rules before
 * this stage's rework – the BEFORE column of tests/fightLeagueWeapons.test.ts was taken with it on the old code.
 *
 * The dummy: Gerald in slot B with speed, attack speed and cast speed at the minimum (0.05) and 1000 HP, put at the arena's
 * centre after the init – it barely moves, barely punches and never casts; the attacker's ability is off (cast speed 0.05).
 */
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { fightLeagueSettingsOf, resolveFightLeagueSettings, type FightLeagueSettings, type FightLeagueView, type FlFighter, type FlProjectile } from "@/lib/physics/modes/fightLeague";
import { FL_ROSTER, type FlFighterRow, type FlWeaponKind } from "@/lib/physics/modes/fightLeagueRoster";

/** The 16:9 world every desktop frame runs (lib/simulation/world.ts). */
export const PROBE_WORLD = { width: 800, height: 450 };
export const PROBE_STEP = 1000 / 60;
/** The VS card's length (the fighters launch at FIGHT!). */
export const PROBE_INTRO_MS = 1500;

export function probeSettings(fl: Partial<FightLeagueSettings> = {}, extra: Partial<SimulatorSettings> = {}): { config: PhysicsConfig; modeSettings: ModeSettings } {
  const s = { ...defaultSettings("fightLeague"), ...extra };
  return {
    config: physicsConfigOfSettings(s, PROBE_WORLD),
    modeSettings: { ...modeSettingsOfSettings(s), fightLeague: resolveFightLeagueSettings({ ...fightLeagueSettingsOf(s), ...fl }) },
  };
}

export function probeEngine(fl: Partial<FightLeagueSettings> = {}, seed = 1, configPatch: Partial<PhysicsConfig> = {}): PhysicsEngine {
  const { config, modeSettings } = probeSettings(fl);
  return createEngineForSettings({ ...config, ...configPatch }, "fightLeague", modeSettings, seed);
}

/** Steps whole frames until `untilMs` of simulation time (or the end when `stopAtEnd`), calling `each` after every frame. */
export function probeRun(engine: PhysicsEngine, untilMs: number, each?: (v: FightLeagueView) => boolean | void, stopAtEnd = true): FightLeagueView {
  const v = engine.getFightLeagueView();
  while (engine.getElapsedMs() < untilMs - 1e-6 && !(stopAtEnd && engine.isSimulationFinished())) {
    engine.update(PROBE_STEP, 0);
    engine.consumeSoundEvents();
    if (each && each(v) === true) break;
  }
  return v;
}

/** An attacker (slot A, ability off) against the dummy (slot B: an inert Gerald at the centre, 1000 HP). */
export function dummyDuel(attacker: string, seed: number, fl: Partial<FightLeagueSettings> = {}): PhysicsEngine {
  const engine = probeEngine({ fighters: [attacker, "gerald", "random", "random"], match: "1v1", hp: 1000, timeCap: 0, speed: [1, 0.05, 1, 1], attack: [1, 0.05, 1, 1], cast: [0.05, 0.05, 1, 1], ...fl }, seed);
  const v = engine.getFightLeagueView();
  const dummy = v.fighters[1];
  const ball = engine.getBalls().find((b) => b.id === dummy.ballId);
  if (ball && v.field) {
    ball.x = dummy.x = v.field.cx;
    ball.y = dummy.y = v.field.cy;
  }
  return engine;
}

/** Seconds after FIGHT! of the attacker's first hit on the dummy within `limitSec` (Infinity without one). */
export function firstHitSec(attacker: string, seed: number, limitSec = 10, fl: Partial<FightLeagueSettings> = {}): number {
  const engine = dummyDuel(attacker, seed, fl);
  let at = Infinity;
  probeRun(engine, PROBE_INTRO_MS + 1000 * limitSec, (v) => {
    if (v.fighters[0].hits > 0) {
      at = (v.timeMs - PROBE_INTRO_MS) / 1000;
      return true;
    }
  });
  return at;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : 0.5 * (s[m - 1] + s[m]);
}

const MELEE: readonly FlWeaponKind[] = ["sword", "hammer", "fists", "claws", "chain", "tail", "whip"];

/** The median first hit (s after FIGHT!) of every roster fighter whose first weapon is melee, against the dummy (seeds 1–3). */
export function meleeMedianFirstHit(): { median: number; misses: number; runs: number } {
  return memoized("melee first hit", meleeMedianFirstHitUncached);
}

function meleeMedianFirstHitUncached(): { median: number; misses: number; runs: number } {
  const times: number[] = [];
  let misses = 0;
  for (const row of FL_ROSTER) {
    if (row.id === "gerald" || !MELEE.includes(row.weapons[0].kind)) continue;
    for (const seed of [1, 2, 3]) {
      const t = firstHitSec(row.id, seed);
      if (!Number.isFinite(t)) misses++;
      times.push(Math.min(t, 10));
    }
  }
  return { median: median(times), misses, runs: times.length };
}

/** A 1v1 of `a` and `b` played to its end (a 60 s cap). */
export function probeDuel(a: string, b: string, seed: number, fl: Partial<FightLeagueSettings> = {}): FightLeagueView {
  return probeRun(probeEngine({ fighters: [a, b, "random", "random"], match: "1v1", timeCap: 60, ...fl }, seed), 200_000);
}

/** --- fl-overhaul --- (Stage 2) The probes are deterministic: a file that asks twice (a check and the probe table) plays once. */
const memo = new Map<string, unknown>();
function memoized<T>(key: string, body: () => T): T {
  if (!memo.has(key)) memo.set(key, body());
  return memo.get(key) as T;
}

/**
 * --- fl-overhaul --- (Stage 2) A turn of the event loop: a long probe yields now and then, so the vitest worker answers its
 * runner's calls (a run blocked for a minute – the 147 fighters on a busy machine – times them out: "Timeout calling
 * onTaskUpdate").
 */
export const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Every fighter against itself over `seeds`: the share of double KOs and slot A's share of the decided fights (yields between fighters). */
export function mirrorStats(seeds: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8]): Promise<{ doubleKo: number; slotA: number; games: number; decided: number }> {
  return memoized(`mirror ${seeds.join(",")}`, () => mirrorStatsUncached(seeds));
}

async function mirrorStatsUncached(seeds: readonly number[]): Promise<{ doubleKo: number; slotA: number; games: number; decided: number }> {
  let games = 0;
  let double = 0;
  let decided = 0;
  let aWins = 0;
  for (const row of FL_ROSTER) {
    for (const seed of seeds) {
      const v = probeDuel(row.id, row.id, seed);
      games++;
      if (v.doubleKo) double++;
      else if (v.winnerTeam === 0 || v.winnerTeam === 1) {
        decided++;
        if (v.winnerTeam === 0) aWins++;
      }
    }
    await breathe();
  }
  return { doubleKo: double / Math.max(1, games), slotA: aWins / Math.max(1, decided), games, decided };
}

/** Hits a second of weapon `index` of `attacker` against the dummy, over `seconds` of fighting on seeds 1–3. */
export function weaponHitsPerSec(attacker: string, index: number, arena: "square" | "circle", seconds = 30): number {
  let hits = 0;
  for (const seed of [1, 2, 3]) {
    const engine = dummyDuel(attacker, seed, { arena });
    const v = probeRun(engine, PROBE_INTRO_MS + 1000 * seconds);
    hits += v.fighters[0].weapons[index].hits;
  }
  return hits / (3 * seconds);
}

/**
 * The share of fire breaths started while the target was out of the breath's reach (its gap over (reach + 0.6) R), for
 * `attacker` against Gerald in real fights (seeds 1–3, 60 s).
 */
export function breathsOutOfRange(attacker: string): { share: number; breaths: number } {
  let breaths = 0;
  let out = 0;
  for (const seed of [1, 2, 3]) {
    const engine = probeEngine({ fighters: [attacker, "gerald", "random", "random"], match: "1v1", hp: 1000, timeCap: 0, cast: [0.05, 1, 1, 1] }, seed);
    let lastOn = -1;
    probeRun(engine, PROBE_INTRO_MS + 60_000, (v) => {
      const f = v.fighters[0];
      const w = f.weapons.find((x) => x.spec.kind === "fire");
      if (!w) return true;
      if (w.onUntil > lastOn + 1) {
        lastOn = w.onUntil;
        breaths++;
        const t = v.fighters[1];
        const gap = (Math.hypot(t.x - f.x, t.y - f.y) - f.r - t.r) / f.r;
        if (gap > w.spec.reach + 0.6) out++;
      }
    });
  }
  return { share: out / Math.max(1, breaths), breaths };
}

/**
 * Projectiles of a burst gun spawned behind its muzzle (their start along the shot's direction under one radius from the
 * shooter's centre), for `attacker` against Gerald (seeds 1–3, 30 s): wraps the mode's `launch()`.
 */
export function burstSpawnsBehind(attacker: string): { behind: number; rounds: number } {
  let behind = 0;
  let rounds = 0;
  for (const seed of [1, 2, 3]) {
    const engine = probeEngine({ fighters: [attacker, "gerald", "random", "random"], match: "1v1", hp: 1000, timeCap: 0, cast: [0.05, 1, 1, 1] }, seed);
    const mode = engine.fightLeagueMode as unknown as { launch: (p: FlProjectile, f: FlFighter, kind: number, angle: number, ...rest: unknown[]) => void };
    const launch = mode.launch.bind(mode);
    mode.launch = (p, f, kind, angle, ...rest) => {
      launch(p, f, kind, angle, ...rest);
      if (f.slot !== 0) return;
      rounds++;
      if ((p.x - f.x) * Math.cos(angle) + (p.y - f.y) * Math.sin(angle) < f.r) behind++;
    };
    probeRun(engine, PROBE_INTRO_MS + 30_000);
  }
  return { behind, rounds };
}

/** Per division, every pair over the six balance seeds (sides swapped every other seed), as the balance test plays them. */
export const BALANCE_SEEDS = [1, 2, 3, 4, 5, 6].map((s) => ({ seed: 1000 + s * 7919, swap: s % 2 === 0 }));

/** The share of the hits aimed at `id` its shield blocked, over its division's round robin (the balance seeds). */
export function blockShare(id: string): { share: number; blocks: number; taken: number } {
  return memoized(`block ${id}`, () => blockShareUncached(id));
}

function blockShareUncached(id: string): { share: number; blocks: number; taken: number } {
  const row = FL_ROSTER.find((r) => r.id === id)!;
  const rows = FL_ROSTER.filter((r) => r.division === row.division && r.id !== id);
  let blocks = 0;
  let taken = 0;
  for (const other of rows) {
    for (const { seed, swap } of BALANCE_SEEDS) {
      const v = probeDuel(swap ? other.id : id, swap ? id : other.id, seed);
      const f = v.fighters[swap ? 1 : 0];
      blocks += f.blocks;
      taken += f.taken;
    }
  }
  return { share: blocks / Math.max(1, blocks + taken), blocks, taken };
}

/**
 * --- fl-overhaul --- (Stage 2) The tank of `row`'s division to test it against: the first other fighter whose role is tank,
 * else (Fighting games has none) the other fighter with the most HP.
 */
export function divisionTank(row: FlFighterRow): FlFighterRow {
  const mates = FL_ROSTER.filter((r) => r.division === row.division && r.id !== row.id);
  return mates.find((r) => r.role === "tank") ?? [...mates].sort((a, b) => b.stats.hp - a.stats.hp)[0];
}

/** --- fl-overhaul --- (Stage 2) Seconds after FIGHT! of `a`'s first hit on `b` in a real 1v1 (both fighting), Infinity without one within `limitSec`. */
export function duelFirstHitSec(a: string, b: string, seed: number, limitSec = 10): number {
  const engine = probeEngine({ fighters: [a, b, "random", "random"], match: "1v1" }, seed);
  let at = Infinity;
  probeRun(engine, PROBE_INTRO_MS + 1000 * limitSec, (v) => {
    if (v.fighters[0].hits > 0) {
      at = (v.timeMs - PROBE_INTRO_MS) / 1000;
      return true;
    }
  });
  return at;
}
