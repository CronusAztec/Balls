import type { BallInteraction, ModeId, WallBreakStyle } from "@/lib/physics/types";
import { CUSTOM_HIT_SAMPLE_ID, DEFAULT_HIT_SAMPLE_ID, isHitSoundMode, normalizeHitSampleId, type HitSoundMode } from "@/lib/audio/sampler";
import { isInstrumentId, type InstrumentId } from "@/lib/audio/instruments";
import { BPM_MAX, BPM_MIN, ROOT_NOTE_MAX, ROOT_NOTE_MIN, isQuantizeGrid, isScaleId, type QuantizeGrid, type ScaleId } from "@/lib/audio/scales";
import { normalizeWallBreakSound } from "@/lib/audio/songs";
import { DEFAULT_PHYSICS_EXTRAS, PHYSICS_EXTRA_KEYS, PHYSICS_EXTRA_RANGES } from "@/lib/physics/extras";
import { BALL_INTERACTION_RANGES, DEFAULT_BALL_INTERACTION } from "@/lib/physics/interactions";
import { BOX_RANGES, DEFAULT_BOX_SETTINGS, boxSettingFields, boxSettingsOf, isBoxShape, isBoxSpeedRatio, resolveBoxSettings, type BoxShape, type BoxSpeedRatio } from "@/lib/physics/modes/box";
import { DEFAULT_DROP_SETTINGS, DROP_RANGES, dropSettingFields, dropSettingsOf, resolveDropSettings } from "@/lib/physics/modes/drop";
import { DEFAULT_PENDULUM_SETTINGS, PENDULUM_RANGES, isPendulumLayout, isPendulumPitchDirection, isPendulumSoundOn, pendulumSettingFields, pendulumSettingsOf, resolvePendulumSettings, type PendulumLayout, type PendulumPitchDirection, type PendulumSoundOn } from "@/lib/physics/modes/pendulum";
// --- jdm-polyrhythm ---
import { DEFAULT_POLYRHYTHM_SETTINGS, POLYRHYTHM_RANGES, isPolyArcStyle, isPolyLayout, isPolyPitchBy, isPolyTempos, polyrhythmSettingFields, polyrhythmSettingsOf, resolvePolyrhythmSettings, sanitizeCustomRatios, type PolyArcStyle, type PolyLayout, type PolyPitchBy, type PolyTempos } from "@/lib/physics/modes/polyrhythm";
// --- jdm-collisions ---
import { COLLIDE_RANGES, DEFAULT_COLLIDE_SETTINGS, collideSettingFields, collideSettingsOf, isCollideContainer, resolveCollideSettings, type CollideContainer } from "@/lib/physics/modes/collide";
// --- gerald-glass ---
import { DEFAULT_GLASS_SETTINGS, GLASS_RANGES, glassSettingFields, glassSettingsOf, resolveGlassSettings } from "@/lib/physics/modes/glass";
import { DEFAULT_PICTURE_PAINT, PICTURE_PAINT_RANGES, isPaintBeatSource, picturePaintOf, resolvePicturePaintSettings, type PaintBeatSource } from "@/lib/physics/picturePaint";
import { isBallInteraction, isModeId, WALL_BREAK_STYLES } from "@/lib/physics/types";
import { CHARACTER_RANGES, DEFAULT_CHARACTER, characterOf, isFaceStyle, resolveCharacterSettings, type FaceStyle } from "@/lib/character/character"; // --- gerald-faces ---
import { THEME_RANGES, defaultThemeSettings, readThemeParams, resolveThemeSettings, writeThemeParams, type BackgroundType, type ParticleStyle } from "@/lib/themes"; // --- themes
import { TEAM_RANGES, defaultTeamSettings, readTeamParams, resolveTeamSettings, writeTeamParams, type ScoreboardPosition, type TeamEntry } from "@/lib/teams"; // --- teams ---
import { CAMERA_RANGES, DEFAULT_CAMERA_SETTINGS, cameraSettingsOf, resolveCameraSettings } from "@/lib/simulation/camera"; // --- camera
// --- gerald-multipliers ---
import { DEFAULT_MULTIPLIER_CONFIG, MULTIPLIER_RANGES, multiplierConfigOf, resolveMultiplierConfig, sanitizePickupTypes } from "@/lib/physics/multipliers";
import { DEFAULT_MULTIPLIERS_SETTINGS, MULTIPLIERS_RANGES, multipliersSettingFields, multipliersSettingsOf, resolveMultipliersSettings, sanitizeGateMix } from "@/lib/physics/modes/multipliers";
// --- obstacle-editor ---
import { OBSTACLE_EDITOR_RANGES, defaultObstacleSettings, obstacleBeyondSliders, readObstacleParams, resolveObstacleSettings, supportsObstacles, writeObstacleParams, type EditorObstacle } from "@/lib/physics/obstacleEditor";
// --- gerald-exit-splat --- moving exits and splat barriers of the ring modes
import { EXIT_ENGINE_KEYS, EXIT_SPLAT_RANGES, MOVING_EXIT_MODES, SPLAT_ENGINE_KEYS, SPLAT_MODES, defaultExitSplatFields, readExitSplatParams, resolveExitSplatFields, writeExitSplatParams, type ExitBehavior } from "@/lib/physics/exitSplat";
import { CAPTION_RANGES, defaultCaptionSettings, readCaptionParams, resolveCaptionSettings, writeCaptionParams, type Caption } from "@/lib/captions"; // --- captions ---
import { DEFAULT_RIGGED, RIGGED_RANGES, resolveRiggedConfig } from "@/lib/physics/rigged"; // --- rigged ---
import { TIMELINE_RANGES, defaultTimelineSettings, readTimelineParams, resolveTimelineSettings, writeTimelineParams, type Keyframe } from "@/lib/simulation/timeline"; // --- timeline ---
import { DEFAULT_FAST_EXPORT_SETTINGS, FAST_EXPORT_RANGES, resolveFastExportSettings } from "@/lib/recording/fastRenderPlan"; // --- fast-render ---
// --- jdm-double-pendulum ---
import { DEFAULT_DOUBLE_PENDULUM_SETTINGS, DOUBLE_PENDULUM_RANGES, doublePendulumSettingFields, readDoublePendulumParams, resolveDoublePendulumFields, writeDoublePendulumParams, type DpStringLayout } from "@/lib/physics/modes/doublePendulum";
// --- jdm-illusions --- the Circle Illusion mode and the global Wobbly Walls amount
import { ILLUSION_RANGES, defaultIllusionFields, readIllusionParams, resolveIllusionFields, writeIllusionParams, type IllusionPatternChoice, type IllusionType } from "@/lib/physics/modes/illusion";
import { WOBBLE_RANGES } from "@/lib/physics/wobble";
// --- odd-string-battle --- the String Battle mode (oddplayground's WEB DOMINION)
import { STRING_BATTLE_RANGES, defaultStringBattleFields, readStringBattleParams, resolveStringBattleFields, writeStringBattleParams, type SbRule, type SbStyle } from "@/lib/physics/modes/stringBattle";
// --- odd-power-layers --- the Power Layers mode (oddplayground)
import { POWER_LAYERS_RANGES, defaultPowerLayersFields, powerLayersModeDefaults, readPowerLayersParams, resolvePowerLayersFields, writePowerLayersParams, type PlBadge, type PlSequence } from "@/lib/physics/modes/powerLayers";
// --- jdm-race ---
import { RACE_RANGES, defaultRaceFields, readRaceParams, resolveRaceFields, writeRaceParams, type RaceCamera, type RaceShape } from "@/lib/physics/modes/race";
import type { RaceFeature } from "@/lib/physics/raceTrack";
// --- jdm-arena-games --- Bouncing Square Battle Royale and Capture the Flag
import { ARENA_GAME_RANGES, defaultArenaGameFields, readArenaGameParams, resolveArenaGameFields, writeArenaGameParams, type BattleArena } from "@/lib/physics/modes/arenaGames";
// --- jdm-rhythm-runner --- Beat Runner and Paddle Keep-Up
import { JDM_RHYTHM_RANGES, defaultJdmRhythmFields, readJdmRhythmParams, resolveJdmRhythmFields, writeJdmRhythmParams } from "@/lib/physics/modes/jdmRhythmFields";
import type { RunnerBeatSource, RunnerMix } from "@/lib/physics/modes/runner";
// --- split-screen --- 2 or 4 arenas racing on one canvas (lib/splitScreen.ts, lib/simulation/multi.ts)
import { SPLIT_SCREEN_RANGES, defaultSplitScreenFields, readSplitScreenParams, resolveSplitScreenFields, writeSplitScreenParams, type ArenaCount, type ArenaLayout, type ArenaOverride, type SoundArena } from "@/lib/splitScreen";
// --- gerald-vortex --- the Sound Vortex mode
import { VORTEX_RANGES, defaultVortexFields, readVortexParams, resolveVortexFields, writeVortexParams } from "@/lib/physics/modes/vortex";
// --- gerald-journey --- the Journey mode
import { JOURNEY_RANGES, defaultJourneyFields, readJourneyParams, resolveJourneyFields, writeJourneyParams } from "@/lib/physics/modes/journey";
// --- gerald-bullseye --- the Bullseye mode
import { BULLSEYE_RANGES, defaultBullseyeFields, readBullseyeParams, resolveBullseyeFields, writeBullseyeParams } from "@/lib/physics/modes/bullseye";
// --- beat-drop --- the Beat Drop mode
import { BEAT_DROP_RANGES, beatDropModeDefaults, defaultBeatDropFields, readBeatDropParams, resolveBeatDropFields, writeBeatDropParams, type BeatDropColorMode, type BeatDropSound } from "@/lib/physics/modes/beatDrop";
import type { BeatDropScroll } from "@/lib/simulation/beatDropPlan";
// --- video-beats --- the beat source picker, hand-placed beat markers, On beat and the video background
import { VIDEO_BEATS_RANGES, defaultVideoBeatsFields, readVideoBeatsParams, resolveVideoBeatsFields, writeVideoBeatsParams } from "@/lib/simulation/videoBeatsSettings";
import type { BeatSourceKind } from "@/lib/simulation/beatSource";
// --- odd-territory --- the Territory mode (oddplayground's pong-wars battle)
import { TERRITORY_RANGES, defaultTerritoryFields, readTerritoryParams, resolveTerritoryFields, territoryModeDefaults, writeTerritoryParams } from "@/lib/physics/modes/territory";
// --- bounce-math --- rules that change a parameter by a mathematical step on every bounce, pass, collision, break, beat, bar or second
import { BOUNCE_MATH_RANGES, defaultBounceMathFields, readBounceMathParams, resolveBounceMathFields, writeBounceMathParams, type BounceRule } from "@/lib/simulation/bounceMath";
// --- unlimited --- No limits: every numeric setting past its slider range (parsing, links, presets)
import { UNLIMITED_URL_KEY, beyondRange, discoverUrlKeys, isIntegerRange, readUnlimitedParams, restoreUnlimitedValues, unlimitedKeysOf, writeUnlimitedParams } from "@/lib/unlimited";
// --- uncap-all --- Uncapped everything: the numeric Bounciness (the uncapped Bouncier) and the memory-safety ceilings
import { BOUNCIER_ON, BOUNCINESS_OFF, BOUNCINESS_RANGE, atLeastMin, bouncinessOf, pastMemoryCeiling } from "@/lib/uncap";
// --- odd-maze --- the Maze escape mode (oddplayground)
import { MAZE_RANGES, defaultMazeFields, readMazeParams, resolveMazeFields, writeMazeParams, type MazeBrain, type MazeHand } from "@/lib/physics/modes/maze";
// --- gerald-conveyor --- the Conveyor Belt mode and the respawn timer of Classic and Multiply
import { CONVEYOR_RANGES, defaultConveyorFields, readConveyorParams, resolveConveyorFields, writeConveyorParams, type ConveyorArena } from "@/lib/physics/modes/conveyor";
import { RESPAWN_RANGES } from "@/lib/physics/respawn";
// --- land-claim --- the Land Claim mode (columns of blocks knocked off by competitors' balls)
import { LAND_CLAIM_RANGES, defaultLandClaimFields, landClaimModeDefaults, readLandClaimParams, resolveLandClaimFields, writeLandClaimParams, type LcArena, type LcRule } from "@/lib/physics/modes/landClaim";

/**
 * Every user-facing simulator setting lives in this one object. The controls panel,
 * URL sharing, presets and the seed finder all read from it, so adding a setting means:
 *  1. add a field here (+ default in `defaultSettings`),
 *  2. optionally add a short URL key in NUMERIC_URL_KEYS / BOOLEAN_URL_KEYS / STRING_URL_KEYS (or the feature's
 *     write…Params / read…Params helpers) so it is shareable,
 *  3. render a control for it in components/simulator/Controls.tsx,
 *  4. apply it to the engine in components/simulator/Simulator.tsx.
 */
export type RainbowWallMode = "pulse" | "gradient";

