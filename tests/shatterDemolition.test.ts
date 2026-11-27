import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { COLLAPSE_FALL_MS, DEFAULT_SHATTER_EVEN_BRICKS, SHATTER_CLEARANCE, SHATTER_HIT_CHOICES, SHATTER_SEGMENT_CHOICES, collapseDurationMs, collapseStaggerMs, isShatterHits, isShatterSegments, shatterSegmentCounts } from "@/lib/physics/modes/shatter";
import { FINGERPRINT_MODE_SETTINGS } from "@/lib/agentKit/fingerprint";
import { SHATTER_SPAN, shatterBreakHz, shatterChipHz, shatterFallHz } from "@/lib/physics/ringVoices";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { SoundEvent } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { startSettings } from "@/lib/studioLooks"; // --- pace-as-look --- (round two A3a: the page's pace is its start look)
import { CHIP_FLASH_MS, SHARD_MS, SHARDS_PER_BREAK, collapseDone, drawShatterDamage, drawShatterShards, hash01, ringFallStartMs } from "@/components/simulator/shatterRenderer";
import { fakeCanvas } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- shatter-demolition --- Shatter as a demolition (lib/physics/modes/shatter.ts, components/simulator/shatterRenderer.ts):
 *  - a bounce leaves the ball clear of the ring, so it hits once and chips at most one segment (the engine's own push-out left
 *    it in the hit band: 20 hits a frame, a buzz of hundreds of hits a second, out in a median 7.6 s);
 *  - the page's pace (6 rings of 36 two-hit segments) ends inside the clip, the collapse included;
 *  - its sounds: a crack per chip climbing ring by ring, a deeper break, a falling run and the chord on the collapse – one "hit"
 *    a bounce and one "gap" a break as before, the collapse's sounds "extra";
 *  - the hits and segments as settings, in the panel in three languages;
 *  - the picture: cracks and a flash on a chipped segment, shards on a break, the rings falling inside out, the banner after.
 */

const WORLD = { width: 800, height: 450 };

function engineOf(seed: number, patch: Partial<SimulatorSettings> = {}): PhysicsEngine {
  const request = finderRequestOfSettings({ ...startSettings("shatter"), ...patch }, WORLD, 60); // --- pace-as-look --- (the page's runs: its start look)
  return createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
}

interface Logged {
  atMs: number;
  event: SoundEvent;
}

/** Runs `engine` to its end (or `maxSec`): every sound event with its time, the most hits in one frame, the escape's time. */
function runOf(engine: PhysicsEngine, maxSec = 60) {
  const log: Logged[] = [];
  let t = 0;
  let mostHits = 0;
  let escapedAt = -1;
  while (t < 1000 * maxSec && !engine.isSimulationFinished()) {
    engine.update(1000 / 60, 0);
    t += 1000 / 60;
    let hits = 0;
    for (const event of engine.consumeSoundEvents()) {
      log.push({ atMs: t, event });
      if (event.type === "hit" && event.ringVoice !== "extra") hits++;
    }
    mostHits = Math.max(mostHits, hits);
    if (escapedAt < 0 && engine.hasShatterEscaped()) escapedAt = t;
  }
  return { log, endMs: t, finished: engine.isSimulationFinished(), mostHits, escapedAt };
}

