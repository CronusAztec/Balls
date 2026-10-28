import { describe, expect, it } from "vitest";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { SERIES_ROSTER } from "@/lib/bot/playbook";
import { growFillSettingsOf, growRunFinishes } from "@/lib/physics/growFill";
import { hoopsSettingsOf } from "@/lib/physics/hoopsFields";
import { boxSettingsOf } from "@/lib/physics/modes/box";
import { CS_RULES, csSortSettles } from "@/lib/physics/modes/colourSort";
import { doublePendulumSettingsOf } from "@/lib/physics/modes/doublePendulum";
import { dropSettingsOf } from "@/lib/physics/modes/drop";
import { FL_MATCHES, flShowKind, flSideCount } from "@/lib/physics/modes/fightLeague";
import { flBestOfGames } from "@/lib/physics/modes/fightLeagueShow";
import { GROW_LAWS, GROW_ON_FILL } from "@/lib/physics/modes/grow";
import { illusionSettingsOf } from "@/lib/physics/modes/illusion";
import { jdmRhythmFinderSettingsOf } from "@/lib/physics/modes/jdmRhythmFields";
import { landClaimSettingsOf } from "@/lib/physics/modes/landClaim";
import { orbGridNeverSettles, orbGridSettingsOf } from "@/lib/physics/modes/orbGrid";
import { OG_MODELS } from "@/lib/physics/modes/orbRhythm";
import { pendulumSettingsOf } from "@/lib/physics/modes/pendulum";
import { polyrhythmSettingsOf } from "@/lib/physics/modes/polyrhythm";
import { vortexSettingsOf } from "@/lib/physics/modes/vortex";
import { rigNeverFinishes } from "@/lib/physics/rigged";
import { GAP_LAYOUTS, RING_SPINS, ringEscapeActive } from "@/lib/physics/ringEscape";
import { BM_VARIANTS } from "@/lib/simulation/beatMachinePlan";
import { runNeverFinishes } from "@/lib/simulation/finder";
import { outcomeContextOfSettings } from "@/lib/simulation/outcomeContext";
import { availableOutcomes, type OutcomeContext } from "@/lib/simulation/outcomes";
import { PF_VARIANTS } from "@/lib/simulation/polyominoPlan";
import { effectiveBallCount } from "@/lib/teams";

/*
 * --- outcome-context --- lib/simulation/outcomeContext.ts: the finder's context of a settings object, extracted from the
 * Simulator page's inline expression (which now calls it). Over a fixture set of settings – every mode's defaults and the
 * settings of every context flag, on and off – it gives the very context, and so the very outcome lists, the page's expression
 * gave before (copied below as it stood at bff1619), and the fixtures switch every flag both ways.
 */

/** The Simulator page's inline expression as it stood before the extraction (Simulator.tsx at bff1619), word for word. */
function pageContextBefore(s: SimulatorSettings, paintPicture: boolean): OutcomeContext {
  const ballCount = effectiveBallCount(s);
  const finderEndless = runNeverFinishes(s.mode, { drop: dropSettingsOf(s), box: boxSettingsOf(s), pendulum: pendulumSettingsOf(s), polyrhythm: polyrhythmSettingsOf(s), doublePendulum: doublePendulumSettingsOf(s), illusion: illusionSettingsOf(s), ...jdmRhythmFinderSettingsOf(s) /* --- jdm-rhythm-runner --- */, vortex: vortexSettingsOf(s) /* --- gerald-vortex --- (the loop) */, paintPicture: !!paintPicture /* --- review fix (modes-rhythm) --- */, orbGrid: orbGridSettingsOf(s) /* --- orb-rhythm --- (the model decides) */, grow: growFillSettingsOf(s) /* --- loop-foundation --- ("finish" ends at the fill) */, hoops: hoopsSettingsOf(s) /* --- bead-hoops --- (the return loops forever) */, landClaim: landClaimSettingsOf(s) /* --- land-claim-pyramid --- (a looping pyramid never ends) */ }) || rigNeverFinishes(s.mode, s); // --- jdm-double-pendulum --- --- jdm-illusions --- (as showFinder)
  // --- orb-grid --- a field that never settles (the period property, no gravity): no run length to search for (the other outcomes stay)
  const orbEndless = s.mode === "orbGrid" && orbGridNeverSettles(orbGridSettingsOf(s), s.gravity);
  const flShow = s.mode === "fightLeague" ? flShowKind({ match: s.flMatch, bestOf: s.flBestOf }) : undefined; // --- fl-overhaul --- (Stage 5) the show's own outcomes
  return { endless: finderEndless || orbEndless, neverEscape: s.neverEscape, ballCount, orbRhythm: s.ogModel === "rhythm" /* --- orb-rhythm --- */, growFinish: s.mode === "grow" && growRunFinishes(growFillSettingsOf(s)) /* --- loop-foundation --- */, flShow, flSides: s.mode === "fightLeague" ? flSideCount(s.flMatch, [s.flFighterA, s.flFighterB, s.flFighterC, s.flFighterD, s.flFighterE, s.flFighterF]) : 0, flDecider: flBestOfGames(s.flBestOf) > 1 /* --- fl-overhaul --- (Stage 5) */, dpFan: s.mode === "doublePendulum" && s.dpFan /* --- chaos-fan --- */, colourSortSettles: s.mode === "colourSort" && csSortSettles(s.csRule) /* --- colour-sort --- */, bmMarbles: s.mode === "beatMachine" && s.bmVariant === "marbles" /* --- beat-machine --- */, vortexRings: s.mode === "vortex" && s.vxRelease === "rings" /* --- funnel-spin --- */, lcPyramid: s.mode === "landClaim" && s.lcLayout === "pyramid", lcPyramidLoop: s.mode === "landClaim" && s.lcLayout === "pyramid" && s.lcRebuild /* --- land-claim-pyramid --- */, ringEscape: s.mode === "classic" && ringEscapeActive(s) /* --- ring-escape --- */, pfPento: s.mode === "perfectFit" && s.pfVariant === "pento" /* --- perfect-fit --- */ };
}

