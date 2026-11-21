import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { DEFAULT_FIND_SEC, clipPacingDefaults, clipPacingFindSec } from "@/lib/clipPacing";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { MODE_IDS, type ModeId, type SoundEvent } from "@/lib/physics/types";
import { defaultSettings, settingsFromSearchParams } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { BULLSEYE_CARD_MS, bullseyeCardShown } from "@/components/simulator/bullseyeRenderer";
import { EARLY_PODIUM_MS, podiumAtMs, podiumShown } from "@/components/simulator/raceRenderer";
import { IN_PHASE_SHOW_MS } from "@/components/simulator/orbGridRenderer";
import { IN_PHASE_HOLD_MS } from "@/lib/physics/modes/orbRhythm";

/*
 * --- finales-in-clip --- (review fix B6) The fixes of the B6 review, on the page's own defaults (lib/clipPacing.ts):
 *  - finder-target: Find Simulation's target is the paced mode's own run length while the run is at its page pace, and the
 *    default runs land on it;
 *  - bullseye: the final card waits for a BULLSEYE! of the last shots;
 *  - paddle-drums: a kick on every catch, a hat at the top of every flight and as a ball comes in – never a long silence;
 *  - vortex-finale: the ring release's last marble down the hole is marked (doneMs) with a deep pew and a closing chord;
 *  - race: the podium 1.5 s after the third racer home, while the stragglers still race;
 *  - Paddle's win card is plural-aware in en, pl and es.
 */

const WORLD = { width: 800, height: 600 };