describe("a bounce off a Shatter ring", () => {
  it("leaves the ball clear of the ring's hit band: one hit, never the twenty a frame of the old push-out", () => {
    expect(SHATTER_CLEARANCE).toBeGreaterThan(2); // the engine's hit band is the radius + 2
    for (const seed of [1, 7, 12]) {
      const run = runOf(engineOf(seed), 40);
      expect(run.finished, `seed ${seed}`).toBe(true);
      expect(run.mostHits, `seed ${seed}`).toBeLessThanOrEqual(2);
      const contacts = run.log.filter((l) => l.event.type === "hit" && l.event.ringVoice === "contact").length;
      expect(contacts / (run.escapedAt / 1000), `seed ${seed}`).toBeLessThan(25); // about ten a second (the old run: hundreds)
    }
  });

  it("chips one segment a bounce: a segment of two hits cracks first and breaks on the second", () => {
    const engine = engineOf(3);
    let firstChip: { wall: number; index: number } | null = null;
    for (let f = 0; f < 60 * 30 && !firstChip; f++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      for (const wall of engine.getShatterSegments()) for (const s of wall) if (!firstChip && s.hp === 1 && s.maxHp === 2) firstChip = { wall: s.wallIndex, index: s.segmentIndex };
    }
    expect(firstChip).not.toBeNull();
    const seg = engine.getShatterSegments()[firstChip!.wall][firstChip!.index];
    expect([seg.hitAngles.length, seg.hitMs >= 0, seg.brokenMs]).toEqual([1, true, -1]);
  });

  it("keeps the run deterministic: the same seed gives the same sounds and the same end", () => {
    const a = runOf(engineOf(5), 40);
    const b = runOf(engineOf(5), 40);
    expect(a.endMs).toBe(b.endMs);
    expect(a.log.map((l) => [l.atMs, l.event.type, l.event.frequency])).toEqual(b.log.map((l) => [l.atMs, l.event.type, l.event.frequency]));
  });
});

describe("the page's pace", () => {
  it("is six rings of 36 segments that take two hits, a link's own values kept", () => {
    const s = startSettings("shatter"); // --- pace-as-look --- (round two A3a: the page's pace is its start look)
    expect([s.wallCount, s.shatterSegments, s.shatterHits]).toEqual([6, 36, 2]);
    // other modes keep the mode's own (18 segments, one hit): the engine's when the page says nothing
    expect([defaultSettings("classic").shatterSegments, defaultSettings("classic").shatterHits]).toEqual([18, 1]);
    // the link base is the mode's own (1.17.0's ten rings of 18 one-hit segments): a link of it writes nothing, the start look its pace
    const base = defaultSettings("shatter");
    expect([base.wallCount, base.shatterSegments, base.shatterHits]).toEqual([10, 18, 1]);
    expect(settingsToSearchParams(base).toString()).toBe("mode=shatter");
    expect(settingsToSearchParams(s).toString()).toBe("mode=shatter&wc=6&shh=2&shs=36&shb=1");
    const old = settingsFromSearchParams(new URLSearchParams("mode=shatter&wc=10&shh=1&shs=18"));
    expect([old.wallCount, old.shatterHits, old.shatterSegments]).toEqual([10, 1, 18]);
    expect(settingsToSearchParams(old).toString()).toBe("mode=shatter");
    const own = settingsFromSearchParams(new URLSearchParams("mode=shatter&wc=8&shh=3&shs=24"));
    expect([own.wallCount, own.shatterHits, own.shatterSegments]).toEqual([8, 3, 24]);
    expect(settingsToSearchParams(own).toString()).toBe("mode=shatter&wc=8&shh=3&shs=24");
  });

  it("ends inside the default clip, the collapse included, on most seeds: a 10-25 s demolition", () => {
    const ends: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const run = runOf(engineOf(seed), 45);
      if (run.finished) ends.push(run.endMs / 1000);
    }
    expect(ends.filter((t) => t <= 27).length).toBeGreaterThanOrEqual(10);
    expect(ends.every((t) => t > 5)).toBe(true);
    const sorted = [...ends].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(10);
    expect(median).toBeLessThan(25);
  });
});

