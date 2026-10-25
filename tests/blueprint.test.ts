import { describe, expect, it } from "vitest";
import { PhysicsEngine } from "@/lib/physics/engine";
import { MODE_IDS, type PhysicsConfig, type SoundEvent } from "@/lib/physics/types";
import { END_HOLD_SEC, blueprintSettingsOf, defaultBlueprintFields, resolveBlueprintFields, resolveBlueprintSettings, resolveBlueprintSpec } from "@/lib/physics/modes/blueprint";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings, type ModeSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings } from "@/lib/bot/finderRequest";
import { assistantSettings, changesSchema, settingsCatalog, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { modeDetail } from "@/lib/agentKit/modeCatalog";
import { ballControlsOf, sectionKeyShown, type PanelShown } from "@/components/simulator/panelKeys";
import enMessages from "../messages/en.json";
import { MODE_CARD_ORDER, MODE_CATEGORIES } from "@/lib/modes";
import { BLUEPRINT_CATALOG_IDS, BLUEPRINT_LIMITS, blueprintJson, catalogBlueprint, decodeBlueprint, encodeBlueprint, sanitizeBlueprint, type Blueprint } from "@/lib/blueprint";
import { blueprintLinkNotice, blueprintProblemKey, blueprintVerdictLine } from "@/components/simulator/sections/BlueprintSection";
import type { CheckProblem, PlayabilityReport } from "@/lib/blueprint";
import { createTranslator } from "next-intl";
import { readFileSync } from "node:fs";
import plMessages from "../messages/pl.json";
import esMessages from "../messages/es.json";
import { resolveProjectSettings } from "@/lib/project";
import { EMPTY_QUEUE, enqueue, journalOf, restoreQueue } from "@/lib/desktop/renderQueue";

/*
 * --- blueprint --- Mode Lab, the blueprint mode (src/lib/physics/modes/blueprint.ts): its registration, its settings and
 * links, the finder's and the bot's view of it, and the mode in the engine – one seed replays the same balls and sounds,
 * another differs, a restart replays exactly, every run ends (the result, then the hold), a resize keeps the balls in, a
 * link's spec plays and a broken one falls back, slider values go through the sanitizer's ceilings, and the sounds are the
 * engine's generic events. The interpreter's own scenarios are in blueprintRuntime.test.ts and blueprintConformance.test.ts.
 */

const config: PhysicsConfig = { width: 800, height: 450, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };

function engineFor(patch: Partial<SimulatorSettings>, seed: number, cfg: PhysicsConfig = config): PhysicsEngine {
  const settings = { ...defaultSettings("blueprint"), ...patch };
  return createEngineForSettings(cfg, "blueprint", modeSettingsOfSettings(settings) as ModeSettings, seed);
}

/** The balls and sounds of `frames` steps: what one run of a seed looks and sounds like. */
function record(engine: PhysicsEngine, frames: number) {
  const balls: number[][] = [];
  const sounds: string[] = [];
  for (let i = 1; i <= frames; i++) {
    engine.update(1000 / 60, 0);
    for (const ev of engine.consumeSoundEvents()) sounds.push(`${i}:${ev.type}:${ev.loop ?? ""}:${Math.round((ev.frequency ?? 0) * 10)}`);
    if (i % 30 === 0) balls.push(engine.getBalls().flatMap((b) => [Math.round(b.x * 100), Math.round(b.y * 100), Math.round(b.radius * 100)]));
  }
  return { balls, sounds };
}

const tiny = (raw: Record<string, unknown>): Blueprint => sanitizeBlueprint({ v: 1, meta: { name: "Tiny" }, finish: { timeoutSec: 20 }, ...raw }).blueprint;

describe("blueprint mode: registration", () => {
  it("is a mode of its own family, the lab, with the last card", () => {
    expect(MODE_IDS).toContain("blueprint");
    expect(MODE_CATEGORIES.blueprint).toBe("lab");
    expect(MODE_CARD_ORDER[MODE_CARD_ORDER.length - 1]).toBe("blueprint");
  });

  it("boots in the engine with its world and view, and adds no ball of the engine's own", () => {
    const engine = engineFor({}, 1);
    expect(engine.isBlueprintMode()).toBe(true);
    const view = engine.getBlueprintView();
    expect(view.catalogId).toBe("hatchery");
    expect(view.bp?.meta.name).toBe("Glass Hatchery");
    expect(view.world?.tileCount).toBe(120);
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.getBalls()[0].gravityScale).toBe(0);
    engine.update(1000 / 60, 0);
    expect(engine.getBlueprintProgress()).toMatchObject({ finished: false, balls: 1, tiles: 120 });
  });

  it("removes the engine's default ball when a Blueprint places none at 0 s", () => {
    const late = tiny({ bodies: [{ id: "ball" }], spawners: [{ body: "ball", startSec: 0.5 }] });
    const engine = engineFor({ blSpec: encodeBlueprint(late) }, 1);
    expect(engine.getBalls()).toHaveLength(1); // (the engine's own, added after init)
    engine.update(1000 / 60, 0);
    expect(engine.getBalls()).toHaveLength(0);
    for (let i = 0; i < 40; i++) engine.update(1000 / 60, 0);
    expect(engine.getBalls()).toHaveLength(1);
    expect(engine.getBalls()[0].gravityScale).toBe(0);
  });
});

