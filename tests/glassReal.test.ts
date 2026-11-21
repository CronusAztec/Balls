import { describe, expect, it, vi } from "vitest";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { CAMERA_LEAD, DEFAULT_GLASS_SETTINGS, HOME_IMPACT_CHORD, HOME_RESOLVE_HZ, cameraTarget, stageHue, glassCrackHz, glassSettingsOf, leadCameraTarget, type GlassSettings } from "@/lib/physics/modes/glass";
import { GALLERY } from "@/content/gallery";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";
import { ringVoiceEvent } from "@/lib/audio/loopEvents";
import { ToneGenerator } from "@/lib/audio/toneGenerator";
import { playSoundEvent } from "@/lib/recording/fastRender";
import { CRACK_SNAP_TONE, CRACK_TONE, scheduleCrack } from "@/lib/audio/powerLayerTones";
import { GLASS_STAGE_TINTS, glassStageTint } from "@/components/simulator/glassRenderer";

/*
 * --- glass-real --- (Lane E, E4) Glass Smash's crack voice and HOME thud (sounds of their own: the run's contacts and the crew's
 * moments are as they were), the leading camera as an option (lib/physics/modes/glass.ts: never a ball position, off by default
 * because the crew's action track follows the camera) and the start look that reaches HOME inside the clip (lib/clipPacing.ts).
 */

const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
const modeSettings: ModeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };

function glassEngine(glass: Partial<GlassSettings>, seed = 7, cfg: Partial<PhysicsConfig> = {}) {
  return createEngineForSettings({ ...config, ...cfg }, "glass", { ...modeSettings, glass }, seed);
}

describe("glass-real: the leading camera", () => {
  it("keeps the glass under the ball CAMERA_LEAD down the view, never above the start nor past HOME's own frame", () => {
    const engine = glassEngine({});
    const level = engine.getGlassView().level!;
    const f = level.field;
    expect(leadCameraTarget(level, f.top)).toBe(0);
    const pane = level.panes[Math.floor(level.panes.length / 2)]; // (a pane mid-shaft: neither the start nor HOME holds the camera)
    expect(leadCameraTarget(level, pane.y)).toBeCloseTo(pane.y - CAMERA_LEAD * f.height - f.top, 9);
    expect(leadCameraTarget(level, level.home.groundY)).toBe(cameraTarget(level, level.stages.length, 0));
  });

  it("is off by default, and on or off the run is the same: every ball position and every contact sound", () => {
    expect(DEFAULT_GLASS_SETTINGS.lead).toBe(false);
    expect(defaultSettings("glass").glassLead).toBe(false);
    const plain = glassEngine({}, 3);
    const lead = glassEngine({ lead: true }, 3);
    const contacts = (events: SoundEvent[]) => events.filter((e) => e.ringVoice !== "extra");
    let differs = 0;
    for (let f = 0; f < 60 * 40 && !plain.isSimulationFinished(); f++) {
      plain.update(1000 / 60, 0);
      lead.update(1000 / 60, 0);
      const a = plain.getBalls()[0];
      const b = lead.getBalls()[0];
      expect([b.x, b.y]).toEqual([a.x, a.y]);
      expect(contacts(lead.consumeSoundEvents())).toEqual(contacts(plain.consumeSoundEvents()));
      if (Math.abs(plain.getGlassView().cameraY - lead.getGlassView().cameraY) > 1) differs++;
    }
    expect(lead.isSimulationFinished()).toBe(plain.isSimulationFinished());
    expect(differs).toBeGreaterThan(60);
  });

  it("frames the next panes: with the lead on, the ball hops in the upper half of the view through the whole smash", () => {
    const engine = glassEngine({ lead: true }, 5);
    const view = engine.getGlassView();
    const f = view.level!.field;
    let frames = 0;
    let upper = 0;
    for (let i = 0; i < 60 * 40 && !view.homeReached; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (i < 60) continue;
      frames++;
      const screenY = engine.getBalls()[0].y - view.cameraY;
      if (screenY - f.top < 0.5 * f.height) upper++;
    }
    expect(upper / frames).toBeGreaterThan(0.9);
  });

  it("is a setting of its own (URL gll), read back from a link", () => {
    const s = { ...defaultSettings("glass"), glassLead: true };
    const params = settingsToSearchParams(s);
    expect(params.get("gll")).toBe("1");
    expect(glassSettingsOf(settingsFromSearchParams(params)).lead).toBe(true);
    expect(settingsToSearchParams(defaultSettings("glass")).has("gll")).toBe(false);
  });
});

