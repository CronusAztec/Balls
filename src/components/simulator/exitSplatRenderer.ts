import type { PhysicsEngine } from "@/lib/physics/engine";
import { EXIT_FLASH_MS, gapCentre, wrapTwoPi, type ExitView } from "@/lib/physics/movingExits";
import { SPLAT_FADE_MS, type Splat, type SplatField } from "@/lib/physics/splats";
import type { CircularWall } from "@/lib/physics/types";

/**
 * --- gerald-exit-splat --- Drawing of the moving exits and the splat barrier (lib/physics/movingExits.ts, splats.ts) for
 * Canvas.tsx, inside the world (camera) transform, after the rings and under the balls:
 *
 * - **Splats**: a blob of paint in the ball's colour stuck to the inside of its wall – the circle the physics bounces off,
 *   with a wobbly rim, one to three drips running inward, a few droplets and a wet highlight, each drawn once into a
 *   `Path2D` from its serial (no `Math.random`: a run looks the same in every recording and in the fast export). It splashes
 *   in, squishes when a ball bounces off it and, when it goes, drips down and fades. It turns with its ring.
 * - **Exits**: a jump or a re-opening flashes at the spot the exit left (a puff) and the spot it took (a burst); a jumping
 *   exit about to jump flickers, a shrinking one glows red as it shuts, a fleeing one leaves speed streaks behind it.
 *
 * Everything is timed by the simulation clock (a pause freezes it, the fast export replays it); nothing is allocated per
 * frame but the canvas' own transform. The canvas mirrors the state onto the element for tools and the smoke test:
 * `data-exit-behavior`, `data-exit-moves`, `data-exit-angle` (the innermost intact exit's centre, degrees) and
 * `data-splats`, `data-splats-created`, `data-splat-hits`, `data-splats-max`.
 */

/** Simulation ms a new splat takes to splash in (it overshoots, then settles). */
export const SPLAT_POP_MS = 140;
/** Simulation ms a splat squishes after a ball bounced off it. */
export const SPLAT_SQUISH_MS = 220;
/** How far (world px) a fading splat drips down before it is gone. */
export const SPLAT_DRIP_FALL = 26;

interface SplatArt {
  serial: number;
  radius: number;
  /** The blob, its drips and its droplets, in the splat's frame (x along the wall, y inward from the wall line). */
  body: Path2D;
  /** The wet highlight. */
  shine: Path2D;
}

