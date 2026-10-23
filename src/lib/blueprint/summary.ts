/*
 * --- blueprint --- A Blueprint in the visitor's words: summarizeBlueprint() turns a resolved spec into a few lines of
 * message keys with their values (Mode Lab's "How it plays" list, BlueprintSection.tsx), so the summary of any spec – a
 * catalog game, a slider's change, a stranger's link – reads in English, Polish or Spanish from messages/*.json
 * (`Blueprint.how.*`). describe.ts says the same in English for tools and prompts; this one is for people: it leaves out
 * the numbers a player cannot see (speeds, radii, formulas), the cosmetic actions (a note, a flash) unless a rule has
 * nothing else, and a recolouring the rule's merge or team change already implies. A value is a number, a plain string
 * (an id the spec's author chose), or another phrase to say first. Pure data: no DOM, no messages, no engine.
 */
import { BLUEPRINT_LIMITS as L } from "./limits";
import { BALL_TRIGGERS, type Blueprint, type BlueprintAction, type BlueprintRule, type Num } from "./schema";

/** One message (`Blueprint.how.<key>`) with its values; a phrase value is said first and put in its place. */
export interface SummaryPhrase {
  key: string;
  values?: Record<string, SummaryValue>;
}
export type SummaryValue = string | number | SummaryPhrase;

/** A line of the summary: its head (a label or a rule's trigger) and its parts, said in order after it. */
export interface SummaryLine {
  head: SummaryPhrase;
  parts: SummaryPhrase[];
}

export interface SummaryOptions {
  /** How a variable is called (default: its id). Mode Lab names a catalog game's variables by their HUD labels in the page's language. */
  varName?: (id: string) => string;
}

export function isSummaryPhrase(value: SummaryValue): value is SummaryPhrase {
  return typeof value === "object" && value !== null && typeof (value as SummaryPhrase).key === "string";
}

const p = (key: string, values?: Record<string, SummaryValue>): SummaryPhrase => (values ? { key, values } : { key });
/**
 * --- review fix (blueprint) --- From this size on a number is said short (`summaryNumberFormat()`: 2.5M, 1E300): sayPhrase()
 * hands it to the page's formatter whole or not, and a count that can reach it takes its "…Big" phrase, which says it as is
 * instead of through a plural rule (a plural's # would print every digit of a stranger's 1e300).
 */
export const SUMMARY_BIG = 1e6;
/** A number as the summary shows it: whole, or with at most two decimals (a big one as it is). */
const shown = (n: number) => (Math.abs(n) >= SUMMARY_BIG ? n : Math.round(n * 100) / 100);
/** --- review fix (blueprint) --- A count of balls one spawner, spawn or split makes at once, as the runtime takes it: whole, 0 to perSpawn. */
const perSpawn = (n: number) => Math.min(L.perSpawn, Math.max(0, Math.round(n)));
const KNOWN_COUNTS = ["balls", "tiles", "rings", "escaped", "teams", "tier", "time"];

/** What summarizing one spec needs: the spec and how its variables are called. */
interface Ctx {
  bp: Blueprint;
  varName: (id: string) => string;
}

/** A number slot's value when it is a plain number, or a variable's starting value when it names one (a formula: null). */
function plain(c: Ctx, n: Num): number | null {
  if (typeof n === "number") return Number.isFinite(n) ? n : null;
  const v = c.bp.vars.find((x) => x.id === n.trim());
  return v && Number.isFinite(v.start) ? v.start : null;
}

/** The place new balls appear, said after them. */
const place = (at: string) => p(`at.${at}`);

/** Who a ball rule is about: "a ball", or "a ball called red" when the spec has several bodies and the rule names one. */
function who(c: Ctx, of: string | null): SummaryPhrase {
  return of && c.bp.bodies.length > 1 ? p("whoBody", { body: of }) : p("who");
}

/** What a count reads: a known count's name, or a variable's name in quotes. */
function countName(c: Ctx, what: string): SummaryPhrase {
  return KNOWN_COUNTS.includes(what) ? p(`count.${what}`) : p("count.var", { name: c.varName(what) });
}

/** A ballHit rule's head by its `with` relation (a body id: "When a ball touches a ball called …"). */
const BALL_HIT_HEADS: Readonly<Record<string, string>> = { any: "when.ballHit", same: "when.ballHitSame", sameTier: "when.ballHitSameTier", sameTeam: "when.ballHitSameTeam", otherTeam: "when.ballHitOtherTeam" };