export interface SimulatorSettings {
  mode: ModeId;
  // Ball & physics
  gravity: number;
  bounce: number;
  ballSpeed: number;
  ballColor: string;
  ballRadius: number;
  rainbowBall: boolean;
  twoBalls: boolean;
  ballColor2: string;
  bouncierEnabled: boolean;
  // Physics extras (lib/physics/extras.ts): all off by default so existing seeds replay identically
  /** Fraction of the velocity lost per 60 Hz step (URL `drag`). */
  airDrag: number;
  /** Constant sideways / vertical push as a fraction of the ball speed per second (URL `wx`, `wy`). */
  windX: number;
  windY: number;
  /** 0–1: wall contact spins the ball and the spin curves its flight, Magnus-style (URL `spin`). */
  spinStrength: number;
  /** Restitution at wall hits, 0.5–1.2 (URL `wb`). */
  wallBounciness: number;
  /** Walls pulse by ±this fraction of their radius (URL `bw`) at `breathingSpeed` pulses per second (URL `bws`). */
  breathingAmplitude: number;
  breathingSpeed: number;
  /** Degrees per second the gravity vector turns (URL `rg`). */
  rotatingGravity: number;
  // Ball interactions (lib/physics/interactions.ts): bounce by default, so existing seeds replay identically
  /** What balls do to each other: bounce, merge into one, split at every wall break or pass through (URL `bi`). */
  ballInteraction: BallInteraction;
  /** Smallest ball a split may produce, in px (URL `smr`). */
  splitMinRadius: number;
  /** Splitting stops once this many balls are in play (URL `mb`). */
  maxBalls: number;
  // Walls
  wallCount: number;
  wallThickness: number;
  gapSize: number;
  rotationEnabled: boolean;
  rotationSpeed: number;
  circleColor: string;
  rainbowWalls: boolean;
  rainbowWallMode: RainbowWallMode;
  // Visual effects
  showTrails: boolean;
  trailThickness: number;
  showGlow: boolean;
  showWallGlow: boolean;
  colorTrail: boolean;
  reactiveBackground: boolean;
  cameraFollow: boolean;
  wallBreakStyle: WallBreakStyle;
  cinematicEnabled: boolean;
  // --- themes (lib/themes.ts): one-click looks, backgrounds and particle styles – visual only, off by default
  /** The theme the look was picked from, "" = none (URL `theme`). */
  themeId: string;
  /** solid | gradient | image (URL `bgt`; the uploaded picture stays in memory, so links carry solid / gradient only). */
  backgroundType: BackgroundType;
  /** Two colours: the solid colour (first) or the top → bottom gradient (URL `bg1`, `bg2`). */
  backgroundColors: string[];
  /** 0–1: how far the background picture is darkened (URL `bgd`). */
  backgroundDim: number;
  /** confetti | sparks | petals | pixels | bubbles: the bursts at wall breaks and finishes (URL `ps`). */
  particleStyle: ParticleStyle;
  /** Two colours the colour trail cycles between; empty = the rainbow (URL `trc`). */
  trailColors: string[];
  // --- end themes
  // Mode specific
  accumulationTime: number;
  spikesEnabled: boolean;
  spikeCount: number;
  multiplySpawnCount: number;
  lineColor: string;
  rainbowLines: boolean;
  linesCenterDot: boolean;
  targetCount: number;
  countdownRandom: boolean;
  colorMatchColorCount: number;
  growRate: number;
  growCenterDot: boolean;
  growLines: boolean;
  // Ball Drop (lib/physics/modes/drop.ts): balls released from the top through a board of pegs and bars
  /** Balls released, 1–40 (URL `dbc`). */
  dropBallCount: number;
  /** 0–1: spread of the ball sizes around the ball size (URL `dsv`); bigger balls play lower notes. */
  dropSizeVariation: number;
  /** 0–1: spread of each ball's own gravity, ½×–2× at 1 (URL `dgv`). */
  dropGravityVariation: number;
  /** Rows of pegs and bars, 3–12 (URL `drows`). */
  dropRows: number;
  /** Seconds between two releases, 0–2 (URL `dsi`). */
  dropSpawnInterval: number;
  /** "Rain": the floor opens and balls that fall out come back in at the top (URL `dloop`). */
  dropLoop: boolean;
  // Bouncing Shapes (lib/physics/modes/box.ts): squares, circles or DVD-style logos bouncing in a rectangular box
  /** Shapes in the box, 1–12 (URL `bxn`). */
  boxShapeCount: number;
  /** square | circle | dvd (URL `bxs`). */
  boxShape: BoxShape;
  /** Width of the box relative to its height, 0.5–2 (URL `bxa`). */
  boxAspect: number;
  /** 0–1: how much of the gravity setting acts on the shapes (URL `bxg`). */
  boxGravity: number;
  /** Starting countdown on every shape, 0–99; 0 = off (URL `bxc`). */
  boxCountdown: number;
  /** Percent a shape grows per wall hit, 0–3 (URL `bxgr`). */
  boxGrowPerHit: number;
  /** Speeds of the shapes in whole-number ratios: 1:1, 2:3, 3:4:5 or 4:5:6 (URL `bxr`). */
  boxSpeedRatio: BoxSpeedRatio;
  // Pendulum Wave (lib/physics/modes/pendulum.ts): pendulums tuned so the row drifts into waves and snaps back every cycle
  /** Pendulums, 5–60 (URL `pwn`). */
  pwCount: number;
  /** Oscillations of the slowest pendulum per cycle; pendulum i completes this + i (URL `pwk`). */
  pwBaseOscillations: number;
  /** Seconds per cycle – the row is back in line every cycle (URL `pwt`). */
  pwCycleSeconds: number;
  /** Swing amplitude in degrees (URL `pwa`). */
  pwAmplitude: number;
  /** row | arc | circle | galaxy | sliding | bouncing (URL `pwl`). */
  pwLayout: PendulumLayout;
  /** 0 (circle) or 3–8 sides: the radial layouts map the bobs onto a rotating polygon (URL `pwp`). */
  pwPolygon: number;
  /** Arithmetic series of swing times (Reich-style phasing) instead of the classic tuning (URL `pwph`). */
  pwPhasing: boolean;
  /** Length of the fading trails, 0–1 (URL `pwtr`). */
  pwTrails: number;
  /** Where a bob plays: center | extremes | both (URL `pws`). */
  pwSoundOn: PendulumSoundOn;
  /** up: the slowest pendulum plays the lowest note; down: the highest (URL `pwpd`). */
  pwPitchDirection: PendulumPitchDirection;
  /** Bobs aligned within 20 ms play as one chord (URL `pwch`). */
  pwWaveChord: boolean;
  /** Full cycles after which the run finishes, 0 = never (URL `pwc`). */
  pwCycles: number;
  // --- jdm-polyrhythm --- Metronomes & Polyrhythms (lib/physics/modes/polyrhythm.ts): voices ticking at their own tempos
  /** Voices of the harmonic / arithmetic series, 2–400 (URL `prn`). */
  prCount: number;
  /** rings | arcs | metronomes | spiral (URL `prl`). */
  prLayout: PolyLayout;
  /** Arcs layout: chords of a circle or concentric semicircles (URL `pras`). */
  prArcStyle: PolyArcStyle;
  /** harmonic (ratios 1…N) | arithmetic (base BPM + i × step) | custom (a ratio list) (URL `prt`). */
  prTempos: PolyTempos;
  /** Custom ratios, e.g. "3,4,5,7" (URL `prcu`). */
  prCustom: string;
  /** Seconds per cycle of the harmonic / custom series (URL `prcs`). */
  prCycleSeconds: number;
  /** Arithmetic series: tempo of the first voice and the step between voices, in BPM (URL `prb`, `prbs`). */
  prBaseBpm: number;
  prBpmStep: number;
  /** Rings drawn as rotating polygons with as many vertices as their ratio (URL `prp`). */
  prPolygon: boolean;
  /** Accent every k-th tick of a voice, 0 = off (URL `pra`). */
  prAccentEvery: number;
  /** A voice's note from its index (scale degree) or its tempo ratio (harmonic) (URL `prpb`). */
  prPitchBy: PolyPitchBy;
  /** Ratio / BPM numbers on the dots (URL `prnum`). */
  prNumbers: boolean;
  /** Cycles after which the run finishes, back in phase; 0 = never (URL `prc`). */
  prCycles: number;
  // --- end jdm-polyrhythm ---
  // --- jdm-collisions --- Collision Playground (lib/physics/modes/collide.ts): hundreds of colliding orbs
  /** Orbs in play, 10–2000 (URL `cpn`). */
  cpCount: number;
  /** 0–1: spread of the orb sizes (URL `cpsz`); bigger orbs play lower notes. */
  cpSizeSpread: number;
  /** circle | box (URL `cpc`). */
  cpContainer: CollideContainer;
  /** 0–1: how much of the gravity setting pulls the orbs (URL `cpg`). */
  cpGravity: number;
  /** Restitution of every collision, 0.7–1 (URL `cpe`). */
  cpRestitution: number;
  /** Squash-and-stretch on impact (URL `cpsq`). */
  cpSquishy: boolean;
  /** All orbs start on a grid at the same instant and bounce in sync (URL `cpsy`). */
  cpSyncStart: boolean;
  /** Seconds after which collisions switch off (anti-collision), 0 = never (URL `cpac`). */
  cpAntiCollisionAt: number;
  /** Lollipops on a ring: bodies constrained to a circular track (URL `cpr`). */
  cpRing: boolean;
  // --- gerald-glass --- Glass Smash (lib/physics/modes/glass.ts): stages of glass panes between the ball and HOME
  /** Panes in the first stage, 3–30; later stages add more (URL `glr`). */
  glassRows: number;
  /** Hits a pane of the first stage takes, 1–5; later stages get thicker (URL `glhp`). */
  glassHp: number;
  /** Stages from the top to HOME, 1–10 (URL `gls`). */
  glassStages: number;
  /** From the third stage on some panes slide left and right (URL `glm`). */
  glassMoving: boolean;
  /** From the second stage on some panes have a hole the ball must miss (URL `glh`). */
  glassHoles: boolean;
  /** --- gerald-multipliers --- A row of multiplier gates (x2 DMG, x1.5 SPEED, x1.25 SIZE) above every stage's glass (URL `glg`). */
  glassGates: boolean;
  // --- end gerald-glass ---
  // Picture Paint (lib/physics/picturePaint.ts): reveal an uploaded picture in Paint mode, on the beat of a song
  /** Brush dab radius as a multiple of the ball radius, 0.5–3 (URL `pbr`). */
  paintBrush: number;
  /** Opacity of the greyscale ghost of the unrevealed picture, 0–0.4 (URL `pgh`). */
  paintGhost: number;
  /** The ball speeds up on every beat and glides in between (URL `pbeat`). */
  paintBeatSync: boolean;
  /** Beat from the loaded song's detected grid or from the manual `bpm` setting (URL `pbs`). */
  paintBeatSource: PaintBeatSource;
  /** How hard a beat kicks the ball, 0–1 (URL `pbp`). */
  paintBeatPulse: number;
  /** Rebounds steer toward the least-revealed region (URL `pgd`). */
  paintGuided: boolean;
  /** The brush is re-paced every second to finish with the song or the clip (URL `pps`). */
  paintPaceToSong: boolean;
  // Overlays & recording
  watermarkText: string;
  topText: string;
  bottomText: string;
  textSize: number;
  recordingResolution: string;
  recordingDuration: number;
  wallBreakSound: string | null;
  // Hit sound: synthesised tones or an audio clip on every wall bounce
  hitSoundMode: HitSoundMode;
  /** Built-in sample id, or "custom" for the clip uploaded in this session. */
  hitSampleId: string;
  hitSamplePitchByWall: boolean;
  hitSampleVolume: number;
  // Song slicer: every bounce plays the next slice of an uploaded song
  sliceSong: boolean;
  sliceMs: number;
  sliceLoop: boolean;
  sliceFadeMs: number;
  // Background music bed under the bounce sounds (the track itself stays in memory; see lib/audio/musicBed.ts)
  musicVolume: number;
  /** 0–1: how far the bed dips on every bounce / wall-break sound. */
  musicDucking: number;
  /** Milliseconds the bed takes to swell back after a duck. */
  musicDuckRelease: number;
  musicLoop: boolean;
  /** Seconds into the track at which the bed starts (and restarts). */
  musicStartOffset: number;
  // Music: instrument voices, scale snapping and beat lock (see lib/audio/instruments.ts, scales.ts)
  /** Voice of the wall tones. */
  instrument: InstrumentId;
  /** Voice of the melody notes (a loaded song); sine is the classic melody sound. */
  melodyInstrument: InstrumentId;
  scale: ScaleId;
  /** Root of the scale as semitones above C (0 = C … 11 = B). */
  rootNote: number;
  quantizeToBeat: boolean;
  bpm: number;
  quantizeGrid: QuantizeGrid;
  // --- gerald-faces --- Ball characters (lib/character): a face, a name label and squash-and-stretch – all render-only
  /** none | dot | cute | cool | cat | angry (URL `face`). */
  ballFace: FaceStyle;
  /** Draw the face over a custom ball image or emoji too (URL `fimg`). */
  faceOverImage: boolean;
  /** Name shown under the ball, e.g. "Gerald" (URL `bn`). */
  ballName: string;
  /** Show the name label (URL `nl`). */
  nameLabel: boolean;
  /** 0–1: squash on impact and stretch back (URL `sq`). */
  ballSquash: number;
  /** Cat face: a meow-like chirp on ouch / surprise / escape while no hit sample is used (URL `fsnd`). */
  faceSounds: boolean;
  // --- end gerald-faces ---
  // --- teams --- Team balls with a scoreboard (lib/teams.ts, physics/ballStats.ts)
  /** Balls the multi-ball modes start with, 1–6 (URL `nb`; `two=1` still means two); `twoBalls` follows it. */
  ballCount: number;
  /** The roster: team i is the ball that starts in slot i; empty = no teams (URL `teams`). */
  teams: TeamEntry[];
  /** Team name next to each team's ball (URL `tn`). */
  showBallNames: boolean;
  /** Per-team bounces, walls broken and escapes on the canvas (URL `tsb`). */
  showScoreboard: boolean;
  /** top-left | top-right (URL `tsp`). */
  scoreboardPosition: ScoreboardPosition;
  // --- end teams ---
  // --- camera --- Cinematic camera (lib/simulation/camera.ts): rendering and time scale only, all off by default
  /** 0–1: the view zooms toward the ball and follows it; 0 = the classic camera follow (URL `cz`). */
  cameraZoom: number;
  /** 0–1: the view shakes on every wall break, decaying over 300 ms (URL `shake`). */
  screenShake: number;
  /** The simulation clock slows down for a moment on a near miss (URL `slow`). */
  slowMoOnNearMiss: boolean;
  /** Slow-motion speed, 0.2–0.8 of real time (URL `slowf`). */
  slowMoFactor: number;
  /** Slow-motion window in ms of real time, 200–1500 (URL `slowms`). */
  slowMoMs: number;
  /** When a ball escapes the outer wall, its last 2 s replay at half speed before the end screen (URL `replay`). */
  replayOnEscape: boolean;
  // --- end camera ---
  // --- gerald-multipliers --- stat multipliers (lib/physics/multipliers.ts) and the multipliers board (modes/multipliers.ts)
  /** No cap on any stat multiplier (URL `mpu`). */
  mpUnlimited: boolean;
  /** With unlimited off: the highest a stat may stack to, 0 = unlimited (URL `mpc`). */
  mpCap: number;
  /** Damage from which a ball smashes the ring walls on contact (URL `wst`). */
  wallSmashThreshold: number;
  /** Floating multiplier orbs in the ring modes (URL `mpk`). */
  multiplierPickups: boolean;
  /** Orbs per 10 seconds, 0–3 (URL `mpr`). */
  pickupRate: number;
  /** The orb kinds that spawn, comma separated: speed, size, damage, balls, bounce, gravity (URL `mpty`). */
  pickupTypes: string;
  /** Seconds an orb floats (URL `mpl`). */
  pickupLifetime: number;
  /** Multipliers board: rows of gates, 4–20 (URL `mprw`). */
  mpRows: number;
  /** Weights of count / speed / size / damage / reverse / release gates, comma-separated numbers ≥ 0, no maximum (URL `mpgm=4,2,1,1,1,1`; the old six digits still read). */
  mpGateMix: string;
  /** Balls released at the top, 1–10 (URL `mpsb`). */
  mpStartBalls: number;
  /** Most balls in play, 50–2000 (URL `mpmb`). */
  mpMaxBalls: number;
  /** Rigging: the finder looks for a run whose final count is within 5 % of this, 0 = off (URL `mptg`). */
  mpTarget: number;
  // --- end gerald-multipliers ---
  // --- obstacle-editor --- pegs, bumpers, blockers and spinners placed in the ring modes (lib/physics/obstacleEditor.ts)
  /** The layout, arena-relative (URL `obs`, e.g. `p:0.2,-0.3,6;b:-0.4,0.1,8`); empty by default. */
  obstacles: EditorObstacle[];
  /** Speed factor a bumper gives a ball on a hard hit, 1–2 (URL `obb`). */
  bumperBoost: number;
  // --- end obstacle-editor ---
  // --- gerald-exit-splat --- moving exits and splat barriers of the ring modes (lib/physics/exitSplat.ts, movingExits.ts, splats.ts)
  /** How the rings' exits move: rotate (with their rings, as always) | jump | flee | shrink (URL `exit`). */
  exitBehavior: ExitBehavior;
  /** Jump: seconds between two jumps; shrink: seconds an exit takes to close, 1–10 (URL `exj`). */
  exitJumpSeconds: number;
  /** Degrees round the ring a ball may come to an exit before it jumps away or runs, 0–90; 0 = never (URL `exs`). */
  exitSense: number;
  /** Flee: the exit's top speed along its ring, 10–360 degrees a second (URL `exf`). */
  exitFleeSpeed: number;
  /** Every wall hit leaves a solid splat of paint – the ball builds its own barrier (URL `splat`). */
  splatBarrier: boolean;
  /** A splat's radius as a multiple of the ball's, 0.5–2 (URL `sps`). */
  splatSize: number;
  /** The most splats at once, 10–300; past it the oldest fade out (URL `spm`). */
  splatMax: number;
  // --- end gerald-exit-splat ---
  // --- captions --- animated captions (lib/captions.ts): overlays drawn on the canvas – render-only, none by default
  /** Countdown, wall counter, progress bar, question and text overlays, each with its timing, animation and style (URL `cap`). */
  captions: Caption[];
  // --- end captions ---
  // --- rigged --- guaranteed outcomes (lib/physics/rigged.ts): the director's hard constraints, off by default
  /** No ball ever leaves the outermost intact wall – the escape modes then never finish (URL `ne`). */
  neverEscape: boolean;
  /** Team slot (0–5) the director makes win in the multi-ball escape modes; −1 = off (URL `fw`). */
  forcedWinner: number;
  // --- end rigged ---
  // --- timeline --- keyframes (lib/simulation/timeline.ts): numeric settings automated over the clip – none by default
  /** `{ time, key, value }` keyframes of the settings the engine takes live; applied to the run only, never written back here (URL `kf`, e.g. `g_0_300_10_1200`). */
  keyframes: Keyframe[];
  // --- end timeline ---
  // --- jdm-double-pendulum --- Double Pendulum Harp & sparring (lib/physics/modes/doublePendulum.ts); URL keys in DP_URL_KEYS
  /** Pendulums sharing the pivot, 1–4 (URL `dpn`; sparring always uses two). */
  dpCount: number;
  /** Rods per pendulum: 2 (double) or 3 (triple) (URL `dpsg`). */
  dpSegments: number;
  /** Relative rod lengths, 0.2–1 (URL `dpl1`, `dpl2`, `dpl3`). */
  dpLength1: number;
  dpLength2: number;
  dpLength3: number;
  /** Bob masses, 0.2–5 (URL `dpm1`, `dpm2`, `dpm3`). */
  dpMass1: number;
  dpMass2: number;
  dpMass3: number;
  /** Gravity as a multiple of 9.81 m/s² on a 1 m rig, 0.2–3 (URL `dpg`). */
  dpGravity: number;
  /** Start angles in degrees from hanging down, −180…180 (URL `dpa1`, `dpa2`, `dpa3`). */
  dpAngle1: number;
  dpAngle2: number;
  dpAngle3: number;
  /** Start from angles drawn from the seed (URL `dprs`). */
  dpRandomStart: boolean;
  /** Fraction of the angular velocity lost per 60 Hz step, 0–0.01 (URL `dpd`). */
  dpDamping: number;
  /** Seconds the rainbow trail of the last bob reaches back, 0–10 (URL `dptr`). */
  dpTrailSeconds: number;
  /** Harp strings, 0–24 (URL `dpst`). */
  dpStrings: number;
  /** vertical | radial (URL `dpsl`). */
  dpStringLayout: DpStringLayout;
  /** Octaves the strings are tuned across, 1–4 (URL `dpo`). */
  dpOctaves: number;
  /** Two pendulums side by side whose bobs collide (URL `dpsp`). */
  dpSpar: boolean;
  /** Keep swinging after the clip length (URL `dpen`). */
  dpEndless: boolean;
  // --- end jdm-double-pendulum ---
  // --- jdm-illusions --- Circle Illusion (lib/physics/modes/illusion.ts) and Wobbly Walls (lib/physics/wobble.ts, render-only)
  /** lines | rings | nested | whitespace (URL `ilt`). */
  ilType: IllusionType;
  /** Lines: balls on diameters, 2–32 (URL `ilb`). */
  ilBalls: number;
  /** Rings: rings with a ball each, 2–16 (URL `ilr`). */
  ilRings: number;
  /** Nested: moving circles inside the arena, 2–5 (URL `ild`). */
  ilDepth: number;
  /** Whitespace: painting balls, 1–12 (URL `ilp`). */
  ilPainters: number;
  /** Whitespace: the hidden picture, "auto" = chosen by the seed (URL `ilpt`). */
  ilPattern: IllusionPatternChoice;
  /** Tempo of every type, 0.25–3 (URL `ils`). */
  ilSpeed: number;
  /** Lines: the diameters; rings: the rails (URL `iltr`). */
  ilTracks: boolean;
  /** Lines: the hidden rolling circle; rings: a line through the balls (URL `ilrv`). */
  ilReveal: boolean;
  /** Lines / rings: cycles after which the run finishes, 0 = never (URL `ilc`). */
  ilCycles: number;
  /** 0–1: circular walls deform with a travelling wave where a ball hits them, in every ring mode and the Circle Illusion (URL `wob`). */
  wallWobble: number;
  // --- end jdm-illusions ---
  // --- odd-string-battle --- String Battle (lib/physics/modes/stringBattle.ts)
  /** Balls in the battle, 2–6 (URL `sbn`). */
  sbBalls: number;
  /** Lives every ball starts with, 1–9 (URL `sbl`). */
  sbLives: number;
  /** Threads a ball drags at most, 3–40 (URL `sbm`). */
  sbMaxStrings: number;
  /** cut | touch | collide (URL `sbr`). */
  sbRule: SbRule;
  /** web | neon (URL `sbst`). */
  sbStyle: SbStyle;
  /** Clip limit in seconds, 0 = until one ball remains (URL `sbd`). */
  sbDuration: number;
  /** 1–3: the finale's top speed (URL `sbf`). */
  sbFinaleSpeed: number;
  /** 0–1: the neon ring's wobble (URL `sbw`). */
  sbWobble: number;
  /** The "FLASHING LIGHTS" warning badge (URL `sbb`). */
  sbBadge: boolean;
  /** The WEB DOMINION HUD (URL `sbh`). */
  sbHud: boolean;
  // --- end odd-string-battle ---
  // --- odd-power-layers --- Power Layers (lib/physics/modes/powerLayers.ts): a ball smashing a stack of rainbow layers
  /** Layers in the stack, 20–800 (URL `pll`). */
  plLayers: number;
  /** How the power advances after every hit: double | fibonacci | primes | plusOne | random (URL `plq`). */
  plSequence: PlSequence;
  /** 0–1: the seeded sideways drift of the ball (URL `pld`). */
  plDrift: number;
  /** 0.5–2: bounce speed, one bounce a second at 1 (URL `plsp`). */
  plSpeed: number;
  /** The corner badge: sound | warning | both | none (URL `plb`). */
  plBadge: PlBadge;
  /** The two rainbow rule pills at the top of the field (URL `plp`). */
  plPills: boolean;
  // --- end odd-power-layers ---
  // --- fast-render --- Fast export (lib/recording/fastRender.ts): frames per second of the offline export, 30 or 60 (URL `xfps`)
  fastExportFps: number;
  // --- end fast-render ---
  // --- jdm-race --- Square Racing Grand Prix (lib/physics/modes/race.ts, lib/physics/raceTrack.ts, lib/raceCup.ts); names, colours and emoji come from the Teams roster
  /** Racers on the grid, 2–16 (URL `rcn`). */
  rcRacers: number;
  /** square | circle (URL `rcs`). */
  rcShape: RaceShape;
  /** Screens per lap, 3–20 (URL `rcl`). */
  rcTrackLength: number;
  /** Laps, 1–5 (URL `rclp`). */
  rcLaps: number;
  /** The obstacle mix: mixed or one featured kind (URL `rcf`). */
  rcFeature: RaceFeature;
  /** leader | pack (URL `rccam`). */
  rcCamera: RaceCamera;
  /** Keep a points table across races (URL `rccup`). */
  rcCup: boolean;
  /** The cup's name, "" = named after the featured obstacle (URL `rcct`). */
  rcCupTitle: string;
  /** Racer the director favours, −1 = fair (URL `rcw`). */
  rcWinner: number;
  /** The live standings (URL `rcst`). */
  rcStandings: boolean;
  /** The mini-map (URL `rcmm`). */
  rcMiniMap: boolean;
  // --- end jdm-race ---
  // --- jdm-arena-games --- Bouncing Square Battle Royale and Capture the Flag (lib/physics/modes/arenaGames.ts, battle.ts, ctf.ts)
  /** Battle: squares in the fight, 2–20 (URL `btn`). */
  btCount: number;
  /** Battle: hit points of every square, 3–20 (URL `bthp`). */
  btHp: number;
  /** Battle: damage multiplier, 0.25–3 (URL `btd`). */
  btDamage: number;
  /** Battle: box | circle (URL `bta`). */
  btArena: BattleArena;
  /** Battle: the safe zone shrinks and pushes the squares together (URL `bts`). */
  btShrink: boolean;
  /** Battle: heal, shield and speed power-ups (URL `btp`). */
  btPowerUps: boolean;
  /** Capture the flag: squares per team, 1–4 (URL `ctfn`). */
  ctfPerTeam: number;
  /** Capture the flag: captures that win, 1–10 (URL `ctfw`). */
  ctfScoreToWin: number;
  /** Both games: 0–1, how far the director turns a wall rebound toward the action (URL `arn`). */
  arenaNudge: number;
  // --- end jdm-arena-games ---
  // --- jdm-rhythm-runner --- Beat Runner (lib/physics/modes/runner.ts) and Paddle Keep-Up (lib/physics/modes/paddle.ts)
  /** Runner: the square jumps by itself at the planned times (URL `rra`; off = Space jumps). */
  runnerAutoJump: boolean;
  /** Runner: obstacles on the course, 4–120 (URL `rrn`). */
  runnerObstacles: number;
  /** Runner: speed in cube lengths per second, 6–16 (URL `rrsp`). */
  runnerSpeed: number;
  /** Runner: jump height in cube lengths, 1.8–4 (URL `rrj`). */
  runnerJump: number;
  /** Runner: 0–1, how often an obstacle takes the earliest beat it fits (URL `rrd`). */
  runnerDensity: number;
  /** Runner: mixed | spikes | blocks | gaps (URL `rrm`). */
  runnerMix: RunnerMix;
  /** Runner: song (the loaded song's beat, the BPM without one) | bpm (URL `rrbs`). */
  runnerBeatSource: RunnerBeatSource;
  /** Paddle: a deterministic controller drives the platform (URL `pda`; off = pointer / arrow keys). */
  pdAuto: boolean;
  /** Paddle: 0–1, how well the controller plays (URL `pdsk`). */
  pdSkill: number;
  /** Paddle: misses allowed before game over, 0–9 (URL `pdm`). */
  pdMisses: number;
  /** Paddle: platform width, 0.12–0.5 of the field (URL `pdw`). */
  pdWidth: number;
  /** Paddle: 0–1, the sideways kick and spin of an off-centre hit (URL `pdsp`). */
  pdSpin: number;
  /** Paddle: 0–0.1, every catch runs faster (URL `pdu`). */
  pdSpeedUp: number;
  // --- end jdm-rhythm-runner ---
  // --- split-screen --- Split-screen races (lib/splitScreen.ts, lib/simulation/multi.ts, components/simulator/splitScreenCanvas.tsx)
  /** Arenas on the canvas: 1 (the single view), 2 or 4 (URL `ac`). */
  arenaCount: ArenaCount;
  /** row: side by side; grid: 2 × 2, or two stacked (URL `al`). */
  arenaLayout: ArenaLayout;
  /** Per-arena overrides – label, seed, gravity, ball speed, ball colour, mode (URL `ar`, compact). */
  arenas: ArenaOverride[];
  /** Whose bounces are heard: the first arena's or every arena's (URL `sa`). */
  soundArena: SoundArena;
  // --- end split-screen ---
  // --- gerald-vortex --- Sound Vortex (lib/physics/modes/vortex.ts): balls spiral down a funnel of sound rings into a hole
  /** Balls that go down the vortex, 1–30 (URL `vxn`). */
  vxBalls: number;
  /** Seconds between two balls entering, 0–3 (URL `vxs`). */
  vxStagger: number;
  /** Sound rings, 6–24: a note each (URL `vxr`). */
  vxRings: number;
  /** Seconds from the rim to the hole, 3–30 (URL `vxd`). */
  vxDuration: number;
  /** 0.2–3: the central pull – how fast the balls whirl (URL `vxg`). */
  vxGravity: number;
  /** Swallowed balls come back at the rim: the vortex never ends (URL `vxl`). */
  vxLoop: boolean;
  /** 0–1: the depth cue – balls shrink toward the centre (URL `vxds`). */
  vxDepthScale: number;
  // --- end gerald-vortex ---
  // --- gerald-journey --- Journey (lib/physics/modes/journey.ts, lib/physics/journey/): a column of stages the ball clears on its way HOME
  /** The stage list top-down, e.g. "rings,pegs-l,glass-s,multipliers,home" (sizes "-s" / "-l"; HOME always last) (URL `js`). */
  journeyStages: string;
  /** 0: play the list; 1–12: a seeded random journey of that many stages before HOME (URL `jsa`). */
  journeyAutoStages: number;
  // --- end gerald-journey ---
  // --- gerald-bullseye --- Bullseye (lib/physics/modes/bullseye.ts): shots through a peg field onto a scoring target
  /** Balls launched at the target, 1–30 (URL `bys`). */
  byShots: number;
  /** Seconds between two launches, 0.3–4 (URL `byi`). */
  byInterval: number;
  /** 0–1: how many pegs and bumpers stand in the way (URL `byc`). */
  byChaos: number;
  /** Scoring rings of the target, 3–10 (URL `byr`). */
  byRings: number;
  /** The target slides left and right (URL `bym`). */
  byTargetMoving: boolean;
  /** Rigging: the shot (1-based) the director steers into the bull; 0 = off (URL `byp`). */
  byPerfect: number;
  // --- end gerald-bullseye ---
  // --- beat-drop --- Beat Drop (lib/physics/modes/beatDrop.ts): a ball lands on obstructions that fly in on the beat
  /** The obstructions in the mix, a comma list of plank, block, spring, wedge, spinner, drum (URL `bdk`). */
  bdKinds: string;
  /** 0–1: how far the ball drifts sideways between landings (URL `bdd`). */
  bdDrift: number;
  /** endless (the world scrolls down with the ball) | arena (it bounces around inside the view) (URL `bds`). */
  bdScroll: BeatDropScroll;
  /** 0.1–0.5 of the view: how high a flight of one beat rises (URL `bdh`). */
  bdBounceHeight: number;
  /** 0.3–1 beats: how long before its beat an obstruction starts flying in (URL `bda`). */
  bdAnticipation: number;
  /** drums | melody | both: what a landing plays (URL `bdsn`). */
  bdSound: BeatDropSound;
  /** pad (a colour per kind) | rainbow (by beat) | team (the roster's colours) (URL `bdc`). */
  bdColorMode: BeatDropColorMode;
  /** The ball's motion trail (URL `bdt`). */
  bdTrail: boolean;
  // --- end beat-drop ---
  // --- video-beats --- Beats from a video (lib/simulation/beatSource.ts, videoBeatsSettings.ts, physics/onBeat.ts)
  /** The grid every rhythm feature follows: bpm | song | media | manual (URL `bsrc`). */
  beatSource: BeatSourceKind;
  /** Hand-placed beat markers, delta-encoded ms (URL `bm`). */
  beatMarkers: string;
  /** Downbeat among the markers, 0–3, −1 = the loudest (URL `bdb`). */
  beatDownbeat: number;
  /** The ring modes land their wall hits on the grid (URL `onbeat`). */
  onBeat: boolean;
  /** How far On beat may retime a flight, 0.1–0.8 (URL `obr`). */
  onBeatRange: number;
  /** The imported video behind the arena (URL `vbg`) and its opacity (URL `vbgo`). */
  videoBackground: boolean;
  videoBgOpacity: number;
  // --- end video-beats ---
  // --- odd-territory --- Territory (lib/physics/modes/territory.ts): pong-wars teams painting a tile map
  /** Tile columns, 12–48 on the slider (any number from 12 typed; a run builds at most 1,000); the rows follow the field's aspect (URL `tyc`). */
  tyCols: number;
  /** Teams: 2 (top / bottom) or 4 (quadrants; any count from 3 plays them) (URL `tyt`). */
  tyTeams: number;
  /** Balls per team, 1–8 on the slider (any number from 1 typed; a run builds at most 500) (URL `tyb`). */
  tyBallsPerTeam: number;
  /** The four team slots' powers, comma-separated: none | vortex | bomber | painter | ghost (URL `typ`). */
  tyPowers: string;
  /** Seconds between two triggers of a timed power, 1–10 on the slider, any number from 1 typed (URL `tye`). */
  tyPowerEvery: number;
  /** Reach of the whirl and the blast in tiles, 1–8 on the slider, any number from 1 typed (URL `tyr`). */
  tyRadius: number;
  /** The countdown in seconds, 10–120 on the slider, any number from 10 typed (URL `tyd`). */
  tyDuration: number;
  /** The dotted grid whose dots deflect the balls (URL `typg`). */
  tyPegs: boolean;
  /** The "FLASHING LIGHTS" warning badge (URL `tybg`). */
  tyBadge: boolean;
  /** The HUD: percentages, the bar, PICK A SIDE, the countdown (URL `tyh`). */
  tyHud: boolean;
  // --- end odd-territory ---
  // --- bounce-math --- Bounce math (lib/simulation/bounceMath.ts, lib/physics/bounceMathRuntime.ts)
  /** The rules, applied in list order (URL `bmr`: param.trigger.every.op.amount[.min][.max][.scope] joined by ";"). */
  bounceMath: BounceRule[];
  /** "Show values": the bounce-math HUD badge on the canvas while rules are in play (URL `bmh`). */
  bounceMathHud: boolean;
  // --- end bounce-math ---
  // --- unlimited --- No limits (lib/unlimited.ts, lib/physics/limits.ts): every numeric setting past its slider range, extreme
  // runs that melt but never crash; off by default (URL `inf`)
  unlimited: boolean;
  // --- end unlimited ---
  // --- uncap-all --- the uncapped Bouncier: every bounce adds (Bounciness − 1) × the Ball Speed to the rebound, with no
  // ceiling (1 = off, 1.03 = the old switch; URL `bnc`, the old boolean `bounce` still works); `bouncierEnabled` follows it
  bounciness: number;
  // --- end uncap-all ---
  // --- odd-maze --- Maze escape (lib/physics/modes/maze.ts, lib/physics/mazeGrid.ts): balls race through a seeded maze
  /** Columns of the maze, 6–40 on the slider (any number from 6 typed; a run builds at most 200); the rows follow the portrait field (URL `mzc`). */
  mzCols: number;
  /** Balls in the maze, 1–8 on the slider (any number from 1 typed; a run builds at most 32) (URL `mzn`). */
  mzBalls: number;
  /** bounce | wallFollow | explorer (URL `mzb`). */
  mzBrain: MazeBrain;
  /** The wall follower's hand: left | right | alternate (URL `mzh`). */
  mzHand: MazeHand;
  /** The downward pull, 0–1 on the slider, any number from 0 typed (URL `mzg`). */
  mzGravity: number;
  /** How fast the balls travel, 0.25–3 on the slider, any number from 0.25 typed (URL `mzs`). */
  mzSpeed: number;
  /** Opacity of the painted trail, 0–1 (past 1 draws fully opaque) (URL `mzt`). */
  mzTrail: number;
  /** The trail's colour, blood red by default (URL `mztc`). */
  mzTrailColor: string;
  /** Every ball paints in its own colour (URL `mzto`). */
  mzTrailOwn: boolean;
  /** Fog over the cells no ball has visited yet, 0–1 (past 1 draws fully opaque) (URL `mzf`). */
  mzFog: number;
  /** The glowing walls' colour (URL `mzwc`). */
  mzWallColor: string;
  /** Seconds the run lasts at most, 10–180 on the slider, any number from 10 typed (URL `mzd`). */
  mzDuration: number;
  /** The "FLASHING LIGHTS" warning badge (URL `mzbg`). */
  mzBadge: boolean;
  /** The distance-to-exit HUD (URL `mzhud`). */
  mzHud: boolean;
  // --- end odd-maze ---
  // --- gerald-conveyor --- Conveyor Belt (lib/physics/modes/conveyor.ts) and the respawn timer of Classic and Multiply (lib/physics/respawn.ts)
  /** Seconds between two balls on the belt, 0.5–10 on the slider, any number from 0.5 typed (URL `cvi`). */
  cvInterval: number;
  /** Balls the belt loads, 1–200 on the slider (any number from 1 typed; a run builds at most 2,000) (URL `cvn`). */
  cvMaxBalls: number;
  /** What the balls drop into: rings | bowl | pegs (URL `cva`). */
  cvArena: ConveyorArena;
  /** A ball that lands freezes in place and becomes an obstacle (URL `cvf`). */
  cvFreeze: boolean;
  /** 0–1: how much the balls' sizes and colours vary (URL `cvv`). */
  cvVariety: number;
  /** Classic and Multiply: a new ball drops in every this many seconds, 0 = off (URL `rse`; `rs` is the Rotation Speed's). */
  respawnEvery: number;
  // --- end gerald-conveyor ---
  // --- land-claim --- Land Claim (lib/physics/modes/landClaim.ts): competitors' balls knock the top blocks off the columns lining the arena
  /** Columns round the wall, 4–96 on the slider (any number from 4 typed; a run builds at most 5,000) (URL `lcc`). */
  lcCols: number;
  /** Blocks a column holds, 1–40 on the slider (any number from 1 typed; at most 2,000, a million blocks in all) (URL `lcr`). */
  lcRows: number;
  /** square | hexagon | circle (URL `lca`). */
  lcArena: LcArena;
  /** Competitors, 2–12 on the slider (any number from 2 typed; at most 1,000) (URL `lct`). */
  lcTeams: number;
  /** Balls every competitor starts with, 1–10 on the slider (any number from 1 typed; 2,000 balls in all) (URL `lcb`). */
  lcBalls: number;
  /** knock (the block flies off) | claim (it stays, recoloured) | steal (claimed blocks flip to the hitter) (URL `lcm`). */
  lcRule: LcRule;
  /** Every this many blocks a competitor knocks / claims add one more ball of its colour, 0 = never (URL `lce`). */
  lcEvery: number;
  /** Seconds the run lasts at most (a steal battle always), 10–180 on the slider, any number from 10 typed (URL `lcd`). */
  lcDuration: number;
  /** The HUD's title line, "" = the translated LAND CLAIM (URL `lcti`). */
  lcTitle: string;
  /** The HUD: the title, a bar per competitor and the counters (URL `lch`). */
  lcHud: boolean;
  // --- end land-claim ---
}

