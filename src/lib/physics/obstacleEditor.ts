import { circleObstacle, resolveBallCircle, resolveBallSegment, segmentObstacle, type Obstacle, type SegmentObstacle } from "./obstacles";
import type { Ball, ModeId, PhysicsConfig, SoundEvent } from "./types";

/**
 * Obstacle editor: pegs, bumpers, blockers and spinners that a creator places inside any ring ("circular arena")
 * mode, on top of whatever the mode itself builds. It reuses the collision maths of the generic obstacle layer
 * (obstacles.ts):
 *  - **peg** – a static circle,
 *  - **bumper** – a circle that multiplies the ball's speed by `bumperBoost` (1–2) on a hard hit, flashes and plays a
 *    pinball "ding" (a `SoundEvent` with `bumper: true`; see audio/bumperTone.ts),
 *  - **blocker** – a static bar,
 *  - **spinner** – a bar turning around its centre at `rpm` revolutions per minute (negative = anticlockwise).
 *
 * The creator's list (`EditorObstacle[]`, the `obstacles` setting) is arena-relative: positions in arena radii from
 * the centre (1 = the ring of the single-ring modes, `arenaRadius()`), sizes in percent of that radius, angles in
 * degrees – so a layout scales with the canvas and survives a resize, a share link or a preset on another screen.
 * It travels to the engine inside the physics config (`editorObstacles`, `bumperBoost`), which is also what the seed
 * finder copies, so a found seed replays with the same obstacles. `ObstacleField` builds the pixel obstacles from it
 * (rebuilt whenever the list or the canvas size changes, reset with every mode init) and resolves every ball against
 * them in every sub-step – no randomness, no wall clock, so runs stay deterministic for a seed.
 *
 * URL form (key `obs`): obstacles joined by ";", each `code:numbers` with the numbers joined by ",":
 * `p:x,y,size` (peg), `b:x,y,size` (bumper), `k:x,y,length,angle` (blocker), `s:x,y,length,angle,rpm` (spinner),
 * e.g. `p:0.2,-0.3,6;b:-0.4,0.1,8;s:0,0.45,40,0,20`. The bumper boost has its own key (`obb`).
 */

export const OBSTACLE_KINDS = ["peg", "bumper", "blocker", "spinner"] as const;
export type ObstacleKind = (typeof OBSTACLE_KINDS)[number];

export function isObstacleKind(value: unknown): value is ObstacleKind {
  return typeof value === "string" && (OBSTACLE_KINDS as readonly string[]).includes(value);
}

/** One obstacle as the creator placed it (arena-relative, so it scales with the canvas). */
export interface EditorObstacle {
  kind: ObstacleKind;
  /** Centre, in arena radii from the arena centre (+x right, +y down). */
  x: number;
  y: number;
  /** Peg / bumper: radius; blocker / spinner: full length – in percent of the arena radius. */
  size: number;
  /** Blocker / spinner: orientation in degrees (0 = horizontal, positive turns clockwise on screen); 0 for circles. */
  angle: number;
  /** Spinner: revolutions per minute (negative = anticlockwise); 0 for the other kinds. */
  rpm: number;
}

/** The settings fields of the editor (SimulatorSettings `obstacles`, URL `obs`; `bumperBoost`, URL `obb`). */
export interface ObstacleSettings {
  obstacles: EditorObstacle[];
  bumperBoost: number;
}

/** The ring modes: the editor's obstacles are in play in these (they are kept, unused, in the others). */
export const OBSTACLE_EDITOR_MODES: readonly ModeId[] = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow"];

export function supportsObstacles(mode: ModeId | null | undefined): boolean {
  return !!mode && OBSTACLE_EDITOR_MODES.includes(mode);
}

