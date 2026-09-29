import { describe, expect, it } from "vitest";
import type { PhysicsEngine } from "@/lib/physics/engine";
import {
  ARENA_GAME_MODES,
  ARENA_GAME_RANGES,
  ARENA_SOUNDS_PER_FRAME,
  ARENA_WIN_HOLD_SEC,
  ArenaSoundBudget,
  CTF_FINALE_SEC,
  DEFAULT_BATTLE_SETTINGS,
  DEFAULT_CTF_SETTINGS,
  FANFARE,
  HUD_BAND,
  MAX_NUDGE,
  MIN_WALL_ANGLE,
  WALL_LEFT,
  WALL_TOP,
  arenaFoundClipSec,
  battleSettingsOf,
  boxWallPass,
  buildArenaField,
  circleWallPass,
  ctfFinderSettings,
  ctfSettingsOf,
  ctfTimeLimitSec,
  defaultArenaGameFields,
  isArenaGameMode,
  offAxisAngle,
  resolveArenaGameFields,
  resolveBattleSettings,
  resolveCtfSettings,
  resolveSquarePair,
  steerToward,
  type ArenaBase,
  type ArenaFlag,
  type PairContact,
  type SquareBody,
  type WallContact,
} from "@/lib/physics/modes/arenaGames";
import {
  HEAL_FRACTION,
  MAX_DAMAGE_REL,
  MIN_DAMAGE_REL,
  MIN_SCALE,
  SHIELD_SEC,
  SHRINK_PER_DAMAGE,
  SHRINK_SEC,
  SHRINK_START_SEC,
  SPEED_SEC,
  ZONE_MIN,
  applyHit,
  applyPowerUp,
  battleOutcome,
  battleSquareHalf,
  battleUnit,
  collisionDamage,
  createFighter,
  zoneScaleAt,
} from "@/lib/physics/modes/battle";
import { FLAG_RETURN_SEC, captureFlag, ctfBases, ctfOutcome, dropFlag, flagHome, flagTimedOut, insideBase, touchFlag } from "@/lib/physics/modes/ctf";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { createEngineForSettings, fixedRunDurationSec, runNeverFinishes, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { RANGES, defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";

/* ------------------------------------------------------------------ helpers */

const config: PhysicsConfig = { width: 900, height: 900, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

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

function battleEngine(settings: Parameters<typeof resolveBattleSettings>[0] = {}, seed = 7, patch: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...patch }, "battle", { ...modeSettings, battle: settings ?? {} }, seed);
}

function ctfEngine(settings: Parameters<typeof resolveCtfSettings>[0] = {}, seed = 7, patch: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...patch }, "ctf", { ...modeSettings, ctf: settings ?? {} }, seed);
}

/** Runs until the game is over (or `maxSec`), collecting every sound event; returns the events and the length. */
function play(engine: PhysicsEngine, maxSec = 180, onStep?: (engine: PhysicsEngine) => void) {
  const events: SoundEvent[] = [];
  let t = 0;
  while (t < maxSec * 1000 && !engine.isSimulationFinished()) {
    engine.update(STEP, 0);
    t += STEP;
    events.push(...engine.consumeSoundEvents());
    onStep?.(engine);
  }
  return { events, sec: t / 1000 };
}

function square(x: number, y: number, vx: number, vy: number, radius: number): SquareBody {
  return { x, y, vx, vy, radius };
}

const contact = (): PairContact => ({ nx: 0, ny: 0, approach: 0, speedA: 0, speedB: 0 });
const wallContact = (): WallContact => ({ wall: -1, approach: 0, nx: 0, ny: 0 });

/* ------------------------------------------------------------------ registration and settings */

describe("arena games: registration", () => {
  it("adds both modes to the rhythm family, after the Circle Illusion", () => {
    for (const mode of ARENA_GAME_MODES) {
      expect(MODE_IDS).toContain(mode);
      expect(MODE_CATEGORIES[mode]).toBe("rhythm");
      expect(modesInCategory("rhythm")).toContain(mode);
      expect(isArenaGameMode(mode)).toBe(true);
    }
    expect(isArenaGameMode("classic")).toBe(false);
    expect(MODE_CARD_ORDER.indexOf("battle")).toBe(MODE_CARD_ORDER.indexOf("illusion") + 1);
    expect(MODE_CARD_ORDER.indexOf("ctf")).toBe(MODE_CARD_ORDER.indexOf("battle") + 1);
    expect(new Set(MODE_CARD_ORDER).size).toBe(MODE_CARD_ORDER.length);
  });

  it("the finder builds both modes and searches them (neither is endless nor of a fixed length)", () => {
    for (const mode of ARENA_GAME_MODES) {
      const engine = createEngineForSettings(config, mode, modeSettings, 3);
      expect(engine.getCurrentModeName()).toBe(mode);
      expect(engine.getArenaView()?.game).toBe(mode);
      expect(runNeverFinishes(mode, modeSettings)).toBe(false);
      expect(fixedRunDurationSec(mode, modeSettings)).toBeNull();
    }
    expect(createEngineForSettings(config, "classic", modeSettings, 3).getArenaView()).toBeNull();
  });
});

