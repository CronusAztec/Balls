/*
 * --- desktop-exe --- Grounding for the AI idea generator: docs/virality-playbook.md (bundled with the app) split into its
 * sections and bullet points, and the ones closest to the user's request picked within a character budget – a small local
 * model's context holds a few thousand tokens, not the whole research. The recipe (§3) always goes in; the rest is ranked
 * by shared words with the request (a plain term-frequency score, no embeddings, so it runs offline and instantly).
 *
 * --- trends --- Beside it, what is trending (trendingContext): the committed trend summary of other creators' trending and
 * viral simulation videos (src/content/trends.json), in a few lines within a budget of its own. The playbook's own section
 * on that data (§6, for people: what the runs found on one day) is never picked: its numbers are frozen and would repeat or
 * contradict the summary, which the block reads fresh.
 */

import { productWord, type TrendAdvice, type TrendFormat, type TrendLever, type TrendNumber, type TrendSummary, type TrendTheme } from "@/lib/trends";

export interface PlaybookChunk {
  /** "3. The recipe the bot follows" – the section it belongs to. */
  section: string;
  /** --- trends --- Its top-level (##) section: the same, or the one a ### subsection sits in. */
  part: string;
  text: string;
}

/** --- trends --- The playbook's top-level sections the app never reads: the trend data's own (trendingContext reads it fresh). */
export const PLAYBOOK_SKIPPED_PART = /^\d+\.\s*What is trending\b/i;

const STOP = new Set("a an and are as at be by for from has have in into is it its of on or that the this to was were will with you your we our they their them not no do does did can".split(" "));

/** The words of a text worth matching (lower case, 3+ letters, no stop words). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9ąćęłńóśźżáéíñóúü]{3,}/g) ?? []).filter((w) => !STOP.has(w));
}

/** The playbook's chunks: every paragraph, bullet, numbered item and table row, with its section heading. */
export function splitPlaybook(markdown: string): PlaybookChunk[] {
  const chunks: PlaybookChunk[] = [];
  let section = "";
  let part = "";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text && section) chunks.push({ section, part, text });
    buffer = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      section = heading[2].trim();
      if (heading[1].length === 2) part = section;
      continue;
    }
    if (/^#\s/.test(line)) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*]|\d+\.|\|)\s/.test(line) && !/^\|[-\s|]+\|?$/.test(line.trim())) flush();
    if (/^\|[-\s|]+\|?$/.test(line.trim())) continue;
    buffer.push(line.trim());
  }
  flush();
  return chunks;
}

/**
 * The playbook text to put in the prompt for `query`: the recipe section first (it is what the bot does), then the chunks
 * that share the most words with the query, each under its section heading, until `maxChars` is spent.
 */
