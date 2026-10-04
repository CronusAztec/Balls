import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_STRING_CIRCLE_SETTINGS,
  FAN_BUCKETS,
  FanIndex,
  SC_ARC_JOIN,
  SC_CUT_SPAN,
  SC_DISSOLVE_GHOSTS,
  SC_HEX_APOTHEM,
  SC_LINEUP,
  SC_PRESET_IDS,
  SC_RIM_BINS,
  SC_SNAP_GAP_STEPS,
  SC_STRING_CEILING,
  SC_TITLE_LENGTH,
  SC_TWANG_GAP_STEPS,
  SC_TWANG_MIDI,
  SC_TWANG_NOTES,
  STRING_CIRCLE_RANGES,
  anchorsDue,
  bearingDelta,
  circleLineup,
  circleSettingsOf,
  colorsClash,
  coverageLeaders,
  coverageText,
  createCoverage,
  fanText,
  hexNormal,
  pseudoAngle,
  rimAt,
  rimBin,
  rimHit,
  sanitizeScTitle,
  scCuts,
  snapFrequency,
  snapLevel,
  stringCirclePresetPatch,
  twangFrequency,
  updateCoverage,
  wallOverlap,
  type ScStringLike,
} from "@/lib/physics/modes/stringCircle";
import { SB_INVULN_MS, SB_STYLES, StringBattleMode, cutsThread, resolveStringBattleSettings, sbHudShown, stringBattleSettingsOf, type StringBattleSettings } from "@/lib/physics/modes/stringBattle";
import { COUNTRIES, countryByCode, countryOfFlag, countryTeamEntry, flagOf } from "@/lib/countries";
import { STRING_CEILING } from "@/lib/uncap";
import { midiToFrequency } from "@/lib/audio/scales";
import { SNAP_TONE, TWANG_TONE, scLevel, scheduleSnap, scheduleTwang } from "@/lib/audio/stringCircleTones";
import { NoiseCache } from "@/lib/audio/stringBattleTones";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { MAX_TEAMS } from "@/lib/physics/ballStats";
import { arenaRadius, type Ball, type ModeContext, type NewBall, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, findSimulation, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeMatches } from "@/lib/simulation/outcomes";
import { MAX_TEAM_NAME_LENGTH, rosterPatch } from "@/lib/teams";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { TeamLayer, type TeamLabels } from "@/components/simulator/teamsRenderer";
import { DEFAULT_STRING_CIRCLE_LABELS, STRING_CIRCLE_DATA_KEYS, StringCircleLayer, fanColor, writeStringCircleDataset, type StringCircleRenderOptions } from "@/components/simulator/stringCircleRenderer";
import { STRING_BATTLE_KEYS } from "@/components/simulator/sections/StringBattleSection";
import { STRING_CIRCLE_KEYS } from "@/components/simulator/sections/StringCircleSection";
import { teamChoiceNames } from "@/components/simulator/FinderOutcomeFields";
import { fakeGraph } from "./fakeAudio";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * The String Circle style of the String Battle (lib/physics/modes/stringCircle.ts, feature string-circle): the settings (resolve,
 * URL, presets), the geometry (the rim point ahead, the hexagon, the cut test), the anchor cadence, the cuts and the lives, the
 * coverage maths, the battle in the engine (the line-up, the strings' ceiling, the clip-limit verdict, the rig, the sounds,
 * exact replays at two frame rates, a resize), the finder, the teams banner of a mega fight, the drawing's data, the
 * countries, the roster fill and the messages.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 450,
  gravity: 0,
  bounce: 1,
  damping: 0,
  ballSpeed: 400,
  rotationSpeed: 1,
  wallCount: 7,
  gapSize: 0.4,
  ballColor: "#ffffff",
  ballRadius: 8,
  audioIntensity: 0,
};

const modeSettings: ModeSettings = {
  bouncierEnabled: false,
  countdownTotal: 10,
  countdownRandom: false,
  colorMatchColorCount: 7,
  accumulationTimerMax: 4000,
  spikesEnabled: false,
  spikeCount: 6,
  multiplySpawnCount: 3,
  shatterSegmentsPerWall: 18,
  shatterHpPerSegment: 1,
  growRate: 5,
  portalCount: 3,
  twoBalls: false,
  drop: {},
  box: {},
};

const STEP = 1000 / 60;

function circle(patch: Partial<StringBattleSettings> = {}, seed = 11, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "stringBattle", { ...modeSettings, stringBattle: { style: "circle", ...patch } }, seed);
}

function run(engine: ReturnType<typeof circle>, ms: number, events: SoundEvent[] = []) {
  for (let t = 0; t < ms; t += STEP) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

function runToEnd(engine: ReturnType<typeof circle>, maxMs = 240_000, events: SoundEvent[] = []) {
  let t = 0;
  while (t < maxMs && !engine.isSimulationFinished()) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
    t += STEP;
  }
  return t;
}

/* ------------------------------------------------------------------ a hand-made context for the rules */

interface Probe {
  ctx: ModeContext;
  balls: Ball[];
  sounds: SoundEvent[];
  setTime(ms: number): void;
}

function probe(cfg: PhysicsConfig = config): Probe {
  let balls: Ball[] = [];
  let nextId = 0;
  let time = 0;
  let seed = 7;
  const p: Probe = { balls, sounds: [], setTime: (ms) => void (time = ms), ctx: {} as ModeContext };
  p.ctx = {
    config: cfg,
    getBalls: () => balls,
    setBalls: (next: Ball[]) => {
      balls = next;
      p.balls = next;
    },
    addBall: (b: NewBall) => {
      balls.push({ ...b, id: nextId++, trail: [], trailIndex: 0, spin: 0, angle: 0 });
      p.balls = balls;
    },
    getNextId: () => nextId,
    random: () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    },
    getElapsedMs: () => time,
    addPendingSoundEvent: (e: SoundEvent) => void p.sounds.push(e),
    recordWallContact: () => undefined,
    addWallHit: () => undefined,
    getPhysicsExtras: () => ({ airDrag: 0, windX: 0, windY: 0, spinStrength: 0, wallBounciness: 1, breathingAmplitude: 0, breathingSpeed: 1, rotatingGravity: 0 }),
    creditBounce: () => undefined,
    creditEscape: () => undefined,
    creditWallBreak: () => undefined,
    noteNearMiss: () => undefined,
    noteImpact: () => undefined,
    setDestructionMode: () => undefined,
    setInfiniteMode: () => undefined,
    setBounceSpeedMultiplier: () => undefined,
  } as unknown as ModeContext;
  return p;
}

/** A circle-style battle started in a probe context. */
function fight(settings: Partial<StringBattleSettings>) {
  const mode = new StringBattleMode();
  mode.setSettings({ style: "circle", ...settings });
  const pr = probe();
  mode.init(pr.ctx);
  return { mode, pr, view: mode.getView() };
}

/** Gives `slot` a fan of `n` strings anchored on the rim between bearings a0 and a1, its ball at (x, y). */
function giveFan(mode: StringBattleMode, pr: Probe, slot: number, x: number, y: number, a0: number, a1: number, n: number) {
  const v = mode.getView();
  const f = v.fighters[slot];
  const ball = pr.balls.find((b) => b.team === slot)!;
  ball.x = f.x = f.px = x;
  ball.y = f.y = f.py = y;
  ball.vx = ball.vy = 0;
  f.strings.length = 0;
  for (let k = 0; k < n; k++) {
    const a = a0 + ((a1 - a0) * k) / Math.max(1, n - 1);
    f.strings.push({ ax: v.cx + v.radius * Math.cos(a), ay: v.cy + v.radius * Math.sin(a), angle: a, bornMs: 0, serial: k });
  }
  return f;
}

