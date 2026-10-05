import type { FightSoundKind, SoundEvent } from "@/lib/physics/types";
import { FL_BY_ID, type FlWeaponKind } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_ANNOUNCER, FL_DIVISION_TINTS, FL_FAMILY_DEFAULT_H, FL_FAMILY_SETS, FL_MATCH_SOUNDS, FL_PRIMITIVE_SOUNDS, FL_SHAPE_KIND, FL_SIGNATURES, FL_WEAPON_SOUNDS, flSaberHz, flTierOf, type FlFamily, type FlTier } from "./flRecipes";

/**
 * --- fl-overhaul --- (Stage 4) Which sound a Fight League cue makes – pure: `resolveFlSound(ev, bank, settings)` reads the
 * cue (SoundEvent.flCue and its fields), the clips the user added (`bank`) and the sound settings, and names the voices to
 * play (recipes of flRecipes.ts or a clip) with their bus, delay and gain. The order: the fighter's custom clip → its
 * signature set (FL_SIGNATURES: its own roles, then its family set at its pitch H) with its division's tint layered on
 * (FL_DIVISION_TINTS) → its weapon kind's (FL_WEAPON_SOUNDS) or ability primitive's (FL_PRIMITIVE_SOUNDS) row → the legacy
 * fightTones kind (`SoundEvent.fight`; a fallback the tests treat as a miss). The match stings (FL_MATCH_SOUNDS) and the
 * announcer (FL_ANNOUNCER) resolve directly. "kinds" skips the signatures and the tints; "legacy" plays the old sounds only.
 * A `null` result is a cue nothing resolves (a test failure); silence by design (a row left out on purpose, the announcer
 * off, a new cue under the legacy set) is a resolution with source "silent" and no voice.
 */

export type FlSoundSet = "signature" | "kinds" | "legacy";
export const FL_SOUND_SETS: readonly FlSoundSet[] = ["signature", "kinds", "legacy"];

export interface FlSoundSettings {
  set: FlSoundSet;
  announcer: boolean;
  custom: boolean;
}
export const DEFAULT_FL_SOUND_SETTINGS: FlSoundSettings = { set: "signature", announcer: true, custom: true };

/** A fighter's custom clip slots (flClips.ts). */
export type FlClipSlot = "swing" | "hit" | "ability" | "ko" | "intro" | "win";
export const FL_CLIP_SLOTS: readonly FlClipSlot[] = ["swing", "hit", "ability", "ko", "intro", "win"];

/** What the resolver knows of the clip store: a fighter's decoded clip in a slot (its key and length), or null. */
export interface FlClipLookup {
  clip(fighterId: string, slot: FlClipSlot): { key: string; sec: number } | null;
}
export const NO_FL_CLIPS: FlClipLookup = { clip: () => null };

/** The mixer's buses (flMixer.ts). */
export type FlBus = "swing" | "shoot" | "hit" | "ability" | "ambient" | "match" | "announcer";
export const FL_BUSES: readonly FlBus[] = ["swing", "shoot", "hit", "ability", "ambient", "match", "announcer"];

/** Where a voice came from. */
export type FlVoiceSource = "clip" | "signature" | "family" | "tint" | "weapon" | "primitive" | "match" | "announcer";
export type FlSource = FlVoiceSource | "legacy" | "silent";

export interface FlVoice {
  source: FlVoiceSource;
  /** The recipe's text (flSynth.ts notation) – or, for a clip, its key in the clip bank. */
  recipe?: string;
  clip?: string;
  bus: FlBus;
  /** Seconds after the cue's own time. */
  delay: number;
  /** × the cue's level (a layer's share). */
  gain: number;
  /** The family pitch H (Hz) of the recipe. */
  h: number;
  /** × R (the countdown's rising ticks). */
  rMul: number;
  tier: FlTier;
  /** A held voice: `sustainSec` from the cue (flSec); a loop: held until stopped or its lease runs out. */
  held: boolean;
  loop: boolean;
}

export interface FlResolution {
  source: FlSource;
  voices: FlVoice[];
  /** The legacy sound (flSnd=legacy, or the fallback): a fightTones kind, or the old win chord. */
  legacy?: { kind?: FightSoundKind; frequency?: number; level?: number; chord?: readonly number[] };
  /** Why it is silent (source "silent"). */
  why?: string;
}

