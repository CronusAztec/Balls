import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import {
  DEFAULT_PHYSICS_EXTRAS,
  PHYSICS_EXTRA_RANGES,
  breathingScale,
  contactSpin,
  gravityAngle,
  hasPhysicsExtras,
  physicsExtrasOf,
  resolvePhysicsExtras,
  spinDecayFactor,
} from "@/lib/physics/extras";
import { MODE_IDS, type ModeId, type PhysicsConfig, type PhysicsExtras } from "@/lib/physics/types";
import { createEngineForSettings, simulateSeed, type FinderRequest, type ModeSettings } from "@/lib/simulation/finder";

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

const ALL_EXTRAS_ON: PhysicsExtras = {
  airDrag: 0.01,
  windX: 0.2,
  windY: -0.1,
  spinStrength: 0.8,
  wallBounciness: 0.9,
  breathingAmplitude: 0.15,
  breathingSpeed: 1.5,
  rotatingGravity: 45,
};

interface Fingerprint {
  /** [x, y] × 1000 of the first two balls every 150 frames. */
  samples: number[][];
  broken: number[];
  /** Wall radii × 1000 after the run. */
  walls: number[];
}

/**
 * Recorded from the engine *before* the physics extras existed (seed 12345, 600 frames of 1/60 s,
 * the config above): with every extra at its default the engine must still reproduce these exactly.
 */
