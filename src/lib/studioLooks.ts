import { isModeId, type ModeId } from "@/lib/physics/types";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { parseSeed } from "@/lib/recording/batch";
import { looksOf, type StudioLook } from "@/content/looks";

/*
 * --- studio-looks --- The studio's side of the looks (src/content/looks.ts) and of the mode cards' links (--- card-looks ---,
 * lib/thumbnails/heroMoments.ts cardQuery): a look read into settings, the fields the row of a mode changes, the patch that puts
 * a look on the page (the panel's own update path, so Undo takes it back) and the look the page shows now. Pure: no React.
 */

// --- pace-as-look ---
/**
 * The page's start look of a mode: its link base (`defaultSettings`, what every link reads) with its start look on top
 * (`clipStartSettings`). What the page itself starts a mode in, what Reset All, Reset Category and the theme's Default go back to,
 * and the look the site's own links into a mode open (`startQuery`).
 */
export function startSettings(mode: ModeId): SimulatorSettings {
  return { ...defaultSettings(mode), ...clipStartSettings(mode) };
}

/** The start look as a link's query (`mode=…` and the fields it sets apart from the link base): what a site link into a mode opens. */
export function startQuery(mode: ModeId): string {
  return settingsToSearchParams(startSettings(mode)).toString();
}
// --- end pace-as-look ---

/** A look read into settings: Plain is the page's start look (clip-start), any other its link read on the mode's link base. */
export function lookSettings(mode: ModeId, look: Pick<StudioLook, "kind" | "query">): SimulatorSettings {
  if (look.kind === "plain") return startSettings(mode); // --- pace-as-look ---
  return settingsFromSearchParams(new URLSearchParams(`mode=${mode}${look.query ? `&${look.query}` : ""}`));
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export interface ResolvedLook extends StudioLook {
  settings: SimulatorSettings;
}

export interface LookRow {
  mode: ModeId;
  looks: ResolvedLook[];
  /** The fields any look of the row sets apart from the mode's link base: what a look changes, and all it compares. */
  keys: (keyof SimulatorSettings)[];
}

/** The Looks row of a mode: its looks read into settings (a look that comes out like an earlier one is left out) and their fields. */
export function lookRow(mode: ModeId): LookRow {
  const base = defaultSettings(mode);
  const all = looksOf(mode).map((look) => ({ ...look, settings: lookSettings(mode, look) }));
  const keys = (Object.keys(base) as (keyof SimulatorSettings)[]).filter((key) => all.some((look) => !same(look.settings[key], base[key])));
  const looks: ResolvedLook[] = [];
  for (const look of all) if (!looks.some((kept) => keys.every((key) => same(kept.settings[key], look.settings[key])))) looks.push(look);
  return { mode, looks, keys };
}

/** What puts `look` on a page that shows `current`: the row's fields where they differ (empty: the look is on already). */
export function lookPatch(row: LookRow, look: ResolvedLook, current: SimulatorSettings): Partial<SimulatorSettings> {
  const patch: Partial<SimulatorSettings> = {};
  for (const key of row.keys) if (!same(current[key], look.settings[key])) Object.assign(patch, { [key]: look.settings[key] });
  return patch;
}

/** The id of the look the page shows (every field of the row as the look has it), or null: none, the visitor changed one. */
export function activeLook(row: LookRow, current: SimulatorSettings): string | null {
  if (current.mode !== row.mode) return null;
  return row.looks.find((look) => row.keys.every((key) => same(current[key], look.settings[key])))?.id ?? null;
}

// --- card-looks ---
/** What a mode card of the studio's picker sends with the select-mode event: the mode and its card's link (cardQuery). */
export interface SelectModeLook {
  mode: ModeId;
  /** The card's link as a query string: `mode=`, its settings and maybe `seed=`. */
  look: string;
}

/** The select-mode event's detail: a mode id (every sender), or a card's mode and link (the picker's cards); null: neither. */
export function selectedMode(detail: unknown): { mode: ModeId; look: string | null } | null {
  if (typeof detail === "string") return isModeId(detail) ? { mode: detail, look: null } : null;
  if (!detail || typeof detail !== "object") return null;
  const { mode, look } = detail as Partial<SelectModeLook>;
  return typeof mode === "string" && isModeId(mode) ? { mode, look: typeof look === "string" ? look : null } : null;
}

/**
 * A card's link put on a mode the page has just switched to: its settings that differ from the mode's link base (the page's
 * own carry-overs, its music, captions and character, stay) and its seed (null: none, or not one a link may carry).
 */
export function cardLinkPatch(mode: ModeId, link: string): { patch: Partial<SimulatorSettings>; seed: number | null } {
  const params = new URLSearchParams(link);
  const seed = parseSeed(params.get("seed"));
  params.set("mode", mode);
  params.delete("seed");
  const base = defaultSettings(mode);
  const read = settingsFromSearchParams(params);
  const patch: Partial<SimulatorSettings> = {};
  for (const key of Object.keys(base) as (keyof SimulatorSettings)[]) if (!same(read[key], base[key])) Object.assign(patch, { [key]: read[key] });
  return { patch, seed };
}
// --- end card-looks ---