/** The weapon cues (FL_WEAPON_SOUNDS' roles) and the ability cues (FL_PRIMITIVE_SOUNDS' roles). */
export const FL_WEAPON_CUES = ["swing", "shoot", "hit", "block", "return", "ricochet", "graze", "immune", "clash", "blink", "snag", "fuse"] as const;
export const FL_ABILITY_CUES = ["charge", "telegraph", "fire", "sustain", "impact", "end", "explode", "spin", "fuse", "ringBlades"] as const;

/** The bus of a fighter cue's role. */
export function flBusOf(role: string): FlBus {
  switch (role) {
    case "swing":
      return "swing";
    case "shoot":
    case "return":
    case "ricochet":
    case "blink":
    case "snag":
      return "shoot";
    case "hit":
    case "block":
    case "clash":
    case "graze":
    case "immune":
    case "heavy":
      return "hit";
    case "loop":
    case "ignite":
    case "retract":
      return "ambient";
    default:
      return "ability";
  }
}

/** The clip slot a fighter cue plays from (null: none). */
export function flClipSlotOf(cue: string, row?: string): FlClipSlot | null {
  if (cue === "swing" || cue === "shoot") return "swing";
  if (cue === "hit") return "hit";
  if (cue === "fire") return "ability";
  if (cue === "match" && (row === "ko" || row === "finalKo")) return "ko";
  if (cue === "match" && row === "intro") return "intro";
  if (cue === "match" && row === "win") return "win";
  return null;
}

const COUNT_STEPS = [1, 1.122, 1.26];

function voice(source: FlVoiceSource, text: string, bus: FlBus, role: string, h: number, extra: Partial<FlVoice> = {}): FlVoice {
  const tier = flTierOf(role, text);
  return { source, recipe: text, bus, delay: 0, gain: 1, h, rMul: 1, tier, held: tier === "sustain", loop: false, ...extra };
}

function clipVoice(key: string, bus: FlBus, extra: Partial<FlVoice> = {}): FlVoice {
  return { source: "clip", clip: key, bus, delay: 0, gain: 1, h: 440, rMul: 1, tier: "oneShot", held: false, loop: false, ...extra };
}

/** A fighter's own row for `role` (`role@key` first): its signature's roles, then its family set at its pitch. */
function signatureRow(id: string | undefined, role: string, key: string | undefined): { text: string; h: number; source: "signature" | "family" } | null {
  const sig = id ? FL_SIGNATURES[id] : undefined;
  if (!sig) return null;
  const h = sig.h ?? (sig.family ? FL_FAMILY_DEFAULT_H[sig.family] : 440);
  const roles = sig.roles;
  if (roles) {
    if (key && roles[`${role}@${key}`]) return { text: roles[`${role}@${key}`], h, source: "signature" };
    if (roles[role]) return { text: roles[role], h, source: "signature" };
  }
  if (sig.family) {
    const fam = FL_FAMILY_SETS[sig.family];
    if (fam[role]) return { text: fam[role], h, source: "family" };
  }
  return null;
}

/** The family a glowing blade sounds like without a signature: the energy blade at its colour's hum. */
function bladeFamily(ev: SoundEvent): { family: FlFamily; h: number } | null {
  if (ev.flWeapon !== "sword" || (ev.flStyle !== "glow" && ev.flStyle !== "double")) return null;
  return { family: "saber", h: flSaberHz(ev.flColor) };
}

/** The division's tint layer for `role` (with the primitive: "fire@heal"), or null. */
function tintOf(id: string | undefined, role: string, prim: string | undefined): FlVoice | null {
  const row = id ? FL_BY_ID.get(id) : undefined;
  const tint = row ? FL_DIVISION_TINTS[row.division] : null;
  if (!tint) return null;
  if (!tint.on.includes(role) && !(prim && tint.on.includes(`${role}@${prim}`))) return null;
  return voice("tint", tint.recipe, flBusOf(role), "tint", 440, { gain: 0.55 });
}

/** The weapon kind a fighter cue sounds like: its weapon's, else its projectile's shape's (an ability's volley), else a wand's. */
function kindOf(ev: SoundEvent): FlWeaponKind | null {
  if (ev.flWeapon && ev.flWeapon in FL_WEAPON_SOUNDS) return ev.flWeapon as FlWeaponKind;
  if (ev.flShape) return (FL_SHAPE_KIND as Record<string, FlWeaponKind | undefined>)[ev.flShape] ?? "wand";
  return null;
}