describe("arena games: settings", () => {
  it("resolve: clamps numbers onto their steps and falls back on junk", () => {
    expect(resolveBattleSettings(null)).toEqual(DEFAULT_BATTLE_SETTINGS);
    expect(resolveBattleSettings({ count: 99, hp: 1, damage: 1.37, nudge: 0.33 })).toMatchObject({ count: 20, hp: 3, damage: 1.25, nudge: 0.35 });
    const junk = { count: "x", arena: "hexagon", shrink: "yes", powerUps: 1 } as unknown as Parameters<typeof resolveBattleSettings>[0];
    expect(resolveBattleSettings(junk)).toEqual(DEFAULT_BATTLE_SETTINGS);
    expect(resolveCtfSettings({ perTeam: 9, scoreToWin: 0, clipSeconds: 500 })).toMatchObject({ perTeam: 4, scoreToWin: 1, clipSeconds: 120 });
    expect(resolveCtfSettings(undefined)).toEqual(DEFAULT_CTF_SETTINGS);
    for (const key of Object.keys(ARENA_GAME_RANGES) as (keyof typeof ARENA_GAME_RANGES)[]) expect(RANGES[key]).toEqual(ARENA_GAME_RANGES[key]);
  });

  it("are the defaults in every mode and stay out of the URL", () => {
    for (const mode of MODE_IDS) {
      const d = defaultSettings(mode);
      expect(battleSettingsOf(d)).toEqual(DEFAULT_BATTLE_SETTINGS);
      expect(ctfSettingsOf({ ...d, recordingDuration: 30 })).toEqual(DEFAULT_CTF_SETTINGS);
      const params = settingsToSearchParams(d);
      for (const key of ["btn", "bthp", "btd", "bta", "bts", "btp", "ctfn", "ctfw", "arn"]) expect(params.has(key)).toBe(false);
    }
  });

  it("round-trip through the URL and presets; bad values fall back", () => {
    const s = { ...defaultSettings("battle"), btCount: 14, btHp: 6, btDamage: 2.5, btArena: "circle" as const, btShrink: false, btPowerUps: false, ctfPerTeam: 3, ctfScoreToWin: 5, arenaNudge: 0.8 };
    const params = settingsToSearchParams(s);
    expect(params.get("btn")).toBe("14");
    expect(params.get("bta")).toBe("circle");
    expect(params.get("bts")).toBe("0");
    expect(params.get("arn")).toBe("0.8");
    const back = settingsFromSearchParams(params);
    expect(resolveArenaGameFields(back)).toEqual(resolveArenaGameFields(s));
    const bad = settingsFromSearchParams(new URLSearchParams("mode=ctf&ctfn=0&ctfw=99&bta=square&arn=-3&btd=abc"));
    expect(bad).toMatchObject({ ctfPerTeam: 1, ctfScoreToWin: 10, btArena: "box", arenaNudge: 0, btDamage: 1 });
    const preset = presetToSettings({ mode: "battle", btCount: 1000, btArena: "moon" as never, btShrink: "no" as never });
    expect(preset).toMatchObject({ btCount: 20, btArena: "box", btShrink: true });
    expect(resolveArenaGameFields({})).toEqual(defaultArenaGameFields());
  });

  it("capture the flag follows the clip length; the finder raises it past its target, and a found run keeps its clip", () => {
    expect(ctfTimeLimitSec(30)).toBe(30 - CTF_FINALE_SEC);
    expect(ctfTimeLimitSec(6)).toBe(5);
    expect(ctfSettingsOf({ ...defaultArenaGameFields(), recordingDuration: 45 }).clipSeconds).toBe(45);
    expect(ctfFinderSettings(DEFAULT_CTF_SETTINGS, 30, 0.5).clipSeconds).toBe(35);
    expect(ctfFinderSettings({ ...DEFAULT_CTF_SETTINGS, clipSeconds: 90 }, 30, 0.5).clipSeconds).toBe(90);
    expect(ctfFinderSettings(DEFAULT_CTF_SETTINGS, 120, 0.5).clipSeconds).toBe(120);
    // A battle (or a game won on the score) gets its length plus the winner banner's hold…
    expect(arenaFoundClipSec("battle", 27.3, 30)).toBe(Math.ceil(27.3 + ARENA_WIN_HOLD_SEC));
    expect(arenaFoundClipSec("ctf", 20.02, 35)).toBe(24);
    expect(arenaFoundClipSec("battle", 2, 30)).toBe(10);
    // …and a capture-the-flag game that ended on time keeps its clip (a longer one would move the time limit).
    expect(arenaFoundClipSec("ctf", ctfTimeLimitSec(40) + 0.01, 40)).toBe(40);
  });
});

