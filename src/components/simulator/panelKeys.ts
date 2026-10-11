import type { ModeId } from "@/lib/physics/types";
import { MULTI_BALL_MODES } from "@/lib/physics/ballStats";
import { TWO_BALL_MODES } from "@/lib/physics/engine";
import { isArenaGameMode } from "@/lib/physics/modes/arenaGames";
import { isJdmRhythmMode } from "@/lib/physics/modes/jdmRhythm";
import { ARENA_GAME_KEYS } from "./sections/ArenaGamesSection";
import { BALL_DROP_KEYS } from "./sections/BallDropSection";
import { BALL_INTERACTION_KEYS } from "./sections/BallInteractionSection";
import { BATCH_KEYS } from "./sections/BatchSection";
import { BEAT_DROP_KEYS } from "./sections/BeatDropSection";
import { BOT_KEYS } from "./sections/BotSection";
import { BOX_ARENA_KEYS } from "./sections/BoxArenaSection";
import { BULLSEYE_KEYS } from "./sections/BullseyeSection";
import { CAPTION_KEYS } from "./sections/CaptionsSection";
import { COLLISION_PLAYGROUND_KEYS } from "./sections/CollisionPlaygroundSection";
import { DOUBLE_PENDULUM_KEYS } from "./sections/DoublePendulumSection";
import { ESCAPE_MODE_KEYS_BY_MODE } from "./sections/EscapeModeSection";
import { GLASS_KEYS } from "./sections/GlassSection";
import { ILLUSION_KEYS } from "./sections/IllusionSection";
import { PADDLE_KEYS, RUNNER_KEYS } from "./sections/JdmRhythmSection";
import { JOURNEY_KEYS } from "./sections/JourneySection";
import { MULTIPLIER_KEYS } from "./sections/MultipliersSection";
import { MULTIPLIERS_MODE_KEYS } from "./sections/MultipliersModeSection";
import { PENDULUM_WAVE_KEYS } from "./sections/PendulumWaveSection";
import { PICTURE_PAINT_KEYS } from "./sections/PicturePaintSection";
import { POLYRHYTHM_KEYS } from "./sections/PolyrhythmSection";
import { POWER_LAYERS_KEYS } from "./sections/PowerLayersSection";
import { RACE_KEYS } from "./sections/RaceSection";
import { SPLIT_SCREEN_KEYS } from "./sections/ArenasSection";
import { STRING_BATTLE_KEYS } from "./sections/StringBattleSection";
import { TERRITORY_KEYS } from "./sections/TerritorySection"; // --- odd-territory ---
import { MAZE_KEYS } from "./sections/MazeSection"; // --- odd-maze ---
import { CONVEYOR_KEYS, showsRespawn } from "./sections/ConveyorSection"; // --- gerald-conveyor ---
import { ORB_GRID_KEYS } from "./sections/OrbGridSection"; // --- orb-grid ---
import { FIGHT_LEAGUE_KEYS } from "./sections/FightLeagueSection"; // --- fight-league ---
import { LAND_CLAIM_KEYS } from "./sections/LandClaimSection"; // --- land-claim ---
import { STAR_CHORDS_KEYS } from "./sections/StarChordsSection"; // --- chord-stars ---
import { HOOPS_KEYS } from "./sections/HoopsSection"; // --- bead-hoops ---
import { VIDEO_BEATS_KEYS } from "./sections/VideoBeatsSection";
import { VORTEX_KEYS } from "./sections/VortexSection";
import { WALL_WOBBLE_KEYS } from "./sections/WallWobbleSection";
import { EXIT_BEHAVIOR_KEYS, SPLAT_BARRIER_KEYS } from "./sections/ExitSplatSection"; // --- gerald-exit-splat ---
import { supportsMovingExits, supportsSplats } from "@/lib/physics/exitSplat"; // --- gerald-exit-splat ---

/*
 * --- review fix (site-redesign) --- Which of the panel's searchable controls a mode shows: the Wall section's rules (shared
 * with Controls.tsx), every mode's own block of the Mode group and the core controls a mode or a setting leaves out. The
 * command palette lists only these, so an entry never names a control the panel cannot show – another mode's Gravity, Wall
 * Count in a mode without rings, the Multipliers group outside the multiplier modes. (A control that only waits for Show
 * Advanced Options or a collapsed block is still offered: the palette finds it through the search box.)
 */

