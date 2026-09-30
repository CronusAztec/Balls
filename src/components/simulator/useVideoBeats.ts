"use client";

/**
 * --- video-beats --- The page's side of "Beats from a video": importing a video or audio file (lib/audio/mediaImport.ts),
 * making its audio the music bed and its detected beats the song grid, the beat source picker (BPM | Song | Media |
 * Manual; lib/simulation/beatSource.ts), hand-placed markers with tap tempo, the video background layer
 * (videoBeatsRenderer.ts) and On beat (lib/physics/onBeat.ts). Simulator.tsx calls this once and reads back:
 *  - `resolveActive(songBeats)`: the grid every rhythm feature follows (Picture Paint, the Beat Runner, …) – exactly the
 *    page's own song grid for the "song" source, the media's or the markers' grid otherwise, none for "bpm";
 *  - `onBeatConfig` for the engines (the page's, the fast export's, the finder's) and the beat lock's grid;
 *  - `videoLayer` for the canvas, `panel` for the Sound section, the project-file hooks and the fast-export frame hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { ToneGenerator } from "@/lib/audio/toneGenerator";
import type { BeatAnalysis } from "@/lib/audio/beats";
import { MediaImportError, analyzeMedia, decodeMediaFile, probeVideoSize, type MediaAnalysis, type MediaImportFailure, type MediaImportPhase } from "@/lib/audio/mediaImport";
import type { OnBeatConfig, OnBeatStats } from "@/lib/physics/onBeat";
import type { BeatClockConfig } from "@/lib/simulation/beatClock";
import {
  analysisBeatSource,
  beatClockConfigOf,
  bpmBeatSource,
  doubleMarkers,
  estimateTapTempo,
  halveMarkers,
  manualBeatSource,
  nudgeMarkers,
  parseMarkers,
  serializeMarkers,
  snapMarkersToOnsets,
  steadyMarkers,
  MAX_TAPS,
  type BeatSourceGrid,
  type BeatSourceKind,
  type TapEstimate,
} from "@/lib/simulation/beatSource";
import type { SimulatorSettings } from "@/lib/settings";
import type { MusicTrackInfo } from "./sections/MusicSection";
import type { ProjectUploads } from "./useProjectFiles";
import { VideoBackgroundLayer } from "./videoBeatsRenderer";

/** The page's song grid, as Simulator.tsx's `activeBeats` holds it. */
export interface ActiveBeats {
  beats: BeatAnalysis;
  source: "music" | "slicer";
  offset: number;
  loop: boolean;
}

export interface VideoBeatsMedia {
  name: string;
  duration: number;
  /** The file has a picture (it can be drawn behind the arena). */
  isVideo: boolean;
  /** How the audio was read: decodeAudioData, or played through a media element. */
  method: "decode" | "capture";
}

export interface VideoBeatsStatus {
  phase: "idle" | MediaImportPhase | "ready" | "error";
  progress: number;
  error?: MediaImportFailure | "generic";
}

/** Everything the Sound section's "Beats from a video" block shows and does. */
export interface VideoBeatsPanelProps {
  media: VideoBeatsMedia | null;
  status: VideoBeatsStatus;
  analysis: MediaAnalysis | null;
  /** The grid in effect and the source it really comes from (a picked source without its input falls back). */
  grid: BeatSourceGrid | null;
  effective: BeatSourceKind;
  /** The loaded song's detected tempo (the "song" source), null without one. */
  songBpm: number | null;
  markers: number[];
  /** Length (s) the marker timeline spans: the media, else the music bed track, else the clip. */
  timelineSec: number;
  /** The onsets and detected beats (s) the editor shows and snaps to (the media's, else the loaded song's). */
  onsets: readonly number[];
  detectedBeats: readonly number[];
  tap: TapEstimate | null;
  tapCount: number;
  previewPlaying: boolean;
  /** Song seconds being heard right now (the preview, else the running music bed), or null. */
  getPlayhead: () => number | null;
  getOnBeatStats: () => Readonly<OnBeatStats> | null;
  /** The last fast export left the video background out (seeking the file was too slow). */
  exportSkippedVideo: boolean;
  onImport: (file: File) => void;
  onCancel: () => void;
  onRemove: () => void;
  onPreviewToggle: () => void;
  onTap: () => void;
  onApplyTaps: () => void;
  onClearTaps: () => void;
  onMarkersChange: (markers: number[]) => void;
  onUseDetected: () => void;
  onSnap: () => void;
  onHalve: () => void;
  onDouble: () => void;
  onNudge: (ms: number) => void;
  onClear: () => void;
  onCycleDownbeat: () => void;
}