export const RESOLUTIONS = ["500x500", "1280x720", "1920x1080", "1080x1920"] as const;

export function defaultGapSize(mode: ModeId) {
  return mode === "classic" ? 0.4 : 0.3;
}

export function defaultSettings(mode: ModeId = "classic"): SimulatorSettings {
  return {
    mode,
    gravity: 300,
    bounce: 1,
    ballSpeed: 400,
    ballColor: "#FFFFFF",
    ballRadius: 8,
    rainbowBall: false,
    twoBalls: false,
    ballColor2: "#FF3366",
    bouncierEnabled: false,
    ...DEFAULT_PHYSICS_EXTRAS,
    ...DEFAULT_BALL_INTERACTION,
    wallCount: mode === "shatter" ? 10 : 7,
    wallThickness: 2,
    gapSize: defaultGapSize(mode),
    rotationEnabled: true,
    rotationSpeed: 1,
    circleColor: "#06b6d4",
    rainbowWalls: true,
    rainbowWallMode: "gradient",
    showTrails: mode !== "lines",
    trailThickness: 0.8,
    showGlow: false,
    showWallGlow: !["portal", "shatter", "colorMatch"].includes(mode),
    colorTrail: true,
    reactiveBackground: false,
    cameraFollow: false,
    wallBreakStyle: "confetti",
    cinematicEnabled: true,
    ...defaultThemeSettings(), // --- themes
    accumulationTime: 4,
    spikesEnabled: false,
    spikeCount: 6,
    multiplySpawnCount: 3,
    lineColor: "#ffffff",
    rainbowLines: false,
    linesCenterDot: false,
    targetCount: 10,
    countdownRandom: false,
    colorMatchColorCount: 7,
    growRate: 5,
    growCenterDot: false,
    growLines: false,
    ...dropSettingFields(DEFAULT_DROP_SETTINGS),
    ...boxSettingFields(DEFAULT_BOX_SETTINGS),
    ...pendulumSettingFields(DEFAULT_PENDULUM_SETTINGS),
    ...polyrhythmSettingFields(DEFAULT_POLYRHYTHM_SETTINGS), // --- jdm-polyrhythm ---
    // --- jdm-collisions ---
    ...collideSettingFields(DEFAULT_COLLIDE_SETTINGS),
    // --- gerald-glass ---
    ...glassSettingFields(DEFAULT_GLASS_SETTINGS),
    ...DEFAULT_PICTURE_PAINT,
    watermarkText: "", // --- review fix (site-static) --- no mark burned into the clips unless the user adds one (the TikTok page's promise)
    topText: "",
    bottomText: "",
    textSize: 1,
    recordingResolution: "1080x1920",
    recordingDuration: 30,
    wallBreakSound: null,
    hitSoundMode: "tones",
    hitSampleId: DEFAULT_HIT_SAMPLE_ID,
    hitSamplePitchByWall: true,
    hitSampleVolume: 0.8,
    sliceSong: false,
    sliceMs: 250,
    sliceLoop: true,
    sliceFadeMs: 8,
    musicVolume: 0.5,
    musicDucking: 0.6,
    musicDuckRelease: 250,
    musicLoop: true,
    musicStartOffset: 0,
    instrument: "triangle",
    melodyInstrument: "sine",
    scale: "chromatic",
    rootNote: 0,
    quantizeToBeat: false,
    bpm: 120,
    quantizeGrid: "1/8",
    ...DEFAULT_CHARACTER, // --- gerald-faces ---
    ...defaultTeamSettings(), // --- teams ---
    ...DEFAULT_CAMERA_SETTINGS, // --- camera ---
    // --- gerald-multipliers ---
    ...DEFAULT_MULTIPLIER_CONFIG,
    ...multipliersSettingFields(DEFAULT_MULTIPLIERS_SETTINGS),
    ...defaultObstacleSettings(), // --- obstacle-editor ---
    ...defaultExitSplatFields(), // --- gerald-exit-splat --- (exits turn with their rings, no splats)
    ...defaultCaptionSettings(), // --- captions ---
    ...DEFAULT_RIGGED, // --- rigged ---
    ...defaultTimelineSettings(), // --- timeline ---
    ...doublePendulumSettingFields(DEFAULT_DOUBLE_PENDULUM_SETTINGS), // --- jdm-double-pendulum ---
    ...defaultIllusionFields(), // --- jdm-illusions ---
    ...defaultStringBattleFields(), // --- odd-string-battle ---
    // --- odd-power-layers --- the feature's fields, and the mode's own ball size (radius 10) in Power Layers only
    ...defaultPowerLayersFields(),
    ...powerLayersModeDefaults(mode),
    ...DEFAULT_FAST_EXPORT_SETTINGS, // --- fast-render ---
    ...defaultRaceFields(), // --- jdm-race ---
    ...defaultArenaGameFields(), // --- jdm-arena-games ---
    ...defaultJdmRhythmFields(), // --- jdm-rhythm-runner ---
    ...defaultSplitScreenFields(), // --- split-screen ---
    ...defaultVortexFields(), // --- gerald-vortex ---
    ...defaultJourneyFields(), // --- gerald-journey ---
    ...defaultBullseyeFields(), // --- gerald-bullseye ---
    // --- beat-drop --- the feature's fields, and the mode's own ball size (radius 14) in Beat Drop only
    ...defaultBeatDropFields(),
    ...beatDropModeDefaults(mode),
    ...defaultVideoBeatsFields(), // --- video-beats ---
    // --- odd-territory --- the feature's fields, and a clip that covers the default countdown and its verdict in Territory only
    ...defaultTerritoryFields(),
    ...territoryModeDefaults(mode),
    ...defaultBounceMathFields(), // --- bounce-math --- (no rules; Show values on)
    unlimited: false, // --- unlimited ---
    bounciness: BOUNCINESS_OFF, // --- uncap-all ---
    ...defaultMazeFields(), // --- odd-maze ---
    ...defaultConveyorFields(), // --- gerald-conveyor --- (and the respawn timer, off)
    // --- land-claim --- the feature's fields, and in Land Claim only no gravity and a clip that covers the longest run and its verdict
    ...defaultLandClaimFields(),
    ...landClaimModeDefaults(mode),
  };
}

