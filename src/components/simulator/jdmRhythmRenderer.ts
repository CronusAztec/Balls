import { CAMERA_AT, FINISH_HOLD_SEC, MAX_RR_PARTICLES, RR_PARTICLE_GRAVITY, RR_TRAIL, VIEW_UNITS, type RunnerView } from "@/lib/physics/modes/runner";
import { GAME_OVER_HOLD_SEC, MAX_PD_PARTICLES, PD_ASPECT, PD_CEILING, PD_PLATFORM, PD_THICKNESS, type PaddleView } from "@/lib/physics/modes/paddle";

/**
 * Canvas side of feature jdm-rhythm-runner (lib/physics/modes/runner.ts and paddle.ts have the physics).
 *
 * `RunnerLayer` – the Beat Runner in a Geometry Dash look: `applyCamera()` scrolls the world sideways with the square
 * (Canvas.tsx drops the Camera Follow / cinematic view for it, like the race and Glass Smash); `drawWorld()` (world space,
 * under the square) draws a beat-pulsing grid, the floor with its pits, the blocks, the spike rows, a marker on every
 * landing spot (lit once it is cleared), the checkpoints of a hand-played run and the checkered finish; `drawBodies()`
 * the trail and the rotating square (squashed for a moment on every landing); `drawParticles()` the landing dust, the
 * crash debris and the finish sparks; `drawOverlay()` (screen space, inside the square the recorder crops to) the progress
 * bar with its percentage, the tempo badge, the attempt counter, the "SPACE to jump" hint and the "LEVEL COMPLETE!"
 * banner. Only what is in view is drawn.
 *
 * `PaddleLayer` – Paddle Keep-Up: `drawWorld()` the field (walls and ceiling glowing where the ball touched them, the
 * miss zone), the platform (flashing and dipping on a catch) and the sparks; the ball is the canvas' own ball pass (trail,
 * glow, face, emoji); `drawOverlay()` the score, the lives, the streak, "MISS!" and the "GAME OVER" banner.
 */

export interface JdmRhythmLabels {
  complete: string;
  completeSub: (jumps: number, onBeat: number, landings: number) => string;
  attempt: (n: number) => string;
  auto: string;
  jumpHint: string;
  bpm: (bpm: number) => string;
  score: string;
  miss: string;
  gameOver: string;
  gameOverSub: (hits: number, best: number) => string;
  streak: (n: number) => string;
  moveHint: string;
}

export const DEFAULT_JDM_RHYTHM_LABELS: JdmRhythmLabels = {
  complete: "LEVEL COMPLETE!",
  completeSub: (jumps, onBeat, landings) => `${jumps} jumps · ${onBeat}/${landings} landings on the beat`,
  attempt: (n) => `ATTEMPT ${n}`,
  auto: "AUTO",
  jumpHint: "SPACE to jump",
  bpm: (bpm) => `♩ ${bpm} BPM`,
  score: "SCORE",
  miss: "MISS!",
  gameOver: "GAME OVER",
  gameOverSub: (hits, best) => `Score ${hits} · best streak ${best}`,
  streak: (n) => `${n} in a row`,
  moveHint: "← → or the pointer moves the platform",
};

export interface JdmRhythmRenderOptions {
  /** The wall colour (the Wall section's colour or the rainbow): floor lines, blocks, spikes, walls, ceiling, platform. */
  wallColor: (index: number, alpha?: number, angle?: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  showGlow: boolean;
  showTrails: boolean;
  /** The square's colour (the Ball colour, or the rainbow). */
  bodyColor: string;
}

const GOLD = "#fde047";
const TWO_PI = Math.PI * 2;

function bannerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, color: string) {
  ctx.font = `900 ${fs}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, 0.12 * fs);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.strokeText(text, x, y);
  ctx.shadowColor = color;
  ctx.shadowBlur = 20;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.shadowBlur = 0;
}

function subText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, color = "#f4f4f5") {
  ctx.font = `700 ${fs}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, 0.14 * fs);
  ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/** Fits a font size so `text` is at most `maxWidth` wide (bold). */
