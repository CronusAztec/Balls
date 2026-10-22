/*
 * --- blueprint --- A Blueprint played headless on the real runtime: the engine (lib/physics/engine.ts) in the blueprint
 * mode, built the way the finder builds it (createEngineForSettings: the Bounciness off, the cinematic director on, the
 * seed, initMode) and stepped at the page's fixed 60 Hz – so what the playability check (check.ts), the agent toolbox's
 * bp-check and the tests measure is exactly what the page, the fast export and the finder play. The spec goes in through
 * its link code, as a link would bring it (decoded, sanitized – sanitizing a sanitized spec changes nothing).
 *
 * The world is the portrait clip's (9:16: 450 × 800 world px), the page's default physics otherwise; a Blueprint's own
 * gravity, sizes and speeds do not read the page's.
 */
import { PhysicsEngine } from "@/lib/physics/engine";
import type { PhysicsConfig } from "@/lib/physics/types";
import { encodeBlueprint } from "./codec";
import type { Blueprint } from "./schema";
import type { BlueprintRun, RunResult, RunStats } from "./runtime/run";
import type { BlueprintWorld } from "./runtime/world";

/** The engine config of a headless run: the portrait clip's world and the page's default physics. */
export const BLUEPRINT_RUN_CONFIG: PhysicsConfig = {
  width: 450,
  height: 800,
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

export interface HeadlessOptions {
  seed: number;
  /** Conformance tests only: firing rule i throws, to prove fault containment. */
  faultOnRule?: number;
  /** Another engine config (a 16:9 world, the physics extras…). */
  config?: PhysicsConfig;
  /** Slider values (`blv`). */
  params?: string;
}

/** One seed of a spec in its own engine, stepped one fixed 60 Hz step at a time. */
export class HeadlessBlueprint {
  readonly engine: PhysicsEngine;

  constructor(bp: Blueprint, options: HeadlessOptions) {
    const engine = new PhysicsEngine({ ...(options.config ?? BLUEPRINT_RUN_CONFIG) });
    engine.setBouncier(false);
    engine.setBlueprintSettings({ spec: encodeBlueprint(bp), params: options.params ?? "" });
    engine.blueprintMode.faultOnRule = options.faultOnRule ?? -1;
    engine.setCinematicEnabled(true);
    engine.setSeed(options.seed);
    engine.initMode("blueprint");
    this.engine = engine;
  }

  /** The interpreter of the run (its world, variables and counts). */
  get run(): BlueprintRun {
    return this.engine.blueprintMode.getRun()!;
  }
  get world(): BlueprintWorld {
    return this.run.world;
  }
  get vars(): Float64Array {
    return this.run.vars;
  }
  get stats(): RunStats {
    return this.run.stats;
  }
  /** The result is decided (the end banner's hold still follows on the page). */
  get finished(): boolean {
    return this.run.finished;
  }
  result(): RunResult {
    return this.run.result();
  }

  /** One fixed step (1/60 s), its sounds consumed as the page consumes them. */
  step(): void {
    this.engine.update(1000 / 60, 0);
    this.engine.consumeSoundEvents();
  }

  /** Steps until the result is decided or `maxSec` of steps passed (default: the timeout and 2 s). */
  runToEnd(maxSec = this.run.bp.finish.timeoutSec + 2): RunResult {
    const steps = Math.ceil(maxSec * 60);
    for (let i = 0; i < steps && !this.finished; i++) this.step();
    return this.result();
  }
}

/** Runs a spec headless from a seed to its end (or `maxSec`): the result and the counts. */
export function runBlueprint(bp: Blueprint, options: HeadlessOptions & { maxSec?: number }): { result: RunResult; stats: RunStats; run: BlueprintRun } {
  const h = new HeadlessBlueprint(bp, options);
  const result = h.runToEnd(options.maxSec);
  return { result, stats: { ...h.stats }, run: h.run };
}
