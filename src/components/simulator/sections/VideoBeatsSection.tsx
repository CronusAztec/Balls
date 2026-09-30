"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, offBtn, type Matcher, type Translate } from "../ControlPrimitives";
import type { VideoBeatsPanelProps } from "../useVideoBeats";
import { MEDIA_ACCEPT } from "@/lib/audio/mediaImport";
import { formatSongTime } from "@/lib/audio/slicer";
import { BEAT_SOURCE_KINDS, addMarker, markerIndexNear, markersBpm, moveMarker, removeMarker, type BeatSourceKind } from "@/lib/simulation/beatSource";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { ACCENT } from "@/lib/site";

/**
 * --- video-beats --- "Beats from a video" block of the Sound section: the beat source picker (BPM | Song | Media |
 * Manual), the video / audio import with its progress, the waveform strip with the beat markers (click to add or remove,
 * drag to move; the drawing of the waveform is cached), tap tempo, the marker tools, the video background and On beat.
 * The logic lives in useVideoBeats.ts and lib/simulation/beatSource.ts; this component edits the settings and calls the
 * panel's handlers.
 */

/** Search keys of the controls rendered here (added to SECTION_KEYS.sound in Controls.tsx). */
export const VIDEO_BEATS_KEYS = ["vbSource", "vbMedia", "vbMarkers", "vbVideoBg", "vbVideoOpacity", "vbOnBeat", "vbOnBeatRange"];

const SOURCE_LABELS: Record<BeatSourceKind, string> = { bpm: "sourceBpm", song: "sourceSong", media: "sourceMedia", manual: "sourceManual" };
const smallBtn = "px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";

interface WaveformEditorProps {
  peaks: Float32Array | null;
  duration: number;
  markers: number[];
  onsets: readonly number[];
  detected: readonly number[];
  /** Markers counted from this one (0–3) are the downbeats. */
  downbeat: number;
  getPlayhead: () => number | null;
  animate: boolean;
  onChange: (markers: number[]) => void;
  label: string;
  zoomInLabel: string;
  zoomOutLabel: string;
  scrollLabel: string;
}

/** Pixels within which a click picks a marker. */
const PICK_PX = 6;
/** Height of the strip (CSS px). */
const STRIP_HEIGHT = 76;

/**
 * The waveform strip: the whole waveform is drawn once into an offscreen canvas (per file), then every redraw copies the
 * visible window of it and draws the markers, onsets, detected beats and the playhead on top.
 */
