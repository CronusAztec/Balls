import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import {
  DEFAULT_STRING_BATTLE_SETTINGS,
  SB_FINALE_RAMP_MS,
  SB_INVULN_MS,
  SB_MIN_INCIDENCE,
  StringBattleMode,
  finaleDue,
  finaleFactor,
  resolveStringBattleSettings,
  stringBattleSettingsOf,
  timeoutLeaders,
  type StringBattleSettings,
} from "@/lib/physics/modes/stringBattle";
import {
  DEFAULT_SB_DUEL,
  DEFAULT_SB_LIFE,
  SB_CIRCLE_STALL_GRACE_MS,
  SB_CIRCLE_STALL_MS,
  SB_CIRCLE_STRINGS_CAP,
  SB_DUEL_BANNER_MS,
  SB_DUEL_BPM_FROM,
  SB_DUEL_BPM_TO,
  SB_DUEL_DIP_MS,
  SB_DUEL_FINAL_DIP_MS,
  SB_DUEL_HOMING,
  SB_DUEL_TRAIL,
  SB_OPENING_MS,
  SB_RIG_BLINK_MS,
  SB_STALL_MS,
  SB_SURGE_EASE_MS,
  SB_SURGE_EVERY_MS,
  SB_SURGE_STEP,
  createDuelTrails,
  duelBpm,
  duelDroneFrequency,
  duelSurge,
  homingTurn,
  isSbLife,
  pushTrail,
  sbShieldMs,
  stallCap,
  stringsHeld,
  threadLeaders,
  threadsText,
  trailPoint,
} from "@/lib/physics/modes/stringDuel";
import { DUEL_HEARTBEAT, DUEL_RISER, droneCutoff, heartbeatDubDelay } from "@/lib/audio/stringDuelTones";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { playArenaSound, type ArenaSoundSink } from "@/lib/simulation/multi";
import { midiToFrequency } from "@/lib/audio/scales";
import { type Ball, type ModeContext, type NewBall, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { slowMoTimeScale } from "@/lib/simulation/camera";
import { CinematicCamera } from "@/components/simulator/cameraRenderer";
import { StringDuelLayer } from "@/components/simulator/stringDuelRenderer";
import StringBattleSection, { STRING_BATTLE_KEYS } from "@/components/simulator/sections/StringBattleSection";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import { SETTING_OPTIONS } from "@/lib/desktop/ai/settingsPatch";
import { stringCirclePresetPatch } from "@/lib/physics/modes/stringCircle";
import { fakeGraph } from "./fakeAudio";

/**
 * --- string-battle-alive --- The String Battle's strings life rule and its FINAL DUEL (lib/physics/modes/stringDuel.ts, the
 * `// --- string-battle-alive ---` blocks of stringBattle.ts): the settings and the URL, the strings rule on a hand-made battle
 * (the lifeline, alive while a thread holds, a slash through a fan, the shatter, touch and collide, no shield, the rig, the clip
 * verdict, the circle style, the opening, the stalemate rule), the duel (two balls left under both rules, the ramp, the surge,
 * the homing, the unchanged pre-duel part of a seed, the trails, the banner, the slow-motion dips), its soundtrack on the fake
 * audio graph (the voice budget, offline parity) and whole battles in the engine (they end; 30/60/120 fps fingerprints).
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} } as ModeSettings;
const STEP = 1000 / 60;

function battle(stringBattle: Partial<StringBattleSettings> = {}, seed = 42, cfg: PhysicsConfig = config) {
  return createEngineForSettings(cfg, "stringBattle", { ...modeSettings, stringBattle }, seed);
}

function runBattle(engine: ReturnType<typeof battle>, maxMs = 240_000, events: SoundEvent[] = []): number {
  let t = 0;
  while (t < maxMs && !engine.isSimulationFinished()) {
    engine.update(STEP, 0);
    events.push(...engine.consumeSoundEvents());
    t += STEP;
  }
  return t;
}

/* ------------------------------------------------------------------ a hand-made context */

interface Probe {
  ctx: ModeContext;
  balls: Ball[];
  sounds: SoundEvent[];
  escapes: number[];
  walls: number[];
  nearMisses: number;
  setTime(ms: number): void;
}

function probe(cfg: PhysicsConfig = config): Probe {
  let balls: Ball[] = [];
  let nextId = 0;
  let time = 0;
  let seed = 7;
  const p: Probe = { balls, sounds: [], escapes: [], walls: [], nearMisses: 0, setTime: (ms) => void (time = ms), ctx: {} as ModeContext };
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
    creditEscape: (b: Pick<Ball, "id" | "team">) => void p.escapes.push(b.team ?? -1),
    creditWallBreak: (b: Ball) => void p.walls.push(b.team ?? -1),
    noteNearMiss: () => void p.nearMisses++,
    noteImpact: () => undefined,
    setDestructionMode: () => undefined,
    setInfiniteMode: () => undefined,
    setBounceSpeedMultiplier: () => undefined,
  } as unknown as ModeContext;
  return p;
}

/** A battle of `settings` (the strings rule unless they say otherwise) started in a probe context, past its opening. */
function fight(settings: Partial<StringBattleSettings>, cfg: PhysicsConfig = config) {
  const mode = new StringBattleMode();
  mode.setSettings(settings);
  const pr = probe(cfg);
  mode.init(pr.ctx);
  mode.onPreUpdate(pr.ctx);
  pr.setTime(SB_OPENING_MS + 1000);
  return { mode, pr, view: mode.getView() };
}

/** Bounces the ball of `slot` off the ring at `angle` (a thread anchored there), then puts it `inset` px inside the ring on that radius, at rest. */
function anchorAt(mode: StringBattleMode, pr: Probe, slot: number, angle: number, inset: number) {
  const v = mode.getView();
  const ball = pr.balls.find((b) => b.team === slot)!;
  ball.x = v.cx + Math.cos(angle) * (v.radius - ball.radius + 1);
  ball.y = v.cy + Math.sin(angle) * (v.radius - ball.radius + 1);
  ball.vx = Math.cos(angle) * 200;
  ball.vy = Math.sin(angle) * 200;
  mode.onBallStep(pr.ctx, ball, 1 / 240);
  ball.x = v.cx + Math.cos(angle) * (v.radius - inset);
  ball.y = v.cy + Math.sin(angle) * (v.radius - inset);
  ball.vx = 0;
  ball.vy = 0;
  const f = v.fighters[slot];
  f.x = f.px = ball.x;
  f.y = f.py = ball.y;
  return ball;
}

/** Moves the ball of `slot` from (x0, y0) to (x1, y1) as one sub-step. */
function sweep(mode: StringBattleMode, pr: Probe, slot: number, x0: number, y0: number, x1: number, y1: number) {
  const ball = pr.balls.find((b) => b.team === slot)!;
  const f = mode.getView().fighters[slot];
  f.px = x0;
  f.py = y0;
  ball.x = x1;
  ball.y = y1;
  mode.onPostSubStep(pr.ctx);
  return ball;
}