describe("glass-real: the sounds", () => {
  it("rings the crack voice over every pane hit, a full one on the shatter, and an impact and a completion chord with the HOME chord", () => {
    const engine = glassEngine({ rows: 3, hp: 2, stages: 1, holes: false, moving: false }, 11);
    const events: SoundEvent[] = [];
    for (let f = 0; f < 60 * 60 && !engine.isSimulationFinished(); f++) {
      engine.update(1000 / 60, 0);
      events.push(...engine.consumeSoundEvents());
    }
    expect(engine.isSimulationFinished()).toBe(true);
    const view = engine.getGlassView();
    const cracks = events.filter((e) => e.plCrack);
    expect(cracks).toHaveLength(view.hits);
    expect(cracks.every((e) => e.ringVoice === "extra" && e.melody === false)).toBe(true);
    expect(cracks.every((e) => e.ringTexture === true)).toBe(true); // --- glass-real --- (E4 review) a melody keeps them
    expect(cracks.filter((e) => e.level === 1)).toHaveLength(view.shattered);
    const pitches = new Set(view.level!.panes.map((p) => glassCrackHz(p)));
    for (const c of cracks) expect(pitches.has(c.frequency!)).toBe(true);
    const chord = events.findIndex((e) => !!e.chord);
    expect(chord).toBeGreaterThanOrEqual(0);
    expect(events[chord + 1]).toEqual({ type: "hit", wallIndex: 0, loop: "impact", frequency: HOME_IMPACT_CHORD[0], chord: [...HOME_IMPACT_CHORD], level: 1, melody: false, ringVoice: "extra" });
    expect(events[chord + 2]).toEqual({ type: "hit", wallIndex: 0, loop: "chord", frequency: HOME_RESOLVE_HZ, level: 1, melody: false, ringVoice: "extra" });
    // --- glass-real --- (E4 review) a phone plays it: every voice of the impact above 150 Hz
    expect(Math.min(...HOME_IMPACT_CHORD)).toBeGreaterThan(150);
  });
});