/** Slider ranges shared by the controls panel and URL validation. */
export const RANGES = {
  ballSpeed: { min: 50, max: 800, step: 10 },
  ballRadius: { min: 4, max: 30, step: 1 },
  gravity: { min: 0, max: 2000, step: 50 },
  wallCount: { min: 1, max: 20, step: 1 },
  wallThickness: { min: 1, max: 10, step: 1 },
  gapSize: { min: 0.1, max: 1.0, step: 0.05 },
  rotationSpeed: { min: 0.1, max: 5, step: 0.1 },
  trailThickness: { min: 0.2, max: 3.0, step: 0.1 },
  recordingDuration: { min: 10, max: 120, step: 1 },
  textSize: { min: 0.5, max: 3, step: 0.1 },
  accumulationTime: { min: 1, max: 15, step: 1 },
  spikeCount: { min: 1, max: 20, step: 1 },
  multiplySpawnCount: { min: 2, max: 10, step: 1 },
  targetCount: { min: 5, max: 25, step: 1 },
  colorMatchColorCount: { min: 2, max: 7, step: 1 },
  growRate: { min: 3, max: 10, step: 1 },
  findDuration: { min: 30, max: 120, step: 1 },
  hitSampleVolume: { min: 0, max: 1, step: 0.05 },
  sliceMs: { min: 80, max: 1000, step: 10 },
  sliceFadeMs: { min: 0, max: 50, step: 1 },
  musicVolume: { min: 0, max: 1, step: 0.05 },
  musicDucking: { min: 0, max: 1, step: 0.05 },
  musicDuckRelease: { min: 50, max: 1000, step: 10 },
  musicStartOffset: { min: 0, max: 600, step: 0.5 },
  rootNote: { min: ROOT_NOTE_MIN, max: ROOT_NOTE_MAX, step: 1 },
  bpm: { min: BPM_MIN, max: BPM_MAX, step: 1 },
  ...PHYSICS_EXTRA_RANGES,
  ...BALL_INTERACTION_RANGES,
  ...DROP_RANGES,
  ...BOX_RANGES,
  ...PENDULUM_RANGES,
  ...POLYRHYTHM_RANGES, // --- jdm-polyrhythm ---
  ...PICTURE_PAINT_RANGES,
  ...CHARACTER_RANGES, // --- gerald-faces ---
  ...THEME_RANGES, // --- themes
  // --- jdm-collisions ---
  ...COLLIDE_RANGES,
  ...TEAM_RANGES, // --- teams ---
  ...CAMERA_RANGES, // --- camera ---
  // --- gerald-glass ---
  ...GLASS_RANGES,
  // --- gerald-multipliers ---
  ...MULTIPLIER_RANGES,
  ...MULTIPLIERS_RANGES,
  ...OBSTACLE_EDITOR_RANGES, // --- obstacle-editor ---
  ...EXIT_SPLAT_RANGES, // --- gerald-exit-splat ---
  ...CAPTION_RANGES, // --- captions ---
  ...RIGGED_RANGES, // --- rigged ---
  ...TIMELINE_RANGES, // --- timeline ---
  ...DOUBLE_PENDULUM_RANGES, // --- jdm-double-pendulum ---
  // --- jdm-illusions ---
  ...ILLUSION_RANGES,
  ...WOBBLE_RANGES,
  ...STRING_BATTLE_RANGES, // --- odd-string-battle ---
  ...POWER_LAYERS_RANGES, // --- odd-power-layers ---
  ...FAST_EXPORT_RANGES, // --- fast-render ---
  ...RACE_RANGES, // --- jdm-race ---
  ...ARENA_GAME_RANGES, // --- jdm-arena-games ---
  ...JDM_RHYTHM_RANGES, // --- jdm-rhythm-runner ---
  ...SPLIT_SCREEN_RANGES, // --- split-screen ---
  ...VORTEX_RANGES, // --- gerald-vortex ---
  ...JOURNEY_RANGES, // --- gerald-journey ---
  ...BULLSEYE_RANGES, // --- gerald-bullseye ---
  ...BEAT_DROP_RANGES, // --- beat-drop ---
  ...VIDEO_BEATS_RANGES, // --- video-beats ---
  ...TERRITORY_RANGES, // --- odd-territory ---
  bounciness: BOUNCINESS_RANGE, // --- uncap-all --- (the comfort range; the number field takes any value from 1 up)
  ...BOUNCE_MATH_RANGES, // --- bounce-math --- (slider comfort ranges only: the number inputs take any finite value)
  ...MAZE_RANGES, // --- odd-maze ---
  ...CONVEYOR_RANGES, // --- gerald-conveyor ---
  ...RESPAWN_RANGES, // --- gerald-conveyor --- (the respawn timer of Classic and Multiply)
  ...LAND_CLAIM_RANGES, // --- land-claim ---
} as const;

