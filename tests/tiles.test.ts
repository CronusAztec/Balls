import { describe, expect, it } from "vitest";
import {
  TILE_HP_EPSILON,
  TILE_MAX_CONTACTS,
  TILE_PITCH_OCTAVES,
  TILE_RECT,
  TILE_ROOT_MIDI,
  TILE_SECTOR,
  TILE_SEPARATION,
  TileField,
  tileFrequency,
  tileMidi,
} from "@/lib/physics/tiles";
import { MAX_OBSTACLE_RESTITUTION } from "@/lib/physics/obstacles";
import { SCALE_INTERVALS, midiToFrequency } from "@/lib/audio/scales";
import type { Ball } from "@/lib/physics/types";

/*
 * --- tiles --- The destructible tiles with hit points (lib/physics/tiles.ts), the Blueprint interpreter's shared primitive:
 * layouts and their capacity, the exact geometry of rects and annular sectors (against independent formulas), reflection,
 * no tunnelling at 5,000 px/s and beyond, a ball never ending a sub-step inside a standing tile, hit points and breaks,
 * determinism, the broadphase against brute force (bit for bit), and the work a 600-tile, 400-ball field costs (counted,
 * never timed).
 */

/* ------------------------------------------------------------------ helpers */

const TWO_PI = Math.PI * 2;
/** One engine sub-step at 60 Hz with 4 sub-steps. */
const SUB = 1 / 240;

function ball(x: number, y: number, vx: number, vy: number, radius = 6): Ball {
  return { id: 1, x, y, vx, vy, radius, color: "#ffffff", trail: [], trailIndex: 0, spin: 0, angle: 0 };
}

/** What the engine does before a mode's onBallStep(): the ball moves by its velocity; then the field resolves it. */
function step(field: TileField, b: Ball, dt = SUB, restitution = 1, gravity = 0): number {
  b.vy += gravity * dt;
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  return field.collide(b, dt, restitution);
}

/** Mulberry32, the engine's generator (a test's own, seeded). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The angle of (x, y) from the centre in [0, 2π). */
const angleOf = (x: number, y: number) => {
  const a = Math.atan2(y, x);
  return a < 0 ? a + TWO_PI : a;
};
/** `a` past `a0` going clockwise on screen, in [0, 2π). */
const offset = (a: number, a0: number) => {
  let d = (a - a0) % TWO_PI;
  if (d < 0) d += TWO_PI;
  return d;
};

/** Distance from (px, py) to the segment (ax, ay)–(bx, by). */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const ex = bx - ax;
  const ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * ex), py - (ay + t * ey));
}

/** Distance from (px, py) to the arc of radius R around (cx, cy) from a0 over span (independent of the field's code). */
function arcDist(px: number, py: number, cx: number, cy: number, R: number, a0: number, span: number) {
  const a = angleOf(px - cx, py - cy);
  if (span >= TWO_PI || offset(a, a0) <= span) return Math.abs(Math.hypot(px - cx, py - cy) - R);
  const e0 = Math.hypot(px - (cx + R * Math.cos(a0)), py - (cy + R * Math.sin(a0)));
  const e1 = Math.hypot(px - (cx + R * Math.cos(a0 + span)), py - (cy + R * Math.sin(a0 + span)));
  return Math.min(e0, e1);
}

/** The reference signed distance to a tile, from polar containment and the distances to its boundary pieces. */
function refDistance(f: TileField, i: number, x: number, y: number): number {
  if (f.kind[i] === TILE_RECT) {
    const inside = x > f.x0[i] && x < f.x1[i] && y > f.y0[i] && y < f.y1[i];
    if (inside) return -Math.min(x - f.x0[i], f.x1[i] - x, y - f.y0[i], f.y1[i] - y);
    const dx = Math.max(f.x0[i] - x, 0, x - f.x1[i]);
    const dy = Math.max(f.y0[i] - y, 0, y - f.y1[i]);
    return Math.hypot(dx, dy);
  }
  const cx = f.cx[i];
  const cy = f.cy[i];
  const r0 = f.r0[i];
  const r1 = f.r1[i];
  const a0 = f.a0[i];
  const span = f.span[i];
  const rho = Math.hypot(x - cx, y - cy);
  const full = span >= TWO_PI;
  const inSpan = full || offset(angleOf(x - cx, y - cy), a0) <= span;
  const inside = inSpan && rho > r0 && rho < r1;
  let d = arcDist(x, y, cx, cy, r1, a0, span);
  if (r0 > 0) d = Math.min(d, arcDist(x, y, cx, cy, r0, a0, span));
  if (!full) {
    for (const a of [a0, a0 + span]) d = Math.min(d, segDist(x, y, cx + r0 * Math.cos(a), cy + r0 * Math.sin(a), cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)));
  }
  return inside ? -d : d;
}

/** The deepest a ball is inside any standing tile (≤ 0 when it is clear of them all). */
function worstPenetration(f: TileField, b: Ball): number {
  let worst = -Infinity;
  for (let i = 0; i < f.count; i++) {
    if (!f.alive[i]) continue;
    worst = Math.max(worst, b.radius - f.distanceTo(i, b.x, b.y));
  }
  return worst;
}

/** A closed box of four wall tiles (hit points a test never takes) around [x0, x1] × [y0, y1], `t` thick; returns their indices. */
function walls(f: TileField, x0: number, y0: number, x1: number, y1: number, t = 20): number[] {
  const out = [f.addRect(x0 - t, y0 - t, x1 + t, y0, 1e9, 99, 0), f.addRect(x0 - t, y1, x1 + t, y1 + t, 1e9, 99, 1), f.addRect(x0 - t, y0, x0, y1, 1e9, 99, 2), f.addRect(x1, y0, x1 + t, y1, 1e9, 99, 3)];
  f.build();
  return out;
}

/* ------------------------------------------------------------------ building and layouts */

