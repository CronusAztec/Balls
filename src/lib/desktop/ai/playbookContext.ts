/*
 * --- desktop-exe --- Grounding for the AI idea generator: docs/virality-playbook.md (bundled with the app) split into its
 * sections and bullet points, and the ones closest to the user's request picked within a character budget – a small local
 * model's context holds a few thousand tokens, not the whole research. The recipe (§3) always goes in; the rest is ranked
 * by shared words with the request (a plain term-frequency score, no embeddings, so it runs offline and instantly).
 */

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