describe("Shatter's glass", () => {
  it("climbs a pentatonic degree a ring, breaks an octave under, and falls from the top on the collapse", () => {
    for (let ring = 1; ring <= SHATTER_SPAN; ring++) expect(shatterChipHz(ring)).toBeGreaterThan(shatterChipHz(ring - 1));
    expect(shatterChipHz(SHATTER_SPAN + 5)).toBe(shatterChipHz(SHATTER_SPAN)); // a hundred rings stay in register
    expect(shatterBreakHz(3)).toBeCloseTo(shatterChipHz(3) / 2, 6);
    for (let step = 1; step < 8; step++) expect(shatterFallHz(step)).toBeLessThan(shatterFallHz(step - 1));
    expect(Number.isFinite(shatterChipHz(Number.NaN))).toBe(true);
  });

  it("plays one hit a bounce and one gap a break, glass every one, and the collapse's run and chord as extras", () => {
    const run = runOf(engineOf(7), 45);
    expect(run.finished).toBe(true);
    const contacts = run.log.filter((l) => l.event.ringVoice === "contact");
    const extras = run.log.filter((l) => l.event.ringVoice === "extra");
    expect(run.log.every((l) => l.event.ringVoice !== undefined)).toBe(true); // no engine blip under the glass
    expect(contacts.filter((l) => l.event.type === "hit").every((l) => l.event.plCrack === true)).toBe(true);
    // a break: the deeper crack, then the thump as its gap
    const gaps = contacts.filter((l) => l.event.type === "gap");
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) expect([g.event.loop, g.event.frequency! < shatterChipHz(0)]).toEqual(["land", true]);
    // the collapse: a crack a ring, inside out, falling, from the escape on; the chord when the last ring is down
    const rings = engineOf(7).getCircularWalls().length;
    const falls = extras.filter((l) => l.event.plCrack);
    expect(falls.length).toBe(rings);
    for (let i = 1; i < falls.length; i++) {
      expect(falls[i].event.frequency!).toBeLessThan(falls[i - 1].event.frequency!);
      expect(falls[i].atMs).toBeGreaterThanOrEqual(falls[i - 1].atMs);
    }
    expect(falls[0].atMs).toBeCloseTo(run.escapedAt, 6);
    const chord = extras.filter((l) => l.event.loop === "chord");
    expect(chord.length).toBe(1);
    expect(chord[0].atMs).toBe(run.endMs); // the run ends with the chord, the banner comes with it
    expect(run.endMs - run.escapedAt).toBeGreaterThanOrEqual(collapseDurationMs(rings) - 1000 / 60);
    // never a silence over a second and a half while the ball is in
    let last = 0;
    let longest = 0;
    for (const l of run.log) {
      longest = Math.max(longest, l.atMs - last);
      last = l.atMs;
    }
    expect(longest).toBeLessThan(1500);
  });
});

describe("the collapse's clock", () => {
  it("ends the run and brings the banner in the very same step: the last ring down", () => {
    const engine = engineOf(7);
    let before = false;
    let steps = 0;
    while (!engine.isSimulationFinished() && steps < 60 * 60) {
      before = collapseDone(engine.getShatterView());
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      steps++;
    }
    expect(engine.isSimulationFinished()).toBe(true);
    expect([before, collapseDone(engine.getShatterView())]).toEqual([false, true]);
    const view = engine.getShatterView();
    expect(engine.getElapsedMs() - view.escapedMs).toBeGreaterThanOrEqual(collapseDurationMs(view.rings) - 1e-6);
    expect([view.fallen, view.ringsOut]).toEqual([view.rings, view.rings]);
  });

  it("staggers the rings inside out and fits a hundred rings in about a second and a half", () => {
    expect(collapseStaggerMs(1)).toBe(0);
    expect(collapseStaggerMs(6)).toBe(160);
    expect(collapseStaggerMs(100)).toBeLessThan(160);
    expect(collapseDurationMs(6)).toBe(5 * 160 + COLLAPSE_FALL_MS);
    expect(collapseDurationMs(100)).toBeLessThanOrEqual(900 + COLLAPSE_FALL_MS + 1e-9);
    const view = { escapedMs: 10_000, staggerMs: 160, fallMs: COLLAPSE_FALL_MS, fallen: 0, rings: 6, ringsOut: 6, collapsed: false };
    expect(ringFallStartMs(view, 0)).toBe(10_000);
    expect(ringFallStartMs(view, 3)).toBe(10_480);
    expect(ringFallStartMs({ ...view, escapedMs: -1 }, 0)).toBe(Infinity);
    expect(collapseDone(view)).toBe(false);
    expect(collapseDone({ ...view, collapsed: true })).toBe(true);
    expect(collapseDone({ ...view, escapedMs: -1, collapsed: true })).toBe(false);
  });
});

