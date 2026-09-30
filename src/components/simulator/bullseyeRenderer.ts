import { KIND_BUMPER, MAX_BULLSEYE_RINGS, SHOT_LANDED, type BullseyeView } from "@/lib/physics/modes/bullseye";

/**
 * Canvas drawing of Bullseye (feature boris-bullseye, lib/physics/modes/bullseye.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls, after the generic obstacle pass has drawn the side walls, pegs and bumpers – the
 * bumpers' lime rings, the landing line, the target (a dartboard lying on the floor: concentric ellipses in dartboard
 * colours, a ring lighting up when a ball lands in it) and the launcher at the top, turning toward the next shot and
 * recoiling when it fires; the balls themselves are the canvas' ordinary balls (faces, emoji, trails – the stuck ones
 * too); `drawEffects()` over them – the score popups rising from every landing and the bullseye's starburst; and
 * `drawOverlay()` in screen space – the shot counter, the running total and the big "BULLSEYE!". Everything animates
 * on the mode's world clock (`view.timeMs`), so a pause freezes it, the slow motion slows it and a recording replays
 * it; nothing is allocated per frame (strings are cached).
 */

export interface BullseyeRenderOptions {
  /** The wall colour with an alpha (the landing line, the target's rim). */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
}

export interface BullseyeLabels {
  /** The HUD's title. */
  title: string;
  /** "SHOT 3/12" */
  shot: (n: number, total: number) => string;
  /** The running total's caption. */
  total: string;
  /** The centre hit's callout. */
  bullseye: string;
  /** The popup of a landing off the target. */
  miss: string;
  /** The final banner: the total, and a line with the best shot and the bullseyes. */
  finalTitle: (total: number) => string;
  finalSub: (shot: number, score: number, bullseyes: number) => string;
}

export const DEFAULT_BULLSEYE_LABELS: BullseyeLabels = {
  title: "BULLSEYE",
  shot: (n, total) => `SHOT ${n}/${total}`,
  total: "TOTAL",
  bullseye: "BULLSEYE!",
  miss: "MISS",
  finalTitle: (total) => `TOTAL ${total}`,
  finalSub: (shot, score, bullseyes) => `Best shot #${shot}: ${score} · ${bullseyes} bullseye${bullseyes !== 1 ? "s" : ""}`,
};

/** Dartboard colours of the rings, the bull first (red bull, green outer bull, then cream / black bands with red and green trebles). */
export const RING_COLORS = ["#e3262e", "#10a05a", "#f2e6c9", "#18181b", "#e3262e", "#f2e6c9", "#18181b", "#10a05a", "#f2e6c9", "#18181b"];

/** Colour of a score popup: lime for the bull, cyan, amber and pink further out, grey for a miss. */
export function scoreColor(score: number): string {
  if (score >= 10) return "#93d119";
  if (score >= 7) return "#2de2e6";
  if (score >= 4) return "#ffb238";
  if (score >= 1) return "#ff7ad9";
  return "#9ca3af";
}

/** How long (world ms) a ring glows after a landing, a popup rises, the bullseye callout shows and the launcher recoils. */
export const RING_FLASH_MS = 450;
export const POPUP_MS = 1100;
export const BULLSEYE_MS = 1800;
export const RECOIL_MS = 220;
const TWO_PI = Math.PI * 2;
const RAYS = 12;

export class BullseyeLayer {
  /** "+7" strings by score, so a frame builds none. */
  private readonly popupText: string[] = [];
  private shotKey = "";
  private shotText = "";

  private popup(score: number, miss: string) {
    if (score <= 0) return miss;
    return (this.popupText[score] ??= `+${score}`);
  }

