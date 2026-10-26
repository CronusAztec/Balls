import { MIN_VIDEOS_FOR_ADVICE, TRAITS, clipTraits, percentiles, recommendations, themeShares, titleSummary, traitScope, traitSummaries, type ClipTraits, type InspirationReport, type MetricRow, type Pattern } from "./inspiration";
import { TRENDS_LIMITS, TRENDS_MAX_CHARS, TRENDS_TEXT_MAX, TRENDS_VERSION, productWord, trendsChars, validateTrends, type TrendAdvice, type TrendExample, type TrendNumber, type TrendSummary } from "@/lib/trends";

export { validateTrends }; // (npm run trends --check: scripts/trends.mjs loads this file alone, scripts/agent/bundle.mjs loadTrendsKit)

/*
 * --- trends --- The trend summary of the inspire reports (`npm run trends -- <report.json …>`, scripts/trends.mjs): every
 * report's videos pooled – one per video: its newest numbers and title, and the traits of its best measurement (the video
 * itself, else its stills, else its page) in any report –, the short-form ones compared with the inspire report's own maths
 * (lib/agentKit/inspiration.ts: the traits' medians and Spearman's ρ, the themes' ranks, the title formats, the
 * recommendations in our levers), and kept compact for src/content/trends.json (lib/trends.ts is its shape and check).
 *
 * Each search is its own list: a video is ranked within its report first (its view percentile there; the mean of them for a
 * video in several), and the pool compares those ranks, never absolute views – a query of 3D cloth renders with millions
 * of views would otherwise be "the most viewed" of a pool with a query of 2D clips. A pattern also has to point the same
 * way in every report that shows it on its own (3 videos or more): one that a report contradicts is a split between the
 * searches, not what separates the most viewed. And where the reports' own most viewed are more than two steps apart on a
 * trait (one search's top is dark, another's light), the trait is `split`: its pooled median describes no search, so it
 * gives no advice and the prompt shows the range. Our own renders are left out: the summary says what is trending, not how
 * far a test render is. Pure: the same reports give the same summary.
 */

/** The fields of a report's video the summary reads (an older report lacks compared, measured and stills). */
type ReportVideoIn = InspirationReport["videos"][number];

interface Pooled {
  key: string;
  url: string;
  platform: string;
  title: string | null;
  views: number | null;
  viewsPerDay: number | null;
  durationSec: number | null;
  short: boolean;
  compared: boolean;
  measured: "video" | "stills" | "page";
  traits: ClipTraits;
  query: string | null;
  at: string;
  /** --- trends --- Its view percentile in each report that compared it (by the summary's metric), by the report's time. */
  ranks: Map<number, number>;
  /** --- trends --- Their mean: what the pool compares on (null when no report ranked it). */
  pct: number | null;
}

/** --- trends --- What a video's traits come from, the better first: the video itself, its stills, its page. */
const MEASURED_ORDER: Record<Pooled["measured"], number> = { page: 0, stills: 1, video: 2 };

/** Other creators' title as one clean line of at most TRENDS_TEXT_MAX.title characters (or null). */
export function cleanTitle(title: string | null | undefined): string | null {
  if (typeof title !== "string") return null;
  const t = title
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  return t.length > TRENDS_TEXT_MAX.title ? `${t.slice(0, TRENDS_TEXT_MAX.title - 1)}…` : t;
}

const pooledOf = (v: ReportVideoIn, report: InspirationReport): Pooled => {
  const measured = v.measured ?? (v.analysed ? "video" : "page");
  const traits = v.traits ?? clipTraits(null, { durationSec: v.durationSec, width: null, height: null });
  return {
    key: v.key,
    url: v.url,
    platform: v.platform,
    title: v.title,
    views: v.views,
    viewsPerDay: v.viewsPerDay,
    durationSec: v.durationSec,
    short: !!v.short,
    // an older report compared every video; a short-form one only the short ones
    compared: v.compared ?? true,
    measured,
    traits,
    query: report.query,
    at: report.at,
    ranks: new Map(),
    pct: null,
  };
};

export interface TrendOptions {
  /** The site's mode ids (a theme names only modes that exist). */
  modes: readonly string[];
  /** YYYY-MM-DD; default: the newest report's day. */
  date?: string;
}

/** The trend summary of `reports` (see the header); throws when there is none or the result fails lib/trends.ts's check. */
/**
 * --- trends --- Keeps a summary under TRENDS_MAX_CHARS, however many reports it pools: sheds the least telling rows first
 * (examples past the top three, themes that are no advice, title words past six, numbers that are no pattern, then the
 * last recommendations past six), one row at a time, and fails rather than cut what the advice rests on.
 */
