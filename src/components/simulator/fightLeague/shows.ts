import { FB_CLUTCH, FB_COMEBACK, FB_FINISH, FB_PERFECT, FB_UPSET, FL_BANNER_CAP, type FightLeagueView, type FlFighter } from "@/lib/physics/modes/fightLeague";
import { FL_BYE, FL_PENDING, flChancePercent, flNextBout, flRoundBout, flRoundCode, type FlBout } from "@/lib/physics/modes/fightLeagueShow";
import { flShortName, type FlFighterRow } from "@/lib/physics/modes/fightLeagueRoster";
import type { FlHudLayout } from "@/lib/physics/modes/fightLeagueFx";
import { DEFAULT_FL_SHOW_LABELS, type FightLeagueLabels, type FlFrame, type FlShowLabels } from "./frame";
import { GOLD, INK, greyOf } from "./palette";
import { TWO_PI, hash, makeSprite, roundRectPath, type Sprite } from "./sprites";
import type { FlTextStyle } from "./text";

/**
 * --- fl-overhaul --- (Stage 5) Fight League's shows on the canvas (screen space, inside the exported square): what a series, a
 * bracket and a boss rush add to the HUD and the cards, and the story's words – every pixel a function of the view and its clock:
 *
 *  - the VS card's extras: the show's line over the panels (GAME n and the score 'Thor 1 – 0 Loki', SERIES POINT, the gold
 *    decider; a bracket's round 'QUARTER-FINAL 2/4'; a boss rush's WAVE n/m and CHALLENGER; REMATCH!) and, under the names, the
 *    win chance (simulated) – two accent segments with their percentages, 'est.' where no rating measures the pairing, UNDERDOG
 *    on a side under 40 % – hidden whenever a handicap is set (the panels' BUFFED / NERFED tags show instead);
 *  - the names band: a series' score between the names with its win pips, a bracket's round, a boss rush's wave;
 *  - the boss bar across the top of the arena (the boss's short name, WAVE n/m, its HP number; red in PHASE 2) and the
 *    challengers' queue as mini balls, the beaten ones crossed out; the boss's crown (our own simple vector crown);
 *  - the interlude's card (between two matches): a series' score, the bracket – the full square, an 8 tree QF → SF → F or a 16
 *    as two halves meeting at the final (chips: a body dot with its accent ring and the short name, losers greyed and struck,
 *    the last winner's line drawn over 500 ms, the next pair pulsing; cached offscreen, rebuilt only when a result changes) –,
 *    a boss rush's boss (its bar refilling with the heal) and its queue;
 *  - the show's verdict: the bracket's champion card (a vector cup, CHAMPION, the name in its colours, 'beat Loki, Hulk, Thor',
 *    confetti), a series' '[name] wins the series 2–1!', THE BOSS FALLS – [name] or BOSS SURVIVES n/n.
 */

const ease = (u: number) => 1 - (1 - Math.max(0, Math.min(1, u))) ** 3;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A chip's place on the bracket card (its entrant, or FL_BYE / FL_PENDING) and its centre. */
interface ChipSpot {
  e: number;
  x: number;
  y: number;
  /** Lost (greyed and struck). */
  lost: boolean;
}

/** A connector of the bracket card: from a chip (x0, y0) to its next slot (x1, y1), a bend at xm; `win` when its entrant won the bout. */
interface Link {
  x0: number;
  y0: number;
  xm: number;
  x1: number;
  y1: number;
  /** The bout it leaves (round, pair) and the entrant. */
  r: number;
  p: number;
  e: number;
}

/** The labels of the shows (the page's, else the English defaults). */
export function showLabels(L: FightLeagueLabels): FlShowLabels {
  return L.shows ?? DEFAULT_FL_SHOW_LABELS;
}

/** Whether `match` plays two teams (2v2, 3v3). */
export function flTeamMatch(match: string): boolean {
  return match === "2v2" || match === "3v3";
}

/** The handicap a fighter plays with (its slot's – a bracket's or a boss rush's entrant carries its own): the multipliers ≠ 1. */
export function handicapParts(f: FlFighter, L: FightLeagueLabels): { text: string; up: boolean }[] {
  const out: { text: string; up: boolean }[] = [];
  const add = (v: number, word: string) => {
    if (Number.isFinite(v) && Math.abs(v - 1) > 1e-9) out.push({ text: `${word} ×${(Math.round(v * 100) / 100).toFixed(2)}`, up: v > 1 });
  };
  add(f.hcDamage, L.damage);
  add(f.hcSpeed, L.speed);
  add(f.hcAttack, L.attack);
  add(f.hcCast, L.cast);
  return out;
}

/** A small triangle (up: pointing up) after a tag – the "up" / "down" of a buff. */
function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, up: boolean, color: string, alpha: number) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, 0.18 * s);
  ctx.beginPath();
  if (up) {
    ctx.moveTo(x, y - 0.5 * s);
    ctx.lineTo(x + 0.5 * s, y + 0.4 * s);
    ctx.lineTo(x - 0.5 * s, y + 0.4 * s);
  } else {
    ctx.moveTo(x, y + 0.5 * s);
    ctx.lineTo(x + 0.5 * s, y - 0.4 * s);
    ctx.lineTo(x - 0.5 * s, y - 0.4 * s);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.restore();
}