/** A small seeded generator (Mulberry32) for the shapes – render-only, from the splat's serial. */
function shapeRandom(seed: number): () => number {
  let a = (seed * 0x9e3779b1) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** easeOutBack: 0 → 1 with a little overshoot (the splash). */
function easeOutBack(x: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const u = x - 1;
  return 1 + c3 * u * u * u + c1 * u * u;
}

/**
 * The art of a splat of radius `r` whose circle's centre sits `offset` beyond the wall line: the cap of the circle inside
 * the ring with a wobbly rim, closed along the wall line, plus drips and droplets (frame: x along the wall, y inward).
 */
export function buildSplatArt(serial: number, r: number, offset: number): SplatArt {
  const rand = shapeRandom(serial);
  const body = new Path2D();
  // The rim: the circle from where it meets the wall line on one side, over the inside, to the other side.
  const a0 = Math.asin(Math.min(0.95, Math.max(0, offset / r)));
  const harmonics = [3, 5, 7].map((k) => ({ k, amp: (0.03 + 0.05 * rand()) / (k / 3), phase: rand() * Math.PI * 2 }));
  const steps = 20;
  for (let i = 0; i <= steps; i++) {
    const th = a0 + ((Math.PI - 2 * a0) * i) / steps;
    let wob = 1;
    for (const h of harmonics) wob += h.amp * Math.sin(h.k * th + h.phase);
    const x = r * wob * Math.cos(th);
    const y = -offset + r * wob * Math.sin(th);
    if (i === 0) body.moveTo(x, Math.max(-1, y));
    else body.lineTo(x, Math.max(-1, y));
  }
  body.lineTo(-r * Math.cos(a0), -1);
  body.lineTo(r * Math.cos(a0), -1);
  body.closePath();
  // Drips: tapered runs of paint from the rim inward, each ending in a drop.
  const drips = 1 + Math.floor(rand() * 3);
  for (let d = 0; d < drips; d++) {
    const u = (rand() * 1.2 - 0.6) * r;
    const rim = Math.sqrt(Math.max(0, r * r - u * u)) - offset;
    const len = (0.45 + 0.9 * rand()) * r;
    const w = (0.14 + 0.14 * rand()) * r;
    const top = rim - 0.35 * r;
    const bottom = rim + len;
    const stem = 0.22 * w;
    const drop = 0.42 * w;
    // (every sub-path winds the same way as the rim, so the non-zero fill joins them without holes)
    body.moveTo(u + w / 2, top);
    body.quadraticCurveTo(u + 1.3 * stem, (top + bottom) / 2, u + stem, bottom);
    body.lineTo(u - stem, bottom);
    body.quadraticCurveTo(u - 1.3 * stem, (top + bottom) / 2, u - w / 2, top);
    body.closePath();
    body.moveTo(u + drop, bottom + 0.4 * drop);
    body.arc(u, bottom + 0.4 * drop, drop, 0, Math.PI * 2);
  }
  // Droplets thrown off by the impact.
  const drops = 2 + Math.floor(rand() * 3);
  for (let d = 0; d < drops; d++) {
    const ang = Math.PI * (0.12 + 0.76 * rand());
    const dist = r * (1.05 + 0.55 * rand());
    const x = dist * Math.cos(ang);
    const y = -offset + dist * Math.sin(ang);
    const rr = r * (0.07 + 0.09 * rand());
    body.moveTo(x + rr, y);
    body.arc(x, y, rr, 0, Math.PI * 2);
  }
  const shine = new Path2D();
  shine.ellipse(-0.28 * r, 0.42 * (r - offset), 0.22 * r, 0.11 * r, -0.35, 0, Math.PI * 2);
  return { serial, radius: r, body, shine };
}

/** Writes or removes a data-* attribute only when it changed. */
function setData(data: DOMStringMap, key: string, value: string | null) {
  if (value === null) {
    if (data[key] !== undefined) delete data[key];
  } else if (data[key] !== value) data[key] = value;
}

const SPLAT_KEYS = ["splats", "splatsCreated", "splatHits", "splatsMax"];
const EXIT_KEYS = ["exitBehavior", "exitMoves", "exitAngle"];

export class ExitSplatLayer {
  private readonly art = new WeakMap<Splat, SplatArt>();
  private readonly rainbow: string[] = [];

  /**
   * Draws the splats and the exits' effects of `engine`'s run on the rings as the canvas draws them (`walls`, `rotations`,
   * `broken` – the live ones, the replay's or the slow motion's) around (`cx`, `cy`); `timeMs` is the canvas' clock (the
   * flicker), `rainbowBall` paints the splats in rainbow colours like the ball. Mirrors the data-* attributes into `data`.
   */
  draw(ctx: CanvasRenderingContext2D, engine: PhysicsEngine, walls: readonly CircularWall[], rotations: readonly number[], broken: ReadonlySet<number>, cx: number, cy: number, timeMs: number, rainbowBall: boolean, data: DOMStringMap) {
    const now = engine.getElapsedMs();
    const field = engine.getSplats();
    const view = engine.getExitView();
    if (field.splats.length > 0) this.drawSplats(ctx, field, walls, rotations, cx, cy, now, rainbowBall);
    if (view.live) this.drawExits(ctx, view, walls, rotations, broken, cx, cy, now, timeMs);
    // data-* for tools and the smoke test
    const splatsOn = field.splats.length > 0 || field.created > 0;
    setData(data, "splats", splatsOn ? String(field.active) : null);
    setData(data, "splatsCreated", splatsOn ? String(field.created) : null);
    setData(data, "splatHits", splatsOn ? String(field.hits) : null);
    setData(data, "splatsMax", splatsOn ? String(field.max) : null);
    if (!splatsOn) for (const key of SPLAT_KEYS) setData(data, key, null);
    if (view.live) {
      setData(data, "exitBehavior", view.behavior);
      setData(data, "exitMoves", String(view.moves));
      let inner = -1;
      for (let w = 0; w < walls.length; w++) {
        if (broken.has(w) || walls[w].gaps.length !== 1) continue;
        if (inner < 0 || walls[w].radius < walls[inner].radius) inner = w;
      }
      setData(data, "exitAngle", inner >= 0 ? ((wrapTwoPi(gapCentre(walls[inner].gaps[0]) + (rotations[inner] ?? 0)) * 180) / Math.PI).toFixed(1) : null);
    } else for (const key of EXIT_KEYS) setData(data, key, null);
  }

  private colorOf(s: Splat, rainbowBall: boolean): string {
    if (!rainbowBall) return s.color;
    const hue = (s.serial * 47) % 360;
    return (this.rainbow[hue] ??= `hsl(${hue}, 100%, 58%)`);
  }

  private drawSplats(ctx: CanvasRenderingContext2D, field: SplatField, walls: readonly CircularWall[], rotations: readonly number[], cx: number, cy: number, now: number, rainbowBall: boolean) {
    const base = ctx.getTransform();
    const { a, b, c, d, e, f } = base;
    ctx.save();
    for (const s of field.splats) {
      const wall = walls[s.wall];
      if (!wall) continue;
      let art = this.art.get(s);
      if (!art || art.serial !== s.serial || art.radius !== s.radius) {
        art = buildSplatArt(s.serial, s.radius, s.offset);
        this.art.set(s, art);
      }
      const theta = s.angle + (rotations[s.wall] ?? 0);
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      // the splash in, a squish after a bounce, the drip off
      const age = now - s.bornMs;
      const pop = age < SPLAT_POP_MS ? 0.35 + 0.65 * easeOutBack(Math.max(0, age) / SPLAT_POP_MS) : 1;
      const since = now - s.hitMs;
      const squish = since >= 0 && since < SPLAT_SQUISH_MS ? 1 - since / SPLAT_SQUISH_MS : 0;
      const fade = s.fadeMs >= 0 ? Math.min(1, Math.max(0, (now - s.fadeMs) / SPLAT_FADE_MS)) : 0;
      if (fade >= 1) continue;
      const sx = pop * (1 + 0.12 * squish);
      const sy = pop * (1 - 0.22 * squish) * (1 + 0.35 * fade);
      const wx = cx + wall.radius * cos;
      const wy = cy + wall.radius * sin + SPLAT_DRIP_FALL * fade * fade;
      // the splat's frame: x along the wall (tangent), y inward (toward the centre)
      const tx = -sin * sx;
      const ty = cos * sx;
      const nx = -cos * sy;
      const ny = -sin * sy;
      ctx.setTransform(a * tx + c * ty, b * tx + d * ty, a * nx + c * ny, b * nx + d * ny, a * wx + c * wy + e, b * wx + d * wy + f);
      ctx.globalAlpha = 0.92 * (1 - fade);
      ctx.fillStyle = this.colorOf(s, rainbowBall);
      ctx.fill(art.body);
      ctx.globalAlpha = 0.28 * (1 - fade);
      ctx.fillStyle = "#ffffff";
      ctx.fill(art.shine);
    }
    ctx.restore();
    ctx.setTransform(base);
  }

  private drawExits(ctx: CanvasRenderingContext2D, view: ExitView, walls: readonly CircularWall[], rotations: readonly number[], broken: ReadonlySet<number>, cx: number, cy: number, now: number, timeMs: number) {
    ctx.save();
    ctx.lineCap = "round";
    // Each ring's exit: the flicker before a jump, the red glow of a shutting door, the streaks of a fleeing one.
    for (let w = 0; w < walls.length; w++) {
      const wall = walls[w];
      if (broken.has(w) || wall.gaps.length !== 1) continue;
      const gap = wall.gaps[0];
      const rot = rotations[w] ?? 0;
      const start = gap.startAngle + rot;
      const end = gap.endAngle + rot;
      const R = wall.radius;
      const alert = view.alert[w] ?? 0;
      const closing = view.closing[w] ?? 0;
      const fleeing = view.fleeing[w] ?? 0;
      if (alert > 0) {
        const flicker = 0.5 + 0.5 * Math.sin(timeMs * 0.06);
        ctx.globalAlpha = Math.min(1, alert) * (0.35 + 0.65 * flicker);
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 4;
        this.edgeTicks(ctx, cx, cy, R, start, end, 0.07);
      }
      if (closing > 0.5) {
        const k = (closing - 0.5) / 0.5;
        ctx.globalAlpha = Math.min(1, k) * (0.55 + 0.45 * Math.sin(timeMs * 0.03));
        ctx.strokeStyle = "#ff4d4d";
        ctx.lineWidth = 5;
        this.edgeTicks(ctx, cx, cy, R, start, end, 0.1);
      }
      if (Math.abs(fleeing) > 0.05) {
        // streaks behind the moving exit (on the side it comes from)
        const back = fleeing > 0 ? -1 : 1;
        const len = 0.18 * Math.min(1, Math.abs(fleeing));
        ctx.strokeStyle = "#f8fafc";
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          const rr = R + (i - 1) * 5;
          ctx.globalAlpha = 0.45 * Math.min(1, Math.abs(fleeing)) * (1 - 0.25 * i);
          const from = back < 0 ? start - 0.02 : end + 0.02;
          const to = from + back * len * (1 - 0.2 * i);
          ctx.beginPath();
          ctx.arc(cx, cy, rr, Math.min(from, to), Math.max(from, to));
          ctx.stroke();
        }
      }
    }
    // The flashes of the latest moves.
    for (const fl of view.flashes) {
      const age = now - fl.timeMs;
      if (!(age >= 0 && age < EXIT_FLASH_MS)) continue;
      const wall = walls[fl.wall];
      if (!wall) continue;
      const p = age / EXIT_FLASH_MS;
      const x = cx + wall.radius * Math.cos(fl.angle);
      const y = cy + wall.radius * Math.sin(fl.angle);
      if (fl.appear) {
        ctx.globalAlpha = 1 - p;
        ctx.strokeStyle = "#d9f99d";
        ctx.lineWidth = 3 * (1 - p) + 1;
        ctx.beginPath();
        ctx.arc(x, y, 4 + 26 * p, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2 + fl.angle;
          const r0 = 6 + 18 * p;
          const r1 = r0 + 8 * (1 - p);
          ctx.beginPath();
          ctx.moveTo(x + r0 * Math.cos(ang), y + r0 * Math.sin(ang));
          ctx.lineTo(x + r1 * Math.cos(ang), y + r1 * Math.sin(ang));
          ctx.stroke();
        }
      } else {
        ctx.globalAlpha = 0.7 * (1 - p);
        ctx.fillStyle = "#cbd5e1";
        ctx.beginPath();
        ctx.arc(x, y, 3 + 16 * (1 - p) * (1 - p), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Short arcs just outside both edges of an exit (its door frame), `len` radians long. */
  private edgeTicks(ctx: CanvasRenderingContext2D, cx: number, cy: number, R: number, start: number, end: number, len: number) {
    ctx.beginPath();
    ctx.arc(cx, cy, R, start - len, start);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, R, end, end + len);
    ctx.stroke();
  }
}
