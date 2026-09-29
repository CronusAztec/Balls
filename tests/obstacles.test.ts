import { describe, expect, it } from "vitest";
import {
  DEFAULT_OBSTACLE_FRICTION,
  DEFAULT_OBSTACLE_RESTITUTION,
  MAX_OBSTACLE_RESTITUTION,
  advanceObstacles,
  circleObstacle,
  hasSpinningObstacles,
  rebound,
  resolveBallCircle,
  resolveBallObstacle,
  resolveBallSegment,
  segmentBetween,
  segmentEndpoints,
  segmentObstacle,
} from "@/lib/physics/obstacles";
import type { Ball } from "@/lib/physics/types";

/**
 * The generic obstacle layer (lib/physics/obstacles.ts): the pure collision maths for balls against
 * pegs (circles) and bars (segments, optionally spinning), which Ball Drop builds its board from.
 */

/** One engine sub-step (4 per 60 Hz step). */
const DT = 1 / 240;

function ball(x: number, y: number, vx: number, vy: number, radius = 8): Ball {
  return { id: 0, x, y, vx, vy, radius, color: "#fff", trail: [], trailIndex: 0, spin: 0, angle: 0 };
}

describe("obstacle factories", () => {
  it("fill in the defaults", () => {
    expect(circleObstacle(10, 20, 5)).toEqual({ kind: "circle", x: 10, y: 20, radius: 5, restitution: DEFAULT_OBSTACLE_RESTITUTION, friction: DEFAULT_OBSTACLE_FRICTION });
    expect(segmentObstacle(1, 2, 30, 0.5, { restitution: 0.4 })).toEqual({ kind: "segment", x: 1, y: 2, halfLength: 30, angle: 0.5, angularVelocity: 0, thickness: 0, restitution: 0.4, friction: DEFAULT_OBSTACLE_FRICTION });
  });

  it("segmentBetween keeps the endpoints and segmentEndpoints gives them back", () => {
    const bar = segmentBetween(100, 200, 160, 280, { angularVelocity: 1, thickness: 4 });
    expect(bar.x).toBeCloseTo(130, 10);
    expect(bar.y).toBeCloseTo(240, 10);
    expect(bar.halfLength).toBeCloseTo(50, 10);
    expect(bar.angularVelocity).toBe(1);
    expect(bar.thickness).toBe(4);
    const ends = segmentEndpoints(bar);
    expect(ends.x1).toBeCloseTo(100, 9);
    expect(ends.y1).toBeCloseTo(200, 9);
    expect(ends.x2).toBeCloseTo(160, 9);
    expect(ends.y2).toBeCloseTo(280, 9);
    // The caller-owned output object is reused, so the render loop never allocates.
    const scratch = { x1: 0, y1: 0, x2: 0, y2: 0 };
    expect(segmentEndpoints(bar, scratch)).toBe(scratch);
  });

  it("spinning bars turn with advanceObstacles and the angle stays in (−π, π]", () => {
    const still = segmentObstacle(0, 0, 10, 0.3);
    const spinner = segmentObstacle(0, 0, 10, 3, { angularVelocity: 2 });
    const peg = circleObstacle(0, 0, 4);
    expect(hasSpinningObstacles([still, peg])).toBe(false);
    expect(hasSpinningObstacles([still, spinner])).toBe(true);
    advanceObstacles([still, spinner, peg], 0.25);
    expect(still.angle).toBe(0.3);
    expect(spinner.angle).toBeCloseTo(3.5 - 2 * Math.PI, 12);
    const backwards = segmentObstacle(0, 0, 10, -3, { angularVelocity: -4 });
    advanceObstacles([backwards], 0.1);
    expect(backwards.angle).toBeCloseTo(-3.4 + 2 * Math.PI, 12);
  });
});

