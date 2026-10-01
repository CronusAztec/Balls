import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { defaultExitSplatFields, exitSplatConfigOf, type ExitSplatFields } from "@/lib/physics/exitSplat";
import { respawnConfigOf } from "@/lib/physics/respawn";
import type { ModeId, PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { MultiArenaRunner, arenaFinderRequest, arenaPhysicsConfig, type ArenaHooks } from "@/lib/simulation/multi";
import { sectionDefaults } from "@/components/simulator/Controls";

/**
 * gerald-conveyor × gerald-exit-splat: the respawn timer of Classic and Multiply (respawn.ts) and the moving exits and splat
 * barriers of the ring modes (movingExits.ts, splats.ts) all live in the physics config and act inside the engine's step.
 * Together they replay exactly for a seed (the seed finder's engine and the page's), the Conveyor Belt – a mode neither of
 * them applies to – runs untouched by them, and the split-screen arenas follow the respawn timer as they follow the exits
 * and the splats (the arena finder searches every arena with the page's config), and the panel's section resets put all three
 * back (the respawn timer with the Ball section, the exits with the Wall section, the splats with the Visual section).
 */

const config: PhysicsConfig = {
  width: 800,
  height: 450,
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

function exitSplat(patch: Partial<ExitSplatFields>): Pick<PhysicsConfig, keyof ExitSplatFields> {
  return exitSplatConfigOf({ ...defaultExitSplatFields(), ...patch });
}

/** Steps `engine` for `frames` frames: a sample of the balls, the splats, the exits and the respawns every 30 frames. */
function trace(engine: PhysicsEngine, frames: number, events?: SoundEvent[]) {
  const out: number[] = [];
  let notFinite = 0;
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    const step = engine.consumeSoundEvents();
    if (events) events.push(...step);
    for (const b of engine.getBalls()) if (!Number.isFinite(b.x + b.y + b.vx + b.vy)) notFinite++;
    if (i % 30 === 0) out.push(engine.getBalls().length, ...engine.getBalls().flatMap((b) => [b.x, b.y]), engine.getSplats().created, engine.getExitView().moves, engine.getRespawnCount());
  }
  return { out, notFinite };
}

describe("respawns with moving exits and splat barriers", () => {
  const cases: [ModeId, Partial<ExitSplatFields>][] = [
    ["classic", { exitBehavior: "jump", exitJumpSeconds: 1.5, exitSense: 40, splatBarrier: true, splatMax: 60 }],
    ["classic", { exitBehavior: "shrink", exitJumpSeconds: 1.5, splatBarrier: true }],
    ["multiply", { exitBehavior: "flee", exitSense: 60, splatBarrier: true, splatMax: 40 }],
  ];

  it("replay exactly for a seed – the seed finder's engine, a second one and the page's (set after the mode starts)", () => {
    for (const [mode, patch] of cases) {
      const cfg = { ...config, ...exitSplat(patch), respawnEvery: 1 };
      const events: SoundEvent[] = [];
      const a = trace(createEngineForSettings(cfg, mode, modeSettings, 4242), 60 * 12, events);
      const label = `${mode} ${patch.exitBehavior}`;
      expect(a.notFinite, label).toBe(0);
      expect(trace(createEngineForSettings(cfg, mode, modeSettings, 4242), 60 * 12).out, label).toEqual(a.out);
      const page = new PhysicsEngine({ ...config });
      page.setSeed(4242);
      page.initMode(mode);
      page.setConfig({ ...exitSplat(patch), ...respawnConfigOf({ respawnEvery: 1 }) });
      expect(trace(page, 60 * 12).out, `${label} page`).toEqual(a.out);
      // All three act: balls drop in, wall hits splat (a respawned ball's too), and each sound is one of its own kind.
      const ended = createEngineForSettings(cfg, mode, modeSettings, 4242);
      trace(ended, 60 * 12);
      expect(ended.getRespawnCount(), label).toBeGreaterThan(0);
      expect(ended.getSplats().created, label).toBeGreaterThan(0);
      expect(events.filter((ev) => ev.conveyor === "click").length, label).toBe(ended.getRespawnCount());
      expect(events.some((ev) => ev.splat), label).toBe(true);
      expect(events.some((ev) => ev.splat && ev.conveyor), label).toBe(false);
      // And the respawns change the run.
      expect(trace(createEngineForSettings({ ...config, ...exitSplat(patch) }, mode, modeSettings, 4242), 60 * 12).out, label).not.toEqual(a.out);
    }
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: { ...config, ...exitSplat(cases[0][1]), respawnEvery: 1 }, mode: "classic", modeSettings };
    expect(simulateSeed(77, request, 30_000)).toBe(simulateSeed(77, request, 30_000));
  }, 60_000);

  it("leave the Conveyor Belt untouched in every arena: neither the exits, the splats nor the respawn timer apply there", () => {
    for (const arena of ["rings", "bowl", "pegs"] as const) {
      const plain = trace(createEngineForSettings(config, "conveyor", { ...modeSettings, conveyor: { arena } }, 7), 60 * 15);
      expect(plain.notFinite, arena).toBe(0);
      const cfg = { ...config, ...exitSplat({ exitBehavior: "jump", exitJumpSeconds: 1, splatBarrier: true }), respawnEvery: 1 };
      expect(trace(createEngineForSettings(cfg, "conveyor", { ...modeSettings, conveyor: { arena } }, 7), 60 * 15).out, arena).toEqual(plain.out);
    }
  }, 30_000);
});

