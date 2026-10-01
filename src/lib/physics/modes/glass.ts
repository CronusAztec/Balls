import { resolveBallSegment, segmentBetween, segmentObstacle, type Obstacle, type SegmentObstacle } from "../obstacles";
import type { Ball, GameMode, ModeContext, ObstacleHitResult, SoundEvent } from "../types";
import { applyMultiplier, hitDamage } from "../multipliers"; // --- gerald-multipliers ---
import { rangesFor } from "@/lib/unlimited"; // --- unlimited ---

/**
 * Glass Smash ("glass" mode, the geraldbounces "Gerald is determined to smash all of the glass" format): no rings. A
 * portrait shaft – fitted into the centred square the recorder crops to, so a vertical export shows all of it – is
 * split into `stages` stages stacked on top of each other; every stage holds a column of horizontal glass panes that
 * span the shaft between the ball and the next stage, and below the last stage waits the ground with a doorway: HOME.
 * The ball falls under the mode's own gravity and every landing on a pane cracks it (a procedural crack pattern grows
 * from the impact point, drawn from `ctx.random()`) and plays a note – the next melody note or a scale degree by row;
 * a pane shatters on its last hit into 8–20 shards with an accented note and the wall-break sound (a glass clip by
 * default), and the ball crashes through to the next pane. After the last pane of a stage the camera scrolls down to
 * the next one, which has more panes, thicker panes (more hit points), panes that slide left and right and panes with
 * holes the ball must miss (falling through a hole – or past a sliding pane – skips that pane; bouncing up into it
 * from below still cracks it). The final stage ends with the ball rolling into the doorway and a celebration.
 *
 * Mechanics that keep the rhythm ASMR-steady and the run deterministic:
 *  - gravity is the mode's own (`glassGravity()`, in view heights per s², scaled by the Gravity setting) and is
 *    integrated in `onBallStep()` on the simulation clock, so it never depends on the audio level; the engine's
 *    gravity is switched off for the ball (`gravityScale` 0);
 *  - every landing re-launches the ball to a fixed hop (`GlassStage.bounceHeight`, from the pane spacing and the
 *    seeded tempo), so hits come at a steady, accelerating pulse as the panes get denser, never dying out;
 *  - panes are resolved with the obstacle layer's capsule maths (`resolveBallSegment()`), the shaft walls and the
 *    ground are ordinary engine obstacles (drawn in the wall colour with the wall glow by the canvas);
 *  - hole positions, slide phases, the door side, the tempo, every kick, crack and shard come from `ctx.random()`,
 *    so a seed replays exactly and Find Simulation can search for a clip length.
 *
 * Geometry is in canvas pixels: stage 0 starts at the top of the visible field and the stages continue below the
 * canvas; `GlassView.cameraY` is the world offset the renderer scrolls by (advanced per 60 Hz step, so it freezes
 * with a pause and replays in recordings).
 *
 * --- gerald-multipliers --- The ball's stat multipliers (lib/physics/multipliers.ts) act here too: damage takes that many
 * hit points off a pane per hit (`hitDamage()`), a speed multiplier k runs the whole flight k× faster (the same hops
 * under k² the gravity), size grows the ball. With `gates` on, a row of multiplier gates – x2 DMG, x1.5 SPEED,
 * x1.25 SIZE in a seeded order – spans the shaft above the glass of every stage; the slot the ball falls through
 * stacks its multiplier on it through the run's cap (`ctx.getMultipliers()`), with the HUD badges and the arpeggio.
 */

export interface GlassSettings {
  /** Panes in the first stage, 3–30 (later stages add more). */
  rows: number;
  /** Hits a pane of the first stage takes before it shatters, 1–5 (every other stage adds one, up to two). */
  hp: number;
  /** Stages from the top to HOME, 1–10. */
  stages: number;
  /** From the third stage on, some panes are narrower and slide left and right. */
  moving: boolean;
  /** From the second stage on, some panes have a hole the ball must miss. */
  holes: boolean;
  /** --- gerald-multipliers --- A row of multiplier gates (x2 DMG, x1.5 SPEED, x1.25 SIZE) above the glass of every stage. */
  gates: boolean;
}

export const DEFAULT_GLASS_SETTINGS: GlassSettings = {
  rows: 6,
  hp: 2,
  stages: 4,
  moving: true,
  holes: true,
  gates: false,
};

/** Slider ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const GLASS_RANGES = {
  glassRows: { min: 3, max: 30, step: 1 },
  glassHp: { min: 1, max: 5, step: 1 },
  glassStages: { min: 1, max: 10, step: 1 },
} as const;

/** The Glass Smash fields of the SimulatorSettings object (URL keys glr, glhp, gls, glm, glh, glg). */
export interface GlassSettingFields {
  glassRows: number;
  glassHp: number;
  glassStages: number;
  glassMoving: boolean;
  glassHoles: boolean;
  glassGates: boolean;
}

function clampNumber(value: unknown, range: { min: number; max: number }, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(range.min, Math.min(range.max, n)) : fallback;
}

/** Fills in the defaults and clamps every value to its range as a whole number (non-boolean flags and bad numbers fall back to the defaults). */
export function resolveGlassSettings(config: Partial<GlassSettings> | null | undefined, unlimited = false): GlassSettings {
  const out = { ...DEFAULT_GLASS_SETTINGS };
  if (!config) return out;
  const R = rangesFor(GLASS_RANGES, unlimited); // --- unlimited --- (past the sliders up to the soft ceilings with No limits on)
  if (config.rows !== undefined) out.rows = Math.round(clampNumber(config.rows, R.glassRows, out.rows));
  if (config.hp !== undefined) out.hp = Math.round(clampNumber(config.hp, R.glassHp, out.hp));
  if (config.stages !== undefined) out.stages = Math.round(clampNumber(config.stages, R.glassStages, out.stages));
  if (typeof config.moving === "boolean") out.moving = config.moving;
  if (typeof config.holes === "boolean") out.holes = config.holes;
  if (typeof config.gates === "boolean") out.gates = config.gates;
  return out;
}

/** Picks the Glass Smash settings out of a bigger object (the SimulatorSettings, a preset…) for `engine.setGlassSettings()`. */
export function glassSettingsOf(source: GlassSettingFields): GlassSettings {
  return { rows: source.glassRows, hp: source.glassHp, stages: source.glassStages, moving: source.glassMoving, holes: source.glassHoles, gates: source.glassGates };
}

/** Writes resolved Glass Smash settings back into the SimulatorSettings field names. */
export function glassSettingFields(settings: GlassSettings): GlassSettingFields {
  return { glassRows: settings.rows, glassHp: settings.hp, glassStages: settings.stages, glassMoving: settings.moving, glassHoles: settings.holes, glassGates: settings.gates };
}

/* ------------------------------------------------------------------ progression */

/** No stage has more panes than this. */
export const MAX_STAGE_ROWS = 30;
/** No pane takes more hits than this (the thickest glass). */
export const MAX_PANE_HP = 7;

/**
 * Panes in stage `stage` (0-based): the setting, plus a third of it per stage after the first, up to MAX_STAGE_ROWS –
 * --- unlimited --- or up to the setting itself when No limits takes it past MAX_STAGE_ROWS (every stage that many panes).
 */
export function stageRows(rows: number, stage: number): number {
  const n = Math.round(rows);
  return Math.min(Math.max(MAX_STAGE_ROWS, n), n + Math.ceil((stage * n) / 3));
}

/** Hit points of the panes in stage `stage`: the setting, one more every other stage (at most two more; MAX_PANE_HP on the slider). */
export function stageHp(hp: number, stage: number): number {
  const n = Math.round(hp);
  return Math.min(Math.max(MAX_PANE_HP, n), n + Math.min(2, Math.floor(stage / 2))); // --- unlimited --- (past the slider: the setting's own)
}

/** Chance that a pane of stage `stage` has a hole (from the second stage on, more from the fifth). */
export function stageHoleChance(settings: GlassSettings, stage: number): number {
  if (!settings.holes || stage < 1) return 0;
  return stage >= 4 ? 0.45 : 0.3;
}