  /** The bumpers' rings, the landing line, the target and the launcher (under the balls). */
  drawWorld(ctx: CanvasRenderingContext2D, view: BullseyeView, opts: BullseyeRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    ctx.save();
    ctx.globalAlpha = 1;
    // Bumpers: a lime ring and a core over the obstacle the canvas drew.
    ctx.lineWidth = Math.max(1.5, 0.35 * L.pegRadius);
    ctx.strokeStyle = "rgba(147, 209, 25, 0.9)";
    ctx.fillStyle = "rgba(147, 209, 25, 0.55)";
    for (let i = 0; i < L.obstacles.length; i++) {
      if (L.kinds[i] !== KIND_BUMPER) continue;
      const o = L.obstacles[i];
      ctx.beginPath();
      ctx.arc(o.x, o.y, 0.62 * L.bumperRadius, 0, TWO_PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(o.x, o.y, 0.25 * L.bumperRadius, 0, TWO_PI);
      ctx.fill();
    }

    // The landing line across the field.
    ctx.lineWidth = Math.max(1, opts.wallThickness);
    ctx.strokeStyle = opts.wallAlpha(0.35);
    ctx.beginPath();
    ctx.moveTo(L.left, L.floorY);
    ctx.lineTo(L.right, L.floorY);
    ctx.stroke();

    // The target: a shadow, then the rings from the outside in, a lit ring over them and the rim.
    const n = Math.max(1, Math.min(MAX_BULLSEYE_RINGS, view.settings.rings));
    const R = L.targetRadius;
    const D = L.targetDepth;
    const tx = view.targetX;
    const ty = L.floorY;
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.beginPath();
    ctx.ellipse(tx, ty + 0.18 * D, 1.03 * R, 1.05 * D, 0, 0, TWO_PI);
    ctx.fill();
    for (let i = n - 1; i >= 0; i--) {
      const k = (i + 1) / n;
      ctx.fillStyle = RING_COLORS[i];
      ctx.beginPath();
      ctx.ellipse(tx, ty, k * R, k * D, 0, 0, TWO_PI);
      ctx.fill();
    }
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(120, 120, 120, 0.55)";
    for (let i = 0; i < n - 1; i++) {
      const k = (i + 1) / n;
      ctx.beginPath();
      ctx.ellipse(tx, ty, k * R, k * D, 0, 0, TWO_PI);
      ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const age = now - view.ringHitMs[i];
      if (!(age >= 0 && age < RING_FLASH_MS)) continue;
      const f = 1 - age / RING_FLASH_MS;
      const outer = (i + 1) / n;
      const inner = i / n;
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.65 * f).toFixed(3)})`;
      ctx.beginPath();
      ctx.ellipse(tx, ty, outer * R, outer * D, 0, 0, TWO_PI);
      if (inner > 0) {
        ctx.moveTo(tx + inner * R, ty);
        ctx.ellipse(tx, ty, inner * R, inner * D, 0, 0, TWO_PI, true);
      }
      ctx.fill("evenodd");
      if (opts.showWallGlow) {
        ctx.lineWidth = 2 + 4 * f;
        ctx.strokeStyle = `rgba(147, 209, 25, ${(0.8 * f).toFixed(3)})`;
        ctx.beginPath();
        ctx.ellipse(tx, ty, outer * R, outer * D, 0, 0, TWO_PI);
        ctx.stroke();
      }
    }
    ctx.lineWidth = Math.max(1.5, opts.wallThickness);
    ctx.strokeStyle = opts.wallAlpha(0.85);
    ctx.beginPath();
    ctx.ellipse(tx, ty, R, D, 0, 0, TWO_PI);
    ctx.stroke();

    // The launcher: a barrel turning toward the next shot (recoiling when it fires) under a round turret, and a flash at the muzzle.
    const since = now - view.launchMs;
    const recoil = since >= 0 && since < RECOIL_MS ? 1 - since / RECOIL_MS : 0;
    const size = Math.max(8, 0.028 * L.fieldHeight);
    const ax = Math.cos(view.aimAngle);
    const ay = Math.sin(view.aimAngle);
    ctx.save();
    ctx.translate(L.launchX, L.launchY);
    ctx.rotate(view.aimAngle - Math.PI / 2);
    ctx.fillStyle = "#27272a";
    ctx.strokeStyle = "#93d119";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(-0.32 * size, -0.2 * size - 0.4 * size * recoil, 0.64 * size, 1.25 * size);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "#3f3f46";
    ctx.strokeStyle = "#93d119";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(L.launchX, L.launchY - 0.15 * size, 0.62 * size, 0, TWO_PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#93d119";
    ctx.beginPath();
    ctx.arc(L.launchX, L.launchY - 0.15 * size, 0.2 * size, 0, TWO_PI);
    ctx.fill();
    if (recoil > 0) {
      ctx.globalAlpha = 0.6 * recoil;
      ctx.beginPath();
      ctx.arc(L.launchX + ax * 1.1 * size, L.launchY + ay * 1.1 * size, 0.45 * size * (1 + recoil), 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** Over the balls: the score popups and the bullseye's starburst. */
  drawEffects(ctx: CanvasRenderingContext2D, view: BullseyeView, labels: BullseyeLabels) {
    const L = view.layout;
    if (!L) return;
    const now = view.timeMs;
    ctx.save();
    ctx.globalAlpha = 1;
    // The bullseye: rays and a ring bursting out of the landing.
    const bAge = now - view.bullseyeMs;
    if (bAge >= 0 && bAge < BULLSEYE_MS) {
      const u = bAge / BULLSEYE_MS;
      const reach = (0.08 + 0.22 * Math.min(1, u * 3)) * L.fieldWidth;
      ctx.globalAlpha = 0.9 * (1 - u);
      ctx.strokeStyle = "#93d119";
      ctx.lineWidth = Math.max(2, 0.008 * L.fieldWidth) * (1 - 0.6 * u);
      ctx.beginPath();
      const spin = 0.6 * u;
      for (let i = 0; i < RAYS; i++) {
        const a = spin + (i * TWO_PI) / RAYS;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.moveTo(view.bullseyeX + 0.45 * reach * c, view.bullseyeY + 0.45 * reach * s);
        ctx.lineTo(view.bullseyeX + reach * c, view.bullseyeY + reach * s);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(view.bullseyeX, view.bullseyeY, 0.7 * reach, 0, TWO_PI);
      ctx.stroke();
    }
    // The popups: the landing's score rising and fading.
    const fs = Math.max(12, 0.04 * L.fieldHeight);
    ctx.font = `900 ${fs.toFixed(1)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(2, 0.18 * fs);
    ctx.strokeStyle = "rgba(0, 0, 0, 0.85)";
    for (let k = 0; k < view.shots; k++) {
      if (view.shotState[k] !== SHOT_LANDED) continue;
      const age = now - view.shotLandMs[k];
      if (!(age >= 0 && age < POPUP_MS)) continue;
      const u = age / POPUP_MS;
      const score = view.shotScore[k];
      const text = this.popup(score, labels.miss);
      const x = Math.max(L.left + fs, Math.min(L.right - fs, view.shotX[k]));
      const y = view.shotY[k] - 1.2 * fs - 1.6 * fs * (1 - (1 - u) * (1 - u));
      ctx.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = scoreColor(score);
      ctx.fillText(text, x, y);
    }
    ctx.restore();
  }

