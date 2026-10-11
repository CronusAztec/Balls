import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeGraph } from "./fakeAudio";
import { fakeCanvas } from "./fakeCanvas";
import { createEngineForSettings, findSimulation, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";
import { findEllipseFociRun, transitOnBeat } from "@/lib/simulation/ellipseFociFinder";
import { availableOutcomes } from "@/lib/simulation/outcomes";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import type { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_ELLIPSE_FOCI_FIELDS,
  EF_COLLAPSE_HORIZON,
  EF_MAX_RUN_ECCENTRICITY,
  EF_PATH_POINT_BUDGET,
  EF_PITCH_SPAN,
  EF_PRESET_IDS,
  EF_RANGES,
  EF_RESTART_FIELDS,
  bedBpm,
  bloomLevel,
  collapsePasses,
  convergenceFoci,
  defaultEllipseFociFields,
  efLoopSeconds,
  ellipseFociPresetPatch,
  ellipseFociSettingsOf,
  focalDistance,
  focalPass,
  hitDegree,
  hitShare,
  ladderHz,
  launchAngles,
  loopPassCount,
  minorAxis,
  nextPsi,
  passSpreads,
  psiOf,
  rayToWall,
  readEllipseFociParams,
  resolveEllipseFociFields,
  resolveEllipseFociSettings,
  runEccentricity,
  writeEllipseFociParams,
  type EllipseFociSettings,
  type FocalPass,
} from "@/lib/physics/ellipseFoci";
import { EF_NOTES_PER_STEP, EF_PLUCK_LEVEL, EF_THINNED } from "@/lib/physics/modes/ellipseFoci";
import { EllipseFociLayer, ellipseFociExtentPx } from "@/components/simulator/ellipseFociRenderer";
import { BOARD_BALL_CEILING, MEMORY_CEILINGS } from "@/lib/uncap";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { MODE_CARD_ORDER, MODE_CATEGORIES, modesInCategory } from "@/lib/modes";
import { LOOP_HUD_MODE_TEXT, hudCounterText, loopHudCount, loopHudMessageKey } from "@/lib/loop/hud";
import { hudPluralText, parseHudPlural } from "@/lib/loop/hudPlural";
import { loopCaptionContext } from "@/lib/publish/loopCaption";
import { DEFAULT_MUSIC_SETTINGS, ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { createTranslator } from "next-intl";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- ellipse-foci --- Focus Shot (lib/physics/ellipseFoci.ts, lib/physics/modes/ellipseFoci.ts): the focal property and the
 * collapse, the loop, the sounds (through a real ToneGenerator on tests/fakeAudio.ts), the frame-rate independence, the finder,
 * the settings and the renderer's budgets.
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const base: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
const STEP = 1000 / 60;

function efEngine(patch: Partial<EllipseFociSettings> = {}, seed = 7, cfg: PhysicsConfig = config): PhysicsEngine {
  return createEngineForSettings(cfg, "ellipseFoci", { ...base, ellipseFoci: patch }, seed);
}

/** Steps `engine` `frames` times by `frameMs`, collecting the sound events of every frame (with the elapsed time after it). */
function run(engine: PhysicsEngine, frames: number, frameMs = STEP): { at: number; events: SoundEvent[] }[] {
  const out: { at: number; events: SoundEvent[] }[] = [];
  for (let k = 0; k < frames; k++) {
    engine.update(frameMs, 0);
    out.push({ at: engine.getElapsedMs() / 1000, events: engine.consumeSoundEvents() });
  }
  return out;
}

/** A small seeded generator for the random eccentricities and angles. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PASS: FocalPass = { dist: 0, qu: 0, qw: 0, du: 0, dw: 0, arrivalU: 0, arrivalW: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Focus Shot geometry: the focal property", () => {
  it("1. for random e in [0, 0.95], every ball fired from F1 passes within 1e-6·a of F2 at t = 2a/v", () => {
    const random = rng(11);
    let worst = 0;
    for (let trial = 0; trial < 200; trial++) {
      const e = trial === 0 ? 0 : trial === 1 ? 0.95 : 0.95 * random();
      const b = minorAxis(e);
      for (let j = 0; j < 72; j++) {
        const theta = 2 * Math.PI * random();
        // fired from F1 (u = −e) at θ from the direction of F2 (+u)
        focalPass(b, -e, Math.cos(theta), Math.sin(theta), PASS);
        worst = Math.max(worst, Math.hypot(PASS.arrivalU - e, PASS.arrivalW));
        // the path focus–wall–focus is the major axis long (2a = 2): the speed 2a / T lands it there at T
        expect(Math.abs(PASS.dist + Math.hypot(e - PASS.qu, PASS.qw) - 2)).toBeLessThan(1e-9);
        // and the wall hit is the closed form's: b² / (1 − e cos θ)
        expect(PASS.dist).toBeCloseTo(focalDistance(e, theta), 9);
      }
    }
    expect(worst).toBeLessThan(1e-6);
    // in the engine: the whole volley is on the other focus at t = T (240 steps of 4 s), every pass, alternating foci
    for (const e of [0.3, 0.65, 0.95]) {
      const engine = efEngine({ eccentricity: e });
      const v = engine.getEllipseFociView();
      run(engine, 240);
      const other = { x: v.frame.cx, y: v.frame.cy + e * v.frame.scale }; // the bottom focus (the launch is the top one)
      for (let i = 0; i < v.count; i++) expect(Math.hypot(v.x[i] - other.x, v.y[i] - other.y), `e ${e}, ball ${i}`).toBeLessThan(1e-6 * v.frame.scale);
      expect(v.convergences).toBe(1);
      expect(v.maxConvError).toBeLessThan(1e-6);
      run(engine, 240);
      for (let i = 0; i < v.count; i++) expect(Math.hypot(v.x[i] - v.frame.cx, v.y[i] - (v.frame.cy - e * v.frame.scale))).toBeLessThan(1e-6 * v.frame.scale);
      expect(v.convergences).toBe(2);
      expect(v.nonFinite).toBe(0);
    }
  });

  it("2. wall-hit times are ordered by angle, and mirrored pairs coincide", () => {
    const e = 0.65;
    const b = minorAxis(e);
    const angles = launchAngles(72, 360, 0);
    const dist = Array.from(angles, (theta) => rayToWall(b, -e, 0, Math.cos(theta), Math.sin(theta)));
    // the angle from the direction of the other focus, folded to [0, π]: the near vertex (π) first, the far one (0) last
    const folded = Array.from(angles, (theta) => Math.abs(Math.atan2(Math.sin(theta), Math.cos(theta))));
    const byAngle = [...dist.keys()].sort((i, j) => folded[j] - folded[i]);
    for (let k = 1; k < byAngle.length; k++) expect(dist[byAngle[k]]).toBeGreaterThanOrEqual(dist[byAngle[k - 1]] - 1e-12);
    // mirrored left/right pairs (θ and −θ) hit together: the audible run
    for (let i = 1; i < 36; i++) expect(Math.abs(dist[i] - dist[72 - i])).toBeLessThan(1e-12);
    // near vertex at (a − c) / v, far vertex at (a + c) / v: 0.7 s and 3.3 s of a 4 s transit (v = 2a / T)
    expect(dist[36]).toBeCloseTo(1 - e, 12);
    expect(dist[0]).toBeCloseTo(1 + e, 12);
    expect((dist[36] / 2) * 4).toBeCloseTo(0.7, 9);
    expect((dist[0] / 2) * 4).toBeCloseTo(3.3, 9);
    // the run down the ladder: the first hits at the top, the last at the bottom, never back up
    expect(hitDegree(dist[36], e)).toBe(EF_PITCH_SPAN);
    expect(hitDegree(dist[0], e)).toBe(0);
    for (let k = 1; k < byAngle.length; k++) expect(hitDegree(dist[byAngle[k]], e)).toBeLessThanOrEqual(hitDegree(dist[byAngle[k - 1]], e));
    expect(hitShare(0.5, 0)).toBe(0);
    // the engine records each ball's first wall hit at exactly that time (the corners of the trails)
    const engine = efEngine();
    const v = engine.getEllipseFociView();
    run(engine, 230);
    for (let i = 0; i < v.count; i++) {
      expect(v.vtLen[i]).toBe(2);
      const at = i * v.vertexCap + v.vtHead[i];
      expect(v.vtT[at]).toBeCloseTo((dist[i] / 2) * 4, 9);
    }
  });

  it("3. the chord's angle to the major axis does not increase from one pass to the next (measured from the direction away from the other focus)", () => {
    // ψ is the angle between a ball's chord through a focus and the long axis, on the side away from the other focus. The
    // reflection maps tan(ψ/2) to (1 − e) / (1 + e) · tan(ψ/2): ψ never grows and the swarm collapses onto the axis (the
    // undirected angle alone is not monotone: a chord can leave nearly square to the axis and come back at 25°).
    const random = rng(5);
    for (let trial = 0; trial < 60; trial++) {
      const e = 0.02 + 0.93 * random();
      const b = minorAxis(e);
      let fu = random() < 0.5 ? -e : e;
      const away = fu < 0 ? -1 : 1;
      let psi = 0.001 + (Math.PI - 0.002) * random();
      let du = away * Math.cos(psi);
      let dw = (random() < 0.5 ? 1 : -1) * Math.sin(psi);
      for (let pass = 0; pass < 30; pass++) {
        focalPass(b, fu, du, dw, PASS);
        fu = -fu;
        du = PASS.du;
        dw = PASS.dw;
        const next = psiOf(fu, du, dw);
        expect(next, `e ${e.toFixed(3)}, pass ${pass}`).toBeLessThanOrEqual(psi + 1e-9);
        expect(Math.abs(next - nextPsi(psi, e))).toBeLessThan(1e-7);
        psi = next;
      }
    }
    // the swarm's lateral spread narrows: 12 passes take the default volley to a comet along the axis
    const spreads = passSpreads(0.65, "top", launchAngles(72, 360, 0), 12);
    expect(spreads[11]).toBeLessThan(0.05 * spreads[0]);
    expect(collapsePasses(0.65, "top", launchAngles(72, 360, 0), 0.02)).toBeGreaterThan(1);
    // a circle never collapses: every chord through the centre is a diameter
    expect(collapsePasses(0, "top", launchAngles(72, 360, 0), 0.02)).toBe(-1);
  });

  it("4. with reset refire, the state at t = passes·T equals t = 0", () => {
    const engine = efEngine();
    const v = engine.getEllipseFociView();
    const snapshot = () => engine.getBalls().map((ball, i) => [v.x[i], v.y[i], ball.vx, ball.vy]);
    run(engine, 30);
    const early = snapshot();
    run(engine, 930); // t = 16 s = 4 passes × 4 s: the fresh volley leaves the start focus again
    const launch = { x: v.frame.cx, y: v.frame.cy - 0.65 * v.frame.scale };
    for (let i = 0; i < v.count; i++) expect(Math.hypot(v.x[i] - launch.x, v.y[i] - launch.y)).toBeLessThan(1e-6);
    expect(v.volleys).toBe(2);
    expect(v.seams).toBe(1);
    run(engine, 30);
    const late = snapshot();
    late.forEach((state, i) => state.forEach((value, k) => expect(Math.abs(value - early[i][k]), `ball ${i}, ${k}`).toBeLessThan(1e-6)));
    expect(engine.getCycleSeconds()).toBe(16);
    expect(engine.getLoopSeams()).toMatchObject({ count: 1, lastMs: 16000, nextMs: 32000 });
    // left to collapse, the same moment of the next loop is another state (the swarm is narrower)
    const collapse = efEngine({ reset: "collapse" });
    run(collapse, 30);
    const first = collapse.getBalls().map((ball) => [ball.x, ball.y]);
    run(collapse, 960);
    const moved = collapse.getBalls().map((ball, i) => Math.hypot(ball.x - first[i][0], ball.y - first[i][1]));
    expect(Math.max(...moved)).toBeGreaterThan(1);
    expect(collapse.getCycleSeconds()).toBeNull();
    expect(collapse.getLoopSeams()).toBeNull();
    // every pass: a volley from each focus, a loop of two transits
    expect(efLoopSeconds("every", 4, 4)).toBe(8);
    expect(efLoopSeconds("refire", 3, 2.5)).toBe(7.5);
  });

  it("5. e = 0 degenerates to a circle, with every ball back at the centre at 2R/v", () => {
    for (let k = 0; k < 16; k++) {
      focalPass(1, 0, Math.cos(k), Math.sin(k), PASS);
      expect(PASS.dist).toBeCloseTo(1, 12);
      expect(Math.hypot(PASS.arrivalU, PASS.arrivalW)).toBeLessThan(1e-12);
    }
    const engine = efEngine({ eccentricity: 0 });
    const v = engine.getEllipseFociView();
    expect(v.e).toBe(0);
    run(engine, 240);
    for (let i = 0; i < v.count; i++) expect(Math.hypot(v.x[i] - 400, v.y[i] - 300)).toBeLessThan(1e-6);
    expect(v.convergences).toBe(1);
    // half way, every ball is on the wall (radius R = the major semi-axis)
    run(engine, 120);
    for (let i = 0; i < v.count; i++) expect(Math.hypot(v.x[i] - 400, v.y[i] - 300)).toBeCloseTo(v.frame.scale, 6);
  });

  it("6. the settings resolver keeps values beyond the comfort range", () => {
    const wide = { efCount: 5000, efEccentricity: 1.5, efSize: 300, efTransit: 100, efPasses: 64, efSpread: 720, efAim: 1000, efTrail: 10 };
    expect(resolveEllipseFociFields(wide)).toMatchObject(wide);
    for (const [key, value] of Object.entries(wide)) expect(value).toBeGreaterThan(EF_RANGES[key as keyof typeof EF_RANGES].max);
    // from the minimum up, whole counts, bad values fall back
    expect(resolveEllipseFociFields({ efCount: 0, efEccentricity: -1, efTransit: 0.1, efPasses: 2.6, efSpread: "x", efLaunch: "left", efReset: "nope", efSkin: 3, efPaths: "yes" })).toMatchObject({ efCount: 1, efEccentricity: 0, efTransit: 0.5, efPasses: 3, efSpread: 360, efLaunch: "top", efReset: "refire", efSkin: "table", efPaths: false });
    // a run builds at most the memory ceiling of balls and the flattest ellipse with an inside – the setting keeps its value
    expect(MEMORY_CEILINGS.efCount).toBe(BOARD_BALL_CEILING);
    expect(resolveEllipseFociSettings({ count: 50_000 }).count).toBe(BOARD_BALL_CEILING);
    expect(resolveEllipseFociSettings({ eccentricity: 1.5 }).eccentricity).toBe(1.5);
    expect(runEccentricity(1.5)).toBe(EF_MAX_RUN_ECCENTRICITY);
    expect(runEccentricity(Number.NaN)).toBe(0);
    // and past the slider they travel through links and presets exactly
    const s = { ...defaultSettings("ellipseFoci"), ...wide };
    const back = settingsFromSearchParams(settingsToSearchParams(s));
    expect(back).toMatchObject(wide);
    expect(presetToSettings(JSON.parse(JSON.stringify(s)))).toMatchObject(wide);
    // a flat run still flies (no NaN) and a long transit still converges
    const flat = efEngine({ eccentricity: 1.5, count: 40, transitSec: 100 });
    run(flat, 120);
    expect(flat.getEllipseFociView().nonFinite).toBe(0);
    expect(flat.getEllipseFociView().e).toBe(EF_MAX_RUN_ECCENTRICITY);
  });
});

describe("Focus Shot: the mode in the catalogue", () => {
  it("is a rhythm mode after the Pendulum Wave and Spinning Hoops, with its card, its look and its HUD words in every language", () => {
    expect(MODE_IDS).toContain("ellipseFoci");
    expect(MODE_CATEGORIES.ellipseFoci).toBe("rhythm");
    expect(MODE_CARD_ORDER.indexOf("ellipseFoci")).toBe(Math.max(MODE_CARD_ORDER.indexOf("pendulum"), MODE_CARD_ORDER.indexOf("hoops")) + 1);
    expect(modesInCategory("rhythm")).toContain("ellipseFoci");
    const d = defaultSettings("ellipseFoci");
    expect(d).toMatchObject({ ...DEFAULT_ELLIPSE_FOCI_FIELDS, backgroundType: "solid", loopHud: true });
    expect(d.backgroundColors[0]).toBe("#060912");
    // other modes keep their look
    expect(defaultSettings("classic").loopHud).toBe(false);
    expect(defaultEllipseFociFields()).toEqual(DEFAULT_ELLIPSE_FOCI_FIELDS);
    const keys = LOOP_HUD_MODE_TEXT.ellipseFoci!;
    for (const catalog of [en, pl, es] as unknown as Record<string, Record<string, string>>[]) {
      const word = (key: string) => {
        const [ns, name] = loopHudMessageKey(key).split(".");
        return catalog[ns][name];
      };
      expect(word(keys.counter)).toContain("{count}");
      expect(word(keys.title).length).toBeGreaterThan(10);
      expect(Object.keys(catalog.EllipseFoci).sort()).toEqual(["canvasPasses", "canvasSubtitle", "canvasTitle"]);
      expect((catalog.Modes as unknown as Record<string, { name: string }>).ellipseFoci.name).toBe(catalog.Controls.modeEllipseFoci);
    }
    expect(en.EllipseFoci.canvasTitle).toBe("fire from one dot, hit the other");
    // the pass counter in the right plural form in every language ("1 pass", "3 passes"; Polish's few and many forms)
    expect(hudCounterText(en.EllipseFoci.canvasPasses, 0, "en")).toBe("0 passes");
    expect(hudCounterText(en.EllipseFoci.canvasPasses, 1, "en")).toBe("1 pass");
    expect(hudCounterText(en.EllipseFoci.canvasPasses, 3, "en")).toBe("3 passes");
    expect(hudCounterText(es.EllipseFoci.canvasPasses, 1, "es")).toBe("1 pasada");
    expect(hudCounterText(es.EllipseFoci.canvasPasses, 2, "es")).toBe("2 pasadas");
    expect(hudCounterText(pl.EllipseFoci.canvasPasses, 1, "pl")).toBe("1 przejście");
    expect(hudCounterText(pl.EllipseFoci.canvasPasses, 3, "pl")).toBe("3 przejścia");
    expect(hudCounterText(pl.EllipseFoci.canvasPasses, 5, "pl")).toBe("5 przejść");
    expect(hudCounterText(pl.EllipseFoci.canvasPasses, 0, "pl")).toBe("0 przejść");
    // a template without the plural argument is untouched, an exact `=n` option wins, `#` is the count, a broken one stays as typed
    expect(hudPluralText("{count} bounces", 1)).toBe("{count} bounces");
    expect(hudPluralText("{count, plural, =0 {none yet} one {# pass} other {# passes}} so far", 0)).toBe("none yet so far");
    expect(hudPluralText("{count, plural, =0 {none yet} one {# pass} other {# passes}} so far", 1)).toBe("1 pass so far");
    expect(hudPluralText("{count, plural, one {# pass}", 2)).toBe("{count, plural, one {# pass}");
    expect(parseHudPlural("{count, plural, one {# pass}}")).toBeNull(); // no `other`
  });

  it("counts the HUD's passes in the loop when the pass counter is on, and gives the caption its volley", () => {
    const engine = efEngine();
    expect(loopHudCount(engine)).toBeNull();
    const counted = efEngine({ counter: true });
    expect(loopHudCount(counted)).toBe(0);
    run(counted, 241);
    expect(loopHudCount(counted)).toBe(1);
    run(counted, 720); // t ≈ 16 s: the seam – the loop's count starts over with the fresh volley
    expect(loopHudCount(counted)).toBe(0);
    expect(loopPassCount("collapse", 4, 9)).toBe(9);
    expect(loopPassCount("every", 4, 9)).toBe(1);
    expect(loopCaptionContext({ mode: "ellipseFoci", recordingDuration: 16, efCount: 72 })).toEqual({ mode: "ellipseFoci", hookKey: "ellipseFoci", factKey: "ellipseFociFact", count: 72 });
  });
});

describe("Focus Shot: sound", () => {
  const plucksOf = (frames: { at: number; events: SoundEvent[] }[]) => frames.map((f) => f.events.filter((ev) => ev.loop === "pluck"));

  it("plays every wall hit as a pluck down the pentatonic ladder in hit order within a transit", () => {
    const engine = efEngine();
    const frames = run(engine, 239);
    const steps = plucksOf(frames).filter((p) => p.length > 0);
    expect(steps.length).toBeGreaterThan(20);
    const ladder = new Set(Array.from({ length: EF_PITCH_SPAN + 1 }, (_, d) => ladderHz(d)));
    for (const step of steps) for (const ev of step) expect(ladder.has(ev.frequency!)).toBe(true);
    // the run goes down: a later step's highest note is no higher than an earlier step's lowest
    for (let k = 1; k < steps.length; k++) expect(Math.max(...steps[k].map((ev) => ev.frequency!))).toBeLessThanOrEqual(Math.min(...steps[k - 1].map((ev) => ev.frequency!)));
    expect(steps[0][0].frequency).toBe(ladderHz(EF_PITCH_SPAN));
    expect(steps[steps.length - 1].some((ev) => ev.frequency === ladderHz(0))).toBe(true);
    // 72 hits a transit, every one heard (no cap at this size)
    expect(engine.getEllipseFociView().hits).toBe(72);
  });

  it("plays at most 6 notes a step at 1/√n of a pluck (a step's notes carry one pluck's energy at most)", () => {
    const engine = efEngine({ count: 720 });
    let merged = 0;
    for (const step of plucksOf(run(engine, 480))) {
      expect(step.length).toBeLessThanOrEqual(EF_NOTES_PER_STEP);
      const energy = step.reduce((sum, ev) => sum + (ev.level ?? 1) ** 2, 0);
      expect(energy).toBeLessThanOrEqual(EF_PLUCK_LEVEL ** 2 + 1e-9);
      for (const ev of step) expect(ev.level!).toBeLessThanOrEqual(EF_PLUCK_LEVEL);
      if (step.some((ev) => ev.level! < EF_PLUCK_LEVEL - 1e-9)) merged++;
    }
    // 720 hits a pass, a few a step: the notes of a step share one pluck's energy
    expect(merged).toBeGreaterThan(10);
    expect(engine.getEllipseFociView().hits).toBe(1440);
    // a circle sends every ball to the wall at once: 720 hits in one step, one note
    const circle = efEngine({ count: 720, eccentricity: 0 });
    const together = plucksOf(run(circle, 130)).filter((step) => step.length > 0);
    expect(together.length).toBe(1);
    expect(together[0].length).toBe(1);
    expect(together[0][0].level).toBeCloseTo(EF_PLUCK_LEVEL, 12);
  });

  it("lands the impact (kick, crack, chord) on every convergence, the completion chord on the seam, after the pre-drop", () => {
    const engine = efEngine();
    const frames = run(engine, 1200);
    const impacts = frames.filter((f) => f.events.some((ev) => ev.loop === "impact")).map((f) => f.at);
    // the volley's start, then every 4 s (each convergence lands in the step that crosses it)
    expect(impacts.length).toBe(6);
    impacts.slice(1).forEach((at, k) => expect(at - 4 * (k + 1)).toBeGreaterThanOrEqual(-1e-9));
    impacts.slice(1).forEach((at, k) => expect(at - 4 * (k + 1)).toBeLessThan(STEP / 1000 + 1e-9));
    const chords = frames.filter((f) => f.events.some((ev) => ev.loop === "chord")).map((f) => Math.round(f.at));
    expect(chords).toEqual([0, 16]);
    // a flat pool's last hits fall in the 0.4 s before a convergence: those plucks are 12 dB softer
    const flat = efEngine({ eccentricity: 0.9 });
    let thinned = 0;
    for (const f of run(flat, 240)) {
      for (const ev of f.events) {
        if (ev.loop !== "pluck") continue;
        if (4 - f.at < 0.4 - STEP / 1000) {
          expect(ev.level!).toBeLessThanOrEqual(EF_PLUCK_LEVEL * EF_THINNED + 1e-9);
          thinned++;
        }
      }
    }
    expect(thinned).toBeGreaterThan(0);
  });

  it("runs the groove bed at 8 · 60 / T BPM: a kick on every beat between the convergences, the drop at the loop's first", () => {
    const engine = efEngine();
    const frames = run(engine, 1199);
    const kicks = frames.flatMap((f) => f.events.filter((ev) => ev.loop === "kick").map(() => f.at));
    expect(bedBpm(4)).toBe(120);
    // no kick in the loop's first pass (the bed's pad alone), 7 a pass after (the 8th beat is the convergence's impact)
    expect(kicks.filter((at) => at < 4).length).toBe(0);
    expect(kicks.filter((at) => at >= 4 && at < 16).length).toBe(21);
    expect(kicks.filter((at) => at >= 16).length).toBe(0);
    const beds = frames.filter((f) => f.events.some((ev) => ev.loop === "bed"));
    expect(beds.length).toBe(5); // the start and the first four convergences: a chord a pass
    // without the bed: no pad, no kicks
    const dry = efEngine({ bed: false });
    const dryEvents = run(dry, 600).flatMap((f) => f.events);
    expect(dryEvents.some((ev) => ev.loop === "bed" || ev.loop === "kick")).toBe(false);
    expect(dryEvents.some((ev) => ev.loop === "impact")).toBe(true);
    // switched off mid-run: the bed stops
    const live = efEngine();
    run(live, 60);
    live.setEllipseFociSettings({ bed: false });
    expect(run(live, 2).flatMap((f) => f.events).some((ev) => ev.loop === "bedStop")).toBe(true);
  });

  it("schedules its sounds on a ToneGenerator at the context's time (fakeAudio): plucks on the ladder, the impact's chord at the convergence", async () => {
    const graph = fakeGraph();
    vi.stubGlobal("window", { AudioContext: function FakeAudioContext() { return graph.ctx; } });
    const tone = new ToneGenerator();
    await tone.start();
    tone.setMusicSettings({ ...DEFAULT_MUSIC_SETTINGS });
    const playLoop = vi.spyOn(tone, "playLoop");
    const engine = efEngine();
    let sent = 0;
    for (let k = 0; k < 250; k++) {
      engine.update(STEP, 0);
      graph.ctx.currentTime = engine.getElapsedMs() / 1000;
      for (const ev of engine.consumeSoundEvents()) {
        playSoundEvent(tone, ev, () => undefined);
        sent++;
      }
    }
    expect(playLoop).toHaveBeenCalledTimes(sent);
    expect(sent).toBe(engine.getEllipseFociView().sounds);
    // the wall hits' fundamentals are on the ladder (D4..A6), started while the volley flies
    const ladder = Array.from({ length: EF_PITCH_SPAN + 1 }, (_, d) => ladderHz(d));
    const flying = graph.oscillators.filter((o) => o.startAt > 0.6 && o.startAt < 3.4);
    expect(flying.some((o) => ladder.some((f) => Math.abs(o.frequency - f) < 1e-6))).toBe(true);
    // the convergence at 4 s strikes the tonic chord on G3 (196 Hz)
    const atConvergence = graph.oscillators.filter((o) => Math.abs(o.startAt - 4) < 0.05);
    expect(atConvergence.some((o) => Math.abs(o.frequency - 196) < 0.5)).toBe(true);
  });
});

describe("Focus Shot: frame rates, seeds and replays", () => {
  /** The balls 0, 1 and 36 (× 1000, rounded) at 2.5 s, the counters at 8 s and a hash of the sound events. */
  function fingerprint(fps: number, seed = 7) {
    const engine = efEngine({}, seed);
    const v = engine.getEllipseFociView();
    let hash = 0x811c9dc5;
    let samples: number[][] = [];
    const frames = 8 * fps;
    for (let k = 1; k <= frames; k++) {
      engine.update(1000 / fps, 0);
      for (const ev of engine.consumeSoundEvents()) {
        const text = `${ev.loop}:${Math.round((ev.frequency ?? 0) * 100)}:${Math.round((ev.level ?? 1) * 1000)}:${ev.loopMinor ? 1 : 0}`;
        for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
      }
      if (k === 2.5 * fps) samples = [0, 1, 36].map((i) => [Math.round(v.x[i] * 1000), Math.round(v.y[i] * 1000)]);
    }
    return { samples, hits: v.hits, convergences: v.convergences, volleys: v.volleys, sounds: v.sounds, hash: hash.toString(16), hue: v.hueOffset, chords: v.chord };
  }

  it("replays a seed identically at 30, 60 and 120 frames a second (pinned)", () => {
    const ref = fingerprint(60);
    expect(ref.samples).toEqual([
      [400000, 453000],
      [427781, 451787],
      [400000, 274500], // up to the near vertex (0.7 s), then back down through its focus
    ]);
    expect([ref.hits, ref.convergences, ref.volleys]).toEqual([144, 2, 1]);
    for (const fps of [30, 120]) expect(fingerprint(fps), `${fps} fps`).toEqual(ref);
  });

  it("draws its colours and the bed's chords from the seed, in a documented order; the motion is the seed's too", () => {
    const a = fingerprint(60, 3);
    const b = fingerprint(60, 3);
    const c = fingerprint(60, 4);
    expect(a).toEqual(b);
    expect(c.hue).not.toBe(a.hue);
    // the volley does not depend on the seed: the same positions, the same events (only the bed's chords may differ)
    expect(c.samples).toEqual(a.samples);
    expect([c.hits, c.convergences, c.sounds]).toEqual([a.hits, a.convergences, a.sounds]);
    // the hue wheel by launch angle, turned by the seeded offset
    const engine = efEngine({}, 3);
    const v = engine.getEllipseFociView();
    expect((v.hues[1] - v.hues[0] + 360) % 360).toBeCloseTo(5, 3);
    expect(v.colors[0]).toMatch(/^hsl\(\d+, 95%, 62%\)$/);
  });
});

