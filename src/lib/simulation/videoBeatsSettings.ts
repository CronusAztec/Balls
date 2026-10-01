import { BEAT_SOURCE_KINDS, MAX_MARKER_TEXT, beatClockConfigOf, bpmBeatSource, isBeatSourceKind, manualBeatSource, parseMarkers, serializeMarkers, type BeatSourceKind } from "./beatSource";
import type { OnBeatConfig } from "@/lib/physics/onBeat";
import type { BeatGrid } from "./beatClock";
import { atLeastMin } from "@/lib/uncap"; // --- uncap-all ---

/**
 * --- video-beats --- The settings glue of "Beats from a video": the fields of the SimulatorSettings object, their slider
 * ranges, URL keys (bsrc bm bdb onbeat obr vbg vbgo) and validation, so settings.ts only spreads and calls these.
 * The imported media itself never travels in links or presets (it stays in the session and in project files).
 */

export interface VideoBeatsFields {
  /** Which grid every rhythm feature follows: bpm | song (the loaded song's detected beats; default) | media | manual (URL `bsrc`). */
  beatSource: BeatSourceKind;
  /** Hand-placed beat markers, delta-encoded milliseconds of the song (`serializeMarkers()`; URL `bm`). */
  beatMarkers: string;
  /** Which marker (0–3, counted in the bar) is the downbeat; −1 = the loudest beat of the bar (URL `bdb`). */
  beatDownbeat: number;
  /** On beat: the ring modes time their wall hits onto the beat grid (URL `onbeat`). */
  onBeat: boolean;
  /** On beat: how far a flight may be sped up or slowed down, 0.1–0.8 (×1.5 / ÷1.5 at 0.5; URL `obr`). */
  onBeatRange: number;
  /** The imported video drawn, dimmed, behind the arena (URL `vbg`). */
  videoBackground: boolean;
  /** Opacity of that video layer, 0.05–1 (URL `vbgo`). */
  videoBgOpacity: number;
}

export const VIDEO_BEATS_RANGES = {
  beatDownbeat: { min: -1, max: 3, step: 1 },
  onBeatRange: { min: 0.1, max: 0.8, step: 0.05 },
  videoBgOpacity: { min: 0.05, max: 1, step: 0.05 },
} as const;

export function defaultVideoBeatsFields(): VideoBeatsFields {
  return { beatSource: "song", beatMarkers: "", beatDownbeat: -1, onBeat: false, onBeatRange: 0.5, videoBackground: false, videoBgOpacity: 0.35 };
}

function clampTo(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? atLeastMin(n, range) /* --- uncap-all --- never a maximum */ : fallback;
}

/** Known source, markers re-encoded (malformed text drops them), clamped numbers, real booleans (URL parameters and presets alike). */
export function resolveVideoBeatsFields(source: Partial<VideoBeatsFields>): VideoBeatsFields {
  const d = defaultVideoBeatsFields();
  const markers = typeof source.beatMarkers === "string" && source.beatMarkers.length <= MAX_MARKER_TEXT ? serializeMarkers(parseMarkers(source.beatMarkers)) : d.beatMarkers;
  return {
    beatSource: isBeatSourceKind(source.beatSource) ? source.beatSource : d.beatSource,
    beatMarkers: markers,
    beatDownbeat: Math.round(clampTo(source.beatDownbeat, VIDEO_BEATS_RANGES.beatDownbeat, d.beatDownbeat)),
    onBeat: typeof source.onBeat === "boolean" ? source.onBeat : d.onBeat,
    onBeatRange: Math.round(20 * clampTo(source.onBeatRange, VIDEO_BEATS_RANGES.onBeatRange, d.onBeatRange)) / 20,
    videoBackground: typeof source.videoBackground === "boolean" ? source.videoBackground : d.videoBackground,
    videoBgOpacity: Math.round(20 * clampTo(source.videoBgOpacity, VIDEO_BEATS_RANGES.videoBgOpacity, d.videoBgOpacity)) / 20,
  };
}

function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

