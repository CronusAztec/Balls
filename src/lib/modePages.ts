import type { ModeId } from "@/lib/physics/types";
import { modesOnShelf, shelfOf } from "@/lib/siteDesign";
import { GALLERY, galleryHref, type GalleryPreset, type LocalizedText } from "@/content/gallery";
import { looksOf, type LookKind } from "@/content/looks";
import { cardHref } from "@/lib/thumbnails/heroMoments";
import { MODE_PAGES_PATH, modePagePath, modeSlug } from "@/lib/modePagePath";

export { MODE_PAGES_PATH, modePagePath, modeSlug };

/*
 * --- mode-pages --- (Lane E, E3) A page for every mode: /<locale>/modes/<slug>/ (src/app/[locale]/modes/[mode]/page.tsx), so a
 * shared link to one mode shows that mode, and a visitor who searched for one format lands on it. This is the pure half: the
 * address of each page, what it shows besides the mode's own messages (its looks, its first settings, its panel intro, the
 * modes next to it) and its search snippet. Everything a page says is copy that exists elsewhere: Modes.<id>.name and
 * .description, the mode's panel intro, the gallery's names and descriptions, the studio's own labels and tips.
 */

/** The modes with a page: every mode the modes wall shows, in its Featured order. */
export function modePageModes(): ModeId[] {
  return modesOnShelf("all");
}

/** The mode a page's address word names, null for any other word. */
export function modeOfSlug(slug: string): ModeId | null {
  return modePageModes().find((mode) => modeSlug(mode) === slug) ?? null;
}

/** The social card of a mode page: public/og/modes/<slug>.jpg (scripts/generate-og-cards.mjs, from the mode's card picture). */
export function modeOgImagePath(mode: ModeId): string {
  return `/og/modes/${modeSlug(mode)}.jpg`;
}

/**
 * The modes a page links to under "Related modes": the next modes of its shelf in Featured order, round from the last to the
 * first, then (a shelf of one or two) the next modes of the wall, never the mode itself.
 */
export function relatedModes(mode: ModeId, count = 4): ModeId[] {
  const shelf = modesOnShelf(shelfOf(mode));
  const wall = modePageModes();
  const after = (list: readonly ModeId[]) => {
    const at = list.indexOf(mode);
    return at < 0 ? [...list] : [...list.slice(at + 1), ...list.slice(0, at)];
  };
  const out: ModeId[] = [];
  for (const next of [...after(shelf), ...after(wall)]) {
    if (out.length >= count) break;
    if (next !== mode && !out.includes(next)) out.push(next);
  }
  return out;
}

/** One look a mode page offers: the studio link that opens it, and the gallery preset behind it where there is one. */
export interface ModePageLook {
  id: string;
  kind: LookKind;
  name: LocalizedText;
  /** The studio link relative to the locale: `/simulator?…` (a gallery preset's and the card's with their seed). */
  href: string;
  preset?: GalleryPreset;
}

/**
 * The looks of a mode as the studio's Looks row lists them (src/content/looks.ts), each with the link that opens it: Plain is the
 * mode alone, the card's look is the card's own link (its seed too), a gallery preset its Try it link (its seed too), the daily
 * challenge's look the mode with those settings.
 */
export function modePageLooks(mode: ModeId): ModePageLook[] {
  return looksOf(mode).map((look) => {
    const preset = look.kind === "gallery" ? GALLERY.find((p) => p.id === look.id) : undefined;
    const href = preset ? galleryHref(preset) : look.kind === "card" ? cardHref(mode) : `/simulator?${[`mode=${mode}`, look.query].filter(Boolean).join("&")}`;
    return { id: look.id, kind: look.kind, name: look.name, href, ...(preset ? { preset } : {}) };
  });
}

/**
 * The intro of the mode's own block in the studio (the message the panel section shows above its controls), as
 * "Namespace.key". A mode whose block has none is left out: its page shows no "How it plays".
 */
