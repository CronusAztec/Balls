import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { TRENDS } from "@/content/trends";
import type { TrendSummary } from "@/lib/trends";
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
    const tiny: TrendSummary = { ...t, recommendations: [{ area: "length", advice: "Render 12 s clips.", basis: "pattern", levers: [{ kind: "setting", name: "recordingDuration", link: "dur", value: 12 }, { kind: "tool", name: "simulate" }] }], themes: [], formats: [], words: [{ word: "youtubeshorts", videos: 3 }, { word: "glass", videos: 2 }], numbers: [] };
    expect(trendingContext(tiny, 1000).split("\n").slice(1)).toEqual(["- Render 12 s clips. (recordingDuration 12)", "- Words of the most viewed titles: glass."]);
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
    const block = trendingContext(t, TRENDING_CHARS.videos);
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
    expect(hook).toContain("trending: trendingContext(TRENDS, TRENDING_CHARS.videos)");
    expect(hook).toContain("selectPlaybookContext(playbookRef.current, prompt, IDEAS_RESEARCH_CHARS - trending.length)");
  });
});
