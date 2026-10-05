import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { FL_DIVISIONS, fightersOf, flDivisionHash, isFlDivision, type FlDivision, type FlFighterRow } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_INTRO_MS } from "@/lib/physics/modes/fightLeague";
import { BALANCE_SEEDS, median, probeDuel } from "../flProbes";

/**
 * --- fl-overhaul --- (Stage 2) The Fight League balance TUNER – a tool, not a check: skipped unless FL_TUNE=1 (never set in
 * CI). scripts/fl-balance.mjs runs one child per division (`FL_TUNE=1 FL_TUNE_DIVISIONS=<division> npx vitest run
 * tests/tools/flBalanceTune.test.ts`); each plays its division's round robin on the 16 TRAIN seeds (50000 + k·104729, disjoint
 * from the balance test's 6, sides swapped every other seed) in both arenas, and updates every fighter's damage stat
 *
 *   dmg ×= clamp((0.5 / rate)^(0.4 · 0.85^it + 0.12), 0.75, 1.33) × clamp((median TTK / 17 s)^0.7, 0.85, 1.18)
 *
 * (rate: its train win share, a draw half; TTK: the fights' length after FIGHT!), the damage kept in [0.3, 2.6] and rounded to
 * two decimals, for at most 18 iterations – stopping as soon as every fighter wins 40–60 % with a median TTK of 12–25 s. It
 * then plays the TEST seeds (the balance test's) and writes scripts/out/fl-balance/<division>.json: the patch, the train and
 * test win tables, the median TTKs, the share of fights at the cap, the pinned fighters (a damage at a clamp, or a train rate
 * outside 40–60 %), a Bradley–Terry strength per fighter (test seeds, geometric mean 1) and the divisions' fingerprints.
 */

const TUNE = process.env.FL_TUNE === "1";
const OUT_DIR = path.join(__dirname, "..", "..", "scripts", "out", "fl-balance");
const TRAIN_SEEDS = Array.from({ length: 16 }, (_, k) => ({ seed: 50000 + k * 104729, swap: k % 2 === 1 }));
const ARENAS = (process.env.FL_TUNE_ARENAS ?? "square,circle").split(",").filter((a): a is "square" | "circle" => a === "square" || a === "circle");
const MAX_IT = Number(process.env.FL_TUNE_MAX_IT ?? 18);
const DMG_MIN = 0.3;
const DMG_MAX = 2.6;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

interface RoundRobin {
  rate: Map<string, number>;
  ttk: number[];
  capped: number;
  games: number;
  /** a|b → [a's wins, b's wins] (a draw half each), a before b in roster order. */
  pairs: Map<string, [number, number]>;
}

/** A turn of the event loop: the worker answers vitest's calls between pairs (a long synchronous run times its RPC out). */
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve));

async function roundRobin(rows: FlFighterRow[], seeds: readonly { seed: number; swap: boolean }[], arenas: readonly ("square" | "circle")[]): Promise<RoundRobin> {
  const wins = new Map<string, number>();
  const games = new Map<string, number>();
  const pairs = new Map<string, [number, number]>();
  const ttk: number[] = [];
  let capped = 0;
  let total = 0;
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const key = `${rows[i].id}|${rows[j].id}`;
      const pair: [number, number] = [0, 0];
      for (const arena of arenas) {
        for (const { seed, swap } of seeds) {
          const a = swap ? rows[j].id : rows[i].id;
          const b = swap ? rows[i].id : rows[j].id;
          const v = probeDuel(a, b, seed, { arena });
          total++;
          ttk.push(Math.max(0, v.finishMs - FL_INTRO_MS) / 1000);
          if (v.byTime) capped++;
          games.set(a, (games.get(a) ?? 0) + 1);
          games.set(b, (games.get(b) ?? 0) + 1);
          const share = v.winnerTeam === 0 ? [1, 0] : v.winnerTeam === 1 ? [0, 1] : [0.5, 0.5];
          wins.set(a, (wins.get(a) ?? 0) + share[0]);
          wins.set(b, (wins.get(b) ?? 0) + share[1]);
          pair[swap ? 1 : 0] += share[0];
          pair[swap ? 0 : 1] += share[1];
        }
      }
      pairs.set(key, pair);
      await breathe();
    }
  }
  const rate = new Map(rows.map((r) => [r.id, (wins.get(r.id) ?? 0) / Math.max(1, games.get(r.id) ?? 0)]));
  return { rate, ttk, capped, games: total, pairs };
}

/** Bradley–Terry strengths from pairwise wins (a half win each way as a prior), normalised to a geometric mean of 1. */
function bradleyTerry(rows: FlFighterRow[], pairs: Map<string, [number, number]>): Map<string, number> {
  const ids = rows.map((r) => r.id);
  const s = new Map(ids.map((id) => [id, 1]));
  const w = new Map<string, number>(ids.map((id) => [id, 0]));
  const n = new Map<string, number>();
  for (const [key, [wa, wb]] of pairs) {
    const [a, b] = key.split("|");
    w.set(a, w.get(a)! + wa + 0.5);
    w.set(b, w.get(b)! + wb + 0.5);
    n.set(key, wa + wb + 1);
  }
  for (let it = 0; it < 300; it++) {
    const next = new Map<string, number>();
    for (const i of ids) {
      let den = 0;
      for (const j of ids) {
        if (i === j) continue;
        const key = ids.indexOf(i) < ids.indexOf(j) ? `${i}|${j}` : `${j}|${i}`;
        den += (n.get(key) ?? 0) / (s.get(i)! + s.get(j)!);
      }
      next.set(i, den > 0 ? w.get(i)! / den : 1);
    }
    const g = Math.exp(ids.reduce((acc, id) => acc + Math.log(next.get(id)!), 0) / ids.length);
    for (const id of ids) s.set(id, next.get(id)! / g);
  }
  return s;
}

