import { atLeastMin, memoryCeiling } from "@/lib/uncap";
import { degreeToMidi } from "@/lib/audio/loopPitch";
import { midiToFrequency } from "@/lib/audio/scales";

/*
 * --- funnel-spin --- Funnel Spin-up: the Sound Vortex's ring waves and its perspective view (the loop family's "watch the ring
 * of 24 spin up as it drops" clip). lib/physics/modes/vortex.ts runs it; this module holds the pure parts the mode, the
 * renderer, the panel, the finder and the tests share – the physics of a ring, the waves, the timing of a loop, the sounds'
 * pitch and level rules, the perspective projection, and the settings with their URL keys and presets. Nothing here touches
 * the engine.
 *
 * The physics. A ring of n marbles is released on the rim at the entry radius r₀, evenly spaced, every marble with the same
 * radius, radial speed and angular momentum L = r·v_θ – so the whole ring is one polar state, integrated once a sub-step
 * (`stepFunnel()`) and the marble i of n sits at the ring's angle + 2π·i/n: it stays a perfect ring. The motion:
 *
 *   L′ = −k_L·L,   r″ = L²/r³ − C·r^(−p) − k_r·r′,   θ′ = ±L/r²,
 *
 * the spin friction k_L acting on L and the radial drag k_r on r′ separately (the original Sound Vortex had one k for both).
 * Friction is what lets a marble slip lower: k_r = FS_SLIP_RATIO · k_L, so a frictionless ring (k_L = 0) keeps its L to the bit
 * and orbits the rim forever. The funnel's pull C·r^(−p) is shaped to the release (p = 3 − 2·k_L / k_r, C = L₀²·r₀^(p−3)), so a
 * ring released with r′ = −k_r·r₀ rolls the matched spiral exactly:
 *
 *   r(t) = r₀·e^(−k_r·t),   L(t) = L₀·e^(−k_L·t),   ω(t) = L / r² = ω₀·e^((2·k_r − k_L)·t).
 *
 * It reaches the hole r_h after D = ln(r₀ / r_h) / k_r (12.5 s with the defaults: friction 0.02, a hole of 25 % of the rim), its
 * lap rate climbing (r₀ / r_h)^(2 − 1/FS_SLIP_RATIO) times – about 11× with the defaults, from the 5 s first lap (L₀ = 2π·r₀² /
 * first lap) to about 2.3 laps a second at the bottom: the figure-skater's spin-up, angular momentum nearly conserved while
 * friction bleeds the energy.
 *
 * The loop. Waves of N_k marbles (6, 12, 24 by default) are released every `waveInterval` seconds; the last one vanishes
 * (K − 1)·interval + D into the cycle and the refill – the first wave again, at the same angles – comes `refillGap` later:
 * the cycle (`funnelCycleSec()`), quantised to the engine's 60 Hz steps, is the loop contract's seamless period.
 *
 * The perspective view looks at the funnel from `elevation` degrees above (90 = straight down, the top view): the surface of
 * revolution z(r) = −depth · FS_DEPTH_UNIT · R · (R / r − 1) (R the rim; clipped at the hole), projected orthographically and
 * fitted into the square the recorder crops to (`funnelFrame()`, `projectFunnel()`); a marble's depth along the view
 * (`funnelDepthKey()`) orders the drawing, every marble behind the front lip (`lipDepth()`).
 */

/* ------------------------------------------------------------------ options */

/** How the marbles enter: one after another (the Sound Vortex's stagger) or in evenly spaced ring waves. */
export const FS_RELEASES = ["stagger", "rings"] as const;
export type FsRelease = (typeof FS_RELEASES)[number];
/** How the funnel is seen: from straight above (the Sound Vortex) or in perspective. */
export const FS_VIEWS = ["top", "perspective"] as const;
export type FsView = (typeof FS_VIEWS)[number];

export function isFsRelease(value: unknown): value is FsRelease {
  return typeof value === "string" && (FS_RELEASES as readonly string[]).includes(value);
}
export function isFsView(value: unknown): value is FsView {
  return typeof value === "string" && (FS_VIEWS as readonly string[]).includes(value);
}

/* ------------------------------------------------------------------ constants */

/** The entry radius as a share of the rim (the Sound Vortex's ENTRY_AT: the rings are released just inside the rim line). */
export const FS_ENTRY_AT = 0.955;
/** The default hole: 25 % of the rim – the clip's spout, where the lap rate has climbed about 11×. */
export const FS_DEFAULT_HOLE_PCT = 25;
/** The default spin friction and the descent it gives with the default hole (s). */
export const FS_DEFAULT_FRICTION = 0.02;
export const FS_DEFAULT_DESCENT_SEC = 12.5;
/**
 * k_r / k_L: how much harder the friction drags the radial motion than the spin. Chosen so the defaults (friction 0.02, a hole
 * of 25 %) take FS_DEFAULT_DESCENT_SEC from the rim to the hole: ln(0.955 / 0.25) / (0.02 · 12.5) ≈ 5.36.
 */
