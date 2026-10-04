import type { PhysicsEngine } from "@/lib/physics/engine";
import { MAX_TEAMS, MULTI_BALL_MODES, emptyStats, startBallCount, type BallStats } from "@/lib/physics/ballStats";
import type { Ball } from "@/lib/physics/types";
import { rankTeams, teamDisplayName, teamResult, type TeamRenderOptions, type TeamResult } from "@/lib/teams";
import { ACCENT } from "@/lib/site";
import { nameLabelSize } from "./faceRenderer";
import { SB_PALETTE, sbHudShown, stringBattleBallName } from "@/lib/physics/modes/stringBattle"; // --- odd-string-battle ---
import { TY_PALETTE, type TerritoryView } from "@/lib/physics/modes/territory"; // --- odd-territory ---
import { MZ_PALETTE, mazeBallName } from "@/lib/physics/modes/maze"; // --- odd-maze ---
import type { FightLeagueView } from "@/lib/physics/modes/fightLeague"; // --- fight-league ---
import { lcPaletteColor, lcPaletteName, type LandClaimView } from "@/lib/physics/modes/landClaim"; // --- land-claim ---

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
  /** --- review fix (modes-gerald-odd) --- the String Battle's words for its "walls" and "escapes" columns: its kills and its win. */
  kills: string;
  win: string;
  /** --- odd-territory --- Territory's word for its "walls" column: the tiles a team holds (its "escapes" column is the win). */
  tiles?: string;
  /** --- land-claim --- Land Claim's word for its "walls" column: the blocks a competitor holds (its "escapes" column is the win). */
  blocks?: string;
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
  // --- odd-string-battle --- the roster as the String Battle plays it (padded to its balls), rebuilt when an input changes
  private battleSource: CanvasTeamOptions | null = null;
  private battleKey = "";
  private battleOptions: CanvasTeamOptions | null = null;
  // --- odd-territory --- the roster as Territory plays it (padded to its teams), rebuilt when an input changes
  private territorySource: CanvasTeamOptions | null = null;
  private territoryKey = "";
  private territoryOptions: CanvasTeamOptions | null = null;
  /** The battle this frame (null in any other mode): its live tile counts fill the scoreboard's tiles column. */
  private territory: TerritoryView | null = null;
  private readonly territoryLive: BallStats[] = Array.from({ length: MAX_TEAMS }, emptyStats);
  /** --- review fix (modes-gerald-odd) --- the roster plays a String Battle: its kills and its win head the scoreboard and fill the banner. */
  private battle = false;
  // --- odd-maze --- the roster as the Maze plays it (padded to its first six balls), rebuilt when an input changes
  private mazeSource: CanvasTeamOptions | null = null;
  private mazeKey = "";
  private mazeOptions: CanvasTeamOptions | null = null;
  // --- fight-league --- the roster as Fight League's 2v2 plays it (its first two teams), rebuilt when an input changes
  private fightSource: CanvasTeamOptions | null = null;
  private fightOptions: CanvasTeamOptions | null = null;
  /** The fight this frame (null in any other mode, or not a 2v2): the banner's line names the winning fighters. */
  private fight: FightLeagueView | null = null;
  // --- land-claim --- the roster as Land Claim plays it (padded to its first six competitors), rebuilt when an input changes
  private landClaimSource: CanvasTeamOptions | null = null;
  private landClaimKey = "";
  private landClaimOptions: CanvasTeamOptions | null = null;
  /** The battle this frame (null in any other mode): its live land fills the scoreboard's blocks column. */
  private landClaim: LandClaimView | null = null;
  private readonly landClaimLive: BallStats[] = Array.from({ length: MAX_TEAMS }, emptyStats);

  isActive() {
    return this.active;
  }

  /**
   * --- gerald-multipliers --- Writes into `out` the screen rectangle the scoreboard takes this frame on a canvas of
   * `width` × `height` with the live `inset` – where `drawOverlay()` will draw it – and returns true; false (and `out`
   * untouched) when no scoreboard is drawn. An overlay drawn before it, the multipliers HUD, keeps clear of it. Call
   * after `beginFrame()`; allocation-free (the layout is cached).
   */
  scoreboardRect(ctx: CanvasRenderingContext2D, width: number, height: number, inset: number, out: { x: number; y: number; w: number; h: number }): boolean {
    const o = this.options;
    if (!this.active || !o || !o.showScoreboard || this.count <= 0) return false;
    const side = Math.min(width, height);
    const lay = this.scoreboardLayout(ctx, side);
    const sx = (width - side) / 2;
    out.x = o.position === "top-right" ? sx + side - lay.margin - lay.width : sx + lay.margin;
    out.y = (height - side) / 2 + inset + lay.margin;
    out.w = lay.width;
    out.h = lay.height;
    return true;
  }

  /** Once per frame, before the balls. */
  beginFrame(engine: PhysicsEngine, options: CanvasTeamOptions | null | undefined) {
    let next = options ?? null;
    // --- odd-string-battle --- the String Battle plays the roster too: one team per ball – the palette's names and colours for
    // balls beyond the roster – and its WEB DOMINION HUD takes the scoreboard's place (its winner banner is this layer's)
    const battle = next && next.roster.length > 0 && engine.isStringBattleMode() ? engine.getStringBattleView() : null;
    if (battle && next) next = this.battleTeams(next, battle.count, sbHudShown(battle.settings));
    // --- end odd-string-battle ---
    // --- odd-territory --- Territory plays the roster too: one team per region – the palette's names and colours beyond the
    // roster – and its HUD takes the scoreboard's place (its winner banner is this layer's)
    const territory = !battle && next && next.roster.length > 0 && engine.isTerritoryMode() ? engine.getTerritoryView() : null;
    if (territory && next) next = this.territoryTeams(next, territory.teams, territory.settings.hud);
    this.territory = territory;
    // --- odd-maze --- the Maze plays the roster too: one team per ball (its first six), the maze palette beyond the roster; its
    // distance HUD takes the scoreboard's place (its winner banner at the end of the run is this layer's)
    const maze = next && next.roster.length > 0 && engine.isMazeMode() ? engine.getMazeView() : null;
    if (maze && next) next = this.mazeTeams(next, maze.teamCount, maze.settings.hud);
    // --- end odd-maze ---
    // --- fight-league --- Fight League's 2v2 plays the roster: its two teams take the roster's first two names and colours (the
    // mode's HUD takes the scoreboard's and the names' place); the winner banner is this layer's, its line the winners' names
    const fight = !battle && !territory && !maze && next && next.roster.length > 0 && engine.isFightLeagueMode() && engine.getFightLeagueView().match === "2v2" ? engine.getFightLeagueView() : null;
    if (fight && next) next = this.fightTeams(next);
    this.fight = fight;
    // --- end fight-league ---
    // --- land-claim --- Land Claim plays the roster too: one team per competitor (its first six), its palette beyond the roster;
    // its HUD takes the scoreboard's place and its land fills the blocks column (its winner banner is this layer's)
    const landClaim = !battle && !territory && !maze && next && next.roster.length > 0 && engine.isLandClaimMode() ? engine.getLandClaimView() : null;
    if (landClaim && next) next = this.landClaimTeams(next, Math.min(landClaim.teams, MAX_TEAMS), landClaim.settings.hud);
    this.landClaim = landClaim;
    // --- end land-claim ---
    if (next !== this.options) {
      this.options = next;
      this.layout = null;
      this.rebuildTexts();
    }
    // --- review fix (modes-gerald-odd) --- the battle's own column headers and banner words: measured and written again when it changes
    if (!!battle !== this.battle) {
      this.battle = !!battle;
      this.layout = null;
      if (this.result && this.options) this.makeBannerTexts();
    }
    this.labelled = 0;
    this.labelsDrawn = 0;
    const mode = engine.getCurrentModeName();
    this.active = !!next && next.roster.length > 0 && (MULTI_BALL_MODES.includes(mode) || !!battle || !!territory || !!maze || !!fight || !!landClaim); // --- odd-string-battle --- (battle) --- odd-territory --- (territory) --- odd-maze --- (maze) --- fight-league --- (fight) --- land-claim --- (landClaim)
    const count = this.active ? Math.min(next!.roster.length, battle ? battle.count : territory ? territory.teams : maze ? maze.teamCount : fight ? 2 : landClaim ? Math.min(landClaim.teams, MAX_TEAMS) /* --- land-claim --- */ : startBallCount(engine.config, mode)) : 0;
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

  // --- odd-string-battle ---
  /** The roster padded to `count` teams with the String Battle's palette, the scoreboard off while its HUD shows (the same object while nothing changed). */
  private battleTeams(options: CanvasTeamOptions, count: number, hud: boolean): CanvasTeamOptions {
    const key = `${count}|${hud ? 1 : 0}`;
    if (this.battleOptions && this.battleSource === options && this.battleKey === key) return this.battleOptions;
    const roster = options.roster.slice(0, count).map((t) => ({ ...t }));
    for (let i = roster.length; i < count; i++) roster.push({ name: stringBattleBallName(i), color: SB_PALETTE[i % SB_PALETTE.length].color, emoji: "" });
    this.battleSource = options;
    this.battleKey = key;
    this.battleOptions = { ...options, roster, showScoreboard: options.showScoreboard && !hud };
    return this.battleOptions;
  }
  // --- end odd-string-battle ---
  // --- odd-territory ---
  /**
   * The roster padded to `count` teams with Territory's palette, the scoreboard off while its HUD shows, and the columns
   * and banner line named for the battle – its tiles in the "walls" column, its win in the "escapes" one (the same object
   * while nothing changed).
   */
  private territoryTeams(options: CanvasTeamOptions, count: number, hud: boolean): CanvasTeamOptions {
    const key = `${count}|${hud ? 1 : 0}`;
    if (this.territoryOptions && this.territorySource === options && this.territoryKey === key) return this.territoryOptions;
    const roster = options.roster.slice(0, count).map((t) => ({ ...t }));
    for (let i = roster.length; i < count; i++) roster.push({ name: TY_PALETTE[i % TY_PALETTE.length].name, color: TY_PALETTE[i % TY_PALETTE.length].color, emoji: "" });
    this.territorySource = options;
    this.territoryKey = key;
    const labels = { ...options.labels, walls: options.labels.tiles ?? options.labels.walls, escapes: options.labels.win };
    this.territoryOptions = { ...options, roster, labels, showScoreboard: options.showScoreboard && !hud };
    return this.territoryOptions;
  }
  /** Territory's team stats with the tiles each team holds right now in the "walls" (tiles) column; null in any other mode. */
  private territoryStats(engine: PhysicsEngine): readonly BallStats[] | null {
    const view = this.territory;
    if (!view) return null;
    const live = engine.getTeamStats();
    for (let i = 0; i < MAX_TEAMS; i++) {
      Object.assign(this.territoryLive[i], live[i]);
      if (i < view.teams) this.territoryLive[i].walls = view.counts[i];
    }
    return this.territoryLive;
  }
  // --- end odd-territory ---
  // --- odd-maze ---
  /** The roster padded to `count` teams with the Maze's palette, the scoreboard off while its HUD shows (the same object while nothing changed). */
  private mazeTeams(options: CanvasTeamOptions, count: number, hud: boolean): CanvasTeamOptions {
    const key = `${count}|${hud ? 1 : 0}`;
    if (this.mazeOptions && this.mazeSource === options && this.mazeKey === key) return this.mazeOptions;
    const roster = options.roster.slice(0, count).map((t) => ({ ...t }));
    for (let i = roster.length; i < count; i++) roster.push({ name: mazeBallName(i), color: MZ_PALETTE[i % MZ_PALETTE.length].color, emoji: "" });
    this.mazeSource = options;
    this.mazeKey = key;
    this.mazeOptions = { ...options, roster, showScoreboard: options.showScoreboard && !hud };
    return this.mazeOptions;
  }
  // --- end odd-maze ---
  // --- fight-league ---
  /** The roster's first two teams (padded with the built-in pair), no scoreboard and no names over the balls: the HUD has them. */
  private fightTeams(options: CanvasTeamOptions): CanvasTeamOptions {
    if (this.fightOptions && this.fightSource === options) return this.fightOptions;
    const roster = options.roster.slice(0, 2).map((t) => ({ ...t }));
    for (let i = roster.length; i < 2; i++) roster.push({ name: "", color: i === 0 ? "#f43f5e" : "#38bdf8", emoji: "" });
    this.fightSource = options;
    this.fightOptions = { ...options, roster, showScoreboard: false, showNames: false };
    return this.fightOptions;
  }
  // --- end fight-league ---
  // --- land-claim ---
  /**
   * The roster padded to `count` competitors with Land Claim's palette, the scoreboard off while its HUD shows, and the
   * columns and banner line named for the battle – its land in the "walls" column, its win in the "escapes" one (the same
   * object while nothing changed).
   */
  private landClaimTeams(options: CanvasTeamOptions, count: number, hud: boolean): CanvasTeamOptions {
    const key = `${count}|${hud ? 1 : 0}`;
    if (this.landClaimOptions && this.landClaimSource === options && this.landClaimKey === key) return this.landClaimOptions;
    const roster = options.roster.slice(0, count).map((t) => ({ ...t }));
    for (let i = roster.length; i < count; i++) roster.push({ name: lcPaletteName(i) || options.labels.team(i + 1), color: lcPaletteColor(i), emoji: "" });
    this.landClaimSource = options;
    this.landClaimKey = key;
    const labels = { ...options.labels, walls: options.labels.blocks ?? options.labels.walls, escapes: options.labels.win };
    this.landClaimOptions = { ...options, roster, labels, showScoreboard: options.showScoreboard && !hud };
    return this.landClaimOptions;
  }
  /** Land Claim's team stats with the land each competitor holds right now in the "walls" (blocks) column; null in any other mode. */
  private landClaimStats(engine: PhysicsEngine): readonly BallStats[] | null {
    const view = this.landClaim;
    if (!view) return null;
    const live = engine.getTeamStats();
    for (let i = 0; i < MAX_TEAMS; i++) {
      Object.assign(this.landClaimLive[i], live[i]);
      if (i < view.teams) this.landClaimLive[i].walls = view.land[i];
    }
    return this.landClaimLive;
  }
  // --- end land-claim ---

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
      // --- odd-maze --- a maze race won by a ball past the six teams (its seventh or eighth ball) has no team winner: the maze's banner stays
      if (engine.isMazeMode() && engine.getMazeView().winner >= this.count) this.result = { winner: -1, tie: false, leaders: [] };
      // --- fight-league --- a fight without a winner (a double KO, a draw at the time cap): the fight's own banner says it
      if (this.fight && this.fight.winnerTeam < 0) this.result = { winner: -1, tie: false, leaders: [] };
      // --- land-claim --- the verdict names the winner (the most land; on a level top the rig's pick, then more balls): no team
      // winner without land or past the six teams (Land Claim's own banner names it then)
      if (this.landClaim) {
        const w = this.landClaim.verdict.winner;
        this.result = w >= 0 && w < this.count ? { winner: w, tie: false, leaders: [w] } : { winner: -1, tie: false, leaders: [] };
      }
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
    const stats = this.result ? this.frozen : (this.territoryStats(engine) ?? this.landClaimStats(engine) ?? engine.getTeamStats()); // --- odd-territory --- (the live tiles) --- land-claim --- (the live land)
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

  /**
   * Per-team first escape in seconds of simulation time (-1 without one) joined by commas, for the canvas data attribute:
   * who got out first, whatever flies out once the run is over (a tool reading the stats a moment later still sees the order).
   */
  firstEscapesText(engine: PhysicsEngine): string {
    const stats = this.result ? this.frozen : engine.getTeamStats();
    let out = "";
    for (let i = 0; i < this.count; i++) out += `${i > 0 ? "," : ""}${stats[i].firstEscapeMs >= 0 ? (stats[i].firstEscapeMs / 1000).toFixed(2) : "-1"}`;
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
    const colW = Math.max(digits, measure(headFont, this.battle ? L.kills : L.walls)) + 0.9 * fs; // --- review fix (modes-gerald-odd) --- (the battle's kills and win)
    const colE = Math.max(digits, measure(headFont, this.battle ? L.win : L.escapes)) + 0.9 * fs;
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
    ctx.fillText(this.battle ? L.kills : L.walls, xW, headY); // --- review fix (modes-gerald-odd) --- (the battle's kills and win)
    ctx.fillText(this.battle ? L.win : L.escapes, xE, headY);
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
    // --- review fix (modes-gerald-odd) --- a String Battle counts kills (its "walls"); nothing escaped
    this.bannerSub = this.battle ? `${L.kills} ${s.walls} · ${L.bounces} ${s.bounces}` : `${L.escapes} ${s.escapes} · ${L.walls} ${s.walls} · ${L.bounces} ${s.bounces}`;
    // --- fight-league --- a fight's winners by name ("Naruto + Sasuke")
    if (this.fight) this.bannerSub = this.fight.fighters.filter((f) => f.team === r.winner).map((f) => f.row.name).join(" + ");
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
