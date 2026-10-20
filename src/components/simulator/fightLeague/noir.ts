import type { FightLeagueView, FlFighter } from "@/lib/physics/modes/fightLeague";
import { FL_TRAIL_AT, flNameColor, type FlHudLayout } from "@/lib/physics/modes/fightLeagueFx";
import { flShortName } from "@/lib/physics/modes/fightLeagueRoster";
import type { FlFrame, FightLeagueLabels, FlStateLabels } from "./frame";
import { GOLD, INK } from "./palette";
import type { FlShowsPainter } from "./shows";
import { SpriteCache, makeSprite, type Sprite } from "./sprites";
import { NUM_TEXT, type FlTextStyle } from "./text";
import type { FlWeaponsPainter } from "./weapons";

/**
 * --- fl-noir --- The noir stage's HUD (screen px, inside the exported square), after the reel layout: above the arena the
 * fighters' weapons as big icons side by side (our own vector silhouettes, the weapons painter's held sprites), under them
 * the matchup title "THOR   VS   LOKI" in a chunky pixel face of our own (a 5 × 7 bitmap per letter, baked once into one
 * sprite: each name in its fighter's colour, VS in white) with the timer small at the right edge; under the arena a small
 * monospace stats block of four lines – the names with their HP in the fighters' colours, the damage dealt, the state tags
 * ([NORMAL] | [KNOCKBACK] …, from the fighter's statuses) and the ability's name with its meter (the ability boxes folded in).
 * No names band, no HP bars, no lead bar: the HP number inside the disc is the bar. A match of three fighters or more gets a
 * column per fighter (its short name); a show's column (a series' score, a bracket's round) takes the icons' place.
 */

/** The pixel face: 5 × 7 cells a glyph ('#' lit), A–Z, 0–9 and the marks a name or a title needs. */
const PIXEL_GLYPHS: Readonly<Record<string, string>> = {
  A: ".###.#...##...#######...##...##...#",
  B: "####.#...##...#####.#...##...#####.",
  C: ".#####....#....#....#....#.....####",
  D: "####.#...##...##...##...##...#####.",
  E: "######....#....####.#....#....#####",
  F: "######....#....####.#....#....#....",
  G: ".#####....#....#.####...##...#.####",
  H: "#...##...##...#######...##...##...#",
  I: "#####..#....#....#....#....#..#####",
  J: "..###...#....#....#....#.#..#..##..",
  K: "#...##..#.#.#..##...#.#..#..#.#...#",
  L: "#....#....#....#....#....#....#####",
  M: "#...###.###.#.##.#.##...##...##...#",
  N: "#...###..##.#.##..###...##...##...#",
  O: ".###.#...##...##...##...##...#.###.",
  P: "####.#...##...#####.#....#....#....",
  Q: ".###.#...##...##...##.#.##..#..##.#",
  R: "####.#...##...#####.#.#..#..#.#...#",
  S: ".#####....#.....###.....#....#####.",
  T: "#####..#....#....#....#....#....#..",
  U: "#...##...##...##...##...##...#.###.",
  V: "#...##...##...##...##...#.#.#...#..",
  W: "#...##...##...##.#.##.#.###.###...#",
  X: "#...##...#.#.#...#...#.#.#...##...#",
  Y: "#...##...#.#.#...#....#....#....#..",
  Z: "#########....#...#...#...#....#####",
  "0": ".###.#...##..###.#.###..##...#.###.",
  "1": "..#...##....#....#....#....#...###.",
  "2": ".###.#...#....#...#...#...#...#####",
  "3": "#####...#...#.....#.....##...#.###.",
  "4": "...#...##..#.#.#..#.#####...#....#.",
  "5": "######....####.....#....##...#.###.",
  "6": "..##..#...#....####.#...##...#.###.",
  "7": "#####....#...#...#...#...#....#....",
  "8": ".###.#...##...#.###.#...##...#.###.",
  "9": ".###.#...##...#.####....#...#..##..",
  "&": ".##..#..#.#..#..##..#.#.##..#..##.#",
  "'": "..#....#...#.......................",
  "-": "...............#####...............",
  ".": "..........................##...##..",
  "+": "......#....#..#####..#....#........",
  ":": "......##...##............##...##...",
  "!": "..#....#....#....#....#.........#..",
};
const GLYPH_W = 5;
const GLYPH_H = 7;
/** A glyph's advance and a space's, in cells. */
const ADVANCE = 6;
const SPACE = 4;
/** A letter the face lacks: a hollow box. */
const BOX_GLYPH = "######...##...##...##...##...######";