/** A weapon kind's row for `role`, with the fallbacks of the roles a kind leaves out (a clash rings like a block, …). */
function weaponRow(kind: FlWeaponKind, role: string): { text: string; gain: number } | null {
  const rows = FL_WEAPON_SOUNDS[kind] as Readonly<Record<string, string | undefined>>;
  if (rows[role]) return { text: rows[role]!, gain: 1 };
  switch (role) {
    case "clash":
      return rows.block ? { text: rows.block, gain: 1 } : FL_WEAPON_SOUNDS.sword.clash ? { text: FL_WEAPON_SOUNDS.sword.clash, gain: 0.8 } : null;
    case "graze":
      return rows.ricochet ? { text: rows.ricochet, gain: 0.5 } : { text: FL_WEAPON_SOUNDS.gun.ricochet!, gain: 0.35 };
    case "ricochet":
      return { text: FL_WEAPON_SOUNDS.gun.ricochet!, gain: 0.8 };
    case "block":
      return { text: FL_WEAPON_SOUNDS.shield.block!, gain: 1 };
    case "return":
      return rows.hit ? { text: rows.hit, gain: 0.4 } : null;
    case "blink":
      return { text: FL_WEAPON_SOUNDS.cards.blink!, gain: 1 };
    case "snag":
      return { text: FL_WEAPON_SOUNDS.whip.snag!, gain: 1 };
    case "fuse":
      return { text: FL_WEAPON_SOUNDS.bomb.fuse!, gain: 1 };
    case "swing":
      return rows.shoot ? { text: rows.shoot, gain: 1 } : null;
    case "shoot":
      return rows.swing ? { text: rows.swing, gain: 1 } : null;
    default:
      return null;
  }
}

/** A primitive's row for `role`, with the fallbacks (a spin whooshes like the cast, blades on a ring sustain like it). */
function primitiveRow(prim: string, role: string): string | null {
  const rows = (FL_PRIMITIVE_SOUNDS as Readonly<Record<string, Readonly<Record<string, string | undefined>> | undefined>>)[prim];
  if (!rows) return null;
  if (rows[role]) return rows[role]!;
  if (role === "spin") return rows.fire ?? null;
  if (role === "ringBlades") return rows.sustain ?? null;
  if (role === "explode") return FL_PRIMITIVE_SOUNDS.volley.explode ?? null;
  if (role === "fuse") return FL_PRIMITIVE_SOUNDS.shockwave.fuse ?? null;
  return null;
}

/** Roles a primitive leaves out on purpose: the cue is silent (a burst's or a heal's duration has no hold of its own). */
function silentByDesign(prim: string, role: string): boolean {
  return role === "sustain" || (role === "end" && !!prim);
}

function silent(why: string): FlResolution {
  return { source: "silent", voices: [], why };
}

/** The legacy fallback of a cue that resolved to nothing: its fightTones kind, or null (unresolved). */
function legacyOf(ev: SoundEvent): FlResolution | null {
  if (ev.fight) return { source: "legacy", voices: [], legacy: { kind: ev.fight, frequency: ev.frequency, level: ev.level } };
  return null;
}

/** A fighter's layer on a match sting (its KO, its win, its intro): its clip, else its signature's or family's row, else its tint. */
function fighterLayer(ev: SoundEvent, role: "ko" | "win" | "intro", bank: FlClipLookup, s: FlSoundSettings, delay: number, gain: number): FlVoice | null {
  const id = ev.flId;
  if (!id) return null;
  if (s.custom) {
    const c = bank.clip(id, role);
    if (c) return clipVoice(c.key, "match", { delay, gain });
  }
  if (s.set !== "signature") return null;
  const own = signatureRow(id, role, undefined);
  if (own) return voice(own.source, own.text, "match", role, own.h, { delay, gain });
  const tint = tintOf(id, role, undefined);
  return tint ? { ...tint, bus: "match", delay, gain: gain * 0.8 } : null;
}

