import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { BallStatsBook, MAX_TEAMS, MAX_TRACKED_BALLS, MODE_MAX_BALLS, MULTI_BALL_MODES, emptyStats, modeBallCap, startBallAngle, startBallColor, startBallCount, teamSlotOf, type BallStats } from "@/lib/physics/ballStats";
import { MODE_IDS, type ModeId, type PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import {
  MAX_TEAM_NAME_LENGTH,
  TEAM_PRESETS,
  ballCountPatch,
  compareTeamStats,
  defaultTeam,
  effectiveBallCount,
  maxTeamsIn,
  parseTeams,
  pickEmoji,
  rankTeams,
  resizeRoster,
  resolveRoster,
  resolveTeamSettings,
  rosterPatch,
  sanitizeTeamEmoji,
  sanitizeTeamName,
  serializeTeams,
  teamCarryOver,
  teamRenderOptions,
  teamResult,
  type TeamEntry,
} from "@/lib/teams";

/**
 * Team balls with a scoreboard (lib/teams.ts, physics/ballStats.ts): the roster's URL form and validation, the
 * settings round trips (including the old `two=1`), the winner ranking, the stats book and the engine's per-ball
 * stats in real runs – without disturbing a seeded run.
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

function engineFor(mode: ModeId, seed: number, ballCount?: number, twoBalls = false, overrides: Partial<PhysicsConfig> = {}): PhysicsEngine {
  return createEngineForSettings({ ...config, ...overrides }, mode, { ...modeSettings, twoBalls, ...(ballCount !== undefined ? { ballCount } : {}) }, seed);
}

/** Runs `frames` steps (or until the run finishes) and counts the sound events by type. */
function run(engine: PhysicsEngine, frames: number, untilFinished = false) {
  const counts: Record<string, number> = { hit: 0, gap: 0, merge: 0, split: 0 };
  for (let i = 0; i < frames; i++) {
    engine.update(STEP, 0);
    for (const e of engine.consumeSoundEvents()) counts[e.type]++;
    if (untilFinished && engine.isSimulationFinished()) break;
  }
  return counts;
}

const snapshot = (engine: PhysicsEngine) => engine.getBalls().map((b) => [b.id, b.team ?? -1, Math.round(1000 * b.x), Math.round(1000 * b.y)]);
const sum = (stats: readonly BallStats[], key: "bounces" | "walls" | "escapes") => stats.reduce((acc, s) => acc + s[key], 0);
const stats = (bounces: number, walls: number, escapes: number, firstEscapeMs = escapes > 0 ? 1000 : -1): BallStats => ({ bounces, walls, escapes, firstEscapeMs });

describe("team roster: URL form and validation", () => {
  const roster: TeamEntry[] = [
    { name: "Red", color: "#ef4444", emoji: "🔥" },
    { name: "Blue Crew", color: "#3b82f6", emoji: "" },
    { name: "A*B, 100%", color: "#123abc", emoji: "👨‍👩‍👧‍👦" },
  ];

  it("serialises compactly and parses back exactly, separators and percent signs in names included", () => {
    const text = serializeTeams(roster);
    expect(text).toBe("Red*ef4444*🔥,Blue Crew*3b82f6*,A%2AB%2C 100%25*123abc*👨‍👩‍👧‍👦");
    expect(parseTeams(text)).toEqual(roster);
    // Through URLSearchParams (what the share link does), the emoji percent-encoded on the way.
    const params = new URLSearchParams();
    params.set("teams", text);
    expect(parseTeams(new URLSearchParams(params.toString()).get("teams"))).toEqual(roster);
  });

  it("falls back to the team's default colour, sanitises names and emoji and keeps at most six teams", () => {
    const parsed = parseTeams("Bad*zzz*😀,*12*,  Tab\tand\nline  *00ff00*a b,,x*fff*");
    expect(parsed).toEqual([
      { name: "Bad", color: TEAM_PRESETS[0].color, emoji: "😀" },
      { name: "", color: TEAM_PRESETS[1].color, emoji: "" },
      { name: "Tab and line", color: "#00ff00", emoji: "ab" },
      { name: "x", color: "#ffffff", emoji: "" },
    ]);
    expect(parseTeams(Array.from({ length: 9 }, (_, i) => `T${i}*ffffff*`).join(","))).toHaveLength(MAX_TEAMS);
    expect(parseTeams("")).toEqual([]);
    expect(parseTeams(null)).toEqual([]);
    expect(sanitizeTeamName("x".repeat(40))).toHaveLength(MAX_TEAM_NAME_LENGTH);
    expect(sanitizeTeamName(42)).toBe("");
    expect(sanitizeTeamEmoji(" 🔥 ")).toBe("🔥");
    expect(resolveRoster("nope")).toEqual([]);
    expect(resolveRoster([{ name: "A", color: "#F00", emoji: "⭐" }, null])).toEqual([
      { name: "A", color: "#ff0000", emoji: "⭐" },
      { name: "", color: TEAM_PRESETS[1].color, emoji: "" },
    ]);
  });

  it("keeps one symbol in the emoji field: a new one typed next to the old one replaces it", () => {
    expect(pickEmoji("🔥", "")).toBe("🔥");
    expect(pickEmoji("🔥💧", "🔥")).toBe("💧");
    expect(pickEmoji("💧🔥", "🔥")).toBe("💧");
    expect(pickEmoji("🇵🇱", "")).toBe("🇵🇱");
    expect(pickEmoji("", "🔥")).toBe("");
  });

  it("grows a roster with unused preset looks and translated names, and shrinks it", () => {
    const two = resizeRoster([], 2, ["Rojos", "Azules"]);
    expect(two).toEqual([
      { name: "Rojos", color: TEAM_PRESETS[0].color, emoji: TEAM_PRESETS[0].emoji },
      { name: "Azules", color: TEAM_PRESETS[1].color, emoji: TEAM_PRESETS[1].emoji },
    ]);
    // Team 0 removed: the next team takes the first look nobody wears (red).
    expect(resizeRoster([two[1]], 2)[1].color).toBe(TEAM_PRESETS[0].color);
    expect(resizeRoster(two, 1)).toEqual([two[0]]);
    expect(resizeRoster(two, 99)).toHaveLength(MAX_TEAMS);
    expect(defaultTeam(7)).toEqual({ ...TEAM_PRESETS[1] });
  });
});

describe("team settings: URL, presets and the ball count", () => {
  it("writes nothing by default, so old links stay short", () => {
    const params = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["teams", "nb", "tn", "tsb", "tsp"]) expect(params.has(key)).toBe(false);
    const d = defaultSettings("classic");
    expect(d.ballCount).toBe(1);
    expect(d.teams).toEqual([]);
    expect(d.twoBalls).toBe(false);
  });

  it("round-trips a roster, the switches and the scoreboard corner", () => {
    const s = {
      ...defaultSettings("shatter"),
      ...rosterPatch(resizeRoster([], 3)),
      showBallNames: false,
      scoreboardPosition: "top-right" as const,
    };
    expect(s.ballCount).toBe(3);
    expect(s.twoBalls).toBe(true);
    const params = settingsToSearchParams(s);
    expect(params.get("teams")).toBe(serializeTeams(s.teams));
    expect(params.get("two")).toBe("1");
    expect(params.has("nb")).toBe(false); // the roster carries the count
    expect(params.get("tn")).toBe("0");
    expect(params.get("tsp")).toBe("top-right");
    expect(settingsFromSearchParams(params)).toEqual(s);
  });

  it("keeps the old two-ball link working and reads a ball count above two", () => {
    const two = settingsFromSearchParams(new URLSearchParams("mode=classic&two=1"));
    expect(two.ballCount).toBe(2);
    expect(two.twoBalls).toBe(true);
    expect(settingsToSearchParams(two).toString()).toBe("mode=classic&two=1");
    const five = settingsFromSearchParams(new URLSearchParams("mode=grow&nb=5"));
    expect(five.ballCount).toBe(5);
    expect(five.twoBalls).toBe(true);
    const back = settingsToSearchParams(five);
    expect(back.get("nb")).toBe("5");
    expect(settingsFromSearchParams(back)).toEqual(five);
    expect(settingsFromSearchParams(new URLSearchParams("nb=40")).ballCount).toBe(MAX_TEAMS);
    expect(settingsFromSearchParams(new URLSearchParams("nb=abc&two=0")).ballCount).toBe(1);
    // A roster sets the count to its size.
    expect(settingsFromSearchParams(new URLSearchParams(`nb=5&teams=${encodeURIComponent("A*ff0000*,B*00ff00*")}`)).ballCount).toBe(2);
    expect(settingsFromSearchParams(new URLSearchParams("tsp=middle&tsb=maybe")).scoreboardPosition).toBe("top-left");
  });

  it("loads old two-ball presets as two balls and validates saved rosters", () => {
    const old = presetToSettings({ mode: "classic", twoBalls: true } as never);
    expect(old.ballCount).toBe(2);
    expect(old.twoBalls).toBe(true);
    expect(presetToSettings({ mode: "classic" }).ballCount).toBe(1);
    const saved = presetToSettings({ mode: "grow", ballCount: 4, twoBalls: true });
    expect(saved.ballCount).toBe(4);
    const roster = presetToSettings({ mode: "classic", ballCount: 1, teams: [{ name: " Red ", color: "#f00", emoji: "🔥" }, { name: "B", color: "oops", emoji: "" }] as TeamEntry[], scoreboardPosition: "bottom" as never, showScoreboard: "yes" as never });
    expect(roster.teams).toEqual([
      { name: "Red", color: "#ff0000", emoji: "🔥" },
      { name: "B", color: TEAM_PRESETS[1].color, emoji: "" },
    ]);
    expect(roster.ballCount).toBe(2);
    expect(roster.twoBalls).toBe(true);
    expect(roster.scoreboardPosition).toBe("top-left");
    expect(roster.showScoreboard).toBe(true);
    expect(resolveTeamSettings(null)).toMatchObject({ ballCount: 1, teams: [], twoBalls: false });
  });

  it("derives the balls in play, resizes the roster with the ball count and carries the roster over a mode change", () => {
    const base = defaultSettings("classic");
    expect(effectiveBallCount(base)).toBe(1);
    expect(effectiveBallCount({ ...base, twoBalls: true })).toBe(2);
    expect(effectiveBallCount({ ...base, ballCount: 1, teams: resizeRoster([], 4) })).toBe(4);
    expect(ballCountPatch(base, 3)).toEqual({ ballCount: 3, twoBalls: true });
    const withTeams = { ...base, ...rosterPatch(resizeRoster([], 2)) };
    const grown = ballCountPatch(withTeams, 4, ["R", "B", "G", "Y", "P", "O"]);
    expect(grown.teams?.map((t) => t.name)).toEqual(["Red", "Blue", "G", "Y"]);
    expect(rosterPatch([])).toEqual({ teams: [] });
    expect(teamCarryOver(withTeams)).toMatchObject({ teams: withTeams.teams, ballCount: 2, twoBalls: true, showScoreboard: true });
    expect(teamCarryOver(base)).not.toHaveProperty("ballCount");
    expect(teamRenderOptions(base)).toBeNull();
    expect(teamRenderOptions({ ...withTeams, scoreboardPosition: "top-right" })).toMatchObject({ roster: withTeams.teams, showNames: true, showScoreboard: true, position: "top-right" });
  });
});

