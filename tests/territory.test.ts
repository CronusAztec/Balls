import { describe, expect, it } from "vitest";
import {
  DEFAULT_TERRITORY_SETTINGS,
  DEFAULT_TY_POWERS,
  TERRITORY_RANGES,
  TY_ARM_MAX_MS,
  TY_DASH_SPEED,
  TY_DASH_TILES,
  TY_FINALE_MS,
  TY_FINALE_SPEED,
  TY_GHOST_SPEED,
  TY_LADDER,
  TY_MAX_TEAMS,
  TY_MIN_AXIS,
  TY_PALETTE,
  TY_PEG_RADIUS,
  TY_PEG_STEP,
  TY_SPEED,
  TY_VORTEX_CURVE,
  TY_WHIRL_MS,
  TY_WHIRL_SAMPLES_PER_TILE,
  awayFromAxes,
  fillRegions,
  flipFrequency,
  parseTyPowers,
  pegLast,
  regionOwner,
  resolveTerritorySettings,
  rigBlocksConversion,
  serializeTyPowers,
  territoryClipSec,
  territoryField,
  territoryFinaleFactor,
  territoryForcedWinner,
  territoryLeaders,
  territoryRows,
  territorySettingFields,
  territorySettingsOf,
  tileLeader,
  tilePercentages,
  whirlPoint,
  whirlReach,
  whirlSwept,
  type TerritorySettings,
  type TyBall,
  type TyPower,
} from "@/lib/physics/modes/territory";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { BATTLE_WINNER_MODES, forcedWinnerApplies } from "@/lib/physics/rigged";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { FIXED_RUN_SLACK_MS, createEngineForSettings, findSimulation, fixedRunDurationSec, runNeverFinishes, simulateOutcomeRun, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeMatches } from "@/lib/simulation/outcomes";
import { slowViewEligible } from "@/lib/simulation/camera";
import { effectiveBallCount, teamResult } from "@/lib/teams";
import { midiToFrequency } from "@/lib/audio/scales";
import { bounceTriggerApplies } from "@/lib/physics/bounceMathRuntime";
import { bounceMathBeatConfig, type BounceRule } from "@/lib/simulation/bounceMath";
import { assistantSettings, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { MEMORY_CEILINGS } from "@/lib/uncap";

/**
 * Territory (lib/physics/modes/territory.ts, feature odd-territory): the settings (resolve, URL, presets), the board
 * (rows, the field in the exported square, the start regions), the pure maths (percentages, the leader, the rig, the
 * verdict, the flip notes, the headings, the whirl), the pong-wars rule in the engine (a ball passes through its own
 * colour, bounces off any other and converts the tile it hit), every power, the pegs, the percentage accounting over whole
 * runs, the verdict and the team stats, the rigged forced winner, determinism, a resize and the finder.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 600,
  gravity: 300,
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
const NONE: TyPower[] = ["none", "none", "none", "none"];

function territory(settings: Partial<TerritorySettings> = {}, seed = 42, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "territory", { ...modeSettings, territory: settings }, seed);
}

/** Recounts the board and checks it against the running counts and the percentages. */
function accounted(engine: PhysicsEngine) {
  const v = engine.getTerritoryView();
  const recount = new Array(v.teams).fill(0);
  for (let i = 0; i < v.total; i++) recount[v.tiles[i]]++;
  const counts = Array.from(v.counts.subarray(0, v.teams));
  const pct = tilePercentages(v.counts, v.teams);
  return { ok: recount.every((n, t) => n === counts[t]) && counts.reduce((a, b) => a + b, 0) === v.total && pct.reduce((a, b) => a + b, 0) === 100, counts, recount, pct };
}

/** Keeps only the balls of `team` (a scenario with one ball) and returns the first of them. */
function onlyBall(engine: PhysicsEngine, team: number) {
  engine.setBalls(engine.getBalls().filter((b) => b.team === team).slice(0, 1));
  return engine.getBalls()[0];
}

/** The mode's record of an engine ball (its power and the power's state). */
function teamBall(engine: PhysicsEngine, ball: { id: number }): TyBall {
  const tb = engine.getTerritoryView().balls.find((b) => b.id === ball.id);
  if (!tb) throw new Error(`no team ball ${ball.id}`);
  return tb;
}

/** Sets tile (col, row) to `team`, keeping the running counts right. */
function setTile(engine: PhysicsEngine, col: number, row: number, team: number) {
  const v = engine.getTerritoryView();
  const idx = row * v.cols + col;
  v.counts[v.tiles[idx]]--;
  v.tiles[idx] = team;
  v.counts[team]++;
}

function tileOf(engine: PhysicsEngine, x: number, y: number) {
  const f = engine.getTerritoryView().field;
  return { col: Math.floor((x - f.gx) / f.tile), row: Math.floor((y - f.gy) / f.tile) };
}

function owner(engine: PhysicsEngine, col: number, row: number) {
  const v = engine.getTerritoryView();
  return v.tiles[row * v.cols + col];
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

/* ------------------------------------------------------------------ settings */

describe("territory settings", () => {
  it("resolve: defaults, the minimums, no maximum (the memory-safety ceilings for what a run builds), 2 or 4 teams and known powers", () => {
    expect(resolveTerritorySettings(undefined)).toEqual(DEFAULT_TERRITORY_SETTINGS);
    const r = resolveTerritorySettings({ cols: 200, teams: 3, ballsPerTeam: 0, powers: "ghost,nope,bomber", powerEvery: 2.3, radius: 99, duration: 7, pegs: "yes" as never, badge: false, hud: 1 as never });
    expect(r.cols).toBe(200);
    expect(r.teams).toBe(4);
    expect(r.ballsPerTeam).toBe(1);
    expect(r.powers).toEqual(["ghost", DEFAULT_TY_POWERS[1], "bomber", DEFAULT_TY_POWERS[3]]);
    expect(r.powerEvery).toBe(2.5);
    expect(r.radius).toBe(99);
    expect(r.duration).toBe(10);
    expect(resolveTerritorySettings({ cols: 1e9, teams: 1e9, ballsPerTeam: 1e9, powerEvery: 1e9, radius: 1e9, duration: 1e9 })).toMatchObject({ cols: MEMORY_CEILINGS.tyCols, teams: 4, ballsPerTeam: MEMORY_CEILINGS.tyBallsPerTeam, powerEvery: 1e9, radius: 1e9, duration: 1e9 });
    expect(MEMORY_CEILINGS.tyTeams).toBe(TY_MAX_TEAMS);
    expect(resolveTerritorySettings({ cols: Infinity, radius: Number.NaN, duration: -5 })).toMatchObject({ cols: DEFAULT_TERRITORY_SETTINGS.cols, radius: DEFAULT_TERRITORY_SETTINGS.radius, duration: 10 });
    expect(r.pegs).toBe(false);
    expect(r.badge).toBe(false);
    expect(r.hud).toBe(true);
    expect(resolveTerritorySettings({ teams: 2 }).teams).toBe(2);
    expect(resolveTerritorySettings({ teams: 1 }).teams).toBe(2);
    expect(parseTyPowers("painter")).toEqual(["painter", "bomber", "painter", "ghost"]);
    expect(serializeTyPowers(["none", "ghost", "vortex", "bomber"])).toBe("none,ghost,vortex,bomber");
    expect(territorySettingsOf(territorySettingFields(DEFAULT_TERRITORY_SETTINGS))).toEqual(DEFAULT_TERRITORY_SETTINGS);
  });

  it("are the defaults in every mode, stay out of the URL and give Territory a clip that covers the verdict", () => {
    const d = defaultSettings("territory");
    expect(territorySettingsOf(d)).toEqual(DEFAULT_TERRITORY_SETTINGS);
    expect(d.recordingDuration).toBe(territoryClipSec(DEFAULT_TERRITORY_SETTINGS.duration));
    expect(d.recordingDuration).toBeGreaterThan(DEFAULT_TERRITORY_SETTINGS.duration);
    expect(defaultSettings("classic").recordingDuration).toBe(30);
    expect(territorySettingsOf(defaultSettings("classic"))).toEqual(DEFAULT_TERRITORY_SETTINGS);
    const query = settingsToSearchParams(d);
    for (const key of ["tyc", "tyt", "tyb", "typ", "tye", "tyr", "tyd", "typg", "tybg", "tyh", "dur"]) expect(query.has(key), key).toBe(false);
    expect([territoryClipSec(1), territoryClipSec(120), territoryClipSec(600)]).toEqual([10, 124, 604]); // (no maximum: the clip follows any countdown)
    expect(RANGES.tyCols).toEqual(TERRITORY_RANGES.tyCols);
  });

  it("round-trip through the URL and presets, invalid values refused on the way in, big ones kept", () => {
    const s = { ...defaultSettings("territory"), tyCols: 40, tyTeams: 4, tyBallsPerTeam: 5, tyPowers: "ghost,painter,none,bomber", tyPowerEvery: 4.5, tyRadius: 5, tyDuration: 60, tyPegs: true, tyBadge: false, tyHud: false };
    const query = settingsToSearchParams(s);
    expect(query.get("tyc")).toBe("40");
    expect(query.get("typ")).toBe("ghost,painter,none,bomber");
    const back = settingsFromSearchParams(query);
    expect(territorySettingsOf(back)).toEqual(territorySettingsOf(s));
    const wild = settingsFromSearchParams(new URLSearchParams("mode=territory&tyc=5&tyt=9&tyb=40&typ=x,y&tye=abc&tyr=-3&tyd=999&typg=2&tyh=0"));
    expect(territorySettingsOf(wild)).toEqual({ ...DEFAULT_TERRITORY_SETTINGS, cols: 12, teams: 4, ballsPerTeam: 40, radius: 1, duration: 999, hud: false });
    // (the link keeps a team count past the four quadrants as typed; the run plays four)
    expect([wild.tyTeams, wild.tyBallsPerTeam, wild.tyDuration]).toEqual([9, 40, 999]);
    expect(territorySettingsOf(settingsFromSearchParams(settingsToSearchParams(wild)))).toEqual(territorySettingsOf(wild));
    const preset = presetToSettings({ mode: "territory", tyCols: "abc" as never, tyTeams: 4, tyPowers: "bomber", tyPegs: "yes" as never } as never);
    expect(territorySettingsOf(preset)).toEqual({ ...DEFAULT_TERRITORY_SETTINGS, teams: 4, powers: ["bomber", "bomber", "painter", "ghost"] });
  });

  it("registers the mode: its id, its card after the String Battle and the battle family", () => {
    expect(MODE_IDS).toContain("territory");
    expect(MODE_CATEGORIES.territory).toBe("battle");
    expect(MODE_CARD_ORDER.indexOf("territory")).toBe(MODE_CARD_ORDER.indexOf("stringBattle") + 1);
    expect(modesInCategory("battle")).toContain("territory");
    expect(BATTLE_WINNER_MODES).toContain("territory");
    expect(slowViewEligible("territory")).toBe(true);
  });
});

/* ------------------------------------------------------------------ the board and the pure maths */

describe("the board", () => {
  it("derives even rows from the columns and the field's shape", () => {
    for (let cols = TERRITORY_RANGES.tyCols.min; cols <= TERRITORY_RANGES.tyCols.max; cols++) {
      const rows = territoryRows(cols);
      expect(rows % 2, `cols ${cols}`).toBe(0);
      expect(rows).toBeGreaterThanOrEqual(0.75 * cols);
      expect(rows).toBeLessThanOrEqual(0.87 * cols);
    }
    expect(territoryRows(24)).toBe(20);
    expect(territoryRows(48)).toBe(40);
  });

  it("lays the grid out in the centred square the recorder crops to, under the HUD band", () => {
    for (const [w, h] of [
      [800, 600],
      [390, 390],
      [1400, 787],
      [500, 900],
    ]) {
      const f = territoryField(w, h, 30);
      const side = Math.min(w, h);
      expect(f.side).toBe(side);
      expect(f.gx).toBeGreaterThan((w - side) / 2);
      expect(f.gx + f.gridW).toBeLessThan((w + side) / 2 + 1e-9);
      expect(f.gy).toBeGreaterThanOrEqual(f.hudTop + f.hudHeight - 1e-9);
      expect(f.gy + f.gridH).toBeLessThan((h + side) / 2 + 1e-9);
      expect(f.gridW).toBeCloseTo(f.cols * f.tile, 9);
      expect(f.rows).toBe(territoryRows(30));
    }
  });

  it("splits the board fairly: halves for 2 teams, quadrants for 4", () => {
    expect(regionOwner(3, 0, 24, 20, 2)).toBe(0);
    expect(regionOwner(3, 19, 24, 20, 2)).toBe(1);
    expect(regionOwner(0, 0, 24, 20, 4)).toBe(0);
    expect(regionOwner(23, 0, 24, 20, 4)).toBe(1);
    expect(regionOwner(0, 19, 24, 20, 4)).toBe(2);
    expect(regionOwner(23, 19, 24, 20, 4)).toBe(3);
    for (const teams of [2, 4]) {
      for (let cols = 12; cols <= 48; cols++) {
        const rows = territoryRows(cols);
        const tiles = new Uint8Array(cols * rows);
        const counts = new Int32Array(4);
        fillRegions(tiles, cols, rows, teams, counts);
        const played = Array.from(counts.subarray(0, teams));
        expect(Math.max(...played) - Math.min(...played), `${teams} teams, ${cols} cols`).toBeLessThanOrEqual(1);
        if (teams === 2 || cols % 2 === 0) expect(new Set(played).size).toBe(1);
        expect(played.reduce((a, b) => a + b, 0)).toBe(cols * rows);
      }
    }
  });

  it("gives whole percentages that add up to 100 and names the leader", () => {
    expect(tilePercentages([1, 1, 1], 3)).toEqual([34, 33, 33]);
    expect(tilePercentages([251, 229], 2)).toEqual([52, 48]);
    expect(tilePercentages([0, 0], 2)).toEqual([0, 0]);
    expect(tilePercentages([5, 0, 0, 0], 4)).toEqual([100, 0, 0, 0]);
    for (let k = 0; k < 200; k++) {
      const counts = [(k * 7) % 13, (k * 11) % 17, (k * 3) % 5, (k * 5) % 7];
      if (counts.reduce((a, b) => a + b, 0) === 0) continue;
      expect(tilePercentages(counts, 4).reduce((a, b) => a + b, 0)).toBe(100);
    }
    expect(tileLeader([3, 5, 1, 0], 4)).toBe(1);
    expect(tileLeader([5, 5, 1, 0], 4)).toBe(-1);
    expect(tileLeader([5, 5, 6, 0], 4)).toBe(2);
  });

  it("the rig never lets a rival pass the chosen team, and a level verdict goes to it", () => {
    expect(territoryForcedWinner(1, 2)).toBe(1);
    expect(territoryForcedWinner(2, 2)).toBe(-1);
    expect(territoryForcedWinner(undefined, 4)).toBe(-1);
    // Level: a rival may take neither the chosen team's tile nor a third team's; the chosen team may take anything.
    expect(rigBlocksConversion([10, 10, 10], 1, 0, 1)).toBe(true);
    expect(rigBlocksConversion([10, 10, 10], 2, 0, 1)).toBe(true);
    expect(rigBlocksConversion([10, 10, 10], 0, 1, 1)).toBe(false);
    // Ahead by one: a rival may draw level from a third team, not by taking the chosen team's tile.
    expect(rigBlocksConversion([10, 11, 9], 2, 0, 1)).toBe(false);
    expect(rigBlocksConversion([10, 11, 9], 1, 0, 1)).toBe(true);
    expect(rigBlocksConversion([9, 12, 9], 1, 0, 1)).toBe(false);
    // Taking the chosen team's tile must not let a third team pass it either.
    expect(rigBlocksConversion([118, 110, 126, 126], 3, 0, 3)).toBe(true);
    expect(rigBlocksConversion([118, 110, 125, 127], 3, 0, 3)).toBe(false);
    expect(rigBlocksConversion([118, 110, 126, 126], 3, 0, 3, 2)).toBe(false);
    expect(rigBlocksConversion([10, 10], 1, 0, -1)).toBe(false);
    expect(territoryLeaders([10, 12, 12, 3], 4, -1)).toEqual([1, 2]);
    expect(territoryLeaders([10, 12, 12, 3], 4, 2)).toEqual([2]);
    expect(territoryLeaders([10, 12, 12, 3], 4, 0)).toEqual([1, 2]);
    expect(territoryLeaders([7, 7], 2, -1)).toEqual([0, 1]);
  });

  it("pitches a flip by team and row on the pentatonic ladder, the top rows high", () => {
    const ladder = TY_LADDER.map(midiToFrequency);
    for (let team = 0; team < 4; team++) {
      for (let row = 0; row < 20; row++) expect(ladder.some((f) => Math.abs(f - flipFrequency(team, row, 20)) < 1e-9)).toBe(true);
      expect(flipFrequency(team, 0, 20)).toBeGreaterThan(flipFrequency(team, 19, 20));
    }
    expect(flipFrequency(1, 10, 20)).not.toBe(flipFrequency(0, 10, 20));
  });

  it("keeps headings off the axes, ramps the finale and sweeps the whirl's arms out to the reach", () => {
    for (let k = 0; k < 64; k++) {
      const a = awayFromAxes((k / 64) * 2 * Math.PI + 0.01);
      const inQ = a % (Math.PI / 2);
      expect(inQ).toBeGreaterThanOrEqual(TY_MIN_AXIS - 1e-9);
      expect(inQ).toBeLessThanOrEqual(Math.PI / 2 - TY_MIN_AXIS + 1e-9);
      // The quadrant (the signs of both components) is kept.
      const b = (k / 64) * 2 * Math.PI + 0.01;
      expect(Math.floor(a / (Math.PI / 2))).toBe(Math.floor(b / (Math.PI / 2)));
    }
    expect(territoryFinaleFactor(0)).toBe(1);
    expect(territoryFinaleFactor(TY_FINALE_MS)).toBeCloseTo(TY_FINALE_SPEED, 12);
    expect(territoryFinaleFactor(TY_FINALE_MS / 2)).toBeCloseTo(1 + (TY_FINALE_SPEED - 1) / 2, 12);
    const p = { x: 0, y: 0 };
    whirlPoint(0, 48, 0, 0.3, 1, 60, p);
    expect(Math.hypot(p.x, p.y)).toBe(0);
    whirlPoint(48, 48, 0, 0.3, 1, 60, p);
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(60, 9);
    const q = { x: 0, y: 0 };
    whirlPoint(24, 48, 0, 0.3, 1, 60, p);
    whirlPoint(24, 48, 1, 0.3, 1, 60, q);
    expect(p.x).toBeCloseTo(-q.x, 9);
    expect(p.y).toBeCloseTo(-q.y, 9);
  });
});

/* ------------------------------------------------------------------ the pong-wars rule in the engine */

describe("Territory in the engine", () => {
  it("starts every team's balls inside its own region, without gravity, sized by the tiles", () => {
    for (const teams of [2, 4] as const) {
      const engine = territory({ teams, ballsPerTeam: 8, cols: 20 });
      const v = engine.getTerritoryView();
      expect(v.teams).toBe(teams);
      expect(engine.getBalls()).toHaveLength(teams * 8);
      expect(accounted(engine).ok).toBe(true);
      for (const b of engine.getBalls()) {
        const { col, row } = tileOf(engine, b.x, b.y);
        expect(owner(engine, col, row)).toBe(b.team);
        expect(b.gravityScale).toBe(0);
        expect(b.radius).toBeGreaterThan(0.2 * v.field.tile);
        expect(b.radius).toBeLessThan(0.9 * v.field.tile);
        expect(b.color).toBe(TY_PALETTE[b.team!].color);
      }
    }
  });

  it("a ball passes through its own colour, bounces off another and converts the tile it hit", () => {
    const engine = territory({ powers: NONE, ballsPerTeam: 1 });
    const v = engine.getTerritoryView();
    const f = v.field;
    const ball = onlyBall(engine, 0);
    const col = 7;
    const boundary = f.gy + (v.rows / 2) * f.tile;
    // Inside its own half, moving sideways: nothing happens for a few frames.
    ball.x = f.gx + 4 * f.tile;
    ball.y = f.gy + 3.5 * f.tile;
    ball.vx = 400;
    ball.vy = 0;
    for (let i = 0; i < 6; i++) engine.update(STEP, 0);
    expect(v.conversions).toBe(0);
    expect(v.tileBounces).toBe(0);
    // At the border, heading straight down into the enemy half.
    const before = Array.from(v.counts.subarray(0, 2));
    ball.x = f.gx + (col + 0.5) * f.tile;
    ball.y = boundary - ball.radius - 0.5;
    ball.vx = 0;
    ball.vy = 400;
    expect(owner(engine, col, v.rows / 2)).toBe(1);
    engine.update(STEP, 0);
    expect(owner(engine, col, v.rows / 2)).toBe(0);
    expect(ball.vy).toBeLessThan(0);
    expect(v.conversions).toBe(1);
    expect(v.tileBounces).toBe(1);
    expect(Array.from(v.counts.subarray(0, 2))).toEqual([before[0] + 1, before[1] - 1]);
    expect(accounted(engine).ok).toBe(true);
    // The cruising speed is the square's side × TY_SPEED at Ball Speed 400.
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(TY_SPEED * f.side, 6);
  });

  it("bounces the same off a border or a corner from either side: no side of the board is favoured", () => {
    // Team 0 above the border and team 1 below it are each other's 180° turn; so are their bounces.
    const shots: [number, number, number, number][] = [
      [7.5, -0.5, 0.3, 0.95],
      [7.2, -0.5, -0.6, 0.8],
      [11.9, -0.4, 0.95, 0.3],
      [4.05, -1.3, -0.7, 0.7],
    ];
    for (const corner of [false, true]) {
      for (const [u, dv, ux, uy] of shots) {
        const top = territory({ powers: NONE, ballsPerTeam: 1 });
        const bottom = territory({ powers: NONE, ballsPerTeam: 1 });
        const v = top.getTerritoryView();
        const f = v.field;
        const mid = v.rows / 2;
        if (corner) {
          // An enemy tile sticking into each side next to the ball: a concave corner of the border.
          setTile(top, Math.floor(u) + 1, mid - 1, 1);
          setTile(bottom, v.cols - 1 - (Math.floor(u) + 1), mid, 0);
        }
        const a = onlyBall(top, 0);
        const b = onlyBall(bottom, 1);
        a.x = f.gx + u * f.tile;
        a.y = f.gy + (mid + dv) * f.tile - a.radius + 0.5 * f.tile;
        a.vx = 400 * ux;
        a.vy = 400 * uy;
        b.x = f.gx + f.gridW - (a.x - f.gx);
        b.y = f.gy + f.gridH - (a.y - f.gy);
        b.vx = -a.vx;
        b.vy = -a.vy;
        for (let i = 0; i < 3; i++) {
          top.update(STEP, 0);
          bottom.update(STEP, 0);
        }
        const label = `${corner ? "corner" : "border"} ${u},${dv}`;
        expect(b.vx, label).toBeCloseTo(-a.vx, 6);
        expect(b.vy, label).toBeCloseTo(-a.vy, 6);
        expect(b.x - f.gx, label).toBeCloseTo(f.gridW - (a.x - f.gx), 6);
        expect(top.getTerritoryView().conversions, label).toBe(bottom.getTerritoryView().conversions);
        expect(top.getTerritoryView().counts[0], label).toBe(bottom.getTerritoryView().counts[1]);
      }
    }
  });

  it("judges a sub-step on the board as it stood when the sub-step began: the order the balls move in changes nothing", () => {
    const run = (order: "ab" | "ba") => {
      const engine = territory({ powers: NONE, ballsPerTeam: 1 });
      const v = engine.getTerritoryView();
      const f = v.field;
      const boundary = f.gy + (v.rows / 2) * f.tile;
      const a = engine.getBalls().find((b) => b.team === 0)!;
      const b = engine.getBalls().find((b) => b.team === 1)!;
      // A dives into tile X (team 1's, just below the border) while B, below X, rises into it. In the first sub-step A takes
      // X while B – which judged X its own when the sub-step began – flies on into it, whoever moves first; in the next one
      // B bounces off X and takes it back.
      a.x = b.x = f.gx + 7.5 * f.tile;
      a.y = boundary - a.radius - 0.5;
      a.vx = 0;
      a.vy = 400;
      b.y = boundary + f.tile + b.radius + 0.5;
      b.vx = 0;
      b.vy = -400;
      engine.setBalls(order === "ab" ? [a, b] : [b, a]);
      engine.update(STEP, 0);
      const at = (ball: { x: number; y: number; vx: number; vy: number }) => [ball.x, ball.y, ball.vx, ball.vy].map((n) => Math.round(n * 1e6));
      return { x: owner(engine, 7, v.rows / 2), a: at(a), b: at(b), conversions: v.conversions, counts: Array.from(v.counts.subarray(0, 2)) };
    };
    const ab = run("ab");
    const ba = run("ba");
    expect(ab).toEqual(ba);
    expect(ab.conversions).toBe(2);
    expect(ab.x).toBe(1);
    expect(ab.a[3]).toBeLessThan(0);
    expect(ab.b[3]).toBeGreaterThan(0);
  });

  it("lets the balls join in rounds, a ball of every team a round, so no team always moves first", () => {
    for (const teams of [2, 4] as const) {
      const firsts = new Set<number>();
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const engine = territory({ teams, ballsPerTeam: 3 }, seed);
        const order = engine.getBalls().map((b) => b.team!);
        for (let round = 0; round < 3; round++) expect(new Set(order.slice(round * teams, (round + 1) * teams)).size).toBe(teams);
        // The team that starts a round turns from round to round (and the first one from seed to seed).
        expect(order[teams]).toBe((order[0] + 1) % teams);
        firsts.add(order[0]);
      }
      expect(firsts.size).toBeGreaterThan(1);
    }
  });

  it("keeps the percentages accounted for at every step of whole runs, with every power and 4 teams", () => {
    for (const settings of [{}, { teams: 4 as const, ballsPerTeam: 3, powers: ["vortex", "bomber", "painter", "ghost"] as TyPower[] }, { pegs: true, powers: ["ghost", "painter", "none", "none"] as TyPower[] }]) {
      const engine = territory({ ...settings, duration: 12 });
      const v = engine.getTerritoryView();
      const f = v.field;
      let steps = 0;
      while (!engine.isSimulationFinished() && steps < 60 * 20) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        steps++;
        if (steps % 10 === 0) expect(accounted(engine).ok).toBe(true);
        for (const b of engine.getBalls()) {
          expect(b.x).toBeGreaterThanOrEqual(f.gx + b.radius - 1e-6);
          expect(b.x).toBeLessThanOrEqual(f.gx + f.gridW - b.radius + 1e-6);
          expect(b.y).toBeGreaterThanOrEqual(f.gy + b.radius - 1e-6);
          expect(b.y).toBeLessThanOrEqual(f.gy + f.gridH - b.radius + 1e-6);
        }
      }
      expect(engine.isSimulationFinished()).toBe(true);
      expect(v.conversions).toBeGreaterThan(20);
      expect(accounted(engine).ok).toBe(true);
    }
  });

  it("vortex: its path curves, and a whirl converts the enemy tiles along two spiral arms within its reach", () => {
    // A slow ball (Ball Speed 50), so the whirl sweeps the border it sits on while the ball hardly moves.
    const engine = territory({ powers: ["vortex", "none", "none", "none"], ballsPerTeam: 1, powerEvery: 10 }, 42, { ...config, ballSpeed: 50 });
    const v = engine.getTerritoryView();
    const f = v.field;
    const ball = onlyBall(engine, 0);
    const tb = teamBall(engine, ball);
    tb.nextPowerMs = Infinity;
    ball.x = f.gx + 0.5 * f.gridW;
    ball.y = f.gy + 0.25 * f.gridH;
    ball.vx = 300;
    ball.vy = 0;
    const a0 = Math.atan2(ball.vy, ball.vx);
    for (let i = 0; i < 15; i++) engine.update(STEP, 0);
    const turned = Math.atan2(ball.vy, ball.vx) - a0;
    expect(Math.abs(turned)).toBeCloseTo(TY_VORTEX_CURVE * 15 * (STEP / 1000), 3);
    expect(v.conversions).toBe(0);
    // A whirl on the border, the ball sliding along it.
    ball.x = f.gx + 0.5 * f.gridW;
    ball.y = f.gy + (v.rows / 2) * f.tile - ball.radius - 1;
    ball.vx = 300;
    ball.vy = 0;
    const start = { x: ball.x, y: ball.y };
    tb.nextPowerMs = 0;
    const events: SoundEvent[] = [];
    let travelled = 0;
    for (let t = 0; t < TY_WHIRL_MS + 3 * STEP; t += STEP) {
      const x = ball.x;
      const y = ball.y;
      engine.update(STEP, 0);
      travelled += Math.hypot(ball.x - x, ball.y - y);
      events.push(...engine.consumeSoundEvents());
    }
    expect(v.whirls).toBe(1);
    expect(events.some((e) => e.type === "multiplier")).toBe(true);
    expect(v.conversions).toBeGreaterThan(5);
    const reach = v.settings.radius * f.tile + travelled + f.tile;
    for (let n = 0; n < v.flipCount; n++) {
      const idx = v.flipTile[n];
      const col = idx % v.cols;
      const row = (idx - col) / v.cols;
      expect(Math.hypot(f.gx + (col + 0.5) * f.tile - start.x, f.gy + (row + 0.5) * f.tile - start.y)).toBeLessThan(reach);
      expect(v.flipTeam[n]).toBe(0);
    }
    expect(accounted(engine).ok).toBe(true);
  });

  it("bomber: it arms on its timer and blows on its next bounce off an enemy tile – every tile within its reach, a ring, a boom, the other balls blown away", () => {
    const engine = territory({ powers: ["none", "bomber", "none", "none"], ballsPerTeam: 2, radius: 3, powerEvery: 3 });
    const v = engine.getTerritoryView();
    const f = v.field;
    // The two bombers of team 1 alone: one arms in the middle of its own half, then meets the border; its teammate nearby is
    // blown away (a teammate never converts its own tiles back).
    engine.setBalls(engine.getBalls().filter((b) => b.team === 1));
    const [bomber, other] = engine.getBalls();
    const tb = teamBall(engine, bomber);
    teamBall(engine, other).nextPowerMs = Infinity;
    bomber.x = f.gx + 10.5 * f.tile;
    bomber.y = f.gy + 0.75 * f.gridH;
    bomber.vx = 300;
    bomber.vy = 0;
    other.x = f.gx + 0.85 * f.gridW;
    other.y = f.gy + 0.9 * f.gridH;
    other.vx = 0;
    other.vy = 300;
    tb.nextPowerMs = 0;
    engine.update(STEP, 0);
    expect(engine.consumeSoundEvents().some((e) => e.type === "gap")).toBe(false);
    // Armed: nothing blows until the bomber bounces off an enemy tile (its own half has none).
    expect(tb.armedMs).toBeGreaterThan(-Infinity);
    expect(v.blasts).toBe(0);
    expect(v.conversions).toBe(0);
    // Now at the border, heading into the enemy half, its teammate just below it.
    bomber.x = f.gx + 10.5 * f.tile;
    bomber.y = f.gy + (v.rows / 2) * f.tile + bomber.radius + 0.5;
    bomber.vx = 0;
    bomber.vy = -300;
    other.x = bomber.x + 2 * f.tile;
    other.y = bomber.y + 1 * f.tile;
    other.vx = -300;
    other.vy = 0;
    const toward = (other.vx * 2 + other.vy * 1) / (Math.hypot(other.vx, other.vy) * Math.hypot(2, 1));
    engine.update(STEP, 0);
    const events = engine.consumeSoundEvents();
    expect(v.blasts).toBe(1);
    expect(v.shocks).toHaveLength(1);
    expect(events.filter((e) => e.type === "gap")).toHaveLength(1);
    expect(tb.armedMs).toBe(-Infinity);
    expect(tb.nextPowerMs).toBeCloseTo(engine.getElapsedMs() + 3000, 6);
    // Every tile within the reach of the blast's centre is the bomber's – half of them were the enemy's.
    const shock = v.shocks[0];
    let taken = 0;
    for (let row = 0; row < v.rows; row++) {
      for (let col = 0; col < v.cols; col++) {
        if (Math.hypot(col + 0.5 - shock.u, row + 0.5 - shock.v) <= 3) {
          expect(owner(engine, col, row), `${col},${row}`).toBe(1);
          if (row < v.rows / 2) taken++;
        }
      }
    }
    expect(taken).toBeGreaterThan(8);
    // The shock turned the other ball away from the blast.
    const dx = other.x - bomber.x;
    const dy = other.y - bomber.y;
    expect((other.vx * dx + other.vy * dy) / (Math.hypot(other.vx, other.vy) * Math.hypot(dx, dy))).toBeGreaterThan(toward + 0.2);
    expect(accounted(engine).ok).toBe(true);
  });

  it("bomber: an armed ball that meets no enemy tile blows where it is after a short fuse", () => {
    const engine = territory({ powers: ["none", "bomber", "none", "none"], ballsPerTeam: 1, radius: 2 });
    const v = engine.getTerritoryView();
    const f = v.field;
    const bomber = onlyBall(engine, 1);
    const tb = teamBall(engine, bomber);
    bomber.x = f.gx + 0.5 * f.gridW;
    bomber.y = f.gy + 0.8 * f.gridH;
    bomber.vx = 300;
    bomber.vy = 0;
    tb.nextPowerMs = 0;
    engine.update(STEP, 0);
    const armed = tb.armedMs;
    expect(armed).toBeGreaterThan(-Infinity);
    while (engine.getElapsedMs() < armed + TY_ARM_MAX_MS - 1e-6) {
      expect(v.blasts).toBe(0);
      engine.update(STEP, 0);
    }
    engine.update(STEP, 0);
    expect(v.blasts).toBe(1);
    expect(v.shocks).toHaveLength(1);
    expect(v.conversions).toBe(0); // its own half: nothing to take
    expect(tb.armedMs).toBe(-Infinity);
  });

  it("painter: a dash runs straight through enemy territory painting a one-tile trail, then bounces again", () => {
    const engine = territory({ powers: ["painter", "none", "none", "none"], ballsPerTeam: 1 });
    const v = engine.getTerritoryView();
    const f = v.field;
    const ball = onlyBall(engine, 0);
    const col = 9;
    ball.x = f.gx + (col + 0.5) * f.tile;
    ball.y = f.gy + (v.rows / 2) * f.tile - ball.radius - 0.5;
    ball.vx = 0;
    ball.vy = 400;
    teamBall(engine, ball).nextPowerMs = 0;
    // The dash runs TY_DASH_TILES tiles at the dash speed: the same trail on any board.
    const dashMs = (1000 * TY_DASH_TILES * f.tile) / (TY_SPEED * f.side * TY_DASH_SPEED);
    const frames = Math.floor(dashMs / STEP) - 1;
    for (let i = 0; i < frames; i++) engine.update(STEP, 0);
    expect(v.dashes).toBe(1);
    expect(v.tileBounces).toBe(0);
    expect(ball.vy).toBeGreaterThan(0);
    const { row } = tileOf(engine, ball.x, ball.y);
    for (let r = v.rows / 2; r <= row; r++) expect(owner(engine, col, r)).toBe(0);
    expect(v.conversions).toBe(row - v.rows / 2 + 1);
    expect(v.conversions).toBeGreaterThanOrEqual(Math.floor(TY_DASH_TILES) - 1);
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    expect(v.tileBounces).toBeGreaterThan(0);
    expect(accounted(engine).ok).toBe(true);
  });

  it("ghost: passes through enemy tiles without bouncing or converting, and converts a whole 3×3 block on a wall bounce", () => {
    const engine = territory({ powers: ["ghost", "none", "none", "none"], ballsPerTeam: 1 });
    const v = engine.getTerritoryView();
    const f = v.field;
    const ball = onlyBall(engine, 0);
    ball.x = f.gx + 0.5 * f.gridW;
    ball.y = f.gy + 0.75 * f.gridH;
    ball.vx = 300;
    ball.vy = 300;
    for (let i = 0; i < 6; i++) engine.update(STEP, 0);
    expect(v.conversions).toBe(0);
    expect(v.tileBounces).toBe(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeCloseTo(TY_SPEED * f.side * TY_GHOST_SPEED, 6);
    // Into the bottom frame.
    ball.x = f.gx + 10.5 * f.tile;
    ball.y = f.gy + f.gridH - ball.radius - 0.5;
    ball.vx = 100;
    ball.vy = 400;
    engine.update(STEP, 0);
    expect(v.wallBounces).toBe(1);
    expect(v.ghostBlocks).toBe(1);
    // The block around its tile, moved inside the board: three whole rows above the frame.
    expect(v.conversions).toBe(9);
    for (let r = v.rows - 3; r < v.rows; r++) for (let c = 9; c <= 11; c++) expect(owner(engine, c, r)).toBe(0);
    expect(accounted(engine).ok).toBe(true);
  });

  it("pegs: the dotted grid deflects the balls through the obstacle layer, and no ball ends up inside a dot", () => {
    const engine = territory({ pegs: true, powers: NONE, ballsPerTeam: 4, duration: 20 });
    const v = engine.getTerritoryView();
    const f = v.field;
    const L = TY_PEG_STEP * f.tile;
    const pegR = TY_PEG_RADIUS * f.tile;
    // The deepest a ball ever sat in a dot, as a share of its radius (a ball-to-ball push after the peg pass may press a
    // ball into a dot a little; the next sub-step resolves it).
    let deepest = 0;
    for (let s = 0; s < 60 * 20 && !engine.isSimulationFinished(); s++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      for (const b of engine.getBalls()) {
        for (let j = 1; j <= pegLast(v.rows); j++) {
          for (let i = 1; i <= pegLast(v.cols); i++) {
            const depth = (b.radius + pegR - Math.hypot(b.x - (f.gx + i * L), b.y - (f.gy + j * L))) / b.radius;
            if (depth > deepest) deepest = depth;
          }
        }
      }
    }
    expect(deepest).toBeLessThan(0.25);
    expect(v.pegHits).toBeGreaterThan(0);
    const plain = territory({ pegs: false, powers: NONE, ballsPerTeam: 4, duration: 20 });
    for (let s = 0; s < 60 * 20; s++) plain.update(STEP, 0);
    expect(plain.getTerritoryView().pegHits).toBe(0);
  });

  it("plays at most one flip note a step, on the ladder, a boom per blast and an arpeggio per whirl", () => {
    const engine = territory({ duration: 20 });
    const v = engine.getTerritoryView();
    const ladder = TY_LADDER.map(midiToFrequency);
    let notes = 0;
    let booms = 0;
    let arps = 0;
    while (!engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      const events = engine.consumeSoundEvents();
      const flips = events.filter((e) => e.type === "hit" && !e.accent);
      expect(flips.length).toBeLessThanOrEqual(1);
      for (const e of events.filter((e) => e.type === "hit")) expect(ladder.some((f) => Math.abs(f - (e.frequency ?? 0)) < 1e-9)).toBe(true);
      notes += flips.length;
      booms += events.filter((e) => e.type === "gap").length;
      arps += events.filter((e) => e.type === "multiplier").length;
    }
    expect(notes).toBe(v.notes);
    expect(notes).toBeGreaterThan(10);
    expect(booms).toBeGreaterThan(0);
    expect(booms).toBeLessThanOrEqual(v.blasts);
    expect(arps).toBe(v.whirls);
  });

  it("speeds up in the finale and flags it", () => {
    const engine = territory({ duration: 10, powers: NONE });
    const v = engine.getTerritoryView();
    for (let t = 0; t < 10_000 - TY_FINALE_MS - 100; t += STEP) engine.update(STEP, 0);
    expect(v.finale).toBe(false);
    for (let t = 0; t < TY_FINALE_MS - 200; t += STEP) engine.update(STEP, 0);
    expect(v.finale).toBe(true);
    expect(v.speedFactor).toBeGreaterThan(1.25);
    const cruise = TY_SPEED * v.field.side * v.speedFactor;
    expect(engine.getBalls().some((b) => Math.abs(Math.hypot(b.vx, b.vy) / cruise - 1) < 1e-6)).toBe(true);
  });
});

/* ------------------------------------------------------------------ the verdict, the rig, determinism, resize */

describe("the verdict", () => {
  it("the most tiles win at the countdown: the banner's winner, the team stats and the finder rank it alike", () => {
    for (const seed of [1, 2, 3]) {
      const engine = territory({ duration: 10 }, seed);
      const v = engine.getTerritoryView();
      let t = 0;
      while (!engine.isSimulationFinished()) {
        engine.update(STEP, 0);
        t += STEP;
      }
      expect(t).toBeCloseTo(10_000, -1);
      expect(v.finishedMs).toBeCloseTo(10_000, 3);
      const counts = Array.from(v.counts.subarray(0, 2));
      const stats = engine.getTeamStats().slice(0, 2);
      if (counts[0] === counts[1]) {
        expect(v.tie).toBe(true);
        expect(v.winner).toBe(-1);
      } else {
        const best = counts[0] > counts[1] ? 0 : 1;
        expect(v.winner).toBe(best);
        expect(teamResult(stats, 2)).toMatchObject({ winner: best, tie: false });
        expect(stats[best].escapes).toBe(1);
        expect(stats[1 - best].escapes).toBe(0);
      }
      expect(stats.map((s) => s.walls)).toEqual(counts);
      // The board freezes: no conversion after the verdict.
      const frozen = v.conversions;
      for (let i = 0; i < 60; i++) engine.update(STEP, 0);
      expect(v.conversions).toBe(frozen);
      expect(Array.from(v.counts.subarray(0, 2))).toEqual(counts);
    }
  });

  it("a level top is a DRAW: both teams share it and the team stats tie", () => {
    const engine = territory({ duration: 10, powers: NONE });
    const v = engine.getTerritoryView();
    const f = v.field;
    while (engine.getElapsedMs() < 10_000 - 2 * STEP) engine.update(STEP, 0);
    // Level the board and park the balls in the middle of their own halves (no contact in the last steps).
    fillRegions(v.tiles, v.cols, v.rows, v.teams, v.counts);
    const seen = [0, 0];
    for (const b of engine.getBalls()) {
      const k = seen[b.team!]++;
      b.x = f.gx + (0.3 + 0.4 * k) * f.gridW;
      b.y = f.gy + (b.team === 0 ? 0.25 : 0.75) * f.gridH;
      b.vx = 1;
      b.vy = 0;
    }
    while (!engine.isSimulationFinished()) engine.update(STEP, 0);
    expect(v.tie).toBe(true);
    expect(v.winner).toBe(-1);
    expect(v.leaders).toEqual([0, 1]);
    const stats = engine.getTeamStats().slice(0, 2);
    expect(stats[0].escapes).toBe(1);
    expect(stats[1].escapes).toBe(1);
    expect(teamResult(stats, 2).tie).toBe(true);
  });

  it("the forced winner never falls behind and takes every verdict, whatever the powers", () => {
    for (const [seed, powers] of [
      [1, ["bomber", "none"]],
      [2, ["painter", "ghost"]],
      [3, ["vortex", "bomber"]],
    ] as [number, TyPower[]][]) {
      const engine = territory({ duration: 12, powers: [...powers, "none", "none"] }, seed, { ...config, forcedWinner: 1 });
      const v = engine.getTerritoryView();
      expect(v.forcedWinner).toBe(1);
      while (!engine.isSimulationFinished()) {
        engine.update(STEP, 0);
        expect(v.counts[1]).toBeGreaterThanOrEqual(v.counts[0]);
      }
      expect(v.winner).toBe(1);
      expect(teamResult(engine.getTeamStats().slice(0, 2), 2)).toMatchObject({ winner: 1, tie: false });
      expect(accounted(engine).ok).toBe(true);
    }
    const four = territory({ teams: 4, ballsPerTeam: 2, duration: 12 }, 5, { ...config, forcedWinner: 3 });
    const v4 = four.getTerritoryView();
    while (!four.isSimulationFinished()) {
      four.update(STEP, 0);
      for (let t = 0; t < 3; t++) expect(v4.counts[3]).toBeGreaterThanOrEqual(v4.counts[t]);
    }
    expect(v4.winner).toBe(3);
    expect(v4.shields).toBeGreaterThan(0);
  });

  it("is deterministic for a seed (and a different seed plays differently)", () => {
    const run = (seed: number) => {
      const engine = territory({ teams: 4, ballsPerTeam: 3, pegs: true, duration: 10 }, seed);
      for (let i = 0; i < 400; i++) engine.update(STEP, 0);
      const v = engine.getTerritoryView();
      return { tiles: Array.from(v.tiles.subarray(0, v.total)).join(""), balls: engine.getBalls().map((b) => [Math.round(b.x * 1e6), Math.round(b.y * 1e6)]) };
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7).tiles).not.toBe(run(8).tiles);
  });

  it("follows a resize: every ball keeps its place on the board, and stays on it", () => {
    const engine = territory({ teams: 4, ballsPerTeam: 2 });
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    const v = engine.getTerritoryView();
    const before = engine.getBalls().map((b) => ({ u: (b.x - v.field.gx) / v.field.tile, v: (b.y - v.field.gy) / v.field.tile, r: b.radius / v.field.tile }));
    engine.setConfig({ width: 500, height: 900 });
    const f = v.field;
    expect(f.side).toBe(500);
    engine.getBalls().forEach((b, i) => {
      expect((b.x - f.gx) / f.tile).toBeCloseTo(before[i].u, 6);
      expect((b.y - f.gy) / f.tile).toBeCloseTo(before[i].v, 6);
      expect(b.radius / f.tile).toBeCloseTo(before[i].r, 6);
    });
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    for (const b of engine.getBalls()) {
      expect(b.x).toBeGreaterThanOrEqual(f.gx);
      expect(b.x).toBeLessThanOrEqual(f.gx + f.gridW);
      expect(b.y).toBeGreaterThanOrEqual(f.gy);
      expect(b.y).toBeLessThanOrEqual(f.gy + f.gridH);
    }
    expect(accounted(engine).ok).toBe(true);
  });

  it("runs 32 balls on 48 columns fast enough for 60 fps", () => {
    const engine = territory({ teams: 4, ballsPerTeam: 8, cols: 48, duration: 30 });
    const t0 = performance.now();
    let steps = 0;
    while (!engine.isSimulationFinished()) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      steps++;
    }
    const ms = performance.now() - t0;
    expect(steps).toBe(1800);
    // Under 1 ms per 60 Hz step on average (a frame's budget is 16.7 ms) – leaving room for a slow CI machine.
    expect(ms / steps).toBeLessThan(1);
  });
});