/** Chance that a pane of stage `stage` slides (from the third stage on, more from the sixth). */
export function stageMoveChance(settings: GlassSettings, stage: number): number {
  if (!settings.moving || stage < 2) return 0;
  return stage >= 5 ? 0.4 : 0.3;
}

/* ------------------------------------------------------------------ sound */

const MAJOR_DEGREES = [0, 2, 4, 5, 7, 9, 11];
/** Scale degrees a stage's rows climb through before folding back (two octaves and the top note). */
export const PITCH_DEGREES = 15;
/** MIDI note of the first row of the first stage (C4). */
export const PITCH_BASE_MIDI = 60;

function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Pitch of a pane hit without a melody: the pane's row as a degree of C major from C4, climbing as the ball smashes
 * its way down, each stage two degrees higher than the one before, folded into two octaves (C4–C6). The tone
 * generator snaps it to the chosen scale like every other note.
 */
export function glassPitch(stage: number, row: number): number {
  const degree = (Math.max(0, Math.round(row)) + 2 * Math.max(0, Math.round(stage))) % PITCH_DEGREES;
  return midiToHz(PITCH_BASE_MIDI + 12 * Math.floor(degree / 7) + MAJOR_DEGREES[degree % 7]);
}

/** The ground thud (C3) and the HOME chord (C major, C5 E5 G5 C6). */
export const GROUND_NOTE = midiToHz(48);
export const HOME_CHORD: readonly number[] = [midiToHz(72), midiToHz(76), midiToHz(79), midiToHz(84)];

/* ------------------------------------------------------------------ layout */

/** Width of the shaft relative to its height (a 9:16-ish portrait column). */
export const SHAFT_ASPECT = 0.62;
/** Where the ball starts, as a fraction of the view height below the top of the field. */
export const START_Y = 0.07;
/** Room above the panes of a stage (the ball falls in through it, the banner shows there), in view heights. */
export const STAGE_TOP_PAD = 0.24;
/** Height the panes of a stage spread over, in view heights (more when the panes need more room). */
export const PANE_ZONE = 0.64;
/** Room below the last pane of a stage, in view heights. */
export const STAGE_BOTTOM_PAD = 0.05;
/** Height of the HOME area below the last stage (the ground at its bottom), in view heights. */
export const HOME_HEIGHT = 0.4;
/** Thickness of a 1-hit pane in view heights; every further hit point adds 28 % (a 7-hit pane is 2.7× as thick). */
export const PANE_THICKNESS = 0.02;
/** Hop after a landing: this fraction of the pane spacing, kept between the two limits (view heights). */
export const BOUNCE_OF_SPACING = 0.8;
export const BOUNCE_MIN = 0.06;
export const BOUNCE_MAX = 0.15;
/**
 * Width of the seeded tempo band: every hop is scaled by tempo² with the tempo drawn from 1 ± TEMPO_SPREAD / 2, so the
 * bounce period – and with it the run length – varies continuously with the seed (what Find Simulation needs).
 */
export const TEMPO_SPREAD = 0.24;
/** A sliding pane is this fraction of the shaft wide. */
export const MOVING_WIDTH = 0.62;
/** A hole is at least this fraction of the shaft wide (and always wide enough for the ball). */
export const HOLE_WIDTH = 0.2;

export interface GlassField {
  /** The visible shaft (canvas px): the stages continue below `bottom`. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  /** Height of the visible field – the unit of the layout ("view height"). */
  height: number;
  cx: number;
}

/** The shaft for a canvas of `width` × `height`: a portrait column filling the height of the centred square the recorder crops to. */
export function buildGlassField(width: number, height: number): GlassField {
  const margin = Math.max(6, 0.02 * Math.min(width, height));
  const side = Math.max(60, Math.min(width, height) - 2 * margin);
  const w = side * SHAFT_ASPECT;
  const left = (width - w) / 2;
  const top = (height - side) / 2;
  return { left, right: left + w, top, bottom: top + side, width: w, height: side, cx: width / 2 };
}

export type GlassPaneKind = "plain" | "hole" | "moving";

/** A crack: rays of line segments that grow from the impact point (all relative to the pane's centre). */
export interface GlassCrack {
  /** Impact point relative to the pane's centre (x along it, y across it). */
  x: number;
  y: number;
  /** Simulation time of the hit (ms): the renderer grows the rays over `CRACK_GROW_MS` from it. */
  atMs: number;
  /** Longest distance from the impact along any ray. */
  length: number;
  /** Segments, 5 numbers each: x1, y1, x2, y2 (relative to the pane's centre) and the distance of (x2, y2) from the impact along its ray. */
  segs: Float32Array;
  /** Segments in `segs`. */
  count: number;
}

export interface GlassPane {
  index: number;
  stage: number;
  /** Row within its stage (0 = top). */
  row: number;
  kind: GlassPaneKind;
  /** Centre (world px); `x` moves for a sliding pane. */
  x: number;
  y: number;
  halfWidth: number;
  thickness: number;
  /** Sliding panes: x = baseX + moveAmp · sin(2π t / movePeriod + movePhase). */
  baseX: number;
  moveAmp: number;
  movePeriod: number;
  movePhase: number;
  /** A hole's centre relative to the pane's centre and half its width (0 without a hole). */
  holeX: number;
  holeHalf: number;
  maxHp: number;
  hp: number;
  hits: number;
  cracks: GlassCrack[];
  /** Simulation time of the last hit (ms), −Infinity before the first. */
  lastHitMs: number;
  shattered: boolean;
  shatteredAtMs: number;
  /** Shattered, or the ball is below it (it fell through a hole or past a sliding pane). */
  cleared: boolean;
  /** Tint of the glass (a stage colour). */
  hue: number;
  /** Note of a hit (see `glassPitch()`). */
  pitch: number;
  /** The glass as capsules for the collision maths: one segment, two around a hole. */
  segments: SegmentObstacle[];
}

export interface GlassStage {
  index: number;
  /** World y of the top and bottom of the stage. */
  top: number;
  bottom: number;
  rows: number;
  hp: number;
  /** Distance between two panes (px). */
  spacing: number;
  /** Hop height after a landing in this stage (px, tempo included). */
  bounceHeight: number;
  /** Index of the stage's first pane in `GlassLevel.panes`. */
  firstPane: number;
  holes: number;
  moving: number;
}

export interface GlassHome {
  /** World y where the HOME area starts (the bottom of the last stage). */
  top: number;
  groundY: number;
  doorX: number;
  doorWidth: number;
  doorHeight: number;
}

/* --- gerald-multipliers --- multiplier gates (settings.gates) */

/** The stats a gate row multiplies – the board's gate kinds of the same names – and by how much. */
export const GLASS_GATE_KINDS = ["damage", "speed", "size"] as const;
export type GlassGateKind = (typeof GLASS_GATE_KINDS)[number];
/** x2 DMG (a pane loses two hit points a hit), x1.5 SPEED (the whole flight runs 1.5× faster), x1.25 SIZE. */
export const GLASS_GATE_FACTORS: Record<GlassGateKind, number> = { damage: 2, speed: 1.5, size: 1.25 };
/** Where a stage's gate row sits, in view heights below the stage's top: under its "STAGE n" banner, over its first pane. */
export const GATE_Y = 0.205;
/** A size gate never grows the ball wider than this fraction of the shaft (radius), whatever room the panes leave. */
export const MAX_BALL_OF_SHAFT = 0.15;

/** One slot of a gate row: the stat it multiplies, by how much, and its x range (world px). */
export interface GlassGate {
  kind: GlassGateKind;
  factor: number;
  x0: number;
  x1: number;
}

/** A row of gates across the shaft above the glass of a stage; the ball's x picks the slot it goes through, once. */
export interface GlassGateRow {
  stage: number;
  /** World y of the gate line. */
  y: number;
  slots: GlassGate[];
  /** The slot the ball went through (−1 before), when (simulation ms) and the factor it got (a size gate may give less, a cap too). */
  passedSlot: number;
  passedAtMs: number;
  applied: number;
}