const pct = (x: number) => Math.round(1000 * x) / 1000;

describe.skipIf(!TUNE)("fight league balance tuner (a tool: FL_TUNE=1, scripts/fl-balance.mjs)", () => {
  const wanted = (process.env.FL_TUNE_DIVISIONS ?? "").split(",").filter((d): d is FlDivision => isFlDivision(d) && d !== "wildcard");
  const divisions = wanted.length > 0 ? wanted : FL_DIVISIONS.filter((d) => d !== "wildcard");
  for (const division of divisions) {
    it(`tunes ${division}`, { timeout: 4 * 3_600_000 }, async () => {
      const rows = fightersOf(division);
      const before = Object.fromEntries(rows.map((r) => [r.id, r.stats.damage]));
      const started = Date.now();
      const log: string[] = [];
      let it = 0;
      let train: RoundRobin = await roundRobin(rows, TRAIN_SEEDS, ARENAS);
      for (;;) {
        const med = median(train.ttk);
        const rates = rows.map((r) => train.rate.get(r.id)!);
        log.push(`it ${it}: TTK ${med.toFixed(1)} s, ${rows.map((r) => `${r.id} ${(100 * train.rate.get(r.id)!).toFixed(0)}% ×${r.stats.damage}`).join(", ")}`);
        const converged = rates.every((x) => x >= 0.4 && x <= 0.6) && med >= 12 && med <= 25;
        if (converged || it >= MAX_IT) break;
        const exp = 0.4 * 0.85 ** it + 0.12;
        const ttkFactor = clamp((med / 17) ** 0.7, 0.85, 1.18);
        for (const r of rows) {
          const rate = train.rate.get(r.id)!;
          const k = clamp((0.5 / Math.max(1e-9, rate)) ** exp, 0.75, 1.33) * ttkFactor;
          (r.stats as { damage: number }).damage = Math.round(100 * clamp(r.stats.damage * k, DMG_MIN, DMG_MAX)) / 100;
        }
        it++;
        train = await roundRobin(rows, TRAIN_SEEDS, ARENAS);
      }
      const test: Record<string, Record<string, number>> = {};
      const testTtk: Record<string, number> = {};
      const testCap: Record<string, number> = {};
      const allPairs = new Map<string, [number, number]>();
      for (const arena of ["square", "circle"] as const) {
        const rr = await roundRobin(rows, BALANCE_SEEDS, [arena]);
        test[arena] = Object.fromEntries(rows.map((r) => [r.id, pct(rr.rate.get(r.id)!)]));
        testTtk[arena] = Math.round(10 * median(rr.ttk)) / 10;
        testCap[arena] = pct(rr.capped / Math.max(1, rr.games));
        for (const [key, [a, b]] of rr.pairs) {
          const p = allPairs.get(key) ?? [0, 0];
          allPairs.set(key, [p[0] + a, p[1] + b]);
        }
      }
      const bt = bradleyTerry(rows, allPairs);
      const pinned = rows.filter((r) => r.stats.damage <= DMG_MIN || r.stats.damage >= DMG_MAX || train.rate.get(r.id)! < 0.4 || train.rate.get(r.id)! > 0.6).map((r) => r.id);
      const testWin = Object.fromEntries(rows.map((r) => [r.id, pct((test.square[r.id] + test.circle[r.id]) / 2)]));
      const report = {
        division,
        arenas: ARENAS,
        iterations: it,
        seconds: Math.round((Date.now() - started) / 1000),
        before,
        patch: Object.fromEntries(rows.map((r) => [r.id, r.stats.damage])),
        train: Object.fromEntries(rows.map((r) => [r.id, pct(train.rate.get(r.id)!)])),
        trainTtk: Math.round(10 * median(train.ttk)) / 10,
        trainCap: pct(train.capped / Math.max(1, train.games)),
        test,
        testWin,
        testTtk,
        testCap,
        strength: Object.fromEntries(rows.map((r) => [r.id, pct(bt.get(r.id)!)])),
        pinned,
        divisions: [...FL_DIVISIONS],
        hashes: Object.fromEntries(FL_DIVISIONS.map((d) => [d, flDivisionHash(d)])),
        log,
      };
      fs.mkdirSync(OUT_DIR, { recursive: true });
      fs.writeFileSync(path.join(OUT_DIR, `${division}.json`), JSON.stringify(report, null, 2));
      console.log(`tuned ${division} in ${report.seconds} s (${it} iterations): ${log[log.length - 1]}`);
      expect(rows.length).toBeGreaterThan(1);
    });
  }
});

