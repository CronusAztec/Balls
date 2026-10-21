import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import { defaultSettings } from "@/lib/settings";
import { RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import type { BotCopy } from "@/lib/bot/copy";
import type { AiChatRequest, DesktopPrefs } from "@/lib/desktop/contract";
import { runAgent, type ChatModel } from "@/lib/desktop/ai/agent";
import { PlanStore, clipEditTask, makeVideosTask, settingsTask } from "@/lib/desktop/ai/studio";
// --- ai-cut ---
import { DEFAULT_CLIP_EDIT } from "@/lib/clipEdit/spec";
import { beatsOfPlan } from "@/lib/clipEdit/propose";
import { LocalModelRunner, toChatHistory, type LlamaModuleLike } from "../src/ai/local";
import { toGrammarSchema } from "../src/ai/gbnf";
import { AiService, DEFAULT_CLOUD, type CloudSettings } from "../src/ai/service";
import { anthropicBody, completeAnthropic, completeOpenAi, parseSse, splitSystem, type AnthropicLike } from "../src/ai/cloud";
import { SecretBox, type SafeStorageLike } from "../src/ai/secrets";
import { DEFAULT_PREFS } from "../src/prefs";

/* --- desktop-exe --- the AI studio in the app: the tool-call loop over IPC-shaped requests with a mocked local model, the
   grammar schema, the cloud adapters and the key store */

const copy = (en as unknown as { ViralBot: BotCopy }).ViralBot;

/** A fake node-llama-cpp: every prompt answers the next scripted reply, streamed in two chunks. */
function fakeLlama(replies: string[], seen: { grammars: unknown[]; histories: unknown[]; gpu: unknown[] }): LlamaModuleLike {
  const llama = {
    gpu: "vulkan" as const,
    loadModel: async () => ({ gpuLayers: 29, createContext: async () => ({ getSequence: () => ({}), dispose: async () => {} }), dispose: async () => {} }),
    createGrammarForJsonSchema: async (schema: unknown) => {
      seen.grammars.push(schema);
      return {};
    },
    getGrammarFor: async () => ({}),
    dispose: async () => {},
  };
  class Session {
    setChatHistory(h: unknown) {
      seen.histories.push(h);
    }
    async prompt(_text: string, options: { onTextChunk?: (t: string) => void }) {
      const reply = replies.shift() ?? "";
      options.onTextChunk?.(reply.slice(0, 5));
      options.onTextChunk?.(reply.slice(5));
      return reply;
    }
    dispose() {}
  }
  return {
    getLlama: async (o) => {
      seen.gpu.push(o.gpu);
      return llama;
    },
    LlamaChatSession: Session as unknown as LlamaModuleLike["LlamaChatSession"],
  };
}

const plainStorage: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (t) => Buffer.from(`enc:${t}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ""),
};

function service(replies: string[], prefsPatch: Partial<DesktopPrefs> = {}, extra: Partial<ConstructorParameters<typeof AiService>[0]> = {}) {
  const seen = { grammars: [] as unknown[], histories: [] as unknown[], gpu: [] as unknown[] };
  const tokens: string[] = [];
  let prefs: DesktopPrefs = { ...DEFAULT_PREFS, ...prefsPatch };
  let cloud: CloudSettings = { ...DEFAULT_CLOUD };
  const svc = new AiService({
    prefs: () => prefs,
    setPrefs: (p) => (prefs = { ...prefs, ...p }),
    cloud: () => cloud,
    setCloud: (c) => (cloud = c),
    secrets: new SecretBox(plainStorage),
    local: new LocalModelRunner(async () => fakeLlama(replies, seen)),
    modelPath: async (id) => (id === DEFAULT_PREFS.localModel ? "/models/llama.gguf" : null),
    emitToken: (_id, t) => tokens.push(t),
    ...extra,
  });
  return { svc, seen, tokens, cloud: () => cloud };
}

/** The page's ChatModel over the app's AiService, the way window.desktop.ai.chat carries it. */
function viaService(svc: AiService): ChatModel {
  let n = 0;
  return {
    complete: async (messages, options) => {
      const request: AiChatRequest = { requestId: `r${++n}`, messages, schema: options.schema as Record<string, unknown>, maxTokens: options.maxTokens, temperature: options.temperature };
      return (await svc.chat(request)).text;
    },
  };
}

describe("AI through the app", () => {
  it("plans clips with a local model: invalid output is retried, the plan JSON validated", async () => {
    const plan = planClip(RECIPES[0], 3, "reels", { copy, search: false });
    const store = new PlanStore();
    const replies = [
      '{"action":"tool","tool":"plan_clips","args":{"count":1,"platform":"reels"}}',
      // Invalid: hashtags without # and an unknown planId – sent back, never applied.
      '{"action":"final","result":{"summary":"x","clips":[{"planId":"ghost","name":"a","title":"t","hook":"h","caption":"c","hashtags":["a","b","c"],"platform":"reels"}]}}',
      `{"action":"final","result":{"summary":"one clip","clips":[{"planId":"${plan.id}","name":"monday glass","title":"Glass","hook":"Can it escape?","caption":"Which ring?","hashtags":["#physics","#asmr","#satisfying"],"platform":"reels"}]}}`,
    ];
    const { svc, seen, tokens } = service(replies);
    const ports = { planClips: async () => [plan], findSimulation: async () => ({ found: false, seed: 0, durationSec: 0 }) };
    const out = await runAgent(viaService(svc), makeVideosTask("one clip for Monday", { copy, locale: "en", platform: "reels", store, ports }));
    expect(out).toMatchObject({ ok: true, retries: 1 });
    expect(seen.gpu).toEqual(["auto"]); // GPU offload asked for, CPU fallback is node-llama-cpp's
    expect(tokens.join("")).toContain('"action":"tool"');
    // The reply grammar: a oneOf of the final answer and each tool call, patterns dropped. --- desktop-ai-fix --- rebuilt per
    // turn: before plan_clips has made plans the answer is not on offer (the 3 tool calls only); after it, the answer joins
    // with its planIds an enum of the plans made.
    const first = seen.grammars[0] as { oneOf: { properties: { action: { const: string } } }[] };
    expect(first.oneOf.map((g) => g.properties.action.const)).toEqual(["tool", "tool", "tool"]);
    const grammar = seen.grammars[1] as { oneOf: { properties: { action: unknown } }[] };
    expect(grammar.oneOf.length).toBe(4);
    expect(JSON.stringify(grammar)).not.toContain("pattern");
    expect(JSON.stringify(grammar)).toContain(`"planId":{"enum":["${plan.id}"]}`);
    expect((await svc.status()).local).toMatchObject({ loaded: true, backend: "vulkan", gpuLayers: 29 });
  });

  // --- ai-cut --- the cut rides the same channel: its schema reaches the grammar with its steps as enums, its bounds left to the page
  it("cuts each clip with the local model: the cut's schema reaches the grammar with its enums and nothing the grammar cannot hold", async () => {
    const base = planClip(RECIPES[0], 3, "reels", { copy, search: false });
    const plan = { ...base, ending: "resolved" as const, payoff: { ...base.payoff, atSec: 12, cutGapSec: null }, timing: { ...base.timing, clipSec: 20, firstImpactSec: 0.8 }, settings: { ...base.settings, dpPalindrome: false, hpReturn: false } };
    const store = new PlanStore();
    const replies = [
      '{"action":"tool","tool":"plan_clips","args":{"count":1,"platform":"reels"}}',
      `{"action":"final","result":{"summary":"one clip","clips":[{"planId":"${plan.id}","name":"monday glass","title":"Glass","hook":"Can it escape?","caption":"Which ring?","hashtags":["#physics","#asmr","#satisfying"],"platform":"reels","cut":{"startSec":0.5,"lengthSec":13,"zoom":1.25,"hook":"Will it escape?","cardSec":1.5}}]}}`,
    ];
    const { svc, seen } = service(replies);
    const ports = { planClips: async () => [plan], findSimulation: async () => ({ found: false, seed: 0, durationSec: 0 }) };
    const out = await runAgent(viaService(svc), makeVideosTask("one clip for Monday", { copy, locale: "en", platform: "reels", store, ports, cut: true }));
    expect(out).toMatchObject({ ok: true, retries: 0, result: { clips: [{ cut: { startSec: 0.5, lengthSec: 13, zoom: 1.25, hook: "Will it escape?", cardSec: 1.5 } }] } });
    expect(seen.grammars).toHaveLength(2); // a planning turn and the answer: no new tool
    const grammar = JSON.stringify(seen.grammars[1]);
    expect(grammar).toContain('"cut":{"type":"object"');
    expect(grammar).toContain('"zoom":{"enum":[1,1.15,1.25,1.4,1.6]}');
    expect(grammar).toContain('"cardSec":{"enum":[0,1,1.5,2]}');
    expect(grammar).toContain('"hook":{"type":"string","maxLength":60}');
    expect(grammar).toContain('"required":["planId","name","title","hook","caption","hashtags","platform","cut"]');
    expect(grammar).not.toContain("minimum");
    expect(grammar).not.toContain("pattern");
    expect(grammar).not.toContain('"additionalProperties":true');
    // The standalone cut task over the same channel: one alternative, the answer, the summary with the five fields.
    const { svc: cutSvc, seen: cutSeen } = service(['{"action":"final","result":{"startSec":1,"lengthSec":12,"zoom":1.4,"hook":"Which pane breaks?","cardSec":1,"summary":"ok"}}']);
    const cut = await runAgent(viaService(cutSvc), clipEditTask("", { locale: "en", beats: beatsOfPlan(plan), base: DEFAULT_CLIP_EDIT, ideas: ["Will it escape?"] }));
    expect(cut).toMatchObject({ ok: true, retries: 0, result: { startSec: 1, lengthSec: 12, zoom: 1.4, hook: "Which pane breaks?", cardSec: 1, summary: "ok" } });
    const cutGrammar = cutSeen.grammars[0] as { properties: { action: { const: string }; result: { required: string[]; additionalProperties: boolean } } };
    expect(cutGrammar.properties.action.const).toBe("final");
    expect(cutGrammar.properties.result.required).toEqual(["startSec", "lengthSec", "zoom", "hook", "cardSec", "summary"]);
    expect(cutGrammar.properties.result.additionalProperties).toBe(false);
  });

  it("checks a settings patch from the local model before the page may apply it", async () => {
    const { svc, seen } = service(['{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":"fast"}],"summary":"x"}}', '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":800},{"setting":"gravity","value":0}],"summary":"Faster, no gravity"}}']);
    const out = await runAgent(viaService(svc), settingsTask("twice as fast, no gravity", defaultSettings("classic"), "en"));
    expect(out).toMatchObject({ ok: true, retries: 1, result: { changes: [{ setting: "ballSpeed", value: 800 }, { setting: "gravity", value: 0 }] } });
    // The grammar only lets the local model name real settings: one alternative per setting, no free-form keys.
    const grammar = JSON.stringify(seen.grammars[0]);
    expect(grammar).toContain('"const":"ballSpeed"');
    expect(grammar).not.toContain('"additionalProperties":true');
  });

  it("refuses without a model and maps the conversation for llama.cpp", async () => {
    const { svc } = service([], { localModel: "missing" });
    await expect(svc.chat({ requestId: "x", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/No local model/);
    expect(toChatHistory([{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: "a" }, { role: "user", content: "next" }])).toEqual({
      history: [{ type: "system", text: "s" }, { type: "user", text: "u" }, { type: "model", response: ["a"] }],
      prompt: "next",
    });
    expect(() => toChatHistory([{ role: "assistant", content: "a" }])).toThrow();
  });
});

describe("grammar schema", () => {
  it("keeps what llama.cpp grammars support and frees free-form objects", () => {
    expect(toGrammarSchema({ type: "object", properties: { n: { type: "integer", minimum: 1 }, s: { type: "string", pattern: "^#", maxLength: 9 }, any: { type: "object" }, both: { type: ["object", "null"] } }, required: ["n"], additionalProperties: false })).toEqual({
      type: "object",
      properties: { n: { type: "integer" }, s: { type: "string", maxLength: 9 }, any: { type: "object", additionalProperties: true }, both: { oneOf: [{ type: "object", additionalProperties: true }, { type: "null" }] } },
      required: ["n"],
      additionalProperties: false,
    });
    expect(toGrammarSchema({ enum: ["a", "b"] })).toEqual({ enum: ["a", "b"] });
    expect(toGrammarSchema({ type: "array", items: { const: 1 }, maxItems: 3 })).toEqual({ type: "array", items: { const: 1 }, maxItems: 3 });
  });
});

describe("cloud providers", () => {
  const messages = [
    { role: "system" as const, content: "rules" },
    { role: "user" as const, content: "hi" },
  ];
  it("streams from Anthropic with the refusal fallback on current models", async () => {
    const calls: Record<string, unknown>[] = [];
    const client: AnthropicLike = {
      beta: {
        messages: {
          stream: (body) => {
            calls.push(body);
            let listener: (t: string) => void = () => {};
            return {
              on: (_e: "text", l: (t: string) => void) => (listener = l),
              finalMessage: async () => {
                listener('{"a"');
                listener(":1}");
                return { stop_reason: "end_turn", content: [{ type: "text", text: '{"a":1}' }] };
              },
            };
          },
        },
      },
    };
    const tokens: string[] = [];
    expect(await completeAnthropic(client, "claude-opus-5-5", { messages, onToken: (t) => tokens.push(t) })).toBe('{"a":1}');
    expect(tokens).toEqual(['{"a"', ":1}"]);
    expect(calls[0]).toMatchObject({ model: "claude-opus-5-5", system: "rules", messages: [{ role: "user", content: "hi" }], fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
    expect(calls[0]).not.toHaveProperty("temperature");
    expect(anthropicBody("claude-haiku-4-5", { messages })).not.toHaveProperty("fallbacks");
    const refusing: AnthropicLike = { beta: { messages: { stream: () => ({ on: () => undefined, finalMessage: async () => ({ stop_reason: "refusal", stop_details: { category: "cyber" }, content: [] }) }) } } };
    await expect(completeAnthropic(refusing, "claude-opus-5-5", { messages })).rejects.toThrow(/declined the request \(cyber\)/);
    expect(splitSystem(messages).turns).toEqual([{ role: "user", content: "hi" }]);
  });

  it("streams an OpenAI-compatible chat completion over SSE", async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"{\\"a\\""}}]}\n\ndata: {"choices":[{"delta":{"content":":2}"}}]}\n\ndata: [DONE]\n\n';
    let sentHeaders: Headers | null = null;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sentHeaders = new Headers(init.headers);
      const bytes = new TextEncoder().encode(sse);
      return new Response(new ReadableStream({ start: (c) => (c.enqueue(bytes.slice(0, 30)), c.enqueue(bytes.slice(30)), c.close()) }), { status: 200 });
    }) as unknown as typeof fetch;
    const tokens: string[] = [];
    expect(await completeOpenAi(fetchImpl, "http://localhost:11434/v1/", "sk-test", "llama3.2", { messages, onToken: (t) => tokens.push(t) })).toBe('{"a":2}');
    expect(sentHeaders!.get("authorization")).toBe("Bearer sk-test");
    expect(parseSse("data: 1\n\ndata: 2\n\ndata: 3")).toEqual({ data: ["1", "2"], rest: "data: 3" });
    const failing = (async () => new Response("bad key", { status: 401 })) as unknown as typeof fetch;
    await expect(completeOpenAi(failing, "", "k", "m", { messages })).rejects.toThrow(/HTTP 401: bad key/);
  });

  it("stores the key sealed, uses it for the cloud, and never returns it", async () => {
    const calls: Record<string, unknown>[] = [];
    const { svc, cloud } = service([], {}, {
      anthropic: (key) => {
        calls.push({ key });
        return { beta: { messages: { stream: () => ({ on: () => undefined, finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] }) }) } } };
      },
    });
    const status = await svc.setCloud({ provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", apiKey: "sk-ant-secret", use: true });
    expect(status).toMatchObject({ provider: "cloud", ready: true, cloud: { hasKey: true, encryption: true } });
    expect(JSON.stringify(status)).not.toContain("sk-ant-secret");
    expect(cloud().keySealed).toBe(Buffer.from("enc:sk-ant-secret").toString("base64"));
    expect((await svc.chat({ requestId: "c1", messages: [{ role: "user", content: "hi" }] })).text).toBe("ok");
    expect(calls).toEqual([{ key: "sk-ant-secret" }]);
    expect((await svc.clearCloudKey()).cloud.hasKey).toBe(false);
    const noCrypto = new SecretBox({ ...plainStorage, isEncryptionAvailable: () => false });
    expect(() => noCrypto.seal("k")).toThrow(/not saved/);
    expect(noCrypto.open("x")).toBeNull();
  });
});