/** Leaves ball `slot` with no thread but the one it anchors at `angle` (its lifeline dropped), parked `inset` px inside the ring. */
function onlyThread(mode: StringBattleMode, pr: Probe, slot: number, angle: number, inset: number) {
  const f = mode.getView().fighters[slot];
  f.strings.length = 0;
  return anchorAt(mode, pr, slot, angle, inset);
}

/* ------------------------------------------------------------------ settings */

describe("the life rule and the duel switch: settings, URL and presets", () => {
  it("plays the strings rule and the final duel by default, at a finale of 2×", () => {
    expect([DEFAULT_SB_LIFE, DEFAULT_SB_DUEL]).toEqual(["strings", true]);
    expect(DEFAULT_STRING_BATTLE_SETTINGS).toMatchObject({ life: "strings", duel: true, finaleSpeed: 2 });
    expect(SB_FINALE_RAMP_MS).toBe(1500);
    const d = defaultSettings("stringBattle");
    expect([d.sbLife, d.sbDuel, d.sbFinaleSpeed]).toEqual(["strings", true, 2]);
    expect(resolveStringBattleSettings({ life: "lives", duel: false })).toMatchObject({ life: "lives", duel: false });
    // anything else falls back to the defaults
    expect(resolveStringBattleSettings({ life: "hearts" as never, duel: "yes" as never })).toMatchObject({ life: "strings", duel: true });
    expect(isSbLife("strings") && isSbLife("lives") && !isSbLife("Strings") && !isSbLife(undefined)).toBe(true);
  });

  it("round-trips sblf and sbdl through the URL: absent is the default, junk is ignored", () => {
    const d = defaultSettings("stringBattle");
    const plain = settingsToSearchParams(d);
    expect(plain.has("sblf") || plain.has("sbdl")).toBe(false);
    const s: SimulatorSettings = { ...d, sbLife: "lives", sbDuel: false };
    const params = settingsToSearchParams(s);
    expect([params.get("sblf"), params.get("sbdl")]).toEqual(["lives", "0"]);
    expect(settingsFromSearchParams(params)).toEqual(s);
    const odd = settingsFromSearchParams(new URLSearchParams("mode=stringBattle&sblf=hearts&sbdl=maybe"));
    expect([odd.sbLife, odd.sbDuel]).toEqual(["strings", true]);
    const back = settingsFromSearchParams(new URLSearchParams("mode=stringBattle&sblf=lives&sbdl=1"));
    expect([back.sbLife, back.sbDuel]).toEqual(["lives", true]);
    expect(stringBattleSettingsOf(back)).toMatchObject({ life: "lives", duel: true });
  });

  it("validates presets: a known rule, a real boolean, the default for an older preset without them", () => {
    const older = presetToSettings({ mode: "stringBattle", sbLives: 3 } as unknown as Parameters<typeof presetToSettings>[0]);
    expect([older.sbLife, older.sbDuel, older.sbLives]).toEqual(["strings", true, 3]);
    const junk = presetToSettings({ mode: "stringBattle", sbLife: 4, sbDuel: "on" } as unknown as Parameters<typeof presetToSettings>[0]);
    expect([junk.sbLife, junk.sbDuel]).toEqual(["strings", true]);
    const lives = presetToSettings({ mode: "stringBattle", sbLife: "lives", sbDuel: false } as unknown as Parameters<typeof presetToSettings>[0]);
    expect([lives.sbLife, lives.sbDuel]).toEqual(["lives", false]);
    // the circle style's built-in presets keep the lives their clips were measured on
    expect(stringCirclePresetPatch("countries4").sbLife).toBe("lives");
    // the desktop assistant knows the rule's options (and the duel switch through the battle's `sb` prefix)
    expect(SETTING_OPTIONS.sbLife).toEqual(["strings", "lives"]);
  });
});

/* ------------------------------------------------------------------ the strings rule */

