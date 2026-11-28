import { CV_FROZEN, CV_RIDING, KIND_PEG, type ConveyorLayout, type ConveyorView } from "@/lib/physics/modes/conveyor";
import { gapWrap, type CircularWall } from "@/lib/physics/types"; // --- conveyor-glow ---
import { ringArc } from "./ringArc"; // --- conveyor-glow ---

/**
 * The Conveyor Belt's drawing (feature gerald-conveyor; lib/physics/modes/conveyor.ts): `drawWorld()` under the balls – the
 * belt along the top (its body, the tread marks moving at the belt's speed, the rollers turning with it, the hatch in the left
 * wall that flashes when a ball comes out and the lip it drops from), the loading tube into the rings' core, the bowl's glass
 * and stand, the bins of the peg field, and the bottom belt that carries the balls away; `drawEffects()` over them – the frost
 * on the frozen balls; and `drawOverlay()` in screen space – the score, big ("3 / 8" over OUT), at the top right of the field
 * the recorder crops to, where the belt leaves it empty (--- conveyor-count --- Lane E, E6: the small grey title and its
 * "Loaded 17 / Escaped 4" line could not be read in a feed; that line is the end banner's). The rings, the pegs, the bowl's walls and
 * the side walls are the engine's walls and obstacles, drawn by the canvas in the wall colour. Everything moves on the
 * simulation clock (`view.timeMs`), so a pause freezes it and a recording replays it; nothing is allocated per frame.
 */

export interface ConveyorRenderOptions {
  /** The wall colour with an alpha. */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  // --- conveyor-glow --- (round two, B9b) the rings as the canvas draws them this frame (the slow motion's and the replay's too)
  // and their stroke at an alpha in the walls' own colours (the rainbow by ring or round them): without them the rings stay unlit
  walls?: readonly CircularWall[];
  rotations?: readonly number[];
  ringStyle?: (index: number, alpha: number) => string | CanvasGradient;
}

export interface ConveyorLabels {
  /** The HUD's title. */
  title: string;
  /** The counter, by arena: "Loaded 17 / Escaped 4", "Loaded 17 / Overflow 2", "Loaded 17 / Landed 15". */
  loadedEscaped: (loaded: number, escaped: number) => string;
  loadedOverflow: (loaded: number, overflow: number) => string;
  loadedLanded: (loaded: number, landed: number) => string;
  /** "3 frozen" (with the freeze on). */
  frozen: (n: number) => string;
  /** The banner when everything is done, by arena (its line is the counter, and the frozen count). */
  doneRings: string;
  doneBowl: string;
  donePegs: string;
  /** The banner when the safety net ended the run with something still moving. */
  timeUp: string;
  // --- conveyor-count --- (Lane E, E6) the big counter's word under "3 / 8", by arena, and the bowl's spilled balls under it
  outWord: string;
  loadedWord: string;
  landedWord: string;
  spilled: (n: number) => string;
}

export const DEFAULT_CONVEYOR_LABELS: ConveyorLabels = {
  title: "CONVEYOR BELT",
  loadedEscaped: (loaded, escaped) => `Loaded ${loaded} / Escaped ${escaped}`,
  loadedOverflow: (loaded, overflow) => `Loaded ${loaded} / Overflow ${overflow}`,
  loadedLanded: (loaded, landed) => `Loaded ${loaded} / Landed ${landed}`,
  frozen: (n) => `${n} frozen`,
  doneRings: "ALL OUT!",
  doneBowl: "SETTLED!",
  donePegs: "LANDED!",
  timeUp: "TIME'S UP",
  outWord: "OUT", // --- conveyor-count ---
  loadedWord: "LOADED",
  landedWord: "LANDED",
  spilled: (n) => `${n} spilled`,
};

// --- conveyor-count --- (Lane E, E6)
/** The big counter's size (the digits' font, as a share of the square) and how long (ms of simulation time) it pops on a new count. */
export const CONVEYOR_COUNT_SHARE = 0.095;
export const CONVEYOR_COUNT_POP_MS = 320;

/** The big counter of the view's arena: the number counted, of how many, and the word under it (none: no layout yet). */
export function conveyorCount(view: ConveyorView, labels: ConveyorLabels): { n: number; of: number; word: string; atMs: number } {
  const arena = view.settings.arena;
  if (arena === "bowl") return { n: view.loaded, of: view.max, word: labels.loadedWord, atMs: view.lastDropMs };
  if (arena === "pegs") return { n: view.landed, of: view.max, word: labels.landedWord, atMs: -Infinity };
  return { n: view.escaped, of: view.max, word: labels.outWord, atMs: view.lastEscapeMs };
}

