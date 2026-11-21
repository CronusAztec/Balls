import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, MODE_CATEGORY_IDS, modesInCategory, type ModeCategory } from "@/lib/modes";

/*
 * --- site-redesign --- The pure parts of the site's layout: the mode families of the registry (the hero and the How it
 * works step count their modes), the format readout of the studio's stage strip, and the command palette's matcher.
 * --- mode-shelves --- And what a visitor finds a mode by: the shelves the modes wall, the mode picker and the footer
 * group by, the version each mode arrived in (the Newest sort, the "New" badge), the sorts, and the wall's state in the
 * address. The search itself is lib/modeSearch.ts.
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

/*
 * --- mode-shelves --- The visitor's layer over the mode registry: the shelves the modes wall, the studio's mode picker, the
 * footer's Modes column and the card tag read. lib/modes.ts files a mode by where its format came from (its "rhythm"
 * family holds every sound-first mode, the fights and the merge games among them), and the toolbox, the bot and each
 * mode's own test keep reading that. A visitor looks for what a mode shows, so the shelves say that: rings to get out of,
 * fights and races, music, loops and patterns, things that smash or merge, the journey and the lab.
 *
 * MODE_SHELVES is the one table: a Record over every mode id, so the type check stops a mode nobody placed, and the order
 * its entries are written in is the order of the cards on a shelf (the Featured order). A new mode goes on the line of
 * its shelf, where it should stand among its neighbours.
 */
export const MODE_SHELF_IDS = ["escape", "battle", "music", "loops", "smash", "journey", "lab"] as const;
export type ShelfId = (typeof MODE_SHELF_IDS)[number];

export const MODE_SHELVES: Record<ModeId, ShelfId> = {
  // escape: a ball works its way out
  classic: "escape", accumulation: "escape", multiply: "escape", target: "escape", grow: "escape", shatter: "escape", colorMatch: "escape", portal: "escape", colourSort: "escape", conveyor: "escape", brickRebuild: "escape",
  // battle: fights, team games and races with a winner, Fight League first
  fightLeague: "battle", battle: "battle", stringBattle: "battle", ctf: "battle", territory: "battle", landClaim: "battle", race: "battle", maze: "battle",
  // music: every hit is a note or lands on a beat
  songRing: "music", drop: "music", beatDrop: "music", beatMachine: "music", runner: "music", paddle: "music", doublePendulum: "music", vortex: "music", collide: "music", box: "music",
  // loops: motion that comes back round, and runs that draw a pattern
  pendulum: "loops", polyrhythm: "loops", orbGrid: "loops", hoops: "loops", starChords: "loops", ellipseFoci: "loops", waveTank: "loops", drawingMachine: "loops", illusion: "loops", lines: "loops", paint: "loops",
  // smash: things that merge, fit, score or break
  mergeRing: "smash", perfectFit: "smash", bullseye: "smash", spiralGlass: "smash", glass: "smash", powerLayers: "smash", multipliers: "smash",
  // journey and lab: one card each, sharing the wall's last row
  journey: "journey",
  blueprint: "lab",
};

export interface ModeShelf {
  id: ShelfId;
  modes: ModeId[];
}

/** The shelves that hold a mode with a card, in shelf order, each with its modes in the order MODE_SHELVES writes them. */
export function modeShelves(): ModeShelf[] {
  const placed = (Object.keys(MODE_SHELVES) as ModeId[]).filter((m) => MODE_IDS.includes(m) && MODE_CARD_ORDER.includes(m));
  return MODE_SHELF_IDS.map((id) => ({ id, modes: placed.filter((m) => MODE_SHELVES[m] === id) })).filter((shelf) => shelf.modes.length > 0);
}

/** The shelf of a mode (its card's tag). */
export function shelfOf(mode: ModeId): ShelfId {
  return MODE_SHELVES[mode];
}

/** The modes of a shelf in Featured order; "all" gives every shelf's, one after another. */
export function modesOnShelf(shelf: ShelfId | "all"): ModeId[] {
  const shelves = modeShelves();
  return shelf === "all" ? shelves.flatMap((f) => f.modes) : (shelves.find((f) => f.id === shelf)?.modes ?? []);
}