export const FS_SLIP_RATIO = Math.log(FS_ENTRY_AT / (FS_DEFAULT_HOLE_PCT / 100)) / (FS_DEFAULT_FRICTION * FS_DEFAULT_DESCENT_SEC);
/** The drawn funnel's depth unit: at depth 1 the surface drops 0.2 rim radii per unit of (R / r − 1). */
export const FS_DEPTH_UNIT = 0.2;
/** The integrator turns a ring by at most this many radians a piece (the whirl by the hole stays accurate). */
export const FS_MAX_TURN = 0.08;
/** Wave k is turned by k · FS_WAVE_TWIST of one marble spacing (the golden fraction), so the rings never line up exactly. */
export const FS_WAVE_TWIST = 0.381966;
/** A ring still in flight this many times its descent after its release is swallowed (a safety net). */
export const FS_MAX_FLIGHT_FACTOR = 4;
/** The memory-safety ceiling of the marbles of a run: the engine's ball ceiling of the Sound Vortex (`MEMORY_CEILINGS.vxBalls`). */
export const FS_BALL_CEILING_KEY = "vxBalls";

/* ------------------------------------------------------------------ the ring physics */

/** The radial drag k_r (1/s) of a spin friction k_L: FS_SLIP_RATIO · k_L (0 without friction). */
export function slipRate(spinFriction: number): number {
  return Number.isFinite(spinFriction) && spinFriction > 0 ? FS_SLIP_RATIO * spinFriction : 0;
}

/** Seconds a ring takes from `entry` to `hole` with spin friction `kL`: ln(entry / hole) / k_r (Infinity without friction, 0 for a hole at the entry). */
export function funnelDescentSec(entry: number, hole: number, kL: number): number {
  if (!(entry > hole)) return 0;
  const kr = slipRate(kL);
  return kr > 0 ? Math.log(entry / hole) / kr : Infinity;
}

/** The angular momentum per unit mass (px²/s) of a ring released at `entry` whose first lap takes `firstLapSec`: 2π·entry² / lap. */
export function releaseSpin(entry: number, firstLapSec: number): number {
  return (2 * Math.PI * entry * entry) / Math.max(1e-6, firstLapSec);
}

/** The pull's exponent p = 3 − 2·k_L / k_r (2.63: the ratio is FS_SLIP_RATIO whatever the friction). */
export function pullExponent(): number {
  return 3 - 2 / FS_SLIP_RATIO;
}

/** The pull's strength C of the matched spiral: C·r₀^(−p) = L₀² / r₀³ (the release is on its circular balance). */
export function pullStrength(L0: number, entry: number, p: number = pullExponent()): number {
  return L0 * L0 * Math.pow(entry, p - 3);
}

/** The polar state of a ring (per unit mass): radius, radial speed, the angle turned since the release (≥ 0) and L. */
export interface FunnelState {
  r: number;
  vr: number;
  turn: number;
  L: number;
}

/**
 * Advances a ring by `dt` seconds: semi-implicit Euler in pieces of at most `maxTurn` radians (the radial speed first, then
 * the radius, the exact decay of L by the spin friction, then the turn). In place; `turn` grows by L·h / r² a piece (the
 * direction is the caller's: the angle is θ₀ + dir · turn). With `kL` = 0 the angular momentum is kept exactly.
 */
export function stepFunnel(s: FunnelState, dt: number, C: number, p: number, kr: number, kL: number, maxTurn = FS_MAX_TURN): void {
  if (!(dt > 0)) return;
  const omega = s.L / (s.r * s.r);
  const n = Math.max(1, Math.min(256, Math.ceil((omega * dt) / maxTurn)));
  const h = dt / n;
  const decay = kL > 0 ? Math.exp(-kL * h) : 1;
  const floor = 1e-3;
  for (let i = 0; i < n; i++) {
    const r = s.r;
    s.vr += ((s.L * s.L) / (r * r * r) - C * Math.pow(r, -p) - kr * s.vr) * h;
    s.r = Math.max(floor, r + s.vr * h);
    if (decay !== 1) s.L *= decay;
    s.turn += (s.L * h) / (s.r * s.r);
  }
}

/** The lap rate ω = L / r² (rad/s) and the lap's length 2π / ω (s). */
export function lapRate(L: number, r: number): number {
  return r > 0 ? L / (r * r) : 0;
}
export function lapSeconds(L: number, r: number): number {
  const w = lapRate(L, r);
  return w > 0 ? (2 * Math.PI) / w : Infinity;
}