describe("the picture", () => {
  const seg = (index: number, patch: Partial<{ hp: number; maxHp: number; hitAngles: number[]; hitMs: number; brokenMs: number }> = {}) => ({
    wallIndex: 0,
    segmentIndex: index,
    startAngle: (index * Math.PI) / 4,
    endAngle: ((index + 1) * Math.PI) / 4,
    hp: 2,
    maxHp: 2,
    hitAngles: [] as number[],
    hitMs: -1,
    brokenMs: -1,
    ...patch,
  });
  const walls = [{ radius: 200 }];
  const inside = { escapedMs: -1, staggerMs: 160, fallMs: COLLAPSE_FALL_MS, fallen: 0, rings: 1, ringsOut: 0, collapsed: false };
  const calls = (ctx: { calls: { name: string }[] }, name: string) => ctx.calls.filter((c) => c.name === name).length;

  it("cracks a chipped segment from its hit and flashes it white for a moment, and leaves a whole one alone", () => {
    const chipped = [[seg(0, { hp: 1, hitAngles: [0.3], hitMs: 5000 }), seg(1)]];
    const fresh = fakeCanvas(600, 600);
    drawShatterDamage(fresh.ctx as unknown as CanvasRenderingContext2D, chipped, walls, [0], 10, 300, 300, 5000 + CHIP_FLASH_MS / 2, inside);
    expect(calls(fresh.ctx, "stroke")).toBe(2); // the crack, dark then its light edge
    expect(calls(fresh.ctx, "fill")).toBe(2); // the darkening, the flash
    const later = fakeCanvas(600, 600);
    drawShatterDamage(later.ctx as unknown as CanvasRenderingContext2D, chipped, walls, [0], 10, 300, 300, 5000 + CHIP_FLASH_MS, inside);
    expect([calls(later.ctx, "stroke"), calls(later.ctx, "fill")]).toEqual([2, 1]); // the crack stays, the flash is gone
    const whole = fakeCanvas(600, 600);
    drawShatterDamage(whole.ctx as unknown as CanvasRenderingContext2D, [[seg(0), seg(1)]], walls, [0], 10, 300, 300, 5000, inside);
    expect(calls(whole.ctx, "stroke") + calls(whole.ctx, "fill")).toBe(0);
  });

  it("bursts a broken segment into shards for SHARD_MS of the run, the same shards every render", () => {
    const broken = [[seg(0, { hp: 0, brokenMs: 4000 }), seg(1)]];
    const draw = (now: number) => {
      const c = fakeCanvas(600, 600);
      drawShatterShards(c.ctx as unknown as CanvasRenderingContext2D, broken, walls, [0], 10, 300, 300, now, inside, () => "#ff0000");
      return c.ctx.calls.filter((x) => x.name === "moveTo" || x.name === "lineTo").map((x) => x.args.map((v) => Math.round(Number(v) * 100)));
    };
    expect(draw(4000 + SHARD_MS / 3).length).toBe(3 * SHARDS_PER_BREAK);
    expect(draw(4000 + SHARD_MS / 3)).toEqual(draw(4000 + SHARD_MS / 3));
    expect(draw(4000 + SHARD_MS).length).toBe(0);
    expect(hash01(1, 2, 3)).toBe(hash01(1, 2, 3));
    expect(hash01(1, 2, 3)).not.toBe(hash01(1, 2, 4));
  });

  it("lets every standing segment fall once its ring's turn comes after the escape, and the canvas holds its banner till the end", () => {
    const standing = [[seg(0), seg(1), seg(2, { hp: 0 })]];
    const view = { ...inside, escapedMs: 8000, ringsOut: 1 };
    const before = fakeCanvas(600, 600);
    drawShatterShards(before.ctx as unknown as CanvasRenderingContext2D, standing, walls, [0], 10, 300, 300, 7990, view, () => "#00ff00");
    expect(calls(before.ctx, "fill")).toBe(0);
    const falling = fakeCanvas(600, 600);
    drawShatterShards(falling.ctx as unknown as CanvasRenderingContext2D, standing, walls, [0], 10, 300, 300, 8000 + COLLAPSE_FALL_MS / 4, view, () => "#00ff00");
    expect(calls(falling.ctx, "fill")).toBe(2 * 5); // two segments, each its slab and four shards
    const canvas = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Canvas.tsx"), "utf8");
    expect(canvas).toMatch(/if \(shatterView && simMs >= ringFallStartMs\(shatterView, i\)\) continue;/);
    expect(canvas).toMatch(/engine\.isShatterMode\(\) && engine\.hasShatterEscaped\(\) && collapseDone\(engine\.getShatterView\(\)\)\) \{/);
  });
});

