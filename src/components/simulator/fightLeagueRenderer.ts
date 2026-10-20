import {
  EV_CAST,
  EV_HEAVY,
  EV_HIT,
  EV_IMPACT,
  EV_KO,
  EV_SHOCK,
  EV_SLAM,
  FB_CLUTCH,
  FB_PERFECT,
  FL_BANNER_CAP,
  FL_EVENT_CAP,
  FL_INTRO_MS,
  type FightLeagueView,
  type FlFighter,
} from "@/lib/physics/modes/fightLeague";
import {
  FL_HEAVY_ZOOM_MS,
  FL_HITSTOP_FACTOR,
  FL_HITSTOP_KO_MS,
  FL_HITSTOP_MS,
  FL_KO_FLIP_MS,
  FL_MAX_SLOTS,
  FL_OPENER_MS,
  FL_SHAKES,
  flEffectNow,
  flHeavyZoom,
  flImpactBlend,
  flHudLayout,
  flShakeAt,
  flShakeStrength,
  flNameColor,
  type FlHudLayout,
} from "@/lib/physics/modes/fightLeagueFx";
import { FL_DIVISION_LABELS, type FlDivision } from "@/lib/physics/modes/fightLeagueRoster";
import type { Ball } from "@/lib/physics/types";
import type { RecordingCrop } from "@/lib/recording/recorder";
import { FlBodiesPainter } from "./fightLeague/bodies";
import { FlCardsPainter } from "./fightLeague/cards";
import { drawDebug } from "./fightLeague/debug";
import { FlFrame, type FightLeagueLabels, type FightLeagueRenderOptions } from "./fightLeague/frame";
import { BADGE_HEIGHT, BADGE_INSET } from "@/lib/watermark/layout"; // --- legal-audit --- the fan-made badge sits in the watermark strip
import { FlFxPainter } from "./fightLeague/fx";
import { FlHudPainter } from "./fightLeague/hud";
import { DEFAULT_FL_STATE_LABELS, FL_NOIR_ARENA_FRAC, FL_NOIR_ARENA_TOP, FlNoirHudPainter } from "./fightLeague/noir"; // --- fl-noir ---
import { FL_ARENA_FRAC } from "@/lib/physics/modes/fightLeague";
import { INK, arenaLook, matchDivision, rimWidth, stagePalette } from "./fightLeague/palette";
import { drawPlates } from "./fightLeague/plates";
import { FlProjectilesPainter } from "./fightLeague/projectiles";
import { FlStagePainter } from "./fightLeague/stage";
import { TWO_PI } from "./fightLeague/sprites";
import { flFontsReady } from "./fightLeague/text";
import { FlWeaponsPainter } from "./fightLeague/weapons";
// --- fl-overhaul --- (Stage 5) the shows' overlays (series, brackets, boss rushes), the win chance and the story's words
import { FlShowsPainter } from "./fightLeague/shows";
import { DEFAULT_FL_SHOW_LABELS } from "./fightLeague/frame";
import { FB_DOUBLE_KO, FB_DRAW, FB_WIN, PK_BOMB, flWinnerShownMs } from "@/lib/physics/modes/fightLeague"; // (--- fl-overhaul --- Stage 7: PK_BOMB)
import { flRoundShort } from "@/lib/physics/modes/fightLeagueShow";