/** How many times faster a ring laps at the hole than at its release (the matched spiral): (entry / hole)^(2 − 1/FS_SLIP_RATIO); 1 without friction. */
export function funnelLapGain(entry: number, hole: number, kL: number): number {
  if (!(entry > hole) || !(slipRate(kL) > 0)) return 1;
  return Math.pow(entry / hole, 2 - 1 / FS_SLIP_RATIO);
}

/* ------------------------------------------------------------------ the waves */

/** The waves of the clip: a ring of 6, then 12, then 24. */
export const FS_DEFAULT_WAVES = "6, 12, 24";

/** The ring sizes of a waves text ("6, 12, 24"): whole numbers from 1 up, anything else dropped; an empty list is the default. */
export function parseWaves(text: unknown): number[] {
  const out: number[] = [];
  const raw = typeof text === "string" ? text : Array.isArray(text) ? text.join(",") : "";
  for (const token of raw.split(/[\s,;]+/)) {
    if (!token) continue;
    const n = Number(token);
    if (!Number.isFinite(n)) continue;
    out.push(Math.round(atLeastMin(n, { min: 1 })));
  }
  return out.length > 0 ? out : FS_DEFAULT_WAVES.split(", ").map(Number);
}

/** The waves as the panel and the URL write them: "6, 12, 24". */
export function formatWaves(waves: readonly number[]): string {
  return waves.join(", ");
}

/** `count` waves doubling from `first`: 1, 2, 4 … (whole numbers from 1 up). */
export function doublingWaves(first: number, count: number): number[] {
  const out: number[] = [];
  let n = Math.max(1, Math.round(Number.isFinite(first) ? first : 1));
  for (let i = 0; i < Math.max(1, Math.round(Number.isFinite(count) ? count : 1)); i++) {
    out.push(n);
    n *= 2;
  }
  return out;
}

/** The waves a run builds: the typed ones, cut where their sum would pass `ceiling` marbles (the last wave that fits shrinks to fit). */
export function wavesForRun(waves: readonly number[], ceiling: number = memoryCeiling(FS_BALL_CEILING_KEY, Number.MAX_SAFE_INTEGER)): number[] {
  const out: number[] = [];
  let total = 0;
  for (const n of waves) {
    if (total >= ceiling) break;
    const take = Math.min(n, ceiling - total);
    if (take < 1) break;
    out.push(take);
    total += take;
  }
  return out.length > 0 ? out : [1];
}

/** The sum of the waves (the marbles of one cycle). */
export function wavesTotal(waves: readonly number[]): number {
  let total = 0;
  for (const n of waves) total += n;
  return total;
}

/* ------------------------------------------------------------------ the loop */

/** When (s into the cycle) the last ring vanishes: (K − 1)·interval + descent. */
export function lastVanishSec(waveCount: number, interval: number, descentSec: number): number {
  return Math.max(0, waveCount - 1) * Math.max(0, interval) + descentSec;
}

/** The cycle (s): the last ring vanishes, the funnel stays empty `refillGap` seconds, the first wave comes back (Infinity without friction). */
export function funnelCycleSec(waveCount: number, interval: number, descentSec: number, refillGap: number): number {
  return lastVanishSec(waveCount, interval, descentSec) + Math.max(0, refillGap);
}

/** `sec` rounded up to whole steps of `stepSec` (the seam comes at the end of the first step that reaches the cycle). */
export function quantizeToSteps(sec: number, stepSec: number): number {
  if (!Number.isFinite(sec) || !(stepSec > 0)) return sec;
  return Math.max(1, Math.ceil(sec / stepSec - 1e-9)) * stepSec;
}

/** `sec` rounded up to whole steps of `stepSec` (0 stays 0): when a wave due at `sec` is released (at the first step start at or after it). */
export function ceilSteps(sec: number, stepSec: number): number {
  if (!(sec > 0) || !(stepSec > 0)) return 0;
  return Math.ceil(sec / stepSec - 1e-9) * stepSec;
}

/** Steps a run integrates at most to find a descent (beyond it the ring is taken as never arriving: Infinity). */
export const FS_DESCENT_STEP_CAP = 200_000;

/**
 * The whole steps of `stepSec` a ring takes from the entry to the hole, integrated exactly as a run integrates it (rim units:
 * the entry FS_ENTRY_AT, the hole `holePct` % of the rim): the step at whose end it is swallowed. Infinity without friction (or
 * past FS_DESCENT_STEP_CAP steps); 0 for a hole at the entry or wider.
 */