/* ------------------------------------------------------------------ the maths */

describe("arena games: the field and the collision maths", () => {
  it("lays the box and the circle out in the centred square under the scoreboard band", () => {
    for (const kind of ["box", "circle"] as const) {
      const f = buildArenaField(1200, 800, kind);
      expect(f.side).toBe(800);
      expect(f.cx).toBe(600);
      expect(f.hudHeight).toBeCloseTo(HUD_BAND * 800, 9);
      expect(f.cy - f.halfH).toBeGreaterThanOrEqual(f.hudTop + f.hudHeight - 1e-9);
      expect(f.cy + f.halfH).toBeLessThanOrEqual(800);
      expect(f.cx - f.halfW).toBeGreaterThanOrEqual(200);
      expect(f.cx + f.halfW).toBeLessThanOrEqual(1000);
      if (kind === "circle") expect(f.halfW).toBe(f.halfH);
    }
  });

  it("square pairs: no contact apart, the overlap pushed out along the shallow axis, equal squares swap their velocities", () => {
    const out = contact();
    expect(resolveSquarePair(square(0, 0, 0, 0, 10), square(30, 0, 0, 0, 10), 1, out)).toBe(false);
    // Overlapping by 4 px in x and 16 px in y (offset 16, 4): the x axis is the shallow one.
    const a = square(0, 0, 200, 50, 10);
    const b = square(16, 4, -100, 30, 10);
    expect(resolveSquarePair(a, b, 1, out)).toBe(true);
    expect(out.nx).toBe(1);
    expect(out.ny).toBe(0);
    expect(out.approach).toBeCloseTo(300, 9);
    expect(b.x - a.x).toBeCloseTo(20, 9);
    expect(a.vx).toBeCloseTo(-100, 9);
    expect(b.vx).toBeCloseTo(200, 9);
    expect(a.vy).toBe(50);
    expect(b.vy).toBe(30);
    // Separating squares are only pushed apart.
    const c = square(0, 0, -50, 0, 10);
    const d = square(18, 0, 50, 0, 10);
    expect(resolveSquarePair(c, d, 1, out)).toBe(true);
    expect(out.approach).toBe(0);
    expect(c.vx).toBe(-50);
  });

  it("square pairs of different sizes keep momentum (mass ∝ side²) and energy", () => {
    const a = square(0, 0, 0, 150, 20);
    const b = square(3, -28, 10, -250, 10);
    const ma = 400;
    const mb = 100;
    const p0 = ma * a.vy + mb * b.vy;
    const e0 = ma * (a.vx ** 2 + a.vy ** 2) + mb * (b.vx ** 2 + b.vy ** 2);
    const out = contact();
    expect(resolveSquarePair(a, b, 1, out)).toBe(true);
    expect(out.ny).toBe(-1);
    expect(ma * a.vy + mb * b.vy).toBeCloseTo(p0, 6);
    expect(ma * (a.vx ** 2 + a.vy ** 2) + mb * (b.vx ** 2 + b.vy ** 2)).toBeCloseTo(e0, 3);
    // The light square took most of the push-out.
    expect(Math.abs(b.y + 28)).toBeGreaterThan(Math.abs(a.y));
  });

  it("walls: a square poking out of the box is put back and reflected; one in the circle is pushed back along the radius", () => {
    const w = wallContact();
    const s = square(-95, 0, -300, 100, 10);
    expect(boxWallPass(s, 0, 0, 100, 100, 1, w)).toBe(true);
    expect(w.wall).toBe(WALL_LEFT);
    expect(w.approach).toBe(300);
    expect(s.x).toBe(-90);
    expect(s.vx).toBe(300);
    const top = square(10, -99, 40, -80, 5);
    boxWallPass(top, 0, 0, 100, 100, 0.5, w);
    expect(w.wall).toBe(WALL_TOP);
    expect(top.vy).toBe(40);
    const inside = square(0, 0, 10, 10, 10);
    expect(boxWallPass(inside, 0, 0, 100, 100, 1, w)).toBe(false);
    const c = square(80, 40, 200, 100, 10);
    expect(circleWallPass(c, 0, 0, 90, 1, w)).toBe(true);
    const corner = Math.hypot(c.x + 10, c.y + 10);
    expect(corner).toBeCloseTo(90, 9);
    expect(c.vx).toBeLessThan(0);
    expect(c.vy).toBeLessThan(0);
    expect(w.wall).toBe(0);
  });

  it("steers a rebound toward a target by at most the nudge, never back into the wall", () => {
    const out = { vx: 0, vy: 0 };
    // Moving right, target straight up: turns by the full nudge.
    const turn = steerToward(300, 0, 0, -1, MAX_NUDGE, 0, 0, out);
    expect(turn).toBeCloseTo(-MAX_NUDGE, 9);
    expect(Math.hypot(out.vx, out.vy)).toBeCloseTo(300, 9);
    // A small difference is taken exactly.
    steerToward(100, 0, 100, 5, MAX_NUDGE, 0, 0, out);
    expect(Math.atan2(out.vy, out.vx)).toBeCloseTo(Math.atan2(5, 100), 9);
    // Leaving the left wall (normal +x) at a shallow angle toward a target behind the wall: never below MIN_WALL_ANGLE.
    const angle = (20 * Math.PI) / 180;
    steerToward(Math.cos(angle) * 100, Math.sin(angle) * 100, -1, 1, MAX_NUDGE, 1, 0, out);
    expect(out.vx / Math.hypot(out.vx, out.vy)).toBeGreaterThanOrEqual(Math.sin(MIN_WALL_ANGLE) - 1e-9);
    expect(steerToward(0, 0, 1, 0, MAX_NUDGE, 0, 0, out)).toBe(0);
    for (let i = 0; i < 50; i++) {
      const a = offAxisAngle(i / 50, ((i * 7) % 50) / 50);
      const off = Math.abs(Math.sin(2 * a));
      expect(off).toBeGreaterThan(Math.sin((2 * 12 * Math.PI) / 180) - 1e-9);
    }
  });

  it("the sound budget keeps the strongest notes, strongest first", () => {
    const budget = new ArenaSoundBudget();
    for (let i = 0; i < 20; i++) budget.offer(i, 100 + i, 0.5, i === 19);
    const got: number[] = [];
    let accents = 0;
    const n = budget.flush((f, _level, accent) => {
      got.push(f);
      if (accent) accents++;
    });
    expect(n).toBe(ARENA_SOUNDS_PER_FRAME);
    expect(got).toEqual(Array.from({ length: ARENA_SOUNDS_PER_FRAME }, (_, i) => 119 - i));
    expect(accents).toBe(1);
    expect(budget.flush(() => undefined)).toBe(0);
  });
});

