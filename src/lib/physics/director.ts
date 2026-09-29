import type { Gap, PersonalityState, PersonalityVisuals, Ball } from "./types";
import { TWO_PI, normalizeAngle } from "./types";

/**
 * The "cinematic director" subtly nudges rebounds so a run stays dramatic: it biases the
 * ball toward the nearest gap when tension is high, manufactures near-misses, and drives a
 * personality state machine that the renderer uses for glow/trail intensity.
 *
 * It only ever adjusts angles by a few degrees (clamped to 18°), so the physics still feel
 * natural. Disable it with engine.setCinematicEnabled(false) for pure physics.
 */

interface PersonalityPreset {
  speedMultiplier: number;
  trailIntensity: number;
  glowPulseRate: number;
  colorShiftDeg: number;
  glowScale: number;
  minDuration: number;
}

const PERSONALITIES: Record<PersonalityState, PersonalityPreset> = {
  calm: { speedMultiplier: 0.9, trailIntensity: 0.7, glowPulseRate: 0.8, colorShiftDeg: -15, glowScale: 0.85, minDuration: 4000 },
  aggressive: { speedMultiplier: 1.1, trailIntensity: 1.2, glowPulseRate: 3, colorShiftDeg: 15, glowScale: 1.15, minDuration: 3000 },
  chaotic: { speedMultiplier: 1.15, trailIntensity: 1.4, glowPulseRate: 5.5, colorShiftDeg: 25, glowScale: 1.3, minDuration: 2000 },
  unstable: { speedMultiplier: 1.05, trailIntensity: 1.6, glowPulseRate: 7, colorShiftDeg: -25, glowScale: 1.4, minDuration: 1500 },
  overcharged: { speedMultiplier: 1.25, trailIntensity: 1.8, glowPulseRate: 8, colorShiftDeg: 30, glowScale: 1.6, minDuration: 2500 },
};

const ALL_STATES: PersonalityState[] = ["calm", "aggressive", "chaotic", "unstable", "overcharged"];

type DramaPhase = "calm" | "building" | "near-disaster" | "climax" | "resolution";
type ViralMoment = "chain-rebound" | "frame-perfect" | "impossible-recovery" | null;

interface NearestGap {
  center: number;
  start: number;
  end: number;
}

const NEVER = -999999;
const LERP_RATE = 0.003;
const MAX_NUDGE = (18 * Math.PI) / 180;

function freshVisuals(): PersonalityVisuals {
  return {
    state: "calm",
    speedMultiplier: 0.9,
    trailIntensity: 0.7,
    glowPulseRate: 0.8,
    colorShiftDeg: -15,
    glowScale: 0.85,
    tension: 0,
  };
}

export class CinematicDirector {
  private enabled = true;
  private random: () => number = Math.random;
  private personality: PersonalityState = "calm";
  private personalityTimer = 0;
  private bounceCount = 0;
  private nearMissCount = 0;
  private wallBreakCount = 0;
  private dramaTime = 0;
  private readonly dramaCycleDuration = 50000;
  private tension = 0;
  private dramaPhase: DramaPhase = "calm";
  private simClock = 0;
  private momentScore = 0;
  private viralCooldown = 0;
  private activeViralMoment: ViralMoment = null;
  private chainReboundsRemaining = 0;
  private nearMissBuffer = new Float64Array(32).fill(NEVER);
  private nearMissCountTotal = 0;
  private nearMissSyncedAt = -1;
  private currentVisuals: PersonalityVisuals = freshVisuals();
  // --- camera ---
  /** Near-miss events since the director was created (never reset; the cinematic camera slows the clock when it grows). */
  private nearMissSerial = 0;
  // --- end camera ---

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  setRandom(random: () => number) {
    this.random = random;
  }

  reset() {
    this.personality = "calm";
    this.personalityTimer = 0;
    this.bounceCount = 0;
    this.nearMissCount = 0;
    this.wallBreakCount = 0;
    this.dramaTime = 0;
    this.tension = 0;
    this.dramaPhase = "calm";
    this.momentScore = 0;
    this.viralCooldown = 0;
    this.activeViralMoment = null;
    this.chainReboundsRemaining = 0;
    this.simClock = 0;
    this.nearMissBuffer.fill(NEVER);
    this.nearMissCountTotal = 0;
    this.nearMissSyncedAt = -1;
    this.currentVisuals = freshVisuals();
  }

