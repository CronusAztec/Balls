"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SimulatorSettings } from "@/lib/settings";
import { downloadExport } from "@/lib/recording/fastRender";
import { SITE_SLUG } from "@/lib/site";
import { zipBlobs } from "@/lib/recording/zip";
import type { BotCopy, BotLocale } from "@/lib/bot/copy";
import type { BotWorld } from "@/lib/bot/finderRequest";
import { batchTextFiles, type RenderedClip } from "@/lib/bot/output";
import { isBotFamily, isBotPlatform, isEndingChoice, isLengthBucket, type BotPlatform } from "@/lib/bot/playbook";
import { localIsoDate, parseIsoDate, planDaySteps, rerollClipSteps, type ClipPlan, type PlanOptions } from "@/lib/bot/planner";
import { BOT_COUNT_RANGE, defaultBotOptions, loadBotState, saveBotState, type BotOptions, type BotState, type BotStoredPlan } from "@/lib/bot/store";
import type { BatchRunState, CustomBatchFile, CustomBatchJob } from "./useBatchRender";
import { CLIP_CEILING } from "@/lib/uncap"; // --- uncap-all ---
import { scrollBehavior } from "@/lib/reducedMotion"; // --- review fix (ui-i18n) --- no smooth scrolling under reduced motion
// --- paywall-gate --- the CLI reads the licence's state through the page's handle (--- free-watermark --- the bot renders for
// everyone; without a Pro licence its clips carry the watermark, which the fast export's own seal decides)
import { getEntitlementStore, type EntitlementStatus } from "@/lib/billing/entitlement";

/*
 * --- viral-bot --- The page's side of the viral video bot (the Bot block of the Recording section, sections/BotSection.tsx):
 * plans clips with the planner (lib/bot/planner.ts) in slices so the page stays responsive, keeps the last plan in
 * localStorage, opens a planned clip in the simulator (its settings, its melody, its seed), re-rolls one, and renders the
 * whole plan through the batch renderer (useBatchRender's `runJobs`) into a ZIP with the videos, a caption file per clip,
 * manifest.json and posting-schedule.md. It also exposes itself as `window.__jumpingBallsBot` for the headless CLI
 * (scripts/viral-bot.mjs), which plans and renders through it.
 */

export type BotPlanning = { current: number; total: number; seeds: number } | null;
export type BotRenderState = { status: "idle" | "running" | "done" | "failed"; total: number; done: number; zip: boolean };

export interface BotPanelProps {
  options: BotOptions;
  setOptions: (patch: Partial<BotOptions>) => void;
  plan: BotStoredPlan | null;
  planning: BotPlanning;
  /** Id of the clip being re-rolled. */
  rerolling: string | null;
  render: BotRenderState;
  /** Clip being rendered (1-based), progress of its export (0–1). */
  renderCurrent: number;
  renderProgress: number | null;
  /** The window was resized since the plan was made: its seeds were timed for the old canvas. */
  worldChanged: boolean;
  supported: boolean | null;
  disabled: boolean;
  /** --- split-screen --- The page is a split-screen race: rendering is off (the fast export draws one arena). */
  splitRace: boolean;
  onPlan: () => void;
  onToday: () => void;
  onCancel: () => void;
  onOpen: (id: string) => void;
  onReroll: (id: string) => void;
  onRenderAll: () => void;
  onStop: () => void;
  onClear: () => void;
}

export interface UseViralBotOptions {
  locale: BotLocale;
  /** The `ViralBot` namespace of the page's messages. */
  copy: BotCopy;
  /** The page engine's world (its canvas in CSS px), null before there is one. */
  getWorld: () => BotWorld | null;
  /** Puts a whole settings object on the page (the preset loader). */
  applySettings: (settings: SimulatorSettings) => void;
  /** Loads a built-in melody (a songs.ts id) or clears it (null). */
  selectMelody: (id: string | null) => Promise<void> | void;
  /** The melody loaded now (restored after a render). */
  currentMelody: string | null;
  /** Sets the page's run up on this seed, paused at its start (like a found simulation). */
  pinSeed: (seed: number) => void;
  runJobs: (jobs: CustomBatchJob[]) => Promise<CustomBatchFile[]>;
  stopBatch: () => void;
  batchRun: BatchRunState;
  jobProgress: number | null;
  supported: boolean | null;
  disabled: boolean;
  /** --- split-screen --- The page is a split-screen race (2 or 4 arenas). */
  splitRace?: boolean;
}