export function funnelDescentSteps(holePct: number, spinFriction: number, firstLapSec: number, stepSec: number): number {
  const entry = FS_ENTRY_AT;
  const hole = Math.max(1e-4, holePct / 100);
  if (!(entry > hole)) return 0;
  const kL = Math.max(0, Number.isFinite(spinFriction) ? spinFriction : 0);
  const kr = slipRate(kL);
  if (!(kr > 0) || !(stepSec > 0)) return Infinity;
  const L0 = releaseSpin(entry, firstLapSec);
  const p = pullExponent();
  const C = pullStrength(L0, entry, p);
  const s: FunnelState = { r: entry, vr: -kr * entry, turn: 0, L: L0 };
  for (let i = 1; i <= FS_DESCENT_STEP_CAP; i++) {
    stepFunnel(s, stepSec, C, p, kr, kL);
    if (s.r <= hole) return i;
  }
  return Infinity;
}

/** The ring run's timing on the step grid (s): the last release, the descent, the last vanish and the cycle (whole steps; Infinity without friction). */
export function funnelStepTiming(waveCount: number, interval: number, holePct: number, spinFriction: number, firstLapSec: number, refillGap: number, stepSec: number): { lastReleaseSec: number; descentSec: number; vanishSec: number; cycleSec: number } {
  const lastReleaseSec = ceilSteps(Math.max(0, waveCount - 1) * Math.max(0, interval), stepSec);
  const descentSec = funnelDescentSteps(holePct, spinFriction, firstLapSec, stepSec) * stepSec;
  const vanishSec = lastReleaseSec + descentSec;
  const cycle = vanishSec + ceilSteps(Math.max(0, refillGap), stepSec);
  return { lastReleaseSec, descentSec, vanishSec, cycleSec: cycle > 0 ? cycle : stepSec };
}

/* ------------------------------------------------------------------ sound */

/** The lap chimes' ladder: C major pentatonic from C5 (the clip's A-minor colour, centred on A5), 8 degrees (C5 … E6). */
export const FS_CHIME_ROOT_MIDI = 72;
export const FS_CHIME_DEGREES = 8;
/** The groove bed's key (C3) and how its sounds sit in the mix. */
export const FS_BED_ROOT_MIDI = 48;
export const FS_CHIME_LEVEL = 0.8;
export const FS_KICK_LEVEL = 0.55;
export const FS_WASH_LEVEL = 0.9;
/** The wash plays this long before every refill and lasts as long (it ends on the seam). */
export const FS_WASH_LEAD_SEC = 1;
/** The rolling hiss is updated every this many steps (15 Hz). */
export const FS_HISS_EVERY_STEPS = 4;
/** The hiss' reference: this many marbles at the first lap's speed make it a third of its full level. */
export const FS_HISS_REF_BALLS = 24;

/** The chime degree of a ring lapping at `omega`: floor(speedNorm · 8), the speed normalised logarithmically from the first lap's to the hole's. */
export function chimeDegree(omega: number, omega0: number, omegaEnd: number): number {
  if (!(omega > 0) || !(omega0 > 0) || !(omegaEnd > omega0)) return 0;
  const norm = Math.log(omega / omega0) / Math.log(omegaEnd / omega0);
  const d = Math.floor((norm < 0 ? 0 : norm > 1 ? 1 : norm) * FS_CHIME_DEGREES);
  return d >= FS_CHIME_DEGREES ? FS_CHIME_DEGREES - 1 : d;
}

/** The pitch (Hz) of chime degree `degree` (0 = C5 … 7 = E6). */
export function chimeHz(degree: number): number {
  const d = Math.max(0, Math.min(FS_CHIME_DEGREES - 1, Math.round(degree)));
  return midiToFrequency(degreeToMidi(d, FS_CHIME_ROOT_MIDI, "majorPentatonic"));
}

/** The rolling hiss' level (0–1) for the marbles' total speed against `refSpeed` (FS_HISS_REF_BALLS at the first lap's speed): S / (S + 2·ref). */
export function hissLevel(totalSpeed: number, refSpeed: number): number {
  if (!(totalSpeed > 0) || !(refSpeed > 0)) return 0;
  return totalSpeed / (totalSpeed + 2 * refSpeed);
}

/** The bar (0, 1, 2 …) and the beat within the cycle at `sec` of a bed at `bpm` (4 beats a bar). */
export function bedBeat(sec: number, bpm: number): number {
  const beat = 60 / (bpm > 0 ? bpm : 120);
  return Math.floor(sec / beat + 1e-9);
}

/* ------------------------------------------------------------------ colours */

/** The hue (degrees) of marble `i` of a ring of `n`: the rainbow around the ring. */
export function marbleHue(i: number, n: number): number {
  return n > 0 ? ((360 * i) / n) % 360 : 0;
}

/** A marble's colour from its hue (bright, saturated). */
export function marbleColor(hue: number): string {
  return `hsl(${Math.round(hue)}, 90%, 60%)`;
}

