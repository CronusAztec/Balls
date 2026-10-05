import {
  EV_CAST,
  EV_HIT,
  EV_IMPACT,
  EV_KO,
  EV_SHOCK,
  EV_SLAM,
  FB_CLUTCH,
  FB_PERFECT,
  FL_BANNER_CAP,
  FL_EVENT_CAP,
  type FightLeagueView,
  type FlFighter,
} from "@/lib/physics/modes/fightLeague";
import { FL_MAX_SLOTS, FL_SHAKES, flEffectNow, flImpactBlend, flHudLayout, flShakeAt, flShakeStrength, flNameColor, type FlHudLayout } from "@/lib/physics/modes/fightLeagueFx";
import { FL_DIVISION_LABELS, type FlDivision } from "@/lib/physics/modes/fightLeagueRoster";
import type { Ball } from "@/lib/physics/types";
import type { RecordingCrop } from "@/lib/recording/recorder";
import { FlBodiesPainter } from "./fightLeague/bodies";
import { FlCardsPainter } from "./fightLeague/cards";
import { drawDebug } from "./fightLeague/debug";
import { FlFrame, type FightLeagueLabels, type FightLeagueRenderOptions } from "./fightLeague/frame";
import { FlFxPainter } from "./fightLeague/fx";
import { FlHudPainter } from "./fightLeague/hud";
import { arenaLook, matchDivision, stagePalette } from "./fightLeague/palette";
import { drawPlates } from "./fightLeague/plates";
import { FlProjectilesPainter } from "./fightLeague/projectiles";
import { FlStagePainter } from "./fightLeague/stage";
import { TWO_PI } from "./fightLeague/sprites";
import { flFontsReady } from "./fightLeague/text";
import { FlWeaponsPainter } from "./fightLeague/weapons";

/**
 * Canvas drawing of Fight League (feature fight-league, see lib/physics/modes/fightLeague.ts) – --- fl-overhaul --- (Stage 3)
 * the facade of the renderer in components/simulator/fightLeague/ (palette, text, stage, bodies, weapons, projectiles, fx,
 * hud, cards, plates, debug). Created once with the canvas loop:
 *
 * - `drawBackdrop()` (screen space, right after the background and the theme painter): the stage – lilac by default, night, or
 *   nothing on the theme stage;
 * - `applyWorld()` (after the camera): the mode's own screen shake and the display scale of the field (the physics field
 *   keeps its size and place – the replays hold – and is drawn at FL_ARENA_FRAC under the names band of FL_ARENA_TOP);
 * - `drawStage()` (inside the world transform, under everything): the pre-rendered arena plate, the slow-time veil, the
 *   decals, the rim flashes;
 * - `drawBodies()` (in place of the balls, clipped to the arena; the KO finale's push-in): the telegraph previews, fire
 *   rings, strikes, beams, minions, walls, the knockback ribbons, every fighter's weapons, bodies and statuses, shields,
 *   projectiles, the KO ghosts and the finale's speed lines and spotlight – then over the rim the HP bars and numbers, the
 *   name tags, the event ring's effects and callouts (and the hit shapes with flDbg=1);
 * - `drawOverlay()` (screen space, after the HUD, part of the recording): the names band, the timer and the lead bar, the
 *   ability boxes, the VS card, the super flash, the centre banners, the KO flash and the verdict's card;
 * - `paintExportBackdrop()` (the recorder's background hook): the stage in the export's letterbox bars and the 9:16 plates.
 *
 * Every pixel is a function of the view, its simulation clock and the options: the effects run on the effects' clock (the
 * finale's warp), randomness only through the analytic hash, no wall clock.
 */

export type { FightLeagueLabels, FightLeagueRenderOptions };
export { flNameColor };

const cap = (s: string) => (s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s);

