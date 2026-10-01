import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import en from "../messages/en.json";
import { defaultSettings } from "@/lib/settings";
import { RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import type { BotCopy } from "@/lib/bot/copy";
import type { AiMessage } from "@/lib/desktop/contract";
import { extractJson, validateJson, type JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { normaliseReply, replySchema, runAgent, type AgentEvent, type ChatModel } from "@/lib/desktop/ai/agent";
import { assistantSettings, changedKeys, changesSchema, invertPatch, patchFromChanges, settingsCatalog, validateSettingsPatch } from "@/lib/desktop/ai/settingsPatch";
import { PlanStore, copyTask, ideasTask, makeVideosTask, settingsTask, type MakeVideosResult, type SettingsResult, type StudioPorts } from "@/lib/desktop/ai/studio";
import { selectPlaybookContext, splitPlaybook } from "@/lib/desktop/ai/playbookContext";

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
    const r = validateSettingsPatch(current, { speed: 2, ballSpeed: 5000, rainbowBall: "yes", instrument: "kazoo", ballColor: "red", teams: [], mode: "nope" });
    expect(r.ok).toBe(false);
    const text = r.ok ? "" : r.errors.join("\n");
    expect(text).toMatch(/"speed" is not a setting/);
    expect(text).toMatch(/"ballSpeed" must be between 50 and 800/);
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
    expect(catalog).toContain("ballSpeed (number 50–800, step 10) = 400");
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
    expect(validateJson(schema, [{ setting: "ballSpeed", value: 900 }]).join(" ")).toMatch(/≤ 800/);
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
    // a patch may turn the switch on itself; without it the ranges apply
    expect(validateSettingsPatch(current, { unlimited: true, ballSpeed: 5000 })).toEqual({ ok: true, patch: { unlimited: true, ballSpeed: 5000 } });
    expect(validateSettingsPatch(current, { ballSpeed: 5000 }).ok).toBe(false);
    expect(settingsCatalog(unlimited)).toContain("ballSpeed (number from 50, no upper limit (Wide sliders is on), slider 50–800, step 10) = 400");
    const schema = changesSchema(unlimited);
    expect(validateJson(schema, [{ setting: "ballSpeed", value: 1e9 }])).toEqual([]);
    expect(validateJson(schema, [{ setting: "ballSpeed", value: 10 }]).join(" ")).toMatch(/≥ 50/);
  });

  it("changes the numeric Bounciness, and the old Bouncier switch through it (--- uncap-all ---)", () => {
    expect(assistantSettings(current).map(([k]) => k)).toContain("bounciness");
    expect(validateSettingsPatch(current, { bounciness: 1.5 })).toEqual({ ok: true, patch: { bounciness: 1.5, bouncierEnabled: true } });
    expect(validateSettingsPatch(current, { bouncierEnabled: true })).toEqual({ ok: true, patch: { bouncierEnabled: true, bounciness: 1.03 } });
    const bouncy = { ...current, bounciness: 1.5, bouncierEnabled: true };
    expect(validateSettingsPatch(bouncy, { bouncierEnabled: false })).toEqual({ ok: true, patch: { bouncierEnabled: false, bounciness: 1 } });
    expect(validateSettingsPatch(current, { bounciness: 50 }).ok).toBe(false); // past its slider only with Wide sliders on
    expect(validateSettingsPatch({ ...current, unlimited: true }, { bounciness: 50 })).toEqual({ ok: true, patch: { bounciness: 50, bouncierEnabled: true } });
  });

  it("runs as an agent task: an out-of-range change is sent back, the corrected one comes out", async () => {
    const model = scripted([
      '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":1600},{"setting":"rainbowBall","value":true}],"summary":"x2"}}',
      '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":800},{"setting":"rainbowBall","value":true},{"setting":"gravity","value":0}],"summary":"Twice as fast (capped), rainbow, no gravity"}}',
    ]);
    const out = await runAgent<SettingsResult>(model, settingsTask("make the ball twice as fast and rainbow, no gravity", current, "en"));
    expect(out.ok).toBe(true);
    if (out.ok) expect(patchFromChanges(out.result.changes)).toEqual({ ballSpeed: 800, rainbowBall: true, gravity: 0 });
    expect(out).toMatchObject({ retries: 1 });
    expect(model.calls[1].at(-1)?.content).toMatch(/≤ 800/);
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