  getPersonalityState(): PersonalityVisuals {
    return this.currentVisuals;
  }

  getTension() {
    return this.tension;
  }

  update(dtMs: number) {
    if (!this.enabled) return;
    this.simClock += dtMs;
    this.dramaTime += dtMs;
    if (this.dramaTime >= this.dramaCycleDuration) {
      this.dramaTime = this.dramaTime % this.dramaCycleDuration;
    }
    this.updateDramaCurve();
    this.personalityTimer += dtMs;
    this.decayCounters();
    this.evaluatePersonalityTransition();
    if (this.viralCooldown > 0) this.viralCooldown = Math.max(0, this.viralCooldown - dtMs);
    this.lerpVisuals(dtMs);
  }

  /** Adjusts a rebound angle (radians). Returns the new angle. */
  adjustRebound(ball: Ball, angle: number, wallRadius: number, wallRotation: number, gaps: Gap[]): number {
    if (!this.enabled || gaps.length === 0) return angle;
    this.bounceCount++;
    const nearest = this.findNearestGap(angle, wallRotation, gaps);
    const survival = this.computeSurvivalBias(angle, nearest);
    const nearMiss = this.computeNearMissNudge(ball, angle + survival, wallRadius, wallRotation, gaps);
    let moment = 0;
    if (this.activeViralMoment === "chain-rebound") {
      moment = this.computeChainReboundNudge();
      if (--this.chainReboundsRemaining <= 0) this.activeViralMoment = null;
    } else if (this.activeViralMoment === "impossible-recovery") {
      moment = this.computeImpossibleRecoveryNudge(angle + survival, nearest);
      this.activeViralMoment = null;
    }
    return angle + this.clampNudge(survival + nearMiss + moment);
  }

