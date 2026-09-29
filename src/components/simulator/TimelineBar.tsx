"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { useTranslations } from "next-intl";
import { timelineLive } from "./timelineLive";
import type { PhysicsConfig } from "@/lib/physics/types";
import { RANGES } from "@/lib/settings";
import { TIMELINE_KEY_COLORS, TIMELINE_RATE_KEYS, compileTimeline, formatTimelineTime, formatTimelineValue, timelineKeyLabel, timelinePosition, timelineSpan, type Keyframe, type TimelineKey, type TimelineTrack } from "@/lib/simulation/timeline";

/** What the bar reads from the engine: the simulation clock, the config the keyframes are applied to and the rates' phases. */
export interface TimelineEngineView {
  getElapsedMs(): number;
  readonly config: PhysicsConfig;
  /** A keyframed rate setting integrated since 0 s (degrees gravity turned, breathing pulses), NaN otherwise. */
  getTimelinePhase?(key: TimelineKey): number;
  /** The balls in play (their sizes: a keyframed Ball Size scales each ball's own size). */
  getBalls?(): readonly { radius: number }[];
}

export interface TimelineBarProps {
  keyframes: readonly Keyframe[];
  /** The clip length (the recording duration) the bar spans, in seconds – longer when a keyframe lies beyond it. */
  clipSec: number;
  getEngine: () => TimelineEngineView | null;
}

/** How often (ms) the bar mirrors the clock and the values into its data attributes. */
const MIRROR_MS = 100;
/** Width of the SVG coordinate space of a lane (it is stretched to the bar's width). */
const VIEW_W = 1000;

/** A lane's curve: the value of the track over the bar, normalised into the lane's height (hold before the first and after the last keyframe). */
function lanePoints(track: TimelineTrack, span: number, height: number, pad: number): { points: string; ys: number[] } {
  const range = RANGES[track.key];
  const y = (v: number) => pad + (1 - (v - range.min) / (range.max - range.min || 1)) * (height - 2 * pad);
  const ys = track.values.map(y);
  const pts = [`0,${ys[0]}`];
  track.times.forEach((time, i) => pts.push(`${VIEW_W * timelinePosition(time, span)},${ys[i]}`));
  pts.push(`${VIEW_W},${ys[ys.length - 1]}`);
  return { points: pts.join(" "), ys };
}

/**
 * The thin timeline bar under the canvas (shown while there are keyframes): one slim lane per automated setting with a
 * small curve of its value (ramps between keyframes, holds outside them) and a marker per keyframe in the setting's colour
 * (hover for the setting, value and time), the playhead at the simulation clock – moved every frame straight in the DOM,
 * so the page does not re-render – and a legend. It mirrors the clock, the live values and the values the engine really
 * uses into `data-timeline-time`, `data-timeline-live` and `data-timeline-engine` (e.g. `gravity=842.5`) – and, for a
 * keyframed rate, the phase the engine integrated from it into `data-timeline-phase` (`rotatingGravity=1350` degrees
 * turned, `breathingSpeed=12.5` pulses), and the largest ball's radius into `data-timeline-ball-radius` (a keyframed
 * Ball Size scales the balls' own sizes – a grown, merged or split ball keeps its size relative to it) – for tools and the
 * smoke test. It is not part of the recording (it is not on the canvas).
 */
