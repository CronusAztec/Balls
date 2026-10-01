import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOURNEY_STAGE_CEILING } from "@/lib/uncap"; // --- uncap-all ---
import {
  DEFAULT_JOURNEY_STAGES,
  JOURNEY_TRAVEL_KINDS,
  MAX_JOURNEY_STAGES,
  addJourneyStage,
  formatJourneyStages,
  generateJourneyStages,
  moveJourneyStage,
  parseJourneyStages,
  parseJourneyToken,
  removeJourneyStage,
  resizeJourneyStage,
  sanitizeJourneyStages,
} from "@/lib/physics/journey/sequence";
import { STAGE_COLORS, STAGE_HEIGHTS, stagePitch } from "@/lib/physics/journey/stage";
import { createStage, stageRandom } from "@/lib/physics/journey/stages";
import { MIN_RING_SPACING_RADII, RING_COUNTS, RingsStage } from "@/lib/physics/journey/rings";
import { BULLSEYE_BANDS, BULLSEYE_MISS, bullseyeScore } from "@/lib/physics/journey/bullseye";
import { GLASS_PANES } from "@/lib/physics/journey/glass";
import { GatesStage } from "@/lib/physics/journey/gates";
import { PegsStage } from "@/lib/physics/journey/pegs";
import {
  DEFAULT_JOURNEY_SETTINGS,
  JOURNEY_RANGES,
  JourneyMode,
  journeyGravity,
  journeySettingsOf,
  journeyStagesOf,
  resolveJourneyFields,
  resolveJourneySettings,
  type JourneySettings,
} from "@/lib/physics/modes/journey";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, MODE_CATEGORY_IDS, modesInCategory } from "@/lib/modes";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { SWOOSH_TONE, scheduleSwooshTone } from "@/lib/audio/swooshTone";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * Journey (feature gerald-journey): the stage list (parsing, the compact text form, the panel's edits), the seeded auto
 * sequence, the settings / URL / presets, the stage adapters, the run through the stages in order (the floating origin,
 * the banners and swooshes, the camera, HOME), determinism and resizes, the finder and the swoosh.
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
  gapSize: 0.3,
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

function journeyEngine(settings: Partial<JourneySettings>, seed: number, size: Partial<PhysicsConfig> = {}) {
  const engine = new PhysicsEngine({ ...config, ...size });
  engine.setJourneySettings(settings);
  engine.setSeed(seed);
  engine.initMode("journey");
  return engine;
}

interface RunLog {
  finishedAt: number;
  kinds: string[];
  events: SoundEvent[];
  /** Every stage entry: its index, the stage's centre y and the canvas centre y right after the entry. */
  entries: { index: number; centre: number; canvasCentre: number }[];
  /** Largest distance of the ball outside the visible field (px) seen at a step's end. */
  outOfView: number;
}

function run(engine: PhysicsEngine, maxSec = 90): RunLog {
  const log: RunLog = { finishedAt: -1, kinds: [], events: [], entries: [], outOfView: 0 };
  const view = engine.getJourneyView();
  let active = -1;
  for (let i = 0; i < maxSec * 60; i++) {
    engine.update(1000 / 60, 0);
    log.events.push(...engine.consumeSoundEvents());
    if (view.active !== active) {
      active = view.active;
      const stage = view.stages[active];
      log.kinds.push(stage.kind);
      log.entries.push({ index: active, centre: (stage.bounds.top + stage.bounds.bottom) / 2, canvasCentre: engine.config.height / 2 });
    }
    const ball = engine.getBalls()[0];
    const f = view.field!;
    const sy = ball.y - view.cameraY;
    log.outOfView = Math.max(log.outOfView, f.top - (sy - ball.radius), sy + ball.radius - f.bottom);
    if (engine.isSimulationFinished()) {
      log.finishedAt = (i + 1) / 60;
      break;
    }
  }
  return log;
}

/* ------------------------------------------------------------------ the stage list */

describe("the stage list", () => {
  it("parses the compact text form: kinds in order, sizes as suffixes, HOME always last", () => {
    expect(parseJourneyStages("rings,pegs-l,glass-s,multipliers,home")).toEqual([
      { kind: "rings", size: "m" },
      { kind: "pegs", size: "l" },
      { kind: "glass", size: "s" },
      { kind: "multipliers", size: "m" },
      { kind: "home", size: "m" },
    ]);
    // Unknown tokens are skipped, whitespace / case / other separators tolerated, HOME appended when missing.
    expect(formatJourneyStages(parseJourneyStages(" Rings ; bogus | FUNNEL-L  bullseye-x"))).toBe("rings,funnel-l,bullseye,home");
    // A HOME that is not last is dropped; the last one keeps its size.
    expect(sanitizeJourneyStages("home,rings,home-l")).toBe("rings,home-l");
    expect(sanitizeJourneyStages("home-s,rings")).toBe("rings,home");
    expect(sanitizeJourneyStages("")).toBe("home");
    expect(sanitizeJourneyStages(42)).toBe("home");
    expect(parseJourneyToken("glass-small")).toEqual({ kind: "glass", size: "s" });
    expect(parseJourneyToken("glass-large")).toEqual({ kind: "glass", size: "l" });
    expect(parseJourneyToken("nope")).toBeNull();
  });

  it("round-trips and caps the list at MAX_JOURNEY_STAGES before HOME", () => {
    expect(sanitizeJourneyStages(DEFAULT_JOURNEY_STAGES)).toBe(DEFAULT_JOURNEY_STAGES);
    const long = Array.from({ length: JOURNEY_STAGE_CEILING + 30 }, (_, i) => JOURNEY_TRAVEL_KINDS[i % JOURNEY_TRAVEL_KINDS.length]).join(","); // --- uncap-all --- the list stops at its memory-safety ceiling
    const stages = parseJourneyStages(long);
    expect(stages).toHaveLength(JOURNEY_STAGE_CEILING + 1);
    expect(parseJourneyStages(Array(MAX_JOURNEY_STAGES + 18).fill("pegs").join(","))).toHaveLength(MAX_JOURNEY_STAGES + 19); // past the panel's MAX_JOURNEY_STAGES
    expect(stages[stages.length - 1].kind).toBe("home");
    expect(sanitizeJourneyStages(formatJourneyStages(stages))).toBe(formatJourneyStages(stages));
  });

  it("the panel's edits: move with the arrows, remove, add before HOME, resize – HOME never moves or goes", () => {
    const text = "rings,pegs,glass,home";
    expect(moveJourneyStage(text, 1, -1)).toBe("pegs,rings,glass,home");
    expect(moveJourneyStage(text, 1, 1)).toBe("rings,glass,pegs,home");
    expect(moveJourneyStage(text, 2, 1)).toBe(text); // not past HOME
    expect(moveJourneyStage(text, 3, -1)).toBe(text); // HOME stays
    expect(moveJourneyStage(text, 0, -1)).toBe(text);
    expect(removeJourneyStage(text, 0)).toBe("pegs,glass,home");
    expect(removeJourneyStage(text, 3)).toBe(text);
    expect(addJourneyStage(text, "bullseye")).toBe("rings,pegs,glass,bullseye,home");
    expect(addJourneyStage(text, "home")).toBe(text);
    expect(resizeJourneyStage(text, 2, "l")).toBe("rings,pegs,glass-l,home");
    expect(resizeJourneyStage(text, 3, "s")).toBe("rings,pegs,glass,home-s");
    const full = parseJourneyStages(Array(JOURNEY_STAGE_CEILING).fill("pegs").join(",")); // --- uncap-all ---
    expect(addJourneyStage(formatJourneyStages(full), "rings")).toBe(formatJourneyStages(full));
  });
});

/* ------------------------------------------------------------------ the auto sequence */

describe("the seeded auto sequence", () => {
  it("is the same for the same generator state, draws two numbers a stage and never repeats a kind back to back", () => {
    for (const seed of [1, 2, 99, 12345]) {
      const a = generateJourneyStages(8, stageRandom(seed));
      const b = generateJourneyStages(8, stageRandom(seed));
      expect(a).toEqual(b);
      expect(a).toHaveLength(9);
      expect(a[8]).toEqual({ kind: "home", size: "m" });
      for (let i = 1; i < 8; i++) expect(a[i].kind).not.toBe(a[i - 1].kind);
      for (const s of a.slice(0, 8)) expect(JOURNEY_TRAVEL_KINDS).toContain(s.kind);
      let draws = 0;
      const rnd = stageRandom(seed);
      generateJourneyStages(8, () => {
        draws++;
        return rnd();
      });
      expect(draws).toBe(16);
    }
    const seqs = new Set([1, 2, 3, 4, 5, 6].map((seed) => formatJourneyStages(generateJourneyStages(6, stageRandom(seed)))));
    expect(seqs.size).toBeGreaterThan(4);
    // Every kind and every size turns up over many draws.
    const seen = new Set<string>();
    const rnd = stageRandom(7);
    for (let i = 0; i < 40; i++) for (const s of generateJourneyStages(12, rnd)) seen.add(`${s.kind}-${s.size}`);
    for (const kind of JOURNEY_TRAVEL_KINDS) for (const size of ["s", "m", "l"]) expect(seen.has(`${kind}-${size}`)).toBe(true);
    expect(generateJourneyStages(0, stageRandom(1))).toHaveLength(2);
    expect(generateJourneyStages(99, stageRandom(1))).toHaveLength(100); // --- uncap-all --- past MAX_JOURNEY_STAGES, up to its memory-safety ceiling
    expect(generateJourneyStages(1e9, stageRandom(1))).toHaveLength(JOURNEY_STAGE_CEILING + 1);
  });

  it("an auto journey comes from the engine's seed: the same seed plays the same route, other seeds other routes", () => {
    const routes = new Set<string>();
    for (const seed of [11, 12, 13, 14, 15]) {
      const a = journeyEngine({ auto: 6 }, seed).getJourneyView().sequence;
      const b = journeyEngine({ auto: 6 }, seed).getJourneyView().sequence;
      expect(a).toBe(b);
      expect(parseJourneyStages(a)).toHaveLength(7);
      routes.add(a);
    }
    expect(routes.size).toBeGreaterThan(3);
    // The list setting is ignored while the auto count is on.
    expect(journeyEngine({ auto: 3, stages: "glass,home" }, 5).getJourneyView().stages).toHaveLength(4);
    expect(journeyStagesOf({ auto: 3 })).toBeNull();
    expect(journeyStagesOf({ stages: "pegs" })).toEqual([
      { kind: "pegs", size: "m" },
      { kind: "home", size: "m" },
    ]);
  });
});

/* ------------------------------------------------------------------ settings */

describe("settings, URL and presets", () => {
  it("defaults, ranges and resolution", () => {
    const d = defaultSettings("journey");
    expect(d.journeyStages).toBe(DEFAULT_JOURNEY_STAGES);
    expect(d.journeyAutoStages).toBe(0);
    expect(defaultSettings("classic").journeyStages).toBe(DEFAULT_JOURNEY_STAGES);
    expect(RANGES.journeyAutoStages).toEqual(JOURNEY_RANGES.journeyAutoStages);
    expect(resolveJourneySettings(undefined)).toEqual(DEFAULT_JOURNEY_SETTINGS);
    expect(resolveJourneySettings({ stages: "glass,rings", auto: 99 })).toEqual({ stages: "glass,rings,home", auto: 99 }); // --- uncap-all --- (no maximum)
    expect(resolveJourneySettings({ auto: -3 }).auto).toBe(0);
    expect(resolveJourneySettings({ auto: Number.NaN }).auto).toBe(0);
    expect(resolveJourneyFields({ journeyStages: "x", journeyAutoStages: 2.6 })).toEqual({ journeyStages: "home", journeyAutoStages: 3 });
    expect(journeySettingsOf(d)).toEqual(DEFAULT_JOURNEY_SETTINGS);
  });

  it("travels in the URL as js / jsa and only when changed, normalised on the way back in", () => {
    const s = { ...defaultSettings("journey"), journeyStages: "funnel-l,bullseye,rings-s,home", journeyAutoStages: 0 };
    const params = settingsToSearchParams(s);
    expect(params.get("js")).toBe("funnel-l,bullseye,rings-s,home");
    expect(params.has("jsa")).toBe(false);
    const back = settingsFromSearchParams(params);
    expect(back.mode).toBe("journey");
    expect(back.journeyStages).toBe("funnel-l,bullseye,rings-s,home");
    expect(settingsToSearchParams(defaultSettings("journey")).has("js")).toBe(false);
    const auto = settingsFromSearchParams(new URLSearchParams("mode=journey&jsa=7&js=home,pegs-l,nonsense"));
    expect(auto.journeyAutoStages).toBe(7);
    expect(auto.journeyStages).toBe("pegs-l,home");
    expect(settingsToSearchParams(auto).get("jsa")).toBe("7");
    expect(settingsFromSearchParams(new URLSearchParams("mode=journey&jsa=500")).journeyAutoStages).toBe(500); // --- uncap-all --- (kept)
    expect(settingsFromSearchParams(new URLSearchParams("mode=journey&jsa=abc")).journeyAutoStages).toBe(0);
  });

  it("presets are validated like the URL", () => {
    const loaded = presetToSettings({ mode: "journey", journeyStages: "GLASS-L ; pegs", journeyAutoStages: 4.4 } as never);
    expect(loaded.journeyStages).toBe("glass-l,pegs,home");
    expect(loaded.journeyAutoStages).toBe(4);
    const bad = presetToSettings({ mode: "journey", journeyStages: 7, journeyAutoStages: "x" } as never);
    expect(bad.journeyStages).toBe(DEFAULT_JOURNEY_STAGES);
    expect(bad.journeyAutoStages).toBe(0);
  });

  it("is registered as a mode of its own family, with translations in every language", () => {
    expect(MODE_IDS).toContain("journey");
    expect(MODE_CATEGORY_IDS).toContain("journey");
    expect(MODE_CATEGORIES.journey).toBe("journey");
    expect(MODE_CARD_ORDER).toContain("journey");
    expect(modesInCategory("journey")).toEqual(["journey"]);
    for (const m of [en, pl, es]) {
      expect(m.Modes.journey.name.length).toBeGreaterThan(0);
      expect(m.Modes.journey.description.length).toBeGreaterThan(20);
      expect(m.Headings.modesJourney.length).toBeGreaterThan(0);
      expect(m.Controls.modeJourney.length).toBeGreaterThan(0);
      expect(m.Editorial.modeJourney.length).toBeGreaterThan(50);
      expect(m.Journey.canvasBanner).toContain("[n]");
      expect(m.Journey.canvasBanner).toContain("[total]");
      expect(m.Journey.canvasBanner).toContain("[name]");
      for (const kind of Object.keys(STAGE_COLORS)) expect((m.Journey as Record<string, string>)[`stage_${kind}`]).toBeTruthy();
    }
  });
});

/* ------------------------------------------------------------------ the stages */

const BOUNDS = (kind: keyof typeof STAGE_HEIGHTS, size: "s" | "m" | "l", top = 100) => {
  const viewH = 560;
  const h = STAGE_HEIGHTS[kind][size] * viewH;
  return { left: 226, right: 574, top, bottom: top + h, cx: 400, width: 348, height: h, viewH };
};

describe("the stage adapters", () => {
  it("lay out inside their band from their own generator, the same numbers giving the same stage", () => {
    for (const kind of Object.keys(STAGE_HEIGHTS) as (keyof typeof STAGE_HEIGHTS)[]) {
      for (const size of ["s", "m", "l"] as const) {
        const a = createStage({ kind, size }, 2);
        const b = createStage({ kind, size }, 2);
        a.init(BOUNDS(kind, size), stageRandom(77), 8);
        b.init(BOUNDS(kind, size), stageRandom(77), 8);
        expect(a.kind).toBe(kind);
        expect(a.obstacles.map((o) => [o.x, o.y])).toEqual(b.obstacles.map((o) => [o.x, o.y]));
        // Everything inside the stage's reach: the column, or a rings chamber that bulges out of it (never past the square).
        expect(a.reach).toBeGreaterThanOrEqual(a.bounds.width / 2);
        expect(a.reach).toBeLessThanOrEqual(0.42 * a.bounds.viewH);
        expect(a.ownWalls).toBe(a.reach > a.bounds.width / 2);
        for (const o of a.obstacles) {
          expect(o.x).toBeGreaterThanOrEqual(a.bounds.cx - a.reach - 1);
          expect(o.x).toBeLessThanOrEqual(a.bounds.cx + a.reach + 1);
          expect(o.y).toBeGreaterThanOrEqual(a.bounds.top);
          expect(o.y).toBeLessThanOrEqual(a.bounds.bottom);
        }
        expect(a.maxBallRadius()).toBeGreaterThan(8);
      }
    }
  });

  it("rings: 3–9 of them by size, the ball fits between them, a gap never narrower than the ball needs", () => {
    for (const size of ["s", "m", "l"] as const) {
      for (let seed = 1; seed <= 20; seed++) {
        const stage = createStage({ kind: "rings", size }, 0) as RingsStage;
        stage.init(BOUNDS("rings", size), stageRandom(seed), 8);
        const [lo, hi] = RING_COUNTS[size];
        expect(stage.radii.length).toBeGreaterThanOrEqual(lo);
        expect(stage.radii.length).toBeLessThanOrEqual(hi);
        for (let i = 1; i < stage.radii.length; i++) expect(stage.radii[i] - stage.radii[i - 1]).toBeGreaterThanOrEqual(Math.max(2 * 8 + 4, MIN_RING_SPACING_RADII * 8 + 3) - 1e-9);
        expect(stage.radii[stage.radii.length - 1]).toBeLessThanOrEqual(stage.reach - 0.01 * stage.bounds.viewH);
        expect(stage.radii[stage.radii.length - 1]).toBeLessThanOrEqual(stage.bounds.height / 2);
        // A chamber wider than the column brings its own walls: straight beside the rings, sloping back to the column.
        if (stage.ownWalls) {
          expect(stage.obstacles).toHaveLength(6);
          for (const o of stage.obstacles) {
            // The chamber's walls never cut into the outermost ring.
            if (o.kind !== "segment") continue;
            const ux = Math.cos(o.angle);
            const uy = Math.sin(o.angle);
            const t = Math.max(-o.halfLength, Math.min(o.halfLength, (stage.cx - o.x) * ux + (stage.cy - o.y) * uy));
            expect(Math.hypot(o.x + t * ux - stage.cx, o.y + t * uy - stage.cy)).toBeGreaterThan(stage.radii[stage.radii.length - 1] + 8);
          }
        } else expect(stage.obstacles).toHaveLength(0);
        for (let i = 0; i < stage.radii.length; i++) expect(stage.gapWidth(i, 8, 0.05)).toBeGreaterThanOrEqual(3.2 * Math.atan2(8, stage.radii[i]) - 1e-12);
      }
    }
    // A small canvas gets fewer rings rather than rings the ball cannot pass between.
    const tiny = createStage({ kind: "rings", size: "l" }, 0) as RingsStage;
    tiny.init({ left: 0, right: 120, top: 0, bottom: 150, cx: 60, width: 120, height: 150, viewH: 190 }, stageRandom(3), 8);
    expect(tiny.radii.length).toBeLessThan(7);
  });

  it("pegs: Ball Drop's board mapped into the band, bars tilted toward the middle, a rising note per row", () => {
    const stage = createStage({ kind: "pegs", size: "l" }, 1) as PegsStage;
    stage.init(BOUNDS("pegs", "l"), stageRandom(5), 8);
    expect(stage.rows).toBe(9);
    const bars = stage.obstacles.filter((o) => o.kind === "segment");
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      if (bar.kind !== "segment") continue;
      const off = bar.x - stage.bounds.cx;
      if (Math.abs(off) >= 0.05 * stage.bounds.width) expect(Math.sign(bar.angle)).toBe(off < 0 ? 1 : -1);
    }
    const pitches = stage.obstacles.map((o) => stage.onObstacleHit({ env: null as never, ball: null as never, obstacle: o, impact: 100 })?.frequency ?? 0);
    const top = stage.obstacles.reduce((a, o) => (o.y < a.y ? o : a));
    const bottom = stage.obstacles.reduce((a, o) => (o.y > a.y ? o : a));
    expect(pitches.every((f) => f > 200)).toBe(true);
    expect(stagePitch(8 + 1)).toBeGreaterThan(stagePitch(0 + 1));
    expect(stage.onObstacleHit({ env: null as never, ball: null as never, obstacle: bottom, impact: 100 })!.frequency!).toBeGreaterThan(stage.onObstacleHit({ env: null as never, ball: null as never, obstacle: top, impact: 100 })!.frequency!);
  });

  it("the bullseye scores by the distance from the centre", () => {
    expect(bullseyeScore(0, 300)).toBe(100);
    expect(bullseyeScore(BULLSEYE_BANDS[0][0] * 300 + 1, 300)).toBe(50);
    expect(bullseyeScore(-(BULLSEYE_BANDS[1][0] * 300 + 1), 300)).toBe(25);
    expect(bullseyeScore(299, 300)).toBe(BULLSEYE_MISS);
  });
});

