import type { PhysicsEngine } from "@/lib/physics/engine";
import type { FastRenderHost, OfflineCanvasDriver, OfflineFrameRenderer } from "@/lib/recording/fastRender";
import { EXPORT_EPOCH_MS, SIM_FPS, SIM_FRAME_MS, seededRandom, simFrameTimeMs } from "@/lib/recording/fastRenderPlan";

/*
 * --- mode-thumbnails --- Stills of a run at given seconds, drawn exactly as the fast export draws its frames: a fresh engine
 * set up like the page's for the seed, stepped in fixed 60 Hz frames by the fast export's hidden canvas (the page's own draw
 * routine in offline mode, mounted through the page's FastRenderHost), inside the export's sandbox – `Math.random` seeded
 * from the seed, `Date.now()` on the run's clock – so the confetti, shakes and glows replay identically too: the same
 * settings, seed and second give the same picture on every machine, however busy. No audio, no encoder: when the clock
 * reaches a requested second the canvas (the whole world at `scale` device px per world px) is handed to `onFrame`.
 *
 * The mode cards' pictures (scripts/generate-mode-previews.mjs) and the viral bot's covers are made with it, through
 * window.__jumpingBallsStill (components/simulator/useHeroStill.ts).
 */

/** The simulation frame that shows second `sec` of a run: the first one whose clock is at or past it. */
export function stillFrameIndex(sec: number): number {
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  return Math.max(0, Math.ceil(sec * SIM_FPS - 1e-6));
}

/** The seconds asked for, as whole simulation frames, ascending and once each (negative or non-finite ones dropped). */
export function stillSchedule(times: readonly number[]): { frame: number; sec: number }[] {
  const frames = new Map<number, number>();
  for (const t of times) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < 0) continue;
    const frame = stillFrameIndex(t);
    if (!frames.has(frame)) frames.set(frame, t);
  }
  return [...frames.entries()].sort((a, b) => a[0] - b[0]).map(([frame, sec]) => ({ frame, sec }));
}

/** The latest second a still may be asked for (a run longer than this is not stepped through for a picture). */
export const STILL_MAX_SEC = 180;

export interface StillRenderOptions {
  /** The page's fast-export host: its canvas wrapper mounts the hidden offline canvas for the job. */
  host: FastRenderHost;
  /** A fresh engine set up like the page's for `seed` (called inside the seeded sandbox). */
  createEngine: () => PhysicsEngine;
  seed: number;
  /** The engine's world (world px). */
  world: { width: number; height: number };
  /** Device px per world px the frames are drawn at. */
  scale: number;
  /** The seconds of the run to hand over (any order). */
  times: readonly number[];
  /** Called with the canvas while it shows second `sec` (and the frame's clock), in ascending order. */
  onFrame: (canvas: HTMLCanvasElement, sec: number, info: { clockMs: number; finished: boolean; engine: PhysicsEngine }) => void | Promise<void>;
  signal?: AbortSignal;
}

/** Lets the page breathe between frames without the clamping of timers. */
function yieldTask(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(0);
  });
}

/** Renders the run up to its last requested second, handing over the canvas at each; resolves with the frames drawn. */
export async function renderStills(options: StillRenderOptions): Promise<{ frames: number }> {
  const schedule = stillSchedule(options.times).filter((s) => s.sec <= STILL_MAX_SEC);
  if (schedule.length === 0) return { frames: 0 };
  const { host, signal } = options;
  if (host.getJob()) throw new Error("A fast export is running – try again when it is done.");
  const clock = { ms: 0 };
  const random = seededRandom(options.seed);
  const runNow = () => EXPORT_EPOCH_MS + clock.ms;
  const sandbox = <T>(fn: () => T): T => {
    const realRandom = Math.random;
    const realNow = Date.now;
    Math.random = random;
    Date.now = runNow;
    try {
      return fn();
    } finally {
      Math.random = realRandom;
      Date.now = realNow;
    }
  };
  const side = Math.max(1, Math.min(options.world.width, options.world.height));
  const slot: { renderer: OfflineFrameRenderer | null; attached: () => void } = { renderer: null, attached: () => {} };
  const whenAttached = new Promise<void>((resolve) => (slot.attached = resolve));
  const driver: OfflineCanvasDriver = {
    worldWidth: options.world.width,
    worldHeight: options.world.height,
    scale: options.scale,
    exportWidth: Math.round(side * options.scale),
    exportHeight: Math.round(side * options.scale),
    frameMs: SIM_FRAME_MS,
    now: () => clock.ms,
    attach: (r) => {
      slot.renderer = r;
      if (r) slot.attached();
    },
  };
  const engine = sandbox(() => options.createEngine());
  host.start({ id: Math.floor(performance.now()) + 1, engine, driver, onChirp: () => {} });
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([whenAttached, new Promise<void>((resolve) => (timer = setTimeout(resolve, 10000)))]);
    clearTimeout(timer);
    for (let waited = 0; slot.renderer && !slot.renderer.ready() && waited < 3000; waited += 20) await new Promise((r) => setTimeout(r, 20));
    const renderer = slot.renderer;
    if (!renderer) throw new Error("The offline canvas did not start");
    renderer.setSongProgress(null);
    let next = 0;
    let lastYield = performance.now();
    const lastFrame = schedule[schedule.length - 1].frame;
    for (let simFrame = 0; simFrame <= lastFrame; simFrame++) {
      if (signal?.aborted) throw new DOMException("Still cancelled", "AbortError");
      clock.ms = simFrameTimeMs(simFrame);
      sandbox(() => {
        renderer.renderFrame();
        for (const ev of engine.consumeSoundEvents()) if (ev.type === "gap") renderer.noteWallBreak();
      });
      while (next < schedule.length && schedule[next].frame === simFrame) {
        await options.onFrame(renderer.canvas, schedule[next].sec, { clockMs: clock.ms, finished: engine.isSimulationFinished(), engine });
        next++;
      }
      if (performance.now() - lastYield > 32) {
        await yieldTask();
        lastYield = performance.now();
      }
    }
    return { frames: lastFrame + 1 };
  } finally {
    host.stop();
  }
}