function TimelineBar({ keyframes, clipSec, getEngine }: TimelineBarProps) {
  const t = useTranslations();
  const barRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<HTMLDivElement | null>(null);
  const span = timelineSpan(keyframes, clipSec);
  const tracks = useMemo(() => compileTimeline(keyframes), [keyframes]);
  const rateTracks = useMemo(() => tracks.filter((track) => TIMELINE_RATE_KEYS.includes(track.key)), [tracks]);
  const laneHeight = tracks.length > 3 ? 10 : 14;
  const pad = laneHeight > 10 ? 4 : 3;

  useEffect(() => {
    let raf = 0;
    let lastT = NaN;
    let lastMirror = -Infinity;
    const tick = (now: number) => {
      const engine = getEngine();
      const timeSec = engine ? engine.getElapsedMs() / 1000 : 0;
      if (timeSec !== lastT) {
        lastT = timeSec;
        if (headRef.current) headRef.current.style.left = `${100 * timelinePosition(timeSec, span)}%`;
      }
      const bar = barRef.current;
      if (bar && engine && now - lastMirror >= MIRROR_MS) {
        lastMirror = now;
        bar.dataset.timelineTime = timeSec.toFixed(2);
        bar.dataset.timelineLive = tracks.map((track) => `${track.key}=${round3(timelineLive.getValue(track.key))}`).join(",");
        bar.dataset.timelineEngine = tracks.map((track) => `${track.key}=${round3(engine.config[track.key])}`).join(",");
        const phaseOf = engine.getTimelinePhase;
        if (rateTracks.length > 0 && phaseOf) bar.dataset.timelinePhase = rateTracks.map((track) => `${track.key}=${round3(phaseOf.call(engine, track.key))}`).join(",");
        else if (bar.dataset.timelinePhase !== undefined) delete bar.dataset.timelinePhase;
        const balls = engine.getBalls?.() ?? [];
        let largest = 0;
        for (let i = 0; i < balls.length; i++) if (balls[i].radius > largest) largest = balls[i].radius;
        bar.dataset.timelineBallRadius = round3(largest);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tracks, rateTracks, span, getEngine]);

  const settingName = (track: TimelineTrack) => t(`Controls.${timelineKeyLabel(track.key)}`);
  return (
    <div ref={barRef} className="mt-2 select-none" data-testid="timeline-bar" data-timeline-span={span} role="group" aria-label={t("Simulator.timelineBar")}>
      <div className="relative mx-1.5 space-y-0.5">
        {tracks.map((track) => {
          const color = TIMELINE_KEY_COLORS[track.key];
          const { points, ys } = lanePoints(track, span, laneHeight, pad);
          return (
            <div key={track.key} className="relative rounded-sm bg-zinc-800/50" style={{ height: laneHeight }} data-testid="timeline-lane" data-key={track.key}>
              <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox={`0 0 ${VIEW_W} ${laneHeight}`} preserveAspectRatio="none" aria-hidden="true">
                <polyline points={points} fill="none" stroke={color} strokeOpacity={0.6} strokeWidth={1.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              </svg>
              {track.times.map((time, i) => (
                <span
                  key={time}
                  data-testid="timeline-marker"
                  data-key={track.key}
                  title={t("Simulator.timelineMarker", { setting: settingName(track), value: formatTimelineValue(track.key, track.values[i]), time: formatTimelineTime(time) })}
                  className="absolute w-2 h-2 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] ring-1 ring-black/70 cursor-help"
                  style={{ left: `${100 * timelinePosition(time, span)}%`, top: ys[i], background: color }}
                />
              ))}
            </div>
          );
        })}
        <div ref={headRef} data-testid="timeline-playhead" className="absolute -top-0.5 -bottom-0.5 w-0.5 -translate-x-1/2 rounded-full bg-white shadow-[0_0_6px_rgba(147,209,25,0.9)] pointer-events-none" style={{ left: "0%" }} />
      </div>
      <div className="mx-1.5 mt-1 flex items-start justify-between gap-2 text-[10px] leading-tight text-zinc-500 tabular-nums">
        <span>0s</span>
        <span className="flex flex-wrap justify-center gap-x-2.5 gap-y-0.5">
          {tracks.map((track) => (
            <span key={track.key} className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rotate-45 rounded-[1px]" style={{ background: TIMELINE_KEY_COLORS[track.key] }} aria-hidden="true" />
              {settingName(track)}
            </span>
          ))}
        </span>
        <span>{formatTimelineTime(span)}s</span>
      </div>
    </div>
  );
}

/** Memoised: the page re-renders twice a second for its FPS readout, the bar only when its keyframes or the clip length change. */
export default memo(TimelineBar);

function round3(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : "";
}
