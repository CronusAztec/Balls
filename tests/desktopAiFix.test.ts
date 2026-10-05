import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { defaultSettings } from "@/lib/settings";
import { MODE_IDS } from "@/lib/physics/types";
import { RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import type { BotCopy } from "@/lib/bot/copy";
import type { AiMessage } from "@/lib/desktop/contract";
import { checkIpcArgs, IPC } from "@/lib/desktop/contract";
import { validateJson } from "@/lib/desktop/ai/jsonSchema";
import { DEFAULT_TEMPERATURE, RETRY_TEMPERATURE_STEP, replySchema, runAgent, type ChatModel, type ChatOptions } from "@/lib/desktop/ai/agent";
import { PlanStore, copyFinal, copyTask, makeVideosTask, recipeList, settingsTask, type CopyResult, type MakeVideosResult, type StudioPorts } from "@/lib/desktop/ai/studio";
import { fitText, normaliseCopyResult, normaliseHashtags, normaliseMakeVideosResult, normalisePlatform, resolvePlanId, slugifyClipName, withoutPlaceholders } from "@/lib/desktop/ai/normalise";
import { CORE_SETTING_KEYS, MAX_RELEVANT_SETTINGS, relevantAssistantSettings } from "@/lib/desktop/ai/settingsFilter";
import { assistantSettings, settingsCatalog } from "@/lib/desktop/ai/settingsPatch";
import { foldSystemNotes } from "@/lib/desktop/ai/conversation";
import { describeError, errorChain, errorCodes, stripIpcPrefix } from "@/lib/desktop/errors";
import { DESKTOP_VERSION } from "@/lib/desktop/release";
import { aiErrorText } from "@/components/simulator/desktop/useDesktopAi";
import { errorText } from "@/components/simulator/desktop/ui";
import { needsSetup, setupModel } from "@/components/simulator/desktop/AiSetupCard";

/* --- desktop-ai-fix --- the Windows app's AI fixes on the page's side: the reply normalisers (fed the replies 1.0.2's local
   models really gave), the per-turn reply envelope, the retries, the IPC prefix, the settings filter, the messages and the
   version the download page shows */

const copy = (en as unknown as { ViralBot: BotCopy }).ViralBot;

/** A model that replies from a script and records what it was sent and with which options. */
function scripted(replies: string[]): ChatModel & { calls: AiMessage[][]; options: ChatOptions[] } {
  const calls: AiMessage[][] = [];
  const options: ChatOptions[] = [];
  return {
    calls,
    options,
    async complete(messages, opts) {
      calls.push(messages.map((m) => ({ ...m })));
      options.push(opts);
      const reply = replies.shift();
      if (reply === undefined) throw new Error("script ran out");
      opts.onToken?.(reply);
      return reply;
    },
  };
}

describe("reply normalisers (the replies 1.0.2's local models gave)", () => {
  it("fixes hashtags: no '#', all in one string, repeated, punctuation, too many or too few", () => {
    // Llama-3.2-3B and Qwen2.5-1.5B: hashtags without "#" ("…hashtags[0]: must match ^#[^\s#]{1,60}$").
    expect(normaliseHashtags(["physics", "satisfying", "bouncingball"])).toEqual(["#physics", "#satisfying", "#bouncingball"]);
    // Qwen2.5-1.5B's first reply put every hashtag into one string, repeating (it ran to the 1,200-token limit).
    const runaway = Array.from({ length: 40 }, () => "#physics #satisfying #bouncingball").join(" ");
    expect(normaliseHashtags([runaway])).toEqual(["#physics", "#satisfying", "#bouncingball"]);
    expect(normaliseHashtags("#physics,#asmr; #oddlysatisfying")).toEqual(["#physics", "#asmr", "#oddlysatisfying"]);
    expect(normaliseHashtags(["#ball-physics!", "#Physics", "#physics", "##fyp", "#física"])).toEqual(["#ballphysics", "#Physics", "#fyp", "#física"]);
    const many = normaliseHashtags(Array.from({ length: 30 }, (_, i) => `tag${i}`)) as string[];
    expect(many).toHaveLength(15);
    expect(normaliseHashtags(["#one"], ["#physics", "#satisfying", "#bouncingball"])).toEqual(["#one", "#physics", "#satisfying"]);
    expect(normaliseHashtags(["#" + "x".repeat(90)])).toEqual(["#" + "x".repeat(60)]);
    expect(normaliseHashtags(42)).toBe(42); // not a list: left for the checks to report
    for (const tag of many) expect(tag).toMatch(/^#[^\s#]{1,60}$/);
  });

  it("slugifies clip names and maps platform names", () => {
    expect(slugifyClipName("Monday Glass Smash!!!")).toBe("Monday Glass Smash");
    expect(slugifyClipName("Łódź – szkło #1")).toBe("Lodz szklo 1");
    expect(slugifyClipName("¿Escapará?", "fallback title")).toBe("Escapara");
    expect(slugifyClipName("!!!", "Ring escape")).toBe("Ring escape");
    expect(slugifyClipName(undefined)).toBe("clip");
    expect(slugifyClipName("a".repeat(100))).toHaveLength(60);
    for (const raw of ["Monday Glass Smash!!!", "Łódź – szkło #1", "---x", "  spaced  out  "]) expect(slugifyClipName(raw)).toMatch(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,59}$/);
    expect(normalisePlatform("TikTok")).toBe("tiktok");
    expect(normalisePlatform("Instagram Reels")).toBe("reels");
    expect(normalisePlatform("YouTube Shorts")).toBe("shorts");
    expect(normalisePlatform("myspace")).toBe("myspace");
  });

  it("takes the recipe hooks' placeholders out of the prompt and out of a copied reply", () => {
    // 1.0.2's prompt showed "Can it escape in {seconds} seconds?" and Qwen2.5-1.5B wrote it into its hooks.
    expect(withoutPlaceholders("Can it escape in {seconds} seconds?")).toBe("Can it escape in 30 seconds?");
    expect(withoutPlaceholders("{rule}. {layers} layers to go.")).toBe("5 layers to go.");
    expect(recipeList(copy)).not.toMatch(/\{\w+\}/);
    expect(fitText("Can it escape in {seconds} seconds?", 120, { seconds: 24 })).toBe("Can it escape in 24 seconds?");
    expect(fitText("Can it escape in {seconds} seconds?", 120)).toBe("Can it escape in seconds?");
    expect(fitText("word ".repeat(40), 100)).toHaveLength(99);
  });

  it("gives the copy one item per requested platform (Llama-3.2-3B answered tiktok when only reels was asked)", () => {
    const reply = { items: [{ platform: "tiktok", title: " Ring escape ", hook: "Can it escape?", caption: "Which ring breaks first?", hashtags: ["physics", "satisfying"], extra: 1 }] };
    const fixed = normaliseCopyResult(reply, ["reels"], ["#physics", "#satisfying", "#bouncingball"]) as CopyResult;
    expect(fixed.items).toEqual([{ platform: "reels", title: "Ring escape", hook: "Can it escape?", caption: "Which ring breaks first?", hashtags: ["#physics", "#satisfying", "#bouncingball"] }]);
    expect(validateJson(copyFinal(["reels"]), fixed)).toEqual([]);
    // Two items for one platform, none for another: the second takes the missing one; items beyond the request go.
    const twice = normaliseCopyResult({ items: ["tiktok", "TikTok", "shorts", "reels"].map((platform) => ({ platform, title: "t", hook: "h", caption: "c", hashtags: ["#a", "#b", "#c"] })) }, ["tiktok", "reels"]) as CopyResult;
    expect(twice.items.map((i) => i.platform)).toEqual(["tiktok", "reels"]);
  });

  it("resolves planIds and fixes clips (Qwen2.5-1.5B answered planIds 1, 2, 3; Llama-3.2-3B invented plan_clips_12345)", () => {
    const plans = [
      { id: "ep012-ring-escape-111", platform: "reels" as const, hashtags: ["#physics", "#satisfying", "#ringescape"], vars: { seconds: 24, episode: 12 } },
      { id: "ep012-glass-smash-222", platform: "reels" as const, hashtags: ["#glass", "#asmr", "#physics"], vars: { seconds: 31, episode: 12 } },
    ];
    expect(resolvePlanId("1", plans)?.id).toBe("ep012-ring-escape-111");
    expect(resolvePlanId(" EP012-GLASS-SMASH-222 ", plans)?.id).toBe("ep012-glass-smash-222");
    expect(resolvePlanId("3", plans)).toBeUndefined();
    expect(resolvePlanId("plan_clips_12345", plans)).toBeUndefined();
    const fixed = normaliseMakeVideosResult(
      {
        clips: [
          { planId: "1", name: "Monday: ring escape!", title: "Ring escape", hook: "Can it escape in {seconds} seconds?", caption: "Which ring?", hashtags: ["physics"], platform: "TikTok" },
          { planId: "1", name: "dup", title: "dup", hook: "dup", caption: "dup", hashtags: [], platform: "reels" },
          { planId: "new_plan_12345", name: "x", title: "x", hook: "x", caption: "x", hashtags: ["#a", "#b", "#c"], platform: "reels" },
        ],
      },
      plans,
    ) as MakeVideosResult;
    expect(fixed.summary).toBe("");
    expect(fixed.clips[0]).toEqual({ planId: "ep012-ring-escape-111", name: "Monday ring escape", title: "Ring escape", hook: "Can it escape in 24 seconds?", caption: "Which ring?", hashtags: ["#physics", "#satisfying", "#ringescape"], platform: "reels" });
    expect(fixed.clips.map((c) => c.planId)).toEqual(["ep012-ring-escape-111", "new_plan_12345"]); // the second clip of plan 1 dropped; the invented id stays for the checks
  });
});

describe("the reply envelope, rebuilt every turn", () => {
  const plan = planClip(RECIPES[0], 42, "reels", { copy, search: false });
  const ports = (): StudioPorts => ({
    planClips: async (request) => Array.from({ length: request.count }, (_, i) => ({ ...plan, id: `${plan.id}-${i + 1}`, platform: request.platform })),
    findSimulation: async (_s, request) => ({ found: true, seed: 7, durationSec: request.targetSec }),
  });

  it("offers Make videos' answer only after plan_clips, then only with the plans' ids", async () => {
    const store = new PlanStore();
    const task = makeVideosTask("three clips", { copy, locale: "en", platform: "reels", store, ports: ports() });
    const first = task.turn?.();
    expect(first?.final).toBeNull();
    expect(first?.hint).toMatch(/plan_clips first/);
    const before = replySchema(first?.tools ?? [], first?.final ?? null);
    expect(before.oneOf?.map((s) => (s.properties?.action as { const: string }).const)).toEqual(["tool", "tool", "tool"]);
    // Qwen2.5-1.5B's turn-1 answer with invented planIds is not a valid reply any more.
    const early = { action: "final", result: { summary: "", clips: [{ planId: "1", name: "a", title: "t", hook: "h", caption: "c", hashtags: ["#a", "#b", "#c"], platform: "reels" }] } };
    expect(validateJson(before, early).length).toBeGreaterThan(0);
    store.add({ ...plan, id: "p-1" });
    store.add({ ...plan, id: "p-2" });
    const after = task.turn?.();
    const envelope = replySchema(after?.tools ?? [], after?.final ?? null);
    expect(envelope.oneOf).toHaveLength(4);
    const ok = { action: "final", result: { summary: "", clips: [{ planId: "p-2", name: "a", title: "t", hook: "h", caption: "c", hashtags: ["#a", "#b", "#c"], platform: "reels" }] } };
    expect(validateJson(envelope, ok)).toEqual([]);
    expect(validateJson(envelope, { ...ok, result: { ...ok.result, clips: [{ ...ok.result.clips[0], planId: "plan_clips_12345" }] } }).join(" ")).toMatch(/must be one of "p-1", "p-2"/);
    expect(JSON.stringify(envelope)).toContain('"planId":{"enum":["p-1","p-2"]}');
    expect(after?.hint).toBe("planId must be one of: p-1, p-2.");
  });

  it("runs Make videos the way a small model does: an early answer is refused with a hint, the planned one goes through", async () => {
    const store = new PlanStore();
    const model = scripted([
      // turn 1: Qwen2.5-1.5B's reply in 1.0.2 – the answer straight away, planIds "1", "2", "3"
      `{"action":"final","result":{"summary":"3 clips","clips":[${[1, 2, 3].map((n) => `{"planId":"${n}","name":"clip ${n}","title":"t","hook":"h","caption":"c","hashtags":["#a","#b","#c"],"platform":"reels"}`).join(",")}]}}`,
      '{"action":"tool","tool":"plan_clips","args":{"count":1,"platform":"reels"}}',
      // hashtags without "#" and a name with punctuation: normalised, not retried
      `{"action":"final","result":{"summary":"one","clips":[{"planId":"${plan.id}-1","name":"Ring escape!","title":"Ring escape","hook":"Can it escape?","caption":"Which ring?","hashtags":["physics","satisfying","bouncingball"],"platform":"reels"}]}}`,
    ]);
    const out = await runAgent<MakeVideosResult>(model, makeVideosTask("three clips", { copy, locale: "en", platform: "reels", store, ports: ports() }));
    expect(out).toMatchObject({ ok: true, retries: 1 });
    if (out.ok) expect(out.result.clips[0]).toMatchObject({ name: "Ring escape", hashtags: ["#physics", "#satisfying", "#bouncingball"] });
    // The retry: the app's note (a system message) with the hint, at a higher temperature; every request names the job.
    const note = model.calls[1].at(-1) as AiMessage;
    expect(note.role).toBe("system");
    expect(note.content).toMatch(/^Your reply was not valid:/);
    expect(note.content).toMatch(/Call plan_clips first/);
    expect(model.options.map((o) => o.temperature)).toEqual([0.4, 0.4 + RETRY_TEMPERATURE_STEP, 0.4]);
    expect(model.options.every((o) => o.task === "videos")).toBe(true);
    // The prompt stays the same on every turn (the local model reuses what it already read).
    expect(new Set(model.calls.map((c) => c[0].content)).size).toBe(1);
  });

  it("raises the temperature with every invalid reply in a row, from the transports' default when a task sets none", async () => {
    const final = { type: "object" as const, properties: { answer: { type: "string" as const } }, required: ["answer"], additionalProperties: false };
    const model = scripted(["x", "y", '{"action":"final","result":{"answer":"ok"}}']);
    const out = await runAgent(model, { system: "s", user: "u", tools: [], final });
    expect(out.ok).toBe(true);
    expect(model.options.map((o) => o.temperature)).toEqual([undefined, DEFAULT_TEMPERATURE + RETRY_TEMPERATURE_STEP, DEFAULT_TEMPERATURE + 2 * RETRY_TEMPERATURE_STEP]);
  });

  it("holds the copy to the requested platforms, one item each, with bounded hashtags", async () => {
    const schema = copyFinal(["tiktok", "shorts"]);
    const items = (schema.properties?.items ?? {}) as { minItems: number; maxItems: number; items: { properties: Record<string, { enum?: unknown; maxLength?: number; items?: { maxLength: number } }> } };
    expect([items.minItems, items.maxItems]).toEqual([2, 2]);
    expect(items.items.properties.platform.enum).toEqual(["tiktok", "shorts"]);
    expect(items.items.properties.hashtags.items?.maxLength).toBe(61);
    const task = copyTask("", { locale: "en", platforms: ["reels"], settings: defaultSettings("classic"), existing: "" });
    expect(task.name).toBe("copy");
    // Llama-3.2-3B's replies in 1.0.2: no "#", then a platform that was not asked for – both fixed before the checks.
    const model = scripted(['{"action":"final","result":{"items":[{"platform":"tiktok","title":"Ring escape","hook":"Can it escape?","caption":"Which ring breaks first?","hashtags":["physics","satisfying","bouncingball"]}]}}']);
    const out = await runAgent<CopyResult>(model, task);
    expect(out).toMatchObject({ ok: true, retries: 0, result: { items: [{ platform: "reels", hashtags: ["#physics", "#satisfying", "#bouncingball"] }] } });
  });

  it("bounds the clip name for the grammar", () => {
    const store = new PlanStore();
    store.add({ ...plan, id: "p-1" });
    const task = makeVideosTask("x", { copy, locale: "en", platform: "reels", store, ports: ports() });
    const turn = task.turn?.();
    const clip = ((turn?.final?.properties?.clips as { items: { properties: Record<string, { maxLength?: number }> } }).items.properties);
    expect(clip.name.maxLength).toBe(60);
    expect((clip.hashtags as unknown as { items: { maxLength: number } }).items.maxLength).toBe(61);
    // set_clip_settings describes its arguments in a line instead of its 2,000-token schema
    expect(task.tools.find((t) => t.name === "set_clip_settings")?.argsHint).toMatch(/ballSpeed/);
    const prompt = makeVideosTask("x", { copy, locale: "en", platform: "reels", store: new PlanStore(), ports: ports() });
    expect(JSON.stringify(prompt.tools.find((t) => t.name === "set_clip_settings")?.args).length).toBeGreaterThan(2000);
  });
});

describe("the settings assistant's shorter prompt", () => {
  const current = defaultSettings("classic");
  it("lists the core settings and those the request points at", () => {
    const keys = relevantAssistantSettings(current, "make the ball twice as fast and rainbow, no gravity").map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(["ballSpeed", "rainbowBall", "gravity", "mode"]));
    expect(keys).not.toContain("trailThickness");
    expect(keys.length).toBeLessThan(assistantSettings(current).length);
    expect(relevantAssistantSettings(current, "thicker trails please").map(([k]) => k)).toEqual(expect.arrayContaining(["trailThickness", "showTrails"]));
    expect(relevantAssistantSettings(current, "use a marimba and a pentatonic scale").map(([k]) => k)).toEqual(expect.arrayContaining(["instrument", "scale"]));
    // Polish and Spanish requests reach the same settings.
    expect(relevantAssistantSettings(current, "dodaj wiatr i grubsze ślady").map(([k]) => k)).toEqual(expect.arrayContaining(["windX", "trailThickness"]));
    expect(relevantAssistantSettings(current, "más viento y estela").map(([k]) => k)).toEqual(expect.arrayContaining(["windX", "showTrails"]));
    for (const key of CORE_SETTING_KEYS) expect(relevantAssistantSettings(current, "").map(([k]) => k)).toContain(key);
    // A request about the page's mode gets the mode's own block.
    const glass = defaultSettings("glass");
    expect(relevantAssistantSettings(glass, "more glass floors, harder glass").map(([k]) => k)).toEqual(expect.arrayContaining(["glassRows", "glassHp"]));
  });

  // --- review fix (desktop-ai-fix) --- the page mode's block is offered whether or not the request names the mode: its
  // settings are described only as "<mode> setting", so no word of "more floors" reached glassRows and the grammar (built
  // from the same list) left the model no way to change them
  const blockOf = (mode: (typeof MODE_IDS)[number]) => assistantSettings(defaultSettings(mode)).filter(([, d]) => d === `${mode} setting`).map(([k]) => k);
  it("offers the page mode's own settings to a request that does not name the mode", () => {
    const glass = defaultSettings("glass");
    const glassBlock = blockOf("glass");
    expect(glassBlock).toEqual(["glassRows", "glassHp", "glassStages", "glassMoving", "glassHoles", "glassGates"]);
    for (const request of ["make the panes break on the second hit", "more floors", "twice as many layers to smash through", "faster"]) {
      const keys = relevantAssistantSettings(glass, request).map(([k]) => k);
      expect(keys, request).toEqual(expect.arrayContaining(glassBlock));
      // ...and so the reply's grammar may name them
      const task = settingsTask(request, glass, "en");
      const named = ((task.final.properties?.changes as { items: { oneOf: { properties: { setting: { const: string } } }[] } }).items.oneOf).map((a) => a.properties.setting.const);
      expect(named, request).toEqual(expect.arrayContaining(glassBlock));
      expect(task.system).toContain("glassHp (");
    }
    // Fight League: 26 settings of its own, every one offered for "longer rounds" (flTimeCap), with the core ones.
    const league = defaultSettings("fightLeague");
    const leagueBlock = blockOf("fightLeague");
    expect(leagueBlock.length).toBe(39); // --- fl-overhaul --- 26 + the overhaul's flSeek and flSuddenDeath (+ Stage 3's eight spectacle settings, + Stage 4's three sound settings)
    const rounds = relevantAssistantSettings(league, "longer rounds").map(([k]) => k);
    expect(rounds).toEqual(expect.arrayContaining([...leagueBlock, ...CORE_SETTING_KEYS]));
    expect(rounds).toContain("flTimeCap");
    // A mode without a block of its own lists the core settings and what the request points at, as before.
    expect(relevantAssistantSettings(defaultSettings("classic"), "longer rounds").map(([k]) => k).every((k) => !k.startsWith("fl"))).toBe(true);
  });

  it("fits every mode's block with the core settings, and the settings a request points at never give way to it", () => {
    for (const mode of MODE_IDS) {
      const block = blockOf(mode);
      const keys = relevantAssistantSettings(defaultSettings(mode), "").map(([k]) => k);
      expect(keys, mode).toEqual(expect.arrayContaining([...CORE_SETTING_KEYS, ...block]));
      expect(keys.length, mode).toBeLessThanOrEqual(MAX_RELEVANT_SETTINGS);
    }
    // A request that points at many settings on the page with the biggest block (Bouncing Orbs, 34): the cap holds, and
    // what it points at outside the block is all there – the block's settings it does not point at give way first.
    const busy = "faster and bigger, rainbow colours, wind and drag, thicker trails, glow, a piano melody, camera shake, a face and a name, bigger text, thicker rings that rotate and pulse";
    const orbs = relevantAssistantSettings(defaultSettings("orbGrid"), busy).map(([k]) => k);
    expect(blockOf("orbGrid").length).toBe(34);
    expect(orbs.length).toBe(MAX_RELEVANT_SETTINGS);
    for (const [key] of relevantAssistantSettings(defaultSettings("classic"), busy)) expect(orbs).toContain(key);
    expect(orbs).toContain("ogOrbSize"); // a block setting the request points at ("bigger") stays
    expect(blockOf("orbGrid").some((k) => !orbs.includes(k))).toBe(true);
  });

  it("builds a much shorter prompt and a grammar over the same settings", () => {
    const task = settingsTask("make the ball twice as fast and rainbow, no gravity", current, "en");
    expect(task.system.length).toBeLessThan(settingsCatalog(current).length);
    expect(task.name).toBe("settings");
    const alternatives = (task.final.properties?.changes as { items: { oneOf: unknown[] } }).items.oneOf;
    expect(alternatives.length).toBe(relevantAssistantSettings(current, "make the ball twice as fast and rainbow, no gravity").length);
  });
});