/** The slot of `row` that world x `x` falls into (the nearest one beyond the walls). */
export function gateSlotAt(row: GlassGateRow, x: number): number {
  const slots = row.slots;
  for (let i = 0; i < slots.length - 1; i++) if (x < slots[i].x1) return i;
  return slots.length - 1;
}

/**
 * The gate rows of a level: one per stage, `GATE_Y` view heights below its top, with a slot of each kind across the
 * shaft in an order drawn from `random` (two numbers per row, drawn after everything else, so the glass is the same
 * with or without gates).
 */
export function buildGlassGates(field: GlassField, stages: readonly GlassStage[], random: () => number): GlassGateRow[] {
  const rows: GlassGateRow[] = [];
  const n = GLASS_GATE_KINDS.length;
  const w = field.width / n;
  for (const st of stages) {
    const order: GlassGateKind[] = [...GLASS_GATE_KINDS];
    // A seeded Fisher–Yates shuffle of the three kinds.
    for (let i = n - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(random() * (i + 1)));
      const k = order[i];
      order[i] = order[j];
      order[j] = k;
    }
    rows.push({
      stage: st.index,
      y: st.top + GATE_Y * field.height,
      slots: order.map((kind, i) => ({ kind, factor: GLASS_GATE_FACTORS[kind], x0: field.left + i * w, x1: i === n - 1 ? field.right : field.left + (i + 1) * w })),
      passedSlot: -1,
      passedAtMs: -Infinity,
      applied: 1,
    });
  }
  return rows;
}

/**
 * The largest radius the ball may grow to from stage `fromStage` on and still get between the panes and through the
 * holes of every stage left (a pixel to spare on either side), and never more than `MAX_BALL_OF_SHAFT` of the shaft –
 * but never less than the radius the level was laid out for.
 */
export function glassMaxBallRadius(level: GlassLevel, fromStage: number): number {
  let max = MAX_BALL_OF_SHAFT * level.field.width;
  for (let s = Math.max(0, fromStage); s < level.stages.length; s++) {
    const st = level.stages[s];
    const first = level.panes[st.firstPane];
    if (st.rows > 1 && first) max = Math.min(max, (st.spacing - first.thickness) / 2 - 1);
    for (let j = st.firstPane; j < st.firstPane + st.rows && j < level.panes.length; j++) {
      const pane = level.panes[j];
      if (pane.kind === "hole" && pane.holeHalf > 0) max = Math.min(max, pane.holeHalf - 1);
    }
  }
  return Math.max(level.ballRadius, max);
}
/* --- end gerald-multipliers --- */

export interface GlassLevel {
  field: GlassField;
  stages: GlassStage[];
  panes: GlassPane[];
  /** --- gerald-multipliers --- The multiplier gate rows, top-down (empty unless `settings.gates`). */
  gates: GlassGateRow[];
  home: GlassHome;
  /** World y of the lowest thing (just below the ground). */
  worldBottom: number;
  /** The run's seeded tempo (1 ± TEMPO_SPREAD / 2). */
  tempo: number;
  /** Where the ball starts and its sideways speed. */
  startX: number;
  startY: number;
  startVx: number;
  /** The ball radius the level was laid out for. */
  ballRadius: number;
}

/** Hue of the glass of each stage (icy blue, drifting to teal and violet deeper down). */
export function stageHue(stage: number): number {
  return (195 + 28 * stage) % 360;
}

/** Thickness (px) of a pane with `hp` hit points in a view `viewH` px tall. */
export function paneThickness(hp: number, viewH: number): number {
  return PANE_THICKNESS * viewH * (1 + 0.28 * (Math.min(MAX_PANE_HP, hp) - 1)); // --- unlimited --- (a billion hit points look like the thickest glass)
}

/** Rebuilds the collision capsules of a pane from its current geometry (a sliding pane moves them every step). */
export function updatePaneSegments(pane: GlassPane) {
  const left = pane.x - pane.halfWidth;
  const right = pane.x + pane.halfWidth;
  const half = pane.thickness / 2;
  if (pane.kind === "hole" && pane.holeHalf > 0) {
    // The capsules' rounded ends reach half a thickness beyond their centre lines: pull them in so the glass ends where it is drawn.
    const a = pane.x + pane.holeX - pane.holeHalf;
    const b = pane.x + pane.holeX + pane.holeHalf;
    placeSegment(pane.segments[0], left + half, a - half, pane.y);
    placeSegment(pane.segments[1], b + half, right - half, pane.y);
  } else placeSegment(pane.segments[0], left + half, right - half, pane.y);
}

function placeSegment(seg: SegmentObstacle, x1: number, x2: number, y: number) {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  seg.x = (lo + hi) / 2;
  seg.y = y;
  seg.halfLength = Math.max(0, (hi - lo) / 2);
  seg.angle = 0;
}

/** Fraction of the approach speed a ball keeps on the underside of a pane, on the shaft walls and on the ground. */
export const PANE_RESTITUTION = 0.5;
export const WALL_RESTITUTION = 0.75;
export const GROUND_RESTITUTION = 0.45;

/**
 * Lays out a whole level for a canvas of `width` × `height`: the stages one under the other (stage 0 at the top of
 * the visible field), each with its panes, then the HOME area with the ground and the door. `random` is the
 * engine's seeded generator: the tempo, the door side, the ball's start and, per pane, three numbers (its kind, then
 * where its hole sits or how it slides) – always three, so one pane's kind never shifts the next pane's numbers –
 * and last, with `settings.gates`, the order of every gate row's slots.
 */
export function buildGlassLevel(width: number, height: number, settingsIn: Partial<GlassSettings>, ballRadius: number, random: () => number, unlimited = false): GlassLevel {
  const settings = resolveGlassSettings(settingsIn, unlimited); // --- unlimited --- (as the mode resolved them)
  const field = buildGlassField(width, height);
  const viewH = field.height;
  const r = Math.max(2, ballRadius);
  const tempo = 1 + (random() - 0.5) * TEMPO_SPREAD;
  const doorLeft = random() < 0.5;
  const startX = field.cx + (random() - 0.5) * 0.3 * field.width;
  const startVx = (random() - 0.5) * 0.12 * viewH;
  const stages: GlassStage[] = [];
  const panes: GlassPane[] = [];
  let top = field.top;
  for (let s = 0; s < settings.stages; s++) {
    const rows = stageRows(settings.rows, s);
    const hp = stageHp(settings.hp, s);
    const thickness = paneThickness(hp, viewH);
    const minSpacing = thickness + 2.6 * r + 2;
    const spacing = Math.max(minSpacing, (PANE_ZONE * viewH) / rows);
    const bounceHeight = Math.max(BOUNCE_MIN * viewH, Math.min(BOUNCE_MAX * viewH, BOUNCE_OF_SPACING * spacing)) * tempo * tempo;
    const holeChance = stageHoleChance(settings, s);
    const moveChance = stageMoveChance(settings, s);
    const stage: GlassStage = { index: s, top, bottom: 0, rows, hp, spacing, bounceHeight, firstPane: panes.length, holes: 0, moving: 0 };
    const firstY = top + STAGE_TOP_PAD * viewH + spacing / 2;
    for (let j = 0; j < rows; j++) {
      const u = random();
      const v = random();
      const w = random();
      // The first pane of a stage is always whole: every stage opens with a clean smash.
      const kind: GlassPaneKind = j > 0 && u < moveChance ? "moving" : j > 0 && u < moveChance + holeChance ? "hole" : "plain";
      const pane: GlassPane = {
        index: panes.length,
        stage: s,
        row: j,
        kind,
        x: field.cx,
        y: firstY + j * spacing,
        halfWidth: field.width / 2,
        thickness,
        baseX: field.cx,
        moveAmp: 0,
        movePeriod: 1,
        movePhase: 0,
        holeX: 0,
        holeHalf: 0,
        maxHp: hp,
        hp,
        hits: 0,
        cracks: [],
        lastHitMs: -Infinity,
        shattered: false,
        shatteredAtMs: -Infinity,
        cleared: false,
        hue: stageHue(s),
        pitch: glassPitch(s, j),
        segments: [segmentObstacle(field.cx, 0, 0, 0, { thickness, restitution: PANE_RESTITUTION })],
      };
      if (kind === "moving") {
        pane.halfWidth = (MOVING_WIDTH * field.width) / 2;
        pane.moveAmp = field.width / 2 - pane.halfWidth;
        pane.movePeriod = 2.2 + 1.4 * v;
        pane.movePhase = 2 * Math.PI * w;
        pane.x = pane.baseX + pane.moveAmp * Math.sin(pane.movePhase);
        stage.moving++;
      } else if (kind === "hole") {
        pane.holeHalf = Math.max(HOLE_WIDTH * field.width, 2 * r + thickness + 2.4 * r) / 2;
        const margin = 0.08 * field.width + pane.holeHalf;
        pane.holeX = -field.width / 2 + margin + v * Math.max(0, field.width - 2 * margin);
        pane.segments.push(segmentObstacle(field.cx, 0, 0, 0, { thickness, restitution: PANE_RESTITUTION }));
        stage.holes++;
      }
      updatePaneSegments(pane);
      panes.push(pane);
    }
    stage.bottom = firstY + (rows - 1) * spacing + spacing / 2 + STAGE_BOTTOM_PAD * viewH;
    stages.push(stage);
    top = stage.bottom;
  }
  const groundY = top + HOME_HEIGHT * viewH;
  const doorWidth = Math.max(3.4 * r, 0.2 * field.width);
  const doorHeight = Math.min(0.3 * viewH, Math.max(4.5 * r, 0.17 * viewH));
  const doorX = field.left + (doorLeft ? 0.25 : 0.75) * field.width;
  // --- gerald-multipliers --- the gate rows draw their numbers last, so the glass is the same with or without them
  const gates = settings.gates ? buildGlassGates(field, stages, random) : [];
  return {
    field,
    stages,
    panes,
    gates,
    home: { top, groundY, doorX, doorWidth, doorHeight },
    worldBottom: groundY + 0.04 * viewH,
    tempo,
    startX,
    startY: field.top + START_Y * viewH,
    startVx,
    ballRadius: r,
  };
}

