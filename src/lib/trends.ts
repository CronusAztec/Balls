/*
 * --- trends --- What is trending in short simulation videos: a compact, dated summary of the agent toolbox's inspire
 * reports (the owner wants the app to learn from other creators' trending and viral videos and make our clips better).
 * `npm run trends -- <report.json …>` builds it (scripts/trends.mjs, the maths in src/lib/agentKit/trends.ts) and writes
 * src/content/trends.json, which is committed: numbers, title words, theme shares, recommendations in our own levers and the
 * links and titles of the most viewed videos – never a video file or a frame. The app's AI reads it next to the virality
 * playbook (lib/desktop/ai/playbookContext.ts trendingContext: the planner, Make videos and the idea generator).
 *
 * This file is the summary's shape and its check, pure and small enough for the page: validateTrends lists every problem
 * (an empty list: the summary is sound) and parseTrends gives the summary or null, so a broken file never reaches a prompt.
 * Titles are other creators' text: the summary keeps them as data (cut, one line, no markup), and no prompt quotes them.
 */

export const TRENDS_VERSION = 1;
/** The most of each list the summary keeps (the prompt block reads a few of each). */
export const TRENDS_LIMITS = { sources: 20, numbers: 20, themes: 12, formats: 10, words: 16, recommendations: 16, examples: 10, levers: 8, modes: 8 } as const;
/** The longest text of a title, an advice and a word. */
export const TRENDS_TEXT_MAX = { title: 120, advice: 400, word: 40, label: 80, query: 200 } as const;

/**
 * --- trends --- Title words that say nothing about clips like ours, so neither the summary's words nor a prompt carry them:
 * the platforms' own tags and channel talk, and the genres and engines of other kinds of simulation video (3D renders,
 * game physics) – our clips are 2D, and a planner nudged to #3danimation or #beamng would misdescribe them.
 */
export const PLATFORM_WORDS: readonly string[] = ["shorts", "short", "youtubeshorts", "shortsfeed", "shortvideo", "ytshorts", "youtube", "tiktok", "reels", "reel", "instagram", "fyp", "foryou", "foryoupage", "viral", "trending", "subscribe", "subscribers"];
export const OFF_PRODUCT_WORDS: readonly string[] = ["3d", "3danimation", "3dart", "3drender", "3drendering", "3dmodeling", "3dmodel", "cgi", "vfx", "blender", "blender3d", "b3d", "cinema4d", "c4d", "houdini", "maya", "octane", "redshift", "unreal", "unrealengine", "ue5", "unity", "unity3d", "beamng", "beamngdrive", "roblox", "minecraft", "gmod", "teardown"];
/** --- trends --- Whether a title word may describe our clips: none of those, nor a tag built on one (#youtubeshorts, #3dsim). */
export function productWord(word: string): boolean {
  const w = word.toLowerCase();
  return !PLATFORM_WORDS.includes(w) && !OFF_PRODUCT_WORDS.includes(w) && !/shorts|tiktok|youtube|reels?$|fyp|viral|^3d/.test(w);
}

export interface TrendSource {
  query: string | null;
  /** ISO time of the inspire run. */
  at: string;
  /** Videos in the report, those compared (short-form), measured from the video itself, and seen only through their stills. */
  videos: number;
  compared: number;
  measured: number;
  stills: number;
}

export interface TrendNumber {
  /** A trait of lib/agentKit/inspiration.ts TRAITS (durationSec, meanLuma …). */
  trait: string;
  label: string;
  unit: string;
  /** Medians: the most viewed third, the rest, all of them. */
  top: number | null;
  rest: number | null;
  all: number | null;
  /** Spearman's ρ with the metric (the videos' ranks in their own reports). */
  rho: number | null;
  /** --- trends --- The two-sided p-value of that ρ (lib/agentKit/inspiration.ts spearmanP): "clear" needs it below 0.05. */
  p: number | null;
  n: number;
  /** --- trends --- How many of the n it was measured from: the video itself, its public stills (colours), its page alone. */
  from: { video: number; stills: number; page: number };
  /** Whether it separates the most viewed: clearly, as a hint, or not (never when a report on its own says the opposite). */
  strength: "clear" | "hint" | null;
  /**
   * --- trends --- What it is compared over: "list" every compared video (its page, or its stills' colours), "fetched" only
   * the videos inspire fetched whole, the top of each list – their most viewed and their rest are both within that top.
   */
  scope: "list" | "fetched";
  /** --- trends --- The reports whose own ρ (3 videos or more) points the pooled way, and those that point the other way. */
  agreement: { same: number; opposite: number };
  /** --- trends --- Each listed report's own most viewed (its top third's median; null below 3 videos), in `sources` order. */
  tops: (number | null)[];
  /** --- trends --- Whether those are more than two steps apart: the pooled median describes no search, and gives no advice. */
  split: boolean;
}

