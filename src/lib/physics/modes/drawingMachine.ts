import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { grooveProgression } from "@/lib/audio/loopTones";
import { midiToFrequency } from "@/lib/audio/scales";
import {
  DEFAULT_DRAWING_MACHINE_SETTINGS,
  DM_BODY_SPECS,
  DmTrace,
  chordStepYears,
  chordsBy,
  chordsPerCycle,
  conjunctionPeriod,
  conjunctionsPerCycle,
  conjunctionsUpTo,
  dmEase,
  dmInkStops,
  dmPhaseAt,
  dmTimeline,
  harmonographPendulums,
  orbitAngle,
  orbitPeriods,
  orbitsBedBars,
  orbitsYearAt,
  penAt,
  penEnergy,
  penSpeedRef,
  resolveDrawingMachineSettings,
  traceRateHz,
  yearShown,
  type DmMachine,
  type DmPen,
  type DmPendulum,
  type DmPhase,
  type DmTimeline,
  type DrawingMachineSettings,
} from "../drawingMachine";

/*
 * --- drawing-machine --- Drawing Machines (mode `drawingMachine`, the rhythm family; the maths and the settings in
 * lib/physics/drawingMachine.ts): two analytic machines that draw one figure a cycle and then reset to frame 0, so every clip
 * loops. Everything is a function of the simulation clock, like the Pendulum Wave: the mode owns its playfield (the "none" ring
 * layout), its pen and its planets; the engine's balls are only ghost markers it pins where the clock puts them (the pen, or
 * the two planets – the canvas draws its own bodies), so a run is exact at any frame rate and the fast export replays it bit
 * for bit.
 *
 * - **harmonograph**: three damped pendulums drive one pen (`penAt()`); the pen is sampled at `traceRateHz()` of simulation
 *   time – sample k at exactly k / rate, whatever the steps – into the trace (`DmTrace`, its ceiling dropping the oldest),
 *   for `drawSec`; then the paper scrolls a fresh sheet in for `scrollSec` while the pen glides back to its first point, and
 *   the next cycle starts exactly like the first (the trace empty, the pendulums at t = 0).
 * - **orbits**: the year runs from 0 to `years` at `secPerYear`, a chord every `lineDays` days, a mark at every conjunction;
 *   then the drawing holds `holdSec` and rewinds for `rewindSec`: the counter runs back to 0.0 and the chords and marks
 *   un-draw newest first, so the cycle's last frame is its first.
 *
 * The cycle (`cycleSeconds()`, `loopSeams()`) goes to the loop contract, so **Export whole loops** cuts every export on a seam.
 *
 * Sound (the loop family's voices through `ToneGenerator.playLoop()`, `melody: false`): the harmonograph's energy drone – its
 * level √(E/E0) and its ripple and pen scratch from the pen's speed, updated at 30 Hz of simulation time (`loop: "drone"`,
 * `loopSpeed`) – rises back to full while the paper scrolls (so the seam does not jump) under the scroll's ratchet; the
 * orbits' groove bed changes chord every bar of 4 beats (whole bars a cycle, the progression drawn from the run's seed – the
 * mode's only random draw, at init), every conjunction plucks the next degree of the A major pentatonic from A4, and the rewind
 * opens with a noise wash. Bounce math's "bounce" trigger: the pen turning at the end of a lateral swing, a conjunction.
 */

/** The drone's root (G2) and the levels of the scroll's ratchet, the bed, the plucks and the rewind's wash. */
export const DM_DRONE_HZ = 97.999;
export const DM_RATCHET_LEVEL = 0.8;
export const DM_BED_LEVEL = 0.8;
export const DM_PLUCK_LEVEL = 0.9;
export const DM_WASH_LEVEL = 0.8;
/** The conjunction plucks: degree j of the A major pentatonic from A4, wrapping after two octaves. */
export const DM_PLUCK_ROOT_MIDI = 69;
export const DM_PLUCK_WRAP = 10;
/** The bed's key: A (its pad and sub are voiced into 55–440 Hz by the bed itself). */
export const DM_BED_ROOT_MIDI = 45;
/** The drone's updates a second of simulation time. */
export const DM_DRONE_HZ_UPDATES = 30;
/** Samples a step may add to the trace at most (a stride past it); conjunctions, bar changes and seams a step plays at most. */
export const DM_SAMPLES_PER_STEP = 20_000;
export const DM_EVENTS_PER_STEP = 16;
export const DM_SEAMS_PER_STEP = 64;

