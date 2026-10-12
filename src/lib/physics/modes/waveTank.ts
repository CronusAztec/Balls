import type { Ball, GameMode, LoopSeams, ModeContext, SoundEvent } from "../types";
import { parseWaveSections, resolveWaveTankSettings, sectionAtFrame, sectionRootHz, waveBellFrequencies, waveSchedule, type WaveSchedule, type WaveTankSettings, type WtModel, type WtSource } from "../waveTank";
import {
  WT_DEPTH_RATIO,
  WaveField,
  bellGain,
  gapCenters,
  gapsInTank,
  huygensPhasor,
  huygensSources,
  lineSourceGain,
  pingPong,
  planePhasor,
  pointSourceGain,
  type HuygensSource,
  type Phasor,
} from "@/lib/simulation/waveField";
import { SCAN_FLOOR } from "@/lib/audio/loopTones";

/*
 * --- wave-tank --- Wave Tank (rhythm family, the loop family's ripple tank; lib/simulation/waveField.ts is its water,
 * lib/physics/waveTank.ts its settings): a wave-maker along the back of a tank sends straight crests at a barrier with 1, 2 or
 * 7 gaps (the sections, each held for its seconds); behind it the gaps' fans spread, overlap into interference stripes or leave
 * as a grating's sharp beams, and a row of bells along the front rings as loud as the water moves under each one.
 *
 * Like Bouncing Orbs the mode owns its entities (the "none" ring layout): the engine's one ball is a placeholder pinned at the
 * tank's centre and never drawn. The water is the grid model (the wave equation on a 192 × 256 grid, leapfrog sub-steps at a
 * Courant number ≤ 0.5) or the Huygens sum; either is a pure function of the run's clock and the settings – there is no
 * randomness at all (`ctx.random()` is never called), so every seed plays the same run and the finder has nothing to search.
 *
 * The loop: the sections' frames add up to the loop (whole 60 Hz frames), the first section may wrap across the loop point
 * (Wrap), and the source's frequency is snapped to a whole number of cycles a loop, so the forcing repeats exactly every loop.
 * The grid is pre-rolled through one whole loop before t = 0 (at most WT_PREROLL_BUDGET cell sub-steps; a huge grid pre-rolls the
 * loop's last part), so the run starts in the periodic state – the closing section rebuilds the frame-0 field and the clip
 * loops seamlessly (`data-wt-seam-error` measures it). The section switches on the exact frame; the old pattern keeps
 * travelling toward the front and leaves through the absorbing sponge.
 *
 * Sound (lib/audio/loopTones.ts through `ToneGenerator.playLoop()`): a cursor ping-pongs along the bells at Scan rate (8 a
 * second); each strike is a scanned tuned bar ("scan": the bar with a ~1 s ring) at the bell's pitch – A major pentatonic over
 * two octaves, low to high left to right – as loud as (|u| / max)^1.5 of the smoothed amplitude under it, and a strike under
 * −40 dB is skipped. Under the bells a section root ("root": a sine + 2f, ~13 dB under them) crossfades over 1 s at every
 * section change. Every strike is bounce math's "bounce".
 */

/** One unit of Wave speed in tank widths a second. */
export const WT_SPEED_UNIT = 0.3;
/** The incident wave's amplitude (the field's unit). */
export const WT_AMPLITUDE = 1;
/** Depths (fractions of the tank's depth) of the wave-maker and of the barrier's back face, and the barrier's thickness (tank widths). */
export const WT_SOURCE_DEPTH = 0.035;
export const WT_BARRIER_DEPTH = 0.12;
export const WT_BARRIER_THICKNESS = 0.012;
/** How far in front of the front edge (tank widths) the bells sample the water. */
export const WT_BELL_INSET = 0.02;
/** The bells' amplitude follower: a mean square smoothed over this many seconds (amplitude = √(2·mean square)). */
export const WT_ENV_TAU = 0.25;
/** The row's reference amplitude: the loudest bell, held and let down over this many seconds, never under WT_REF_FLOOR × A. */
export const WT_PEAK_DECAY_SEC = 2;
export const WT_REF_FLOOR = 0.2;
/** Cell sub-steps the pre-roll may take (the default grid needs ~9·10⁷: 12.4 s of a 192 × 256 grid at two sub-steps a frame). */
export const WT_PREROLL_BUDGET = 200_000_000;
/**
 * Cell sub-steps one engine step may take (a 1024-column grid at the slider's speeds needs ~1.7·10⁷): past it – a grid at the
 * memory ceiling with a wave far past the speed slider – the water falls behind the clock (`lag`) rather than stall the page.
 */
