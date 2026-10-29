import type { SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, stepPlaybackMs } from "@/lib/simulation/finder";
import { DEFAULT_BOT_WORLD, finderRequestOfSettings, type BotWorld } from "./finderRequest";
import { BANNER_MS as GLASS_BANNER_MS } from "@/lib/physics/modes/glass"; // --- templates --- (AI studio step 3) the modes' banners
import { JOURNEY_BANNER_MS } from "@/lib/physics/modes/journey";

/*
 * --- templates --- Where a run moves (the studio's first review round, finding 26): the action track of a seed – the cells of
 * the exported square a moving ball touches, sampled every ACTION_STEP_SEC of the run – so the Simple look puts each of its
 * texts at the edge of the square the run leaves clear (planner.ts placeSimpleTexts: Ball Drop's balls enter under a top hook,
 * Pendulum Wave's short pendulums swing under it, and the bottom of the square is empty there), and the crew's Simple score
 * charges a text that hides the action where the other edge would not (crew/simplicity.ts textOverAction).
 *
 * The square is the centred square of the world the recorder exports (min(width, height) – the page's canvas is the world),
 * cut into ACTION_GRID × ACTION_GRID cells, row by row from its top left. A ball moves when it went ACTION_MOVE_SHARE of the
 * square's side or more since the sample before (a ball new since then counts): a settled pile is no action. The camera's own
 * moves (the cinematic camera's zoom) are not followed: the track is the world's.
 *
 * A sample is kept as a string, two base-36 characters a cell in ascending order ("" for none), so a run's record stays small.
 * Pure and deterministic: the seed replayed in the finder's engine, as payoffMomentSync (lib/insights/score.ts) replays it.
 *
 * --- templates --- (AI studio step 3) A mode that scrolls its own camera down a shaft (Glass Smash, the Journey) is followed on
 * screen, as the canvas draws it (world y − cameraY), and the banners of its own text it draws over the square ("STAGE 2", "Stage
 * 2/5: Pegs") are kept per sample beside the balls (ActionTrack.banners): the Simple look keeps its texts clear of them (planner.ts
 * placeSimpleTexts) and the crew's G5 fails a text drawn over one (crew/clarity.ts) – two texts stacked, the studio's first gap.
 */

// --- templates ---

/** Seconds between two samples: sample k is the run at (k + 1) × this. */
export const ACTION_STEP_SEC = 0.5;
/** The square is cut into this many rows and as many columns. */
export const ACTION_GRID = 20;
/** The least way a ball goes between two samples to count as moving, as a share of the square's side. */
export const ACTION_MOVE_SHARE = 0.005;

export interface ActionTrack {
  stepSec: number;
  grid: number;
  /** Per sample (the k-th at (k + 1) × stepSec s of the run): the cells a moving ball touches (actionCellsOf reads them). */
  samples: string[];
  /**
   * --- templates --- (AI studio step 3) Per sample: the cells a banner of the mode's own text covers there ("" for none: modeBannerBox);
   * absent for a mode that draws no banner, so every other mode's track is as it was.
   */
  banners?: string[];
}

/** A rectangle in the exported square, as shares of its side from its top left (0–1). */
export interface SquareBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const DIGITS = 36;

function encodeCells(cells: readonly number[]): string {
  return cells.map((c) => c.toString(DIGITS).padStart(2, "0")).join("");
}

/** The cells of a sample (row × grid + column), ascending; none for a malformed one. */
export function actionCellsOf(sample: string): number[] {
  if (typeof sample !== "string" || sample.length % 2 !== 0 || !/^[0-9a-z]*$/.test(sample)) return [];
  const out: number[] = [];
  for (let i = 0; i < sample.length; i += 2) out.push(parseInt(sample.slice(i, i + 2), DIGITS));
  return out;
}

/** Whether a value is an action track (a run's record may come from a file). */
export function isActionTrack(value: unknown): value is ActionTrack {
  const t = value as ActionTrack | null;
  return (
    !!t &&
    typeof t === "object" &&
    typeof t.stepSec === "number" &&
    t.stepSec > 0 &&
    Number.isInteger(t.grid) &&
    t.grid > 0 &&
    Array.isArray(t.samples) &&
    t.samples.every((s) => typeof s === "string") &&
    (t.banners === undefined || (Array.isArray(t.banners) && t.banners.every((s) => typeof s === "string"))) // --- templates --- (AI studio step 3)
  );
}