export const MODE_INTROS: Readonly<Partial<Record<ModeId, string>>> = {
  classic: "Controls.reDesc",
  drop: "Controls.dropDesc",
  box: "Controls.boxDesc",
  pendulum: "Controls.pwDesc",
  polyrhythm: "Controls.prDesc",
  collide: "Controls.cpDesc",
  glass: "Controls.glassDesc",
  multipliers: "Controls.mpBoardDesc",
  doublePendulum: "Controls.dpDesc",
  illusion: "Controls.ilDesc",
  stringBattle: "Controls.sbDesc",
  powerLayers: "Controls.plDesc",
  race: "Controls.rcDesc",
  battle: "Controls.btDesc",
  ctf: "Controls.ctfDesc",
  runner: "Controls.rrDesc",
  paddle: "Controls.pdDesc",
  vortex: "Controls.vxDesc",
  journey: "Controls.journeyDesc",
  bullseye: "Controls.byDesc",
  mergeRing: "Controls.mrDesc",
  spiralGlass: "Controls.sgDesc",
  songRing: "Controls.srDesc",
  sandPlate: "Controls.spDesc",
  blueprint: "Controls.blDesc",
  beatDrop: "Controls.bdDesc",
  territory: "Controls.tyDesc",
  maze: "Controls.mzDesc",
  conveyor: "Controls.cvDesc",
  orbGrid: "Controls.ogDesc",
  fightLeague: "Controls.flDesc",
  landClaim: "Controls.lcDesc",
  colourSort: "ColourSort.csDesc",
  starChords: "Controls.scStarDesc",
  ellipseFoci: "Controls.efDesc",
  brickRebuild: "BrickRebuild.desc",
  beatMachine: "BeatMachine.desc",
  waveTank: "WaveTank.desc",
  drawingMachine: "DrawingMachine.desc",
  perfectFit: "PerfectFit.desc",
};

/**
 * The first settings worth changing in each mode: up to three controls of the mode's own block in the studio, in the block's
 * order, by their message ("Controls.pwLayout": the page shows that name and its tip, "Controls.pwLayoutTip"). A mode without
 * a block of its own (Portal) is left out: its page lists the basics every mode starts with.
 */