export const WT_STEP_CELL_BUDGET = 32_000_000;
/** Phasor evaluations the Huygens ridges may take for one section (the ridges' samples across are lowered to fit). */
export const WT_PHASOR_BUDGET = 30_000_000;
/**
 * How long the grid is pre-rolled, in transits of the tank ((depth + width) / speed: the longest a wave stays in it before the
 * sponge takes it): whatever the water held before has left by then, so the state at t = 0 is the loop's periodic state (the
 * seam check measures what is left: ~10⁻³ of the wave's amplitude at the defaults). A loop shorter than that is pre-rolled whole.
 */
export const WT_PREROLL_TRANSITS = 1.6;
/** Sub-steps one engine step may take at most (a step past it lets the water fall behind rather than stall the page). */
export const WT_MAX_SUBSTEPS_PER_STEP = 512;
/** Strikes a step plays at most (the rest are counted, not played). */
export const WT_STRIKES_PER_STEP = 2;
/** Samples a ridge line holds at most, and the probes of the seam check (a lattice of WT_PROBES² points). */
export const WT_SAMPLES_MAX = 512;
export const WT_PROBES = 24;
/** Section changes the view logs (frames), and seams checked against t = 0. */
export const WT_LOG_CAP = 64;
export const WT_SEAMS_CHECKED = 8;
/** The section root's level. */
export const WT_ROOT_LEVEL = 1;
/** Huygens phasor caches kept (one per section the ridges met lately). */
export const WT_PHASOR_CACHE = 6;

/** Where the tank sits in the world: its centre and the side of the page's centred square (world px). */
export interface WaveTankFrame {
  cx: number;
  cy: number;
  side: number;
}

/** What the canvas, the HUD, the smoke test and the tests read of a run (the same object every call). */
export interface WaveTankView {
  /** Bumped by every init. */
  generation: number;
  settings: WaveTankSettings;
  model: WtModel;
  source: WtSource;
  /** The tank: its depth (tank widths), the wave-maker's depth, the barrier's back and front faces. */
  depth: number;
  sourceZ: number;
  barrierZ0: number;
  barrierZ1: number;
  /** The wave as run: wavelength (tank widths, after the frequency snap), frequency (Hz), cycles a loop, speed (tank widths/s). */
  wavelength: number;
  frequency: number;
  cycles: number;
  speed: number;
  /** The loop (s and frames) and its sections. */
  loopSec: number;
  schedule: WaveSchedule;
  /** The grid (null: the Huygens model): its visible columns × rows, the sponge, the cells, sub-steps a frame, whether the columns were lowered. */
  grid: { cols: number; rows: number; sponge: number; cells: number; substeps: number; clamped: boolean } | null;
  /** Seconds of the loop the grid was pre-rolled through before t = 0. */
  prerollSec: number;
  frame: WaveTankFrame;
  /** Simulation time (s) of the last step, the loop it is in and its time within the loop. */
  timeSec: number;
  loopIndex: number;
  loopTimeSec: number;
  /** The section in force (index), its gaps and its gaps' width (wavelengths); its open gaps' centres (tank x) and width (tank widths). */
  section: number;
  gaps: number;
  sectionWidth: number;
  gapX: number[];
  gapWidth: number;
  /** Section changes so far, and the frames of the first WT_LOG_CAP. */
  sectionChanges: number;
  changeFrames: number[];
  /** The ridge lines: their count, samples each, depths, the samples' x and the heights (u / A), ridge by ridge. */
  ridges: number;
  samples: number;
  ridgeZ: Float32Array;
  sampleX: Float32Array;
  heights: Float32Array;
  /** The bells: their x, pitch (Hz), smoothed amplitude (/ A), level (amplitude / the row's reference, 0–1) and last strike (s, −1: none). */
  bells: number;
  bellX: Float32Array;
  bellHz: number[];
  bellAmp: Float32Array;
  bellLevel: Float32Array;
  bellStrikeSec: Float64Array;
  /** The row's reference amplitude (/ A), the last bell struck, strikes played and skipped (under −40 dB). */
  reference: number;
  cursor: number;
  strikes: number;
  skipped: number;
  /** Sound events sent, section roots among them, and the root playing (Hz; 0: none). */
  sounds: number;
  roots: number;
  rootHz: number;
  /** The largest |u| / A of the visible water and the cells (or samples) that are not finite at the last check (always 0). */
  maxAbs: number;
  nonFinite: number;
  /** Seams crossed, and the worst difference (/ A) between the water at a seam and at t = 0 (−1: not checked yet). */
  seams: number;
  seamError: number;
  /** Sub-steps the water lags the clock by (0 unless an extreme step outran WT_MAX_SUBSTEPS_PER_STEP). */
  lag: number;
}

const PHASOR: Phasor = { c: 0, s: 0 };

/** x of sample s of n across the tank (−½ … ½). */
function sampleXOf(s: number, n: number): number {
  return n > 1 ? -0.5 + s / (n - 1) : 0;
}

