import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_FIGHT_LEAGUE_SETTINGS,
  EV_BLINK,
  EV_CUT,
  EV_DAMAGE,
  EV_LIGHTNING,
  EV_SHOCK,
  FIGHT_LEAGUE_RANGES,
  FIGHT_LEAGUE_URL_KEYS,
  FL_ARENA_FRAC,
  FL_ARENA_TOP,
  FL_EVENT_CAP,
  FL_HIT_CHARGE,
  FL_IFRAME_MS,
  FL_INTRO_MS,
  FL_KO_GRACE_MS,
  FL_SHIELD_ARC_DEG,
  FL_SOUND_OF_KIND,
  FL_TELEGRAPH_MS,
  FL_TAKEN_CHARGE,
  FL_WIN_HOLD_SEC,
  PK_ABILITY,
  bladeShape,
  buildFightField,
  capVerdict,
  chargeSeconds,
  circlesTouch,
  coneHitsCircle,
  fightForcedWinner,
  fightLeagueModeDefaults,
  fightLeagueSettingsOf,
  fistShape,
  flSideNames,
  giantDamage,
  headShape,
  matchFighters,
  matchTeams,
  meterAfter,
  pickFighters,
  punchExtension,
  rayToEdge,
  resolveFightLeagueFields,
  resolveFightLeagueSettings,
  rosterByDivision,
  segmentHitsCircle,
  shapeHitsCircle,
  shieldBlocks,
  slotTeam,
  type FightLeagueSettings,
  type FightLeagueView,
  // --- fl-overhaul ---
  EV_CAST,
  angleDiff,
  flPanelValue,
} from "@/lib/physics/modes/fightLeague";
import {
  FL_ABILITY_PRIMITIVES,
  FL_BY_ID,
  FL_DIVISIONS,
  FL_DIVISION_LABELS,
  FL_PRESETS,
  FL_ROSTER,
  FL_WEAPON_KINDS,
  weaponLabel,
  weaponOf,
  type FlAbility,
  type FlFighterRow,
} from "@/lib/physics/modes/fightLeagueRoster";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { RANGES, defaultSettings, engineSettingKeys, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, findSimulation, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { availableOutcomes, outcomeHorizonMs, outcomeMatches, outcomeMiss, type RunSummary } from "@/lib/simulation/outcomes";
import { BATTLE_WINNER_MODES, forcedWinnerApplies } from "@/lib/physics/rigged";
import { effectiveBallCount } from "@/lib/teams";
import { bounceTriggerApplies } from "@/lib/physics/bounceMathRuntime";
import { FIGHT_TONES, fightDucks, fightLevel, scheduleFightSound } from "@/lib/audio/fightTones";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playArenaSound, type ArenaSoundSink } from "@/lib/simulation/multi";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { DEFAULT_FIGHT_LEAGUE_LABELS, FIGHT_LEAGUE_DATA_KEYS, FightLeagueDataset, FightLeagueLayer, flNameColor } from "@/components/simulator/fightLeagueRenderer";
import { fakeGraph } from "./fakeAudio";
import { burstSpawnsBehind, dummyDuel, PROBE_INTRO_MS, PROBE_STEP, probeEngine, probeRun } from "./flProbes"; // --- fl-overhaul ---
import en from "../messages/en.json"; // --- fl-overhaul ---

/**
 * Fight League (feature fight-league): the roster and its divisions, the settings / URL / presets and the registration, the
 * rules (charge maths, the time cap's verdict, giant hits, the hit geometry of every weapon kind, shields), the engine's
 * fights (every weapon kind lands hits, the invulnerability window, the telegraph, every ability primitive's effect, 2v2
 * and free-for-all endings, double KOs, the time cap, the forced winner), exact replays at two frame rates, the finder's
 * outcomes, the sounds and their routing, the data attributes – and the BALANCE: per division a round robin of every pair
 * over 6 seeds, no fighter above 75 % or below 25 % of its division's matches.
 */

/** The 16:9 world every desktop frame runs (lib/simulation/world.ts). */
const WORLD = { width: 800, height: 450 };
const STEP = 1000 / 60;

function settingsFor(fl: Partial<FightLeagueSettings> = {}, extra: Partial<SimulatorSettings> = {}): { config: PhysicsConfig; modeSettings: ModeSettings } {
  const s = { ...defaultSettings("fightLeague"), ...extra };
  return {
    config: physicsConfigOfSettings(s, WORLD),
    modeSettings: { ...modeSettingsOfSettings(s), fightLeague: resolveFightLeagueSettings({ ...fightLeagueSettingsOf(s), ...fl }) },
  };
}

function fightEngine(fl: Partial<FightLeagueSettings> = {}, seed = 1, configPatch: Partial<PhysicsConfig> = {}): PhysicsEngine {
  const { config, modeSettings } = settingsFor(fl);
  return createEngineForSettings({ ...config, ...configPatch }, "fightLeague", modeSettings, seed);
}

/** Steps `engine` by `frameMs` frames until `untilMs` of simulation time or the fight's end; `each` runs after every frame. */
function run(engine: PhysicsEngine, untilMs: number, frameMs = STEP, each?: (v: FightLeagueView) => boolean | void): FightLeagueView {
  const v = engine.getFightLeagueView();
  while (engine.getElapsedMs() < untilMs - 1e-6 && !engine.isSimulationFinished()) {
    engine.update(frameMs, 0);
    engine.consumeSoundEvents();
    if (each && each(v) === true) break;
  }
  return v;
}

/** A 1v1 of `a` and `b` played to its end (the 60 s cap of the balance runs; --- fl-overhaul --- counted from FIGHT!, then sudden death). */
function duel(a: string, b: string, seed: number, fl: Partial<FightLeagueSettings> = {}) {
  const engine = fightEngine({ fighters: [a, b, "random", "random"], match: "1v1", timeCap: 60, ...fl }, seed);
  return run(engine, 100_000);
}