export const DEFAULT_FIGHT_LEAGUE_LABELS: FightLeagueLabels = {
  vs: "VS",
  fight: "FIGHT!",
  ko: "KO!",
  doubleKo: "DOUBLE KO!",
  wins: (name) => `${name} wins!`,
  winTeam: (names) => `${names} win!`,
  draw: "DRAW!",
  time: "TIME!",
  winSub: (hp, hits) => `${hp} HP left · ${hits} hit${hits === 1 ? "" : "s"}`,
  speed: "SPD",
  damage: "DMG",
  attack: "ATK",
  cast: "CAST",
  ready: "READY",
  sudden: "SUDDEN DEATH!",
  // --- fl-overhaul --- (Stage 3)
  firstBlood: "FIRST BLOOD!",
  perfect: "PERFECT!",
  clutch: "CLUTCH!",
  blocked: "BLOCK",
  dodge: "DODGE!",
  immune: "IMMUNE",
  interrupted: "INTERRUPTED!",
  clash: "CLASH!",
  combo: (n) => `${n} HITS`,
  suddenDeath: "SUDDEN DEATH",
  whoWins: "WHO WINS?",
  winsPlate: (name) => `${name} WINS`,
  division: (id) => FL_DIVISION_LABELS[id as FlDivision] ?? id,
  role: (id) => cap(id),
};

/** The arena unit's share of the field (the effects' size), as the mode uses it. */
const UNIT_FRAC = 0.065;

export class FightLeagueLayer {
  private readonly fr = new FlFrame();
  private readonly stagePainter = new FlStagePainter();
  private readonly bodies = new FlBodiesPainter();
  private readonly weapons = new FlWeaponsPainter();
  private readonly projectiles = new FlProjectilesPainter();
  private readonly fx = new FlFxPainter();
  private readonly hud = new FlHudPainter();
  private readonly cards = new FlCardsPainter();
  private view: FightLeagueView | null = null;
  private labels: FightLeagueLabels = DEFAULT_FIGHT_LEAGUE_LABELS;
  private frameKey = "";
  private generation = -1;
  private readonly shakeOut = { x: 0, y: 0 };
  private shakeSerial = 0;
  private readonly facePool: Ball[] = [];
  private readonly faceList: Ball[] = [];
  /** What the last frame drew (the data attributes and the smoke test): names, ability boxes, the VS card, sprites in use. */
  namesDrawn = 0;
  boxesDrawn = 0;
  vsShown = false;
  bannerShown = false;
  fightersDrawn = 0;
  projectilesDrawn = 0;
  weaponsDrawn = 0;
  /** Where the ability boxes started last frame (screen y; Infinity without them): the bottom captions keep above it. */
  boxesTop = Infinity;
  // --- fl-overhaul --- (Stage 3)
  /** The moving average of drawBodies + drawOverlay (ms, measured by the page – `noteRenderMs()`). */
  renderMs = 0;
  /** Shakes seen this run, whether the plates were drawn in an export and whether the hit shapes are on. */
  shakes = 0;
  platesShown = false;
  debugOn = false;

  /** The body colour of a fighter ball (the ball faces). */
  readonly bodyColor = (ball: { id: number }): string => {
    const v = this.view;
    if (v) for (const f of v.fighters) if (f.ballId === ball.id) return f.row.body;
    return "#ffffff";
  };

  constructor() {
    this.fr.shot = this.projectiles.drawShape;
    void flFontsReady();
  }

  /** The banner kinds shown this run (data-fl-banners). */
  get bannersShown(): ReadonlySet<string> {
    return this.cards.shown;
  }
  /** The callouts shown this run (data-fl-callouts). */
  get callouts(): ReadonlySet<string> {
    return this.fx.callouts;
  }
  /** Telegraph previews drawn this run and knockback ribbons drawn (data-fl-telegraphs, data-fl-trails). */
  get telegraphs(): number {
    return this.fx.telegraphs;
  }
  get trails(): number {
    return this.bodies.trails;
  }

  /** The page's measure of a frame's drawBodies + drawOverlay (ms): a moving average (no clock in the renderer). */
  noteRenderMs(ms: number) {
    if (Number.isFinite(ms) && ms >= 0) this.renderMs = this.renderMs === 0 ? ms : 0.9 * this.renderMs + 0.1 * ms;
  }

