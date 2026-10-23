import { describe, expect, it } from "vitest";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import type { PhysicsConfig } from "@/lib/physics/types";
import { TileField } from "@/lib/physics/tiles";
import { BANNER_POP_SEC, BlueprintDataset, BlueprintLayer, CLOCK_LAST_SEC, DEFAULT_BLUEPRINT_LABELS, LayerCache, RING_BREAK_SEC, RING_SHARDS, bannerPop, endTitle, mixHex, overlayPlacement, recorderSquare } from "@/components/simulator/blueprintRenderer";
import { encodeBlueprint, sanitizeBlueprint } from "@/lib/blueprint";
import { TilesLayer, crackHash, traceCracks } from "@/components/simulator/tilesRenderer";

/*
 * --- blueprint --- Mode Lab's canvas drawing (components/simulator/blueprintRenderer.ts) without a browser: the still
 * layers come from offscreen bitmaps (built once for a held geometry, rebuilt at once when the tiles change, never on a
 * rotated view), so a frame of a running game sets no blur on the page's canvas; a damaged tile cracks, one crack per shade,
 * the same lines every frame; the end banner pops in on the run's clock and says the catalog game's own line; the canvas'
 * dataset carries the banner and the HUD for the smoke test.
 */

const config: PhysicsConfig = { width: 800, height: 450, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

function engineFor(patch: Partial<SimulatorSettings>, seed = 1) {
  const settings = { ...defaultSettings("blueprint"), ...patch };
  return createEngineForSettings(config, "blueprint", modeSettingsOfSettings(settings) as ModeSettings, seed);
}

interface Recorded {
  calls: { name: string; args: unknown[] }[];
  sets: { prop: string; value: unknown }[];
}

/** A 2D context that records its calls and property writes; `transform` is what getTransform() answers (null: rotated). */
function fakeContext(transform: { a: number; b: number; c: number; d: number; e: number; f: number } | null = { a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 }) {
  const rec: Recorded = { calls: [], sets: [] };
  const state: Record<string, unknown> = { globalAlpha: 1, shadowBlur: 0, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "10px sans-serif" };
  const ctx = new Proxy(state, {
    get: (_t, prop: string) => {
      if (prop in state) return state[prop];
      if (prop === "getTransform") return () => transform ?? { a: 1, b: 0.5, c: -0.5, d: 1, e: 0, f: 0 };
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
      if (prop === "measureText") return (text: string) => ({ width: 10 * String(text).length });
      return (...args: unknown[]) => rec.calls.push({ name: prop, args });
    },
    set: (_t, prop: string, value) => {
      state[prop] = value;
      rec.sets.push({ prop, value });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, rec };
}

/** An offscreen canvas factory of fake canvases (each with its own recording context). */
function fakeCanvases() {
  const made: { canvas: HTMLCanvasElement; rec: Recorded }[] = [];
  const factory = (width: number, height: number) => {
    const { ctx, rec } = fakeContext();
    const canvas = { width, height, getContext: () => ctx } as unknown as HTMLCanvasElement;
    made.push({ canvas, rec });
    return canvas;
  };
  return { factory, made };
}

const blurs = (rec: Recorded) => rec.sets.filter((s) => s.prop === "shadowBlur" && Number(s.value) > 0).length;
const count = (rec: Recorded, name: string) => rec.calls.filter((c) => c.name === name).length;
const render = { wallAlpha: () => "#fff", wallThickness: 3, showWallGlow: true };

describe("blueprint renderer: still layers in bitmaps", () => {
  it("builds a layer once its geometry holds, blits it after, rebuilds at once for new content and draws live on a rotated view", () => {
    const { factory } = fakeCanvases();
    const cache = new LayerCache(factory);
    let paints = 0;
    const paint = () => void paints++;
    const live = fakeContext();
    // the first frame of a geometry draws live; the second (held) builds and blits
    expect(cache.draw(live.ctx, 400, 225, 200, "g1", "c1", paint)).toBe(false);
    expect(cache.draw(live.ctx, 400, 225, 200, "g1", "c1", paint)).toBe(true);
    expect(cache.draw(live.ctx, 400, 225, 200, "g1", "c1", paint)).toBe(true);
    expect([cache.builds, cache.blits, paints]).toEqual([1, 2, 1]);
    // new content (a tile hit) with the same geometry: rebuilt at once
    expect(cache.draw(live.ctx, 400, 225, 200, "g1", "c2", paint)).toBe(true);
    expect(cache.builds).toBe(2);
    // a new geometry (a resize in progress) draws live until it holds
    expect(cache.draw(live.ctx, 400, 300, 260, "g2", "c2", paint)).toBe(false);
    expect(cache.draw(live.ctx, 400, 300, 260, "g2", "c2", paint)).toBe(true);
    expect(cache.builds).toBe(3);
    // a rotated or skewed view: the bitmap cannot follow it
    const rotated = fakeContext(null);
    expect(cache.draw(rotated.ctx, 400, 300, 260, "g2", "c2", paint)).toBe(false);
    // no offscreen canvas at all (a test's Node): always live
    const none = new LayerCache(() => null);
    none.draw(live.ctx, 0, 0, 10, "g", "c", paint);
    expect(none.draw(live.ctx, 0, 0, 10, "g", "c", paint)).toBe(false);
  });

  it("sets no blur on the page's canvas in a running game's frames: the glows are in the bitmaps or gradients", () => {
    for (const blp of ["hatchery", "ringBreaker", "growEscape", "plinkoRace", "conquer", "tierClimb"]) {
      const engine = engineFor({ blPreset: blp });
      const view = engine.getBlueprintView();
      const { factory, made } = fakeCanvases();
      const layer = new BlueprintLayer(factory);
      let blurred = 0;
      for (let frame = 0; frame < 40; frame++) {
        engine.update(1000 / 60, 0);
        const { ctx, rec } = fakeContext();
        layer.drawWorld(ctx, view, render);
        layer.drawEffects(ctx, view);
        layer.drawOverlay(ctx, view, DEFAULT_BLUEPRINT_LABELS, 0);
        if (frame >= 1) blurred += blurs(rec);
      }
      expect(blurred, blp).toBe(0);
      // the still layer was built once (its glow blurred there, once), not every frame
      expect(layer.staticLayer.builds, blp).toBe(1);
      expect(layer.staticLayer.blits, blp).toBe(39);
      expect(made.length, blp).toBeGreaterThanOrEqual(1);
    }
  });

  it("redraws the tiles' bitmap only when a tile is hit or breaks", () => {
    const engine = engineFor({ blPreset: "hatchery" });
    const view = engine.getBlueprintView();
    const layer = new BlueprintLayer(fakeCanvases().factory);
    let versions = 0;
    let last = -1;
    for (let frame = 0; frame < 240; frame++) {
      engine.update(1000 / 60, 0);
      if (view.world!.tiles.version !== last) {
        versions++;
        last = view.world!.tiles.version;
      }
      layer.drawWorld(fakeContext().ctx, view, render);
    }
    expect(layer.tileLayer.blits).toBe(239);
    expect(layer.tileLayer.builds).toBeLessThanOrEqual(versions);
    expect(layer.tileLayer.builds).toBeLessThan(120);
  });
});

describe("blueprint renderer: effects on the run's clock", () => {
  it("shatters a broken ring into pieces for RING_BREAK_SEC, and never leaves it frozen on screen after the finish", () => {
    const engine = engineFor({ blPreset: "ringBreaker", blParams: "3" });
    const view = engine.getBlueprintView();
    const layer = new BlueprintLayer(fakeCanvases().factory);
    const shards = () => {
      const { ctx, rec } = fakeContext();
      layer.drawWorld(ctx, view, render);
      return count(rec, "moveTo");
    };
    let seen = 0;
    for (let i = 0; i < 60 * 60 && !view.result.finished; i++) {
      engine.update(1000 / 60, 0);
      seen = Math.max(seen, shards());
    }
    expect(view.result.finished).toBe(true);
    // a ring broke: its pieces were drawn (one move per piece)
    expect(seen).toBeGreaterThanOrEqual(RING_SHARDS);
    // the run's view keeps its clock through the hold: the last ring's pieces fade away, the frozen result time notwithstanding
    for (let i = 0; i < Math.ceil(60 * RING_BREAK_SEC) + 2; i++) engine.update(1000 / 60, 0);
    expect(view.clockSec).toBeGreaterThan(view.timeSec + RING_BREAK_SEC);
    expect(shards()).toBe(0);
  });
});

describe("blueprint renderer: cracks, trails, banner and dataset", () => {
  it("cracks a damaged tile with one crack per shade, the same lines every frame, all of them one stroke", () => {
    const f = new TileField(16);
    f.layoutGrid({ x: 0, y: 0, width: 400, height: 40, rows: 1, cols: 4, gap: 2, hp: 4 });
    f.build();
    const one = fakeContext();
    traceCracks(one.ctx, f, 0, 3);
    expect(count(one.rec, "moveTo")).toBe(3);
    expect(count(one.rec, "lineTo")).toBe(9);
    const again = fakeContext();
    traceCracks(again.ctx, f, 0, 3);
    expect(again.rec.calls).toEqual(one.rec.calls);
    const none = fakeContext();
    traceCracks(none.ctx, f, 0, 0);
    expect(none.rec.calls).toEqual([]);
    expect(crackHash(3, 1, 2)).toBe(crackHash(3, 1, 2));
    expect(crackHash(3, 1, 2)).toBeGreaterThanOrEqual(0);
    expect(crackHash(3, 1, 2)).toBeLessThan(1);
    // standing tiles: cracks only once a tile is damaged, in one more stroke
    const layer = new TilesLayer();
    const whole = fakeContext();
    layer.drawStanding(whole.ctx, f, { style: "glass" });
    f.damage(1, 2);
    const cracked = fakeContext();
    layer.drawStanding(cracked.ctx, f, { style: "glass" });
    expect(count(cracked.rec, "stroke")).toBe(count(whole.rec, "stroke") + 1);
    expect(count(cracked.rec, "moveTo") - count(whole.rec, "moveTo")).toBe(2);
  });

  it("draws a trail as three strokes in the ball's own colour", () => {
    const engine = engineFor({ blPreset: "growEscape" });
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0);
    const ball = engine.getBalls()[0];
    const { ctx, rec } = fakeContext();
    new BlueprintLayer(fakeCanvases().factory).drawTrail(ctx, ball, "#ffd43b", 0.8);
    expect(count(rec, "stroke")).toBe(ball.trail.length >= 4 ? 3 : count(rec, "stroke"));
    expect(rec.sets.filter((s) => s.prop === "strokeStyle").every((s) => String(s.value).startsWith("rgba(255, 212, 59,"))).toBe(true);
  });

  it("pops the end banner in on the run's clock: small and faint at the finish, whole after BANNER_POP_SEC", () => {
    expect(bannerPop(-1)).toEqual({ scale: 0.7, alpha: 0 });
    expect(bannerPop(0).scale).toBeCloseTo(0.7, 9);
    expect(bannerPop(BANNER_POP_SEC)).toEqual({ scale: 1, alpha: 1 });
    expect(bannerPop(10)).toEqual({ scale: 1, alpha: 1 });
    const mid = [0.05, 0.1, 0.15, 0.2, 0.25].map((t) => bannerPop(t).scale);
    expect(Math.max(...mid)).toBeGreaterThan(1);
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("says the catalog game's own line on the banner, mirrors it and the HUD into the dataset, and draws the banner opaque", () => {
    const engine = engineFor({ blPreset: "ringBreaker", blParams: "3" });
    const view = engine.getBlueprintView();
    for (let i = 0; i < 60 * 60 && !view.result.finished; i++) engine.update(1000 / 60, 0);
    expect(view.result.finished).toBe(true);
    const labels = { ...DEFAULT_BLUEPRINT_LABELS, catalog: { ringBreaker: { name: "Rozbijacz", hud: ["pierścienie", "kulki"], says: ["WSZYSTKIE PIERŚCIENIE PADŁY"], timeoutSay: "ZOSTAŁO [rings]" } } };
    expect(endTitle(view, labels)).toBe("WSZYSTKIE PIERŚCIENIE PADŁY");
    const data: Record<string, string> = {};
    new BlueprintDataset().write(view, (k, v) => (data[k] = v), labels);
    expect(data.blueprintBanner).toBe("WSZYSTKIE PIERŚCIENIE PADŁY");
    expect(data.blueprintHud).toMatch(/^pierścienie 0\|kulki \d+$/);
    expect(data.blueprintResult).toBe("ALL RINGS DOWN");
    // the banner over a frame left at 0.6 alpha: drawn at the pop's own opacity, with its line
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0);
    const { ctx, rec } = fakeContext();
    (ctx as unknown as { globalAlpha: number }).globalAlpha = 0.6;
    new BlueprintLayer(fakeCanvases().factory).drawOverlay(ctx, view, labels, 0);
    const texts = rec.calls.filter((c) => c.name === "fillText").map((c) => c.args[0]);
    expect(texts).toContain("WSZYSTKIE PIERŚCIENIE PADŁY");
    expect(rec.sets.filter((s) => s.prop === "globalAlpha").map((s) => s.value)).toContain(1);
  });

  // --- review fix (blueprint) --- the HUD keeps clear of the arena, one clock, a HUD frozen at the finish, a link's marker
  it("puts the title block above the square in a portrait frame, beside it in a landscape one, and on a plate in a square one", () => {
    const blockH = 60;
    const portrait = overlayPlacement(450, 800, recorderSquare(450, 800), blockH, 52);
    expect(portrait.plate).toBe(false);
    expect(portrait.top + blockH).toBeLessThanOrEqual(recorderSquare(450, 800).y0);
    expect(portrait.top).toBeGreaterThanOrEqual(52);
    const landscape = overlayPlacement(800, 450, recorderSquare(800, 450), blockH, 0);
    expect(landscape.plate).toBe(false);
    expect(landscape.left + landscape.maxWidth).toBeLessThanOrEqual(recorderSquare(800, 450).x0);
    expect(overlayPlacement(450, 450, recorderSquare(450, 450), blockH, 0).plate).toBe(true);
  });

  it("draws one clock: none beside a HUD counter of the time, else only in the last seconds before the timeout", () => {
    const texts = (patch: Partial<SimulatorSettings>, seconds: number) => {
      const engine = engineFor(patch);
      for (let i = 0; i < Math.round(seconds * 60); i++) engine.update(1000 / 60, 0);
      const { ctx, rec } = fakeContext();
      new BlueprintLayer(fakeCanvases().factory).drawOverlay(ctx, engine.getBlueprintView(), DEFAULT_BLUEPRINT_LABELS, 0);
      return rec.calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    };
    const clock = /^\d+:\d\d$/;
    // Colour Conquest shows "TIME …" in its HUD: never a second clock
    expect(texts({ blPreset: "conquer" }, 2).filter((t) => clock.test(t))).toEqual([]);
    // Glass Hatchery (60 s): no clock early on, the countdown in its last CLOCK_LAST_SEC
    const spec = sanitizeBlueprint({ v: 1, meta: { name: "Clock" }, bodies: [{ id: "b" }], spawners: [{ body: "b", speed: 200 }], finish: { timeoutSec: CLOCK_LAST_SEC + 3 } }).blueprint;
    expect(texts({ blSpec: encodeBlueprint(spec) }, 1).filter((t) => clock.test(t))).toEqual([]);
    expect(texts({ blSpec: encodeBlueprint(spec) }, 5.5).filter((t) => clock.test(t))).toEqual(["0:08"]);
  });

  it("freezes the HUD and the counts at the finishing step while the world turns on under the banner", () => {
    const engine = engineFor({ blPreset: "ringBreaker", blParams: "3" });
    const view = engine.getBlueprintView();
    for (let i = 0; i < 60 * 60 && !view.result.finished; i++) engine.update(1000 / 60, 0);
    expect(view.result.finished).toBe(true);
    const at = { hud: view.hud.map((h) => h.value), balls: view.balls, time: view.timeSec, clock: view.clockSec };
    for (let i = 0; i < 80; i++) engine.update(1000 / 60, 0);
    expect({ hud: view.hud.map((h) => h.value), balls: view.balls, time: view.timeSec }).toEqual({ hud: at.hud, balls: at.balls, time: at.time });
    expect(view.clockSec).toBeGreaterThan(at.clock + 1);
  });

  it("marks a game from a link under its title (its name is its author's), never a catalog game", () => {
    const own = sanitizeBlueprint({ v: 1, meta: { name: "Mine" }, bodies: [{ id: "b" }], spawners: [{ body: "b", speed: 200 }], finish: { timeoutSec: 30 } }).blueprint;
    const drawn = (patch: Partial<SimulatorSettings>) => {
      const engine = engineFor(patch);
      engine.update(1000 / 60, 0);
      const { ctx, rec } = fakeContext();
      new BlueprintLayer(fakeCanvases().factory).drawOverlay(ctx, engine.getBlueprintView(), { ...DEFAULT_BLUEPRINT_LABELS, fromLink: "Z LINKU" }, 0);
      return rec.calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
    };
    expect(drawn({ blSpec: encodeBlueprint(own) })).toEqual(expect.arrayContaining(["MINE", "Z LINKU"]));
    expect(drawn({ blPreset: "hatchery" })).not.toContain("Z LINKU");
  });
});
