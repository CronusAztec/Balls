import { describe, expect, it } from "vitest";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { BOX_CHORD_HZ, BOX_CORNER_BL, BOX_CORNER_BR, BOX_CORNER_TL, BOX_CORNER_TR, FINALE_SHAPES, MIN_AIM_ANGLE, boxChimeHz, cornerAimAngle, finaleCornerOf, finaleSplit, type BoxSettings } from "@/lib/physics/modes/box";
import { BOX_DIGITS_PLACED, BURST_MS, DIGIT_BOX_HEIGHT, DIGIT_GAP, DIGIT_OUTLINE, burstHash, drawBoxShapes, placeBoxDigits, type BoxDigit } from "@/components/simulator/boxRenderer";
import { fakeCanvas } from "./fakeCanvas";

/*
 * --- box-finale --- (Lane E, E4) Bouncing Shapes' corner finale (lib/physics/modes/box.ts): the last FINALE_SHAPES shapes each
 * end their countdown on a corner, the chime of every shape at 0 and the closing chord, and the start look (lib/clipPacing.ts)
 * that ends inside the clip; the renderer's burst is the same frame everywhere (components/simulator/boxRenderer.ts).
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

function boxEngine(box: Partial<BoxSettings>, seed = 7, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "box", { ...modeSettings, box }, seed);
}

/** Runs a box to its end (at most `maxSec`), collecting every sound event and the simulated seconds. */
function runToEnd(engine: ReturnType<typeof boxEngine>, maxSec = 90): { events: SoundEvent[]; sec: number } {
  const events: SoundEvent[] = [];
  let sec = 0;
  while (sec < maxSec && !engine.isSimulationFinished()) {
    engine.update(1000 / 60, 0);
    sec += 1 / 60;
    events.push(...engine.consumeSoundEvents());
  }
  return { events, sec };
}

describe("box finale: the plan", () => {
  it("splits the last counts into side and top/bottom hits that meet in a corner, nearest the heading and never grazing a wall", () => {
    const plan = finaleSplit(100, 60, 300, 400, 7, Math.PI / 4)!;
    expect(plan.x + plan.y - 1).toBe(7);
    expect(plan.angle).toBeCloseTo(cornerAimAngle(100, 60, 300, 400, plan.x, plan.y), 12);
    for (let x = 1; x <= 7; x++) {
      const angle = cornerAimAngle(100, 60, 300, 400, x, 8 - x);
      if (angle >= MIN_AIM_ANGLE && angle <= Math.PI / 2 - MIN_AIM_ANGLE) expect(Math.abs(plan.angle - Math.PI / 4)).toBeLessThanOrEqual(Math.abs(angle - Math.PI / 4) + 1e-12);
    }
    expect(finaleSplit(100, 60, 300, 400, 0, 0.5)).toBeNull();
    expect(finaleSplit(100, 60, 0, 400, 5, 0.5)).toBeNull();
    // one hit left at a grazing angle: no plan, the next hit tries again
    expect(finaleSplit(400, 0.5, 300, 400, 1, 0.1)).toBeNull();
  });

  // --- box-finale --- (E4 review) the badge sits in a bottom corner of a free clip: a top corner whenever one can be aimed at
  it("chooses a split that ends in a top corner whenever one is within the aim bounds, whichever way the shape flies", () => {
    for (const sy of [1, -1]) {
      for (const [dx, dy, count, heading] of [[100, 60, 7, Math.PI / 4], [40, 200, 5, 0.4], [250, 30, 9, 1.1], [120, 120, 2, 0.8]] as const) {
        const plan = finaleSplit(dx, dy, 300, 400, count, heading, sy)!;
        expect(plan.x + plan.y - 1).toBe(count);
        let topExists = false;
        for (let x = 1; x <= count; x++) {
          const angle = cornerAimAngle(dx, dy, 300, 400, x, count + 1 - x);
          const corner = finaleCornerOf(1, sy, x, count + 1 - x);
          if (angle >= MIN_AIM_ANGLE && angle <= Math.PI / 2 - MIN_AIM_ANGLE && (corner === BOX_CORNER_TL || corner === BOX_CORNER_TR)) topExists = true;
        }
        if (topExists) expect([BOX_CORNER_TL, BOX_CORNER_TR], `${sy} ${dx} ${dy} ${count}`).toContain(finaleCornerOf(1, sy, plan.x, plan.y));
      }
    }
    // without the direction (sy 0) the plan is the heading's nearest, as before
    expect(finaleSplit(100, 60, 300, 400, 7, Math.PI / 4, 0)).toEqual(finaleSplit(100, 60, 300, 400, 7, Math.PI / 4));
  });

  it("names the corner a flight reaches: an odd number of contacts on an axis lands on the wall ahead", () => {
    expect(finaleCornerOf(1, 1, 1, 1)).toBe(BOX_CORNER_BR);
    expect(finaleCornerOf(1, 1, 2, 1)).toBe(BOX_CORNER_BL);
    expect(finaleCornerOf(-1, -1, 1, 3)).toBe(BOX_CORNER_TL);
    expect(finaleCornerOf(1, -1, 3, 2)).toBe(BOX_CORNER_BR);
    expect(finaleCornerOf(-1, 1, 2, 2)).toBe(BOX_CORNER_TR);
  });

  it("climbs the chimes up the pentatonic from G5 and roots the chord on C3", () => {
    expect(boxChimeHz(0)).toBeCloseTo(783.99, 1);
    expect(boxChimeHz(1)).toBeGreaterThan(boxChimeHz(0));
    expect(boxChimeHz(2)).toBeCloseTo(1046.5, 1);
    expect(BOX_CHORD_HZ).toBeCloseTo(130.81, 1);
  });
});