/**
 * --- studio-fit --- The modes before and after `mode` in the wall's order (every shelf, Featured), round from the last to
 * the first: the stage strip's arrows step through them. Null for a mode the wall does not show.
 */
export function modeNeighbours(mode: ModeId, order: readonly ModeId[] = modesOnShelf("all")): { prev: ModeId; next: ModeId } | null {
  const at = order.indexOf(mode);
  if (at < 0 || order.length < 2) return null;
  return { prev: order[(at - 1 + order.length) % order.length], next: order[(at + 1) % order.length] };
}

/*
 * --- mode-shelves --- When each mode arrived: the website version whose release notes first name it
 * (src/content/changelog.json; tests/siteRedesign.test.ts compares the two). The ten ring modes were there at 1.0.0, the
 * baseline. A mode still being built gets the version it will ship in. The Newest sort and the card's "New" badge read it.
 */
export const MODE_SINCE_BASELINE = "1.0.0";
export const MODE_SINCE: Record<ModeId, string> = {
  classic: "1.0.0", accumulation: "1.0.0", multiply: "1.0.0", lines: "1.0.0", paint: "1.0.0", target: "1.0.0", grow: "1.0.0", shatter: "1.0.0", colorMatch: "1.0.0", portal: "1.0.0",
  drop: "1.1.0", box: "1.1.0", pendulum: "1.1.0", polyrhythm: "1.1.0", collide: "1.1.0", glass: "1.1.0", multipliers: "1.1.0",
  doublePendulum: "1.2.0", illusion: "1.2.0", stringBattle: "1.2.0", powerLayers: "1.2.0", race: "1.2.0", battle: "1.2.0", ctf: "1.2.0", runner: "1.2.0", paddle: "1.2.0",
  vortex: "1.3.0", journey: "1.3.0", bullseye: "1.3.0", beatDrop: "1.3.0",
  territory: "1.4.0", maze: "1.4.0", conveyor: "1.4.0",
  orbGrid: "1.5.0", fightLeague: "1.5.0", landClaim: "1.5.0",
  starChords: "1.6.0", hoops: "1.6.0",
  colourSort: "1.7.0", ellipseFoci: "1.7.0",
  beatMachine: "1.8.0", waveTank: "1.8.0", brickRebuild: "1.8.0", drawingMachine: "1.8.0", perfectFit: "1.8.0",
  mergeRing: "1.12.0", spiralGlass: "1.12.0",
  blueprint: "1.15.0",
  songRing: "1.18.0",
};

/** "1.17.0" → [1, 17, 0]; anything else (a development build's "0.0.0-dev") → null. */
function versionParts(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Orders two versions, the newer first (an unreadable one last). */
function newerFirst(a: string, b: string): number {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1);
  return y[0] - x[0] || y[1] - x[1] || y[2] - x[2];
}

/**
 * Whether a mode's card wears the "New" badge on a site of `siteVersion` (package.json's version, inlined at build time):
 * it arrived in one of the last `span` minor versions of the same major version, or it is ahead of the site (a mode
 * committed before its release). An unreadable site version marks nothing.
 */
export function isNewMode(mode: ModeId, siteVersion: string, span = 2): boolean {
  const now = versionParts(siteVersion);
  const since = versionParts(MODE_SINCE[mode]);
  if (!now || !since) return false;
  if (since[0] !== now[0]) return since[0] > now[0];
  return since[1] > now[1] - span;
}

export const MODE_SORT_IDS = ["featured", "newest", "az"] as const;
export type ModeSort = (typeof MODE_SORT_IDS)[number];

/**
 * `modes` in the order a sort asks for: "featured" as given (the shelves' order), "newest" by the version each arrived in
 * (the latest first, modes of one version in the given order), "az" by name in the page's language.
 */