/**
 * Canvas drawing of Fight League (feature fight-league, see lib/physics/modes/fightLeague.ts) – --- fl-overhaul --- (Stage 3)
 * the facade of the renderer in components/simulator/fightLeague/ (palette, text, stage, bodies, weapons, projectiles, fx,
 * hud, cards, plates, debug). Created once with the canvas loop:
 *
 * - `drawBackdrop()` (screen space, right after the background and the theme painter): the stage – --- fl-noir --- noir by
 *   default (pitch black), lilac, night, or nothing on the theme stage;
 * - `applyWorld()` (after the camera): the mode's own screen shake and the display scale of the field (the physics field
 *   keeps its size and place – the replays hold – and is drawn at FL_ARENA_FRAC under the names band of FL_ARENA_TOP);
 * - `drawStage()` (inside the world transform, under everything): the pre-rendered arena plate, the slow-time veil, the
 *   decals, the rim flashes;
 * - `drawBodies()` (in place of the balls, clipped to the arena; the KO finale's push-in): the telegraph previews, fire
 *   rings, strikes, beams, minions, walls, the knockback ribbons, every fighter's weapons, bodies and statuses, shields,
 *   projectiles, the KO ghosts and the finale's speed lines and spotlight – then over the rim the HP bars and numbers, the
 *   name tags, the event ring's effects and callouts (and the hit shapes with flDbg=1);
 * - `drawOverlay()` (screen space, after the HUD, part of the recording): the names band, the timer and the lead bar, the
 *   ability boxes, the VS card, the super flash, the centre banners, the KO flash and the verdict's card (--- fl-noir --- on
 *   the noir stage the reel layout instead: the weapon icons and the pixel title above the arena, the stats block below it,
 *   no VS card – fightLeague/noir.ts);
 * - `paintExportBackdrop()` (the recorder's background hook): the stage in the export's letterbox bars and the 9:16 plates.
 *
 * Every pixel is a function of the view, its simulation clock and the options: the effects run on the effects' clock (the
 * finale's warp), randomness only through the analytic hash, no wall clock.
 *
 * --- fl-heavy --- (Stop The World) The heavy hits (EV_HEAVY) and lead turns (EV_TURN) the mode pushes: `cameraCue()` hands
 * the page the hit stop (a wall-clock dip of the page camera, 90 ms, 150 on the lethal blow: the engine's clock never
 * freezes); `begin()` finds the newest heavy hit for the zoom punch about its impact point (`flHeavyZoom()`, with the
 * finale's push-in never past 1.2) and the noir ink flip (`fr.flip`, FL_KO_FLIP_MS after a lethal blow); `drawStage()` paints
 * the flip (the arena white, the rim ink); `drawBodies()` adds the ARMED ring and the white wash under the HP numbers; the
 * noir opener offsets where the discs are drawn for their first FL_OPENER_MS (sliding in from outside the arena). The effects
 * themselves are fx.ts's, the discs' swell, heartbeat and squash bodies.ts's. data-fl-hitstops counts the cues.
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
  critical: "CRITICAL!", // --- fl-heavy ---
  combo: (n) => `${n} HITS`,
  suddenDeath: "SUDDEN DEATH",
  whoWins: "WHO WINS?",
  winsPlate: (name) => `${name} WINS`,
  division: (id) => FL_DIVISION_LABELS[id as FlDivision] ?? id,
  role: (id) => cap(id),
  fanMade: "Fan-made parody. Not affiliated.",
  shows: DEFAULT_FL_SHOW_LABELS, // --- fl-overhaul --- (Stage 5)
  states: DEFAULT_FL_STATE_LABELS, // --- fl-noir ---
};

/** The arena unit's share of the field (the effects' size), as the mode uses it. */
const UNIT_FRAC = 0.065;

/**
 * --- fl-heavy --- (Stop The World) The camera's cue for a frame: the page camera's slow-motion dip (`cam.dip(dipMs, factor)`)
 * that is the heavy hit's hit stop – a freeze through the page's wall clock, never the engine's: 90 real ms at factor 0.05
 * (about 26 ms of simulation, 1 to 2 fixed steps, pass inside it), 150 ms on the lethal blow.
 */
export interface FlCameraCue {
  dipMs: number;
  factor: number;
}

/** easeOutCubic on [0, 1]. */
const easeOutCubic = (u: number) => 1 - (1 - Math.max(0, Math.min(1, u))) ** 3;

