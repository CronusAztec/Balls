import { createEngineForSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings } from "@/lib/settings";
import { segmentEndpoints, type SegmentEnds } from "@/lib/physics/obstacles";
import { gapWrap, type ModeId } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";

/*
 * --- site-redesign --- The landing page's live preview: the real PhysicsEngine – the studio's, with a mode's default
 * settings and a fixed seed, so it plays the same run on every visit – drawn by a small renderer of its own (rings with
 * their gaps, pegs and bars, the balls) instead of the studio's canvas, which keeps the landing page light. This module
 * is loaded on demand (LivePreview.tsx imports it after the page is up).
 */

/** The modes the preview rotates through: ring and peg modes the small renderer draws completely. */
export const PREVIEW_MODES: readonly ModeId[] = ["classic", "multiply", "drop", "grow"];
export const PREVIEW_SEED = 20261001;
const STEP_MS = 16.666;
const TWO_PI = Math.PI * 2;

/** A headless engine for `mode` with its default settings in a world of `width` × `height` CSS px. */
export function createPreviewEngine(mode: ModeId, width: number, height: number, seed = PREVIEW_SEED): PhysicsEngine {
  const settings = defaultSettings(mode);
  const engine = createEngineForSettings(physicsConfigOfSettings(settings, { width, height }), mode, modeSettingsOfSettings(settings), seed);
  engine.setWallBreakStyle("none");
  return engine;
}

/** Advances the engine by a frame's worth of fixed steps (at most four, so a slow frame never snowballs). */
export function stepPreview(engine: PhysicsEngine, state: { acc: number }, frameMs: number): void {
  state.acc = Math.min(state.acc + frameMs, STEP_MS * 4);
  while (state.acc >= STEP_MS) {
    engine.update(STEP_MS, 0);
    state.acc -= STEP_MS;
  }
}

export interface PreviewPalette {
  background: string;
  wall: string;
  ball: string;
  ballAlt: string;
}

const ends: SegmentEnds = { x1: 0, y1: 0, x2: 0, y2: 0 };

/** Draws one frame of the engine's world into `ctx` (already scaled to CSS px). Allocation-free per frame. */
export function drawPreview(ctx: CanvasRenderingContext2D, engine: PhysicsEngine, width: number, height: number, palette: PreviewPalette): void {
  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;

  // Rings: the arcs between the gaps, turned by each ring's rotation.
  const walls = engine.getCircularWalls();
  const rotations = engine.getWallRotations();
  const broken = engine.getBrokenWalls();
  ctx.lineCap = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = palette.wall;
  for (let i = 0; i < walls.length; i++) {
    if (broken.has(i)) continue;
    const wall = walls[i];
    const rot = rotations[i] || 0;
    const c0 = gapWrap(wall.gaps);
    let cursor = c0;
    ctx.globalAlpha = 0.35 + 0.55 * (1 - i / Math.max(1, walls.length));
    for (const gap of wall.gaps) {
      const start = gap.startAngle + rot;
      if (start > cursor + rot) {
        ctx.beginPath();
        ctx.arc(cx, cy, wall.radius, cursor + rot, start);
        ctx.stroke();
      }
      cursor = gap.endAngle;
    }
    if (cursor < TWO_PI + c0) {
      ctx.beginPath();
      ctx.arc(cx, cy, wall.radius, cursor + rot, TWO_PI + c0 + rot);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // Pegs, bars and straight walls (Ball Drop).
  const obstacles = engine.getObstacles();
  ctx.fillStyle = palette.wall;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (o.kind === "circle") {
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.radius, 0, TWO_PI);
      ctx.fill();
    } else {
      segmentEndpoints(o, ends);
      ctx.lineWidth = Math.max(2, o.thickness);
      ctx.beginPath();
      ctx.moveTo(ends.x1, ends.y1);
      ctx.lineTo(ends.x2, ends.y2);
      ctx.stroke();
    }
  }

  // Balls: the first in the accent, the rest alternating.
  const balls = engine.getBalls();
  for (let i = 0; i < balls.length; i++) {
    const b = balls[i];
    ctx.fillStyle = i % 2 === 0 ? palette.ball : palette.ballAlt;
    ctx.beginPath();
    ctx.arc(b.x, b.y, Math.max(1.5, b.radius), 0, TWO_PI);
    ctx.fill();
  }
}
