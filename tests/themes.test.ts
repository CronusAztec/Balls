import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { PhysicsEngine } from "@/lib/physics/engine";
import { BURST_RECIPES, PARTICLE_STYLES, STYLE_PALETTES, spawnStyledBurst } from "@/lib/physics/particleStyles";
import type { Particle, PhysicsConfig } from "@/lib/physics/types";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import {
  THEMES,
  THEME_LOOK_KEYS,
  applyTheme,
  clearTheme,
  isThemeIntact,
  normalizeHexColor,
  particlePalette,
  resolveThemeSettings,
  themeById,
  themeCarryOver,
  themePatch,
} from "@/lib/themes";

const HEX = /^#[0-9a-f]{6}$/;

describe("theme catalogue", () => {
  it("has at least eight curated themes with unique ids and valid colours", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(8);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const id of ["neon", "pastel", "mono", "sunset", "ocean", "retro", "candy", "matrix"]) expect(themeById(id)).toBeDefined();
    for (const theme of THEMES) {
      for (const color of [theme.circleColor, theme.ballColor, theme.ballColor2, theme.lineColor, ...theme.background.colors, ...theme.trailColors]) expect(color).toMatch(HEX);
      expect(["solid", "gradient"]).toContain(theme.background.type);
      expect(theme.background.colors).toHaveLength(2);
      expect(theme.trailColors).toHaveLength(2);
      expect(PARTICLE_STYLES).toContain(theme.particleStyle);
    }
  });

  it("names every theme in every language", () => {
    for (const messages of [en, pl, es]) {
      const controls = messages.Controls as Record<string, string>;
      for (const theme of THEMES) expect(typeof controls[theme.nameKey]).toBe("string");
    }
  });
});

