/*
 * --- desktop-exe --- Grounding for the AI idea generator: docs/virality-playbook.md (bundled with the app) split into its
 * sections and bullet points, and the ones closest to the user's request picked within a character budget – a small local
 * model's context holds a few thousand tokens, not the whole research. The recipe (§3) always goes in; the rest is ranked
 * by shared words with the request (a plain term-frequency score, no embeddings, so it runs offline and instantly).
 *
 * --- trends --- Beside it, what is trending (trendingContext): the committed trend summary of other creators' trending and
 * viral simulation videos (src/content/trends.json), in a few lines within a budget of its own.
 */

import type { TrendLever, TrendNumber, TrendSummary } from "@/lib/trends";

export interface PlaybookChunk {
  /** "3. The recipe the bot follows" – the section it belongs to. */
  section: string;
  text: string;
}

const STOP = new Set("a an and are as at be by for from has have in into is it its of on or that the this to was were will with you your we our they their them not no do does did can".split(" "));

/** The words of a text worth matching (lower case, 3+ letters, no stop words). */
export function terms(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9ąćęłńóśźżáéíñóúü]{3,}/g) ?? []).filter((w) => !STOP.has(w));
}

/** The playbook's chunks: every paragraph, bullet, numbered item and table row, with its section heading. */
export function splitPlaybook(markdown: string): PlaybookChunk[] {
  const chunks: PlaybookChunk[] = [];
  let section = "";
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text && section) chunks.push({ section, text });
    buffer = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      section = heading[1].trim();
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
  const chunks = splitPlaybook(markdown);
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

const PLATFORM_NAMES: Record<string, string> = { youtube: "YouTube Shorts", tiktok: "TikTok", instagram: "Instagram Reels" };
const pct = (share: number) => `${Math.round(share * 100)}%`;
const leverText = (l: TrendLever) => (l.kind === "setting" ? (l.value !== undefined ? `${l.name} ${String(l.value)}` : l.name) : `${l.kind} ${l.name}`);

/**
 * The "What is trending" block for a prompt, from the committed trend summary (src/content/trends.json, lib/trends.ts):
 * a heading with its date and sample, then lines by priority – for clips (Make videos, ideas) the advice in our levers, the
 * themes whose videos earn more than their share of the views with our modes for them, the title formats, the look of the
 * most viewed and the words of their titles; for copy (the planner's captions and titles) the title formats and words
 * first – each kept only while the block stays within `maxChars`. No title is quoted: other creators' text stays data.
 * "" without a summary.
 */
export function trendingContext(summary: TrendSummary | null | undefined, maxChars: number, focus: "clips" | "copy" = "clips"): string {
  if (!summary || maxChars <= 0) return "";
  const where = Object.entries(summary.sample.platforms)
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => PLATFORM_NAMES[p] ?? p)
    .join(", ");
  const searches = summary.sources.length;
  const head = `What is trending (${summary.date}, ${summary.sample.compared} short-form simulation videos${where ? ` on ${where}` : ""}, ${searches} search${searches === 1 ? "" : "es"}; tendencies to test, not rules):`;
  if (head.length > maxChars) return "";
  const advice = summary.recommendations
    .filter((x) => x.area !== "mode" && x.area !== "blueprint")
    .map((r) => {
      const levers = r.levers.filter((l) => l.kind !== "tool").map(leverText);
      return `- ${r.advice}${levers.length ? ` (${levers.join(", ")})` : ""}`;
    });
  const themes = summary.themes.filter((t) => t.advised).slice(0, 4);
  const themeLine = themes.length ? [`- Themes whose videos earn more than their share of the views: ${themes.map((t) => `${t.label} ×${Math.round(t.lift * 10) / 10}${t.modes.length ? ` (${t.modes.slice(0, 3).join(", ")})` : ""}`).join("; ")}.`] : [];
  const formats = summary.formats.filter((f) => f.all !== null && f.all >= 0.1).sort((a, b) => (b.all as number) - (a.all as number));
  const formatLine = formats.length ? [`- Title formats: ${formats.map((f) => `${f.label} in ${pct(f.all as number)}${f.top !== null && f.rest !== null && f.top > f.rest ? " (more among the most viewed)" : ""}`).join(", ")}.`] : [];
  const num = (trait: string) => summary.numbers.find((n) => n.trait === trait);
  const look = ["meanLuma", "meanSat", "darkShare"].map(num).filter((n): n is TrendNumber => !!n && n.top !== null);
  const lookLine = look.length ? [`- The most viewed look (0–1): ${look.map((n) => `${n.label} ${n.top}${n.rest !== null ? ` (the rest ${n.rest})` : ""}`).join(", ")}.`] : [];
  const words = summary.words.map((w) => w.word).filter((w) => !/shorts|tiktok|reels?$|fyp|viral|youtube/i.test(w)).slice(0, 10);
  const wordLine = words.length ? [`- Words of the most viewed titles: ${words.join(", ")}.`] : [];
  const lines = focus === "copy" ? [...formatLine, ...wordLine, ...themeLine, ...advice, ...lookLine] : [...advice, ...themeLine, ...formatLine, ...lookLine, ...wordLine];
  const out = [head];
  let used = head.length;
  for (const line of lines) {
    if (used + 1 + line.length > maxChars) continue;
    out.push(line);
    used += 1 + line.length;
  }
  return out.length > 1 ? out.join("\n") : "";
}
