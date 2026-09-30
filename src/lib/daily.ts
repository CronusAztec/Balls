/**
 * --- daily-gallery --- The daily challenge: one mode and one seed a day, the same for every visitor.
 *
 * Everything is derived from the UTC date alone (no server, no clock but the visitor's), so the landing card, the
 * simulator's "Play today's seed" button, a `?daily=1` link and a shared `?daily=2026-10-01` link all agree:
 *
 *  - the **seed** is a 32-bit hash of the date key (FNV-1a + the murmur3 finaliser), mapped onto 1 … 2³¹ − 2 – a seed the
 *    engine and the `seed=` link parameter accept;
 *  - the **mode** comes from DAILY_POOL: the days are dealt out in blocks of `DAILY_POOL.length` days from DAILY_EPOCH,
 *    every block a seeded shuffle of the pool – each mode once per block, never the same mode two days running (a block
 *    that would open with the mode the previous block closed on swaps its first two days);
 *  - each pool entry carries a curated look (glow, wall-break style, a face…) and, where the defaults run long, a tighter
 *    setup (fewer walls, fewer targets), so a daily run ends by itself in well under two minutes.
 *
 * The page's physics stays deterministic for a seed (the engine's seeded RNG), so the daily run replays the same way on
 * the same screen; a different canvas size gives a different world, which is why the result is "your run", not a score.
 *
 * The visitor's own history (the first result of every day played, for the streak) lives in localStorage; everything
 * else here is pure and unit-tested (tests/daily.test.ts).
 */
