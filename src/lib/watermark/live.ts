import { LICENSE_STORAGE_KEY } from "@/lib/billing/config";
import { getEntitlementStore } from "@/lib/billing/entitlement";
import { BADGE_HEIGHT, type FrameRect } from "./layout";
import { LiveHud, liveBadgeBox, placeLiveBadge, type LiveBadgeBox, type LivePlacement, type LiveRecording } from "./liveLayout";
import { buildBadgeSprite, buildTileLayer, type BadgeSprite, type TileLayer } from "./paint";
import { sealVerdict, sealWatermark, type WatermarkSeal } from "./seal";

/*
 * --- watermark-everywhere --- The watermark on every frame of a LIVE simulation a visitor without a Pro licence sees: the
 * simulator's canvas in every mode (and so the share links, the daily challenge, the gallery's presets and the Windows app,
 * which runs the same page), a split-screen race's composed frame (once, not per arena) and the landing page's live preview.
 *
 * THE DECISION is free-watermark's gate (seal.ts), not a second one: the live gate holds a `WatermarkSeal` from
 * `sealWatermark()` – the stored licence verified again (signature, header, payload, expiry) with the built-ins captured when
 * the bundle loaded – in this module's private state, and asks `sealVerdict()` every frame. Until the first verification
 * answers there is no seal, which is marked. It seals again whenever the licence can have changed – the entitlement store
 * reports a change (a licence installed, restored or removed, another tab's storage event, the focus, a licence that ran out),
 * the stored licence is no longer the one the seal verified (checked every second: marked at once, until the new one
 * verifies) – and once a minute anyway. So activating Pro removes the mark from the next frame on, mid-run too, and removing
 * the licence brings it back. Nothing outside reaches the seal: no setter, option, DOM attribute, class, data-* attribute,
 * CSS variable, global, URL parameter or storage flag – the canvas' data-* attributes say nothing about the mark either.
 *
 * THE MARK is drawn into the canvas' own pixels, as the frame's last pass (`stampLiveFrame()`, which the canvas calls after
 * everything else it draws – never a DOM overlay, a CSS pseudo-element or a second canvas): the free-watermark badge and tiles
 * (paint.ts builds both), placed by liveLayout.ts. Cheap: one badge sprite (per badge height: the live one and, while a
 * recording runs, the video layout's) and one tile layer per canvas size are cached per canvas, so a frame costs two
 * `drawImage()` calls. A mark that cannot be built (a canvas that draws nothing) is tried again a second later; meanwhile the
 * frame counts as unmarked, so the page recorder stamps its own.
 *
 * ONE BADGE PER VIDEO FRAME: the page recorder copies this canvas into its frames, so they already carry the mark – it asks
 * `liveMarkCovers(source)` and adds no badge of its own when the source's last frame was marked here (recorder.ts). The fast
 * export, the batch render, the viral bot and the desktop queue render on canvases of their own, never stamped here (the
 * canvas skips the live pass in its offline mode), and keep their own pass.
 */

/** `WeakMap`'s get/set as they were when the bundle loaded (like seal.ts: a console patch of the prototype reaches nothing). */
const weakGet: <V>(map: WeakMap<object, V>, key: object) => V | undefined = Function.prototype.call.bind(WeakMap.prototype.get);
const weakSet: <V>(map: WeakMap<object, V>, key: object, value: V) => unknown = Function.prototype.call.bind(WeakMap.prototype.set);

/** How often the stored licence is compared with the one the seal verified (ms). */
const CHECK_MS = 1000;
/** How often the licence is verified again in any case (ms): a licence past its exp is marked within a minute. */
const RESEAL_MS = 60_000;
/** After a mark that could not be built, the next try (ms). */
const RETRY_MS = 1000;

/** The seal every live frame is drawn under (null: none yet – marked). */
let liveSeal: WatermarkSeal | null = null;
/** The stored licence `liveSeal` was made from. */
let liveToken: string | null = null;
let generation = 0;
let sealing: Promise<void> | null = null;
let again = false;
let started = false;