describe("blueprint mode: settings and links", () => {
  it("defaults to the first catalog game, no link spec and no slider values", () => {
    expect(defaultBlueprintFields()).toEqual({ blPreset: "hatchery", blSpec: "", blParams: "" });
    expect(BLUEPRINT_CATALOG_IDS[0]).toBe("hatchery");
    const s = defaultSettings("blueprint");
    expect([s.blPreset, s.blSpec, s.blParams]).toEqual(["hatchery", "", ""]);
  });

  it("resolves bad values: an unknown game, a code that is no code, slider values cleaned", () => {
    expect(resolveBlueprintSettings({ preset: "nope", spec: "javascript:alert(1)", params: "5, x ,7.250,,1e999" })).toEqual({ preset: "hatchery", spec: "", params: "5,,7.25" });
    expect(resolveBlueprintSettings({ spec: `b1.${"A".repeat(20_000)}` }).spec).toBe("");
    expect(resolveBlueprintFields({ blPreset: 42 as unknown as string, blSpec: {} as unknown as string, blParams: [1] as unknown as string })).toEqual(defaultBlueprintFields());
    const merged = presetToSettings({ mode: "blueprint", blPreset: "conquer", blSpec: "b1.<script>", blParams: "3" } as Partial<SimulatorSettings>);
    expect([merged.blPreset, merged.blSpec, merged.blParams]).toEqual(["conquer", "", "3"]);
  });

  it("round-trips through a link: blp, bls and blv, and writes nothing for the defaults", () => {
    const plain = settingsToSearchParams(defaultSettings("blueprint"));
    expect([plain.has("blp"), plain.has("bls"), plain.has("blv")]).toEqual([false, false, false]);
    const code = encodeBlueprint(catalogBlueprint("growEscape"));
    const s = { ...defaultSettings("blueprint"), blPreset: "ringBreaker", blSpec: code, blParams: "5,20" };
    const params = settingsToSearchParams(s);
    expect([params.get("blp"), params.get("bls"), params.get("blv")]).toEqual(["ringBreaker", code, "5,20"]);
    const back = settingsFromSearchParams(new URLSearchParams(params.toString()));
    expect([back.mode, back.blPreset, back.blSpec, back.blParams]).toEqual(["blueprint", "ringBreaker", code, "5,20"]);
  });

  it("reaches the finder, the bot and the app's AI (the game and its sliders, never a whole spec)", () => {
    const s = { ...defaultSettings("blueprint"), blPreset: "conquer", blParams: "4" };
    expect(modeSettingsOfSettings(s).blueprint).toEqual(blueprintSettingsOf(s));
    const engine = engineFor({ blPreset: "conquer", blParams: "4" }, 7);
    expect(engine.getBlueprintView().catalogId).toBe("conquer");
    expect(engine.getBalls()).toHaveLength(16);
    const keys = assistantSettings(s).map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(["blPreset", "blParams"]));
    expect(keys).not.toContain("blSpec");
  });
});

