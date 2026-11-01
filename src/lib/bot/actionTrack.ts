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
 *
 * --- templates --- (studio2 review round 2, 16) A mode whose stake stands still on its own (Target's glowing segment, the one to hit
 * next) keeps the cells it covers per sample too (ActionTrack.stakes): what a viewer watches as much as the ball, so a text over it
 * hides the action (actionUnder) – the hook "Will it break?" and the closing "One more hit? 👇" sat over the very segment they
 * asked about, at the top of the ring, while the bottom of the square was clear (watched).
 *
 * --- templates --- (studio2 review round 2, 19) A mode that draws a counter of its own over the clip (COUNTER_MODES: Brick Smash's
 * bricks standing, Spiral Glass's badge) keeps what it read too (ActionTrack.counter): its first and last readings, its least and its
 * most – numbers a viewer reads on screen, so the crew's facts hold them (crew/clip.ts counterNumbersOf: the producer's "897 bricks
 * down to 0" was refused as "not a number this clip has" under a counter drawn from its first frame, "900 bricks", watched).
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
  /**
   * --- templates --- (studio2 review round 2, 16) Per sample: the cells the mode's stake covers there, a still thing a viewer watches
   * (modeStakeCells: Target's segment to hit next, its number beside it); absent for a mode without one, so every other track is as it was.
   */
  stakes?: string[];
  /**
   * --- templates --- (studio2 review round 2, 19) What the mode's own counter read over the track (COUNTER_MODES), after every step
   * to its last sample (within stepSec of the clip's end); absent for a mode without one, so every other track is as it was.
   */
  counter?: CounterRead;
}

/** --- templates --- (studio2 review round 2, 19) A mode's own counter over a track: its first and last readings, its least and its most. */
export interface CounterRead {
  first: number;
  last: number;
  least: number;
  most: number;
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
    (t.banners === undefined || (Array.isArray(t.banners) && t.banners.every((s) => typeof s === "string"))) && // --- templates --- (AI studio step 3)
    (t.stakes === undefined || (Array.isArray(t.stakes) && t.stakes.every((s) => typeof s === "string"))) && // --- templates --- (studio2 review round 2, 16)
    (t.counter === undefined || isCounterRead(t.counter)) // --- templates --- (studio2 review round 2, 19)
  );
}

/** --- templates --- (studio2 review round 2, 19) Whether a value is a counter's reading (CounterRead): four finite numbers. */
function isCounterRead(value: unknown): value is CounterRead {
  const c = value as Record<string, unknown> | null;
  return !!c && typeof c === "object" && (["first", "last", "least", "most"] as const).every((k) => typeof c[k] === "number" && Number.isFinite(c[k]));
}

/** The run second of sample `k`. */
export function actionSampleSec(track: Pick<ActionTrack, "stepSec">, k: number): number {
  return (k + 1) * track.stepSec;
}

/** Whether a cell of `sample` lies under `box`: one whose centre lies inside it (so a cell the box only grazes does not count). */
function cellsUnder(sample: string, g: number, box: SquareBox): boolean {
  for (const cell of actionCellsOf(sample)) {
    const cx = ((cell % g) + 0.5) / g;
    const cy = (Math.floor(cell / g) + 0.5) / g;
    if (cx >= box.left && cx <= box.right && cy >= box.top && cy <= box.bottom) return true;
  }
  return false;
}

/**
 * Whether a moving ball is under `box` at sample `k`: a cell of the sample whose centre lies inside the box (so a cell the
 * box only grazes does not count) – --- templates --- (studio2 review round 2, 16) or a cell of the mode's stake there (stakes).
 */
export function actionUnder(track: ActionTrack, k: number, box: SquareBox): boolean {
  return cellsUnder(track.samples[k] ?? "", track.grid, box) || (!!track.stakes && cellsUnder(track.stakes[k] ?? "", track.grid, box));
}

