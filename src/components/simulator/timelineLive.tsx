"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import type { Translate } from "./ControlPrimitives";
import { compileTimeline, formatTimelineValue, interpolateTrack, timelineKeyForLabel, type Keyframe, type TimelineKey, type TimelineTrack } from "@/lib/simulation/timeline";

/*
 * The live side of the timeline keyframes in the panel: what the automated settings are right now. The engine applies
 * the keyframes itself (lib/simulation/timeline.ts); this store follows the same keyframes on the engine's simulation
 * clock, ten times a second, so the panel's sliders can show the live value of an automated setting with an AUTO badge
 * and the Timeline section can offer "add a keyframe at the current time". Only the components that show a live value
 * re-render, and only when it changes.
 */

type Listener = () => void;

/** How often (ms) the live values are refreshed for the panel. */
export const TIMELINE_PUBLISH_MS = 100;

export class TimelineLiveStore {
  private timeSec = 0;
  private tracks: readonly TimelineTrack[] = [];
  private readonly values = new Map<TimelineKey, number>();
  private readonly listeners = new Set<Listener>();
  private clock: (() => number) | null = null;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Simulation second of the last refresh. */
  getTime = () => this.timeSec;

  /** The live value of an automated setting, or null while the setting follows its own slider. */
  getValue = (key: TimelineKey): number | null => this.values.get(key) ?? null;

  /** The simulation clock right now (the engine's, once the simulator registered it) – "add a keyframe at the current time". */
  now(): number {
    return this.clock ? this.clock() : this.timeSec;
  }

  setClock(clock: (() => number) | null) {
    this.clock = clock;
  }

  /** Evaluates `tracks` at simulation second `t`; the listeners hear of it only when the time or a value changed. Allocates nothing for the same tracks. */
  publish(tracks: readonly TimelineTrack[], t: number) {
    let changed = t !== this.timeSec;
    this.timeSec = t;
    if (tracks !== this.tracks) {
      this.tracks = tracks;
      this.values.clear();
      changed = true;
    }
    for (const track of tracks) {
      const value = interpolateTrack(track.times, track.values, t);
      if (this.values.get(track.key) !== value) {
        this.values.set(track.key, value);
        changed = true;
      }
    }
    if (changed) for (const listener of this.listeners) listener();
  }
}

/** The page's one store (one simulator per page); the simulator publishes to it, the panel reads it. */
export const timelineLive = new TimelineLiveStore();

const noSubscribe = () => () => {};
const noValue = () => null;

/**
 * The simulator's side: follows `keyframes` (the ones the engine plays) on `readTime` – the engine's simulation clock – and
 * publishes the live values every `TIMELINE_PUBLISH_MS`, and at once when the keyframes change. Cleared on unmount.
 */
export function useTimelineLivePublisher(keyframes: readonly Keyframe[], readTime: () => number) {
  useEffect(() => {
    const tracks = compileTimeline(keyframes);
    timelineLive.setClock(readTime);
    timelineLive.publish(tracks, readTime());
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (now - last >= TIMELINE_PUBLISH_MS) {
        last = now;
        timelineLive.publish(tracks, readTime());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [keyframes, readTime]);
  useEffect(
    () => () => {
      timelineLive.setClock(null);
      timelineLive.publish([], 0);
    },
    [],
  );
}

/** The live value of `key` while the keyframes drive it, null otherwise (re-renders the caller only when that changes). */
export function useTimelineValue(key: TimelineKey | null): number | null {
  return useSyncExternalStore(key ? timelineLive.subscribe : noSubscribe, key ? () => timelineLive.getValue(key) : noValue, noValue);
}

/** A panel slider's automation, by the slider's label key: the setting and its live value, or null for a slider the keyframes do not drive. */
export function useTimelineSlider(labelKey: string): { key: TimelineKey; value: number } | null {
  const key = timelineKeyForLabel(labelKey);
  const value = useTimelineValue(key);
  return key && value !== null ? { key, value } : null;
}

/** The simulation clock as the panel shows it (refreshed ten times a second). */
export function useTimelineTime(): number {
  return useSyncExternalStore(timelineLive.subscribe, timelineLive.getTime, () => 0);
}

/** The small AUTO badge next to an automated setting's value. */
export function TimelineAutoBadge({ t }: { t: Translate }) {
  return (
    <span data-testid="timeline-auto-badge" title={t("timelineAutoTip")} className="ml-1.5 inline-block align-middle px-1 py-px rounded bg-accent/15 border border-accent/40 text-accent text-xs leading-none font-black uppercase tracking-wider">
      {t("timelineAuto")}
    </span>
  );
}

/** A slider's value readout: the live value with the AUTO badge while automated (`live`), else the slider's own text. */
export function TimelineSliderValue({ t, live, fallback }: { t: Translate; live: { key: TimelineKey; value: number } | null; fallback: ReactNode }) {
  if (!live) return <>{fallback}</>;
  return (
    <span data-timeline-live={live.key}>
      <span className="text-accent tabular-nums">{formatTimelineValue(live.key, live.value)}</span>
      <TimelineAutoBadge t={t} />
    </span>
  );
}
