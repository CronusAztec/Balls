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
// --- boris-glass ---
import { DEFAULT_GLASS_SETTINGS, GLASS_RANGES, glassSettingFields, glassSettingsOf, resolveGlassSettings } from "@/lib/physics/modes/glass";
import { DEFAULT_PICTURE_PAINT, PICTURE_PAINT_RANGES, isPaintBeatSource, picturePaintOf, resolvePicturePaintSettings, type PaintBeatSource } from "@/lib/physics/picturePaint";
import { isBallInteraction, isModeId, WALL_BREAK_STYLES } from "@/lib/physics/types";
import { SITE_DOMAIN } from "@/lib/site";
import { CHARACTER_RANGES, DEFAULT_CHARACTER, characterOf, isFaceStyle, resolveCharacterSettings, type FaceStyle } from "@/lib/character/character"; // --- boris-faces ---
import { THEME_RANGES, defaultThemeSettings, readThemeParams, resolveThemeSettings, writeThemeParams, type BackgroundType, type ParticleStyle } from "@/lib/themes"; // --- themes
import { TEAM_RANGES, defaultTeamSettings, readTeamParams, resolveTeamSettings, writeTeamParams, type ScoreboardPosition, type TeamEntry } from "@/lib/teams"; // --- teams ---
import { CAMERA_RANGES, DEFAULT_CAMERA_SETTINGS, cameraSettingsOf, resolveCameraSettings } from "@/lib/simulation/camera"; // --- camera
// --- boris-multipliers ---
import { DEFAULT_MULTIPLIER_CONFIG, MULTIPLIER_RANGES, multiplierConfigOf, resolveMultiplierConfig, sanitizePickupTypes } from "@/lib/physics/multipliers";
import { DEFAULT_MULTIPLIERS_SETTINGS, MULTIPLIERS_RANGES, multipliersSettingFields, multipliersSettingsOf, resolveMultipliersSettings, sanitizeGateMix } from "@/lib/physics/modes/multipliers";
// --- obstacle-editor ---
import { OBSTACLE_EDITOR_RANGES, defaultObstacleSettings, readObstacleParams, resolveObstacleSettings, writeObstacleParams, type EditorObstacle } from "@/lib/physics/obstacleEditor";
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

/**
 * Every user-facing simulator setting lives in this one object. The controls panel,
 * URL sharing, presets and the seed finder all read from it, so adding a setting means:
 *  1. add a field here (+ default in `defaultSettings`),
 *  2. optionally add a short URL key in URL_KEYS so it is shareable,
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
  // --- boris-glass --- Glass Smash (lib/physics/modes/glass.ts): stages of glass panes between the ball and HOME
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
  /** --- boris-multipliers --- A row of multiplier gates (x2 DMG, x1.5 SPEED, x1.25 SIZE) above every stage's glass (URL `glg`). */
  glassGates: boolean;
  // --- end boris-glass ---
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
  // --- boris-faces --- Ball characters (lib/character): a face, a name label and squash-and-stretch – all render-only
  /** none | dot | cute | cool | cat | angry (URL `face`). */
  ballFace: FaceStyle;
  /** Draw the face over a custom ball image or emoji too (URL `fimg`). */
  faceOverImage: boolean;
  /** Name shown under the ball, e.g. "Boris" (URL `bn`). */
  ballName: string;
  /** Show the name label (URL `nl`). */
  nameLabel: boolean;
  /** 0–1: squash on impact and stretch back (URL `sq`). */
  ballSquash: number;
  /** Cat face: a meow-like chirp on ouch / surprise / escape while no hit sample is used (URL `fsnd`). */
  faceSounds: boolean;
  // --- end boris-faces ---
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
  // --- boris-multipliers --- stat multipliers (lib/physics/multipliers.ts) and the multipliers board (modes/multipliers.ts)
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
  /** Weights of count / speed / size / damage / reverse / release gates, six digits (URL `mpgm`). */
  mpGateMix: string;
  /** Balls released at the top, 1–10 (URL `mpsb`). */
  mpStartBalls: number;
  /** Most balls in play, 50–2000 (URL `mpmb`). */
  mpMaxBalls: number;
  /** Rigging: the finder looks for a run whose final count is within 5 % of this, 0 = off (URL `mptg`). */
  mpTarget: number;
  // --- end boris-multipliers ---
  // --- obstacle-editor --- pegs, bumpers, blockers and spinners placed in the ring modes (lib/physics/obstacleEditor.ts)
  /** The layout, arena-relative (URL `obs`, e.g. `p:0.2,-0.3,6;b:-0.4,0.1,8`); empty by default. */
  obstacles: EditorObstacle[];
  /** Speed factor a bumper gives a ball on a hard hit, 1–2 (URL `obb`). */
  bumperBoost: number;
  // --- end obstacle-editor ---
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
    // --- boris-glass ---
    ...glassSettingFields(DEFAULT_GLASS_SETTINGS),
    ...DEFAULT_PICTURE_PAINT,
    watermarkText: SITE_DOMAIN,
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
    ...DEFAULT_CHARACTER, // --- boris-faces ---
    ...defaultTeamSettings(), // --- teams ---
    ...DEFAULT_CAMERA_SETTINGS, // --- camera ---
    // --- boris-multipliers ---
    ...DEFAULT_MULTIPLIER_CONFIG,
    ...multipliersSettingFields(DEFAULT_MULTIPLIERS_SETTINGS),
    ...defaultObstacleSettings(), // --- obstacle-editor ---
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
  ...CHARACTER_RANGES, // --- boris-faces ---
  ...THEME_RANGES, // --- themes
  // --- jdm-collisions ---
  ...COLLIDE_RANGES,
  ...TEAM_RANGES, // --- teams ---
  ...CAMERA_RANGES, // --- camera ---
  // --- boris-glass ---
  ...GLASS_RANGES,
  // --- boris-multipliers ---
  ...MULTIPLIER_RANGES,
  ...MULTIPLIERS_RANGES,
  ...OBSTACLE_EDITOR_RANGES, // --- obstacle-editor ---
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