export class WaveTankMode implements GameMode {
  readonly name = "waveTank";
  /** The placeholder ball is pinned: no slow-ball boost and no pair collisions may touch it. */
  readonly ballsMayRest = true;
  readonly ballsPassThrough = true;
  private settings: WaveTankSettings = resolveWaveTankSettings(null);
  private readonly view: WaveTankView;
  private field: WaveField | null = null;
  /** Sub-steps a 60 Hz frame takes (the grid's; 1 for the Huygens model), a loop's sub-steps, the sub-step (s). */
  private k = 1;
  private nLoop = 1;
  private dt = 1 / 60;
  /** The field's sub-step counter: 0 at the run's start, negative through the pre-roll. */
  private n = 0;
  private nPreStart = 0;
  /** The section the barrier is set for (−1: none yet). */
  private barrierSection = -1;
  private lineGain = 0;
  private pointGain = 0;
  /** Each section's gap centres (tank x) and width (tank widths), and its Huygens wavelets (built when first needed). */
  private sectionGaps: number[][] = [];
  private sectionWidths: number[] = [];
  private sectionSources = new Map<number, HuygensSource[]>();
  /** The Huygens ridges' phasors by section (2 floats a sample), the layout they were made for, oldest first. */
  private phasorCache = new Map<number, Float32Array>();
  private layoutKey = "";
  /** The bells' mean squares, and the field step the ridges were last sampled at (−1: never). */
  private env = new Float64Array(0);
  private ridgeStamp = Number.NaN;
  private peak = WT_REF_FLOOR;
  private lastEmit = -1e-9;
  private anchorId = -1;
  private rootPending = true;
  private rootStopPending = false;
  private probeStart: ArrayLike<number> = new Float32Array(0);
  private lastSection = -1;

  constructor() {
    const settings = resolveWaveTankSettings(null);
    const schedule = waveSchedule(parseWaveSections(settings.gaps, settings.sectionSec, settings.width, settings.widthEnd), settings.wrapSec);
    this.view = {
      generation: 0,
      settings,
      model: settings.model,
      source: settings.source,
      depth: WT_DEPTH_RATIO,
      sourceZ: WT_SOURCE_DEPTH * WT_DEPTH_RATIO,
      barrierZ0: WT_BARRIER_DEPTH * WT_DEPTH_RATIO,
      barrierZ1: WT_BARRIER_DEPTH * WT_DEPTH_RATIO + WT_BARRIER_THICKNESS,
      wavelength: settings.wavelengthPct / 100,
      frequency: 0,
      cycles: 0,
      speed: settings.speed * WT_SPEED_UNIT,
      loopSec: schedule.loopFrames / 60,
      schedule,
      grid: null,
      prerollSec: 0,
      frame: { cx: 400, cy: 300, side: 600 },
      timeSec: 0,
      loopIndex: 0,
      loopTimeSec: 0,
      section: 0,
      gaps: schedule.sections[0].gaps,
      sectionWidth: schedule.sections[0].width,
      gapX: [],
      gapWidth: 0,
      sectionChanges: 0,
      changeFrames: [],
      ridges: 0,
      samples: 0,
      ridgeZ: new Float32Array(0),
      sampleX: new Float32Array(0),
      heights: new Float32Array(0),
      bells: 0,
      bellX: new Float32Array(0),
      bellHz: [],
      bellAmp: new Float32Array(0),
      bellLevel: new Float32Array(0),
      bellStrikeSec: new Float64Array(0),
      reference: WT_REF_FLOOR,
      cursor: -1,
      strikes: 0,
      skipped: 0,
      sounds: 0,
      roots: 0,
      rootHz: 0,
      maxAbs: 0,
      nonFinite: 0,
      seams: 0,
      seamError: -1,
      lag: 0,
    };
  }