/* ------------------------------------------------------------------ Find Simulation */

describe("Find Simulation", () => {
  const request = (patch: Partial<FinderRequest> = {}): FinderRequest => ({
    targetDurationSec: 20,
    toleranceSec: 0.5,
    maxSeeds: 40,
    maxSimTimeSec: 60,
    physicsConfig: config,
    mode: "territory",
    modeSettings: { ...modeSettings, territory: { duration: 20 } },
    ...patch,
  });

  it("knows every run lasts its countdown and offers the winner, the teams being the regions", () => {
    expect(runNeverFinishes("territory", { drop: {}, box: {} })).toBe(false);
    expect(fixedRunDurationSec("territory", { territory: { duration: 45 } } as never)).toBe(45);
    expect(fixedRunDurationSec("territory", {} as never)).toBe(DEFAULT_TERRITORY_SETTINGS.duration);
    expect(simulateSeed(3, request(), 60_000)).toBeCloseTo(20_000, -1);
    expect(availableOutcomes("territory", { endless: false, neverEscape: false, ballCount: 2 })).toEqual(["duration", "winner"]);
    expect(forcedWinnerApplies("territory", 4, 3)).toBe(true);
    expect(forcedWinnerApplies("territory", 2, 2)).toBe(false);
    expect(effectiveBallCount({ ...defaultSettings("territory"), tyTeams: 4 })).toBe(4);
    expect(effectiveBallCount({ ...defaultSettings("territory"), teams: [{ name: "A", color: "#ff0000", emoji: "" }] })).toBe(2);
    expect(effectiveBallCount({ ...defaultSettings("classic"), tyTeams: 4 })).toBe(1);
  });

  it("judges the winner outcome by the tiles at the countdown", () => {
    const outcome = { kind: "winner" as const, clipSec: 20, team: 0 };
    for (const seed of [11, 12, 13]) {
      const run = simulateOutcomeRun(seed, request(), outcome);
      expect(run.finished).toBe(true);
      expect(run.teams).toHaveLength(2);
      const engine = territory({ duration: 20 }, seed);
      while (!engine.isSimulationFinished()) engine.update(STEP, 0);
      const v = engine.getTerritoryView();
      expect(outcomeMatches({ ...outcome, team: 0 }, run)).toBe(v.winner === 0);
      expect(outcomeMatches({ ...outcome, team: 1 }, run)).toBe(v.winner === 1);
    }
  });

  it("finds a run the chosen team wins – and at once with the forced winner", { timeout: 60_000 }, async () => {
    const outcome = { kind: "winner" as const, clipSec: 20, team: 1 };
    const found = await withFrames(() => findSimulation(request({ outcome }), () => undefined));
    expect(found.found).toBe(true);
    const engine = territory({ duration: 20 }, found.seed);
    while (!engine.isSimulationFinished()) engine.update(STEP, 0);
    expect(engine.getTerritoryView().winner).toBe(1);
    const rigged = await withFrames(() => findSimulation(request({ outcome, physicsConfig: { ...config, forcedWinner: 1 } }), () => undefined));
    expect(rigged.found).toBe(true);
    expect(rigged.seedsTested).toBe(1);
  });

  it("follows a countdown longer than the search's horizon to its verdict (a 120 s battle under the page's 60 s horizon)", { timeout: 60_000 }, async () => {
    // The page asks for Find Duration + 30 s (60 s at the default 30): a 61–120 s countdown never finished within it, so no
    // seed could match – not even with the forced winner.
    const long = (patch: Partial<FinderRequest> = {}) => request({ maxSimTimeSec: 60, modeSettings: { ...modeSettings, territory: { duration: 120 } }, ...patch });
    const outcome = { kind: "winner" as const, clipSec: 30, team: 1 };
    const run = simulateOutcomeRun(7, long(), outcome);
    expect(run.finished).toBe(true);
    expect(run.durationMs).toBeGreaterThan(120_000 - 1);
    expect(run.durationMs).toBeLessThan(120_000 + FIXED_RUN_SLACK_MS);
    expect(outcomeMatches(outcome, run) || outcomeMatches({ ...outcome, team: 0 }, run) || run.teams.every((t) => t.escapes > 0) /* a draw */).toBe(true);
    const rigged = await withFrames(() => findSimulation(long({ outcome, physicsConfig: { ...config, forcedWinner: 1 } }), () => undefined));
    expect(rigged).toMatchObject({ found: true, seedsTested: 1, finished: true });
    expect(rigged.duration).toBeCloseTo(120, 1);
    const replay = territory({ duration: 120 }, rigged.seed, { ...config, forcedWinner: 1 });
    while (!replay.isSimulationFinished()) replay.update(STEP, 0);
    expect(replay.getTerritoryView().winner).toBe(1);
    // Without the rig the search finds a seed the team wins on its own (about every other seed).
    const natural = await withFrames(() => findSimulation(long({ outcome }), () => undefined));
    expect(natural.found).toBe(true);
    const engine = territory({ duration: 120 }, natural.seed);
    while (!engine.isSimulationFinished()) engine.update(STEP, 0);
    expect(engine.getTerritoryView().winner).toBe(1);
    // The other battles' lengths are the seed's: they keep the horizon (`fixedRunDurationSec()` has none for them).
    expect(fixedRunDurationSec("stringBattle", {} as never)).toBeNull();
    expect(fixedRunDurationSec("maze", {} as never)).toBeNull();
  });
});