type Patch = Partial<SimulatorSettings>;

/** Settings every mode is tried with: its defaults, "never escape", more balls, a roster, no gravity. */
const EVERY_MODE: readonly Patch[] = [{}, { neverEscape: true }, { ballCount: 3 }, { twoBalls: true }, { teams: SERIES_ROSTER.slice(0, 4).map((t) => ({ ...t })) }, { gravity: 0 }, { neverEscape: true, ballCount: 4 }];

/** The settings of a mode's own context flags and of the runs that cannot end, both ways. */
const OWN: Partial<Record<SimulatorSettings["mode"], readonly Patch[]>> = {
  drop: [{ dropLoop: true }, { dropLoop: false }],
  box: [{ boxCountdown: 0 }],
  pendulum: [{ pwCycles: 0 }],
  polyrhythm: [{ prCycles: 0 }],
  doublePendulum: [{ dpEndless: true }, { dpFan: true }, { dpFan: true, dpPalindrome: true }, { dpFan: true, dpPalindrome: false }],
  illusion: [{ ilCycles: 0 }],
  runner: [{ runnerAutoJump: false }, { runnerAutoJump: true }],
  paddle: [{ pdAuto: false }, { pdAuto: true }],
  vortex: [{ vxLoop: true }, { vxRelease: "rings" }, { vxRelease: "rings", vxLoop: true }, { vxRelease: "stagger" }],
  orbGrid: OG_MODELS.flatMap((ogModel) => [{ ogModel }, { ogModel, gravity: 0 }]),
  grow: GROW_LAWS.flatMap((growLaw) => GROW_ON_FILL.flatMap((growOnFill) => [{ growLaw, growOnFill }, { growLaw, growOnFill, growStep: 0 }])),
  hoops: [{ hpReturn: true }, { hpReturn: false }],
  landClaim: [{ lcLayout: "pyramid" }, { lcLayout: "pyramid", lcRebuild: true }, { lcLayout: "pyramid", lcRebuild: false }, { lcLayout: "pyramid", lcTeams: 1 }, { lcTeams: 4 }, { lcLayout: "wall", lcRebuild: true }],
  fightLeague: FL_MATCHES.flatMap((flMatch) => [{ flMatch }, { flMatch, flBestOf: 3 }, { flMatch, flFighterA: "", flFighterB: "", flFighterC: "" }]),
  colourSort: CS_RULES.map((csRule) => ({ csRule })),
  beatMachine: BM_VARIANTS.map((bmVariant) => ({ bmVariant })),
  perfectFit: PF_VARIANTS.map((pfVariant) => ({ pfVariant })),
  classic: [...GAP_LAYOUTS.map((gapLayout) => ({ gapLayout })), ...RING_SPINS.map((ringSpin) => ({ ringSpin })), { ringRainbow: true }, { ringTimer: true }, { ringSound: true }, { ringSound: true, neverEscape: true }],
  maze: [{ mzBalls: 1 }, { mzBalls: 6 }],
  territory: [{ tyTeams: 2 }, { tyTeams: 4 }],
  stringBattle: [{ sbBalls: 2 }, { sbBalls: 5 }],
};

