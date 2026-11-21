import { HIT_FLASH_MS, LIGHT_POP_MS, NOTE_PULSE_MS, REWIND_MS, angleOf, tileHue, type SongRingTuneId, type SongRingView } from "@/lib/physics/modes/songRing";
import type { LiveHud } from "@/lib/watermark/liveLayout";

/**
 * Canvas drawing of Song Ring (feature song-ring, lib/physics/modes/songRing.ts). The canvas calls, per frame:
 * `drawWorld()` under the balls (the glow around the ring, its floor, the faint staff circles, the note tiles – bars standing on the outside of the wall, as
 * tall and as warm as their pitch, dim while dark and glowing once lit, swelling when the playhead plays them –, the wall,
 * the hub, the ripples of the finale's notes and the playhead: a bright spoke with a sweep of light behind it), `drawEffects()` over
 * the balls (the sparks and the chord's flash) and `drawOverlay()` in screen space (the count of the notes lit and the
 * line under it, in the hub; gone once the chord falls and the canvas names the tune). Everything animates on the mode's
 * clock (`view.timeMs`) and from its state, so a pause freezes it, a recording replays it and the fast export draws the
 * same frame; nothing is allocated per frame (colours, strings and gradients are kept) and nothing is blurred (a
 * `shadowBlur` draw is a blur pass each: the glows are wide soft strokes). The end's words – the tune's name, only then –
 * are the canvas' shared end banner's (endBanner.ts), which fits a long name of another language to the square.
 */

export interface SongRingRenderOptions {
  /** The wall colour with an alpha. */
  wallAlpha: (alpha: number) => string;
  wallThickness: number;
  showWallGlow: boolean;
}

export interface SongRingLabels {
  /** The line under the count: what the viewer is asked. */
  caption: string;
  /** "3/7" */
  count: (lit: number, total: number) => string;
  /** The tune's name, for the end banner (never drawn before the chord). */
  song: (id: SongRingTuneId) => string;
  /** The end banner's second line. */
  doneSub: (notes: number, seconds: string) => string;
  timeoutTitle: string;
  timeoutSub: (lit: number, total: number) => string;
}

const SONG_NAMES: Readonly<Record<SongRingTuneId, string>> = { twinkle: "TWINKLE TWINKLE", ode: "ODE TO JOY", elise: "FÜR ELISE", jacques: "FRÈRE JACQUES", mountain: "MOUNTAIN KING" };

export const DEFAULT_SONG_RING_LABELS: SongRingLabels = {
  caption: "NAME THE TUNE",
  count: (lit, total) => `${lit}/${total}`,
  song: (id) => SONG_NAMES[id],
  doneSub: (notes, seconds) => `${notes} notes in ${seconds} s`,
  timeoutTitle: "TIME'S UP",
  timeoutSub: (lit, total) => `${lit} of ${total} notes`,
};

const TWO_PI = Math.PI * 2;
/** Half the gap between two tiles (radians), the slices of the playhead's sweep and how far back it reaches (share of a lap). */
export const TILE_GAP = 0.02;
export const TAIL_SLICES = 14;
export const TAIL_TURN = 0.12;
/** A lit tile's glow: the widths (world px at the tuned side) of its three strokes, and how much each grows while the tile pops or sounds. */
const HALO_WIDTHS = [18, 11, 5] as const;
const HALO_SWELL = [16, 10, 5] as const;
/** The share of a slot of the phrase a lit tile's nod lasts. */
export const BEAT_NOD = 0.4;
/** How far from the centre the glow around the ring reaches (share of the square's side: to its edge, where it is gone). */
export const GLOW_REACH = 0.5;
/** How long the chord's flash and a finale note's ripple last (ms). */
export const CHORD_FLASH_MS = 650;
export const RIPPLE_MS = 620;

/** 1 at `ageMs` 0 falling to 0 at `lengthMs` (0 before and after). */
export function fade(ageMs: number, lengthMs: number): number {
  if (!(ageMs >= 0) || ageMs >= lengthMs) return 0;
  return 1 - ageMs / lengthMs;
}

/** A tile's height (px): from the lowest band to the highest by its pitch level. */
export function tileHeight(view: Pick<SongRingView, "layout" | "tiles">, tile: number): number {
  const L = view.layout;
  if (!L) return 0;
  return L.bandMin + (L.bandMax - L.bandMin) * view.tiles.level[tile];
}