/** Real time the planner runs before it lets the page breathe (ms). */
const SLICE_MS = 24;
/** How often the planning progress is shown (ms). */
const PROGRESS_MS = 150;
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

class PlanCancelled extends Error {}

/** Runs a planning generator in slices; `onStep` sees every yield. Rejects with PlanCancelled once `signal` aborts. */
async function runSliced<Y, T>(steps: Generator<Y, T>, onStep: (step: Y) => void, signal: AbortSignal): Promise<T> {
  for (;;) {
    const t0 = performance.now();
    do {
      if (signal.aborted) throw new PlanCancelled();
      const next = steps.next();
      if (next.done) return next.value;
      onStep(next.value);
    } while (performance.now() - t0 < SLICE_MS);
    await pause();
  }
}

/** What the CLI asks the page for. */
interface BotCliPlanRequest {
  date?: string;
  platform?: string;
  count?: number;
  family?: string;
  bucket?: string;
  ending?: string;
  maxSeeds?: number;
}

declare global {
  interface Window {
    __jumpingBallsBot?: {
      version: number;
      plan: (request?: BotCliPlanRequest) => Promise<ClipPlan[]>;
      render: (request?: { download?: "each" | "zip" }) => Promise<RenderedClip[]>;
      textFiles: () => { name: string; text: string }[];
      world: () => BotWorld | null;
      /** --- paywall-gate --- The page's licence: the CLI waits for "free" or "pro" before it renders (--- free-watermark --- Free: watermarked clips). */
      licence?: () => { status: EntitlementStatus; plan: string | null; expiresAt: number | null; testMode: boolean };
    };
  }
}