describe("winner ranking", () => {
  it("ranks by escapes, then walls, then bounces, then the earlier first escape", () => {
    expect(compareTeamStats(stats(1, 0, 1), stats(99, 9, 0))).toBeLessThan(0);
    expect(compareTeamStats(stats(0, 3, 1), stats(50, 2, 1))).toBeLessThan(0);
    expect(compareTeamStats(stats(12, 2, 0), stats(11, 2, 0))).toBeLessThan(0);
    expect(compareTeamStats(stats(5, 2, 1, 900), stats(5, 2, 1, 1200))).toBeLessThan(0);
    expect(compareTeamStats(stats(5, 2, 0), stats(5, 2, 0))).toBe(0);
  });

  it("orders every team, keeps the roster order in a dead heat and reuses the output array", () => {
    const table = [stats(10, 1, 0), stats(3, 4, 1), stats(10, 1, 0), stats(20, 0, 0), stats(3, 4, 1, 500)];
    const out: number[] = [7, 7, 7];
    expect(rankTeams(table, 5, out)).toBe(out);
    expect(out).toEqual([4, 1, 0, 2, 3]); // team 3 bounced most, but broke no wall
    expect(rankTeams(table, 2)).toEqual([1, 0]);
    expect(rankTeams(table, 0)).toEqual([]);
  });

  it("names the winner, or the teams in a tie", () => {
    expect(teamResult([stats(4, 1, 0), stats(2, 2, 0)], 2)).toEqual({ winner: 1, tie: false, leaders: [1] });
    expect(teamResult([stats(4, 1, 1, 700), stats(4, 1, 1, 700), stats(9, 9, 0)], 3)).toEqual({ winner: 0, tie: true, leaders: [0, 1] });
    expect(teamResult([], 0)).toEqual({ winner: -1, tie: false, leaders: [] });
  });
});