/** Most obstacles in one layout (40 balls × 24 obstacles × 240 sub-steps a second stays well inside the frame budget). */
export const MAX_OBSTACLES = 24;
export const DEFAULT_BUMPER_BOOST = 1.3;
/** A bumper never kicks a ball past this multiple of the ball speed setting (the ring rebound resets it anyway). */
export const BUMPER_SPEED_CAP = 3;
/** Hit sounds the editor's obstacles may queue per 60 Hz step (a ball rattling between two pegs stays listenable). */
export const MAX_OBSTACLE_SOUNDS_PER_STEP = 4;

/** Limits of the per-obstacle numbers (the panel's sliders and the URL / preset validation). */
export const OBSTACLE_LIMITS = {
  /** Centre coordinates, arena radii. */
  position: { min: -1.3, max: 1.3, step: 0.01 },
  /** Peg / bumper radius, percent of the arena radius. */
  circleSize: { min: 2, max: 25, step: 0.5 },
  /** Blocker / spinner length, percent of the arena radius. */
  barSize: { min: 10, max: 120, step: 1 },
  /** Bar angle, degrees. */
  angle: { min: -180, max: 180, step: 1 },
  /** Spinner speed, revolutions per minute. */
  rpm: { min: -120, max: 120, step: 1 },
} as const;

/** Slider range of the bumper boost, keyed by the SimulatorSettings field so settings.ts can spread it into `RANGES`. */
export const OBSTACLE_EDITOR_RANGES = {
  bumperBoost: { min: 1, max: 2, step: 0.05 },
} as const;

/** One-letter codes of the URL form. */
export const OBSTACLE_CODES: Record<ObstacleKind, string> = { peg: "p", bumper: "b", blocker: "k", spinner: "s" };

const DEFAULT_SIZES: Record<ObstacleKind, number> = { peg: 5, bumper: 8, blocker: 40, spinner: 50 };

/** Restitution / friction of each kind (the wall-bounciness extra scales the restitution like every rebound). */
const MATERIALS: Record<ObstacleKind, { restitution: number; friction: number }> = {
  peg: { restitution: 0.95, friction: 0.02 },
  bumper: { restitution: 1, friction: 0 },
  blocker: { restitution: 0.95, friction: 0.02 },
  spinner: { restitution: 0.95, friction: 0.05 },
};

/** Pentatonic ladder (C5 D5 E5 G5 A5 C6) the pegs, blockers and spinners play by index; bumpers ding an octave up. */
export const OBSTACLE_NOTES = [523.25, 587.33, 659.25, 783.99, 880, 1046.5] as const;

export function obstacleNote(index: number): number {
  return OBSTACLE_NOTES[index % OBSTACLE_NOTES.length];
}

export function bumperNote(index: number): number {
  return 2 * OBSTACLE_NOTES[(index * 2) % OBSTACLE_NOTES.length];
}

export function isCircleKind(kind: ObstacleKind): boolean {
  return kind === "peg" || kind === "bumper";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Rounds to `decimals` places and turns −0 into 0 (so the URL form and the stored value agree exactly). */
function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}