describe("the strings rule", () => {
  it("starts every ball with one lifeline at the rim straight behind its heading, without a random draw of its own", () => {
    const { view, pr } = fight({ balls: 4 });
    for (const f of view.fighters) {
      expect(f.strings.length).toBe(1);
      expect(f.lives).toBe(1);
      const s = f.strings[0];
      const ball = pr.balls.find((b) => b.team === f.slot)!;
      expect(Math.hypot(s.ax - view.cx, s.ay - view.cy)).toBeCloseTo(view.radius, 6);
      // behind the heading: the anchor lies on the ray from the ball against its velocity
      const dx = s.ax - ball.x;
      const dy = s.ay - ball.y;
      expect((dx * ball.vx + dy * ball.vy) / (Math.hypot(dx, dy) * Math.hypot(ball.vx, ball.vy))).toBeCloseTo(-1, 9);
    }
    // the same spawn, headings and cruising speeds as the lives rule's: the lifeline takes no draw
    const a = battle({ life: "strings" }, 9);
    const b = battle({ life: "lives" }, 9);
    expect(a.getBalls().map((x) => [x.x, x.y, x.vx, x.vy])).toEqual(b.getBalls().map((x) => [x.x, x.y, x.vx, x.vy]));
    expect(a.getStringBattleView().fighters.map((f) => f.cruise)).toEqual(b.getStringBattleView().fighters.map((f) => f.cruise));
  });

  it("keeps a ball in while one thread holds; its last thread cut, it shatters at once", () => {
    const { mode, pr, view } = fight({ balls: 3 });
    onlyThread(mode, pr, 1, 0, 150);
    anchorAt(mode, pr, 1, 0.5, 150); // a second thread, out of the slash's way
    const x = view.cx + view.radius - 40;
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].alive).toBe(true);
    expect(view.fighters[1].strings.length).toBe(1);
    expect(threadsText(view.fighters).split(",")[1]).toBe("1");
    // no shield: the very next slash, at the same time, takes the last one
    const B = pr.balls.find((b) => b.team === 1)!;
    const s = view.fighters[1].strings[0];
    const mx = (s.ax + B.x) / 2;
    const my = (s.ay + B.y) / 2;
    const nx = -(B.y - s.ay);
    const ny = B.x - s.ax;
    const k = 30 / Math.hypot(nx, ny);
    sweep(mode, pr, 0, mx - nx * k, my - ny * k, mx + nx * k, my + ny * k);
    expect(view.fighters[1].alive).toBe(false);
    expect([view.fighters[1].lives, view.fighters[1].strings.length]).toEqual([0, 0]);
    expect(pr.balls.includes(B)).toBe(false);
    expect(view.bursts.length).toBe(1);
    expect(pr.sounds.some((e) => e.sbSound === "shatter")).toBe(true);
    expect(view.fighters[0].kills).toBe(1);
    expect(view.livesLost).toBe(1);
    expect(view.alive).toBe(2);
  });

  it("snaps every thread one slash crosses – a fan at once", () => {
    const { mode, pr, view } = fight({ balls: 2 });
    onlyThread(mode, pr, 1, -0.15, 150);
    anchorAt(mode, pr, 1, 0, 150);
    anchorAt(mode, pr, 1, 0.15, 150);
    const before = view.cuts;
    const x = view.cx + view.radius - 30;
    sweep(mode, pr, 0, x, view.cy - 80, x, view.cy + 80);
    expect(view.cuts - before).toBe(3);
    expect(view.threadsLost).toBe(3);
    expect(view.fighters[1].alive).toBe(false);
    expect(pr.sounds.filter((e) => e.sbSound === "pluck").length).toBe(1); // one pluck for the slash
  });

  it("touch: a ball touching an enemy laser loses its own oldest thread – once per touch; the laser stays", () => {
    const { mode, pr, view } = fight({ balls: 2, rule: "touch" });
    onlyThread(mode, pr, 1, Math.PI / 2, 160); // a laser along x = cx from the bottom of the ring up
    const toucher = view.fighters[0];
    onlyThread(mode, pr, 0, Math.PI, 100);
    anchorAt(mode, pr, 0, Math.PI + 0.4, 100);
    const oldest = toucher.strings[0];
    const A = pr.balls.find((b) => b.team === 0)!;
    // moves onto the laser
    sweep(mode, pr, 0, view.cx - 60, view.cy + view.radius - 40, view.cx + A.radius * 0.5, view.cy + view.radius - 40);
    expect(toucher.strings.length).toBe(1);
    expect(toucher.strings.includes(oldest)).toBe(false);
    expect(view.fighters[1].strings.length).toBe(1); // the laser stays
    // still on it: the same touch costs nothing more
    sweep(mode, pr, 0, A.x, A.y, A.x + 1, A.y);
    expect(toucher.strings.length).toBe(1);
    // off and back on: a new touch costs its last thread – it is out
    sweep(mode, pr, 0, A.x, A.y, view.cx - 60, A.y);
    sweep(mode, pr, 0, view.cx - 60, A.y, view.cx, A.y);
    expect(toucher.alive).toBe(false);
    expect(view.fighters[1].kills).toBe(1);
  });

  it("collide: the slower ball of a clash loses its oldest thread, with no shield after it", () => {
    const { mode, pr, view } = fight({ balls: 3, rule: "collide" });
    anchorAt(mode, pr, 0, 1, 120);
    const [a, b] = pr.balls;
    const oldest = view.fighters[0].strings[0];
    view.fighters[0].preSpeed = 100;
    view.fighters[1].preSpeed = 300;
    mode.onBallCollision(pr.ctx, a, b);
    expect(view.fighters[0].strings.length).toBe(1);
    expect(view.fighters[0].strings.includes(oldest)).toBe(false);
    expect(view.fighters[1].strings.length).toBe(1);
    mode.onBallCollision(pr.ctx, a, b); // at once: no shield
    expect(view.fighters[0].lives).toBe(0);
    mode.onPostSubStep(pr.ctx);
    expect(view.fighters[0].alive).toBe(false);
    // a dead heat costs nothing
    const { mode: m2, pr: p2, view: v2 } = fight({ balls: 2, rule: "collide" });
    v2.fighters[0].preSpeed = v2.fighters[1].preSpeed = 200;
    m2.onBallCollision(p2.ctx, p2.balls[0], p2.balls[1]);
    expect(v2.fighters.map((f) => f.strings.length)).toEqual([1, 1]);
  });

  it("holds every hit during the opening and under the FINAL DUEL banner", () => {
    expect(stringsHeld(0, -1, false)).toBe(true);
    expect(stringsHeld(SB_OPENING_MS - 1, -1, false)).toBe(true);
    expect(stringsHeld(SB_OPENING_MS, -1, false)).toBe(false);
    expect(stringsHeld(10_000, 9_500, true)).toBe(true);
    expect(stringsHeld(10_000, 9_500, false)).toBe(false);
    expect(stringsHeld(9_500 + SB_DUEL_BANNER_MS, 9_500, true)).toBe(false);
    const mode = new StringBattleMode();
    mode.setSettings({ balls: 2 });
    const pr = probe();
    mode.init(pr.ctx);
    const view = mode.getView();
    pr.setTime(500);
    onlyThread(mode, pr, 1, 0, 150);
    const x = view.cx + view.radius - 40;
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].strings.length).toBe(1);
    pr.setTime(SB_OPENING_MS);
    sweep(mode, pr, 0, x, view.cy - 30, x, view.cy + 30);
    expect(view.fighters[1].alive).toBe(false);
  });

  it("the rig: the chosen ball never loses its last thread – the hit is absorbed and it blinks", () => {
    const { mode, pr, view } = fight({ balls: 2 }, { ...config, forcedWinner: 1 });
    mode.onPreUpdate(pr.ctx);
    pr.setTime(SB_OPENING_MS + 1000);
    onlyThread(mode, pr, 1, -0.1, 150);
    anchorAt(mode, pr, 1, 0.1, 150);
    const x = view.cx + view.radius - 30;
    sweep(mode, pr, 0, x, view.cy - 80, x, view.cy + 80);
    expect(view.fighters[1].strings.length).toBe(1); // one of its two went, the last one stayed
    expect(view.fighters[1].alive).toBe(true);
    expect(view.shields).toBe(1);
    expect(view.fighters[1].hurtMs).toBe(SB_OPENING_MS + 1000);
    expect(sbShieldMs("strings", SB_INVULN_MS.cut)).toBe(SB_RIG_BLINK_MS);
    expect(sbShieldMs("lives", SB_INVULN_MS.cut)).toBe(SB_INVULN_MS.cut);
    // collide: the chosen ball's last thread holds too
    const c = fight({ balls: 2, rule: "collide" }, { ...config, forcedWinner: 0 });
    c.view.fighters[0].preSpeed = 50;
    c.view.fighters[1].preSpeed = 300;
    c.mode.onBallCollision(c.pr.ctx, c.pr.balls[0], c.pr.balls[1]);
    expect([c.view.fighters[0].strings.length, c.view.shields]).toEqual([1, 1]);
    // whole battles: the chosen ball wins under every rule
    for (const rule of ["cut", "touch", "collide"] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        const engine = battle({ rule }, seed, { ...config, forcedWinner: 2 });
        runBattle(engine);
        expect([rule, seed, engine.getStringBattleView().winner]).toEqual([rule, seed, 2]);
      }
    }
  });

  it("judges a clip limit by the live threads, then the kills and the bounces; the rig takes it while it stands", () => {
    const f = (alive: boolean, threads: number) => ({ alive, lives: alive ? 1 : 0, strings: new Array(threads).fill(0) });
    const fighters = [f(true, 3), f(true, 5), f(false, 0), f(true, 5)];
    expect(timeoutLeaders(fighters, -1, "strings")).toEqual([1, 3]);
    expect(threadLeaders(fighters, -1)).toEqual([1, 3]);
    expect(timeoutLeaders(fighters, 0, "strings")).toEqual([0]);
    expect(timeoutLeaders(fighters, 2, "strings")).toEqual([1, 3]); // out: no rig
    expect(timeoutLeaders(fighters, -1)).toEqual([0, 1, 3]); // the lives rule's call: every survivor has 1
    const { mode, pr, view } = fight({ balls: 3, duration: 20 });
    anchorAt(mode, pr, 2, 0.4, 120);
    anchorAt(mode, pr, 2, 1.4, 120);
    anchorAt(mode, pr, 1, 2.4, 120);
    pr.setTime(20_000);
    mode.onPostUpdate(pr.ctx);
    expect(view.finished).toBe(true);
    expect(view.winner).toBe(2);
    expect(pr.escapes).toEqual([2]);
  });

  it("thins the webs in a stalemate: the threads a ball keeps halve every 4 s without a knockout, never below one", () => {
    expect(stallCap(12, 0)).toBe(12);
    expect(stallCap(12, SB_STALL_MS - 1)).toBe(12);
    expect(stallCap(12, SB_STALL_MS)).toBe(6);
    expect(stallCap(12, 2 * SB_STALL_MS)).toBe(3);
    expect(stallCap(12, 3 * SB_STALL_MS)).toBe(1);
    expect(stallCap(12, 60 * SB_STALL_MS)).toBe(1);
    expect(stallCap(SB_CIRCLE_STRINGS_CAP, 4 * SB_STALL_MS)).toBe(16);
    const { mode, pr, view } = fight({ balls: 3 });
    for (let k = 0; k < 9; k++) anchorAt(mode, pr, 0, 0.3 * k, 100);
    expect(view.fighters[0].strings.length).toBe(10);
    pr.setTime(2 * SB_STALL_MS + 10);
    mode.onPostUpdate(pr.ctx);
    expect(view.threadCap).toBe(3);
    expect(view.fighters[0].strings.length).toBe(3);
    expect(view.fighters[0].alive).toBe(true);
  });

  it("thins the circle style's fans after a grace: full for 4 s after a knockout, then halved every second – battles of under a minute", () => {
    const cap = (ms: number) => stallCap(SB_CIRCLE_STRINGS_CAP, ms, SB_CIRCLE_STALL_MS, SB_CIRCLE_STALL_GRACE_MS);
    expect([SB_CIRCLE_STALL_GRACE_MS, SB_CIRCLE_STALL_MS]).toEqual([4000, 1000]);
    expect([cap(0), cap(SB_CIRCLE_STALL_GRACE_MS - 1), cap(SB_CIRCLE_STALL_GRACE_MS), cap(SB_CIRCLE_STALL_GRACE_MS + SB_CIRCLE_STALL_MS)]).toEqual([256, 256, 128, 64]);
    expect(cap(SB_CIRCLE_STALL_GRACE_MS + 7 * SB_CIRCLE_STALL_MS)).toBe(1);
    // the default page's four flags end inside the finder's horizon of a 30 s clip (60 s): measured 30–48 s on the seeds 1–10
    const page = finderRequestOfSettings(settingsFromSearchParams(new URLSearchParams("mode=stringBattle&sbst=circle")), { width: 800, height: 450 }, 60);
    for (let seed = 1; seed <= 3; seed++) {
      const engine = createEngineForSettings(page.physicsConfig, page.mode, page.modeSettings, seed);
      const ms = runBattle(engine, 120_000);
      const v = engine.getStringBattleView();
      expect([seed, v.finished, v.alive]).toEqual([seed, true, 1]);
      expect(ms).toBeLessThan(60_000);
    }
  });

  it("plays the circle style by its strings: no strings per life, out when the last one is cut", () => {
    const { view } = fight({ style: "circle", balls: 3, cut: 1 });
    for (const f of view.fighters) {
      expect(f.strings.length).toBe(1);
      expect(f.strings[0].serial).toBe(0);
    }
    // whole battles end, the last flag standing
    for (let seed = 1; seed <= 2; seed++) {
      const engine = battle({ style: "circle" }, seed);
      runBattle(engine, 300_000);
      const v = engine.getStringBattleView();
      expect([seed, v.finished, v.alive, v.circle!.lives]).toEqual([seed, true, 1, 0]);
    }
  });
});