function engineOf(query: string, seed: number, world = WORLD, maxSec = 70) {
  const request = finderRequestOfSettings(settingsFromSearchParams(new URLSearchParams(query)), world, maxSec);
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

/** Runs to the end (or `maxSec`), logging the sound events with their time (ms). */
function runLogged(engine: ReturnType<typeof engineOf>, maxSec = 70): { atMs: number; ev: SoundEvent }[] {
  const out: { atMs: number; ev: SoundEvent }[] = [];
  for (let frame = 1; frame <= maxSec * 60 && !engine.isSimulationFinished(); frame++) {
    engine.update(1000 / 60, 0);
    for (const ev of engine.consumeSoundEvents()) out.push({ atMs: engine.getElapsedMs(), ev });
  }
  return out;
}

function endOf(mode: ModeId, seed: number, world = WORLD, maxSec = 45): number {
  const request = finderRequestOfSettings(defaultSettings(mode), world, maxSec);
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  for (let frame = 1; frame <= maxSec * 60; frame++) {
    engine.update(1000 / 60, 0);
    engine.consumeSoundEvents();
    if (engine.isSimulationFinished()) return frame / 60;
  }
  return -1;
}

// --- finder-target ---
describe("--- finder-target --- Find Simulation's target on a paced mode's page pace", () => {
  it("is the mode's own run length at its page pace, and the page's 30 everywhere else", () => {
    const own: Partial<Record<ModeId, number>> = { target: 20, colorMatch: 22, pendulum: 24, polyrhythm: 24, mergeRing: 23, spiralGlass: 24, shatter: 15, runner: 22, vortex: 22.5, bullseye: 25, race: 22, journey: 21, maze: 15, paddle: 28 };
    for (const mode of MODE_IDS) expect([mode, clipPacingFindSec(defaultSettings(mode))]).toEqual([mode, own[mode] ?? DEFAULT_FIND_SEC]);
    // every mode with a target is paced, and Territory (a 30 s countdown) keeps the page's 30
    for (const mode of Object.keys(own) as ModeId[]) expect(Object.keys(clipPacingDefaults(mode)).length, mode).toBeGreaterThan(0);
    expect(clipPacingFindSec(defaultSettings("territory"))).toBe(30);
    // a link that sets its own course keeps the page's 30; the ring modes' glow is a look, not a pace
    expect(clipPacingFindSec(settingsFromSearchParams(new URLSearchParams("mode=runner&rrn=24&rrd=0.6")))).toBe(30);
    expect(clipPacingFindSec(settingsFromSearchParams(new URLSearchParams("mode=paddle&pdg=0")))).toBe(30);
    expect(clipPacingFindSec(settingsFromSearchParams(new URLSearchParams("mode=vortex&vxrl=stagger")))).toBe(30);
    expect(clipPacingFindSec({ ...defaultSettings("target"), showGlow: false })).toBe(20);
    expect(clipPacingFindSec({ ...defaultSettings("target"), targetCount: 10 })).toBe(30);
  });

  // measured when this was written (seeds 1–40, the finder's 800 × 600 world): runner 10 runs within 22 ± 0.5 s, paddle 11 within
  // 28, bullseye 11 within 25, journey 6 within 21, maze 6 within 15, race 11 within 22 – none of them had one within 30 ± 0.5
  it("lands default runs on the target, where the page's 30 found none", { timeout: 240_000 }, () => {
    for (const mode of ["runner", "paddle", "bullseye", "journey", "maze", "race"] as const) {
      const target = clipPacingFindSec(defaultSettings(mode));
      const ends: number[] = [];
      for (let seed = 1; seed <= 20; seed++) ends.push(endOf(mode, seed));
      const near = (t: number) => ends.filter((e) => e > 0 && Math.abs(e - t) <= 0.5).length;
      expect([mode, near(target) >= 2]).toEqual([mode, true]);
      expect([mode, near(target) > near(30)]).toEqual([mode, true]);
    }
  });
});

// --- bullseye: the final card after the last shot's BULLSEYE! ---
describe("--- finales-in-clip --- (review fix) Bullseye's final card waits for a BULLSEYE! of the last shots", () => {
  it("comes up BULLSEYE_CARD_MS after the last shot's bullseye, and at once after a last shot elsewhere", () => {
    const view = { allLanded: true, timeMs: 20_000, bullseyeMs: 20_000 };
    expect(bullseyeCardShown(view)).toBe(false);
    expect(bullseyeCardShown({ ...view, timeMs: 20_000 + BULLSEYE_CARD_MS - 1 })).toBe(false);
    expect(bullseyeCardShown({ ...view, timeMs: 20_000 + BULLSEYE_CARD_MS })).toBe(true);
    expect(bullseyeCardShown({ ...view, bullseyeMs: 12_000 })).toBe(true);
    expect(bullseyeCardShown({ ...view, bullseyeMs: -Infinity })).toBe(true);
    expect(bullseyeCardShown({ ...view, allLanded: false, bullseyeMs: -Infinity })).toBe(false);
  });

  it("shows the card on the page's default runs before the run ends: the last shot is the bull's", () => {
    for (let seed = 1; seed <= 4; seed++) {
      const engine = engineOf("mode=bullseye", seed);
      let cardAt = -1;
      let bullAt = -1;
      for (let frame = 1; frame <= 40 * 60 && !engine.isSimulationFinished(); frame++) {
        engine.update(1000 / 60, 0);
        const v = engine.getBullseyeView();
        if (v.allLanded && bullAt < 0) bullAt = v.bullseyeMs;
        if (cardAt < 0 && bullseyeCardShown(v)) cardAt = v.timeMs;
      }
      const v = engine.getBullseyeView();
      expect([seed, v.finished, v.shotRing[v.shots - 1]]).toEqual([seed, true, 0]);
      expect(cardAt - bullAt, `seed ${seed}`).toBeGreaterThanOrEqual(BULLSEYE_CARD_MS - 1000 / 60);
      expect(v.timeMs - cardAt, `seed ${seed}`).toBeGreaterThan(800); // (the card holds through the rest of the run's hold)
    }
  });
});

// --- paddle-drums ---
describe("--- paddle-drums --- Paddle Keep-Up's beat", () => {
  it("plays a kick on every catch and a hat at the top of every flight, sounds of their own, never more than 1.6 s apart in play", () => {
    for (const seed of [3, 7, 12]) {
      const engine = engineOf("mode=paddle", seed);
      const log = runLogged(engine);
      const view = engine.getPaddleView();
      const drums = log.filter((s) => s.ev.bdDrum);
      expect(drums.every((s) => s.ev.ringVoice === "extra" && s.ev.melody === false)).toBe(true);
      const kicks = drums.filter((s) => s.ev.bdDrum === "kick");
      const hats = drums.filter((s) => s.ev.bdDrum === "hat");
      // a kick per catch (the catches after the goal included: the ball keeps bouncing under the win card)
      const catches = log.filter((s) => s.ev.frequency !== undefined && !s.ev.bdDrum && s.ev.melody !== false && !s.ev.chord);
      expect([seed, kicks.length]).toEqual([seed, catches.length]);
      expect(kicks.length).toBeGreaterThanOrEqual(view.hits);
      // a hat at the top of every flight that turns below the ceiling (one that reaches it plays the ceiling's note instead)
      expect(hats.length + view.ceilingHits).toBeGreaterThanOrEqual(kicks.length - 1);
      // never more than 1.6 s without a sound until the game is over
      const until = 1000 * view.overSec;
      const times = log.filter((s) => s.atMs <= until).map((s) => s.atMs);
      let gap = 0;
      for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i] - times[i - 1]);
      expect([seed, gap <= 1600]).toEqual([seed, true]);
    }
  });

  it("leaves the run where it was: the same catches, misses and end with the drums", () => {
    const a = engineOf("mode=paddle", 5);
    runLogged(a);
    const b = engineOf("mode=paddle", 5);
    for (let frame = 1; frame <= 70 * 60 && !b.isSimulationFinished(); frame++) b.update(1000 / 60, 0);
    const [va, vb] = [a.getPaddleView(), b.getPaddleView()];
    expect([va.hits, va.misses, va.overSec, va.wallHits]).toEqual([vb.hits, vb.misses, vb.overSec, vb.wallHits]);
  });
});

