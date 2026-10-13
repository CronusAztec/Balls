import type { PhysicsEngine } from "@/lib/physics/engine";
import { defaultSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { fightLeagueSettingsOf, resolveFightLeagueSettings, type FightLeagueSettings } from "@/lib/physics/modes/fightLeague";
import { buildCustomFighter, type CustomFighterSpec } from "@/lib/physics/modes/fightLeagueCustom";
import { FL_BY_ID, addTemporaryFighter } from "@/lib/physics/modes/fightLeagueRoster";

/*
 * --- custom-content --- Balancing a fighter the player's AI made. The built-in roster was tuned by playing fights (the damage
 * stat is the tuner's knob: tests/fightLeague.test.ts, scripts/fl-balance.mjs); a custom fighter gets the same treatment when it
 * is made. Quick headless duels – the engine the page and the Find Simulation feature run, on the fixed 60 Hz step – against a
 * panel of twelve built-in fighters from eight divisions, each pair on both sides of the arena, with fixed seeds (so the result is
 * repeatable). A win counts 1, a draw or a double KO a half. The damage stat is bisected until the fighter wins about as often
 * as an average built-in one (the built-ins win 6 %–83 % of such duels, 40 % in the middle); a fighter that is still too
 * strong at the lowest damage also gets less cast speed and health, and one that is still hopeless at the highest is left as
 * the player's weak-but-fun creation.
 */

/** The panel: twelve built-in fighters from eight divisions (Marvel, DC, Nintendo, Shonen, Fighting games, Star Wars, Game legends, Sandbox). */
export const BALANCE_PANEL: readonly string[] = ["gerald", "thor", "mario", "goku", "naruto", "batman", "ryu", "luke", "vader", "hulk", "sonic", "kratos"];
/** Seeds 1–2 play the new fighter as slot A, seeds 3–4 as slot B. */
export const BALANCE_SEEDS: readonly number[] = [1, 2, 3, 4];
/** The win rate the balancer aims for, and the window it accepts. */
export const BALANCE_TARGET = 0.44;
export const BALANCE_WINDOW: readonly [number, number] = [0.3, 0.58];

const WORLD = { width: 800, height: 450 };
const STEP = 1000 / 60;
const MAX_MS = 200_000;

function engineFor(fl: Partial<FightLeagueSettings>, seed: number): PhysicsEngine {
  const s = defaultSettings("fightLeague");
  const config = physicsConfigOfSettings(s, WORLD);
  const modeSettings: ModeSettings = { ...modeSettingsOfSettings(s), fightLeague: resolveFightLeagueSettings({ ...fightLeagueSettingsOf(s), ...fl }) };
  return createEngineForSettings(config, "fightLeague", modeSettings, seed);
}

/** 1 if `id` won the duel against `opponent`, 0 if it lost, ½ for a draw (it plays slot A for odd seeds' pairs, slot B for the others). */
export function duelScore(id: string, opponent: string, seed: number, asSlotA: boolean): number {
  const fighters = asSlotA ? [id, opponent, "random", "random"] : [opponent, id, "random", "random"];
  const engine = engineFor({ fighters, match: "1v1", timeCap: 60 }, seed);
  const v = engine.getFightLeagueView();
  while (engine.getElapsedMs() < MAX_MS && !engine.isSimulationFinished()) {
    engine.update(STEP, 0);
    engine.consumeSoundEvents();
  }
  if (v.doubleKo || (v.winnerTeam !== 0 && v.winnerTeam !== 1)) return 0.5;
  return v.winnerTeam === (asSlotA ? 0 : 1) ? 1 : 0;
}

/** The fighter's win rate over the panel and the seeds (the row must be findable by id: `withTemporaryFighter`). */
export function panelWinRate(id: string, panel: readonly string[] = BALANCE_PANEL, seeds: readonly number[] = BALANCE_SEEDS): number {
  let score = 0;
  let games = 0;
  for (const opponent of panel) {
    if (!FL_BY_ID.has(opponent) || opponent === id) continue;
    for (const [i, seed] of seeds.entries()) {
      score += duelScore(id, opponent, seed, i < seeds.length / 2);
      games++;
    }
  }
  return games ? score / games : BALANCE_TARGET;
}

/** `panelWinRate`, giving the page a turn (`yieldNow`) every few duels so it stays responsive; `signal` aborts with Error("cancelled"). */
async function panelWinRateAsync(id: string, yieldNow: () => Promise<void>, signal?: AbortSignal): Promise<number> {
  let score = 0;
  let games = 0;
  for (const opponent of BALANCE_PANEL) {
    if (!FL_BY_ID.has(opponent) || opponent === id) continue;
    for (const [i, seed] of BALANCE_SEEDS.entries()) {
      if (signal?.aborted) throw new Error("cancelled");
      score += duelScore(id, opponent, seed, i < BALANCE_SEEDS.length / 2);
      games++;
      if (games % 3 === 0) await yieldNow();
    }
  }
  return games ? score / games : BALANCE_TARGET;
}

export interface BalanceResult {
  spec: CustomFighterSpec;
  /** The win rate with the stats the spec had, and with those it was left with. */
  before: number;
  after: number;
  /** The stats were set by the balancer (always, unless the spec could not be built). */
  adjusted: boolean;
}

export interface BalanceOptions {
  signal?: AbortSignal;
  /** Called with (evaluations done, evaluations at most) after each one. */
  onProgress?: (done: number, total: number) => void;
  /** Awaited between evaluations (the page yields a frame); default: a macrotask. */
  yieldNow?: () => Promise<void>;
}

const MAX_EVALS = 9;

/**
 * The strength scale: 0 is the weakest a custom fighter may be, 1 the strongest. It sets the three stats that are pure power –
 * damage (× 0.45 … 2.4), attack speed (× 0.85 … 1.25) and cast speed (× 0.7 … 1.3), the three of which the built-in roster tunes
 * – while health, speed and size stay as the AI (or the player) chose them, within the role's template.
 */
export function strengthStats(s: number): { damage: number; attackSpeed: number; castSpeed: number } {
  const t = Math.min(1, Math.max(0, s));
  return {
    damage: Math.round(0.45 * Math.pow(2.4 / 0.45, t) * 100) / 100,
    attackSpeed: Math.round((0.85 + 0.4 * t) * 100) / 100,
    castSpeed: Math.round((0.7 + 0.6 * t) * 100) / 100,
  };
}

/**
 * Brings `spec` to a fair strength: the win rate over the panel is measured at the middle of the strength scale, then the scale is
 * bisected (a win rate rises with strength) until it lands in the window; the closest evaluation is kept. A fighter that is too
 * strong even at 0 or too weak even at 1 is left at that end. Resolves with the spec carrying the balanced stats; rejects with
 * Error("cancelled") when `signal` aborts. Nothing but those three stats is touched.
 */
export async function balanceCustomFighter(spec: CustomFighterSpec, options: BalanceOptions = {}): Promise<BalanceResult> {
  const yieldNow = options.yieldNow ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let evals = 0;
  const other = (id: string | undefined) => new Set([...FL_BY_ID.keys()].filter((k) => k !== id));

  const rateAt = async (t: number): Promise<{ spec: CustomFighterSpec; rate: number } | null> => {
    if (options.signal?.aborted) throw new Error("cancelled");
    const candidate: CustomFighterSpec = { ...spec, stats: { ...spec.stats, ...strengthStats(t) } };
    const built = buildCustomFighter(candidate, other(candidate.id));
    if (!built.ok) return null;
    const remove = addTemporaryFighter(built.row);
    let rate: number;
    try {
      rate = await panelWinRateAsync(built.row.id, yieldNow, options.signal);
    } finally {
      remove();
    }
    evals++;
    options.onProgress?.(evals, MAX_EVALS);
    return { spec: built.spec, rate };
  };

  const original = buildCustomFighter(spec, other(spec.id));
  let before = BALANCE_TARGET;
  if (original.ok) {
    const remove = addTemporaryFighter(original.row);
    try {
      before = await panelWinRateAsync(original.row.id, yieldNow, options.signal);
    } finally {
      remove();
    }
  }
  let best = await rateAt(0.5);
  if (!best) return { spec, before, after: before, adjusted: false };
  let lo = 0;
  let hi = 1;
  let t = 0.5;
  for (let i = 1; i < MAX_EVALS; i++) {
    if (best.rate >= BALANCE_WINDOW[0] && best.rate <= BALANCE_WINDOW[1]) break;
    if (best.rate > BALANCE_WINDOW[1]) hi = t;
    else lo = t;
    t = (lo + hi) / 2;
    const next = await rateAt(t);
    if (!next) break;
    // (a tie goes to the later evaluation: the bisection only moves toward the window)
    if (Math.abs(next.rate - BALANCE_TARGET) <= Math.abs(best.rate - BALANCE_TARGET)) best = next;
  }
  // (the ends of the scale, when the window was never reached: the extreme tried is kept if it was the closest)
  if (best.rate > BALANCE_WINDOW[1] || best.rate < BALANCE_WINDOW[0]) {
    const end = await rateAt(best.rate > BALANCE_WINDOW[1] ? 0 : 1);
    if (end && Math.abs(end.rate - BALANCE_TARGET) <= Math.abs(best.rate - BALANCE_TARGET)) best = end;
  }
  return { spec: best.spec, before, after: best.rate, adjusted: true };
}