async function withFrames<T>(body: () => Promise<T>): Promise<T> {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  try {
    return await body();
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
}

/** New render events since `serial` (the ring of FL_EVENT_CAP). */
function eventsSince(v: FightLeagueView, serial: number) {
  const out: { kind: number; t: number; slot: number; value: number; x: number; y: number }[] = [];
  for (let s = Math.max(serial, v.eventSerial - FL_EVENT_CAP); s < v.eventSerial; s++) {
    const e = v.events[s % FL_EVENT_CAP];
    out.push({ kind: e.kind, t: e.t, slot: e.slot, value: e.value, x: e.x, y: e.y });
  }
  return out;
}

/* ------------------------------------------------------------------ the roster */

/** Every fighter the roster must have, by division (the owner's list). */
const EXPECTED: Record<string, string[]> = {
  marvel: ["Thor", "Loki", "Spider-Man", "Iron Man", "Captain America", "Hulk"],
  dc: ["Superman", "Batman", "Joker", "Wonder Woman"],
  nintendo: ["Mario", "Link", "Samus", "Captain Falcon", "Little Mac", "Sonic"],
  league: ["Yuumi", "Katarina", "Garen", "Jinx", "Ahri"],
  fighting: ["Ryu", "Ken", "Chun-Li", "Scorpion", "Sub-Zero"],
  legends: ["Master Chief", "Doom Slayer", "Kratos", "Steve", "Pikachu", "Charizard"],
  shonen: ["Goku", "Vegeta", "Naruto", "Sasuke", "Luffy", "Saitama"],
  starWars: ["Luke Skywalker", "Darth Vader", "Yoda", "Darth Maul"],
  fantasy: ["Harry Potter", "Voldemort", "Gandalf", "Legolas"],
  monsters: ["Godzilla", "King Kong", "Alien", "Predator"],
  action: ["John Wick", "Neo", "Terminator", "RoboCop"],
  tv: ["Homelander", "Omni-Man", "Aang", "Zuko", "Jon Snow", "Night King"],
  wildcard: ["Gerald"],
};

describe("fight league roster", () => {
  it("has every listed fighter in its division, each one data row with a weapon, stats, one ability and a description", () => {
    expect(FL_ROSTER).toHaveLength(61);
    for (const division of FL_DIVISIONS) expect(rosterByDivision().find((d) => d.division === division)!.fighters.map((r) => r.name)).toEqual(EXPECTED[division]);
    expect(new Set(FL_ROSTER.map((r) => r.id)).size).toBe(FL_ROSTER.length);
    for (const r of FL_ROSTER) {
      expect(r.id).toMatch(/^[a-z]+$/);
      expect(r.body).toMatch(/^#[0-9a-f]{6}$/i);
      expect(r.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(r.source.length).toBeGreaterThan(2);
      expect(r.weapons.length === 1 || r.weapons.length === 2).toBe(true);
      for (const w of r.weapons) expect(FL_WEAPON_KINDS).toContain(w.kind);
      expect(r.stats.hp).toBeGreaterThanOrEqual(90);
      expect(r.stats.hp).toBeLessThanOrEqual(130);
      for (const k of ["speed", "attackSpeed", "damage", "castSpeed", "size"] as const) expect(r.stats[k]).toBeGreaterThan(0);
      expect(r.ability.name.length).toBeGreaterThan(1);
      expect(r.ability.charge).toBeGreaterThan(0);
      expect(r.ability.effects.length === 1 || r.ability.effects.length === 2).toBe(true);
      for (const e of r.ability.effects) expect(FL_ABILITY_PRIMITIVES).toContain(e.p);
      expect(r.description.length).toBeGreaterThan(20);
    }
    expect(FL_BY_ID.get("thor")!.name).toBe("Thor");
    expect(Object.keys(FL_DIVISION_LABELS)).toEqual([...FL_DIVISIONS]);
  });

  it("uses every weapon kind and fills every weapon field from the kind's defaults", () => {
    for (const kind of FL_WEAPON_KINDS) expect([kind, FL_ROSTER.some((r) => r.weapons.some((w) => w.kind === kind))]).toEqual([kind, true]);
    const thor = weaponOf(FL_BY_ID.get("thor")!.weapons[0]);
    expect(thor).toMatchObject({ kind: "hammer", style: "returning" });
    expect(thor.cooldown).toBeGreaterThan(0);
    expect(weaponLabel(FL_BY_ID.get("ryu")!)).toBe("fists + gun");
    expect(weaponLabel(FL_BY_ID.get("thor")!)).toBe("returning hammer");
    for (const kind of FL_WEAPON_KINDS) expect(FL_SOUND_OF_KIND[kind]).toMatch(/^(blade|blunt|arrow|gun|fire|magic)$/);
  });

  it("offers in-genre presets (Thor vs Loki the default) and every fighter of a preset is in one division", () => {
    expect(FL_PRESETS.map((p) => p.label)).toEqual([
      "Thor vs Loki",
      "Captain Falcon vs Little Mac",
      "Yuumi vs Katarina",
      "Batman vs Joker",
      "Goku vs Vegeta",
      "Luke Skywalker vs Darth Vader",
      "Mario vs Sonic",
      "Harry Potter vs Voldemort",
      "Scorpion vs Sub-Zero",
      "Godzilla vs King Kong",
      "Alien vs Predator",
      "Homelander vs Omni-Man",
      "Avengers free-for-all",
      "2v2: Naruto + Sasuke vs Goku + Vegeta",
    ]);
    for (const p of FL_PRESETS) {
      expect(p.fighters).toHaveLength(matchFighters(p.match));
      const divisions = new Set(p.fighters.map((id) => FL_BY_ID.get(id)!.division));
      expect([p.id, divisions.size]).toEqual([p.id, 1]);
    }
    expect(DEFAULT_FIGHT_LEAGUE_SETTINGS.fighters.slice(0, 2)).toEqual(["thor", "loki"]);
    expect(FL_PRESETS.find((p) => p.id === "avengers")!.match).toBe("ffa4");
    expect(FL_PRESETS.find((p) => p.id === "naruto-dbz")!.match).toBe("2v2");
  });
});

/* ------------------------------------------------------------------ settings */

describe("fight league settings, URL and presets", () => {
  it("defaults to Thor vs Loki, 1v1, HP 100, a 90 s cap, the square arena and the HUD – no gravity in this mode only", () => {
    expect(DEFAULT_FIGHT_LEAGUE_SETTINGS).toMatchObject({ match: "1v1", sameDivision: true, hp: 100, timeCap: 90, arena: "square", hud: true });
    const s = defaultSettings("fightLeague");
    expect(s).toMatchObject({ flFighterA: "thor", flFighterB: "loki", flFighterC: "random", flFighterD: "random", flMatch: "1v1", flHp: 100, flTimeCap: 90, flArena: "square", flHud: true, gravity: 0, recordingDuration: 60 });
    expect(defaultSettings("classic").gravity).toBe(defaultSettings().gravity);
    expect(defaultSettings("battle").recordingDuration).toBe(defaultSettings().recordingDuration);
    expect(fightLeagueModeDefaults("classic")).toEqual({});
  });

  it("validates: known fighters and options, uncapped numbers from their minimum up", () => {
    const r = resolveFightLeagueSettings({ fighters: ["thor", "nobody", "random", "goku"], match: "ffa9" as never, hp: -5, timeCap: Number.NaN, speed: [0, 7.5, Number.NaN, 2], arena: "hex" as never, hud: "yes" as never });
    expect(r.fighters).toEqual(["thor", "loki", "random", "goku"]);
    expect(r.match).toBe("1v1");
    expect(r.hp).toBe(FIGHT_LEAGUE_RANGES.flHp.min);
    expect(r.timeCap).toBe(90);
    expect(r.speed).toEqual([0.05, 7.5, 1, 2]);
    expect(r.arena).toBe("square");
    expect(r.hud).toBe(true);
    expect(resolveFightLeagueSettings({ hp: 1e6, timeCap: 1e5 })).toMatchObject({ hp: 1e6, timeCap: 1e5 });
  });

  it("round-trips through the URL (fl1–fl4, flM, flDiv, flA, flH and the numbers) and writes nothing at the defaults", () => {
    const base = defaultSettings("fightLeague");
    const plain = settingsToSearchParams(base);
    for (const key of FIGHT_LEAGUE_URL_KEYS) expect([key, plain.has(key)]).toEqual([key, false]);
    const s: SimulatorSettings = { ...base, flFighterA: "goku", flFighterB: "random", flFighterC: "naruto", flFighterD: "sasuke", flMatch: "2v2", flSameDivision: false, flHp: 250, flTimeCap: 0, flArena: "circle", flHud: false, flSpeedA: 1.5, flDamageB: 0.25, flAttackC: 3.5, flCastD: 12 };
    const params = settingsToSearchParams(s);
    expect(params.get("mode")).toBe("fightLeague");
    expect(params.get("fl1")).toBe("goku");
    expect(params.get("flM")).toBe("2v2");
    expect(params.get("flDiv")).toBe("0");
    expect(params.get("flA")).toBe("circle");
    expect(params.get("flH")).toBe("0");
    expect(params.get("flT")).toBe("0");
    expect(params.get("flC4")).toBe("12");
    const back = settingsFromSearchParams(params);
    for (const key of ["flFighterA", "flFighterB", "flFighterC", "flFighterD", "flMatch", "flSameDivision", "flHp", "flTimeCap", "flArena", "flHud", "flSpeedA", "flDamageB", "flAttackC", "flCastD"] as const) expect([key, back[key]]).toEqual([key, s[key]]);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=fightLeague&fl1=nobody&flM=9v9&flHp=abc&flA=hex&flH=2"));
    expect(bad).toMatchObject({ flFighterA: "thor", flMatch: "1v1", flHp: 100, flArena: "square", flHud: true });
  });

  it("resolves presets and every fl field of a stored preset", () => {
    const p = presetToSettings({ mode: "fightLeague", flFighterA: "nobody", flMatch: "ffa4", flHp: -3 } as Partial<SimulatorSettings>);
    expect(p).toMatchObject({ flFighterA: "thor", flMatch: "ffa4", flHp: 1 });
    expect(resolveFightLeagueFields({ flArena: "circle" })).toMatchObject({ flArena: "circle", flFighterA: "thor" });
  });

  it("is registered: a mode id, a card after Capture the Flag in the arena games' family, engine keys, sides and the rig", () => {
    expect(MODE_IDS).toContain("fightLeague");
    expect(MODE_CARD_ORDER.indexOf("fightLeague")).toBe(MODE_CARD_ORDER.indexOf("ctf") + 1);
    expect(MODE_CATEGORIES.fightLeague).toBe(MODE_CATEGORIES.battle);
    expect(engineSettingKeys("fightLeague")).toEqual(expect.arrayContaining(["flHp", "flTimeCap", "flSpeedA", "flCastD", "ballSpeed"]));
    expect(engineSettingKeys("classic")).not.toContain("flHp");
    for (const [match, sides] of [["1v1", 2], ["2v2", 2], ["ffa3", 3], ["ffa4", 4]] as const) {
      expect(matchTeams(match)).toBe(sides);
      expect(effectiveBallCount({ ...defaultSettings("fightLeague"), flMatch: match })).toBe(sides);
    }
    expect([0, 1, 2, 3].map((i) => slotTeam("2v2", i))).toEqual([0, 0, 1, 1]);
    expect(BATTLE_WINNER_MODES).toContain("fightLeague");
    expect(forcedWinnerApplies("fightLeague", 2, 1)).toBe(true);
    expect(forcedWinnerApplies("fightLeague", 2, 2)).toBe(false);
    expect(availableOutcomes("fightLeague", { endless: false, neverEscape: false, ballCount: 2 })).toEqual(["duration", "winner", "double-ko"]);
    expect(availableOutcomes("classic", { endless: false, neverEscape: false, ballCount: 1 })).not.toContain("double-ko");
    expect(flSideNames("1v1", ["thor", "loki"])).toEqual(["A · Thor", "B · Loki"]);
    expect(flSideNames("2v2", ["naruto", "sasuke", "goku", "random"])).toEqual(["A+B · Naruto + Sasuke", "C+D · Goku + ?"]);
    expect(flSideNames("ffa3", ["thor", "random", "hulk"])).toEqual(["A · Thor", "B · ?", "C · Hulk"]);
    expect(bounceTriggerApplies("collide", "fightLeague")).toBe(true);
    expect(RANGES.flHp).toBe(FIGHT_LEAGUE_RANGES.flHp);
  });

  it("lays the arena out under the names' band, inset in the exported square", () => {
    const f = buildFightField(800, 450, "square");
    expect(f.side).toBeCloseTo(FL_ARENA_FRAC * 450, 9);
    expect(f.cx).toBe(400);
    expect(f.cy - f.half).toBeCloseTo(FL_ARENA_TOP * 450, 9);
    expect(f.cy + f.half).toBeLessThan(450);
    expect(buildFightField(450, 800, "circle")).toMatchObject({ kind: "circle", cx: 225 });
  });
});

/* ------------------------------------------------------------------ rules */

describe("fight league rules", () => {
  it("charges the meter from time (× cast speed) and from hits dealt and taken", () => {
    expect(meterAfter(0, 10, 1, 10)).toBeCloseTo(1, 12);
    expect(meterAfter(0, 5, 2, 10)).toBeCloseTo(1, 12);
    expect(meterAfter(0, 2.5, 1, 10)).toBeCloseTo(0.25, 12);
    expect(meterAfter(0.9, 10, 1, 10)).toBe(1);
    expect(chargeSeconds(1, 10)).toBeCloseTo(10, 12);
    expect(chargeSeconds(2, 10)).toBeCloseTo(5, 12);
    expect(FL_HIT_CHARGE).toBeGreaterThan(FL_TAKEN_CHARGE);
  });

  it("gives the time cap's verdict to the side with more HP left (teams add up; equal HP is a draw)", () => {
    expect(capVerdict([40, 60], [0, 1], 2)).toBe(1);
    expect(capVerdict([60, 40], [0, 1], 2)).toBe(0);
    expect(capVerdict([50, 50], [0, 1], 2)).toBe(-1);
    expect(capVerdict([10, 50, 30, 20], [0, 0, 1, 1], 2)).toBe(0);
    expect(capVerdict([0, 0, 70], [0, 1, 2], 3)).toBe(2);
  });

  it("multiplies giant hits (more under half HP; worth half the foe's maximum HP)", () => {
    expect(giantDamage(10, 3, 80, 100, 0, false)).toBe(30);
    expect(giantDamage(10, 2, 40, 100, 4, false)).toBe(40);
    expect(giantDamage(10, 2, 60, 100, 4, false)).toBe(20);
    expect(giantDamage(10, 3, 90, 100, 0, true)).toBeCloseTo(50, 9);
  });

  it("tests every weapon's hit geometry against the foe's circle: blades, heads, fists, cones, rays and shields", () => {
    // A blade from 0.85 R to (1 + reach) R along its angle.
    const blade = bladeShape(0, 0, 10, 0, 2, 0.2, { ax: 0, ay: 0, bx: 0, by: 0, half: 0 });
    expect(blade).toEqual({ ax: 8.5, ay: 0, bx: 30, by: 0, half: 1 });
    // (a hit within the circle's radius plus the blade's half thickness: the tip 10 px away, the flat 12 px away)
    expect(shapeHitsCircle(blade, 40, 0, 9.1)).toBe(true);
    expect(shapeHitsCircle(blade, 40, 0, 8.9)).toBe(false);
    expect(shapeHitsCircle(blade, 20, 12, 11.1)).toBe(true);
    expect(shapeHitsCircle(blade, 20, 12, 10.9)).toBe(false);
    // A head on a handle or a chain, and a fist: circles.
    const head = headShape(0, 0, 10, Math.PI / 2, 1.5, 0.5, { ax: 0, ay: 0, bx: 0, by: 0, half: 0 });
    expect(head.ax).toBeCloseTo(0, 9);
    expect(head.ay).toBeCloseTo(25, 9);
    expect(head.half).toBe(5);
    expect(shapeHitsCircle(head, 0, 38, 8.5)).toBe(true);
    expect(shapeHitsCircle(head, 0, 38, 7.5)).toBe(false);
    const rest = fistShape(0, 0, 10, 0, 1, 0.4, 0, { ax: 0, ay: 0, bx: 0, by: 0, half: 0 });
    const out = fistShape(0, 0, 10, 0, 1, 0.4, 1, { ax: 0, ay: 0, bx: 0, by: 0, half: 0 });
    expect(out.ax - rest.ax).toBeCloseTo(10, 9);
    expect(punchExtension(-0.01)).toBe(0);
    expect(punchExtension(0.07)).toBe(1);
    expect(punchExtension(0.09)).toBe(1);
    expect(punchExtension(0.5)).toBe(0);
    // A cone (fire): within its angle and range.
    expect(coneHitsCircle(0, 0, 0, Math.PI / 6, 50, 40, 0, 5)).toBe(true);
    expect(coneHitsCircle(0, 0, 0, Math.PI / 6, 50, 0, 40, 5)).toBe(false);
    expect(coneHitsCircle(0, 0, 0, Math.PI / 6, 50, 60, 0, 5)).toBe(false);
    expect(coneHitsCircle(0, 0, 0, Math.PI / 6, 50, 52, 0, 5)).toBe(true);
    // A segment (beams, cuts) and circles (projectiles, bodies).
    expect(segmentHitsCircle(0, 0, 100, 0, 2, 50, 6, 4.5)).toBe(true);
    expect(segmentHitsCircle(0, 0, 100, 0, 2, 50, 7, 4.5)).toBe(false);
    expect(circlesTouch(0, 0, 5, 9.9, 0, 5)).toBe(true);
    expect(circlesTouch(0, 0, 5, 10.1, 0, 5)).toBe(false);
    // A ray to the arena's edge (the beams): square and circle.
    const sq = buildFightField(800, 450, "square");
    expect(rayToEdge(sq, sq.cx, sq.cy, 1, 0)).toBeCloseTo(sq.half, 6);
    const ci = buildFightField(800, 450, "circle");
    expect(rayToEdge(ci, ci.cx, ci.cy, 0, 1)).toBeCloseTo(ci.half, 6);
    // A shield blocks hits from within ±FL_SHIELD_ARC_DEG of its facing.
    const arc = (FL_SHIELD_ARC_DEG * Math.PI) / 180;
    expect(shieldBlocks(0, arc - 0.01)).toBe(true);
    expect(shieldBlocks(0, -arc + 0.01)).toBe(true);
    expect(shieldBlocks(0, arc + 0.01)).toBe(false);
    expect(shieldBlocks(Math.PI, Math.PI)).toBe(true);
  });

  it("picks random slots by the seed – in the first chosen fighter's division, never a fighter twice while the pool allows", () => {
    let k = 0;
    const seq = [0.1, 0.5, 0.9, 0.3];
    const rnd = () => seq[k++ % seq.length];
    const rows = pickFighters({ fighters: ["luke", "random", "random", "random"], match: "ffa4", sameDivision: true }, rnd);
    expect(rows[0].id).toBe("luke");
    expect(rows.every((r) => r.division === "starWars")).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(4);
    k = 0;
    const again = pickFighters({ fighters: ["luke", "random", "random", "random"], match: "ffa4", sameDivision: true }, rnd);
    expect(again.map((r) => r.id)).toEqual(rows.map((r) => r.id));
    const all = pickFighters({ fighters: ["random", "random", "random", "random"], match: "1v1", sameDivision: true }, () => 0.42);
    expect(all).toHaveLength(2);
    expect(all[0].division).toBe(all[1].division);
    const free: FlFighterRow[] = [];
    for (let i = 0; i < 40; i++) free.push(...pickFighters({ fighters: ["luke", "random", "random", "random"], match: "1v1", sameDivision: false }, () => ((i * 37) % 61) / 61 + 0.001));
    expect(new Set(free.filter((r) => r.id !== "luke").map((r) => r.division)).size).toBeGreaterThan(3);
  });

  it("plays the forced winner only for a side in play", () => {
    expect(fightForcedWinner(1, 2)).toBe(1);
    expect(fightForcedWinner(2, 2)).toBe(-1);
    expect(fightForcedWinner(undefined, 4)).toBe(-1);
    expect(fightForcedWinner(-1, 4)).toBe(-1);
  });
});

/* ------------------------------------------------------------------ fights in the engine */

describe("fight league weapons in the engine", () => {
  it("lands hits with every weapon kind (its own hit geometry: blades, heads, fists, projectiles, cones, rays, arcs, throws)", () => {
    for (const kind of FL_WEAPON_KINDS) {
      const row = FL_ROSTER.find((r) => r.weapons.some((w) => w.kind === kind))!;
      const index = row.weapons.findIndex((w) => w.kind === kind);
      let hits = 0;
      // Against Gerald, abilities off (a cast speed of 0.05: the weapons alone), a few seeds.
      for (let seed = 1; seed <= 4 && hits === 0; seed++) {
        const engine = fightEngine({ fighters: [row.id, "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
        const v = run(engine, 25_000);
        hits = v.fighters[0].weapons[index].hits;
      }
      expect([kind, row.id, hits > 0]).toEqual([kind, row.id, true]);
    }
  });

  it("keeps a hit fighter invulnerable for FL_IFRAME_MS – one touch is one hit – except for the pellets of one volley", () => {
    for (const [a, b] of [["hulk", "wonderwoman"], ["link", "kingkong"], ["thor", "kratos"]]) {
      const engine = fightEngine({ fighters: [a, b, "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 400, timeCap: 0 }, 3);
      const v = engine.getFightLeagueView();
      let serial = 0;
      const last = [-Infinity, -Infinity];
      let damages = 0;
      run(engine, 30_000, STEP, () => {
        for (const e of eventsSince(v, serial)) {
          if (e.kind !== EV_DAMAGE) continue;
          damages++;
          expect(e.t - last[e.slot]).toBeGreaterThanOrEqual(FL_IFRAME_MS - 1e-6);
          last[e.slot] = e.t;
        }
        serial = v.eventSerial;
      });
      expect([a, b, damages > 5]).toEqual([a, b, true]);
    }
    // A shotgun's pellets share their volley: several land on the foe within the window.
    const engine = fightEngine({ fighters: ["doomslayer", "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 2);
    const v = engine.getFightLeagueView();
    let serial = 0;
    let lastT = -Infinity;
    let together = 0;
    run(engine, 30_000, STEP, () => {
      for (const e of eventsSince(v, serial)) {
        if (e.kind !== EV_DAMAGE || e.slot !== 1) continue;
        if (e.t - lastT < FL_IFRAME_MS) together++;
        lastT = e.t;
      }
      serial = v.eventSerial;
    });
    expect(together).toBeGreaterThan(0);
  });
});

describe("fight league abilities", () => {
  it("charges the meter faster with the cast speed and telegraphs every cast for FL_TELEGRAPH_MS", () => {
    const firstCast = (cast: number) => {
      const engine = fightEngine({ fighters: ["thor", "loki", "random", "random"], cast: [cast, 1, 1, 1], hp: 1000, timeCap: 0 }, 5);
      const v = engine.getFightLeagueView();
      let teleStart = -1;
      let castAt = -1;
      run(engine, 40_000, STEP, () => {
        const f = v.fighters[0];
        if (teleStart < 0 && f.telegraphUntil >= 0) teleStart = v.timeMs;
        if (f.casts > 0) {
          castAt = v.timeMs;
          return true;
        }
      });
      return { teleStart, castAt };
    };
    const slow = firstCast(1);
    const fast = firstCast(2);
    expect(slow.castAt).toBeGreaterThan(FL_INTRO_MS);
    expect(fast.castAt).toBeLessThan(slow.castAt);
    // The meter fills in at most the charge time (hits only add to it): 10 s at cast speed 1.
    expect(slow.castAt).toBeLessThanOrEqual(FL_INTRO_MS + 1000 * chargeSeconds(1, FL_BY_ID.get("thor")!.ability.charge) + FL_TELEGRAPH_MS + 2 * STEP);
    // (the telegraph's end is checked at the 60 Hz step: within a step of FL_TELEGRAPH_MS)
    for (const r of [slow, fast]) {
      expect(r.castAt - r.teleStart).toBeGreaterThanOrEqual(FL_TELEGRAPH_MS - 1e-6);
      expect(r.castAt - r.teleStart).toBeLessThanOrEqual(FL_TELEGRAPH_MS + STEP + 1e-6);
    }
  });

  /**
   * Plays `id` (cast speed ×40: the meter fills right after the intro) against `foe` until its first cast and returns the view
   * right after it, with the events since the start.
   */
  function firstCast(id: string, foe = "gerald", seed = 4, fl: Partial<FightLeagueSettings> = {}) {
    const engine = fightEngine({ fighters: [id, foe, "random", "random"], cast: [40, 0.05, 1, 1], hp: 1000, timeCap: 0, ...fl }, seed);
    const v = engine.getFightLeagueView();
    run(engine, 20_000, STEP, () => v.fighters[0].casts > 0);
    expect([id, v.fighters[0].casts]).toEqual([id, 1]);
    return { engine, v, f: v.fighters[0], foe: v.fighters[1], now: v.timeMs, events: eventsSince(v, 0) };
  }

  /** Swaps Gerald's ability for one primitive while `body` runs (the two primitives no fighter's row uses alone). */
  function withGeraldAbility(ability: FlAbility, body: () => void) {
    const row = FL_BY_ID.get("gerald")! as { ability: FlAbility };
    const saved = row.ability;
    row.ability = ability;
    try {
      body();
    } finally {
      row.ability = saved;
    }
  }

  it("fires every primitive's effect", () => {
    const seen = new Set<string>();
    const mark = (...p: string[]) => p.forEach((x) => seen.add(x));
    {
      const { f, now } = firstCast("gerald");
      expect(f.speedMulUntil).toBeGreaterThan(now);
      expect(f.speedMul).toBe(2);
      expect(f.dmgMulUntil).toBeGreaterThan(now);
      mark("speedBurst", "damageBurst");
    }
    {
      const { f, now } = firstCast("luffy");
      expect(f.atkMulUntil).toBeGreaterThan(now);
      expect(f.atkMul).toBe(4);
      mark("attackSpeedBurst");
    }
    {
      const { f, now } = firstCast("predator");
      expect(f.invulnUntil).toBeGreaterThan(now);
      expect(f.untargetableUntil).toBeGreaterThan(now);
      mark("invulnerable");
    }
    {
      const { f, now } = firstCast("mario");
      expect(f.contactUntil).toBeGreaterThan(now);
      expect(f.contactDamage).toBeGreaterThan(0);
    }
    withGeraldAbility({ name: "Deep Freeze", charge: 5, effects: [{ p: "freezeAll", dur: 1.5 }] }, () => {
      const { foe, now } = firstCast("gerald", "thor");
      expect(foe.frozenUntil).toBeGreaterThan(now + 1000);
      mark("freezeAll");
    });
    {
      const { f, foe, now } = firstCast("vader");
      expect(foe.heldBy).toBe(f.slot);
      expect(foe.heldUntil).toBeGreaterThan(now);
      mark("choke");
    }
    withGeraldAbility({ name: "Rend", charge: 5, effects: [{ p: "arenaCuts", n: 3, damage: 5 }] }, () => {
      const { engine, v } = firstCast("gerald", "thor");
      expect(v.tasks.filter((t) => t.active && t.kind === "cut")).toHaveLength(3);
      const serial = v.eventSerial;
      run(engine, v.timeMs + 1500);
      expect(eventsSince(v, serial).filter((e) => e.kind === EV_CUT).length).toBeGreaterThanOrEqual(3);
      mark("arenaCuts");
    });
    {
      const { v, f } = firstCast("ironman");
      expect(v.beams.some((b) => b.active && b.ability && b.owner === f.slot)).toBe(true);
      mark("beam");
    }
    {
      const { v } = firstCast("legolas");
      expect(v.projectiles.filter((p) => p.active && p.kind === PK_ABILITY).length).toBeGreaterThan(6);
      mark("volley");
    }
    {
      const { events, f } = firstCast("hulk");
      expect(events.some((e) => e.kind === EV_SHOCK && e.slot === f.slot)).toBe(true);
      mark("shockwave");
    }
    {
      const { f, foe, now } = firstCast("wonderwoman");
      expect(foe.pullBy).toBe(f.slot);
      expect(foe.pullUntil).toBeGreaterThan(now);
      mark("pull");
    }
    {
      const { v, f } = firstCast("loki");
      expect(v.minions.filter((m) => m.active && !m.summon && m.owner === f.slot)).toHaveLength(2);
      mark("decoys");
    }
    {
      const { engine, f, now } = firstCast("kratos");
      expect(f.healUntil).toBeGreaterThan(now);
      f.hp = 500;
      run(engine, now + 1000);
      expect(f.hp).toBeGreaterThan(500);
      mark("heal");
    }
    {
      const { f, now } = firstCast("charizard");
      expect(f.fireRingUntil).toBeGreaterThan(now);
      expect(f.fireRingRadius).toBeGreaterThan(f.r);
      mark("fireRing");
    }
    {
      const { f } = firstCast("captainfalcon");
      expect(f.giantLeft).toBe(1);
      expect(f.giantMult).toBe(5);
      mark("giantHit");
    }
    {
      const { events, foe } = firstCast("thor", "loki");
      expect(events.filter((e) => e.kind === EV_LIGHTNING)).toHaveLength(1);
      expect(foe.hp).toBeLessThan(foe.maxHp);
      mark("lightning");
    }
    {
      const { foe, now } = firstCast("joker");
      expect(foe.confusedUntil).toBeGreaterThan(now);
      mark("confuse");
    }
    {
      const { engine, v, events } = firstCast("sasuke");
      expect(events.some((e) => e.kind === EV_BLINK)).toBe(true);
      const serial = v.eventSerial;
      run(engine, v.timeMs + 2000);
      expect(eventsSince(v, serial).filter((e) => e.kind === EV_BLINK).length).toBeGreaterThanOrEqual(2);
      mark("blinkStrike");
    }
    {
      const { v, f } = firstCast("naruto");
      expect(v.minions.filter((m) => m.active && m.summon && m.owner === f.slot)).toHaveLength(2);
      mark("summon");
    }
    {
      const { f, now } = firstCast("alien");
      expect(f.reflectUntil).toBeGreaterThan(now);
      expect(f.reflectFrac).toBeGreaterThan(0);
      mark("reflect");
    }
    {
      const { foe, now } = firstCast("harrypotter");
      expect(foe.disarmedUntil).toBeGreaterThan(now + 2000);
      mark("disarm");
    }
    {
      const { v, f, now } = firstCast("neo");
      expect(v.slowTimeUntil).toBeGreaterThan(now);
      expect(v.slowTimeTeam).toBe(f.team);
      expect(v.slowTimeFactor).toBeLessThan(1);
      mark("slowTime");
    }
    expect([...seen].sort()).toEqual([...FL_ABILITY_PRIMITIVES].sort());
  });
});

describe("fight league endings", () => {
  it("ends a 1v1 with a KO: the winner, the fighters, the counters", () => {
    const v = duel("thor", "loki", 11);
    expect(v.finished).toBe(true);
    expect(v.byTime).toBe(false);
    expect(v.winnerTeam === 0 || v.winnerTeam === 1).toBe(true);
    const loser = v.fighters[1 - v.winnerTeam];
    expect(loser.alive).toBe(false);
    expect(loser.hp).toBe(0);
    expect(v.fighters[v.winnerTeam].alive).toBe(true);
    expect(v.kos).toBe(1);
    expect(v.hits).toBeGreaterThan(3);
    expect(v.fighters.reduce((n, f) => n + f.casts, 0)).toBeGreaterThan(0);
  });

  it("decides at the time cap: more HP wins, equal HP is a draw", () => {
    // --- fl-overhaul --- the cap counts from FIGHT! (the VS card left out); sudden death off: the plain verdict at the cap
    const engine = fightEngine({ fighters: ["thor", "loki", "random", "random"], hp: 1000, timeCap: 6, suddenDeath: false }, 3);
    const v = run(engine, 20_000);
    expect(v.finished).toBe(true);
    expect(v.byTime).toBe(true);
    expect(v.finishMs).toBeCloseTo(FL_INTRO_MS + 6000, -2);
    expect(v.winnerTeam).toBe(capVerdict(v.fighters.map((f) => f.hp), v.fighters.map((f) => f.team), 2, undefined, v.fighters.map((f) => f.maxHp)));
    const [fa, fb] = v.fighters.map((f) => f.hp / f.maxHp);
    expect(Math.abs(fa - fb)).toBeGreaterThan(0.005); // (no near-draw on this seed: the shares decide)
    expect(v.winnerTeam).toBe(fa > fb ? 0 : 1);
    // Nobody hit by the cap (both too slow to attack or cast before it): a draw.
    const draw = run(fightEngine({ fighters: ["thor", "loki", "random", "random"], timeCap: 1, suddenDeath: false, speed: [0.05, 0.05, 1, 1], attack: [0.05, 0.05, 1, 1], cast: [0.05, 0.05, 1, 1] }, 3), 5000);
    expect(draw).toMatchObject({ finished: true, byTime: true, winnerTeam: -1, doubleKo: false });
    expect(draw.finishMs).toBeCloseTo(FL_INTRO_MS + 1000, -2);
  });

  it("plays 2v2 as teams (no friendly fire) to the last team standing", () => {
    for (const seed of [1, 2, 3]) {
      const engine = fightEngine({ fighters: ["naruto", "sasuke", "goku", "vegeta"], match: "2v2", timeCap: 0 }, seed);
      const v = engine.getFightLeagueView();
      const taken = [0, 0, 0, 0];
      run(engine, 120_000, STEP, () => {
        for (const f of v.fighters) {
          if (f.taken > taken[f.slot]) {
            expect(v.fighters[f.lastHitBy].team).not.toBe(f.team);
            taken[f.slot] = f.taken;
          }
        }
      });
      expect(v.finished).toBe(true);
      expect(v.teamCount).toBe(2);
      if (v.doubleKo) continue;
      expect(v.winnerTeam === 0 || v.winnerTeam === 1).toBe(true);
      expect(v.fighters.filter((f) => f.team !== v.winnerTeam).every((f) => !f.alive)).toBe(true);
      expect(v.fighters.some((f) => f.team === v.winnerTeam && f.alive)).toBe(true);
    }
  });

  it("plays a free-for-all of three or four to the last fighter standing", () => {
    for (const [match, fighters] of [
      ["ffa4", ["thor", "ironman", "captainamerica", "hulk"]],
      ["ffa3", ["luke", "vader", "yoda", "random"]],
    ] as const) {
      const engine = fightEngine({ fighters: [...fighters], match, timeCap: 0 }, 6);
      const v = run(engine, 150_000);
      expect([match, v.finished]).toEqual([match, true]);
      expect(v.fighters).toHaveLength(matchFighters(match));
      if (v.doubleKo) continue;
      expect(v.kos).toBe(v.fighters.length - 1);
      expect(v.fighters.filter((f) => f.alive)).toHaveLength(1);
      expect(v.fighters[v.winnerTeam].alive).toBe(true);
    }
  });

  it("can end in a double KO: the last two sides down in the same step (a shot in the air gets FL_KO_GRACE_MS to land)", () => {
    let found: FightLeagueView | null = null;
    for (let seed = 1; seed <= 400 && !found; seed++) {
      const v = duel("thor", "thor", seed);
      if (v.doubleKo) found = v;
    }
    expect(found).not.toBeNull();
    expect(found!).toMatchObject({ finished: true, winnerTeam: -1, doubleKo: true });
    expect(found!.fighters.every((f) => !f.alive)).toBe(true);
    expect(FL_KO_GRACE_MS).toBeGreaterThan(0);
  });
});

describe("fight league forced winner", () => {
  it("rigs the fight within the replay: the chosen side wins every seed (1v1, 2v2, a free-for-all)", () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const v = run(fightEngine({ fighters: ["saitama", "goku", "random", "random"], timeCap: 60 }, seed, { forcedWinner: 0 }), 70_000);
      expect([seed, v.forcedWinner, v.winnerTeam]).toEqual([seed, 0, 0]);
      const w = run(fightEngine({ fighters: ["saitama", "goku", "random", "random"], timeCap: 60 }, seed, { forcedWinner: 1 }), 70_000);
      expect([seed, w.winnerTeam]).toEqual([seed, 1]);
    }
    const team = run(fightEngine({ fighters: ["naruto", "sasuke", "goku", "vegeta"], match: "2v2", timeCap: 60 }, 2, { forcedWinner: 1 }), 70_000);
    expect(team.winnerTeam).toBe(1);
    const ffa = run(fightEngine({ fighters: ["thor", "ironman", "captainamerica", "hulk"], match: "ffa4", timeCap: 60 }, 2, { forcedWinner: 2 }), 70_000);
    expect(ffa.winnerTeam).toBe(2);
  });

  it("replays a rigged seed exactly and leaves an unrigged fight as it was", () => {
    const a = run(fightEngine({ fighters: ["vader", "luke", "random", "random"] }, 9, { forcedWinner: 1 }), 70_000);
    const b = run(fightEngine({ fighters: ["vader", "luke", "random", "random"] }, 9, { forcedWinner: 1 }), 70_000);
    expect([a.finishMs, a.hits, a.winnerTeam]).toEqual([b.finishMs, b.hits, b.winnerTeam]);
    const plain = run(fightEngine({ fighters: ["vader", "luke", "random", "random"] }, 9), 70_000);
    const off = run(fightEngine({ fighters: ["vader", "luke", "random", "random"] }, 9, { forcedWinner: -1 }), 70_000);
    expect([off.finishMs, off.hits, off.winnerTeam, off.forcedWinner]).toEqual([plain.finishMs, plain.hits, plain.winnerTeam, -1]);
  });

  it("holds against Acid Blood: the chosen side wins every seed against a reflecting Alien, both sides (no double KO)", () => {
    // (with Predator or Gerald chosen, most of these were lost or ended in a double KO while reflected damage bypassed the backstop)
    for (const [a, b] of [["predator", "alien"], ["gerald", "alien"]]) {
      for (let seed = 1; seed <= 12; seed++) {
        for (const forced of [0, 1]) {
          const v = run(fightEngine({ fighters: [a, b, "random", "random"], timeCap: 60 }, seed, { forcedWinner: forced }), 70_000);
          expect([a, b, seed, forced, v.finished, v.winnerTeam, v.doubleKo]).toEqual([a, b, seed, forced, true, forced, false]);
          expect([a, b, seed, forced, v.fighters[forced].alive && v.fighters[forced].hp > 0]).toEqual([a, b, seed, forced, true]);
        }
      }
    }
  });

  it("never ends a rigged fight in a double KO: the backstop holds until the verdict (rivals down in the same step, a shot in the KO grace)", { timeout: 60_000 }, () => {
    // Seeds that ended in a DOUBLE KO while the backstop held only as long as a rival had HP left.
    const cases: [string, string, number, number][] = [
      ["loki", "spiderman", 3, 0],
      ["batman", "wonderwoman", 8, 1],
      ["littlemac", "sonic", 8, 0],
      ["garen", "jinx", 8, 0],
      ["ken", "chunli", 8, 1],
      ["ken", "subzero", 3, 0],
      ["masterchief", "doomslayer", 3, 1],
      ["masterchief", "charizard", 8, 1],
      ["goku", "luffy", 8, 1],
      ["sasuke", "saitama", 3, 0],
      ["sasuke", "saitama", 8, 0],
      ["voldemort", "gandalf", 8, 0],
      ["godzilla", "predator", 8, 0],
    ];
    // --- fl-overhaul --- under the overhaul's rules these seeds no longer all need the backstop (it is counted below)
    let absorbed = 0;
    for (const [a, b, seed, forced] of cases) {
      const v = run(fightEngine({ fighters: [a, b, "random", "random"], timeCap: 60 }, seed, { forcedWinner: forced }), 70_000);
      expect([a, b, seed, v.finished, v.doubleKo, v.winnerTeam]).toEqual([a, b, seed, true, false, forced]);
      expect([a, b, seed, v.fighters[forced].alive, v.fighters[forced].hp > 0, v.fighters[1 - forced].alive]).toEqual([a, b, seed, true, true, false]);
      if (v.rigAbsorbed > 0) absorbed++;
    }
    // --- fl-overhaul --- and the mirror matches that end in a DOUBLE KO unrigged today: rigged either way, the chosen side wins.
    const doubles: [string, number][] = [];
    for (const id of ["loki", "spiderman", "captainamerica", "batman", "samus", "katarina", "ahri", "alien", "predator", "johnwick", "terminator"]) {
      for (let seed = 1; seed <= 8; seed++) if (duel(id, id, seed).doubleKo) doubles.push([id, seed]);
    }
    expect(doubles.length).toBeGreaterThanOrEqual(3);
    for (const [id, seed] of doubles) {
      for (const forced of [0, 1]) {
        const v = run(fightEngine({ fighters: [id, id, "random", "random"], match: "1v1", timeCap: 60 }, seed, { forcedWinner: forced }), 200_000);
        expect([id, seed, forced, v.finished, v.doubleKo, v.winnerTeam, v.fighters[forced].alive, v.fighters[forced].hp > 0]).toEqual([id, seed, forced, true, false, forced, true, true]);
        if (v.rigAbsorbed > 0) absorbed++;
      }
    }
    expect(absorbed).toBeGreaterThan(0);
  });

  it("guards reflected damage like a hit: none while the attacker is invulnerable, and the rig's backstop holds against it", () => {
    /** Gerald at 2 HP punches an Alien that deals no damage and reflects ten times every hit, until three hits land or he drops. */
    const punchAcid = (forcedWinner: number, invulnerable: boolean) => {
      const engine = fightEngine({ fighters: ["alien", "gerald", "random", "random"], cast: [40, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 4, { forcedWinner });
      const v = engine.getFightLeagueView();
      run(engine, 20_000, STEP, () => v.fighters[0].casts > 0);
      const [alien, gerald] = v.fighters;
      expect(alien.reflectUntil).toBeGreaterThan(v.timeMs); // (Acid Blood is on)
      alien.reflectUntil = Infinity;
      alien.reflectFrac = 10;
      alien.damage = 0;
      alien.cast = 0;
      gerald.hp = 2;
      if (invulnerable) gerald.invulnUntil = Infinity;
      const taken = alien.taken;
      const absorbed = v.rigAbsorbed;
      run(engine, v.timeMs + 30_000, STEP, () => alien.taken >= taken + 3 || !gerald.alive);
      return { v, gerald, hits: alien.taken - taken, absorbed: v.rigAbsorbed - absorbed };
    };
    // Unrigged, the first reflected punch takes Gerald's last 2 HP: the Alien wins.
    const plain = punchAcid(-1, false);
    expect([plain.hits, plain.gerald.alive, plain.v.winnerTeam]).toEqual([1, false, 0]);
    // Invulnerable (Cloak, Super Star, Smoke Bomb …), he takes nothing back.
    const cloaked = punchAcid(-1, true);
    expect([cloaked.hits, cloaked.gerald.alive, cloaked.gerald.hp]).toEqual([3, true, 2]);
    // Rigged for Gerald, the backstop keeps his last hit point against every reflected punch.
    const rigged = punchAcid(1, false);
    expect([rigged.hits, rigged.gerald.alive, rigged.gerald.hp, rigged.absorbed]).toEqual([3, true, 1, 3]);
  });

  it("keeps the chosen side standing at a step's end whatever took its last hit point (the guard before the KOs)", () => {
    for (const forcedWinner of [-1, 0]) {
      const engine = fightEngine({ fighters: ["thor", "loki", "random", "random"], timeCap: 60 }, 5, { forcedWinner });
      const v = engine.getFightLeagueView();
      run(engine, 4000);
      const thor = v.fighters[0];
      expect(thor.alive).toBe(true);
      const absorbed = v.rigAbsorbed;
      thor.hp = -5; // (no hit took it: hit() and its backstop never saw it)
      engine.update(STEP, 0);
      if (forcedWinner < 0) {
        expect([thor.alive, thor.hp]).toEqual([false, 0]);
        const end = run(engine, 70_000);
        expect([end.finished, end.winnerTeam, end.doubleKo]).toEqual([true, 1, false]);
      } else {
        expect([thor.alive, thor.hp, v.rigAbsorbed]).toEqual([true, 1, absorbed + 1]);
        const end = run(engine, 70_000);
        expect([end.finished, end.winnerTeam, end.doubleKo]).toEqual([true, 0, false]);
      }
    }
  });
});

/** A fingerprint of a fight's state: positions, HP, hits and casts of every fighter and the counters (the sounds left out). */
function fingerprint(v: FightLeagueView): string {
  let h = 2166136261;
  const mix = (n: number) => {
    const s = Number.isFinite(n) ? n.toFixed(6) : String(n);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  };
  for (const f of v.fighters) [f.x, f.y, f.vx, f.vy, f.hp, f.hits, f.casts, f.meter].forEach(mix);
  [v.hits, v.casts, v.kos, v.shots, v.clashes, v.wallHits, v.blocks, v.winnerTeam, v.finishMs].forEach(mix);
  return h.toString(16).padStart(8, "0");
}

describe("fight league replays", () => {
  /** Golden fingerprints of Thor vs Loki at 18 s (seeds 7, 42, 1234): a change of the rules shows here. */
  const GOLDEN: Record<number, string> = { 7: "4ba46054", 42: "c93e9204", 1234: "6dc67129" };

  /** --- fl-overhaul --- Steps whole frames to `untilMs` of simulation time, past the fight's end (the fighters stand frozen). */
  const runTo = (engine: PhysicsEngine, untilMs: number, frameMs: number): FightLeagueView => {
    while (engine.getElapsedMs() < untilMs - 1e-6) {
      engine.update(frameMs, 0);
      engine.consumeSoundEvents();
    }
    return engine.getFightLeagueView();
  };

  it("replays a seed exactly at 60, 144 and 30 fps (the fixed step) – three seeds", () => {
    for (const seed of [7, 42, 1234]) {
      const prints = [STEP, 1000 / 144, 1000 / 30].map((frame) => fingerprint(runTo(fightEngine({}, seed), 18_000, frame)));
      expect(new Set(prints).size).toBe(1);
      expect([seed, prints[0]]).toEqual([seed, GOLDEN[seed]]);
    }
  });
});

describe("fight league finder", () => {
  const request = (patch: Partial<FinderRequest> = {}): FinderRequest => {
    const { config, modeSettings } = settingsFor({ fighters: ["thor", "loki", "random", "random"] });
    return { targetDurationSec: 20, toleranceSec: 1, maxSeeds: 60, maxSimTimeSec: 90, physicsConfig: config, mode: "fightLeague", modeSettings, ...patch };
  };

  it("finds a run B wins (and replays it), a fight of a chosen length, a double KO", { timeout: 60_000 }, async () => {
    const outcome = { kind: "winner" as const, clipSec: 30, team: 1 };
    const found = await withFrames(() => findSimulation(request({ outcome }), () => undefined));
    expect(found.found).toBe(true);
    const replay = run(fightEngine({ fighters: ["thor", "loki", "random", "random"] }, found.seed), 100_000);
    expect(replay.winnerTeam).toBe(1);
    expect(found.duration).toBeCloseTo(replay.finishMs / 1000, 1);
    // --- fl-overhaul --- (the fights engage at once now: Thor vs Loki takes about 9–18 s, so the chosen length is 14 s)
    const length = await withFrames(() => findSimulation(request({ targetDurationSec: 14 }), () => undefined));
    expect(length.found).toBe(true);
    expect(Math.abs(length.duration - 14)).toBeLessThanOrEqual(1);
    // --- fl-overhaul --- (a mirror ends in a double KO far more rarely now: the search may go deeper)
    const mirror = { ...request(), modeSettings: settingsFor({ fighters: ["thor", "thor", "random", "random"] }).modeSettings, maxSeeds: 1500 };
    const dko = await withFrames(() => findSimulation({ ...mirror, outcome: { kind: "double-ko", clipSec: 30 } }, () => undefined));
    expect(dko.found).toBe(true);
    const twice = run(fightEngine({ fighters: ["thor", "thor", "random", "random"] }, dko.seed), 100_000);
    expect(twice.doubleKo).toBe(true);
  });

  it("judges the double-KO outcome on the run's end", () => {
    const base: RunSummary = { mode: "fightLeague", durationMs: 20_000, finished: true, firstEscapeMs: -1, teams: [] };
    const outcome = { kind: "double-ko" as const, clipSec: 30 };
    expect(outcomeMatches(outcome, { ...base, doubleKo: true })).toBe(true);
    expect(outcomeMatches(outcome, { ...base, doubleKo: false })).toBe(false);
    expect(outcomeMatches(outcome, { ...base, finished: false, doubleKo: true })).toBe(false);
    expect(outcomeMiss(outcome, { ...base, doubleKo: true })).toBe(0);
    expect(outcomeHorizonMs(outcome, 90_000, "fightLeague")).toBe(90_000);
    const sim = simulateOutcomeRun(3, request(), { kind: "winner", clipSec: 30, team: 0 });
    expect(sim.finished).toBe(true);
    expect(sim.teams).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ sounds */

describe("fight league sounds", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("plays every weapon hit as its kind's effect, an ability's swell and a KO", () => {
    const engine = fightEngine({ fighters: ["thor", "loki", "random", "random"] }, 11);
    const kinds = new Set<string>();
    let notes = 0;
    while (!engine.isSimulationFinished() && engine.getElapsedMs() < 70_000) {
      engine.update(STEP, 0);
      for (const ev of engine.consumeSoundEvents() as SoundEvent[]) {
        if (ev.fight) kinds.add(ev.fight);
        else if (ev.type === "hit" && !ev.chord) notes++;
      }
    }
    expect([...kinds]).toEqual(expect.arrayContaining(["blunt", "blade", "ability", "ko"]));
    expect(notes).toBeGreaterThan(0);
  });

  it("synthesises every kind and routes it on the page, in the fast export and in the other arenas", () => {
    const graph = fakeGraph();
    const ramp = (value = 0) => ({ value, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined });
    (graph.ctx as unknown as Record<string, unknown>).createBiquadFilter = () => ({ type: "lowpass", frequency: ramp(), Q: ramp(), connect: () => undefined, disconnect: () => undefined });
    const noise = graph.ctx.createBuffer(1, 4800, 48000);
    for (const kind of Object.keys(FIGHT_TONES) as (keyof typeof FIGHT_TONES)[]) {
      const before = graph.oscillators.length + graph.sources.length;
      scheduleFightSound(graph.ctx as unknown as BaseAudioContext, graph.ctx.destination as AudioNode, kind, 440, 0, noise as unknown as AudioBuffer, 0.8);
      expect([kind, graph.oscillators.length + graph.sources.length > before]).toEqual([kind, true]);
    }
    expect(fightLevel(2)).toBe(1);
    expect(fightLevel(Number.NaN)).toBe(1);
    expect(fightDucks("ko")).toBe(true);
    expect(fightDucks("magic")).toBe(false);
    const played: unknown[] = [];
    const sink = { playFight: (...a: unknown[]) => played.push(a) } as unknown as ArenaSoundSink;
    playArenaSound(sink, { type: "hit", wallIndex: 0, frequency: 300, level: 1, fight: "blade" });
    expect(played).toHaveLength(1);
    const audio = { playFight: vi.fn() } as unknown as ToneGenerator;
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 300, level: 0.5, fight: "gun" }, () => undefined);
    expect((audio as unknown as { playFight: ReturnType<typeof vi.fn> }).playFight).toHaveBeenCalledWith("gun", 300, 0.5);
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    const count = graph.oscillators.length;
    tone.playFight("magic", 523.25, 1);
    expect(graph.oscillators.length).toBeGreaterThan(count);
  });
});

/* ------------------------------------------------------------------ data attributes */

describe("fight league data attributes", () => {
  it("mirrors names, HP, hits, casts, the winner and the end (data-fl-*)", () => {
    const v = duel("thor", "loki", 11);
    const data: Record<string, string> = {};
    new FightLeagueDataset().write(v, new FightLeagueLayer(), (k, val) => (data[k] = val));
    for (const key of FIGHT_LEAGUE_DATA_KEYS) expect([key, key in data]).toEqual([key, true]);
    expect(data.flNames).toBe("Thor,Loki");
    expect(data.flFinished).toBe("1");
    expect(data.flWinner).toBe(v.fighters[v.winnerTeam].row.name);
    expect(data.flHp.split(",")).toHaveLength(2);
    expect(data.flHits.split(",").map(Number).reduce((a, b) => a + b, 0)).toBe(v.hits);
    expect(data.flCasts.split(",").map(Number).reduce((a, b) => a + b, 0)).toBe(v.casts);
    expect(flNameColor("#111111", "#facc15")).toBe("#facc15");
    expect(flNameColor("#c9ced8", "#c1121f")).toBe("#c9ced8");
    expect(DEFAULT_FIGHT_LEAGUE_LABELS.wins("Thor")).toBe("Thor wins!");
    expect(FL_WIN_HOLD_SEC).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ balance */

/** The balance runs: per division every pair over these seeds, the sides swapped every other seed (a draw is half a win). */
const BALANCE_SEEDS = [1, 2, 3, 4, 5, 6].map((s) => ({ seed: 1000 + s * 7919, swap: s % 2 === 0 }));

/** --- fl-overhaul --- The arenas the round robin is played in (QA finding 2: the circle has its own gate). */
const BALANCE_ARENAS = ["square", "circle"] as const;

describe("fight league balance (per division round robin, 6 seeds, 60 s cap)", () => {
  for (const arena of BALANCE_ARENAS) for (const division of FL_DIVISIONS) {
    const rows = FL_ROSTER.filter((r) => r.division === division);
    if (rows.length < 2) continue;
    it(`keeps every ${FL_DIVISION_LABELS[division]} fighter between 25 % and 75 % of its matches${arena === "circle" ? " (in the circle)" : ""}`, { timeout: 60_000 }, () => {
      const wins = new Map<string, number>();
      const games = new Map<string, number>();
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          for (const { seed, swap } of BALANCE_SEEDS) {
            const a = swap ? rows[j].id : rows[i].id;
            const b = swap ? rows[i].id : rows[j].id;
            const v = duel(a, b, seed, { arena });
            expect(v.finished).toBe(true);
            games.set(a, (games.get(a) ?? 0) + 1);
            games.set(b, (games.get(b) ?? 0) + 1);
            if (v.winnerTeam === 0) wins.set(a, (wins.get(a) ?? 0) + 1);
            else if (v.winnerTeam === 1) wins.set(b, (wins.get(b) ?? 0) + 1);
            else {
              wins.set(a, (wins.get(a) ?? 0) + 0.5);
              wins.set(b, (wins.get(b) ?? 0) + 0.5);
            }
          }
        }
      }
      const table = rows.map((r) => ({ id: r.id, rate: (wins.get(r.id) ?? 0) / (games.get(r.id) ?? 1) }));
      console.log(`win table ${FL_DIVISION_LABELS[division]} (${arena}): ${table.map((t) => `${FL_BY_ID.get(t.id)!.name} ${(100 * t.rate).toFixed(0)}%`).join(", ")}`);
      for (const t of table) {
        expect([t.id, t.rate >= 0.25]).toEqual([t.id, true]);
        expect([t.id, t.rate <= 0.75]).toEqual([t.id, true]);
      }
    });
  }
});

/* ------------------------------------------------------------------ --- fl-overhaul --- QA regressions */

/**
 * --- fl-overhaul --- The QA findings of the overhaul's Stage 1 (numbered as in the QA report): each test failed on the code
 * before the rework and passes after it (the helpers of tests/flProbes.ts run the engine headlessly at the fixed step).
 */

/** Every event of a run until `untilMs` (polled each frame), with `each` after every frame. */
function qaRunEvents(engine: PhysicsEngine, untilMs: number, each?: (v: FightLeagueView) => boolean | void) {
  const v = engine.getFightLeagueView();
  let serial = 0;
  const all: { kind: number; t: number; slot: number; value: number }[] = [];
  probeRun(engine, untilMs, (view) => {
    all.push(...eventsSince(view, serial));
    serial = view.eventSerial;
    return each?.(view);
  });
  return { v, events: all };
}

function qaWithAbility(ability: FlAbility, body: () => void) {
  const row = FL_BY_ID.get("gerald")! as { ability: FlAbility };
  const saved = row.ability;
  row.ability = ability;
  try {
    body();
  } finally {
    row.ability = saved;
  }
}

/** A 2D context that accepts every call (the renderer's sprites and HUD in Node). */
function qaStubContext(log: { name: string; args: unknown[] }[] = []): CanvasRenderingContext2D {
  const target: Record<string, unknown> = { canvas: { width: 800, height: 450 }, globalAlpha: 1 };
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === "measureText") return (s: string) => ({ width: 6 * String(s).length });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
      return (...args: unknown[]) => {
        log.push({ name: key, args });
        return undefined;
      };
    },
    set(t, key: string, value) {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

function qaStubDocument() {
  vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => qaStubContext() }) });
}

const QA_OPTS = { dpr: 1, numbers: true, teamColors: null, teamBanner: false, labels: DEFAULT_FIGHT_LEAGUE_LABELS };

describe("fight league QA regressions", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("1: an ability volley carries no weapon – a disarmed caster's Avada Kedavra still lands (and sounds magic)", { timeout: 60_000 }, () => {
    for (const seed of [3, 4, 5]) {
      const engine = probeEngine({ fighters: ["voldemort", "harrypotter", "random", "random"], cast: [40, 0.05, 1, 1], speed: [1, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
      const v = engine.getFightLeagueView();
      probeRun(engine, 20_000, () => v.projectiles.some((p) => p.active && p.kind === PK_ABILITY));
      const bolt = v.projectiles.find((p) => p.active && p.kind === PK_ABILITY)!;
      expect([seed, bolt.weapon]).toEqual([seed, -1]);
      const [voldemort, harry] = v.fighters;
      voldemort.disarmedUntil = Infinity;
      const before = harry.hp;
      const kinds = new Set<string>();
      while (bolt.active && engine.getElapsedMs() < 30_000) {
        engine.update(PROBE_STEP, 0);
        for (const ev of engine.consumeSoundEvents() as SoundEvent[]) if (ev.fight) kinds.add(ev.fight);
      }
      expect([seed, before - harry.hp > 20]).toEqual([seed, true]);
      expect([seed, kinds.has("magic")]).toEqual([seed, true]);
    }
  });

  it("2: the circle no longer locks onto a diameter – finish times spread over the seeds", { timeout: 60_000 }, () => {
    const times: number[] = [];
    const winners = new Set<number>();
    for (let seed = 1; seed <= 10; seed++) {
      const v = probeRun(probeEngine({ fighters: ["harrypotter", "voldemort", "random", "random"], arena: "circle", timeCap: 60 }, seed), 120_000);
      times.push(v.finishMs);
      winners.add(v.winnerTeam);
    }
    expect(Math.max(...times) - Math.min(...times)).toBeGreaterThan(1000);
    expect(winners.has(0) && winners.has(1)).toBe(true);
  });

  it("3: the Lasso of Truth pulls the foe in before its hold closes", { timeout: 60_000 }, () => {
    for (const seed of [1, 4, 7]) {
      const engine = probeEngine({ fighters: ["wonderwoman", "gerald", "random", "random"], cast: [40, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
      const v = engine.getFightLeagueView();
      const [ww, gerald] = v.fighters;
      let start = Infinity;
      let gapAtHold = Infinity;
      probeRun(engine, 20_000, () => {
        if (ww.casts > 0 && start === Infinity) start = Math.hypot(gerald.x - ww.x, gerald.y - ww.y) - ww.r - gerald.r;
        if (gerald.heldBy === 0) {
          gapAtHold = (Math.hypot(gerald.x - ww.x, gerald.y - ww.y) - ww.r - gerald.r) / ww.r;
          return true;
        }
      });
      expect([seed, gapAtHold <= 1.2]).toEqual([seed, true]);
    }
  });

  it("4: the Alien's tail lands next to its claws, in both arenas (each weapon of a two-weapon fighter lands)", { timeout: 60_000 }, () => {
    for (const arena of ["square", "circle"] as const) {
      let tail = 0;
      for (const seed of [1, 2, 3]) {
        const v = probeRun(probeEngine({ fighters: ["alien", "gerald", "random", "random"], hp: 1000, timeCap: 0, cast: [0.05, 0.05, 1, 1], arena }, seed), PROBE_INTRO_MS + 60_000);
        tail += v.fighters[0].weapons[1].hits;
      }
      expect([arena, tail / 3 >= 10]).toEqual([arena, true]);
    }
    for (const row of FL_ROSTER.filter((r) => r.weapons.length === 2)) {
      for (const arena of ["square", "circle"] as const) {
        const hits = [0, 0];
        for (const seed of [1, 2, 3]) {
          const v = probeRun(dummyDuel(row.id, seed, { arena }), PROBE_INTRO_MS + 30_000);
          hits[0] += v.fighters[0].weapons[0].hits;
          hits[1] += v.fighters[0].weapons[1].hits;
        }
        for (const k of [0, 1]) if (!(row.weapons[k].kind === "shield" && row.weapons[k].style === "block")) expect([row.id, arena, k, hits[k] > 0]).toEqual([row.id, arena, k, true]);
      }
    }
  });

  it("5: a returning projectile hits once a pass (no second hit a sub-step later at the turn)", { timeout: 60_000 }, () => {
    for (const id of ["ahri", "scorpion", "thor", "captainamerica"]) {
      for (const seed of [1, 2]) {
        const engine = probeEngine({ fighters: [id, "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], speed: [1, 0.05, 1, 1], attack: [1, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
        const { events } = qaRunEvents(engine, PROBE_INTRO_MS + 30_000);
        const hits = events.filter((e) => e.kind === EV_DAMAGE && e.slot === 1).map((e) => e.t);
        let close = 0;
        for (let i = 1; i < hits.length; i++) if (hits[i] - hits[i - 1] < 50) close++;
        expect([id, seed, hits.length > 3, close]).toEqual([id, seed, true, 0]);
      }
    }
  });

  it("6: a burst's rounds leave the muzzle, never from behind the shooter", { timeout: 60_000 }, () => {
    for (const id of ["masterchief", "robocop"]) {
      const r = burstSpawnsBehind(id);
      expect([id, r.rounds > 30, r.behind]).toEqual([id, true, 0]);
    }
  });

  it("7: a beam's and a spark's hand turns with its shots (the ray and the zap leave it)", { timeout: 60_000 }, () => {
    for (const id of ["superman", "homelander"]) {
      const engine = probeEngine({ fighters: [id, "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 2);
      const v = engine.getFightLeagueView();
      let rays = 0;
      probeRun(engine, PROBE_INTRO_MS + 20_000, () => {
        const f = v.fighters[0];
        const w = f.weapons.find((x) => x.spec.kind === "beam")!;
        for (const b of v.beams) {
          if (!b.active || b.ability || b.owner !== 0) continue;
          rays++;
          expect(Math.abs(angleDiff(w.angle, b.angle))).toBeLessThan(0.05);
          expect(Math.hypot(b.x0 - (f.x + Math.cos(b.angle) * 1.1 * f.r), b.y0 - (f.y + Math.sin(b.angle) * 1.1 * f.r))).toBeLessThan(0.75 * f.r);
        }
      });
      expect([id, rays > 5]).toEqual([id, true]);
    }
    const engine = probeEngine({ fighters: ["pikachu", "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 2);
    const v = engine.getFightLeagueView();
    let zaps = 0;
    let last = -Infinity;
    probeRun(engine, PROBE_INTRO_MS + 20_000, () => {
      const f = v.fighters[0];
      const w = f.weapons[0];
      if (w.zapMs > last) {
        last = w.zapMs;
        zaps++;
        expect(Math.abs(angleDiff(w.angle, Math.atan2(w.zapY - f.y, w.zapX - f.x)))).toBeLessThan(0.35);
      }
    });
    expect(zaps).toBeGreaterThan(5);
  });

  it("8: You Shall Not Pass pins the foe fully inside the arena", { timeout: 60_000 }, () => {
    for (const arena of ["square", "circle"] as const) {
      let pinnedFrames = 0;
      for (const seed of [1, 2, 3]) {
        const engine = probeEngine({ fighters: ["gandalf", "gerald", "random", "random"], cast: [3, 1, 1, 1], hp: 1000, timeCap: 0, arena }, seed);
        const v = engine.getFightLeagueView();
        probeRun(engine, PROBE_INTRO_MS + 40_000, () => {
          const g = v.fighters[1];
          const field = v.field!;
          if (!(v.timeMs < g.pinUntil)) return;
          pinnedFrames++;
          if (arena === "square") {
            expect(Math.abs(g.x - field.cx)).toBeLessThanOrEqual(field.half - g.r + 0.5);
            expect(Math.abs(g.y - field.cy)).toBeLessThanOrEqual(field.half - g.r + 0.5);
          } else expect(Math.hypot(g.x - field.cx, g.y - field.cy)).toBeLessThanOrEqual(field.half - g.r + 0.5);
        });
      }
      expect([arena, pinnedFrames > 10]).toEqual([arena, true]);
    }
  });

  it("9: a range-limited ability waits for its foe in range – most Spin Attacks hit", { timeout: 60_000 }, () => {
    let casts = 0;
    let landed = 0;
    for (const seed of [1, 2, 3]) {
      const engine = probeEngine({ fighters: ["link", "gerald", "random", "random"], hp: 1000, timeCap: 0, cast: [1, 0.05, 1, 1] }, seed);
      const { events } = qaRunEvents(engine, PROBE_INTRO_MS + 60_000);
      const castsAt = events.filter((e) => e.kind === EV_CAST && e.slot === 0).map((e) => e.t);
      casts += castsAt.length;
      for (const t of castsAt) if (events.some((e) => e.kind === EV_DAMAGE && e.slot === 1 && Math.abs(e.t - t) <= 20)) landed++;
    }
    expect(casts).toBeGreaterThan(4);
    expect(landed / casts).toBeGreaterThanOrEqual(0.6);
  });

  it("10: a choke cast while a decoy is nearer still takes the foe fighter", { timeout: 60_000 }, () => {
    let casts = 0;
    let holds = 0;
    for (const seed of [1, 2, 3, 4, 5]) {
      const engine = probeEngine({ fighters: ["spiderman", "loki", "random", "random"], cast: [8, 40, 1, 1], hp: 1000, timeCap: 0 }, seed);
      const v = engine.getFightLeagueView();
      let lastCasts = 0;
      probeRun(engine, PROBE_INTRO_MS + 20_000, () => {
        const [spidey, loki] = v.fighters;
        if (spidey.casts > lastCasts) {
          lastCasts = spidey.casts;
          casts++;
          if (loki.heldBy === 0 || v.timeMs < loki.ccImmuneUntil) holds++;
        }
      });
    }
    expect(casts).toBeGreaterThan(5);
    expect(holds).toBe(casts);
  });

  it("11: Force Lift's slam throws the foe toward the wall", { timeout: 60_000 }, () => {
    for (const seed of [1, 4]) {
      const engine = probeEngine({ fighters: ["yoda", "gerald", "random", "random"], cast: [40, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
      const v = engine.getFightLeagueView();
      const g = v.fighters[1];
      let wasHeld = false;
      let checked = false;
      probeRun(engine, 20_000, () => {
        if (g.heldBy === 0) wasHeld = true;
        else if (wasHeld) {
          // (thrown at 2.5 cruise units, not carrying on along its old heading at its cruise)
          expect(Math.hypot(g.vx, g.vy)).toBeGreaterThan(1.8 * g.cruise);
          checked = true;
          return true;
        }
      });
      expect([seed, checked]).toEqual([seed, true]);
    }
  });

  it("12: air and contact fists are drawn at rest (Gerald, Aang, Sonic)", { timeout: 60_000 }, () => {
    qaStubDocument();
    for (const id of ["gerald", "aang", "sonic"]) {
      const engine = probeEngine({ fighters: [id, "thor", "random", "random"] }, 1);
      const v = probeRun(engine, 500);
      const layer = new FightLeagueLayer();
      layer.drawBodies(qaStubContext(), v, QA_OPTS);
      expect([id, layer.weaponsDrawn >= 2]).toEqual([id, true]);
    }
  });

  it("13: a random slot next to Gerald draws from the other divisions; mirror matches rarely end in a double KO", { timeout: 60_000 }, () => {
    for (let k = 0; k < 40; k++) {
      const rows = pickFighters({ fighters: ["gerald", "random", "random", "random"], match: "ffa4", sameDivision: true }, () => (k * 0.137 + 0.01) % 1);
      expect(rows[0].id).toBe("gerald");
      for (const r of rows.slice(1)) expect(r.id).not.toBe("gerald");
    }
    let double = 0;
    for (let seed = 1; seed <= 10; seed++) if (probeRun(probeEngine({ fighters: ["gerald", "gerald", "random", "random"], timeCap: 60 }, seed), 120_000).doubleKo) double++;
    expect(double).toBeLessThanOrEqual(1);
  });

  it("14: attack speed speeds a sword up", { timeout: 60_000 }, () => {
    const hits = (atk: number) => {
      let n = 0;
      for (const seed of [1, 2, 3]) n += probeRun(dummyDuel("link", seed, { attack: [atk, 0.05, 1, 1] }), PROBE_INTRO_MS + 30_000).fighters[0].hits;
      return n;
    };
    expect(hits(3)).toBeGreaterThanOrEqual(1.5 * hits(1));
  });

  it("15: a minigun faster than the old window lands its hits", { timeout: 60_000 }, () => {
    let hits = 0;
    for (const seed of [1, 2, 3]) hits += probeRun(dummyDuel("jinx", seed), PROBE_INTRO_MS + 20_000).fighters[0].weapons[0].hits;
    expect(hits / 60).toBeGreaterThanOrEqual(3.2);
  });

  it("16: a giant hit riding a shot that misses goes back to its owner", { timeout: 60_000 }, () => {
    const engine = probeEngine({ fighters: ["batman", "gerald", "random", "random"], cast: [40, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 2);
    const v = engine.getFightLeagueView();
    const [batman, gerald] = v.fighters;
    probeRun(engine, 20_000, () => v.projectiles.some((p) => p.active && p.giant > 0 && p.owner === 0));
    expect(batman.giantLeft).toBe(0);
    // (no second Smoke Bomb: only a refund can load a giant hit again)
    batman.cast = 0;
    batman.meter = 0;
    batman.telegraphUntil = -1;
    // Gerald steps out of its way: the batarang flies on into the wall.
    const ball = engine.getBalls().find((b) => b.id === gerald.ballId)!;
    const p = v.projectiles.find((x) => x.active && x.giant > 0)!;
    const field = v.field!;
    ball.x = gerald.x = 2 * field.cx - p.x;
    ball.y = gerald.y = field.cy + (field.cy - p.y) * 0.2;
    gerald.invulnUntil = Infinity;
    probeRun(engine, v.timeMs + 4000, () => !p.active);
    expect(p.active).toBe(false);
    expect(batman.giantLeft).toBe(1);
  });

  it("17: Katarina's blink spin lands", { timeout: 60_000 }, () => {
    let spins = 0;
    for (const seed of [1, 2, 3]) {
      const engine = probeEngine({ fighters: ["katarina", "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
      const { events } = qaRunEvents(engine, PROBE_INTRO_MS + 60_000);
      // (the dagger's own hit and the spin's land in the same sub-step as the blink: two damage numbers)
      for (const e of events) if (e.kind === EV_BLINK && e.slot === 0 && events.filter((d) => d.kind === EV_DAMAGE && d.slot === 1 && d.t === e.t).length >= 2) spins++;
    }
    expect(spins).toBeGreaterThanOrEqual(3);
  });

  it("18: arena cuts land where their foe will be", { timeout: 60_000 }, () => {
    qaWithAbility({ name: "Rend", charge: 5, effects: [{ p: "arenaCuts", n: 3, damage: 5 }] }, () => {
      let cuts = 0;
      let landed = 0;
      for (const seed of [1, 2, 3]) {
        const engine = probeEngine({ fighters: ["gerald", "thor", "random", "random"], cast: [3, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
        const { events } = qaRunEvents(engine, PROBE_INTRO_MS + 30_000);
        for (const e of events) {
          if (e.kind !== EV_CUT) continue;
          cuts++;
          if (events.some((d) => d.kind === EV_DAMAGE && d.slot === 1 && Math.abs(d.t - e.t) <= 20)) landed++;
        }
      }
      expect(cuts).toBeGreaterThan(10);
      expect(landed / cuts).toBeGreaterThanOrEqual(0.5);
    });
  });

  it("19: a spinning kick's ring thuds (not blades)", { timeout: 60_000 }, () => {
    const engine = probeEngine({ fighters: ["chunli", "gerald", "random", "random"], cast: [8, 0.05, 1, 1], hp: 1000, timeCap: 0, speed: [1, 0.05, 1, 1] }, 1);
    const kinds = new Set<string>();
    while (engine.getElapsedMs() < PROBE_INTRO_MS + 20_000) {
      engine.update(PROBE_STEP, 0);
      for (const ev of engine.consumeSoundEvents() as SoundEvent[]) if (ev.fight) kinds.add(ev.fight);
    }
    expect(engine.getFightLeagueView().fighters[0].casts).toBeGreaterThan(0);
    expect(kinds.has("blade")).toBe(false);
  });

  it("20: an orbiting weapon stops while its owner is frozen", { timeout: 60_000 }, () => {
    const engine = probeEngine({ fighters: ["kratos", "subzero", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 1);
    const v = engine.getFightLeagueView();
    const kratos = v.fighters[0];
    let checked = 0;
    let angle = NaN;
    probeRun(engine, PROBE_INTRO_MS + 40_000, () => {
      const frozen = v.timeMs + PROBE_STEP < kratos.frozenUntil;
      if (frozen && Number.isFinite(angle)) {
        expect(kratos.weapons[0].angle).toBe(angle);
        checked++;
      }
      angle = frozen ? kratos.weapons[0].angle : NaN;
    });
    expect(checked).toBeGreaterThan(5);
  });

  it("21: the time cap counts from FIGHT! (the VS card is not fighting time)", { timeout: 60_000 }, () => {
    const v = probeRun(probeEngine({ fighters: ["thor", "loki", "random", "random"], hp: 100_000, timeCap: 10, suddenDeath: false } as Partial<FightLeagueSettings>, 3), 30_000);
    expect(v.byTime).toBe(true);
    expect(v.finishMs).toBeGreaterThanOrEqual(PROBE_INTRO_MS + 10_000);
    expect(v.finishMs).toBeLessThan(PROBE_INTRO_MS + 10_000 + 20);
  });

  it("22: a full meter waiting for its moment says READY", { timeout: 60_000 }, () => {
    qaStubDocument();
    const engine = probeEngine({ fighters: ["link", "gerald", "random", "random"] }, 1);
    const v = probeRun(engine, 3000);
    v.fighters[0].meter = 1;
    v.fighters[0].telegraphUntil = -1;
    const log: { name: string; args: unknown[] }[] = [];
    new FightLeagueLayer().drawOverlay(qaStubContext(log), v, QA_OPTS, { width: 800, height: 450, inset: 0 });
    expect(log.some((c) => c.name === "fillText" && c.args[0] === "READY")).toBe(true);
  });

  it("23: a huge Ball Size fits the fighters in the arena (the run goes on)", { timeout: 60_000 }, () => {
    const engine = probeEngine({ fighters: ["thor", "gerald", "random", "random"] }, 1, { ballRadius: 180 });
    engine.update(PROBE_STEP, 0);
    expect(engine.isSimulationFinished()).toBe(false);
    const v = probeRun(engine, 20_000);
    const field = v.field!;
    expect(v.timeMs).toBeGreaterThan(3000);
    expect(v.finished && (v.kos > 0 || v.byTime)).toBe(true);
    for (const f of v.fighters) expect(f.r).toBeLessThan(field.half);
  });

  it("24: the descriptions say what the rows do", { timeout: 60_000 }, () => {
    const v = FL_BY_ID.get("voldemort")!;
    const avada = v.ability.effects[0] as { damage: number };
    const ratio = avada.damage / (v.weapons[0].damage ?? 1);
    expect(ratio).toBeGreaterThan(3.5);
    expect(ratio).toBeLessThan(4);
    expect(v.description).toMatch(/nearly four times/);
    expect((en as { FightLeague: Record<string, string> }).FightLeague.fighter_voldemort).toMatch(/nearly four times/);
    const sonic: FlFighterRow = FL_BY_ID.get("sonic")!;
    expect(sonic.weapons[0].style).toBe("contact");
  });

  it("25: the panel commits the number the fight runs and the link carries", { timeout: 60_000 }, () => {
    expect(flPanelValue("flHp", 2.5)).toBe(3);
    expect(flPanelValue("flTimeCap", 0.04)).toBe(0);
    expect(flPanelValue("flSpeedA", 1.23456)).toBe(1.235);
    const s = { ...defaultSettings("fightLeague"), flHp: flPanelValue("flHp", 2.5) };
    const params = settingsToSearchParams(s);
    expect(params.get("flHp")).toBe("3");
    expect(settingsFromSearchParams(params).flHp).toBe(3);
  });

  it("26: data-fl-weapons counts held shields", { timeout: 60_000 }, () => {
    qaStubDocument();
    const engine = probeEngine({ fighters: ["captainamerica", "loki", "random", "random"] }, 1);
    const v = probeRun(engine, 500);
    const layer = new FightLeagueLayer();
    layer.drawBodies(qaStubContext(), v, QA_OPTS);
    expect(layer.weaponsDrawn).toBeGreaterThanOrEqual(2);
  });
});