describe("blueprint mode: in the engine", () => {
  it("replays a seed exactly (balls and sounds), another seed differs, and a restart replays", () => {
    const a = record(engineFor({ blPreset: "conquer" }, 11), 360);
    const b = record(engineFor({ blPreset: "conquer" }, 11), 360);
    const c = record(engineFor({ blPreset: "conquer" }, 12), 360);
    expect(a).toEqual(b);
    expect(a.sounds.length).toBeGreaterThan(20);
    expect(c.balls).not.toEqual(a.balls);
    const engine = engineFor({ blPreset: "conquer" }, 11);
    record(engine, 200);
    engine.setSeed(11);
    engine.initMode("blueprint");
    expect(record(engine, 360)).toEqual(a);
  });

  it("replays exactly whatever the cinematic director draws (the run has its own generator)", () => {
    const on = engineFor({ blPreset: "conquer" }, 5);
    const off = engineFor({ blPreset: "conquer" }, 5);
    off.setCinematicEnabled(false);
    expect(record(on, 600)).toEqual(record(off, 600));
  });

  it("ends every run: the result, then the hold under the banner, then isFinished()", () => {
    const engine = engineFor({ blPreset: "ringBreaker", blParams: "3" }, 2);
    let resultAt = -1;
    let finishedAt = -1;
    for (let i = 1; i <= 60 * 60 && finishedAt < 0; i++) {
      engine.update(1000 / 60, 0);
      engine.consumeSoundEvents();
      if (resultAt < 0 && engine.getBlueprintView().result.finished) resultAt = engine.getElapsedMs() / 1000;
      if (engine.isSimulationFinished()) finishedAt = engine.getElapsedMs() / 1000;
    }
    const view = engine.getBlueprintView();
    expect(view.result).toMatchObject({ finished: true, reason: "condition", result: "ALL RINGS DOWN" });
    expect(resultAt).toBeGreaterThan(0);
    expect(finishedAt - resultAt).toBeGreaterThanOrEqual(END_HOLD_SEC - 1 / 60);
    expect(finishedAt - resultAt).toBeLessThan(END_HOLD_SEC + 0.05);
  });

  it("keeps every ball inside the arena through a resize, and the tiles' damage too", () => {
    const engine = engineFor({}, 3);
    for (let i = 0; i < 240; i++) engine.update(1000 / 60, 0);
    const before = engine.getBlueprintView().world!;
    const broken = before.tileCount - before.tilesAlive;
    expect(broken).toBeGreaterThan(0);
    engine.setConfig({ width: 450, height: 800 });
    for (let i = 0; i < 30; i++) engine.update(1000 / 60, 0);
    const w = engine.getBlueprintView().world!;
    expect([w.cx, w.cy]).toEqual([225, 400]);
    expect(w.tileCount - w.tilesAlive).toBeGreaterThanOrEqual(broken);
    for (const b of w.balls) expect(Math.hypot(b.x - w.cx, b.y - w.cy)).toBeLessThan(w.R + 1);
  });

  it("plays a link's spec, and falls back to the catalog game with a note when the code cannot be read", () => {
    const spec = tiny({ meta: { name: "From A Link" }, bodies: [{ id: "ball", radius: 12 }], spawners: [{ body: "ball", count: 3 }] });
    const ok = resolveBlueprintSpec({ preset: "conquer", spec: encodeBlueprint(spec), params: "" });
    expect([ok.catalogId, ok.blueprint.meta.name, ok.notes]).toEqual(["", "From A Link", []]);
    const bad = resolveBlueprintSpec({ preset: "conquer", spec: "b1.AAAA", params: "" });
    expect(bad.catalogId).toBe("conquer");
    expect(bad.notes[0]).toMatch(/could not be read/);
    const engine = engineFor({ blSpec: encodeBlueprint(spec) }, 1);
    expect(engine.getBalls()).toHaveLength(3);
    expect(engine.getBlueprintView().catalogId).toBe("");
  });

  it("applies slider values through the sanitizer: a value past a ceiling is put back in range, never clamped to the slider", () => {
    const big = resolveBlueprintSpec({ preset: "hatchery", spec: "", params: "1000,1e9" });
    expect(big.blueprint.tiles!.rows).toBe(BLUEPRINT_LIMITS.tileRows);
    expect(big.blueprint.tiles!.hp).toBe(1e9);
    expect(big.notes.length).toBeGreaterThan(0);
    const engine = engineFor({ blParams: "1000" }, 1);
    expect(engine.getBlueprintView().world!.tileCount).toBeLessThanOrEqual(BLUEPRINT_LIMITS.tiles);
    // a value past the slider's end but inside the language plays as given
    const wide = resolveBlueprintSpec({ preset: "growEscape", spec: "", params: ",50" });
    expect(wide.blueprint.arena.exits[0].widthDeg).toBe(50);
    expect(wide.notes).toEqual([]);
  });

  it("plays only the engine's generic sound events (a hit, a chime, a tuned bar, a pluck, the end chord)", () => {
    const engine = engineFor({ blPreset: "ringBreaker", blParams: "3" }, 2);
    const seen = new Set<string>();
    const events: SoundEvent[] = [];
    for (let i = 0; i < 60 * 40 && !engine.isSimulationFinished(); i++) {
      engine.update(1000 / 60, 0);
      events.push(...engine.consumeSoundEvents());
    }
    for (const ev of events) {
      expect(ev.type).toBe("hit");
      seen.add(ev.loop ?? "hit");
      expect(Number.isFinite(ev.frequency)).toBe(true);
    }
    expect([...seen].every((k) => ["hit", "chime", "bar", "pluck", "chord"].includes(k))).toBe(true);
    expect(seen.has("chord")).toBe(true);
  });

  it("paints its balls back in the Blueprint's palette when the page's Ball Color changes", () => {
    const engine = engineFor({ blPreset: "conquer" }, 4);
    engine.setConfig({ ballColor: "#123456" });
    const palette = engine.getBlueprintView().bp!.look.palette;
    for (const b of engine.getBalls()) expect(palette).toContain(b.color);
  });
});