describe("Focus Shot: Find Simulation", () => {
  const request = (patch: Partial<EllipseFociSettings>, kind: "converge-on-beat" | "longest-collapse", atSec = 2, target = 30): FinderRequest => ({
    targetDurationSec: target,
    toleranceSec: 0.5,
    maxSeeds: 100,
    maxSimTimeSec: 60,
    physicsConfig: config,
    mode: "ellipseFoci",
    modeSettings: { ...base, ellipseFoci: ellipseFociSettingsOf({ ...DEFAULT_ELLIPSE_FOCI_FIELDS, ...fieldsOf(patch) }) },
    outcome: { kind, clipSec: target, atSec, team: 0 },
  });
  const fieldsOf = (patch: Partial<EllipseFociSettings>) => ({
    ...(patch.transitSec !== undefined ? { efTransit: patch.transitSec } : {}),
    ...(patch.eccentricity !== undefined ? { efEccentricity: patch.eccentricity } : {}),
    ...(patch.count !== undefined ? { efCount: patch.count } : {}),
  });

  it("offers converges on the beat and the longest collapse, never the run length (the loop goes on forever)", () => {
    expect(availableOutcomes("ellipseFoci", { endless: true, neverEscape: false, ballCount: 1 })).toEqual(["converge-on-beat", "longest-collapse"]);
    expect(availableOutcomes("classic", { endless: false, neverEscape: false, ballCount: 1 })).not.toContain("converge-on-beat");
  });

  it("puts the convergences on the beat: the transit becomes whole bars of the tempo, the clip whole loops", async () => {
    expect(transitOnBeat(4, 2)).toEqual({ transitSec: 4, bars: 2 });
    expect(transitOnBeat(4, 2.4)).toEqual({ transitSec: 4.8, bars: 2 }); // 100 BPM: a 19.2 s loop of four passes
    expect(transitOnBeat(0.3, 2)).toEqual({ transitSec: 2, bars: 1 });
    const at120 = findEllipseFociRun(request({}, "converge-on-beat", 2), 99);
    expect(at120).toMatchObject({ found: true, seed: 99, duration: 16, outcome: "converge-on-beat", ellipseFoci: { transitSec: 4, bars: 2, loopSec: 16, loops: 1 } });
    const at100 = findEllipseFociRun(request({ transitSec: 4.1 }, "converge-on-beat", 2.4, 60), 1);
    expect(at100.ellipseFoci).toMatchObject({ transitSec: 4.8, bars: 2, loops: 3 });
    expect(at100.duration).toBeCloseTo(57.6, 9);
    // through the finder's front door
    const viaFinder = await findSimulation(request({}, "converge-on-beat", 2), () => undefined);
    expect(viaFinder).toMatchObject({ found: true, outcome: "converge-on-beat", ellipseFoci: { transitSec: 4 } });
  });

  it("words its results in every language, with plurals", () => {
    for (const [locale, messages] of Object.entries({ en, pl, es })) {
      const t = createTranslator({ locale, messages, namespace: "Rigged" });
      for (const loops of [1, 2, 5]) {
        const text = t("foundConvergeOnBeat", { transit: "4.80", bars: 2, loops });
        expect(text, locale).toContain("4.80");
        expect(text, locale).toContain(String(loops));
      }
      expect(t("foundLongestCollapse", { aim: "2.5", passes: 7 })).toContain("7");
      expect(t("hintConvergeOnBeat").length).toBeGreaterThan(40);
    }
    const t = createTranslator({ locale: "en", messages: en, namespace: "Rigged" });
    expect(t("foundConvergeOnBeat", { transit: "4.80", bars: 2, loops: 1 })).toBe("Found! A convergence every 4.80s (2 bars), 1 whole loop in the clip");
    expect(t("foundLongestCollapse", { aim: "2.5", passes: 1 })).toBe("Found! Start angle 2.5°: a comet after 1 pass");
  });

  it("finds the start angle of the longest collapse within one step of the volley, and nothing for a circle", () => {
    const found = findEllipseFociRun(request({}, "longest-collapse"), 5);
    expect(found.found).toBe(true);
    expect(found.outcome).toBe("longest-collapse");
    expect(found.ellipseFoci!.aimDeg).toBeGreaterThanOrEqual(0);
    expect(found.ellipseFoci!.aimDeg).toBeLessThan(5);
    expect(found.ellipseFoci!.collapse).toBeGreaterThanOrEqual(1);
    expect(found.ellipseFoci!.collapse).toBeLessThanOrEqual(EF_COLLAPSE_HORIZON);
    expect(found.duration).toBe((found.ellipseFoci!.collapse + 1) * 4); // the passes until the comet, and the comet's
    const circle = findEllipseFociRun(request({ eccentricity: 0 }, "longest-collapse"), 5);
    expect(circle.found).toBe(false);
    expect(circle.ellipseFoci!.collapse).toBe(-1);
  });
});

