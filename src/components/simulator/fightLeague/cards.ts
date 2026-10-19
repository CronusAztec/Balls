import { FB_CLUTCH, FB_DOUBLE_KO, FB_DRAW, FB_FINAL_KO, FB_FIRST_BLOOD, FB_KO, FB_PERFECT, FB_SUDDEN, FB_TIME, FB_WIN, FL_BANNER_CAP, flHoldEndMs, type FightLeagueView, type FlFighter } from "@/lib/physics/modes/fightLeague";
import { FL_VS_COUNT_MS, FL_VS_PANELS_IN_MS, FL_VS_PANELS_OUT_MS, FL_VS_SLAM_MS, FL_VS_VEIL_MS, flBannerMs, flBannerName, flBannerSchedule, flFfaChipRect, type FlBannerPick, type FlHudLayout, type FlRect } from "@/lib/physics/modes/fightLeagueFx";
import type { FlBodiesPainter } from "./bodies";
import type { FlFrame, FightLeagueLabels } from "./frame";
import { GOLD, INK, TEAM_COLORS, greyOf } from "./palette";
import { TWO_PI, hash, roundRectPath } from "./sprites";
import type { FlTextStyle } from "./text";
import type { FlWeaponsPainter } from "./weapons";
import { drawHandicapTags, flTeamMatch, type FlShowsPainter } from "./shows"; // --- fl-overhaul --- (Stage 5)
// --- fl-overhaul --- (Stage 6) the tier list card
import { FL_TIER_COLORS, flTierLayout, flTierWinText, type FlTierGroup, type FlTierLayout } from "@/lib/physics/modes/fightLeagueTier";
import { flShortName } from "@/lib/physics/modes/fightLeagueRoster";
import { drawFlBodyIcon } from "./bodies";
import { STAGE_PALETTES } from "./palette";
import { flFont } from "./text";

/**
 * --- fl-overhaul --- (Stage 3) Fight League's cards and banners (screen space, inside the exported square):
 *
 *  - the VS card 2.0 on the intro's 1500 ms – a 55 % veil, two diagonal panels sliding in (each side's body colour with an
 *    accent edge, its ball at 2.2× with its weapon, the name, division and role chip, a handicap's tag), VS slamming
 *    in at 300 ms with a ring burst, 3-2-1 popping under it at 450 / 800 / 1150 ms, the panels sliding out at 1350 ms and
 *    FIGHT! at 1500 ms (2v2: a panel per team in its team colour – the team rings' – with its members' chips stacked, each in
 *    its fighter's colours; a free-for-all: a chip per fighter in the corner it starts in);
 *  - the centre banners, one at a time by priority (`flBannerSchedule()`): first blood's ribbon in the attacker's colours,
 *    KO! at 0.11 S, the finale's FINAL KO, TIME!, DRAW, DOUBLE KO, SUDDEN DEATH;
 *  - the winner card laid out like the VS card (the winner's side in full colour with WINS!, the loser greyed and struck
 *    through; where the VS was: PERFECT! or CLUTCH!, then HP left · hits · time), the confetti, and in the last 0.4 s of the
 *    hold a crossfade toward the VS split, so the clip loops.
 */

const CONFETTI = 90;
const FIGHT_FLASH_MS = 650;
const KO_FLASH_MS = 700;

const ease = (u: number) => 1 - (1 - Math.max(0, Math.min(1, u))) ** 3;