/** The match's stings (and their fighter layers). */
function resolveMatch(ev: SoundEvent, bank: FlClipLookup, s: FlSoundSettings): FlResolution | null {
  const row = ev.flRow ?? "";
  if (s.set === "legacy") {
    const voices: FlVoice[] = [];
    if (s.custom && ev.flId) {
      const slot = flClipSlotOf("match", row);
      const c = slot ? bank.clip(ev.flId, slot) : null;
      if (c) voices.push(clipVoice(c.key, "match"));
    }
    if ((ev.chord && ev.chord.length > 0) || ev.fight) return { source: "legacy", voices, legacy: { kind: ev.fight, chord: ev.chord && ev.chord.length > 0 ? ev.chord : undefined, frequency: ev.frequency, level: ev.level } };
    return voices.length > 0 ? { source: "clip", voices } : silent("legacy set: a new cue");
  }
  if (!(row in FL_MATCH_SOUNDS)) return legacyOf(ev);
  const text = FL_MATCH_SOUNDS[row];
  const voices: FlVoice[] = [];
  if (text) voices.push(voice("match", text, row === "lowHp" || row === "immune" ? "hit" : "match", row, 440, { rMul: row === "tick" ? COUNT_STEPS[Math.max(0, Math.min(2, Math.round(ev.flVariant ?? 0)))] : 1, gain: row === "clock" && (ev.flVariant ?? 0) >= 1 ? 1.5 : 1 }));
  if (row === "ko" || row === "finalKo") {
    const layer = fighterLayer(ev, "ko", bank, s, 0.04, 0.8);
    if (layer) voices.push(layer);
  } else if (row === "win") {
    const layer = fighterLayer(ev, "win", bank, s, 0.25, 0.85);
    if (layer) voices.push(layer);
  } else if (row === "intro") {
    const layer = fighterLayer(ev, "intro", bank, s, 0, 0.85);
    if (layer) voices.push(layer);
  }
  if (voices.length === 0) return text === null ? silent(`match ${row}: no layer`) : null;
  return { source: voices[0].source, voices };
}

function resolveAnnouncer(ev: SoundEvent, s: FlSoundSettings): FlResolution | null {
  const row = ev.flRow ?? "";
  if (s.set === "legacy") return silent("legacy set: no announcer");
  if (!s.announcer) return silent("announcer off");
  const text = FL_ANNOUNCER[row];
  if (!text) return null;
  return { source: "announcer", voices: [voice("announcer", text, "announcer", row, 440)] };
}

/** A loop: the energy blade's hum (with its ignition when it starts), a held ability (its sustain row). */
function resolveLoop(ev: SoundEvent, s: FlSoundSettings): FlResolution | null {
  if (s.set === "legacy") return silent("legacy set: no loop");
  if (ev.flPrim) {
    // an ability's loop (a beam's ray, a ring): its sustain – the fighter's own, its family's, the primitive's (a ring of blades whirrs)
    if (ev.flCue === "loopStop") return silent("loop stop");
    const own = s.set === "signature" ? signatureRow(ev.flId, "sustain", ev.flPrim) : null;
    const blades = ev.flPrim === "fireRing" && !!ev.flShape && ev.flShape !== "flames";
    const text = own?.text ?? (blades ? FL_PRIMITIVE_SOUNDS.fireRing.ringBlades : primitiveRow(ev.flPrim, "sustain"));
    if (!text) return silent(`${ev.flPrim}: no loop by design`);
    const source = own?.source ?? "primitive";
    return { source, voices: [voice(source, text, "ability", "sustain", own?.h ?? 440, { loop: true, held: true, tier: "sustain" })] };
  }
  if (ev.flCue === "loopStop") {
    if (ev.flVariant !== 1) return { source: "silent", voices: [], why: "loop stop" };
    const own = s.set === "signature" ? signatureRow(ev.flId, "retract", undefined) : null;
    const blade = bladeFamily(ev);
    const text = own?.text ?? (blade ? FL_FAMILY_SETS[blade.family].retract : undefined);
    if (!text) return silent("loop stop");
    return { source: own?.source ?? "family", voices: [voice(own?.source ?? "family", text, "ambient", "retract", own?.h ?? blade!.h)] };
  }
  const own = s.set === "signature" ? signatureRow(ev.flId, "loop", undefined) : null;
  const blade = bladeFamily(ev);
  const text = own?.text ?? (blade ? FL_FAMILY_SETS[blade.family].loop : undefined);
  if (!text) return null;
  const h = own?.h ?? blade!.h;
  const source = own?.source ?? "family";
  const voices = [voice(source, text, "ambient", "loop", h, { loop: true, held: true, tier: "sustain" })];
  if (ev.flVariant === 1) {
    const ign = (s.set === "signature" ? signatureRow(ev.flId, "ignite", undefined) : null)?.text ?? (blade ? FL_FAMILY_SETS[blade.family].ignite : undefined);
    if (ign) voices.push(voice(source, ign, "ambient", "ignite", h));
  }
  return { source, voices };
}

/**
 * The voices of cue `ev` (see the header). `bank` answers which clips the user added (decoded ones only), `s` the sound
 * settings. Null: nothing resolves the cue.
 */