/** The harmonograph's paper (shares of the field's side), the figure's radius (share of the paper's shorter side), the pivot. */
export const DM_PAPER_W = 0.84;
export const DM_PAPER_H = 0.78;
export const DM_FIGURE_SHARE = 0.47;
export const DM_PIVOT_INSET = 0.035;
/** The pen's dot and the sun's radius (px of a 720 px frame), the outer orbit's radius (share of the side). */
export const DM_PEN_PX = 5;
export const DM_SUN_PX = 14;
export const DM_ORBIT_SHARE = 0.4;

const EPS = 1e-9;

/** What the canvas, the HUD, the tests and the smoke test read of a run (the same object every call). */
export interface DrawingMachineView {
  /** Bumped by every init (the canvas starts its layers over). */
  generation: number;
  settings: DrawingMachineSettings;
  machine: DmMachine;
  timeline: DmTimeline;
  /** Simulation time (s) of the latest step, the cycle it is in (= the seams so far), the time into it, its phase. */
  timeSec: number;
  cycleIndex: number;
  cycleTime: number;
  phase: DmPhase;
  phaseProgress: number;
  /** The field (world px): its centre and side. */
  cx: number;
  cy: number;
  side: number;
  /** The ink's ramp (colour stops over the cycle). */
  ink: readonly string[];
  // ---- the harmonograph
  pendulums: DmPendulum[];
  /** Samples a second of the trace, and the trace itself (figure radii, cycle times). */
  rate: number;
  trace: DmTrace;
  /** The paper (world px), the figure's radius (px) and the rod's pivot. */
  paperX: number;
  paperY: number;
  paperW: number;
  paperH: number;
  figureRadius: number;
  pivotX: number;
  pivotY: number;
  /** The pen (figure radii and world px), its speed (0–1 of its top speed) and the pendulums' energy (E / E0). */
  pen: DmPen;
  penX: number;
  penY: number;
  penRadius: number;
  penSpeed: number;
  energy: number;
  /** How far the paper has scrolled (0–1 of a sheet, eased), the scrolls started and the sheets drawn so far. */
  scroll: number;
  scrolls: number;
  sheets: number;
  /** The pen's turns at the end of a lateral swing so far (bounce math's bounce). */
  turns: number;
  // ---- the orbits
  periods: { inner: number; outer: number };
  synodic: number;
  /** The orbits' radii, the bodies' and the sun's (world px). */
  innerOrbit: number;
  outerOrbit: number;
  innerSize: number;
  outerSize: number;
  sunSize: number;
  innerColor: string;
  outerColor: string;
  /** The year now (exact), as the counter shows it (one decimal), and this cycle's highest shown. */
  year: number;
  yearShown: number;
  peakYear: number;
  /** The bodies' angles (rad, canvas angles) and places (world px). */
  innerAngle: number;
  outerAngle: number;
  innerX: number;
  innerY: number;
  outerX: number;
  outerY: number;
  /** The chords: years between two, a cycle's, the ones drawn now. */
  chordDt: number;
  chordsPerCycle: number;
  chordsVisible: number;
  /** The conjunction marks: a cycle's (years 0 … years, the closing one included), the ones shown now, every conjunction so far. */
  marksPerCycle: number;
  marksVisible: number;
  conjunctions: number;
  /** Conjunctions in [0, years) of a cycle (13 : 8 → 5). */
  conjPerCycle: number;
  /** Rewinds started, the year shown at the end of the last one (−1 before) and the highest the last finished cycle showed (−1 before). */
  rewinds: number;
  rewoundTo: number;
  lastPeakYear: number;
  /** The groove bed: bars a cycle, a bar (s), its tempo, and the bar now. */
  bars: number;
  barSec: number;
  bpm: number;
  bar: number;
  // ---- both
  /** The sounds queued so far, by voice. */
  drones: number;
  ratchets: number;
  plucks: number;
  beds: number;
  washes: number;
}

