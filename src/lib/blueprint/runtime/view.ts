/*
 * --- blueprint --- What the canvas reads of a run (components/simulator/blueprintRenderer.ts): the arena, its obstacles and
 * tiles, the balls' Blueprint slots (tier, hit points, team) for their labels, the HUD counters, the clock, the end banner
 * and the run's counts for the smoke test's dataset. One object, refreshed in place at the end of every step (no allocation
 * per frame); its arrays are the world's own. A view with no run (`run: null`) draws nothing.
 */
import { DEFAULT_SAY, type Blueprint } from "../schema";
import type { BlueprintRun, RunResult } from "./run";
import type { BlueprintWorld, WorldBall } from "./world";

export interface BlueprintHudValue {
  label: string;
  /** What it counts (a count word or a variable id): the renderer's fallback label. */
  show: string;
  value: string;
}

export interface BlueprintView {
  /** The resolved spec being played (null before the first init). */
  bp: Blueprint | null;
  /** The world (geometry, tiles, balls; null before the first init). */
  world: BlueprintWorld | null;
  /** The catalog id it came from ("" for a spec from a link or a share code). */
  catalogId: string;
  timeSec: number;
  timeoutSec: number;
  hud: BlueprintHudValue[];
  balls: number;
  tiles: number;
  tilesTotal: number;
  rings: number;
  escaped: number;
  /** A ball refused at the ball ceiling within the last second or so: the ARENA FULL badge. */
  arenaFullAtSec: number;
  flashAtSec: number;
  /** Whether any body shows a label: tiers (a merge or tier rule, or a body above tier 1) and hit points. */
  showTiers: boolean;
  showHp: boolean;
  result: RunResult;
  /** The run counts the smoke test reads (data-blueprint-*). */
  dropped: number;
  faults: number;
  steps: number;
  /** The sanitizer's notes about the spec as given (a link's spec that had to be repaired), for the panel. */
  notes: string[];
  /** The newer features a spec named that this version does not know. */
  newer: string[];
}

export function createBlueprintView(): BlueprintView {
  return {
    bp: null,
    world: null,
    catalogId: "",
    timeSec: 0,
    timeoutSec: 0,
    hud: [],
    balls: 0,
    tiles: 0,
    tilesTotal: 0,
    rings: 0,
    escaped: 0,
    arenaFullAtSec: -Infinity,
    flashAtSec: -Infinity,
    showTiers: false,
    showHp: false,
    result: { finished: false, reason: null, condition: -1, timeSec: 0, winner: -1, result: "" },
    dropped: 0,
    faults: 0,
    steps: 0,
    notes: [],
    newer: [],
  };
}

/** A HUD number as text: whole numbers as they are, others with one decimal; the clock in whole seconds. */
function hudText(show: string, v: number): string {
  if (show === "time") return `${Math.floor(v)} s`;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

/** Points the view at a new run (an init or a restart). */
export function attachBlueprintView(view: BlueprintView, run: BlueprintRun, catalogId: string, notes: string[], newer: string[]) {
  const bp = run.bp;
  view.bp = bp;
  view.world = run.world;
  view.catalogId = catalogId;
  view.timeoutSec = bp.finish.timeoutSec;
  view.hud = bp.hud.map((h) => ({ label: h.label, show: h.show, value: "" }));
  view.showTiers = bp.bodies.some((b) => b.tier > 1) || bp.rules.some((r) => r.do.some((a) => a.act === "merge" || a.act === "tier")) || bp.finish.any.some((c) => c.when === "tier");
  view.showHp = bp.bodies.some((b) => b.hp > 0);
  view.tilesTotal = run.world.tileCount;
  view.notes = notes;
  view.newer = newer;
  refreshBlueprintView(view, run);
}

/** Copies the run's numbers into the view (end of every step). */
export function refreshBlueprintView(view: BlueprintView, run: BlueprintRun) {
  view.timeSec = run.done.finished ? run.done.timeSec : run.timeSec;
  for (const h of view.hud) h.value = hudText(h.show, run.count(h.show));
  view.balls = run.world.aliveCount();
  view.tiles = run.world.tilesAlive;
  view.rings = run.world.ringsAlive();
  view.escaped = run.stats.escaped;
  view.arenaFullAtSec = run.arenaFullAtSec;
  view.flashAtSec = run.flashAtSec;
  view.result = run.done;
  view.dropped = run.stats.droppedEvents + run.stats.droppedFirings;
  view.faults = run.stats.faults;
  view.steps = run.stats.steps;
}

/** The end banner's line of a finished run ("" while it runs). */
export function bannerText(view: BlueprintView): string {
  const r = view.result;
  if (!r.finished || !view.bp) return "";
  if (r.result) return r.result;
  return r.reason === "condition" ? DEFAULT_SAY[view.bp.finish.any[r.condition]?.when ?? "count"] : view.bp.finish.timeoutSay;
}

/** The label a ball shows (its tier, or its hit points), or "" for none. */
export function ballLabel(view: BlueprintView, b: WorldBall): string {
  if (view.showHp && b.hp > 0) return String(Math.ceil(b.hp));
  if (view.showTiers) return String(b.tier);
  return "";
}