// --- review fix (blueprint) --- a link's Blueprint survives a project file, the render queue's journal and a link that cannot be read
describe("blueprint: a link's game through a project file and the render queue", () => {
  // a catalog game renamed: a link-sized code (well over the 500 characters other text settings keep)
  const mine = sanitizeBlueprint({ ...catalogBlueprint("conquer"), meta: { ...catalogBlueprint("conquer").meta, name: "My Conquest" } }).blueprint;
  const code = encodeBlueprint(mine);

  it("keeps a whole b1. code in a project file, so the game comes back by its name", () => {
    expect(code.length).toBeGreaterThan(1000);
    const settings = resolveProjectSettings({ ...defaultSettings("blueprint"), mode: "blueprint", blSpec: code });
    expect(settings.blSpec).toBe(code);
    expect(resolveBlueprintSpec(blueprintSettingsOf(settings)).blueprint.meta.name).toBe("My Conquest");
  });

  it("keeps it through the desktop render queue's journal and a restart", () => {
    const settings = { ...defaultSettings("blueprint"), blSpec: code };
    const q = enqueue(EMPTY_QUEUE, [{ name: "mine", source: { kind: "seed" }, settings, seed: 3, resolution: "1080x1920", fps: 60, codec: "h264", preset: "native", meta: { title: "mine", platform: null, hook: null, caption: null, hashtags: [] } }], 1000, () => "job-1");
    const { state } = restoreQueue(JSON.parse(JSON.stringify(journalOf(q, 5))), 100);
    expect(state.jobs[0].settings.blSpec).toBe(code);
    expect(resolveBlueprintSpec(blueprintSettingsOf(state.jobs[0].settings)).blueprint.meta.name).toBe("My Conquest");
  });

  it("says a link's game could not be read – cut short or past the codec's length – instead of quietly playing another", () => {
    const cut = settingsFromSearchParams(new URLSearchParams(`mode=blueprint&bls=${code.slice(0, Math.floor(code.length * 0.6))}`));
    const r = resolveBlueprintSpec(blueprintSettingsOf(cut));
    expect([r.unreadable, r.catalogId]).toEqual([true, "hatchery"]);
    const huge = settingsFromSearchParams(new URLSearchParams(`mode=blueprint&bls=b1.${"A".repeat(20_000)}`));
    expect(resolveBlueprintSpec(blueprintSettingsOf(huge)).unreadable).toBe(true);
    const fine = settingsFromSearchParams(new URLSearchParams(`mode=blueprint&bls=${code}`));
    expect(resolveBlueprintSpec(blueprintSettingsOf(fine))).toMatchObject({ unreadable: false, catalogId: "" });
  });

  // --- review fix (blueprint) --- a game of a newer site: its spec format, a feature it needs, or a later link format
  it("says a link's game needs a newer site – a newer spec format, an unknown feature or a later link format – never as values fixed", () => {
    const resolved = (bls: string) => resolveBlueprintSpec(blueprintSettingsOf(settingsFromSearchParams(new URLSearchParams(`mode=blueprint&bls=${bls}`))));
    const codeOf = (raw: unknown) => `b1.${Buffer.from(JSON.stringify(raw)).toString("base64url")}`;
    const raw = JSON.parse(blueprintJson(mine)) as Record<string, unknown>;
    // a spec of format 2 in a b1. code: it plays as far as this site reads it, and the panel says it needs a newer one
    const v2 = resolved(codeOf({ ...raw, v: 2 }));
    expect([v2.unreadable, v2.catalogId, v2.newer, v2.blueprint.meta.name]).toEqual([false, "", ["v2"], "My Conquest"]);
    expect(blueprintLinkNotice(v2)).toEqual({ notice: "newer", fixed: 0 });
    // a feature this site does not know
    const needs = resolved(codeOf({ ...raw, meta: { ...(raw.meta as object), needs: ["portals"] } }));
    expect([needs.unreadable, needs.newer]).toEqual([false, ["portals"]]);
    expect(blueprintLinkNotice(needs)).toEqual({ notice: "newer", fixed: 0 });
    // a later link format: refused as newer, not as damaged; a built-in game plays and the panel says why
    const b2Code = `b2.${code.slice(3)}`;
    expect(decodeBlueprint(b2Code)).toMatchObject({ ok: false, newer: "b2." });
    const b2 = resolved(b2Code);
    expect([b2.unreadable, b2.catalogId, b2.newer]).toEqual([true, "hatchery", ["b2."]]);
    expect(blueprintLinkNotice(b2)).toEqual({ notice: "newerFormat", fixed: 0 });
    // (the link keeps the friend's code: a copied link still opens the game on a newer site)
    expect(settingsToSearchParams(settingsFromSearchParams(new URLSearchParams(`mode=blueprint&bls=${b2Code}`))).get("bls")).toBe(b2Code);
    // a link cut short says so, a damaged prefix is no newer format, and values really fixed are still counted
    const cut = resolved(code.slice(0, Math.floor(code.length * 0.6)));
    expect([cut.newer, blueprintLinkNotice(cut)]).toEqual([[], { notice: "unreadable", fixed: 0 }]);
    for (const bad of [`b0.${code.slice(3)}`, `b1x${code.slice(3)}`, `x2.${code.slice(3)}`]) expect(decodeBlueprint(bad), bad).not.toHaveProperty("newer");
    const both = resolved(codeOf({ ...raw, v: 2, arena: { ...(raw.arena as object), size: 1.4 } }));
    expect(blueprintLinkNotice(both)).toEqual({ notice: "newer", fixed: 1 });
    expect(blueprintLinkNotice(resolved(code))).toEqual({ notice: null, fixed: 0 });
  });
});

