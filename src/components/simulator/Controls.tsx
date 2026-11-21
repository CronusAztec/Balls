"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { ColorPicker, Searchable, Slider, SliderTrack, Toggle, TrackEnds, offBtn, onBtn, rainbowBtn, selectClass, sliderStyle } from "./ControlPrimitives"; // --- unlimited-sizes --- (SliderTrack, TrackEnds: the hand-written tracks widen too)
import BallDropSection, { BALL_DROP_KEYS } from "./sections/BallDropSection";
import EscapeModeSection, { ESCAPE_MODE_KEYS_BY_MODE } from "./sections/EscapeModeSection"; // --- review fix (ui-i18n) ---
import BallInteractionSection, { BALL_INTERACTION_KEYS } from "./sections/BallInteractionSection";
import BoxArenaSection, { BOX_ARENA_KEYS } from "./sections/BoxArenaSection";
import CharacterSection, { CHARACTER_KEYS } from "./sections/CharacterSection"; // --- gerald-faces ---
import HitSampleSection, { HIT_SAMPLE_KEYS } from "./sections/HitSampleSection";
import MusicSection, { MUSIC_BED_KEYS, type MusicTrackInfo } from "./sections/MusicSection";
import PendulumWaveSection, { PENDULUM_WAVE_KEYS } from "./sections/PendulumWaveSection";
import EllipseFociSection, { ELLIPSE_FOCI_KEYS } from "./sections/EllipseFociSection"; // --- ellipse-foci --- the Focus Shot block of the Mode row
import BeatMachineSection, { BEAT_MACHINE_KEYS } from "./sections/BeatMachineSection"; // --- beat-machine --- the Beat Machines block of the Mode row
import WaveTankSection, { WAVE_TANK_KEYS } from "./sections/WaveTankSection"; // --- wave-tank --- the Wave Tank block of the Mode row
import BrickRebuildSection, { BRICK_REBUILD_KEYS } from "./sections/BrickRebuildSection"; // --- brick-rebuild --- the Brick Smash block of the Mode row
import DrawingMachineSection, { DRAWING_MACHINE_KEYS } from "./sections/DrawingMachineSection"; // --- drawing-machine --- the Drawing Machines block of the Mode row
import PerfectFitSection, { PERFECT_FIT_KEYS } from "./sections/PerfectFitSection"; // --- perfect-fit --- the Perfect Fit block of the Mode row
import { BALL_PHYSICS_EXTRA_KEYS, BallPhysicsExtras, WALL_PHYSICS_EXTRA_KEYS, WallPhysicsExtras } from "./sections/PhysicsExtrasSection";
import PicturePaintSection, { PICTURE_PAINT_KEYS, type PaintBeatInfo, type PaintPictureInfo } from "./sections/PicturePaintSection";
import PolyrhythmSection, { POLYRHYTHM_KEYS } from "./sections/PolyrhythmSection"; // --- jdm-polyrhythm ---
import SongSlicerSection, { SONG_SLICER_KEYS } from "./sections/SongSlicerSection";
import ThemeSection, { THEME_KEYS, ThemeCards, type ThemeImageProps } from "./sections/ThemeSection"; // --- themes (--- panel-basics --- ThemeCards: the starter block's too)
import CameraSection, { CAMERA_KEYS } from "./sections/CameraSection"; // --- camera ---
// --- jdm-collisions ---
import CollisionPlaygroundSection, { COLLISION_PLAYGROUND_KEYS } from "./sections/CollisionPlaygroundSection";
// --- teams ---
import TeamsSection, { BallCountControl, TEAM_KEYS } from "./sections/TeamsSection";
import { MULTI_BALL_MODES } from "@/lib/physics/ballStats";
import { defaultTeamSettings } from "@/lib/teams";
// --- gerald-glass ---
import GlassSection, { GLASS_KEYS } from "./sections/GlassSection";
// --- gerald-multipliers ---
import MultipliersSection, { MULTIPLIER_KEYS, showsMultipliersSection } from "./sections/MultipliersSection";
import MultipliersModeSection, { MULTIPLIERS_MODE_KEYS } from "./sections/MultipliersModeSection";
import { multiplierConfigOf } from "@/lib/physics/multipliers";
// --- obstacle-editor ---
import ObstaclesSection, { OBSTACLE_KEYS } from "./sections/ObstaclesSection";
import { defaultObstacleSettings, supportsObstacles } from "@/lib/physics/obstacleEditor";
import CaptionsSection, { CAPTION_KEYS } from "./sections/CaptionsSection"; // --- captions ---
import DoublePendulumSection, { DOUBLE_PENDULUM_KEYS } from "./sections/DoublePendulumSection"; // --- jdm-double-pendulum ---
import { defaultCaptionSettings } from "@/lib/captions"; // --- captions ---
import RiggedSection, { RIGGED_KEYS } from "./sections/RiggedSection"; // --- rigged ---
import { MUSIC_ADVANCED_KEYS } from "./sections/MusicSection"; // --- panel-basics --- (what the Music block shows with Show Advanced Options only)
import { SONG_SLICER_ADVANCED_KEYS } from "./sections/SongSlicerSection"; // --- panel-basics ---
import { VIDEO_BEATS_ADVANCED_KEYS } from "./sections/VideoBeatsSection"; // --- panel-basics ---
import { riggedConfigOf } from "@/lib/physics/rigged"; // --- rigged ---
import TimelineSection, { TIMELINE_SECTION_KEYS, TimelineRangeInput, TimelineValueText } from "./sections/TimelineSection"; // --- timeline ---
import { defaultTimelineSettings } from "@/lib/simulation/timeline"; // --- timeline ---
// --- jdm-illusions --- the Circle Illusion block of the Mode row and the Wobbly Walls slider of the Visual section
import IllusionSection, { ILLUSION_KEYS } from "./sections/IllusionSection";
import WallWobbleSection, { WALL_WOBBLE_KEYS, hasWobblyWalls } from "./sections/WallWobbleSection";
import { EXIT_BEHAVIOR_KEYS, ExitBehaviorControls, SPLAT_BARRIER_KEYS, SplatBarrierControls } from "./sections/ExitSplatSection"; // --- gerald-exit-splat ---
import StringBattleSection, { STRING_BATTLE_KEYS } from "./sections/StringBattleSection"; // --- odd-string-battle ---
import PowerLayersSection, { POWER_LAYERS_KEYS } from "./sections/PowerLayersSection"; // --- odd-power-layers --- the Power layers block of the Mode row
import { FAST_EXPORT_KEYS, FastExportFpsControl, type FastExportPanelProps } from "./sections/FastExportSection"; // --- fast-render ---
import BatchSection, { BATCH_KEYS, type BatchPanelProps } from "./sections/BatchSection"; // --- batch-render ---
import LoopSection, { LOOP_KEYS } from "./sections/LoopSection"; // --- loop-foundation ---
import { loopCaptionContext } from "@/lib/publish/loopCaption"; // --- loop-foundation ---
import LoopClipsSection, { LOOP_CLIP_KEYS, type LoopClipsPanelProps } from "./sections/LoopClipsSection"; // --- loop-foundation ---
import BotSection, { BOT_KEYS, type BotPanelProps } from "./sections/BotSection"; // --- viral-bot ---
import PublishSection, { PUBLISH_KEYS } from "./sections/PublishSection"; // --- social-publish ---
import AccountRow from "@/components/billing/AccountRow"; // --- paywall-gate --- Free or Pro, at the top of the Recording group
// --- project-files --- the "Project file" block (Export / Import project) under Saved Presets
import ProjectSection, { PROJECT_KEYS } from "./sections/ProjectSection";
import type { ProjectPanelProps } from "./useProjectFiles";
import RaceSection, { RACE_KEYS } from "./sections/RaceSection"; // --- jdm-race ---
// --- jdm-arena-games --- the "Arena games" block of the Mode row (Battle Royale, Capture the Flag)
import ArenaGamesSection, { ARENA_GAME_KEYS } from "./sections/ArenaGamesSection";
import { isArenaGameMode } from "@/lib/physics/modes/arenaGames";
// --- jdm-rhythm-runner --- the "Beat runner" and "Paddle keep-up" blocks of the Mode row
import { JDM_RHYTHM_KEYS, PaddleSection, RunnerSection } from "./sections/JdmRhythmSection";
// --- split-screen --- the "Split screen" section: arena count, layout, sound and the per-arena overrides
import ArenasSection, { SPLIT_SCREEN_KEYS } from "./sections/ArenasSection";
import { defaultSplitScreenFields } from "@/lib/splitScreen";
import VortexSection, { VORTEX_KEYS } from "./sections/VortexSection"; // --- gerald-vortex --- the Vortex block of the Mode row
import JourneySection, { JOURNEY_KEYS } from "./sections/JourneySection"; // --- gerald-journey --- the Journey block of the Mode row
import BullseyeSection, { BULLSEYE_KEYS } from "./sections/BullseyeSection"; // --- gerald-bullseye --- the Bullseye block of the Mode row
import MergeRingSection, { MERGE_RING_KEYS } from "./sections/MergeRingSection"; // --- merge-ring --- the Merge Ring block of the Mode row
import SpiralGlassSection, { SPIRAL_GLASS_KEYS } from "./sections/SpiralGlassSection"; // --- spiral-glass --- the Spiral Glass block of the Mode row
import SongRingSection, { SONG_RING_KEYS } from "./sections/SongRingSection"; // --- song-ring --- the Song Ring block of the Mode row
import SandPlateSection, { SAND_PLATE_KEYS } from "./sections/SandPlateSection"; // --- sand-plate --- the Sand Plate block of the Mode row
import BlueprintSection, { BLUEPRINT_KEYS } from "./sections/BlueprintSection"; // --- blueprint --- the Mode Lab block of the Mode row
import BeatDropSection, { BEAT_DROP_KEYS } from "./sections/BeatDropSection"; // --- beat-drop --- the Beat Drop block of the Mode row
import TerritorySection, { TERRITORY_KEYS } from "./sections/TerritorySection"; // --- odd-territory --- the Territory block of the Mode row
import MazeSection, { MAZE_KEYS } from "./sections/MazeSection"; // --- odd-maze --- the Maze block of the Mode row
import ConveyorSection, { CONVEYOR_KEYS, RESPAWN_KEYS, RespawnControl, SwarmLimitControl } from "./sections/ConveyorSection"; // --- gerald-conveyor --- the Conveyor block of the Mode row, the respawn timer of the Ball section (--- unlimited-sizes --- and the swarm's ceiling)
import OrbGridSection, { ORB_GRID_KEYS, OrbGridPresets } from "./sections/OrbGridSection"; // --- orb-grid --- the Bouncing Orbs block of the Mode row, its presets in the Presets group
import type { OrbGridFields } from "@/lib/physics/modes/orbGrid"; // --- orb-grid ---
import FightLeagueSection, { FIGHT_LEAGUE_KEYS } from "./sections/FightLeagueSection"; // --- fight-league --- the Fight League block of the Mode row
import LandClaimSection, { LAND_CLAIM_KEYS } from "./sections/LandClaimSection"; // --- land-claim --- the Land Claim block of the Mode row
import ColourSortSection, { COLOUR_SORT_KEYS } from "./sections/ColourSortSection"; // --- colour-sort --- the Colour Sort block of the Mode row
import RingEscapeSection, { RING_ESCAPE_KEYS } from "./sections/RingEscapeSection"; // --- ring-escape --- Classic's ring generation (the Wall section)
import StarChordsSection, { STAR_CHORDS_KEYS } from "./sections/StarChordsSection"; // --- chord-stars --- the Chord Stars block of the Mode row
import HoopsSection, { HOOPS_KEYS } from "./sections/HoopsSection"; // --- bead-hoops --- the Spinning Hoops block of the Mode row
import VideoBeatsSection, { VIDEO_BEATS_KEYS } from "./sections/VideoBeatsSection"; // --- video-beats --- the "Beats from a video" block of the Sound section
import type { VideoBeatsPanelProps } from "./useVideoBeats"; // --- video-beats ---
import { defaultVideoBeatsFields } from "@/lib/simulation/videoBeatsSettings"; // --- video-beats ---
import { HIT_SOUND_MODES, type HitSampleStatus } from "@/lib/audio/sampler";
import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/audio/instruments";
import { NOTE_NAMES, QUANTIZE_GRIDS, SCALE_IDS, type ScaleId } from "@/lib/audio/scales";
import { SONGS, WALL_BREAK_SOUNDS } from "@/lib/audio/songs";
import { MODE_WALL_BREAK_SOUNDS } from "@/lib/audio/songs"; // --- gerald-glass ---
import { ADVANCED_STORAGE_KEY, RANGES, RESOLUTIONS, defaultSettings, migrateLegacyStorage, type SimulatorSettings } from "@/lib/settings";
import { characterOf } from "@/lib/character/character"; // --- gerald-faces ---
import { cameraSettingsOf } from "@/lib/simulation/camera"; // --- camera ---
import { TWO_BALL_MODES } from "@/lib/physics/engine";
import type { ModeId, WallBreakStyle } from "@/lib/physics/types";
// --- unlimited --- the No limits switch and the unlimited sliders of the whole panel
import UnlimitedSection, { FullBallLimitControl, UNLIMITED_KEYS } from "./sections/UnlimitedSection"; // --- unlimited-sizes --- (FullBallLimitControl)
import { UnlimitedProvider } from "./unlimitedSlider";
import { bouncinessPatch } from "@/lib/settings"; // --- uncap-all --- the numeric Bounciness
import BounceMathSection, { BOUNCE_MATH_KEYS, type BounceMathPanelProps } from "./sections/BounceMathSection"; // --- bounce-math ---
import { defaultBounceMathFields } from "@/lib/simulation/bounceMath"; // --- bounce-math ---

// The Slider / Toggle / Searchable building blocks live in ControlPrimitives.tsx so feature sections can share them.
export { sliderStyle };
import NumberField from "./NumberField"; // --- uncap-all --- a number field next to every numeric control
import { rulesForRange } from "./unlimitedSlider"; // --- uncap-all ---
// --- site-redesign --- the studio's rail, panel and command palette
import TabStrip, { type TabStripItem } from "@/components/ui/Tabs";
import Button from "@/components/ui/Button";
import Kbd from "@/components/ui/Kbd";
import { cx } from "@/components/ui/cx";
import { useModifierKey } from "@/components/ui/useModifierKey";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { IconBall, IconBookmark, IconCaptions, IconChevronDown, IconClose, IconGrid, IconInfo, IconKeyframes, IconObstacle, IconReset, IconRings, IconSearch, IconSparkle, IconSplit, IconUndo, IconUpload, IconUsers, IconVideo, IconWave } from "@/components/ui/icons";
import CommandPalette from "./studio/CommandPalette";
import { StageModeContext } from "./studio/StageStrip"; // --- studio-fit --- the strip's mode arrows read the mode from here
import { OPEN_SETTING_EVENT, modesOnShelf, paletteControlEntries, type PaletteEntry, type PaletteGroup } from "@/lib/siteDesign";
import { modePaletteWords } from "@/lib/modeSearch"; // --- mode-search --- the palette finds a mode by the words the picker does, its shelf's among them
import { rememberRecentMode } from "@/lib/modeRecent"; // --- mode-shelves ---
import { MODE_BLOCK_KEYS, ballControlsOf, sectionKeyShown, settingSearchWords, wallControlsOf, type PanelShown } from "./panelKeys"; // --- review fix (site-redesign) --- what the palette offers per mode (--- panel-basics --- and the words a control answers to)
// --- panel-basics --- the starter block, the named rows of the Recording group, the undo history, the last address
import FoldRow from "./studio/FoldRow";
import { UNDO_SETTLE_MS, pushUndo, readStudioQuery, rememberStudioQuery, studioQueryMode, typesText, undoPatch } from "@/lib/studioMemory";

/** --- site-redesign --- a group of the studio's rail: the Mode group, a panel section, or the saved presets. */
export type StudioSection = "mode" | ControlSection | "presets";

export type ControlSection = "ball" | "wall" | "visual" | "sound" | "recording" | "teams" | "obstacles" | "captions" | "timeline" | "arenas"; // --- teams --- ("teams") --- obstacle-editor --- ("obstacles") --- captions --- ("captions") --- timeline --- ("timeline") --- split-screen --- ("arenas")

