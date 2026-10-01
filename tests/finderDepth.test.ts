import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FINDER_DEPTH_BUDGET_MS, FINDER_FRAME_BUDGET_MS, findSimulation, type FinderProgress, type FinderRequest } from "@/lib/simulation/finder";
import { findSimulationBudgeted, FINDER_TIME_BUDGET_MS } from "@/lib/simulation/unlimitedFinder";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings } from "@/lib/settings";
import { seedProgressLine } from "@/components/simulator/desktop/studioPorts";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- finder-depth --- A run-length search whose first `maxSeeds` seeds found nothing goes on past them – the same seed order,
 * frame by frame – while the whole search has taken less than `depthBudgetMs` of wall-clock time. The clock and the frame
 * scheduler are injected: every frame moves the clock on by a fixed step and never within a frame, so a frame simulates its
 * whole batch (50 seeds) and the search is deterministic (Date.now is pinned, so the seeds are too).
 */

/** Shatter's default runs last ~3–35 s: a 6 s target lies inside them, and a seed costs a few ms. */
function request(patch: Partial<FinderRequest> = {}): FinderRequest {
  const s = defaultSettings("shatter");
  return { ...finderRequestOfSettings(s, { width: 800, height: 450 }, 10), targetDurationSec: 6.001, toleranceSec: 0.0001, maxSeeds: 10, ...patch };
}

/** A clock that moves `msPerFrame` on at every frame (and not within one), and the scheduler that does it. */
function frames(msPerFrame: number) {
  const state = { t: 0, frames: 0 };
  return {
    state,
    now: () => state.t,
    schedule: (fn: () => void) => {
      state.t += msPerFrame;
      state.frames++;
      setTimeout(fn, 0);
    },
  };
}