describe("Focus Shot: settings, links and presets", () => {
  it("writes only what differs from the mode's defaults, under its short keys, and reads it back", () => {
    expect([...settingsToSearchParams(defaultSettings("ellipseFoci")).keys()].filter((k) => k.startsWith("ef"))).toEqual([]);
    const changed = { ...DEFAULT_ELLIPSE_FOCI_FIELDS, efCount: 120, efEccentricity: 0.8, efSize: 90, efTransit: 2.5, efPasses: 6, efSpread: 90, efAim: 12.5, efTrail: 0.5, efLaunch: "bottom" as const, efOrientation: "horizontal" as const, efReset: "every" as const, efSkin: "neon" as const, efPaths: true, efBed: false, efCounter: true };
    const params = new URLSearchParams();
    writeEllipseFociParams(changed, DEFAULT_ELLIPSE_FOCI_FIELDS, params);
    expect(params.toString()).toBe("efN=120&efE=0.8&efS=90&efT=2.5&efP=6&efA=90&efAim=12.5&efTr=0.5&efF=bottom&efO=horizontal&efR=every&efK=neon&efPa=1&efB=0&efC=1");
    const read = defaultEllipseFociFields();
    readEllipseFociParams(params, read);
    expect(read).toEqual(changed);
    const page = settingsFromSearchParams(new URLSearchParams(`mode=ellipseFoci&${params.toString()}`));
    expect(page).toMatchObject(changed);
    // the run restarts on the volley, the pool and the timing; the look, the bed and the counter follow live
    expect(EF_RESTART_FIELDS).not.toContain("efTrail");
    expect(EF_RESTART_FIELDS).not.toContain("efSkin");
    expect(EF_RESTART_FIELDS).toContain("efReset");
  });

  it("has five presets with the clip's look", () => {
    expect(EF_PRESET_IDS).toEqual(["gallery", "billiard", "thousand", "circle", "fan"]);
    expect(ellipseFociPresetPatch("gallery")).toMatchObject({ efCount: 72, efEccentricity: 0.65, efTransit: 4, efPasses: 4, loopHud: true });
    expect(ellipseFociPresetPatch("billiard")).toMatchObject({ efCount: 1, efTrail: 2, efPaths: true });
    expect(ellipseFociPresetPatch("thousand")).toMatchObject({ efCount: 720, efTrail: 0.3 });
    expect(ellipseFociPresetPatch("circle")).toMatchObject({ efEccentricity: 0 });
    expect(ellipseFociPresetPatch("fan")).toMatchObject({ efSpread: 90 });
    for (const id of EF_PRESET_IDS) expect(presetToSettings({ mode: "ellipseFoci", ...ellipseFociPresetPatch(id) })).toMatchObject(ellipseFociPresetPatch(id));
    // a fan of one ball flies straight at the other focus; a 90° fan spans ±45°
    expect(Array.from(launchAngles(1, 90, 0))).toEqual([0]);
    const fan = launchAngles(5, 90, 0);
    expect(fan[0]).toBeCloseTo(-Math.PI / 4, 12);
    expect(fan[4]).toBeCloseTo(Math.PI / 4, 12);
  });
});

