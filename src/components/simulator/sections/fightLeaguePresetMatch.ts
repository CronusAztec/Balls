import type { SimulatorSettings } from "@/lib/settings";
import { FL_RANDOM, matchFighters, type FlMatch } from "@/lib/physics/modes/fightLeague";
import { FL_PRESETS, type FlPreset } from "@/lib/physics/modes/fightLeagueRoster";
import { flBestOfGames } from "@/lib/physics/modes/fightLeagueShow";

/*
 * --- fl-overhaul --- (Stage 5) The Fight League panel's preset maths (pure: the section, the gallery and the tests share it): which
 * preset the settings hold, and the settings patch of a preset – its match and fighters in slots A–F, a series' length, a bracket's
 * or a boss rush's entrants and size, and a rework's handicaps.
 */

/** The slot fields A–F. */
const SLOT_FIELDS = ["flFighterA", "flFighterB", "flFighterC", "flFighterD", "flFighterE", "flFighterF"] as const;
const SLOT_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
type Stat = "Speed" | "Damage" | "Attack" | "Cast";
const STAT_KEYS: readonly Stat[] = ["Speed", "Damage", "Attack", "Cast"];
const HANDICAP_OF: Readonly<Record<Stat, keyof NonNullable<FlPreset["handicaps"]>>> = { Speed: "speed", Damage: "damage", Attack: "attack", Cast: "cast" };
type StatField = `fl${Stat}${(typeof SLOT_LETTERS)[number]}`;

/** The slots the panel shows for a match type: its fighters, or six for a bracket (pinned entrants) and a boss rush (the boss, then pinned challengers). */
export function flPanelSlots(match: FlMatch): number {
  return match === "bracket" || match === "boss" ? 6 : matchFighters(match);
}

/** The slots a preset compares and sets: its match's fighters (a bracket's and a boss rush's six). */
function presetSlots(p: FlPreset): number {
  return flPanelSlots(p.match);
}

/** A rework's handicaps equal the settings' (every slot of its match; an absent value is 1). */
function handicapsMatch(p: FlPreset, s: SimulatorSettings): boolean {
  const n = presetSlots(p);
  for (const stat of STAT_KEYS) {
    const list = p.handicaps?.[HANDICAP_OF[stat]];
    for (let i = 0; i < n; i++) if (Math.abs(s[`fl${stat}${SLOT_LETTERS[i]}` as StatField] - (list?.[i] ?? 1)) > 1e-9) return false;
  }
  return true;
}

/** Whether the settings hold preset `p`: its match, fighters, series length, entrants and size (a rework: its handicaps too). */
function holds(p: FlPreset, s: SimulatorSettings): boolean {
  if (p.match !== s.flMatch) return false;
  const n = presetSlots(p);
  for (let i = 0; i < n; i++) if (s[SLOT_FIELDS[i]] !== (p.fighters[i] ?? FL_RANDOM)) return false;
  if (p.match !== "boss" && flBestOfGames(s.flBestOf) !== flBestOfGames(p.bestOf ?? 1)) return false;
  if (p.match === "bracket" && (s.flEntrants !== (p.entrants ?? "") || s.flBracketSize !== (p.size ?? s.flBracketSize))) return false;
  if (p.match === "boss" && (s.flEntrants !== (p.entrants ?? "") || s.flBossWaves !== (p.size ?? s.flBossWaves))) return false;
  if (p.format === "rework" && !handicapsMatch(p, s)) return false;
  return true;
}

/** The preset the settings hold (a rework whose handicaps match first), null: a custom matchup. */
export function flCurrentPreset(s: SimulatorSettings): FlPreset | null {
  return FL_PRESETS.find((p) => p.format === "rework" && holds(p, s)) ?? FL_PRESETS.find((p) => p.format !== "rework" && holds(p, s)) ?? null;
}

/**
 * The settings patch of preset `p`: its match and its fighters in slots A–F (random past them), the series length (1 unless it is
 * a series), a bracket's or a boss rush's entrants and size, and – for a rework, or leaving one – the handicaps (1 unless set).
 */
export function flPresetPatch(p: FlPreset, s: SimulatorSettings): Partial<SimulatorSettings> {
  const patch: Partial<SimulatorSettings> = { flMatch: p.match };
  for (let i = 0; i < SLOT_FIELDS.length; i++) patch[SLOT_FIELDS[i]] = p.fighters[i] ?? FL_RANDOM;
  patch.flBestOf = p.bestOf ?? 1;
  if (p.match === "bracket" || p.match === "boss") patch.flEntrants = p.entrants ?? "";
  if (p.match === "bracket" && p.size !== undefined) patch.flBracketSize = p.size;
  if (p.match === "boss" && p.size !== undefined) patch.flBossWaves = p.size;
  const leaving = flCurrentPreset(s)?.format === "rework";
  if (p.handicaps || leaving) {
    for (const stat of STAT_KEYS) {
      const list = p.handicaps?.[HANDICAP_OF[stat]];
      for (let i = 0; i < SLOT_LETTERS.length; i++) (patch as Record<string, number>)[`fl${stat}${SLOT_LETTERS[i]}`] = list?.[i] ?? 1;
    }
  }
  return patch;
}
