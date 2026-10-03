import type { OgMaterial, OgPalette, OrbGridView, OrbLayout } from "@/lib/physics/modes/orbGrid";

/**
 * Bouncing Orbs' drawing (feature orb-grid; lib/physics/modes/orbGrid.ts). A perspective view of the field: the camera looks
 * at the field's centre from `elevation` degrees above the slab, the field turned by `rotation` degrees (plus a slow
 * auto-orbit on the simulation clock); the field's bounding cylinder is fitted into the square the recorder crops to, so the
 * framing never changes while the camera turns and the centre stays put. `drawWorld()` paints the floor (a slab with a grid
 * over a blue grid floor, a round dark plate, the grid alone, or nothing), `drawOrbs()` the shadows and the orbs, back to front
 * (a counting sort by projected depth – no Array.prototype.sort per frame), each orb a cached sprite (one per colour bucket ×
 * size bucket × material, painted once) lifted by its height along the screen's up axis, `drawOverlay()` the "1089 bouncing
 * orbs" line. No per-orb work allocates: the buffers grow once and are reused every frame.
 *
 * The quality ladder (`orbQuality()`, by orb count – deterministic, so a fast export draws exactly what the page drew; the
 * thresholds are measured – see the README's Bouncing Orbs section): full (shadow + sprite + a gloss glint, 3 draws an orb)
 * up to `QUALITY_GLOSS_MAX`, then no glint (2 draws) up to `QUALITY_SHADOW_MAX`, then no shadows (1 draw) up to
 * `QUALITY_SPRITE_MAX`, then flat discs (one path per colour and depth slice) up to `QUALITY_DISC_MAX`, then points in one
 * image. Every orb is drawn at every level.
 */

/* ------------------------------------------------------------------ camera */

/** Camera distance from the field's centre (field widths): a moderate perspective. */
export const CAMERA_DISTANCE = 2.6;
/** The auto-orbit's speed (degrees of the simulation clock per second). */
export const ORBIT_DEG_PER_SEC = 6;
/** Share of the square's side the field's bounding cylinder fills. */
export const FIELD_FILL = 0.95;
/** The tallest part of a bounce the framing keeps in view (field widths): higher bounces leave the frame at the top. */
export const FIT_TOP_MAX = 0.6;

export interface OrbCamera {
  cosA: number;
  sinA: number;
  cosE: number;
  sinE: number;
  distance: number;
  /** World px per field width at unit depth. */
  focal: number;
  /** Where the field's centre would project at depth 1 (the projection's origin). */
  cx: number;
  cy: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  /** Distance along the view axis (field widths; bigger = farther). */
  depth: number;
  /** World px per field width at this point. */
  scale: number;
}

/** The camera's angle around the field (degrees): the rotation plus the auto-orbit on the simulation clock. */
export function cameraAngleDeg(rotation: number, orbit: boolean, timeSec: number): number {
  return rotation + (orbit ? ORBIT_DEG_PER_SEC * timeSec : 0);
}

/** Projects field point (x, y) at height z (field widths) through `cam` into world px. */
export function projectPoint(cam: OrbCamera, x: number, y: number, z: number, out: ProjectedPoint): ProjectedPoint {
  const xr = x * cam.cosA - y * cam.sinA;
  const yr = x * cam.sinA + y * cam.cosA;
  const cy = yr * cam.sinE + z * cam.cosE;
  const depth = yr * cam.cosE - z * cam.sinE + cam.distance;
  const inv = depth > 1e-6 ? cam.focal / depth : 0;
  out.x = cam.cx + xr * inv;
  out.y = cam.cy - cy * inv;
  out.depth = depth;
  out.scale = inv;
  return out;
}

const FIT_SAMPLES = 24;

/**
 * The camera for a view: its angles, and the focal length and origin that fit the field's bounding cylinder (radius
 * `radius`, from the slab to `top`) into the centred square of a `width × height` world. The fit is the cylinder's, which
 * a turn of the field leaves unchanged – so the field's centre stays where it is whatever the rotation and the orbit.
 */