describe("box finale in the engine", () => {
  it("ends the last two shapes' countdowns on corners: one accented hit each, the chimes and the chord, and every count still one hit", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = boxEngine({}, seed, { width: 800, height: 450 });
      const { events } = runToEnd(engine);
      const view = engine.getBoxView();
      expect(engine.isSimulationFinished(), `seed ${seed}`).toBe(true);
      expect(view.totalHits, `seed ${seed}`).toBe(90);
      expect(view.cornerHits, `seed ${seed}`).toBe(FINALE_SHAPES);
      // the last contact of the run is the corner: the accent, then the chord
      const contacts = events.filter((e) => e.ringVoice !== "extra");
      expect(contacts[contacts.length - 1].accent, `seed ${seed}`).toBe(true);
      const extras = events.filter((e) => e.ringVoice === "extra");
      expect(extras.map((e) => e.loop), `seed ${seed}`).toEqual(["chime", "chime", "chord"]);
      expect(extras.every((e) => e.melody === false)).toBe(true);
      expect(extras[2].frequency).toBe(BOX_CHORD_HZ);
      expect(extras[0].frequency).toBe(boxChimeHz(0));
      for (const st of view.shapes.values()) expect(st.count).toBe(0);
    }
  });

  it("plans no corner with the countdown off or under gravity, and leaves the first stretch of a run alone", () => {
    const off = boxEngine({ countdown: 0 }, 3);
    runToEnd(off, 40);
    expect(off.getBoxView().cornerHits).toBe(0);
    const heavy = boxEngine({ gravity: 1, countdown: 12 }, 3);
    runToEnd(heavy, 90);
    expect(heavy.getBoxView().cornerHits).toBe(0);
    // with three shapes, the first plan starts only when one is done: the first 10 s (the fingerprint's) are as before
    const engine = boxEngine({}, 12345);
    for (let f = 0; f < 600; f++) engine.update(1000 / 60, 0);
    for (const st of engine.getBoxView().shapes.values()) expect(st.finaleCorner).toBe(-1);
  });

  it("brings twins that fly mirrored (four shapes at 3:4:5) to opposite corners together", () => {
    const engine = boxEngine({ shapeCount: 4 }, 2, { width: 800, height: 450 });
    const { events } = runToEnd(engine);
    expect(engine.isSimulationFinished()).toBe(true);
    expect(engine.getBoxView().cornerHits).toBe(2);
    expect(events.filter((e) => e.ringVoice === "extra").map((e) => e.loop)).toEqual(["chime", "chime", "chime", "chord"]);
  });

  // --- box-finale --- (E4 review) seven shapes or more at three speeds: the slowest group went from three moving to none, cornerless
  it("ends the slowest group's countdowns on corners with seven and twelve shapes, each on its own corner, all of them top ones", () => {
    for (const n of [7, 12]) {
      const start = { ...defaultSettings("box"), ...clipStartSettings("box"), boxShapeCount: n };
      const group = Math.ceil(n / 3); // (4:5:6 over the shapes in turn: the slowest, the first of every three, the last to reach 0)
      for (const world of [
        { width: 800, height: 450 },
        { width: 450, height: 450 },
      ]) {
        for (const seed of [1, 2]) {
          const finder = finderRequestOfSettings(start, world, 40);
          const engine = createEngineForSettings(finder.physicsConfig, finder.mode, finder.modeSettings, seed);
          const planned = new Map<number, number>();
          let sec = 0;
          while (sec < 40 && !engine.isSimulationFinished()) {
            engine.update(1000 / 60, 0);
            engine.consumeSoundEvents();
            sec += 1 / 60;
            for (const st of engine.getBoxView().shapes.values()) if (st.finaleCorner >= 0) planned.set(st.id, st.finaleCorner);
          }
          const where = `${n} shapes, seed ${seed}, ${world.width}`;
          expect(engine.isSimulationFinished(), where).toBe(true);
          expect(engine.getBoxView().cornerHits, where).toBe(group);
          expect(new Set(planned.values()).size, where).toBe(Math.min(group, 2)); // (mirrored twins and triplets: the two top corners)
          for (const corner of planned.values()) expect([BOX_CORNER_TL, BOX_CORNER_TR], where).toContain(corner);
        }
      }
    }
  }, 30_000);

  it("the start look's square box ends on its corner by 27 s on every seed, in a laptop's and a phone's world", () => {
    const start = { ...defaultSettings("box"), ...clipStartSettings("box") };
    expect(clipStartSettings("box")).toEqual({ boxAspect: 1, boxSpeedRatio: "4:5:6", ballSpeed: 575, ballRadius: 11 });
    for (const world of [
      { width: 800, height: 450 },
      { width: 450, height: 450 },
    ]) {
      for (let seed = 1; seed <= 8; seed++) {
        const finder = finderRequestOfSettings(start, world, 40);
        const engine = createEngineForSettings(finder.physicsConfig, finder.mode, finder.modeSettings, seed);
        const { sec } = runToEnd(engine as ReturnType<typeof boxEngine>, 40);
        expect(engine.isSimulationFinished(), `seed ${seed}`).toBe(true);
        expect(sec, `seed ${seed} ${world.width}`).toBeLessThanOrEqual(27);
        expect(engine.getBoxView().cornerHits).toBe(FINALE_SHAPES);
      }
    }
  }, 30_000);
});

