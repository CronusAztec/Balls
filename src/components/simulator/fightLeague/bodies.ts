import type { FightLeagueView, FlFighter } from "@/lib/physics/modes/fightLeague";
import { FL_FAST_STAT, FL_FLASH_TINT_MS, FL_FLASH_WHITE_MS, FL_MAX_SLOTS, FL_SPEED_LINES_AT, FL_TRAIL_AT, bodyRimWidth, flNameColor, flSquashK } from "@/lib/physics/modes/fightLeagueFx";
import { flShortName, type FlFighterRow } from "@/lib/physics/modes/fightLeagueRoster";
import type { FlFrame } from "./frame";
import { FL_STATUS_ARC_MS, GOLD, INK, RAINBOW, TEAM_COLORS, shade } from "./palette";
import { TWO_PI, hash, makeSprite, polygonPath, starPath, type Sprite } from "./sprites";
import { NUM_TEXT } from "./text";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's fighters: the body sprites (built per fighter, radius bucket and scale from
 * the row's look – its pattern and crest, visual only: the hitbox stays the circle – with an automatic 0.12 R ink rim for
 * a body that melts into the floor), the white flash silhouette and the accent tint after a hit, squash and stretch along
 * the hit, the knockback ribbons, speed lines and lunge streaks, the statuses (shape AND colour, a thin remaining-time arc),
 * the team rings, the winner's bob, the HP bar and number, the name tags, and the portraits of the cards.
 */

/** Sprite size buckets: 2^(1/8) steps of device px. */
function bucketOf(devR: number): number {
  return Math.max(0, Math.round(8 * Math.log2(Math.max(1, devR))));
}
function bucketR(bucket: number, scale: number): number {
  return 2 ** (bucket / 8) / scale;
}

/** A crest behind the body (outside the circle; our own shapes – no emblem, letter or face). */
function drawCrest(g: CanvasRenderingContext2D, R: number, row: FlFighterRow, fill: string | null, ink: string) {
  const crest = row.look?.crest ?? "none";
  if (crest === "none") return;
  const accent = fill ?? row.accent;
  const body = fill ?? row.body;
  g.lineWidth = Math.max(0.8, 0.07 * R);
  g.strokeStyle = ink;
  g.lineJoin = "round";
  switch (crest) {
    case "ears":
      g.fillStyle = body;
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(sgn * 0.25 * R, -0.85 * R);
        g.quadraticCurveTo(sgn * 0.7 * R, -1.45 * R, sgn * 0.9 * R, -0.45 * R);
        g.closePath();
        g.fill();
        g.stroke();
      }
      return;
    case "horns":
      g.fillStyle = fill ?? "#f5f5f4";
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(sgn * 0.35 * R, -0.85 * R);
        g.quadraticCurveTo(sgn * 0.75 * R, -1.25 * R, sgn * 1.15 * R, -1.3 * R);
        g.quadraticCurveTo(sgn * 0.85 * R, -0.95 * R, sgn * 0.7 * R, -0.6 * R);
        g.closePath();
        g.fill();
        g.stroke();
      }
      return;
    case "spikes":
      g.fillStyle = accent;
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k - 2) * 0.38;
        const bx = Math.cos(a) * 0.9 * R;
        const by = Math.sin(a) * 0.9 * R;
        const tx = Math.cos(a) * 1.35 * R;
        const ty = Math.sin(a) * 1.35 * R;
        const nx = -Math.sin(a) * 0.16 * R;
        const ny = Math.cos(a) * 0.16 * R;
        g.beginPath();
        g.moveTo(bx - nx, by - ny);
        g.lineTo(tx, ty);
        g.lineTo(bx + nx, by + ny);
        g.closePath();
        g.fill();
        g.stroke();
      }
      return;
    case "fins":
      g.fillStyle = accent;
      for (const sgn of [-1, 1]) {
        g.beginPath();
        g.moveTo(sgn * 0.85 * R, -0.35 * R);
        g.lineTo(sgn * 1.4 * R, -0.05 * R);
        g.lineTo(sgn * 0.85 * R, 0.4 * R);
        g.closePath();
        g.fill();
        g.stroke();
      }
      return;
    case "halo":
      g.strokeStyle = fill ?? GOLD;
      g.lineWidth = Math.max(1, 0.12 * R);
      g.beginPath();
      g.ellipse(0, -1.25 * R, 0.55 * R, 0.16 * R, 0, 0, TWO_PI);
      g.stroke();
      return;
    case "points":
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(-0.6 * R, -0.72 * R);
      g.lineTo(-0.5 * R, -1.25 * R);
      g.lineTo(-0.22 * R, -0.95 * R);
      g.lineTo(0, -1.38 * R);
      g.lineTo(0.22 * R, -0.95 * R);
      g.lineTo(0.5 * R, -1.25 * R);
      g.lineTo(0.6 * R, -0.72 * R);
      g.closePath();
      g.fill();
      g.stroke();
      return;
    case "tuft":
      g.strokeStyle = fill ?? shade(row.body, -0.35);
      g.lineCap = "round";
      g.lineWidth = Math.max(1, 0.16 * R);
      g.beginPath();
      for (const k of [-1, 0, 1]) {
        g.moveTo(k * 0.18 * R, -0.9 * R);
        g.quadraticCurveTo(k * 0.35 * R + 0.2 * R, -1.3 * R, k * 0.45 * R + 0.35 * R, -1.35 * R);
      }
      g.stroke();
      return;
    default:
      return;
  }
}