describe("ball stats book", () => {
  it("counts per ball and per team, escapes once, and starts over on reset", () => {
    const book = new BallStatsBook();
    const a = { id: 0, team: 0 };
    const b = { id: 1, team: 1 };
    const loner = { id: 2 };
    book.bounce(a);
    book.bounce(a);
    book.bounce(b);
    book.wall(b);
    book.bounce(loner);
    expect(book.escape(a, 1500)).toBe(true);
    expect(book.escape(a, 1600)).toBe(false);
    expect(book.ballStats(0)).toEqual({ bounces: 2, walls: 0, escapes: 1, firstEscapeMs: 1500 });
    expect(book.ballStats(2)).toEqual({ bounces: 1, walls: 0, escapes: 0, firstEscapeMs: -1 });
    expect(book.teams[0]).toEqual({ bounces: 2, walls: 0, escapes: 1, firstEscapeMs: 1500 });
    expect(book.teams[1]).toEqual({ bounces: 1, walls: 1, escapes: 0, firstEscapeMs: -1 });
    book.inheritEscape(0, 9);
    expect(book.hasEscaped(9)).toBe(true);
    expect(book.escape({ id: 9, team: 0 }, 2000)).toBe(false);
    const generation = book.generation;
    book.reset();
    expect(book.generation).toBe(generation + 1);
    expect(book.teams.every((t) => t.bounces === 0 && t.escapes === 0 && t.firstEscapeMs === -1)).toBe(true);
    expect(book.ballStats(0)).toBeUndefined();
    expect(book.hasEscaped(0)).toBe(false);
  });

  it("stops adding per-ball entries at the cap but keeps the team totals", () => {
    const book = new BallStatsBook();
    for (let id = 0; id < MAX_TRACKED_BALLS + 10; id++) book.bounce({ id, team: 3 });
    expect(book.trackedBalls()).toBe(MAX_TRACKED_BALLS);
    expect(book.teams[3].bounces).toBe(MAX_TRACKED_BALLS + 10);
    expect(teamSlotOf({ team: 6 })).toBe(-1);
    expect(teamSlotOf({ team: 1.5 })).toBe(-1);
    expect(teamSlotOf({})).toBe(-1);
    expect(emptyStats()).toEqual({ bounces: 0, walls: 0, escapes: 0, firstEscapeMs: -1 });
  });
});