/* ------------------------------------------------------------------ the perspective view */

/** Where the page draws the funnel in perspective (px): the rim, the hole, the view's sines, the fit and the drawn depth. */
export interface FunnelFrame {
  cx: number;
  /** The rim's centre on the screen after the fit (the picture centred in the square). */
  cy0: number;
  /** The fit (≤ 1): a deep well is shrunk into the square the recorder crops to. */
  scale: number;
  sinE: number;
  cosE: number;
  /** The rim and the hole (world px, before the fit). */
  rim: number;
  hole: number;
  /** The drawn depth: the surface drops depth · FS_DEPTH_UNIT · rim px per unit of (rim / r − 1). */
  depth: number;
}

export function createFunnelFrame(): FunnelFrame {
  return { cx: 0, cy0: 0, scale: 1, sinE: 1, cosE: 0, rim: 0, hole: 0, depth: 0 };
}

/** The surface's height (world px, ≤ 0) at radius `r`: −depth · FS_DEPTH_UNIT · rim · (rim / r − 1), clipped at the hole. */
export function funnelZ(frame: Pick<FunnelFrame, "rim" | "hole" | "depth">, r: number): number {
  const rr = r > frame.hole ? r : frame.hole > 0 ? frame.hole : 1e-6;
  return -frame.depth * FS_DEPTH_UNIT * frame.rim * (frame.rim / rr - 1);
}

/**
 * Lays the perspective out for a funnel at (cx, cy) with rim `rim` and hole `hole` (px), seen from `elevationDeg` above, drawn
 * `depth` deep: the rim's ellipse and the hole's (lowered by the surface) are fitted into the rim's square (2·rim tall) and the
 * picture centred on `cy` (into `out`: no allocation). 90° is the top view exactly (no fit, no shift).
 */
export function funnelFrame(cx: number, cy: number, rim: number, hole: number, elevationDeg: number, depth: number, out: FunnelFrame = createFunnelFrame()): FunnelFrame {
  const e = ((Number.isFinite(elevationDeg) ? elevationDeg : 90) * Math.PI) / 180;
  out.sinE = Math.abs(Math.sin(e)) < 1e-12 ? 0 : Math.sin(e);
  out.cosE = Math.abs(Math.cos(e)) < 1e-12 ? 0 : Math.cos(e);
  out.rim = rim;
  out.hole = hole;
  out.depth = Number.isFinite(depth) ? Math.max(0, depth) : 0;
  out.cx = cx;
  const s = Math.abs(out.sinE);
  const zh = funnelZ(out, hole);
  const top = Math.min(-rim * s, -zh * out.cosE - hole * s);
  const bottom = Math.max(rim * s, -zh * out.cosE + hole * s);
  const height = bottom - top;
  out.scale = height > 2 * rim && height > 0 ? (2 * rim) / height : 1;
  out.cy0 = cy - out.scale * 0.5 * (top + bottom);
  return out;
}

/** Projects the surface point at radius `r`, angle `theta` into screen px (into `out`). */
export function projectFunnel(frame: FunnelFrame, r: number, theta: number, out: { x: number; y: number }): { x: number; y: number } {
  const z = funnelZ(frame, r);
  out.x = frame.cx + frame.scale * r * Math.cos(theta);
  out.y = frame.cy0 + frame.scale * (r * Math.sin(theta) * frame.sinE - z * frame.cosE);
  return out;
}

/** A surface point's depth along the view (px; larger = farther from the camera): −r·sin θ·cos e − z·sin e. */
export function funnelDepthKey(frame: FunnelFrame, r: number, theta: number): number {
  return -r * Math.sin(theta) * frame.cosE - funnelZ(frame, r) * frame.sinE;
}

/** The depth of the front lip's nearest point (the rim at θ = 90°, the bottom of the rim's ellipse): every marble lies behind it. */
export function lipDepth(frame: FunnelFrame): number {
  return -frame.rim * frame.cosE;
}

/**
 * The drawing order of `count` marbles by their depth keys: farthest first (the back of the funnel, then the front, the front
 * lip last of all). Writes the indices into `order` (sorted in place; no allocation besides the engine's sort).
 */
export function funnelDrawOrder(keys: Float64Array, count: number, order: Int32Array): number {
  const n = Math.min(count, keys.length, order.length);
  for (let i = 0; i < n; i++) order[i] = i;
  order.subarray(0, n).sort((a, b) => keys[b] - keys[a] || a - b);
  return n;
}

/* ------------------------------------------------------------------ settings */