describe("ball vs peg", () => {
  const peg = circleObstacle(100, 100, 5); // R = 13 with an 8 px ball

  it("ignores a ball that does not touch it", () => {
    const b = ball(100, 80, 30, 40);
    expect(resolveBallCircle(b, peg, DT)).toBe(-1);
    expect([b.x, b.y, b.vx, b.vy]).toEqual([100, 80, 30, 40]);
  });

  it("pushes a falling ball out and reflects it with the restitution", () => {
    const b = ball(100, 100 - 12.5, 0, 200); // 0.5 px into the peg, came from above
    const impact = resolveBallCircle(b, peg, DT);
    expect(impact).toBeCloseTo(200, 10);
    expect(b.x).toBeCloseTo(100, 10);
    expect(b.y).toBeCloseTo(100 - 13.01, 10);
    expect(b.vx).toBeCloseTo(0, 10);
    expect(b.vy).toBeCloseTo(-200 * DEFAULT_OBSTACLE_RESTITUTION, 10);
  });

  it("deflects an off-centre hit sideways and only brakes the sliding component by the friction", () => {
    const b = ball(106, 100 - 11, 0, 300); // 12.53 px from the centre: 0.47 px into the peg, came from above
    const impact = resolveBallCircle(b, peg, DT);
    expect(impact).toBeGreaterThan(0);
    expect(b.vx).toBeGreaterThan(0); // knocked to the right, away from the peg
    expect(b.vy).toBeLessThan(0); // and back up
    expect(Math.hypot(b.x - 100, b.y - 100)).toBeCloseTo(13.01, 6);
    // Sliding along the peg's surface loses only DEFAULT_OBSTACLE_FRICTION of its speed per contact.
    const slider = ball(100 - 12.5, 100, 0, 100); // touching on the left, moving straight down (tangentially)
    const soft = resolveBallCircle(slider, peg, DT);
    expect(soft).toBe(0); // not moving into the peg: no impulse
    expect(slider.vy).toBeCloseTo(100 * (1 - DEFAULT_OBSTACLE_FRICTION), 10);
    expect(slider.vx).toBeCloseTo(0, 10);
  });

  it("only separates a ball that is already moving away", () => {
    const b = ball(100, 100 - 12.5, 0, -50);
    expect(resolveBallCircle(b, peg, DT)).toBe(0);
    expect(b.y).toBeCloseTo(100 - 13.01, 10);
    expect(b.vy).toBeCloseTo(-50, 10);
  });

  it("uses the entry point of a fast ball as the contact normal instead of popping it out on the far side", () => {
    // A 4 px ball at 4000 px/s crosses the peg's centre in one sub-step (16.7 px): the naive normal would point down.
    const b = ball(100, 100 - 9.5 + 4000 * DT, 0, 4000, 4);
    expect(Math.hypot(b.x - 100, b.y - 100)).toBeLessThan(9); // overlapping, past the centre
    const impact = resolveBallCircle(b, peg, DT);
    expect(impact).toBeCloseTo(4000, 6);
    expect(b.y).toBeLessThan(100 - 9); // back above the peg
    expect(b.vy).toBeLessThan(0);
  });

  it("pushes a ball that sits exactly on the centre straight up", () => {
    const b = ball(100, 100, 0, 0);
    expect(resolveBallCircle(b, peg, DT)).toBe(0);
    expect(b.x).toBeCloseTo(100, 10);
    expect(b.y).toBeCloseTo(100 - 13.01, 10);
    const moving = ball(100, 100, 60, 0);
    resolveBallCircle(moving, peg, DT);
    expect(moving.x).toBeLessThan(100); // pushed back the way it came
  });
});