describe("several balls in the engine", () => {
  it("starts 1–6 balls only in the multi-ball modes, the ball count overriding the two-ball switch", () => {
    for (const mode of MODE_IDS) {
      const expected = MULTI_BALL_MODES.includes(mode) ? Math.min(4, modeBallCap(mode)) : 1;
      expect(startBallCount({ ballCount: 4 }, mode)).toBe(expected);
    }
    expect(startBallCount({ twoBalls: true }, "classic")).toBe(2);
    expect(startBallCount({ twoBalls: true, ballCount: 1 }, "classic")).toBe(1);
    expect(startBallCount({ ballCount: 99 }, "classic")).toBe(MAX_TEAMS);
    expect(startBallCount({ ballCount: 99 }, "grow")).toBe(2);
    expect(startBallCount({ twoBalls: true }, "grow")).toBe(2);
    expect(startBallCount({}, "shatter")).toBe(1);
    expect(startBallColor(0, { ballColor: "#111111", ballColor2: "#222222" })).toBe("#111111");
    expect(startBallColor(1, { ballColor: "#111111", ballColor2: "#222222" })).toBe("#222222");
    expect(startBallColor(2, { ballColor: "#111111" })).not.toBe(startBallColor(3, { ballColor: "#111111" }));
    expect(startBallAngle(1, 1, 2)).toBeCloseTo(1 + Math.PI, 12);
    expect(startBallAngle(0, 2, 4)).toBeCloseTo(Math.PI, 12);
  });

  it("spawns evenly spread team balls from the centre at the ball speed", () => {
    for (const mode of MULTI_BALL_MODES) {
      const engine = engineFor(mode, 42, 5);
      const balls = engine.getBalls();
      const n = Math.min(5, modeBallCap(mode));
      expect(balls.map((b) => b.team)).toEqual([0, 1, 2, 3, 4].slice(0, n));
      const a0 = Math.atan2(balls[0].vy, balls[0].vx);
      balls.forEach((b, i) => {
        expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(400, 6);
        const turn = (((Math.atan2(b.vy, b.vx) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        expect(turn).toBeCloseTo((i * 2 * Math.PI) / n, 6);
      });
    }
    // A mode without several balls ignores the count; Ball Drop keeps its own balls, without teams.
    expect(engineFor("portal", 42, 5).getBalls()).toHaveLength(1);
    expect(engineFor("drop", 42, 5).getBalls().every((b) => b.team === undefined)).toBe(true);
  });

  it("leaves a one-ball run and the old two-ball run exactly as they were", () => {
    for (const mode of ["classic", "shatter", "grow"] as ModeId[]) {
      const plain = engineFor(mode, 777);
      const one = engineFor(mode, 777, 1);
      run(plain, 600);
      run(one, 600);
      expect(snapshot(one)).toEqual(snapshot(plain));
      const oldTwo = engineFor(mode, 778, undefined, true);
      const two = engineFor(mode, 778, 2);
      run(oldTwo, 600);
      run(two, 600);
      expect(snapshot(two)).toEqual(snapshot(oldTwo));
    }
  });

  it("stays deterministic with six balls, stats included", () => {
    for (const mode of MULTI_BALL_MODES) {
      const a = engineFor(mode, 2024, 6);
      const b = engineFor(mode, 2024, 6);
      expect(run(a, 900)).toEqual(run(b, 900));
      expect(snapshot(a)).toEqual(snapshot(b));
      expect(a.getTeamStats()).toEqual(b.getTeamStats());
    }
  });

  it("Classic: team bounces and walls add up to the hit and gap sounds, every ball escapes once and a winner is named", () => {
    const engine = engineFor("classic", 31337, 3);
    const counts = run(engine, 60 * 120, true);
    expect(engine.isSimulationFinished()).toBe(true);
    const teams = engine.getTeamStats();
    expect(sum(teams, "bounces")).toBe(counts.hit);
    expect(sum(teams, "walls")).toBe(counts.gap);
    expect(sum(teams, "walls")).toBe(7); // every ring broke once, credited to the ball that broke it
    expect(teams.slice(0, 3).map((t) => t.escapes)).toEqual([1, 1, 1]);
    expect(teams.slice(3).every((t) => t.bounces === 0)).toBe(true);
    for (const ball of engine.getBalls()) {
      expect(engine.hasBallEscaped(ball.id)).toBe(true);
      expect(engine.getBallStats(ball.id)?.escapes).toBe(1);
    }
    const result = teamResult(teams, 3);
    expect(result.winner).toBeGreaterThanOrEqual(0);
    expect(rankTeams(teams, 3)[0]).toBe(result.winner);
  });

  it("Shatter and Color Match credit every broken segment to the ball that broke it", () => {
    for (const mode of ["shatter", "colorMatch"] as ModeId[]) {
      const engine = engineFor(mode, 99, 3);
      expect(engine.getBalls()).toHaveLength(3);
      const counts = run(engine, 60 * 40);
      const teams = engine.getTeamStats();
      expect(counts.gap).toBeGreaterThan(0);
      expect(sum(teams, "walls")).toBe(counts.gap);
      expect(sum(teams, "bounces")).toBe(counts.hit);
    }
  });

  it("counts the escape that ends a Shatter or Color Match run with breathing walls, so the banner names the right winner", () => {
    // The escape scan measures against the live (pulsing) outer wall, like the modes' own end tests (+20 / +30 px),
    // so the escape is on the books in the step the run ends – the scoreboard freezes on that frame. Measured against
    // the widest pulse instead, most of these runs ended with no escape counted and the winner picked by walls.
    for (const breathingAmplitude of [0.05, 0.1, 0.3]) {
      for (const mode of ["shatter", "colorMatch"] as ModeId[]) {
        for (let seed = 1; seed <= 8; seed++) {
          const engine = engineFor(mode, seed, 3, false, { breathingAmplitude, breathingSpeed: 1 });
          run(engine, 60 * 120, true);
          const label = `${mode} bw=${breathingAmplitude} seed ${seed}`;
          expect(engine.isSimulationFinished(), label).toBe(true);
          const teams = engine.getTeamStats();
          expect(sum(teams, "escapes"), label).toBeGreaterThanOrEqual(1);
          const winner = teamResult(teams, 3).winner;
          if (winner >= 0) expect(teams[winner].escapes, label).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it("Grow keeps its old limit of two balls: none ever leaves the sealed ring, and two-ball runs replay as before", () => {
    expect(MODE_MAX_BALLS.grow).toBe(2);
    expect(modeBallCap("grow")).toBe(2);
    expect(modeBallCap("classic")).toBe(MAX_TEAMS);
    // The roster limit: two teams play in Grow; a mode without teams keeps the whole roster for the next mode.
    expect(maxTeamsIn("grow")).toBe(2);
    expect(maxTeamsIn("classic")).toBe(MAX_TEAMS);
    expect(maxTeamsIn("portal")).toBe(MAX_TEAMS);
    const grow = defaultSettings("grow");
    expect(effectiveBallCount({ ...grow, ballCount: 6 })).toBe(2);
    expect(effectiveBallCount({ ...grow, teams: resizeRoster([], 4) })).toBe(2);
    expect(effectiveBallCount({ ...defaultSettings("classic"), teams: resizeRoster([], 4) })).toBe(4);
    for (let seed = 1; seed <= 6; seed++) {
      const six = engineFor("grow", seed, 6);
      expect(six.getBalls().map((b) => b.team)).toEqual([0, 1]);
      const oldTwo = engineFor("grow", seed, undefined, true);
      run(six, 60 * 60);
      run(oldTwo, 60 * 60);
      expect(snapshot(six)).toEqual(snapshot(oldTwo));
      expect(sum(six.getTeamStats(), "escapes"), `seed ${seed}`).toBe(0);
      const cx = config.width / 2;
      const cy = config.height / 2;
      const ring = six.getCircularWalls()[0].radius;
      // The whole ball stays inside the sealed ring, not only its centre: two balls share it (each grows to half of it at most).
      for (const b of six.getBalls()) expect(Math.hypot(b.x - cx, b.y - cy) + b.radius, `seed ${seed}`).toBeLessThanOrEqual(ring);
    }
    // The live change stays inside the cap too.
    const live = engineFor("grow", 3);
    live.setBallCount(6);
    expect(live.getBalls().map((b) => b.team)).toEqual([0, 1]);
  });

  it("two Grow balls share the sealed ring: grown, they still fit side by side and heavy gravity never shoves one out", () => {
    // Grown to the single-ball cap (the ring's radius − 2) both used to rest half outside the ring, and from gravity 600 the
    // pair correction shoved one through it (seed 4 at gravity 600: out at 42.6 s).
    const cx = config.width / 2;
    const cy = config.height / 2;
    for (const [seed, gravity] of [[4, 600], [2, 1000]]) {
      const engine = engineFor("grow", seed, 2, false, { gravity });
      const ring = engine.getCircularWalls()[0].radius;
      let worst = -Infinity;
      for (let f = 0; f < 60 * 60; f++) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        for (const b of engine.getBalls()) worst = Math.max(worst, Math.hypot(b.x - cx, b.y - cy) + b.radius - ring);
      }
      expect(worst, `seed ${seed}, gravity ${gravity}`).toBeLessThanOrEqual(0);
      expect(sum(engine.getTeamStats(), "escapes")).toBe(0);
      for (const b of engine.getBalls()) expect(b.radius).toBeLessThanOrEqual(ring / 2);
    }
    // One ball keeps the whole ring: it grows past half of it as it always did.
    const one = engineFor("grow", 1, 1);
    one.setGrowRate(20);
    run(one, 60 * 60);
    expect(one.getBalls()[0].radius).toBeGreaterThan(one.getCircularWalls()[0].radius / 2);
  }, 60_000);

  it("Multiply: the start count sets the first balls and the new balls play for the team of the ball that escaped", () => {
    const engine = engineFor("multiply", 5, 3);
    expect(engine.getBalls()).toHaveLength(3);
    run(engine, 60 * 20);
    const balls = engine.getBalls();
    expect(balls.length).toBeGreaterThan(3);
    expect(balls.every((b) => b.team !== undefined && b.team < 3)).toBe(true);
    const teams = engine.getTeamStats();
    expect(sum(teams, "escapes")).toBeGreaterThan(0);
    // Every escape through the single ring is also the wall it broke through.
    expect(sum(teams, "walls")).toBe(sum(teams, "escapes"));
    for (const b of balls) if (b.team! > 0) expect(b.color).not.toBe(config.ballColor);
  });

  it("adds and removes balls live, and a restart zeroes the stats", () => {
    const engine = engineFor("classic", 3);
    run(engine, 60);
    engine.setBallCount(4);
    expect(engine.getBalls().map((b) => b.team)).toEqual([0, 1, 2, 3]);
    engine.setBallCount(2);
    expect(engine.getBalls().map((b) => b.team)).toEqual([0, 1]);
    engine.setBallCount(1);
    expect(engine.getBalls()).toHaveLength(1);
    run(engine, 120);
    expect(sum(engine.getTeamStats(), "bounces")).toBeGreaterThan(0);
    const generation = engine.getStatsGeneration();
    engine.setBallCount(3);
    engine.initMode("classic");
    expect(engine.getBalls()).toHaveLength(3);
    expect(engine.getStatsGeneration()).toBeGreaterThan(generation);
    expect(sum(engine.getTeamStats(), "bounces")).toBe(0);
    // A mode without several balls keeps its one ball.
    const portal = engineFor("portal", 3);
    portal.setBallCount(4);
    expect(portal.getBalls()).toHaveLength(1);
  });

  it("keeps the colours of the other slots when the ball colour changes", () => {
    const engine = engineFor("classic", 8, 3);
    engine.setConfig({ ballColor: "#abcdef", ballColor2: "#123456" });
    expect(engine.getBalls().map((b) => b.color)).toEqual(["#abcdef", "#123456", startBallColor(2, config)]);
  });
});