  /** Once per frame (any entry point): the clocks, the scales, the palette, where every fighter is drawn. */
  private begin(view: FightLeagueView, o: FightLeagueRenderOptions) {
    this.view = view;
    this.labels = o.labels;
    const fr = this.fr;
    fr.view = view;
    fr.o = o;
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.shakes = 0;
      this.shakeSerial = view.eventSerial;
      this.platesShown = false;
    }
    const field = view.field;
    const dpr = Math.max(0.25, o.dpr || 1);
    const dk = field?.dk || 1;
    // (the options may change within a frame – the page's lite tier, the hit shapes)
    fr.lite = o.quality === "lite";
    this.debugOn = !!o.debug;
    const key = `${view.generation}|${view.timeMs}|${dpr}|${dk}|${view.eventSerial}|${view.settings.stage}|${view.settings.arenaStyle}`;
    if (key === this.frameKey) return;
    this.frameKey = key;
    fr.now = view.timeMs;
    fr.fxNow = flEffectNow(view, view.timeMs);
    fr.dpr = dpr;
    fr.px = dpr * dk;
    fr.pal = stagePalette(view.settings.stage);
    fr.look = arenaLook(fr.pal, view.settings.arenaStyle, matchDivision(view));
    fr.unit = field ? Math.max(6, UNIT_FRAC * field.side) : 6;
    fr.text.begin();
    this.weapons.begin(view, fr.px);
    this.projectiles.begin(view, fr.px);
    this.bodies.begin(view);
    this.fx.begin(view);
    this.hud.begin(view);
    this.cards.begin(view);
    // where each fighter is drawn: the finale's drift, held by an impact frame (50 / 80 ms) and catching up (60 ms)
    const now = fr.now;
    const fin = view.finale.from >= 0 && now >= view.finale.from;
    fr.impactAge.fill(Infinity);
    if (view.settings.impact !== false) {
      const n = Math.min(view.eventSerial, FL_EVENT_CAP);
      for (let k = 0; k < n; k++) {
        const e = view.events[k];
        if (e.kind !== EV_IMPACT) continue;
        const age = now - e.t;
        if (!(age >= 0) || age >= 200) continue;
        const target = e.slot;
        const attacker = e.src >= 0 ? e.src >> 3 : -1;
        if (target >= 0 && target < FL_MAX_SLOTS && age < fr.impactAge[target]) {
          fr.impactAge[target] = age;
          fr.impactHeavy[target] = e.value === 1 ? 1 : 0;
          fr.heldX[target] = e.x;
          fr.heldY[target] = e.y;
        }
        if (attacker >= 0 && attacker < FL_MAX_SLOTS && age < fr.impactAge[attacker]) {
          fr.impactAge[attacker] = age;
          fr.impactHeavy[attacker] = e.value === 1 ? 1 : 0;
          fr.heldX[attacker] = e.x2;
          fr.heldY[attacker] = e.y2;
        }
      }
    }
    for (const f of view.fighters) {
      if (f.slot >= FL_MAX_SLOTS) continue;
      let x = fin && f.alive ? f.finX : f.x;
      let y = fin && f.alive ? f.finY : f.y;
      const age = fr.impactAge[f.slot];
      if (age < Infinity && !fin) {
        const k = flImpactBlend(age, fr.impactHeavy[f.slot] === 1);
        x = fr.heldX[f.slot] + (x - fr.heldX[f.slot]) * k;
        y = fr.heldY[f.slot] + (y - fr.heldY[f.slot]) * k;
      }
      fr.dx[f.slot] = x;
      fr.dy[f.slot] = y;
    }
    fr.zoomK = fin ? this.fx.zoomAt(view, now) : 1;
    fr.zoomX = view.finale.x;
    fr.zoomY = view.finale.y;
  }

  /* ------------------------------------------------------------------ the stage */

  /** The stage's backdrop over the whole canvas (`w` × `h` CSS px, `scale` device px each): lilac, night, or nothing on the theme stage. */
  drawBackdrop(ctx: CanvasRenderingContext2D, view: FightLeagueView, w: number, h: number, scale = 1) {
    this.stagePainter.drawBackdrop(ctx, stagePalette(view.settings.stage), w, h, scale);
  }

  /**
   * The world's transform for this frame (after the camera): the mode's screen shake – a translate, `side` the square's
   * side in screen px; none while the camera's own Screen Shake is on, × 0.3 under reduced motion at the default strength –
   * then the field drawn at its display scale (FL_ARENA_FRAC under FL_ARENA_TOP).
   */
  applyWorld(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions, side: number) {
    const field = view.field;
    if (!field) return;
    this.begin(view, o);
    const strength = flShakeStrength(view.settings.shake, !!o.reducedMotion, !!o.cameraShake);
    // count the shakes this run saw (data-fl-shakes)
    if (strength > 0) {
      const from = Math.max(this.shakeSerial, view.eventSerial - FL_EVENT_CAP);
      for (let s = from; s < view.eventSerial; s++) {
        const e = view.events[s % FL_EVENT_CAP];
        if ((e.kind === EV_HIT && e.value >= FL_SHAKES.hit.minDamage) || e.kind === EV_SLAM || e.kind === EV_KO || (e.kind === EV_SHOCK && e.aux <= 1) || (e.kind === EV_CAST && e.aux === 1)) this.shakes++;
      }
    }
    this.shakeSerial = view.eventSerial;
    if (strength > 0) {
      flShakeAt(view, this.fr.fxNow, side, strength, this.shakeOut);
      if (this.shakeOut.x !== 0 || this.shakeOut.y !== 0) ctx.translate(this.shakeOut.x, this.shakeOut.y);
    }
    const dk = field.dk || 1;
    if (dk !== 1 || field.dcx !== field.cx || field.dcy !== field.cy) {
      ctx.translate(field.dcx, field.dcy);
      ctx.scale(dk, dk);
      ctx.translate(-field.cx, -field.cy);
    }
  }

  drawStage(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions) {
    const field = view.field;
    if (!field) return;
    this.begin(view, o);
    this.fr.text.scale = this.fr.px;
    ctx.save();
    ctx.globalAlpha = 1;
    this.stagePainter.drawPlate(ctx, this.fr, view);
    ctx.save();
    ctx.beginPath();
    if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half, 0, TWO_PI);
    else ctx.rect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
    ctx.clip();
    this.stagePainter.drawOverlays(ctx, this.fr, view);
    ctx.restore();
    ctx.restore();
  }

  /* ------------------------------------------------------------------ fighters, weapons, projectiles, effects */

  private zoom(ctx: CanvasRenderingContext2D) {
    const fr = this.fr;
    if (fr.zoomK === 1) return;
    ctx.translate(fr.zoomX, fr.zoomY);
    ctx.scale(fr.zoomK, fr.zoomK);
    ctx.translate(-fr.zoomX, -fr.zoomY);
  }

  drawBodies(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions) {
    const field = view.field;
    if (!field) return;
    this.begin(view, o);
    const fr = this.fr;
    fr.text.scale = fr.px;
    ctx.save();
    ctx.globalAlpha = 1;
    // everything in play is clipped to the arena (a weapon past the rim is cut by it); the finale pushes in round the KO
    ctx.beginPath();
    if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half, 0, TWO_PI);
    else ctx.rect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
    ctx.clip();
    this.zoom(ctx);
    this.fx.drawTelegraphs(ctx, fr, view);
    this.projectiles.drawFireRings(ctx, fr, view);
    this.projectiles.drawTasks(ctx, fr, view);
    this.projectiles.drawBeams(ctx, fr, view);
    this.projectiles.drawMinions(ctx, fr, view);
    this.projectiles.drawWalls(ctx, fr, view);
    this.bodies.drawTrails(ctx, fr, view);
    let weapons = 0;
    let drawn = 0;
    for (const f of view.fighters) if (f.alive) weapons += this.weapons.drawWeapons(ctx, fr, view, f, fr.x(f), fr.y(f));
    for (const f of view.fighters) {
      if (!f.alive) continue;
      this.bodies.drawFighter(ctx, fr, view, f);
      drawn++;
    }
    // held shields go in front of their fighter (counted with the weapons drawn)
    for (const f of view.fighters) if (f.alive) weapons += this.weapons.drawShields(ctx, fr, f, fr.x(f), fr.y(f));
    this.projectilesDrawn = this.projectiles.drawProjectiles(ctx, fr, view);
    this.fx.drawKoGhosts(ctx, fr, view, this.bodies);
    this.fx.drawFinale(ctx, fr, view);
    ctx.restore();
    // bars, numbers, tags and effects over the rim
    ctx.save();
    ctx.globalAlpha = 1;
    this.zoom(ctx);
    const tags = view.settings.tags === "on" || (view.settings.tags !== "off" && view.fighters.length >= 3);
    for (const f of view.fighters) {
      if (!f.alive) continue;
      this.bodies.drawHp(ctx, fr, view, f, o.numbers);
      if (tags) this.bodies.drawTag(ctx, fr, view, f);
    }
    this.fx.drawEvents(ctx, fr, view, o.labels);
    ctx.restore();
    if (o.debug) drawDebug(ctx, view, fr.now);
    this.fightersDrawn = drawn;
    this.weaponsDrawn = weapons;
  }

  /* ------------------------------------------------------------------ screen space */

  /** A size-1 fighter's radius in display px (the HUD layout's HP number). */
  private ballRadius(view: FightLeagueView): number {
    const f = view.fighters[0];
    const dk = view.field?.dk || 1;
    if (!f) return 10;
    return (f.baseR / Math.max(0.05, f.row.stats.size)) * dk;
  }

  /** The HUD's layout for a frame (the tests read it too). */
  hudLayout(view: FightLeagueView, side: number, portrait: boolean): FlHudLayout {
    return flHudLayout(side, view.fighters.length, view.match, portrait, this.ballRadius(view));
  }

  /**
   * The HUD inside the exported square: the names band, the timer and the lead bar, the ability boxes, the VS card, the
   * super flash, the centre banners, the KO flash and the verdict's card. `inset` moves the names below the page's buttons;
   * `portrait` (a 9:16 export) keeps the right 10 % of the square free of text. Returns the bottom of the names' band
   * (screen y; 0 without the HUD) – the top captions start below it; `boxesTop` is where the ability boxes start.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: FightLeagueView, o: FightLeagueRenderOptions, frame: { width: number; height: number; inset: number; portrait?: boolean }): number {
    this.namesDrawn = 0;
    this.boxesDrawn = 0;
    this.vsShown = false;
    this.bannerShown = false;
    this.boxesTop = Infinity;
    this.cards.vsShown = false;
    this.cards.bannerShown = false;
    const field = view.field;
    if (!field) return 0;
    this.begin(view, o);
    const fr = this.fr;
    fr.text.scale = fr.dpr;
    const side = Math.min(frame.width, frame.height);
    const ox = (frame.width - side) / 2;
    const oy = (frame.height - side) / 2;
    const L = o.labels;
    const lay = this.hudLayout(view, side, !!frame.portrait);
    let hudBottom = 0;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    if (view.settings.hud) {
      hudBottom = this.hud.drawBand(ctx, fr, view, L, lay, ox, oy + frame.inset, this.bodies);
      this.boxesTop = this.hud.drawBoxes(ctx, fr, view, L, lay, ox, oy, this.bodies, this.weapons);
      this.namesDrawn = this.hud.namesDrawn;
      this.boxesDrawn = this.hud.boxesDrawn;
    }
    this.cards.drawVs(ctx, fr, view, L, lay, ox, oy, this.bodies, this.weapons, view.settings.hud);
    this.cards.drawKoFlash(ctx, fr, view, lay, ox, oy);
    this.fx.drawSuperFlash(ctx, fr, view, ox + lay.arena.x, oy + lay.arena.y, lay.arena.w, lay.arena.h, ox, oy, side);
    const kind = this.cards.drawCentre(ctx, fr, view, L, lay, ox, oy);
    if (view.finished && !o.teamBanner) this.cards.drawVerdict(ctx, fr, view, L, lay, ox, oy, this.bodies, this.weapons, kind);
    ctx.restore();
    this.vsShown = this.cards.vsShown;
    this.bannerShown = this.cards.bannerShown;
    return hudBottom;
  }

  /**
   * The export frame's background (the recorder's hook, before the square and the watermark): the stage in the letterbox
   * bars (not on the theme stage) and – in a 9:16 frame with the plates on – the plates above and below the square.
   */
  paintExportBackdrop(ctx: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop | null) {
    const view = this.view;
    if (!view) return;
    const pal = stagePalette(view.settings.stage);
    this.stagePainter.paintExport(ctx, pal, width, height, crop);
    if (view.settings.plates === false || !crop) return;
    const drawn = drawPlates(ctx, this.fr.text, view, this.labels, width, height, crop.dy, crop.dy + crop.dh);
    if (drawn) this.platesShown = true;
  }

  /** The balls the ball characters' faces go on: where the fighters are drawn this frame (a reused list). */
  faceBalls(balls: readonly Ball[], view: FightLeagueView): readonly Ball[] {
    const fr = this.fr;
    this.faceList.length = 0;
    for (const ball of balls) {
      let f: FlFighter | null = null;
      for (const g of view.fighters) if (g.ballId === ball.id) f = g;
      if (!f || f.slot >= FL_MAX_SLOTS || !Number.isFinite(fr.dx[f.slot])) {
        this.faceList.push(ball);
        continue;
      }
      let b = this.facePool[this.faceList.length];
      if (!b) {
        b = { ...ball };
        this.facePool[this.faceList.length] = b;
      } else Object.assign(b, ball);
      let x = fr.dx[f.slot];
      let y = fr.dy[f.slot];
      let r = ball.radius;
      if (fr.zoomK !== 1) {
        x = fr.zoomX + (x - fr.zoomX) * fr.zoomK;
        y = fr.zoomY + (y - fr.zoomY) * fr.zoomK;
        r *= fr.zoomK;
      }
      b.x = x;
      b.y = y;
      b.radius = r;
      this.faceList.push(b);
    }
    return this.faceList;
  }
}

