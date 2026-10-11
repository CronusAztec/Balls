import type { SimulatorSettings } from "@/lib/settings";
import type { BotRecipe, LengthBucket, RecipeContext } from "./playbook";
import { FL_RANDOM } from "@/lib/physics/modes/fightLeague";
import { FL_BY_ID, FL_DIVISIONS, FL_PRESETS, conferenceOf, fightersOf, isFlDivision, type FlDivision } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_UNDERDOG, flWinChance } from "@/lib/physics/modes/fightLeagueShow";

/*
 * --- fl-overhaul --- (Stage 6) The viral bot's Fight League recipes (family "battle"; RECIPES in playbook.ts spreads them):
 *
 *  - fight-duel – "{a} vs {b}: who wins?": a random in-division duel preset or a random pair of one division; the HP count (the
 *    countdown is the HUD's HP bars) paced so the KO lands where the planner wants the payoff; short and standard clips, endings
 *    alternating resolved (the KO at 80–90 % of the clip) and cliffhanger (every side at or under 25 % in the clip's last
 *    seconds and the KO 0.5–1 s after the cut – the both-low-at outcome);
 *  - fight-upset – "{underdog} has a {pct}% chance.": an in-division pair with an underdog (a simulated win chance under 40 %),
 *    resolved only by an upset (the upset outcome); standard clips;
 *  - fight-bracket – "8 fighters. 1 champion.": an 8-bracket of one division (eight fighters or more), short bouts and cards so
 *    the seven bouts fit a long clip;
 *  - fight-boss – "Can Gerald beat all {n} {division} fighters?": Gerald's boss rush against one division, three waves for a
 *    standard clip, five or six for a long one.
 *
 * Every value is concrete (fighter ids, entrant tokens) and on its RANGES step; every choice is seeded – the matchup by the
 * plan seed (`matchup()`, the same for every variant of a clip, so the running episode number per matchup – "Thor vs Loki #3",
 * the series label – can be counted over the days), the rest by the recipe context's generator. Never Math.random. The copy
 * lives under `ViralBot.recipes.fightDuel/fightUpset/fightBracket/fightBoss` (hashtags #ballfight #fightsimulation, a genre tag
 * per conference – never a reference account or a game's name – and #satisfying).
 */

/** Seconds of fighting per 100 HP for an average in-division duel (the divisions' median at the defaults, measured). */
export const FL_BOT_PACE_SEC = 18;
/** A boss rush's bouts are shorter (the boss hits 1.25× as hard with 2.4× the HP): seconds per 100 HP of a challenger's bout. */
export const FL_BOT_BOSS_PACE_SEC = 10;
/**
 * A show's clip runs to its own end (the final KO, the finale and the winner's hold, 4.7 s with the recorder's stop), so its KO
 * reaches the payoff band (80 % of the clip) only from about 19 s: a show is paced for at least this payoff (s).
 */
const SHOW_MIN_PAYOFF_SEC = 20;
/** An upset pairing's underdog has at least this win chance (a long shot that almost never wins makes no clip). */
const UPSET_MIN_CHANCE = 0.3;
/** The VS card before a bout (s). */
const INTRO_SEC = 1.5;
/** A show's interlude: the finale (0.8 s) and the card the bot plays between bouts (s). */
const INTERLUDE_FINALE_SEC = 0.8;
const BOT_CARD_SEC = 1;

/** FNV-1a (as the planner's `hashString`). */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 keyed by the plan seed and a salt (as the planner's `seededRandom`). */
function seeded(planSeed: number, salt: string): () => number {
  let a = hash(`${planSeed}|${salt}`) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pickOf = <T,>(rng: () => number, items: readonly T[]): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

/** The plan seed of a context (a context without one – an old caller – draws it from its generator). */
const planSeedOf = (ctx: RecipeContext) => ctx.planSeed ?? Math.floor(ctx.rng() * 0x7fffffff);

/** The bot's own HP bounds (its planning, not a user's number): a fight long enough to read, short of a feed clip's patience. */
export const FL_BOT_HP_MIN = 15;
export const FL_BOT_HP_MAX = 300;

/** The HP whose fights last about `fightSec` (s after the VS card): whole, inside the bot's bounds. */
export function botPaceHp(fightSec: number, paceSec = FL_BOT_PACE_SEC): number {
  return Math.max(FL_BOT_HP_MIN, Math.min(FL_BOT_HP_MAX, Math.round((100 * Math.max(1, fightSec)) / paceSec)));
}

/** The divisions a duel can come from (two fighters or more; Gerald's Wildcard has one). */
const DUEL_DIVISIONS: readonly FlDivision[] = FL_DIVISIONS.filter((d) => d !== "wildcard" && fightersOf(d).length >= 2);
/** The divisions an 8-bracket of one division can come from. */
export const BRACKET_DIVISIONS: readonly FlDivision[] = FL_DIVISIONS.filter((d) => d !== "wildcard" && fightersOf(d).length >= 8);
/** The in-division duel presets (a duel or a best-of rivalry of two fighters of one division). */
const DUEL_PRESETS = FL_PRESETS.filter((p) => (p.format === "duel" || p.format === "series") && p.fighters.length === 2 && FL_BY_ID.get(p.fighters[0])?.division === FL_BY_ID.get(p.fighters[1])?.division);
/** Every in-division pair with an underdog (a measured win chance under FL_UNDERDOG), in roster order. */
const UPSET_PAIRS: readonly { a: string; b: string; underdog: "a" | "b"; chance: number }[] = (() => {
  const out: { a: string; b: string; underdog: "a" | "b"; chance: number }[] = [];
  for (const d of DUEL_DIVISIONS) {
    const rows = fightersOf(d);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const c = flWinChance([rows[i].id], [rows[j].id]);
        if (c.est) continue;
        if (c.a < FL_UNDERDOG - 1e-9 && c.a >= UPSET_MIN_CHANCE) out.push({ a: rows[i].id, b: rows[j].id, underdog: "a", chance: c.a });
        else if (c.b < FL_UNDERDOG - 1e-9 && c.b >= UPSET_MIN_CHANCE) out.push({ a: rows[i].id, b: rows[j].id, underdog: "b", chance: c.b });
      }
    }
  }
  return out;
})();

