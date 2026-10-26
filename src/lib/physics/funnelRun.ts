import type { Ball, LoopSeams, ModeContext, SoundEvent } from "./types";
import type { VortexField, VortexSettings, VortexView } from "./modes/vortex";
import { grooveProgression } from "@/lib/audio/loopTones";
import { midiToFrequency } from "@/lib/audio/scales";
import {
  FS_BED_ROOT_MIDI,
  FS_CHIME_LEVEL,
  FS_ENTRY_AT,
  FS_HISS_EVERY_STEPS,
  FS_HISS_REF_BALLS,
  FS_KICK_LEVEL,
  FS_MAX_FLIGHT_FACTOR,
  FS_WASH_LEAD_SEC,
  FS_WASH_LEVEL,
  FS_WAVE_TWIST,
  bedBeat,
  chimeDegree,
  chimeHz,
  createFunnelFrame,
  funnelFrame,
  funnelLapGain,
  funnelStepTiming,
  hissLevel,
  lapRate,
  marbleColor,
  marbleHue,
  projectFunnel,
  pullExponent,
  pullStrength,
  releaseSpin,
  slipRate,
  stepFunnel,
  wavesForRun,
  wavesTotal,
  type FsRelease,
  type FsView,
  type FunnelFrame,
  type FunnelState,
} from "./funnelSpin";

/*
 * --- funnel-spin --- The Sound Vortex's ring release (lib/physics/modes/vortex.ts delegates to `FunnelRingRun` while its release
 * is "rings") and the perspective placement both releases share (`placeFunnelPerspective()`). The pure maths – the matched
 * spiral, the waves, the loop's timing, the sounds' rules and the projection – live in funnelSpin.ts.
 *
 * A ring run, step by step (all on the simulation clock, the cycle's time τ counted from its start):
 *  - onPreUpdate: the waves due by the step's start are released – n marbles at the entry radius, evenly spaced, with the same
 *    (r, r′, L): one polar state a wave, in rim units, so the run is the same at every canvas size;
 *  - onPostUpdate: every wave in flight is advanced once by the step (`stepFunnel()`) and its marbles are placed from it (the
 *    angle of marble i of n is the wave's + 2π·i/n: a perfect ring); a wave whose first marble crossed θ = 0 plays its lap
 *    chime (pitched by its lap rate), a wave at the hole is swallowed; the sounds of the step are queued – the groove bed's
 *    chord at every bar and its kick on the beats after the first bar, the rolling hiss' level every FS_HISS_EVERY_STEPS steps,
 *    the noise wash FS_WASH_LEAD_SEC before the refill – and, at the end of the step that reaches the cycle, the seam: the
 *    funnel resets to the run's first frame (the first wave on the rim again) after the loop voices' hard cut.
 *
 * Random choices (`ctx.random()`, after the Sound Vortex's three init draws – the direction, the tempo, the first angle – so a
 * stagger run's sequence is unchanged): the groove bed's progression, at init.
 */

/** A wave's state (`FunnelView.waveState`): waiting for its release, in the funnel, swallowed. */
export const WAVE_WAITING = 0;
export const WAVE_FLYING = 1;
export const WAVE_SWALLOWED = 2;
/** A marble slot's state, as the Sound Vortex's (`VortexView.slotState`). */
const SLOT_WAITING = 0;
const SLOT_FLYING = 1;
const SLOT_SWALLOWED = 2;

/* --- review fix (uncap-all) --- The Sound Vortex's depth cue, here so both releases read one formula (vortex.ts re-exports it). */

/** At a depth cue of 1 (the slider's end) a ball shrinks to 1 − `DEPTH_SHRINK` of its size by the hole. */
export const DEPTH_SHRINK = 0.6;
/**
 * The smallest share of its size the depth cue shrinks a ball to. The cue itself has no maximum (it stopped at 1, the slider's
 * end, so 1.5 played like 1); past 1 / DEPTH_SHRINK a ball by the hole would reach radius 0 or below, so the size stops here.
 */
