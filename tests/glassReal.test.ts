import { describe, expect, it } from "vitest";
import type { PhysicsConfig, SoundEvent } from "@/lib/physics/types";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { CAMERA_LEAD, DEFAULT_GLASS_SETTINGS, HOME_BOOM_HZ, cameraTarget, glassCrackHz, glassSettingsOf, leadCameraTarget, type GlassSettings } from "@/lib/physics/modes/glass";
import { GALLERY } from "@/content/gallery";
import { HERO_MOMENTS } from "@/lib/thumbnails/heroMoments";

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
  it("rings the crack voice over every pane hit, a full one on the shatter, and the low thud with the HOME chord", () => {
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
    expect(cracks.filter((e) => e.level === 1)).toHaveLength(view.shattered);
    const pitches = new Set(view.level!.panes.map((p) => glassCrackHz(p)));
    for (const c of cracks) expect(pitches.has(c.frequency!)).toBe(true);
    const chord = events.findIndex((e) => !!e.chord);
    expect(chord).toBeGreaterThanOrEqual(0);
    expect(events[chord + 1]).toEqual({ type: "hit", wallIndex: 0, loop: "land", frequency: HOME_BOOM_HZ, level: 1, melody: false, ringVoice: "extra" });
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
});