const BASELINE: Record<ModeId, Fingerprint> = {
  classic: { samples: [[468595,245253],[395319,386187],[373847,209412],[496385,423388]], broken: [0, 1], walls: [123857,145714,167571,189429,211286,233143,255000] },
  accumulation: { samples: [[330900,428501],[419511,164077],[993221,788584],[1959462,3781567]], broken: [0], walls: [225000] },
  multiply: { samples: [[330900,428501],[575324,279065],[479292,306947],[569372,410448]], broken: [], walls: [225000] },
  lines: { samples: [[483187,287638],[221848,370489],[406473,492103],[385775,504614]], broken: [], walls: [225000] },
  paint: { samples: [[483187,287638],[221848,370489],[406473,492103],[385775,504614]], broken: [], walls: [225000] },
  target: { samples: [[483187,287638],[221848,370489],[406473,492103],[385775,504614]], broken: [], walls: [225000] },
  portal: { samples: [[240955,409218],[332979,471847],[563286,397283],[335122,277545]], broken: [], walls: [225000] },
  shatter: { samples: [[394180,350193],[391982,373187],[308416,175087],[271269,179878]], broken: [], walls: [80143,109286,138429,167571,196714,225857,255000] },
  colorMatch: { samples: [[543609,300177],[596383,347033],[600656,287224],[285153,381609]], broken: [], walls: [225000] },
  grow: { samples: [[384329,184131],[334553,260481],[250197,392467],[321890,452798]], broken: [], walls: [225000] },  // Ball Drop has no rings; recorded when the mode was added (seed 12345, default board: 12 balls released 0.4 s apart).
  drop: { samples: [[386190,181061],[179964,230492],[420973,497548],[219878,230933],[209300,577112],[293286,420857],[177302,577112],[361866,554952]], broken: [], walls: [] },
  // Bouncing Shapes has no rings either; re-recorded when the seeded tempo was added (seed 12345, default box: 3 squares at 3:4:5 counting down from 30).
  box: { samples: [[527615,504522],[423207,391555],[435403,165623],[448012,118213],[310434,231330],[474841,570079],[325182,570230],[503756,119127]], broken: [], walls: [] },
  // Pendulum Wave: analytic motion, no rings; recorded when the mode was added (seed 12345, default row: 15 pendulums, 51 + i swings per 60 s).
  pendulum: { samples: [[399501,400691],[379898,395526],[284800,418527],[222616,395526],[170099,400691],[147704,370097],[125166,383137],[222616,395526]], broken: [], walls: [] },
  // --- jdm-polyrhythm --- Metronomes & Polyrhythms: analytic motion, no rings; recorded when the mode was added (seed 12345, default: 16 rings, ratios 1–16 per 30 s).
  polyrhythm: { samples: [[420160,265082],[447525,272562],[434918,279840],[447525,327438],[440320,300000],[400000,354877],[434918,320160],[352475,327438]], broken: [], walls: [] },
  // --- jdm-collisions --- Collision Playground: no rings; recorded when the mode was added (seed 12345, default playground: 300 orbs in a circle, gravity 0.3, restitution 1).
  collide: { samples: [[487111,370370],[324053,350598],[415811,486674],[350075,374418],[451355,560543],[439759,425664],[412621,562530],[541650,361374]], broken: [], walls: [] },
  // --- boris-glass --- Glass Smash: no rings, one ball smashing down the shaft (seed 12345, default: 4 stages from 6 panes of 2 hits); recorded when
  // the mode was added and re-recorded when a slow touch from above became a landing (the ball grazes the edge of a hole at 6.7 s, which
  // used to only damp it and now cracks the pane and hops it – so a ball can never come to rest on unbroken glass).
  glass: { samples: [[485763,293145],[518834,716109],[329481,898042],[245066,1181480]], broken: [], walls: [] },
  // --- boris-multipliers --- Multipliers board: no rings; recorded when the mode was added (seed 12345, default board: 8 rows, one ball).
  multipliers: { samples: [[211640,191252],[266980,620146],[529953,990656],[362092,1570907],[620725,1348624],[611940,1608709],[447416,1810903],[350566,1720155]], broken: [], walls: [] },
  // --- jdm-double-pendulum --- Double Pendulum: chains in error-controlled Dormand–Prince sub-steps, no rings (seed 12345, default: one double pendulum from a seeded start,
  // 15 strings); re-recorded when the sub-steps became error-controlled – within 0.04 px of the fixed RK4 sub-steps it was recorded with when the mode was added.
  doublePendulum: { samples: [[346027,416241],[466095,461058],[522054,260913],[597547,364478],[287915,237856],[311924,363747],[507973,369042],[380583,383070]], broken: [], walls: [] },
  // --- jdm-illusions --- Circle Illusion: analytic motion, no rings; recorded when the mode was added (seed 12345, default: 8 balls on diameters, a 4 s cycle).
  illusion: { samples: [[400000,477173],[311414,513866],[400000,300000],[436694,211414],[400000,122827],[436694,211414],[400000,550560],[311414,513866]], broken: [], walls: [] },
  // --- odd-string-battle --- String Battle: its own ring, no engine walls; recorded when the mode was added (seed 12345, default: 4 balls, 4 lives, the cut rule);
  // re-recorded when every ring bounce began to draw the ball's cruising factor afresh and the whole thread became cuttable.
  stringBattle: { samples: [[449763,486112],[452897,216383],[588135,373311],[337304,357704],[242658,331390],[431619,300066],[541439,211811],[318923,247284]], broken: [], walls: [] },
  // --- odd-power-layers --- Power Layers: analytic flight, no rings; recorded when the mode was added (seed 12345, default: 120 layers, the power
  // doubling – 7 hits a second apart; the ball falls out of the field after the last one at 6.5 s, so the samples at 7.5 s and 10 s have no ball).
  powerLayers: { samples: [[286594,309928],[249290,200810]], broken: [], walls: [] },
  // --- jdm-race --- Square Racing Grand Prix: no rings, 8 racers down a seeded track (seed 12345, defaults: 8 screens, one lap, the mixed library);
  // re-recorded when the obstacle push-out gap became a fraction of the field (RACE_SEPARATION_REL; review fix modes-rhythm).
  race: { samples: [[366652,232223],[410818,232223],[517030,1190987],[544823,780700],[382814,2031574],[351419,1570399],[557840,2621068],[506624,2436924]], broken: [], walls: [] },
  // --- jdm-arena-games --- Battle Royale and Capture the Flag: no rings; recorded when the modes were added (seed 12345, defaults: 8 squares in a box / 2 – 2).
  // Re-recorded when the battle's fixed margins became reference pixels scaled with the field (a seed plays the same on any canvas).
  battle: { samples: [[374459,349977],[329182,250770],[338535,110954],[267052,343771],[595188,183924],[337396,292032],[459252,122349],[517487,427594]], broken: [], walls: [] },
  ctf: { samples: [[464260,193076],[653920,237007],[304817,457518],[313243,546485],[446150,169209],[271083,282839],[314906,501106],[633347,562433]], broken: [], walls: [] },
  // --- jdm-rhythm-runner --- Beat Runner and Paddle Keep-Up: no rings; recorded when the modes were added (seed 12345, defaults: 24 obstacles
  // on a 120 BPM beat with auto jump / the auto platform at skill 0.7).
  runner: { samples: [[943750,351750],[1787500,314250],[2631250,363948],[3475000,314250]], broken: [], walls: [] },
  paddle: { samples: [[314390,202273],[331052,238645],[387168,186813],[518968,322737]], broken: [], walls: [] },
  // --- boris-vortex --- Sound Vortex: its own funnel, no rings; recorded when the mode was added (seed 12345, defaults: 12 balls 1.5 s apart, 12 rings, 12.5 s spirals).
  vortex: { samples: [[505441,421447],[591932,381653],[429348,392412],[489357,211878],[456871,281023],[426114,373116],[412905,265698],[369240,335581]], broken: [], walls: [] },
  // --- boris-journey --- Journey: its own column of stages; recorded when the mode was added (seed 12345, the default route – 10 s in, the ball is
  // still in the first stage's rings, which are the engine's own walls there, five of them broken).
  journey: { samples: [[385083,309284],[424939,272610],[363033,334004],[220976,314591]], broken: [0, 1, 2, 3, 4], walls: [39168,70502,101837,133171,164506,195840] },
  // --- boris-bullseye --- Bullseye: its own peg field and target, no rings; recorded when the mode was added (seed 12345, defaults: 12 shots 2.2 s apart, chaos 0.5, 10 rings).
  bullseye: { samples: [[261123,524036],[387945,104306],[261123,524036],[457992,524036],[261123,524036],[457992,524036],[261123,524036],[457992,524036]], broken: [], walls: [] },
  // --- beat-drop --- Beat Drop: its own scene, no rings, one ball on planned arcs; recorded when the mode was added (seed 12345, defaults: every kind, drift 0.5, endless, 120 BPM).
  beatDrop: { samples: [[509120,544774],[262528,780382],[289034,985198],[319796,1232829]], broken: [], walls: [] },
  // --- odd-maze --- Maze escape: its own grid, no rings; recorded when the mode was added (seed 12345, defaults: a 12 × 17 maze, three
  // explorer balls released 0.26 s apart – by 10 s every one of them is out, so the last sample has no ball).
  maze: { samples: [[425996,102290],[551684,311625],[553877,319523],[480143,193547],[317671,157286],[274837,181753]], broken: [], walls: [] },
};

