import type { Ball, GameMode, ModeContext, WallHitResult } from "../types";
import { arenaRadius, TWO_PI } from "../types";
import { memoryCeiling } from "@/lib/uncap"; // --- review fix (uncap-all) ---
import { RING_CHORD_HZ } from "../ringEscape";
import { colourChordHz, colourNoteHz } from "../ringVoices"; // --- ring-voices ---

export interface ColorMatchSegment {
  index: number;
  startAngle: number;
  endAngle: number;
  color: string;
  hue: number;
  /** --- review fix (uncap-all) --- The colour's index (the ball matches a segment of its own index: any number of colours). */
  colorIndex: number;
  broken: boolean;
  /** --- ring-voices --- Simulation time (ms) the segment broke (−1: it stands): the canvas bursts it from then. */
  brokenMs: number;
}

/** --- colour-match-segments --- The ring's segment counts a visitor can pick (the Segments control; the mode holds 6–24). */
export const COLOR_MATCH_SEGMENT_CHOICES = [6, 8, 12, 16, 24] as const;
/** The count the mode runs without a setting (every old link, and the fingerprint's run). */
export const DEFAULT_COLOR_MATCH_SEGMENTS = 12;

export function isColorMatchSegments(value: unknown): value is number {
  return typeof value === "number" && (COLOR_MATCH_SEGMENT_CHOICES as readonly number[]).includes(value);
}

export const COLOR_MATCH_COLORS = [
  { hue: 0, color: "#ef4444" },
  { hue: 30, color: "#f97316" },
  { hue: 60, color: "#eab308" },
  { hue: 120, color: "#22c55e" },
  { hue: 200, color: "#3b82f6" },
  { hue: 270, color: "#a855f7" },
  { hue: 330, color: "#ec4899" },
];

/** Two hex digits of a channel 0…1. */
function hex2(v: number): string {
  return Math.round(Math.max(0, Math.min(1, v)) * 255)
    .toString(16)
    .padStart(2, "0");
}

/**
 * --- review fix (uncap-all) --- Colour `index` of a Color Match run with any number of colours: the seven of the palette,
 * then hues a golden angle apart (bright and saturated, distinct from their neighbours) – the Color Count has no maximum
 * but its memory-safety ceiling. Pure; the mode caches the ball's current one.
 */
export function colorMatchColor(index: number): { hue: number; color: string } {
  if (index >= 0 && index < COLOR_MATCH_COLORS.length) return COLOR_MATCH_COLORS[index];
  const hue = (index * 137.50776405) % 360;
  // HSL(hue, 85 %, 58 %) → RGB
  const s = 0.85;
  const l = 0.58;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { hue, color: `#${hex2(f(0))}${hex2(f(8))}${hex2(f(4))}` };
}

// --- review fix (B2) --- spread hues
/**
 * The palette entries a run of `count` colours (2–6) shows, spread round the colour wheel so dimmed segments of two colours
 * never read as one brown: red and blue, red, green and blue, then yellow and purple join, orange last. Seven or more use the
 * palette in order (the fingerprint's recipe and the bot's template run seven).
 */
const SPREAD_SLOTS: Record<number, readonly number[]> = { 2: [0, 4], 3: [0, 3, 4], 4: [0, 2, 3, 4], 5: [0, 2, 3, 4, 5], 6: [0, 1, 2, 3, 4, 5] };

/**
 * Colour `index` of a run of `count` colours, as it is drawn: the logic only ever compares indices (a ball matches a segment of
 * its own index) and the sounds follow the index, so this changes nothing but the paint.
 */
export function colorMatchColorOf(index: number, count: number): { hue: number; color: string } {
  const slots = SPREAD_SLOTS[count];
  return colorMatchColor(slots && index >= 0 && index < slots.length ? slots[index] : index);
}
// --- end review fix (B2) ---

/** Color Match: the ball changes colour on every bounce and only breaks matching segments. */
export class ColorMatchMode implements GameMode {
  readonly name = "colorMatch";
  private segments: ColorMatchSegment[] = [];
  private segmentCount = 12;
  private colorCount = 7;
  private ballColorIndex = 0;
  /** The ball's colour (`colorMatchColor(ballColorIndex)`, kept so a frame's reads allocate nothing). */
  private ballColor = COLOR_MATCH_COLORS[0];
  private escaped = false;
  private matchCount = 0;

