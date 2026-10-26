import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { TRENDS } from "@/content/trends";
import type { TrendAdvice, TrendNumber, TrendSummary } from "@/lib/trends";
import { TRENDING_CHARS, selectPlaybookContext, trendingContext } from "@/lib/desktop/ai/playbookContext";
import { planTask, type PlanOptions } from "@/lib/desktop/ai/plan";
import { PLAN_RESEARCH_CHARS, runPlanner } from "@/lib/desktop/ai/planRun";
import { IDEAS_RESEARCH_CHARS, PlanStore, ideasTask, makeVideosTask, type StudioPorts } from "@/lib/desktop/ai/studio";
import type { ChatModel } from "@/lib/desktop/ai/agent";
import type { SocialBridge } from "@/lib/desktop/capabilities";
import { DEFAULT_AUTOPILOT, type PlanClip } from "@/lib/desktop/autopilot";
import type { AiMessage, LibraryItem, PostizChannel } from "@/lib/desktop/contract";
import type { BotCopy } from "@/lib/bot/copy";
import en from "../messages/en.json";

// --- trends --- The "What is trending" block the app's AI reads from the committed trend summary (src/content/trends.json,
// lib/desktop/ai/playbookContext.ts trendingContext) next to the virality playbook: in the post planner, Make videos and the
// idea generator, within the prompt budgets those jobs already had. The summary itself: tests/trends.test.ts.

const ROOT = path.resolve(__dirname, "..");
const NOW = Date.UTC(2026, 9, 26);
const PLAYBOOK = fs.readFileSync(path.join(ROOT, "docs", "virality-playbook.md"), "utf8");
const copy = (en as unknown as { ViralBot: BotCopy }).ViralBot;