/** A tile's fill while dark and once lit, its outline and its glow (one object per hue, kept). */
interface TileColours {
  dark: string;
  lit: string;
  edge: string;
  halo: string;
}
const tileColours = new Map<number, TileColours>();
const sparkFill = new Map<number, string>();
function colours(hue: number): TileColours {
  const key = Math.round(hue);
  let c = tileColours.get(key);
  if (c === undefined) {
    c = { dark: `hsla(${key}, 78%, 60%, 0.36)`, lit: `hsl(${key}, 96%, 62%)`, edge: `hsla(${key}, 96%, 76%, 0.95)`, halo: `hsla(${key}, 96%, 62%, 0.1)` };
    tileColours.set(key, c);
  }
  return c;
}

/** The seconds from the start to the last tile, for the banner. */
export function completeSeconds(view: Pick<SongRingView, "completeMs">): string {
  return (Math.max(0, view.completeMs) / 1000).toFixed(1);
}

export class SongRingLayer {
  private countKey = -1;
  private countText = "";
  private captionKey = "";
  private captionScale = 1;
  /** The hub's box as the last `drawOverlay()` drew it (w 0: nothing drawn), for the live watermark. */
  readonly hudBox = { x: 0, y: 0, w: 0, h: 0 };
  /**
   * The gradients kept between frames: the glow's and the floor's per count of lit notes, a lit tile's wedge per hue and
   * pulse level, the chord's halo. A gradient belongs to its context and holds its geometry, so they are dropped when either changes.
   */
  private gradCtx: CanvasRenderingContext2D | null = null;
  private readonly gradAt = [NaN, NaN, NaN, NaN, NaN];
  private readonly glows = new Map<number, CanvasGradient>();
  private readonly floors = new Map<number, CanvasGradient>();
  private readonly beams = new Map<number, CanvasGradient>();
  private halo: CanvasGradient | null = null;

  /** Drops the kept gradients when the context or the ring's geometry is another than they were built for. */
  private keepGradients(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number, hub: number, band: number) {
    const at = this.gradAt;
    if (ctx === this.gradCtx && at[0] === cx && at[1] === cy && at[2] === radius && at[3] === hub && at[4] === band) return;
    this.gradCtx = ctx;
    at[0] = cx;
    at[1] = cy;
    at[2] = radius;
    at[3] = hub;
    at[4] = band;
    this.glows.clear();
    this.floors.clear();
    this.beams.clear();
    this.halo = null;
  }

