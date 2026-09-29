import type { PhysicsEngine } from "@/lib/physics/engine";
import { shapeHalfHeight, shapeHalfWidth, type BoxShape } from "@/lib/physics/modes/box";
import type { Ball } from "@/lib/physics/types";
import { TINY_FACE_RADIUS, faceGeometry, type CharacterRenderOptions, type FaceStyle } from "@/lib/character/character";
import type { Expression } from "@/lib/character/expression";
import { squashAmount, squashScales, type Vec } from "@/lib/character/eyes";
import { CharacterTracker } from "@/lib/character/tracker";
import { chirpAllowed, chirpForExpression, type ChirpKind } from "@/lib/audio/characterVoice";

/**
 * Ball characters on the canvas (lib/character): the vector face – eyes with pupils that look along the flight,
 * the seeded blink and the expressions (ouch, shock, grin, happy) – the cat's ears and whiskers, the name label
 * under the ball and the squash-and-stretch on impact. Everything is drawn procedurally with paths (no bitmaps),
 * scaled with the ball radius, into the simulator canvas, so the recorder – which copies that canvas – exports it.
 *
 * `FaceLayer` is what Canvas.tsx uses: `beginFrame()` once per frame (advances the per-ball CharacterTracker on
 * the simulation clock and reports the expression events the cat face chirps on), then per ball `pushSquash()`
 * (a transform around the body), `drawBehind()` (ears, before the body), `drawFront()` (the face, after it) and
 * `drawLabel()`; the Bouncing Shapes and Pendulum Wave modes draw their own bodies, so `drawOverlays()` puts the
 * faces on them afterwards. `drawFace()` is also what the live preview in the panel paints with.
 */

const TWO_PI = Math.PI * 2;
const EYE_WHITE = "#ffffff";
const PUPIL = "#111114";
const CAT_IRIS = "#c6f432";
const PINK = "#f472b6";
const BLUSH = "rgba(244, 114, 182, 0.42)";
const EAR_INNER = "rgba(249, 168, 212, 0.9)";

/** How a face looks this frame (from the tracker, or made up by the panel preview). */
export interface FaceView {
  expression: Expression;
  /** Blink lid closure, 0 open … 1 shut. */
  closure: number;
  /** Look direction as a fraction of the eye's reach (each axis −1…1). */
  lookX: number;
  lookY: number;
}

const NEUTRAL_VIEW: FaceView = { expression: "neutral", closure: 0, lookX: 0, lookY: 0 };

const inkCache = new Map<string, string>();

/** Dark features on light balls, light features on dark ones (hex and hsl colours; anything else counts as light). */
export function faceInk(color: string): string {
  const cached = inkCache.get(color);
  if (cached) return cached;
  let luminance = 1;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  } else {
    const hsl = /^hsla?\(\s*[\d.]+\s*,\s*[\d.]+%\s*,\s*([\d.]+)%/i.exec(color);
    if (hsl) luminance = Number(hsl[1]) / 100;
  }
  const ink = luminance < 0.36 ? "#f4f4f5" : "#1b1b1f";
  if (inkCache.size > 500) inkCache.clear();
  inkCache.set(color, ink);
  return ink;
}

/** A "<" or ">" squint: `dir` −1 points left, +1 right. */
function squint(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, dir: number) {
  ctx.moveTo(x - dir * 0.6 * size, y - 0.6 * size);
  ctx.lineTo(x + dir * 0.5 * size, y);
  ctx.lineTo(x - dir * 0.6 * size, y + 0.6 * size);
}

