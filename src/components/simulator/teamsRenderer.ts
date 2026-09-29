import type { PhysicsEngine } from "@/lib/physics/engine";
import { MAX_TEAMS, MULTI_BALL_MODES, emptyStats, startBallCount, type BallStats } from "@/lib/physics/ballStats";
import type { Ball } from "@/lib/physics/types";
import { rankTeams, teamDisplayName, teamResult, type TeamRenderOptions, type TeamResult } from "@/lib/teams";
import { ACCENT } from "@/lib/site";
import { nameLabelSize } from "./faceRenderer";

/**
 * Drawing of the "Team balls with scoreboard" feature (lib/teams.ts, physics/ballStats.ts), created once with
 * the canvas loop:
 *
 * - `beginFrame()` takes the options and notices a new run (the engine's stats generation);
 * - in the ball pass, `colorOf()` / `spriteOf()` give a team ball its team colour and emoji (the canvas keeps a
 *   custom ball picture and Color Match's colour to match), and `drawBallExtras()` adds a ring in the team colour
 *   where the body does not show it and the team name above the first ball of each team;
 * - `drawOverlay()`, in screen space after the HUD, draws the scoreboard in a corner of the centred square the
 *   recorder exports and, once the run has finished, the winner banner with a burst of confetti – so both are in
 *   the recording.
 *
 * Everything here is visual: it reads the engine, never writes to it, and its confetti uses Math.random.
 * Steady-state frames do not allocate: names, fonts and the scoreboard layout are rebuilt only when the options
 * or the canvas size change, the banner texts once per finished run, and the confetti lives in typed arrays.
 */

export interface TeamLabels {
  bounces: string;
  walls: string;
  escapes: string;
  /** "[name] wins!" with the name filled in. */
  wins: (name: string) => string;
  tie: string;
  /** Fallback name of team n (1-based): "Team 3". */
  team: (n: number) => string;
}

export interface CanvasTeamOptions extends TeamRenderOptions {
  labels: TeamLabels;
}

const TWO_PI = Math.PI * 2;
const CONFETTI_MAX = 180;
const GOLD = "#facc15";
const NUMBER_FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
/** Where the banner sits in the exported square: the middle, or lower when the mode shows its own banner there. */
const BANNER_Y = 0.46;
const BANNER_Y_LOW = 0.72;

