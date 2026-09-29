import { describe, expect, it } from "vitest";
import {
  CUBE_PAD,
  DEFAULT_RUNNER_SETTINGS,
  FACE_MARGIN,
  FINISH_HOLD_SEC,
  GAP_MARGIN,
  LEAD_IN_SEC,
  MIN_RUN_SEC,
  RESPAWN_SEC,
  RUNNER_GRAVITY,
  RUNNER_RANGES,
  SECTION_EVENTS,
  SPIKE_HALF_W,
  SPIKE_HIT_H,
  ascendTime,
  buildRunnerCourse,
  buildRunnerField,
  defaultRunnerFields,
  dropTime,
  jumpFlightTime,
  jumpHeightAt,
  resolveRunnerFields,
  resolveRunnerSettings,
  runnerBeatConfig,
  runnerCollides,
  runnerDegree,
  runnerMaxSpikes,
  runnerPhysics,
  runnerSettingsOf,
  takeOffSec,
  type RunnerCourse,
  type RunnerSettings,
} from "@/lib/physics/modes/runner";
import { beatTimeSec, beatTimesFrom, firstBeatAtOrAfter, scheduleBpm, schedulePeriod } from "@/lib/simulation/beatSchedule";
import { BeatClock, DEFAULT_BEAT_CLOCK, type BeatClockConfig, type BeatGrid } from "@/lib/simulation/beatClock";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { frequencyToMidi } from "@/lib/audio/scales";
import { isJdmRhythmMode, rhythmDegreeMidi } from "@/lib/physics/modes/jdmRhythm";

/**
 * Beat Runner (feature jdm-rhythm-runner): the jump-timing solver, the beat schedule it plans on (the beat clock of
 * Picture Paint, inverted), the course builder (every landing on a beat, obstacles the arcs clear), the settings, and
 * whole runs in the engine – auto jump lands every jump on the beat and never fails, a hand-played run crashes and
 * restarts its section a whole number of beats later, the finder reads the auto run's length off its plan.
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
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
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

/** Park–Miller, for courses built outside the engine. */
function lcg(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A song grid: beats every 60/bpm s from `first`, with a little jitter so it is not a perfect grid. */
function songGrid(bpm = 128, first = 0.37, duration = 24, jitter = 0.012): BeatGrid {
  const period = 60 / bpm;
  const beatTimes: number[] = [];
  let i = 0;
  for (let t = first; t < duration; t += period, i++) beatTimes.push(t + (i % 3 === 1 ? jitter : i % 3 === 2 ? -jitter : 0));
  return { bpm, beatTimes, duration };
}

function engineFor(rr: Partial<RunnerSettings> = {}, seed = 12345, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "runner", { ...modeSettings, runner: rr }, seed);
}

interface RunLog {
  landings: { atSec: number; event: number }[];
  sounds: { atMs: number; event: SoundEvent }[];
  finishedMs: number;
  deaths: number;
}

function runToEnd(engine: ReturnType<typeof engineFor>, maxMs = 240_000, beforeStep?: (elapsedMs: number) => void): RunLog {
  const log: RunLog = { landings: [], sounds: [], finishedMs: -1, deaths: 0 };
  let landings = 0;
  for (let t = 0; t < maxMs; t += STEP) {
    beforeStep?.(engine.getElapsedMs());
    engine.update(STEP, 0);
    const view = engine.getRunnerView();
    if (view.landings !== landings) {
      landings = view.landings;
      log.landings.push({ atSec: view.lastLandSec, event: view.lastLandEvent });
    }
    for (const event of engine.consumeSoundEvents()) log.sounds.push({ atMs: engine.getElapsedMs(), event });
    log.deaths = view.deaths;
    if (engine.isSimulationFinished()) {
      log.finishedMs = engine.getElapsedMs();
      break;
    }
  }
  return log;
}