export interface VideoBeatsOptions {
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  audioRef: MutableRefObject<ToneGenerator | null>;
  engineRef: MutableRefObject<PhysicsEngine | null>;
  musicTrack: MusicTrackInfo | null;
  setMusicTrack: Dispatch<SetStateAction<MusicTrackInfo | null>>;
  musicBeats: BeatAnalysis | null;
  setMusicBeats: Dispatch<SetStateAction<BeatAnalysis | null>>;
  musicUploadIdRef: MutableRefObject<number>;
  beatAbortRef: MutableRefObject<{ music: AbortController | null; slice: AbortController | null }>;
  projectUploadsRef: MutableRefObject<ProjectUploads & { beatMedia?: File }>;
  /** The page's song grid (the music bed's, else the slicer's). */
  songBeats: ActiveBeats | null;
  isStarted: boolean;
  isPaused: boolean;
}

interface MediaState extends VideoBeatsMedia {
  track: MusicTrackInfo;
  url: string;
}

/** The beat lock's grid as On beat subdivisions: 1/4 = beats, 1/8 = halves, 1/16 = quarters. */
export function gridSubdivisions(grid: string): number {
  return grid === "1/4" ? 1 : grid === "1/16" ? 4 : 2;
}

/** A grid as the page's `activeBeats` (what Picture Paint and the Beat Runner read). */
function asActive(grid: BeatSourceGrid, source: "music" | "slicer"): ActiveBeats {
  return { beats: { bpm: grid.bpm, beatTimes: grid.beats.slice(), onsets: [], confidence: 1, duration: grid.duration, hopSec: 0 }, source, offset: grid.offset, loop: grid.loop };
}