/* ------------------------------------------------------------------ the journey in the engine */

describe("the journey in the engine", () => {
  it("clears the stages in order – a banner and a swoosh at every transition, the active stage centred – and finishes at HOME", () => {
    const route = "rings,pegs,glass,multipliers,funnel,bullseye,home";
    for (const seed of [1, 2, 3]) {
      const engine = journeyEngine({ stages: route }, seed);
      const view = engine.getJourneyView();
      expect(view.sequence).toBe(route);
      const log = run(engine);
      expect(log.finishedAt).toBeGreaterThan(5);
      expect(log.kinds.join(",")).toBe(route);
      // One swoosh per transition (not for the first stage), each a "hit" that is not a note of the tune.
      const swooshes = log.events.filter((e) => e.swoosh);
      expect(swooshes).toHaveLength(6);
      expect(view.swooshes).toBe(6);
      for (const s of swooshes) expect(s.melody).toBe(false);
      // The floating origin: every stage is centred on the canvas when the ball enters it.
      for (const e of log.entries) expect(Math.abs(e.centre - e.canvasCentre)).toBeLessThan(1e-6);
      // The camera never lets the ball out of the field.
      expect(log.outOfView).toBeLessThanOrEqual(0.5);
      // HOME: the chord, the total time, the score of the bullseye.
      expect(view.homeReached).toBe(true);
      expect(view.finished).toBe(true);
      expect(view.homeAtMs / 1000).toBeLessThan(log.finishedAt);
      expect(view.homeAtMs / 1000).toBeGreaterThan(log.finishedAt - 2.5);
      expect(log.events.some((e) => e.chord && e.chord.length === 4 && e.accent)).toBe(true);
      expect([10, 25, 50, 100]).toContain(view.score);
      expect(view.progress).toBeGreaterThan(0.9);
      expect(view.nudges).toBe(0);
      // The rings were the engine's own walls while live; they are gone once the ball is out.
      expect(engine.getCircularWalls()).toHaveLength(0);
      // Ring bounces and breaks are the engine's (wall tones, gap passes), glass shatters and ring breaks both "gap".
      expect(log.events.filter((e) => e.type === "gap").length).toBeGreaterThanOrEqual(3 + 3);
      expect(log.events.filter((e) => e.type === "hit" && e.frequency === undefined && !e.swoosh).length).toBeGreaterThan(0);
    }
  });

  it("a rings stage uses the engine's rings while it is the active stage, centred on the canvas", () => {
    const engine = journeyEngine({ stages: "pegs-s,rings,home" }, 4);
    const view = engine.getJourneyView();
    expect(engine.getCircularWalls()).toHaveLength(0);
    let sawRings = false;
    for (let i = 0; i < 60 * 60 && !engine.isSimulationFinished(); i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      const stage = view.stages[view.active];
      if (stage instanceof RingsStage && stage.phase === "inside") {
        sawRings = true;
        const walls = engine.getCircularWalls();
        expect(walls.map((w) => w.radius)).toEqual(stage.radii);
        expect(stage.cx).toBe(config.width / 2);
        expect(stage.cy).toBe(config.height / 2);
        expect(engine.getCurrentMode()?.ballsMayRest).toBe(false);
      }
    }
    expect(sawRings).toBe(true);
    expect(engine.isSimulationFinished()).toBe(true);
  });

  it("multiplier gates stack on the ball through the run's multipliers, a size gate only as far as the stages below allow", () => {
    let applied = 0;
    for (const seed of [1, 2, 3, 4]) {
      const engine = journeyEngine({ stages: "multipliers-l,multipliers-l,funnel,home" }, seed);
      const view = engine.getJourneyView();
      const log = run(engine);
      expect(log.finishedAt).toBeGreaterThan(0);
      const gates = view.stages.filter((s): s is GatesStage => s instanceof GatesStage);
      const passed = gates.reduce((a, g) => a + g.passed, 0);
      expect(passed).toBe(6);
      const ball = engine.getBalls()[0];
      expect(engine.getMultiplierView().active).toBe(true);
      if (ball.mult) {
        applied++;
        expect(ball.radius).toBeLessThanOrEqual(Math.max(8, view.stages[2].maxBallRadius()) + 1e-9);
      }
      expect(log.events.filter((e) => e.type === "multiplier").length).toBeGreaterThan(0);
    }
    expect(applied).toBe(4);
  });

  it("glass panes crack and shatter (the Glass Smash rules), and every pane of a stage gets cleared", () => {
    const engine = journeyEngine({ stages: "glass-l,glass-m,home" }, 9);
    const view = engine.getJourneyView();
    const log = run(engine);
    expect(log.finishedAt).toBeGreaterThan(0);
    const glass = view.stages.slice(0, 2) as unknown as { panes: { cleared: boolean; shattered: boolean; hits: number }[]; shattered: number }[];
    expect(glass[0].panes).toHaveLength(GLASS_PANES.l);
    for (const g of glass) for (const pane of g.panes) expect(pane.cleared).toBe(true);
    const shattered = glass[0].shattered + glass[1].shattered;
    expect(log.events.filter((e) => e.type === "gap")).toHaveLength(shattered);
    expect(log.events.filter((e) => e.accent && !e.chord)).toHaveLength(shattered);
  });

  it("is deterministic: the same seed replays the same run, step for step", () => {
    const a = journeyEngine({ stages: "rings-s,pegs,glass,bullseye,home" }, 21);
    const b = journeyEngine({ stages: "rings-s,pegs,glass,bullseye,home" }, 21);
    for (let i = 0; i < 60 * 40; i++) {
      a.update(1000 / 60, 0);
      b.update(1000 / 60, 0);
      const ba = a.getBalls()[0];
      const bb = b.getBalls()[0];
      expect(ba.x).toBe(bb.x);
      expect(ba.y).toBe(bb.y);
      if (a.isSimulationFinished()) break;
    }
    expect(a.isSimulationFinished()).toBe(b.isSimulationFinished());
    expect(a.getJourneyView().cameraY).toBe(b.getJourneyView().cameraY);
  });

  it("a resize before the run lays the journey out exactly as an init at that size; a resize mid-run keeps it going", () => {
    const direct = run(journeyEngine({}, 31, { width: 1000, height: 760 }));
    const resized = journeyEngine({}, 31);
    resized.setConfig({ width: 1000, height: 760 });
    const after = run(resized);
    expect(after.finishedAt).toBe(direct.finishedAt);
    expect(after.kinds).toEqual(direct.kinds);

    const engine = journeyEngine({ stages: "rings,glass,pegs,home" }, 8);
    let resizedMid = false;
    const view = engine.getJourneyView();
    for (let i = 0; i < 60 * 90 && !engine.isSimulationFinished(); i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (!resizedMid && view.active === 0 && i > 120) {
        engine.setConfig({ width: 1200, height: 900 });
        resizedMid = true;
      }
    }
    expect(resizedMid).toBe(true);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(view.field!.height).toBeGreaterThan(800);
  });

  it("every journey reaches HOME, even with the biggest ball on the largest stages (a wedged ball hops, then squeezes through)", () => {
    for (const seed of [1, 5, 9]) {
      const engine = journeyEngine({ stages: "rings-l,pegs-l,glass-l,multipliers-l,rings-s,funnel-l,bullseye-l,home-l" }, seed, { ballRadius: 30 });
      const log = run(engine, 120);
      expect(log.finishedAt).toBeGreaterThan(0);
      expect(log.kinds).toEqual(["rings", "pegs", "glass", "multipliers", "rings", "funnel", "bullseye", "home"]);
    }
    for (const seed of [2, 3]) {
      const engine = journeyEngine({ stages: "pegs-l,bullseye-l,funnel-s,home" }, seed, { ballRadius: 4 });
      expect(run(engine, 90).finishedAt).toBeGreaterThan(0);
    }
  }, 30_000);

  it("the journey's gravity follows the Gravity setting (clamped) and the view size", () => {
    expect(journeyGravity(300, 500)).toBeCloseTo(2.4 * 500, 9);
    expect(journeyGravity(600, 500)).toBeCloseTo(4.8 * 500, 9);
    expect(journeyGravity(5000, 500)).toBeCloseTo(3 * 2.4 * 500, 9);
    expect(new JourneyMode().ballsMayRest).toBe(true);
  });
});

