import type { FightLeagueView, FlFighter } from "@/lib/physics/modes/fightLeague";
import type { FlShape } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_MAX_SLOTS } from "@/lib/physics/modes/fightLeagueFx";
import { arenaLook, stagePalette, type FlArenaLook, type FlStagePalette } from "./palette";
import { GlowSprites } from "./sprites";
import { FlTextCache } from "./text";

/**
 * --- fl-overhaul --- (Stage 3) What every module of Fight League's renderer shares within a frame: the labels and options
 * the page hands in, the view and its clocks (the simulation's and the effects' – warped by the KO finale), the scales
 * (device px per CSS px and per world px), the stage's palette and the arena's look, the text and glow caches, and where each
 * fighter is drawn this frame (an impact frame holds it, the finale's drift moves it, the winner bobs).
 */

export interface FightLeagueLabels {
  /** The intro card's "VS". */
  vs: string;
  /** Flashed when the fighters launch. */
  fight: string;
  /** The callout over a knocked-out fighter and the KO flash. */
  ko: string;
  doubleKo: string;
  /** "[name] wins!" (a fighter) and "[names] win!" (a 2v2 team). */
  wins: (name: string) => string;
  winTeam: (names: string) => string;
  draw: string;
  /** The time cap decided it. */
  time: string;
  /** Under the banner: the winner's HP left and hits landed. */
  winSub: (hp: number, hits: number) => string;
  /** The stat lines' words: speed, damage, attack speed, cast speed. */
  speed: string;
  damage: string;
  attack: string;
  cast: string;
  /** The meter is full (waiting for a target). */
  ready: string;
  /** --- fl-overhaul --- The time cap with two sides standing: sudden death in a shrinking arena. */
  sudden: string;
  // --- fl-overhaul --- (Stage 3) the banners, the callouts and the plates
  firstBlood: string;
  perfect: string;
  clutch: string;
  blocked: string;
  dodge: string;
  immune: string;
  interrupted: string;
  clash: string;
  /** "[n] HITS" (a combo). */
  combo: (n: number) => string;
  /** The bottom plate during sudden death. */
  suddenDeath: string;
  /** The bottom plate during the fight. */
  whoWins: string;
  /** The bottom plate after the verdict: "[name] WINS". */
  winsPlate: (name: string) => string;
  /** A division's and a role's display names (the VS card's chips). */
  division: (id: string) => string;
  role: (id: string) => string;
}

export interface FightLeagueRenderOptions {
  /** Device pixels per CSS pixel: the sprites are rasterised at it. */
  dpr: number;
  /** The HP number inside the balls (off while ball faces cover them). */
  numbers: boolean;
  /** 2v2: the two teams' colours (the Teams roster's), drawn as a ring around their fighters; null: the built-in pair. */
  teamColors: readonly string[] | null;
  /** The teams layer draws the winner banner (2v2 with a roster): this layer leaves it out. */
  teamBanner: boolean;
  labels: FightLeagueLabels;
  // --- fl-overhaul --- (Stage 3)
  /** "full" (every recording and the fast export) or "lite" (the page only, while not recording: fewer embers and ghosts). */
  quality?: "full" | "lite";
  /** prefers-reduced-motion (the shake at its default strength is cut to 30 %). */
  reducedMotion?: boolean;
  /** The camera's own Screen Shake is on (the mode's shake stands down). */
  cameraShake?: boolean;
  /** The hit shapes (flDbg=1 in the URL; no panel control). */
  debug?: boolean;
}

/** Per-frame shared state (one per layer; its arrays are reused every frame). */
export class FlFrame {
  view: FightLeagueView | null = null;
  o: FightLeagueRenderOptions | null = null;
  /** The simulation clock and the effects' clock (the finale's warp). */
  now = 0;
  fxNow = 0;
  /** Device px per CSS px, and per world px (dpr × the display scale of the field). */
  dpr = 1;
  px = 1;
  pal: FlStagePalette = stagePalette("lilac");
  look: FlArenaLook = arenaLook(stagePalette("lilac"), "clean", null);
  /** The arena unit (world px): 6.5 % of the field's side – the effects' size. */
  unit = 6;
  readonly text = new FlTextCache();
  readonly glow = new GlowSprites();
  /** Where each fighter is drawn (world px) and how far its impact hold has caught up (1: where it is). */
  readonly dx = new Float64Array(FL_MAX_SLOTS);
  readonly dy = new Float64Array(FL_MAX_SLOTS);
  /** Each fighter's impact: its age (ms; Infinity none), heavy or not, where it was held. */
  readonly impactAge = new Float64Array(FL_MAX_SLOTS).fill(Infinity);
  readonly impactHeavy = new Uint8Array(FL_MAX_SLOTS);
  readonly heldX = new Float64Array(FL_MAX_SLOTS);
  readonly heldY = new Float64Array(FL_MAX_SLOTS);
  /** The finale's push-in: its scale around (zoomX, zoomY) (1: none). */
  zoomK = 1;
  zoomX = 0;
  zoomY = 0;
  lite = false;
  /**
   * Draws a projectile-shaped sprite (`shape` of radius `pr` in `color`, the owner `f`'s palette) at (x, y) along `angle`
   * – the projectiles' painter, handed to the weapons' (orbiting cards, a bomb in the hand, a portrait's shot).
   */
  shot: (ctx: CanvasRenderingContext2D, shape: FlShape, pr: number, color: string, f: FlFighter, x: number, y: number, angle: number, alpha: number) => void = () => {};

  /** Where `f` is drawn this frame. */
  x(f: FlFighter): number {
    return this.dx[f.slot] ?? f.x;
  }
  y(f: FlFighter): number {
    return this.dy[f.slot] ?? f.y;
  }
}