/* ------------------------------------------------------------------ the other features */

describe("Territory with the other features", () => {
  it("reports its bounces, ball hits and blasts to bounce math (and runs exactly as before without rules)", () => {
    expect(bounceTriggerApplies("bounce", "territory")).toBe(true);
    expect(bounceTriggerApplies("collide", "territory")).toBe(true);
    expect(bounceTriggerApplies("break", "territory")).toBe(true);
    const listen = (["bounce", "collide", "break"] as const).map((trigger): BounceRule => ({ param: "hue", trigger, every: 1, op: "add", amount: 5, scope: "ball" }));
    const settings: Partial<TerritorySettings> = { teams: 4, ballsPerTeam: 4, powers: ["bomber", "bomber", "vortex", "ghost"], duration: 12 };
    const engine = territory(settings, 9, { ...config, bounceMath: { rules: listen, beat: bounceMathBeatConfig(120), wallThickness: 2, wallWobble: 0, showValues: true } });
    for (let i = 0; i < 600; i++) {
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
    }
    const fires = engine.getBounceMathView().fires;
    expect(fires[0], "bounce").toBeGreaterThan(0);
    expect(fires[1], "ball hit").toBeGreaterThan(0);
    expect(fires[2], "wall break (a blast)").toBeGreaterThan(0);
    expect(accounted(engine).ok).toBe(true);
    // The hue rules change only the colours: the battle itself is the one a run without rules plays.
    const plain = territory(settings, 9);
    for (let i = 0; i < 600; i++) plain.update(STEP, 0);
    expect(Array.from(plain.getTerritoryView().counts)).toEqual(Array.from(engine.getTerritoryView().counts));
  });

  it("runs past its sliders as typed whatever the Wide sliders switch – the board and the balls up to their memory-safety ceilings, the teams 2 or 4", () => {
    const typed = { tyCols: 64, tyBallsPerTeam: 12, tyPowerEvery: 20, tyRadius: 12, tyDuration: 300, tyTeams: 9 };
    const lifted = { cols: 64, ballsPerTeam: 12, powerEvery: 20, radius: 12, duration: 300, teams: 4 };
    for (const unlimited of [false, true]) {
      const s = presetToSettings({ ...defaultSettings("territory"), unlimited, ...typed });
      expect([unlimited, s.unlimited]).toEqual([unlimited, unlimited]);
      expect(s).toMatchObject(typed); // (the page keeps the typed values)
      expect(territorySettingsOf(s)).toMatchObject(lifted);
      const engine = createEngineForSettings(physicsConfigOfSettings(s), "territory", modeSettingsOfSettings(s), 3);
      expect(engine.getTerritorySettings()).toMatchObject(lifted);
      expect(engine.getTerritoryView().cols).toBe(64);
      expect(engine.getBalls()).toHaveLength(4 * 12);
      for (let i = 0; i < 120; i++) engine.update(STEP, 0);
      expect(accounted(engine).ok).toBe(true);
      expect(fixedRunDurationSec("territory", modeSettingsOfSettings(s))).toBe(300);
    }
    // Far past: the memory-safety ceilings run (the page and the link keep the typed values, the panel says ARENA FULL).
    const far = presetToSettings({ ...defaultSettings("territory"), tyCols: 1e9, tyBallsPerTeam: 1e9, tyTeams: 1e9, tyRadius: 1e9, tyDuration: 1e9, tyPowerEvery: 1e9 });
    expect([far.tyCols, far.tyBallsPerTeam, far.tyTeams, far.tyRadius]).toEqual([1e9, 1e9, 1e9, 1e9]);
    expect(pastAnyMemoryCeiling(far)).toBe(true);
    expect(territorySettingsOf(far)).toMatchObject({ cols: MEMORY_CEILINGS.tyCols, ballsPerTeam: MEMORY_CEILINGS.tyBallsPerTeam, teams: 4, radius: 1e9, duration: 1e9, powerEvery: 1e9 });
    expect(settingsFromSearchParams(settingsToSearchParams(far))).toMatchObject({ tyCols: 1e9, tyBallsPerTeam: 1e9, tyRadius: 1e9, tyDuration: 1e9 });
    expect(pastAnyMemoryCeiling(defaultSettings("territory"))).toBe(false);
  });

  it("takes a reach past the board in work bounded by the board: the whirl walks only its arms' part on it, the blast takes every tile", () => {
    // The part of the arms on the board: within it the whirl is the one it always was, past it the same points, fewer walked.
    const w = whirlReach(3, 24, 20, { reach: 0, span: 0, samples: 0 });
    expect(w).toEqual({ reach: 3, span: 1, samples: 3 * TY_WHIRL_SAMPLES_PER_TILE });
    for (const p of [0, 0.25, 0.5, 1]) expect(whirlSwept(p, w.samples, 1)).toBe(Math.round(p * w.samples));
    const diagonal = Math.hypot(24, 20);
    const far = whirlReach(100, 24, 20, { reach: 0, span: 0, samples: 0 });
    expect(far.reach).toBeCloseTo(diagonal, 9);
    expect(far.span).toBeCloseTo(diagonal / 100, 9);
    expect(far.samples).toBe(Math.round(TY_WHIRL_SAMPLES_PER_TILE * diagonal));
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    for (const k of [1, far.samples / 4, far.samples / 2, far.samples]) {
      whirlPoint(k, far.samples, 1, 0.3, -1, far.reach * 10, a, far.span);
      const whole = 100 * TY_WHIRL_SAMPLES_PER_TILE;
      whirlPoint((k / far.samples) * far.span * whole, whole, 1, 0.3, -1, 100 * 10, b);
      expect([a.x, a.y].map((n) => Math.round(n * 1e6))).toEqual([b.x, b.y].map((n) => Math.round(n * 1e6)));
    }
    expect(whirlSwept(far.span / 2, far.samples, far.span)).toBe(Math.round(far.samples / 2));
    expect(whirlSwept(far.span, far.samples, far.span)).toBe(far.samples);
    // Any finite reach: a finite number of samples, no more than the board's diagonal holds.
    for (const radius of [1e9, 1e300, Number.MAX_VALUE]) {
      const r = whirlReach(radius, 24, 20, { reach: 0, span: 0, samples: 0 });
      expect([radius, Number.isFinite(r.span) && r.span > 0, r.samples]).toEqual([radius, true, far.samples]);
    }
    // In the engine: vortices and bombers reaching far past the board paint it fast, every tile accounted for.
    for (const radius of [1e9, Number.MAX_VALUE]) {
      const engine = territory({ radius, powerEvery: 1, powers: ["vortex", "bomber", "vortex", "bomber"] }, 5);
      const started = Date.now();
      for (let i = 0; i < 4 * 60; i++) engine.update(STEP, 0);
      expect(Date.now() - started).toBeLessThan(5000);
      const v = engine.getTerritoryView();
      expect([radius, v.blasts > 0, v.whirls > 0, accounted(engine).ok]).toEqual([radius, true, true, true]);
      for (const ball of engine.getBalls()) expect([ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite)).toBe(true);
    }
  });

  it("lets the AI assistant tune its settings", () => {
    const keys = assistantSettings({ ...defaultSettings("territory"), mode: "territory" }).map(([k]) => k);
    for (const key of ["tyCols", "tyTeams", "tyBallsPerTeam", "tyPowers", "tyPowerEvery", "tyRadius", "tyDuration", "tyPegs", "tyBadge", "tyHud"]) expect(keys, key).toContain(key);
    const current = { ...defaultSettings("territory"), mode: "territory" as const };
    expect(validateSettingsPatch(current, { tyTeams: 4, tyPowers: "ghost,bomber,none,vortex" }).ok).toBe(true);
    expect(validateSettingsPatch(current, { tyPowers: "laser" }).ok).toBe(false);
  });
});
