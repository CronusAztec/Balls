import { afterEach, describe, expect, it, vi } from "vitest";
import { settingsFromSearchParams } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { resolveStringBattleSettings, stringBattleSettingsOf, timeoutLeaders, type StringBattleSettings } from "@/lib/physics/modes/stringBattle";
import { DEFAULT_STRING_CIRCLE_SETTINGS, SC_STEADY_MS, createCircleState, steadyLeaders, updateSteadyShare } from "@/lib/physics/modes/stringCircle";
import { DEFAULT_STRING_CIRCLE_LABELS, StringCircleLayer, verdictShares, type StringCircleRenderOptions } from "@/components/simulator/stringCircleRenderer";
import { DEFAULT_STRING_BATTLE_LABELS, SB_FINALE_PULSE, StringBattleLayer, type StringBattleRenderOptions } from "@/components/simulator/stringBattleRenderer";

/*
 * --- verdict-freeze --- --- steady-verdict --- --- calm-finale --- String Battle's verdict (lane B, round two, B2):
 *
 *  - the circle style's winner banner reads one "[pct]% OF THE RIM" through the end hold, the share the verdict was taken on,
 *    while the winner's fan goes on painting the rim (it read 73 % -> 46 % on the card before);
 *  - the steady clip-limit verdict behind the battle's `steady` flag: off at the link base (no link, preset or plan sets it, so
 *    the card's seeds name today's winners), and with it on the averaged rim decides a verdict that holds through the clip's
 *    last 0.5 s;
 *  - the finale's halos and ring pulse smoothly, slower than 3 times a second (a hard ~12 Hz strobe and a ~7 Hz ring before).
 */

const CARD = "mode=stringBattle&glow=1&trails=1&wglow=1&sbst=circle&sbh=0&sbd=25";
const STEP = 1000 / 60;
const WORLDS = [
  { width: 800, height: 450 },
  { width: 450, height: 450 },
];
/** The card's winners on seeds 1–12 with the flag off (both worlds alike): today's verdict, measured before the change. */
const CARD_WINNERS = [0, 0, 1, 3, 2, 0, 2, 0, 1, 2, 1, 3];

function card(seed: number, world = WORLDS[0], patch: Partial<StringBattleSettings> = {}, forcedWinner?: number) {
  const s = settingsFromSearchParams(new URLSearchParams(CARD));
  const ms = modeSettingsOfSettings(s);
  ms.stringBattle = { ...ms.stringBattle, ...patch };
  const cfg = physicsConfigOfSettings(s, world);
  return createEngineForSettings(forcedWinner === undefined ? cfg : { ...cfg, forcedWinner }, "stringBattle", ms, seed);
}

function step(engine: ReturnType<typeof card>) {
  engine.update(STEP, 0);
  engine.consumeSoundEvents();
}

function noopCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: 7 * String(text).length }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  };
  const ctx = new Proxy(target, {
    get: (t, key) => (typeof key === "string" && !(key in t) ? (t[key] = () => {}) : t[key as string]),
    set: (t, key, value) => {
      t[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  if (typeof globalThis.document === "undefined") vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  return ctx;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("--- verdict-freeze --- String Circle's winner banner", () => {
  it("reads the share the verdict was taken on from the first frame of the end hold to its last, while the rim goes on changing", { timeout: 120_000 }, () => {
    let moved = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const engine = card(seed);
      const v = engine.getStringBattleView();
      while (!v.finished) step(engine);
      const c = v.circle!;
      expect(v.finishedMs).toBeCloseTo(25_000, 6);
      expect(c.verdictShares).not.toBeNull();
      const layer = new StringCircleLayer();
      const ctx = noopCtx();
      const o: StringCircleRenderOptions = { dpr: 1, roster: [], showNames: false, wallThickness: 2, labels: DEFAULT_STRING_CIRCLE_LABELS, nowMs: 0, width: 800, height: 450 };
      const lines: string[] = [];
      const live = new Set<number>();
      // the hold: the banner's first frame (250 ms after the finish), then every 0.5 s to its last (3.9 s)
      for (const at of [250, 500, 1000, 1500, 2000, 2500, 3000, 3500, 3900]) {
        while (engine.getElapsedMs() - v.finishedMs < at) step(engine);
        layer.drawStage(ctx, v, engine.getBalls(), { ...o, nowMs: engine.getElapsedMs() });
        layer.drawOverlay(ctx, v, { ...o, nowMs: engine.getElapsedMs() }, { inset: 0, dtMs: STEP, teamBanner: false });
        expect(layer.bannerDrawn).toBe(true);
        lines.push(layer.verdictLine);
        if (v.winner >= 0) live.add(Math.round(100 * c.coverage.share[v.winner]));
      }
      expect(new Set(lines).size).toBe(1);
      const winner = v.winner;
      expect(lines[0]).toBe(winner >= 0 ? DEFAULT_STRING_CIRCLE_LABELS.rim(Math.round(100 * c.verdictShares![winner])) : "");
      // the overlay's shares are the frozen ones (the strip reads them too); the live rim is the fans' painting
      expect(Array.from(verdictShares(v))).toEqual(Array.from(c.verdictShares!));
      if (live.size > 1) moved++;
    }
    // the fans repaint the rim through the hold on most seeds: the number the banner used to follow
    expect(moved).toBeGreaterThanOrEqual(8);
  });

  it("shows the live shares while the battle goes on and starts every battle unfrozen", () => {
    const engine = card(1);
    const v = engine.getStringBattleView();
    for (let i = 0; i < 120; i++) step(engine);
    expect(v.circle!.verdictShares).toBeNull();
    expect(verdictShares(v)).toBe(v.circle!.coverage.share);
    while (!v.finished) step(engine);
    expect(v.circle!.verdictShares).not.toBeNull();
    engine.initStringBattle();
    expect(engine.getStringBattleView().circle!.verdictShares).toBeNull();
  });
});

describe("--- steady-verdict --- String Circle's steady clip-limit verdict", () => {
  it("is off at the link base: no link, default or card sets the flag, and nothing is averaged", () => {
    expect("steady" in resolveStringBattleSettings({})).toBe(false);
    expect("steady" in resolveStringBattleSettings({ style: "circle", duration: 25 })).toBe(false);
    const s = settingsFromSearchParams(new URLSearchParams(CARD));
    expect("steady" in stringBattleSettingsOf(s)).toBe(false);
    expect("steady" in (modeSettingsOfSettings(s).stringBattle ?? {})).toBe(false);
    expect(resolveStringBattleSettings({ steady: true }).steady).toBe(true);
    expect(resolveStringBattleSettings({ steady: "yes" as unknown as boolean })).not.toHaveProperty("steady");
    expect(createCircleState(4, DEFAULT_STRING_CIRCLE_SETTINGS).steadyShare).toBeNull();
    // the flag needs a clip limit: without one the last flag standing wins and nothing is averaged
    const endless = card(1, WORLDS[0], { steady: true, duration: 0 });
    for (let i = 0; i < 60; i++) step(endless);
    expect(endless.getStringBattleView().circle!.steadyShare).toBeNull();
  });

  it("with the flag off, the card's seeds 1–12 name today's winners in both worlds", { timeout: 120_000 }, () => {
    for (const world of WORLDS) {
      const winners: number[] = [];
      for (let seed = 1; seed <= 12; seed++) {
        const engine = card(seed, world);
        const v = engine.getStringBattleView();
        while (!v.finished) step(engine);
        expect(v.circle!.steadyShare).toBeNull();
        winners.push(v.winner);
      }
      expect(winners).toEqual(CARD_WINNERS);
    }
  });

  it("with the flag on, takes a verdict on the averaged rim that does not flip in the clip's last 0.5 s", { timeout: 120_000 }, () => {
    let differs = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const engine = card(seed, WORLDS[0], { steady: true });
      const v = engine.getStringBattleView();
      const leads: string[] = [];
      while (!v.finished) {
        step(engine);
        const c = v.circle!;
        expect(c.steadyShare).not.toBeNull();
        if (!v.finished) leads.push(steadyLeaders(timeoutLeaders(v.fighters, v.forcedWinner, "lives"), c.steadyShare!).join("+"));
      }
      expect(v.finishedMs).toBeCloseTo(25_000, 6);
      const last = leads.slice(-30); // the last 0.5 s of the clip (30 steps)
      expect([seed, new Set(last).size]).toEqual([seed, 1]);
      expect([seed, v.winner]).toEqual([seed, Number(last[last.length - 1])]);
      // the banner shows the averaged share the verdict was taken on
      expect(Array.from(v.circle!.verdictShares!)).toEqual(Array.from(v.circle!.steadyShare!));
      if (v.winner !== CARD_WINNERS[seed - 1]) differs++;
    }
    expect(differs).toBeGreaterThan(0); // (seeds 2, 5 and 12: today's verdict went to the most live strings or one step's rim)
  });

  it("keeps the rig's hard constraint: the chosen ball takes a steady verdict", { timeout: 60_000 }, () => {
    for (const chosen of [1, 2]) {
      const engine = card(2, WORLDS[0], { steady: true }, chosen);
      const v = engine.getStringBattleView();
      while (!v.finished) step(engine);
      expect([chosen, v.winner]).toEqual([chosen, chosen]);
    }
  });

  it("averages the rim with a time constant of SC_STEADY_MS, the same at any step length, and ranks by it", () => {
    const avg = new Float64Array(2);
    const share = new Float64Array([1, 0.25]);
    for (let t = 0; t < SC_STEADY_MS - 1e-9; t += STEP) updateSteadyShare(avg, share, STEP);
    expect(avg[0]).toBeGreaterThan(0.62);
    expect(avg[0]).toBeLessThan(0.64);
    expect(avg[1]).toBeCloseTo(0.25 * avg[0], 12);
    for (let t = 0; t < 10 * SC_STEADY_MS; t += STEP) updateSteadyShare(avg, share, STEP);
    expect(avg[0]).toBeCloseTo(1, 3);
    updateSteadyShare(avg, new Float64Array([0, 0]), 0);
    expect(avg[0]).toBeCloseTo(1, 3);
    expect(steadyLeaders([0, 1], avg)).toEqual([0]);
    expect(steadyLeaders([1], avg)).toEqual([1]);
    expect(steadyLeaders([0, 1], new Float64Array([0.3, 0.3]))).toEqual([0, 1]);
  });
});

describe("--- calm-finale --- String Battle's finale pulse", () => {
  it("pulses the halos and the ring smoothly, slower than 3 times a second", () => {
    expect((SB_FINALE_PULSE * 1000) / (2 * Math.PI)).toBeLessThan(3);
    // a web-style duel is in its finale from the start (two balls): record the halos' alpha frame by frame
    const engine = createEngineForSettings(
      { width: 800, height: 450, gravity: 0, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 },
      "stringBattle",
      { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {}, stringBattle: { style: "web", balls: 2 } },
      5,
    );
    for (let i = 0; i < 30; i++) step(engine);
    const v = engine.getStringBattleView();
    expect([v.finale, v.finished]).toEqual([true, false]);
    const alphas: number[] = [];
    let haloAlpha = -1;
    const base = noopCtx();
    const ctx = new Proxy(base as unknown as Record<string, unknown>, {
      get: (t, key) => (key === "drawImage" ? () => void (haloAlpha < 0 && (haloAlpha = t.globalAlpha as number)) : (t as Record<string, unknown>)[key as string]),
      set: (t, key, value) => {
        t[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    const layer = new StringBattleLayer();
    const o: StringBattleRenderOptions = { dpr: 1, roster: [], showNames: false, wallThickness: 2, labels: DEFAULT_STRING_BATTLE_LABELS, nowMs: 0, simDtMs: STEP, contacts: null, width: 800, height: 450 };
    const t0 = engine.getElapsedMs();
    for (let k = 0; k < 120; k++) {
      const at = { ...o, nowMs: t0 + k * STEP };
      layer.drawStage(ctx, v, engine.getBalls(), at);
      haloAlpha = -1;
      layer.drawBodies(ctx, v, at);
      alphas.push(haloAlpha);
    }
    expect(layer.strobeFrames).toBe(120);
    // smooth: no frame jumps by more than a tenth (a strobe switched 1 <-> 0.25); slow: at most 3 swells in 2 s (it swelled about 24 times)
    let jump = 0;
    let swells = 0;
    for (let k = 1; k < alphas.length; k++) {
      jump = Math.max(jump, Math.abs(alphas[k] - alphas[k - 1]));
      if (k > 1 && alphas[k - 1] > alphas[k - 2] && alphas[k - 1] >= alphas[k]) swells++;
    }
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(Math.max(...alphas) - Math.min(...alphas)).toBeGreaterThan(0.4);
    expect(jump).toBeLessThan(0.1);
    expect(swells).toBeLessThanOrEqual(6);
  });
});
