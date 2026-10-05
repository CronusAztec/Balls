import type { FlStats } from "../fightLeagueRoster";

/**
 * --- fl-overhaul --- The row files' shared helper (Fight League, fightLeagueRows/<division>.ts): a fighter's stats with every
 * multiplier the row leaves out at the league's 1 (hp 100 %). Only types come from the roster index, so the rows never import
 * a value back from it (no import cycle).
 */
export const S = (o: Partial<FlStats> = {}): FlStats => ({ hp: 100, speed: 1, attackSpeed: 1, damage: 1, castSpeed: 1, size: 1, ...o });