/** The feature's fields of the SimulatorSettings object (in the Vortex block of the Mode row). */
export interface FunnelSpinFields {
  /** stagger | rings (URL `vxrl`). */
  vxRelease: FsRelease;
  /** top | perspective (URL `vxv`). */
  vxView: FsView;
  /** The ring waves, "6, 12, 24" (each from 1 up; a run builds at most the engine's ball ceiling in all) (URL `vxw`). */
  vxWaves: string;
  /** Seconds between two waves, 0–120 on the slider (URL `vxwi`). */
  vxWaveInterval: number;
  /** The drawn funnel's depth, 0–5 on the slider (URL `vxfd`). */
  vxFunnelDepth: number;
  /** The camera's elevation (°), 0–90 on the slider – 90 is the top view (URL `vxe`). */
  vxElevation: number;
  /** The spin friction k_L (1/s), 0–1 on the slider (URL `vxsf`). */
  vxSpinFriction: number;
  /** Seconds the first lap takes, 0.1–120 on the slider (URL `vxfl`). */
  vxFirstLap: number;
  /** The hole of the ring release (% of the rim), 1–50 on the slider (URL `vxh`). */
  vxHoleSize: number;
  /** Seconds the funnel stays empty before the refill, 0–30 on the slider (URL `vxrg`). */
  vxRefillGap: number;
  /** The loop HUD's "lap 1.23 s" of the newest ring (URL `vxlr`). */
  vxLapReadout: boolean;
}

export const DEFAULT_FUNNEL_SPIN_FIELDS: Readonly<FunnelSpinFields> = {
  vxRelease: "stagger",
  vxView: "top",
  vxWaves: FS_DEFAULT_WAVES,
  vxWaveInterval: 4.5,
  vxFunnelDepth: 1,
  vxElevation: 25,
  vxSpinFriction: FS_DEFAULT_FRICTION,
  vxFirstLap: 5,
  vxHoleSize: FS_DEFAULT_HOLE_PCT,
  vxRefillGap: 1,
  vxLapReadout: false,
};

/** Slider (comfort) ranges, keyed by the SimulatorSettings field names so settings.ts can spread them into `RANGES`. */
export const FUNNEL_SPIN_RANGES = {
  vxWaveInterval: { min: 0, max: 120, step: 0.1 },
  vxFunnelDepth: { min: 0, max: 5, step: 0.05 },
  vxElevation: { min: 0, max: 90, step: 0.5 },
  vxSpinFriction: { min: 0, max: 1, step: 0.001 },
  vxFirstLap: { min: 0.1, max: 120, step: 0.1 },
  vxHoleSize: { min: 1, max: 50, step: 0.5 },
  vxRefillGap: { min: 0, max: 30, step: 0.1 },
} as const;

type NumberKey = keyof typeof FUNNEL_SPIN_RANGES;
/** The numbers the engine reads (the timing of a ring run); the camera elevation and the drawn depth are the picture's. */
export const FUNNEL_SPIN_ENGINE_KEYS: readonly NumberKey[] = ["vxWaveInterval", "vxSpinFriction", "vxFirstLap", "vxHoleSize", "vxRefillGap"];
/** The fields a change of which restarts a run (the view, the elevation, the depth and the lap readout follow live). */
export const FUNNEL_SPIN_RESTART_FIELDS: readonly (keyof FunnelSpinFields)[] = ["vxRelease", "vxWaves", "vxWaveInterval", "vxSpinFriction", "vxFirstLap", "vxHoleSize", "vxRefillGap"];

export function defaultFunnelSpinFields(): FunnelSpinFields {
  return { ...DEFAULT_FUNNEL_SPIN_FIELDS };
}

/** A number of `key` from anything: finite and from the slider's minimum up (--- uncap-all --- never a maximum). */
function numberOf(key: NumberKey, value: unknown): number {
  const fallback = DEFAULT_FUNNEL_SPIN_FIELDS[key];
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? atLeastMin(n, FUNNEL_SPIN_RANGES[key]) : fallback;
}

/** Validates the feature's fields (URL parameters, presets and project files alike): the waves normalised ("6, 12, 24"). */
export function resolveFunnelSpinFields(source: Partial<Record<keyof FunnelSpinFields, unknown>> | null | undefined): FunnelSpinFields {
  const s = source ?? {};
  const d = DEFAULT_FUNNEL_SPIN_FIELDS;
  return {
    vxRelease: isFsRelease(s.vxRelease) ? s.vxRelease : d.vxRelease,
    vxView: isFsView(s.vxView) ? s.vxView : d.vxView,
    vxWaves: formatWaves(parseWaves(s.vxWaves ?? d.vxWaves)),
    vxWaveInterval: numberOf("vxWaveInterval", s.vxWaveInterval),
    vxFunnelDepth: numberOf("vxFunnelDepth", s.vxFunnelDepth),
    vxElevation: numberOf("vxElevation", s.vxElevation),
    vxSpinFriction: numberOf("vxSpinFriction", s.vxSpinFriction),
    vxFirstLap: numberOf("vxFirstLap", s.vxFirstLap),
    vxHoleSize: numberOf("vxHoleSize", s.vxHoleSize),
    vxRefillGap: numberOf("vxRefillGap", s.vxRefillGap),
    vxLapReadout: typeof s.vxLapReadout === "boolean" ? s.vxLapReadout : d.vxLapReadout,
  };
}