const NUMERIC_URL_KEYS: Record<string, NumericKey> = {
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
  // --- boris-faces ---
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
  // --- boris-glass --- Glass Smash
  glr: "glassRows",
  glhp: "glassHp",
  gls: "glassStages",
  // --- boris-multipliers ---
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
  // --- boris-faces ---
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
  // --- boris-glass --- Glass Smash
  glm: "glassMoving",
  glh: "glassHoles",
  glg: "glassGates", // --- boris-multipliers --- the gate rows
  // --- boris-multipliers ---
  mpu: "mpUnlimited",
  mpk: "multiplierPickups",
  ne: "neverEscape", // --- rigged ---
};

const STRING_URL_KEYS: Record<string, StringKey> = {
  cc: "circleColor",
  bc: "ballColor",
  bc2: "ballColor2",
  lc: "lineColor",
  top: "topText",
  bottom: "bottomText",
  wm: "watermarkText",
  bn: "ballName", // --- boris-faces ---
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
  if (settings.ballFace !== base.ballFace) params.set("face", settings.ballFace); // --- boris-faces ---
  writeThemeParams(settings, base, params); // --- themes: theme, bgt, bg1, bg2, bgd, ps, trc
  writeTeamParams(settings, base, params); // --- teams ---: teams, nb, tn, tsb, tsp
  // --- boris-multipliers --- the two list-like strings (validated on the way back in)
  if (settings.pickupTypes !== base.pickupTypes) params.set("mpty", settings.pickupTypes);
  if (settings.mpGateMix !== base.mpGateMix) params.set("mpgm", settings.mpGateMix);
  writeObstacleParams(settings, base, params); // --- obstacle-editor ---: obs, obb
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
  return params;
}

