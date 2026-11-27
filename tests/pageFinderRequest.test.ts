import { describe, expect, it } from "vitest";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import { clipPacingFindSec } from "@/lib/clipPacing";
import { startSettings } from "@/lib/studioLooks";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { FINDER_DEPTH_BUDGET_MS, runNeverFinishes, simulateSeed, type FinderRequest } from "@/lib/simulation/finder";
import { arenaFinderRequest } from "@/lib/simulation/multi";
import { onBeatConfigOfSettings } from "@/lib/simulation/videoBeatsSettings";
import { PAGE_FINDER_OVERRIDES, pageFinderRequest, type PageFinderInputs } from "@/lib/simulation/pageFinderRequest";

/*
 * --- page-finder-request --- (round two A2a, code-1) The page's Find Simulation request (lib/simulation/pageFinderRequest.ts)
 * builds on the mode settings the bot, the toolbox, the batch render and the fast export's engine get (`modeSettingsOfSettings`)
 * and adds only what a page has and a settings object does not. Before, Simulator.tsx built it by hand: it missed Lines'
 * Strings to Finish (the Lines start look read as endless) and Paint's Guide to the Gaps (no seed found at the start look's 21 s).
 */

const WORLDS = [
  { width: 800, height: 450 },
  { width: 450, height: 450 },
] as const;

/** A page with nothing of its own loaded: no song, no melody, On beat from the settings, no picture. */
function plainPage(s: SimulatorSettings, world: { width: number; height: number } = WORLDS[0]): PageFinderInputs {
  const target = clipPacingFindSec(s);
  return {
    physicsConfig: physicsConfigOfSettings(s, world),
    targetSec: target,
    toleranceSec: 0.5,
    maxSeeds: 1000,
    depthBudgetMs: FINDER_DEPTH_BUDGET_MS,
    panelTargetSec: target,
    panelToleranceSec: 0.5,
    rhythmBeat: null,
    melody: [],
    onBeat: onBeatConfigOfSettings(s),
    paintPicture: false,
  };
}

const looks = (mode: ModeId): [string, SimulatorSettings][] => [
  ["link base", defaultSettings(mode)],
  ["start look", startSettings(mode)],
];

const OWN: ReadonlySet<string> = new Set(PAGE_FINDER_OVERRIDES);

describe("the page's Find request builds on the bot's and the export's mode settings", () => {
  it("equals modeSettingsOfSettings on every key but the page's own, for all 50 modes at their link base and start look", () => {
    expect(MODE_IDS).toHaveLength(50);
    for (const mode of MODE_IDS) {
      for (const [look, s] of looks(mode)) {
        const page = pageFinderRequest(s, plainPage(s)).modeSettings as unknown as Record<string, unknown>;
        const shared = modeSettingsOfSettings(s) as unknown as Record<string, unknown>;
        const keys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => !OWN.has(k)).sort();
        expect(keys(page), `${mode} (${look})`).toEqual(keys(shared));
        for (const key of keys(shared)) expect(page[key], `${mode} (${look}): ${key}`).toEqual(shared[key]);
      }
    }
  });

  it("takes the rest of the request from the page: its target, tolerance, seeds, depth budget, physics, horizon and outcome", () => {
    const s = startSettings("classic");
    const inputs = { ...plainPage(s), targetSec: 27, toleranceSec: 1, maxSeeds: 300, depthBudgetMs: 0 };
    const request = pageFinderRequest(s, inputs);
    expect(request).toMatchObject({ mode: "classic", targetDurationSec: 27, toleranceSec: 1, maxSeeds: 300, depthBudgetMs: 0, maxSimTimeSec: 57 });
    expect(request.physicsConfig).toBe(inputs.physicsConfig);
    expect("outcome" in request).toBe(false);
    expect(pageFinderRequest(s, { ...inputs, outcome: { kind: "never-escapes", clipSec: 27 } }).outcome).toEqual({ kind: "never-escapes", clipSec: 27 });
    // Color Match searches 90 s past its target; a Fight League show adds its horizon (FL_SHOW_BOUT_SEC a bout)
    expect(pageFinderRequest(defaultSettings("colorMatch"), { ...inputs, targetSec: 22 }).maxSimTimeSec).toBe(112);
    const single = pageFinderRequest(defaultSettings("fightLeague"), { ...inputs, targetSec: 30 }).maxSimTimeSec;
    const show = pageFinderRequest({ ...defaultSettings("fightLeague"), flBestOf: 3 }, { ...inputs, targetSec: 30 }).maxSimTimeSec;
    expect(single).toBe(60);
    expect(show).toBeGreaterThan(single);
  });

  it("adds only the page's own inputs, each where the page's engine reads it", () => {
    const grid = { grid: { bpm: 100, beatTimes: [0, 0.6, 1.2, 1.8, 2.4, 3.0], duration: 3.0 }, offset: 0, loop: true };
    // the loaded song's beat grid: the Beat Runner's course and Beat Drop's beats follow it
    const runner = startSettings("runner");
    const runnerPlain = pageFinderRequest(runner, plainPage(runner)).modeSettings;
    const runnerSong = pageFinderRequest(runner, { ...plainPage(runner), rhythmBeat: grid }).modeSettings;
    expect(runnerPlain.runner).toEqual(modeSettingsOfSettings(runner).runner);
    expect(runnerSong.runner).not.toEqual(runnerPlain.runner);
    const drop = startSettings("beatDrop");
    expect(pageFinderRequest(drop, { ...plainPage(drop), rhythmBeat: grid }).modeSettings.beatDrop).not.toEqual(pageFinderRequest(drop, plainPage(drop)).modeSettings.beatDrop);
    // the loaded melody Beat Machines plays
    const machine = startSettings("beatMachine");
    expect(pageFinderRequest(machine, plainPage(machine)).modeSettings.beatMachine).toEqual(modeSettingsOfSettings(machine).beatMachine);
    expect(pageFinderRequest(machine, { ...plainPage(machine), melody: [60, 64, 67] }).modeSettings.beatMachine).not.toEqual(modeSettingsOfSettings(machine).beatMachine);
    // On beat as the page resolves it
    const onBeat = { ...onBeatConfigOfSettings(runner), enabled: true };
    expect(pageFinderRequest(runner, { ...plainPage(runner), onBeat }).modeSettings.onBeat).toBe(onBeat);
    // Capture the Flag's time limit widened to the Find panel's target (not Make a clip's)
    const ctf = startSettings("ctf");
    const ctfRequest = pageFinderRequest(ctf, { ...plainPage(ctf), targetSec: 20, panelTargetSec: 80, panelToleranceSec: 0.5 }).modeSettings.ctf;
    expect(ctfRequest?.clipSeconds).toBeGreaterThan(80);
    expect(ctfRequest?.clipSeconds).toBeGreaterThan(modeSettingsOfSettings(ctf).ctf?.clipSeconds ?? 0);
    // a picture in Paint: Picture Paint is not searched
    const paint = startSettings("paint");
    expect(pageFinderRequest(paint, plainPage(paint)).modeSettings.paintPicture).toBe(false);
    const picture = pageFinderRequest(paint, { ...plainPage(paint), paintPicture: true }).modeSettings;
    expect(picture.paintPicture).toBe(true);
    expect(runNeverFinishes("paint", picture)).toBe(true);
  });
});

