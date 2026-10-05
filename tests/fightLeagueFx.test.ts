import fs from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_FIGHT_LEAGUE_LABELS, FIGHT_LEAGUE_DATA_KEYS, FightLeagueDataset, FightLeagueLayer, flNameColor as layerNameColor, type FightLeagueRenderOptions } from "@/components/simulator/fightLeagueRenderer";
import { FL_PRIM_FX } from "@/components/simulator/fightLeague/fx";
import { drawShot, drawSummon } from "@/components/simulator/fightLeague/projectiles";
import { drawAirCurl, drawBow, drawCaster, drawChainHead, drawClaws, drawEnergyHand, drawFist, drawGun, drawHammerHead, drawShield, drawShieldFace, drawSword, drawTail, type FlPaint } from "@/components/simulator/fightLeague/weapons";
import {
  EV_DAMAGE,
  EV_HIT,
  FB_COUNT,
  FB_FIGHT,
  FB_FINAL_KO,
  FB_FIRST_BLOOD,
  FB_VS,
  FB_WIN,
  FIGHT_LEAGUE_URL_KEYS,
  FL_ARENA_STYLES,
  FL_BANNER_CAP,
  FL_EVENT_CAP,
  FL_FINALE_MS,
  FL_STAGES,
  FL_TIME_BANNER_MS,
  FL_WIN_HOLD_SEC,
  flHoldEndMs,
  flHoldStartMs,
  flWinnerShownMs,
  type FightLeagueSettings,
  type FightLeagueView,
  type FlEvent,
} from "@/lib/physics/modes/fightLeague";
import {
  FL_DAMAGE_MERGE_MS,
  FL_FINALE_BANNER_MS,
  FL_FINALE_SLOW,
  FL_FLOOR,
  FL_INK,
  FL_SHAKE_CLAMP,
  FL_SHAKE_DEFAULT,
  FL_SHAKE_REDUCED,
  FL_VS_COUNT_MS,
  bodyRimWidth,
  flBoxContentBottom,
  flContrast,
  flEffectNow,
  flFinaleScale,
  flFinaleWarp,
  flFinaleZoom,
  flHudLayout,
  flNameColor,
  flPlateLayout,
  flShakeAt,
  flShakeStrength,
} from "@/lib/physics/modes/fightLeagueFx";
import { FL_ABILITY_PRIMITIVES, FL_BY_ID, FL_DIVISION_LABELS, FL_GUN_LOOKS, FL_HAMMER_LOOKS, FL_ROSTER, FL_SHAPES, FL_SUMMON_SHAPES, FL_SWORD_LOOKS, FL_WEAPON_KINDS, type FlAbility, type FlShape, type FlWeaponSpec } from "@/lib/physics/modes/fightLeagueRoster";
import { defaultSettings, engineSettingKeys, settingsFromSearchParams, settingsToSearchParams, uncappedEngaged, type SimulatorSettings } from "@/lib/settings";
import { badgeMetrics, badgeRect, exportSquare, intersect, type FrameRect } from "@/lib/watermark/layout";
import { fakeCanvas, fakeDocument, type FakeCanvas, type FakeContext } from "./fakeCanvas";
import { PROBE_INTRO_MS, PROBE_STEP, dummyDuel, probeEngine, probeRun } from "./flProbes";

/*
 * --- fl-overhaul --- (Stage 3) Fight League's visual overhaul, headlessly (tests/fakeCanvas.ts stands in for every canvas):
 *
 * - the render contract: after 60 warm-up frames of the four-shooter FFA and of the heavy kit, every frame of the page's
 *   canvas has no gradient or pattern made, no shadowBlur, balanced save/restore, ≤ 450 drawImage and ≤ 40 fillText – the
 *   sprites (bodies, weapons, text, glows, the arena plate) are built once on their own canvases and drawn as images;
 * - the looks: every row's name readable on its ink stroke, every body that melts into the floor rimmed; every projectile
 *   shape, summon, blade, hammer head, gun and held kind drawn as our own vector silhouette – in a sketch and in play;
 *   every ability primitive's telegraph preview, fire and sustain;
 * - the maths of fightLeagueFx.ts: the shake (0 when off, bounded, pure), the KO finale's curve (survivors ≤ 0.3× their cruise
 *   while it holds), damage merging (one number a shotgun volley), the banners (first blood once; 3-2-1 and FIGHT! on the
 *   intro's clock), the trails (sampled per 60 Hz step: the same at any frame rate), the HUD's readability at 1080 px and
 *   its boxes clear of the watermark badge, the 9:16 plates clear of the square;
 * - no clock and no random numbers in the renderer; the spectacle's settings round-trip through the URL and stay out of the
 *   fight (never one of the engine's keys); the data attributes.
 */

const W = 800;
const H = 450;
const SIDE = Math.min(W, H);
const OPTS: FightLeagueRenderOptions = { dpr: 1, numbers: true, teamColors: null, teamBanner: false, labels: DEFAULT_FIGHT_LEAGUE_LABELS, quality: "full" };
const FOUR_SHOOTERS: Partial<FightLeagueSettings> = { fighters: ["ironman", "doomslayer", "legolas", "jinx"], match: "ffa4", hp: 300, timeCap: 0 };
const HEAVY_KIT: Partial<FightLeagueSettings> = { fighters: ["charizard", "walterwhite", "superman", "naruto"], match: "ffa4", hp: 300, timeCap: 0 };
const asCtx = (ctx: FakeContext) => ctx as unknown as CanvasRenderingContext2D;

/** A stand-in document handing out fake canvases (the sprites, the text, the plate); every canvas it made is in the set. */
function stubDocument(): Set<unknown> {
  const doc = fakeDocument();
  const canvases = new Set<unknown>();
  const make = doc.createElement;
  doc.createElement = (tag: string) => {
    const made = make(tag);
    canvases.add(made);
    return made;
  };
  vi.stubGlobal("document", doc);
  return canvases;
}

/** The page's canvas context; `blur.max` is the largest shadowBlur ever set on it (the contract: never above 0). */
function mainContext() {
  const ctx = fakeCanvas(W, H).ctx;
  const blur = { max: 0 };
  Object.defineProperty(ctx, "shadowBlur", { get: () => 0, set: (b: number) => void (blur.max = Math.max(blur.max, b)) });
  return { ctx, blur };
}

