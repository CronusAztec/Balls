import { WALL_BOTTOM, WALL_LEFT, WALL_RIGHT, WALL_TOP, arenaColor, type ArenaView } from "@/lib/physics/modes/arenaGames";
import type { Ball } from "@/lib/physics/types";

/**
 * Canvas drawing of the arena games (feature jdm-arena-games: Bouncing Square Battle Royale and Capture the Flag, see
 * lib/physics/modes/arenaGames.ts). Created once with the canvas loop:
 *
 * - `drawStage()` (inside the camera transform, under the squares): the box or circle and the shrinking safe zone of
 *   the battle with each wall glowing after a hit, the power-ups; the two halves, bases and lying flags of capture the
 *   flag;
 * - `drawBodies()` (in place of the balls): the squares – team colour, a white flash on a hit, a cyan ring while a
 *   shield lasts, streaks while a speed boost lasts, HP bar and number (battle), the flag a carrier holds (capture the
 *   flag), names from the Teams roster – and the KO blasts: shards, a shock ring and the "KO!" callout;
 * - `drawOverlay()` (screen space, after the HUD): the scoreboard band at the top of the exported square (squares left,
 *   or the score and the time left), the "CAPTURE!" banner and the winner banner with confetti.
 *
 * Everything is timed by the simulation clock of the view (flashes, blasts and confetti freeze with a pause and replay
 * in recordings) and computed from it – the shards and confetti are analytic, hashed from their index – so a steady
 * frame allocates nothing beyond a few fill strings.
 */

export interface ArenaLabels {
  /** The callout over a knocked-out square. */
  ko: string;
  /** "[name] WINS!" with the name filled in. */
  wins: (name: string) => string;
  draw: string;
  /** Battle: squares still in the fight. */
  left: (n: number) => string;
  /** Capture the flag: the banner of a capture. */
  capture: string;
  /** Capture the flag: the game ended on time. */
  time: string;
  /** Battle: the winner's KOs and HP left under the banner. */
  battleSub: (kos: number, hp: number) => string;
  /** Capture the flag: the final score under the banner. */
  ctfSub: (a: number, b: number) => string;
  /** Battle: the safe zone is closing. */
  zone: string;
  /** Built-in names of the squares / teams (index = square or team; colour names). */
  names: readonly string[];
}

export const DEFAULT_ARENA_LABELS: ArenaLabels = {
  ko: "KO!",
  wins: (name) => `${name} WINS!`,
  draw: "DRAW!",
  left: (n) => `${n} LEFT`,
  capture: "CAPTURE!",
  time: "TIME!",
  battleSub: (kos, hp) => `${kos} KO${kos !== 1 ? "s" : ""} · ${hp} HP left`,
  ctfSub: (a, b) => `${a} – ${b}`,
  zone: "ZONE CLOSING",
  names: ["Red", "Blue", "Green", "Gold", "Purple", "Orange", "Pink", "Cyan", "Lime", "Teal", "Coral", "Indigo", "Mint", "Violet", "Amber", "Sky", "Rose", "Olive", "Navy", "Snow"],
};

/** A roster entry of the Teams feature (names and colours win over the built-in ones). */
export interface ArenaRosterEntry {
  name: string;
  color: string;
  emoji: string;
}

