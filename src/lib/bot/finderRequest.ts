import { PhysicsEngine } from "@/lib/physics/engine";
import { physicsExtrasOf } from "@/lib/physics/extras";
import { ballInteractionOf } from "@/lib/physics/interactions";
import { battleSettingsOf, ctfSettingsOf } from "@/lib/physics/modes/arenaGames";
import { boxSettingsOf } from "@/lib/physics/modes/box";
import { collideSettingsOf } from "@/lib/physics/modes/collide";
import { doublePendulumSettingsOf } from "@/lib/physics/modes/doublePendulum";
import { dropSettingsOf } from "@/lib/physics/modes/drop";
import { glassSettingsOf } from "@/lib/physics/modes/glass";
import { illusionSettingsOf } from "@/lib/physics/modes/illusion";
import { jdmRhythmFinderSettingsOf } from "@/lib/physics/modes/jdmRhythmFields";
import { multipliersSettingsOf } from "@/lib/physics/modes/multipliers";
import { pendulumSettingsOf } from "@/lib/physics/modes/pendulum";
import { polyrhythmSettingsOf } from "@/lib/physics/modes/polyrhythm";
import { powerLayersSettingsOf } from "@/lib/physics/modes/powerLayers";
import { raceSettingsOf } from "@/lib/physics/modes/race";
import { stringBattleSettingsOf } from "@/lib/physics/modes/stringBattle";
import { bullseyeSettingsOf } from "@/lib/physics/modes/bullseye";
import { journeySettingsOf } from "@/lib/physics/modes/journey";
import { vortexSettingsOf } from "@/lib/physics/modes/vortex";
import { beatDropSettingsOf } from "@/lib/physics/modes/beatDrop"; // --- beat-drop ---
import { multiplierConfigOf } from "@/lib/physics/multipliers";
import { obstacleConfigOf } from "@/lib/physics/obstacleEditor";
import { riggedConfigOf } from "@/lib/physics/rigged";
import type { PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import type { FinderRequest, ModeSettings } from "@/lib/simulation/finder";
import { engineTimelineOf } from "@/lib/simulation/timeline";
import { effectiveBallCount } from "@/lib/teams";
import { markerBeatInputOf, onBeatConfigOfSettings } from "@/lib/simulation/videoBeatsSettings"; // --- video-beats ---
import { bounceMathConfigOf } from "@/lib/simulation/bounceMath"; // --- bounce-math ---
import { unlimitedConfigOf } from "@/lib/physics/limits"; // --- unlimited ---
import { MULTI_BALL_MODES } from "@/lib/physics/ballStats"; // --- unlimited ---

/*
 * --- viral-bot --- The seed finder's view of a settings object, without a page: the physics config and the mode settings the
 * page's engine gets from the same settings (Simulator.tsx: the engine set-up, the settings effects and `initEngineForMode()`,
 * which the fast export's engine copies). The bot plans clips with it headlessly – in the page (with the page canvas's world
 * size, so a planned seed replays exactly in the export) and in Node (the CLI's dry run, with a nominal world).
 */

/** The size of the simulated world in CSS px: the page canvas's (engine.config.width / height), 800 × 600 before it has one. */
export interface BotWorld {
  width: number;
  height: number;
}

export const DEFAULT_BOT_WORLD: BotWorld = { width: 800, height: 600 };

/** The physics config the page engine runs with for these settings (the page's `new PhysicsEngine({...})` plus every config effect). */
export function physicsConfigOfSettings(s: SimulatorSettings, world: BotWorld = DEFAULT_BOT_WORLD): PhysicsConfig {
  return {
    width: world.width,
    height: world.height,
    gravity: s.gravity,
    damping: 0,
    bounce: s.bounce,
    audioIntensity: 0,
    ballSpeed: s.ballSpeed,
    rotationSpeed: s.rotationEnabled ? s.rotationSpeed : 0,
    wallCount: s.wallCount,
    gapSize: s.gapSize,
    ballColor: s.ballColor,
    ballRadius: s.ballRadius,
    twoBalls: s.twoBalls,
    ballColor2: s.ballColor2,
    ballCount: effectiveBallCount(s),
    ...physicsExtrasOf(s),
    ...ballInteractionOf(s),
    ...multiplierConfigOf(s),
    ...obstacleConfigOf(s),
    timeline: engineTimelineOf(s),
    ...riggedConfigOf(s),
    ...(s.bounceMath.length > 0 ? { bounceMath: bounceMathConfigOf(s, markerBeatInputOf(s)) } : {}), // --- bounce-math --- (the hand-placed markers, else the BPM: a page's song is not there)
    // --- unlimited --- No limits as the page's engine gets it (the switch and the crowd: its soft ceilings, planned steps and crowd)
    ...(s.unlimited ? unlimitedConfigOf(s, effectiveBallCount(s), MULTI_BALL_MODES.includes(s.mode)) : {}),
  };
}

let probe: PhysicsEngine | null = null;
/** The engine's own defaults the page reads from its engine (Shatter's segments and hit points, the portal count). */
function engineDefaults(): { shatterSegmentsPerWall: number; shatterHpPerSegment: number; portalCount: number } {
  probe ??= new PhysicsEngine(physicsConfigOfSettings(defaultSettings("classic")));
  return { shatterSegmentsPerWall: probe.getShatterSegmentsPerWall(), shatterHpPerSegment: probe.getShatterHpPerSegment(), portalCount: probe.getPortalCount() };
}

/** The mode settings the page's `initEngineForMode()` gives the engine (and the finder copies), for these settings. */
export function modeSettingsOfSettings(s: SimulatorSettings): ModeSettings {
  const d = engineDefaults();
  const markerBeat = markerBeatInputOf(s); // --- video-beats --- the beat the Beat Runner and Beat Drop follow: the hand-placed markers, else the BPM
  return {
    bouncierEnabled: s.bouncierEnabled,
    countdownTotal: s.targetCount,
    countdownRandom: s.countdownRandom,
    colorMatchColorCount: s.colorMatchColorCount,
    accumulationTimerMax: 1000 * s.accumulationTime,
    spikesEnabled: s.spikesEnabled,
    spikeCount: s.spikeCount,
    multiplySpawnCount: s.multiplySpawnCount,
    shatterSegmentsPerWall: d.shatterSegmentsPerWall,
    shatterHpPerSegment: d.shatterHpPerSegment,
    growRate: s.growRate,
    portalCount: d.portalCount,
    twoBalls: s.twoBalls,
    cinematicEnabled: s.cinematicEnabled, // --- review fix (modes-rhythm) --- (the director steers the run, as in the page)
    drop: dropSettingsOf(s),
    box: boxSettingsOf(s),
    pendulum: pendulumSettingsOf(s),
    polyrhythm: polyrhythmSettingsOf(s),
    collide: collideSettingsOf(s),
    ballCount: effectiveBallCount(s),
    glass: glassSettingsOf(s),
    multipliers: multipliersSettingsOf(s),
    doublePendulum: doublePendulumSettingsOf(s),
    illusion: illusionSettingsOf(s),
    stringBattle: stringBattleSettingsOf(s),
    powerLayers: powerLayersSettingsOf(s),
    race: raceSettingsOf(s),
    // The export's engine plays capture the flag with the clip as its time limit (not the finder panel's widened one).
    battle: battleSettingsOf(s),
    ctf: ctfSettingsOf(s),
    ...jdmRhythmFinderSettingsOf(s, markerBeat), // --- video-beats --- (no song without a page)
    vortex: vortexSettingsOf(s),
    journey: journeySettingsOf(s), // --- gerald-journey ---
    bullseye: bullseyeSettingsOf(s), // --- gerald-bullseye ---
    beatDrop: beatDropSettingsOf(s, markerBeat), // --- beat-drop --- (the bot plans without a loaded song)
    onBeat: onBeatConfigOfSettings(s), // --- video-beats --- On beat on the BPM or the hand-placed markers (no song without a page)
  };
}

/** A finder request for these settings (the outcome and the target are the caller's). */
export function finderRequestOfSettings(s: SimulatorSettings, world: BotWorld = DEFAULT_BOT_WORLD, maxSimTimeSec = 120): FinderRequest {
  return {
    targetDurationSec: s.recordingDuration,
    toleranceSec: 0.5,
    maxSeeds: 1,
    maxSimTimeSec,
    physicsConfig: physicsConfigOfSettings(s, world),
    mode: s.mode,
    modeSettings: modeSettingsOfSettings(s),
  };
}