function fitFont(ctx: CanvasRenderingContext2D, text: string, fs: number, maxWidth: number, weight = 900): number {
  ctx.font = `${weight} ${fs}px sans-serif`;
  const w = ctx.measureText(text).width;
  return w > maxWidth ? (fs * maxWidth) / Math.max(1, w) : fs;
}

/* ------------------------------------------------------------------ Beat Runner */

export class RunnerLayer {
  /** Obstacles and particles drawn in the last frame (mirrored for tools and the smoke test). */
  obstaclesDrawn = 0;
  particlesDrawn = 0;

  applyCamera(ctx: CanvasRenderingContext2D, view: RunnerView) {
    ctx.translate(-view.camX * view.field.unit, 0);
  }

  /** The range of course x (cube lengths) in view, with a margin. */
  private visible(view: RunnerView): [number, number] {
    const f = view.field;
    return [view.camX - f.left / f.unit - 2, view.camX + (f.width - f.left) / f.unit + 2];
  }

  drawWorld(ctx: CanvasRenderingContext2D, view: RunnerView, o: JdmRhythmRenderOptions) {
    const f = view.field;
    const u = f.unit;
    const c = view.course;
    const [x0, x1] = this.visible(view);
    const X = (x: number) => f.left + x * u;
    const Y = (y: number) => f.floorY - y * u;
    let drawn = 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    // A grid that pulses with the beat, behind everything.
    const pulse = view.beatPulse;
    ctx.strokeStyle = o.wallColor(0, 0.06 + 0.12 * pulse);
    ctx.lineWidth = 1;
    ctx.beginPath();
    const top = f.top - f.size;
    const bottom = f.top + 2 * f.size;
    for (let gx = Math.floor(x0 / 2) * 2; gx <= x1; gx += 2) {
      ctx.moveTo(X(gx), top);
      ctx.lineTo(X(gx), bottom);
    }
    for (let gy = 2; gy <= VIEW_UNITS; gy += 2) {
      ctx.moveTo(X(x0), Y(gy));
      ctx.lineTo(X(x1), Y(gy));
    }
    ctx.stroke();
    // The floor pieces (pits between them).
    const floorDepth = Math.max(f.height, f.top + f.size) - f.floorY + f.size;
    for (const p of c.floors) {
      if (p.x1 < x0 || p.x0 > x1) continue;
      const a = X(Math.max(p.x0, x0));
      const b = X(Math.min(p.x1, x1));
      ctx.fillStyle = "rgba(10, 12, 24, 0.92)";
      ctx.fillRect(a, f.floorY, b - a, floorDepth);
      ctx.fillStyle = o.wallColor(1, 0.12);
      ctx.fillRect(a, f.floorY, b - a, 0.5 * u);
      ctx.strokeStyle = o.wallColor(1);
      ctx.lineWidth = Math.max(2, o.wallThickness);
      ctx.beginPath();
      ctx.moveTo(a, f.floorY);
      ctx.lineTo(b, f.floorY);
      if (p.x0 >= x0) {
        ctx.moveTo(X(p.x0), f.floorY);
        ctx.lineTo(X(p.x0), f.floorY + 1.5 * u);
      }
      if (p.x1 <= x1) {
        ctx.moveTo(X(p.x1), f.floorY);
        ctx.lineTo(X(p.x1), f.floorY + 1.5 * u);
      }
      ctx.stroke();
      drawn++;
    }
    // Blocks: pillars from the floor up, outlined, with an inner square per cube cell.
    for (let i = 0; i < c.blocks.length; i++) {
      const bl = c.blocks[i];
      if (bl.x1 < x0 || bl.x0 > x1) continue;
      const a = X(bl.x0);
      const w = (bl.x1 - bl.x0) * u;
      const y = Y(bl.top);
      const h = f.floorY - y;
      ctx.fillStyle = "rgba(8, 10, 22, 0.95)";
      ctx.fillRect(a, y, w, h);
      ctx.fillStyle = o.wallColor(i + 2, 0.16);
      ctx.fillRect(a, y, w, h);
      const color = o.wallColor(i + 2);
      if (o.showWallGlow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 10;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, o.wallThickness);
      ctx.strokeRect(a, y, w, h);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = o.wallColor(i + 2, 0.35);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let cx = Math.ceil(bl.x0 + 0.25); cx < bl.x1 - 0.25; cx++) {
        ctx.moveTo(X(cx), y);
        ctx.lineTo(X(cx), f.floorY);
      }
      for (let cy = 1; cy < bl.top; cy++) {
        ctx.moveTo(a, Y(cy));
        ctx.lineTo(a + w, Y(cy));
      }
      ctx.stroke();
      drawn++;
    }
    // Spikes.
    ctx.lineJoin = "round";
    for (let i = 0; i < c.spikes.length; i++) {
      const s = c.spikes[i];
      if (s.x < x0) continue;
      if (s.x > x1) break;
      const base = Y(s.base);
      const color = o.wallColor(i + 7);
      ctx.beginPath();
      ctx.moveTo(X(s.x - 0.5), base);
      ctx.lineTo(X(s.x), base - u);
      ctx.lineTo(X(s.x + 0.5), base);
      ctx.closePath();
      ctx.fillStyle = "#07070d";
      ctx.fill();
      if (o.showWallGlow) {
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 0.8 * o.wallThickness);
      ctx.stroke();
      ctx.shadowBlur = 0;
      drawn++;
    }
    // A marker on every landing spot – the beat – lit once it is cleared, flashing as the square lands on it.
    for (let i = 0; i < c.events.length; i++) {
      const ev = c.events[i];
      if (ev.landX < x0) continue;
      if (ev.landX > x1) break;
      const x = X(ev.landX);
      const y = Y(ev.toLevel);
      const lit = i < view.cleared;
      const age = view.lastLandEvent === i ? view.timeSec - view.lastLandSec : Infinity;
      const flash = age >= 0 && age < 0.3 ? 1 - age / 0.3 : 0;
      const r = 0.14 * u * (1 + 0.8 * flash);
      ctx.fillStyle = lit ? GOLD : "rgba(255, 255, 255, 0.28)";
      ctx.beginPath();
      ctx.moveTo(x, y - 0.2 * u - r);
      ctx.lineTo(x + r, y - 0.2 * u);
      ctx.lineTo(x, y - 0.2 * u + r);
      ctx.lineTo(x - r, y - 0.2 * u);
      ctx.closePath();
      ctx.fill();
      if (flash > 0) {
        ctx.globalAlpha = 0.5 * flash;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y - 0.5 * u, (0.6 + 1.6 * (1 - flash)) * u, 0, TWO_PI);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    // Checkpoints of a hand-played run, and the attempt counter floating over the current one.
    if (!view.auto) {
      for (let i = 1; i < c.checkpoints.length; i++) {
        const cp = c.checkpoints[i];
        if (cp.x < x0 || cp.x > x1) continue;
        const x = X(cp.x);
        const y = Y(cp.level);
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y - 1.6 * u);
        ctx.stroke();
        ctx.fillStyle = i <= view.checkpoint ? "#34d399" : "rgba(255, 255, 255, 0.5)";
        ctx.beginPath();
        ctx.moveTo(x, y - 1.6 * u);
        ctx.lineTo(x + 0.7 * u, y - 1.35 * u);
        ctx.lineTo(x, y - 1.1 * u);
        ctx.closePath();
        ctx.fill();
      }
    }
    // The finish: a checkered band across the view's height.
    if (c.finishX >= x0 && c.finishX <= x1) {
      const x = X(c.finishX);
      const cell = 0.5 * u;
      const rows = Math.ceil((f.floorY - (f.top - 0.5 * f.size)) / cell);
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < 2; k++) {
          ctx.fillStyle = (r + k) % 2 === 0 ? "rgba(255, 255, 255, 0.85)" : "rgba(0, 0, 0, 0.7)";
          ctx.fillRect(x + (k - 1) * cell, f.floorY - (r + 1) * cell, cell, cell);
        }
      }
    }
    ctx.restore();
    this.obstaclesDrawn = drawn;
  }

  /** The trail and the square (hidden after a crash until the respawn). */
  drawBodies(ctx: CanvasRenderingContext2D, view: RunnerView, o: JdmRhythmRenderOptions) {
    if (!view.alive) return;
    const f = view.field;
    const u = f.unit;
    const X = (x: number) => f.left + x * u;
    const Y = (y: number) => f.floorY - (y + 0.5) * u;
    ctx.save();
    // The trail: fading, shrinking squares at the last positions.
    if (o.showTrails && view.trailCount > 1) {
      for (let k = view.trailCount - 1; k >= 1; k--) {
        const i = (view.trailHead - 1 - k + 2 * RR_TRAIL) % RR_TRAIL;
        const a = 1 - k / view.trailCount;
        const s = (0.25 + 0.55 * a) * u;
        ctx.globalAlpha = 0.35 * a;
        ctx.fillStyle = o.bodyColor;
        ctx.save();
        ctx.translate(X(view.trailX[i]), Y(view.trailY[i]));
        ctx.rotate(view.trailA[i]);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    // Squash for a moment after a landing (render-only).
    const age = view.timeSec - view.lastLandSec;
    const squash = age >= 0 && age < 0.14 ? Math.sin((Math.PI * age) / 0.14) * 0.22 : 0;
    const cx = X(view.x);
    const bottom = f.floorY - view.y * u;
    const w = u * (1 + squash);
    const h = u * (1 - squash);
    ctx.translate(cx, bottom - h / 2);
    ctx.rotate(view.grounded ? 0 : view.angle);
    if (o.showGlow || view.beatPulse > 0.6) {
      ctx.shadowColor = o.bodyColor;
      ctx.shadowBlur = 12 + 14 * view.beatPulse;
    }
    ctx.fillStyle = o.bodyColor;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
    ctx.lineWidth = Math.max(1.5, 0.08 * u);
    ctx.strokeRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
    ctx.fillRect(-0.28 * w, -0.28 * h, 0.56 * w, 0.56 * h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = Math.max(1, 0.05 * u);
    ctx.strokeRect(-0.28 * w, -0.28 * h, 0.56 * w, 0.56 * h);
    ctx.restore();
  }

  drawParticles(ctx: CanvasRenderingContext2D, view: RunnerView, o: JdmRhythmRenderOptions) {
    const f = view.field;
    const u = f.unit;
    const t = view.timeSec;
    let drawn = 0;
    ctx.save();
    for (let s = 0; s < MAX_RR_PARTICLES; s++) {
      const age = t - view.partT0[s];
      if (!(age >= 0) || age > view.partLife[s]) continue;
      const k = 1 - age / view.partLife[s];
      const x = view.partX[s] + view.partVx[s] * age;
      const y = view.partY[s] + view.partVy[s] * age - 0.5 * RR_PARTICLE_GRAVITY * age * age;
      const size = view.partSize[s] * u * (view.partKind[s] === 0 ? 0.6 + 0.4 * k : 1);
      const kind = view.partKind[s];
      ctx.globalAlpha = kind === 0 ? 0.55 * k : k;
      ctx.fillStyle = kind === 0 ? "#e4e4e7" : kind === 1 ? o.bodyColor : s % 2 === 0 ? GOLD : o.wallColor(s);
      ctx.fillRect(f.left + x * u - size / 2, f.floorY - y * u - size / 2, size, size);
      drawn++;
    }
    ctx.restore();
    this.particlesDrawn = drawn;
  }

  /** Screen space, inside the square the recorder crops to (part of the recording). */
  drawOverlay(ctx: CanvasRenderingContext2D, view: RunnerView, L: JdmRhythmLabels, o: JdmRhythmRenderOptions, inset = 0) {
    const f = view.field;
    const side = f.size;
    const left = f.left;
    const top = f.top + inset;
    const c = view.course;
    ctx.save();
    ctx.globalAlpha = 1;
    // The progress bar.
    const pct = Math.max(0, Math.min(1, view.x / Math.max(1e-6, c.finishX)));
    const barW = 0.56 * side;
    const barH = Math.max(6, 0.018 * side);
    const bx = left + (side - barW) / 2;
    const by = top + 0.05 * side;
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillRect(bx - 2, by - 2, barW + 4, barH + 4);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = o.wallColor(0);
    ctx.fillRect(bx, by, barW * pct, barH);
    const fs = Math.max(11, 0.032 * side);
    ctx.font = `800 ${fs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(`${Math.floor(100 * pct)}%`, bx + barW + 0.6 * fs, by + barH / 2);
    // The tempo badge (and AUTO), top left of the square; the attempt counter top right.
    const bfs = Math.max(10, 0.026 * side);
    ctx.font = `700 ${bfs}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(244, 244, 245, 0.85)";
    const beatAlpha = 0.45 + 0.55 * view.beatPulse;
    const badge = view.auto ? `${L.bpm(Math.round(view.bpm))} · ${L.auto}` : L.bpm(Math.round(view.bpm));
    ctx.globalAlpha = beatAlpha;
    ctx.fillText(badge, left + 0.04 * side, by + barH + 1.4 * bfs);
    ctx.globalAlpha = 1;
    if (!view.auto) {
      ctx.textAlign = "right";
      ctx.fillText(L.attempt(view.attempt), left + 0.96 * side, by + barH + 1.4 * bfs);
      // The hint for the first seconds of the run.
      if (view.timeSec < 3 && view.deaths === 0) {
        ctx.globalAlpha = view.timeSec < 2.4 ? 1 : (3 - view.timeSec) / 0.6;
        subText(ctx, L.jumpHint, left + side / 2, top + 0.32 * side, Math.max(14, 0.045 * side), GOLD);
        ctx.globalAlpha = 1;
      }
    }
    // A crash flashes the frame red for a moment.
    const crash = view.timeSec - view.deathSec;
    if (crash >= 0 && crash < 0.35) {
      ctx.globalAlpha = 0.28 * (1 - crash / 0.35);
      ctx.fillStyle = "#ef4444";
      ctx.fillRect(left, f.top, side, side);
      ctx.globalAlpha = 1;
    }
    // LEVEL COMPLETE!
    if (view.crossed) {
      const age = Math.max(0, view.timeSec - view.crossSec);
      const pop = Math.min(1, age / 0.25);
      const base = 0.1 * side * (0.6 + 0.4 * pop);
      const size = fitFont(ctx, L.complete, base, 0.9 * side);
      const cy = f.top + 0.42 * side;
      bannerText(ctx, L.complete, left + side / 2, cy, size, GOLD);
      subText(ctx, L.completeSub(view.jumps, view.onBeat, view.landings), left + side / 2, cy + 0.9 * base, 0.36 * base);
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ Paddle Keep-Up */

export class PaddleLayer {
  particlesDrawn = 0;

  drawWorld(ctx: CanvasRenderingContext2D, view: PaddleView, o: JdmRhythmRenderOptions) {
    const f = view.field;
    const s = f.size;
    const X = (x: number) => f.left + x * s;
    const Y = (y: number) => f.top + y * s;
    const t = view.timeSec;
    ctx.save();
    ctx.globalAlpha = 1;
    // The field.
    ctx.fillStyle = "rgba(9, 11, 26, 0.9)";
    ctx.fillRect(f.left, Y(PD_CEILING), f.width, Y(1) - Y(PD_CEILING));
    // The miss zone under the platform: red, brighter right after a miss.
    const missAge = t - view.lastMissSec;
    const missFlash = missAge >= 0 && missAge < 0.6 ? 1 - missAge / 0.6 : 0;
    const zone = ctx.createLinearGradient(0, Y(PD_PLATFORM), 0, Y(1));
    zone.addColorStop(0, "rgba(239, 68, 68, 0)");
    zone.addColorStop(1, `rgba(239, 68, 68, ${(0.18 + 0.5 * missFlash).toFixed(3)})`);
    ctx.fillStyle = zone;
    ctx.fillRect(f.left, Y(PD_PLATFORM), f.width, Y(1) - Y(PD_PLATFORM));
    // Walls and ceiling, glowing where the ball touched them.
    const lw = Math.max(3, 1.5 * o.wallThickness);
    const wallAge = t - view.lastWallSec;
    const wallFlash = wallAge >= 0 && wallAge < 0.25 ? 1 - wallAge / 0.25 : 0;
    const ceilAge = t - view.lastCeilingSec;
    const ceilFlash = ceilAge >= 0 && ceilAge < 0.3 ? 1 - ceilAge / 0.3 : 0;
    const color = o.wallColor(0);
    if (o.showWallGlow) {
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(X(0), Y(1));
    ctx.lineTo(X(0), Y(PD_CEILING));
    ctx.lineTo(X(PD_ASPECT), Y(PD_CEILING));
    ctx.lineTo(X(PD_ASPECT), Y(1));
    ctx.stroke();
    ctx.shadowBlur = 0;
    if (wallFlash > 0) {
      ctx.globalAlpha = wallFlash;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = lw + 2;
      ctx.beginPath();
      const wx = view.lastWallSide > 0 ? X(PD_ASPECT) : X(0);
      ctx.moveTo(wx, Y(PD_CEILING));
      ctx.lineTo(wx, Y(1));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (ceilFlash > 0) {
      ctx.globalAlpha = ceilFlash;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = lw + 2;
      ctx.beginPath();
      ctx.moveTo(X(Math.max(0, view.lastCeilingX - 0.12)), Y(PD_CEILING));
      ctx.lineTo(X(Math.min(PD_ASPECT, view.lastCeilingX + 0.12)), Y(PD_CEILING));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    // The platform: dips and flashes on a catch.
    const hitAge = t - view.lastHitSec;
    const hitFlash = hitAge >= 0 && hitAge < 0.18 ? 1 - hitAge / 0.18 : 0;
    const px = X(view.px - view.halfWidth);
    const pw = 2 * view.halfWidth * s;
    const py = Y(PD_PLATFORM) + 0.25 * PD_THICKNESS * s * hitFlash;
    const ph = PD_THICKNESS * s;
    const pColor = hitFlash > 0.5 ? "#ffffff" : o.wallColor(1);
    if (o.showWallGlow || hitFlash > 0) {
      ctx.shadowColor = pColor;
      ctx.shadowBlur = 10 + 16 * hitFlash;
    }
    ctx.fillStyle = pColor;
    const rad = Math.min(ph / 2, pw / 2);
    ctx.beginPath();
    ctx.moveTo(px + rad, py);
    ctx.lineTo(px + pw - rad, py);
    ctx.arcTo(px + pw, py, px + pw, py + rad, rad);
    ctx.arcTo(px + pw, py + ph, px + pw - rad, py + ph, rad);
    ctx.lineTo(px + rad, py + ph);
    ctx.arcTo(px, py + ph, px, py + ph - rad, rad);
    ctx.arcTo(px, py, px + rad, py, rad);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    // The sweet spot in the middle of the platform.
    ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    ctx.fillRect(X(view.px) - 0.12 * pw, py + 0.3 * ph, 0.24 * pw, 0.4 * ph);
    // Sparks of the catches.
    let drawn = 0;
    for (let k = 0; k < MAX_PD_PARTICLES; k++) {
      const age = t - view.partT0[k];
      if (!(age >= 0) || age > view.partLife[k]) continue;
      const a = 1 - age / view.partLife[k];
      const x = view.partX[k] + view.partVx[k] * age;
      const y = view.partY[k] + view.partVy[k] * age + 1.2 * age * age;
      const size = Math.max(1.5, 0.008 * s * a);
      ctx.globalAlpha = a;
      ctx.fillStyle = k % 3 === 0 ? GOLD : o.bodyColor;
      ctx.fillRect(X(x) - size / 2, Y(y) - size / 2, size, size);
      drawn++;
    }
    ctx.restore();
    this.particlesDrawn = drawn;
  }

  /** The score and lives above the field, the streak, "MISS!" and "GAME OVER" (screen space, part of the recording). */
  drawOverlay(ctx: CanvasRenderingContext2D, view: PaddleView, L: JdmRhythmLabels) {
    const f = view.field;
    const s = f.size;
    const cx = f.left + f.width / 2;
    const t = view.timeSec;
    const band = PD_CEILING * s;
    ctx.save();
    ctx.globalAlpha = 1;
    // Score, big, in the band over the ceiling (it pops on a catch).
    const hitAge = t - view.lastHitSec;
    const pop = hitAge >= 0 && hitAge < 0.2 ? 1 + 0.25 * (1 - hitAge / 0.2) : 1;
    const fs = 0.5 * band * pop;
    ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(String(view.hits), cx, f.top + 0.55 * band);
    const lfs = 0.2 * band;
    ctx.font = `700 ${lfs}px sans-serif`;
    ctx.fillStyle = "rgba(244, 244, 245, 0.6)";
    ctx.fillText(L.score, cx, f.top + 0.16 * band);
    // Lives: one heart per miss still allowed + the ball in play.
    const lives = view.settings.misses + 1;
    const left = Math.max(0, lives - view.misses);
    const hs = 0.22 * band;
    ctx.font = `${hs}px sans-serif`;
    ctx.textAlign = "left";
    for (let i = 0; i < lives && i < 10; i++) {
      ctx.globalAlpha = i < left ? 1 : 0.25;
      ctx.fillStyle = i < left ? "#f43f5e" : "#71717a";
      ctx.fillText("♥", f.left + 0.03 * f.width + i * 1.05 * hs, f.top + 0.5 * band);
    }
    ctx.globalAlpha = 1;
    // The streak (right) and the controller (auto) or the controls hint (manual).
    ctx.textAlign = "right";
    ctx.font = `700 ${0.18 * band}px sans-serif`;
    ctx.fillStyle = view.streak >= 10 ? GOLD : "rgba(244, 244, 245, 0.75)";
    if (view.streak >= 2) ctx.fillText(L.streak(view.streak), f.left + 0.97 * f.width, f.top + 0.36 * band);
    ctx.fillStyle = "rgba(244, 244, 245, 0.5)";
    ctx.font = `600 ${0.15 * band}px sans-serif`;
    ctx.fillText(view.settings.auto ? `${L.auto} · ${Math.round(100 * view.settings.skill)}%` : "", f.left + 0.97 * f.width, f.top + 0.68 * band);
    if (!view.settings.auto && t < 3) subText(ctx, L.moveHint, cx, f.top + 0.45 * s, Math.max(12, fitFont(ctx, L.moveHint, 0.035 * s, 0.92 * f.width, 700)), GOLD);
    // MISS!
    const missAge = t - view.lastMissSec;
    if (!view.over && missAge >= 0 && missAge < 0.9) {
      ctx.globalAlpha = missAge < 0.6 ? 1 : 1 - (missAge - 0.6) / 0.3;
      bannerText(ctx, L.miss, cx, f.top + 0.5 * s, 0.09 * s * (1 + 0.15 * Math.max(0, 1 - missAge / 0.15)), "#f87171");
      ctx.globalAlpha = 1;
    }
    // GAME OVER.
    if (view.over) {
      const age = Math.max(0, t - view.overSec);
      const k = Math.min(1, age / 0.3);
      ctx.globalAlpha = 0.55 * k;
      ctx.fillStyle = "#000";
      ctx.fillRect(f.left, f.top, f.width, s);
      ctx.globalAlpha = 1;
      const base = 0.11 * s * (0.6 + 0.4 * k);
      const size = fitFont(ctx, L.gameOver, base, 0.92 * f.width);
      bannerText(ctx, L.gameOver, cx, f.top + 0.42 * s, size, "#f87171");
      const sub = L.gameOverSub(view.hits, view.bestStreak);
      subText(ctx, sub, cx, f.top + 0.42 * s + 0.85 * base, fitFont(ctx, sub, 0.34 * base, 0.92 * f.width, 700));
    }
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ the canvas dataset (tools and the smoke test) */

export const RUNNER_DATA_KEYS = ["rrEvents", "rrCleared", "rrLandings", "rrOnBeat", "rrJumps", "rrDeaths", "rrAttempt", "rrAuto", "rrBpm", "rrAlive", "rrCrossed", "rrFinished", "rrEndSec", "rrX", "rrCamX", "rrObstacles", "rrParticles"];
export const PADDLE_DATA_KEYS = ["pdHits", "pdMisses", "pdAllowed", "pdStreak", "pdBest", "pdOver", "pdFinished", "pdEndSec", "pdAuto", "pdTempo", "pdX", "pdWalls", "pdCeiling", "pdInPlay", "pdParticles"];

export function writeRunnerDataset(view: RunnerView, layer: RunnerLayer, set: (key: string, value: string) => void) {
  set("rrEvents", String(view.course.events.length));
  set("rrCleared", String(view.cleared));
  set("rrLandings", String(view.landings));
  set("rrOnBeat", String(view.onBeat));
  set("rrJumps", String(view.jumps));
  set("rrDeaths", String(view.deaths));
  set("rrAttempt", String(view.attempt));
  set("rrAuto", view.auto ? "1" : "0");
  set("rrBpm", String(Math.round(view.bpm)));
  set("rrAlive", view.alive ? "1" : "0");
  set("rrCrossed", view.crossed ? "1" : "0");
  set("rrFinished", view.finished ? "1" : "0");
  set("rrEndSec", view.finished ? (view.crossSec + FINISH_HOLD_SEC).toFixed(3) : "");
  set("rrX", view.x.toFixed(2));
  set("rrCamX", (view.camX + CAMERA_AT * VIEW_UNITS).toFixed(2));
  set("rrObstacles", String(layer.obstaclesDrawn));
  set("rrParticles", String(layer.particlesDrawn));
}

export function writePaddleDataset(view: PaddleView, layer: PaddleLayer, set: (key: string, value: string) => void) {
  set("pdHits", String(view.hits));
  set("pdMisses", String(view.misses));
  set("pdAllowed", String(view.settings.misses));
  set("pdStreak", String(view.streak));
  set("pdBest", String(view.bestStreak));
  set("pdOver", view.over ? "1" : "0");
  set("pdFinished", view.finished ? "1" : "0");
  set("pdEndSec", view.finished ? (view.overSec + GAME_OVER_HOLD_SEC).toFixed(3) : "");
  set("pdAuto", view.settings.auto ? "1" : "0");
  set("pdTempo", view.tempo.toFixed(2));
  set("pdX", (view.px / PD_ASPECT).toFixed(3));
  set("pdWalls", String(view.wallHits));
  set("pdCeiling", String(view.ceilingHits));
  set("pdInPlay", view.inPlay ? "1" : "0");
  set("pdParticles", String(layer.particlesDrawn));
}
