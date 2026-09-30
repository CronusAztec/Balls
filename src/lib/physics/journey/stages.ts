import { BullseyeStage } from "./bullseye";
import { FunnelStage } from "./funnel";
import { GatesStage } from "./gates";
import { GlassStage } from "./glass";
import { HomeStage } from "./home";
import { PegsStage } from "./pegs";
import { RingsStage } from "./rings";
import type { JourneyStageSpec } from "./sequence";
import type { JourneyStage } from "./stage";

/** The stage adapter for a spec (not laid out yet – `init(bounds)` does that). */
export function createStage(spec: JourneyStageSpec, index: number): JourneyStage {
  switch (spec.kind) {
    case "rings":
      return new RingsStage(index, spec.size);
    case "glass":
      return new GlassStage(index, spec.size);
    case "pegs":
      return new PegsStage(index, spec.size);
    case "multipliers":
      return new GatesStage(index, spec.size);
    case "funnel":
      return new FunnelStage(index, spec.size);
    case "bullseye":
      return new BullseyeStage(index, spec.size);
    case "home":
      return new HomeStage(index, spec.size);
  }
}

/**
 * A stage's own generator (Mulberry32) from one number of the engine's: a stage may draw as many numbers as its layout
 * needs at any canvas size without shifting the next stage's, so a journey laid out again at a new size (before the
 * run starts) is exactly the one an init at that size gives.
 */
export function stageRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    let t = (state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}