export function useVideoBeats(o: VideoBeatsOptions) {
  const { settings: s, update, audioRef, engineRef, musicTrack, setMusicTrack, setMusicBeats, musicUploadIdRef, beatAbortRef, projectUploadsRef, songBeats, isStarted, isPaused } = o;
  const [media, setMedia] = useState<MediaState | null>(null);
  const [status, setStatus] = useState<VideoBeatsStatus>({ phase: "idle", progress: 0 });
  const [analysis, setAnalysis] = useState<MediaAnalysis | null>(null);
  const [taps, setTaps] = useState<number[]>([]);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [exportSkippedVideo, setExportSkippedVideo] = useState(false);
  const [videoLayer] = useState(() => new VideoBackgroundLayer());
  const importIdRef = useRef(0);
  const mediaRef = useRef<MediaState | null>(null);
  mediaRef.current = media;
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const latest = useRef(o);
  latest.current = o;

  const markers = useMemo(() => parseMarkers(s.beatMarkers), [s.beatMarkers]);
  const mediaIsBed = !!media && musicTrack === media.track;

  /* ------------------------------------------------------------ the grid in effect */

  const resolved = useMemo((): { active: ActiveBeats | null; grid: BeatSourceGrid | null; effective: BeatSourceKind } => {
    const bedLoaded = !!musicTrack;
    const downbeat = s.beatDownbeat;
    const songResolution = () =>
      songBeats
        ? { active: songBeats, grid: analysisBeatSource("song", songBeats.beats, { offset: songBeats.offset, loop: songBeats.loop, downbeat: downbeat >= 0 ? downbeat : 0 }), effective: "song" as const }
        : { active: null, grid: bpmBeatSource(s.bpm, s.recordingDuration), effective: "bpm" as const };
    if (s.beatSource === "bpm") return { active: null, grid: bpmBeatSource(s.bpm, s.recordingDuration), effective: "bpm" };
    if (s.beatSource === "media") {
      if (!analysis || !mediaIsBed || analysis.beats.bpm <= 0 || analysis.beats.beatTimes.length < 2) return songResolution();
      const grid = analysisBeatSource("media", analysis.beats, { offset: s.musicStartOffset, loop: s.musicLoop, energy: analysis.energy, downbeat: downbeat >= 0 ? downbeat : analysis.downbeat });
      return { active: { beats: analysis.beats, source: "music", offset: s.musicStartOffset, loop: s.musicLoop }, grid, effective: "media" };
    }
    if (s.beatSource === "manual") {
      if (markers.length < 2) return songResolution();
      const grid = manualBeatSource(markers, { duration: bedLoaded ? musicTrack.duration : 0, offset: bedLoaded ? s.musicStartOffset : 0, loop: bedLoaded && s.musicLoop, downbeat });
      return { active: asActive(grid, "music"), grid, effective: "manual" };
    }
    return songResolution();
  }, [s.beatSource, s.bpm, s.recordingDuration, s.musicStartOffset, s.musicLoop, s.beatDownbeat, songBeats, analysis, mediaIsBed, markers, musicTrack]);

  const clock = useMemo<BeatClockConfig>(() => beatClockConfigOf(resolved.grid, s.bpm), [resolved.grid, s.bpm]);
  const onBeatConfig = useMemo<OnBeatConfig>(() => ({ enabled: s.onBeat, clock, range: s.onBeatRange, subdivisions: gridSubdivisions(s.quantizeGrid) }), [s.onBeat, clock, s.onBeatRange, s.quantizeGrid]);
  const resolveActive = useCallback((own: ActiveBeats | null) => (resolved.effective === "song" ? own : resolved.active), [resolved]);

  // The engine's On beat follows the grid; a change of what the flights are timed to drops a found seed (the run changes).
  useEffect(() => {
    engineRef.current?.setOnBeat(onBeatConfig);
  }, [engineRef, onBeatConfig]);
  const onBeatKey = s.onBeat ? `${s.onBeatRange}|${s.quantizeGrid}|${clock.source}|${clock.manualBpm}|${clock.offset}|${clock.loop}|${clock.grid?.beatTimes.length ?? 0}|${clock.grid?.bpm ?? 0}|${clock.grid?.beatTimes[0] ?? 0}` : "off";
  const firstKeyRef = useRef(true);
  useEffect(() => {
    if (firstKeyRef.current) {
      firstKeyRef.current = false;
      return;
    }
    engineRef.current?.setSeed(null);
  }, [engineRef, onBeatKey]);

  // The beat lock follows a media or manual grid on the simulation clock (the BPM grid otherwise, as before).
  useEffect(() => {
    const follow = resolved.effective === "media" || resolved.effective === "manual";
    audioRef.current?.setBeatSourceClock(follow ? clock : null, () => (engineRef.current?.getElapsedMs() ?? 0) / 1000);
  }, [audioRef, engineRef, clock, resolved.effective]);

  // The video layer: on while the setting is on and the imported video is the music bed; on the bed's song time.
  useEffect(() => {
    videoLayer.setOptions({ enabled: s.videoBackground && !!media?.isVideo && mediaIsBed, opacity: s.videoBgOpacity, offset: s.musicStartOffset, loop: s.musicLoop });
  }, [videoLayer, s.videoBackground, s.videoBgOpacity, s.musicStartOffset, s.musicLoop, media, mediaIsBed]);

  /* ------------------------------------------------------------ import / remove */

  const stopPreview = useCallback(() => {
    const p = previewRef.current;
    if (p) {
      p.pause();
      p.removeAttribute("src");
      p.load();
    }
    previewRef.current = null;
    setPreviewPlaying(false);
  }, []);

  /**
   * Forgets the media (and, with `removeBed`, the music bed too while it still is the media). `cancelImport`: an import in
   * progress stops as well – not when another track merely replaced the bed (a project being opened may be importing its
   * own media right then).
   */
  const clearMedia = useCallback(
    (removeBed: boolean, cancelImport: boolean) => {
      if (cancelImport) {
        abortRef.current?.abort();
        abortRef.current = null;
        importIdRef.current++;
      }
      stopPreview();
      videoLayer.setSource(null);
      const prev = mediaRef.current;
      if (prev) URL.revokeObjectURL(prev.url);
      if (prev && removeBed) {
        const l = latest.current;
        if (l.musicTrack === prev.track) {
          l.musicUploadIdRef.current++;
          l.audioRef.current?.getMusicBed().setBuffer(null);
          l.setMusicTrack(null);
          l.setMusicBeats(null);
        }
      }
      mediaRef.current = null;
      setMedia(null);
      setAnalysis(null);
      setTaps([]);
      if (cancelImport || !abortRef.current) setStatus({ phase: "idle", progress: 0 });
      delete projectUploadsRef.current.beatMedia;
    },
    [stopPreview, videoLayer, projectUploadsRef],
  );

  // Another track loaded (or the bed removed) in the Background music block: the media is no longer the song.
  useEffect(() => {
    if (media && musicTrack !== media.track) clearMedia(false, false);
  }, [media, musicTrack, clearMedia]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      videoLayer.dispose();
    },
    [videoLayer],
  );

  const onImport = useCallback(
    async (file: File) => {
      const audio = audioRef.current;
      if (!audio) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const id = ++importIdRef.current;
      const stale = () => id !== importIdRef.current;
      setStatus({ phase: "reading", progress: 0 });
      setExportSkippedVideo(false);
      try {
        const decoded = await decodeMediaFile(file, (bytes) => audio.decodeAudio(bytes), { signal: controller.signal, onProgress: (p) => !stale() && setStatus({ phase: p.phase, progress: p.progress }) });
        if (stale()) return;
        // The media becomes the music bed (so an export carries its song), replacing any track or upload in progress.
        musicUploadIdRef.current++;
        beatAbortRef.current.music?.abort();
        beatAbortRef.current.music = null;
        audio.getMusicBed().setBuffer(decoded.buffer);
        const track: MusicTrackInfo = { name: file.name, duration: decoded.buffer.duration };
        const url = URL.createObjectURL(file);
        const picture = decoded.isVideo ? await probeVideoSize(url) : { width: 0, height: 0 };
        if (stale()) {
          URL.revokeObjectURL(url);
          return;
        }
        stopPreview();
        if (mediaRef.current) URL.revokeObjectURL(mediaRef.current.url);
        const next: MediaState = { name: file.name, duration: decoded.buffer.duration, isVideo: picture.width > 0, method: decoded.method, track, url };
        mediaRef.current = next;
        setMedia(next);
        videoLayer.setSource(picture.width > 0 ? url : null);
        setMusicTrack(track);
        setMusicBeats(null);
        setAnalysis(null);
        setTaps([]);
        projectUploadsRef.current.beatMedia = file;
        delete projectUploadsRef.current.musicBed;
        const result = await analyzeMedia(decoded.buffer, { signal: controller.signal, onProgress: (p) => !stale() && setStatus({ phase: p.phase, progress: p.progress }) });
        if (stale()) return;
        setAnalysis(result);
        setMusicBeats(result.beats); // the bed's song grid is the media's (Picture Paint, the Beat Runner, the "song" source)
        setStatus({ phase: "ready", progress: 1 });
        // A fresh import is what the page should follow – unless hand-placed markers are in use.
        if (latest.current.settings.beatSource !== "manual") update({ beatSource: "media" });
      } catch (err) {
        if (stale()) return;
        if (err instanceof DOMException && err.name === "AbortError") {
          setStatus({ phase: "idle", progress: 0 });
          return;
        }
        console.error("Media import failed:", err);
        setStatus({ phase: "error", progress: 0, error: err instanceof MediaImportError ? err.reason : "generic" });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [audioRef, musicUploadIdRef, beatAbortRef, setMusicTrack, setMusicBeats, projectUploadsRef, stopPreview, videoLayer, update],
  );
  const onImportVoid = useCallback((file: File) => void onImport(file), [onImport]);

  const onCancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);
  const onRemove = useCallback(() => clearMedia(true, true), [clearMedia]);

  /* ------------------------------------------------------------ preview, playhead, tap tempo */

  const getPlayhead = useCallback((): number | null => {
    const p = previewRef.current;
    if (p && !p.paused) return p.currentTime;
    const l = latest.current;
    if (l.isStarted && !l.isPaused && l.musicTrack) {
      const bed = l.audioRef.current?.getMusicBed();
      if (bed && bed.isPlaying()) return bed.getPosition();
      const engine = l.engineRef.current;
      if (engine) {
        const t = l.settings.musicStartOffset + engine.getElapsedMs() / 1000;
        return l.settings.musicLoop && l.musicTrack.duration > 0 ? t % l.musicTrack.duration : t;
      }
    }
    return null;
  }, []);

  const onPreviewToggle = useCallback(() => {
    if (!media) return;
    let p = previewRef.current;
    if (p && !p.paused) {
      p.pause();
      setPreviewPlaying(false);
      return;
    }
    if (!p) {
      p = new Audio(media.url);
      p.onended = () => setPreviewPlaying(false);
      p.onpause = () => setPreviewPlaying(false);
      previewRef.current = p;
    }
    p.play().then(
      () => setPreviewPlaying(true),
      () => setPreviewPlaying(false),
    );
  }, [media]);

  const tap = useMemo(() => estimateTapTempo(taps), [taps]);
  const onTap = useCallback(() => {
    const t = getPlayhead();
    if (t === null) return;
    setTaps((prev) => [...prev.slice(-(MAX_TAPS - 1)), t]);
  }, [getPlayhead]);
  const onClearTaps = useCallback(() => setTaps([]), []);

  const timelineSec = media ? media.duration : musicTrack ? musicTrack.duration : s.recordingDuration;
  const onApplyTaps = useCallback(() => {
    if (!tap) return;
    update({ beatMarkers: serializeMarkers(steadyMarkers(tap.bpm, tap.phase, timelineSec)), beatSource: "manual" });
  }, [tap, timelineSec, update]);

  // T taps while the media is heard (the preview, or the run with the media as its bed).
  const canTap = previewPlaying || (isStarted && !isPaused && !!musicTrack);
  useEffect(() => {
    if (!canTap) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyT" || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      e.preventDefault();
      onTap();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canTap, onTap]);

  /* ------------------------------------------------------------ marker editing */

  const setMarkers = useCallback((next: number[]) => update({ beatMarkers: serializeMarkers(next), beatSource: "manual" }), [update]);
  const onsets = useMemo<readonly number[]>(() => (analysis ? analysis.beats.onsets : (songBeats?.beats.onsets ?? [])), [analysis, songBeats]);
  const detectedBeats = useMemo<readonly number[]>(() => (analysis ? analysis.beats.beatTimes : (songBeats?.beats.beatTimes ?? [])), [analysis, songBeats]);
  const onUseDetected = useCallback(() => {
    if (detectedBeats.length >= 2) setMarkers(detectedBeats.map((t) => t * 1000));
  }, [detectedBeats, setMarkers]);
  const onSnap = useCallback(() => setMarkers(snapMarkersToOnsets(markers, onsets)), [markers, onsets, setMarkers]);
  const onHalve = useCallback(() => setMarkers(halveMarkers(markers)), [markers, setMarkers]);
  const onDouble = useCallback(() => setMarkers(doubleMarkers(markers)), [markers, setMarkers]);
  const onNudge = useCallback((ms: number) => setMarkers(nudgeMarkers(markers, ms)), [markers, setMarkers]);
  const onClear = useCallback(() => update({ beatMarkers: "" }), [update]);
  const onCycleDownbeat = useCallback(() => update({ beatDownbeat: s.beatDownbeat >= 3 ? -1 : s.beatDownbeat + 1 }), [s.beatDownbeat, update]);
  const getOnBeatStats = useCallback(() => engineRef.current?.getOnBeatStats() ?? null, [engineRef]);

  /* ------------------------------------------------------------ fast export */

  /** Before a fast export: readies the video layer (false: it is left out, too slow to seek). */
  const prepareExport = useCallback(async () => {
    if (!videoLayer.isActive()) return false;
    const ok = await videoLayer.prepareExport();
    setExportSkippedVideo(!ok);
    return ok;
  }, [videoLayer]);
  const exportFrame = useCallback((timeMs: number) => videoLayer.seekForExport(timeMs / 1000), [videoLayer]);
  const finishExport = useCallback(() => videoLayer.finishExport(), [videoLayer]);

  const panel = useMemo<VideoBeatsPanelProps>(
    () => ({
      media: media ? { name: media.name, duration: media.duration, isVideo: media.isVideo, method: media.method } : null,
      status,
      analysis,
      grid: resolved.grid,
      effective: resolved.effective,
      songBpm: songBeats && songBeats.beats.bpm > 0 ? songBeats.beats.bpm : null,
      markers,
      timelineSec,
      onsets,
      detectedBeats,
      tap,
      tapCount: taps.length,
      previewPlaying,
      getPlayhead,
      getOnBeatStats,
      exportSkippedVideo,
      onImport: onImportVoid,
      onCancel,
      onRemove,
      onPreviewToggle,
      onTap,
      onApplyTaps,
      onClearTaps,
      onMarkersChange: setMarkers,
      onUseDetected,
      onSnap,
      onHalve,
      onDouble,
      onNudge,
      onClear,
      onCycleDownbeat,
    }),
    [media, status, analysis, resolved, songBeats, markers, timelineSec, onsets, detectedBeats, tap, taps.length, previewPlaying, getPlayhead, getOnBeatStats, exportSkippedVideo, onImportVoid, onCancel, onRemove, onPreviewToggle, onTap, onApplyTaps, onClearTaps, setMarkers, onUseDetected, onSnap, onHalve, onDouble, onNudge, onClear, onCycleDownbeat],
  );

  return {
    panel,
    resolveActive,
    grid: resolved.grid,
    effective: resolved.effective,
    clock,
    onBeatConfig,
    videoLayer,
    mediaName: media?.name ?? null,
    /** Project files: load a stored medium through the import (it becomes the bed again). */
    onImport,
    prepareExport,
    exportFrame,
    finishExport,
  };
}