export const MIN_DEPTH_RADIUS = 0.05;

/** A ball's size factor at depth `depth` (0–1) with the depth cue `depthScale` (0 and up): 1 − DEPTH_SHRINK · cue · depth, at least MIN_DEPTH_RADIUS. */
export function depthRadiusScale(depth: number, depthScale: number): number {
  const shrink = DEPTH_SHRINK * (depthScale > 0 ? depthScale : 0) * Math.max(0, Math.min(1, depth));
  if (!(shrink > 0)) return 1;
  const scale = 1 - shrink;
  return scale > MIN_DEPTH_RADIUS ? scale : MIN_DEPTH_RADIUS;
}

/** What the canvas, the HUD and the tests read of the ring release and the perspective view (the same object every call). */
export interface FunnelView {
  /** The live view options. */
  release: FsRelease;
  view: FsView;
  elevation: number;
  depth: number;
  lapReadout: boolean;
  /** The perspective's layout (updated by a resize and a change of the view). */
  frame: FunnelFrame;
  /** The ring run's waves: size, first slot, state, polar state (rim units: radius, the turn since the release, L), release time, laps. */
  waveCount: number;
  waveSize: Int32Array;
  waveFirst: Int32Array;
  waveState: Uint8Array;
  waveR: Float64Array;
  waveTurn: Float64Array;
  waveL: Float64Array;
  waveTheta0: Float64Array;
  waveReleasedMs: Float64Array;
  waveLaps: Int32Array;
  /** The marble slots' waves. */
  slotWave: Int32Array;
  /** The run's constants: the descent (s), the lap gain, the lap rates at the release and at the hole (rad/s). */
  descentSec: number;
  lapGain: number;
  omega0: number;
  omegaEnd: number;
  /** The cycle (s, whole steps; Infinity without friction) and its start (simulation ms). */
  cycleSec: number;
  cycleStartMs: number;
  /** The loop's seams so far, the last one's time (ms; −1 before the first) and the next one's (−1: none). */
  seams: number;
  lastSeamMs: number;
  nextSeamMs: number;
  /** Marbles swallowed in the current cycle, and in the first cycle by its seam (−1 until then). */
  cycleSwallowed: number;
  firstCycleSwallowed: number;
  /** The refills (the first wave released again at a seam) and the last one's time (ms). */
  refills: number;
  lastRefillMs: number;
  /** Sounds: lap chimes, washes (and the last one's time), kicks, bed chords, the hiss' level (0–1), the bed playing. */
  lapChimes: number;
  washes: number;
  lastWashMs: number;
  kicks: number;
  bedChords: number;
  hiss: number;
  bedOn: boolean;
  /** The newest ring in the funnel (−1: none) and its current lap (s; Infinity: none). */
  newestWave: number;
  lapSec: number;
  /** Sound events queued so far (a fast export's parity check). */
  sounds: number;
}

export function createFunnelView(): FunnelView {
  return {
    release: "stagger",
    view: "top",
    elevation: 25,
    depth: 1,
    lapReadout: false,
    frame: createFunnelFrame(),
    waveCount: 0,
    waveSize: new Int32Array(0),
    waveFirst: new Int32Array(0),
    waveState: new Uint8Array(0),
    waveR: new Float64Array(0),
    waveTurn: new Float64Array(0),
    waveL: new Float64Array(0),
    waveTheta0: new Float64Array(0),
    waveReleasedMs: new Float64Array(0),
    waveLaps: new Int32Array(0),
    slotWave: new Int32Array(0),
    descentSec: 0,
    lapGain: 1,
    omega0: 0,
    omegaEnd: 0,
    cycleSec: Infinity,
    cycleStartMs: 0,
    seams: 0,
    lastSeamMs: -1,
    nextSeamMs: -1,
    cycleSwallowed: 0,
    firstCycleSwallowed: -1,
    refills: 0,
    lastRefillMs: -1,
    lapChimes: 0,
    washes: 0,
    lastWashMs: -1,
    kicks: 0,
    bedChords: 0,
    hiss: 0,
    bedOn: false,
    newestWave: -1,
    lapSec: Infinity,
    sounds: 0,
  };
}

