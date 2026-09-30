"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale, useMessages } from "next-intl"; // --- viral-bot ---
import { useViralBot } from "./useViralBot"; // --- viral-bot ---
import { isBotLocale, type BotCopy } from "@/lib/bot/copy"; // --- viral-bot ---
import { parseSeed } from "@/lib/recording/batch"; // --- viral-bot ---
import { useSearchParams } from "next/navigation";
import Canvas, { type CanvasHandle, type CanvasLabels } from "./Canvas";
import Controls, { sectionDefaults, sliderStyle, type ControlSection } from "./Controls";
import type { MusicTrackInfo } from "./sections/MusicSection";
import type { PaintBeatInfo, PaintPictureInfo } from "./sections/PicturePaintSection";
import type { ThemeImageInfo, ThemeImageProps } from "./sections/ThemeSection"; // --- themes
import Tooltip from "./Tooltip";
import { PhysicsEngine } from "@/lib/physics/engine"; // --- teams --- (the two-ball switch became the ball count: MULTI_BALL_MODES below)
import { physicsExtrasOf } from "@/lib/physics/extras";
import { ballInteractionOf } from "@/lib/physics/interactions";
import { boxSettingsOf } from "@/lib/physics/modes/box";
import { dropSettingsOf } from "@/lib/physics/modes/drop";
import { pendulumSettingsOf } from "@/lib/physics/modes/pendulum";
import { parseCustomRatios, polyrhythmSettingsOf } from "@/lib/physics/modes/polyrhythm"; // --- jdm-polyrhythm ---
// --- jdm-collisions ---
import { collideSettingsOf } from "@/lib/physics/modes/collide";
// --- boris-glass ---
import { glassSettingsOf } from "@/lib/physics/modes/glass";
import { modeWallBreakSound } from "@/lib/audio/songs";
// --- boris-multipliers ---
import { multiplierConfigOf } from "@/lib/physics/multipliers";
import { multipliersSettingsOf } from "@/lib/physics/modes/multipliers";
import { illusionSettingsOf } from "@/lib/physics/modes/illusion"; // --- jdm-illusions ---
import { stringBattleSettingsOf } from "@/lib/physics/modes/stringBattle"; // --- odd-string-battle ---
import { paintTargetSeconds } from "@/lib/physics/picturePaint";
import type { ModeId } from "@/lib/physics/types";
import { analyzeBeatsAsync, type BeatAnalysis } from "@/lib/audio/beats";
import { CUSTOM_HIT_SAMPLE_ID, builtInHitSampleUrl, type HitSampleStatus } from "@/lib/audio/sampler";
import { ToneGenerator, type MusicSettings } from "@/lib/audio/toneGenerator";
import { loadMidiFrequencies, parseMidiToFrequencies } from "@/lib/audio/midi";
import { SONGS } from "@/lib/audio/songs";
import { VideoRecorder } from "@/lib/recording/recorder";
import { particlePalette, themeById, themeCarryOver } from "@/lib/themes"; // --- themes
import { findSimulation, runNeverFinishes, type FinderProgress, type FinderResult } from "@/lib/simulation/finder";
import { characterOf, characterRenderOptions } from "@/lib/character/character"; // --- boris-faces ---
import type { ChirpKind } from "@/lib/audio/characterVoice"; // --- boris-faces ---
// --- teams ---
import type { CanvasTeamOptions } from "./teamsRenderer";
import { MULTI_BALL_MODES } from "@/lib/physics/ballStats";
import { effectiveBallCount, teamCarryOver, teamRenderOptions } from "@/lib/teams";
import { cameraSettingsOf } from "@/lib/simulation/camera"; // --- camera ---
import { obstacleConfigOf, obstacleSettingsOf, supportsObstacles, type EditorObstacle } from "@/lib/physics/obstacleEditor"; // --- obstacle-editor ---
// --- captions ---
import type { CanvasCaptionOptions } from "./captionsRenderer";
import { captionCarryOver, captionRenderOptions } from "@/lib/captions";
// --- rigged ---
import FinderOutcomeFields, { FinderOutcomeSelect, outcomeButtonText, outcomeFoundText, outcomeMissText, outcomeOverlayText, outcomeProgressText, teamChoiceNames } from "./FinderOutcomeFields";
import { BATTLE_WINNER_MODES, forcedWinnerApplies, neverEscapeApplies, rigNeverFinishes, riggedConfigOf } from "@/lib/physics/rigged"; // --- odd-string-battle --- (BATTLE_WINNER_MODES)
import { availableOutcomes, effectiveOutcome, type FinderOutcome, type FinderOutcomeKind } from "@/lib/simulation/outcomes";
// --- timeline ---
import TimelineBar from "./TimelineBar";
import { useTimelineLivePublisher } from "./timelineLive";
import { engineTimelineOf, serializeKeyframes, timelineCarryOver } from "@/lib/simulation/timeline";
import { doublePendulumSettingsOf } from "@/lib/physics/modes/doublePendulum"; // --- jdm-double-pendulum ---
import { powerLayersSettingsOf } from "@/lib/physics/modes/powerLayers"; // --- odd-power-layers ---
// --- fast-render ---
import { FastRenderHost, FastRenderUnsupportedError, downloadExport, fastRenderSupported, pickExportFormat, renderFast } from "@/lib/recording/fastRender";
import { resolveFastExportFps, type EndHolds } from "@/lib/recording/fastRenderPlan";
import type { FastExportState } from "./sections/FastExportSection";
// --- project-files ---
import ProjectDropZone from "./ProjectDropZone";
import { ShareCodeNotice, useShareCodeLoader, useShortShareLink } from "./shareLinks";
import { useProjectFiles, type ProjectUploads } from "./useProjectFiles";
// --- jdm-race ---
import { raceSettingsOf } from "@/lib/physics/modes/race";
import { raceCupStore } from "@/lib/raceCup";
import { raceRoster } from "@/lib/raceRoster";
import { raceResultOf, runKey, type CanvasRaceOptions } from "./raceRenderer";
import { cupTitleOf, defaultRacerNames, useRaceCup } from "./sections/RaceSection";
// --- jdm-arena-games --- Bouncing Square Battle Royale and Capture the Flag
import { ARENA_WIN_HOLD_SEC, arenaFoundClipSec, battleSettingsOf, ctfFinderSettings, ctfSettingsOf, isArenaGameMode } from "@/lib/physics/modes/arenaGames";
import { useBatchRender, type BatchExportRequest } from "./useBatchRender"; // --- batch-render ---
// --- jdm-rhythm-runner --- Beat Runner and Paddle Keep-Up
import { runnerPlanOf, runnerSettingsOf, sameRunnerPlan, type RunnerBeatInput, type RunnerPlan } from "@/lib/physics/modes/runner";
import { paddleSettingsOf } from "@/lib/physics/modes/paddle";
import { jdmRhythmFinderSettingsOf, jdmRhythmPlayedByHand } from "@/lib/physics/modes/jdmRhythmFields";
import { sameBeatSchedule } from "@/lib/simulation/beatSchedule";
import {
  RANGES,
  defaultSettings,
  loadPresets,
  presetToLiveSettings,
  resolutionToSize,
  savePresets,
  settingsFromSearchParams,
  settingsToSearchParams,
  type PresetStore,
  type SimulatorSettings,
} from "@/lib/settings";

const SPEEDS = [1, 2, 4, 8];
/** --- boris-multipliers --- who makes it home when the ball has no name. */
const DEFAULT_BORIS_NAME = "Boris";
/** Picture Paint: how long the finished picture stays crisp on screen before the end screen covers it. */
const PAINT_FINISH_HOLD_MS = 1500;
/** --- teams --- How long the winner banner and its confetti play before the end screen covers them (a recording keeps them). */
const WINNER_HOLD_MS = 3000;
/**
 * --- boris-multipliers --- How long a multipliers finish – "N Boris made it home" when the board empties, "OUTGREW THE
 * ARENA" – and its confetti play before the end screen covers them (a recording keeps them); both end the run at once.
 */
const MULT_FINISH_HOLD_MS = 2000;
/**
 * A recording whose length runs out after its run finished waits for the end-of-run hold (winner banner, escape
 * replay, finished picture) instead of cutting it; this long at most (the longest hold is replay + banner, ~7.5 s).
 */
const END_HOLD_FALLBACK_MS = 12000;
/** --- jdm-illusions --- How long the Circle Illusion's revealed picture (whitespace) stays on screen before the end screen covers it (a recording keeps it). */
const ILLUSION_REVEAL_HOLD_MS = 2000;
/** --- odd-string-battle --- How long the String Battle's last shatter, ring flash and winner banner play before the end screen covers them (a recording keeps them). */
const STRING_BATTLE_FINISH_HOLD_MS = 3000;
/** --- jdm-race --- This page's prefix of the race run keys: a finished race is scored into the cup once. */
const RACE_RUN_PREFIX = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
/** --- jdm-arena-games --- How long the winner banner of an arena game and its confetti play before the end screen covers them (a recording keeps them). */
const ARENA_WIN_HOLD_MS = 1000 * ARENA_WIN_HOLD_SEC;

/** Sound preferences that survive a mode change (like the wall-break clip does). */
function musicSettingsOf(s: SimulatorSettings): MusicSettings {
  return { instrument: s.instrument, melodyInstrument: s.melodyInstrument, scale: s.scale, rootNote: s.rootNote, quantizeToBeat: s.quantizeToBeat, bpm: s.bpm, quantizeGrid: s.quantizeGrid };
}

// --- fast-render ---
/** The page's holds between a finished run and its end screen (the finish detection in the sound loop), for the fast export. */
function fastExportEndHolds(engine: PhysicsEngine, teamsPlay: boolean): EndHolds {
  const preMs =
    engine.isPaintMode() && engine.getPaintState().picture
      ? PAINT_FINISH_HOLD_MS
      : engine.isIllusionMode() && engine.getIllusionView().type === "whitespace"
        ? ILLUSION_REVEAL_HOLD_MS
        : engine.isStringBattleMode()
          ? STRING_BATTLE_FINISH_HOLD_MS // --- odd-string-battle --- the last shatter, the ring flash and the winner banner, as the page holds them
          : isArenaGameMode(engine.getCurrentModeName())
            ? ARENA_WIN_HOLD_MS // --- jdm-arena-games --- the winner banner and its confetti, as the page holds them
            : 0;
  const postMs = Math.max(teamsPlay ? WINNER_HOLD_MS : 0, engine.endsWithMultiplierFinish() ? MULT_FINISH_HOLD_MS : 0);
  return { preMs, postMs };
}
/** How often (ms) the fast export's progress re-renders the page. */
const FAST_PROGRESS_MS = 120;
// --- end fast-render ---