/** Moves the ball of `slot` from (x0, y0) to (x1, y1) as one sub-step (the post-sub-step pass sees the move). */
function sweep(mode: StringBattleMode, pr: Probe, slot: number, x0: number, y0: number, x1: number, y1: number) {
  const ball = pr.balls.find((b) => b.team === slot)!;
  const f = mode.getView().fighters[slot];
  f.px = x0;
  f.py = y0;
  ball.x = x1;
  ball.y = y1;
  mode.onPostSubStep(pr.ctx);
}

/** Runs `body` with requestAnimationFrame on a timer (the finder yields to the page between batches). */
async function withFrames<T>(body: () => Promise<T>): Promise<T> {
  const raf = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as unknown as number) as typeof requestAnimationFrame;
  try {
    return await body();
  } finally {
    globalThis.requestAnimationFrame = raf;
  }
}

/* ------------------------------------------------------------------ settings */

describe("string circle settings", () => {
  it("adds the circle style to the String Battle with its defaults and comfort ranges", () => {
    expect(SB_STYLES).toEqual(["web", "neon", "circle"]);
    expect(DEFAULT_STRING_CIRCLE_SETTINGS).toEqual({ arena: "circle", rate: 30, cut: 200, title: "" });
    expect(resolveStringBattleSettings(null)).toMatchObject({ style: "web", arena: "circle", rate: 30, cut: 200, title: "" });
    for (const key of Object.keys(STRING_CIRCLE_RANGES) as (keyof typeof STRING_CIRCLE_RANGES)[]) expect(RANGES[key]).toEqual(STRING_CIRCLE_RANGES[key]);
    const d = defaultSettings("stringBattle");
    expect([d.sbStyle, d.sbArena, d.sbRate, d.sbCut, d.sbTitle]).toEqual(["web", "circle", 30, 200, ""]);
    expect(stringBattleSettingsOf(d)).toMatchObject({ arena: "circle", rate: 30, cut: 200, title: "" });
    // The circle style's HUD (the standings strip) takes the scoreboard's place like the web style's; the neon art has none.
    expect([sbHudShown({ hud: true, style: "circle" }), sbHudShown({ hud: false, style: "circle" }), sbHudShown({ hud: true, style: "neon" })]).toEqual([true, false, false]);
  });

  it("validates the circle fields: a known arena, whole counts lifted onto the slider's minimum and never capped, a clean title", () => {
    expect(resolveStringBattleSettings({ arena: "hexagon", rate: 7.6, cut: 0, title: "  COUNTRY\nFIGHT" })).toMatchObject({ arena: "hexagon", rate: 8, cut: 1, title: "COUNTRY FIGHT" });
    expect(resolveStringBattleSettings({ rate: 5000, cut: 1e6 })).toMatchObject({ rate: 5000, cut: 1e6 });
    const junk = { arena: "octagon", rate: "x", cut: Number.NaN, title: 42 } as unknown as Partial<StringBattleSettings>;
    expect(resolveStringBattleSettings(junk)).toMatchObject({ arena: "circle", rate: 30, cut: 200, title: "" });
    expect(sanitizeScTitle("x".repeat(100))).toHaveLength(SC_TITLE_LENGTH);
    expect(sanitizeScTitle("A B\tC")).toBe("A B C");
    expect(circleSettingsOf({})).toEqual(DEFAULT_STRING_CIRCLE_SETTINGS);
  });

  it("round-trips through the URL (sbst, sba, sbrt, sbc, sbti) and leaves the defaults out", () => {
    const s: SimulatorSettings = { ...defaultSettings("stringBattle"), sbStyle: "circle", sbArena: "hexagon", sbRate: 45, sbCut: 120, sbTitle: "COUNTRY FIGHT" };
    const params = settingsToSearchParams(s);
    expect([params.get("sbst"), params.get("sba"), params.get("sbrt"), params.get("sbc"), params.get("sbti")]).toEqual(["circle", "hexagon", "45", "120", "COUNTRY FIGHT"]);
    const back = settingsFromSearchParams(params);
    expect([back.sbStyle, back.sbArena, back.sbRate, back.sbCut, back.sbTitle]).toEqual(["circle", "hexagon", 45, 120, "COUNTRY FIGHT"]);
    const plain = settingsToSearchParams(defaultSettings("stringBattle"));
    for (const key of ["sba", "sbrt", "sbc", "sbti"]) expect(plain.has(key)).toBe(false);
    // Junk in a link falls back; a big rate is kept (uncapped).
    const odd = settingsFromSearchParams(new URLSearchParams("mode=stringBattle&sbst=circle&sba=cube&sbrt=999&sbc=-3"));
    expect([odd.sbArena, odd.sbRate, odd.sbCut]).toEqual(["circle", 999, 1]);
  });

  it("ships the five country-fight presets: the circle style, their flags, a line-up past the roster and a clip for their battles", () => {
    expect([...SC_PRESET_IDS]).toEqual(["indiaUsa", "countries4", "mega12", "hexagon6", "classic5"]);
    const codes = (id: (typeof SC_PRESET_IDS)[number]) => stringCirclePresetPatch(id).teams.map((t) => countryOfFlag(t.emoji)!.code);
    expect(codes("indiaUsa")).toEqual(["IN", "US"]);
    expect(codes("countries4")).toEqual(["TR", "IN", "US", "IR"]);
    expect(codes("mega12")).toHaveLength(MAX_TEAMS);
    for (const id of SC_PRESET_IDS) {
      const p = stringCirclePresetPatch(id, (code) => `name-${code}`);
      expect(p).toMatchObject({ sbStyle: "circle", sbDuration: 0, sbBadge: false, sbHud: true, sbTitle: "" });
      expect(p.teams.length).toBeLessThanOrEqual(MAX_TEAMS);
      expect(p.teams.length).toBeLessThanOrEqual(p.sbBalls);
      for (const t of p.teams) {
        expect(t.name).toBe(`name-${countryOfFlag(t.emoji)!.code}`);
        expect(t.color).toMatch(/^#[0-9a-f]{6}$/);
      }
      // No two flags of a preset wear clashing colours (the fans must read apart).
      for (let i = 0; i < p.teams.length; i++) for (let j = i + 1; j < p.teams.length; j++) expect([id, i, j, colorsClash(p.teams[i].color, p.teams[j].color)]).toEqual([id, i, j, false]);
      const loaded = presetToSettings({ ...defaultSettings("stringBattle"), ...p, ...rosterPatch(p.teams) });
      expect([loaded.sbStyle, loaded.sbArena, loaded.sbBalls, loaded.teams.length, loaded.recordingDuration]).toEqual(["circle", p.sbArena, p.sbBalls, p.teams.length, p.recordingDuration]);
    }
    expect(stringCirclePresetPatch("mega12").sbBalls).toBe(12);
    expect(stringCirclePresetPatch("hexagon6").sbArena).toBe("hexagon");
    expect(stringCirclePresetPatch("classic5").sbBalls).toBe(5);
  });
});

/* ------------------------------------------------------------------ geometry */

describe("string circle geometry", () => {
  const cx = 400;
  const cy = 225;
  const R = 168.75;
  const hit = { x: 0, y: 0, angle: 0 };

  it("finds the rim point straight ahead of a ball: on the circle", () => {
    for (let k = 0; k < 16; k++) {
      const a = (k * Math.PI) / 8;
      rimHit(cx, cy, R, 0, cx, cy, Math.cos(a), Math.sin(a), hit);
      expect(Math.hypot(hit.x - cx, hit.y - cy)).toBeCloseTo(R, 9);
      expect(bearingDelta(a, hit.angle)).toBeCloseTo(0, 9);
    }
    // From off-centre, ahead along the heading (not back): the point lies on the ray.
    rimHit(cx, cy, R, 0, cx + 50, cy - 20, 0, 1, hit);
    expect([hit.x, Math.hypot(hit.x - cx, hit.y - cy)]).toEqual([cx + 50, expect.closeTo(R, 9)]);
    expect(hit.y).toBeGreaterThan(cy - 20);
    // A ball standing still faces away from the centre.
    rimHit(cx, cy, R, 0, cx + 10, cy, 0, 0, hit);
    expect([hit.x, hit.y]).toEqual([expect.closeTo(cx + R, 9), expect.closeTo(cy, 9)]);
  });

  it("finds the rim point straight ahead on the hexagon inscribed in the ring, and the rim at a bearing", () => {
    const n = { x: 0, y: 0 };
    for (let k = 0; k < 24; k++) {
      const a = (k * Math.PI) / 12 + 0.01;
      rimHit(cx, cy, R, 6, cx + 20, cy - 10, Math.cos(a), Math.sin(a), hit);
      let most = -Infinity;
      for (let side = 0; side < 6; side++) {
        hexNormal(side, n);
        most = Math.max(most, (hit.x - cx) * n.x + (hit.y - cy) * n.y);
      }
      expect(most).toBeCloseTo(R * SC_HEX_APOTHEM, 6);
    }
    const p = { x: 0, y: 0 };
    rimAt(cx, cy, R, 6, 0, p); // a corner (flat top: the corners at 0°, 60° …)
    expect([p.x, p.y]).toEqual([expect.closeTo(cx + R, 9), expect.closeTo(cy, 9)]);
    rimAt(cx, cy, R, 6, Math.PI / 2, p); // the middle of the top side… of the bottom one (y grows down)
    expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(R * SC_HEX_APOTHEM, 9);
    rimAt(cx, cy, R, 0, 1, p);
    expect(Math.hypot(p.x - cx, p.y - cy)).toBeCloseTo(R, 9);
    // The wall test: inside, on and past both walls.
    expect(wallOverlap(cx, cy, R, 0, cx, cy, 10, n)).toBeCloseTo(-(R - 10), 9);
    expect(wallOverlap(cx, cy, R, 0, cx + R, cy, 10, n)).toBeCloseTo(10, 9);
    expect([n.x, n.y]).toEqual([1, 0]);
    expect(wallOverlap(cx, cy, R, 6, cx, cy + R * SC_HEX_APOTHEM, 10, n)).toBeCloseTo(10, 9);
    expect(wallOverlap(cx, cy, R, 6, cx, cy, 10, n)).toBeLessThan(0);
  });

  it("cuts like the web style's whole-thread cut on the anchor-side share of a string, never the stub at its ball", () => {
    let seed = 99;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    let agree = 0;
    let cuts = 0;
    for (let i = 0; i < 4000; i++) {
      const ax = 400 * rnd();
      const ay = 400 * rnd();
      const bx = 400 * rnd();
      const by = 400 * rnd();
      const p0x = 400 * rnd();
      const p0y = 400 * rnd();
      const p1x = p0x + 60 * (rnd() - 0.5);
      const p1y = p0y + 60 * (rnd() - 0.5);
      const reach = 30 * rnd();
      const web = cutsThread(ax, ay, bx, by, reach, p0x, p0y, p1x, p1y);
      const mine = scCuts(ax, ay, bx, by, reach, p0x, p0y, p1x, p1y, 1) >= 0;
      if (web === mine) agree++;
      if (mine) cuts++;
    }
    expect(agree).toBeGreaterThanOrEqual(3998); // (a crossing exactly at a segment's end may round either way)
    expect(cuts).toBeGreaterThan(40);
    // The share: a move across the string near its anchor cuts, the same move near its ball does not.
    expect(SC_CUT_SPAN).toBe(0.5);
    expect(scCuts(0, 0, 100, 0, 5, 20, -5, 20, 5)).toBeCloseTo(0.2, 9);
    expect(scCuts(0, 0, 100, 0, 5, 70, -5, 70, 5)).toBe(-1);
    expect(scCuts(0, 0, 100, 0, 5, 70, -5, 70, 5, 1)).toBeCloseTo(0.7, 9);
    expect(scCuts(0, 0, 100, 0, 40, 70, -5, 70, 5, 1)).toBe(-1); // the stub next to the ball
    expect(scCuts(0, 0, 100, 0, 5, 20, 5, 20, 10)).toBe(-1); // a move that stays on one side
  });

  it("indexes a fan by direction: the strings a move may cross are the strings every test would cut, a few of them tested", () => {
    // pseudoAngle: monotonic in the bearing, [0, 4), antipodal like it.
    let last = -1;
    for (let k = 0; k < 360; k++) {
      const a = (k / 360) * 2 * Math.PI;
      const pa = pseudoAngle(Math.cos(a), Math.sin(a));
      expect(pa).toBeGreaterThanOrEqual(0);
      expect(pa).toBeLessThan(4);
      expect(pa).toBeGreaterThan(last);
      last = pa;
      const opposite = pseudoAngle(-Math.cos(a), -Math.sin(a));
      expect((((opposite - pa) % 4) + 4) % 4).toBeCloseTo(2, 9);
    }
    expect(Number.isNaN(pseudoAngle(0, 0))).toBe(true);
    let seed = 2024;
    const rnd = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const index = new FanIndex();
    const w = { first: 0, count: 0 };
    let cuts = 0;
    let tested = 0;
    let total = 0;
    for (let fan = 0; fan < 40; fan++) {
      const bx = 100 + 600 * rnd();
      const by = 100 + 300 * rnd();
      const n = 1 + Math.floor(700 * rnd());
      const strings = Array.from({ length: n }, (_, k) => {
        // A few strings straight along the axes (the pseudo-angle's seams), the rest anywhere round the ball.
        const a = k % 9 === 0 ? (k % 4) * (Math.PI / 2) : 2 * Math.PI * rnd();
        const d = 20 + 400 * rnd();
        return { ax: bx + d * Math.cos(a), ay: by + d * Math.sin(a) };
      });
      index.build(strings, bx, by);
      // Every string sits in exactly one bucket, in the fan's order within it.
      const seen = Array.from(index.items.subarray(0, n)).sort((a, b) => a - b);
      expect(seen).toEqual(Array.from({ length: n }, (_, k) => k));
      for (let b = 0; b < FAN_BUCKETS; b++) for (let j = index.start[b] + 1; j < index.start[b + 1]; j++) expect(index.items[j]).toBeGreaterThan(index.items[j - 1]);
      for (let move = 0; move < 60; move++) {
        // A rival's sub-step (a few px), now and then a long move, a move from the ball's centre or along an axis.
        const a = 2 * Math.PI * rnd();
        const d = 5 + 300 * rnd();
        const p0x = move === 0 ? bx : bx + d * Math.cos(a);
        const p0y = move === 0 ? by : by + d * Math.sin(a);
        const step = move % 10 === 1 ? 200 : 6;
        const p1x = p0x + (move % 7 === 2 ? 0 : step * (rnd() - 0.5));
        const p1y = p0y + (move % 7 === 3 ? 0 : step * (rnd() - 0.5));
        const reach = 18;
        const every: number[] = [];
        for (let k = 0; k < n; k++) if (scCuts(strings[k].ax, strings[k].ay, bx, by, reach, p0x, p0y, p1x, p1y) >= 0) every.push(k);
        const indexed: number[] = [];
        index.window(p0x - bx, p0y - by, p1x - bx, p1y - by, w);
        if (move === 0) expect(w.count).toBe(FAN_BUCKETS);
        for (let i = 0; i < w.count; i++) {
          const b = (w.first + i) % FAN_BUCKETS;
          for (let j = index.start[b]; j < index.start[b + 1]; j++) {
            const k = index.items[j];
            tested++;
            if (scCuts(strings[k].ax, strings[k].ay, bx, by, reach, p0x, p0y, p1x, p1y) >= 0) indexed.push(k);
          }
        }
        total += n;
        indexed.sort((x, y) => x - y);
        expect(indexed).toEqual(every);
        cuts += every.length;
      }
    }
    expect(cuts).toBeGreaterThan(1000);
    // The point of it: a small share of the fan gets the full test (about 5 % here, every bucket for the moves from the centre included).
    expect(tested / total).toBeLessThan(0.1);
  });

  it("owes the anchors of its cadence, bins bearings round the rim and measures the turn between two bearings", () => {
    expect(anchorsDue(0, 0, 30)).toBe(1);
    expect(anchorsDue(10, 9, 30)).toBe(0);
    expect(anchorsDue(0, 1000, 30)).toBe(31);
    expect(anchorsDue(0, 1000, 0)).toBe(0);
    expect(rimBin(0)).toBe(0);
    expect(rimBin(-1e-9)).toBe(SC_RIM_BINS - 1);
    expect(rimBin(Math.PI)).toBe(SC_RIM_BINS / 2);
    expect(rimBin(7 * Math.PI)).toBe(SC_RIM_BINS / 2);
    expect(bearingDelta(0.1, -0.1)).toBeCloseTo(-0.2, 12);
    expect(bearingDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2, 12);
  });
});

/* ------------------------------------------------------------------ coverage */

describe("string circle coverage", () => {
  const fan = (alive: boolean, strings: ScStringLike[]) => ({ alive, strings });
  const s = (angle: number, bornMs: number, serial: number): ScStringLike => ({ angle, bornMs, serial });
  const bin = (2 * Math.PI) / SC_RIM_BINS;

  it("claims the arc between two strings anchored one after the other, a lone string its bin", () => {
    const cov = createCoverage(2);
    updateCoverage(cov, [fan(true, [s(10 * bin + 0.1 * bin, 0, 0), s(20 * bin + 0.1 * bin, 1, 1)]), fan(true, [s(100 * bin + 0.5 * bin, 0, 0)])]);
    expect(Array.from(cov.bins)).toEqual([11, 1]);
    for (let b = 10; b <= 20; b++) expect(cov.owner[b]).toBe(0);
    expect(cov.owner[100]).toBe(1);
    expect(cov.share[0]).toBeCloseTo(11 / SC_RIM_BINS, 12);
    // A cut string between them (a gap in the serials) breaks the arc; two strings too far apart claim their own bins.
    updateCoverage(cov, [fan(true, [s(10 * bin, 0, 0), s(20 * bin, 1, 2)]), fan(true, [s(0, 0, 0), s(SC_ARC_JOIN + 0.01, 1, 1)])]);
    expect(Array.from(cov.bins)).toEqual([2, 2]);
  });

  it("goes the short way round the rim, across bearing 0", () => {
    const cov = createCoverage(1);
    updateCoverage(cov, [fan(true, [s(-3 * bin + 0.5 * bin, 0, 0), s(3 * bin + 0.5 * bin, 1, 1)])]);
    expect(cov.bins[0]).toBe(7);
    expect([cov.owner[SC_RIM_BINS - 3], cov.owner[0], cov.owner[3], cov.owner[4]]).toEqual([0, 0, 0, -1]);
  });

  it("gives an overlap to the newer claim, a dead heat to the lower slot, nothing to a fan out of the battle", () => {
    const cov = createCoverage(3);
    const a = [s(10 * bin + 0.5 * bin, 0, 0), s(30 * bin + 0.5 * bin, 100, 1)];
    const b = [s(20 * bin + 0.5 * bin, 0, 0), s(40 * bin + 0.5 * bin, 200, 1)];
    updateCoverage(cov, [fan(true, a), fan(true, b), fan(false, [s(0, 999, 0), s(0.1, 999, 1)])]);
    expect([cov.owner[15], cov.owner[25], cov.owner[35]]).toEqual([0, 1, 1]);
    expect(Array.from(cov.bins)).toEqual([10, 21, 0]);
    const tie = createCoverage(2);
    updateCoverage(tie, [fan(true, [s(5 * bin, 7, 0)]), fan(true, [s(5 * bin, 7, 0)])]);
    expect(tie.owner[5]).toBe(0);
    let total = 0;
    for (const x of cov.share) total += x;
    expect(total).toBeLessThanOrEqual(1);
  });

  it("counts a change of hands (the renderer redraws then) and breaks a clip-limit tie by the rim", () => {
    const cov = createCoverage(1);
    const fans = [fan(true, [s(0, 0, 0)])];
    updateCoverage(cov, fans);
    const v = cov.version;
    updateCoverage(cov, fans);
    expect(cov.version).toBe(v);
    updateCoverage(cov, [fan(true, [s(1, 0, 0)])]);
    expect(cov.version).toBe(v + 1);
    const bins = new Int32Array([5, 40, 40, 2]);
    expect(coverageLeaders([0, 3], bins)).toEqual([0]);
    expect(coverageLeaders([0, 1, 2], bins)).toEqual([1, 2]);
    expect(coverageLeaders([3], bins)).toEqual([3]);
  });
});

/* ------------------------------------------------------------------ the rules on a hand-made context */

describe("string circle rules", () => {
  it("starts the circle style with the cut rule, the line-up's colours, a curl per ball and every ball inside", () => {
    const { view, pr } = fight({ balls: 4, rule: "collide" });
    const c = view.circle!;
    expect(c).not.toBeNull();
    expect([c.sides, c.rate, c.cut]).toEqual([0, 30, 200]);
    expect(view.settings.rule).toBe("cut");
    const looks = circleLineup([], 4);
    expect(view.fighters.map((f) => f.color)).toEqual(looks.map((l) => l.color));
    expect(looks.map((l) => l.code)).toEqual(["TR", "IN", "US", "IR"]);
    for (const f of view.fighters) expect(Math.abs(c.curl[f.slot])).toBeGreaterThan(0);
    for (const b of pr.balls) expect(Math.hypot(b.x - view.cx, b.y - view.cy) + b.radius).toBeLessThanOrEqual(view.radius);
    // The web style has no circle state.
    const web = new StringBattleMode();
    web.init(probe().ctx);
    expect(web.getView().circle).toBeNull();
  });

  it("cuts the strings a rival's move crosses on the outer half of a fan, never the inner half", () => {
    const { mode, pr, view } = fight({ balls: 2, cut: 1000 });
    const R = view.radius;
    // Slot 0's ball sits at the centre with 41 strings fanning to the right half of the rim (−60°…60°).
    const f = giveFan(mode, pr, 0, view.cx, view.cy, -Math.PI / 3, Math.PI / 3, 41);
    // Slot 1 moves down across the fan at 0.75 R from the centre: on the anchor-side half of every string it crosses.
    pr.setTime(100);
    sweep(mode, pr, 1, view.cx + 0.75 * R, view.cy - 4, view.cx + 0.75 * R, view.cy + 4);
    const cut = 41 - f.strings.length;
    expect(cut).toBeGreaterThan(0);
    expect(view.circle!.lost[0]).toBe(cut);
    expect(view.circle!.cutBy[1]).toBe(cut);
    expect(view.cuts).toBe(cut);
    expect(view.ghostCount).toBe(cut); // each one snaps
    // The same move at 0.3 R (the inner half, near the owner's ball) cuts nothing.
    const before = f.strings.length;
    sweep(mode, pr, 1, view.cx + 0.3 * R, view.cy - 4, view.cx + 0.3 * R, view.cy + 4);
    expect(f.strings.length).toBe(before);
    // A ball never cuts its own fan.
    sweep(mode, pr, 0, view.cx, view.cy, view.cx + 1, view.cy);
    expect(f.strings.length).toBe(before);
  });

  it("takes a life for every `cut` strings of one owner cut, then shields its fan; a ball out of lives is out and its fan dissolves", () => {
    const { mode, pr, view } = fight({ balls: 2, lives: 2, cut: 10 });
    const R = view.radius;
    const c = view.circle!;
    const slash = (t: number) => {
      giveFan(mode, pr, 0, view.cx, view.cy, -Math.PI / 4, Math.PI / 4, 300);
      pr.setTime(t);
      sweep(mode, pr, 1, view.cx + 0.8 * R, view.cy - 30, view.cx + 0.8 * R, view.cy + 30);
    };
    slash(1000);
    expect([view.fighters[0].lives, c.toward[0], c.lives]).toEqual([1, 0, 1]);
    expect(view.livesLost).toBe(1);
    // Shielded: the next slash cuts nothing.
    const left = view.fighters[0].strings.length;
    pr.setTime(1000 + SB_INVULN_MS.cut - 1);
    sweep(mode, pr, 1, view.cx + 0.8 * R, view.cy - 30, view.cx + 0.8 * R, view.cy + 30);
    expect(view.fighters[0].strings.length).toBe(left);
    // After the shield the last life goes: the fan dissolves (a few dozen dissolving strings at most), the battle is over.
    slash(1000 + SB_INVULN_MS.cut + 1);
    expect(view.fighters[0].alive).toBe(false);
    expect(view.fighters[0].strings).toHaveLength(0);
    let dissolving = 0;
    for (let i = 0; i < view.ghostCount; i++) if (view.ghosts[i].kind === "dissolve") dissolving++;
    expect(dissolving).toBeGreaterThan(0);
    expect(dissolving).toBeLessThanOrEqual(SC_DISSOLVE_GHOSTS + 1);
    expect([view.finished, view.winner, view.fighters[1].kills]).toEqual([true, 1, 1]);
    expect(pr.sounds.some((e) => e.sbSound === "shatter")).toBe(true);
  });

  it("lets the rig absorb a life of the forced winner (it never loses its last life)", () => {
    const mode = new StringBattleMode();
    mode.setSettings({ style: "circle", balls: 2, lives: 1, cut: 5 });
    const pr = probe({ ...config, forcedWinner: 0 });
    mode.init(pr.ctx);
    mode.onPreUpdate(pr.ctx);
    const view = mode.getView();
    giveFan(mode, pr, 0, view.cx, view.cy, -Math.PI / 4, Math.PI / 4, 200);
    pr.setTime(500);
    sweep(mode, pr, 1, view.cx + 0.8 * view.radius, view.cy - 30, view.cx + 0.8 * view.radius, view.cy + 30);
    expect([view.fighters[0].alive, view.fighters[0].lives, view.shields]).toEqual([true, 1, 1]);
  });
});

/* ------------------------------------------------------------------ the battle in the engine */

describe("the string circle battle", () => {
  it("anchors strings at its cadence from every ball to the rim point straight ahead of it", () => {
    const engine = circle({ balls: 2, rate: 30, cut: 100_000 }, 3);
    const v = engine.getStringBattleView();
    const c = v.circle!;
    run(engine, 1000);
    // 30 a second each (the first ones at once, staggered by slot): 30 or 31 in a second.
    expect(c.anchors).toBeGreaterThanOrEqual(60);
    expect(c.anchors).toBeLessThanOrEqual(62);
    for (const f of v.fighters) {
      for (let k = 0; k < f.strings.length; k++) {
        const s = f.strings[k];
        expect(Math.hypot(s.ax - v.cx, s.ay - v.cy)).toBeCloseTo(v.radius, 6);
        if (k > 0) expect(s.serial).toBeGreaterThan(f.strings[k - 1].serial!);
      }
      // The newest string points where its ball faced when it was anchored (within the step it was anchored in).
      const ball = engine.getBalls().find((b) => b.id === f.id)!;
      const last = f.strings[f.strings.length - 1];
      const ahead = { x: 0, y: 0, angle: 0 };
      rimHit(v.cx, v.cy, v.radius, 0, ball.x, ball.y, ball.vx, ball.vy, ahead);
      expect(Math.abs(bearingDelta(ahead.angle, last.angle))).toBeLessThan(0.35);
    }
    // The fans' share of the rim is up and counts every live string's claim.
    expect(Array.from(c.coverage.share).every((x) => x > 0)).toBe(true);
    expect(coverageText(c, v.count).split(",")).toHaveLength(2);
    expect(fanText(v.fighters).split(",").map(Number).reduce((a, b) => a + b, 0)).toBe(v.liveStrings);
  });

  it("keeps a ball's live strings at the memory-safety ceiling, the oldest fading", { timeout: 30_000 }, () => {
    expect(SC_STRING_CEILING).toBe(STRING_CEILING);
    const engine = circle({ balls: 2, rate: 6000, cut: 1_000_000 }, 4);
    const v = engine.getStringBattleView();
    run(engine, 700);
    for (const f of v.fighters) expect(f.strings.length).toBeLessThanOrEqual(SC_STRING_CEILING);
    expect(Math.max(...v.fighters.map((f) => f.strings.length))).toBe(SC_STRING_CEILING);
    let fading = 0;
    for (let i = 0; i < v.ghostCount; i++) if (v.ghosts[i].kind === "fade") fading++;
    expect(fading).toBeGreaterThan(0);
  });

  it("plays a whole battle: lives fall to the cuts, the last flag standing wins, every ball stays inside", { timeout: 30_000 }, () => {
    const engine = circle({ balls: 4, lives: 3 }, 21);
    const v = engine.getStringBattleView();
    const n = { x: 0, y: 0 };
    let t = 0;
    let inside = true;
    while (t < 200_000 && !engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      t += STEP;
      for (const b of engine.getBalls()) if (wallOverlap(v.cx, v.cy, v.radius, 0, b.x, b.y, b.radius, n) > 0.5) inside = false;
    }
    expect(engine.isSimulationFinished()).toBe(true);
    expect(inside).toBe(true);
    expect(v.alive).toBe(1);
    expect(v.winner).toBeGreaterThanOrEqual(0);
    expect(v.fighters[v.winner].alive).toBe(true);
    expect(v.livesLost).toBe(4 * 3 - v.fighters[v.winner].lives);
    expect(v.circle!.lives).toBe(v.livesLost);
    expect(v.circle!.cuts).toBeGreaterThanOrEqual(v.livesLost * 200);
    const stats = engine.getTeamStats();
    expect(stats[v.winner].escapes).toBe(1);
  });

  it("plays the hexagon arena: every ball inside its sides, every anchor on them", { timeout: 30_000 }, () => {
    const engine = circle({ balls: 6, lives: 2, arena: "hexagon" }, 5);
    const v = engine.getStringBattleView();
    expect(v.circle!.sides).toBe(6);
    const n = { x: 0, y: 0 };
    let worst = -Infinity;
    for (let i = 0; i < 1200; i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      for (const b of engine.getBalls()) worst = Math.max(worst, wallOverlap(v.cx, v.cy, v.radius, 6, b.x, b.y, b.radius, n));
    }
    expect(worst).toBeLessThanOrEqual(0.5);
    let anchors = 0;
    for (const f of v.fighters)
      for (const s of f.strings) {
        anchors++;
        expect(wallOverlap(v.cx, v.cy, v.radius, 6, s.ax, s.ay, 0, n)).toBeCloseTo(0, 6);
      }
    expect(anchors).toBeGreaterThan(50);
    expect(v.circle!.cuts).toBeGreaterThan(0);
  });

  it("judges a clip limit by the lives, then the most rim", { timeout: 30_000 }, () => {
    const engine = circle({ balls: 3, lives: 9, duration: 6 }, 8);
    const v = engine.getStringBattleView();
    runToEnd(engine, 10_000);
    expect(v.finished).toBe(true);
    expect(v.finishedMs).toBeGreaterThanOrEqual(6000 - STEP);
    const best = Math.max(...v.fighters.filter((f) => f.alive).map((f) => f.lives));
    const leaders = v.fighters.filter((f) => f.alive && f.lives === best).map((f) => f.slot);
    const byRim = coverageLeaders(leaders, v.circle!.coverage.bins);
    if (byRim.length === 1) expect(v.winner).toBe(byRim[0]);
    else expect(v.tie || byRim.includes(v.winner)).toBe(true);
  });

  it("crowns the forced winner (the rig) in the circle style", { timeout: 60_000 }, () => {
    for (const seed of [1, 2, 3]) {
      const engine = circle({ balls: 4, lives: 2 }, seed, { ...config, forcedWinner: 2 });
      runToEnd(engine);
      const v = engine.getStringBattleView();
      expect([seed, engine.isSimulationFinished(), v.winner]).toEqual([seed, true, 2]);
    }
  });

  it("groups the anchors' twangs per step under the note cap, snaps the cuts and shatters at a KO – all accompaniment", { timeout: 30_000 }, () => {
    const engine = circle({ balls: 5, lives: 1 }, 6);
    const events: SoundEvent[] = [];
    const steps: number[] = [];
    let t = 0;
    while (t < 60_000 && !engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      const step = engine.consumeSoundEvents();
      for (const e of step) if (e.scSound === "twang") steps.push(Math.round(t / STEP));
      events.push(...step);
      t += STEP;
    }
    const twangs = events.filter((e) => e.scSound === "twang");
    const snaps = events.filter((e) => e.scSound === "snap");
    expect(twangs.length).toBeGreaterThan(20);
    expect(snaps.length).toBeGreaterThan(0);
    expect(events.some((e) => e.sbSound === "shatter")).toBe(true);
    const notes = new Set(SC_TWANG_MIDI.map((m) => Math.round(midiToFrequency(m) * 1000)));
    for (const e of twangs) {
      const chord = e.chord ?? [e.frequency!];
      expect(chord.length).toBeLessThanOrEqual(SC_TWANG_NOTES);
      for (const f of chord) expect(notes.has(Math.round(f * 1000))).toBe(true);
      expect(e.frequency).toBe(Math.min(...chord));
      expect(e.melody).toBe(false);
    }
    for (let i = 1; i < steps.length; i++) expect(steps[i] - steps[i - 1]).toBeGreaterThanOrEqual(SC_TWANG_GAP_STEPS);
    for (const e of snaps) {
      expect(e.melody).toBe(false);
      expect(e.level).toBeGreaterThanOrEqual(0.4);
      expect(e.level).toBeLessThanOrEqual(1);
    }
    expect(SC_SNAP_GAP_STEPS).toBeGreaterThanOrEqual(1);
    expect(twangFrequency(0)).toBeCloseTo(midiToFrequency(60), 9);
    expect(twangFrequency(12)).toBeCloseTo(twangFrequency(0), 9);
    expect(snapFrequency(3)).toBeCloseTo(2 * twangFrequency(3), 9);
    expect([snapLevel(1), snapLevel(1000)]).toEqual([0.4, 1]);
  });

  it("replays a seed exactly – the same battle at 30, 60 and 120 frames a second (a pinned fingerprint)", { timeout: 60_000 }, () => {
    function fnv(values: number[], h = 0x811c9dc5) {
      const bytes = new Uint8Array(new Float64Array(values).buffer);
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    }
    function fingerprint(patch: Partial<SimulatorSettings>, frameMs: number) {
      const s = { ...defaultSettings("stringBattle"), sbStyle: "circle", ...patch } as SimulatorSettings;
      const engine = createEngineForSettings(physicsConfigOfSettings(s, { width: 800, height: 450 }), "stringBattle", modeSettingsOfSettings(s), 7);
      let sounds = 0;
      for (let i = 0; i < Math.round(6000 / frameMs); i++) {
        engine.update(frameMs, 0);
        sounds += engine.consumeSoundEvents().length;
      }
      const v = engine.getStringBattleView();
      const c = v.circle!;
      return {
        balls: fnv(engine.getBalls().flatMap((b) => [b.id, b.x, b.y, b.vx, b.vy])),
        strings: fnv(v.fighters.flatMap((f) => f.strings.flatMap((x) => [x.ax, x.ay, x.bornMs]))),
        rim: fnv(Array.from(c.coverage.owner)),
        lives: v.fighters.map((f) => f.lives).join(","),
        events: [c.anchors, c.cuts, c.lives, c.twangs, c.snaps, v.bounces, sounds].join(","),
      };
    }
    const pinned: [Partial<SimulatorSettings>, ReturnType<typeof fingerprint>][] = [
      [{}, PIN_DEFAULT],
      [{ sbArena: "hexagon", sbBalls: 6, sbLives: 2, sbRate: 20, sbCut: 80 }, PIN_HEXAGON],
    ];
    for (const [patch, expected] of pinned) {
      expect(fingerprint(patch, 1000 / 60)).toEqual(expected);
      expect(fingerprint(patch, 1000 / 30)).toEqual(expected);
      expect(fingerprint(patch, 1000 / 120)).toEqual(expected);
    }
  });

  it("follows a resize: the arena stays centred, every ball inside its wall, the hexagon's anchors on its sides", () => {
    const engine = circle({ balls: 4, arena: "hexagon" }, 9);
    const v = engine.getStringBattleView();
    run(engine, 1500);
    engine.setConfig({ width: 1280, height: 720 });
    const n = { x: 0, y: 0 };
    expect([v.cx, v.cy, v.radius]).toEqual([640, 360, arenaRadius({ ...config, width: 1280, height: 720 })]);
    for (const b of engine.getBalls()) expect(wallOverlap(v.cx, v.cy, v.radius, 6, b.x, b.y, b.radius, n)).toBeLessThanOrEqual(0.5);
    for (const f of v.fighters) for (const s of f.strings) expect(wallOverlap(v.cx, v.cy, v.radius, 6, s.ax, s.ay, 0, n)).toBeCloseTo(0, 6);
    run(engine, 500);
    for (const b of engine.getBalls()) expect(wallOverlap(v.cx, v.cy, v.radius, 6, b.x, b.y, b.radius, n)).toBeLessThanOrEqual(0.5);
  });

  it("switches into and out of the circle style only at a new battle; the title follows live", () => {
    const engine = circle({ balls: 3 }, 2);
    const v = engine.getStringBattleView();
    run(engine, 500);
    engine.setStringBattleSettings({ style: "web", title: "COUNTRY FIGHT" });
    expect([v.settings.style, v.settings.title, !!v.circle]).toEqual(["circle", "COUNTRY FIGHT", true]);
    engine.initStringBattle();
    expect([engine.getStringBattleView().settings.style, engine.getStringBattleView().circle]).toEqual(["web", null]);
    // web ↔ neon still switch live.
    engine.setStringBattleSettings({ style: "neon" });
    expect(engine.getStringBattleView().settings.style).toBe("neon");
  });
});

/* ------------------------------------------------------------------ finder, teams banner, drawing */

describe("string circle: finder, teams banner and drawing", () => {
  it("offers the String Battle's outcomes and finds a battle the chosen flag wins – which plays out that way", { timeout: 120_000 }, async () => {
    expect(availableOutcomes("stringBattle", { endless: false, neverEscape: false, ballCount: 3 })).toEqual(["duration", "winner"]);
    const stringBattle = { style: "circle" as const, balls: 3, lives: 2 };
    const outcome = { kind: "winner" as const, clipSec: 90, team: 1 };
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 40, maxSimTimeSec: 120, physicsConfig: config, mode: "stringBattle", modeSettings: { ...modeSettings, stringBattle }, outcome };
    const found = await withFrames(() => findSimulation(request, () => undefined));
    expect(found.found).toBe(true);
    const engine = circle({ balls: 3, lives: 2 }, found.seed);
    const length = runToEnd(engine);
    expect(engine.getStringBattleView().winner).toBe(1);
    const run = simulateOutcomeRun(found.seed, request, outcome);
    expect([run.finished, outcomeMatches(outcome, run)]).toEqual([true, true]);
    expect(run.durationMs).toBeCloseTo(length, 6);
  });

  it("crowns a mega fight's winner past the six teams with the battle's own banner (no team winner)", { timeout: 60_000 }, () => {
    const LABELS: TeamLabels = { bounces: "Bounces", walls: "Walls", escapes: "Escapes", kills: "Kills", win: "Win", wins: (name) => `${name} wins!`, tie: "It's a tie!", team: (n) => `Team ${n}` };
    const roster = stringCirclePresetPatch("mega12").teams;
    let past = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = circle({ balls: 12, lives: 1 }, seed);
      runToEnd(engine);
      const v = engine.getStringBattleView();
      const layer = new TeamLayer();
      layer.beginFrame(engine, { roster, showNames: true, showScoreboard: true, position: "top-left", labels: LABELS });
      layer.drawOverlay(noopCtx(), engine, { width: 800, height: 450, dtMs: 16, inset: 0, modeBanner: false });
      expect(layer.teamsInPlay()).toBe(MAX_TEAMS);
      expect([seed, layer.winnerText()]).toEqual([seed, v.winner < MAX_TEAMS ? roster[v.winner].name : ""]);
      if (v.winner >= MAX_TEAMS) past++;
    }
    expect(past).toBeGreaterThan(0); // (seeds 1, 3 and 5 are won past the roster, the others by a roster flag)
    expect(past).toBeLessThan(6);
  });

  it("lifts a dark team colour for the stage and mirrors the battle onto the canvas data", () => {
    expect(fanColor("#3c3b6e")).not.toEqual([0x3c, 0x3b, 0x6e]);
    const [r, g, b] = fanColor("#3c3b6e");
    expect((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255).toBeGreaterThanOrEqual(0.31);
    expect(fanColor("#ff9933")).toEqual([0xff, 0x99, 0x33]);
    const engine = circle({ balls: 3 }, 12);
    run(engine, 1200);
    const view = engine.getStringBattleView();
    const layer = new StringCircleLayer();
    const o: StringCircleRenderOptions = { dpr: 1, roster: [], showNames: false, wallThickness: 2, labels: DEFAULT_STRING_CIRCLE_LABELS, nowMs: engine.getElapsedMs(), width: 800, height: 450 };
    const ctx = noopCtx();
    layer.drawStage(ctx, view, engine.getBalls(), o);
    expect(layer.segments).toBe(view.liveStrings);
    expect(layer.arcs).toBeGreaterThan(0);
    const bottom = layer.drawOverlay(ctx, view, { ...o, labels: { ...DEFAULT_STRING_CIRCLE_LABELS } }, { inset: 0, dtMs: 16, teamBanner: false });
    expect(layer.title).toBe("STRING CIRCLE");
    expect(bottom).toBeGreaterThan(0);
    expect(bottom).toBeLessThan(450 / 2 - view.radius); // above the arena
    const data: Record<string, string> = {};
    writeStringCircleDataset(view, layer, engine.getBalls(), (k, v) => void (data[k] = v));
    expect(Object.keys(data).sort()).toEqual([...STRING_CIRCLE_DATA_KEYS].sort());
    expect(data.sbArena).toBe("circle");
    expect(data.sbCoverage.split(",")).toHaveLength(3);
    expect(data.sbNames).toBe("TR|IN|US");
    expect(data.sbBadges).toMatch(/^[fc]{3}$/);
    expect(data.sbInArena).toBe("1");
  });
});

