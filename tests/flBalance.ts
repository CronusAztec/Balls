/**
 * --- fl-overhaul --- (Stage 2) The Fight League BALANCE gate (a helper, not a test file): per division every pair of its
 * fighters over the six BALANCE_SEEDS of tests/flProbes.ts (the sides swapped every other seed, a draw half a win), in the
 * square and in the circle, a 60 s cap from FIGHT! (then sudden death). Every fighter wins 25–75 % of its matches in each
 * arena, the division's median fight lasts 12–25 s after FIGHT! and at most 2 % of its duels reach the cap. The 18 division
 * tests live in three files (tests/fightLeagueBalance*.test.ts, by conference) so vitest runs them in parallel; the damage
 * stats they judge are tuned by scripts/fl-balance.mjs on other seeds (its TRAIN seeds).
 */
import { describe, expect, it } from "vitest";
import { FL_INTRO_MS } from "@/lib/physics/modes/fightLeague";
import { FL_DIVISION_LABELS, fightersOf, type FlDivision } from "@/lib/physics/modes/fightLeagueRoster";
import { BALANCE_SEEDS, median, probeDuel } from "./flProbes";

const ARENAS = ["square", "circle"] as const;

export function defineBalanceTests(divisions: readonly FlDivision[]) {
  describe("fight league balance (per division round robin, 6 seeds, both arenas, a 60 s cap)", () => {
    for (const division of divisions) {
      it(`keeps every ${FL_DIVISION_LABELS[division]} fighter between 25 % and 75 % of its matches in both arenas, the median fight 12–25 s, at most 2 % at the cap`, { timeout: 120_000 }, () => {
        const rows = fightersOf(division);
        const ttk: number[] = [];
        let capped = 0;
        let games = 0;
        const lines: string[] = [];
        const fails: string[] = [];
        for (const arena of ARENAS) {
          const wins = new Map<string, number>();
          const played = new Map<string, number>();
          for (let i = 0; i < rows.length; i++) {
            for (let j = i + 1; j < rows.length; j++) {
              for (const { seed, swap } of BALANCE_SEEDS) {
                const a = swap ? rows[j].id : rows[i].id;
                const b = swap ? rows[i].id : rows[j].id;
                const v = probeDuel(a, b, seed, { arena });
                expect(v.finished).toBe(true);
                games++;
                if (v.byTime) capped++;
                ttk.push(Math.max(0, v.finishMs - FL_INTRO_MS) / 1000);
                played.set(a, (played.get(a) ?? 0) + 1);
                played.set(b, (played.get(b) ?? 0) + 1);
                const [wa, wb] = v.winnerTeam === 0 ? [1, 0] : v.winnerTeam === 1 ? [0, 1] : [0.5, 0.5];
                wins.set(a, (wins.get(a) ?? 0) + wa);
                wins.set(b, (wins.get(b) ?? 0) + wb);
              }
            }
          }
          const table = rows.map((r) => ({ name: r.name, id: r.id, rate: (wins.get(r.id) ?? 0) / Math.max(1, played.get(r.id) ?? 0) }));
          lines.push(`${arena}: ${table.map((t) => `${t.name} ${(100 * t.rate).toFixed(0)}%`).join(", ")}`);
          for (const t of table) if (t.rate < 0.25 || t.rate > 0.75) fails.push(`${t.id} ${(100 * t.rate).toFixed(1)}% (${arena})`);
        }
        const med = median(ttk);
        console.log(`win table ${FL_DIVISION_LABELS[division]} – median fight ${med.toFixed(1)} s, ${capped}/${games} at the cap\n  ${lines.join("\n  ")}`);
        expect(fails).toEqual([]);
        expect([division, med >= 12 && med <= 25]).toEqual([division, true]);
        expect([division, capped / games <= 0.02]).toEqual([division, true]);
      });
    }
  });
}
