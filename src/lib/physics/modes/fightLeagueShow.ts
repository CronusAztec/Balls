import { FL_BY_ID, FL_CONFERENCES, FL_DIVISIONS, FL_ROSTER, conferenceOf, fightersOf, fightersOfConference, isFlConference, isFlDivision, type FlConference, type FlDivision, type FlFighterRow } from "./fightLeagueRoster";
import { FL_STRENGTH } from "./fightLeagueRatings";

/**
 * --- fl-overhaul --- (Stage 5) Fight League's match types as shows – pure maths the mode (fightLeague.ts), the panel, the
 * renderer and the tests share (no DOM, no clock, every random number from the `random` they are handed: the mode passes
 * `ctx.random()`):
 *
 *  - **best-of-N series** (`flBestOfGames()`: a whole number from 1, an even one rounds up to the next odd; first to
 *    ⌈n/2⌉ wins – `flSeriesNeed()` –, at most n + 2 games – `flSeriesMaxGames()` – then the higher total HP share),
 *  - **brackets**: the entrants (`parseFlEntrants()` reads the comma-separated list of ids and tokens – a fighter id,
 *    `random`, `random:<division>`, `random:<conference>`, `division:<id>` and `conference:<id>` listing a whole one in roster
 *    order – and `drawFlEntrants()` builds the list: the pinned fighters first, then the tokens, then draws from the pool, a
 *    division short of fighters filling from its conference and never beyond it), the seeding (`flSeedOrder()`: by rating,
 *    random or as listed), the standard placement (`flSeedPlacement()`: 1v8, 4v5, 3v6, 2v7; byes to the top seeds) and the
 *    rounds (`flBuildBracket()`, `flAdvanceBracket()`, `flNextBout()`, `flRoundCode()`),
 *  - **boss rush** numbers (`FL_BOSS`),
 *  - the **win chance** (`flWinChances()`: Σs ÷ Σs of the sides from the tuner's ratings – `FL_STRENGTH` –, every fighter of an
 *    unmeasured pairing – a cross-division match, Gerald – at strength 1; teams, Gerald and unmeasured pairs marked `est`),
 *  - the **story**'s thresholds and the winner card's tag order (`flStoryTags()`).
 */

/* ------------------------------------------------------------------ the shows */

/** The kinds of show a run plays: one match, a best-of-N series, a bracket, a boss rush. */
export const FL_SHOW_KINDS = ["single", "series", "bracket", "boss"] as const;
export type FlShowKind = (typeof FL_SHOW_KINDS)[number];

/** The phases of a show's match: the VS card, the fight, the KO finale, the interlude's card, the show's end. */
export type FlShowPhase = "intro" | "fight" | "finale" | "card" | "done";

/** The memory-safety ceiling of a bracket's and a boss rush's entrants (a row each; `MEMORY_CEILINGS.flBracketSize`, `.flBossWaves`). */
export const FL_ENTRANT_CEILING = 256;
/** A show's interlude: the KO finale's slow motion is this long (ms) between matches (the show's last match: the full FL_FINALE_MS). */
export const FL_INTERLUDE_FINALE_MS = 800;
/** The interlude's card (s) by default (`flCardSec`, URL flCard). */
export const FL_CARD_SEC = 2.5;
/** A bracket's bout: its time cap (s) at most this (`min(flT, 45)`; with flT 0 – no cap – this), and always sudden death. */
export const FL_BOUT_CAP_SEC = 45;
/** A draw or a double KO inside a bracket or a boss rush replays the pairing (REMATCH!) at most this many times. */
export const FL_REMATCHES = 2;
/** The finder follows a show this long a bout (s) at least: `maxSimTimeSec` scaled by the bouts (Stage 5). */
export const FL_SHOW_BOUT_SEC = 90;
/** The default bracket size and boss waves (`flBracketSize`, `flBossWaves`). */
export const FL_BRACKET_SIZE = 8;
export const FL_BOSS_WAVES = 6;
/** A 3v3's fighters are this size (× their row's), so six fit the arena. */
export const FL_3V3_SIZE = 0.85;

/**
 * The boss of a boss rush: its HP × `hp` (flBoss), its ball × `size`, its damage × `damage`; it heals `heal` of its maximum HP in
 * every interlude (flBh) and at `phase2` of its HP PHASE 2 begins (speed × `phase2Speed`, cast speed × `phase2Cast`) for the rest of
 * the rush. The defaults are tuned so Gerald clears a 6-wave Marvel rush in 30–70 % of the seeds (the spec's 3 and 0.2 made him clear
 * all 20 test seeds; 2.4 and 0.15 clear 9 of 20 – tests/fightLeagueMatches.test.ts).
 */