// --- glass-real --- (E4 review) a planned clip carries a melody: the glass still cracks under it, without a pitch of its own
describe("glass-real: the crack under a visitor's melody", () => {
  const crack: SoundEvent = { type: "hit", wallIndex: 0, plCrack: true, frequency: 1046.5, level: 0.6, melody: false, ringVoice: "extra", ringTexture: true };

  it("stays under a melody alone as its snap, and goes under a song, a hit sample or a clip as every extra does", () => {
    expect(ringVoiceEvent(crack, false)).toBe(crack);
    expect(ringVoiceEvent(crack, true, true)).toEqual({ ...crack, frequency: undefined, unpitched: true });
    expect(ringVoiceEvent(crack, true, false)).toBeNull();
    const extra: SoundEvent = { type: "hit", wallIndex: 0, loop: "chord", frequency: 130.8, level: 1, melody: false, ringVoice: "extra" };
    expect(ringVoiceEvent(extra, true, true)).toBeNull(); // (an extra that is no texture still gives way to the melody)
  });

  // (E4 review) Glass Smash's own glass clip set the tone generator's wall-break sound, so every extra was left out in the mode
  it("counts the mode's own break clip as no sound of the visitor's own, and a clip the visitor chose as theirs", () => {
    vi.stubGlobal("window", undefined);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined); // (no audio context in Node: the clip is not decoded)
    try {
      const tone = new ToneGenerator();
      tone.setWallBreakSound("/sounds/glass-break.mp3", true);
      expect([tone.hasOwnSound(), tone.ownSoundIsMelody()]).toEqual([false, false]);
      tone.setCustomNotes([440, 494]);
      expect([tone.hasOwnSound(), tone.ownSoundIsMelody()]).toEqual([true, true]);
      tone.setWallBreakSound("/sounds/glass-break.mp3");
      expect([tone.hasOwnSound(), tone.ownSoundIsMelody()]).toEqual([true, false]);
      tone.clearCustomNotes();
      expect(tone.hasOwnSound()).toBe(true);
      tone.setWallBreakSound(null, true);
      expect(tone.hasOwnSound()).toBe(false);
    } finally {
      quiet.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("is played by the fast export as the unpitched snap, and the snap has no pitched voice at all", () => {
    const calls: unknown[][] = [];
    const audio = { hasOwnSound: () => true, ownSoundIsMelody: () => true, playPowerLayerCrack: (...args: unknown[]) => calls.push(args) };
    playSoundEvent(audio as unknown as Parameters<typeof playSoundEvent>[0], crack, () => undefined);
    expect(calls).toEqual([[undefined, 0.6, true]]);
    const count = { osc: 0, noise: 0 };
    const param = () => ({ value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, exponentialRampToValueAtTime: () => undefined });
    const node = () => ({ connect: () => undefined });
    const ctx = {
      createBufferSource: () => ({ ...node(), buffer: null, start: () => void count.noise++, stop: () => undefined }),
      createBiquadFilter: () => ({ ...node(), type: "", frequency: param(), Q: param() }),
      createGain: () => ({ ...node(), gain: param() }),
      createOscillator: () => ({ ...node(), type: "", frequency: param(), start: () => void count.osc++, stop: () => undefined }),
    };
    const noise = { duration: 1 } as AudioBuffer;
    scheduleCrack(ctx as unknown as BaseAudioContext, {} as AudioNode, 0, 1046.5, noise, 1, CRACK_SNAP_TONE);
    expect(count).toEqual({ osc: 0, noise: 1 });
    scheduleCrack(ctx as unknown as BaseAudioContext, {} as AudioNode, 0, 1046.5, noise, 1, CRACK_TONE);
    expect(count).toEqual({ osc: 4, noise: 2 }); // (the pitched crack as it was: the ping, its octave, the shimmer and the tick)
  });
});

// --- glass-real --- (E4 review) Glass Smash's stage tints: every stage a colour of its own (stages 3 and 4 were the same purple)
describe("glass stage tints", () => {
  it("gives each of the first six stages its own tint, at least 60° from the stage before, and leaves another hue as it is", () => {
    const tints = Array.from({ length: 6 }, (_, i) => glassStageTint(stageHue(i)));
    expect(tints).toEqual([...GLASS_STAGE_TINTS]);
    expect(new Set(tints).size).toBe(6);
    for (let i = 1; i < 6; i++) {
      const d = Math.abs(tints[i] - tints[i - 1]) % 360;
      expect(Math.min(d, 360 - d)).toBeGreaterThanOrEqual(60);
    }
    expect(glassStageTint(stageHue(6))).toBe(GLASS_STAGE_TINTS[0]);
    expect(glassStageTint(17)).toBe(17);
  });
});

describe("glass-real: the start look", () => {
  it("leads the camera and reaches HOME with its celebration by 27 s on every seed, in a laptop's and a phone's world", () => {
    expect(clipStartSettings("glass")).toEqual({ glassLead: true, gravity: 500 });
    const start = { ...defaultSettings("glass"), ...clipStartSettings("glass") };
    for (const world of [
      { width: 800, height: 450 },
      { width: 450, height: 450 },
    ]) {
      for (let seed = 1; seed <= 8; seed++) {
        const finder = finderRequestOfSettings(start, world, 40);
        const engine = createEngineForSettings(finder.physicsConfig, finder.mode, finder.modeSettings, seed);
        let sec = 0;
        while (sec < 40 && !engine.isSimulationFinished()) {
          engine.update(1000 / 60, 0);
          engine.consumeSoundEvents();
          sec += 1 / 60;
        }
        expect(engine.isSimulationFinished(), `seed ${seed}`).toBe(true);
        expect(sec, `seed ${seed} ${world.width}`).toBeLessThanOrEqual(27);
      }
    }
  }, 30_000);

  it("the card and the gallery's Gerald vs Glass lead the camera too", () => {
    expect(new URLSearchParams(HERO_MOMENTS.glass!.query).get("gll")).toBe("1");
    const gallery = GALLERY.filter((p) => p.mode === "glass");
    expect(gallery.length).toBeGreaterThan(0);
    for (const preset of gallery) expect(new URLSearchParams(preset.query).get("gll"), preset.id).toBe("1");
  });

  // --- glass-real --- (E4 review) a visitor who opens a glass card and presses Record (30 s) gets HOME and its celebration
  it("every glass gallery card reaches HOME with its celebration by 27 s, in a laptop's and a phone's world", () => {
    const gallery = GALLERY.filter((p) => p.mode === "glass");
    expect(gallery.length).toBeGreaterThan(0);
    for (const preset of gallery) {
      const params = new URLSearchParams(preset.query);
      const settings = settingsFromSearchParams(params);
      const seed = Number(params.get("seed"));
      expect(Number.isFinite(seed), preset.id).toBe(true);
      for (const world of [
        { width: 800, height: 450 },
        { width: 450, height: 450 },
      ]) {
        const finder = finderRequestOfSettings(settings, world, 40);
        const engine = createEngineForSettings(finder.physicsConfig, finder.mode, finder.modeSettings, seed);
        let sec = 0;
        while (sec < 40 && !engine.isSimulationFinished()) {
          engine.update(1000 / 60, 0);
          engine.consumeSoundEvents();
          sec += 1 / 60;
        }
        expect(engine.isSimulationFinished(), `${preset.id} ${world.width}`).toBe(true);
        expect(sec, `${preset.id} ${world.width}`).toBeLessThanOrEqual(27);
      }
    }
  }, 30_000);
});
