import type { ModeId } from "@/lib/physics/types";
import { DAILY_POOL } from "@/lib/dailyCore";
import { HERO_BASE_QUERY, HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { GALLERY, type LocalizedText } from "./gallery";

/*
 * --- studio-looks --- The looks of the studio's Looks row (the top of the Mode block): for each mode, Plain (the page's start
 * look), the look its card's picture shows, its presets of the gallery and its daily challenge's look where it is in the daily
 * pool. Each is a link's settings on the mode's link base, without `mode=` and `seed=`: a look changes how the run looks and
 * plays, never which run it is. The names live here in every language, as the gallery's do, so messages/*.json hold only the
 * row's heading. lib/studioLooks.ts reads them into settings (it needs lib/settings, which this file must not pull in: the
 * landing page's modules may import it).
 */

export type LookKind = "plain" | "card" | "gallery" | "daily";

export interface StudioLook {
  /** "plain", "card", "daily", or the gallery preset's id. */
  id: string;
  kind: LookKind;
  /** The look's settings as a link's query on the mode's link base, without `mode=` and `seed=` (Plain: "", the start look). */
  query: string;
  name: LocalizedText;
}

/** The names of the looks every mode has (the gallery's carry their own). */
export const LOOK_NAMES: Readonly<Record<Exclude<LookKind, "gallery">, LocalizedText>> = {
  plain: { en: "Plain", pl: "Zwykły", es: "Sencillo" },
  card: { en: "As pictured", pl: "Jak na obrazku", es: "Como en la imagen" },
  daily: { en: "Challenge look", pl: "Wygląd wyzwania", es: "Estilo del reto" }, // (E1 review: names a look, not the challenge itself)
};

/** A link's query without its mode and seed: the settings alone. */
export function settingsQueryOf(query: string): string {
  const params = new URLSearchParams(query);
  params.delete("mode");
  params.delete("seed");
  return params.toString();
}

/**
 * The looks of a mode, in the row's order: Plain, the card's look (the shared hero look and the card's settings, as the card
 * links to it: heroMoments.ts cardQuery), the mode's gallery presets in the gallery's order, then its daily challenge's look.
 * Looks that come out the same are shown once (lib/studioLooks.ts).
 */
export function looksOf(mode: ModeId): StudioLook[] {
  const hero = HERO_MOMENTS[mode];
  const looks: StudioLook[] = [{ id: "plain", kind: "plain", query: "", name: LOOK_NAMES.plain }];
  if (hero) looks.push({ id: "card", kind: "card", query: [HERO_BASE_QUERY, hero.card ?? hero.query].filter(Boolean).join("&"), name: LOOK_NAMES.card });
  for (const preset of GALLERY) if (preset.mode === mode) looks.push({ id: preset.id, kind: "gallery", query: settingsQueryOf(preset.query), name: preset.name });
  const daily = DAILY_POOL.find((entry) => entry.mode === mode);
  if (daily) looks.push({ id: "daily", kind: "daily", query: daily.look, name: LOOK_NAMES.daily });
  return looks;
}
