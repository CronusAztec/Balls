import { PK_BOMB, flBombHeight, type FightLeagueView } from "@/lib/physics/modes/fightLeague";
import { DEG, TWO_PI } from "./sprites";

/**
 * --- fl-overhaul --- (Stage 3) The hit shapes over the fight (flDbg=1 in the URL – no panel control): every live melee shape
 * (blades, heads, fists, tails, whip lashes: the capsules the rules test), the fire cones, the rays, the spark rings, the
 * bombs' splash, the walls' segments, the traps' circles, the projectiles' circles and every per-source window still open
 * (a ring round its target), in translucent red.
 */
/** A melee shape is drawn while its test is this fresh (two 60 Hz steps): a sweep that ended leaves nothing behind. */
const LIVE_MS = 34;

export function drawDebug(ctx: CanvasRenderingContext2D, view: FightLeagueView, now: number) {
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.strokeStyle = "#ef4444";
  ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
  ctx.lineWidth = 1.5;
  for (const f of view.fighters) {
    if (!f.alive) continue;
    for (const w of f.weapons) {
      const s = w.spec;
      // the melee shapes the last step tested: capsules (blades, tails, lashes) and circles (heads, fists, cards)
      const live = now - w.shapesMs <= LIVE_MS ? Math.min(w.shapesN, w.shapes.length) : 0;
      for (let k = 0; k < live; k++) {
        const m = w.shapes[k];
        if (!(m.half > 0)) continue;
        const len = Math.hypot(m.bx - m.ax, m.by - m.ay);
        ctx.beginPath();
        if (len > 1e-6) {
          const a = Math.atan2(m.by - m.ay, m.bx - m.ax);
          ctx.arc(m.ax, m.ay, m.half, a + Math.PI / 2, a - Math.PI / 2);
          ctx.arc(m.bx, m.by, m.half, a - Math.PI / 2, a + Math.PI / 2);
          ctx.closePath();
        } else ctx.arc(m.ax, m.ay, m.half, 0, TWO_PI);
        ctx.fill();
        ctx.stroke();
      }
      if (s.kind === "fire" && now >= w.inhaleUntil && now < w.onUntil) {
        const range = f.r + s.reach * f.r;
        const half = 0.5 * s.spread * DEG;
        ctx.beginPath();
        ctx.moveTo(f.x, f.y);
        ctx.arc(f.x, f.y, range, w.angle - half, w.angle + half);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      if (s.kind === "spark") {
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r + s.reach * f.r, 0, TWO_PI);
        ctx.stroke();
      }
    }
    // the per-source windows still open on this fighter: a ring each
    let open = 0;
    for (let k = 0; k < f.srcUntil.length; k++) if (f.srcUntil[k] > now) open++;
    for (let k = 0; k < open; k++) {
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r * (1.15 + 0.12 * k), 0, TWO_PI);
      ctx.stroke();
    }
  }
  for (const b of view.beams) {
    if (!b.active) continue;
    ctx.lineWidth = Math.max(1, b.width);
    ctx.beginPath();
    ctx.moveTo(b.x0, b.y0);
    ctx.lineTo(b.x1, b.y1);
    ctx.stroke();
  }
  ctx.lineWidth = 1.5;
  for (const p of view.projectiles) {
    if (!p.active) continue;
    ctx.beginPath();
    if (p.kind === PK_BOMB) {
      ctx.arc(p.x1, p.y1, Math.max(1, p.splash), 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x, p.y - flBombHeight(p, now), p.r, 0, TWO_PI);
    } else ctx.arc(p.x, p.y, p.r, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
  }
  for (const m of view.minions) {
    if (!m.active) continue;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  for (const w of view.walls) {
    if (!w.active) continue;
    ctx.beginPath();
    ctx.moveTo(w.x1, w.y1);
    ctx.lineTo(w.x2, w.y2);
    ctx.stroke();
  }
  ctx.restore();
}
