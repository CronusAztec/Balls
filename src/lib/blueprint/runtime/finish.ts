/*
 * --- blueprint --- How a run ends: the first finish condition met (each only after it was once unmet – balls not spawned
 * yet never "cleared" anything), else the timeout, else – a run the engine slowed past recognition (time dilation) –
 * BLUEPRINT_STEP_CEILING_FACTOR × the timeout's steps; a fault ends it 1 s after the rules stopped. The winner (a team, or
 * none) and the result line with its placeholders filled ({winner}, {time}, {balls}, {escaped}, {tier}, {tiles}, {rings}
 * and the spec's variable ids) are fixed at that moment.
 */
import { DEFAULT_SAY, type BlueprintFinishCondition } from "../schema";
import type { BlueprintRun, FinishReason } from "./run";
import type { WorldBall } from "./world";

/** A run ends after at most this many times its timeout in steps, however slowly the engine let simulated time pass. */
export const BLUEPRINT_STEP_CEILING_FACTOR = 8;

/** Whether finish condition `i` holds now. */
export function met(run: BlueprintRun, c: BlueprintFinishCondition, i: number): boolean {
  switch (c.when) {
    case "escaped":
      return run.count("escaped", run.compiled.finishOf[i]) >= (c.atLeast ?? 1);
    case "tilesCleared":
      return run.world.tileCount > 0 && run.world.tilesAlive === 0;
    case "ringsCleared":
      return run.world.ringR.length > 0 && run.world.ringsAlive() === 0;
    case "count": {
      const v = run.compiled.finishVar[i] >= 0 ? run.vars[run.compiled.finishVar[i]] : run.count(c.what, run.compiled.finishOf[i]);
      return (c.atLeast !== null && v >= c.atLeast) || (c.atMost !== null && v <= c.atMost);
    }
    case "tier":
      return run.count("tier") >= (c.atLeast ?? 2);
    case "teamsLeft":
      return run.teamsSeen > (c.atMost ?? 1) && run.teamsLeft() <= (c.atMost ?? 1);
  }
}

/** Ends the run when a condition, the timeout, the step ceiling or a fault says so. */
export function checkFinish(run: BlueprintRun) {
  if (run.faultAt >= 0) {
    if (run.timeSec >= run.faultAt + 1 || run.stats.steps >= run.faultStep + 60) finish(run, "fault", -1);
    return;
  }
  const conds = run.bp.finish.any;
  for (let i = 0; i < conds.length; i++) {
    const m = met(run, conds[i], i);
    if (run.finishArmed[i] === 0) {
      if (!m) run.finishArmed[i] = 1;
      continue;
    }
    if (m) return finish(run, "condition", i);
  }
  if (run.timeSec >= run.bp.finish.timeoutSec - 1e-9 || run.stats.steps >= Math.ceil(run.bp.finish.timeoutSec * 60 * BLUEPRINT_STEP_CEILING_FACTOR)) finish(run, "timeout", -1);
}

/** The winning team by the spec's rule (−1: none). */
export function winnerTeam(run: BlueprintRun): number {
  switch (run.bp.finish.winner) {
    case "firstOut":
      return run.firstOutTeam;
    case "lastOut":
      return run.lastOutTeam;
    case "mostBalls": {
      let best = -1;
      let most = 0;
      for (const [team, k] of run.teamCounts()) if (k > most) [best, most] = [team, k];
      return best;
    }
    case "highestTier": {
      let best: WorldBall | null = null;
      for (const b of run.world.balls) if (b.alive && (!best || b.tier > best.tier)) best = b;
      return best ? best.team : -1;
    }
    case "lastBall": {
      let only: WorldBall | null = null;
      let n = 0;
      for (const b of run.world.balls)
        if (b.alive) {
          n++;
          only = b;
        }
      return n === 1 && only ? only.team : -1;
    }
    default:
      return -1;
  }
}

function finish(run: BlueprintRun, reason: FinishReason, condition: number) {
  const winner = winnerTeam(run);
  const template = reason === "condition" ? run.bp.finish.any[condition].say || DEFAULT_SAY[run.bp.finish.any[condition].when] : reason === "timeout" ? run.bp.finish.timeoutSay : "STOPPED";
  run.done = { finished: true, reason, condition, timeSec: run.timeSec, winner, result: fillResult(run, template, winner) };
  run.onFinish();
}

/** A result line with its placeholders filled. */
export function fillResult(run: BlueprintRun, template: string, winner: number): string {
  const num = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const names = run.bp.look.teamNames;
  return template.replace(/\{([a-z][a-z0-9]{0,7})\}/g, (whole, key: string) => {
    switch (key) {
      case "winner":
        return winner >= 0 ? (names[winner] ?? `Team ${winner + 1}`) : "Nobody";
      case "time":
        return `${run.timeSec.toFixed(1)} s`;
      case "balls":
      case "escaped":
      case "tier":
      case "tiles":
      case "rings":
        return num(run.count(key));
      default:
        return run.compiled.varIndex.has(key) ? num(run.count(key)) : whole;
    }
  });
}
