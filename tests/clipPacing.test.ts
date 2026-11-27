import { describe, expect, it } from "vitest";
import { GALLERY } from "@/content/gallery";
import { DAILY_POOL } from "@/lib/dailyCore";
import { FINGERPRINT_CONFIG, FINGERPRINT_MODE_SETTINGS } from "@/lib/agentKit/fingerprint";
import { finderRequestOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest"; // --- find-target-follows --- (physicsConfigOfSettings: the page's world)
import { RECIPES, SERIES_ROSTER } from "@/lib/bot/playbook";
import { DEFAULT_RING_ESCAPE_FIELDS } from "@/lib/physics/ringEscape";
import { clipPacingDefaults, clipPacingFindSec, clipStartSettings, nextFindTarget, type FindTargetAuto } from "@/lib/clipPacing"; // --- find-target-follows --- (round two A2b: the target, the lookup)
import { COLOR_MATCH_SEGMENT_CHOICES, DEFAULT_COLOR_MATCH_SEGMENTS, isColorMatchSegments } from "@/lib/physics/modes/colorMatch";
import { DEFAULT_MERGE_RING_SETTINGS } from "@/lib/physics/modes/mergeRing";
import { DEFAULT_PENDULUM_SETTINGS } from "@/lib/physics/modes/pendulum";
import { DEFAULT_POLYRHYTHM_SETTINGS } from "@/lib/physics/modes/polyrhythm";
import { DEFAULT_SPIRAL_GLASS_SETTINGS } from "@/lib/physics/modes/spiralGlass";
import { perfectShotIndex } from "@/lib/physics/modes/bullseye"; // --- finales-in-clip --- (review fix)
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, fixedRunDurationSec, simulateSeed } from "@/lib/simulation/finder";
import { lookPatch, lookRow, startSettings } from "@/lib/studioLooks"; // --- pace-as-look --- (the page's pace: what the page itself starts a mode in) --- find-target-follows --- (the Looks row)
import { onBeatConfigOfSettings } from "@/lib/simulation/videoBeatsSettings"; // --- find-target-follows ---
import { pageFinderRequest } from "@/lib/simulation/pageFinderRequest"; // --- find-target-follows --- (the page's own Find request)

/*
 * --- clip-pacing --- The page's own defaults of the modes whose default run did not end inside the default 30 s clip
 * (lib/clipPacing.ts), and Color Match's segment count as a setting:
 *  - what each mode starts with, and that no other mode's defaults moved;
 *  - the default run's own end inside 27 s (the end banner's 2 s still fit a 30 s clip), measured on seeds 1–12 in the
 *    laptop world and the phone world;
 *  - only start looks (--- pace-as-look --- round two A3a: the pace left the link base): the modes' own constants, the link
 *    base and the fingerprint recipe are what they were, a link that names a value keeps it, and the cards, the gallery and the
 *    daily looks that play a pace write it out;
 *  - nothing the crew's role-eval corpus pins moved: Classic's ring sounds and Accumulation's defaults stay as they were.
 */

const PACED: ModeId[] = ["target", "colorMatch", "pendulum", "polyrhythm", "mergeRing", "spiralGlass", "shatter" /* --- shatter-demolition --- */, "territory" /* --- territory-swing --- */, "runner", "vortex", "bullseye", "race", "journey", "orbGrid", "maze", "paddle" /* --- finales-in-clip --- */];
const WORLDS = [
  { width: 800, height: 450 },
  { width: 450, height: 450 },
];

/** The default run of `mode` for `seed` in `world`: when it ends (s), or −1 when it has not by `maxSec`. */
function endOf(mode: ModeId, seed: number, world: { width: number; height: number }, maxSec = 45): number {
  const request = finderRequestOfSettings(startSettings(mode), world, maxSec);
  const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
  for (let frame = 1; frame <= maxSec * 60; frame++) {
    engine.update(1000 / 60, 0);
    engine.consumeSoundEvents();
    if (engine.isSimulationFinished()) return frame / 60;
  }
  return -1;
}

