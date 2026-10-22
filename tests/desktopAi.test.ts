import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import en from "../messages/en.json";
import { RANGES, defaultSettings, presetToSettings } from "@/lib/settings";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { usesBudgetedSearch } from "@/lib/simulation/unlimitedFinder";
import { effectiveBallCount } from "@/lib/teams";
import { LIVE_WALL_LIMIT } from "@/lib/unlimited";
import { RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import type { BotCopy } from "@/lib/bot/copy";
import type { AiChatRequest, AiMessage, DesktopApi } from "@/lib/desktop/contract";
import { extractJson, validateJson, type JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { normaliseReply, replySchema, runAgent, type AgentEvent, type ChatModel, type AgentTool } from "@/lib/desktop/ai/agent";
import { assistantSettings, changedKeys, changesSchema, invertPatch, isModeSettingKey, patchFromChanges, settingsCatalog, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { MODE_IDS } from "@/lib/physics/types"; // --- low-findings-2 ---
import { CLIP_CUT, MAKE_VIDEOS_MAX_CLIPS, PlanStore, clipCutSpec, clipEditTask, copyTask, ideasTask, makeVideosMaxTokens, makeVideosTask, makeVideosTools, planSummary, settingsTask, type ClipCutResult, type MakeVideosResult, type SettingsResult, type StudioPorts } from "@/lib/desktop/ai/studio";
import { selectPlaybookContext, splitPlaybook } from "@/lib/desktop/ai/playbookContext";
// --- ai-cut --- the cut task and Make videos' per-clip cut
import { CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT } from "@/lib/clipEdit/spec";
import { ZOOM_STEPS, type ClipBeats } from "@/lib/clipEdit/propose";
import { suggestCut } from "@/components/simulator/desktop/aiCut";

/* --- desktop-exe --- the AI studio: schema checks, the tool-call loop with a scripted model, settings patches, grounding */

const copy = (en as unknown as { ViralBot: BotCopy }).ViralBot;

/** A model that replies from a script and records what it was sent. */
function scripted(replies: string[]): ChatModel & { calls: AiMessage[][] } {
  const calls: AiMessage[][] = [];
  return {
    calls,
    async complete(messages, options) {
      calls.push(messages.map((m) => ({ ...m })));
      const reply = replies.shift();
      if (reply === undefined) throw new Error("script ran out");
      options.onToken?.(reply);
      return reply;
    },
  };
}

describe("json schema subset", () => {
  const schema: JsonSchema = {
    type: "object",
    properties: { n: { type: "integer", minimum: 1, maximum: 5 }, tags: { type: "array", maxItems: 2, items: { type: "string", pattern: "^#" } }, kind: { enum: ["a", "b"] } },
    required: ["n"],
    additionalProperties: false,
  };
  it("accepts conforming values and names every problem", () => {
    expect(validateJson(schema, { n: 3, tags: ["#x"], kind: "a" })).toEqual([]);
    const errors = validateJson(schema, { n: 9.5, tags: ["x", "#y", "#z"], kind: "c", extra: 1 });
    expect(errors.join("\n")).toMatch(/\$\.n: must be integer/);
    expect(errors.join("\n")).toMatch(/\$\.tags: must have at most 2 items/);
    expect(errors.join("\n")).toMatch(/\$\.tags\[0\]: must match/);
    expect(errors.join("\n")).toMatch(/\$\.kind: must be one of/);
    expect(errors.join("\n")).toMatch(/unknown field "extra"/);
    expect(validateJson(schema, {})).toEqual(['$: missing "n"']);
    expect(validateJson({ oneOf: [{ type: "string" }, { type: "number" }] }, true)[0]).toMatch(/must be/);
  });
  it("refuses keys named after Object.prototype's members, and never takes an inherited one for present", () => {
    // (JSON.parse makes "__proto__" an own key; a plain lookup would find Object.prototype's members and wave them through)
    for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      const value = JSON.parse(`{"n": 3, ${JSON.stringify(key)}: 1}`);
      expect(validateJson(schema, value), key).toEqual([`$: unknown field "${key}"`]);
    }
    expect(validateJson(schema, JSON.parse('{"n": 3, "__proto__": {"kind": "a"}}'))).toEqual(['$: unknown field "__proto__"']);
    expect(validateJson({ type: "object", required: ["toString"] }, {})).toEqual(['$: missing "toString"']);
  });
  it("finds the JSON object in a chatty reply", () => {
    expect(extractJson('Sure! ```json\n{"a": {"b": "}"}}\n``` done')).toEqual({ ok: true, value: { a: { b: "}" } } });
    expect(extractJson("no json here").ok).toBe(false);
    expect(extractJson('{"a": 1').ok).toBe(false);
  });
});

describe("agent loop", () => {
  const echo = {
    name: "echo",
    description: "echoes",
    args: { type: "object", properties: { text: { type: "string", maxLength: 10 } }, required: ["text"], additionalProperties: false } as JsonSchema,
    runs: [] as string[],
    run: async function (args: Record<string, unknown>) {
      echo.runs.push(args.text as string);
      return { echoed: args.text };
    },
  };
  const final: JsonSchema = { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false };

  it("calls a tool, feeds its result back and returns the validated answer", async () => {
    echo.runs = [];
    const model = scripted(['{"action":"tool","tool":"echo","args":{"text":"hi"},"note":"test"}', '{"action":"final","result":{"answer":"done"}}']);
    const events: AgentEvent[] = [];
    const out = await runAgent<{ answer: string }>(model, { system: "sys", user: "go", tools: [echo], final }, { onEvent: (e) => events.push(e) });
    expect(out).toEqual({ ok: true, result: { answer: "done" }, steps: 2, retries: 0 });
    expect(echo.runs).toEqual(["hi"]);
    expect(model.calls[1].at(-1)?.content).toBe('Result of echo: {"echoed":"hi"}');
    expect(model.calls[0][0].content).toContain('"action":"tool"'); // the protocol is in the system prompt
    expect(events.map((e) => e.type)).toEqual(["turn", "token", "tool", "toolResult", "turn", "token", "final"]);
  });

  it("retries invalid output and never runs a tool with invalid arguments", async () => {
    echo.runs = [];
    const model = scripted(["I think the answer is 42", '{"action":"tool","tool":"echo","args":{"text":"far too long text"}}', '{"action":"tool","tool":"nope","args":{}}', '{"action":"final","result":{"answer":"ok"}}']);
    const events: AgentEvent[] = [];
    const out = await runAgent(model, { system: "s", user: "u", tools: [echo], final }, { onEvent: (e) => events.push(e) });
    expect(out).toMatchObject({ ok: true, retries: 3 });
    expect(echo.runs).toEqual([]);
    expect(events.filter((e) => e.type === "invalid")).toHaveLength(3);
    expect(model.calls[1].at(-1)?.content).toMatch(/^Your reply was not valid:/);
    expect(model.calls[2].at(-1)?.content).toMatch(/at most 10 characters/);
  });

  it("gives up after too many invalid replies in a row – nothing is applied", async () => {
    const model = scripted(["x", "y", "z", "w", '{"action":"final","result":{"answer":"too late"}}']);
    const out = await runAgent(model, { system: "s", user: "u", tools: [], final, maxRetries: 3 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/invalid 4 times in a row/);
  });

  it("rejects a final answer that fails the task's checks, and folds a flat reply shape", async () => {
    const model = scripted(['{"action":"final","note":"","tool":"","args":{},"result":{"answer":"bad"}}', '{"action":"final","note":"","tool":"","args":{},"result":{"answer":"good"}}']);
    const out = await runAgent<{ answer: string }>(model, { system: "s", user: "u", tools: [echo], final, checkFinal: (r) => (r.answer === "good" ? [] : ["answer must be good"]) });
    expect(out).toMatchObject({ ok: true, result: { answer: "good" }, retries: 1 });
    expect(normaliseReply({ action: "tool", tool: "echo", args: { text: "a" }, result: null, note: "" })).toEqual({ action: "tool", tool: "echo", args: { text: "a" } });
    expect(validateJson(replySchema([echo], final), { action: "tool", tool: "echo", args: { text: "a" } })).toEqual([]);
    expect(validateJson(replySchema([echo], final), { action: "final", result: { answer: 1 } }).length).toBeGreaterThan(0);
  });

  it("reports a tool's error to the model and stops when cancelled", async () => {
    const failing = { ...echo, run: async () => Promise.reject(new Error("GPU busy")) };
    const model = scripted(['{"action":"tool","tool":"echo","args":{"text":"a"}}', '{"action":"final","result":{"answer":"without it"}}']);
    const out = await runAgent(model, { system: "s", user: "u", tools: [failing], final });
    expect(out.ok).toBe(true);
    expect(model.calls[1].at(-1)?.content).toMatch(/echo failed: GPU busy/);
    const controller = new AbortController();
    controller.abort();
    const stopped = await runAgent(scripted([]), { system: "s", user: "u", tools: [], final }, { signal: controller.signal });
    expect(stopped).toMatchObject({ ok: false, cancelled: true });
  });
});

describe("settings assistant", () => {
  const current = defaultSettings("classic");
  it("accepts a valid patch, snapping numbers to their step", () => {
    const r = validateSettingsPatch(current, { ballSpeed: 801 - 1, rainbowBall: true, gravity: 0, windX: 0.123 });
    expect(r).toEqual({ ok: true, patch: { ballSpeed: 800, rainbowBall: true, gravity: 0, windX: 0.12 } });
  });
  it("refuses unknown settings, wrong types, out-of-range numbers, bad options and colours", () => {
    // (--- review fix (uncap-all) --- out of range means below the minimum: a speed past the slider is valid)
    const r = validateSettingsPatch(current, { speed: 2, ballSpeed: -50, rainbowBall: "yes", instrument: "kazoo", ballColor: "red", teams: [], mode: "nope" });
    expect(r.ok).toBe(false);
    const text = r.ok ? "" : r.errors.join("\n");
    expect(text).toMatch(/"speed" is not a setting/);
    expect(text).toMatch(/"ballSpeed" must be a number from 50, no upper limit \(got -50\)/);
    expect(text).toMatch(/"rainbowBall" must be true or false/);
    expect(text).toMatch(/"instrument" must be one of/);
    expect(text).toMatch(/"ballColor" must be a colour/);
    expect(text).toMatch(/"teams" cannot be changed/);
    expect(text).toMatch(/"mode" must be one of/);
    expect(validateSettingsPatch(current, {}).ok).toBe(false);
    expect(validateSettingsPatch(current, [1]).ok).toBe(false);
  });
  it("undoes a patch and lists the settings for the prompt", () => {
    expect(invertPatch(current, { ballSpeed: 800, rainbowBall: true })).toEqual({ ballSpeed: 400, rainbowBall: false });
    expect(changedKeys(current, { ballSpeed: 400, gravity: 0 })).toEqual(["gravity"]);
    const catalog = settingsCatalog(current);
    expect(catalog).toContain("ballSpeed (number from 50, no upper limit, slider 50–800, step 10) = 400"); // --- review fix (uncap-all) --- (the slider is a comfort range)
    expect(catalog).toContain("windX (number any value, no upper limit, slider -0.5–0.5, step 0.01) = 0");
    expect(catalog).toMatch(/instrument \(one of "sine"\|/);
  });
  it("offers the mode's own settings and a changes schema of exactly those settings", () => {
    const glass = defaultSettings("glass");
    const keys = assistantSettings(glass).map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(["ballSpeed", "glassRows", "glassHp", "glassMoving"]));
    expect(keys).not.toContain("pwCount");
    const schema = changesSchema(glass);
    expect(schema.type).toBe("array");
    expect(schema.items?.oneOf?.length).toBe(keys.length);
    expect(validateJson(schema, [{ setting: "glassRows", value: 12 }, { setting: "rainbowBall", value: true }, { setting: "instrument", value: "marimba" }])).toEqual([]);
    expect(validateJson(schema, [{ setting: "ballSpeed", value: 900 }])).toEqual([]); // --- review fix (uncap-all) --- (past the slider: valid)
    expect(validateJson(schema, [{ setting: "ballSpeed", value: 10 }]).join(" ")).toMatch(/≥ 50/);
    expect(validateJson(schema, [{ setting: "type", value: "fast" }]).length).toBeGreaterThan(0);
    expect(validateJson(schema, []).join(" ")).toMatch(/at least 1/);
    expect(patchFromChanges([{ setting: "gravity", value: 0 }, { setting: "gravity", value: 50 }])).toEqual({ gravity: 50 });
  });

  it("with No limits on takes values past the sliders, as links and presets do (only invalid ones are refused)", () => {
    // --- unlimited --- the assistant's patches follow the switch: big values kept, negative / below-minimum ones refused
    const unlimited = { ...current, unlimited: true };
    const r = validateSettingsPatch(unlimited, { ballSpeed: 5000, ballCount: 1e6, windX: -40 });
    expect(r).toEqual({ ok: true, patch: { ballSpeed: 5000, ballCount: 1e6, windX: -40 } });
    const bad = validateSettingsPatch(unlimited, { ballSpeed: -5, airDrag: -1 });
    expect(bad.ok).toBe(false);
    const text = bad.ok ? "" : bad.errors.join("\n");
    expect(text).toMatch(/"ballSpeed" must be a number from 50, no upper limit/);
    expect(text).toMatch(/"airDrag" must be a number from 0, no upper limit/);
    // --- uncap-all --- no semantic or recording maximum is left (a drag of 1 or more stops the balls, a long clip is just long)
    expect(validateSettingsPatch(unlimited, { airDrag: 3, recordingDuration: 5000 })).toEqual({ ok: true, patch: { airDrag: 3, recordingDuration: 5000 } });
    // --- review fix (uncap-all) --- the switch (Wide sliders) gates nothing: past the slider is valid with it on or off
    expect(validateSettingsPatch(current, { unlimited: true, ballSpeed: 5000 })).toEqual({ ok: true, patch: { unlimited: true, ballSpeed: 5000 } });
    expect(validateSettingsPatch(current, { ballSpeed: 5000 })).toEqual({ ok: true, patch: { ballSpeed: 5000 } });
    expect(validateSettingsPatch(current, { ballSpeed: 5000, ballCount: 1e6, windX: -40 })).toEqual({ ok: true, patch: { ballSpeed: 5000, ballCount: 1e6, windX: -40 } });
    const low = validateSettingsPatch(current, { ballSpeed: -5 });
    expect(low.ok ? "" : low.errors.join("\n")).toMatch(/"ballSpeed" must be a number from 50, no upper limit/);
    for (const page of [current, unlimited]) {
      expect(settingsCatalog(page)).toContain("ballSpeed (number from 50, no upper limit, slider 50–800, step 10) = 400");
      const schema = changesSchema(page);
      expect(validateJson(schema, [{ setting: "ballSpeed", value: 1e9 }])).toEqual([]);
      expect(validateJson(schema, [{ setting: "ballSpeed", value: 10 }]).join(" ")).toMatch(/≥ 50/);
    }
  });

  it("changes the numeric Bounciness, and the old Bouncier switch through it (--- uncap-all ---)", () => {
    expect(assistantSettings(current).map(([k]) => k)).toContain("bounciness");
    expect(validateSettingsPatch(current, { bounciness: 1.5 })).toEqual({ ok: true, patch: { bounciness: 1.5, bouncierEnabled: true } });
    expect(validateSettingsPatch(current, { bouncierEnabled: true })).toEqual({ ok: true, patch: { bouncierEnabled: true, bounciness: 1.03 } });
    const bouncy = { ...current, bounciness: 1.5, bouncierEnabled: true };
    expect(validateSettingsPatch(bouncy, { bouncierEnabled: false })).toEqual({ ok: true, patch: { bouncierEnabled: false, bounciness: 1 } });
    // --- review fix (uncap-all) --- past its slider whatever the Wide sliders switch
    expect(validateSettingsPatch(current, { bounciness: 50 })).toEqual({ ok: true, patch: { bounciness: 50, bouncierEnabled: true } });
    expect(validateSettingsPatch({ ...current, unlimited: true }, { bounciness: 50 })).toEqual({ ok: true, patch: { bounciness: 50, bouncierEnabled: true } });
    expect(validateSettingsPatch(current, { bounciness: 0.5 }).ok).toBe(false); // (below its minimum: invalid)
  });

  // --- review fix (unlimited) x uncap-all --- the switch is only Wide sliders now: turning it off through the assistant
  // changes no value, as the panel's switch does (the limits are gone either way)
  it("turns Wide sliders off the way the panel does: every value past its slider stays as it is", () => {
    const big = { ...current, mode: "classic" as const, unlimited: true, wallCount: 1e5, ballSpeed: 1e6, ballCount: 5e4, glassHp: 1000, windX: -1e6 };
    const off = validateSettingsPatch(big, { unlimited: false });
    expect(off).toEqual({ ok: true, patch: { unlimited: false } });
    if (!off.ok) return;
    // Applied, the settings loader keeps the switch off and every big value.
    const applied = presetToSettings({ ...big, ...off.patch });
    expect([applied.unlimited, applied.wallCount, applied.ballSpeed, applied.ballCount, applied.glassHp, applied.windX]).toEqual([false, 1e5, 1e6, 5e4, 1000, -1e6]);
    // A value the patch sets itself comes in too – inside the slider now that the assistant's suggestions are no longer widened.
    const own = validateSettingsPatch(big, { unlimited: false, wallCount: 12 });
    expect(own.ok && own.patch.wallCount).toBe(12);
    // --- review fix (uncap-all) --- and one past the slider too: the switch gates nothing
    expect(validateSettingsPatch(big, { unlimited: false, wallCount: 5000 })).toEqual({ ok: true, patch: { unlimited: false, wallCount: 5000 } });
    expect(RANGES.wallCount.max).toBeLessThan(5000);
  });

  // --- review fix (unlimited) x uncap-all --- find_simulation searches the run the page renders: the extreme-values runtime
  // engages by the values (whatever the switch), with the crowd and the page's budgeted search
  it("plans an uncapped clip's search on the page engine's config: engaged by the values, the crowd and the memory-safety ceilings", () => {
    for (const unlimited of [false, true]) {
      const plan = { ...defaultSettings("classic"), unlimited, wallCount: 1e5, ballCount: 5e4 };
      const request = finderRequestOfSettings(plan);
      expect(request.physicsConfig).toMatchObject({ unlimited: true, crowdCount: 5e4 - effectiveBallCount(plan) });
      expect(usesBudgetedSearch(request)).toBe(true);
      const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, 1);
      expect(engine.getCircularWalls().length).toBe(LIVE_WALL_LIMIT);
    }
    // At the sliders' values nothing of it is in the request (the default run is the one it always was).
    const plain = finderRequestOfSettings(defaultSettings("classic"));
    expect(plain.physicsConfig.unlimited).toBeUndefined();
    expect(plain.physicsConfig.crowdCount).toBeUndefined();
  });

  it("runs as an agent task: an out-of-range change is sent back, the corrected one comes out", async () => {
    // (--- review fix (uncap-all) --- out of range is below the minimum now; a value past the slider is no error)
    const model = scripted([
      '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":-800},{"setting":"rainbowBall","value":true}],"summary":"x2"}}',
      '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":800},{"setting":"rainbowBall","value":true},{"setting":"gravity","value":0}],"summary":"Twice as fast, rainbow, no gravity"}}',
    ]);
    const out = await runAgent<SettingsResult>(model, settingsTask("make the ball twice as fast and rainbow, no gravity", current, "en"));
    expect(out.ok).toBe(true);
    if (out.ok) expect(patchFromChanges(out.result.changes)).toEqual({ ballSpeed: 800, rainbowBall: true, gravity: 0 });
    expect(out).toMatchObject({ retries: 1 });
    expect(model.calls[1].at(-1)?.content).toMatch(/≥ 50/);
    // Twice as fast from 800 is 1,600 – past the slider, and taken as it is (never capped at the slider).
    const fast = scripted(['{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":1600}],"summary":"x2"}}']);
    const twice = await runAgent<SettingsResult>(fast, settingsTask("twice as fast", { ...current, ballSpeed: 800 }, "en"));
    expect(twice).toMatchObject({ ok: true, retries: 0 });
    if (twice.ok) expect(patchFromChanges(twice.result.changes)).toEqual({ ballSpeed: 1600 });
    expect(fast.calls[0][0].content).toMatch(/never capped at a slider/);
  });
});

describe("make videos", () => {
  const plan = planClip(RECIPES[0], 42, "reels", { copy, search: false });
  const ports = (): StudioPorts & { finds: number[] } => {
    const finds: number[] = [];
    return {
      finds,
      planClips: async (request) => Array.from({ length: request.count }, (_, i) => ({ ...plan, id: `${plan.id}-${i + 1}`, platform: request.platform })),
      findSimulation: async (_settings, request) => {
        finds.push(request.targetSec);
        return { found: true, seed: 777, durationSec: request.targetSec };
      },
    };
  };

  it("plans with the planner and the finder as tools and answers with validated clips", async () => {
    const store = new PlanStore();
    const p = ports();
    const model = scripted([
      '{"action":"tool","tool":"plan_clips","args":{"count":2,"platform":"tiktok","recipe":"ring-escape"}}',
      `{"action":"tool","tool":"find_simulation","args":{"planId":"${plan.id}-1","targetSec":20,"outcome":"duration"}}`,
      `{"action":"final","result":{"summary":"two clips","clips":[{"planId":"${plan.id}-1","name":"monday escape","title":"Can it escape?","hook":"Can it escape in 20 s?","caption":"Which ring was hardest?","hashtags":["#physics","#satisfying","#bouncingball"],"platform":"tiktok"}]}}`,
    ]);
    const out = await runAgent<MakeVideosResult>(model, makeVideosTask("two satisfying escape clips for Monday, 20 s", { copy, locale: "en", platform: "reels", store, ports: p }));
    expect(out.ok).toBe(true);
    expect(p.finds).toEqual([20]);
    const planned = store.get(`${plan.id}-1`)!;
    expect(planned.seed).toBe(777);
    expect(planned.settings.recordingDuration).toBe(20);
    expect(model.calls[1].at(-1)?.content).toMatch(/^Result of plan_clips: \{"clips":\[\{"planId":/);
  });

  it("refuses clips with a planId that was never planned, and a finder call on one", async () => {
    const store = new PlanStore();
    const model = scripted([
      '{"action":"tool","tool":"find_simulation","args":{"planId":"made-up","targetSec":20,"outcome":"duration"}}',
      '{"action":"final","result":{"summary":"","clips":[{"planId":"made-up","name":"x","title":"t","hook":"h","caption":"c","hashtags":["#a","#b","#c"],"platform":"reels"}]}}',
      "nothing",
      "still nothing",
    ]);
    const p = ports();
    const out = await runAgent(model, { ...makeVideosTask("go", { copy, locale: "en", platform: "reels", store, ports: p }), maxRetries: 3 });
    expect(out.ok).toBe(false);
    expect(p.finds).toEqual([]);
    expect(model.calls[1].at(-1)?.content).toMatch(/unknown planId "made-up"/);
  });

  it("builds the copy and idea tasks", () => {
    const c = copyTask("", { locale: "pl", platforms: ["tiktok", "shorts"], settings: defaultSettings("glass"), existing: "old caption" });
    expect(c.system).toMatch(/Polish/);
    expect(c.system).toMatch(/old caption/);
    expect(c.checkFinal?.({ items: [{ platform: "reels", title: "t", hook: "h", caption: "c", hashtags: [] }] })).toEqual(['platform "reels" was not asked for (tiktok, shorts)']);
    const i = ideasTask("", { copy, locale: "es", playbook: "## 3. The recipe\nMotion in frame one." });
    expect(i.system).toMatch(/Spanish/);
    expect(i.system).toMatch(/Motion in frame one/);
    expect(i.system).toMatch(/ring-escape/);
  });
});

// --- ai-cut --- the standalone cut task: a cut for one finished clip from its beats, on the same loop
describe("--- ai-cut --- the cut task", () => {
  const beats: ClipBeats = { durationSec: 16.2, mode: "glass", firstImpactSec: 0.8, payoffSec: 12.4, cutGapSec: null, ending: "resolved", seamlessLoop: false, hook: "Can it escape?" };
  const ideas = ["Will it escape?", "Red or blue?", "Wait for the last bounce", "How many bounces?"];
  const task = () => clipEditTask("", { locale: "en", beats, base: DEFAULT_CLIP_EDIT, ideas });

  it("shows the beats, the rule-made default and the hook examples, asks for the answer in a line, and takes a valid one as it is", async () => {
    const model = scripted(['{"action":"final","result":{"startSec":0.5,"lengthSec":13.4,"zoom":1.25,"hook":"Will it escape?","cardSec":1.5,"summary":"Starts on the first bounce."}}']);
    const t = task();
    const out = await runAgent<ClipCutResult>(model, t);
    expect(out).toEqual({ ok: true, steps: 1, retries: 0, result: { startSec: 0.5, lengthSec: 13.4, zoom: 1.25, hook: "Will it escape?", cardSec: 1.5, summary: "Starts on the first bounce." } });
    const system = model.calls[0][0].content;
    expect(system).toContain("source 16.2 s, mode glass, motion from 0.8 s, payoff at 12.4 s (resolved), no loop");
    expect(system).toContain('A sound default: {"startSec":0.5,"lengthSec":13.4,"zoom":1.25,"hook":"Can it escape?","cardSec":1.5}.'); // a breath before the first bounce, 1.5 s after the escape, no address
    expect(system).toContain('Hook examples: "Will it escape?", "Red or blue?", "Wait for the last bounce", "How many bounces?". Write the hook and the summary in English.');
    expect(system).toContain('"zoom":<1|1.15|1.25|1.4|1.6>'); // the answer's shape in a line (finalHint), not its schema
    expect(system).not.toContain('"additionalProperties"');
    expect(model.calls[0][1].content).toBe("Propose the cut.");
    expect([t.name, t.maxSteps, t.temperature, t.maxTokens, t.tools.length]).toEqual(["cut", 3, 0.5, 400, 0]);
    expect(t.final.required).toEqual(["startSec", "lengthSec", "zoom", "hook", "cardSec", "summary"]);
    expect(t.final.properties?.zoom).toEqual({ enum: ZOOM_STEPS });
    expect(CLIP_CUT.additionalProperties).toBe(false);
    if (out.ok) expect(clipCutSpec(out.result, { ...DEFAULT_CLIP_EDIT, url: "mine" })).toEqual({ startSec: 0.5, lengthSec: 13.4, zoom: 1.25, hook: "Will it escape?", url: "mine", cardSec: 1.5 });
    expect(clipEditTask("", { locale: "pl", beats, base: DEFAULT_CLIP_EDIT, ideas: [] }).system).toMatch(/\nWrite the hook and the summary in Polish\.$/);
  });

  it("fits what a small model answers – a length past the file, a zoom off the steps, a string number, a hook that runs long – without a retry", async () => {
    const long = "Will it escape? ".repeat(6).trim(); // 95 characters
    const model = scripted([`{"action":"final","result":{"startSec":"2","lengthSec":999,"zoom":1.3,"hook":"${long}","cardSec":1.5,"summary":"x"}}`]);
    const out = await runAgent<ClipCutResult>(model, task());
    expect(out).toMatchObject({ ok: true, retries: 0 });
    if (!out.ok) return;
    expect(out.result).toMatchObject({ startSec: 2, lengthSec: 14.2, zoom: 1.25, cardSec: 1.5, summary: "x" }); // the length fitted to the 16.2 s file
    expect(out.result.hook.length).toBeLessThanOrEqual(60);
    expect(out.result.hook).toMatch(/^Will it escape\? Will it escape\?/);
    expect(out.result).not.toHaveProperty("url");
  });

  it("sends a cut that misses the payoff back once, naming the second it lands; an empty hook falls back to the clip's own", async () => {
    const model = scripted(['{"action":"final","result":{"startSec":0,"lengthSec":8,"zoom":1,"hook":"","cardSec":0,"summary":"short"}}', '{"action":"final","result":{"startSec":4,"lengthSec":10,"zoom":1,"hook":"","cardSec":0,"summary":"to the escape"}}']);
    const out = await runAgent<ClipCutResult>(model, task());
    expect(out).toMatchObject({ ok: true, retries: 1, result: { startSec: 4, lengthSec: 10, hook: "Can it escape?" } });
    const note = model.calls[1].at(-1) as AiMessage;
    expect(note.role).toBe("system");
    expect(note.content).toMatch(/the payoff lands at 12\.4 s: keep startSec <= 12\.4 <= startSec \+ lengthSec/);
  });

  it("suggests a cut for the editor over the bridge, the address the user's; the loop's failure is thrown", async () => {
    const replies = ['{"action":"final","result":{"startSec":0.5,"lengthSec":12,"zoom":1.15,"hook":"Red or blue?","cardSec":1,"summary":"Up to the last pane."}}'];
    const requests: AiChatRequest[] = [];
    const bridge = {
      ai: { chat: async (r: AiChatRequest) => (requests.push(r), { text: replies.shift() ?? "", provider: "local", model: "m", cancelled: false }), cancel: async () => {} },
      on: () => () => {},
    } as unknown as Pick<DesktopApi, "ai" | "on">;
    const base = { ...DEFAULT_CLIP_EDIT, url: "my.site" };
    await expect(suggestCut(bridge, "pl", beats, base, ideas)).resolves.toEqual({ spec: { startSec: 0.5, lengthSec: 12, zoom: 1.15, hook: "Red or blue?", url: "my.site", cardSec: 1 }, summary: "Up to the last pane." });
    expect(requests[0].task).toBe("cut");
    expect(requests[0].messages[0].content).toContain("Polish");
    expect(JSON.stringify(requests[0].schema)).toContain('"cardSec":{"enum":[0,1,1.5,2]}');
    await expect(suggestCut(bridge, "en", beats, base, ideas)).rejects.toThrow(/no final answer after 3 turns/);
  });
});

// --- ai-cut --- Make videos with cuts: the cut required per clip, snapped and checked against its plan's beats
describe("--- ai-cut --- Make videos with cuts", () => {
  const base = planClip(RECIPES[0], 42, "reels", { copy, search: false });
  // a measured plan: a 20 s clip, the first bounce at 0.8 s, the escape at 12 s, no seamless loop
  const plan = { ...base, ending: "resolved" as const, payoff: { ...base.payoff, atSec: 12, cutGapSec: null }, timing: { ...base.timing, clipSec: 20, firstImpactSec: 0.8 }, settings: { ...base.settings, dpPalindrome: false, hpReturn: false } };
  const ports = (): StudioPorts => ({
    planClips: async (request) => Array.from({ length: request.count }, (_, i) => ({ ...plan, id: `${plan.id}-${i + 1}`, platform: request.platform })),
    findSimulation: async () => ({ found: false, seed: 0, durationSec: 0 }),
  });
  const clip = (cut: string) => `{"planId":"${plan.id}-1","name":"glass escape","title":"Glass","hook":"Can it escape?","caption":"Which pane?","hashtags":["#physics","#asmr","#satisfying"],"platform":"reels"${cut}}`;

  // --- ai-cut --- a new seed has its own payoff: the cut is suggested and checked against it, not the plan's old second
  it("find_simulation refreshes the plan's beats for the new seed and hands back a current suggested cut", async () => {
    const ctx = { signal: new AbortController().signal, progress: () => {} } as unknown as Parameters<AgentTool["run"]>[1];
    const measured: StudioPorts = { ...ports(), findSimulation: async (_s, request) => ({ found: true, seed: 9, durationSec: request.targetSec, payoffSec: 13.5 }) };
    const store = new PlanStore();
    store.add({ ...plan, id: "p-1" });
    const find = makeVideosTools(store, measured).find((tool) => tool.name === "find_simulation")!;
    const out = (await find.run({ planId: "p-1", targetSec: 20, outcome: "escapes-at", atSec: 14 }, ctx)) as { suggestedCut: { startSec: number; lengthSec: number } };
    const after = store.get("p-1")!;
    expect(after.payoff).toMatchObject({ atSec: 13.5, cutGapSec: null }); // the finder's measured escape wins over the second asked for
    expect(after.timing).toMatchObject({ clipSec: 20, found: true, firstImpactSec: null });
    expect(out.suggestedCut.startSec + out.suggestedCut.lengthSec).toBeCloseTo(15, 5); // payoff + 1.5 s
    expect(out.suggestedCut).not.toHaveProperty("url");
    // no measured escape: the second asked for; a run searched by length or for never escaping has no payoff at all
    const asked: StudioPorts = { ...ports(), findSimulation: async (_s, request) => ({ found: true, seed: 9, durationSec: request.targetSec }) };
    const store2 = new PlanStore();
    store2.add({ ...plan, id: "p-2" });
    const find2 = makeVideosTools(store2, asked).find((tool) => tool.name === "find_simulation")!;
    await find2.run({ planId: "p-2", targetSec: 20, outcome: "escapes-at", atSec: 14 }, ctx);
    expect(store2.get("p-2")!.payoff.atSec).toBe(14);
    await find2.run({ planId: "p-2", targetSec: 30, outcome: "duration" }, ctx);
    expect(store2.get("p-2")!.payoff.atSec).toBeNull();
  });

  it("asks for a cut per clip only when the run wants cuts: required in the schema, its steps as enums, the plan's suggestedCut to start from", () => {
    const store = new PlanStore();
    store.add({ ...plan, id: "p-1" });
    const withCut = makeVideosTask("x", { copy, locale: "en", platform: "reels", store, ports: ports(), cut: true });
    const item = ((withCut.turn?.()?.final?.properties?.clips as JsonSchema).items as JsonSchema);
    expect(item.required).toEqual(["planId", "name", "title", "hook", "caption", "hashtags", "platform", "cut"]);
    expect(item.properties?.cut).toEqual(CLIP_CUT);
    expect(JSON.stringify(replySchema(withCut.tools, withCut.turn?.()?.final ?? null))).toContain('"zoom":{"enum":[1,1.15,1.25,1.4,1.6]}');
    expect(withCut.system).toMatch(/Start from the plan's suggestedCut/);
    const without = makeVideosTask("x", { copy, locale: "en", platform: "reels", store, ports: ports() });
    const plain = ((without.turn?.()?.final?.properties?.clips as JsonSchema).items as JsonSchema);
    expect(plain.properties).not.toHaveProperty("cut");
    expect(plain.required).not.toContain("cut");
    expect(without.system).not.toMatch(/suggestedCut/);
    // What the model sees of a plan: its beats and the cut the rules suggest (no address), the caption cut to 160.
    const summary = planSummary(plan);
    expect(summary).toMatchObject({ firstImpactSec: 0.8, cutGapSec: null, loop: false, suggestedCut: { startSec: 0.5, lengthSec: 13, zoom: 1.25, cardSec: 1.5 } });
    expect(summary.suggestedCut).not.toHaveProperty("url");
    expect(summary.suggestedCaption.length).toBeLessThanOrEqual(160);
    // a seamless loop is read only from the modes that play one (the flags are on by default everywhere): kept whole, no card
    expect(planSummary({ ...plan, mode: "doublePendulum", settings: { ...plan.settings, dpFan: true, dpPalindrome: true } })).toMatchObject({ loop: true, suggestedCut: { startSec: 0, lengthSec: 20, cardSec: 0 } });
    expect(planSummary({ ...plan, settings: { ...plan.settings, dpFan: true, dpPalindrome: true, hpReturn: true } }).loop).toBe(false);
  });

  // --- ai-cut --- the reply's budget: ten clips that keep their planned copy, each with a cut and a full-length hook, fit it
  it("leaves room in the reply for ten clips with their cuts, by the local runner's own token estimate", () => {
    const store = new PlanStore();
    for (let i = 0; i < MAKE_VIDEOS_MAX_CLIPS; i++) {
      const p = planClip(RECIPES[i % RECIPES.length], 1000 + i, "tiktok", { copy, search: false });
      store.add({ ...p, id: `${p.id}-${i}` });
    }
    const withCut = makeVideosTask("ten clips", { copy, locale: "en", platform: "tiktok", store, ports: ports(), cut: true });
    const without = makeVideosTask("ten clips", { copy, locale: "en", platform: "tiktok", store, ports: ports() });
    const answer = (cut: boolean) => ({
      action: "final",
      note: "All ten clips are planned, here is the answer.",
      result: {
        summary: "Ten clips across the families, each with its hook, caption and hashtags, ready to render.",
        clips: store.all().map((p, i) => {
          const s = planSummary(p);
          const clip = { planId: s.planId, name: `${s.recipe} ${i + 1}`, title: s.hook.slice(0, 100), hook: s.hook.slice(0, 120), caption: s.suggestedCaption, hashtags: s.suggestedHashtags.slice(0, 8), platform: s.platform };
          return cut ? { ...clip, cut: { ...s.suggestedCut, hook: "Will the last ball get out before the ring shuts? ".repeat(2).slice(0, CLIP_EDIT_TEXT_MAX) } } : clip;
        }),
      },
    });
    expect(validateJson(replySchema(withCut.tools, withCut.turn?.()?.final ?? null), answer(true))).toEqual([]);
    expect(validateJson(replySchema(without.tools, without.turn?.()?.final ?? null), answer(false))).toEqual([]);
    // desktop/src/ai/local.ts counts ~3.2 characters a token before the model's own tokenizer is loaded
    const tokens = (v: unknown) => Math.ceil(JSON.stringify(v).length / 3.2);
    expect(without.maxTokens).toBe(makeVideosMaxTokens(false));
    expect(withCut.maxTokens).toBe(makeVideosMaxTokens(true));
    expect(tokens(answer(false))).toBeLessThanOrEqual(without.maxTokens as number);
    expect(tokens(answer(true))).toBeLessThanOrEqual(withCut.maxTokens as number);
    // what the cuts add fits what the budget adds for them
    expect(tokens(answer(true)) - tokens(answer(false))).toBeLessThanOrEqual((withCut.maxTokens as number) - (without.maxTokens as number));
  });

  it("runs with cuts: a clip without one is refused by the schema, a cut past the payoff by the checks, the planned one is snapped", async () => {
    const store = new PlanStore();
    const model = scripted([
      '{"action":"tool","tool":"plan_clips","args":{"count":1,"platform":"reels"}}',
      `{"action":"final","result":{"summary":"one","clips":[${clip("")}]}}`,
      `{"action":"final","result":{"summary":"one","clips":[${clip(',"cut":{"startSec":0,"lengthSec":8,"zoom":1.4,"hook":"","cardSec":1.5}')}]}}`,
      `{"action":"final","result":{"summary":"one","clips":[${clip(',"cut":{"startSec":"1","lengthSec":40,"zoom":1.3,"hook":"","cardSec":1.5}')}]}}`,
    ]);
    const out = await runAgent<MakeVideosResult>(model, makeVideosTask("one clip", { copy, locale: "en", platform: "reels", store, ports: ports(), cut: true }));
    expect(out).toMatchObject({ ok: true, retries: 2, steps: 4 });
    if (!out.ok) return;
    expect(out.result.clips[0].cut).toEqual({ startSec: 1, lengthSec: 19, zoom: 1.25, hook: "Can it escape?", cardSec: 1.5 }); // a string number, the length fitted to the 20 s clip, the zoom snapped, the clip's own hook
    expect(model.calls[2].at(-1)?.content).toMatch(/missing "cut"/);
    expect(model.calls[3].at(-1)?.content).toMatch(new RegExp(`${plan.id}-1: the payoff lands at 12 s`));
    expect(clipCutSpec(out.result.clips[0].cut as NonNullable<MakeVideosResult["clips"][number]["cut"]>)).toEqual({ ...DEFAULT_CLIP_EDIT, startSec: 1, lengthSec: 19, zoom: 1.25, hook: "Can it escape?", cardSec: 1.5 });
    // Without cuts the same answers go through as before (the clip's schema has no cut property then: a cloud model that wrote one anyway would be sent back once, the grammar keeps a local one from it).
    const plain = scripted(['{"action":"tool","tool":"plan_clips","args":{"count":1,"platform":"reels"}}', `{"action":"final","result":{"summary":"one","clips":[${clip("")}]}}`]);
    const before = await runAgent<MakeVideosResult>(plain, makeVideosTask("one clip", { copy, locale: "en", platform: "reels", store: new PlanStore(), ports: ports() }));
    expect(before).toMatchObject({ ok: true, retries: 0 });
    if (before.ok) expect(before.result.clips[0]).not.toHaveProperty("cut");
  });

  // --- ai-cut --- the clips card says what the run did: the checkbox can change under a result that stays on screen
  it("words the clips card from whether the run started the queue, not from the checkbox as it is now", () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const read = (f: string) => strip(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
    const panel = read("src/components/simulator/desktop/AiPanel.tsx");
    expect(panel).toMatch(/t\(ai\.result\.started \? "aiClipsStarted" : "aiClipsQueued"\)/);
    expect(panel).not.toMatch(/t\(autoStart \?/);
    const hook = read("src/components/simulator/desktop/useDesktopAi.ts");
    expect(hook).toMatch(/\{ kind: "videos"; result: MakeVideosResult; plans: ClipPlan\[\]; started: boolean\s*\}/);
    expect(hook).toMatch(/const started = onClips\(out\.result, plans, \{ start: options\.start === true \}\);\s+setResult\(\{ kind: "videos", result: out\.result, plans, started \}\);/);
    // the section answers whether it started the queue: only when asked and something was added
    const section = read("src/components/simulator/sections/DesktopSection.tsx");
    expect(section).toMatch(/options: \{ start: boolean \}\): boolean => \{/);
    expect(section).toMatch(/if \(options\.start && added > 0\) \{\s+queue\.start\(\);\s+setNotice\(t\("aiStartedNotice", \{ count: added \}\)\);\s+return true;\s+\}\s+setNotice\(t\("aiQueuedNotice", \{ count: added \}\)\);\s+return false;/);
  });
});

describe("playbook grounding", () => {
  const md = fs.readFileSync(path.join(__dirname, "../docs/virality-playbook.md"), "utf8");
  it("splits the playbook into chunks under their headings", () => {
    const chunks = splitPlaybook(md);
    expect(chunks.length).toBeGreaterThan(20);
    expect(chunks.some((c) => /recipe/i.test(c.section) && /Motion in frame one/.test(c.text))).toBe(true);
  });
  it("always includes the recipe and ranks the rest by the request, within the budget", () => {
    const text = selectPlaybookContext(md, "which hashtags and caption keywords work on Instagram?", 3000);
    expect(text.length).toBeLessThanOrEqual(3200);
    expect(text).toMatch(/Motion in frame one/);
    expect(text).toMatch(/hashtags/i);
    expect(selectPlaybookContext("", "x")).toBe("");
  });
});

// --- low-findings --- the Windows app's assistant on a Grow page: every Grow setting, the fill-and-loop ones included
describe("--- low-findings --- the assistant's Grow settings", () => {
  const GROW_KEYS = ["growRate", "growCenterDot", "growLines", "growLaw", "growOnFill", "growStep", "growStart", "growHold", "growShrink", "growHue", "growRamp", "growMarkers", "growMarkerLife", "growPitch"];
  it("offers the Grow block on a Grow page (and not elsewhere), the laws and fill choices as enums", () => {
    const grow = defaultSettings("grow");
    const keys = assistantSettings(grow).map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(GROW_KEYS));
    expect(assistantSettings(defaultSettings("glass")).map(([k]) => k).some((k) => k.startsWith("grow"))).toBe(false);
    // the loop contract and its HUD: any mode
    for (const mode of ["grow", "classic", "hoops"] as const) expect(assistantSettings(defaultSettings(mode)).map(([k]) => k), mode).toEqual(expect.arrayContaining(["exportWholeLoops", "loopHud"]));
    const schema = changesSchema(grow);
    expect(validateJson(schema, [{ setting: "growLaw", value: "multiply" }, { setting: "growOnFill", value: "loop" }, { setting: "growStep", value: 11 }, { setting: "loopHud", value: true }])).toEqual([]);
    expect(validateJson(schema, [{ setting: "growLaw", value: "exponential" }]).length).toBeGreaterThan(0);
    expect(settingsCatalog(grow)).toMatch(/growLaw \(one of "approach"\|"multiply"\|"add"\)/);
  });

  it("checks a Grow patch like any other: Fill and loop applies, past the sliders too (uncapped), a law that does not exist is refused", () => {
    const grow = defaultSettings("grow");
    const ok = validateSettingsPatch(grow, { growLaw: "multiply", growOnFill: "loop", growStep: 1500, growStart: 5, growHold: 0.5, growHue: true, exportWholeLoops: true, loopHud: true });
    expect(ok).toEqual({ ok: true, patch: { growLaw: "multiply", growOnFill: "loop", growStep: 1500, growStart: 5, growHold: 0.5, growHue: true, exportWholeLoops: true, loopHud: true } });
    const bad = validateSettingsPatch(grow, { growOnFill: "explode" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join(" ")).toMatch(/growOnFill.*one of "stay", "loop", "finish"/);
  });
});

// --- low-findings-2 --- a core setting that starts with a mode's letters is the core's, never the mode's
describe("--- low-findings-2 --- the assistant's mode settings", () => {
  it("lists the scoreboard's corner as a core setting on a Chord Stars page, and every mode's settings by their own prefix only", () => {
    const stars = assistantSettings(defaultSettings("starChords"));
    expect(stars.find(([k]) => k === "scoreboardPosition")).toEqual(["scoreboardPosition", "corner of the teams scoreboard"]);
    expect(stars.filter(([k]) => k === "scoreboardPosition")).toHaveLength(1);
    expect(stars.find(([k]) => k === "scBalls")?.[1]).toBe("starChords setting");
    expect(settingsCatalog(defaultSettings("starChords"))).toMatch(/scoreboardPosition \(one of "top-left"\|"top-right"\) = "top-left" — corner of the teams scoreboard/);
    expect(validateSettingsPatch(defaultSettings("starChords"), { scoreboardPosition: "top-right" })).toEqual({ ok: true, patch: { scoreboardPosition: "top-right" } });
    expect(validateSettingsPatch(defaultSettings("starChords"), { scoreboardPosition: "middle" }).ok).toBe(false);
    for (const mode of MODE_IDS) {
      const all = assistantSettings(defaultSettings(mode));
      for (const [key, description] of all) if (description === `${mode} setting`) expect(key, mode).toMatch(/^[a-z]+[A-Z0-9]/);
      expect(all.find(([k]) => k === "scoreboardPosition")?.[1], mode).toBe("corner of the teams scoreboard");
    }
    expect([isModeSettingKey("scBalls", "sc"), isModeSettingKey("scoreboardPosition", "sc"), isModeSettingKey("dpLength1", "dp"), isModeSettingKey("sc", "sc")]).toEqual([true, false, true, false]);
  });
});