describe("finder-depth: the run-length search goes on past maxSeeds while its wall-clock budget lasts", () => {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(424_242);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a 25 s budget, apart from the frame slice and the No limits search's own budget", () => {
    expect(FINDER_DEPTH_BUDGET_MS).toBe(25_000);
    expect(FINDER_FRAME_BUDGET_MS).toBe(30);
    expect(FINDER_TIME_BUDGET_MS).toBe(60_000);
  });

  it("goes deeper when the first pass of a cheap search finds nothing, and stops once the budget is spent", async () => {
    // A target no run can hit (the run lengths are whole 1/60 s steps): only the budget ends the search.
    const clock = frames(10_000);
    const progress: FinderProgress[] = [];
    const result = await findSimulation(request({ depthBudgetMs: FINDER_DEPTH_BUDGET_MS }), (p) => progress.push(p), undefined, clock.now, clock.schedule);
    // Frame 1 (10 s in): the first 10 seeds, then on – frame 2 (20 s): 50 more – frame 3 (30 s): 50 more, out of time.
    expect(result.found).toBe(false);
    expect(result.seedsTested).toBe(110);
    expect(clock.state.frames).toBe(3);
    expect(clock.state.t).toBeGreaterThanOrEqual(FINDER_DEPTH_BUDGET_MS);
    // The progress says how deep and how long: the seeds, the seeds the budget holds at this pace, the time left. A search
    // out of time reports nothing more – its result carries the seeds it tested.
    expect(progress.map((p) => [p.seedsTested, p.maxSeeds, p.depthLeftMs])).toEqual([
      [10, 25, 15_000],
      [60, 75, 5_000],
    ]);
    for (const p of progress) expect(p.seedsTested).toBeLessThanOrEqual(p.maxSeeds);
    // The closest run it saw is the result's, as ever.
    expect(result.duration).toBeGreaterThan(5);
    expect(result.duration).toBeLessThan(7);
  });

  it("stops after maxSeeds as before when the first pass already took longer than the budget (a heavy mode)", async () => {
    const clock = frames(30_000);
    const progress: FinderProgress[] = [];
    const result = await findSimulation(request({ depthBudgetMs: FINDER_DEPTH_BUDGET_MS }), (p) => progress.push(p), undefined, clock.now, clock.schedule);
    expect([result.found, result.seedsTested, clock.state.frames]).toEqual([false, 10, 1]);
    expect(progress.map((p) => [p.seedsTested, p.maxSeeds, p.depthLeftMs])).toEqual([[10, 10, undefined]]);
  });

  it("never goes deeper without a budget: exactly maxSeeds seeds (the reproducible search)", async () => {
    for (const depthBudgetMs of [undefined, 0, -1, Number.NaN]) {
      const clock = frames(1);
      const progress: FinderProgress[] = [];
      const result = await findSimulation(request({ depthBudgetMs }), (p) => progress.push(p), undefined, clock.now, clock.schedule);
      expect([result.found, result.seedsTested]).toEqual([false, 10]);
      expect(progress.at(-1)).toMatchObject({ seedsTested: 10, maxSeeds: 10 });
      expect(progress.every((p) => p.depthLeftMs === undefined)).toBe(true);
    }
    // A first pass of no seeds has no runs to go deeper from: nothing is simulated, with or without a budget.
    const clock = frames(1);
    expect(await findSimulation(request({ maxSeeds: 0, depthBudgetMs: FINDER_DEPTH_BUDGET_MS }), () => {}, undefined, clock.now, clock.schedule)).toEqual({ found: false, seed: 0, duration: 0, seedsTested: 0 });
    expect(clock.state.frames).toBe(1);
  });

  it("does not go deeper when the runs seen all end on one side of the target (out of reach: more seeds would only spend the budget)", async () => {
    // Every default Shatter run ends well before 60 s – and every one outlasts a 1 s target.
    for (const targetDurationSec of [60, 1]) {
      const clock = frames(1_000);
      const result = await findSimulation(request({ targetDurationSec, toleranceSec: 0.5, maxSimTimeSec: targetDurationSec + 30, depthBudgetMs: FINDER_DEPTH_BUDGET_MS }), () => {}, undefined, clock.now, clock.schedule);
      expect([targetDurationSec, result.found, result.seedsTested, clock.state.frames]).toEqual([targetDurationSec, false, 10, 1]);
    }
  });

  it("never changes a match the first pass finds, and a match found deeper is the one a larger maxSeeds finds", async () => {
    const hit = request({ targetDurationSec: 6, toleranceSec: 0.5 });
    const plain = await findSimulation({ ...hit, maxSeeds: 1000 }, () => {}, undefined, frames(1).now, frames(1).schedule);
    expect(plain.found).toBe(true);
    // Pinned seeds: the first match is the 12th seed – inside a first pass of 20, past one of 10.
    expect(plain.seedsTested).toBe(12);
    const inFirstPass = await findSimulation({ ...hit, maxSeeds: 20, depthBudgetMs: FINDER_DEPTH_BUDGET_MS }, () => {}, undefined, frames(1).now, frames(1).schedule);
    expect(inFirstPass).toEqual(plain);
    const withoutBudget = await findSimulation({ ...hit, maxSeeds: 20 }, () => {}, undefined, frames(1).now, frames(1).schedule);
    expect(withoutBudget).toEqual(plain);
    // A first pass of 10 misses it; going deeper finds the same seed (same order, same count), well inside the budget.
    const clock = frames(1_000);
    const progress: FinderProgress[] = [];
    const deeper = await findSimulation({ ...hit, depthBudgetMs: FINDER_DEPTH_BUDGET_MS }, (p) => progress.push(p), undefined, clock.now, clock.schedule);
    expect(deeper).toEqual(plain);
    expect(progress.map((p) => [p.seedsTested, p.depthLeftMs])).toEqual([[10, 24_000]]);
    // Without the budget the first pass of 10 is all there is.
    expect(await findSimulation(hit, () => {}, undefined, frames(1).now, frames(1).schedule)).toMatchObject({ found: false, seedsTested: 10 });
  });

  it("stops at once when cancelled while going deeper", async () => {
    for (const abortAt of [1, 2]) {
      const clock = frames(5_000);
      const controller = new AbortController();
      const progress: FinderProgress[] = [];
      const result = await findSimulation(
        request({ depthBudgetMs: FINDER_DEPTH_BUDGET_MS }),
        (p) => {
          progress.push(p);
          if (progress.filter((q) => q.depthLeftMs !== undefined).length === abortAt) controller.abort();
        },
        controller.signal,
        clock.now,
        clock.schedule,
      );
      // The frame after the abort resolves without simulating another seed, and nothing is reported after it.
      const tested = abortAt === 1 ? 10 : 60;
      expect([result.found, result.seedsTested, progress.length, clock.state.frames]).toEqual([false, tested, abortAt, abortAt + 1]);
    }
  });

  it("is the plain search's only: the time-sliced No limits search keeps its own budget and its seed count", async () => {
    const engaged = { ...request({ depthBudgetMs: FINDER_DEPTH_BUDGET_MS }), physicsConfig: { ...request().physicsConfig, unlimited: true } };
    let t = 0;
    const progress: FinderProgress[] = [];
    // Every clock read is 0.1 ms: cheap steps, so all 10 seeds fit its budget – and it tests those 10, never more.
    const result = await findSimulationBudgeted(engaged, (p) => progress.push(p), undefined, () => (t += 0.1), (fn) => setTimeout(fn, 0));
    expect([result.found, result.seedsTested, result.limitedSeeds]).toEqual([false, 10, undefined]);
    expect(progress.every((p) => p.depthLeftMs === undefined && p.maxSeeds === 10)).toBe(true);
  });
});

describe("finder-depth: the progress line while going deeper", () => {
  it("has the seeds and the seconds left in every language (the canvas overlay and the panel)", () => {
    const catalogs = { en, pl, es } as unknown as Record<string, Record<"Simulator" | "Controls", Record<string, string>>>;
    for (const [lang, m] of Object.entries(catalogs)) {
      for (const ns of ["Simulator", "Controls"] as const) {
        const line = m[ns].seedProgressDeeper;
        expect([lang, ns, line.includes("{tested}"), line.includes("{left}"), line.includes("{max}")]).toEqual([lang, ns, true, true, false]);
      }
    }
  });

  it("the desktop studio's find tool says the same in numbers", () => {
    const p: FinderProgress = { seedsTested: 1450, maxSeeds: 3100, currentSeed: 1, bestDuration: 29.2, bestSeed: 1 };
    expect(seedProgressLine({ ...p, maxSeeds: 300, seedsTested: 120 })).toBe("120/300");
    expect(seedProgressLine({ ...p, depthLeftMs: 12_300 })).toBe("1450 (+13 s)");
  });
});
