"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import Canvas, { type CanvasHandle, type CanvasLabels } from "./Canvas";
import Controls, { sectionDefaults, sliderStyle, type ControlSection } from "./Controls";
import type { MusicTrackInfo } from "./sections/MusicSection";
import type { PaintBeatInfo, PaintPictureInfo } from "./sections/PicturePaintSection";
import type { ThemeImageInfo, ThemeImageProps } from "./sections/ThemeSection"; // --- themes
import Tooltip from "./Tooltip";
import { PhysicsEngine, TWO_BALL_MODES } from "@/lib/physics/engine";
import { physicsExtrasOf } from "@/lib/physics/extras";
import { ballInteractionOf } from "@/lib/physics/interactions";
import { boxSettingsOf } from "@/lib/physics/modes/box";
import { dropSettingsOf } from "@/lib/physics/modes/drop";
import { pendulumSettingsOf } from "@/lib/physics/modes/pendulum";
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
import {
  RANGES,
  defaultSettings,
  loadPresets,
  presetToSettings,
  resolutionToSize,
  savePresets,
  settingsFromSearchParams,
  settingsToSearchParams,
  type PresetStore,
  type SimulatorSettings,
} from "@/lib/settings";

const SPEEDS = [1, 2, 4, 8];
/** Picture Paint: how long the finished picture stays crisp on screen before the end screen covers it. */
const PAINT_FINISH_HOLD_MS = 1500;

/** Sound preferences that survive a mode change (like the wall-break clip does). */
function musicSettingsOf(s: SimulatorSettings): MusicSettings {
  return { instrument: s.instrument, melodyInstrument: s.melodyInstrument, scale: s.scale, rootNote: s.rootNote, quantizeToBeat: s.quantizeToBeat, bpm: s.bpm, quantizeGrid: s.quantizeGrid };
}

