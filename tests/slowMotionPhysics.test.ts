import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS, type ModeId, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { BASELINE_FILE, FINGERPRINT_CONFIG, FINGERPRINT_MODE_SETTINGS, FINGERPRINT_SEED, fingerprintOf, parseBaselineLiteral } from "@/lib/agentKit/fingerprint";

/*
 * --- slow-motion --- The Slow motion switch in the physics (`PhysicsConfig.slowMotion === false`, link `smo=0`). Only two
 * modes slow their own simulated clock down, and only they read the switch: Bullseye (a bullseye opens a 500 ms window at
 * 0.3) and Fight League (the KO finale, `flSm`). With the switch off neither happens, a deterministic variant of the run the
 * page, the finder, the fast export, the batch, the bot and the CLI all play alike. Every other mode runs exactly the steps
 * it ran with the switch on: everything else the switch does is pacing and presentation (the page's real-time loop, the
 * camera), never a step of the engine.
 *
 * Bullseye's off run is pinned below as a new row (recorded once when the switch was added); BASELINE.bullseye and Fight
 * League's GOLDEN prints stay where they are. Fight League's off run is no new literal: it equals its flSm=0 run.
 */

const ROOT = path.resolve(__dirname, "..");
const STEP = 1000 / 60;
const off = (config: PhysicsConfig): PhysicsConfig => ({ ...config, slowMotion: false });

/** A 32-bit FNV-1a over the exact bits of each number (a step's state is compared bit for bit, not rounded). */
const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);
function mix(h: number, x: number | undefined): number {
  f64[0] = x === undefined ? Number.NaN : x;
  h = Math.imul(h ^ u32[0], 16777619);
  return Math.imul(h ^ u32[1], 16777619);
}
function mixText(h: number, text: string): number {
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h;
}

/** One step's state: the clock, every ball, the rings, the broken walls and the step's sounds. */
function stepDigest(engine: PhysicsEngine, sounds: SoundEvent[]): number {
  let h = mix(0x811c9dc5, engine.getElapsedMs());
  for (const b of engine.getBalls()) {
    h = mix(h, b.id);
    h = mix(h, b.x);
    h = mix(h, b.y);
    h = mix(h, b.vx);
    h = mix(h, b.vy);
    h = mix(h, b.radius);
  }
  for (const w of engine.getCircularWalls()) h = mix(h, w.radius);
  h = mix(h, engine.getBrokenWalls().size);
  for (const ev of sounds) {
    h = mixText(h, ev.type);
    h = mix(h, ev.frequency);
    h = mix(h, ev.wallIndex);
  }
  return h >>> 0;
}

/** The digest of every step of a run of `frames` steps (or until it finishes). */
function stepDigests(engine: PhysicsEngine, frames: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < frames && !engine.isSimulationFinished(); i++) {
    engine.update(STEP, 0);
    out.push(stepDigest(engine, engine.consumeSoundEvents()));
  }
  return out;
}

/** The first step two digest lists differ at, or −1 (a length difference counts at the shorter's end). */
function firstDifference(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
  return a.length === b.length ? -1 : n;
}

/** The mode at its defaults as a link builds it (the finder's request of the default settings). */
function defaultsEngine(mode: ModeId, settings: Partial<SimulatorSettings> = {}, seed = 3): PhysicsEngine {
  const request = finderRequestOfSettings({ ...defaultSettings(mode), ...settings } as SimulatorSettings);
  return createEngineForSettings(request.physicsConfig, mode, request.modeSettings, seed);
}

/* ------------------------------------------------------------------ Bullseye */

/**
 * Bullseye's richer print, by the BASELINE recipe (tests/extras.test.ts `config` and `modeSettings`, seed 12345, 600 frames):
 * every 150 frames the world clock × 1000, shots launched and landed, the total, the bullseyes, the slow-motion windows, then
 * every ball's [x, y] × 1000. The BASELINE row samples only the first two balls, which are stuck in the target before the
 * run's bullseye, so it reads the same both ways; this one sees the world clock and the shots in flight.
 */
function bullseyePrint(config: PhysicsConfig): number[][] {
  const engine = createEngineForSettings(config, "bullseye", FINGERPRINT_MODE_SETTINGS, FINGERPRINT_SEED);
  const v = engine.getBullseyeView();
  const rows: number[][] = [];
  for (let i = 1; i <= 600; i++) {
    engine.update(STEP, 0);
    if (i % 150 === 0) rows.push([Math.round(v.timeMs * 1000), v.launched, v.landed, v.total, v.bullseyes, v.slowMos, ...engine.getBalls().flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)])]);
  }
  return rows;
}

