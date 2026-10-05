import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EV_CLASH,
  EV_DAMAGE,
  EV_DODGE,
  EV_IMMUNE,
  EV_INTERRUPT,
  EV_SUDDEN,
  FL_CC_IMMUNE_MS,
  FL_EVENT_CAP,
  FL_FIZZLE_SEC,
  FL_IFRAME_MS,
  FL_INTRO_MS,
  FL_KIND_CONTRACT,
  FL_MIN_WINDOW_MS,
  FL_SEEK_TURN,
  FL_SOUND_OF_KIND,
  FL_SUDDEN_MIN,
  FL_SUDDEN_MS,
  FL_SUDDEN_SHRINK_MS,
  FL_TELEGRAPH_CLASS_MS,
  FL_TELEGRAPH_MS,
  capVerdict,
  flSourceWindowMs,
  hitCharge,
  intentBand,
  knockbackWeight,
  telegraphMs,
  type FightLeagueView,
  type FlFighter,
  type FlProjectile,
} from "@/lib/physics/modes/fightLeague";
import { FL_BY_ID, FL_PRESETS, FL_ROSTER, FL_WEAPON_KINDS, weaponOf, type FlFighterRow, type FlWeaponKind, type FlWeaponSpec, type FlWeaponStyle } from "@/lib/physics/modes/fightLeagueRoster";
import { DEFAULT_FIGHT_LEAGUE_LABELS, FightLeagueLayer } from "@/components/simulator/fightLeagueRenderer";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { blockShare, breathsOutOfRange, burstSpawnsBehind, dummyDuel, median, meleeMedianFirstHit, mirrorStats, PROBE_INTRO_MS, PROBE_STEP, probeEngine, probeRun, weaponHitsPerSec } from "./flProbes";

/**
 * --- fl-overhaul --- Fight League's weapon contract and fair hit pipeline (Stage 1 of the overhaul): a probe per weapon kind
 * against an inert dummy (a hit within 10 s on every seed, the median first hit, DPS within a band of the median of all kinds,
 * shots from inside the arena, thrown weapons back in hand, one hit per sweep / punch / swing / pass, breaths only in range,
 * no burst round behind its muzzle, homing lifetimes, the tail's rate, the shields' block share, the weapon drawn every frame
 * it is held), the per-source windows, mirror matches, crowd-control immunity and interrupts, the telegraph classes, the HP
 * fraction verdict and sudden death, the first hit of the presets, the determinism greps – and the before/after probe table
 * the golden re-record quotes.
 */

const SEEDS = [1, 2, 3];

/** A probe fighter: Gerald with stats of 1 and one weapon of `kind` (its defaults, a style), registered while `body` runs. */
function withProbe<T>(kind: FlWeaponKind, extra: Partial<FlWeaponSpec>, body: (id: string) => T): T {
  const gerald = FL_BY_ID.get("gerald")!;
  const id = `probe${kind}${extra.style ?? ""}${extra.shape ?? ""}`.toLowerCase();
  const row: FlFighterRow = { ...gerald, id, name: id, weapons: [{ kind, ...extra }], stats: { hp: 100, speed: 1, attackSpeed: 1, damage: 1, castSpeed: 1, size: 1 } };
  const map = FL_BY_ID as Map<string, FlFighterRow>;
  map.set(id, row);
  try {
    return body(id);
  } finally {
    map.delete(id);
  }
}

/** Every weapon kind and the styles that change its mechanics (the bracers only block: no damage of their own). */
const PROBES: { kind: FlWeaponKind; extra: Partial<FlWeaponSpec> }[] = [
  ...FL_WEAPON_KINDS.map((kind) => ({ kind, extra: {} })),
  ...(
    [
      ["sword", "glow"],
      ["sword", "double"],
      ["hammer", "returning"],
      ["chain", "pull"],
      ["gun", "burst"],
      ["gun", "bouncing"],
      ["cards", "blink"],
      ["staff", "return"],
      ["fists", "contact"],
    ] as [FlWeaponKind, FlWeaponStyle][]
  ).map(([kind, style]) => ({ kind, extra: { style, ...(style === "burst" ? { count: 3 } : {}) } })),
  { kind: "fists" as FlWeaponKind, extra: { shape: "air" as const, count: 1 } },
];