describe("string circle drawing: dense fans", () => {
  it("thins a dense frame by the strings' serials – the same strings drawn frame after frame – and draws them all again only well below the step", { timeout: 30_000 }, () => {
    const engine = circle({ balls: 12, rate: 270, cut: 1_000_000, lives: 3 }, 7);
    run(engine, 4000);
    const view = engine.getStringBattleView();
    const layer = new StringCircleLayer();
    const o: StringCircleRenderOptions = { dpr: 1, roster: [], showNames: false, wallThickness: 2, labels: DEFAULT_STRING_CIRCLE_LABELS, nowMs: engine.getElapsedMs(), width: 800, height: 450 };
    const ctx = noopCtx();
    const drawnOf = (stride: number) => view.fighters.reduce((n, f) => n + (f.alive ? f.strings.filter((s) => (s.serial ?? 0) % stride === 0).length : 0), 0);
    for (let frame = 0; frame < 3; frame++) {
      layer.drawStage(ctx, view, engine.getBalls(), { ...o, nowMs: engine.getElapsedMs() });
      expect(view.liveStrings).toBeGreaterThan(3000);
      expect(layer.stride).toBe(2); // (~5,000 strings: every other one)
      expect(layer.segments).toBe(drawnOf(2));
      run(engine, 1000 / 60);
    }
    // Just below the step the stride holds (no flip-flop at its edge); well below it every string is drawn again.
    const trimTo = (total: number) => {
      let excess = view.fighters.reduce((n, f) => n + (f.alive ? f.strings.length : 0), 0) - total;
      for (const f of view.fighters) {
        if (!f.alive) continue;
        const drop = Math.min(excess, f.strings.length);
        f.strings.splice(0, drop);
        excess -= drop;
      }
    };
    trimTo(2900);
    layer.drawStage(ctx, view, engine.getBalls(), o);
    expect(layer.stride).toBe(2);
    trimTo(2500);
    layer.drawStage(ctx, view, engine.getBalls(), o);
    expect(layer.stride).toBe(1);
    expect(layer.segments).toBe(2500);
    // A sparse battle draws every string.
    const sparse = circle({ balls: 3 }, 12);
    run(sparse, 1200);
    const sv = sparse.getStringBattleView();
    layer.drawStage(ctx, sv, sparse.getBalls(), { ...o, nowMs: sparse.getElapsedMs() });
    expect(layer.stride).toBe(1);
    expect(layer.segments).toBe(sv.liveStrings);
  });
});