/* ------------------------------------------------------------------ URL sharing */

type NumericKey = {
  [K in keyof SimulatorSettings]: SimulatorSettings[K] extends number ? K : never;
}[keyof SimulatorSettings];
type BooleanKey = {
  [K in keyof SimulatorSettings]: SimulatorSettings[K] extends boolean ? K : never;
}[keyof SimulatorSettings];
type StringKey = {
  [K in keyof SimulatorSettings]: SimulatorSettings[K] extends string ? K : never;
}[keyof SimulatorSettings];

/** The short link keys of the numeric settings (exported for the link-validation tests: --- review fix (security-robustness) ---). */
export const NUMERIC_URL_KEYS: Readonly<Record<string, NumericKey>> = {
  g: "gravity",
  s: "ballSpeed",
  r: "ballRadius",
  wc: "wallCount",
  wt: "wallThickness",
  gap: "gapSize",
  tt: "trailThickness",
  tc: "targetCount",
  cmc: "colorMatchColorCount",
  gr: "growRate",
  rs: "rotationSpeed",
  at: "accumulationTime",
  sc: "spikeCount",
  msc: "multiplySpawnCount",
  ts: "textSize",
  hsv: "hitSampleVolume",
  slms: "sliceMs",
  slfade: "sliceFadeMs",
  mv: "musicVolume",
  md: "musicDucking",
  mdr: "musicDuckRelease",
  mso: "musicStartOffset",
  root: "rootNote",
  bpm: "bpm",
  // Physics extras
  drag: "airDrag",
  wx: "windX",
  wy: "windY",
  spin: "spinStrength",
  wb: "wallBounciness",
  bw: "breathingAmplitude",
  bws: "breathingSpeed",
  rg: "rotatingGravity",
  // Ball interactions
  smr: "splitMinRadius",
  mb: "maxBalls",
  // Ball Drop
  dbc: "dropBallCount",
  dsv: "dropSizeVariation",
  dgv: "dropGravityVariation",
  drows: "dropRows",
  dsi: "dropSpawnInterval",
  // Bouncing Shapes
  bxn: "boxShapeCount",
  bxa: "boxAspect",
  bxg: "boxGravity",
  bxc: "boxCountdown",
  bxgr: "boxGrowPerHit",
  // Pendulum Wave
  pwn: "pwCount",
  pwk: "pwBaseOscillations",
  pwt: "pwCycleSeconds",
  pwa: "pwAmplitude",
  pwp: "pwPolygon",
  pwtr: "pwTrails",
  pwc: "pwCycles",
  // --- jdm-polyrhythm --- Metronomes & Polyrhythms
  prn: "prCount",
  prcs: "prCycleSeconds",
  prb: "prBaseBpm",
  prbs: "prBpmStep",
  pra: "prAccentEvery",
  prc: "prCycles",
  // Picture Paint
  pbr: "paintBrush",
  pgh: "paintGhost",
  pbp: "paintBeatPulse",
  // --- gerald-faces ---
  sq: "ballSquash",
  // --- jdm-collisions --- Collision Playground
  cpn: "cpCount",
  cpsz: "cpSizeSpread",
  cpg: "cpGravity",
  cpe: "cpRestitution",
  cpac: "cpAntiCollisionAt",
  // --- camera --- Cinematic camera
  cz: "cameraZoom",
  shake: "screenShake",
  slowf: "slowMoFactor",
  slowms: "slowMoMs",
  // --- gerald-glass --- Glass Smash
  glr: "glassRows",
  glhp: "glassHp",
  gls: "glassStages",
  // --- gerald-multipliers ---
  mpc: "mpCap",
  wst: "wallSmashThreshold",
  mpr: "pickupRate",
  mpl: "pickupLifetime",
  mprw: "mpRows",
  mpsb: "mpStartBalls",
  mpmb: "mpMaxBalls",
  mptg: "mpTarget",
  fw: "forcedWinner", // --- rigged ---
  xfps: "fastExportFps", // --- fast-render ---
  bnc: "bounciness", // --- uncap-all ---
};

/** Boolean keys: `1` enables, `0` disables. */
const BOOLEAN_URL_KEYS: Record<string, BooleanKey> = {
  trails: "showTrails",
  glow: "showGlow",
  wglow: "showWallGlow",
  rwalls: "rainbowWalls",
  rball: "rainbowBall",
  rlines: "rainbowLines",
  bounce: "bouncierEnabled",
  random: "countdownRandom",
  bg: "reactiveBackground",
  ctrail: "colorTrail",
  two: "twoBalls",
  rot: "rotationEnabled",
  spikes: "spikesEnabled",
  cam: "cameraFollow",
  gdot: "growCenterDot",
  glines: "growLines",
  ldot: "linesCenterDot",
  cine: "cinematicEnabled",
  hspw: "hitSamplePitchByWall",
  slice: "sliceSong",
  sloop: "sliceLoop",
  mloop: "musicLoop",
  qz: "quantizeToBeat",
  dloop: "dropLoop",
  pwph: "pwPhasing",
  pwch: "pwWaveChord",
  prp: "prPolygon", // --- jdm-polyrhythm ---
  prnum: "prNumbers", // --- jdm-polyrhythm ---
  pbeat: "paintBeatSync",
  pgd: "paintGuided",
  pps: "paintPaceToSong",
  // --- gerald-faces ---
  fimg: "faceOverImage",
  nl: "nameLabel",
  fsnd: "faceSounds",
  // --- jdm-collisions --- Collision Playground
  cpsq: "cpSquishy",
  cpsy: "cpSyncStart",
  cpr: "cpRing",
  // --- camera --- Cinematic camera
  slow: "slowMoOnNearMiss",
  replay: "replayOnEscape",
  // --- gerald-glass --- Glass Smash
  glm: "glassMoving",
  glh: "glassHoles",
  glg: "glassGates", // --- gerald-multipliers --- the gate rows
  // --- gerald-multipliers ---
  mpu: "mpUnlimited",
  mpk: "multiplierPickups",
  ne: "neverEscape", // --- rigged ---
  [UNLIMITED_URL_KEY]: "unlimited", // --- unlimited --- `inf=1`
};

const STRING_URL_KEYS: Record<string, StringKey> = {
  cc: "circleColor",
  bc: "ballColor",
  bc2: "ballColor2",
  lc: "lineColor",
  top: "topText",
  bottom: "bottomText",
  wm: "watermarkText",
  bn: "ballName", // --- gerald-faces ---
};