export interface ControlsProps {
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  onResetSection: (section: ControlSection) => void;
  isRecording: boolean;
  recordingSupported: boolean;
  simulationFound: boolean;
  onRecordToggle: () => void;
  ballImage: string | null;
  onBallImageUpload: (file: File) => void;
  onBallImageClear: () => void;
  ballEmoji: string | null;
  onBallEmojiChange: (emoji: string | null) => void;
  customSoundId: string | null;
  customSoundLoading: boolean;
  customSoundNoteCount: number;
  onCustomSoundSelect: (id: string | null) => void;
  customMidiName: string | null;
  onCustomMidiUpload: (file: File) => void;
  customWallBreakName: string | null;
  onWallBreakSoundUpload: (file: File) => void;
  /** Name of the hit sample uploaded in this session (selectable as "custom"), if any. */
  customHitSampleName: string | null;
  /** Decode state of the selected hit sample ("error" is shown in the panel; the tones play meanwhile). */
  hitSampleStatus: HitSampleStatus;
  onHitSampleUpload: (file: File) => void;
  /** Song slicer: the song decoded in this session (name + length in seconds), if any. */
  sliceSongName: string | null;
  sliceSongDuration: number;
  sliceSongLoading: boolean;
  onSliceSongUpload: (file: File) => void;
  onSliceSongClear: () => void;
  /** Background music bed: the track uploaded in this session, its decode state and whether it is sounding. */
  musicTrack: MusicTrackInfo | null;
  musicLoading: boolean;
  musicPlaying: boolean;
  /** Current duck gain of the bed (0–1) for the level meter. */
  getMusicDuckGain: () => number;
  onMusicUpload: (file: File) => void;
  onMusicRemove: () => void;
  /** Picture Paint: the picture uploaded in this session (kept in memory) and what is known about the song's beat. */
  paintPicture: PaintPictureInfo | null;
  onPaintPictureUpload: (file: File) => void;
  onPaintPictureRemove: () => void;
  paintBeat: PaintBeatInfo;
  savedPresetNames: string[];
  onSavePreset: (name: string) => void;
  onLoadPreset: (name: string) => void;
  onDeletePreset: (name: string) => void;
  // --- themes: the background picture uploaded in this session (kept in memory) and how to change it
  themeImage: ThemeImageProps;
  // --- end themes
  // --- fast-render --- the Fast export button under Record Video, its progress and how it went
  fastExport?: FastExportPanelProps;
  /** --- project-files --- the page's side of Export / Import project (the block is left out without it). */
  project?: ProjectPanelProps;
  /** --- batch-render --- the Batch block of the Recording section: many fast exports in a row (left out without it). */
  batch?: BatchPanelProps;
  /** --- review fix (recording-export) --- a batch is rendering: saved presets cannot be loaded (the batch would roll them back). */
  batchRunning?: boolean;
  /** --- video-beats --- the "Beats from a video" block of the Sound section (left out without it). */
  videoBeats?: VideoBeatsPanelProps;
  /** --- viral-bot --- the Viral video bot block after it: plans, scores and renders clips (left out without it). */
  bot?: BotPanelProps;
  /** --- bounce-math --- the engine's readout for the Bounce math block (its live values; the block works without it). */
  bounceMath?: BounceMathPanelProps;
  /** --- site-redesign --- the stage (strip, canvas, transport), laid out between the rail and the panel. */
  stage?: ReactNode;
  /** --- site-redesign --- opens the mode picker (the page owns the dialog). */
  onOpenModePicker?: () => void;
  // --- orb-grid ---
  /** Loads a Bouncing Orbs preset (the Presets group): the mode first when another one is on, then the preset's fields (left out without it). */
  onOrbGridPreset?: (fields: OrbGridFields) => void;
  // --- end orb-grid ---
  /** --- loop-foundation --- The loop families' clip slots of the Sound section (the owner's own clips; left out without it). */
  loopClips?: LoopClipsPanelProps;
}

const EMOJIS = ["😂", "🔥", "💀", "❤️", "⭐", "🎯", "🏀", "⚽", "🎱", "🌍", "🍩", "🎃"];

/** --- panel-basics --- Where the starter block's open state is kept ("open" or "closed"; a per-visitor convenience). */
const STARTER_STORAGE_KEY = "jumpingballslive_studio_starter";

/** Translation keys for the instrument and scale pickers (Controls namespace). */
const INSTRUMENT_LABELS: Record<InstrumentId, string> = { sine: "instSine", triangle: "instTriangle", square: "instSquare", saw: "instSaw", pluck: "instPluck", marimba: "instMarimba", chip: "instChip" };
const SCALE_LABELS: Record<ScaleId, string> = { chromatic: "scaleChromatic", major: "scaleMajor", minor: "scaleMinor", pentatonic: "scalePentatonic", blues: "scaleBlues", wholeTone: "scaleWholeTone" };

/** Which searchable controls belong to which section (used by the search box). */
const SECTION_KEYS: Record<ControlSection, string[]> = {
  ball: ["ballSpeed", "ballSize", "gravity", "ballColor", "twoBalls", ...BALL_INTERACTION_KEYS, ...BALL_DROP_KEYS, ...BOX_ARENA_KEYS, ...PENDULUM_WAVE_KEYS, ...COLLISION_PLAYGROUND_KEYS, "bouncier", "ballEmoji", "customBallImage", ...BALL_PHYSICS_EXTRA_KEYS, ...CHARACTER_KEYS],
  wall: ["wallCount", "wallThickness", "gapSize", "rotation", "wallColor", ...WALL_PHYSICS_EXTRA_KEYS],
  visual: [...THEME_KEYS, "trails", "colorTrail", "cameraFollow", "cinematic", "trailThickness", "wallBreakEffect", ...PICTURE_PAINT_KEYS],
  sound: ["hitSoundMode", "instrument", ...HIT_SAMPLE_KEYS, "song", "melodyInstrument", "importMidi", "scale", "rootNote", "beatLock", "quantizeGrid", ...SONG_SLICER_KEYS, ...MUSIC_BED_KEYS, "wallBreakSound", "importWallBreak"],
  recording: ["videoResolution", "videoDuration", "customWatermark", "topText", "bottomText", "textSize"],
  teams: TEAM_KEYS, // --- teams ---
  obstacles: OBSTACLE_KEYS, // --- obstacle-editor ---
  captions: CAPTION_KEYS, // --- captions ---
  timeline: TIMELINE_SECTION_KEYS, // --- timeline ---
  arenas: SPLIT_SCREEN_KEYS, // --- split-screen ---
};
SECTION_KEYS.ball.push("ballCount"); // --- teams --- the ball count slider (it replaced the "Two balls" switch)
// --- jdm-polyrhythm --- the Metronomes & Polyrhythms block is searched with the Ball section (like the Pendulum wave block).
SECTION_KEYS.ball.push(...POLYRHYTHM_KEYS);
// --- camera --- the Camera group (zoom, shake, slow motion, replay) is part of the Visual section.
SECTION_KEYS.visual.push(...CAMERA_KEYS);
// --- gerald-glass --- the Glass block is searched with the Ball section too.
SECTION_KEYS.ball.push(...GLASS_KEYS);
// --- gerald-multipliers --- the Multipliers group of the Ball section and the multipliers-board block of the Mode row.
SECTION_KEYS.ball.push(...MULTIPLIER_KEYS, ...MULTIPLIERS_MODE_KEYS);
// --- rigged --- the Rigged Outcomes group (never escape, forced winner) sits under the Drama Director in the Visual section.
SECTION_KEYS.visual.push(...RIGGED_KEYS);
// --- jdm-double-pendulum --- the "Double pendulum" block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...DOUBLE_PENDULUM_KEYS);
// --- jdm-illusions --- the Circle Illusion block is searched with the Ball section, Wobbly Walls with the Visual section.
SECTION_KEYS.ball.push(...ILLUSION_KEYS);
SECTION_KEYS.visual.push(...WALL_WOBBLE_KEYS);
// --- gerald-exit-splat --- the Exit behaviour block closes the Wall section, the Splat barrier block follows Wobbly Walls in the Visual section.
SECTION_KEYS.wall.push(...EXIT_BEHAVIOR_KEYS);
SECTION_KEYS.visual.push(...SPLAT_BARRIER_KEYS);
// --- odd-string-battle --- the String Battle block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...STRING_BATTLE_KEYS);
// --- odd-power-layers --- the Power layers block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...POWER_LAYERS_KEYS);
SECTION_KEYS.recording.push(...FAST_EXPORT_KEYS); // --- fast-render --- the fast export's frame rate
// --- jdm-race --- the "Race" block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...RACE_KEYS);
// --- jdm-arena-games --- the Arena games block is searched with the Ball section.
SECTION_KEYS.ball.push(...ARENA_GAME_KEYS);
// --- batch-render --- the Batch block (many fast exports in a row) closes the Recording section.
SECTION_KEYS.recording.push(...BATCH_KEYS);
// --- jdm-rhythm-runner --- the Beat runner and Paddle keep-up blocks are searched with the Ball section.
SECTION_KEYS.ball.push(...JDM_RHYTHM_KEYS);
// --- gerald-vortex --- the Vortex block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...VORTEX_KEYS);
// --- video-beats --- the "Beats from a video" block (source picker, import, markers, On beat) closes the music part of the Sound section.
SECTION_KEYS.sound.push(...VIDEO_BEATS_KEYS);
// --- viral-bot --- the Viral video bot block comes after the Batch block in the Recording section.
SECTION_KEYS.recording.push(...BOT_KEYS);
// --- gerald-journey --- the Journey block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...JOURNEY_KEYS);
// --- gerald-bullseye --- the Bullseye block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...BULLSEYE_KEYS);
// --- merge-ring --- the Merge Ring block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...MERGE_RING_KEYS);
// --- spiral-glass --- the Spiral Glass block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...SPIRAL_GLASS_KEYS);
// --- song-ring --- the Song Ring block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...SONG_RING_KEYS);
// --- sand-plate --- the Sand Plate block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...SAND_PLATE_KEYS);
// --- blueprint --- the Mode Lab block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...BLUEPRINT_KEYS);
// --- beat-drop --- the Beat Drop block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...BEAT_DROP_KEYS);
// --- odd-territory --- the Territory block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...TERRITORY_KEYS);
// --- odd-maze --- the Maze block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...MAZE_KEYS);
// --- gerald-conveyor --- the Conveyor block of the Mode row is searched with the Ball section too, where the respawn timer
// of Classic and Multiply lives.
SECTION_KEYS.ball.push(...CONVEYOR_KEYS, ...RESPAWN_KEYS);
// --- orb-grid --- the Bouncing Orbs block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...ORB_GRID_KEYS);
SECTION_KEYS.ball.push(...ELLIPSE_FOCI_KEYS); // --- ellipse-foci --- the Focus Shot block of the Mode row
SECTION_KEYS.ball.push(...BEAT_MACHINE_KEYS); // --- beat-machine --- the Beat Machines block of the Mode row
SECTION_KEYS.ball.push(...WAVE_TANK_KEYS); // --- wave-tank --- the Wave Tank block of the Mode row
SECTION_KEYS.ball.push(...BRICK_REBUILD_KEYS); // --- brick-rebuild --- the Brick Smash block of the Mode row
SECTION_KEYS.ball.push(...DRAWING_MACHINE_KEYS); // --- drawing-machine --- the Drawing Machines block of the Mode row
SECTION_KEYS.ball.push(...PERFECT_FIT_KEYS); // --- perfect-fit --- the Perfect Fit block of the Mode row
// --- fight-league --- the Fight League block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...FIGHT_LEAGUE_KEYS);
// --- land-claim --- the Land Claim block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...LAND_CLAIM_KEYS);
// --- colour-sort --- the Colour Sort block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...COLOUR_SORT_KEYS);
// --- chord-stars --- the Chord Stars block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...STAR_CHORDS_KEYS);
SECTION_KEYS.ball.push(...HOOPS_KEYS); // --- bead-hoops ---
SECTION_KEYS.wall.push(...RING_ESCAPE_KEYS); // --- ring-escape --- Classic's gap layout, spin, rainbow, time in ring and ring sounds (the Wall section)
// --- unlimited --- the No limits switch opens the Ball & Physics section
SECTION_KEYS.ball.push(...UNLIMITED_KEYS);
// --- bounce-math --- the Bounce math block (rules on every bounce, pass, collision, break, beat, bar or second) is part of the Ball & Physics section.
SECTION_KEYS.ball.push(...BOUNCE_MATH_KEYS);
// --- social-publish --- the Publish block (TikTok, Instagram, YouTube) closes the Recording section, after the Viral video bot block.
SECTION_KEYS.recording.push(...PUBLISH_KEYS);
SECTION_KEYS.recording.push(...LOOP_KEYS); // --- loop-foundation --- Export whole loops and the loop HUD
SECTION_KEYS.sound.push(...LOOP_CLIP_KEYS); // --- loop-foundation --- the loop families' clip slots

// --- panel-basics --- Show Advanced Options: what each group shows only with the switch on, and how many of them a group
// holds right now (the quiet row at the end of the group says it and turns the switch on).
/** The groups that hold controls behind the switch. */
export type AdvancedGroup = "ball" | "wall" | "visual" | "sound" | "recording";
/**
 * The search keys of the controls a group shows only with Show Advanced Options on. The panel's own gates read this table
 * (shows() in Controls()); the Sound group's blocks gate their own (`showAdvanced`) and list theirs next to their keys.
 * Gravity, the top text and the bottom text are basics: never behind the switch. tests/panelBasics.test.ts keeps it true.
 */
export const ADVANCED_KEYS: Readonly<Record<AdvancedGroup, readonly string[]>> = {
  ball: ["fullBallLimit", "bouncier", "customBallImage", ...BALL_PHYSICS_EXTRA_KEYS],
  wall: ["wallThickness", "gapSize", ...WALL_PHYSICS_EXTRA_KEYS],
  visual: ["cinematic", ...RIGGED_KEYS.filter((key) => key !== "riggedGroup" /* (its heading) */), "trailThickness"],
  sound: ["importMidi", ...SONG_SLICER_ADVANCED_KEYS, ...MUSIC_ADVANCED_KEYS, ...VIDEO_BEATS_ADVANCED_KEYS, "importWallBreak"],
  recording: ["customWatermark", "textSize"],
};
const ADVANCED_KEY_SET: ReadonlySet<string> = new Set(Object.values(ADVANCED_KEYS).flat());

/** What besides PanelShown decides whether a control behind the switch would show. */
export interface AdvancedShown {
  /** The bounces play tones (Import MIDI). */
  tones: boolean;
  /** A music track is loaded (its release and start offset). */
  musicTrack: boolean;
  /** On beat is on (its range). */
  onBeat: boolean;
  /** The walls breathe (their speed). */
  breathing: boolean;
}

/** How many controls of a group Show Advanced Options would add right now (0: no row). */
export function advancedCount(group: ControlSection, p: PanelShown, x: AdvancedShown): number {
  if (!(group in ADVANCED_KEYS)) return 0;
  const multipliers = showsMultipliersSection(p.mode, p.glassGates);
  return ADVANCED_KEYS[group as AdvancedGroup].filter((key) => {
    if (!sectionKeyShown(key, p, multipliers)) return false;
    if (key === "importMidi") return x.tones;
    if ((MUSIC_ADVANCED_KEYS as readonly string[]).includes(key)) return x.musicTrack;
    if ((VIDEO_BEATS_ADVANCED_KEYS as readonly string[]).includes(key)) return p.videoBeats && x.onBeat;
    if (key === "breathingSpeed") return x.breathing;
    return true;
  }).length;
}

/** --- panel-basics --- The Recording group's blocks that open from a named row, and their keys (the palette opens them). */
const FOLD_ROWS = { batch: BATCH_KEYS, bot: BOT_KEYS, publish: PUBLISH_KEYS } as const;
type FoldRowId = keyof typeof FOLD_ROWS;
const foldRowOf = (key: string): FoldRowId | null => (Object.keys(FOLD_ROWS) as FoldRowId[]).find((id) => (FOLD_ROWS[id] as readonly string[]).includes(key)) ?? null;