/** One frame as the page draws it (Canvas.tsx): the stage's backdrop, the world (the shake, the display scale), the arena, the fighters, the HUD. */
function drawFrame(layer: FightLeagueLayer, ctx: FakeContext, view: FightLeagueView, opts: FightLeagueRenderOptions = OPTS, portrait = false) {
  const c = asCtx(ctx);
  layer.drawBackdrop(c, view, W, H);
  c.save();
  layer.applyWorld(c, view, opts, SIDE);
  layer.drawStage(c, view, opts);
  layer.drawBodies(c, view, opts);
  c.restore();
  layer.drawOverlay(c, view, opts, { width: W, height: H, inset: 0, portrait });
}

interface Tally {
  drawImage: number;
  fillText: number;
  gradients: number;
  patterns: number;
  saves: number;
  restores: number;
  /** drawImage calls of anything but a canvas the renderer made (an image asset). */
  foreign: number;
}

/** What one frame did on the page's context (its log is cleared for the next frame). */
function tally(ctx: FakeContext, canvases: ReadonlySet<unknown>): Tally {
  const t: Tally = { drawImage: 0, fillText: 0, gradients: 0, patterns: 0, saves: 0, restores: 0, foreign: 0 };
  for (const call of ctx.calls) {
    switch (call.name) {
      case "drawImage":
        t.drawImage++;
        if (!canvases.has(call.args[0])) t.foreign++;
        break;
      case "fillText":
      case "strokeText":
        t.fillText++;
        break;
      case "createLinearGradient":
      case "createRadialGradient":
        t.gradients++;
        break;
      case "createPattern":
        t.patterns++;
        break;
      case "save":
        t.saves++;
        break;
      case "restore":
        t.restores++;
        break;
      default:
        break;
    }
  }
  ctx.calls.length = 0;
  return t;
}

const WARM_UP_FRAMES = 60;

/** A match drawn frame by frame (60 fps) to the end of the winner's hold; the worst frame after the warm-up. */
function contractRun(fl: Partial<FightLeagueSettings>, seed: number, opts: FightLeagueRenderOptions = OPTS, limitMs = 120_000, portrait = false) {
  const canvases = stubDocument();
  const engine = probeEngine(fl, seed);
  const view = engine.getFightLeagueView();
  const layer = new FightLeagueLayer();
  const { ctx, blur } = mainContext();
  const worst = { drawImage: 0, fillText: 0, gradients: 0, patterns: 0, unbalanced: 0, foreign: 0 };
  let frames = 0;
  let madeAtWarmUp = 0;
  for (;;) {
    drawFrame(layer, ctx, view, opts, portrait);
    const t = tally(ctx, canvases);
    frames++;
    worst.drawImage = Math.max(worst.drawImage, t.drawImage);
    worst.fillText = Math.max(worst.fillText, t.fillText);
    worst.foreign += t.foreign;
    if (t.saves !== t.restores) worst.unbalanced++;
    if (frames === WARM_UP_FRAMES) madeAtWarmUp = canvases.size;
    if (frames > WARM_UP_FRAMES) {
      worst.gradients += t.gradients;
      worst.patterns += t.patterns;
    }
    if (engine.getElapsedMs() >= limitMs || (view.finished && view.timeMs >= flHoldEndMs(view) + 500)) break;
    engine.update(PROBE_STEP, 0);
    engine.consumeSoundEvents();
  }
  return { view, layer, worst, blur: blur.max, frames, madeAfterWarmUp: canvases.size - madeAtWarmUp };
}

/**
 * A call log's fingerprint (the calls and their rounded numbers – with `colours`, the fill and stroke colours set too): two
 * sketches with the same geometric one have the same silhouette.
 */
function fingerprint(ctx: FakeContext, colours = false): string {
  return ctx.calls
    .filter((c) => colours || !c.name.startsWith("set:"))
    .map((c) => `${c.name}(${c.args.map((a) => (typeof a === "number" ? a.toFixed(2) : typeof a === "string" ? a : typeof a)).join(",")})`)
    .join(";");
}

/** A vector builder drawn into a fresh fake canvas (whose fill and stroke colours are logged as "set:" calls). */
function sketch(draw: (g: CanvasRenderingContext2D) => void): FakeContext {
  const canvas = fakeCanvas(128, 128);
  const ctx = canvas.ctx;
  for (const key of ["fillStyle", "strokeStyle"] as const) {
    let value: unknown = ctx[key];
    Object.defineProperty(ctx, key, {
      get: () => value,
      set: (next: unknown) => {
        value = next;
        ctx.calls.push({ name: `set:${key}`, args: [typeof next === "string" ? next : "gradient"] });
      },
    });
  }
  draw(asCtx(ctx));
  return ctx;
}

/**
 * Thor – his kit swapped for `patch` – against the inert dummy (tests/flProbes.ts) for `ms` after FIGHT!, every frame drawn:
 * the most weapons and projectiles a frame drew, image assets drawn, unbalanced frames.
 */
function playPatched(patch: { weapons?: readonly FlWeaponSpec[]; ability?: FlAbility }, ms: number, fl: Partial<FightLeagueSettings> = {}) {
  const row = FL_BY_ID.get("thor")!;
  const saved = { weapons: row.weapons, ability: row.ability };
  if (patch.weapons) row.weapons = patch.weapons;
  if (patch.ability) row.ability = patch.ability;
  try {
    const canvases = stubDocument();
    const engine = dummyDuel("thor", 1, fl);
    const layer = new FightLeagueLayer();
    const { ctx, blur } = mainContext();
    const seen = { weapons: 0, projectiles: 0, minions: 0, foreign: 0, unbalanced: 0, frames: 0 };
    const view = probeRun(
      engine,
      PROBE_INTRO_MS + ms,
      (v) => {
        drawFrame(layer, ctx, v);
        const t = tally(ctx, canvases);
        seen.frames++;
        seen.weapons = Math.max(seen.weapons, layer.weaponsDrawn);
        seen.projectiles = Math.max(seen.projectiles, layer.projectilesDrawn);
        seen.minions = Math.max(seen.minions, v.minions.filter((m) => m.active).length);
        seen.foreign += t.foreign;
        if (t.saves !== t.restores) seen.unbalanced++;
      },
      false,
    );
    return { view, layer, seen, blur: blur.max };
  } finally {
    row.weapons = saved.weapons;
    row.ability = saved.ability;
  }
}

afterEach(() => vi.unstubAllGlobals());

/* ------------------------------------------------------------------ the render contract */