export function resolveFlSound(ev: SoundEvent, bank: FlClipLookup = NO_FL_CLIPS, s: FlSoundSettings = DEFAULT_FL_SOUND_SETTINGS): FlResolution | null {
  const cue = ev.flCue;
  if (!cue) return legacyOf(ev);
  if (cue === "match") return resolveMatch(ev, bank, s);
  if (cue === "announcer") return resolveAnnouncer(ev, s);
  if (cue === "loopStart" || cue === "loopStop") return resolveLoop(ev, s);
  if (s.set === "legacy") {
    const voices: FlVoice[] = [];
    const slot = s.custom && ev.flId ? flClipSlotOf(cue) : null;
    const c = slot ? bank.clip(ev.flId!, slot) : null;
    if (c) voices.push(clipVoice(c.key, flBusOf(cue)));
    if (ev.fight) return { source: c ? "clip" : "legacy", voices, legacy: c ? undefined : { kind: ev.fight, frequency: ev.frequency, level: ev.level } };
    return voices.length > 0 ? { source: "clip", voices } : silent("legacy set: a new cue");
  }
  const role = cue as string;
  const bus = flBusOf(role);
  const id = ev.flId;
  const prim = ev.flPrim;
  const ability = !!prim && (FL_ABILITY_CUES as readonly string[]).includes(role);
  const kind = ability ? null : kindOf(ev);
  const key = ability ? prim : (kind ?? undefined);
  const voices: FlVoice[] = [];
  let source: FlVoiceSource | null = null;
  // 1. the fighter's custom clip
  if (s.custom && id) {
    const slot = flClipSlotOf(role);
    const c = slot ? bank.clip(id, slot) : null;
    if (c) {
      voices.push(clipVoice(c.key, bus));
      source = "clip";
    }
  }
  // 2. its signature set (own roles, then its family at H; a glowing blade its energy-blade family), with its tint
  if (!source && s.set === "signature") {
    const own = signatureRow(id, role, key);
    if (own) {
      voices.push(voice(own.source, own.text, bus, role, own.h));
      source = own.source;
    } else if (!ability) {
      const blade = bladeFamily(ev);
      const t = blade ? FL_FAMILY_SETS[blade.family][role] : undefined;
      if (blade && t) {
        voices.push(voice("family", t, bus, role, blade.h));
        source = "family";
      }
    }
  }
  // 3. the kind's or the primitive's row
  if (!source) {
    if (ability) {
      // a ring of blades, kicks or cards whirrs where a ring of fire roars
      const blades = prim === "fireRing" && role === "sustain" && !!ev.flShape && ev.flShape !== "flames";
      const text = blades ? (FL_PRIMITIVE_SOUNDS.fireRing.ringBlades ?? null) : primitiveRow(prim!, role);
      if (text) {
        voices.push(voice("primitive", text, bus, role, 440));
        source = "primitive";
      }
    } else if (kind) {
      const row = weaponRow(kind, role);
      if (row) {
        voices.push(voice("weapon", row.text, bus, role, 440, { gain: row.gain }));
        source = "weapon";
      } else if (role === "immune") {
        voices.push(voice("match", FL_MATCH_SOUNDS.immune!, "hit", "immune", 440));
        source = "match";
      }
    } else if (role === "immune") {
      voices.push(voice("match", FL_MATCH_SOUNDS.immune!, "hit", "immune", 440));
      source = "match";
    }
  }
  if (!source) {
    if (ability && silentByDesign(prim!, role)) return silent(`${prim} ${role}: none by design`);
    // the tint alone (an intro-like cue of a division with a tint for it)
    const tint = s.set === "signature" ? tintOf(id, role, prim) : null;
    if (tint) return { source: "tint", voices: [{ ...tint, gain: 1 }] };
    return legacyOf(ev);
  }
  if (s.set === "signature" && source !== "clip") {
    const tint = tintOf(id, role, prim);
    if (tint) voices.push(tint);
  }
  // a double blade swings twice
  if (role === "swing" && ev.flStyle === "double" && voices[0]?.recipe) voices.push({ ...voices[0], delay: 0.06, gain: voices[0].gain * 0.7 });
  return { source, voices };
}

/** True when the cue resolved without the legacy fallback (or is silent by design). */
export function flResolved(r: FlResolution | null, s: FlSoundSettings = DEFAULT_FL_SOUND_SETTINGS): boolean {
  if (!r) return false;
  return s.set === "legacy" || r.source !== "legacy";
}