  init(ctx: ModeContext) {
    this.escaped = false;
    this.matchCount = 0;
    this.ballColorIndex = Math.floor(ctx.random() * this.colorCount);
    this.ballColor = colorMatchColorOf(this.ballColorIndex, this.colorCount); // --- review fix (B2) --- (hues spread for a few colours)
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.buildSegments(ctx);
  }
  getSegments() {
    return this.segments;
  }
  getBallColorIndex() {
    return this.ballColorIndex;
  }
  getBallColor() {
    return this.ballColor.color;
  }
  getBallHue() {
    return this.ballColor.hue;
  }
  getMatchCount() {
    return this.matchCount;
  }
  hasEscaped() {
    return this.escaped;
  }
  getSegmentCount() {
    return this.segmentCount;
  }
  setSegmentCount(n: number) {
    this.segmentCount = Math.max(6, Math.min(24, n));
  }
  getColorCount() {
    return this.colorCount;
  }
  /**
   * --- review fix (uncap-all) --- From 2, no maximum but the colours' memory-safety ceiling (ARENA FULL past it): past the
   * palette's seven the colours are generated by hue (`colorMatchColor()`).
   */
  setColorCount(n: number) {
    const count = Number.isFinite(n) ? Math.round(n) : 7;
    this.colorCount = Math.max(2, memoryCeiling("colorMatchColorCount", count));
  }
  getTotalSegments() {
    return this.segments.length;
  }
  getBrokenCount() {
    return this.segments.filter((s) => s.broken).length;
  }
  onPreUpdate() {}
  onBallStep() {}
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void {
    let local = (angle - (ctx.getWallRotations()[wallIndex] || 0)) % TWO_PI;
    if (local < 0) local += TWO_PI;
    const segment = this.segments[Math.floor(local / (TWO_PI / this.segmentCount))];
    if (!segment) return;
    if (segment.broken) {
      // --- ring-voices --- a bounce off the bare ring where a segment was: the ball's own colour, an octave down and soft
      ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: colourNoteHz(this.ballColorIndex) / 2, level: 0.35, melody: false, ringVoice: "contact" });
      return { suppressSound: true };
    }
    // --- rigged --- the last intact segment of a ring the rig keeps closed to this ball does not break: the ring never opens
    const lastHeld = this.matchCount >= this.segments.length - 1 && ctx.isWallSealed?.(ball, wallIndex) === true;
    if (segment.colorIndex === this.ballColorIndex && !lastHeld) {
      segment.broken = true;
      segment.brokenMs = ctx.getElapsedMs();
      this.matchCount++;
      ctx.setBounceSpeedMultiplier(1);
      ctx.spawnWallBreakByStyle(wallIndex, ball.x, ball.y);
      // --- ring-voices --- a match is the colour's own note with its triad struck over it – the last one with the chord as the
      // ring opens. A "hit" and a "gap" event, as a match always sent (the bounce and the break): the camera's shake, the
      // finder and the teams' counts read them as before.
      const all = this.segments.every((s) => s.broken);
      const triad = colourChordHz(this.ballColorIndex);
      ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: triad[0], level: 1, loopBright: true, melody: false, ringVoice: "contact" });
      if (all) ctx.addPendingSoundEvent({ type: "gap", wallIndex, loop: "chord", frequency: RING_CHORD_HZ, level: 1, melody: false, ringVoice: "contact" });
      else ctx.addPendingSoundEvent({ type: "gap", wallIndex, loop: "impact", frequency: triad[0], chord: triad, level: 0.8, melody: false, ringVoice: "contact" });
      ctx.creditWallBreak?.(ball); // --- teams --- the segment counts for the ball that broke it
      if (all) ctx.getBrokenWalls().add(wallIndex);
      return { resetBouncier: true, suppressSound: true };
    }
    this.ballColorIndex = (this.ballColorIndex + 1) % this.colorCount;
    this.ballColor = colorMatchColorOf(this.ballColorIndex, this.colorCount); // --- review fix (B2) --- (hues spread for a few colours)
    // --- ring-voices --- the bounce plays the colour the ball turns: the cycle of colours is a scale
    ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: colourNoteHz(this.ballColorIndex), level: 0.6, melody: false, ringVoice: "contact" });
    return { suppressSound: true };
  }
  onGapPass() {
    return true;
  }
  onPostUpdate(ctx: ModeContext) {
    if (this.escaped) return;
    const balls = ctx.getBalls();
    if (balls.length === 0) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    for (const b of balls) {
      if (Math.hypot(b.x - cx, b.y - cy) > walls[0].radius + b.radius + 30) {
        this.escaped = true;
        break;
      }
    }
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      const r = arenaRadius(ctx.config);
      const walls = ctx.getCircularWalls();
      if (walls.length > 0) walls[0].radius = r;
      else {
        ctx.setCircularWalls([{ radius: r, gaps: [] }]);
        ctx.setWallRotations([0]);
      }
    }
    return true;
  }
  shouldSkipWallCollision() {
    return false;
  }
  isFinished() {
    return this.escaped;
  }
  getState() {
    return { segments: this.segments, ballColorIndex: this.ballColorIndex, matchCount: this.matchCount };
  }

  private buildSegments(ctx: ModeContext) {
    ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: [] }]);
    ctx.setWallRotations([0]);
    const step = TWO_PI / this.segmentCount;
    this.segments = [];
    for (let i = 0; i < this.segmentCount; i++) {
      const colorIndex = i % this.colorCount;
      const c = colorMatchColorOf(colorIndex, this.colorCount); // --- review fix (B2) ---
      this.segments.push({ index: i, startAngle: i * step, endAngle: (i + 1) * step, color: c.color, hue: c.hue, colorIndex, broken: false, brokenMs: -1 });
    }
  }
}