export function orbCamera(elevationDeg: number, angleDeg: number, width: number, height: number, radius: number, top: number, out: OrbCamera): OrbCamera {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (angleDeg * Math.PI) / 180;
  out.cosE = Math.cos(e);
  out.sinE = Math.sin(e);
  out.cosA = Math.cos(a);
  out.sinA = Math.sin(a);
  out.distance = CAMERA_DISTANCE;
  // The cylinder's outline at unit focal length, seen with the field unturned.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const r = radius > 0 ? radius : 0.5;
  const t = Math.max(0, Math.min(FIT_TOP_MAX, top));
  for (let k = 0; k < FIT_SAMPLES; k++) {
    const ang = (k / FIT_SAMPLES) * 2 * Math.PI;
    const x = r * Math.cos(ang);
    const y = r * Math.sin(ang);
    for (const z of [0, t]) {
      const cy = y * out.sinE + z * out.cosE;
      const depth = y * out.cosE - z * out.sinE + CAMERA_DISTANCE;
      if (depth <= 1e-6) continue;
      const px = x / depth;
      const py = cy / depth;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  }
  const side = Math.min(width, height);
  const span = Math.max(1e-6, maxX - minX, maxY - minY);
  out.focal = (FIELD_FILL * side) / span;
  out.cx = width / 2 - out.focal * ((minX + maxX) / 2);
  // A little below the square's middle: the HUD line keeps the top.
  out.cy = height / 2 + out.focal * ((minY + maxY) / 2) + 0.025 * side;
  return out;
}

/* ------------------------------------------------------------------ quality ladder */

/*
 * The thresholds, measured on the simulator page (headless Chromium, 4 cores, 800 × 450 world at 1.13 device px per world px):
 * a frame costs ~5.8 ms of page work plus ~11.5 µs an orb at full quality, ~6.5 µs with shadows and sprites, ~3.4 µs with
 * sprites only and ~2.5 µs as flat discs. Each level holds about 45–50 fps up to its maximum: 1089 orbs at full quality ran
 * at 54.5 fps (1,600 at 41), 1936 with shadows at 54.4, 3025 sprites at 60 and 4900 at 44.3, 6400 discs at 46.3, 12,100
 * points at 60.
 */
/** Orbs up to which every orb gets its shadow, its sprite and a gloss glint. */
export const QUALITY_GLOSS_MAX = 1400;
/** … its shadow and its sprite. */
export const QUALITY_SHADOW_MAX = 2200;
/** … its sprite only (4900 – the account's 70 × 70 – keeps its glossy sprites). */
export const QUALITY_SPRITE_MAX = 5000;
/** … a flat disc, one path per colour and depth slice; beyond, points in one image. */
export const QUALITY_DISC_MAX = 8000;

/** 0 full · 1 no gloss · 2 no shadows · 3 flat discs · 4 points. */
export type OrbQuality = 0 | 1 | 2 | 3 | 4;

export function orbQuality(count: number): OrbQuality {
  if (count <= QUALITY_GLOSS_MAX) return 0;
  if (count <= QUALITY_SHADOW_MAX) return 1;
  if (count <= QUALITY_SPRITE_MAX) return 2;
  if (count <= QUALITY_DISC_MAX) return 3;
  return 4;
}

/* ------------------------------------------------------------------ depth order */

/**
 * Orders `n` orbs back to front by `depth` (bigger = farther first) with a counting sort over `buckets` buckets of the depth
 * range: O(n + buckets), no comparison sort. `counts` has `buckets + 1` entries and `bucketOf` n (scratch).
 */
export function depthOrder(depth: Float32Array, n: number, order: Uint32Array, counts: Uint32Array, bucketOf: Uint32Array, buckets: number): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const d = depth[i];
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  counts.fill(0, 0, buckets + 1);
  const span = hi - lo;
  const k = span > 0 ? (buckets - 1) / span : 0;
  for (let i = 0; i < n; i++) {
    const b = Math.min(buckets - 1, Math.max(0, Math.floor((hi - depth[i]) * k)));
    bucketOf[i] = b;
    counts[b + 1]++;
  }
  for (let b = 0; b < buckets; b++) counts[b + 1] += counts[b];
  for (let i = 0; i < n; i++) order[counts[bucketOf[i]]++] = i;
}

/* ------------------------------------------------------------------ colours */

/** Colour buckets of the palettes (the height palette changes an orb's bucket every frame). */
export const HEIGHT_BUCKETS = 24;
export const HUE_BUCKETS = 12;
/** The height palette: green low, then yellow, orange, pink and purple at the top (like the account's clips). */
const HEIGHT_STOPS: readonly [number, number, number, number][] = [
  [0, 52, 211, 120],
  [0.3, 196, 230, 60],
  [0.52, 255, 170, 44],
  [0.74, 255, 92, 160],
  [1, 150, 92, 255],
];

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) return [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)];
  if (h.length === 6) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  return [255, 255, 255];
}

function hslRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}

/** The height palette's colour at t (0 = on the slab, 1 = the highest drop). */
export function heightColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < HEIGHT_STOPS.length; i++) {
    const [p1, r1, g1, b1] = HEIGHT_STOPS[i];
    const [p0, r0, g0, b0] = HEIGHT_STOPS[i - 1];
    if (x <= p1) {
      const f = (x - p0) / (p1 - p0);
      return [Math.round(r0 + (r1 - r0) * f), Math.round(g0 + (g1 - g0) * f), Math.round(b0 + (b1 - b0) * f)];
    }
  }
  return [HEIGHT_STOPS[HEIGHT_STOPS.length - 1][1], HEIGHT_STOPS[HEIGHT_STOPS.length - 1][2], HEIGHT_STOPS[HEIGHT_STOPS.length - 1][3]];
}

/** The colours of a palette's buckets. */
export function paletteColors(palette: OgPalette, ballColor: string): [number, number, number][] {
  switch (palette) {
    case "height":
      return Array.from({ length: HEIGHT_BUCKETS }, (_, i) => heightColor(i / (HEIGHT_BUCKETS - 1)));
    case "ball":
      return [hexRgb(ballColor)];
    case "rainbow-field":
      return Array.from({ length: HEIGHT_BUCKETS }, (_, i) => hslRgb((i * 360) / HEIGHT_BUCKETS, 0.85, 0.6));
    default:
      // rings, rows: bands of hues a twelfth of the wheel apart.
      return Array.from({ length: HUE_BUCKETS }, (_, i) => hslRgb((i * 150) % 360, 0.8, 0.6));
  }
}