describe("split-screen arenas", () => {
  /** The page's side, as Simulator.tsx builds it (an arena engine starts from the page's config, then gets its own). */
  const HOOKS: ArenaHooks = {
    create: (page) => new PhysicsEngine({ ...page.config }),
    init: (engine, s, seed, world) => {
      engine.setConfig({ ...arenaPhysicsConfig(s), width: world.width, height: world.height });
      engine.setSeed(seed);
      engine.initMode(s.mode);
    },
    initPage: (page) => page.initMode(page.getCurrentModeName()),
    live: () => {},
  };

  it("carry the respawn timer like the exits and the splats, so a period set during a race reaches every arena", () => {
    const s: SimulatorSettings = { ...defaultSettings("classic"), arenaCount: 2, arenas: [{ label: "A" }, { label: "B", seed: 9 }] };
    expect(arenaPhysicsConfig({ ...s, respawnEvery: 2 })).toMatchObject({ respawnEvery: 2, ...exitSplatConfigOf(s) });
    // The page's engine (its config effects) and the race's runner, the second arena built while the timer was off.
    const page = new PhysicsEngine({ ...arenaPhysicsConfig(s), width: 800, height: 450 });
    page.setSeed(42);
    page.initMode("classic");
    const runner = new MultiArenaRunner();
    runner.sync(page, s, HOOKS);
    for (let i = 0; i < 30; i++) for (const e of runner.getEngines()) e.update(STEP, 0);
    // Respawn Every set mid-run: the page's effect, then the runner's live update.
    const on: SimulatorSettings = { ...s, respawnEvery: 1, exitBehavior: "jump", splatBarrier: true };
    page.setConfig({ ...respawnConfigOf(on), ...exitSplatConfigOf(on) });
    runner.sync(page, on, HOOKS);
    expect(runner.getEngines().map((e) => [e.config.respawnEvery, e.config.exitBehavior, e.config.splatBarrier])).toEqual([
      [1, "jump", true],
      [1, "jump", true],
    ]);
    // A restart starts every arena over with it, and every arena respawns – as the arena finder's runs (the page's config) do.
    page.initMode("classic");
    runner.sync(page, on, HOOKS);
    for (let i = 0; i < 60 * 3; i++) for (const e of runner.getEngines()) e.update(STEP, 0);
    expect(runner.getEngines().map((e) => e.getRespawnCount())).toEqual([3, 3]);
    const plan = { arenas: [{ label: "A" }, { label: "B" }], worlds: [], shared: { gravity: on.gravity, ballSpeed: on.ballSpeed, ballColor: on.ballColor } };
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: { ...page.config }, mode: "classic", modeSettings };
    expect(arenaFinderRequest(request, plan, 1).physicsConfig.respawnEvery).toBe(1);
    // A longer period set during the race: every arena goes on at its next multiple (6 s, 9 s), none waits for 3 s × 4.
    const longer: SimulatorSettings = { ...on, respawnEvery: 3 };
    page.setConfig(respawnConfigOf(longer));
    runner.sync(page, longer, HOOKS);
    for (let i = 0; i < 60 * 6; i++) for (const e of runner.getEngines()) e.update(STEP, 0);
    expect(runner.getEngines().map((e) => e.getRespawnCount())).toEqual([5, 5]);
  });
});

describe("the panel's section resets", () => {
  it("turn the respawn timer off with the Ball section, as the Wall section puts the exits back and the Visual section the splats", () => {
    for (const mode of ["classic", "multiply"] as const) {
      const d = defaultSettings(mode);
      expect(d.respawnEvery, mode).toBe(0);
      expect(sectionDefaults("ball", mode), mode).toMatchObject({ respawnEvery: 0 });
      expect(sectionDefaults("wall", mode), mode).toMatchObject({ exitBehavior: d.exitBehavior, exitJumpSeconds: d.exitJumpSeconds, exitSense: d.exitSense, exitFleeSpeed: d.exitFleeSpeed });
      expect(sectionDefaults("visual", mode), mode).toMatchObject({ splatBarrier: d.splatBarrier, splatSize: d.splatSize, splatMax: d.splatMax });
    }
  });
});