/** Copies the live view options of `s` into the view and lays the perspective out for the field (no allocation). */
export function updateFunnelFrame(view: FunnelView, field: VortexField, s: Pick<VortexSettings, "release" | "view" | "elevation" | "funnelDepth" | "lapReadout">) {
  view.release = s.release;
  view.view = s.view;
  view.elevation = s.elevation;
  view.depth = s.funnelDepth;
  view.lapReadout = s.lapReadout;
  funnelFrame(field.cx, field.cy, field.rim, field.hole, s.elevation, s.funnelDepth, view.frame);
}

const SCRATCH_POINT = { x: 0, y: 0 };

/**
 * Places a marble at radius `r` (px), angle `theta` of the perspective view: the ball's position is its projection, its radius
 * the Ball Size times the fit, its velocity the top view's (the faces look along it); the view's slot arrays follow.
 */
export function placeFunnelPerspective(v: VortexView, ball: Ball, slot: number, r: number, theta: number, vr: number, vt: number, baseRadius: number) {
  const f = v.funnel.frame;
  const p = projectFunnel(f, r, theta, SCRATCH_POINT);
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  ball.x = p.x;
  ball.y = p.y;
  ball.vx = vr * c - vt * sn;
  ball.vy = vr * sn + vt * c;
  ball.radiusScale = f.scale;
  ball.radius = baseRadius * f.scale;
  ball.color = v.slotColor[slot];
  v.slotR[slot] = r;
  v.slotTheta[slot] = theta;
  v.slotX[slot] = p.x;
  v.slotY[slot] = p.y;
}

/** The ring release of the Sound Vortex (see the file's comment): the mode hands it its view and calls it while the release is "rings". */
export class FunnelRingRun {
  /** The run's constants (rim units): entry and hole, the release's L, the pull, the drags. */
  private entry = FS_ENTRY_AT;
  private hole = 0.25;
  private L0 = 1;
  private pullC = 1;
  private pullP = pullExponent();
  private kr = 0;
  private kL = 0;
  private interval = 4.5;
  private dir = 1;
  private phase = 0;
  private clockMs = 0;
  private stepStartMs = 0;
  private steps = 0;
  private lastStepMs = 1000 / 60;
  private bedDirty = false;
  private progression: { root: number; minor: boolean }[] = [];
  private chord = 0;
  private ballId = new Int32Array(0);
  private readonly slotOfId = new Map<number, number>();
  private readonly swallowedIds = new Set<number>();
  private readonly state: FunnelState = { r: 0, vr: 0, turn: 0, L: 0 };
  private waveVr = new Float64Array(0);