// --- vortex-finale ---
describe("--- vortex-finale --- the ring release's last marble down the hole", () => {
  it("is marked before the run's end with a deep pew and a closing chord, on the page's default", () => {
    const engine = engineOf("mode=vortex", 7);
    const log = runLogged(engine, 40);
    const v = engine.getVortexView();
    expect(v.finished).toBe(true);
    expect(v.swallowed).toBe(42);
    const done = v.funnel.doneMs;
    expect(done).toBeGreaterThan(15_000);
    expect(done).toBeLessThan(v.finishedMs);
    const atDone = log.filter((s) => Math.abs(s.atMs - done) <= 1000 / 60 + 1e-6);
    expect(atDone.some((s) => s.ev.pew && s.ev.accent)).toBe(true);
    expect(atDone.some((s) => (s.ev.chord?.length ?? 0) >= 3 && s.ev.accent)).toBe(true);
    // the stagger release's own flag stays the stagger's
    expect(v.allSwallowed).toBe(false);
  });

  it("never marks a looping ring release", () => {
    const engine = engineOf("mode=vortex&vxl=1", 7);
    for (let frame = 1; frame <= 30 * 60; frame++) engine.update(1000 / 60, 0);
    expect(engine.getVortexView().funnel.doneMs).toBe(-1);
  });
});

// --- race: the podium ahead of the stragglers ---
describe("--- finales-in-clip --- (review fix) the Race podium 1.5 s after the third racer home", () => {
  it("comes up 1.5 s after third place on the page's races, at the latest at the race's end, the run unchanged", () => {
    const gaps: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const engine = engineOf("mode=race", seed);
      let shownAt = -1;
      for (let frame = 1; frame <= 60 * 60 && !engine.isSimulationFinished(); frame++) {
        engine.update(1000 / 60, 0);
        const v = engine.getRaceView();
        if (shownAt < 0 && podiumShown(v, v.timeMs)) shownAt = v.timeMs;
      }
      const v = engine.getRaceView();
      const at = podiumAtMs(v);
      expect(at, `seed ${seed}`).toBeLessThanOrEqual(v.completeAtMs);
      if (v.racers > 3 && v.finishOrder.length >= 3) {
        const third = v.goAtMs + v.finishMs[v.finishOrder[2]];
        expect(at, `seed ${seed}`).toBe(Math.min(third + EARLY_PODIUM_MS, v.completeAtMs));
      }
      expect(Math.abs(shownAt - at), `seed ${seed}`).toBeLessThanOrEqual(1000 / 60 + 1e-6);
      gaps.push((at - v.winnerAtMs) / 1000);
    }
    // the podium after the win: at most about 5 s on these seeds (before: 2.7–8.8 s, a median of about 5 s)
    expect(Math.max(...gaps)).toBeLessThan(6);
  });
});

// --- orbs: the IN PHASE card ---
describe("--- finales-in-clip --- (review fix) the IN PHASE card", () => {
  it("is drawn longer than the mode's own hold, which stays (its finish reason and data attribute)", () => {
    expect(IN_PHASE_HOLD_MS).toBe(1800);
    expect(IN_PHASE_SHOW_MS).toBe(4000);
    expect(26 + IN_PHASE_SHOW_MS / 1000).toBe(30); // the page's 26 s cycle: the card stays to the 30 s clip's end
  });
});

// --- paddle: the win card's plural ---
describe("--- finales-in-clip --- (review fix) Paddle's win card counts in each language", () => {
  it("says one catch and the Polish few and many", () => {
    const fmt = (messages: { JdmRhythm: { win: string } }, locale: string, n: number) => String(new IntlMessageFormat(messages.JdmRhythm.win, locale).format({ n }));
    expect([fmt(en, "en", 1), fmt(en, "en", 20)]).toEqual(["1 CATCH!", "20 CATCHES!"]);
    expect([fmt(pl, "pl", 1), fmt(pl, "pl", 22), fmt(pl, "pl", 20), fmt(pl, "pl", 25)]).toEqual(["1 ZŁAPANIE!", "22 ZŁAPANIA!", "20 ZŁAPAŃ!", "25 ZŁAPAŃ!"]);
    expect([fmt(es, "es", 1), fmt(es, "es", 20)]).toEqual(["¡1 ATRAPADA!", "¡20 ATRAPADAS!"]);
  });
});