/** A rule's trigger, with its filters after it ("When a ball hits the wall, every 3rd time"). */
function ruleHead(c: Ctx, r: BlueprintRule): SummaryPhrase {
  let head: SummaryPhrase;
  switch (r.when) {
    case "timer":
      head = p("when.timer", { sec: shown(r.sec) });
      break;
    case "ballHit": {
      const rel = r.with;
      const key = BALL_HIT_HEADS[rel];
      head = key ? p(key) : p("when.ballHitBody", { who: who(c, r.of), other: rel });
      break;
    }
    case "countReached":
      head = r.atMost !== null && r.atLeast === null ? p("when.countAtMost", { what: countName(c, r.what), n: shown(r.atMost) }) : p("when.countAtLeast", { what: countName(c, r.what), n: shown(r.atLeast ?? 0) });
      break;
    case "start":
    case "beat":
    case "bar":
      head = p(`when.${r.when}`);
      break;
    default:
      head = p(`when.${r.when}`, { who: who(c, r.of) });
  }
  const filters: SummaryPhrase[] = [];
  if (r.every > 1) filters.push(p(r.every >= SUMMARY_BIG ? "everyBig" : "every", { n: r.every }));
  if (r.chance < 1) filters.push(p("chance", { pct: Math.round(r.chance * 100) }));
  if (r.cooldownSec > 0) filters.push(p("cooldown", { sec: shown(r.cooldownSec) }));
  if (r.maxFires > 0) filters.push(p(r.maxFires >= SUMMARY_BIG ? "maxFiresBig" : "maxFires", { n: r.maxFires }));
  for (const f of filters) head = p("withFilter", { a: head, b: f });
  return head;
}

/** The ball an action changes, as the rule's trigger names it (after a merge, `self` is the merged ball). */
function target(r: BlueprintRule, t: string, merged: boolean): SummaryPhrase {
  if (t === "all" || !BALL_TRIGGERS.has(r.when)) return p("target.all");
  if (r.when === "ballHit") return p(t === "other" ? "target.slower" : merged ? "target.merged" : "target.faster");
  return p(t === "other" ? "target.other" : "target.self");
}

/** What an action does (null: cosmetic, implied by another action of the rule, or nothing a player sees). */
function action(c: Ctx, r: BlueprintRule, a: BlueprintAction, merged: boolean): SummaryPhrase | null {
  const who = (t: string) => target(r, t, merged);
  switch (a.act) {
    case "spawn": {
      const n = plain(c, a.count);
      return n !== null && n >= 1 ? p("act.spawn", { count: perSpawn(n), place: place(a.at) }) : p("act.spawnSome", { place: place(a.at) });
    }
    case "split": {
      const n = plain(c, a.into);
      return n !== null ? p("act.split", { who: who(a.target), n: perSpawn(n) }) : p("act.splitSome", { who: who(a.target) });
    }
    case "merge":
      return p("act.merge");
    case "remove":
      return p("act.remove", { who: who(a.target) });
    case "grow": {
      const n = plain(c, a.by);
      return p(n !== null && n < 0 ? "act.shrink" : "act.grow", { who: who(a.target) });
    }
    case "speed": {
      const n = plain(c, a.scale);
      if (n === 1) return null;
      return p(n !== null && n < 1 ? "act.slower" : "act.faster", { who: who(a.target) });
    }
    case "recolor": {
      // the colour of the new tier, or of the team the ball just joined: said by the merge or the team change already
      if (a.color === "tier" && r.do.some((x) => x.act === "merge" || x.act === "tier")) return null;
      if (a.color === "team" && r.do.some((x) => x.act === "team" && x.target === a.target)) return null;
      return p("act.recolor", { who: who(a.target) });
    }
    case "tier":
      return p("act.tier", { who: who(a.target) });
    case "team":
      if (r.when === "ballHit" && a.target === "other" && a.to === "self") return p("act.teamJoinFaster");
      return p("act.team", { who: who(a.target) });
    case "damage": {
      const n = plain(c, a.amount);
      if (a.target === "tile") return n !== null ? p("act.damageTile", { n: shown(n) }) : p("act.damageTileSome");
      return n !== null ? p("act.damage", { who: who(a.target), n: shown(n) }) : p("act.damageSome", { who: who(a.target) });
    }
    case "var": {
      const n = plain(c, a.value);
      const value = n !== null ? shown(n) : String(a.value);
      return p(a.op === "add" ? "act.varAdd" : a.op === "mul" ? "act.varMul" : "act.varSet", { name: c.varName(a.id), n: value });
    }
    case "impulse":
      return p("act.impulse", { who: who(a.target) });
    case "fx":
    case "sound":
      return null;
  }
}

