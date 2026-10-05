import type { FightLeagueView, FlFighter } from "@/lib/physics/modes/fightLeague";
import { flNameColor, type FlBoxLayout, type FlHudLayout } from "@/lib/physics/modes/fightLeagueFx";
import type { FlBodiesPainter } from "./bodies";
import type { FlFrame, FightLeagueLabels } from "./frame";
import { INK } from "./palette";
import { SpriteCache, TWO_PI, makeSprite, roundRectPath, starPath } from "./sprites";
import { NUM_TEXT, type FlTextStyle } from "./text";
import type { FlWeaponsPainter } from "./weapons";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's HUD inside the exported square (screen px): the names band – each name in
 * its fighter's colour with an ink stroke, a slim HP bar under it (a white ghost for the HP just lost, the number in mono at
 * its end) and the source line; stacked rows with mini bars for three or four –, the centre column (the small VS, the timer
 * pill: red and popping each second of the last five), the lead bar (the HP share in the sides' accents, flashing white
 * on a lead change), and the ability boxes (a mini portrait and a role glyph, the ability's name, the meter – glowing from
 * 0.85, READY when full, marching ants round a ready ultimate –, one or two stat lines; our own glyphs where it is tight).
 */

/** Cached stat strings of a fighter (rebuilt only when a shown value changes). */
interface StatText {
  key: number;
  dmg: string;
  spd: string;
  atk: string;
  cast: string;
  dmgV: string;
  spdV: string;
  atkV: string;
  castV: string;
  dmgUp: number;
  spdUp: number;
  atkUp: number;
  castUp: number;
}

type Glyph = "blade" | "boot" | "clock" | "star";

/** A stat glyph (our own vector marks: a blade, a boot, a clock, a star) at (x, y), `s` tall. */
function drawGlyph(ctx: CanvasRenderingContext2D, g: Glyph, x: number, y: number, s: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, 0.14 * s);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (g) {
    case "blade":
      ctx.beginPath();
      ctx.moveTo(x - 0.4 * s, y + 0.4 * s);
      ctx.lineTo(x + 0.35 * s, y - 0.35 * s);
      ctx.moveTo(x - 0.15 * s, y + 0.05 * s);
      ctx.lineTo(x + 0.05 * s, y + 0.25 * s);
      ctx.stroke();
      break;
    case "boot":
      ctx.beginPath();
      ctx.moveTo(x - 0.3 * s, y - 0.42 * s);
      ctx.lineTo(x, y - 0.42 * s);
      ctx.lineTo(x, y + 0.05 * s);
      ctx.lineTo(x + 0.42 * s, y + 0.15 * s);
      ctx.lineTo(x + 0.42 * s, y + 0.4 * s);
      ctx.lineTo(x - 0.3 * s, y + 0.4 * s);
      ctx.closePath();
      ctx.fill();
      break;
    case "clock":
      ctx.beginPath();
      ctx.arc(x, y, 0.4 * s, 0, TWO_PI);
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 0.25 * s);
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.2 * s, y);
      ctx.stroke();
      break;
    default:
      starPath(ctx, x, y, 0.45 * s, 0.2 * s, 5, -Math.PI / 2);
      ctx.fill();
  }
  ctx.restore();
}