describe("the render contract: sprites built once, no gradients or shadows a frame", () => {
  // (seeds whose last KO is a single one: the finale and the winner's card are drawn too)
  const MATCHES: [string, Partial<FightLeagueSettings>, number][] = [
    ["the four-shooter FFA (Iron Man, Doom Slayer, Legolas, Jinx)", FOUR_SHOOTERS, 2],
    ["the heavy kit (Charizard's fire, Walter White's flasks, Superman's beam, Naruto's clones)", HEAVY_KIT, 1],
  ];
  for (const [name, fl, seed] of MATCHES) {
    it(`${name}: after 60 warm-up frames 0 gradients/patterns, no shadowBlur, save/restore balanced, ≤ 450 drawImage and ≤ 40 fillText a frame`, { timeout: 120_000 }, () => {
      const r = contractRun(fl, seed);
      console.log(`${name}: ${r.frames} frames, worst drawImage ${r.worst.drawImage}, fillText ${r.worst.fillText}, canvases made after the warm-up ${r.madeAfterWarmUp}`);
      // the whole match: the VS card, the fight, the KOs, the finale and the winner's card
      expect(r.view.finished).toBe(true);
      expect(r.view.finale.from).toBeGreaterThanOrEqual(0);
      expect(r.frames).toBeGreaterThan(1200);
      expect(r.worst).toMatchObject({ gradients: 0, patterns: 0, unbalanced: 0, foreign: 0 });
      expect(r.blur).toBe(0);
      expect(r.worst.drawImage).toBeLessThanOrEqual(450);
      expect(r.worst.fillText).toBeLessThanOrEqual(40);
      // the caches hold: a sprite is built for a new radius, label or effect – never once a frame
      expect(r.madeAfterWarmUp).toBeLessThan(400);
    });
  }

  it("holds on every stage and arena style, in a portrait export's layout and with the hit shapes on", { timeout: 120_000 }, () => {
    for (const stage of FL_STAGES) {
      for (const arenaStyle of FL_ARENA_STYLES) {
        const opts: FightLeagueRenderOptions = { ...OPTS, debug: stage === "night" };
        const r = contractRun({ fighters: ["thor", "loki", "random", "random"], match: "1v1", stage, arenaStyle }, 2, opts, 12_000, arenaStyle === "neon");
        const label = `${stage}/${arenaStyle}`;
        expect([label, r.worst.gradients, r.worst.patterns, r.worst.unbalanced, r.worst.foreign, r.blur]).toEqual([label, 0, 0, 0, 0, 0]);
        expect([label, r.worst.drawImage <= 450, r.worst.fillText <= 40]).toEqual([label, true, true]);
        expect([label, r.layer.debugOn]).toEqual([label, stage === "night"]);
      }
    }
  });
});

/* ------------------------------------------------------------------ looks, silhouettes, primitives */