/** True when the course's arcs clear every obstacle: the analytic flight of every planned jump never overlaps a hitbox. */
function courseIsClear(course: RunnerCourse): boolean {
  const { speed: v, jumpSpeed: v0, gravity: g } = course.physics;
  for (const ev of course.events) {
    const steps = 200;
    for (let k = 1; k < steps; k++) {
      const s = ((ev.landSec - ev.startSec) * k) / steps;
      const x = v * (ev.startSec + s);
      const y = ev.kind === "drop" ? ev.fromLevel - 0.5 * g * s * s : ev.fromLevel + jumpHeightAt(v0, g, s);
      if (runnerCollides(course, x, y)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ the jump-timing solver */

describe("jump-timing solver", () => {
  const phys = runnerPhysics(DEFAULT_RUNNER_SETTINGS, 300);

  it("derives the take-off speed and the flat flight from the jump height and real, constant gravity", () => {
    expect(phys.gravity).toBe(RUNNER_GRAVITY);
    expect(phys.jumpSpeed).toBeCloseTo(Math.sqrt(2 * RUNNER_GRAVITY * DEFAULT_RUNNER_SETTINGS.jumpHeight), 12);
    expect(phys.flatFlight).toBeCloseTo((2 * phys.jumpSpeed) / RUNNER_GRAVITY, 12);
    // The apex is the jump height, half-way through the flat flight.
    expect(jumpHeightAt(phys.jumpSpeed, phys.gravity, phys.flatFlight / 2)).toBeCloseTo(DEFAULT_RUNNER_SETTINGS.jumpHeight, 9);
    // The Gravity setting scales g (0.5×–2×), so the same jump height flies faster or slower.
    expect(runnerPhysics(DEFAULT_RUNNER_SETTINGS, 600).gravity).toBe(2 * RUNNER_GRAVITY);
    expect(runnerPhysics(DEFAULT_RUNNER_SETTINGS, 0).gravity).toBe(0.5 * RUNNER_GRAVITY);
    expect(runnerPhysics(DEFAULT_RUNNER_SETTINGS, 99999).gravity).toBe(2 * RUNNER_GRAVITY);
    expect(runnerPhysics(DEFAULT_RUNNER_SETTINGS, 600).flatFlight).toBeCloseTo(phys.flatFlight / Math.SQRT2, 12);
  });

  it("solves the flight time of a jump onto a higher, the same or a lower surface as the descending root", () => {
    const { jumpSpeed: v0, gravity: g } = phys;
    for (const rise of [-2, -1, 0, 0.5, 1, 2]) {
      const T = jumpFlightTime(v0, g, rise);
      expect(jumpHeightAt(v0, g, T)).toBeCloseTo(rise, 9);
      // Descending at the landing: the vertical speed v0 − g·T is negative.
      expect(v0 - g * T).toBeLessThan(0);
      if (rise > 0) {
        const up = ascendTime(v0, g, rise);
        expect(up).toBeGreaterThan(0);
        expect(up).toBeLessThan(T);
        expect(jumpHeightAt(v0, g, up)).toBeCloseTo(rise, 9);
      }
    }
    expect(jumpFlightTime(v0, g, 0)).toBeCloseTo(phys.flatFlight, 12);
    expect(jumpFlightTime(v0, g, 1)).toBeLessThan(jumpFlightTime(v0, g, 0));
    expect(jumpFlightTime(v0, g, -1)).toBeGreaterThan(jumpFlightTime(v0, g, 0));
    // Higher than the jump can reach: no solution.
    expect(jumpFlightTime(v0, g, DEFAULT_RUNNER_SETTINGS.jumpHeight + 0.01)).toBeNaN();
    expect(ascendTime(v0, g, 99)).toBeNaN();
  });

  it("times the take-off so that the landing falls exactly on the beat", () => {
    const { jumpSpeed: v0, gravity: g } = phys;
    for (const land of [1.5, 2, 7.25]) {
      for (const rise of [0, 1, 2]) {
        const start = takeOffSec(land, v0, g, rise);
        expect(start + jumpFlightTime(v0, g, rise)).toBeCloseTo(land, 12);
        expect(jumpHeightAt(v0, g, land - start)).toBeCloseTo(rise, 9);
      }
    }
    // Running off an edge: a free fall of the level's height from rest.
    expect(dropTime(g, 2)).toBeCloseTo(Math.sqrt(4 / g), 12);
    expect(0.5 * g * dropTime(g, 1) ** 2).toBeCloseTo(1, 12);
  });

  it("fits as many spikes under the arc as it clears (1–3) at every speed, height and gravity the sliders allow", () => {
    for (const speed of [RUNNER_RANGES.runnerSpeed.min, 9, RUNNER_RANGES.runnerSpeed.max]) {
      for (const jumpHeight of [RUNNER_RANGES.runnerJump.min, 2.6, RUNNER_RANGES.runnerJump.max]) {
        for (const gravity of [0, 300, 2000]) {
          const p = runnerPhysics({ speed, jumpHeight }, gravity);
          const n = runnerMaxSpikes(p);
          expect(n).toBeGreaterThanOrEqual(1);
          expect(n).toBeLessThanOrEqual(3);
          // The arc over n spikes clears their hitboxes (the square's inset box against the spikes' boxes).
          const L = p.speed * p.flatFlight;
          const w = (n - 1) / 2 + SPIKE_HALF_W + 0.5 - CUBE_PAD;
          expect(p.jumpHeight * (1 - ((2 * w) / L) ** 2) + CUBE_PAD).toBeGreaterThan(SPIKE_HIT_H);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ the beat schedule */

describe("beat schedule (the beat clock, inverted)", () => {
  it("places the manual BPM's beats every 60/BPM s from 0", () => {
    const c: BeatClockConfig = { ...DEFAULT_BEAT_CLOCK, source: "bpm", manualBpm: 120 };
    expect(scheduleBpm(c)).toBe(120);
    expect(schedulePeriod(c)).toBe(0.5);
    expect(beatTimesFrom(c, 0, 4)).toEqual([0, 0.5, 1, 1.5]);
    expect(firstBeatAtOrAfter(c, 1.2)).toBe(3);
    expect(firstBeatAtOrAfter(c, 1.5)).toBe(3);
    expect(firstBeatAtOrAfter(c, 1.5 + 1e-12)).toBe(3);
    expect(beatTimeSec(c, 7)).toBe(3.5);
    // A song source without a usable grid follows the BPM.
    expect(beatTimesFrom({ ...c, source: "song", grid: null }, 0, 2)).toEqual([0, 0.5]);
  });

  it("maps a song grid onto the simulation clock with the music bed's offset, looping – and numbers the beats like BeatClock", () => {
    const grid = songGrid(128, 0.37, 12);
    for (const offset of [0, 0.25, 5.1]) {
      for (const loop of [true, false]) {
        const c: BeatClockConfig = { ...DEFAULT_BEAT_CLOCK, source: "song", grid, offset, loop };
        const clock = new BeatClock();
        clock.setConfig(c);
        let prev = -Infinity;
        const first = firstBeatAtOrAfter(c, 0);
        for (let j = first; j < first + 60; j++) {
          const t = beatTimeSec(c, j);
          expect(t).toBeGreaterThanOrEqual(0);
          expect(t).toBeGreaterThan(prev);
          prev = t;
          // BeatClock says beat j starts at exactly that moment (inside the song; past a non-looping song's end the
          // schedule extrapolates at the grid's tempo, where the clock has nothing more to say).
          if (loop || j < grid.beatTimes.length) {
            const sample = clock.sample(t + 1e-9);
            expect(sample.index).toBe(j);
            expect(sample.sinceBeat).toBeLessThan(1e-6);
          }
          expect(firstBeatAtOrAfter(c, t)).toBe(j);
          expect(firstBeatAtOrAfter(c, t - 0.001)).toBe(j);
        }
      }
    }
  });
});

/* ------------------------------------------------------------------ the course */

describe("course builder", () => {
  const course = (rr: Partial<RunnerSettings> = {}, seed = 7, gravity = 300) => buildRunnerCourse({ ...DEFAULT_RUNNER_SETTINGS, ...rr }, gravity, lcg(seed));

  it("lands every obstacle on a beat, takes off at landing − flight time and leaves room to run in between", () => {
    for (const mix of ["mixed", "spikes", "blocks", "gaps"] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const c = course({ mix }, seed);
        const beat = runnerBeatConfig(DEFAULT_RUNNER_SETTINGS);
        const { jumpSpeed: v0, gravity: g, speed: v } = c.physics;
        expect(c.events.length).toBeGreaterThanOrEqual(DEFAULT_RUNNER_SETTINGS.obstacles);
        expect(c.events.length).toBeLessThanOrEqual(DEFAULT_RUNNER_SETTINGS.obstacles + 1);
        let prevLand = 0;
        for (const [i, ev] of c.events.entries()) {
          expect(ev.landSec).toBeCloseTo(beatTimeSec(beat, ev.beat), 12);
          const air = ev.kind === "drop" ? dropTime(g, ev.fromLevel) : jumpFlightTime(v0, g, ev.toLevel - ev.fromLevel);
          expect(ev.landSec - ev.startSec).toBeCloseTo(air, 12);
          expect(ev.startSec).toBeGreaterThanOrEqual((i === 0 ? LEAD_IN_SEC : prevLand + MIN_RUN_SEC) - 1e-9);
          expect(ev.landX).toBeCloseTo(v * ev.landSec, 9);
          expect(ev.section).toBe(Math.floor(i / SECTION_EVENTS));
          prevLand = ev.landSec;
        }
        // Back on the floor at the end, the finish a second's run after the last landing.
        expect(c.events[c.events.length - 1].toLevel).toBe(0);
        expect(c.finishSec).toBeCloseTo(prevLand + 1, 12);
        expect(c.endSec).toBeCloseTo(c.finishSec + FINISH_HOLD_SEC, 12);
        expect(courseIsClear(c), `${mix} seed ${seed}`).toBe(true);
      }
    }
  });

  it("builds the obstacles the mix asks for, where the arcs need them", () => {
    const spikes = course({ mix: "spikes" });
    expect(new Set(spikes.events.map((e) => e.kind))).toEqual(new Set(["spikes"]));
    expect(spikes.blocks).toEqual([]);
    expect(spikes.floors.length).toBe(1);
    for (const ev of spikes.events) {
      // The row is centred under the apex of the jump.
      expect(0.5 * (ev.x0 + ev.x1)).toBeCloseTo(0.5 * spikes.physics.speed * (ev.startSec + ev.landSec), 9);
      expect(ev.x1 - ev.x0).toBeCloseTo(ev.count, 9);
    }
    const gaps = course({ mix: "gaps" });
    expect(gaps.events.every((e) => e.kind === "gap")).toBe(true);
    expect(gaps.floors.length).toBe(gaps.events.length + 1);
    for (const ev of gaps.events) {
      const v = gaps.physics.speed;
      expect(ev.x0).toBeCloseTo(v * ev.startSec + 0.5 + GAP_MARGIN, 9);
      expect(ev.x1).toBeCloseTo(ev.landX - 0.5 - GAP_MARGIN, 9);
    }
    const blocks = course({ mix: "blocks" });
    const kinds = new Set(blocks.events.map((e) => e.kind));
    expect(kinds.has("up") && kinds.has("drop")).toBe(true);
    expect(blocks.blocks.length).toBeGreaterThan(0);
    for (const ev of blocks.events.filter((e) => e.kind === "up")) {
      const { jumpSpeed: v0, gravity: g, speed: v } = blocks.physics;
      const xUp = v * (ev.startSec + ascendTime(v0, g, ev.toLevel - ev.fromLevel));
      expect(ev.x0).toBeGreaterThanOrEqual(xUp + 0.5 + FACE_MARGIN - 1e-9);
      expect(ev.x0).toBeLessThanOrEqual(ev.landX - 0.5 + 1e-9);
    }
    for (const b of blocks.blocks) {
      expect(b.x1).toBeGreaterThan(b.x0);
      expect([1, 2]).toContain(b.top);
    }
    // Blocks never overlap each other; floor pieces neither.
    for (let i = 1; i < blocks.blocks.length; i++) expect(blocks.blocks[i].x0).toBeGreaterThanOrEqual(blocks.blocks[i - 1].x1 - 1e-9);
  });

  it("density 1 takes the earliest beat every time; lower densities leave beats free (from the seed)", () => {
    const dense = course({ density: 1, mix: "spikes" });
    const beat = runnerBeatConfig({ ...DEFAULT_RUNNER_SETTINGS });
    let prev = 0;
    for (const [i, ev] of dense.events.entries()) {
      const earliest = (i === 0 ? LEAD_IN_SEC : prev + MIN_RUN_SEC) + dense.physics.flatFlight;
      expect(ev.beat).toBe(firstBeatAtOrAfter(beat, earliest));
      prev = ev.landSec;
    }
    const sparse = course({ density: 0, mix: "spikes" });
    expect(sparse.finishSec).toBeGreaterThan(dense.finishSec);
  });

  it("is deterministic for a random stream and changes with it", () => {
    expect(course({}, 11)).toEqual(course({}, 11));
    expect(course({}, 11).events.map((e) => e.kind)).not.toEqual(course({}, 12).events.map((e) => e.kind));
  });

  it("follows a loaded song's detected beat, or the BPM", () => {
    const grid = songGrid(100, 0.41, 20);
    const song = course({ grid, offset: 0.3, loop: true });
    const beat = runnerBeatConfig({ ...DEFAULT_RUNNER_SETTINGS, grid, offset: 0.3, loop: true });
    expect(song.song).toBe(true);
    expect(song.bpm).toBe(100);
    for (const ev of song.events) expect(ev.landSec).toBeCloseTo(beatTimeSec(beat, ev.beat), 12);
    expect(courseIsClear(song)).toBe(true);
    // The BPM source ignores the song.
    const bpm = course({ grid, beatSource: "bpm", bpm: 150 });
    expect(bpm.song).toBe(false);
    expect(bpm.bpm).toBe(150);
    for (const ev of bpm.events) expect((ev.landSec / 0.4) % 1).toBeCloseTo(0, 6);
  });

  it("puts a checkpoint after every section, after its last landing, on its level", () => {
    const c = course({ obstacles: 23 });
    expect(c.checkpoints[0]).toEqual({ sec: 0, x: 0, level: 0, event: 0 });
    for (const cp of c.checkpoints.slice(1)) {
      expect(cp.event % SECTION_EVENTS).toBe(0);
      const last = c.events[cp.event - 1];
      expect(cp.sec).toBeGreaterThan(last.landSec);
      expect(cp.sec).toBeLessThan(c.events[cp.event].startSec);
      expect(cp.level).toBe(last.toLevel);
    }
  });

  it("the landing notes climb a contour lifted by the level, in the Sound section's scale", () => {
    expect([0, 1, 2, 3].map((k) => runnerDegree(k, 0))).toEqual([0, 2, 4, 7]);
    expect(runnerDegree(16, 0)).toBe(runnerDegree(0, 0));
    expect(runnerDegree(0, 2)).toBe(4);
    expect(rhythmDegreeMidi(0, "chromatic", 0)).toBe(60);
    expect(rhythmDegreeMidi(7, "chromatic", 0)).toBe(72);
    expect(rhythmDegreeMidi(-7, "major", 2)).toBe(50);
    expect(rhythmDegreeMidi(3, "pentatonic", 0)).toBe(67);
  });
});

/* ------------------------------------------------------------------ the engine */

describe("RunnerMode in the engine", () => {
  it("auto jump: lands every jump on the beat, never crashes, plays a note per landing and finishes when planned", () => {
    for (const [rr, seed] of [
      [{}, 1],
      [{ mix: "blocks" }, 2],
      [{ mix: "gaps", speed: 14 }, 3],
      [{ obstacles: 40, density: 1, jumpHeight: 4 }, 4],
      [{ bpm: 180, beatSource: "bpm" }, 5],
    ] as [Partial<RunnerSettings>, number][]) {
      const engine = engineFor(rr, seed);
      const course = engine.getRunnerView().course;
      const planned = engine.getRunnerProgress().plannedMs;
      const log = runToEnd(engine);
      expect(log.deaths).toBe(0);
      expect(log.landings.length).toBe(course.events.length);
      for (const [i, landing] of log.landings.entries()) {
        expect(landing.event).toBe(i);
        expect(Math.abs(landing.atSec - course.events[i].landSec)).toBeLessThan(1e-9);
      }
      const view = engine.getRunnerView();
      expect(view.onBeat).toBe(view.landings);
      expect(view.cleared).toBe(course.events.length);
      expect(view.jumps).toBe(course.events.filter((e) => e.kind !== "drop").length);
      const notes = log.sounds.filter((s) => s.event.type === "hit" && !s.event.chord && s.event.level === undefined);
      expect(notes.length).toBe(course.events.length);
      expect(log.sounds.some((s) => s.event.chord && s.event.accent)).toBe(true);
      expect(log.finishedMs).toBeCloseTo(planned, 6);
    }
  });

  it("runs on past the finish line (behind the end screen) without crashing or sounding", () => {
    const engine = engineFor({ obstacles: 4 }, 2);
    runToEnd(engine);
    const view = engine.getRunnerView();
    expect(view.finished).toBe(true);
    const x = view.x;
    for (let i = 0; i < 60 * 30; i++) engine.update(STEP, 0);
    expect(engine.consumeSoundEvents()).toEqual([]);
    expect(view.alive).toBe(true);
    expect(view.deaths).toBe(0);
    expect(view.x).toBeCloseTo(x + 30 * view.course.physics.speed, 6);
  });

  it("each landing sounds in the step of its beat, with the scale degree of its event", () => {
    const engine = engineFor({}, 9, { gravity: 300 });
    engine.setRunnerSettings({ scale: "minor", rootNote: 3 });
    const course = engine.getRunnerView().course;
    const log = runToEnd(engine);
    const notes = log.sounds.filter((s) => s.event.type === "hit" && !s.event.chord && s.event.level === undefined);
    for (const [i, note] of notes.entries()) {
      expect(note.atMs / 1000).toBeGreaterThanOrEqual(course.events[i].landSec - 1e-9);
      expect(note.atMs / 1000 - course.events[i].landSec).toBeLessThan(STEP / 1000 + 1e-9);
      expect(Math.round(frequencyToMidi(note.event.frequency!))).toBe(rhythmDegreeMidi(course.events[i].degree, "minor", 3));
    }
  });

  it("follows a song grid in the engine: the landings are the song's beats on the simulation clock", () => {
    const grid = songGrid(110, 0.52, 30, 0.015);
    const engine = engineFor({ grid, offset: 1.2, loop: true }, 21);
    const view = engine.getRunnerView();
    expect(view.course.song).toBe(true);
    runToEnd(engine);
    expect(view.deaths).toBe(0);
    expect(view.onBeat).toBe(view.landings);
    const c: BeatClockConfig = { ...DEFAULT_BEAT_CLOCK, source: "song", grid, offset: 1.2, loop: true };
    for (const ev of view.course.events) expect(ev.landSec).toBeCloseTo(beatTimeSec(c, ev.beat), 12);
  });

  it("replays exactly for a seed, whatever the canvas size – and keeps a run across a resize", () => {
    const trace = (engine: ReturnType<typeof engineFor>) => {
      const out: number[] = [];
      for (let i = 0; i < 900; i++) {
        engine.update(STEP, 0);
        const v = engine.getRunnerView();
        out.push(Math.round(v.x * 1e6), Math.round(v.y * 1e6), v.landings);
      }
      return out;
    };
    expect(trace(engineFor({}, 5))).toEqual(trace(engineFor({}, 5)));
    expect(trace(engineFor({}, 5, { width: 1080, height: 1920 }))).toEqual(trace(engineFor({}, 5)));
    expect(trace(engineFor({}, 5))).not.toEqual(trace(engineFor({}, 6)));
    const a = engineFor({}, 5);
    const b = engineFor({}, 5);
    for (let i = 0; i < 300; i++) {
      a.update(STEP, 0);
      b.update(STEP, 0);
    }
    b.setConfig({ width: 1280, height: 720 });
    for (let i = 0; i < 300; i++) {
      a.update(STEP, 0);
      b.update(STEP, 0);
    }
    expect(b.getRunnerView().x).toBe(a.getRunnerView().x);
    expect(b.getRunnerView().landings).toBe(a.getRunnerView().landings);
    // The engine ball sits on the square in the new field's pixels.
    const f = buildRunnerField(1280, 720);
    const ball = b.getBalls()[0];
    expect(ball.x).toBeCloseTo(f.left + b.getRunnerView().x * f.unit, 6);
    expect(ball.radius).toBeCloseTo(0.5 * f.unit, 9);
  });

  it("played by hand: no jump crashes into the first obstacle, and the section restarts at its checkpoint a whole number of beats later", () => {
    for (const mix of ["spikes", "gaps", "blocks"] as const) {
      const engine = engineFor({ autoJump: false, mix }, 3);
      const view = engine.getRunnerView();
      const first = view.course.events[0];
      let deathAt = -1;
      for (let i = 0; i < 60 * 12; i++) {
        engine.update(STEP, 0);
        if (view.deaths === 1 && deathAt < 0) {
          deathAt = view.deathSec;
          // Back at the start after at least RESPAWN_SEC, on a beat of the course (whole beats of 0.5 s).
          expect(view.respawnSec - deathAt).toBeGreaterThanOrEqual(RESPAWN_SEC - 1e-9);
          expect(((view.respawnSec - view.course.checkpoints[0].sec) / view.course.period) % 1).toBeCloseTo(0, 9);
        }
        expect(view.x).toBeLessThan(first.landX);
      }
      expect(view.deaths).toBeGreaterThanOrEqual(2);
      expect(view.attempt).toBeGreaterThanOrEqual(view.deaths);
      expect(view.cleared).toBe(0);
      expect(engine.isSimulationFinished()).toBe(false);
    }
  });

  it("played by hand: Space at the planned take-offs (to the engine's step) clears the course; auto jump ignores Space", () => {
    const engine = engineFor({ autoJump: false }, 8);
    const course = engine.getRunnerView().course;
    const starts = course.events.filter((e) => e.kind !== "drop").map((e) => e.startSec);
    let next = 0;
    const log = runToEnd(engine, 120_000, (elapsedMs) => {
      while (next < starts.length && starts[next] * 1000 <= elapsedMs + STEP) {
        if (starts[next] * 1000 > elapsedMs) engine.runnerJump();
        next++;
      }
    });
    expect(log.deaths).toBe(0);
    expect(engine.getRunnerView().cleared).toBe(course.events.length);
    expect(engine.getRunnerView().finished).toBe(true);
    // Auto jump: a Space press changes nothing.
    const auto = engineFor({}, 8);
    const plain = engineFor({}, 8);
    for (let i = 0; i < 400; i++) {
      if (i % 7 === 0) auto.runnerJump();
      auto.update(STEP, 0);
      plain.update(STEP, 0);
    }
    expect(auto.getRunnerView().x).toBe(plain.getRunnerView().x);
    expect(auto.getRunnerView().y).toBe(plain.getRunnerView().y);
  });
});

/* ------------------------------------------------------------------ settings, registration and the finder */

describe("Beat Runner settings", () => {
  it("are registered as a rhythm-family mode with a card", () => {
    expect(MODE_IDS).toContain("runner");
    expect(MODE_CATEGORIES.runner).toBe("rhythm");
    expect(MODE_CARD_ORDER).toContain("runner");
    expect(modesInCategory("rhythm")).toContain("runner");
    expect(isJdmRhythmMode("runner")).toBe(true);
    expect(isJdmRhythmMode("classic")).toBe(false);
  });

  it("default in every mode, stay out of the URL and are part of RANGES", () => {
    expect(defaultRunnerFields()).toEqual({ runnerAutoJump: true, runnerObstacles: 24, runnerSpeed: 9, runnerJump: 2.6, runnerDensity: 0.6, runnerMix: "mixed", runnerBeatSource: "song" });
    for (const key of Object.keys(RUNNER_RANGES) as (keyof typeof RUNNER_RANGES)[]) expect(RANGES[key]).toEqual(RUNNER_RANGES[key]);
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(resolveRunnerFields(d)).toEqual(defaultRunnerFields());
      const params = settingsToSearchParams(d);
      for (const key of ["rra", "rrn", "rrsp", "rrj", "rrd", "rrm", "rrbs"]) expect(params.has(key)).toBe(false);
    }
  });

  it("round-trip through the URL and presets; bad values fall back or are clamped", () => {
    const s = { ...defaultSettings("runner"), runnerAutoJump: false, runnerObstacles: 60, runnerSpeed: 12.5, runnerJump: 3.3, runnerDensity: 0.35, runnerMix: "blocks" as const, runnerBeatSource: "bpm" as const };
    const params = settingsToSearchParams(s);
    expect(params.get("rra")).toBe("0");
    expect(params.get("rrn")).toBe("60");
    expect(params.get("rrsp")).toBe("12.5");
    expect(params.get("rrj")).toBe("3.3");
    expect(params.get("rrd")).toBe("0.35");
    expect(params.get("rrm")).toBe("blocks");
    expect(params.get("rrbs")).toBe("bpm");
    const back = settingsFromSearchParams(params);
    expect(resolveRunnerFields(back)).toEqual(resolveRunnerFields(s));
    const junk = settingsFromSearchParams(new URLSearchParams("mode=runner&rra=yes&rrn=9999&rrsp=-4&rrj=abc&rrd=0.333&rrm=lava&rrbs=radio"));
    expect(resolveRunnerFields(junk)).toEqual({ ...defaultRunnerFields(), runnerObstacles: 120, runnerSpeed: 6, runnerDensity: 0.35 });
    const preset = presetToSettings({ mode: "runner", runnerObstacles: 2, runnerMix: "nope" as never, runnerAutoJump: "no" as never, runnerJump: 3.14159 });
    expect(resolveRunnerFields(preset)).toEqual({ ...defaultRunnerFields(), runnerObstacles: 4, runnerJump: 3.1 });
    expect(resolveRunnerSettings({ grid: { bpm: 0, beatTimes: [], duration: 0 } }).grid).toBeNull();
  });

  it("carry the Sound section's BPM, scale and root and the song's grid into the mode's settings", () => {
    const s = { ...defaultSettings("runner"), bpm: 140, scale: "blues" as const, rootNote: 5 };
    const grid = songGrid();
    expect(runnerSettingsOf(s, { grid, offset: 2, loop: false })).toMatchObject({ bpm: 140, scale: "blues", rootNote: 5, grid, offset: 2, loop: false, autoJump: true });
    expect(runnerSettingsOf(s).grid).toBeNull();
  });
});

describe("Beat Runner and the finder", () => {
  it("reads an auto run's length off the plan (the same step the engine finishes on); a run played by hand has no length", () => {
    const request: FinderRequest = { targetDurationSec: 35, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 120, physicsConfig: config, mode: "runner", modeSettings: { ...modeSettings, runner: {} } };
    for (const seed of [3, 4, 5]) {
      const planned = simulateSeed(seed, request, 120_000);
      const log = runToEnd(engineFor({}, seed));
      expect(planned).toBeCloseTo(log.finishedMs, 6);
    }
    expect(runNeverFinishes("runner", { drop: {}, box: {}, runner: {} })).toBe(false);
    expect(runNeverFinishes("runner", { drop: {}, box: {}, runner: { autoJump: false } })).toBe(true);
  });

  it("finds a seed for a run length and says so when the run is played by hand", async () => {
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
    try {
      const base = { toleranceSec: 0.5, maxSeeds: 400, maxSimTimeSec: 90, physicsConfig: config, mode: "runner" as const };
      const found = await findSimulation({ ...base, targetDurationSec: 34, modeSettings: { ...modeSettings, runner: {} } }, () => {});
      expect(found.found).toBe(true);
      expect(Math.abs(found.duration - 34)).toBeLessThanOrEqual(0.5);
      const log = runToEnd(engineFor({}, found.seed));
      expect(log.finishedMs / 1000).toBeCloseTo(found.duration, 6);
      const manual = await findSimulation({ ...base, targetDurationSec: 34, modeSettings: { ...modeSettings, runner: { autoJump: false } } }, () => {});
      expect(manual).toMatchObject({ found: false, endless: true, seedsTested: 0 });
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
