import type { Ball, GameMode, Gap, ModeContext, WallHitResult } from "../types";
import { arenaRadius, TWO_PI } from "../types";
import { linesKey, linesKeyFrequency } from "./lines"; // --- portal-charges --- (the ring's keyboard)

export interface Portal {
  id: number;
  color: string;
  angleA: number;
  angleB: number;
  halfWidth: number;
  uses: number;
  maxUses: number;
  exhausted: boolean;
  /** --- portal-charges --- When the portal burnt out (simulation ms; −Infinity while it holds a charge): the canvas crumbles it. */
  burnMs: number;
}

export const PORTAL_COLORS = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#6c5ce7", "#00b894"];

// --- portal-charges ---
/** Each portal's teleport note (C5 E5 G5 A5 C6, by its colour), swept up an octave in PORTAL_ZIP_SEC, and its level. */
export const PORTAL_NOTES_HZ: readonly number[] = [523.25, 659.25, 783.99, 880, 1046.5];
export const PORTAL_ZIP_SEC = 0.16;
export const PORTAL_ZIP_LEVEL = 0.4;
/** A portal burning out: a low thud (Hz) at this level. */
export const PORTAL_THUD_HZ = 70;
export const PORTAL_THUD_LEVEL = 0.4;
/** A bounce off the ring: the loop family's pluck of the key under it (Lines' circular keyboard) at this level, not a blip. */
export const PORTAL_PLUCK_LEVEL = 0.8;

/** The last teleport, for the canvas' beam between the twins and its flash (the same object every call). */
export interface PortalJump {
  /** The portal used (−1 before the first jump), the angles the ball went in at and came out of, and when (simulation ms). */
  portal: number;
  fromAngle: number;
  toAngle: number;
  ms: number;
}
// --- end portal-charges ---

/** The exit a burnt-out portal at `angle` leaves in the ring: its start normalised into [0, 2π). */
function portalGap(angle: number, halfWidth: number): Gap {
  const start = (((angle - halfWidth) % TWO_PI) + TWO_PI) % TWO_PI;
  return { startAngle: start, endAngle: start + 2 * halfWidth };
}

/** Portal: colour-matched portal pairs teleport the ball; used-up portals become gaps. */
export class PortalMode implements GameMode {
  readonly name = "portal";
  private portals: Portal[] = [];
  private portalCount = 3;
  private teleportCount = 0;
  private escaped = false;
  private lastTeleportSimTime = 0;
  private readonly teleportCooldown = 150;
  /** --- portal-charges --- The last jump and when the ball escaped (simulation ms; −Infinity before). */
  private readonly jump: PortalJump = { portal: -1, fromAngle: 0, toAngle: 0, ms: -Infinity };
  private escapedMs = -Infinity;