export default function Simulator() {
  const t = useTranslations();
  const searchParams = useSearchParams();

  const engineRef = useRef<PhysicsEngine | null>(null);
  const audioRef = useRef<ToneGenerator | null>(null);
  const recorderRef = useRef<VideoRecorder | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  /** --- jdm-rhythm-runner --- The loaded song's beat grid the Beat Runner plans its course on (null: the manual BPM). */
  const rhythmBeatRef = useRef<RunnerBeatInput | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finderAbortRef = useRef<AbortController | null>(null);
  const autoPausedRef = useRef(false);
  const wallBreakObjectUrlRef = useRef<string | null>(null);
  const hitSampleObjectUrlRef = useRef<string | null>(null);
  const sliceUploadIdRef = useRef(0);
  const musicUploadIdRef = useRef(0);
  const projectUploadsRef = useRef<ProjectUploads>({}); // --- project-files --- the uploads' original files (decoded songs keep no bytes)

  // Initial settings come from the URL (?mode=..., plus any shared parameters).
  const [settings, setSettings] = useState<SimulatorSettings>(() => settingsFromSearchParams(new URLSearchParams(searchParams.toString())));
  const [engineReady, setEngineReady] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [simSpeed, setSimSpeed] = useState(1);
  const [fps, setFps] = useState(60);
  const [finished, setFinished] = useState(false);
  const [ballImage, setBallImage] = useState<string | null>(null);
  const [ballEmoji, setBallEmoji] = useState<string | null>(null);
  const [customSoundId, setCustomSoundId] = useState<string | null>(null);
  const [customSoundLoading, setCustomSoundLoading] = useState(false);
  const [customSoundNoteCount, setCustomSoundNoteCount] = useState(0);
  const [customMidiName, setCustomMidiName] = useState<string | null>(null);
  const [customWallBreakName, setCustomWallBreakName] = useState<string | null>(null);
  // The uploaded hit sample stays in memory (blob: URL); settings refer to it as "custom".
  const [customHitSample, setCustomHitSample] = useState<{ name: string; url: string } | null>(null);
  // Decode state of the selected hit sample, shown in the panel (a failed decode is never silent).
  const [hitSampleStatus, setHitSampleStatus] = useState<HitSampleStatus>("idle");
  // Song slicer: the decoded song lives in the ToneGenerator; this is what the panel shows about it.
  const [sliceSongInfo, setSliceSongInfo] = useState<{ name: string; duration: number } | null>(null);
  const [sliceSongLoading, setSliceSongLoading] = useState(false);
  // Background music bed: the decoded track lives in the ToneGenerator's MusicBed; this is what the panel shows.
  const [musicTrack, setMusicTrack] = useState<MusicTrackInfo | null>(null);
  const [musicLoading, setMusicLoading] = useState(false);
  const [musicPlaying, setMusicPlaying] = useState(false);
  // Picture Paint: the picture uploaded in this session (a data: URL kept in memory, like the ball image) and the
  // beat grids detected in the loaded songs (analysed asynchronously in idle slices; the music bed wins over the slicer).
  const [paintPicture, setPaintPicture] = useState<PaintPictureInfo | null>(null);
  const [musicBeats, setMusicBeats] = useState<BeatAnalysis | null>(null);
  const [sliceBeats, setSliceBeats] = useState<BeatAnalysis | null>(null);
  const [beatJobs, setBeatJobs] = useState(0);
  const beatAbortRef = useRef<{ music: AbortController | null; slice: AbortController | null }>({ music: null, slice: null });
  const paintFinishedAtRef = useRef<number | null>(null);
  // --- teams --- whether teams play in this run (the finish detection then holds the winner banner) and when the banner
  // (or --- boris-multipliers --- the multipliers' finish banner) appeared
  const teamsPlayRef = useRef(false);
  const winnerShownAtRef = useRef<number | null>(null);
  // --- themes: the background picture uploaded in this session (a data: URL kept in memory, never in links or presets)
  const [backgroundImage, setBackgroundImage] = useState<ThemeImageInfo | null>(null);
  const [presets, setPresets] = useState<PresetStore>({});
  const [findDuration, setFindDuration] = useState(30);
  const [findTolerance] = useState(0.5);
  const [findMaxSeeds] = useState(1000);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<FinderProgress | null>(null);
  const [searchResult, setSearchResult] = useState<FinderResult | null>(null);
  // --- rigged --- Find Simulation's outcome (duration, never escapes, escapes at, winner), its fields and the outcome of the running search
  const [findOutcome, setFindOutcome] = useState<FinderOutcomeKind>("duration");
  const [findEscapeAt, setFindEscapeAt] = useState(10);
  const [findWinner, setFindWinner] = useState(0);
  const [searchOutcome, setSearchOutcome] = useState<FinderOutcomeKind>("duration");
  const [shareCopied, setShareCopied] = useState(false);
  const recordingSupported = useMemo(() => VideoRecorder.isSupported(), []);

  const update = useCallback((patch: Partial<SimulatorSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  }, []);

  /* ------------------------------------------------------------ engine lifecycle */

  const initEngineForMode = useCallback((engine: PhysicsEngine, s: SimulatorSettings) => {
    engine.setBouncier(s.bouncierEnabled);
    engine.setWallBreakStyle(s.wallBreakStyle);
    engine.setCinematicEnabled(s.cinematicEnabled);
    engine.setCountdownTotal(s.targetCount);
    engine.setCountdownRandomOrder(s.countdownRandom);
    engine.setColorMatchColorCount(s.colorMatchColorCount);
    engine.setMultiplySpawnCount(s.multiplySpawnCount);
    engine.setGrowRate(s.growRate);
    engine.setGrowCenterDotEnabled(s.growCenterDot);
    engine.setGrowLinesEnabled(s.growLines);
    engine.setLinesCenterDotEnabled(s.linesCenterDot);
    engine.setDropSettings(dropSettingsOf(s));
    engine.setBoxSettings(boxSettingsOf(s));
    engine.setPendulumSettings(pendulumSettingsOf(s));
    engine.setPolyrhythmSettings(polyrhythmSettingsOf(s)); // --- jdm-polyrhythm ---
    // --- jdm-collisions ---
    engine.setCollideSettings(collideSettingsOf(s));
    engine.setGlassSettings(glassSettingsOf(s)); // --- boris-glass ---
    engine.setMultipliersSettings(multipliersSettingsOf(s)); // --- boris-multipliers ---
    engine.setDoublePendulumSettings(doublePendulumSettingsOf(s)); // --- jdm-double-pendulum ---
    engine.setIllusionSettings(illusionSettingsOf(s)); // --- jdm-illusions ---
    engine.setStringBattleSettings(stringBattleSettingsOf(s)); // --- odd-string-battle ---
    engine.setPowerLayersSettings(powerLayersSettingsOf(s)); // --- odd-power-layers ---
    engine.setRaceSettings(raceSettingsOf(s)); // --- jdm-race ---
    // --- jdm-arena-games ---
    engine.setBattleSettings(battleSettingsOf(s));
    engine.setCtfSettings(ctfSettingsOf(s));
    // --- jdm-rhythm-runner ---
    engine.setRunnerSettings(runnerSettingsOf(s, rhythmBeatRef.current));
    engine.setPaddleSettings(paddleSettingsOf(s));
    engine.initMode(s.mode);
    engine.setAccumulationTimerMax(1000 * s.accumulationTime);
    engine.setSpikesEnabled(s.spikesEnabled);
    engine.setSpikeCount(s.spikeCount);
  }, []);

  useEffect(() => {
    if (engineRef.current) return;
    const s = settings;
    const engine = new PhysicsEngine({
      gravity: s.gravity,
      damping: 0,
      bounce: s.bounce,
      width: 800,
      height: 600,
      audioIntensity: 0,
      ballSpeed: s.ballSpeed,
      rotationSpeed: s.rotationEnabled ? s.rotationSpeed : 0,
      wallCount: s.wallCount,
      gapSize: s.gapSize,
      ballColor: s.ballColor,
      ballRadius: s.ballRadius,
      twoBalls: s.twoBalls,
      ballColor2: s.ballColor2,
      ballCount: effectiveBallCount(s), // --- teams ---
      ...physicsExtrasOf(s),
      ...ballInteractionOf(s),
      timeline: engineTimelineOf(s), // --- timeline --- (the first run already starts from the keyframes' values)
    });
    initEngineForMode(engine, s);
    engineRef.current = engine;
    audioRef.current = new ToneGenerator();
    audioRef.current.setHitSampleStatusListener(setHitSampleStatus);
    audioRef.current.getMusicBed().setPlayingListener(setMusicPlaying);
    setPresets(loadPresets());
    setEngineReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Restarts the current mode from scratch: the run and everything that plays along with it – the melody from its first
   * note, the slicer from the start of its song, the beat grid, the music bed from its start offset. The R key and the
   * Restart button resume a paused run (`keepPaused` false); --- jdm-rhythm-runner --- a setting that re-plans the Beat
   * Runner, whose course lands on the music bed's beats, restarts it with `keepPaused`: a paused run stays paused, and its
   * bed starts from its start offset when it resumes.
   */
  const restartRun = useCallback(
    (keepPaused: boolean) => {
      const engine = engineRef.current;
      if (!engine) return;
      const paused = keepPaused && isPaused;
      setFinished(false);
      if (!paused) setIsPaused(false);
      audioRef.current?.resetCustomNoteIndex();
      audioRef.current?.getSlicer().reset();
      audioRef.current?.resetBeatGrid();
      // The music bed starts over from its start offset with the run (the lifecycle effect below
      // cannot tell a restart from "still running", so it is done here).
      if (isStarted && !paused) audioRef.current?.getMusicBed().restart();
      else audioRef.current?.getMusicBed().stop();
      engine.setConfig({ ballRadius: settings.ballRadius });
      initEngineForMode(engine, settings);
    },
    [settings, isStarted, isPaused, initEngineForMode],
  );
  /** Restart the current mode from scratch (R key / Restart button). */
  const restart = useCallback(() => restartRun(false), [restartRun]);
  /** --- jdm-rhythm-runner --- The latest `restartRun()`, for the effect that re-plans the Beat Runner (it runs on setting changes only). */
  const restartRunRef = useRef(restartRun);
  restartRunRef.current = restartRun;

  // Keep the engine in sync with the settings object.
  const s = settings;
  useEffect(() => {
    engineRef.current?.setConfig({
      gravity: s.gravity,
      bounce: s.bounce,
      ballSpeed: s.ballSpeed,
      rotationSpeed: s.rotationEnabled ? s.rotationSpeed : 0,
      wallCount: s.wallCount,
      gapSize: s.gapSize,
      ballColor: s.ballColor,
      ballRadius: s.ballRadius,
      twoBalls: s.twoBalls,
      ballColor2: s.ballColor2,
    });
  }, [s.gravity, s.bounce, s.ballSpeed, s.rotationSpeed, s.rotationEnabled, s.wallCount, s.gapSize, s.ballColor, s.ballRadius, s.twoBalls, s.ballColor2]);
  // Physics extras (drag, wind, spin, bounciness, breathing walls, rotating gravity) travel in the same config.
  useEffect(() => {
    engineRef.current?.setConfig(physicsExtrasOf(s));
  }, [s.airDrag, s.windX, s.windY, s.spinStrength, s.wallBounciness, s.breathingAmplitude, s.breathingSpeed, s.rotatingGravity]); // eslint-disable-line react-hooks/exhaustive-deps
  // Ball interactions (bounce / merge / split / pass and the split limits) travel in the same config.
  useEffect(() => {
    engineRef.current?.setConfig(ballInteractionOf(s));
  }, [s.ballInteraction, s.splitMinRadius, s.maxBalls]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    engineRef.current?.setAccumulationTimerMax(1000 * s.accumulationTime);
  }, [s.accumulationTime]);
  useEffect(() => {
    engineRef.current?.setSpikesEnabled(s.spikesEnabled);
  }, [s.spikesEnabled]);
  useEffect(() => {
    engineRef.current?.setSpikeCount(s.spikeCount);
  }, [s.spikeCount]);
  useEffect(() => {
    engineRef.current?.setMultiplySpawnCount(s.multiplySpawnCount);
  }, [s.multiplySpawnCount]);
  useEffect(() => {
    engineRef.current?.setWallBreakStyle(s.wallBreakStyle);
  }, [s.wallBreakStyle]);
  useEffect(() => {
    engineRef.current?.setBouncier(s.bouncierEnabled);
  }, [s.bouncierEnabled]);
  useEffect(() => {
    engineRef.current?.setCinematicEnabled(s.cinematicEnabled);
  }, [s.cinematicEnabled]);
  useEffect(() => {
    engineRef.current?.setGrowRate(s.growRate);
  }, [s.growRate]);
  useEffect(() => {
    engineRef.current?.setGrowCenterDotEnabled(s.growCenterDot);
  }, [s.growCenterDot]);
  useEffect(() => {
    engineRef.current?.setGrowLinesEnabled(s.growLines);
  }, [s.growLines]);
  useEffect(() => {
    engineRef.current?.setLinesCenterDotEnabled(s.linesCenterDot);
  }, [s.linesCenterDot]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCountdownTotal(s.targetCount);
    engine.setCountdownRandomOrder(s.countdownRandom);
    if (s.mode === "target" && engine.getCurrentModeName() === "target") {
      engine.initCountdown();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.targetCount, s.countdownRandom]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setColorMatchColorCount(s.colorMatchColorCount);
    if (s.mode === "colorMatch" && engine.getCurrentModeName() === "colorMatch") {
      engine.initColorMatch();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.colorMatchColorCount]);
  // Ball Drop: a change of the board (ball count, spreads, rows, release interval, rain) restarts it, like Target does.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDropSettings(dropSettingsOf(s));
    if (s.mode === "drop" && engine.getCurrentModeName() === "drop") {
      engine.initDrop();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.dropBallCount, s.dropSizeVariation, s.dropGravityVariation, s.dropRows, s.dropSpawnInterval, s.dropLoop]);
  // Bouncing Shapes: a change of the box (shapes, aspect, gravity, countdown, growth, speed ratio) restarts it too.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setBoxSettings(boxSettingsOf(s));
    if (s.mode === "box" && engine.getCurrentModeName() === "box") {
      engine.initBox();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.boxShapeCount, s.boxShape, s.boxAspect, s.boxGravity, s.boxCountdown, s.boxGrowPerHit, s.boxSpeedRatio]);
  // Pendulum Wave: a change of the rig (count, tuning, layout, sound, cycles) restarts it too, so the row starts in line.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPendulumSettings(pendulumSettingsOf(s));
    if (s.mode === "pendulum" && engine.getCurrentModeName() === "pendulum") {
      engine.initPendulum();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pwCount, s.pwBaseOscillations, s.pwCycleSeconds, s.pwAmplitude, s.pwLayout, s.pwPolygon, s.pwPhasing, s.pwSoundOn, s.pwPitchDirection, s.pwWaveChord, s.pwCycles]);
  // The trails only change the drawing: they follow at once and the run goes on.
  useEffect(() => {
    engineRef.current?.setPendulumSettings({ trails: s.pwTrails });
  }, [s.pwTrails]);
  // --- jdm-polyrhythm --- Metronomes & Polyrhythms: a change of the tempos (voices, series, ratio list, cycle, BPMs) or of the
  // cycles restarts the run with a fresh seed, so every voice starts in phase; a custom list only counts once it parses differently.
  const polyCustomKey = parseCustomRatios(s.prCustom).join(",");
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPolyrhythmSettings(polyrhythmSettingsOf(s));
    if (s.mode === "polyrhythm" && engine.getCurrentModeName() === "polyrhythm") {
      engine.setSeed(null);
      engine.initPolyrhythm();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.prCount, s.prTempos, polyCustomKey, s.prCycleSeconds, s.prBaseBpm, s.prBpmStep, s.prCycles]);
  // The layout, arc style, polygons, accents, pitch mapping and numbers apply live: positions follow the clock, the rhythm carries on.
  useEffect(() => {
    engineRef.current?.setPolyrhythmSettings(polyrhythmSettingsOf(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.prLayout, s.prArcStyle, s.prPolygon, s.prAccentEvery, s.prPitchBy, s.prNumbers, s.prCustom]);
  // --- end jdm-polyrhythm ---
  // --- jdm-collisions --- Collision Playground: a change of the playground (count, sizes, container, physics, variants) restarts it.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setCollideSettings(collideSettingsOf(s));
    if (s.mode === "collide" && engine.getCurrentModeName() === "collide") {
      engine.initCollide();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.cpCount, s.cpSizeSpread, s.cpContainer, s.cpGravity, s.cpRestitution, s.cpSquishy, s.cpSyncStart, s.cpAntiCollisionAt, s.cpRing]);
  // Any Collision Playground change invalidates a found seed too (the finder hides itself for this endless mode, but a seed may be pinned).
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.cpCount, s.cpSizeSpread, s.cpContainer, s.cpGravity, s.cpRestitution, s.cpSyncStart, s.cpAntiCollisionAt, s.cpRing]);
  // --- boris-glass --- Glass Smash: a change of the shaft (rows, hit points, stages, sliding panes, holes, gates) restarts it.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setGlassSettings(glassSettingsOf(s));
    if (s.mode === "glass" && engine.getCurrentModeName() === "glass") {
      engine.initGlass();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.glassRows, s.glassHp, s.glassStages, s.glassMoving, s.glassHoles, s.glassGates]);
  // A Glass Smash change invalidates a found seed too.
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.glassRows, s.glassHp, s.glassStages, s.glassMoving, s.glassHoles, s.glassGates]);
  // --- end boris-glass ---
  // --- boris-multipliers --- pickups, cap and smash threshold travel in the physics config (like the physics extras);
  // a change of the multipliers board restarts it, the count target only matters to the finder.
  useEffect(() => {
    engineRef.current?.setConfig(multiplierConfigOf(s));
  }, [s.mpUnlimited, s.mpCap, s.wallSmashThreshold, s.multiplierPickups, s.pickupRate, s.pickupTypes, s.pickupLifetime]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setMultipliersSettings(multipliersSettingsOf(s));
    if (s.mode === "multipliers" && engine.getCurrentModeName() === "multipliers") {
      engine.initMultipliers();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.mpRows, s.mpGateMix, s.mpStartBalls, s.mpMaxBalls]);
  useEffect(() => {
    engineRef.current?.setMultipliersSettings({ target: s.mpTarget });
  }, [s.mpTarget]);
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.mpUnlimited, s.mpCap, s.wallSmashThreshold, s.multiplierPickups, s.pickupRate, s.pickupTypes, s.pickupLifetime, s.mpRows, s.mpGateMix, s.mpStartBalls, s.mpMaxBalls]);
  // The ball's name for the "N Boris made it home" banner (read by the canvas labels).
  const ballNameRef = useRef(s.ballName);
  ballNameRef.current = s.ballName;
  // --- end boris-multipliers ---
  // --- jdm-double-pendulum --- Double Pendulum: a change of the rig (pendulums, rods, lengths, masses, gravity, start, damping,
  // sparring) restarts it and invalidates a found seed; the trail, the strings, their tuning (the Sound section's scale and
  // root) and the end (endless, the clip length) apply live – they change what is drawn and heard, not the swing.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setDoublePendulumSettings(doublePendulumSettingsOf(s));
    if (s.mode === "doublePendulum" && engine.getCurrentModeName() === "doublePendulum") {
      engine.initDoublePendulum();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.dpCount, s.dpSegments, s.dpLength1, s.dpLength2, s.dpLength3, s.dpMass1, s.dpMass2, s.dpMass3, s.dpGravity, s.dpAngle1, s.dpAngle2, s.dpAngle3, s.dpRandomStart, s.dpDamping, s.dpSpar]);
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.dpCount, s.dpSegments, s.dpLength1, s.dpLength2, s.dpLength3, s.dpMass1, s.dpMass2, s.dpMass3, s.dpGravity, s.dpAngle1, s.dpAngle2, s.dpAngle3, s.dpRandomStart, s.dpDamping, s.dpSpar]);
  useEffect(() => {
    engineRef.current?.setDoublePendulumSettings(doublePendulumSettingsOf(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.dpTrailSeconds, s.dpStrings, s.dpStringLayout, s.dpOctaves, s.dpEndless, s.recordingDuration, s.scale, s.rootNote]);
  // --- end jdm-double-pendulum ---
  // --- obstacle-editor --- the creator's obstacles and the bumper boost travel in the physics config (so the seed finder copies
  // them with it); a new layout invalidates a found seed. A drag on the canvas shows live through the engine and lands here on release.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setConfig(obstacleConfigOf(s));
    engine.setSeed(null);
    // The found seed is gone with the old layout, so its promise goes too: the ready bar and the finder panel stop quoting
    // its duration. (This runs only when the layout or the boost really changed – the finder touches neither.)
    setSearchResult((r) => (r?.found ? null : r));
  }, [s.obstacles, s.bumperBoost]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- end obstacle-editor ---
  // --- timeline --- the keyframes travel in the physics config: the engine plays them on the simulation clock and the seed finder
  // copies them (the rotation speed's only while the rotation is on). New keyframes drop a found seed with its promise, like a new
  // obstacle layout. The live values of the automated settings are published for the panel (sliders, Timeline section).
  const timelineSignature = serializeKeyframes(engineTimelineOf(s));
  const engineKeyframes = useMemo(() => engineTimelineOf(s), [timelineSignature]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setConfig({ timeline: engineKeyframes });
    engine.setSeed(null);
    setSearchResult((r) => (r?.found ? null : r));
  }, [engineKeyframes]);
  const readTimelineTime = useCallback(() => (engineRef.current?.getElapsedMs() ?? 0) / 1000, []);
  const getTimelineEngine = useCallback(() => engineRef.current, []);
  useTimelineLivePublisher(engineKeyframes, readTimelineTime);
  // --- end timeline ---
  // --- jdm-illusions --- Circle Illusion: a change of the type, the counts, the picture, the speed or the cycles restarts it with
  // a fresh seed (so the figure starts in line); the tracks and the reveal only change the drawing and follow live.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setIllusionSettings(illusionSettingsOf(s));
    if (s.mode === "illusion" && engine.getCurrentModeName() === "illusion") {
      engine.setSeed(null);
      engine.initIllusion();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ilType, s.ilBalls, s.ilRings, s.ilDepth, s.ilPainters, s.ilPattern, s.ilSpeed, s.ilCycles]);
  useEffect(() => {
    engineRef.current?.setIllusionSettings({ tracks: s.ilTracks, reveal: s.ilReveal });
  }, [s.ilTracks, s.ilReveal]);
  // The nested circles and the painters take their size at the start: a Ball Size change restarts those two types.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || s.mode !== "illusion" || engine.getCurrentModeName() !== "illusion" || (s.ilType !== "nested" && s.ilType !== "whitespace")) return;
    engine.setSeed(null);
    engine.initIllusion();
    setFinished(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ballRadius]);
  const illusionRevealAtRef = useRef<number | null>(null);
  // --- end jdm-illusions ---
  // --- odd-string-battle --- String Battle: a change of the fight (balls, lives, threads, rule, clip limit, finale speed) restarts
  // it and drops a found seed; the style, the wobble, the badge and the HUD only change the drawing and follow live.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setStringBattleSettings(stringBattleSettingsOf(s));
    if (s.mode === "stringBattle" && engine.getCurrentModeName() === "stringBattle") {
      engine.initStringBattle();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.sbBalls, s.sbLives, s.sbMaxStrings, s.sbRule, s.sbDuration, s.sbFinaleSpeed]);
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.sbBalls, s.sbLives, s.sbMaxStrings, s.sbRule, s.sbDuration, s.sbFinaleSpeed]);
  useEffect(() => {
    engineRef.current?.setStringBattleSettings({ style: s.sbStyle, wobble: s.sbWobble, badge: s.sbBadge, hud: s.sbHud });
  }, [s.sbStyle, s.sbWobble, s.sbBadge, s.sbHud]);
  const battleFinishAtRef = useRef<number | null>(null);
  // --- end odd-string-battle ---
  // --- odd-power-layers --- Power Layers: a change of the stack or the flight (layers, sequence, drift, bounce speed – and the
  // Gravity, which shapes the arcs) restarts the run and drops a found seed; the badge, the pills and the Sound section's
  // scale and root (the notes of the levels) follow live.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPowerLayersSettings(powerLayersSettingsOf(s));
    if (s.mode === "powerLayers" && engine.getCurrentModeName() === "powerLayers") {
      engine.initPowerLayers();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.plLayers, s.plSequence, s.plDrift, s.plSpeed, s.gravity]);
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.plLayers, s.plSequence, s.plDrift, s.plSpeed]);
  useEffect(() => {
    engineRef.current?.setPowerLayersSettings(powerLayersSettingsOf(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.plBadge, s.plPills, s.scale, s.rootNote]);
  // --- end odd-power-layers ---
  // --- jdm-race --- Square Racing Grand Prix: a new track (racers, length, laps, obstacle mix) or favourite restarts the race and
  // drops a found seed; the camera and the shape follow live; the cup only lengthens the run (the cup table), so it drops the seed.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setRaceSettings(raceSettingsOf(s));
    if (s.mode === "race" && engine.getCurrentModeName() === "race") {
      engine.initRace();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.rcRacers, s.rcTrackLength, s.rcLaps, s.rcFeature, s.rcWinner]);
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.rcRacers, s.rcTrackLength, s.rcLaps, s.rcFeature, s.rcWinner, s.rcCup]);
  useEffect(() => {
    engineRef.current?.setRaceSettings({ camera: s.rcCamera, shape: s.rcShape, cup: s.rcCup });
  }, [s.rcCamera, s.rcShape, s.rcCup]);
  // The track is laid out for the racers' size: a Ball Size change restarts the race.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || s.mode !== "race" || engine.getCurrentModeName() !== "race") return;
    engine.initRace();
    setFinished(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ballRadius]);
  // The cup: a race that reached its podium is scored once (its run key) into the table kept in this browser.
  const raceCup = useRaceCup();
  useEffect(() => {
    if (!isStarted || s.mode !== "race" || !s.rcCup) return;
    const id = setInterval(() => {
      const engine = engineRef.current;
      if (!engine || !engine.isRaceMode()) return;
      const view = engine.getRaceView();
      // A race nobody finished scores nothing and is not counted (a safeguard: the time limit's backstop places the racers).
      if ((view.phase === "podium" || view.phase === "cup" || view.phase === "done") && view.finishOrder.length > 0) raceCupStore.addRace(raceResultOf(view), runKey(RACE_RUN_PREFIX, view));
    }, 200);
    return () => clearInterval(id);
  }, [isStarted, s.mode, s.rcCup]);
  // --- end jdm-race ---
  // --- jdm-arena-games --- Battle Royale / Capture the Flag: a change of the game (squares, hit points, damage, arena, zone,
  // power-ups, team size, score to win, the director's nudge) restarts it and drops a found seed; the clip length is capture
  // the flag's time limit and follows live.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setBattleSettings(battleSettingsOf(s));
    engine.setCtfSettings(ctfSettingsOf(s));
    if (isArenaGameMode(s.mode) && engine.getCurrentModeName() === s.mode) {
      engine.initMode(s.mode);
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.btCount, s.btHp, s.btDamage, s.btArena, s.btShrink, s.btPowerUps, s.ctfPerTeam, s.ctfScoreToWin, s.arenaNudge]);
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.btCount, s.btHp, s.btDamage, s.btArena, s.btShrink, s.btPowerUps, s.ctfPerTeam, s.ctfScoreToWin, s.arenaNudge]);
  useEffect(() => {
    engineRef.current?.setCtfSettings({ clipSeconds: s.recordingDuration });
  }, [s.recordingDuration]);
  const arenaWinAtRef = useRef<number | null>(null);
  // --- end jdm-arena-games ---
  useEffect(() => {
    audioRef.current?.setWallBreakSound(s.wallBreakSound);
  }, [s.wallBreakSound]);
  // --- boris-glass --- Glass Smash shatters its panes with the glass clip unless a wall-break sound was chosen: the effect
  // above applies a chosen sound, this one the mode's default – and the plain sound again once the default no longer applies.
  const modeBreakRef = useRef<string | null>(null);
  useEffect(() => {
    const url = modeWallBreakSound(s.mode, s.wallBreakSound);
    const isDefault = url !== s.wallBreakSound;
    if (isDefault ? modeBreakRef.current === url : modeBreakRef.current === null) return;
    modeBreakRef.current = isDefault ? url : null;
    audioRef.current?.setWallBreakSound(url);
  }, [s.mode, s.wallBreakSound]);
  useEffect(() => {
    audioRef.current?.setHitSoundMode(s.hitSoundMode);
  }, [s.hitSoundMode]);
  useEffect(() => {
    const url = s.hitSampleId === CUSTOM_HIT_SAMPLE_ID ? (customHitSample?.url ?? null) : builtInHitSampleUrl(s.hitSampleId);
    audioRef.current?.setHitSample(url);
  }, [s.hitSampleId, customHitSample]);
  useEffect(() => {
    audioRef.current?.setHitSamplePitchByWall(s.hitSamplePitchByWall);
  }, [s.hitSamplePitchByWall]);
  useEffect(() => {
    audioRef.current?.setHitSampleVolume(s.hitSampleVolume);
  }, [s.hitSampleVolume]);
  useEffect(() => {
    const slicer = audioRef.current?.getSlicer();
    if (!slicer) return;
    slicer.setOptions({ sliceSec: s.sliceMs / 1000, fadeSec: s.sliceFadeMs / 1000, loop: s.sliceLoop });
    slicer.setEnabled(s.sliceSong);
  }, [s.sliceSong, s.sliceMs, s.sliceFadeMs, s.sliceLoop]);
  // A slice that is still sounding stops with the simulation.
  useEffect(() => {
    if (isPaused) audioRef.current?.getSlicer().stop();
  }, [isPaused]);
  useEffect(() => {
    audioRef.current?.getMusicBed().setOptions({ volume: s.musicVolume, ducking: s.musicDucking, releaseMs: s.musicDuckRelease, loop: s.musicLoop, startOffset: s.musicStartOffset });
  }, [s.musicVolume, s.musicDucking, s.musicDuckRelease, s.musicLoop, s.musicStartOffset]);
  // The music bed follows the run: it plays while the simulation runs, pauses with it (keeping its
  // position) and stops when the run ends or a mode / preset change resets it. A track uploaded
  // mid-run starts right away. restart() handles the R key / Restart button.
  useEffect(() => {
    const bed = audioRef.current?.getMusicBed();
    if (!bed) return;
    if (!isStarted || finished) bed.stop();
    else if (isPaused) bed.pause();
    else bed.play();
  }, [isStarted, isPaused, finished, musicTrack]);
  useEffect(() => {
    audioRef.current?.setMusicSettings(musicSettingsOf(s));
  }, [s.instrument, s.melodyInstrument, s.scale, s.rootNote, s.quantizeToBeat, s.bpm, s.quantizeGrid]); // eslint-disable-line react-hooks/exhaustive-deps
  // --- themes: the style of the confetti bursts and, with a theme picked, the scene's colours for them (visual only)
  useEffect(() => {
    engineRef.current?.setParticleStyle(s.particleStyle, particlePalette(s));
  }, [s.particleStyle, s.themeId, s.ballColor, s.ballColor2, s.circleColor, s.lineColor, s.trailColors]); // eslint-disable-line react-hooks/exhaustive-deps
  // The latest settings, for changeMode() (its dependency list names only the fields it always keeps).
  const themeLookRef = useRef(settings);
  useEffect(() => {
    themeLookRef.current = settings;
  }, [settings]);
  // --- end themes

  // Picture Paint: the beat grid the Paint mode follows – the music bed's song (its start offset and loop align the
  // grid with the simulation clock), else the slicer's song – and the length the reveal is paced to.
  const activeBeats = useMemo(() => {
    if (musicTrack && musicBeats) return { beats: musicBeats, source: "music" as const, offset: s.musicStartOffset, loop: s.musicLoop };
    if (sliceSongInfo && sliceBeats) return { beats: sliceBeats, source: "slicer" as const, offset: 0, loop: s.sliceLoop };
    return null;
  }, [musicTrack, musicBeats, sliceSongInfo, sliceBeats, s.musicStartOffset, s.musicLoop, s.sliceLoop]);
  const paintTargetSec = paintTargetSeconds(musicTrack ? musicTrack.duration : sliceSongInfo && s.sliceSong ? sliceSongInfo.duration : 0, musicTrack ? s.musicStartOffset : 0, s.recordingDuration);
  useEffect(() => {
    engineRef.current?.setPaintOptions({ picture: !!paintPicture, brush: s.paintBrush, beatSync: s.paintBeatSync, beatPulse: s.paintBeatPulse, guided: s.paintGuided, paceToSong: s.paintPaceToSong, targetSec: paintTargetSec });
  }, [paintPicture, s.paintBrush, s.paintBeatSync, s.paintBeatPulse, s.paintGuided, s.paintPaceToSong, paintTargetSec]);
  useEffect(() => {
    engineRef.current?.setPaintBeat({
      source: s.paintBeatSource,
      manualBpm: s.bpm,
      grid: activeBeats ? { bpm: activeBeats.beats.bpm, beatTimes: activeBeats.beats.beatTimes, duration: activeBeats.beats.duration } : null,
      offset: activeBeats?.offset ?? 0,
      loop: activeBeats?.loop ?? true,
    });
  }, [s.paintBeatSource, s.bpm, activeBeats]);
  const paintBeat = useMemo<PaintBeatInfo>(
    () => ({ bpm: activeBeats && activeBeats.beats.bpm > 0 ? activeBeats.beats.bpm : null, analyzing: beatJobs > 0, hasSong: !!musicTrack || !!sliceSongInfo, source: activeBeats?.source ?? null }),
    [activeBeats, beatJobs, musicTrack, sliceSongInfo],
  );
  // --- jdm-rhythm-runner --- Beat Runner: the course is planned for the beat it follows (the loaded song's detected grid, the
  // same one Picture Paint follows, else the Sound section's BPM) and lands on the music bed's beats, which play from the bed's
  // start offset with the run. So a change of what the run is planned from (`runnerPlanOf()`: auto jump, obstacles, speed,
  // jump height, density, mix, the beat the course follows, the Gravity) restarts the whole run – the course and the music
  // it lands on, the melody, the slicer and the beat grid (`restartRun()`) – and a change of the beat it follows drops a found
  // seed; an input the course does not follow (the BPM of a run on a song's grid, a song finishing its analysis under a run
  // on the BPM) changes nothing, and neither the BPM nor a song touches a seed in any other mode. A change of a Beat Runner
  // or Paddle Keep-Up setting drops a found seed whatever the mode (like every mode's settings), before either re-plans.
  // Paddle Keep-Up restarts on a change of the game (or of the Gravity / Ball Size its flight is scaled with). The Sound
  // section's scale and root – the notes – follow live in both.
  const rhythmBeat = useMemo<RunnerBeatInput | null>(
    () => (activeBeats ? { grid: { bpm: activeBeats.beats.bpm, beatTimes: activeBeats.beats.beatTimes, duration: activeBeats.beats.duration }, offset: activeBeats.offset, loop: activeBeats.loop } : null),
    [activeBeats],
  );
  rhythmBeatRef.current = rhythmBeat;
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.runnerAutoJump, s.runnerObstacles, s.runnerSpeed, s.runnerJump, s.runnerDensity, s.runnerMix, s.runnerBeatSource, s.pdAuto, s.pdSkill, s.pdMisses, s.pdWidth, s.pdSpin, s.pdSpeedUp]);
  /** What the page engine's Beat Runner course was last planned from (null until the first settings pass). */
  const runnerPlanRef = useRef<RunnerPlan | null>(null);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setRunnerSettings(runnerSettingsOf(s, rhythmBeat));
    const plan = runnerPlanOf(engine.getRunnerSettings(), s.gravity);
    const before = runnerPlanRef.current;
    runnerPlanRef.current = plan;
    // The engine was created with these settings, or nothing the course is planned from changed.
    if (!before || sameRunnerPlan(before, plan)) return;
    if (s.mode !== "runner" || engine.getCurrentModeName() !== "runner") return;
    if (!sameBeatSchedule(before.beat, plan.beat)) engine.setSeed(null);
    restartRunRef.current(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.runnerAutoJump, s.runnerObstacles, s.runnerSpeed, s.runnerJump, s.runnerDensity, s.runnerMix, s.runnerBeatSource, s.bpm, s.gravity, rhythmBeat]);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPaddleSettings(paddleSettingsOf(s));
    if (s.mode === "paddle" && engine.getCurrentModeName() === "paddle") {
      engine.initPaddle();
      setFinished(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.pdAuto, s.pdSkill, s.pdMisses, s.pdWidth, s.pdSpin, s.pdSpeedUp, s.gravity, s.ballRadius]);
  useEffect(() => {
    engineRef.current?.setRunnerSettings({ scale: s.scale, rootNote: s.rootNote });
    engineRef.current?.setPaddleSettings({ scale: s.scale, rootNote: s.rootNote });
  }, [s.scale, s.rootNote]);
  // Played by hand: Space (or ↑ / W) jumps in the Beat Runner – instead of pausing, Escape pauses there – and ← → (A / D) or
  // the pointer over the canvas move the paddle; a tap on the canvas jumps too. Only while the run is going.
  const handPlayed = jdmRhythmPlayedByHand(s); // (the fast export and the batch render leave such a run to Record Video)
  const handPlay = isStarted && !isPaused && !finished && handPlayed;
  useEffect(() => {
    if (!handPlay) return;
    const engine = engineRef.current;
    const canvas = canvasRef.current?.getCanvas() ?? null;
    if (!engine) return;
    const typing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    };
    const held = new Set<string>();
    const direction = () => (held.has("ArrowRight") || held.has("KeyD") ? 1 : 0) - (held.has("ArrowLeft") || held.has("KeyA") ? 1 : 0);
    const onDown = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (s.mode === "runner") {
        if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
          e.preventDefault();
          e.stopImmediatePropagation();
          if (!e.repeat) engine.runnerJump();
        } else if (e.code === "Escape") setIsPaused(true);
      } else if (e.code === "ArrowLeft" || e.code === "ArrowRight" || e.code === "KeyA" || e.code === "KeyD") {
        e.preventDefault();
        held.add(e.code);
        engine.setPaddleInput({ direction: direction() });
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (!held.delete(e.code)) return;
      engine.setPaddleInput({ direction: direction() });
    };
    const onPointerDown = () => {
      if (s.mode === "runner") engine.runnerJump();
    };
    const onPointerMove = (e: PointerEvent) => {
      if (s.mode !== "paddle" || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const f = engine.getPaddleView().field;
      engine.setPaddleInput({ target: (e.clientX - rect.left - f.left) / Math.max(1, f.width) });
    };
    const onPointerLeave = () => engine.setPaddleInput({ target: null });
    window.addEventListener("keydown", onDown, true);
    window.addEventListener("keyup", onUp, true);
    canvas?.addEventListener("pointerdown", onPointerDown);
    canvas?.addEventListener("pointermove", onPointerMove);
    canvas?.addEventListener("pointerleave", onPointerLeave);
    return () => {
      window.removeEventListener("keydown", onDown, true);
      window.removeEventListener("keyup", onUp, true);
      canvas?.removeEventListener("pointerdown", onPointerDown);
      canvas?.removeEventListener("pointermove", onPointerMove);
      canvas?.removeEventListener("pointerleave", onPointerLeave);
      engine.setPaddleInput({ direction: 0 });
    };
  }, [handPlay, s.mode]);
  // --- end jdm-rhythm-runner ---

  // Any physics-relevant change invalidates a seed found by the finder.
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.mode, s.gravity, s.bounce, s.ballSpeed, s.rotationSpeed, s.rotationEnabled, s.circleColor, s.ballColor, s.ballRadius, s.wallCount, s.wallThickness, s.gapSize, s.spikesEnabled, s.spikeCount, s.multiplySpawnCount, s.targetCount, s.colorMatchColorCount, s.growRate, s.airDrag, s.windX, s.windY, s.spinStrength, s.wallBounciness, s.breathingAmplitude, s.breathingSpeed, s.rotatingGravity, s.ballInteraction, s.splitMinRadius, s.maxBalls, s.dropBallCount, s.dropSizeVariation, s.dropGravityVariation, s.dropRows, s.dropSpawnInterval, s.dropLoop, s.boxShapeCount, s.boxShape, s.boxAspect, s.boxGravity, s.boxCountdown, s.boxGrowPerHit, s.boxSpeedRatio, s.pwCount, s.pwBaseOscillations, s.pwCycleSeconds, s.pwAmplitude, s.pwLayout, s.pwPolygon, s.pwPhasing, s.pwSoundOn, s.pwPitchDirection, s.pwWaveChord, s.pwCycles]);

  // --- teams --- Live add/remove of balls when the ball count (the old "two balls" switch) or the team roster changes – only in the
  // multi-ball modes (Ball Drop starts with many balls of its own; see engine.setBallCount()). A new count invalidates a found seed.
  const ballCount = effectiveBallCount(s);
  const prevBallCountRef = useRef(ballCount);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || prevBallCountRef.current === ballCount) return;
    prevBallCountRef.current = ballCount;
    engine.setSeed(null);
    engine.setBallCount(ballCount);
  }, [ballCount, s.mode]);

  // --- rigged --- never escape and the forced winner travel in the physics config (the finder's engines copy it); a change
  // drops a found seed, and its promise with it
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setConfig(riggedConfigOf(s));
    engine.setSeed(null);
    setSearchResult((r) => (r?.found ? null : r));
  }, [s.neverEscape, s.forcedWinner]); // eslint-disable-line react-hooks/exhaustive-deps
  // The outcomes the finder can search for here (the run length only when the run can end – "never escape" ends that in
  // the escape modes), the one in effect, the names of the balls that can win and what the panel says about them.
  const finderEndless = runNeverFinishes(s.mode, { drop: dropSettingsOf(s), box: boxSettingsOf(s), pendulum: pendulumSettingsOf(s), polyrhythm: polyrhythmSettingsOf(s), doublePendulum: doublePendulumSettingsOf(s), illusion: illusionSettingsOf(s), ...jdmRhythmFinderSettingsOf(s) /* --- jdm-rhythm-runner --- */ }) || rigNeverFinishes(s.mode, s); // --- jdm-double-pendulum --- --- jdm-illusions --- (as showFinder)
  const finderOutcomes = availableOutcomes(s.mode, { endless: finderEndless, neverEscape: s.neverEscape, ballCount });
  const finderOutcome = effectiveOutcome(findOutcome, finderOutcomes);
  const winnerNames = teamChoiceNames(s, (kind, n) => t(kind === "team" ? "Rigged.teamN" : "Rigged.ballN", { n }));
  const findWinnerTeam = Math.max(0, Math.min(findWinner, winnerNames.length - 1));
  const outcomeText = { duration: findDuration, escapeAt: findEscapeAt, winnerName: winnerNames[findWinnerTeam] ?? "" };
  const riggedNote = [s.neverEscape && neverEscapeApplies(s.mode) ? t("Rigged.noteNeverEscape") : "", forcedWinnerApplies(s.mode, ballCount, s.forcedWinner, s.neverEscape) ? t("Rigged.noteWinner", { name: winnerNames[s.forcedWinner] ?? "" }) : ""].filter(Boolean).join(" · ");
  // --- end rigged ---

  // Mirror settings into the URL so any setup can be bookmarked or shared.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = settingsToSearchParams(settings);
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [settings]);

  /* ------------------------------------------------------------ mode change */

  const changeMode = useCallback(
    (mode: ModeId) => {
      const engine = engineRef.current;
      finderAbortRef.current?.abort();
      finderAbortRef.current = null;
      setIsSearching(false);
      setSearchResult(null);
      setIsStarted(false);
      setIsPaused(false);
      setFinished(false);
      audioRef.current?.resetCustomNoteIndex();
      audioRef.current?.getSlicer().reset();
      audioRef.current?.resetBeatGrid();
      const fresh = {
        ...defaultSettings(mode),
        ...musicSettingsOf(settings),
        recordingResolution: settings.recordingResolution,
        watermarkText: settings.watermarkText,
        wallBreakSound: settings.wallBreakSound,
        hitSoundMode: settings.hitSoundMode,
        hitSampleId: settings.hitSampleId,
        hitSamplePitchByWall: settings.hitSamplePitchByWall,
        hitSampleVolume: settings.hitSampleVolume,
        sliceSong: settings.sliceSong,
        sliceMs: settings.sliceMs,
        sliceLoop: settings.sliceLoop,
        sliceFadeMs: settings.sliceFadeMs,
        musicVolume: settings.musicVolume,
        musicDucking: settings.musicDucking,
        musicDuckRelease: settings.musicDuckRelease,
        musicLoop: settings.musicLoop,
        musicStartOffset: settings.musicStartOffset,
        ...characterOf(settings), // --- boris-faces --- the character follows the ball into every mode
      };
      Object.assign(fresh, themeCarryOver(themeLookRef.current)); // --- themes: the background, particles and a picked theme's colours carry over
      Object.assign(fresh, teamCarryOver(themeLookRef.current)); // --- teams --- the roster (and so its balls) and the scoreboard switches carry over
      Object.assign(fresh, obstacleSettingsOf(themeLookRef.current)); // --- obstacle-editor --- the obstacle layout and bumper boost carry over
      Object.assign(fresh, captionCarryOver(themeLookRef.current)); // --- captions --- the captions are overlays: they carry over
      Object.assign(fresh, riggedConfigOf(themeLookRef.current)); // --- rigged --- the story carries over (never escape, the forced winner with its roster)
      Object.assign(fresh, timelineCarryOver(themeLookRef.current)); // --- timeline --- the keyframes script the clip: they carry over
      fresh.fastExportFps = themeLookRef.current.fastExportFps; // --- fast-render --- the export's frame rate carries over like the resolution
      setSettings(fresh);
      if (engine) {
        engine.setConfig({
          gravity: fresh.gravity,
          bounce: fresh.bounce,
          ballSpeed: fresh.ballSpeed,
          rotationSpeed: fresh.rotationSpeed,
          wallCount: fresh.wallCount,
          gapSize: fresh.gapSize,
          ballColor: fresh.ballColor,
          ballRadius: fresh.ballRadius,
          twoBalls: false,
          ballColor2: fresh.ballColor2,
          ballCount: effectiveBallCount(fresh), // --- teams ---
          ...physicsExtrasOf(fresh),
          ...ballInteractionOf(fresh),
        });
        initEngineForMode(engine, fresh);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.recordingResolution, settings.watermarkText, settings.wallBreakSound, settings.hitSoundMode, settings.hitSampleId, settings.hitSamplePitchByWall, settings.hitSampleVolume, settings.sliceSong, settings.sliceMs, settings.sliceLoop, settings.sliceFadeMs, settings.musicVolume, settings.musicDucking, settings.musicDuckRelease, settings.musicLoop, settings.musicStartOffset, settings.instrument, settings.melodyInstrument, settings.scale, settings.rootNote, settings.quantizeToBeat, settings.bpm, settings.quantizeGrid, initEngineForMode, settings.ballFace, settings.faceOverImage, settings.ballName, settings.nameLabel, settings.ballSquash, settings.faceSounds],
  );

  // Mode picked from the "Game Modes" cards further down the page (custom DOM event).
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<ModeId>).detail;
      changeMode(mode);
      document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("jumpingballslive:select-mode", handler);
    return () => window.removeEventListener("jumpingballslive:select-mode", handler);
  }, [changeMode]);

  /* ------------------------------------------------------------ start / pause / loop */

  const start = useCallback(async () => {
    if (!audioRef.current) {
      audioRef.current = new ToneGenerator();
      audioRef.current.setHitSampleStatusListener(setHitSampleStatus);
      audioRef.current.getMusicBed().setPlayingListener(setMusicPlaying);
    }
    await audioRef.current.start();
    setIsStarted(true);
    setAudioEnabled(true);
    setIsPaused(false);
  }, []);

  // Sound events + audio analyser + finished detection, polled once per frame.
  useEffect(() => {
    let raf = 0;
    let bins: Uint8Array<ArrayBuffer> | null = null;
    let tick = 0;
    const loop = () => {
      const engine = engineRef.current;
      const audio = audioRef.current;
      if (engine && audio) {
        for (const ev of engine.consumeSoundEvents()) {
          // --- jdm-race --- a pass plays the rising chime, the winner the fanfare
          if (ev.race) {
            audio.playRaceArpeggio(ev.race, ev.frequency);
            continue;
          }
          // --- obstacle-editor --- a bumper kick plays the pinball ding instead of a bounce tone
          if (ev.bumper) {
            audio.playBumper(ev.frequency);
            continue;
          }
          // --- odd-string-battle --- a cut thread's pluck, a ball's shatter
          if (ev.sbSound) {
            audio.playStringBattle(ev.sbSound, ev.frequency);
            continue;
          }
          if (ev.type === "gap") canvasRef.current?.noteWallBreak(); // --- boris-faces --- wide eyes when a wall breaks
          // --- jdm-rhythm-runner --- `melody: false` accompanies the tune (a paddle's wall bounce, a runner's crash): no melody note used up
          if (ev.type === "hit") audio.playWallHit(ev.wallIndex, ev.frequency, ev.accent, ev.chord, ev.level, ev.melody !== false);
          else if (ev.type === "gap") audio.playGapPass();
          else if (ev.type === "multiplier") audio.playMultiplier(ev.multiplier ?? 2, ev.melody !== false); // --- boris-multipliers --- the rising arpeggio
          else audio.playInteraction(ev.type);
        }
        canvasRef.current?.setSongProgress(audio.getSliceProgress());
      }
      if (isStarted && !isPaused && audioEnabled && audio) {
        const analyser = audio.getAnalyser();
        if (analyser) {
          if (!bins || bins.length !== analyser.frequencyBinCount) bins = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(bins);
          tick = (tick + 1) % 4;
          if (tick === 0) {
            let sum = 0;
            for (let i = 0; i < bins.length; i++) sum += bins[i];
            canvasRef.current?.setAudioIntensity(sum / bins.length / 255);
          }
        }
      }
      if (engine && isStarted && !isPaused) {
        let done = engine.isSimulationFinished();
        // Picture Paint: hold the finished picture crisp for a moment before the end screen covers it.
        if (done && engine.isPaintMode() && engine.getPaintState().picture) {
          const now = performance.now();
          if (paintFinishedAtRef.current === null) paintFinishedAtRef.current = now;
          if (now - paintFinishedAtRef.current < PAINT_FINISH_HOLD_MS) done = false;
        } else paintFinishedAtRef.current = null;
        // --- jdm-illusions --- the whitespace picture's reveal plays (and records) before the end screen covers it
        if (done && engine.isIllusionMode() && engine.getIllusionView().type === "whitespace") {
          const now = performance.now();
          if (illusionRevealAtRef.current === null) illusionRevealAtRef.current = now;
          if (now - illusionRevealAtRef.current < ILLUSION_REVEAL_HOLD_MS) done = false;
        } else illusionRevealAtRef.current = null;
        // --- odd-string-battle --- the last shatter, the ring flash and the winner banner play (and record) before the end screen
        if (done && engine.isStringBattleMode()) {
          const now = performance.now();
          if (battleFinishAtRef.current === null) battleFinishAtRef.current = now;
          if (now - battleFinishAtRef.current < STRING_BATTLE_FINISH_HOLD_MS) done = false;
        } else battleFinishAtRef.current = null;
        // --- jdm-arena-games --- the winner banner and its confetti play (and record) before the end screen covers them
        if (done && isArenaGameMode(engine.getCurrentModeName())) {
          const now = performance.now();
          if (arenaWinAtRef.current === null) arenaWinAtRef.current = now;
          if (now - arenaWinAtRef.current < ARENA_WIN_HOLD_MS) done = false;
        } else arenaWinAtRef.current = null;
        if (done && canvasRef.current?.holdsEndScreen()) done = false; // --- camera --- the escape replay plays (and records) before the end screen
        // --- teams --- hold the winner banner and its confetti on screen (and in a recording) before the end screen covers them
        // (after the camera: the banner waits for the escape replay, and its hold starts once the replay is over).
        // --- boris-multipliers --- so is a multipliers finish ("N Boris made it home", "OUTGREW THE ARENA"); with teams as
        // well both celebrations play at once, for the longer of the two holds.
        const holdMs = done ? Math.max(teamsPlayRef.current ? WINNER_HOLD_MS : 0, engine.endsWithMultiplierFinish() ? MULT_FINISH_HOLD_MS : 0) : 0;
        if (holdMs > 0) {
          const now = performance.now();
          if (winnerShownAtRef.current === null) winnerShownAtRef.current = now;
          if (now - winnerShownAtRef.current < holdMs) done = false;
        } else if (!done) winnerShownAtRef.current = null;
        setFinished((prev) => (prev !== done ? done : prev));
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [isStarted, isPaused, audioEnabled]);

  // FPS readout.
  useEffect(() => {
    const id = setInterval(() => {
      if (canvasRef.current?.fpsRef) setFps(Math.round(canvasRef.current.fpsRef.current));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // Elapsed time readout (written directly to the DOM to avoid re-renders).
  useEffect(() => {
    if (!isStarted || isPaused || finished) return;
    const id = setInterval(() => {
      const el = timeLabelRef.current;
      const engine = engineRef.current;
      if (!el || !engine) return;
      const secs = engine.getElapsedMs() / 1000;
      const m = Math.floor(secs / 60);
      const sec = secs % 60;
      el.textContent = m > 0 ? `${m}:${sec.toFixed(1).padStart(4, "0")}` : `${sec.toFixed(1)}s`;
    }, 100);
    return () => clearInterval(id);
  }, [isStarted, isPaused, finished]);

  // Keyboard shortcuts: Space = pause/resume, R = restart.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Space") {
        e.preventDefault();
        if (isStarted) setIsPaused((p) => !p);
      } else if (e.code === "KeyR" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        restart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isStarted, restart]);

  // Auto-pause when the simulator scrolls out of view or the tab is hidden (not while recording).
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (autoPausedRef.current) {
            autoPausedRef.current = false;
            setIsPaused(false);
          }
        } else {
          setIsPaused((p) => {
            if (p || !isStarted || isRecording) return p;
            autoPausedRef.current = true;
            return true;
          });
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isStarted, isRecording]);
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        setIsPaused((p) => {
          if (p || !isStarted || isRecording) return p;
          autoPausedRef.current = true;
          return true;
        });
      } else if (autoPausedRef.current) {
        autoPausedRef.current = false;
        setIsPaused(false);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isStarted, isRecording]);

  /* ------------------------------------------------------------ recording */

  const stopRecordingAndDownload = useCallback(async () => {
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    canvasRef.current?.setRecording(false);
    const recorder = recorderRef.current;
    if (recorder) {
      const blob = await recorder.stopRecording();
      if (blob) recorder.downloadBlob(blob, "jumpingballslive-export");
    }
    setIsRecording(false);
  }, []);

  const toggleRecording = useCallback(async () => {
    const canvas = canvasRef.current?.getCanvas();
    if (!canvas || !recordingSupported) return;
    if (isRecording) {
      await stopRecordingAndDownload();
      return;
    }
    if (!isStarted) await start();
    recorderRef.current = recorderRef.current || new VideoRecorder(canvas);
    await audioRef.current?.start();
    const resolution = resolutionToSize(settings.recordingResolution);
    // The canvas starts the captions' clip clock here and keeps them clear of the text lines the recorder draws.
    canvasRef.current?.setRecording(true, resolution);
    setIsRecording(true);
    const ok = await recorderRef.current.startRecording({
      mimeType: "video/mp4",
      resolution,
      audioStream: audioRef.current?.getAudioStream() || null,
      textOverlay: { topText: settings.topText, bottomText: settings.bottomText, textSize: settings.textSize, watermarkText: settings.watermarkText },
      // --- themes: the letterbox bars of the export continue the gradient / picture background
      backgroundColor: settings.backgroundColors[0],
      drawBackground: (c, width, height, crop) => canvasRef.current?.paintRecordingBackground(c, width, height, crop),
    });
    if (!ok) {
      canvasRef.current?.setRecording(false);
      setIsRecording(false);
      return;
    }
    recordTimerRef.current = setTimeout(() => {
      // The run is already over and the page is still holding it (the winner banner, the escape replay, a finished
      // picture): the effect below stops the export once that hold is over instead of cutting it off here. The
      // fallback timer only matters if the hold never ends (the run paused by hand, say).
      if (engineRef.current?.isSimulationFinished()) {
        recordTimerRef.current = setTimeout(() => void stopRecordingAndDownload(), END_HOLD_FALLBACK_MS);
        return;
      }
      void stopRecordingAndDownload();
    }, 1000 * settings.recordingDuration);
  }, [isRecording, isStarted, recordingSupported, settings, start, stopRecordingAndDownload]);

  // Stop the recording shortly after the run finishes.
  useEffect(() => {
    if (!isRecording || !finished) return;
    const id = setTimeout(() => void stopRecordingAndDownload(), 500);
    return () => clearTimeout(id);
  }, [isRecording, finished, stopRecordingAndDownload]);

  /* ------------------------------------------------------------ fast export */
  // --- fast-render --- "Fast export" renders the clip offline (lib/recording/fastRender.ts): a fresh engine set up like the page's
  // for the current run's seed, drawn by a hidden instance of the canvas (fastRenderHost), encoded with WebCodecs and downloaded.
  // The page's run pauses meanwhile and resumes afterwards. Without WebCodecs (or a usable encoder) the button says so and
  // Record Video takes over.
  const fastRenderHost = useMemo(() => new FastRenderHost(), []);
  const [fastExport, setFastExport] = useState<FastExportState>({ status: "idle" });
  const [fastSupported, setFastSupported] = useState<boolean | null>(null);
  useEffect(() => setFastSupported(fastRenderSupported()), []);
  const fastAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => fastAbortRef.current?.abort(), []); // an export stops with the page
  const fastRunning = fastExport.status === "running";
  // --- batch-render --- a batch job for the next export: its seed, and the file handed back instead of downloaded (useBatchRender.ts)
  const batchExportRef = useRef<BatchExportRequest | null>(null);
  const startFastExport = useCallback(async () => {
    const batchJob = batchExportRef.current; // --- batch-render ---
    batchExportRef.current = null;
    const page = engineRef.current;
    if (!page || fastAbortRef.current || isRecording || isSearching) return;
    const s = settings;
    // --- jdm-rhythm-runner --- a run played by hand needs its player: the export's fresh engine would run it with no input
    // (the button is off and says so; the batch render fails such a job with its own reason before it gets here).
    if (jdmRhythmPlayedByHand(s)) return;
    const resolution = resolutionToSize(s.recordingResolution);
    const fps = resolveFastExportFps(s.fastExportFps);
    if (!fastRenderSupported()) {
      setFastExport({ status: "fallback", reason: "webcodecs" });
      void toggleRecording();
      return;
    }
    const controller = new AbortController();
    fastAbortRef.current = controller;
    setFastExport({ status: "running", phase: "prepare", progress: 0, frame: 0, frames: Math.round(s.recordingDuration * fps), clipSec: 0, elapsedMs: 0 });
    if (!(await pickExportFormat(resolution.width, resolution.height, fps))) {
      fastAbortRef.current = null;
      setFastExport({ status: "fallback", reason: "codecs" });
      void toggleRecording();
      return;
    }
    const seed = batchJob?.seed ?? page.getSeed(); // --- batch-render --- (a batch job renders its own seed)
    const resume = isStarted && !isPaused;
    if (resume) setIsPaused(true);
    // Everything the page engine got from its settings effects beyond the config and the mode's settings (initEngineForMode).
    const paintOptions = page.getPaintOptions();
    const paintBeat = {
      source: s.paintBeatSource,
      manualBpm: s.bpm,
      grid: activeBeats ? { bpm: activeBeats.beats.bpm, beatTimes: activeBeats.beats.beatTimes, duration: activeBeats.beats.duration } : null,
      offset: activeBeats?.offset ?? 0,
      loop: activeBeats?.loop ?? true,
    };
    const teamsPlay = teamsPlayRef.current;
    // The export's engine is new, so its race's run serial starts at 1: its cup table scores the race under the page's key.
    const raceKey = page.isRaceMode() ? runKey(RACE_RUN_PREFIX, page.getRaceView()) : undefined;
    const exportRaceKey = batchJob && raceKey ? `${RACE_RUN_PREFIX}:batch-${batchJob.key}` : raceKey; // --- batch-render --- (a batch job's race is a race of its own)
    let lastProgress = 0;
    try {
      const result = await renderFast({
        host: fastRenderHost,
        seed,
        createEngine: () => {
          const engine = new PhysicsEngine({ ...page.config });
          engine.setSeed(seed);
          engine.setParticleStyle(s.particleStyle, particlePalette(s));
          engine.setPaintOptions(paintOptions);
          engine.setPaintBeat(paintBeat);
          initEngineForMode(engine, s);
          return engine;
        },
        world: { width: page.config.width, height: page.config.height },
        resolution,
        durationSec: s.recordingDuration,
        fps,
        audio: audioRef.current,
        endHolds: (engine) => fastExportEndHolds(engine, teamsPlay),
        raceKey: exportRaceKey, // --- batch-render ---
        textOverlay: { topText: s.topText, bottomText: s.bottomText, textSize: s.textSize, watermarkText: s.watermarkText },
        backgroundColor: s.backgroundColors[0],
        onProgress: (p) => {
          const now = performance.now();
          if (p.phase === "frames" && now - lastProgress < FAST_PROGRESS_MS) return;
          lastProgress = now;
          setFastExport({ status: "running", ...p });
        },
        signal: controller.signal,
      });
      batchJob?.settle(result ? { result } : { cancelled: true }); // --- batch-render --- the batch names, downloads and zips its files
      if (!result) setFastExport({ status: "cancelled" });
      else {
        if (!batchJob) downloadExport(result.blob, result.format.extension); // --- batch-render --- (not for a batch job)
        setFastExport({ status: "done", durationSec: result.durationSec, wallMs: result.wallMs, extension: result.format.extension, bytes: result.blob.size, digest: result.digest });
      }
    } catch (err) {
      batchJob?.settle({ error: err instanceof Error ? err.message : String(err) }); // --- batch-render ---
      if (err instanceof FastRenderUnsupportedError) setFastExport({ status: "fallback", reason: "codecs" });
      else {
        console.warn("Fast export failed:", err);
        setFastExport({ status: "error", message: err instanceof Error ? err.message : String(err) });
      }
    } finally {
      fastAbortRef.current = null;
      if (resume) setIsPaused(false);
    }
  }, [settings, isRecording, isSearching, isStarted, isPaused, activeBeats, fastRenderHost, initEngineForMode, toggleRecording]);
  const cancelFastExport = useCallback(() => fastAbortRef.current?.abort(), []);
  // --- end fast-render ---

  /* ------------------------------------------------------------ custom media */

  const onBallImageUpload = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      setBallImage((e.target?.result as string) || null);
      setBallEmoji(null);
    };
    reader.readAsDataURL(file);
  }, []);

  const onWallBreakSoundUpload = useCallback(
    (file: File) => {
      if (wallBreakObjectUrlRef.current) URL.revokeObjectURL(wallBreakObjectUrlRef.current);
      const url = URL.createObjectURL(file);
      wallBreakObjectUrlRef.current = url;
      setCustomWallBreakName(file.name);
      projectUploadsRef.current.wallBreakSound = file; // --- project-files ---
      update({ wallBreakSound: url });
    },
    [update],
  );

  const onHitSampleUpload = useCallback(
    (file: File) => {
      if (hitSampleObjectUrlRef.current) URL.revokeObjectURL(hitSampleObjectUrlRef.current);
      const url = URL.createObjectURL(file);
      hitSampleObjectUrlRef.current = url;
      setCustomHitSample({ name: file.name, url });
      projectUploadsRef.current.hitSample = file; // --- project-files ---
      update({ hitSampleId: CUSTOM_HIT_SAMPLE_ID, hitSoundMode: "sample" });
    },
    [update],
  );

  /**
   * Picture Paint: detects the beat grid of a decoded song in idle slices (lib/audio/beats.ts). A newer song in
   * the same slot cancels the running analysis; null clears the slot.
   */
  const analyzeSong = useCallback((slot: "music" | "slice", buffer: AudioBuffer | null) => {
    beatAbortRef.current[slot]?.abort();
    beatAbortRef.current[slot] = null;
    const setBeats = slot === "music" ? setMusicBeats : setSliceBeats;
    setBeats(null);
    if (!buffer) return;
    const controller = new AbortController();
    beatAbortRef.current[slot] = controller;
    setBeatJobs((n) => n + 1);
    analyzeBeatsAsync(buffer, {}, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setBeats(result);
      })
      .catch((err) => {
        if (!controller.signal.aborted) console.error("Beat analysis failed:", err);
      })
      .finally(() => {
        if (beatAbortRef.current[slot] === controller) beatAbortRef.current[slot] = null;
        setBeatJobs((n) => n - 1);
      });
  }, []);

  const onSliceSongUpload = useCallback(
    async (file: File) => {
      const audio = audioRef.current;
      if (!audio) return;
      const uploadId = ++sliceUploadIdRef.current;
      setSliceSongLoading(true);
      try {
        const buffer = await audio.decodeAudio(await file.arrayBuffer());
        if (uploadId !== sliceUploadIdRef.current) return; // a newer upload replaced this one
        audio.getSlicer().setBuffer(buffer);
        analyzeSong("slice", buffer);
        setSliceSongInfo({ name: file.name, duration: buffer.duration });
        projectUploadsRef.current.sliceSong = file; // --- project-files ---
        update({ sliceSong: true });
      } catch (err) {
        if (uploadId !== sliceUploadIdRef.current) return;
        console.error("Failed to decode song for the slicer:", err);
        alert(t("Controls.sliceDecodeError"));
      } finally {
        if (uploadId === sliceUploadIdRef.current) setSliceSongLoading(false);
      }
    },
    [t, update, analyzeSong],
  );

  const onSliceSongClear = useCallback(() => {
    sliceUploadIdRef.current++;
    audioRef.current?.getSlicer().setBuffer(null);
    analyzeSong("slice", null);
    setSliceSongInfo(null);
    setSliceSongLoading(false);
  }, [analyzeSong]);

  const onMusicUpload = useCallback(
    async (file: File) => {
      const audio = audioRef.current;
      if (!audio) return;
      const uploadId = ++musicUploadIdRef.current;
      setMusicLoading(true);
      try {
        const buffer = await audio.decodeAudio(await file.arrayBuffer());
        if (uploadId !== musicUploadIdRef.current) return; // a newer upload replaced this one
        audio.getMusicBed().setBuffer(buffer);
        analyzeSong("music", buffer);
        setMusicTrack({ name: file.name, duration: buffer.duration });
        projectUploadsRef.current.musicBed = file; // --- project-files ---
      } catch (err) {
        if (uploadId !== musicUploadIdRef.current) return;
        console.error("Failed to decode the music track:", err);
        alert(t("Controls.musicDecodeError"));
      } finally {
        if (uploadId === musicUploadIdRef.current) setMusicLoading(false);
      }
    },
    [t, analyzeSong],
  );

  const onMusicRemove = useCallback(() => {
    musicUploadIdRef.current++;
    audioRef.current?.getMusicBed().setBuffer(null);
    analyzeSong("music", null);
    setMusicTrack(null);
    setMusicLoading(false);
  }, [analyzeSong]);

  const getMusicDuckGain = useCallback(() => audioRef.current?.getMusicBed().getDuckGain() ?? 1, []);

  /** Picture Paint: the picture is decoded once here (so a file that is not a picture is refused) and kept as a data: URL. */
  const onPaintPictureUpload = useCallback(
    (file: File) => {
      const reject = () => alert(t("Controls.paintPictureError"));
      if (!file.type.startsWith("image/")) {
        reject();
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result;
        if (typeof url !== "string") {
          reject();
          return;
        }
        const img = new Image();
        img.onload = () => setPaintPicture({ name: file.name, url });
        img.onerror = reject;
        img.src = url;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    },
    [t],
  );

  const onPaintPictureRemove = useCallback(() => setPaintPicture(null), []);

  // --- themes: the background picture is decoded once here (a file that is not a picture is refused) and kept as a data: URL
  const onBackgroundImageUpload = useCallback(
    (file: File) => {
      const reject = () => alert(t("Controls.themeBgError"));
      if (!file.type.startsWith("image/")) {
        reject();
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const url = e.target?.result;
        if (typeof url !== "string") {
          reject();
          return;
        }
        const img = new Image();
        img.onload = () => {
          setBackgroundImage({ name: file.name, url });
          update({ backgroundType: "image" });
        };
        img.onerror = reject;
        img.src = url;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    },
    [t, update],
  );
  // Removing the picture falls back to the picked theme's background (or the plain solid one).
  const onBackgroundImageRemove = useCallback(() => {
    setBackgroundImage(null);
    setSettings((prev) => (prev.backgroundType === "image" ? { ...prev, backgroundType: themeById(prev.themeId)?.background.type ?? "solid" } : prev));
  }, []);
  const themeImage = useMemo<ThemeImageProps>(() => ({ image: backgroundImage, onUpload: onBackgroundImageUpload, onRemove: onBackgroundImageRemove }), [backgroundImage, onBackgroundImageUpload, onBackgroundImageRemove]);
  // --- end themes

  const onCustomSoundSelect = useCallback(async (id: string | null) => {
    if (!id) {
      audioRef.current?.clearCustomNotes();
      setCustomSoundId(null);
      setCustomSoundNoteCount(0);
      setCustomMidiName(null);
      return;
    }
    const song = SONGS.find((sng) => sng.id === id);
    if (!song) return;
    setCustomSoundId(id);
    setCustomMidiName(null);
    setCustomSoundLoading(true);
    try {
      const notes = await loadMidiFrequencies(song.file);
      audioRef.current?.setCustomNotes(notes);
      setCustomSoundNoteCount(notes.length);
    } catch (err) {
      console.error("Failed to load MIDI file:", err);
      setCustomSoundId(null);
      setCustomSoundNoteCount(0);
      audioRef.current?.clearCustomNotes();
    } finally {
      setCustomSoundLoading(false);
    }
  }, []);

  const onCustomMidiUpload = useCallback(
    async (file: File) => {
      setCustomSoundLoading(true);
      setCustomSoundId("custom-upload");
      setCustomMidiName(file.name);
      try {
        const notes = parseMidiToFrequencies(await file.arrayBuffer());
        audioRef.current?.setCustomNotes(notes);
        setCustomSoundNoteCount(notes.length);
        projectUploadsRef.current.midi = file; // --- project-files ---
      } catch (err) {
        console.error("Failed to parse uploaded MIDI file:", err);
        alert(t("Controls.midiParseError"));
        setCustomSoundId(null);
        setCustomMidiName(null);
        setCustomSoundNoteCount(0);
        audioRef.current?.clearCustomNotes();
      } finally {
        setCustomSoundLoading(false);
      }
    },
    [t],
  );

  /* ------------------------------------------------------------ presets */

  const onSavePreset = useCallback(
    (name: string) => {
      const next = { ...presets, [name]: { ...settings } };
      setPresets(next);
      savePresets(next);
    },
    [presets, settings],
  );

  // --- project-files --- a saved preset, an imported project and a share code all load their settings through here
  const loadPresetSettings = useCallback(
    (preset: Partial<SimulatorSettings>) => {
      finderAbortRef.current?.abort();
      finderAbortRef.current = null;
      setIsSearching(false);
      setSearchResult(null);
      // A preset saved with an uploaded clip can only use it while that upload is still in memory: the custom hit sample and
      // the uploaded wall-break sound stay while they are the page's live uploads (--- batch-render --- every batch job and the
      // batch's return to the page's own settings come through here too).
      const loaded = presetToLiveSettings(preset, { hitSample: !!customHitSample, wallBreakSound: wallBreakObjectUrlRef.current });
      setSettings(loaded);
      const engine = engineRef.current;
      if (engine) {
        engine.setConfig({
          gravity: loaded.gravity,
          bounce: loaded.bounce,
          ballSpeed: loaded.ballSpeed,
          rotationSpeed: loaded.rotationEnabled ? loaded.rotationSpeed : 0,
          wallCount: loaded.wallCount,
          gapSize: loaded.gapSize,
          ballColor: loaded.ballColor,
          ballRadius: loaded.ballRadius,
          twoBalls: loaded.twoBalls,
          ballColor2: loaded.ballColor2,
          ballCount: effectiveBallCount(loaded), // --- teams ---
          ...physicsExtrasOf(loaded),
          ...ballInteractionOf(loaded),
          timeline: engineTimelineOf(loaded), // --- timeline --- (the preset's run starts from its own keyframes' values)
        });
        initEngineForMode(engine, loaded);
      }
      audioRef.current?.getSlicer().reset();
      setIsStarted(false);
      setIsPaused(false);
      setFinished(false);
    },
    [customHitSample, initEngineForMode],
  );

  const onLoadPreset = useCallback(
    (name: string) => {
      const preset = presets[name];
      if (preset) loadPresetSettings(preset);
    },
    [presets, loadPresetSettings],
  );

  const onDeletePreset = useCallback(
    (name: string) => {
      const next = { ...presets };
      delete next[name];
      setPresets(next);
      savePresets(next);
    },
    [presets],
  );

  // --- project-files --- Export / Import project (the settings plus the media in memory) and the short ?c= share codes
  const projectFiles = useProjectFiles({
    settings,
    uploads: projectUploadsRef,
    media: {
      ballImage,
      ballEmoji,
      customHitSampleName: customHitSample?.name ?? null,
      customWallBreakName,
      sliceSongName: sliceSongInfo?.name ?? null,
      musicTrackName: musicTrack?.name ?? null,
      customSoundId,
      customMidiName,
      paintPicture,
      backgroundImage,
    },
    actions: {
      loadSettings: loadPresetSettings,
      update,
      setBallImage,
      setBallEmoji,
      setPaintPicture,
      setBackgroundImage,
      onHitSampleUpload,
      onWallBreakSoundUpload,
      onSliceSongUpload,
      onSliceSongClear,
      onMusicUpload,
      onMusicRemove,
      onCustomMidiUpload,
      onCustomSoundSelect,
    },
  });
  const shareCode = useShareCodeLoader(searchParams.toString(), loadPresetSettings);
  const shortShareLink = useShortShareLink(settings);
  // --- end project-files ---
  // --- batch-render --- a batch that puts other settings on the page drops a found simulation on the way (the preset loader
  // clears the result, the physics effects the seed): the batch keeps its seed and result as it starts and, once the page has
  // its own settings again, sets the found run up once more – exactly as Find Simulation left it (paused at its start)
  const keepFoundSimulation = useCallback(() => {
    const found = searchResult?.found ? searchResult : null;
    const seed = engineRef.current?.getSeed();
    if (!found || seed === undefined) return null;
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      const own = themeLookRef.current; // the page's settings as committed (the batch waited for its effects)
      engine.setSeed(seed);
      setFinished(false);
      setIsPaused(true);
      audioRef.current?.resetCustomNoteIndex();
      audioRef.current?.getSlicer().reset();
      audioRef.current?.resetBeatGrid();
      audioRef.current?.getMusicBed().stop();
      engine.setConfig({ ballRadius: own.ballRadius });
      initEngineForMode(engine, own);
      setSearchResult(found);
    };
  }, [searchResult, initEngineForMode]);
  // --- batch-render --- the Batch block of the Recording section: the fast export job after job, each with its seed, link,
  // mode or swept value put on the page first (loadPresetSettings / changeMode); the page gets its settings back afterwards
  const batchRender = useBatchRender({
    settings,
    exportRef: batchExportRef,
    startFastExport,
    applySettings: loadPresetSettings,
    keepFound: keepFoundSimulation,
    changeMode,
    update,
    pageRunning: isStarted && !isPaused,
    setPaused: setIsPaused,
    fastExport,
    supported: fastSupported,
    disabled: isRecording || isSearching || fastRunning || !engineReady || projectFiles.panel.busy === "import",
  });
  // --- end batch-render ---
  // --- viral-bot --- the Viral video bot block after the Batch block: it plans clips (lib/bot/planner.ts) in this page's
  // world, opens one on the page (its settings, its melody and – pinned like a found simulation – its seed) and renders a
  // plan through the batch renderer; a link's `seed=` (the bot's share links carry one) pins the page's first run on it
  const pinBotSeed = useCallback(
    (seed: number) => {
      const engine = engineRef.current;
      if (!engine) return;
      const own = themeLookRef.current; // the page's settings as committed
      engine.setSeed(seed);
      setFinished(false);
      audioRef.current?.resetCustomNoteIndex();
      audioRef.current?.getSlicer().reset();
      audioRef.current?.resetBeatGrid();
      audioRef.current?.getMusicBed().stop();
      engine.setConfig({ ballRadius: own.ballRadius });
      initEngineForMode(engine, own);
    },
    [initEngineForMode],
  );
  const botLocale = useLocale();
  const botMessages = useMessages() as Record<string, unknown>;
  const viralBot = useViralBot({
    locale: isBotLocale(botLocale) ? botLocale : "en",
    copy: (botMessages.ViralBot ?? {}) as BotCopy,
    getWorld: () => (engineRef.current ? { width: engineRef.current.config.width, height: engineRef.current.config.height } : null),
    applySettings: loadPresetSettings,
    selectMelody: onCustomSoundSelect,
    currentMelody: customSoundId,
    pinSeed: pinBotSeed,
    runJobs: batchRender.runJobs,
    stopBatch: batchRender.panel.onStop,
    batchRun: batchRender.panel.run,
    jobProgress: batchRender.panel.jobProgress,
    supported: fastSupported,
    disabled: isRecording || isSearching || fastRunning || !engineReady || projectFiles.panel.busy === "import" || batchRender.running,
  });
  const urlSeedPinned = useRef(false);
  useEffect(() => {
    if (!engineReady || urlSeedPinned.current) return;
    urlSeedPinned.current = true;
    const seed = parseSeed(searchParams.get("seed"));
    if (seed !== null) pinBotSeed(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineReady]);
  // --- end viral-bot ---

  const onResetSection = useCallback(
    (section: ControlSection) => {
      update(sectionDefaults(section, settings.mode));
      if (section === "ball") {
        setBallImage(null);
        setBallEmoji(null);
      }
      if (section === "visual") setPaintPicture(null);
      if (section === "visual") setBackgroundImage(null); // --- themes
      if (section === "sound") {
        void onCustomSoundSelect(null);
        onSliceSongClear();
        onMusicRemove();
      }
    },
    [settings.mode, update, onCustomSoundSelect, onSliceSongClear, onMusicRemove],
  );

  /* ------------------------------------------------------------ find simulation */

  const runFinder = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine || isSearching) return;
    setIsSearching(true);
    setSearchResult(null);
    setSearchProgress(null);
    const controller = new AbortController();
    finderAbortRef.current = controller;
    // --- rigged --- an outcome search (never escapes, escapes at, winner) instead of the run length
    // (a first escape later than the clip gets a clip that runs a few seconds past it)
    const clipSec = finderOutcome === "escapes-at" ? Math.max(findDuration, Math.ceil(findEscapeAt + 3)) : findDuration;
    const outcome: FinderOutcome | undefined = finderOutcome && finderOutcome !== "duration" ? { kind: finderOutcome, clipSec, atSec: findEscapeAt, team: findWinnerTeam } : undefined;
    setSearchOutcome(finderOutcome ?? "duration");
    const result = await findSimulation(
      {
        targetDurationSec: findDuration,
        toleranceSec: findTolerance,
        maxSeeds: findMaxSeeds,
        maxSimTimeSec: findDuration + (settings.mode === "colorMatch" ? 90 : 30),
        physicsConfig: { ...engine.config },
        mode: settings.mode,
        modeSettings: {
          bouncierEnabled: settings.bouncierEnabled,
          countdownTotal: settings.targetCount,
          countdownRandom: settings.countdownRandom,
          colorMatchColorCount: settings.colorMatchColorCount,
          accumulationTimerMax: 1000 * settings.accumulationTime,
          spikesEnabled: settings.spikesEnabled,
          spikeCount: settings.spikeCount,
          multiplySpawnCount: settings.multiplySpawnCount,
          shatterSegmentsPerWall: engine.getShatterSegmentsPerWall(),
          shatterHpPerSegment: engine.getShatterHpPerSegment(),
          growRate: settings.growRate,
          portalCount: engine.getPortalCount(),
          twoBalls: settings.twoBalls,
          drop: dropSettingsOf(settings),
          box: boxSettingsOf(settings),
          pendulum: pendulumSettingsOf(settings),
          polyrhythm: polyrhythmSettingsOf(settings), // --- jdm-polyrhythm ---
          // --- jdm-collisions ---
          collide: collideSettingsOf(settings),
          ballCount: effectiveBallCount(settings), // --- teams ---
          glass: glassSettingsOf(settings), // --- boris-glass ---
          multipliers: multipliersSettingsOf(settings), // --- boris-multipliers ---
          doublePendulum: doublePendulumSettingsOf(settings), // --- jdm-double-pendulum ---
          illusion: illusionSettingsOf(settings), // --- jdm-illusions ---
          stringBattle: stringBattleSettingsOf(settings), // --- odd-string-battle ---
          powerLayers: powerLayersSettingsOf(settings), // --- odd-power-layers ---
          race: raceSettingsOf(settings), // --- jdm-race ---
          // --- jdm-arena-games --- (capture the flag searches with a time limit past the target, so a game won on the score can match it)
          battle: battleSettingsOf(settings),
          ctf: ctfFinderSettings(ctfSettingsOf(settings), findDuration, findTolerance),
          ...jdmRhythmFinderSettingsOf(settings, rhythmBeatRef.current), // --- jdm-rhythm-runner --- (runner, paddle)
        },
        outcome, // --- rigged ---
      },
      (p) => setSearchProgress(p),
      controller.signal,
    );
    finderAbortRef.current = null;
    setIsSearching(false);
    setSearchResult(result);
    if (result.found) {
      engine.setSeed(result.seed);
      setFinished(false);
      setIsPaused(true);
      audioRef.current?.resetCustomNoteIndex();
      audioRef.current?.getSlicer().reset();
      audioRef.current?.resetBeatGrid();
      audioRef.current?.getMusicBed().stop(); // the found run starts over, so the bed does too
      // --- teams --- the recording also keeps the winner banner's hold after the run (--- boris-multipliers --- and the
      // board's "made it home", which ends every board run)
      const holdMs = Math.max(teamsPlayRef.current ? WINNER_HOLD_MS : 0, settings.mode === "multipliers" ? MULT_FINISH_HOLD_MS : 0);
      // --- rigged --- a found outcome run that goes on past its clip (never escapes; Multiply) has no end to hold for
      const hold = result.outcome && !result.finished ? 0 : holdMs;
      update({ recordingDuration: Math.max(RANGES.recordingDuration.min, Math.min(RANGES.recordingDuration.max, Math.ceil(result.duration + hold / 1000))) });
      // --- jdm-double-pendulum --- the clip length is this mode's run length (its finale ends the clip): a found seed keeps it
      if (settings.mode === "doublePendulum") update({ recordingDuration: settings.recordingDuration });
      // --- odd-string-battle --- a found battle is recorded with its finish hold (the last shatter and the winner banner)
      if (settings.mode === "stringBattle" && !(result.outcome && !result.finished)) update({ recordingDuration: Math.max(RANGES.recordingDuration.min, Math.min(RANGES.recordingDuration.max, Math.ceil(result.duration + STRING_BATTLE_FINISH_HOLD_MS / 1000))) });
      // --- jdm-arena-games --- the found game plus the winner banner's hold (a capture-the-flag game that ended on time keeps its clip)
      if (isArenaGameMode(settings.mode)) update({ recordingDuration: arenaFoundClipSec(settings.mode, result.duration, ctfFinderSettings(ctfSettingsOf(settings), findDuration, findTolerance).clipSeconds) });
      engine.setConfig({ ballRadius: settings.ballRadius });
      initEngineForMode(engine, settings);
    }
  }, [isSearching, findDuration, findTolerance, findMaxSeeds, settings, update, initEngineForMode, finderOutcome, findEscapeAt, findWinnerTeam]); // --- rigged --- (the outcome)

  const cancelFinder = useCallback(() => finderAbortRef.current?.abort(), []);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shortShareLink.get() ?? (await shortShareLink.make())); // --- project-files --- the short ?c= link (the long one without CompressionStream)
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, [shortShareLink]);

  /* ------------------------------------------------------------ canvas labels */

  const labels = useMemo<CanvasLabels>(() => {
    const fill = (key: string, vars: Record<string, string | number>) => {
      let text = t(key);
      for (const [k, v] of Object.entries(vars)) text = text.replace(`[${k}]`, String(v));
      return text;
    };
    return {
      escaped: t("Simulator.canvasEscaped"),
      afterFrozenBalls: (n) => fill("Simulator.canvasAfterFrozenBalls", { count: n }),
      frozenCount: (n) => fill("Simulator.canvasFrozenCount", { count: n }),
      painted: (pct) => fill("Simulator.canvasPainted", { pct }),
      teleports: t("Simulator.canvasTeleports"),
      afterTeleports: (n) => fill("Simulator.canvasAfterTeleports", { count: n }),
      shattered: t("Simulator.canvasShattered"),
      segmentsDestroyed: (b, total) => fill("Simulator.canvasSegmentsDestroyed", { broken: b, total }),
      segmentsShattered: t("Simulator.canvasSegmentsShattered"),
      matched: t("Simulator.canvasMatched"),
      segmentsCleared: (total) => fill("Simulator.canvasSegmentsCleared", { total }),
      matchColour: t("Simulator.canvasMatchColour"),
      complete: t("Simulator.canvasComplete"),
      segmentsHitInOrder: (total) => fill("Simulator.canvasSegmentsHitInOrder", { total }),
      ballsLabel: t("Simulator.canvasBalls"),
      settled: t("Simulator.canvasSettled"),
      ballsAtRest: (n) => fill("Simulator.canvasBallsAtRest", { count: n }),
      boxDone: t("Simulator.canvasBoxDone"),
      boxCounted: (n) => fill("Simulator.canvasBoxCounted", { count: n }),
      pendulumDone: t("Simulator.canvasPendulumDone"),
      pendulumInLine: (n, cycles) => fill("Simulator.canvasPendulumInLine", { count: n, cycles }),
      polyrhythmDone: t("Simulator.canvasPolyrhythmDone"), // --- jdm-polyrhythm ---
      polyrhythmAligned: (n, cycles) => fill("Simulator.canvasPolyrhythmAligned", { count: n, cycles }),
      paintOnSchedule: t("Simulator.canvasPaintOnSchedule"),
      paintBehind: t("Simulator.canvasPaintBehind"),
      paintAhead: t("Simulator.canvasPaintAhead"),
      paintBeat: (bpm) => fill("Simulator.canvasPaintBeat", { bpm }),
      // --- jdm-collisions ---
      collideAnti: t("Simulator.canvasCollideAnti"),
      replay: t("Simulator.canvasReplay"), // --- camera ---
      // --- boris-glass ---
      glassStage: (n) => fill("Simulator.canvasGlassStage", { n }),
      glassHome: t("Simulator.canvasGlassHome"),
      glassHomeTitle: t("Simulator.canvasGlassHomeTitle"),
      glassHomeSub: (panes, stages) => fill("Simulator.canvasGlassHomeSub", { panes, stages }),
      // --- boris-multipliers ---
      multipliers: {
        speed: t("Simulator.canvasMpSpeed"),
        size: t("Simulator.canvasMpSize"),
        damage: t("Simulator.canvasMpDamage"),
        bounce: t("Simulator.canvasMpBounce"),
        gravity: t("Simulator.canvasMpGravity"),
        balls: t("Simulator.canvasMpBalls"),
        release: t("Simulator.canvasMpRelease"),
        home: t("Simulator.canvasMpHome"),
        slowMo: (factor) => fill("Simulator.canvasMpSlowMo", { factor }),
      },
      outgrew: t("Simulator.canvasMpOutgrew"),
      outgrewSub: (size) => fill("Simulator.canvasMpOutgrewSub", { size }),
      madeItHome: (n) => fill("Simulator.canvasMpMadeItHome", { count: n, name: ballNameRef.current.trim() || DEFAULT_BORIS_NAME }),
      madeItHomeSub: (clones) => fill("Simulator.canvasMpMadeItHomeSub", { count: clones }),
      // --- jdm-double-pendulum ---
      dpDone: t("Simulator.canvasDpDone"),
      dpPlucks: (n) => fill("Simulator.canvasDpPlucks", { count: n }),
      dpHits: (n) => fill("Simulator.canvasDpHits", { count: n }),
      dpChaos: (seconds) => fill("Simulator.canvasDpChaos", { seconds }),
      // --- jdm-illusions ---
      illusionRevealed: t("Simulator.canvasIllusionRevealed"),
      illusionCycles: (n) => fill("Simulator.canvasIllusionCycles", { count: n }),
      // --- odd-string-battle ---
      stringBattle: {
        title: t("Simulator.canvasSbTitle"),
        web: (n) => fill("Simulator.canvasSbWeb", { count: n }),
        badgeTop: t("Simulator.canvasSbBadgeTop"),
        badgeBottom: t("Simulator.canvasSbBadgeBottom"),
        wins: (name) => t("Simulator.canvasSbWins").replace("[name]", () => name), // a name may hold "$&"
        kills: (n) => fill("Simulator.canvasSbKills", { count: n }),
        draw: t("Simulator.canvasSbDraw"),
        team: (n) => fill("Simulator.canvasTeamFallback", { n }),
      },
      // --- odd-power-layers ---
      powerLayers: {
        rules: {
          double: t("Simulator.canvasPlRuleDouble"),
          fibonacci: t("Simulator.canvasPlRuleFibonacci"),
          primes: t("Simulator.canvasPlRulePrimes"),
          plusOne: t("Simulator.canvasPlRulePlusOne"),
          random: t("Simulator.canvasPlRuleRandom"),
        },
        power: (n) => fill("Simulator.canvasPlPower", { n }),
        level: (n) => fill("Simulator.canvasPlLevel", { n }),
        newSound: t("Simulator.canvasPlNewSound"),
        soundOn: t("Simulator.canvasPlSoundOn"),
        warningTop: t("Simulator.canvasPlWarningTop"),
        warningBottom: t("Simulator.canvasPlWarningBottom"),
        layersLeft: (n) => fill("Simulator.canvasPlLayersLeft", { count: n }),
        freedom: t("Simulator.canvasPlFreedom"),
        freedomSub: (hits, seconds) => fill("Simulator.canvasPlFreedomSub", { hits, seconds }),
      },
      // --- jdm-arena-games ---
      arena: {
        ko: t("ArenaGames.ko"),
        wins: (name) => t("ArenaGames.wins").replace("[name]", () => name),
        draw: t("ArenaGames.draw"),
        left: (n) => fill("ArenaGames.left", { count: n }),
        capture: t("ArenaGames.capture"),
        time: t("ArenaGames.time"),
        battleSub: (kos, hp) => fill("ArenaGames.battleSub", { kos, hp }),
        ctfSub: (a, b) => fill("ArenaGames.ctfSub", { a, b }),
        zone: t("ArenaGames.zone"),
        names: Array.from({ length: 20 }, (_, i) => t(`ArenaGames.name${i + 1}`)),
      },
      // --- jdm-rhythm-runner ---
      jdmRhythm: {
        complete: t("JdmRhythm.complete"),
        completeSub: (jumps, onBeat, landings) => fill("JdmRhythm.completeSub", { jumps, onBeat, landings }),
        attempt: (n) => fill("JdmRhythm.attempt", { n }),
        auto: t("JdmRhythm.auto"),
        jumpHint: t("JdmRhythm.jumpHint"),
        bpm: (bpm) => fill("JdmRhythm.bpm", { bpm }),
        score: t("JdmRhythm.score"),
        miss: t("JdmRhythm.miss"),
        gameOver: t("JdmRhythm.gameOver"),
        gameOverSub: (hits, best) => fill("JdmRhythm.gameOverSub", { hits, best }),
        streak: (n) => fill("JdmRhythm.streak", { n }),
        moveHint: t("JdmRhythm.moveHint"),
      },
    };
  }, [t]);

  // --- boris-faces --- what the canvas needs to draw the ball characters, and the cat chirp through the ToneGenerator
  const characterRender = useMemo(
    () => characterRenderOptions(s),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.ballFace, s.faceOverImage, s.ballName, s.nameLabel, s.ballSquash, s.faceSounds, s.hitSoundMode],
  );
  const onCharacterChirp = useCallback((kind: ChirpKind) => audioRef.current?.playCharacterChirp(kind), []);
  // --- end boris-faces ---

  // --- teams --- the roster, names, scoreboard and translated labels the canvas draws with (null without a roster)
  const teamRender = useMemo<CanvasTeamOptions | null>(() => {
    const options = teamRenderOptions(s);
    if (!options) return null;
    const fill = (key: string, token: string, value: string | number) => t(key).replace(`[${token}]`, () => String(value)); // a name may hold "$&"
    return {
      ...options,
      labels: {
        bounces: t("Simulator.canvasTeamBounces"),
        walls: t("Simulator.canvasTeamWalls"),
        escapes: t("Simulator.canvasTeamEscapes"),
        wins: (name) => fill("Simulator.canvasTeamWins", "name", name),
        tie: t("Simulator.canvasTeamTie"),
        team: (n) => fill("Simulator.canvasTeamFallback", "n", n),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.teams, s.showBallNames, s.showScoreboard, s.scoreboardPosition, t]);
  useEffect(() => {
    teamsPlayRef.current = settings.teams.length > 0 && MULTI_BALL_MODES.includes(settings.mode);
  }, [settings.teams, settings.mode]);
  // --- end teams ---

  // --- captions --- the captions, the clip length their countdown / progress run to and the translated canvas words (null without captions)
  const captionRender = useMemo<CanvasCaptionOptions | null>(
    () => captionRenderOptions(s, { wall: t("Simulator.canvasCaptionWall"), question: t("Simulator.canvasCaptionQuestion") }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.captions, s.recordingDuration, t],
  );

  // --- jdm-race --- the racers' names, colours and emoji (the Teams roster, then the racer palette), the overlays, the cup and
  // the translated words the canvas draws with (null outside the race)
  const raceRender = useMemo<CanvasRaceOptions | null>(() => {
    if (s.mode !== "race") return null;
    const ct = (key: string) => t(`Controls.${key}`);
    const roster = raceRoster(s.teams, defaultRacerNames(ct));
    const fill = (key: string, vars: Record<string, string | number>) => {
      let text = t(key);
      for (const [k, v] of Object.entries(vars)) text = text.replace(`[${k}]`, () => String(v)); // a name may hold "$&"
      return text;
    };
    return {
      ...roster,
      showStandings: s.rcStandings,
      showMiniMap: s.rcMiniMap,
      cupEnabled: s.rcCup,
      cup: raceCup,
      cupTitle: cupTitleOf(ct, s),
      runKeyPrefix: RACE_RUN_PREFIX,
      labels: {
        go: t("Simulator.canvasRaceGo"),
        standings: t("Simulator.canvasRaceStandings"),
        leader: t("Simulator.canvasRaceLeader"),
        lap: (n, total) => fill("Simulator.canvasRaceLap", { n, total }),
        finalLap: t("Simulator.canvasRaceFinalLap"),
        finish: t("Simulator.canvasRaceFinish"),
        swap: t("Simulator.canvasRaceSwap"),
        passes: (a, b) => fill("Simulator.canvasRacePasses", { a, b }),
        takesLead: (a) => fill("Simulator.canvasRaceTakesLead", { a }),
        swapped: (a, b) => fill("Simulator.canvasRaceSwapped", { a, b }),
        wins: (a) => fill("Simulator.canvasRaceWins", { a }),
        dnf: t("Simulator.canvasRaceDnf"),
        podium: t("Simulator.canvasRacePodium"),
        place: (n) => (n >= 1 && n <= 3 ? t(`Simulator.canvasRacePlace${n}`) : fill("Simulator.canvasRacePlaceN", { n })),
        race: (n) => fill("Simulator.canvasRaceNumber", { n }),
        points: t("Simulator.canvasRacePoints"),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.mode, s.teams, s.rcStandings, s.rcMiniMap, s.rcCup, s.rcCupTitle, s.rcFeature, raceCup, t]);

  // "Find Simulation" only makes sense for a run that can finish (see runNeverFinishes: endless modes, Rain, countdown off, cycles at never).
  const showFinder = !runNeverFinishes(settings.mode, { drop: dropSettingsOf(settings), box: boxSettingsOf(settings), pendulum: pendulumSettingsOf(settings), polyrhythm: polyrhythmSettingsOf(settings), doublePendulum: doublePendulumSettingsOf(settings), illusion: illusionSettingsOf(settings), ...jdmRhythmFinderSettingsOf(settings) /* --- jdm-rhythm-runner --- */ }); // --- jdm-double-pendulum --- (endless) --- jdm-illusions --- (illusion)
  // --- jdm-polyrhythm --- a fixed-length run explains itself in the words of its mode.
  const finderFixedKey = settings.mode === "polyrhythm" ? "Simulator.finderFixedPolyrhythm" : settings.mode === "doublePendulum" ? "Simulator.finderFixedDoublePendulum" : settings.mode === "illusion" ? "Simulator.finderFixedIllusion" : "Simulator.finderFixed"; // --- jdm-double-pendulum --- (the clip length) --- jdm-illusions --- (illusion)
  // --- odd-power-layers --- Power Layers explains a fixed run length as its hit count × the bounce period.
  const plFinderFixedKey = settings.mode === "powerLayers" ? "Simulator.finderFixedPowerLayers" : finderFixedKey;
  // --- boris-multipliers --- with a count target the multipliers board is rigged by count (within 5 %), not by duration.
  const mpCountSearch = settings.mode === "multipliers" && settings.mpTarget > 0;
  // --- obstacle-editor --- the obstacles can be dragged on the canvas while the run is not going (before the start, paused)
  const obstacleEditing = supportsObstacles(s.mode) && s.obstacles.length > 0 && (!isStarted || isPaused) && !finished && !isRecording && !isSearching;
  const onObstaclesChange = useCallback((obstacles: EditorObstacle[]) => update({ obstacles }), [update]);
  // --- end obstacle-editor ---
  const overlayButton = "px-4 py-2 bg-slate-900/60 backdrop-blur-md rounded-xl hover:bg-slate-800/80 transition-all font-bold text-sm border border-slate-700/50 hover:border-cyan-500/40 shadow-lg shadow-cyan-500/10 cursor-pointer";
  const gradientText = "bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent";

  return (
    <main id="simulator" ref={mainRef} className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="lg:col-span-2 flex flex-col">
          <div className="bg-zinc-900/50 rounded-lg p-2 sm:p-4 border border-zinc-800">
            <div className="relative aspect-square sm:aspect-video bg-black rounded-lg overflow-hidden shadow-2xl shadow-cyan-500/20">
              {engineReady && engineRef.current && (
                <Canvas
                  ref={canvasRef}
                  physicsEngine={engineRef.current}
                  audioIntensity={0}
                  showTrails={s.showTrails}
                  trailThickness={s.trailThickness}
                  showGlow={s.showGlow}
                  showWallGlow={s.showWallGlow}
                  isPaused={isPaused}
                  isStarted={isStarted}
                  circleColor={s.circleColor}
                  wallThickness={s.wallThickness}
                  watermarkText={s.watermarkText}
                  rainbowWalls={s.rainbowWalls}
                  rainbowWallMode={s.rainbowWallMode}
                  rainbowBall={s.rainbowBall}
                  lineColor={s.lineColor}
                  rainbowLines={s.rainbowLines}
                  ballImage={ballImage}
                  ballEmoji={ballEmoji}
                  topText={s.topText}
                  bottomText={s.bottomText}
                  textSize={s.textSize}
                  reactiveBackground={s.reactiveBackground}
                  colorTrail={s.colorTrail}
                  cameraFollow={s.cameraFollow}
                  simSpeed={simSpeed}
                  labels={labels}
                  paintPicture={paintPicture?.url ?? null}
                  paintGhost={s.paintGhost}
                  character={characterRender}
                  onCharacterChirp={onCharacterChirp}
                  // --- themes
                  backgroundColor={s.backgroundColors[0]}
                  backgroundType={s.backgroundType}
                  backgroundColors={s.backgroundColors}
                  backgroundDim={s.backgroundDim}
                  backgroundImage={backgroundImage?.url ?? null}
                  trailColors={s.trailColors}
                  teams={teamRender} // --- teams ---
                  // --- camera ---
                  camera={cameraSettingsOf(s)}
                  // --- obstacle-editor ---
                  obstacleEditing={obstacleEditing}
                  onObstaclesChange={onObstaclesChange}
                  captions={captionRender} // --- captions ---
                  wallWobble={s.wallWobble} // --- jdm-illusions ---
                  fastRender={fastRenderHost} // --- fast-render ---
                  race={raceRender} // --- jdm-race ---
                />
              )}
              <div className="absolute bottom-4 left-4 px-4 py-2 bg-slate-900/60 backdrop-blur-md rounded-xl font-bold text-sm border border-slate-700/50 shadow-lg shadow-cyan-500/10 flex items-center gap-1.5">
                <span className={gradientText}>
                  {fps} {t("Simulator.fps")}
                </span>
              </div>
              {isRecording && (
                <button
                  type="button"
                  onClick={toggleRecording}
                  className="absolute top-4 left-4 bg-red-600 text-white px-3 py-1 rounded-full flex items-center gap-2 animate-pulse hover:bg-red-500 transition-colors cursor-pointer"
                  aria-label={t("Simulator.stopRecordingTooltip")}
                >
                  <div className="w-2 h-2 bg-white rounded-full" />
                  {t("Simulator.stopRecording")}
                </button>
              )}
              {isStarted && !isRecording && !finished && (
                <button type="button" onClick={restart} title={t("Simulator.restartTooltip")} className={`absolute top-4 left-4 group flex items-center gap-2 ${overlayButton}`}>
                  <span className={`${gradientText} group-hover:rotate-180 transition-transform duration-500 inline-block`}>↻</span>
                  <span className={gradientText}>{t("Simulator.restart")}</span>
                </button>
              )}
              {isStarted && !finished && (
                <button type="button" onClick={() => setIsPaused((p) => !p)} className={`absolute top-4 right-4 flex items-center gap-1.5 ${overlayButton}`}>
                  <span className={gradientText}>{isPaused ? t("Simulator.resume") : t("Simulator.pause")}</span>
                </button>
              )}
              {isStarted && (
                <div className="absolute bottom-4 right-4 flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-md rounded-xl border border-slate-700/40 p-1.5 shadow-2xl">
                  <span ref={timeLabelRef} className={`text-[11px] font-black font-mono ${gradientText} px-2 tabular-nums`}>
                    0.0s
                  </span>
                  <div className="w-px h-4 bg-slate-700/60" />
                  {SPEEDS.map((speed) => (
                    <button
                      type="button"
                      key={speed}
                      onClick={() => setSimSpeed(speed)}
                      aria-pressed={simSpeed === speed}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-black font-mono cursor-pointer ${simSpeed === speed ? "bg-cyan-500 text-slate-950" : "text-slate-400 hover:text-white hover:bg-slate-700/60"}`}
                    >
                      {speed}x
                    </button>
                  ))}
                </div>
              )}
              {isStarted && finished && !isRecording && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-md transition-all duration-500">
                  <button type="button" onClick={restart} className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-xl font-semibold text-base transition-all shadow-lg hover:scale-105 active:scale-95 text-slate-950 cursor-pointer">
                    {t("Simulator.restartSimulation")}
                  </button>
                </div>
              )}
              {isSearching && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-xl z-20">
                  <div className="text-center space-y-5 max-w-xs px-4">
                    <div className="text-5xl animate-pulse">🔍</div>
                    <p className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-400">{t("Simulator.findingSimulation")}</p>
                    {searchProgress && (
                      <div className="space-y-3">
                        <div className="w-full bg-zinc-800 rounded-full h-2.5 overflow-hidden">
                          <div className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-2.5 rounded-full transition-all duration-200" style={{ width: `${(searchProgress.seedsTested / searchProgress.maxSeeds) * 100}%` }} />
                        </div>
                        <p className="text-xs text-slate-400 font-mono">{t("Simulator.seedProgress", { tested: searchProgress.seedsTested, max: searchProgress.maxSeeds })}</p>
                        {searchOutcome !== "duration" /* --- rigged --- */ ? <p className="text-xs text-slate-500">{outcomeProgressText(t, searchOutcome, searchProgress)}</p> : searchProgress.bestDuration > 0 && <p className="text-xs text-slate-500">{mpCountSearch && searchProgress.bestCount !== undefined ? t("Simulator.finderMpClosestCount", { count: searchProgress.bestCount }) : t("Simulator.closestDuration", { duration: searchProgress.bestDuration.toFixed(1) })}</p>}
                      </div>
                    )}
                    <button type="button" onClick={cancelFinder} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-zinc-700 hover:border-zinc-600 cursor-pointer">
                      {t("Simulator.cancel")}
                    </button>
                  </div>
                </div>
              )}
              {!isStarted && !isSearching && searchResult && !searchResult.found && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70 backdrop-blur-xl z-20">
                  <div className="text-center space-y-5 max-w-xs px-4">
                    <div className="text-5xl">❌</div>
                    <p className="text-base font-bold text-red-400">{t("Simulator.didNotFind")}</p>
                    <p className="text-xs text-slate-500">
                      {outcomeOverlayText(t, searchResult, outcomeText) /* --- rigged --- */ ?? (searchResult.endless ? t("Simulator.finderEndless") : searchResult.fixedDuration ? t(plFinderFixedKey /* --- odd-power-layers --- */, { duration: searchResult.duration.toFixed(1) }) : mpCountSearch ? t("Simulator.finderMpTestedClosest", { tested: searchResult.seedsTested, closest: searchResult.count ?? 0, target: settings.mpTarget }) : t("Simulator.testedSeedsClosest", { tested: searchResult.seedsTested, closest: searchResult.duration.toFixed(1), target: findDuration, tolerance: findTolerance }))}
                    </p>
                    <button type="button" onClick={() => setSearchResult(null)} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-zinc-700 hover:border-zinc-600 cursor-pointer">
                      {t("Simulator.tryAgain")}
                    </button>
                  </div>
                </div>
              )}
              {!isStarted && !isSearching && !(searchResult && !searchResult.found) && !obstacleEditing && (
                <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 backdrop-blur-2xl">
                  <div className="text-center space-y-6 px-4">
                    <div className="text-7xl drop-shadow-[0_0_20px_rgba(34,211,238,0.3)]">⚡</div>
                    <p className="text-lg font-medium text-slate-300">
                      {searchResult?.found ? t("Simulator.readyToStartSimulationFor", { duration: searchResult.duration.toFixed(1) }) : t("Simulator.ready")}
                    </p>
                    {searchResult?.found && <p className="text-sm text-amber-500/90 max-w-sm mx-auto font-medium">{t("Simulator.doNotChangeSettingsWarning")}</p>}
                    <button type="button" onClick={start} className="px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-xl font-semibold text-base transition-all shadow-lg hover:scale-105 active:scale-95 text-slate-950 cursor-pointer">
                      {t("Simulator.startSimulator")}
                    </button>
                  </div>
                </div>
              )}
              {/* --- obstacle-editor --- with a layout in play the ready screen shrinks to a bar at the top, so the obstacles stay visible and draggable */}
              {!isStarted && !isSearching && !(searchResult && !searchResult.found) && obstacleEditing && (
                <div className="absolute inset-x-0 top-0 flex justify-center p-3 sm:p-4 pointer-events-none" data-testid="obstacle-ready-bar">
                  <div className="pointer-events-auto flex flex-col items-center gap-1.5 p-1.5 sm:px-4 sm:py-2.5 bg-slate-950/75 backdrop-blur-md rounded-2xl border border-slate-700/50 shadow-2xl shadow-cyan-500/10">
                    <div className="flex items-center justify-center gap-4">
                      <span className="hidden sm:inline text-sm font-medium text-slate-300">
                        {searchResult?.found ? t("Simulator.readyToStartSimulationFor", { duration: searchResult.duration.toFixed(1) }) : t("Simulator.ready")}
                      </span>
                      <button type="button" onClick={start} className="px-5 py-2 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-xl font-semibold text-sm transition-all shadow-lg hover:scale-105 active:scale-95 text-slate-950 cursor-pointer">
                        {t("Simulator.startSimulator")}
                      </button>
                    </div>
                    {/* A found seed holds only while nothing changes – moving an obstacle included (it drops the seed). */}
                    {searchResult?.found && (
                      <p className="max-w-sm px-2 text-center text-[11px] leading-snug text-amber-500/90 font-medium" data-testid="obstacle-ready-warning">
                        {t("Simulator.doNotChangeSettingsWarning")}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* --- timeline --- the keyframe markers and the playhead under the canvas */}
            {s.keyframes.length > 0 && <TimelineBar keyframes={s.keyframes} clipSec={s.recordingDuration} getEngine={getTimelineEngine} />}
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
              <span>{recordingSupported ? t("Simulator.exportFormatNote") : t("Simulator.recordingUnsupported")}</span>
              <button type="button" onClick={copyShareLink} className="shrink-0 px-2.5 py-1 rounded-md bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer">
                {shareCopied ? `✅ ${t("Simulator.shareLinkCopied")}` : `🔗 ${t("Simulator.shareLink")}`}
              </button>
            </div>
            {/* --- project-files --- a ?c= share code that could not be read */}
            <ShareCodeNotice t={t} notice={shareCode.notice} onDismiss={shareCode.dismiss} />
            {/* --- obstacle-editor --- how the obstacles are edited on the canvas */}
            {obstacleEditing && (
              <p className="mt-1.5 text-[11px] text-[#93d119]/80 leading-relaxed" data-testid="obstacle-canvas-hint">
                ✋ {t("Controls.obstacleHint")}
              </p>
            )}
            {/* --- rigged --- the rig is on: said here, outside the canvas, so the recording never shows it */}
            {riggedNote && (
              <p className="mt-1.5 text-[11px] text-amber-400/90 leading-relaxed" data-testid="rigged-note">
                🎭 {riggedNote}
              </p>
            )}
            {/* --- jdm-race --- a staged winner is said here too, outside the canvas */}
            {raceRender && s.rcWinner >= 0 && s.rcWinner < s.rcRacers && (
              <p className="mt-1.5 text-[11px] text-amber-400/90 leading-relaxed" data-testid="race-rigged-note">
                🎭 {t("Controls.rcRigNote", { name: raceRender.names[s.rcWinner] ?? "" })}
              </p>
            )}
          </div>

          {(showFinder || finderOutcome !== null) /* --- rigged --- (the outcomes) */ && (
            <div className="mt-6 max-w-[800px] mx-auto w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 shadow-xl flex-1 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-300">🔍 {t("Controls.findSimulation")}</span>
                <Tooltip text={t("Controls.findSimulationTip")} />
                {/* --- rigged --- the outcome to search for */}
                {finderOutcome !== null && <FinderOutcomeSelect outcomes={finderOutcomes} outcome={finderOutcome} onOutcome={setFindOutcome} disabled={isSearching} battle={BATTLE_WINNER_MODES.includes(settings.mode)} /* --- odd-string-battle --- */ />}
              </div>
              {/* --- rigged --- an outcome search's explanation and fields */}
              {finderOutcome !== null && <FinderOutcomeFields outcome={finderOutcome} escapeAt={findEscapeAt} onEscapeAt={setFindEscapeAt} winner={findWinnerTeam} onWinner={setFindWinner} teamNames={winnerNames} disabled={isSearching} battle={BATTLE_WINNER_MODES.includes(settings.mode)} /* --- odd-string-battle --- */ />}
              <div className="flex-1 flex flex-col justify-center">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-500" htmlFor="find-duration">
                      {t("Controls.duration")}
                    </label>
                    <span className="text-xs font-mono text-cyan-400">{findDuration}s</span>
                  </div>
                  <input
                    id="find-duration"
                    type="range"
                    min={RANGES.findDuration.min}
                    max={RANGES.findDuration.max}
                    step={RANGES.findDuration.step}
                    value={findDuration}
                    onChange={(e) => setFindDuration(Number(e.target.value))}
                    className="w-full h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer"
                    style={sliderStyle(findDuration, RANGES.findDuration.min, RANGES.findDuration.max)}
                  />
                  <div className="flex justify-between text-[10px] text-zinc-600">
                    <span>{RANGES.findDuration.min}s</span>
                    <span>{RANGES.findDuration.max}s</span>
                  </div>
                </div>
              </div>
              {isSearching && searchProgress && (
                <div className="space-y-2">
                  <div className="w-full bg-zinc-800 rounded-full h-2 overflow-hidden">
                    <div className="bg-gradient-to-r from-cyan-500 to-indigo-500 h-2 rounded-full transition-all duration-200" style={{ width: `${(searchProgress.seedsTested / searchProgress.maxSeeds) * 100}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-zinc-500">
                    <span className="font-mono">{t("Controls.seedProgress", { tested: searchProgress.seedsTested, max: searchProgress.maxSeeds })}</span>
                    {searchOutcome !== "duration" /* --- rigged --- */ ? <span>{outcomeProgressText(t, searchOutcome, searchProgress)}</span> : searchProgress.bestDuration > 0 && <span>{t("Controls.closestDuration", { duration: searchProgress.bestDuration.toFixed(1) })}</span>}
                  </div>
                </div>
              )}
              {!isSearching && searchResult && !searchResult.found && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-950/30 border border-red-900/30 rounded-lg">
                  <span className="text-sm">❌</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-red-400">{t("Controls.didNotFind")}</p>
                    <p className="text-[10px] text-zinc-500">{outcomeMissText(t, searchResult, outcomeText) /* --- rigged --- */ ?? (searchResult.fixedDuration ? t(settings.mode === "doublePendulum" ? "Controls.dpFixedRunLength" : settings.mode === "powerLayers" ? "Controls.plFixedRunLength" /* --- odd-power-layers --- */ : "Controls.fixedRunLength", { duration: searchResult.duration.toFixed(1) }) : mpCountSearch ? t("Controls.mpClosestCount", { count: searchResult.count ?? 0, seeds: searchResult.seedsTested }) : t("Controls.closestDurationWithSeeds", { duration: searchResult.duration.toFixed(1), seeds: searchResult.seedsTested }))}</p>
                  </div>
                  <button type="button" onClick={() => setSearchResult(null)} className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer" aria-label={t("Controls.clearSearch")}>
                    ✕
                  </button>
                </div>
              )}
              {!isSearching && searchResult && searchResult.found && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-emerald-950/30 border border-emerald-900/30 rounded-lg">
                  <span className="text-sm">✅</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-emerald-400">{outcomeFoundText(t, searchResult, outcomeText) /* --- rigged --- */ ?? (mpCountSearch && searchResult.count !== undefined ? t("Controls.mpFoundCount", { count: searchResult.count, duration: searchResult.duration.toFixed(1) }) : t("Controls.foundDuration", { duration: searchResult.duration.toFixed(1) }))}</p>
                    <p className="text-[10px] text-zinc-500">{t("Controls.seedTested", { seed: searchResult.seed, tested: searchResult.seedsTested })}</p>
                  </div>
                  <button type="button" onClick={() => setSearchResult(null)} className="text-zinc-500 hover:text-zinc-300 text-xs cursor-pointer" aria-label={t("Controls.clearSearch")}>
                    ✕
                  </button>
                </div>
              )}
              <button
                type="button"
                onClick={isSearching ? cancelFinder : runFinder}
                disabled={isRecording}
                className={`mt-auto w-full px-4 py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 shadow-lg text-xs uppercase tracking-wider cursor-pointer ${
                  isSearching
                    ? "bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700"
                    : "bg-gradient-to-r from-blue-600 to-cyan-600 text-slate-950 hover:from-blue-500 hover:to-cyan-500 shadow-blue-600/20 hover:scale-[1.02] active:scale-95"
                } ${isRecording ? "opacity-40 cursor-not-allowed" : ""}`}
              >
                {isSearching ? (
                  <>
                    <span className="animate-pulse">🔍</span> {t("Controls.cancelSearch")}
                  </>
                ) : (
                  <>🔍 {outcomeButtonText(t, finderOutcome, outcomeText) /* --- rigged --- */ ?? (mpCountSearch ? t("Controls.mpFindTarget", { target: settings.mpTarget }) : t("Controls.findDurationSimulation", { duration: findDuration }))}</>
                )}
              </button>
            </div>
          )}
        </div>

        <ProjectDropZone className="lg:col-span-1" label={t("Controls.projectDropHere")} onFile={projectFiles.importFile} /* --- project-files --- */>
          <Controls
            settings={settings}
            update={update}
            onResetSection={onResetSection}
            isRecording={isRecording}
            recordingSupported={recordingSupported && !fastRunning && !batchRender.running} // --- fast-render --- (not while a fast export runs) --- batch-render --- (or a batch)
            simulationFound={!!searchResult?.found}
            onRecordToggle={toggleRecording}
            ballImage={ballImage}
            onBallImageUpload={onBallImageUpload}
            onBallImageClear={() => setBallImage(null)}
            ballEmoji={ballEmoji}
            onBallEmojiChange={(emoji) => {
              setBallEmoji(emoji);
              if (emoji) setBallImage(null);
            }}
            customSoundId={customSoundId}
            customSoundLoading={customSoundLoading}
            customSoundNoteCount={customSoundNoteCount}
            onCustomSoundSelect={onCustomSoundSelect}
            customMidiName={customMidiName}
            onCustomMidiUpload={onCustomMidiUpload}
            customWallBreakName={customWallBreakName}
            onWallBreakSoundUpload={onWallBreakSoundUpload}
            customHitSampleName={customHitSample?.name ?? null}
            hitSampleStatus={hitSampleStatus}
            onHitSampleUpload={onHitSampleUpload}
            sliceSongName={sliceSongInfo?.name ?? null}
            sliceSongDuration={sliceSongInfo?.duration ?? 0}
            sliceSongLoading={sliceSongLoading}
            onSliceSongUpload={onSliceSongUpload}
            onSliceSongClear={onSliceSongClear}
            musicTrack={musicTrack}
            musicLoading={musicLoading}
            musicPlaying={musicPlaying}
            getMusicDuckGain={getMusicDuckGain}
            onMusicUpload={onMusicUpload}
            onMusicRemove={onMusicRemove}
            paintPicture={paintPicture}
            onPaintPictureUpload={onPaintPictureUpload}
            onPaintPictureRemove={onPaintPictureRemove}
            paintBeat={paintBeat}
            savedPresetNames={Object.keys(presets)}
            onSavePreset={onSavePreset}
            onLoadPreset={onLoadPreset}
            onDeletePreset={onDeletePreset}
            themeImage={themeImage} // --- themes
            fastExport={{ state: fastExport, supported: fastSupported, disabled: isRecording || isSearching || !engineReady || projectFiles.panel.busy === "import" || batchRender.running, handPlay: handPlayed, onStart: startFastExport, onCancel: cancelFastExport }} // --- fast-render --- (not while a project is being opened: its settings and media arrive over several renders) --- jdm-rhythm-runner --- (nor for a run played by hand)
            project={projectFiles.panel} // --- project-files ---
            batch={batchRender.panel} // --- batch-render ---
            bot={viralBot} // --- viral-bot ---
          />
        </ProjectDropZone>
      </div>
    </main>
  );
}
