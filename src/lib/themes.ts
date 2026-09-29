import { PARTICLE_STYLES, isParticleStyle, type ParticleStyle } from "@/lib/physics/particleStyles";

/**
 * Themes and backgrounds: one-click looks for the simulator.
 *
 * A theme is a curated palette – wall, ball, second-ball and line colours, a solid or gradient
 * background, the colour-trail colours and a particle style. Picking one *merges* its colours into
 * the existing settings (`applyTheme()`), so every colour stays individually editable afterwards; the
 * theme id is only remembered to highlight its card (and to tell whether the look was tweaked since).
 *
 * The background settings live here too: `backgroundType` (solid | gradient | image), the two
 * `backgroundColors`, `backgroundDim` for an uploaded picture (kept in memory, never in links or
 * presets) and the `particleStyle` of the confetti bursts. Nothing here touches the physics: themes
 * are purely visual, so seeds and the finder are unaffected.
 *
 * This module is framework-free and does not import settings.ts (settings.ts spreads the defaults,
 * ranges and URL helpers from here), so the merge is a pure function the unit tests call directly.
 */

export const BACKGROUND_TYPES = ["solid", "gradient", "image"] as const;
export type BackgroundType = (typeof BACKGROUND_TYPES)[number];

export function isBackgroundType(value: unknown): value is BackgroundType {
  return typeof value === "string" && (BACKGROUND_TYPES as readonly string[]).includes(value);
}

export { PARTICLE_STYLES, isParticleStyle, type ParticleStyle };

export interface Theme {
  id: string;
  /** Translation key of the name (Controls namespace). */
  nameKey: string;
  circleColor: string;
  ballColor: string;
  ballColor2: string;
  lineColor: string;
  background: { type: "solid" | "gradient"; colors: [string, string] };
  /** The colour trail cycles between these two colours instead of the rainbow. */
  trailColors: [string, string];
  particleStyle: ParticleStyle;
}

/** The curated themes, in card order. Ids are part of shared links (`theme=`), so never rename one. */
export const THEMES: readonly Theme[] = [
  {
    id: "neon",
    nameKey: "themeNeon",
    circleColor: "#ff00e6",
    ballColor: "#00f0ff",
    ballColor2: "#faff00",
    lineColor: "#00f0ff",
    background: { type: "gradient", colors: ["#0b0014", "#1f0040"] },
    trailColors: ["#00f0ff", "#ff00e6"],
    particleStyle: "sparks",
  },
  {
    id: "pastel",
    nameKey: "themePastel",
    circleColor: "#ffc8dd",
    ballColor: "#bde0fe",
    ballColor2: "#cdb4db",
    lineColor: "#ffafcc",
    background: { type: "gradient", colors: ["#2b2d42", "#4a4e69"] },
    trailColors: ["#a2d2ff", "#ffc8dd"],
    particleStyle: "petals",
  },
  {
    id: "mono",
    nameKey: "themeMono",
    circleColor: "#ffffff",
    ballColor: "#ffffff",
    ballColor2: "#9ca3af",
    lineColor: "#d4d4d4",
    background: { type: "solid", colors: ["#000000", "#1f1f1f"] },
    trailColors: ["#ffffff", "#525252"],
    particleStyle: "sparks",
  },
  {
    id: "sunset",
    nameKey: "themeSunset",
    circleColor: "#ffd166",
    ballColor: "#ffffff",
    ballColor2: "#ef476f",
    lineColor: "#ffd166",
    background: { type: "gradient", colors: ["#2d1b69", "#b33951"] },
    trailColors: ["#ff9a3c", "#ff3c78"],
    particleStyle: "petals",
  },
  {
    id: "ocean",
    nameKey: "themeOcean",
    circleColor: "#4cc9f0",
    ballColor: "#ffffff",
    ballColor2: "#72efdd",
    lineColor: "#90e0ef",
    background: { type: "gradient", colors: ["#001d3d", "#005f73"] },
    trailColors: ["#4cc9f0", "#80ffdb"],
    particleStyle: "bubbles",
  },
  {
    id: "retro",
    nameKey: "themeRetro",
    circleColor: "#ff71ce",
    ballColor: "#fffb96",
    ballColor2: "#01cdfe",
    lineColor: "#05ffa1",
    background: { type: "gradient", colors: ["#1a1033", "#3d0f4f"] },
    trailColors: ["#ff71ce", "#01cdfe"],
    particleStyle: "pixels",
  },
  {
    id: "candy",
    nameKey: "themeCandy",
    circleColor: "#ff85a1",
    ballColor: "#fff0f3",
    ballColor2: "#ffd6a5",
    lineColor: "#caffbf",
    background: { type: "gradient", colors: ["#2a0a2e", "#5a189a"] },
    trailColors: ["#ff85a1", "#9bf6ff"],
    particleStyle: "confetti",
  },
  {
    id: "matrix",
    nameKey: "themeMatrix",
    circleColor: "#00ff41",
    ballColor: "#b7ffbf",
    ballColor2: "#008f11",
    lineColor: "#00ff41",
    background: { type: "solid", colors: ["#000a00", "#002200"] },
    trailColors: ["#00ff41", "#003b00"],
    particleStyle: "pixels",
  },
  {
    id: "aurora",
    nameKey: "themeAurora",
    circleColor: "#7cffcb",
    ballColor: "#ffffff",
    ballColor2: "#c084fc",
    lineColor: "#7cffcb",
    background: { type: "gradient", colors: ["#020024", "#093637"] },
    trailColors: ["#7cffcb", "#c084fc"],
    particleStyle: "bubbles",
  },
  {
    id: "luxe",
    nameKey: "themeLuxe",
    circleColor: "#d4af37",
    ballColor: "#fff4d6",
    ballColor2: "#b8860b",
    lineColor: "#f5d77a",
    background: { type: "gradient", colors: ["#0f0c05", "#2b2111"] },
    trailColors: ["#ffd700", "#b8860b"],
    particleStyle: "confetti",
  },
];