export class DrawingMachineMode implements GameMode {
  readonly name = "drawingMachine";
  /** The pen and the planets are placed by the mode: no slow-ball boost and no pair collisions may touch them. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: DrawingMachineSettings = { ...DEFAULT_DRAWING_MACHINE_SETTINGS };
  private readonly view: DrawingMachineView;
  private firstBallId = -1;
  private ballCount = 0;
  private lastBallRadius = 0;
  /** The trace's next sample (its index of the cycle) and whether the drawing's last point (at drawSec) is in. */
  private nextSample = 0;
  private finalSample = false;
  private speedRef = 1;
  /** The pen's lateral velocity at the latest step's end (its sign changes at a turn). */
  private lastVx = 0;
  /** The bed's progression (chord roots, minor or not), drawn at init. */
  private progression: { root: number; minor: boolean }[] = [];
  /** The cycle's start sounds wait for the run's first step; a resumed or re-enabled run re-sends its held voices; a voice switched off stops. */
  private startPending = true;
  private refreshPending = false;
  private stopPending = false;
  private readonly scratchPen: DmPen = { x: 0, y: 0, vx: 0, vy: 0 };
  private readonly scratchPen2: DmPen = { x: 0, y: 0, vx: 0, vy: 0 };

  constructor() {
    const s = this.settings;
    this.view = {
      generation: 0,
      settings: { ...s },
      machine: s.machine,
      timeline: dmTimeline(s),
      timeSec: 0,
      cycleIndex: 0,
      cycleTime: 0,
      phase: "draw",
      phaseProgress: 0,
      cx: 0,
      cy: 0,
      side: 0,
      ink: dmInkStops(s.ink, s.machine),
      pendulums: harmonographPendulums(s),
      rate: 240,
      trace: new DmTrace(),
      paperX: 0,
      paperY: 0,
      paperW: 0,
      paperH: 0,
      figureRadius: 0,
      pivotX: 0,
      pivotY: 0,
      pen: { x: 0, y: 0, vx: 0, vy: 0 },
      penX: 0,
      penY: 0,
      penRadius: 0,
      penSpeed: 0,
      energy: 1,
      scroll: 0,
      scrolls: 0,
      sheets: 0,
      turns: 0,
      periods: { inner: 1, outer: 1 },
      synodic: Infinity,
      innerOrbit: 0,
      outerOrbit: 0,
      innerSize: 0,
      outerSize: 0,
      sunSize: 0,
      innerColor: "#ffffff",
      outerColor: "#ffffff",
      year: 0,
      yearShown: 0,
      peakYear: 0,
      innerAngle: 0,
      outerAngle: 0,
      innerX: 0,
      innerY: 0,
      outerX: 0,
      outerY: 0,
      chordDt: 0,
      chordsPerCycle: 0,
      chordsVisible: 0,
      marksPerCycle: 0,
      marksVisible: 0,
      conjunctions: 0,
      conjPerCycle: 0,
      rewinds: 0,
      rewoundTo: -1,
      lastPeakYear: -1,
      bars: 4,
      barSec: 0,
      bpm: 0,
      bar: 0,
      drones: 0,
      ratchets: 0,
      plucks: 0,
      beds: 0,
      washes: 0,
    };
  }