describe("the looks: readable names, rimmed bodies, our own silhouettes for every shape, kind and look", () => {
  it("names hold 4.5:1 on their ink stroke and a body under 1.5:1 on the floor gets the 0.12 R ink rim – all 147 rows", () => {
    expect(FL_ROSTER).toHaveLength(147);
    expect(layerNameColor).toBe(flNameColor);
    let rimmed = 0;
    for (const row of FL_ROSTER) {
      const name = flNameColor(row.body, row.accent);
      expect([row.id, flContrast(name, FL_INK) >= 4.5]).toEqual([row.id, true]);
      // a body colour that already reads is kept as it is
      if (flContrast(row.body, FL_INK) >= 4.5) expect([row.id, name]).toEqual([row.id, row.body]);
      const melts = flContrast(row.body, FL_FLOOR) < 1.5;
      expect([row.id, bodyRimWidth(row)]).toEqual([row.id, melts ? 0.12 : 0.07]);
      if (melts) rimmed++;
    }
    expect(rimmed).toBeGreaterThan(0); // (white and pale bodies exist: the rule is exercised)
    // a dark pair is lightened until it reads; anything that is not "#rrggbb" falls back to a light grey
    expect(flContrast(flNameColor("#1e1b2e", "#111827"), FL_INK)).toBeGreaterThanOrEqual(4.5);
    expect(flNameColor("tomato", "nope")).toBe("#f4f4f5");
  });

  it("sketches every projectile shape, summon, blade, hammer head, gun and held part as a vector drawing – no image asset", () => {
    stubDocument();
    const paint: FlPaint = { body: "#2563eb", accent: "#facc15", color: "#ef4444" };
    const prints = new Map<string, string>();
    const coloured = new Map<string, string>();
    const check = (label: string, ctx: FakeContext) => {
      expect([label, ctx.drawn, ctx.calls.filter((c) => c.name === "drawImage").length]).toEqual([label, true, 0]);
      prints.set(label, fingerprint(ctx));
      coloured.set(label, fingerprint(ctx, true));
    };
    const distinct = (labels: string[]) => expect(new Set(labels.map((l) => prints.get(l))).size).toBe(labels.length);
    for (const shape of FL_SHAPES) check(`shot:${shape}`, sketch((g) => drawShot(g, shape, 6, paint.color, paint)));
    // the overhaul's silhouettes (Stage 2's kinds and primitives) are each their own
    const fresh = FL_SHAPES.slice(FL_SHAPES.indexOf("lash"));
    expect(fresh.length).toBeGreaterThanOrEqual(24);
    for (const shape of fresh) {
      const twins = FL_SHAPES.filter((other) => other !== shape && prints.get(`shot:${other}`) === prints.get(`shot:${shape}`));
      expect([shape, twins]).toEqual([shape, []]);
    }
    for (const shape of FL_SUMMON_SHAPES) check(`summon:${shape}`, sketch((g) => drawSummon(g, 10, shape, paint.color)));
    distinct(FL_SUMMON_SHAPES.map((s) => `summon:${s}`));
    for (const look of FL_SWORD_LOOKS) for (const frame of [0, 1, 2]) check(`sword:${look}:${frame}`, sketch((g) => drawSword(g, 10, 1.9, 0.2, look, paint, frame)));
    distinct(FL_SWORD_LOOKS.map((l) => `sword:${l}:0`));
    expect(prints.get("sword:chainsaw:1")).not.toBe(prints.get("sword:chainsaw:0")); // the teeth scroll
    for (const look of FL_HAMMER_LOOKS) check(`hammer:${look}`, sketch((g) => drawHammerHead(g, 10, 0.55, paint, 14, look)));
    distinct(FL_HAMMER_LOOKS.map((l) => `hammer:${l}`));
    for (const look of FL_GUN_LOOKS) for (const shotgun of [false, true]) for (const frame of [0, 1, 2]) check(`gun:${look}:${shotgun}:${frame}`, sketch((g) => drawGun(g, 10, look, shotgun, paint, frame)));
    distinct(FL_GUN_LOOKS.map((l) => `gun:${l}:false:0`));
    expect(coloured.get("gun:minigun:false:1")).not.toBe(coloured.get("gun:minigun:false:0")); // the barrel turns (its highlight walks)
    for (const shape of ["spear", "blades", "hammer"] as FlShape[]) check(`chain:${shape}`, sketch((g) => drawChainHead(g, 10, 0.42, shape, paint)));
    for (const kick of [false, true]) check(`fist:${kick}`, sketch((g) => drawFist(g, 10, 0.36, paint, kick)));
    check("air", sketch((g) => drawAirCurl(g, 6, paint)));
    check("claws", sketch((g) => drawClaws(g, 10, 0.42, paint)));
    for (const nocked of [false, true]) check(`bow:${nocked}`, sketch((g) => drawBow(g, 10, paint, nocked)));
    expect(prints.get("bow:true")).not.toBe(prints.get("bow:false")); // the draw-back
    check("hand", sketch((g) => drawEnergyHand(g, 10, paint)));
    for (const kind of ["wand", "staff", "book"] as const) for (const open of [false, true]) check(`caster:${kind}:${open}`, sketch((g) => drawCaster(g, 10, kind, paint, open)));
    expect(prints.get("caster:book:true")).not.toBe(prints.get("caster:book:false")); // the book's 2-frame open sprite
    for (const bracers of [false, true]) check(`shield:${bracers}`, sketch((g) => drawShield(g, 10, 0.7, bracers, paint)));
    check("shieldFace", sketch((g) => drawShieldFace(g, 7, paint)));
    for (const blade of [false, true]) check(`tail:${blade}`, sketch((g) => drawTail(g, 10, 2.3, 0.22, blade, paint)));
  });

  it("draws every weapon kind, every look and every projectile shape in play – held, swung, fired, thrown – from its own canvases", { timeout: 180_000 }, () => {
    const SHOOTS = new Set<string>(["bow", "gun", "shotgun", "wand", "staff", "book", "web", "ice", "bomb"]);
    for (const kind of FL_WEAPON_KINDS) {
      const r = playPatched({ weapons: [{ kind }] }, 4000);
      expect([kind, r.seen.weapons > 0, r.seen.foreign, r.seen.unbalanced, r.blur]).toEqual([kind, true, 0, 0, 0]);
      if (SHOOTS.has(kind)) expect([kind, r.seen.projectiles > 0]).toEqual([kind, true]);
    }
    const looks: FlWeaponSpec[] = [...FL_SWORD_LOOKS.map((look): FlWeaponSpec => ({ kind: "sword", look })), ...FL_HAMMER_LOOKS.map((look): FlWeaponSpec => ({ kind: "hammer", look })), ...FL_GUN_LOOKS.map((look): FlWeaponSpec => ({ kind: "gun", look }))];
    for (const spec of looks) {
      const r = playPatched({ weapons: [spec] }, 3000);
      const label = `${spec.kind}:${spec.look}`;
      expect([label, r.seen.weapons > 0, r.seen.foreign, r.seen.unbalanced, r.blur]).toEqual([label, true, 0, 0, 0]);
    }
    for (const shape of FL_SHAPES) {
      const r = playPatched({ weapons: [{ kind: "gun", shape }] }, 2500);
      expect([shape, r.seen.projectiles > 0, r.seen.foreign, r.seen.unbalanced]).toEqual([shape, true, 0, 0]);
    }
  });

  it("plays every ability primitive – its telegraph preview, its fire and sustain – every summon, and an ultimate's super flash", { timeout: 180_000 }, () => {
    expect(Object.keys(FL_PRIM_FX).sort()).toEqual([...FL_ABILITY_PRIMITIVES].sort());
    const fast: Partial<FightLeagueSettings> = { cast: [40, 0.05, 1, 1] };
    for (const p of FL_ABILITY_PRIMITIVES) {
      const donor = FL_ROSTER.find((row) => row.ability.effects.some((e) => e.p === p));
      expect([p, donor !== undefined]).toEqual([p, true]);
      const r = playPatched({ ability: donor!.ability }, 5000, fast);
      expect([p, r.view.fighters[0].casts > 0, r.layer.telegraphs > 0, r.seen.foreign, r.seen.unbalanced, r.blur]).toEqual([p, true, true, 0, 0, 0]);
    }
    const summoner = FL_ROSTER.find((row) => row.ability.effects.some((e) => e.p === "summon"))!.ability;
    for (const shape of FL_SUMMON_SHAPES) {
      const ability: FlAbility = { ...summoner, effects: summoner.effects.map((e) => (e.p === "summon" ? { ...e, shape } : e)) };
      const r = playPatched({ ability }, 4000, fast);
      expect([shape, r.seen.minions > 0, r.seen.foreign, r.seen.unbalanced]).toEqual([shape, true, 0, 0]);
    }
    const ultimate = FL_ROSTER.find((row) => row.ability.ultimate)!;
    const r = playPatched({ ability: ultimate.ability }, 5000, fast);
    expect([ultimate.id, r.layer.callouts.has("ultimate"), r.layer.callouts.has("cast")]).toEqual([ultimate.id, true, true]);
  });
});

/* ------------------------------------------------------------------ the shake, the finale, the numbers, the banners, the trails */

