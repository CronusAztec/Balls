import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BACK_OVERSHOOT,
  clamp01,
  criticallyDampedStep,
  easeInBack,
  easeInCubic,
  easeInOutCubic,
  easeOutBack,
  easeOutBackPeak,
  easeOutCubic,
  lerp,
  progress,
  smoothstep,
  springDecay,
} from "@/lib/anim/easing";
import {
  ARENA_BAND,
  BD_DRUM_KICK,
  BD_DRUM_SNARE,
  BD_ENTRY_BOTTOM,
  BD_ENTRY_LEFT,
  BD_ENTRY_RIGHT,
  BD_ENTRY_TOP,
  BEAT_DROP_KINDS,
  DRAWS_PER_LANDING,
  ENTRY_TOP_MIN_DX,
  H_MAX,
  LEAD_IN_SEC,
  MIN_FLIGHT_SEC,
  PAD_GEOMETRY,
  SETTLE_SEC,
  SPRING_HEADROOM,
  X_SAFE,
  allowedEntries,
  ballDeformAt,
  barPosition,
  cameraTargetAt,
  descendingRoot,
  drumForBeat,
  isDownbeat,
  keptBeats,
  landingIndexAt,
  padPoseAt,
  planBeatDrop,
  sampleBall,
  type BeatDropPadKind,
  type BeatDropPlan,
  type BeatDropPlanInput,
} from "@/lib/simulation/beatDropPlan";
import {
  BEAT_DROP_BALL_RADIUS,
  BEAT_DROP_RANGES,
  DEFAULT_BEAT_DROP_SETTINGS,
  END_HOLD_SEC,
  beatDropBeatConfig,
  beatDropBeats,
  beatDropFinishSec,
  beatDropLandingTimes,
  beatDropPlanKeyOf,
  beatDropRunInfo,
  beatDropSettingsOf,
  defaultBeatDropFields,
  landingSounds,
  melodyPitch,
  padAccentPitch,
  parseBeatDropKinds,
  resolveBeatDropFields,
  resolveBeatDropSettings,
  sameBeatDropPlan,
  serializeBeatDropKinds,
  toggleBeatDropKind,
  type BeatDropSettings,
} from "@/lib/physics/modes/beatDrop";
import { KICK_TONE, PAD_ACCENTS, SNARE_TONE, accentStartFrequency, beatDropVoices } from "@/lib/audio/beatDropTones";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { BeatDropLayer } from "@/components/simulator/beatDropRenderer";
import type { BeatGrid } from "@/lib/simulation/beatClock";
import { fakeGraph } from "./fakeAudio";
import { serializeMarkers } from "@/lib/simulation/beatSource"; // --- video-beats ---
import { markerBeatInputOf } from "@/lib/simulation/videoBeatsSettings"; // --- video-beats ---
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest"; // --- video-beats ---

/**
 * Beat Drop (feature beat-drop): the shared easing curves, the planner (every landing on its beat within 1 ms at any tempo
 * and on irregular grids, flights that leave upward and land descending, the drift inside the safe area, the camera, the
 * obstructions' entrances before and exits after their beat – never through the ball, never from the ball's side),
 * determinism, resizes, the sounds by beat position and their synthesis, the settings, the registration, the finder and
 * whole runs in the engine.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 14,
  audioIntensity: 0,
};

const baseModeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;

function engineFor(patch: Partial<BeatDropSettings> = {}, seed = 7, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "beatDrop", { ...baseModeSettings, beatDrop: patch }, seed);
}

/** Mulberry32 for the planner tests. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function manualBeats(bpm: number, until: number): number[] {
  const out: number[] = [];
  for (let i = 0; i * (60 / bpm) <= until; i++) out.push(i * (60 / bpm));
  return out;
}

function plan(beats: number[], patch: Partial<BeatDropPlanInput> = {}, seed = 1): BeatDropPlan {
  const period = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  return planBeatDrop({ beats, period, kinds: [...BEAT_DROP_KINDS], drift: 0.5, scroll: "endless", bounceHeight: 0.24, anticipation: 0.6, random: rng(seed), ...patch });
}

/** Every flight of the plan (the drop-in and landing k → k + 1) reaches its landing exactly on its beat. */
function landingErrorsMs(p: BeatDropPlan): number[] {
  const errors: number[] = [];
  // The drop-in: from the start onto landing 0.
  const t0 = descendingRoot(p.startVy, p.startG, p.y[0] - p.startY);
  errors.push(Math.abs(t0 - p.t[0]) * 1000);
  for (let k = 0; k + 1 < p.count; k++) {
    // The ball rests on the pad for its contact, then flies: it must come down on the next pad at the next beat.
    const flight = p.t[k + 1] - p.t[k] - p.contact[k];
    const tau = descendingRoot(p.vy[k], p.g[k], p.y[k + 1] - p.y[k]);
    errors.push(Math.abs(p.t[k] + p.contact[k] + tau - p.t[k + 1]) * 1000);
    // And the horizontal: it arrives over the pad.
    expect(Math.abs(p.x[k] + p.vx[k] * flight - p.x[k + 1])).toBeLessThan(1e-9);
    expect(p.contact[k]).toBeGreaterThan(0);
    expect(p.contact[k]).toBeLessThanOrEqual(0.1 * (p.t[k + 1] - p.t[k]) + 1e-12);
  }
  return errors;
}

/* ------------------------------------------------------------------ easing */