interface ProbeResult {
  label: string;
  firstHits: number[];
  dps: number;
  outside: number;
  slowReturns: number;
  doubleHits: number;
  multiPerAttack: number;
  homingOverLife: number;
}

/** Plays a probe fighter against the dummy on the three seeds for `seconds` of fighting, watching its contract. */
function probeKind(kind: FlWeaponKind, extra: Partial<FlWeaponSpec>, seconds = 20): ProbeResult {
  return withProbe(kind, extra, (id) => {
    const r: ProbeResult = { label: `${extra.style ?? extra.shape ?? "plain"} ${kind}`, firstHits: [], dps: 0, outside: 0, slowReturns: 0, doubleHits: 0, multiPerAttack: 0, homingOverLife: 0 };
    let dealt = 0;
    for (const seed of SEEDS) {
      const engine = dummyDuel(id, seed);
      const mode = engine.fightLeagueMode as unknown as {
        launch: (p: FlProjectile, f: FlFighter, ...rest: unknown[]) => void;
        hit: (ctx: unknown, a: FlFighter, t: FlFighter, ...rest: unknown[]) => number;
      };
      const v = engine.getFightLeagueView();
      const field = v.field!;
      // Every projectile starts inside the arena; every landed hit of a projectile is its only one in that pass.
      const launch = mode.launch.bind(mode);
      mode.launch = (p, f, ...rest) => {
        launch(p, f, ...rest);
        const inside = field.kind === "circle" ? Math.hypot(p.x - field.cx, p.y - field.cy) <= field.half - p.r + 1e-6 : Math.abs(p.x - field.cx) <= field.half - p.r + 1e-6 && Math.abs(p.y - field.cy) <= field.half - p.r + 1e-6;
        if (!inside) r.outside++;
      };
      const passes = new Set<string>();
      const hit = mode.hit.bind(mode);
      mode.hit = (ctx, a, t, ...rest) => {
        const res = hit(ctx, a, t, ...rest);
        const opts = rest[5] as { projectile?: FlProjectile } | undefined;
        if (res === 1 && opts?.projectile) {
          const key = `${opts.projectile.id}/${opts.projectile.ret === 2 ? "back" : "out"}/${t.slot}`;
          if (passes.has(key)) r.doubleHits++;
          passes.add(key);
        }
        return res;
      };
      const f = v.fighters[0];
      const w = f.weapons[0];
      let first = Infinity;
      let thrownAt = -1;
      let prevHits = 0;
      let attackStart = { sweep: 0, punch: -1, swing: -1 };
      let attackHits = 0;
      const perAttack = kind === "sword" || kind === "fists" || kind === "claws" || kind === "tail";
      const born = new Map<number, number>();
      probeRun(engine, PROBE_INTRO_MS + 1000 * seconds, () => {
        const now = v.timeMs;
        if (first === Infinity && f.hits > 0) first = (now - FL_INTRO_MS) / 1000;
        // A thrown weapon is back in hand within 8 s.
        if (w.thrown >= 0 && thrownAt < 0) thrownAt = now;
        if (w.thrown < 0 && thrownAt >= 0) {
          if (now - thrownAt > 8000) r.slowReturns++;
          thrownAt = -1;
        }
        // One hit an attack: a sweep, a punch, a swing (the frame one starts in counts for it: it may land at once); a stab
        // of a sword's resting blade (a hit while no sweep runs) is an attack of its own.
        const started =
          (kind === "sword" && w.sweepT > attackStart.sweep + 1e-9) ||
          ((kind === "fists" || kind === "claws") && w.punchT >= 0 && w.punchT < attackStart.punch) ||
          (kind === "tail" && w.swingT >= 0 && w.swingT < attackStart.swing);
        if (perAttack && started) {
          if (attackHits > 1) r.multiPerAttack++;
          attackHits = 0;
        }
        const landed = w.hits - prevHits;
        if (perAttack && landed > 0) {
          if (kind === "sword" && w.sweepT <= 0 && !started) {
            if (landed > 1) r.multiPerAttack++;
          } else attackHits += landed;
        }
        attackStart = { sweep: w.sweepT, punch: w.punchT < 0 ? Infinity : w.punchT, swing: w.swingT < 0 ? Infinity : w.swingT };
        prevHits = w.hits;
        // Homing shots are gone FL_FIZZLE_SEC after they left.
        for (const p of v.projectiles) {
          if (p.active && p.owner === 0 && p.homing > 0 && p.ret === 0) {
            if (!born.has(p.id)) born.set(p.id, p.born);
            if (now - p.born > 1000 * FL_FIZZLE_SEC + PROBE_STEP + 1e-6) r.homingOverLife++;
          }
        }
      });
      if (perAttack && attackHits > 1) r.multiPerAttack++;
      if (thrownAt >= 0 && v.timeMs - thrownAt > 8000) r.slowReturns++;
      r.firstHits.push(first);
      dealt += w.dealt;
    }
    r.dps = dealt / (SEEDS.length * seconds);
    return r;
  });
}