/** Serialises only the settings that differ from the defaults for the current mode. */
export function settingsToSearchParams(settings: SimulatorSettings): URLSearchParams {
  const params = new URLSearchParams();
  const base = defaultSettings(settings.mode);
  params.set("mode", settings.mode);
  for (const [key, field] of Object.entries(NUMERIC_URL_KEYS)) {
    if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  }
  for (const [key, field] of Object.entries(BOOLEAN_URL_KEYS)) {
    if (settings[field] !== base[field]) params.set(key, settings[field] ? "1" : "0");
  }
  for (const [key, field] of Object.entries(STRING_URL_KEYS)) {
    if (settings[field] !== base[field]) params.set(key, settings[field]);
  }
  if (settings.rainbowWallMode !== base.rainbowWallMode) params.set("rwmode", settings.rainbowWallMode);
  if (settings.wallBreakStyle !== base.wallBreakStyle) params.set("wbreak", settings.wallBreakStyle);
  if (settings.ballInteraction !== base.ballInteraction) params.set("bi", settings.ballInteraction);
  if (settings.paintBeatSource !== base.paintBeatSource) params.set("pbs", settings.paintBeatSource);
  if (settings.boxShape !== base.boxShape) params.set("bxs", settings.boxShape);
  if (settings.boxSpeedRatio !== base.boxSpeedRatio) params.set("bxr", settings.boxSpeedRatio);
  if (settings.pwLayout !== base.pwLayout) params.set("pwl", settings.pwLayout);
  if (settings.pwSoundOn !== base.pwSoundOn) params.set("pws", settings.pwSoundOn);
  if (settings.pwPitchDirection !== base.pwPitchDirection) params.set("pwpd", settings.pwPitchDirection);
  // --- jdm-polyrhythm ---
  if (settings.prLayout !== base.prLayout) params.set("prl", settings.prLayout);
  if (settings.prArcStyle !== base.prArcStyle) params.set("pras", settings.prArcStyle);
  if (settings.prTempos !== base.prTempos) params.set("prt", settings.prTempos);
  if (settings.prCustom !== base.prCustom) params.set("prcu", settings.prCustom);
  if (settings.prPitchBy !== base.prPitchBy) params.set("prpb", settings.prPitchBy);
  // --- jdm-collisions ---
  if (settings.cpContainer !== base.cpContainer) params.set("cpc", settings.cpContainer);
  if (settings.recordingResolution !== base.recordingResolution) params.set("res", settings.recordingResolution);
  if (settings.recordingDuration !== base.recordingDuration) params.set("dur", String(settings.recordingDuration));
  if (settings.hitSoundMode !== base.hitSoundMode) params.set("hsm", settings.hitSoundMode);
  // An uploaded clip cannot travel in a link, so "custom" is left out (the reader falls back to the default sample).
  if (settings.hitSampleId !== base.hitSampleId && settings.hitSampleId !== "custom") params.set("hs", settings.hitSampleId);
  if (settings.instrument !== base.instrument) params.set("inst", settings.instrument);
  if (settings.melodyInstrument !== base.melodyInstrument) params.set("minst", settings.melodyInstrument);
  if (settings.scale !== base.scale) params.set("scale", settings.scale);
  if (settings.quantizeGrid !== base.quantizeGrid) params.set("grid", settings.quantizeGrid);
  if (settings.ballFace !== base.ballFace) params.set("face", settings.ballFace); // --- gerald-faces ---
  writeThemeParams(settings, base, params); // --- themes: theme, bgt, bg1, bg2, bgd, ps, trc
  writeTeamParams(settings, base, params); // --- teams ---: teams, nb, tn, tsb, tsp
  // --- gerald-multipliers --- the two list-like strings (validated on the way back in)
  if (settings.pickupTypes !== base.pickupTypes) params.set("mpty", settings.pickupTypes);
  if (settings.mpGateMix !== base.mpGateMix) params.set("mpgm", settings.mpGateMix);
  writeObstacleParams(settings, base, params); // --- obstacle-editor ---: obs, obb
  writeExitSplatParams(settings, base, params); // --- gerald-exit-splat ---: exit, exj, exs, exf, splat, sps, spm
  writeCaptionParams(settings, params); // --- captions ---: cap
  writeTimelineParams(settings, params); // --- timeline ---: kf
  writeDoublePendulumParams(settings, base, params); // --- jdm-double-pendulum ---: dpn, dpsg, dpl1–3, dpm1–3, dpg, dpa1–3, dprs, dpd, dptr, dpst, dpsl, dpo, dpsp, dpen
  writeIllusionParams(settings, base, params); // --- jdm-illusions ---: ilt, ilb, ilr, ild, ilp, ilpt, ils, iltr, ilrv, ilc, wob
  writeStringBattleParams(settings, base, params); // --- odd-string-battle ---: sbn, sbl, sbm, sbr, sbst, sbd, sbf, sbw, sbb, sbh
  writePowerLayersParams(settings, base, params); // --- odd-power-layers ---: pll, plq, pld, plsp, plb, plp
  writeRaceParams(settings, base, params); // --- jdm-race ---: rcn, rcs, rcl, rclp, rcf, rccam, rccup, rcct, rcw, rcst, rcmm
  writeArenaGameParams(settings, base, params); // --- jdm-arena-games ---: btn, bthp, btd, bta, bts, btp, ctfn, ctfw, arn
  writeJdmRhythmParams(settings, base, params); // --- jdm-rhythm-runner ---: rra, rrn, rrsp, rrj, rrd, rrm, rrbs, pda, pdsk, pdm, pdw, pdsp, pdu
  writeSplitScreenParams(settings, base, params); // --- split-screen ---: ac, al, sa, ar
  writeVortexParams(settings, base, params); // --- gerald-vortex ---: vxn, vxs, vxr, vxd, vxg, vxl, vxds
  writeJourneyParams(settings, base, params); // --- gerald-journey ---: js, jsa
  writeBullseyeParams(settings, base, params); // --- gerald-bullseye ---: bys, byi, byc, byr, bym, byp
  writeBeatDropParams(settings, base, params); // --- beat-drop ---: bdk, bdd, bds, bdh, bda, bdsn, bdc, bdt
  writeVideoBeatsParams(settings, base, params); // --- video-beats ---: bsrc, bm, bdb, onbeat, obr, vbg, vbgo
  writeTerritoryParams(settings, base, params); // --- odd-territory ---: tyc, tyt, tyb, typ, tye, tyr, tyd, typg, tybg, tyh
  writeMazeParams(settings, base, params); // --- odd-maze ---: mzc, mzn, mzb, mzh, mzg, mzs, mzt, mztc, mzto, mzf, mzwc, mzd, mzbg, mzhud
  writeConveyorParams(settings, base, params); // --- gerald-conveyor ---: cvi, cvn, cva, cvf, cvv, rse
  writeLandClaimParams(settings, base, params); // --- land-claim ---: lcc, lcr, lca, lct, lcb, lcm, lce, lcd, lcti, lch
  writeBounceMathParams(settings, params); // --- bounce-math ---: bmr, bmh
  writeUnlimitedValues(settings, params); // --- unlimited --- values past their range under their own keys, the rest in `infx`
  return params;
}

/** Up to three decimals (air drag steps by 0.001), trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

// --- review fix (recording-export) --- the numbers of links, share codes, batch lists, presets and project files
/** The most characters of the Top / Bottom Text and the watermark a link keeps (and so a preset or a project file too). */
const MAX_URL_TEXT = 60;
/**
 * The core numbers of `NUMERIC_URL_KEYS`: no feature's own resolver checks them again (the music bed, the physics extras,
 * the modes' and features' numbers keep their own rules), so `coreNumber()` is their check.
 */
const CORE_NUMERIC_FIELDS: readonly NumericKey[] = ["gravity", "ballSpeed", "ballRadius", "wallCount", "wallThickness", "gapSize", "rotationSpeed", "trailThickness", "accumulationTime", "spikeCount", "multiplySpawnCount", "targetCount", "colorMatchColorCount", "growRate", "textSize", "sliceMs", "sliceFadeMs"];
const CORE_NUMERIC_FIELD_SET: ReadonlySet<string> = new Set(CORE_NUMERIC_FIELDS);

/**
 * A number for `field` from a link or a stored preset: not a finite number → `fallback`; below the field's slider
 * minimum → that minimum (a negative ball size or no rings at all is invalid – the features' own readers lift theirs the
 * same way); never a maximum (--- uncap-all --- the slider's range is a comfort range: a big value is kept as it is, and
 * the page degrades gracefully under it); a whole number for a count (a step of 1 from a whole minimum, as the uncapped
 * values' own parsing rounds them), any other value exactly as typed. A field without a range is taken as it is.
 */
export function coreNumber(field: string, value: number, fallback: number): number {
  const range = (RANGES as unknown as Record<string, { min: number; max: number; step: number } | undefined>)[field];
  if (!Number.isFinite(value)) return fallback;
  if (!range) return value;
  const v = atLeastMin(value, range);
  return isIntegerRange(range) ? Math.round(v) : v;
}
// --- end review fix (recording-export) ---

/**
 * Reads settings from a URL; unknown or invalid values fall back to the defaults, and a number below its slider's minimum
 * is lifted onto it (`coreNumber()`: a link with `r=-5` or `wc=0` cannot crash the page; big values stay big).
 */