/**
 * Where the end banner sits (the share of the square its plate's centre is at): above the arena, not on it – over the top of
 * the rings (between the square's top margin and the outer ring: the idle belt goes under it) and above the first row of pegs;
 * the bowl's under the bowl and its pile, on the stand. `width` × `height`: the world the layout was built in.
 */
export function conveyorBannerAt(view: ConveyorView, width: number, height: number): number | undefined {
  const L = view.layout;
  if (!L) return undefined;
  const side = Math.max(1, Math.min(width, height));
  const top = (height - side) / 2;
  if (view.settings.arena === "bowl") return 0.78;
  let arenaTop = Infinity;
  if (view.settings.arena === "rings" && L.ringRadii.length > 0) arenaTop = L.cy - L.ringRadii[L.ringRadii.length - 1];
  else {
    for (let i = 0; i < L.obstacles.length; i++) {
      const o = L.obstacles[i];
      if (L.kinds[i] === KIND_PEG && o.kind === "circle") arenaTop = Math.min(arenaTop, o.y - o.radius);
    }
  }
  if (!Number.isFinite(arenaTop)) return undefined;
  return ((top + 0.02 * side + arenaTop) / 2 - top) / side;
}

/**
 * --- conveyor-all-out --- (Lane E, E6 review) Whether the end banner shows: from the moment it came in with its chord
 * (`ConveyorView.outAtMs`: in the rings the last ball out, not the run's end once it has ridden off) through the hold.
 */
export function conveyorBannerShown(view: Pick<ConveyorView, "outAtMs">): boolean {
  return view.outAtMs >= 0;
}

/** The pop of a counter `ageMs` after its count went up: a scale from 1.35 back to 1 (1 before and after). */
export function conveyorCountPop(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= CONVEYOR_COUNT_POP_MS) return 1;
  const k = 1 - ageMs / CONVEYOR_COUNT_POP_MS;
  return 1 + 0.35 * k * k;
}
// --- end conveyor-count ---

// --- conveyor-glow --- (round two, B9b)
/*
 * The rings lit (draw only, the Rings arena): over the thin walls the canvas draws at 60 %, every ring again with a core thicker
 * than the wall and two soft halos in the walls' own colours, so the arena reads from a clip's first frame, long before the first
 * ball is out (the darkest clip of its group: 92 % of it dark). Each gap's two ends get a white stud (the way out), and every
 * ball out brightens the rings for a moment. All of it from the view's clock and the walls the canvas drew this frame.
 */
/** The core's width: the Wall Thickness plus at most 4 px (twice a thin wall), at least this share of the square. */
export const CONVEYOR_RING_EXTRA = 4;
export const CONVEYOR_RING_MIN_SHARE = 0.0055;
/** The halos (width as a multiple of the core, alpha), widest first, and the core's alpha. */
export const CONVEYOR_RING_HALOS: readonly { width: number; alpha: number }[] = [
  { width: 4.5, alpha: 0.09 },
  { width: 2.4, alpha: 0.22 },
];
export const CONVEYOR_RING_CORE_ALPHA = 0.92;
/** How long (simulation ms) the rings stay brightened after a ball got out. */
export const CONVEYOR_RING_PULSE_MS = 450;

/** The lit core's width (world px) for a Wall Thickness of `wallThickness` in a square of `side` px. */
export function conveyorRingWidth(wallThickness: number, side: number): number {
  const t = Number.isFinite(wallThickness) && wallThickness > 0 ? wallThickness : 2;
  return Math.max(t + Math.min(t, CONVEYOR_RING_EXTRA), CONVEYOR_RING_MIN_SHARE * side);
}

/** The rings' brightening `ageMs` after a ball got out: 1 at the escape, easing to 0 by CONVEYOR_RING_PULSE_MS (0 outside it). */
export function conveyorRingPulse(ageMs: number): number {
  if (!(ageMs >= 0) || ageMs >= CONVEYOR_RING_PULSE_MS) return 0;
  const k = 1 - ageMs / CONVEYOR_RING_PULSE_MS;
  return k * k;
}
// --- end conveyor-glow ---

/** How long (ms of simulation time) the hatch glows after a ball came out. */
export const HATCH_FLASH_MS = 350;
/** Px between two tread marks of a belt. */
const TREAD = 11;
const SPOKES = 3;
const TWO_PI = Math.PI * 2;
const ACCENT = "#93d119";