/* ------------------------------------------------------------------ countries, line-up, panel and messages */

type Messages = Record<string, Record<string, unknown>>;
const LOCALES: [string, Messages][] = [
  ["en", en as unknown as Messages],
  ["pl", pl as unknown as Messages],
  ["es", es as unknown as Messages],
];

describe("string circle countries, line-up and messages", () => {
  it("knows the clips' countries – unique codes and flags, two valid colours each, a name in every language", () => {
    for (const code of ["TR", "IN", "US", "IR", "DE", "CA", "JP", "CN", "VN", "LK", "PK", "BD", "AF"]) {
      const c = countryByCode(code)!;
      expect([code, !!c]).toEqual([code, true]);
      expect(c.flag).toBe(flagOf(code));
      for (const color of c.colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
      for (const [lang, m] of LOCALES) {
        const name = (m.Countries as Record<string, string>)[code];
        expect([lang, code, typeof name === "string" && name.length > 0 && Array.from(name).length <= MAX_TEAM_NAME_LENGTH]).toEqual([lang, code, true]);
      }
    }
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(SC_LINEUP.slice(0, 13)).toEqual(["TR", "IN", "US", "IR", "DE", "CA", "JP", "CN", "VN", "LK", "PK", "BD", "AF"]);
    expect(new Set(SC_LINEUP).size).toBe(COUNTRIES.length);
  });

  it("fills a roster row from the Country picker and plays the line-up past the roster, by code, in colours apart", () => {
    const turkey = countryTeamEntry(countryByCode("TR")!, "Türkiye");
    expect(turkey).toEqual({ name: "Türkiye", emoji: "🇹🇷", color: "#e30a17" });
    const looks = circleLineup([turkey, { name: "Fire", color: "#00ff00", emoji: "🔥" }], 8);
    expect(looks.slice(0, 2).map((l) => [l.name, l.code])).toEqual([
      ["Türkiye", "TR"],
      ["Fire", ""],
    ]);
    // Past the roster: the line-up without Turkey, named by code.
    expect(looks.slice(2).map((l) => l.name)).toEqual(["IN", "US", "IR", "DE", "CA", "JP"]);
    for (const l of looks.slice(2)) expect(l.emoji).toBe(flagOf(l.code));
    // A dozen line-up balls wear colours apart.
    const twelve = circleLineup([], 12);
    for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) expect([i, j, colorsClash(twelve[i].color, twelve[j].color)]).toEqual([i, j, false]);
    // Past the whole list it starts over.
    expect(circleLineup([], SC_LINEUP.length + 2).slice(-2).map((l) => l.code)).toEqual(SC_LINEUP.slice(0, 2));
  });

  it("names the finder's and the rig's winners as the canvas does: the roster, then the line-up's codes (the web style: the palette)", () => {
    const fallback = (kind: "team" | "ball", n: number) => `${kind} ${n}`;
    const base = { ...defaultSettings("stringBattle"), sbStyle: "circle" as const, sbBalls: 4, teams: [] };
    expect(teamChoiceNames(base, fallback)).toEqual(["TR", "IN", "US", "IR"]);
    const roster = [countryTeamEntry(countryByCode("IN")!, "India"), { name: "", color: "#00ff00", emoji: "🔥" }];
    expect(teamChoiceNames({ ...base, teams: roster }, fallback)).toEqual(["India", "team 2", "TR", "US"]);
    // Six at most are teams (a mega fight's others are named on the canvas only).
    expect(teamChoiceNames({ ...base, sbBalls: 12 }, fallback)).toEqual(["TR", "IN", "US", "IR", "DE", "CA"]);
    // The canvas' names: the teams layer pads the roster with the same line-up.
    expect(circleLineup(roster, 4).slice(2).map((l) => l.name)).toEqual(["TR", "US"]);
    expect(teamChoiceNames({ ...base, sbStyle: "web" as const }, fallback)).toEqual(["HOTPINK", "AQUA", "ACID", "VIOLET"]);
  });

  it("puts the circle controls in the String Battle block's search keys, with a label in every language", () => {
    for (const key of STRING_CIRCLE_KEYS) expect(STRING_BATTLE_KEYS).toContain(key);
    const keys = ["sbStyleCircle", "sbHintCircle", "scDesc", "scPresetTip", "scPresetChoose", "scPresetIndiaUsa", "scPresetCountries4", "scPresetMega12", "scPresetHexagon6", "scPresetClassic5", "scArenaTip", "scArenaCircle", "scArenaHexagon", "scRateTip", "scRateValue", "scCutTip", "scLineupNote", "scRosterNote", "scTitleTip", "scTitlePlaceholder", "scHudTip", "scCaptionQuestion", "scCaptionAdded", "scCaptionNote", ...STRING_CIRCLE_KEYS];
    for (const [lang, m] of LOCALES) {
      const c = m.Controls as Record<string, string>;
      for (const key of keys) expect([lang, key, typeof c[key] === "string" && c[key].length > 0]).toEqual([lang, key, true]);
      const canvas = m.StringCircle as Record<string, string>;
      expect([lang, Object.keys(canvas)]).toEqual([lang, ["canvasTitle", "canvasWins", "canvasRim", "canvasDraw", "canvasMore"]]);
      expect(canvas.canvasWins).toContain("[name]");
      expect(canvas.canvasRim).toContain("[pct]");
      expect(canvas.canvasMore).toContain("[count]");
    }
    // The family rule: the account that inspired it is named nowhere in the UI.
    const account = ["weapon", "ball", "arena"].join("");
    for (const [, m] of LOCALES) expect(JSON.stringify(m).toLowerCase()).not.toContain(account);
  });
});

