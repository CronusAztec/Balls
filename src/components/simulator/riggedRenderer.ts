import type { PhysicsEngine } from "@/lib/physics/engine";

/** Data attributes the rig mirrors onto the canvas (see `writeRigDataset()`). */
export const RIG_DATA_KEYS = ["rigNeverEscape", "rigWinner", "rigSeals", "rigSteers", "rigGuides", "rigNearMisses", "firstEscape"] as const;

/**
 * --- rigged --- Mirrors the rigged outcomes onto the canvas element for tools and the smoke test: the rules in effect
 * (`data-rig-never-escape` 1/0, `data-rig-winner` the forced team slot or −1), what the rig did this run
 * (`data-rig-seals` refused gap passes, `data-rig-steers` turned rebounds, `data-rig-guides` bent flights,
 * `data-rig-near-misses`) and the run's first escape (`data-first-escape`, seconds of simulation time, −1 without one –
 * tracked with the rig on or off). It draws nothing on purpose: a rigged clip looks like any other, and the page says
 * that the rig is on outside the canvas, where the recording does not see it. `set` only writes changed values.
 */
export function writeRigDataset(engine: PhysicsEngine, set: (key: string, value: string) => void) {
  const v = engine.getRigView();
  set("rigNeverEscape", v.neverEscape ? "1" : "0");
  set("rigWinner", String(v.winner));
  set("rigSeals", String(v.seals));
  set("rigSteers", String(v.steers));
  set("rigGuides", String(v.guides));
  set("rigNearMisses", String(v.nearMisses));
  set("firstEscape", v.firstEscapeMs >= 0 ? (v.firstEscapeMs / 1000).toFixed(2) : "-1");
}