describe("the page's own defaults", () => {
  it("gives each paced mode its measured settings, and no other mode any", () => {
    expect(clipPacingDefaults("classic")).toEqual({});
    expect(clipPacingDefaults("target")).toEqual({ targetCount: 7, ballSpeed: 700, showGlow: true });
    expect(clipPacingDefaults("colorMatch")).toEqual({ colorMatchSegments: 8, colorMatchColorCount: 3, ballSpeed: 700, showGlow: true });
    expect(clipPacingDefaults("accumulation")).toEqual({});
    expect(clipPacingDefaults("pendulum")).toEqual({ pwCycleSeconds: 24, pwBaseOscillations: 20 });
    expect(clipPacingDefaults("polyrhythm")).toEqual({ prCycleSeconds: 24 });
    expect(clipPacingDefaults("mergeRing")).toEqual({ mrInterval: 0.4, mrSpawnTiers: 3, mrGravity: 3 }); // --- merge-ring-staged ---
    expect(clipPacingDefaults("spiralGlass")).toEqual({ sgGlassHp: 1 });
    expect(clipPacingDefaults("shatter")).toEqual({ wallCount: 6, shatterSegments: 36, shatterHits: 2, shatterEvenBricks: true }); // --- shatter-demolition --- (--- shatter-even-bricks ---)
    expect(clipPacingDefaults("territory")).toEqual({ tyRadius: 4, tyPowerEvery: 2 }); // --- territory-swing ---
    for (const mode of MODE_IDS) {
      const own = clipPacingDefaults(mode);
      expect(Object.keys(own).length > 0, mode).toBe(PACED.includes(mode));
      const d = startSettings(mode) as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(own)) expect(d[key], `${mode}.${key}`).toBe(value);
    }
    // a mode that is not paced keeps the core defaults: Multiply's gap and speed, Portal's seven rings, the feature's own values
    const multiply = defaultSettings("multiply");
    expect([multiply.gapSize, multiply.ballSpeed, multiply.wallCount, multiply.showGlow, multiply.screenShake, multiply.ringSound]).toEqual([0.3, 400, 7, false, 0, false]);
    expect([multiply.pwCycleSeconds, multiply.prCycleSeconds, multiply.mrTiers, multiply.sgGlassHp, multiply.colorMatchSegments, multiply.targetCount]).toEqual([60, 30, 7, 2, 12, 10]);
    expect([multiply.mrInterval, multiply.mrSpawnTiers, multiply.mrGravity]).toEqual([0.9, 2, 1]); // --- merge-ring-staged ---
    // Classic, the page's first mode, is as it was
    const classic = defaultSettings("classic");
    expect([classic.wallCount, classic.gapSize, classic.ballSpeed]).toEqual([7, 0.4, 400]);
  });

  it("leaves the modes' own constants and the fingerprint's recipe alone: no pinned run moves", () => {
    expect([DEFAULT_PENDULUM_SETTINGS.cycleSeconds, DEFAULT_PENDULUM_SETTINGS.baseOscillations]).toEqual([60, 51]);
    expect(DEFAULT_POLYRHYTHM_SETTINGS.cycleSeconds).toBe(30);
    expect([DEFAULT_MERGE_RING_SETTINGS.tiers, DEFAULT_MERGE_RING_SETTINGS.interval]).toEqual([7, 0.9]);
    expect(DEFAULT_SPIRAL_GLASS_SETTINGS.glassHp).toBe(2);
    expect([FINGERPRINT_CONFIG.wallCount, FINGERPRINT_CONFIG.gapSize, FINGERPRINT_CONFIG.ballSpeed]).toEqual([7, 0.4, 400]);
    expect([FINGERPRINT_MODE_SETTINGS.countdownTotal, FINGERPRINT_MODE_SETTINGS.colorMatchColorCount, FINGERPRINT_MODE_SETTINGS.accumulationTimerMax]).toEqual([10, 7, 4000]);
    // the recipe names no segment count: Color Match runs its own twelve there
    expect(FINGERPRINT_MODE_SETTINGS.colorMatchSegmentCount).toBeUndefined();
    const engine = createEngineForSettings(FINGERPRINT_CONFIG, "colorMatch", FINGERPRINT_MODE_SETTINGS, 12345);
    expect(engine.getColorMatchSegments().length).toBe(DEFAULT_COLOR_MATCH_SEGMENTS);
  });

  // --- pace-as-look --- (round two A3a) the pace is the page's start look, never the link base: a bare link, a preset and a
  // project file that leave the field out read the mode's own value (1.17.0's run), and the start look writes its pace out
  it("keeps a link's own value, reads a bare link on the mode's own values, writes the start look's pace and leaves a default link empty", () => {
    for (const mode of PACED) expect(settingsToSearchParams(defaultSettings(mode)).toString(), mode).toBe(`mode=${mode}`);
    const old = settingsFromSearchParams(new URLSearchParams("mode=target&tc=10&s=400&glow=0"));
    expect([old.targetCount, old.ballSpeed, old.showGlow]).toEqual([10, 400, false]);
    expect(settingsToSearchParams(old).toString()).toBe("mode=target"); // (1.17.0's values are the link base)
    const bare = settingsFromSearchParams(new URLSearchParams("mode=target"));
    expect([bare.targetCount, bare.ballSpeed]).toEqual([10, 400]);
    expect(settingsToSearchParams(startSettings("target")).toString()).toBe("mode=target&s=700&tc=7&glow=1");
    expect(settingsFromSearchParams(new URLSearchParams("mode=target&tc=10&s=400")).targetCount).toBe(10);
    expect(settingsFromSearchParams(new URLSearchParams("mode=pendulum&pwt=60&pwk=51")).pwCycleSeconds).toBe(60);
    // a preset that leaves the field out starts from the link base, one that names it keeps it
    expect(presetToSettings({ mode: "mergeRing" }).mrInterval).toBe(0.9); // --- merge-ring-staged ---
    expect(presetToSettings({ mode: "mergeRing", mrTiers: 6, mrInterval: 0.4 })).toMatchObject({ mrTiers: 6, mrInterval: 0.4 });
  });
});

