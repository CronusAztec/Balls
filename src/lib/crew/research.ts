import { selectPlaybookContext, trendsAgeDays, TRENDS_DROP_DAYS, TRENDS_OLD_DAYS } from "@/lib/desktop/ai/playbookContext";
import type { TrendAdvice, TrendLever, TrendNumber, TrendSummary } from "@/lib/trends";
import { BRIEF_POINT_IDS, oneLine, type ResearchArea, type ResearchLever, type ResearchPoint, type ResearchResult, type Strength } from "./roles";

/*
 * --- crew --- The research the crew reads: one digest of the evidence, budgeted (RESEARCH_CHARS), every item with a source id the
 * roles cite, and the brief made of it – at most five pieces of advice, each naming a lever we can set and how strong its
 * evidence is, so the other roles read a few hundred characters instead of thousands and a weak finding reads as weak.
 *
 * The digest (researchDigest) is offline in every case – no host, no privacy change:
 *  - the committed trend summary (src/content/trends.json, lib/trends.ts): its advice in our levers, tagged with what it rests
 *    on; marked stale from TRENDS_OLD_DAYS and left out from TRENDS_DROP_DAYS, as the app's other prompts do;
 *  - the playbook (docs/virality-playbook.md): lib/desktop/ai/playbookContext.ts selectPlaybookContext's excerpt (the recipe,
 *    §3, always in; the trend data's own section never), a source a line – its sentences, never a table's rows, which mean
 *    nothing one by one (the studio's real run had read the head "| | Bot look | Simple look |" as a source);
 *  - lines the caller hands in: the owner's Library history (the app, a later step) and the local inspire dataset by theme (the
 *    toolbox). Other creators' titles and channel names never enter it: the trend summary carries none in its advice, and the
 *    caller's lines are its own aggregates.
 * The brief (researchBriefOf) is built from it by code, which costs no model call: the researcher's model pass (roles.ts) runs
 * only where live research exists (Claude in the toolbox, a cloud model with web search), on the same digest.
 *
 * Research advises and never gates: the planner never reads it, so plans stay deterministic. Pure: the clock is the caller's
 * (`now`), the texts are handed in.
 */

// --- crew ---

/** The digest's budget (characters). */
export const RESEARCH_CHARS = 1500;
/** The brief's share in each role's prompt (characters): the researcher reads the digest whole. */
export const BRIEF_CHARS = { brainstormer: 600, reviewer: 300, producer: 300 } as const;
const ADVICE_MAX = 120;
const LINE_MAX = 240;

export type ResearchSourceKind = "trend" | "playbook" | "library" | "inspire";

export interface ResearchSource {
  /** "t1", "p2", "l1", "i3": what a point's basis names. */
  id: string;
  kind: ResearchSourceKind;
  text: string;
  /** A trend advice's area, lever and strength (the brief's point is made of them). */
  area?: ResearchArea;
  lever?: ResearchLever | null;
  strength?: Strength;
  /** A trend benchmark (what the most viewed do, the rest too): last in the budget. */
  benchmark?: boolean;
}

export interface ResearchDigest {
  v: 1;
  /** The trend summary's date (null: none read). */
  date: string | null;
  /** The trend summary is TRENDS_OLD_DAYS old or more. */
  stale: boolean;
  sources: ResearchSource[];
  /** The digest as the researcher reads it: one line per source, "[t1] …", within RESEARCH_CHARS. */
  text: string;
}

export interface DigestInput {
  playbook?: string | null;
  trends?: TrendSummary | null;
  /** The clock (ms) the summary's age is read on; without it the summary is read as current. */
  now?: number;
  /** What the playbook excerpt is chosen for (the request's words). */
  query?: string;
  /** The owner's own Library history, in lines (the app). */
  library?: readonly string[];
  /** The local inspire dataset by theme, in lines (the toolbox). */
  inspire?: readonly string[];
}

const flat = oneLine;
/** A text cut at a word to `max` characters ("…" where cut). */
function cut(text: string, max: number): string {
  const t = flat(text);
  if (t.length <= max) return t;
  const head = t.slice(0, max - 1);
  const at = head.lastIndexOf(" ");
  return `${(at > max / 2 ? head.slice(0, at) : head).replace(/[\s,;:.–-]+$/, "")}…`;
}

const AREA_OF: Readonly<Record<string, ResearchArea>> = { hook: "hook", pace: "pace", length: "length", look: "look", sound: "sound", mode: "mode", blueprint: "mode", title: "title", format: "look" };

/** What an advice rests on, in words and as a strength: a clear pattern is moderate (strong on 50 videos or more), a hint weak. */
function strengthOf(r: TrendAdvice, summary: TrendSummary): { strength: Strength; tag: string } {
  const numbers = (r.traits ?? []).map((k) => summary.numbers.find((n) => n.trait === k)).filter((n): n is TrendNumber => !!n);
  const main = numbers.find((n) => n.strength !== null) ?? numbers[0];
  const p = main?.p === null || main?.p === undefined ? "" : `, p ${Math.round(main.p * 1000) / 1000}`;
  if (r.basis === "pattern") {
    const strength: Strength = main?.strength === "clear" ? (main.n >= 50 ? "strong" : "moderate") : "weak";
    return { strength, tag: `pattern${main?.strength ? ` (${main.strength})` : ""}${main ? `, n ${main.n}${p}` : ""}` };
  }
  if (r.basis === "gap") return { strength: "moderate", tag: `our renders differ${main ? `, n ${main.n}` : ""}` };
  if (r.basis === "theme") return { strength: "weak", tag: "a theme ranked on a few videos" };
  return { strength: "weak", tag: `benchmark: the rest do it too${main ? `, n ${main.n}` : ""}` };
}