/* ------------------------------------------------------------------ the duel */

describe("the final duel", () => {
  it("starts the finale the moment two balls are left, under both rules", () => {
    expect([finaleDue(4, 0, 0), finaleDue(3, 0, 0), finaleDue(2, 0, 0), finaleDue(1, 0, 0), finaleDue(0, 0, 0)]).toEqual([false, false, true, false, false]);
    for (const life of ["strings", "lives"] as const) {
      const engine = battle({ life, balls: 4 }, 3);
      const v = engine.getStringBattleView();
      let t = 0;
      while (v.alive > 2 && t < 120_000) {
        engine.update(STEP, 0);
        t += STEP;
      }
      expect([life, v.alive, v.finale, v.duel, v.twoLeftMs >= 0, v.finaleStartMs === v.twoLeftMs]).toEqual([life, 2, true, true, true, true]);
    }
  });

  it("ramps to 2× over 1.5 s, then surges 0.25× after every 4 s without a cut – smoothly", () => {
    expect(finaleFactor(0, 2)).toBe(1);
    expect(finaleFactor(SB_FINALE_RAMP_MS / 2, 2)).toBeCloseTo(1.5, 9);
    expect(finaleFactor(SB_FINALE_RAMP_MS, 2)).toBeCloseTo(2, 9);
    expect(finaleFactor(SB_FINALE_RAMP_MS * 4, 2, 0.5)).toBeCloseTo(2.5, 9);
    expect(duelSurge(0)).toBe(0);
    expect(duelSurge(SB_SURGE_EVERY_MS - 1)).toBe(0);
    expect(duelSurge(SB_SURGE_EVERY_MS + SB_SURGE_EASE_MS)).toBeCloseTo(SB_SURGE_STEP, 12);
    expect(duelSurge(SB_SURGE_EVERY_MS + SB_SURGE_EASE_MS / 2)).toBeCloseTo(SB_SURGE_STEP / 2, 12);
    expect(duelSurge(2 * SB_SURGE_EVERY_MS + SB_SURGE_EASE_MS)).toBeCloseTo(2 * SB_SURGE_STEP, 12);
    expect(duelSurge(100 * SB_SURGE_EVERY_MS + SB_SURGE_EASE_MS)).toBeCloseTo(100 * SB_SURGE_STEP, 9); // uncapped
    // continuous and never decreasing: no jump at a step
    let prev = 0;
    let worst = 0;
    for (let t = 0; t <= 20_000; t += 1) {
      const s = duelSurge(t);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
      worst = Math.max(worst, s - prev);
      prev = s;
    }
    expect(worst).toBeLessThan(0.002);
    // the ramp from 1: no jump at the finale's start either
    expect(finaleFactor(1, 2) - 1).toBeLessThan(1e-5);
  });

  it("banks the surge at a cut (the speed never drops), and the duel's speed climbs in a whole battle", () => {
    const { mode, pr, view } = fight({ balls: 2 });
    mode.onPostUpdate(pr.ctx); // two balls: the duel starts now
    const start = SB_OPENING_MS + 1000;
    expect(view.twoLeftMs).toBe(start);
    pr.setTime(start + SB_SURGE_EVERY_MS + SB_SURGE_EASE_MS + 100);
    mode.onPreUpdate(pr.ctx);
    const before = view.surge;
    expect(before).toBeCloseTo(SB_SURGE_STEP, 9);
    // a cut: banked, the clock starts again
    anchorAt(mode, pr, 1, 0.5, 150);
    anchorAt(mode, pr, 1, 0.6, 150);
    const B = pr.balls.find((b) => b.team === 1)!;
    const s = view.fighters[1].strings[view.fighters[1].strings.length - 1];
    const mx = (s.ax + B.x) / 2;
    const my = (s.ay + B.y) / 2;
    const nx = -(B.y - s.ay);
    const ny = B.x - s.ax;
    const k = 30 / Math.hypot(nx, ny);
    sweep(mode, pr, 0, mx - nx * k, my - ny * k, mx + nx * k, my + ny * k);
    expect(view.lastCutMs).toBe(pr.ctx.getElapsedMs());
    mode.onPreUpdate(pr.ctx);
    expect(view.surge).toBeCloseTo(before, 9);
    pr.setTime(pr.ctx.getElapsedMs() + 1000);
    mode.onPreUpdate(pr.ctx);
    expect(view.surge).toBeCloseTo(before, 9);
    expect(view.finaleFactor).toBeCloseTo(DEFAULT_STRING_BATTLE_SETTINGS.finaleSpeed + before, 9);
  });

  it("homes every ring bounce of the duel in on the opponent by at most 35°, with no random draw of its own", () => {
    expect(homingTurn(0, 0, 0, 10, 0)).toBe(0);
    expect(homingTurn(0, 0, 0, 0, 10)).toBeCloseTo(SB_DUEL_HOMING, 12);
    expect(homingTurn(0, 0, 0, 0, -10)).toBeCloseTo(-SB_DUEL_HOMING, 12);
    expect(homingTurn(0, 0, 0, 10, 1)).toBeCloseTo(Math.atan2(1, 10), 12);
    expect(homingTurn(1, 5, 5, 5, 5)).toBe(1);
    for (const heading of [-3, -1, 0, 2, 3.1]) {
      for (let k = 0; k < 24; k++) {
        const out = homingTurn(heading, 0, 0, Math.cos(k), Math.sin(k));
        const d = Math.abs(Math.atan2(Math.sin(out - heading), Math.cos(out - heading)));
        expect(d).toBeLessThanOrEqual(SB_DUEL_HOMING + 1e-12);
      }
    }
    for (let seed = 1; seed <= 6; seed++) {
      const engine = battle({}, seed);
      const v = engine.getStringBattleView();
      let minInward = Infinity;
      let t = 0;
      while (t < 240_000 && !engine.isSimulationFinished()) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        t += STEP;
        for (const b of engine.getBalls()) {
          const dx = b.x - v.cx;
          const dy = b.y - v.cy;
          const d = Math.hypot(dx, dy);
          if (d < v.radius - b.radius - 3) continue;
          const sp = Math.hypot(b.vx, b.vy);
          if (sp > 0) minInward = Math.min(minInward, -(b.vx * dx + b.vy * dy) / (sp * d));
        }
      }
      expect(v.finished).toBe(true);
      expect(v.homings).toBeGreaterThan(0);
      expect(v.maxHoming).toBeLessThanOrEqual(SB_DUEL_HOMING + 1e-9);
      expect(minInward).toBeGreaterThan(-1); // (the rebound itself keeps off the tangent)
    }
    expect(SB_MIN_INCIDENCE).toBeGreaterThan(0);
    // the switch off: no homing, the same pre-duel battle
    const off = battle({ duel: false }, 3);
    runBattle(off);
    expect([off.getStringBattleView().homings, off.getStringBattleView().duel]).toEqual([0, false]);
  });

  it("replays every existing seed exactly up to the duel (the lives rule, recorded before the duel existed)", () => {
    // Recorded on the lives rule of the commit before the duel: the step two balls were left, its cuts, lives lost, bounces and
    // the survivors' positions (× 1000). The duel only starts there – the battle before it is the one it always was.
    const RECORDED = [
      [3, "cut", 900, 14, 14, 30, [[2, 257457, 154644], [3, 392020, 207820]]],
      [4, "cut", 931, 14, 14, 28, [[1, 587825, 357041], [2, 547184, 365654]]],
      [7, "touch", 860, 14, 14, 25, [[1, 271247, 224126], [2, 363846, 118720]]],
      [42, "collide", 1794, 0, 14, 69, [[1, 241851, 229935], [2, 502114, 216797]]],
    ] as const;
    for (const [seed, rule, steps, cuts, lost, bounces, survivors] of RECORDED) {
      const engine = battle({ rule, life: "lives" }, seed);
      const v = engine.getStringBattleView();
      let step = 0;
      while (v.alive > 2 && step < 60 * 300) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        step++;
      }
      expect([seed, step, v.cuts, v.livesLost, v.bounces]).toEqual([seed, steps, cuts, lost, bounces]);
      expect(engine.getBalls().map((b) => [b.team, Math.round(b.x * 1000), Math.round(b.y * 1000)])).toEqual(survivors);
    }
  });

  it("records both balls' comet trails during the duel", () => {
    const t = createDuelTrails(2);
    const p = { x: 0, y: 0 };
    for (let k = 0; k < SB_DUEL_TRAIL + 5; k++) pushTrail(t, 1, k, -k);
    expect(t.count[1]).toBe(SB_DUEL_TRAIL);
    expect(trailPoint(t, 1, 0, p) && p.x).toBe(5); // the oldest held
    expect(trailPoint(t, 1, SB_DUEL_TRAIL - 1, p) && p.x).toBe(SB_DUEL_TRAIL + 4); // the newest
    expect(trailPoint(t, 1, SB_DUEL_TRAIL, p)).toBe(false);
    expect(trailPoint(t, 0, 0, p)).toBe(false);
    const engine = battle({ balls: 2 }, 5);
    for (let i = 0; i < 120; i++) engine.update(STEP, 0);
    const v = engine.getStringBattleView();
    expect(v.duel).toBe(true);
    for (const f of v.fighters) expect(v.trails.count[f.slot]).toBe(SB_DUEL_TRAIL);
  });

  it("emits its soundtrack on the battle's clock: the riser, a heartbeat climbing 100 → 160 BPM, a swell a cut, the tail", () => {
    expect([duelBpm(0), duelBpm(10_000), duelBpm(20_000), duelBpm(60_000)]).toEqual([SB_DUEL_BPM_FROM, 130, SB_DUEL_BPM_TO, SB_DUEL_BPM_TO]);
    expect(duelDroneFrequency(0)).toBeCloseTo(midiToFrequency(38), 9);
    expect(duelDroneFrequency(1) / duelDroneFrequency(0)).toBeCloseTo(2 ** (1 / 12), 9);
    expect(duelDroneFrequency(12)).toBeCloseTo(duelDroneFrequency(0), 9);
    const events: SoundEvent[] = [];
    const engine = battle({}, 4);
    runBattle(engine, 240_000, events);
    const v = engine.getStringBattleView();
    const duel = events.filter((e) => e.sbDuel);
    expect(duel.length).toBe(v.duelSounds);
    expect(duel[0]).toMatchObject({ sbDuel: "start", melody: false });
    expect(duel.filter((e) => e.sbDuel === "start").length).toBe(1);
    const beats = duel.filter((e) => e.sbDuel === "beat");
    expect(beats.length).toBe(v.beats);
    expect(beats.length).toBeGreaterThan(3);
    for (let i = 1; i < beats.length; i++) expect(beats[i].sbDuelBpm!).toBeGreaterThanOrEqual(beats[i - 1].sbDuelBpm!);
    expect(duel.filter((e) => e.sbDuel === "cut").length).toBe(v.duelCuts);
    expect(duel[duel.length - 1].sbDuel).toBe("final");
    expect(v.duelFinal).toBe(true);
    // no duel switch: no soundtrack
    const quiet: SoundEvent[] = [];
    runBattle(battle({ duel: false }, 4), 240_000, quiet);
    expect(quiet.some((e) => e.sbDuel)).toBe(false);
  });

  it("is deterministic: the same seed plays the same duel at 30, 60 and 120 frames a second (a pinned fingerprint)", () => {
    // Recorded when the feature was added (seed 42, the defaults: four balls, the strings rule, the duel): balls 0 and 1 (x, y × 1000)
    // every second for 6 s.
    const FINGERPRINT: number[][] = [[205753, 306994, 387136, 94638], [266449, 441095, 287669, 229858], [413825, 492585, 262010, 171102], [559845, 434278, 385477, 121810], [577639, 361183, 498857, 156658], [484613, 442521, 552620, 293275]];
    const runs = [30, 60, 120].map((fps) => {
      const engine = battle({}, 42);
      const out: number[][] = [];
      for (let f = 1; f <= 6 * fps; f++) {
        engine.update(1000 / fps, 0);
        engine.consumeSoundEvents();
        if (f % fps === 0) out.push(engine.getBalls().slice(0, 2).flatMap((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
      }
      const v = engine.getStringBattleView();
      return [out, v.cuts, v.threadsLost, v.bounces, v.alive];
    });
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
    expect(runs[0][0]).toEqual(FINGERPRINT);
  });

  it("ends every battle: every rule, style and size, with one ball standing or a shared verdict", { timeout: 120_000 }, () => {
    for (const patch of [{}, { rule: "touch" as const }, { rule: "collide" as const }, { balls: 6 }, { balls: 2 }, { style: "neon" as const }]) {
      for (let seed = 1; seed <= 3; seed++) {
        const engine = battle(patch, seed);
        runBattle(engine, 300_000);
        expect([JSON.stringify(patch), seed, engine.isSimulationFinished()]).toEqual([JSON.stringify(patch), seed, true]);
      }
    }
  });
});

/* ------------------------------------------------------------------ the drama on the canvas */

describe("the duel's drama on the canvas", () => {
  afterEach(() => vi.unstubAllGlobals());

  function duelView() {
    const engine = battle({ balls: 2 }, 7);
    for (let i = 0; i < 6; i++) engine.update(STEP, 0);
    return engine.getStringBattleView();
  }

  /** A 2D context that records the texts drawn and the transforms (everything else is a no-op). */
  function recordingCtx() {
    const texts: string[] = [];
    const scales: number[] = [];
    const target: Record<string, unknown> = {
      fillText: (text: string) => texts.push(String(text)),
      measureText: (text: string) => ({ width: 10 * String(text).length }),
      scale: (x: number) => scales.push(x),
    };
    const ctx = new Proxy(target, {
      get: (t, key) => (typeof key === "string" && !(key in t) ? (t[key] = () => {}) : t[key as string]),
      set: (t, key, value) => {
        t[key as string] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, texts, scales };
  }

  it("shows the FINAL DUEL banner once, in the two fighters' colours, inside the square and clear of its corners", () => {
    const view = duelView();
    expect(view.duel).toBe(true);
    const layer = new StringDuelLayer();
    const colors: number[] = [];
    const colorOf = (slot: number) => {
      colors.push(slot);
      return ["#ff0000", "#00ff00"][slot];
    };
    const { ctx, texts } = recordingCtx();
    let drawn = 0;
    for (let t = view.twoLeftMs; t < view.twoLeftMs + SB_DUEL_BANNER_MS + 500; t += 50) if (layer.drawBanner(ctx, view, colorOf, t, 0, 0, 800, { banner: "FINAL DUEL" })) drawn++;
    expect(drawn).toBe(Math.ceil(SB_DUEL_BANNER_MS / 50));
    expect(layer.banners).toBe(1);
    expect(texts).toContain("FINAL");
    expect(texts).toContain(" DUEL");
    expect(new Set(colors)).toEqual(new Set([0, 1]));
    layer.drawBanner(ctx, view, colorOf, view.twoLeftMs + 300, 0, 0, 800, { banner: "FINAL DUEL" });
    const b = layer.bannerBox;
    expect(b.x).toBeGreaterThan(0.08 * 800);
    expect(b.x + b.w).toBeLessThan(0.92 * 800);
    expect(b.y).toBeGreaterThan(0.3 * 800);
    expect(b.y + b.h).toBeLessThan(0.7 * 800);
    expect(layer.banners).toBe(1); // still once
  });

  it("asks the camera for a 250 ms slow-motion dip at every moment of the duel and a longer one at its final cut", () => {
    const layer = new StringDuelLayer();
    const view = duelView();
    expect(layer.frame(view)).toBeNull();
    view.duelCuts++;
    expect(layer.frame(view)).toMatchObject({ dipMs: SB_DUEL_DIP_MS });
    expect(layer.frame(view)).toBeNull();
    view.duelCuts++;
    expect(layer.frame(view)?.dipMs).toBe(SB_DUEL_DIP_MS);
    view.duelFinal = true;
    expect(layer.frame(view)?.dipMs).toBe(SB_DUEL_FINAL_DIP_MS);
    expect(layer.dips).toBe(3);
    // the camera slows the clock for the dip whatever its slow-motion switch, and counts the time it added
    const cam = new CinematicCamera();
    expect(cam.timeScale()).toBe(1);
    cam.dip(SB_DUEL_DIP_MS, 0.3);
    const scales: number[] = [];
    for (let i = 0; i < 20; i++) {
      scales.push(cam.timeScale());
      (cam as unknown as { dipElapsed: number }).dipElapsed += 16;
    }
    expect(Math.min(...scales)).toBeLessThan(0.5);
    expect(cam.timeScale()).toBe(1);
    expect(cam.dips).toBe(1);
    expect(slowMoTimeScale(125, SB_DUEL_DIP_MS, 0.3)).toBeCloseTo(0.3, 6);
  });

  // --- slow-motion --- the page's Slow motion switch off
  it("counts the duel's dips with the Slow motion switch off and applies none: the cues go on, the clock stays real time, no view between steps", () => {
    /** Canvas.tsx's order for a whole battle at 60 fps: timeScale, the fixed steps, cam.frame, the duel's cue, cam.dip, slowView. */
    const play = (slowMotion: boolean) => {
      const engine = battle({}, 4);
      const cam = new CinematicCamera();
      cam.slowMotion = slowMotion;
      const layer = new StringDuelLayer();
      let acc = 0;
      let slowest = 1;
      let views = 0;
      let frames = 0;
      while (!engine.isSimulationFinished() && frames < 60 * 600) {
        const scale = cam.timeScale();
        slowest = Math.min(slowest, scale);
        acc += STEP * scale;
        if (acc > 250) acc = 250;
        while (acc >= 16.666) {
          engine.update(16.666, 0);
          cam.afterStep(engine);
          acc -= 16.666;
        }
        cam.frame(engine, STEP, true);
        const view = engine.getStringBattleView();
        cam.modeSlowView = view.duel;
        const cue = layer.frame(view);
        if (cue) cam.dip(cue.dipMs, cue.factor);
        if (cam.slowView(engine, acc / 16.666)) views++;
        engine.consumeSoundEvents();
        frames++;
      }
      return { engine, cam, layer, slowest, views, frames };
    };
    const off = play(false);
    const on = play(true);
    expect(off.engine.isSimulationFinished()).toBe(true);
    expect(off.layer.dips).toBeGreaterThan(1); // the duel's cuts cued their dips…
    expect([off.cam.dips, off.cam.dipsSkipped]).toEqual([0, off.layer.dips]); // …which the camera counted and skipped
    expect(off.slowest).toBe(1);
    expect(off.views).toBe(0);
    expect(off.cam.getSlowLagMs()).toBe(0);
    // the same battle with the switch on: the same cues, every one applied, the balls drawn between steps – and the same run
    expect([on.cam.dips, on.cam.dipsSkipped]).toEqual([off.layer.dips, 0]);
    expect(on.layer.dips).toBe(off.layer.dips);
    expect(on.slowest).toBeLessThan(0.5);
    expect(on.views).toBeGreaterThan(0);
    expect(on.frames).toBeGreaterThan(off.frames);
    expect(off.engine.getStringBattleView().duelCuts).toBe(on.engine.getStringBattleView().duelCuts);
    expect(off.engine.getElapsedMs()).toBe(on.engine.getElapsedMs());
    expect(off.engine.getBalls().map((b) => [b.x, b.y])).toEqual(on.engine.getBalls().map((b) => [b.x, b.y]));
  });
  // --- end slow-motion ---

  it("punches the camera 4 px away from the cutter for a moment – not under reduced motion", () => {
    const view = duelView();
    view.duelCuts = 1;
    view.lastDuelCutMs = 1000;
    view.lastDuelCutter = 0;
    view.lastDuelVictim = 1;
    const layer = new StringDuelLayer();
    const out = { x: 0, y: 0 };
    expect(layer.punch(view, 1000, out)).toBe(true);
    expect(Math.hypot(out.x, out.y)).toBeCloseTo(4, 6);
    const away = (out.x * (view.fighters[1].x - view.fighters[0].x) + out.y * (view.fighters[1].y - view.fighters[0].y)) / 4;
    expect(away).toBeGreaterThan(0);
    expect(layer.punch(view, 1300, out)).toBe(false);
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true, addEventListener: () => undefined }) });
    const calm = new StringDuelLayer();
    expect(calm.reducedMotion).toBe(true);
    expect(calm.punch(view, 1000, out)).toBe(false);
    // the banner fades in place instead of popping
    const { ctx, scales } = recordingCtx();
    calm.drawBanner(ctx, duelView(), () => "#ffffff", duelView().twoLeftMs + 50, 0, 0, 800, { banner: "FINAL DUEL" });
    expect(scales.every((s) => s === 1)).toBe(true);
  });
});