/** The Wall section's controls in a mode: wall count, thickness, the gap controls (Rotation) and Gap Size itself. */
export function wallControlsOf(mode: ModeId): { wallCount: boolean; thickness: boolean; gapControls: boolean; gapSize: boolean } {
  // --- fight-league --- Fight League has no rings: its arena (a square or a circle) and its rim are the mode's own
  if (mode === "fightLeague") return { wallCount: false, thickness: false, gapControls: false, gapSize: false };
  // --- chord-stars --- Chord Stars has no rings: one thin circle, drawn with the wall thickness
  if (mode === "starChords") return { wallCount: false, thickness: true, gapControls: false, gapSize: false };
  // --- bead-hoops --- Spinning Hoops has no rings: its hoops are drawn with the wall thickness
  if (mode === "hoops") return { wallCount: false, thickness: true, gapControls: false, gapSize: false };
  // --- jdm-illusions --- (illusion) --- jdm-race --- (race) --- jdm-arena-games --- (battle, ctf) --- odd-string-battle --- (stringBattle) --- odd-power-layers --- (powerLayers) --- gerald-vortex --- (vortex) --- gerald-journey --- (journey: a rings stage's size sets its ring count; Gap Size and Rotation still apply) --- gerald-bullseye --- (bullseye) --- beat-drop --- (beatDrop) --- odd-territory --- (territory) --- odd-maze --- (maze)
  const wallCount = !["lines", "accumulation", "multiply", "paint", "target", "colorMatch", "grow", "portal", "drop", "box", "pendulum", "polyrhythm", "collide", "glass", "multipliers", "doublePendulum", "illusion", "race", "stringBattle", "powerLayers", "vortex", "journey", "bullseye", "beatDrop", "territory", "maze"].includes(mode) && !isArenaGameMode(mode) && !isJdmRhythmMode(mode) && mode !== "landClaim" /* --- land-claim --- (no rings) */;
  // --- jdm-illusions --- (illusion) --- jdm-race --- (race) --- jdm-arena-games --- (battle, ctf) --- odd-string-battle --- (stringBattle) --- odd-power-layers --- (powerLayers) --- gerald-vortex --- (vortex) --- gerald-bullseye --- (bullseye) --- beat-drop --- (beatDrop) --- odd-territory --- (territory) --- odd-maze --- (maze)
  const gapControls = !["lines", "paint", "target", "colorMatch", "shatter", "drop", "box", "pendulum", "polyrhythm", "collide", "glass", "multipliers", "doublePendulum", "illusion", "race", "stringBattle", "powerLayers", "vortex", "bullseye", "beatDrop", "territory", "maze"].includes(mode) && !isArenaGameMode(mode) && !isJdmRhythmMode(mode) && mode !== "landClaim" /* --- land-claim --- (no rings) */;
  // --- review fix (ui-i18n) --- Grow builds one gapless ring and Portal's gaps come only from used-up portals: no Gap Size there
  // (their Rotation toggle still applies – Grow's Spin extra, Portal's rotating gaps).
  const gapSize = gapControls && mode !== "grow" && mode !== "portal";
  // Ball Drop, Bouncing Shapes, Pendulum Wave, Metronomes & Polyrhythms and the Collision Playground have no rings, but their
  // pegs, bars, box walls, rigs, guides and containers are drawn with the wall thickness. --- jdm-double-pendulum --- (strings
  // and rods) --- jdm-illusions --- (illusion) --- jdm-race --- (walls, arms) --- jdm-arena-games --- (the arena walls)
  // --- odd-string-battle --- (the ring) --- gerald-vortex --- (the sound rings) --- gerald-bullseye --- (the walls, the
  // landing line, the target's rim) --- beat-drop --- (the obstructions' outlines) --- odd-territory --- (the frame; the Maze
  // draws its own glowing walls)
  const thickness = gapControls || ["drop", "box", "pendulum", "polyrhythm", "collide", "glass", "multipliers", "doublePendulum", "illusion", "race", "stringBattle", "vortex", "bullseye", "beatDrop", "territory"].includes(mode) || isArenaGameMode(mode) || mode === "landClaim" /* --- land-claim --- (the arena's wall) */;
  return { wallCount, thickness, gapControls, gapSize };
}