export const THEME_IDS: readonly string[] = THEMES.map((theme) => theme.id);

export function themeById(id: string | null | undefined): Theme | undefined {
  return id ? THEMES.find((theme) => theme.id === id) : undefined;
}

/* ------------------------------------------------------------------ settings */

/** The theme and background fields of `SimulatorSettings`. */
export interface ThemeSettings {
  /** The theme the look was picked from ("" = none; URL `theme`). */
  themeId: string;
  /** solid | gradient | image (URL `bgt`; an uploaded picture never travels, so links only carry solid / gradient). */
  backgroundType: BackgroundType;
  /** Solid colour (the first) or gradient from top to bottom (URL `bg1`, `bg2`). */
  backgroundColors: string[];
  /** 0–1: how far the uploaded background picture is darkened (URL `bgd`). */
  backgroundDim: number;
  /** Style of the confetti bursts (URL `ps`). */
  particleStyle: ParticleStyle;
  /** Two colours the colour trail cycles between; empty = the classic rainbow (URL `trc`). */
  trailColors: string[];
}

/** The colours the canvas used before themes existed: the defaults keep every run looking exactly as before. */
export const DEFAULT_BACKGROUND_COLORS: readonly [string, string] = ["#0a0a0a", "#1e293b"];

export function defaultThemeSettings(): ThemeSettings {
  return {
    themeId: "",
    backgroundType: "solid",
    backgroundColors: [...DEFAULT_BACKGROUND_COLORS],
    backgroundDim: 0.35,
    particleStyle: "confetti",
    trailColors: [],
  };
}

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const THEME_RANGES = {
  backgroundDim: { min: 0, max: 1, step: 0.05 },
} as const;

const HEX = /^#?([0-9a-f]{6})$/i;
const SHORT_HEX = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i;

/** "#RGB", "RGB", "#RRGGBB" or "RRGGBB" → "#rrggbb"; anything else → null. */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim();
  const long = HEX.exec(v);
  if (long) return `#${long[1].toLowerCase()}`;
  const short = SHORT_HEX.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  return null;
}

/** Exactly two valid colours, or null. */
function colorPair(value: unknown): [string, string] | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const a = normalizeHexColor(value[0]);
  const b = normalizeHexColor(value[1]);
  return a && b ? [a, b] : null;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and validates every field (presets, URLs); unknown ids and styles, bad colours and out-of-range dims fall back. */
export function resolveThemeSettings(source: Partial<Record<keyof ThemeSettings, unknown>> | null | undefined): ThemeSettings {
  const out = defaultThemeSettings();
  if (!source) return out;
  if (typeof source.themeId === "string" && themeById(source.themeId)) out.themeId = source.themeId;
  if (isBackgroundType(source.backgroundType)) out.backgroundType = source.backgroundType;
  const bg = colorPair(source.backgroundColors);
  if (bg) out.backgroundColors = bg;
  if (source.backgroundDim !== undefined) out.backgroundDim = clampNumber(source.backgroundDim, THEME_RANGES.backgroundDim, out.backgroundDim);
  if (isParticleStyle(source.particleStyle)) out.particleStyle = source.particleStyle;
  const trail = colorPair(source.trailColors);
  if (trail) out.trailColors = trail;
  return out;
}