/** The counter line of the HUD for the view's arena. */
export function conveyorCounter(view: ConveyorView, labels: ConveyorLabels): string {
  const arena = view.settings.arena;
  if (arena === "bowl") return labels.loadedOverflow(view.loaded, view.overflow);
  if (arena === "pegs") return labels.loadedLanded(view.loaded, view.landed);
  return labels.loadedEscaped(view.loaded, view.escaped);
}

/** The final banner's title and line for the view's arena (TIME'S UP when the safety net ended it): the counter, and the frozen balls when there are any. */
export function conveyorBanner(view: ConveyorView, labels: ConveyorLabels): { title: string; sub: string } {
  const arena = view.settings.arena;
  const counter = conveyorCounter(view, labels);
  const title = view.timedOut ? labels.timeUp : arena === "bowl" ? labels.doneBowl : arena === "pegs" ? labels.donePegs : labels.doneRings;
  return { title, sub: view.frozen > 0 ? `${counter} · ${labels.frozen(view.frozen)}` : counter };
}

export class ConveyorLayer {
  /** Simulation ms the last ball came out of the hatch (the flash), and the release count it was seen at. */
  private hatchAtMs = -Infinity;
  private seenReleased = 0;
  private seenGeneration: ConveyorLayout | null = null;

  /** A belt from x0 to x1 with its surface at y, `thick` deep, the tread moving right at `speed` px/s. */
  private belt(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, thick: number, speed: number, timeSec: number) {
    const r = thick / 2;
    // The body: a rounded band between the two rollers.
    ctx.fillStyle = "#262b35";
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.arc(x1, y + r, r, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0, y + thick);
    ctx.arc(x0, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.closePath();
    ctx.fill();
    // The surface the balls ride on.
    ctx.strokeStyle = "#4b5363";
    ctx.lineWidth = Math.max(1.5, 0.22 * thick);
    ctx.beginPath();
    ctx.moveTo(x0, y + 0.5 * ctx.lineWidth);
    ctx.lineTo(x1, y + 0.5 * ctx.lineWidth);
    ctx.stroke();
    // The tread marks, moving with the belt (clipped to the band).
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y, Math.max(0, x1 - x0), thick);
    ctx.clip();
    const offset = (((speed * timeSec) % TREAD) + TREAD) % TREAD;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = x0 - TREAD + offset; x < x1 + TREAD; x += TREAD) {
      ctx.moveTo(x, y + 0.25 * thick);
      ctx.lineTo(x + 0.35 * thick, y + 0.8 * thick);
    }
    ctx.stroke();
    ctx.restore();
    // The rollers at both ends, turning with the belt.
    const turn = r > 0 ? (speed * timeSec) / r : 0;
    for (let end = 0; end < 2; end++) {
      const x = end === 0 ? x0 : x1;
      ctx.fillStyle = "#8d96a6";
      ctx.beginPath();
      ctx.arc(x, y + r, 0.82 * r, 0, TWO_PI);
      ctx.fill();
      ctx.strokeStyle = "#323844";
      ctx.lineWidth = Math.max(1, 0.18 * r);
      ctx.beginPath();
      for (let i = 0; i < SPOKES; i++) {
        const a = turn + (i * TWO_PI) / SPOKES;
        ctx.moveTo(x, y + r);
        ctx.lineTo(x + 0.72 * r * Math.cos(a), y + r + 0.72 * r * Math.sin(a));
      }
      ctx.stroke();
      ctx.fillStyle = "#323844";
      ctx.beginPath();
      ctx.arc(x, y + r, 0.22 * r, 0, TWO_PI);
      ctx.fill();
    }
  }

  /** The belts, the hatch, the drop lip, the loading tube, the bowl's glass and stand and the bins (under the balls). */
  drawWorld(ctx: CanvasRenderingContext2D, view: ConveyorView, opts: ConveyorRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const t = view.timeMs / 1000;
    // A new run (or a new layout) resets the hatch flash; a ball out of the hatch since the last frame lights it.
    if (L !== this.seenGeneration || view.released < this.seenReleased) {
      this.seenGeneration = L;
      this.seenReleased = 0;
      this.hatchAtMs = -Infinity;
    }
    if (view.released > this.seenReleased) {
      this.seenReleased = view.released;
      this.hatchAtMs = view.timeMs;
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const r = L.maxBallRadius;
    const arena = view.settings.arena;

    if (arena === "rings") this.drawRings(ctx, view, opts, L); // --- conveyor-glow --- (under the loading tube)

    // The rings: the loading tube from the belt's end down into the core (over the rings, under the balls).
    if (arena === "rings" && L.ringRadii.length > 0) {
      const half = r + 3;
      const y0 = L.ceilingY;
      const y1 = L.cy;
      ctx.fillStyle = "rgba(147, 209, 25, 0.06)";
      ctx.fillRect(L.cx - half, y0, 2 * half, y1 - y0);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(L.cx - half, y0);
      ctx.lineTo(L.cx - half, y1);
      ctx.moveTo(L.cx + half, y0);
      ctx.lineTo(L.cx + half, y1);
      ctx.stroke();
      // The tube's mouth in the core.
      ctx.strokeStyle = opts.wallAlpha(0.35);
      ctx.beginPath();
      ctx.arc(L.cx, y1, half, 0, Math.PI);
      ctx.stroke();
    }

    // The bowl: a faint glass inside and a stand down to the bottom belt.
    if (L.bowl) {
      const b = L.bowl;
      ctx.fillStyle = "rgba(120, 200, 255, 0.07)";
      ctx.beginPath();
      ctx.moveTo(b.cx - b.halfWidth, b.rimY);
      ctx.lineTo(b.cx - b.halfWidth, b.arcTopY);
      ctx.ellipse(b.cx, b.arcTopY, b.halfWidth, Math.max(1, b.bottomY - b.arcTopY), 0, Math.PI, 0, true);
      ctx.lineTo(b.cx + b.halfWidth, b.rimY);
      ctx.closePath();
      ctx.fill();
      if (L.bottomBeltY > b.bottomY) {
        ctx.strokeStyle = opts.wallAlpha(0.45);
        ctx.lineWidth = Math.max(2, opts.wallThickness);
        ctx.beginPath();
        for (let leg = 0; leg < 2; leg++) {
          const side = leg === 0 ? -1 : 1;
          const x = b.cx + side * 0.55 * b.halfWidth;
          const yTop = b.arcTopY + (b.bottomY - b.arcTopY) * Math.sqrt(Math.max(0, 1 - 0.55 * 0.55));
          ctx.moveTo(x, yTop);
          ctx.lineTo(b.cx + side * 0.75 * b.halfWidth, L.bottomBeltY - 0.5);
        }
        ctx.stroke();
      }
    }

    // The peg field's bins: every other one a shade lighter.
    if (arena === "pegs" && L.binEdges.length > 0) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.035)";
      let x0 = L.left;
      for (let i = 0; i <= L.binEdges.length; i++) {
        const x1 = i < L.binEdges.length ? L.binEdges[i] : L.right;
        if (i % 2 === 0) ctx.fillRect(x0, L.binTop, x1 - x0, L.floorY - L.binTop);
        x0 = x1;
      }
    }

    // The top belt, its hatch in the left wall and the lip it drops from.
    this.belt(ctx, L.beltStartX, L.dropX, L.beltY, L.beltThickness, L.beltSpeed, t);
    const flash = Math.max(0, 1 - (view.timeMs - this.hatchAtMs) / HATCH_FLASH_MS);
    const hatchH = 2.4 * r + 6;
    ctx.fillStyle = "#07090d";
    ctx.fillRect(L.left - 3, L.beltY - hatchH, 6, hatchH);
    ctx.strokeStyle = flash > 0 ? `rgba(147, 209, 25, ${(0.35 + 0.65 * flash).toFixed(2)})` : "rgba(147, 209, 25, 0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.left + 3, L.beltY - hatchH);
    ctx.lineTo(L.left + 3, L.beltY);
    ctx.stroke();
    // The lip: a small chevron under the belt's end, pointing down.
    const lip = Math.max(4, 0.6 * L.beltThickness);
    const ly = L.beltY + L.beltThickness + 3;
    ctx.strokeStyle = ACCENT;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(L.dropX - lip, ly);
    ctx.lineTo(L.dropX, ly + lip * 0.8);
    ctx.lineTo(L.dropX + lip, ly);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The bottom belt (rings, bowl): across the field and out under the right wall.
    if (L.bottomBeltY > 0) this.belt(ctx, L.left, L.exitX, L.bottomBeltY, L.beltThickness, L.bottomBeltSpeed, t);
    ctx.restore();
  }

  // --- conveyor-glow --- (round two, B9b)
  /** The rings lit: two halos and a core over every ring the canvas drew (between its gaps, turned as drawn), a stud at each gap's ends. */
  private drawRings(ctx: CanvasRenderingContext2D, view: ConveyorView, opts: ConveyorRenderOptions, L: ConveyorLayout) {
    const walls = opts.walls;
    const style = opts.ringStyle;
    if (!walls || walls.length === 0 || !style) return;
    const rotations = opts.rotations;
    const pulse = conveyorRingPulse(view.timeMs - view.lastEscapeMs);
    const core = conveyorRingWidth(opts.wallThickness, Math.min(L.width, L.height)) * (1 + 0.35 * pulse);
    ctx.save();
    ctx.lineCap = "butt";
    for (let pass = 0; pass <= CONVEYOR_RING_HALOS.length; pass++) {
      const halo = pass < CONVEYOR_RING_HALOS.length ? CONVEYOR_RING_HALOS[pass] : null;
      ctx.lineWidth = halo ? halo.width * core : core;
      const alpha = halo ? Math.min(1, halo.alpha * (1 + 1.5 * pulse)) : CONVEYOR_RING_CORE_ALPHA;
      for (let i = 0; i < walls.length; i++) {
        const wall = walls[i];
        const rot = (rotations && rotations[i]) || 0;
        ctx.strokeStyle = style(i, alpha);
        ctx.beginPath();
        // the wall between the gaps, as the canvas strokes it (sorted gaps from [0, 2π); a last gap across 0 moves the start past its end)
        const c0 = gapWrap(wall.gaps);
        let cursor = c0;
        for (const gap of wall.gaps) {
          const start = gap.startAngle + rot;
          if (start > cursor + rot) ringArc(ctx, L.cx, L.cy, wall.radius, cursor + rot, start, true);
          cursor = gap.endAngle;
        }
        if (cursor < TWO_PI + c0) ringArc(ctx, L.cx, L.cy, wall.radius, cursor + rot, TWO_PI + c0 + rot, true);
        ctx.stroke();
      }
    }
    // the studs: a white dot at both ends of every gap
    ctx.fillStyle = `rgba(255, 255, 255, ${(0.75 + 0.25 * pulse).toFixed(3)})`;
    ctx.beginPath();
    const stud = 0.7 * core;
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const rot = (rotations && rotations[i]) || 0;
      for (const gap of wall.gaps) {
        for (let end = 0; end < 2; end++) {
          const a = (end === 0 ? gap.startAngle : gap.endAngle) + rot;
          const x = L.cx + wall.radius * Math.cos(a);
          const y = L.cy + wall.radius * Math.sin(a);
          ctx.moveTo(x + stud, y);
          ctx.arc(x, y, stud, 0, TWO_PI);
        }
      }
    }
    ctx.fill();
    ctx.restore();
  }
  // --- end conveyor-glow ---

  /** The frost on the frozen balls (over the balls). */
  drawEffects(ctx: CanvasRenderingContext2D, view: ConveyorView) {
    const frozen = view.frozenBalls;
    if (frozen.length === 0) return;
    ctx.save();
    ctx.strokeStyle = "rgba(170, 225, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < frozen.length; i++) {
      const o = frozen[i];
      ctx.moveTo(o.x + o.radius + 1.5, o.y);
      ctx.arc(o.x, o.y, o.radius + 1.5, 0, TWO_PI);
    }
    ctx.stroke();
    // A glint on each.
    ctx.strokeStyle = "rgba(235, 248, 255, 0.9)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < frozen.length; i++) {
      const o = frozen[i];
      const g = Math.max(1.5, 0.35 * o.radius);
      const gx = o.x - 0.35 * o.radius;
      const gy = o.y - 0.35 * o.radius;
      ctx.moveTo(gx - g, gy);
      ctx.lineTo(gx + g, gy);
      ctx.moveTo(gx, gy - g);
      ctx.lineTo(gx, gy + g);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * --- conveyor-count --- (Lane E, E6) The score (screen space, part of the recording), big and right-aligned at the top right
   * of the field the recorder crops to, where the belt leaves it empty: "3 / 8" in white with the count in the accent, popping
   * as it goes up, and the word under it (OUT, LOADED, LANDED); the bowl's spilled balls and the frozen ones under that. Once
   * everything is done the end banner says it all: the counter steps aside. `inset`: live, below the page's buttons over a
   * nearly square canvas. The digits shrink to fit a long count.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: ConveyorView, labels: ConveyorLabels, width: number, height: number, inset = 0) {
    const L = view.layout;
    if (!L || conveyorBannerShown(view)) return;
    const side = Math.min(width, height);
    const right = Math.min(L.right - 0.025 * side, width / 2 + side / 2 - 0.035 * side);
    const top = height / 2 - side / 2 + 0.03 * side + inset;
    const room = Math.max(1, right - (L.dropX + 0.06 * side));
    const count = conveyorCount(view, labels);
    const ofText = ` / ${count.of}`;
    let fs = Math.max(18, CONVEYOR_COUNT_SHARE * side);
    ctx.save();
    ctx.textBaseline = "middle";
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    const nText = String(count.n);
    const wide = ctx.measureText(nText + ofText).width;
    if (wide > room) {
      fs *= room / wide;
      ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    }
    const ofW = ctx.measureText(ofText).width;
    const y = top + 0.55 * fs;
    // " / 8" in white, then the count in the accent left of it, popping
    ctx.textAlign = "right";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.1 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(ofText, right, y);
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(ofText, right, y);
    const pop = conveyorCountPop(view.timeMs - count.atMs);
    ctx.save();
    ctx.translate(right - ofW, y);
    if (pop !== 1) ctx.scale(pop, pop);
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = pop > 1 ? 0.4 * fs * (pop - 1) / 0.35 : 0;
    ctx.strokeText(nText, 0, 0);
    ctx.fillStyle = ACCENT;
    ctx.fillText(nText, 0, 0);
    ctx.restore();
    // the word under it, then the spilled and the frozen balls
    const wfs = Math.max(11, 0.36 * fs);
    ctx.font = `800 ${wfs.toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    let line = y + 0.5 * fs + 0.75 * wfs;
    ctx.fillText(count.word, right, line);
    ctx.font = `700 ${(0.85 * wfs).toFixed(1)}px sans-serif`;
    if (view.settings.arena === "bowl" && view.overflow > 0) {
      line += 1.25 * wfs;
      ctx.fillStyle = "#fb7185";
      ctx.fillText(labels.spilled(view.overflow), right, line);
    }
    if (view.settings.freeze && view.frozen > 0) {
      line += 1.25 * wfs;
      ctx.fillStyle = "rgba(170, 225, 255, 0.9)";
      ctx.fillText(labels.frozen(view.frozen), right, line);
    }
    ctx.restore();
  }
}

/** The data-cv-* attributes the canvas mirrors for tools and the smoke test. */
export const CONVEYOR_DATA_KEYS = ["cvArena", "cvMax", "cvReleased", "cvLoaded", "cvEscaped", "cvOverflow", "cvLanded", "cvFrozen", "cvCarried", "cvPasses", "cvNotes", "cvHums", "cvClicks", "cvRiding", "cvInside", "cvRings", "cvDrops", "cvAllDone", "cvFinished", "cvFinishedMs", "cvFrozenBalls", "cvOnBelt"];

/** Writes the data-cv-* attributes (the drop times only when they changed). */
export class ConveyorDataset {
  private drops = -1;
  private dropText = "";

  write(view: ConveyorView, set: (key: string, value: string) => void) {
    if (view.dropTimes.length !== this.drops) {
      this.drops = view.dropTimes.length;
      this.dropText = view.dropTimes.join(",");
    }
    let onBelt = 0;
    for (let k = 0; k < view.released; k++) if (view.slotState[k] === CV_RIDING) onBelt++;
    let frozen = 0;
    for (let k = 0; k < view.released; k++) if (view.slotState[k] === CV_FROZEN) frozen++;
    set("cvArena", view.settings.arena);
    set("cvMax", String(view.max));
    set("cvReleased", String(view.released));
    set("cvLoaded", String(view.loaded));
    set("cvEscaped", String(view.escaped));
    set("cvOverflow", String(view.overflow));
    set("cvLanded", String(view.landed));
    set("cvFrozen", String(view.frozen));
    set("cvCarried", String(view.carried));
    set("cvPasses", String(view.passes));
    set("cvNotes", String(view.notes));
    set("cvHums", String(view.hums));
    set("cvClicks", String(view.clicks));
    set("cvRiding", String(view.riding));
    set("cvInside", String(view.inside));
    set("cvRings", String(view.layout?.ringRadii.length ?? 0));
    set("cvDrops", this.dropText);
    set("cvAllDone", view.allDone ? "1" : "0");
    set("cvFinished", view.finished ? "1" : "0");
    set("cvFinishedMs", String(Math.round(view.finishedMs)));
    set("cvFrozenBalls", String(frozen));
    set("cvOnBelt", String(onBelt));
  }
}