/** The engine obstacles of a level: the two shaft walls (reaching a view height above the top) and the ground. */
export function buildGlassObstacles(level: GlassLevel): { obstacles: Obstacle[]; ground: SegmentObstacle } {
  const f = level.field;
  const wallTop = f.top - f.height;
  const ground = segmentBetween(f.left, level.home.groundY, f.right, level.home.groundY, { restitution: GROUND_RESTITUTION });
  return {
    obstacles: [segmentBetween(f.left, wallTop, f.left, level.home.groundY, { restitution: WALL_RESTITUTION }), segmentBetween(f.right, wallTop, f.right, level.home.groundY, { restitution: WALL_RESTITUTION }), ground],
    ground,
  };
}

/** The x range (relative to the pane's centre) of the solid glass that contains `x`: the whole pane, or one side of its hole. */
export function solidSpan(pane: GlassPane, x: number): [number, number] {
  const hw = pane.halfWidth;
  if (pane.kind !== "hole" || pane.holeHalf <= 0) return [-hw, hw];
  const a = pane.holeX - pane.holeHalf;
  const b = pane.holeX + pane.holeHalf;
  return x < pane.holeX ? [-hw, a] : [b, hw];
}

/** How far a pane is broken, 0–1: the hit points it lost (a damage multiplier takes several a hit). */
export function paneDamage(pane: Pick<GlassPane, "hp" | "maxHp">): number {
  return pane.maxHp > 0 ? Math.max(0, Math.min(1, (pane.maxHp - pane.hp) / pane.maxHp)) : 0;
}

/* ------------------------------------------------------------------ cracks */

/** Milliseconds a new crack takes to grow to its full length. */
export const CRACK_GROW_MS = 160;
/** Most segments one crack holds (5 rays of 4 segments plus branches). */
const MAX_CRACK_SEGMENTS = 32;
/** --- unlimited --- Cracks a pane keeps (the newest): more than the thickest glass of the slider ever takes (MAX_PANE_HP hits). */
export const MAX_PANE_CRACKS = 16;

/**
 * A procedural crack from a hit at `impactX` (relative to the pane's centre) on the top face (`fromAbove`) or the
 * underside: 3–5 rays fan into the glass, zig-zagging, bounce off the faces of the thin pane and run along it; a ray
 * may fork. Later hits (higher `damage`, 0–1) make longer cracks. Everything stays inside the solid glass around the
 * impact (never across a hole) and comes from `random`, so the pattern is part of the seeded run.
 */
export function makeCrack(pane: GlassPane, impactX: number, fromAbove: boolean, damage: number, atMs: number, random: () => number): GlassCrack {
  const half = pane.thickness / 2;
  const [lo, hi] = solidSpan(pane, impactX);
  const x0 = Math.max(lo + 0.5, Math.min(hi - 0.5, impactX));
  const y0 = fromAbove ? -half + 0.5 : half - 0.5;
  const segs = new Float32Array(5 * MAX_CRACK_SEGMENTS);
  let count = 0;
  let longest = 0;
  const maxLen = Math.max(4, pane.thickness * (1.6 + 3.2 * Math.max(0, Math.min(1, damage))));
  const rays = 3 + Math.floor(random() * 3);
  const walk = (sx: number, sy: number, angle: number, length: number, startDist: number, steps: number) => {
    let x = sx;
    let y = sy;
    let a = angle;
    let dist = startDist;
    const step = length / steps;
    for (let k = 0; k < steps && count < MAX_CRACK_SEGMENTS; k++) {
      a += (random() - 0.5) * 0.9;
      let nx = x + Math.cos(a) * step;
      let ny = y + Math.sin(a) * step;
      // The faces of the pane turn the ray: it bounces off and runs on along the glass.
      if (ny < -half + 0.3 || ny > half - 0.3) {
        ny = Math.max(-half + 0.3, Math.min(half - 0.3, ny));
        a = Math.atan2(-Math.sin(a) * 0.35, Math.cos(a));
      }
      let stop = false;
      if (nx < lo + 0.3 || nx > hi - 0.3) {
        nx = Math.max(lo + 0.3, Math.min(hi - 0.3, nx));
        stop = true;
      }
      dist += Math.hypot(nx - x, ny - y);
      const o = 5 * count;
      segs[o] = x;
      segs[o + 1] = y;
      segs[o + 2] = nx;
      segs[o + 3] = ny;
      segs[o + 4] = dist;
      count++;
      if (dist > longest) longest = dist;
      x = nx;
      y = ny;
      if (stop) break;
    }
    return { x, y, a, dist };
  };
  for (let i = 0; i < rays; i++) {
    // A fan into the glass: downward from the top face, upward from the underside, spread over ~150°.
    const spread = ((i + 0.5 + (random() - 0.5) * 0.6) / rays) * 2.6 - 1.3;
    const angle = (fromAbove ? Math.PI / 2 : -Math.PI / 2) + spread;
    const length = maxLen * (0.55 + 0.45 * random());
    const end = walk(x0, y0, angle, length, 0, 4);
    if (random() < 0.4 && count < MAX_CRACK_SEGMENTS - 2) walk(end.x, end.y, end.a + (random() < 0.5 ? 0.7 : -0.7), 0.4 * length, end.dist, 2);
  }
  return { x: x0, y: y0, atMs, length: longest, segs, count };
}

/* ------------------------------------------------------------------ shards */

/** Shards alive at once (the oldest make room); a shatter throws 8–20. */
export const MAX_SHARDS = 200;
export const MIN_SHARDS_PER_PANE = 8;
export const MAX_SHARDS_PER_PANE = 20;