/**
 * --- review fix (site-redesign) --- The command palette's controls, group by group, for this panel state: the mode's own
 * block under the Mode group, then the rail's sections (`sectionIds`, in rail order) without the other modes' blocks and
 * without the controls the mode or a setting leaves out (panelKeys.ts), and the Project file block's under Saved Presets.
 */
export function paletteKeyGroups(p: PanelShown, sectionIds: readonly ControlSection[], project: boolean): { section: StudioSection; keys: readonly string[] }[] {
  const multipliers = showsMultipliersSection(p.mode, p.glassGates);
  const groups: { section: StudioSection; keys: readonly string[] }[] = [{ section: "mode", keys: MODE_BLOCK_KEYS[p.mode] ?? [] }];
  for (const id of sectionIds) groups.push({ section: id, keys: SECTION_KEYS[id].filter((key) => sectionKeyShown(key, p, multipliers)) });
  if (project) groups.push({ section: "presets", keys: PROJECT_KEYS });
  return groups;
}

// --- review fix (studio-fit) --- The canvas measures its bitmap from its on-screen box on a window resize (the address bar
// of a phone's browser coming and going is one). With the stage scaled down above the open sheet that box is the scaled one:
// the bitmap would shrink for good, and a recording with it. For that resize the frame is drawn at its full size, and the
// scale comes back before the next paint, without its transition. The listener is added when this module loads, before
// the canvas adds its own: a window's resize listeners run in the order they were added.
let scaledStudio: HTMLElement | null = null;
let settleFrame = 0;
function unscaleForResize(): void {
  const root = scaledStudio;
  if (!root) return;
  root.setAttribute("data-stage-measure", "");
  cancelAnimationFrame(settleFrame);
  settleFrame = requestAnimationFrame(() => {
    root.setAttribute("data-stage-measure", "settle");
    void root.querySelector<HTMLElement>(".stage-frame")?.offsetWidth;
    root.removeAttribute("data-stage-measure");
  });
}
if (typeof window !== "undefined") window.addEventListener("resize", unscaleForResize, { capture: true });