  /**
   * Screen space: the title and the shot counter in the top-left corner of the field, the running total in the top-right
   * one and the big "BULLSEYE!" over the field after a centre hit; `inset` moves the corners below the page's buttons.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: BullseyeView, labels: BullseyeLabels, inset = 0) {
    const L = view.layout;
    if (!L) return;
    const fs = Math.max(11, 0.03 * L.fieldHeight);
    const top = L.top + 0.02 * L.fieldHeight + inset;
    const pad = 0.04 * L.fieldWidth;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.textAlign = "left";
    ctx.font = `800 ${(0.8 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(labels.title, L.left + pad, top + 0.5 * fs);
    const shown = Math.min(view.shots, Math.max(1, view.launched));
    const key = `${shown}/${view.shots}`;
    if (key !== this.shotKey) {
      this.shotKey = key;
      this.shotText = labels.shot(shown, view.shots);
    }
    ctx.font = `700 ${(0.75 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#93d119";
    ctx.fillText(this.shotText, L.left + pad, top + 1.6 * fs);
    ctx.textAlign = "right";
    ctx.font = `800 ${(0.7 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillText(labels.total, L.right - pad, top + 0.5 * fs);
    ctx.font = `900 ${(1.5 * fs).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "#ffffff";
    ctx.fillText(String(view.total), L.right - pad, top + 1.9 * fs);

    // The callout: pops in, holds, fades.
    const age = view.timeMs - view.bullseyeMs;
    if (age >= 0 && age < BULLSEYE_MS) {
      const u = age / BULLSEYE_MS;
      const pop = age < 160 ? 0.6 + 0.55 * (age / 160) : age < 280 ? 1.15 - 0.15 * ((age - 160) / 120) : 1;
      const big = Math.max(24, 0.1 * L.fieldWidth) * pop;
      ctx.globalAlpha = u < 0.75 ? 1 : 1 - (u - 0.75) / 0.25;
      ctx.textAlign = "center";
      ctx.font = `900 ${big.toFixed(1)}px sans-serif`;
      ctx.lineWidth = Math.max(3, 0.12 * big);
      ctx.strokeStyle = "rgba(0, 0, 0, 0.8)";
      const y = L.top + 0.36 * L.fieldHeight;
      ctx.strokeText(labels.bullseye, L.cx, y);
      ctx.shadowColor = "#93d119";
      ctx.shadowBlur = 24;
      ctx.fillStyle = "#93d119";
      ctx.fillText(labels.bullseye, L.cx, y);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }
}

/** The data-bullseye-* attributes the canvas mirrors for tools and the smoke test. */
export const BULLSEYE_DATA_KEYS = [
  "bullseyeShots",
  "bullseyeLaunched",
  "bullseyeLanded",
  "bullseyeTotal",
  "bullseyeBest",
  "bullseyeBestShot",
  "bullseyeBullseyes",
  "bullseyeLastScore",
  "bullseyeScores",
  "bullseyeNotes",
  "bullseyeThuds",
  "bullseyeSlowMos",
  "bullseyeTimeScale",
  "bullseyeRings",
  "bullseyeDeflectors",
  "bullseyeMoving",
  "bullseyeTargetX",
  "bullseyePerfect",
  "bullseyeAllLanded",
  "bullseyeFinished",
  "bullseyeFinishedMs",
];

/** Writes the view's state into the data-bullseye-* attributes (`set` only writes a changed value; the scores string is rebuilt on a landing only). */
export class BullseyeDataset {
  private landed = -1;
  private scores = "";