export const FL_BOSS = { hp: 2.4, size: 1.5, damage: 1.25, heal: 0.15, phase2: 0.5, phase2Speed: 1.15, phase2Cast: 1.2 } as const;

/** Bracket seedings (URL flSd): by the ratings (`FL_STRENGTH`), by the seed, or in the order listed (the pinned slots first). */
export const FL_SEEDINGS = ["rating", "random", "listed"] as const;
export type FlSeeding = (typeof FL_SEEDINGS)[number];
export function isFlSeeding(value: unknown): value is FlSeeding {
  return typeof value === "string" && (FL_SEEDINGS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ series */

/** A series' length: a whole number of games from 1 (no maximum); an even one rounds up to the next odd (a Bo4 plays as a Bo5). */
export function flBestOfGames(value: number): number {
  if (!Number.isFinite(value)) return 1;
  const n = Math.max(1, Math.round(value));
  return n % 2 === 0 ? n + 1 : n;
}

/** Wins that take a best-of-`n` series: ⌈n/2⌉. */
export function flSeriesNeed(bestOf: number): number {
  return Math.ceil(flBestOfGames(bestOf) / 2);
}

/** The most games a best-of-`n` series plays (a draw or a double KO counts for nobody and adds a game): n + 2. */
export function flSeriesMaxGames(bestOf: number): number {
  return flBestOfGames(bestOf) + 2;
}

/** A side of a series at `wins` can clinch with the next game. */
export function flCanClinch(wins: number, bestOf: number): boolean {
  return wins === flSeriesNeed(bestOf) - 1;
}

/* ------------------------------------------------------------------ entrants */

export const FL_DIVISION_TOKEN = "division:";
export const FL_CONFERENCE_TOKEN = "conference:";
const RANDOM = "random";
const RANDOM_PREFIX = "random:";

/** Case-insensitive lookups of every id a token may name (division ids are camelCase: starWars, modernAnime). */
const ID_LOWER = new Map<string, string>(FL_ROSTER.map((r) => [r.id.toLowerCase(), r.id]));
const DIVISION_LOWER = new Map<string, FlDivision>(FL_DIVISIONS.map((d) => [d.toLowerCase(), d]));
const CONFERENCE_LOWER = new Map<string, FlConference>((Object.keys(FL_CONFERENCES) as FlConference[]).map((c) => [c.toLowerCase(), c]));

/**
 * One entrant token in its canonical spelling, or null: a fighter id, `random`, `random:<division>` / `random:<conference>`
 * (Wildcard is no random scope: Gerald is chosen, never drawn), `division:<id>` or `conference:<id>` (case and spaces forgiven).
 */
export function flEntrantToken(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t === RANDOM) return RANDOM;
  const id = ID_LOWER.get(t);
  if (id) return id;
  if (t.startsWith(RANDOM_PREFIX)) {
    const rest = t.slice(RANDOM_PREFIX.length);
    const d = DIVISION_LOWER.get(rest);
    if (d && d !== "wildcard") return RANDOM_PREFIX + d;
    const c = CONFERENCE_LOWER.get(rest);
    return c ? RANDOM_PREFIX + c : null;
  }
  if (t.startsWith(FL_DIVISION_TOKEN)) {
    const d = DIVISION_LOWER.get(t.slice(FL_DIVISION_TOKEN.length));
    return d ? FL_DIVISION_TOKEN + d : null;
  }
  if (t.startsWith(FL_CONFERENCE_TOKEN)) {
    const c = CONFERENCE_LOWER.get(t.slice(FL_CONFERENCE_TOKEN.length));
    return c ? FL_CONFERENCE_TOKEN + c : null;
  }
  return null;
}

/** The entrant tokens of a list ("thor, loki, random:marvel, division:dc"): the known ones in their canonical spelling, at most FL_ENTRANT_CEILING. */
export function parseFlEntrants(text: unknown): string[] {
  if (typeof text !== "string" || !text.trim()) return [];
  const out: string[] = [];
  for (const part of text.split(/[,;\s]+/)) {
    const token = flEntrantToken(part);
    if (token) out.push(token);
    if (out.length >= FL_ENTRANT_CEILING) break;
  }
  return out;
}

/** The entrant list as the settings keep it: the known tokens, comma-joined ("" for none – the format's default pool). */
export function sanitizeFlEntrants(text: unknown): string {
  return parseFlEntrants(text).join(",");
}

/** Where entrants are drawn from: a division, a conference, or anyone (every division but Wildcard). */
export type FlPool = { kind: "division"; id: FlDivision } | { kind: "conference"; id: FlConference } | { kind: "any" };

const NON_WILDCARD: readonly FlFighterRow[] = FL_ROSTER.filter((r) => r.division !== "wildcard");

/** The fighters of a pool, in roster order. */
export function flPoolRows(pool: FlPool): readonly FlFighterRow[] {
  if (pool.kind === "division") return fightersOf(pool.id);
  if (pool.kind === "conference") return fightersOfConference(pool.id);
  return NON_WILDCARD;
}

/** The pool of a random token ("random" → anyone, "random:<division>", "random:<conference>"); null for anything else. */
export function flTokenPool(token: string): FlPool | null {
  if (token === RANDOM) return { kind: "any" };
  if (!token.startsWith(RANDOM_PREFIX)) return null;
  const id = token.slice(RANDOM_PREFIX.length);
  if (isFlDivision(id) && id !== "wildcard") return { kind: "division", id };
  if (isFlConference(id)) return { kind: "conference", id };
  return null;
}

/** The pool a fighter's division names: its division (Gerald, alone in Wildcard: anyone – the owner's rule for the wildcard). */
export function flPoolOfDivision(division: FlDivision): FlPool {
  return division === "wildcard" ? { kind: "any" } : { kind: "division", id: division };
}

/** One pinned entrant: its row and the slot (A–F, 0–5) it was pinned from. */
export interface FlPinned {
  row: FlFighterRow;
  slot: number;
}

/** An entrant of a bracket or a boss rush: its row, the slot it was pinned from (−1: listed or drawn) and its seed (1 first; 0 until seeded). */
export interface FlEntrant {
  row: FlFighterRow;
  slot: number;
  seed: number;
}

/**
 * The next entrant drawn from `pool` (ONE draw of `random`): a fighter not yet in the list (`taken`) nor excluded – a division
 * that has none left fills from its conference, never beyond it; when even that is spent the pool's fighters come round again
 * (a bracket bigger than its pool repeats fighters rather than leave its genre).
 */
function drawFrom(pool: FlPool, taken: ReadonlySet<string>, exclude: ReadonlySet<string>, random: () => number): FlFighterRow {
  const u = random();
  const pick = (rows: readonly FlFighterRow[]) => rows[Math.min(rows.length - 1, Math.floor(u * rows.length))];
  const fresh = (rows: readonly FlFighterRow[]) => rows.filter((r) => !taken.has(r.id) && !exclude.has(r.id));
  const own = flPoolRows(pool);
  let rows = fresh(own);
  if (rows.length > 0) return pick(rows);
  const conference = pool.kind === "division" ? conferenceOf(pool.id) : pool.kind === "conference" ? pool.id : null;
  const wide = conference ? fightersOfConference(conference) : own;
  rows = fresh(wide);
  if (rows.length > 0) return pick(rows);
  rows = wide.filter((r) => !exclude.has(r.id));
  if (rows.length > 0) return pick(rows);
  return pick(own.length > 0 ? own : NON_WILDCARD);
}

/**
 * The entrants of a bracket (or a boss rush's challengers): the `pinned` fighters first (slot order, each once), then the
 * `tokens` in order – a fighter id, a whole `division:` / `conference:` in roster order, a random token drawing one – until
 * `size`, then draws from `fill` (the pool of the list's last random token when it has one). Every random entrant is ONE draw
 * of `random`, in entrant order; `exclude` never enters (a boss rush's boss). Fighters already in the list are not drawn again
 * while the pool allows (a whole division or conference listed, or an id, may repeat one only when written twice is skipped).
 */
export function drawFlEntrants(opts: { pinned: readonly FlPinned[]; tokens: readonly string[]; size: number; fill: FlPool; exclude?: readonly string[] }, random: () => number): FlEntrant[] {
  const size = Math.max(0, Math.min(FL_ENTRANT_CEILING, Math.floor(opts.size)));
  const exclude = new Set(opts.exclude ?? []);
  const out: FlEntrant[] = [];
  const taken = new Set<string>();
  const push = (row: FlFighterRow, slot: number) => {
    out.push({ row, slot, seed: 0 });
    taken.add(row.id);
  };
  for (const p of opts.pinned) {
    if (out.length >= size) break;
    if (taken.has(p.row.id) || exclude.has(p.row.id)) continue;
    push(p.row, p.slot);
  }
  let fill = opts.fill;
  for (const token of opts.tokens) {
    if (out.length >= size) break;
    const pool = flTokenPool(token);
    if (pool) {
      fill = pool;
      push(drawFrom(pool, taken, exclude, random), -1);
      continue;
    }
    const row = FL_BY_ID.get(token);
    if (row) {
      if (!taken.has(row.id) && !exclude.has(row.id)) push(row, -1);
      continue;
    }
    let rows: readonly FlFighterRow[] = [];
    if (token.startsWith(FL_DIVISION_TOKEN)) {
      const d = token.slice(FL_DIVISION_TOKEN.length);
      if (isFlDivision(d)) rows = fightersOf(d);
    } else if (token.startsWith(FL_CONFERENCE_TOKEN)) {
      const c = token.slice(FL_CONFERENCE_TOKEN.length);
      if (isFlConference(c)) rows = fightersOfConference(c);
    }
    for (const r of rows) {
      if (out.length >= size) break;
      if (!taken.has(r.id) && !exclude.has(r.id)) push(r, -1);
    }
  }
  while (out.length < size) push(drawFrom(fill, taken, exclude, random), -1);
  return out;
}

/* ------------------------------------------------------------------ seeding and the bracket */

/** A fighter's strength for the seeding and the win chance: the tuner's Bradley–Terry strength (Gerald and the unrated: 1). */
export function flStrengthOf(row: Pick<FlFighterRow, "id">): number {
  const r = FL_STRENGTH[row.id];
  return r && Number.isFinite(r.strength) && r.strength > 0 ? r.strength : 1;
}

/**
 * The entrants in seed order (indices into `entrants`, seed 1 first): `listed` – as listed (the pinned slots first) –, `rating`
 * – by `flStrengthOf()`, the strongest first (ties keep the list's order) –, or `random` – a Fisher–Yates shuffle of the list
 * (n − 1 draws of `random`, from the last place down). Writes every entrant's `seed`.
 */
export function flSeedOrder(entrants: FlEntrant[], seeding: FlSeeding, random: () => number): number[] {
  const order = entrants.map((_, i) => i);
  if (seeding === "rating") order.sort((a, b) => flStrengthOf(entrants[b].row) - flStrengthOf(entrants[a].row) || a - b);
  else if (seeding === "random") {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
  }
  order.forEach((e, k) => (entrants[e].seed = k + 1));
  return order;
}

/** The smallest power of two ≥ n (at least 2). */
export function flBracketSlots(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * The seeds of a bracket of `size` slots (a power of two) in their places, top to bottom – the standard placement, the top two
 * meeting only in the final: 2 → [1, 2], 4 → [1, 4, 3, 2], 8 → 1v8, 4v5, 3v6, 2v7, 16 → 1v16, 8v9, 5v12, 4v13, 3v14, 6v11,
 * 7v10, 2v15 (each pair written higher seed first is `flBuildBracket()`'s).
 */
export function flSeedPlacement(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = 2 * order.length;
    const next: number[] = [];
    order.forEach((s, i) => {
      if (i % 2 === 0) next.push(s, n + 1 - s);
      else next.push(n + 1 - s, s);
    });
    order = next;
  }
  return order;
}

/** A bout of a bracket: its entrants (indices into the entrants; −1 a bye, −2 not known yet) and its winner (−1 none yet). */
export interface FlBout {
  a: number;
  b: number;
  winner: number;
}

export const FL_BYE = -1;
export const FL_PENDING = -2;

/**
 * The rounds of a bracket for `seeds` (entrant indices in seed order: seed 1 first): the first round pairs the places of
 * `flSeedPlacement()` – a seed past the entrants is a bye, and the seed it meets goes through at once –, every later round
 * waits for its two feeders. A pair is written higher seed first (slot A of its bout).
 */
export function flBuildBracket(seeds: readonly number[]): FlBout[][] {
  const n = seeds.length;
  const size = flBracketSlots(n);
  const places = flSeedPlacement(size);
  const rounds: FlBout[][] = [];
  const first: FlBout[] = [];
  for (let i = 0; i < size; i += 2) {
    const s1 = places[i];
    const s2 = places[i + 1];
    const hi = Math.min(s1, s2);
    const lo = Math.max(s1, s2);
    const a = hi <= n ? seeds[hi - 1] : FL_BYE;
    const b = lo <= n ? seeds[lo - 1] : FL_BYE;
    first.push({ a, b, winner: b === FL_BYE ? a : a === FL_BYE ? b : -1 });
  }
  rounds.push(first);
  for (let len = first.length / 2; len >= 1; len /= 2) rounds.push(Array.from({ length: len }, () => ({ a: FL_PENDING, b: FL_PENDING, winner: -1 })));
  // the byes' winners go through to the next round at once
  for (let p = 0; p < first.length; p++) if (first[p].winner >= 0) flAdvanceBracket(rounds, 0, p, first[p].winner);
  return rounds;
}

/** Writes the winner of bout `p` of round `r` and sends it on to its place in the next round. */
export function flAdvanceBracket(rounds: FlBout[][], r: number, p: number, winner: number) {
  const bout = rounds[r]?.[p];
  if (!bout) return;
  bout.winner = winner;
  const next = rounds[r + 1]?.[p >> 1];
  if (!next) return;
  if (p % 2 === 0) next.a = winner;
  else next.b = winner;
}

/** The next bout to fight (both entrants known, no winner yet), round by round, top to bottom; null once the final is decided. */
export function flNextBout(rounds: readonly FlBout[][]): { r: number; p: number } | null {
  for (let r = 0; r < rounds.length; r++) {
    for (let p = 0; p < rounds[r].length; p++) {
      const b = rounds[r][p];
      if (b.winner < 0 && b.a >= 0 && b.b >= 0) return { r, p };
    }
  }
  return null;
}

/** The bouts a bracket of `n` entrants plays (every bout knocks one out): n − 1. */
export function flBracketBouts(n: number): number {
  return Math.max(0, n - 1);
}

/** A round's name by the entrants left in it: the final (2), the semi-finals (4), the quarter-finals (8), a round of 16 and more. */
export type FlRoundCode = "r16" | "qf" | "sf" | "final";
export function flRoundCode(rounds: readonly FlBout[][], r: number): FlRoundCode {
  const left = 2 * rounds[r].length;
  return left <= 2 ? "final" : left <= 4 ? "sf" : left <= 8 ? "qf" : "r16";
}

/** The data attribute's short form of a round: F, SF, QF, R16 (R32 …: the entrants left). */
export function flRoundShort(rounds: readonly FlBout[][], r: number): string {
  const code = flRoundCode(rounds, r);
  return code === "final" ? "F" : code === "sf" ? "SF" : code === "qf" ? "QF" : `R${2 * rounds[r].length}`;
}

/** A bout's number inside its round among the bouts actually fought (byes left out) and how many the round fights: "2/4". */
export function flRoundBout(rounds: readonly FlBout[][], r: number, p: number): { n: number; of: number } {
  let n = 0;
  let of = 0;
  rounds[r].forEach((b, i) => {
    const real = r > 0 || (b.a !== FL_BYE && b.b !== FL_BYE);
    if (!real) return;
    of++;
    if (i <= p) n++;
  });
  return { n, of };
}

/* ------------------------------------------------------------------ the win chance */

/** A side below this win chance is the underdog (and its win an UPSET); above `FL_FAVOURITE` the favourite. */
export const FL_UNDERDOG = 0.4;
export const FL_FAVOURITE = 0.6;

/** The win chances of the sides (each a list of fighters) and whether they are estimates. */
export interface FlWinChance {
  chances: number[];
  /** Teams, Gerald or a pairing the tuner never measured (fighters of different divisions): an estimate (shown "est."). */
  est: boolean;
}

/**
 * The win chance of every side (simulated, from the tuner's ratings): Σs of a side ÷ Σs of all sides, s a fighter's
 * Bradley–Terry strength (`FL_STRENGTH`). The strengths are normalised per division, so a pairing across divisions is not
 * measured: every fighter then counts 1 (an even split) – as do Gerald and anyone unrated; teams sum their members. Marked
 * `est` for teams, Gerald and unmeasured pairings. A free-for-all: s_i ÷ Σs. No betting words or odds formats: a share.
 */
export function flWinChances(sides: readonly (readonly Pick<FlFighterRow, "id" | "division">[])[]): FlWinChance {
  const all = sides.flat();
  const divisions = new Set(all.map((r) => r.division));
  const measured = divisions.size === 1 && !divisions.has("wildcard") && all.every((r) => !!FL_STRENGTH[r.id]);
  const team = sides.some((s) => s.length > 1);
  const sums = sides.map((s) => s.reduce((t, r) => t + (measured ? flStrengthOf(r) : 1), 0));
  const total = sums.reduce((a, b) => a + b, 0);
  const chances = sums.map((x) => (total > 0 ? x / total : 1 / Math.max(1, sides.length)));
  return { chances, est: !measured || team };
}

/** The win chance of side A (fighter ids) against side B: ΣsA ÷ (ΣsA + ΣsB); B's is the rest. */
export function flWinChance(sideA: readonly string[], sideB: readonly string[]): { a: number; b: number; est: boolean } {
  const rows = (ids: readonly string[]) => ids.map((id) => FL_BY_ID.get(id)).filter((r): r is FlFighterRow => !!r);
  const r = flWinChances([rows(sideA), rows(sideB)]);
  return { a: r.chances[0] ?? 0.5, b: r.chances[1] ?? 0.5, est: r.est };
}

/** A win chance as the VS card writes it: a whole percent (no odds format). */
export function flChancePercent(chance: number): number {
  return Math.round(100 * Math.max(0, Math.min(1, chance)));
}

/* ------------------------------------------------------------------ the story */

/** The lead changes hands only when the new leader's HP share is this clear of the old one's (hysteresis). */
export const FL_LEAD_HYSTERESIS = 0.05;
/** A comeback: the winner trailed by at least this much HP share at some step. */
export const FL_COMEBACK_DEFICIT = 0.4;
/** A clutch win: the winner ends at or under this share of its HP. */
export const FL_CLUTCH_FRAC = 0.1;
/** The cliffhanger: every side still standing at or under this share of its HP (the "both low" moment). */
export const FL_BOTH_LOW = 0.25;
/** A close fight for the finder's "close" outcome: the winner's HP share at or under this. */
export const FL_CLOSE = 0.1;

/** The winner card's story tags in their priority (at most two shown): PERFECT, UPSET, COMEBACK, CLUTCH. */
export const FL_STORY_TAGS = ["perfect", "upset", "comeback", "clutch"] as const;
export type FlStoryTag = (typeof FL_STORY_TAGS)[number];

/** The tags a verdict earns, in priority order, at most `max` (the winner card's two). */
export function flStoryTags(s: { perfect: boolean; upset: boolean; comeback: boolean; clutch: boolean }, max = 2): FlStoryTag[] {
  const out: FlStoryTag[] = [];
  for (const tag of FL_STORY_TAGS) if (s[tag] && out.length < max) out.push(tag);
  return out;
}

/* ------------------------------------------------------------------ the panel's estimates */

/**
 * About how long a show's clip runs (s): every bout its VS card (1.5 s), a typical fight (17 s, the division medians of the
 * balance gate) and its interlude (0.8 s of finale + the card), then the last verdict's hold (4.2 s) – an 8-bracket about 2:30,
 * a 16-bracket about 5:30 (no fast-forward: a presentation rate is out of scope).
 */
export function flExpectedClipSec(bouts: number, cardSec = FL_CARD_SEC, fightSec = 17): number {
  const n = Math.max(1, bouts);
  return n * (1.5 + fightSec) + (n - 1) * (FL_INTERLUDE_FINALE_MS / 1000 + Math.max(0, cardSec)) + 4.2;
}

/**
 * The panel's estimate of a show's clip (s) from its settings: a series about need + (need − 1) / 2 games (a Bo3 about 2.5), a
 * bracket its n − 1 bouts (a best-of final adds its expected extra games), a boss rush its waves; one match none (0).
 */
export function flShowClipEstimateSec(s: { kind: FlShowKind; bestOf: number; bracketSize: number; bossWaves: number; cardSec: number }): number {
  const need = flSeriesNeed(s.bestOf);
  const seriesGames = need + (need - 1) / 2;
  if (s.kind === "series") return flExpectedClipSec(seriesGames, s.cardSec);
  if (s.kind === "bracket") return flExpectedClipSec(flBracketBouts(Math.max(2, Math.min(FL_ENTRANT_CEILING, Math.round(s.bracketSize)))) + (seriesGames - 1), s.cardSec);
  if (s.kind === "boss") return flExpectedClipSec(Math.max(1, Math.min(FL_ENTRANT_CEILING, Math.round(s.bossWaves))), s.cardSec);
  return 0;
}

/** A clip length as the panel writes it: m:ss. */
export function flClockText(sec: number): string {
  const total = Math.max(0, Math.round(sec));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
