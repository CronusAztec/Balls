import { GENERIC_THEMES, MIN_THEME_VIDEOS, clipTraits, recommendations, themeShares, titleSummary, traitSummaries, type ClipTraits, type InspirationReport, type MetricRow } from "./inspiration";
import { TRENDS_LIMITS, TRENDS_TEXT_MAX, TRENDS_VERSION, validateTrends, type TrendAdvice, type TrendExample, type TrendNumber, type TrendSummary } from "@/lib/trends";

/*
 * --- trends --- The trend summary of the inspire reports (`npm run trends -- <report.json …>`, scripts/trends.mjs): every
 * report's videos pooled – one per video, its newest numbers –, the short-form ones compared as one list by the reports'
 * metric with the inspire report's own maths (lib/agentKit/inspiration.ts: the traits' medians and Spearman's ρ, the themes'
 * lift, the title formats, the recommendations in our levers), and kept compact for src/content/trends.json (lib/trends.ts
 * is its shape and check). Our own renders are left out: the summary says what is trending, not how far a test render is.
 * Pure: the same reports give the same summary.
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
}

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
  };
};

export interface TrendOptions {
  /** The site's mode ids (a theme names only modes that exist). */
  modes: readonly string[];
  /** YYYY-MM-DD; default: the newest report's day. */
  date?: string;
}

/** The trend summary of `reports` (see the header); throws when there is none or the result fails lib/trends.ts's check. */
export function buildTrendSummary(reports: readonly InspirationReport[], options: TrendOptions): TrendSummary {
  if (!reports.length) throw new Error("No inspire report given");
  const ordered = [...reports].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const metric = ordered.every((r) => r.metric === "viewsPerDay") ? "viewsPerDay" : "views";
  // one per video: its newest numbers (a later report wins)
  const byKey = new Map<string, Pooled>();
  for (const r of ordered) for (const v of r.videos) byKey.set(v.key, pooledOf(v, r));
  const videos = [...byKey.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  const compared = videos.filter((v) => v.compared);
  const metricOf = (v: Pooled) => (metric === "viewsPerDay" ? v.viewsPerDay : v.views);
  const rows: MetricRow[] = compared.flatMap((v) => (metricOf(v) === null ? [] : [{ metric: metricOf(v) as number, traits: v.traits }]));
  const { summaries, patterns } = traitSummaries(rows);
  const titled = compared.filter((v) => metricOf(v) !== null);
  const titles = titleSummary(titled, titled.map((v) => metricOf(v) as number));
  const themes = themeShares(compared, options.modes);
  const recs = recommendations(summaries, patterns, themes, titles);

  const numbers: TrendNumber[] = summaries
    .filter((s) => s.n >= 3 && (s.top !== null || s.all !== null))
    .slice(0, TRENDS_LIMITS.numbers)
    .map((s) => ({ trait: s.key, label: s.label, unit: s.unit, top: s.top, rest: s.rest, all: s.all, rho: s.rho, n: s.n, strength: patterns.find((p) => p.key === s.key)?.strength ?? null }));
  const advice: TrendAdvice[] = recs.slice(0, TRENDS_LIMITS.recommendations).map((r) => ({
    area: r.area,
    advice: r.advice.length > TRENDS_TEXT_MAX.advice ? `${r.advice.slice(0, TRENDS_TEXT_MAX.advice - 1)}…` : r.advice,
    basis: r.basis,
    levers: r.levers.slice(0, TRENDS_LIMITS.levers).map((l) => ({ kind: l.kind, name: l.name, ...(l.link !== undefined ? { link: l.link } : {}), ...(l.value !== undefined ? { value: l.value } : {}) })),
  }));
  const examples: TrendExample[] = [...titled]
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
    themes: themes.slice(0, TRENDS_LIMITS.themes).map((t) => ({
      id: t.id,
      label: t.label,
      videos: t.videos,
      viewShare: t.viewShare,
      videoShare: t.videoShare,
      lift: t.lift,
      // advice as the report gives it: from two videos, above their share of the views, never the genre's own word
      advised: t.videos >= MIN_THEME_VIDEOS && t.lift >= 1 && !GENERIC_THEMES.includes(t.id),
      modes: t.modes.slice(0, TRENDS_LIMITS.modes),
      blueprints: t.blueprints.slice(0, TRENDS_LIMITS.modes),
    })),
    formats: titles.formats.slice(0, TRENDS_LIMITS.formats),
    words: titles.topWords
      .filter((w) => w.word.length <= TRENDS_TEXT_MAX.word && !/[<>`]/.test(w.word))
      .slice(0, TRENDS_LIMITS.words),
    recommendations: advice,
    examples,
  };
  const problems = validateTrends(summary);
  if (problems.length) throw new Error(`The trend summary fails its check: ${problems.slice(0, 5).join("; ")}`);
  return summary;
}
