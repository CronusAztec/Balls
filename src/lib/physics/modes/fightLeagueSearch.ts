import { FL_DIVISION_LABELS, FL_ROSTER, weaponLabel, type FlDivision, type FlFighterRow } from "./fightLeagueRoster";

/**
 * --- fl-overhaul --- (Stage 2) The fighter picker's search: a pure function over the roster rows (no DOM, no randomness), so
 * the panel and the tests rank alike.
 *
 * A query matches a fighter's name, short name, id, source, ability name, weapon label and division label – case- and
 * diacritic-insensitive (NFD with the combining marks stripped; punctuation reads as a space, so "pac man", "pacman" and
 * "Pac-Man" all match) – and the hits are ranked:
 *
 *   0  name prefix    the name, or its sort key (the name without a leading title word: "The Flash" → "flash", "Darth Vader"
 *                     → "vader", "Captain Falcon" → "falcon", "Mr. Incredible" → "incredible"), starts with the query
 *   1  name word      a later word of the name, the short name or the id starts with it
 *   2  name           the name, short name or id contains it
 *   3  ability        the ability name contains it
 *   4  source         the source contains it
 *   5  weapon         the weapon label contains it
 *   6  division       the division label (English, or the panel's translated one) contains it
 *
 * ties broken by the sort key, then roster order. A query of several words that matches nothing as a phrase matches a fighter
 * every word of which matches one of the fields (ranked after every phrase hit). An empty query returns the rows unchanged.
 */

/** Lower case, diacritics stripped (NFD), every run of other characters a single space. */
export function flFold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const compact = (folded: string) => folded.replace(/ /g, "");

/** Leading words the sort key drops (only while a word remains). */
const TITLE_WORDS: ReadonlySet<string> = new Set(["the", "captain", "darth", "mr", "mrs", "ms", "dr", "doctor", "sir"]);

/** The name a picker sorts and type-aheads by: folded, without a leading title word ("Darth Vader" → "vader"). */
export function flSortKey(row: Pick<FlFighterRow, "name">): string {
  const words = flFold(row.name).split(" ").filter(Boolean);
  while (words.length > 1 && TITLE_WORDS.has(words[0])) words.shift();
  return words.join(" ");
}

interface Indexed {
  row: FlFighterRow;
  order: number;
  key: string;
  keyC: string;
  name: string;
  nameC: string;
  short: string;
  id: string;
  ability: string;
  source: string;
  weapon: string;
  division: string;
}

const cache = new WeakMap<FlFighterRow, Omit<Indexed, "order" | "division">>();

function indexRow(row: FlFighterRow, order: number, divisionLabel?: (d: FlDivision) => string): Indexed {
  let base = cache.get(row);
  if (!base) {
    const name = flFold(row.name);
    const key = flSortKey(row);
    base = {
      row,
      key,
      keyC: compact(key),
      name,
      nameC: compact(name),
      short: compact(flFold(row.short ?? "")),
      id: row.id.toLowerCase(),
      ability: flFold(row.ability.name),
      source: flFold(row.source),
      weapon: flFold(weaponLabel(row)),
    };
    cache.set(row, base);
  }
  const english = flFold(FL_DIVISION_LABELS[row.division] ?? row.division);
  const local = divisionLabel ? flFold(divisionLabel(row.division)) : "";
  return { ...base, order, division: local && local !== english ? `${english} ${local}` : english };
}

const NO_MATCH = Number.POSITIVE_INFINITY;

/** The rank of one folded phrase against one fighter (lower is better; NO_MATCH when nothing matches). */
function tierOf(x: Indexed, q: string): number {
  const qc = compact(q);
  if (!qc) return NO_MATCH;
  if (x.keyC.startsWith(qc) || x.nameC.startsWith(qc)) return 0;
  if ((` ${x.name}`).includes(` ${q}`) || (x.short && x.short.startsWith(qc)) || x.id.startsWith(qc)) return 1;
  if (x.nameC.includes(qc) || (x.short && x.short.includes(qc)) || x.id.includes(qc)) return 2;
  if (x.ability.includes(q) || compact(x.ability).includes(qc)) return 3;
  if (x.source.includes(q) || compact(x.source).includes(qc)) return 4;
  if (x.weapon.includes(q) || compact(x.weapon).includes(qc)) return 5;
  if (x.division.includes(q) || compact(x.division).includes(qc)) return 6;
  return NO_MATCH;
}

/** The rank of a query against one fighter: the phrase's tier, else (several words) 7 + the worst word's tier. */
export function flSearchRank(row: FlFighterRow, query: string, divisionLabel?: (d: FlDivision) => string): number {
  return rankIndexed(indexRow(row, 0, divisionLabel), flFold(query));
}

function rankIndexed(x: Indexed, q: string): number {
  if (!q) return 0;
  const phrase = tierOf(x, q);
  if (phrase !== NO_MATCH) return phrase;
  const words = q.split(" ").filter(Boolean);
  if (words.length < 2) return NO_MATCH;
  let worst = 0;
  for (const w of words) {
    const t = tierOf(x, w);
    if (t === NO_MATCH) return NO_MATCH;
    worst = Math.max(worst, t);
  }
  return 7 + worst;
}

/**
 * The fighters matching `query`, best first (see the ranking above). `rows` defaults to the whole roster; `divisionLabel` adds
 * the panel's translated division label to the division field.
 */
export function searchFighters(query: string, rows: readonly FlFighterRow[] = FL_ROSTER, divisionLabel?: (d: FlDivision) => string): FlFighterRow[] {
  const q = flFold(query);
  if (!q) return [...rows];
  const hits: { x: Indexed; rank: number }[] = [];
  rows.forEach((row, i) => {
    const x = indexRow(row, i, divisionLabel);
    const rank = rankIndexed(x, q);
    if (rank !== NO_MATCH) hits.push({ x, rank });
  });
  hits.sort((a, b) => a.rank - b.rank || (a.x.key < b.x.key ? -1 : a.x.key > b.x.key ? 1 : 0) || a.x.order - b.x.order);
  return hits.map((h) => h.x.row);
}

/** Type-ahead in the tile grid: the first of `rows` (in their order) whose sort key or name starts with the typed letters. */
export function flTypeAhead(typed: string, rows: readonly FlFighterRow[]): FlFighterRow | undefined {
  const qc = compact(flFold(typed));
  if (!qc) return undefined;
  return rows.find((row) => compact(flSortKey(row)).startsWith(qc)) ?? rows.find((row) => compact(flFold(row.name)).startsWith(qc));
}