/** An advice's first lever we can set (a setting, a mode; a Blueprint plays in the blueprint mode); null: none. */
function leverOf(levers: readonly TrendLever[]): ResearchLever | null {
  for (const l of levers) {
    if (l.kind === "setting" && l.name !== "captions") return { kind: "setting", name: cut(l.name, 40) };
    if (l.kind === "mode") return { kind: "mode", name: cut(l.name, 40) };
    if (l.kind === "blueprint") return { kind: "mode", name: "blueprint" };
  }
  return null;
}

/** The research digest (see the header). */
export function researchDigest(input: DigestInput): ResearchDigest {
  const trends = input.trends ?? null;
  const age = trends ? (input.now === undefined ? 0 : trendsAgeDays(trends.date, input.now)) : null;
  const useTrends = !!trends && age !== null && age < TRENDS_DROP_DAYS;
  const stale = useTrends && (age ?? 0) >= TRENDS_OLD_DAYS;
  const sources: ResearchSource[] = [];
  if (useTrends && trends) {
    trends.recommendations.forEach((r) => {
      const { strength, tag } = strengthOf(r, trends);
      const lever = leverOf(r.levers);
      sources.push({ id: "", kind: "trend", text: `${cut(r.advice, 180)} [${tag}]`, area: AREA_OF[r.area] ?? "look", lever, strength, benchmark: r.basis === "benchmark" });
    });
  }
  // the trend advice that separates the most viewed first, then the benchmarks (each numbered in that order)
  const trendSources = [...sources.filter((s) => !s.benchmark), ...sources.filter((s) => s.benchmark)].map((s, i) => ({ ...s, id: `t${i + 1}` }));
  const playbook = input.playbook ? selectPlaybookContext(input.playbook, input.query ?? "hook payoff countdown simple one idea", 700) : "";
  const playbookSources: ResearchSource[] = playbook
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("## ") && !/^\s*\|/.test(l))
    .map((l, i) => ({ id: `p${i + 1}`, kind: "playbook", text: cut(l, LINE_MAX) }));
  const own = (lines: readonly string[] | undefined, prefix: string, kind: ResearchSourceKind) => (lines ?? []).map((l) => flat(l)).filter(Boolean).map((l, i) => ({ id: `${prefix}${i + 1}`, kind, text: cut(l, LINE_MAX) }));
  const ordered = [
    ...trendSources.filter((s) => !s.benchmark),
    ...playbookSources,
    ...own(input.library, "l", "library"),
    ...own(input.inspire, "i", "inspire"),
    ...trendSources.filter((s) => s.benchmark),
  ];
  const head = trends && useTrends ? `Research (the trend summary of ${trends.date}${stale ? `, ${age} days old: weigh it lightly` : ""}; tendencies to test, not rules):` : "Research (no trend summary; the playbook and your own history):";
  const kept: ResearchSource[] = [];
  let used = head.length;
  for (const s of ordered) {
    const line = `[${s.id}] ${s.text}`;
    if (used + 1 + line.length > RESEARCH_CHARS) continue;
    kept.push(s);
    used += 1 + line.length;
  }
  return { v: 1, date: useTrends && trends ? trends.date : null, stale, sources: kept, text: [head, ...kept.map((s) => `[${s.id}] ${s.text}`)].join("\n") };
}

/** The brief by code (no model): the trend advice of the digest, in its order, as at most five points. */
export function researchBriefOf(digest: ResearchDigest): ResearchResult {
  const points: ResearchPoint[] = digest.sources
    .filter((s) => s.kind === "trend")
    .slice(0, BRIEF_POINT_IDS.length)
    .map((s, i) => ({ id: BRIEF_POINT_IDS[i], area: s.area ?? "look", advice: cut(s.text.replace(/\s*\[[^\]]*\]$/, ""), ADVICE_MAX), lever: s.lever ?? null, basis: s.id, strength: s.strength ?? "weak" }));
  return { points, stale: digest.stale };
}

/**
 * The brief as a role reads it, within `max` characters: a line per point, `[r1] (weak, pace) "advice" (lever: setting "bpm")`.
 * The texts are the researcher model's where live research exists, so each is flattened and quoted as a JSON string, as the
 * reviewer gets the objections: data inside the line code writes, never a prompt line of its own.
 */
export function briefText(brief: ResearchResult | null, max: number): string {
  if (!brief || brief.points.length === 0) return "none";
  const lines: string[] = [];
  let used = 0;
  for (const p of brief.points) {
    const line = `[${p.id}] (${p.strength}${p.area ? `, ${p.area}` : ""}) ${JSON.stringify(flat(p.advice))}${p.lever ? ` (lever: ${p.lever.kind} ${JSON.stringify(flat(p.lever.name))})` : ""}`;
    if (used + line.length + 1 > max) continue;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.length ? `${lines.join("\n")}${brief.stale ? "\n(the research is old: weigh it lightly)" : ""}` : "none";
}

/** The research gap of a clip's dossier: the brief's first two points, a line each. */
export function researchGapOf(brief: ResearchResult | null): string[] {
  return (brief?.points ?? []).slice(0, 2).map((p) => `${p.id} ${p.strength}: ${flat(p.advice)}`);
}
// --- end crew ---