// --- review fix (blueprint) --- the app's AI and the agent toolbox see the catalog and Mode Lab's link keys
describe("blueprint: the app's AI and the modes tool know Mode Lab's settings", () => {
  const current = { ...defaultSettings("blueprint"), blPreset: "growEscape" };

  it("offers the catalog's ids for blPreset, in the patch schema and in a refusal", () => {
    const schema = JSON.stringify(changesSchema(current));
    for (const id of BLUEPRINT_CATALOG_IDS) expect(schema).toContain(`"${id}"`);
    const check = validateSettingsPatch(current, { blPreset: "Ring Breaker" });
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.errors.join("\n")).toMatch(/ringBreaker/);
    expect(validateSettingsPatch(current, { blPreset: "ringBreaker" })).toMatchObject({ ok: true, patch: { blPreset: "ringBreaker" } });
  });

  it("names the playing game's sliders, in order with their ranges, for blParams", () => {
    const line = settingsCatalog(current).split("\n").find((l) => l.startsWith("blParams"))!;
    expect(line).toContain("grow (0.2 to 3), exit (8 to 40), limit (10 to 60)");
  });

  it("lists blPreset, blParams and the link-only blSpec with their link keys, each kept by a link", () => {
    const detail = modeDetail("blueprint", enMessages as never)!;
    const fields = Object.fromEntries(detail.fieldList.map((f) => [f.key, f]));
    expect([fields.blPreset?.url, fields.blParams?.url, fields.blSpec?.url]).toEqual(["blp", "blv", "bls"]);
    expect([fields.blPreset?.roundTrip, fields.blParams?.roundTrip, fields.blSpec?.roundTrip]).toEqual([true, true, true]);
    expect(fields.blSpec?.linkOnly).toBe(true);
    expect(detail.linkProblems).toEqual([]);
  });
});