describe("the mode's visual maths (fightLeagueFx.ts)", () => {
  it("shakes nothing when off, never past 0.02 × side × strength, the same for the same view and clock – and a fight does shake", { timeout: 60_000 }, () => {
    const engine = probeEngine(FOUR_SHOOTERS, 1);
    const out = { x: 0, y: 0 };
    const again = { x: 0, y: 0 };
    const count = { frames: 0, shaken: 0, offNonZero: 0, past: 0, impure: 0, nonLinear: 0 };
    probeRun(engine, 40_000, (v) => {
      count.frames++;
      for (const side of [SIDE, 1080]) {
        flShakeAt(v, v.timeMs, side, 0, out);
        if (out.x !== 0 || out.y !== 0) count.offNonZero++;
        flShakeAt(v, v.timeMs, side, 1, again);
        const unit = { x: again.x, y: again.y };
        for (const strength of [FL_SHAKE_DEFAULT, 1, 2]) {
          flShakeAt(v, v.timeMs, side, strength, out);
          const m = Math.hypot(out.x, out.y);
          if (m > FL_SHAKE_CLAMP * side * strength + 1e-9) count.past++;
          if (m > 0) count.shaken++;
          flShakeAt(v, v.timeMs, side, strength, again);
          if (again.x !== out.x || again.y !== out.y) count.impure++;
          if (Math.abs(out.x - strength * unit.x) > 1e-9 || Math.abs(out.y - strength * unit.y) > 1e-9) count.nonLinear++;
        }
      }
    });
    expect(count.frames).toBeGreaterThan(1000);
    expect(count).toMatchObject({ offNonZero: 0, past: 0, impure: 0, nonLinear: 0 });
    expect(count.shaken).toBeGreaterThan(0);
    // the strength: the setting, × 0.3 under reduced motion at its default, none while the camera's own shake is on
    expect(flShakeStrength(FL_SHAKE_DEFAULT, false, false)).toBe(FL_SHAKE_DEFAULT);
    expect(flShakeStrength(FL_SHAKE_DEFAULT, true, false)).toBeCloseTo(FL_SHAKE_DEFAULT * FL_SHAKE_REDUCED, 12);
    expect(flShakeStrength(1.5, true, false)).toBe(1.5);
    expect(flShakeStrength(1.5, false, true)).toBe(0);
    expect(flShakeStrength(0, false, false)).toBe(0);
    expect(flShakeStrength(9, false, false)).toBe(9); // uncapped
  });

  it("runs the KO finale's clock: 1 → 0.25 in 80 ms, held to 800 ms, back to 1 at 1200 ms; the effects' warp is its integral; the push-in peaks at 1.12", () => {
    expect([flFinaleScale(-5), flFinaleScale(0), flFinaleScale(FL_FINALE_MS), flFinaleScale(9000)]).toEqual([1, 1, 1, 1]);
    expect(flFinaleScale(80)).toBeCloseTo(FL_FINALE_SLOW, 12);
    for (let ms = 1; ms <= 80; ms++) expect(flFinaleScale(ms)).toBeLessThanOrEqual(flFinaleScale(ms - 1));
    for (let ms = 80; ms < 800; ms += 5) expect(flFinaleScale(ms)).toBe(FL_FINALE_SLOW);
    for (let ms = 801; ms <= FL_FINALE_MS; ms++) expect(flFinaleScale(ms)).toBeGreaterThanOrEqual(flFinaleScale(ms - 1));
    let integral = 0;
    for (let step = 0; step < 6400; step++) {
      const ms = step / 4;
      integral += 0.125 * (flFinaleScale(ms) + flFinaleScale(ms + 0.25));
      if ((step + 1) % 400 === 0) expect(flFinaleWarp(ms + 0.25)).toBeCloseTo(integral, 1);
    }
    expect(flFinaleWarp(-10)).toBe(-10);
    expect(flFinaleWarp(2000) - flFinaleWarp(1500)).toBeCloseTo(500, 9); // real time after the finale
    expect(flFinaleZoom(0)).toBe(1);
    expect(flFinaleZoom(250)).toBeCloseTo(1.12, 9);
    expect(flFinaleZoom(600)).toBeCloseTo(1.12, 9);
    expect(flFinaleZoom(FL_FINALE_MS)).toBe(1);
    const view = { finale: { from: 1000, until: 1000 + FL_FINALE_MS } } as Pick<FightLeagueView, "finale">;
    expect(flEffectNow(view, 900)).toBe(900);
    expect(flEffectNow(view, 1500)).toBeCloseTo(1000 + flFinaleWarp(500), 9);
    expect(flEffectNow({ finale: { ...view.finale, from: -1, until: -1 } } as Pick<FightLeagueView, "finale">, 1500)).toBe(1500);
  });

  it("drifts the survivors at ≤ 0.3× their cruise while the finale holds; FINAL KO at the verdict, the winner's card 900 ms in, held from the finale's end", { timeout: 60_000 }, () => {
    let checked = 0;
    for (const seed of [1, 2, 3, 4]) {
      const engine = probeEngine({ fighters: ["thor", "loki", "random", "random"], match: "1v1", hp: 60, timeCap: 0 }, seed);
      const v = probeRun(engine, 120_000);
      if (!v.finished || v.doubleKo || v.byTime || v.winnerTeam < 0) continue;
      checked++;
      expect([seed, v.finale.from, v.finale.until]).toEqual([seed, v.finishMs, v.finishMs + FL_FINALE_MS]);
      const survivors = v.fighters.filter((f) => f.alive);
      const cruise = survivors.map((f) => f.cruise);
      const prev = survivors.map((f) => ({ x: f.finX, y: f.finY }));
      let worst = 0;
      let moved = 0;
      probeRun(
        engine,
        v.finishMs + FL_FINALE_MS + 1000,
        (view) => {
          const t = view.timeMs - view.finishMs;
          survivors.forEach((f, i) => {
            const speed = Math.hypot(f.finX - prev[i].x, f.finY - prev[i].y) / (PROBE_STEP / 1000);
            prev[i].x = f.finX;
            prev[i].y = f.finY;
            if (t > 80 + PROBE_STEP && t <= 800) {
              worst = Math.max(worst, speed / Math.max(1e-9, cruise[i]));
              if (speed > 0) moved++;
            }
          });
        },
        false,
      );
      expect([seed, worst <= 0.3]).toEqual([seed, true]);
      expect([seed, moved > 0]).toEqual([seed, true]);
      const kinds: { kind: number; t: number }[] = [];
      for (let s = Math.max(0, v.bannerSerial - FL_BANNER_CAP); s < v.bannerSerial; s++) kinds.push({ kind: v.banners[s % FL_BANNER_CAP].kind, t: v.banners[s % FL_BANNER_CAP].t });
      expect(kinds.find((b) => b.kind === FB_FINAL_KO)?.t).toBe(v.finishMs);
      expect(kinds.find((b) => b.kind === FB_WIN)?.t).toBe(v.finishMs + FL_FINALE_BANNER_MS);
      expect(flWinnerShownMs(v)).toBe(v.finishMs + FL_FINALE_BANNER_MS);
      // the page holds the card from the finale's end (3.3 s on screen): a found fight records its length + the finale + the hold
      expect(flHoldStartMs(v)).toBe(v.finishMs + FL_FINALE_MS);
      expect(flHoldEndMs(v)).toBe(v.finishMs + FL_FINALE_MS + 1000 * FL_WIN_HOLD_SEC);
    }
    expect(checked).toBeGreaterThan(0);
    // without the finale (flSm off, a double KO) the hold starts with the card at the verdict; at the time cap after TIME!
    const plain = { finishMs: 5000, finale: { from: -1, until: -1, x: 0, y: 0, slot: -1 }, byTime: false };
    expect([flHoldStartMs(plain), flHoldEndMs(plain)]).toEqual([5000, 5000 + 1000 * FL_WIN_HOLD_SEC]);
    expect([flHoldStartMs({ ...plain, byTime: true }), flWinnerShownMs({ ...plain, byTime: true })]).toEqual([5000 + FL_TIME_BANNER_MS, 5000 + FL_TIME_BANNER_MS]);
  });

  it("adds a shotgun volley's pellets into one damage number (same target, same attacker, ≤ 150 ms apart)", { timeout: 60_000 }, () => {
    const engine = dummyDuel("doomslayer", 2);
    const v = engine.getFightLeagueView();
    interface Volley {
      last: number;
      hits: number;
      sum: number;
      numbers: number;
      number: FlEvent | null;
      serial: number;
    }
    const volleys: Volley[] = [];
    let serial = 0;
    let pending: { e: FlEvent; serial: number } | null = null;
    let checkedSums = 0;
    const close = (vol: Volley) => {
      // the number – still in the ring – holds the whole volley
      if (vol.number && v.eventSerial - vol.serial < FL_EVENT_CAP && vol.number.kind === EV_DAMAGE) {
        expect(vol.number.value).toBeCloseTo(vol.sum, 6);
        checkedSums++;
      }
    };
    probeRun(engine, PROBE_INTRO_MS + 20_000, () => {
      for (let s = Math.max(serial, v.eventSerial - FL_EVENT_CAP); s < v.eventSerial; s++) {
        const e = v.events[s % FL_EVENT_CAP];
        if (e.kind === EV_DAMAGE && e.slot === 1 && e.src >= 0 && e.src >> 3 === 0) pending = { e, serial: s };
        if (e.kind !== EV_HIT || e.slot !== 0) continue;
        let cur = volleys[volleys.length - 1];
        if (!cur || e.t - cur.last > FL_DAMAGE_MERGE_MS) {
          if (cur) close(cur);
          cur = { last: e.t, hits: 0, sum: 0, numbers: 0, number: null, serial: -1 };
          volleys.push(cur);
        }
        cur.hits++;
        cur.sum += e.value;
        cur.last = e.t;
        if (pending) {
          cur.numbers++;
          cur.number = pending.e;
          cur.serial = pending.serial;
          pending = null;
        }
      }
      serial = v.eventSerial;
    });
    expect(volleys.length).toBeGreaterThanOrEqual(5);
    expect(volleys.filter((vol) => vol.hits >= 2).length).toBeGreaterThan(0); // volleys of several pellets landed
    for (const vol of volleys) expect([vol.hits, vol.numbers]).toEqual([vol.hits, 1]);
    expect(checkedSums).toBeGreaterThan(0);
  });

  it("writes the banners on the intro's clock – VS 0, 3-2-1 at 450/800/1150 ms, FIGHT! at 1500 ms – and first blood exactly once a match", { timeout: 60_000 }, () => {
    const matches: [Partial<FightLeagueSettings>, number][] = [
      [FOUR_SHOOTERS, 1],
      [{ fighters: ["thor", "loki", "random", "random"], match: "1v1" }, 5],
      [{ fighters: ["goku", "vegeta", "naruto", "sasuke"], match: "2v2", hp: 80 }, 3],
    ];
    expect([...FL_VS_COUNT_MS]).toEqual([450, 800, 1150]);
    for (const [fl, seed] of matches) {
      const engine = probeEngine(fl, seed);
      const v = engine.getFightLeagueView();
      const seen: { kind: number; t: number; value: number; slot: number; at: number }[] = [];
      let serial = 0;
      const take = () => {
        for (let s = Math.max(serial, v.bannerSerial - FL_BANNER_CAP); s < v.bannerSerial; s++) {
          const b = v.banners[s % FL_BANNER_CAP];
          seen.push({ kind: b.kind, t: b.t, value: b.value, slot: b.slot, at: v.timeMs });
        }
        serial = v.bannerSerial;
      };
      probeRun(
        engine,
        200_000,
        () => {
          take();
          return v.finished && v.timeMs > flHoldEndMs(v);
        },
        false,
      );
      const label = `${fl.match}#${seed}`;
      expect([label, v.finished]).toEqual([label, true]);
      expect(seen.filter((b) => b.kind === FB_VS).map((b) => b.t)).toEqual([0]);
      expect(seen.filter((b) => b.kind === FB_COUNT).map((b) => [b.t, b.value])).toEqual([
        [450, 3],
        [800, 2],
        [1150, 1],
      ]);
      expect(seen.filter((b) => b.kind === FB_FIGHT).map((b) => b.t)).toEqual([1500]);
      // each written in the tick its cue sounds (never ahead of it, never a step late)
      for (const b of seen.filter((x) => x.kind === FB_VS || x.kind === FB_COUNT || x.kind === FB_FIGHT)) expect([label, b.t, b.at - b.t > -1e-6 && b.at - b.t <= PROBE_STEP + 1e-6]).toEqual([label, b.t, true]);
      const blood = seen.filter((b) => b.kind === FB_FIRST_BLOOD);
      expect([label, blood.length]).toEqual([label, 1]);
      expect([label, blood[0].slot, blood[0].t > 1500]).toEqual([label, v.firstBloodSlot, true]);
    }
  });

  it("samples the trails once per 60 Hz step: the same rings at 30, 60 and 144 fps", { timeout: 60_000 }, () => {
    const rings = (fps: number) => {
      const engine = probeEngine(FOUR_SHOOTERS, 1);
      const v = engine.getFightLeagueView();
      const out = new Map<string, string>();
      while (engine.getElapsedMs() < 9000) {
        engine.update(1000 / fps, 0);
        engine.consumeSoundEvents();
        const fighters = v.fighters.map((f) => `${f.trailHead}/${f.trailCount}:${Array.from(f.trail, (x) => x.toFixed(2)).join(",")}`).join("|");
        const shots = v.projectiles
          .filter((p) => p.active)
          .map((p) => `${p.trailHead}/${p.trailCount}:${Array.from(p.trail, (x) => x.toFixed(2)).join(",")}`)
          .join("|");
        out.set(v.timeMs.toFixed(3), `${fighters}#${shots}`);
      }
      return out;
    };
    const at30 = rings(30);
    const at60 = rings(60);
    const at144 = rings(144);
    let common = 0;
    let full = 0;
    for (const [t, ring] of at30) {
      if (!at60.has(t) || !at144.has(t)) continue;
      common++;
      if (ring.includes("/10:")) full++;
      expect([t, at60.get(t)]).toEqual([t, ring]);
      expect([t, at144.get(t)]).toEqual([t, ring]);
    }
    expect(common).toBeGreaterThan(200);
    expect(full).toBeGreaterThan(100); // full rings: the fighters were flying
  });
});

