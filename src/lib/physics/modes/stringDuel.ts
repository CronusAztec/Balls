import { midiToFrequency } from "@/lib/audio/scales";

/**
 * --- string-battle-alive --- The String Battle's life rule and its FINAL DUEL (feature string-battle-alive; the owner's
 * request of Oct 12: "the balls are alive when there is a string attached and not by just 4 lives … when it gets down to the
 * last 2 balls it gets faster and they have an epic fight"). Pure (no DOM, no engine import at run time): the mode
 * (stringBattle.ts), the renderer, the camera, the ToneGenerator, the panel and the tests all read it.
 *
 *  - The **life rule** (`sbLife`, URL `sblf`; absent = "strings"): under **strings** (the default) a ball is alive for exactly
 *    as long as at least one of its own threads is anchored on the ring – it spawns with one lifeline thread at the rim point
 *    straight behind its heading, every bounce anchors another, an enemy takes them (the cut rule: every thread its move
 *    crosses; the touch rule: the toucher's oldest; the collide rule: the slower ball's oldest), and its last thread gone it
 *    shatters at once. No lives are counted and nothing shields a ball: it survives by bouncing faster than it is cut. Under
 *    **lives** the battle plays exactly as it always did (the lives, the shield, the circle style's strings per life).
 *  - The **final duel** (`sbDuel`, URL `sbdl`, default on): the finale starts the moment two balls are left. The cruising
 *    speed ramps to the Finale Speed over `SB_FINALE_RAMP_MS` (stringBattle.ts) and then surges by `SB_SURGE_STEP` after
 *    every `SB_SURGE_EVERY_MS` without a cut (`duelSurge()`: each step eased over `SB_SURGE_EASE_MS`, banked at a cut, so
 *    the speed never jumps and never drops); with the switch on, every ring bounce homes in on the opponent by up to
 *    `SB_DUEL_HOMING` (`homingTurn()`, no random draw: every seed's pre-duel part replays exactly), every cut dips into slow
 *    motion with a camera punch and a ring flash, a FINAL DUEL banner opens it, comet trails follow both balls and an
 *    original tension soundtrack plays under it (a riser into a tom, a heartbeat from 100 to 160 BPM, a drone a semitone
 *    higher at every cut, a long noise tail on the final cut: lib/audio/stringDuelTones.ts).
 */

/* ------------------------------------------------------------------ the life rule */

export const SB_LIFE_RULES = ["strings", "lives"] as const;
export type SbLife = (typeof SB_LIFE_RULES)[number];

export function isSbLife(value: unknown): value is SbLife {
  return typeof value === "string" && (SB_LIFE_RULES as readonly string[]).includes(value);
}

/** The rule a battle plays when nothing says otherwise (a link without `sblf`, an older preset): the strings. */
export const DEFAULT_SB_LIFE: SbLife = "strings";
/** The duel's extras (homing, slow motion, banner, trails, soundtrack) are on unless switched off. */
export const DEFAULT_SB_DUEL = true;

/**
 * Under the strings rule the rig's chosen ball blinks this long (simulation ms) when it keeps a last thread the hit would have
 * taken – the strings rule's only "shield", and it protects nothing: it is the rig's visible tell, as `SB_INVULN_MS` is the
 * lives rule's.
 */
export const SB_RIG_BLINK_MS = 400;

/** The blink / shield of a ball that was just hit (simulation ms): the lives rule's shield per rule, the strings rule's rig blink. */
export function sbShieldMs(life: SbLife, livesShieldMs: number): number {
  return life === "strings" ? SB_RIG_BLINK_MS : livesShieldMs;
}

/* ------------------------------------------------------------------ the duel's speed */

/** In a duel the cruising speed surges by this (× the Ball Speed's cruise) … */
export const SB_SURGE_STEP = 0.25;
/** … after every this long (simulation ms) without a cut – a stalemate accelerates until something gives (uncapped) … */
export const SB_SURGE_EVERY_MS = 4000;
/** … each step eased in over this long (simulation ms), so the speed never jumps. */
export const SB_SURGE_EASE_MS = 300;