  /** A fresh run: the waves laid out, the constants solved, the bed's progression drawn, the first wave released. */
  init(ctx: ModeContext, v: VortexView, s: VortexSettings, dir: number, phase: number) {
    const fv = v.funnel;
    const waves = wavesForRun(s.waves);
    const total = wavesTotal(waves);
    this.ensureCapacity(v, waves.length, total);
    this.dir = dir;
    this.phase = phase;
    this.clockMs = 0;
    this.stepStartMs = 0;
    this.steps = 0;
    this.bedDirty = false;
    this.chord = 0;
    this.slotOfId.clear();
    this.swallowedIds.clear();
    this.ballId.fill(-1);
    // the seeded choice (after the Sound Vortex's three): the bed's 4-chord progression in C
    this.progression = grooveProgression(() => ctx.random(), FS_BED_ROOT_MIDI);
    // the constants, in rim units: the matched spiral from the entry to the hole
    this.entry = FS_ENTRY_AT;
    this.hole = Math.max(1e-4, s.holeSize / 100);
    this.kL = Math.max(0, s.spinFriction);
    this.kr = slipRate(this.kL);
    this.L0 = releaseSpin(this.entry, s.firstLap);
    this.pullP = pullExponent();
    this.pullC = pullStrength(this.L0, this.entry, this.pullP);
    this.interval = Math.max(0, s.waveInterval);
    // the timing on the step grid: every wave descends in the same whole number of steps (integrated as the run integrates it)
    const timing = funnelStepTiming(waves.length, this.interval, s.holeSize, this.kL, s.firstLap, s.refillGap, this.lastStepMs / 1000);
    fv.descentSec = timing.descentSec;
    fv.lapGain = funnelLapGain(this.entry, this.hole, this.kL);
    fv.omega0 = lapRate(this.L0, this.entry);
    fv.omegaEnd = fv.omega0 * fv.lapGain;
    fv.cycleSec = timing.cycleSec;
    fv.cycleStartMs = 0;
    fv.seams = 0;
    fv.lastSeamMs = -1;
    fv.nextSeamMs = s.loop && Number.isFinite(fv.cycleSec) ? 1000 * fv.cycleSec : -1;
    fv.cycleSwallowed = 0;
    fv.firstCycleSwallowed = -1;
    fv.refills = 0;
    fv.lastRefillMs = -1;
    fv.lapChimes = 0;
    fv.washes = 0;
    fv.lastWashMs = -1;
    fv.kicks = 0;
    fv.bedChords = 0;
    fv.hiss = 0;
    fv.bedOn = false;
    fv.newestWave = -1;
    fv.lapSec = Infinity;
    fv.sounds = 0;
    // the waves and their marbles' slots and colours (the rainbow around each ring)
    fv.waveCount = waves.length;
    let slot = 0;
    for (let k = 0; k < waves.length; k++) {
      fv.waveSize[k] = waves[k];
      fv.waveFirst[k] = slot;
      for (let i = 0; i < waves[k]; i++) {
        fv.slotWave[slot] = k;
        v.slotColor[slot] = marbleColor(marbleHue(i, waves[k]));
        slot++;
      }
    }
    v.slotCount = total;
    this.resetCycle(v);
    this.release(ctx, v, s, 0);
  }

  /** Grows the per-wave and per-marble arrays (the view's too) to hold a run of `waves` waves and `marbles` marbles. Grow-only. */
  private ensureCapacity(v: VortexView, waves: number, marbles: number) {
    const fv = v.funnel;
    if (waves > fv.waveSize.length) {
      const n = Math.ceil(waves);
      fv.waveSize = new Int32Array(n);
      fv.waveFirst = new Int32Array(n);
      fv.waveState = new Uint8Array(n);
      fv.waveR = new Float64Array(n);
      fv.waveTurn = new Float64Array(n);
      fv.waveL = new Float64Array(n);
      fv.waveTheta0 = new Float64Array(n);
      fv.waveReleasedMs = new Float64Array(n);
      fv.waveLaps = new Int32Array(n);
      this.waveVr = new Float64Array(n);
    }
    if (marbles > fv.slotWave.length) fv.slotWave = new Int32Array(Math.ceil(marbles));
    if (marbles > this.ballId.length) this.ballId = new Int32Array(Math.ceil(marbles)).fill(-1);
    if (marbles > v.slotState.length) {
      const n = Math.ceil(marbles);
      v.slotState = new Uint8Array(n);
      v.slotR = new Float64Array(n);
      v.slotTheta = new Float64Array(n);
      v.slotX = new Float64Array(n);
      v.slotY = new Float64Array(n);
      v.slotNoteMs = new Float64Array(n).fill(-Infinity);
      v.slotColor = new Array<string>(n).fill("#ffffff");
      v.slotRing = new Int16Array(n);
    }
  }

  /** Every wave back to waiting, every marble slot empty: the cycle's first frame (before its first wave is released). */
  private resetCycle(v: VortexView) {
    const fv = v.funnel;
    for (let k = 0; k < fv.waveCount; k++) {
      fv.waveState[k] = WAVE_WAITING;
      fv.waveLaps[k] = 0;
      fv.waveReleasedMs[k] = -1;
    }
    for (let i = 0; i < v.slotCount; i++) {
      v.slotState[i] = SLOT_WAITING;
      v.slotRing[i] = 0;
      v.slotNoteMs[i] = -Infinity;
    }
    v.inFlight = 0;
    fv.cycleSwallowed = 0;
    fv.newestWave = -1;
    fv.lapSec = Infinity;
  }