/* ------------------------------------------------------------------ the HUD's layout, the watermark, the plates */

describe("the HUD at the 1080 px square, the watermark badge and the 9:16 plates", () => {
  it("meets the readability minimums: names ≥ 54 px (1v1) / ≥ 30 px (3v3), the HP number ≥ 34 px and ≥ 0.8 R, damage ≥ 30, box names ≥ 26, stat lines ≥ 20, tags ≥ 22, banners ≥ 90", () => {
    const S = 1080;
    const v = probeEngine({}, 1).getFightLeagueView();
    const f = v.fighters[0];
    // a size-1 fighter's radius on the 1080 px square (display px)
    const R = (f.baseR / f.row.stats.size) * (v.field?.dk ?? 1) * (S / SIDE);
    expect(R).toBeGreaterThan(10);
    const duel = flHudLayout(S, 2, "1v1", false, R);
    expect(duel.nameFs).toBeGreaterThanOrEqual(54);
    expect(flHudLayout(S, 6, "3v3", false, R).nameFs).toBeGreaterThanOrEqual(30);
    const layouts = [duel, flHudLayout(S, 3, "ffa3", false, R), flHudLayout(S, 4, "ffa4", false, R), flHudLayout(S, 4, "2v2", false, R), flHudLayout(S, 6, "3v3", false, R), flHudLayout(S, 2, "1v1", true, R)];
    for (const lay of layouts) {
      expect(lay.ballHpFs).toBeGreaterThanOrEqual(34);
      expect(lay.ballHpFs).toBeGreaterThanOrEqual(0.8 * R);
      expect(lay.damageFs).toBeGreaterThanOrEqual(30);
      expect(lay.tagFs).toBeGreaterThanOrEqual(22);
      expect(lay.bannerFs).toBeGreaterThanOrEqual(90);
      for (const b of lay.boxes) {
        expect(b.nameFs).toBeGreaterThanOrEqual(26);
        expect(b.statFs).toBeGreaterThanOrEqual(20);
        // the rows fit their box
        expect(flBoxContentBottom(b)).toBeLessThanOrEqual(b.box.y + b.box.h + 1e-6);
      }
    }
    // the duel and the 2v2 keep two stat lines; the free-for-alls the compact boxes (one)
    expect(duel.boxes.every((b) => b.stats.length === 2 && !b.compact)).toBe(true);
    expect(flHudLayout(S, 4, "ffa4", false, R).boxes.every((b) => b.stats.length === 1 && b.compact)).toBe(true);
  });

  it("keeps the meters and stat lines clear of the watermark badge in both bottom corners of a portrait export, and its right 10 % free of text", () => {
    const sizes: [number, number][] = [
      [1080, 1920],
      [720, 1280],
    ];
    const matches: [number, string][] = [
      [2, "1v1"],
      [3, "ffa3"],
      [4, "ffa4"],
      [4, "2v2"],
    ];
    for (const [w, h] of sizes) {
      const square = exportSquare(w, h);
      const S = square.width;
      const m = badgeMetrics(S);
      for (const [n, match] of matches) {
        const lay = flHudLayout(S, n, match, true, 0.04 * S);
        for (const corner of ["bottom-left", "bottom-right"] as const) {
          // (a generous badge: wider than the real one)
          const badge = badgeRect(w, h, { width: Math.round(0.45 * S), height: m.height, inset: m.inset }, corner, square);
          for (const b of lay.boxes) {
            for (const r of [b.meter, ...b.stats]) {
              const rect: FrameRect = { x: square.x + r.x, y: square.y + r.y, width: r.w, height: r.h };
              const o = intersect(rect, badge);
              expect([`${w}x${h}`, match, corner, o.width * o.height]).toEqual([`${w}x${h}`, match, corner, 0]);
            }
            expect(square.y + flBoxContentBottom(b)).toBeLessThanOrEqual(badge.y);
          }
        }
        for (const b of lay.boxes) expect(b.box.x + b.box.w).toBeLessThanOrEqual(0.88 * S + 1e-6);
        expect(lay.right).toBeCloseTo(0.88 * S, 9);
      }
    }
  });

  it("plates a 9:16 export's bars – the names and the division above, WHO WINS? then the winner below – clear of the square and the edges", { timeout: 60_000 }, () => {
    stubDocument();
    const engine = probeEngine({ fighters: ["thor", "loki", "random", "random"], match: "1v1", hp: 60, timeCap: 0 }, 1);
    const view = engine.getFightLeagueView();
    const layer = new FightLeagueLayer();
    const crop = { sx: 175, sy: 0, side: 450, dx: 0, dy: 420, dw: 1080, dh: 1080, sourceWidth: 800, sourceHeight: 450 };
    const plates = () => {
      layer.drawStage(asCtx(fakeCanvas(W, H).ctx), view, OPTS); // (the layer reads the view and the labels as it draws)
      const frame = fakeCanvas(1080, 1920);
      layer.paintExportBackdrop(asCtx(frame.ctx), 1080, 1920, crop);
      // (the text sprites: the backdrop's two bar blits – from its pre-rendered canvas – are not plates)
      const draws = frame.ctx.calls.filter((c) => c.name === "drawImage" && (c.args[0] as FakeCanvas).ctx.calls.some((k) => k.name === "fillText"));
      const texts = draws.map((d) => String((d.args[0] as FakeCanvas).ctx.calls.find((c) => c.name === "fillText")?.args[0] ?? ""));
      const bars = frame.ctx.calls.filter((c) => c.name === "drawImage" && !draws.includes(c)).map((c) => c.args.slice(5));
      return { draws, texts, bars };
    };
    probeRun(engine, 6000);
    const during = plates();
    expect(layer.platesShown).toBe(true);
    expect(during.texts).toEqual(expect.arrayContaining(["THOR", " VS ", "LOKI", FL_DIVISION_LABELS.marvel.toUpperCase(), "WHO WINS?"]));
    // the stage fills only the bars round the square (two blits of its pre-rendered backdrop)
    expect(during.bars).toEqual([
      [0, 0, 1080, 420],
      [0, 1500, 1080, 420],
    ]);
    const lay = flPlateLayout(1080, 1920, crop.dy, crop.dy + crop.dh);
    for (const d of during.draws) {
      const y = d.args[2] as number;
      const h = d.args[4] as number;
      expect(y + h <= crop.dy + 1e-6 || y >= crop.dy + crop.dh - 1e-6).toBe(true); // never over the square
      expect(y).toBeGreaterThanOrEqual(0.06 * 1920 - 0.2 * lay.fontSize); // (the sprite's stroke padding)
      expect(y + h).toBeLessThanOrEqual(1920 - 0.06 * 1920 + 0.2 * lay.fontSize);
    }
    probeRun(engine, 120_000);
    probeRun(engine, flWinnerShownMs(view) + 100, undefined, false);
    const winner = view.fighters.find((f) => f.team === view.winnerTeam)!;
    expect(plates().texts).toContain(`${winner.row.name.toUpperCase()} WINS`);
    // off: the bars keep only the stage
    view.settings.plates = false;
    expect(plates().draws).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ determinism, settings, data attributes */

describe("the renderer's determinism, the spectacle's settings and the data attributes", () => {
  it("draws the live hit shapes with flDbg=1 (a hammer's head among them) and nothing of them without it", { timeout: 60_000 }, () => {
    stubDocument();
    const view = probeRun(dummyDuel("thor", 1), PROBE_INTRO_MS + 2000, undefined, false);
    const hammer = view.fighters[0].weapons[0];
    expect(hammer.spec.kind).toBe("hammer");
    expect(view.timeMs - hammer.shapesMs).toBeLessThanOrEqual(34); // its head was tested this step
    const layer = new FightLeagueLayer();
    const arcs = (debug: boolean) => {
      const ctx = fakeCanvas(W, H).ctx;
      layer.drawBodies(asCtx(ctx), view, { ...OPTS, debug });
      return { debugOn: layer.debugOn, arcs: ctx.calls.filter((c) => c.name === "arc").length };
    };
    const off = arcs(false);
    const on = arcs(true);
    expect([off.debugOn, on.debugOn]).toEqual([false, true]);
    expect(on.arcs).toBeGreaterThan(off.arcs);
  });

  it("draws without a clock or random numbers: no Math.random, Date.now or performance.now in the renderer", () => {
    const dir = path.join(__dirname, "../src/components/simulator/fightLeague");
    const modules = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    for (const name of ["palette", "text", "stage", "bodies", "weapons", "projectiles", "fx", "hud", "cards", "plates", "debug"]) expect(modules).toContain(`${name}.ts`);
    const files = [...modules.map((f) => path.join(dir, f)), path.join(__dirname, "../src/components/simulator/fightLeagueRenderer.ts")];
    for (const file of files) expect([path.basename(file), /Math\.random|Date\.now|performance\.now/.test(fs.readFileSync(file, "utf8"))]).toEqual([path.basename(file), false]);
  });

  it("round-trips the spectacle through the URL (flSt, flAs, flSh, flSm, flIf, flDn, flPp, flTg), writes nothing at the defaults and stays out of the fight", () => {
    const KEYS = ["flSt", "flAs", "flSh", "flSm", "flIf", "flDn", "flPp", "flTg"];
    const FIELDS = ["flStage", "flArenaStyle", "flShake", "flSlowMo", "flImpact", "flDmgNumbers", "flPlates", "flTags"] as const;
    for (const key of KEYS) expect(FIGHT_LEAGUE_URL_KEYS).toContain(key);
    const base = defaultSettings("fightLeague");
    expect(base).toMatchObject({ flStage: "lilac", flArenaStyle: "clean", flShake: FL_SHAKE_DEFAULT, flSlowMo: true, flImpact: true, flDmgNumbers: true, flPlates: true, flTags: "auto" });
    const plain = settingsToSearchParams(base);
    for (const key of KEYS) expect([key, plain.has(key)]).toEqual([key, false]);
    const s: SimulatorSettings = { ...base, flStage: "night", flArenaStyle: "neon", flShake: 1.4, flSlowMo: false, flImpact: false, flDmgNumbers: false, flPlates: false, flTags: "on" };
    const params = settingsToSearchParams(s);
    expect(Object.fromEntries(KEYS.map((k) => [k, params.get(k)]))).toEqual({ flSt: "night", flAs: "neon", flSh: "1.4", flSm: "0", flIf: "0", flDn: "0", flPp: "0", flTg: "on" });
    const back = settingsFromSearchParams(params);
    for (const field of FIELDS) expect([field, back[field]]).toEqual([field, s[field]]);
    const bad = settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flSt=pink&flAs=lava&flTg=maybe&flSm=2&flSh=abc"));
    expect(bad).toMatchObject({ flStage: "lilac", flArenaStyle: "clean", flTags: "auto", flSlowMo: true, flShake: FL_SHAKE_DEFAULT });
    expect(settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flSh=-3")).flShake).toBe(0);
    expect(settingsFromSearchParams(new URLSearchParams("mode=fightLeague&flSh=7.5")).flShake).toBe(7.5); // uncapped
    // presentational: none is an engine key, so a shake past its comfort range engages nothing (a fight's own setting does)
    for (const field of FIELDS) expect(engineSettingKeys("fightLeague")).not.toContain(field);
    expect(uncappedEngaged({ ...base, flShake: 12 })).toBe(false);
    expect(uncappedEngaged({ ...base, flHp: 5000 })).toBe(true);
  });

  it("publishes the overhaul's data attributes – the stage, the render cost, the banners and callouts shown, the counters", { timeout: 60_000 }, () => {
    const keys = ["flStage", "flArenaStyle", "flRenderMs", "flBanners", "flFirstBlood", "flPerfect", "flClutch", "flFinale", "flShakes", "flTrails", "flTelegraphs", "flDodges", "flPlates", "flDebug", "flCallouts", "flClashes2", "flGrazes"];
    for (const key of keys) expect(FIGHT_LEAGUE_DATA_KEYS).toContain(key);
    const canvases = stubDocument();
    const engine = probeEngine(FOUR_SHOOTERS, 1);
    const layer = new FightLeagueLayer();
    const { ctx } = mainContext();
    const opts: FightLeagueRenderOptions = { ...OPTS, debug: true };
    const view = probeRun(engine, 15_000, (v) => {
      drawFrame(layer, ctx, v, opts);
      tally(ctx, canvases);
    });
    layer.noteRenderMs(4);
    layer.noteRenderMs(2);
    layer.noteRenderMs(Number.NaN);
    const data: Record<string, string> = {};
    new FightLeagueDataset().write(view, layer, (k, value) => (data[k] = value));
    for (const key of FIGHT_LEAGUE_DATA_KEYS) expect([key, key in data]).toEqual([key, true]);
    expect(data).toMatchObject({ flStage: "lilac", flArenaStyle: "clean", flRenderMs: "3.80", flDebug: "1", flPlates: "0", flFinale: "0", flPerfect: "0", flClutch: "0" });
    expect(data.flBanners.split(",")).toEqual(expect.arrayContaining(["vs", "count", "fight", "firstBlood"]));
    expect(data.flFirstBlood).toBe(view.fighters[view.firstBloodSlot].row.name);
    expect(data.flCallouts.length).toBeGreaterThan(0);
    expect(Number(data.flShakes)).toBeGreaterThan(0);
    expect(Number(data.flTrails)).toBeGreaterThan(0);
    expect(Number(data.flTelegraphs)).toBeGreaterThan(0);
  });
});