/* ------------------------------------------------------------------ battle: damage and elimination */

describe("battle: damage and elimination", () => {
  it("deals damage in proportion to the closing speed, nothing for a touch, capped for a crash", () => {
    expect(collisionDamage(400, 400, 1)).toBeCloseTo(1, 12);
    expect(collisionDamage(800, 400, 1)).toBeCloseTo(2, 12);
    expect(collisionDamage(800, 400, 2.5)).toBeCloseTo(5, 12);
    expect(collisionDamage(0.9 * MIN_DAMAGE_REL * 400, 400, 1)).toBe(0);
    expect(collisionDamage(100 * 400, 400, 1)).toBeCloseTo(MAX_DAMAGE_REL, 12);
    expect(collisionDamage(400, 400, 0)).toBe(0);
  });

  it("a hit takes HP and shrinks the square; a shield blocks one hit; 0 HP is a KO credited to the attacker", () => {
    const attacker = createFighter(10);
    const defender = createFighter(10);
    expect(applyHit(attacker, defender, 1.5, 1000)).toBe("hit");
    expect(defender.hp).toBeCloseTo(8.5, 12);
    expect(defender.scale).toBeCloseTo(1 - SHRINK_PER_DAMAGE * 1.5, 12);
    expect(applyHit(attacker, defender, 0, 1000)).toBe("none");
    applyPowerUp(defender, "shield", 2000);
    expect(defender.shieldUntilMs).toBe(2000 + 1000 * SHIELD_SEC);
    expect(applyHit(attacker, defender, 5, 2500)).toBe("shielded");
    expect(defender.hp).toBeCloseTo(8.5, 12);
    expect(applyHit(attacker, defender, 5, 2600)).toBe("hit");
    expect(applyHit(attacker, defender, 5, 2700)).toBe("ko");
    expect(defender.alive).toBe(false);
    expect(defender.hp).toBe(0);
    expect(attacker.kills).toBe(1);
    expect(applyHit(attacker, defender, 5, 2800)).toBe("none");
    // Shrinking stops at MIN_SCALE however many hits land.
    const tank = createFighter(1000);
    for (let i = 0; i < 100; i++) applyHit(null, tank, 3, i);
    expect(tank.scale).toBe(MIN_SCALE);
  });

  it("power-ups heal (never past the start HP), protect and speed up", () => {
    const f = createFighter(10);
    applyHit(null, f, 5, 0);
    applyPowerUp(f, "heal", 100);
    expect(f.hp).toBeCloseTo(5 + HEAL_FRACTION * 10, 12);
    applyPowerUp(f, "heal", 200);
    applyPowerUp(f, "heal", 300);
    expect(f.hp).toBe(10);
    applyPowerUp(f, "speed", 400);
    expect(f.speedUntilMs).toBe(400 + 1000 * SPEED_SEC);
  });

  it("the battle is over once one square is left (a draw when none is)", () => {
    const fighters = [createFighter(3), createFighter(3), createFighter(3)];
    expect(battleOutcome(fighters)).toEqual({ over: false, winner: -1 });
    fighters[0].alive = false;
    fighters[2].alive = false;
    expect(battleOutcome(fighters)).toEqual({ over: true, winner: 1 });
    fighters[1].alive = false;
    expect(battleOutcome(fighters)).toEqual({ over: true, winner: -1 });
  });

  it("the safe zone closes on schedule, never below what the survivors need, and never opens again", () => {
    expect(zoneScaleAt(SHRINK_START_SEC - 1, 0)).toBe(1);
    expect(zoneScaleAt(SHRINK_START_SEC + SHRINK_SEC / 2, 0)).toBeCloseTo(1 - (1 - ZONE_MIN) / 2, 12);
    expect(zoneScaleAt(SHRINK_START_SEC + 10 * SHRINK_SEC, 0)).toBeCloseTo(ZONE_MIN, 12);
    expect(zoneScaleAt(SHRINK_START_SEC + 10 * SHRINK_SEC, 0.7)).toBeCloseTo(0.7, 12);
    expect(zoneScaleAt(SHRINK_START_SEC, 0, 0.6)).toBe(0.6);
  });
});