export interface ArenaRenderOptions {
  /** Colour of wall `index`, optionally with alpha – the canvas' wall colour function, so rainbow walls apply. */
  wallColor: (index: number, alpha?: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
  showGlow: boolean;
  showTrails: boolean;
  /** The Teams roster (null / empty: the built-in names and colours). */
  roster: readonly ArenaRosterEntry[] | null;
  /** Draw the team names under the squares (the roster's names only). */
  showNames: boolean;
  /** Draw the HP number inside the squares (off while ball faces cover them). */
  numbers: boolean;
  labels: ArenaLabels;
}

const TWO_PI = Math.PI * 2;
/** Simulation ms a hit flash, a wall glow, a KO blast and the "CAPTURE!" banner last. */
export const HIT_FLASH_MS = 220;
export const WALL_GLOW_MS = 500;
export const KO_MS = 1200;
export const CAPTURE_BANNER_MS = 1400;
const SHARDS = 14;
const CONFETTI = 90;
const GOLD = "#facc15";

/** A stable pseudo-random number in [0, 1) for index `i` and salt `s` (analytic shards and confetti). */
function hash(i: number, s: number): number {
  const x = Math.sin(i * 12.9898 + s * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  ctx.lineTo(x + radius, y + h);
  ctx.arcTo(x, y + h, x, y + h - radius, radius);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.closePath();
}

export class ArenaLayer {
  private generation = -1;
  private roster: readonly ArenaRosterEntry[] | null = null;
  private names: string[] = [];
  private colors: string[] = [];
  private namesSource: readonly string[] = [];
  /** The body colour of a square for the ball faces (by engine ball). */
  readonly bodyColor = (ball: { id: number }): string => this.colorOf(ball.id - this.firstId);
  private firstId = 0;
  /** Squares drawn and names shown last frame (for the data attributes). */
  squaresDrawn = 0;

  /** Name and colour of team / square `index` (the roster's, else the built-in ones). */
  nameOf(index: number): string {
    return this.names[index] ?? "";
  }
  colorOf(index: number): string {
    return this.colors[index] ?? arenaColor(index);
  }

  /** Once per frame, before drawing: picks up a new run, a new roster or new labels. */
  beginFrame(view: ArenaView, o: ArenaRenderOptions) {
    this.firstId = view.firstId;
    const teams = view.game === "ctf" ? 2 : view.count;
    if (view.generation === this.generation && o.roster === this.roster && o.labels.names === this.namesSource && this.names.length === teams) return;
    this.generation = view.generation;
    this.roster = o.roster;
    this.namesSource = o.labels.names;
    this.names = [];
    this.colors = [];
    for (let i = 0; i < teams; i++) {
      const entry = o.roster && i < o.roster.length ? o.roster[i] : null;
      const name = entry && entry.name ? entry.name : (o.labels.names[i] ?? `#${i + 1}`);
      this.names.push(entry && entry.emoji ? `${entry.emoji} ${name}` : name);
      this.colors.push(entry ? entry.color : arenaColor(i));
    }
  }

  /* ------------------------------------------------------------------ the stage */

  drawStage(ctx: CanvasRenderingContext2D, view: ArenaView, o: ArenaRenderOptions) {
    const f = view.field;
    if (!f) return;
    this.beginFrame(view, o);
    const now = view.timeMs;
    const thickness = Math.max(1.5, o.wallThickness);
    ctx.save();
    if (view.game === "ctf") this.drawCtfField(ctx, view, o);
    // The full field, faint, once the zone has closed in on it.
    if (view.zone < 0.999) {
      ctx.globalAlpha = 0.35;
      ctx.setLineDash([6, 8]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = o.wallColor(0, 0.6);
      if (f.kind === "circle") {
        ctx.beginPath();
        ctx.arc(f.cx, f.cy, f.radius, 0, TWO_PI);
        ctx.stroke();
      } else ctx.strokeRect(f.cx - f.halfW, f.cy - f.halfH, 2 * f.halfW, 2 * f.halfH);
      ctx.setLineDash([]);
      // Outside the zone: a red haze.
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      if (f.kind === "circle") {
        ctx.arc(f.cx, f.cy, f.radius, 0, TWO_PI);
        ctx.arc(f.cx, f.cy, f.radius * view.zone, 0, TWO_PI, true);
      } else {
        ctx.rect(f.cx - f.halfW, f.cy - f.halfH, 2 * f.halfW, 2 * f.halfH);
        ctx.rect(f.cx + f.halfW * view.zone, f.cy - f.halfH * view.zone, -2 * f.halfW * view.zone, 2 * f.halfH * view.zone);
      }
      ctx.fill("evenodd");
    }
    const z = view.zone;
    const hw = f.halfW * z;
    const hh = f.halfH * z;
    const r = f.radius * z;
    // The walls, each glowing for a moment after a hit (the whole zone pulses red while it closes).
    const closing = view.zoneShrinking ? 0.5 + 0.5 * Math.sin(now / 160) : 0;
    if (o.showWallGlow) {
      const walls = f.kind === "circle" ? 8 : 4;
      for (let w = 0; w < walls; w++) {
        const age = now - view.wallHitMs[w];
        if (!(age < WALL_GLOW_MS)) continue;
        const strength = 1 - age / WALL_GLOW_MS;
        ctx.globalAlpha = 0.6 * strength;
        ctx.strokeStyle = o.wallColor(w, 0.8);
        ctx.lineWidth = thickness + 10 * strength;
        ctx.beginPath();
        if (f.kind === "circle") ctx.arc(f.cx, f.cy, r, (w * TWO_PI) / 8, ((w + 1) * TWO_PI) / 8);
        else if (w === WALL_TOP) {
          ctx.moveTo(f.cx - hw, f.cy - hh);
          ctx.lineTo(f.cx + hw, f.cy - hh);
        } else if (w === WALL_RIGHT) {
          ctx.moveTo(f.cx + hw, f.cy - hh);
          ctx.lineTo(f.cx + hw, f.cy + hh);
        } else if (w === WALL_BOTTOM) {
          ctx.moveTo(f.cx - hw, f.cy + hh);
          ctx.lineTo(f.cx + hw, f.cy + hh);
        } else if (w === WALL_LEFT) {
          ctx.moveTo(f.cx - hw, f.cy - hh);
          ctx.lineTo(f.cx - hw, f.cy + hh);
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = thickness + (closing > 0 ? 2 * closing : 0);
    ctx.strokeStyle = closing > 0 ? `rgba(248, 113, 113, ${0.6 + 0.4 * closing})` : o.wallColor(0);
    if (o.showGlow || closing > 0) {
      ctx.shadowColor = closing > 0 ? "#ef4444" : o.wallColor(0);
      ctx.shadowBlur = 12;
    }
    if (f.kind === "circle") {
      ctx.beginPath();
      ctx.arc(f.cx, f.cy, r, 0, TWO_PI);
      ctx.stroke();
    } else {
      roundedRect(ctx, f.cx - hw, f.cy - hh, 2 * hw, 2 * hh, Math.min(10, 0.03 * Math.min(hw, hh)));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    if (view.powerUps.length > 0) this.drawPowerUps(ctx, view);
    ctx.restore();
  }

  /** Capture the flag: the two halves in faint team colours, the centre line, the bases and the flags lying about. */
  private drawCtfField(ctx: CanvasRenderingContext2D, view: ArenaView, o: ArenaRenderOptions) {
    const f = view.field!;
    const now = view.timeMs;
    for (let team = 0; team < 2; team++) {
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = this.colorOf(team);
      ctx.fillRect(team === 0 ? f.cx - f.halfW : f.cx, f.cy - f.halfH, f.halfW, 2 * f.halfH);
    }
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([8, 10]);
    ctx.strokeStyle = o.wallColor(0, 0.7);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(f.cx, f.cy - f.halfH);
    ctx.lineTo(f.cx, f.cy + f.halfH);
    ctx.stroke();
    ctx.setLineDash([]);
    for (let team = 0; team < view.bases.length; team++) {
      const b = view.bases[team];
      const color = this.colorOf(team);
      const scored = view.lastCaptureTeam === team && now - view.lastCaptureMs < CAPTURE_BANNER_MS ? 1 - (now - view.lastCaptureMs) / CAPTURE_BANNER_MS : 0;
      ctx.globalAlpha = 0.16 + 0.3 * scored;
      ctx.fillStyle = color;
      roundedRect(ctx, b.x - b.hw, b.y - b.hh, 2 * b.hw, 2 * b.hh, 0.2 * b.hw);
      ctx.fill();
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
    for (let team = 0; team < view.flags.length; team++) {
      const flag = view.flags[team];
      if (flag.state === "carried") continue;
      const size = 0.55 * view.bases[team].hw;
      this.drawFlag(ctx, this.colorOf(team), flag.x, flag.y + 0.5 * size, size, now, flag.state === "dropped" ? 0.5 + 0.5 * Math.sin(now / 90) : 1);
    }
    ctx.globalAlpha = 1;
  }

  /** A flag on a pole standing at (`x`, `y`) (its foot), `size` tall, the cloth waving. */
  private drawFlag(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, size: number, now: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#f4f4f5";
    ctx.lineWidth = Math.max(1.5, 0.07 * size);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - size);
    ctx.stroke();
    const wave = 0.12 * size * Math.sin(now / 130);
    const top = y - size;
    const w = 0.7 * size;
    const h = 0.45 * size;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.quadraticCurveTo(x + 0.5 * w, top + wave, x + w, top + 0.1 * h + 0.5 * wave);
    ctx.lineTo(x + w, top + 1.1 * h + 0.5 * wave);
    ctx.quadraticCurveTo(x + 0.5 * w, top + h + wave, x, top + h);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.stroke();
    ctx.restore();
  }

  /** Battle: the power-ups, pulsing, with their icons (heal: a cross, shield: a shield, speed: a bolt), fading before they expire. */
  private drawPowerUps(ctx: CanvasRenderingContext2D, view: ArenaView) {
    const now = view.timeMs;
    for (const p of view.powerUps) {
      const born = Math.min(1, (now - p.spawnMs) / 250);
      const left = p.expireMs - now;
      const blink = left < 2000 ? 0.55 + 0.45 * Math.sin(now / 60) : 1;
      const pulse = 1 + 0.08 * Math.sin(now / 150);
      const r = p.r * born * pulse;
      const color = p.kind === "heal" ? "#22c55e" : p.kind === "shield" ? "#22d3ee" : "#facc15";
      ctx.globalAlpha = 0.25 * blink;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 1.6 * r, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 0.95 * blink;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = "#0b0b0f";
      ctx.strokeStyle = "#0b0b0f";
      const s = 0.55 * r;
      ctx.beginPath();
      if (p.kind === "heal") {
        const t = 0.35 * s;
        ctx.rect(p.x - t, p.y - s, 2 * t, 2 * s);
        ctx.rect(p.x - s, p.y - t, 2 * s, 2 * t);
        ctx.fill();
      } else if (p.kind === "shield") {
        ctx.moveTo(p.x, p.y - s);
        ctx.lineTo(p.x + 0.85 * s, p.y - 0.6 * s);
        ctx.quadraticCurveTo(p.x + 0.8 * s, p.y + 0.55 * s, p.x, p.y + s);
        ctx.quadraticCurveTo(p.x - 0.8 * s, p.y + 0.55 * s, p.x - 0.85 * s, p.y - 0.6 * s);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.moveTo(p.x + 0.25 * s, p.y - s);
        ctx.lineTo(p.x - 0.55 * s, p.y + 0.15 * s);
        ctx.lineTo(p.x - 0.05 * s, p.y + 0.15 * s);
        ctx.lineTo(p.x - 0.25 * s, p.y + s);
        ctx.lineTo(p.x + 0.55 * s, p.y - 0.15 * s);
        ctx.lineTo(p.x + 0.05 * s, p.y - 0.15 * s);
        ctx.closePath();
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ the squares */

  drawBodies(ctx: CanvasRenderingContext2D, balls: readonly Ball[], view: ArenaView, o: ArenaRenderOptions) {
    this.beginFrame(view, o);
    const now = view.timeMs;
    const first = view.firstId;
    let drawn = 0;
    ctx.save();
    for (const ball of balls) {
      const k = ball.id - first;
      if (k < 0 || k >= view.count || !view.alive[k]) continue;
      drawn++;
      const team = view.team[k];
      const color = this.colorOf(team);
      const h = ball.radius;
      const x = ball.x;
      const y = ball.y;
      const speedy = view.speedUntilMs[k] > now;
      // Trail: a few fading ghosts of the square along its last positions (streaks while a speed boost lasts).
      if ((o.showTrails || speedy) && ball.trail.length > 2) {
        const len = ball.trail.length;
        const count = speedy ? 6 : 3;
        for (let i = 1; i <= count && i < len; i++) {
          const p = ball.trail[(ball.trailIndex - 1 - 2 * i + 4 * len) % len];
          if (!p) continue;
          ctx.globalAlpha = (speedy ? 0.28 : 0.16) * (1 - i / (count + 1));
          ctx.fillStyle = speedy ? GOLD : color;
          const s = h * (1 - 0.08 * i);
          ctx.fillRect(p.x - s, p.y - s, 2 * s, 2 * s);
        }
      }
      if (o.showGlow) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = color;
        roundedRect(ctx, x - 1.35 * h, y - 1.35 * h, 2.7 * h, 2.7 * h, 0.4 * h);
        ctx.fill();
      }
      const hitAge = now - view.hitMs[k];
      const flash = hitAge >= 0 && hitAge < HIT_FLASH_MS ? 1 - hitAge / HIT_FLASH_MS : 0;
      // A hit square wobbles a little (squash along the hit, render only).
      const squash = 1 + 0.12 * flash;
      ctx.globalAlpha = 1;
      ctx.fillStyle = color;
      roundedRect(ctx, x - h * squash, y - h / squash, 2 * h * squash, (2 * h) / squash, 0.18 * h);
      ctx.fill();
      ctx.lineWidth = Math.max(1.5, 0.08 * h);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
      ctx.stroke();
      if (flash > 0) {
        ctx.globalAlpha = 0.85 * flash;
        ctx.fillStyle = "#ffffff";
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (view.shieldUntilMs[k] > now) {
        const pulse = 0.6 + 0.4 * Math.sin(now / 110);
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = `rgba(34, 211, 238, ${pulse})`;
        ctx.lineWidth = Math.max(2, 0.12 * h);
        roundedRect(ctx, x - 1.3 * h, y - 1.3 * h, 2.6 * h, 2.6 * h, 0.45 * h);
        ctx.stroke();
      }
      if (view.game === "battle") this.drawHp(ctx, view, k, x, y, h, o);
      else if (view.carrying[k] >= 0) {
        this.drawFlag(ctx, this.colorOf(view.carrying[k]), x + 0.1 * h, y - 0.6 * h, 1.5 * h, now, 1);
      }
      if (o.showNames && o.roster && o.roster.length > team) {
        const fs = Math.max(9, 0.42 * h);
        ctx.globalAlpha = 0.9;
        ctx.font = `600 ${fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#f4f4f5";
        ctx.fillText(this.nameOf(team), x, y + h + 3);
      }
    }
    this.squaresDrawn = drawn;
    this.drawKos(ctx, view, o);
    ctx.restore();
  }

  /** Battle: the HP bar above the square and the HP number inside it. */
  private drawHp(ctx: CanvasRenderingContext2D, view: ArenaView, k: number, x: number, y: number, h: number, o: ArenaRenderOptions) {
    const frac = Math.max(0, Math.min(1, view.hp[k] / Math.max(1e-9, view.maxHp)));
    const w = 2.2 * h;
    const bh = Math.max(3, 0.18 * h);
    const top = y - h - bh - Math.max(3, 0.2 * h);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, bh + 2);
    ctx.fillStyle = frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#eab308" : "#ef4444";
    ctx.fillRect(x - w / 2, top, w * frac, bh);
    if (o.numbers) {
      const fs = Math.max(9, 0.9 * h);
      ctx.globalAlpha = 1;
      ctx.font = `bold ${fs}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(2, 0.12 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
      const text = String(Math.ceil(view.hp[k] - 1e-6));
      ctx.strokeText(text, x, y + 0.05 * fs);
      ctx.fillStyle = "#ffffff";
      ctx.fillText(text, x, y + 0.05 * fs);
    }
  }

  /** The KO blasts: shards of the square flying out and spinning, a shock ring and the "KO!" callout rising. */
  private drawKos(ctx: CanvasRenderingContext2D, view: ArenaView, o: ArenaRenderOptions) {
    const now = view.timeMs;
    for (let i = view.kos.length - 1; i >= 0; i--) {
      const ko = view.kos[i];
      const age = now - ko.timeMs;
      if (age < 0 || age >= KO_MS) continue;
      const t = age / KO_MS;
      const color = this.colorOf(view.team[ko.index] ?? ko.index);
      ctx.globalAlpha = 0.7 * (1 - t);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3 * (1 - t) + 1;
      ctx.beginPath();
      ctx.arc(ko.x, ko.y, ko.half * (1 + 5 * t), 0, TWO_PI);
      ctx.stroke();
      const sec = age / 1000;
      for (let s = 0; s < SHARDS; s++) {
        const a = TWO_PI * (s / SHARDS + 0.3 * hash(s, ko.index));
        const speed = ko.half * (3 + 5 * hash(s, ko.index + 7));
        const d = speed * sec * (1 - 0.35 * sec);
        const size = ko.half * (0.18 + 0.25 * hash(s, ko.index + 3)) * (1 - 0.6 * t);
        ctx.save();
        ctx.translate(ko.x + Math.cos(a) * d, ko.y + Math.sin(a) * d + 40 * sec * sec);
        ctx.rotate(6 * sec * (hash(s, 11) - 0.5) * 4);
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = s % 3 === 0 ? "#ffffff" : color;
        ctx.fillRect(-size, -size, 2 * size, 2 * size);
        ctx.restore();
      }
      const pop = t < 0.15 ? t / 0.15 : 1;
      const fs = Math.max(16, 1.1 * ko.half) * (0.6 + 0.6 * pop);
      ctx.globalAlpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      ctx.font = `900 ${fs}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineWidth = Math.max(3, 0.14 * fs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      const ty = ko.y - ko.half - 0.4 * fs - 30 * t;
      ctx.strokeText(o.labels.ko, ko.x, ty);
      ctx.fillStyle = "#fde047";
      ctx.fillText(o.labels.ko, ko.x, ty);
    }
    ctx.globalAlpha = 1;
  }

  /* ------------------------------------------------------------------ screen space */

  drawOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, view: ArenaView, o: ArenaRenderOptions) {
    const f = view.field;
    if (!f) return;
    this.beginFrame(view, o);
    const side = Math.min(width, height);
    const left = (width - side) / 2;
    const top = (height - side) / 2;
    ctx.save();
    if (view.game === "battle") this.drawBattleHud(ctx, view, o, left, top, side);
    else this.drawCtfHud(ctx, view, left, top, side);
    const now = view.timeMs;
    if (view.game === "ctf" && !view.finished && view.lastCaptureTeam >= 0 && now - view.lastCaptureMs < CAPTURE_BANNER_MS) {
      const t = (now - view.lastCaptureMs) / CAPTURE_BANNER_MS;
      const pop = t < 0.12 ? t / 0.12 : 1;
      const fs = 0.1 * side * (0.7 + 0.3 * pop);
      ctx.globalAlpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;
      this.bannerText(ctx, o.labels.capture, left + side / 2, top + 0.45 * side, fs, this.colorOf(view.lastCaptureTeam));
      ctx.font = `700 ${0.4 * fs}px sans-serif`;
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(this.nameOf(view.lastCaptureTeam), left + side / 2, top + 0.45 * side + 0.8 * fs);
    }
    if (view.finished) this.drawWinner(ctx, view, o, left, top, side);
    ctx.restore();
  }

  private bannerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, color: string) {
    ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, 0.12 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
    ctx.strokeText(text, x, y);
    ctx.shadowColor = color;
    ctx.shadowBlur = 20;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.shadowBlur = 0;
  }

  /** Battle: "N LEFT" and a row of mini squares (grey once knocked out) in the band at the top of the square. */
  private drawBattleHud(ctx: CanvasRenderingContext2D, view: ArenaView, o: ArenaRenderOptions, left: number, top: number, side: number) {
    const band = 0.1 * side;
    let alive = 0;
    for (let k = 0; k < view.count; k++) alive += view.alive[k];
    const fs = 0.34 * band;
    ctx.globalAlpha = 1;
    ctx.font = `800 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f4f4f5";
    const label = view.zoneShrinking && !view.finished ? `${o.labels.left(alive)} · ${o.labels.zone}` : o.labels.left(alive);
    ctx.fillText(label, left + side / 2, top + 0.34 * band);
    const n = view.count;
    const cell = Math.min(0.3 * band, (0.86 * side) / Math.max(1, n));
    const size = 0.72 * cell;
    const x0 = left + side / 2 - (n * cell) / 2 + cell / 2;
    const y = top + 0.74 * band;
    for (let k = 0; k < n; k++) {
      const x = x0 + k * cell;
      const on = view.alive[k] === 1;
      ctx.globalAlpha = on ? 1 : 0.35;
      ctx.fillStyle = on ? this.colorOf(k) : "#52525b";
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      if (on) {
        const frac = Math.max(0, Math.min(1, view.hp[k] / Math.max(1e-9, view.maxHp)));
        ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
        ctx.fillRect(x - size / 2, y - size / 2, size, size * (1 - frac));
      } else {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(1.5, 0.12 * size);
        ctx.beginPath();
        ctx.moveTo(x - size / 2, y - size / 2);
        ctx.lineTo(x + size / 2, y + size / 2);
        ctx.moveTo(x + size / 2, y - size / 2);
        ctx.lineTo(x - size / 2, y + size / 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Capture the flag: "RED 2 : 1 BLUE" and the time left to the time limit, in the band at the top of the square. */
  private drawCtfHud(ctx: CanvasRenderingContext2D, view: ArenaView, left: number, top: number, side: number) {
    const band = 0.1 * side;
    const cx = left + side / 2;
    const y = top + 0.42 * band;
    const fs = 0.42 * band;
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.font = `900 ${fs}px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillStyle = "#f4f4f5";
    ctx.fillText(":", cx, y);
    ctx.textAlign = "right";
    ctx.fillStyle = this.colorOf(0);
    ctx.fillText(String(view.scores[0]), cx - 0.3 * fs, y);
    ctx.textAlign = "left";
    ctx.fillStyle = this.colorOf(1);
    ctx.fillText(String(view.scores[1]), cx + 0.3 * fs, y);
    const nfs = 0.28 * band;
    ctx.font = `700 ${nfs}px sans-serif`;
    ctx.textAlign = "right";
    ctx.fillStyle = this.colorOf(0);
    ctx.fillText(this.nameOf(0), cx - 1.4 * fs, y);
    ctx.textAlign = "left";
    ctx.fillStyle = this.colorOf(1);
    ctx.fillText(this.nameOf(1), cx + 1.4 * fs, y);
    const remaining = Math.max(0, view.timeLimitSec - view.timeMs / 1000);
    const secs = Math.ceil(remaining - 1e-6);
    ctx.font = `600 ${0.24 * band}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = "center";
    ctx.fillStyle = secs <= 5 && !view.finished ? "#f87171" : "#a1a1aa";
    ctx.fillText(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, cx, top + 0.82 * band);
  }

  /** The winner banner with confetti (analytic, so it replays with the clock and freezes with a pause). */
  private drawWinner(ctx: CanvasRenderingContext2D, view: ArenaView, o: ArenaRenderOptions, left: number, top: number, side: number) {
    const age = Math.max(0, view.timeMs - view.finishMs) / 1000;
    const winner = view.winner;
    const color = winner >= 0 ? this.colorOf(winner) : "#e4e4e7";
    // Confetti falling over the square, in the winner's colour, gold and white.
    for (let i = 0; i < CONFETTI; i++) {
      const start = 0.4 * hash(i, 1);
      const t = age - start;
      if (t < 0) continue;
      const fall = side * (0.25 + 0.2 * hash(i, 2));
      const yy = (-0.05 * side + fall * t) % (1.1 * side);
      const x = left + side * hash(i, 3) + 0.03 * side * Math.sin(3 * t + 6 * hash(i, 4));
      const y = top + yy;
      const size = 0.008 * side * (0.6 + hash(i, 5));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(t * (2 + 4 * hash(i, 6)));
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = i % 3 === 0 ? GOLD : i % 3 === 1 ? color : "#ffffff";
      ctx.fillRect(-size, -0.5 * size, 2 * size, size);
      ctx.restore();
    }
    const pop = Math.min(1, age / 0.25);
    const fs = 0.1 * side * (0.6 + 0.4 * pop);
    const cy = top + 0.46 * side;
    ctx.globalAlpha = 1;
    let title: string;
    let sub: string;
    if (view.game === "battle") {
      title = winner >= 0 ? o.labels.wins(this.nameOf(winner)) : o.labels.draw;
      sub = winner >= 0 ? o.labels.battleSub(view.kills[winner], Math.ceil(view.hp[winner] - 1e-6)) : "";
    } else {
      title = winner >= 0 ? o.labels.wins(this.nameOf(winner)) : o.labels.draw;
      sub = `${view.byTime ? `${o.labels.time} ` : ""}${o.labels.ctfSub(view.scores[0], view.scores[1])}`;
    }
    ctx.font = `900 ${fs}px sans-serif`;
    const fit = Math.min(fs, (0.9 * side * fs) / Math.max(1, ctx.measureText(title).width));
    this.bannerText(ctx, title, left + side / 2, cy, fit, color);
    if (sub) {
      const sfs = 0.36 * fs;
      ctx.font = `700 ${sfs}px sans-serif`;
      ctx.lineWidth = Math.max(2, 0.14 * sfs);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      ctx.strokeText(sub, left + side / 2, cy + 0.9 * fs);
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(sub, left + side / 2, cy + 0.9 * fs);
    }
  }
}