/** Recorded once when the Slow motion switch was added (website 1.16.0): a new row, never re-recorded to make a test pass. */
const BULLSEYE_PRINTS: Readonly<Record<"on" | "off", readonly (readonly number[])[]>> = {
  // with the switch on (the default): the run's one bullseye at about 9 s opens its window, the world clock falls behind
  on: [[2500000,2,1,3,0,0,261123,524036,387945,104306],[5000000,3,2,10,0,0,261123,524036,457992,524036,394670,132126],[7500000,4,2,10,0,0,261123,524036,457992,524036,419452,468478,463481,288140],[9720556,5,4,20,1,1,261123,524036,457992,524036,417817,524036,189013,524036,428519,254958]],
  // with the switch off (smo=0): the same bullseye opens no window; the world clock keeps time and the fifth shot flies on
  off: [[2500000,2,1,3,0,0,261123,524036,387945,104306],[5000000,3,2,10,0,0,261123,524036,457992,524036,394670,132126],[7500000,4,2,10,0,0,261123,524036,457992,524036,419452,468478,463481,288140],[10000000,5,4,20,1,0,261123,524036,457992,524036,417817,524036,186359,524036,507813,314385]],
};

describe("Bullseye with the Slow motion switch off (--- slow-motion ---)", () => {
  it("plays its pinned run: the bullseye scores and opens no window, the world clock keeps time", () => {
    expect(bullseyePrint(off(FINGERPRINT_CONFIG))).toEqual(BULLSEYE_PRINTS.off);
  });

  it("with the switch on plays exactly the run it always did, and its BASELINE row stays where it is", () => {
    expect(bullseyePrint(FINGERPRINT_CONFIG)).toEqual(BULLSEYE_PRINTS.on);
    const baseline = parseBaselineLiteral(fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"));
    expect(fingerprintOf("bullseye")).toEqual(baseline.bullseye);
  });

  it("is deterministic: the same seed off replays bit for bit, through the finder's request of a link with smo=0", () => {
    const a = stepDigests(defaultsEngine("bullseye", { slowMotion: false }, 9), 60 * 40);
    const b = stepDigests(defaultsEngine("bullseye", { slowMotion: false }, 9), 60 * 40);
    expect(a).toEqual(b);
    const on = stepDigests(defaultsEngine("bullseye", {}, 9), 60 * 40);
    expect(firstDifference(a, on)).toBeGreaterThan(0); // the runs part at the first bullseye, not before
  });
});

/* ------------------------------------------------------------------ Fight League */

/** Fight League's view as JSON without its settings (`slowMo` is the one field the two runs compared below may differ in). */
function flStateJson(engine: PhysicsEngine): string {
  return JSON.stringify(engine.getFightLeagueView(), (key, value) => (key === "settings" ? undefined : ArrayBuffer.isView(value) ? Array.from(value as unknown as ArrayLike<number>) : value));
}

interface FlRun {
  steps: number[];
  sounds: string[];
  end: string;
  finale: number;
  kos: number;
  byTime: boolean;
  timeWarps: number;
}

/** A Fight League run to its end: each step's digest (balls, fighters, drawn positions, the finale), every sound, the end state. */
function flRun(settings: Partial<SimulatorSettings>, seed: number): FlRun {
  const engine = defaultsEngine("fightLeague", settings, seed);
  const v = engine.getFightLeagueView();
  const steps: number[] = [];
  const sounds: string[] = [];
  let timeWarps = 0;
  for (let i = 0; i < 60 * 200 && !engine.isSimulationFinished(); i++) {
    engine.update(STEP, 0);
    const events = engine.consumeSoundEvents();
    let h = stepDigest(engine, events);
    for (const f of v.fighters) for (const x of [f.x, f.y, f.vx, f.vy, f.hp, f.finX, f.finY, f.trailHead]) h = mix(h, x);
    for (const x of [v.finale.from, v.finale.until, v.finale.x, v.finale.y, v.bannerSerial, v.eventSerial, v.timeMs]) h = mix(h, x);
    steps.push(h >>> 0);
    for (const ev of events) {
      sounds.push(JSON.stringify(ev));
      if (ev.flCue === "match" && ev.flRow === "timeWarp") timeWarps++;
    }
  }
  return { steps, sounds, end: flStateJson(engine), finale: v.finale.from, kos: v.kos, byTime: v.byTime, timeWarps };
}

describe("Fight League's KO finale with the Slow motion switch off (--- slow-motion ---)", () => {
  it("plays exactly its flSm=0 run: the card at once, no time warp – the stored flSm untouched", () => {
    for (const seed of [3, 5]) {
      const kept = flRun({ flSlowMo: true, slowMotion: false }, seed);
      const noFinale = flRun({ flSlowMo: false }, seed);
      const finale = flRun({ flSlowMo: true }, seed);
      // the run reaches a KO verdict, so the finale is in play: with both switches on it opens, with its time warp
      expect(finale.kos, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      expect(finale.byTime).toBe(false);
      expect(finale.finale).toBeGreaterThan(0);
      expect(finale.timeWarps).toBe(1);
      expect(firstDifference(finale.steps, noFinale.steps)).toBeGreaterThan(0);
      // with the master switch off: step for step, sound for sound and state for state the flSm=0 run
      expect(kept.finale).toBe(-1);
      expect(kept.timeWarps).toBe(0);
      expect(firstDifference(kept.steps, noFinale.steps), `seed ${seed}`).toBe(-1);
      expect(kept.sounds).toEqual(noFinale.sounds);
      expect(kept.end).toBe(noFinale.end);
    }
  }, 120_000);

  it("with the switch on keeps the finale as it was: flSm alone decides", () => {
    const engine = defaultsEngine("fightLeague", { flSlowMo: true }, 3);
    expect(engine.slowMotionOn()).toBe(true);
    for (let i = 0; i < 60 * 200 && !engine.isSimulationFinished(); i++) engine.update(STEP, 0);
    const v = engine.getFightLeagueView();
    expect(v.settings.slowMo).toBe(true);
    expect(v.finale.until - v.finale.from).toBeGreaterThan(0);
  }, 120_000);
});

/* ------------------------------------------------------------------ every other mode */

/** The two modes whose run the switch changes; every other mode runs the very same steps with it off. */
const READS_THE_SWITCH: readonly ModeId[] = ["bullseye", "fightLeague"];

describe("every other mode runs the same steps with the Slow motion switch off (--- slow-motion ---)", () => {
  for (const mode of MODE_IDS) {
    if (READS_THE_SWITCH.includes(mode)) continue;
    it(`${mode}: step for step the run of the switch on, by the BASELINE recipe and at the mode's defaults`, () => {
      const recipe = (config: PhysicsConfig) => stepDigests(createEngineForSettings(config, mode, FINGERPRINT_MODE_SETTINGS as ModeSettings, FINGERPRINT_SEED), 600);
      expect(firstDifference(recipe(off(FINGERPRINT_CONFIG)), recipe(FINGERPRINT_CONFIG)), mode).toBe(-1);
      const offEngine = defaultsEngine(mode, { slowMotion: false });
      expect(offEngine.slowMotionOn()).toBe(false);
      expect(firstDifference(stepDigests(offEngine, 600), stepDigests(defaultsEngine(mode), 600)), mode).toBe(-1);
    }, 120_000);
  }

  it("bullseye, by the same recipe, parts from its run with the switch on at its bullseye", () => {
    const recipe = (config: PhysicsConfig) => stepDigests(createEngineForSettings(config, "bullseye", FINGERPRINT_MODE_SETTINGS as ModeSettings, FINGERPRINT_SEED), 600);
    expect(firstDifference(recipe(off(FINGERPRINT_CONFIG)), recipe(FINGERPRINT_CONFIG))).toBeGreaterThan(300);
  });
});

/* ------------------------------------------------------------------ who reads it */

/** Every .ts file under `dir`, relative to the repository root. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...sources(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe("who reads the switch in the physics (--- slow-motion ---)", () => {
  /** The code (never a comment or a string) that reads `.slowMotion` in `file`: each property access, with its expression's text. */
  function reads(file: string): string[] {
    const code = fs.readFileSync(path.join(ROOT, file), "utf8");
    const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    const out: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isPropertyAccessExpression(node) && node.name.text === "slowMotion") out.push((ts.isBinaryExpression(node.parent) ? node.parent : node).getText(source));
      ts.forEachChild(node, visit);
    };
    visit(source);
    return out;
  }

  it("only Bullseye and Fight League under src/lib/physics, besides the engine's accessors", () => {
    const readers = sources("src/lib/physics").filter((file) => reads(file).length > 0);
    expect(readers.sort()).toEqual(["src/lib/physics/engine.ts", "src/lib/physics/modes/bullseye.ts", "src/lib/physics/modes/fightLeague.ts"]);
    // each of the two reads it once and the one way: off only when it is false (a config from before the switch is on)
    expect(reads("src/lib/physics/modes/bullseye.ts")).toEqual(["ctx.config.slowMotion !== false"]);
    expect(reads("src/lib/physics/modes/fightLeague.ts")).toEqual(["this.ctxRef?.config.slowMotion !== false"]);
    // the engine: its accessors only (setSlowMotion() writes the key or takes it out, slowMotionOn() reads it), never a step
    expect(reads("src/lib/physics/engine.ts").sort()).toEqual(["next.slowMotion", "next.slowMotion = false", "this._config.slowMotion !== false"].sort());
  });
});
