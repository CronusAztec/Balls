import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { MODE_CATEGORIES, MODE_CATEGORY_IDS, modesInCategory, type ModeCategory } from "@/lib/modes";

/*
 * --- site-redesign --- The pure parts of the site's layout: the mode families the modes wall, the mode picker and the
 * footer filter by (derived from the mode registry, so a new family shows up by itself), the format readout of the
 * studio's stage strip, and the command palette's matcher.
 */

export interface ModeFamily {
  id: ModeCategory;
  modes: ModeId[];
}

/** The families that have at least one registered mode, in registry order, each with its modes in card order. */
export function modeFamilies(): ModeFamily[] {
  return MODE_CATEGORY_IDS.map((id) => ({ id, modes: modesInCategory(id).filter((m) => MODE_IDS.includes(m)) })).filter((f) => f.modes.length > 0);
}

/** The family of a mode (its card group). */
export function familyOf(mode: ModeId): ModeCategory {
  return MODE_CATEGORIES[mode];
}

/** The modes shown for a filter: every family's modes in card order for "all", else the one family's. */
export function modesForFilter(filter: ModeCategory | "all"): ModeId[] {
  const families = modeFamilies();
  return filter === "all" ? families.flatMap((f) => f.modes) : (families.find((f) => f.id === filter)?.modes ?? []);
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * The aspect ratio of an export resolution ("1080x1920" → "9:16", "1280x720" → "16:9", "500x500" → "1:1"); an
 * unreadable value gives "".
 */
export function aspectRatioLabel(resolution: string): string {
  const m = /^(\d+)\s*[x×]\s*(\d+)$/.exec(resolution.trim());
  if (!m) return "";
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0 && h > 0)) return "";
  const d = gcd(w, h);
  return `${w / d}:${h / d}`;
}

/** An entry of the command palette: a section of the panel or one searchable control of a section. */
export interface PaletteEntry {
  /** "section" opens the section; "control" opens its section and focuses the control. */
  kind: "section" | "control";
  /** The panel section (rail item) it belongs to. */
  section: string;
  /** The control's label key (Searchable labelKey); the section id for a section. */
  key: string;
  /** What the palette shows (translated). */
  label: string;
  /** The section's name, shown next to a control. */
  sectionLabel: string;
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");

/** --- review fix (site-redesign) --- A group of the palette's controls: a rail item and the search keys of the controls it shows. */
export interface PaletteGroup {
  section: string;
  label: string;
  keys: readonly string[];
}

/**
 * --- review fix (site-redesign) --- The palette's control entries, group by group: every key with a label, once (the first
 * group that lists it keeps it), and one entry per label within a group – two keys named alike there (a search alias, a
 * block's heading and its control) would offer the same thing twice, and a control named like its group is the group's own
 * entry. `labelOf` gives a key's label, or null for none.
 */
export function paletteControlEntries(groups: readonly PaletteGroup[], labelOf: (key: string) => string | null): PaletteEntry[] {
  const keys = new Set<string>();
  const out: PaletteEntry[] = [];
  for (const group of groups) {
    const labels = new Set<string>([fold(group.label.trim())]);
    for (const key of group.keys) {
      if (keys.has(key)) continue;
      const label = labelOf(key)?.trim();
      if (!label) continue;
      keys.add(key);
      const folded = fold(label);
      if (labels.has(folded)) continue;
      labels.add(folded);
      out.push({ kind: "control", section: group.section, key, label, sectionLabel: group.label });
    }
  }
  return out;
}

/**
 * The palette's matches for a query, best first: every word of the query must start a word of the label (or of its
 * section's name, or the label key); a label that starts with the query ranks above one that only contains its words,
 * sections above controls on a tie. Diacritics fold (ó → o, ł → l), so Polish and Spanish labels match plain typing.
 * An empty query lists the sections. At most `limit` entries.
 */
export function paletteMatches(entries: readonly PaletteEntry[], query: string, limit = 40): PaletteEntry[] {
  const q = fold(query.trim());
  if (!q) return entries.filter((e) => e.kind === "section").slice(0, limit);
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { entry: PaletteEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = fold(entry.label);
    const haystack = `${label} ${fold(entry.sectionLabel)} ${fold(entry.key)}`;
    const tokens = haystack.split(/[^a-z0-9]+/).filter(Boolean);
    if (!words.every((w) => tokens.some((t) => t.startsWith(w)) || haystack.includes(w))) return;
    let score = 0;
    if (label.startsWith(q)) score += 4;
    else if (label.includes(q)) score += 2;
    if (words.every((w) => label.split(/[^a-z0-9]+/).some((t) => t.startsWith(w)))) score += 1;
    if (entry.kind === "section") score += 0.5;
    scored.push({ entry, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, limit).map((s) => s.entry);
}