describe("the default run ends inside the default clip", () => {
  // seeds 1–12, both worlds: how many of the 24 runs end by 27 s (measured when this was written; the seeds are fixed)
  // (--- review fix B3 --- Shatter: seeds 1–24 in one world – its rings follow the shorter side only, 450 px in both worlds,
  // so the two worlds played the very same 12 runs twice)
  const INSIDE: Record<string, number> = { target: 24, colorMatch: 20, mergeRing: 24, spiralGlass: 24, shatter: 23 };
  /** --- merge-ring-staged --- Merge Ring's final forms of those 24 runs (the rest overflowed). */
  const MERGE_RING_FINALS = 16;
  const runsOf = (mode: string): [{ width: number; height: number }, number][] =>
    mode === "shatter" ? Array.from({ length: 24 }, (_, i) => [WORLDS[1], i + 1]) : WORLDS.flatMap((world) => Array.from({ length: 12 }, (_, i) => [world, i + 1] as [typeof world, number]));

  for (const mode of ["target", "colorMatch", "shatter" /* --- shatter-demolition --- (its collapse included) */] as const) {
    it(`${mode}: most seeds are out by 27 s, none in the first 5 s`, () => {
      let inside = 0;
      for (const [world, seed] of runsOf(mode)) {
        const end = endOf(mode, seed, world);
        if (end >= 0 && end <= 27) inside++;
        if (end >= 0) expect(end, `${mode} seed ${seed}`).toBeGreaterThan(5);
      }
      expect(inside).toBe(INSIDE[mode]);
      expect(inside).toBeGreaterThanOrEqual(20); // (five in six: before, none of them was)
    });
  }

  it("pendulum and polyrhythm: back in line at 24.0 s on every seed", () => {
    for (const mode of ["pendulum", "polyrhythm"] as const) for (const world of WORLDS) for (const seed of [1, 7]) expect(endOf(mode, seed, world), mode).toBeCloseTo(24, 1);
  });

  // (--- merge-ring-staged --- Merge Ring's verdict is FINAL FORM or OVERFLOW now, the final form more often: a question with two answers)
  it("mergeRing and spiralGlass: their own endings, a verdict of Merge Ring's and GLASS CLEARED, by 27 s on every seed", { timeout: 60000 }, () => {
    for (const mode of ["mergeRing", "spiralGlass"] as const) {
      let inside = 0;
      let finals = 0;
      for (const world of WORLDS) {
        for (let seed = 1; seed <= 12; seed++) {
          const request = finderRequestOfSettings(startSettings(mode), world, 45);
          const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
          let end = -1;
          for (let frame = 1; frame <= 45 * 60 && end < 0; frame++) {
            engine.update(1000 / 60, 0);
            engine.consumeSoundEvents();
            if (engine.isSimulationFinished()) end = frame / 60;
          }
          if (end >= 0 && end <= 27) inside++;
          if (mode === "mergeRing") {
            const mr = engine.getMergeRingView();
            expect(Math.max(mr.finalMs, mr.overflowMs), `seed ${seed}`).toBeGreaterThan(0);
            if (mr.finalMs > 0) finals++;
          } else expect(engine.getSpiralGlassView().clearedMs, `seed ${seed}`).toBeGreaterThan(0);
        }
      }
      expect(inside, mode).toBe(INSIDE[mode]);
      if (mode === "mergeRing") expect(finals).toBe(MERGE_RING_FINALS);
    }
  });
});

