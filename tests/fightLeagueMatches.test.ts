import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_FIGHT_LEAGUE_SETTINGS,
  EV_DAMAGE,
  FB_BOSS_FALLS,
  FB_BOSS_SURVIVES,
  FB_CHAMPION,
  FB_FIRST_BLOOD,
  FB_GAME,
  FB_PHASE2,
  FB_REMATCH,
  FB_SERIES_WIN,
  FL_EVENT_CAP,
  FL_MATCHES,
  FL_MAX_SLOTS,
  FL_SLOT_LETTERS,
  FIGHT_LEAGUE_RANGES,
  FIGHT_LEAGUE_URL_KEYS,
  flBossRow,
  flFinderBatch,
  flPinnedSlots,
  flRunSummary,
  flShowBouts,
  flShowHorizonMs,
  flShowKind,
  flSideCount,
  flSideNames,
  matchFighters,
  slotTeam,
  type FightLeagueSettings,
  type FightLeagueView,
  type FlRunSummary,
} from "@/lib/physics/modes/fightLeague";
import {
  FL_BOSS,
  FL_BOUT_CAP_SEC,
  FL_BYE,
  FL_CARD_SEC,
  FL_COMEBACK_DEFICIT,
  FL_ENTRANT_CEILING,
  FL_INTERLUDE_FINALE_MS,
  FL_LEAD_HYSTERESIS,
  FL_REMATCHES,
  FL_3V3_SIZE,
  drawFlEntrants,
  flBestOfGames,
  flBracketBouts,
  flBuildBracket,
  flChancePercent,
  flClockText,
  flExpectedClipSec,
  flNextBout,
  flSeedOrder,
  flSeedPlacement,
  flSeriesMaxGames,
  flSeriesNeed,
  flStoryTags,
  flStrengthOf,
  flWinChance,
  flWinChances,
  parseFlEntrants,
  sanitizeFlEntrants,
} from "@/lib/physics/modes/fightLeagueShow";
import { FL_BY_ID, FL_CONFERENCES, FL_PRESETS, FL_PRESET_FORMATS, conferenceOf, type FlConference, type FlDivision } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_STRENGTH } from "@/lib/physics/modes/fightLeagueRatings";
import type { PhysicsEngine } from "@/lib/physics/engine";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { findSimulation, simulateOutcomeRun, type FinderRequest } from "@/lib/simulation/finder";
import { availableOutcomes, outcomeClipSec, outcomeFigure, outcomeHorizonMs, outcomeMatches, outcomeMiss, type FinderOutcome, type FinderOutcomeKind, type RunSummary } from "@/lib/simulation/outcomes";
import { MEMORY_CEILINGS } from "@/lib/uncap";
import { effectiveBallCount } from "@/lib/teams";
import { FightLeagueDataset, FightLeagueLayer } from "@/components/simulator/fightLeagueRenderer";
import { flCurrentPreset, flPanelSlots, flPresetPatch } from "@/components/simulator/sections/fightLeaguePresetMatch";
import { PROBE_STEP, probeEngine, probeRun, probeSettings } from "./flProbes";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- fl-overhaul --- (Stage 5) Fight League's match types and shows: 3v3 (A + B + C against D + E + F), best-of-N series,
 * brackets (byes, seeding, pools inside one division or conference), boss rushes (the boss's HP carried and healed, PHASE 2,
 * both endings, the balance at the defaults), the story engine (first blood, lead changes, clutch / perfect / upset / comeback,
 * the finisher), the win chance, the finder's story outcomes, the rig per format, the URL keys, the presets, the golden
 * fingerprints of every format at 30, 60 and 144 fps – and a grep for 4-slot leftovers.
 */

type Fl = Partial<FightLeagueSettings>;
const THOR_LOKI = ["thor", "loki", "random", "random", "random", "random"];
const AVENGERS_3V3 = ["thor", "ironman", "captainamerica", "thanos", "loki", "venom"];
const BO3: Fl = { fighters: THOR_LOKI, bestOf: 3 };
const BRACKET8: Fl = { match: "bracket", fighters: THOR_LOKI };
const BOSS: Fl = { match: "boss", fighters: ["gerald", "random", "random", "random", "random", "random"] };
const TRIO: Fl = { match: "3v3", fighters: AVENGERS_3V3 };
/** Far past the end of every show these tests run (a run stops at its end). */
const FOREVER = 3_000_000;

/** Runs a show to its end, then on through the verdict's hold (the winner's and the show's banners come after the finale). */
function runShow(engine: PhysicsEngine, each?: (v: FightLeagueView) => void): FightLeagueView {
  const v = probeRun(engine, FOREVER, each);
  return probeRun(engine, v.timeMs + 6000, each, false);
}

/** New render events since `serial` (the ring of FL_EVENT_CAP). */
function eventsSince(v: FightLeagueView, serial: number) {
  const out: { kind: number; slot: number; src: number; value: number }[] = [];
  for (let s = Math.max(serial, v.eventSerial - FL_EVENT_CAP); s < v.eventSerial; s++) {
    const e = v.events[s % FL_EVENT_CAP];
    out.push({ kind: e.kind, slot: e.slot, src: e.src, value: e.value });
  }
  return out;
}