/** Picks the theme fields out of a bigger object (the SimulatorSettings, a preset…), copying the arrays. */
export function themeSettingsOf(source: ThemeSettings): ThemeSettings {
  return {
    themeId: source.themeId,
    backgroundType: source.backgroundType,
    backgroundColors: [...source.backgroundColors],
    backgroundDim: source.backgroundDim,
    particleStyle: source.particleStyle,
    trailColors: [...source.trailColors],
  };
}

/* ------------------------------------------------------------------ applying a theme */

/** Every setting a theme card writes: its colours, the rainbow switches (off, so the colours show) and the theme fields. */
export interface ThemeLook extends ThemeSettings {
  circleColor: string;
  ballColor: string;
  ballColor2: string;
  lineColor: string;
  rainbowWalls: boolean;
  rainbowBall: boolean;
  rainbowLines: boolean;
}

export const THEME_LOOK_KEYS = [
  "themeId",
  "backgroundType",
  "backgroundColors",
  "backgroundDim",
  "particleStyle",
  "trailColors",
  "circleColor",
  "ballColor",
  "ballColor2",
  "lineColor",
  "rainbowWalls",
  "rainbowBall",
  "rainbowLines",
] as const satisfies readonly (keyof ThemeLook)[];

/** Picks the look fields out of a bigger object (the settings, the defaults of a mode…), copying the arrays. */
export function lookOf(source: ThemeLook): ThemeLook {
  return {
    ...themeSettingsOf(source),
    circleColor: source.circleColor,
    ballColor: source.ballColor,
    ballColor2: source.ballColor2,
    lineColor: source.lineColor,
    rainbowWalls: source.rainbowWalls,
    rainbowBall: source.rainbowBall,
    rainbowLines: source.rainbowLines,
  };
}

/**
 * The settings patch a theme card applies to `current`. The rainbow walls / ball / lines are switched off so the
 * theme's colours show (they can be switched back on); an uploaded background picture in use stays the
 * background (the theme's colours still go into `backgroundColors`, ready when the picture is removed).
 * The background dim is left alone.
 */
export function themePatch(theme: Theme, current: Pick<ThemeSettings, "backgroundType">): Omit<ThemeLook, "backgroundDim"> {
  return {
    themeId: theme.id,
    backgroundType: current.backgroundType === "image" ? "image" : theme.background.type,
    backgroundColors: [...theme.background.colors],
    particleStyle: theme.particleStyle,
    trailColors: [...theme.trailColors],
    circleColor: theme.circleColor,
    ballColor: theme.ballColor,
    ballColor2: theme.ballColor2,
    lineColor: theme.lineColor,
    rainbowWalls: false,
    rainbowBall: false,
    rainbowLines: false,
  };
}

/**
 * Merges a theme into a settings object (pure: `settings` is not changed). Every other setting is kept, so the
 * colours stay individually editable afterwards. An unknown id returns the settings unchanged.
 */
export function applyTheme<T extends ThemeLook>(settings: T, themeId: string): T {
  const theme = themeById(themeId);
  if (!theme) return settings;
  return { ...settings, ...themePatch(theme, settings) };
}

/**
 * The settings patch of the "Default" card – back to the plain look: the look fields of `defaults` (the defaults
 * of the current mode – rainbow walls, the classic colours, the solid dark background, confetti), keeping an
 * uploaded picture in use and its dim.
 */
export function plainLookPatch(current: Pick<ThemeSettings, "backgroundType" | "backgroundDim">, defaults: ThemeLook): ThemeLook {
  const look = lookOf(defaults);
  return { ...look, backgroundType: current.backgroundType === "image" ? "image" : look.backgroundType, backgroundDim: current.backgroundDim };
}

/** Pure merge of `plainLookPatch()`: `settings` is not changed. */
export function clearTheme<T extends ThemeLook>(settings: T, defaults: ThemeLook): T {
  return { ...settings, ...plainLookPatch(settings, defaults) };
}

/** Look fields holding a colour (compared case-insensitively, "#abc" = "#aabbcc"). */
const LOOK_COLOR_KEYS = new Set<string>(["circleColor", "ballColor", "ballColor2", "lineColor"]);