/** `text` as the face draws it: upper case, diacritics stripped (a custom fighter's "É" draws as E). */
function pixelText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();
}

/** The width of `text` in cells. */
function pixelWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += ch === " " ? SPACE : ADVANCE;
  return Math.max(0, w - 1);
}

/** Paints `text` at (x, y) (its left edge, its top) in cells of `c` px, one fillRect a lit cell. */
function paintPixels(g: CanvasRenderingContext2D, text: string, x: number, y: number, c: number, color: string) {
  g.fillStyle = color;
  let cx = x;
  for (const ch of text) {
    if (ch === " ") {
      cx += SPACE * c;
      continue;
    }
    const bits = PIXEL_GLYPHS[ch] ?? BOX_GLYPH;
    for (let row = 0; row < GLYPH_H; row++) {
      // runs of lit cells in a row become one rect
      let run = -1;
      for (let col = 0; col <= GLYPH_W; col++) {
        const lit = col < GLYPH_W && bits[row * GLYPH_W + col] === "#";
        if (lit && run < 0) run = col;
        else if (!lit && run >= 0) {
          g.fillRect(cx + run * c, y + row * c, (col - run) * c, c);
          run = -1;
        }
      }
    }
    cx += ADVANCE * c;
  }
}

/** A part of the title: a text in a colour. */
interface TitlePart {
  text: string;
  color: string;
}

/** The English words of the state tags (the page hands in its translations). */
export const DEFAULT_FL_STATE_LABELS: FlStateLabels = {
  normal: "NORMAL",
  knockback: "KNOCKBACK",
  stunned: "STUNNED",
  casting: "CASTING",
  shielded: "SHIELDED",
  slowed: "SLOWED",
  buffed: "BUFFED",
  dead: "DEAD",
};

export type FlStateCode = keyof FlStateLabels;

/** The tag colours (on black). */
const STATE_COLORS: Readonly<Record<FlStateCode, string>> = {
  normal: "#a1a1aa",
  knockback: "#fb923c",
  stunned: "#7dd3fc",
  casting: "#e879f9",
  shielded: GOLD,
  slowed: "#93c5fd",
  buffed: "#a3e635",
  dead: "#ef4444",
};

/**
 * A fighter's state tag from its statuses, the most telling first: dead; stunned (frozen, held, pinned); casting (a
 * telegraph up); shielded (invulnerable, reflecting); in knockback (hit within 400 ms and flying past FL_TRAIL_AT × its
 * cruise); slowed (webbed, confused); buffed (a speed, damage or attack-speed burst); else normal.
 */
export function flStateOf(f: FlFighter, now: number): FlStateCode {
  if (!f.alive) return "dead";
  if (now < f.frozenUntil || f.heldBy >= 0 || now < f.pinUntil) return "stunned";
  if (f.telegraphUntil >= 0) return "casting";
  if (now < f.invulnUntil || now < f.reflectUntil) return "shielded";
  if (now - f.hitMs >= 0 && now - f.hitMs < 400 && Math.hypot(f.vx, f.vy) > FL_TRAIL_AT * Math.max(1, f.cruise)) return "knockback";
  if (now < f.slowUntil || now < f.confusedUntil) return "slowed";
  if ((now < f.speedMulUntil && f.speedMul > 1) || (now < f.dmgMulUntil && f.dmgMul > 1) || (now < f.atkMulUntil && f.atkMul > 1)) return "buffed";
  return "normal";
}

/**
 * The noir layout as shares of the square's side, top down: the weapon icons (0.12 S tall, centred at 0.065 S), the title
 * (0.06 S tall letters at 0.165 S, at most 0.9 S wide), the arena (a 0.6 S square from 0.205 S – the physics field drawn
 * smaller than on the other stages: a render-only scale about its centre, `FL_NOIR_ARENA_FRAC / FL_ARENA_FRAC`, the
 * simulation untouched), then the stats block's four lines from 0.813 S, ending above the watermark badge's strip.
 */
