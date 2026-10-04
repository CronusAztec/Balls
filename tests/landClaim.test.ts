import { describe, expect, it } from "vitest";
import {
  DEFAULT_LAND_CLAIM_SETTINGS,
  LAND_CLAIM_RANGES,
  LC_BALL_CEILING,
  LC_BLOCK_CEILING,
  LC_CLOSE,
  LC_COL_CEILING,
  LC_DOMINATION,
  LC_FLY_LOG,
  LC_LADDER,
  LC_PALETTE,
  LC_PRESET_IDS,
  LC_ROW_CEILING,
  LC_TEAM_CEILING,
  blockCentre,
  blockCorners,
  columnAt,
  defaultLandClaimFields,
  knockFrequency,
  landClaimBallRadius,
  landClaimClipSec,
  landClaimField,
  landClaimForcedWinner,
  landClaimModeDefaults,
  landClaimPresetPatch,
  landClaimSettingFields,
  landClaimSettingsOf,
  landClaimVerdict,
  lcPaletteColor,
  lcPaletteName,
  readLandClaimParams,
  resolveLandClaimFields,
  resolveLandClaimSettings,
  sanitizeLcTitle,
  sideColumns,
  spawnFrequency,
  writeLandClaimParams,
  type LandClaimSettings,
} from "@/lib/physics/modes/landClaim";
import { COUNTRIES, countryByCode, countryOfFlag, countryTeamEntry, flagCodeOf, flagOf } from "@/lib/countries";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { BATTLE_WINNER_MODES, forcedWinnerApplies } from "@/lib/physics/rigged";
import { MAX_TEAMS } from "@/lib/physics/ballStats";
import { RANGES, defaultSettings, pastAnyMemoryCeiling, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, fixedRunDurationSec, simulateOutcomeRun, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { CLOSE_BATTLE_MARGIN, availableOutcomes, outcomeFigure, outcomeMatches, outcomeMiss, type RunSummary } from "@/lib/simulation/outcomes";
import { MAX_TEAM_NAME_LENGTH, effectiveBallCount, rosterPatch, teamResult } from "@/lib/teams";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { midiToFrequency } from "@/lib/audio/scales";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { CAPTION_WINNER_TOKEN, captionAnswerText } from "@/lib/captions";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * Land Claim (lib/physics/modes/landClaim.ts, feature land-claim): the settings (resolve, URL, presets), the arena (the
 * column layouts of the square, the hexagon and the circle, the blocks), the knock rule and its top-block order, the
 * eighth-block spawns, claim and steal, the verdicts, the rig, exact replays at several frame rates, sizes past every
 * slider, the finder's outcomes, the country list and the messages.
 */

const config: PhysicsConfig = {
  width: 800,
  height: 800,
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

function landClaim(settings: Partial<LandClaimSettings> = {}, seed = 42, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "landClaim", { ...modeSettings, landClaim: settings }, seed);
}

/** Steps `engine` until its battle is over (or `maxSec` passed); the sound events of the run. */
function runToEnd(engine: PhysicsEngine, maxSec = 120): SoundEvent[] {
  const events: SoundEvent[] = [];
  for (let i = 0; i < (maxSec * 1000) / STEP && !engine.getLandClaimView().finished; i++) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
  }
  return events;
}

/** The owner array recounted per competitor. */
function recount(engine: PhysicsEngine): number[] {
  const v = engine.getLandClaimView();
  const out = new Array(v.teams).fill(0);
  for (let i = 0; i < v.total; i++) if (v.owner[i] >= 0) out[v.owner[i]]++;
  return out;
}

/** Whether every ball's disc is inside the arena's wall. */
function allInside(engine: PhysicsEngine, slack = 0.5): boolean {
  const f = engine.getLandClaimView().field;
  return engine.getBalls().every((b) => {
    const px = b.x - f.cx;
    const py = b.y - f.cy;
    if (f.sides > 0) {
      for (let k = 0; k < f.sides; k++) if (px * f.sideNx[k] + py * f.sideNy[k] + b.radius > f.apothem + slack) return false;
      return true;
    }
    return Math.hypot(px, py) + b.radius <= f.apothem + slack;
  });
}

/* ------------------------------------------------------------------ settings */