export default function Controls(props: ControlsProps) {
  const { settings: s, update } = props;
  const t = useTranslations("Controls");
  // --- site-redesign --- the rail opens blocks in the panel the way the old panel's headers did: the Mode block (open at
  // first) and Saved Presets toggle on their own, and one of the other groups is open at a time below the Mode block; a
  // press on an open item closes it. On phones the panel is a bottom sheet.
  const [modeOpen, setModeOpen] = useState(true);
  const [section, setSection] = useState<ControlSection | null>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const scrollTo = useRef<StudioSection | null>(null);
  const [scrollTick, setScrollTick] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * A control the palette jumped to, until it is focused: its label and search key, the id of its block and of its section's
   * search results (null: anywhere among them), and whether the search box was tried.
   */
  const pendingFocus = useRef<{ label: string; key: string; block: string; results: string | null; searched: boolean } | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const phone = useMediaQuery("(max-width: 767.98px)");
  const railColumn = useMediaQuery("(min-width: 1280px)"); // --- site-nav --- the rail is a column from 1280 px (globals.css): its toolbar says so
  const mod = useModifierKey();
  const site = useTranslations("SiteRedesign");
  const howItWorks = useTranslations("HowItWorks"); // --- panel-basics --- (the starter block's steps)
  const customContent = useTranslations("CustomContent"); // --- panel-basics --- (Undo)
  const locale = useLocale(); // --- mode-search --- (the language of a mode's search words)
  const [presetName, setPresetName] = useState("");
  const [midiDrag, setMidiDrag] = useState(false);
  const [wallBreakDrag, setWallBreakDrag] = useState(false);
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  // --- panel-basics --- the starter block (open unless the visitor closed it, or Show Advanced Options is on), the open
  // named rows of the Recording group, and the address of the last visit on offer (a bare studio address only)
  const [starterPref, setStarterPref] = useState<boolean | null>(null);
  const [rows, setRows] = useState<Record<FoldRowId, boolean>>({ batch: false, bot: false, publish: false });
  const [lastVisit, setLastVisit] = useState<string | null>(null);

  useEffect(() => {
    try {
      migrateLegacyStorage();
      if (localStorage.getItem(ADVANCED_STORAGE_KEY) === "true") setAdvanced(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setAdvancedPersist = (value: boolean) => {
    setAdvanced(value);
    try {
      localStorage.setItem(ADVANCED_STORAGE_KEY, String(value));
    } catch {
      /* ignore */
    }
  };

  // --- panel-basics --- the starter block's open state is a per-visitor convenience (read after mounting: the first render
  // matches the page's HTML)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STARTER_STORAGE_KEY);
      if (stored === "open" || stored === "closed") setStarterPref(stored === "open");
    } catch {
      /* ignore */
    }
  }, []);
  const starterOpen = starterPref ?? !advanced;
  const setStarterOpen = (open: boolean) => {
    setStarterPref(open);
    try {
      localStorage.setItem(STARTER_STORAGE_KEY, open ? "open" : "closed");
    } catch {
      /* ignore */
    }
  };

  // --- colour-sort --- the Colour Sort block's labels live in their own namespace: the search and the palette read them there too
  const colourSortT = useTranslations("ColourSort");
  const beatMachineT = useTranslations("BeatMachine"); // --- beat-machine --- (its block's labels live in their own namespace too)
  const brickRebuildT = useTranslations("BrickRebuild"); // --- brick-rebuild --- (its block's labels live in their own namespace too)
  const vortexT = useTranslations("Vortex"); // --- funnel-spin --- (the ring release's and the perspective's labels live under Vortex)
  const drawingMachineT = useTranslations("DrawingMachine"); // --- drawing-machine --- (its block's labels live in their own namespace too)
  const perfectFitT = useTranslations("PerfectFit"); // --- perfect-fit --- (its block's labels live in their own namespace too)
  const waveTankT = useTranslations("WaveTank"); // --- wave-tank --- (its block's labels live in their own namespace too)
  const matches = (key: string) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const label = t.has(key) ? t(key) : colourSortT.has(key) ? colourSortT(key) : beatMachineT.has(key) ? beatMachineT(key) /* --- beat-machine --- */ : vortexT.has(key) ? vortexT(key) /* --- funnel-spin --- */ : brickRebuildT.has(key) ? brickRebuildT(key) /* --- brick-rebuild --- */ : perfectFitT.has(key) ? perfectFitT(key) /* --- perfect-fit --- */ : waveTankT.has(key) ? waveTankT(key) /* --- wave-tank --- */ : drawingMachineT.has(key) ? drawingMachineT(key) /* --- drawing-machine --- */ : "";
    // --- panel-basics --- and the words a visitor types for it ("colour", "length", "hook", "logo": panelKeys.ts)
    return key.toLowerCase().includes(q) || label.toLowerCase().includes(q) || settingSearchWords(key, locale).split(" ").some((word) => !!word && word.includes(q));
  };
  const sectionMatches = (keys: string[]) => !search || keys.some(matches);
  const showAdvanced = advanced || !!search;
  /** --- panel-basics --- Whether the control with this key shows: a basic one always, one behind the switch with it on (ADVANCED_KEYS). */
  const shows = (key: string) => showAdvanced || !ADVANCED_KEY_SET.has(key);

  const modeNames: Record<ModeId, string> = {
    classic: t("modeClassic"),
    accumulation: t("modeAccumulation"),
    multiply: t("modeMultiply"),
    lines: t("modeLines"),
    paint: t("modePaint"),
    target: t("modeTarget"),
    portal: t("modePortal"),
    shatter: t("modeShatter"),
    colorMatch: t("modeColorMatch"),
    grow: t("modeGrow"),
    drop: t("modeDrop"),
    box: t("modeBox"),
    pendulum: t("modePendulum"),
    ellipseFoci: t("modeEllipseFoci"), // --- ellipse-foci ---
    beatMachine: t("modeBeatMachine"), // --- beat-machine ---
    waveTank: t("modeWaveTank"), // --- wave-tank ---
    brickRebuild: t("modeBrickRebuild"), // --- brick-rebuild ---
    drawingMachine: t("modeDrawingMachine"), // --- drawing-machine ---
    perfectFit: t("modePerfectFit"), // --- perfect-fit ---
    polyrhythm: t("modePolyrhythm"), // --- jdm-polyrhythm ---
    // --- jdm-collisions ---
    collide: t("modeCollide"),
    // --- gerald-glass ---
    glass: t("modeGlass"),
    // --- gerald-multipliers ---
    multipliers: t("modeMultipliers"),
    // --- jdm-double-pendulum ---
    doublePendulum: t("modeDoublePendulum"),
    // --- jdm-illusions ---
    illusion: t("modeIllusion"),
    // --- odd-string-battle ---
    stringBattle: t("modeStringBattle"),
    // --- odd-power-layers ---
    powerLayers: t("modePowerLayers"),
    // --- jdm-race ---
    race: t("modeRace"),
    // --- jdm-arena-games ---
    battle: t("modeBattle"),
    ctf: t("modeCtf"),
    // --- jdm-rhythm-runner ---
    runner: t("modeRunner"),
    paddle: t("modePaddle"),
    // --- gerald-vortex ---
    vortex: t("modeVortex"),
    // --- gerald-journey ---
    journey: t("modeJourney"),
    // --- gerald-bullseye ---
    bullseye: t("modeBullseye"),
    // --- merge-ring ---
    mergeRing: t("modeMergeRing"),
    // --- spiral-glass ---
    spiralGlass: t("modeSpiralGlass"),
    // --- song-ring ---
    songRing: t("modeSongRing"),
    // --- sand-plate ---
    sandPlate: t("modeSandPlate"),
    // --- blueprint ---
    blueprint: t("modeBlueprint"),
    // --- beat-drop ---
    beatDrop: t("modeBeatDrop"),
    // --- odd-territory ---
    territory: t("modeTerritory"),
    // --- odd-maze ---
    maze: t("modeMaze"),
    // --- gerald-conveyor ---
    conveyor: t("modeConveyor"),
    // --- orb-grid ---
    orbGrid: t("modeOrbGrid"),
    // --- fight-league ---
    fightLeague: t("modeFightLeague"),
    // --- land-claim ---
    landClaim: t("modeLandClaim"),
    // --- colour-sort ---
    colourSort: t("modeColourSort"),
    // --- chord-stars ---
    starChords: t("modeStarChords"),
    // --- bead-hoops ---
    hoops: t("modeHoops"),
  };

  // --- site-redesign --- the rail's groups, with their icons (the Recording group moved after the Arenas, before the presets)
  const sections: { id: ControlSection; icon: ReactNode; label: string }[] = [
    { id: "ball", icon: <IconBall />, label: t("ballPhysicsTab") },
    { id: "wall", icon: <IconRings />, label: t("wallSettingsTab") },
    { id: "visual", icon: <IconSparkle />, label: t("visualEffectsTab") },
    { id: "sound", icon: <IconWave />, label: t("customSoundTab") },
    { id: "teams", icon: <IconUsers />, label: t("teamsTab") }, // --- teams ---
  ];
  // --- obstacle-editor --- the Obstacles section, in the ring modes (the layout is kept, unused, in the others)
  if (supportsObstacles(s.mode)) sections.push({ id: "obstacles", icon: <IconObstacle />, label: t("obstaclesTab") });
  sections.push({ id: "captions", icon: <IconCaptions />, label: t("captionsTab") }); // --- captions --- (every mode, after the playfield sections)
  sections.push({ id: "timeline", icon: <IconKeyframes />, label: t("timelineTab") }); // --- timeline --- (every mode)
  sections.push({ id: "arenas", icon: <IconSplit />, label: t("splitTab") }); // --- split-screen --- (every mode)
  sections.push({ id: "recording", icon: <IconVideo />, label: t("recordingTab") });

  /* ------------------------------------------------------------ sections */

  // --- panel-basics --- the controls the starter block shares with their home groups: the same labels and keys, so the
  // search and the palette find each in its group (the starter block shows only while no group is open). `id` prefixes
  // the fields' ids.
  const ballColorControl = () =>
    !props.ballImage &&
    !props.ballEmoji &&
    ballControlsOf(s.mode).color && (
      <Searchable search={search} matches={matches} labelKey="ballColor">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink-2">{t("ballColor")}</span>
            <button
              type="button"
              onClick={() => update({ rainbowBall: !s.rainbowBall })}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowBall ? rainbowBtn : offBtn}`}
            >
              {t("rainbowSettings")}
            </button>
          </div>
          {!s.rainbowBall && <ColorPicker value={s.ballColor} onChange={(v) => update({ ballColor: v })} label={t("ballColor")} />}
        </div>
      </Searchable>
    );
  const ballSpeedControl = () => ballControlsOf(s.mode).speed && <Slider t={t} search={search} matches={matches} labelKey="ballSpeed" tipKey="ballSpeedTip" value={s.ballSpeed} range={RANGES.ballSpeed} onChange={(v) => update({ ballSpeed: v })} />;
  const ballSizeControl = () => ballControlsOf(s.mode).size && <Slider t={t} search={search} matches={matches} labelKey="ballSize" tipKey="ballSizeTip" value={s.ballRadius} range={RANGES.ballRadius} onChange={(v) => update({ ballRadius: v })} display={`${s.ballRadius}px`} />;
  const durationControl = () =>
    !props.simulationFound && (
      <Searchable search={search} matches={matches} labelKey="videoDuration">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2 flex items-center justify-between">
            <span>
              {t("durationSpan")}
              <Tooltip text={t("durationTip")} />
            </span>
            <span className="text-ink-3">{s.recordingDuration}s</span>
          </label>
          <div className="flex items-center gap-2">
            <SliderTrack settingKey="recordingDuration" label={t("durationSpan")} value={s.recordingDuration} range={RANGES.recordingDuration} onChange={(v) => update({ recordingDuration: v })} disabled={props.isRecording} /* --- unlimited-sizes --- */ />
            <NumberField value={s.recordingDuration} onCommit={(v) => update({ recordingDuration: v })} label={t("durationSpan")} range={RANGES.recordingDuration} rules={rulesForRange(RANGES.recordingDuration, "recordingDuration")} disabled={props.isRecording} settingKey="recordingDuration" /* --- uncap-all --- (--- unlimited-sizes --- any length above 0) */ />
          </div>
          <TrackEnds settingKey="recordingDuration" range={RANGES.recordingDuration} min={t("minDuration")} max={t("maxDuration")} tip={t("comfortMarkTip")} /* --- unlimited-sizes --- (120s: a comfort mark on the wide track) */ />
        </div>
      </Searchable>
    );
  const bannerTextControl = (key: "topText" | "bottomText", id = "") => {
    const [tip, placeholder, value] = key === "topText" ? (["topTextTip", "topTextPlaceholder", s.topText] as const) : (["bottomTextTip", "bottomTextPlaceholder", s.bottomText] as const);
    return (
      <Searchable key={key} search={search} matches={matches} labelKey={key}>
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2 flex items-center justify-between" htmlFor={`${id}${key}-input`}>
            <span>
              {t(key)}
              <Tooltip text={t(tip)} />
            </span>
            {value && <span className="text-ink-3 text-xs truncate max-w-[120px]">{value}</span>}
          </label>
          <input
            id={`${id}${key}-input`}
            type="text"
            value={value}
            onChange={(e) => update(key === "topText" ? { topText: e.target.value } : { bottomText: e.target.value })}
            placeholder={t(placeholder)}
            maxLength={60}
            className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
          />
        </div>
      </Searchable>
    );
  };

  /** Picture Paint block: in the Mode row while Paint is the mode, and in the Visual section while the search box is in use. */
  const picturePaintSection = () => (
    <PicturePaintSection t={t} search={search} matches={matches} showAdvanced={showAdvanced} settings={s} update={update} picture={props.paintPicture} onUpload={props.onPaintPictureUpload} onRemove={props.onPaintPictureRemove} beat={props.paintBeat} />
  );

  const ballSection = () => (
    <div className="space-y-4">
      {/* --- panel-basics --- the four a visitor changes first (speed, size, colour, count), then gravity (a basic: never
          behind the switch), then the long editors. --- low-findings-2 --- a mode whose balls are its own (Colour Sort)
          leaves out the page's speed, size and colour (panelKeys.ts ballControlsOf()) */}
      {ballSpeedControl()}
      {ballSizeControl()}
      {ballColorControl()}
      {/* --- teams --- the ball count (1–6) replaced the "Two balls" switch; Color Match takes several balls too */}
      {MULTI_BALL_MODES.includes(s.mode) && <BallCountControl t={t} search={search} matches={matches} settings={s} update={update} />}
      {ballControlsOf(s.mode).gravity /* --- review fix (blueprint) --- (Mode Lab's gravity is the Blueprint's) */ && (
        <Slider t={t} search={search} matches={matches} labelKey="gravity" tipKey="gravityTip" value={s.gravity} range={RANGES.gravity} onChange={(v) => update({ gravity: v })} />
      )}
      {/* --- unlimited --- the No limits switch (every numeric setting past its slider range) */}
      <UnlimitedSection t={t} search={search} matches={matches} settings={s} update={update} />
      {shows("fullBallLimit") && <FullBallLimitControl t={t} search={search} matches={matches} settings={s} update={update} /* --- unlimited-sizes --- (an advanced option) */ />}
      {/* --- gerald-faces --- the "Character" group: face, name label, squash, Gerald persona */}
      <CharacterSection t={t} search={search} matches={matches} settings={s} update={update} ballImage={props.ballImage} ballEmoji={props.ballEmoji} />
      {/* --- gerald-conveyor --- the respawn timer of Classic and Multiply (a new ball drops in every N seconds) */}
      <RespawnControl t={t} search={search} matches={matches} settings={s} update={update} />
      {/* --- unlimited-sizes --- the swarm's ceiling, in every mode the escapes, the respawns or bounce math's copies add balls in */}
      <SwarmLimitControl t={t} search={search} matches={matches} settings={s} update={update} />
      {TWO_BALL_MODES.includes(s.mode) && <BallInteractionSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* The Ball Drop controls live in the Mode row; while searching only the sections render, so they show up here. */}
      {s.mode === "drop" && !!search && <BallDropSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- review fix (ui-i18n) --- the Mode-row controls of the six escape modes (spikes, targets, colours, growth…) */}
      {ESCAPE_MODE_KEYS_BY_MODE[s.mode] && !!search && <EscapeModeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "box" && !!search && <BoxArenaSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "pendulum" && !!search && <PendulumWaveSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "ellipseFoci" && !!search && <EllipseFociSection t={t} search={search} matches={matches} settings={s} update={update} /> /* --- ellipse-foci --- */}
      {s.mode === "beatMachine" && !!search && <BeatMachineSection t={t} search={search} matches={matches} settings={s} update={update} /> /* --- beat-machine --- */}
      {s.mode === "waveTank" && !!search && <WaveTankSection t={t} search={search} matches={matches} settings={s} update={update} /> /* --- wave-tank --- */}
      {s.mode === "brickRebuild" && !!search && <BrickRebuildSection t={t} search={search} matches={matches} settings={s} update={update} /> /* --- brick-rebuild --- */}
      {s.mode === "drawingMachine" && !!search && <DrawingMachineSection t={t} search={search} matches={matches} settings={s} update={update} /> /* --- drawing-machine --- */}
      {s.mode === "perfectFit" && !!search && <PerfectFitSection t={t} search={search} matches={matches} settings={s} update={update} /> /* --- perfect-fit --- */}
      {s.mode === "polyrhythm" && !!search && <PolyrhythmSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-collisions --- */}
      {s.mode === "collide" && !!search && <CollisionPlaygroundSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-glass --- */}
      {s.mode === "glass" && !!search && <GlassSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-multipliers --- pickups, cap and smash threshold; the board block while searching */}
      {s.mode === "multipliers" && !!search && <MultipliersModeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-double-pendulum --- */}
      {s.mode === "doublePendulum" && !!search && <DoublePendulumSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-illusions --- */}
      {s.mode === "illusion" && !!search && <IllusionSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- odd-string-battle --- */}
      {s.mode === "stringBattle" && !!search && <StringBattleSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- odd-power-layers --- */}
      {s.mode === "powerLayers" && !!search && <PowerLayersSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-race --- */}
      {s.mode === "race" && !!search && <RaceSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-arena-games --- */}
      {isArenaGameMode(s.mode) && !!search && <ArenaGamesSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-rhythm-runner --- */}
      {s.mode === "runner" && !!search && <RunnerSection t={t} search={search} matches={matches} settings={s} update={update} beat={props.paintBeat} />}
      {s.mode === "paddle" && !!search && <PaddleSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-vortex --- */}
      {s.mode === "vortex" && !!search && <VortexSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-journey --- */}
      {s.mode === "journey" && !!search && <JourneySection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-bullseye --- */}
      {s.mode === "bullseye" && !!search && <BullseyeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- merge-ring --- */}
      {s.mode === "mergeRing" && !!search && <MergeRingSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- spiral-glass --- */}
      {s.mode === "spiralGlass" && !!search && <SpiralGlassSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- song-ring --- */}
      {s.mode === "songRing" && !!search && <SongRingSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- sand-plate --- */}
      {s.mode === "sandPlate" && !!search && <SandPlateSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- blueprint --- */}
      {s.mode === "blueprint" && !!search && <BlueprintSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- beat-drop --- */}
      {s.mode === "beatDrop" && !!search && <BeatDropSection t={t} search={search} matches={matches} settings={s} update={update} beat={props.paintBeat} beatSource={props.videoBeats?.effective} />}
      {/* --- odd-territory --- */}
      {s.mode === "territory" && !!search && <TerritorySection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- odd-maze --- */}
      {s.mode === "maze" && !!search && <MazeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-conveyor --- */}
      {s.mode === "conveyor" && !!search && <ConveyorSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- orb-grid --- */}
      {s.mode === "orbGrid" && !!search && <OrbGridSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- fight-league --- */}
      {s.mode === "fightLeague" && !!search && <FightLeagueSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- land-claim --- */}
      {s.mode === "landClaim" && !!search && <LandClaimSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- colour-sort --- */}
      {s.mode === "colourSort" && !!search && <ColourSortSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- chord-stars --- */}
      {s.mode === "starChords" && !!search && <StarChordsSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- bead-hoops --- */}
      {s.mode === "hoops" && !!search && <HoopsSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {(showsMultipliersSection(s.mode, s.glassGates) || !!search) && <MultipliersSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {shows("bouncier") && (
        // --- uncap-all --- the Bouncier switch is the numeric Bounciness now (1 = off, 1.03 = the old switch), uncapped
        <Slider t={t} search={search} matches={matches} labelKey="bouncier" tipKey="bouncierTip" value={s.bounciness} range={RANGES.bounciness} onChange={(v) => update(bouncinessPatch(v))} />
      )}
      {/* --- bounce-math --- the rule list, presets, Show values and the live readout (every mode; a parameter a mode ignores is marked) */}
      <BounceMathSection t={t} search={search} matches={matches} settings={s} update={update} panel={props.bounceMath} />
      <Searchable search={search} matches={matches} labelKey="ballEmoji">
        <div className="space-y-3">
          <label className="text-sm font-medium text-ink-2">{t("ballEmoji")}</label>
          <div className="grid grid-cols-6 gap-1.5">
            {EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => props.onBallEmojiChange(props.ballEmoji === emoji ? null : emoji)}
                aria-label={emoji}
                className={`flex items-center justify-center w-full aspect-square rounded-lg text-xl transition-all cursor-pointer ${
                  props.ballEmoji === emoji
                    ? `bg-accent/30 border-2 border-accent scale-110`
                    : "bg-surface-2 border border-line-strong hover:bg-surface-3 hover:border-ink-3"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          {props.ballEmoji && (
            <button type="button" onClick={() => props.onBallEmojiChange(null)} className="text-xs text-ink-3 hover:text-danger transition-colors cursor-pointer">
              {t("removeEmoji")}
            </button>
          )}
        </div>
      </Searchable>
      {shows("customBallImage") && (
        <Searchable search={search} matches={matches} labelKey="customBallImage">
          <div className="space-y-3">
            <label className="text-sm font-medium text-ink-2">{t("customBallImage")}</label>
            {props.ballImage ? (
              <div className="flex items-center justify-between mt-1">
                <div
                  className="flex-shrink-0 rounded-full"
                  style={{
                    width: 40,
                    height: 40,
                    backgroundImage: `url(${props.ballImage})`,
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    boxShadow: "0 0 8px rgba(6, 182, 212, 0.3), inset 0 -2px 4px rgba(0,0,0,0.4), inset 0 2px 4px rgba(255,255,255,0.15)",
                  }}
                />
                <button type="button" onClick={props.onBallImageClear} className="text-ink-3 hover:text-danger transition-colors text-sm cursor-pointer" title={t("removeCustomImage")}>
                  <IconClose size={14} />
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-sm cursor-pointer border border-dashed bg-surface-2 border-line-strong text-ink-2 hover:bg-surface-3 hover:border-ink-3">
                <span>{t("chooseImageFile")}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      props.onBallImageUpload(file);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
            )}
          </div>
        </Searchable>
      )}
      {shows(BALL_PHYSICS_EXTRA_KEYS[0]) && <BallPhysicsExtras t={t} search={search} matches={matches} settings={s} update={update} />}
    </div>
  );

  const wallSection = () => {
    // --- review fix (site-redesign) --- the mode rules live in panelKeys.ts (wallControlsOf()), shared with the command palette
    const walls = wallControlsOf(s.mode);
    const hasWallCount = walls.wallCount;
    const hasGapControls = walls.gapControls;
    const hasGapSize = walls.gapSize;
    const hasThickness = walls.thickness;
    return (
      <div className="space-y-4">
        {hasWallCount && (
          <Slider t={t} search={search} matches={matches} labelKey="wallCount" tipKey="wallCountTip" value={s.wallCount} range={RANGES.wallCount} onChange={(v) => update({ wallCount: v })} />
        )}
        {hasThickness && shows("wallThickness") && (
          <Slider t={t} search={search} matches={matches} labelKey="wallThickness" tipKey="wallThicknessTip" value={s.wallThickness} range={RANGES.wallThickness} onChange={(v) => update({ wallThickness: v })} display={`${s.wallThickness}px`} />
        )}
        {hasGapControls && (
          <>
            {hasGapSize && shows("gapSize") && (
              <Slider t={t} search={search} matches={matches} labelKey="gapSize" tipKey="gapSizeTip" value={s.gapSize} range={RANGES.gapSize} onChange={(v) => update({ gapSize: v })} display={s.gapSize.toFixed(2)} />
            )}
            <Searchable search={search} matches={matches} labelKey="rotation">
              <div className="space-y-2">
                <Toggle t={t} labelKey="rotation" tipKey="rotationTip" value={s.rotationEnabled} onChange={(v) => update({ rotationEnabled: v })} />
                {s.rotationEnabled && (
                  <>
                    <label className="text-sm font-medium text-ink-2 flex items-center justify-between mt-2">
                      <span>{t("rotationSpeed")}</span>
                      {/* --- timeline --- the live value with the AUTO badge while keyframes drive the rotation speed */}
                      <TimelineValueText t={t} labelKey="rotationSpeed" fallback={s.rotationSpeed.toFixed(1)} />
                    </label>
                    <TimelineRangeInput
                      labelKey="rotationSpeed"
                      value={s.rotationSpeed}
                      range={RANGES.rotationSpeed}
                      onChange={(v) => update({ rotationSpeed: v })}
                      className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer"
                      ariaLabel={t("rotationSpeed")}
                    />
                  </>
                )}
              </div>
            </Searchable>
          </>
        )}
        {/* --- gerald-exit-splat --- how the exits move: with their rings, jump, flee or shrink (the ring modes with one exit a ring) */}
        <ExitBehaviorControls t={t} search={search} matches={matches} settings={s} update={update} />
        {/* --- ring-escape --- Classic's ring generation: the gap layout and spiral step, the spin, the rainbow, the time in the ring, the ring sounds */}
        {s.mode === "classic" && <RingEscapeSection t={t} search={search} matches={matches} settings={s} update={update} />}
        <Searchable search={search} matches={matches} labelKey="wallColor">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-ink-2">{t("wallColor")}</span>
              <button
                type="button"
                onClick={() => update({ rainbowWalls: !s.rainbowWalls })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowWalls ? rainbowBtn : offBtn}`}
              >
                {t("rainbowSettings")}
              </button>
            </div>
            {s.rainbowWalls ? (
              <div className="flex gap-1 mt-1">
                {(["pulse", "gradient"] as const).map((mode) => (
                  <button
                    type="button"
                    key={mode}
                    onClick={() => update({ rainbowWallMode: mode })}
                    className={`flex-1 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowWallMode === mode ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                  >
                    {t(mode)}
                  </button>
                ))}
              </div>
            ) : (
              <ColorPicker value={s.circleColor} onChange={(v) => update({ circleColor: v })} label={t("wallColor")} />
            )}
          </div>
        </Searchable>
        {shows(WALL_PHYSICS_EXTRA_KEYS[0]) && <WallPhysicsExtras t={t} search={search} matches={matches} settings={s} update={update} />}
      </div>
    );
  };

  const visualSection = () => (
    <div className="space-y-4">
      {/* --- themes: theme cards, background, particle style and trail colours at the top of the Visual section */}
      <ThemeSection t={t} search={search} matches={matches} settings={s} update={update} image={props.themeImage} />
      <Searchable search={search} matches={matches} labelKey="trails">
        <div className="flex gap-2">
          {(
            [
              ["trails", "trailsTip", s.showTrails, () => update({ showTrails: !s.showTrails })],
              ["ballGlow", "ballGlowTip", s.showGlow, () => update({ showGlow: !s.showGlow })],
              ["wallGlow", "wallGlowTip", s.showWallGlow, () => update({ showWallGlow: !s.showWallGlow })],
            ] as const
          ).map(([key, tip, value, toggle]) => (
            <button
              type="button"
              key={key}
              onClick={toggle}
              aria-pressed={value}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all text-xs cursor-pointer ${value ? onBtn : offBtn}`}
            >
              {t(key)}
              <Tooltip text={t(tip)} />
            </button>
          ))}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="colorTrail">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => update({ colorTrail: !s.colorTrail })}
            aria-pressed={s.colorTrail}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all text-xs cursor-pointer ${s.colorTrail ? rainbowBtn : offBtn}`}
          >
            {t("colorTrail")}
            <Tooltip text={t("colorTrailTip")} />
          </button>
          <button
            type="button"
            onClick={() => update({ reactiveBackground: !s.reactiveBackground })}
            aria-pressed={s.reactiveBackground}
            className={`flex-1 px-4 py-2 rounded-lg font-medium transition-all text-xs cursor-pointer ${s.reactiveBackground ? onBtn : offBtn}`}
          >
            {t("reactiveBg")}
            <Tooltip text={t("reactiveBgTip")} />
          </button>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="cameraFollow">
        <button
          type="button"
          onClick={() => update({ cameraFollow: !s.cameraFollow })}
          aria-pressed={s.cameraFollow}
          className={`w-full px-4 py-2 rounded-lg font-medium transition-all text-xs cursor-pointer ${s.cameraFollow ? onBtn : offBtn}`}
        >
          {t("cameraFollow")}
          <Tooltip text={t("cameraFollowTip")} />
        </button>
      </Searchable>
      {/* --- camera --- the Camera group: zoom toward the ball, screen shake, slow motion on near misses, escape replay */}
      <CameraSection t={t} search={search} matches={matches} settings={s} update={update} />
      {/* --- jdm-illusions --- Wobbly Walls: circular walls deform where a ball hits them (ring modes, Circle Illusion) */}
      <WallWobbleSection t={t} search={search} matches={matches} settings={s} update={update} />
      {/* --- gerald-exit-splat --- the Splat barrier: wall hits leave solid splats of paint (ring modes) */}
      <SplatBarrierControls t={t} search={search} matches={matches} settings={s} update={update} />
      {shows("cinematic") && (
        <Searchable search={search} matches={matches} labelKey="cinematic">
          <Toggle t={t} labelKey="cinematic" tipKey="cinematicTip" value={s.cinematicEnabled} onChange={(v) => update({ cinematicEnabled: v })} caseStyle="title" />
        </Searchable>
      )}
      {/* --- rigged --- the director's hard constraints: never escape and the forced winner, with the storytelling warning */}
      {shows("neverEscape") && <RiggedSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* The Picture Paint controls live in the Mode row; while searching only the sections render, so they show up here. */}
      {s.mode === "paint" && !!search && picturePaintSection()}
      {s.showTrails && shows("trailThickness") && (
        <Slider t={t} search={search} matches={matches} labelKey="trailThickness" tipKey="trailThicknessTip" value={s.trailThickness} range={RANGES.trailThickness} onChange={(v) => update({ trailThickness: v })} display={`${s.trailThickness.toFixed(1)}x`} />
      )}
      <Searchable search={search} matches={matches} labelKey="wallBreakEffect">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2">
            {t("wallBreakEffect")}
            <Tooltip text={t("wallBreakEffectTip")} />
          </label>
          <div className="grid grid-cols-2 gap-1">
            {(
              [
                ["confetti", "effectConfetti"],
                ["shatter", "effectShatter"],
                ["shockwave", "effectShockwave"],
                ["all", "effectAll"],
                ["none", "effectNone"],
              ] as [WallBreakStyle, string][]
            ).map(([value, key]) => (
              <button
                type="button"
                key={value}
                onClick={() => update({ wallBreakStyle: value })}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.wallBreakStyle === value ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
    </div>
  );

  const soundSection = () => {
    // Controls that only apply in one bounce-sound mode (or with a scale / the beat lock on) are still rendered while
    // the search box is in use, so the search finds them whatever the current mode is.
    const showToneControls = s.hitSoundMode === "tones" || !!search;
    const showSampleControls = s.hitSoundMode === "sample" || !!search;
    return (
      <div className="space-y-4">
        <Searchable search={search} matches={matches} labelKey="hitSoundMode">
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-2">
              {t("hitSoundMode")}
              <Tooltip text={t("hitSoundModeTip")} />
            </label>
            <div className="flex gap-1" role="group" aria-label={t("hitSoundMode")}>
              {HIT_SOUND_MODES.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  onClick={() => update({ hitSoundMode: mode })}
                  aria-pressed={s.hitSoundMode === mode}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.hitSoundMode === mode ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                >
                  {mode === "tones" ? `${t("hitSoundModeTones")}` : `${t("hitSoundModeSample")}`}
                </button>
              ))}
            </div>
          </div>
        </Searchable>
        {showToneControls && (
          <Searchable search={search} matches={matches} labelKey="instrument">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-2" htmlFor="instrument-select">
                {t("instrument")}
              </label>
              <p className="text-xs text-ink-3 leading-relaxed">{t("instrumentDesc")}</p>
              <select id="instrument-select" value={s.instrument} onChange={(e) => update({ instrument: e.target.value as InstrumentId })} className={selectClass}>
                {INSTRUMENT_IDS.map((id) => (
                  <option key={id} value={id}>
                    {t(INSTRUMENT_LABELS[id])}
                  </option>
                ))}
              </select>
            </div>
          </Searchable>
        )}
        {showSampleControls && (
          <HitSampleSection t={t} search={search} matches={matches} settings={s} update={update} customHitSampleName={props.customHitSampleName} hitSampleStatus={props.hitSampleStatus} onUpload={props.onHitSampleUpload} />
        )}
        {showToneControls && (
          <>
            <Searchable search={search} matches={matches} labelKey="song">
              <div className="space-y-2">
                <label className="text-sm font-medium text-ink-2" htmlFor="song-select">
                  {t("song")}
                </label>
                <p className="text-xs text-ink-3 leading-relaxed">{t("customSoundDesc")}</p>
                <select
                  id="song-select"
                  value={props.customSoundId || ""}
                  onChange={(e) => props.onCustomSoundSelect(e.target.value || null)}
                  disabled={props.customSoundLoading}
                  className={`${selectClass} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <option value="">{t("defaultSong")}</option>
                  {props.customSoundId === "custom-upload" && (
                    <option value="custom-upload">
                      {props.customMidiName || t("uploadedMidi") /* --- review fix (ui-i18n) --- */} ({props.customSoundNoteCount} {t("notesLoaded")})
                    </option>
                  )}
                  {SONGS.map((song) => (
                    <option key={song.id} value={song.id}>
                      {song.name}
                    </option>
                  ))}
                </select>
              </div>
            </Searchable>
            {(props.customSoundId || search) && (
              <Searchable search={search} matches={matches} labelKey="melodyInstrument">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink-2" htmlFor="melody-instrument-select">
                    {t("melodyInstrument")}
                  </label>
                  <p className="text-xs text-ink-3 leading-relaxed">{t("melodyInstrumentDesc")}</p>
                  <select id="melody-instrument-select" value={s.melodyInstrument} onChange={(e) => update({ melodyInstrument: e.target.value as InstrumentId })} className={selectClass}>
                    {INSTRUMENT_IDS.map((id) => (
                      <option key={id} value={id}>
                        {t(INSTRUMENT_LABELS[id])}
                      </option>
                    ))}
                  </select>
                </div>
              </Searchable>
            )}
            {shows("importMidi") && (
              <Searchable search={search} matches={matches} labelKey="importMidi">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-ink-2">{t("importMidi")}</label>
                  <label
                    onDragOver={(e) => {
                      e.preventDefault();
                      setMidiDrag(true);
                    }}
                    onDragLeave={() => setMidiDrag(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setMidiDrag(false);
                      const file = e.dataTransfer.files?.[0];
                      if (file) props.onCustomMidiUpload(file);
                    }}
                    className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-xs cursor-pointer border border-dashed ${
                      midiDrag ? `bg-accent/10 border-accent text-accent scale-[1.02]` : "bg-surface-2 border-line-strong text-ink-2 hover:bg-surface-3 hover:border-ink-3"
                    }`}
                  >
                    <IconUpload size={20} className={midiDrag ? "text-accent" : "text-ink-3"} />
                    <span className="font-semibold">{midiDrag ? t("dropMidiHere") : t("chooseMidiFile")}</span>
                    <input
                      type="file"
                      accept=".mid,.midi,audio/midi,audio/x-midi"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          props.onCustomMidiUpload(file);
                          e.target.value = "";
                        }
                      }}
                    />
                  </label>
                  <p className="text-xs text-ink-3 mt-1 flex items-start gap-1">
                    <IconInfo size={14} className="mt-0.5 shrink-0" />
                    <span>
                      {t("midiSourceText")}{" "}
                      <a href="https://bitmidi.com" target="_blank" rel="noopener noreferrer" className={`text-accent hover:text-accent-strong underline font-medium`}>
                        bitmidi.com ↗
                      </a>
                    </span>
                  </p>
                </div>
              </Searchable>
            )}
            {props.customSoundLoading && (
              <div className="flex items-center gap-2 text-sm text-ink-2">
                <div className={`w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin`} />
                {t("loadingMidi")}
              </div>
            )}
          </>
        )}
        <Searchable search={search} matches={matches} labelKey="scale">
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-2" htmlFor="scale-select">
              {t("scale")}
            </label>
            <p className="text-xs text-ink-3 leading-relaxed">{t("scaleDesc")}</p>
            <select id="scale-select" value={s.scale} onChange={(e) => update({ scale: e.target.value as ScaleId })} className={selectClass}>
              {SCALE_IDS.map((id) => (
                <option key={id} value={id}>
                  {t(SCALE_LABELS[id])}
                </option>
              ))}
            </select>
          </div>
        </Searchable>
        {(s.scale !== "chromatic" || search) && (
          <Searchable search={search} matches={matches} labelKey="rootNote">
            <div className="space-y-2">
              <span id="root-note-label" className="text-sm font-medium text-ink-2">
                {t("rootNote")}
              </span>
              <div className="grid grid-cols-6 gap-1" role="group" aria-labelledby="root-note-label">
                {NOTE_NAMES.map((name, index) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() => update({ rootNote: index })}
                    aria-pressed={s.rootNote === index}
                    className={`px-1 py-1 rounded-md text-xs font-mono font-medium transition-all cursor-pointer ${s.rootNote === index ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
        )}
        <Searchable search={search} matches={matches} labelKey="beatLock">
          <div className="space-y-2">
            <Toggle t={t} labelKey="beatLock" tipKey="beatLockTip" value={s.quantizeToBeat} onChange={(v) => update({ quantizeToBeat: v })} />
            <p className="text-xs text-ink-3 leading-relaxed">{t("beatLockDesc")}</p>
            {s.quantizeToBeat && (
              <>
                <label className="text-sm font-medium text-ink-2 flex items-center justify-between mt-2">
                  <span>{t("bpm")}</span>
                  <span className="text-ink-3">{s.bpm}</span>
                </label>
                <div className="flex items-center gap-2">
                  <SliderTrack settingKey="bpm" label={t("bpm")} value={s.bpm} range={RANGES.bpm} onChange={(v) => update({ bpm: v })} /* --- unlimited-sizes --- */ />
                  <NumberField value={s.bpm} onCommit={(v) => update({ bpm: v })} label={t("bpm")} range={RANGES.bpm} rules={rulesForRange(RANGES.bpm)} settingKey="bpm" /* --- uncap-all --- */ />
                </div>
              </>
            )}
          </div>
        </Searchable>
        {(s.quantizeToBeat || search) && (
          <Searchable search={search} matches={matches} labelKey="quantizeGrid">
            <div className="flex items-center justify-between gap-2">
              <span id="quantize-grid-label" className="text-sm font-medium text-ink-2">
                {t("quantizeGrid")}
              </span>
              <div className="flex gap-1" role="group" aria-labelledby="quantize-grid-label">
                {QUANTIZE_GRIDS.map((grid) => (
                  <button
                    type="button"
                    key={grid}
                    onClick={() => update({ quantizeGrid: grid })}
                    aria-pressed={s.quantizeGrid === grid}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${s.quantizeGrid === grid ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                  >
                    {grid}
                  </button>
                ))}
              </div>
            </div>
          </Searchable>
        )}
        <SongSlicerSection
          t={t}
          search={search}
          matches={matches}
          showAdvanced={showAdvanced}
          settings={s}
          update={update}
          songName={props.sliceSongName}
          songDuration={props.sliceSongDuration}
          loading={props.sliceSongLoading}
          onUpload={props.onSliceSongUpload}
          onClear={props.onSliceSongClear}
        />
        <MusicSection
          t={t}
          search={search}
          matches={matches}
          showAdvanced={showAdvanced}
          settings={s}
          update={update}
          track={props.musicTrack}
          loading={props.musicLoading}
          playing={props.musicPlaying}
          getDuckGain={props.getMusicDuckGain}
          onUpload={props.onMusicUpload}
          onRemove={props.onMusicRemove}
        />
        {/* --- video-beats --- */}
        {props.videoBeats && <VideoBeatsSection t={t} search={search} matches={matches} showAdvanced={showAdvanced} settings={s} update={update} panel={props.videoBeats} />}
        {props.loopClips && <LoopClipsSection t={t} search={search} matches={matches} panel={props.loopClips} /> /* --- loop-foundation --- */}
        <Searchable search={search} matches={matches} labelKey="wallBreakSound">
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-2" htmlFor="wallbreak-select">
              {t("wallBreakSound")}
            </label>
            <p className="text-xs text-ink-3 leading-relaxed">{t("wallBreakSoundDesc")}</p>
            <select id="wallbreak-select" value={s.wallBreakSound || ""} onChange={(e) => update({ wallBreakSound: e.target.value || null })} className={selectClass}>
              {/* --- gerald-glass --- a mode with its own default clip (Glass Smash) names it */}
              <option value="">{MODE_WALL_BREAK_SOUNDS[s.mode] ? t("wallBreakSoundModeDefault", { name: WALL_BREAK_SOUNDS.find((snd) => snd.id === MODE_WALL_BREAK_SOUNDS[s.mode])?.name ?? "" }) : t("wallBreakSoundDefault")}</option>
              {WALL_BREAK_SOUNDS.map((snd) => (
                <option key={snd.id} value={snd.url}>
                  {snd.name}
                </option>
              ))}
              {s.wallBreakSound?.startsWith("blob:") && <option value={s.wallBreakSound}>{props.customWallBreakName || t("customWallBreak") /* --- review fix (ui-i18n) --- */}</option>}
            </select>
          </div>
        </Searchable>
        {shows("importWallBreak") && (
          <Searchable search={search} matches={matches} labelKey="importWallBreak">
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-2">{t("importWallBreak")}</label>
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setWallBreakDrag(true);
                }}
                onDragLeave={() => setWallBreakDrag(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setWallBreakDrag(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) props.onWallBreakSoundUpload(file);
                }}
                className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-xs cursor-pointer border border-dashed ${
                  wallBreakDrag ? `bg-accent/10 border-accent text-accent scale-[1.02]` : "bg-surface-2 border-line-strong text-ink-2 hover:bg-surface-3 hover:border-ink-3"
                }`}
              >
                <IconUpload size={20} className={wallBreakDrag ? "text-accent" : "text-ink-3"} />
                <span className="font-semibold">{wallBreakDrag ? t("dropWallBreakHere") : t("chooseWallBreakFile")}</span>
                <input
                  type="file"
                  accept=".mp3,.wav,.ogg,.aac,.m4a,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      props.onWallBreakSoundUpload(file);
                      e.target.value = "";
                    }
                  }}
                />
              </label>
            </div>
          </Searchable>
        )}
      </div>
    );
  };

  // --- panel-basics --- the Recording group fits one screen: the account row, the format, the clip length, the frame rate,
  // the loops, then Batch Render, the Clip planner and Publish as named rows that open on demand (the search shows them as
  // they are); the texts on the clip follow
  const foldRow = (id: FoldRowId, labelKey: string, body: ReactNode) =>
    search ? (
      body
    ) : (
      <FoldRow id={id} label={t(labelKey)} tip={t(`${labelKey}Tip`)} open={rows[id]} onToggle={() => setRows((r) => ({ ...r, [id]: !r[id] }))}>
        {body}
      </FoldRow>
    );
  const recordingSection = () => (
    <div className="space-y-3">
      {!search && <AccountRow /> /* --- paywall-gate --- */}
      <Searchable search={search} matches={matches} labelKey="videoResolution">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2" htmlFor="resolution-select">
            {t("resolutionTitle")}
          </label>
          <select
            id="resolution-select"
            value={s.recordingResolution}
            onChange={(e) => update({ recordingResolution: e.target.value })}
            disabled={props.isRecording}
            className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {RESOLUTIONS.map((r) => (
              <option key={r} value={r}>
                {r === "500x500" ? t("resolution500") : r === "1280x720" ? t("resolution720") : r === "1920x1080" ? t("resolution1080") : t("resolutionTikTok")}
              </option>
            ))}
          </select>
        </div>
      </Searchable>
      {durationControl()}
      {/* --- fast-render --- the fast export's frame rate */}
      <FastExportFpsControl t={t} search={search} matches={matches} settings={s} update={update} disabled={props.fastExport?.state.status === "running"} />
      <LoopSection t={t} search={search} matches={matches} settings={s} update={update} /> {/* --- loop-foundation --- */}
      {props.batch && foldRow("batch", "batchRender", <BatchSection t={t} search={search} matches={matches} batch={props.batch} />) /* --- batch-render --- */}
      {props.bot && foldRow("bot", "viralBot", <BotSection t={t} search={search} matches={matches} bot={props.bot} />) /* --- viral-bot --- */}
      {foldRow("publish", "publish", <PublishSection t={t} search={search} matches={matches} bot={props.bot} loopCaptionOf={loopCaptionContext(s) /* --- loop-foundation --- */} />) /* --- social-publish --- */}
      {/* --- panel-basics --- the top and bottom text are basics (the page's tip "Add a hook" points at the top one), after the
          rows so the group's first screen holds the format, the length and the three blocks; the starter block has the top
          text too */}
      {bannerTextControl("topText")}
      {bannerTextControl("bottomText")}
      {(s.topText || s.bottomText) && shows("textSize") && (
        <Searchable search={search} matches={matches} labelKey="textSize">
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-2 flex items-center justify-between">
              <span>
                {t("textSize")}
                <Tooltip text={t("textSizeTip")} />
              </span>
              <span className="text-ink-3">{s.textSize.toFixed(1)}×</span>
            </label>
            <div className="flex items-center gap-2">
              <SliderTrack settingKey="textSize" label={t("textSize")} value={s.textSize} range={RANGES.textSize} onChange={(v) => update({ textSize: v })} /* --- unlimited-sizes --- */ />
              <NumberField value={s.textSize} onCommit={(v) => update({ textSize: v })} label={t("textSize")} range={RANGES.textSize} rules={rulesForRange(RANGES.textSize)} settingKey="textSize" /* --- uncap-all --- */ />
            </div>
            <TrackEnds settingKey="textSize" range={RANGES.textSize} min={t("minSize")} max={t("maxSize")} tip={t("comfortMarkTip")} /* --- unlimited-sizes --- */ />
          </div>
        </Searchable>
      )}
      {shows("customWatermark") && (
        <Searchable search={search} matches={matches} labelKey="customWatermark">
          <div className="space-y-2 border-t border-line pt-3">
            <label className="text-sm font-medium text-ink-2 flex items-center justify-between" htmlFor="watermark-input">
              <span>
                {t("customWatermark")}
                <Tooltip text={t("watermarkTip")} />
              </span>
              {s.watermarkText && <span className="text-ink-3 text-xs truncate max-w-[120px]">{s.watermarkText}</span>}
            </label>
            <input
              id="watermark-input"
              type="text"
              value={s.watermarkText}
              onChange={(e) => update({ watermarkText: e.target.value })}
              placeholder={t("enterWatermark")}
              maxLength={50}
              className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
            />
          </div>
        </Searchable>
      )}
    </div>
  );

  const renderSection = (id: ControlSection) => {
    switch (id) {
      case "ball":
        return ballSection();
      case "wall":
        return wallSection();
      case "visual":
        return visualSection();
      case "sound":
        return soundSection();
      case "recording":
        return recordingSection();
      // --- teams ---
      case "teams":
        return <TeamsSection t={t} search={search} matches={matches} settings={s} update={update} onReset={props.onResetSection} />;
      // --- obstacle-editor ---
      case "obstacles":
        return <ObstaclesSection t={t} search={search} matches={matches} settings={s} update={update} onReset={props.onResetSection} />;
      // --- captions ---
      case "captions":
        return <CaptionsSection t={t} search={search} matches={matches} settings={s} update={update} onReset={props.onResetSection} />;
      // --- timeline ---
      case "timeline":
        return <TimelineSection t={t} search={search} matches={matches} settings={s} update={update} onReset={props.onResetSection} />;
      // --- split-screen ---
      case "arenas":
        return <ArenasSection t={t} search={search} matches={matches} settings={s} update={update} onReset={props.onResetSection} modeNames={modeNames} />;
    }
  };

  /* Mode-specific controls shown inside the Mode row. */
  const modeSpecific = () => {
    switch (s.mode) {
      // --- review fix (ui-i18n) --- the six escape modes' blocks live in EscapeModeSection (also rendered in the Ball section while searching)
      case "accumulation":
      case "multiply":
      case "lines":
      case "target":
      case "colorMatch":
      case "shatter": // --- shatter-demolition ---
      case "grow":
        return <EscapeModeSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "drop":
        return <BallDropSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "box":
        return <BoxArenaSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "pendulum":
        return <PendulumWaveSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "ellipseFoci": // --- ellipse-foci ---
        return <EllipseFociSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "beatMachine": // --- beat-machine ---
        return <BeatMachineSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "waveTank": // --- wave-tank ---
        return <WaveTankSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "brickRebuild": // --- brick-rebuild ---
        return <BrickRebuildSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "drawingMachine": // --- drawing-machine ---
        return <DrawingMachineSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "perfectFit": // --- perfect-fit ---
        return <PerfectFitSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "polyrhythm": // --- jdm-polyrhythm ---
        return <PolyrhythmSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- jdm-collisions ---
      case "collide":
        return <CollisionPlaygroundSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- gerald-glass ---
      case "glass":
        return <GlassSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- gerald-multipliers ---
      case "multipliers":
        return <MultipliersModeSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- jdm-double-pendulum ---
      case "doublePendulum":
        return <DoublePendulumSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- jdm-illusions ---
      case "illusion":
        return <IllusionSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- odd-string-battle ---
      case "stringBattle":
        return <StringBattleSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- odd-power-layers ---
      case "powerLayers":
        return <PowerLayersSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- jdm-race ---
      case "race":
        return <RaceSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- jdm-arena-games ---
      case "battle":
      case "ctf":
        return <ArenaGamesSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- jdm-rhythm-runner ---
      case "runner":
        return <RunnerSection t={t} search={search} matches={matches} settings={s} update={update} beat={props.paintBeat} />;
      case "paddle":
        return <PaddleSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- gerald-vortex ---
      case "vortex":
        return <VortexSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- gerald-journey ---
      case "journey":
        return <JourneySection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- gerald-bullseye ---
      case "bullseye":
        return <BullseyeSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- merge-ring ---
      case "mergeRing":
        return <MergeRingSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- spiral-glass ---
      case "spiralGlass":
        return <SpiralGlassSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- song-ring ---
      case "songRing":
        return <SongRingSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- sand-plate ---
      case "sandPlate":
        return <SandPlateSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- blueprint ---
      case "blueprint":
        return <BlueprintSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- beat-drop ---
      case "beatDrop":
        return <BeatDropSection t={t} search={search} matches={matches} settings={s} update={update} beat={props.paintBeat} beatSource={props.videoBeats?.effective} /* --- video-beats --- */ />;
      // --- odd-territory ---
      case "territory":
        return <TerritorySection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- odd-maze ---
      case "maze":
        return <MazeSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- gerald-conveyor ---
      case "conveyor":
        return <ConveyorSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- orb-grid ---
      case "orbGrid":
        return <OrbGridSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- fight-league ---
      case "fightLeague":
        return <FightLeagueSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- land-claim ---
      case "landClaim":
        return <LandClaimSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- colour-sort ---
      case "colourSort":
        return <ColourSortSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- chord-stars ---
      case "starChords":
        return <StarChordsSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- bead-hoops ---
      case "hoops":
        return <HoopsSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "paint":
        return <div className="space-y-3 pt-2">{picturePaintSection()}</div>;
      default:
        return null;
    }
  };

  // --- review fix (ui-i18n) --- the Ball section also matches the current escape mode's Mode-row keys (only that mode's,
  // so a search for "Spikes" in Classic still reports no results)
  const ballKeys = [...SECTION_KEYS.ball, ...(ESCAPE_MODE_KEYS_BY_MODE[s.mode] ?? [])];
  const keysOf = (id: ControlSection) => (id === "ball" ? ballKeys : SECTION_KEYS[id]);
  const anyResults = (Object.keys(SECTION_KEYS) as ControlSection[]).some((id) => sectionMatches(keysOf(id))) || (!!props.project && PROJECT_KEYS.some(matches)); // --- project-files ---

  // --- site-redesign --- the studio: the rail (a tab strip below 1280 px), the stage the page hands in, and the panel with
  // the open blocks – the Mode block, the open group (today's renderSection() output), Saved Presets, the project file –
  // under a pinned search field, the open group's Reset and Show Advanced Options below.
  // --- studio-fit --- below 1280 px the rail is a strip that scrolls sideways: Recording (the clip's length and format) comes
  // third there, after Mode and Ball & Physics, instead of a few swipes along (the order of the DOM, so the arrow keys agree)
  const stripOrder = railColumn ? sections : [...sections.slice(0, 1), ...sections.filter((item) => item.id === "recording"), ...sections.slice(1).filter((item) => item.id !== "recording")];
  const railItems: (TabStripItem & { id: StudioSection })[] = [
    { id: "mode", label: t("modeSpan"), icon: <IconGrid /> },
    ...stripOrder,
    { id: "presets", label: t("savedPresetsSpan"), icon: <IconBookmark /> },
  ];
  const isOpen = (id: StudioSection) => (id === "mode" ? modeOpen : id === "presets" ? presetsOpen : section === id);
  const openIds = railItems.filter((item) => isOpen(item.id)).map((item) => item.id);
  const resettable = section && railItems.some((item) => item.id === section) ? section : null;
  const panelOpen = !phone || sheetOpen;
  /** Opens a block (never closes it) and brings it into view in the panel. */
  const openGroup = (id: StudioSection) => {
    if (id === "mode") setModeOpen(true);
    else if (id === "presets") setPresetsOpen(true);
    else setSection(id);
    scrollTo.current = id;
    setScrollTick((n) => n + 1);
    setSheetOpen(true);
  };
  const select = (id: string) => {
    const item = id as StudioSection;
    pendingFocus.current = null; // --- review fix (site-redesign) --- a press on the rail wins over a palette jump still under way
    // --- review fix (site-redesign) --- while the search results fill the panel no group shows (none is pressed): a press
    // shows its group instead of closing it
    const searching = !!search;
    setSearch("");
    if (searching || !panelOpen || !isOpen(item)) return openGroup(item);
    // --- studio-fit --- the Mode item of a Mode block already shown opens the mode picker (it used to hide the block)
    if (item === "mode" && props.onOpenModePicker) return props.onOpenModePicker();
    // --- review fix (site-redesign) --- on a phone a press on an open tab puts the sheet away and keeps its blocks (the next
    // press brings them back): with the Mode block open from the start, the sheet used to stay up over the transport bar
    if (phone) return setSheetOpen(false);
    if (item === "mode") setModeOpen(false);
    else if (item === "presets") setPresetsOpen(false);
    else setSection(null);
  };
  // A block just opened (or came back with the sheet): scroll the panel to it (the Mode block above stays where it is). The
  // tick runs this after every openGroup(), also when the block was open already.
  useEffect(() => {
    const id = scrollTo.current;
    if (!id) return;
    scrollTo.current = null;
    if (id === "mode") return;
    document.getElementById(`studio-block-${id}`)?.scrollIntoView({ block: "nearest" });
  }, [scrollTick]);

  // --- studio-fit --- a mode picked anywhere (the picker, the strip's arrows, the palette: the event they all send) is seen
  // at once: on a phone the sheet goes down
  useEffect(() => {
    const onPick = () => setSheetOpen(false);
    window.addEventListener("jumpingballslive:select-mode", onPick);
    return () => window.removeEventListener("jumpingballslive:select-mode", onPick);
  }, []);

  // --- studio-fit --- on a phone the open sheet leaves the whole stage in view, not dimmed, with the transport bar between
  // them: the page goes to the studio's top, the bar stays on one line (it scrolls sideways), and the stage frame scales
  // down until the strip, the frame and the bar fit above the sheet. A transform, so the canvas keeps its size: the run goes
  // on and a found seed stays (Canvas.tsx measures itself on a window resize only). The empty part of the frame's box is
  // taken back with a negative margin, so the bar follows the picture.
  const studioRef = useRef<HTMLDivElement>(null);
  const sheetUp = phone && sheetOpen;
  const [stageFit, setStageFit] = useState<{ scale: number; shrink: number } | null>(null);
  useLayoutEffect(() => {
    const root = studioRef.current;
    if (!sheetUp || !root) {
      setStageFit(null);
      return;
    }
    root.closest("main")?.scrollIntoView({ block: "start" });
    const measure = () => {
      const column = root.querySelector<HTMLElement>(".studio-stage-column");
      const frame = root.querySelector<HTMLElement>(".stage-frame");
      const transport = root.querySelector<HTMLElement>(".studio-transport");
      const desk = root.querySelector<HTMLElement>(".studio-desk");
      const area = frame?.parentElement;
      if (!column || !frame || !transport || !desk || !area || !frame.offsetHeight) return;
      const header = document.querySelector("header")?.getBoundingClientRect().height ?? 56;
      const frameRect = frame.getBoundingClientRect(); // (scaled from its top: the top is where it was)
      const above = frameRect.top - column.getBoundingClientRect().top;
      // below the picture: the rest of its area, then whatever stands between it and the bar (the timeline's markers)
      let below = area.getBoundingClientRect().bottom - frameRect.bottom;
      for (let el = area.nextElementSibling; el && el !== transport; el = el.nextElementSibling) below += (el as HTMLElement).offsetHeight;
      const room = Math.min(window.innerHeight, document.documentElement.clientHeight) - header - desk.offsetHeight - transport.offsetHeight - above - below;
      const scale = Math.min(1, Math.max(0.3, Math.floor((room / frame.offsetHeight) * 100) / 100));
      const shrink = Math.round(frame.offsetHeight * (1 - scale));
      setStageFit((fit) => (fit && fit.scale === scale && fit.shrink === shrink ? fit : { scale, shrink }));
    };
    measure();
    const watch = new ResizeObserver(measure);
    for (const sel of [".stage-frame", ".studio-transport", ".studio-desk"]) {
      const el = root.querySelector(sel);
      if (el) watch.observe(el);
    }
    window.addEventListener("resize", measure);
    scaledStudio = root; // --- review fix (studio-fit) --- (see unscaleForResize())
    return () => {
      watch.disconnect();
      window.removeEventListener("resize", measure);
      if (scaledStudio === root) scaledStudio = null;
      cancelAnimationFrame(settleFrame);
      root.removeAttribute("data-stage-measure");
    };
  }, [sheetUp]);
  const stageFitStyle = stageFit ? ({ "--studio-stage-scale": String(stageFit.scale), "--studio-stage-shrink": `${stageFit.shrink}px` } as CSSProperties) : undefined;

  // The command palette: every group, and the controls this mode's panel shows in them. --- review fix (site-redesign) --- the
  // mode's own block under the Mode group, the other groups without the other modes' blocks and without the controls the
  // mode or a setting leaves out (panelKeys.ts), one entry per label in a group, the Project file block's under Saved
  // Presets. Built while the palette is open.
  const paletteShown: PanelShown = {
    mode: s.mode,
    ballPicture: !!props.ballImage || !!props.ballEmoji,
    showTrails: s.showTrails,
    glassGates: s.glassGates,
    wobblyWalls: hasWobblyWalls(s),
    simulationFound: props.simulationFound,
    bannerText: !!(s.topText || s.bottomText),
    arenas: s.arenaCount > 1,
    teams: s.teams.length > 0,
    captions: s.captions.length > 0,
    videoBackground: s.videoBackground,
    videoBeats: !!props.videoBeats,
    batch: !!props.batch,
    bot: !!props.bot,
  };
  const paletteState = JSON.stringify(paletteShown);
  const paletteEntries = useMemo<PaletteEntry[]>(() => {
    if (!paletteOpen) return [];
    const labels = Object.fromEntries(railItems.map((item) => [item.id, item.label]));
    const groups: PaletteGroup[] = paletteKeyGroups(paletteShown, sections.map((item) => item.id), !!props.project).map((g) => ({ ...g, label: labels[g.section] }));
    const out: PaletteEntry[] = railItems.map((item) => ({ kind: "section", section: item.id, key: item.id, label: item.label, sectionLabel: item.label }));
    // --- mode-shelves --- the modes too, after the settings: Change mode (the picker), then every other mode by its name, its
    // search words and its shelf's ("fight", "walka"), in the picker's order (no section name: "mode" must not find all of them)
    const modes: PaletteEntry[] = [
      ...(props.onOpenModePicker ? [{ kind: "action" as const, section: "mode", key: "changeMode", label: t("modeDisplay"), sectionLabel: "" }] : []),
      ...modesOnShelf("all").filter((id) => id !== s.mode).map((id) => ({ kind: "mode" as const, section: "mode", key: id, label: modeNames[id], sectionLabel: "", words: modePaletteWords(id, locale) })),
    ];
    return [...out, ...paletteControlEntries(groups, (key) => (t.has(key) ? t(key) : colourSortT.has(key) ? colourSortT(key) : beatMachineT.has(key) ? beatMachineT(key) /* --- beat-machine --- */ : vortexT.has(key) ? vortexT(key) /* --- funnel-spin --- */ : brickRebuildT.has(key) ? brickRebuildT(key) /* --- brick-rebuild --- */ : perfectFitT.has(key) ? perfectFitT(key) /* --- perfect-fit --- */ : waveTankT.has(key) ? waveTankT(key) /* --- wave-tank --- */ : drawingMachineT.has(key) ? drawingMachineT(key) /* --- drawing-machine --- */ : null /* --- colour-sort --- */), (key) => settingSearchWords(key, locale) || undefined /* --- panel-basics --- */), ...modes];
    // The labels follow the language, the entries the mode and the settings that show or hide a control (paletteState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, t, locale, paletteState, sections.length, !!props.project, !!props.onOpenModePicker]);
  const railIcons = Object.fromEntries(railItems.map((item) => [item.id, item.icon])) as Record<string, ReactNode>;
  // --- panel-basics --- every group's name, for the search results (a group the rail leaves out in this mode included)
  const groupLabels: Record<ControlSection, string> = { ball: t("ballPhysicsTab"), wall: t("wallSettingsTab"), visual: t("visualEffectsTab"), sound: t("customSoundTab"), teams: t("teamsTab"), obstacles: t("obstaclesTab"), captions: t("captionsTab"), timeline: t("timelineTab"), arenas: t("splitTab"), recording: t("recordingTab") };

  const choosePalette = (entry: PaletteEntry) => {
    setPaletteOpen(false);
    // --- mode-shelves --- a mode switches in place (the event the mode cards send), Change mode opens the picker
    if (entry.kind === "mode") {
      rememberRecentMode(entry.key as ModeId, s.mode);
      window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: entry.key }));
      return;
    }
    if (entry.kind === "action") {
      props.onOpenModePicker?.();
      return;
    }
    setSearch("");
    // A control: focus it in its block once the block has rendered. --- review fix (site-redesign) --- one its block does not
    // show right now (an advanced option, the collapsed Project file block, one that waits for another setting) is looked up
    // through the search box at once, so nothing is left pending for a later click to set off. The Project file block sits
    // under the panel, open or not: its entries open no group.
    const project = entry.kind === "control" && PROJECT_KEYS.includes(entry.key);
    if (!project) openGroup(entry.section as StudioSection);
    // --- panel-basics --- a control of a named row of the Recording group opens its row
    const row = entry.kind === "control" ? foldRowOf(entry.key) : null;
    if (row) setRows((r) => (r[row] ? r : { ...r, [row]: true }));
    // (a section's controls are looked for among its own search results – two sections may name a control alike; a mode
    // block's show in the Ball or Visual section's results, the project file's apart, found by their keys and labels)
    const results = project || entry.section === "mode" || entry.section === "presets" ? null : `studio-results-${entry.section}`;
    pendingFocus.current = entry.kind === "control" ? { label: entry.label, key: entry.key, block: project ? "studio-block-project" : entry.section === "mode" ? "studio-mode-own" /* --- panel-basics --- */ : `studio-block-${entry.section}`, results, searched: false } : null;
    setFocusTick((n) => n + 1);
  };
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    const panel = document.getElementById("studio-panel-body");
    const scope = pending.searched ? ((pending.results && document.getElementById(pending.results)) || panel) : document.getElementById(pending.block);
    const target = scope ? findControl(scope, pending.label, pending.key) : null;
    // A control to focus, or – the search tried – what shows its label (a disabled picker, an upload area, a heading).
    if (target && (target.focusable || pending.searched)) {
      pendingFocus.current = null;
      scrollIntoPanel(target.el); // --- studio-fit --- (the panel alone scrolls where it can: the stage stays where it is)
      if (target.focusable) target.el.focus({ preventScroll: true });
      const row = target.el.closest<HTMLElement>("[data-search-key], [data-uncap-slider], .space-y-2, .space-y-3") ?? target.el;
      row.setAttribute("data-palette-hit", "");
      window.setTimeout(() => row.removeAttribute("data-palette-hit"), 1600);
      return;
    }
    if (pending.searched) {
      // Not even among the search results: the search box shows what matches the label, nothing stays pending.
      pendingFocus.current = null;
      return;
    }
    pendingFocus.current = { ...pending, searched: true };
    setSearch(pending.label);
    setFocusTick((n) => n + 1);
  }, [focusTick]);

  // --- studio-fit --- the stage strip's TIME and FORMAT open their setting with the palette's own jump (its group opens, the
  // control is focused and outlined); a setting the panel does not show right now (the length once a run is found) opens
  // its group alone
  const openSetting = useRef<(key: string) => void>(() => {});
  useEffect(() => {
    openSetting.current = (key) => {
      const row = foldRowOf(key); // --- panel-basics --- (the fast export's Publish button: the Publish row)
      if (row) setRows((r) => (r[row] ? r : { ...r, [row]: true }));
      const section = (Object.keys(SECTION_KEYS) as ControlSection[]).find((id) => SECTION_KEYS[id].includes(key));
      if (!section || !sections.some((item) => item.id === section)) return;
      const shown = paletteKeyGroups(paletteShown, [section], false).some((group) => group.keys.includes(key));
      if (!shown || !t.has(key)) {
        setSearch("");
        openGroup(section);
        return;
      }
      choosePalette({ kind: "control", section, key, label: t(key), sectionLabel: "" });
    };
  });
  useEffect(() => {
    const onOpen = (e: Event) => {
      const key = (e as CustomEvent<unknown>).detail;
      if (typeof key === "string") openSetting.current(key);
    };
    window.addEventListener(OPEN_SETTING_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTING_EVENT, onOpen);
  }, []);

  // --- panel-basics --- Undo: a snapshot of the settings each time they rest for a moment after a change (UNDO_SETTLE_MS),
  // restored through the page's own update path, within one mode (a mode switch builds its own settings: the history starts
  // again there). The button sits beside Reset; Ctrl/Cmd+Z undoes too where the focus is not in a text field.
  const undoRef = useRef<{ history: SimulatorSettings[]; settled: SimulatorSettings; timer: number; restoring: boolean }>({ history: [], settled: s, timer: 0, restoring: false });
  const [undoable, setUndoable] = useState(false);
  const [resetFlash, setResetFlash] = useState(false);
  useEffect(() => {
    const u = undoRef.current;
    window.clearTimeout(u.timer);
    if (s.mode !== u.settled.mode) {
      u.history = [];
      u.settled = s;
      u.restoring = false;
      setUndoable(false);
      return;
    }
    if (u.restoring) {
      // (the settings an undo put back are the new resting point, not a step of their own)
      u.restoring = false;
      u.settled = s;
      setUndoable(u.history.length > 0);
      return;
    }
    if (s === u.settled) return;
    setUndoable(true);
    u.timer = window.setTimeout(() => {
      if (!undoPatch(u.settled, s)) return;
      u.history = pushUndo(u.history, u.settled);
      u.settled = s;
    }, UNDO_SETTLE_MS);
    return () => window.clearTimeout(u.timer);
  }, [s]);
  const settingsRef = useRef(s);
  settingsRef.current = s;
  const undo = useCallback(() => {
    const u = undoRef.current;
    window.clearTimeout(u.timer);
    // a change still settling is undone first (back to where the settings last rested), then the history, newest first
    let patch = undoPatch(u.settled, settingsRef.current);
    if (!patch) {
      while (u.history.length > 0 && !patch) patch = undoPatch(u.history.pop()!, settingsRef.current);
    }
    if (!patch) {
      setUndoable(false);
      return;
    }
    u.restoring = true;
    setResetFlash(false);
    update(patch);
  }, [update]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "z" || e.defaultPrevented) return;
      if (typesText(e.target) || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);
  // (after Reset Category the Undo button stands out for a few seconds)
  useEffect(() => {
    if (!resetFlash) return;
    const id = window.setTimeout(() => setResetFlash(false), 4000);
    return () => window.clearTimeout(id);
  }, [resetFlash]);

  // --- panel-basics --- Continue where you left off: the studio's last address is kept in this browser (a bare address
  // never wipes it), and a visit to the bare studio address offers it in the starter block until the visitor changes
  // something (the address then has a query of its own).
  // (this runs before the page mirrors its settings into the address: a bare arrival is seen as one, and a link is kept at
  // once; a bare arrival's own defaults never replace the last visit until something is changed)
  const visit = useRef<{ arrived: SimulatorSettings; bare: boolean; changed: boolean }>({ arrived: s, bare: false, changed: false });
  useEffect(() => {
    const v = visit.current;
    v.bare = !window.location.search;
    if (v.bare) setLastVisit(readStudioQuery());
    else rememberStudioQuery(window.location.search);
    const onHide = () => {
      if (!v.bare || v.changed) rememberStudioQuery(window.location.search);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);
  useEffect(() => {
    const v = visit.current;
    if (s === v.arrived && !v.changed) return;
    v.changed = true;
    const id = window.setTimeout(() => {
      rememberStudioQuery(window.location.search);
      setLastVisit(null);
    }, 1000);
    return () => window.clearTimeout(id);
  }, [s]);

  /** Opens the palette. --- review fix (site-redesign) --- a jump of the last one still looking for its control is dropped. */
  const openPalette = useCallback(() => {
    pendingFocus.current = null;
    setPaletteOpen(true);
  }, []);
  // Cmd/Ctrl+K opens the palette from anywhere in the studio.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        openPalette();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette]);

  const presetsPanel = () => (
    <div className="space-y-4">
      {/* --- orb-grid --- the Bouncing Orbs presets (after the account's clips) above the saved ones */}
      {props.onOrbGridPreset && <OrbGridPresets t={t} settings={s} onPick={props.onOrbGridPreset} />}
      <div className="flex gap-2">
        <input
          type="text"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          placeholder={t("presetPlaceholder")}
          maxLength={30}
          aria-label={t("presetPlaceholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter" && presetName.trim()) {
              props.onSavePreset(presetName.trim());
              setPresetName("");
            }
          }}
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface-1 px-3 text-md text-ink placeholder:text-ink-3 hover:border-line-strong focus:border-accent-dim"
        />
        <Button
          variant="secondary"
          size="sm"
          className="h-9"
          onClick={() => {
            if (presetName.trim()) {
              props.onSavePreset(presetName.trim());
              setPresetName("");
            }
          }}
          disabled={!presetName.trim()}
        >
          {t("saveBtn")}
        </Button>
      </div>
      {props.savedPresetNames.length === 0 ? (
        <p className="py-2 text-center text-sm text-ink-3">{t("noSavedPresets")}</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {props.savedPresetNames.map((name) => (
            <li key={name} className="group flex items-center gap-2 px-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2"
                onClick={() => props.onLoadPreset(name)}
                disabled={props.batchRunning} // --- review fix (recording-export) ---
                title={props.batchRunning ? t("presetLoadLocked") : undefined}
              >
                {t("loadBtn")}
              </Button>
              <button
                type="button"
                onClick={() => props.onDeletePreset(name)}
                aria-label={t("deletePreset")}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-ink-3 opacity-0 transition-opacity hover:bg-surface-3 hover:text-danger focus:opacity-100 group-hover:opacity-100 cursor-pointer [@media(pointer:coarse)]:opacity-100"
              >
                <IconClose size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  // --- panel-basics --- The starter block, under the mode card while no other group is open: the three steps (pick a mode,
  // make it yours, export and share), then the six settings a visitor changes first, with the controls of their home
  // groups (the theme cards, the ball's colour, size and speed, the clip length, the top text). It folds away, and starts
  // folded once Show Advanced Options is on. A visit to the bare studio address offers the last one's settings here.
  const starterBlock = () => {
    const resumeMode = lastVisit ? studioQueryMode(lastVisit) : null;
    const step = (n: number, label: string, onClick: () => void) => (
      <li className="min-w-0">
        <button type="button" onClick={onClick} className="flex h-full w-full flex-col items-start gap-1 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-left text-xs font-medium leading-tight text-ink-2 hover:border-line-strong hover:text-ink cursor-pointer">
          <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-3 text-[11px] text-ink">{n}</span>
          <span className="min-w-0">{label}</span>
        </button>
      </li>
    );
    return (
      <div className="space-y-3" data-testid="studio-starter">
        <ol className="grid grid-cols-3 gap-1.5" data-testid="studio-steps">
          {step(1, howItWorks("step1.title"), () => props.onOpenModePicker?.())}
          {step(2, howItWorks("step2.title"), () => {
            setStarterOpen(true);
            window.setTimeout(() => document.getElementById("studio-starter-body")?.scrollIntoView({ block: "nearest" }), 0);
          })}
          {step(3, howItWorks("step3.title"), () => openGroup("recording"))}
        </ol>
        {lastVisit && resumeMode && resumeMode in modeNames && (
          <a
            href={`${window.location.pathname}${lastVisit}`}
            className="flex items-center justify-between gap-3 rounded-md border border-accent-dim/60 bg-accent/10 px-3 py-2 text-sm text-ink hover:bg-accent/15"
            data-testid="studio-continue"
          >
            <span className="min-w-0">
              <span className="block font-medium">{site("studio.continueLast")}</span>
              <span className="block truncate text-xs text-ink-2">{modeNames[resumeMode as ModeId]}</span>
            </span>
            <IconChevronDown size={16} className="-rotate-90 text-ink-3" />
          </a>
        )}
        <section className="rounded-lg border border-line" aria-labelledby="studio-starter-title">
          <h3 id="studio-starter-title" className="m-0">
            <button type="button" aria-expanded={starterOpen} aria-controls="studio-starter-body" onClick={() => setStarterOpen(!starterOpen)} className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-ink hover:bg-surface-2 cursor-pointer">
              <span>{howItWorks("step2.title")}</span>
              <IconChevronDown size={16} className={cx("text-ink-3 transition-transform duration-150", starterOpen && "rotate-180")} />
            </button>
          </h3>
          {starterOpen && (
            <div id="studio-starter-body" className="space-y-4 border-t border-line px-3 pb-4 pt-3">
              <ThemeCards t={t} search="" matches={matches} settings={s} update={update} />
              {ballColorControl()}
              {ballSizeControl()}
              {ballSpeedControl()}
              {durationControl()}
              {bannerTextControl("topText", "starter-")}
            </div>
          )}
        </section>
      </div>
    );
  };

  const modePanel = (own = modeSpecific()) => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
        <span className="min-w-0 truncate text-md font-medium text-ink">{modeNames[s.mode]}</span>
        {/* --- review fix (site-redesign) --- the kit's small button: a 32 px target (44 px on touch), not a 20 px line of text */}
        <Button variant="ghost" size="sm" onClick={props.onOpenModePicker} aria-haspopup="dialog" className="-my-1 -mr-2 shrink-0">
          {t("modeDisplay")}
        </Button>
      </div>
      {!section && starterBlock() /* --- panel-basics --- */}
      {own && <div id="studio-mode-own">{own}</div> /* --- panel-basics --- (the palette looks for a mode's control here, not in the starter block) */}
    </div>
  );

  const panelBody = () => {
    if (search)
      return (
        <div className="space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between">
            <span className="eyebrow text-ink-3">{t("searchResults")}</span>
            <button type="button" onClick={() => setSearch("")} className="rounded-sm text-sm font-medium text-accent hover:text-accent-strong cursor-pointer">
              {t("clearSearch")}
            </button>
          </div>
          {!anyResults && <p className="py-4 text-center text-sm text-ink-3">{t("noSearchResults")}</p>}
          {(Object.keys(SECTION_KEYS) as ControlSection[]).map(
            (id) =>
              sectionMatches(keysOf(id)) && (
                <div key={id} id={`studio-results-${id}`} /* --- review fix (site-redesign) --- (the palette looks for a section's control among its own results) */>
                  {/* --- panel-basics --- the group's name over its results: a found control says where it lives */}
                  <h2 className="eyebrow mb-3 text-ink-3" data-results-group={id}>
                    {groupLabels[id]}
                  </h2>
                  {renderSection(id)}
                </div>
              ),
          )}
          {props.project && <ProjectSection t={t} search={search} matches={matches} project={props.project} /> /* --- project-files --- */}
        </div>
      );
    const block = (id: StudioSection, label: string, body: ReactNode) => (
      <section key={id} id={`studio-block-${id}`} className="scroll-mt-4 border-t border-line pt-4 first:border-t-0 first:pt-0 animate-fadeIn">
        <h2 className="eyebrow mb-4 text-ink-3">{label}</h2>
        {body}
      </section>
    );
    const sectionItem = section ? railItems.find((item) => item.id === section) : null;
    // --- panel-basics --- a group that holds controls behind Show Advanced Options ends with a quiet row: how many, and a
    // press turns the switch on
    const hidden = sectionItem && !advanced ? advancedCount(sectionItem.id as ControlSection, paletteShown, { tones: s.hitSoundMode === "tones", musicTrack: !!props.musicTrack, onBeat: s.onBeat, breathing: s.breathingAmplitude > 0 }) : 0;
    const advancedRow = hidden > 0 && (
      <button type="button" onClick={() => setAdvancedPersist(true)} className="mt-4 flex w-full items-center justify-between gap-3 rounded-md border border-dashed border-line px-3 py-2 text-left text-sm text-ink-3 hover:border-line-strong hover:text-ink-2 cursor-pointer" data-advanced-row={hidden}>
        <span>{t("showAdvancedOptions")}</span>
        <span className="num rounded-full bg-surface-2 px-2 text-xs text-ink-2">{hidden}</span>
      </button>
    );
    return (
      <div className="space-y-6">
        {modeOpen && block("mode", t("modeSpan"), modePanel())}
        {sectionItem &&
          block(
            sectionItem.id,
            sectionItem.label,
            <>
              {renderSection(sectionItem.id as ControlSection)}
              {advancedRow}
            </>,
          )}
        {presetsOpen && block("presets", t("savedPresetsSpan"), presetsPanel())}
        {!modeOpen && !sectionItem && !presetsOpen && <p className="py-8 text-center text-sm text-ink-3">{site("studio.panelEmpty")}</p>}
        {props.project && (
          <div id="studio-block-project" className="border-t border-line pt-4">
            <ProjectSection t={t} search="" matches={matches} project={props.project} /* --- project-files --- */ />
          </div>
        )}
      </div>
    );
  };


  // The rail: the palette's Search item, then the groups. --- studio-fit --- with its labels wherever it shows (no hover labels).
  const rail = (
    <div className="studio-rail">
      <button type="button" onClick={openPalette} className="studio-rail-item studio-rail-search" aria-label={site("studio.search")} title={`${site("studio.search")} (${mod} K)`}>
        <IconSearch />
        <span className="studio-rail-label" aria-hidden="true">{site("studio.search")}</span>
        <Kbd className="ml-auto max-2xl:hidden">{mod} K</Kbd>
      </button>
      <TabStrip
        items={railItems}
        active={panelOpen && !search ? openIds : null}
        onSelect={select}
        label={site("studio.rail")}
        controls="studio-panel"
        className="studio-rail-items"
        itemClassName="studio-rail-item"
        labelClassName="studio-rail-label"
        orientation={railColumn ? "vertical" : undefined}
      />
    </div>
  );

  return (
    <UnlimitedProvider on={s.unlimited /* --- unlimited --- */}>
      {/* --- studio-fit --- where the rail is a column on the left (from 1280 px) it comes first, so the Tab order follows the
          screen: rail, stage, panel; below that it heads the desk (the tab strip over the panel, or the sheet's peek). The
          open sheet of a phone no longer dims the stage behind a scrim: the stage stays in view and in use. */}
      <div ref={studioRef} className={cx("studio", sheetUp && "studio-sheet-open")} style={stageFitStyle} data-studio-active={section ?? (modeOpen ? "mode" : "")}>
        {railColumn && rail}
        <StageModeContext.Provider value={s.mode}>
          <div className="studio-stage">{props.stage}</div>
        </StageModeContext.Provider>
        <div className={cx("studio-desk", sheetOpen && "studio-desk-open")}>
          {!railColumn && rail}
          <aside id="studio-panel" className="studio-panel" aria-label={t("controlsTitle")} hidden={phone && !sheetOpen}>
            <div className="studio-panel-search">
              <div className="relative min-w-0 flex-1">
                <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  type="text"
                  placeholder={t("searchSettings")}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  aria-label={t("searchSettings")}
                  className="h-9 w-full rounded-md border border-line bg-surface-2 pl-9 pr-10 text-md text-ink placeholder:text-ink-3 transition-colors hover:border-line-strong focus:border-accent-dim cursor-text [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:pr-12"
                />
                {search && (
                  <button type="button" onClick={() => setSearch("")} aria-label={t("clearSearch")} className="absolute right-0.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink cursor-pointer [@media(pointer:coarse)]:right-0 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                    <IconClose size={16} />
                  </button>
                )}
              </div>
              {/* --- panel-basics --- Undo (Ctrl/Cmd+Z where the focus is not in a text field), at the top of the panel beside its
                  search: in a 340 px panel the foot holds Reset Category and the switch's label on one line, no more. After
                  Reset Category it stands out for a moment. */}
              <button
                type="button"
                onClick={undo}
                disabled={!undoable}
                aria-label={customContent("undo")}
                title={`${customContent("undo")} (${mod} Z)`}
                className={cx("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink cursor-pointer disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11", resetFlash && undoable && "text-accent ring-1 ring-accent/60")}
                data-testid="studio-undo"
              >
                <IconUndo size={18} />
              </button>
              {phone && (
                <button type="button" onClick={() => setSheetOpen(false)} aria-label={site("studio.closeSettings")} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink cursor-pointer [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11">
                  <IconClose />
                </button>
              )}
            </div>
            <div id="studio-panel-body" className="studio-panel-body">
              {panelBody()}
            </div>
            <div className="studio-panel-foot">
              {resettable && !search ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2"
                  icon={<IconReset size={16} />}
                  onClick={() => {
                    props.onResetSection(resettable);
                    setResetFlash(true); // --- panel-basics --- (Undo, at the top of the panel, stands out for a moment)
                  }}
                >
                  {t("resetSection")}
                </Button>
              ) : (
                <span />
              )}
              <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-ink-2 hover:text-ink [@media(pointer:coarse)]:min-h-11">
                <input type="checkbox" className="switch" checked={advanced} onChange={(e) => setAdvancedPersist(e.target.checked)} />
                <span>{t("showAdvancedOptions")}</span>
              </label>
            </div>
          </aside>
        </div>
      </div>
      {paletteOpen && <CommandPalette entries={paletteEntries} icons={railIcons} onChoose={choosePalette} onClose={() => setPaletteOpen(false)} />}
    </UnlimitedProvider>
  );
}

/**
 * --- studio-fit --- Brings `el` to the middle of the panel's own scroll box where the panel scrolls on its own (beside the
 * stage, in the desk column, in the phone's sheet), so the page and its stage stay where they are; where the page scrolls
 * the panel along (768–899 px), the page scrolls.
 */
function scrollIntoPanel(el: HTMLElement): void {
  const body = el.closest<HTMLElement>("#studio-panel-body");
  if (!body || !/(auto|scroll)/.test(getComputedStyle(body).overflowY) || body.scrollHeight <= body.clientHeight) {
    el.scrollIntoView({ block: "center" });
    return;
  }
  const b = body.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  body.scrollTop += r.top + r.height / 2 - (b.top + b.height / 2);
}

/** What the palette may focus: a shown, enabled field, button or link. */
const FOCUSABLE = 'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]:not([tabindex="-1"]):not([data-tip])'; // --- studio-fit --- (an info tip is never the control a jump focuses)
const usable = (el: Element | null): el is HTMLElement => el instanceof HTMLElement && el.getClientRects().length > 0 && !(el as HTMLInputElement).disabled;
/** The element itself when the palette may focus it, else the first such element inside it. */
function focusableIn(el: HTMLElement): HTMLElement | null {
  if (el.matches(FOCUSABLE) && usable(el)) return el;
  return [...el.querySelectorAll(FOCUSABLE)].find(usable) ?? null;
}

/**
 * --- site-redesign --- The control a palette entry names, inside `scope` (its block, or the search results): the element
 * labelled with it (a slider, a switch, a picker) or the first control next to its label. --- review fix (site-redesign) ---
 * A search result's card is found by its search key first (two controls named alike – the Ball section's Gravity and the
 * box's – are told apart); a group named by the label gives its first button, a label inside a button gives the button, a
 * button reading the label is one too; hidden and disabled elements (a file input behind its button) are skipped. With
 * nothing to focus – a disabled picker, an upload area, a heading – the label itself is shown (`focusable` false).
 */
function findControl(scope: HTMLElement, label: string, key: string): { el: HTMLElement; focusable: boolean } | null {
  const shown = (el: HTMLElement | null): el is HTMLElement => !!el && el.getClientRects().length > 0;
  const card = scope.querySelector<HTMLElement>(`[data-search-key="${CSS.escape(key)}"]`);
  const inCard = card ? focusableIn(card) : null;
  if (inCard) return { el: inCard, focusable: true };
  let fallback: HTMLElement | null = shown(card) ? card : null;
  for (const el of scope.querySelectorAll<HTMLElement>("[aria-label], [aria-labelledby]")) {
    const own = el.getAttribute("aria-label");
    const named = own !== null ? own === label : (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).some((id) => !!id && (document.getElementById(id)?.textContent ?? "").trim() === label);
    const hit = named ? focusableIn(el) : null;
    if (hit) return { el: hit, focusable: true };
  }
  for (const text of scope.querySelectorAll<HTMLElement>("label, span, p, h3, h4, legend")) {
    if ((text.firstChild?.textContent ?? text.textContent ?? "").trim() !== label || !shown(text)) continue;
    const labelFor = text.closest("label")?.htmlFor; // (the label's text may sit in a span of the <label for=…>)
    const field = labelFor ? document.getElementById(labelFor) : null;
    if (usable(field)) return { el: field, focusable: true };
    const own = text.closest<HTMLElement>("button, a[href]");
    if (usable(own)) return { el: own, focusable: true };
    // the control next to the label: in the label's row (its first block-level ancestor)
    let row = text.parentElement;
    while (row && scope.contains(row) && getComputedStyle(row).display.startsWith("inline")) row = row.parentElement;
    const near = row && scope.contains(row) ? focusableIn(row) : null;
    if (near) return { el: near, focusable: true };
    fallback ??= text;
  }
  for (const button of scope.querySelectorAll<HTMLElement>("button")) {
    // (a leading symbol – "＋ Add Team" – is not part of the name)
    if ((button.textContent ?? "").trim().replace(/^[^\p{L}\p{N}]+/u, "") !== label) continue;
    if (usable(button)) return { el: button, focusable: true };
    if (shown(button)) fallback ??= button;
  }
  return fallback ? { el: fallback, focusable: false } : null;
}

/** Settings that the "Reset Category" buttons restore, per section. */
export function sectionDefaults(section: ControlSection, mode: ModeId): Partial<SimulatorSettings> {
  const d = defaultSettings(mode);
  switch (section) {
    case "ball":
      return {
        ballSpeed: d.ballSpeed,
        ballRadius: d.ballRadius,
        gravity: d.gravity,
        ballColor: d.ballColor,
        twoBalls: d.twoBalls,
        ballColor2: d.ballColor2,
        bouncierEnabled: d.bouncierEnabled,
        bounciness: d.bounciness, // --- uncap-all ---
        ballInteraction: d.ballInteraction,
        splitMinRadius: d.splitMinRadius,
        maxBalls: d.maxBalls,
        rainbowBall: d.rainbowBall,
        airDrag: d.airDrag,
        windX: d.windX,
        windY: d.windY,
        spinStrength: d.spinStrength,
        rotatingGravity: d.rotatingGravity,
        ...characterOf(d), // --- gerald-faces ---
        ballCount: d.ballCount, // --- teams --- (a team roster keeps its balls: see the Teams section)
        ...multiplierConfigOf(d), // --- gerald-multipliers --- pickups, cap, smash threshold
        ...defaultBounceMathFields(), // --- bounce-math --- no rules, Show values on
        respawnEvery: d.respawnEvery, // --- gerald-conveyor --- the respawn timer of Classic and Multiply (off)
        // --- slow-motion --- (review fix) the block at the top of the section (UNLIMITED_KEYS): Wide sliders and Slow motion back on,
        // Full-Physics Balls back to the limits runtime's default, as the Camera group's Reset brings the camera back
        unlimited: d.unlimited,
        slowMotion: d.slowMotion,
        fullBallLimit: d.fullBallLimit,
      };
    case "wall":
      return {
        wallCount: d.wallCount,
        wallThickness: d.wallThickness,
        gapSize: d.gapSize,
        rotationEnabled: d.rotationEnabled,
        rotationSpeed: d.rotationSpeed,
        rainbowWalls: d.rainbowWalls,
        rainbowWallMode: d.rainbowWallMode,
        circleColor: d.circleColor,
        wallBounciness: d.wallBounciness,
        breathingAmplitude: d.breathingAmplitude,
        breathingSpeed: d.breathingSpeed,
        exitBehavior: d.exitBehavior, exitJumpSeconds: d.exitJumpSeconds, exitSense: d.exitSense, exitFleeSpeed: d.exitFleeSpeed, // --- gerald-exit-splat ---
        // --- low-findings-2 --- Ring Escape's options (Classic's ring generation, in this section): the layout, the spiral's step,
        // the spin, the rainbow, the time in the ring and the ring sounds
        gapLayout: d.gapLayout, gapSpiralStep: d.gapSpiralStep, ringSpin: d.ringSpin, ringRainbow: d.ringRainbow, ringTimer: d.ringTimer, ringSound: d.ringSound,
      };
    case "visual":
      return {
        showTrails: d.showTrails,
        trailThickness: d.trailThickness,
        showGlow: d.showGlow,
        showWallGlow: d.showWallGlow,
        colorTrail: d.colorTrail,
        reactiveBackground: d.reactiveBackground,
        cameraFollow: d.cameraFollow,
        wallBreakStyle: d.wallBreakStyle,
        cinematicEnabled: d.cinematicEnabled,
        paintBrush: d.paintBrush,
        paintGhost: d.paintGhost,
        paintBeatSync: d.paintBeatSync,
        paintBeatSource: d.paintBeatSource,
        paintBeatPulse: d.paintBeatPulse,
        paintGuided: d.paintGuided,
        paintPaceToSong: d.paintPaceToSong,
        // --- themes: back to the plain background, confetti and the rainbow trail (the colours reset with the Ball / Wall sections)
        themeId: d.themeId,
        backgroundType: d.backgroundType,
        backgroundColors: d.backgroundColors,
        backgroundDim: d.backgroundDim,
        particleStyle: d.particleStyle,
        trailColors: d.trailColors,
        // --- end themes
        ...cameraSettingsOf(d), // --- camera ---
        ...riggedConfigOf(d), // --- rigged --- never escape off, no forced winner
        wallWobble: d.wallWobble, // --- jdm-illusions ---
        splatBarrier: d.splatBarrier, splatSize: d.splatSize, splatMax: d.splatMax, // --- gerald-exit-splat ---
      };
    case "sound":
      return {
        wallBreakSound: null,
        hitSoundMode: d.hitSoundMode,
        hitSampleId: d.hitSampleId,
        hitSamplePitchByWall: d.hitSamplePitchByWall,
        hitSampleVolume: d.hitSampleVolume,
        instrument: d.instrument,
        melodyInstrument: d.melodyInstrument,
        scale: d.scale,
        rootNote: d.rootNote,
        quantizeToBeat: d.quantizeToBeat,
        bpm: d.bpm,
        quantizeGrid: d.quantizeGrid,
        sliceSong: d.sliceSong,
        sliceMs: d.sliceMs,
        sliceLoop: d.sliceLoop,
        sliceFadeMs: d.sliceFadeMs,
        musicVolume: d.musicVolume,
        musicDucking: d.musicDucking,
        musicDuckRelease: d.musicDuckRelease,
        musicLoop: d.musicLoop,
        musicStartOffset: d.musicStartOffset,
        ...defaultVideoBeatsFields(), // --- video-beats --- the song's beat, no markers, On beat off, no video background
      };
    case "recording":
      return { recordingResolution: d.recordingResolution, recordingDuration: d.recordingDuration, watermarkText: d.watermarkText, topText: d.topText, bottomText: d.bottomText, textSize: d.textSize, fastExportFps: d.fastExportFps }; // --- fast-render --- (fastExportFps)
    // --- teams --- no roster (the balls stay), names and scoreboard back on, top left
    case "teams": {
      const teams = defaultTeamSettings();
      return { teams: teams.teams, showBallNames: teams.showBallNames, showScoreboard: teams.showScoreboard, scoreboardPosition: teams.scoreboardPosition };
    }
    // --- obstacle-editor --- no obstacles, the default bumper boost
    case "obstacles":
      return defaultObstacleSettings();
    // --- captions --- no captions
    case "captions":
      return defaultCaptionSettings();
    // --- timeline --- no keyframes
    case "timeline":
      return defaultTimelineSettings();
    // --- split-screen --- one arena, a row, the first arena's sound, no overrides
    case "arenas":
      return defaultSplitScreenFields();
  }
}