describe("TileField: building", () => {
  it("is sized once by its capacity (a whole number ≥ 1)", () => {
    expect(new TileField(600).capacity).toBe(600);
    expect(new TileField(12.7).capacity).toBe(12);
    expect(() => new TileField(0)).toThrow(RangeError);
    expect(() => new TileField(Number.NaN)).toThrow(RangeError);
    expect(() => new TileField(Infinity)).toThrow(RangeError);
    const f = new TileField(3);
    expect(f.kind.length).toBe(3);
    expect(f.hp.length).toBe(3);
    expect(f.view).toBe(f);
  });

  it("adds rects and refuses the meaningless ones and those past the capacity", () => {
    const f = new TileField(2);
    expect(f.addRect(0, 0, 0, 10, 1)).toBe(-1); // empty
    expect(f.addRect(0, 0, 10, 10, 0)).toBe(-1); // no hit points
    expect(f.addRect(0, 0, 10, Number.NaN, 1)).toBe(-1);
    expect(f.addRect(0, 0, 10, 10, Infinity)).toBe(-1);
    expect(f.addRect(10, 20, 30, 50, 3, 2, 5)).toBe(0);
    expect([f.kind[0], f.x0[0], f.y0[0], f.x1[0], f.y1[0], f.px[0], f.py[0], f.hp[0], f.maxHp[0], f.row[0], f.col[0], f.alive[0]]).toEqual([TILE_RECT, 10, 20, 30, 50, 20, 35, 3, 3, 2, 5, 1]);
    expect(f.addRect(0, 0, 1, 1, 1)).toBe(1);
    expect(f.addRect(0, 0, 1, 1, 1)).toBe(-1); // full
    expect([f.count, f.aliveTotal, f.rows, f.cols, f.hpTotal, f.hpLeft]).toEqual([2, 2, 3, 6, 4, 4]);
  });

  it("gives a sector its exact bounding box and a middle point inside it", () => {
    const random = rng(7);
    for (let k = 0; k < 300; k++) {
      const f = new TileField(1);
      const r0 = random() < 0.2 ? 0 : 5 + 60 * random();
      const r1 = r0 + 2 + 50 * random();
      const a0 = (random() - 0.5) * 20;
      const span = random() < 0.1 ? TWO_PI : 0.05 + 6 * random();
      expect(f.addSector(100, 80, r0, r1, a0, span, 1)).toBe(0);
      expect(f.kind[0]).toBe(TILE_SECTOR);
      expect(f.a0[0]).toBeGreaterThanOrEqual(0);
      expect(f.a0[0]).toBeLessThan(TWO_PI);
      expect(f.span[0]).toBeLessThanOrEqual(TWO_PI);
      // sample the boundary densely: every sample inside the box, and the box's sides touched
      let bx0 = Infinity;
      let by0 = Infinity;
      let bx1 = -Infinity;
      let by1 = -Infinity;
      const s = Math.min(span, TWO_PI);
      for (let q = 0; q <= 2000; q++) {
        const a = a0 + (s * q) / 2000;
        for (const r of [r0, r1]) {
          const x = 100 + r * Math.cos(a);
          const y = 80 + r * Math.sin(a);
          bx0 = Math.min(bx0, x);
          by0 = Math.min(by0, y);
          bx1 = Math.max(bx1, x);
          by1 = Math.max(by1, y);
        }
      }
      // (inside the box, and within a sample's sag of its sides)
      const tol = r1 * (1 - Math.cos(s / 2000)) + 1e-9;
      const box = [f.x0[0], f.y0[0], f.x1[0], f.y1[0]];
      expect(bx0 >= box[0] - 1e-9 && by0 >= box[1] - 1e-9 && bx1 <= box[2] + 1e-9 && by1 <= box[3] + 1e-9, `sector ${k}: samples ${[bx0, by0, bx1, by1]} in ${box}`).toBe(true);
      expect(Math.max(bx0 - box[0], by0 - box[1], box[2] - bx1, box[3] - by1), `sector ${k}`).toBeLessThanOrEqual(tol);
      expect(f.distanceTo(0, f.px[0], f.py[0])).toBeLessThan(0);
    }
  });

  it("lays out a grid: rows × cols boxes filling the block with their gaps, hit points by row", () => {
    const f = new TileField(600);
    expect(f.layoutGrid({ x: 40, y: 30, width: 400, height: 120, rows: 4, cols: 10, gap: 4, hp: 2, hpStep: 1 })).toBe(40);
    expect([f.count, f.rows, f.cols, f.aliveTotal]).toEqual([40, 4, 10, 40]);
    const w = (400 - 4 * 9) / 10;
    const h = (120 - 4 * 3) / 4;
    for (let i = 0; i < 40; i++) {
      const r = Math.floor(i / 10);
      const c = i % 10;
      expect([f.row[i], f.col[i]]).toEqual([r, c]);
      expect(f.x0[i]).toBeCloseTo(40 + c * (w + 4), 9);
      expect(f.y0[i]).toBeCloseTo(30 + r * (h + 4), 9);
      expect(f.x1[i] - f.x0[i]).toBeCloseTo(w, 9);
      expect(f.y1[i] - f.y0[i]).toBeCloseTo(h, 9);
      expect(f.hp[i]).toBe(2 + r);
    }
    expect(f.x1[39]).toBeCloseTo(440, 9);
    expect(f.y1[39]).toBeCloseTo(150, 9);
    expect(f.hpTotal).toBe(10 * (2 + 3 + 4 + 5));
    // a block too small for its gaps, or no rows, places nothing
    expect(new TileField(10).layoutGrid({ x: 0, y: 0, width: 10, height: 10, rows: 2, cols: 5, gap: 3, hp: 1 })).toBe(0);
    expect(new TileField(10).layoutGrid({ x: 0, y: 0, width: 10, height: 10, rows: 0, cols: 5, hp: 1 })).toBe(0);
  });

  it("lays out rings: row 0 the innermost, equal sectors with their gaps along the middle, staggered courses, whole rings", () => {
    const f = new TileField(600);
    expect(f.layoutRing({ cx: 200, cy: 200, innerRadius: 50, outerRadius: 170, rows: 4, cols: 12, gap: 6, startDeg: -90, hp: 1, hpStep: 2 })).toBe(48);
    expect([f.rows, f.cols]).toEqual([4, 12]);
    const band = (170 - 50 - 6 * 3) / 4;
    for (let r = 0; r < 4; r++) {
      const first = r * 12;
      expect(f.r0[first]).toBeCloseTo(50 + r * (band + 6), 9);
      expect(f.r1[first] - f.r0[first]).toBeCloseTo(band, 9);
      expect(f.hp[first]).toBe(1 + 2 * r);
      const mid = (f.r0[first] + f.r1[first]) / 2;
      for (let c = 0; c < 12; c++) {
        const i = first + c;
        expect([f.row[i], f.col[i]]).toEqual([r, c]);
        expect(f.span[i]).toBeCloseTo(f.span[first], 12);
        // the gap to the next sector, along the ring's middle, is the layout's gap
        const next = first + ((c + 1) % 12);
        const gapAngle = offset(f.a0[next], f.a0[i] + f.span[i]);
        expect(gapAngle * mid).toBeCloseTo(6, 6);
      }
    }
    expect(f.r1[47]).toBeCloseTo(170, 9);
    // column 0 starts half a gap after 12 o'clock
    expect(offset(f.a0[0], -Math.PI / 2) * ((f.r0[0] + f.r1[0]) / 2)).toBeCloseTo(3, 6);

    const s = new TileField(100);
    s.layoutRing({ cx: 0, cy: 0, innerRadius: 20, outerRadius: 100, rows: 2, cols: 8, hp: 1, stagger: true });
    expect(offset(s.a0[8], s.a0[0])).toBeCloseTo(TWO_PI / 16, 9);

    const whole = new TileField(10);
    expect(whole.layoutRing({ cx: 0, cy: 0, innerRadius: 0, outerRadius: 90, rows: 3, cols: 1, gap: 3, hp: 1 })).toBe(3);
    expect([whole.span[0], whole.span[2], whole.r0[0]]).toEqual([TWO_PI, TWO_PI, 0]);

    // a ring too small for its sectors' gaps is left out (the outer one still fits)
    const tight = new TileField(100);
    expect(tight.layoutRing({ cx: 0, cy: 0, innerRadius: 1, outerRadius: 41, rows: 2, cols: 20, gap: 4, hp: 1 })).toBe(20);
    expect(tight.row[0]).toBe(1);
  });

  it("caps every layout at the capacity, row by row (the Blueprint's tile ceiling is 600)", () => {
    const grid = new TileField(600);
    expect(grid.layoutGrid({ x: 0, y: 0, width: 1000, height: 1000, rows: 50, cols: 50, hp: 1 })).toBe(600);
    expect([grid.count, grid.aliveTotal, grid.row[599], grid.col[599]]).toEqual([600, 600, 11, 49]);
    const ring = new TileField(600);
    expect(ring.layoutRing({ cx: 0, cy: 0, innerRadius: 10, outerRadius: 400, rows: 40, cols: 40, hp: 1 })).toBe(600);
    expect([ring.row[599], ring.col[599]]).toEqual([14, 39]);
    // appending past the capacity places nothing more
    expect(ring.layoutGrid({ x: 0, y: 0, width: 10, height: 10, rows: 1, cols: 1, hp: 1 })).toBe(0);
    expect(ring.count).toBe(600);
  });

  it("clear() empties the field for a fresh layout; layouts append to what is there", () => {
    const f = new TileField(100);
    f.layoutGrid({ x: 0, y: 0, width: 100, height: 20, rows: 1, cols: 5, hp: 1 });
    f.layoutRing({ cx: 50, cy: 100, innerRadius: 10, outerRadius: 40, rows: 1, cols: 6, hp: 2 });
    expect([f.count, f.hpTotal]).toEqual([11, 17]);
    f.damage(0, 1);
    f.clear();
    expect([f.count, f.aliveTotal, f.rows, f.cols, f.hpTotal, f.hpLeft, f.breaks]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(f.collide(ball(10, 10, 100, 0), SUB, 1)).toBe(-1);
    expect(f.layoutGrid({ x: 0, y: 0, width: 100, height: 20, rows: 1, cols: 5, hp: 1 })).toBe(5);
    expect([f.count, f.alive[0], f.hp[0]]).toEqual([5, 1, 1]);
  });
});

/* ------------------------------------------------------------------ geometry */

describe("TileField: geometry", () => {
  it("measures the signed distance to rects and sectors exactly (against independent formulas)", () => {
    const random = rng(11);
    const f = new TileField(200);
    f.layoutGrid({ x: 20, y: 20, width: 300, height: 80, rows: 3, cols: 6, gap: 5, hp: 1 });
    f.layoutRing({ cx: 200, cy: 300, innerRadius: 0, outerRadius: 150, rows: 4, cols: 7, gap: 4, startDeg: 33, hp: 1, stagger: true });
    f.layoutRing({ cx: 450, cy: 150, innerRadius: 30, outerRadius: 120, rows: 3, cols: 1, gap: 6, hp: 1 });
    f.addSector(600, 400, 20, 90, 1, 4.5, 1); // wider than a half turn
    for (let k = 0; k < 20000; k++) {
      const i = Math.floor(random() * f.count);
      // points near the tile and far from it
      const x = f.px[i] + (random() - 0.5) * (random() < 0.8 ? 120 : 800);
      const y = f.py[i] + (random() - 0.5) * (random() < 0.8 ? 120 : 800);
      const ref = refDistance(f, i, x, y);
      expect(f.distanceTo(i, x, y), `tile ${i} at (${x}, ${y})`).toBeCloseTo(ref, 7);
    }
  });

  it("finds the tile a point is inside and the tile a disc overlaps (the deepest)", () => {
    const random = rng(5);
    const f = new TileField(200);
    f.layoutGrid({ x: 0, y: 0, width: 200, height: 100, rows: 4, cols: 8, gap: 3, hp: 1 });
    f.layoutRing({ cx: 300, cy: 300, innerRadius: 40, outerRadius: 160, rows: 3, cols: 9, gap: 5, hp: 1 });
    f.destroy(5);
    for (let k = 0; k < 5000; k++) {
      const x = random() * 500 - 20;
      const y = random() * 500 - 20;
      const r = random() * 12;
      let inside = -1;
      let deepest = -1;
      let depth = Infinity;
      for (let i = 0; i < f.count; i++) {
        if (!f.alive[i]) continue;
        const d = refDistance(f, i, x, y);
        if (d < 0 && inside < 0) inside = i;
        if (d < r && d < depth) {
          depth = d;
          deepest = i;
        }
      }
      expect(f.tileAt(x, y)).toBe(inside);
      expect(f.overlapping(x, y, r)).toBe(deepest);
    }
  });
});

/* ------------------------------------------------------------------ reflection */

describe("TileField: collide() reflects off rects and sectors", () => {
  it("bounces a falling ball off a rect's top face: the normal speed reversed × the restitution, the sliding speed kept", () => {
    const f = new TileField(4);
    f.addRect(0, 100, 200, 120, 1);
    f.build();
    const b = ball(50, 100 - 6 - 1, 80, 300);
    expect(step(f, b)).toBe(0);
    expect(b.vy).toBeCloseTo(-300 * MAX_OBSTACLE_RESTITUTION, 9);
    expect(b.vx).toBe(80);
    expect(b.y).toBeLessThan(100 - 6);
    expect([f.contactCount, f.contactTile[0], f.contactNx[0], f.contactNy[0]]).toEqual([1, 0, 0, -1]);
    expect(f.contactImpact[0]).toBeCloseTo(300, 9);
    // restitution 0.5 and a friction of 0.25
    const c = ball(50, 100 - 6 - 1, 80, 300);
    c.x += c.vx * SUB;
    c.y += c.vy * SUB;
    expect(f.collide(c, SUB, 0.5, 0.25)).toBe(0);
    expect(c.vy).toBeCloseTo(-150, 9);
    expect(c.vx).toBeCloseTo(60, 9);
  });

  // --- review fix (tiles) --- a bounciness of 1e300 (a stranger's restitution) sends a rebound past any speed
  it("never writes a position that is not finite: a rebound to an infinite speed leaves the ball where the engine moved it", () => {
    const f = new TileField(4);
    f.addRect(0, 100, 200, 120, 1); // a floor
    f.addRect(0, 60, 200, 87, 1); // and a ceiling: a 13 px slot for a 12 px ball
    f.build();
    const b = ball(50, 93.5, 0, 3000);
    b.x += b.vx * SUB;
    b.y += b.vy * SUB;
    const moved = [b.x, b.y];
    expect(f.collide(b, SUB, 1, 0, 1e300)).toBe(0);
    expect(f.contactCount).toBeGreaterThan(1);
    expect(Number.isFinite(b.vy)).toBe(false);
    expect([b.x, b.y]).toEqual(moved);
  });

  it("bounces off a rect's side and off a corner along the corner's normal", () => {
    const f = new TileField(4);
    f.addRect(100, 100, 140, 140, 1);
    f.build();
    const side = ball(100 - 6 - 0.5, 120, 400, 30);
    expect(step(f, side)).toBe(0);
    expect(side.vx).toBeCloseTo(-400 * MAX_OBSTACLE_RESTITUTION, 9);
    expect(side.vy).toBe(30);
    // head-on at the top-left corner along the diagonal: straight back
    const d = 6 / Math.SQRT2;
    const corner = ball(100 - d - 0.5, 100 - d - 0.5, 300, 300);
    expect(step(f, corner)).toBe(0);
    expect(f.contactNx[0]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(f.contactNy[0]).toBeCloseTo(-Math.SQRT1_2, 6);
    expect(corner.vx).toBeCloseTo(-300 * MAX_OBSTACLE_RESTITUTION, 6);
    expect(corner.vy).toBeCloseTo(-300 * MAX_OBSTACLE_RESTITUTION, 6);
  });

  it("bounces off a sector's outer arc, its inner arc and its radial edges", () => {
    const f = new TileField(4);
    // a quarter ring from 3 o'clock to 6 o'clock (clockwise on screen) between radii 60 and 100
    f.addSector(0, 0, 60, 100, 0, Math.PI / 2, 1);
    f.build();
    const dir = Math.PI / 4;
    const ux = Math.cos(dir);
    const uy = Math.sin(dir);
    // from outside, radially in
    const outer = ball((100 + 6 + 1) * ux, (100 + 6 + 1) * uy, -500 * ux, -500 * uy);
    expect(step(f, outer)).toBe(0);
    expect(outer.vx).toBeCloseTo(500 * ux * MAX_OBSTACLE_RESTITUTION, 6);
    expect(outer.vy).toBeCloseTo(500 * uy * MAX_OBSTACLE_RESTITUTION, 6);
    expect(Math.hypot(outer.x, outer.y)).toBeGreaterThan(100 + 6);
    // from the hole, radially out
    const inner = ball((60 - 6 - 1) * ux, (60 - 6 - 1) * uy, 500 * ux, 500 * uy);
    expect(step(f, inner)).toBe(0);
    expect(inner.vx).toBeCloseTo(-500 * ux * MAX_OBSTACLE_RESTITUTION, 6);
    expect(Math.hypot(inner.x, inner.y)).toBeLessThan(60 - 6);
    // across the start edge (the x axis, from above it: y < 0), moving down
    const edge = ball(80, -6 - 1, 50, 400);
    expect(step(f, edge)).toBe(0);
    expect(f.contactNx[0]).toBeCloseTo(0, 9);
    expect(f.contactNy[0]).toBeCloseTo(-1, 9);
    expect(edge.vy).toBeCloseTo(-400 * MAX_OBSTACLE_RESTITUTION, 9);
    expect(edge.vx).toBeCloseTo(50, 9);
    // across the end edge (the y axis, from its left: x < 0), moving right
    const end = ball(-6 - 1, 80, 400, -20);
    expect(step(f, end)).toBe(0);
    expect(f.contactNx[0]).toBeCloseTo(-1, 9);
    expect(end.vx).toBeCloseTo(-400 * MAX_OBSTACLE_RESTITUTION, 9);
  });

  it("holds a ball inside a whole ring, whatever its direction", () => {
    const f = new TileField(1);
    f.addSector(0, 0, 100, 110, 0.3, TWO_PI, 1);
    f.build();
    for (let k = 0; k < 64; k++) {
      const a = (k / 64) * TWO_PI;
      const b = ball(93 * Math.cos(a), 93 * Math.sin(a), 600 * Math.cos(a), 600 * Math.sin(a));
      expect(step(f, b)).toBe(0);
      expect(b.vx * Math.cos(a) + b.vy * Math.sin(a)).toBeLessThan(0);
      expect(Math.hypot(b.x, b.y)).toBeLessThanOrEqual(100 - 6);
    }
  });

  it("passes the ball's own bounciness and lift through to rebound(), like the engine's obstacles", () => {
    const f = new TileField(1);
    f.addRect(0, 100, 200, 120, 1);
    f.build();
    const b = ball(50, 93, 0, 300);
    b.x += b.vx * SUB;
    b.y += b.vy * SUB;
    expect(f.collide(b, SUB, 0.7, 0, 2)).toBe(0);
    expect(b.vy).toBeCloseTo(-300 * 1.4, 9);
    const lifted = ball(50, 93, 0, 300);
    lifted.y += lifted.vy * SUB;
    expect(f.collide(lifted, SUB, 0.7, 0, 2, 250)).toBe(0);
    expect(Math.abs(lifted.vy)).toBeCloseTo(250, 9);
  });

  it("leaves a ball that touches nothing exactly as it was, and ignores broken tiles", () => {
    const f = new TileField(10);
    f.layoutGrid({ x: 0, y: 100, width: 100, height: 20, rows: 1, cols: 2, hp: 1 });
    const b = ball(25.123456789, 50.987654321, 333.3, -12.5);
    const before = { ...b };
    expect(step(f, b)).toBe(-1);
    expect(f.contactCount).toBe(0);
    expect(b.x).toBe(before.x + before.vx * SUB);
    expect(b.y).toBe(before.y + before.vy * SUB);
    expect([b.vx, b.vy]).toEqual([before.vx, before.vy]);
    // straight down through a broken tile
    f.destroy(0);
    const down = ball(25, 80, 0, 600);
    for (let k = 0; k < 40; k++) expect(step(f, down)).toBe(-1);
    expect(down.y).toBeGreaterThan(120);
    // and off the standing one
    const other = ball(75, 80, 0, 600);
    let hits = 0;
    for (let k = 0; k < 40; k++) if (step(f, other) === 1) hits++;
    expect(hits).toBe(1);
    expect(other.y).toBeLessThan(100);
  });

  it("pushes a ball that starts inside a tile out the shortest way", () => {
    const f = new TileField(2);
    f.addRect(0, 0, 100, 40, 1);
    f.addSector(300, 300, 50, 90, 0, Math.PI, 1);
    f.build();
    const inRect = ball(50, 34, 0, 0);
    expect(f.collide(inRect, SUB, 1)).toBe(0);
    expect(inRect.y).toBeCloseTo(40 + 6 + TILE_SEPARATION, 9);
    expect(inRect.x).toBe(50);
    const inSector = ball(300, 300 + 85, 0, 0);
    expect(f.collide(inSector, SUB, 1)).toBe(1);
    expect(Math.hypot(inSector.x - 300, inSector.y - 300)).toBeCloseTo(90 + 6 + TILE_SEPARATION, 9);
    expect(worstPenetration(f, inSector)).toBeLessThanOrEqual(0);
  });

  it("lists every contact of one sub-step (at most TILE_MAX_CONTACTS) and reports the first", () => {
    // a fast ball in a narrow slot between two tiles bounces from wall to wall within one sub-step
    const f = new TileField(2);
    f.addRect(0, 0, 50, 400, 1);
    f.addRect(64, 0, 114, 400, 1);
    f.build();
    const b = ball(57, 200, 20000, 2000);
    b.x += b.vx * SUB;
    b.y += b.vy * SUB;
    const first = f.collide(b, SUB, 1);
    expect(first).toBe(1);
    expect(f.contactCount).toBe(TILE_MAX_CONTACTS);
    expect(Array.from(f.contactTile)).toEqual([1, 0, 1, 0]);
    expect(b.x).toBeGreaterThan(50 + 6 - 1e-9);
    expect(b.x).toBeLessThan(64 - 6 + 1e-9);
  });
});

/* ------------------------------------------------------------------ no tunnelling */

describe("TileField: no tunnelling", () => {
  for (const speed of [900, 5000, 50000]) {
    it(`never lets a ${speed} px/s ball through a 2 px rect, at any angle, with one or four sub-steps`, () => {
      const random = rng(speed);
      for (const dt of [1 / 60, SUB]) {
        const f = new TileField(1);
        f.addRect(-1000, 0, 1000, 2, 1);
        f.build();
        for (let k = 0; k < 400; k++) {
          const a = (0.15 + 0.7 * random()) * Math.PI; // downward, 27° … 153°
          const r = 1 + 6 * random();
          // (it starts up to 100 px above the bar, so even the flattest path meets the bar within its length)
          const b = ball((random() - 0.5) * 200, -r - 0.5 - random() * Math.min(speed * dt * 0.9, 100), speed * Math.cos(a), speed * Math.sin(a), r);
          for (let s = 0; s < 3; s++) step(f, b, dt);
          expect(b.y, `angle ${a}, radius ${r}`).toBeLessThan(0);
          expect(b.vy).toBeLessThan(0);
        }
      }
    });
  }

  it("never lets a 5000 px/s ball out through a 2 px ring (whole or cut into sectors) or past a thin edge", () => {
    const random = rng(42);
    for (const cols of [1, 24]) {
      const f = new TileField(30);
      f.layoutRing({ cx: 0, cy: 0, innerRadius: 150, outerRadius: 152, rows: 1, cols, gap: 0, hp: 1 });
      for (let k = 0; k < 500; k++) {
        const a = random() * TWO_PI;
        const r = 1 + 5 * random();
        const start = 150 - r - 0.5 - random() * 80;
        const b = ball(start * Math.cos(a), start * Math.sin(a), 5000 * Math.cos(a + 0.3 * (random() - 0.5)), 5000 * Math.sin(a + 0.3 * (random() - 0.5)), r);
        for (let s = 0; s < 4; s++) step(f, b, 1 / 60);
        expect(Math.hypot(b.x, b.y)).toBeLessThan(150);
      }
    }
    // a pie slice's edge, crossed tangentially
    const pie = new TileField(1);
    pie.addSector(0, 0, 20, 200, -0.01, 0.02, 1); // 0.02 rad wide: 2 px at radius 100
    pie.build();
    for (let k = 0; k < 300; k++) {
      const x = 40 + 150 * random();
      const b = ball(x, -8 - random() * 60, 0, 5000, 3);
      for (let s = 0; s < 4; s++) step(pie, b, 1 / 60);
      expect(b.y).toBeLessThan(0);
    }
  });

  it("never ends a sub-step with a ball inside a standing tile (random balls at up to 5000 px/s, gravity, grids, rings, odd shapes)", () => {
    for (const layout of ["grid", "ring", "odd"] as const) {
      const random = rng(layout === "grid" ? 3 : layout === "ring" ? 4 : 5);
      const f = new TileField(700);
      walls(f, 0, 0, 600, 600);
      if (layout === "grid") f.layoutGrid({ x: 60, y: 200, width: 480, height: 200, rows: 8, cols: 16, gap: 2, hp: 3 });
      else if (layout === "ring") f.layoutRing({ cx: 300, cy: 300, innerRadius: 60, outerRadius: 250, rows: 7, cols: 20, gap: 3, hp: 3, stagger: true });
      else {
        // pie slices round a centre, a whole ring round them, a sector wider than a half turn, touching rects
        f.layoutRing({ cx: 170, cy: 170, innerRadius: 0, outerRadius: 70, rows: 1, cols: 3, gap: 8, hp: 3 });
        f.layoutRing({ cx: 170, cy: 170, innerRadius: 90, outerRadius: 100, rows: 1, cols: 1, hp: 3 });
        f.addSector(420, 420, 40, 110, 0.4, 4.6, 3);
        f.layoutGrid({ x: 300, y: 60, width: 260, height: 60, rows: 2, cols: 6, hp: 3 });
        f.build();
      }
      const balls: Ball[] = [];
      for (let n = 0; n < 60; n++) {
        let x = 0;
        let y = 0;
        const r = 2 + 6 * random();
        do {
          x = 20 + 560 * random();
          y = 20 + 560 * random();
        } while (f.overlapping(x, y, r) >= 0);
        const a = random() * TWO_PI;
        const s = 100 + 4900 * random();
        balls.push(ball(x, y, s * Math.cos(a), s * Math.sin(a), r));
      }
      let contacts = 0;
      for (let s = 0; s < 4 * 60 * 3; s++) {
        f.clockMs = (s * 1000) / 240;
        for (const b of balls) {
          const hit = step(f, b, SUB, 1, 400);
          if (hit >= 0) {
            contacts++;
            for (let k = 0; k < f.contactCount; k++) if (f.row[f.contactTile[k]] !== 99) f.damage(f.contactTile[k], 1);
          }
          expect(worstPenetration(f, b), `${layout} step ${s}`).toBeLessThanOrEqual(TILE_SEPARATION + 1e-9);
        }
      }
      expect(contacts).toBeGreaterThan(500);
      // (at least half the breakable tiles – the odd field has 17, and all of them go)
      expect(f.breaks).toBeGreaterThan(Math.min(20, (f.count - 4) / 2));
      // the walls never broke: every ball is still in the box
      for (const b of balls) expect(b.x > 0 && b.x < 600 && b.y > 0 && b.y < 600).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ hit points */

describe("TileField: hit points and breaks", () => {
  it("damage() says when a tile breaks, once; the counters, the version and the clock stamps follow", () => {
    const f = new TileField(10);
    f.layoutGrid({ x: 0, y: 0, width: 100, height: 10, rows: 1, cols: 3, hp: 3 });
    const v0 = f.version;
    f.clockMs = 1234;
    expect(f.damage(1, 1)).toBe(false);
    expect([f.hp[1], f.hpLeft, f.hitMs[1], f.alive[1]]).toEqual([2, 8, 1234, 1]);
    expect(f.version).toBeGreaterThan(v0);
    f.clockMs = 2000;
    expect(f.damage(1, 5)).toBe(true);
    expect([f.hp[1], f.alive[1], f.aliveTotal, f.aliveCount(), f.breaks, f.hpLeft, f.brokeMs[1], f.isAlive(1)]).toEqual([0, 0, 2, 2, 1, 6, 2000, false]);
    expect(f.damage(1, 1)).toBe(false); // already broken
    expect(f.damage(0, 0)).toBe(false);
    expect(f.damage(0, -1)).toBe(false);
    expect(f.damage(0, Number.NaN)).toBe(false);
    expect(f.damage(-1, 1)).toBe(false);
    expect(f.damage(3, 1)).toBe(false); // past the layout
    expect(f.hp[0]).toBe(3);
  });

  it("adds fractional chips up to a break exactly when the hit points are spent", () => {
    const f = new TileField(1);
    f.addRect(0, 0, 10, 10, 1);
    let broke = -1;
    for (let k = 1; k <= 20 && broke < 0; k++) if (f.damage(0, 0.1)) broke = k;
    expect(broke).toBe(10);
    expect(f.hpLeft).toBe(0);
    expect(TILE_HP_EPSILON).toBeLessThan(1e-6);
  });

  it("destroy() breaks a tile whatever its hit points; restoreAll() stands every tile again", () => {
    const f = new TileField(10);
    f.layoutRing({ cx: 0, cy: 0, innerRadius: 10, outerRadius: 50, rows: 2, cols: 3, hp: 2 });
    expect(f.destroy(4)).toBe(true);
    expect(f.destroy(4)).toBe(false);
    f.damage(0, 1);
    expect([f.aliveTotal, f.breaks, f.hpLeft]).toEqual([5, 1, 9]);
    f.restoreAll();
    expect([f.aliveTotal, f.breaks, f.hpLeft, f.hpTotal, f.hp[0], f.alive[4], f.hitMs[0], f.brokeMs[4]]).toEqual([6, 0, 12, 12, 2, 1, -Infinity, -Infinity]);
  });

  it("breaks exactly the tiles a 1-hit-point field's contacts damage", () => {
    const f = new TileField(200);
    walls(f, 0, 0, 400, 400);
    f.layoutGrid({ x: 40, y: 40, width: 320, height: 120, rows: 6, cols: 12, gap: 3, hp: 1 });
    const b = ball(200, 350, 700, -900, 5);
    let broken = 0;
    for (let s = 0; s < 240 * 20; s++) {
      if (step(f, b) < 0) continue;
      for (let k = 0; k < f.contactCount; k++) {
        const t = f.contactTile[k];
        if (f.row[t] === 99) continue;
        expect(f.isAlive(t)).toBe(true);
        expect(f.damage(t, 1)).toBe(true);
        broken++;
      }
    }
    expect(broken).toBe(f.breaks);
    expect(f.aliveTotal).toBe(f.count - f.breaks);
    // (each bounce keeps 98 % of the normal speed, so the ball slows from 1,140 to about 470 px/s: 19 bricks in 20 s)
    expect(broken).toBeGreaterThan(15);
  });
});

/* ------------------------------------------------------------------ determinism and the broadphase */

/** A seeded run: balls in a box of tiles, every contact a hit point; returns everything that happened, call by call. */
function run(seed: number, layout: "grid" | "ring" | "mixed", brute: boolean, field?: TileField) {
  const random = rng(seed);
  const f = field ?? new TileField(600);
  f.clear();
  f.setBroadphase(!brute);
  walls(f, 0, 0, 800, 800);
  if (layout !== "ring") f.layoutGrid({ x: 80, y: 80, width: 640, height: layout === "mixed" ? 120 : 300, rows: layout === "mixed" ? 4 : 12, cols: 24, gap: 2, hp: 2 });
  if (layout !== "grid") f.layoutRing({ cx: 400, cy: layout === "mixed" ? 500 : 400, innerRadius: 40, outerRadius: layout === "mixed" ? 220 : 300, rows: 8, cols: 18, gap: 3, hp: 2, stagger: true });
  const balls: Ball[] = [];
  for (let n = 0; n < 80; n++) {
    const r = 2 + 8 * random();
    let x = 0;
    let y = 0;
    do {
      x = 20 + 760 * random();
      y = 20 + 760 * random();
    } while (f.overlapping(x, y, r) >= 0);
    const a = random() * TWO_PI;
    const s = random() < 0.1 ? 5000 : 200 + 1200 * random();
    balls.push(ball(x, y, s * Math.cos(a), s * Math.sin(a), r));
  }
  const log: number[] = [];
  for (let s = 0; s < 240 * 2; s++) {
    f.clockMs = s * (1000 / 240);
    for (const b of balls) {
      const hit = step(f, b, SUB, 0.95, 300);
      log.push(hit, f.contactCount);
      for (let k = 0; k < f.contactCount; k++) {
        log.push(f.contactTile[k], f.contactImpact[k], f.contactNx[k], f.contactNy[k]);
        if (f.row[f.contactTile[k]] !== 99) f.damage(f.contactTile[k], 0.5);
      }
    }
  }
  // the overlap query too, at seeded points
  for (let k = 0; k < 2000; k++) log.push(f.overlapping(800 * random(), 800 * random(), 12 * random()));
  return {
    log,
    balls: balls.map((b) => [b.x, b.y, b.vx, b.vy]),
    hp: Array.from(f.hp.subarray(0, f.count)),
    alive: Array.from(f.alive.subarray(0, f.count)),
    breaks: f.breaks,
    stats: { ...f.stats },
  };
}

describe("TileField: determinism and the broadphase", () => {
  it("replays a seed exactly, and a cleared field replays like a new one (a restart)", () => {
    const a = run(9, "mixed", false);
    const b = run(9, "mixed", false);
    expect(b.log).toEqual(a.log);
    expect(b.balls).toEqual(a.balls);
    expect(b.hp).toEqual(a.hp);
    expect(a.breaks).toBeGreaterThan(10);
    const reused = new TileField(600);
    run(123, "ring", false, reused);
    const again = run(9, "mixed", false, reused);
    expect(again.log).toEqual(a.log);
    expect(again.balls).toEqual(a.balls);
    expect(run(10, "mixed", false).balls).not.toEqual(a.balls);
  });

  for (const layout of ["grid", "ring", "mixed"] as const) {
    it(`answers exactly what testing every tile in index order answers (${layout}), with far fewer tests`, () => {
      for (const seed of [1, 2]) {
        const grid = run(seed, layout, false);
        const brute = run(seed, layout, true);
        expect(grid.log.length).toBe(brute.log.length);
        expect(grid.log).toEqual(brute.log);
        expect(grid.balls).toEqual(brute.balls);
        expect(grid.hp).toEqual(brute.hp);
        expect(grid.alive).toEqual(brute.alive);
        expect(grid.stats.contacts).toBe(brute.stats.contacts);
        expect(grid.stats.narrowTests).toBe(brute.stats.narrowTests);
        expect(grid.stats.candidates).toBeLessThan(0.1 * brute.stats.candidates);
      }
    });
  }
});

/* ------------------------------------------------------------------ the work budget */

describe("TileField: the work of 600 tiles and 400 balls (counted, never timed)", () => {
  for (const layout of ["grid", "ring"] as const) {
    it(`stays a handful of exact tests per ball per sub-step (${layout})`, () => {
      const random = rng(layout === "grid" ? 600 : 601);
      const f = new TileField(604);
      walls(f, 0, 0, 900, 900);
      const placed =
        layout === "grid"
          ? f.layoutGrid({ x: 50, y: 150, width: 800, height: 400, rows: 25, cols: 24, gap: 2, hp: 1e6 })
          : f.layoutRing({ cx: 450, cy: 450, innerRadius: 60, outerRadius: 430, rows: 24, cols: 25, gap: 2, hp: 1e6 });
      expect(placed).toBe(600);
      const { cols, rows } = f.gridSize();
      expect(cols * rows).toBeGreaterThan(100);
      const balls: Ball[] = [];
      while (balls.length < 400) {
        const r = 3 + 3 * random();
        const x = 20 + 860 * random();
        const y = 20 + 860 * random();
        if (f.overlapping(x, y, r) >= 0) continue;
        const a = random() * TWO_PI;
        const s = 300 + 600 * random();
        balls.push(ball(x, y, s * Math.cos(a), s * Math.sin(a), r));
      }
      f.resetStats();
      const SUBSTEPS = 4 * 60;
      for (let s = 0; s < SUBSTEPS; s++) for (const b of balls) step(f, b, SUB, 0.98, 300);
      const calls = f.stats.calls;
      expect(calls).toBe(400 * SUBSTEPS);
      // per call: about one sweep, a few cells, a few tiles looked at and fewer tested exactly – never the 604 of brute force
      // (measured: 1.01–1.03 sweeps, 1.5–1.7 cells, 0.5–2.6 tiles and 0.02–0.37 exact tests a call)
      expect(f.stats.queries / calls).toBeLessThan(1.5);
      expect(f.stats.cellVisits / calls).toBeLessThan(4);
      expect(f.stats.candidates / calls).toBeLessThan(8);
      expect(f.stats.narrowTests / calls).toBeLessThan(2);
      expect(f.stats.candidates).toBeLessThan(0.02 * calls * f.count);
      expect(f.stats.contacts).toBeGreaterThan(500);
      for (const b of balls) expect(worstPenetration(f, b)).toBeLessThanOrEqual(TILE_SEPARATION + 1e-9);
    });
  }

  it("bounds the work of a sweep across the whole field (a ball at 10⁷ px/s looks at each tile at most once a sweep)", () => {
    const f = new TileField(600);
    f.layoutGrid({ x: 0, y: 0, width: 600, height: 600, rows: 24, cols: 25, gap: 4, hp: 1 });
    f.resetStats();
    const b = ball(-50, -50, 1e7, 1e7, 3);
    step(f, b, SUB);
    expect(f.stats.queries).toBeGreaterThan(0);
    expect(f.stats.candidates).toBeLessThanOrEqual(f.stats.queries * f.count);
    expect(b.x).toBeLessThan(0);
    expect(b.y).toBeLessThan(0);
  });

  it("refuses a ball that is not a number without touching it", () => {
    const f = new TileField(10);
    f.layoutGrid({ x: 0, y: 0, width: 100, height: 100, rows: 2, cols: 2, hp: 1 });
    const b = ball(Number.NaN, 10, 100, 100);
    expect(f.collide(b, SUB, 1)).toBe(-1);
    expect(Number.isNaN(b.x)).toBe(true);
    const inf = ball(10, 10, Infinity, 0);
    expect(f.collide(inf, SUB, 1)).toBe(-1);
    expect(f.overlapping(Number.NaN, 0, 1)).toBe(-1);
  });
});

/* ------------------------------------------------------------------ pitch */

describe("TileField: the pitch per row or column (scales.ts)", () => {
  it("climbs a scale from the root, wrapping after two octaves", () => {
    const n = SCALE_INTERVALS.pentatonic.length;
    expect(tileMidi(0)).toBe(TILE_ROOT_MIDI);
    expect(tileMidi(n)).toBe(TILE_ROOT_MIDI + 12);
    expect(tileMidi(n * TILE_PITCH_OCTAVES)).toBe(TILE_ROOT_MIDI);
    expect(tileMidi(-1)).toBe(tileMidi(n * TILE_PITCH_OCTAVES - 1));
    expect(tileMidi(Number.NaN)).toBe(TILE_ROOT_MIDI);
    for (const scale of ["major", "minor", "pentatonic", "blues", "chromatic", "wholeTone"] as const) {
      let last = -Infinity;
      for (let d = 0; d < SCALE_INTERVALS[scale].length * TILE_PITCH_OCTAVES; d++) {
        const m = tileMidi(d, scale, 57);
        expect(m).toBeGreaterThan(last);
        expect(SCALE_INTERVALS[scale]).toContain((((m - 57) % 12) + 12) % 12);
        last = m;
      }
    }
    expect(tileFrequency(2, "major", 60)).toBeCloseTo(midiToFrequency(64), 9);
  });

  it("takes a tile's degree from its row, its column, or nothing", () => {
    const f = new TileField(20);
    f.layoutGrid({ x: 0, y: 0, width: 100, height: 100, rows: 3, cols: 4, hp: 1 });
    expect([f.degreeOf(6, "row"), f.degreeOf(6, "col"), f.degreeOf(6, "none"), f.degreeOf(99, "row")]).toEqual([1, 2, 0, 0]);
  });
});