function fingerprint(engine: PhysicsEngine, frames = 600): Fingerprint {
  const samples: number[][] = [];
  for (let i = 1; i <= frames; i++) {
    engine.update(1000 / 60, 0);
    if (i % 150 === 0) samples.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
  }
  return {
    samples,
    broken: [...engine.getBrokenWalls()].sort((a, b) => a - b),
    walls: engine.getCircularWalls().map((w) => Math.round(w.radius * 1000)),
  };
}

/** A single-ring classic engine with pure physics (no director, no rotation, no gravity) for focused hit tests. */
function singleRing(extras: Partial<PhysicsExtras>) {
  const engine = new PhysicsEngine({ ...config, gravity: 0, rotationSpeed: 0, wallCount: 1, gapSize: 0.1, ...extras });
  engine.setCinematicEnabled(false);
  engine.setSeed(1);
  engine.initMode("classic");
  return engine;
}

/**
 * Runs `seeds` seeds of `mode` for `seconds` (cinematic off) and returns the first time a ball sat outside a wall
 * that had not been passed (dist > radius + ballRadius + 2), or null when every ball stayed inside every intact wall.
 */
function firstEscapeThroughIntactWall(mode: ModeId, extras: Partial<PhysicsExtras>, seeds: number, seconds: number): { seed: number; atSec: number } | null {
  const cx = config.width / 2;
  const cy = config.height / 2;
  for (let seed = 1; seed <= seeds; seed++) {
    const engine = createEngineForSettings({ ...config, ...extras }, mode, modeSettings, seed);
    engine.setCinematicEnabled(false);
    for (let frame = 1; frame <= seconds * 60; frame++) {
      engine.update(1000 / 60, 0);
      const walls = engine.getCircularWalls();
      const broken = engine.getBrokenWalls();
      for (const ball of engine.getBalls()) {
        const dist = Math.hypot(ball.x - cx, ball.y - cy);
        for (let w = 0; w < walls.length; w++) {
          if (!broken.has(w) && dist > walls[w].radius + ball.radius + 2) return { seed, atSec: frame / 60 };
        }
      }
    }
  }
  return null;
}