/** The body's pattern, clipped to the circle. */
function drawPattern(g: CanvasRenderingContext2D, R: number, row: FlFighterRow) {
  const pattern = row.look?.pattern ?? "ring";
  const accent = row.accent;
  switch (pattern) {
    case "band":
      g.fillStyle = accent;
      g.fillRect(-R, -0.12 * R, 2 * R, 0.3 * R);
      return;
    case "split":
      g.globalAlpha = 0.85;
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(0.15 * R, -R);
      g.lineTo(R, -R);
      g.lineTo(R, R);
      g.lineTo(-0.15 * R, R);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
      return;
    case "visor":
      g.fillStyle = accent;
      g.beginPath();
      g.moveTo(-0.72 * R, -0.36 * R);
      g.lineTo(0.72 * R, -0.36 * R);
      g.quadraticCurveTo(0.8 * R, -0.1 * R, 0.6 * R, -0.06 * R);
      g.lineTo(-0.6 * R, -0.06 * R);
      g.quadraticCurveTo(-0.8 * R, -0.1 * R, -0.72 * R, -0.36 * R);
      g.closePath();
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.35)";
      g.fillRect(-0.55 * R, -0.3 * R, 0.5 * R, 0.07 * R);
      return;
    case "hood":
      g.fillStyle = shade(row.body, -0.38);
      g.beginPath();
      g.moveTo(-R, 0.1 * R);
      g.quadraticCurveTo(-0.6 * R, -0.25 * R, 0, -0.2 * R);
      g.quadraticCurveTo(0.6 * R, -0.25 * R, R, 0.1 * R);
      g.lineTo(R, -R);
      g.lineTo(-R, -R);
      g.closePath();
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = Math.max(1, 0.08 * R);
      g.beginPath();
      g.moveTo(-0.95 * R, 0.08 * R);
      g.quadraticCurveTo(-0.6 * R, -0.25 * R, 0, -0.2 * R);
      g.quadraticCurveTo(0.6 * R, -0.25 * R, 0.95 * R, 0.08 * R);
      g.stroke();
      return;
    case "core":
      g.fillStyle = accent;
      g.beginPath();
      g.arc(0, 0.05 * R, 0.4 * R, 0, TWO_PI);
      g.fill();
      g.fillStyle = "rgba(255, 255, 255, 0.75)";
      g.beginPath();
      g.arc(0, 0.05 * R, 0.17 * R, 0, TWO_PI);
      g.fill();
      return;
    case "dots":
      g.fillStyle = accent;
      for (const [x, y] of [
        [-0.42, -0.25],
        [0.4, -0.3],
        [-0.1, 0.42],
        [0.5, 0.35],
      ]) {
        g.beginPath();
        g.arc(x * R, y * R, 0.17 * R, 0, TWO_PI);
        g.fill();
      }
      return;
    case "stripes":
      g.strokeStyle = accent;
      g.lineWidth = 0.16 * R;
      g.beginPath();
      for (const k of [-0.6, 0, 0.6]) {
        g.moveTo((k - 0.8) * R, R);
        g.lineTo((k + 0.8) * R, -R);
      }
      g.stroke();
      return;
    default:
      // ring: the accent ring of the first release
      g.strokeStyle = accent;
      g.lineWidth = Math.max(1.5, 0.13 * R);
      g.beginPath();
      g.arc(0, 0, 0.74 * R, 0, TWO_PI);
      g.stroke();
  }
}

/** A fighter's body at radius `R`: its crest, the circle, the pattern, a highlight and the ink rim (`rim` R wide). */
function drawBodyLook(g: CanvasRenderingContext2D, R: number, row: FlFighterRow, rim: number, outline: string) {
  drawCrest(g, R, row, null, outline);
  g.fillStyle = row.body;
  g.beginPath();
  g.arc(0, 0, R, 0, TWO_PI);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(0, 0, R, 0, TWO_PI);
  g.clip();
  drawPattern(g, R, row);
  g.restore();
  g.fillStyle = "rgba(255, 255, 255, 0.28)";
  g.beginPath();
  g.arc(-0.32 * R, -0.36 * R, 0.3 * R, 0, TWO_PI);
  g.fill();
  g.strokeStyle = outline;
  g.lineWidth = Math.max(1.5, rim * R);
  g.beginPath();
  g.arc(0, 0, R - 0.5 * Math.max(1.5, rim * R) + 0.6, 0, TWO_PI);
  g.stroke();
}