/** Wraps an angle in degrees into (−180, 180]. */
function wrapDegrees(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/** A new obstacle of `kind` at (x, y) with its default size (bars horizontal, spinners at 20 rpm). */
export function defaultObstacle(kind: ObstacleKind, x = 0, y = 0): EditorObstacle {
  return sanitizeObstacle({ kind, x, y, size: DEFAULT_SIZES[kind], angle: 0, rpm: kind === "spinner" ? 20 : 0 })!;
}

/**
 * A valid obstacle from anything (a preset, a URL, a drag): unknown kinds give null, numbers are clamped to
 * `OBSTACLE_LIMITS` (a bad number falls back to the kind's default) and rounded – positions to 3 decimals, sizes,
 * angles and rpm to 1 – so the stored value is exactly what the URL form reads back.
 */
export function sanitizeObstacle(value: unknown): EditorObstacle | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (!isObstacleKind(v.kind)) return null;
  const kind = v.kind;
  const num = (raw: unknown, fallback: number) => {
    const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  const circle = isCircleKind(kind);
  const sizeRange = circle ? OBSTACLE_LIMITS.circleSize : OBSTACLE_LIMITS.barSize;
  const { min: pMin, max: pMax } = OBSTACLE_LIMITS.position;
  return {
    kind,
    x: round(clamp(num(v.x, 0), pMin, pMax), 3),
    y: round(clamp(num(v.y, 0), pMin, pMax), 3),
    size: round(clamp(num(v.size, DEFAULT_SIZES[kind]), sizeRange.min, sizeRange.max), 1),
    angle: circle ? 0 : round(wrapDegrees(num(v.angle, 0)), 1),
    rpm: kind === "spinner" ? round(clamp(num(v.rpm, 20), OBSTACLE_LIMITS.rpm.min, OBSTACLE_LIMITS.rpm.max), 1) : 0,
  };
}

/** A valid list from anything: invalid entries dropped, at most MAX_OBSTACLES kept. */
export function resolveObstacles(value: unknown): EditorObstacle[] {
  if (!Array.isArray(value)) return [];
  const out: EditorObstacle[] = [];
  for (const item of value) {
    const o = sanitizeObstacle(item);
    if (o) out.push(o);
    if (out.length >= MAX_OBSTACLES) break;
  }
  return out;
}

export function resolveBumperBoost(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return DEFAULT_BUMPER_BOOST;
  const r = OBSTACLE_EDITOR_RANGES.bumperBoost;
  return round(clamp(n, r.min, r.max), 2);
}

export function defaultObstacleSettings(): ObstacleSettings {
  return { obstacles: [], bumperBoost: DEFAULT_BUMPER_BOOST };
}

/** The editor's settings, validated (presets and URL parameters alike). */
export function resolveObstacleSettings(source: Partial<Record<keyof ObstacleSettings, unknown>> | null | undefined): ObstacleSettings {
  return { obstacles: resolveObstacles(source?.obstacles), bumperBoost: resolveBumperBoost(source?.bumperBoost ?? DEFAULT_BUMPER_BOOST) };
}

/** The two fields out of the settings (for a mode change, which keeps the layout, and for the physics config). */
export function obstacleSettingsOf(settings: ObstacleSettings): ObstacleSettings {
  return { obstacles: settings.obstacles, bumperBoost: settings.bumperBoost };
}

/** What the engine needs: the list and the boost travel inside the physics config (and so reach the seed finder). */
export function obstacleConfigOf(settings: ObstacleSettings): Pick<PhysicsConfig, "editorObstacles" | "bumperBoost"> {
  return { editorObstacles: settings.obstacles, bumperBoost: settings.bumperBoost };
}

/* ------------------------------------------------------------------ URL form */

function formatNumber(n: number): string {
  return String(n === 0 ? 0 : n);
}

/** `p:x,y,size;b:…;k:x,y,length,angle;s:x,y,length,angle,rpm` (see the module comment). */
export function serializeObstacles(list: readonly EditorObstacle[]): string {
  const parts: string[] = [];
  for (const raw of list) {
    const o = sanitizeObstacle(raw);
    if (!o) continue;
    const nums = [o.x, o.y, o.size];
    if (!isCircleKind(o.kind)) nums.push(o.angle);
    if (o.kind === "spinner") nums.push(o.rpm);
    parts.push(`${OBSTACLE_CODES[o.kind]}:${nums.map(formatNumber).join(",")}`);
    if (parts.length >= MAX_OBSTACLES) break;
  }
  return parts.join(";");
}

const KIND_BY_CODE: Record<string, ObstacleKind> = { p: "peg", b: "bumper", k: "blocker", s: "spinner" };

/** Reads the URL form back; unknown codes and entries without a position are skipped, missing numbers take the defaults. */
export function parseObstacles(text: string | null | undefined): EditorObstacle[] {
  if (!text) return [];
  const out: EditorObstacle[] = [];
  for (const part of text.split(";")) {
    const colon = part.indexOf(":");
    if (colon < 0) continue;
    const kind = KIND_BY_CODE[part.slice(0, colon).trim().toLowerCase()];
    if (!kind) continue;
    const nums = part
      .slice(colon + 1)
      .split(",")
      .map((s) => s.trim());
    if (nums.length < 2 || nums[0] === "" || nums[1] === "" || !Number.isFinite(Number(nums[0])) || !Number.isFinite(Number(nums[1]))) continue;
    const o = sanitizeObstacle({ kind, x: nums[0], y: nums[1], size: nums[2], angle: nums[3], rpm: nums[4] });
    if (o) out.push(o);
    if (out.length >= MAX_OBSTACLES) break;
  }
  return out;
}

/** Writes `obs` (a non-empty layout, whatever the mode, so switching modes and back keeps it) and `obb` (a changed boost). */
export function writeObstacleParams(settings: ObstacleSettings, base: ObstacleSettings, params: URLSearchParams): void {
  if (settings.obstacles.length > 0) params.set("obs", serializeObstacles(settings.obstacles));
  if (settings.bumperBoost !== base.bumperBoost) params.set("obb", String(settings.bumperBoost));
}

/** Reads `obs` and `obb` into the settings (invalid values leave the defaults). */
export function readObstacleParams(params: URLSearchParams, settings: ObstacleSettings): void {
  const obs = params.get("obs");
  if (obs !== null) settings.obstacles = parseObstacles(obs);
  const obb = params.get("obb");
  if (obb !== null && obb.trim() !== "" && Number.isFinite(Number(obb))) settings.bumperBoost = resolveBumperBoost(Number(obb));
}

/* ------------------------------------------------------------------ list edits (the panel and the canvas) */

/**
 * Spots a new obstacle tries in turn: rings around the centre (where every ball starts), top first – the first ring
 * inside the innermost wall of Classic (0.55 arena radii), the later ones out to the single-ring modes' wall.
 */
const SPOTS: readonly (readonly [number, number])[] = (() => {
  const spots: [number, number][] = [];
  for (const [r, n, phase] of [
    [0.3, 8, 0],
    [0.5, 8, 0.5],
    [0.7, 12, 0],
    [0.9, 16, 0.5],
  ] as const) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + ((i + phase) / n) * 2 * Math.PI;
      spots.push([round(r * Math.cos(a), 3), round(r * Math.sin(a), 3)]);
    }
  }
  return spots;
})();