export interface FightMatchup {
  /** The matchup's key (the running episode counts per key). */
  key: string;
  a?: string;
  b?: string;
  division: FlDivision;
}

/** fight-duel's matchup for a plan seed: an in-division duel preset or a pair drawn from one division (half the time each). */
export function duelMatchup(planSeed: number): FightMatchup {
  const rng = seeded(planSeed, "fight-duel");
  if (rng() < 0.5 && DUEL_PRESETS.length > 0) {
    const p = pickOf(rng, DUEL_PRESETS);
    const [a, b] = p.fighters;
    return { key: `${a}|${b}`, a, b, division: FL_BY_ID.get(a)!.division };
  }
  const division = pickOf(rng, DUEL_DIVISIONS);
  const rows = fightersOf(division);
  const i = Math.floor(rng() * rows.length) % rows.length;
  let j = Math.floor(rng() * (rows.length - 1)) % (rows.length - 1);
  if (j >= i) j++;
  return { key: `${rows[i].id}|${rows[j].id}`, a: rows[i].id, b: rows[j].id, division };
}

/** fight-upset's matchup: an in-division pair with an underdog. */
export function upsetMatchup(planSeed: number): FightMatchup & { underdog: "a" | "b"; chance: number } {
  const rng = seeded(planSeed, "fight-upset");
  const p = pickOf(rng, UPSET_PAIRS);
  return { key: `${p.a}|${p.b}`, a: p.a, b: p.b, division: FL_BY_ID.get(p.a)!.division, underdog: p.underdog, chance: p.chance };
}

/** fight-bracket's division (eight fighters or more). */
export function bracketMatchup(planSeed: number): FightMatchup {
  const division = pickOf(seeded(planSeed, "fight-bracket"), BRACKET_DIVISIONS);
  return { key: `bracket|${division}`, division };
}

/** fight-boss's division (Gerald's challengers). */
export function bossMatchup(planSeed: number): FightMatchup {
  const division = pickOf(seeded(planSeed, "fight-boss"), DUEL_DIVISIONS);
  return { key: `gerald|${division}`, division };
}

/** The look of a bot fight: the night stage with the neon arena (neon on black, as the playbook's look). */
const FIGHT_LOOK: Partial<SimulatorSettings> = { flStage: "night", flArenaStyle: "neon", flHud: true, flSameDivision: true, flBestOf: 1, flOdds: true };

/** The random slots of a show (nothing pinned: the entrants come from the list). */
const RANDOM_SLOTS: Partial<SimulatorSettings> = { flFighterA: FL_RANDOM, flFighterB: FL_RANDOM, flFighterC: FL_RANDOM, flFighterD: FL_RANDOM, flFighterE: FL_RANDOM, flFighterF: FL_RANDOM };

/** A duel's fight time for the payoff the planner wants (a little seeded spread across variants). */
function duelFightSec(ctx: RecipeContext): number {
  return Math.max(4, ctx.payoffTarget - INTRO_SEC) * (0.9 + 0.2 * ctx.rng());
}

/** The division a fight's settings play in (slot A's, or the entrants' token). */
export function fightDivisionOf(s: Pick<SimulatorSettings, "flMatch" | "flFighterA" | "flEntrants">): FlDivision {
  if (s.flMatch === "bracket" || s.flMatch === "boss") {
    const id = (s.flEntrants || "").split(",")[0]?.split(":")[1];
    if (isFlDivision(id)) return id;
  }
  return FL_BY_ID.get(s.flFighterA)?.division ?? "marvel";
}

const nameOf = (id: string) => FL_BY_ID.get(id)?.name ?? id;