/* ------------------------------------------------------------------ sounds */

describe("string circle sounds", () => {
  it("plucks a twang per note with a glide on top, and snaps a crack over a ping", () => {
    const g = withFilters(fakeGraph());
    const ctx = g.ctx as unknown as BaseAudioContext;
    const out = {} as AudioNode;
    scheduleTwang(ctx, out, [261.63, 329.63], 1, 0.5);
    expect(g.sources).toHaveLength(2); // the plucks
    expect(g.oscillators.map((o) => o.type)).toEqual(["triangle", "triangle"]);
    expect(g.oscillators.map((o) => o.startAt)).toEqual([1, 1]);
    expect(g.oscillators.map((o) => o.frequency)).toEqual([261.63 * TWANG_TONE.bendRatio, 329.63 * TWANG_TONE.bendRatio]); // the glide's start
    g.sources.length = 0;
    g.oscillators.length = 0;
    scheduleSnap(ctx, out, 880, 2, new NoiseCache().get(ctx), 0.7);
    expect(g.sources).toHaveLength(1);
    expect(g.oscillators).toEqual([{ type: "sine", frequency: 880, startAt: 2 }]);
    expect([scLevel(undefined), scLevel(2), scLevel(-1)]).toEqual([1, 1, 0]);
    expect(TWANG_TONE.bendRatio).toBeGreaterThan(1);
    expect(SNAP_TONE.band).toBeGreaterThan(1000);
  });

  describe("through the ToneGenerator", () => {
    let g: ReturnType<typeof fakeGraph>;
    let tone: ToneGenerator;
    beforeEach(async () => {
      g = withFilters(fakeGraph());
      const ctx = g.ctx;
      vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return ctx; } });
      tone = new ToneGenerator();
      await tone.start();
    });
    afterEach(() => vi.unstubAllGlobals());

    it("snaps the twang's notes to the scale and plays the snap", () => {
      tone.setMusicSettings({ instrument: "triangle", melodyInstrument: "sine", scale: "major", rootNote: 0, quantizeToBeat: false, bpm: 120, quantizeGrid: "1/8" });
      g.oscillators.length = 0;
      g.sources.length = 0;
      tone.playStringCircle("twang", 270, [270, 330]);
      // C4 and E4 (snapped to C major), each gliding down onto its note from a fifth above.
      expect(g.oscillators.map((o) => Math.round(o.frequency / TWANG_TONE.bendRatio))).toEqual([262, 330]);
      expect(g.sources).toHaveLength(2);
      g.oscillators.length = 0;
      tone.playStringCircle("snap", 880, undefined, 0.6);
      expect(g.oscillators.map((o) => Math.round(o.frequency))).toEqual([880]);
    });
  });
});

