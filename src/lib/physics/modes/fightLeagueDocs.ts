/**
 * --- fl-overhaul --- (Stage 7) The README's Fight League reference tables, generated from the code they describe (pure; no
 * page or engine imports it – `scripts/fl-readme.mjs` writes them between their markers and `tests/docsConsistency.test.ts`
 * checks the README against them):
 *
 * - `flKindsTableMarkdown()` – the 21 weapon kinds and their contracts (`FL_KIND_CONTRACT`), between `<!-- fl-kinds -->`;
 * - `flPrimitivesTableMarkdown()` – the 26 ability primitives with their telegraph class, their limits
 *   (`FL_PRIMITIVE_LIMITS`) and how many fighters use them, between `<!-- fl-primitives -->`;
 * - `flSettingsTableMarkdown()` – every fl* URL key with its field, its default and its comfort range, between
 *   `<!-- fl-settings -->`;
 * - the roster's table is `rosterTableMarkdown()` of fightLeagueRoster.ts (`<!-- fl-roster -->`), the balance table the
 *   tuner's (`node scripts/fl-balance.mjs --reuse --readme`, `<!-- fl-balance -->`).
 */
import {
  FIGHT_LEAGUE_RANGES,
  FIGHT_LEAGUE_URL_KEYS,
  FL_KIND_CONTRACT,
  FL_NUMERIC_URL_FIELDS,
  FL_SWITCH_URL_FIELDS,
  FL_TELEGRAPH_CLASS_MS,
  defaultFightLeagueFields,
  telegraphMs,
  type FightLeagueFields,
  type FlBandRule,
} from "./fightLeague";
import { FL_ABILITY_PRIMITIVES, FL_PRIMITIVE_LIMITS, FL_ROSTER, FL_WEAPON_KINDS, type FlPrimitive } from "./fightLeagueRoster";

/** A table cell: no pipe or line break inside it. */
function cell(text: string): string {
  return text.replace(/\|/g, "/").replace(/\s*\n\s*/g, " ");
}

/** A number as the README writes it (no trailing zeros). */
function num(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
}

/** A band bound as a formula of the weapon's reach and size (in ball radii of gap): "0.8 reach", "reach + size", "4". */
function bandRule(rule: FlBandRule): string {
  const terms: string[] = [];
  if (rule.reach !== 0) terms.push(rule.reach === 1 ? "reach" : `${num(rule.reach)} reach`);
  if (rule.size !== 0) terms.push(rule.size === 1 ? "size" : `${num(rule.size)} size`);
  let out = terms.join(" + ");
  if (rule.c !== 0) out = out ? `${out} ${rule.c < 0 ? "−" : "+"} ${num(Math.abs(rule.c))}` : num(rule.c);
  return out || "0";
}

/** The weapon kinds' contracts (`FL_KIND_CONTRACT`), one row a kind in `FL_WEAPON_KINDS` order. */
export function flKindsTableMarkdown(): string {
  const lines = ["| Kind | Keeps (gap, radii) | Trigger | Cadence | Hit geometry | Window | Silhouette | Animation | Sound |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"];
  for (const kind of FL_WEAPON_KINDS) {
    const c = FL_KIND_CONTRACT[kind];
    const keeps = c.band.lo ? `${bandRule(c.band.lo)} … ${bandRule(c.band.hi)}` : `≤ ${bandRule(c.band.hi)}`;
    lines.push(`| ${kind} | ${cell(keeps)} | ${cell(c.trigger)} | ${cell(c.cadence)} | ${cell(c.geometry)} | ${c.window} | ${cell(c.silhouette)} | ${cell(c.animation)} | ${c.sound} |`);
  }
  return lines.join("\n");
}

/** A primitive's telegraph class by `telegraphMs()` of a non-ultimate ability made of it alone. */
function telegraphClass(p: FlPrimitive): string {
  const ms = telegraphMs({ charge: 9, effects: [{ p }] });
  const entry = (Object.entries(FL_TELEGRAPH_CLASS_MS) as [string, number][]).find(([, v]) => v === ms);
  return entry ? `${entry[0]} (${ms} ms)` : `${ms} ms`;
}

/** The primitives: their telegraph class, their limits and the fighters whose ability uses them (count and the first three). */
export function flPrimitivesTableMarkdown(): string {
  const lines = ["| Primitive | Telegraph | Limits | Fighters | For example |", "| --- | --- | --- | --- | --- |"];
  for (const p of FL_ABILITY_PRIMITIVES) {
    const limits = FL_PRIMITIVE_LIMITS[p];
    const text = limits
      ? Object.entries(limits)
          .map(([field, b]) => [b.min !== undefined ? `${field} ≥ ${num(b.min)}` : "", b.max !== undefined ? `${field} ≤ ${num(b.max)}` : ""].filter(Boolean).join(", "))
          .join(", ")
      : "–";
    const users = FL_ROSTER.filter((r) => r.ability.effects.some((e) => e.p === p));
    lines.push(`| ${p} | ${telegraphClass(p)} | ${text} | ${users.length} | ${users.slice(0, 3).map((r) => cell(r.name)).join(", ") || "–"} |`);
  }
  return lines.join("\n");
}

/** The URL keys that are neither number fields nor switches, with their field. */
const OTHER_URL_FIELDS: Readonly<Record<string, keyof FightLeagueFields>> = {
  fl1: "flFighterA",
  fl2: "flFighterB",
  fl3: "flFighterC",
  fl4: "flFighterD",
  fl5: "flFighterE",
  fl6: "flFighterF",
  flM: "flMatch",
  flDiv: "flSameDivision",
  flA: "flArena",
  flH: "flHud",
  flSD: "flSuddenDeath",
  flSt: "flStage",
  flAs: "flArenaStyle",
  flTg: "flTags",
  flSnd: "flSound",
  flE: "flEntrants",
  flSd: "flSeeding",
};

/** The field behind a URL key of `FIGHT_LEAGUE_URL_KEYS` (undefined: a key this table does not know – a test fails then). */
export function flUrlField(key: string): keyof FightLeagueFields | undefined {
  return OTHER_URL_FIELDS[key] ?? FL_SWITCH_URL_FIELDS[key] ?? FL_NUMERIC_URL_FIELDS[key];
}

/** Every fl* URL key: its field, its default (as the URL writes it; "" = none) and, for a number, its comfort range. */
export function flSettingsTableMarkdown(): string {
  const defaults = defaultFightLeagueFields();
  const ranges = FIGHT_LEAGUE_RANGES as Readonly<Record<string, { min: number; max: number; step: number }>>;
  const lines = ["| URL key | Field | Default | Comfort range (slider; typed: from its minimum, no maximum) |", "| --- | --- | --- | --- |"];
  for (const key of FIGHT_LEAGUE_URL_KEYS) {
    const field = flUrlField(key);
    if (!field) continue;
    const value = defaults[field];
    const shown = typeof value === "boolean" ? (value ? "1" : "0") : value === "" ? "(empty)" : typeof value === "number" ? num(value) : String(value);
    const range = ranges[field];
    lines.push(`| \`${key}\` | \`${field}\` | ${cell(shown)} | ${range ? `${num(range.min)}–${num(range.max)} (step ${num(range.step)})` : "–"} |`);
  }
  return lines.join("\n");
}