/** The BUFFED / NERFED tags of a fighter on a VS panel (one line each: 'BUFFED · DMG ×1.25 ▲' in lime, 'NERFED · SPD ×0.80 ▼' in red). Returns how many lines. */
export function drawHandicapTags(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, L: FightLeagueLabels, cx: number, y: number, maxW: number, S: number, alpha: number): number {
  const parts = handicapParts(f, L);
  if (parts.length === 0) return 0;
  const SL = showLabels(L);
  const fs = 0.018 * S;
  let line = 0;
  for (const up of [true, false]) {
    const mine = parts.filter((p) => p.up === up);
    if (mine.length === 0) continue;
    const color = up ? "#a3e635" : "#f87171";
    const text = `${up ? SL.buffed : SL.nerfed} · ${mine.map((p) => p.text).join(" · ")}`;
    const yy = y + line * 1.5 * fs;
    const w = fr.text.draw(ctx, text, cx - 0.6 * fs, yy, fs, { role: "mono", color, stroke: INK, strokeK: 0.16 }, "center", maxW - 1.4 * fs, alpha);
    arrow(ctx, cx - 0.6 * fs + w / 2 + 0.8 * fs, yy, 0.8 * fs, up, color, alpha);
    line++;
  }
  return line;
}

/** Our own simple vector crown on top of a ball of radius `r` centred at (x, y): a band with three points and dots. */
export function drawCrown(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1) {
  const w = 1.15 * r;
  const h = 0.62 * r;
  const base = y - 0.82 * r;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1.5, 0.08 * r);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(x - w / 2, base);
  ctx.lineTo(x - w / 2, base - 0.55 * h);
  ctx.lineTo(x - w / 4, base - 0.25 * h);
  ctx.lineTo(x, base - h);
  ctx.lineTo(x + w / 4, base - 0.25 * h);
  ctx.lineTo(x + w / 2, base - 0.55 * h);
  ctx.lineTo(x + w / 2, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ef4444";
  for (const k of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.arc(x + k * w * 0.62, base - 0.18 * h, 0.075 * r, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

/** Our own simple vector cup (a bowl, two handles, a stem and a base) centred at (x, y), `s` tall. */
function drawCup(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(2, 0.035 * s);
  ctx.lineJoin = "round";
  const top = y - 0.5 * s;
  const w = 0.62 * s;
  // the handles
  ctx.beginPath();
  ctx.arc(x - 0.36 * s, top + 0.2 * s, 0.13 * s, 0.5 * Math.PI, 1.5 * Math.PI);
  ctx.moveTo(x + 0.36 * s, top + 0.07 * s);
  ctx.arc(x + 0.36 * s, top + 0.2 * s, 0.13 * s, 1.5 * Math.PI, 0.5 * Math.PI);
  ctx.stroke();
  // the bowl
  ctx.beginPath();
  ctx.moveTo(x - w / 2, top);
  ctx.lineTo(x + w / 2, top);
  ctx.quadraticCurveTo(x + w / 2, top + 0.52 * s, x, top + 0.58 * s);
  ctx.quadraticCurveTo(x - w / 2, top + 0.52 * s, x - w / 2, top);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // the stem and the base
  ctx.beginPath();
  ctx.rect(x - 0.05 * s, top + 0.58 * s, 0.1 * s, 0.2 * s);
  ctx.fill();
  ctx.stroke();
  roundRectPath(ctx, x - 0.25 * s, top + 0.78 * s, 0.5 * s, 0.14 * s, 0.03 * s);
  ctx.fill();
  ctx.stroke();
  // a shine
  ctx.globalAlpha *= 0.55;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(x - 0.14 * s, top + 0.16 * s, 0.05 * s, 0.13 * s, 0.3, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

export class FlShowsPainter {
  /** The bracket card's static part (chips and lines), rebuilt only when a result changes. */
  private bracket: Sprite | null = null;
  private bracketKey = "";
  private readonly spots: ChipSpot[] = [];
  private readonly links: Link[] = [];
  private generation = -1;
  /** Shown this run (the data attributes): the bracket card, the champion card, the boss bar, the win chance (its text), the handicap tags. */
  bracketShown = false;
  championShown = false;
  bossBarShown = false;
  oddsText = "";
  hcTags = "";

  begin(view: FightLeagueView) {
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.bracketShown = false;
      this.championShown = false;
      this.bossBarShown = false;
      this.oddsText = "";
      this.hcTags = "";
      this.bracket = null;
      this.bracketKey = "";
    }
  }

  private display(color: string, strokeK = 0.11): FlTextStyle {
    return { role: "display", color, stroke: INK, strokeK, glow: null };
  }

  /** The two sides of the match in play: their lead fighter (slot order). */
  private sideLead(view: FightLeagueView, side: number): FlFighter | null {
    for (const f of view.fighters) if (f.team === side) return f;
    return null;
  }

  /* ------------------------------------------------------------------ the VS card */

  /**
   * The VS card's extras at `t` ms of the match's intro (`a` its veil's alpha): the show's line over the panels and the win
   * chance under the names (or nothing: hidden by a handicap or the switch). `A` is the arena rect on screen.
   */
  drawVsExtras(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, A: Rect, t: number, a: number) {
    const S = lay.side;
    const SL = showLabels(L);
    const sh = view.show;
    const cx = A.x + A.w / 2;
    const pop = t < 400 ? 0 : ease((t - 400) / 160);
    // the show's line, top of the card
    let top = A.y + 0.07 * A.h;
    const line = (text: string, color: string, fs: number) => {
      if (!text) return;
      fr.text.draw(ctx, fr.text.upperOf(text), cx, top, fs, this.display(color), "center", 0.9 * A.w, a * pop, 0.8 + 0.2 * pop);
      top += 1.15 * fs;
    };
    if (sh.rematchNext) line(SL.rematch, "#f87171", 0.05 * S);
    if (sh.kind === "series" || (sh.kind === "bracket" && sh.maxGames > 1)) {
      const decider = sh.score[0] >= sh.need - 1 && sh.score[1] >= sh.need - 1;
      line(decider ? `${SL.game(sh.games + 1)} · ${SL.decider}` : SL.game(sh.games + 1), decider ? GOLD : "#ffffff", 0.05 * S);
      const lead0 = this.sideLead(view, 0);
      const lead1 = this.sideLead(view, 1);
      if (lead0 && lead1) line(`${lead0.row.name} ${sh.score[0]} – ${sh.score[1]} ${lead1.row.name}`, "#ffffff", 0.032 * S);
      if (!decider && (sh.score[0] === sh.need - 1 || sh.score[1] === sh.need - 1)) line(SL.seriesPoint, "#fbbf24", 0.03 * S);
    }
    if (sh.kind === "bracket" && sh.round >= 0) {
      const code = flRoundCode(sh.rounds, sh.round);
      const { n, of } = flRoundBout(sh.rounds, sh.round, sh.pair);
      line(code === "final" || of <= 1 ? SL.round(code) : `${SL.round(code)} ${n}/${of}`, code === "final" ? GOLD : "#ffffff", 0.045 * S);
    }
    if (sh.kind === "boss") {
      line(SL.wave(sh.wave, sh.waves), "#ffffff", 0.045 * S);
      if (sh.wave > 1) line(SL.challenger, "#fbbf24", 0.03 * S);
    }
    this.drawOdds(ctx, fr, view, L, A, S, a * pop);
    // the panels' BUFFED / NERFED tags (drawn with the names – cards.ts): noted for the data
    if (a > 0) {
      for (const f of view.fighters) {
        for (const p of handicapParts(f, L)) {
          const tag = p.up ? "buffed" : "nerfed";
          if (!this.hcTags.split(",").includes(tag)) this.hcTags = this.hcTags ? (tag === "buffed" ? `buffed,${this.hcTags}` : `${this.hcTags},nerfed`) : tag;
        }
      }
    }
  }

  /** The win chance under the names: a bar of the sides' shares (accent segments), the percentages, the caption, UNDERDOG. */
  private drawOdds(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, A: Rect, S: number, alpha: number) {
    const st = view.story;
    const shown = view.settings.odds !== false && !st.handicapped && st.chances.length >= 2;
    if (!shown || alpha <= 0) return;
    const SL = showLabels(L);
    const n = st.chances.length;
    const w = 0.62 * A.w;
    const h = 0.02 * S;
    const x = A.x + (A.w - w) / 2;
    const y = A.y + A.h - 0.085 * S;
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = INK;
    roundRectPath(ctx, x - 2, y - 2, w + 4, h + 4, (h + 4) / 2);
    ctx.fill();
    let at = x;
    const pct: number[] = [];
    for (let side = 0; side < n; side++) {
      const lead = this.sideLead(view, side);
      const seg = st.chances[side] * w;
      ctx.fillStyle = lead ? lead.row.accent : "#a1a1aa";
      ctx.fillRect(at, y, seg, h);
      pct.push(flChancePercent(st.chances[side]));
      at += seg;
    }
    ctx.restore();
    const fs = 0.03 * S;
    const style: FlTextStyle = { role: "mono", color: "#ffffff", stroke: INK, strokeK: 0.16 };
    if (n === 2) {
      fr.text.draw(ctx, `${pct[0]} %`, x - 0.012 * S, y + h / 2, fs, style, "right", 0.2 * A.w, alpha);
      fr.text.draw(ctx, `${pct[1]} %`, x + w + 0.012 * S, y + h / 2, fs, style, "left", 0.2 * A.w, alpha);
      for (let side = 0; side < 2; side++) {
        if (st.chances[side] >= 0.4 - 1e-9) continue;
        fr.text.draw(ctx, fr.text.upperOf(SL.underdog), side === 0 ? x + 0.02 * S : x + w - 0.02 * S, y - 0.022 * S, 0.022 * S, this.display("#fbbf24"), side === 0 ? "left" : "right", 0.4 * w, alpha);
      }
    } else {
      let ax = x;
      for (let side = 0; side < n; side++) {
        const seg = st.chances[side] * w;
        fr.text.draw(ctx, `${pct[side]}%`, ax + seg / 2, y - 0.018 * S, 0.02 * S, style, "center", Math.max(1, seg), alpha);
        ax += seg;
      }
    }
    fr.text.draw(ctx, st.est ? `${SL.winChance} · ${SL.est}` : SL.winChance, A.x + A.w / 2, y + h + 0.022 * S, 0.018 * S, { role: "ui", color: "#e4e4e7", stroke: INK, strokeK: 0.16, weight: 700 }, "center", w, alpha);
    this.oddsText = pct.join(",");
  }

  /* ------------------------------------------------------------------ the names band */

  /**
   * The names band's show column (instead of the small VS): a series' score with its win pips, a bracket's round, a boss rush's
   * wave. Returns true when it drew (the band then leaves its VS out).
   */
  drawBandColumn(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number): boolean {
    const sh = view.show;
    const SL = showLabels(L);
    const S = lay.side;
    const cx = ox + S / 2;
    const muted = fr.pal.hud.muted;
    if (sh.kind === "series" || (sh.kind === "bracket" && sh.maxGames > 1)) {
      fr.text.number(ctx, `${sh.score[0]}-${sh.score[1]}`, cx, oy + lay.vsY, 0.026 * S, fr.pal.hud.dark ? "#f4f4f5" : INK, null, "center", 1);
      // the win pips: the wins a side needs, filled by its wins (left of the centre for side A, right for side B)
      const r = 0.0055 * S;
      const gap = 2.8 * r;
      const y = oy + 0.041 * S;
      for (let side = 0; side < 2; side++) {
        const lead = this.sideLead(view, side);
        for (let k = 0; k < sh.need; k++) {
          const x = side === 0 ? cx - 0.022 * S - k * gap : cx + 0.022 * S + k * gap;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, r, 0, TWO_PI);
          ctx.fillStyle = k < sh.score[side] ? (lead ? lead.row.accent : GOLD) : "rgba(0, 0, 0, 0.12)";
          ctx.fill();
          ctx.lineWidth = Math.max(1, 0.25 * r);
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.restore();
        }
      }
      return true;
    }
    if (sh.kind === "bracket" && sh.round >= 0) {
      const code = flRoundCode(sh.rounds, sh.round);
      const { n, of } = flRoundBout(sh.rounds, sh.round, sh.pair);
      fr.text.draw(ctx, code === "final" || of <= 1 ? SL.round(code) : `${SL.round(code)} ${n}/${of}`, cx, oy + lay.vsY, 0.017 * S, { role: "display", color: code === "final" ? "#ca8a04" : muted, stroke: null }, "center", 0.26 * S);
      return true;
    }
    if (sh.kind === "boss") {
      fr.text.draw(ctx, SL.wave(sh.wave, sh.waves), cx, oy + lay.vsY, 0.019 * S, { role: "display", color: muted, stroke: null }, "center", 0.26 * S);
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ the boss bar */

  /** The boss bar across the top of the arena and the challengers' queue under it (a boss rush, during a bout). */
  drawBossBar(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number) {
    const sh = view.show;
    if (sh.kind !== "boss" || sh.entrants.length === 0) return;
    const S = lay.side;
    const SL = showLabels(L);
    const boss = view.fighters.find((f) => f.boss) ?? null;
    const bossRow = sh.entrants[0].row;
    const max = Math.max(1e-9, sh.bossMaxHp);
    const hp = boss ? Math.max(0, boss.alive ? boss.hp : 0) : sh.bossHp;
    const frac = Math.max(0, Math.min(1, hp / max));
    const x = ox + lay.arena.x + 0.02 * lay.arena.w;
    const w = 0.96 * lay.arena.w;
    const h = 0.035 * S;
    const y = oy + lay.arena.y + 0.012 * S;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = INK;
    roundRectPath(ctx, x - 2, y - 2, w + 4, h + 4, 0.25 * h);
    ctx.fill();
    ctx.fillStyle = sh.phase2 ? "#dc2626" : bossRow.body;
    roundRectPath(ctx, x, y, Math.max(h * 0.5, w * frac), h, 0.2 * h);
    ctx.fill();
    ctx.restore();
    const style: FlTextStyle = { role: "display", color: "#ffffff", stroke: INK, strokeK: 0.14 };
    fr.text.draw(ctx, fr.text.upperOf(flShortName(bossRow)), x + 0.012 * S, y + h / 2, 0.024 * S, style, "left", 0.35 * w);
    fr.text.draw(ctx, sh.phase2 ? `${SL.wave(sh.wave, sh.waves)} · ${SL.phase2}` : SL.wave(sh.wave, sh.waves), x + w / 2, y + h / 2, 0.02 * S, style, "center", 0.3 * w);
    fr.text.number(ctx, String(Math.ceil(hp - 1e-6)), x + w - 0.012 * S, y + h / 2, 0.04 * S, "#ffffff", INK, "right", 1);
    // the queue: a mini ball per challenger, the beaten ones crossed out, the one in play ringed
    const r = 0.011 * S;
    const n = sh.entrants.length - 1;
    const gap = 2.6 * r;
    let qx = x + w - r - (n - 1) * gap;
    const qy = y + h + 0.02 * S;
    for (let i = 1; i <= n; i++, qx += gap) {
      const e = sh.entrants[i];
      this.dot(ctx, e.row, qx, qy, r, e.out ? 0.45 : 1, e.out);
      if (i === sh.b && !e.out) {
        ctx.save();
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = Math.max(1.5, 0.22 * r);
        ctx.beginPath();
        ctx.arc(qx, qy, 1.35 * r, 0, TWO_PI);
        ctx.stroke();
        ctx.restore();
      }
    }
    this.bossBarShown = true;
  }

  /** A mini ball of `row` (its body and an accent ring), crossed out in red when `cross`. */
  private dot(ctx: CanvasRenderingContext2D, row: FlFighterRow, x: number, y: number, r: number, alpha: number, cross: boolean) {
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.fillStyle = cross ? greyOf(row.body) : row.body;
    ctx.strokeStyle = cross ? "#52525b" : row.accent;
    ctx.lineWidth = Math.max(1, 0.3 * r);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    if (!cross) return;
    ctx.save();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(1.5, 0.28 * r);
    ctx.beginPath();
    ctx.moveTo(x - 0.8 * r, y - 0.8 * r);
    ctx.lineTo(x + 0.8 * r, y + 0.8 * r);
    ctx.moveTo(x + 0.8 * r, y - 0.8 * r);
    ctx.lineTo(x - 0.8 * r, y + 0.8 * r);
    ctx.stroke();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ the interlude */

  /** The interlude's card between two matches (the show's phase "card"): a series' score, the bracket, a boss rush's boss. */
  drawInterlude(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number) {
    const sh = view.show;
    if (sh.phase !== "card") return;
    const S = lay.side;
    const SL = showLabels(L);
    const len = Math.max(1, 1000 * Math.max(0, view.settings.cardSec ?? 0));
    const from = sh.phaseUntil - len;
    const age = Math.max(0, fr.now - from);
    const a = ease(age / 200);
    const A: Rect = { x: ox + lay.arena.x, y: oy + lay.arena.y, w: lay.arena.w, h: lay.arena.h };
    if (sh.kind === "bracket") {
      this.drawBracketCard(ctx, fr, view, L, ox, oy, S, age, a);
      return;
    }
    ctx.save();
    ctx.globalAlpha = 0.6 * a;
    ctx.fillStyle = INK;
    ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.restore();
    const cx = A.x + A.w / 2;
    if (sh.kind === "series") {
      const lead0 = this.sideLead(view, 0);
      const lead1 = this.sideLead(view, 1);
      if (sh.rematchNext) fr.text.draw(ctx, fr.text.upperOf(SL.rematch), cx, A.y + 0.25 * A.h, 0.06 * S, this.display("#f87171"), "center", 0.9 * A.w, a);
      fr.text.draw(ctx, fr.text.upperOf(SL.game(sh.games + 1)), cx, A.y + 0.36 * A.h, 0.05 * S, this.display("#ffffff"), "center", 0.9 * A.w, a);
      if (lead0) fr.text.draw(ctx, fr.text.upperOf(lead0.row.name), cx - 0.09 * S, A.y + 0.5 * A.h, 0.045 * S, this.display(lead0.row.body), "right", 0.3 * A.w, a);
      if (lead1) fr.text.draw(ctx, fr.text.upperOf(lead1.row.name), cx + 0.09 * S, A.y + 0.5 * A.h, 0.045 * S, this.display(lead1.row.body), "left", 0.3 * A.w, a);
      fr.text.number(ctx, `${sh.score[0]}-${sh.score[1]}`, cx, A.y + 0.5 * A.h, 0.07 * S, "#ffffff", INK, "center", a);
      return;
    }
    if (sh.kind === "boss" && sh.entrants.length > 0) {
      const bossRow = sh.entrants[0].row;
      // the boss's bar refilling with the heal over the card's first second
      const k = ease(age / 1000);
      const hp = sh.healFrom + (sh.bossHp - sh.healFrom) * k;
      const frac = Math.max(0, Math.min(1, hp / Math.max(1e-9, sh.bossMaxHp)));
      const w = 0.7 * A.w;
      const h = 0.04 * S;
      const x = cx - w / 2;
      const y = A.y + 0.42 * A.h;
      fr.text.draw(ctx, fr.text.upperOf(bossRow.name), cx, y - 0.06 * S, 0.055 * S, this.display(bossRow.body), "center", 0.9 * A.w, a);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "#27272a";
      roundRectPath(ctx, x, y, w, h, 0.3 * h);
      ctx.fill();
      ctx.fillStyle = sh.phase2 ? "#dc2626" : bossRow.accent;
      roundRectPath(ctx, x, y, Math.max(0.6 * h, w * frac), h, 0.3 * h);
      ctx.fill();
      ctx.restore();
      fr.text.number(ctx, String(Math.ceil(hp - 1e-6)), cx, y + h / 2, 0.034 * S, "#ffffff", INK, "center", a);
      fr.text.draw(ctx, fr.text.upperOf(SL.wave(Math.min(sh.waves, sh.wave + (sh.rematchNext ? 0 : 1)), sh.waves)), cx, y + h + 0.05 * S, 0.045 * S, this.display("#ffffff"), "center", 0.9 * A.w, a);
      if (sh.rematchNext) fr.text.draw(ctx, fr.text.upperOf(SL.rematch), cx, A.y + 0.2 * A.h, 0.05 * S, this.display("#f87171"), "center", 0.9 * A.w, a);
      // the queue
      const r = 0.018 * S;
      const n = sh.entrants.length - 1;
      const gap = 2.7 * r;
      let qx = cx - ((n - 1) * gap) / 2;
      for (let i = 1; i <= n; i++, qx += gap) this.dot(ctx, sh.entrants[i].row, qx, y + h + 0.12 * S, r, a * (sh.entrants[i].out ? 0.5 : 1), sh.entrants[i].out);
    }
  }

  /* ------------------------------------------------------------------ the bracket */

  /**
   * The bracket's layout on the square (local px from its corner): the rounds drawn (the last four at most – a 16 as two halves
   * meeting at the final), each bout's chips and the connectors to their next slots. Fills `spots` and `links`.
   */
  private layoutBracket(rounds: readonly FlBout[][], S: number): { r0: number; chipW: number; chipH: number; fs: number } {
    this.spots.length = 0;
    this.links.length = 0;
    const last = rounds.length - 1;
    // the first round drawn: 16 entrants at most (a bigger bracket shows its last 16)
    let r0 = 0;
    while (r0 < last && 2 * rounds[r0].length > 16) r0++;
    const halves = 2 * rounds[r0].length > 8;
    const top = 0.17 * S;
    const bottom = 0.93 * S;
    const H = bottom - top;
    const cols = halves ? 2 * (last - r0) + 1 : last - r0 + 2;
    const left = 0.04 * S;
    const right = 0.96 * S;
    const colW = (right - left) / cols;
    const chipW = Math.min(0.92 * colW, 0.2 * S);
    const n0 = 2 * rounds[r0].length;
    const chipH = Math.min(0.06 * S, (0.8 * H) / (halves ? n0 / 2 : n0));
    const fs = Math.max(0.0135 * S, Math.min(0.022 * S, 0.5 * chipH));
    const colX = (c: number) => left + (c + 0.5) * colW;
    if (!halves) {
      for (let r = r0; r <= last; r++) {
        const c = r - r0;
        const chips = 2 * rounds[r].length;
        for (let p = 0; p < rounds[r].length; p++) {
          const bout = rounds[r][p];
          for (const [k, e] of [
            [0, bout.a],
            [1, bout.b],
          ] as const) {
            const idx = 2 * p + k;
            const y = top + ((idx + 0.5) * H) / chips;
            const lost = bout.winner >= 0 && e >= 0 && bout.winner !== e;
            this.spots.push({ e, x: colX(c), y, lost });
            // the connector to the next column's slot (the winner's place)
            const ny = top + ((p + 0.5) * H) / (chips / 2);
            this.links.push({ x0: colX(c) + chipW / 2, y0: y, xm: colX(c) + colW / 2, x1: colX(c + 1) - chipW / 2, y1: ny, r, p, e });
          }
        }
      }
      // the champion's slot
      const fin = rounds[last][0];
      this.spots.push({ e: fin && fin.winner >= 0 ? fin.winner : FL_PENDING, x: colX(last - r0 + 1), y: top + H / 2, lost: false });
      return { r0, chipW, chipH, fs };
    }
    // two halves meeting at the final: the left half's rounds from the left edge in, the right half's mirrored
    const mid = last - r0;
    for (let r = r0; r < last; r++) {
      const c = r - r0;
      const len = rounds[r].length;
      const half = len / 2;
      const chipsHalf = len;
      for (let p = 0; p < len; p++) {
        const right = p >= half;
        const q = right ? p - half : p;
        const col = right ? cols - 1 - c : c;
        const nextCol = right ? col - 1 : col + 1;
        const bout = rounds[r][p];
        for (const [k, e] of [
          [0, bout.a],
          [1, bout.b],
        ] as const) {
          const idx = 2 * q + k;
          const y = top + ((idx + 0.5) * H) / chipsHalf;
          const lost = bout.winner >= 0 && e >= 0 && bout.winner !== e;
          this.spots.push({ e, x: colX(col), y, lost });
          const ny = r + 1 < last ? top + ((q + 0.5) * H) / (chipsHalf / 2) : top + H / 2 + (right ? 0.6 : -0.6) * chipH;
          const sx = right ? colX(col) - chipW / 2 : colX(col) + chipW / 2;
          const ex = r + 1 < last ? (right ? colX(nextCol) + chipW / 2 : colX(nextCol) - chipW / 2) : colX(mid) + (right ? chipW / 2 : -chipW / 2);
          this.links.push({ x0: sx, y0: y, xm: (sx + ex) / 2, x1: ex, y1: ny, r, p, e });
        }
      }
    }
    // the final in the middle column (its two chips one above the other) and the champion's slot above them
    const fin = rounds[last][0];
    const fy = top + H / 2;
    this.spots.push({ e: fin.a, x: colX(mid), y: fy - 0.6 * chipH, lost: fin.winner >= 0 && fin.a >= 0 && fin.winner !== fin.a });
    this.spots.push({ e: fin.b, x: colX(mid), y: fy + 0.6 * chipH, lost: fin.winner >= 0 && fin.b >= 0 && fin.winner !== fin.b });
    this.spots.push({ e: fin.winner >= 0 ? fin.winner : FL_PENDING, x: colX(mid), y: fy - 2.2 * chipH, lost: false });
    return { r0, chipW, chipH, fs };
  }

  /** One chip of the bracket card: the entrant's dot and short name (a bye faint, a slot not known yet an empty outline). */
  private chip(g: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, spot: ChipSpot, w: number, h: number, fs: number) {
    const x = spot.x - w / 2;
    const y = spot.y - h / 2;
    const e = spot.e >= 0 ? view.show.entrants[spot.e] : null;
    g.save();
    g.fillStyle = e ? (spot.lost ? "#3f3f46" : "#18181b") : "rgba(24, 24, 27, 0.5)";
    roundRectPath(g, x, y, w, h, 0.3 * h);
    g.fill();
    g.strokeStyle = e && !spot.lost ? e.row.accent : "#52525b";
    g.lineWidth = Math.max(1, 0.06 * h);
    if (!e) g.setLineDash([0.12 * h, 0.1 * h]);
    g.stroke();
    g.setLineDash([]);
    g.restore();
    if (!e) return;
    const r = 0.3 * h;
    this.dot(g, e.row, x + 0.5 * h, spot.y, r, spot.lost ? 0.6 : 1, false);
    const name = fr.text.upperOf(flShortName(e.row));
    const tw = fr.text.draw(g, name, x + 0.95 * h, spot.y, fs, { role: "display", color: spot.lost ? "#a1a1aa" : "#ffffff", stroke: null }, "left", w - 1.05 * h, spot.lost ? 0.75 : 1);
    if (spot.lost) {
      g.save();
      g.strokeStyle = "#ef4444";
      g.lineWidth = Math.max(1.5, 0.08 * h);
      g.beginPath();
      g.moveTo(x + 0.95 * h, spot.y);
      g.lineTo(x + 0.95 * h + tw, spot.y);
      g.stroke();
      g.restore();
    }
  }

  /** The bracket card over the whole square (cached: rebuilt when a result changes), the last winner's line and the next pair's pulse live. */
  private drawBracketCard(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, ox: number, oy: number, S: number, age: number, a: number) {
    const sh = view.show;
    if (sh.rounds.length === 0) return;
    const SL = showLabels(L);
    const key = `${view.generation}|${sh.resultSerial}|${Math.round(S)}|${fr.dpr}|${fr.pal.stage}`;
    const lay = this.layoutBracket(sh.rounds, S);
    if (key !== this.bracketKey) {
      this.bracketKey = key;
      const prev = fr.text.scale;
      fr.text.scale = fr.dpr;
      this.bracket = makeSprite({ x0: 0, y0: 0, x1: S, y1: S }, fr.dpr, (g) => {
        g.fillStyle = "rgba(9, 9, 11, 0.86)";
        g.fillRect(0, 0, S, S);
        // the connectors: the winners' paths in white, the rest faint
        for (const l of this.links) {
          const bout = sh.rounds[l.r]?.[l.p];
          const won = !!bout && bout.winner >= 0 && bout.winner === l.e;
          g.strokeStyle = won ? "#ffffff" : "rgba(255, 255, 255, 0.22)";
          g.lineWidth = Math.max(1, (won ? 0.004 : 0.0025) * S);
          g.beginPath();
          g.moveTo(l.x0, l.y0);
          g.lineTo(l.xm, l.y0);
          g.lineTo(l.xm, l.y1);
          g.lineTo(l.x1, l.y1);
          g.stroke();
        }
        for (const spot of this.spots) if (spot.e !== FL_BYE) this.chip(g, fr, view, spot, lay.chipW, lay.chipH, lay.fs);
        // the title: the round about to be played
        const next = flNextBout(sh.rounds);
        const code = next ? flRoundCode(sh.rounds, next.r) : "final";
        fr.text.draw(g, fr.text.upperOf(SL.round(code)), S / 2, 0.09 * S, 0.05 * S, { role: "display", color: GOLD, stroke: INK, strokeK: 0.11 }, "center", 0.9 * S);
      });
      fr.text.scale = prev;
    }
    if (this.bracket) {
      ctx.save();
      ctx.globalAlpha = a;
      ctx.drawImage(this.bracket.canvas, ox, oy, S, S);
      ctx.restore();
    }
    // the last winner's line, drawn over 500 ms in gold
    const k = Math.min(1, age / 500);
    for (const l of this.links) {
      const bout = sh.rounds[l.r]?.[l.p];
      if (!bout || bout.winner < 0 || bout.winner !== l.e || l.r !== this.lastRound(sh.rounds)) continue;
      if (!this.isLastResult(sh.rounds, l.r, l.p)) continue;
      const x0 = ox + l.x0;
      const y0 = oy + l.y0;
      const segs = [Math.abs(l.xm - l.x0), Math.abs(l.y1 - l.y0), Math.abs(l.x1 - l.xm)];
      let left = k * (segs[0] + segs[1] + segs[2]);
      ctx.save();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = Math.max(2, 0.007 * S);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      const pts: [number, number][] = [
        [ox + l.xm, oy + l.y0],
        [ox + l.xm, oy + l.y1],
        [ox + l.x1, oy + l.y1],
      ];
      let px = x0;
      let py = y0;
      for (let i = 0; i < 3 && left > 0; i++) {
        const [qx, qy] = pts[i];
        const d = segs[i];
        const u = d > 1e-9 ? Math.min(1, left / d) : 1;
        px = px + (qx - px) * u;
        py = py + (qy - py) * u;
        ctx.lineTo(px, py);
        left -= d;
        px = qx;
        py = qy;
      }
      ctx.stroke();
      ctx.restore();
    }
    // the next pair pulses
    const next = flNextBout(sh.rounds);
    if (next) {
      const pulse = 0.5 + 0.5 * Math.sin(age / 120);
      for (const spot of this.spots) {
        const bout = sh.rounds[next.r][next.p];
        if (spot.e < 0 || (spot.e !== bout.a && spot.e !== bout.b) || spot.lost) continue;
        ctx.save();
        ctx.globalAlpha = a * (0.4 + 0.6 * pulse);
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(2, 0.005 * S);
        roundRectPath(ctx, ox + spot.x - lay.chipW / 2 - 3, oy + spot.y - lay.chipH / 2 - 3, lay.chipW + 6, lay.chipH + 6, 0.3 * lay.chipH);
        ctx.stroke();
        ctx.restore();
      }
    }
    this.bracketShown = true;
  }

  /** The round of the last result written (the deepest round with a decided bout that is not a bye). */
  private lastRound(rounds: readonly FlBout[][]): number {
    for (let r = rounds.length - 1; r >= 0; r--) for (const b of rounds[r]) if (b.winner >= 0 && b.a >= 0 && b.b >= 0) return r;
    return -1;
  }

  /** Whether bout (r, p) is the last decided one of its round (the bracket fights its rounds top to bottom). */
  private isLastResult(rounds: readonly FlBout[][], r: number, p: number): boolean {
    for (let q = rounds[r].length - 1; q >= 0; q--) {
      const b = rounds[r][q];
      if (b.winner >= 0 && b.a >= 0 && b.b >= 0) return q === p;
    }
    return false;
  }

  /* ------------------------------------------------------------------ the show's verdict */

  /** The bracket's champion card (instead of the winner's): the cup, CHAMPION, the name in its colours, the path, confetti. */
  drawChampion(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, age: number, alpha: number) {
    const sh = view.show;
    if (sh.kind !== "bracket" || sh.champion < 0) return;
    const S = lay.side;
    const SL = showLabels(L);
    const e = sh.entrants[sh.champion];
    if (!e) return;
    const A: Rect = { x: ox + lay.arena.x, y: oy + lay.arena.y, w: lay.arena.w, h: lay.arena.h };
    ctx.save();
    ctx.globalAlpha = 0.8 * alpha;
    ctx.fillStyle = INK;
    ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.restore();
    // the confetti in the champion's colours (analytic)
    ctx.save();
    for (let i = 0; i < 70; i++) {
      const t = age / 1000 - 0.3 * hash(i, 1);
      if (t < 0) continue;
      const x = ox + S * hash(i, 3) + 0.03 * S * Math.sin(3 * t + 6 * hash(i, 4));
      const y = oy + ((-0.05 * S + S * (0.22 + 0.2 * hash(i, 2)) * t) % (1.1 * S));
      const size = 0.008 * S * (0.6 + hash(i, 5));
      ctx.globalAlpha = 0.9 * alpha;
      ctx.fillStyle = i % 3 === 0 ? GOLD : i % 3 === 1 ? e.row.accent : e.row.body;
      ctx.fillRect(x - size, y - size / 2, 2 * size, size);
    }
    ctx.restore();
    const cx = A.x + A.w / 2;
    const pop = age < 200 ? 0.7 + 0.3 * ease(age / 200) : 1;
    drawCup(ctx, cx, A.y + 0.3 * A.h, 0.3 * S * pop, alpha);
    fr.text.draw(ctx, fr.text.upperOf(SL.champion), cx, A.y + 0.56 * A.h, 0.075 * S, this.display(GOLD), "center", 0.9 * A.w, alpha, pop);
    // the name in its colours: its body on an accent-stroked plate
    const fs = 0.06 * S;
    const name = fr.text.upperOf(e.row.name);
    const tw = Math.min(0.85 * A.w, fr.text.width(name, fs, this.display("#ffffff")));
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = e.row.body;
    roundRectPath(ctx, cx - tw / 2 - 0.6 * fs, A.y + 0.68 * A.h - 0.75 * fs, tw + 1.2 * fs, 1.5 * fs, 0.4 * fs);
    ctx.fill();
    ctx.strokeStyle = e.row.accent;
    ctx.lineWidth = Math.max(2, 0.08 * fs);
    ctx.stroke();
    ctx.restore();
    fr.text.draw(ctx, name, cx, A.y + 0.68 * A.h, fs, this.display("#ffffff"), "center", 0.85 * A.w, alpha);
    // the path: the entrants it beat, in the order it met them
    const beaten: string[] = [];
    for (const round of sh.rounds) {
      for (const b of round) {
        if (b.winner !== sh.champion || b.a < 0 || b.b < 0) continue;
        const other = b.a === sh.champion ? b.b : b.a;
        const row = sh.entrants[other]?.row;
        if (row) beaten.push(row.name);
      }
    }
    if (beaten.length > 0) fr.text.draw(ctx, SL.beat(beaten.join(", ")), cx, A.y + 0.8 * A.h, 0.026 * S, { role: "ui", color: "#f4f4f5", stroke: INK, strokeK: 0.14, weight: 700 }, "center", 0.9 * A.w, alpha);
    this.championShown = true;
  }

  /** A series' or a boss rush's verdict line over the winner's card (gold, at the top of the arena); `shown` gets its banner's name. */
  drawShowLine(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, alpha: number, shown?: Set<string>) {
    const sh = view.show;
    const S = lay.side;
    const SL = showLabels(L);
    const A: Rect = { x: ox + lay.arena.x, y: oy + lay.arena.y, w: lay.arena.w, h: lay.arena.h };
    let text = "";
    let color = GOLD;
    let name = "";
    if (sh.kind === "series" && sh.winnerSide >= 0) {
      const lead = this.sideLead(view, sh.winnerSide);
      const names = view.fighters.filter((f) => f.team === sh.winnerSide).map((f) => f.row.name).join(" + ");
      text = SL.seriesWin(names || (lead ? lead.row.name : ""), sh.score[sh.winnerSide], sh.score[1 - sh.winnerSide]);
      name = "seriesWin";
    } else if (sh.kind === "boss" && sh.champion === 1) {
      const challenger = sh.entrants[sh.b]?.row.name ?? "";
      text = SL.bossFalls(challenger);
      name = "bossFalls";
    } else if (sh.kind === "boss" && sh.champion === 0) {
      text = SL.bossSurvives(sh.waves, sh.waves);
      color = "#f87171";
      name = "bossSurvives";
    }
    if (!text) return;
    if (shown && alpha > 0) shown.add(name);
    fr.text.draw(ctx, fr.text.upperOf(text), A.x + A.w / 2, A.y + 0.08 * A.h, 0.05 * S, this.display(color), "center", 0.92 * A.w, alpha);
  }

  /**
   * The winner card's story lines (from the banners): the tags – PERFECT! > UPSET! > COMEBACK! > CLUTCH!, at most two (the mode
   * wrote them in that order) – and '[ability] finish!'. Draws from `y` down; returns the next line's y. `shown` gets their names.
   */
  drawTags(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, cx: number, y: number, S: number, maxW: number, alpha: number, shown: Set<string>): number {
    const SL = showLabels(L);
    const now = fr.now;
    let ty = y;
    let tags = 0;
    for (let s = Math.max(0, view.bannerSerial - FL_BANNER_CAP); s < view.bannerSerial; s++) {
      const bn = view.banners[s % FL_BANNER_CAP];
      if (now < bn.t) continue;
      let text = "";
      let color = "#ffffff";
      let name = "";
      if (bn.kind === FB_PERFECT) [text, color, name] = [L.perfect, GOLD, "perfect"];
      else if (bn.kind === FB_UPSET) [text, color, name] = [SL.upset, "#fb923c", "upset"];
      else if (bn.kind === FB_COMEBACK) [text, color, name] = [SL.comeback, "#22d3ee", "comeback"];
      else if (bn.kind === FB_CLUTCH) [text, color, name] = [L.clutch, "#f87171", "clutch"];
      else if (bn.kind === FB_FINISH) {
        const f = bn.slot >= 0 ? view.fighters[bn.slot] : null;
        if (!f) continue;
        fr.text.draw(ctx, SL.finish(f.row.ability.name), cx, ty, 0.03 * S, { role: "ui", color: "#fde047", stroke: INK, strokeK: 0.14, weight: 800 }, "center", maxW, alpha);
        shown.add("finish");
        ty += 0.045 * S;
        continue;
      } else continue;
      if (tags >= 2) continue;
      const pop = now - bn.t < 150 ? 0.7 + 0.3 * ease((now - bn.t) / 150) : 1;
      fr.text.draw(ctx, fr.text.upperOf(text), cx, ty, 0.05 * S, { role: "display", color, stroke: INK, strokeK: 0.12, glow: null }, "center", maxW, alpha, pop);
      shown.add(name);
      ty += 0.06 * S;
      tags++;
    }
    return ty;
  }
}