/** The fixed bucket of every orb for the palettes that do not follow the height (rings, rows, ball, rainbow field). */
export function staticBuckets(palette: OgPalette, layout: OrbLayout, out: Uint8Array) {
  const n = layout.count;
  for (let i = 0; i < n; i++) {
    let b = 0;
    if (palette === "rings") b = layout.ring[i] % HUE_BUCKETS;
    else if (palette === "rows") b = layout.row[i] % HUE_BUCKETS;
    else if (palette === "rainbow-field") {
      const a = Math.atan2(layout.y[i], layout.x[i]) / (2 * Math.PI) + 0.5 + 0.8 * Math.hypot(layout.x[i], layout.y[i]);
      b = Math.floor((a - Math.floor(a)) * HEIGHT_BUCKETS) % HEIGHT_BUCKETS;
    }
    out[i] = b;
  }
}

const rgba = (c: readonly number[], a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
const mix = (c: readonly number[], to: number, f: number): [number, number, number] => [Math.round(c[0] + (to - c[0]) * f), Math.round(c[1] + (to - c[1]) * f), Math.round(c[2] + (to - c[2]) * f)];

/** Paints one orb sprite (radius `r` device px, centred in a 2r square) in `material` and `color`. */
export function paintOrbSprite(g: CanvasRenderingContext2D, r: number, color: readonly number[], material: OgMaterial) {
  const TWO_PI = Math.PI * 2;
  g.clearRect(0, 0, 2 * r, 2 * r);
  g.save();
  g.beginPath();
  g.arc(r, r, r, 0, TWO_PI);
  g.clip();
  if (material === "metallic") {
    // Chrome: a bright sky over a dark horizon band, the floor's reflection below, tinted by the colour.
    const tint = color;
    const sky = g.createLinearGradient(0, 0, 0, 2 * r);
    sky.addColorStop(0, rgba(mix(tint, 255, 0.85)));
    sky.addColorStop(0.38, rgba(mix(tint, 255, 0.45)));
    sky.addColorStop(0.5, rgba(mix(tint, 0, 0.75)));
    sky.addColorStop(0.58, rgba(mix(tint, 0, 0.55)));
    sky.addColorStop(0.82, rgba(mix(tint, 255, 0.35)));
    sky.addColorStop(1, rgba(mix(tint, 0, 0.6)));
    g.fillStyle = sky;
    g.fillRect(0, 0, 2 * r, 2 * r);
    const edge = g.createRadialGradient(r, r, 0.55 * r, r, r, r);
    edge.addColorStop(0, "rgba(0, 0, 0, 0)");
    edge.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    g.fillStyle = edge;
    g.fillRect(0, 0, 2 * r, 2 * r);
    const spec = g.createRadialGradient(0.62 * r, 0.5 * r, 0, 0.62 * r, 0.5 * r, 0.3 * r);
    spec.addColorStop(0, "rgba(255, 255, 255, 1)");
    spec.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = spec;
    g.fillRect(0, 0, 2 * r, 2 * r);
  } else if (material === "glass") {
    g.fillStyle = rgba(color, 0.28);
    g.fillRect(0, 0, 2 * r, 2 * r);
    const caustic = g.createRadialGradient(1.3 * r, 1.4 * r, 0, 1.3 * r, 1.4 * r, 0.7 * r);
    caustic.addColorStop(0, rgba(mix(color, 255, 0.6), 0.7));
    caustic.addColorStop(1, rgba(color, 0));
    g.fillStyle = caustic;
    g.fillRect(0, 0, 2 * r, 2 * r);
    g.restore();
    g.save();
    g.lineWidth = Math.max(1, 0.12 * r);
    g.strokeStyle = rgba(mix(color, 255, 0.35), 0.85);
    g.beginPath();
    g.arc(r, r, r - g.lineWidth / 2, 0, TWO_PI);
    g.stroke();
    const spec = g.createRadialGradient(0.65 * r, 0.55 * r, 0, 0.65 * r, 0.55 * r, 0.32 * r);
    spec.addColorStop(0, "rgba(255, 255, 255, 0.95)");
    spec.addColorStop(1, "rgba(255, 255, 255, 0)");
    g.fillStyle = spec;
    g.fillRect(0, 0, 2 * r, 2 * r);
  } else {
    // Glossy (a specular dot and a darker rim) or matte (soft diffuse shading only).
    const glossy = material === "glossy";
    const body = g.createRadialGradient(0.72 * r, 0.62 * r, 0.05 * r, r, r, 1.05 * r);
    body.addColorStop(0, rgba(mix(color, 255, glossy ? 0.5 : 0.3)));
    body.addColorStop(glossy ? 0.3 : 0.4, rgba(mix(color, 255, glossy ? 0.12 : 0.08)));
    body.addColorStop(0.75, rgba(color));
    body.addColorStop(1, rgba(mix(color, 0, glossy ? 0.6 : 0.4)));
    g.fillStyle = body;
    g.fillRect(0, 0, 2 * r, 2 * r);
    if (glossy) {
      const spec = g.createRadialGradient(0.66 * r, 0.56 * r, 0, 0.66 * r, 0.56 * r, 0.26 * r);
      spec.addColorStop(0, "rgba(255, 255, 255, 0.95)");
      spec.addColorStop(1, "rgba(255, 255, 255, 0)");
      g.fillStyle = spec;
      g.fillRect(0, 0, 2 * r, 2 * r);
      // A faint bounce light from the slab along the lower rim.
      const rim = g.createRadialGradient(r, 1.75 * r, 0, r, 1.75 * r, 0.75 * r);
      rim.addColorStop(0, rgba(mix(color, 255, 0.4), 0.35));
      rim.addColorStop(1, rgba(color, 0));
      g.fillStyle = rim;
      g.fillRect(0, 0, 2 * r, 2 * r);
    }
  }
  g.restore();
}

/** Device-px radii of the sprite sizes (an orb uses the smallest one at least as big as it is drawn). */
export const SPRITE_RADII = [4, 8, 16, 32, 64, 128] as const;

/** The sprite size bucket for an orb drawn at `r` device px. */
export function spriteBucket(r: number): number {
  for (let i = 0; i < SPRITE_RADII.length; i++) if (r <= SPRITE_RADII[i]) return i;
  return SPRITE_RADII.length - 1;
}

/* ------------------------------------------------------------------ labels */

export interface OrbGridLabels {
  /** The HUD line: "1089 bouncing orbs" (the count formatted by the page). */
  hud: (count: string) => string;
  /** The end banners: every orb at rest, or the clip over first. */
  settledTitle: string;
  settledSub: (count: string, seconds: string) => string;
  timeTitle: string;
  timeSub: (settled: string, count: string) => string;
}

export const DEFAULT_ORB_GRID_LABELS: OrbGridLabels = {
  hud: (count) => `${count} bouncing orbs`,
  settledTitle: "ALL SETTLED",
  settledSub: (count, seconds) => `${count} orbs at rest after ${seconds}s`,
  timeTitle: "TIME!",
  timeSub: (settled, count) => `${settled} of ${count} orbs at rest`,
};

/** The end banner for a finished view. */
export function orbGridBanner(view: OrbGridView, labels: OrbGridLabels): { title: string; sub: string } {
  if (view.finishReason === "time") return { title: labels.timeTitle, sub: labels.timeSub(String(view.settled), String(view.count)) };
  return { title: labels.settledTitle, sub: labels.settledSub(String(view.count), (Math.max(0, view.settledAtMs) / 1000).toFixed(1)) };
}

/* ------------------------------------------------------------------ the layer */

const TWO_PI = Math.PI * 2;
/** The slab's thickness and margin around the orbs, the blue floor's extent and spacing (field widths). */
const SLAB_THICKNESS = 0.05;
const SLAB_MARGIN = 0.035;
const FLOOR_EXTENT = 1.6;
const FLOOR_STEP = 0.1;
/** Grid lines a side the slab draws at most (a 500-column field draws every k-th line). */
const SLAB_LINES_MAX = 44;
/** Shadow sprites, one per opacity step (a shadow fades with its orb's height). */
const SHADOW_STEPS = 8;
/** Depth slices of the flat-disc level (orbs within a slice are drawn per colour). */
const DISC_SLICES = 16;

export class OrbGridLayer {
  private readonly cam: OrbCamera = { cosA: 1, sinA: 0, cosE: 1, sinE: 0, distance: CAMERA_DISTANCE, focal: 1, cx: 0, cy: 0 };
  private readonly pt: ProjectedPoint = { x: 0, y: 0, depth: 0, scale: 0 };
  // Per-orb buffers (grown on demand).
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private sr = new Float32Array(0);
  private depth = new Float32Array(0);
  private fx = new Float32Array(0);
  private fy = new Float32Array(0);
  private fs = new Float32Array(0);
  private bucket = new Uint8Array(0);
  private fixedBucket = new Uint8Array(0);
  private order = new Uint32Array(0);
  private bucketOf = new Uint32Array(0);
  private counts = new Uint32Array(0);
  private visible = new Uint8Array(0);
  // Sprites: [colour bucket × size bucket] for the current material / palette / colour.
  private sprites: (HTMLCanvasElement | undefined)[] = [];
  private spriteKey = "";
  private colors: [number, number, number][] = [];
  private discColors: string[] = [];
  private packed = new Uint32Array(0);
  private shadows: HTMLCanvasElement[] = [];
  private glint: HTMLCanvasElement | null = null;
  private generation = -1;
  private paletteSeen: OgPalette | "" = "";
  // Field extents (for the slab) and the points layer of the last level.
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  private pointCanvas: HTMLCanvasElement | null = null;
  private pointImage: ImageData | null = null;
  private pointData: Uint32Array | null = null;
  private seenColors = new Uint8Array(HEIGHT_BUCKETS);
  /** The quality level of the last frame (data-og-quality). */
  quality: OrbQuality = 0;

  private ensure(n: number) {
    if (this.sx.length >= n) return;
    const m = Math.max(n, 16);
    this.sx = new Float32Array(m);
    this.sy = new Float32Array(m);
    this.sr = new Float32Array(m);
    this.depth = new Float32Array(m);
    this.fx = new Float32Array(m);
    this.fy = new Float32Array(m);
    this.fs = new Float32Array(m);
    this.bucket = new Uint8Array(m);
    this.fixedBucket = new Uint8Array(m);
    this.order = new Uint32Array(m);
    this.bucketOf = new Uint32Array(m);
    this.visible = new Uint8Array(m);
    this.generation = -1;
  }

  /** Re-reads the layout after an init: the field's extents and the static colour buckets. */
  private prepare(view: OrbGridView) {
    const L = view.layout!;
    this.ensure(L.count);
    if (this.generation === view.generation && this.paletteSeen === view.settings.palette) return;
    this.generation = view.generation;
    this.paletteSeen = view.settings.palette;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < L.count; i++) {
      const r = view.radius[i];
      if (L.x[i] - r < minX) minX = L.x[i] - r;
      if (L.x[i] + r > maxX) maxX = L.x[i] + r;
      if (L.y[i] - r < minY) minY = L.y[i] - r;
      if (L.y[i] + r > maxY) maxY = L.y[i] + r;
    }
    this.minX = minX - SLAB_MARGIN;
    this.maxX = maxX + SLAB_MARGIN;
    this.minY = minY - SLAB_MARGIN;
    this.maxY = maxY + SLAB_MARGIN;
    staticBuckets(view.settings.palette, L, this.fixedBucket);
  }

  /** The sprites for the view's material, palette and ball colour (rebuilt lazily when one of them changes). */
  private spriteSet(view: OrbGridView) {
    const s = view.settings;
    const key = `${s.material}|${s.palette}|${s.palette === "ball" ? s.ballColor : ""}`;
    if (key === this.spriteKey) return;
    this.spriteKey = key;
    this.sprites = [];
    this.colors = paletteColors(s.palette, s.ballColor);
    this.discColors = this.colors.map((c) => rgba(s.material === "metallic" ? mix(c, 200, 0.45) : c));
    this.packed = new Uint32Array(this.colors.length);
    // Little-endian RGBA in one 32-bit word (ImageData's byte order).
    for (let i = 0; i < this.colors.length; i++) {
      const c = s.material === "metallic" ? mix(this.colors[i], 220, 0.5) : this.colors[i];
      this.packed[i] = (255 << 24) | (c[2] << 16) | (c[1] << 8) | c[0];
    }
  }

  private sprite(material: OgMaterial, bucket: number, size: number): HTMLCanvasElement {
    const index = bucket * SPRITE_RADII.length + size;
    let sprite = this.sprites[index];
    if (!sprite) {
      const r = SPRITE_RADII[size];
      sprite = document.createElement("canvas");
      sprite.width = 2 * r;
      sprite.height = 2 * r;
      const g = sprite.getContext("2d");
      if (g) paintOrbSprite(g, r, this.colors[bucket] ?? [255, 255, 255], material);
      this.sprites[index] = sprite;
    }
    return sprite;
  }

  private shadowSprite(step: number): HTMLCanvasElement {
    if (this.shadows.length === 0) {
      for (let k = 0; k < SHADOW_STEPS; k++) {
        const c = document.createElement("canvas");
        c.width = 64;
        c.height = 64;
        const g = c.getContext("2d");
        if (g) {
          const a = 0.6 * (1 - k / SHADOW_STEPS);
          const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
          grad.addColorStop(0, `rgba(0, 0, 0, ${a.toFixed(3)})`);
          grad.addColorStop(0.55, `rgba(0, 0, 0, ${(0.55 * a).toFixed(3)})`);
          grad.addColorStop(1, "rgba(0, 0, 0, 0)");
          g.fillStyle = grad;
          g.fillRect(0, 0, 64, 64);
        }
        this.shadows.push(c);
      }
    }
    return this.shadows[Math.max(0, Math.min(SHADOW_STEPS - 1, step))];
  }

  private glintSprite(): HTMLCanvasElement {
    if (!this.glint) {
      const c = document.createElement("canvas");
      c.width = 32;
      c.height = 32;
      const g = c.getContext("2d");
      if (g) {
        const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, "rgba(255, 255, 255, 0.7)");
        grad.addColorStop(0.4, "rgba(255, 255, 255, 0.22)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        g.fillStyle = grad;
        g.fillRect(0, 0, 32, 32);
      }
      this.glint = c;
    }
    return this.glint;
  }

  /** The view's camera this frame (the fit follows the field, the elevation and the world; the angle the clock). */
  camera(view: OrbGridView, width: number, height: number): OrbCamera {
    const L = view.layout;
    const s = view.settings;
    const top = view.maxDrop + 2 * view.baseRadius;
    return orbCamera(s.elevation, cameraAngleDeg(s.rotation, s.orbit, view.timeMs / 1000), width, height, L ? L.radius + SLAB_MARGIN : 0.7, top, this.cam);
  }

  /** The floor under the orbs (the world pass): slab + grid over the blue floor, the round plate, the grid alone, or nothing. */
  drawWorld(ctx: CanvasRenderingContext2D, view: OrbGridView, width: number, height: number) {
    if (!view.layout) return;
    this.prepare(view);
    const cam = this.camera(view, width, height);
    const floor = view.settings.floor;
    if (floor === "none") return;
    ctx.save();
    if (floor === "slab" || floor === "grid") this.drawFloorGrid(ctx, cam, floor === "slab" ? -SLAB_THICKNESS : 0);
    if (floor === "slab") this.drawSlab(ctx, cam, view);
    else if (floor === "plate") this.drawPlate(ctx, cam, view);
    ctx.restore();
  }

  private line(ctx: CanvasRenderingContext2D, cam: OrbCamera, x0: number, y0: number, x1: number, y1: number, z: number) {
    const p = this.pt;
    projectPoint(cam, x0, y0, z, p);
    if (p.scale <= 0) return;
    ctx.moveTo(p.x, p.y);
    projectPoint(cam, x1, y1, z, p);
    if (p.scale <= 0) return;
    ctx.lineTo(p.x, p.y);
  }

  private drawFloorGrid(ctx: CanvasRenderingContext2D, cam: OrbCamera, z: number) {
    const E = FLOOR_EXTENT;
    ctx.lineWidth = 1;
    // Two passes: the wide, faint lines, then the near half a little brighter (depth cue).
    ctx.strokeStyle = "rgba(70, 130, 255, 0.16)";
    ctx.beginPath();
    for (let v = -E; v <= E + 1e-9; v += FLOOR_STEP) {
      this.line(ctx, cam, v, -E, v, E, z);
      this.line(ctx, cam, -E, v, E, v, z);
    }
    ctx.stroke();
  }

  private quad(ctx: CanvasRenderingContext2D, cam: OrbCamera, pts: readonly (readonly [number, number, number])[]) {
    const p = this.pt;
    ctx.beginPath();
    for (let k = 0; k < pts.length; k++) {
      projectPoint(cam, pts[k][0], pts[k][1], pts[k][2], p);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  private drawSlab(ctx: CanvasRenderingContext2D, cam: OrbCamera, view: OrbGridView) {
    const { minX, maxX, minY, maxY } = this;
    const T = SLAB_THICKNESS;
    // The side faces, farthest first (their middles' depth), then the top.
    const faces: [number, readonly (readonly [number, number, number])[]][] = [];
    const corners: readonly [number, number][] = [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ];
    for (let k = 0; k < 4; k++) {
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      const mid = projectPoint(cam, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -T / 2, this.pt).depth;
      faces.push([mid, [[a[0], a[1], 0], [b[0], b[1], 0], [b[0], b[1], -T], [a[0], a[1], -T]]]);
    }
    faces.sort((p, q) => q[0] - p[0]);
    for (const [, pts] of faces) {
      this.quad(ctx, cam, pts);
      ctx.fillStyle = "#0e1730";
      ctx.fill();
      ctx.strokeStyle = "rgba(110, 160, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    this.quad(ctx, cam, [
      [minX, minY, 0],
      [maxX, minY, 0],
      [maxX, maxY, 0],
      [minX, maxY, 0],
    ]);
    ctx.fillStyle = "#16244a";
    ctx.fill();
    ctx.strokeStyle = "rgba(140, 185, 255, 0.55)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // The cell grid under the orbs: a line between every two rows and columns (every k-th one on a big field).
    const L = view.layout!;
    const s = L.spacing;
    const linesX = Math.max(1, Math.round((maxX - minX) / s));
    const linesY = Math.max(1, Math.round((maxY - minY) / s));
    const strideX = Math.max(1, Math.ceil(linesX / SLAB_LINES_MAX));
    const strideY = Math.max(1, Math.ceil(linesY / SLAB_LINES_MAX));
    ctx.strokeStyle = "rgba(120, 170, 255, 0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const stepX = (maxX - minX) / linesX;
    const stepY = (maxY - minY) / linesY;
    for (let k = strideX; k < linesX; k += strideX) this.line(ctx, cam, minX + k * stepX, minY, minX + k * stepX, maxY, 0);
    for (let k = strideY; k < linesY; k += strideY) this.line(ctx, cam, minX, minY + k * stepY, maxX, minY + k * stepY, 0);
    ctx.stroke();
  }

  private ring(ctx: CanvasRenderingContext2D, cam: OrbCamera, r: number, z: number) {
    const p = this.pt;
    ctx.beginPath();
    for (let k = 0; k <= 64; k++) {
      const a = (k / 64) * TWO_PI;
      projectPoint(cam, r * Math.cos(a), r * Math.sin(a), z, p);
      if (k === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  private drawPlate(ctx: CanvasRenderingContext2D, cam: OrbCamera, view: OrbGridView) {
    const r = (view.layout?.radius ?? 0.5) + SLAB_MARGIN;
    // The rim (the plate's lower outline), then the top with a soft light in the middle.
    this.ring(ctx, cam, r, -0.04);
    ctx.fillStyle = "#08090d";
    ctx.fill();
    this.ring(ctx, cam, r, 0);
    const c = projectPoint(cam, 0, 0, 0, this.pt);
    const grad = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r * c.scale * 1.1);
    grad.addColorStop(0, "#22252f");
    grad.addColorStop(1, "#0f1016");
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }

  /**
   * The shadows and the orbs, back to front, at the count's quality level (the ball pass); `share`: the arenas drawn into the
   * same frame (split screen), whose orbs together pick the level.
   */
  drawOrbs(ctx: CanvasRenderingContext2D, view: OrbGridView, width: number, height: number, scale: number, share = 1) {
    const L = view.layout;
    if (!L || view.count === 0) return;
    this.prepare(view);
    this.spriteSet(view);
    const cam = this.camera(view, width, height);
    const n = view.count;
    const quality = orbQuality(n * Math.max(1, Math.round(share)));
    this.quality = quality;
    const s = view.settings;
    const sx = this.sx;
    const sy = this.sy;
    const sr = this.sr;
    const depth = this.depth;
    const fx = this.fx;
    const fy = this.fy;
    const fs = this.fs;
    const bucket = this.bucket;
    const visible = this.visible;
    const x = L.x;
    const y = L.y;
    const radius = view.radius;
    const height_ = view.height;
    const heightPalette = s.palette === "height";
    const top = view.maxDrop > 0 ? view.maxDrop : 1;
    const hb = HEIGHT_BUCKETS - 1;
    const { cosA, sinA, cosE, sinE, distance, focal, cx, cy } = cam;
    for (let i = 0; i < n; i++) {
      const xr = x[i] * cosA - y[i] * sinA;
      const yr = x[i] * sinA + y[i] * cosA;
      const r = radius[i];
      const h = height_[i];
      const z = h + r;
      const d = yr * cosE - z * sinE + distance;
      if (d <= 1e-3 || r <= 0) {
        visible[i] = 0;
        depth[i] = 0;
        continue;
      }
      visible[i] = 1;
      const inv = focal / d;
      sx[i] = cx + xr * inv;
      sy[i] = cy - (yr * sinE + z * cosE) * inv;
      sr[i] = r * inv;
      depth[i] = d;
      // The floor spot (the shadow).
      const fd = yr * cosE + distance;
      const finv = focal / fd;
      fx[i] = cx + xr * finv;
      fy[i] = cy - yr * sinE * finv;
      fs[i] = r * finv;
      bucket[i] = heightPalette ? Math.round(Math.min(1, h / top) * hb) : this.fixedBucket[i];
    }
    if (quality === 4) {
      this.drawPoints(ctx, view, width, height, scale);
      return;
    }
    // Back to front.
    const buckets = Math.min(16384, Math.max(256, n));
    if (this.counts.length < buckets + 1) this.counts = new Uint32Array(buckets + 1);
    depthOrder(depth, n, this.order, this.counts, this.bucketOf, buckets);
    const order = this.order;
    ctx.save();
    if (quality <= 1) {
      // The shadows lie on the floor under every orb: all of them first.
      const flat = Math.max(0.15, sinE);
      for (let i = 0; i < n; i++) {
        if (!visible[i]) continue;
        const hn = Math.min(1, height_[i] / top);
        const w = 2.4 * fs[i] * (1 - 0.45 * hn);
        const hh = w * flat;
        ctx.drawImage(this.shadowSprite(Math.floor(hn * (SHADOW_STEPS - 1) + 0.5)), fx[i] - w / 2, fy[i] - hh / 2, w, hh);
      }
    }
    if (quality <= 2) {
      const material = s.material;
      for (let k = 0; k < n; k++) {
        const i = order[k];
        if (!visible[i]) continue;
        const r = sr[i];
        if (r < 0.15) continue;
        ctx.drawImage(this.sprite(material, bucket[i], spriteBucket(r * scale)), sx[i] - r, sy[i] - r, 2 * r, 2 * r);
      }
      if (quality === 0 && material !== "matte") {
        // The gloss glint: a soft bright bloom on every orb's lit side.
        ctx.globalCompositeOperation = "lighter";
        const glint = this.glintSprite();
        for (let k = 0; k < n; k++) {
          const i = order[k];
          if (!visible[i]) continue;
          const r = sr[i];
          if (r < 0.6) continue;
          const g = 0.62 * r;
          ctx.drawImage(glint, sx[i] - 0.34 * r - g, sy[i] - 0.44 * r - g, 2 * g, 2 * g);
        }
        ctx.globalCompositeOperation = "source-over";
      }
    } else this.drawDiscs(ctx, n);
    ctx.restore();
  }

  /** Flat discs: per depth slice, one path per colour (the order holds between slices, not inside one). */
  private drawDiscs(ctx: CanvasRenderingContext2D, n: number) {
    const order = this.order;
    const colors = this.discColors.length;
    if (this.seenColors.length < colors) this.seenColors = new Uint8Array(colors);
    const seen = this.seenColors;
    for (let slice = 0; slice < DISC_SLICES; slice++) {
      const from = Math.floor((slice * n) / DISC_SLICES);
      const to = Math.floor(((slice + 1) * n) / DISC_SLICES);
      seen.fill(0, 0, colors);
      for (let k = from; k < to; k++) seen[this.bucket[order[k]] % colors] = 1;
      for (let c = 0; c < colors; c++) {
        if (!seen[c]) continue;
        ctx.fillStyle = this.discColors[c];
        ctx.beginPath();
        for (let k = from; k < to; k++) {
          const i = order[k];
          if (!this.visible[i] || this.bucket[i] % colors !== c) continue;
          const r = Math.max(0.5, this.sr[i]);
          ctx.moveTo(this.sx[i] + r, this.sy[i]);
          ctx.arc(this.sx[i], this.sy[i], r, 0, TWO_PI);
        }
        ctx.fill();
      }
    }
  }

  /** Points in one image (past the disc level): a device pixel (or a few) per orb, its colour. */
  private drawPoints(ctx: CanvasRenderingContext2D, view: OrbGridView, width: number, height: number, scale: number) {
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    if (!this.pointCanvas || this.pointCanvas.width !== w || this.pointCanvas.height !== h) {
      this.pointCanvas = document.createElement("canvas");
      this.pointCanvas.width = w;
      this.pointCanvas.height = h;
      this.pointImage = null;
    }
    const pc = this.pointCanvas.getContext("2d");
    if (!pc) return;
    if (!this.pointImage) {
      this.pointImage = pc.createImageData(w, h);
      this.pointData = new Uint32Array(this.pointImage.data.buffer);
    }
    const data = this.pointData!;
    data.fill(0);
    const colors = this.packed.length;
    const n = view.count;
    for (let i = 0; i < n; i++) {
      if (!this.visible[i]) continue;
      const px = Math.round(this.sx[i] * scale);
      const py = Math.round(this.sy[i] * scale);
      const size = this.sr[i] * scale >= 1.5 ? 2 : 1;
      const color = this.packed[this.bucket[i] % colors];
      for (let dy = 0; dy < size; dy++) {
        const yy = py + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = 0; dx < size; dx++) {
          const xx = px + dx;
          if (xx >= 0 && xx < w) data[yy * w + xx] = color;
        }
      }
    }
    pc.putImageData(this.pointImage, 0, 0);
    ctx.drawImage(this.pointCanvas, 0, 0, width, height);
  }

  /**
   * The "1089 bouncing orbs" line at the top of the square the recorder crops to (screen space, part of the recording): on the
   * left, or on the right while the teams scoreboard holds the left corner. Returns its bottom (0 when it is off) – where the
   * top captions start.
   */
  drawOverlay(ctx: CanvasRenderingContext2D, view: OrbGridView, labels: OrbGridLabels, width: number, height: number, inset = 0, right = false): number {
    if (!view.layout || !view.settings.hud) return 0;
    const side = Math.min(width, height);
    const left = width / 2 - side / 2;
    const top = height / 2 - side / 2 + inset;
    const fs = Math.max(11, 0.034 * side);
    const yy = top + 0.03 * side + fs;
    ctx.save();
    ctx.globalAlpha = 1; // (the screen-space overlays inherit the world pass's 0.6)
    ctx.font = `600 ${fs.toFixed(1)}px sans-serif`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = right ? "right" : "left";
    ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
    ctx.shadowBlur = 6;
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.fillText(labels.hud(String(view.count)), right ? left + side - 0.045 * side : left + 0.045 * side, yy);
    ctx.restore();
    return yy + 0.35 * fs;
  }
}

/* ------------------------------------------------------------------ data attributes */

/** The data-og-* attributes the canvas mirrors for tools and the smoke test. */
export const ORB_GRID_DATA_KEYS = ["ogOrbs", "ogRequested", "ogFull", "ogArrangement", "ogReleased", "ogReleasedRings", "ogBounces", "ogLanded", "ogSettled", "ogMoving", "ogResolve", "ogResolveAt", "ogResolves", "ogResolvePlan", "ogTuned", "ogQuality", "ogSound", "ogVoices", "ogNotes", "ogPitches", "ogFinished", "ogFinishedMs", "ogFinish", "ogTime", "ogHud", "ogTempo"];

/** Writes the data-og-* attributes (the pitch list only when it changed). */
export class OrbGridDataset {
  private pitches: number[] | null = null;
  private pitchText = "";

  write(view: OrbGridView, layer: OrbGridLayer, set: (key: string, value: string) => void) {
    if (view.lastPitches !== this.pitches) {
      this.pitches = view.lastPitches;
      this.pitchText = view.lastPitches.map((f) => f.toFixed(1)).join(",");
    }
    set("ogOrbs", String(view.count));
    set("ogRequested", String(view.requested));
    set("ogFull", view.full ? "1" : "0");
    set("ogArrangement", view.layout?.arrangement ?? "");
    set("ogReleased", String(view.released));
    set("ogReleasedRings", String(view.releasedRings));
    set("ogBounces", String(view.bounces));
    set("ogLanded", String(view.landedStep));
    set("ogSettled", String(view.settled));
    set("ogMoving", String(view.moving));
    set("ogResolve", view.resolve.toFixed(2));
    set("ogResolveAt", String(Math.round(view.resolveAtMs)));
    set("ogResolves", String(view.resolves));
    set("ogResolvePlan", String(Math.round(view.resolvePlanMs)));
    set("ogTuned", String(view.tuned));
    set("ogQuality", String(layer.quality));
    set("ogSound", view.settings.sound);
    set("ogVoices", String(view.voices));
    set("ogNotes", String(view.notes));
    set("ogPitches", this.pitchText);
    set("ogFinished", view.finished ? "1" : "0");
    set("ogFinishedMs", String(Math.round(view.finishedMs)));
    set("ogFinish", view.finishReason);
    set("ogTime", String(Math.round(view.timeMs)));
    set("ogHud", view.settings.hud ? "1" : "0");
    set("ogTempo", view.tempo.toFixed(4));
  }
}
