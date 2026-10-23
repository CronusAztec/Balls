import { describe, expect, it } from "vitest";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import type { PhysicsConfig } from "@/lib/physics/types";
import { TileField } from "@/lib/physics/tiles";
import { BANNER_POP_SEC, BlueprintDataset, BlueprintLayer, CLOCK_LAST_SEC, CORNER_MIN_SCALE, DEFAULT_BLUEPRINT_LABELS, LayerCache, RING_BREAK_SEC, RING_SHARDS, bannerPop, endTitle, mixHex, overlayPlacement, recorderSquare } from "@/components/simulator/blueprintRenderer";
import { BLUEPRINT_CATALOG_IDS, encodeBlueprint, sanitizeBlueprint } from "@/lib/blueprint";
import { WALL_HALF } from "@/lib/blueprint/runtime/world";
import { TilesLayer, crackHash, traceCracks } from "@/components/simulator/tilesRenderer";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

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

/** --- review fix (blueprint) --- A 2D context for the overlay's text: measureText at 0.68 em a character (wider than bold capitals), each fillText with its font size and alignment, each fill() with its style. */
function textContext() {
  const state: Record<string, unknown> = { globalAlpha: 1, shadowBlur: 0, fillStyle: "", strokeStyle: "", lineWidth: 1, font: "10px sans-serif", textAlign: "left" };
  const texts: { text: string; x: number; y: number; size: number; align: string; maxWidth: number }[] = [];
  const fills: string[] = [];
  const size = () => Number(/([\d.]+)px/.exec(String(state.font))?.[1] ?? 10);
  const ctx = new Proxy(state, {
    get: (_t, prop: string) => {
      if (prop in state) return state[prop];
      if (prop === "measureText") return (text: string) => ({ width: 0.68 * size() * String(text).length });
      if (prop === "fillText") return (text: string, x: number, y: number, maxWidth = Infinity) => texts.push({ text, x, y, size: size(), align: String(state.textAlign), maxWidth });
      if (prop === "fill") return () => fills.push(String(state.fillStyle));
      if (prop === "createRadialGradient" || prop === "createLinearGradient") return () => ({ addColorStop: () => {} });
      return () => {};
    },
    set: (_t, prop: string, value) => {
      state[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts, fills };
}
/** The dark plate an overlay block goes on when it cannot keep clear of the arena. */
const PLATE = "rgba(6, 8, 16, 0.62)";
const MESSAGES = { en, pl, es };
/** The canvas' labels in a language: the catalog games' names and HUD words, as the page passes them. */
function labelsOf(msgs: typeof en) {
  const games = msgs.Blueprints as unknown as Record<string, Record<string, string>>;
  return {
    ...DEFAULT_BLUEPRINT_LABELS,
    arenaFull: msgs.Blueprint.canvasArenaFull,
    catalog: Object.fromEntries(BLUEPRINT_CATALOG_IDS.map((id) => [id, { name: games[id].name, hud: [0, 1, 2].map((i) => games[id][`hud${i}`]).filter(Boolean) }])),
  };
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

  // --- review fix (blueprint) --- a clip is the recorder's square alone (Record Video, the fast export, the batch, the bot,
  // the render queue): a recorded frame draws the title, the counters, the clock and ARENA FULL inside it, whatever its shape
  it("keeps the title, the counters, the clock and ARENA FULL inside the recorder's square in a recorded frame, portrait and landscape", () => {
    expect(overlayPlacement(450, 800, recorderSquare(450, 800), 60, 0, true)).toMatchObject({ plate: true, top: recorderSquare(450, 800).y0 + 0.03 * 450 });
    expect(overlayPlacement(800, 450, recorderSquare(800, 450), 60, 0, true)).toMatchObject({ plate: true, left: recorderSquare(800, 450).x0 + 0.04 * 450 });
    const clockSpec = sanitizeBlueprint({ v: 1, meta: { name: "Clock" }, arena: { shape: "circle", size: 0.92 }, bodies: [{ id: "b" }], spawners: [{ body: "b", speed: 200 }], hud: [{ show: "balls", label: "balls" }], finish: { timeoutSec: CLOCK_LAST_SEC + 3 } }).blueprint;
    const full = sanitizeBlueprint({ v: 1, meta: { name: "Full" }, bodies: [{ id: "b", radius: 4 }], spawners: [0, 1].map(() => ({ body: "b", count: 8, everySec: 0.02, maxTotal: 400, speed: 100 })), hud: [{ show: "balls", label: "balls" }], finish: { timeoutSec: 30 } }).blueprint;
    for (const [width, height] of [[800, 450], [450, 800]]) {
      const sq = recorderSquare(width, height);
      const cases: [string, Partial<SimulatorSettings>, number][] = [
        ...BLUEPRINT_CATALOG_IDS.map((id) => [id, { blPreset: id }, 3] as [string, Partial<SimulatorSettings>, number]),
        ["the clock", { blSpec: encodeBlueprint(clockSpec) }, 5.5],
        ["ARENA FULL", { blSpec: encodeBlueprint(full) }, 2],
      ];
      for (const [name, patch, seconds] of cases) {
        const settings = { ...defaultSettings("blueprint"), ...patch };
        const engine = createEngineForSettings({ ...config, width, height }, "blueprint", modeSettingsOfSettings(settings) as ModeSettings, 1);
        for (let i = 0; i < Math.round(seconds * 60); i++) engine.update(1000 / 60, 0);
        const view = engine.getBlueprintView();
        const live = textContext();
        new BlueprintLayer(fakeCanvases().factory).drawOverlay(live.ctx, view, DEFAULT_BLUEPRINT_LABELS, 0);
        const { ctx, texts } = textContext();
        new BlueprintLayer(fakeCanvases().factory).drawOverlay(ctx, view, DEFAULT_BLUEPRINT_LABELS, 0, true);
        // the same lines as the live view draws in its band – every one of them inside the square
        expect([width, name, texts.map((t) => t.text)]).toEqual([width, name, live.texts.map((t) => t.text)]);
        expect(texts.length, `${width} ${name}`).toBeGreaterThanOrEqual(2);
        for (const t of texts) {
          const w = Math.min(0.68 * t.size * t.text.length, t.maxWidth);
          const [l, r] = t.align === "right" ? [t.x - w, t.x] : [t.x, t.x + w];
          const inside = l >= sq.x0 - 0.5 && r <= sq.x0 + sq.side + 0.5 && t.y - 0.62 * t.size >= sq.y0 - 0.5 && t.y + 0.62 * t.size <= sq.y0 + sq.side + 0.5;
          expect(inside, `${width}×${height} ${name}: "${t.text}" at ${t.x.toFixed(0)},${t.y.toFixed(0)} outside the square ${sq.x0},${sq.y0} ${sq.side}`).toBe(true);
        }
        if (name === "the clock") expect(texts.filter((t) => t.align === "right").map((t) => t.text)).toEqual(["0:08"]);
        if (name === "ARENA FULL") expect(texts.map((t) => t.text)).toContain("ARENA FULL");
      }
    }
  });

  // --- review fix (blueprint) --- a square frame (a phone's stage, a 1:1 clip) has no free band: the HUD hugs the corners a
  // circle leaves free, in every language, instead of a plate over the rim, the outer tiles or the turning exit
  it("keeps every catalog game's title and counters clear of its arena in a square frame, in en, pl and es, and the clock too", () => {
    const square = (patch: Partial<SimulatorSettings>, seconds: number) => {
      const settings = { ...defaultSettings("blueprint"), ...patch };
      const engine = createEngineForSettings({ ...config, width: 450, height: 450 }, "blueprint", modeSettingsOfSettings(settings) as ModeSettings, 1);
      for (let i = 0; i < Math.round(seconds * 60); i++) engine.update(1000 / 60, 0);
      return engine.getBlueprintView();
    };
    // every line drawn: its box (the text's width at about 0.68 em a character – wider than bold capitals are – and its
    // font's height, the outline included) never reaches the rim's line; no plate goes over the arena
    const problems = (view: ReturnType<typeof square>, labels: typeof DEFAULT_BLUEPRINT_LABELS, inset: number) => {
      const { ctx, texts, fills } = textContext();
      new BlueprintLayer(fakeCanvases().factory).drawOverlay(ctx, view, labels, inset);
      const w = view.world!;
      const out: string[] = [];
      if (fills.includes(PLATE)) out.push("a plate");
      const fs = 0.03 * 450;
      for (const t of texts) {
        const width = Math.min(0.68 * t.size * t.text.length, t.maxWidth);
        const [l, r] = t.align === "right" ? [t.x - width, t.x] : [t.x, t.x + width];
        const nx = Math.max(l, Math.min(w.cx, r));
        const ny = Math.max(t.y - 0.62 * t.size, Math.min(w.cy, t.y + 0.62 * t.size));
        if (Math.hypot(nx - w.cx, ny - w.cy) < w.R + WALL_HALF) out.push(`"${t.text}" over the arena`);
        if (t.size < CORNER_MIN_SCALE * 0.62 * fs - 0.06) out.push(`"${t.text}" at ${t.size.toFixed(1)} px`); // (a font's size is written to 0.1 px)
      }
      return out;
    };
    for (const [locale, msgs] of Object.entries(MESSAGES)) {
      const labels = labelsOf(msgs);
      for (const id of BLUEPRINT_CATALOG_IDS) {
        const view = square({ blPreset: id }, 3);
        // a 1:1 clip (no inset) and a phone's live stage (the page's 52 px inset: no block keeps clear below it)
        for (const inset of [0, 52]) expect([locale, id, inset, problems(view, labels, inset)]).toEqual([locale, id, inset, []]);
      }
    }
    // the clock of the last seconds, in the other corner
    const spec = sanitizeBlueprint({ v: 1, meta: { name: "Clock" }, arena: { shape: "circle", size: 0.92 }, bodies: [{ id: "b" }], spawners: [{ body: "b", speed: 200 }], finish: { timeoutSec: CLOCK_LAST_SEC + 3 } }).blueprint;
    const clockView = square({ blSpec: encodeBlueprint(spec) }, 5.5);
    const { ctx, texts } = textContext();
    new BlueprintLayer(fakeCanvases().factory).drawOverlay(ctx, clockView, DEFAULT_BLUEPRINT_LABELS, 52);
    expect(texts.filter((t) => t.align === "right").map((t) => t.text)).toEqual(["0:08"]);
    expect(problems(clockView, DEFAULT_BLUEPRINT_LABELS, 52)).toEqual([]);
    // a smaller arena leaves room under the page's inset: the block stays below it
    const small = sanitizeBlueprint({ ...spec, arena: { shape: "circle", size: 0.6 } }).blueprint;
    const below = textContext();
    new BlueprintLayer(fakeCanvases().factory).drawOverlay(below.ctx, square({ blSpec: encodeBlueprint(small) }, 1), DEFAULT_BLUEPRINT_LABELS, 52);
    expect(Math.min(...below.texts.map((t) => t.y - 0.62 * t.size))).toBeGreaterThanOrEqual(52);
    // an arena that leaves no corner free (a box filling the square): the block on a plate at full size
    const box = sanitizeBlueprint({ ...spec, arena: { shape: "box", size: 0.92 } }).blueprint;
    const plated = textContext();
    new BlueprintLayer(fakeCanvases().factory).drawOverlay(plated.ctx, square({ blSpec: encodeBlueprint(box) }, 1), DEFAULT_BLUEPRINT_LABELS, 0);
    expect(plated.fills).toContain(PLATE);
    expect(plated.texts[0].text).toBe("CLOCK");
    expect(plated.texts[0].size).toBeCloseTo(0.9 * 0.03 * 450, 0);
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