describe("Land Claim settings", () => {
  it("resolve: the defaults, the minimums, no maximum – only the memory-safety ceilings for what a run builds", () => {
    expect(resolveLandClaimSettings(undefined)).toEqual(DEFAULT_LAND_CLAIM_SETTINGS);
    expect(DEFAULT_LAND_CLAIM_SETTINGS).toMatchObject({ cols: 24, rows: 12, arena: "square", teams: 4, balls: 3, rule: "knock", every: 8, duration: 60, title: "", hud: true });
    const big = resolveLandClaimSettings({ cols: 500, rows: 300, teams: 50, balls: 30, every: 77, duration: 9999 });
    expect(big).toMatchObject({ cols: 500, rows: 300, teams: 50, balls: 30, every: 77, duration: 9999 });
    expect(resolveLandClaimSettings({ cols: 1, rows: 0, teams: 1, balls: 0, every: -3, duration: 2 })).toMatchObject({ cols: 4, rows: 1, teams: 2, balls: 1, every: 0, duration: 10 });
    expect(resolveLandClaimSettings({ cols: 1e9, rows: 1e9, teams: 1e9, balls: 1e9 })).toMatchObject({ cols: LC_COL_CEILING, rows: LC_ROW_CEILING, teams: LC_TEAM_CEILING, balls: LC_BALL_CEILING });
    expect([MEMORY_CEILINGS.lcCols, MEMORY_CEILINGS.lcRows, MEMORY_CEILINGS.lcTeams, MEMORY_CEILINGS.lcBalls]).toEqual([LC_COL_CEILING, LC_ROW_CEILING, LC_TEAM_CEILING, LC_BALL_CEILING]);
    expect(resolveLandClaimSettings({ cols: Number.NaN, rows: Infinity, arena: "octagon" as never, rule: "paint" as never, hud: 1 as never })).toMatchObject({ cols: 24, rows: 12, arena: "square", rule: "knock", hud: true });
    expect(resolveLandClaimSettings({ cols: 30.6, duration: 12.4 })).toMatchObject({ cols: 31, duration: 12 });
    expect(sanitizeLcTitle(`  who\nwill   claim${String.fromCharCode(0x2028)} the most?? `)).toBe("who will claim the most?? ");
    expect(Array.from(sanitizeLcTitle("x".repeat(100)))).toHaveLength(40);
    expect(sanitizeLcTitle(42)).toBe("");
    expect(landClaimSettingsOf(landClaimSettingFields(DEFAULT_LAND_CLAIM_SETTINGS))).toEqual(DEFAULT_LAND_CLAIM_SETTINGS);
    for (const [key, range] of Object.entries(LAND_CLAIM_RANGES)) expect([key, RANGES[key as keyof typeof RANGES]]).toEqual([key, range]);
  });

  it("are the defaults in every mode, give Land Claim no gravity and a clip covering its verdict, and stay out of the URL", () => {
    const d = defaultSettings("landClaim");
    expect(landClaimSettingsOf(d)).toEqual(DEFAULT_LAND_CLAIM_SETTINGS);
    expect([d.gravity, d.recordingDuration]).toEqual([0, landClaimClipSec(60)]);
    expect(landClaimClipSec(60)).toBe(64);
    expect([landClaimClipSec(1), landClaimClipSec(600)]).toEqual([10, 604]);
    expect(landClaimModeDefaults("classic")).toEqual({});
    expect(defaultSettings("classic").gravity).not.toBe(0);
    expect(landClaimSettingsOf(defaultSettings("classic"))).toEqual(DEFAULT_LAND_CLAIM_SETTINGS);
    const query = settingsToSearchParams(d);
    for (const key of ["lcc", "lcr", "lca", "lct", "lcb", "lcm", "lce", "lcd", "lcti", "lch", "g", "dur"]) expect(query.has(key), key).toBe(false);
    expect(query.get("mode")).toBe("landClaim");
  });

  it("round-trip through the URL and presets, invalid values refused on the way in, values past the sliders kept", () => {
    const s = { ...defaultSettings("landClaim"), lcCols: 40, lcRows: 9, lcArena: "hexagon" as const, lcTeams: 7, lcBalls: 2, lcRule: "steal" as const, lcEvery: 5, lcDuration: 75, lcTitle: "WHO WINS?", lcHud: false };
    const query = settingsToSearchParams(s);
    expect(Object.fromEntries(["lcc", "lcr", "lca", "lct", "lcb", "lcm", "lce", "lcd", "lcti", "lch"].map((k) => [k, query.get(k)]))).toEqual({ lcc: "40", lcr: "9", lca: "hexagon", lct: "7", lcb: "2", lcm: "steal", lce: "5", lcd: "75", lcti: "WHO WINS?", lch: "0" });
    const back = settingsFromSearchParams(query);
    expect(landClaimSettingsOf(back)).toEqual(landClaimSettingsOf(s));
    expect(back.mode).toBe("landClaim");
    const wild = settingsFromSearchParams(new URLSearchParams("mode=landClaim&lcc=2&lcr=-4&lct=1&lcb=abc&lce=-1&lcd=3&lca=octagon&lcm=paint&lcti=%0Ahello%20%20world&lch=2"));
    expect([wild.lcCols, wild.lcRows, wild.lcTeams, wild.lcBalls, wild.lcEvery, wild.lcDuration, wild.lcArena, wild.lcRule, wild.lcTitle, wild.lcHud]).toEqual([4, 1, 2, 3, 0, 10, "square", "knock", "hello world", true]);
    const preset = presetToSettings({ mode: "landClaim", lcCols: "abc" as never, lcRule: "claim", lcArena: "circle", lcHud: "yes" as never, lcTitle: 7 as never } as never);
    expect(landClaimSettingsOf(preset)).toEqual({ ...DEFAULT_LAND_CLAIM_SETTINGS, rule: "claim", arena: "circle" });
    // Far past every slider: the page and the link keep the typed values, the run builds at the memory-safety ceilings.
    const far = presetToSettings({ ...defaultSettings("landClaim"), lcCols: 1e9, lcRows: 1e9, lcTeams: 1e9, lcBalls: 1e9, lcEvery: 1e9, lcDuration: 1e9 });
    expect([far.lcCols, far.lcRows, far.lcTeams, far.lcBalls, far.lcEvery, far.lcDuration]).toEqual([1e9, 1e9, 1e9, 1e9, 1e9, 1e9]);
    expect(pastAnyMemoryCeiling(far)).toBe(true);
    expect(landClaimSettingsOf(far)).toMatchObject({ cols: LC_COL_CEILING, rows: LC_ROW_CEILING, teams: LC_TEAM_CEILING, balls: LC_BALL_CEILING, every: 1e9, duration: 1e9 });
    expect(settingsFromSearchParams(settingsToSearchParams(far))).toMatchObject({ lcCols: 1e9, lcRows: 1e9, lcTeams: 1e9, lcDuration: 1e9 });
    expect(pastAnyMemoryCeiling(defaultSettings("landClaim"))).toBe(false);
    // The feature's own URL helpers: only what differs from the base is written, and reading validates.
    const params = new URLSearchParams();
    writeLandClaimParams(landClaimSettingFields({ ...DEFAULT_LAND_CLAIM_SETTINGS, cols: 30 }), defaultLandClaimFields(), params);
    expect(params.toString()).toBe("lcc=30");
    const fields = defaultLandClaimFields();
    readLandClaimParams(new URLSearchParams("lcc=31&lca=circle&lch=0"), fields);
    expect(fields).toMatchObject({ lcCols: 31, lcArena: "circle", lcHud: false });
    expect(resolveLandClaimFields({ lcTeams: 0.4, lcTitle: "a\tb" })).toMatchObject({ lcTeams: 2, lcTitle: "a b" });
  });

  it("ships the five presets: their walls, rules, rosters of countries and clips", () => {
    expect(LC_PRESET_IDS).toEqual(["countries4", "domination", "steal", "hexagon6", "claim2v2"]);
    const dom = landClaimPresetPatch("domination");
    expect(dom.lcCols! * dom.lcRows!).toBe(1144);
    expect(dom).toMatchObject({ lcRule: "knock", lcArena: "square", lcTeams: 4, lcBalls: 1, lcEvery: 8, ballRadius: 5 });
    expect(dom.teams.map((t) => flagCodeOf(t.emoji))).toEqual(["US", "UA", "IN", "BR"]);
    expect(dom.teams.map((t) => t.color)).toEqual(["US", "UA", "IN", "BR"].map((c) => countryByCode(c)!.colors[0]));
    expect(dom.recordingDuration).toBe(landClaimClipSec(dom.lcDuration!));
    expect(landClaimPresetPatch("countries4").teams.map((t) => t.name)).toEqual(["France", "Brazil", "Spain", "Colombia"]);
    expect(landClaimPresetPatch("steal")).toMatchObject({ lcRule: "steal", lcTeams: 4 });
    const hex = landClaimPresetPatch("hexagon6");
    expect([hex.lcArena, hex.lcTeams, hex.teams.length, hex.lcCols! % 6]).toEqual(["hexagon", 6, 6, 0]);
    const duo = landClaimPresetPatch("claim2v2");
    expect([duo.lcRule, duo.lcTeams, duo.lcBalls, duo.teams.length]).toEqual(["claim", 2, 2, 2]);
    // The names are the translated ones the panel passes; the roster fits the teams (six at most).
    expect(landClaimPresetPatch("countries4", (code) => `#${code}`).teams.map((t) => t.name)).toEqual(["#FR", "#BR", "#ES", "#CO"]);
    for (const id of LC_PRESET_IDS) {
      const patch = landClaimPresetPatch(id);
      expect([id, patch.teams.length]).toEqual([id, patch.lcTeams]);
      expect(patch.teams.length).toBeLessThanOrEqual(MAX_TEAMS);
      const { teams, ...rest } = patch;
      const s = presetToSettings({ ...defaultSettings("landClaim"), ...rest, ...rosterPatch(teams) });
      expect([id, s.teams.map((t) => t.emoji)]).toEqual([id, teams.map((t) => t.emoji)]);
      expect([id, effectiveBallCount(s)]).toEqual([id, Math.min(MAX_TEAMS, patch.lcTeams!)]);
    }
  });

  it("registers the mode: its id, its card after the Maze in the battle family, the rig and the team count", () => {
    expect(MODE_IDS).toContain("landClaim");
    expect(MODE_CATEGORIES.landClaim).toBe("battle");
    expect(MODE_CARD_ORDER.indexOf("landClaim")).toBe(MODE_CARD_ORDER.indexOf("maze") + 1);
    expect(modesInCategory("battle")).toContain("landClaim");
    expect(BATTLE_WINNER_MODES).toContain("landClaim");
    expect(forcedWinnerApplies("landClaim", 4, 3)).toBe(true);
    expect(forcedWinnerApplies("landClaim", 4, 4)).toBe(false);
    expect(effectiveBallCount({ ...defaultSettings("landClaim"), lcTeams: 12 })).toBe(MAX_TEAMS);
    expect(effectiveBallCount({ ...defaultSettings("landClaim"), lcTeams: 3 })).toBe(3);
  });
});