export const MODE_FIRST_SETTINGS: Readonly<Partial<Record<ModeId, readonly string[]>>> = {
  classic: ["Controls.reSpiralPreset", "Controls.gapLayout", "Controls.ringSpin"],
  accumulation: ["Controls.accumulationEscape", "Controls.spikes", "Controls.spikeCount"],
  multiply: ["Controls.spawnCount", "Controls.swarmRace"],
  target: ["Controls.targetCount", "Controls.randomOrder"],
  grow: ["Controls.growthRate", "Controls.growPresets", "Controls.growOnFill"],
  shatter: ["Controls.shatterHits", "Controls.shatterSegments"],
  colorMatch: ["Controls.colorCount", "Controls.segmentCount"],
  conveyor: ["Controls.cvInterval", "Controls.cvArena", "Controls.cvFreeze"],
  fightLeague: ["Controls.flPreset", "Controls.flMatch", "Controls.flFighters"],
  battle: ["Controls.btCount", "Controls.btHp", "Controls.btShrink"],
  stringBattle: ["Controls.sbRule", "Controls.sbBalls", "Controls.sbLives"],
  ctf: ["Controls.ctfPerTeam", "Controls.ctfScoreToWin"],
  territory: ["Controls.tyTeams", "Controls.tyBallsPerTeam", "Controls.tyPowers"],
  landClaim: ["Controls.lcPreset", "Controls.lcRule", "Controls.lcTeams"],
  race: ["Controls.rcRacers", "Controls.rcTrackLength", "Controls.rcFeature"],
  maze: ["Controls.mzBrain", "Controls.mzBalls", "Controls.mzCols"],
  songRing: ["Controls.srSong", "Controls.srLapSec", "Controls.srBalls"],
  drop: ["Controls.dropBallCount", "Controls.dropRows", "Controls.dropLoop"],
  beatDrop: ["Controls.bdKinds", "Controls.bdScroll", "Controls.bdBounceHeight"],
  runner: ["Controls.rrObstacles", "Controls.rrSpeed", "Controls.rrJump"],
  paddle: ["Controls.pdSkill", "Controls.pdMisses", "Controls.pdSpin"],
  doublePendulum: ["Controls.dpSegments", "Controls.dpCount", "Controls.dpSpar"],
  vortex: ["Controls.vxBalls", "Controls.vxRings", "Controls.vxGravity"],
  collide: ["Controls.cpCount", "Controls.cpSizeSpread", "Controls.cpSquishy"],
  box: ["Controls.boxShape", "Controls.boxShapeCount", "Controls.boxCountdown"],
  pendulum: ["Controls.pwLayout", "Controls.pwCount", "Controls.pwCycleSeconds"],
  polyrhythm: ["Controls.prLayout", "Controls.prTempos", "Controls.prCount"],
  orbGrid: ["Controls.ogColumns", "Controls.ogArrangement", "Controls.ogVaried"],
  hoops: ["Controls.hpPresets", "Controls.hpCount", "Controls.hpOmegaStart"],
  starChords: ["Controls.scStarPresets", "Controls.scBalls", "Controls.scStars"],
  ellipseFoci: ["Controls.efPreset", "Controls.efCount", "Controls.efEccentricity"],
  sandPlate: ["Controls.spNotes", "Controls.spGrains", "Controls.spShake"],
  illusion: ["Controls.ilType", "Controls.ilBalls", "Controls.ilPattern"],
  lines: ["Controls.centerDot"],
  paint: ["Controls.picturePaint", "Controls.paintBrush", "Controls.paintGuided"],
  mergeRing: ["Controls.mrTiers", "Controls.mrInterval", "Controls.mrSpawnTiers"],
  bullseye: ["Controls.byShots", "Controls.byRings", "Controls.byTargetMoving"],
  spiralGlass: ["Controls.sgTurns", "Controls.sgGlassHp", "Controls.sgMaxBalls"],
  glass: ["Controls.glassRows", "Controls.glassHp", "Controls.glassStages"],
  powerLayers: ["Controls.plLayers", "Controls.plSequence", "Controls.plSpeed"],
  multipliers: ["Controls.mpRows", "Controls.mpStartBalls", "Controls.mpGateMix"],
  journey: ["Controls.journeyStages", "Controls.journeyAutoStages"],
  colourSort: ["ColourSort.csPreset"],
  brickRebuild: ["BrickRebuild.brPreset"],
  beatMachine: ["BeatMachine.bmPreset"],
  waveTank: ["WaveTank.wtPreset"],
  drawingMachine: ["DrawingMachine.dmPreset"],
  perfectFit: ["PerfectFit.pfPreset", "PerfectFit.pfVariant"],
};

/**
 * The basics the studio's first block holds in every mode (Controls.tsx starterBlock: the theme, the ball, the clip's length
 * and its top line), by their Controls message key. Colour Sort's and Mode Lab's balls are the mode's own: no ball controls there.
 */
export function starterSettings(mode: ModeId): string[] {
  const ownBalls = mode === "colourSort" || mode === "blueprint";
  return ["theme", ...(ownBalls ? [] : ["ballColor", "ballSize", "ballSpeed"]), "durationSpan", "topText"];
}

/** The longest search snippet a page writes (a search result shows about 160 characters). */
export const META_DESCRIPTION_MAX = 160;

/**
 * A mode page's search snippet: the mode's one-liner, then the longest of the closing lines that keeps the whole within
 * META_DESCRIPTION_MAX characters (the one-liner alone when none does).
 */
export function modeMetaDescription(description: string, closings: readonly string[]): string {
  const length = (text: string) => [...text].length;
  for (const closing of closings) {
    const text = `${description} ${closing}`;
    if (length(text) <= META_DESCRIPTION_MAX) return text;
  }
  return description;
}