/** How many shards a pane of this width (fraction of the shaft) and thickness (hit points) breaks into: 8–20. */
export function shardCount(widthFraction: number, maxHp: number, u: number): number {
  const n = MIN_SHARDS_PER_PANE + Math.floor(5 * u) + Math.round(5 * Math.max(0, Math.min(1, widthFraction)) + (3 * Math.max(0, maxHp - 1)) / (MAX_PANE_HP - 1));
  return Math.max(MIN_SHARDS_PER_PANE, Math.min(MAX_SHARDS_PER_PANE, n));
}

/* ------------------------------------------------------------------ the mode */

/** Gravity of the mode in view heights per s² at the default Gravity setting (300). */
export const GLASS_GRAVITY = 3.2;
/** Sideways kick range after a landing, in view heights per second at the default Ball Speed (400). */
export const DRIFT = 0.16;
/** Fastest sideways speed the kicks build up to, in view heights per second. */
export const MAX_DRIFT = 0.45;
/** Speed (px/s) from which a contact counts as a hit (a crack, a note). */
export const HIT_SPEED = 40;
/** Fraction of its speed the ball keeps when it crashes through a shattering pane. */
export const SHATTER_KEEP = 0.72;
/** Speed at which the ball rolls to the door once it landed on the ground, in view heights per second. */
export const WALK_SPEED = 0.55;
/** How long the celebration at HOME lasts before the run is finished (ms). */
export const CELEBRATION_MS = 1800;
/** How long the stage banner shows (ms). */
export const BANNER_MS = 1500;
/** Time constant of the camera (s): it eases toward its target, never letting the ball out of view. */
export const CAMERA_TAU = 0.14;
/** Where the camera keeps the ball in a stage taller than the view (fraction of the view height from the top). */
export const CAMERA_FOLLOW = 0.36;
/** Most sounds one 60 Hz step may queue. */
export const MAX_GLASS_SOUNDS_PER_STEP = 4;

/** Gravity (px/s²) for a view `viewH` px tall: GLASS_GRAVITY view heights per s², scaled by the Gravity setting (0.3×–3×). */
export function glassGravity(gravitySetting: number, viewH: number): number {
  const factor = Number.isFinite(gravitySetting) ? Math.max(0.3, Math.min(3, gravitySetting / 300)) : 1;
  return GLASS_GRAVITY * viewH * factor;
}

/** Launch speed (px/s) that lifts the ball `height` px under gravity `g`. */
export function hopSpeed(g: number, height: number): number {
  return Math.sqrt(2 * Math.max(0, g) * Math.max(0, height));
}

/**
 * --- gerald-multipliers --- How much faster the ball's flight runs: its speed multiplier (1 for a plain ball). The mode
 * scales its gravity by the square and its hops, kicks and walk by it, so the ball flies the same arcs that much faster.
 */
export function glassTempo(ball: Pick<Ball, "mult">): number {
  return ball.mult ? ball.mult.speed : 1;
}

/** The stage a world y belongs to: 0 … stages − 1, or `stages` in the HOME area below the last one. */
export function stageAt(level: GlassLevel, y: number): number {
  const stages = level.stages;
  for (let s = 0; s < stages.length; s++) if (y < stages[s].bottom) return s;
  return stages.length;
}

/**
 * Where the camera wants to be (world offset: screen y = world y − cameraY) with the ball at `ballY` in stage `stage`:
 * the top of the stage lined up with the top of the field – following the ball down a stage taller than the view –
 * or, at HOME, the ground at the bottom of the view.
 */
export function cameraTarget(level: GlassLevel, stage: number, ballY: number): number {
  const f = level.field;
  if (stage >= level.stages.length) return Math.max(0, level.worldBottom - f.bottom);
  const st = level.stages[Math.max(0, stage)];
  const lo = st.top;
  const hi = Math.max(lo, st.bottom - f.height);
  const top = Math.max(lo, Math.min(hi, ballY - CAMERA_FOLLOW * f.height));
  return top - f.top;
}

/** What the canvas needs to draw the shaft; the same object every call. */
export interface GlassView {
  level: GlassLevel | null;
  settings: GlassSettings;
  /** Simulation time (ms) of the current step. */
  timeMs: number;
  /** World offset the renderer scrolls by: screen y = world y − cameraY. */
  cameraY: number;
  /** The stage the ball is in (the number of stages at HOME). */
  stage: number;
  /** The stage whose banner shows and when it started (ms). */
  bannerStage: number;
  bannerAtMs: number;
  hits: number;
  shattered: number;
  cleared: number;
  panes: number;
  homeReached: boolean;
  homeAtMs: number;
  finished: boolean;
  /** --- gerald-multipliers --- Gate rows the ball went through. */
  gatesPassed: number;
  /** Shards: a pool of `MAX_SHARDS`, `shardCount` of them alive (positions in world px). */
  shardCount: number;
  shardX: Float64Array;
  shardY: Float64Array;
  shardVx: Float64Array;
  shardVy: Float64Array;
  shardRot: Float64Array;
  shardSpin: Float64Array;
  shardSize: Float64Array;
  shardLife: Float64Array;
  shardMaxLife: Float64Array;
  shardHue: Float64Array;
  /** Four corners per shard (unit offsets, rotated and scaled by the renderer). */
  shardShape: Float32Array;
}

function createView(): GlassView {
  return {
    level: null,
    settings: { ...DEFAULT_GLASS_SETTINGS },
    timeMs: 0,
    cameraY: 0,
    stage: 0,
    bannerStage: 0,
    bannerAtMs: 0,
    hits: 0,
    shattered: 0,
    cleared: 0,
    panes: 0,
    homeReached: false,
    homeAtMs: -Infinity,
    finished: false,
    gatesPassed: 0,
    shardCount: 0,
    shardX: new Float64Array(MAX_SHARDS),
    shardY: new Float64Array(MAX_SHARDS),
    shardVx: new Float64Array(MAX_SHARDS),
    shardVy: new Float64Array(MAX_SHARDS),
    shardRot: new Float64Array(MAX_SHARDS),
    shardSpin: new Float64Array(MAX_SHARDS),
    shardSize: new Float64Array(MAX_SHARDS),
    shardLife: new Float64Array(MAX_SHARDS),
    shardMaxLife: new Float64Array(MAX_SHARDS),
    shardHue: new Float64Array(MAX_SHARDS),
    shardShape: new Float32Array(8 * MAX_SHARDS),
  };
}

export class GlassMode implements GameMode {
  readonly name = "glass";
  /** The ball keeps the speed the mode gives it (no slow-ball boost) and rests in the doorway at the end. */
  readonly ballsMayRest = true;
  /** One ball; nothing to collide with. */
  readonly ballsPassThrough = true;
  private settings: GlassSettings = { ...DEFAULT_GLASS_SETTINGS };
  /** --- unlimited --- No limits was on at the last `setSettings()` (the plans built from the settings resolve them the same way). */
  private unlimited = false;
  private readonly view: GlassView = createView();
  private ground: SegmentObstacle | null = null;
  private ballId = -1;
  /** First pane the ball has not passed yet (panes are sorted top-down). */
  private passCursor = 0;
  /** --- gerald-multipliers --- First gate row the ball has not gone through yet, and first one gone through but not applied (they apply at the end of the step). */
  private gateCursor = 0;
  private gateApplied = 0;
  private landedHome = false;
  private confettiDone = 0;
  private soundsThisStep = 0;
  /** Canvas size the level is laid out for (a resize rescales it). */
  private layoutW = 0;
  private layoutH = 0;
  /** The random numbers the level was built from, so a resize before the first step can lay it out afresh. */
  private tape: number[] = [];
  /** A step has run since the last init (a resize then rescales the level instead of laying it out afresh). */
  private started = false;