/** The arena games' block: the battle's controls in Battle Royale, the flag's in Capture the Flag (the heading and the nudge in both). */
const ARENA_KEYS_OF = (mode: "battle" | "ctf") => ARENA_GAME_KEYS.filter((key) => !key.startsWith(mode === "battle" ? "ctf" : "bt"));

/**
 * Every mode's own block in the Mode group (Controls.tsx modeSpecific()): the search keys of what it renders. A mode
 * shows only its own block (and, while the search box is in use, the Ball or Visual section shows it), so these keys are
 * offered in their mode only – under the Mode group, where the control is.
 */
export const MODE_BLOCK_KEYS: Readonly<Partial<Record<ModeId, readonly string[]>>> = {
  ...ESCAPE_MODE_KEYS_BY_MODE,
  paint: PICTURE_PAINT_KEYS,
  drop: BALL_DROP_KEYS,
  box: BOX_ARENA_KEYS,
  pendulum: PENDULUM_WAVE_KEYS,
  polyrhythm: POLYRHYTHM_KEYS,
  collide: COLLISION_PLAYGROUND_KEYS,
  glass: GLASS_KEYS,
  multipliers: MULTIPLIERS_MODE_KEYS,
  doublePendulum: DOUBLE_PENDULUM_KEYS,
  illusion: ILLUSION_KEYS,
  stringBattle: STRING_BATTLE_KEYS,
  powerLayers: POWER_LAYERS_KEYS,
  race: RACE_KEYS,
  battle: ARENA_KEYS_OF("battle"),
  ctf: ARENA_KEYS_OF("ctf"),
  runner: RUNNER_KEYS,
  paddle: PADDLE_KEYS,
  vortex: VORTEX_KEYS,
  journey: JOURNEY_KEYS,
  bullseye: BULLSEYE_KEYS,
  beatDrop: BEAT_DROP_KEYS,
  territory: TERRITORY_KEYS, // --- odd-territory ---
  maze: MAZE_KEYS, // --- odd-maze ---
  conveyor: CONVEYOR_KEYS, // --- gerald-conveyor ---
  orbGrid: ORB_GRID_KEYS, // --- orb-grid ---
  fightLeague: FIGHT_LEAGUE_KEYS, // --- fight-league ---
  landClaim: LAND_CLAIM_KEYS, // --- land-claim ---
  starChords: STAR_CHORDS_KEYS, // --- chord-stars ---
  hoops: HOOPS_KEYS, // --- bead-hoops ---
};

/** The keys of every mode's block. */
export const MODE_BLOCK_KEY_SET: ReadonlySet<string> = new Set(Object.values(MODE_BLOCK_KEYS).flatMap((keys) => keys ?? []));

/** Search keys that only widen the search box – another word for a control listed under its own key – and name no control. */
const SEARCH_ALIASES: ReadonlySet<string> = new Set([
  "twoBalls", // the Ball Count slider replaced the Two Balls switch
  "timeline", // "Timeline keyframes": the Timeline group's own word (the group's entry covers it)
]);

/** What besides the mode decides whether a core control of the panel shows. */
export interface PanelShown {
  mode: ModeId;
  /** A picture or emoji ball (no Ball Color then). */
  ballPicture: boolean;
  showTrails: boolean;
  glassGates: boolean;
  /** A circular wall is in play (WallWobbleSection's hasWobblyWalls()). */
  wobblyWalls: boolean;
  /** A found run is on the page (its clip length is kept: no Duration slider). */
  simulationFound: boolean;
  /** A top or bottom text is set (the Text Size slider). */
  bannerText: boolean;
  /** Split screen with two or more arenas (the per-arena editor of the Split screen section). */
  arenas: boolean;
  /** A team roster is set (its rows and Add Team). */
  teams: boolean;
  /** At least one caption (the caption form's fields). */
  captions: boolean;
  /** A video plays behind the canvas (its opacity slider). */
  videoBackground: boolean;
  /** The page's optional blocks. */
  videoBeats: boolean;
  batch: boolean;
  bot: boolean;
}