/* ------------------------------------------------------------------ the finder */

describe("Find Simulation", () => {
  it("every journey ends, its length varies with the seed, and the finder lands a target", async () => {
    expect(runNeverFinishes("journey", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("journey", {})).toBeNull();
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 200, maxSimTimeSec: 90, physicsConfig: config, mode: "journey", modeSettings: { ...modeSettings, journey: {} } };
    const lengths = new Set<number>();
    for (let seed = 1; seed <= 8; seed++) lengths.add(Math.round(simulateSeed(seed, request, 90_000)));
    expect(lengths.size).toBeGreaterThan(5);
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0));
    let result;
    try {
      result = await findSimulation(request, () => undefined);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(result.found).toBe(true);
    expect(Math.abs(result.duration - 30)).toBeLessThanOrEqual(0.5);
    const replay = run(createEngineForSettings(config, "journey", request.modeSettings, result.seed));
    expect(Math.abs(replay.finishedAt - result.duration)).toBeLessThan(0.02);
  }, 60_000);
});

/* ------------------------------------------------------------------ the swoosh */

interface Log {
  oscillators: { frequency: number; ramps: number[]; startAt: number }[];
  sources: number[];
  filters: { type: string; ramps: number[] }[];
}

function fakeGraph() {
  const log: Log = { oscillators: [], sources: [], filters: [] };
  const param = (ramps?: number[]) => {
    const p = {
      value: 0,
      setValueAtTime: (v: number) => {
        p.value = v;
      },
      linearRampToValueAtTime: () => undefined,
      exponentialRampToValueAtTime: (v: number) => void ramps?.push(v),
      cancelScheduledValues: () => undefined,
    };
    return p;
  };
  const node = () => ({ connect: () => undefined, disconnect: () => undefined });
  const ctx = {
    state: "running",
    currentTime: 0,
    sampleRate: 48000,
    destination: {},
    resume: async () => undefined,
    close: async () => undefined,
    decodeAudioData: async () => ({ duration: 0.3 }),
    createGain: () => ({ gain: param(), ...node() }),
    createAnalyser: () => ({ fftSize: 0, smoothingTimeConstant: 0, frequencyBinCount: 128, ...node() }),
    createMediaStreamDestination: () => ({ stream: {}, connect: () => undefined }),
    createBiquadFilter: () => {
      const ramps: number[] = [];
      const f = { type: "lowpass", frequency: param(ramps), Q: param(), ...node() };
      log.filters.push({ get type() { return f.type; }, ramps } as never);
      return f;
    },
    createOscillator: () => {
      const ramps: number[] = [];
      const osc = {
        type: "sine",
        frequency: param(ramps),
        ...node(),
        onended: null as (() => void) | null,
        start: (when = 0) => {
          if (osc.frequency.value !== 1) log.oscillators.push({ frequency: osc.frequency.value, ramps, startAt: when });
        },
        stop: () => undefined,
      };
      return osc;
    },
    createBufferSource: () => ({ buffer: null as unknown, playbackRate: param(), ...node(), start: (when = 0) => void log.sources.push(when), stop: () => undefined }),
    createBuffer: (channels: number, length: number, sampleRate: number) => ({ duration: length / sampleRate, copyToChannel: () => undefined }),
  };
  return { ctx, log };
}