/** An engine whose walls are so far away that the ball flies freely for the whole test. */
function openSpace(extras: Partial<PhysicsExtras>, gravity = 0) {
  const engine = new PhysicsEngine({ ...config, width: 20000, height: 20000, gravity, ...extras });
  engine.setCinematicEnabled(false);
  engine.setSeed(1);
  engine.initMode("classic");
  return engine;
}

describe("physics extras helpers", () => {
  it("resolve to the defaults when absent and clamp bad values", () => {
    expect(resolvePhysicsExtras(undefined)).toEqual(DEFAULT_PHYSICS_EXTRAS);
    expect(resolvePhysicsExtras({})).toEqual(DEFAULT_PHYSICS_EXTRAS);
    expect(resolvePhysicsExtras(config)).toEqual(DEFAULT_PHYSICS_EXTRAS);
    const clamped = resolvePhysicsExtras({ airDrag: 9, windX: Number.NaN, windY: -4, wallBounciness: 0.1, breathingAmplitude: 2, breathingSpeed: 0, rotatingGravity: 1e9 });
    expect(clamped).toEqual({ ...DEFAULT_PHYSICS_EXTRAS, airDrag: PHYSICS_EXTRA_RANGES.airDrag.max, windX: 0, windY: -0.5, wallBounciness: 0.5, breathingAmplitude: 0.3, breathingSpeed: 0.1, rotatingGravity: 180 });
    expect(hasPhysicsExtras(DEFAULT_PHYSICS_EXTRAS)).toBe(false);
    expect(hasPhysicsExtras({ ...DEFAULT_PHYSICS_EXTRAS, windY: 0.01 })).toBe(true);
    expect(physicsExtrasOf({ ...ALL_EXTRAS_ON, extra: "ignored" } as PhysicsExtras)).toEqual(ALL_EXTRAS_ON);
  });

  it("rotates the gravity direction from straight down", () => {
    expect(gravityAngle(0, 12.5)).toBe(Math.PI / 2);
    expect(gravityAngle(90, 1)).toBeCloseTo(Math.PI, 12);
    expect(gravityAngle(180, 0.5)).toBeCloseTo(Math.PI, 12);
    expect(Math.cos(gravityAngle(45, 2))).toBeCloseTo(-1, 12);
  });

  it("breathes around the base radius, starting at 1", () => {
    expect(breathingScale(0, 2, 0.3)).toBe(1);
    expect(breathingScale(0.3, 1, 0)).toBe(1);
    expect(breathingScale(0.3, 1, 0.25)).toBeCloseTo(1.3, 12);
    expect(breathingScale(0.3, 1, 0.75)).toBeCloseTo(0.7, 12);
    expect(breathingScale(0.1, 2, 0.125)).toBeCloseTo(1.1, 12);
  });

  it("derives the contact spin from the no-slip condition", () => {
    // Ball on the left of the centre (normal (-1, 0)), moving along +y = towards decreasing angle: it rolls on the inside.
    expect(contactSpin(0, 100, -1, 0, true, 0, 10)).toBeCloseTo(10, 12);
    expect(contactSpin(0, 100, -1, 0, false, 0, 10)).toBeCloseTo(-10, 12);
    // A wall surface moving with the ball leaves no relative motion and no spin.
    expect(contactSpin(0, 100, -1, 0, true, -100, 10)).toBeCloseTo(0, 12);
    // Purely radial motion never spins the ball.
    expect(contactSpin(-300, 0, -1, 0, true, 0, 8)).toBeCloseTo(0, 12);
    expect(spinDecayFactor(1)).toBeCloseTo(Math.exp(-0.5), 12);
    expect(spinDecayFactor(0)).toBe(1);
  });
});