/** The data attributes of a Fight League run (data-fl-*), for tools and the smoke test. */
export const FIGHT_LEAGUE_DATA_KEYS = [
  "flMatch",
  "flArena",
  "flNames",
  "flIds",
  "flHp",
  "flMaxHp",
  "flHits",
  "flCasts",
  "flAbilities",
  "flAlive",
  "flKos",
  "flShots",
  "flBlocks",
  "flClashes",
  "flSounds",
  "flWinner",
  "flWinnerTeam",
  "flFinished",
  "flFinishSec",
  "flDoubleKo",
  "flByTime",
  "flForced",
  "flHud",
  "flHudNames",
  "flBoxes",
  "flBoxesTop", // where the ability boxes start (canvas px; "" without them): the bottom captions keep above it
  "flVs", // the VS card was drawn this run
  "flBanner",
  "flFighters",
  "flWeapons",
  "flProjectiles",
  "flTime",
  // --- fl-overhaul --- the fair hit pipeline's counters and sudden death
  "flGrazes",
  "flClashes2",
  "flImmunes",
  "flInterrupts",
  "flDodges",
  "flSudden",
  // --- fl-overhaul --- (Stage 3) the stage, the render cost, the banners and callouts shown, the spectacle's counters
  "flStage",
  "flArenaStyle",
  "flRenderMs",
  "flBanners",
  "flFirstBlood",
  "flPerfect",
  "flClutch",
  "flFinale",
  "flShakes",
  "flTrails",
  "flTelegraphs",
  "flPlates",
  "flDebug",
  "flCallouts",
];