/** The run second of sample `k`. */
export function actionSampleSec(track: Pick<ActionTrack, "stepSec">, k: number): number {
  return (k + 1) * track.stepSec;
}

/**
 * Whether a moving ball is under `box` at sample `k`: a cell of the sample whose centre lies inside the box (so a cell the
 * box only grazes does not count).
 */
export function actionUnder(track: ActionTrack, k: number, box: SquareBox): boolean {
  const g = track.grid;
  for (const cell of actionCellsOf(track.samples[k] ?? "")) {
    const cx = ((cell % g) + 0.5) / g;
    const cy = (Math.floor(cell / g) + 0.5) / g;
    if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) return true;
  }
  return false;
}

// --- templates --- (AI studio step 3) the modes' own banners and cameras
/** The modes that draw a banner of their own text over the square (modeBannerBox): Glass Smash's stages, the Journey's. */
export const BANNER_MODES: readonly SimulatorSettings["mode"][] = ["glass", "journey"];

/**
 * --- templates --- (AI studio step 4b) Whether these settings draw the mode's own banners: a banner mode's, but the Journey's only
 * with its overlay on (`journeyHud`: the Simple look switches it off), so a track keeps no banner its clip never shows.
 */
export function modeBannersDrawn(settings: Pick<SimulatorSettings, "mode" | "journeyHud">): boolean {
  return BANNER_MODES.includes(settings.mode) && (settings.mode !== "journey" || settings.journeyHud !== false);
}

/** How long a banner shows (ms): modes/glass.ts BANNER_MS, modes/journey.ts JOURNEY_BANNER_MS. */
const BANNER_SHOWS_MS: Readonly<Record<string, number>> = { glass: GLASS_BANNER_MS, journey: JOURNEY_BANNER_MS };

/**
 * The longest banner text a locale draws, in characters: Glass's "STAGE 10" / "ETAPA 10" (Simulator.canvasGlassStage). The
 * Journey's ("Stage 2/5: Pegs") is drawn at most 0.9 of the field's side wide (journeyRenderer.ts), which is taken as its width.
 */
const GLASS_BANNER_CHARS = 8;
/** A heavy (900) sans-serif capital's width (em): a generous estimate of the drawn text. */
const BANNER_EM_PER_CHAR = 0.75;
/** A banner's half height (em): its glyphs and their outline. */
const BANNER_HALF_EM = 0.6;

/**
 * --- templates --- (AI studio step 3) The box of the banner a mode draws over the square now, in world pixels (the canvas's own
 * screen space: the banners are drawn there, not in the scrolled world), or null when none shows. Glass Smash's "STAGE n" at 15 %
 * of its field's height from the field's top (glassRenderer.ts drawGlassOverlay), the Journey's "Stage n/N: name" at 20 % of it
 * (journeyRenderer.ts drawOverlay), each for its BANNER_SHOWS_MS from the moment a stage begins and never once HOME is reached.
 */
export function modeBannerBox(engine: ReturnType<typeof createEngineForSettings>, mode: SimulatorSettings["mode"]): { left: number; top: number; right: number; bottom: number } | null {
  if (mode !== "glass" && mode !== "journey") return null;
  const view = mode === "glass" ? engine.getGlassView() : engine.getJourneyView();
  const f = mode === "glass" ? engine.getGlassView().level?.field : engine.getJourneyView().field;
  if (!f || view.homeReached) return null;
  const age = view.timeMs - view.bannerAtMs;
  if (!(age >= 0 && age < BANNER_SHOWS_MS[mode])) return null;
  const fs = mode === "glass" ? Math.max(20, 0.085 * f.height) : Math.max(18, 0.06 * f.height);
  const y = f.top + (mode === "glass" ? 0.15 : 0.2) * f.height;
  const half = mode === "glass" ? (BANNER_EM_PER_CHAR * fs * GLASS_BANNER_CHARS) / 2 : 0.45 * f.height;
  return { left: f.cx - half, top: y - BANNER_HALF_EM * fs, right: f.cx + half, bottom: y + BANNER_HALF_EM * fs };
}