  getSettings(): DrawingMachineSettings {
    return { ...this.settings };
  }
  /** The machine and its numbers apply on the next init (the page restarts the run); the ink, the marks' joins and the sound follow at once. */
  setSettings(patch: Partial<DrawingMachineSettings>) {
    const was = this.settings.sound;
    this.settings = resolveDrawingMachineSettings({ ...this.settings, ...patch });
    const v = this.view;
    v.settings.ink = this.settings.ink;
    v.settings.pentagram = this.settings.pentagram;
    v.settings.sound = this.settings.sound;
    v.ink = dmInkStops(this.settings.ink, v.machine);
    if (was && !this.settings.sound) this.stopPending = true;
    else if (!was && this.settings.sound) this.refreshPending = true;
  }
  /** Live state for the canvas, the HUD and the tests; the same object every call. */
  getView(): DrawingMachineView {
    return this.view;
  }
  /** The held voices (the drone, or the bed's chord) are sent again with the next step (a paused run resumed: the page stopped them). */
  refreshSound() {
    this.refreshPending = true;
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.generation++;
    v.settings = { ...s };
    v.machine = s.machine;
    v.timeline = dmTimeline(s);
    v.ink = dmInkStops(s.ink, s.machine);
    v.pendulums = harmonographPendulums(s);
    v.rate = traceRateHz(v.pendulums);
    this.speedRef = Math.max(1e-9, penSpeedRef(v.pendulums));
    v.periods = orbitPeriods(s);
    v.synodic = conjunctionPeriod(v.periods.inner, v.periods.outer);
    v.chordDt = chordStepYears(s.lineDays);
    v.chordsPerCycle = chordsPerCycle(s.years, v.chordDt);
    v.marksPerCycle = conjunctionsUpTo(s.years, v.synodic);
    v.conjPerCycle = conjunctionsPerCycle(s.years, v.synodic);
    v.innerColor = DM_BODY_SPECS[s.inner].color;
    v.outerColor = DM_BODY_SPECS[s.outer].color;
    const bed = orbitsBedBars(v.timeline.cycle);
    v.bars = bed.bars;
    v.barSec = bed.barSec;
    v.bpm = bed.bpm;
    // The only random decision: the groove bed's progression (one ctx.random() draw), whatever the machine – a seed plays the same run.
    this.progression = grooveProgression(() => ctx.random(), DM_BED_ROOT_MIDI);
    v.timeSec = 0;
    v.cycleIndex = 0;
    v.scrolls = 0;
    v.sheets = 1;
    v.turns = 0;
    v.conjunctions = 0;
    v.rewinds = 0;
    v.rewoundTo = -1;
    v.lastPeakYear = -1;
    v.peakYear = 0;
    v.drones = 0;
    v.ratchets = 0;
    v.plucks = 0;
    v.beds = 0;
    v.washes = 0;
    this.startPending = true;
    this.refreshPending = false;
    this.stopPending = false;
    this.layOut(ctx);
    this.startCycle();
    this.updateView(0);
    // the engine's balls: the pen, or the two planets (ghost markers – the canvas draws the machine's own bodies)
    this.ballCount = s.machine === "harmonograph" ? 1 : 2;
    const base = ctx.config.ballRadius || 8;
    if (s.machine === "harmonograph") {
      ctx.addBall({ x: v.penX, y: v.penY, vx: 0, vy: 0, radius: v.penRadius, color: v.ink[0] ?? "#5b55c9", gravityScale: 0, radiusScale: v.penRadius / base });
    } else {
      ctx.addBall({ x: v.innerX, y: v.innerY, vx: 0, vy: 0, radius: v.innerSize, color: v.innerColor, gravityScale: 0, radiusScale: v.innerSize / base });
      ctx.addBall({ x: v.outerX, y: v.outerY, vx: 0, vy: 0, radius: v.outerSize, color: v.outerColor, gravityScale: 0, radiusScale: v.outerSize / base });
    }
    this.firstBallId = ctx.getNextId() - this.ballCount;
    this.lastBallRadius = base;
  }

  /** The field from the canvas: the paper, the figure, the pivot, the orbits and the bodies' sizes (world px). */
  private layOut(ctx: ModeContext) {
    const v = this.view;
    const w = ctx.config.width;
    const h = ctx.config.height;
    v.cx = w / 2;
    v.cy = h / 2;
    v.side = Math.max(10, Math.min(w, h));
    const unit = v.side / 720;
    v.paperW = DM_PAPER_W * v.side;
    v.paperH = DM_PAPER_H * v.side;
    v.paperX = v.cx - v.paperW / 2;
    v.paperY = v.cy - v.paperH / 2;
    v.figureRadius = DM_FIGURE_SHARE * Math.min(v.paperW, v.paperH);
    v.pivotX = v.cx + v.side / 2 - DM_PIVOT_INSET * v.side;
    v.pivotY = v.cy + v.side / 2 - DM_PIVOT_INSET * v.side;
    v.penRadius = Math.max(1, DM_PEN_PX * unit);
    const ratio = v.settings.radiusRatio;
    const scale = (DM_ORBIT_SHARE * v.side) / Math.max(1, ratio);
    v.outerOrbit = scale;
    v.innerOrbit = scale * ratio;
    v.innerSize = Math.max(1, DM_BODY_SPECS[v.settings.inner].sizePx * unit);
    v.outerSize = Math.max(1, DM_BODY_SPECS[v.settings.outer].sizePx * unit);
    v.sunSize = Math.max(2, DM_SUN_PX * unit);
  }