describe("PhysicsEngine with physics extras", () => {
  it("leaves every mode's trajectory exactly as it was before the extras existed", () => {
    for (const mode of MODE_IDS) {
      const engine = createEngineForSettings(config, mode, modeSettings, 12345);
      expect(engine.getPhysicsExtras()).toEqual(DEFAULT_PHYSICS_EXTRAS);
      expect(fingerprint(engine), mode).toEqual(BASELINE[mode]);
    }
  });

  it("stays deterministic for a given seed with every extra on", () => {
    for (const mode of ["classic", "shatter", "portal", "accumulation"] as const) {
      const a = createEngineForSettings({ ...config, ...ALL_EXTRAS_ON }, mode, modeSettings, 777);
      const b = createEngineForSettings({ ...config, ...ALL_EXTRAS_ON }, mode, modeSettings, 777);
      expect(fingerprint(a), mode).toEqual(fingerprint(b));
      for (const ball of a.getBalls()) {
        expect(Number.isFinite(ball.x)).toBe(true);
        expect(Number.isFinite(ball.y)).toBe(true);
      }
    }
  });

  it("changes the run as soon as any single extra leaves its default", () => {
    const keys = (Object.keys(ALL_EXTRAS_ON) as (keyof PhysicsExtras)[]).filter((k) => k !== "breathingSpeed");
    for (const key of keys) {
      const engine = createEngineForSettings({ ...config, [key]: ALL_EXTRAS_ON[key] }, "classic", modeSettings, 12345);
      expect(fingerprint(engine).samples, key).not.toEqual(BASELINE.classic.samples);
    }
    // The breathing speed only matters once the walls breathe.
    const still = createEngineForSettings({ ...config, breathingSpeed: 2.5 }, "classic", modeSettings, 12345);
    expect(fingerprint(still)).toEqual(BASELINE.classic);
    const slow = createEngineForSettings({ ...config, breathingAmplitude: 0.2, breathingSpeed: 0.5 }, "classic", modeSettings, 12345);
    const fast = createEngineForSettings({ ...config, breathingAmplitude: 0.2, breathingSpeed: 2.5 }, "classic", modeSettings, 12345);
    expect(fingerprint(slow).samples).not.toEqual(fingerprint(fast).samples);
  });

  it("breathing walls pulse every radius around its base while the gaps stay put", () => {
    const engine = createEngineForSettings({ ...config, breathingAmplitude: 0.2, breathingSpeed: 1 }, "classic", modeSettings, 3);
    const base = [...engine.getWallBaseRadii()];
    const gaps = engine.getCircularWalls().map((w) => w.gaps.map((g) => [g.startAngle, g.endAngle]));
    expect(base).toEqual(engine.getCircularWalls().map((w) => w.radius));
    expect(base.length).toBe(7);
    const walls = engine.getCircularWalls();
    for (let i = 0; i < 15; i++) engine.update(1000 / 60, 0); // 0.25 s: the peak of the first pulse
    walls.forEach((w, i) => expect(w.radius).toBeCloseTo(1.2 * base[i], 6));
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0); // 0.75 s: the trough
    walls.forEach((w, i) => expect(w.radius).toBeCloseTo(0.8 * base[i], 6));
    expect(engine.getWallBaseRadii()).toEqual(base);
    expect(engine.getCircularWalls().map((w) => w.gaps.map((g) => [g.startAngle, g.endAngle]))).toEqual(gaps);
    // Switching the extra off puts the walls back at their base radii at once.
    engine.setConfig({ breathingAmplitude: 0 });
    expect(engine.getCircularWalls().map((w) => w.radius)).toEqual(base);
    engine.update(1000 / 60, 0);
    expect(engine.getCircularWalls().map((w) => w.radius)).toEqual(base);
  });

  it("breathing walls keep their base radii across wall rebuilds and mode-managed walls", () => {
    // A resize while the walls are pulsed must rescale from the base radii, not from the pulse.
    const engine = createEngineForSettings({ ...config, breathingAmplitude: 0.3, breathingSpeed: 1 }, "classic", modeSettings, 3);
    for (let i = 0; i < 15; i++) engine.update(1000 / 60, 0);
    engine.setConfig({ width: 1600, height: 1200 });
    const expected = new PhysicsEngine({ ...config, width: 1600, height: 1200 });
    expected.initMode("classic");
    expect(engine.getWallBaseRadii()).toEqual(expected.getCircularWalls().map((w) => w.radius));
    // Portal mode copies the live radius when it rebuilds its ring; the base must survive that too.
    const portal = createEngineForSettings({ ...config, breathingAmplitude: 0.3, breathingSpeed: 2 }, "portal", modeSettings, 9);
    const base = [...portal.getWallBaseRadii()];
    for (let i = 0; i < 1800; i++) portal.update(1000 / 60, 0);
    expect(portal.getWallBaseRadii()[0]).toBeCloseTo(base[0], 6);
  });

  it("breathing walls never step over a ball, even at the fastest and widest pulse", () => {
    // The outer wall moves up to 24 px per 60 Hz step at amplitude 0.3 / 3 Hz (800×600 arena), more than the
    // ±(ballRadius + 2) hit window of an 8 px ball: before the sweep, 30/30 of these runs put the ball outside
    // the sealed Paint ring (first after ~0.5 s) and 30/30 Classic runs outside a wall that was never passed.
    const fastest = { breathingAmplitude: PHYSICS_EXTRA_RANGES.breathingAmplitude.max, breathingSpeed: PHYSICS_EXTRA_RANGES.breathingSpeed.max };
    expect(firstEscapeThroughIntactWall("paint", fastest, 30, 60)).toBeNull();
    expect(firstEscapeThroughIntactWall("classic", fastest, 30, 60)).toBeNull();
    expect(firstEscapeThroughIntactWall("classic", { breathingAmplitude: 0.3, breathingSpeed: 1.5 }, 30, 60)).toBeNull();
    // The swept collision is as deterministic as the rest of the engine (the finder relies on it).
    const a = createEngineForSettings({ ...config, ...fastest }, "paint", modeSettings, 4);
    const b = createEngineForSettings({ ...config, ...fastest }, "paint", modeSettings, 4);
    expect(fingerprint(a, 1200)).toEqual(fingerprint(b, 1200));
  });

  it("a wall that jumps across the ball in one step still hits it and keeps it on its side", () => {
    // Single sealed-ish ring (base 255 px) pulsing at 0.3 / 3 Hz: between t = 0.15 s and t = 1/6 s the radius drops
    // from ~278.6 to 255 px, a 23.6 px jump. `clearance` is the space between the ball and the ring before that step:
    // at 4 px the wall lands more than the ±(ballRadius + 2) window below the ball, so the per-step hit test never saw
    // it at all; at 12 px it saw it but judged the ball to be outside and pushed it out of the ring.
    for (const clearance of [4, 12]) {
      const engine = singleRing({ breathingAmplitude: 0.3, breathingSpeed: 3 });
      const ball = engine.getBalls()[0];
      const wall = engine.getCircularWalls()[0];
      const cx = config.width / 2;
      const cy = config.height / 2;
      for (let i = 0; i < 9; i++) engine.update(1000 / 60, 0);
      expect(wall.radius).toBeCloseTo(255 * (1 + 0.3 * Math.sin(2 * Math.PI * 3 * 0.15)), 6);
      const before = wall.radius;
      // On the left of the centre (far from the gap at angle 0), moving along the wall, not into it.
      ball.x = cx - (before - ball.radius - clearance);
      ball.y = cy;
      ball.vx = 0;
      ball.vy = 400;
      engine.consumeSoundEvents();
      engine.update(1000 / 60, 0);
      expect(wall.radius).toBeCloseTo(255, 6);
      expect(before - wall.radius).toBeGreaterThan(2 * (ball.radius + 2));
      const dist = Math.hypot(ball.x - cx, ball.y - cy);
      expect(dist + ball.radius, `clearance ${clearance}`).toBeLessThan(wall.radius);
      expect(engine.consumeSoundEvents().some((e) => e.type === "hit")).toBe(true);
      expect(engine.getBrokenWalls().size).toBe(0);
    }
  });

  it("a gap that sweeps past a ball that is not moving out counts as a pass instead of leaving the ball outside", () => {
    const engine = singleRing({ breathingAmplitude: 0.3, breathingSpeed: 3 });
    const ball = engine.getBalls()[0];
    const wall = engine.getCircularWalls()[0];
    const cx = config.width / 2;
    const cy = config.height / 2;
    for (let i = 0; i < 9; i++) engine.update(1000 / 60, 0);
    // Inside the ring under the gap (angles 0…0.1 rad, no rotation), 4 px clear of it, moving along the ring with a
    // slight inward component (so it is never "moving out"): the ring's 23.6 px jump in this step passes the ball's
    // centre, which the per-step hit test never noticed – the ball was then outside a wall that counted as intact.
    const angle = 0.04;
    const inward = (10 * Math.PI) / 180;
    const dist0 = wall.radius - ball.radius - 4;
    ball.x = cx + Math.cos(angle) * dist0;
    ball.y = cy + Math.sin(angle) * dist0;
    ball.vx = 400 * (-Math.sin(angle) * Math.cos(inward) - Math.cos(angle) * Math.sin(inward));
    ball.vy = 400 * (Math.cos(angle) * Math.cos(inward) - Math.sin(angle) * Math.sin(inward));
    expect(ball.vx * Math.cos(angle) + ball.vy * Math.sin(angle)).toBeLessThan(0);
    engine.consumeSoundEvents();
    engine.update(1000 / 60, 0);
    expect(engine.getBrokenWalls().has(0)).toBe(true);
    expect(engine.consumeSoundEvents().some((e) => e.type === "gap")).toBe(true);
    expect(Math.hypot(ball.x - cx, ball.y - cy)).toBeGreaterThan(wall.radius);
  });

  it("grow mode caps the ball at the breathing trough so the ring never shrinks under it", () => {
    const cx = config.width / 2;
    const cy = config.height / 2;
    const run = (extras: Partial<PhysicsExtras>) => {
      const engine = createEngineForSettings({ ...config, ...extras }, "grow", { ...modeSettings, growRate: 10 }, 3);
      engine.setCinematicEnabled(false);
      const base = engine.getWallBaseRadii()[0];
      let maxBallRadius = 0;
      let maxOverlap = -Infinity;
      for (let frame = 0; frame < 120 * 60; frame++) {
        engine.update(1000 / 60, 0);
        const wall = engine.getCircularWalls()[0];
        const ball = engine.getBalls()[0];
        maxBallRadius = Math.max(maxBallRadius, ball.radius);
        maxOverlap = Math.max(maxOverlap, Math.hypot(ball.x - cx, ball.y - cy) + ball.radius - wall.radius);
      }
      return { base, maxBallRadius, maxOverlap };
    };
    // Before the fix the ball grew towards the peaking radius: 290 px in a ring whose trough is 157.5 px, and stuck
    // out of the ring by up to 269 px. (A ball that fills the ring rattles against it, hence the 1 px allowance.)
    const slow = run({ breathingAmplitude: 0.3, breathingSpeed: 0.5 });
    expect(slow.maxBallRadius).toBeLessThan(slow.base * 0.7);
    expect(slow.maxBallRadius).toBeGreaterThan(slow.base * 0.7 - 3);
    expect(slow.maxOverlap).toBeLessThanOrEqual(1);
    const fast = run({ breathingAmplitude: 0.15, breathingSpeed: 1 });
    expect(fast.maxBallRadius).toBeLessThan(fast.base * 0.85);
    expect(fast.maxOverlap).toBeLessThanOrEqual(1);
    // Without breathing the cap is the ring itself, as before.
    const still = run({});
    expect(still.maxBallRadius).toBeLessThan(still.base - 2);
    expect(still.maxBallRadius).toBeGreaterThan(still.base - 3);
    expect(still.maxOverlap).toBeLessThanOrEqual(1);
  });

  it("wall bounciness scales the rebound speed (and 100% is an exact no-op)", () => {
    const speedAfterHit = (wallBounciness: number) => {
      const engine = singleRing({ wallBounciness });
      const ball = engine.getBalls()[0];
      const wall = engine.getCircularWalls()[0];
      // Touching the ring on the left (far from the gap at angle 0), heading straight into it.
      ball.x = config.width / 2 - (wall.radius - ball.radius);
      ball.y = config.height / 2;
      ball.vx = -400;
      ball.vy = 0;
      engine.update(1000 / 60, 0);
      expect(engine.consumeSoundEvents().some((e) => e.type === "hit")).toBe(true);
      return Math.hypot(ball.vx, ball.vy);
    };
    expect(speedAfterHit(1)).toBeCloseTo(400, 6);
    expect(speedAfterHit(1.2)).toBeCloseTo(480, 6);
    const half = speedAfterHit(0.5); // the slow-ball boost adds a fraction of a percent over the rest of the step
    expect(half).toBeGreaterThan(199);
    expect(half).toBeLessThan(203);
  });

  it("spin: wall contact spins the ball and the sprite angle follows; off by default", () => {
    const hit = (spinStrength: number) => {
      const engine = singleRing({ spinStrength });
      const ball = engine.getBalls()[0];
      const wall = engine.getCircularWalls()[0];
      expect(ball.spin).toBe(0);
      expect(ball.angle).toBe(0);
      ball.x = config.width / 2 - (wall.radius - ball.radius);
      ball.y = config.height / 2;
      ball.vx = -300;
      ball.vy = 200; // a tangential component: the ball rolls on the inside of the ring
      engine.update(1000 / 60, 0);
      return ball;
    };
    const plain = hit(0);
    expect(plain.spin).toBe(0);
    expect(plain.angle).toBe(0);
    const spun = hit(1);
    expect(spun.spin).toBeGreaterThan(20); // ~200 px/s of tangential speed on an 8 px ball, slightly decayed
    expect(spun.spin).toBeLessThan(26);
    expect(spun.angle).toBeGreaterThan(0.2);
    const gentle = hit(0.5);
    expect(gentle.spin).toBeGreaterThan(9);
    expect(gentle.spin).toBeLessThan(13);
  });

  it("wind, rotating gravity and air drag act on a free-flying ball", () => {
    // The start velocity is chosen so the force under test only ever speeds the ball up: below the base
    // speed the engine's slow-ball boost would kick in and blur the numbers.
    const fly = (extras: Partial<PhysicsExtras>, gravity: number, vx: number, vy: number) => {
      const engine = openSpace(extras, gravity);
      const ball = engine.getBalls()[0];
      ball.vx = vx;
      ball.vy = vy;
      for (let i = 0; i < 60; i++) engine.update(1000 / 60, 0);
      return { dvx: ball.vx - vx, dvy: ball.vy - vy, speed: Math.hypot(ball.vx, ball.vy) };
    };
    // Wind: half the ball speed (400 px/s) gained sideways per second.
    const windy = fly({ windX: 0.5 }, 0, 0, 400);
    expect(windy.dvx).toBeCloseTo(200, 6);
    expect(windy.dvy).toBeCloseTo(0, 6);
    const updraft = fly({ windY: -0.25 }, 0, 400, 0);
    expect(updraft.dvy).toBeCloseTo(-100, 6);
    expect(updraft.dvx).toBeCloseTo(0, 6);
    // Gravity (300 × 400/300 = 400 px/s²) pulls straight down unless it rotates: a quarter turn in one second
    // spreads the pull over "down" and "left" (2/π of it each, up to the step discretisation).
    const plain = fly({}, 300, 400, 0);
    expect(plain.dvx).toBe(0);
    expect(plain.dvy).toBeCloseTo(400, 6);
    const turning = fly({ rotatingGravity: 90 }, 300, -400, 0);
    expect(turning.dvx).toBeLessThan(-240);
    expect(turning.dvx).toBeGreaterThan(-270);
    expect(turning.dvy).toBeGreaterThan(240);
    expect(turning.dvy).toBeLessThan(270);
    // Air drag bleeds speed every step (the slow-ball boost fights it a little).
    expect(fly({}, 0, 400, 0).speed).toBeCloseTo(400, 6);
    const dragged = fly({ airDrag: 0.05 }, 0, 400, 0);
    expect(dragged.speed).toBeLessThan(80);
    expect(dragged.speed).toBeGreaterThan(0);
    // A light drag is balanced by the boost (which only acts below the base speed): the ball hovers at its base speed
    // instead of sinking, so drag effectively caps how far gravity or wall kicks push it above that speed.
    const light = fly({ airDrag: 0.005 }, 0, 400, 0);
    expect(light.speed).toBeGreaterThan(395);
    expect(light.speed).toBeLessThan(402);
    expect(light.speed).toBeGreaterThan(dragged.speed);
  });

  it("the finder forwards the extras and simulates them deterministically", () => {
    const engine = createEngineForSettings({ ...config, ...ALL_EXTRAS_ON }, "classic", modeSettings, 5);
    expect(engine.getPhysicsExtras()).toEqual(ALL_EXTRAS_ON);
    expect(createEngineForSettings({ ...config, airDrag: 5, wallBounciness: -1 }, "classic", modeSettings, 5).getPhysicsExtras()).toEqual({ ...DEFAULT_PHYSICS_EXTRAS, airDrag: 0.05, wallBounciness: 0.5 });
    const request: FinderRequest = {
      targetDurationSec: 30,
      toleranceSec: 0.5,
      maxSeeds: 1,
      maxSimTimeSec: 60,
      physicsConfig: { ...config, ...ALL_EXTRAS_ON },
      mode: "classic",
      modeSettings,
    };
    const first = simulateSeed(21, request, 60_000);
    expect(Number.isFinite(first)).toBe(true);
    expect(simulateSeed(21, request, 60_000)).toBe(first);
  });
});