  getSettings(): GlassSettings {
    return this.settings;
  }
  /** Applied on the next init (the Simulator re-inits the mode when a Glass Smash setting changes). */
  /** `unlimited`: No limits is on – the unlimited settings run past their sliders, up to their soft ceilings. */
  setSettings(patch: Partial<GlassSettings>, unlimited = false) {
    this.unlimited = unlimited; // --- unlimited ---
    this.settings = resolveGlassSettings({ ...this.settings, ...patch }, unlimited);
  }
  /** Live state for the canvas and the HUD; the same object every call. */
  getView(): GlassView {
    return this.view;
  }
  getProgress() {
    const v = this.view;
    return { stage: Math.min(v.stage, this.settings.stages - 1) + 1, stages: this.settings.stages, hits: v.hits, shattered: v.shattered, panes: v.panes, home: v.homeReached, finished: v.finished, gates: v.gatesPassed };
  }

  init(ctx: ModeContext) {
    ctx.setDestructionMode(false);
    ctx.setInfiniteMode(false);
    ctx.setBounceSpeedMultiplier(1);
    const v = this.view;
    const cfg = ctx.config;
    const tape: number[] = [];
    const level = buildGlassLevel(cfg.width, cfg.height, this.settings, cfg.ballRadius || 8, () => {
      const u = ctx.random();
      tape.push(u);
      return u;
    }, this.unlimited);
    this.tape = tape;
    this.started = false;
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    v.level = level;
    v.settings = { ...this.settings };
    v.timeMs = 0;
    v.cameraY = 0;
    v.stage = 0;
    v.bannerStage = 0;
    v.bannerAtMs = 0;
    v.hits = 0;
    v.shattered = 0;
    v.cleared = 0;
    v.panes = level.panes.length;
    v.homeReached = false;
    v.homeAtMs = -Infinity;
    v.finished = false;
    v.gatesPassed = 0;
    v.shardCount = 0;
    this.passCursor = 0;
    this.gateCursor = 0;
    this.gateApplied = 0;
    this.landedHome = false;
    this.confettiDone = 0;
    this.soundsThisStep = 0;
    const { obstacles, ground } = buildGlassObstacles(level);
    this.ground = ground;
    ctx.setObstacles(obstacles);
    ctx.addBall({
      x: level.startX,
      y: level.startY,
      vx: level.startVx,
      vy: 0,
      radius: cfg.ballRadius || 8,
      color: cfg.ballColor || "#FFFFFF",
      // The mode integrates its own gravity (onBallStep), so the audio-reactive engine gravity never touches the ball.
      gravityScale: 0,
    });
    this.ballId = ctx.getNextId() - 1;
    // --- gerald-multipliers --- gates on: the run plays with multipliers from the start (HUD, adaptive sub-steps)
    if (level.gates.length > 0) ctx.getMultipliers?.()?.markTouched();
  }

  onPreUpdate(ctx: ModeContext) {
    this.soundsThisStep = 0;
    this.started = true;
    const v = this.view;
    v.timeMs = ctx.getElapsedMs();
    const level = v.level;
    if (!level) return;
    // Sliding panes follow their sine on the simulation clock.
    const t = v.timeMs / 1000;
    for (const pane of level.panes) {
      if (pane.kind !== "moving" || pane.shattered) continue;
      pane.x = pane.baseX + pane.moveAmp * Math.sin((2 * Math.PI * t) / pane.movePeriod + pane.movePhase);
      updatePaneSegments(pane);
    }
  }

  onBallStep(ctx: ModeContext, ball: Ball, dtSec: number) {
    const v = this.view;
    const level = v.level;
    if (!level || ball.id !== this.ballId) return;
    const home = level.home;
    if (v.homeReached) {
      // Gerald stands in his doorway.
      ball.vx = 0;
      ball.vy = 0;
      ball.x = home.doorX;
      ball.y = home.groundY - ball.radius - 0.5;
      return;
    }
    // --- gerald-multipliers --- a speed multiplier k runs the whole flight k× faster: the same hops under k² the gravity
    const k = glassTempo(ball);
    const g = glassGravity(ctx.config.gravity, level.field.height) * k * k;
    ball.vy += g * dtSec;
    if (this.landedHome) {
      // On the ground: roll to the door.
      const dx = home.doorX - ball.x;
      const walk = WALK_SPEED * level.field.height * k;
      ball.vx = Math.abs(dx) < walk * dtSec ? dx / dtSec : Math.sign(dx) * walk;
      if (Math.abs(dx) < 0.22 * home.doorWidth && ball.y + ball.radius > home.groundY - 0.5 * home.doorHeight) this.reachHome(ctx, ball);
      return;
    }
    const reachY = ball.radius + Math.abs(ball.vy) * dtSec + 2;
    for (const pane of level.panes) {
      if (pane.shattered || Math.abs(ball.y - pane.y) > pane.thickness / 2 + reachY) continue;
      for (const seg of pane.segments) {
        // --- bounce-math --- a knock from below rebounds with the ball's bounciness on top of the pane's (capped) restitution;
        // a landing's hop takes it in hitPane() (a landing sets the hop afresh, so nothing compounds)
        const impact = resolveBallSegment(ball, seg, dtSec, 1, undefined, ball.restitution ?? 1);
        if (impact < 0) continue;
        // A knock from below needs HIT_SPEED to count. A contact from above is always a landing, however slow – a graze
        // on the end of a hole's glass, a sliding pane lifting the ball onto its top – so the ball never comes to rest on
        // unbroken glass (the capsule maths alone would only damp its bounce there, and the run would never end).
        if (impact >= HIT_SPEED || ball.y < pane.y) this.hitPane(ctx, ball, pane, Math.max(impact, HIT_SPEED), g);
        break;
      }
    }
  }

  /** A landing on (or a knock from below against) a pane: a crack and a note, or the shatter on its last hit point. */
  private hitPane(ctx: ModeContext, ball: Ball, pane: GlassPane, impact: number, g: number) {
    const v = this.view;
    const level = v.level!;
    const fromAbove = ball.y < pane.y;
    ctx.noteBounce?.(ball); // --- bounce-math --- a pane hit is a bounce
    pane.hp = Math.max(0, pane.hp - hitDamage(ball)); // --- gerald-multipliers --- a damage multiplier takes more off
    pane.hits++;
    pane.lastHitMs = v.timeMs;
    v.hits++;
    const impactX = ball.x - pane.x;
    pane.cracks.push(makeCrack(pane, impactX, fromAbove, paneDamage(pane), v.timeMs, () => ctx.random()));
    if (pane.cracks.length > MAX_PANE_CRACKS) pane.cracks.shift(); // --- unlimited --- (glass of a billion hit points keeps its newest cracks; visual only)
    ctx.addWallHit(0, (pane.index * 0.9) % (2 * Math.PI), 0);
    const viewH = level.field.height;
    if (pane.hp <= 0) {
      pane.shattered = true;
      pane.shatteredAtMs = v.timeMs;
      if (!pane.cleared) {
        pane.cleared = true;
        v.cleared++;
      }
      v.shattered++;
      this.spawnShards(ctx, pane, impactX, ball.vy);
      // Crash through: the glass takes some of the speed, the ball carries on the way it was going.
      ball.vy = (fromAbove ? 1 : -1) * impact * SHATTER_KEEP;
      this.queueSound(ctx, { type: "hit", wallIndex: 0, frequency: pane.pitch, accent: true }, true);
      this.queueSound(ctx, { type: "gap", wallIndex: 0 }, true);
      return;
    }
    if (fromAbove) {
      // A landing: the ball hops back up to the stage's hop height with a small sideways kick.
      const stage = level.stages[pane.stage];
      ball.vy = -hopSpeed(g, stage.bounceHeight) * (ball.restitution ?? 1); // --- bounce-math --- the ball's bounciness: a 2 hops twice as fast, four times as high
      const speedScale = (ctx.config.ballSpeed || 400) / 400;
      const k = glassTempo(ball); // --- gerald-multipliers --- the sideways drift speeds up with the hop
      const drift = DRIFT * viewH * speedScale * k;
      const cap = MAX_DRIFT * viewH * Math.max(0.5, speedScale) * k;
      ball.vx = Math.max(-cap, Math.min(cap, 0.5 * ball.vx + (2 * ctx.random() - 1) * drift));
    }
    this.queueSound(ctx, { type: "hit", wallIndex: 0, frequency: pane.pitch }, false);
  }