describe("battle in the engine", () => {
  it("fights to the last square standing: KOs leave the ball list and play the wall-break sound, the winner a chord", () => {
    const engine = battleEngine({ count: 6 }, 11);
    const view = engine.getArenaView()!;
    expect(view.count).toBe(6);
    expect(engine.getBalls()).toHaveLength(6);
    const half = battleSquareHalf(view.field!, 6, 8);
    for (const ball of engine.getBalls()) {
      expect(ball.radius).toBeCloseTo(half, 9);
      expect(ball.gravityScale).toBe(0);
    }
    let insideAlways = true;
    const { events, sec } = play(engine, 240, (e) => {
      const v = e.getArenaView()!;
      const f = v.field!;
      for (const b of e.getBalls()) {
        if (Math.abs(b.x - f.cx) > f.halfW * v.zone - b.radius + 0.5 || Math.abs(b.y - f.cy) > f.halfH * v.zone - b.radius + 0.5) insideAlways = false;
      }
    });
    expect(engine.isSimulationFinished()).toBe(true);
    expect(sec).toBeLessThan(240);
    const p = engine.getBattleProgress();
    expect(p.alive).toBe(1);
    expect(p.kos).toBe(5);
    expect(p.winner).toBeGreaterThanOrEqual(0);
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.getBalls()[0].id - view.firstId).toBe(p.winner);
    expect(events.filter((e) => e.type === "gap")).toHaveLength(5);
    expect(events.some((e) => e.type === "hit" && e.accent && e.chord && e.chord.length === 4)).toBe(true);
    expect(insideAlways).toBe(true);
    // Every KO credited a kill; the kills add up.
    let kills = 0;
    for (let k = 0; k < view.count; k++) kills += view.kills[k];
    expect(kills).toBe(5);
    expect(view.kos.map((ko) => ko.index)).not.toContain(p.winner);
  });

  it("is deterministic: the same seed gives the same KOs at the same moments, another seed a different battle", () => {
    const run = (seed: number) => {
      const engine = battleEngine({}, seed);
      play(engine, 240);
      const v = engine.getArenaView()!;
      return { winner: v.winner, kos: v.kos.map((k) => `${k.index}@${Math.round(k.timeMs)}`).join(","), end: Math.round(v.finishMs) };
    };
    expect(run(21)).toEqual(run(21));
    expect(run(21)).not.toEqual(run(22));
  });

  it("the zone shrinks and power-ups are taken in a default battle; neither happens with them off", () => {
    let pickups = 0;
    let minZone = 1;
    for (const seed of [1, 2, 3]) {
      const engine = battleEngine({}, seed);
      play(engine, 240, (e) => {
        minZone = Math.min(minZone, e.getArenaView()!.zone);
      });
      pickups += engine.getBattleProgress().pickups;
    }
    expect(pickups).toBeGreaterThan(0);
    expect(minZone).toBeLessThan(1);
    const off = battleEngine({ shrink: false, powerUps: false }, 1);
    let sawPowerUp = false;
    play(off, 60, (e) => {
      if (e.getArenaView()!.powerUps.length > 0) sawPowerUp = true;
      expect(e.getArenaView()!.zone).toBe(1);
    });
    expect(sawPowerUp).toBe(false);
  });

  it("keeps the squares inside a circle arena, and sounds stay within the per-frame budget at 8× speed", () => {
    const engine = battleEngine({ arena: "circle", count: 20 }, 5);
    const f = engine.getArenaView()!.field!;
    for (let frame = 0; frame < 240; frame++) {
      for (let i = 0; i < 8; i++) engine.update(STEP, 0);
      const events = engine.consumeSoundEvents();
      expect(events.filter((e) => e.type === "hit" && !e.chord && e.level !== undefined).length).toBeLessThanOrEqual(ARENA_SOUNDS_PER_FRAME);
      const v = engine.getArenaView()!;
      for (const b of engine.getBalls()) {
        const k = b.id - v.firstId;
        if (!v.alive[k]) continue;
        const cornerX = Math.abs(b.x - f.cx) + b.radius;
        const cornerY = Math.abs(b.y - f.cy) + b.radius;
        expect(Math.hypot(cornerX, cornerY)).toBeLessThanOrEqual(f.radius * v.zone + 1);
      }
    }
  });

  it("plays a seed the same on any canvas: the same start, winner, KOs and end at 900×900, 450×450, 540×960 and 1200×700", () => {
    // Every fixed margin (spawn, spacing, zone reach, power-up room, the smallest square) is in reference pixels × the
    // field's unit, as the speeds are, so a found seed replays after a resize or a phone rotation.
    const run = (seed: number, width: number, height: number, settings: Parameters<typeof resolveBattleSettings>[0]) => {
      const engine = battleEngine(settings, seed, { width, height });
      const f = engine.getArenaView()!.field!;
      const start = engine.getBalls().map((b) => [(b.x - f.cx) / f.side, (b.y - f.cy) / f.side, b.radius / f.side].map((n) => n.toFixed(9)).join(","));
      play(engine, 240);
      const v = engine.getArenaView()!;
      return { start, winner: v.winner, kos: v.kos.map((k) => `${k.index}@${Math.round(k.timeMs)}`).join(","), end: v.finishMs };
    };
    for (const [seed, settings] of [[3, {}], [4, {}], [5, { arena: "circle" }], [6, { count: 20 }]] as const) {
      const ref = run(seed, 900, 900, settings);
      expect(ref.winner).toBeGreaterThanOrEqual(0);
      for (const [w, h] of [[450, 450], [540, 960], [1200, 700]]) expect(run(seed, w, h, settings), `seed ${seed} ${JSON.stringify(settings)} at ${w}×${h}`).toEqual(ref);
    }
    // The unit and the square size follow the field.
    const small = buildArenaField(800, 800, "box");
    const big = buildArenaField(1600, 1000, "box");
    expect(battleUnit(small)).toBe(1);
    expect(battleUnit(big)).toBe(1.25);
    for (const n of [2, 8, 20]) expect(battleSquareHalf(big, n, 8) / battleSquareHalf(small, n, 8)).toBeCloseTo(1.25, 9);
  });

  it("battles last long enough to be searched: run lengths vary with the seed", () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 120, physicsConfig: config, mode: "battle", modeSettings: { ...modeSettings, battle: {} } };
    const lengths = [1, 2, 3, 4, 5, 6].map((seed) => simulateSeed(seed, request, 120_000));
    for (const ms of lengths) {
      expect(ms).toBeGreaterThan(5000);
      expect(ms).toBeLessThan(120_000);
    }
    expect(new Set(lengths.map((ms) => Math.round(ms / 100))).size).toBeGreaterThan(3);
  });

  it("a restart starts a fresh battle; a canvas resize maps the squares onto the new field", () => {
    const engine = battleEngine({ count: 4 }, 9);
    play(engine, 10);
    const gen = engine.getArenaView()!.generation;
    engine.initMode("battle");
    const v = engine.getArenaView()!;
    expect(v.generation).toBe(gen + 1);
    expect(v.finished).toBe(false);
    expect(engine.getBalls()).toHaveLength(4);
    engine.setConfig({ width: 450, height: 450 });
    const f = engine.getArenaView()!.field!;
    expect(f.side).toBe(450);
    for (const b of engine.getBalls()) {
      expect(Math.abs(b.x - f.cx)).toBeLessThanOrEqual(f.halfW);
      expect(Math.abs(b.y - f.cy)).toBeLessThanOrEqual(f.halfH);
    }
  });
});