describe("Hits per segment and Segments per ring", () => {
  it("are picks that travel in a link and a preset, and refuse what is no pick", () => {
    expect([...SHATTER_HIT_CHOICES]).toEqual([1, 2, 3, 4, 5]);
    expect([...SHATTER_SEGMENT_CHOICES]).toEqual([8, 12, 18, 24, 36]);
    for (const bad of [0, 6, 2.5, Number.NaN, "2", null]) expect(isShatterHits(bad)).toBe(false);
    for (const bad of [4, 37, 1e9, "36"]) expect(isShatterSegments(bad)).toBe(false);
    for (const bad of ["7", "1e9", "-2", "abc", ""]) {
      const s = settingsFromSearchParams(new URLSearchParams(`mode=shatter&shh=${bad}&shs=${bad}`));
      expect([s.shatterHits, s.shatterSegments], bad).toEqual([1, 18]); // (--- pace-as-look --- the link base's: the mode's own)
    }
    expect(presetToSettings({ mode: "shatter", shatterHits: 4, shatterSegments: 12 })).toMatchObject({ shatterHits: 4, shatterSegments: 12 });
    expect(presetToSettings({ mode: "shatter", shatterHits: 9 } as never).shatterHits).toBe(1); // (the link base's)
  });

  it("build the run the page plays: the finder's engine has as many segments and hits as the settings say", () => {
    const engine = engineOf(1, { shatterHits: 3, shatterSegments: 12, wallCount: 4, shatterEvenBricks: false });
    const rings = engine.getShatterSegments();
    expect(rings.length).toBe(4);
    for (const ring of rings) {
      expect(ring.length).toBe(12);
      for (const s of ring) expect([s.hp, s.maxHp]).toEqual([3, 3]);
    }
  });

  it("are in the panel in en, pl and es", () => {
    for (const messages of [en, pl, es]) {
      const c = (messages as unknown as { Controls: Record<string, string> }).Controls;
      for (const key of ["shatterHits", "shatterHitsTip", "shatterSegments", "shatterSegmentsTip"]) expect(typeof c[key], key).toBe("string");
    }
    const section = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/sections/EscapeModeSection.tsx"), "utf8");
    expect(section).toMatch(/shatter: \["shatterHits", "shatterSegments"\]/);
    expect(section).toMatch(/SHATTER_HIT_CHOICES/);
    expect(section).toMatch(/SHATTER_SEGMENT_CHOICES/);
  });
});

