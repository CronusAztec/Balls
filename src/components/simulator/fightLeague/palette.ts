import type { FightLeagueView, FlArenaStyle, FlStage } from "@/lib/physics/modes/fightLeague";
import { FL_FLOOR, FL_INK, flHexRgb, flLuminance, flNameColor } from "@/lib/physics/modes/fightLeagueFx";
import type { FlDivision } from "@/lib/physics/modes/fightLeagueRoster";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's colours: the stages (lilac – the default –, night, theme: today's look), the
 * HUD palettes keyed by stage, the arena styles (clean, grid, division, neon) with every division's rim and generic motif
 * (colours and hashed geometry only – no emblem, letter or logo), the team rings and the colour helpers.
 */

export { flNameColor };

export const INK = FL_INK;
export const GOLD = "#facc15";
/** The lilac stage's ink-violet (the rim, the cards' borders). */
export const VIOLET_INK = "#1e1b2e";
/** The built-in team colours (2v2 without a Teams roster; teams 3–4 later). */
export const TEAM_COLORS: readonly string[] = ["#f43f5e", "#38bdf8", "#a3e635", "#fbbf24"];
/** Super Star's rainbow: 36 hue strings built once (no string per frame). */
export const RAINBOW: readonly string[] = Array.from({ length: 36 }, (_, i) => `hsl(${i * 10}, 100%, 60%)`);

/** The HUD's colours on a stage. */
export interface FlHudPalette {
  /** Dark boxes (night, theme: today's look) or white cards (lilac). */
  dark: boolean;
  /** The stroke around names and banners. */
  nameStroke: string;
  /** The source lines, the small VS, labels. */
  source: string;
  muted: string;
  /** The ability cards: fill, border, the ability name, the meter's track, the stat values. */
  cardFill: string;
  cardBorder: string;
  cardText: string;
  meterTrack: string;
  statText: string;
  buff: string;
  debuff: string;
  /** The timer pill: fill, text, the last five seconds. */
  pillFill: string;
  pillText: string;
  pillHot: string;
  /** The HP bars' track. */
  barTrack: string;
}

/** A stage's colours. */
export interface FlStagePalette {
  stage: FlStage;
  /** The backdrop's vertical gradient (null: none – the theme's background shows). */
  backdropTop: string | null;
  backdropBottom: string | null;
  /** The backdrop's 45° stripes (null: none) and the night's vignette. */
  stripe: string | null;
  vignette: boolean;
  /** The arena: its floor, its grid, its rim, its drop shadow. */
  floor: string;
  floorLine: string;
  rim: string;
  shadow: string;
  hud: FlHudPalette;
}

const DARK_HUD: FlHudPalette = {
  dark: true,
  nameStroke: "rgba(0, 0, 0, 0.85)",
  source: "#a1a1aa",
  muted: "#71717a",
  cardFill: "rgba(15, 15, 20, 0.88)",
  cardBorder: "#3f3f46",
  cardText: "#f4f4f5",
  meterTrack: "#27272a",
  statText: "#d4d4d8",
  buff: "#a3e635",
  debuff: "#f87171",
  pillFill: "rgba(24, 24, 27, 0.9)",
  pillText: "#d4d4d8",
  pillHot: "#f87171",
  barTrack: "rgba(15, 23, 42, 0.85)",
};

const LILAC_HUD: FlHudPalette = {
  dark: false,
  nameStroke: FL_INK,
  source: "rgba(11, 11, 15, 0.6)",
  muted: "rgba(30, 27, 46, 0.62)",
  cardFill: "rgba(255, 255, 255, 0.96)",
  cardBorder: VIOLET_INK,
  cardText: VIOLET_INK,
  meterTrack: "#e9e5f5",
  statText: "#3f3a52",
  buff: "#15803d",
  debuff: "#dc2626",
  pillFill: VIOLET_INK,
  pillText: "#ffffff",
  pillHot: "#ef4444",
  barTrack: "rgba(30, 27, 46, 0.85)",
};

export const STAGE_PALETTES: Readonly<Record<FlStage, FlStagePalette>> = {
  lilac: { stage: "lilac", backdropTop: "#d9cef7", backdropBottom: "#c4b4ee", stripe: "rgba(255, 255, 255, 0.03)", vignette: false, floor: FL_FLOOR, floorLine: "#ece8f7", rim: VIOLET_INK, shadow: "rgba(30, 27, 46, 0.32)", hud: LILAC_HUD },
  night: { stage: "night", backdropTop: "#0b0b12", backdropBottom: "#0b0b12", stripe: null, vignette: true, floor: "#f1f5f9", floorLine: "#e2e8f0", rim: "#0f172a", shadow: "rgba(0, 0, 0, 0.5)", hud: DARK_HUD },
  theme: { stage: "theme", backdropTop: null, backdropBottom: null, stripe: null, vignette: false, floor: "#f1f5f9", floorLine: "#e2e8f0", rim: "#0f172a", shadow: "rgba(0, 0, 0, 0.35)", hud: DARK_HUD },
};