  getSettings(): WaveTankSettings {
    return this.settings;
  }
  /** The water's settings apply on the next init; the bells, the scan, the ridges, the tilt, the bass and the label at once. */
  setSettings(patch: Partial<WaveTankSettings>) {
    const was = this.settings;
    this.settings = resolveWaveTankSettings({ ...this.settings, ...patch });
    const s = this.settings;
    const v = this.view;
    v.settings.tilt = s.tilt;
    v.settings.scanRate = s.scanRate;
    v.settings.label = s.label;
    if (s.bells !== v.bells && v.generation > 0) {
      v.settings.bells = s.bells;
      this.layOutBells();
    }
    if (s.ridges !== v.ridges && v.generation > 0) {
      v.settings.ridges = s.ridges;
      this.layOutRidges();
    }
    if (s.bass !== was.bass) {
      v.settings.bass = s.bass;
      if (s.bass) this.rootPending = true;
      else this.rootStopPending = true;
    }
  }
  /** Live state for the canvas and the HUD; the same object every call (the ridges sampled at the latest step). */
  getView(): WaveTankView {
    this.sampleRidges();
    return this.view;
  }
  /** The loop HUD's label: the section's gap (or source) count, or null with the label off. */
  hudCount(): number | null {
    return this.view.settings.label ? this.view.gaps : null;
  }
  /** The run (re)joined a live audio graph mid-run: the section root is sent again with the next step. */
  refreshRoot() {
    if (this.settings.bass) this.rootPending = true;
  }
  getProgress() {
    const v = this.view;
    return { section: v.section, gaps: v.gaps, strikes: v.strikes, skipped: v.skipped, seams: v.seams, sounds: v.sounds };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const s = this.settings;
    const v = this.view;
    v.generation++;
    v.settings = { ...s };
    v.model = s.model;
    v.source = s.source;
    const depth = WT_DEPTH_RATIO;
    v.depth = depth;
    v.sourceZ = WT_SOURCE_DEPTH * depth;
    v.barrierZ0 = WT_BARRIER_DEPTH * depth;
    v.barrierZ1 = v.barrierZ0 + WT_BARRIER_THICKNESS;
    // the sections and the loop; the frequency snapped to whole cycles a loop
    const schedule = waveSchedule(parseWaveSections(s.gaps, s.sectionSec, s.width, s.widthEnd), s.wrapSec);
    v.schedule = schedule;
    v.loopSec = schedule.loopFrames / 60;
    const speed = s.speed * WT_SPEED_UNIT;
    const lambda0 = s.wavelengthPct / 100;
    const cycles = Math.max(1, Math.round((speed / lambda0) * v.loopSec));
    v.cycles = cycles;
    v.frequency = cycles / v.loopSec;
    v.speed = speed;
    v.wavelength = speed / v.frequency;
    // every section's gaps (in tank x) and width; the wavelets are built when first needed
    this.sectionGaps = schedule.sections.map((sec) => gapsInTank(gapCenters(sec.gaps, s.spacing * v.wavelength), sec.width * v.wavelength));
    this.sectionWidths = schedule.sections.map((sec) => sec.width * v.wavelength);
    this.sectionSources.clear();
    this.phasorCache.clear();
    this.layoutKey = "";
    // the clock
    v.timeSec = 0;
    v.loopIndex = 0;
    v.loopTimeSec = 0;
    v.sectionChanges = 0;
    v.changeFrames.length = 0;
    v.strikes = 0;
    v.skipped = 0;
    v.sounds = 0;
    v.roots = 0;
    v.rootHz = 0;
    v.cursor = -1;
    v.seams = 0;
    v.seamError = -1;
    v.lag = 0;
    v.maxAbs = 0;
    v.nonFinite = 0;
    this.lastEmit = -1e-9;
    this.rootPending = s.bass;
    this.rootStopPending = false;
    this.barrierSection = -1;
    this.peak = WT_REF_FLOOR;
    this.ridgeStamp = Number.NaN;
    v.section = -1;
    v.gapX = [];
    this.layOutFrame(ctx);
    this.layOutBells();
    // the water: the grid, pre-rolled through the loop before t = 0 (or the Huygens sum, periodic by construction)
    this.field = null;
    v.grid = null;
    v.prerollSec = 0;
    if (s.model === "grid") {
      const field = new WaveField({ cols: s.cols, depthRatio: depth, wavelength: v.wavelength, speed, damping: s.damping * 2 * Math.PI * v.frequency, stepSec: 1 / 60 });
      this.field = field;
      this.k = field.substeps;
      this.dt = field.dt;
      this.nLoop = schedule.loopFrames * this.k;
      const size = field.size;
      v.grid = { cols: size.cols, rows: size.rows, sponge: size.sponge, cells: size.cells, substeps: field.substeps, clamped: size.clamped };
      this.lineGain = lineSourceGain(WT_AMPLITUDE, speed, size.h);
      this.pointGain = pointSourceGain(WT_AMPLITUDE, speed, size.h);
      if (s.source === "line") field.setLineSource(v.sourceZ);
      else field.setLineSource(null);
      const budget = Math.floor(WT_PREROLL_BUDGET / Math.max(1, size.cells));
      const transits = Math.round(((WT_PREROLL_TRANSITS * (depth + 1)) / speed) * 60) * this.k;
      const pre = Math.max(0, Math.min(this.nLoop, transits, budget));
      this.nPreStart = -pre;
      this.n = -pre;
      v.prerollSec = pre / (60 * this.k);
      const warm = Math.round(2 / this.dt); // the bells' follower runs over the pre-roll's last 2 s
      while (this.n < 0) {
        this.advance(1);
        if (this.n % this.k === 0 && -this.n <= warm) this.listen(this.n / this.k / 60, 1 / 60);
      }
    } else {
      this.k = 1;
      this.dt = 1 / 60;
      this.nLoop = schedule.loopFrames;
      this.n = 0;
      this.nPreStart = 0;
      for (let f = -120; f < 0; f++) this.listen(f / 60, 1 / 60);
    }
    this.layOutRidges();
    this.applySection(this.sectionAtStep(0));
    this.updateSectionView(0);
    this.lastSection = v.section;
    this.probeStart = this.probe();
    this.ridgeStamp = Number.NaN;
    // the engine's placeholder ball, pinned at the tank's centre (the water and the bells are drawn instead)
    this.anchorId = ctx.getNextId();
    ctx.addBall({ x: v.frame.cx, y: v.frame.cy, vx: 0, vy: 0, radius: ctx.config.ballRadius || 8, color: ctx.config.ballColor || "#FFFFFF", gravityScale: 0 });
  }