/** --- templates --- (AI studio step 3) The camera a mode scrolls its world by (screen y = world y − this): Glass Smash's, the Journey's. */
function modeCameraY(engine: ReturnType<typeof createEngineForSettings>, mode: SimulatorSettings["mode"]): number {
  return mode === "glass" ? engine.getGlassView().cameraY : mode === "journey" ? engine.getJourneyView().cameraY : 0;
}

/** Whether a banner of the mode's own text covers `box` at sample `k` (a banner cell whose centre lies inside it, as actionUnder). */
export function bannerUnder(track: ActionTrack, k: number, box: SquareBox): boolean {
  const banners = track.banners;
  return !!banners && actionUnder({ ...track, samples: banners }, k, box);
}
// --- end of the modes' own banners and cameras

/** Steps between two pauses of actionTrackSteps(): a second of the run at 60 Hz. */
const SLICE_STEPS = 60;

/**
 * The action track of `seed` played with `settings` in `world`, to `untilSec` of the run (or its own end, when it ends first), as
 * a generator that pauses (yields the playback ms so far) every second of the run, so a page can follow it in slices; drain it
 * with actionTrackSync().
 */
export function* actionTrackSteps(settings: SimulatorSettings, seed: number, world: BotWorld | null | undefined, untilSec: number): Generator<number, ActionTrack> {
  const w = world ?? DEFAULT_BOT_WORLD;
  const request = finderRequestOfSettings(settings, w, untilSec + 1);
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  const side = Math.max(1, Math.min(w.width, w.height));
  const ox = (w.width - side) / 2;
  const oy = (w.height - side) / 2;
  const g = ACTION_GRID;
  const moveMin = ACTION_MOVE_SHARE * side;
  const step = 1000 / 60;
  const samples: string[] = [];
  const banners: string[] | null = modeBannersDrawn(settings) ? [] : null; // --- templates --- (AI studio step 3; step 4b: drawn ones only)
  let last = new Map<number, { x: number; y: number }>();
  let elapsed = 0;
  let steps = 0;
  const cellOf = (v: number) => Math.max(0, Math.min(g - 1, Math.floor(v * g)));
  while (actionSampleSec({ stepSec: ACTION_STEP_SEC }, samples.length) <= untilSec + 1e-9) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step);
    if (elapsed / 1000 + 1e-9 >= actionSampleSec({ stepSec: ACTION_STEP_SEC }, samples.length)) {
      const at = new Map<number, { x: number; y: number }>();
      const cells = new Set<number>();
      const camY = modeCameraY(engine, request.mode); // --- templates --- (AI studio step 3) the ball on screen, as drawn
      for (const b of engine.getBalls()) {
        at.set(b.id, { x: b.x, y: b.y });
        const q = last.get(b.id);
        if (q && Math.hypot(b.x - q.x, b.y - q.y) < moveMin) continue;
        const r = Math.max(0, b.radius || 0);
        const left = (b.x - r - ox) / side;
        const right = (b.x + r - ox) / side;
        const top = (b.y - camY - r - oy) / side;
        const bottom = (b.y - camY + r - oy) / side;
        if (right < 0 || left > 1 || bottom < 0 || top > 1) continue;
        for (let row = cellOf(top); row <= cellOf(bottom); row++) for (let col = cellOf(left); col <= cellOf(right); col++) cells.add(row * g + col);
      }
      last = at;
      samples.push(encodeCells([...cells].sort((a, b) => a - b)));
      // --- templates --- (AI studio step 3) the cells the mode's own banner covers (a cell whose centre lies inside it)
      if (banners) {
        const box = modeBannerBox(engine, request.mode);
        const covered: number[] = [];
        if (box) {
          for (let row = 0; row < g; row++) {
            for (let col = 0; col < g; col++) {
              const x = ox + ((col + 0.5) / g) * side;
              const y = oy + ((row + 0.5) / g) * side;
              if (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom) covered.push(row * g + col);
            }
          }
        }
        banners.push(encodeCells(covered));
      }
    }
    if (engine.isSimulationFinished()) break;
    if (++steps % SLICE_STEPS === 0) yield elapsed;
  }
  return { stepSec: ACTION_STEP_SEC, grid: g, samples, ...(banners ? { banners } : {}) };
}

/** actionTrackSteps() in one go. */
export function actionTrackSync(settings: SimulatorSettings, seed: number, world: BotWorld | null | undefined, untilSec: number): ActionTrack {
  const steps = actionTrackSteps(settings, seed, world, untilSec);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}
// --- end templates ---