/** What the engine runs of the fields (merged into the Sound Vortex's settings by `vortexSettingsOf()`). */
export interface FunnelSpinSettings {
  release: FsRelease;
  view: FsView;
  /** The ring sizes as typed (from 1 up; the run cuts them at the ball ceiling: `wavesForRun()`). */
  waves: number[];
  waveInterval: number;
  funnelDepth: number;
  elevation: number;
  spinFriction: number;
  firstLap: number;
  holeSize: number;
  refillGap: number;
  lapReadout: boolean;
}

export function funnelSpinSettingsOf(s: FunnelSpinFields): FunnelSpinSettings {
  return {
    release: s.vxRelease,
    view: s.vxView,
    waves: parseWaves(s.vxWaves),
    waveInterval: s.vxWaveInterval,
    funnelDepth: s.vxFunnelDepth,
    elevation: s.vxElevation,
    spinFriction: s.vxSpinFriction,
    firstLap: s.vxFirstLap,
    holeSize: s.vxHoleSize,
    refillGap: s.vxRefillGap,
    lapReadout: s.vxLapReadout,
  };
}

export function funnelSpinSettingFields(s: FunnelSpinSettings): FunnelSpinFields {
  return {
    vxRelease: s.release,
    vxView: s.view,
    vxWaves: formatWaves(s.waves),
    vxWaveInterval: s.waveInterval,
    vxFunnelDepth: s.funnelDepth,
    vxElevation: s.elevation,
    vxSpinFriction: s.spinFriction,
    vxFirstLap: s.firstLap,
    vxHoleSize: s.holeSize,
    vxRefillGap: s.refillGap,
    vxLapReadout: s.lapReadout,
  };
}

export const DEFAULT_FUNNEL_SPIN_SETTINGS: Readonly<FunnelSpinSettings> = funnelSpinSettingsOf(DEFAULT_FUNNEL_SPIN_FIELDS);

/** The engine's settings, every value valid (the defaults for anything missing or broken). */
export function resolveFunnelSpinSettings(patch: Partial<FunnelSpinSettings> | null | undefined): FunnelSpinSettings {
  const base = { ...DEFAULT_FUNNEL_SPIN_SETTINGS, waves: [...DEFAULT_FUNNEL_SPIN_SETTINGS.waves], ...(patch ?? {}) };
  return funnelSpinSettingsOf(resolveFunnelSpinFields(funnelSpinSettingFields({ ...base, waves: Array.isArray(base.waves) ? base.waves : parseWaves(base.waves) })));
}

/* ------------------------------------------------------------------ presets */

export const FS_PRESET_IDS = ["ring24", "galaxy", "coin", "doubling"] as const;
export type FsPresetId = (typeof FS_PRESET_IDS)[number];

/** Translation keys (Vortex namespace) of the presets' names. */
export const FS_PRESET_LABELS: Readonly<Record<FsPresetId, string>> = {
  ring24: "vxPresetRing24",
  galaxy: "vxPresetGalaxy",
  coin: "vxPresetCoin",
  doubling: "vxPresetDoubling",
};

export function isFsPresetId(value: unknown): value is FsPresetId {
  return typeof value === "string" && (FS_PRESET_IDS as readonly string[]).includes(value);
}

/** The clip's look: the dark navy page and the loop HUD (its title and two-line subtitle). */
export const FUNNEL_SPIN_LOOK = {
  backgroundType: "solid" as const,
  backgroundColors: ["#060914", "#060914"] as [string, string],
  loopHud: true,
};

/** What a preset sets: the feature's fields, the loop on, the page's look. */
export type FunnelSpinPresetPatch = FunnelSpinFields & { vxLoop: boolean } & typeof FUNNEL_SPIN_LOOK;

/**
 * A preset: Ring of 24 (the clip: 6, 12, 24 every 4.5 s in perspective at 25°, a 22.5 s loop), Galaxy (one ring of 360 seen
 * from above), Coin funnel (one marble, about 60 s down a funnel with a small hole – the spiral wishing well) and Doubling
 * (1, 2, 4 … 256, with the lap readout). Each turns the loop on and sets the clip's look.
 */