describe("applying a theme (pure merge)", () => {
  const base = (): SimulatorSettings => ({ ...defaultSettings("classic"), gravity: 900, wallCount: 12, showGlow: true, topText: "Will it escape?", backgroundDim: 0.6 });

  it("merges the theme's colours and leaves every other setting alone", () => {
    const before = base();
    const snapshot = structuredClone(before);
    const after = applyTheme(before, "neon");
    const neon = themeById("neon")!;
    expect(before).toEqual(snapshot); // the input is not mutated
    expect(after).not.toBe(before);
    expect(after).toMatchObject({
      themeId: "neon",
      circleColor: neon.circleColor,
      ballColor: neon.ballColor,
      ballColor2: neon.ballColor2,
      lineColor: neon.lineColor,
      backgroundType: neon.background.type,
      backgroundColors: neon.background.colors,
      trailColors: neon.trailColors,
      particleStyle: neon.particleStyle,
      // the rainbow switches go off so the theme's colours show
      rainbowWalls: false,
      rainbowBall: false,
      rainbowLines: false,
    });
    // Only look fields change; physics, text, recording and the picture dim are kept.
    const changed = (Object.keys(after) as (keyof SimulatorSettings)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    for (const key of changed) expect(THEME_LOOK_KEYS as readonly string[]).toContain(key);
    expect(after.gravity).toBe(900);
    expect(after.wallCount).toBe(12);
    expect(after.showGlow).toBe(true);
    expect(after.topText).toBe("Will it escape?");
    expect(after.backgroundDim).toBe(0.6);
  });

  it("copies the theme's arrays, so editing the settings never edits the theme", () => {
    const after = applyTheme(base(), "ocean");
    after.backgroundColors[0] = "#123456";
    after.trailColors[1] = "#654321";
    expect(themeById("ocean")!.background.colors[0]).not.toBe("#123456");
    expect(themeById("ocean")!.trailColors[1]).not.toBe("#654321");
  });

  it("ignores unknown theme ids", () => {
    const before = base();
    expect(applyTheme(before, "nope")).toBe(before);
    expect(applyTheme(before, "")).toBe(before);
  });

  it("keeps an uploaded background picture in use", () => {
    const after = applyTheme({ ...base(), backgroundType: "image" }, "sunset");
    expect(after.backgroundType).toBe("image");
    expect(after.backgroundColors).toEqual(themeById("sunset")!.background.colors); // ready for when the picture is removed
  });

  it("stays individually editable: an edit marks the theme as tweaked, picking it again restores it", () => {
    const themed = applyTheme(base(), "retro");
    expect(isThemeIntact(themed)).toBe(true);
    const tweaked = { ...themed, circleColor: "#00ff00" };
    expect(tweaked.themeId).toBe("retro");
    expect(isThemeIntact(tweaked)).toBe(false);
    expect(isThemeIntact({ ...themed, backgroundColors: [themed.backgroundColors[0], "#000000"] })).toBe(false);
    expect(isThemeIntact({ ...themed, particleStyle: "bubbles" })).toBe(false);
    expect(isThemeIntact({ ...themed, rainbowWalls: true })).toBe(false);
    // Upper-case colours from older inputs still count as the same colour
    expect(isThemeIntact({ ...themed, circleColor: themed.circleColor.toUpperCase() })).toBe(true);
    expect(isThemeIntact(applyTheme(tweaked, "retro"))).toBe(true);
    expect(isThemeIntact(base())).toBe(false);
  });

  it("clears back to the plain look of the mode, keeping the picture and its dim", () => {
    const themed = { ...applyTheme(base(), "matrix"), backgroundType: "image" as const, backgroundDim: 0.2 };
    const cleared = clearTheme(themed, defaultSettings("classic"));
    const d = defaultSettings("classic");
    expect(cleared).toMatchObject({ themeId: "", circleColor: d.circleColor, ballColor: d.ballColor, rainbowWalls: true, particleStyle: "confetti", trailColors: [], backgroundColors: d.backgroundColors });
    expect(cleared.backgroundType).toBe("image");
    expect(cleared.backgroundDim).toBe(0.2);
    expect(clearTheme(applyTheme(base(), "matrix"), d).backgroundType).toBe("solid");
  });

  it("the patch is what the card sends to the page", () => {
    const patch = themePatch(themeById("candy")!, { backgroundType: "solid" });
    expect(Object.keys(patch).sort()).toEqual(THEME_LOOK_KEYS.filter((k) => k !== "backgroundDim").sort());
  });
});

describe("theme settings", () => {
  it("default to the look the canvas always had", () => {
    for (const mode of ["classic", "shatter", "drop", "pendulum"] as const) {
      const d = defaultSettings(mode);
      expect(d).toMatchObject({ themeId: "", backgroundType: "solid", particleStyle: "confetti", trailColors: [] });
      expect(d.backgroundColors[0]).toBe("#0a0a0a");
    }
    // Fresh arrays per settings object
    expect(defaultSettings("classic").backgroundColors).not.toBe(defaultSettings("classic").backgroundColors);
    const params = settingsToSearchParams(defaultSettings("classic"));
    for (const key of ["theme", "bgt", "bg1", "bg2", "bgd", "ps", "trc"]) expect(params.has(key)).toBe(false);
  });

  it("round-trip a themed look through the URL", () => {
    const s = { ...applyTheme(defaultSettings("classic"), "neon"), backgroundDim: 0.5 };
    const params = settingsToSearchParams(s);
    expect(params.get("theme")).toBe("neon");
    expect(params.get("bgt")).toBe("gradient");
    expect(params.get("bg1")).toBe(s.backgroundColors[0]);
    expect(params.get("bg2")).toBe(s.backgroundColors[1]);
    expect(params.get("bgd")).toBe("0.5");
    expect(params.get("ps")).toBe("sparks");
    expect(params.get("trc")).toBe(s.trailColors.join(","));
    expect(settingsFromSearchParams(new URLSearchParams(params.toString()))).toEqual(s);
  });

  it("never write an uploaded picture into a link and never read one from it", () => {
    const s = { ...defaultSettings("classic"), backgroundType: "image" as const };
    expect(settingsToSearchParams(s).has("bgt")).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("bgt=image")).backgroundType).toBe("solid");
  });

  it("reject bad URL values: unknown themes and styles, bad colours, out-of-range dims", () => {
    const s = settingsFromSearchParams(new URLSearchParams("theme=vapor&bgt=video&bg1=red&bg2=%23ABC&bgd=7&ps=fireworks&trc=%23ff0000"));
    expect(s.themeId).toBe("");
    expect(s.backgroundType).toBe("solid");
    expect(s.backgroundColors).toEqual(["#0a0a0a", "#aabbcc"]); // short hex normalised, the bad one kept at its default
    expect(s.backgroundDim).toBe(1);
    expect(s.particleStyle).toBe("confetti");
    expect(s.trailColors).toEqual([]); // one colour is not a pair
  });

  it("validate presets: old presets get the defaults, bad values fall back, a picture background is kept", () => {
    const old = presetToSettings({ mode: "classic", gravity: 500 });
    expect(old).toMatchObject({ themeId: "", backgroundType: "solid", particleStyle: "confetti", trailColors: [] });
    const bad = presetToSettings({ mode: "classic", themeId: "gone", backgroundColors: ["#fff"], backgroundDim: -3, particleStyle: "lasers" as never, trailColors: ["#ffffff", "nope"] });
    expect(bad).toMatchObject({ themeId: "", backgroundColors: ["#0a0a0a", "#1e293b"], backgroundDim: 0, particleStyle: "confetti", trailColors: [] });
    const saved = applyTheme({ ...defaultSettings("classic"), backgroundType: "image" as const }, "pastel");
    const loaded = presetToSettings(JSON.parse(JSON.stringify(saved)));
    expect(loaded).toEqual(saved);
  });

  it("normalise colours", () => {
    expect(normalizeHexColor("#ABCDEF")).toBe("#abcdef");
    expect(normalizeHexColor("abc")).toBe("#aabbcc");
    expect(normalizeHexColor("#12345")).toBeNull();
    expect(normalizeHexColor(null)).toBeNull();
    expect(resolveThemeSettings(null).backgroundColors).toEqual(["#0a0a0a", "#1e293b"]);
  });

  it("carry the background over a mode change, and a picked theme's colours with it", () => {
    const plain = { ...defaultSettings("classic"), backgroundType: "gradient" as const, backgroundColors: ["#111111", "#222222"], circleColor: "#ff0000" };
    expect(themeCarryOver(plain)).toEqual({ themeId: "", backgroundType: "gradient", backgroundColors: ["#111111", "#222222"], backgroundDim: 0.35, particleStyle: "confetti", trailColors: [] });
    const themed = { ...applyTheme(defaultSettings("classic"), "ocean"), ballColor: "#123456" };
    const kept = themeCarryOver(themed);
    expect(kept).toMatchObject({ themeId: "ocean", ballColor: "#123456", circleColor: themed.circleColor, rainbowWalls: false });
    const next = { ...defaultSettings("drop"), ...kept };
    expect(isThemeIntact(next)).toBe(false); // the tweak survives the mode change
  });

  it("colour the particles with the scene only while a theme is picked", () => {
    expect(particlePalette(defaultSettings("classic"))).toEqual([]);
    const themed = applyTheme(defaultSettings("classic"), "mono");
    const palette = particlePalette(themed);
    expect(new Set(palette).size).toBe(palette.length);
    for (const c of palette) expect(c).toMatch(HEX);
    expect(palette).toContain(themed.circleColor);
    expect(palette).toContain(themed.trailColors[1]);
  });
});