  write(view: BullseyeView, set: (key: string, value: string) => void) {
    if (view.landed !== this.landed) {
      this.landed = view.landed;
      let out = "";
      for (let k = 0; k < view.shots; k++) if (view.shotState[k] === SHOT_LANDED) out += (out ? "," : "") + view.shotScore[k];
      this.scores = out;
    }
    set("bullseyeShots", String(view.shots));
    set("bullseyeLaunched", String(view.launched));
    set("bullseyeLanded", String(view.landed));
    set("bullseyeTotal", String(view.total));
    set("bullseyeBest", String(view.best));
    set("bullseyeBestShot", String(view.bestShot + 1));
    set("bullseyeBullseyes", String(view.bullseyes));
    set("bullseyeLastScore", String(view.lastScore));
    set("bullseyeScores", this.scores);
    set("bullseyeNotes", String(view.notes));
    set("bullseyeThuds", String(view.thuds));
    set("bullseyeSlowMos", String(view.slowMos));
    set("bullseyeTimeScale", view.timeScale.toFixed(2));
    set("bullseyeRings", String(view.settings.rings));
    set("bullseyeDeflectors", String(view.layout?.deflectors ?? 0));
    set("bullseyeMoving", view.settings.moving ? "1" : "0");
    set("bullseyeTargetX", view.targetX.toFixed(1));
    set("bullseyePerfect", String(view.perfectShot + 1));
    set("bullseyeAllLanded", view.allLanded ? "1" : "0");
    set("bullseyeFinished", view.finished ? "1" : "0");
    set("bullseyeFinishedMs", String(Math.round(view.finishedMs)));
  }
}