/** A role's glyph (our own marks) in a small disc. */
function drawRoleGlyph(ctx: CanvasRenderingContext2D, role: string, x: number, y: number, s: number, fill: string, ink: string) {
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, 0.1 * s);
  ctx.beginPath();
  ctx.arc(x, y, 0.5 * s, 0, TWO_PI);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = ink;
  ctx.lineCap = "round";
  const k = 0.28 * s;
  ctx.beginPath();
  switch (role) {
    case "tank":
      ctx.moveTo(x - k, y - k);
      ctx.lineTo(x + k, y - k);
      ctx.lineTo(x + k, y + 0.1 * k);
      ctx.quadraticCurveTo(x + k, y + k, x, y + 1.15 * k);
      ctx.quadraticCurveTo(x - k, y + k, x - k, y + 0.1 * k);
      ctx.closePath();
      ctx.fill();
      break;
    case "bruiser":
      ctx.arc(x, y, 0.75 * k, 0, TWO_PI);
      ctx.fill();
      break;
    case "duelist":
      ctx.moveTo(x - k, y - k);
      ctx.lineTo(x + k, y + k);
      ctx.moveTo(x + k, y - k);
      ctx.lineTo(x - k, y + k);
      ctx.stroke();
      break;
    case "glass":
      ctx.moveTo(x, y - 1.1 * k);
      ctx.lineTo(x + 0.8 * k, y);
      ctx.lineTo(x, y + 1.1 * k);
      ctx.lineTo(x - 0.8 * k, y);
      ctx.closePath();
      ctx.fill();
      break;
    case "ranged":
      ctx.arc(x, y, 0.8 * k, 0, TWO_PI);
      ctx.moveTo(x - 1.1 * k, y);
      ctx.lineTo(x + 1.1 * k, y);
      ctx.moveTo(x, y - 1.1 * k);
      ctx.lineTo(x, y + 1.1 * k);
      ctx.stroke();
      break;
    case "control":
      for (let q = 0; q <= 14; q++) {
        const a = (q / 14) * 1.6 * TWO_PI;
        const rr = (0.15 + 0.85 * (q / 14)) * k;
        if (q === 0) ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
        else ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.stroke();
      break;
    case "summoner":
      for (const [dx, dy] of [
        [-0.6, 0.3],
        [0.6, 0.3],
        [0, -0.55],
      ]) {
        ctx.moveTo(x + dx * k + 0.38 * k, y + dy * k);
        ctx.arc(x + dx * k, y + dy * k, 0.38 * k, 0, TWO_PI);
      }
      ctx.fill();
      break;
    default:
      // support: a plus
      ctx.rect(x - 0.25 * k, y - k, 0.5 * k, 2 * k);
      ctx.rect(x - k, y - 0.25 * k, 2 * k, 0.5 * k);
      ctx.fill();
  }
  ctx.restore();
}

export class FlHudPainter {
  private readonly stats: (StatText | undefined)[] = [];
  /** The boxes' halos while their ability telegraphs (per colour and size). */
  private readonly halos = new SpriteCache<string>(16);
  private generation = -1;
  private timerSec = -1;
  private timerText = "";
  namesDrawn = 0;
  boxesDrawn = 0;