  /** The page's centred square (the tank fills it; the renderer projects into it). */
  private layOutFrame(ctx: ModeContext) {
    const w = ctx.config.width || 800;
    const h = ctx.config.height || 600;
    this.view.frame.cx = w / 2;
    this.view.frame.cy = h / 2;
    this.view.frame.side = Math.min(w, h);
  }

  /** The bells: evenly along the front edge, low to high left to right; their followers start from still water. */
  private layOutBells() {
    const v = this.view;
    const n = Math.max(1, Math.floor(this.settings.bells));
    v.bells = n;
    v.settings.bells = n;
    v.bellX = new Float32Array(n);
    for (let b = 0; b < n; b++) v.bellX[b] = (b + 0.5) / n - 0.5;
    v.bellHz = waveBellFrequencies(n);
    v.bellAmp = new Float32Array(n);
    v.bellLevel = new Float32Array(n);
    v.bellStrikeSec = new Float64Array(n).fill(-1);
    this.env = new Float64Array(n);
    v.cursor = -1;
  }

  /** The ridge lines: from the wave-maker to the front edge, each sampled across the tank. */
  private layOutRidges() {
    const v = this.view;
    const r = Math.max(2, Math.floor(this.settings.ridges));
    const across = this.field ? this.field.size.cols : Math.round(8 / Math.max(1e-3, v.wavelength));
    let samples = Math.max(32, Math.min(WT_SAMPLES_MAX, across));
    if (!this.field) {
      // the Huygens ridges: a section's phasors are ridges × samples × wavelets evaluations, kept under WT_PHASOR_BUDGET
      let most = 1;
      for (let i = 0; i < this.sectionGaps.length; i++) most = Math.max(most, this.sourcesOf(i).length);
      samples = Math.max(8, Math.min(samples, Math.floor(WT_PHASOR_BUDGET / (r * most))));
    }
    v.ridges = r;
    v.settings.ridges = r;
    v.samples = samples;
    v.ridgeZ = new Float32Array(r);
    for (let i = 0; i < r; i++) v.ridgeZ[i] = v.sourceZ + ((v.depth - v.sourceZ) * i) / (r - 1);
    v.sampleX = new Float32Array(samples);
    for (let s = 0; s < samples; s++) v.sampleX[s] = sampleXOf(s, samples);
    v.heights = new Float32Array(r * samples);
    this.phasorCache.clear();
    this.layoutKey = `${r}x${samples}`;
    this.ridgeStamp = Number.NaN;
  }

  /** The section the barrier holds for sub-step n (whole frames: a section starts on its exact frame). */
  private sectionAtStep(n: number): number {
    return sectionAtFrame(this.view.schedule, Math.floor(n / this.k));
  }

  /** The source's phase at sub-step n: whole cycles a loop, so it repeats exactly every loop. */
  private phaseAt(n: number): number {
    const m = ((n % this.nLoop) + this.nLoop) % this.nLoop;
    return (2 * Math.PI * this.view.cycles * m) / this.nLoop;
  }

  /** Sets the barrier (or the point sources) of section `index` on the grid. */
  private applySection(index: number) {
    if (index === this.barrierSection) return;
    this.barrierSection = index;
    const field = this.field;
    if (!field) return;
    const v = this.view;
    const gaps = this.sectionGaps[index] ?? [];
    if (v.source === "points") {
      field.setBarrier(0, 0, null);
      field.setPointSources(gaps, v.barrierZ0);
    } else field.setBarrier(v.barrierZ0, v.barrierZ1, gaps, this.sectionWidths[index] ?? 0);
  }