export function selectPlaybookContext(markdown: string, query: string, maxChars = 5000): string {
  const chunks = splitPlaybook(markdown).filter((c) => !PLAYBOOK_SKIPPED_PART.test(c.part)); // --- trends ---
  if (chunks.length === 0) return "";
  const wanted = new Set(terms(query));
  const scored = chunks.map((chunk, index) => {
    const words = terms(chunk.text);
    const hits = words.filter((w) => wanted.has(w)).length;
    const recipe = /recipe/i.test(chunk.section);
    return { chunk, index, score: (recipe ? 1000 : 0) + hits / Math.sqrt(words.length + 1) };
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  const picked: { chunk: PlaybookChunk; index: number }[] = [];
  let used = 0;
  for (const s of scored) {
    const cost = s.chunk.text.length + 2;
    if (used + cost > maxChars) continue;
    picked.push(s);
    used += cost;
  }
  // Back in document order, grouped under their headings.
  picked.sort((a, b) => a.index - b.index);
  const out: string[] = [];
  let current = "";
  for (const { chunk } of picked) {
    if (chunk.section !== current) {
      current = chunk.section;
      out.push(`## ${current}`);
    }
    out.push(chunk.text);
  }
  return out.join("\n");
}

/* ------------------------------------------------------------------ --- trends --- what is trending */

/**
 * --- trends --- The longest "What is trending" block each job takes (characters). The planner and the idea generator take
 * it out of their playbook budget (3,000 and 4,500 characters: the research they read stays as long as it was), Make
 * videos, which reads no playbook, adds it: about 200 tokens.
 */
export const TRENDING_CHARS = { plan: 600, ideas: 900, videos: 700 } as const;

/**
 * --- trends --- Who reads the block: "clips" the idea generator (every line, each advice tagged with what it rests on),
 * "videos" Make videos (told to lean toward it, so no benchmark-only advice: a number that does not separate the most
 * viewed is no reason to change a clip), "copy" the post planner (it writes text and times: the title formats and words).
 */
export type TrendingFocus = "clips" | "videos" | "copy";

const PLATFORM_NAMES: Record<string, string> = { youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels" };
const pct = (share: number) => `${Math.round(share * 100)}%`;
/** --- trends --- A lever as the prompt names it: a setting with its value (a colour list as [#a, #b]; [] the rainbow trail). */
const leverText = (l: TrendLever) => {
  if (l.kind !== "setting") return `${l.kind} ${l.name}`;
  if (l.value === undefined) return l.name;
  if (Array.isArray(l.value)) return `${l.name} [${l.value.join(", ")}]${l.value.length === 0 && l.name === "trailColors" ? " (the rainbow)" : ""}`;
  return `${l.name} ${String(l.value)}`;
};
/** --- trends --- (captions are a list no settings patch sets: a clip's hook carries the question at 0 s instead) */
const PROMPT_LEVER = (l: TrendLever) => l.kind !== "tool" && !(l.kind === "setting" && l.name === "captions");
/** --- trends --- A p-value as the tags print it. */
const pShort = (p: number | null) => (p === null ? "p –" : p < 0.001 ? "p < 0.001" : `p ${p < 0.1 ? Math.round(p * 1000) / 1000 : Math.round(p * 100) / 100}`);
/** --- trends --- What a number's videos were measured from: "39 stills", "8 measured, 12 pages". */
const sourceText = (n: TrendNumber) => {
  const parts = [n.from.video ? `${n.from.video} measured whole` : "", n.from.stills ? `${n.from.stills} from stills` : "", n.from.page ? `${n.from.page} from pages` : ""].filter(Boolean);
  return parts.length ? parts.join(", ") : "source unknown";
};

/**
 * --- trends --- What an advice rests on, in brackets after it: a pattern's ρ, n, p and source, a benchmark said to be one
 * (it does not separate the most viewed), a title pattern's sample – so a hunch never reads as an instruction.
 */
function adviceTag(r: TrendAdvice, summary: TrendSummary): string {
  const numbers = (r.traits ?? []).map((k) => summary.numbers.find((n) => n.trait === k)).filter((n): n is TrendNumber => !!n);
  const main = numbers.find((n) => n.strength !== null) ?? numbers[0];
  const rho = (n: TrendNumber) => (n.rho === null ? "rho –" : `rho ${n.rho > 0 ? "+" : ""}${n.rho}`);
  if (r.basis === "pattern" && main) return `[pattern${main.strength ? ` (${main.strength})` : ""} ${rho(main)}, n ${main.n}, ${pShort(main.p)}; ${sourceText(main)}]`;
  if (r.basis === "pattern" && r.area === "title") return `[pattern in titles: the most viewed third, n ${summary.titles.top} of ${summary.titles.n}]`;
  if (r.basis === "benchmark") return `[benchmark: does not separate the most viewed${main ? `; n ${main.n}, ${sourceText(main)}` : ""}]`;
  if (r.basis === "gap") return `[gap: our renders differ${main ? `; n ${main.n}, ${sourceText(main)}` : ""}]`;
  return `[${r.basis}]`;
}

/**
 * The "What is trending" block for a prompt, from the committed trend summary (src/content/trends.json, lib/trends.ts):
 * a heading with its date and sample (how many videos were measured whole, how many seen only through their stills), then
 * lines by priority – for clips the advice in our levers that separates the most viewed (each tagged with what it rests
 * on), the themes whose videos rank above the others' (with their count, and our modes for them), the title formats (those
 * the most viewed use more apart from those they use less), the benchmarks (tagged as such), the look of the most viewed
 * and the words of their titles; for Make videos the same without the benchmarks; for copy (the planner) the title
 * formats and words alone – each kept only while the block stays within `maxChars`. No title is quoted: other creators' text stays data. "" without a summary.
 */
export function trendingContext(summary: TrendSummary | null | undefined, maxChars: number, focus: TrendingFocus = "clips"): string {
  if (!summary || maxChars <= 0) return "";
  const where = Object.entries(summary.sample.platforms)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => PLATFORM_NAMES[p] ?? p)
    .join(", ");
  const searches = summary.sources.length;
  // --- trends --- what the sample's numbers come from: the videos measured whole, those seen only through their stills
  // (colours, no motion or sound), the rest from their pages (length and shape)
  const { compared, measured, stills } = summary.sample;
  const pages = Math.max(0, compared - measured - stills);
  const basis = `${measured} measured whole, ${stills} seen only through their stills${pages ? `, ${pages} from their pages` : ""}`;
  const head = `What is trending (${summary.date}, ${compared} short-form simulation videos${where ? ` on ${where}` : ""}, ${searches} search${searches === 1 ? "" : "es"}: ${basis}; tendencies to test, not rules):`;
  if (head.length > maxChars) return "";
  const adviceLine = (r: TrendAdvice) => {
    const levers = r.levers.filter(PROMPT_LEVER).map(leverText);
    return `- ${r.advice}${levers.length ? ` (${levers.join(", ")})` : ""} ${adviceTag(r, summary)}`;
  };
  // --- trends --- the advice that separates the most viewed (or where ours differ) first; a benchmark – what the most viewed
  // do, but the rest as well – after the themes and the formats, and never for Make videos
  const shown = summary.recommendations.filter((x) => x.area !== "mode" && x.area !== "blueprint");
  const advice = shown.filter((x) => x.basis !== "benchmark").map(adviceLine);
  const benchmarks = focus === "videos" ? [] : shown.filter((x) => x.basis === "benchmark").map(adviceLine);
  // --- trends --- a theme by how its videos rank (their median view percentile against the others'), with how many videos
  // and how much of their views the best one carries: never one hit's summed views shown as the theme's
  const margin = (t: TrendTheme) => (t.rank ?? 0) - (t.restRank ?? 0);
  const themes = summary.themes.filter((t) => t.advised && t.rank !== null && t.restRank !== null).sort((a, b) => margin(b) - margin(a)).slice(0, 4);
  const rankText = (p: number | null) => String(Math.round((p ?? 0) * 100));
  const themeLine = themes.length ? [`- Themes whose videos rank above the rest (median view percentile against the others'): ${themes.map((t) => `${t.label} ${rankText(t.rank)} against ${rankText(t.restRank)} (${t.videos} videos${t.topShare !== null ? `, the best ${pct(t.topShare)} of their views` : ""}${t.modes.length ? `; ${t.modes.slice(0, 3).join(", ")}` : ""})`).join("; ")}.`] : [];
  // --- trends --- the formats the most viewed use more apart from those they use less: a format common in the list but rarer
  // among its most viewed is no trend to copy
  const formats = summary.formats.filter((f) => f.all !== null && f.all >= 0.1 && f.top !== null && f.rest !== null).sort((a, b) => (b.all as number) - (a.all as number));
  const formatText = (f: TrendFormat) => `${f.label} ${pct(f.top as number)} against ${pct(f.rest as number)}`;
  const more = formats.filter((f) => (f.top as number) > (f.rest as number));
  const less = formats.filter((f) => (f.top as number) < (f.rest as number));
  const third = `the most viewed third (${summary.titles.top} of ${summary.titles.n} titles) against the rest`;
  const formatLine = more.length || less.length ? [`- Title formats: ${[more.length ? `more among ${third}: ${more.map(formatText).join(", ")}` : `none more common among ${third}`, less.length ? `less among them, so no trend to copy: ${less.map(formatText).join(", ")}` : ""].filter(Boolean).join("; ")}.`] : [];
  const num = (trait: string) => summary.numbers.find((n) => n.trait === trait);
  const look = ["meanLuma", "meanSat", "darkShare"].map(num).filter((n): n is TrendNumber => !!n && n.top !== null);
  // --- trends --- a trait the searches disagree on (split) is a range by search, never one pooled median
  const lookText = (n: TrendNumber) => {
    const tops = n.split ? n.tops.filter((t): t is number => t !== null) : [];
    if (tops.length >= 2) return `${n.label} ${Math.min(...tops)}–${Math.max(...tops)} by search`;
    return `${n.label} ${n.top}${n.rest !== null ? ` (the rest ${n.rest})` : ""}`;
  };
  const lookLine = look.length ? [`- The most viewed look (0–1; n ${look[0].n}, ${sourceText(look[0])}): ${look.map(lookText).join(", ")}.`] : [];
  // --- trends --- words that may describe our clips: no platform tag, no 3D-render or game-engine genre (lib/trends.ts)
  const words = summary.words.map((w) => w.word).filter(productWord).slice(0, 10);
  const wordLine = words.length ? [`- Words of the most viewed titles: ${words.join(", ")}.`] : [];
  const lines = focus === "copy" ? [...formatLine, ...wordLine] : [...advice, ...themeLine, ...formatLine, ...benchmarks, ...lookLine, ...wordLine];
  const out = [head];
  let used = head.length;
  for (const line of lines) {
    if (used + 1 + line.length > maxChars) continue;
    out.push(line);
    used += 1 + line.length;
  }
  return out.length > 1 ? out.join("\n") : "";
}