/** The arena rect on screen. */
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class FlCardsPainter {
  vsShown = false;
  bannerShown = false;
  /** Every banner kind shown this run (data-fl-banners). */
  readonly shown = new Set<string>();
  private generation = -1;
  private readonly pick: FlBannerPick = { index: -1, start: 0, kind: 0 };
  /** A free-for-all chip's rect (reused). */
  private readonly chip: FlRect = { x: 0, y: 0, w: 0, h: 0 };

  begin(view: FightLeagueView) {
    if (view.generation !== this.generation) {
      this.generation = view.generation;
      this.shown.clear();
    }
  }

  private display(color: string, glow: string | null = null, strokeK = 0.11): FlTextStyle {
    return { role: "display", color, stroke: INK, strokeK, glow };
  }

  /** The two (or four) panels of the VS split at `slide` (1: in place), `grey` the losers' (the winner card). */
  private drawPanels(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, A: Rect, S: number, slide: number, alpha: number, bodies: FlBodiesPainter, weapons: FlWeaponsPainter, winnerTeam: number | null) {
    const fighters = view.fighters;
    if (fighters.length === 0) return;
    const off = (1 - slide) * A.w;
    const teams = flTeamMatch(view.match); // (--- fl-overhaul --- Stage 3: a panel per team, in its team colour; Stage 5: a 3v3's too)
    const sides = teams ? 2 : fighters.length === 2 ? 2 : 0;
    if (sides === 2) {
      for (let side = 0; side < 2; side++) {
        // the side's first fighter and how many it has (no list a frame)
        let lead: FlFighter | null = null;
        let count = 0;
        for (const f of fighters) {
          if (teams ? f.team !== side : f.slot !== side) continue;
          if (!lead) lead = f;
          count++;
        }
        if (!lead) continue;
        const team = teams ? side : lead.team;
        const lost = winnerTeam !== null && winnerTeam !== team;
        // a duel's panel in its fighter's colours; a team's in its team colour (the rings') with a white edge
        const fill = teams ? teamColor(fr, team) : lead.row.body;
        const edge = teams ? "#ffffff" : lead.row.accent;
        const dx = side === 0 ? -off : off;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        if (side === 0) {
          ctx.moveTo(A.x + dx, A.y);
          ctx.lineTo(A.x + 0.56 * A.w + dx, A.y);
          ctx.lineTo(A.x + 0.44 * A.w + dx, A.y + A.h);
          ctx.lineTo(A.x + dx, A.y + A.h);
        } else {
          ctx.moveTo(A.x + 0.56 * A.w + dx, A.y);
          ctx.lineTo(A.x + A.w + dx, A.y);
          ctx.lineTo(A.x + A.w + dx, A.y + A.h);
          ctx.lineTo(A.x + 0.44 * A.w + dx, A.y + A.h);
        }
        ctx.closePath();
        ctx.fillStyle = lost ? greyOf(fill) : fill;
        ctx.fill();
        // the accent edge along the diagonal
        ctx.strokeStyle = lost ? "#52525b" : edge;
        ctx.lineWidth = 0.012 * S;
        ctx.beginPath();
        ctx.moveTo(A.x + 0.56 * A.w + dx, A.y);
        ctx.lineTo(A.x + 0.44 * A.w + dx, A.y + A.h);
        ctx.stroke();
        ctx.restore();
        const cx = A.x + (side === 0 ? 0.25 : 0.75) * A.w + dx;
        const dk = view.field?.dk || 1;
        if (!teams || count === 1) {
          const f = lead;
          const R = 2.2 * f.r * dk;
          const by = A.y + 0.32 * A.h;
          ctx.save();
          ctx.globalAlpha = alpha * (lost ? 0.55 : 1);
          weapons.drawPortraitWeapon(ctx, fr, f, cx, by, (R / Math.max(1e-6, f.r)) * 0.95, side === 0 ? -0.5 : Math.PI + 0.5);
          ctx.restore();
          bodies.drawPortrait(ctx, fr, f, cx, by, R, alpha * (lost ? 0.55 : 1));
          this.panelText(ctx, fr, view, L, f, cx, A.y + 0.62 * A.h, 0.42 * A.w, S, alpha, lost, winnerTeam !== null && !lost);
        } else {
          // a team: its balls side by side, its members' chips stacked under them (each in its fighter's colours)
          let i = 0;
          let names = "";
          for (const f of fighters) {
            if (f.team !== side) continue;
            const R = 1.5 * f.r * dk;
            const bx = cx + (i - (count - 1) / 2) * (count > 2 ? 0.13 : 0.18) * A.w; // (--- fl-overhaul --- Stage 5: three a side)
            bodies.drawPortrait(ctx, fr, f, bx, A.y + 0.3 * A.h, R, alpha * (lost ? 0.55 : 1));
            this.memberChip(ctx, fr, f, cx, A.y + (0.54 + 0.085 * i) * A.h, 0.42 * A.w, S, alpha, lost);
            if (winnerTeam !== null && !lost) names = names ? `${names} + ${f.row.name}` : f.row.name;
            i++;
          }
          if (winnerTeam !== null && !lost) fr.text.draw(ctx, fr.text.upperOf(L.winTeam(names)), cx, A.y + (0.6 + 0.085 * count) * A.h, 0.045 * S, this.display(GOLD), "center", 0.42 * A.w, alpha);
        }
      }
      return;
    }
    // a free-for-all: a chip per fighter, in the corner it starts in (over its own ball)
    for (const f of fighters) {
      const lost = winnerTeam !== null && winnerTeam !== f.team;
      const chip = flFfaChipRect(f.homeSx, f.homeSy, A, slide, this.chip);
      const { x, y, w, h } = chip;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = lost ? greyOf(f.row.body) : f.row.body;
      roundRectPath(ctx, x, y, w, h, 0.2 * h);
      ctx.fill();
      ctx.strokeStyle = lost ? "#52525b" : f.row.accent;
      ctx.lineWidth = 0.008 * S;
      ctx.stroke();
      ctx.restore();
      const R = 0.32 * h;
      bodies.drawPortrait(ctx, fr, f, x + 0.5 * h, y + h / 2, R, alpha * (lost ? 0.55 : 1));
      const name = fr.text.upperOf(f.row.name);
      const tw = fr.text.draw(ctx, name, x + 0.95 * h, y + h / 2, 0.045 * S, this.display("#ffffff"), "left", w - 1.05 * h, alpha * (lost ? 0.6 : 1));
      if (lost) this.strike(ctx, x + 0.95 * h, x + 0.95 * h + tw, y + h / 2, S, alpha);
    }
  }

  /** A team member's chip on its team's panel: its name in a pill of its body colour with its accent edge (struck through when lost). */
  private memberChip(ctx: CanvasRenderingContext2D, fr: FlFrame, f: FlFighter, cx: number, cy: number, maxW: number, S: number, alpha: number, lost: boolean) {
    const fs = 0.04 * S;
    const style = this.display("#ffffff");
    const name = fr.text.upperOf(f.row.name);
    const a = alpha * (lost ? 0.6 : 1);
    const tw = Math.min(Math.max(1, maxW - 0.9 * fs), fr.text.width(name, fs, style));
    const w = tw + 0.9 * fs;
    const h = 1.45 * fs;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = lost ? greyOf(f.row.body) : f.row.body;
    roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.strokeStyle = lost ? "#52525b" : f.row.accent;
    ctx.lineWidth = Math.max(1.5, 0.006 * S);
    ctx.stroke();
    ctx.restore();
    const drawn = fr.text.draw(ctx, name, cx, cy, fs, style, "center", tw, a);
    if (lost) this.strike(ctx, cx - drawn / 2, cx + drawn / 2, cy, S, alpha);
  }

  /** A panel's texts: the name (or "[name] wins!"), the division and the role chip (a handicap's tag); never the source (legal audit). */
  private panelText(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, f: FlFighter, cx: number, y: number, maxW: number, S: number, alpha: number, lost: boolean, won: boolean) {
    const a = alpha * (lost ? 0.6 : 1);
    const title = won ? fr.text.upperOf(L.wins(f.row.name)) : fr.text.upperOf(f.row.name);
    const tw = fr.text.draw(ctx, title, cx, y, 0.075 * S, this.display(won ? GOLD : "#ffffff"), "center", maxW, a);
    if (lost) this.strike(ctx, cx - tw / 2, cx + tw / 2, y, S, alpha);
    const small: FlTextStyle = { role: "ui", color: "#ffffff", stroke: INK, strokeK: 0.14, weight: 700 };
    fr.text.draw(ctx, L.division(f.row.division), cx, y + 0.062 * S, 0.026 * S, small, "center", maxW, a);
    // the role chip
    const role = fr.text.upperOf(L.role(f.row.role));
    const chipFs = 0.019 * S;
    const style: FlTextStyle = { role: "display", color: INK, stroke: null };
    const w = Math.min(maxW, fr.text.width(role, chipFs, style) + 1.2 * chipFs);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffffff";
    roundRectPath(ctx, cx - w / 2, y + 0.115 * S, w, 1.5 * chipFs, 0.75 * chipFs);
    ctx.fill();
    ctx.restore();
    fr.text.draw(ctx, role, cx, y + 0.115 * S + 0.75 * chipFs, chipFs, style, "center", w, a);
    // a handicap ≠ 1: its BUFFED / NERFED tags (--- fl-overhaul --- Stage 5: in lime and red with their arrows; the win chance hides)
    drawHandicapTags(ctx, fr, f, L, cx, y + 0.158 * S, maxW, S, a);
  }

  private strike(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, S: number, alpha: number) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = Math.max(2, 0.006 * S);
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
    ctx.restore();
  }

  /** The VS card on the intro's clock (and FIGHT! as the fighters launch). */
  drawVs(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, bodies: FlBodiesPainter, weapons: FlWeaponsPainter, hud: boolean, shows?: FlShowsPainter) {
    // (--- fl-overhaul --- Stage 5: every match of a show plays its card from its own start – the clock below is the match's)
    const t0 = view.show ? view.show.matchStartMs : 0;
    const now = fr.now - t0;
    const S = lay.side;
    const A: Rect = { x: ox + lay.arena.x, y: oy + lay.arena.y, w: lay.arena.w, h: lay.arena.h };
    const intro = view.introMs - t0;
    if (hud && now < intro && now >= 0) {
      const veil = now < FL_VS_VEIL_MS ? now / FL_VS_VEIL_MS : now > FL_VS_PANELS_OUT_MS ? Math.max(0, 1 - (now - FL_VS_PANELS_OUT_MS) / Math.max(1, intro - FL_VS_PANELS_OUT_MS)) : 1;
      ctx.save();
      ctx.globalAlpha = 0.55 * veil;
      ctx.fillStyle = INK;
      ctx.fillRect(A.x, A.y, A.w, A.h);
      ctx.restore();
      const slide = now < FL_VS_PANELS_OUT_MS ? ease(now / FL_VS_PANELS_IN_MS) : 1 - ease((now - FL_VS_PANELS_OUT_MS) / Math.max(1, intro - FL_VS_PANELS_OUT_MS));
      this.drawPanels(ctx, fr, view, L, A, S, slide, 1, bodies, weapons, null);
      // VS slams in at 300 ms (1.6 → 1 in 120 ms) with a ring burst
      if (now >= FL_VS_SLAM_MS) {
        const u = Math.min(1, (now - FL_VS_SLAM_MS) / 120);
        const scale = 1.6 - 0.6 * ease(u);
        const cx = A.x + A.w / 2;
        const cy = A.y + A.h / 2;
        const ringT = (now - FL_VS_SLAM_MS) / 300;
        if (ringT < 1) {
          ctx.save();
          ctx.globalAlpha = 0.8 * (1 - ringT);
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 0.012 * S * (1 - ringT);
          ctx.beginPath();
          ctx.arc(cx, cy, (0.08 + 0.2 * ringT) * S, 0, TWO_PI);
          ctx.stroke();
          ctx.restore();
        }
        fr.text.draw(ctx, fr.text.upperOf(L.vs), cx, cy, 0.14 * S, this.display("#a3e635", "rgba(163, 230, 53, 0.55)"), "center", 0, Math.min(1, u * 2), scale);
        // 3-2-1 under the VS
        for (let i = FL_VS_COUNT_MS.length - 1; i >= 0; i--) {
          const at = FL_VS_COUNT_MS[i];
          if (now < at) continue;
          const age = now - at;
          const pop = age < 100 ? 1.4 - 0.4 * (age / 100) : 1;
          const digit = String(FL_VS_COUNT_MS.length - i);
          fr.text.number(ctx, digit, cx, cy + 0.13 * S, 0.08 * S, "#ffffff", INK, "center", 1, pop);
          this.shown.add("count");
          break;
        }
      }
      this.vsShown = true;
      this.shown.add("vs");
      // --- fl-overhaul --- (Stage 5) the show's line and the win chance (simulated) under the names
      if (shows) shows.drawVsExtras(ctx, fr, view, L, lay, A, now, 1 - Math.max(0, Math.min(1, (now - FL_VS_PANELS_OUT_MS) / Math.max(1, intro - FL_VS_PANELS_OUT_MS))));
    }
    // FIGHT! as the fighters launch
    const fightAge = now - intro;
    if (fightAge >= 0 && fightAge < FIGHT_FLASH_MS && !view.matchOver /* --- fl-overhaul --- (Stage 5) */) {
      const t = fightAge / FIGHT_FLASH_MS;
      const pop = t < 0.2 ? 0.7 + 1.5 * t : 1;
      fr.text.draw(ctx, fr.text.upperOf(L.fight), A.x + A.w / 2, A.y + A.h / 2, 0.11 * S, this.display("#a3e635", "rgba(163, 230, 53, 0.55)"), "center", 0.9 * A.w, t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4, pop);
      this.shown.add("fight");
    }
  }

  /** The centre banner the schedule picks (not the winner's: the card draws it). Returns its kind (0: none). */
  drawCentre(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number): number {
    const now = fr.now;
    const pick = flBannerSchedule(view, now, this.pick);
    if (pick.index < 0) return 0;
    const b = view.banners[pick.index];
    const kind = pick.kind;
    // without the finale (slow motion off) the final KO says nothing: the verdict's card comes at once
    if (kind === FB_FINAL_KO && !(view.finale.from >= 0)) return 0;
    if (kind === FB_WIN || kind === FB_DRAW || kind === FB_DOUBLE_KO) return kind;
    const S = lay.side;
    const A: Rect = { x: ox + lay.arena.x, y: oy + lay.arena.y, w: lay.arena.w, h: lay.arena.h };
    const age = now - pick.start;
    const len = flBannerMs(kind);
    const t = len > 0 && len < 1e8 ? age / len : 0;
    const fade = t > 0.75 ? Math.max(0, 1 - (t - 0.75) / 0.25) : 1;
    const pop = age < 120 ? 0.6 + 0.4 * ease(age / 120) : 1;
    const name = flBannerName(kind);
    if (name) this.shown.add(name);
    switch (kind) {
      case FB_FIRST_BLOOD: {
        // a ribbon across the arena in the attacker's colours
        const f = view.fighters[b.slot];
        const body = f ? f.row.body : "#dc2626";
        const accent = f ? f.row.accent : "#fde047";
        const slideIn = ease(age / 120);
        const cy = A.y + 0.3 * A.h;
        const bh = 0.09 * S;
        ctx.save();
        ctx.beginPath();
        ctx.rect(A.x, A.y, A.w, A.h);
        ctx.clip();
        ctx.translate(A.x + A.w / 2 + (1 - slideIn) * A.w, cy);
        ctx.rotate(-0.12);
        ctx.globalAlpha = 0.95 * fade;
        ctx.fillStyle = body;
        ctx.fillRect(-A.w, -bh / 2, 2 * A.w, bh);
        ctx.fillStyle = accent;
        ctx.fillRect(-A.w, -bh / 2 - 0.1 * bh, 2 * A.w, 0.1 * bh);
        ctx.fillRect(-A.w, bh / 2, 2 * A.w, 0.1 * bh);
        fr.text.draw(ctx, fr.text.upperOf(L.firstBlood), 0, 0, lay.bannerFs * 0.62, this.display("#ffffff"), "center", 0.9 * A.w, fade);
        ctx.restore();
        break;
      }
      case FB_KO:
        fr.text.draw(ctx, fr.text.upperOf(L.ko), A.x + A.w / 2, A.y + 0.3 * A.h, 0.11 * S, this.display("#fde047", "rgba(253, 224, 71, 0.5)"), "center", 0.9 * A.w, fade, pop);
        break;
      case FB_FINAL_KO:
        fr.text.draw(ctx, fr.text.upperOf(L.ko), A.x + A.w / 2, A.y + 0.32 * A.h, 0.16 * S, this.display("#fde047", "rgba(253, 224, 71, 0.55)"), "center", 0.9 * A.w, fade, pop);
        break;
      case FB_TIME:
        fr.text.draw(ctx, fr.text.upperOf(L.time), A.x + A.w / 2, A.y + A.h / 2, 0.12 * S, this.display("#fca5a5", "rgba(248, 113, 113, 0.5)"), "center", 0.9 * A.w, fade, pop);
        break;
      case FB_SUDDEN:
        fr.text.draw(ctx, fr.text.upperOf(L.sudden), A.x + A.w / 2, A.y + 0.25 * A.h, lay.bannerFs, this.display("#f87171"), "center", 0.9 * A.w, fade, pop);
        break;
      default:
        break;
    }
    return kind;
  }

  /** A white flash over the arena after each knockout. */
  drawKoFlash(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, lay: FlHudLayout, ox: number, oy: number) {
    const age = fr.now - view.lastKoMs;
    if (!(age >= 0 && age < KO_FLASH_MS)) return;
    const t = age / KO_FLASH_MS;
    ctx.save();
    ctx.globalAlpha = 0.3 * (1 - t) * (1 - t);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ox + lay.arena.x, oy + lay.arena.y, lay.arena.w, lay.arena.h);
    ctx.restore();
  }

  /**
   * The verdict's card – the winner's, or DRAW / DOUBLE KO – with the confetti, from the moment the schedule shows it; in the
   * last 0.4 s of the page's hold it crossfades toward the VS split (the clip loops).
   */
  drawVerdict(ctx: CanvasRenderingContext2D, fr: FlFrame, view: FightLeagueView, L: FightLeagueLabels, lay: FlHudLayout, ox: number, oy: number, bodies: FlBodiesPainter, weapons: FlWeaponsPainter, kind: number, shows?: FlShowsPainter) {
    if (!view.finished || (kind !== FB_WIN && kind !== FB_DRAW && kind !== FB_DOUBLE_KO)) return;
    const now = fr.now;
    const S = lay.side;
    const A: Rect = { x: ox + lay.arena.x, y: oy + lay.arena.y, w: lay.arena.w, h: lay.arena.h };
    const start = this.pick.index >= 0 ? this.pick.start : now;
    const age = Math.max(0, now - start);
    const holdEnd = flHoldEndMs(view);
    const fadeOut = now > holdEnd - 400 ? Math.min(1, (now - (holdEnd - 400)) / 400) : 0;
    const a = 1 - fadeOut;
    const winners = view.fighters.filter((f) => view.winnerTeam >= 0 && f.team === view.winnerTeam);
    const lead = winners.find((f) => f.alive) ?? winners[0] ?? null;
    // the confetti (analytic: it replays with the clock and freezes with a pause)
    if (lead && kind === FB_WIN) this.drawConfetti(ctx, ox, oy, S, age / 1000, lead, a);
    ctx.save();
    ctx.globalAlpha = 0.45 * a;
    ctx.fillStyle = INK;
    ctx.fillRect(A.x, A.y, A.w, A.h);
    ctx.restore();
    const slide = ease(age / FL_VS_PANELS_IN_MS);
    const winnerTeam = kind === FB_WIN && lead ? view.winnerTeam : -2;
    if (view.fighters.length === 2 || flTeamMatch(view.match)) this.drawPanels(ctx, fr, view, L, A, S, slide, a, bodies, weapons, winnerTeam);
    else {
      this.drawPanels(ctx, fr, view, L, A, S, slide, a * 0.85, bodies, weapons, winnerTeam);
      if (lead && kind === FB_WIN) {
        // the free-for-all's winner, big in the middle
        const R = 2.4 * lead.r * (view.field?.dk || 1);
        bodies.drawPortrait(ctx, fr, lead, A.x + A.w / 2, A.y + 0.42 * A.h, R, a);
        fr.text.draw(ctx, fr.text.upperOf(L.wins(lead.row.name)), A.x + A.w / 2, A.y + 0.42 * A.h + R + 0.05 * S, 0.06 * S, this.display(GOLD), "center", 0.8 * A.w, a);
      }
    }
    // the centre: the verdict (draw / double KO), or the tags and the line
    const cx = A.x + A.w / 2;
    const cy = A.y + A.h / 2;
    if (kind !== FB_WIN || !lead) {
      const title = kind === FB_DOUBLE_KO ? L.doubleKo : L.draw;
      const pop = age < 150 ? 0.6 + 0.4 * ease(age / 150) : 1;
      fr.text.draw(ctx, fr.text.upperOf(title), cx, cy, lay.bannerFs * 1.1, this.display("#e4e4e7"), "center", 0.86 * A.w, a, pop);
      if (view.byTime) fr.text.draw(ctx, fr.text.upperOf(L.time), cx, cy + 0.09 * S, 0.035 * S, this.display("#fca5a5"), "center", 0.8 * A.w, a);
    } else {
      const ty = view.fighters.length === 2 || flTeamMatch(view.match) ? cy - 0.04 * S : A.y + 0.82 * A.h;
      // --- fl-overhaul --- (Stage 5) the story's tags (PERFECT! > UPSET! > COMEBACK! > CLUTCH!, two at most) and '[ability] finish!'
      if (shows) shows.drawTags(ctx, fr, view, L, cx, ty, S, 0.4 * A.w, a, this.shown);
      else {
        let y = ty;
        let tags = 0;
        for (let s = Math.max(0, view.bannerSerial - FL_BANNER_CAP); s < view.bannerSerial && tags < 2; s++) {
          const bn = view.banners[s % FL_BANNER_CAP];
          if (bn.kind !== FB_PERFECT && bn.kind !== FB_CLUTCH) continue;
          if (now < bn.t) continue;
          const text = bn.kind === FB_PERFECT ? L.perfect : L.clutch;
          const pop = now - bn.t < 150 ? 0.7 + 0.3 * ease((now - bn.t) / 150) : 1;
          fr.text.draw(ctx, fr.text.upperOf(text), cx, y, 0.05 * S, this.display(bn.kind === FB_PERFECT ? GOLD : "#f87171", null, 0.12), "center", 0.4 * A.w, a, pop);
          this.shown.add(bn.kind === FB_PERFECT ? "perfect" : "clutch");
          y += 0.06 * S;
          tags++;
        }
      }
      let hp = 0;
      let hits = 0;
      for (const f of winners) {
        hp += Math.max(0, f.alive ? f.hp : 0);
        hits += f.hits;
      }
      const secs = Math.max(0, (view.finishMs - view.introMs) / 1000);
      const line = `${L.winSub(Math.ceil(hp - 1e-6), hits)} · ${secs.toFixed(1)} s`;
      fr.text.draw(ctx, view.byTime ? `${L.time} · ${line}` : line, cx, view.fighters.length === 2 || flTeamMatch(view.match) ? A.y + 0.9 * A.h : A.y + 0.92 * A.h, 0.026 * S, { role: "ui", color: "#f4f4f5", stroke: INK, strokeK: 0.14, weight: 700 }, "center", 0.9 * A.w, a);
      this.shown.add("win");
    }
    // the loop: the VS split fading in over the last 0.4 s of the hold
    if (fadeOut > 0) {
      ctx.save();
      ctx.globalAlpha = 0.55 * fadeOut;
      ctx.fillStyle = INK;
      ctx.fillRect(A.x, A.y, A.w, A.h);
      ctx.restore();
      this.drawPanels(ctx, fr, view, L, A, S, 1, fadeOut, bodies, weapons, null);
      fr.text.draw(ctx, fr.text.upperOf(L.vs), cx, cy, 0.14 * S, this.display("#a3e635", "rgba(163, 230, 53, 0.55)"), "center", 0, fadeOut);
    }
    // --- fl-overhaul --- (Stage 5) a show's verdict over the winner's card: the series, the boss rush
    if (shows && view.show && view.show.kind !== "single") shows.drawShowLine(ctx, fr, view, L, lay, ox, oy, a, this.shown);
    this.bannerShown = true;
  }

  private drawConfetti(ctx: CanvasRenderingContext2D, ox: number, oy: number, S: number, age: number, lead: FlFighter, alpha: number) {
    const color = lead.row.accent;
    ctx.save();
    for (let i = 0; i < CONFETTI; i++) {
      const start = 0.4 * hash(i, 1);
      const t = age - start;
      if (t < 0) continue;
      const fall = S * (0.25 + 0.2 * hash(i, 2));
      const yy = (-0.05 * S + fall * t) % (1.1 * S);
      const x = ox + S * hash(i, 3) + 0.03 * S * Math.sin(3 * t + 6 * hash(i, 4));
      const y = oy + yy;
      const size = 0.008 * S * (0.6 + hash(i, 5));
      const a = t * (2 + 4 * hash(i, 6));
      const c = Math.cos(a);
      const s = Math.sin(a);
      ctx.globalAlpha = 0.9 * alpha;
      ctx.fillStyle = i % 3 === 0 ? GOLD : i % 3 === 1 ? color : "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x + c * -size - s * -0.5 * size, y + s * -size + c * -0.5 * size);
      ctx.lineTo(x + c * size - s * -0.5 * size, y + s * size + c * -0.5 * size);
      ctx.lineTo(x + c * size - s * 0.5 * size, y + s * size + c * 0.5 * size);
      ctx.lineTo(x + c * -size - s * 0.5 * size, y + s * -size + c * 0.5 * size);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}

/** A team's colour: the Teams roster's (the page hands it in), else the built-in pair – the colour of its fighters' rings. */
function teamColor(fr: FlFrame, team: number): string {
  const colors = fr.o && fr.o.teamColors && fr.o.teamColors.length >= 2 ? fr.o.teamColors : TEAM_COLORS;
  return colors[team] ?? TEAM_COLORS[team % TEAM_COLORS.length];
}

// --- fl-overhaul --- (Stage 6) the tier list card
/** The words of a tier list card (the Controls messages flTierTitle, flTierSubtitle, flTierDisclaimer – in the page's language). */
export interface FlTierLabels {
  /** "Marvel tier list (Fight League sim)". */
  title: string;
  /** "Ranked by simulated round-robin wins". */
  subtitle: string;
  /** The disclaimer line: plain-text names of an unaffiliated fan simulation. */
  disclaimer: string;
}

/**
 * Draws the tier list card of a division or a conference (`group`) into `ctx` at `size` (1080 × 1350 or 1080 × 1920, an
 * offscreen canvas the panel turns into a PNG): the lilac stage, the title and its subtitle, five rows S–D each with its
 * coloured label box and its fighters – a mini ball in the fighter's colours and look (`drawFlBodyIcon()`), the short name and
 * the round-robin win share – and the disclaimer line. A still card: plain paths and text, no logo, no reference branding.
 * Returns the layout it drew (every fighter placed once, `flTierLayout()`).
 */
export function tierCard(ctx: CanvasRenderingContext2D, group: FlTierGroup, size: { width: number; height: number }, labels: FlTierLabels): FlTierLayout {
  const L = flTierLayout(group, size.width, size.height);
  const W = L.width;
  const H = L.height;
  const lilac = STAGE_PALETTES.lilac;
  ctx.save();
  ctx.fillStyle = lilac.backdropTop ?? "#d9cef7";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = lilac.backdropBottom ?? "#c4b4ee";
  ctx.fillRect(0, 0.5 * H, W, 0.5 * H);
  // faint 45° stripes, as on the stage
  ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
  ctx.lineWidth = 0.012 * W;
  ctx.beginPath();
  for (let x = -H; x < W; x += 0.06 * W) {
    ctx.moveTo(x, H);
    ctx.lineTo(x + H, 0);
  }
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = flFont("display", L.titleSize);
  fitText(ctx, labels.title, W / 2, L.titleY, W - 2 * L.pad);
  ctx.font = flFont("ui", L.subtitleSize, 700);
  ctx.fillStyle = "rgba(30, 27, 46, 0.8)";
  fitText(ctx, labels.subtitle, W / 2, L.subtitleY, W - 2 * L.pad);
  for (const row of L.rows) {
    // the row's white card with an ink border, its tier box on the left
    roundRectPath(ctx, L.pad, row.y, W - 2 * L.pad, row.h, 0.012 * W);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = Math.max(2, 0.004 * W);
    ctx.strokeStyle = INK;
    ctx.stroke();
    roundRectPath(ctx, L.pad, row.y, L.labelW, row.h, 0.012 * W);
    ctx.fillStyle = FL_TIER_COLORS[row.tier];
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.textBaseline = "middle";
    ctx.font = flFont("display", Math.min(0.09 * W, 0.6 * row.h));
    ctx.fillText(row.tier, L.pad + L.labelW / 2, row.y + row.h / 2);
    ctx.textBaseline = "alphabetic";
    for (const cell of row.cells) {
      ctx.save();
      ctx.translate(cell.x, cell.y);
      drawFlBodyIcon(ctx, cell.r, cell.entry.row, "#ffffff", INK);
      ctx.restore();
      ctx.fillStyle = INK;
      ctx.font = flFont("ui", L.nameSize, 800);
      fitText(ctx, flShortName(cell.entry.row), cell.x, cell.y + 1.3 * cell.r + 0.75 * L.nameSize, 2.75 * cell.r);
      ctx.fillStyle = "rgba(30, 27, 46, 0.72)";
      ctx.font = flFont("mono", L.winSize);
      ctx.fillText(flTierWinText(cell.entry), cell.x, cell.y + 1.3 * cell.r + 0.9 * L.nameSize + 0.95 * L.winSize);
    }
  }
  ctx.fillStyle = "rgba(30, 27, 46, 0.78)";
  ctx.font = flFont("ui", L.footerSize, 600);
  fitText(ctx, labels.disclaimer, W / 2, L.footerY, W - 2 * L.pad);
  ctx.restore();
  return L;
}

/** fillText centred at (x, y), squeezed to `maxW` when it is wider. */
function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  const w = ctx.measureText(text).width;
  if (w > maxW && w > 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(maxW / w, 1);
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else ctx.fillText(text, x, y);
}
// --- end fl-overhaul ---
