"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "./Tooltip";
import { ColorPicker, ResetButton, Searchable, Slider, Toggle, offBtn, onBtn, rainbowBtn, selectClass, sliderStyle } from "./ControlPrimitives";
import BallDropSection, { BALL_DROP_KEYS } from "./sections/BallDropSection";
import BallInteractionSection, { BALL_INTERACTION_KEYS } from "./sections/BallInteractionSection";
import BoxArenaSection, { BOX_ARENA_KEYS } from "./sections/BoxArenaSection";
import CharacterSection, { CHARACTER_KEYS } from "./sections/CharacterSection"; // --- boris-faces ---
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
// --- boris-glass ---
import GlassSection, { GLASS_KEYS } from "./sections/GlassSection";
// --- boris-multipliers ---
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
import WallWobbleSection, { WALL_WOBBLE_KEYS } from "./sections/WallWobbleSection";
import StringBattleSection, { STRING_BATTLE_KEYS } from "./sections/StringBattleSection"; // --- odd-string-battle ---
import PowerLayersSection, { POWER_LAYERS_KEYS } from "./sections/PowerLayersSection"; // --- odd-power-layers --- the Power layers block of the Mode row
import { FAST_EXPORT_KEYS, FastExportButton, FastExportFpsControl, type FastExportPanelProps } from "./sections/FastExportSection"; // --- fast-render ---
import BatchSection, { BATCH_KEYS, type BatchPanelProps } from "./sections/BatchSection"; // --- batch-render ---
// --- project-files --- the "Project file" block (Export / Import project) under Saved Presets
import ProjectSection, { PROJECT_KEYS } from "./sections/ProjectSection";
import type { ProjectPanelProps } from "./useProjectFiles";
import RaceSection, { RACE_KEYS } from "./sections/RaceSection"; // --- jdm-race ---
// --- jdm-arena-games --- the "Arena games" block of the Mode row (Battle Royale, Capture the Flag)
import ArenaGamesSection, { ARENA_GAME_KEYS } from "./sections/ArenaGamesSection";
import { isArenaGameMode } from "@/lib/physics/modes/arenaGames";
// --- jdm-rhythm-runner --- the "Beat runner" and "Paddle keep-up" blocks of the Mode row
import { JDM_RHYTHM_KEYS, PaddleSection, RunnerSection } from "./sections/JdmRhythmSection";
import { isJdmRhythmMode } from "@/lib/physics/modes/jdmRhythm";
import VortexSection, { VORTEX_KEYS } from "./sections/VortexSection"; // --- boris-vortex --- the Vortex block of the Mode row
import BullseyeSection, { BULLSEYE_KEYS } from "./sections/BullseyeSection"; // --- boris-bullseye --- the Bullseye block of the Mode row
import { HIT_SOUND_MODES, type HitSampleStatus } from "@/lib/audio/sampler";
import { INSTRUMENT_IDS, type InstrumentId } from "@/lib/audio/instruments";
import { NOTE_NAMES, QUANTIZE_GRIDS, SCALE_IDS, type ScaleId } from "@/lib/audio/scales";
import { SONGS, WALL_BREAK_SOUNDS } from "@/lib/audio/songs";
import { MODE_WALL_BREAK_SOUNDS } from "@/lib/audio/songs"; // --- boris-glass ---
import { ADVANCED_STORAGE_KEY, RANGES, RESOLUTIONS, defaultSettings, migrateLegacyStorage, type SimulatorSettings } from "@/lib/settings";
import { characterOf } from "@/lib/character/character"; // --- boris-faces ---
import { cameraSettingsOf } from "@/lib/simulation/camera"; // --- camera ---
import { TWO_BALL_MODES } from "@/lib/physics/engine";
import type { ModeId, WallBreakStyle } from "@/lib/physics/types";
import { ACCENT } from "@/lib/site";

// The Slider / Toggle / Searchable building blocks live in ControlPrimitives.tsx so feature sections can share them.
export { sliderStyle };

export type ControlSection = "ball" | "wall" | "visual" | "sound" | "recording" | "teams" | "obstacles" | "captions" | "timeline"; // --- teams --- ("teams") --- obstacle-editor --- ("obstacles") --- captions --- ("captions") --- timeline --- ("timeline")

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
};
SECTION_KEYS.ball.push("ballCount"); // --- teams --- the ball count slider (it replaced the "Two balls" switch)
// --- jdm-polyrhythm --- the Metronomes & Polyrhythms block is searched with the Ball section (like the Pendulum wave block).
SECTION_KEYS.ball.push(...POLYRHYTHM_KEYS);
// --- camera --- the Camera group (zoom, shake, slow motion, replay) is part of the Visual section.
SECTION_KEYS.visual.push(...CAMERA_KEYS);
// --- boris-glass --- the Glass block is searched with the Ball section too.
SECTION_KEYS.ball.push(...GLASS_KEYS);
// --- boris-multipliers --- the Multipliers group of the Ball section and the multipliers-board block of the Mode row.
SECTION_KEYS.ball.push(...MULTIPLIER_KEYS, ...MULTIPLIERS_MODE_KEYS);
// --- rigged --- the Rigged Outcomes group (never escape, forced winner) sits under the Drama Director in the Visual section.
SECTION_KEYS.visual.push(...RIGGED_KEYS);
// --- jdm-double-pendulum --- the "Double pendulum" block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...DOUBLE_PENDULUM_KEYS);
// --- jdm-illusions --- the Circle Illusion block is searched with the Ball section, Wobbly Walls with the Visual section.
SECTION_KEYS.ball.push(...ILLUSION_KEYS);
SECTION_KEYS.visual.push(...WALL_WOBBLE_KEYS);
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
// --- boris-vortex --- the Vortex block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...VORTEX_KEYS);
// --- boris-bullseye --- the Bullseye block of the Mode row is searched with the Ball section too.
SECTION_KEYS.ball.push(...BULLSEYE_KEYS);