  /** Wave `k` enters on the rim: one polar state, its marbles created evenly spaced (turned by k · FS_WAVE_TWIST of a spacing). */
  private release(ctx: ModeContext, v: VortexView, s: VortexSettings, k: number) {
    const fv = v.funnel;
    const n = fv.waveSize[k];
    fv.waveState[k] = WAVE_FLYING;
    fv.waveR[k] = this.entry;
    this.waveVr[k] = -this.kr * this.entry;
    fv.waveTurn[k] = 0;
    fv.waveL[k] = this.L0;
    fv.waveTheta0[k] = this.phase + this.dir * ((2 * Math.PI) / n) * ((k * FS_WAVE_TWIST) % 1);
    fv.waveReleasedMs[k] = this.clockMs;
    fv.waveLaps[k] = 0;
    fv.newestWave = k;
    const cfg = ctx.config;
    const radius = cfg.ballRadius || 8;
    const first = fv.waveFirst[k];
    for (let i = 0; i < n; i++) {
      const slot = first + i;
      ctx.addBall({ x: v.field.cx, y: v.field.cy, vx: 0, vy: 0, radius, radiusScale: 1, color: v.slotColor[slot], gravityScale: 0 });
      const id = ctx.getNextId() - 1;
      this.ballId[slot] = id;
      this.slotOfId.set(id, slot);
      v.slotState[slot] = SLOT_FLYING;
      v.slotRing[slot] = 0;
      v.entered++;
      v.inFlight++;
    }
    const balls = ctx.getBalls();
    for (let i = Math.max(0, balls.length - n); i < balls.length; i++) {
      const slot = this.slotOfId.get(balls[i].id);
      if (slot !== undefined) this.placeBall(v, s, balls[i], slot, radius);
    }
  }

  /** Places marble `slot`'s ball from its wave's state (rim units → px; the perspective's projection or the top view's circle). */
  private placeBall(v: VortexView, s: VortexSettings, ball: Ball, slot: number, base: number) {
    const fv = v.funnel;
    const f = v.field;
    const k = fv.slotWave[slot];
    const n = fv.waveSize[k];
    const rim = f.rim;
    const r = fv.waveR[k] * rim;
    const vr = this.waveVr[k] * rim;
    const vt = (this.dir * fv.waveL[k] * rim) / Math.max(1e-9, fv.waveR[k]);
    const theta = fv.waveTheta0[k] + this.dir * fv.waveTurn[k] + ((slot - fv.waveFirst[k]) * 2 * Math.PI) / n;
    if (s.view === "perspective") {
      placeFunnelPerspective(v, ball, slot, r, theta, vr, vt, base);
      return;
    }
    const c = Math.cos(theta);
    const sn = Math.sin(theta);
    const scale = depthScaleOf(f, r, s.depthScale);
    ball.x = f.cx + r * c;
    ball.y = f.cy + r * sn;
    ball.vx = vr * c - vt * sn;
    ball.vy = vr * sn + vt * c;
    ball.radiusScale = scale;
    ball.radius = base * scale;
    ball.color = v.slotColor[slot];
    v.slotR[slot] = r;
    v.slotTheta[slot] = theta;
    v.slotX[slot] = ball.x;
    v.slotY[slot] = ball.y;
  }

  /** Places every marble in the funnel (one pass over the engine's balls). */
  private placeAll(ctx: ModeContext, v: VortexView, s: VortexSettings, balls: Ball[]) {
    const base = ctx.config.ballRadius || 8;
    for (let i = 0; i < balls.length; i++) {
      const slot = this.slotOfId.get(balls[i].id);
      if (slot !== undefined && v.slotState[slot] === SLOT_FLYING) this.placeBall(v, s, balls[i], slot, base);
    }
  }