/** A fighter's silhouette in one colour (the flash: white; the tint: its accent). */
function drawSilhouette(g: CanvasRenderingContext2D, R: number, row: FlFighterRow, color: string) {
  drawCrest(g, R, row, color, color);
  g.fillStyle = color;
  g.beginPath();
  g.arc(0, 0, R, 0, TWO_PI);
  g.fill();
}

/** Body sprites: per fighter row, colour (body / flash / tint), radius bucket and scale. */
export class FlBodiesPainter {
  private readonly sprites = new Map<string, Sprite | null>();
  private generation = -1;
  /** The HP bars' ghost ("just lost"): where it drains from, since when, the last hit seen, the HP last frame. */
  private readonly gFrom = new Float64Array(FL_MAX_SLOTS);
  private readonly gAt = new Float64Array(FL_MAX_SLOTS);
  private readonly gSeen = new Float64Array(FL_MAX_SLOTS);
  private readonly gPrev = new Float64Array(FL_MAX_SLOTS);
  /** Knockback ribbons drawn so far this run (data-fl-trails). */
  trails = 0;

  begin(view: FightLeagueView) {
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.sprites.clear();
      this.trails = 0;
      for (let i = 0; i < FL_MAX_SLOTS; i++) {
        const f = view.fighters[i];
        this.gFrom[i] = f ? f.maxHp : 0;
        this.gAt[i] = -Infinity;
        this.gSeen[i] = -Infinity;
        this.gPrev[i] = f ? f.hp : 0;
      }
    }
  }

  /** A body sprite of `row` at radius `R` (local px) and `scale` device px per local px (kind: 0 body, 1 flash, 2 tint). */
  sprite(row: FlFighterRow, R: number, scale: number, kind: 0 | 1 | 2, floor: string, outline: string): { s: Sprite; k: number } | null {
    const b = bucketOf(R * scale);
    const key = `${row.id}|${kind}|${b}|${scale}|${floor}|${outline}`;
    let s = this.sprites.get(key);
    if (s === undefined) {
      if (this.sprites.size > 160) this.sprites.clear();
      const r = bucketR(b, scale);
      const rim = bodyRimWidth(row, floor);
      s = makeSprite({ x0: -1.55 * r, y0: -1.55 * r, x1: 1.55 * r, y1: 1.2 * r }, scale, (g) => {
        if (kind === 0) drawBodyLook(g, r, row, rim, outline);
        else drawSilhouette(g, r, row, kind === 1 ? "#ffffff" : row.accent);
      });
      this.sprites.set(key, s);
    }
    if (!s) return null;
    return { s, k: R / bucketR(b, scale) };
  }

  /** Draws `row`'s body at (x, y), radius `R`, squashed `k` along `dir` (radians), at `alpha`. */
  drawBodyAt(ctx: CanvasRenderingContext2D, fr: FlFrame, row: FlFighterRow, x: number, y: number, R: number, scale: number, kind: 0 | 1 | 2, alpha: number, squash = 0, dir = 0) {
    const sp = this.sprite(row, R, scale, kind, fr.look.floor, fr.look.outline);
    if (!sp) return;
    const { s, k } = sp;
    ctx.save();
    ctx.translate(x, y);
    if (squash > 0) {
      ctx.rotate(dir);
      ctx.scale(1 + 0.18 * squash, 1 - 0.12 * squash);
      ctx.rotate(-dir);
    }
    if (alpha < 1) ctx.globalAlpha *= alpha;
    ctx.drawImage(s.canvas, s.x0 * k, s.y0 * k, s.w * k, s.h * k);
    ctx.restore();
  }

  /** The knockback ribbons (one fill each), speed lines and lunge streaks, under every body. */
  drawTrails(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView) {
    const now = fr.now;
    for (const f of view.fighters) {
      if (!f.alive) continue;
      const fin = view.finale.from >= 0 && now >= view.finale.from;
      const vx = fin ? f.finVx : f.vx;
      const vy = fin ? f.finVy : f.vy;
      const speed = Math.hypot(vx, vy);
      const ratio = speed / Math.max(1, f.cruise);
      const fast = f.row.stats.speed >= FL_FAST_STAT && now >= view.introMs && !view.finished;
      const strong = ratio > FL_TRAIL_AT && now >= view.introMs;
      if ((strong || fast) && f.trailCount >= 3 && !fr.lite) {
        this.ribbon(ctx, fr, f, strong ? 0.35 : 0.14);
        if (strong) this.trails++;
      }
      const x = fr.x(f);
      const y = fr.y(f);
      if (ratio > FL_SPEED_LINES_AT && speed > 1) {
        const ux = vx / speed;
        const uy = vy / speed;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = INK;
        ctx.lineCap = "round";
        ctx.lineWidth = Math.max(1, 0.06 * f.r);
        ctx.beginPath();
        for (let k = -1; k <= 1; k++) {
          const ox = -uy * k * 0.55 * f.r;
          const oy = ux * k * 0.55 * f.r;
          const back = (1.25 + 0.25 * Math.abs(k)) * f.r;
          ctx.moveTo(x - ux * back + ox, y - uy * back + oy);
          ctx.lineTo(x - ux * (back + 1.3 * f.r) + ox, y - uy * (back + 1.3 * f.r) + oy);
        }
        ctx.stroke();
        ctx.restore();
      }
      const lunge = now - f.lungeMs;
      if (lunge >= 0 && lunge < 150 && speed > 1) {
        const ux = vx / speed;
        const uy = vy / speed;
        ctx.save();
        ctx.globalAlpha = 0.45 * (1 - lunge / 150);
        ctx.strokeStyle = f.row.look?.trail ?? f.row.accent;
        ctx.lineCap = "round";
        ctx.lineWidth = 0.7 * f.r;
        ctx.beginPath();
        ctx.moveTo(x - ux * 0.8 * f.r, y - uy * 0.8 * f.r);
        ctx.lineTo(x - ux * 3 * f.r, y - uy * 3 * f.r);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  /** A tapered ribbon through the trail ring (width 1.6 R → 0), in the look's trail colour, one fill. */
  private ribbon(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, alpha: number) {
    const len = f.trail.length >> 1;
    const n = Math.min(f.trailCount, len);
    // the points: the drawn position, then the ring newest first
    let px = fr.x(f);
    let py = fr.y(f);
    const xs = RIB_X;
    const ys = RIB_Y;
    xs[0] = px;
    ys[0] = py;
    let m = 1;
    for (let k = 0; k < n && m < RIB_X.length; k++) {
      const i = (((f.trailHead - 1 - k) % len) + len) % len;
      const tx = f.trail[2 * i];
      const ty = f.trail[2 * i + 1];
      if (Math.hypot(tx - px, ty - py) < 0.05) continue;
      xs[m] = tx;
      ys[m] = ty;
      px = tx;
      py = ty;
      m++;
    }
    if (m < 3) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = f.row.look?.trail ?? f.row.body;
    ctx.beginPath();
    for (let side = 0; side < 2; side++) {
      for (let q = 0; q < m; q++) {
        const j = side === 0 ? q : m - 1 - q;
        const a = Math.max(0, j - 1);
        const b = Math.min(m - 1, j + 1);
        let tx = xs[a] - xs[b];
        let ty = ys[a] - ys[b];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const hw = 0.8 * f.r * (1 - j / (m - 1));
        const sgn = side === 0 ? 1 : -1;
        const qx = xs[j] - ty * hw * sgn;
        const qy = ys[j] + tx * hw * sgn;
        if (side === 0 && q === 0) ctx.moveTo(qx, qy);
        else ctx.lineTo(qx, qy);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** A fighter: its buffs' auras, the team ring, the telegraph ring, the body (flash, squash), the statuses. */
  drawFighter(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, f: FlFighter) {
    const now = fr.now;
    const r = f.r;
    const x = fr.x(f);
    const y = fr.y(f);
    const row = f.row;
    const ghost = now < f.untargetableUntil;
    const base = ghost ? 0.35 : 1;
    // the look's glow, the winner's glow, the buffs' auras (glow sprites: no shadow, no gradient per frame)
    if (row.look?.glow) fr.glow.draw(ctx, row.look.glow, x, y, 1.9 * r, 0.42 * base);
    const winner = view.finished && view.winnerTeam >= 0 && f.team === view.winnerTeam;
    if (winner) fr.glow.draw(ctx, row.accent, x, y, 2.3 * r, 0.5 + 0.2 * Math.sin(now / 160));
    if (now < f.speedMulUntil && f.speedMul > 1) {
      const sp = Math.hypot(f.vx, f.vy);
      if (sp > 1) {
        const ux = f.vx / sp;
        const uy = f.vy / sp;
        for (let k = 1; k <= 3; k++) this.drawBodyAt(ctx, fr, row, x - ux * k * 0.7 * r, y - uy * k * 0.7 * r, r * (1 - 0.1 * k), fr.px, 0, (ghost ? 0.12 : 0.22) * (1 - k / 4));
      }
    }
    const aura = now < f.dmgMulUntil ? "#ef4444" : now < f.atkMulUntil ? GOLD : now < f.healUntil ? "#22c55e" : null;
    if (aura) fr.glow.draw(ctx, aura, x, y, 1.6 * r, (ghost ? 0.25 : 0.5) * (0.75 + 0.25 * Math.sin(now / 90)));
    // slow time: two echo ghosts behind its victims
    if (now < view.slowTimeUntil && f.team !== view.slowTimeTeam) this.drawEchoes(ctx, fr, f, base);
    // team rings: team A solid, team B dashed, teams 3–4 dotted / double
    if (view.teamCount < view.fighters.length) this.drawTeamRing(ctx, fr, f, x, y);
    // the ability's telegraph: a ring closing in on the body
    if (f.telegraphUntil >= 0) {
      const k = Math.max(0, Math.min(1, 1 - (f.telegraphUntil - now) / Math.max(1, f.telegraphUntil - f.telegraphStart)));
      ctx.save();
      ctx.strokeStyle = row.accent;
      ctx.lineWidth = Math.max(2, 0.14 * r);
      ctx.globalAlpha = (0.5 + 0.5 * k) * base;
      ctx.beginPath();
      ctx.arc(x, y, r * (2.4 - 1.2 * k), 0, TWO_PI);
      ctx.stroke();
      ctx.restore();
    }
    // the body: squash and stretch along the last hit, the white flash then the accent tint
    const hitAge = now - f.hitMs;
    const squash = flSquashK(hitAge);
    const dir = Math.atan2(f.hitDy, f.hitDx);
    // a held fighter trembles (0.06 R)
    let bx = x;
    let by = y;
    if (f.heldBy >= 0 && !view.finished) {
      bx += (hash(Math.floor(now / 30), f.slot) - 0.5) * 0.12 * r;
      by += (hash(Math.floor(now / 30), f.slot + 5) - 0.5) * 0.12 * r;
    }
    // the winner's idle bob (6 %)
    if (winner && f.alive) by -= 0.06 * r * Math.abs(Math.sin((now / 1000) * Math.PI * 1.6));
    if (ghost) this.drawRipple(ctx, f, bx, by, now);
    this.drawBodyAt(ctx, fr, row, bx, by, r, fr.px, 0, base, squash, dir);
    if (hitAge >= 0 && hitAge < FL_FLASH_WHITE_MS) this.drawBodyAt(ctx, fr, row, bx, by, r, fr.px, 1, 0.9 * base, squash, dir);
    else if (hitAge >= FL_FLASH_WHITE_MS && hitAge < FL_FLASH_TINT_MS) this.drawBodyAt(ctx, fr, row, bx, by, r, fr.px, 2, 0.4 * base * (1 - (hitAge - FL_FLASH_WHITE_MS) / (FL_FLASH_TINT_MS - FL_FLASH_WHITE_MS)), squash, dir);
    this.drawStatuses(ctx, fr, view, f, bx, by, base);
  }

  private drawEchoes(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, base: number) {
    const len = f.trail.length >> 1;
    for (let q = 0; q < 2; q++) {
      const k = 3 + 3 * q;
      if (k >= f.trailCount) break;
      const i = (((f.trailHead - 1 - k) % len) + len) % len;
      this.drawBodyAt(ctx, fr, f.row, f.trail[2 * i], f.trail[2 * i + 1], f.r, fr.px, 2, (q === 0 ? 0.25 : 0.12) * base);
    }
  }

  private drawRipple(ctx: CanvasRenderingContext2D, f: FlFighter, x: number, y: number, now: number) {
    const u = (now % 600) / 600;
    ctx.save();
    ctx.globalAlpha = 0.45 * (1 - u);
    ctx.strokeStyle = f.row.accent;
    ctx.lineWidth = Math.max(1, 0.07 * f.r);
    ctx.beginPath();
    ctx.arc(x, y, f.r * (1 + 0.6 * u), 0, TWO_PI);
    ctx.stroke();
    ctx.restore();
  }

  private drawTeamRing(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, x: number, y: number) {
    const o = fr.o;
    const colors = o && o.teamColors && o.teamColors.length >= 2 ? o.teamColors : TEAM_COLORS;
    const r = f.r;
    ctx.save();
    ctx.strokeStyle = colors[f.team] ?? TEAM_COLORS[f.team & 3];
    ctx.lineWidth = Math.max(2, 0.16 * r);
    if (f.team === 1) ctx.setLineDash([0.45 * r, 0.3 * r]);
    else if (f.team === 2) ctx.setLineDash([0.12 * r, 0.25 * r]);
    ctx.beginPath();
    ctx.arc(x, y, 1.2 * r, 0, TWO_PI);
    ctx.stroke();
    if (f.team === 3) {
      ctx.lineWidth = Math.max(1, 0.07 * r);
      ctx.beginPath();
      ctx.arc(x, y, 1.38 * r, 0, TWO_PI);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  /** The statuses on top of the body (shape AND colour) and the most pressing one's remaining-time arc. */
  private drawStatuses(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, f: FlFighter, x: number, y: number, base: number) {
    const now = fr.now;
    const r = f.r;
    const row = f.row;
    ctx.save();
    let arcUntil = -Infinity;
    let arcColor = "#ffffff";
    const pick = (until: number, color: string) => {
      if (arcUntil === -Infinity && until > now && until < Infinity) {
        arcUntil = until;
        arcColor = color;
      }
    };
    // frozen: an ice shell with cracks, shattering into six shards at the thaw
    if (now < f.frozenUntil) {
      pick(f.frozenUntil, "#7dd3fc");
      ctx.globalAlpha = 0.55 * base;
      ctx.fillStyle = "#bae6fd";
      ctx.beginPath();
      ctx.arc(x, y, 1.1 * r, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 0.9 * base;
      ctx.strokeStyle = "#e0f2fe";
      ctx.lineWidth = Math.max(1, 0.07 * r);
      ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 + 0.3;
        ctx.moveTo(x + Math.cos(a) * 0.3 * r, y + Math.sin(a) * 0.3 * r);
        ctx.lineTo(x + Math.cos(a) * 1.05 * r, y + Math.sin(a) * 1.05 * r);
      }
      ctx.stroke();
    } else if (Number.isFinite(f.frozenUntil) && now - f.frozenUntil < 300 && now >= f.frozenUntil) {
      const t = (now - f.frozenUntil) / 300;
      ctx.globalAlpha = (1 - t) * base;
      ctx.fillStyle = "#bae6fd";
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3 + 0.3 + 0.4 * hash(k, f.slot);
        const d = r * (0.9 + 1.4 * t);
        starPath(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d + 0.6 * r * t * t, 0.28 * r * (1 - 0.4 * t), 0.1 * r, 3, a);
        ctx.fill();
      }
    }
    // held: three grip arcs closing on the body and the tether to the holder
    if (f.heldBy >= 0) {
      pick(f.heldUntil, "#a855f7");
      ctx.globalAlpha = (0.6 + 0.4 * Math.sin(now / 60)) * base;
      ctx.strokeStyle = "#a855f7";
      ctx.lineWidth = Math.max(2, 0.16 * r);
      ctx.lineCap = "round";
      const spin = now / 500;
      for (let k = 0; k < 3; k++) {
        const a = spin + (k * TWO_PI) / 3;
        ctx.beginPath();
        ctx.arc(x, y, 1.18 * r, a, a + 1.2);
        ctx.stroke();
      }
      const by = view.fighters[f.heldBy];
      if (by && by.alive) {
        ctx.globalAlpha = 0.4 * base;
        ctx.setLineDash([4, 6]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fr.x(by), fr.y(by));
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // webbed / slowed: a web splat over the body
    if (now < f.slowUntil) {
      pick(f.slowUntil, "#f8fafc");
      ctx.globalAlpha = 0.85 * base;
      ctx.strokeStyle = "rgba(248, 250, 252, 0.95)";
      ctx.lineWidth = Math.max(0.8, 0.05 * r);
      ctx.beginPath();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 4 + 0.2;
        ctx.moveTo(x - Math.cos(a) * 1.05 * r, y - Math.sin(a) * 1.05 * r);
        ctx.lineTo(x + Math.cos(a) * 1.05 * r, y + Math.sin(a) * 1.05 * r);
      }
      ctx.moveTo(x + 0.55 * r, y);
      ctx.arc(x, y, 0.55 * r, 0, TWO_PI);
      ctx.moveTo(x + 0.85 * r, y);
      ctx.arc(x, y, 0.85 * r, 0, TWO_PI);
      ctx.stroke();
    }
    // reflect: a rotating mirror hexagon
    if (now < f.reflectUntil) {
      pick(f.reflectUntil, row.accent);
      ctx.globalAlpha = 0.75 * base;
      ctx.strokeStyle = row.accent;
      ctx.lineWidth = Math.max(1.5, 0.1 * r);
      polygonPath(ctx, x, y, 1.28 * r, 6, now / 400);
      ctx.stroke();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
      ctx.lineWidth = Math.max(0.8, 0.04 * r);
      polygonPath(ctx, x, y, 1.2 * r, 6, now / 400);
      ctx.stroke();
    }
    // invulnerable: a gold shell (Super Star's contact: the rainbow)
    if (now < f.invulnUntil) {
      pick(f.invulnUntil, GOLD);
      const star = now < f.contactUntil;
      const color = star ? RAINBOW[Math.floor(now / 30) % RAINBOW.length] : GOLD;
      ctx.globalAlpha = 0.14 * base;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x, y, 1.25 * r, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = (0.6 + 0.4 * Math.sin(now / 70)) * base;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(2, 0.16 * r);
      ctx.beginPath();
      ctx.arc(x, y, 1.28 * r, 0, TWO_PI);
      ctx.stroke();
    }
    if (now < f.untargetableUntil) pick(f.untargetableUntil, row.accent);
    // confused: stars circling over the head and a puff of gas
    if (now < f.confusedUntil) {
      pick(f.confusedUntil, GOLD);
      ctx.globalAlpha = 0.3 * base;
      ctx.fillStyle = "#86efac";
      ctx.beginPath();
      ctx.arc(x - 0.2 * r, y - 1.3 * r, 0.42 * r, 0, TWO_PI);
      ctx.arc(x + 0.25 * r, y - 1.45 * r, 0.32 * r, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = base;
      ctx.fillStyle = GOLD;
      for (let k = 0; k < 3; k++) {
        const a = now / 180 + (k * TWO_PI) / 3;
        starPath(ctx, x + Math.cos(a) * 0.7 * r, y - 1.25 * r + Math.sin(a) * 0.22 * r, 0.22 * r, 0.09 * r, 4, a);
        ctx.fill();
      }
    }
    // disarmed: a padlock beside the body (the weapon itself is drawn grey at 35 %)
    if (now < f.disarmedUntil) {
      pick(f.disarmedUntil, "#9ca3af");
      const lx = x + 0.95 * r;
      const ly = y - 0.95 * r;
      const s = 0.36 * r;
      ctx.globalAlpha = base;
      ctx.fillStyle = "#9ca3af";
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1, 0.18 * s);
      ctx.beginPath();
      ctx.rect(lx - s, ly - 0.2 * s, 2 * s, 1.4 * s);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(lx, ly - 0.2 * s, 0.65 * s, Math.PI, 0);
      ctx.stroke();
    }
    // pinned: two pin ticks
    if (now < f.pinUntil) {
      pick(f.pinUntil, "#e5e7eb");
      ctx.globalAlpha = base;
      ctx.strokeStyle = INK;
      ctx.lineWidth = Math.max(1.5, 0.12 * r);
      ctx.beginPath();
      for (const sgn of [-1, 1]) {
        const px = x + sgn * 1.15 * r;
        ctx.moveTo(px - 0.22 * r, y - 0.22 * r);
        ctx.lineTo(px + 0.22 * r, y + 0.22 * r);
        ctx.moveTo(px + 0.22 * r, y - 0.22 * r);
        ctx.lineTo(px - 0.22 * r, y + 0.22 * r);
      }
      ctx.stroke();
    }
    // transformed: a double rim pulsing at 1 Hz
    if (now < f.transformUntil) {
      pick(f.transformUntil, row.accent);
      const p = 0.5 + 0.5 * Math.sin((now / 1000) * TWO_PI);
      ctx.globalAlpha = (0.35 + 0.45 * p) * base;
      ctx.strokeStyle = row.accent;
      ctx.lineWidth = Math.max(1.5, 0.08 * r);
      ctx.beginPath();
      ctx.arc(x, y, 1.08 * r, 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 1.2 * r, 0, TWO_PI);
      ctx.stroke();
    }
    // drain: a faint red-green tether to its target
    if (now < f.drainUntil && f.targetSlot >= 0) {
      pick(f.drainUntil, "#4ade80");
      const t = view.fighters[f.targetSlot];
      if (t && t.alive) {
        ctx.globalAlpha = 0.3 * base;
        ctx.lineWidth = Math.max(1, 0.08 * r);
        ctx.strokeStyle = "#ef4444";
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(fr.x(t), fr.y(t));
        ctx.stroke();
        ctx.strokeStyle = "#4ade80";
        ctx.setLineDash([0.3 * r, 0.3 * r]);
        ctx.lineDashOffset = -now / 20;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    // pulled: a line to the puller
    if (now < f.pullUntil && f.pullBy >= 0) {
      const by = view.fighters[f.pullBy];
      if (by && by.alive) {
        ctx.globalAlpha = 0.8 * base;
        ctx.strokeStyle = by.row.accent;
        ctx.lineWidth = Math.max(1.5, 0.08 * r);
        ctx.beginPath();
        ctx.moveTo(fr.x(by), fr.y(by));
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
    // immune to crowd control: a faint white ring
    if (now < f.ccImmuneUntil) {
      ctx.globalAlpha = 0.35 * base;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = Math.max(1, 0.06 * r);
      ctx.beginPath();
      ctx.arc(x, y, 1.32 * r, 0, TWO_PI);
      ctx.stroke();
    }
    // low HP: the rim beats like a heart (1.2 Hz)
    const frac = f.hp / Math.max(1e-9, f.maxHp);
    if (f.alive && frac < 0.25 && !view.finished) {
      const ph = ((now / 1000) * 1.2) % 1;
      const beat = Math.max(Math.exp(-((ph - 0.1) ** 2) / 0.003), 0.7 * Math.exp(-((ph - 0.3) ** 2) / 0.003));
      ctx.globalAlpha = 0.85 * beat * base;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = Math.max(1.5, 0.14 * r);
      ctx.beginPath();
      ctx.arc(x, y, r * (1.02 + 0.06 * beat), 0, TWO_PI);
      ctx.stroke();
    }
    // the remaining-time arc (0.08 R, 30 %) of the most pressing status
    if (arcUntil > now) {
      const k = Math.min(1, (arcUntil - now) / FL_STATUS_ARC_MS);
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = arcColor;
      ctx.lineWidth = Math.max(1, 0.08 * r);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(x, y, 1.45 * r, -Math.PI / 2, -Math.PI / 2 + k * TWO_PI);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The HP the "just lost" ghost shows for `f` at `now`: analytic in the simulation clock – held 280 ms after the last hit,
   * then draining 0.9 max HP a second (it follows the hits it sees; idempotent within a frame).
   */
  ghostHp(f: FlFighter, now: number): number {
    const slot = f.slot;
    if (slot >= FL_MAX_SLOTS) return f.hp;
    const rate = 0.9 * f.maxHp;
    if (f.hitMs !== this.gSeen[slot] && f.hitMs > -Infinity) {
      const before = Math.max(this.gPrev[slot], this.gFrom[slot] - rate * Math.max(0, (f.hitMs - this.gAt[slot] - 280) / 1000));
      this.gFrom[slot] = Math.max(f.hp, before);
      this.gAt[slot] = f.hitMs;
      this.gSeen[slot] = f.hitMs;
    }
    if (f.hp > this.gFrom[slot]) this.gFrom[slot] = f.hp;
    this.gPrev[slot] = f.hp;
    return Math.max(f.hp, this.gFrom[slot] - rate * Math.max(0, (now - this.gAt[slot] - 280) / 1000));
  }

  /** The HP bar under the ball (a white "just lost" ghost; blinking under 25 %) and the HP number inside. */
  drawHp(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, f: FlFighter, numbers: boolean) {
    const now = fr.now;
    const frac = Math.max(0, Math.min(1, f.hp / Math.max(1e-9, f.maxHp)));
    const ghostFrac = Math.max(frac, Math.min(1, this.ghostHp(f, now) / Math.max(1e-9, f.maxHp)));
    const r = f.r;
    const x = fr.x(f);
    const y = fr.y(f);
    const w = 2.2 * r;
    const h = Math.max(3, 0.3 * r);
    const top = y + 1.24 * r;
    const blink = frac < 0.25 && !view.finished && Math.floor(now / 125) % 2 === 0;
    ctx.globalAlpha = 1;
    ctx.fillStyle = fr.pal.hud.barTrack;
    ctx.fillRect(x - w / 2 - 1.5, top - 1.5, w + 3, h + 3);
    if (ghostFrac > frac) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - w / 2 + w * frac, top, w * (ghostFrac - frac), h);
    }
    ctx.fillStyle = blink ? "#fecaca" : frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#eab308" : "#ef4444";
    ctx.fillRect(x - w / 2, top, w * frac, h);
    if (numbers) {
      const hp = Math.max(0, Math.ceil(f.hp - 1e-6));
      const side = view.field ? view.field.sqSide / Math.max(1e-6, view.field.dk || 1) : 450;
      const fs = Math.max(0.8 * r, (34 / 1080) * side);
      const text = NUM_TEXT[Math.min(NUM_TEXT.length - 1, hp)] ?? String(hp);
      fr.text.number(ctx, text, x, y + 0.04 * fs, fs, "#ffffff", "rgba(11, 11, 15, 0.9)", "center");
    }
  }

  /** The name tag under the HP bar (the short name in the body colour, a dark stroke; 40 % while untargetable). */
  drawTag(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, f: FlFighter) {
    const r = f.r;
    const side = view.field ? view.field.sqSide / Math.max(1e-6, view.field.dk || 1) : 450;
    const fs = Math.max(0.45 * r, 0.021 * side);
    const y = fr.y(f) + 1.24 * r + Math.max(3, 0.3 * r) + 0.75 * fs;
    const alpha = fr.now < f.untargetableUntil ? 0.4 : 1;
    fr.text.draw(ctx, flShortName(f.row), fr.x(f), y, fs, { role: "ui", color: flNameColor(f.row.body, f.row.accent), stroke: INK, strokeK: 0.14 }, "center", 0, alpha);
  }

  /** A portrait: the fighter's ball at radius `R` (screen px) – the cards' and the boxes'. */
  drawPortrait(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, x: number, y: number, R: number, alpha = 1, kind: 0 | 1 | 2 = 0) {
    this.drawBodyAt(ctx, fr, f.row, x, y, R, fr.dpr, kind, alpha);
  }
}

/** Scratch buffers of a ribbon's points (the drawn position + the ring). */
const RIB_X = new Float64Array(16);
const RIB_Y = new Float64Array(16);