/* ------------------------------------------------------------------ capture the flag: the flag state machine */

describe("capture the flag: the flag rules", () => {
  const base: ArenaBase = { x: 100, y: 200, hw: 40, hh: 80 };
  const freshFlag = (): ArenaFlag => ({ state: "base", x: base.x, y: base.y, carrier: -1, sinceMs: 0 });

  it("an enemy picks a flag up from its base; its own team does not", () => {
    const flag = freshFlag();
    expect(touchFlag(flag, 0, base, 2, 0, -1, -Infinity, 100)).toBeNull();
    expect(flag.state).toBe("base");
    expect(touchFlag(flag, 0, base, 3, 1, -1, -Infinity, 100)).toBe("pickup");
    expect(flag).toMatchObject({ state: "carried", carrier: 3, sinceMs: 100 });
    // A carried flag ignores every other touch.
    expect(touchFlag(flag, 0, base, 4, 1, -1, -Infinity, 150)).toBeNull();
    expect(touchFlag(flag, 0, base, 1, 0, -1, -Infinity, 150)).toBeNull();
  });

  it("a tackled carrier drops the flag where it is: its own team returns it, an enemy (not cooling down, not carrying) takes it", () => {
    const flag = freshFlag();
    touchFlag(flag, 0, base, 3, 1, -1, -Infinity, 100);
    dropFlag(flag, 400, 250, 900);
    expect(flag).toMatchObject({ state: "dropped", x: 400, y: 250, carrier: -1, sinceMs: 900 });
    expect(touchFlag(flag, 0, base, 3, 1, -1, 1900, 1000)).toBeNull();
    expect(touchFlag(flag, 0, base, 5, 1, 1, -Infinity, 1000)).toBeNull();
    expect(touchFlag(flag, 0, base, 5, 1, -1, -Infinity, 1000)).toBe("pickup");
    dropFlag(flag, 300, 260, 1200);
    expect(touchFlag(flag, 0, base, 0, 0, -1, -Infinity, 1300)).toBe("return");
    expect(flag).toMatchObject({ state: "base", x: base.x, y: base.y, carrier: -1 });
  });

  it("a flag left lying goes home by itself; a capture sends it home and scores", () => {
    const flag = freshFlag();
    dropFlag(flag, 10, 10, 1000);
    expect(flagTimedOut(flag, 1000 + 1000 * FLAG_RETURN_SEC - 1)).toBe(false);
    expect(flagTimedOut(flag, 1000 + 1000 * FLAG_RETURN_SEC)).toBe(true);
    flagHome(flag, base, 5000);
    expect(flagTimedOut(flag, 1e9)).toBe(false);
    const scores = [0, 0];
    touchFlag(flag, 0, base, 3, 1, -1, -Infinity, 100);
    expect(captureFlag(flag, base, scores, 1, 200)).toBe(1);
    expect(scores).toEqual([0, 1]);
    expect(flag.state).toBe("base");
    expect(insideBase(base, 130, 270)).toBe(true);
    expect(insideBase(base, 150, 200)).toBe(false);
  });

  it("the game ends on the score to win, or on time with the better score (a draw when level)", () => {
    expect(ctfOutcome([2, 1], 3, 10, 27)).toEqual({ over: false, winner: -1, byTime: false });
    expect(ctfOutcome([1, 3], 3, 10, 27)).toEqual({ over: true, winner: 1, byTime: false });
    expect(ctfOutcome([2, 1], 3, 27, 27)).toEqual({ over: true, winner: 0, byTime: true });
    expect(ctfOutcome([1, 1], 3, 30, 27)).toEqual({ over: true, winner: -1, byTime: true });
  });

  it("puts the bases at the two ends of the field", () => {
    const f = buildArenaField(900, 900, "box");
    const [a, b] = ctfBases(f);
    expect(a.x - a.hw).toBeCloseTo(f.cx - f.halfW, 9);
    expect(b.x + b.hw).toBeCloseTo(f.cx + f.halfW, 9);
    expect(a.y).toBe(f.cy);
    expect(b.y).toBe(f.cy);
  });
});

