import { MAX_WOBBLE_WALLS, WOBBLE_QUIET, WOBBLE_SAMPLES, WOBBLE_STEP, WobbleField, sampleAt, wobbleAmplitudePx, type WallContactLog } from "@/lib/physics/wobble";

const TWO_PI = Math.PI * 2;

/**
 * Canvas side of the wobbly walls (feature jdm-illusions; lib/physics/wobble.ts has the maths). One `WobbleLayer` lives
 * with the draw loop: `beginFrame()` copies the contacts the engine logged since the last frame into its field and fixes
 * the frame's simulation time and amount; the wall drawing of Canvas.tsx (the rings of the ring modes, Shatter's and
 * Color Match's segments, Target's, the wall glow) and the Circle Illusion renderer then trace every wall that is
 * wobbling through its 64 displaced samples instead of a plain arc. A wall that is still – or Wobbly Walls at 0 – is
 * reported as such (`active()` false, the helpers return false), so the canvas keeps drawing it exactly as before.
 * Each wall is sampled at most once per frame and nothing is allocated per frame after the first samples of a wall.
 */
export class WobbleLayer {
  private readonly field = new WobbleField();
  private readonly samples: (Float32Array | undefined)[] = [];
  private readonly stamp = new Int32Array(MAX_WOBBLE_WALLS).fill(-1);
  private readonly peak = new Float32Array(MAX_WOBBLE_WALLS);
  private readonly counted = new Uint8Array(MAX_WOBBLE_WALLS);
  private frame = 0;
  private amount = 0;
  private nowMs = 0;
  /** Walls drawn wobbling this frame (mirrored into data-wobble for tools and the smoke test). */
  wobbling = 0;
  /** Largest displacement (px) drawn this frame. */
  maxPx = 0;
  /** Largest displacement drawn this run (since the contact log's last restart): px, and as a share of that wall's full amplitude (at most 1 – the field saturates). */
  runMaxPx = 0;
  runPeak = 0;
  private generation = -1;

  /**
   * Starts a frame: the contacts `log` gained (always copied, so switching the wobble on mid-run shows the waves already
   * travelling), the simulation time `nowMs` the waves are sampled at and the Wobbly Walls `amount` (0 = off).
   */
  beginFrame(log: WallContactLog | null, nowMs: number, amount: number) {
    this.frame++;
    if (this.frame > 1e9) {
      this.frame = 1;
      this.stamp.fill(-1);
    }
    this.nowMs = nowMs;
    this.amount = amount > 0 ? Math.min(1, amount) : 0;
    this.wobbling = 0;
    this.maxPx = 0;
    this.counted.fill(0);
    if (log) {
      if (log.generation !== this.generation) {
        this.generation = log.generation;
        this.runMaxPx = 0;
        this.runPeak = 0;
      }
      this.field.sync(log);
    }
  }

  /** True while Wobbly Walls is on (or the mode wobbles by itself). */
  get on(): boolean {
    return this.amount > 0;
  }

  /** The displaced samples of wall `index` this frame, or null when it is still (or the wobble is off). */
  private samplesOf(index: number): Float32Array | null {
    if (this.amount <= 0 || !(index >= 0 && index < MAX_WOBBLE_WALLS)) return null;
    if (this.stamp[index] !== this.frame) {
      this.stamp[index] = this.frame;
      if (!this.field.isLive(index, this.nowMs)) this.peak[index] = 0;
      else {
        let buf = this.samples[index];
        if (!buf) {
          buf = new Float32Array(WOBBLE_SAMPLES);
          this.samples[index] = buf;
        }
        this.peak[index] = this.field.sample(index, this.nowMs, buf);
      }
    }
    if (this.peak[index] < WOBBLE_QUIET) return null;
    return this.samples[index] ?? null;
  }

  private note(index: number, amp: number) {
    if (!this.counted[index]) {
      this.counted[index] = 1;
      this.wobbling++;
    }
    const px = amp * this.peak[index];
    if (px > this.maxPx) this.maxPx = px;
    if (px > this.runMaxPx) this.runMaxPx = px;
    if (this.peak[index] > this.runPeak) this.runPeak = this.peak[index];
  }

  /** True when wall `index` wobbles this frame. */
  active(index: number): boolean {
    return this.samplesOf(index) !== null;
  }

  /**
   * Adds the displaced arc of wall `index` (base radius `radius` around cx, cy) from `a0` to `a1` (radians; a1 < a0 runs
   * backwards) to the current path – starting with `lineTo` when `join`, like `ctx.arc()` does after a current point,
   * else with `moveTo`. Returns false and adds nothing when the wall is still.
   */
  traceArc(ctx: CanvasRenderingContext2D, index: number, cx: number, cy: number, radius: number, a0: number, a1: number, join = false, amplitudeRadius = radius): boolean {
    const s = this.samplesOf(index);
    if (!s) return false;
    const amp = wobbleAmplitudePx(this.amount, amplitudeRadius);
    this.note(index, amp);
    const span = a1 - a0;
    const n = Math.max(1, Math.ceil(Math.abs(span) / WOBBLE_STEP));
    for (let k = 0; k <= n; k++) {
      const a = a0 + (span * k) / n;
      const r = radius + amp * sampleAt(s, a);
      const x = cx + r * Math.cos(a);
      const y = cy + r * Math.sin(a);
      if (k === 0 && !join) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    return true;
  }

  /** `ctx.arc()` that follows the wall's wobble: the displaced arc when wall `index` wobbles, the plain arc otherwise. */
  pathArc(ctx: CanvasRenderingContext2D, index: number, cx: number, cy: number, radius: number, a0: number, a1: number) {
    if (!this.traceArc(ctx, index, cx, cy, radius, a0, a1)) ctx.arc(cx, cy, radius, a0, a1);
  }

  /** Strokes the displaced arc (its own path) with the current stroke style when wall `index` wobbles; false – nothing drawn – when it is still. */
  strokeArc(ctx: CanvasRenderingContext2D, index: number, cx: number, cy: number, radius: number, a0: number, a1: number): boolean {
    if (!this.active(index)) return false;
    ctx.beginPath();
    this.traceArc(ctx, index, cx, cy, radius, a0, a1);
    ctx.stroke();
    return true;
  }

  /**
   * Fills the annular sector between `rIn` and `rOut` from `a0` to `a1` (its own path, the current fill style), both
   * edges displaced like the wall of radius `wallRadius`, when wall `index` wobbles; false – nothing drawn – when it is still.
   */
  fillSector(ctx: CanvasRenderingContext2D, index: number, cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number, wallRadius: number): boolean {
    if (!this.active(index)) return false;
    ctx.beginPath();
    this.traceArc(ctx, index, cx, cy, rOut, a0, a1, false, wallRadius);
    this.traceArc(ctx, index, cx, cy, rIn, a1, a0, true, wallRadius);
    ctx.closePath();
    ctx.fill();
    return true;
  }

  /** Adds wall `index` as a closed circle – displaced when it wobbles – to the current path. */
  traceCircle(ctx: CanvasRenderingContext2D, index: number, cx: number, cy: number, radius: number) {
    if (!this.traceArc(ctx, index, cx, cy, radius, 0, TWO_PI)) {
      ctx.moveTo(cx + radius, cy);
      ctx.arc(cx, cy, radius, 0, TWO_PI);
    }
    ctx.closePath();
  }
}