describe("what was measured on the old defaults keeps them", () => {
  it("leaves what the crew's role-eval corpus pins: Classic's ring sounds off, Accumulation's defaults, the ring recipes' own gap and speed", () => {
    // the bot's ring recipes run Classic and Accumulation on the page's defaults, and their plans and measured runs are the
    // corpus a recorded eval answers byte for byte (tests/crewEval.test.ts): a new default there is a new corpus
    const classic = defaultSettings("classic");
    expect([classic.ringSound, classic.showGlow, classic.screenShake, classic.wallCount, classic.gapSize, classic.ballSpeed]).toEqual([DEFAULT_RING_ESCAPE_FIELDS.ringSound, false, 0, 7, 0.4, 400]);
    const accumulation = defaultSettings("accumulation");
    expect([accumulation.accumulationTime, accumulation.gapSize, accumulation.ballSpeed, accumulation.showGlow, accumulation.spikesEnabled]).toEqual([4, 0.3, 400, false, false]);
    const ctx = { rng: () => 0.5, bucket: "standard", ending: "resolved", payoffTarget: 20, roster: SERIES_ROSTER } as unknown as Parameters<(typeof RECIPES)[number]["settings"]>[0];
    for (const id of ["ring-escape", "pip-escape", "maze-race"]) {
      // Classic's pace is the recipe's own: its gap and its speed, named in every plan
      const settings = RECIPES.find((r) => r.id === id)!.settings(ctx) as Partial<SimulatorSettings>;
      expect(typeof settings.gapSize, id).toBe("number");
      expect(typeof settings.ballSpeed, id).toBe("number");
      expect("ringSound" in settings || "accumulationTime" in settings, id).toBe(false);
    }
    // the rhythm recipes name their own cycle
    for (const id of ["pendulum-wave", "polyrhythm"]) {
      const settings = RECIPES.find((r) => r.id === id)!.settings(ctx) as Partial<SimulatorSettings>;
      expect(typeof (settings.pwCycleSeconds ?? settings.prCycleSeconds), id).toBe("number");
    }
  });

  it("keeps the gallery's Pendulum Wave preset and the daily Countdown deals on the runs they were picked for", () => {
    const pendulum = settingsFromSearchParams(new URLSearchParams(GALLERY.find((p) => p.id === "galaxy-pendulum")!.query));
    expect([pendulum.pwCycleSeconds, pendulum.pwBaseOscillations]).toEqual([60, 51]);
    const deal = DAILY_POOL.find((entry) => entry.mode === "target")!;
    const daily = settingsFromSearchParams(new URLSearchParams(`mode=target&${deal.look}`));
    expect([daily.targetCount, daily.ballSpeed, daily.showGlow]).toEqual([6, 400, true]);
  });
});

describe("Color Match's segments as a setting", () => {
  it("is a pick of five counts, twelve unless the page says otherwise", () => {
    expect([...COLOR_MATCH_SEGMENT_CHOICES]).toEqual([6, 8, 12, 16, 24]);
    expect(DEFAULT_COLOR_MATCH_SEGMENTS).toBe(12);
    for (const n of COLOR_MATCH_SEGMENT_CHOICES) expect(isColorMatchSegments(n)).toBe(true);
    for (const n of [0, 7, 12.5, 25, 1e9, Number.NaN, "12", null]) expect(isColorMatchSegments(n)).toBe(false);
    expect(startSettings("colorMatch").colorMatchSegments).toBe(8);
    expect(defaultSettings("classic").colorMatchSegments).toBe(12);
  });

  it("travels in a link and a preset, and refuses what is no count", () => {
    const s = { ...startSettings("colorMatch"), colorMatchSegments: 16 };
    const params = settingsToSearchParams(s);
    expect(params.get("cms")).toBe("16");
    expect(settingsFromSearchParams(params).colorMatchSegments).toBe(16);
    expect(settingsFromSearchParams(new URLSearchParams("mode=colorMatch&cms=12")).colorMatchSegments).toBe(12);
    // (--- pace-as-look --- what is no count falls back to the link base's twelve: the mode's own)
    for (const bad of ["7", "1e9", "-6", "abc", ""]) expect(settingsFromSearchParams(new URLSearchParams(`mode=colorMatch&cms=${bad}`)).colorMatchSegments, bad).toBe(12);
    expect(presetToSettings({ mode: "colorMatch", colorMatchSegments: 24 }).colorMatchSegments).toBe(24);
    expect(presetToSettings({ mode: "colorMatch", colorMatchSegments: 1000 } as never).colorMatchSegments).toBe(12);
    expect(presetToSettings({ mode: "colorMatch", colorMatchSegments: "6" } as never).colorMatchSegments).toBe(12);
    expect(settingsFromSearchParams(new URLSearchParams("mode=colorMatch&cms=8")).colorMatchSegments).toBe(8);
  });

  it("builds the ring the run plays: the finder's engine has as many segments as the setting says", () => {
    for (const count of COLOR_MATCH_SEGMENT_CHOICES) {
      const request = finderRequestOfSettings({ ...startSettings("colorMatch"), colorMatchSegments: count }, WORLDS[0], 30);
      expect(request.modeSettings.colorMatchSegmentCount).toBe(count);
      const engine = createEngineForSettings(request.physicsConfig, "colorMatch", request.modeSettings, 3);
      expect(engine.getColorMatchSegments().length).toBe(count);
      // the colours repeat round the ring, each as often as the others where the count divides
      const colours = new Set(engine.getColorMatchSegments().map((seg) => seg.color));
      expect(colours.size).toBe(3);
    }
  });
});