describe("capture the flag in the engine", () => {
  it("plays until a team reaches the score to win, the flags and carriers always agreeing", () => {
    const engine = ctfEngine({ clipSeconds: 120 }, 4);
    const view = engine.getArenaView()!;
    expect(view.count).toBe(4);
    expect([...view.team]).toEqual([0, 0, 1, 1]);
    let consistent = true;
    let carried = 0;
    const { events } = play(engine, 130, (e) => {
      const v = e.getArenaView()!;
      for (let team = 0; team < 2; team++) {
        const flag = v.flags[team];
        const holders = [...v.carrying].map((c, k) => (c === team ? k : -1)).filter((k) => k >= 0);
        if (flag.state === "carried") {
          carried++;
          if (holders.length !== 1 || holders[0] !== flag.carrier || v.team[flag.carrier] === team) consistent = false;
        } else if (holders.length !== 0) consistent = false;
      }
    });
    // The game is over; the last fanfare plays on (the page keeps running the engine under the winner banner).
    for (let i = 0; i < 60; i++) {
      engine.update(STEP, 0);
      events.push(...engine.consumeSoundEvents());
    }
    const p = engine.getCtfProgress();
    expect(consistent).toBe(true);
    expect(carried).toBeGreaterThan(0);
    expect(p.finished).toBe(true);
    if (!p.byTime) {
      expect(Math.max(...p.scores)).toBe(DEFAULT_CTF_SETTINGS.scoreToWin);
      expect(p.scores[p.winner]).toBe(DEFAULT_CTF_SETTINGS.scoreToWin);
    }
    expect(p.captures).toBe(p.scores[0] + p.scores[1]);
    // Every capture plays the three-chord fanfare (a capture right after another one starts it over).
    const fanfareChords = events.filter((e) => e.type === "hit" && e.accent && e.chord && FANFARE.some((c) => c[0] === e.chord![0] && c.length === e.chord!.length));
    expect(fanfareChords.filter((e) => e.chord![0] === FANFARE[0][0])).toHaveLength(p.captures);
    expect(fanfareChords.length).toBeLessThanOrEqual(FANFARE.length * p.captures);
    expect(fanfareChords[fanfareChords.length - 1].chord).toEqual([...FANFARE[FANFARE.length - 1]]);
  });

  it("ends on time with the better score when nobody reaches it, and the clip length moves the time limit live", () => {
    const engine = ctfEngine({ clipSeconds: 12, scoreToWin: 10 }, 2);
    const { sec } = play(engine, 60);
    const p = engine.getCtfProgress();
    expect(p.byTime).toBe(true);
    expect(sec).toBeCloseTo(ctfTimeLimitSec(12), 1);
    expect(p.winner).toBe(p.scores[0] > p.scores[1] ? 0 : p.scores[1] > p.scores[0] ? 1 : -1);
    const live = ctfEngine({ clipSeconds: 60, scoreToWin: 10 }, 2);
    live.update(STEP, 0);
    live.setCtfSettings({ clipSeconds: 20 });
    expect(live.getArenaView()!.timeLimitSec).toBe(ctfTimeLimitSec(20));
    const r = play(live, 60);
    expect(r.sec).toBeCloseTo(ctfTimeLimitSec(20), 1);
  });

  it("tackles drop the flag and flags go home: every event is counted, deterministically", () => {
    const run = (seed: number) => {
      const engine = ctfEngine({ clipSeconds: 120, perTeam: 3 }, seed);
      play(engine, 130);
      const p = engine.getCtfProgress();
      return `${p.scores.join(":")} c${p.captures} d${p.drops} r${p.returns} ${Math.round(engine.getArenaView()!.finishMs)}`;
    };
    let drops = 0;
    for (const seed of [1, 2, 3, 4]) {
      const a = run(seed);
      expect(run(seed)).toBe(a);
      drops += Number(/d(\d+)/.exec(a)![1]);
    }
    expect(drops).toBeGreaterThan(0);
  });

  it("a found game replays in the page: the finder's longer time limit never changes a game won on the score", () => {
    const request: FinderRequest = { targetDurationSec: 30, toleranceSec: 0.5, maxSeeds: 1, maxSimTimeSec: 60, physicsConfig: config, mode: "ctf", modeSettings: { ...modeSettings, ctf: ctfFinderSettings(DEFAULT_CTF_SETTINGS, 30, 0.5) } };
    let checked = 0;
    for (let seed = 1; seed <= 20 && checked < 3; seed++) {
      const ms = simulateSeed(seed, request, 60_000);
      const found = ctfEngine(request.modeSettings.ctf, seed);
      play(found, 60);
      if (found.getCtfProgress().byTime) continue;
      const clip = arenaFoundClipSec("ctf", ms / 1000, request.modeSettings.ctf!.clipSeconds!);
      const page = ctfEngine({ ...DEFAULT_CTF_SETTINGS, clipSeconds: clip }, seed);
      const { sec } = play(page, 60);
      expect(sec).toBeCloseTo(ms / 1000, 6);
      expect(page.getCtfProgress().scores).toEqual(found.getCtfProgress().scores);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });
});