describe("Focus Shot: the renderer", () => {
  /** A fake 2D context that also knows ellipses and radial gradients. */
  function ctxOf() {
    const canvas = fakeCanvas(800, 600);
    const ctx = canvas.ctx;
    ctx.ellipse = (...args: unknown[]) => void ctx.calls.push({ name: "ellipse", args });
    ctx.createRadialGradient = (...args: unknown[]) => {
      ctx.calls.push({ name: "createRadialGradient", args });
      return { addColorStop: () => undefined };
    };
    return ctx;
  }
  const options = { dpr: 2, wallColor: "#ffffff", wallThickness: 2, showGlow: false };

  it("draws the table, the foci, comet trails and the bloom; the paths stay within the Lines stroke budget", () => {
    for (const count of [72, 720, 2000]) {
      const engine = efEngine({ count, paths: true, trailSec: 0.3 });
      run(engine, 237); // 3.95 s: the bloom swells toward the convergence
      const v = engine.getEllipseFociView();
      const layer = new EllipseFociLayer();
      const ctx = ctxOf();
      layer.drawStage(ctx as unknown as CanvasRenderingContext2D, v, options);
      layer.drawBodies(ctx as unknown as CanvasRenderingContext2D, v, options);
      expect(layer.pathPoints, `${count} balls`).toBeGreaterThan(0);
      expect(layer.pathPoints, `${count} balls`).toBeLessThanOrEqual(EF_PATH_POINT_BUDGET);
      expect(layer.trailPoints).toBeGreaterThanOrEqual(2 * count);
      expect(layer.bloom).toBeGreaterThan(0.1);
      // the rim, the felt and the rail: ellipses; the balls batched by hue (one fill per bucket, not per ball)
      expect(ctx.calls.filter((c) => c.name === "ellipse").length).toBeGreaterThanOrEqual(5);
      expect(ctx.calls.filter((c) => c.name === "fill").length).toBeLessThan(200);
    }
    // the bloom: 120 ms up to the convergence, 400 ms down after it
    expect(bloomLevel(0)).toBe(1);
    expect(bloomLevel(-0.12)).toBe(0);
    expect(bloomLevel(0.4)).toBe(0);
    expect(bloomLevel(0.2)).toBeCloseTo(0.25, 12);
    // where it flashes: the arrival focus, and the start focus too when a refire leaves from the other one
    expect(convergenceFoci("refire", 4, 1, -0.65)).toEqual({ arrival: 0.65, launch: null });
    expect(convergenceFoci("refire", 4, 4, -0.65)).toEqual({ arrival: -0.65, launch: -0.65 });
    expect(convergenceFoci("refire", 3, 3, -0.65)).toEqual({ arrival: 0.65, launch: -0.65 });
    expect(convergenceFoci("every", 4, 3, -0.65)).toEqual({ arrival: 0.65, launch: 0.65 });
    expect(convergenceFoci("collapse", 4, 2, -0.65)).toEqual({ arrival: -0.65, launch: null });
    // the pool's reach above and below its centre (the HUD keeps clear of it): the long semi-axis and the table's rim
    const v = efEngine().getEllipseFociView();
    expect(ellipseFociExtentPx(v)).toBeGreaterThan(v.frame.scale);
    expect(ellipseFociExtentPx(v)).toBeLessThan(1.06 * v.frame.scale);
  });

  it("starts its trails over with a new run and never allocates per frame", () => {
    const engine = efEngine();
    const layer = new EllipseFociLayer();
    const ctx = ctxOf();
    run(engine, 60);
    layer.drawStage(ctx as unknown as CanvasRenderingContext2D, engine.getEllipseFociView(), options);
    expect(layer.trailPoints).toBeGreaterThanOrEqual(2 * 72);
    engine.initMode("ellipseFoci");
    engine.update(STEP, 0);
    layer.drawStage(ctx as unknown as CanvasRenderingContext2D, engine.getEllipseFociView(), options);
    expect(layer.trailPoints).toBe(2 * 72); // the head and the launch point of each ball (no corners yet)
  });
});