/** The fake audio graph with the band-pass filters the snap's crack needs. */
function withFilters(g: ReturnType<typeof fakeGraph>) {
  const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined });
  Object.assign(g.ctx, { createBiquadFilter: () => ({ type: "lowpass", frequency: param(), Q: param(), connect: () => undefined, disconnect: () => undefined }) });
  return g;
}

/** A 2D context that does nothing (and a document whose canvases hand it out), for the drawing tests. */
function noopCtx(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    measureText: (text: string) => ({ width: 7 * String(text).length }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    getImageData: () => ({ data: new Uint8ClampedArray(64 * 48 * 4) }),
  };
  const ctx = new Proxy(target, {
    get: (t, key) => (typeof key === "string" && !(key in t) ? (t[key] = () => {}) : t[key as string]),
    set: (t, key, value) => {
      t[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  if (typeof globalThis.document === "undefined") {
    vi.stubGlobal("document", { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  }
  return ctx;
}

/* ------------------------------------------------------------------ pinned fingerprints */

// (the balls, the strings and the rim hashed; the lives; anchors, strings cut, lives the cuts took, twang and snap events,
// wall bounces and all the sound events of the first 6 s)
const PIN_DEFAULT = { balls: 2904714296, strings: 1039673290, rim: 3187489712, lives: "4,4,4,4", events: "721,362,0,120,98,16,218" };
const PIN_HEXAGON = { balls: 1186508125, strings: 623405142, rim: 176065577, lives: "2,2,2,1,2,2", events: "721,406,1,120,102,31,222" };