export default function Controls(props: ControlsProps) {
  const { settings: s, update } = props;
  const t = useTranslations("Controls");
  const [openSection, setOpenSection] = useState<ControlSection | null>(null);
  const [modeOpen, setModeOpen] = useState(true);
  const [presetsOpen, setPresetsOpen] = useState(false);
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
    // --- boris-glass ---
    glass: t("modeGlass"),
    // --- boris-multipliers ---
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
    // --- boris-vortex ---
    vortex: t("modeVortex"),
    // --- boris-bullseye ---
    bullseye: t("modeBullseye"),
  };

  const sections: { id: ControlSection; icon: string; label: string }[] = [
    { id: "ball", icon: "🎱", label: t("ballPhysicsTab") },
    { id: "wall", icon: "🔵", label: t("wallSettingsTab") },
    { id: "visual", icon: "✨", label: t("visualEffectsTab") },
    { id: "sound", icon: "🔊", label: t("customSoundTab") },
    { id: "recording", icon: "🎬", label: t("recordingTab") },
    { id: "teams", icon: "🏆", label: t("teamsTab") }, // --- teams ---
  ];
  // --- obstacle-editor --- the Obstacles section, in the ring modes (the layout is kept, unused, in the others)
  if (supportsObstacles(s.mode)) sections.push({ id: "obstacles", icon: "🚧", label: t("obstaclesTab") });
  sections.push({ id: "captions", icon: "💬", label: t("captionsTab") }); // --- captions --- (every mode, after the playfield sections)
  sections.push({ id: "timeline", icon: "⏱️", label: t("timelineTab") }); // --- timeline --- (every mode)

  /* ------------------------------------------------------------ sections */

  /** Picture Paint block: in the Mode row while Paint is the mode, and in the Visual section while the search box is in use. */
  const picturePaintSection = () => (
    <PicturePaintSection t={t} search={search} matches={matches} showAdvanced={showAdvanced} settings={s} update={update} picture={props.paintPicture} onUpload={props.onPaintPictureUpload} onRemove={props.onPaintPictureRemove} beat={props.paintBeat} />
  );

  const ballSection = () => (
    <div className="space-y-4">
      <ResetButton search={search} t={t} section="ball" onReset={props.onResetSection} />
      {/* --- boris-faces --- the "Character" group: face, name label, squash, Boris persona */}
      <CharacterSection t={t} search={search} matches={matches} settings={s} update={update} ballImage={props.ballImage} ballEmoji={props.ballEmoji} />
      <Slider t={t} search={search} matches={matches} labelKey="ballSpeed" tipKey="ballSpeedTip" value={s.ballSpeed} range={RANGES.ballSpeed} onChange={(v) => update({ ballSpeed: v })} left="🐢" right="🚀" />
      <Slider t={t} search={search} matches={matches} labelKey="ballSize" tipKey="ballSizeTip" value={s.ballRadius} range={RANGES.ballRadius} onChange={(v) => update({ ballRadius: v })} display={`${s.ballRadius}px`} left="🌑" right="🌕" />
      {showAdvanced && (
        <Slider t={t} search={search} matches={matches} labelKey="gravity" tipKey="gravityTip" value={s.gravity} range={RANGES.gravity} onChange={(v) => update({ gravity: v })} left="🎈" right="🪨" />
      )}
      {!props.ballImage && !props.ballEmoji && (
        <Searchable search={search} matches={matches} labelKey="ballColor">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-300">{t("ballColor")}</label>
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
      {TWO_BALL_MODES.includes(s.mode) && <BallInteractionSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* The Ball Drop controls live in the Mode row; while searching only the sections render, so they show up here. */}
      {s.mode === "drop" && !!search && <BallDropSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "box" && !!search && <BoxArenaSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "pendulum" && !!search && <PendulumWaveSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {s.mode === "polyrhythm" && !!search && <PolyrhythmSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- jdm-collisions --- */}
      {s.mode === "collide" && !!search && <CollisionPlaygroundSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- boris-glass --- */}
      {s.mode === "glass" && !!search && <GlassSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- boris-multipliers --- pickups, cap and smash threshold; the board block while searching */}
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
      {/* --- boris-vortex --- */}
      {s.mode === "vortex" && !!search && <VortexSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {/* --- boris-bullseye --- */}
      {s.mode === "bullseye" && !!search && <BullseyeSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {(showsMultipliersSection(s.mode, s.glassGates) || !!search) && <MultipliersSection t={t} search={search} matches={matches} settings={s} update={update} />}
      {showAdvanced && (
        <Searchable search={search} matches={matches} labelKey="bouncier">
          <Toggle t={t} labelKey="bouncier" tipKey="bouncierTip" value={s.bouncierEnabled} onChange={(v) => update({ bouncierEnabled: v })} caseStyle="title" />
        </Searchable>
      )}
      <Searchable search={search} matches={matches} labelKey="ballEmoji">
        <div className="space-y-3">
          <label className="text-sm font-medium text-zinc-300">{t("ballEmoji")}</label>
          <div className="grid grid-cols-6 gap-1.5">
            {EMOJIS.map((emoji) => (
              <button
                type="button"
                key={emoji}
                onClick={() => props.onBallEmojiChange(props.ballEmoji === emoji ? null : emoji)}
                aria-label={emoji}
                className={`flex items-center justify-center w-full aspect-square rounded-lg text-xl transition-all cursor-pointer ${
                  props.ballEmoji === emoji
                    ? `bg-[#93d119]/30 border-2 border-[#93d119] shadow-lg shadow-[#93d119]/20 scale-110`
                    : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 hover:border-zinc-500 hover:scale-105"
                }`}
              >
                {emoji}
              </button>
            ))}
          </div>
          {props.ballEmoji && (
            <button type="button" onClick={() => props.onBallEmojiChange(null)} className="text-xs text-zinc-500 hover:text-red-400 transition-colors cursor-pointer">
              ✕ {t("removeEmoji")}
            </button>
          )}
        </div>
      </Searchable>
      {showAdvanced && (
        <Searchable search={search} matches={matches} labelKey="customBallImage">
          <div className="space-y-3">
            <label className="text-sm font-medium text-zinc-300">{t("customBallImage")}</label>
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
                <button type="button" onClick={props.onBallImageClear} className="text-zinc-500 hover:text-red-400 transition-colors text-sm cursor-pointer" title={t("removeCustomImage")}>
                  ✕
                </button>
              </div>
            ) : (
              <label className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-sm cursor-pointer border border-dashed bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500">
                <span>📁 {t("chooseImageFile")}</span>
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
    const hasWallCount = !["lines", "accumulation", "multiply", "paint", "target", "colorMatch", "drop", "box", "pendulum", "polyrhythm", "collide", "glass", "multipliers", "doublePendulum", "illusion", "race", "stringBattle", "powerLayers", "vortex", "bullseye"].includes(s.mode) && !isArenaGameMode(s.mode) && !isJdmRhythmMode(s.mode); // --- jdm-illusions --- (illusion) --- jdm-race --- (race) --- jdm-arena-games --- (battle, ctf) --- odd-string-battle --- (stringBattle) --- odd-power-layers --- (powerLayers) --- boris-vortex --- (vortex) --- boris-bullseye --- (bullseye)
    const hasGapControls = !["lines", "paint", "target", "colorMatch", "shatter", "drop", "box", "pendulum", "polyrhythm", "collide", "glass", "multipliers", "doublePendulum", "illusion", "race", "stringBattle", "powerLayers", "vortex", "bullseye"].includes(s.mode) && !isArenaGameMode(s.mode) && !isJdmRhythmMode(s.mode); // --- jdm-illusions --- (illusion) --- jdm-race --- (race) --- jdm-arena-games --- (battle, ctf) --- odd-string-battle --- (stringBattle) --- odd-power-layers --- (powerLayers) --- boris-vortex --- (vortex) --- boris-bullseye --- (bullseye)
    // Ball Drop, Bouncing Shapes, Pendulum Wave, Metronomes & Polyrhythms and the Collision Playground have no rings, but their pegs, bars, box walls, rigs, guides and containers are drawn with the wall thickness.
    const hasThickness = hasGapControls || s.mode === "drop" || s.mode === "box" || s.mode === "pendulum" || s.mode === "polyrhythm" || s.mode === "collide" || s.mode === "glass" || s.mode === "multipliers" || s.mode === "doublePendulum" || s.mode === "illusion" || s.mode === "race" || isArenaGameMode(s.mode) || s.mode === "stringBattle" || s.mode === "vortex" || s.mode === "bullseye"; // --- jdm-double-pendulum --- (strings and rods) --- jdm-illusions --- (illusion) --- jdm-race --- (walls, arms) --- jdm-arena-games --- (the arena walls) --- odd-string-battle --- (the ring) --- boris-vortex --- (the sound rings) --- boris-bullseye --- (the walls, the landing line, the target's rim)
    return (
      <div className="space-y-4">
        <ResetButton search={search} t={t} section="wall" onReset={props.onResetSection} />
        {hasWallCount && (
          <Slider t={t} search={search} matches={matches} labelKey="wallCount" tipKey="wallCountTip" value={s.wallCount} range={RANGES.wallCount} onChange={(v) => update({ wallCount: v })} />
        )}
        {hasThickness && showAdvanced && (
          <Slider t={t} search={search} matches={matches} labelKey="wallThickness" tipKey="wallThicknessTip" value={s.wallThickness} range={RANGES.wallThickness} onChange={(v) => update({ wallThickness: v })} display={`${s.wallThickness}px`} left="−" right="+" />
        )}
        {hasGapControls && (
          <>
            {showAdvanced && (
              <Slider t={t} search={search} matches={matches} labelKey="gapSize" tipKey="gapSizeTip" value={s.gapSize} range={RANGES.gapSize} onChange={(v) => update({ gapSize: v })} display={s.gapSize.toFixed(2)} left="🤏" right="👐" />
            )}
            <Searchable search={search} matches={matches} labelKey="rotation">
              <div className="space-y-2">
                <Toggle t={t} labelKey="rotation" tipKey="rotationTip" value={s.rotationEnabled} onChange={(v) => update({ rotationEnabled: v })} />
                {s.rotationEnabled && (
                  <>
                    <label className="text-sm font-medium text-zinc-300 flex items-center justify-between mt-2">
                      <span>{t("rotationSpeed")}</span>
                      {/* --- timeline --- the live value with the AUTO badge while keyframes drive the rotation speed */}
                      <TimelineValueText t={t} labelKey="rotationSpeed" fallback={s.rotationSpeed.toFixed(1)} />
                    </label>
                    <TimelineRangeInput
                      labelKey="rotationSpeed"
                      value={s.rotationSpeed}
                      range={RANGES.rotationSpeed}
                      onChange={(v) => update({ rotationSpeed: v })}
                      className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                      ariaLabel={t("rotationSpeed")}
                    />
                  </>
                )}
              </div>
            </Searchable>
          </>
        )}
        <Searchable search={search} matches={matches} labelKey="wallColor">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-zinc-300">{t("wallColor")}</label>
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
                    className={`flex-1 px-2 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowWallMode === mode ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
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
      <ResetButton search={search} t={t} section="visual" onReset={props.onResetSection} />
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
          📷 {t("cameraFollow")}
          <Tooltip text={t("cameraFollowTip")} />
        </button>
      </Searchable>
      {/* --- camera --- the Camera group: zoom toward the ball, screen shake, slow motion on near misses, escape replay */}
      <CameraSection t={t} search={search} matches={matches} settings={s} update={update} />
      {/* --- jdm-illusions --- Wobbly Walls: circular walls deform where a ball hits them (ring modes, Circle Illusion) */}
      <WallWobbleSection t={t} search={search} matches={matches} settings={s} update={update} />
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
          <label className="text-sm font-medium text-zinc-300">
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
                className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.wallBreakStyle === value ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
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
        <ResetButton search={search} t={t} section="sound" onReset={props.onResetSection} />
        <Searchable search={search} matches={matches} labelKey="hitSoundMode">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
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
                  className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.hitSoundMode === mode ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                >
                  {mode === "tones" ? `🎹 ${t("hitSoundModeTones")}` : `🎧 ${t("hitSoundModeSample")}`}
                </button>
              ))}
            </div>
          </div>
        </Searchable>
        {showToneControls && (
          <Searchable search={search} matches={matches} labelKey="instrument">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300" htmlFor="instrument-select">
                {t("instrument")}
              </label>
              <p className="text-xs text-zinc-500 leading-relaxed">{t("instrumentDesc")}</p>
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
                <label className="text-sm font-medium text-zinc-300" htmlFor="song-select">
                  {t("song")}
                </label>
                <p className="text-xs text-zinc-500 leading-relaxed">{t("customSoundDesc")}</p>
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
                      {props.customMidiName || "Uploaded MIDI"} ({props.customSoundNoteCount} {t("notesLoaded")})
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
                  <label className="text-sm font-medium text-zinc-300" htmlFor="melody-instrument-select">
                    {t("melodyInstrument")}
                  </label>
                  <p className="text-xs text-zinc-500 leading-relaxed">{t("melodyInstrumentDesc")}</p>
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
                  <label className="text-sm font-medium text-zinc-300">{t("importMidi")}</label>
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
                      midiDrag ? `bg-[#93d119]/10 border-[#93d119] text-[#93d119] scale-[1.02] shadow-lg` : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500"
                    }`}
                  >
                    <span className="text-lg">{midiDrag ? "📥" : "📁"}</span>
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
                  <p className="text-[11px] text-zinc-500 mt-1 flex items-start gap-1">
                    <span className="leading-none mt-0.5">💡</span>
                    <span>
                      {t("midiSourceText")}{" "}
                      <a href="https://bitmidi.com" target="_blank" rel="noopener noreferrer" className={`text-[#93d119] hover:text-[#7fb315] underline font-medium`}>
                        bitmidi.com ↗
                      </a>
                    </span>
                  </p>
                </div>
              </Searchable>
            )}
            {props.customSoundLoading && (
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <div className={`w-4 h-4 border-2 border-[#93d119] border-t-transparent rounded-full animate-spin`} />
                {t("loadingMidi")}
              </div>
            )}
          </>
        )}
        <Searchable search={search} matches={matches} labelKey="scale">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300" htmlFor="scale-select">
              {t("scale")}
            </label>
            <p className="text-xs text-zinc-500 leading-relaxed">{t("scaleDesc")}</p>
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
              <label className="text-sm font-medium text-zinc-300">{t("rootNote")}</label>
              <div className="grid grid-cols-6 gap-1" role="group" aria-label={t("rootNote")}>
                {NOTE_NAMES.map((name, index) => (
                  <button
                    type="button"
                    key={name}
                    onClick={() => update({ rootNote: index })}
                    aria-pressed={s.rootNote === index}
                    className={`px-1 py-1 rounded-md text-xs font-mono font-medium transition-all cursor-pointer ${s.rootNote === index ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
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
            <p className="text-xs text-zinc-500 leading-relaxed">{t("beatLockDesc")}</p>
            {s.quantizeToBeat && (
              <>
                <label className="text-sm font-medium text-zinc-300 flex items-center justify-between mt-2">
                  <span>{t("bpm")}</span>
                  <span className="text-zinc-500">{s.bpm}</span>
                </label>
                <input
                  type="range"
                  min={RANGES.bpm.min}
                  max={RANGES.bpm.max}
                  step={RANGES.bpm.step}
                  value={s.bpm}
                  onChange={(e) => update({ bpm: Number(e.target.value) })}
                  className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
                  style={sliderStyle(s.bpm, RANGES.bpm.min, RANGES.bpm.max)}
                  aria-label={t("bpm")}
                />
              </>
            )}
          </div>
        </Searchable>
        {(s.quantizeToBeat || search) && (
          <Searchable search={search} matches={matches} labelKey="quantizeGrid">
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium text-zinc-300">{t("quantizeGrid")}</label>
              <div className="flex gap-1" role="group" aria-label={t("quantizeGrid")}>
                {QUANTIZE_GRIDS.map((grid) => (
                  <button
                    type="button"
                    key={grid}
                    onClick={() => update({ quantizeGrid: grid })}
                    aria-pressed={s.quantizeGrid === grid}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${s.quantizeGrid === grid ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
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
        <Searchable search={search} matches={matches} labelKey="wallBreakSound">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300" htmlFor="wallbreak-select">
              {t("wallBreakSound")}
            </label>
            <p className="text-xs text-zinc-500 leading-relaxed">{t("wallBreakSoundDesc")}</p>
            <select id="wallbreak-select" value={s.wallBreakSound || ""} onChange={(e) => update({ wallBreakSound: e.target.value || null })} className={selectClass}>
              {/* --- boris-glass --- a mode with its own default clip (Glass Smash) names it */}
              <option value="">{MODE_WALL_BREAK_SOUNDS[s.mode] ? t("wallBreakSoundModeDefault", { name: WALL_BREAK_SOUNDS.find((snd) => snd.id === MODE_WALL_BREAK_SOUNDS[s.mode])?.name ?? "" }) : t("wallBreakSoundDefault")}</option>
              {WALL_BREAK_SOUNDS.map((snd) => (
                <option key={snd.id} value={snd.url}>
                  {snd.name}
                </option>
              ))}
              {s.wallBreakSound?.startsWith("blob:") && <option value={s.wallBreakSound}>{props.customWallBreakName || "Custom"}</option>}
            </select>
          </div>
        </Searchable>
        {showAdvanced && (
          <Searchable search={search} matches={matches} labelKey="importWallBreak">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">{t("importWallBreak")}</label>
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
                  wallBreakDrag ? `bg-[#93d119]/10 border-[#93d119] text-[#93d119] scale-[1.02] shadow-lg` : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500"
                }`}
              >
                <span className="text-lg">📁</span>
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
      <ResetButton search={search} t={t} section="recording" onReset={props.onResetSection} />
      <Searchable search={search} matches={matches} labelKey="videoResolution">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="resolution-select">
            {t("resolutionTitle")}
          </label>
          <select
            id="resolution-select"
            value={s.recordingResolution}
            onChange={(e) => update({ recordingResolution: e.target.value })}
            disabled={props.isRecording}
            className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
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
            <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
              <span>
                {t("durationSpan")}
                <Tooltip text={t("durationTip")} />
              </span>
              <span className="text-zinc-500">{s.recordingDuration}s</span>
            </label>
            <div className="flex items-center gap-2">
              <span className="text-sm">⏱️</span>
              <input
                type="range"
                min={RANGES.recordingDuration.min}
                max={RANGES.recordingDuration.max}
                step={RANGES.recordingDuration.step}
                value={s.recordingDuration}
                onChange={(e) => update({ recordingDuration: Number(e.target.value) })}
                disabled={props.isRecording}
                className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                style={sliderStyle(s.recordingDuration, RANGES.recordingDuration.min, RANGES.recordingDuration.max)}
                aria-label={t("durationSpan")}
              />
              <span className="text-sm">⏳</span>
            </div>
            <div className="flex justify-between text-xs text-zinc-500">
              <span>{t("minDuration")}</span>
              <span>{t("maxDuration")}</span>
            </div>
          </div>
        </Searchable>
      )}
      {showAdvanced && (
        <Searchable search={search} matches={matches} labelKey="customWatermark">
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <label className="text-sm font-medium text-zinc-300 flex items-center justify-between" htmlFor="watermark-input">
              <span>
                {t("customWatermark")}
                <Tooltip text={t("watermarkTip")} />
              </span>
              {s.watermarkText && <span className="text-zinc-500 text-xs truncate max-w-[120px]">{s.watermarkText}</span>}
            </label>
            <input
              id="watermark-input"
              type="text"
              value={s.watermarkText}
              onChange={(e) => update({ watermarkText: e.target.value })}
              placeholder={t("enterWatermark")}
              maxLength={50}
              className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
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
              <label className="text-sm font-medium text-zinc-300 flex items-center justify-between" htmlFor={`${key}-input`}>
                <span>
                  {t(key)}
                  <Tooltip text={t(tip)} />
                </span>
                {value && <span className="text-zinc-500 text-xs truncate max-w-[120px]">{value}</span>}
              </label>
              <input
                id={`${key}-input`}
                type="text"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder={t(placeholder)}
                maxLength={60}
                className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
              />
            </div>
          </Searchable>
        ))}
      {(s.topText || s.bottomText) && showAdvanced && (
        <Searchable search={search} matches={matches} labelKey="textSize">
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
              <span>
                {t("textSize")}
                <Tooltip text={t("textSizeTip")} />
              </span>
              <span className="text-zinc-500">{s.textSize.toFixed(1)}×</span>
            </label>
            <input
              type="range"
              min={RANGES.textSize.min}
              max={RANGES.textSize.max}
              step={RANGES.textSize.step}
              value={s.textSize}
              onChange={(e) => update({ textSize: Number(e.target.value) })}
              className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer"
              style={sliderStyle(s.textSize, RANGES.textSize.min, RANGES.textSize.max)}
              aria-label={t("textSize")}
            />
            <div className="flex justify-between text-xs text-zinc-500">
              <span>{t("minSize")}</span>
              <span>{t("maxSize")}</span>
            </div>
          </div>
        </Searchable>
      )}
      {/* --- fast-render --- the fast export's frame rate */}
      <FastExportFpsControl t={t} search={search} matches={matches} settings={s} update={update} disabled={props.fastExport?.state.status === "running"} />
      {props.batch && <BatchSection t={t} search={search} matches={matches} batch={props.batch} /> /* --- batch-render --- */}
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
    }
  };

  /* Mode-specific controls shown inside the Mode row. */
  const modeSpecific = () => {
    switch (s.mode) {
      case "accumulation":
        return (
          <div className="space-y-3 pt-2">
            <Slider t={t} search={search} matches={matches} labelKey="accumulationEscape" tipKey="accumulationEscapeTip" value={s.accumulationTime} range={RANGES.accumulationTime} onChange={(v) => update({ accumulationTime: v })} display={`${s.accumulationTime}s`} />
            <Toggle t={t} labelKey="spikes" tipKey="spikesTip" value={s.spikesEnabled} onChange={(v) => update({ spikesEnabled: v })} onClass="bg-red-600 text-white" />
            {s.spikesEnabled && (
              <Slider t={t} search={search} matches={matches} labelKey="spikeCount" tipKey="spikeCountTip" value={s.spikeCount} range={RANGES.spikeCount} onChange={(v) => update({ spikeCount: v })} />
            )}
          </div>
        );
      case "multiply":
        return (
          <div className="space-y-3 pt-2">
            <Slider t={t} search={search} matches={matches} labelKey="spawnCount" tipKey="spawnCountTip" value={s.multiplySpawnCount} range={RANGES.multiplySpawnCount} onChange={(v) => update({ multiplySpawnCount: v })} />
          </div>
        );
      case "lines":
        return (
          <div className="space-y-3 pt-2">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-zinc-300">{t("lineColor")}</label>
                <button type="button" onClick={() => update({ rainbowLines: !s.rainbowLines })} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowLines ? rainbowBtn : offBtn}`}>
                  {t("rainbowSettings")}
                </button>
              </div>
              {!s.rainbowLines && <ColorPicker value={s.lineColor} onChange={(v) => update({ lineColor: v })} label={t("lineColor")} />}
            </div>
            <div className="pt-2 border-t border-zinc-800/60">
              <Toggle t={t} labelKey="centerDot" tipKey="centerDotTip" value={s.linesCenterDot} onChange={(v) => update({ linesCenterDot: v })} />
            </div>
          </div>
        );
      case "target":
        return (
          <div className="space-y-3 pt-2">
            <Slider t={t} search={search} matches={matches} labelKey="targetCount" tipKey="targetCountTip" value={s.targetCount} range={RANGES.targetCount} onChange={(v) => update({ targetCount: v })} />
            <Toggle t={t} labelKey="randomOrder" tipKey="randomOrderTip" value={s.countdownRandom} onChange={(v) => update({ countdownRandom: v })} onClass="bg-yellow-600 text-white" />
          </div>
        );
      case "colorMatch":
        return (
          <div className="space-y-3 pt-2">
            <Slider t={t} search={search} matches={matches} labelKey="colorCount" tipKey="colorCountTip" value={s.colorMatchColorCount} range={RANGES.colorMatchColorCount} onChange={(v) => update({ colorMatchColorCount: v })} />
          </div>
        );
      case "grow":
        return (
          <div className="space-y-3 pt-2">
            <Slider t={t} search={search} matches={matches} labelKey="growthRate" tipKey="growthRateTip" value={s.growRate} range={RANGES.growRate} onChange={(v) => update({ growRate: v })} display={`${s.growRate}%`} />
            <Toggle t={t} labelKey="centerDot" tipKey="centerDotTip" value={s.growCenterDot} onChange={(v) => update({ growCenterDot: v })} />
            <Toggle t={t} labelKey="growLines" tipKey="growLinesTip" value={s.growLines} onChange={(v) => update({ growLines: v })} />
            {s.growLines && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-zinc-300">{t("lineColor")}</label>
                  <button type="button" onClick={() => update({ rainbowLines: !s.rainbowLines })} className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.rainbowLines ? rainbowBtn : offBtn}`}>
                    {t("rainbowSettings")}
                  </button>
                </div>
                {!s.rainbowLines && <ColorPicker value={s.lineColor} onChange={(v) => update({ lineColor: v })} label={t("lineColor")} />}
              </div>
            )}
          </div>
        );
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
      // --- boris-glass ---
      case "glass":
        return <GlassSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- boris-multipliers ---
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
      // --- boris-vortex ---
      case "vortex":
        return <VortexSection t={t} search={search} matches={matches} settings={s} update={update} />;
      // --- boris-bullseye ---
      case "bullseye":
        return <BullseyeSection t={t} search={search} matches={matches} settings={s} update={update} />;
      case "paint":
        return <div className="space-y-3 pt-2">{picturePaintSection()}</div>;
      default:
        return null;
    }
  };

  const anyResults = (Object.keys(SECTION_KEYS) as ControlSection[]).some((id) => sectionMatches(SECTION_KEYS[id])) || (!!props.project && PROJECT_KEYS.some(matches)); // --- project-files ---

  return (
    <div className="bg-zinc-900/90 backdrop-blur-sm rounded-lg p-4 space-y-2 border border-zinc-800">
      <h2 className="text-lg font-bold text-white mb-2">{t("controlsTitle")}</h2>
      <button
        type="button"
        onClick={props.onRecordToggle}
        disabled={!props.recordingSupported}
        className={`w-full px-4 py-3.5 my-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
          props.isRecording
            ? "bg-red-600 text-white/90 animate-pulse hover:bg-red-700 shadow-red-600/20"
            : "bg-gradient-to-r from-cyan-600 to-cyan-500 text-slate-950 hover:from-cyan-500 hover:to-cyan-400 shadow-cyan-600/20"
        }`}
      >
        {props.isRecording ? (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>{" "}
            {t("stopExport")}
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" />
              <rect x="2" y="6" width="14" height="12" rx="2" />
            </svg>{" "}
            {t("recordVideo")}
          </>
        )}
      </button>
      {props.fastExport && <FastExportButton {...props.fastExport} /> /* --- fast-render --- */}

      <div className="relative mb-1">
        <input
          type="text"
          placeholder={t("searchSettings")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label={t("searchSettings")}
          className="w-full pl-9 pr-8 py-2 bg-zinc-800/60 text-sm text-white rounded-lg border border-zinc-700/80 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 transition-all cursor-text focus:bg-zinc-800 focus:shadow-[0_0_12px_rgba(147,209,25,0.15)]"
        />
        <span className="absolute left-3 top-2.5 text-zinc-500 text-sm">🔍</span>
        {search && (
          <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors cursor-pointer" aria-label={t("clearSearch")}>
            ✕
          </button>
        )}
      </div>

      {search ? (
        <div className="space-y-4 pt-2 border-t border-zinc-800/80 animate-fadeIn">
          <div className="flex justify-between items-center">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">{t("searchResults")}</span>
            <button type="button" onClick={() => setSearch("")} className={`text-xs text-[#93d119] hover:text-[#7fb315] font-medium cursor-pointer`}>
              ✕ {t("clearSearch")}
            </button>
          </div>
          <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 custom-scrollbar">
            {!anyResults && <p className="text-xs text-zinc-500 text-center py-4">{t("noSearchResults")}</p>}
            {(Object.keys(SECTION_KEYS) as ControlSection[]).map((id) => sectionMatches(SECTION_KEYS[id]) && <div key={id}>{renderSection(id)}</div>)}
            {props.project && <ProjectSection t={t} search={search} matches={matches} project={props.project} /> /* --- project-files --- */}
          </div>
        </div>
      ) : (
        <>
          <div>
            <button
              type="button"
              onClick={() => setModeOpen((v) => !v)}
              aria-expanded={modeOpen}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer border border-transparent hover:border-zinc-700"
            >
              <span>🎮</span>
              <span>{t("modeSpan")}</span>
              <span className="text-zinc-500 ml-auto">{modeOpen ? "−" : "+"}</span>
            </button>
            {modeOpen && (
              <div className="px-4 pt-2 pb-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700">
                    <span className="text-white font-medium text-sm">{modeNames[s.mode]}</span>
                    <a
                      href="#modes"
                      onClick={(e) => {
                        e.preventDefault();
                        document.getElementById("modes")?.scrollIntoView({ behavior: "smooth" });
                      }}
                      className={`text-xs text-[#93d119] hover:text-[#7fb315] transition-colors`}
                    >
                      {t("modeDisplay")}
                    </a>
                  </div>
                  {modeSpecific()}
                </div>
              </div>
            )}
          </div>
          {sections.map((section) => (
            <div key={section.id}>
              <button
                type="button"
                onClick={() => setOpenSection(openSection === section.id ? null : section.id)}
                aria-expanded={openSection === section.id}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer border border-transparent hover:border-zinc-700"
              >
                <span>{section.icon}</span>
                <span>{section.label}</span>
                <span className="text-zinc-500 ml-auto">{openSection === section.id ? "−" : "+"}</span>
              </button>
              {openSection === section.id && <div className="px-4 pt-2 pb-3">{renderSection(section.id)}</div>}
            </div>
          ))}
          <div>
            <button
              type="button"
              onClick={() => setPresetsOpen((v) => !v)}
              aria-expanded={presetsOpen}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-all cursor-pointer border border-transparent hover:border-zinc-700"
            >
              <span>💾</span>
              <span>{t("savedPresetsSpan")}</span>
              <span className="text-zinc-500 ml-auto">{presetsOpen ? "−" : "+"}</span>
            </button>
            {presetsOpen && (
              <div className="px-4 pt-2 pb-3 space-y-3">
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
                    className="flex-1 px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (presetName.trim()) {
                        props.onSavePreset(presetName.trim());
                        setPresetName("");
                      }
                    }}
                    disabled={!presetName.trim()}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-all bg-[#93d119] text-slate-950 hover:bg-[#7fb315] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer`}
                  >
                    {t("saveBtn")}
                  </button>
                </div>
                {props.savedPresetNames.length === 0 ? (
                  <p className="text-xs text-zinc-500 text-center py-2">{t("noSavedPresets")}</p>
                ) : (
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {props.savedPresetNames.map((name) => (
                      <div key={name} className="flex items-center gap-2 px-3 py-2 bg-zinc-800/60 rounded-lg group">
                        <span className="flex-1 text-sm text-zinc-300 truncate">{name}</span>
                        <button type="button" onClick={() => props.onLoadPreset(name)} className={`px-2 py-1 rounded text-xs font-medium bg-[#93d119]/80 text-slate-950 hover:bg-[#93d119] transition-all cursor-pointer`}>
                          {t("loadBtn")}
                        </button>
                        <button
                          type="button"
                          onClick={() => props.onDeletePreset(name)}
                          aria-label={t("deletePreset")}
                          className="px-2 py-1 rounded text-xs font-medium bg-red-600/80 text-white hover:bg-red-600 transition-all opacity-0 group-hover:opacity-100 focus:opacity-100 cursor-pointer"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {props.project && <ProjectSection t={t} search="" matches={matches} project={props.project} /> /* --- project-files --- */}
        </>
      )}

      <div className="pt-4 mt-2 border-t border-zinc-800/80">
        <label className="flex items-center gap-2 cursor-pointer group px-2 w-fit">
          <input
            type="checkbox"
            checked={advanced}
            onChange={(e) => setAdvancedPersist(e.target.checked)}
            className="w-4 h-4 rounded bg-zinc-800 border-zinc-700 cursor-pointer"
            style={{ accentColor: ACCENT }}
          />
          <span className="text-sm font-medium text-zinc-400 group-hover:text-zinc-300 transition-colors cursor-pointer">{t("showAdvancedOptions")}</span>
        </label>
      </div>
    </div>
  );
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
        ballInteraction: d.ballInteraction,
        splitMinRadius: d.splitMinRadius,
        maxBalls: d.maxBalls,
        rainbowBall: d.rainbowBall,
        airDrag: d.airDrag,
        windX: d.windX,
        windY: d.windY,
        spinStrength: d.spinStrength,
        rotatingGravity: d.rotatingGravity,
        ...characterOf(d), // --- boris-faces ---
        ballCount: d.ballCount, // --- teams --- (a team roster keeps its balls: see the Teams section)
        ...multiplierConfigOf(d), // --- boris-multipliers --- pickups, cap, smash threshold
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
  }
}