/* ------------------------------------------------------------------ the arena */

describe("the arena", () => {
  it("spreads the columns over the sides as evenly as can be", () => {
    for (const n of [4, 6]) {
      for (const cols of [4, 5, 10, 23, 24, 37, 52, 5000]) {
        const per = Array.from({ length: n }, (_, k) => sideColumns(cols, n, k));
        expect(per.reduce((a, b) => a + b, 0)).toBe(cols);
        expect(Math.max(...per) - Math.min(...per)).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lays out the square: six columns a side from the top-left corner, clockwise, tiling the wall under the HUD band", () => {
    const f = landClaimField(800, 800, "square", 24, 12);
    expect([f.sides, f.cols, f.rows]).toEqual([4, 24, 12]);
    expect(f.start).toBeCloseTo(-0.75 * Math.PI, 12);
    expect(Array.from(f.colSide)).toEqual([0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3]);
    expect([f.sideNx[0], f.sideNy[0]].map((x) => Math.round(x))).toEqual([0, -1]);
    expect([f.sideNx[1], f.sideNy[1]].map((x) => Math.round(x))).toEqual([1, 0]);
    expect(f.colA0[0]).toBeCloseTo(f.start, 12);
    for (let c = 0; c < f.cols; c++) {
      expect(f.colA1[c]).toBeGreaterThan(f.colA0[c]);
      if (c + 1 < f.cols) expect(f.colA1[c]).toBeCloseTo(f.colA0[c + 1], 9);
      const k = f.colSide[c];
      expect(f.colX0[c] * f.sideNx[k] + f.colY0[c] * f.sideNy[k]).toBeCloseTo(f.apothem, 9);
      expect(f.colX1[c] * f.sideNx[k] + f.colY1[c] * f.sideNy[k]).toBeCloseTo(f.apothem, 9);
      expect(columnAt(f, 0.5 * (f.colA0[c] + f.colA1[c]))).toBe(c);
      expect(columnAt(f, 0.5 * (f.colA0[c] + f.colA1[c]) + 2 * Math.PI)).toBe(c);
      expect(columnAt(f, 0.5 * (f.colA0[c] + f.colA1[c]) - 4 * Math.PI)).toBe(c);
    }
    expect(f.colA1[f.cols - 1]).toBeCloseTo(f.start + 2 * Math.PI, 9);
    // Inside the square the recorder exports, under its HUD band; the columns stand LC_DEPTH of the way to the centre.
    expect(f.cy - f.apothem).toBeGreaterThanOrEqual(f.hudTop + f.hudHeight - 1e-9);
    expect(f.cy + f.apothem).toBeLessThanOrEqual(f.sqTop + f.side + 1e-9);
    expect(f.block * f.rows).toBeCloseTo(f.depth, 9);
    // A wide canvas keeps the arena in its centred square.
    const wide = landClaimField(1600, 800, "square", 24, 12);
    expect([wide.side, wide.sqLeft, wide.cx]).toEqual([800, 400, 800]);
  });

  it("lays out the hexagon: flat top, six columns a side, fitted to the square", () => {
    const f = landClaimField(800, 800, "hexagon", 36, 12);
    expect(f.sides).toBe(6);
    expect([Math.round(f.sideNx[0] * 1e9) / 1e9, f.sideNy[0]]).toEqual([0, -1]);
    for (let k = 0; k < 6; k++) expect(Array.from(f.colSide).filter((s) => s === k)).toHaveLength(6);
    const rc = f.apothem / Math.cos(Math.PI / 6);
    expect(f.cx - rc).toBeGreaterThanOrEqual(f.sqLeft - 1e-9);
    expect(f.cx + rc).toBeLessThanOrEqual(f.sqLeft + f.side + 1e-9);
    expect(f.cy - f.apothem).toBeGreaterThanOrEqual(f.hudTop + f.hudHeight - 1e-9);
    for (let c = 0; c < f.cols; c++) {
      const k = f.colSide[c];
      expect(f.colX0[c] * f.sideNx[k] + f.colY0[c] * f.sideNy[k]).toBeCloseTo(f.apothem, 9);
      expect(columnAt(f, 0.5 * (f.colA0[c] + f.colA1[c]))).toBe(c);
    }
  });

  it("lays out the circle: equal wedges from the top, clockwise", () => {
    const f = landClaimField(800, 800, "circle", 40, 10);
    expect(f.sides).toBe(0);
    expect(f.start).toBeCloseTo(-Math.PI / 2, 12);
    for (let c = 0; c < f.cols; c++) {
      expect(f.colA1[c] - f.colA0[c]).toBeCloseTo((2 * Math.PI) / 40, 12);
      expect(Math.hypot(f.colX0[c], f.colY0[c])).toBeCloseTo(f.apothem, 9);
      expect(columnAt(f, f.colA0[c] + 1e-6)).toBe(c);
    }
  });

  it("places every block as a slice of its column, row 0 at the wall, and sizes the balls by the square", () => {
    for (const arena of ["square", "hexagon", "circle"] as const) {
      const f = landClaimField(900, 700, arena, 20, 8);
      const q = new Float64Array(8);
      const m = { x: 0, y: 0 };
      for (const c of [0, 7, 19]) {
        blockCorners(f, c, 0, q);
        expect([q[0], q[1], q[2], q[3]].map((v) => Math.round(v * 1e6))).toEqual([f.colX0[c], f.colY0[c], f.colX1[c], f.colY1[c]].map((v) => Math.round(v * 1e6)));
        for (const row of [0, 3, 7]) {
          blockCorners(f, c, row, q);
          const inner = Math.hypot(0.5 * (q[4] + q[6]), 0.5 * (q[5] + q[7]));
          const outer = Math.hypot(0.5 * (q[0] + q[2]), 0.5 * (q[1] + q[3]));
          expect(outer).toBeGreaterThan(inner);
          blockCentre(f, c, row, m);
          expect([arena, c, row, columnAt(f, Math.atan2(m.y, m.x))]).toEqual([arena, c, row, c]);
        }
      }
    }
    expect(landClaimBallRadius(8, 1000)).toBeCloseTo(22, 9);
    expect(landClaimBallRadius(800, 1000)).toBeCloseTo(2200, 9); // (no maximum: the Ball Size however big)
  });

  it("pitches the knocks round the wall on the pentatonic ladder and the spawn chimes by competitor", () => {
    expect(knockFrequency(0, 24)).toBeCloseTo(midiToFrequency(LC_LADDER[0]), 9);
    expect(knockFrequency(23, 24)).toBeCloseTo(midiToFrequency(LC_LADDER[LC_LADDER.length - 1]), 9);
    expect(knockFrequency(12, 24)).toBeGreaterThan(knockFrequency(0, 24));
    expect(spawnFrequency(1)).toBeCloseTo(midiToFrequency(LC_LADDER[1] + 12), 9);
    expect(spawnFrequency(6)).toBeCloseTo(spawnFrequency(1), 9);
  });

  it("names and colours the competitors past the roster from the palette, golden-angle hues past it", () => {
    expect(lcPaletteName(0)).toBe("RED");
    expect(lcPaletteColor(1)).toBe(LC_PALETTE[1].color);
    expect(lcPaletteName(LC_PALETTE.length)).toBe("");
    const extra = new Set(Array.from({ length: 50 }, (_, i) => lcPaletteColor(LC_PALETTE.length + i)));
    expect(extra.size).toBe(50);
    for (const c of extra) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

/* ------------------------------------------------------------------ the engine */

describe("Land Claim in the engine", () => {
  it("starts every competitor's balls in the free middle at the cruising speed", () => {
    const engine = landClaim({ teams: 5, balls: 3 });
    const v = engine.getLandClaimView();
    const balls = engine.getBalls();
    expect(balls).toHaveLength(15);
    expect(Array.from(v.alive)).toEqual([3, 3, 3, 3, 3]);
    const f = v.field;
    const speed = 0.5 * f.side;
    for (const b of balls) {
      expect(Math.hypot(b.x - f.cx, b.y - f.cy) + b.radius).toBeLessThan(f.apothem - f.depth);
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(speed, 6);
      expect(b.radius).toBeCloseTo(landClaimBallRadius(8, f.side), 9);
    }
    expect([v.total, v.remaining, v.maxHeight, v.finished]).toEqual([288, 288, 12, false]);
  });

  it("knocks the top block of a column off for the hitter: the rows of every column go from the top down, the land adds up", () => {
    const engine = landClaim({}, 3);
    const v = engine.getLandClaimView();
    const knocked: number[][] = Array.from({ length: v.cols }, () => []);
    let head = 0;
    let seen = 0;
    for (let i = 0; i < 900 && !v.finished; i++) {
      const before = Array.from(v.heights);
      engine.update(STEP, 0);
      engine.consumeSoundEvents();
      const added = v.knocks - seen;
      expect(added).toBeLessThanOrEqual(LC_FLY_LOG);
      for (let n = 0; n < added; n++) {
        const k = (head + n) % LC_FLY_LOG;
        knocked[v.flyCol[k]].push(v.flyRow[k]);
        expect(v.flyTeam[k]).toBeGreaterThanOrEqual(0);
      }
      head = (head + added) % LC_FLY_LOG;
      seen = v.knocks;
      for (let c = 0; c < v.cols; c++) expect(v.heights[c]).toBeLessThanOrEqual(before[c]);
      expect(v.maxHeight).toBe(Math.max(...Array.from(v.heights)));
    }
    expect(v.knocks).toBeGreaterThan(100);
    for (let c = 0; c < v.cols; c++) {
      expect(knocked[c]).toEqual(Array.from({ length: knocked[c].length }, (_, i) => v.rows - 1 - i));
      expect(v.heights[c]).toBe(v.rows - knocked[c].length);
    }
    const land = Array.from(v.land);
    expect(land.reduce((a, b) => a + b, 0)).toBe(v.knocks);
    expect(v.remaining).toBe(v.total - v.knocks);
    expect(v.owner).toHaveLength(0);
    expect(allInside(engine)).toBe(true);
  });

  it("adds one more ball of the hitter's colour every eighth block it takes (none with the spawns off)", () => {
    const engine = landClaim({ every: 8 }, 11);
    runToEnd(engine, 30);
    const v = engine.getLandClaimView();
    expect(v.finished).toBe(true);
    expect(v.spawns).toBeGreaterThan(0);
    for (let t = 0; t < v.teams; t++) {
      expect(v.spawned[t]).toBe(Math.floor(v.gains[t] / 8));
      expect(v.alive[t]).toBe(3 + v.spawned[t]);
      expect(engine.getBalls().filter((b) => b.team === t)).toHaveLength(v.alive[t]);
    }
    expect(v.spawns).toBe(Array.from(v.spawned).reduce((a, b) => a + b, 0));
    const off = landClaim({ every: 0 }, 11);
    runToEnd(off, 30);
    expect([off.getLandClaimView().spawns, off.getBalls().length]).toEqual([0, 12]);
    // Every 3rd block: more balls, and the run still adds up.
    const often = landClaim({ every: 3 }, 11);
    runToEnd(often, 30);
    const o = often.getLandClaimView();
    for (let t = 0; t < o.teams; t++) expect(o.spawned[t] + o.spawnsRefused * 0).toBe(Math.floor(o.gains[t] / 3));
  });

  it("refuses a spawn past the ball ceiling with ARENA FULL – the knock still counts", () => {
    const engine = landClaim({ teams: 2, balls: LC_BALL_CEILING / 2, every: 1, cols: 60, rows: 4 }, 5, { ...config, ballRadius: 0.5 });
    expect(engine.getBalls()).toHaveLength(LC_BALL_CEILING);
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    const v = engine.getLandClaimView();
    expect(v.knocks).toBeGreaterThan(0);
    expect(v.spawns).toBe(0);
    expect(v.spawnsRefused).toBe(v.knocks);
    expect(engine.getBalls().length).toBe(LC_BALL_CEILING);
  });

  it("claims the blocks where they stand: from the top of a column down, recoloured, until every block has an owner", () => {
    const engine = landClaim({ rule: "claim", arena: "hexagon", cols: 18, rows: 6 }, 9);
    const v = engine.getLandClaimView();
    for (let i = 0; i < 200; i++) engine.update(STEP, 0);
    for (let c = 0; c < v.cols; c++) {
      for (let r = 0; r < v.rows; r++) expect(v.owner[c * v.rows + r] >= 0).toBe(r >= v.claimTop[c]);
      expect(v.heights[c]).toBe(v.rows); // (the wall's shape never changes)
    }
    expect(recount(engine)).toEqual(Array.from(v.land));
    runToEnd(engine, 90);
    expect(v.finished).toBe(true);
    expect([v.remaining, Array.from(v.claimTop).every((n) => n === 0)]).toEqual([0, true]);
    expect(recount(engine).reduce((a, b) => a + b, 0)).toBe(v.total);
    expect(v.flyCount).toBe(0);
    expect(v.popCount).toBeGreaterThan(0);
  });

  it("steals: a hit flips the top block that is not the hitter's – both ways – and the battle runs to its duration", () => {
    const engine = landClaim({ rule: "steal", cols: 16, rows: 4, teams: 3, balls: 2, duration: 20 }, 4);
    const v = engine.getLandClaimView();
    runToEnd(engine, 25);
    expect(v.finished).toBe(true);
    expect(v.finishedMs).toBeGreaterThanOrEqual(20000 - STEP);
    expect(v.finishedMs).toBeLessThan(20000 + STEP);
    expect(v.steals).toBeGreaterThan(20);
    expect(recount(engine)).toEqual(Array.from(v.land));
    const stolen = Array.from(v.stolen);
    const lost = Array.from(v.lost);
    expect(stolen.reduce((a, b) => a + b, 0)).toBe(v.steals);
    expect(lost.reduce((a, b) => a + b, 0)).toBe(v.steals);
    expect(stolen.filter((n) => n > 0).length).toBeGreaterThanOrEqual(2);
    expect(lost.filter((n) => n > 0).length).toBeGreaterThanOrEqual(2);
    const steal: ModeSettings = { ...modeSettings, landClaim: { rule: "steal", duration: 20 } };
    const knock: ModeSettings = { ...modeSettings, landClaim: { rule: "knock" } };
    expect(fixedRunDurationSec("landClaim", steal)).toBe(20);
    expect(fixedRunDurationSec("landClaim", knock)).toBeNull();
  });

  it("ends a knock battle when the wall is bare: the verdict, the team stats it credits and the sounds", () => {
    const engine = landClaim({}, 21);
    const events = runToEnd(engine, 60);
    const v = engine.getLandClaimView();
    expect([v.finished, v.remaining, v.kos]).toEqual([true, 0, v.cols]);
    expect(engine.isSimulationFinished()).toBe(true);
    const verdict = landClaimVerdict(v.land, v.teams, -1, v.alive);
    expect(v.verdict).toEqual(verdict);
    const stats = engine.getTeamStats();
    for (let t = 0; t < v.teams; t++) expect(stats[t].walls).toBe(v.land[t]);
    expect(teamResult(stats, v.teams).winner).toBe(v.verdict.winner);
    const kinds = new Set(events.map((e) => e.lcSound));
    expect([kinds.has("knock"), kinds.has("spawn"), kinds.has("ko")]).toEqual([true, true, true]);
    const knock = events.find((e) => e.lcSound === "knock")!;
    expect(LC_LADDER.map((n) => Math.round(midiToFrequency(n) * 1000))).toContain(Math.round(knock.frequency! * 1000));
    expect(events[events.length - 1]).toMatchObject({ lcSound: "ko", accent: true });
    expect(events.every((e) => e.melody === false)).toBe(true);
    // Done: no more knocks, the verdict stays.
    const knocks = v.knocks;
    for (let i = 0; i < 60; i++) engine.update(STEP, 0);
    expect([v.knocks, v.verdict.winner]).toEqual([knocks, verdict.winner]);
  });

  it("replays a seed exactly – the same battle at 30, 60 and 120 frames a second (a pinned fingerprint)", () => {
    function fnv(bytes: Uint8Array, h = 0x811c9dc5) {
      for (let i = 0; i < bytes.length; i++) {
        h ^= bytes[i];
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      return h;
    }
    function fingerprint(patch: Partial<SimulatorSettings>, frameMs: number) {
      const s = { ...defaultSettings("landClaim"), ...patch } as SimulatorSettings;
      const engine = createEngineForSettings(physicsConfigOfSettings(s, { width: 800, height: 800 }), "landClaim", modeSettingsOfSettings(s), 7);
      let sounds = 0;
      for (let i = 0; i < Math.round(6000 / frameMs); i++) {
        engine.update(frameMs, 0);
        sounds += engine.consumeSoundEvents().length;
      }
      const v = engine.getLandClaimView();
      const state = new Float64Array(engine.getBalls().flatMap((b) => [b.id, b.x, b.y, b.vx, b.vy, b.radius]));
      return {
        heights: fnv(new Uint8Array(v.heights.buffer.slice(0))),
        owner: fnv(new Uint8Array(v.owner.buffer.slice(0))),
        balls: fnv(new Uint8Array(state.buffer)),
        land: Array.from(v.land).join(","),
        events: [v.knocks, v.spawns, v.steals, v.kos, v.bounces, v.collisions, v.notes, sounds].join(","),
      };
    }
    const pinned: [Partial<SimulatorSettings>, ReturnType<typeof fingerprint>][] = [
      [{}, { heights: 3222018428, owner: 2166136261, balls: 3598726400, land: "42,33,33,45", events: "153,18,0,0,153,298,84,84" }],
      [{ lcRule: "claim", lcArena: "hexagon" }, { heights: 3465200709, owner: 4068764354, balls: 4264808736, land: "64,79,60,54", events: "257,30,0,14,279,860,113,113" }],
      [{ lcRule: "steal", lcArena: "circle", lcDuration: 10 }, { heights: 3465200709, owner: 3868339448, balls: 4030453588, land: "65,37,30,30", events: "386,19,224,3,397,1270,110,110" }],
    ];
    for (const [patch, expected] of pinned) {
      expect(fingerprint(patch, 1000 / 60)).toEqual(expected);
      expect(fingerprint(patch, 1000 / 30)).toEqual(expected);
      expect(fingerprint(patch, 1000 / 120)).toEqual(expected);
    }
  });

  it("follows a resize: the arena stays in the centred square and every ball inside its wall", () => {
    const engine = landClaim({ arena: "hexagon" }, 8);
    for (let i = 0; i < 90; i++) engine.update(STEP, 0);
    engine.setConfig({ width: 1280, height: 720 });
    for (let i = 0; i < 30; i++) engine.update(STEP, 0);
    const f = engine.getLandClaimView().field;
    expect([f.width, f.height, f.side]).toEqual([1280, 720, 720]);
    expect(allInside(engine, 1)).toBe(true);
  });

  it("takes sizes past every slider: a wall of thousands of blocks, dozens of competitors, the ceilings for what a run builds", () => {
    const big = landClaim({ cols: 400, rows: 40, teams: 30, balls: 2, every: 4 }, 2);
    const v = big.getLandClaimView();
    expect([v.cols, v.rows, v.total, v.teams, big.getBalls().length]).toEqual([400, 40, 16000, 30, 60]);
    for (let i = 0; i < 240; i++) big.update(STEP, 0);
    expect(v.knocks).toBeGreaterThan(0);
    expect(big.getBalls().every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))).toBe(true);
    expect(allInside(big)).toBe(true);
    // Past the ceilings: the columns, the rows (a million blocks at most), the competitors and the balls stop there.
    const huge = landClaim({ cols: 1e9, rows: 1e9, teams: 1e9, balls: 1e9 }, 2);
    const h = huge.getLandClaimView();
    expect([h.cols, h.rows, h.teams]).toEqual([LC_COL_CEILING, Math.floor(LC_BLOCK_CEILING / LC_COL_CEILING), LC_TEAM_CEILING]);
    expect(h.total).toBeLessThanOrEqual(LC_BLOCK_CEILING);
    expect(huge.getBalls().length).toBeLessThanOrEqual(LC_BALL_CEILING);
    huge.update(STEP, 0);
    expect(huge.getBalls().every((b) => Number.isFinite(b.x))).toBe(true);
    // A ball as wide as the free middle eats the arena (the outgrow finish): no verdict.
    const eaten = landClaim({}, 2, { ...config, ballRadius: 1e6 });
    eaten.update(STEP, 0);
    expect([eaten.getLandClaimView().ate || eaten.getMultiplierView().outgrown, eaten.isSimulationFinished(), eaten.getLandClaimView().verdict.winner]).toEqual([true, true, -1]);
  });
});

/* ------------------------------------------------------------------ the verdict and the rig */

describe("the verdict", () => {
  it("crowns the most land: DOMINATION past 60 %, SUCH A CLOSE BATTLE within 5 %, else a plain win", () => {
    expect(landClaimVerdict([70, 20, 10], 3)).toMatchObject({ winner: 0, second: 1, kind: "domination", share: 0.7, tie: false });
    expect(LC_DOMINATION).toBe(0.6);
    expect(landClaimVerdict([60, 40], 2)).toMatchObject({ winner: 0, kind: "plain" }); // (exactly 60 % is no domination)
    expect(landClaimVerdict([34, 32, 34], 3).kind).toBe("close");
    expect(landClaimVerdict([35, 30, 35], 3)).toMatchObject({ winner: 0, kind: "close", margin: 0, tie: true });
    expect(landClaimVerdict([40, 35, 25], 3)).toMatchObject({ winner: 0, kind: "close", margin: 0.05 });
    expect(landClaimVerdict([50, 30, 20], 3)).toMatchObject({ winner: 0, kind: "plain", margin: 0.2 });
    expect(LC_CLOSE).toBe(0.05);
    // A level top: the rig's pick, else the one with more balls, else the earlier slot.
    expect(landClaimVerdict([30, 30, 40, 40], 4, 3).winner).toBe(3);
    expect(landClaimVerdict([40, 40, 20], 3, -1, [2, 5, 9]).winner).toBe(1);
    expect(landClaimVerdict([40, 40, 20], 3, -1, [5, 5, 9]).winner).toBe(0);
    expect(landClaimVerdict([0, 0, 0], 3)).toMatchObject({ winner: -1, kind: "plain", share: 0 });
  });

  it("rigs one of the first six competitors at most", () => {
    expect(landClaimForcedWinner(2, 4)).toBe(2);
    expect(landClaimForcedWinner(4, 4)).toBe(-1);
    expect(landClaimForcedWinner(5, 12)).toBe(5);
    expect(landClaimForcedWinner(6, 12)).toBe(-1);
    expect(landClaimForcedWinner(undefined, 4)).toBe(-1);
    expect(landClaimForcedWinner(1.5, 4)).toBe(-1);
  });

  it("makes the forced winner the favourite by aiming its balls' rebounds at land still to take – honestly", () => {
    let natural = 0;
    let rigged = 0;
    for (let seed = 1; seed <= 14; seed++) {
      const a = landClaim({}, seed);
      runToEnd(a, 30);
      const b = landClaim({}, seed, { ...config, forcedWinner: 2 });
      runToEnd(b, 30);
      const va = a.getLandClaimView();
      const vb = b.getLandClaimView();
      if (va.verdict.winner === 2) natural++;
      if (vb.verdict.winner === 2) rigged++;
      expect(va.steers).toBe(0);
      expect(vb.steers).toBeGreaterThan(0);
      expect(vb.forcedWinner).toBe(2);
      // Honest: every block still comes off a column by a hit – the land adds up, nobody loses any.
      expect(Array.from(vb.land).reduce((x, y) => x + y, 0)).toBe(vb.knocks);
      expect(Array.from(vb.spawned)).toEqual(Array.from(vb.gains, (g) => Math.floor(g / 8)));
    }
    expect(rigged).toBeGreaterThan(natural + 2);
  });
});

/* ------------------------------------------------------------------ Find Simulation */

describe("Find Simulation", () => {
  const request = (patch: Partial<FinderRequest> = {}): FinderRequest => ({
    targetDurationSec: 15,
    toleranceSec: 0.5,
    maxSeeds: 10,
    maxSimTimeSec: 30,
    physicsConfig: config,
    mode: "landClaim",
    modeSettings: { ...modeSettings, landClaim: {} },
    ...patch,
  });

  it("offers the run length, a winner and a close battle", () => {
    expect(availableOutcomes("landClaim", { endless: false, neverEscape: false, ballCount: 4 })).toEqual(["duration", "winner", "close"]);
    expect(availableOutcomes("classic", { endless: false, neverEscape: false, ballCount: 4 })).not.toContain("close");
  });

  it("judges a close battle on the verdict's gap between the top two", () => {
    const run = (margin: number | undefined, finished = true): RunSummary => ({ mode: "landClaim", durationMs: 12000, finished, firstEscapeMs: -1, teams: [], ...(margin === undefined ? {} : { margin }) });
    const close = { kind: "close" as const, clipSec: 30 };
    expect(CLOSE_BATTLE_MARGIN).toBe(LC_CLOSE);
    expect(outcomeMatches(close, run(0.03))).toBe(true);
    expect(outcomeMatches(close, run(0.05))).toBe(true);
    expect(outcomeMatches(close, run(0.2))).toBe(false);
    expect(outcomeMatches(close, run(0.01, false))).toBe(false);
    expect(outcomeMatches(close, run(undefined))).toBe(false);
    expect(outcomeMiss(close, run(0.2))).toBeCloseTo(0.15, 12);
    expect(outcomeFigure(close, run(0.2))).toBeCloseTo(20, 12);
    expect(outcomeFigure(close, run(0.2, false))).toBe(100);
  });

  it("follows every battle to its verdict: the winner of the first six competitors and the gap a close battle is judged on", () => {
    for (const seed of [1, 2, 3, 4]) {
      const run = simulateOutcomeRun(seed, request(), { kind: "close", clipSec: 15 });
      expect(run.finished).toBe(true);
      const engine = landClaim({}, seed);
      runToEnd(engine, 30);
      const v = engine.getLandClaimView();
      expect(run.margin).toBeCloseTo(v.verdict.margin, 12);
      expect(outcomeMatches({ kind: "close", clipSec: 15 }, run)).toBe(v.verdict.margin <= LC_CLOSE + 1e-9);
      const winner = simulateOutcomeRun(seed, request(), { kind: "winner", team: v.verdict.winner, clipSec: 15 });
      expect(winner.teams).toHaveLength(4);
      expect(outcomeMatches({ kind: "winner", team: v.verdict.winner, clipSec: 15 }, winner)).toBe(true);
    }
    // A battle of a dozen: the first six are teams.
    const many = simulateOutcomeRun(1, request({ modeSettings: { ...modeSettings, landClaim: { teams: 12, balls: 1 } } }), { kind: "winner", team: 0, clipSec: 15 });
    expect(many.teams).toHaveLength(MAX_TEAMS);
  });
});

/* ------------------------------------------------------------------ countries, captions and messages */

type Messages = Record<string, Record<string, unknown>>;
const LOCALES: [string, Messages][] = [
  ["en", en as unknown as Messages],
  ["pl", pl as unknown as Messages],
  ["es", es as unknown as Messages],
];

describe("countries", () => {
  it("lists about forty countries: unique codes, names and flags, two valid colours each", () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.name)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map((c) => c.flag)).size).toBe(COUNTRIES.length);
    for (const c of COUNTRIES) {
      expect(c.code).toMatch(/^[A-Z]{2}$/);
      expect(c.flag).toBe(flagOf(c.code));
      expect(Array.from(c.flag)).toHaveLength(2);
      expect(flagCodeOf(c.flag)).toBe(c.code);
      expect(c.colors).toHaveLength(2);
      for (const color of c.colors) expect([c.code, color]).toEqual([c.code, expect.stringMatching(/^#[0-9a-f]{6}$/)]);
      expect(c.colors[0]).not.toBe(c.colors[1]);
      expect(countryByCode(c.code.toLowerCase())).toBe(c);
      expect(countryOfFlag(c.flag)).toBe(c);
    }
    expect(flagOf("F")).toBe("");
    expect(flagOf("F1")).toBe("");
    expect(flagCodeOf("🙂")).toBe("");
    expect(flagCodeOf("FR")).toBe("");
    expect(countryByCode("XX")).toBeNull();
    expect(countryTeamEntry(countryByCode("BR")!, "Brasil")).toEqual({ name: "Brasil", emoji: "🇧🇷", color: "#009c3b" });
  });

  it("names every country in every language, short enough for a team name", () => {
    for (const [lang, m] of LOCALES) {
      const names = m.Countries as Record<string, string>;
      expect([lang, Object.keys(names).sort()]).toEqual([lang, COUNTRIES.map((c) => c.code).sort()]);
      for (const c of COUNTRIES) {
        expect([lang, c.code, names[c.code].length > 0]).toEqual([lang, c.code, true]);
        expect([lang, c.code, Array.from(names[c.code]).length <= MAX_TEAM_NAME_LENGTH]).toEqual([lang, c.code, true]);
      }
    }
    const english = (en as unknown as Messages).Countries as Record<string, string>;
    for (const c of COUNTRIES) expect(english[c.code]).toBe(c.name);
  });
});

describe("captions and messages", () => {
  it("answers a question with the winner", () => {
    expect(CAPTION_WINNER_TOKEN).toBe("[winner]");
    expect(captionAnswerText("[winner]", "Brazil")).toBe("Brazil");
    expect(captionAnswerText("[WINNER]!", "Brazil")).toBe("Brazil!");
    expect(captionAnswerText("[winner]", "")).toBe("?");
    expect(captionAnswerText("Yes!", "Brazil")).toBe("Yes!");
    expect(captionAnswerText("$& [winner]", "A$&B")).toBe("$& A$&B");
  });

  it("has the same Land Claim messages in every language, and no account's name in them", () => {
    // (the inspiring account is named in the README's research note only – spelt out here, it would be named in the tests)
    const ACCOUNT = ["weapon", "ball", "arena"].join("");
    const keys = (m: Messages, ns: string, prefix = "") => Object.keys(m[ns]).filter((k) => k.startsWith(prefix)).sort();
    const [, base] = LOCALES[0];
    for (const [lang, m] of LOCALES) {
      expect([lang, keys(m, "LandClaim")]).toEqual([lang, keys(base, "LandClaim")]);
      expect([lang, keys(m, "Controls", "lc")]).toEqual([lang, keys(base, "Controls", "lc")]);
      const modes = m.Modes as Record<string, { name: string; description: string }>;
      expect(modes.landClaim.name.length).toBeGreaterThan(3);
      expect(modes.landClaim.description.length).toBeGreaterThan(40);
      expect((m.Editorial as Record<string, string>).modeLandClaim.length).toBeGreaterThan(200);
      expect((m.Controls as Record<string, string>).modeLandClaim).toBe(modes.landClaim.name);
      for (const ns of ["LandClaim", "Countries"]) expect(JSON.stringify(m[ns]).toLowerCase()).not.toContain(ACCOUNT);
      expect(JSON.stringify(m.Controls).toLowerCase()).not.toContain(ACCOUNT);
      expect((m.Editorial as Record<string, string>).modeLandClaim.toLowerCase()).not.toContain(ACCOUNT);
      for (const key of ["outcomeClose", "hintClose", "findClose", "foundClose", "missClose", "progressClose", "overlayClose", "hintWinnerLandClaim", "noteFavoured"]) expect([lang, key, typeof (m.Rigged as Record<string, string>)[key]]).toEqual([lang, key, "string"]);
    }
  });
});