/** The arena: its shape and what is in it. */
function arenaLine(c: Ctx): SummaryLine {
  const a = c.bp.arena;
  const parts: SummaryPhrase[] = [];
  if (a.shape === "rings" && a.rings) {
    parts.push(p("rings", { count: a.rings.count }));
    if (a.rings.breakOnPass) parts.push(p("ringsBreak"));
    if (a.rings.rim) parts.push(p("ringsRim")); // --- review fix (blueprint) ---
  } else if (a.shape === "box") parts.push(p("box"));
  else if (a.exits.length) {
    parts.push(p("circleExits", { count: a.exits.length }));
    if (a.spinDegPerSec !== 0) parts.push(p("exitsTurn", { count: a.exits.length }));
  } else parts.push(p("circle"));
  const gx = a.gravity.x;
  const gy = a.gravity.y;
  if (gx !== 0 || gy !== 0) parts.push(p(Math.abs(gy) >= Math.abs(gx) ? (gy > 0 ? "gravityDown" : "gravityUp") : "gravitySide"));
  const t = c.bp.tiles;
  if (t) {
    const style = t.style === "brick" ? "tilesBrick" : t.style === "neon" ? "tilesNeon" : "tilesGlass";
    parts.push(p(style, { count: t.rows * t.cols, layers: p(t.layout === "ring" ? "tileLayers" : "tileRows", { rows: t.rows }) }));
    const first = Math.max(1, Math.round(t.hp));
    const last = Math.max(1, Math.round(t.hp + t.hpStep * (t.rows - 1)));
    parts.push(last !== first ? p("tileHitsRange", { from: Math.min(first, last), to: Math.max(first, last) }) : p(first >= SUMMARY_BIG ? "tileHitsBig" : "tileHits", { hp: first }));
  }
  const counts = { pegs: 0, bumpers: 0, bars: 0, spinners: 0 };
  for (const o of c.bp.obstacles) {
    if (o.kind === "peg") counts.pegs++;
    else if (o.kind === "bumper") counts.bumpers++;
    else if (o.kind === "pegGrid") counts.pegs += o.rows * o.cols;
    else if (o.kind === "pegRing") counts.pegs += o.count;
    else if (o.kind === "bar") counts.bars++;
    else counts.spinners++;
  }
  for (const [kind, n] of Object.entries(counts)) if (n > 0) parts.push(p(kind, { count: n }));
  return { head: p("arena"), parts };
}

/** The start: the balls there at once (with their place when they share one), the teams, and what keeps coming. */
function startLine(c: Ctx): SummaryLine {
  const parts: SummaryPhrase[] = [];
  let first = 0;
  let some = false;
  const places = new Set<string>();
  for (const s of c.bp.spawners) {
    if (s.startSec > 0) continue;
    const n = plain(c, s.count);
    if (n === null) some = true;
    else first += perSpawn(n);
    places.add(s.at);
  }
  if (some && first === 0) parts.push(p("startSome"));
  else if (first > 0) parts.push(places.size === 1 ? p("startBalls", { count: first, place: place([...places][0]) }) : p("startBallsSpread", { count: first }));
  const teams = new Set(c.bp.bodies.map((b) => b.team)).size;
  if (teams > 1) parts.push(p("teams", { count: teams }));
  for (const s of c.bp.spawners) {
    if (s.onBeat) parts.push(p("moreOnBeat"));
    else if (s.everySec > 0) parts.push(p("moreEvery", { sec: shown(s.everySec) }));
  }
  return { head: p("start"), parts };
}

