"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { ColorPicker, Searchable, Slider, Toggle, offBtn, onBtn, rainbowBtn, selectClass, sliderStyle } from "./ControlPrimitives";
import BallDropSection, { BALL_DROP_KEYS } from "./sections/BallDropSection";
import EscapeModeSection, { ESCAPE_MODE_KEYS_BY_MODE } from "./sections/EscapeModeSection"; // --- review fix (ui-i18n) ---
import BallInteractionSection, { BALL_INTERACTION_KEYS } from "./sections/BallInteractionSection";
import BoxArenaSection, { BOX_ARENA_KEYS } from "./sections/BoxArenaSection";
import CharacterSection, { CHARACTER_KEYS } from "./sections/CharacterSection"; // --- gerald-faces ---
import HitSampleSection, { HIT_SAMPLE_KEYS } from "./sections/HitSampleSection";
import MusicSection, { MUSIC_BED_KEYS, type MusicTrackInfo } from "./sections/MusicSection";
import PendulumWaveSection, { PENDULUM_WAVE_KEYS } from "./sections/PendulumWaveSection";
import { BALL_PHYSICS_EXTRA_KEYS, BallPhysicsExtras, WALL_PHYSICS_EXTRA_KEYS, WallPhysicsExtras } from "./sections/PhysicsExtrasSection";
import PicturePaintSection, { PICTURE_PAINT_KEYS, type PaintBeatInfo, type PaintPictureInfo } from "./sections/PicturePaintSection";
import PolyrhythmSection, { POLYRHYTHM_KEYS } from "./sections/PolyrhythmSection"; // --- jdm-polyrhythm ---
import SongSlicerSection, { SONG_SLICER_KEYS } from "./sections/SongSlicerSection";
import ThemeSection, { THEME_KEYS, type ThemeImageProps } from "./sections/ThemeSection"; // --- themes
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
import BeatDropSection, { BEAT_DROP_KEYS } from "./sections/BeatDropSection"; // --- beat-drop --- the Beat Drop block of the Mode row
import TerritorySection, { TERRITORY_KEYS } from "./sections/TerritorySection"; // --- odd-territory --- the Territory block of the Mode row
import MazeSection, { MAZE_KEYS } from "./sections/MazeSection"; // --- odd-maze --- the Maze block of the Mode row
import ConveyorSection, { CONVEYOR_KEYS, RESPAWN_KEYS, RespawnControl } from "./sections/ConveyorSection"; // --- gerald-conveyor --- the Conveyor block of the Mode row, the respawn timer of the Ball section
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
import UnlimitedSection, { UNLIMITED_KEYS } from "./sections/UnlimitedSection";
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
import { IconBall, IconBookmark, IconCaptions, IconClose, IconGrid, IconInfo, IconKeyframes, IconObstacle, IconReset, IconRings, IconSearch, IconSparkle, IconSplit, IconUpload, IconUsers, IconVideo, IconWave } from "@/components/ui/icons";
import CommandPalette from "./studio/CommandPalette";
import { paletteControlEntries, type PaletteEntry, type PaletteGroup } from "@/lib/siteDesign";
import { MODE_BLOCK_KEYS, sectionKeyShown, wallControlsOf, type PanelShown } from "./panelKeys"; // --- review fix (site-redesign) --- what the palette offers per mode

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
}