/* ------------------------------------------------------------------ the soundtrack */

describe("the duel's soundtrack", () => {
  afterEach(() => vi.unstubAllGlobals());

  async function generator() {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    return { graph, tone };
  }

  it("plays a riser into a tom and starts the drone of two detuned saws; the heartbeat is a lub and a dub", async () => {
    const { graph, tone } = await generator();
    graph.ctx.currentTime = 2;
    tone.playStringDuel("start", 73.42, undefined, 1);
    const saws = graph.oscillators.filter((o) => o.type === "sawtooth");
    expect(saws.length).toBe(2);
    expect(saws[0].frequency).toBeLessThan(73.42);
    expect(saws[1].frequency).toBeGreaterThan(73.42);
    expect(graph.sources.some((s) => s.startArgs[0] === 2)).toBe(true); // the riser's noise
    const tom = graph.oscillators.find((o) => o.type === "sine" && Math.abs(o.startAt - (2 + DUEL_RISER.seconds)) < 1e-9);
    expect(tom?.frequency).toBe(DUEL_RISER.tomFrom);
    graph.ctx.currentTime = 3;
    tone.playStringDuel("beat", undefined, 120, 1.5);
    const thumps = graph.oscillators.filter((o) => o.startAt >= 3 && o.type === "sine");
    expect(thumps.map((o) => o.startAt)).toEqual([3, 3 + heartbeatDubDelay(120)]);
    expect(heartbeatDubDelay(160)).toBeLessThan(heartbeatDubDelay(100));
    expect(heartbeatDubDelay(30)).toBe(DUEL_HEARTBEAT.dubMaxSec);
    // the drone's low-pass opens with the speed
    expect(droneCutoff(1)).toBeLessThan(droneCutoff(2));
    expect(droneCutoff(1000)).toBe(8000);
    expect(graph.filters.some((f) => f.type === "lowpass")).toBe(true);
    // no second drone while one plays
    graph.ctx.currentTime = 3.5;
    tone.playStringDuel("cut", 77.78, undefined, 2);
    expect(graph.oscillators.filter((o) => o.type === "sawtooth").length).toBe(2);
    expect(graph.ramps.some((r) => r.kind === "target" && r.param === "frequency")).toBe(true); // re-pitched a semitone up
  });

  it("keeps the voice budget: one heartbeat a tick, at most 6 new swells a tick, a noise burst a tick", async () => {
    const { graph, tone } = await generator();
    graph.ctx.currentTime = 5;
    for (let i = 0; i < 10; i++) tone.playStringDuel("beat", undefined, 140, 1);
    expect(graph.oscillators.filter((o) => o.startAt === 5 && o.type === "sine").length).toBe(1); // one lub (its dub later)
    graph.ctx.currentTime = 6;
    for (let i = 0; i < 20; i++) tone.playStringDuel("cut", 73.42 * 2 ** (i / 12), undefined, 1);
    expect(graph.oscillators.filter((o) => o.startAt === 6 && o.type === "triangle").length).toBeLessThanOrEqual(6);
    graph.ctx.currentTime = 7;
    const before = graph.sources.length;
    tone.playStringDuel("final");
    tone.playStringDuel("final");
    expect(graph.sources.length - before).toBe(1);
  });

  it("renders the same in the offline twin as on the page (the fast export, the batch, the bot)", async () => {
    const { graph, tone } = await generator();
    const script: [number, Parameters<ToneGenerator["playStringDuel"]>][] = [
      [1, ["start", 73.42, undefined, 1]],
      [1.8, ["beat", undefined, 100, 1.2]],
      [2.4, ["beat", undefined, 102, 1.5]],
      [2.5, ["cut", 77.78, undefined, 2]],
      [3, ["beat", undefined, 104, 2]],
      [3.6, ["final"]],
    ];
    for (const [time, args] of script) {
      graph.ctx.currentTime = time;
      tone.playStringDuel(...args);
    }
    const offline = fakeGraph();
    let clock = 0;
    const twin = await tone.createOfflineTwin(offline.ctx as unknown as BaseAudioContext, () => clock);
    for (const [time, args] of script) {
      clock = time;
      offline.ctx.currentTime = time;
      twin.playStringDuel(...args);
    }
    const strip = (g: ReturnType<typeof fakeGraph>) => g.oscillators.map((o) => [o.type, Math.round(o.frequency * 1000), Math.round(o.startAt * 1e6)]);
    expect(strip(offline)).toEqual(strip(graph));
    expect(offline.sources.map((s) => s.startArgs)).toEqual(graph.sources.filter((s) => s.startArgs[0] >= 1).map((s) => s.startArgs));
  });

  it("is routed by every dispatch: the page's, the fast export's and the other arenas'", () => {
    const audio = { playStringDuel: vi.fn(), playWallHit: vi.fn() } as unknown as ToneGenerator;
    playSoundEvent(audio, { type: "hit", wallIndex: 0, frequency: 73.42, sbDuel: "start", sbDuelSpeed: 1, melody: false }, () => undefined);
    playSoundEvent(audio, { type: "hit", wallIndex: 0, sbDuel: "beat", sbDuelBpm: 120, sbDuelSpeed: 1.6, melody: false }, () => undefined);
    const calls = (audio as unknown as { playStringDuel: ReturnType<typeof vi.fn> }).playStringDuel.mock.calls;
    expect(calls[0]).toEqual(["start", 73.42, undefined, 1, undefined]);
    expect(calls[1]).toEqual(["beat", undefined, 120, 1.6, undefined]);
    expect((audio as unknown as { playWallHit: ReturnType<typeof vi.fn> }).playWallHit).not.toHaveBeenCalled();
    const sink = { playStringDuel: vi.fn(), playWallHit: vi.fn() } as unknown as ArenaSoundSink;
    playArenaSound(sink, { type: "hit", wallIndex: 0, sbDuel: "cut", frequency: 80, melody: false });
    expect((sink as unknown as { playStringDuel: ReturnType<typeof vi.fn> }).playStringDuel).toHaveBeenCalledTimes(1);
    expect((sink as unknown as { playWallHit: ReturnType<typeof vi.fn> }).playWallHit).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------ the panel */

describe("the String Battle block", () => {
  const CATALOGS = { en, pl, es } as Record<string, Record<string, unknown>>;

  function translator(messages: Record<string, unknown>, locale: string): Translate {
    const controls = messages.Controls as Record<string, string>;
    const t = ((key: string, values?: Record<string, unknown>) => {
      const text = controls[key];
      if (text === undefined) throw new Error(`missing ${locale} Controls.${key}`);
      return String(new IntlMessageFormat(text, locale).format(values as Record<string, string>));
    }) as unknown as Translate;
    (t as unknown as { has: (k: string) => boolean }).has = (k: string) => k in controls;
    return t;
  }

  function render(patch: Partial<SimulatorSettings> = {}, query = "", locale = "en") {
    // (the components are compiled with the classic JSX transform here – tsconfig keeps JSX for Next –: React must be global)
    (globalThis as { React?: unknown }).React = React;
    const messages = CATALOGS[locale];
    const t = translator(messages, locale);
    const settings = { ...defaultSettings("stringBattle"), ...patch };
    const q = query.toLowerCase();
    const matches = (key: string) => (t as unknown as { has: (k: string) => boolean }).has(key) && (key.toLowerCase().includes(q) || t(key).toLowerCase().includes(q));
    const html = renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(StringBattleSection, { t, search: query, matches, settings, update: () => {} })));
    return { html, t };
  }

  it("offers the life rule (strings pressed by default) and the duel, hides the lives slider under the strings rule", () => {
    expect(STRING_BATTLE_KEYS).toEqual(expect.arrayContaining(["sbLife", "sbDuel"]));
    const { html, t } = render();
    expect(html).toMatch(/aria-pressed="true"[^>]*data-life="strings"/);
    expect(html).toMatch(/aria-pressed="false"[^>]*data-life="lives"/);
    expect(html).toContain(t("sbLifeHintStrings"));
    expect(html).toContain(t("sbHintCutStrings"));
    expect(html).toContain(t("sbDuel"));
    expect(html).not.toContain(`aria-label="${t("sbLives")}"`);
    const lives = render({ sbLife: "lives" });
    expect(lives.html).toMatch(/aria-pressed="true"[^>]*data-life="lives"/);
    expect(lives.html).toContain(lives.t("sbLifeHintLives"));
    expect(lives.html).toContain(lives.t("sbHintCut"));
    expect(lives.html).toContain(`aria-label="${lives.t("sbLives")}"`);
  });

  it("hides the circle style's strings per life under the strings rule (shown under lives and in the search)", () => {
    const strings = render({ sbStyle: "circle" });
    expect(strings.html).not.toContain(`aria-label="${strings.t("scCut")}"`);
    const lives = render({ sbStyle: "circle", sbLife: "lives" });
    expect(lives.html).toContain(`aria-label="${lives.t("scCut")}"`);
    const found = render({ sbStyle: "circle" }, "life");
    expect(found.html).toContain(`aria-label="${found.t("scCut")}"`);
  });

  it("speaks Polish and Spanish too: the same keys, nothing left in English", () => {
    const keys = ["sbLife", "sbLifeTip", "sbLifeStrings", "sbLifeLives", "sbLifeHintStrings", "sbLifeHintLives", "sbHintCutStrings", "sbHintTouchStrings", "sbHintCollideStrings", "sbDuel", "sbDuelTip"];
    const enC = en.Controls as Record<string, string>;
    for (const locale of ["pl", "es"]) {
      const c = CATALOGS[locale].Controls as Record<string, string>;
      for (const key of keys) {
        expect([locale, key, typeof c[key]]).toEqual([locale, key, "string"]);
        expect([locale, key, c[key] === enC[key]]).toEqual([locale, key, false]);
      }
      expect(Object.keys(CATALOGS[locale].StringDuel as object)).toEqual(Object.keys(en.StringDuel));
      for (const k of Object.keys(en.StringDuel)) expect((CATALOGS[locale].StringDuel as Record<string, string>)[k]).not.toBe((en.StringDuel as Record<string, string>)[k]);
      for (const key of keys) expect(c[key]).not.toMatch(/—| – |;/);
      expect(render({}, "", locale).html).toContain('data-testid="string-battle-life"');
    }
  });
});
