/**
 * --- review fix (security-robustness) --- Soft memory-safe ceilings of the counts the engine turns into objects.
 *
 * Links, share codes, presets and project files keep big numbers on purpose (extreme values are a feature; `floorToRange()`
 * in settings.ts only lifts invalid ones), but a count that becomes rings, target segments or spikes has to stop somewhere:
 * `?wc=1000000` took 1.3 s to build and 220 ms a frame, `?tc=1000000000` ran the tab out of memory. The engine therefore
 * builds at most these many – far past every slider (20 / 25 / 20) and past what a screen can show (rings closer than a pixel
 * are drawn about one per pixel, see ringLod.ts) – --- uncap-all --- the memory-safety ceilings of lib/uncap.ts
 * (`MEMORY_CEILINGS`: `RING_CEILING` rings, `ENTITY_CEILING` segments and spikes), the only ceilings left – while the settings keep the typed value and the page says so under the canvas
 * (`softCeilingNotes()`). They apply inside the engine, so the page, Find Simulation, the fast export, batch
 * renders and the bot all run the same, deterministic world for a seed. With No limits on, limits.ts applies the same
 * ceilings (`ENGINE_CEILINGS` in lib/unlimited.ts, the source of these numbers); these keep them with it off too.
 */
import { ENGINE_CEILINGS, LIVE_WALL_LIMIT } from "@/lib/unlimited";

/** The most rings the engine builds from the Wall Count (Classic, Shatter): `LIVE_WALL_LIMIT` (--- uncap-all --- `RING_CEILING`, 10,000). */
export const LIVE_RING_LIMIT = LIVE_WALL_LIMIT;
/** The most numbered segments Target mode lays out (Number of Targets; --- uncap-all --- `ENTITY_CEILING`, 5,000). */
export const LIVE_TARGET_LIMIT = ENGINE_CEILINGS.targetCount;
/** The most spikes Accumulation puts on its wall (Spike Count; --- uncap-all --- `ENTITY_CEILING`, 5,000). */
export const LIVE_SPIKE_LIMIT = ENGINE_CEILINGS.spikeCount;

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