function smooth01(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/**
 * The surge `sinceCutMs` after the duel's last cut (or its start): `SB_SURGE_STEP` × the steps reached so far, each one eased
 * in over `SB_SURGE_EASE_MS` once its `SB_SURGE_EVERY_MS` were up – 0 for the first 4 s, 0.25 from 4.3 s, 0.5 from 8.3 s…
 * A pure function of the time, continuous and never decreasing (the mode banks it at a cut, so the speed never drops either).
 */
export function duelSurge(sinceCutMs: number): number {
  if (!(sinceCutMs >= SB_SURGE_EVERY_MS)) return 0;
  if (sinceCutMs === Infinity) return Infinity;
  const steps = Math.floor(sinceCutMs / SB_SURGE_EVERY_MS);
  const last = smooth01((sinceCutMs - steps * SB_SURGE_EVERY_MS) / SB_SURGE_EASE_MS);
  return SB_SURGE_STEP * (steps - 1 + last);
}

/* ------------------------------------------------------------------ homing */

/** At a ring bounce in the duel the rebound turns toward the opponent by at most this (radians: 35°). */
export const SB_DUEL_HOMING = (35 * Math.PI) / 180;

/** The difference b − a of two bearings, in (−π, π]. */
function bearingDiff(a: number, b: number): number {
  let d = (b - a) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d <= -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * The heading `heading` of a ball at (x, y) turned toward the point (tx, ty) by at most `max` radians (all the way when the
 * target is within `max` of it). A bounded, deterministic bias: no random number. A target on the ball itself leaves the
 * heading as it is.
 */
export function homingTurn(heading: number, x: number, y: number, tx: number, ty: number, max = SB_DUEL_HOMING): number {
  const dx = tx - x;
  const dy = ty - y;
  if (!(dx * dx + dy * dy > 1e-12) || !(max > 0)) return heading;
  const d = bearingDiff(heading, Math.atan2(dy, dx));
  return heading + (d > max ? max : d < -max ? -max : d);
}

/**
 * The duel's aim: at a ring bounce the rebound homes in on the point just behind the opponent on its newest thread – this many
 * of its radii past the stub next to its body that no cut reaches –, so a ball that gets there crosses the thread its rival
 * hangs by; its body itself while that thread is shorter. (Aiming at the centre alone sends the two head-on along one line,
 * where no thread is ever crossed.)
 */
export const SB_DUEL_AIM = 1;

/* ------------------------------------------------------------------ the stalemate rule (strings) */

/**
 * Under the strings rule, every this long (simulation ms) without a knockout the webs thin: the live threads a ball may keep
 * halve (`stallCap()`), down to one – a stalemate cannot last (measured without it: four-ball collide battles and half the
 * duels never ended, the fans refilling faster than any slash could empty them). A knockout lets them grow back.
 */
export const SB_STALL_MS = 4000;
/**
 * The circle style's dense fans start the strings rule's stalemate rule from this many strings a ball (a quarter of the string
 * ceiling, past the fans' usual 130–330).
 */
export const SB_CIRCLE_STRINGS_CAP = 256;
/**
 * The circle style's stalemate rule: its fans regrow thirty strings a second, so they keep their full size for this long after a
 * knockout (or the start) and then halve every `SB_CIRCLE_STALL_MS` – a four-flag battle of under a minute, like the lives
 * rule's (measured: halving every `SB_STALL_MS` from the start, 87–107 s, past the finder's horizon of a 30 s clip).
 */
export const SB_CIRCLE_STALL_GRACE_MS = 4000;
export const SB_CIRCLE_STALL_MS = 1000;

/**
 * The live threads a ball may keep `stalledMs` after the latest knockout (or the start): `base` until `graceMs`, then halved
 * every `stepMs`, at least 1 (by default `base` halved every `SB_STALL_MS`).
 */
export function stallCap(base: number, stalledMs: number, stepMs = SB_STALL_MS, graceMs = stepMs): number {
  const b = Number.isFinite(base) ? Math.max(1, Math.floor(base)) : 1;
  const step = stepMs > 0 ? stepMs : SB_STALL_MS;
  const steps = stalledMs >= graceMs && stalledMs > 0 ? 1 + Math.floor((stalledMs - graceMs) / step) : 0;
  if (steps <= 0) return b;
  if (steps >= 31) return 1;
  return Math.max(1, Math.floor(b / 2 ** steps));
}

/**
 * Under the strings rule nothing is cut, touched away or collided away in the battle's first `SB_OPENING_MS` (every ball
 * bounces once or twice and grows a web: a lone lifeline is cut in the first second otherwise – measured, four-ball battles
 * over in two seconds) nor while the FINAL DUEL banner is up (`SB_DUEL_BANNER_MS`: the last two square up). Not a shield: it is
 * the same for every ball, once, and never follows a hit.
 */
export const SB_OPENING_MS = 2000;

/** Whether the strings rule's hits are held at `nowMs`: the battle's opening, or the duel's banner (`twoLeftMs` −1: no duel yet). */
export function stringsHeld(nowMs: number, twoLeftMs: number, duel: boolean): boolean {
  if (nowMs < SB_OPENING_MS) return true;
  return duel && twoLeftMs >= 0 && nowMs - twoLeftMs < SB_DUEL_BANNER_MS;
}

/* ------------------------------------------------------------------ the drama */

/** The FINAL DUEL banner shows this long (simulation ms), once a battle. */
export const SB_DUEL_BANNER_MS = 1200;
/** Comet trails: the last this many positions of each ball … */
export const SB_DUEL_TRAIL = 12;
/** … one every this many 60 Hz steps (a trail of a fifth of a second at the duel's speed). */
export const SB_DUEL_TRAIL_EVERY = 2;
/** Every cut of the duel dips into slow motion for this long (real ms) … */
export const SB_DUEL_DIP_MS = 250;
/** … the final cut for this long (the camera's default slow-motion window) … */
export const SB_DUEL_FINAL_DIP_MS = 700;
/** … at this time scale. */
export const SB_DUEL_DIP_FACTOR = 0.3;
/** A cut punches the camera this far (px) and flashes the ring in the cutter's colour for this long (simulation ms). */
export const SB_DUEL_PUNCH_PX = 4;
export const SB_DUEL_PUNCH_MS = 220;
export const SB_DUEL_FLASH_MS = 300;
/**
 * Cuts of the duel closer together than this (simulation ms) are one moment: one slow-motion dip, one swell, one punch (the
 * circle style's fans are cut all the time – every slice would otherwise keep the clip in slow motion).
 */
export const SB_DUEL_CUT_GAP_MS = 600;

/* ------------------------------------------------------------------ the soundtrack */

/** The heartbeat's tempo climbs from this … */
export const SB_DUEL_BPM_FROM = 100;
/** … to this … */
export const SB_DUEL_BPM_TO = 160;
/** … over this much duel (simulation ms), then holds. */
export const SB_DUEL_BPM_RAMP_MS = 20_000;
/** The riser at the duel's start lasts this long (s); the heartbeat starts when it lands on its tom. */
export const SB_DUEL_RISER_SEC = 0.8;
/** The drone's root (MIDI: D2), a semitone higher at every cut and round again after an octave. */
export const SB_DUEL_DRONE_MIDI = 38;

/** The heartbeat's tempo (BPM) `sinceDuelMs` into the duel: 100 → 160 over 20 s, linear, then 160. */
export function duelBpm(sinceDuelMs: number): number {
  const x = sinceDuelMs > 0 ? Math.min(1, sinceDuelMs / SB_DUEL_BPM_RAMP_MS) : 0;
  return SB_DUEL_BPM_FROM + (SB_DUEL_BPM_TO - SB_DUEL_BPM_FROM) * x;
}

/** The time (simulation ms) from a heartbeat `sinceDuelMs` into the duel to the next one. */
export function duelBeatGapMs(sinceDuelMs: number): number {
  return 60_000 / duelBpm(sinceDuelMs);
}

/** The drone's root (Hz) after `cuts` cuts of the duel: D2, a semitone up a cut, round again after twelve. */
export function duelDroneFrequency(cuts: number): number {
  const n = Number.isFinite(cuts) ? Math.max(0, Math.floor(cuts)) : 0;
  return midiToFrequency(SB_DUEL_DRONE_MIDI + (n % 12));
}

/** The sounds of the duel the mode emits (`SoundEvent.sbDuel`; `ToneGenerator.playStringDuel()`). */
export const SB_DUEL_SOUNDS = ["start", "beat", "cut", "final", "stop"] as const;
export type SbDuelSound = (typeof SB_DUEL_SOUNDS)[number];

/* ------------------------------------------------------------------ the trails */

/** The comet trails of a battle's balls: a ring of `SB_DUEL_TRAIL` positions per slot (the newest at `head − 1`). */
export interface DuelTrails {
  x: Float64Array;
  y: Float64Array;
  /** Per slot: where the next position goes, and how many are held (≤ SB_DUEL_TRAIL). */
  head: Int32Array;
  count: Int32Array;
}

export function createDuelTrails(slots: number): DuelTrails {
  const n = Math.max(1, slots);
  return { x: new Float64Array(n * SB_DUEL_TRAIL), y: new Float64Array(n * SB_DUEL_TRAIL), head: new Int32Array(n), count: new Int32Array(n) };
}

/** Records slot `slot`'s position (the oldest one goes past `SB_DUEL_TRAIL`). */
export function pushTrail(t: DuelTrails, slot: number, x: number, y: number) {
  if (slot < 0 || slot >= t.head.length) return;
  const i = slot * SB_DUEL_TRAIL + t.head[slot];
  t.x[i] = x;
  t.y[i] = y;
  t.head[slot] = (t.head[slot] + 1) % SB_DUEL_TRAIL;
  if (t.count[slot] < SB_DUEL_TRAIL) t.count[slot]++;
}

/** Forgets every trail. */
export function clearTrails(t: DuelTrails) {
  t.head.fill(0);
  t.count.fill(0);
}

/** Position `k` of slot `slot`'s trail, 0 the oldest held – written into `out`; false past the held ones. */
export function trailPoint(t: DuelTrails, slot: number, k: number, out: { x: number; y: number }): boolean {
  if (slot < 0 || slot >= t.head.length || k < 0 || k >= t.count[slot]) return false;
  const i = slot * SB_DUEL_TRAIL + ((t.head[slot] - t.count[slot] + k + SB_DUEL_TRAIL) % SB_DUEL_TRAIL);
  out.x = t.x[i];
  out.y = t.y[i];
  return true;
}

/* ------------------------------------------------------------------ the clip-limit verdict */

/**
 * The slots that take a clip-limit verdict under the strings rule: the survivors with the most live threads (`teamResult()`
 * then ranks them by kills and bounces) – and, with the rig on, its chosen ball alone while it stands (the threads come and go
 * faster than any lead can be held: the rig's hard constraint is the verdict).
 */
export function threadLeaders(fighters: readonly { alive: boolean; strings: readonly unknown[] }[], forcedWinner: number): number[] {
  if (forcedWinner >= 0 && fighters[forcedWinner]?.alive) return [forcedWinner];
  let best = 0;
  for (const f of fighters) if (f.alive && f.strings.length > best) best = f.strings.length;
  const out: number[] = [];
  fighters.forEach((f, i) => {
    if (f.alive && f.strings.length === best && best > 0) out.push(i);
  });
  return out;
}

/** The live threads of every slot ("3,0,7,…"; 0 for a ball that is out): `data-sb-threads`. */
export function threadsText(fighters: readonly { alive: boolean; strings: readonly unknown[] }[]): string {
  let out = "";
  for (let i = 0; i < fighters.length; i++) out += `${i > 0 ? "," : ""}${fighters[i].alive ? fighters[i].strings.length : 0}`;
  return out;
}