describe("easing", () => {
  it("maps 0 → 0 and 1 → 1 and clamps outside [0, 1]", () => {
    for (const f of [easeOutCubic, easeInCubic, easeInOutCubic, smoothstep, (t: number) => easeOutBack(t), (t: number) => easeInBack(t)]) {
      expect(f(0)).toBeCloseTo(0, 12);
      expect(f(1)).toBeCloseTo(1, 12);
      expect(f(-3)).toBeCloseTo(0, 12);
      expect(f(7)).toBeCloseTo(1, 12);
      expect(f(Number.NaN)).toBeCloseTo(0, 12);
    }
    expect(clamp01(0.3)).toBe(0.3);
    expect(lerp(2, 6, 0.25)).toBe(3);
    expect(progress(1, 3, 2)).toBe(0.5);
    expect(progress(1, 1, 1)).toBe(1);
  });

  it("ease-out starts fast and settles, ease-in the reverse; smoothstep is symmetric", () => {
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 12);
    expect(easeInCubic(0.5)).toBeCloseTo(0.125, 12);
    for (let i = 1; i < 20; i++) {
      const t = i / 20;
      expect(easeOutCubic(t)).toBeGreaterThan(easeOutCubic(t - 0.05));
      expect(easeOutCubic(t)).toBeGreaterThanOrEqual(t);
      expect(smoothstep(t) + smoothstep(1 - t)).toBeCloseTo(1, 12);
    }
  });

  it("the back curves overshoot: out past 1 (≈10 %), in below 0", () => {
    const peak = easeOutBackPeak();
    expect(peak).toBeGreaterThan(1.09);
    expect(peak).toBeLessThan(1.11);
    let max = 0;
    let min = 0;
    for (let i = 0; i <= 1000; i++) {
      max = Math.max(max, easeOutBack(i / 1000));
      min = Math.min(min, easeInBack(i / 1000));
    }
    expect(max).toBeCloseTo(peak, 4);
    expect(min).toBeLessThan(-0.09);
    expect(easeOutBack(0.5, BACK_OVERSHOOT)).toBeGreaterThan(easeOutCubic(0.5));
  });

  it("the damped spring starts at 1, wobbles and dies away", () => {
    expect(springDecay(0, 6, 0.3)).toBe(1);
    expect(springDecay(-0.1, 6, 0.3)).toBe(0);
    expect(springDecay(0.1, 6, 0.3)).toBeLessThan(0);
    expect(Math.abs(springDecay(1, 6, 0.3))).toBeLessThan(1e-4);
  });

  it("the critically damped step never overshoots and does not depend on how the time is cut", () => {
    const a = { x: 0, v: 0 };
    const b = { x: 0, v: 0 };
    let prev = 0;
    for (let i = 0; i < 120; i++) {
      criticallyDampedStep(a, 1, 7, 1 / 60);
      expect(a.x).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(a.x).toBeLessThanOrEqual(1 + 1e-12);
      prev = a.x;
      criticallyDampedStep(b, 1, 7, 1 / 120);
      criticallyDampedStep(b, 1, 7, 1 / 120);
    }
    expect(a.x).toBeCloseTo(b.x, 12);
    expect(a.x).toBeGreaterThan(0.999);
  });
});

/* ------------------------------------------------------------------ the planner */

describe("the planner lands every beat", () => {
  it("within 1 ms at every tempo from 50 to 220 BPM", () => {
    for (const bpm of [50, 60, 72, 90, 100, 120, 128, 140, 150, 174, 200, 220]) {
      const p = plan(manualBeats(bpm, 60), {}, bpm);
      expect(p.count).toBeGreaterThan(40);
      const errors = landingErrorsMs(p);
      expect(Math.max(...errors), `${bpm} BPM`).toBeLessThan(1);
      expect(Math.max(...errors), `${bpm} BPM`).toBeLessThan(1e-6);
      // The landings are the beats (from the lead-in on).
      expect(p.t[0]).toBeGreaterThanOrEqual(LEAD_IN_SEC - 1e-9);
      for (let k = 1; k < p.count; k++) expect(p.t[k] - p.t[k - 1]).toBeCloseTo(60 / bpm, 9);
    }
  });

  it("within 1 ms on irregular grids (tapped, swung, with gaps and double taps)", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const r = rng(seed * 97);
      const beats: number[] = [];
      let t = 0.3 * r();
      while (t < 45) {
        beats.push(t);
        const u = r();
        // Mostly 0.25–0.9 s apart, sometimes a long gap, sometimes a double tap (skipped).
        t += u < 0.08 ? 1.5 + 2 * r() : u < 0.14 ? 0.02 + 0.03 * r() : 0.25 + 0.65 * r();
      }
      const p = plan(beats, { anticipation: 0.3 + 0.7 * r(), drift: r(), scroll: seed % 2 ? "endless" : "arena", bounceHeight: 0.1 + 0.4 * r() }, seed);
      expect(p.count).toBe(keptBeats(beats).length);
      expect(Math.max(...landingErrorsMs(p)), `seed ${seed}`).toBeLessThan(1);
      for (let k = 1; k < p.count; k++) expect(p.t[k] - p.t[k - 1]).toBeGreaterThanOrEqual(MIN_FLIGHT_SEC - 1e-9);
      // Every kept beat is a landing, at its exact time.
      const kept = keptBeats(beats);
      for (let k = 0; k < p.count; k++) expect(p.t[k]).toBe(kept[k]);
    }
  });

  it("every flight leaves upward and comes down onto its pad, below the headroom", () => {
    for (const bpm of [50, 120, 220]) {
      for (const scroll of ["endless", "arena"] as const) {
        const p = plan(manualBeats(bpm, 40), { scroll, drift: 1 }, bpm + (scroll === "arena" ? 1 : 0));
        for (let k = 0; k + 1 < p.count; k++) {
          const T = p.t[k + 1] - p.t[k] - p.contact[k];
          expect(p.vy[k]).toBeLessThan(0);
          expect(p.vy[k] + p.g[k] * T).toBeGreaterThan(0);
          const rise = (p.vy[k] * p.vy[k]) / (2 * p.g[k]);
          expect(rise).toBeLessThanOrEqual(H_MAX * SPRING_HEADROOM + 1e-9);
        }
      }
    }
  });

  it("keeps the landings in the safe area; endless descends, the arena stays in its band", () => {
    const endless = plan(manualBeats(140, 60), { scroll: "endless", drift: 1 }, 5);
    const arena = plan(manualBeats(140, 60), { scroll: "arena", drift: 1 }, 5);
    for (const p of [endless, arena]) {
      for (let k = 0; k < p.count; k++) {
        expect(Math.abs(p.x[k])).toBeLessThanOrEqual(X_SAFE + 1e-9);
        const kind = BEAT_DROP_KINDS[p.kind[k]];
        expect(Math.abs(p.x[k]) + PAD_GEOMETRY[kind].halfWidth).toBeLessThan(0.5);
      }
    }
    for (let k = 1; k < endless.count; k++) expect(endless.y[k]).toBeGreaterThan(endless.y[k - 1]);
    for (let k = 0; k < arena.count; k++) expect(Math.abs(arena.y[k])).toBeLessThanOrEqual(ARENA_BAND + 1e-9);
    // No drift: straight down (except off a wedge, which always sends the ball sideways).
    const still = plan(manualBeats(120, 20), { drift: 0, kinds: ["plank", "block", "spring", "drum"] }, 3);
    for (let k = 0; k < still.count; k++) expect(still.x[k]).toBe(0);
    const wedges = plan(manualBeats(120, 20), { drift: 0, kinds: ["wedge"] }, 3);
    for (let k = 0; k + 1 < wedges.count; k++) {
      expect(Math.abs(wedges.x[k + 1] - wedges.x[k])).toBeGreaterThan(0.1);
      expect(Math.sign(wedges.x[k + 1] - wedges.x[k])).toBe(wedges.facing[k]);
    }
  });

  it("uses the mix (rarely the same kind twice in a row) and draws a fixed count of random numbers per landing", () => {
    const p = plan(manualBeats(120, 60), {}, 11);
    const used = new Set<number>();
    let repeats = 0;
    for (let k = 0; k < p.count; k++) {
      used.add(p.kind[k]);
      if (k > 0 && p.kind[k] === p.kind[k - 1]) repeats++;
    }
    expect(used.size).toBe(6);
    expect(repeats / p.count).toBeLessThan(0.15);
    const only = plan(manualBeats(120, 20), { kinds: ["spring", "drum"] }, 11);
    for (let k = 0; k < only.count; k++) expect(["spring", "drum"]).toContain(BEAT_DROP_KINDS[only.kind[k]]);
    let draws = 0;
    const base = rng(4);
    const counted = () => {
      draws++;
      return base();
    };
    const q = planBeatDrop({ beats: manualBeats(100, 30), period: 0.6, kinds: [...BEAT_DROP_KINDS], drift: 0.7, scroll: "endless", bounceHeight: 0.3, anticipation: 0.5, random: counted });
    expect(draws).toBe(2 + DRAWS_PER_LANDING * q.count);
  });

  it("a spring pad bounces higher in the same time; a drum pad a little", () => {
    const p = plan(manualBeats(100, 60), { scroll: "arena" }, 2);
    let springs = 0;
    for (let k = 0; k + 1 < p.count; k++) {
      const kind = BEAT_DROP_KINDS[p.kind[k]];
      const ratio = p.g[k] / p.gravity;
      if (kind === "spring") {
        springs++;
        expect(ratio).toBeCloseTo(PAD_GEOMETRY.spring.boost, 9);
      } else if (kind === "drum") expect(ratio).toBeCloseTo(PAD_GEOMETRY.drum.boost, 9);
      else expect(ratio).toBeCloseTo(1, 9);
    }
    expect(springs).toBeGreaterThan(3);
  });
});