/** --- templates --- (studio2 review round 2, 16) Whether the mode's stake lies under `box` at sample `k` (a stake cell whose centre lies inside it). */
export function stakeUnder(track: ActionTrack, k: number, box: SquareBox): boolean {
  return !!track.stakes && cellsUnder(track.stakes[k] ?? "", track.grid, box);
}

// --- templates --- (studio2 review round 2, 16) the modes' own stakes
/** The modes that draw a still stake of their own a viewer watches (modeStakeCells): Target's segment to hit next. */
export const STAKE_MODES: readonly SimulatorSettings["mode"][] = ["target"];

/** Points along an arc a stake is sampled at (each a cell it covers): 4 a cell of a 20 × 20 grid on a ring of the square's side. */
const STAKE_ARC_POINTS = 48;

/**
 * --- templates --- (studio2 review round 2, 16) The cells of the exported square the mode's stake covers now (none once its run is
 * done): Target's segment to hit next as Canvas.tsx draws it – the arc of its ring from 12 o'clock clockwise, a 2π/total step a
 * segment, its stroke max(8, 6 % of the radius) thick with a 12 px glow – and its number outside the ring (labelR, its font 3 % of
 * the canvas's side).
 */
function modeStakeCells(engine: ReturnType<typeof createEngineForSettings>, mode: SimulatorSettings["mode"], world: BotWorld, cellOf: (share: number) => number, g: number): number[] {
  if (mode !== "target" || !engine.isCountdownMode() || engine.isCountdownComplete()) return [];
  const wall = engine.getCircularWalls()[0];
  const total = engine.getCountdownTotal();
  const target = engine.getCountdownTarget();
  const s = engine.getCountdownSegmentMap().indexOf(target);
  if (!wall || !(total > 0) || s < 0) return [];
  const side = Math.min(world.width, world.height);
  const ox = (world.width - side) / 2;
  const oy = (world.height - side) / 2;
  const cx = world.width / 2;
  const cy = world.height / 2;
  const r = wall.radius;
  const half = Math.max(8, 0.06 * r) / 2 + 12;
  const labelR = r + Math.max(12, 0.08 * r);
  const font = Math.max(10, 0.03 * side);
  const step = (2 * Math.PI) / total;
  const a0 = -Math.PI / 2 + s * step;
  const cells = new Set<number>();
  const mark = (x: number, y: number) => {
    const u = (x - ox) / side;
    const v = (y - oy) / side;
    if (u >= 0 && u <= 1 && v >= 0 && v <= 1) cells.add(cellOf(v) * g + cellOf(u));
  };
  for (let i = 0; i <= STAKE_ARC_POINTS; i++) {
    const a = a0 + (step * i) / STAKE_ARC_POINTS;
    for (const rr of [r - half, r, r + half]) mark(cx + rr * Math.cos(a), cy + rr * Math.sin(a));
  }
  const mid = a0 + step / 2;
  const lx = cx + labelR * Math.cos(mid);
  const ly = cy + labelR * Math.sin(mid);
  for (const dx of [-font, 0, font]) for (const dy of [-font / 2, 0, font / 2]) mark(lx + dx, ly + dy);
  return [...cells].sort((a, b) => a - b);
}
// --- end of the modes' own stakes

// --- templates --- (studio2 review round 2, 19) the modes' own counters
/**
 * The modes that draw a counter of their own over the whole clip, which no setting switches off (crew/hudFlags.ts MODE_HUDS): Brick
 * Smash's bricks standing – "900 bricks" under the box with the loop HUD off (brickRebuildRenderer.ts drawCounters), the loop HUD's
 * counter line with it on – and Spiral Glass's badge at the spiral's entrance, the balls' count ("x7": spiralGlassRenderer.ts drawEffects).
 */
export const COUNTER_MODES: readonly SimulatorSettings["mode"][] = ["brickRebuild", "spiralGlass"];

/** The number a mode's own counter draws now (COUNTER_MODES), null in another mode. */
function modeCounter(engine: ReturnType<typeof createEngineForSettings>, mode: SimulatorSettings["mode"]): number | null {
  if (mode === "brickRebuild") return engine.getBrickRebuildHudCount();
  if (mode === "spiralGlass") return engine.getSpiralGlassView().count;
  return null;
}
// --- end of the modes' own counters

