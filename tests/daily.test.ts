import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DAILY_EPOCH,
  DAILY_HISTORY_DAYS,
  DAILY_POOL,
  addDays,
  dailyChallenge,
  dailyFromParam,
  dailyLink,
  dailyPoolIndex,
  dailySeed,
  dailySettings,
  dailyStreak,
  dayIndex,
  formatRunSeconds,
  hash32,
  msUntilNextChallenge,
  parseDateKey,
  poolEntryQuery,
  recordDailyResult,
  sanitizeDailyHistory,
  todaysChallenge,
  utcDateKey,
} from "@/lib/daily";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS } from "@/lib/physics/types";
import { settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { fixedRunDurationSec, runNeverFinishes, simulateSeed } from "@/lib/simulation/finder";
import { parseSeed } from "@/lib/recording/batch";

afterEach(() => vi.restoreAllMocks());

describe("daily challenge: dates", () => {
  it("keys a moment by its UTC date and parses only real dates", () => {
    expect(utcDateKey(new Date("2026-09-30T23:59:59Z"))).toBe("2026-09-30");
    expect(utcDateKey(new Date("2026-10-01T00:00:00Z"))).toBe("2026-10-01");
    // 23:30 in New York on 30 September is already 1 October in UTC: the challenge follows UTC, not the local day
    expect(utcDateKey(new Date("2026-09-30T23:30:00-04:00"))).toBe("2026-10-01");
    expect(parseDateKey("2026-02-28")).toBe(Date.UTC(2026, 1, 28));
    for (const bad of ["2026-02-30", "2026-13-01", "2026-9-1", "20260930", "", "1", "2026-09-30T00:00"]) expect(parseDateKey(bad)).toBeNull();
  });

  it("counts days from the epoch and adds days across months and years", () => {
    expect(dayIndex(DAILY_EPOCH)).toBe(0);
    expect(dayIndex(addDays(DAILY_EPOCH, 1))).toBe(1);
    expect(dayIndex(addDays(DAILY_EPOCH, -3))).toBe(-3);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(dayIndex("nope")).toBeNaN();
  });

  it("counts down to the next UTC midnight", () => {
    expect(msUntilNextChallenge(new Date("2026-09-30T23:00:00Z"))).toBe(3_600_000);
    expect(msUntilNextChallenge(new Date("2026-09-30T00:00:00Z"))).toBe(86_400_000);
  });
});

describe("daily challenge: seed and mode", () => {
  it("is a pure function of the date – no Math.random – and stable across calls", () => {
    const random = vi.spyOn(Math, "random");
    const a = dailyChallenge("2026-11-05");
    const b = dailyChallenge("2026-11-05");
    expect(a).toEqual(b);
    expect(random).not.toHaveBeenCalled();
  });

  it("keeps the derivation fixed: shared daily links must open the same challenge forever", () => {
    // A regression fixture – changing the hash, the pool order or the epoch breaks every shared ?daily= link.
    expect(hash32("")).toBe(hash32(""));
    expect(hash32("a")).not.toBe(hash32("b"));
    const first = dailyChallenge(DAILY_EPOCH);
    expect(first.number).toBe(1);
    expect(first.date).toBe(DAILY_EPOCH);
    expect({ seed: first.seed, mode: first.mode }).toEqual({ seed: dailySeed(DAILY_EPOCH), mode: DAILY_POOL[dailyPoolIndex(0)].mode });
    expect(DAILY_FIXTURE.map((d) => ({ date: d.date, ...pick(dailyChallenge(d.date)) }))).toEqual(DAILY_FIXTURE);
  });

  it("hands out valid, distinct seeds", () => {
    const seeds = new Set<number>();
    for (let i = -30; i < 400; i++) {
      const key = addDays(DAILY_EPOCH, i);
      const seed = dailySeed(key);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(1);
      expect(seed).toBeLessThan(0x7fffffff);
      expect(parseSeed(String(seed))).toBe(seed); // a seed= link parameter takes it
      seeds.add(seed);
    }
    expect(seeds.size).toBe(430);
  });

  it("deals every pool mode once per block and never repeats a mode on consecutive days", () => {
    const n = DAILY_POOL.length;
    let previous: string | null = null;
    for (let block = -1; block < 30; block++) {
      const modes = new Set<string>();
      for (let at = 0; at < n; at++) {
        const mode = dailyChallenge(addDays(DAILY_EPOCH, block * n + at)).mode;
        modes.add(mode);
        expect(mode).not.toBe(previous);
        previous = mode;
      }
      expect(modes.size).toBe(n);
    }
  });

  it("numbers the challenges from the epoch", () => {
    expect(dailyChallenge(addDays(DAILY_EPOCH, 99)).number).toBe(100);
    expect(todaysChallenge(new Date(`${addDays(DAILY_EPOCH, 9)}T12:00:00Z`)).number).toBe(10);
  });
});

describe("daily challenge: the pool", () => {
  it("only holds known, distinct modes whose run ends by itself and depends on the seed", () => {
    const modes = DAILY_POOL.map((e) => e.mode);
    expect(new Set(modes).size).toBe(modes.length);
    for (const entry of DAILY_POOL) {
      expect(MODE_IDS).toContain(entry.mode);
      const s = settingsFromSearchParams(new URLSearchParams(poolEntryQuery(entry)));
      expect(s.mode).toBe(entry.mode);
      const req = finderRequestOfSettings(s);
      expect(runNeverFinishes(entry.mode, req.modeSettings)).toBe(false);
      expect(fixedRunDurationSec(entry.mode, req.modeSettings)).toBeNull();
    }
  });

  it("writes each look as a canonical share query every parameter of which the simulator reads", () => {
    for (const entry of DAILY_POOL) {
      const query = poolEntryQuery(entry);
      expect(query.startsWith(`mode=${entry.mode}`)).toBe(true);
      // every parameter of the look survives the round trip (none is unknown, out of range or a default)
      for (const [key, value] of new URLSearchParams(entry.look)) expect(new URLSearchParams(query).get(key), `${entry.mode}: ${key}`).toBe(value);
      expect(settingsToSearchParams(settingsFromSearchParams(new URLSearchParams(query))).toString()).toBe(query);
    }
  });

  it("gives a daily run that ends by itself within two minutes, on a desktop and on a phone canvas", () => {
    const n = DAILY_POOL.length;
    for (let i = 0; i < n; i++) {
      const challenge = dailyChallenge(addDays(DAILY_EPOCH, i));
      const settings = dailySettings(challenge);
      for (const world of [{ width: 880, height: 495 }, { width: 360, height: 360 }]) {
        const ms = simulateSeed(challenge.seed, finderRequestOfSettings(settings, world, 150), 150_000);
        expect(ms, `${challenge.date} ${challenge.mode} on ${world.width}×${world.height}`).toBeLessThan(120_000);
      }
    }
  }, 120_000);
});

describe("daily challenge: links", () => {
  const now = new Date("2026-10-20T08:00:00Z");

  it("opens today's challenge for daily=1 and a given day's for its date", () => {
    expect(dailyFromParam("1", now)?.date).toBe("2026-10-20");
    expect(dailyFromParam("today", now)?.date).toBe("2026-10-20");
    expect(dailyFromParam(" 2026-10-02 ", now)?.date).toBe("2026-10-02");
    expect(dailyFromParam(DAILY_EPOCH, now)?.number).toBe(1);
    expect(dailyFromParam("2026-10-21", now)?.date).toBe("2026-10-21"); // a day of clock skew
  });

  it("ignores anything else: no parameter, bad dates, days before #1 and later days", () => {
    for (const value of [null, undefined, "", "0", "yes", "2026-02-30", addDays(DAILY_EPOCH, -1), "2026-10-22", "2030-01-01"]) expect(dailyFromParam(value, now)).toBeNull();
  });

  it("puts the challenge's settings on the page and links to it by date", () => {
    const c = dailyChallenge("2026-10-07");
    const s = dailySettings(c);
    expect(s.mode).toBe(c.mode);
    expect(settingsToSearchParams(s).toString()).toBe(c.query);
    expect(dailyLink("https://example.com/Balls/en/simulator/?mode=classic&g=500#x", c)).toBe("https://example.com/Balls/en/simulator/?daily=2026-10-07");
    expect(dailyFromParam(new URL(dailyLink("https://example.com/en/simulator/", c)).searchParams.get("daily"), now)).toEqual(c);
  });

  it("formats a run length with one decimal", () => {
    expect(formatRunSeconds(23_449)).toBe("23.4");
    expect(formatRunSeconds(-5)).toBe("0.0");
  });
});

describe("daily challenge: history and streak", () => {
  it("keeps the first result of a day and forgets entries older than the history window", () => {
    let h = recordDailyResult({}, "2026-10-01", 23_456.4);
    expect(h).toEqual({ "2026-10-01": 23_456 });
    h = recordDailyResult(h, "2026-10-01", 5_000);
    expect(h["2026-10-01"]).toBe(23_456);
    const old = addDays("2026-10-01", -DAILY_HISTORY_DAYS);
    h = recordDailyResult({ ...h, [old]: 1_000 }, "2026-10-02", 9_000);
    expect(Object.keys(h).sort()).toEqual(["2026-10-01", "2026-10-02"]);
    expect(recordDailyResult(h, "not-a-date", 1)).toEqual(h);
  });

  it("counts the days in a row, alive until a day is missed", () => {
    const h = { "2026-10-01": 1, "2026-10-02": 1, "2026-10-03": 1, "2026-09-28": 1 };
    expect(dailyStreak(h, "2026-10-03")).toBe(3);
    expect(dailyStreak(h, "2026-10-04")).toBe(3); // today's still to play
    expect(dailyStreak(h, "2026-10-05")).toBe(0); // yesterday missed
    expect(dailyStreak({}, "2026-10-05")).toBe(0);
  });

  it("reads a damaged store as empty or keeps only its good entries", () => {
    expect(sanitizeDailyHistory(null)).toEqual({});
    expect(sanitizeDailyHistory([1, 2])).toEqual({});
    expect(sanitizeDailyHistory({ "2026-10-01": 5, "2026-10-02": "x", junk: 3, "2026-10-03": -1, "2026-10-04": Infinity })).toEqual({ "2026-10-01": 5 });
  });
});

describe("engine: the pinned seed the daily challenge checks", () => {
  it("reports a pinned seed until it is dropped", () => {
    const engine = new PhysicsEngine({ gravity: 300, damping: 0, bounce: 1, width: 800, height: 600, audioIntensity: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#fff", ballRadius: 8, twoBalls: false, ballColor2: "#f00" });
    expect(engine.getPinnedSeed()).toBeNull();
    engine.setSeed(12345);
    engine.initMode("classic");
    expect(engine.getPinnedSeed()).toBe(12345);
    expect(engine.getSeed()).toBe(12345);
    engine.setSeed(null);
    expect(engine.getPinnedSeed()).toBeNull();
  });
});

function pick(c: { seed: number; mode: string; number: number }) {
  return { seed: c.seed, mode: c.mode, number: c.number };
}

/** The first days' challenges, frozen (see "keeps the derivation fixed"). */
const DAILY_FIXTURE: { date: string; seed: number; mode: string; number: number }[] = [
  { date: "2026-09-30", seed: 873151179, mode: "ctf", number: 1 },
  { date: "2026-10-01", seed: 760489460, mode: "multipliers", number: 2 },
  { date: "2026-10-02", seed: 971759718, mode: "drop", number: 3 },
  { date: "2026-10-14", seed: 1031231383, mode: "runner", number: 15 },
  { date: "2026-10-15", seed: 1912929479, mode: "race", number: 16 },
  { date: "2027-01-08", seed: 858940638, mode: "shatter", number: 101 },
];
