import type { FightSoundKind, SoundEvent } from "@/lib/physics/types";

/**
 * --- fl-overhaul --- (Stage 4) THE one dispatch of a Fight League sound event, used by the page's sound loop
 * (Simulator.tsx), the fast export (fastRender.ts `playSoundEvent()`) and the other arenas (multi.ts `playArenaSound()`), so
 * every path mixes the same way: a cue (`SoundEvent.flCue`) goes to the sink's `playFightCue()` (the ToneGenerator resolves
 * and mixes it – flSoundResolve.ts, flMixer.ts); a sink without it plays the cue's legacy kind (`SoundEvent.fight`) through
 * `playFight()` – as does an old-style event with a kind and no cue. A new cue such a sink cannot play is dropped (never a
 * bounce). `levelScale` scales the level (the other arenas' are a little softer), `arena` keeps their loops apart.
 */
export interface FightCueSink {
  playFightCue?(ev: SoundEvent, levelScale?: number, arena?: number): void;
  playFight?(kind: FightSoundKind, frequency?: number, level?: number): void;
}

/** True when `ev` is a Fight League sound (a cue or a legacy kind), which this dispatch consumed. */
export function playFightEvent(sink: FightCueSink, ev: SoundEvent, levelScale = 1, arena = 0): boolean {
  if (!ev.flCue && !ev.fight) return false;
  if (ev.flCue && typeof sink.playFightCue === "function") {
    sink.playFightCue(ev, levelScale, arena);
    return true;
  }
  if (ev.fight && typeof sink.playFight === "function") sink.playFight(ev.fight, ev.frequency, (ev.level ?? 1) * levelScale);
  return true;
}