  begin(view: FightLeagueView) {
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.stats.length = 0;
      this.timerSec = -1;
    }
  }

  private nameStyle(fr: FlFrame, f: FlFighter): FlTextStyle {
    return { role: "ui", color: flNameColor(f.row.body, f.row.accent), stroke: fr.pal.hud.nameStroke, strokeK: 0.12 };
  }

  /** The names band (names, HP bars, source lines), the centre column and the lead bar. Returns the band's bottom (screen y). */
  drawBand(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, bodies: FlBodiesPainter): number {
    const fighters = view.fighters;
    const n = fighters.length;
    this.namesDrawn = 0;
    if (n === 0) return oy;
    const hud = fr.pal.hud;
    const stacked = n > 2;
    const now = fr.now;
    for (const f of fighters) {
      const right = view.match === "2v2" ? f.team === 1 : f.slot % 2 === 1;
      const row = view.match === "2v2" ? f.slot % 2 : Math.floor(f.slot / 2);
      const ny = oy + (lay.nameY[Math.min(row, lay.nameY.length - 1)] ?? lay.nameY[0]);
      const by = oy + (lay.hpBarY[Math.min(row, lay.hpBarY.length - 1)] ?? lay.hpBarY[0]);
      const edge = right ? ox + lay.right : ox + lay.left;
      const alpha = f.alive ? 1 : 0.4;
      const dot = 0.3 * lay.nameFs;
      // the fighter's dot, then the name in its colour with an ink stroke
      ctx.save();
      ctx.globalAlpha = alpha;
      const dx = right ? edge - dot : edge + dot;
      ctx.fillStyle = f.row.body;
      ctx.strokeStyle = f.row.accent;
      ctx.lineWidth = Math.max(1.5, 0.3 * dot);
      ctx.beginPath();
      ctx.arc(dx, ny, dot, 0, TWO_PI);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      const tx = right ? edge - 2.6 * dot : edge + 2.6 * dot;
      const maxW = (stacked ? 0.3 : 0.4) * lay.side;
      const w = fr.text.draw(ctx, f.row.name, tx, ny, lay.nameFs, this.nameStyle(fr, f), right ? "right" : "left", maxW, alpha);
      if (!f.alive) {
        ctx.save();
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = Math.max(2, 0.1 * lay.nameFs);
        ctx.beginPath();
        ctx.moveTo(right ? tx - w : tx, ny);
        ctx.lineTo(right ? tx : tx + w, ny);
        ctx.stroke();
        ctx.restore();
      }
      // the HP bar under the name (the ghost white), the HP in mono at its inner end
      const bw = lay.hpBarW;
      const bh = lay.hpBarH;
      const bx = right ? edge - bw : edge;
      const frac = Math.max(0, Math.min(1, f.hp / Math.max(1e-9, f.maxHp)));
      const ghost = Math.max(frac, Math.min(1, bodies.ghostHp(f, now) / Math.max(1e-9, f.maxHp)));
      const blink = f.alive && frac < 0.25 && !view.finished && Math.floor(now / 125) % 2 === 0;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hud.barTrack;
      ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
      const fill = (from: number, to: number, color: string) => {
        if (to <= from) return;
        ctx.fillStyle = color;
        if (right) ctx.fillRect(bx + bw * (1 - to), by, bw * (to - from), bh);
        else ctx.fillRect(bx + bw * from, by, bw * (to - from), bh);
      };
      fill(frac, ghost, "#ffffff");
      fill(0, frac, blink ? "#fecaca" : frac > 0.5 ? "#22c55e" : frac > 0.25 ? "#eab308" : "#ef4444");
      ctx.restore();
      const hp = Math.max(0, Math.ceil(f.hp - 1e-6));
      const hpText = NUM_TEXT[Math.min(NUM_TEXT.length - 1, hp)] ?? String(hp);
      const hfs = stacked ? 0.016 * lay.side : 0.018 * lay.side;
      const hx = right ? bx - 0.008 * lay.side : bx + bw + 0.008 * lay.side;
      // (an outline in the opposite tone: the number reads where a long name's descenders reach down to the bar)
      fr.text.number(ctx, hpText, hx, by + bh / 2, hfs, hud.dark ? "#f4f4f5" : INK, hud.dark ? "rgba(0, 0, 0, 0.6)" : "#ffffff", right ? "right" : "left", alpha);
      if (!stacked) fr.text.draw(ctx, f.row.source, right ? edge : edge, oy + lay.sourceY, lay.sourceFs, { role: "ui", color: hud.source, stroke: null, weight: 600 }, right ? "right" : "left", 0.4 * lay.side, alpha);
      this.namesDrawn++;
    }
    // the centre column: the small VS (a duel) and the timer pill
    const cx = ox + lay.side / 2;
    if (n === 2 && now >= view.introMs) fr.text.draw(ctx, fr.text.upperOf(L.vs), cx, oy + lay.vsY, lay.vsFs, { role: "display", color: hud.muted, stroke: null }, "center");
    this.drawTimer(ctx, fr, view, lay, cx, oy);
    this.drawLeadBar(ctx, fr, view, lay, ox, oy);
    return oy + lay.band;
  }

  /** The time left to the cap (from FIGHT!; frozen at the end) in a pill – red and popping each second of the last five. */
  private drawTimer(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, lay: FlHudLayout, cx: number, oy: number) {
    const cap = view.settings.timeCap;
    if (!(cap > 0)) return;
    const now = fr.now;
    const at = view.finished ? Math.min(now, view.finishMs) : now;
    const remaining = Math.max(0, Math.min(cap, cap - (at - view.introMs) / 1000));
    const secs = Math.ceil(remaining - 1e-6);
    if (secs !== this.timerSec) {
      this.timerSec = secs;
      this.timerText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    }
    const hud = fr.pal.hud;
    const hot = secs <= 5 && !view.finished && now >= view.introMs;
    const frac = remaining - Math.floor(remaining);
    const pop = hot ? 1 + 0.25 * Math.max(0, frac - 0.75) * 4 : 1;
    const fs = lay.timerFs;
    const w = fr.text.numberWidth(this.timerText, fs, "#ffffff", null) + 0.9 * fs;
    const h = lay.pillH;
    const y = oy + lay.pillY;
    ctx.save();
    ctx.fillStyle = hot ? hud.pillHot : hud.pillFill;
    roundRectPath(ctx, cx - (w * pop) / 2, y - (h * pop) / 2, w * pop, h * pop, (h * pop) / 2);
    ctx.fill();
    ctx.restore();
    fr.text.number(ctx, this.timerText, cx, y, fs, hot ? "#ffffff" : hud.pillText, null, "center", 1, pop);
  }

  /** The lead bar: the band's width split by HP share in the sides' accents, flashing white on a lead change. */
  private drawLeadBar(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, lay: FlHudLayout, ox: number, oy: number) {
    const bar = lay.leadBar;
    const x = ox + bar.x;
    const y = oy + bar.y;
    const sides = Math.max(1, view.teamCount);
    let total = 0;
    for (const f of view.fighters) total += f.alive ? Math.max(0, f.hp) : 0;
    ctx.save();
    ctx.fillStyle = fr.pal.hud.barTrack;
    roundRectPath(ctx, x, y, bar.w, bar.h, bar.h / 2);
    ctx.fill();
    ctx.clip();
    if (total > 0) {
      let at = x;
      for (let t = 0; t < sides; t++) {
        let hp = 0;
        let color = "#a1a1aa";
        for (const f of view.fighters) {
          if (f.team !== t) continue;
          hp += f.alive ? Math.max(0, f.hp) : 0;
          if (color === "#a1a1aa") color = f.row.accent;
        }
        const w = (hp / total) * bar.w;
        ctx.fillStyle = color;
        ctx.fillRect(at, y, w, bar.h);
        at += w;
      }
    }
    const flash = fr.now - view.leadMs;
    if (flash >= 0 && flash < 300) {
      ctx.globalAlpha = 0.8 * (1 - flash / 300);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x, y, bar.w, bar.h);
    }
    ctx.restore();
  }

  /** The ability boxes along the bottom. Returns their top (screen y; Infinity without them). */
  drawBoxes(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, bodies: FlBodiesPainter, weapons: FlWeaponsPainter): number {
    this.boxesDrawn = 0;
    if (view.fighters.length === 0 || lay.boxes.length === 0) return Infinity;
    for (const f of view.fighters) {
      const b = lay.boxes[f.slot];
      if (!b) continue;
      this.drawBox(ctx, fr, view, L, f, b, ox, oy, bodies, weapons);
      this.boxesDrawn++;
    }
    return oy + lay.boxesTop;
  }

  /** A soft halo hugging a box (a rounded rectangle's glow, baked once per colour and size on its own canvas). */
  private halo(ctx: CanvasRenderingContext2D, fr: FlFrame, color: string, x: number, y: number, w: number, h: number, alpha: number) {
    const pad = Math.max(4, 0.45 * h);
    const key = `${color}|${Math.round(w)}|${Math.round(h)}|${fr.dpr}`;
    const s = this.halos.get(key, () =>
      makeSprite({ x0: -pad, y0: -pad, x1: w + pad, y1: h + pad }, fr.dpr, (g) => {
        g.shadowColor = color;
        g.shadowBlur = 0.8 * pad * fr.dpr;
        g.fillStyle = color;
        roundRectPath(g, 0, 0, w, h, 0.14 * h);
        g.fill();
      }),
    );
    if (!s) return;
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * alpha;
    ctx.drawImage(s.canvas, x + s.x0, y + s.y0, s.w, s.h);
    ctx.globalAlpha = a;
  }

  private drawBox(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, f: FlFighter, b: FlBoxLayout, ox: number, oy: number, bodies: FlBodiesPainter, weapons: FlWeaponsPainter) {
    const now = fr.now;
    const hud = fr.pal.hud;
    const x = ox + b.box.x;
    const y = oy + b.box.y;
    const w = b.box.w;
    const h = b.box.h;
    const telegraph = f.telegraphUntil >= 0;
    const blink = telegraph && Math.floor(now / 70) % 2 === 0;
    const castAge = now - f.lastCastMs;
    const ult = f.row.ability.ultimate || f.row.ability.charge >= 13;
    ctx.save();
    ctx.globalAlpha = f.alive ? 1 : 0.45;
    // the card: white (lilac) or dark, an ink / accent border, the accent header strip; a glow while telegraphing
    if (telegraph || (castAge >= 0 && castAge < 300)) this.halo(ctx, fr, f.row.accent, x, y, w, h, 0.6);
    ctx.fillStyle = hud.cardFill;
    roundRectPath(ctx, x, y, w, h, 0.14 * h);
    ctx.fill();
    if (!hud.dark) {
      ctx.save();
      roundRectPath(ctx, x, y, w, h, 0.14 * h);
      ctx.clip();
      ctx.fillStyle = f.row.accent;
      ctx.fillRect(x, y, w, Math.max(2, 0.07 * h));
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1.5, (telegraph ? 0.05 : 0.025) * h);
    ctx.strokeStyle = blink ? "#ffffff" : hud.dark ? f.row.accent : hud.cardBorder;
    roundRectPath(ctx, x, y, w, h, 0.14 * h);
    ctx.stroke();
    // a ready ultimate: marching ants round the card
    const meter = telegraph ? 1 : Math.max(0, Math.min(1, f.meter));
    if (ult && meter >= 1 && f.alive && !view.finished) {
      ctx.strokeStyle = f.row.accent;
      ctx.lineWidth = Math.max(1.5, 0.035 * h);
      ctx.setLineDash([0.12 * h, 0.08 * h]);
      ctx.lineDashOffset = -now / 25;
      roundRectPath(ctx, x - 0.04 * h, y - 0.04 * h, w + 0.08 * h, h + 0.08 * h, 0.17 * h);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
    const alpha = f.alive ? 1 : 0.45;
    // the mini portrait (the ball with its weapon) and the role glyph
    const p = b.portrait;
    const pr = 0.36 * p.w;
    const pcx = ox + p.x + p.w / 2;
    const pcy = oy + p.y + p.h / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.rect(ox + p.x - 0.1 * p.w, oy + p.y - 0.1 * p.h, 1.2 * p.w, 1.2 * p.h);
    ctx.clip();
    weapons.drawPortraitWeapon(ctx, fr, f, pcx - 0.08 * p.w, pcy + 0.04 * p.h, pr / Math.max(1e-6, f.r), -0.6);
    bodies.drawPortrait(ctx, fr, f, pcx - 0.08 * p.w, pcy + 0.04 * p.h, pr);
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = alpha;
    drawRoleGlyph(ctx, f.row.role, ox + p.x + 0.86 * p.w, oy + p.y + 0.16 * p.h, 0.3 * p.w, hud.dark ? "#27272a" : "#ffffff", hud.dark ? "#f4f4f5" : INK);
    ctx.restore();
    // the ability's name (flashing through the telegraph)
    const nameColor = blink ? f.row.accent : hud.dark ? (telegraph ? "#ffffff" : hud.cardText) : hud.cardText;
    fr.text.draw(ctx, f.row.ability.name, ox + b.name.x, oy + b.name.y + 0.55 * b.nameFs, b.nameFs, { role: "ui", color: nameColor, stroke: null }, "left", b.name.w, alpha);
    // the meter: its track, the fill in the accent (glowing from 0.85), READY shimmering when full
    const m = b.meter;
    const mx = ox + m.x;
    const my = oy + m.y;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = hud.meterTrack;
    roundRectPath(ctx, mx, my, m.w, m.h, m.h / 2);
    ctx.fill();
    if (meter > 0) {
      if (meter >= 0.85 && f.alive) fr.glow.draw(ctx, f.row.accent, mx + m.w * meter, my + m.h / 2, 2.2 * m.h, 0.5 + 0.3 * Math.sin(now / 120));
      ctx.fillStyle = meter >= 1 ? (blink || Math.floor(now / 140) % 2 === 0 ? "#ffffff" : f.row.accent) : f.row.accent;
      roundRectPath(ctx, mx, my, Math.max(m.h, m.w * meter), m.h, m.h / 2);
      ctx.fill();
      if (meter >= 1 && !hud.dark) {
        ctx.strokeStyle = INK;
        ctx.lineWidth = Math.max(1, 0.25 * m.h);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (!telegraph && f.alive && meter >= 1 && !view.finished) {
      const shimmer = 0.75 + 0.25 * Math.sin(now / 90);
      fr.text.draw(ctx, L.ready, mx + m.w / 2, my + m.h / 2, Math.max(7, Math.min(1.9 * m.h, 0.9 * b.statFs)), { role: "display", color: "#fde047", stroke: INK, strokeK: 0.14 }, "center", m.w, shimmer);
    }
    // the stat lines: words where they fit, our glyphs where it is tight (buffs and debuffs in the stage's colours)
    const st = this.statText(view, f, now, L);
    const statColor = (up: number) => (up > 0 ? hud.buff : up < 0 ? hud.debuff : hud.statText);
    const style = (up: number): FlTextStyle => ({ role: "mono", color: statColor(up), stroke: null, weight: 800 });
    const line = (r: { x: number; y: number; w: number; h: number }, a: [Glyph, string, string, number], c: [Glyph, string, string, number]) => {
      const fs = r.h;
      const lx = ox + r.x;
      const ly = oy + r.y + 0.55 * fs;
      const colW = r.w / 2;
      const words = fr.text.width(a[1], fs, style(a[3])) <= colW - 2;
      for (const [k, cell] of [a, c].entries()) {
        const cxl = lx + k * colW;
        if (words) fr.text.draw(ctx, cell[1], cxl, ly, fs, style(cell[3]), "left", colW - 2, alpha);
        else {
          ctx.save();
          ctx.globalAlpha = alpha;
          drawGlyph(ctx, cell[0], cxl + 0.45 * fs, ly, 0.9 * fs, statColor(cell[3]));
          ctx.restore();
          fr.text.draw(ctx, cell[2], cxl + fs, ly, fs, style(cell[3]), "left", colW - fs - 2, alpha);
        }
      }
    };
    if (b.compact) {
      // one line: damage and speed (the attack or cast speed instead when buffed or debuffed)
      const second: [Glyph, string, string, number] = st.atkUp !== 0 ? ["clock", st.atk, st.atkV, st.atkUp] : st.castUp !== 0 ? ["star", st.cast, st.castV, st.castUp] : ["boot", st.spd, st.spdV, st.spdUp];
      line(b.stats[0], ["blade", st.dmg, st.dmgV, st.dmgUp], second);
    } else {
      line(b.stats[0], ["blade", st.dmg, st.dmgV, st.dmgUp], ["boot", st.spd, st.spdV, st.spdUp]);
      if (b.stats[1]) line(b.stats[1], ["clock", st.atk, st.atkV, st.atkUp], ["star", st.cast, st.castV, st.castUp]);
    }
    if (!f.alive) fr.text.draw(ctx, L.ko, x + w / 2, y + h / 2, 0.42 * h, { role: "display", color: "#ef4444", stroke: INK, strokeK: 0.1 }, "center", w, 0.9);
  }

  /** The stat strings of `f` (rebuilt only when a shown value changes). */
  private statText(view: FightLeagueView, f: FlFighter, now: number, L: FightLeagueLabels): StatText {
    const ts = now < view.slowTimeUntil && f.team !== view.slowTimeTeam ? view.slowTimeFactor : 1;
    const dmg = f.damage * (now < f.dmgMulUntil ? f.dmgMul : 1);
    let spd = f.speed * ts;
    if (now < f.speedMulUntil) spd *= f.speedMul;
    if (now < f.slowUntil) spd *= f.slowFactor;
    if (now < f.confusedUntil) spd *= 0.6;
    if (now < f.frozenUntil || f.heldBy >= 0) spd = 0;
    const atk = f.attack * ts * (now < f.atkMulUntil ? f.atkMul : 1);
    const cast = f.cast * ts;
    const q = (v: number) => Math.round(v * 100);
    const key = ((q(dmg) * 7919 + q(spd)) * 7919 + q(atk)) * 7919 + q(cast);
    let st = this.stats[f.slot];
    if (st && st.key === key) return st;
    const fmt = (v: number) => `×${(Math.round(v * 100) / 100).toFixed(2)}`;
    const cmp = (v: number, base: number) => (q(v) > q(base) ? 1 : q(v) < q(base) ? -1 : 0);
    st = {
      key,
      dmg: `${L.damage} ${fmt(dmg)}`,
      spd: `${L.speed} ${fmt(spd)}`,
      atk: `${L.attack} ${fmt(atk)}`,
      cast: `${L.cast} ${fmt(cast)}`,
      dmgV: fmt(dmg),
      spdV: fmt(spd),
      atkV: fmt(atk),
      castV: fmt(cast),
      dmgUp: cmp(dmg, f.damage),
      spdUp: cmp(spd, f.speed),
      atkUp: cmp(atk, f.attack),
      castUp: cmp(cast, f.cast),
    };
    this.stats[f.slot] = st;
    return st;
  }
}