function storedToken(): string | null {
  try {
    const value = (globalThis as { localStorage?: Storage }).localStorage?.getItem(LICENSE_STORAGE_KEY);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** Verifies the stored licence again (one at a time; a request meanwhile runs once more after it). */
function reseal(): Promise<void> {
  if (sealing) {
    again = true;
    return sealing;
  }
  const token = storedToken();
  if (token !== liveToken) liveSeal = null; // another licence (or none) than the one verified: marked until it verifies
  const gen = ++generation;
  sealing = sealWatermark()
    .then((seal) => {
      if (gen !== generation) return;
      // the licence changed while it was being verified: the seal is not this licence's – marked, and verified once more
      if (storedToken() !== token) {
        liveSeal = null;
        again = true;
        return;
      }
      liveSeal = seal;
      liveToken = token;
    })
    .catch(() => {
      if (gen === generation) liveSeal = null;
    })
    .finally(() => {
      sealing = null;
      if (again) {
        again = false;
        void reseal();
      }
    });
  return sealing;
}

/** The licence stored now is not the one the seal verified: marked at once, then verified. */
function recheck(): void {
  if (storedToken() !== liveToken) {
    liveSeal = null;
    void reseal();
  }
}

function startLiveGate(): void {
  if (started) return;
  started = true;
  try {
    getEntitlementStore().subscribe(recheck);
  } catch {
    /* no store: the timers below still watch the stored licence */
  }
  const win = typeof window !== "undefined" ? window : null;
  win?.addEventListener("storage", recheck);
  win?.addEventListener("focus", recheck);
  const unref = (t: unknown) => (t as { unref?: () => void } | null)?.unref?.();
  unref(setInterval(recheck, CHECK_MS));
  unref(setInterval(() => void reseal(), RESEAL_MS));
  void reseal();
}

/**
 * Starts the live gate (idempotent) and resolves once the verification in flight has answered – the canvases call it when
 * they start, so a Pro visitor's first frames are clean as soon as possible; the tests wait on it.
 */
export async function primeLiveWatermark(): Promise<void> {
  startLiveGate();
  while (sealing) await sealing;
}

/** One frame of a live canvas, as the canvas hands it over after drawing everything else. */
export interface LiveFrame {
  /** The canvas the frame was drawn into (its size in canvas px is `width` × `height`) and its 2D context. */
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  /** The frame's clock (ms, e.g. the rAF timestamp): the badge's side changes every 6 s of it. */
  nowMs: number;
  /** Where the badge may go (canvas px); default: the canvas' centred square – what the page recorder crops. */
  area?: FrameRect | null;
  /** While the page recorder records this canvas: when its clip started (on `nowMs`'s clock) and its export frame. */
  recording?: (LiveRecording & { startMs: number }) | null;
  /** The HUD this frame drew (the badge keeps clear of it). */
  hud?: LiveHud | null;
}

/** What a canvas keeps between frames: its caches, its clock and whether its last frame carried the mark. */
interface CanvasMark {
  origin: number;
  sprites: { height: number; sprite: BadgeSprite }[];
  tiles: TileLayer | null;
  covered: boolean;
  coveredWidth: number;
  coveredHeight: number;
  retryAt: number;
  area: FrameRect;
  box: LiveBadgeBox;
  /** What `box` was computed for (area x, y, width, height, export width, height): recomputed only when one changes. */
  boxFor: Float64Array;
  placement: LivePlacement;
}

const canvases = new WeakMap<object, CanvasMark>();

function markOf(canvas: object, nowMs: number): CanvasMark {
  let state = weakGet(canvases, canvas);
  if (!state) {
    state = {
      origin: nowMs,
      sprites: [],
      tiles: null,
      covered: false,
      coveredWidth: 0,
      coveredHeight: 0,
      retryAt: -Infinity,
      area: { x: 0, y: 0, width: 0, height: 0 },
      box: { height: 0, inset: 0, zone: { x: 0, y: 0, width: 0, height: 0 } },
      boxFor: new Float64Array(6).fill(Number.NaN),
      placement: { x: 0, y: 0, width: 0, height: 0, corner: "bottom-left", free: true },
    };
    weakSet(canvases, canvas, state);
  }
  return state;
}

/** The badge sprite of `height` px (two kept: the live height and a recording's). */
function spriteOf(state: CanvasMark, height: number): BadgeSprite {
  for (const s of state.sprites) if (s.height === height) return s.sprite;
  // buildBadgeSprite sizes the badge from the exported square it is given (5.2 % of it): the square whose badge is `height` tall
  const sprite = buildBadgeSprite(height / BADGE_HEIGHT);
  state.sprites.unshift({ height, sprite });
  if (state.sprites.length > 2) state.sprites.length = 2;
  return sprite;
}

/** The tile layer of the canvas' size. */
function tilesOf(state: CanvasMark, width: number, height: number): TileLayer {
  if (!state.tiles || state.tiles.width !== width || state.tiles.height !== height) state.tiles = buildTileLayer(width, height);
  return state.tiles;
}

/**
 * The frame's last pass: draws the watermark into `frame.canvas` – the tiles over the whole canvas, the badge in its corner
 * of the moment – unless the live seal is a verified Pro licence's. Never throws (a mark that cannot be built is tried again
 * later); whatever transform, opacity, compositing, shadow or filter the frame left behind is reset for the two draws.
 */
export function stampLiveFrame(frame: LiveFrame): void {
  startLiveGate();
  const { canvas, ctx } = frame;
  const now = Number.isFinite(frame.nowMs) ? frame.nowMs : 0;
  const state = markOf(canvas, now);
  state.covered = false;
  if (sealVerdict(liveSeal) === "clean") return;
  const width = canvas.width;
  const height = canvas.height;
  if (!(width > 0 && height > 0) || now < state.retryAt) return;
  try {
    const area = state.area;
    if (frame.area) {
      area.x = frame.area.x;
      area.y = frame.area.y;
      area.width = frame.area.width;
      area.height = frame.area.height;
    } else {
      const side = Math.min(width, height);
      area.x = (width - side) / 2;
      area.y = (height - side) / 2;
      area.width = side;
      area.height = side;
    }
    const rec = frame.recording && frame.recording.width > 0 && frame.recording.height > 0 ? frame.recording : null;
    const f = state.boxFor;
    const rw = rec ? rec.width : 0;
    const rh = rec ? rec.height : 0;
    if (f[0] !== area.x || f[1] !== area.y || f[2] !== area.width || f[3] !== area.height || f[4] !== rw || f[5] !== rh) {
      liveBadgeBox({ area, recording: rec }, state.box);
      f[0] = area.x;
      f[1] = area.y;
      f[2] = area.width;
      f[3] = area.height;
      f[4] = rw;
      f[5] = rh;
    }
    const box = state.box;
    const sprite = spriteOf(state, box.height);
    const tiles = tilesOf(state, width, height);
    const clipMs = rec ? now - rec.startMs : now - state.origin;
    const spot = placeLiveBadge(box, sprite.width, sprite.height, clipMs, frame.hud ?? null, state.placement);
    const pad = sprite.metrics.shadowPad;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowColor = "rgba(0, 0, 0, 0)";
    ctx.shadowBlur = 0;
    if (typeof (ctx as { filter?: unknown }).filter === "string") ctx.filter = "none";
    ctx.drawImage(tiles.canvas, 0, 0);
    ctx.drawImage(sprite.canvas, spot.x - pad, spot.y - pad);
    ctx.restore();
    state.covered = true;
    state.coveredWidth = width;
    state.coveredHeight = height;
  } catch {
    state.retryAt = now + RETRY_MS;
  }
}

/**
 * Whether `canvas`' last frame carried the live mark (drawn by `stampLiveFrame()` and the canvas not resized since): the
 * page recorder, which copies the canvas, then adds no badge of its own – one badge per video frame.
 */
export function liveMarkCovers(canvas: unknown): boolean {
  if (typeof canvas !== "object" || canvas === null) return false;
  const state = weakGet(canvases, canvas);
  if (!state || !state.covered) return false;
  const c = canvas as { width?: unknown; height?: unknown };
  return c.width === state.coveredWidth && c.height === state.coveredHeight;
}

export { LiveHud };

// Start verifying as soon as the bundle runs in a browser, so a Pro visitor's first frames are clean as soon as possible.
if (typeof window !== "undefined" && typeof document !== "undefined") startLiveGate();