import type { ModeId } from "@/lib/physics/types";
import { settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

/** The link parameter: `daily=1` opens today's challenge, `daily=YYYY-MM-DD` that day's. */
export const DAILY_PARAM = "daily";
/** Day of challenge #1 (UTC). */
export const DAILY_EPOCH = "2026-09-30";
/** Highest seed handed out (the engine and `seed=` links take 1 … 2³¹ − 1). */
const SEED_SPAN = 0x7ffffffe;
const DAY_MS = 86_400_000;

export interface DailyPoolEntry {
  mode: ModeId;
  /** The curated look and setup of the mode's daily run, as link parameters (without `mode`). */
  look: string;
}

/**
 * The modes a daily challenge is drawn from – modes whose run ends by itself and whose outcome depends on the seed – each
 * with its curated look. Appending a mode reshuffles every block from the one it lands in, so add modes sparingly.
 */
export const DAILY_POOL: readonly DailyPoolEntry[] = [
  { mode: "classic", look: "wc=5&s=500&glow=1&wbreak=all" },
  { mode: "portal", look: "glow=1&wbreak=shockwave" },
  { mode: "shatter", look: "wc=14&glow=1&wbreak=shatter" },
  { mode: "target", look: "tc=6&glow=1" },
  { mode: "drop", look: "dbc=16&dsi=0.2&dsv=0.7&glow=1" },
  { mode: "box", look: "bxs=dvd&glow=1" },
  { mode: "glass", look: "face=cute&glow=1" },
  { mode: "multipliers", look: "mpsb=3&glow=1" },
  { mode: "stringBattle", look: "" },
  { mode: "race", look: "glow=1" },
  { mode: "battle", look: "btn=10&glow=1" },
  { mode: "ctf", look: "glow=1" },
  { mode: "vortex", look: "face=cute&glow=1" },
  { mode: "runner", look: "face=cute&glow=1" },
  { mode: "paddle", look: "pdsp=1&glow=1" },
];

export interface DailyChallenge {
  /** UTC date key, YYYY-MM-DD. */
  date: string;
  /** Challenge number: 1 on DAILY_EPOCH. */
  number: number;
  seed: number;
  mode: ModeId;
  /** The challenge's settings as a canonical share query (`mode=…&…`, no seed). */
  query: string;
}

/* ------------------------------------------------------------------ dates */

/** The UTC date key of a moment: 2026-09-30. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Midnight UTC of a date key in ms, or null when it is not a real YYYY-MM-DD date. */
export function parseDateKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

const EPOCH_MS = parseDateKey(DAILY_EPOCH) as number;

/** Days from DAILY_EPOCH to a date key (0 on the epoch, negative before it); NaN for a bad key. */
export function dayIndex(key: string): number {
  const ms = parseDateKey(key);
  return ms === null ? NaN : Math.round((ms - EPOCH_MS) / DAY_MS);
}

/** The date key `days` after `key`. */
export function addDays(key: string, days: number): string {
  const ms = parseDateKey(key);
  if (ms === null) throw new Error(`not a date key: ${key}`);
  return utcDateKey(new Date(ms + days * DAY_MS));
}

/** Milliseconds until the next challenge (the next UTC midnight). */
export function msUntilNextChallenge(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}

/* ------------------------------------------------------------------ hashing */

/** FNV-1a over the UTF-16 code units, then the murmur3 finaliser: a well-mixed unsigned 32-bit hash. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mulberry32 (the engine's generator), for the block shuffles. */
function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

/** The seed of a day's challenge, 1 … 2³¹ − 2. */
export function dailySeed(key: string): number {
  return 1 + (hash32(`jumpingballslive:daily:${key}`) % SEED_SPAN);
}

/** The pool order of a block of days (a seeded Fisher–Yates shuffle of the pool indices). */
function blockOrder(block: number): number[] {
  const order = DAILY_POOL.map((_, i) => i);
  const random = mulberry32(hash32(`jumpingballslive:daily-block:${block}`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Index into DAILY_POOL of day `index` (days from the epoch). */
export function dailyPoolIndex(index: number): number {
  const n = DAILY_POOL.length;
  const block = Math.floor(index / n);
  const at = index - block * n;
  const order = blockOrder(block);
  // The previous block's last day is never swapped (only a block's first two days are), so its raw order is enough.
  if (n > 2 && order[0] === blockOrder(block - 1)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order[at];
}

/* ------------------------------------------------------------------ the challenge */

/** The canonical share query of a pool entry (`mode=…` plus its look, as `settingsToSearchParams` writes it). */
export function poolEntryQuery(entry: DailyPoolEntry): string {
  const params = new URLSearchParams(entry.look);
  params.set("mode", entry.mode);
  return settingsToSearchParams(settingsFromSearchParams(params)).toString();
}

/** The challenge of a date key (any real date; see dailyFromParam for what a link may open). */
export function dailyChallenge(key: string): DailyChallenge {
  const index = dayIndex(key);
  if (!Number.isFinite(index)) throw new Error(`not a date key: ${key}`);
  const entry = DAILY_POOL[dailyPoolIndex(index)];
  return { date: key, number: index + 1, seed: dailySeed(key), mode: entry.mode, query: poolEntryQuery(entry) };
}

/** Today's challenge (UTC). */
export function todaysChallenge(now: Date = new Date()): DailyChallenge {
  return dailyChallenge(utcDateKey(now));
}

/**
 * The challenge a `daily=` link parameter opens: `1` (or `today`) is today's, a date key is that day's – from challenge #1 up
 * to tomorrow (a day of clock skew; later days stay a surprise). Anything else is null and the link opens as usual.
 */
export function dailyFromParam(value: string | null | undefined, now: Date = new Date()): DailyChallenge | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  const today = utcDateKey(now);
  if (v === "1" || v === "today" || v === "true") return dailyChallenge(today);
  const index = dayIndex(v);
  if (!Number.isFinite(index) || index < 0 || index > dayIndex(today) + 1) return null;
  return dailyChallenge(v);
}

/** The simulator settings of a challenge (the page pins `challenge.seed` on top). */
export function dailySettings(challenge: DailyChallenge): SimulatorSettings {
  return settingsFromSearchParams(new URLSearchParams(challenge.query));
}

/** The simulator link of a challenge: `<simulator page>?daily=<date>` (`page` is origin + path; any query is dropped). */
export function dailyLink(page: string, challenge: Pick<DailyChallenge, "date">): string {
  return `${page.replace(/[?#].*$/, "")}?${DAILY_PARAM}=${challenge.date}`;
}

/** The run length for the result panel: 23.4 s → "23.4". */
export function formatRunSeconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1);
}

/* ------------------------------------------------------------------ history and streak */

/** Date key → the run length (ms) of the first daily run finished that day. */
export type DailyHistory = Record<string, number>;

export const DAILY_STORAGE_KEY = "jumpingballslive_daily";
/** Days of history kept (a streak longer than this still reads as this long). */
export const DAILY_HISTORY_DAYS = 400;

/** The history with a finished run of `date` added – the first result of a day stands – and entries older than DAILY_HISTORY_DAYS dropped. */
export function recordDailyResult(history: DailyHistory, date: string, ms: number, today: string = date): DailyHistory {
  const next: DailyHistory = {};
  const reference = dayIndex(today);
  const oldest = Number.isFinite(reference) ? reference - DAILY_HISTORY_DAYS : -Infinity;
  for (const [key, value] of Object.entries(history)) if (dayIndex(key) > oldest && Number.isFinite(value)) next[key] = value;
  if (parseDateKey(date) !== null && next[date] === undefined && Number.isFinite(ms)) next[date] = Math.max(0, Math.round(ms));
  return next;
}

/**
 * Days in a row with a finished daily run, ending today – or yesterday, while today's is still to play (the streak is
 * alive until a day is missed).
 */
export function dailyStreak(history: DailyHistory, today: string): number {
  let day = history[today] !== undefined ? today : addDays(today, -1);
  let streak = 0;
  while (history[day] !== undefined && streak < DAILY_HISTORY_DAYS) {
    streak++;
    day = addDays(day, -1);
  }
  return streak;
}

/** Only well-formed entries of a stored history (a damaged store reads as empty). */
export function sanitizeDailyHistory(raw: unknown): DailyHistory {
  const out: DailyHistory = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (parseDateKey(key) !== null && typeof value === "number" && Number.isFinite(value) && value >= 0) out[key] = value;
  }
  return out;
}

export function loadDailyHistory(): DailyHistory {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(DAILY_STORAGE_KEY);
    return raw ? sanitizeDailyHistory(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function saveDailyHistory(history: DailyHistory): void {
  try {
    localStorage.setItem(DAILY_STORAGE_KEY, JSON.stringify(history));
  } catch {
    /* storage unavailable: the streak simply is not kept */
  }
}