const EMOJIS = ["😂", "🔥", "💀", "❤️", "⭐", "🎯", "🏀", "⚽", "🎱", "🌍", "🍩", "🎃"];

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
// --- beat-drop --- the Beat Drop block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...BEAT_DROP_KEYS);
// --- odd-territory --- the Territory block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...TERRITORY_KEYS);
// --- odd-maze --- the Maze block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...MAZE_KEYS);
// --- gerald-conveyor --- the Conveyor block of the Mode row is searched with the Ball section too, where the respawn timer
// of Classic and Multiply lives.
SECTION_KEYS.ball.push(...CONVEYOR_KEYS, ...RESPAWN_KEYS);
// --- unlimited --- the No limits switch opens the Ball & Physics section
SECTION_KEYS.ball.push(...UNLIMITED_KEYS);
// --- bounce-math --- the Bounce math block (rules on every bounce, pass, collision, break, beat, bar or second) is part of the Ball & Physics section.
SECTION_KEYS.ball.push(...BOUNCE_MATH_KEYS);
// --- social-publish --- the Publish block (TikTok, Instagram, YouTube) closes the Recording section, after the Viral video bot block.
SECTION_KEYS.recording.push(...PUBLISH_KEYS);

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
  const mod = useModifierKey();
  const site = useTranslations("SiteRedesign");
  const [presetName, setPresetName] = useState("");
  const [midiDrag, setMidiDrag] = useState(false);
  const [wallBreakDrag, setWallBreakDrag] = useState(false);
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);

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

  const matches = (key: string) => {
    if (!search) return true;
    const q = search.toLowerCase();
    const label = t.has(key) ? t(key) : "";
    return key.toLowerCase().includes(q) || label.toLowerCase().includes(q);
  };
  const sectionMatches = (keys: string[]) => !search || keys.some(matches);
  const showAdvanced = advanced || !!search;

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
    // --- beat-drop ---
    beatDrop: t("modeBeatDrop"),
    // --- odd-territory ---
    territory: t("modeTerritory"),
    // --- odd-maze ---
    maze: t("modeMaze"),
    // --- gerald-conveyor ---
    conveyor: t("modeConveyor"),
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

  /** Picture Paint block: in the Mode row while Paint is the mode, and in the Visual section while the search box is in use. */
  const picturePaintSection = () => (
    <PicturePaintSection t={t} search={search} matches={matches} showAdvanced={showAdvanced} settings={s} update={update} picture={props.paintPicture} onUpload={props.onPaintPictureUpload} onRemove={props.onPaintPictureRemove} beat={props.paintBeat} />
  );

  const ballSection = () => (
    <div className="space-y-4">
      {/* --- unlimited --- the No limits switch (every numeric setting past its slider range) */}
      <UnlimitedSection t={t} search={search} matches={matches} settings={s} update={update} />
      {/* --- gerald-faces --- the "Character" group: face, name label, squash, Gerald persona */}
      <CharacterSection t={t} search={search} matches={matches} settings={s} update={update} ballImage={props.ballImage} ballEmoji={props.ballEmoji} />
      <Slider t={t} search={search} matches={matches} labelKey="ballSpeed" tipKey="ballSpeedTip" value={s.ballSpeed} range={RANGES.ballSpeed} onChange={(v) => update({ ballSpeed: v })} />
      <Slider t={t} search={search} matches={matches} labelKey="ballSize" tipKey="ballSizeTip" value={s.ballRadius} range={RANGES.ballRadius} onChange={(v) => update({ ballRadius: v })} display={`${s.ballRadius}px`} />
      {showAdvanced && (
        <Slider t={t} search={search} matches={matches} labelKey="gravity" tipKey="gravityTip" value={s.gravity} range={RANGES.gravity} onChange={(v) => update({ gravity: v })} />
      )}
      {!props.ballImage && !props.ballEmoji && (
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
      )}
      {/* --- teams --- the ball count (1–6) replaced the "Two balls" switch; Color Match takes several balls too */}
      {MULTI_BALL_MODES.includes(s.mode) && <BallCountControl t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-conveyor --- the respawn timer of Classic and Multiply (a new ball drops in every N seconds) */}
      <RespawnControl t={t} search={search} matches={matches} settings={s} update={update} />
      {TWO_BALL_MODES.includes(s.mode) && <BallInteractionSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* The Ball Drop controls live in the Mode row; while searching only the sections render, so they show up here. */}
      {s.mode === "drop" && !!search && <BallDropSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- review fix (ui-i18n) --- the Mode-row controls of the six escape modes (spikes, targets, colours, growth…) */}
      {ESCAPE_MODE_KEYS_BY_MODE[s.mode] && !!search && <EscapeModeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "box" && !!search && <BoxArenaSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "pendulum" && !!search && <PendulumWaveSection t={t} search={search} matches={matches} settings={s} update={update} />}
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
      {/* --- beat-drop --- */}
      {s.mode === "beatDrop" && !!search && <BeatDropSection t={t} search={search} matches={matches} settings={s} update={update} beat={props.paintBeat} beatSource={props.videoBeats?.effective} />}
      {/* --- odd-territory --- */}
      {s.mode === "territory" && !!search && <TerritorySection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- odd-maze --- */}
      {s.mode === "maze" && !!search && <MazeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- gerald-conveyor --- */}
      {s.mode === "conveyor" && !!search && <ConveyorSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {(showsMultipliersSection(s.mode, s.glassGates) || !!search) && <MultipliersSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {showAdvanced && (
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
      {showAdvanced && (
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
      {showAdvanced && <BallPhysicsExtras t={t} search={search} matches={matches} settings={s} update={update} />}
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
        {hasThickness && showAdvanced && (
          <Slider t={t} search={search} matches={matches} labelKey="wallThickness" tipKey="wallThicknessTip" value={s.wallThickness} range={RANGES.wallThickness} onChange={(v) => update({ wallThickness: v })} display={`${s.wallThickness}px`} />
        )}
        {hasGapControls && (
          <>
            {hasGapSize && showAdvanced && (
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
        {showAdvanced && <WallPhysicsExtras t={t} search={search} matches={matches} settings={s} update={update} />}
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
      {showAdvanced && (
        <Searchable search={search} matches={matches} labelKey="cinematic">
          <Toggle t={t} labelKey="cinematic" tipKey="cinematicTip" value={s.cinematicEnabled} onChange={(v) => update({ cinematicEnabled: v })} caseStyle="title" />
        </Searchable>
      )}
      {/* --- rigged --- the director's hard constraints: never escape and the forced winner, with the storytelling warning */}
      {showAdvanced && <RiggedSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* The Picture Paint controls live in the Mode row; while searching only the sections render, so they show up here. */}
      {s.mode === "paint" && !!search && picturePaintSection()}
      {s.showTrails && showAdvanced && (
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
            {showAdvanced && (
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
                  <input
                    type="range"
                    min={RANGES.bpm.min}
                    max={RANGES.bpm.max}
                    step={RANGES.bpm.step}
                    value={s.bpm}
                    onChange={(e) => update({ bpm: Number(e.target.value) })}
                    className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer"
                    style={sliderStyle(s.bpm, RANGES.bpm.min, RANGES.bpm.max)}
                    aria-label={t("bpm")}
                  />
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
        {showAdvanced && (
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
      {!props.simulationFound && (
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
              <input
                type="range"
                min={RANGES.recordingDuration.min}
                max={RANGES.recordingDuration.max}
                step={RANGES.recordingDuration.step}
                value={s.recordingDuration}
                onChange={(e) => update({ recordingDuration: Number(e.target.value) })}
                disabled={props.isRecording}
                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={sliderStyle(s.recordingDuration, RANGES.recordingDuration.min, RANGES.recordingDuration.max)}
                aria-label={t("durationSpan")}
              />
              <NumberField value={s.recordingDuration} onCommit={(v) => update({ recordingDuration: v })} label={t("durationSpan")} range={RANGES.recordingDuration} rules={rulesForRange(RANGES.recordingDuration)} disabled={props.isRecording} settingKey="recordingDuration" /* --- uncap-all --- */ />
            </div>
            <div className="flex justify-between text-xs text-ink-3">
              <span>{t("minDuration")}</span>
              <span>{t("maxDuration")}</span>
            </div>
          </div>
        </Searchable>
      )}
      {showAdvanced && (
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
      {showAdvanced &&
        (
          [
            ["topText", "topTextTip", "topTextPlaceholder", s.topText, (v: string) => update({ topText: v })],
            ["bottomText", "bottomTextTip", "bottomTextPlaceholder", s.bottomText, (v: string) => update({ bottomText: v })],
          ] as const
        ).map(([key, tip, placeholder, value, set]) => (
          <Searchable key={key} search={search} matches={matches} labelKey={key}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-ink-2 flex items-center justify-between" htmlFor={`${key}-input`}>
                <span>
                  {t(key)}
                  <Tooltip text={t(tip)} />
                </span>
                {value && <span className="text-ink-3 text-xs truncate max-w-[120px]">{value}</span>}
              </label>
              <input
                id={`${key}-input`}
                type="text"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={t(placeholder)}
                maxLength={60}
                className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
              />
            </div>
          </Searchable>
        ))}
      {(s.topText || s.bottomText) && showAdvanced && (
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
              <input
                type="range"
                min={RANGES.textSize.min}
                max={RANGES.textSize.max}
                step={RANGES.textSize.step}
                value={s.textSize}
                onChange={(e) => update({ textSize: Number(e.target.value) })}
                className="w-full h-2 bg-surface-2 rounded-lg appearance-none cursor-pointer"
                style={sliderStyle(s.textSize, RANGES.textSize.min, RANGES.textSize.max)}
                aria-label={t("textSize")}
              />
              <NumberField value={s.textSize} onCommit={(v) => update({ textSize: v })} label={t("textSize")} range={RANGES.textSize} rules={rulesForRange(RANGES.textSize)} settingKey="textSize" /* --- uncap-all --- */ />
            </div>
            <div className="flex justify-between text-xs text-ink-3">
              <span>{t("minSize")}</span>
              <span>{t("maxSize")}</span>
            </div>
          </div>
        </Searchable>
      )}
      {/* --- fast-render --- the fast export's frame rate */}
      <FastExportFpsControl t={t} search={search} matches={matches} settings={s} update={update} disabled={props.fastExport?.state.status === "running"} />
      {props.batch && <BatchSection t={t} search={search} matches={matches} batch={props.batch} /> /* --- batch-render --- */}
      {props.bot && <BotSection t={t} search={search} matches={matches} bot={props.bot} /> /* --- viral-bot --- */}
      <PublishSection t={t} search={search} matches={matches} bot={props.bot} /> {/* --- social-publish --- */}
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
      case "grow":
        return <EscapeModeSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "drop":
        return <BallDropSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "box":
        return <BoxArenaSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "pendulum":
        return <PendulumWaveSection t={t} search={search} matches={matches} settings={s} update={update} />;
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
  const railItems: (TabStripItem & { id: StudioSection })[] = [
    { id: "mode", label: t("modeSpan"), icon: <IconGrid /> },
    ...sections,
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
    return [...out, ...paletteControlEntries(groups, (key) => (t.has(key) ? t(key) : null))];
    // The labels follow the language, the entries the mode and the settings that show or hide a control (paletteState).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, t, paletteState, sections.length, !!props.project]);
  const railIcons = Object.fromEntries(railItems.map((item) => [item.id, item.icon])) as Record<string, ReactNode>;

  const choosePalette = (entry: PaletteEntry) => {
    setPaletteOpen(false);
    setSearch("");
    // A control: focus it in its block once the block has rendered. --- review fix (site-redesign) --- one its block does not
    // show right now (an advanced option, the collapsed Project file block, one that waits for another setting) is looked up
    // through the search box at once, so nothing is left pending for a later click to set off. The Project file block sits
    // under the panel, open or not: its entries open no group.
    const project = entry.kind === "control" && PROJECT_KEYS.includes(entry.key);
    if (!project) openGroup(entry.section as StudioSection);
    // (a section's controls are looked for among its own search results – two sections may name a control alike; a mode
    // block's show in the Ball or Visual section's results, the project file's apart, found by their keys and labels)
    const results = project || entry.section === "mode" || entry.section === "presets" ? null : `studio-results-${entry.section}`;
    pendingFocus.current = entry.kind === "control" ? { label: entry.label, key: entry.key, block: project ? "studio-block-project" : `studio-block-${entry.section}`, results, searched: false } : null;
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
      target.el.scrollIntoView({ block: "center" });
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

  const modePanel = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
        <span className="min-w-0 truncate text-md font-medium text-ink">{modeNames[s.mode]}</span>
        {/* --- review fix (site-redesign) --- the kit's small button: a 32 px target (44 px on touch), not a 20 px line of text */}
        <Button variant="ghost" size="sm" onClick={props.onOpenModePicker} aria-haspopup="dialog" className="-my-1 -mr-2 shrink-0">
          {t("modeDisplay")}
        </Button>
      </div>
      {modeSpecific()}
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
    return (
      <div className="space-y-6">
        {modeOpen && block("mode", t("modeSpan"), modePanel())}
        {sectionItem && block(sectionItem.id, sectionItem.label, renderSection(sectionItem.id as ControlSection))}
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


  return (
    <UnlimitedProvider on={s.unlimited /* --- unlimited --- */}>
      <div className="studio" data-studio-active={section ?? (modeOpen ? "mode" : "")}>
        <div className="studio-stage">{props.stage}</div>
        {/* --- review fix (site-redesign) --- a tap outside the open sheet (on the dimmed stage) puts it away */}
        {phone && sheetOpen && <div className="studio-scrim" aria-hidden="true" onClick={() => setSheetOpen(false)} data-testid="studio-scrim" />}
        <div className={cx("studio-desk", sheetOpen && "studio-desk-open")}>
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
              tooltipClassName="studio-rail-tip"
            />
          </div>
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
                <Button variant="ghost" size="sm" className="-ml-2" icon={<IconReset size={16} />} onClick={() => props.onResetSection(resettable)}>
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

/** What the palette may focus: a shown, enabled field, button or link. */
const FOCUSABLE = 'input:not([type="hidden"]), select, textarea, button, a[href], [tabindex]:not([tabindex="-1"])';
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