/** True when the look still matches the theme it was picked from (its card then shows as selected, not "edited"). */
export function isThemeIntact(settings: ThemeLook): boolean {
  const theme = themeById(settings.themeId);
  if (!theme) return false;
  const patch = themePatch(theme, settings);
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
    const want = patch[key];
    const have = settings[key];
    if (Array.isArray(want)) {
      if (!Array.isArray(have) || want.length !== have.length || want.some((c, i) => normalizeHexColor(c) !== normalizeHexColor(have[i]))) return false;
    } else if (LOOK_COLOR_KEYS.has(key)) {
      if (normalizeHexColor(want) !== normalizeHexColor(have)) return false;
    } else if (want !== have) return false;
  }
  return true;
}

/**
 * The fields a mode change keeps (the page resets everything else to the new mode's defaults): the background,
 * particle style and trail colours always – they are not mode-specific – and, while a theme is picked, its
 * (possibly tweaked) colours, so the look carries over to the next mode.
 */
export function themeCarryOver(settings: ThemeLook): Partial<ThemeLook> {
  const kept: Partial<ThemeLook> = themeSettingsOf(settings);
  if (!themeById(settings.themeId)) return kept;
  return { ...kept, circleColor: settings.circleColor, ballColor: settings.ballColor, ballColor2: settings.ballColor2, lineColor: settings.lineColor, rainbowWalls: settings.rainbowWalls, rainbowBall: settings.rainbowBall, rainbowLines: settings.rainbowLines };
}

/**
 * Colours of the particle bursts: with a theme picked, the scene's own colours (balls, walls, lines, trail);
 * without one, empty – each particle style then uses its own palette and "confetti" stays the classic burst.
 */
export function particlePalette(settings: ThemeLook): string[] {
  if (!themeById(settings.themeId)) return [];
  const out: string[] = [];
  for (const c of [settings.ballColor, settings.ballColor2, settings.circleColor, settings.lineColor, ...settings.trailColors]) {
    const hex = normalizeHexColor(c);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out;
}

/* ------------------------------------------------------------------ URL sharing */

/** Writes the theme fields that differ from `base` (the mode's defaults) under their short keys. */
export function writeThemeParams(settings: ThemeSettings, base: ThemeSettings, params: URLSearchParams): void {
  if (settings.themeId && settings.themeId !== base.themeId) params.set("theme", settings.themeId);
  // An uploaded picture cannot travel in a link, so "image" is left out (the reader shows the colours instead).
  if (settings.backgroundType !== base.backgroundType && settings.backgroundType !== "image") params.set("bgt", settings.backgroundType);
  if (settings.backgroundColors[0] !== base.backgroundColors[0]) params.set("bg1", settings.backgroundColors[0]);
  if (settings.backgroundColors[1] !== base.backgroundColors[1]) params.set("bg2", settings.backgroundColors[1]);
  if (settings.backgroundDim !== base.backgroundDim) params.set("bgd", String(Math.round(settings.backgroundDim * 100) / 100));
  if (settings.particleStyle !== base.particleStyle) params.set("ps", settings.particleStyle);
  if (settings.trailColors.join(",") !== base.trailColors.join(",")) params.set("trc", settings.trailColors.join(","));
}

/** Reads the theme fields from a URL into `settings`; unknown or invalid values keep what is there (the defaults). */
export function readThemeParams(params: URLSearchParams, settings: ThemeSettings): void {
  const theme = params.get("theme");
  if (theme && themeById(theme)) settings.themeId = theme;
  const bgt = params.get("bgt");
  if (bgt === "solid" || bgt === "gradient") settings.backgroundType = bgt;
  const bg1 = normalizeHexColor(params.get("bg1"));
  const bg2 = normalizeHexColor(params.get("bg2"));
  if (bg1 || bg2) settings.backgroundColors = [bg1 ?? settings.backgroundColors[0], bg2 ?? settings.backgroundColors[1]];
  const bgd = params.get("bgd");
  if (bgd !== null) settings.backgroundDim = clampNumber(bgd, THEME_RANGES.backgroundDim, settings.backgroundDim);
  const ps = params.get("ps");
  if (isParticleStyle(ps)) settings.particleStyle = ps;
  const trc = params.get("trc");
  if (trc !== null) {
    const pair = colorPair(trc.split(","));
    settings.trailColors = pair ?? [];
  }
}
