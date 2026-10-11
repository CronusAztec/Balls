import type { SoundEvent } from "@/lib/physics/types";

/**
 * --- fl-overhaul --- (Stage 4) Fight League's sound budget per 60 Hz SIMULATION tick (it replaces the old per-frame
 * FL_SOUNDS_PER_FRAME): each tick keeps its strongest 3 hits, 2 shots, 1 swing, 1 block and 1 wall note – at most
 * `FL_TICK_CUES` (6) in all, taken in that order of priority (hits, blocks, shots, swings, notes) – while the urgent cues
 * (an ability's, the match's stings, the announcer, a KO, low HP) always pass (at most `FL_TICK_URGENT` a tick, the same cue
 * twice in a tick once). The mode closes every tick (`endTick()` at the end of its step); the page's per-frame flush drains
 * the closed ticks in order (`drain()`), so the page at any frame rate, the fast export and every split-screen arena pick
 * the same cues. Weapon cues may be muted (`muteWeapons`: a show's fast-forward past 1.5× – the hook, unused for now).
 */

export const FL_CAT_HIT = 0;
export const FL_CAT_BLOCK = 1;
export const FL_CAT_SHOOT = 2;
export const FL_CAT_SWING = 3;
export const FL_CAT_NOTE = 4;
/** Slots per category (hit, block, shoot, swing, note), the most budgeted cues a tick, the most urgent ones. */
export const FL_TICK_SLOTS: readonly number[] = [3, 1, 2, 1, 1];
export const FL_TICK_CUES = 6;
export const FL_TICK_URGENT = 24;
/** The most cues waiting for a flush (a page that stopped flushing drops the rest). */
export const FL_READY_MAX = 512;

function urgentKey(ev: SoundEvent): string {
  return `${ev.flCue}|${ev.flRow ?? ""}|${ev.flFighter ?? ""}|${ev.flPrim ?? ""}|${ev.flLoop ?? ""}|${ev.flVariant ?? ""}|${ev.flDelay ?? ""}`;
}

export class FlTickBudget {
  private readonly cats: { ev: (SoundEvent | null)[]; energy: Float64Array; n: number }[] = FL_TICK_SLOTS.map((n) => ({ ev: new Array<SoundEvent | null>(n).fill(null), energy: new Float64Array(n), n: 0 }));
  private readonly urgent: SoundEvent[] = [];
  private readonly urgentKeys = new Set<string>();
  private ready: SoundEvent[] = [];
  /** Weapon cues muted (a fast-forward past 1.5×; not used in this overhaul). */
  muteWeapons = false;
  /** Cues budgeted out (for the tests). */
  dropped = 0;

  clear() {
    for (const c of this.cats) {
      c.n = 0;
      c.ev.fill(null);
    }
    this.urgent.length = 0;
    this.urgentKeys.clear();
    this.ready = [];
    this.dropped = 0;
  }

  /** A budgeted cue of category `cat`, `energy` strong (a tick keeps its strongest; a tie keeps the earlier one). */
  offer(cat: number, energy: number, ev: SoundEvent) {
    if (this.muteWeapons && cat !== FL_CAT_NOTE) return;
    const c = this.cats[cat];
    if (!c) return;
    if (c.n < c.ev.length) {
      c.ev[c.n] = ev;
      c.energy[c.n] = energy;
      c.n++;
      return;
    }
    let weakest = 0;
    for (let i = 1; i < c.n; i++) if (c.energy[i] < c.energy[weakest]) weakest = i;
    this.dropped++;
    if (!(energy > c.energy[weakest])) return;
    c.ev[weakest] = ev;
    c.energy[weakest] = energy;
  }

  /** A cue that always plays (deduplicated within the tick). */
  urgentCue(ev: SoundEvent) {
    if (this.urgent.length >= FL_TICK_URGENT) return;
    const key = urgentKey(ev);
    if (this.urgentKeys.has(key)) return;
    this.urgentKeys.add(key);
    this.urgent.push(ev);
  }

  /** Closes the tick: its urgent cues, then its budgeted ones by priority (at most FL_TICK_CUES), wait for the flush. */
  endTick() {
    const out = this.ready;
    for (const ev of this.urgent) if (out.length < FL_READY_MAX) out.push(ev);
    this.urgent.length = 0;
    this.urgentKeys.clear();
    let left = FL_TICK_CUES;
    for (const c of this.cats) {
      // in the order they were offered within their category
      for (let i = 0; i < c.n; i++) {
        const ev = c.ev[i];
        c.ev[i] = null;
        if (!ev) continue;
        if (left > 0 && out.length < FL_READY_MAX) {
          out.push(ev);
          left--;
        } else this.dropped++;
      }
      c.n = 0;
    }
  }

  /** Hands every closed tick's cues to `push` in order; returns how many. */
  drain(push: (ev: SoundEvent) => void): number {
    const out = this.ready;
    if (out.length === 0) return 0;
    this.ready = [];
    for (const ev of out) push(ev);
    return out.length;
  }

  /** Cues waiting for the flush. */
  pending(): number {
    return this.ready.length;
  }
}