/** Relative luminance (0–1) of "#rrggbb"; anything else counts as light. */
function luminance(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return 1;
  const c = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** The team colour for text on a dark background: very dark colours are lifted to white. */
function readableColor(color: string): string {
  return luminance(color) < 0.06 ? "#f4f4f5" : color;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.arcTo(x + w, y, x + w, y + rad, rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
  ctx.lineTo(x + rad, y + h);
  ctx.arcTo(x, y + h, x, y + h - rad, rad);
  ctx.lineTo(x, y + rad);
  ctx.arcTo(x, y, x + rad, y, rad);
  ctx.closePath();
}

/** Per-team texts and colours, rebuilt when the options change. */
interface TeamTexts {
  names: string[];
  /** "🔥 Red": the label of a ball whose body does not show the emoji. */
  emojiNames: string[];
  colors: string[];
  textColors: string[];
  emojis: string[];
}

/** The scoreboard's geometry and fitted names for one size (rebuilt when the options or the size change). */
interface ScoreboardLayout {
  side: number;
  count: number;
  fs: number;
  rowH: number;
  pad: number;
  width: number;
  height: number;
  margin: number;
  icon: number;
  colB: number;
  colW: number;
  colE: number;
  nameFont: string;
  headFont: string;
  numFont: string;
  emojiFont: string;
  names: string[];
}

export class TeamLayer {
  private options: CanvasTeamOptions | null = null;
  private active = false;
  /** Teams in play this run: the roster, as far as the engine started balls for it. */
  private count = 0;
  private texts: TeamTexts = { names: [], emojiNames: [], colors: [], textColors: [], emojis: [] };
  private layout: ScoreboardLayout | null = null;
  private readonly sprites = new Map<string, HTMLCanvasElement>();
  private readonly labelFonts = new Map<number, string>();
  private readonly order: number[] = [];
  private readonly numbers: string[] = [];
  /** Bit i set: team i's name was drawn this frame. */
  private labelled = 0;
  /** Team names drawn this frame (for the data attribute). */
  labelsDrawn = 0;
  /** Screen y of the scoreboard's bottom edge this frame (0 when none is drawn): the camera's REPLAY badge keeps clear of it. */
  scoreboardBottom = 0;
  // Run state: the stats generation shown, the frozen result and stats of a finished run, the banner.
  private generation = -1;
  private result: TeamResult | null = null;
  private readonly frozen: BallStats[] = Array.from({ length: MAX_TEAMS }, emptyStats);
  private bannerMs = 0;
  /** The banner (and its confetti) waits: the cinematic camera's escape replay plays first. */
  private bannerHeld = false;
  private confettiPending = false;
  private bannerTitle = "";
  private bannerSub = "";
  private bannerWidths = { side: -1, title: 0, sub: 0 };
  // Confetti pool (screen space).
  private readonly px = new Float32Array(CONFETTI_MAX);
  private readonly py = new Float32Array(CONFETTI_MAX);
  private readonly pvx = new Float32Array(CONFETTI_MAX);
  private readonly pvy = new Float32Array(CONFETTI_MAX);
  private readonly prot = new Float32Array(CONFETTI_MAX);
  private readonly pspin = new Float32Array(CONFETTI_MAX);
  private readonly plife = new Float32Array(CONFETTI_MAX);
  private readonly psize = new Float32Array(CONFETTI_MAX);
  private readonly pcolor = new Uint8Array(CONFETTI_MAX);
  private confettiColors: string[] = [];
  private confettiCount = 0;

  isActive() {
    return this.active;
  }

  /** Once per frame, before the balls. */
  beginFrame(engine: PhysicsEngine, options: CanvasTeamOptions | null | undefined) {
    const next = options ?? null;
    if (next !== this.options) {
      this.options = next;
      this.layout = null;
      this.rebuildTexts();
    }
    this.labelled = 0;
    this.labelsDrawn = 0;
    const mode = engine.getCurrentModeName();
    this.active = !!next && next.roster.length > 0 && MULTI_BALL_MODES.includes(mode);
    const count = this.active ? Math.min(next!.roster.length, startBallCount(engine.config, mode)) : 0;
    if (count !== this.count) {
      this.count = count;
      this.layout = null;
    }
    const generation = engine.getStatsGeneration();
    if (generation !== this.generation) {
      this.generation = generation;
      this.result = null;
      this.bannerMs = 0;
      this.confettiCount = 0;
      this.confettiPending = false;
    }
  }

  private rebuildTexts() {
    const o = this.options;
    const t: TeamTexts = { names: [], emojiNames: [], colors: [], textColors: [], emojis: [] };
    if (o) {
      o.roster.forEach((team, i) => {
        const name = teamDisplayName(team, i, o.labels.team);
        t.names.push(name);
        t.emojiNames.push(team.emoji ? `${team.emoji} ${name}` : name);
        t.colors.push(team.color);
        t.textColors.push(readableColor(team.color));
        t.emojis.push(team.emoji);
      });
    }
    this.texts = t;
  }

  /** The team slot a ball plays for this frame, or -1. */
  private slotOf(ball: Ball): number {
    if (!this.active || ball.team === undefined || ball.team < 0 || ball.team >= this.count) return -1;
    return ball.team;
  }

  /** The team colour of a ball (null when it plays for no team). */
  colorOf(ball: Ball): string | null {
    const slot = this.slotOf(ball);
    return slot >= 0 ? this.texts.colors[slot] : null;
  }

  /** The team's emoji as a sprite (null without a team or an emoji). */
  spriteOf(ball: Ball): HTMLCanvasElement | null {
    const slot = this.slotOf(ball);
    const emoji = slot >= 0 ? this.texts.emojis[slot] : "";
    if (!emoji) return null;
    let sprite = this.sprites.get(emoji);
    if (!sprite) {
      sprite = document.createElement("canvas");
      sprite.width = 128;
      sprite.height = 128;
      const g = sprite.getContext("2d");
      if (g) {
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.font = "172.8px serif";
        g.fillText(emoji, 64, 74.24);
      }
      if (this.sprites.size > 64) this.sprites.clear();
      this.sprites.set(emoji, sprite);
    }
    return sprite;
  }

  /**
   * After a team ball's body: a ring in the team colour when the body does not wear it (an emoji, a picture or
   * Color Match's colour), and the team name above the first ball of each team – with the emoji in front when the
   * body does not show it.
   */
  drawBallExtras(ctx: CanvasRenderingContext2D, ball: Ball, bodyShowsColor: boolean, bodyShowsEmoji: boolean) {
    const slot = this.slotOf(ball);
    if (slot < 0) return;
    const color = this.texts.colors[slot];
    if (!bodyShowsColor) {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1.5, 0.18 * ball.radius);
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, ball.radius + 0.5 * ctx.lineWidth + 1, 0, TWO_PI);
      ctx.stroke();
      ctx.restore();
    }
    const bit = 1 << slot;
    if (!this.options!.showNames || this.labelled & bit) return;
    this.labelled |= bit;
    this.labelsDrawn++;
    const text = bodyShowsEmoji ? this.texts.names[slot] : this.texts.emojiNames[slot];
    const fs = Math.round(nameLabelSize(ball.radius));
    let font = this.labelFonts.get(fs);
    if (!font) {
      font = `700 ${fs}px sans-serif`;
      this.labelFonts.set(fs, font);
    }
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineJoin = "round";
    const ty = ball.y - ball.radius - 0.35 * fs - 2;
    ctx.lineWidth = Math.max(2, 0.24 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.7)";
    ctx.strokeText(text, ball.x, ty);
    ctx.fillStyle = this.texts.textColors[slot];
    ctx.fillText(text, ball.x, ty);
    ctx.restore();
  }

  /**
   * Screen space, after the HUD: the scoreboard and – once the run has finished – the winner banner and its
   * confetti. The scoreboard sits in a corner of the centred square the recorder exports; `dtMs` advances the
   * banner and the confetti (0 while paused); `inset` moves the scoreboard below the page's overlay buttons;
   * `modeBanner` (the mode shows its own banner in the middle) moves the winner banner lower; `holdBanner`
   * (the cinematic camera's escape replay is on) keeps the banner and its confetti back – the result is still
   * frozen when the run ends – until the replay is over.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, engine: PhysicsEngine, view: { width: number; height: number; dtMs: number; inset: number; modeBanner: boolean; holdBanner?: boolean }) {
    this.scoreboardBottom = 0;
    if (!this.active) return;
    const o = this.options!;
    const side = Math.min(view.width, view.height);
    const sx = (view.width - side) / 2;
    const sy = (view.height - side) / 2;
    const finished = engine.isSimulationFinished();
    const bannerY = sy + side * (view.modeBanner ? BANNER_Y_LOW : BANNER_Y);
    if (finished && !this.result) {
      // The run is over: freeze its stats (balls still flying do not change the verdict) and celebrate.
      const live = engine.getTeamStats();
      for (let i = 0; i < MAX_TEAMS; i++) Object.assign(this.frozen[i], live[i]);
      this.result = teamResult(this.frozen, this.count);
      this.bannerMs = 0;
      this.makeBannerTexts();
      this.confettiPending = this.result.winner >= 0;
    } else if (!finished && this.result) {
      this.result = null;
      this.confettiCount = 0;
      this.confettiPending = false;
    }
    this.bannerHeld = !!view.holdBanner;
    if (this.confettiPending && !this.bannerHeld) {
      this.confettiPending = false;
      this.spawnConfetti(sx, sy, side, bannerY);
    }
    const stats = this.result ? this.frozen : engine.getTeamStats();
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (o.showScoreboard && this.count > 0) this.drawScoreboard(ctx, stats, sx, sy + view.inset, side);
    if (this.result && this.result.winner >= 0 && !this.bannerHeld) {
      this.bannerMs += view.dtMs;
      this.drawBanner(ctx, sx + side / 2, bannerY, side);
    }
    this.stepConfetti(ctx, view.dtMs / 1000, side);
    ctx.restore();
  }

  /** Per-team "bounces/walls/escapes" joined by commas, for the canvas data attribute. */
  statsText(engine: PhysicsEngine): string {
    const stats = this.result ? this.frozen : engine.getTeamStats();
    let out = "";
    for (let i = 0; i < this.count; i++) out += `${i > 0 ? "," : ""}${stats[i].bounces}/${stats[i].walls}/${stats[i].escapes}`;
    return out;
  }

  /** The winner's name, "tie", or "" while the run goes on (or its banner waits for the escape replay). */
  winnerText(): string {
    const r = this.result;
    if (!r || r.winner < 0 || this.bannerHeld) return "";
    return r.tie ? "tie" : this.texts.names[r.winner];
  }

  teamsInPlay() {
    return this.count;
  }

  /* ------------------------------------------------------------------ scoreboard */

  private scoreboardLayout(ctx: CanvasRenderingContext2D, side: number): ScoreboardLayout {
    const cached = this.layout;
    if (cached && cached.side === side && cached.count === this.count) return cached;
    const L = this.options!.labels;
    const fs = Math.max(10, Math.round(0.028 * side));
    const nameFont = `700 ${fs}px sans-serif`;
    const headFont = `600 ${Math.max(8, Math.round(0.72 * fs))}px sans-serif`;
    const numFont = `700 ${fs}px ${NUMBER_FONT}`;
    const emojiFont = `400 ${Math.round(0.95 * fs)}px serif`;
    const measure = (font: string, text: string) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    };
    const nameMax = 7.5 * fs;
    const names = this.texts.names.slice(0, this.count).map((name) => {
      if (measure(nameFont, name) <= nameMax) return name;
      const chars = Array.from(name);
      while (chars.length > 1 && measure(nameFont, `${chars.join("")}…`) > nameMax) chars.pop();
      return `${chars.join("")}…`;
    });
    const nameW = Math.max(0, ...names.map((n) => measure(nameFont, n)));
    const digits = measure(numFont, "000");
    const colB = Math.max(digits, measure(headFont, L.bounces)) + 0.9 * fs;
    const colW = Math.max(digits, measure(headFont, L.walls)) + 0.9 * fs;
    const colE = Math.max(digits, measure(headFont, L.escapes)) + 0.9 * fs;
    const pad = Math.round(0.6 * fs);
    const rowH = Math.round(1.6 * fs);
    const icon = 1.2 * fs;
    const layout: ScoreboardLayout = {
      side,
      count: this.count,
      fs,
      rowH,
      pad,
      width: Math.ceil(pad + icon + 0.4 * fs + nameW + colB + colW + colE + pad),
      height: Math.ceil(0.8 * pad + rowH * (this.count + 1)),
      margin: Math.round(0.03 * side),
      icon,
      colB,
      colW,
      colE,
      nameFont,
      headFont,
      numFont,
      emojiFont,
      names,
    };
    this.layout = layout;
    return layout;
  }

  private drawScoreboard(ctx: CanvasRenderingContext2D, stats: readonly Readonly<BallStats>[], sx: number, sy: number, side: number) {
    const o = this.options!;
    const L = o.labels;
    const lay = this.scoreboardLayout(ctx, side);
    const { fs, rowH, pad, width, height, icon } = lay;
    const order = rankTeams(stats, this.count, this.order);
    const x0 = o.position === "top-right" ? sx + side - lay.margin - width : sx + lay.margin;
    const y0 = sy + lay.margin;
    this.scoreboardBottom = y0 + height;
    ctx.fillStyle = "rgba(9, 9, 11, 0.66)";
    roundRect(ctx, x0, y0, width, height, 0.55 * fs);
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
    ctx.lineWidth = 1;
    ctx.stroke();
    // Header: the three counts, right-aligned over their columns.
    const xE = x0 + width - pad;
    const xW = xE - lay.colE;
    const xB = xW - lay.colW;
    const headY = y0 + 0.4 * pad + 0.5 * rowH;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.font = lay.headFont;
    ctx.fillStyle = "#a1a1aa";
    ctx.fillText(L.bounces, xB, headY);
    ctx.fillText(L.walls, xW, headY);
    ctx.fillText(L.escapes, xE, headY);
    // Rows in ranking order, the leader highlighted in its colour once it has scored.
    for (let r = 0; r < order.length; r++) {
      const i = order[r];
      const s = stats[i];
      const rowTop = y0 + 0.4 * pad + rowH * (r + 1);
      const y = rowTop + 0.5 * rowH;
      if (r === 0 && (s.bounces > 0 || s.walls > 0 || s.escapes > 0)) {
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = this.texts.colors[i];
        roundRect(ctx, x0 + 0.25 * pad, rowTop + 0.08 * rowH, width - 0.5 * pad, 0.84 * rowH, 0.35 * fs);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      const iconX = x0 + pad + 0.5 * icon;
      const emoji = this.texts.emojis[i];
      if (emoji) {
        ctx.font = lay.emojiFont;
        ctx.textAlign = "center";
        ctx.fillStyle = "#ffffff";
        ctx.fillText(emoji, iconX, y + 0.06 * fs);
      } else {
        ctx.fillStyle = this.texts.colors[i];
        ctx.beginPath();
        ctx.arc(iconX, y, 0.36 * fs, 0, TWO_PI);
        ctx.fill();
      }
      ctx.font = lay.nameFont;
      ctx.textAlign = "left";
      ctx.fillStyle = this.texts.textColors[i];
      ctx.fillText(lay.names[i], x0 + pad + icon + 0.4 * fs, y);
      ctx.font = lay.numFont;
      ctx.textAlign = "right";
      ctx.fillStyle = "#f4f4f5";
      ctx.fillText(this.number(s.bounces), xB, y);
      ctx.fillText(this.number(s.walls), xW, y);
      ctx.fillStyle = s.escapes > 0 ? ACCENT : "#f4f4f5";
      ctx.fillText(this.number(s.escapes), xE, y);
    }
  }

  /* ------------------------------------------------------------------ banner */

  private makeBannerTexts() {
    const r = this.result!;
    const L = this.options!.labels;
    this.bannerWidths.side = -1;
    if (r.winner < 0) {
      this.bannerTitle = "";
      this.bannerSub = "";
      return;
    }
    if (r.tie) {
      this.bannerTitle = `🏆 ${L.tie}`;
      this.bannerSub = r.leaders.map((i) => this.texts.emojiNames[i]).join(" · ");
      return;
    }
    const emoji = this.texts.emojis[r.winner];
    this.bannerTitle = `🏆 ${emoji ? `${emoji} ` : ""}${L.wins(this.texts.names[r.winner])}`;
    const s = this.frozen[r.winner];
    this.bannerSub = `${L.escapes} ${s.escapes} · ${L.walls} ${s.walls} · ${L.bounces} ${s.bounces}`;
  }

  private drawBanner(ctx: CanvasRenderingContext2D, cx: number, cy: number, side: number) {
    const r = this.result!;
    const color = r.tie ? ACCENT : this.texts.colors[r.winner];
    const t = Math.min(1, this.bannerMs / 450);
    // Ease out with a little overshoot, so the banner pops in.
    const c1 = 1.70158;
    const scale = Math.max(0.01, 1 + (c1 + 1) * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2));
    const fs = Math.max(18, Math.round(0.07 * side));
    const sfs = Math.max(10, Math.round(0.36 * fs));
    const titleFont = `800 ${fs}px sans-serif`;
    const subFont = `600 ${sfs}px sans-serif`;
    const widths = this.bannerWidths;
    if (widths.side !== side) {
      widths.side = side;
      ctx.font = titleFont;
      widths.title = ctx.measureText(this.bannerTitle).width;
      ctx.font = subFont;
      widths.sub = ctx.measureText(this.bannerSub).width;
    }
    const maxText = 0.94 * side - 1.2 * fs;
    const w = Math.min(0.94 * side, Math.max(widths.title, widths.sub) + 1.4 * fs);
    const h = 1.35 * fs + 1.5 * sfs;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.bannerMs / 180);
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.fillStyle = "rgba(9, 9, 11, 0.82)";
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.5 * fs;
    roundRect(ctx, -w / 2, -h / 2, w, h, 0.4 * fs);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = Math.max(2, 0.06 * fs);
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = titleFont;
    ctx.fillStyle = r.tie ? "#ffffff" : this.texts.textColors[r.winner];
    ctx.shadowColor = color;
    ctx.shadowBlur = 0.35 * fs;
    ctx.fillText(this.bannerTitle, 0, -h / 2 + 0.7 * fs, maxText);
    ctx.shadowBlur = 0;
    ctx.font = subFont;
    ctx.fillStyle = "#d4d4d8";
    ctx.fillText(this.bannerSub, 0, h / 2 - 0.95 * sfs, maxText);
    ctx.restore();
  }

  /* ------------------------------------------------------------------ confetti */

  private spawnConfetti(sx: number, sy: number, side: number, bannerY: number) {
    const o = this.options!;
    const r = this.result!;
    const colors: string[] = [];
    for (const i of r.leaders) if (o.roster[i]) colors.push(o.roster[i].color, o.roster[i].color);
    colors.push(GOLD, "#ffffff", ACCENT);
    this.confettiColors = colors;
    this.confettiCount = CONFETTI_MAX;
    for (let i = 0; i < CONFETTI_MAX; i++) {
      if (i < 60) {
        // A burst out of the banner…
        const a = Math.random() * TWO_PI;
        const speed = side * (0.35 + 0.6 * Math.random());
        this.px[i] = sx + side / 2;
        this.py[i] = bannerY;
        this.pvx[i] = Math.cos(a) * speed;
        this.pvy[i] = Math.sin(a) * speed - 0.3 * side;
      } else {
        // …and a shower from the top edge.
        this.px[i] = sx + Math.random() * side;
        this.py[i] = sy - Math.random() * 0.25 * side;
        this.pvx[i] = (Math.random() - 0.5) * 0.3 * side;
        this.pvy[i] = (0.05 + 0.25 * Math.random()) * side;
      }
      this.prot[i] = Math.random() * TWO_PI;
      this.pspin[i] = (Math.random() - 0.5) * 14;
      this.plife[i] = 2.2 + 1.8 * Math.random();
      this.psize[i] = side * (0.008 + 0.01 * Math.random());
      this.pcolor[i] = Math.floor(Math.random() * colors.length);
    }
  }

  private stepConfetti(ctx: CanvasRenderingContext2D, dt: number, side: number) {
    if (this.confettiCount === 0) return;
    const g = 0.9 * side;
    let alive = 0;
    for (let i = 0; i < this.confettiCount; i++) {
      if (this.plife[i] <= 0) continue;
      if (dt > 0) {
        this.pvy[i] += g * dt;
        this.pvx[i] *= 1 - Math.min(1, 0.8 * dt);
        this.pvy[i] *= 1 - Math.min(1, 0.6 * dt);
        this.px[i] += this.pvx[i] * dt;
        this.py[i] += this.pvy[i] * dt;
        this.prot[i] += this.pspin[i] * dt;
        this.plife[i] -= dt;
        if (this.plife[i] <= 0) continue;
      }
      alive++;
      const s = this.psize[i];
      ctx.save();
      ctx.translate(this.px[i], this.py[i]);
      ctx.rotate(this.prot[i]);
      ctx.globalAlpha = Math.min(1, this.plife[i] / 0.6);
      ctx.fillStyle = this.confettiColors[this.pcolor[i]] ?? GOLD;
      ctx.fillRect(-s / 2, -s / 4, s, s / 2);
      ctx.restore();
    }
    if (alive === 0) this.confettiCount = 0;
  }

  private number(n: number): string {
    if (n < 1000) return (this.numbers[n] ??= String(n));
    return String(n);
  }
}
