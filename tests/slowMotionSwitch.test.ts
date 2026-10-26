import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS, type ModeId, type PhysicsConfig } from "@/lib/physics/types";
import { PhysicsEngine } from "@/lib/physics/engine";
import { finderRequestOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { buildProject, parseProject, resolveProjectSettings, serializeProject } from "@/lib/project";
import { decodeShareCode, makeShareCode } from "@/lib/shareCode";
import { assistantSettings, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { relevantAssistantSettings } from "@/lib/desktop/ai/settingsFilter";
import { EMPTY_QUEUE, enqueue, journalOf, restoreQueue } from "@/lib/desktop/renderQueue";
import { BASELINE_FILE, FINGERPRINT_CONFIG, FINGERPRINT_FRAMES, FINGERPRINT_MODE_SETTINGS, FINGERPRINT_SAMPLE_EVERY, FINGERPRINT_SEED, diffFingerprint, parseBaselineLiteral, type Fingerprint } from "@/lib/agentKit/fingerprint";

// --- slow-motion --- The Slow motion switch's plumbing (the setting `slowMotion`, link `smo=0`, `PhysicsConfig.slowMotion`):
// on by default and invisible there – a default link has no `smo`, a default physics config no `slowMotion` key, so every
// fingerprint, digest and existing link stays byte for byte what it was – and off carried everywhere a setting travels.

const ROOT = path.resolve(__dirname, "..");
const off = (mode: ModeId = "classic"): SimulatorSettings => ({ ...defaultSettings(mode), slowMotion: false });

describe("the Slow motion setting (--- slow-motion ---)", () => {
  it("is on by default in every mode, and a default link carries no smo", () => {
    for (const mode of MODE_IDS) {
      const s = defaultSettings(mode);
      expect(s.slowMotion, mode).toBe(true);
      expect(settingsToSearchParams(s).has("smo"), mode).toBe(false);
    }
  });

  it("travels in a link only as smo=0, and reads 1 and 0 back like every switch", () => {
    const params = settingsToSearchParams(off("bullseye"));
    expect(params.get("smo")).toBe("0");
    expect(settingsFromSearchParams(params).slowMotion).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&smo=0")).slowMotion).toBe(false);
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic&smo=1")).slowMotion).toBe(true);
    expect(settingsToSearchParams(settingsFromSearchParams(new URLSearchParams("mode=classic&smo=1"))).has("smo")).toBe(false);
    for (const junk of ["yes", "", "false", "2"]) expect(settingsFromSearchParams(new URLSearchParams(`mode=classic&smo=${junk}`)).slowMotion, junk).toBe(true);
  });

  it("resolves through presetToSettings: only false turns it off, a preset from before it is on", () => {
    expect(presetToSettings({ mode: "fightLeague", slowMotion: false }).slowMotion).toBe(false);
    expect(presetToSettings({ mode: "fightLeague", slowMotion: true }).slowMotion).toBe(true);
    expect(presetToSettings({ mode: "fightLeague" }).slowMotion).toBe(true);
    for (const junk of [0, "0", "false", null, undefined, {}]) expect(presetToSettings({ mode: "classic", slowMotion: junk as unknown as boolean }).slowMotion, String(junk)).toBe(true);
  });

  it("keeps the stored near-miss and KO slow motion as they are: the switch never rewrites them", () => {
    const s = presetToSettings({ ...off("fightLeague"), slowMoOnNearMiss: true, flSlowMo: true });
    expect([s.slowMotion, s.slowMoOnNearMiss, s.flSlowMo]).toEqual([false, true, true]);
    const link = settingsFromSearchParams(settingsToSearchParams(s));
    expect([link.slowMotion, link.slowMoOnNearMiss, link.flSlowMo]).toEqual([false, true, true]);
  });

  it("survives a project file, and a file from before it opens with it on", () => {
    const parsed = parseProject(serializeProject(buildProject({ name: "off", settings: off("bullseye") })));
    expect(parsed.ok && parsed.project.settings.slowMotion).toBe(false);
    const { slowMotion: _drop, ...older } = defaultSettings("bullseye");
    expect(_drop).toBe(true);
    expect(resolveProjectSettings(older).slowMotion).toBe(true);
    expect(resolveProjectSettings({ ...older, slowMotion: "off" }).slowMotion).toBe(true);
  });

  it("survives a share code", async () => {
    const made = await makeShareCode(settingsToSearchParams(off("bullseye")));
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const decoded = await decodeShareCode(made.code);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.params.get("smo")).toBe("0");
    expect(settingsFromSearchParams(decoded.params).slowMotion).toBe(false);
  });

  it("survives the render queue's journal, and an older journal's job renders with it on", () => {
    const job = (settings: SimulatorSettings) => ({ name: "clip", source: { kind: "seed" as const }, settings, seed: 3, resolution: "1080x1920", fps: 60 as const, codec: "h264" as const, preset: "native" as const, meta: { title: "clip", platform: null, hook: null, caption: null, hashtags: [] } });
    const q = enqueue(EMPTY_QUEUE, [job(off("bullseye")), job(defaultSettings("bullseye"))], 1000, (() => { let n = 0; return () => `job-${++n}`; })());
    const journal = JSON.parse(JSON.stringify(journalOf(q, 5)));
    expect(restoreQueue(journal, 100).state.jobs.map((j) => j.settings.slowMotion)).toEqual([false, true]);
    for (const entry of journal.jobs) delete entry.settings.slowMotion; // a journal written before the switch
    expect(restoreQueue(journal, 100).state.jobs.map((j) => j.settings.slowMotion)).toEqual([true, true]);
  });

  it("carries over a mode change like Wide sliders: picking another mode never turns it back on", () => {
    // (review fix) changeMode() builds the new mode's settings from its defaults, which have the switch on, then carries over
    // what belongs to the page rather than the mode: the switch is one, next to Wide sliders in the same block
    const page = fs.readFileSync(path.join(ROOT, "src/components/simulator/Simulator.tsx"), "utf8");
    const start = page.indexOf("  const changeMode = useCallback(");
    expect(start).toBeGreaterThan(0);
    const body = page.slice(start, page.indexOf("setSettings(fresh);", start));
    expect(body).toContain("...defaultSettings(mode),");
    expect(body).toContain("fresh.unlimited = themeLookRef.current.unlimited;");
    expect(body).toContain("fresh.slowMotion = themeLookRef.current.slowMotion;");
    // the carried value is what the next mode's link says: smo=0 stays in it
    const carried = { ...defaultSettings("portal"), unlimited: off("classic").unlimited, slowMotion: off("classic").slowMotion };
    expect(settingsToSearchParams(carried).get("smo")).toBe("0");
  });

  it("is a setting the app's AI may change, offered when a request is about slow motion (en, pl, es)", () => {
    const current = defaultSettings("classic");
    expect(assistantSettings(current).map(([k]) => k)).toContain("slowMotion");
    const patch = validateSettingsPatch(current, { slowMotion: false });
    expect(patch).toEqual({ ok: true, patch: { slowMotion: false } });
    expect(validateSettingsPatch(current, { slowMotion: "off" }).ok).toBe(false);
    for (const request of ["turn off the slow motion", "no slow-mo please, real time", "wyłącz zwolnione tempo", "sin cámara lenta"]) {
      expect(relevantAssistantSettings(current, request).map(([k]) => k), request).toContain("slowMotion");
    }
  });
});

describe("Slow motion in the physics config (--- slow-motion ---)", () => {
  it("adds no key to a default config in any mode, and slowMotion: false only while it is off", () => {
    for (const mode of MODE_IDS) {
      const config = physicsConfigOfSettings(defaultSettings(mode));
      expect("slowMotion" in config, mode).toBe(false);
      expect(physicsConfigOfSettings(off(mode)).slowMotion, mode).toBe(false);
    }
    expect(finderRequestOfSettings(off("bullseye")).physicsConfig.slowMotion).toBe(false);
    expect("slowMotion" in finderRequestOfSettings(defaultSettings("bullseye")).physicsConfig).toBe(false);
    // (a settings object from before the field: on)
    const { slowMotion: _drop, ...older } = defaultSettings("classic");
    expect(_drop).toBe(true);
    expect("slowMotion" in physicsConfigOfSettings(older as SimulatorSettings)).toBe(false);
  });

  it("is turned over by the engine's setSlowMotion, which takes the key out again when it is on", () => {
    const config = physicsConfigOfSettings(defaultSettings("classic"));
    const engine = new PhysicsEngine(config);
    engine.initMode("classic");
    const before = JSON.stringify({ ...engine.config });
    expect(engine.slowMotionOn()).toBe(true);
    engine.setSlowMotion(false);
    expect(engine.slowMotionOn()).toBe(false);
    expect({ ...engine.config }.slowMotion).toBe(false);
    expect(engine.ctx.config.slowMotion).toBe(false);
    engine.setSlowMotion(false); // (twice: still off)
    expect(engine.slowMotionOn()).toBe(false);
    engine.setSlowMotion(true);
    expect(engine.slowMotionOn()).toBe(true);
    expect("slowMotion" in { ...engine.config }).toBe(false);
    expect(JSON.stringify({ ...engine.config })).toBe(before);
    expect("slowMotion" in config).toBe(false); // (the caller's object is never touched)
    // An engine built off is off; a later patch of other settings keeps it.
    const built = new PhysicsEngine(physicsConfigOfSettings(off("classic")));
    expect(built.slowMotionOn()).toBe(false);
    built.setConfig({ gravity: 123 });
    expect(built.slowMotionOn()).toBe(false);
  });

  it("is inherited by the engines that copy the page's config: the export's and the finder's", () => {
    const page = new PhysicsEngine(physicsConfigOfSettings(defaultSettings("bullseye")));
    page.setSlowMotion(false);
    expect(new PhysicsEngine({ ...page.config }).slowMotionOn()).toBe(false);
    expect(createEngineForSettings({ ...page.config }, "bullseye", FINGERPRINT_MODE_SETTINGS, 7).slowMotionOn()).toBe(false);
    page.setSlowMotion(true);
    expect(new PhysicsEngine({ ...page.config }).slowMotionOn()).toBe(true);
    expect(createEngineForSettings({ ...page.config }, "bullseye", FINGERPRINT_MODE_SETTINGS, 7).slowMotionOn()).toBe(true);
  });

  it("leaves the BASELINE fingerprints where they are, with the switch turned off and back on", () => {
    const baseline = parseBaselineLiteral(fs.readFileSync(path.join(ROOT, BASELINE_FILE), "utf8"));
    for (const mode of ["classic", "bullseye", "fightLeague", "multipliers"] as ModeId[]) {
      const engine = createEngineForSettings(FINGERPRINT_CONFIG as PhysicsConfig, mode, FINGERPRINT_MODE_SETTINGS, FINGERPRINT_SEED);
      engine.setSlowMotion(false);
      engine.setSlowMotion(true);
      const samples: number[][] = [];
      for (let i = 1; i <= FINGERPRINT_FRAMES; i++) {
        engine.update(1000 / 60, 0);
        if (i % FINGERPRINT_SAMPLE_EVERY === 0) samples.push(...engine.getBalls().slice(0, 2).map((b) => [Math.round(b.x * 1000), Math.round(b.y * 1000)]));
      }
      const print: Fingerprint = { samples, broken: [...engine.getBrokenWalls()].sort((a, b) => a - b), walls: engine.getCircularWalls().map((w) => Math.round(w.radius * 1000)) };
      expect(diffFingerprint(print, baseline[mode]), mode).toEqual({ equal: true, differences: [] });
    }
  });
});