/** How far (arena radii) an obstacle reaches from its centre: a circle's radius, half a bar (whichever way it turns). */
export function obstacleReach(o: Pick<EditorObstacle, "kind" | "size">): number {
  return isCircleKind(o.kind) ? o.size / 100 : o.size / 200;
}

/** Room a ball needs between two obstacles, in arena radii (a default 8 px ball in a typical arena, with a margin). */
const SPOT_CLEARANCE = 0.1;

/**
 * The first spot (arena radii) where a new obstacle of `kind` (default size) keeps SPOT_CLEARANCE from every obstacle
 * already placed – their reach included, so a spinner's sweep counts – or, when none is free, the spot with the most room.
 */
export function nextObstacleSpot(list: readonly EditorObstacle[], kind: ObstacleKind = "peg"): { x: number; y: number } {
  const reach = obstacleReach({ kind, size: DEFAULT_SIZES[kind] });
  let best: readonly [number, number] = SPOTS[0];
  let bestRoom = -Infinity;
  for (const spot of SPOTS) {
    let room = Infinity;
    for (const o of list) room = Math.min(room, Math.hypot(o.x - spot[0], o.y - spot[1]) - obstacleReach(o) - reach);
    if (room >= SPOT_CLEARANCE) return { x: spot[0], y: spot[1] };
    if (room > bestRoom) {
      bestRoom = room;
      best = spot;
    }
  }
  return { x: best[0], y: best[1] };
}

