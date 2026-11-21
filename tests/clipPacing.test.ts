import { describe, expect, it } from "vitest";
import { GALLERY } from "@/content/gallery";
import { DAILY_POOL } from "@/lib/dailyCore";
import { FINGERPRINT_CONFIG, FINGERPRINT_MODE_SETTINGS } from "@/lib/agentKit/fingerprint";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { RECIPES, SERIES_ROSTER } from "@/lib/bot/playbook";
import { DEFAULT_RING_ESCAPE_FIELDS } from "@/lib/physics/ringEscape";
import { clipPacingDefaults, clipStartSettings } from "@/lib/clipPacing";
import { COLOR_MATCH_SEGMENT_CHOICES, DEFAULT_COLOR_MATCH_SEGMENTS, isColorMatchSegments } from "@/lib/physics/modes/colorMatch";
import { DEFAULT_MERGE_RING_SETTINGS } from "@/lib/physics/modes/mergeRing";
import { DEFAULT_PENDULUM_SETTINGS } from "@/lib/physics/modes/pendulum";
import { DEFAULT_POLYRHYTHM_SETTINGS } from "@/lib/physics/modes/polyrhythm";
import { DEFAULT_SPIRAL_GLASS_SETTINGS } from "@/lib/physics/modes/spiralGlass";
import { perfectShotIndex } from "@/lib/physics/modes/bullseye"; // --- finales-in-clip --- (review fix)
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";

/*
 * --- clip-pacing --- The page's own defaults of the modes whose default run did not end inside the default 30 s clip
 * (lib/clipPacing.ts), and Color Match's segment count as a setting:
 *  - what each mode starts with, and that no other mode's defaults moved;
 *  - the default run's own end inside 27 s (the end banner's 2 s still fit a 30 s clip), measured on seeds 1–12 in the
 *    laptop world and the phone world;
 *  - only page defaults: the modes' own constants and the fingerprint recipe are what they were, a link that names the old
 *    value keeps it, and the Color Match template, the gallery and the card pictures write the old values out;
 *  - nothing the crew's role-eval corpus pins moved: Classic's ring sounds and Accumulation's defaults stay as they were.
 */

const PACED: ModeId[] = ["target", "colorMatch", "pendulum", "polyrhythm", "mergeRing", "spiralGlass", "shatter" /* --- shatter-demolition --- */, "territory" /* --- territory-swing --- */, "runner", "vortex", "bullseye", "race", "journey", "orbGrid", "maze", "paddle" /* --- finales-in-clip --- */];
const WORLDS = [
  { width: 800, height: 450 },
  { width: 450, height: 450 },
];

/** The default run of `mode` for `seed` in `world`: when it ends (s), or −1 when it has not by `maxSec`. */
function endOf(mode: ModeId, seed: number, world: { width: number; height: number }, maxSec = 45): number {
  const request = finderRequestOfSettings(defaultSettings(mode), world, maxSec);
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
      const d = defaultSettings(mode) as unknown as Record<string, unknown>;
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

  it("keeps a link's own value, writes one that differs from the new default, and leaves a default link empty", () => {
    for (const mode of PACED) expect(settingsToSearchParams(defaultSettings(mode)).toString(), mode).toBe(`mode=${mode}`);
    const old = settingsFromSearchParams(new URLSearchParams("mode=target&tc=10&s=400&glow=0"));
    expect([old.targetCount, old.ballSpeed, old.showGlow]).toEqual([10, 400, false]);
    expect(settingsToSearchParams(old).toString()).toBe("mode=target&s=400&tc=10&glow=0");
    const bare = settingsFromSearchParams(new URLSearchParams("mode=target"));
    expect([bare.targetCount, bare.ballSpeed]).toEqual([7, 700]);
    expect(settingsFromSearchParams(new URLSearchParams("mode=target&tc=10&s=400")).targetCount).toBe(10);
    expect(settingsFromSearchParams(new URLSearchParams("mode=pendulum&pwt=60&pwk=51")).pwCycleSeconds).toBe(60);
    // a preset that leaves the field out starts from the page's default, one that names it keeps it
    expect(presetToSettings({ mode: "mergeRing" }).mrInterval).toBe(0.4); // --- merge-ring-staged ---
    expect(presetToSettings({ mode: "mergeRing", mrTiers: 6, mrInterval: 0.9 })).toMatchObject({ mrTiers: 6, mrInterval: 0.9 });
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
          const request = finderRequestOfSettings(defaultSettings(mode), world, 45);
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
    expect(defaultSettings("colorMatch").colorMatchSegments).toBe(8);
    expect(defaultSettings("classic").colorMatchSegments).toBe(12);
  });

  it("travels in a link and a preset, and refuses what is no count", () => {
    const s = { ...defaultSettings("colorMatch"), colorMatchSegments: 16 };
    const params = settingsToSearchParams(s);
    expect(params.get("cms")).toBe("16");
    expect(settingsFromSearchParams(params).colorMatchSegments).toBe(16);
    expect(settingsFromSearchParams(new URLSearchParams("mode=colorMatch&cms=12")).colorMatchSegments).toBe(12);
    for (const bad of ["7", "1e9", "-6", "abc", ""]) expect(settingsFromSearchParams(new URLSearchParams(`mode=colorMatch&cms=${bad}`)).colorMatchSegments, bad).toBe(8);
    expect(presetToSettings({ mode: "colorMatch", colorMatchSegments: 24 }).colorMatchSegments).toBe(24);
    expect(presetToSettings({ mode: "colorMatch", colorMatchSegments: 1000 } as never).colorMatchSegments).toBe(8);
    expect(presetToSettings({ mode: "colorMatch", colorMatchSegments: "6" } as never).colorMatchSegments).toBe(8);
  });

  it("builds the ring the run plays: the finder's engine has as many segments as the setting says", () => {
    for (const count of COLOR_MATCH_SEGMENT_CHOICES) {
      const request = finderRequestOfSettings({ ...defaultSettings("colorMatch"), colorMatchSegments: count }, WORLDS[0], 30);
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
      const start = { ...defaultSettings(mode), ...clipStartSettings(mode) } as SimulatorSettings;
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
      const request = finderRequestOfSettings(defaultSettings("bullseye"), WORLDS[1], 40);
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
        const request = finderRequestOfSettings({ ...defaultSettings("bullseye"), byShots: shots }, WORLDS[seed % 2], 60);
        const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, seed);
        for (let frame = 1; frame <= 60 * 60 && !engine.isSimulationFinished(); frame++) engine.update(1000 / 60, 0);
        const view = engine.getBullseyeView();
        expect([shots, seed, view.finished, view.perfectShot, view.shotRing[shots - 1]], `${shots} shots, seed ${seed}`).toEqual([shots, seed, true, shots - 1, 0]);
      }
    }
  });
});