describe("what is trending in the app's AI prompts (--- trends ---)", () => {
  const t = TRENDS as TrendSummary;
  it("writes a short block within each job's budget, its advice in our levers, and quotes no title", () => {
    expect(trendingContext(null, 900)).toBe("");
    expect(trendingContext(t, 0)).toBe("");
    expect(trendingContext(t, 40)).toBe(""); // not even the heading fits
    for (const [job, budget] of Object.entries(TRENDING_CHARS)) {
      const block = trendingContext(t, budget);
      expect(block.length, job).toBeLessThanOrEqual(budget);
      expect(block, job).toMatch(new RegExp(`^What is trending \\(${t.date}, ${t.sample.compared} short-form simulation videos`));
      expect(block.split("\n").slice(1).every((l) => l.startsWith("- ")), job).toBe(true);
      expect(block.split("\n").length, job).toBeGreaterThan(2);
      for (const e of t.examples) if (e.title && e.title.length > 20) expect(block, job).not.toContain(e.title);
    }
    const clips = trendingContext(t, 5000);
    for (const th of t.themes.filter((x) => x.advised).slice(0, 4)) expect(clips).toContain(th.label);
    for (const th of t.themes.filter((x) => !x.advised)) expect(clips).not.toMatch(new RegExp(`${th.label} ×`));
    const length = t.recommendations.find((r) => r.area === "length");
    if (length) expect(clips).toContain(`${length.advice} (recordingDuration ${length.levers[0].value})`);
    // the planner's copy focus puts the title formats and words first
    const copy = trendingContext(t, TRENDING_CHARS.plan, "copy").split("\n");
    expect(copy[1]).toMatch(/^- Title formats: /);
    // a small synthetic summary: every line it has, in the clips order
    const tiny: TrendSummary = { ...t, recommendations: [{ area: "length", advice: "Render 12 s clips.", basis: "pattern", levers: [{ kind: "setting", name: "recordingDuration", link: "dur", value: 12 }, { kind: "tool", name: "simulate" }], traits: ["durationSec"] }], themes: [], formats: [], words: [{ word: "youtubeshorts", videos: 3 }, { word: "glass", videos: 2 }], numbers: [] };
    expect(trendingContext(tiny, 1000).split("\n").slice(1)).toEqual(["- Render 12 s clips. (recordingDuration 12) [pattern]", "- Words of the most viewed titles: glass."]); // --- trends --- (a pattern whose number the summary lacks still says it is one)
  });

  it("goes into the planner beside the playbook, within the 3,000 characters the planner's research had", async () => {
    const block = trendingContext(t, TRENDING_CHARS.plan, "copy");
    expect(block.length).toBeGreaterThan(0);
    const playbook = selectPlaybookContext(PLAYBOOK, "best time to post schedule tiktok Glass smash", PLAN_RESEARCH_CHARS - block.length);
    expect(PLAN_RESEARCH_CHARS).toBe(3000);
    expect(playbook.length + block.length).toBeLessThanOrEqual(3200); // (the existing playbook test's slack for headings)
    const clips: PlanClip[] = [{ id: "clip-1", title: "Glass smash", platform: "tiktok", durationSec: 12, createdAt: "2026-10-18T10:00:00.000Z", caption: null, hashtags: [] }];
    const channels = [{ id: "int-tt", platform: "tiktok", name: "Gerald on TikTok" }];
    const options: PlanOptions = { locale: "en", language: "en", clips, channels, perDay: 1, quietFrom: "22:00", quietTo: "08:00", now: NOW, playbook, outcomes: [] };
    const without = planTask(options).system;
    const withTrends = planTask({ ...options, trending: block }).system;
    expect(withTrends).toBe(`${without}\n${block}`);
    expect(planTask({ ...options, trending: "" }).system).toBe(without);
    // runPlanner reads the committed summary by default, and none when told so
    const library: LibraryItem[] = [{ id: "clip-1", path: "C:/glass.mp4", fileName: "glass.mp4", bytes: 1, durationSec: 12, width: 1080, height: 1920, createdAt: NOW - 1000, thumbnail: null, exists: true, encoder: null, meta: { title: "Glass smash", mode: "glass", seed: 1, link: "", platform: "tiktok", hook: null, caption: "Which floor breaks first?", hashtags: ["#glass"], queueJobId: null } }];
    const postiz: PostizChannel[] = [{ id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: null, disabled: false, customer: null }];
    const bridge = {
      library: { list: async () => library },
      ai: { playbook: async () => PLAYBOOK },
      social: { autopilot: { get: async () => ({ ...DEFAULT_AUTOPILOT, enabled: true, channels: ["int-tt"] }) }, queue: { list: async () => [] }, audit: async () => [], channels: { list: async () => postiz }, posts: async () => [] },
    } as unknown as Pick<SocialBridge, "library" | "social" | "ai">;
    const seen: AiMessage[][] = [];
    const model: ChatModel = {
      async complete(messages) {
        seen.push(messages);
        return JSON.stringify({ action: "final", result: { proposals: [{ clipId: "clip-1", channels: [{ integrationId: "int-tt", text: "Which floor breaks first?", hashtags: ["#glass"] }], when: "now", reason: "r" }] } });
      },
    };
    const midday = new Date(NOW);
    midday.setHours(12, 0, 0, 0);
    await runPlanner(bridge, model, { locale: "en", playbook: PLAYBOOK, now: midday.getTime(), ignoreBudget: true });
    expect(seen[0][0].content).toContain("What is trending (");
    await runPlanner(bridge, model, { locale: "en", playbook: PLAYBOOK, now: midday.getTime(), ignoreBudget: true, trends: null });
    expect(seen[1][0].content).not.toContain("What is trending (");
  });

  it("goes into Make videos and the idea generator: about 200 tokens more for one, the same 4,500 characters for the other", () => {
    const ports: StudioPorts = { planClips: async () => [], findSimulation: async () => ({ found: false, seed: 0, durationSec: 0 }) };
    const block = trendingContext(t, TRENDING_CHARS.videos, "videos"); // --- trends --- (as the page hands it to Make videos)
    const plain = makeVideosTask("three clips", { copy, locale: "en", platform: "tiktok", store: new PlanStore(), ports });
    const trending = makeVideosTask("three clips", { copy, locale: "en", platform: "tiktok", store: new PlanStore(), ports, trending: block });
    expect(trending.system.startsWith(plain.system)).toBe(true);
    expect(trending.system).toContain(block);
    expect(trending.system).toMatch(/When the user names no recipe, length or look, lean toward what is trending:/);
    const added = trending.system.length - plain.system.length;
    expect(added).toBeLessThanOrEqual(TRENDING_CHARS.videos + 100);
    expect(Math.ceil(added / 3.2)).toBeLessThanOrEqual(250); // desktop/src/ai/local.ts's estimate: ~3.2 characters a token
    expect(trending.maxTokens).toBe(plain.maxTokens); // the answer's budget is untouched
    // the ideas: the playbook's share shrinks by the block, so the research stays 4,500 characters
    const ideasBlock = trendingContext(t, TRENDING_CHARS.ideas);
    const context = selectPlaybookContext(PLAYBOOK, "fresh escape ideas", IDEAS_RESEARCH_CHARS - ideasBlock.length);
    expect(IDEAS_RESEARCH_CHARS).toBe(4500);
    expect(context.length + ideasBlock.length).toBeLessThanOrEqual(IDEAS_RESEARCH_CHARS + 200);
    const ideas = ideasTask("fresh escape ideas", { copy, locale: "en", playbook: context, trending: ideasBlock });
    expect(ideas.system.endsWith(`${context}\n${ideasBlock}`)).toBe(true);
    expect(ideasTask("x", { copy, locale: "en", playbook: context }).system).not.toContain("What is trending");
    // the page hands the committed summary to both, and the planner's research budget to the playbook's rest
    const hook = fs.readFileSync(path.join(ROOT, "src", "components", "simulator", "desktop", "useDesktopAi.ts"), "utf8");
    expect(hook).toContain('trending: trendingContext(await committedTrends(), TRENDING_CHARS.videos, "videos")'); // --- trends --- (Make videos: no benchmark-only advice)
    expect(hook).not.toMatch(/from "@\/content\/trends"/); // the website's page never carries the summary: it loads on first use
    expect(hook).toContain("selectPlaybookContext(playbookRef.current, prompt, IDEAS_RESEARCH_CHARS - trending.length)");
  });

  // --- trends --- what an advice rests on, beside it: a hunch never reads as an instruction (the findings of 26 October:
  // "Render 11 s clips" was a benchmark with ρ -0.06, the calm look 15 stills, and the planner read formats the most viewed
  // avoid as trends)
  const num = (trait: string, o: Partial<TrendNumber>): TrendNumber => ({ trait, label: trait, unit: "", top: 1, rest: 1, all: 1, rho: 0, p: 1, n: 39, from: { video: 0, stills: 0, page: 39 }, strength: null, scope: "list", agreement: { same: 0, opposite: 0 }, tops: [], split: false, ...o });
  const advice = (o: Partial<TrendAdvice>): TrendAdvice => ({ area: "length", advice: "Render 12 s clips.", basis: "pattern", levers: [{ kind: "setting", name: "recordingDuration", link: "dur", value: 12 }], traits: ["durationSec"], ...o });
  const synthetic: TrendSummary = {
    ...t,
    sample: { ...t.sample, compared: 40, measured: 8, stills: 30 },
    numbers: [num("durationSec", { rho: -0.71, p: 0.003, n: 15, strength: "clear", from: { video: 8, stills: 0, page: 7 } }), num("darkShare", { rho: -0.06, p: 0.71, from: { video: 8, stills: 30, page: 0 }, n: 38 }), num("meanSat", { top: 0.3, rest: 0.5, rho: -0.2, p: 0.4, n: 38, from: { video: 8, stills: 30, page: 0 } })],
    recommendations: [
      advice({}),
      advice({ area: "look", advice: "Use a light or mid background.", basis: "benchmark", levers: [{ kind: "setting", name: "backgroundType", link: "bgt", value: "gradient" }, { kind: "setting", name: "backgroundColors", link: "bg1", value: ["#a7b0c0", "#6b7486"] }], traits: ["darkShare"] }),
      advice({ area: "look", advice: "Use saturated colours.", basis: "pattern", levers: [{ kind: "setting", name: "showTrails", link: "trails", value: true }, { kind: "setting", name: "trailColors", link: "trc", value: [] }], traits: ["meanSat"] }),
      advice({ area: "title", advice: "Ask a question.", basis: "pattern", levers: [{ kind: "setting", name: "captions", link: "cap", value: "question at 0 s" }], traits: [] }),
    ],
    themes: [],
    formats: [
      { id: "versus", label: "a versus", top: 0.15, rest: 0.35, all: 0.28 },
      { id: "series", label: "a numbered series", top: 0.23, rest: 0.08, all: 0.13 },
      { id: "bigNumber", label: "a count", top: 0, rest: 0.04, all: 0.03 },
    ],
    titles: { n: 39, top: 13 },
    words: [{ word: "satisfying", videos: 8 }, { word: "3danimation", videos: 5 }, { word: "3d", videos: 5 }, { word: "blender", videos: 2 }, { word: "glass", videos: 2 }],
  };

  it("tags each advice with what it rests on, and puts the measured and stills counts in the heading", () => {
    const lines = trendingContext(synthetic, 5000).split("\n");
    expect(lines[0]).toMatch(/^What is trending \(\d{4}-\d\d-\d\d, 40 short-form simulation videos .*: 8 measured whole, 30 seen only through their stills, 2 from their pages; tendencies to test, not rules\):$/);
    expect(lines).toContain("- Render 12 s clips. (recordingDuration 12) [pattern (clear) rho -0.71, n 15, p 0.003; 8 measured whole, 7 from pages]");
    expect(lines).toContain("- Use a light or mid background. (backgroundType gradient, backgroundColors [#a7b0c0, #6b7486]) [benchmark: does not separate the most viewed; n 38, 8 measured whole, 30 from stills]");
    expect(lines).toContain("- Use saturated colours. (showTrails true, trailColors [] (the rainbow)) [pattern rho -0.2, n 38, p 0.4; 8 measured whole, 30 from stills]");
    // a title pattern says its sample; captions are no setting a patch sets (the clip's hook carries the question)
    expect(lines).toContain("- Ask a question. [pattern in titles: the most viewed third, n 13 of 39]");
    // the benchmark comes after the patterns, the themes and the formats
    const at = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
    expect(at("- Use a light")).toBeGreaterThan(at("- Title formats"));
    expect(at("- Title formats")).toBeGreaterThan(at("- Ask a question"));
    // Make videos, told to lean toward the block, gets no benchmark-only advice
    const videos = trendingContext(synthetic, 5000, "videos");
    expect(videos).toContain("- Render 12 s clips.");
    expect(videos).not.toContain("[benchmark");
    expect(videos).not.toContain("Use a light or mid background");
    // the committed summary: every advice line tagged
    for (const line of trendingContext(t, 5000).split("\n").filter((l) => /^- (Render|Use|Keep|Portrait|Move|Set|Count|Ask|Put|One|The most viewed (build|cut|loop|are mixed))/.test(l))) expect(line, line).toMatch(/ \[(pattern|benchmark|gap)[^\]]*\]$/);
  });

  it("gives the planner the title formats and words alone: the formats the most viewed use less are marked, other genres' tags left out", () => {
    const copy = trendingContext(synthetic, 5000, "copy").split("\n").slice(1);
    expect(copy).toEqual([
      "- Title formats: more among the most viewed third (13 of 39 titles) against the rest: a numbered series 23% against 8%; less among them, so no trend to copy: a versus 15% against 35%.",
      "- Words of the most viewed titles: satisfying, glass.",
    ]);
    // the committed summary: no advice, theme or look line for the planner, and no 3D-render tag
    const committed = trendingContext(t, 5000, "copy");
    expect(committed).not.toMatch(/^- (Render|Use|Keep|Portrait|Themes|The most viewed look)/m);
    expect(committed).not.toMatch(/\b(3d|3danimation|blender|beamng|roblox)\b/);
    for (const f of t.formats.filter((x) => x.all !== null && x.all >= 0.1 && x.top !== null && x.rest !== null && x.top < x.rest)) expect(committed.split("less among them")[1] ?? "", f.id).toContain(f.label);
    expect(committed).toContain(`(${t.titles.top} of ${t.titles.n} titles)`);
    // none more common among the most viewed: said so
    const none = trendingContext({ ...synthetic, formats: [synthetic.formats[0]] }, 5000, "copy");
    expect(none).toContain("- Title formats: none more common among the most viewed third (13 of 39 titles) against the rest; less among them, so no trend to copy: a versus 15% against 35%.");
  });

  it("never picks the playbook's own trend section: its numbers are frozen, the block reads them fresh", () => {
    for (const query of ["escape ring ideas with a trending look and title", "What is trending right now?", "how to refresh the trend data trendingContext npm run trends"]) {
      const picked = selectPlaybookContext(PLAYBOOK, query, 4500);
      expect(picked, query).not.toMatch(/^## 6\./m);
      expect(picked, query).not.toMatch(/What the October 2026 runs found|trendingContext/);
    }
    expect(PLAYBOOK).toMatch(/^## 6\. What is trending/m); // (the section is still there, for people)
  });
});