describe("the obstructions", () => {
  const p = plan(manualBeats(128, 60), { anticipation: 0.8, drift: 0.8 }, 21);

  it("arrive before their beat, settle a hair before it and leave after it", () => {
    for (let k = 0; k < p.count; k++) {
      const prev = k > 0 ? p.t[k - 1] : 0;
      expect(p.arriveStart[k]).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(p.arriveEnd[k]).toBeGreaterThan(p.arriveStart[k]);
      expect(p.arriveEnd[k]).toBeLessThan(p.t[k]);
      expect(p.t[k] - p.arriveEnd[k]).toBeLessThanOrEqual(SETTLE_SEC + 1e-9);
      expect(p.leaveStart[k]).toBeGreaterThan(p.t[k]);
      expect(p.leaveEnd[k]).toBeGreaterThan(p.leaveStart[k]);
      // Before its window it is not there; at its beat it rests in place, fully drawn; after its window it is gone.
      expect(padPoseAt(p, k, p.arriveStart[k] - 1e-3).visible).toBe(false);
      const at = padPoseAt(p, k, p.t[k]);
      expect(at.visible).toBe(true);
      expect(at.phase).toBe(1);
      expect(at.ox).toBe(0);
      expect(at.oy).toBe(0);
      expect(at.alpha).toBe(1);
      expect(padPoseAt(p, k, p.leaveEnd[k] + 1e-3).visible).toBe(false);
    }
  });

  it("fly in from off-screen on the entry side, never from the ball's side, and slide away with a fade", () => {
    const entries = allowedEntries(0.3);
    expect(entries).not.toContain(BD_ENTRY_LEFT);
    expect(entries).toContain(BD_ENTRY_TOP);
    expect(allowedEntries(-0.3)).not.toContain(BD_ENTRY_RIGHT);
    expect(allowedEntries(0)).not.toContain(BD_ENTRY_TOP);
    expect(allowedEntries(0)).toEqual(expect.arrayContaining([BD_ENTRY_LEFT, BD_ENTRY_RIGHT, BD_ENTRY_BOTTOM]));
    const seen = new Set<number>();
    for (let k = 1; k < p.count; k++) {
      const dx = p.x[k] - p.x[k - 1];
      const e = p.entry[k];
      seen.add(e);
      if (dx > 1e-6) expect(e).not.toBe(BD_ENTRY_LEFT);
      if (dx < -1e-6) expect(e).not.toBe(BD_ENTRY_RIGHT);
      if (Math.abs(dx) < ENTRY_TOP_MIN_DX) expect(e).not.toBe(BD_ENTRY_TOP);
      const start = padPoseAt(p, k, p.arriveStart[k]);
      expect(Math.hypot(start.ox, start.oy)).toBeGreaterThan(1);
      if (e === BD_ENTRY_LEFT) expect(start.ox).toBeLessThan(-1);
      if (e === BD_ENTRY_RIGHT) expect(start.ox).toBeGreaterThan(1);
      if (e === BD_ENTRY_TOP) expect(start.oy).toBeLessThan(-1);
      if (e === BD_ENTRY_BOTTOM) expect(start.oy).toBeGreaterThan(1);
      const mid = padPoseAt(p, k, (p.leaveStart[k] + p.leaveEnd[k]) / 2);
      expect(mid.phase).toBe(2);
      expect(mid.alpha).toBeLessThan(1);
      expect(Math.sign(mid.ox)).toBe(p.leaveSide[k]);
    }
    expect(seen.size).toBe(4);
  });

  it("never pass through the ball: an arriving or leaving pad over the ball's column is always below it", () => {
    const S = 1;
    const r = 0.02;
    for (let k = 0; k < p.count; k++) {
      const kind = BEAT_DROP_KINDS[p.kind[k]] as BeatDropPadKind;
      const hw = PAD_GEOMETRY[kind].halfWidth;
      const from = p.arriveStart[k];
      const to = p.leaveEnd[k];
      for (let t = from; t <= to; t += 0.004) {
        const pose = padPoseAt(p, k, t);
        if (!pose.visible || pose.alpha < 0.05) continue;
        const ball = sampleBall(p, t);
        const px = p.x[k] + pose.ox;
        const top = p.y[k] + pose.oy + r;
        const overlapX = Math.abs(ball.x - px) < hw + r;
        // Over the pad's column the ball's bottom is never below the pad's top (a hair of slack at the contact itself).
        if (overlapX && Math.abs(t - p.t[k]) > 0.002) expect(ball.y + r, `pad ${k} at ${t.toFixed(3)}`).toBeLessThanOrEqual(top + 0.004 * S);
      }
    }
  });

  it("spinners are flat when the ball lands; pads squash on impact", () => {
    const spinners = plan(manualBeats(110, 20), { kinds: ["spinner"] }, 8);
    for (let k = 0; k < spinners.count; k++) {
      const mid = padPoseAt(spinners, k, (spinners.arriveStart[k] + spinners.arriveEnd[k]) / 2);
      expect(Math.abs(mid.angle)).toBeGreaterThan(0.1);
      expect(padPoseAt(spinners, k, spinners.arriveEnd[k]).angle).toBe(0);
      expect(padPoseAt(spinners, k, spinners.t[k]).angle).toBe(0);
    }
    const k = 5;
    // Pressed while the ball rests on it (the most at the end of the contact), then springing back.
    const pressed = padPoseAt(p, k, p.t[k] + p.contact[k]).squash;
    expect(pressed).toBeCloseTo(PAD_GEOMETRY[BEAT_DROP_KINDS[p.kind[k]]].squash, 9);
    expect(padPoseAt(p, k, p.t[k] + 0.3 * p.contact[k]).squash).toBeGreaterThan(0);
    expect(padPoseAt(p, k, p.t[k] + 0.3 * p.contact[k]).squash).toBeLessThan(pressed);
    expect(Math.abs(padPoseAt(p, k, p.t[k] + 2).squash)).toBeLessThan(0.01);
    // The ball rests on the pad during the contact, then flies.
    const resting = sampleBall(p, p.t[k] + 0.5 * p.contact[k]);
    expect(resting.x).toBe(p.x[k]);
    expect(resting.y).toBe(p.y[k]);
    expect(resting.vy).toBe(0);
    expect(sampleBall(p, p.t[k] + p.contact[k] + 0.01).vy).toBeLessThan(0);
    // The ball squashes flat on impact and stretches in flight.
    const hit = ballDeformAt(p, p.t[k] + p.contact[k]);
    expect(hit.squashY).toBeLessThan(0.8);
    expect(hit.squashX).toBeGreaterThan(1.1);
    const fly = ballDeformAt(p, p.t[k + 1] - 0.01);
    expect(fly.stretch).toBeGreaterThan(1.05);
    expect(Math.abs(fly.squashY - 1)).toBeLessThan(0.05);
  });

  it("the camera target glides from landing to landing", () => {
    expect(cameraTargetAt(p, p.t[3])).toBeCloseTo(p.y[3], 12);
    const mid = cameraTargetAt(p, (p.t[3] + p.t[4]) / 2);
    expect(mid).toBeCloseTo((p.y[3] + p.y[4]) / 2, 9);
    expect(landingIndexAt(p, p.t[3])).toBe(3);
    expect(landingIndexAt(p, p.t[3] - 1e-6)).toBe(2);
    expect(landingIndexAt(p, 0)).toBe(-1);
    expect(landingIndexAt(p, p.t[10] + 0.01, 4)).toBe(10);
  });
});