describe("particle styles", () => {
  /** A seeded stand-in for Math.random, so the bursts are reproducible in the test. */
  const seeded = (seed: number) => () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  it("spawn a burst per recipe, in the palette given or the style's own colours", () => {
    for (const style of PARTICLE_STYLES) {
      const out: Particle[] = [];
      spawnStyledBurst(style, [], 100, 200, (p) => out.push(p), seeded(7));
      expect(out).toHaveLength(BURST_RECIPES[style].count);
      for (const p of out) {
        expect(STYLE_PALETTES[style]).toContain(p.color);
        expect(p.x).toBe(100);
        expect(p.y).toBe(200);
        expect(p.life).toBeGreaterThan(0);
        expect(p.life).toBeLessThanOrEqual(p.maxLife);
        expect(p.style).toBe(style === "confetti" ? undefined : style);
      }
      const themed: Particle[] = [];
      spawnStyledBurst(style, ["#010203"], 0, 0, (p) => themed.push(p), seeded(9));
      expect(themed.every((p) => p.color === "#010203")).toBe(true);
    }
    const pixels: Particle[] = [];
    spawnStyledBurst("pixels", [], 0, 0, (p) => pixels.push(p), seeded(3));
    expect(pixels.every((p) => Number.isInteger(p.size) && p.rotationSpeed === 0)).toBe(true);
    const bubbles: Particle[] = [];
    spawnStyledBurst("bubbles", [], 0, 0, (p) => bubbles.push(p), seeded(3));
    expect(bubbles.every((p) => p.vy < 0 && (p.gravity ?? 1) < 0)).toBe(true);
  });

  it("the engine keeps the classic confetti by default and throws the chosen style otherwise", () => {
    const engine = new PhysicsEngine({ width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 });
    engine.initMode("classic");
    expect(engine.getParticleStyle()).toBe("confetti");
    engine.spawnConfetti(400, 300);
    const classic = engine.getParticles().slice();
    expect(classic).toHaveLength(30);
    expect(classic.every((p) => p.type === "confetti" && p.style === undefined && p.gravity === undefined)).toBe(true);

    engine.initMode("classic"); // clears the particles
    engine.setParticleStyle("bubbles");
    engine.spawnConfetti(400, 300);
    const bubbles = engine.getParticles().slice();
    expect(bubbles).toHaveLength(BURST_RECIPES.bubbles.count);
    expect(bubbles.every((p) => p.style === "bubbles")).toBe(true);
    // Follow this burst's own bubbles: the engine's seed is random, so the ball may break a wall meanwhile and throw a burst of its own.
    const startY = new Map(bubbles.map((p) => [p, p.y]));
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0);
    const risen = engine.getParticles().filter((p) => startY.has(p));
    expect(risen.length).toBeGreaterThan(0);
    expect(risen.every((p) => p.y < startY.get(p)!)).toBe(true); // bubbles float up against the particle gravity

    engine.initMode("classic");
    engine.setParticleStyle("confetti", ["#ff00e6", "#00f0ff"]);
    engine.spawnConfetti(400, 300);
    expect(engine.getParticles().every((p) => p.style === undefined && ["#ff00e6", "#00f0ff"].includes(p.color))).toBe(true);
  });

  it("never touch the physics: every style replays the same seeded run", () => {
    const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
    const modeSettings = { bouncierEnabled: false, countdownTotal: 10, countdownRandom: false, colorMatchColorCount: 7, accumulationTimerMax: 4000, spikesEnabled: false, spikeCount: 6, multiplySpawnCount: 3, shatterSegmentsPerWall: 18, shatterHpPerSegment: 1, growRate: 5, portalCount: 3, twoBalls: false, drop: {}, box: {} };
    const trajectory = (style: (typeof PARTICLE_STYLES)[number]) => {
      const engine = createEngineForSettings(config, "classic", modeSettings, 4242);
      engine.setParticleStyle(style, style === "petals" ? ["#ffffff", "#000000"] : []);
      const out: number[] = [];
      for (let i = 0; i < 900; i++) {
        engine.update(1000 / 60, 0);
        if (i % 30 === 0) for (const b of engine.getBalls()) out.push(Math.round(b.x * 1000), Math.round(b.y * 1000));
      }
      return { out, broken: [...engine.getBrokenWalls()].sort() };
    };
    const reference = trajectory("confetti");
    expect(reference.broken.length).toBeGreaterThan(0); // walls broke, so bursts were thrown
    for (const style of PARTICLE_STYLES) expect(trajectory(style)).toEqual(reference);
  });
});