// --- review fix (blueprint) --- the page's ball controls that a Blueprint ignores are not offered in Mode Lab
describe("blueprint: the Ball & Physics section in Mode Lab", () => {
  const PANEL: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };

  it("hides Ball Speed, Ball Size, Ball Color (and its Rainbow) and Gravity: a Blueprint's balls and gravity are its own", () => {
    expect(ballControlsOf("blueprint")).toEqual({ speed: false, size: false, color: false, gravity: false });
    for (const key of ["ballSpeed", "ballSize", "ballColor", "gravity"]) expect([key, sectionKeyShown(key, { ...PANEL, mode: "blueprint" }, false)]).toEqual([key, false]);
    for (const key of ["ballSpeed", "ballSize", "ballColor", "gravity"]) expect([key, sectionKeyShown(key, { ...PANEL, mode: "classic" }, false)]).toEqual([key, true]);
  });
});

// --- review fix (blueprint) --- Check playability's verdict in the visitor's language: the locale's decimals, runs (never
// seeds) and, for a game that is not playable yet, its first problem in plain words
describe("blueprint: the playability verdict in the visitor's words", () => {
  const MESSAGES = { en: enMessages, pl: plMessages, es: esMessages };
  const say = (locale: keyof typeof MESSAGES) => {
    const t = createTranslator({ locale, messages: MESSAGES[locale] as never, namespace: "Controls" as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
    const problems = (MESSAGES[locale] as unknown as { Blueprint: { problem: Record<string, string> } }).Blueprint.problem;
    return (r: PlayabilityReport, timeoutSec = 60) => blueprintVerdictLine(r, timeoutSec, locale, t, (code) => problems[code] ?? "");
  };
  const report = (patch: Partial<PlayabilityReport>): PlayabilityReport => ({ verdict: "playable", feedback: [], problems: [], seeds: [1, 2, 3, 4].map((seed) => ({ seed }) as never), finishedByCondition: 4, medianFinishSec: 20.25, ...patch });

  it("writes the seconds as the locale does and counts runs, never seeds", () => {
    const playable = report({ finishedByCondition: 3, medianFinishSec: 20.3 });
    expect(say("en")(playable)).toBe("Playable. It ends after about 20.3 s on 3 of 4 runs.");
    expect(say("pl")(playable)).toBe("Da się grać. Kończy się po około 20,3 s w 3 z 4 prób.");
    expect(say("es")(playable)).toBe("Se puede jugar. Termina tras unos 20,3 s en 3 de 4 pruebas.");
    expect(say("en")(report({ verdict: "endless" }), 90)).toBe("It never ends by itself. Every run reached the 90 s limit.");
  });

  it("says a game that is not playable yet by its first problem, in plain words, and how many more there are", () => {
    const broken = report({ verdict: "broken", problems: ["endless", "quiet", "short"] });
    expect(say("en")(broken)).toBe("Not playable yet. It never ends by itself. Make the finish easier to reach. 2 more problems to fix.");
    expect(say("pl")(report({ verdict: "broken", problems: ["arenaFull"] }))).toBe("Jeszcze nie da się grać. Arena zapełniła się kulkami. Twórz albo dziel mniej kulek.");
    expect(say("es")(report({ verdict: "broken", problems: ["quiet", "fast"] }))).toBe("Aún no se puede jugar. Es demasiado silencioso. Dale sonido a los golpes. Queda un problema más por resolver.");
    // every problem the check can find (lib/blueprint/check.ts CheckProblem) has its sentence in every language
    const union = /export type CheckProblem = ([^;]+);/.exec(readFileSync("src/lib/blueprint/check.ts", "utf8"))?.[1] ?? "";
    const codes = [...union.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1] as CheckProblem);
    expect(codes.length).toBeGreaterThanOrEqual(10);
    for (const locale of ["en", "pl", "es"] as const)
      for (const code of codes) {
        const line = say(locale)(report({ verdict: "broken", problems: [code] }));
        expect([locale, code, line.length > say(locale)(report({ verdict: "broken", problems: [] })).length + 10]).toEqual([locale, code, true]);
      }
  });

  // --- slow-motion --- with the Slow motion switch off the page repays shortened steps with more steps: too heavy, not slowed
  it("says a game whose steps shorten is too heavy for real time while the Slow motion switch is off, in every language", () => {
    expect(blueprintProblemKey("slow", true)).toBe("slow");
    expect(blueprintProblemKey("slow", false)).toBe("slowRealTime");
    expect(blueprintProblemKey("heavy", false)).toBe("heavy");
    const off = (locale: keyof typeof MESSAGES) => {
      const t = createTranslator({ locale, messages: MESSAGES[locale] as never, namespace: "Controls" as never }) as unknown as (key: string, values?: Record<string, string | number>) => string;
      const problems = (MESSAGES[locale] as unknown as { Blueprint: { problem: Record<string, string> } }).Blueprint.problem;
      return blueprintVerdictLine(report({ verdict: "broken", problems: ["slow"] }), 60, locale, t, (code) => problems[blueprintProblemKey(code, false)] ?? "");
    };
    expect(off("en")).toBe("Not playable yet. It is too heavy to play in real time. Slow the balls down or make them bigger.");
    expect(off("pl")).toContain("w czasie rzeczywistym");
    expect(off("es")).toContain("en tiempo real");
    expect(say("en")(report({ verdict: "broken", problems: ["slow"] }))).toBe("Not playable yet. It plays in slow motion. Slow the balls down or make them bigger.");
  });
});