export function settingsFromSearchParams(params: URLSearchParams): SimulatorSettings {
  const modeParam = params.get("mode");
  const mode: ModeId = isModeId(modeParam) ? modeParam : "classic";
  const settings = defaultSettings(mode);
  for (const [key, field] of Object.entries(NUMERIC_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    // --- review fix (recording-export) --- a core number through coreNumber(); the others as before (their features check them)
    if (CORE_NUMERIC_FIELD_SET.has(field)) (settings as unknown as Record<string, number>)[field] = coreNumber(field, raw.trim() === "" ? NaN : Number(raw), settings[field]);
    else {
      const value = Number(raw);
      if (Number.isFinite(value)) (settings as unknown as Record<string, number>)[field] = value;
    }
  }
  for (const [key, field] of Object.entries(BOOLEAN_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") (settings as unknown as Record<string, boolean>)[field] = true;
    else if (raw === "0") (settings as unknown as Record<string, boolean>)[field] = false;
  }
  for (const [key, field] of Object.entries(STRING_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) (settings as unknown as Record<string, string>)[field] = raw.slice(0, MAX_URL_TEXT);
  }
  const rw = params.get("rwmode");
  if (rw === "pulse" || rw === "gradient") settings.rainbowWallMode = rw;
  const wb = params.get("wbreak");
  if (wb && (WALL_BREAK_STYLES as readonly string[]).includes(wb)) settings.wallBreakStyle = wb as WallBreakStyle;
  const res = params.get("res");
  if (res && (RESOLUTIONS as readonly string[]).includes(res)) settings.recordingResolution = res;
  const dur = Number(params.get("dur"));
  if (Number.isFinite(dur) && dur >= RANGES.recordingDuration.min) settings.recordingDuration = dur; // --- uncap-all --- (no maximum)
  const hsm = params.get("hsm");
  if (isHitSoundMode(hsm)) settings.hitSoundMode = hsm;
  const hs = params.get("hs");
  if (hs !== null) settings.hitSampleId = normalizeHitSampleId(hs);
  settings.hitSampleVolume = clampRange(settings.hitSampleVolume, RANGES.hitSampleVolume, defaultSettings(mode).hitSampleVolume);
  clampMusicBed(settings, defaultSettings(mode));
  clampPhysicsExtras(settings, defaultSettings(mode));
  const bi = params.get("bi");
  if (isBallInteraction(bi)) settings.ballInteraction = bi;
  clampBallInteraction(settings, defaultSettings(mode));
  clampDropSettings(settings);
  const bxs = params.get("bxs");
  if (isBoxShape(bxs)) settings.boxShape = bxs;
  const bxr = params.get("bxr");
  if (isBoxSpeedRatio(bxr)) settings.boxSpeedRatio = bxr;
  clampBoxSettings(settings);
  const pwl = params.get("pwl");
  if (isPendulumLayout(pwl)) settings.pwLayout = pwl;
  const pws = params.get("pws");
  if (isPendulumSoundOn(pws)) settings.pwSoundOn = pws;
  const pwpd = params.get("pwpd");
  if (isPendulumPitchDirection(pwpd)) settings.pwPitchDirection = pwpd;
  clampPendulumSettings(settings);
  // --- jdm-polyrhythm ---
  const prl = params.get("prl");
  if (isPolyLayout(prl)) settings.prLayout = prl;
  const pras = params.get("pras");
  if (isPolyArcStyle(pras)) settings.prArcStyle = pras;
  const prt = params.get("prt");
  if (isPolyTempos(prt)) settings.prTempos = prt;
  const prcu = params.get("prcu");
  if (prcu !== null) settings.prCustom = sanitizeCustomRatios(prcu);
  const prpb = params.get("prpb");
  if (isPolyPitchBy(prpb)) settings.prPitchBy = prpb;
  clampPolyrhythmSettings(settings);
  // --- jdm-collisions ---
  const cpc = params.get("cpc");
  if (isCollideContainer(cpc)) settings.cpContainer = cpc;
  clampCollideSettings(settings);
  clampGlassSettings(settings); // --- gerald-glass ---
  const pbs = params.get("pbs");
  if (isPaintBeatSource(pbs)) settings.paintBeatSource = pbs;
  clampPicturePaint(settings);
  const inst = params.get("inst");
  if (isInstrumentId(inst)) settings.instrument = inst;
  const minst = params.get("minst");
  if (isInstrumentId(minst)) settings.melodyInstrument = minst;
  const scale = params.get("scale");
  if (isScaleId(scale)) settings.scale = scale;
  const grid = params.get("grid");
  if (isQuantizeGrid(grid)) settings.quantizeGrid = grid;
  if (!inRange(settings.rootNote, RANGES.rootNote) || !Number.isInteger(settings.rootNote)) settings.rootNote = 0;
  if (!inRange(settings.bpm, RANGES.bpm)) settings.bpm = defaultSettings(mode).bpm;
  // --- gerald-faces ---
  const face = params.get("face");
  if (isFaceStyle(face)) settings.ballFace = face;
  clampCharacter(settings);
  readThemeParams(params, settings); // --- themes
  readTeamParams(params, settings); // --- teams --- (after `two`: a roster or `nb` sets the ball count)
  clampCameraSettings(settings); // --- camera ---
  // --- gerald-multipliers ---
  const mpty = params.get("mpty");
  if (mpty !== null) settings.pickupTypes = sanitizePickupTypes(mpty);
  const mpgm = params.get("mpgm");
  if (mpgm !== null) settings.mpGateMix = sanitizeGateMix(mpgm);
  clampMultiplierSettings(settings);
  readObstacleParams(params, settings); // --- obstacle-editor ---
  readExitSplatParams(params, settings); // --- gerald-exit-splat --- (a known behaviour, numbers from their minimum up)
  readCaptionParams(params, settings); // --- captions ---
  Object.assign(settings, resolveRiggedConfig(settings)); // --- rigged --- a bad team slot is off
  readTimelineParams(params, settings, RANGES); // --- timeline ---
  readDoublePendulumParams(params, settings); // --- jdm-double-pendulum --- (clamped to the ranges; bad values fall back)
  readIllusionParams(params, settings); // --- jdm-illusions ---
  readStringBattleParams(params, settings); // --- odd-string-battle ---
  readPowerLayersParams(params, settings); // --- odd-power-layers --- (clamped; unknown options fall back)
  Object.assign(settings, resolveFastExportSettings(settings)); // --- fast-render --- (snapped to 30 or 60)
  readRaceParams(params, settings); // --- jdm-race --- (clamped, known options, a clean cup title)
  readArenaGameParams(params, settings); // --- jdm-arena-games --- (clamped to the ranges; unknown arenas and bad values fall back)
  readJdmRhythmParams(params, settings); // --- jdm-rhythm-runner --- (clamped to the ranges; unknown options fall back)
  readSplitScreenParams(params, settings); // --- split-screen --- (1, 2 or 4 arenas, known layout / sound, clean overrides)
  readVortexParams(params, settings); // --- gerald-vortex --- (clamped onto the sliders; bad values fall back)
  readJourneyParams(params, settings); // --- gerald-journey --- (the stage list normalised, the auto count clamped)
  readBullseyeParams(params, settings); // --- gerald-bullseye --- (clamped onto the sliders; bad values fall back)
  readBeatDropParams(params, settings); // --- beat-drop --- (clamped onto the sliders; unknown kinds and options fall back)
  readVideoBeatsParams(params, settings); // --- video-beats --- (known source, markers re-encoded, clamped numbers)
  readTerritoryParams(params, settings); // --- odd-territory --- (valid numbers kept, no maximum; unknown powers fall back)
  readMazeParams(params, settings); // --- odd-maze --- (valid numbers kept, no maximum; unknown options and bad colours fall back)
  readConveyorParams(params, settings); // --- gerald-conveyor --- (valid numbers kept, no maximum; an unknown arena falls back)
  readLandClaimParams(params, settings); // --- land-claim --- (valid numbers kept, no maximum; unknown arenas and rules fall back)
  readBounceMathParams(params, settings); // --- bounce-math --- (invalid rules dropped)
  readUnlimitedValues(params, settings); // --- unlimited --- (with `inf=1`: big values unclamped, invalid ones back to the default)
  resolveBounciness(settings, params.get("bnc") !== null); // --- uncap-all --- (an old link's `bounce=1` means 1.03)
  return settings;
}

function clampRange(value: number, range: { min: number; max: number }, fallback: number) {
  return Number.isFinite(value) ? atLeastMin(value, range) : fallback; // --- uncap-all --- (the minimum only: never a maximum)
}

function inRange(value: number, range: { min: number; max: number }) {
  return value >= range.min; // --- uncap-all --- (valid from the minimum up: the slider's end is no limit)
}

/** Keeps the music-bed numbers inside their slider ranges (URL parameters and presets alike). */
function clampMusicBed(settings: SimulatorSettings, defaults: SimulatorSettings) {
  settings.musicVolume = clampRange(Number(settings.musicVolume), RANGES.musicVolume, defaults.musicVolume);
  settings.musicDucking = clampRange(Number(settings.musicDucking), RANGES.musicDucking, defaults.musicDucking);
  settings.musicDuckRelease = clampRange(Number(settings.musicDuckRelease), RANGES.musicDuckRelease, defaults.musicDuckRelease);
  settings.musicStartOffset = clampRange(Number(settings.musicStartOffset), RANGES.musicStartOffset, defaults.musicStartOffset);
}

/** Keeps the physics extras inside their slider ranges (URL parameters and presets alike); bad values fall back to "off". */
function clampPhysicsExtras(settings: SimulatorSettings, defaults: SimulatorSettings) {
  for (const key of PHYSICS_EXTRA_KEYS) settings[key] = clampRange(Number(settings[key]), PHYSICS_EXTRA_RANGES[key], defaults[key]);
}

/** Keeps the split limits of the ball interaction inside their slider ranges, as whole numbers (URL parameters and presets alike). */
function clampBallInteraction(settings: SimulatorSettings, defaults: SimulatorSettings) {
  settings.splitMinRadius = Math.round(clampRange(Number(settings.splitMinRadius), RANGES.splitMinRadius, defaults.splitMinRadius));
  settings.maxBalls = Math.round(clampRange(Number(settings.maxBalls), RANGES.maxBalls, defaults.maxBalls));
}

/** Keeps the Ball Drop settings inside their slider ranges, counts as whole numbers (URL parameters and presets alike; bad values fall back to the defaults). */
function clampDropSettings(settings: SimulatorSettings) {
  Object.assign(settings, dropSettingFields(resolveDropSettings(dropSettingsOf(settings))));
}

/** Keeps the Bouncing Shapes settings inside their ranges, counts as whole numbers; an unknown shape or speed ratio falls back to the default (URL parameters and presets alike). */
function clampBoxSettings(settings: SimulatorSettings) {
  Object.assign(settings, boxSettingFields(resolveBoxSettings(boxSettingsOf(settings))));
}

/** Keeps the Pendulum Wave settings inside their ranges, counts as whole numbers; an unknown layout, sound spot or pitch direction falls back to the default (URL parameters and presets alike). */
function clampPendulumSettings(settings: SimulatorSettings) {
  Object.assign(settings, pendulumSettingFields(resolvePendulumSettings(pendulumSettingsOf(settings))));
}

// --- jdm-polyrhythm ---
/** Keeps the Metronomes & Polyrhythms settings inside their ranges, counts as whole numbers, the custom list to its characters; unknown options fall back to the defaults (URL parameters and presets alike). */
function clampPolyrhythmSettings(settings: SimulatorSettings) {
  Object.assign(settings, polyrhythmSettingFields(resolvePolyrhythmSettings(polyrhythmSettingsOf(settings))));
}

// --- jdm-collisions ---
/** Keeps the Collision Playground settings inside their ranges (count and anti-collision time as whole numbers); an unknown container or a non-boolean flag falls back to the default (URL parameters and presets alike). */
function clampCollideSettings(settings: SimulatorSettings) {
  Object.assign(settings, collideSettingFields(resolveCollideSettings(collideSettingsOf(settings))));
}

// --- gerald-glass ---
/** Keeps the Glass Smash settings inside their ranges as whole numbers; a non-boolean flag falls back to the default (URL parameters and presets alike). */
function clampGlassSettings(settings: SimulatorSettings) {
  Object.assign(settings, glassSettingFields(resolveGlassSettings(glassSettingsOf(settings))));
}

/** Keeps the Picture Paint settings inside their ranges; an unknown beat source or a non-boolean flag falls back to the default (URL parameters and presets alike). */
function clampPicturePaint(settings: SimulatorSettings) {
  Object.assign(settings, resolvePicturePaintSettings(picturePaintOf(settings)));
}

// --- gerald-faces ---
/** Validates the character settings: an unknown face or a non-boolean flag falls back, the name is trimmed, the squash clamped (URL parameters and presets alike). */
function clampCharacter(settings: SimulatorSettings) {
  Object.assign(settings, resolveCharacterSettings(characterOf(settings)));
}

// --- camera ---
/** Keeps the cinematic-camera settings inside their ranges; a bad number falls back to its default, a non-boolean flag to "off" (URL parameters and presets alike). */
function clampCameraSettings(settings: SimulatorSettings) {
  Object.assign(settings, resolveCameraSettings(cameraSettingsOf(settings)));
}
// --- end camera ---
// --- gerald-multipliers ---
/** Keeps the multiplier settings (cap, smash threshold, pickups) and the multipliers board inside their ranges; bad values fall back to the defaults (URL parameters and presets alike). */
function clampMultiplierSettings(settings: SimulatorSettings) {
  Object.assign(settings, resolveMultiplierConfig(multiplierConfigOf(settings)));
  Object.assign(settings, multipliersSettingFields(resolveMultipliersSettings(multipliersSettingsOf(settings))));
}

// --- unlimited ---
type UnlimitedRecord = Record<string, unknown>;
/** `RANGES` as the plain record lib/unlimited.ts reads. */
const UNLIMITED_RANGES = RANGES as unknown as Record<string, { min: number; max: number; step: number }>;
/** The unlimited settings (numeric, with a range, not bounded; see lib/unlimited.ts), computed once. */
let unlimitedKeyList: string[] | null = null;
/** Their URL keys (the core map, the ball count's `nb`, and what the feature writers reveal), computed once. */
let unlimitedUrlKeyMap: Map<string, string> | null = null;

/** The settings that go past their slider range with the switch on. */
export function unlimitedSettingKeys(): string[] {
  unlimitedKeyList ??= unlimitedKeysOf(defaultSettings("classic") as unknown as UnlimitedRecord, UNLIMITED_RANGES);
  return unlimitedKeyList;
}

/** --- uncap-all --- True while the URL keys are being discovered: the probe's serialisation must not write the uncapped values (it would discover again). */
let discoveringUrlKeys = false;

function unlimitedUrlKeys(): Map<string, string> {
  if (unlimitedUrlKeyMap) return unlimitedUrlKeyMap;
  const explicit: Record<string, string> = { ballCount: "nb" };
  for (const [param, field] of Object.entries(NUMERIC_URL_KEYS)) explicit[field] = param;
  const base = { ...defaultSettings("classic"), unlimited: false } as unknown as UnlimitedRecord;
  discoveringUrlKeys = true;
  try {
    unlimitedUrlKeyMap = discoverUrlKeys(unlimitedSettingKeys(), explicit, base, (probe) => settingsToSearchParams(probe as unknown as SimulatorSettings));
  } finally {
    discoveringUrlKeys = false;
  }
  return unlimitedUrlKeyMap;
}

/** The URL key of an unlimited setting (`infx` carries the ones without). */
export function unlimitedUrlKeyOf(key: string): string | undefined {
  return unlimitedUrlKeys().get(key);
}

function writeUnlimitedValues(settings: SimulatorSettings, params: URLSearchParams) {
  // --- uncap-all --- whatever the switch (not while the URL keys are being discovered: that serialisation is the probe's)
  if (discoveringUrlKeys) return;
  writeUnlimitedParams(settings as unknown as UnlimitedRecord, params, unlimitedSettingKeys(), UNLIMITED_RANGES, unlimitedUrlKeys());
}

function readUnlimitedValues(params: URLSearchParams, settings: SimulatorSettings) {
  // --- uncap-all --- whatever the switch
  readUnlimitedParams(params, settings as unknown as UnlimitedRecord, defaultSettings(settings.mode) as unknown as UnlimitedRecord, unlimitedSettingKeys(), UNLIMITED_RANGES, unlimitedUrlKeys());
  if (settings.teams.length === 0 && settings.ballCount > RANGES.ballCount.max) settings.twoBalls = true;
}

function restoreUnlimitedPreset(preset: Partial<SimulatorSettings>, merged: SimulatorSettings) {
  restoreUnlimitedValues(preset as unknown as UnlimitedRecord, merged as unknown as UnlimitedRecord, defaultSettings(merged.mode) as unknown as UnlimitedRecord, unlimitedSettingKeys(), UNLIMITED_RANGES);
  if (merged.teams.length === 0 && merged.ballCount > RANGES.ballCount.max) merged.twoBalls = true; // --- uncap-all --- (whatever the switch)
}
// --- end unlimited ---

// --- uncap-all ---
/**
 * The Bounciness and the old Bouncier switch agree: without a Bounciness of its own (an old link or preset) the switch
 * says it – on = 1.03, the step the old Bouncier added per bounce, off = 1 –; an invalid one falls back to off; the
 * switch then follows the number (on above 1), so every reader of `bouncierEnabled` keeps working.
 */
function resolveBounciness(settings: SimulatorSettings, hasOwn: boolean) {
  const own = settings.bounciness;
  const valid = typeof own === "number" && Number.isFinite(own) && own >= BOUNCINESS_RANGE.min;
  settings.bounciness = hasOwn && valid ? own : bouncinessOf({ bouncierEnabled: settings.bouncierEnabled });
  if (hasOwn && !valid) settings.bounciness = BOUNCINESS_OFF;
  settings.bouncierEnabled = settings.bounciness > BOUNCINESS_OFF;
}

/** The settings patch of the Bounciness field (the switch follows it). */
export function bouncinessPatch(value: number): Pick<SimulatorSettings, "bounciness" | "bouncierEnabled"> {
  return { bounciness: value, bouncierEnabled: value > BOUNCINESS_OFF };
}

/** The Bounciness the old switch meant, for callers that still flip it (1.03 on, 1 off). */
export const BOUNCIER_SWITCH_VALUE = BOUNCIER_ON;

/** --- review fix (uncap-all) --- The keys of a `RANGES` group (those starting with one of `prefixes`, when given). */
function rangeKeys(group: object, ...prefixes: string[]): string[] {
  return Object.keys(group).filter((key) => prefixes.length === 0 || prefixes.some((prefix) => key.startsWith(prefix)));
}

/**
 * --- review fix (uncap-all) --- The settings every run's engine reads, whatever the mode: the physics config – the core
 * values, the extras, the ball interaction, the Bounciness – and the split-screen arenas it builds.
 */
const CORE_ENGINE_KEYS: readonly string[] = ["ballSpeed", "ballRadius", "gravity", "wallCount", "gapSize", "rotationSpeed", "ballCount", "bounciness", ...PHYSICS_EXTRA_KEYS, ...rangeKeys(BALL_INTERACTION_RANGES), "arenaCount"];
/** What the ring modes' engines read on top: the obstacle editor (its layout and bumper boost), the multiplier pickups, On beat's flight range. */
const RING_ENGINE_KEYS: readonly string[] = [...rangeKeys(OBSTACLE_EDITOR_RANGES), "obstacles", ...rangeKeys(MULTIPLIER_RANGES), "onBeatRange"];
/** Each mode's own settings its engine reads (a key of another mode, or of the recording, the text, the sound or the picture, never). */
const MODE_ENGINE_KEYS: Readonly<Record<ModeId, readonly string[]>> = {
  classic: ["respawnEvery"], // --- gerald-conveyor --- (the respawn timer)
  accumulation: ["accumulationTime", "spikeCount"],
  multiply: ["multiplySpawnCount", "respawnEvery"], // --- gerald-conveyor --- (the respawn timer)
  lines: [],
  paint: rangeKeys(PICTURE_PAINT_RANGES),
  target: ["targetCount"],
  portal: [],
  shatter: [],
  colorMatch: ["colorMatchColorCount"],
  grow: ["growRate"],
  drop: rangeKeys(DROP_RANGES),
  box: rangeKeys(BOX_RANGES),
  pendulum: rangeKeys(PENDULUM_RANGES),
  polyrhythm: rangeKeys(POLYRHYTHM_RANGES),
  collide: [...rangeKeys(COLLIDE_RANGES), ...rangeKeys(WOBBLE_RANGES)],
  glass: [...rangeKeys(GLASS_RANGES), ...rangeKeys(MULTIPLIER_RANGES)],
  multipliers: [...rangeKeys(MULTIPLIERS_RANGES), ...rangeKeys(MULTIPLIER_RANGES)],
  doublePendulum: rangeKeys(DOUBLE_PENDULUM_RANGES),
  illusion: [...rangeKeys(ILLUSION_RANGES), ...rangeKeys(WOBBLE_RANGES)],
  stringBattle: rangeKeys(STRING_BATTLE_RANGES),
  powerLayers: rangeKeys(POWER_LAYERS_RANGES),
  race: rangeKeys(RACE_RANGES),
  battle: rangeKeys(ARENA_GAME_RANGES, "bt", "arena"),
  ctf: rangeKeys(ARENA_GAME_RANGES, "ctf", "arena"),
  runner: rangeKeys(JDM_RHYTHM_RANGES, "runner"),
  paddle: rangeKeys(JDM_RHYTHM_RANGES, "pd"),
  vortex: rangeKeys(VORTEX_RANGES),
  journey: rangeKeys(JOURNEY_RANGES),
  bullseye: rangeKeys(BULLSEYE_RANGES),
  beatDrop: rangeKeys(BEAT_DROP_RANGES),
  territory: rangeKeys(TERRITORY_RANGES), // --- odd-territory ---
  maze: rangeKeys(MAZE_RANGES), // --- odd-maze ---
  conveyor: rangeKeys(CONVEYOR_RANGES), // --- gerald-conveyor ---
  landClaim: rangeKeys(LAND_CLAIM_RANGES), // --- land-claim ---
};
// --- gerald-exit-splat --- the moving exits' numbers are read by the engines of the ring modes with one exit a ring, the splat
// barrier's by the ring modes that splat (no other mode reads either: a value past its slider there engages nothing)
for (const mode of MOVING_EXIT_MODES) (MODE_ENGINE_KEYS[mode] as string[]).push(...EXIT_ENGINE_KEYS);
for (const mode of SPLAT_MODES) (MODE_ENGINE_KEYS[mode] as string[]).push(...SPLAT_ENGINE_KEYS);

const engineKeyCache = new Map<ModeId, readonly string[]>();

/**
 * --- review fix (uncap-all) --- The settings a run of `mode` hands its engine: the physics config, the ring modes' obstacle
 * editor, pickups and On beat, and the mode's own settings – never the recording (a clip length), the text, the sound or the
 * picture (a camera, a theme). Only these engage the extreme-values machinery and ARENA FULL (`uncappedEngaged()`,
 * `pastAnyMemoryCeiling()`): a 180 s clip, a big caption or a Glass Smash row count in a Classic run changes nothing in it.
 */
export function engineSettingKeys(mode: ModeId): readonly string[] {
  let keys = engineKeyCache.get(mode);
  if (!keys) {
    keys = [...new Set([...CORE_ENGINE_KEYS, ...(supportsObstacles(mode) ? RING_ENGINE_KEYS : []), ...(MODE_ENGINE_KEYS[mode] ?? [])])];
    engineKeyCache.set(mode, keys);
  }
  return keys;
}

/**
 * True when a setting the mode's engine reads (`engineSettingKeys()`) sits past its slider's comfort range (the engine
 * then runs its extreme-values machinery: planned sub-steps, the crowd, time-slicing – `PhysicsConfig.unlimited`).
 * --- review fix (uncap-all) --- A setting the run never reads – the clip length, the text size, a sound, another mode's
 * setting – engages nothing (it burned the ⚡ speed badge into Classic clips).
 */
export function uncappedEngaged(settings: SimulatorSettings): boolean {
  const record = settings as unknown as UnlimitedRecord;
  for (const key of engineSettingKeys(settings.mode)) {
    const range = UNLIMITED_RANGES[key];
    const value = record[key];
    if (range && typeof value === "number" && Number.isFinite(value) && beyondRange(key, value, range)) return true;
  }
  // An obstacle of the editor's layout past its row's sliders (a 1,000 rpm spinner) is a value past its slider too.
  return supportsObstacles(settings.mode) && Array.isArray(settings.obstacles) && settings.obstacles.some(obstacleBeyondSliders);
}

/** The core numeric URL keys (key → setting), for tools and the uncapped round-trip test. */
export function numericUrlKeyFields(): Readonly<Record<string, string>> {
  return NUMERIC_URL_KEYS;
}

/**
 * True when a setting the mode's engine reads (`engineSettingKeys()`) and that sizes an allocation is past its
 * memory-safety ceiling – or a list setting of it is full (`pastMemoryCeiling()`) – so the run builds less: ARENA FULL.
 * (--- review fix (uncap-all) --- another mode's count, a Glass Smash row count in a Classic run, says nothing.)
 */
export function pastAnyMemoryCeiling(settings: SimulatorSettings): boolean {
  const record = settings as unknown as Record<string, unknown>;
  for (const key of engineSettingKeys(settings.mode)) if (pastMemoryCeiling(key, record[key])) return true;
  return false;
}
// --- end uncap-all ---

/* ------------------------------------------------------------------ presets */

export const PRESETS_STORAGE_KEY = "jumpingballslive_saved_settings";
export const ADVANCED_STORAGE_KEY = "jumpingballslive_advanced_options";

/**
 * --- review fix (recording-export) --- The default watermark before the rename (the old SITE_DOMAIN): presets and project
 * files saved back then store it, and loading one puts today's default watermark in its place (a custom one stays).
 */
const LEGACY_DEFAULT_WATERMARKS: readonly string[] = ["viralballs.com", "jumpingballslive.com" /* --- review fix (site-static) --- the post-rename default, a domain nobody serves */];

/** Browser-storage keys written before the rename to JumpingBallsLive, and the keys that replaced them. */
const LEGACY_STORAGE_KEYS: Record<string, string> = {
  viralballs_saved_settings: PRESETS_STORAGE_KEY,
  viralballs_advanced_options: ADVANCED_STORAGE_KEY,
  "viralballs:race-cup": "jumpingballslive:race-cup",
  viralballs_batch_render: "jumpingballslive_batch_render",
};

/** Moves saved presets, options, race cups and batches from the old keys to the new ones (once; no-op afterwards). */
export function migrateLegacyStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    for (const [oldKey, newKey] of Object.entries(LEGACY_STORAGE_KEYS)) {
      const value = localStorage.getItem(oldKey);
      if (value === null) continue;
      if (localStorage.getItem(newKey) === null) localStorage.setItem(newKey, value);
      localStorage.removeItem(oldKey);
    }
  } catch {
    // Storage unavailable (private mode, quota): nothing to migrate.
  }
}