export interface TrendTheme {
  id: string;
  label: string;
  videos: number;
  viewShare: number;
  videoShare: number;
  /** viewShare ÷ videoShare: summed views, so one hit decides it – it describes the sample, it never makes advice. */
  lift: number;
  /**
   * --- trends --- How its videos rank: the median of their view percentiles in their own reports (0–1), the other videos'
   * median, its own without its best-ranked video, and the share of its views its most viewed video carries.
   */
  rank: number | null;
  restRank: number | null;
  rankWithoutTop: number | null;
  topShare: number | null;
  /**
   * Whether it is advice (lib/agentKit/inspiration.ts themeAdvised): from three videos, ranked above the others with and
   * without its best one, and a mechanic rather than the genre's own word ("satisfying").
   */
  advised: boolean;
  /** Our modes that play it (MODE_IDS) and built-in Blueprints. */
  modes: string[];
  blueprints: string[];
}

export interface TrendFormat {
  id: string;
  label: string;
  top: number | null;
  rest: number | null;
  all: number | null;
}

export interface TrendLever {
  kind: "setting" | "mode" | "blueprint" | "tool";
  name: string;
  link?: string;
  /** --- trends --- (a colour list – backgroundColors, trailColors – as at most two #rrggbb colours; [] the rainbow trail) */
  value?: string | number | boolean | readonly string[];
}

export interface TrendAdvice {
  area: string;
  advice: string;
  basis: "pattern" | "benchmark" | "gap" | "theme";
  levers: TrendLever[];
  /** --- trends --- The traits it rests on (ids of `numbers`, the pattern's first): their n, ρ and p tag it in a prompt. */
  traits: string[];
}

export interface TrendExample {
  title: string | null;
  url: string;
  platform: string;
  views: number | null;
  viewsPerDay: number | null;
  durationSec: number | null;
  query: string | null;
}

export interface TrendSummary {
  v: typeof TRENDS_VERSION;
  /** YYYY-MM-DD: the newest report's day. */
  date: string;
  metric: "views" | "viewsPerDay";
  sources: TrendSource[];
  sample: { videos: number; compared: number; measured: number; stills: number; views: number; platforms: Record<string, number> };
  numbers: TrendNumber[];
  themes: TrendTheme[];
  formats: TrendFormat[];
  /** --- trends --- The titles the formats and words count, and how many of them are the most viewed third. */
  titles: { n: number; top: number };
  /** The words most used in the most viewed titles (never a platform tag or another genre's: productWord). */
  words: { word: string; videos: number }[];
  recommendations: TrendAdvice[];
  /** The most viewed short-form videos: their links and titles, for a person or an agent to look at. */
  examples: TrendExample[];
}

const BASES = ["pattern", "benchmark", "gap", "theme"];
const LEVER_KINDS = ["setting", "mode", "blueprint", "tool"];
const CONTROL = /[\u0000-\u001f\u007f]/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const isCount = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const isNumOrNull = (v: unknown) => v === null || isNum(v);
const isShare = (v: unknown) => isNum(v) && (v as number) >= 0 && (v as number) <= 1;
const isShareOrNull = (v: unknown) => v === null || isShare(v);
const isText = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max && !CONTROL.test(v);
const isTextOrNull = (v: unknown, max: number) => v === null || isText(v, max);
const isId = (v: unknown) => typeof v === "string" && /^[A-Za-z][A-Za-z0-9-]{0,40}$/.test(v);