  /** Optional velocity tweak when the ball passes through a gap. */
  adjustGapPass(
    ball: Ball,
    wallRadius: number,
    wallRotation: number,
    gap: Gap,
    centerX: number,
    centerY: number,
  ): { vxAdjust: number; vyAdjust: number } | null {
    if (!this.enabled) {
      // --- camera --- the near-miss test is pure geometry (no RNG, no drama state), so the event still fires with the director off
      if (this.isNearMissPass(ball, wallRadius, wallRotation, gap, centerX, centerY)) this.nearMissSerial++;
      return null;
    }
    const angle = normalizeAngle(Math.atan2(ball.y - centerY, ball.x - centerX));
    const start = normalizeAngle(gap.startAngle + wallRotation);
    const end = normalizeAngle(gap.endAngle + wallRotation);
    const dStart = this.angleDist(angle, start);
    const dEnd = this.angleDist(angle, end);
    const minDist = Math.min(dStart, dEnd);
    const ballAngular = Math.atan2(ball.radius, wallRadius);
    if (minDist < 4 * ballAngular) this.registerNearMiss();
    if (this.activeViralMoment === "frame-perfect") {
      this.activeViralMoment = null;
      const target = (dStart < dEnd ? start : end) + (dStart < dEnd ? 1.5 * ballAngular : -1.5 * ballAngular);
      const tx = centerX + Math.cos(target) * wallRadius;
      const ty = centerY + Math.sin(target) * wallRadius;
      const speed = Math.hypot(ball.vx, ball.vy);
      const dx = tx - ball.x;
      const dy = ty - ball.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 0 && speed > 0) {
        return {
          vxAdjust: ((dx / dist) * speed - ball.vx) * 0.15,
          vyAdjust: ((dy / dist) * speed - ball.vy) * 0.15,
        };
      }
    }
    return null;
  }

  onGapPass() {
    if (!this.enabled) return;
    this.wallBreakCount++;
    this.dramaTime = 0;
    this.tension = 0;
    this.dramaPhase = "calm";
    this.momentScore += 15;
  }

  getSpeedMultiplier() {
    return this.enabled ? this.currentVisuals.speedMultiplier : 1;
  }

  // --- camera ---
  /**
   * The near-miss event for the cinematic camera: how many gap passes so far squeezed within four ball
   * widths of a gap edge (the director's own near-miss test). Counted whether the director is on or off and
   * never reset – the camera polls it and slows the clock when it grows. Reading it changes nothing.
   */
  getNearMissSerial() {
    return this.nearMissSerial;
  }

  /** The near-miss test of `adjustGapPass()` on its own, without touching the drama state. */
  private isNearMissPass(ball: Ball, wallRadius: number, wallRotation: number, gap: Gap, centerX: number, centerY: number): boolean {
    const angle = normalizeAngle(Math.atan2(ball.y - centerY, ball.x - centerX));
    const start = normalizeAngle(gap.startAngle + wallRotation);
    const end = normalizeAngle(gap.endAngle + wallRotation);
    const minDist = Math.min(this.angleDist(angle, start), this.angleDist(angle, end));
    return minDist < 4 * Math.atan2(ball.radius, wallRadius);
  }
  // --- end camera ---

  private updateDramaCurve() {
    const t = this.dramaTime / this.dramaCycleDuration;
    if (t < 0.25) {
      this.dramaPhase = "calm";
      this.tension = 0.05 + (t / 0.25) * 0.1;
    } else if (t < 0.55) {
      this.dramaPhase = "building";
      this.tension = 0.15 + ((t - 0.25) / 0.3) * 0.4;
    } else if (t < 0.75) {
      this.dramaPhase = "near-disaster";
      this.tension = 0.55 + ((t - 0.55) / 0.2) * 0.3;
    } else if (t < 0.9) {
      this.dramaPhase = "climax";
      this.tension = 0.85 + ((t - 0.75) / 0.15) * 0.15;
    } else {
      this.dramaPhase = "resolution";
      this.tension = 1 - ((t - 0.9) / 0.1) * 0.9;
    }
  }

  private evaluatePersonalityTransition() {
    const preset = PERSONALITIES[this.personality];
    if (this.personalityTimer < preset.minDuration) return;
    let next: PersonalityState = this.personality;
    if (this.dramaPhase === "calm" || this.dramaPhase === "resolution") next = "calm";
    else if (this.dramaPhase === "building") next = this.nearMissCount > 2 ? "chaotic" : "aggressive";
    else if (this.dramaPhase === "near-disaster") next = this.nearMissCount > 3 ? "unstable" : "chaotic";
    else if (this.dramaPhase === "climax") next = this.wallBreakCount > 0 ? "overcharged" : "unstable";
    if (this.random() < 0.15) {
      const idx = Math.floor(this.random() * (2 + 3 * this.tension));
      next = ALL_STATES[Math.min(idx, ALL_STATES.length - 1)];
    }
    if (next !== this.personality) {
      this.personality = next;
      this.personalityTimer = 0;
    }
  }

  private decayCounters() {
    if (this.nearMissSyncedAt === this.simClock) return;
    const now = this.simClock;
    const n = Math.min(this.nearMissCountTotal, this.nearMissBuffer.length);
    let recent = 0;
    for (let i = 0; i < n; i++) if (now - this.nearMissBuffer[i] < 2000) recent++;
    this.nearMissCount = recent;
  }

  private lerpVisuals(dtMs: number) {
    const t = 1 - Math.exp(-LERP_RATE * dtMs);
    const target = PERSONALITIES[this.personality];
    const v = this.currentVisuals;
    if (v.state !== this.personality) v.state = this.personality;
    v.speedMultiplier += (target.speedMultiplier - v.speedMultiplier) * t;
    v.trailIntensity += (target.trailIntensity - v.trailIntensity) * t;
    v.glowPulseRate += (target.glowPulseRate - v.glowPulseRate) * t;
    v.colorShiftDeg += (target.colorShiftDeg - v.colorShiftDeg) * t;
    v.glowScale += (target.glowScale - v.glowScale) * t;
    v.tension = this.tension;
  }

  private computeSurvivalBias(angle: number, nearest: NearestGap | null): number {
    if (!nearest) return 0;
    const signed = this.signedAngleDist(angle, nearest.center);
    const dist = Math.abs(signed);
    if (dist < 0.1) return 0;
    const strength = 0.3 + 0.7 * this.tension;
    const maxDeg = ((5 + 7 * this.tension) * Math.PI) / 180;
    const falloff = Math.min(1, dist / Math.PI);
    return Math.sign(signed) * Math.min(maxDeg, 0.15 * dist) * (falloff * strength);
  }

  private computeNearMissNudge(ball: Ball, angle: number, wallRadius: number, rotation: number, gaps: Gap[]): number {
    if (this.random() > 0.3 + 0.4 * this.tension) return 0;
    const ballAngular = Math.atan2(ball.radius, wallRadius);
    for (const gap of gaps) {
      const start = normalizeAngle(gap.startAngle + rotation);
      const end = normalizeAngle(gap.endAngle + rotation);
      const dStart = this.angleDist(angle, start);
      const dEnd = this.angleDist(angle, end);
      const margin = 2 * ballAngular;
      const maxNudge = (8 * Math.PI) / 180;
      if (dStart > 3 * margin && dStart < 0.5) {
        const n = Math.min(maxNudge, (dStart - margin) * 0.12);
        return this.signedAngleDist(angle, start) > 0 ? n : -n;
      }
      if (dEnd > 3 * margin && dEnd < 0.5) {
        const n = Math.min(maxNudge, (dEnd - margin) * 0.12);
        return this.signedAngleDist(angle, end) > 0 ? n : -n;
      }
    }
    return 0;
  }

  private registerNearMiss() {
    this.nearMissSerial++; // --- camera --- the near-miss event
    const now = this.simClock;
    const slot = this.nearMissCountTotal % this.nearMissBuffer.length;
    this.nearMissBuffer[slot] = now;
    this.nearMissCountTotal++;
    this.momentScore += 8;
    let recent = 0;
    let veryRecent = 0;
    const n = Math.min(this.nearMissCountTotal, this.nearMissBuffer.length);
    for (let i = 0; i < n; i++) {
      const age = now - this.nearMissBuffer[i];
      if (age < 2000) {
        recent++;
        if (age < 500) veryRecent++;
      }
    }
    this.nearMissCount = recent;
    this.nearMissSyncedAt = now;
    if (veryRecent >= 2) this.momentScore += 12;
    this.tryTriggerViralMoment();
  }

  private tryTriggerViralMoment() {
    if (this.viralCooldown > 0 || this.activeViralMoment !== null || this.momentScore < 30) return;
    const r = this.random();
    if (this.dramaPhase === "climax" || this.dramaPhase === "near-disaster") {
      if (r < 0.35) this.activeViralMoment = "impossible-recovery";
      else if (r < 0.65) this.activeViralMoment = "frame-perfect";
      else {
        this.activeViralMoment = "chain-rebound";
        this.chainReboundsRemaining = 3 + Math.floor(3 * this.random());
      }
    } else if (r < 0.5) {
      this.activeViralMoment = "chain-rebound";
      this.chainReboundsRemaining = 3 + Math.floor(2 * this.random());
    } else {
      this.activeViralMoment = "frame-perfect";
    }
    this.momentScore = 0;
    this.viralCooldown = 8000 + 4000 * this.random();
  }

  private computeChainReboundNudge(): number {
    return (2 * this.random() - 1) * 0.08;
  }

  private computeImpossibleRecoveryNudge(angle: number, nearest: NearestGap | null): number {
    if (!nearest) return 0;
    const signed = this.signedAngleDist(angle, nearest.center);
    return Math.sign(signed) * Math.min(MAX_NUDGE, 0.35 * Math.abs(signed));
  }

  private clampNudge(n: number): number {
    return Math.max(-MAX_NUDGE, Math.min(MAX_NUDGE, n));
  }

  private angleDist(a: number, b: number): number {
    let d = normalizeAngle(b - a);
    if (d > Math.PI) d = TWO_PI - d;
    return d;
  }

  private signedAngleDist(a: number, b: number): number {
    let d = normalizeAngle(b - a);
    if (d > Math.PI) d -= TWO_PI;
    return d;
  }

  private findNearestGap(angle: number, rotation: number, gaps: Gap[]): NearestGap | null {
    let best: NearestGap | null = null;
    let bestDist = Infinity;
    for (const gap of gaps) {
      const start = normalizeAngle(gap.startAngle + rotation);
      const end = normalizeAngle(gap.endAngle + rotation);
      let width = end - start;
      if (width < 0) width += TWO_PI;
      const center = normalizeAngle(start + width / 2);
      const d = this.angleDist(angle, center);
      if (d < bestDist) {
        bestDist = d;
        best = { center, start, end };
      }
    }
    return best;
  }
}
