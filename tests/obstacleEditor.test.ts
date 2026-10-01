import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  BUMPER_SPEED_CAP,
  DEFAULT_BUMPER_BOOST,
  MAX_OBSTACLES,
  MAX_OBSTACLE_SOUNDS_PER_STEP,
  ObstacleField,
  RING_CAPTURE_MARGIN,
  RING_CAPTURE_SHARE,
  addObstacle,
  applyAffine,
  arenaFrameOf,
  arenaToWorld,
  bumperNote,
  clientToCanvas,
  defaultObstacle,
  invertAffinePoint,
  nextObstacleSpot,
  obstacleConfigOf,
  obstacleReach,
  obstacleNote,
  obstacleSpeedLimit,
  parseObstacles,
  pickObstacle,
  removeObstacle,
  resolveObstacleSettings,
  sanitizeObstacle,
  serializeObstacles,
  supportsObstacles,
  updateObstacle,
  worldToArena,
  type EditorObstacle,
} from "@/lib/physics/obstacleEditor";
import { BUMPER_TONE, scheduleBumperTone } from "@/lib/audio/bumperTone";
import { isTextEntryTarget } from "@/components/simulator/obstacleEditorRenderer";
import type { Ball, PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { MODE_IDS } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

/**
 * The obstacle editor (lib/physics/obstacleEditor.ts): the compact URL form and its validation, the arena ↔ world ↔
 * pointer coordinate mapping the canvas drags with, the list edits of the panel, the engine's field (pegs, bumper kicks,
 * spinners, the sound budget) and determinism of runs with obstacles (the seed finder builds the same run).
 */

const LAYOUT: EditorObstacle[] = [
  { kind: "peg", x: 0.2, y: -0.3, size: 6, angle: 0, rpm: 0 },
  { kind: "bumper", x: -0.4, y: 0.1, size: 8, angle: 0, rpm: 0 },
  { kind: "blocker", x: 0, y: 0.5, size: 40, angle: 30, rpm: 0 },
  { kind: "spinner", x: 0, y: -0.5, size: 50, angle: -45, rpm: 20 },
];

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

/** One engine sub-step (4 per 60 Hz step). */
const DT = 1 / 240;

function ball(x: number, y: number, vx: number, vy: number, radius = 8): Ball {
  return { id: 0, x, y, vx, vy, radius, color: "#fff", trail: [], trailIndex: 0, spin: 0, angle: 0 };
}

function field(list: EditorObstacle[], width = 800, height = 600, bumperBoost = DEFAULT_BUMPER_BOOST) {
  const f = new ObstacleField();
  f.configure({ width, height, editorObstacles: list, bumperBoost });
  return f;
}

describe("obstacle URL form", () => {
  it("serialises compactly and round-trips exactly", () => {
    const text = serializeObstacles(LAYOUT);
    expect(text).toBe("p:0.2,-0.3,6;b:-0.4,0.1,8;k:0,0.5,40,30;s:0,-0.5,50,-45,20");
    expect(parseObstacles(text)).toEqual(LAYOUT);
    expect(serializeObstacles(parseObstacles(text))).toBe(text);
    expect(serializeObstacles([])).toBe("");
    expect(parseObstacles("")).toEqual([]);
    expect(parseObstacles(null)).toEqual([]);
  });

  it("rounds positions to 3 decimals and sizes, angles and rpm to 1, so the stored value is what the URL reads back", () => {
    const o = sanitizeObstacle({ kind: "spinner", x: 0.123456, y: -0.00004, size: 33.33, angle: 190, rpm: -12.345 })!;
    expect(o).toEqual({ kind: "spinner", x: 0.123, y: 0, size: 33.3, angle: -170, rpm: -12.3 });
    expect(Object.is(o.y, -0)).toBe(false);
    expect(parseObstacles(serializeObstacles([o]))).toEqual([o]);
  });

  it("skips garbage, fills missing numbers with the defaults and clamps the rest", () => {
    const list = parseObstacles("p:abc,1;x:1,2,3;b:0.1,0.2;k:5,-5,999,270;s:0,0;q;p:,1;P:0.5,0.5,1");
    expect(list).toEqual([
      { kind: "bumper", x: 0.1, y: 0.2, size: 8, angle: 0, rpm: 0 },
      { kind: "blocker", x: 1.3, y: -1.3, size: 120, angle: -90, rpm: 0 },
      { kind: "spinner", x: 0, y: 0, size: 50, angle: 0, rpm: 20 },
      { kind: "peg", x: 0.5, y: 0.5, size: 2, angle: 0, rpm: 0 },
    ]);
    // Circles carry no angle or spin, blockers no spin.
    expect(sanitizeObstacle({ kind: "peg", x: 0, y: 0, size: 5, angle: 45, rpm: 30 })).toEqual({ kind: "peg", x: 0, y: 0, size: 5, angle: 0, rpm: 0 });
    expect(sanitizeObstacle({ kind: "blocker", x: 0, y: 0, size: 30, angle: 45, rpm: 30 })!.rpm).toBe(0);
    expect(sanitizeObstacle({ kind: "wall", x: 0, y: 0 })).toBeNull();
    expect(sanitizeObstacle(null)).toBeNull();
    // At most MAX_OBSTACLES.
    const many = Array.from({ length: 40 }, (_, i) => `p:${(i / 100).toFixed(2)},0,5`).join(";");
    expect(parseObstacles(many)).toHaveLength(MAX_OBSTACLES);
  });

  it("travels in the settings URL (obs, obb) and is left out when empty or default", () => {
    const plain = settingsToSearchParams(defaultSettings("classic"));
    expect(plain.has("obs")).toBe(false);
    expect(plain.has("obb")).toBe(false);
    expect(settingsFromSearchParams(plain).obstacles).toEqual([]);

    const s = { ...defaultSettings("shatter"), obstacles: LAYOUT, bumperBoost: 1.75 };
    const params = settingsToSearchParams(s);
    expect(params.get("obs")).toBe("p:0.2,-0.3,6;b:-0.4,0.1,8;k:0,0.5,40,30;s:0,-0.5,50,-45,20");
    expect(params.get("obb")).toBe("1.75");
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect(back).toEqual(s);

    const bad = settingsFromSearchParams(new URLSearchParams("mode=classic&obs=z:1,2&obb=9"));
    expect(bad.obstacles).toEqual([]);
    expect(bad.bumperBoost).toBe(9); // --- uncap-all --- (obb=9 kept)
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&obb=abc")).bumperBoost).toBe(DEFAULT_BUMPER_BOOST);
  });

  it("is validated in presets", () => {
    const loaded = presetToSettings({ mode: "classic", obstacles: [{ kind: "peg", x: 3, y: "0.5", size: 100 }, { kind: "nope" }, LAYOUT[3]] as unknown as EditorObstacle[], bumperBoost: 0.2 });
    expect(loaded.obstacles).toEqual([{ kind: "peg", x: 1.3, y: 0.5, size: 25, angle: 0, rpm: 0 }, LAYOUT[3]]);
    expect(loaded.bumperBoost).toBe(1);
    // An old preset without the fields gets the defaults.
    const old = presetToSettings({ mode: "portal" });
    expect(old.obstacles).toEqual([]);
    expect(old.bumperBoost).toBe(DEFAULT_BUMPER_BOOST);
    expect(resolveObstacleSettings(null)).toEqual({ obstacles: [], bumperBoost: DEFAULT_BUMPER_BOOST });
  });
});

describe("obstacle list edits", () => {
  it("adds on free spots away from the centre and from each other", () => {
    let list: EditorObstacle[] = [];
    for (let i = 0; i < 10; i++) list = addObstacle(list, i % 2 ? "bumper" : "peg");
    expect(list).toHaveLength(10);
    expect(list[0]).toEqual(defaultObstacle("peg", 0, -0.3));
    for (let i = 0; i < list.length; i++) {
      expect(Math.hypot(list[i].x, list[i].y)).toBeGreaterThan(0.2);
      for (let j = 0; j < i; j++) expect(Math.hypot(list[i].x - list[j].x, list[i].y - list[j].y) - obstacleReach(list[i]) - obstacleReach(list[j])).toBeGreaterThanOrEqual(0.1 - 1e-9);
    }
    // A spinner's sweep counts: nothing new is put inside its circle.
    const spinner = defaultObstacle("spinner", 0, -0.3);
    const next = nextObstacleSpot([spinner], "peg");
    expect(Math.hypot(next.x - spinner.x, next.y - spinner.y)).toBeGreaterThanOrEqual(0.25 + 0.05 + 0.1 - 1e-9);
    const full = Array.from({ length: MAX_OBSTACLES }, () => defaultObstacle("peg"));
    expect(addObstacle(full, "spinner")).toHaveLength(MAX_OBSTACLES);
    expect(nextObstacleSpot(full)).toEqual({ x: 0, y: -0.3 });
    // No spot is free: the one with the most room (on the outer ring, away from a huge bar across the middle).
    const crowded = [{ kind: "blocker" as const, x: 0, y: 0, size: 120, angle: 0, rpm: 0 }];
    const spot = nextObstacleSpot(crowded, "bumper");
    expect(Math.hypot(spot.x, spot.y)).toBeCloseTo(0.9, 3);
  });

  it("updates (validated) and removes by index without touching the others", () => {
    const moved = updateObstacle(LAYOUT, 1, { x: 9, size: 12.34 });
    expect(moved[1]).toEqual({ kind: "bumper", x: 1.3, y: 0.1, size: 12.3, angle: 0, rpm: 0 });
    expect(moved[0]).toBe(LAYOUT[0]);
    expect(removeObstacle(LAYOUT, 2).map((o) => o.kind)).toEqual(["peg", "bumper", "spinner"]);
    expect(LAYOUT).toHaveLength(4);
  });

  it("plays in the ring modes only", () => {
    expect(MODE_IDS.filter(supportsObstacles)).toEqual(["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow"]);
    expect(supportsObstacles(null)).toBe(false);
  });
});

describe("coordinate mapping", () => {
  it("maps arena radii to world pixels and back, scaling with the canvas", () => {
    const frame = arenaFrameOf(800, 600);
    expect(frame).toEqual({ cx: 400, cy: 300, radius: 225 });
    expect(arenaToWorld(frame, 1, 0)).toEqual({ x: 625, y: 300 });
    expect(arenaToWorld(frame, -0.5, 0.2)).toEqual({ x: 287.5, y: 345 });
    const back = worldToArena(frame, 287.5, 345);
    expect(back.x).toBeCloseTo(-0.5, 12);
    expect(back.y).toBeCloseTo(0.2, 12);
    // A portrait canvas: the arena follows the narrow side.
    const tall = arenaFrameOf(400, 900);
    expect(tall.radius).toBe(150);
    expect(arenaToWorld(tall, 0.2, -0.3)).toEqual({ x: 230, y: 405 });
  });

  it("maps a pointer through a CSS-scaled canvas and the drawing transform back to world and arena coordinates", () => {
    // A 400×300 CSS canvas at (10, 20) with a device pixel ratio of 2 (backing store 800×600).
    const rect = { left: 10, top: 20, width: 400, height: 300 };
    expect(clientToCanvas(210, 170, rect, 800, 600)).toEqual({ x: 400, y: 300 });
    // The world transform: dpr 2, then a camera that zooms 1.5× around (200, 150) and shifts by (12, −8).
    const z = 1.5;
    const m = { a: 2 * z, b: 0, c: 0, d: 2 * z, e: 2 * (200 - 200 * z + 12), f: 2 * (150 - 150 * z - 8) };
    const frame = arenaFrameOf(400, 300);
    for (const [ax, ay] of [
      [0.3, -0.4],
      [-1.1, 0.95],
      [0, 0],
    ]) {
      const world = arenaToWorld(frame, ax, ay);
      const px = applyAffine(m, world.x, world.y);
      const client = { x: rect.left + (px.x * rect.width) / 800, y: rect.top + (px.y * rect.height) / 600 };
      const canvasPt = clientToCanvas(client.x, client.y, rect, 800, 600);
      const w = { x: 0, y: 0 };
      expect(invertAffinePoint(m, canvasPt.x, canvasPt.y, w)).toBe(true);
      expect(w.x).toBeCloseTo(world.x, 9);
      expect(w.y).toBeCloseTo(world.y, 9);
      const rel = worldToArena(frame, w.x, w.y);
      expect(rel.x).toBeCloseTo(ax, 9);
      expect(rel.y).toBeCloseTo(ay, 9);
    }
    // A rotated transform inverts too; a singular one refuses.
    const rot = { a: Math.cos(0.3), b: Math.sin(0.3), c: -Math.sin(0.3), d: Math.cos(0.3), e: 5, f: -7 };
    const p = applyAffine(rot, 12, 34);
    const q = { x: 0, y: 0 };
    expect(invertAffinePoint(rot, p.x, p.y, q)).toBe(true);
    expect(q.x).toBeCloseTo(12, 9);
    expect(q.y).toBeCloseTo(34, 9);
    expect(invertAffinePoint({ a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }, 1, 1, q)).toBe(false);
    expect(clientToCanvas(5, 5, { left: 0, top: 0, width: 0, height: 0 }, 800, 600)).toEqual({ x: 0, y: 0 });
  });

  it("picks the topmost obstacle under a point, with the slop around it", () => {
    const f = field(LAYOUT);
    const frame = f.frame;
    const peg = arenaToWorld(frame, 0.2, -0.3);
    expect(pickObstacle(f.items, peg.x, peg.y, 0)).toBe(0);
    const pegRadius = 0.06 * frame.radius;
    expect(pickObstacle(f.items, peg.x + pegRadius + 3, peg.y, 0)).toBe(-1);
    expect(pickObstacle(f.items, peg.x + pegRadius + 3, peg.y, 6)).toBe(0);
    // Along the blocker (30°, 40 % long), near its end.
    const bar = arenaToWorld(frame, 0, 0.5);
    const along = 0.18 * frame.radius;
    expect(pickObstacle(f.items, bar.x + along * Math.cos(Math.PI / 6), bar.y + along * Math.sin(Math.PI / 6), 2)).toBe(2);
    expect(pickObstacle(f.items, bar.x + along * Math.cos(Math.PI / 6), bar.y + along * Math.sin(Math.PI / 6) - 30, 2)).toBe(-1);
    // Two overlapping pegs: the later one is on top.
    const g = field([defaultObstacle("peg", 0.1, 0.1), defaultObstacle("peg", 0.1, 0.1)]);
    const at = arenaToWorld(g.frame, 0.1, 0.1);
    expect(pickObstacle(g.items, at.x, at.y, 0)).toBe(1);
  });
});

describe("canvas editing keys", () => {
  it("leaves Backspace / Delete to text fields only: a slider, toggle, dropdown or button the panel left focused does not keep them", () => {
    // Typing: the key belongs to the field.
    for (const type of ["text", "search", "number", "email", "url", "tel", "password", "TEXT"]) expect(isTextEntryTarget({ tagName: "INPUT", type })).toBe(true);
    expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true); // an input without a type is a text field
    expect(isTextEntryTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
    // The panel's sliders (a row's Size, the Bumper Boost), toggles, colour pickers, dropdowns and buttons: the key deletes the selected obstacle.
    for (const type of ["range", "checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]) expect(isTextEntryTarget({ tagName: "INPUT", type })).toBe(false);
    for (const tagName of ["SELECT", "BUTTON", "BODY", "CANVAS"]) expect(isTextEntryTarget({ tagName })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("the obstacle field", () => {
  it("builds pixel obstacles from the arena-relative layout and rebuilds only on a change", () => {
    const f = field(LAYOUT);
    expect(f.count).toBe(4);
    expect(f.kinds).toEqual(["peg", "bumper", "blocker", "spinner"]);
    const [peg, bumper, blocker, spinner] = f.items;
    expect(peg).toMatchObject({ kind: "circle", x: 400 + 0.2 * 225, y: 300 - 0.3 * 225 });
    expect(peg.kind === "circle" && peg.radius).toBeCloseTo(0.06 * 225, 9);
    expect(bumper.kind === "circle" && bumper.restitution).toBe(1);
    expect(blocker.kind === "segment" && blocker.halfLength).toBeCloseTo(0.2 * 225, 9);
    expect(blocker.kind === "segment" && blocker.angle).toBeCloseTo(Math.PI / 6, 12);
    expect(blocker.kind === "segment" && blocker.angularVelocity).toBe(0);
    expect(spinner.kind === "segment" && spinner.angularVelocity).toBeCloseTo((20 * 2 * Math.PI) / 60, 12);
    // Same list, same size: nothing to do; a resize scales everything.
    expect(f.configure({ width: 800, height: 600, editorObstacles: LAYOUT })).toBe(false);
    expect(f.configure({ width: 1600, height: 1200, editorObstacles: LAYOUT })).toBe(true);
    expect(f.items[0]).toMatchObject({ x: 800 + 0.2 * 450, y: 600 - 0.3 * 450 });
    expect(f.items[0].kind === "circle" && f.items[0].radius).toBeCloseTo(0.06 * 450, 9);
    // The boost is taken without a rebuild, validated.
    expect(f.configure({ width: 1600, height: 1200, editorObstacles: LAYOUT, bumperBoost: 5 })).toBe(false);
    expect(f.bumperBoost).toBe(2);
    expect(f.configure({ width: 1600, height: 1200, editorObstacles: [] })).toBe(true);
    expect(f.count).toBe(0);
  });

  it("turns spinners with advance(), keeps their angle through a move and resets them for a new run", () => {
    const list = [{ kind: "spinner" as const, x: 0, y: 0, size: 50, angle: 0, rpm: 60 }];
    const f = field(list);
    const bar = f.items[0];
    for (let i = 0; i < 60; i++) f.advance(1 / 240); // a quarter of a second at one revolution per second
    expect(bar.kind === "segment" && bar.angle).toBeCloseTo(Math.PI / 2, 9);
    // Dragged somewhere else (same angle and rpm): it keeps turning from where it is.
    f.configure({ width: 800, height: 600, editorObstacles: [{ ...list[0], x: 0.3 }] });
    const moved = f.items[0];
    expect(moved.kind === "segment" && moved.angle).toBeCloseTo(Math.PI / 2, 9);
    expect(moved.x).toBeCloseTo(400 + 0.3 * 225, 9);
    f.reset();
    expect(moved.kind === "segment" && moved.angle).toBe(0);
    // A new start angle is taken as it is.
    f.configure({ width: 800, height: 600, editorObstacles: [{ ...list[0], angle: 90 }] });
    expect(f.items[0].kind === "segment" && f.items[0].angle).toBeCloseTo(Math.PI / 2, 12);
  });

  it("bounces a ball off a peg, lights it and queues its note", () => {
    const f = field([defaultObstacle("peg", 0, 0)]); // radius 11.25 px at (400, 300)
    const events: SoundEvent[] = [];
    const b = ball(400, 300 - 19, 0, 300); // 0.25 px into it, falling
    f.beginStep();
    f.collide(b, DT, 1, 40, 400, 1234, events);
    expect(b.vy).toBeCloseTo(-300 * 0.95, 9);
    expect(b.y).toBeLessThan(300 - 19.25);
    expect(f.lastHitMs[0]).toBe(1234);
    expect(f.hitCount).toBe(1);
    expect(f.bumpCount).toBe(0);
    expect(events).toEqual([{ type: "hit", wallIndex: 0, frequency: obstacleNote(0) }]);
    // A soft contact is resolved but is no hit.
    const soft = ball(400, 300 - 19, 0, 20);
    f.collide(soft, DT, 1, 40, 400, 2000, events);
    expect(soft.vy).toBeLessThan(0);
    expect(f.hitCount).toBe(1);
    expect(events).toHaveLength(1);
  });

  it("makes a bumper multiply the ball speed by the boost, capped, with the ding event", () => {
    const f = field([defaultObstacle("bumper", 0, 0)], 800, 600, 1.5); // radius 18 px
    const events: SoundEvent[] = [];
    const b = ball(400, 300 - 25.5, 0, 400); // 0.5 px into it
    f.beginStep();
    f.collide(b, DT, 1, 40, 400, 50, events);
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(600, 9);
    expect(b.vy).toBeLessThan(0);
    expect(f.bumpCount).toBe(1);
    expect(events).toEqual([{ type: "hit", wallIndex: 0, frequency: bumperNote(0), accent: true, bumper: true }]);
    // Never past BUMPER_SPEED_CAP × the ball speed setting …
    const fast = ball(400, 300 - 25.5, 0, 1000);
    const g = field([defaultObstacle("bumper", 0, 0)], 800, 600, 2);
    g.collide(fast, DT, 1, 40, 400, 0, events);
    expect(Math.hypot(fast.vx, fast.vy)).toBeCloseTo(BUMPER_SPEED_CAP * 400, 9);
    // … and a ball already faster than that is not slowed down by the cap (only the restitution cap of the rebound).
    const faster = ball(400, 300 - 25.5, 0, 2000);
    g.collide(faster, DT, 1, 40, 400, 0, events);
    expect(Math.hypot(faster.vx, faster.vy)).toBeCloseTo(2000 * 0.98, 6);
    // A boost of 1 gives the ball its speed back exactly: an elastic bumper.
    const one = field([defaultObstacle("bumper", 0, 0)], 800, 600, 1);
    const c = ball(400 + 5, 300 - 25, 0, 400);
    one.collide(c, DT, 1, 40, 400, 0, events);
    expect(Math.hypot(c.vx, c.vy)).toBeCloseTo(400, 9);
  });

  it("never lets a spinner fling or a bumper kick carry the ball past a ring's capture band in one sub-step", () => {
    // A ring catches a ball whose centre lands within radius + RING_CAPTURE_MARGIN px of it: at most RING_CAPTURE_SHARE of that per sub-step.
    expect(obstacleSpeedLimit(400, 8, 400, DT)).toBeCloseTo(BUMPER_SPEED_CAP * 400, 9); // the 3× cap is the tighter one
    expect(obstacleSpeedLimit(400, 4, 800, DT)).toBeCloseTo((RING_CAPTURE_SHARE * (4 + RING_CAPTURE_MARGIN)) / DT, 9); // 1296 px/s < 2400
    expect(obstacleSpeedLimit(3000, 30, 400, DT)).toBe(3000); // a faster ball keeps what it had, within the band
    // A spinner at the slider maximums (120 % long, 120 rpm) around the ball: its tip moves at ~2,260 px/s.
    const spinner = field([{ kind: "spinner", x: 0, y: 0, size: 120, angle: 0, rpm: 120 }], 800, 800);
    const bar = spinner.items[0];
    const events: SoundEvent[] = [];
    let fastest = 0;
    for (let i = 0; i < 64; i++) {
      // A ball near the bar's outer end on the side its surface turns towards, just into it and moving onto it at the
      // ball speed: the bar meets it at ~2,000 px/s.
      const along = 150 + (i % 8) * 4;
      const a = (i / 64) * 2 * Math.PI;
      if (bar.kind === "segment") bar.angle = a;
      const nx = -Math.sin(a);
      const ny = Math.cos(a);
      const b = ball(400 + along * Math.cos(a) + nx * 12, 400 + along * Math.sin(a) + ny * 12, -nx * 400, -ny * 400);
      spinner.beginStep();
      spinner.collide(b, DT, 1, 40, 400, 0, events);
      fastest = Math.max(fastest, Math.hypot(b.vx, b.vy));
    }
    expect(fastest).toBeGreaterThan(400); // it still flings
    expect(fastest).toBeLessThanOrEqual(obstacleSpeedLimit(400, 8, 400, DT) + 1e-6);
    // Bumpers at boost 2 with ball speed 800 and size 4: the kick stops at the band, not at 3 × 800.
    const bumper = field([defaultObstacle("bumper", 0, 0)], 800, 600, 2);
    const small = ball(400, 300 - 21.5, 0, 1000, 4); // 0.5 px into an 18 px bumper
    bumper.collide(small, DT, 1, 40, 800, 0, events);
    expect(bumper.bumpCount).toBe(1);
    expect(Math.hypot(small.vx, small.vy)).toBeCloseTo((RING_CAPTURE_SHARE * 6) / DT, 6);
    expect((Math.hypot(small.vx, small.vy) * DT) / (small.radius + RING_CAPTURE_MARGIN)).toBeLessThan(1);
  });

  it("queues at most MAX_OBSTACLE_SOUNDS_PER_STEP sounds per step, while every hit still counts", () => {
    const f = field([defaultObstacle("peg", 0, 0)]);
    const events: SoundEvent[] = [];
    f.beginStep();
    for (let i = 0; i < 10; i++) f.collide(ball(400, 300 - 19, 0, 300), DT, 1, 40, 400, i, events);
    expect(events).toHaveLength(MAX_OBSTACLE_SOUNDS_PER_STEP);
    expect(f.hitCount).toBe(10);
    f.beginStep();
    f.collide(ball(400, 300 - 19, 0, 300), DT, 1, 40, 400, 99, events);
    expect(events).toHaveLength(MAX_OBSTACLE_SOUNDS_PER_STEP + 1);
  });
});

describe("obstacles in the engine", () => {
  /** A ring of bumpers and pegs around the start and a spinner, so the ball meets them within a second whatever the seed. */
  const RING: EditorObstacle[] = [
    ...Array.from({ length: 8 }, (_, i) => defaultObstacle(i % 2 ? "bumper" : "peg", 0.35 * Math.cos((i * Math.PI) / 4), 0.35 * Math.sin((i * Math.PI) / 4))),
    { kind: "spinner", x: 0, y: 0.7, size: 60, angle: 0, rpm: 45 },
  ];
  const withObstacles: PhysicsConfig = { ...config, ...obstacleConfigOf({ obstacles: RING, bumperBoost: 1.6 }) };

  function trace(engine: PhysicsEngine, frames: number) {
    const out: number[][] = [];
    for (let i = 0; i < frames; i++) {
      engine.update(1000 / 60, 0);
      if (i % 30 === 0) out.push(engine.getBalls().flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
    }
    return out;
  }

  it("are in play in the ring modes only", () => {
    for (const mode of MODE_IDS) {
      const engine = createEngineForSettings(withObstacles, mode, modeSettings, 7);
      expect(engine.getEditorObstacles() !== null).toBe(supportsObstacles(mode));
    }
    expect(createEngineForSettings(config, "classic", modeSettings, 7).getEditorObstacles()).toBeNull();
  });

  it("are hit, kick and replay identically for a seed – also when set after the mode init, as the page does", () => {
    const a = createEngineForSettings(withObstacles, "classic", modeSettings, 4242);
    const b = createEngineForSettings(withObstacles, "classic", modeSettings, 4242);
    // The page builds its engine without the obstacles, inits the mode and then sets them through setConfig().
    const page = new PhysicsEngine({ ...config });
    page.setSeed(4242);
    page.initMode("classic");
    page.setConfig(obstacleConfigOf({ obstacles: RING, bumperBoost: 1.6 }));
    const ta = trace(a, 600);
    expect(trace(b, 600)).toEqual(ta);
    expect(trace(page, 600)).toEqual(ta);
    const field = a.getEditorObstacles()!;
    expect(field.hitCount).toBeGreaterThan(0);
    expect(field.hitCount).toBe(page.getEditorObstacles()!.hitCount);
    // The obstacles change the run.
    const plain = createEngineForSettings(config, "classic", modeSettings, 4242);
    expect(trace(plain, 600)).not.toEqual(ta);
  });

  it("start every run afresh: spinners back at their start angle, counters cleared", () => {
    const engine = createEngineForSettings(withObstacles, "shatter", modeSettings, 99);
    for (let i = 0; i < 120; i++) engine.update(1000 / 60, 0);
    const field = engine.getEditorObstacles()!;
    const spinner = field.items[8];
    expect(spinner.kind === "segment" && spinner.angle).not.toBe(0);
    engine.initMode("shatter");
    expect(spinner.kind === "segment" && spinner.angle).toBe(0);
    expect(field.hitCount).toBe(0);
  });

  /**
   * Runs `seconds` of a mode with `list` on a square canvas and returns the first time (s) a ball's centre changed sides of
   * a ring that is still intact after the step (−1 = never): a pass through a gap breaks the ring in these modes, anything
   * else is a tunnel.
   */
  function firstTunnel(mode: "grow" | "lines" | "classic", list: EditorObstacle[], seed: number, seconds: number, size = 800, patch: Partial<PhysicsConfig> = {}, boost = 1.3) {
    const cfg: PhysicsConfig = { ...config, width: size, height: size, ...patch, ...obstacleConfigOf({ obstacles: list, bumperBoost: boost }) };
    const engine = createEngineForSettings(cfg, mode, modeSettings, seed);
    const cx = size / 2;
    const cy = size / 2;
    const prev = new Map<number, number>();
    for (let i = 0; i < seconds * 60; i++) {
      engine.update(1000 / 60, 0);
      const walls = engine.getCircularWalls();
      const broken = engine.getBrokenWalls();
      for (const b of engine.getBalls()) {
        const d = Math.hypot(b.x - cx, b.y - cy);
        const p = prev.get(b.id);
        if (p !== undefined) {
          for (let w = 0; w < walls.length; w++) {
            if (broken.has(w)) continue;
            if (p < walls[w].radius !== d < walls[w].radius) return i / 60;
          }
        }
        prev.set(b.id, d);
      }
    }
    return -1;
  }

  it("keep a grown ball inside Grow's sealed ring: a spinner's push-out never carries it across", () => {
    // The first spinner the panel adds (s:0,-0.3,50,0,20) used to eject the grown ball 10–40 s into every run.
    const spinner = addObstacle([], "spinner");
    expect(serializeObstacles(spinner)).toBe("s:0,-0.3,50,0,20");
    for (const seed of [1, 42, 4242]) expect(firstTunnel("grow", spinner, seed, 45)).toBe(-1);
    expect(firstTunnel("grow", spinner, 7, 45, 600)).toBe(-1);
    // And the grown ball still fills its ring.
    const engine = createEngineForSettings({ ...config, width: 800, height: 800, ...obstacleConfigOf({ obstacles: spinner, bumperBoost: 1.3 }) }, "grow", modeSettings, 12345);
    for (let i = 0; i < 45 * 60; i++) engine.update(1000 / 60, 0);
    const b = engine.getBalls()[0];
    const R = engine.getCircularWalls()[0].radius;
    expect(b.radius).toBeGreaterThan(0.9 * R);
    expect(Math.hypot(b.x - 400, b.y - 400) + b.radius).toBeLessThan(R + 3);
  });

  it("keep the ball inside the rings with a spinner at full speed and length, and with hard bumpers on a small fast ball", () => {
    const maxSpinner = parseObstacles("s:0,0.3,120,0,120");
    for (const seed of [1, 2, 3]) {
      expect(firstTunnel("lines", maxSpinner, seed, 20)).toBe(-1);
      expect(firstTunnel("classic", maxSpinner, seed, 20)).toBe(-1);
    }
    let bumpers: EditorObstacle[] = [];
    for (let i = 0; i < 6; i++) bumpers = addObstacle(bumpers, "bumper");
    for (const seed of [1, 2]) {
      expect(firstTunnel("lines", bumpers, seed, 20, 800, { ballSpeed: 800, ballRadius: 4 }, 2)).toBe(-1);
      expect(firstTunnel("classic", bumpers, seed, 20, 800, { ballSpeed: 800, ballRadius: 4 }, 2)).toBe(-1);
    }
  });

  it("queue bumper dings as sound events", () => {
    const engine = createEngineForSettings({ ...config, ...obstacleConfigOf({ obstacles: RING.slice(0, 8).map((o) => ({ ...o, kind: "bumper" as const })), bumperBoost: 1.2 }) }, "classic", modeSettings, 5);
    const events: SoundEvent[] = [];
    for (let i = 0; i < 300; i++) {
      engine.update(1000 / 60, 0);
      events.push(...engine.consumeSoundEvents());
    }
    expect(engine.getEditorObstacles()!.bumpCount).toBeGreaterThan(0);
    expect(events.some((e) => e.bumper === true && e.type === "hit" && e.frequency !== undefined)).toBe(true);
  });
});

describe("bumper ding", () => {
  it("schedules a pitched body with an attack blip and a shorter upper partial, snapped to the scale", () => {
    const oscillators: { type: string; value: number; ramps: number[]; start: number; stop: number }[] = [];
    const param = (store: { value: number; ramps: number[] }) => ({
      set value(v: number) {
        store.value = v;
      },
      get value() {
        return store.value;
      },
      setValueAtTime: () => {},
      linearRampToValueAtTime: () => {},
      exponentialRampToValueAtTime: (v: number) => {
        store.ramps.push(v);
      },
    });
    const ctx = {
      createOscillator() {
        const o = { type: "", value: 0, ramps: [] as number[], start: 0, stop: 0 };
        oscillators.push(o);
        return {
          set type(t: string) {
            o.type = t;
          },
          frequency: param(o),
          connect: () => {},
          start: (t: number) => {
            o.start = t;
          },
          stop: (t: number) => {
            o.stop = t;
          },
        };
      },
      createGain() {
        return { gain: param({ value: 0, ramps: [] }), connect: () => {} };
      },
    } as unknown as BaseAudioContext;
    scheduleBumperTone(ctx, {} as AudioNode, 1000, 2, () => 1046.5);
    expect(oscillators).toHaveLength(2);
    const [body, partial] = oscillators;
    expect(body.type).toBe("sine");
    expect(body.ramps).toEqual([1046.5]); // the blip lands on the snapped pitch
    expect(body.start).toBe(2);
    expect(body.stop).toBeCloseTo(2 + BUMPER_TONE.duration + 0.02, 9);
    expect(partial.type).toBe("triangle");
    expect(partial.value).toBeCloseTo(1046.5 * BUMPER_TONE.partialRatio, 9);
    expect(partial.stop).toBeLessThan(body.stop);
  });
});