/** Every problem of a trend summary as "path: sentence"; [] when it is sound. */
export function validateTrends(value: unknown): string[] {
  const errors: string[] = [];
  const need = (ok: boolean, path: string, what: string) => {
    if (!ok) errors.push(`${path}: ${what}`);
  };
  if (!isObj(value)) return ["trends: must be an object"];
  const t = value;
  need(t.v === TRENDS_VERSION, "v", `must be ${TRENDS_VERSION}`);
  need(typeof t.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.date) && Number.isFinite(Date.parse(`${t.date}T00:00:00Z`)), "date", "must be YYYY-MM-DD");
  need(t.metric === "views" || t.metric === "viewsPerDay", "metric", "must be views or viewsPerDay");
  const list = (key: string, max: number, check: (item: unknown, path: string) => void) => {
    const items = t[key];
    if (!Array.isArray(items)) {
      errors.push(`${key}: must be a list`);
      return;
    }
    need(items.length <= max, key, `at most ${max} items`);
    items.forEach((item, i) => check(item, `${key}[${i}]`));
  };
  list("sources", TRENDS_LIMITS.sources, (s, p) => {
    if (!isObj(s)) return need(false, p, "must be an object");
    need(isTextOrNull(s.query, TRENDS_TEXT_MAX.query), `${p}.query`, "must be a short line or null");
    need(typeof s.at === "string" && Number.isFinite(Date.parse(s.at)), `${p}.at`, "must be an ISO time");
    for (const k of ["videos", "compared", "measured", "stills"]) need(isCount(s[k]), `${p}.${k}`, "must be a count");
  });
  need(Array.isArray(t.sources) && t.sources.length > 0, "sources", "must name at least one report");
  if (!isObj(t.sample)) errors.push("sample: must be an object");
  else {
    for (const k of ["videos", "compared", "measured", "stills", "views"]) need(isCount(t.sample[k]), `sample.${k}`, "must be a count");
    need(isCount(t.sample.compared) && isCount(t.sample.videos) && (t.sample.compared as number) <= (t.sample.videos as number), "sample.compared", "must not exceed sample.videos");
    need(isObj(t.sample.platforms) && Object.entries(t.sample.platforms).every(([k, n]) => isId(k) && isCount(n)), "sample.platforms", "must count videos by platform");
  }
  list("numbers", TRENDS_LIMITS.numbers, (n, p) => {
    if (!isObj(n)) return need(false, p, "must be an object");
    need(isId(n.trait), `${p}.trait`, "must be a trait id");
    need(isText(n.label, TRENDS_TEXT_MAX.label), `${p}.label`, "must be a short line");
    need(typeof n.unit === "string" && n.unit.length <= 8, `${p}.unit`, "must be a unit");
    for (const k of ["top", "rest", "all"]) need(isNumOrNull(n[k]), `${p}.${k}`, "must be a number or null");
    need(n.rho === null || (isNum(n.rho) && Math.abs(n.rho as number) <= 1), `${p}.rho`, "must be -1–1 or null");
    need(isCount(n.n), `${p}.n`, "must be a count");
    need(n.p === null || isShare(n.p), `${p}.p`, "must be 0–1 or null");
    need(isObj(n.from) && isCount(n.from.video) && isCount(n.from.stills) && isCount(n.from.page) && (n.from.video as number) + (n.from.stills as number) + (n.from.page as number) <= (isCount(n.n) ? (n.n as number) : 0), `${p}.from`, "must count its videos by source, at most n");
    need(n.strength === null || n.strength === "clear" || n.strength === "hint", `${p}.strength`, "must be clear, hint or null");
    need(n.scope === "list" || n.scope === "fetched", `${p}.scope`, "must be list or fetched");
    need(isObj(n.agreement) && isCount(n.agreement.same) && isCount(n.agreement.opposite), `${p}.agreement`, "must count the reports that agree and those that do not");
    need(Array.isArray(n.tops) && n.tops.length <= TRENDS_LIMITS.sources && n.tops.every(isNumOrNull), `${p}.tops`, "must list a number or null per report");
    need(typeof n.split === "boolean", `${p}.split`, "must be true or false");
  });
  list("themes", TRENDS_LIMITS.themes, (th, p) => {
    if (!isObj(th)) return need(false, p, "must be an object");
    need(isId(th.id), `${p}.id`, "must be a theme id");
    need(isText(th.label, TRENDS_TEXT_MAX.label), `${p}.label`, "must be a short line");
    need(isCount(th.videos), `${p}.videos`, "must be a count");
    need(isShare(th.viewShare), `${p}.viewShare`, "must be 0–1");
    need(isShare(th.videoShare), `${p}.videoShare`, "must be 0–1");
    need(isNum(th.lift) && (th.lift as number) >= 0, `${p}.lift`, "must be 0 or more");
    for (const k of ["rank", "restRank", "rankWithoutTop", "topShare"]) need(isShareOrNull(th[k]), `${p}.${k}`, "must be 0–1 or null");
    need(typeof th.advised === "boolean", `${p}.advised`, "must be true or false");
    need(Array.isArray(th.modes) && th.modes.length <= TRENDS_LIMITS.modes && th.modes.every(isId), `${p}.modes`, "must be mode ids");
    need(Array.isArray(th.blueprints) && th.blueprints.length <= TRENDS_LIMITS.modes && th.blueprints.every(isId), `${p}.blueprints`, "must be Blueprint ids");
  });
  list("formats", TRENDS_LIMITS.formats, (f, p) => {
    if (!isObj(f)) return need(false, p, "must be an object");
    need(isId(f.id), `${p}.id`, "must be a format id");
    need(isText(f.label, TRENDS_TEXT_MAX.label), `${p}.label`, "must be a short line");
    for (const k of ["top", "rest", "all"]) need(isShareOrNull(f[k]), `${p}.${k}`, "must be 0–1 or null");
  });
  need(isObj(t.titles) && isCount(t.titles.n) && isCount(t.titles.top) && (t.titles.top as number) <= (t.titles.n as number), "titles", "must count the titles and their most viewed third");
  list("words", TRENDS_LIMITS.words, (w, p) => {
    if (!isObj(w)) return need(false, p, "must be an object");
    need(isText(w.word, TRENDS_TEXT_MAX.word) && !/[<>`]/.test(w.word as string), `${p}.word`, "must be one short word");
    need(typeof w.word !== "string" || productWord(w.word), `${p}.word`, "must describe clips like ours (no platform tag, no other genre's)");
    need(isCount(w.videos), `${p}.videos`, "must be a count");
  });
  list("recommendations", TRENDS_LIMITS.recommendations, (r, p) => {
    if (!isObj(r)) return need(false, p, "must be an object");
    need(isId(r.area), `${p}.area`, "must be an area id");
    need(isText(r.advice, TRENDS_TEXT_MAX.advice), `${p}.advice`, "must be one line of advice");
    need(typeof r.basis === "string" && BASES.includes(r.basis), `${p}.basis`, `must be one of ${BASES.join(", ")}`);
    need(Array.isArray(r.traits) && r.traits.length <= TRENDS_LIMITS.levers && r.traits.every(isId), `${p}.traits`, "must be trait ids");
    if (!Array.isArray(r.levers) || r.levers.length > TRENDS_LIMITS.levers) return need(false, `${p}.levers`, `must be a list of at most ${TRENDS_LIMITS.levers}`);
    r.levers.forEach((l, i) => {
      const lp = `${p}.levers[${i}]`;
      if (!isObj(l)) return need(false, lp, "must be an object");
      need(typeof l.kind === "string" && LEVER_KINDS.includes(l.kind), `${lp}.kind`, `must be one of ${LEVER_KINDS.join(", ")}`);
      need(typeof l.name === "string" && /^[A-Za-z][A-Za-z0-9-]{0,59}$/.test(l.name), `${lp}.name`, "must be a setting, mode, Blueprint or tool name");
      need(l.link === undefined || (typeof l.link === "string" && /^[A-Za-z0-9]{1,12}$/.test(l.link)), `${lp}.link`, "must be a link key");
      need(l.value === undefined || typeof l.value === "boolean" || isNum(l.value) || isText(l.value, 60) || (Array.isArray(l.value) && l.value.length <= 2 && l.value.every((c) => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))), `${lp}.value`, "must be a short value or at most two #rrggbb colours");
    });
  });
  list("examples", TRENDS_LIMITS.examples, (e, p) => {
    if (!isObj(e)) return need(false, p, "must be an object");
    need(isTextOrNull(e.title, TRENDS_TEXT_MAX.title), `${p}.title`, `must be one line of at most ${TRENDS_TEXT_MAX.title} characters or null`);
    let url: URL | null = null;
    try {
      url = typeof e.url === "string" ? new URL(e.url) : null;
    } catch {
      url = null;
    }
    need(!!url && url.protocol === "https:" && e.url === url.href, `${p}.url`, "must be an https link");
    need(isId(e.platform), `${p}.platform`, "must be a platform");
    for (const k of ["views", "viewsPerDay", "durationSec"]) need(e[k] === null || (isNum(e[k]) && (e[k] as number) >= 0), `${p}.${k}`, "must be a number or null");
    need(isTextOrNull(e.query, TRENDS_TEXT_MAX.query), `${p}.query`, "must be a short line or null");
  });
  return errors;
}

/** The summary when it is sound, else null (a broken or missing file never reaches a prompt). */
export function parseTrends(value: unknown): TrendSummary | null {
  return validateTrends(value).length === 0 ? (value as TrendSummary) : null;
}