export default function Simulator() {
  const t = useTranslations();
  const searchParams = useSearchParams();

  const engineRef = useRef<PhysicsEngine | null>(null);
  const audioRef = useRef<ToneGenerator | null>(null);
  const recorderRef = useRef<VideoRecorder | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const timeLabelRef = useRef<HTMLSpanElement | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finderAbortRef = useRef<AbortController | null>(null);
  const autoPausedRef = useRef(false);
  const wallBreakObjectUrlRef = useRef<string | null>(null);
  const hitSampleObjectUrlRef = useRef<string | null>(null);
  const sliceUploadIdRef = useRef(0);
  const musicUploadIdRef = useRef(0);

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
  // --- themes: the background picture uploaded in this session (a data: URL kept in memory, never in links or presets)
  const [backgroundImage, setBackgroundImage] = useState<ThemeImageInfo | null>(null);
  const [presets, setPresets] = useState<PresetStore>({});
  const [findDuration, setFindDuration] = useState(30);
  const [findTolerance] = useState(0.5);
  const [findMaxSeeds] = useState(1000);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<FinderProgress | null>(null);
  const [searchResult, setSearchResult] = useState<FinderResult | null>(null);
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
      ...physicsExtrasOf(s),
      ...ballInteractionOf(s),
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

  /** Restart the current mode from scratch (R key / Restart button). */
  const restart = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    setFinished(false);
    setIsPaused(false);
    audioRef.current?.resetCustomNoteIndex();
    audioRef.current?.getSlicer().reset();
    audioRef.current?.resetBeatGrid();
    // The music bed starts over from its start offset with the run (the lifecycle effect below
    // cannot tell a restart from "still running", so it is done here).
    if (isStarted) audioRef.current?.getMusicBed().restart();
    else audioRef.current?.getMusicBed().stop();
    engine.setConfig({ ballRadius: settings.ballRadius });
    initEngineForMode(engine, settings);
  }, [settings, isStarted, initEngineForMode]);

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
  }, [s.pwCount, s.pwBaseOscillations, s.pwCycleSeconds, s.pwAmplitude, s.pwLayout, s.pwPolygon, s.pwPhasing, s.pwTrails, s.pwSoundOn, s.pwPitchDirection, s.pwWaveChord, s.pwCycles]);
  useEffect(() => {
    audioRef.current?.setWallBreakSound(s.wallBreakSound);
  }, [s.wallBreakSound]);
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

  // Any physics-relevant change invalidates a seed found by the finder.
  useEffect(() => {
    engineRef.current?.setSeed(null);
  }, [s.mode, s.gravity, s.bounce, s.ballSpeed, s.rotationSpeed, s.rotationEnabled, s.circleColor, s.ballColor, s.ballRadius, s.wallCount, s.wallThickness, s.gapSize, s.spikesEnabled, s.spikeCount, s.multiplySpawnCount, s.targetCount, s.colorMatchColorCount, s.growRate, s.airDrag, s.windX, s.windY, s.spinStrength, s.wallBounciness, s.breathingAmplitude, s.breathingSpeed, s.rotatingGravity, s.ballInteraction, s.splitMinRadius, s.maxBalls, s.dropBallCount, s.dropSizeVariation, s.dropGravityVariation, s.dropRows, s.dropSpawnInterval, s.dropLoop, s.boxShapeCount, s.boxShape, s.boxAspect, s.boxGravity, s.boxCountdown, s.boxGrowPerHit, s.boxSpeedRatio, s.pwCount, s.pwBaseOscillations, s.pwCycleSeconds, s.pwAmplitude, s.pwLayout, s.pwPolygon, s.pwPhasing, s.pwSoundOn, s.pwPitchDirection, s.pwWaveChord, s.pwCycles]);

  // Live add/remove of the second ball (only in the two-ball modes: Ball Drop starts with many balls of its own).
  const prevTwoBallsRef = useRef(s.twoBalls);
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || prevTwoBallsRef.current === s.twoBalls) return;
    prevTwoBallsRef.current = s.twoBalls;
    if (!TWO_BALL_MODES.includes(s.mode)) return;
    const balls = engine.getBalls();
    if (s.twoBalls && balls.length === 1) {
      const b = balls[0];
      const a = Math.atan2(b.vy, b.vx) + Math.PI;
      engine.addBall({ x: b.x, y: b.y, vx: Math.cos(a) * s.ballSpeed, vy: Math.sin(a) * s.ballSpeed, radius: b.radius, color: s.ballColor2 });
    } else if (!s.twoBalls && balls.length > 1) {
      engine.setBalls(balls.slice(0, 1));
    }
  }, [s.twoBalls, s.ballSpeed, s.ballColor2, s.mode]);

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
      };
      Object.assign(fresh, themeCarryOver(themeLookRef.current)); // --- themes: the background, particles and a picked theme's colours carry over
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
          ...physicsExtrasOf(fresh),
          ...ballInteractionOf(fresh),
        });
        initEngineForMode(engine, fresh);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.recordingResolution, settings.watermarkText, settings.wallBreakSound, settings.hitSoundMode, settings.hitSampleId, settings.hitSamplePitchByWall, settings.hitSampleVolume, settings.sliceSong, settings.sliceMs, settings.sliceLoop, settings.sliceFadeMs, settings.musicVolume, settings.musicDucking, settings.musicDuckRelease, settings.musicLoop, settings.musicStartOffset, settings.instrument, settings.melodyInstrument, settings.scale, settings.rootNote, settings.quantizeToBeat, settings.bpm, settings.quantizeGrid, initEngineForMode],
  );

  // Mode picked from the "Game Modes" cards further down the page (custom DOM event).
  useEffect(() => {
    const handler = (e: Event) => {
      const mode = (e as CustomEvent<ModeId>).detail;
      changeMode(mode);
      document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth" });
    };
    window.addEventListener("viralballs:select-mode", handler);
    return () => window.removeEventListener("viralballs:select-mode", handler);
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
          if (ev.type === "hit") audio.playWallHit(ev.wallIndex, ev.frequency, ev.accent, ev.chord);
          else if (ev.type === "gap") audio.playGapPass();
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
      if (blob) recorder.downloadBlob(blob, "viralballs-export");
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
    canvasRef.current?.setRecording(true);
    setIsRecording(true);
    const ok = await recorderRef.current.startRecording({
      mimeType: "video/mp4",
      resolution: resolutionToSize(settings.recordingResolution),
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
    recordTimerRef.current = setTimeout(() => void stopRecordingAndDownload(), 1000 * settings.recordingDuration);
  }, [isRecording, isStarted, recordingSupported, settings, start, stopRecordingAndDownload]);

  // Stop the recording shortly after the run finishes.
  useEffect(() => {
    if (!isRecording || !finished) return;
    const id = setTimeout(() => void stopRecordingAndDownload(), 500);
    return () => clearTimeout(id);
  }, [isRecording, finished, stopRecordingAndDownload]);

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

  const onLoadPreset = useCallback(
    (name: string) => {
      const preset = presets[name];
      if (!preset) return;
      finderAbortRef.current?.abort();
      finderAbortRef.current = null;
      setIsSearching(false);
      setSearchResult(null);
      const loaded = presetToSettings(preset);
      // A preset saved with an uploaded clip can only use it while that upload is still in memory.
      if (preset.hitSampleId === CUSTOM_HIT_SAMPLE_ID && customHitSample) loaded.hitSampleId = CUSTOM_HIT_SAMPLE_ID;
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
          ...physicsExtrasOf(loaded),
          ...ballInteractionOf(loaded),
        });
        initEngineForMode(engine, loaded);
      }
      audioRef.current?.getSlicer().reset();
      setIsStarted(false);
      setIsPaused(false);
      setFinished(false);
    },
    [presets, customHitSample, initEngineForMode],
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
        },
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
      update({ recordingDuration: Math.min(RANGES.recordingDuration.max, Math.ceil(result.duration)) });
      engine.setConfig({ ballRadius: settings.ballRadius });
      initEngineForMode(engine, settings);
    }
  }, [isSearching, findDuration, findTolerance, findMaxSeeds, settings, update, initEngineForMode]);

  const cancelFinder = useCallback(() => finderAbortRef.current?.abort(), []);

  const copyShareLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }, []);

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
      paintOnSchedule: t("Simulator.canvasPaintOnSchedule"),
      paintBehind: t("Simulator.canvasPaintBehind"),
      paintAhead: t("Simulator.canvasPaintAhead"),
      paintBeat: (bpm) => fill("Simulator.canvasPaintBeat", { bpm }),
    };
  }, [t]);

  // "Find Simulation" only makes sense for a run that can finish (see runNeverFinishes: endless modes, Rain, countdown off, cycles at never).
  const showFinder = !runNeverFinishes(settings.mode, { drop: dropSettingsOf(settings), box: boxSettingsOf(settings), pendulum: pendulumSettingsOf(settings) });
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
                  // --- themes
                  backgroundColor={s.backgroundColors[0]}
                  backgroundType={s.backgroundType}
                  backgroundColors={s.backgroundColors}
                  backgroundDim={s.backgroundDim}
                  backgroundImage={backgroundImage?.url ?? null}
                  trailColors={s.trailColors}
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
                        {searchProgress.bestDuration > 0 && <p className="text-xs text-slate-500">{t("Simulator.closestDuration", { duration: searchProgress.bestDuration.toFixed(1) })}</p>}
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
                      {searchResult.endless ? t("Simulator.finderEndless") : searchResult.fixedDuration ? t("Simulator.finderFixed", { duration: searchResult.duration.toFixed(1) }) : t("Simulator.testedSeedsClosest", { tested: searchResult.seedsTested, closest: searchResult.duration.toFixed(1), target: findDuration, tolerance: findTolerance })}
                    </p>
                    <button type="button" onClick={() => setSearchResult(null)} className="px-6 py-2 bg-zinc-800 hover:bg-zinc-700 text-slate-300 rounded-xl text-xs font-bold uppercase tracking-wider transition-all border border-zinc-700 hover:border-zinc-600 cursor-pointer">
                      {t("Simulator.tryAgain")}
                    </button>
                  </div>
                </div>
              )}
              {!isStarted && !isSearching && !(searchResult && !searchResult.found) && (
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
            </div>
            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-zinc-500">
              <span>{recordingSupported ? t("Simulator.exportFormatNote") : t("Simulator.recordingUnsupported")}</span>
              <button type="button" onClick={copyShareLink} className="shrink-0 px-2.5 py-1 rounded-md bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 transition-colors cursor-pointer">
                {shareCopied ? `✅ ${t("Simulator.shareLinkCopied")}` : `🔗 ${t("Simulator.shareLink")}`}
              </button>
            </div>
          </div>

          {showFinder && (
            <div className="mt-6 max-w-[800px] mx-auto w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-6 shadow-xl flex-1 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-zinc-300">🔍 {t("Controls.findSimulation")}</span>
                <Tooltip text={t("Controls.findSimulationTip")} />
              </div>
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
                    {searchProgress.bestDuration > 0 && <span>{t("Controls.closestDuration", { duration: searchProgress.bestDuration.toFixed(1) })}</span>}
                  </div>
                </div>
              )}
              {!isSearching && searchResult && !searchResult.found && (
                <div className="flex items-center gap-2 px-3 py-2.5 bg-red-950/30 border border-red-900/30 rounded-lg">
                  <span className="text-sm">❌</span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-red-400">{t("Controls.didNotFind")}</p>
                    <p className="text-[10px] text-zinc-500">{searchResult.fixedDuration ? t("Controls.fixedRunLength", { duration: searchResult.duration.toFixed(1) }) : t("Controls.closestDurationWithSeeds", { duration: searchResult.duration.toFixed(1), seeds: searchResult.seedsTested })}</p>
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
                    <p className="text-xs font-semibold text-emerald-400">{t("Controls.foundDuration", { duration: searchResult.duration.toFixed(1) })}</p>
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
                  <>🔍 {t("Controls.findDurationSimulation", { duration: findDuration })}</>
                )}
              </button>
            </div>
          )}
        </div>

        <div className="lg:col-span-1">
          <Controls
            settings={settings}
            update={update}
            onResetSection={onResetSection}
            isRecording={isRecording}
            recordingSupported={recordingSupported}
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
          />
        </div>
      </div>
    </main>
  );
}