describe("errors the panel shows", () => {
  it("strips Electron's IPC prefix wherever it sits", () => {
    // 1.0.2's panel: runAgent's "model: " came first, so the ^-anchored cleanup missed it.
    expect(stripIpcPrefix("model: Error invoking remote method 'ai:chat': TypeError: fetch failed")).toBe("model: fetch failed");
    expect(stripIpcPrefix("Error invoking remote method 'ai:chat': Error: The cloud provider answered HTTP 401: bad key")).toBe("The cloud provider answered HTTP 401: bad key");
    expect(aiErrorText(new Error("model: Error invoking remote method 'ai:chat': Error: No local model yet"))).toBe("model: No local model yet");
    expect(errorText(new Error("Error invoking remote method 'prefs:set': Error: nope"))).toBe("nope");
  });

  it("explains the cause codes of a failed request", () => {
    const tls = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("self-signed certificate in certificate chain"), { code: "SELF_SIGNED_CERT_IN_CHAIN" }) });
    expect(describeError(tls)).toMatch(/^fetch failed \(SELF_SIGNED_CERT_IN_CHAIN: the TLS certificate is not trusted – an antivirus HTTPS scan or a proxy/);
    const refused = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:5612"), { code: "ECONNREFUSED" }) });
    expect(describeError(refused)).toBe("fetch failed (ECONNREFUSED: nothing answers at that address (is the server running?))");
    expect(describeError(new Error("net::ERR_CERT_AUTHORITY_INVALID"))).toBe("net::ERR_CERT_AUTHORITY_INVALID (the TLS certificate is not trusted – an antivirus HTTPS scan or a proxy is intercepting the connection)");
    expect(errorCodes(refused)).toEqual(["ECONNREFUSED"]);
    expect(describeError(new Error("Checksum mismatch"))).toBe("Checksum mismatch");
    expect(errorChain(refused)).toMatch(/TypeError: fetch failed.*caused by: Error \[ECONNREFUSED\]: connect ECONNREFUSED/);
  });

  it("folds the app's notes into user turns for every transport", () => {
    const messages: AiMessage[] = [
      { role: "system", content: "rules" },
      { role: "user", content: "go" },
      { role: "assistant", content: "bad" },
      { role: "system", content: "Your reply was not valid" },
    ];
    expect(foldSystemNotes(messages)).toEqual([
      { role: "system", content: "rules" },
      { role: "user", content: "go" },
      { role: "assistant", content: "bad" },
      { role: "user", content: "Your reply was not valid" },
    ]);
    expect(foldSystemNotes([{ role: "user", content: "a" }, { role: "system", content: "b" }])).toEqual([{ role: "user", content: "a\n\nb" }]);
  });

  it("checks the diagnose and chat arguments", () => {
    expect(checkIpcArgs(IPC.aiDiagnose, [])).toBeNull();
    expect(checkIpcArgs(IPC.aiDiagnose, [{ deep: true }])).toBeNull();
    expect(checkIpcArgs(IPC.aiDiagnose, [{ deep: "yes" }])).toMatch(/diagnose/);
    expect(checkIpcArgs(IPC.aiDiagnose, ["x"])).toMatch(/diagnose/);
    expect(checkIpcArgs(IPC.aiChat, [{ requestId: "r", messages: [{ role: "user", content: "x" }], task: "copy" }])).toBeNull();
    expect(checkIpcArgs(IPC.aiChat, [{ requestId: "r", messages: [{ role: "user", content: "x" }], task: 7 }])).toMatch(/task/);
  });
});