describe("the swoosh", () => {
  it("is band-passed noise sweeping up with a sine glide under it", () => {
    const { ctx, log } = fakeGraph();
    const noise = ctx.createBuffer(1, 24000, 48000) as unknown as AudioBuffer;
    scheduleSwooshTone(ctx as unknown as BaseAudioContext, {} as AudioNode, 3, noise);
    expect(log.sources).toEqual([3]);
    expect(log.filters).toHaveLength(1);
    expect(log.filters[0].type).toBe("bandpass");
    expect(log.filters[0].ramps).toEqual([SWOOSH_TONE.bandTo]);
    expect(log.oscillators).toEqual([{ frequency: SWOOSH_TONE.glideFrom, ramps: [SWOOSH_TONE.glideTo], startAt: 3 }]);
  });

  describe("through the ToneGenerator", () => {
    let graph: ReturnType<typeof fakeGraph>;
    let tone: ToneGenerator;
    beforeEach(async () => {
      graph = fakeGraph();
      vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
      vi.stubGlobal("fetch", async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }));
      tone = new ToneGenerator();
      await tone.start();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("is never snapped to the scale and lands on the beat grid without taking a bounce's slot", () => {
      tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS, scale: "major", rootNote: 1, quantizeToBeat: true, bpm: 120, quantizeGrid: "1/4" });
      graph.ctx.currentTime = 0.1;
      tone.playSwoosh();
      expect(graph.log.oscillators[0].frequency).toBe(SWOOSH_TONE.glideFrom);
      expect(graph.log.oscillators[0].startAt).toBeCloseTo(0.5, 9);
      expect(graph.log.sources[graph.log.sources.length - 1]).toBeCloseTo(0.5, 9);
      tone.playWallHit(0, 440);
      expect(graph.log.oscillators[graph.log.oscillators.length - 1].startAt).toBeCloseTo(0.5, 9);
    });
  });

  it("the page / fast-export dispatch routes a swoosh event to playSwoosh()", () => {
    const calls: string[] = [];
    const audio = {
      playSwoosh: () => calls.push("swoosh"),
      playWallHit: (w: number, f?: number) => calls.push(`hit ${w} ${f}`),
      playGapPass: () => calls.push("gap"),
    } as unknown as ToneGenerator;
    playSoundEvent(audio, { type: "hit", wallIndex: 0, swoosh: true, melody: false }, () => calls.push("break"));
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 262 }, () => calls.push("break"));
    expect(calls).toEqual(["swoosh", "hit 0 262"]);
  });
});