  /** A cycle's start (the run's, and every seam): a fresh sheet with the pen's first point, the orbits' counters from 0. */
  private startCycle() {
    const v = this.view;
    v.trace.reset();
    this.nextSample = 0;
    this.finalSample = false;
    v.peakYear = 0;
    if (v.machine === "harmonograph") {
      this.sampleTo(0);
      penAt(v.pendulums, 0, this.scratchPen);
      this.lastVx = this.scratchPen.vx;
    }
  }

  /** The trace's samples up to cycle time `tb` (inclusive), never past the drawing's end: at most DM_SAMPLES_PER_STEP a call. */
  private sampleTo(tb: number) {
    const v = this.view;
    const draw = v.timeline.draw;
    const end = Math.min(tb, draw);
    const rate = v.rate;
    const last = Math.floor(end * rate + EPS);
    if (last >= this.nextSample) {
      const pending = last - this.nextSample + 1;
      const stride = pending > DM_SAMPLES_PER_STEP ? Math.ceil(pending / DM_SAMPLES_PER_STEP) : 1;
      for (let k = this.nextSample; k <= last; k += stride) this.push(k / rate);
      if (stride > 1 && (last - this.nextSample) % stride !== 0) this.push(last / rate);
      this.nextSample = last + 1;
    }
    // the drawing's own last point when the grid misses it
    if (!this.finalSample && tb >= draw - EPS) {
      this.finalSample = true;
      if (Math.abs(Math.floor(draw * rate + EPS) / rate - draw) > EPS) this.push(draw);
    }
  }

  private push(t: number) {
    const p = penAt(this.view.pendulums, t, this.scratchPen2);
    this.view.trace.push(p.x, p.y, t);
  }

  onPreUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    if ((ctx.config.ballRadius || 8) !== this.lastBallRadius) this.refit(ctx);
    const end = ctx.getElapsedMs() / 1000;
    const start = Math.max(0, (ctx.getElapsedMs() - dtMs) / 1000);
    if (this.stopPending) {
      this.stopPending = false;
      ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: v.machine === "harmonograph" ? "droneStop" : "bedStop", melody: false });
    }
    if (this.startPending) {
      this.startPending = false;
      this.refreshPending = false;
      this.cycleStartSounds(ctx);
    }
    const cycle = v.timeline.cycle;
    let a = start;
    let seams = 0;
    while (a < end - 1e-12) {
      const cycleStart = v.cycleIndex * cycle;
      const seam = cycleStart + cycle;
      const b = cycle > 0 ? Math.min(end, seam) : end;
      this.segment(ctx, a - cycleStart, b - cycleStart);
      a = b;
      if (cycle > 0 && b >= seam - 1e-12) {
        if (++seams > DM_SEAMS_PER_STEP) {
          // cycles far shorter than a step: skip to the step's own cycle (degrade, never stall)
          v.cycleIndex = Math.floor(end / cycle + EPS);
          this.startCycle();
          break;
        }
        this.seam(ctx);
      } else break;
    }
    if (this.refreshPending) {
      this.refreshPending = false;
      this.refreshVoices(ctx, end - v.cycleIndex * cycle);
    }
    this.updateView(end);
  }

  /** The events of the stretch `ta` … `tb` (s, the current cycle's own time). */
  private segment(ctx: ModeContext, ta: number, tb: number) {
    const v = this.view;
    const s = this.settings;
    const tl = v.timeline;
    const sound = s.sound;
    if (v.machine === "harmonograph") {
      if (ta < tl.draw) {
        this.sampleTo(tb);
        // the pen turns at the end of a lateral swing: bounce math's bounce
        const p = penAt(v.pendulums, Math.min(tb, tl.draw), this.scratchPen);
        if (p.vx !== 0 && this.lastVx !== 0 && Math.sign(p.vx) !== Math.sign(this.lastVx)) {
          v.turns++;
          const ball = this.ballOf(ctx, 0);
          if (ball) ctx.noteBounce?.(ball);
        }
        if (p.vx !== 0) this.lastVx = p.vx;
      }
      // the scroll: the ratchet runs while the paper moves
      if (tl.scroll > 0 && ta < tl.draw && tb >= tl.draw - EPS) {
        v.scrolls++;
        if (sound) {
          v.ratchets++;
          ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "ratchet", loopSec: tl.scroll, level: DM_RATCHET_LEVEL, melody: false });
        }
      }
      // the drone at 30 Hz of simulation time (its energy and the pen's speed at the stretch's end)
      if (sound && Math.floor(tb * DM_DRONE_HZ_UPDATES + EPS) > Math.floor(ta * DM_DRONE_HZ_UPDATES + EPS)) this.droneEvent(ctx, tb);
      return;
    }
    // the orbits: conjunctions while the year counts up (the one that closes the figure at `years` included)
    if (ta < tl.draw) {
      const ya = orbitsYearAt(tl, s.years, s.secPerYear, ta);
      const yb = tb >= tl.draw ? s.years : orbitsYearAt(tl, s.years, s.secPerYear, tb);
      const from = conjunctionsUpTo(ya, v.synodic);
      const to = Math.min(v.marksPerCycle, conjunctionsUpTo(yb, v.synodic));
      for (let j = from; j < to && j < from + DM_EVENTS_PER_STEP; j++) this.conjunction(ctx, j);
    }
    // the bed's chord changes on the bar lines (the cycle's first is played at its start)
    if (sound && v.barSec > 0) {
      const ka = Math.floor(ta / v.barSec + EPS);
      const kb = Math.min(v.bars - 1, Math.floor(tb / v.barSec + EPS));
      for (let k = ka + 1; k <= kb && k <= ka + DM_EVENTS_PER_STEP; k++) this.bedEvent(ctx, k);
    }
    // the rewind opens with a wash
    const rewindAt = tl.draw + tl.hold;
    if (tl.rewind > 0 && ta < rewindAt - EPS && tb >= rewindAt - EPS) {
      v.rewinds++;
      if (sound) {
        v.washes++;
        ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "wash", loopSec: tl.rewind, level: DM_WASH_LEVEL, melody: false });
      }
    }
  }

  /** Conjunction `j` of the cycle (0: its start): a mark, a pluck a degree higher than the last, bounce math's bounce. */
  private conjunction(ctx: ModeContext, j: number) {
    const v = this.view;
    v.conjunctions++;
    for (let i = 0; i < this.ballCount; i++) {
      const ball = this.ballOf(ctx, i);
      if (ball) ctx.noteBounce?.(ball);
    }
    if (!this.settings.sound) return;
    v.plucks++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "pluck", frequency: dmPluckFrequency(j), level: DM_PLUCK_LEVEL, loopBright: j > 0 && j % DM_PLUCK_WRAP === 0, melody: false });
  }

  /** The bed's chord of bar `k` (the progression's chord k mod 4). */
  private bedEvent(ctx: ModeContext, k: number) {
    const v = this.view;
    const chord = this.progression[((k % this.progression.length) + this.progression.length) % this.progression.length];
    if (!chord) return;
    v.beds++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "bed", frequency: midiToFrequency(chord.root), loopMinor: chord.minor, level: DM_BED_LEVEL, melody: false });
  }

  /** The drone at cycle time `tau`: the pendulums' energy (rising back while the paper scrolls) and the pen's speed. */
  private droneEvent(ctx: ModeContext, tau: number) {
    const v = this.view;
    const { energy, speed } = this.droneState(tau);
    v.drones++;
    ctx.addPendingSoundEvent({ type: "hit", wallIndex: 0, loop: "drone", frequency: DM_DRONE_HZ, level: energy, loopSpeed: speed, melody: false });
  }

  private droneState(tau: number): { energy: number; speed: number } {
    const v = this.view;
    const tl = v.timeline;
    if (tau < tl.draw) {
      const p = penAt(v.pendulums, tau, this.scratchPen2);
      return { energy: penEnergy(v.pendulums, tau), speed: Math.min(1, Math.hypot(p.vx, p.vy) / this.speedRef) };
    }
    const end = penEnergy(v.pendulums, tl.draw);
    const u = tl.scroll > 0 ? (tau - tl.draw) / tl.scroll : 1;
    return { energy: end + (1 - end) * dmEase(u), speed: 0 };
  }

  /** The sounds a cycle opens with: the drone at full energy – or the bed's first chord and the start's conjunction. */
  private cycleStartSounds(ctx: ModeContext) {
    const v = this.view;
    if (v.machine === "harmonograph") {
      if (this.settings.sound) this.droneEvent(ctx, 0);
      return;
    }
    if (this.settings.sound) this.bedEvent(ctx, 0);
    this.conjunction(ctx, 0);
  }

  /** The held voices again (a resumed run, the sound switched back on): the drone where the run is, or the bed's current chord. */
  private refreshVoices(ctx: ModeContext, tau: number) {
    if (!this.settings.sound) return;
    const v = this.view;
    if (v.machine === "harmonograph") this.droneEvent(ctx, Math.max(0, tau));
    else if (v.barSec > 0) this.bedEvent(ctx, Math.min(v.bars - 1, Math.floor(Math.max(0, tau) / v.barSec + EPS)));
  }

  /** The seam: a new cycle exactly like the first (a fresh sheet, the year back at 0), its opening sounds. */
  private seam(ctx: ModeContext) {
    const v = this.view;
    if (v.machine === "orbits") {
      v.lastPeakYear = v.peakYear;
      if (v.timeline.rewind > 0) v.rewoundTo = 0;
    }
    v.cycleIndex++;
    v.sheets++;
    this.startCycle();
    this.cycleStartSounds(ctx);
  }

  /** The view at simulation time `t` (s): the phase, the pen or the planets, the counters. */
  private updateView(t: number) {
    const v = this.view;
    const s = this.settings;
    const tl = v.timeline;
    const tau = tl.cycle > 0 ? Math.max(0, t - v.cycleIndex * tl.cycle) : 0;
    v.timeSec = t;
    v.cycleTime = tau;
    const ph = dmPhaseAt(tl, tau);
    v.phase = ph.phase;
    v.phaseProgress = ph.progress;
    if (v.machine === "harmonograph") {
      if (tau < tl.draw) {
        penAt(v.pendulums, tau, v.pen);
        v.scroll = 0;
      } else {
        // the paper scrolls and the pen glides back to its first point
        const u = dmEase(ph.phase === "scroll" ? ph.progress : 1);
        const a = penAt(v.pendulums, tl.draw, this.scratchPen);
        const ax = a.x;
        const ay = a.y;
        const b = penAt(v.pendulums, 0, this.scratchPen);
        v.pen.x = ax + (b.x - ax) * u;
        v.pen.y = ay + (b.y - ay) * u;
        v.pen.vx = 0;
        v.pen.vy = 0;
        v.scroll = u;
      }
      v.penX = v.cx + v.figureRadius * v.pen.x;
      v.penY = v.cy + v.figureRadius * v.pen.y;
      const d = this.droneState(tau);
      v.energy = d.energy;
      v.penSpeed = d.speed;
      return;
    }
    const year = orbitsYearAt(tl, s.years, s.secPerYear, tau);
    v.year = year;
    v.yearShown = yearShown(year);
    if (ph.phase !== "rewind" && v.yearShown > v.peakYear) v.peakYear = v.yearShown;
    v.innerAngle = orbitAngle(v.periods.inner, year);
    v.outerAngle = orbitAngle(v.periods.outer, year);
    v.innerX = v.cx + v.innerOrbit * Math.cos(v.innerAngle);
    v.innerY = v.cy + v.innerOrbit * Math.sin(v.innerAngle);
    v.outerX = v.cx + v.outerOrbit * Math.cos(v.outerAngle);
    v.outerY = v.cy + v.outerOrbit * Math.sin(v.outerAngle);
    v.chordsVisible = chordsBy(year, v.chordDt, v.chordsPerCycle);
    v.marksVisible = Math.min(v.marksPerCycle, conjunctionsUpTo(year, v.synodic));
    v.bar = v.barSec > 0 ? Math.min(v.bars - 1, Math.floor(tau / v.barSec + EPS)) : 0;
    if (ph.phase === "rewind" && ph.progress >= 1 - EPS) v.rewoundTo = v.yearShown;
  }

  /** A live Ball Size or canvas change re-lays the machine out (its drawing is in figure radii and years: nothing else changes). */
  private refit(ctx: ModeContext) {
    this.layOut(ctx);
    this.lastBallRadius = ctx.config.ballRadius || 8;
    this.updateView(this.view.timeSec);
  }

  /** The engine ball `i` of the machine (0: the pen or the inner planet, 1: the outer planet), null when gone. */
  private ballOf(ctx: ModeContext, i: number): Ball | null {
    const id = this.firstBallId + i;
    for (const ball of ctx.getBalls()) if (ball.id === id) return ball;
    return null;
  }

  /** The engine moved the marker by its velocity: put it where the clock says (the pen, or a planet). */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    const v = this.view;
    const i = ball.id - this.firstBallId;
    if (i < 0 || i >= this.ballCount) return;
    if (v.machine === "harmonograph") {
      ball.x = v.penX;
      ball.y = v.penY;
      ball.vx = v.figureRadius * v.pen.vx;
      ball.vy = v.figureRadius * v.pen.vy;
      ball.radius = v.penRadius;
      return;
    }
    const inner = i === 0;
    const angle = inner ? v.innerAngle : v.outerAngle;
    const r = inner ? v.innerOrbit : v.outerOrbit;
    const period = inner ? v.periods.inner : v.periods.outer;
    ball.x = inner ? v.innerX : v.outerX;
    ball.y = inner ? v.innerY : v.outerY;
    // along the orbit (anticlockwise on screen) while the year counts up; the speed is the year's rate of the drawing
    const w = v.phase === "draw" && period > 0 && v.settings.secPerYear > 0 ? (2 * Math.PI) / (period * v.settings.secPerYear) : 0;
    ball.vx = r * w * Math.sin(angle);
    ball.vy = -r * w * Math.cos(angle);
    ball.radius = inner ? v.innerSize : v.outerSize;
  }

  onPostSubStep() {}
  onWallHit() {}
  onGapPass() {
    return true;
  }
  onPostUpdate() {}
  /** A canvas resize re-lays the machine out. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) this.refit(ctx);
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The machine draws forever: the recording's length (in whole loops) ends a clip. */
  isFinished() {
    return false;
  }
  // --- the loop contract (lib/loop/loopContract.ts): the cycle is known from the start, every seam a cycle apart
  cycleSeconds(): number | null {
    const c = this.view.timeline.cycle;
    return c > 0 && Number.isFinite(c) ? c : null;
  }
  loopSeams(): LoopSeams | null {
    const v = this.view;
    const c = v.timeline.cycle;
    if (!(c > 0) || !Number.isFinite(c)) return null;
    return { count: v.cycleIndex, lastMs: v.cycleIndex > 0 ? 1000 * v.cycleIndex * c : -1, nextMs: 1000 * (v.cycleIndex + 1) * c };
  }
  getState() {
    const v = this.view;
    return { machine: v.machine, cycle: v.cycleIndex, phase: v.phase, year: v.year, chords: v.chordsVisible, marks: v.marksVisible, trace: v.trace.total, scrolls: v.scrolls };
  }
}

/** Conjunction `j`'s pluck (Hz): degree j of the A major pentatonic from A4, wrapping after two octaves (A4, B4, C♯5, E5, F♯5, A5…). */
export function dmPluckFrequency(j: number): number {
  const degree = ((Math.floor(j) % DM_PLUCK_WRAP) + DM_PLUCK_WRAP) % DM_PLUCK_WRAP;
  return midiToFrequency(degreeToMidi(degree, DM_PLUCK_ROOT_MIDI, "majorPentatonic"));
}

/** The SoundEvent kinds a run plays (for tools and tests): the loop voices of the family. */
export const DRAWING_MACHINE_SOUND_KINDS: readonly NonNullable<SoundEvent["loop"]>[] = ["drone", "droneStop", "ratchet", "bed", "bedStop", "pluck", "wash"];