describe("box finale: the burst", () => {
  it("throws the same confetti for the same shape on every frame, live and exported", () => {
    expect(burstHash(3, 5, 1)).toBe(burstHash(3, 5, 1));
    expect(burstHash(3, 5, 1)).not.toBe(burstHash(4, 5, 1));
    const values = Array.from({ length: 200 }, (_, i) => burstHash(1, i, 0));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    expect(BURST_MS).toBeLessThanOrEqual(2000);
  });
});

// --- box-digits --- (round two, B8) the countdown digits in a pass of their own over every shape, outlined, moved clear of each other
describe("box digits: a pass of their own over every shape", () => {
  const digit = (x: number, y: number, shapeY = y, fs = 30): BoxDigit => ({ x, y, halfW: 0.6 * fs, halfH: 0.4 * fs, fs, count: 12, shapeY, fill: "#fff" });
  const apart = (a: BoxDigit, b: BoxDigit) => Math.abs(a.x - b.x) >= a.halfW + b.halfW || Math.abs(a.y - b.y) >= a.halfH + b.halfH;

  it("moves a number off the one before it, to the side its shape is on, inside the box; the first keeps its place", () => {
    const a = digit(200, 200);
    const b = digit(210, 205, 230); // its shape lower: it goes under the first number
    const c = digit(195, 198, 150); // its shape higher: it goes over the first number
    const list = [a, b, c];
    placeBoxDigits(list, 3, 100, 400);
    expect([a.x, a.y]).toEqual([200, 200]);
    expect(b.y).toBeCloseTo(200 + a.halfH + DIGIT_GAP * 30 + b.halfH, 9);
    expect(c.y).toBeCloseTo(200 - a.halfH - DIGIT_GAP * 30 - c.halfH, 9);
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) expect(apart(list[i], list[j])).toBe(true);
    // at the foot of the box a number goes over instead; numbers already apart stay where they are
    const d = digit(200, 390);
    const e = digit(205, 392, 395);
    placeBoxDigits([d, e], 2, 100, 400);
    expect(e.y).toBeLessThan(d.y);
    expect(apart(d, e)).toBe(true);
    const f = digit(100, 200);
    const g = digit(300, 200);
    placeBoxDigits([f, g], 2, 100, 400);
    expect(g.y).toBe(200);
  });

  it("draws every number after every shape, outlined in its shape's colour, and none of them on another", () => {
    const engine = boxEngine({ shapeCount: 3, shape: "square" }, 7);
    engine.update(1000 / 60, 0);
    const view = engine.getBoxView();
    const balls = engine.getBalls();
    expect(balls.length).toBe(3);
    // the three shapes on one spot, as they pass through each other
    for (const b of balls) {
      b.x = 300;
      b.y = 300;
    }
    const canvas = fakeCanvas(800, 600);
    const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    const opts = { wallColor: () => "#ffffff", wallThickness: 2, showWallGlow: false, showGlow: false, showTrails: false, trailThickness: 1 };
    drawBoxShapes(ctx, balls, view, opts);
    const names = ctx.calls.map((c) => c.name);
    const texts = ctx.calls.filter((c) => c.name === "fillText");
    expect(texts.length).toBe(3);
    expect(ctx.calls.filter((c) => c.name === "strokeText").length).toBe(3);
    expect(names.indexOf("strokeText")).toBeGreaterThan(names.lastIndexOf("fill"));
    const ys = texts.map((c) => c.args[2] as number).sort((x, y) => x - y);
    const fs = Number(/([\d.]+)px/.exec(String(ctx.font))?.[1] ?? 0);
    expect(fs).toBeGreaterThan(0);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(0.8 * fs - 1e-6);
    const f = view.field!;
    for (const y of ys) expect(y).toBeGreaterThanOrEqual(f.top);
    for (const y of ys) expect(y).toBeLessThanOrEqual(f.bottom);
  });
});