describe("fight league weapon contract (a probe per kind against the dummy)", () => {
  it("documents a contract for every kind: an intent band, a window class, a sound role", () => {
    for (const kind of FL_WEAPON_KINDS) {
      const c = FL_KIND_CONTRACT[kind];
      expect([kind, typeof c.trigger, typeof c.cadence, typeof c.geometry, typeof c.silhouette, typeof c.animation]).toEqual([kind, "string", "string", "string", "string", "string"]);
      expect(c.sound).toBe(FL_SOUND_OF_KIND[kind]);
      const band = intentBand(weaponOf({ kind }));
      expect([kind, band.hi > band.lo]).toEqual([kind, true]);
    }
    // The bands of the spec: close for swords and tails, reach + size for fists, the orbit for hammers, arcs, shotguns, shooters.
    expect(intentBand({ kind: "sword", reach: 2, size: 0.2 })).toEqual({ lo: -Infinity, hi: 1.6 });
    expect(intentBand({ kind: "fists", reach: 0.9, size: 0.36 }).hi).toBeCloseTo(1.26, 9);
    expect(intentBand({ kind: "hammer", reach: 1.4, size: 0.55 })).toEqual({ lo: expect.closeTo(0.7, 9), hi: expect.closeTo(1.9, 9) });
    expect(intentBand({ kind: "fire", reach: 3, size: 0 })).toEqual({ lo: 0.5, hi: expect.closeTo(2.55, 9) });
    expect(intentBand({ kind: "shotgun", reach: 0.55, size: 0.12 })).toEqual({ lo: 1.5, hi: 4 });
    expect(intentBand({ kind: "wand", reach: 0, size: 0.15 })).toEqual({ lo: 4, hi: 9 });
    // The windows: light kinds follow their cadence (120–300 ms), heavy kinds and abilities FL_IFRAME_MS.
    expect(flSourceWindowMs("gun", 0.2, 1)).toBeCloseTo(170, 9);
    expect(flSourceWindowMs("claws", 0.05, 1)).toBe(FL_MIN_WINDOW_MS);
    expect(flSourceWindowMs("fists", 1, 1)).toBe(FL_IFRAME_MS);
    expect(flSourceWindowMs("sword", 0.1, 3)).toBe(FL_IFRAME_MS);
    expect(flSourceWindowMs(null, 0, 1)).toBe(FL_IFRAME_MS);
    expect(knockbackWeight(1)).toBe(1);
    expect(knockbackWeight(1.2)).toBeCloseTo(1.2 ** -1.5, 9);
    expect(knockbackWeight(0.1)).toBe(1.6);
    expect(knockbackWeight(5)).toBe(0.55);
    expect(hitCharge(5, false)).toBeCloseTo(0.03, 12);
    expect(hitCharge(50, false)).toBe(0.06);
    expect(hitCharge(5, true)).toBeCloseTo(0.02, 12);
    expect(hitCharge(50, true)).toBe(0.05);
  });

  it("lands every kind's hits on the dummy: on every seed within 10 s, the median first hit within 2 s, DPS within 0.5–2× the median of all kinds", { timeout: 120_000 }, () => {
    const results = PROBES.map((p) => probeKind(p.kind, p.extra));
    // The DPS band compares the kinds at their defaults; a style (a burst's rounds, a double blade) keeps the other checks.
    const plain = results.slice(0, FL_WEAPON_KINDS.length);
    const med = median(plain.map((r) => r.dps));
    console.log(`contract probe (DPS at damage 1, median of the kinds ${med.toFixed(2)}): ${results.map((r) => `${r.label} ${r.dps.toFixed(2)} (first ${median(r.firstHits).toFixed(2)} s)`).join(", ")}`);
    for (const r of results) {
      expect([r.label, r.firstHits.every((t) => t <= 10)]).toEqual([r.label, true]);
      expect([r.label, median(r.firstHits) <= 2]).toEqual([r.label, true]);
      if (plain.includes(r)) expect([r.label, r.dps >= 0.5 * med && r.dps <= 2 * med]).toEqual([r.label, true]);
      expect([r.label, r.outside, r.slowReturns, r.doubleHits, r.multiPerAttack, r.homingOverLife]).toEqual([r.label, 0, 0, 0, 0, 0]);
    }
  });

  it("breathes only at a foe in reach, fires a burst from the muzzle, swings the tail often, blocks a fair share", { timeout: 120_000 }, () => {
    for (const id of ["charizard", "zuko"]) expect([id, breathsOutOfRange(id).share <= 0.15]).toEqual([id, true]);
    for (const id of ["masterchief", "robocop"]) expect([id, burstSpawnsBehind(id).behind]).toEqual([id, 0]);
    for (const id of ["alien", "godzilla"]) {
      const index = FL_BY_ID.get(id)!.weapons.findIndex((w) => w.kind === "tail");
      for (const arena of ["square", "circle"] as const) expect([id, arena, weaponHitsPerSec(id, index, arena) >= 0.5]).toEqual([id, arena, true]);
    }
    for (const id of ["captainamerica", "wonderwoman"]) {
      const s = blockShare(id);
      expect([id, s.share >= 0.3 && s.share <= 0.5]).toEqual([id, true]);
    }
  });

  it("draws every fighter's weapon on every frame it is held", () => {
    vi.stubGlobal("document", { createElement: () => ({ width: 1, height: 1, getContext: () => stubContext() }) });
    try {
      for (const row of FL_ROSTER) {
        const engine = probeEngine({ fighters: [row.id, "gerald", "random", "random"], hp: 1000, timeCap: 0 }, 1);
        const v = engine.getFightLeagueView();
        const layer = new FightLeagueLayer();
        let frames = 0;
        probeRun(engine, PROBE_INTRO_MS + 6000, (view) => {
          if (++frames % 6 !== 0) return;
          layer.drawBodies(stubContext(), view, OPTS);
          let held = 0;
          for (const f of view.fighters) {
            if (!f.alive) continue;
            for (const w of f.weapons) if (w.thrown < 0 && !(w.spec.kind === "cards" && w.loaded === 0)) held++;
          }
          expect([row.id, view.timeMs, layer.weaponsDrawn >= held]).toEqual([row.id, view.timeMs, true]);
        });
        expect(v.fighters.length).toBe(2);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const OPTS = { dpr: 1, numbers: true, teamColors: null, teamBanner: false, labels: DEFAULT_FIGHT_LEAGUE_LABELS };

function stubContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = { canvas: { width: 800, height: 450 }, globalAlpha: 1 };
  return new Proxy(target, {
    get(t, key: string) {
      if (key in t) return t[key];
      if (key === "measureText") return (s: string) => ({ width: 6 * String(s).length });
      if (key === "createLinearGradient" || key === "createRadialGradient") return () => ({ addColorStop: () => undefined });
      return () => undefined;
    },
    set(t, key: string, value) {
      t[key] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** Render events since `serial`. */
function eventsSince(v: FightLeagueView, serial: number) {
  const out: { kind: number; t: number; slot: number; src: number; value: number }[] = [];
  for (let s = Math.max(serial, v.eventSerial - FL_EVENT_CAP); s < v.eventSerial; s++) {
    const e = v.events[s % FL_EVENT_CAP];
    out.push({ kind: e.kind, t: e.t, slot: e.slot, src: e.src, value: e.value });
  }
  return out;
}

describe("fight league fair hit pipeline", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps a window per source: two sources may land together, one never faster than its window, a volley's pellets exempt", () => {
    let together = 0;
    for (const [a, b] of [["ryu", "gerald"], ["goku", "gerald"], ["homelander", "gerald"], ["alien", "gerald"], ["predator", "gerald"]]) {
      const engine = probeEngine({ fighters: [a, b, "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 3);
      const v = engine.getFightLeagueView();
      let serial = 0;
      const last = new Map<number, number>();
      let lastAny = -Infinity;
      probeRun(engine, PROBE_INTRO_MS + 30_000, () => {
        for (const e of eventsSince(v, serial)) {
          if (e.kind !== EV_DAMAGE || e.slot !== 1 || e.src < 0) continue;
          const f = v.fighters[e.src >> 3];
          const w = f.weapons[e.src & 7];
          const window = w ? flSourceWindowMs(w.spec.kind, w.spec.cooldown, Math.max(f.attack, 1)) : FL_IFRAME_MS;
          const prev = last.get(e.src) ?? -Infinity;
          if (w?.spec.kind !== "shotgun") expect([a, e.src, e.t - prev >= window - 1e-6]).toEqual([a, e.src, true]);
          if (e.t - lastAny < FL_IFRAME_MS && (last.get(e.src) ?? -Infinity) < lastAny) together++;
          last.set(e.src, e.t);
          lastAny = e.t;
        }
        serial = v.eventSerial;
      });
    }
    expect(together).toBeGreaterThan(0);
    // A shotgun's pellets share their volley: several land on the foe within the window.
    const engine = probeEngine({ fighters: ["doomslayer", "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 2);
    const v = engine.getFightLeagueView();
    let serial = 0;
    let lastT = -Infinity;
    let volley = 0;
    probeRun(engine, PROBE_INTRO_MS + 20_000, () => {
      for (const e of eventsSince(v, serial)) {
        if (e.kind !== EV_DAMAGE || e.slot !== 1) continue;
        if (e.t - lastT < FL_IFRAME_MS) volley++;
        lastT = e.t;
      }
      serial = v.eventSerial;
    });
    expect(volley).toBeGreaterThan(0);
  });

  it("trades melee hits fairly: a clash parries both, and mirror matches rarely end in a double KO, slot A winning about half", { timeout: 120_000 }, () => {
    const m = mirrorStats();
    console.log(`mirror matches: ${m.games} games, double KO ${(100 * m.doubleKo).toFixed(1)} %, slot A ${(100 * m.slotA).toFixed(1)} % of ${m.decided} decided`);
    expect(m.doubleKo).toBeLessThanOrEqual(0.06);
    expect(m.slotA).toBeGreaterThanOrEqual(0.45);
    expect(m.slotA).toBeLessThanOrEqual(0.55);
    let clashes = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = probeEngine({ fighters: ["link", "link", "random", "random"], timeCap: 60 }, seed);
      const v = engine.getFightLeagueView();
      let serial = 0;
      probeRun(engine, 70_000, () => {
        for (const e of eventsSince(v, serial)) if (e.kind === EV_CLASH) clashes++;
        serial = v.eventSerial;
      });
      expect(v.clashes2).toBeGreaterThanOrEqual(0);
    }
    expect(clashes).toBeGreaterThan(0);
  });

  it("makes a fighter immune to hard crowd control for a second after one, and a freeze interrupts a telegraph", () => {
    // Sub-Zero's ice: a second freeze within the immunity is refused (IMMUNE) – the shots still hurt.
    const engine = probeEngine({ fighters: ["subzero", "gerald", "random", "random"], cast: [0.05, 0.05, 1, 1], attack: [4, 1, 1, 1], hp: 1000, timeCap: 0 }, 1);
    const v = engine.getFightLeagueView();
    const g = v.fighters[1];
    let serial = 0;
    let immune = 0;
    let freezes = 0;
    let lastFrozen = -Infinity;
    probeRun(engine, PROBE_INTRO_MS + 20_000, () => {
      if (g.frozenUntil > lastFrozen + 1) {
        if (Number.isFinite(lastFrozen)) expect(g.frozenUntil - lastFrozen).toBeGreaterThanOrEqual(FL_CC_IMMUNE_MS);
        lastFrozen = g.frozenUntil;
        freezes++;
      }
      for (const e of eventsSince(v, serial)) if (e.kind === EV_IMMUNE && e.slot === 1) immune++;
      serial = v.eventSerial;
    });
    expect(freezes).toBeGreaterThan(2);
    expect(immune).toBeGreaterThan(0);
    // A freeze landing in a telegraph: interrupted, the meter back to half, the next telegraph uninterruptible.
    const e2 = probeEngine({ fighters: ["thor", "loki", "random", "random"], cast: [3, 0.05, 1, 1], hp: 1000, timeCap: 0 }, 2);
    const v2 = e2.getFightLeagueView();
    const thor = v2.fighters[0];
    probeRun(e2, 20_000, () => thor.telegraphUntil >= 0);
    expect(thor.telegraphUntil).toBeGreaterThan(v2.timeMs);
    expect(thor.ccImmuneUntil).toBeLessThan(v2.timeMs);
    const before = v2.eventSerial;
    // (a freeze lands now: through the hit pipeline's crowd control)
    const mode = e2.fightLeagueMode as unknown as { applyHardCc: (f: FlFighter, until: number, now: number) => boolean };
    expect(mode.applyHardCc(thor, v2.timeMs + 1000, v2.timeMs)).toBe(true);
    expect([thor.telegraphUntil, thor.meter, thor.uninterruptible]).toEqual([-1, 0.5, true]);
    expect(eventsSince(v2, before).some((e) => e.kind === EV_INTERRUPT && e.slot === 0)).toBe(true);
    expect(mode.applyHardCc(thor, v2.timeMs + 1000, v2.timeMs + 500)).toBe(false);
    expect(v2.immunes).toBeGreaterThan(0);
  });

  it("telegraphs by class (quick, standard, area, ultimate) and lets a foe dodge an area cast", () => {
    const C = FL_TELEGRAPH_CLASS_MS;
    expect(FL_TELEGRAPH_MS).toBe(C.standard);
    const ab = (id: string) => FL_BY_ID.get(id)!.ability;
    expect(telegraphMs(ab("gerald"))).toBe(C.quick);
    expect(telegraphMs(ab("thor"))).toBe(C.standard);
    expect(telegraphMs(ab("hulk"))).toBe(C.area);
    expect(telegraphMs(ab("voldemort"))).toBe(C.ultimate);
    expect(telegraphMs({ charge: 9, ultimate: true, effects: [{ p: "speedBurst" }] })).toBe(C.ultimate);
    // Dodges: over a few duels against Hulk Smash some foe got out of the area during its telegraph.
    let dodges = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const engine = probeEngine({ fighters: ["hulk", "spiderman", "random", "random"], cast: [3, 0.05, 1, 1], hp: 1000, timeCap: 0 }, seed);
      const v = engine.getFightLeagueView();
      let serial = 0;
      probeRun(engine, PROBE_INTRO_MS + 30_000, () => {
        for (const e of eventsSince(v, serial)) if (e.kind === EV_DODGE) dodges++;
        serial = v.eventSerial;
      });
    }
    expect(dodges).toBeGreaterThan(0);
  });
});

describe("fight league verdicts", () => {
  it("gives the time cap to the larger HP fraction (Σ hp / Σ max, a KO counting 0), within 0.5 % a draw", () => {
    expect(capVerdict([60, 57], [0, 1], 2, undefined, [115, 105])).toBe(1); // 52 % vs 54 %
    expect(capVerdict([60, 57], [0, 1], 2, undefined, [100, 100])).toBe(0);
    expect(capVerdict([50, 50.2], [0, 1], 2, undefined, [100, 100])).toBe(-1);
    expect(capVerdict([0, 80, 50, 50], [0, 0, 1, 1], 2, undefined, [100, 100, 100, 100])).toBe(1); // 40 % vs 50 %
    expect(capVerdict([0, 0], [0, 1], 2, undefined, [100, 100])).toBe(-1);
  });

  it("plays sudden death at the cap: the arena shrinks to 60 % over 8 s, a KO still ends it, then the fraction verdict", () => {
    const engine = probeEngine({ fighters: ["thor", "loki", "random", "random"], hp: 100_000, timeCap: 5 }, 3);
    const v = engine.getFightLeagueView();
    const half = v.field!.half;
    let serial = 0;
    let sudden = 0;
    probeRun(engine, 40_000, () => {
      for (const e of eventsSince(v, serial)) if (e.kind === EV_SUDDEN) sudden++;
      serial = v.eventSerial;
      for (const f of v.fighters) if (f.alive) expect(Math.abs(f.x - v.field!.cx)).toBeLessThanOrEqual(v.field!.half - f.r + 1);
    });
    expect(sudden).toBe(1);
    expect(v.suddenMs).toBeGreaterThanOrEqual(FL_INTRO_MS + 5000);
    expect(v.suddenMs).toBeLessThan(FL_INTRO_MS + 5000 + 20);
    expect(v.finished).toBe(true);
    expect(v.byTime).toBe(true);
    expect(v.finishMs - v.suddenMs).toBeGreaterThanOrEqual(FL_SUDDEN_MS - 1e-6);
    expect(v.field!.half).toBeCloseTo(FL_SUDDEN_MIN * half, 6);
    expect(FL_SUDDEN_SHRINK_MS).toBeLessThan(FL_SUDDEN_MS);
    // Off: the plain verdict at the cap.
    const plain = probeRun(probeEngine({ fighters: ["thor", "loki", "random", "random"], hp: 100_000, timeCap: 5, suddenDeath: false }, 3), 40_000);
    expect([plain.finished, plain.byTime, plain.suddenMs]).toEqual([true, true, -1]);
    expect(plain.finishMs).toBeLessThan(FL_INTRO_MS + 5000 + 20);
    // The settings: flSD and flSk round-trip; the defaults write nothing.
    const base = defaultSettings("fightLeague");
    expect([base.flSuddenDeath, base.flSeek]).toEqual([true, FL_SEEK_TURN]);
    const params = settingsToSearchParams({ ...base, flSuddenDeath: false, flSeek: 0 });
    expect([params.get("flSD"), params.get("flSk")]).toEqual(["0", "0"]);
    expect(settingsFromSearchParams(params)).toMatchObject({ flSuddenDeath: false, flSeek: 0 });
    expect(settingsToSearchParams(base).has("flSD") || settingsToSearchParams(base).has("flSk")).toBe(false);
  });

  it("stops every fighter at the verdict (a frame's extra step changes nothing)", () => {
    const engine = probeEngine({ fighters: ["thor", "loki", "random", "random"], timeCap: 60 }, 11);
    const v = probeRun(engine, 120_000);
    expect(v.finished).toBe(true);
    const at = v.fighters.map((f) => [f.x, f.y, f.hp]);
    for (let k = 0; k < 30; k++) engine.update(PROBE_STEP, 0);
    expect(v.fighters.map((f) => [f.x, f.y, f.hp])).toEqual(at);
  });
});

describe("fight league engagement", () => {
  it("lands the first hit within 1.5 s of FIGHT! in at least 90 % of the presets' fights", () => {
    let fast = 0;
    let runs = 0;
    for (const p of FL_PRESETS) {
      for (const seed of SEEDS) {
        const fighters = [...p.fighters, "random", "random", "random", "random"].slice(0, 4);
        const engine = probeEngine({ fighters, match: p.match }, seed);
        const v = probeRun(engine, PROBE_INTRO_MS + 1500);
        runs++;
        if (v.hits > 0) fast++;
      }
    }
    console.log(`first hit within 1.5 s of FIGHT!: ${fast}/${runs}`);
    expect(fast / runs).toBeGreaterThanOrEqual(0.9);
  });

  it("closes in a melee fighter fast (the median first hit against the dummy within 2 s)", { timeout: 60_000 }, () => {
    expect(meleeMedianFirstHit().median).toBeLessThanOrEqual(2);
  });
});

/* ------------------------------------------------------------------ determinism gates */

const ROOT = path.join(__dirname, "..");

describe("fight league determinism and naming gates", () => {
  it("draws every random number from ctx.random() (no Math.random, Date.now or performance.now in fightLeague*.ts)", () => {
    const dir = path.join(ROOT, "src/lib/physics/modes");
    const files = fs.readdirSync(dir).filter((f) => /^fightLeague.*\.ts$/.test(f));
    expect(files.length).toBeGreaterThanOrEqual(2);
    for (const file of files) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      expect([file, /Math\.random|Date\.now|performance\.now/.test(text)]).toEqual([file, false]);
    }
  });

  it("names the site's ball Gerald everywhere (no other name for it in the repository)", () => {
    const banned = ["b", "o", "r", "i", "s"].join("");
    const re = new RegExp(banned, "i");
    const hits: string[] = [];
    const skip = new Set(["node_modules", ".git", "out", ".next", "smoke-output"]);
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|json|md|mjs)$/.test(entry.name)) {
          if (re.test(entry.name) || re.test(fs.readFileSync(full, "utf8"))) hits.push(path.relative(ROOT, full));
        }
      }
    };
    walk(ROOT);
    expect(hits).toEqual([]);
  });
});

/* ------------------------------------------------------------------ the before/after table */

/** The probe numbers on the rules before this stage (measured with tests/flProbes.ts on main at 8e03e43). */
const BEFORE = {
  meleeFirstHit: 2.1,
  mirrorDoubleKo: 0.342,
  mirrorSlotA: 0.564,
  alienTailSquare: 0.156,
  alienTailCircle: 0.233,
  charizardOutOfRange: 0.561,
  burstBehind: 240,
  capBlocks: 0.307,
  wonderWomanBlocks: 0.336,
};

describe("fight league probe table (before → after this stage's rules)", () => {
  it("prints the probe numbers the golden re-record quotes", { timeout: 120_000 }, () => {
    const melee = meleeMedianFirstHit();
    const mirror = mirrorStats();
    const after = {
      meleeFirstHit: melee.median,
      mirrorDoubleKo: mirror.doubleKo,
      mirrorSlotA: mirror.slotA,
      alienTailSquare: weaponHitsPerSec("alien", 1, "square"),
      alienTailCircle: weaponHitsPerSec("alien", 1, "circle"),
      charizardOutOfRange: breathsOutOfRange("charizard").share,
      burstBehind: burstSpawnsBehind("masterchief").behind + burstSpawnsBehind("robocop").behind,
      capBlocks: blockShare("captainamerica").share,
      wonderWomanBlocks: blockShare("wonderwoman").share,
    };
    const pct = (x: number) => `${(100 * x).toFixed(1)} %`;
    const rows: [string, string, string][] = [
      ["melee median first hit (s after FIGHT!)", BEFORE.meleeFirstHit.toFixed(2), after.meleeFirstHit.toFixed(2)],
      ["mirror double KO", pct(BEFORE.mirrorDoubleKo), pct(after.mirrorDoubleKo)],
      ["mirror slot A wins (decided)", pct(BEFORE.mirrorSlotA), pct(after.mirrorSlotA)],
      ["Alien tail hits/s (square)", BEFORE.alienTailSquare.toFixed(2), after.alienTailSquare.toFixed(2)],
      ["Alien tail hits/s (circle)", BEFORE.alienTailCircle.toFixed(2), after.alienTailCircle.toFixed(2)],
      ["Charizard breaths out of range", pct(BEFORE.charizardOutOfRange), pct(after.charizardOutOfRange)],
      ["burst rounds spawned behind (Chief + RoboCop, 3 × 30 s)", String(BEFORE.burstBehind), String(after.burstBehind)],
      ["Captain America block share", pct(BEFORE.capBlocks), pct(after.capBlocks)],
      ["Wonder Woman block share", pct(BEFORE.wonderWomanBlocks), pct(after.wonderWomanBlocks)],
    ];
    console.log(`probe table (before → after):\n${rows.map(([k, b, a]) => `  ${k}: ${b} → ${a}`).join("\n")}`);
    expect(after.meleeFirstHit).toBeLessThan(BEFORE.meleeFirstHit);
    expect(after.mirrorDoubleKo).toBeLessThan(BEFORE.mirrorDoubleKo);
    expect(after.burstBehind).toBe(0);
  });
});