export function writeVideoBeatsParams(settings: VideoBeatsFields, base: VideoBeatsFields, params: URLSearchParams) {
  if (settings.beatSource !== base.beatSource) params.set("bsrc", settings.beatSource);
  if (settings.beatMarkers !== base.beatMarkers) params.set("bm", settings.beatMarkers);
  if (settings.beatDownbeat !== base.beatDownbeat) params.set("bdb", formatNumber(settings.beatDownbeat));
  if (settings.onBeat !== base.onBeat) params.set("onbeat", settings.onBeat ? "1" : "0");
  if (settings.onBeatRange !== base.onBeatRange) params.set("obr", formatNumber(settings.onBeatRange));
  if (settings.videoBackground !== base.videoBackground) params.set("vbg", settings.videoBackground ? "1" : "0");
  if (settings.videoBgOpacity !== base.videoBgOpacity) params.set("vbgo", formatNumber(settings.videoBgOpacity));
}

export function readVideoBeatsParams(params: URLSearchParams, settings: VideoBeatsFields) {
  const patch: Partial<VideoBeatsFields> = { ...settings };
  const bsrc = params.get("bsrc");
  if (bsrc !== null) patch.beatSource = bsrc as BeatSourceKind;
  const bm = params.get("bm");
  if (bm !== null) patch.beatMarkers = bm;
  const bdb = params.get("bdb");
  if (bdb !== null) patch.beatDownbeat = Number(bdb);
  const onbeat = params.get("onbeat");
  if (onbeat === "1" || onbeat === "0") patch.onBeat = onbeat === "1";
  const obr = params.get("obr");
  if (obr !== null) patch.onBeatRange = Number(obr);
  const vbg = params.get("vbg");
  if (vbg === "1" || vbg === "0") patch.videoBackground = vbg === "1";
  const vbgo = params.get("vbgo");
  if (vbgo !== null) patch.videoBgOpacity = Number(vbgo);
  Object.assign(settings, resolveVideoBeatsFields(patch));
}

/** The fields that follow the setup into another mode (the beat source is part of the song, like the music bed). */
export function videoBeatsCarryOver(settings: VideoBeatsFields): VideoBeatsFields {
  return {
    beatSource: settings.beatSource,
    beatMarkers: settings.beatMarkers,
    beatDownbeat: settings.beatDownbeat,
    onBeat: settings.onBeat,
    onBeatRange: settings.onBeatRange,
    videoBackground: settings.videoBackground,
    videoBgOpacity: settings.videoBgOpacity,
  };
}

/**
 * The On beat configuration these settings give without a page – no decoded song or media, so the "manual" source is the
 * markers on the simulation clock (offset 0, no loop) and every other source the BPM. The headless planners (the bot's finder
 * requests) use it; the page resolves the song and media grids itself (components/simulator/useVideoBeats.ts).
 */
export function onBeatConfigOfSettings(s: VideoBeatsFields & { bpm: number; quantizeGrid: string }): OnBeatConfig {
  const markers = s.beatSource === "manual" ? parseMarkers(s.beatMarkers) : [];
  const grid = markers.length >= 2 ? manualBeatSource(markers, { duration: 0, offset: 0, loop: false, downbeat: s.beatDownbeat }) : bpmBeatSource(s.bpm, 1);
  return { enabled: s.onBeat, clock: beatClockConfigOf(grid, s.bpm), range: s.onBeatRange, subdivisions: s.quantizeGrid === "1/4" ? 1 : s.quantizeGrid === "1/16" ? 4 : 2 };
}

/**
 * The grid a rhythm mode follows without a page (the Beat Runner, Beat Drop – the bot's finder requests): the hand-placed
 * markers on the simulation clock (offset 0, no loop – what the page resolves them to without a music bed), null for every
 * other source (the mode follows the BPM then; a song or a media grid needs the page). The shape of the page's `rhythmBeat`.
 */
export function markerBeatInputOf(s: Pick<VideoBeatsFields, "beatSource" | "beatMarkers" | "beatDownbeat">): { grid: BeatGrid; offset: number; loop: boolean } | null {
  if (s.beatSource !== "manual") return null;
  const markers = parseMarkers(s.beatMarkers);
  if (markers.length < 2) return null;
  const g = manualBeatSource(markers, { duration: 0, offset: 0, loop: false, downbeat: s.beatDownbeat });
  return { grid: { bpm: g.bpm, beatTimes: g.beats, duration: g.duration }, offset: g.offset, loop: g.loop };
}

export { BEAT_SOURCE_KINDS };