// --- box-digits --- (B-g4 review) the numbers settle in clusters of any size, the top shape keeps its own, and the work is bounded
describe("box digits: clusters, the top shape's own number and the work (B-g4 review)", () => {
  /** A number as drawBoxShapes() notes it: 1 or 2 digits wide (the fake canvas' measure: 0.56 of the size a digit). */
  const digit = (x: number, y: number, fs: number, count: number, shapeY = y): BoxDigit => ({ x, y, halfW: 0.5 * 0.56 * fs * String(count).length + 0.5 * DIGIT_OUTLINE * fs, halfH: 0.5 * DIGIT_BOX_HEIGHT * fs, fs, count, shapeY, fill: "#fff" });
  const apart = (a: BoxDigit, b: BoxDigit) => {
    const gap = DIGIT_GAP * Math.min(a.fs, b.fs);
    return Math.abs(a.x - b.x) >= a.halfW + b.halfW + gap - 1e-9 || Math.abs(a.y - b.y) >= a.halfH + b.halfH + gap - 1e-9;
  };
  /** A fixed pseudo-random sequence (the test is the same every run). */
  const rng = (seed: number) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  it("moves every number of a cluster of 3 to 6, in mixed sizes, clear of every other, near the top and bottom walls too", () => {
    const box = { top: 0, bottom: 480, left: 0, right: 640 };
    const random = rng(20261128);
    for (let trial = 0; trial < 3000; trial++) {
      const n = 3 + Math.floor(random() * 4);
      const where = trial % 3; // the top wall, the bottom wall, the middle
      const cy = where === 0 ? 14 + 20 * random() : where === 1 ? 466 - 20 * random() : 240;
      const cx = 80 + 480 * random();
      const list: BoxDigit[] = [];
      for (let i = 0; i < n; i++) {
        const fs = 18 + 26 * random();
        const count = 1 + Math.floor(random() * 30);
        const y = Math.max(box.top + 0.4 * fs, Math.min(box.bottom - 0.4 * fs, cy + (random() - 0.5) * fs));
        list.push(digit(cx + (random() - 0.5) * fs, y, fs, count, y + (random() - 0.5) * fs));
      }
      const first = { x: list[0].x, y: list[0].y };
      placeBoxDigits(list, n, box.top, box.bottom, box.left, box.right);
      expect(list[0]).toMatchObject(first);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) expect(apart(list[i], list[j])).toBe(true);
        expect(list[i].y - list[i].halfH).toBeGreaterThanOrEqual(box.top - 1e-9);
        expect(list[i].y + list[i].halfH).toBeLessThanOrEqual(box.bottom + 1e-9);
        expect(list[i].x - list[i].halfW).toBeGreaterThanOrEqual(box.left - 1e-9);
        expect(list[i].x + list[i].halfW).toBeLessThanOrEqual(box.right + 1e-9);
      }
    }
    // a pile on one spot settles too, and so does the reviewer's "3 over 12": a third number between two placed apart
    const pile = [0, 1, 2, 3, 4, 5].map((i) => digit(300, 240, i % 2 ? 24 : 36, i % 2 ? 7 : 12));
    placeBoxDigits(pile, pile.length, box.top, box.bottom, box.left, box.right);
    for (let i = 0; i < pile.length; i++) for (let j = i + 1; j < pile.length; j++) expect(apart(pile[i], pile[j])).toBe(true);
    const a = digit(300, 200, 40, 9);
    const b = digit(300, 245, 40, 12);
    const c = digit(302, 222, 30, 3, 260);
    placeBoxDigits([a, b, c], 3, box.top, box.bottom, box.left, box.right);
    expect([apart(a, b), apart(a, c), apart(b, c)]).toEqual([true, true, true]);
    expect(c.y).toBeGreaterThan(b.y); // (its shape is lower: under the whole cluster, not between the two)
  });

  it("keeps the top shape's own number on its body when the shapes share one spot (the start look's first frames)", () => {
    const engine = boxEngine({ shapeCount: 3, shape: "square" }, 7);
    engine.update(1000 / 60, 0);
    const view = engine.getBoxView();
    const balls = engine.getBalls();
    const counts = [23, 17, 9];
    balls.forEach((b, i) => {
      b.x = 300;
      b.y = 300;
      view.shapes.get(b.id)!.count = counts[i];
    });
    const ctx = fakeCanvas(800, 600).getContext("2d") as unknown as CanvasRenderingContext2D & { calls: { name: string; args: unknown[] }[] };
    const opts = { wallColor: () => "#ffffff", wallThickness: 2, showWallGlow: false, showGlow: false, showTrails: false, trailThickness: 1 };
    drawBoxShapes(ctx, balls, view, opts);
    const texts = ctx.calls.filter((c) => c.name === "fillText").map((c) => ({ text: c.args[0] as string, x: c.args[1] as number, y: c.args[2] as number }));
    expect(texts.map((t) => t.text).sort()).toEqual(["17", "23", "9"]);
    // the last ball is drawn on top: its number stays at its centre (and is drawn last), the others move off it
    const own = texts.find((t) => t.text === "9")!;
    expect(own.x).toBe(300);
    for (const t of texts) if (t !== own) expect(Math.abs(t.y - 300)).toBeGreaterThan(Math.abs(own.y - 300));
    expect(texts[texts.length - 1].text).toBe("9");
  });

  it("compares each pair once for numbers well apart, and leaves a box of more than BOX_DIGITS_PLACED numbers on their shapes", () => {
    const spread = (n: number) => Array.from({ length: n }, (_, i) => digit(40 + (i % 100) * 60, 40 + Math.floor(i / 100) * 60, 20, 12));
    const pile = (n: number) => Array.from({ length: n }, (_, i) => digit(500 + (i % 7), 500 + (i % 5), 20, 12));
    const few = spread(BOX_DIGITS_PLACED);
    expect(placeBoxDigits(few, few.length, 0, 1e6, 0, 1e6)).toBe((BOX_DIGITS_PLACED * (BOX_DIGITS_PLACED - 1)) / 2);
    for (const list of [spread(5000), pile(5000), spread(BOX_DIGITS_PLACED + 1)]) {
      const before = list.map((d) => `${d.x},${d.y}`);
      expect(placeBoxDigits(list, list.length, 0, 1e6, 0, 1e6)).toBe(0);
      expect(list.map((d) => `${d.x},${d.y}`)).toEqual(before);
    }
    // a pile of as many as it places: bounded work (each number passes each placed one at most once a way, four ways)
    const heap = pile(BOX_DIGITS_PLACED);
    const work = placeBoxDigits(heap, heap.length, 0, 1e6, 0, 1e6);
    expect(work).toBeLessThanOrEqual(4 * BOX_DIGITS_PLACED ** 3);
    for (let i = 0; i < heap.length; i++) for (let j = i + 1; j < heap.length; j++) expect(apart(heap[i], heap[j])).toBe(true);
  });
});