function WaveformEditor({ peaks, duration, markers, onsets, detected, downbeat, getPlayhead, animate, onChange, label, zoomInLabel, zoomOutLabel, scrollLabel }: WaveformEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(300);
  const total = Math.max(1, duration);
  const [span, setSpan] = useState(() => Math.min(total, 8));
  const [start, setStart] = useState(0);
  const drag = useRef<{ index: number; x: number; moved: boolean; time: number } | null>(null);
  const [dragTick, setDragTick] = useState(0);
  const viewSpan = Math.min(span, total);
  const viewStart = Math.max(0, Math.min(start, total - viewSpan));

  // The waveform, drawn once per file.
  const cache = useMemo(() => {
    if (!peaks || typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = Math.min(8192, Math.max(1, peaks.length));
    c.height = 64;
    const g = c.getContext("2d");
    if (!g) return null;
    g.fillStyle = "rgba(147, 209, 25, 0.35)";
    const per = peaks.length / c.width;
    for (let x = 0; x < c.width; x++) {
      let p = 0;
      for (let i = Math.floor(x * per); i < Math.min(peaks.length, Math.floor((x + 1) * per) + 1); i++) p = Math.max(p, peaks[i]);
      const h = Math.max(1, p * 30);
      g.fillRect(x, 32 - h, 1, 2 * h);
    }
    return c;
  }, [peaks]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, Math.floor(el.clientWidth))));
    ro.observe(el);
    setWidth(Math.max(120, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);

  const xOf = useCallback((t: number) => ((t - viewStart) / viewSpan) * width, [viewStart, viewSpan, width]);
  const timeOf = useCallback((x: number) => viewStart + (x / width) * viewSpan, [viewStart, viewSpan, width]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    if (canvas.width !== Math.round(width * dpr)) canvas.width = Math.round(width * dpr);
    if (canvas.height !== Math.round(STRIP_HEIGHT * dpr)) canvas.height = Math.round(STRIP_HEIGHT * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#18181b";
    g.fillRect(0, 0, width, STRIP_HEIGHT);
    if (cache) g.drawImage(cache, (viewStart / total) * cache.width, 0, Math.max(1, (viewSpan / total) * cache.width), cache.height, 0, 6, width, STRIP_HEIGHT - 12);
    const end = viewStart + viewSpan;
    // Detected beats: faint lines; onsets: ticks along the bottom.
    g.fillStyle = "rgba(255,255,255,0.12)";
    for (const t of detected) if (t >= viewStart && t <= end) g.fillRect(Math.round(xOf(t)), 0, 1, STRIP_HEIGHT);
    g.fillStyle = "rgba(34,211,238,0.7)";
    for (const t of onsets) if (t >= viewStart && t <= end) g.fillRect(Math.round(xOf(t)), STRIP_HEIGHT - 6, 1, 6);
    // Markers: lime, the downbeats amber and thicker, the one being dragged where the pointer is.
    const d = drag.current;
    for (let i = 0; i < markers.length; i++) {
      const t = (d && d.index === i && d.moved ? d.time * 1000 : markers[i]) / 1000;
      if (t < viewStart || t > end) continue;
      const x = Math.round(xOf(t));
      const down = (i - downbeat) % 4 === 0;
      g.fillStyle = down ? "#f59e0b" : ACCENT;
      g.fillRect(x - (down ? 1 : 0), 0, down ? 3 : 2, STRIP_HEIGHT);
      g.beginPath();
      g.moveTo(x - 4, 0);
      g.lineTo(x + 4, 0);
      g.lineTo(x, 6);
      g.fill();
    }
    const head = getPlayhead();
    if (head !== null && head >= viewStart && head <= end) {
      g.fillStyle = "#ffffff";
      g.fillRect(Math.round(xOf(head)), 0, 1, STRIP_HEIGHT);
    }
  }, [width, cache, viewStart, viewSpan, total, detected, onsets, markers, downbeat, getPlayhead, xOf]);

  useEffect(() => {
    draw();
  }, [draw, dragTick]);

  // While the media plays the playhead moves (and the view follows it).
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const tick = () => {
      const head = getPlayhead();
      if (head !== null && (head < viewStart || head > viewStart + viewSpan)) setStart(Math.max(0, head - viewSpan * 0.1));
      draw();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, draw, getPlayhead, viewStart, viewSpan]);

  const localX = (e: React.PointerEvent<HTMLCanvasElement>) => e.clientX - e.currentTarget.getBoundingClientRect().left;
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const x = localX(e);
    const index = markerIndexNear(markers, timeOf(x) * 1000, (PICK_PX / width) * viewSpan * 1000);
    drag.current = { index, x, moved: false, time: timeOf(x) };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.index < 0) return;
    const x = localX(e);
    if (Math.abs(x - d.x) > 3) d.moved = true;
    d.time = Math.max(0, Math.min(total, timeOf(x)));
    setDragTick((n) => n + 1);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const x = localX(e);
    if (d.index >= 0) onChange(d.moved ? moveMarker(markers, d.index, Math.max(0, Math.min(total, timeOf(x))) * 1000) : removeMarker(markers, d.index));
    else onChange(addMarker(markers, Math.max(0, Math.min(total, timeOf(x))) * 1000));
  };

  const zoom = (factor: number) => {
    const centre = viewStart + viewSpan / 2;
    const next = Math.max(0.5, Math.min(total, viewSpan * factor));
    setSpan(next);
    setStart(Math.max(0, Math.min(total - next, centre - next / 2)));
  };

  return (
    <div className="space-y-1.5">
      <div ref={wrapRef} className="w-full rounded-md overflow-hidden border border-zinc-700/60">
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={label}
          data-testid="vb-waveform"
          data-markers={markers.length}
          style={{ width: "100%", height: STRIP_HEIGHT, display: "block", cursor: "crosshair", touchAction: "none" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (drag.current = null)}
        />
      </div>
      <div className="flex items-center gap-2">
        <button type="button" className={`${smallBtn} ${offBtn}`} onClick={() => zoom(2)} aria-label={zoomOutLabel} title={zoomOutLabel}>
          −
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(0, total - viewSpan)}
          step={0.01}
          value={viewStart}
          onChange={(e) => setStart(Number(e.target.value))}
          disabled={viewSpan >= total}
          aria-label={scrollLabel}
          className="flex-1 h-1.5 bg-zinc-800 rounded-full appearance-none cursor-pointer disabled:opacity-40"
        />
        <button type="button" className={`${smallBtn} ${offBtn}`} onClick={() => zoom(0.5)} aria-label={zoomInLabel} title={zoomInLabel}>
          +
        </button>
        <span className="text-[10px] font-mono text-zinc-500 tabular-nums">
          {formatSongTime(viewStart)}–{formatSongTime(viewStart + viewSpan)}
        </span>
      </div>
    </div>
  );
}