describe("the first-run card", () => {
  const model = (patch: Record<string, unknown>) => ({ id: "llama-3.2-3b-instruct-q4km", name: "Llama", size: 2_019_377_696, sha256: "x", licence: "l", licenceUrl: "", url: "u", state: "missing", downloaded: 0, path: null, custom: false, selected: true, ...patch }) as never;
  const status = (hasKey: boolean) => ({ provider: "local", ready: false, local: { model: null, loaded: false, backend: null, gpuLayers: null, error: null }, cloud: { provider: "anthropic", baseUrl: "", model: "", hasKey, encryption: true } }) as never;
  it("shows while nothing can answer, and offers the selected catalog model", () => {
    expect(needsSetup({ models: [model({})], progress: {}, status: status(false) })).toBe(true);
    expect(needsSetup({ models: [model({ state: "ready" })], progress: {}, status: status(false) })).toBe(false);
    expect(needsSetup({ models: [model({})], progress: {}, status: status(true) })).toBe(false);
    expect(needsSetup({ models: [model({})], progress: { "llama-3.2-3b-instruct-q4km": { id: "llama-3.2-3b-instruct-q4km", downloaded: 1, size: 2, bytesPerSec: 1, state: "downloading" } }, status: status(false) })).toBe(false);
    expect(setupModel([model({ id: "custom:x.gguf", custom: true }), model({ selected: false, id: "qwen" })])?.id).toBe("qwen");
  });
});