/** Draws one eye (white, pupil or closed line) of a detailed face at (ex, ey). */
function drawEye(ctx: CanvasRenderingContext2D, style: FaceStyle, ex: number, ey: number, side: number, r: number, eyeR: number, pupilR: number, reach: number, view: FaceView, ink: string, body: string) {
  const e = view.expression;
  const stroke = Math.max(0.8, 0.07 * r);
  ctx.strokeStyle = ink;
  ctx.lineWidth = stroke;
  if (e === "happy") {
    // Closed, content eyes: a little "∩".
    ctx.beginPath();
    ctx.arc(ex, ey + 0.35 * eyeR, 0.8 * eyeR, 1.15 * Math.PI, 1.85 * Math.PI);
    ctx.stroke();
    return;
  }
  if (e === "ouch") {
    ctx.beginPath();
    squint(ctx, ex, ey, eyeR, -side);
    ctx.stroke();
    return;
  }
  const wide = e === "shock";
  const eR = wide ? 1.3 * eyeR : eyeR;
  const closure = wide ? 0 : view.closure;
  if (closure > 0.55) {
    ctx.beginPath();
    ctx.moveTo(ex - eR, ey);
    ctx.quadraticCurveTo(ex, ey + 0.4 * eR, ex + eR, ey);
    ctx.stroke();
    return;
  }
  const open = 1 - closure;
  ctx.fillStyle = EYE_WHITE;
  ctx.beginPath();
  ctx.ellipse(ex, ey, eR, eR * open, 0, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha *= 0.35;
  ctx.lineWidth = Math.max(0.6, 0.035 * r);
  ctx.stroke();
  ctx.globalAlpha /= 0.35;
  const k = wide ? 0.35 : 1;
  const px = ex + view.lookX * reach * k;
  const py = ey + view.lookY * reach * k * open;
  const pr = wide ? 0.6 * pupilR : pupilR;
  if (style === "cat") {
    ctx.fillStyle = CAT_IRIS;
    ctx.beginPath();
    ctx.ellipse(px, py, 1.25 * pr, 1.25 * pr * open, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = PUPIL;
    ctx.beginPath();
    ctx.ellipse(px, py, wide ? 0.7 * pr : 0.32 * pr, 1.05 * pr * open, 0, 0, TWO_PI);
    ctx.fill();
  } else {
    ctx.fillStyle = PUPIL;
    ctx.beginPath();
    ctx.ellipse(px, py, pr, pr * open, 0, 0, TWO_PI);
    ctx.fill();
  }
  if (style === "cute" || style === "cat") {
    ctx.fillStyle = EYE_WHITE;
    ctx.beginPath();
    ctx.arc(px - 0.35 * pr, py - 0.4 * pr * open, 0.3 * pr, 0, TWO_PI);
    ctx.fill();
  }
  if (style === "cool" && !wide) {
    // Heavy, half-closed lids in the body colour: unimpressed, whatever happens.
    const lidY = ey - 0.05 * eR;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(ex, lidY, 1.12 * eR, 1.12 * eR * open, 0, Math.PI, TWO_PI);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = stroke;
    ctx.beginPath();
    ctx.moveTo(ex - 1.05 * eR, lidY);
    ctx.lineTo(ex + 1.05 * eR, lidY);
    ctx.stroke();
  }
}

/** The mouth of a detailed face for its style and expression, centred at (mx, my), `w` = half width. */
function drawMouth(ctx: CanvasRenderingContext2D, style: FaceStyle, mx: number, my: number, w: number, r: number, e: Expression, ink: string) {
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = Math.max(0.8, 0.065 * r);
  ctx.beginPath();
  if (e === "grin") {
    // A wide open grin with a tongue.
    ctx.moveTo(mx - 1.45 * w, my - 0.3 * w);
    ctx.quadraticCurveTo(mx, my - 0.05 * w, mx + 1.45 * w, my - 0.3 * w);
    ctx.quadraticCurveTo(mx, my + 1.9 * w, mx - 1.45 * w, my - 0.3 * w);
    ctx.fill();
    ctx.fillStyle = PINK;
    ctx.beginPath();
    ctx.ellipse(mx, my + 0.62 * w, 0.55 * w, 0.26 * w, 0, 0, TWO_PI);
    ctx.fill();
    return;
  }
  if (e === "shock") {
    ctx.ellipse(mx, my + 0.1 * w, 0.55 * w, 0.75 * w, 0, 0, TWO_PI);
    ctx.fill();
    return;
  }
  if (e === "ouch") {
    if (style === "angry") {
      // Gritted teeth.
      ctx.fillStyle = EYE_WHITE;
      ctx.rect(mx - 1.1 * w, my - 0.25 * w, 2.2 * w, 0.55 * w);
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, 0.04 * r);
      ctx.stroke();
      ctx.beginPath();
      for (let i = -1; i <= 1; i++) {
        ctx.moveTo(mx + 0.55 * i * w, my - 0.25 * w);
        ctx.lineTo(mx + 0.55 * i * w, my + 0.3 * w);
      }
      ctx.moveTo(mx - 1.1 * w, my + 0.02 * w);
      ctx.lineTo(mx + 1.1 * w, my + 0.02 * w);
      ctx.stroke();
      return;
    }
    // A wobbly "ow".
    ctx.moveTo(mx - 0.9 * w, my + 0.1 * w);
    ctx.quadraticCurveTo(mx - 0.45 * w, my - 0.35 * w, mx, my + 0.1 * w);
    ctx.quadraticCurveTo(mx + 0.45 * w, my + 0.55 * w, mx + 0.9 * w, my + 0.1 * w);
    ctx.stroke();
    return;
  }
  if (style === "cat") {
    // The cat's "w".
    ctx.arc(mx - 0.42 * w, my, 0.42 * w, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.moveTo(mx + 0.84 * w, my + 0.02 * w);
    ctx.arc(mx + 0.42 * w, my, 0.42 * w, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.stroke();
    return;
  }
  if (style === "angry" && e === "neutral") {
    ctx.arc(mx, my + 0.95 * w, w, 1.2 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();
    return;
  }
  if (style === "cool" && e === "neutral") {
    ctx.moveTo(mx - w, my + 0.05 * w);
    ctx.quadraticCurveTo(mx + 0.2 * w, my + 0.45 * w, mx + 1.1 * w, my - 0.35 * w);
    ctx.stroke();
    return;
  }
  // A small smile (cute, dot, and every style at rest).
  ctx.arc(mx, my - 0.45 * w, w, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.stroke();
}

/** Two dots (the "dot" style, and every style on a tiny ball): they look, blink, squint and widen too. */
function drawDotFace(ctx: CanvasRenderingContext2D, fx: number, fy: number, r: number, view: FaceView, ink: string, withMouth: boolean) {
  const g = faceGeometry("dot", r);
  const e = view.expression;
  const dotR = Math.max(0.8, g.eyeR);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.7, 0.07 * r);
  for (let side = -1; side <= 1; side += 2) {
    const ex = fx + side * g.eyeDx + view.lookX * g.maxLook;
    const ey = fy + g.eyeY + view.lookY * g.maxLook;
    ctx.beginPath();
    if (e === "happy") {
      ctx.arc(ex, ey + 0.8 * dotR, 1.4 * dotR, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();
    } else if (e === "ouch") {
      squint(ctx, ex, ey, 1.6 * dotR, -side);
      ctx.stroke();
    } else if (e !== "shock" && view.closure > 0.55) {
      ctx.moveTo(ex - 1.2 * dotR, ey);
      ctx.lineTo(ex + 1.2 * dotR, ey);
      ctx.stroke();
    } else {
      const d = e === "shock" ? 1.4 * dotR : dotR;
      ctx.ellipse(ex, ey, d, d * (e === "shock" ? 1 : 1 - view.closure), 0, 0, TWO_PI);
      ctx.fill();
    }
  }
  if (!withMouth) return;
  const mx = fx;
  const my = fy + g.mouthY;
  const w = g.mouthW;
  ctx.beginPath();
  if (e === "grin") {
    ctx.moveTo(mx - 1.4 * w, my - 0.2 * w);
    ctx.quadraticCurveTo(mx, my + 1.8 * w, mx + 1.4 * w, my - 0.2 * w);
    ctx.closePath();
    ctx.fill();
  } else if (e === "shock" || e === "ouch") {
    ctx.ellipse(mx, my + 0.1 * w, 0.5 * w, (e === "shock" ? 0.7 : 0.4) * w, 0, 0, TWO_PI);
    ctx.fill();
  } else {
    ctx.arc(mx, my - 0.5 * w, w, 0.2 * Math.PI, 0.8 * Math.PI);
    ctx.stroke();
  }
}

export interface DrawFaceOptions {
  /** Eyes only, high on the body (a Bouncing Shapes countdown number sits where the mouth would be). */
  compact?: boolean;
}

/**
 * Draws the face of `style` on a ball of radius `r` at (x, y) with the body colour `body` (the eyelids of "cool"
 * are painted in it; it also picks dark or light features). Does nothing for "none".
 */
export function drawFace(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, style: FaceStyle, view: FaceView, body: string, options?: DrawFaceOptions) {
  if (style === "none" || !(r >= 2.5)) return;
  const ink = faceInk(body);
  const g = faceGeometry(style, r);
  const fx = x + view.lookX * g.faceShift;
  const fy = y + view.lookY * g.faceShift;
  const e = view.expression;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (options?.compact) {
    // Two eyes high up; the rest of the body belongs to the countdown number.
    const eyeR = 0.19 * r;
    for (let side = -1; side <= 1; side += 2) drawEye(ctx, style === "dot" ? "cute" : style, x + side * 0.4 * r + view.lookX * 0.05 * r, y - 0.66 * r, side, r, eyeR, 0.5 * eyeR, 0.35 * eyeR, view, ink, body);
    ctx.restore();
    return;
  }
  if (style === "dot" || r < TINY_FACE_RADIUS) {
    drawDotFace(ctx, fx, fy, r, view, ink, r >= TINY_FACE_RADIUS);
    ctx.restore();
    return;
  }
  if (style === "cute" && (e === "neutral" || e === "happy" || e === "grin")) {
    ctx.fillStyle = BLUSH;
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      ctx.ellipse(fx + side * 0.6 * r, fy + 0.2 * r, 0.14 * r, 0.08 * r, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
  for (let side = -1; side <= 1; side += 2) drawEye(ctx, style, fx + side * g.eyeDx, fy + g.eyeY, side, r, g.eyeR, g.pupilR, g.maxLook, view, ink, body);
  if (style === "angry") {
    // Slanted brows, inner ends low.
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(1, 0.085 * r);
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const ex = fx + side * g.eyeDx;
      const ey = fy + g.eyeY;
      const lift = e === "shock" ? 0.35 * g.eyeR : 0;
      ctx.moveTo(ex + side * 1.05 * g.eyeR, ey - 1.45 * g.eyeR - lift);
      ctx.lineTo(ex - side * 0.35 * g.eyeR, ey - 0.95 * g.eyeR - lift);
    }
    ctx.stroke();
  }
  if (style === "cat") {
    // Nose, whiskers, then the "w" mouth just under the nose.
    ctx.fillStyle = PINK;
    ctx.beginPath();
    ctx.moveTo(fx - 0.075 * r, fy + 0.15 * r);
    ctx.lineTo(fx + 0.075 * r, fy + 0.15 * r);
    ctx.lineTo(fx, fy + 0.235 * r);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = ink;
    ctx.globalAlpha *= 0.55;
    ctx.lineWidth = Math.max(0.6, 0.03 * r);
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      for (let k = -1; k <= 1; k++) {
        ctx.moveTo(fx + side * 0.3 * r, fy + 0.25 * r + k * 0.05 * r);
        ctx.lineTo(fx + side * 0.95 * r, fy + 0.2 * r + k * 0.14 * r);
      }
    }
    ctx.stroke();
    ctx.globalAlpha /= 0.55;
    drawMouth(ctx, style, fx, fy + 0.31 * r, 0.8 * g.mouthW, r, e, ink);
  } else drawMouth(ctx, style, fx, fy + g.mouthY, g.mouthW, r, e, ink);
  ctx.restore();
}

/** The cat's ears, drawn before the body so the body covers their base. */
export function drawCatEars(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, body: string) {
  if (!(r >= 2.5)) return;
  const ink = faceInk(body);
  ctx.save();
  ctx.lineJoin = "round";
  for (let side = -1; side <= 1; side += 2) {
    const c = -Math.PI / 2 + side * 0.62;
    const a0 = c - 0.36;
    const a1 = c + 0.36;
    const apex = c + side * 0.06;
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(a0) * 0.8 * r, y + Math.sin(a0) * 0.8 * r);
    ctx.lineTo(x + Math.cos(apex) * 1.45 * r, y + Math.sin(apex) * 1.45 * r);
    ctx.lineTo(x + Math.cos(a1) * 0.8 * r, y + Math.sin(a1) * 0.8 * r);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha *= 0.3;
    ctx.strokeStyle = ink;
    ctx.lineWidth = Math.max(0.6, 0.04 * r);
    ctx.stroke();
    ctx.globalAlpha /= 0.3;
    ctx.fillStyle = EAR_INNER;
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(c - 0.2) * 0.95 * r, y + Math.sin(c - 0.2) * 0.95 * r);
    ctx.lineTo(x + Math.cos(apex) * 1.3 * r, y + Math.sin(apex) * 1.3 * r);
    ctx.lineTo(x + Math.cos(c + 0.2) * 0.95 * r, y + Math.sin(c + 0.2) * 0.95 * r);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/** Font size of the name label for a ball of radius `r`. */
export function nameLabelSize(r: number): number {
  return Math.max(10, Math.min(24, 0.36 * r + 6));
}

const fontCache = new Map<number, string>();

/** The name under the ball: white text with a subtle dark outline, so it reads on any background. */
export function drawNameLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, r: number) {
  if (!text) return;
  const fs = Math.round(nameLabelSize(r));
  let font = fontCache.get(fs);
  if (!font) {
    font = `600 ${fs}px sans-serif`;
    fontCache.set(fs, font);
  }
  ctx.save();
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  const ty = y + r + 0.3 * fs + 2;
  ctx.lineWidth = Math.max(2, 0.22 * fs);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.6)";
  ctx.strokeText(text, x, ty);
  ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
  ctx.fillText(text, x, ty);
  ctx.restore();
}

/** Face radius on a Bouncing Shapes body (the DVD plate is wider than tall). */
function boxFaceRadius(shape: BoxShape, r: number): number {
  return Math.min(shapeHalfWidth(shape, r), shapeHalfHeight(shape, r));
}

export interface FaceLayerFrame {
  /** The run has started (a finished run makes every character grin). */
  started: boolean;
}

/** Per-frame driver of the characters for Canvas.tsx (see the file comment). */
export class FaceLayer {
  readonly tracker = new CharacterTracker();
  private options: CharacterRenderOptions | null = null;
  private active = false;
  private now = 0;
  private wallBreakPending = false;
  private lastChirpMs = -Infinity;
  private readonly scales: Vec = { x: 1, y: 1 };
  private readonly view: FaceView = { expression: "neutral", closure: 0, lookX: 0, lookY: 0 };
  /** Faces drawn in the current frame and the label shown (mirrored onto the canvas for tools and the smoke test). */
  facesDrawn = 0;
  labelShown = "";

  /** A wall broke (the page forwards every "gap" sound event): every character gets wide eyes. */
  noteWallBreak() {
    this.wallBreakPending = true;
  }

  isActive() {
    return this.active;
  }

  /**
   * Once per frame, before the balls: takes the current options, advances the tracker on the simulation clock and
   * returns the chirp to play for the strongest expression event of the frame (null when none, or when sounds are off).
   */
  beginFrame(engine: PhysicsEngine, options: CharacterRenderOptions | null | undefined, frame: FaceLayerFrame): ChirpKind | null {
    this.facesDrawn = 0;
    this.labelShown = "";
    const o = options ?? null;
    const active = !!o && (o.face !== "none" || o.squash > 0 || o.label !== "");
    if (!active) {
      if (this.active) this.tracker.reset();
      this.active = false;
      this.options = o;
      this.wallBreakPending = false;
      return null;
    }
    if (!this.active) this.tracker.reset();
    this.active = true;
    this.options = o;
    const config = engine.config;
    const extras = engine.getPhysicsExtras();
    const refSpeed = config.ballSpeed || 400;
    const walls = engine.getCircularWalls();
    let escapeRadius = Infinity;
    if (walls.length > 0) {
      const broken = engine.getBrokenWalls();
      escapeRadius = 0;
      for (let i = 0; i < walls.length; i++) if (!broken.has(i) && walls[i].radius > escapeRadius) escapeRadius = walls[i].radius;
    }
    this.now = engine.getElapsedMs();
    this.tracker.update(engine.getBalls(), {
      now: this.now,
      seed: engine.getSeed(),
      refSpeed,
      // Gravity (up to twice as heavy for Ball Drop's weights), wind and drag change the velocity smoothly: never an impact.
      accelAllowance: 2 * Math.abs(config.gravity) * (refSpeed / 300) + (Math.abs(extras.windX) + Math.abs(extras.windY) + 60 * extras.airDrag) * refSpeed,
      wallBreak: this.wallBreakPending,
      finished: frame.started && engine.isSimulationFinished(),
      centerX: config.width / 2,
      centerY: config.height / 2,
      escapeRadius,
    });
    this.wallBreakPending = false;
    if (!o.sounds) return null;
    const chirp = chirpForExpression(this.tracker.triggered);
    if (!chirp || !chirpAllowed(this.lastChirpMs, this.now)) return null;
    this.lastChirpMs = this.now;
    return chirp;
  }

  private viewOf(ball: Ball): FaceView {
    const st = this.tracker.get(ball.id);
    if (!st) return NEUTRAL_VIEW;
    const v = this.view;
    v.expression = st.expression.expression;
    v.closure = st.closure;
    v.lookX = st.lookX;
    v.lookY = st.lookY;
    return v;
  }

  /**
   * Squash-and-stretch: when the ball is wobbling after an impact, saves the context and applies a scale along the
   * impact normal, pivoting on the side that hit. Returns true when the caller must `ctx.restore()` after the body.
   */
  pushSquash(ctx: CanvasRenderingContext2D, ball: Ball): boolean {
    const o = this.options;
    if (!this.active || !o || !(o.squash > 0)) return false;
    const st = this.tracker.get(ball.id);
    if (!st) return false;
    const d = squashAmount(this.now - st.impactAt, st.impactStrength, o.squash);
    if (Math.abs(d) < 0.004) return false;
    squashScales(d, this.scales);
    const px = ball.x - st.impactNx * ball.radius;
    const py = ball.y - st.impactNy * ball.radius;
    const angle = Math.atan2(st.impactNy, st.impactNx);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.scale(this.scales.x, this.scales.y);
    ctx.rotate(-angle);
    ctx.translate(-px, -py);
    return true;
  }

  private faceShown(hasSprite: boolean): boolean {
    const o = this.options;
    return this.active && !!o && o.face !== "none" && (!hasSprite || o.faceOverImage);
  }

  /** Before the body: the cat's ears. */
  drawBehind(ctx: CanvasRenderingContext2D, ball: Ball, body: string, hasSprite: boolean, index: number) {
    if (index >= this.tracker.count || !this.faceShown(hasSprite) || this.options?.face !== "cat") return;
    drawCatEars(ctx, ball.x, ball.y, ball.radius, body);
  }

  /** After the body: the face. */
  drawFront(ctx: CanvasRenderingContext2D, ball: Ball, body: string, hasSprite: boolean, index: number) {
    if (index >= this.tracker.count || !this.faceShown(hasSprite)) return;
    drawFace(ctx, ball.x, ball.y, ball.radius, this.options!.face, this.viewOf(ball), body);
    this.facesDrawn++;
  }

  /** The name label – under the first ball only (the main character). */
  drawLabel(ctx: CanvasRenderingContext2D, ball: Ball, index: number) {
    const o = this.options;
    if (!this.active || !o || !o.label || index !== 0) return;
    drawNameLabel(ctx, o.label, ball.x, ball.y, ball.radius);
    this.labelShown = o.label;
  }

  /**
   * Faces and the label on bodies another renderer drew (Bouncing Shapes, Pendulum Wave). With a countdown number
   * on a square or circle the face is reduced to two eyes above the number; a DVD plate with a number stays plain.
   */
  drawOverlays(ctx: CanvasRenderingContext2D, balls: readonly Ball[], bodyColor: (ball: Ball) => string, box: { shape: BoxShape; countdown: boolean } | null) {
    const o = this.options;
    if (!this.active || !o) return;
    const faces = o.face !== "none" && !(box && box.countdown && box.shape === "dvd");
    const n = Math.min(balls.length, this.tracker.count);
    if (faces) {
      for (let i = 0; i < n; i++) {
        const ball = balls[i];
        const r = box ? boxFaceRadius(box.shape, ball.radius) : ball.radius;
        drawFace(ctx, ball.x, ball.y, r, o.face, this.viewOf(ball), bodyColor(ball), box?.countdown ? { compact: true } : undefined);
        this.facesDrawn++;
      }
    }
    if (o.label && balls.length > 0) {
      const ball = balls[0];
      drawNameLabel(ctx, o.label, ball.x, ball.y, box ? shapeHalfHeight(box.shape, ball.radius) : ball.radius);
      this.labelShown = o.label;
    }
  }

  /** The expression of the first ball ("" without an active character). */
  primaryExpression(): string {
    return this.active ? this.tracker.primaryExpression : "";
  }

  face(): FaceStyle | "" {
    return this.active && this.options ? this.options.face : "";
  }
}