export function fitTrends(summary: TrendSummary): void {
  const steps: (() => boolean)[] = [
    () => summary.examples.length > 3 && summary.examples.pop() !== undefined,
    () => {
      const i = summary.themes.map((t) => t.advised).lastIndexOf(false);
      return i >= 0 && summary.themes.splice(i, 1).length > 0;
    },
    () => summary.words.length > 6 && summary.words.pop() !== undefined,
    () => {
      const i = summary.numbers.map((n) => n.strength === null).lastIndexOf(true);
      return i >= 0 && summary.numbers.splice(i, 1).length > 0;
    },
    () => summary.recommendations.length > 6 && summary.recommendations.pop() !== undefined,
  ];
  for (const shed of steps) while (trendsChars(summary) >= TRENDS_MAX_CHARS && shed());
  if (trendsChars(summary) >= TRENDS_MAX_CHARS) throw new Error(`The trend summary is ${trendsChars(summary)} characters even trimmed, over its ceiling of ${TRENDS_MAX_CHARS}`);
}

export function buildTrendSummary(reports: readonly InspirationReport[], options: TrendOptions): TrendSummary {
  if (!reports.length) throw new Error("No inspire report given");
  const ordered = [...reports].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const metric = ordered.every((r) => r.metric === "viewsPerDay") ? "viewsPerDay" : "views";
  const metricOf = (v: Pick<Pooled, "views" | "viewsPerDay">) => (metric === "viewsPerDay" ? v.viewsPerDay : v.views);
  // one per video, field by field: the newest numbers, title and link (a later report wins), the traits of its best
  // measurement (video, then stills, then page; the newer of two alike) – a later run that could only list it keeps them –
  // and its rank in every report that compared it
  const byKey = new Map<string, { latest: Pooled; best: Pooled; ranks: Map<number, number> }>();
  ordered.forEach((r, ri) => {
    const listed = r.videos.filter((v) => v.compared ?? true);
    const pct = percentiles(listed.map((v) => metricOf(v)));
    const rankOf = new Map(listed.flatMap((v, i) => (pct[i] === null ? [] : [[v.key, pct[i] as number] as const])));
    for (const v of r.videos) {
      const p = pooledOf(v, r);
      const had = byKey.get(v.key) ?? { latest: p, best: p, ranks: new Map<number, number>() };
      had.latest = p;
      if (MEASURED_ORDER[p.measured] >= MEASURED_ORDER[had.best.measured]) had.best = p;
      const rank = rankOf.get(v.key);
      if (rank !== undefined) had.ranks.set(ri, rank);
      byKey.set(v.key, had);
    }
  });
  const videos: Pooled[] = [...byKey.values()]
    .map(({ latest, best, ranks }) => {
      const measured = best.measured;
      const all = [...ranks.values()];
      return { ...latest, measured, traits: measured === "page" ? latest.traits : best.traits, ranks, pct: all.length ? Math.round((all.reduce((a, b) => a + b, 0) / all.length) * 10_000) / 10_000 : null };
    })
    .sort((a, b) => (a.key < b.key ? -1 : 1));
  const compared = videos.filter((v) => v.compared);
  // the pool compares the videos' ranks in their own reports
  const ranked = compared.filter((v) => v.pct !== null);
  const rows: MetricRow[] = ranked.map((v) => ({ metric: v.pct as number, traits: v.traits, measured: v.measured }));
  const pooled = traitSummaries(rows);
  // and every report on its own: a pattern one of them contradicts is dropped
  const bySource = ordered.map((_, ri) => traitSummaries(compared.flatMap((v) => (v.ranks.has(ri) ? [{ metric: v.ranks.get(ri) as number, traits: v.traits }] : []))).summaries);
  const agreement = (key: string, rho: number | null) => {
    let same = 0;
    let opposite = 0;
    for (const list of bySource) {
      const own = list.find((s) => s.key === key)?.rho ?? null;
      if (rho === null || own === null || own === 0 || rho === 0) continue;
      if (Math.sign(own) === Math.sign(rho)) same++;
      else opposite++;
    }
    return { same, opposite };
  };
  const summaries = pooled.summaries;
  const patterns: Pattern[] = pooled.patterns.filter((p) => agreement(p.key, summaries.find((s) => s.key === p.key)?.rho ?? null).opposite === 0);
  // each report's own most viewed (its top third's median, from MIN_VIDEOS_FOR_ADVICE videos with the trait), the newest
  // reports' as the summary lists them; a trait whose reports' tops are more than two steps apart is split
  const shown = bySource.slice(-TRENDS_LIMITS.sources);
  const topsOf = (key: string) => shown.map((list) => list.find((s) => s.key === key && s.n >= MIN_VIDEOS_FOR_ADVICE)?.top ?? null);
  const splitOf = (key: string) => {
    const tops = bySource.map((list) => list.find((s) => s.key === key && s.n >= MIN_VIDEOS_FOR_ADVICE)?.top ?? null).filter((t): t is number => t !== null);
    const step = TRAITS.find((t) => t.key === key)?.step ?? 0;
    return tops.length >= 2 && Math.max(...tops) - Math.min(...tops) > 2 * step;
  };
  const titles = titleSummary(ranked, ranked.map((v) => v.pct as number));
  const themes = themeShares(
    compared.map((v) => ({ title: v.title, views: v.views, pct: v.pct })),
    options.modes,
  );
  // a split trait's pooled median is no benchmark: no advice from it
  const recs = recommendations(
    summaries.map((s) => (splitOf(s.key) ? { ...s, top: null } : s)),
    patterns,
    themes,
    titles,
  );

  const numbers: TrendNumber[] = summaries
    .filter((s) => s.n >= 3 && (s.top !== null || s.all !== null))
    .slice(0, TRENDS_LIMITS.numbers)
    .map((s) => ({ trait: s.key, label: s.label, unit: s.unit, top: s.top, rest: s.rest, all: s.all, rho: s.rho, p: s.p, n: s.n, from: { ...s.from }, strength: patterns.find((p) => p.key === s.key)?.strength ?? null, scope: traitScope(s.key), agreement: agreement(s.key, s.rho), tops: topsOf(s.key), split: splitOf(s.key) }));
  const advice: TrendAdvice[] = recs.slice(0, TRENDS_LIMITS.recommendations).map((r) => ({
    area: r.area,
    advice: r.advice.length > TRENDS_TEXT_MAX.advice ? `${r.advice.slice(0, TRENDS_TEXT_MAX.advice - 1)}…` : r.advice,
    basis: r.basis,
    levers: r.levers.slice(0, TRENDS_LIMITS.levers).map((l) => ({ kind: l.kind, name: l.name, ...(l.link !== undefined ? { link: l.link } : {}), ...(l.value !== undefined ? { value: Array.isArray(l.value) ? [...l.value] : l.value } : {}) })),
    traits: r.traits.slice(0, TRENDS_LIMITS.levers),
  }));
  const examples: TrendExample[] = compared
    .filter((v) => metricOf(v) !== null)
    .sort((a, b) => (metricOf(b) as number) - (metricOf(a) as number) || (a.key < b.key ? -1 : 1))
    .filter((v) => /^https:\/\//.test(v.url))
    .slice(0, TRENDS_LIMITS.examples)
    .map((v) => ({ title: cleanTitle(v.title), url: v.url, platform: v.platform, views: v.views, viewsPerDay: v.viewsPerDay, durationSec: v.durationSec, query: v.query }));
  const platforms: Record<string, number> = {};
  for (const v of compared) platforms[v.platform] = (platforms[v.platform] ?? 0) + 1;
  const newest = ordered[ordered.length - 1].at;
  const summary: TrendSummary = {
    v: TRENDS_VERSION,
    date: options.date ?? newest.slice(0, 10),
    metric,
    sources: ordered.slice(-TRENDS_LIMITS.sources).map((r) => ({
      query: r.query,
      at: r.at,
      videos: r.videos.length,
      compared: r.videos.filter((v) => v.compared ?? true).length,
      measured: r.videos.filter((v) => v.analysed).length,
      stills: r.videos.filter((v) => v.measured === "stills").length,
    })),
    sample: {
      videos: videos.length,
      compared: compared.length,
      measured: compared.filter((v) => v.measured === "video").length,
      stills: compared.filter((v) => v.measured === "stills").length,
      views: compared.reduce((s, v) => s + (v.views ?? 0), 0),
      platforms,
    },
    numbers,
    // the themes that are advice first, the furthest above the others first (none is cut off by the list's length), then
    // the rest by their share of the views
    themes: [...themes.filter((t) => t.advised).sort((a, b) => (b.rank ?? 0) - (b.restRank ?? 0) - ((a.rank ?? 0) - (a.restRank ?? 0)) || (a.id < b.id ? -1 : 1)), ...themes.filter((t) => !t.advised)].slice(0, TRENDS_LIMITS.themes).map((t) => ({
      id: t.id,
      label: t.label,
      videos: t.videos,
      viewShare: t.viewShare,
      videoShare: t.videoShare,
      lift: t.lift,
      rank: t.rank,
      restRank: t.restRank,
      rankWithoutTop: t.rankWithoutTop,
      topShare: t.topShare,
      // advice as the report gives it (inspiration.ts themeAdvised): by the videos' ranks in their own reports
      advised: t.advised,
      modes: t.modes.slice(0, TRENDS_LIMITS.modes),
      blueprints: t.blueprints.slice(0, TRENDS_LIMITS.modes),
    })),
    formats: titles.formats.slice(0, TRENDS_LIMITS.formats),
    titles: { n: titles.n, top: titles.top },
    // --- trends --- the words that may describe clips like ours: no platform tag, no 3D-render or game-engine genre
    words: titles.topWords
      .filter((w) => w.word.length <= TRENDS_TEXT_MAX.word && !/[<>`]/.test(w.word) && productWord(w.word))
      .slice(0, TRENDS_LIMITS.words),
    recommendations: advice,
    examples,
  };
  fitTrends(summary);
  const problems = validateTrends(summary);
  if (problems.length) throw new Error(`The trend summary fails its check: ${problems.slice(0, 5).join("; ")}`);
  return summary;
}