export type PresetStore = Record<string, Partial<SimulatorSettings>>;

export function loadPresets(): PresetStore {
  if (typeof window === "undefined") return {};
  try {
    migrateLegacyStorage();
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    // --- review fix (security-robustness) --- only an object of objects is a preset store: a stored `null`, array or number
    // (another page on the same origin can write the key) crashed the simulator on every visit
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!isPlainRecord(parsed)) return {};
    const out: PresetStore = {};
    for (const [name, preset] of Object.entries(parsed)) if (isPlainRecord(preset)) out[name] = preset as Partial<SimulatorSettings>;
    return out;
  } catch {
    return {};
  }
}

/** --- review fix (security-robustness) --- A plain object (not null, not an array). */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function savePresets(store: PresetStore) {
  try {
    localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* quota exceeded or storage disabled: presets simply stay in memory */
  }
}

/**
 * Merges a stored preset over the defaults so presets saved by older versions still load.
 * Uploaded media does not survive a reload, so a preset's "custom" hit sample falls back
 * to the default built-in clip (like dead blob: wall-break URLs). Enumerated fields (hit
 * sound mode, instruments, scale, grid, ball interaction) fall back to their defaults when the
 * stored value is unknown, and numeric ones (including the Ball Drop and Bouncing Shapes settings)
 * are clamped to their ranges, like URL parameters (the Pendulum Wave settings too).
 */
export function presetToSettings(preset: Partial<SimulatorSettings>): SimulatorSettings {
  const mode: ModeId = isModeId(preset.mode) ? preset.mode : "classic";
  const defaults = defaultSettings(mode);
  const merged = { ...defaults, ...preset, mode, wallBreakSound: normalizeWallBreakSound(preset.wallBreakSound) };
  // --- review fix (recording-export) --- the core numbers like a link's (`coreNumber()`), the enumerations the URL reader
  // checks too, the texts at a link's length (a share link made after loading keeps them whole) and no pre-rename watermark
  for (const field of CORE_NUMERIC_FIELDS) {
    const value = merged[field] as unknown;
    (merged as unknown as Record<string, number>)[field] = coreNumber(field, typeof value === "number" ? value : NaN, defaults[field]);
  }
  merged.recordingResolution = (RESOLUTIONS as readonly string[]).includes(preset.recordingResolution as string) ? (preset.recordingResolution as string) : defaults.recordingResolution;
  merged.wallBreakStyle = (WALL_BREAK_STYLES as readonly string[]).includes(preset.wallBreakStyle as string) ? (preset.wallBreakStyle as WallBreakStyle) : defaults.wallBreakStyle;
  merged.rainbowWallMode = preset.rainbowWallMode === "pulse" || preset.rainbowWallMode === "gradient" ? preset.rainbowWallMode : defaults.rainbowWallMode;
  for (const key of ["topText", "bottomText", "watermarkText"] as const) {
    const text = preset[key] as unknown;
    merged[key] = typeof text === "string" ? text.slice(0, MAX_URL_TEXT) : defaults[key];
  }
  if (LEGACY_DEFAULT_WATERMARKS.includes(merged.watermarkText.trim().toLowerCase())) merged.watermarkText = defaults.watermarkText;
  // --- end review fix (recording-export) ---
  merged.hitSoundMode = isHitSoundMode(preset.hitSoundMode) ? preset.hitSoundMode : defaults.hitSoundMode;
  merged.hitSampleId = normalizeHitSampleId(preset.hitSampleId);
  merged.hitSampleVolume = clampRange(Number(merged.hitSampleVolume), RANGES.hitSampleVolume, defaults.hitSampleVolume);
  merged.instrument = isInstrumentId(preset.instrument) ? preset.instrument : defaults.instrument;
  merged.melodyInstrument = isInstrumentId(preset.melodyInstrument) ? preset.melodyInstrument : defaults.melodyInstrument;
  merged.scale = isScaleId(preset.scale) ? preset.scale : defaults.scale;
  merged.quantizeGrid = isQuantizeGrid(preset.quantizeGrid) ? preset.quantizeGrid : defaults.quantizeGrid;
  merged.quantizeToBeat = preset.quantizeToBeat === true;
  const root = Number(merged.rootNote);
  merged.rootNote = Number.isInteger(root) && inRange(root, RANGES.rootNote) ? root : defaults.rootNote;
  merged.bpm = clampRange(Number(merged.bpm), RANGES.bpm, defaults.bpm);
  merged.sliceMs = clampRange(Number(merged.sliceMs), RANGES.sliceMs, defaults.sliceMs);
  merged.sliceFadeMs = clampRange(Number(merged.sliceFadeMs), RANGES.sliceFadeMs, defaults.sliceFadeMs);
  merged.musicLoop = typeof preset.musicLoop === "boolean" ? preset.musicLoop : defaults.musicLoop;
  clampMusicBed(merged, defaults);
  clampPhysicsExtras(merged, defaults);
  merged.ballInteraction = isBallInteraction(preset.ballInteraction) ? preset.ballInteraction : defaults.ballInteraction;
  clampBallInteraction(merged, defaults);
  clampDropSettings(merged);
  clampBoxSettings(merged);
  clampPendulumSettings(merged);
  clampPolyrhythmSettings(merged); // --- jdm-polyrhythm ---
  // --- jdm-collisions ---
  clampCollideSettings(merged);
  clampGlassSettings(merged); // --- gerald-glass ---
  clampPicturePaint(merged);
  clampCharacter(merged); // --- gerald-faces ---
  Object.assign(merged, resolveThemeSettings(merged)); // --- themes: unknown theme ids / styles and bad colours fall back
  Object.assign(merged, resolveTeamSettings({ ...merged, ballCount: preset.ballCount })); // --- teams --- (a preset without a ball count: `twoBalls` means two)
  clampCameraSettings(merged); // --- camera ---
  clampMultiplierSettings(merged); // --- gerald-multipliers ---
  Object.assign(merged, resolveObstacleSettings(merged)); // --- obstacle-editor --- invalid obstacles dropped, numbers clamped
  Object.assign(merged, resolveExitSplatFields(merged)); // --- gerald-exit-splat --- a known behaviour, a real boolean, numbers from their minimum up
  Object.assign(merged, resolveCaptionSettings(merged)); // --- captions --- unknown types dropped, bad fields fall back
  Object.assign(merged, resolveRiggedConfig(merged)); // --- rigged --- a non-boolean flag is off, a bad team slot too
  Object.assign(merged, resolveTimelineSettings(merged, RANGES)); // --- timeline --- unknown settings dropped, values clamped to their ranges
  Object.assign(merged, resolveDoublePendulumFields(merged)); // --- jdm-double-pendulum --- numbers clamped, unknown layouts / flags fall back
  Object.assign(merged, resolveIllusionFields(merged)); // --- jdm-illusions --- clamped numbers, known options, real booleans
  Object.assign(merged, resolveStringBattleFields(merged)); // --- odd-string-battle --- clamped numbers, known rule / style, real booleans
  Object.assign(merged, resolvePowerLayersFields(merged)); // --- odd-power-layers --- clamped numbers, known options, real booleans
  Object.assign(merged, resolveFastExportSettings(merged)); // --- fast-render --- (snapped to 30 or 60)
  Object.assign(merged, resolveRaceFields(merged)); // --- jdm-race --- clamped numbers, known options, real booleans, a clean cup title
  Object.assign(merged, resolveArenaGameFields(merged)); // --- jdm-arena-games --- clamped numbers, known arenas, real booleans
  Object.assign(merged, resolveJdmRhythmFields(merged)); // --- jdm-rhythm-runner --- clamped numbers, known options, real booleans
  Object.assign(merged, resolveSplitScreenFields(merged)); // --- split-screen --- 1, 2 or 4 arenas, known layout / sound, clean overrides
  Object.assign(merged, resolveVortexFields(merged)); // --- gerald-vortex --- clamped numbers on their steps, a real boolean
  Object.assign(merged, resolveJourneyFields(merged)); // --- gerald-journey --- a normalised stage list, a clamped auto count
  Object.assign(merged, resolveBullseyeFields(merged)); // --- gerald-bullseye --- clamped numbers on their steps, a real boolean
  Object.assign(merged, resolveBeatDropFields(merged)); // --- beat-drop --- a clean mix, clamped numbers, known options, a real boolean
  Object.assign(merged, resolveVideoBeatsFields(merged)); // --- video-beats --- known source, markers re-encoded, clamped numbers, real booleans
  Object.assign(merged, resolveTerritoryFields(merged)); // --- odd-territory --- valid numbers (no maximum), 2 or 4 teams, known powers, real booleans
  Object.assign(merged, resolveMazeFields(merged)); // --- odd-maze --- valid numbers on their steps (no maximum), known options, real colours and booleans
  Object.assign(merged, resolveConveyorFields(merged)); // --- gerald-conveyor --- valid numbers on their steps (no maximum), a known arena, a real boolean, the respawn period
  Object.assign(merged, resolveLandClaimFields(merged)); // --- land-claim --- valid numbers (no maximum), a known arena and rule, a clean title, a real boolean
  Object.assign(merged, resolveBounceMathFields(merged)); // --- bounce-math --- invalid rules dropped, a real boolean
  restoreUnlimitedPreset(preset, merged); // --- unlimited --- (switch on: stored big values kept, invalid ones back to the default)
  resolveBounciness(merged, typeof preset.bounciness === "number"); // --- uncap-all --- (a preset from before it: its Bouncier switch)
  return merged;
}

/** The uploads the page holds right now: whether a hit sample was uploaded, and the blob: URL of the uploaded wall-break sound. */
export interface LiveUploads {
  hitSample: boolean;
  wallBreakSound: string | null;
}

/**
 * `presetToSettings()` for settings put on the page while it still holds its uploads (a saved preset, an imported project,
 * a share code, a batch job and the batch's way back to the page's own settings): a "custom" hit sample stays selected
 * while a sample is uploaded, and an uploaded wall-break sound (a blob: URL, which `presetToSettings()` drops) while it
 * is the page's live upload. A dead blob: URL or "custom" without an upload still falls back.
 */
export function presetToLiveSettings(preset: Partial<SimulatorSettings>, uploads: LiveUploads): SimulatorSettings {
  const loaded = presetToSettings(preset);
  if (preset.hitSampleId === CUSTOM_HIT_SAMPLE_ID && uploads.hitSample) loaded.hitSampleId = CUSTOM_HIT_SAMPLE_ID;
  if (preset.wallBreakSound && preset.wallBreakSound === uploads.wallBreakSound) loaded.wallBreakSound = preset.wallBreakSound;
  return loaded;
}

/** The export frame of a resolution setting; anything but one of `RESOLUTIONS` gives the default 1080×1920 (never a bogus size for the recorder). */
export function resolutionToSize(resolution: string): { width: number; height: number } {
  if (!(RESOLUTIONS as readonly string[]).includes(resolution)) return { width: 1080, height: 1920 }; // --- review fix (recording-export) ---
  const [w, h] = resolution.split("x").map(Number);
  return { width: w || 1080, height: h || 1920 };
}