  /** The engine ball of `slot` (its id is known: the list is searched from where the ids say it should be). */
  private ballOf(balls: Ball[], slot: number): Ball | null {
    const id = this.ballId[slot];
    if (id < 0) return null;
    // the balls are appended in release order and only removed: the ball is at or before its slot's index
    for (let i = Math.min(balls.length - 1, slot); i >= 0; i--) if (balls[i].id === id) return balls[i];
    for (let i = balls.length - 1; i > slot; i--) if (balls[i].id === id) return balls[i];
    return null;
  }

  /** The step's start: the waves due by it are released (the first one at the cycle's start is released by the seam or the init). */
  preUpdate(ctx: ModeContext, v: VortexView, s: VortexSettings, dtMs: number) {
    this.stepStartMs = this.clockMs;
    this.clockMs += dtMs;
    this.lastStepMs = dtMs;
    v.timeMs = this.clockMs;
    const fv = v.funnel;
    const tau = (this.stepStartMs - fv.cycleStartMs) / 1000 + 1e-9;
    for (let k = 1; k < fv.waveCount; k++) if (fv.waveState[k] === WAVE_WAITING && k * this.interval <= tau) this.release(ctx, v, s, k);
  }

  /** The step's end: the waves advanced and placed, laps, swallows, the step's sounds, the seam (see the file's comment). */
  postUpdate(ctx: ModeContext, v: VortexView, s: VortexSettings) {
    const fv = v.funnel;
    const f = v.field;
    const dt = (this.clockMs - this.stepStartMs) / 1000;
    const balls = ctx.getBalls();
    const tau0 = (this.stepStartMs - fv.cycleStartMs) / 1000;
    const tau1 = (this.clockMs - fv.cycleStartMs) / 1000;
    const start = this.steps === 0;
    // the groove bed's first chord with the run's first step, or again after a pause (`refreshBed()`)
    if (start || this.bedDirty) this.sendBed(ctx, v, this.chord);
    this.bedDirty = false;
    let totalSpeed = 0;
    let newest = -1;
    for (let k = 0; k < fv.waveCount; k++) {
      if (fv.waveState[k] !== WAVE_FLYING) continue;
      const st = this.state;
      st.r = fv.waveR[k];
      st.vr = this.waveVr[k];
      st.turn = fv.waveTurn[k];
      st.L = fv.waveL[k];
      const lapsBefore = Math.floor(this.dir * (fv.waveTheta0[k] + this.dir * st.turn) / (2 * Math.PI));
      stepFunnel(st, dt, this.pullC, this.pullP, this.kr, this.kL);
      fv.waveR[k] = st.r;
      this.waveVr[k] = st.vr;
      fv.waveTurn[k] = st.turn;
      fv.waveL[k] = st.L;
      // a lap: the ring's first marble crossed θ = 0 (its angle times the direction passed a whole turn)
      const lapsAfter = Math.floor(this.dir * (fv.waveTheta0[k] + this.dir * st.turn) / (2 * Math.PI));
      const r = st.r * f.rim;
      // the sound rings it sank past light up (the top view's rings; no note: the ring release sings its laps)
      const first = fv.waveFirst[k];
      let next = v.slotRing[first];
      while (next < f.ringCount && r < f.rings[next]) {
        v.ringHitMs[next] = this.clockMs;
        if (next > v.deepestRing) v.deepestRing = next;
        next++;
      }
      if (next !== v.slotRing[first]) for (let i = 0; i < fv.waveSize[k]; i++) v.slotRing[first + i] = next;
      const elapsed = (this.clockMs - fv.waveReleasedMs[k]) / 1000;
      const overdue = Number.isFinite(fv.descentSec) && elapsed > FS_MAX_FLIGHT_FACTOR * Math.max(fv.descentSec, 1);
      if (st.r <= this.hole || overdue) {
        this.swallowWave(v, k);
        continue;
      }
      if (lapsAfter > lapsBefore) {
        fv.waveLaps[k] += lapsAfter - lapsBefore;
        const omega = lapRate(st.L, st.r);
        this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "chime", frequency: chimeHz(chimeDegree(omega, fv.omega0, fv.omegaEnd)), level: FS_CHIME_LEVEL, melody: false });
        fv.lapChimes++;
        v.notes++;
        for (let i = 0; i < fv.waveSize[k]; i++) v.slotNoteMs[first + i] = this.clockMs;
        const ball = ctx.noteBounce ? this.ballOf(balls, first) : null;
        if (ball) ctx.noteBounce?.(ball); // --- bounce-math --- (a ring's lap is its note)
      }
      const speed = Math.hypot(st.vr, st.L / st.r);
      totalSpeed += fv.waveSize[k] * speed;
      if (newest < 0 || fv.waveReleasedMs[k] > fv.waveReleasedMs[newest]) newest = k;
    }
    this.placeAll(ctx, v, s, balls);
    fv.newestWave = newest;
    fv.lapSec = newest >= 0 ? (2 * Math.PI) / Math.max(1e-12, lapRate(fv.waveL[newest], fv.waveR[newest])) : Infinity;
    // the swallowed marbles leave the engine
    if (this.swallowedIds.size > 0) {
      for (let i = balls.length - 1; i >= 0; i--) if (this.swallowedIds.has(balls[i].id)) balls.splice(i, 1);
      this.swallowedIds.clear();
    }
    // the rolling hiss follows the marbles' total speed
    if (start || this.steps % FS_HISS_EVERY_STEPS === 0) {
      const ref = FS_HISS_REF_BALLS * lapRate(this.L0, this.entry) * this.entry;
      fv.hiss = hissLevel(totalSpeed, ref);
      this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "hiss", level: fv.hiss, melody: false });
    }
    // the groove bed: a chord at every bar of the cycle, a kick on every beat after the first bar
    const b0 = start ? 0 : bedBeat(tau0, s.bpm);
    const b1 = bedBeat(tau1, s.bpm);
    for (let j = b0 + 1; j <= b1; j++) {
      if (j % 4 === 0) this.sendBed(ctx, v, (j / 4) % 4);
      if (j >= 4) {
        this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "kick", level: FS_KICK_LEVEL, melody: false });
        fv.kicks++;
      }
    }
    // the loop: the wash before the refill, then the seam at the end of the step that reaches the cycle
    const looping = s.loop && Number.isFinite(fv.cycleSec);
    if (looping) {
      const washAt = Math.max(0, fv.cycleSec - FS_WASH_LEAD_SEC);
      if (tau0 < washAt - 1e-9 && tau1 >= washAt - 1e-9) {
        this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "wash", level: FS_WASH_LEVEL, loopSec: Math.min(FS_WASH_LEAD_SEC, fv.cycleSec), melody: false });
        fv.washes++;
        fv.lastWashMs = this.clockMs;
      }
      if (tau1 >= fv.cycleSec - 1e-6) this.seam(ctx, v, s);
    } else if (!v.finished && Number.isFinite(fv.cycleSec) && tau1 >= fv.cycleSec - 1e-6 && this.allSwallowed(v)) {
      v.finished = true;
      v.finishedMs = this.clockMs;
      this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "bedStop", melody: false });
      this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "hissStop", melody: false });
      fv.bedOn = false;
    }
    this.steps++;
  }

  private allSwallowed(v: VortexView): boolean {
    const fv = v.funnel;
    for (let k = 0; k < fv.waveCount; k++) if (fv.waveState[k] !== WAVE_SWALLOWED) return false;
    return true;
  }

  /** Wave `k` reached the hole: its marbles vanish (they leave the engine at the end of the step). */
  private swallowWave(v: VortexView, k: number) {
    const fv = v.funnel;
    fv.waveState[k] = WAVE_SWALLOWED;
    const first = fv.waveFirst[k];
    for (let i = 0; i < fv.waveSize[k]; i++) {
      const slot = first + i;
      if (v.slotState[slot] !== SLOT_FLYING) continue;
      v.slotState[slot] = SLOT_SWALLOWED;
      v.swallowed++;
      v.inFlight--;
      fv.cycleSwallowed++;
      const id = this.ballId[slot];
      if (id >= 0) {
        this.swallowedIds.add(id);
        this.slotOfId.delete(id);
      }
      this.ballId[slot] = -1;
    }
    v.lastSwallowMs = this.clockMs;
  }

  /** The seam: the loop voices' hard cut, the funnel back to its first frame (any ring still in it goes), the first wave again. */
  private seam(ctx: ModeContext, v: VortexView, s: VortexSettings) {
    const fv = v.funnel;
    for (let k = 0; k < fv.waveCount; k++) if (fv.waveState[k] === WAVE_FLYING) this.swallowWave(v, k);
    if (this.swallowedIds.size > 0) {
      const balls = ctx.getBalls();
      for (let i = balls.length - 1; i >= 0; i--) if (this.swallowedIds.has(balls[i].id)) balls.splice(i, 1);
      this.swallowedIds.clear();
    }
    if (fv.firstCycleSwallowed < 0) fv.firstCycleSwallowed = fv.cycleSwallowed;
    fv.seams++;
    fv.lastSeamMs = this.clockMs;
    fv.cycleStartMs = this.clockMs;
    fv.nextSeamMs = this.clockMs + 1000 * fv.cycleSec;
    this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "cut", melody: false });
    this.resetCycle(v);
    this.release(ctx, v, s, 0);
    fv.refills++;
    fv.lastRefillMs = this.clockMs;
    this.sendBed(ctx, v, 0);
  }

  /** The groove bed's chord `chord` of the progression (it starts the bed when it is not playing). */
  private sendBed(ctx: ModeContext, v: VortexView, chord: number) {
    const c = this.progression[chord % Math.max(1, this.progression.length)] ?? { root: FS_BED_ROOT_MIDI, minor: false };
    this.chord = chord;
    this.emit(ctx, v, { type: "hit", wallIndex: 0, loop: "bed", frequency: midiToFrequency(c.root), loopMinor: c.minor, melody: false });
    v.funnel.bedChords++;
    v.funnel.bedOn = true;
  }

  /** The page resumed a paused run (the bed and the hiss were stopped): they come back with the next step. */
  refreshBed() {
    this.bedDirty = true;
  }

  private emit(ctx: ModeContext, v: VortexView, event: SoundEvent) {
    ctx.addPendingSoundEvent(event);
    v.funnel.sounds++;
  }

  /** A canvas resize: the marbles keep their place in the funnel (the run is in rim units; only the drawing scales). */
  configChange(ctx: ModeContext, v: VortexView, s: VortexSettings) {
    const balls = ctx.getBalls();
    this.placeAll(ctx, v, s, balls);
    for (const ball of balls) {
      if (!this.slotOfId.has(ball.id)) continue;
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
  }

  /** The loop contract: the cycle (s, whole steps) while the refill loops, else null. */
  cycleSeconds(v: VortexView, s: VortexSettings): number | null {
    return s.loop && Number.isFinite(v.funnel.cycleSec) ? v.funnel.cycleSec : null;
  }

  loopSeams(v: VortexView, s: VortexSettings): LoopSeams | null {
    const fv = v.funnel;
    if (!s.loop || !Number.isFinite(fv.cycleSec)) return null;
    return { count: fv.seams, lastMs: fv.lastSeamMs, nextMs: fv.nextSeamMs };
  }
}

/** A marble's size factor in the top view at radius `r` (px) with the depth cue (the Sound Vortex's: `depthRadiusScale()`). */
function depthScaleOf(f: VortexField, r: number, depthScale: number): number {
  if (!(depthScale > 0)) return 1;
  const d = r > 0 ? Math.log(f.entry / r) / Math.log(f.entry / f.hole) : 1;
  const depth = d < 0 ? 0 : d > 1 ? 1 : d;
  return depthRadiusScale(depth, depthScale); // --- review fix (uncap-all) --- (it repeated the formula, clamping the cue at 1)
}