// --- finales-in-clip --- (B6) the modes whose finale fell after the default clip: their page paces and start looks
describe("--- finales-in-clip --- the finale inside the default clip", () => {
  it("gives each mode its measured page pace, and Hoops and Drawing Machines a start look (their link bases stay: the crew's corpus runs them)", () => {
    expect(clipPacingDefaults("runner")).toEqual({ runnerObstacles: 18, runnerDensity: 0.85 });
    expect(clipPacingDefaults("vortex")).toEqual({ vxRelease: "rings" });
    expect(clipPacingDefaults("bullseye")).toEqual({ byShots: 10, byPerfect: -1 }); // (review fix: the last shot by name)
    expect(clipPacingDefaults("race")).toEqual({ rcTrackLength: 6 });
    expect(clipPacingDefaults("journey")).toEqual({ journeyStages: "rings,pegs,glass,multipliers,funnel,home" });
    expect(clipPacingDefaults("orbGrid")).toEqual({ ogCycle: 26 });
    expect(clipPacingDefaults("maze")).toEqual({ mzFirstOut: true, mzDuration: 25, mzCols: 14 }); // (review fix: 14 columns)
    expect(clipPacingDefaults("paddle")).toEqual({ pdGoal: 20 });
    expect(clipPacingDefaults("hoops")).toEqual({});
    expect(clipPacingDefaults("drawingMachine")).toEqual({});
    expect(clipStartSettings("hoops")).toEqual({ backgroundType: "solid", backgroundColors: ["#0b1020", "#0b1020"], themeId: "", rainbowWalls: true, showWallGlow: true, loopHud: true, hpOmegaStart: 0.5 });
    expect(clipStartSettings("drawingMachine")).toEqual({ dmMachine: "orbits", backgroundType: "solid", backgroundColors: ["#05060c", "#05060c"], loopHud: true });
    for (const mode of ["hoops", "drawingMachine"] as const) {
      const start: SimulatorSettings = startSettings(mode);
      expect(settingsFromSearchParams(settingsToSearchParams(start)), mode).toMatchObject(clipStartSettings(mode));
    }
  });

  // measured when this was written (seeds 1–12, both worlds): every run over by 30.0 s, its end card and holds included –
  // Beat Runner 20.1–24.1 s (before: 30.1–34.6 s, none by 30), Sound Vortex 22.5 s (29.1–31.0 s, 5 of 12), Bullseye 23.9–26.5 s
  // (28.6–31.7 s, 6 of 12), Race 18.4–29.7 s, the podium on screen from 26.2 s at the latest (26.1–37.0 s, 10 of 12),
  // Journey 17.4–23.6 s (26.1–38.5 s, 5 of 12), Maze 6.2–27.5 s (8.6–58.8 s, 8 of 12), Paddle Keep-Up 10.6–28.6 s, a win or
  // a GAME OVER (10.6–43.0 s, 7 of 12, every one a GAME OVER)
  it("ends every default run by 30 s, its end card included, never in the first 5 s", { timeout: 180_000 }, () => {
    for (const mode of ["runner", "vortex", "bullseye", "race", "journey", "maze", "paddle"] as const) {
      for (const world of WORLDS) {
        for (let seed = 1; seed <= 6; seed++) {
          const end = endOf(mode, seed, world, 40);
          expect(end, `${mode} seed ${seed} ${world.width}`).toBeGreaterThan(5);
          expect(end, `${mode} seed ${seed} ${world.width}`).toBeLessThanOrEqual(30);
        }
      }
    }
  });

  it("lands Bullseye's last shot in the bull on every seed (before: no bullseye at all on 3 of 12)", () => {
    for (let seed = 1; seed <= 6; seed++) {
      const request = finderRequestOfSettings(startSettings("bullseye"), WORLDS[1], 40);
      const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
      for (let frame = 1; frame <= 40 * 60 && !engine.isSimulationFinished(); frame++) engine.update(1000 / 60, 0);
      const view = engine.getBullseyeView();
      expect(view.perfectShot, `seed ${seed}`).toBe(9);
      expect(view.bullseyes, `seed ${seed}`).toBeGreaterThanOrEqual(1);
    }
  });

  // (--- finales-in-clip --- review fix: the rigged shot was shot 10 by number – shot 10 of 15 in the bull and not the last, and no
  // rigged shot at all below 10 shots; the page's −1 is the last shot, whatever Shots says)
  it("steers Bullseye's last shot into the bull whatever the number of shots", { timeout: 60_000 }, () => {
    expect([perfectShotIndex({ perfect: -1, shots: 8 }), perfectShotIndex({ perfect: -1, shots: 15 }), perfectShotIndex({ perfect: -1, shots: 1 }), perfectShotIndex({ perfect: 10, shots: 8 })]).toEqual([7, 14, 0, -1]);
    for (const shots of [8, 15]) {
      for (const seed of [3, 4]) {
        const request = finderRequestOfSettings({ ...startSettings("bullseye"), byShots: shots }, WORLDS[seed % 2], 60);
        const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
        for (let frame = 1; frame <= 60 * 60 && !engine.isSimulationFinished(); frame++) engine.update(1000 / 60, 0);
        const view = engine.getBullseyeView();
        expect([shots, seed, view.finished, view.perfectShot, view.shotRing[shots - 1]], `${shots} shots, seed ${seed}`).toEqual([shots, seed, true, shots - 1, 0]);
      }
    }
  });
});