/** A stage's palette (an unknown stage: lilac). */
export function stagePalette(stage: string | undefined): FlStagePalette {
  return STAGE_PALETTES[(stage ?? "lilac") as FlStage] ?? STAGE_PALETTES.lilac;
}

/* ------------------------------------------------------------------ arena styles */

/** A generic floor motif (3–5 % ink; no emblem). */
export type FlMotif = "none" | "grid" | "halftone" | "rings" | "hex" | "lines" | "speed" | "stars" | "dots" | "hatch" | "stripes" | "circle" | "blocks";

/** An arena's look: its floor, the floor's motif and lines, its rim (and a neon rim's glow). */
export interface FlArenaLook {
  floor: string;
  motif: FlMotif;
  motifColor: string;
  rim: string;
  /** A second, glowing rim line (neon). */
  glow: string | null;
  /** Bodies are outlined in this (light on a dark floor). */
  outline: string;
}

/** Every division's rim colour and motif (the "division" style); a floor tint where the division has one. */
export const DIVISION_ARENAS: Readonly<Record<FlDivision, { rim: string; motif: FlMotif; floor?: string }>> = {
  marvel: { rim: "#b91c1c", motif: "halftone" },
  dc: { rim: "#1d4ed8", motif: "halftone" },
  nintendo: { rim: "#e11d48", motif: "rings" },
  league: { rim: "#0f766e", motif: "hex" },
  fighting: { rim: "#ea580c", motif: "lines" },
  legends: { rim: "#a16207", motif: "rings" },
  shonen: { rim: "#f97316", motif: "speed" },
  starWars: { rim: "#0f172a", motif: "stars" },
  fantasy: { rim: "#4d7c0f", motif: "dots" },
  monsters: { rim: "#166534", motif: "hatch" },
  action: { rim: "#374151", motif: "hatch" },
  tv: { rim: "#7c3aed", motif: "stripes" },
  pokemon: { rim: "#16a34a", motif: "circle", floor: "#f2faf4" },
  modernAnime: { rim: "#db2777", motif: "speed" },
  sandbox: { rim: "#65a30d", motif: "blocks" },
  horror: { rim: "#b91c1c", motif: "hatch", floor: "#1c1917" },
  animated: { rim: "#0ea5e9", motif: "dots" },
  cartoons: { rim: "#f59e0b", motif: "dots" },
  wildcard: { rim: "#6b7280", motif: "none" },
};

/** The division every fighter of the view belongs to (null: a cross-division match – the division style draws clean). */
export function matchDivision(view: Pick<FightLeagueView, "fighters">): FlDivision | null {
  let d: FlDivision | null = null;
  for (const f of view.fighters) {
    if (d === null) d = f.row.division;
    else if (f.row.division !== d) return null;
  }
  return d;
}

/** The arena's look for a stage, a style and the match's division. */
export function arenaLook(pal: FlStagePalette, style: FlArenaStyle | string | undefined, division: FlDivision | null): FlArenaLook {
  const base: FlArenaLook = { floor: pal.floor, motif: "none", motifColor: "rgba(11, 11, 15, 0.045)", rim: pal.rim, glow: null, outline: INK };
  switch (style) {
    case "grid":
      return { ...base, motif: "grid", motifColor: pal.floorLine };
    case "neon":
      return { ...base, motif: "grid", motifColor: "rgba(124, 58, 237, 0.07)", rim: "#7c3aed", glow: "#22d3ee" };
    case "division": {
      if (!division) return base;
      const d = DIVISION_ARENAS[division];
      const floor = d.floor ?? pal.floor;
      const dark = flLuminance(floor) < 0.2;
      return { floor, motif: d.motif, motifColor: dark ? "rgba(255, 255, 255, 0.05)" : "rgba(11, 11, 15, 0.045)", rim: d.rim, glow: null, outline: dark ? "#f4f4f5" : INK };
    }
    default:
      return base;
  }
}

/* ------------------------------------------------------------------ colour helpers */

/** "#rrggbb" lightened (k > 0) or darkened (k < 0) by |k| toward white / black, as "rgb(…)". */
export function shade(color: string, k: number): string {
  const [r, g, b] = flHexRgb(color);
  const t = k >= 0 ? 255 : 0;
  const a = Math.abs(k);
  const mix = (v: number) => Math.round(v + (t - v) * a);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

/** "#rrggbb" at `alpha` as "rgba(…)". */
export function withAlpha(color: string, alpha: number): string {
  const [r, g, b] = flHexRgb(color);
  return `rgba(${r}, ${g}, ${b}, ${Math.max(0, Math.min(1, alpha)).toFixed(3)})`;
}

/** Relative luminance (0–1) of "#rrggbb"; anything else counts as light. */
export function luminance(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 1;
  return flLuminance(color);
}

/** A grey of the same lightness (the loser's panel, a disarmed weapon). */
export function greyOf(color: string): string {
  const [r, g, b] = flHexRgb(color);
  const v = Math.round(0.3 * r + 0.59 * g + 0.11 * b);
  return `rgb(${v}, ${v}, ${v})`;
}

/** A status' remaining-time arc spans the share of this much time left (ms; statuses run 3 s at most). */
export const FL_STATUS_ARC_MS = 3000;