type Tree = { [k: string]: string | Tree };
function flat(o: Tree, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));
}

describe("DesktopAiFix messages and the version", () => {
  const keys = (m: unknown) => flat((m as { DesktopAiFix: Tree }).DesktopAiFix).sort();
  it("has the same keys in English, Polish and Spanish, and every key the new parts use", () => {
    expect(keys(pl)).toEqual(keys(en));
    expect(keys(es)).toEqual(keys(en));
    const root = path.join(__dirname, "..", "src");
    const all = new Set(keys(en));
    const used = new Set<string>();
    for (const file of ["components/simulator/desktop/AiStatusPanel.tsx", "components/simulator/desktop/AiSetupCard.tsx", "components/simulator/desktop/AiPanel.tsx", "app/[locale]/download/page.tsx"]) {
      for (const m of fs.readFileSync(path.join(root, file), "utf8").matchAll(/\b(?:tx|fix)\("([A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    }
    expect(used.size).toBeGreaterThan(20);
    expect([...used].filter((k) => !all.has(k))).toEqual([]);
    // Built at run time: a row, a level and a reason per check code the app sends.
    const diagnostics = fs.readFileSync(path.join(__dirname, "..", "desktop", "src", "ai", "diagnostics.ts"), "utf8");
    const codes = new Set([...diagnostics.matchAll(/check\("\w+", (?:"\w+"|[^,]+), "(\w+)"/g)].map((m) => m[1]));
    for (const m of diagnostics.matchAll(/\? "(\w+)" : "(\w+)"/g)) {
      if (!/^(runtime|model|provider|network|lastError)/.test(m[1])) continue;
      codes.add(m[1]);
      codes.add(m[2]);
    }
    expect(codes.size).toBeGreaterThan(20);
    for (const code of codes) expect(all.has(`check.${code}`), code).toBe(true);
    for (const id of ["runtime", "model", "provider", "network", "lastError"]) expect(all.has(`row.${id}`)).toBe(true);
    for (const level of ["ok", "warn", "fail", "skip"]) expect(all.has(`level.${level}`)).toBe(true);
  });

  it("shows the app's own version on the download page (desktop/package.json and its lock)", () => {
    const desktop = path.join(__dirname, "..", "desktop");
    const pkg = JSON.parse(fs.readFileSync(path.join(desktop, "package.json"), "utf8")) as { version: string };
    const lock = JSON.parse(fs.readFileSync(path.join(desktop, "package-lock.json"), "utf8")) as { version: string; packages: Record<string, { version?: string }> };
    expect(DESKTOP_VERSION).toBe("1.0.3");
    expect(pkg.version).toBe(DESKTOP_VERSION);
    expect(lock.version).toBe(DESKTOP_VERSION);
    expect(lock.packages[""].version).toBe(DESKTOP_VERSION);
  });
});