export class FightLeagueLayer {
  private readonly fr = new FlFrame();
  private readonly stagePainter = new FlStagePainter();
  private readonly bodies = new FlBodiesPainter();
  private readonly weapons = new FlWeaponsPainter();
  private readonly projectiles = new FlProjectilesPainter();
  private readonly fx = new FlFxPainter();
  private readonly hud = new FlHudPainter();
  /** --- fl-noir --- The noir stage's HUD (the reel layout). */
  private readonly noir = new FlNoirHudPainter();
  private readonly cards = new FlCardsPainter();
  /** --- fl-overhaul --- (Stage 5) The shows' overlays (the data attributes read what it drew). */
  readonly shows = new FlShowsPainter();
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
  /**
   * --- fl-overhaul --- (fl-overhaul fix) The last frame's boxes: their rows, and their ability names as drawn – the smallest
   * size (a share of the square's side), the narrowest horizontal squeeze and how many were ellipsised.
   */
  boxRows = 0;
  boxNameMin = 0;
  /** --- low-findings-2 --- The smallest size a fighter's name was drawn at in the names band last frame (a share of the square's side; 0: none). */
  bandNameMin = 0;
  boxNameSqueeze = 1;
  boxNamesCut = 0;
  // --- fl-overhaul --- (Stage 3)
  /** The moving average of drawBodies + drawOverlay (ms, measured by the page – `noteRenderMs()`). */
  renderMs = 0;
  /** Shakes seen this run, whether the plates were drawn in an export and whether the hit shapes are on. */
  shakes = 0;
  platesShown = false;
  debugOn = false;
  /** --- fl-heavy --- Hit stops (camera dips) cued this run (data-fl-hitstops), the event serial `cameraCue()` has read up to and its generation. */
  hitstops = 0;
  private heavySerial = 0;
  private cueGeneration = -1;
  private readonly cue: FlCameraCue = { dipMs: FL_HITSTOP_MS, factor: FL_HITSTOP_FACTOR };

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
  /** --- fl-noir --- Hit particles spawned this run (data-fl-particles). */
  get particles(): number {
    return this.fx.particles.spawned;
  }
  /** --- fl-noir --- Whether the frame draws the noir stage (the reel layout). */
  get noirOn(): boolean {
    return this.fr.pal.noir;
  }
  /** --- fl-heavy --- Whether the frame draws the noir ink flip (the lethal blow's FL_KO_FLIP_MS). */
  get flipOn(): boolean {
    return this.fr.flip;
  }

  /** The page's measure of a frame's drawBodies + drawOverlay (ms): a moving average (no clock in the renderer). */
  noteRenderMs(ms: number) {
    if (Number.isFinite(ms) && ms >= 0) this.renderMs = this.renderMs === 0 ? ms : 0.9 * this.renderMs + 0.1 * ms;
  }