export const FL_NOIR_ICON_Y = 0.065;
export const FL_NOIR_ICON_H = 0.12;
export const FL_NOIR_TITLE_Y = 0.165;
export const FL_NOIR_TITLE_H = 0.06;
export const FL_NOIR_TITLE_W = 0.9;
export const FL_NOIR_ARENA_TOP = 0.205;
export const FL_NOIR_ARENA_FRAC = 0.6;
export const FL_NOIR_BLOCK_TOP = 0.813;
/** The four lines' font sizes (the first the names and HP, then the damage, the tags, the ability) and their centre lines. */
export const FL_NOIR_LINE_FS = [0.028, 0.025, 0.025, 0.025] as const;
export const FL_NOIR_LINE_Y = [0.827, 0.8545, 0.881, 0.9075] as const;

const SEP = "|";

export class FlNoirHudPainter {
  /** The title sprite (one per matchup, size and device scale). */
  private readonly titles = new SpriteCache<string>(4);
  private timerSec = -1;
  private timerText = "";
  private generation = -1;
  /** What the last frame drew: the names in the title, the ability lines, the smallest ability name size (a share of the side). */
  namesDrawn = 0;
  abilitiesDrawn = 0;
  abilityFsMin = 0;

  begin(view: FightLeagueView) {
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.timerSec = -1;
    }
  }

  private mono(color: string): FlTextStyle {
    return { role: "mono", color, stroke: null, weight: 800 };
  }

  /** The title's parts: the names (a team's joined by "+") in their colours, VS in white between the sides. */
  titleParts(view: FightLeagueView, L: FightLeagueLabels): TitlePart[] {
    const parts: TitlePart[] = [];
    const vs = { text: pixelText(L.vs), color: "#ffffff" };
    const teams = view.match === "2v2" || view.match === "3v3";
    if (teams) {
      for (let t = 0; t < 2; t++) {
        const members = view.fighters.filter((f) => f.team === t);
        if (members.length === 0) continue;
        if (parts.length > 0) parts.push(vs);
        members.forEach((f, i) => {
          if (i > 0) parts.push({ text: "+", color: "#ffffff" });
          parts.push({ text: pixelText(flShortName(f.row)), color: flNameColor(f.row.body, f.row.accent) });
        });
      }
      return parts;
    }
    const short = view.fighters.length > 2;
    for (const f of view.fighters) {
      if (parts.length > 0) parts.push(vs);
      parts.push({ text: pixelText(short ? flShortName(f.row) : f.row.name), color: flNameColor(f.row.body, f.row.accent) });
    }
    return parts;
  }

  /** The title baked once: the parts in a row with a gap of 2.5 advances round VS, fitted to `maxW`. */
  private titleSprite(fr: FlFrame, parts: TitlePart[], S: number, maxW: number): Sprite | null {
    const key = `${S}|${fr.dpr}|${maxW}|${parts.map((p) => `${p.text}~${p.color}`).join("|")}`;
    return this.titles.get(key, () => {
      const gap = 2.5 * ADVANCE;
      let cells = 0;
      for (const p of parts) cells += pixelWidth(p.text) + gap;
      cells = Math.max(1, cells - gap);
      let c = (FL_NOIR_TITLE_H * S) / GLYPH_H;
      if (cells * c > maxW) c = maxW / cells;
      const w = cells * c;
      const h = GLYPH_H * c;
      return makeSprite({ x0: -w / 2, y0: -h / 2, x1: w / 2, y1: h / 2 }, fr.dpr, (g) => {
        let x = -w / 2;
        for (const p of parts) {
          paintPixels(g, p.text, x, -h / 2, c, p.color);
          x += (pixelWidth(p.text) + gap) * c;
        }
      });
    });
  }

  /** The time left (as the band's pill shows it), small and mono at the right edge of the title line; red in the last five seconds. */
  private drawTimer(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, lay: FlHudLayout, ox: number, oy: number) {
    const cap = view.capSec ?? view.settings.timeCap;
    if (!(cap > 0)) return;
    const now = fr.now;
    const at = view.matchOver ? Math.min(now, view.finishMs) : now;
    const remaining = Math.max(0, Math.min(cap, cap - (at - view.introMs) / 1000));
    const secs = Math.ceil(remaining - 1e-6);
    if (secs !== this.timerSec) {
      this.timerSec = secs;
      this.timerText = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    }
    const hot = secs <= 5 && !view.matchOver && now >= view.introMs;
    fr.text.number(ctx, this.timerText, ox + lay.right, oy + FL_NOIR_TITLE_Y * lay.side, 0.022 * lay.side, hot ? "#f87171" : "#d4d4d8", null, "right", 1);
  }

  /**
   * The top: the weapon icons (or a show's column) and the title with the timer. Returns the title's bottom (screen y): the
   * top captions start below it.
   */
  drawTop(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, weapons: FlWeaponsPainter, shows?: FlShowsPainter): number {
    const fighters = view.fighters;
    const S = lay.side;
    this.namesDrawn = 0;
    if (fighters.length === 0) return oy;
    const showColumn = !!shows && view.show && view.show.kind !== "single" && shows.drawBandColumn(ctx, fr, view, L, lay, ox, oy);
    if (!showColumn) {
      // the weapons, large, side by side, centred over the arena (each clipped to its own box)
      const n = fighters.length;
      const step = Math.min(0.3, 0.92 / n) * S;
      const boxW = Math.min(step, 0.28 * S);
      const boxH = FL_NOIR_ICON_H * S;
      const cy = oy + FL_NOIR_ICON_Y * S;
      // a size-1 fighter's world radius drawn at 0.07 S: a weapon of 2–3 R reaches 0.14–0.21 S on the diagonal (about
      // 0.12 S tall); the held sprite starts at the ball's edge and runs forward, so its middle (about 2.1 R out) is pulled
      // back onto the icon's centre
      const k = ((n > 2 ? 0.05 : 0.07) * S) / Math.max(1e-6, lay.ballR / Math.max(1e-6, view.field?.dk || 1));
      const angle = -0.75;
      fighters.forEach((f, i) => {
        const cx = ox + S / 2 + (i - (n - 1) / 2) * step;
        const back = 2.1 * f.r * k;
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - boxW / 2, cy - boxH / 2, boxW, boxH);
        ctx.clip();
        ctx.globalAlpha = f.alive ? 1 : 0.4;
        weapons.drawPortraitWeapon(ctx, fr, f, cx - Math.cos(angle) * back, cy - Math.sin(angle) * back, k, angle);
        ctx.restore();
      });
    }
    const parts = this.titleParts(view, L);
    const s = this.titleSprite(fr, parts, S, FL_NOIR_TITLE_W * S);
    if (s) {
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.drawImage(s.canvas, ox + S / 2 + s.x0, oy + FL_NOIR_TITLE_Y * S + s.y0, s.w, s.h);
      ctx.restore();
    }
    this.namesDrawn = fighters.length;
    this.drawTimer(ctx, fr, view, lay, ox, oy);
    return oy + (FL_NOIR_TITLE_Y + FL_NOIR_TITLE_H / 2) * S;
  }

  /**
   * The stats block under the arena: a column per fighter – line 1 "THOR: 92" in its colour, line 2 "DMG: 12" (damage dealt),
   * line 3 "[NORMAL]", line 4 the ability's name with its meter – the columns parted by "|". Returns the block's top (screen y).
   */
  drawBlock(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number): number {
    const fighters = view.fighters;
    const S = lay.side;
    this.abilitiesDrawn = 0;
    this.abilityFsMin = 0;
    if (fighters.length === 0) return Infinity;
    const now = fr.now;
    const n = fighters.length;
    const left = ox + lay.left;
    const width = lay.right - lay.left;
    const colW = width / n;
    const hud = fr.pal.hud;
    const states = L.states ?? DEFAULT_FL_STATE_LABELS;
    const short = n > 2;
    const fs = FL_NOIR_LINE_FS.map((k) => k * S);
    const ys = FL_NOIR_LINE_Y.map((k) => oy + k * S);
    // the separators between the columns, every line
    const sepStyle = this.mono(hud.muted);
    for (let i = 1; i < n; i++) for (let line = 0; line < 4; line++) fr.text.draw(ctx, SEP, left + i * colW, ys[line], fs[line], sepStyle, "center", 0, 0.8);
    const pad = 0.014 * S;
    for (let i = 0; i < n; i++) {
      const f = fighters[i];
      const cx = left + (i + 0.5) * colW;
      const room = colW - 2 * pad;
      const alpha = f.alive ? 1 : 0.55;
      const color = flNameColor(f.row.body, f.row.accent);
      // line 1: the name and the HP
      const name = `${fr.text.upperOf(short ? flShortName(f.row) : f.row.name)}:`;
      const hp = Math.max(0, Math.ceil(f.hp - 1e-6));
      const hpText = NUM_TEXT[Math.min(NUM_TEXT.length - 1, hp)] ?? String(hp);
      this.labelAndNumber(ctx, fr, name, hpText, cx, ys[0], fs[0], color, room, alpha);
      // line 2: the damage dealt
      this.labelAndNumber(ctx, fr, `${fr.text.upperOf(L.damage)}:`, NUM_TEXT[Math.min(NUM_TEXT.length - 1, Math.round(f.dealt))] ?? String(Math.round(f.dealt)), cx, ys[1], fs[1], hud.statText, room, alpha);
      // line 3: the state tag
      const state = flStateOf(f, now);
      fr.text.draw(ctx, `[${fr.text.upperOf(states[state])}]`, cx, ys[2], fs[2], this.mono(STATE_COLORS[state]), "center", room, alpha);
      // line 4: the ability's name (fitted) and its meter
      const meterW = Math.min(0.09 * S, 0.3 * room);
      const telegraph = f.telegraphUntil >= 0;
      const meter = telegraph ? 1 : Math.max(0, Math.min(1, f.meter));
      const blink = telegraph && Math.floor(now / 70) % 2 === 0;
      const ready = !telegraph && f.alive && meter >= 1 && !view.matchOver;
      const nameRoom = room - meterW - 0.4 * fs[3];
      const abilityName = fr.text.upperOf(f.row.ability.name);
      const style = this.mono(blink ? f.row.accent : ready ? "#ffffff" : hud.statText);
      const tw = Math.min(nameRoom, fr.text.width(abilityName, fs[3], style));
      const x0 = cx - (tw + 0.4 * fs[3] + meterW) / 2;
      fr.text.draw(ctx, abilityName, x0, ys[3], fs[3], style, "left", nameRoom, alpha);
      const mx = x0 + tw + 0.4 * fs[3];
      const mh = Math.max(3, 0.0065 * S);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = hud.meterTrack;
      ctx.fillRect(mx, ys[3] - mh / 2, meterW, mh);
      if (meter > 0) {
        ctx.fillStyle = meter >= 1 ? (blink || Math.floor(now / 140) % 2 === 0 ? "#ffffff" : f.row.accent) : f.row.accent;
        ctx.fillRect(mx, ys[3] - mh / 2, Math.max(mh, meterW * meter), mh);
      }
      ctx.restore();
      if (ready) fr.text.draw(ctx, L.ready, mx + meterW / 2, ys[3] - mh - 0.35 * fs[3], 0.6 * fs[3], { role: "display", color: "#fde047", stroke: INK, strokeK: 0.14 }, "center", meterW, 0.75 + 0.25 * Math.sin(now / 90));
      this.abilitiesDrawn++;
      this.abilityFsMin = this.abilityFsMin === 0 ? fs[3] / S : Math.min(this.abilityFsMin, fs[3] / S);
    }
    return oy + FL_NOIR_BLOCK_TOP * S;
  }

  /** "LABEL: 123" centred at (cx, y): the label from a text sprite, the number from the digit atlas (no sprite per value). */
  private labelAndNumber(ctx: CanvasRenderingContext2D, fr: FlFrame, label: string, num: string, cx: number, y: number, fs: number, color: string, room: number, alpha: number) {
    const style = this.mono(color);
    const nw = fr.text.numberWidth(num, fs, color, null);
    const gap = 0.5 * fs;
    const lw = Math.min(Math.max(1, room - nw - gap), fr.text.width(label, fs, style));
    const total = lw + gap + nw;
    const x0 = cx - total / 2;
    fr.text.draw(ctx, label, x0, y, fs, style, "left", lw, alpha);
    fr.text.number(ctx, num, x0 + lw + gap, y, fs, color, null, "left", alpha);
  }
}