  /** Advances the grid `count` sub-steps (the barrier set for each, the source's ramp-in over its first two cycles). */
  private advance(count: number) {
    const field = this.field;
    if (!field) {
      this.n += count;
      return;
    }
    const v = this.view;
    const omega = 2 * Math.PI * v.frequency;
    const ramp = (2 * this.nLoop) / Math.max(1, v.cycles);
    this.applySection(this.sectionAtStep(this.n));
    for (let i = 0; i < count; i++) {
      const n = this.n;
      const theta = this.phaseAt(n);
      const since = n - this.nPreStart;
      const r = since >= ramp ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * since) / ramp);
      if (v.source === "points") field.step(0, r * this.pointGain * Math.sin(theta));
      else field.step(r * this.lineGain * omega * Math.cos(theta), 0);
      this.n++;
      // the next sub-step's barrier at once: a frame that ends on a section's first sub-step shows its barrier (as t = 0 does)
      this.applySection(this.sectionAtStep(this.n));
    }
  }

  /** The water at (x, z) at sub-step n's time: the grid's sample, or the Huygens sum with the section in force where the wave left the barrier. */
  private fieldAt(x: number, z: number, n: number): number {
    if (this.field) return this.field.sample(x, z) / WT_AMPLITUDE;
    const v = this.view;
    const t = n / (60 * this.k);
    const delay = v.source === "points" ? Math.abs(z - v.barrierZ0) / v.speed : Math.max(0, z - v.barrierZ0) / v.speed;
    const sec = sectionAtFrame(v.schedule, Math.floor((t - delay) * 60 + 1e-9));
    this.phasorAt(x, z, sec, PHASOR);
    const theta = this.phaseAt(n);
    return (PHASOR.c * Math.cos(theta) + PHASOR.s * Math.sin(theta)) / WT_AMPLITUDE;
  }

  /** The Huygens phasor at (x, z) for section `sec`: the plane wave before the barrier, the gaps' wavelets past it. */
  private phasorAt(x: number, z: number, sec: number, out: Phasor) {
    const v = this.view;
    if (v.source === "line" && z < v.barrierZ0) {
      if (z < v.sourceZ) {
        out.c = 0;
        out.s = 0;
      } else planePhasor(z, v.sourceZ, v.wavelength, WT_AMPLITUDE, out);
      return;
    }
    const sources = this.sourcesOf(sec);
    const phase0 = v.source === "points" ? 0 : (2 * Math.PI * (v.barrierZ1 - v.sourceZ)) / v.wavelength;
    huygensPhasor(x, z, sources, v.wavelength, phase0, v.source === "points", out);
  }

  /** Section `sec`'s Huygens wavelets (made once a run). */
  private sourcesOf(sec: number): HuygensSource[] {
    let sources = this.sectionSources.get(sec);
    if (!sources) {
      const v = this.view;
      const points = v.source === "points";
      sources = huygensSources(this.sectionGaps[sec] ?? [], this.sectionWidths[sec] ?? 0, points ? v.barrierZ0 : v.barrierZ1, v.wavelength, WT_AMPLITUDE, points);
      this.sectionSources.set(sec, sources);
    }
    return sources;
  }

  /** The bells listen: each one's mean square follows u² at its spot; the row's reference is the loudest, held for a while. */
  private listen(_t: number, dtSec: number) {
    const v = this.view;
    const z = v.depth - WT_BELL_INSET;
    const alpha = 1 - Math.exp(-Math.max(0, dtSec) / WT_ENV_TAU);
    let loudest = 0;
    for (let b = 0; b < v.bells; b++) {
      const u = this.fieldAt(v.bellX[b], z, this.n);
      const sq = Number.isFinite(u) ? u * u : 0;
      this.env[b] += (sq - this.env[b]) * alpha;
      const amp = Math.sqrt(2 * Math.max(0, this.env[b]));
      v.bellAmp[b] = amp;
      if (amp > loudest) loudest = amp;
    }
    this.peak = Math.max(loudest, this.peak * Math.exp(-Math.max(0, dtSec) / WT_PEAK_DECAY_SEC), WT_REF_FLOOR);
    v.reference = this.peak;
    for (let b = 0; b < v.bells; b++) v.bellLevel[b] = Math.min(1, v.bellAmp[b] / this.peak);
  }

  onPreUpdate() {}

  /** The placeholder ball stays pinned at the tank's centre. */
  onBallStep(_ctx: ModeContext, ball: Ball) {
    if (ball.id !== this.anchorId) return;
    ball.x = this.view.frame.cx;
    ball.y = this.view.frame.cy;
    ball.vx = 0;
    ball.vy = 0;
  }

  onPostSubStep() {}

  /** The water up to the step's end (the sub-steps it owes), the bells, the section, the seam check, then the step's sounds. */
  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const t1 = ctx.getElapsedMs() / 1000;
    const target = Math.round(t1 * 60 * this.k);
    const owed = target - this.n;
    const most = this.field ? Math.max(1, Math.min(WT_MAX_SUBSTEPS_PER_STEP, Math.floor(WT_STEP_CELL_BUDGET / this.field.size.cells))) : WT_MAX_SUBSTEPS_PER_STEP;
    if (owed > 0) this.advance(Math.min(owed, most));
    v.lag = Math.max(0, target - this.n);
    this.listen(t1, Math.max(0, dtMs) / 1000);
    v.timeSec = t1;
    const P = v.loopSec;
    v.loopIndex = Math.floor((t1 + 1e-9) / P);
    v.loopTimeSec = t1 - v.loopIndex * P;
    this.updateSectionView(Math.round(t1 * 60));
    // the seam check: the water at a seam against t = 0
    const seamsNow = Math.floor((this.n + 1e-9) / this.nLoop);
    if (seamsNow > v.seams) {
      v.seams = seamsNow;
      if (seamsNow <= WT_SEAMS_CHECKED && this.n === seamsNow * this.nLoop) {
        const now = this.probe();
        let err = 0;
        for (let i = 0; i < now.length; i++) err = Math.max(err, Math.abs(now[i] - this.probeStart[i]));
        v.seamError = Math.max(v.seamError, err);
      }
    }
    // the root: at the first step, at every section change, or after a refresh
    if (v.section !== this.lastSection) {
      this.lastSection = v.section;
      if (this.settings.bass) this.rootPending = true;
    }
    if (this.rootStopPending) {
      this.rootStopPending = false;
      v.rootHz = 0;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "rootStop", level: 0, melody: false });
    }
    if (this.rootPending && this.settings.bass) {
      this.rootPending = false;
      v.rootHz = sectionRootHz(v.section);
      v.roots++;
      this.emit(ctx, { type: "hit", wallIndex: 0, loop: "root", frequency: v.rootHz, level: WT_ROOT_LEVEL, melody: false });
    }
    this.strike(ctx, this.lastEmit, t1);
    this.lastEmit = t1;
  }

  /** The section in force at the field's clock, its gaps, and a change logged on its exact frame. */
  private updateSectionView(frame: number) {
    const v = this.view;
    const index = this.sectionAtStep(this.n);
    if (index !== v.section || v.gapX.length === 0) {
      if (index !== v.section && this.n > 0) {
        v.sectionChanges++;
        if (v.changeFrames.length < WT_LOG_CAP) v.changeFrames.push(frame);
      }
      v.section = index;
      const sec = v.schedule.sections[index];
      v.gaps = sec.gaps;
      v.sectionWidth = sec.width;
      v.gapX = this.sectionGaps[index] ?? [];
      v.gapWidth = this.sectionWidths[index] ?? 0;
    }
  }

  /** The cursor's strikes in (t0, t1]: strike j of a loop at j / rate, the bell by ping-pong; quiet ones skipped. */
  private strike(ctx: ModeContext, t0: number, t1: number) {
    const v = this.view;
    const rate = this.settings.scanRate;
    const P = v.loopSec;
    if (!(rate > 0) || !(P > 0)) return;
    const perLoop = Math.max(1, Math.ceil(P * rate - 1e-9));
    let L = Math.floor(Math.max(0, t0) / P);
    let j = t0 < 0 ? 0 : Math.floor((t0 - L * P) * rate + 1e-9) + 1;
    let played = 0;
    let guard = 0;
    for (;;) {
      if (j >= perLoop) {
        L++;
        j = 0;
      }
      const at = L * P + j / rate;
      if (at > t1 + 1e-9) break;
      if (++guard > 10_000) {
        // a scan far faster than the step: the rest of the window is counted, not played
        v.skipped += Math.max(0, Math.floor((t1 - at) * rate));
        break;
      }
      const bell = pingPong(j, v.bells);
      const amp = v.bellAmp[bell] ?? 0;
      const gain = bellGain(amp, v.reference);
      v.cursor = bell;
      if (gain < SCAN_FLOOR || played >= WT_STRIKES_PER_STEP) v.skipped++;
      else {
        played++;
        v.strikes++;
        v.bellStrikeSec[bell] = at;
        this.emit(ctx, { type: "hit", wallIndex: 0, loop: "scan", frequency: v.bellHz[bell], level: Math.min(1, amp / v.reference), melody: false });
        if (ctx.noteBounce) {
          const anchor = ctx.getBalls().find((b) => b.id === this.anchorId);
          if (anchor) ctx.noteBounce(anchor);
        }
      }
      j++;
    }
  }

  private emit(ctx: ModeContext, event: SoundEvent) {
    ctx.addPendingSoundEvent(event);
    this.view.sounds++;
  }

  /** The water on the seam check's lattice (WT_PROBES² points over the tank behind the barrier and in front of it). */
  private probe(): Float32Array {
    const v = this.view;
    const out = new Float32Array(WT_PROBES * WT_PROBES);
    for (let j = 0; j < WT_PROBES; j++) {
      const z = v.sourceZ + ((v.depth - WT_BELL_INSET - v.sourceZ) * (j + 0.5)) / WT_PROBES;
      for (let i = 0; i < WT_PROBES; i++) out[j * WT_PROBES + i] = this.fieldAt(-0.45 + (0.9 * (i + 0.5)) / WT_PROBES, z, this.n);
    }
    return out;
  }

  /** The ridges' heights at the latest step (sampled once per step a frame shows; nothing allocated but a new section's phasors). */
  private sampleRidges() {
    const v = this.view;
    if (this.ridgeStamp === this.n || v.generation === 0) return;
    this.ridgeStamp = this.n;
    const R = v.ridges;
    const S = v.samples;
    const h = v.heights;
    let max = 0;
    let bad = 0;
    if (this.field) {
      for (let r = 0; r < R; r++) {
        const z = v.ridgeZ[r];
        for (let s = 0; s < S; s++) h[r * S + s] = this.field.sample(v.sampleX[s], z) / WT_AMPLITUDE;
      }
    } else {
      const t = this.n / 60;
      const theta = this.phaseAt(this.n);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      for (let r = 0; r < R; r++) {
        const z = v.ridgeZ[r];
        const delay = v.source === "points" ? Math.abs(z - v.barrierZ0) / v.speed : Math.max(0, z - v.barrierZ0) / v.speed;
        const sec = sectionAtFrame(v.schedule, Math.floor((t - delay) * 60 + 1e-9));
        const cache = this.phasorsOf(sec);
        const base = r * S;
        for (let s = 0; s < S; s++) h[base + s] = (cache[2 * (base + s)] * cos + cache[2 * (base + s) + 1] * sin) / WT_AMPLITUDE;
      }
    }
    for (let i = 0; i < R * S; i++) {
      const a = h[i];
      if (!Number.isFinite(a)) bad++;
      else if (Math.abs(a) > max) max = Math.abs(a);
    }
    if (this.field) {
      const stats = this.field.stats();
      v.maxAbs = stats.maxAbs / WT_AMPLITUDE;
      v.nonFinite = stats.nonFinite + bad;
    } else {
      v.maxAbs = max;
      v.nonFinite = bad;
    }
  }

  /** The ridges' Huygens phasors of section `sec` (made once per section and layout; the oldest let go past WT_PHASOR_CACHE). */
  private phasorsOf(sec: number): Float32Array {
    const hit = this.phasorCache.get(sec);
    if (hit) return hit;
    const v = this.view;
    const R = v.ridges;
    const S = v.samples;
    const out = new Float32Array(2 * R * S);
    for (let r = 0; r < R; r++) {
      const z = v.ridgeZ[r];
      for (let s = 0; s < S; s++) {
        this.phasorAt(v.sampleX[s], z, sec, PHASOR);
        out[2 * (r * S + s)] = PHASOR.c;
        out[2 * (r * S + s) + 1] = PHASOR.s;
      }
    }
    if (this.phasorCache.size >= WT_PHASOR_CACHE) {
      const oldest = this.phasorCache.keys().next().value;
      if (oldest !== undefined) this.phasorCache.delete(oldest);
    }
    this.phasorCache.set(sec, out);
    return out;
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /** A canvas resize lays the tank out in the new square (the water itself is in tank units) and pins the ball there. */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (sizeChanged) {
      this.layOutFrame(ctx);
      for (const ball of ctx.getBalls()) {
        if (ball.id !== this.anchorId) continue;
        ball.x = this.view.frame.cx;
        ball.y = this.view.frame.cy;
      }
    }
    return true;
  }
  /** There are no rings. */
  shouldSkipWallCollision() {
    return true;
  }
  /** The tank loops forever (the recording's length, in whole loops, ends a clip). */
  isFinished() {
    return false;
  }
  // --- the loop contract (lib/loop/loopContract.ts): every loop is whole frames and whole source cycles; its state the run's start
  cycleSeconds(): number | null {
    return this.view.loopSec;
  }
  loopSeams(ctx: ModeContext): LoopSeams | null {
    const period = this.view.loopSec;
    if (!(period > 0)) return null;
    const t = ctx.getElapsedMs() / 1000;
    const count = Math.floor((t + 1e-9) / period);
    return { count, lastMs: count > 0 ? 1000 * count * period : -1, nextMs: 1000 * (count + 1) * period };
  }
  getState() {
    const v = this.view;
    return { timeSec: v.timeSec, section: v.section, gaps: v.gaps, strikes: v.strikes, skipped: v.skipped, seams: v.seams };
  }
}