export function sortModes(modes: readonly ModeId[], sort: ModeSort, nameOf: (mode: ModeId) => string, locale: string): ModeId[] {
  if (sort === "newest") return modes.map((mode, index) => ({ mode, index })).sort((a, b) => newerFirst(MODE_SINCE[a.mode], MODE_SINCE[b.mode]) || a.index - b.index).map((x) => x.mode);
  if (sort === "az") return [...modes].sort((a, b) => nameOf(a).localeCompare(nameOf(b), locale, { sensitivity: "base", numeric: true }));
  return [...modes];
}

/**
 * The window event a link to a shelf sends when it is clicked (the footer's Modes column; the detail is the shelf id, the
 * event can be cancelled). On the landing page the wall is already there: it shows that shelf, goes to its own top and
 * cancels the event, and the link then stays on the page. Anywhere else nobody answers and the link opens the landing page.
 */
export const SHOW_SHELF_EVENT = "jumpingballslive:show-shelf";

/**
 * --- studio-fit --- The window event the stage strip's readouts send to open a setting (the detail is its search key,
 * "videoDuration" or "videoResolution"): the panel answers with the command palette's own jump, the setting's group opens
 * and the control takes the focus.
 */
export const OPEN_SETTING_EVENT = "jumpingballslive:open-setting";

/** What the modes wall keeps in the address: the shelf, the search and the sort. */
export interface WallState {
  shelf: ShelfId | "all";
  query: string;
  sort: ModeSort;
}
export const WALL_DEFAULTS: WallState = { shelf: "all", query: "", sort: "featured" };
/** The longest search the address carries (a mode's name is at most 30 characters). */
export const WALL_QUERY_MAX = 60;

/** The wall's state in a query string (?family=battle&q=merge&sort=az); what is missing or unreadable is the default. */
export function wallStateFromSearch(search: string): WallState {
  const params = new URLSearchParams(search);
  const family = params.get("family") ?? "";
  const sort = params.get("sort") ?? "";
  return {
    shelf: (MODE_SHELF_IDS as readonly string[]).includes(family) ? (family as ShelfId) : "all",
    query: (params.get("q") ?? "").slice(0, WALL_QUERY_MAX),
    sort: (MODE_SORT_IDS as readonly string[]).includes(sort) ? (sort as ModeSort) : "featured",
  };
}

/** `search` with the wall's state written into it: only what differs from the default, every other parameter kept. */
export function wallStateToSearch(state: WallState, search = ""): string {
  const params = new URLSearchParams(search);
  const query = state.query.trim().slice(0, WALL_QUERY_MAX);
  for (const [key, value] of [["family", state.shelf === "all" ? "" : state.shelf], ["q", query], ["sort", state.sort === "featured" ? "" : state.sort]] as const) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const out = params.toString();
  return out ? `?${out}` : "";
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

/** An entry of the command palette: a section of the panel, one searchable control of a section, a mode or an action. */
export interface PaletteEntry {
  /**
   * "section" opens the section; "control" opens its section and focuses the control. --- mode-shelves --- "mode" switches
   * to that mode, "action" does one thing (Change mode opens the mode picker).
   */
  kind: "section" | "control" | "mode" | "action";
  /** The panel section (rail item) it belongs to. */
  section: string;
  /** The control's label key (Searchable labelKey); the section id for a section; the mode id for a mode. */
  key: string;
  /** What the palette shows (translated). */
  label: string;
  /** The section's name, shown next to a control. */
  sectionLabel: string;
  /** --- mode-shelves --- More words the entry answers to (a mode's search words, lib/modeSearch.ts). */
  words?: string;
}

/** Lower case without diacritics (ó → o, ł → l), so plain typing finds Polish and Spanish words. */
export const fold = (text: string) =>
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
 * An empty query lists the sections and the actions. At most `limit` entries.
 */
export function paletteMatches(entries: readonly PaletteEntry[], query: string, limit = 40): PaletteEntry[] {
  const q = fold(query.trim());
  if (!q) return entries.filter((e) => e.kind === "section" || e.kind === "action").slice(0, limit);
  const words = q.split(/\s+/).filter(Boolean);
  const scored: { entry: PaletteEntry; score: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const label = fold(entry.label);
    const haystack = `${label} ${fold(entry.sectionLabel)} ${fold(entry.key)}${entry.words ? ` ${fold(entry.words)}` : ""}`;
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