/** The fixtures: [settings, Picture Paint's picture loaded]. */
const FIXTURES: readonly (readonly [SimulatorSettings, boolean])[] = MODE_IDS.flatMap((mode) => {
  const base = defaultSettings(mode);
  const patches = [...EVERY_MODE, ...(OWN[mode] ?? [])];
  const pictures = mode === "paint" ? [false, true] : [false];
  return patches.flatMap((patch) => pictures.map((picture) => [{ ...base, ...patch, mode } as SimulatorSettings, picture] as const));
});

const where = (s: SimulatorSettings, picture: boolean) => `${s.mode} ${JSON.stringify({ neverEscape: s.neverEscape, ballCount: s.ballCount, twoBalls: s.twoBalls, teams: s.teams.length, gravity: s.gravity, picture })}`;

describe("outcomeContextOfSettings (--- outcome-context ---)", () => {
  it("gives the very context the Simulator page's inline expression gave, and so the same outcome lists, on every fixture of all 48 modes", () => {
    expect(new Set(FIXTURES.map(([s]) => s.mode)).size).toBe(MODE_IDS.length);
    expect(FIXTURES.length).toBeGreaterThan(400);
    for (const [s, picture] of FIXTURES) {
      const before = pageContextBefore(s, picture);
      const now = outcomeContextOfSettings(s, { paintPicture: picture });
      expect(now, where(s, picture)).toEqual(before);
      expect(availableOutcomes(s.mode, now), where(s, picture)).toEqual(availableOutcomes(s.mode, before));
    }
  });

  it("switches every flag of the context both ways over the fixtures", () => {
    const contexts = FIXTURES.map(([s, picture]) => outcomeContextOfSettings(s, { paintPicture: picture }));
    const keys = new Set(contexts.flatMap((c) => Object.keys(c)));
    expect([...keys].sort()).toEqual(["ballCount", "bmMarbles", "colourSortSettles", "dpFan", "endless", "flDecider", "flShow", "flSides", "growFinish", "lcPyramid", "lcPyramidLoop", "neverEscape", "orbRhythm", "pfPento", "ringEscape", "vortexRings"]);
    for (const key of keys) {
      if (key === "ballCount" || key === "flSides" || key === "flShow") continue;
      const values = new Set(contexts.map((c) => (c as unknown as Record<string, unknown>)[key]));
      expect([key, values.has(true), values.has(false)]).toEqual([key, true, true]);
    }
    expect(new Set(contexts.map((c) => c.ballCount >= 2))).toEqual(new Set([true, false]));
    expect(new Set(contexts.map((c) => c.flShow))).toEqual(new Set([undefined, "single", "series", "bracket", "boss"]));
    // (a bracket's sides are its pinned entrants: none pinned, none to name)
    expect(new Set(contexts.filter((c) => c.flShow !== undefined).map((c) => (c.flSides ?? 0) > 0))).toEqual(new Set([true, false]));
  });

  it("reads the outcomes a mode's own switch opens, and Picture Paint's picture from the page", () => {
    const outcomes = (patch: Patch & { mode: SimulatorSettings["mode"] }, page = {}) => availableOutcomes(patch.mode, outcomeContextOfSettings({ ...defaultSettings(patch.mode), ...patch } as SimulatorSettings, page));
    expect(outcomes({ mode: "grow" })).not.toContain("fills-by");
    expect(outcomes({ mode: "grow", growOnFill: "finish" })).toEqual(expect.arrayContaining(["duration", "fills-by", "fill-on-bar"]));
    expect(outcomes({ mode: "doublePendulum" })).not.toContain("diverges-at");
    expect(outcomes({ mode: "doublePendulum", dpFan: true })).toContain("diverges-at");
    expect(outcomes({ mode: "vortex" })).not.toContain("ring-on-bar");
    expect(outcomes({ mode: "vortex", vxRelease: "rings" })).toContain("ring-on-bar");
    expect(outcomes({ mode: "classic" })).not.toContain("ring-at");
    expect(outcomes({ mode: "classic", ringSound: true })).toContain("ring-at");
    expect(outcomes({ mode: "colourSort", csRule: "outwardNotOwn" })).toContain("sorted-by");
    expect(outcomes({ mode: "colourSort", csRule: "bothWaysNotOwn" })).not.toContain("sorted-by");
    expect(outcomes({ mode: "classic", neverEscape: true })).not.toContain("escapes-at");
    expect(outcomes({ mode: "paint" })).toContain("duration");
    expect(outcomes({ mode: "paint" }, { paintPicture: true })).not.toContain("duration");
    // without the page's word, a settings object has no picture loaded
    expect(outcomeContextOfSettings(defaultSettings("paint"))).toEqual(outcomeContextOfSettings(defaultSettings("paint"), { paintPicture: false }));
  });
});
