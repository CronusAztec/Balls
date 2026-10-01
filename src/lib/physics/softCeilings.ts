/**
 * --- review fix (security-robustness) --- Soft memory-safe ceilings of the counts the engine turns into objects.
 *
 * Links, share codes, presets and project files keep big numbers on purpose (extreme values are a feature; `coreNumber()`
 * in settings.ts only lifts invalid ones), but a count that becomes rings, target segments or spikes has to stop somewhere:
 * `?wc=1000000` took 1.3 s to build and 220 ms a frame, `?tc=1000000000` ran the tab out of memory. The engine therefore
 * builds at most these many – past every slider (20 / 25 / 20), past what a screen can show (a thousand rings already fill
 * the band at sub-pixel spacing, see ringLod.ts; a hundred numbered segments are 3.6° each) – the rings at the No limits
 * machinery's own ceiling (--- uncap-all --- the memory-safety `RING_CEILING`), the segments and spikes at what a frame can
 * label and draw – while the settings keep the typed value and the page says so under the canvas
 * (`softCeilingNotes()`). They apply inside the engine, so the page, Find Simulation, the fast export, batch
 * renders and the bot all run the same, deterministic world for a seed. (--- uncap-all --- whatever the Wide sliders switch
 * says: limits.ts builds at most `LIVE_WALL_LIMIT` rings, and the segments and spikes stop below their memory-safety
 * ceilings in `MEMORY_CEILINGS`, at these.)
 */
import { LIVE_WALL_LIMIT } from "@/lib/unlimited";

/** The most rings the engine builds from the Wall Count (Classic, Shatter): No limits' `LIVE_WALL_LIMIT` (--- uncap-all --- `RING_CEILING`, 10,000). */
export const LIVE_RING_LIMIT = LIVE_WALL_LIMIT;
/**
 * The most numbered segments Target mode lays out (Number of Targets, 100): the canvas labels every one, every frame, and a
 * segment narrower than its 0.04 rad of gaps cannot be drawn. (--- uncap-all --- below the memory-safety ceiling of a mode's
 * entities, `ENTITY_CEILING`: 5,000 labelled segments took the page to 2 frames a second, so this one stays what a frame shows.)
 */
export const LIVE_TARGET_LIMIT = 100;
/** The most spikes Accumulation puts on its wall (Spike Count, 360): one per degree (--- uncap-all --- below `ENTITY_CEILING`, as above). */
export const LIVE_SPIKE_LIMIT = 360;

/** `value`, or `limit` when it is past it. */
export function liveCount(value: number, limit: number): number {
  return value > limit ? limit : value;
}

/** A config (or a patch of one) whose Wall Count runs at most `LIVE_RING_LIMIT` rings; the same object when it is within it. */
export function withLiveRingCount<T extends { wallCount?: number }>(config: T): T {
  return config.wallCount !== undefined && config.wallCount > LIVE_RING_LIMIT ? { ...config, wallCount: LIVE_RING_LIMIT } : config;
}

/** The modes that build their rings from the Wall Count (the engine's "classic" ring layout). */
const RING_COUNT_MODES: readonly string[] = ["classic", "shatter"];

export interface SoftCeilingNote {
  /** The setting (its `Controls` label key). */
  setting: "wallCount" | "targetCount" | "spikeCount";
  /** What the settings ask for. */
  asked: number;
  /** What the engine runs. */
  running: number;
}

/** The counts of these settings the engine runs below what they ask for (empty: everything runs as set). */
export function softCeilingNotes(s: { mode: string; wallCount: number; targetCount: number; spikeCount: number; spikesEnabled: boolean }): SoftCeilingNote[] {
  const notes: SoftCeilingNote[] = [];
  if (RING_COUNT_MODES.includes(s.mode) && s.wallCount > LIVE_RING_LIMIT) notes.push({ setting: "wallCount", asked: s.wallCount, running: LIVE_RING_LIMIT });
  if (s.mode === "target" && s.targetCount > LIVE_TARGET_LIMIT) notes.push({ setting: "targetCount", asked: s.targetCount, running: LIVE_TARGET_LIMIT });
  if (s.mode === "accumulation" && s.spikesEnabled && s.spikeCount > LIVE_SPIKE_LIMIT) notes.push({ setting: "spikeCount", asked: s.spikeCount, running: LIVE_SPIKE_LIMIT });
  return notes;
}