  private queueSound(ctx: ModeContext, event: SoundEvent, always: boolean) {
    if (!always && this.soundsThisStep >= MAX_GLASS_SOUNDS_PER_STEP) return;
    this.soundsThisStep++;
    ctx.addPendingSoundEvent(event);
  }

  /** Throws the shards of a shattered pane: 8–20 of them from around the impact, with the ball's momentum and a spin. */
  private spawnShards(ctx: ModeContext, pane: GlassPane, impactX: number, ballVy: number) {
    const v = this.view;
    const level = v.level!;
    const viewH = level.field.height;
    const [lo, hi] = solidSpan(pane, impactX);
    const n = shardCount((2 * pane.halfWidth) / level.field.width, pane.maxHp, ctx.random());
    for (let i = 0; i < n; i++) {
      let slot: number;
      if (v.shardCount < MAX_SHARDS) slot = v.shardCount++;
      else {
        // The pool is full: replace the shard closest to the end of its life.
        slot = 0;
        for (let k = 1; k < MAX_SHARDS; k++) if (v.shardLife[k] < v.shardLife[slot]) slot = k;
      }
      const spread = (ctx.random() - 0.5) * 1.8 * (hi - lo);
      const rx = Math.max(lo, Math.min(hi, impactX + 0.5 * spread));
      v.shardX[slot] = pane.x + rx;
      v.shardY[slot] = pane.y + (ctx.random() - 0.5) * pane.thickness;
      v.shardVx[slot] = (rx - impactX) * 1.4 + (ctx.random() - 0.5) * 0.5 * viewH;
      v.shardVy[slot] = 0.35 * ballVy + (ctx.random() - 0.65) * 0.7 * viewH;
      v.shardRot[slot] = ctx.random() * 2 * Math.PI;
      v.shardSpin[slot] = (ctx.random() - 0.5) * 16;
      v.shardSize[slot] = pane.thickness * (0.7 + 1.5 * ctx.random());
      const life = 1.1 + 0.6 * ctx.random();
      v.shardLife[slot] = life;
      v.shardMaxLife[slot] = life;
      v.shardHue[slot] = pane.hue;
      const o = 8 * slot;
      for (let c = 0; c < 4; c++) {
        const a = (c * Math.PI) / 2 + (ctx.random() - 0.5) * 1.1;
        const rad = 0.45 + 0.55 * ctx.random();
        v.shardShape[o + 2 * c] = Math.cos(a) * rad;
        v.shardShape[o + 2 * c + 1] = Math.sin(a) * rad * 0.7;
      }
    }
  }

  /** The ball rolled into the doorway: the HOME chord, confetti and the celebration clock. */
  private reachHome(ctx: ModeContext, ball: Ball) {
    const v = this.view;
    const home = v.level!.home;
    v.homeReached = true;
    v.homeAtMs = v.timeMs;
    ball.vx = 0;
    ball.vy = 0;
    ball.x = home.doorX;
    ball.y = home.groundY - ball.radius - 0.5;
    this.queueSound(ctx, { type: "hit", wallIndex: 0, frequency: HOME_CHORD[0], chord: [...HOME_CHORD], accent: true }, true);
  }

  onPostSubStep(ctx: ModeContext) {
    const v = this.view;
    const level = v.level;
    if (!level) return;
    const ball = this.findBall(ctx);
    if (!ball) return;
    const f = level.field;
    // Safety net behind the obstacle walls: the ball never leaves the shaft or sinks into the ground.
    if (ball.x < f.left + ball.radius) {
      ball.x = f.left + ball.radius;
      if (ball.vx < 0) ball.vx = -ball.vx * WALL_RESTITUTION;
    } else if (ball.x > f.right - ball.radius) {
      ball.x = f.right - ball.radius;
      if (ball.vx > 0) ball.vx = -ball.vx * WALL_RESTITUTION;
    }
    const groundY = level.home.groundY;
    if (ball.y > groundY - ball.radius) {
      ball.y = groundY - ball.radius;
      if (ball.vy > 0) ball.vy = -ball.vy * GROUND_RESTITUTION;
    }
    if (!this.landedHome && ball.y > level.home.top && ball.y + ball.radius >= groundY - 1) this.landedHome = true;
    // Panes the ball has got below (through a hole, past a sliding pane, or through the shards) are cleared.
    const panes = level.panes;
    while (this.passCursor < panes.length) {
      const pane = panes[this.passCursor];
      if (!pane.shattered && ball.y - ball.radius <= pane.y + pane.thickness / 2) break;
      if (!pane.cleared) {
        pane.cleared = true;
        v.cleared++;
      }
      this.passCursor++;
    }
    // --- gerald-multipliers --- gate rows the ball's centre has fallen through: its x picks the slot (applied at the end of the step)
    const gates = level.gates;
    while (this.gateCursor < gates.length && ball.y >= gates[this.gateCursor].y) {
      const row = gates[this.gateCursor++];
      row.passedSlot = gateSlotAt(row, ball.x);
      row.passedAtMs = v.timeMs;
    }
  }

  /**
   * --- gerald-multipliers --- The ball went through a gate: its stat stacks through the run's multipliers (the cap in
   * effect, the HUD badges) – a size gate only as far as the ball still fits between the panes below – with the
   * rising arpeggio.
   */
  private applyGate(ctx: ModeContext, ball: Ball, row: GlassGateRow) {
    const v = this.view;
    const level = v.level!;
    const slot = row.slots[row.passedSlot];
    let factor = slot.factor;
    if (slot.kind === "size") factor = Math.min(factor, glassMaxBallRadius(level, row.stage) / ball.radius);
    const runtime = ctx.getMultipliers?.();
    runtime?.markTouched();
    row.applied = factor > 1 ? (runtime ? runtime.apply(ball, slot.kind, factor) : applyMultiplier(ball, slot.kind, factor)) : 1;
    v.gatesPassed++;
    if (slot.kind === "size" && row.applied !== 1) {
      // Grown next to a wall: moved clear of it at once (the obstacle walls would only push it out on the next step).
      const f = level.field;
      ball.x = Math.max(f.left + ball.radius, Math.min(f.right - ball.radius, ball.x));
    }
    if (row.applied !== 1 && ball.mult) this.queueSound(ctx, { type: "multiplier", wallIndex: 0, multiplier: ball.mult[slot.kind] }, true);
  }

  onPostUpdate(ctx: ModeContext, dtMs: number) {
    const v = this.view;
    const level = v.level;
    if (!level) return;
    const ball = this.findBall(ctx);
    const dt = dtMs / 1000;
    // --- gerald-multipliers --- the gates gone through during the step take effect now, so the step's sub-step plan covered its speeds
    while (this.gateApplied < this.gateCursor) {
      const row = level.gates[this.gateApplied++];
      if (ball && row.passedSlot >= 0) this.applyGate(ctx, ball, row);
    }
    if (ball) {
      // The stage the ball is in: entering a new one shows its banner.
      const stage = stageAt(level, ball.y);
      if (stage > v.stage) {
        v.stage = stage;
        if (stage < level.stages.length) {
          v.bannerStage = stage;
          v.bannerAtMs = v.timeMs;
        }
      }
      // The camera eases toward the stage (or HOME) and never lets the ball out of the field.
      const target = cameraTarget(level, v.stage, ball.y);
      v.cameraY += (target - v.cameraY) * (1 - Math.exp(-dt / CAMERA_TAU));
      const f = level.field;
      const margin = ball.radius + 4;
      const lo = ball.y - f.bottom + margin; // ball.y − cameraY ≤ f.bottom − margin
      const hi = ball.y - f.top - margin; // ball.y − cameraY ≥ f.top + margin
      if (v.cameraY < lo) v.cameraY = lo;
      if (v.cameraY > hi) v.cameraY = hi;
    }
    // Shards fly under gravity, bounce off the shaft walls and fade.
    if (v.shardCount > 0) {
      const g = glassGravity(ctx.config.gravity, level.field.height);
      const left = level.field.left;
      const right = level.field.right;
      for (let i = v.shardCount - 1; i >= 0; i--) {
        v.shardLife[i] -= dt;
        if (v.shardLife[i] <= 0) {
          this.removeShard(i);
          continue;
        }
        v.shardVy[i] += g * dt;
        v.shardX[i] += v.shardVx[i] * dt;
        v.shardY[i] += v.shardVy[i] * dt;
        v.shardRot[i] += v.shardSpin[i] * dt;
        const edge = 0.5 * v.shardSize[i];
        if (v.shardX[i] < left + edge) {
          v.shardX[i] = left + edge;
          v.shardVx[i] = 0.4 * Math.abs(v.shardVx[i]);
        } else if (v.shardX[i] > right - edge) {
          v.shardX[i] = right - edge;
          v.shardVx[i] = -0.4 * Math.abs(v.shardVx[i]);
        }
      }
    }
    if (v.homeReached) {
      // Three bursts of confetti from the doorway, then the run is over.
      const since = v.timeMs - v.homeAtMs;
      const home = level.home;
      while (this.confettiDone < 3 && since >= this.confettiDone * 400) {
        ctx.spawnConfetti(home.doorX, home.groundY - home.doorHeight * (0.6 + 0.3 * this.confettiDone));
        this.confettiDone++;
      }
      if (since >= CELEBRATION_MS) v.finished = true;
    }
  }