/** Writes the data-fl-* attributes (the strings are rebuilt only when their values change). */
export class FightLeagueDataset {
  private generation = -1;
  private names = "";
  private ids = "";
  private abilities = "";
  private maxHp = "";
  private hpKey = "";
  /** The VS card was drawn this run. */
  private vsSeen = false;
  // --- fl-overhaul --- (Stage 3)
  private bannersSize = -1;
  private banners = "";
  private calloutsSize = -1;
  private callouts = "";

  write(view: FightLeagueView, layer: FightLeagueLayer, set: (key: string, value: string) => void) {
    if (view.generation !== this.generation || this.names === "") {
      this.generation = view.generation;
      this.names = view.fighters.map((f) => f.row.name).join(",");
      this.ids = view.fighters.map((f) => f.row.id).join(",");
      this.abilities = view.fighters.map((f) => f.row.ability.name).join(",");
      this.maxHp = view.fighters.map((f) => String(Math.round(f.maxHp * 10) / 10)).join(",");
      this.hpKey = "";
      this.vsSeen = false;
      this.bannersSize = -1;
      this.calloutsSize = -1;
    }
    let key = "";
    for (const f of view.fighters) key += `${Math.round(Math.max(0, f.hp) * 10)}/${f.hits}/${f.casts}/${f.alive ? 1 : 0};`;
    if (key !== this.hpKey) {
      this.hpKey = key;
      set("flHp", view.fighters.map((f) => String(Math.round(Math.max(0, f.hp) * 10) / 10)).join(","));
      set("flHits", view.fighters.map((f) => String(f.hits)).join(","));
      set("flCasts", view.fighters.map((f) => String(f.casts)).join(","));
      set("flAlive", view.fighters.map((f) => (f.alive ? "1" : "0")).join(","));
    }
    set("flMatch", view.match);
    set("flArena", view.field?.kind ?? "");
    set("flNames", this.names);
    set("flIds", this.ids);
    set("flAbilities", this.abilities);
    set("flMaxHp", this.maxHp);
    set("flKos", String(view.kos));
    set("flShots", String(view.shots));
    set("flBlocks", String(view.blocks));
    set("flClashes", String(view.clashes));
    set("flSounds", String(view.sounds));
    let winner = "";
    if (view.finished) {
      if (view.doubleKo) winner = "double-ko";
      else if (view.winnerTeam < 0) winner = "draw";
      else winner = view.fighters.filter((f) => f.team === view.winnerTeam).map((f) => f.row.name).join(" + ");
    }
    set("flWinner", winner);
    set("flWinnerTeam", view.finished ? String(view.winnerTeam) : "");
    set("flFinished", view.finished ? "1" : "0");
    set("flFinishSec", view.finished ? (view.finishMs / 1000).toFixed(3) : "");
    set("flDoubleKo", view.doubleKo ? "1" : "0");
    set("flByTime", view.byTime ? "1" : "0");
    set("flForced", String(view.forcedWinner));
    set("flHud", view.settings.hud ? "1" : "0");
    set("flHudNames", String(layer.namesDrawn));
    set("flBoxes", String(layer.boxesDrawn));
    set("flBoxesTop", layer.boxesTop < Infinity ? layer.boxesTop.toFixed(1) : "");
    if (layer.vsShown) this.vsSeen = true;
    set("flVs", this.vsSeen ? "1" : "0");
    set("flBanner", layer.bannerShown ? "1" : "0");
    set("flFighters", String(layer.fightersDrawn));
    set("flWeapons", String(layer.weaponsDrawn));
    set("flProjectiles", String(layer.projectilesDrawn));
    set("flTime", (view.timeMs / 1000).toFixed(1));
    set("flGrazes", String(view.grazes)); // --- fl-overhaul ---
    set("flClashes2", String(view.clashes2));
    set("flImmunes", String(view.immunes));
    set("flInterrupts", String(view.interrupts));
    set("flDodges", String(view.dodges));
    set("flSudden", view.suddenMs >= 0 ? "1" : "0");
    // --- fl-overhaul --- (Stage 3)
    set("flStage", view.settings.stage);
    set("flArenaStyle", view.settings.arenaStyle);
    set("flRenderMs", layer.renderMs.toFixed(2));
    const banners = layer.bannersShown;
    if (banners.size !== this.bannersSize) {
      this.bannersSize = banners.size;
      this.banners = [...banners].join(",");
    }
    set("flBanners", this.banners);
    const first = view.firstBloodSlot >= 0 ? view.fighters[view.firstBloodSlot] : null;
    set("flFirstBlood", first ? first.row.name : "");
    let perfect = false;
    let clutch = false;
    for (let s = Math.max(0, view.bannerSerial - FL_BANNER_CAP); s < view.bannerSerial; s++) {
      const b = view.banners[s % FL_BANNER_CAP];
      if (b.kind === FB_PERFECT) perfect = true;
      else if (b.kind === FB_CLUTCH) clutch = true;
    }
    set("flPerfect", perfect ? "1" : "0");
    set("flClutch", clutch ? "1" : "0");
    set("flFinale", view.finale.from >= 0 && view.timeMs >= view.finale.from && view.timeMs < view.finale.until ? "1" : "0");
    set("flShakes", String(layer.shakes));
    set("flTrails", String(layer.trails));
    set("flTelegraphs", String(layer.telegraphs));
    set("flPlates", layer.platesShown ? "1" : "0");
    set("flDebug", layer.debugOn ? "1" : "0");
    const callouts = layer.callouts;
    if (callouts.size !== this.calloutsSize) {
      this.calloutsSize = callouts.size;
      this.callouts = [...callouts].join(",");
    }
    set("flCallouts", this.callouts);
  }
}