describe("ball vs bar", () => {
  const bar = segmentObstacle(100, 200, 30, 0, { restitution: 0.5, friction: 0.1 }); // horizontal, from x = 70 to 130

  it("bounces a ball off the flat side with restitution and friction", () => {
    const b = ball(110, 200 - 7.5, 100, 300); // 0.5 px into the bar from above
    const impact = resolveBallSegment(b, bar, DT);
    expect(impact).toBeCloseTo(300, 10);
    expect(b.y).toBeCloseTo(200 - 8.01, 10);
    expect(b.x).toBeCloseTo(110, 10);
    expect(b.vy).toBeCloseTo(-150, 10);
    expect(b.vx).toBeCloseTo(90, 10); // 10% of the sliding speed lost
    // From below the normal points down.
    const under = ball(90, 200 + 7.5, 0, -100);
    resolveBallSegment(under, bar, DT);
    expect(under.y).toBeCloseTo(200 + 8.01, 10);
    expect(under.vy).toBeCloseTo(50, 10);
  });

  it("treats the ends as rounded caps", () => {
    const b = ball(134, 196, 0, 300); // 5.66 px from the right end (130, 200), inside the 8 px reach
    const impact = resolveBallSegment(b, bar, DT);
    expect(impact).toBeGreaterThan(0);
    expect(Math.hypot(b.x - 130, b.y - 200)).toBeCloseTo(8.01, 6);
    expect(b.vx).toBeGreaterThan(0); // deflected outwards
    expect(b.vy).toBeLessThan(300);
    // Well beyond the end: no contact, even though the ball crosses the bar's line.
    const past = ball(130 + 8 + 5, 200 + 2, 0, 3000);
    expect(resolveBallSegment(past, bar, DT)).toBe(-1);
  });

  it("bounces a fast ball that crossed a thin bar back to the side it came from", () => {
    const b = ball(100, 200 - 3.5 + 3000 * DT, 0, 3000, 3); // now 9 px below the bar, was 3.5 px above it
    expect(b.y).toBeGreaterThan(200);
    const impact = resolveBallSegment(b, bar, DT);
    expect(impact).toBeCloseTo(3000, 6);
    expect(b.y).toBeCloseTo(200 - 3.01, 10);
    expect(b.vy).toBeLessThan(0);
  });

  it("adds the thickness of the bar to the contact distance", () => {
    const thick = segmentObstacle(100, 200, 30, 0, { thickness: 10 });
    const b = ball(100, 200 - 12.5, 0, 100); // 8 + 5 = 13 px reach
    expect(resolveBallSegment(b, thick, DT)).toBeCloseTo(100, 10);
    expect(b.y).toBeCloseTo(200 - 13.01, 10);
    const clear = ball(100, 200 - 13.5, 0, 100);
    expect(resolveBallSegment(clear, thick, DT)).toBe(-1);
  });

  it("a spinning bar flings the ball with its surface speed", () => {
    // 2 rad/s clockwise on screen: the left half moves up, the right half moves down.
    const spinner = segmentObstacle(100, 200, 30, 0, { angularVelocity: 2, restitution: 0.7, friction: 0 });
    const left = ball(80, 200 - 7.9, 0, 0);
    const impact = resolveBallSegment(left, spinner, DT);
    expect(impact).toBeCloseTo(40, 10); // the surface comes up at 2 rad/s × 20 px
    expect(left.vy).toBeCloseTo(-68, 10); // −(1 + 0.7) × 40
    const right = ball(120, 200 - 7.9, 0, 0);
    expect(resolveBallSegment(right, spinner, DT)).toBe(0); // the surface moves away: only a push-out
    expect(right.vy).toBe(0);
    expect(right.y).toBeCloseTo(200 - 8.01, 10);
    // A tilted bar works in its own frame.
    const tilted = segmentObstacle(100, 200, 30, Math.PI / 4);
    const onTilt = ball(105, 195, 0, 200); // 7.07 px above the centre of the 45° bar, falling onto it
    expect(resolveBallSegment(onTilt, tilted, DT)).toBeGreaterThan(0);
    expect(onTilt.vx).toBeGreaterThan(0); // knocked down-right, away from the slope
    expect(Math.abs(onTilt.x - 100 - (200 - onTilt.y))).toBeLessThan(1e-9); // pushed out along the bar's normal
    expect(Math.hypot(onTilt.x - 100, onTilt.y - 200)).toBeCloseTo(8.01, 6);
  });
});

describe("rebound and dispatch", () => {
  it("caps the restitution and scales it with the wall-bounciness factor", () => {
    const hot = ball(0, 0, 0, 100);
    expect(rebound(hot, 0, -1, 0, 0, 5, 0)).toBe(100);
    expect(hot.vy).toBeCloseTo(-100 * MAX_OBSTACLE_RESTITUTION, 10);
    const peg = circleObstacle(100, 100, 5, { restitution: 0.8 });
    const scaled = ball(100, 100 - 12.5, 0, 200);
    resolveBallObstacle(scaled, peg, DT, 0.5); // effective restitution 0.4
    expect(scaled.vy).toBeCloseTo(-80, 10);
    const dead = ball(100, 100 - 12.5, 0, 200);
    resolveBallObstacle(dead, circleObstacle(100, 100, 5, { restitution: 0 }), DT);
    expect(dead.vy).toBeCloseTo(0, 10);
  });

  it("dispatches on the obstacle kind and is a pure function of its inputs", () => {
    const a = ball(100, 100 - 12.5, 30, 200);
    const b = ball(100, 100 - 12.5, 30, 200);
    expect(resolveBallObstacle(a, circleObstacle(100, 100, 5), DT)).toBe(resolveBallObstacle(b, circleObstacle(100, 100, 5), DT));
    expect([a.x, a.y, a.vx, a.vy]).toEqual([b.x, b.y, b.vx, b.vy]);
    const c = ball(100, 200 - 7.5, 0, 100);
    expect(resolveBallObstacle(c, segmentBetween(70, 200, 130, 200), DT)).toBeCloseTo(100, 10);
    expect(c.y).toBeCloseTo(200 - 8.01, 10);
  });
});