/** The list with a new obstacle of `kind` on a free spot (unchanged when the list is full). */
export function addObstacle(list: readonly EditorObstacle[], kind: ObstacleKind): EditorObstacle[] {
  if (list.length >= MAX_OBSTACLES) return list.slice();
  const spot = nextObstacleSpot(list, kind);
  return [...list, defaultObstacle(kind, spot.x, spot.y)];
}

/** The list with obstacle `index` changed (validated). */
export function updateObstacle(list: readonly EditorObstacle[], index: number, patch: Partial<EditorObstacle>): EditorObstacle[] {
  return list.map((o, i) => (i === index ? (sanitizeObstacle({ ...o, ...patch }) ?? o) : o));
}

export function removeObstacle(list: readonly EditorObstacle[], index: number): EditorObstacle[] {
  return list.filter((_, i) => i !== index);
}

/* ------------------------------------------------------------------ coordinates */

/** Where the arena sits in world (canvas CSS) pixels: its centre and the radius the relative coordinates are in. */
export interface ArenaFrame {
  cx: number;
  cy: number;
  radius: number;
}

export interface Vec {
  x: number;
  y: number;
}

/** The arena of a canvas: centred, radius = the single-ring modes' wall radius (`arenaRadius()` in types.ts). */
export function arenaFrameOf(width: number, height: number): ArenaFrame {
  return { cx: width / 2, cy: height / 2, radius: (Math.min(width, height) / 2) * 0.75 };
}

/** Arena radii → world pixels. */
export function arenaToWorld(frame: ArenaFrame, ax: number, ay: number, out: Vec = { x: 0, y: 0 }): Vec {
  out.x = frame.cx + ax * frame.radius;
  out.y = frame.cy + ay * frame.radius;
  return out;
}

/** World pixels → arena radii. */
export function worldToArena(frame: ArenaFrame, x: number, y: number, out: Vec = { x: 0, y: 0 }): Vec {
  const r = frame.radius > 0 ? frame.radius : 1;
  out.x = (x - frame.cx) / r;
  out.y = (y - frame.cy) / r;
  return out;
}

/** A 2D affine transform as CanvasRenderingContext2D.getTransform() gives it: (x, y) → (a·x + c·y + e, b·x + d·y + f). */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function applyAffine(m: Affine, x: number, y: number, out: Vec = { x: 0, y: 0 }): Vec {
  const px = m.a * x + m.c * y + m.e;
  const py = m.b * x + m.d * y + m.f;
  out.x = px;
  out.y = py;
  return out;
}

/** The point that `m` maps onto (x, y); false (and `out` untouched) when `m` is singular. */
export function invertAffinePoint(m: Affine, x: number, y: number, out: Vec): boolean {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return false;
  const dx = x - m.e;
  const dy = y - m.f;
  out.x = (m.d * dx - m.c * dy) / det;
  out.y = (-m.b * dx + m.a * dy) / det;
  return true;
}

/** A pointer's client position → canvas backing-store pixels (the element may be scaled by CSS and the device pixel ratio). */
export function clientToCanvas(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, canvasWidth: number, canvasHeight: number, out: Vec = { x: 0, y: 0 }): Vec {
  out.x = rect.width > 0 ? ((clientX - rect.left) * canvasWidth) / rect.width : 0;
  out.y = rect.height > 0 ? ((clientY - rect.top) * canvasHeight) / rect.height : 0;
  return out;
}

/** Thickness (px) of a blocker / spinner bar in an arena of `radius` px. */
export function barThickness(radius: number): number {
  return Math.max(4, 0.035 * radius);
}

/**
 * Index of the topmost obstacle (the last one drawn) within `slop` px of the world point (x, y), or −1. Circles count
 * their radius, bars their half thickness around the centre line.
 */