/** Every banner pushed during a run (the ring of 16 read after every frame): its kind, when and its value. */
function bannerLog(): { seen: number; list: { kind: number; t: number; value: number; serial: number }[]; read(v: FightLeagueView, serial: number): void } {
  return {
    seen: 0,
    list: [],
    read(v, serial) {
      const cap = v.banners.length;
      for (let s = Math.max(this.seen, v.bannerSerial - cap); s < v.bannerSerial; s++) {
        const b = v.banners[s % cap];
        this.list.push({ kind: b.kind, t: b.t, value: b.value, serial });
      }
      this.seen = v.bannerSerial;
    },
  };
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

/** A finder request for these Fight League settings (a show's horizon: FL_SHOW_BOUT_SEC a match). */
function finderRequest(fl: Fl, patch: Partial<FinderRequest> = {}): FinderRequest {
  const { config, modeSettings } = probeSettings(fl);
  const horizon = flShowHorizonMs(modeSettings.fightLeague as FightLeagueSettings) / 1000;
  return { targetDurationSec: 20, toleranceSec: 1, maxSeeds: 400, maxSimTimeSec: horizon, physicsConfig: config, mode: "fightLeague", modeSettings, ...patch };
}

/** Steps whole frames of `frameMs` to `untilMs` of simulation time (past the end too: the fighters stand frozen). */
function runTo(engine: PhysicsEngine, untilMs: number, frameMs: number): FightLeagueView {
  while (engine.getElapsedMs() < untilMs - 1e-6) {
    engine.update(frameMs, 0);
    engine.consumeSoundEvents();
  }
  return engine.getFightLeagueView();
}

/** A fingerprint of a show's state: every fighter (positions, HP, hits, casts, meter), the counters and the show's figures. */
function fingerprint(v: FightLeagueView): string {
  let h = 2166136261;
  const mix = (n: number) => {
    const s = Number.isFinite(n) ? n.toFixed(6) : String(n);
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  };
  for (const f of v.fighters) [f.x, f.y, f.vx, f.vy, f.hp, f.hits, f.casts, f.meter].forEach(mix);
  [v.hits, v.casts, v.kos, v.shots, v.clashes, v.wallHits, v.blocks, v.winnerTeam, v.finishMs].forEach(mix);
  const sh = v.show;
  [sh.matchIndex, sh.bout, sh.games, ...sh.score, ...sh.wins, sh.wave, sh.bossHp, sh.champion, sh.winnerSide, sh.rematches, v.matchSerial].forEach(mix);
  for (const e of sh.entrants) mix(e.out ? 1 : 0);
  return h.toString(16).padStart(8, "0");
}

/** The fighters of a view's teams: the summed HP share of team `t`. */
function share(v: FightLeagueView, t: number): number {
  let hp = 0;
  let max = 0;
  for (const f of v.fighters) {
    if (f.team !== t) continue;
    hp += f.alive ? Math.max(0, f.hp) : 0;
    max += f.maxHp;
  }
  return max > 0 ? hp / max : 0;
}

/* ------------------------------------------------------------------ 3v3 */

describe("fight league 3v3", () => {
  it("pits A + B + C against D + E + F at 0.85× the size from two columns, with no friendly fire, and all six fight", { timeout: 60_000 }, () => {
    expect(FL_MATCHES).toEqual(expect.arrayContaining(["3v3", "bracket", "boss"]));
    expect(matchFighters("3v3")).toBe(6);
    expect([0, 1, 2, 3, 4, 5].map((i) => slotTeam("3v3", i))).toEqual([0, 0, 0, 1, 1, 1]);
    expect(flSideNames("3v3", AVENGERS_3V3)).toEqual(["A+B+C · Thor + Iron Man + Captain America", "D+E+F · Thanos + Loki + Venom"]);
    const solo = probeEngine({ fighters: ["thor", "loki"] }, 5).getFightLeagueView().fighters[0].r;
    for (const seed of [1, 2, 3]) {
      const engine = probeEngine(TRIO, seed);
      const v = engine.getFightLeagueView();
      expect(v.fighters.map((f) => f.row.id)).toEqual(AVENGERS_3V3);
      expect(v.teamCount).toBe(2);
      expect(v.fighters[0].r).toBeCloseTo(FL_3V3_SIZE * solo, 6);
      // the columns: A, B, C on one side, D, E, F on the other, top to bottom
      const cx = v.field!.cx;
      const left = v.fighters.slice(0, 3);
      const right = v.fighters.slice(3);
      expect(left.every((f) => f.x < cx) && right.every((f) => f.x > cx)).toBe(true);
      expect(left[0].y < left[1].y && left[1].y < left[2].y).toBe(true);
      let serial = v.eventSerial;
      let friendly = 0;
      let damage = 0;
      probeRun(engine, 120_000, (view) => {
        for (const e of eventsSince(view, serial)) {
          if (e.kind !== EV_DAMAGE || e.src < 0 || e.slot < 0) continue;
          damage++;
          const by = view.fighters[e.src >> 3];
          if (by && by.slot !== e.slot && by.team === view.fighters[e.slot].team) friendly++;
        }
        serial = view.eventSerial;
      });
      expect(v.finished).toBe(true);
      expect(damage).toBeGreaterThan(0);
      expect([seed, friendly]).toEqual([seed, 0]);
      // every slot dealt or took damage: all six fought
      for (const f of v.fighters) expect([seed, f.slot, f.dealt + f.taken > 0]).toEqual([seed, f.slot, true]);
      expect(v.winnerTeam === 0 || v.winnerTeam === 1 || v.winnerTeam === -1).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ series */

describe("fight league series", () => {
  it("ends a Bo3 at two wins within n + 2 games, rounds an even best-of up and keeps one run", { timeout: 60_000 }, () => {
    expect([1, 2, 3, 4, 5, 6, 7, 0, -3, NaN].map(flBestOfGames)).toEqual([1, 3, 3, 5, 5, 7, 7, 1, 1, 1]);
    expect([flSeriesNeed(3), flSeriesNeed(4), flSeriesNeed(7), flSeriesMaxGames(3), flSeriesMaxGames(4)]).toEqual([2, 3, 4, 5, 7]);
    expect(flShowKind({ match: "1v1", bestOf: 3 })).toBe("series");
    expect(flShowKind({ match: "3v3", bestOf: 2 })).toBe("series");
    expect(flShowKind({ match: "ffa4", bestOf: 3 })).toBe("single");
    expect(flShowKind({ match: "1v1", bestOf: 1 })).toBe("single");
    const even = probeEngine({ ...BO3, bestOf: 4 }, 2).getFightLeagueView().show;
    expect([even.kind, even.need, even.maxGames]).toEqual(["series", 3, 7]);
    for (const seed of [1, 2, 3, 4]) {
      const engine = probeEngine(BO3, seed);
      const log = bannerLog();
      const serials = new Set<number>();
      const v = runShow(engine, (view) => {
        log.read(view, view.matchSerial);
        serials.add(view.matchSerial);
      });
      const sh = v.show;
      expect(v.finished).toBe(true);
      expect(sh.kind).toBe("series");
      expect(Math.max(sh.score[0], sh.score[1])).toBe(2);
      expect(Math.min(sh.score[0], sh.score[1])).toBeLessThanOrEqual(1);
      expect(sh.games).toBeLessThanOrEqual(5);
      expect(sh.matchIndex + 1).toBe(sh.games);
      expect(serials.size).toBe(sh.games);
      expect(sh.winnerSide).toBe(sh.score[0] > sh.score[1] ? 0 : 1);
      // GAME n on every VS card, the series' verdict once
      expect(log.list.filter((b) => b.kind === FB_GAME).length).toBe(sh.games);
      expect(log.list.filter((b) => b.kind === FB_SERIES_WIN).length).toBe(1);
      // the winning side's team stats carry the show's win
      expect(engine.getTeamStats()[sh.winnerSide].escapes).toBeGreaterThan(0);
    }
  });

  it("replays a double KO inside a show as a REMATCH! (a series' void game, a bracket's bout again)", { timeout: 60_000 }, () => {
    for (const fl of [BO3, BRACKET8]) {
      const engine = probeEngine(fl, 4);
      const v = engine.getFightLeagueView();
      const log = bannerLog();
      // into the first fight, then both fighters down in the same step
      probeRun(engine, v.introMs + 3000);
      expect(v.matchOver).toBe(false);
      const pair = [v.show.a, v.show.b];
      for (const f of v.fighters) {
        f.alive = false;
        f.hp = 0;
      }
      probeRun(engine, v.timeMs + 4 * PROBE_STEP, (view) => log.read(view, view.matchSerial));
      expect(v.matchOver).toBe(true);
      expect(v.doubleKo).toBe(true);
      expect(v.finished).toBe(false);
      expect(v.show.rematchNext).toBe(true);
      // the interlude, then the same pairing again with REMATCH! on its card
      const before = v.matchSerial;
      probeRun(engine, v.timeMs + FL_INTERLUDE_FINALE_MS + 1000 * FL_CARD_SEC + 200, (view) => log.read(view, view.matchSerial));
      expect(v.matchSerial).toBe(before + 1);
      expect(v.show.matchIndex).toBe(1);
      expect(log.list.some((b) => b.kind === FB_REMATCH && b.serial === v.matchSerial)).toBe(true);
      if (fl === BO3) {
        expect(v.show.score).toEqual([0, 0]);
        expect(v.show.games).toBe(1);
      } else {
        expect([v.show.a, v.show.b]).toEqual(pair);
        expect(v.show.rematches).toBe(1);
        expect(v.show.bout).toBe(1);
      }
      expect(v.fighters.every((f) => f.alive && f.hp === f.maxHp)).toBe(true);
    }
    expect(FL_REMATCHES).toBe(2);
  });
});

/* ------------------------------------------------------------------ brackets */

describe("fight league brackets", () => {
  it("places the seeds the standard way (1v8, 4v5, 3v6, 2v7) and gives the byes to the top seeds", () => {
    expect(flSeedPlacement(2)).toEqual([1, 2]);
    const pairs = (order: number[]) => order.flatMap((s, i) => (i % 2 ? [] : [[Math.min(s, order[i + 1]), Math.max(s, order[i + 1])]]));
    expect(pairs(flSeedPlacement(4))).toEqual([[1, 4], [2, 3]]);
    expect(pairs(flSeedPlacement(8))).toEqual([[1, 8], [4, 5], [3, 6], [2, 7]]);
    expect(pairs(flSeedPlacement(16))).toEqual([[1, 16], [8, 9], [5, 12], [4, 13], [3, 14], [6, 11], [7, 10], [2, 15]]);
    const eight = flBuildBracket([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(eight.map((r) => r.length)).toEqual([4, 2, 1]);
    expect(eight[0].map((b) => [b.a + 1, b.b + 1])).toEqual([[1, 8], [4, 5], [3, 6], [2, 7]]);
    expect(flNextBout(eight)).toEqual({ r: 0, p: 0 });
    // 12 entrants: a bracket of 16 with 4 byes – the top four seeds go straight through
    const twelve = flBuildBracket(Array.from({ length: 12 }, (_, i) => i));
    expect(twelve[0].filter((b) => b.b === FL_BYE).map((b) => b.a + 1).sort((x, y) => x - y)).toEqual([1, 2, 3, 4]);
    expect(twelve[1].filter((b) => b.a >= 0 || b.b >= 0).length).toBe(4);
    expect([flBracketBouts(8), flBracketBouts(12), flBracketBouts(16)]).toEqual([7, 11, 15]);
  });

  it("plays an 8-bracket's 7 bouts by rating and crowns the final's winner", { timeout: 60_000 }, () => {
    const engine = probeEngine(BRACKET8, 3);
    const v = engine.getFightLeagueView();
    const sh = v.show;
    expect(sh.kind).toBe("bracket");
    expect(sh.entrants).toHaveLength(8);
    expect(sh.bouts).toBe(7);
    // the pinned slots first, the rest drawn from Thor's division; seeded by rating: 1v8, 4v5, 3v6, 2v7
    expect(sh.entrants.slice(0, 2).map((e) => [e.row.id, e.slot])).toEqual([["thor", 0], ["loki", 1]]);
    expect(sh.entrants.every((e) => e.row.division === "marvel")).toBe(true);
    const bySeed = [...sh.entrants].sort((a, b) => a.seed - b.seed);
    for (let i = 1; i < bySeed.length; i++) expect(flStrengthOf(bySeed[i - 1].row)).toBeGreaterThanOrEqual(flStrengthOf(bySeed[i].row));
    expect(sh.rounds[0].map((b) => [sh.entrants[b.a].seed, sh.entrants[b.b].seed])).toEqual([[1, 8], [4, 5], [3, 6], [2, 7]]);
    const log = bannerLog();
    runShow(engine, (view) => log.read(view, view.matchSerial));
    expect(v.finished).toBe(true);
    expect(sh.bout).toBe(7);
    expect(sh.rounds.every((r) => r.every((b) => b.winner >= 0))).toBe(true);
    expect(sh.champion).toBe(sh.rounds[sh.rounds.length - 1][0].winner);
    expect(sh.entrants.filter((e) => e.out)).toHaveLength(7);
    expect(sh.entrants[sh.champion].out).toBe(false);
    expect(sh.winnerSide).toBe(flPinnedSlots(THOR_LOKI).indexOf(sh.entrants[sh.champion].slot));
    expect(log.list.filter((b) => b.kind === FB_CHAMPION)).toHaveLength(1);
    // every bout's time cap: min(flT, 45 s) – then sudden death
    expect(v.capSec).toBe(Math.min(DEFAULT_FIGHT_LEAGUE_SETTINGS.timeCap, FL_BOUT_CAP_SEC));
    const summary = flRunSummary(v);
    expect(summary.championEntrant).toBe(sh.champion);
    expect(summary.gamesPlayed).toBe(sh.matchIndex + 1);
    expect(summary.gamesPlayed).toBeGreaterThanOrEqual(7);
  });

  it("plays a 16-bracket's 15 bouts and a 12-entrant bracket's 11 (4 byes)", { timeout: 120_000 }, () => {
    for (const [size, bouts] of [[16, 15], [12, 11]] as const) {
      const engine = probeEngine({ ...BRACKET8, bracketSize: size }, 5);
      const v = engine.getFightLeagueView();
      expect(v.show.entrants).toHaveLength(size);
      expect(v.show.bouts).toBe(bouts);
      probeRun(engine, FOREVER);
      expect(v.finished).toBe(true);
      expect([size, v.show.bout]).toEqual([size, bouts]);
      expect(v.show.entrants.filter((e) => e.out)).toHaveLength(size - 1);
      // Thor's division has 10 fighters: the rest come from its conference (Comics), never beyond
      expect(v.show.entrants.every((e) => conferenceOf(e.row.division) === "comics")).toBe(true);
      expect(new Set(v.show.entrants.map((e) => e.row.id)).size).toBe(size);
    }
  });

  it("draws every pool inside one division or conference (ids, random:, division:, conference: tokens; the ceiling)", () => {
    expect(parseFlEntrants("Thor, loki; random:Marvel division:DC conference:anime nobody random:wildcard")).toEqual(["thor", "loki", "random:marvel", "division:dc", "conference:anime"]);
    expect(sanitizeFlEntrants(" thor ,, nobody, RANDOM:shonen ")).toBe("thor,random:shonen");
    let u = 0;
    const random = () => (u = (u * 9301 + 49297) % 233280) / 233280;
    const marvel = { kind: "division" as const, id: "marvel" as FlDivision };
    const dc = drawFlEntrants({ pinned: [], tokens: ["division:dc"], size: 8, fill: marvel }, random);
    expect(dc.map((e) => e.row.division)).toEqual(Array(8).fill("dc"));
    const shonen = drawFlEntrants({ pinned: [{ row: FL_BY_ID.get("goku")!, slot: 0 }], tokens: ["random:shonen"], size: 16, fill: marvel }, random);
    expect(shonen[0]).toMatchObject({ slot: 0 });
    expect(shonen.every((e) => conferenceOf(e.row.division) === "anime")).toBe(true);
    const capped = drawFlEntrants({ pinned: [], tokens: [], size: 10_000, fill: marvel }, random);
    expect(capped).toHaveLength(FL_ENTRANT_CEILING);
    expect(capped.every((e) => conferenceOf(e.row.division) === "comics")).toBe(true);
    expect(MEMORY_CEILINGS.flBracketSize).toBe(FL_ENTRANT_CEILING);
    expect(MEMORY_CEILINGS.flBossWaves).toBe(FL_ENTRANT_CEILING);
    const order = flSeedOrder(dc, "listed", random);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // a random seeding is a permutation (n − 1 draws)
    expect([...flSeedOrder(dc, "random", random)].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });
});

/* ------------------------------------------------------------------ boss rush */

describe("fight league boss rush", () => {
  it("carries the boss's HP between waves, heals it in the interludes, turns PHASE 2 at half and ends either way", { timeout: 120_000 }, () => {
    expect(flBossRow("random").id).toBe("gerald");
    expect(flBossRow("vader").id).toBe("vader");
    expect(flSideNames("boss", ["gerald"], "Challengers")).toEqual(["A · Gerald", "Challengers"]);
    const endings = new Set<number>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = probeEngine(BOSS, seed);
      const v = engine.getFightLeagueView();
      const sh = v.show;
      expect(sh.kind).toBe("boss");
      expect(sh.waves).toBe(6);
      expect(sh.entrants).toHaveLength(7);
      expect(sh.entrants[0].row.id).toBe("gerald");
      expect(sh.entrants.slice(1).every((e) => e.row.division === "marvel")).toBe(true);
      const boss = () => v.fighters[0];
      expect(boss().boss).toBe(true);
      const plain = probeEngine({ fighters: ["gerald", "loki"] }, seed).getFightLeagueView().fighters[0];
      expect(boss().maxHp).toBeCloseTo(plain.maxHp * FL_BOSS.hp, 6);
      expect(boss().r).toBeCloseTo(plain.r * FL_BOSS.size, 6);
      const log = bannerLog();
      let serial = v.matchSerial;
      let endHp = -1;
      let checked = 0;
      let phase2At = -1;
      runShow(engine, (view) => {
        log.read(view, view.matchSerial);
        if (view.matchOver && endHp < 0 && !view.finished) endHp = view.show.bossHp;
        if (view.show.phase2 && phase2At < 0) phase2At = view.timeMs;
        if (view.matchSerial !== serial) {
          serial = view.matchSerial;
          // the next wave: the boss comes back with what it had plus the heal (no more than its maximum)
          const want = Math.min(view.show.bossMaxHp, endHp + view.settings.bossHeal * view.show.bossMaxHp);
          if (!view.show.rematchNext) expect(view.fighters[0].hp).toBeCloseTo(want, 6);
          checked++;
          endHp = -1;
        }
      });
      expect(v.finished).toBe(true);
      expect(checked).toBe(sh.matchIndex);
      if (phase2At >= 0) expect(log.list.filter((b) => b.kind === FB_PHASE2)).toHaveLength(1);
      if (sh.champion === 1) {
        expect(log.list.filter((b) => b.kind === FB_BOSS_FALLS)).toHaveLength(1);
        expect(sh.entrants[0].out).toBe(true);
        expect(flRunSummary(v).bossDefeated).toBe(sh.wave);
      } else {
        expect(sh.champion).toBe(0);
        expect(sh.wave).toBe(6);
        expect(log.list.filter((b) => b.kind === FB_BOSS_SURVIVES)).toHaveLength(1);
        expect(flRunSummary(v).bossDefeated).toBe(0);
      }
      expect(sh.winnerSide).toBe(sh.champion);
      endings.add(sh.champion);
    }
    expect([...endings].sort()).toEqual([0, 1]);
  });

  it("is balanced at the defaults: Gerald clears a 6-wave Marvel rush in 30–70 % of 20 seeds", { timeout: 300_000 }, () => {
    let clears = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const v = probeRun(probeEngine(BOSS, seed), FOREVER);
      expect(v.finished).toBe(true);
      if (v.show.champion === 0) clears++;
    }
    expect(clears).toBeGreaterThanOrEqual(6);
    expect(clears).toBeLessThanOrEqual(14);
  });
});

/* ------------------------------------------------------------------ story and win chance */

describe("fight league story and win chance", () => {
  it("tags a verdict PERFECT > UPSET > COMEBACK > CLUTCH (two at most)", () => {
    const none = { perfect: false, upset: false, comeback: false, clutch: false };
    expect(flStoryTags(none)).toEqual([]);
    expect(flStoryTags({ ...none, clutch: true, upset: true })).toEqual(["upset", "clutch"]);
    expect(flStoryTags({ perfect: true, upset: true, comeback: true, clutch: true })).toEqual(["perfect", "upset"]);
    expect(flStoryTags({ ...none, comeback: true, clutch: true }, 1)).toEqual(["comeback"]);
  });

  it("splits the win chance from the ratings, marks estimates and hides it under handicaps", () => {
    const tl = flWinChance(["thor"], ["loki"]);
    expect(tl.a + tl.b).toBeCloseTo(1, 12);
    expect(tl.est).toBe(false);
    expect(tl.a).toBeCloseTo(FL_STRENGTH.thor.strength / (FL_STRENGTH.thor.strength + FL_STRENGTH.loki.strength), 12);
    // across divisions, Gerald, teams: an even split per fighter, marked est.
    expect(flWinChance(["thor"], ["goku"])).toEqual({ a: 0.5, b: 0.5, est: true });
    expect(flWinChance(["gerald"], ["thor"]).est).toBe(true);
    const teams = flWinChance(["thor", "ironman"], ["loki", "hulk"]);
    expect(teams.est).toBe(true);
    expect(teams.a + teams.b).toBeCloseTo(1, 12);
    const ffa = flWinChances([[FL_BY_ID.get("thor")!], [FL_BY_ID.get("loki")!], [FL_BY_ID.get("hulk")!]]);
    expect(ffa.chances.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect([flChancePercent(0.616), flChancePercent(-1), flChancePercent(2)]).toEqual([62, 0, 100]);
    // on the VS card: shown at the defaults, hidden with any handicap ≠ 1 (BUFFED / NERFED instead) or with flOdds off
    const shown = probeEngine({ fighters: THOR_LOKI }, 3).getFightLeagueView().story;
    expect(shown.oddsShown).toBe(true);
    expect(shown.handicapped).toBe(false);
    expect(shown.chances[0]).toBeCloseTo(tl.a, 12);
    const buffed = probeEngine({ fighters: THOR_LOKI, damage: [1, 1.25, 1, 1, 1, 1] }, 3).getFightLeagueView().story;
    expect([buffed.handicapped, buffed.oddsShown]).toEqual([true, false]);
    const off = probeEngine({ fighters: THOR_LOKI, odds: false }, 3).getFightLeagueView().story;
    expect(off.oddsShown).toBe(false);
    // the data: flOdds empty when hidden
    const data = (view: FightLeagueView) => {
      const out: Record<string, string> = {};
      new FightLeagueDataset().write(view, new FightLeagueLayer(), (k, val) => (out[k] = val));
      return out;
    };
    expect(data(probeEngine({ fighters: THOR_LOKI }, 3).getFightLeagueView()).flOdds).toBe(`${flChancePercent(tl.a)},${flChancePercent(tl.b)}`);
    expect(data(probeEngine({ fighters: THOR_LOKI, damage: [1, 1.25, 1, 1, 1, 1] }, 3).getFightLeagueView()).flOdds).toBe("");
  });

  it("follows real fights: first blood once a match, lead changes with hysteresis, the verdict's story", { timeout: 120_000 }, () => {
    const seen = { clutch: 0, finisher: 0, ability: 0, leads: 0 };
    for (let seed = 1; seed <= 24; seed++) {
      const engine = probeEngine({ fighters: THOR_LOKI }, seed);
      const v = engine.getFightLeagueView();
      const log = bannerLog();
      let lead = -1;
      let changes = 0;
      runShow(engine, (view) => {
        log.read(view, view.matchSerial);
        if (view.matchOver || view.timeMs < view.introMs) return;
        // the lead bar's rule: the leader changes only FL_LEAD_HYSTERESIS clear of the old one
        const a = share(view, 0);
        const b = share(view, 1);
        const best = b > a + 1e-12 ? 1 : 0;
        const bestShare = Math.max(a, b);
        if (best === lead || bestShare >= 1 - 1e-9) return;
        const cur = lead === 0 ? a : lead === 1 ? b : -1;
        if (lead >= 0 && bestShare < cur + FL_LEAD_HYSTERESIS) return;
        if (lead >= 0) changes++;
        lead = best;
      });
      const st = v.story;
      expect(v.finished).toBe(true);
      expect(st.decided).toBe(true);
      expect(log.list.filter((b) => b.kind === FB_FIRST_BLOOD).length).toBe(st.firstBloodMs >= 0 ? 1 : 0);
      expect([seed, st.leadChanges]).toEqual([seed, changes]);
      if (v.winnerTeam >= 0) {
        expect(st.winnerHpFrac).toBeCloseTo(share(v, v.winnerTeam), 9);
        expect(st.clutch).toBe(!st.perfect && st.winnerHpFrac <= 0.1 + 1e-9);
        expect(st.upset).toBe(st.chances[v.winnerTeam] < 0.4 - 1e-9);
        expect(st.comeback).toBe(st.deficit[v.winnerTeam] >= FL_COMEBACK_DEFICIT - 1e-9);
        if (st.perfect) expect(v.fighters.filter((f) => f.team === v.winnerTeam).every((f) => f.lowestHpFrac === 1)).toBe(true);
        expect(st.tags).toEqual(flStoryTags(st));
      }
      if (!v.byTime && v.winnerTeam >= 0) {
        expect(st.finisher).not.toBe("");
        seen.finisher++;
      }
      if (st.abilityFinish) {
        expect(st.finisher.startsWith("weapon")).toBe(false);
        seen.ability++;
      }
      if (st.clutch) seen.clutch++;
      if (st.leadChanges > 0) seen.leads++;
    }
    expect(seen.finisher).toBeGreaterThan(10);
    expect(seen.clutch).toBeGreaterThan(0);
    expect(seen.leads).toBeGreaterThan(0);
  });

  it("starts every match of a show with its own story", { timeout: 60_000 }, () => {
    const engine = probeEngine(BO3, 2);
    const firstBloods = new Map<number, number>();
    probeRun(engine, FOREVER, (view) => {
      if (view.story.firstBloodMs >= 0) firstBloods.set(view.matchSerial, view.story.firstBloodMs);
    });
    const v = engine.getFightLeagueView();
    expect(firstBloods.size).toBe(v.show.games);
    // each match's first blood comes after its own start
    expect(Math.min(...firstBloods.values())).toBeGreaterThan(0);
    expect(new Set(firstBloods.values()).size).toBe(firstBloods.size);
  });
});

/* ------------------------------------------------------------------ finder */

describe("fight league finder outcomes", () => {
  const base: RunSummary = { mode: "fightLeague", durationMs: 20_000, finished: true, firstEscapeMs: -1, teams: [] };
  const fl = (patch: Partial<FlRunSummary> = {}): FlRunSummary => ({ show: "single", upset: false, comeback: false, perfect: false, clutch: false, leadChanges: 0, finisher: "", abilityFinish: false, bothLowMs: -1, championEntrant: -1, championSide: -1, gamesPlayed: 1, bossDefeated: 0, decider: false, sudden: false, winnerHpFrac: 0.5, ...patch });
  const o = (kind: FinderOutcomeKind, patch: Partial<FinderOutcome> = {}): FinderOutcome => ({ kind, clipSec: 30, ...patch });

  it("matches and misses every story outcome on synthetic runs", () => {
    const flags: [FinderOutcomeKind, Partial<FlRunSummary>][] = [["upset", { upset: true }], ["clutch", { clutch: true }], ["perfect", { perfect: true }], ["comeback", { comeback: true }], ["ability-finish", { abilityFinish: true, finisher: "ability:Mjolnir Storm" }], ["decider", { decider: true }], ["sudden", { sudden: true }]];
    for (const [kind, yes] of flags) {
      expect([kind, outcomeMatches(o(kind), { ...base, fl: fl(yes) })]).toEqual([kind, true]);
      expect([kind, outcomeMatches(o(kind), { ...base, fl: fl() })]).toEqual([kind, false]);
      expect([kind, outcomeMatches(o(kind), { ...base, finished: false, fl: fl(yes) })]).toEqual([kind, false]);
      expect([kind, outcomeMatches(o(kind), base)]).toEqual([kind, false]);
      expect([kind, outcomeMiss(o(kind), { ...base, fl: fl(yes) }), outcomeMiss(o(kind), { ...base, fl: fl() })]).toEqual([kind, 0, 1]);
      expect(outcomeHorizonMs(o(kind), 90_000, "fightLeague")).toBe(90_000);
    }
    // lead changes: at least the count
    expect(outcomeMatches(o("lead-changes", { count: 3 }), { ...base, fl: fl({ leadChanges: 3 }) })).toBe(true);
    expect(outcomeMatches(o("lead-changes", { count: 3 }), { ...base, fl: fl({ leadChanges: 2 }) })).toBe(false);
    expect(outcomeMiss(o("lead-changes", { count: 3 }), { ...base, fl: fl({ leadChanges: 1 }) })).toBe(2);
    // the cliffhanger: within ±0.5 s of its target, and the clip is cut there
    const low = { ...base, finished: false, fl: fl({ bothLowMs: 12_300 }) };
    expect(outcomeMatches(o("both-low-at", { atSec: 12 }), low)).toBe(true);
    expect(outcomeMatches(o("both-low-at", { atSec: 13 }), low)).toBe(false);
    expect(outcomeMiss(o("both-low-at", { atSec: 13 }), low)).toBeCloseTo(0.7, 9);
    expect(outcomeClipSec(o("both-low-at", { atSec: 12 }), low)).toBeCloseTo(12.3, 9);
    expect(outcomeFigure(o("both-low-at", { atSec: 12 }), low)).toBeCloseTo(12.3, 9);
    expect(outcomeHorizonMs(o("both-low-at", { atSec: 12 }), 90_000, "fightLeague")).toBeLessThan(90_000);
    // a bracket's champion: a pinned side; the boss falling at a wave
    expect(outcomeMatches(o("champion", { team: 1 }), { ...base, fl: fl({ show: "bracket", championEntrant: 1, championSide: 1 }) })).toBe(true);
    expect(outcomeMatches(o("champion", { team: 0 }), { ...base, fl: fl({ show: "bracket", championEntrant: 5, championSide: -1 }) })).toBe(false);
    expect(outcomeMatches(o("boss-falls-at", { count: 4 }), { ...base, fl: fl({ show: "boss", bossDefeated: 4 }) })).toBe(true);
    expect(outcomeMatches(o("boss-falls-at", { count: 4 }), { ...base, fl: fl({ show: "boss", bossDefeated: 0 }) })).toBe(false);
    expect(outcomeMiss(o("boss-falls-at", { count: 4 }), { ...base, fl: fl({ show: "boss", bossDefeated: 6 }) })).toBe(2);
    // close: the winner's HP share as the margin
    expect(outcomeMatches(o("close"), { ...base, teams: [{} as never, {} as never], margin: 0.08 })).toBe(true);
  });

  it("offers the story outcomes per format (double-ko only for one match)", () => {
    const ctx = { endless: false, neverEscape: false, ballCount: 2 };
    const single = availableOutcomes("fightLeague", ctx);
    expect(single).toEqual(expect.arrayContaining(["double-ko", "upset", "clutch", "perfect", "comeback", "ability-finish", "lead-changes", "both-low-at", "sudden"]));
    expect(single).not.toContain("decider");
    expect(single).not.toContain("champion");
    const series = availableOutcomes("fightLeague", { ...ctx, flShow: "series" });
    expect(series).toContain("decider");
    expect(series).not.toContain("double-ko");
    const bracket = availableOutcomes("fightLeague", { ...ctx, flShow: "bracket", flSides: 2 });
    expect(bracket).toContain("champion");
    expect(bracket).not.toContain("decider");
    expect(availableOutcomes("fightLeague", { ...ctx, flShow: "bracket", flSides: 2, flDecider: true })).toContain("decider");
    expect(availableOutcomes("fightLeague", { ...ctx, flShow: "boss", flSides: 2 })).toContain("boss-falls-at");
    // the shows' horizons and batches
    expect(flShowBouts({ match: "1v1", bestOf: 1, bracketSize: 8, bossWaves: 6 })).toBe(1);
    expect(flShowBouts({ match: "1v1", bestOf: 3, bracketSize: 8, bossWaves: 6 })).toBe(5);
    expect(flShowBouts({ match: "bracket", bestOf: 1, bracketSize: 8, bossWaves: 6 })).toBe(7);
    expect(flShowBouts({ match: "boss", bestOf: 1, bracketSize: 8, bossWaves: 6 })).toBe(6);
    expect(flShowHorizonMs({ match: "bracket", bestOf: 1, bracketSize: 16, bossWaves: 6 })).toBe(15 * 90_000);
    expect([flFinderBatch({ match: "1v1", bestOf: 1 }), flFinderBatch({ match: "1v1", bestOf: 3 }), flFinderBatch({ match: "bracket", bestOf: 1 }), flFinderBatch({ match: "boss", bestOf: 1 })]).toEqual([4, 2, 1, 1]);
    expect(flSideCount("bracket", THOR_LOKI)).toBe(2);
    expect(flSideCount("boss", ["gerald"])).toBe(2);
    expect(effectiveBallCount({ ...defaultSettings("fightLeague"), flMatch: "bracket", flFighterA: "thor", flFighterB: "loki", flFighterC: "hulk" })).toBe(3);
  });

  it("finds clutch, perfect and an ability finish for Thor vs Loki within 400 seeds (and replays them)", { timeout: 240_000 }, async () => {
    // (PERFECT is rare at the default 100 HP – a fighter untouched while it deals 100: the search runs at 40 HP)
    for (const [kind, extra] of [["clutch", {}], ["ability-finish", {}], ["perfect", { hp: 40 }]] as const) {
      const fl: Fl = { fighters: THOR_LOKI, ...extra };
      const found = await withFrames(() => findSimulation(finderRequest(fl, { outcome: o(kind) }), () => undefined));
      expect([kind, found.found]).toEqual([kind, true]);
      const v = probeRun(probeEngine(fl, found.seed), FOREVER);
      const st = v.story;
      expect([kind, kind === "clutch" ? st.clutch : kind === "perfect" ? st.perfect : st.abilityFinish]).toEqual([kind, true]);
    }
  });

  it("finds a cliffhanger (both low with the fight on) and cuts the clip there", { timeout: 120_000 }, async () => {
    // a run that has one: its moment is the target
    let target = -1;
    for (let seed = 1; seed <= 40 && target < 0; seed++) {
      const run = simulateOutcomeRun(seed, finderRequest({ fighters: THOR_LOKI }), o("clutch"));
      if (run.fl && run.fl.bothLowMs >= 0) target = run.fl.bothLowMs / 1000;
    }
    expect(target).toBeGreaterThan(0);
    const found = await withFrames(() => findSimulation(finderRequest({ fighters: THOR_LOKI }, { maxSeeds: 60, outcome: o("both-low-at", { atSec: Math.round(target) }) }), () => undefined));
    expect(found.found).toBe(true);
    expect(Math.abs(found.duration - Math.round(target))).toBeLessThanOrEqual(0.5 + 1e-6);
  });

  it("finds a chosen 8-bracket champion within 60 seeds and stops a seed once its entrant is out", { timeout: 300_000 }, async () => {
    const request = finderRequest(BRACKET8, { maxSeeds: 60, outcome: o("champion", { team: 0 }) });
    expect(request.maxSimTimeSec).toBe(7 * 90);
    const found = await withFrames(() => findSimulation(request, () => undefined));
    expect(found.found).toBe(true);
    const v = probeRun(probeEngine(BRACKET8, found.seed), FOREVER);
    expect(v.show.entrants[v.show.champion].row.id).toBe("thor");
    expect(v.show.winnerSide).toBe(0);
    // a seed Thor goes out early in: the search stops following it there ("eliminated from the show")
    for (let seed = 1; seed <= 12; seed++) {
      const run = simulateOutcomeRun(seed, request, o("champion", { team: 0 }));
      if (run.fl && run.fl.championSide !== 0 && !run.finished) {
        expect(run.durationMs).toBeLessThan(flShowHorizonMs({ match: "bracket", bestOf: 1, bracketSize: 8, bossWaves: 6 }));
        return;
      }
    }
  });
});

/* ------------------------------------------------------------------ the rig */

describe("fight league rig per format", () => {
  /** Runs a rigged show to its end, noting every match that ended in a double KO. */
  const rigged = (fl: Fl, seed: number, side: number) => {
    const engine = probeEngine(fl, seed, { forcedWinner: side });
    let doubles = 0;
    let lastSerial = -1;
    const v = probeRun(engine, FOREVER, (view) => {
      if (view.matchOver && view.doubleKo && view.matchSerial !== lastSerial) {
        doubles++;
        lastSerial = view.matchSerial;
      }
    });
    return { v, doubles, engine };
  };

  it("crowns a forced champion of an 8-bracket on 6 seeds, never in a double KO", { timeout: 120_000 }, () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { v, doubles } = rigged(BRACKET8, seed, 0);
      expect([seed, v.finished, v.show.entrants[v.show.champion].row.id, v.show.winnerSide, doubles]).toEqual([seed, true, "thor", 0, 0]);
    }
  });

  it("wins a forced Bo3 on 6 seeds – engaging only when the rival could clinch, so some go 2–1", { timeout: 120_000 }, () => {
    let lost = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { v, doubles } = rigged(BO3, seed, 1);
      expect([seed, v.finished, v.show.winnerSide, v.show.score[1], doubles]).toEqual([seed, true, 1, 2, 0]);
      lost += v.show.score[0];
    }
    expect(lost).toBeGreaterThanOrEqual(1);
  });

  it("forces the boss (3/3) and the challengers (3/3)", { timeout: 180_000 }, () => {
    for (const side of [0, 1]) {
      for (const seed of [1, 2, 3]) {
        const { v, doubles } = rigged(BOSS, seed, side);
        expect([side, seed, v.finished, v.show.champion, doubles]).toEqual([side, seed, true, side, 0]);
        // PERFECT never shows for a winner whose lethal hits were absorbed
        if (v.rigAbsorbed > 0 && v.story.perfect) expect(v.rigAbsorbed).toBe(0);
      }
    }
  });

  it("replays a rigged show exactly", { timeout: 120_000 }, () => {
    for (const fl of [BRACKET8, BO3]) {
      const a = fingerprint(rigged(fl, 2, 0).v);
      const b = fingerprint(rigged(fl, 2, 0).v);
      expect(a).toBe(b);
    }
  });
});

/* ------------------------------------------------------------------ settings, URL, presets */

describe("fight league show settings, URL and presets", () => {
  it("round-trips every new key through the URL and writes nothing at the defaults", () => {
    const base = defaultSettings("fightLeague");
    const plain = settingsToSearchParams(base);
    for (const key of ["fl5", "fl6", "flBo", "flE", "flBr", "flSd", "flBw", "flBoss", "flBh", "flCard", "flOd", "flS5", "flS6", "flD5", "flD6", "flX5", "flX6", "flC5", "flC6"]) {
      expect([key, FIGHT_LEAGUE_URL_KEYS.includes(key)]).toEqual([key, true]);
      expect([key, plain.has(key)]).toEqual([key, false]);
    }
    const s: SimulatorSettings = { ...base, flMatch: "bracket", flFighterE: "hulk", flFighterF: "random:dc", flSpeedE: 1.5, flSpeedF: 0.5, flDamageE: 2, flDamageF: 0.3, flAttackE: 1.2, flAttackF: 0.9, flCastE: 4, flCastF: 0.2, flBestOf: 5, flEntrants: "thor,random:marvel,division:dc", flBracketSize: 12, flSeeding: "listed", flBossWaves: 9, flBossHp: 4.5, flBossHeal: 0.35, flCardSec: 0, flOdds: false };
    const params = settingsToSearchParams(s);
    expect([params.get("flM"), params.get("fl5"), params.get("fl6"), params.get("flBo"), params.get("flE"), params.get("flBr"), params.get("flSd"), params.get("flBw"), params.get("flBoss"), params.get("flBh"), params.get("flCard"), params.get("flOd"), params.get("flC5")]).toEqual(["bracket", "hulk", "random:dc", "5", "thor,random:marvel,division:dc", "12", "listed", "9", "4.5", "0.35", "0", "0", "4"]);
    const back = settingsFromSearchParams(params);
    for (const key of ["flMatch", "flFighterE", "flFighterF", "flSpeedE", "flSpeedF", "flDamageE", "flDamageF", "flAttackE", "flAttackF", "flCastE", "flCastF", "flBestOf", "flEntrants", "flBracketSize", "flSeeding", "flBossWaves", "flBossHp", "flBossHeal", "flCardSec", "flOdds"] as const) expect([key, back[key]]).toEqual([key, s[key]]);
    for (const match of ["3v3", "boss"] as const) expect(settingsFromSearchParams(settingsToSearchParams({ ...base, flMatch: match })).flMatch).toBe(match);
    // invalid values read back as the defaults (an unknown token dropped from the list)
    const bad = settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flSd=best&fl5=nobody&flE=nobody,thor&flM=4v4"));
    expect([bad.flSeeding, bad.flFighterE, bad.flEntrants, bad.flMatch]).toEqual(["rating", "random", "thor", "1v1"]);
    // the comfort ranges; every number uncapped from its minimum
    expect([FIGHT_LEAGUE_RANGES.flBestOf.min, FIGHT_LEAGUE_RANGES.flBestOf.max, FIGHT_LEAGUE_RANGES.flBracketSize.max, FIGHT_LEAGUE_RANGES.flBossWaves.max, FIGHT_LEAGUE_RANGES.flBossHp.max, FIGHT_LEAGUE_RANGES.flBossHeal.max, FIGHT_LEAGUE_RANGES.flCardSec.max]).toEqual([1, 7, 16, 10, 6, 1, 5]);
    const big = settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flBo=21&flBr=64&flBw=40&flBoss=20&flBh=3&flCard=12"));
    expect([big.flBestOf, big.flBracketSize, big.flBossWaves, big.flBossHp, big.flBossHeal, big.flCardSec]).toEqual([21, 64, 40, 20, 3, 12]);
  });

  it("keeps six slots everywhere (letters, defaults, handicaps)", () => {
    expect(FL_MAX_SLOTS).toBe(6);
    expect(FL_SLOT_LETTERS).toEqual(["A", "B", "C", "D", "E", "F"]);
    for (const list of [DEFAULT_FIGHT_LEAGUE_SETTINGS.fighters, DEFAULT_FIGHT_LEAGUE_SETTINGS.speed, DEFAULT_FIGHT_LEAGUE_SETTINGS.damage, DEFAULT_FIGHT_LEAGUE_SETTINGS.attack, DEFAULT_FIGHT_LEAGUE_SETTINGS.cast]) expect(list).toHaveLength(6);
    expect([flPanelSlots("1v1"), flPanelSlots("2v2"), flPanelSlots("ffa4"), flPanelSlots("3v3"), flPanelSlots("bracket"), flPanelSlots("boss")]).toEqual([2, 4, 4, 6, 6, 6]);
  });

  it("offers the shows' presets inside one division (a bracket inside one conference) and applies them", () => {
    const shows = FL_PRESETS.slice(50);
    const count = (f: string) => shows.filter((p) => p.format === f).length;
    expect([count("series"), count("bracket"), count("boss"), shows.filter((p) => p.match === "3v3").length, count("rework")]).toEqual([10, 5, 4, 3, 4]);
    expect(FL_PRESET_FORMATS).toEqual(expect.arrayContaining(["duel", "series", "team", "ffa", "bracket", "boss", "rework"]));
    expect(shows.find((p) => p.id === "thor-loki-bo3")).toMatchObject({ fighters: ["thor", "loki"], bestOf: 3 });
    const conferenceOfToken = (token: string): FlConference | null => {
      const id = token.split(":").pop()!;
      if (id in FL_CONFERENCES) return id as FlConference;
      const row = FL_BY_ID.get(id);
      return conferenceOf((row ? row.division : id) as FlDivision);
    };
    for (const p of shows) {
      const ids = p.fighters.filter((id) => !id.startsWith("random"));
      if (p.format === "bracket") {
        const conferences = new Set([...ids.map((id) => conferenceOf(FL_BY_ID.get(id)!.division)), ...parseFlEntrants(p.entrants).map(conferenceOfToken)]);
        expect([p.id, conferences.size]).toEqual([p.id, 1]);
      } else if (p.format === "boss") {
        expect(p.fighters).toEqual(["gerald"]);
        const pools = new Set(parseFlEntrants(p.entrants).map((t) => t.split(":").pop()));
        expect([p.id, pools.size]).toEqual([p.id, 1]);
      } else {
        expect([p.id, new Set(ids.map((id) => FL_BY_ID.get(id)!.division)).size]).toEqual([p.id, 1]);
        expect(p.fighters).toHaveLength(matchFighters(p.match));
      }
      // the panel applies it and recognises it
      const s = { ...defaultSettings("fightLeague"), ...flPresetPatch(p, defaultSettings("fightLeague")) } as SimulatorSettings;
      expect([p.id, flCurrentPreset(s)?.id]).toEqual([p.id, p.id]);
    }
    expect(flCurrentPreset(defaultSettings("fightLeague"))?.id).toBe("thor-loki");
    const loki = FL_PRESETS.find((p) => p.id === "loki-buffed")!;
    const patched = { ...defaultSettings("fightLeague"), ...flPresetPatch(loki, defaultSettings("fightLeague")) } as SimulatorSettings;
    expect([patched.flFighterA, patched.flFighterB, patched.flDamageB, patched.flDamageA]).toEqual(["thor", "loki", 1.25, 1]);
  });

  it("estimates a show's clip length and translates every new key (en, pl, es)", () => {
    expect(flExpectedClipSec(1)).toBeCloseTo(1.5 + 17 + 4.2, 9);
    expect(flExpectedClipSec(7)).toBeGreaterThan(120);
    expect(flClockText(150)).toBe("2:30");
    const keys = { Controls: ["flMatch3v3", "flMatchBracket", "flMatchBoss", "flBestOf", "flBestOfTip", "flEntrants", "flEntrantsTip", "flBracketSize", "flBracketSizeTip", "flSeeding", "flSeedingTip", "flBossWaves", "flBossWavesTip", "flBossHp", "flBossHpTip", "flBossHeal", "flBossHealTip", "flCardSec", "flCardSecTip", "flOdds", "flOddsTip", "flPresetFormat_series", "flPresetFormat_bracket", "flPresetFormat_boss", "flPresetFormat_rework", "flSurprise", "flSurpriseTip"], FightLeague: ["canvasUpset", "canvasComeback", "canvasFinish", "canvasGame", "canvasSeriesPoint", "canvasSeriesWin", "canvasRematch", "canvasRound_r16", "canvasRound_qf", "canvasRound_sf", "canvasRound_final", "canvasChampion", "canvasBossFalls", "canvasBossSurvives", "canvasWave", "canvasPhase2", "canvasChallenger", "canvasUnderdog", "canvasBuffed", "canvasNerfed", "canvasWinChance", "canvasEst"] } as const;
    for (const [ns, list] of Object.entries(keys)) {
      for (const messages of [en, pl, es] as Record<string, Record<string, unknown>>[]) {
        for (const key of list) expect([ns, key, typeof messages[ns][key]]).toEqual([ns, key, "string"]);
      }
    }
    expect(en.FightLeague.canvasWinChance).toBe("win chance (simulated)");
    for (const word of ["odds", "bet", "wager"]) expect(en.FightLeague.canvasWinChance.toLowerCase()).not.toContain(word);
  });
});

/* ------------------------------------------------------------------ goldens and the grep */

describe("fight league show replays", () => {
  /** Golden fingerprints of every format at a fixed time (seed 7): a change of the rules shows here. */
  const FORMATS: { name: string; fl: Fl; atMs: number; golden: string }[] = [
    { name: "1v1", fl: { fighters: THOR_LOKI }, atMs: 18_000, golden: "493c5dc1" },
    { name: "Bo3", fl: BO3, atMs: 45_000, golden: "60514b05" },
    // --- fl-heavy --- (Stop The World) the 8-bracket, boss rush and 3v3 goldens re-recorded (Received values pasted): the bracket
    // and the rush draw random fighters from the retuned rows and the Avengers 3v3 fields Thanos (The Snap 30, fists 9) and faces
    // Hulk's division; Thor vs Loki (1v1, Bo3) are untouched and keep their hashes.
    { name: "8-bracket", fl: BRACKET8, atMs: 70_000, golden: "86d50abf" },
    { name: "boss rush", fl: BOSS, atMs: 60_000, golden: "e5048605" },
    { name: "3v3", fl: TRIO, atMs: 20_000, golden: "20c26aee" },
  ];

  it("replays every format exactly at 60, 144 and 30 fps", { timeout: 180_000 }, () => {
    const prints: Record<string, string> = {};
    for (const f of FORMATS) {
      const at = [PROBE_STEP, 1000 / 144, 1000 / 30].map((frame) => fingerprint(runTo(probeEngine(f.fl, 7), f.atMs, frame)));
      expect([f.name, new Set(at).size]).toEqual([f.name, 1]);
      prints[f.name] = at[0];
    }
    expect(Object.fromEntries(FORMATS.map((f) => [f.name, prints[f.name]]))).toEqual(Object.fromEntries(FORMATS.map((f) => [f.name, f.golden])));
  });

  it("leaves no 4-slot leftovers ('& 3' masks, length-4 scratch arrays) in the mode or its renderer", () => {
    const files = [join("src", "lib", "physics", "modes", "fightLeague.ts"), ...readdirSync(join("src", "components", "simulator", "fightLeague")).filter((f) => f.endsWith(".ts")).map((f) => join("src", "components", "simulator", "fightLeague", f))];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of [/& 3\b/, /Float64Array\(4\)/, /\[0, 0, 0, 0\]/]) expect([file, pattern.source, pattern.test(text)]).toEqual([file, pattern.source, false]);
    }
  });
});