// --- shatter-even-bricks --- (review fix B3)
describe("even bricks and the rings-to-go count", () => {
  it("cuts the page's inner rings into bricks as long as the outer ring's: the smallest ring 12, not 36", () => {
    expect(DEFAULT_SHATTER_EVEN_BRICKS).toBe(false);
    expect(startSettings("shatter").shatterEvenBricks).toBe(true); // --- pace-as-look --- (round two A3a: the page's start look)
    expect(defaultSettings("shatter").shatterEvenBricks).toBe(false); // (the link base: the mode's own)
    expect(defaultSettings("classic").shatterEvenBricks).toBe(false);
    const rings = engineOf(1).getShatterSegments();
    expect(rings.map((r) => r.length)).toEqual([12, 17, 22, 26, 31, 36]);
    // every segment of a ring the same angle, and the ring closed all round
    for (const ring of rings) {
      const step = (2 * Math.PI) / ring.length;
      ring.forEach((seg, i) => {
        expect(seg.startAngle).toBeCloseTo(i * step, 9);
        expect(seg.endAngle).toBeCloseTo((i + 1) * step, 9);
      });
    }
    // the brick length (px of arc) within a quarter of the outer ring's on every ring
    const walls = engineOf(1).getCircularWalls();
    const outer = (2 * Math.PI * walls[walls.length - 1].radius) / 36;
    rings.forEach((ring, i) => expect(Math.abs((2 * Math.PI * walls[i].radius) / ring.length / outer - 1)).toBeLessThan(0.25));
    // off: every ring the pick (every old link with shb=0, the mode's own default)
    expect(engineOf(1, { shatterEvenBricks: false }).getShatterSegments().map((r) => r.length)).toEqual([36, 36, 36, 36, 36, 36]);
    expect(shatterSegmentCounts([10, 20, 30], 8, true)).toEqual([8, 8, 8]);
    expect(shatterSegmentCounts([10, 20, 30], 4, true)).toEqual([4, 4, 4]);
    expect(shatterSegmentCounts([], 36, true)).toEqual([]);
  });

  it("lets the ball out of the smallest ring in a few seconds: the climb is spread over the run", () => {
    const firstOut: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const engine = engineOf(seed);
      let t = 0;
      while (t < 30_000 && engine.getShatterView().ringsOut === 0 && !engine.isSimulationFinished()) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        t += 1000 / 60;
      }
      firstOut.push(t / 1000);
    }
    const sorted = [...firstOut].sort((a, b) => a - b);
    expect(sorted[6]).toBeLessThan(5); // the median (the same bricks everywhere: 9.3 s)
    expect(sorted[11]).toBeLessThan(8);
  });

  it("travels in a link and a preset as shb, written only when it differs from the mode's link base", () => {
    expect(settingsToSearchParams(defaultSettings("shatter")).has("shb")).toBe(false);
    const off = settingsFromSearchParams(new URLSearchParams("mode=shatter&shb=0"));
    expect(off.shatterEvenBricks).toBe(false);
    expect(settingsToSearchParams(off).get("shb")).toBeNull(); // (--- pace-as-look --- off is the link base again, the mode's own)
    expect(settingsToSearchParams(startSettings("shatter")).get("shb")).toBe("1"); // (the start look writes it on)
    expect(settingsFromSearchParams(new URLSearchParams("mode=shatter&shb=1")).shatterEvenBricks).toBe(true);
    for (const bad of ["2", "yes", ""]) expect(settingsFromSearchParams(new URLSearchParams(`mode=shatter&shb=${bad}`)).shatterEvenBricks, bad).toBe(false); // (the link base's)
    expect(presetToSettings({ mode: "shatter", shatterEvenBricks: false }).shatterEvenBricks).toBe(false);
    expect(presetToSettings({ mode: "shatter", shatterEvenBricks: true }).shatterEvenBricks).toBe(true);
    expect(presetToSettings({ mode: "shatter", shatterEvenBricks: "0" } as never).shatterEvenBricks).toBe(false); // (the link base's)
    // the fingerprint's recipe names none: the mode's own (every ring the same count) – its pinned run is the same
    expect((FINGERPRINT_MODE_SETTINGS as { shatterEvenBricks?: boolean }).shatterEvenBricks).toBeUndefined();
  });

  it("never counts a ring back: the pips and the lit floor only go up, on every seed", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const engine = engineOf(seed);
      let last = 0;
      let backs = 0;
      for (let f = 0; f < 60 * 40 && !engine.isSimulationFinished(); f++) {
        engine.update(1000 / 60, 0);
        engine.consumeSoundEvents();
        const out = engine.getShatterView().ringsOut;
        if (out < last) backs++;
        last = out;
      }
      expect(backs, `seed ${seed}`).toBe(0);
      expect(last, `seed ${seed}`).toBe(engine.getShatterView().rings);
    }
  });
});