export function pickObstacle(items: readonly Obstacle[], x: number, y: number, slop: number): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const o = items[i];
    if (o.kind === "circle") {
      if (Math.hypot(x - o.x, y - o.y) <= o.radius + slop) return i;
    } else if (distanceToBar(o, x, y) <= o.thickness / 2 + slop) return i;
  }
  return -1;
}

function distanceToBar(bar: SegmentObstacle, x: number, y: number): number {
  const ux = Math.cos(bar.angle);
  const uy = Math.sin(bar.angle);
  const rx = x - bar.x;
  const ry = y - bar.y;
  const along = clamp(rx * ux + ry * uy, -bar.halfLength, bar.halfLength);
  return Math.hypot(rx - along * ux, ry - along * uy);
}

/* ------------------------------------------------------------------ the engine's field */

/**
 * The editor's obstacles in pixels, as the engine resolves them. `configure()` (from the engine's constructor and
 * `setConfig()`) rebuilds them when the list, the boost or the canvas size changed; `reset()` (every mode init) turns
 * the spinners back to their start angle and clears the hit state, so a run is a pure function of the settings and
 * the seed. `collide()` runs for every ball in every sub-step after it moved, before the ring walls.
 */
export class ObstacleField {
  /** The pixel obstacles, one per entry of the creator's list (same index); spinners turn in place. */
  readonly items: Obstacle[] = [];
  /** The kind of each item. */
  readonly kinds: ObstacleKind[] = [];
  /** Simulation time (ms) of the last hard hit on each item (−Infinity = none): the glow and the bumper flash. */
  readonly lastHitMs: number[] = [];
  /** Hard hits (and bumper kicks) since the last reset, for the canvas' data-* attributes and tests. */
  hitCount = 0;
  bumpCount = 0;
  private defs: readonly EditorObstacle[] = [];
  private frameValue: ArenaFrame = { cx: 0, cy: 0, radius: 0 };
  private width = -1;
  private height = -1;
  private boost = DEFAULT_BUMPER_BOOST;
  private spinning = false;
  private soundsThisStep = 0;