  private removeShard(i: number) {
    const v = this.view;
    const last = --v.shardCount;
    if (i === last) return;
    v.shardX[i] = v.shardX[last];
    v.shardY[i] = v.shardY[last];
    v.shardVx[i] = v.shardVx[last];
    v.shardVy[i] = v.shardVy[last];
    v.shardRot[i] = v.shardRot[last];
    v.shardSpin[i] = v.shardSpin[last];
    v.shardSize[i] = v.shardSize[last];
    v.shardLife[i] = v.shardLife[last];
    v.shardMaxLife[i] = v.shardMaxLife[last];
    v.shardHue[i] = v.shardHue[last];
    v.shardShape.copyWithin(8 * i, 8 * last, 8 * last + 8);
  }

  private findBall(ctx: ModeContext): Ball | null {
    const balls = ctx.getBalls();
    for (const b of balls) if (b.id === this.ballId) return b;
    return balls.length > 0 ? balls[0] : null;
  }

  onObstacleHit(_ctx: ModeContext, _ball: Ball, obstacle: Obstacle): ObstacleHitResult {
    // The shaft walls are silent (the glass makes the music); the ground thuds.
    if (obstacle !== this.ground) return { suppressSound: true };
    if (this.soundsThisStep >= MAX_GLASS_SOUNDS_PER_STEP) return { suppressSound: true };
    this.soundsThisStep++;
    return { frequency: GROUND_NOTE };
  }

  onWallHit() {}
  onGapPass() {
    return true;
  }
  /**
   * A canvas resize before the first step lays the level out afresh for the new size from the same random numbers
   * (exactly what an init at that size gives, so the run is the one Find Simulation measures); later it rescales the
   * whole level – and the ball, the cracks, the shards and the camera – to the new field.
   */
  onConfigChange(ctx: ModeContext, sizeChanged: boolean) {
    if (!sizeChanged || !this.view.level || this.layoutW <= 0 || this.layoutH <= 0) return true;
    if (this.started) this.rescale(ctx);
    else this.relayout(ctx);
    return true;
  }

  private relayout(ctx: ModeContext) {
    const v = this.view;
    const cfg = ctx.config;
    let i = 0;
    const level = buildGlassLevel(cfg.width, cfg.height, v.settings, cfg.ballRadius || 8, () => (i < this.tape.length ? this.tape[i++] : 0.5), this.unlimited);
    v.level = level;
    v.panes = level.panes.length;
    v.cameraY = 0;
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    const { obstacles, ground } = buildGlassObstacles(level);
    this.ground = ground;
    ctx.setObstacles(obstacles);
    const ball = this.findBall(ctx);
    if (ball) {
      ball.x = level.startX;
      ball.y = level.startY;
      ball.vx = level.startVx;
      ball.vy = 0;
      ball.trail.length = 0;
      ball.trailIndex = 0;
    }
  }
  /** There are no rings: the walls and the ground are obstacles, the panes are resolved in onBallStep. */
  shouldSkipWallCollision() {
    return true;
  }
  isFinished() {
    return this.view.finished;
  }
  getState() {
    const v = this.view;
    return { stage: v.stage, hits: v.hits, shattered: v.shattered, cleared: v.cleared, panes: v.panes, homeReached: v.homeReached, finished: v.finished, cameraY: v.cameraY, gates: v.gatesPassed };
  }

  /**
   * Maps the level onto the field of the new canvas size: every world position p → n + (p − o) · k, with o / n the
   * top centre of the old / new field and k the ratio of their heights; lengths scale by k. The engine has already
   * moved the ball around the canvas centre, so that move is undone first.
   */
  private rescale(ctx: ModeContext) {
    const v = this.view;
    const level = v.level!;
    const cfg = ctx.config;
    const oldW = this.layoutW;
    const oldH = this.layoutH;
    const next = buildGlassField(cfg.width, cfg.height);
    const old = level.field;
    const k = next.height / old.height;
    const ox = old.cx;
    const oy = old.top;
    const mx = (x: number) => next.cx + (x - ox) * k;
    const my = (y: number) => next.top + (y - oy) * k;
    for (const ball of ctx.getBalls()) {
      const x = oldW / 2 + (ball.x - cfg.width / 2) * (oldW / cfg.width);
      const y = oldH / 2 + (ball.y - cfg.height / 2) * (oldH / cfg.height);
      ball.x = mx(x);
      ball.y = my(y);
      ball.vx *= k;
      ball.vy *= k;
    }
    for (const st of level.stages) {
      st.top = my(st.top);
      st.bottom = my(st.bottom);
      st.spacing *= k;
      st.bounceHeight *= k;
    }
    for (const pane of level.panes) {
      pane.x = mx(pane.x);
      pane.baseX = mx(pane.baseX);
      pane.y = my(pane.y);
      pane.halfWidth *= k;
      pane.thickness *= k;
      pane.moveAmp *= k;
      pane.holeX *= k;
      pane.holeHalf *= k;
      for (const seg of pane.segments) seg.thickness = pane.thickness;
      for (const crack of pane.cracks) {
        crack.x *= k;
        crack.y *= k;
        crack.length *= k;
        for (let i = 0; i < crack.count; i++) for (let c = 0; c < 5; c++) crack.segs[5 * i + c] *= k;
      }
      updatePaneSegments(pane);
    }
    for (const row of level.gates) {
      row.y = my(row.y);
      for (const slot of row.slots) {
        slot.x0 = mx(slot.x0);
        slot.x1 = mx(slot.x1);
      }
    }
    const home = level.home;
    home.top = my(home.top);
    home.groundY = my(home.groundY);
    home.doorX = mx(home.doorX);
    home.doorWidth *= k;
    home.doorHeight *= k;
    level.worldBottom = my(level.worldBottom);
    level.startX = mx(level.startX);
    level.startY = my(level.startY);
    level.startVx *= k;
    for (let i = 0; i < v.shardCount; i++) {
      v.shardX[i] = mx(v.shardX[i]);
      v.shardY[i] = my(v.shardY[i]);
      v.shardVx[i] *= k;
      v.shardVy[i] *= k;
      v.shardSize[i] *= k;
    }
    // Camera offset: the world moved by (next.top − oy·k …); keep the same part of the level in view.
    v.cameraY = my(v.cameraY + old.top) - next.top;
    level.field = next;
    this.layoutW = cfg.width;
    this.layoutH = cfg.height;
    const { obstacles, ground } = buildGlassObstacles(level);
    this.ground = ground;
    ctx.setObstacles(obstacles);
  }
}