/* ------------------------------------------------------------------ sounds */

describe("sounds by beat position", () => {
  it("kick on 1 and 3, snare on the backbeats 2 and 4, the downbeat accented", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map((i) => drumForBeat(i))).toEqual([BD_DRUM_KICK, BD_DRUM_SNARE, BD_DRUM_KICK, BD_DRUM_SNARE, BD_DRUM_KICK, BD_DRUM_SNARE, BD_DRUM_KICK, BD_DRUM_SNARE]);
    expect([0, 4, 8, -4].map((i) => isDownbeat(i))).toEqual([true, true, true, true]);
    expect([1, 2, 3, 5].some((i) => isDownbeat(i))).toBe(false);
    expect(barPosition(-1)).toBe(3);
  });

  it("drums, melody or both per landing; hats on the off-beats", () => {
    const drums = landingSounds("drums", "spring", BD_DRUM_KICK, true, 0, "chromatic", 0, []);
    expect(drums).toHaveLength(1);
    expect(drums[0]).toMatchObject({ type: "hit", bdDrum: "kick", bdPad: "spring", accent: true, melody: false });
    expect(drums[0].frequency).toBeCloseTo(padAccentPitch("spring", "chromatic", 0), 9);
    const melody = landingSounds("melody", "plank", BD_DRUM_SNARE, false, 3, "major", 2, []);
    expect(melody).toHaveLength(1);
    expect(melody[0].bdDrum).toBeUndefined();
    expect(melody[0].melody).toBeUndefined();
    expect(melody[0].frequency).toBeCloseTo(melodyPitch(3, "major", 2), 9);
    expect(landingSounds("both", "drum", BD_DRUM_SNARE, false, 1, "chromatic", 0, []).map((e) => e.bdDrum)).toEqual(["snare", undefined]);
  });

  it("the engine queues each landing's sounds in the step that holds its beat, hats between", () => {
    for (const sound of ["drums", "melody", "both"] as const) {
      const engine = engineFor({ sound, bpm: 120, clipSec: 12 }, 5);
      const view = engine.getBeatDropView();
      const events: { t: number; ev: SoundEvent }[] = [];
      for (let i = 0; i < 60 * 11; i++) {
        const before = engine.getElapsedMs();
        engine.update(STEP, 0);
        for (const ev of engine.consumeSoundEvents()) events.push({ t: before, ev });
      }
      const landings = events.filter((e) => e.ev.bdDrum === "kick" || e.ev.bdDrum === "snare" || (e.ev.bdDrum === undefined && sound === "melody"));
      const beats = view.plan;
      const n = view.landed;
      expect(n).toBe(landingIndexAt(beats, engine.getElapsedMs() / 1000 + 1e-9) + 1);
      expect(landings.length).toBe(n);
      landings.forEach((e, k) => {
        // The beat lies inside the step the event was queued in.
        expect(1000 * beats.t[k]).toBeGreaterThan(e.t - 1e-6);
        expect(1000 * beats.t[k]).toBeLessThanOrEqual(e.t + STEP + 1e-6);
        if (e.ev.bdDrum) expect(e.ev.bdDrum).toBe(beats.drum[k] === BD_DRUM_KICK ? "kick" : "snare");
      });
      const hats = events.filter((e) => e.ev.bdDrum === "hat").length;
      const notes = events.filter((e) => e.ev.type === "hit" && e.ev.bdDrum === undefined).length;
      if (sound === "melody") expect(hats).toBe(0);
      else expect(Math.abs(hats - n)).toBeLessThanOrEqual(1);
      expect(notes).toBe(sound === "drums" ? 0 : n);
      expect(view.kicks + view.snares).toBe(sound === "melody" ? 0 : n);
    }
  });

  it("the voices: with a music bed only the downbeat's kick and the accents play", () => {
    expect(beatDropVoices("kick", true, false, true)).toEqual({ kick: 1, snare: 0, hat: 0, accent: 1 });
    expect(beatDropVoices("snare", true, false, false)).toEqual({ kick: 0, snare: 1, hat: 0, accent: 0.85 });
    expect(beatDropVoices("hat", false, false, false)).toEqual({ kick: 0, snare: 0, hat: 1, accent: 0 });
    expect(beatDropVoices("snare", true, true, false)).toEqual({ kick: 0, snare: 0, hat: 0, accent: 0.85 });
    expect(beatDropVoices("hat", false, true, false)).toEqual({ kick: 0, snare: 0, hat: 0, accent: 0 });
    expect(beatDropVoices("kick", true, true, true).kick).toBeGreaterThan(0);
    expect(beatDropVoices("kick", true, true, false).kick).toBe(0);
  });
});