export function funnelSpinPresetPatch(id: FsPresetId): FunnelSpinPresetPatch {
  const look = { ...FUNNEL_SPIN_LOOK, backgroundColors: [...FUNNEL_SPIN_LOOK.backgroundColors] as [string, string] };
  const base: FunnelSpinFields = { ...defaultFunnelSpinFields(), vxRelease: "rings", vxView: "perspective" };
  if (id === "galaxy") return { ...base, vxView: "top", vxWaves: "360", vxLoop: true, ...look };
  if (id === "coin") return { ...base, vxWaves: "1", vxHoleSize: 10, vxSpinFriction: 0.007, vxLoop: true, ...look };
  if (id === "doubling") return { ...base, vxWaves: formatWaves(doublingWaves(1, 9)), vxLapReadout: true, vxLoop: true, ...look };
  return { ...base, vxLoop: true, ...look };
}

/* ------------------------------------------------------------------ URL */

/** Up to six decimals, trailing zeros dropped, so slider values survive the URL. */
function formatNumber(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/** The short URL keys of the numeric fields (they extend the Sound Vortex's vx* keys). */
export const FS_URL_KEYS: Readonly<Record<string, NumberKey>> = { vxwi: "vxWaveInterval", vxfd: "vxFunnelDepth", vxe: "vxElevation", vxsf: "vxSpinFriction", vxfl: "vxFirstLap", vxh: "vxHoleSize", vxrg: "vxRefillGap" };

/** Writes the fields that differ from `base` (the defaults): vxrl, vxv, vxw, vxwi, vxfd, vxe, vxsf, vxfl, vxh, vxrg, vxlr. */
export function writeFunnelSpinParams(settings: FunnelSpinFields, base: FunnelSpinFields, params: URLSearchParams) {
  if (settings.vxRelease !== base.vxRelease) params.set("vxrl", settings.vxRelease);
  if (settings.vxView !== base.vxView) params.set("vxv", settings.vxView);
  const waves = formatWaves(parseWaves(settings.vxWaves));
  if (waves !== formatWaves(parseWaves(base.vxWaves))) params.set("vxw", waves.replace(/\s+/g, ""));
  for (const [key, field] of Object.entries(FS_URL_KEYS)) if (settings[field] !== base[field]) params.set(key, formatNumber(settings[field]));
  if (settings.vxLapReadout !== base.vxLapReadout) params.set("vxlr", settings.vxLapReadout ? "1" : "0");
}

/** Reads the feature's URL parameters into `settings` and validates them; unknown or invalid values fall back to the defaults. */
export function readFunnelSpinParams(params: URLSearchParams, settings: FunnelSpinFields) {
  const next: Partial<Record<keyof FunnelSpinFields, unknown>> = { ...settings };
  const release = params.get("vxrl");
  if (release !== null) next.vxRelease = release;
  const view = params.get("vxv");
  if (view !== null) next.vxView = view;
  const waves = params.get("vxw");
  if (waves !== null) next.vxWaves = waves;
  for (const [key, field] of Object.entries(FS_URL_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) next[field] = raw;
  }
  const lap = params.get("vxlr");
  if (lap === "1") next.vxLapReadout = true;
  else if (lap === "0") next.vxLapReadout = false;
  Object.assign(settings, resolveFunnelSpinFields(next));
}

/* ------------------------------------------------------------------ the run's timing (the panel, the finder, the section's line) */

/** The run's timing for the panel and the finder: the descent, the last vanish, the cycle, the lap gain and the first and last laps. */
export interface FunnelTiming {
  marbles: number;
  waves: number;
  descentSec: number;
  vanishSec: number;
  cycleSec: number;
  lapGain: number;
  firstLapSec: number;
  lastLapSec: number;
}

/** The engine's fixed step (s): a ring run's timing is on its grid. */
export const FS_STEP_SEC = 1 / 60;

/** The timing of a ring run with these settings, on the engine's 60 Hz step grid as a run times it (the descent from the entry at FS_ENTRY_AT to the hole, whatever the canvas size). */
export function funnelTiming(s: Pick<FunnelSpinSettings, "waves" | "waveInterval" | "spinFriction" | "firstLap" | "holeSize" | "refillGap">): FunnelTiming {
  const waves = wavesForRun(s.waves);
  const hole = Math.max(0, s.holeSize) / 100;
  const steps = funnelStepTiming(waves.length, s.waveInterval, s.holeSize, s.spinFriction, s.firstLap, s.refillGap, FS_STEP_SEC);
  const lapGain = funnelLapGain(FS_ENTRY_AT, hole, s.spinFriction);
  return {
    marbles: wavesTotal(waves),
    waves: waves.length,
    descentSec: steps.descentSec,
    vanishSec: steps.vanishSec,
    cycleSec: steps.cycleSec,
    lapGain,
    firstLapSec: s.firstLap,
    lastLapSec: s.firstLap / lapGain,
  };
}