  /** Under the balls: the staff, the tiles, the wall, the hub, the ripples and the playhead. */
  drawWorld(ctx: CanvasRenderingContext2D, view: SongRingView, opts: SongRingRenderOptions) {
    const L = view.layout;
    if (!L) return;
    const T = view.tiles;
    const now = view.timeMs;
    const k = L.side / 450;
    const R = L.radius;
    const finale = view.phase === "finale" || view.phase === "rewind" || view.phase === "chord";
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
    ctx.lineJoin = "round";
    this.keepGradients(ctx, L.cx, L.cy, R, L.hub, L.bandMax);
    // The glow around the ring, stronger with every note found (a gradient per count, kept). It is gone at the square's edge:
    // a glow cut off there would show the square as a box in the exported frame.
    let glow = this.glows.get(view.lit);
    if (glow === undefined) {
      const lit = view.total > 0 ? view.lit / view.total : 0;
      glow = ctx.createRadialGradient(L.cx, L.cy, 0.8 * R, L.cx, L.cy, GLOW_REACH * L.side);
      glow.addColorStop(0, `rgba(116, 88, 255, ${(0.2 + 0.26 * lit).toFixed(3)})`);
      glow.addColorStop(0.6, `rgba(116, 88, 255, ${(0.1 + 0.14 * lit).toFixed(3)})`);
      glow.addColorStop(1, "rgba(116, 88, 255, 0)");
      this.glows.set(view.lit, glow);
    }
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, GLOW_REACH * L.side, 0, TWO_PI);
    ctx.fill();
    // The floor of the ring: a soft glow that warms as the notes are found (a gradient per count of lit notes, kept).
    let floor = this.floors.get(view.lit);
    if (floor === undefined) {
      const share = view.total > 0 ? view.lit / view.total : 0;
      floor = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, R);
      floor.addColorStop(0, `rgba(124, 92, 255, ${(0.2 + 0.14 * share).toFixed(3)})`);
      floor.addColorStop(1, `rgba(56, 80, 220, ${(0.08 + 0.1 * share).toFixed(3)})`);
      this.floors.set(view.lit, floor);
    }
    ctx.fillStyle = floor;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R, 0, TWO_PI);
    ctx.fill();
    // The staff: three faint circles where the lowest, the middle and the highest note end.
    ctx.lineWidth = Math.max(0.75, 0.8 * k);
    ctx.strokeStyle = opts.wallAlpha(0.1);
    for (let s = 0; s < 3; s++) {
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, R + L.bandMin + ((L.bandMax - L.bandMin) * s) / 2, 0, TWO_PI);
      ctx.stroke();
    }
    // The light of the lit tiles: each throws a wedge of its colour in toward the hub, brighter while it sounds.
    for (let i = 0; i < T.count; i++) {
      if (view.litMs[i] < 0) continue;
      const a0 = angleOf(T.start[i]) + TILE_GAP;
      const a1 = angleOf(T.end[i]) - TILE_GAP;
      if (!(a1 > a0)) continue;
      const sung = fade(now - view.playMs[i], NOTE_PULSE_MS);
      // (a gradient per hue and one of eight levels of the note's pulse, kept: none is built in a frame that has them)
      const key = Math.round(tileHue(T.level[i])) * 8 + Math.round(7 * sung);
      let beam = this.beams.get(key);
      if (beam === undefined) {
        beam = ctx.createRadialGradient(L.cx, L.cy, 3 * L.hub, L.cx, L.cy, R);
        beam.addColorStop(0, "rgba(0, 0, 0, 0)");
        beam.addColorStop(1, `hsla(${Math.round(tileHue(T.level[i]))}, 96%, 62%, ${(0.2 + 0.3 * (Math.round(7 * sung) / 7)).toFixed(3)})`);
        this.beams.set(key, beam);
      }
      ctx.fillStyle = beam;
      ctx.beginPath();
      ctx.moveTo(L.cx, L.cy);
      ctx.arc(L.cx, L.cy, R, a0, a1);
      ctx.closePath();
      ctx.fill();
    }
    // The beat: every lit tile nods as the playhead crosses a slot of the phrase, so the tempo shows with the sound off.
    const moving = view.phase === "collect" || view.phase === "finale";
    const slot = moving ? (view.head * T.slots) % 1 : 1;
    const beat = Math.max(0, 1 - slot / BEAT_NOD);
    // The tiles.
    for (let i = 0; i < T.count; i++) {
      const a0 = angleOf(T.start[i]) + TILE_GAP;
      const a1 = angleOf(T.end[i]) - TILE_GAP;
      if (!(a1 > a0)) continue;
      const lit = view.litMs[i] >= 0;
      const pop = lit ? fade(now - view.litMs[i], LIGHT_POP_MS) : 0;
      const sung = fade(now - view.playMs[i], NOTE_PULSE_MS);
      const hit = fade(now - view.hitMs[i], HIT_FLASH_MS);
      const c = colours(tileHue(T.level[i]));
      const h = tileHeight(view, i) * (1 + 0.45 * pop * pop + (finale ? 0.6 : 0.34) * sung * sung + (lit ? 0.1 * beat * beat : 0));
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, R + h, a0, a1);
      ctx.arc(L.cx, L.cy, R, a1, a0, true);
      ctx.closePath();
      if (lit) {
        if (opts.showWallGlow) {
          // (its glow: three faint strokes of its colour round the bar, each narrower, so the light falls off away from it –
          // no blur, which costs a pass per tile every frame)
          const swell = Math.max(pop, sung);
          ctx.strokeStyle = c.halo;
          for (let ring = 0; ring < 3; ring++) {
            ctx.lineWidth = (HALO_WIDTHS[ring] + HALO_SWELL[ring] * swell) * k;
            ctx.stroke();
          }
        }
        ctx.fillStyle = c.lit;
        ctx.fill();
        const white = Math.max(0.85 * pop, 0.7 * sung);
        if (white > 0) {
          ctx.fillStyle = `rgba(255, 255, 255, ${white.toFixed(3)})`;
          ctx.fill();
        }
      } else {
        ctx.fillStyle = c.dark;
        ctx.fill();
        ctx.lineWidth = Math.max(1, 1.6 * k);
        ctx.strokeStyle = c.edge;
        ctx.stroke();
      }
      if (hit > 0) {
        // The ball's hit: the tile's face on the wall flashes.
        ctx.strokeStyle = `rgba(255, 255, 255, ${(0.9 * hit).toFixed(3)})`;
        ctx.lineWidth = (2 + 3 * hit) * k;
        ctx.beginPath();
        ctx.arc(L.cx, L.cy, R + 1.5 * k, a0, a1);
        ctx.stroke();
      }
    }
    // The wall.
    ctx.lineWidth = Math.max(1.2, 0.7 * opts.wallThickness) * k;
    ctx.strokeStyle = opts.wallAlpha(0.55);
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, R, 0, TWO_PI);
    ctx.stroke();
    // The finale's ripples: every note sends a circle from the hub out to the wall in its own colour.
    if (finale) {
      ctx.lineWidth = 2 * k;
      for (let i = 0; i < T.count; i++) {
        const u = 1 - fade(now - view.playMs[i], RIPPLE_MS);
        if (u >= 1) continue;
        ctx.strokeStyle = `hsla(${Math.round(tileHue(T.level[i]))}, 96%, 68%, ${(0.55 * (1 - u)).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(L.cx, L.cy, L.hub + (R - L.hub) * u, 0, TWO_PI);
        ctx.stroke();
      }
    }
    // The hub.
    const hubR = this.hubRadius(view);
    ctx.fillStyle = "rgba(8, 10, 24, 0.55)";
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, hubR, 0, TWO_PI);
    ctx.fill();
    ctx.lineWidth = Math.max(1, 1.2 * k);
    ctx.strokeStyle = opts.wallAlpha(0.28);
    ctx.stroke();
    // The playhead: its sweep of light behind it, then the spoke itself, from the hub to past the highest tile.
    if (view.phase !== "chord" && view.phase !== "timeout") {
      const winding = view.phase === "rewind";
      const reach = R + L.bandMax + 5 * k;
      const tail = winding ? 0.22 : TAIL_TURN;
      // (the sweep: slices of light from the hub to the wall, fading away from the spoke like a radar's)
      for (let s = 0; s < TAIL_SLICES; s++) {
        const a1 = angleOf(view.head - (tail * s) / TAIL_SLICES);
        const a0 = angleOf(view.head - (tail * (s + 1)) / TAIL_SLICES);
        const fall = 1 - s / TAIL_SLICES;
        ctx.fillStyle = `rgba(200, 210, 255, ${(0.34 * fall * fall).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(L.cx, L.cy, R, a0, a1);
        ctx.arc(L.cx, L.cy, hubR, a1, a0, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.lineCap = "round";
      const a = angleOf(view.head);
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      ctx.beginPath();
      ctx.moveTo(L.cx + cos * hubR, L.cy + sin * hubR);
      ctx.lineTo(L.cx + cos * reach, L.cy + sin * reach);
      if (opts.showWallGlow) {
        // (its glow: the same line wider and faint, twice – no blur)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
        ctx.lineWidth = 11 * k;
        ctx.stroke();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.28)";
        ctx.lineWidth = 6 * k;
        ctx.stroke();
      }
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2.6 * k;
      ctx.stroke();
      // (its head: a bright bead riding the wall, in a faint ring of light)
      if (opts.showWallGlow) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
        ctx.beginPath();
        ctx.arc(L.cx + cos * R, L.cy + sin * R, 7.5 * k, 0, TWO_PI);
        ctx.fill();
      }
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(L.cx + cos * R, L.cy + sin * R, 3.6 * k, 0, TWO_PI);
      ctx.fill();
    }
    ctx.restore();
  }

  /** The hub's radius: three times the layout's own, so the count fits inside it. */
  private hubRadius(view: SongRingView): number {
    return view.layout ? 3 * view.layout.hub : 0;
  }

  /** Over the balls: the sparks, and the chord's flash over the whole ring. */
  drawEffects(ctx: CanvasRenderingContext2D, view: SongRingView) {
    const L = view.layout;
    if (!L) return;
    ctx.save();
    ctx.globalAlpha = 1;
    for (let i = 0; i < view.sparkCount; i++) {
      const life = view.sparkMaxLife[i] > 0 ? view.sparkLife[i] / view.sparkMaxLife[i] : 0;
      const hue = view.sparkHue[i];
      // (its colour at one of sixteen levels of its fade, kept per hue)
      const level = Math.round(15 * Math.max(0, Math.min(1, 1.5 * life)));
      const key = (hue < 0 ? 400 : Math.round(hue)) * 16 + level;
      let fill = sparkFill.get(key);
      if (fill === undefined) {
        fill = hue < 0 ? `rgba(255, 255, 255, ${(level / 15).toFixed(3)})` : `hsla(${Math.round(hue)}, 96%, 70%, ${(level / 15).toFixed(3)})`;
        sparkFill.set(key, fill);
      }
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(view.sparkX[i], view.sparkY[i], view.sparkSize[i] * (0.5 + 0.5 * life), 0, TWO_PI);
      ctx.fill();
    }
    const flash = Math.max(fade(view.timeMs - view.chordMs, CHORD_FLASH_MS), 0.6 * fade(view.timeMs - view.completeMs, 0.5 * REWIND_MS));
    if (flash > 0 && (view.chordMs >= 0 || view.completeMs >= 0)) {
      // (a halo round the wall: the middle stays clear for the count and the tune's name; one gradient, kept, faded by the alpha)
      this.keepGradients(ctx, L.cx, L.cy, L.radius, L.hub, L.bandMax);
      if (!this.halo) {
        this.halo = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, L.radius + L.bandMax);
        this.halo.addColorStop(0, "rgba(255, 255, 255, 0)");
        this.halo.addColorStop(0.5, "rgba(255, 255, 255, 0)");
        this.halo.addColorStop(0.86, "rgba(255, 255, 255, 0.6)");
        this.halo.addColorStop(1, "rgba(255, 255, 255, 0)");
      }
      ctx.globalAlpha = flash;
      ctx.fillStyle = this.halo;
      ctx.beginPath();
      ctx.arc(L.cx, L.cy, L.radius + L.bandMax, 0, TWO_PI);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  /** Screen space: the count of the notes lit and the caption under it, in the hub – until the chord, when the canvas' end banner names the tune there. */
  drawOverlay(ctx: CanvasRenderingContext2D, view: SongRingView, labels: SongRingLabels) {
    const L = view.layout;
    this.hudBox.w = 0;
    if (!L) return;
    // (from the chord – or the timeout – on the middle is the canvas' end banner's: the tune's name on its plate)
    if (view.chordMs >= 0 || view.timeoutMs >= 0) return;
    const hubR = this.hubRadius(view);
    this.hudBox.x = L.cx - hubR;
    this.hudBox.y = L.cy - hubR;
    this.hudBox.w = 2 * hubR;
    this.hudBox.h = 2 * hubR;
    const key = view.lit * 4096 + view.total;
    if (key !== this.countKey) {
      this.countKey = key;
      this.countText = labels.count(view.lit, view.total);
    }
    // The count swells for a moment when a note lights.
    let newest = -1;
    for (let i = 0; i < view.tiles.count; i++) if (view.litMs[i] > newest) newest = view.litMs[i];
    const pop = newest >= 0 ? fade(view.timeMs - newest, LIGHT_POP_MS) : 0;
    const fs = 0.105 * L.side * (1 + 0.22 * pop * pop);
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 ${fs.toFixed(1)}px sans-serif`;
    // (white on the hub's dark disc: it needs no shadow, and a blurred one would cost a pass every frame)
    ctx.fillStyle = "#ffffff";
    ctx.fillText(this.countText, L.cx, L.cy - 0.016 * L.side);
    const cfs = 0.027 * L.side;
    ctx.font = `700 ${cfs.toFixed(1)}px sans-serif`;
    if (labels.caption !== this.captionKey) {
      // (a longer caption of another language is drawn narrower, never past the hub)
      this.captionKey = labels.caption;
      const w = ctx.measureText(labels.caption).width / L.side;
      this.captionScale = w > 0.235 ? 0.235 / w : 1;
    }
    if (this.captionScale !== 1) ctx.font = `700 ${(cfs * this.captionScale).toFixed(1)}px sans-serif`;
    ctx.fillStyle = "rgba(226, 232, 255, 0.9)";
    ctx.fillText(labels.caption, L.cx, L.cy + 0.064 * L.side);
    ctx.restore();
  }

  /** Reports the hub's count to the live watermark's placement (the badge keeps off it; the end banner reports its own plate). */
  noteHud(hud: LiveHud) {
    const box = this.hudBox;
    if (box.w > 0) hud.block(box.x, box.y, box.w, box.h);
  }
}

/** The data-song-* attributes the canvas mirrors for tools and the smoke test. */
export const SONG_RING_DATA_KEYS = ["songLit", "songTotal", "songHits", "songNotes", "songNudges", "songBalls", "songPhase", "songComplete", "songChord", "songTimeout", "songFinished", "songFinishedMs", "songTune"];

/** Writes the view's state into the data-song-* attributes (`set` only writes a changed value). The tune's id appears only once the chord has named it. */
export class SongRingDataset {
  write(view: SongRingView, set: (key: string, value: string) => void) {
    set("songLit", String(view.lit));
    set("songTotal", String(view.total));
    set("songHits", String(view.hits));
    set("songNotes", String(view.notes));
    set("songNudges", String(view.nudges));
    set("songBalls", String(view.balls));
    set("songPhase", view.phase);
    set("songComplete", view.completeMs >= 0 ? "1" : "0");
    set("songChord", view.chordMs >= 0 ? "1" : "0");
    set("songTimeout", view.timeoutMs >= 0 ? "1" : "0");
    set("songFinished", view.finished ? "1" : "0");
    set("songFinishedMs", String(Math.round(view.finishedMs)));
    set("songTune", view.chordMs >= 0 ? view.song : "");
  }
}