describe("the drum kit through the ToneGenerator", () => {
  afterEach(() => vi.unstubAllGlobals());

  function setup() {
    const graph = fakeGraph();
    const filters: { type: string; frequency: number }[] = [];
    const ctx = graph.ctx as unknown as Record<string, unknown>;
    ctx.createBiquadFilter = () => {
      const f = { type: "lowpass", frequency: { value: 0 }, Q: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
      filters.push(f as unknown as { type: string; frequency: number });
      return f;
    };
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    return { graph, filters };
  }

  it("a kick, a snare, a hat and every pad's accent, snapped to the scale", async () => {
    const { graph, filters } = setup();
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 0 });
    tone.playBeatDrop("kick", undefined, undefined, true);
    expect(graph.oscillators.map((o) => o.frequency)).toEqual([KICK_TONE.start, KICK_TONE.clickFrequency]);
    graph.oscillators.length = 0;
    tone.playBeatDrop("snare", undefined);
    expect(graph.sources.length).toBe(1);
    expect(graph.oscillators.map((o) => o.frequency)).toEqual([SNARE_TONE.bodyFrequency]);
    tone.playBeatDrop("hat", undefined);
    expect(graph.sources.length).toBe(2);
    expect(filters.every((f) => (f.type as string) === "highpass")).toBe(true);
    graph.oscillators.length = 0;
    // The accent's pitch is snapped to C major: C#5 (554 Hz) becomes a scale note.
    tone.playBeatDrop("none", "spring", 554.37);
    const accent = graph.oscillators.find((o) => o.type === "sine" && o.frequency > 100);
    expect(accent).toBeDefined();
    const midi = Math.round(69 + 12 * Math.log2(accent!.frequency / 440));
    expect([0, 2, 4, 5, 7, 9, 11]).toContain(((midi % 12) + 12) % 12);
    for (const kind of BEAT_DROP_KINDS) {
      graph.oscillators.length = 0;
      tone.playBeatDrop("none", kind, 440);
      expect(graph.oscillators[0].type).toBe(PAD_ACCENTS[kind].wave);
      expect(graph.oscillators[0].frequency).toBeCloseTo(accentStartFrequency(kind, 440), 6);
    }
  });

  it("the fast export's dispatch routes a Beat Drop event to the drum kit, the landing's note to the melody", async () => {
    setup();
    const tone = new ToneGenerator();
    await tone.start();
    const drum = vi.spyOn(tone, "playBeatDrop");
    const hit = vi.spyOn(tone, "playWallHit");
    playSoundEvent(tone, { type: "hit", wallIndex: 0, frequency: 330, bdDrum: "snare", bdPad: "plank", melody: false }, () => undefined);
    playSoundEvent(tone, { type: "hit", wallIndex: 0, bdDrum: "hat", melody: false, level: 0.7 }, () => undefined);
    playSoundEvent(tone, { type: "hit", wallIndex: 0, frequency: 262 }, () => undefined);
    expect(drum.mock.calls).toEqual([
      ["snare", "plank", 330, undefined, undefined],
      ["hat", undefined, undefined, undefined, 0.7],
    ]);
    expect(hit).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ whole runs */

describe("runs in the engine", () => {
  it("lands every beat of a 20 s run at 120 BPM on the beat (measured from the ball's sampled states)", () => {
    const engine = engineFor({ bpm: 120, clipSec: 30 }, 3);
    const view = engine.getBeatDropView();
    const S = view.field.size;
    let prev: { t: number; y: number; vy: number } | null = null;
    const landings: number[] = [];
    for (let i = 0; i < 60 * 20; i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      const b = engine.getBalls()[0];
      const now = { t: engine.getElapsedMs() / 1000, y: b.y, vy: b.vy };
      // A landing between two steps: coming down, then resting on the pad (the contact) or already going up. Solve the
      // incoming arc from the state before it.
      if (prev && prev.vy > 0 && now.vy <= 0) {
        const k = landingIndexAt(view.plan, now.t);
        const g = k > 0 ? view.plan.g[k - 1] : view.plan.startG;
        const landY = view.field.originY + view.plan.y[k] * S;
        landings.push(prev.t + descendingRoot(prev.vy / S, g, (landY - prev.y) / S));
      }
      prev = now;
    }
    const expected = manualBeats(120, 20).filter((t) => t >= LEAD_IN_SEC);
    expect(landings.length).toBe(expected.length);
    landings.forEach((t, k) => expect(Math.abs(t - expected[k]) * 1000).toBeLessThan(1));
    expect(view.landed).toBe(expected.length);
    expect(view.maxErrorMs).toBeLessThan(1e-3);
    // The landing log (the canvas' data-bd-landing-times) holds the measured landings of the beats.
    const n = Math.min(view.logCount, view.landingMs.length);
    for (let i = 0; i < n; i++) {
      const slot = (view.logCount - n + i) % view.landingMs.length;
      expect(Math.abs(view.landingMs[slot] - view.beatMs[slot])).toBeLessThan(1);
      expect(view.beatMs[slot] % 500).toBeCloseTo(0, 6);
    }
  });

  it("is deterministic for a seed, and different seeds lay out different runs", () => {
    const run = (seed: number) => {
      const engine = engineFor({}, seed);
      const out: number[] = [];
      for (let i = 0; i < 60 * 6; i++) {
        engine.update(STEP, 0);
        if (i % 20 === 0) out.push(engine.getBalls()[0].x, engine.getBalls()[0].y);
      }
      return { out, plan: engine.getBeatDropView().plan };
    };
    const a = run(99);
    const b = run(99);
    const c = run(100);
    expect(a.out).toEqual(b.out);
    expect(Array.from(a.plan.x.subarray(0, a.plan.count))).toEqual(Array.from(b.plan.x.subarray(0, b.plan.count)));
    expect(Array.from(a.plan.kind.subarray(0, 20))).toEqual(Array.from(b.plan.kind.subarray(0, 20)));
    expect(a.out).not.toEqual(c.out);
    // Every seed lands on the same beats.
    expect(Array.from(a.plan.t.subarray(0, a.plan.count))).toEqual(Array.from(c.plan.t.subarray(0, c.plan.count)));
  });

  it("a resize keeps every landing on its beat and the ball on its planned arc", () => {
    const plain = engineFor({ bpm: 132 }, 4);
    const resized = engineFor({ bpm: 132 }, 4);
    for (let i = 0; i < 60 * 12; i++) {
      if (i === 150) resized.setConfig({ width: 1080, height: 1920 });
      if (i === 400) resized.setConfig({ width: 390, height: 700 });
      plain.update(STEP, 0);
      resized.update(STEP, 0);
    }
    const a = plain.getBeatDropView();
    const b = resized.getBeatDropView();
    expect(b.landed).toBe(a.landed);
    expect(Array.from(b.beatMs)).toEqual(Array.from(a.beatMs));
    expect(b.maxErrorMs).toBeLessThan(1e-3);
    // The ball sits where the plan says in the new layout.
    const s = sampleBall(b.plan, resized.getElapsedMs() / 1000);
    const ball = resized.getBalls()[0];
    expect(ball.x).toBeCloseTo(b.field.cx + s.x * b.field.size, 6);
    expect(ball.y).toBeCloseTo(b.field.originY + s.y * b.field.size, 6);
    expect(b.field.size).toBe(390);
  });

  it("ends on the clip's last landing (plus the hold), then plays nothing more", () => {
    const engine = engineFor({ bpm: 100, clipSec: 10 }, 1);
    const view = engine.getBeatDropView();
    const times = beatDropLandingTimes({ bpm: 100 });
    const { finishSec, beats } = beatDropFinishSec(times, times.length, 10);
    expect(finishSec).toBeCloseTo(9.6 + END_HOLD_SEC - 0.6 + 0, 9);
    expect(view.plannedLandings).toBe(beats);
    expect(engine.getBeatDropProgress().plannedMs).toBeCloseTo(1000 * finishSec, 6);
    let events = 0;
    let finishedAt = -1;
    for (let i = 0; i < 60 * 14; i++) {
      engine.update(STEP, 0);
      const evs = engine.consumeSoundEvents();
      if (finishedAt >= 0) events += evs.length;
      if (finishedAt < 0 && engine.isSimulationFinished()) finishedAt = engine.getElapsedMs();
    }
    expect(finishedAt).toBeGreaterThanOrEqual(1000 * finishSec - 1e-6);
    expect(finishedAt).toBeLessThan(1000 * finishSec + STEP + 1e-6);
    expect(events).toBe(0);
    expect(view.landed).toBe(beats);
    // A live change of the clip moves the end.
    const longer = engineFor({ bpm: 100, clipSec: 10 }, 1);
    longer.setBeatDropSettings({ clipSec: 20 });
    expect(longer.getBeatDropProgress().plannedMs / 1000).toBeGreaterThan(19);
  });

  it("follows a song's grid with its offset (the adapter), and re-plans only when what it follows changes", () => {
    const beatTimes: number[] = [];
    for (let t = 0.25; t < 60; t += 60 / 128) beatTimes.push(t);
    const grid: BeatGrid = { bpm: 128, beatTimes, duration: 60 };
    const cfg = beatDropBeatConfig({ bpm: 90, grid, offset: 2, loop: false });
    expect(cfg.source).toBe("song");
    const { times } = beatDropBeats(cfg, 0, 20);
    expect(times[0]).toBeCloseTo(beatTimes.find((b) => b >= 2)! - 2, 9);
    const engine = engineFor({ bpm: 90, grid, offset: 2, loop: false }, 2);
    const view = engine.getBeatDropView();
    expect(view.song).toBe(true);
    expect(view.bpm).toBe(128);
    expect(view.plan.t[0]).toBeCloseTo(keptBeats(times)[0], 9);
    expect(beatDropBeatConfig({ bpm: 90, grid: null, offset: 2, loop: false }).source).toBe("bpm");
    const key = (patch: Partial<BeatDropSettings>) => beatDropPlanKeyOf({ ...DEFAULT_BEAT_DROP_SETTINGS, ...patch });
    expect(sameBeatDropPlan(key({}), key({ sound: "drums", colorMode: "rainbow", trail: false, clipSec: 60 }))).toBe(true);
    expect(sameBeatDropPlan(key({}), key({ drift: 0.9 }))).toBe(false);
    expect(sameBeatDropPlan(key({}), key({ bpm: 121 }))).toBe(false);
    // The BPM does not matter while a song's grid is followed.
    expect(sameBeatDropPlan(key({ grid, bpm: 100 }), key({ grid, bpm: 140 }))).toBe(true);
  });
});

/* ------------------------------------------------------------------ the renderer's frame */

describe("the renderer draws between steps", () => {
  it("the ball of a frame is where the plan has it at the engine's time plus the accumulator (no allocation)", () => {
    const engine = engineFor({}, 6);
    for (let i = 0; i < 100; i++) engine.update(STEP, 0);
    const view = engine.getBeatDropView();
    const layer = new BeatDropLayer();
    const opts = { wallThickness: 2, showWallGlow: true, showTrail: true, trailThickness: 0.8, colorTrail: true, teamColors: [] as string[], ballColor: "#ffffff" };
    layer.beginFrame(view, engine.getElapsedMs(), 8);
    const first = layer.frameBalls(engine.getBalls(), view, opts);
    const s = sampleBall(view.plan, (engine.getElapsedMs() + 8) / 1000);
    expect(first[0].x).toBeCloseTo(view.field.cx + s.x * view.field.size, 9);
    expect(first[0].y).toBeCloseTo(view.field.originY + s.y * view.field.size, 9);
    expect(first[0].y).not.toBeCloseTo(engine.getBalls()[0].y, 3);
    expect(first[0].trail.length).toBe(0);
    layer.beginFrame(view, engine.getElapsedMs(), 0);
    const second = layer.frameBalls(engine.getBalls(), view, { ...opts, teamColors: ["#ef4444"] });
    expect(second).toBe(first);
    expect(second[0].y).toBeCloseTo(engine.getBalls()[0].y, 9);
    expect(second[0].color).toBe("#ef4444");
    expect(layer.time()).toBeCloseTo(engine.getElapsedMs() / 1000, 12);
  });
});

/* ------------------------------------------------------------------ settings, registration, finder */

describe("settings, URL and presets", () => {
  it("defaults, ranges and the mode's own ball size", () => {
    expect(defaultBeatDropFields()).toEqual({ bdKinds: "plank,block,spring,wedge,spinner,drum", bdDrift: 0.5, bdScroll: "endless", bdBounceHeight: 0.24, bdAnticipation: 0.6, bdSound: "both", bdColorMode: "pad", bdTrail: true });
    for (const key of Object.keys(BEAT_DROP_RANGES) as (keyof typeof BEAT_DROP_RANGES)[]) expect(RANGES[key]).toEqual(BEAT_DROP_RANGES[key]);
    expect(RANGES.bdAnticipation).toMatchObject({ min: 0.3, max: 1 });
    expect(defaultSettings("beatDrop").ballRadius).toBe(BEAT_DROP_BALL_RADIUS);
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      if (mode !== "beatDrop" && mode !== "powerLayers") expect(d.ballRadius).toBe(8);
      expect(resolveBeatDropFields(d)).toEqual(defaultBeatDropFields());
      const params = settingsToSearchParams(d);
      for (const key of ["bdk", "bdd", "bds", "bdh", "bda", "bdsn", "bdc", "bdt"]) expect(params.has(key)).toBe(false);
    }
  });

  it("the mix: known kinds, each once, in order, never empty; toggling keeps one", () => {
    expect(parseBeatDropKinds("drum, plank,nope,plank")).toEqual(["plank", "drum"]);
    expect(parseBeatDropKinds("")).toEqual([...BEAT_DROP_KINDS]);
    expect(serializeBeatDropKinds(["spring", "block"])).toBe("block,spring");
    expect(toggleBeatDropKind("plank,block", "block")).toBe("plank");
    expect(toggleBeatDropKind("plank", "plank")).toBe("plank");
    expect(toggleBeatDropKind("plank", "drum")).toBe("plank,drum");
  });

  it("resolve clamps onto the sliders and drops bad values", () => {
    expect(resolveBeatDropSettings({ drift: 7, bounceHeight: 0, anticipation: 2 })).toMatchObject({ drift: 7, bounceHeight: 0.1, anticipation: 2 }); // --- uncap-all --- (no maximum)
    expect(resolveBeatDropSettings({ drift: 0.333, anticipation: 0.42 })).toMatchObject({ drift: 0.35, anticipation: 0.4 });
    const junk = { scroll: "sideways", sound: "loud", colorMode: "plaid", trail: "yes", kinds: 5 } as unknown as Partial<BeatDropSettings>;
    expect(resolveBeatDropSettings(junk)).toEqual(DEFAULT_BEAT_DROP_SETTINGS);
    expect(beatDropSettingsOf({ ...defaultBeatDropFields(), bpm: 90, scale: "minor", rootNote: 3, recordingDuration: 45 })).toMatchObject({ bpm: 90, scale: "minor", rootNote: 3, clipSec: 45, grid: null });
  });

  it("round-trips through bdk / bdd / bds / bdh / bda / bdsn / bdc / bdt and presets", () => {
    const s = { ...defaultSettings("beatDrop"), bdKinds: "spring,drum", bdDrift: 0.8, bdScroll: "arena" as const, bdBounceHeight: 0.33, bdAnticipation: 0.85, bdSound: "drums" as const, bdColorMode: "rainbow" as const, bdTrail: false };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("beatDrop");
    expect(params.get("bdk")).toBe("spring,drum");
    expect(params.get("bdd")).toBe("0.8");
    expect(params.get("bds")).toBe("arena");
    expect(params.get("bdh")).toBe("0.33");
    expect(params.get("bda")).toBe("0.85");
    expect(params.get("bdsn")).toBe("drums");
    expect(params.get("bdc")).toBe("rainbow");
    expect(params.get("bdt")).toBe("0");
    expect(settingsFromSearchParams(params)).toEqual(s);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=beatDrop&bdk=lava&bdd=9&bds=up&bdh=abc&bda=0.1&bdsn=x&bdc=y&bdt=2"));
    expect(resolveBeatDropFields(bad)).toEqual({ ...defaultBeatDropFields(), bdDrift: 9, bdAnticipation: 0.3 }); // --- uncap-all --- (9 is kept)
    const preset = presetToSettings({ mode: "beatDrop", bdKinds: "wedge,wedge", bdDrift: -1, bdTrail: "no", bdSound: "melody" } as unknown as Parameters<typeof presetToSettings>[0]);
    expect(resolveBeatDropFields(preset)).toMatchObject({ bdKinds: "wedge", bdDrift: 0, bdTrail: true, bdSound: "melody" });
  });

  it("the mode is registered: a rhythm card right after Paddle Keep-Up", () => {
    expect(MODE_IDS).toContain("beatDrop");
    expect(MODE_CATEGORIES.beatDrop).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("beatDrop")).toBe(MODE_CARD_ORDER.indexOf("paddle") + 1);
    expect(modesInCategory("rhythm")).toContain("beatDrop");
    expect(new Set(MODE_CARD_ORDER).size).toBe(MODE_CARD_ORDER.length);
  });
});

describe("Find Simulation", () => {
  const request = (target: number, patch: Partial<BeatDropSettings> = {}): FinderRequest => ({
    targetDurationSec: target,
    toleranceSec: 0.5,
    maxSeeds: 1000,
    maxSimTimeSec: target + 30,
    physicsConfig: config,
    mode: "beatDrop",
    modeSettings: { ...baseModeSettings, beatDrop: patch },
  });

  it("never fails: the first seed covers the target's beats, and the run keeps the promise", async () => {
    expect(runNeverFinishes("beatDrop", {} as never)).toBe(false);
    for (const [bpm, target] of [
      [120, 30],
      [60, 45],
      [200, 32],
    ] as const) {
      const result = await findSimulation(request(target, { bpm }), () => undefined);
      expect(result.found).toBe(true);
      expect(result.seedsTested).toBe(1);
      expect(result.duration).toBeLessThanOrEqual(target + 1e-9);
      expect(result.duration).toBeGreaterThan(target - 60 / bpm - END_HOLD_SEC - 1e-9);
      const info = beatDropRunInfo({ bpm, clipSec: target });
      expect(result.duration).toBeCloseTo(info.seconds, 9);
      // The run of that seed with the clip set to the found length (rounded up, as the page does) ends when promised.
      const engine = engineFor({ bpm, clipSec: Math.ceil(result.duration) }, result.seed);
      expect(simulateSeed(result.seed, { ...request(target, { bpm, clipSec: Math.ceil(result.duration) }) }, 200000)).toBeCloseTo(engine.getBeatDropProgress().plannedMs, 6);
      let t = 0;
      while (!engine.isSimulationFinished() && t < 200000) {
        engine.update(STEP, 0);
        t += STEP;
      }
      expect(Math.abs(t / 1000 - result.duration)).toBeLessThan(STEP / 1000 + 1e-6);
    }
  });
});

/* ------------------------------------------------------------------ --- video-beats --- the beat source */

describe("the beat source (video-beats): hand-placed markers", () => {
  // A tapped grid around 100 BPM from 0.25 s: the gaps wander by a few milliseconds.
  const markersMs: number[] = [];
  for (let i = 0, t = 250; i < 40; i++, t += [590, 612, 598, 605][i % 4]) markersMs.push(t);
  const settingsWith = (patch: Partial<ReturnType<typeof defaultSettings>>) => ({ ...defaultSettings("beatDrop"), bpm: 140, beatMarkers: serializeMarkers(markersMs), ...patch });

  it("lands every landing on a marker, resolved the way the page resolves the Manual source without a music bed", () => {
    const settings = settingsWith({ beatSource: "manual" });
    const beat = markerBeatInputOf(settings);
    expect(beat).not.toBeNull();
    expect(beat!.offset).toBe(0);
    expect(beat!.loop).toBe(false);
    expect(beat!.grid.beatTimes).toEqual(markersMs.map((ms) => ms / 1000));
    const bd = beatDropSettingsOf(settings, beat);
    expect(beatDropBeatConfig(bd).source).toBe("song");
    const engine = createEngineForSettings(config, "beatDrop", { ...baseModeSettings, beatDrop: bd }, 5);
    const view = engine.getBeatDropView();
    expect(view.song).toBe(true);
    // The tempo is the markers' (their median gap), not the BPM setting's 140.
    expect(beat!.grid.bpm).toBeGreaterThan(98);
    expect(beat!.grid.bpm).toBeLessThan(102);
    expect(view.bpm).toBeCloseTo(beat!.grid.bpm, 9);
    // The plan lands on the markers (the ones after the lead-in), in order.
    const kept = keptBeats(markersMs.map((ms) => ms / 1000));
    for (let k = 0; k < kept.length; k++) expect(view.plan.t[k]).toBeCloseTo(kept[k], 9);
    // And the run measures every landing on its marker.
    for (let i = 0; i < 60 * 15; i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
    }
    expect(view.landed).toBe(kept.filter((t) => t <= 15 - 0.1).length);
    expect(view.maxErrorMs).toBeLessThan(1e-3);
    const n = Math.min(view.logCount, view.landingMs.length);
    expect(n).toBeGreaterThan(0);
    for (let i = 0; i < n; i++) {
      const slot = (view.logCount - n + i) % view.landingMs.length;
      expect(markersMs.some((ms) => Math.abs(ms - view.beatMs[slot]) < 1e-6)).toBe(true);
      expect(Math.abs(view.landingMs[slot] - view.beatMs[slot])).toBeLessThan(1);
    }
  });

  it("the bot's finder request follows the markers only for the Manual source (else the BPM), for Beat Drop and the Beat Runner", () => {
    const manual = modeSettingsOfSettings(settingsWith({ beatSource: "manual" }));
    expect(manual.beatDrop?.grid?.beatTimes).toEqual(markersMs.map((ms) => ms / 1000));
    expect(manual.runner?.grid?.beatTimes).toEqual(markersMs.map((ms) => ms / 1000));
    for (const beatSource of ["song", "media", "bpm"] as const) {
      const other = modeSettingsOfSettings(settingsWith({ beatSource }));
      expect(other.beatDrop?.grid ?? null).toBeNull();
      expect(other.beatDrop?.bpm).toBe(140);
      expect(other.runner?.grid ?? null).toBeNull();
    }
    // Fewer than two markers is no grid: the BPM again.
    expect(markerBeatInputOf(settingsWith({ beatSource: "manual", beatMarkers: "250" }))).toBeNull();
  });
});
