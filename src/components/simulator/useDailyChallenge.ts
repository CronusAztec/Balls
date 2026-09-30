"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { SimulatorSettings } from "@/lib/settings";
import { DAILY_PARAM, dailySettings, dailyStreak, loadDailyHistory, recordDailyResult, saveDailyHistory, todaysChallenge, utcDateKey, type DailyChallenge } from "@/lib/daily";

/*
 * --- daily-gallery --- The simulator's side of the daily challenge (lib/daily.ts).
 *
 * A challenge is on the page while the engine still has its seed pinned in the challenge's mode: every physics change
 * unpins a seed (the page's "a change drops a found seed" effects), so tweaking the physics ends the challenge while a
 * new colour or glow keeps it. While it is on, the address bar carries `daily=<date>` on top of the mirrored settings, so
 * a reload opens the same challenge again. When its run finishes, the result panel shows the run length and – for
 * today's challenge – the first result of the day goes into the visitor's history for the streak.
 */

export interface DailyResult {
  challenge: DailyChallenge;
  /** Run length in ms (the engine's finish step). */
  ms: number;
  /** Days in a row played, for today's challenge; 0 for another day's. */
  streak: number;
}

export interface UseDailyChallengeOptions {
  /** The challenge a `daily=` link opened the page with (its settings are the page's first settings). */
  initial: DailyChallenge | null;
  settings: SimulatorSettings;
  engineReady: boolean;
  getEngine: () => PhysicsEngine | null;
  /** Puts a whole settings object on the page (the preset loader). */
  applySettings: (settings: SimulatorSettings) => void;
  /** Sets the page's run up on this seed, paused at its start (like a found simulation). */
  pinSeed: (seed: number) => void;
  isStarted: boolean;
  finished: boolean;
}

export interface DailyChallengeState {
  /** The challenge on the page, or null. */
  active: DailyChallenge | null;
  /** The finished daily run's result, while its end screen is up. */
  result: DailyResult | null;
  /** Loads today's challenge: its settings, then its seed. */
  playToday: () => Promise<void>;
  busy: boolean;
}

/** The challenge is still on the page: its mode, and its seed pinned in the engine. */
function stillOn(challenge: DailyChallenge | null, settings: SimulatorSettings, engine: PhysicsEngine | null): boolean {
  return !!challenge && !!engine && settings.mode === challenge.mode && engine.getPinnedSeed() === challenge.seed;
}

export function useDailyChallenge(o: UseDailyChallengeOptions): DailyChallengeState {
  const latest = useRef(o);
  latest.current = o;
  const [loaded, setLoaded] = useState<DailyChallenge | null>(o.initial);
  const [active, setActive] = useState<DailyChallenge | null>(null);
  const [result, setResult] = useState<DailyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [pinTick, setPinTick] = useState(0);

  // Waiting for the page to commit new settings (their effects drop any pinned seed) before the challenge's seed is pinned.
  const [, setTick] = useState(0);
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (waiters.current.length === 0) return;
    for (const resolve of waiters.current.splice(0)) resolve();
  });
  const nextCommit = useCallback(
    () =>
      new Promise<void>((resolve) => {
        waiters.current.push(resolve);
        setTick((n) => n + 1);
      }),
    [],
  );

  // A `daily=` link: its settings are the page's first settings; its seed is pinned once the engine is up (this effect
  // comes after the page's own seed effects, so nothing drops it again).
  const initialPinned = useRef(false);
  useEffect(() => {
    if (!o.engineReady || initialPinned.current) return;
    initialPinned.current = true;
    if (o.initial) {
      latest.current.pinSeed(o.initial.seed);
      setPinTick((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [o.engineReady]);

  const playToday = useCallback(async () => {
    const challenge = todaysChallenge();
    setBusy(true);
    try {
      latest.current.applySettings(dailySettings(challenge));
      await nextCommit();
      latest.current.pinSeed(challenge.seed);
      setLoaded(challenge);
      setPinTick((n) => n + 1);
      document.getElementById("simulator")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      setBusy(false);
    }
  }, [nextCommit]);

  // Whether the challenge is still on – checked after the page's settings effects of the same commit (they unpin a seed on a
  // physics change) – and the address bar: the page mirrors the settings, this adds `daily=` while the challenge is on.
  const { settings, isStarted, finished } = o;
  useEffect(() => {
    const on = stillOn(loaded, settings, latest.current.getEngine());
    setActive((prev) => (on ? loaded : prev === null ? prev : null));
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (on && loaded && url.searchParams.get(DAILY_PARAM) !== loaded.date) {
      url.searchParams.set(DAILY_PARAM, loaded.date);
      window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    } else if (!on && url.searchParams.has(DAILY_PARAM)) {
      url.searchParams.delete(DAILY_PARAM);
      window.history.replaceState(null, "", `${url.pathname}?${url.searchParams.toString()}`);
    }
  }, [loaded, settings, pinTick, isStarted, finished]);

  // The finished daily run: its result (the engine's finish step) and, for today's challenge, the day's first result in the history.
  useEffect(() => {
    if (!finished || !active) {
      setResult(null);
      return;
    }
    const engine = latest.current.getEngine();
    if (!engine) return;
    const at = engine.getFinishedAtMs();
    const ms = at >= 0 ? at : engine.getElapsedMs();
    const today = utcDateKey(new Date());
    let streak = 0;
    if (active.date === today) {
      const history = recordDailyResult(loadDailyHistory(), today, ms, today);
      saveDailyHistory(history);
      streak = dailyStreak(history, today);
    }
    setResult({ challenge: active, ms, streak });
  }, [finished, active]);

  return { active, result, playToday, busy };
}