// --- find-target-follows --- (round two A2b) Find's target follows the run on the page: the page's own target moves with every
// change that makes another run (a share code, a preset, a project file, the daily, a batch job, the bot's clip, a picker card, the
// Looks row, Reset), a typed one stays while the mode does, and a look's run gets its own measured target
describe("--- find-target-follows --- Find's target follows the run on the page", () => {
  const auto = (mode: ModeId, sec: number): FindTargetAuto => ({ mode, sec });
  /** The page's Find target as Simulator.tsx keeps it: the target, and the one the page last set (its ref). */
  function page(first: SimulatorSettings) {
    let last = auto(first.mode, clipPacingFindSec(first));
    let target = last.sec;
    let typed = false; // (A-g1 review) the page's findTypedRef: the slider or the number field moved it, cleared by a mode change
    return {
      put(settings: SimulatorSettings) {
        const next = auto(settings.mode, clipPacingFindSec(settings));
        if (next.mode !== last.mode) typed = false;
        target = nextFindTarget(last, target, next, typed);
        last = next;
        return target;
      },
      type(sec: number) {
        target = sec;
        typed = true;
      },
    };
  }
  /** `look` of `mode`'s Looks row put on the page's start look (the row's own patch). */
  function onLook(mode: ModeId, look: string): SimulatorSettings {
    const start = startSettings(mode);
    const row = lookRow(mode);
    const found = row.looks.find((entry) => entry.id === look);
    if (!found) throw new Error(`${mode} has no look ${look}`);
    return { ...start, ...lookPatch(row, found, start) };
  }

  it("follows the page's own target, keeps a typed one while the mode stays, and starts a new mode on its own", () => {
    // the page's own: a look, a share code, a preset or Reset put another run on the page
    expect(nextFindTarget(auto("runner", 22), 22, auto("runner", 20.5), false)).toBe(20.5);
    expect(nextFindTarget(auto("runner", 20.5), 20.5, auto("runner", 22), false)).toBe(22);
    // typed: it stays while the mode does, whatever run comes on
    expect(nextFindTarget(auto("runner", 22), 25, auto("runner", 20.5), true)).toBe(25);
    expect(nextFindTarget(auto("runner", 22), 25, auto("runner", 30), true)).toBe(25);
    // (A-g1 review) typed even when it equals a run's own target: a typed 30 stays through a look of 30 and back to the start
    // look's 18 (before, a typed value equal to the page's last own target read as the page's and followed the next run)
    expect(nextFindTarget(auto("classic", 18), 30, auto("classic", 30), true)).toBe(30);
    expect(nextFindTarget(auto("classic", 30), 30, auto("classic", 18), true)).toBe(30);
    // a mode change resets it, typed or not, as picking the mode does
    expect(nextFindTarget(auto("classic", 30), 30, auto("runner", 22), false)).toBe(22);
    expect(nextFindTarget(auto("classic", 30), 12, auto("runner", 22), true)).toBe(22);
    expect(nextFindTarget(auto("runner", 22), 25, auto("classic", 30), true)).toBe(30);
    // nothing changed
    expect(nextFindTarget(auto("runner", 22), 22, auto("runner", 22), false)).toBe(22);
    expect(nextFindTarget(auto("runner", 22), 25, auto("runner", 22), true)).toBe(25);
  });

  // before: a share code (?c=) starts the page on Classic's link base, and only a mode picked on the page set the target, so
  // every paced mode loaded from a code searched for 30 s – Beat Runner, Paddle Keep-Up, Journey, the Maze and Spiral Glass found
  // no seed in 1,000 (final review, modes-missed-25)
  it("gives a paced mode loaded from a share code, a preset or a project file its own target", () => {
    for (const mode of PACED) {
      const own = clipPacingFindSec(startSettings(mode));
      expect([mode, page(defaultSettings("classic")).put(startSettings(mode))]).toEqual([mode, own]);
    }
    expect(PACED.filter((mode) => clipPacingFindSec(startSettings(mode)) !== 30)).toEqual(PACED.filter((mode) => mode !== "territory" && mode !== "orbGrid"));
  });

  it("walks the page's routes: a card, a look, Reset, a typed target and a batch over other modes", () => {
    const studio = page(startSettings("runner"));
    expect(studio.put(onLook("runner", "card"))).toBe(20.5); // the card's denser course
    expect(studio.put(onLook("runner", "retro-runner"))).toBe(25.5); // a gallery look, 24 obstacles
    expect(studio.put(startSettings("runner"))).toBe(22); // Reset: the start look again
    studio.type(24);
    expect(studio.put(onLook("runner", "card"))).toBe(24); // typed: kept through a look
    expect(studio.put(startSettings("runner"))).toBe(24);
    expect(studio.put(startSettings("maze"))).toBe(15); // another mode (a batch job, a share code) starts on its own
    expect(studio.put(onLook("maze", "card"))).toBe(10.5);
    expect(studio.put(startSettings("runner"))).toBe(22); // the page's own settings back: its own target
    // (A-g1 review) a typed target equal to a look's own: the bare studio (Classic's start look, 18), 30 typed, Neon Escape (30)
    // and Plain again keep the 30 the visitor typed (before, Plain took it back to 18)
    const classic = page(startSettings("classic"));
    classic.type(30);
    expect(classic.put(onLook("classic", "neon-escape"))).toBe(30);
    expect(classic.put(startSettings("classic"))).toBe(30);
  });

  it("looks up an exact look first, then the start look, then the pace, then the page's 30", () => {
    // an exact look before the pace: Shatter's card has every field of the pace and a ball of 11
    expect(clipPacingFindSec(startSettings("shatter"))).toBe(15);
    expect(clipPacingFindSec({ ...startSettings("shatter"), ballRadius: 11 })).toBe(13);
    // an exact look needs every field of its run: Beat Runner's density 1 on the pace's 18 obstacles, on 24, and the 1.17.0 course
    expect(clipPacingFindSec({ ...startSettings("runner"), runnerDensity: 1 })).toBe(20.5);
    expect(clipPacingFindSec({ ...startSettings("runner"), runnerObstacles: 24, runnerDensity: 1 })).toBe(25.5);
    expect(clipPacingFindSec({ ...startSettings("runner"), runnerObstacles: 24, runnerDensity: 0.6 })).toBe(30);
    // the start look before the page's 30, with every field of its run; its sounds, effects and glow are its look
    expect(clipPacingFindSec(startSettings("classic"))).toBe(18);
    expect(clipPacingFindSec(defaultSettings("classic"))).toBe(30);
    expect(clipPacingFindSec({ ...startSettings("classic"), gapSize: 0.4 })).toBe(30);
    expect(clipPacingFindSec({ ...startSettings("classic"), ringSound: false, screenShake: 0, showGlow: false, wallBreakStyle: defaultSettings("classic").wallBreakStyle })).toBe(18);
    // the pace, then the page's 30
    expect(clipPacingFindSec(startSettings("runner"))).toBe(22);
    expect(clipPacingFindSec(startSettings("territory"))).toBe(30);
  });

  // measured when this was written: seeds 1–100 in the page's two worlds (800 × 450 and 450 × 450, which agree for these looks),
  // through the page's own request, the target at or above the Find slider's 10 s with the most runs within ± 0.5 s
  // (lib/clipPacing.ts START_FIND_SEC and LOOK_FIND_SEC). Before: the look kept the target its mode started with (the start look's, or 30); "-" marks a look this step
  // leaves where it was
  const TARGETS: Record<string, number> = {
    "classic/start": 18, // before 30 (1 run of 200 within ± 0.5 s; now 27)
    "classic/card": 18, // (0; 26)
    "classic/daily": 36, // (3; 13)
    "accumulation/start": 14.5, // (4; 12)
    "multiply/start": 19, // (0; 82)
    "grow/start": 19.5, // (0; 114)
    "illusion/start": 16, // its four cycles, every seed (30 s: "always 16.0 s")
    "illusion/hidden-heart": 21, // (0; 78)
    "collide/start": 19.5, // (0; 192)
    "box/start": 19.5, // (0; 46)
    "box/card": 19.5, // (0; 20)
    "glass/start": 24, // (0; 50)
    "conveyor/start": 24, // (0; 69)
    "conveyor/pastel-conveyor": 21, // (0; 93)
    "conveyor/bowl-overflow": 25.5, // (0; 109)
    "ctf/start": 20, // (8; 12)
    "target/daily": 20, // - (20)
    "pendulum/galaxy-pendulum": 60, // IN LINE! at 60.0 s (before 24: "always 60.0 s")
    "polyrhythm/polygon-polyrhythm": 12, // in phase at 12.0 s (before 24)
    "spiralGlass/card": 19.5, // (0; 182)
    "spiralGlass/sunset-spiral": 19.5, // (0; 182)
    "shatter/card": 13, // (2; 22)
    "runner/card": 20.5, // (22; 104)
    "runner/retro-runner": 25.5, // (0; 86)
    "vortex/neon-vortex": 41.5, // (0; 98)
    "vortex/daily": 30, // (0; 82)
    "bullseye/card": 10, // (0; 76)
    "bullseye/candy-darts": 10.5, // (0; 94)
    "race/grand-prix": 30, // (0; 30)
    "journey/card": 22.5, // (32; 42)
    "journey/pastel-commute": 22.5, // (32; 42)
    "maze/card": 10.5, // (12; 20)
    "maze/red-maze-race": 30, // (6; 10)
    "paddle/sunset-keep-up": 19.5, // (8; 12)
    "paint/rainbow-paint": 67.5, // (0; 20)
    "portal/aurora-portals": 30, // (0; 10)
    "portal/daily": 30, // (6; 4: Portal's link base, which keeps the page's 30)
    "lines/string-art": 30, // the finder reads it as endless
  };

  it("gives each look its own target", () => {
    for (const [key, sec] of Object.entries(TARGETS)) {
      const [mode, look] = key.split("/") as [ModeId, string];
      expect([key, clipPacingFindSec(look === "start" ? startSettings(mode) : onLook(mode, look))]).toEqual([key, sec]);
    }
  });

  // seeds 1–12 of the laptop world (1–6 for the three costliest runs, 1–20 for the two looks with the fewest runs on a target),
  // the page's own request: the target lands at least one run within ± 0.5 s, and at least as many as the page's 30 (Classic's
  // Challenge look 1 and 1 here, 13 and 3 of 200); a fixed-length run is its target
  const SEEDS_OF: Record<string, number> = { "collide/start": 6, "conveyor/bowl-overflow": 6, "multiply/start": 6, "classic/daily": 20, "ctf/start": 20 };
  it("lands the runs of each look it gives a target", { timeout: 240_000 }, () => {
    const world = { width: 800, height: 450 };
    const near = (ends: number[], t: number) => ends.filter((end) => Math.abs(end - t) <= 0.5 + 1e-9).length;
    for (const [key, sec] of Object.entries(TARGETS)) {
      if (sec === 30) continue;
      const [mode, look] = key.split("/") as [ModeId, string];
      const settings = look === "start" ? startSettings(mode) : onLook(mode, look);
      const request = pageFinderRequest(settings, { physicsConfig: physicsConfigOfSettings(settings, world), targetSec: sec, toleranceSec: 0.5, maxSeeds: 1000, depthBudgetMs: 0, panelTargetSec: sec, panelToleranceSec: 0.5, rhythmBeat: null, melody: [], onBeat: onBeatConfigOfSettings(settings), paintPicture: false });
      const fixed = fixedRunDurationSec(mode, request.modeSettings);
      if (fixed !== null) {
        expect([key, Math.abs(fixed - sec) <= 0.5]).toEqual([key, true]);
        continue;
      }
      const ends: number[] = [];
      for (let seed = 1; seed <= (SEEDS_OF[key] ?? 12); seed++) ends.push(simulateSeed(seed, request, request.maxSimTimeSec * 1000) / 1000);
      expect([key, near(ends, sec) >= 1, near(ends, sec) >= near(ends, 30)]).toEqual([key, true, true]);
    }
  });

  it("leaves out of a start look's run only fields that leave the run as it is", { timeout: 60_000 }, () => {
    const world = { width: 800, height: 450 };
    // seeds 1–3 (Collision Playground's 300 orbs: seed 1)
    const lengths = (settings: SimulatorSettings) => (settings.mode === "collide" ? [1] : [1, 2, 3]).map((seed) => simulateSeed(seed, pageFinderRequest(settings, { physicsConfig: physicsConfigOfSettings(settings, world), targetSec: 30, toleranceSec: 0.5, maxSeeds: 1, depthBudgetMs: 0, panelTargetSec: 30, panelToleranceSec: 0.5, rhythmBeat: null, melody: [], onBeat: onBeatConfigOfSettings(settings), paintPicture: false }), 90_000));
    const ignored: string[] = [];
    for (const mode of MODE_IDS) {
      const start = startSettings(mode);
      const target = clipPacingFindSec(start);
      if (target === 30 || Object.keys(clipPacingDefaults(mode)).length > 0) continue;
      const base = defaultSettings(mode);
      for (const key of Object.keys(clipStartSettings(mode)) as (keyof SimulatorSettings)[]) {
        const off = { ...start, [key]: base[key] } as SimulatorSettings;
        if (clipPacingFindSec(off) !== target) continue; // a run field: the start look's target goes with it
        ignored.push(`${mode}.${key}`);
        expect([mode, key, lengths(off)]).toEqual([mode, key, lengths(start)]);
      }
    }
    expect(ignored.sort()).toEqual(["classic.ringSound", "classic.screenShake", "classic.showGlow", "classic.wallBreakStyle", "accumulation.showGlow", "collide.cpPulse", "collide.cpSquishy", "glass.glassLead", "grow.growHue", "grow.growMarkers", "grow.growPitch", "lines.rainbowLines"].sort());
  });
});
// --- end find-target-follows ---