  /** Rebuilds the pixel obstacles when the list or the canvas size changed (a spinner whose settings stayed keeps its current angle). Returns true when it rebuilt. */
  configure(config: Pick<PhysicsConfig, "width" | "height" | "editorObstacles" | "bumperBoost">): boolean {
    this.boost = resolveBumperBoost(config.bumperBoost ?? DEFAULT_BUMPER_BOOST);
    const defs = config.editorObstacles ?? [];
    if (defs === this.defs && config.width === this.width && config.height === this.height) return false;
    const previous = this.defs;
    const previousItems = this.items.slice();
    this.defs = defs;
    this.width = config.width;
    this.height = config.height;
    this.frameValue = arenaFrameOf(config.width, config.height);
    const list = resolveObstacles(defs);
    const R = this.frameValue.radius;
    const thickness = barThickness(R);
    this.items.length = 0;
    this.kinds.length = 0;
    const hits = this.lastHitMs.slice();
    this.lastHitMs.length = 0;
    this.spinning = false;
    const at: Vec = { x: 0, y: 0 };
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      arenaToWorld(this.frameValue, o.x, o.y, at);
      const material = MATERIALS[o.kind];
      let item: Obstacle;
      if (isCircleKind(o.kind)) {
        item = circleObstacle(at.x, at.y, Math.max(3, (o.size / 100) * R), material);
      } else {
        const angularVelocity = o.kind === "spinner" ? (o.rpm * 2 * Math.PI) / 60 : 0;
        item = segmentObstacle(at.x, at.y, Math.max(6, ((o.size / 100) * R) / 2), (o.angle * Math.PI) / 180, { ...material, thickness, angularVelocity });
        const prev = previous[i];
        const prevItem = previousItems[i];
        // A spinner that only moved (or a resize) keeps turning from where it is instead of jumping back.
        if (o.kind === "spinner" && prev && prev.kind === "spinner" && prev.angle === o.angle && prev.rpm === o.rpm && prevItem?.kind === "segment") item.angle = prevItem.angle;
        if (angularVelocity !== 0) this.spinning = true;
      }
      this.items.push(item);
      this.kinds.push(o.kind);
      this.lastHitMs.push(i < hits.length && previous[i]?.kind === o.kind ? hits[i] : -Infinity);
    }
    return true;
  }

  /** A new run: spinners back to their start angle, no hits. */
  reset() {
    const list = resolveObstacles(this.defs);
    for (let i = 0; i < this.items.length && i < list.length; i++) {
      const item = this.items[i];
      if (item.kind === "segment") item.angle = (list[i].angle * Math.PI) / 180;
      this.lastHitMs[i] = -Infinity;
    }
    this.hitCount = 0;
    this.bumpCount = 0;
    this.soundsThisStep = 0;
  }

  get count() {
    return this.items.length;
  }

  /** The arena the obstacles were laid out in (world pixels). */
  get frame(): Readonly<ArenaFrame> {
    return this.frameValue;
  }

  get bumperBoost() {
    return this.boost;
  }

  /** The creator's list the items were built from. */
  get definitions(): readonly EditorObstacle[] {
    return this.defs;
  }

  /** Call once per 60 Hz step, before its sub-steps (the sound budget is per step). */
  beginStep() {
    this.soundsThisStep = 0;
  }

  /** Turns the spinners by one sub-step. */
  advance(dtSec: number) {
    if (!this.spinning) return;
    for (const o of this.items) {
      if (o.kind !== "segment" || o.angularVelocity === 0) continue;
      let a = o.angle + o.angularVelocity * dtSec;
      if (a > Math.PI || a <= -Math.PI) a -= Math.floor((a + Math.PI) / (2 * Math.PI)) * 2 * Math.PI;
      o.angle = a;
    }
  }

  /**
   * Resolves `ball` against every obstacle: push-out and rebound always (restitution × `restitutionScale`); a contact
   * at `hitSpeed` or more counts as a hit – it lights the obstacle at `nowMs`, a bumper kicks the ball to its speed
   * before the hit × the boost (× `restitutionScale`, at most BUMPER_SPEED_CAP × `baseSpeed`, never slower than the
   * rebound left it), and a sound event is queued into `events` (at most MAX_OBSTACLE_SOUNDS_PER_STEP per step).
   */
  collide(ball: Ball, dtSec: number, restitutionScale: number, hitSpeed: number, baseSpeed: number, nowMs: number, events: SoundEvent[]) {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const o = items[i];
      const bumper = this.kinds[i] === "bumper";
      const before = bumper ? Math.hypot(ball.vx, ball.vy) : 0;
      const impact = o.kind === "circle" ? resolveBallCircle(ball, o, dtSec, restitutionScale) : resolveBallSegment(ball, o, dtSec, restitutionScale);
      if (impact < hitSpeed) continue; // no contact (−1) or a soft one
      this.lastHitMs[i] = nowMs;
      this.hitCount++;
      if (bumper) {
        this.bumpCount++;
        const after = Math.hypot(ball.vx, ball.vy);
        const target = Math.max(after, Math.min(before * this.boost * restitutionScale, BUMPER_SPEED_CAP * baseSpeed));
        if (after > 1e-9 && target > after) {
          const k = target / after;
          ball.vx *= k;
          ball.vy *= k;
        }
      }
      if (this.soundsThisStep >= MAX_OBSTACLE_SOUNDS_PER_STEP) continue;
      this.soundsThisStep++;
      events.push(bumper ? { type: "hit", wallIndex: 0, frequency: bumperNote(i), accent: true, bumper: true } : { type: "hit", wallIndex: 0, frequency: obstacleNote(i) });
    }
  }
}