// --- templates --- (AI studio step 3) the modes' own banners and cameras
/**
 * The modes that draw a banner of their own text over the square (modeBannerBox): Glass Smash's stages, the Journey's – --- templates
 * --- (AI studio step 6) and Mode Lab's title block, its game's name and counters in the square's top left corner the whole run.
 */
export const BANNER_MODES: readonly SimulatorSettings["mode"][] = ["glass", "journey", "blueprint"];

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
  if (mode === "blueprint") return labTitleBox(engine); // --- templates --- (AI studio step 6)
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

// --- templates --- (AI studio step 6) Mode Lab's title block
/**
 * The widest a Mode Lab title block is taken to be, as a share of the square's side: its longest line – the game's name in capitals
 * at 0.9 of the block's font, or a counter ("COLOURS LEFT 4") – is about a third of the side in English, more in Polish ("WSPINACZKA
 * POZIOMÓW"); the renderer's own cap is 0.6 (blueprintRenderer.ts overlayPlacement), which no catalog game's comes near.
 */
const LAB_TITLE_SHARE = 0.4;

/**
 * --- templates --- (AI studio step 6) The box of Mode Lab's title block in a recorded frame, in world pixels (blueprintRenderer.ts
 * drawOverlay: in the square's top left corner, 4 % of its side in and 3 % down, a line for the game's name and one for each HUD
 * counter at 1.1 × a font of 3 % of the side, at most LAB_TITLE_SHARE wide): the whole run, as the page draws it.
 */
function labTitleBox(engine: ReturnType<typeof createEngineForSettings>): { left: number; top: number; right: number; bottom: number } | null {
  const view = engine.getBlueprintView();
  const w = view.world;
  if (!view.bp || !w || !(w.width > 0) || !(w.height > 0)) return null;
  const side = Math.min(w.width, w.height);
  const x0 = (w.width - side) / 2;
  const y0 = (w.height - side) / 2;
  const fs = Math.max(11, 0.03 * side);
  const lines = 1 + (view.catalogId === "" ? 1 : 0) + view.hud.length;
  return { left: x0, top: y0, right: x0 + (0.04 + LAB_TITLE_SHARE) * side, bottom: y0 + 0.03 * side + (lines + 0.5) * 1.1 * fs };
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
  const stakes: string[] | null = STAKE_MODES.includes(settings.mode) ? [] : null; // --- templates --- (studio2 review round 2, 16)
  let counter: CounterRead | null = null; // --- templates --- (studio2 review round 2, 19)
  const counts = COUNTER_MODES.includes(settings.mode);
  let last = new Map<number, { x: number; y: number }>();
  let elapsed = 0;
  let steps = 0;
  const cellOf = (v: number) => Math.max(0, Math.min(g - 1, Math.floor(v * g)));
  while (actionSampleSec({ stepSec: ACTION_STEP_SEC }, samples.length) <= untilSec + 1e-9) {
    engine.update(step, 0);
    elapsed += stepPlaybackMs(engine, step);
    // --- templates --- (studio2 review round 2, 19) the mode's own counter, after every step
    const n = counts ? modeCounter(engine, request.mode) : null;
    if (n !== null && Number.isFinite(n)) {
      if (!counter) counter = { first: n, last: n, least: n, most: n };
      else {
        counter.last = n;
        if (n < counter.least) counter.least = n;
        if (n > counter.most) counter.most = n;
      }
    }
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
      if (stakes) stakes.push(encodeCells(modeStakeCells(engine, request.mode, w, cellOf, g))); // --- templates --- (studio2 review round 2, 16)
    }
    if (engine.isSimulationFinished()) break;
    if (++steps % SLICE_STEPS === 0) yield elapsed;
  }
  return { stepSec: ACTION_STEP_SEC, grid: g, samples, ...(banners ? { banners } : {}), ...(stakes ? { stakes } : {}), ...(counter ? { counter } : {}) };
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