/** Up to three decimals (air drag steps by 0.001), trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

/** Reads settings from a URL; unknown or invalid values fall back to the defaults. */
export function settingsFromSearchParams(params: URLSearchParams): SimulatorSettings {
  const modeParam = params.get("mode");
  const mode: ModeId = isModeId(modeParam) ? modeParam : "classic";
  const settings = defaultSettings(mode);
  for (const [key, field] of Object.entries(NUMERIC_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) (settings as unknown as Record<string, number>)[field] = value;
  }
  for (const [key, field] of Object.entries(BOOLEAN_URL_KEYS)) {
    const raw = params.get(key);
    if (raw === "1") (settings as unknown as Record<string, boolean>)[field] = true;
    else if (raw === "0") (settings as unknown as Record<string, boolean>)[field] = false;
  }
  for (const [key, field] of Object.entries(STRING_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) (settings as unknown as Record<string, string>)[field] = raw.slice(0, 60);
  }
  const rw = params.get("rwmode");
  if (rw === "pulse" || rw === "gradient") settings.rainbowWallMode = rw;
  const wb = params.get("wbreak");
  if (wb && (WALL_BREAK_STYLES as readonly string[]).includes(wb)) settings.wallBreakStyle = wb as WallBreakStyle;
  const res = params.get("res");
  if (res && (RESOLUTIONS as readonly string[]).includes(res)) settings.recordingResolution = res;
  const dur = Number(params.get("dur"));
  if (Number.isFinite(dur) && dur >= RANGES.recordingDuration.min && dur <= RANGES.recordingDuration.max) settings.recordingDuration = dur;
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
  clampGlassSettings(settings); // --- boris-glass ---
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
  // --- boris-faces ---
  const face = params.get("face");
  if (isFaceStyle(face)) settings.ballFace = face;
  clampCharacter(settings);
  readThemeParams(params, settings); // --- themes
  readTeamParams(params, settings); // --- teams --- (after `two`: a roster or `nb` sets the ball count)
  clampCameraSettings(settings); // --- camera ---
  // --- boris-multipliers ---
  const mpty = params.get("mpty");
  if (mpty !== null) settings.pickupTypes = sanitizePickupTypes(mpty);
  const mpgm = params.get("mpgm");
  if (mpgm !== null) settings.mpGateMix = sanitizeGateMix(mpgm);
  clampMultiplierSettings(settings);
  readObstacleParams(params, settings); // --- obstacle-editor ---
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
  return settings;
}

function clampRange(value: number, range: { min: number; max: number }, fallback: number) {
  return Number.isFinite(value) ? Math.max(range.min, Math.min(range.max, value)) : fallback;
}

function inRange(value: number, range: { min: number; max: number }) {
  return value >= range.min && value <= range.max;
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

// --- boris-glass ---
/** Keeps the Glass Smash settings inside their ranges as whole numbers; a non-boolean flag falls back to the default (URL parameters and presets alike). */
function clampGlassSettings(settings: SimulatorSettings) {
  Object.assign(settings, glassSettingFields(resolveGlassSettings(glassSettingsOf(settings))));
}

/** Keeps the Picture Paint settings inside their ranges; an unknown beat source or a non-boolean flag falls back to the default (URL parameters and presets alike). */
function clampPicturePaint(settings: SimulatorSettings) {
  Object.assign(settings, resolvePicturePaintSettings(picturePaintOf(settings)));
}

// --- boris-faces ---
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
// --- boris-multipliers ---
/** Keeps the multiplier settings (cap, smash threshold, pickups) and the multipliers board inside their ranges; bad values fall back to the defaults (URL parameters and presets alike). */
function clampMultiplierSettings(settings: SimulatorSettings) {
  Object.assign(settings, resolveMultiplierConfig(multiplierConfigOf(settings)));
  Object.assign(settings, multipliersSettingFields(resolveMultipliersSettings(multipliersSettingsOf(settings))));
}

/* ------------------------------------------------------------------ presets */

export const PRESETS_STORAGE_KEY = "viralballs_saved_settings";
export const ADVANCED_STORAGE_KEY = "viralballs_advanced_options";

export type PresetStore = Record<string, Partial<SimulatorSettings>>;

export function loadPresets(): PresetStore {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PRESETS_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PresetStore) : {};
  } catch {
    return {};
  }
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
  clampGlassSettings(merged); // --- boris-glass ---
  clampPicturePaint(merged);
  clampCharacter(merged); // --- boris-faces ---
  Object.assign(merged, resolveThemeSettings(merged)); // --- themes: unknown theme ids / styles and bad colours fall back
  Object.assign(merged, resolveTeamSettings({ ...merged, ballCount: preset.ballCount })); // --- teams --- (a preset without a ball count: `twoBalls` means two)
  clampCameraSettings(merged); // --- camera ---
  clampMultiplierSettings(merged); // --- boris-multipliers ---
  Object.assign(merged, resolveObstacleSettings(merged)); // --- obstacle-editor --- invalid obstacles dropped, numbers clamped
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

export function resolutionToSize(resolution: string): { width: number; height: number } {
  const [w, h] = resolution.split("x").map(Number);
  return { width: w || 1080, height: h || 1920 };
}