export function useViralBot(o: UseViralBotOptions): BotPanelProps {
  const latest = useRef(o);
  latest.current = o;

  /* ---------------------------------------------------------- state (kept in localStorage) */
  const [state, setState] = useState<BotState>(() => ({ options: defaultBotOptions(), plan: null }));
  useEffect(() => setState(loadBotState()), []);
  const stateRef = useRef(state);
  stateRef.current = state;
  const commit = useCallback((next: BotState) => {
    stateRef.current = next;
    setState(next);
    saveBotState(next);
  }, []);
  const setOptions = useCallback((patch: Partial<BotOptions>) => commit({ ...stateRef.current, options: { ...stateRef.current.options, ...patch } }), [commit]);

  /* ---------------------------------------------------------- waiting for the page to commit new settings */
  const [, setTick] = useState(0);
  const waiters = useRef<(() => void)[]>([]);
  useEffect(() => {
    if (waiters.current.length === 0) return;
    for (const resolve of waiters.current.splice(0)) resolve();
  });
  const nextCommit = useCallback(() => new Promise<void>((resolve) => {
    waiters.current.push(resolve);
    setTick((n) => n + 1);
  }), []);

  /* ---------------------------------------------------------- planning */
  const [planning, setPlanning] = useState<BotPlanning>(null);
  const [rerolling, setRerolling] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const baseOptions = useCallback((): Omit<PlanOptions, "episode" | "index" | "date"> => {
    const l = latest.current;
    return { copy: l.copy, locale: l.locale, world: l.getWorld() ?? undefined };
  }, []);

  const planWith = useCallback(
    async (kind: "today" | "custom", request?: BotCliPlanRequest, salt = ""): Promise<ClipPlan[]> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const opts = stateRef.current.options;
      const platform: BotPlatform = request?.platform && isBotPlatform(request.platform) ? request.platform : opts.platform;
      const wanted = Math.round(request?.count ?? opts.count);
      const count = !(wanted >= BOT_COUNT_RANGE.min) ? BOT_COUNT_RANGE.min : wanted > CLIP_CEILING ? CLIP_CEILING : wanted; // --- uncap-all --- (the clips' memory-safety ceiling, not the slider's 20)
      const date = request?.date && parseIsoDate(request.date) ? request.date : localIsoDate(new Date());
      const custom = kind === "custom";
      const family = request?.family !== undefined ? (isBotFamily(request.family) ? request.family : "all") : custom ? opts.family : "all";
      const bucket = request?.bucket !== undefined ? (isLengthBucket(request.bucket) ? request.bucket : "auto") : custom ? opts.bucket : "auto";
      const ending = request?.ending !== undefined ? (isEndingChoice(request.ending) ? request.ending : "auto") : custom ? opts.ending : "auto";
      setPlanning({ current: 1, total: count, seeds: 0 });
      // The progress re-renders the page: at most a few times a second, and whenever the next clip starts.
      let shownAt = 0;
      let shownClip = 1;
      try {
        const day = await runSliced(
          planDaySteps(date, platform, count, { ...baseOptions(), family, bucket, ending, maxSeeds: request?.maxSeeds, salt }),
          (p) => {
            const now = performance.now();
            if (p.clip === shownClip && now - shownAt < PROGRESS_MS) return;
            shownAt = now;
            shownClip = p.clip;
            setPlanning({ current: p.clip, total: p.clips, seeds: p.seedsTested });
          },
          controller.signal,
        );
        commit({ ...stateRef.current, plan: { date: day.date, platform, kind, clips: day.clips } });
        return day.clips;
      } catch (err) {
        if (!(err instanceof PlanCancelled)) throw err;
        return [];
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setPlanning(null);
        }
      }
    },
    [baseOptions, commit],
  );

  // "Plan clips" plans a fresh set with the panel's filters each time; "Today's plan" (and the CLI) the day's own, the same every time.
  const onPlan = useCallback(() => void planWith("custom", undefined, Date.now().toString(36)), [planWith]);
  const onToday = useCallback(() => void planWith("today"), [planWith]);
  const onCancel = useCallback(() => abortRef.current?.abort(), []);

  const onReroll = useCallback(
    async (id: string) => {
      const plan = stateRef.current.plan;
      const clip = plan?.clips.find((c) => c.id === id);
      if (!plan || !clip || abortRef.current) return;
      const controller = new AbortController();
      abortRef.current = controller;
      setRerolling(id);
      try {
        const next = await runSliced(rerollClipSteps(clip, baseOptions()), () => {}, controller.signal);
        const current = stateRef.current.plan;
        if (current) commit({ ...stateRef.current, plan: { ...current, clips: current.clips.map((c) => (c.id === id ? next : c)) } });
      } catch (err) {
        if (!(err instanceof PlanCancelled)) throw err;
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        setRerolling(null);
      }
    },
    [baseOptions, commit],
  );

  const onClear = useCallback(() => {
    abortRef.current?.abort();
    commit({ ...stateRef.current, plan: null });
  }, [commit]);

  /* ---------------------------------------------------------- open in the simulator */
  const onOpen = useCallback(
    async (id: string) => {
      const clip = stateRef.current.plan?.clips.find((c) => c.id === id);
      if (!clip) return;
      const l = latest.current;
      l.applySettings(clip.settings);
      await nextCommit();
      await l.selectMelody(clip.melodyId);
      await nextCommit();
      latest.current.pinSeed(clip.seed);
      document.getElementById("simulator")?.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    },
    [nextCommit],
  );

  /* ---------------------------------------------------------- render all */
  const [render, setRender] = useState<BotRenderState>({ status: "idle", total: 0, done: 0, zip: true });
  const lastRendered = useRef<RenderedClip[]>([]);
  const renderAll = useCallback(async (download: "each" | "zip"): Promise<RenderedClip[]> => {
    const plan = stateRef.current.plan;
    const l = latest.current;
    if (!plan || plan.clips.length === 0 || l.disabled || abortRef.current) return [];
    // --- free-watermark --- (was paywall-gate: the bot's record step is no longer refused – watermarked without Pro)
    const clips = plan.clips;
    const melodyBefore = l.currentMelody;
    setRender({ status: "running", total: clips.length, done: 0, zip: download === "zip" });
    let files: CustomBatchFile[] = [];
    try {
      files = await l.runJobs(clips.map((c) => ({ seed: c.seed, settings: c.settings, name: c.id, download: download === "each", prepare: async () => void (await latest.current.selectMelody(c.melodyId)) })));
    } finally {
      await latest.current.selectMelody(melodyBefore);
    }
    const results: RenderedClip[] = clips.map((c, i) => {
      const f = files.find((x) => x.index === i + 1);
      return f ? { id: c.id, status: "done", file: f.name, durationSec: f.durationSec, bytes: f.blob.size } : { id: c.id, status: "failed", file: null, durationSec: null, bytes: null };
    });
    lastRendered.current = results;
    if (download === "zip" && files.length > 0) {
      const texts = batchTextFiles(clips, latest.current.copy, { date: plan.date, platform: plan.platform, locale: latest.current.locale }, results);
      const zip = await zipBlobs([...files.map((f) => ({ name: f.name, blob: f.blob })), ...texts.map((t) => ({ name: t.name, blob: new Blob([t.text], { type: "text/plain;charset=utf-8" }) }))]);
      downloadExport(zip, "zip", `${SITE_SLUG}-bot-${plan.date}`);
    }
    setRender({ status: files.length > 0 ? "done" : "failed", total: clips.length, done: files.length, zip: download === "zip" });
    return results;
  }, []);
  const onRenderAll = useCallback(() => void renderAll("zip"), [renderAll]);
  const onStop = useCallback(() => latest.current.stopBatch(), []);

  /* ---------------------------------------------------------- the CLI's handle */
  useEffect(() => {
    window.__jumpingBallsBot = {
      version: 1,
      plan: (request) => planWith("today", { family: "all", bucket: "auto", ending: "auto", ...request }),
      render: (request) => renderAll(request?.download ?? "each"),
      textFiles: () => {
        const plan = stateRef.current.plan;
        if (!plan) return [];
        return batchTextFiles(plan.clips, latest.current.copy, { date: plan.date, platform: plan.platform, locale: latest.current.locale }, lastRendered.current);
      },
      world: () => latest.current.getWorld(),
      // --- paywall-gate ---
      licence: () => {
        const store = getEntitlementStore();
        store.start();
        const e = store.getSnapshot();
        return { status: e.status, plan: e.plan, expiresAt: e.expiresAt, testMode: e.testMode };
      },
    };
    return () => {
      delete window.__jumpingBallsBot;
    };
  }, [planWith, renderAll]);

  const world = o.getWorld();
  const planWorld = state.plan?.clips[0]?.world;
  const worldChanged = !!world && !!planWorld && (Math.round(world.width) !== Math.round(planWorld.width) || Math.round(world.height) !== Math.round(planWorld.height));
  const renderCurrent = render.status === "running" ? Math.max(1, Math.min(render.total, o.batchRun.jobs.findIndex((j) => j.status === "preparing" || j.status === "rendering") + 1 || o.batchRun.jobs.filter((j) => j.status === "done").length)) : 0;

  return {
    options: state.options,
    setOptions,
    plan: state.plan,
    planning,
    rerolling,
    render,
    renderCurrent,
    renderProgress: render.status === "running" ? o.jobProgress : null,
    worldChanged,
    supported: o.supported,
    disabled: o.disabled,
    splitRace: !!o.splitRace, // --- split-screen ---
    onPlan,
    onToday,
    onCancel,
    onOpen: (id) => void onOpen(id),
    onReroll: (id) => void onReroll(id),
    onRenderAll,
    onStop,
    onClear,
  };
}