/** How the run ends: its conditions or else the timeout, and who wins. */
function endLine(c: Ctx): SummaryLine {
  const conds: SummaryPhrase[] = [];
  for (const f of c.bp.finish.any) {
    switch (f.when) {
      case "escaped":
        conds.push(((count) => p(count >= SUMMARY_BIG ? "end.escapedBig" : "end.escaped", { count }))(Math.max(1, Math.round(f.atLeast ?? 1))));
        break;
      case "tilesCleared":
      case "ringsCleared":
        conds.push(p(`end.${f.when}`));
        break;
      case "count":
        conds.push(f.atMost !== null && f.atLeast === null ? p("end.countAtMost", { what: countName(c, f.what), n: shown(f.atMost) }) : p("end.countAtLeast", { what: countName(c, f.what), n: shown(f.atLeast ?? 0) }));
        break;
      case "tier":
        conds.push(p("end.tier", { n: shown(f.atLeast ?? 0) }));
        break;
      case "teamsLeft":
        conds.push(p("end.teamsLeft", { n: Math.max(0, Math.round(f.atMost ?? 1)) }));
        break;
    }
  }
  const sec = shown(c.bp.finish.timeoutSec);
  const parts: SummaryPhrase[] = [];
  if (!conds.length) parts.push(p("endTimeout", { sec }));
  else {
    // "when A or B, or after 60 s": the conditions joined by "or" (each `orJoin` nests the ones before it)
    let joined = conds[0];
    for (let i = 1; i < conds.length; i++) joined = p("orJoin", { a: joined, b: conds[i] });
    parts.push(p("endLine", { conds: joined, sec }));
  }
  if (c.bp.finish.winner !== "none") parts.push(p(`win.${c.bp.finish.winner}`));
  return { head: p("ends"), parts };
}

/** The whole summary: the arena, the start, one line per rule (in order) and the end. */
export function summarizeBlueprint(bp: Blueprint, options: SummaryOptions = {}): SummaryLine[] {
  const c: Ctx = { bp, varName: options.varName ?? ((id) => id) };
  const lines: SummaryLine[] = [arenaLine(c), startLine(c)];
  for (const r of bp.rules) {
    const parts: SummaryPhrase[] = [];
    let merged = false;
    for (const a of r.do) {
      const said = action(c, r, a, merged);
      if (said) parts.push(said);
      if (a.act === "merge") merged = true;
    }
    // a rule that only plays a note or flashes still says so
    if (!parts.length && r.do.some((a) => a.act === "sound")) parts.push(p("act.sound"));
    else if (!parts.length && r.do.some((a) => a.act === "fx")) parts.push(p("act.fx"));
    if (parts.length) lines.push({ head: ruleHead(c, r), parts });
  }
  lines.push(endLine(c));
  return lines.filter((l) => l.parts.length > 0);
}

/** Every message key a summary uses (the tests check each one exists in every locale). */
export function summaryKeys(lines: SummaryLine[]): string[] {
  const out = new Set<string>();
  const visit = (ph: SummaryPhrase) => {
    out.add(ph.key);
    for (const v of Object.values(ph.values ?? {})) if (isSummaryPhrase(v)) visit(v);
  };
  for (const l of lines) {
    visit(l.head);
    l.parts.forEach(visit);
  }
  return [...out];
}

/**
 * Says a phrase with a message function (`say(key, values)`): its phrase values first. A fractional number is handed to
 * `num` (the page formats it for its language: 0,08 in Polish), and so is a big one (SUMMARY_BIG on: the page says it
 * short); other whole numbers stay numbers, for the plural rules.
 */
export function sayPhrase(ph: SummaryPhrase, say: (key: string, values: Record<string, string | number>) => string, num: (n: number) => string = String): string {
  const values: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(ph.values ?? {})) values[k] = isSummaryPhrase(v) ? sayPhrase(v, say, num) : typeof v === "number" && (!Number.isInteger(v) || Math.abs(v) >= SUMMARY_BIG) ? num(v) : v;
  return say(ph.key, values);
}

/**
 * --- review fix (blueprint) --- How the page says a summary's number in its language: as Intl.NumberFormat does below
 * SUMMARY_BIG, short below a thousand trillion (2.5M, 2,5 mln), in exponent form beyond (1E300) – so a stranger's 1e300
 * never runs four hundred digits across the panel.
 */
export function summaryNumberFormat(locale: string): (n: number) => string {
  const plain = new Intl.NumberFormat(locale);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const exponent = new Intl.NumberFormat(locale, { notation: "scientific", maximumFractionDigits: 2 });
  return (n) => {
    const a = Math.abs(n);
    if (!Number.isFinite(n)) return String(n);
    return a < SUMMARY_BIG ? plain.format(n) : a < 1e15 ? compact.format(n) : exponent.format(n);
  };
}