/** The copy variables of a fight's division: its name (`ViralBot.fightDivisions`) and its genre tag (`ViralBot.fightTags`). */
function divisionCopyVars(s: SimulatorSettings): Record<string, string> {
  const d = fightDivisionOf(s);
  return { division: `fightDivisions.${d}`, divisionTag: `fightTags.${conferenceOf(d) ?? "other"}` };
}

const DUEL_BUCKETS: readonly LengthBucket[] = ["short", "standard"];

export const FIGHT_RECIPES: readonly BotRecipe[] = [
  {
    id: "fight-duel",
    copyKey: "fightDuel",
    family: "battle",
    modes: ["fightLeague"],
    payoff: "winner",
    countdown: { kind: "hp", source: "hud" },
    strategy: "winner",
    musicFirst: true,
    buckets: DUEL_BUCKETS,
    matchup: duelMatchup,
    settings: (ctx) => {
      const m = duelMatchup(planSeedOf(ctx));
      return { mode: "fightLeague", ...FIGHT_LOOK, flMatch: "1v1", flFighterA: m.a!, flFighterB: m.b!, flHp: botPaceHp(duelFightSec(ctx)) };
    },
    hookVars: (s) => ({ a: nameOf(s.flFighterA), b: nameOf(s.flFighterB), pct: Math.round(100 * flWinChance([s.flFighterA], [s.flFighterB]).a) }),
    copyVars: divisionCopyVars,
  },
  {
    id: "fight-upset",
    copyKey: "fightUpset",
    family: "battle",
    modes: ["fightLeague"],
    payoff: "winner",
    countdown: { kind: "hp", source: "hud" },
    strategy: "winner",
    musicFirst: true,
    outcome: "upset",
    endings: ["resolved"],
    buckets: ["standard"],
    matchup: upsetMatchup,
    settings: (ctx) => {
      const m = upsetMatchup(planSeedOf(ctx));
      return { mode: "fightLeague", ...FIGHT_LOOK, flMatch: "1v1", flFighterA: m.a!, flFighterB: m.b!, flHp: botPaceHp(duelFightSec(ctx)) };
    },
    hookVars: (s) => {
      const c = flWinChance([s.flFighterA], [s.flFighterB]);
      const aUnder = c.a <= c.b;
      return { a: nameOf(s.flFighterA), b: nameOf(s.flFighterB), underdog: nameOf(aUnder ? s.flFighterA : s.flFighterB), favourite: nameOf(aUnder ? s.flFighterB : s.flFighterA), pct: Math.round(100 * Math.min(c.a, c.b)) };
    },
    copyVars: divisionCopyVars,
  },
  {
    id: "fight-bracket",
    copyKey: "fightBracket",
    family: "battle",
    modes: ["fightLeague"],
    payoff: "winner",
    countdown: { kind: "hp", source: "hud" },
    strategy: "winner",
    musicFirst: true,
    endings: ["resolved"],
    buckets: ["long"],
    matchup: bracketMatchup,
    settings: (ctx) => {
      const m = bracketMatchup(planSeedOf(ctx));
      const bouts = 7;
      const fightSec = Math.max(3, Math.max(SHOW_MIN_PAYOFF_SEC, ctx.payoffTarget) / bouts - INTRO_SEC - INTERLUDE_FINALE_SEC - BOT_CARD_SEC) * (0.9 + 0.2 * ctx.rng());
      return { mode: "fightLeague", ...FIGHT_LOOK, ...RANDOM_SLOTS, flMatch: "bracket", flBracketSize: 8, flEntrants: `division:${m.division}`, flSeeding: "rating", flCardSec: BOT_CARD_SEC, flHp: botPaceHp(fightSec) };
    },
    hookVars: (s) => ({ n: Math.round(s.flBracketSize) }),
    copyVars: divisionCopyVars,
  },
  {
    id: "fight-boss",
    copyKey: "fightBoss",
    family: "battle",
    modes: ["fightLeague"],
    payoff: "winner",
    countdown: { kind: "hp", source: "hud" },
    strategy: "winner",
    musicFirst: true,
    endings: ["resolved"],
    buckets: ["standard", "long"],
    matchup: bossMatchup,
    settings: (ctx) => {
      const m = bossMatchup(planSeedOf(ctx));
      const waves = ctx.bucket === "long" ? 5 + (ctx.rng() < 0.5 ? 0 : 1) : 3;
      const fightSec = Math.max(3, Math.max(SHOW_MIN_PAYOFF_SEC, ctx.payoffTarget) / waves - INTRO_SEC - INTERLUDE_FINALE_SEC - BOT_CARD_SEC) * (0.9 + 0.2 * ctx.rng());
      return { mode: "fightLeague", ...FIGHT_LOOK, ...RANDOM_SLOTS, flFighterA: "gerald", flMatch: "boss", flEntrants: `random:${m.division}`, flBossWaves: waves, flCardSec: BOT_CARD_SEC, flHp: botPaceHp(fightSec, FL_BOT_BOSS_PACE_SEC) };
    },
    hookVars: (s) => ({ boss: nameOf(s.flFighterA), n: Math.round(s.flBossWaves) }),
    copyVars: divisionCopyVars,
  },
];