  init(ctx: ModeContext) {
    this.teleportCount = 0;
    this.escaped = false;
    this.lastTeleportSimTime = 0;
    // --- portal-charges ---
    this.jump.portal = -1;
    this.jump.ms = -Infinity;
    this.escapedMs = -Infinity;
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    this.generatePortals(ctx);
  }
  /**
   * The portals sit at fixed angles (the canvas draws them there and `isAngleInPortal()` tests world angles), so the ring
   * does not turn: the exits a burnt-out portal leaves stay where the portal was. Runs in every fixed step after the
   * engine advanced the rotations and before the sub-steps, so the collisions and the canvas both see rotation 0.
   */
  onPreUpdate(ctx: ModeContext) {
    const rot = ctx.getWallRotations();
    if (rot.length > 0) rot[0] = 0;
  }
  onBallStep() {}
  onPostSubStep() {}
  onWallHit(ctx: ModeContext, ball: Ball, wallIndex: number, angle: number): WallHitResult | void {
    if (this.escaped) return;
    const now = ctx.getElapsedMs();
    if (now - this.lastTeleportSimTime < this.teleportCooldown) return this.bounceNote(ctx, wallIndex, angle);
    for (const portal of this.portals) {
      if (portal.exhausted) continue;
      const side = this.isAngleInPortal(angle, portal.angleA, portal.halfWidth)
        ? "A"
        : this.isAngleInPortal(angle, portal.angleB, portal.halfWidth)
          ? "B"
          : null;
      if (!side) continue;
      const exitAngle = side === "A" ? portal.angleB : portal.angleA;
      const wall = ctx.getCircularWalls()[0];
      if (!wall) return;
      const cx = ctx.config.width / 2;
      const cy = ctx.config.height / 2;
      const r = wall.radius - ball.radius - 5;
      ball.x = cx + Math.cos(exitAngle) * r;
      ball.y = cy + Math.sin(exitAngle) * r;
      const speed = Math.max(Math.hypot(ball.vx, ball.vy), ctx.config.ballSpeed || 400);
      const spread = 0.4 * Math.PI;
      const dir = exitAngle + Math.PI + (ctx.random() - 0.5) * spread;
      ball.vx = Math.cos(dir) * speed;
      ball.vy = Math.sin(dir) * speed;
      portal.uses++;
      this.teleportCount++;
      this.lastTeleportSimTime = now;
      ctx.spawnConfetti(ball.x, ball.y);
      // --- portal-charges --- the jump: the beam between the twins, the ball's trail broken where it jumped (no streak across the
      // ring), and a zip up from the portal's own note (a visitor's own sound plays the plain break it was: ringVoice "contact")
      this.jump.portal = portal.id;
      this.jump.fromAngle = side === "A" ? portal.angleA : portal.angleB;
      this.jump.toAngle = exitAngle;
      this.jump.ms = now;
      ball.trail.length = 0;
      const note = PORTAL_NOTES_HZ[portal.id % PORTAL_NOTES_HZ.length];
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0, loop: "glide", frequency: note, loopTo: 2 * note, loopSec: PORTAL_ZIP_SEC, level: PORTAL_ZIP_LEVEL, ringVoice: "contact" });
      if (portal.uses >= portal.maxUses) {
        portal.exhausted = true;
        portal.burnMs = now; // --- portal-charges --- (the canvas crumbles it, and a thud: decorative, the crew's moments leave it out)
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "land", frequency: PORTAL_THUD_HZ, level: PORTAL_THUD_LEVEL, melody: false, ringVoice: "extra" });
        this.rebuildWallGaps(ctx);
      }
      return { suppressBounce: true, suppressGlow: true };
    }
    return this.bounceNote(ctx, wallIndex, angle); // --- portal-charges ---
  }

  // --- portal-charges ---
  /**
   * A plain bounce off the ring plays the pluck of the key under it (the engine's blip is left out; a visitor's own sound plays that
   * plain hit instead: ringVoice "contact"). A jump keeps the engine's hit under its zip, as before.
   */
  private bounceNote(ctx: ModeContext, wallIndex: number, angle: number): WallHitResult {
    ctx.addPendingSoundEvent({ type: "hit", wallIndex, loop: "pluck", frequency: linesKeyFrequency(linesKey(angle)), level: PORTAL_PLUCK_LEVEL, melody: false, ringVoice: "contact" });
    return { suppressSound: true };
  }
  // --- end portal-charges ---
  onGapPass() {
    return false;
  }
  onPostUpdate(ctx: ModeContext) {
    if (this.escaped) return;
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    const ball = ctx.getBalls()[0];
    if (!ball) return;
    const cx = ctx.config.width / 2;
    const cy = ctx.config.height / 2;
    if (Math.hypot(ball.x - cx, ball.y - cy) > walls[0].radius + ball.radius + 10) {
      this.escaped = true;
      this.escapedMs = ctx.getElapsedMs(); // --- portal-charges ---
      ctx.getBrokenWalls().add(0);
      ctx.spawnConfetti(ball.x, ball.y);
      ctx.addPendingSoundEvent({ type: "gap", wallIndex: 0 });
    }
  }
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      ctx.setCircularWalls([{ radius: arenaRadius(ctx.config), gaps: this.buildGaps() }]);
      ctx.setWallRotations([0]);
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
    return { portals: this.portals, portalTeleportCount: this.teleportCount, portalEscaped: this.escaped };
  }
  getPortals() {
    return this.portals;
  }
  getTeleportCount() {
    return this.teleportCount;
  }
  hasEscaped() {
    return this.escaped;
  }
  // --- portal-charges ---
  /** The last jump (the same object every call), for the canvas' beam. */
  getLastJump(): PortalJump {
    return this.jump;
  }
  /** When the ball got out (simulation ms; −Infinity before). */
  getEscapedMs() {
    return this.escapedMs;
  }
  // --- end portal-charges ---
  getPortalCount() {
    return this.portalCount;
  }
  setPortalCount(n: number) {
    this.portalCount = n;
  }

  private generatePortals(ctx: ModeContext) {
    this.portals = [];
    const slots = 2 * this.portalCount;
    const step = TWO_PI / slots;
    const angles: number[] = [];
    const offset = ctx.random() * TWO_PI;
    for (let i = 0; i < slots; i++) angles.push((offset + i * step) % TWO_PI);
    for (let i = angles.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.random() * (i + 1));
      [angles[i], angles[j]] = [angles[j], angles[i]];
    }
    for (let i = 0; i < this.portalCount; i++) {
      this.portals.push({
        id: i,
        color: PORTAL_COLORS[i % PORTAL_COLORS.length],
        angleA: angles[2 * i],
        angleB: angles[2 * i + 1],
        halfWidth: 0.12,
        uses: 0,
        maxUses: 4,
        exhausted: false,
        burnMs: -Infinity, // --- portal-charges ---
      });
    }
  }

  private isAngleInPortal(angle: number, center: number, halfWidth: number) {
    let d = angle - center;
    while (d > Math.PI) d -= TWO_PI;
    while (d < -Math.PI) d += TWO_PI;
    return Math.abs(d) <= halfWidth;
  }

  private rebuildWallGaps(ctx: ModeContext) {
    const walls = ctx.getCircularWalls();
    if (walls.length === 0) return;
    ctx.setCircularWalls([{ radius: walls[0].radius, gaps: this.buildGaps() }]);
    ctx.setWallRotations([0]);
  }

  /**
   * The exits of the burnt-out portals, as the canvas draws a ring's gaps: each starting in [0, 2π), sorted by start. A gap
   * across 0 stays one gap ending above 2π (the engine's gap test wraps it; split in two, each half would be too narrow to
   * count as passable).
   */
  private buildGaps(): Gap[] {
    const gaps: Gap[] = [];
    for (const p of this.portals) {
      if (!p.exhausted) continue;
      gaps.push(portalGap(p.angleA, p.halfWidth));
      gaps.push(portalGap(p.angleB, p.halfWidth));
    }
    gaps.sort((a, b) => a.startAngle - b.startAngle);
    return gaps;
  }
}