/** The On beat readout, polled twice a second while On beat is on. */
function OnBeatReadout({ get, t }: { get: VideoBeatsPanelProps["getOnBeatStats"]; t: ReturnType<typeof useTranslations> }) {
  const [text, setText] = useState("");
  useEffect(() => {
    const tick = () => {
      const s = get();
      setText(s && s.active ? t("onBeatStats", { onBeat: s.onBeat, hits: s.hits, beats: s.beatsCovered, err: Math.round(s.maxErrMs), free: s.unplanned }) : t("onBeatWaiting"));
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [get, t]);
  return (
    <p className="text-[11px] text-zinc-500 font-mono" data-testid="vb-onbeat-stats">
      {text}
    </p>
  );
}

export interface VideoBeatsSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  showAdvanced: boolean;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  panel: VideoBeatsPanelProps;
}

export default function VideoBeatsSection({ t, search, matches, showAdvanced, settings: s, update, panel }: VideoBeatsSectionProps) {
  const vb = useTranslations("VideoBeats");
  const [drag, setDrag] = useState(false);
  const { media, status, analysis } = panel;
  const busy = status.phase === "reading" || status.phase === "decoding" || status.phase === "capturing" || status.phase === "analysing";
  const bpmText = (bpm: number) => (bpm > 0 ? bpm.toFixed(1) : "–");
  const gridBpm = panel.grid && panel.grid.bpm > 0 ? panel.grid.bpm : 0;
  const markerBpm = markersBpm(panel.markers);
  const downbeat = s.beatDownbeat >= 0 ? s.beatDownbeat : 0;
  const errorKey = status.error === "too-large" ? "errorTooLarge" : status.error === "not-media" ? "errorNotMedia" : status.error === "no-audio" ? "errorNoAudio" : status.error === "unsupported" ? "errorUnsupported" : "errorGeneric";

  return (
    <div
      className={search ? "space-y-3" : "space-y-3 border-t border-zinc-800 pt-3"}
      data-testid="video-beats"
      data-vb-state={status.phase}
      data-vb-source={panel.effective}
      data-vb-bpm={analysis ? analysis.beats.bpm.toFixed(2) : ""}
      data-vb-beats={analysis ? analysis.beats.beatTimes.length : 0}
      data-vb-markers={panel.markers.length}
      data-vb-video={media?.isVideo ? "1" : "0"}
    >
      <Searchable search={search} matches={matches} labelKey="vbSource">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
            <span>
              🎬 {t("vbSource")}
              <Tooltip text={t("vbSourceTip")} />
            </span>
          </label>
          <p className="text-xs text-zinc-500 leading-relaxed">{vb("desc")}</p>
          <div className="grid grid-cols-4 gap-1" role="group" aria-label={t("vbSource")}>
            {BEAT_SOURCE_KINDS.map((kind) => (
              <button
                type="button"
                key={kind}
                onClick={() => update({ beatSource: kind })}
                aria-pressed={s.beatSource === kind}
                className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${s.beatSource === kind ? onBtn : offBtn}`}
              >
                {vb(SOURCE_LABELS[kind])}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-zinc-400" data-testid="vb-following">
            {vb("following", { source: vb(SOURCE_LABELS[panel.effective]), bpm: bpmText(gridBpm), beats: panel.grid?.beats.length ?? 0 })}
            {panel.effective !== s.beatSource && <span className="text-amber-400/90"> · {vb("fallback", { source: vb(SOURCE_LABELS[s.beatSource]) })}</span>}
          </p>
        </div>
      </Searchable>

      <Searchable search={search} matches={matches} labelKey="vbMedia">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            📼 {t("vbMedia")}
            <Tooltip text={t("vbMediaTip")} />
          </label>
          {media ? (
            <div className="flex items-center gap-2 px-3 py-2 bg-zinc-800/60 rounded-lg border border-zinc-700/60" data-testid="vb-media">
              <span className="text-lg" aria-hidden="true">
                {media.isVideo ? "🎞️" : "🎵"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-zinc-200 truncate" title={media.name}>
                  {media.name}
                </p>
                <p className="text-[11px] text-zinc-500 font-mono">
                  {formatSongTime(media.duration)} · {media.method === "capture" ? vb("methodCapture") : vb("methodDecode")}
                </p>
              </div>
              <button type="button" onClick={panel.onRemove} aria-label={vb("remove")} title={vb("remove")} className="text-zinc-500 hover:text-red-400 transition-colors text-sm cursor-pointer px-1">
                ✕
              </button>
            </div>
          ) : (
            <label
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                const file = e.dataTransfer.files?.[0];
                if (file) panel.onImport(file);
              }}
              className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-xs cursor-pointer border border-dashed ${
                drag ? "bg-[#93d119]/10 border-[#93d119] text-[#93d119] scale-[1.02] shadow-lg" : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500"
              } ${busy ? "opacity-60 pointer-events-none" : ""}`}
            >
              <span className="text-lg">{drag ? "📥" : "🎬"}</span>
              <span className="font-semibold">{drag ? vb("dropHere") : vb("choose")}</span>
              <input
                id="video-beats-file-input"
                type="file"
                accept={MEDIA_ACCEPT}
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    panel.onImport(file);
                    e.target.value = "";
                  }
                }}
              />
            </label>
          )}
          {busy && (
            <div className="space-y-1" role="status">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>{vb(`phase_${status.phase}`)}</span>
                <button type="button" onClick={panel.onCancel} className={`${smallBtn} ${offBtn}`}>
                  {vb("cancel")}
                </button>
              </div>
              <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden" role="progressbar" aria-label={vb("progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 * status.progress)}>
                <div className="h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-[#93d119] transition-all duration-150" style={{ width: `${Math.round(100 * Math.max(0.03, status.progress))}%` }} />
              </div>
              {status.phase === "capturing" && <p className="text-[10px] text-zinc-500 leading-relaxed">{vb("captureNote")}</p>}
            </div>
          )}
          {status.phase === "error" && <p className="text-xs text-red-400">{vb(errorKey)}</p>}
          {analysis && (
            <p className="text-[11px] text-zinc-400" data-testid="vb-detected">
              {analysis.beats.bpm > 0 ? vb("detected", { bpm: bpmText(analysis.beats.bpm), beats: analysis.beats.beatTimes.length, downbeat: analysis.downbeat + 1 }) : vb("noBeat")}
            </p>
          )}
          {!media && !busy && <p className="text-[10px] text-zinc-500 leading-relaxed">{vb("limits")}</p>}
        </div>
      </Searchable>

      {(media?.isVideo || !!search) && (
        <>
          <Searchable search={search} matches={matches} labelKey="vbVideoBg">
            <Toggle t={t} labelKey="vbVideoBg" tipKey="vbVideoBgTip" value={s.videoBackground} onChange={(v) => update({ videoBackground: v })} caseStyle="title" />
          </Searchable>
          {s.videoBackground && (
            <Slider t={t} search={search} matches={matches} labelKey="vbVideoOpacity" value={s.videoBgOpacity} range={RANGES.videoBgOpacity} onChange={(v) => update({ videoBgOpacity: v })} display={`${Math.round(100 * s.videoBgOpacity)}%`} left="🌑" right="🌕" />
          )}
          {panel.exportSkippedVideo && <p className="text-[11px] text-amber-400/90">{vb("exportSkipped")}</p>}
        </>
      )}

      <Searchable search={search} matches={matches} labelKey="vbMarkers">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300 flex items-center justify-between">
            <span>
              🥁 {t("vbMarkers")}
              <Tooltip text={t("vbMarkersTip")} />
            </span>
            <span className="text-[11px] text-zinc-500 font-mono" data-testid="vb-marker-count">
              {vb("markerCount", { count: panel.markers.length, bpm: bpmText(markerBpm) })}
            </span>
          </label>
          <WaveformEditor
            peaks={analysis?.peaks ?? null}
            duration={panel.timelineSec}
            markers={panel.markers}
            onsets={panel.onsets}
            detected={panel.detectedBeats}
            downbeat={downbeat}
            getPlayhead={panel.getPlayhead}
            animate={panel.previewPlaying}
            onChange={panel.onMarkersChange}
            label={vb("waveform")}
            zoomInLabel={vb("zoomIn")}
            zoomOutLabel={vb("zoomOut")}
            scrollLabel={vb("scroll")}
          />
          <p className="text-[10px] text-zinc-500 leading-relaxed">{vb("editHint")}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={panel.onPreviewToggle} disabled={!media} className={`${smallBtn} ${panel.previewPlaying ? onBtn : offBtn}`}>
              {panel.previewPlaying ? `⏸ ${vb("pause")}` : `▶ ${vb("play")}`}
            </button>
            <button type="button" onClick={panel.onTap} className={`${smallBtn} ${offBtn}`} title={vb("tapTip")} data-testid="vb-tap">
              👆 {vb("tap")}
            </button>
            <span className="text-[11px] text-zinc-400 font-mono" data-testid="vb-tap-result">
              {panel.tap ? vb("tapResult", { bpm: bpmText(panel.tap.bpm), taps: panel.tap.taps }) : vb("tapCount", { taps: panel.tapCount })}
            </span>
            <button type="button" onClick={panel.onApplyTaps} disabled={!panel.tap} className={`${smallBtn} ${offBtn}`}>
              {vb("applyTaps")}
            </button>
            {panel.tapCount > 0 && (
              <button type="button" onClick={panel.onClearTaps} className={`${smallBtn} ${offBtn}`}>
                {vb("clearTaps")}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" onClick={panel.onUseDetected} disabled={panel.detectedBeats.length < 2} className={`${smallBtn} ${offBtn}`} data-testid="vb-use-detected">
              {vb("useDetected")}
            </button>
            <button type="button" onClick={panel.onSnap} disabled={panel.markers.length === 0 || panel.onsets.length === 0} className={`${smallBtn} ${offBtn}`}>
              {vb("snap")}
            </button>
            <button type="button" onClick={panel.onHalve} disabled={panel.markers.length < 2} className={`${smallBtn} ${offBtn}`} title={vb("halveTip")}>
              ½×
            </button>
            <button type="button" onClick={panel.onDouble} disabled={panel.markers.length < 2} className={`${smallBtn} ${offBtn}`} title={vb("doubleTip")}>
              2×
            </button>
            <button type="button" onClick={() => panel.onNudge(-10)} disabled={panel.markers.length === 0} className={`${smallBtn} ${offBtn}`} title={vb("nudgeTip")}>
              −10 ms
            </button>
            <button type="button" onClick={() => panel.onNudge(10)} disabled={panel.markers.length === 0} className={`${smallBtn} ${offBtn}`} title={vb("nudgeTip")}>
              +10 ms
            </button>
            <button type="button" onClick={panel.onCycleDownbeat} className={`${smallBtn} ${offBtn}`} title={vb("downbeatTip")}>
              {s.beatDownbeat >= 0 ? vb("downbeatN", { n: s.beatDownbeat + 1 }) : vb("downbeatAuto")}
            </button>
            <button type="button" onClick={panel.onClear} disabled={panel.markers.length === 0} className={`${smallBtn} ${offBtn} hover:text-red-400`}>
              {vb("clear")}
            </button>
          </div>
        </div>
      </Searchable>

      <Searchable search={search} matches={matches} labelKey="vbOnBeat">
        <div className="space-y-1.5">
          <Toggle t={t} labelKey="vbOnBeat" tipKey="vbOnBeatTip" value={s.onBeat} onChange={(v) => update({ onBeat: v })} caseStyle="title" />
          {s.onBeat && <OnBeatReadout get={panel.getOnBeatStats} t={vb} />}
        </div>
      </Searchable>
      {(s.onBeat || !!search) && showAdvanced && (
        <Slider t={t} search={search} matches={matches} labelKey="vbOnBeatRange" tipKey="vbOnBeatRangeTip" value={s.onBeatRange} range={RANGES.onBeatRange} onChange={(v) => update({ onBeatRange: v })} display={`×${(1 + s.onBeatRange).toFixed(2)}`} left="🎯" right="🎢" />
      )}
    </div>
  );
}