describe("code-1: Lines' Strings to Finish and Paint's Guide to the Gaps reach the page's Find", () => {
  const seeds = [1, 2, 3, 4, 5, 6];
  const durations = (request: FinderRequest) => seeds.map((seed) => simulateSeed(seed, request, (request.targetDurationSec + 30) * 1000) / 1000);

  it("searches the Lines start look's string art (it read as endless: 'never ends', 0 seeds tested), while the link base stays endless", () => {
    const s = startSettings("lines");
    expect(s.lnStrings).toBeGreaterThan(0);
    expect(clipPacingFindSec(s)).toBe(23.5);
    for (const world of WORLDS) {
      const request = pageFinderRequest(s, plainPage(s, world));
      expect(request.modeSettings.lines).toEqual({ strings: s.lnStrings });
      expect(runNeverFinishes("lines", request.modeSettings)).toBe(false);
      // the request the page built by hand, without the field, read the same look as endless
      expect(runNeverFinishes("lines", { ...request.modeSettings, lines: undefined })).toBe(true);
      // every run ends with its last string, about the 23.5 s target (seeds 1–200 ran 21.6–25.6 s: clipPacing.ts START_FIND_SEC)
      const runs = durations(request);
      for (const sec of runs) expect(sec, `${world.width}x${world.height}: ${runs}`).toBeGreaterThan(20);
      for (const sec of runs) expect(sec, `${world.width}x${world.height}: ${runs}`).toBeLessThan(27);
    }
    const base = defaultSettings("lines");
    expect(runNeverFinishes("lines", pageFinderRequest(base, plainPage(base)).modeSettings)).toBe(true);
  });

  it("searches the Paint start look with its Guide to the Gaps (unguided, no seed in 1,000 was near 21 s), while the link base stays unguided", () => {
    const s = startSettings("paint");
    expect(s.paintGuide).toBe(true);
    expect(clipPacingFindSec(s)).toBe(21);
    for (const world of WORLDS) {
      const request = pageFinderRequest(s, plainPage(s, world));
      expect(request.modeSettings.paintGuide).toBe(true);
      // guided, every run fills the canvas around the target (seeds 1–200 ran 15.4–29.5 s: clipPacing.ts START_FIND_SEC);
      // unguided, as the page searched it, every one runs past 30 s, so 1,000 seeds came no closer than 29.4 s
      const guided = durations(request);
      const unguided = durations({ ...request, modeSettings: { ...request.modeSettings, paintGuide: undefined } });
      for (const sec of guided) expect(sec, `${world.width}x${world.height}: guided ${guided}`).toBeGreaterThan(15);
      for (const sec of guided) expect(sec, `${world.width}x${world.height}: guided ${guided}`).toBeLessThan(27);
      for (const sec of unguided) expect(sec, `${world.width}x${world.height}: unguided ${unguided}`).toBeGreaterThan(30);
    }
    const base = defaultSettings("paint");
    expect(pageFinderRequest(base, plainPage(base)).modeSettings.paintGuide).toBeUndefined();
  });

  it("gives the split-screen search the same fields: its arenas spread the page's request", () => {
    for (const mode of ["lines", "paint"] as const) {
      const s = startSettings(mode);
      const request = pageFinderRequest(s, plainPage(s));
      const arena = arenaFinderRequest(request, { shared: { gravity: s.gravity, ballSpeed: s.ballSpeed, ballColor: s.ballColor }, arenas: [{ label: "A" }, { label: "B" }], worlds: [WORLDS[0], WORLDS[1]] }, 1);
      expect(arena.modeSettings, mode).toBe(request.modeSettings);
    }
  });
});