const MULTIPLIER_GROUP_SET: ReadonlySet<string> = new Set(MULTIPLIER_KEYS);
const BALL_INTERACTION_SET: ReadonlySet<string> = new Set(BALL_INTERACTION_KEYS);
const WALL_WOBBLE_SET: ReadonlySet<string> = new Set(WALL_WOBBLE_KEYS);
const EXIT_BEHAVIOR_SET: ReadonlySet<string> = new Set(EXIT_BEHAVIOR_KEYS); // --- gerald-exit-splat ---
const SPLAT_BARRIER_SET: ReadonlySet<string> = new Set(SPLAT_BARRIER_KEYS); // --- gerald-exit-splat ---
const VIDEO_BEATS_SET: ReadonlySet<string> = new Set(VIDEO_BEATS_KEYS);
const BATCH_SET: ReadonlySet<string> = new Set(BATCH_KEYS);
const BOT_SET: ReadonlySet<string> = new Set(BOT_KEYS);
/** The Split screen section's per-arena editor (ArenasSection's EDITOR_KEYS: everything after the count, layout and sound). */
const SPLIT_EDITOR_SET: ReadonlySet<string> = new Set(SPLIT_SCREEN_KEYS.slice(3));
/** A caption's form (everything but the section's heading and the Add buttons). */
const CAPTION_FORM_SET: ReadonlySet<string> = new Set(CAPTION_KEYS.filter((key) => key !== "captions" && key !== "captionAdd"));

/**
 * Whether a search key of a panel section (Controls.tsx SECTION_KEYS) names a control that section renders in this mode
 * with these settings. A mode block's key is never a section's (it belongs to the Mode group: MODE_BLOCK_KEYS); `multipliers`
 * is whether the Ball section shows its Multipliers group (MultipliersSection's showsMultipliersSection()).
 */
export function sectionKeyShown(key: string, p: PanelShown, multipliers: boolean): boolean {
  if (MODE_BLOCK_KEY_SET.has(key) || SEARCH_ALIASES.has(key)) return false;
  if (key === "ballCount") return MULTI_BALL_MODES.includes(p.mode);
  if (key === "respawnEvery") return showsRespawn(p.mode); // --- gerald-conveyor --- the respawn timer of Classic and Multiply
  if (BALL_INTERACTION_SET.has(key)) return TWO_BALL_MODES.includes(p.mode);
  if (key === "ballColor") return !p.ballPicture;
  if (MULTIPLIER_GROUP_SET.has(key)) return multipliers;
  const walls = wallControlsOf(p.mode);
  if (key === "wallCount") return walls.wallCount;
  if (key === "wallThickness") return walls.thickness;
  if (key === "gapSize") return walls.gapSize;
  if (key === "rotation") return walls.gapControls;
  if (WALL_WOBBLE_SET.has(key)) return p.wobblyWalls;
  if (key === "trailThickness") return p.showTrails;
  if (key === "videoDuration") return !p.simulationFound;
  if (key === "textSize") return p.bannerText;
  if (key === "vbVideoOpacity") return p.videoBeats && p.videoBackground;
  if (VIDEO_BEATS_SET.has(key)) return p.videoBeats;
  if (BATCH_SET.has(key)) return p.batch;
  if (BOT_SET.has(key)) return p.bot;
  if (SPLIT_EDITOR_SET.has(key)) return p.arenas;
  if (CAPTION_FORM_SET.has(key)) return p.captions;
  if (key === "teamAdd") return p.teams;
  // --- gerald-exit-splat --- the moving exits in the ring modes with one exit a ring, the splat barrier in the ring modes
  if (EXIT_BEHAVIOR_SET.has(key)) return supportsMovingExits(p.mode);
  if (SPLAT_BARRIER_SET.has(key)) return supportsSplats(p.mode);
  return true;
}