  /**
   * --- fl-heavy --- (Stop The World) Once a frame after the physics steps (Canvas.tsx, beside the String Battle duel's cue):
   * the camera's hit stop for the heavy hits that appeared since the last call – the longest of the frame, FL_HITSTOP_KO_MS
   * for a lethal blow (aux 2) else FL_HITSTOP_MS, at FL_HITSTOP_FACTOR – or null when nothing new landed, under reduced
   * motion or with Impact Frames off (`view.settings.impact === false`). The serial it has read up to starts over with a new
   * generation and follows a rewind (like the particles' `seen`). Counted in `hitstops` (data-fl-hitstops). Never called by
   * the headless tests' engine loop: the engine's clock, fingerprints and replays never see the dip.
   */
  cameraCue(view: FightLeagueView, reducedMotion: boolean): FlCameraCue | null {
    if (view.generation !== this.cueGeneration) {
      this.cueGeneration = view.generation;
      this.heavySerial = 0;
      this.hitstops = 0;
    }
    if (view.eventSerial < this.heavySerial) this.heavySerial = view.eventSerial;
    let dip = 0;
    for (let s = Math.max(this.heavySerial, view.eventSerial - FL_EVENT_CAP); s < view.eventSerial; s++) {
      const e = view.events[s % FL_EVENT_CAP];
      if (e.kind !== EV_HEAVY) continue;
      dip = Math.max(dip, e.aux === 2 ? FL_HITSTOP_KO_MS : FL_HITSTOP_MS);
    }
    this.heavySerial = view.eventSerial;
    if (!(dip > 0) || reducedMotion || view.settings.impact === false) return null;
    this.hitstops++;
    this.cue.dipMs = dip;
    this.cue.factor = FL_HITSTOP_FACTOR;
    return this.cue;
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
    // --- fl-noir --- the noir arena is a smaller square lower in the frame: a render-only scale and shift of the display
    // mapping (the physics field keeps its size and place – every replay and fingerprint holds)
    if (fr.pal.noir && field) {
      fr.noirK = FL_NOIR_ARENA_FRAC / FL_ARENA_FRAC;
      fr.noirDx = 0;
      fr.noirDy = field.sqTop + (FL_NOIR_ARENA_TOP + FL_NOIR_ARENA_FRAC / 2) * field.sqSide - field.dcy;
    } else {
      fr.noirK = 1;
      fr.noirDx = 0;
      fr.noirDy = 0;
    }
    fr.unit = field ? Math.max(6, UNIT_FRAC * field.side) : 6;
    fr.text.begin();
    this.weapons.begin(view, fr.px);
    this.projectiles.begin(view, fr.px);
    this.bodies.begin(view);
    this.fx.begin(view);
    this.hud.begin(view);
    this.noir.begin(view); // --- fl-noir ---
    this.cards.begin(view);
    this.shows.begin(view); // --- fl-overhaul --- (Stage 5)
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
    // --- fl-heavy --- the noir opener's clock: ms since the match's intro started, on noir and while the intro runs
    const introAge = now - (view.introMs - FL_INTRO_MS);
    fr.openerAge = fr.pal.noir && introAge >= 0 && introAge < FL_INTRO_MS + 100 ? introAge : Infinity;
    const slideIn = field && fr.openerAge < FL_OPENER_MS ? (1 - easeOutCubic(fr.openerAge / FL_OPENER_MS)) * 1.3 * field.half : 0;
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
      if (slideIn > 0 && f.alive && field) {
        // the noir opener: the disc slides in from 1.3 × half outside the arena along the vector from the centre through it
        let nx = f.x - field.cx;
        let ny = f.y - field.cy;
        const d = Math.hypot(nx, ny);
        if (d > 1e-6) {
          nx /= d;
          ny /= d;
        } else {
          nx = 0;
          ny = -1;
        }
        x += nx * slideIn;
        y += ny * slideIn;
      }
      fr.dx[f.slot] = x;
      fr.dy[f.slot] = y;
    }
    // --- fl-heavy --- the newest heavy hit: the zoom punch about its impact point (beside the finale's push-in, never past
    // 1.2 together) and the noir ink flip for FL_KO_FLIP_MS real ms after a lethal blow
    let punch = 1;
    let px = view.finale.x;
    let py = view.finale.y;
    fr.flip = false;
    const impactOn = view.settings.impact !== false && !o.reducedMotion;
    {
      // (in serial order: of two heavy hits in one step the later push is the newest)
      let newest = -Infinity;
      for (let s = Math.max(0, view.eventSerial - FL_EVENT_CAP); s < view.eventSerial; s++) {
        const e = view.events[s % FL_EVENT_CAP];
        if (e.kind !== EV_HEAVY) continue;
        if (e.aux === 2 && fr.pal.noir && impactOn) {
          const real = now - e.t;
          if (real >= 0 && real < FL_KO_FLIP_MS) fr.flip = true;
        }
        if (e.t < newest || !impactOn) continue; // (no zoom punch with Impact Frames off or under reduced motion, like the dip and the flip)
        const fxAge = fr.fxNow - flEffectNow(view, e.t);
        if (fxAge >= 0 && fxAge < FL_HEAVY_ZOOM_MS) {
          newest = e.t;
          punch = flHeavyZoom(fxAge, e.aux === 2);
          px = e.x;
          py = e.y;
        }
      }
    }
    if (fin) {
      fr.zoomK = Math.min(1.2, this.fx.zoomAt(view, now) * punch);
      fr.zoomX = view.finale.x;
      fr.zoomY = view.finale.y;
    } else {
      fr.zoomK = punch;
      fr.zoomX = px;
      fr.zoomY = py;
    }
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
        if ((e.kind === EV_HIT && e.value >= FL_SHAKES.hit.minDamage) || e.kind === EV_SLAM || e.kind === EV_KO || (e.kind === EV_SHOCK && e.aux <= 1) || (e.kind === EV_CAST && e.aux === 1) || e.kind === EV_HEAVY /* --- fl-heavy --- */) this.shakes++;
      }
    }
    this.shakeSerial = view.eventSerial;
    if (strength > 0) {
      flShakeAt(view, this.fr.fxNow, side, strength, this.shakeOut);
      if (this.shakeOut.x !== 0 || this.shakeOut.y !== 0) ctx.translate(this.shakeOut.x, this.shakeOut.y);
    }
    const dk = field.dk || 1;
    const fr = this.fr;
    if (fr.noirK !== 1 || fr.noirDy !== 0) {
      // --- fl-noir --- the noir arena's place and size (about the field's display centre)
      ctx.translate(field.dcx + fr.noirDx, field.dcy + fr.noirDy);
      ctx.scale(fr.noirK, fr.noirK);
      ctx.translate(-field.dcx, -field.dcy);
    }
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
    if (this.fr.flip) {
      // --- fl-heavy --- the noir ink flip: the arena white, its rim ink at the plate's rim width (the discs fill ink too)
      const rim = rimWidth(this.fr.pal, 2 * (field.fullHalf > 0 ? field.fullHalf : field.half));
      ctx.fillStyle = "#ffffff";
      ctx.strokeStyle = INK;
      ctx.lineWidth = rim;
      ctx.beginPath();
      if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half, 0, TWO_PI);
      else ctx.rect(field.cx - field.half, field.cy - field.half, 2 * field.half, 2 * field.half);
      ctx.fill();
      ctx.beginPath();
      if (field.kind === "circle") ctx.arc(field.cx, field.cy, field.half + rim / 2, 0, TWO_PI);
      else ctx.rect(field.cx - field.half - rim / 2, field.cy - field.half - rim / 2, 2 * field.half + rim, 2 * field.half + rim);
      ctx.stroke();
    }
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
    this.fx.drawArmed(ctx, fr, view); // --- fl-heavy --- the ARMED ring over a loaded heavy punch
    this.projectilesDrawn = this.projectiles.drawProjectiles(ctx, fr, view);
    this.fx.drawKoGhosts(ctx, fr, view, this.bodies);
    this.fx.drawFinale(ctx, fr, view);
    ctx.restore();
    // bars, numbers, tags and effects over the rim
    ctx.save();
    ctx.globalAlpha = 1;
    this.zoom(ctx);
    this.fx.drawWash(ctx, fr, view); // --- fl-heavy --- the heavy hit's white wash, under the HP numbers
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

  /** The HUD's layout for a frame (the tests read it too; --- fl-noir --- the noir stage's arena rect in place of the band's). */
  hudLayout(view: FightLeagueView, side: number, portrait: boolean): FlHudLayout {
    const lay = flHudLayout(side, view.fighters.length, view.match, portrait, this.ballRadius(view) * this.fr.noirK);
    if (this.fr.pal.noir) {
      const S = lay.side;
      lay.arena = { x: (0.5 - FL_NOIR_ARENA_FRAC / 2) * S, y: FL_NOIR_ARENA_TOP * S, w: FL_NOIR_ARENA_FRAC * S, h: FL_NOIR_ARENA_FRAC * S };
      lay.unit = 0.065 * lay.arena.w;
    }
    return lay;
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
    this.boxRows = 0;
    this.boxNameMin = 0;
    this.bandNameMin = 0; // --- low-findings-2 ---
    this.boxNameSqueeze = 1;
    this.boxNamesCut = 0;
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
    if (view.settings.hud && fr.pal.noir) {
      // --- fl-noir --- the reel layout: the weapon icons and the title above the arena, the stats block (the ability lines
      // folded in: they count as the boxes) below it
      hudBottom = this.noir.drawTop(ctx, fr, view, L, lay, ox, oy + frame.inset, this.weapons, this.shows);
      this.boxesTop = this.noir.drawBlock(ctx, fr, view, L, lay, ox, oy);
      this.namesDrawn = this.noir.namesDrawn;
      this.boxesDrawn = this.noir.abilitiesDrawn;
      this.boxRows = this.noir.abilitiesDrawn > 0 ? 1 : 0;
      this.boxNameMin = this.noir.abilityFsMin;
      this.bandNameMin = 0;
      this.boxNameSqueeze = 1;
      this.boxNamesCut = 0;
      if (view.show.kind === "boss") this.shows.drawBossBar(ctx, fr, view, L, lay, ox, oy);
    } else if (view.settings.hud) {
      hudBottom = this.hud.drawBand(ctx, fr, view, L, lay, ox, oy + frame.inset, this.bodies, this.shows);
      this.boxesTop = this.hud.drawBoxes(ctx, fr, view, L, lay, ox, oy, this.bodies, this.weapons);
      this.namesDrawn = this.hud.namesDrawn;
      this.boxesDrawn = this.hud.boxesDrawn;
      this.boxRows = this.hud.boxesDrawn > 0 ? lay.boxRows : 0;
      this.boxNameMin = this.hud.boxNameMin;
      this.bandNameMin = Number.isFinite(this.hud.bandNameMin) ? this.hud.bandNameMin : 0; // --- low-findings-2 ---
      this.boxNameSqueeze = this.hud.boxNameSqueeze;
      this.boxNamesCut = this.hud.boxNamesCut;
      // --- fl-overhaul --- (Stage 5) a boss rush's boss bar across the top of the arena and its challengers' queue
      if (view.show.kind === "boss") this.shows.drawBossBar(ctx, fr, view, L, lay, ox, oy);
    }
    this.cards.drawVs(ctx, fr, view, L, lay, ox, oy, this.bodies, this.weapons, view.settings.hud, this.shows);
    this.cards.drawKoFlash(ctx, fr, view, lay, ox, oy);
    this.fx.drawSuperFlash(ctx, fr, view, ox + lay.arena.x, oy + lay.arena.y, lay.arena.w, lay.arena.h, ox, oy, side);
    const kind = this.cards.drawCentre(ctx, fr, view, L, lay, ox, oy);
    // (--- fl-overhaul --- Stage 5: a show's interludes get their card – the score, the bracket, the boss –, a bracket's end its champion)
    const show = view.show;
    if (view.finished && !o.teamBanner) {
      if (show.kind === "bracket" && show.champion >= 0 && (kind === FB_WIN || kind === FB_DRAW || kind === FB_DOUBLE_KO)) {
        this.shows.drawChampion(ctx, fr, view, L, lay, ox, oy, Math.max(0, fr.now - flWinnerShownMs(view)), 1);
        this.cards.bannerShown = true;
        this.cards.shown.add("champion");
      } else this.cards.drawVerdict(ctx, fr, view, L, lay, ox, oy, this.bodies, this.weapons, kind, this.shows);
    } else if (view.matchOver && !view.finished && show.phase === "card") this.shows.drawInterlude(ctx, fr, view, L, lay, ox, oy);
    // --- legal-audit --- the permanent fan-made badge: small and muted, centred in the strip under the ability boxes (the
    // watermark badge keeps to a corner), HUD or not, in the recording too
    fr.text.draw(ctx, L.fanMade, ox + side / 2, oy + side * (1 - BADGE_INSET - BADGE_HEIGHT / 2), 0.016 * side, { role: "ui", color: fr.pal.hud.source, stroke: null, weight: 600 }, "center", 0.5 * side, 0.85);
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
      // (--- fl-noir --- the noir arena's scale and shift are in the world transform the faces are drawn under: nothing to add)
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
  // --- fl-overhaul --- (Stage 5) the shows and the story: the show's kind, the bout ('5/7'), a bracket's round, a series' score,
  // the champion, the boss's wave ('3/6'), the win chance shown ('62,38'; "" hidden), the handicap tags, the story's flags, the
  // lead changes, the finisher, the combo peak, the match index, the scores, the bracket's results, the boss's wave and HP, and
  // what the overlays drew (the bracket card, the champion card, the boss bar)
  "flShow",
  "flBout",
  "flRound",
  "flSeries",
  "flChampion",
  "flBoss",
  "flOdds",
  "flHcTags",
  "flStory",
  "flLeadChanges",
  "flFinisher",
  "flCombos",
  "flMatchIndex",
  "flScores",
  "flBracket",
  "flWave",
  "flBossHp",
  "flBracketShown",
  "flChampionShown",
  "flBossBar",
  // --- fl-overhaul --- (Stage 7) the heavy kit's ground layer: the most walls standing at once this run, and the most ground
  // hazards marked at once (traps lying in wait and the landing zones of lobbed bombs – both drawn on the arena floor)
  "flWalls",
  "flTraps",
  // --- fl-overhaul --- (fl-overhaul fix) the ability boxes' rows (1 or 2) and their names as drawn: the smallest size scaled to
  // the 1080 px square (never under the 26 px floor), the narrowest horizontal squeeze (≥ 0.75) and how many were ellipsised
  "flBoxRows",
  "flBoxNameFs",
  "flBandNameFs", // --- low-findings-2 ---
  "flBoxNameSqueeze",
  "flBoxNamesCut",
  // --- end fl-overhaul ---
  // --- fl-noir --- the hit particles spawned this run
  "flParticles",
  // --- fl-heavy --- (Stop The World) the hit stops (camera dips) the heavy hits cued this run
  "flHitstops",
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
  // --- fl-overhaul --- (Stage 5) the match the names belong to, the bracket's results (rebuilt when a result changes)
  private matchSerial = -1;
  private bracketKey = -1;
  private bracket = "";
  // --- fl-overhaul --- (Stage 7) the run's peaks of walls standing and of ground hazards marked (data-fl-walls, data-fl-traps)
  private wallsPeak = 0;
  private trapsPeak = 0;

  write(view: FightLeagueView, layer: FightLeagueLayer, set: (key: string, value: string) => void) {
    if (view.generation !== this.generation || view.matchSerial !== this.matchSerial || this.names === "") {
      const newRun = view.generation !== this.generation;
      this.generation = view.generation;
      this.matchSerial = view.matchSerial;
      this.names = view.fighters.map((f) => f.row.name).join(",");
      this.ids = view.fighters.map((f) => f.row.id).join(",");
      this.abilities = view.fighters.map((f) => f.row.ability.name).join(",");
      this.maxHp = view.fighters.map((f) => String(Math.round(f.maxHp * 10) / 10)).join(",");
      this.hpKey = "";
      if (newRun) {
        this.vsSeen = false;
        this.bannersSize = -1;
        this.calloutsSize = -1;
        this.bracketKey = -1;
        this.wallsPeak = 0; // --- fl-overhaul --- (Stage 7)
        this.trapsPeak = 0;
      }
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
    // --- fl-overhaul --- (Stage 5) the shows and the story
    const sh = view.show;
    const st = view.story;
    set("flShow", sh.kind);
    set("flMatchIndex", String(sh.matchIndex));
    set("flBout", sh.kind === "series" ? `${Math.min(sh.games + (view.matchOver ? 0 : 1), sh.maxGames)}/${sh.bouts}` : sh.kind === "single" ? "1/1" : `${sh.bout}/${sh.bouts}`);
    set("flRound", sh.kind === "bracket" && sh.round >= 0 ? flRoundShort(sh.rounds, sh.round) : "");
    set("flSeries", sh.kind === "series" || sh.maxGames > 1 ? `${sh.score[0]}-${sh.score[1]}` : "");
    set("flChampion", sh.kind === "bracket" && sh.champion >= 0 ? (sh.entrants[sh.champion]?.row.name ?? "") : "");
    set("flBoss", sh.kind === "boss" ? `${sh.wave}/${sh.waves}` : "");
    set("flWave", sh.kind === "boss" ? String(sh.wave) : "");
    let bossHp = sh.bossHp;
    for (const f of view.fighters) if (f.boss) bossHp = Math.max(0, f.alive ? f.hp : 0);
    set("flBossHp", sh.kind === "boss" ? String(Math.round(10 * bossHp) / 10) : "");
    const oddsOn = view.settings.odds !== false && !st.handicapped && st.chances.length >= 2;
    set("flOdds", oddsOn ? st.chances.map((c) => String(Math.round(100 * c))).join(",") : "");
    set("flHcTags", layer.shows.hcTags); // (the BUFFED / NERFED tags the VS card drew this run)
    const flags: string[] = [];
    if (st.perfect) flags.push("perfect");
    if (st.upset) flags.push("upset");
    if (st.comeback) flags.push("comeback");
    if (st.clutch) flags.push("clutch");
    if (st.abilityFinish) flags.push("ability-finish");
    if (st.sudden && st.decided) flags.push("sudden");
    set("flStory", flags.join(","));
    set("flLeadChanges", String(st.leadChanges));
    set("flFinisher", st.finisher);
    set("flCombos", String(st.comboPeak));
    set("flScores", sh.kind === "boss" ? `${sh.wins[0] ?? 0}-${sh.wins[1] ?? 0}` : `${sh.score[0]}-${sh.score[1]}`);
    if (sh.kind === "bracket" && sh.resultSerial !== this.bracketKey) {
      this.bracketKey = sh.resultSerial;
      const parts: string[] = [];
      sh.rounds.forEach((round, r) => {
        for (const b of round) {
          if (b.winner < 0 || b.a < 0 || b.b < 0) continue;
          parts.push(`${flRoundShort(sh.rounds, r)}:${sh.entrants[b.a]?.row.id}v${sh.entrants[b.b]?.row.id}>${sh.entrants[b.winner]?.row.id}`);
        }
      });
      this.bracket = parts.join(",");
    }
    set("flBracket", sh.kind === "bracket" ? this.bracket : "");
    set("flBracketShown", layer.shows.bracketShown ? "1" : "0");
    set("flChampionShown", layer.shows.championShown ? "1" : "0");
    set("flBossBar", layer.shows.bossBarShown ? "1" : "0");
    // --- fl-overhaul --- (Stage 7) the ground layer's peaks (fixed pools scanned in place: no allocation)
    let walls = 0;
    for (const w of view.walls) if (w.active) walls++;
    let traps = 0;
    for (const m of view.minions) if (m.active && m.trap) traps++;
    for (const p of view.projectiles) if (p.active && p.kind === PK_BOMB) traps++;
    if (walls > this.wallsPeak) this.wallsPeak = walls;
    if (traps > this.trapsPeak) this.trapsPeak = traps;
    set("flWalls", String(this.wallsPeak));
    set("flTraps", String(this.trapsPeak));
    // --- fl-overhaul --- (fl-overhaul fix) the boxes' rows and names
    set("flBoxRows", String(layer.boxRows));
    set("flBoxNameFs", layer.boxNameMin > 0 ? (layer.boxNameMin * 1080).toFixed(1) : "");
    set("flBandNameFs", layer.bandNameMin > 0 ? (layer.bandNameMin * 1080).toFixed(1) : ""); // --- low-findings-2 --- (the names band's smallest name, at 1080 px)
    set("flBoxNameSqueeze", layer.boxNameMin > 0 ? layer.boxNameSqueeze.toFixed(3) : "");
    set("flBoxNamesCut", String(layer.boxNamesCut));
    // --- end fl-overhaul ---
    set("flParticles", String(layer.particles)); // --- fl-noir ---
    set("flHitstops", String(layer.hitstops)); // --- fl-heavy ---
  }
}
