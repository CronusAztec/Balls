import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { BRIDGE_METHODS, EVENT_CHANNELS, IPC, checkIpcArgs, checkSocialProposals, type AiMessage, type AutopilotSettings, type DesktopApi, type LibraryItem, type PostizChannel, type SocialAuditEntry, type SocialQueueItem } from "@/lib/desktop/contract";
import { DEFAULT_AUTOPILOT, inQuietHours, inQuietMinutes, nextAllowedTime, planRefusal, proposalsLeftToday, proposalsToday, sanitizeAutopilot, shouldPlanNow, toQueueProposals, unpostedClips, type PlanClip } from "@/lib/desktop/autopilot";
import { validateJson } from "@/lib/desktop/ai/jsonSchema";
import { runAgent, type ChatModel } from "@/lib/desktop/ai/agent";
import { checkPlanResult, normalisePlanResult, planFinal, planTask, whenProblem, type PlanOptions, type PlanResult } from "@/lib/desktop/ai/plan";
import { runPlanner } from "@/lib/desktop/ai/planRun";
import { AI_TASKS } from "@/components/simulator/desktop/useDesktopAi";
import { AutopilotView, ProposedView, prefillOfProposal, proposedItems } from "@/components/simulator/desktop/PostsPanel";
import { PostizPostCardView, initialCardState, prefilledSettings, prefilledWhen, type PostCardState } from "@/components/simulator/desktop/PostizPostCard";
import { cardChannelOf, cardProblems, isoToLocal, toRequest, type CardChannel, type TikTokSettings, type YouTubeSettings } from "@/lib/desktop/socialCard";

/*
 * --- social-autopilot --- Phases 3–4 on the page (docs/SOCIAL-AUTOPILOT.md): the "plan" AI task (its schema and checks, a
 * scripted model whose proposals pass and become queue proposals), the trigger's rule `shouldPlanNow`, the quiet hours, the
 * Posts tab's Proposed group and Autopilot card in three languages, "Review and approve" opening the card prefilled (the
 * user still chooses TikTok's settings there), the bridge's new methods and the strings.
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

type Messages = typeof en;
const LOCALES: Record<string, Messages> = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };
const attr = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";
/** Whether a rendered tag carries the `disabled` attribute (its class list says "disabled:opacity-40" either way). */
const disabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag);
const withIntl = (node: React.ReactElement, locale = "en") => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, node));

/** A model that replies from a script. */
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

// a Monday at 12:00 local time (the planner reasons in this PC's time zone; the fixtures are built the same way)
const NOW = new Date(2026, 9, 19, 12, 0, 0, 0).getTime();
const local = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo, d, h, mi).getTime();
const iso = (ms: number) => new Date(ms).toISOString();

const channels: PostizChannel[] = [
  { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: null, disabled: false, customer: null },
  { id: "int-yt", name: "Gerald Shorts", platform: "youtube", picture: null, disabled: false, customer: null },
  { id: "int-ig", name: "gerald.reels", platform: "instagram-standalone", picture: null, disabled: true, customer: null },
];
const clips: PlanClip[] = [
  { id: "clip-1", title: "Glass smash", caption: "Which floor breaks first?", hashtags: ["#glass", "#asmr"], platform: "tiktok", durationSec: 12, createdAt: "2026-10-18T10:00:00.000Z" },
  { id: "clip-2", title: "Maze run", caption: null, hashtags: [], platform: "shorts", durationSec: 30, createdAt: "2026-10-17T10:00:00.000Z" },
];
const options: PlanOptions = { locale: "en", language: "en", clips, channels: channels.slice(0, 2), perDay: 2, quietFrom: "22:00", quietTo: "08:00", now: NOW, playbook: "## 3. The recipe the bot follows\nPost in the evening.", outcomes: [{ channelId: "int-tt", platform: "tiktok", state: "PUBLISHED", at: iso(NOW - 86_400_000), text: "Yesterday's post" }] };
const good: PlanResult = {
  proposals: [
    { clipId: "clip-1", channels: [{ integrationId: "int-tt", text: "Which floor breaks first?", hashtags: ["#glass", "#satisfying"] }, { integrationId: "int-yt", text: "Gerald drops through glass floors.", title: "Glass smash", hashtags: ["#Shorts"] }], when: iso(local(2026, 9, 19, 18, 30)), reason: "Evening posts did well last week." },
    { clipId: "clip-2", channels: [{ integrationId: "int-tt", text: "Will he find the exit?", hashtags: ["#maze"] }], when: "now", reason: "A second clip keeps the day's rhythm." },
  ],
};

describe("the plan task", () => {
  it("holds the answer to a schema: clip and channel ids as enums, at most perDay proposals, bounded texts", () => {
    const schema = planFinal(["clip-1", "clip-2"], ["int-tt", "int-yt"], 2);
    expect(validateJson(schema, good)).toEqual([]);
    const errors = validateJson(schema, { proposals: [{ clipId: "clip-9", channels: [{ integrationId: "int-x", text: "", settings: { privacy_level: "SELF_ONLY" } }], when: "tomorrow", reason: "" }] });
    expect(errors.join("\n")).toMatch(/clipId: must be one of/);
    expect(errors.join("\n")).toMatch(/integrationId: must be one of/);
    expect(errors.join("\n")).toMatch(/unknown field "settings"/);
    expect(errors.join("\n")).toMatch(/when: must match/);
    expect(validateJson(schema, { proposals: [good.proposals[0], good.proposals[1], good.proposals[0]] }).join("\n")).toMatch(/at most 2 items/);
    expect((planFinal(["clip-1"], ["int-tt"], 5).properties!.proposals as { maxItems: number }).maxItems).toBe(1); // never more than there are clips
    const task = planTask(options);
    expect(task).toMatchObject({ name: "plan", temperature: 0.6, maxTokens: 1500, maxSteps: 4, tools: [] });
    expect(task.system).toContain("You only propose");
    expect(task.system).toContain("Never write those");
    expect(task.system).toContain("- int-tt, tiktok, Gerald on TikTok");
    expect(task.system).toContain('id clip-1, "Glass smash", made for tiktok, 12 s, made 2026-10-18, caption: Which floor breaks first?, hashtags: #glass #asmr');
    expect(task.system).toContain("Quiet hours 22:00–08:00 local");
    expect(task.system).toContain("PUBLISHED");
    expect(task.system).toContain("Post in the evening.");
    expect(task.system).toMatch(/TikTok: punchy caption/);
    expect(task.system).toMatch(/YouTube Shorts: a searchable title/);
    expect(task.system).toContain("Write the texts in English");
    expect(planTask({ ...options, language: "pl" }).system).toContain("Write the texts in Polish");
  });

  it("checkFinal rejects unknown ids, a clip twice, TikTok's privacy or interaction settings, quiet hours, the past, beyond 48 h, too many, a long text and a YouTube post without a title", () => {
    expect(checkPlanResult(good, options)).toEqual([]);
    const one = (p: Partial<PlanResult["proposals"][number]>) => checkPlanResult({ proposals: [{ ...good.proposals[1], ...p }] }, options);
    expect(one({ clipId: "clip-9" }).join("\n")).toMatch(/unknown clipId "clip-9"/);
    expect(one({ channels: [{ integrationId: "int-ig", text: "x" }] }).join("\n")).toMatch(/unknown integrationId "int-ig"/); // the disabled channel is not offered
    expect(checkPlanResult({ proposals: [good.proposals[1], good.proposals[1]] }, options).join("\n")).toMatch(/proposed twice/);
    expect(checkPlanResult({ proposals: [good.proposals[0], good.proposals[1]] }, { ...options, perDay: 1 }).join("\n")).toMatch(/at most 1 proposal/);
    expect(one({ channels: [{ integrationId: "int-tt", text: "x", settings: { privacy_level: "PUBLIC_TO_EVERYONE", comment: true } } as never] }).join("\n")).toMatch(/never propose TikTok's privacy_level, comment/);
    expect(one({ channels: [{ integrationId: "int-tt", text: "x", settings: { title: "t" } } as never] }).join("\n")).toMatch(/do not add settings/);
    expect(one({ when: iso(local(2026, 9, 19, 23, 0)) }).join("\n")).toMatch(/quiet hours 22:00–08:00/);
    expect(one({ when: iso(local(2026, 9, 20, 7, 59)) }).join("\n")).toMatch(/quiet hours/);
    expect(one({ when: iso(local(2026, 9, 20, 8, 0)) })).toEqual([]);
    expect(one({ when: iso(NOW - 60_000) }).join("\n")).toMatch(/in the past/);
    expect(one({ when: iso(NOW + 49 * 3_600_000) }).join("\n")).toMatch(/more than 48 hours/);
    expect(one({ when: "2026-13-45T18:00:00Z" }).join("\n")).toMatch(/not an ISO time/);
    expect(one({ channels: [{ integrationId: "int-tt", text: "x".repeat(2201) }] }).join("\n")).toMatch(/over 2200 characters/);
    expect(one({ channels: [{ integrationId: "int-yt", text: "desc" }] }).join("\n")).toMatch(/YouTube channel "int-yt" needs a title/);
    expect(one({ channels: [{ integrationId: "int-yt", text: "desc", title: "a<b>" }] }).join("\n")).toMatch(/without < or >/);
    expect(one({ channels: [{ integrationId: "int-tt", text: "x" }, { integrationId: "int-tt", text: "y" }] }).join("\n")).toMatch(/listed twice/);
    // "now" inside the quiet hours is refused too
    expect(whenProblem("now", { ...options, now: local(2026, 9, 19, 23, 0) })).toMatch(/"now" falls in the quiet hours/);
    expect(whenProblem("now", options)).toBeNull();
  });

  it("normalises obvious slips: hashtags without #, 'Now', trimmed and cut texts", () => {
    const out = normalisePlanResult({ proposals: [{ clipId: "clip-1", channels: [{ integrationId: "int-tt", text: "  hi  ", hashtags: ["glass", "#ok", "two words"], title: " T " }], when: " Now ", reason: "r".repeat(300) }] }) as PlanResult;
    expect(out.proposals[0].when).toBe("now");
    expect(out.proposals[0].channels[0]).toEqual({ integrationId: "int-tt", text: "hi", hashtags: ["#glass", "#ok", "#two", "#words"], title: "T" });
    expect(out.proposals[0].reason).toHaveLength(200);
    expect(normalisePlanResult("x")).toBe("x");
  });

  it("runs on a scripted model: an answer in the quiet hours is sent back, the next one passes and becomes queue proposals without TikTok's choices", async () => {
    const late = { proposals: [{ ...good.proposals[1], when: iso(local(2026, 9, 19, 23, 30)) }] };
    const model = scripted([JSON.stringify({ action: "final", result: late }), JSON.stringify({ action: "final", result: good })]);
    const out = await runAgent(model, planTask(options));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.retries).toBe(1);
    expect(model.calls[1].at(-1)?.content).toMatch(/quiet hours 22:00–08:00/);
    expect(out.result).toEqual(good);
    const proposals = toQueueProposals(out.result.proposals, channels);
    expect(proposals).toEqual([
      {
        clipId: "clip-1",
        channels: [
          { integrationId: "int-tt", platform: "tiktok", text: "Which floor breaks first?\n\n#glass #satisfying", settings: { __type: "tiktok" } },
          { integrationId: "int-yt", platform: "youtube", text: "Gerald drops through glass floors.\n\n#Shorts", settings: { __type: "youtube", title: "Glass smash" } },
        ],
        when: iso(local(2026, 9, 19, 18, 30)),
        reason: "Evening posts did well last week.",
      },
      { clipId: "clip-2", channels: [{ integrationId: "int-tt", platform: "tiktok", text: "Will he find the exit?\n\n#maze", settings: { __type: "tiktok" } }], when: "now", reason: "A second clip keeps the day's rhythm." },
    ]);
    // what the bridge's check would say of them (the clock there is the real one: a far time stands in)
    expect(checkSocialProposals(proposals.map((p) => ({ ...p, when: p.when === "now" ? "now" : "2099-01-01T10:00:00.000Z" })), "ai")).toBeNull();
    // a channel the planner no longer has is dropped, a proposal without channels too
    expect(toQueueProposals([{ clipId: "c", channels: [{ integrationId: "gone", text: "x" }], when: "now", reason: "r" }], channels)).toEqual([]);
    // a hashtag already in the text is not repeated
    expect(toQueueProposals([{ clipId: "c", channels: [{ integrationId: "int-tt", text: "Hi #glass", hashtags: ["#glass", "#new"] }], when: "now", reason: "r" }], channels)[0].channels[0].text).toBe("Hi #glass\n\n#new");
  });

  it("gives up after invalid replies and never produces proposals from them", async () => {
    const bad = JSON.stringify({ action: "final", result: { proposals: [{ clipId: "clip-9", channels: [{ integrationId: "int-tt", text: "x" }], when: "now", reason: "r" }] } });
    const out = await runAgent(scripted([bad, bad, bad, bad]), planTask(options));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error).toMatch(/invalid 4 times in a row/);
  });
});

/* ------------------------------------------------------------------ the trigger and the quiet hours */

const settings = (patch: Partial<AutopilotSettings> = {}): AutopilotSettings => ({ ...DEFAULT_AUTOPILOT, enabled: true, channels: ["int-tt"], ...patch });
const queued = (patch: Partial<SocialQueueItem> = {}): SocialQueueItem => ({ id: "q1", clipId: "clip-1", channels: [{ integrationId: "int-tt", platform: "tiktok", text: "t", settings: { __type: "tiktok" } }], when: "now", status: "proposed", by: "ai", reason: "r", createdAt: iso(NOW - 3_600_000), postIds: [], error: null, log: [], ...patch });

describe("shouldPlanNow (the page's 15-minute check)", () => {
  it("plans when the autopilot is on, a channel is ticked, the last run is older than proposeHours and today's budget has room", () => {
    expect(shouldPlanNow(settings(), [], NOW)).toBe(true);
    expect(planRefusal(settings({ enabled: false }), [], NOW)).toBe("disabled");
    expect(planRefusal(settings({ channels: [] }), [], NOW)).toBe("noChannels");
    expect(planRefusal(settings({ lastPlannedAt: iso(NOW - 5 * 3_600_000) }), [], NOW)).toBe("tooSoon");
    expect(planRefusal(settings({ lastPlannedAt: iso(NOW - 6 * 3_600_000 - 1) }), [], NOW)).toBeNull();
    expect(planRefusal(settings({ lastPlannedAt: iso(NOW - 2 * 3_600_000), proposeHours: 1 }), [], NOW)).toBeNull();
    expect(planRefusal(settings({ lastPlannedAt: "garbage" }), [], NOW)).toBeNull();
    // today's proposals: the AI's, made today (local), whatever became of them; the user's own do not count
    const today = [queued(), queued({ id: "q2", status: "posted" }), queued({ id: "q3", status: "skipped" })];
    expect(planRefusal(settings({ perDay: 3 }), today, NOW)).toBe("dayFull");
    expect(planRefusal(settings({ perDay: 4 }), today, NOW)).toBeNull();
    expect(proposalsLeftToday(settings({ perDay: 5 }), today, NOW)).toBe(2);
    expect(proposalsToday([queued({ createdAt: iso(local(2026, 9, 18, 23, 59)) }), queued({ id: "u", by: "user" }), queued({ id: "t", createdAt: iso(local(2026, 9, 19, 0, 0)) })], NOW).map((i) => i.id)).toEqual(["t"]);
    expect(shouldPlanNow(settings({ perDay: 1 }), [queued()], NOW)).toBe(false);
  });

  it("knows the quiet hours, across midnight, and the first allowed time after them", () => {
    expect(inQuietMinutes(23 * 60, "22:00", "08:00")).toBe(true);
    expect(inQuietMinutes(3 * 60, "22:00", "08:00")).toBe(true);
    expect(inQuietMinutes(8 * 60, "22:00", "08:00")).toBe(false);
    expect(inQuietMinutes(21 * 60 + 59, "22:00", "08:00")).toBe(false);
    expect(inQuietMinutes(13 * 60, "12:00", "14:00")).toBe(true);
    expect(inQuietMinutes(13 * 60, "14:00", "12:00")).toBe(false);
    expect(inQuietMinutes(13 * 60, "09:00", "09:00")).toBe(false); // no quiet hours
    expect(inQuietHours(new Date(local(2026, 9, 19, 22, 0)), "22:00", "08:00")).toBe(true);
    expect(nextAllowedTime(new Date(local(2026, 9, 19, 23, 15)), "22:00", "08:00").getTime()).toBe(local(2026, 9, 20, 8, 0));
    expect(nextAllowedTime(new Date(local(2026, 9, 20, 2, 0)), "22:00", "08:00").getTime()).toBe(local(2026, 9, 20, 8, 0));
    expect(nextAllowedTime(new Date(local(2026, 9, 20, 13, 0)), "12:00", "14:00").getTime()).toBe(local(2026, 9, 20, 14, 0));
    const fine = new Date(local(2026, 9, 20, 15, 0));
    expect(nextAllowedTime(fine, "22:00", "08:00")).toBe(fine);
  });

  it("offers the planner the unposted clips only and the ticked, enabled channels", () => {
    const item = (id: string, exists = true): LibraryItem => ({ id, path: `C:/${id}.mp4`, fileName: `${id}.mp4`, bytes: 1, durationSec: 10, width: 1080, height: 1920, createdAt: NOW - 1000, thumbnail: null, exists, encoder: null, meta: { title: id, mode: "glass", seed: 1, link: "", platform: "tiktok", hook: null, caption: "c", hashtags: ["#a"], queueJobId: null } });
    const audit: SocialAuditEntry[] = [{ at: iso(NOW), action: "createPosts", channels: ["int-tt"], postIds: ["p1"], by: "user", clipId: "posted", when: "now" }];
    const library = [item("fresh"), item("posted"), item("queued"), item("skipped"), item("gone", false)];
    const queue = [queued({ clipId: "queued" }), queued({ id: "q2", clipId: "skipped", status: "skipped" })];
    expect(unpostedClips(library, queue, audit).map((c) => c.id)).toEqual(["fresh", "skipped"]); // a skipped proposal frees its clip
    expect(unpostedClips(library, queue, audit)[0]).toEqual({ id: "fresh", title: "fresh", caption: "c", hashtags: ["#a"], platform: "tiktok", durationSec: 10, createdAt: iso(NOW - 1000) });
    expect(sanitizeAutopilot({ channels: ["int-tt", "int-ig"] })).toEqual({ channels: ["int-tt", "int-ig"] });
  });
});

/* ------------------------------------------------------------------ one planning run over a fake bridge */

describe("runPlanner", () => {
  const library: LibraryItem[] = [{ id: "clip-1", path: "C:/glass.mp4", fileName: "glass.mp4", bytes: 1, durationSec: 12, width: 1080, height: 1920, createdAt: NOW - 1000, thumbnail: null, exists: true, encoder: null, meta: { title: "Glass smash", mode: "glass", seed: 1, link: "", platform: "tiktok", hook: null, caption: "Which floor breaks first?", hashtags: ["#glass"], queueJobId: null } }];
  const bridge = (over: { settings?: Partial<AutopilotSettings>; queue?: SocialQueueItem[]; library?: LibraryItem[] } = {}) => {
    const proposed: unknown[] = [];
    const api = {
      library: { list: async () => over.library ?? library },
      ai: { playbook: async () => "" },
      social: {
        autopilot: { get: async () => settings(over.settings) },
        queue: { list: async () => over.queue ?? [], propose: async (p: unknown) => (proposed.push(p), []) },
        audit: async () => [],
        channels: { list: async () => channels },
        posts: async () => [{ id: "p1", channel: { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: null }, state: "PUBLISHED" as const, publishDate: iso(NOW - 86_400_000), releaseUrl: null, error: null, content: "Yesterday" }],
      },
    } as unknown as Pick<DesktopApi, "library" | "social" | "ai">;
    return { api, proposed };
  };
  const answer = JSON.stringify({ action: "final", result: { proposals: [{ clipId: "clip-1", channels: [{ integrationId: "int-tt", text: "Which floor breaks first?", hashtags: ["#glass"] }], when: "now", reason: "Lunchtime did well." }] } });

  it("refuses before the model when no channel is ticked, every clip is taken or today's budget is spent", async () => {
    const model = scripted([]);
    expect(await runPlanner(bridge({ settings: { channels: [] } }).api, model, { locale: "en", playbook: "", now: NOW })).toEqual({ ok: false, reason: "noChannels", error: null });
    expect(await runPlanner(bridge({ settings: { channels: ["int-ig"] } }).api, model, { locale: "en", playbook: "", now: NOW })).toEqual({ ok: false, reason: "noChannels", error: null }); // a disabled channel
    expect(await runPlanner(bridge({ queue: [queued()] }).api, model, { locale: "en", playbook: "", now: NOW })).toEqual({ ok: false, reason: "noClips", error: null });
    expect(await runPlanner(bridge({ queue: [queued({ clipId: "other" })] }).api, model, { locale: "en", playbook: "", now: NOW })).toEqual({ ok: false, reason: "dayFull", error: null });
    expect(model.calls).toEqual([]);
  });

  it("runs the task on the model and answers with queue proposals (it never calls propose or post itself)", async () => {
    const b = bridge({ queue: [queued({ clipId: "other" })] });
    const model = scripted([answer]);
    const out = await runPlanner(b.api, model, { locale: "en", playbook: "## 3. The recipe\nLunch.", now: NOW, ignoreBudget: true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.proposals).toEqual([{ clipId: "clip-1", channels: [{ integrationId: "int-tt", platform: "tiktok", text: "Which floor breaks first?\n\n#glass", settings: { __type: "tiktok" } }], when: "now", reason: "Lunchtime did well." }]);
    expect(out.channels.map((c) => c.id)).toEqual(["int-tt"]);
    expect(b.proposed).toEqual([]);
    const system = model.calls[0][0].content;
    expect(system).toContain("PUBLISHED");
    expect(system).toContain("Lunch.");
    expect(system).toContain("at most 1 clip(s)");
    const failed = await runPlanner(bridge().api, scripted(["not json", "nope", "still", "no"]), { locale: "en", playbook: "", now: NOW });
    expect(failed).toMatchObject({ ok: false, reason: "model" });
  });
});

/* ------------------------------------------------------------------ the Posts tab's Proposed group and Autopilot card */

const libraryItem: LibraryItem = { id: "clip-1", path: "C:/Videos/glass.mp4", fileName: "glass.mp4", bytes: 4_000_000, durationSec: 12, width: 1080, height: 1920, encoder: "h264_nvenc", createdAt: 1, exists: true, thumbnail: "data:image/jpeg;base64,/9j/", meta: { title: "Glass smash", mode: "glass", seed: 7, link: "", platform: "tiktok", hook: null, caption: "Which floor breaks first?", hashtags: ["#glass", "#asmr"], queueJobId: null } };
const proposal: SocialQueueItem = queued({
  channels: [
    { integrationId: "int-tt", platform: "tiktok", text: "Which floor breaks first?\n\n#glass", settings: { __type: "tiktok" } },
    { integrationId: "int-yt", platform: "youtube", text: "Gerald drops through glass floors.", settings: { __type: "youtube", title: "Glass smash" } },
  ],
  when: "2026-10-19T18:30:00.000Z",
  reason: "Evening posts did well last week.",
});

describe("the Proposed group", () => {
  const render = (items: SocialQueueItem[], locale = "en", over: Partial<React.ComponentProps<typeof ProposedView>> = {}) => withIntl(createElement(ProposedView, { items, library: [libraryItem], channels, busy: false, error: null, onReview: () => {}, onSkip: () => {}, onRemove: () => {}, onText: () => {}, ...over }), locale);

  it("shows each proposal with the clip's thumbnail, channels, when, status, who wrote it, the reason, editable texts and the three buttons", () => {
    const html = render([proposal]);
    expect(attr(html, "postiz-proposed")).toBeTruthy();
    expect(html).toContain("Proposed · 1");
    expect(html).toContain(en.Desktop.postizProposedIntro);
    const row = attr(html, "postiz-proposal");
    expect(row).toContain('data-status="proposed"');
    expect(row).toContain('data-by="ai"');
    expect(html).toContain('src="data:image/jpeg;base64,/9j/"');
    expect(html).toContain("Glass smash");
    expect(html).toContain("Gerald on TikTok · Gerald Shorts");
    expect(html).toContain("Why: Evening posts did well last week.");
    expect(html).toContain(en.Desktop.postizProposedBy.ai);
    expect(html).toContain(en.Desktop.postizQueueStatus.proposed);
    expect(html.match(/data-testid="postiz-proposal-text"/g)).toHaveLength(2);
    expect(html).toContain("Which floor breaks first?");
    expect(html).toContain("Gerald drops through glass floors.");
    for (const id of ["postiz-proposal-review", "postiz-proposal-skip", "postiz-proposal-remove"]) expect(disabled(attr(html, id)), id).toBe(false);
    expect(html).toContain(en.Desktop.postizProposedReview);
    expect(html).toContain(en.Desktop.postizProposedHint.replace(/'/g, "&#x27;")); // (React escapes the apostrophe)
    // empty
    const empty = render([]);
    expect(empty).toContain(en.Desktop.postizProposedEmpty);
    // a failed one shows its error and offers Review again; one on its way is locked; a missing clip disables Review
    const failed = render([{ ...proposal, status: "failed", error: "Postiz: 413" }]);
    expect(attr(failed, "postiz-proposal-error")).toBeTruthy();
    expect(failed).toContain("Postiz: 413");
    expect(disabled(attr(failed, "postiz-proposal-review"))).toBe(false);
    const flying = render([{ ...proposal, status: "approved" }]);
    expect(disabled(attr(flying, "postiz-proposal-review"))).toBe(true);
    expect(flying).toContain(en.Desktop.postizQueueStatus.approved);
    const gone = render([{ ...proposal, clipId: "nope" }]);
    expect(disabled(attr(gone, "postiz-proposal-review"))).toBe(true);
    expect(gone).toContain(en.Desktop.postizProposedClipGone);
    const err = render([proposal], "en", { error: "The queue could not be read" });
    expect(attr(err, "postiz-proposed-error")).toContain('role="alert"');
    // which items the group shows
    expect(proposedItems([proposal, { ...proposal, id: "a", status: "approved" }, { ...proposal, id: "f", status: "failed" }, { ...proposal, id: "s", status: "skipped" }, { ...proposal, id: "p", status: "posted" }]).map((i) => i.id)).toEqual(["q1", "a", "f"]);
  });

  it("renders in Polish and Spanish with the same structure", () => {
    for (const locale of ["pl", "es"]) {
      const html = render([proposal], locale);
      expect(html).toContain(LOCALES[locale].Desktop.postizProposedReview);
      expect(html).toContain(LOCALES[locale].Desktop.postizProposedSkip);
      expect(html).toContain(LOCALES[locale].Desktop.postizProposedRemove);
      expect(html).toContain(LOCALES[locale].Desktop.postizQueueStatus.proposed);
      expect(html.match(/data-testid="postiz-proposal-text"/g)).toHaveLength(2);
    }
  });
});

describe("the Autopilot card", () => {
  const render = (s: AutopilotSettings | null, locale = "en", over: Partial<React.ComponentProps<typeof AutopilotView>> = {}) => withIntl(createElement(AutopilotView, { settings: s, channels, planning: false, note: null, busy: false, onChange: () => {}, onProposeNow: () => {}, ...over }), locale);

  it("has the enable toggle, the channel checkboxes (disabled ones greyed), per day, quiet hours, language, Propose now and the honest line", () => {
    const html = render(settings({ channels: ["int-tt"], perDay: 2, quietFrom: "21:00", quietTo: "09:00", language: "pl", lastPlannedAt: "2026-10-19T10:00:00.000Z" }));
    expect(attr(html, "postiz-autopilot")).toBeTruthy();
    expect(attr(html, "postiz-autopilot-honest")).toBeTruthy();
    expect(html).toContain("The autopilot only proposes. Nothing is posted until you approve it here.");
    expect(attr(html, "postiz-autopilot-form")).toContain('data-enabled="1"');
    expect(attr(html, "postiz-autopilot-enabled")).toContain("checked");
    const boxes = html.match(/<label[^>]*data-testid="postiz-autopilot-channel"[^>]*>[\s\S]*?<\/label>/g) ?? [];
    expect(boxes).toHaveLength(3);
    expect(boxes[0]).toContain('data-on="1"');
    expect(boxes[1]).toContain('data-on="0"');
    expect(boxes[2]).toMatch(/<input[^>]*\sdisabled/); // the channel Postiz turned off
    expect(attr(html, "postiz-autopilot-perday")).toContain('value="2"');
    expect(attr(html, "postiz-autopilot-perday")).toContain('max="5"');
    expect(attr(html, "postiz-autopilot-quiet-from")).toContain('value="21:00"');
    expect(attr(html, "postiz-autopilot-quiet-to")).toContain('value="09:00"');
    expect(html).toMatch(/<option[^>]*value="pl"[^>]*selected/);
    expect(html).toContain("At most one planning run every 6 hours.");
    expect(html).toContain("Last run");
    expect(disabled(attr(html, "postiz-autopilot-now"))).toBe(false);
    expect(html).toContain(en.Desktop.postizAutopilotProposeNow);
    // off, no channel: Propose now disabled, "No run yet."
    const off = render(settings({ enabled: false, channels: [] }));
    expect(attr(off, "postiz-autopilot-form")).toContain('data-enabled="0"');
    expect(disabled(attr(off, "postiz-autopilot-now"))).toBe(true);
    expect(off).toContain(en.Desktop.postizAutopilotNever);
    // planning, and the notes
    expect(render(settings(), "en", { planning: true })).toContain(en.Desktop.postizAutopilotPlanning);
    expect(render(settings(), "en", { note: { key: "proposed", count: 2 } })).toContain("2 proposals added above.");
    expect(render(settings(), "en", { note: { key: "proposed", count: 0 } })).toContain("Nothing new to propose.");
    expect(render(settings(), "en", { note: { key: "noClips" } })).toContain(en.Desktop.postizAutopilotNote.noClips);
    expect(render(settings(), "en", { note: { key: "needsAi" } })).toContain(en.Desktop.postizAutopilotNote.needsAi);
    expect(attr(render(settings(), "en", { note: { key: "error", error: "model: boom" } }), "postiz-autopilot-note")).toContain("text-danger");
    // before the settings arrived: the card and its honest line, no form
    expect(render(null)).not.toContain('data-testid="postiz-autopilot-form"');
    expect(render(null)).toContain(en.Desktop.postizAutopilotHonest);
  });

  it("renders in Polish and Spanish with the same structure", () => {
    for (const locale of ["pl", "es"]) {
      const html = render(settings(), locale);
      expect(html).toContain(LOCALES[locale].Desktop.postizAutopilotHonest);
      expect(html).toContain(LOCALES[locale].Desktop.postizAutopilotProposeNow);
      expect(html).toContain(LOCALES[locale].Desktop.postizAutopilotEnable);
      expect(html.match(/data-testid="postiz-autopilot-channel"/g)).toHaveLength(3);
    }
  });
});

/* ------------------------------------------------------------------ Review and approve → the card, prefilled */

describe("Review and approve", () => {
  it("hands the card the proposal's channels, texts, settings, time, reason and id", () => {
    const prefill = prefillOfProposal(proposal);
    expect(prefill).toEqual({
      queueItemId: "q1",
      channelIds: ["int-tt", "int-yt"],
      texts: { "int-tt": "Which floor breaks first?\n\n#glass", "int-yt": "Gerald drops through glass floors." },
      settings: { "int-tt": { __type: "tiktok" }, "int-yt": { __type: "youtube", title: "Glass smash" } },
      when: "2026-10-19T18:30:00.000Z",
      reason: "Evening posts did well last week.",
    });
    // the card's time from the proposal's: a schedule when it is still ahead, now when it has passed, a draft as a draft
    expect(prefilledWhen("2026-10-19T18:30:00.000Z", NOW)).toEqual({ kind: "schedule", local: isoToLocal("2026-10-19T18:30:00.000Z") });
    expect(prefilledWhen("2026-10-19T18:30:00.000Z", Date.parse("2026-10-20T00:00:00.000Z"))).toEqual({ kind: "now" });
    expect(prefilledWhen("draft")).toEqual({ kind: "draft" });
    expect(prefilledWhen(null)).toEqual({ kind: "now" });
    expect(initialCardState(libraryItem, prefill).draft.when).toEqual({ kind: "schedule", local: isoToLocal("2026-10-19T18:30:00.000Z") });
    expect(initialCardState(libraryItem).draft.when).toEqual({ kind: "now" });
  });

  it("lays the proposal's settings over the platform's defaults but never TikTok's choices: the user still makes them on the card", () => {
    const tt = cardChannelOf(channels[0], libraryItem.meta, "proposed text");
    const prefilled = prefilledSettings(tt.settings, { __type: "tiktok", privacy_level: "PUBLIC_TO_EVERYONE", comment: true, duet: true, stitch: false, title: "T" }) as TikTokSettings;
    expect(prefilled.privacy_level).toBeUndefined();
    expect(prefilled.comment).toBeUndefined();
    expect(prefilled.title).toBe("T");
    expect(prefilled.video_made_with_ai).toBe(true);
    const yt = cardChannelOf(channels[1], libraryItem.meta, "desc");
    expect((prefilledSettings(yt.settings, { __type: "youtube", title: "Glass smash" }) as YouTubeSettings).title).toBe("Glass smash");
    expect(prefilledSettings(yt.settings, undefined)).toBe(yt.settings);
    // the card, prefilled: the texts and the reason are there, Approve waits for TikTok's audience and interactions
    const draftChannels: CardChannel[] = [
      { ...tt, text: "Which floor breaks first?\n\n#glass", settings: prefilled },
      { ...yt, text: "Gerald drops through glass floors.", settings: prefilledSettings(yt.settings, { __type: "youtube", title: "Glass smash" }) },
    ];
    const state: PostCardState = { ...initialCardState(libraryItem, prefillOfProposal(proposal)), channels, draft: { clipId: "clip-1", channels: draftChannels, when: { kind: "schedule", local: isoToLocal("2026-10-19T18:30:00.000Z") } } };
    const html = withIntl(createElement(PostizPostCardView, { item: libraryItem, state, now: NOW, onDraft: () => {}, onApprove: () => {}, onClose: () => {}, onSlot: () => {}, reason: proposal.reason }));
    expect(attr(html, "postiz-card-reason")).toBeTruthy();
    expect(html).toContain("Why: Evening posts did well last week.");
    expect(html).toContain("Which floor breaks first?");
    expect(attr(html, "postiz-yt-title")).toContain('value="Glass smash"');
    expect(attr(html, "postiz-when-schedule")).toContain("checked");
    expect(disabled(attr(html, "postiz-approve"))).toBe(true);
    const problems = cardProblems(state.draft, NOW).map((p) => p.key);
    expect(problems).toContain("postizProblemTikTokPrivacy");
    expect(problems).toContain("postizProblemTikTokInteractions");
    expect(problems).toContain("postizProblemYouTubeVisibility");
    // once the user chose them, the request carries the full settings – and the card sends it through queue.approve
    const chosen = { ...state.draft, channels: [{ ...draftChannels[0], settings: { ...prefilled, privacy_level: "SELF_ONLY", comment: true, duet: false, stitch: false } as TikTokSettings }, { ...draftChannels[1], settings: { ...(draftChannels[1].settings as YouTubeSettings), type: "public", selfDeclaredMadeForKids: "no" } as YouTubeSettings }] };
    expect(cardProblems(chosen, NOW)).toEqual([]);
    const request = toRequest(chosen);
    expect(request.channels[0].settings).toMatchObject({ privacy_level: "SELF_ONLY", comment: true, duet: false, stitch: false, title: "T" });
    expect(request.when).toBe("2026-10-19T18:30:00.000Z");
    const card = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "PostizPostCard.tsx"), "utf8");
    expect(card).toContain("prefill?.queueItemId ? await bridge.social.queue.approve(prefill.queueItemId, request) : await bridge.social.post(request)");
  });

  it("is wired: the Posts tab gets the autopilot and Review opens the card; the section runs the trigger hook; the AI studio has the plan job", () => {
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    expect(section).toContain("useAutopilot(bridge, page.locale");
    expect(section).toMatch(/autopilot=\{autopilot\}/);
    expect(section).toMatch(/onReview=\{\(item, prefill\) => \{\s*setPostizCard\(\{ item, prefill \}\)/);
    const panel = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "PostsPanel.tsx"), "utf8");
    expect(panel).toContain("onReview?.(clip, prefillOfProposal(item))");
    expect(panel).toMatch(/<ProposedView[\s\S]*<AutopilotView[\s\S]*<PostsView/); // the Proposed group on top
    const hook = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "useAutopilot.ts"), "utf8");
    expect(hook).toContain("shouldPlanNow(s, queueRef.current, Date.now())");
    expect(hook).toContain("setInterval(check, AUTOPILOT_CHECK_MS)");
    expect(hook).toContain('bridge.social.queue.propose(out.proposals.slice(0, 5), "ai")');
    expect(hook).toContain("lastPlannedAt: new Date().toISOString()");
    expect(hook).not.toMatch(/social\.post\(|queue\.approve\(/); // the hook never posts
    expect(AI_TASKS).toContain("plan");
    const ai = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "useDesktopAi.ts"), "utf8");
    expect(ai).toContain('bridge.social.queue.propose(r.proposals.slice(0, 5), "ai")');
    expect(ai).not.toMatch(/social\.post\(|queue\.approve\(/);
  });
});

/* ------------------------------------------------------------------ the bridge and the strings */

type Tree = { [k: string]: string | Tree };
function flat(o: Tree, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));
}

describe("the phases 3–4 bridge and strings", () => {
  it("adds the queue and autopilot methods, the social:queue event and their argument checks", () => {
    expect(BRIDGE_METHODS["social.queue.list"]).toBe("social:queue-list");
    expect(BRIDGE_METHODS["social.queue.propose"]).toBe("social:queue-propose");
    expect(BRIDGE_METHODS["social.queue.approve"]).toBe("social:queue-approve");
    expect(BRIDGE_METHODS["social.queue.edit"]).toBe("social:queue-edit");
    expect(BRIDGE_METHODS["social.queue.skip"]).toBe("social:queue-skip");
    expect(BRIDGE_METHODS["social.queue.remove"]).toBe("social:queue-remove");
    expect(BRIDGE_METHODS["social.autopilot.get"]).toBe("social:autopilot-get");
    expect(BRIDGE_METHODS["social.autopilot.set"]).toBe("social:autopilot-set");
    expect(EVENT_CHANNELS.socialQueue).toBe("social:queue");
    const ok = { clipId: "clip-1", channels: [{ integrationId: "int-tt", platform: "tiktok", text: "t" }], when: null, reason: "r" };
    expect(checkIpcArgs(IPC.socialQueuePropose, [[ok], "ai"])).toBeNull();
    expect(checkIpcArgs(IPC.socialQueuePropose, [[{ ...ok, channels: [{ ...ok.channels[0], settings: { duet: true } }] }], "ai"])).toMatch(/duet/);
    expect(checkIpcArgs(IPC.socialQueuePropose, [Array(6).fill(ok), "ai"])).toMatch(/1 to 5/);
    expect(checkIpcArgs(IPC.socialQueueEdit, ["q1", { when: "now" }])).toBeNull();
    expect(checkIpcArgs(IPC.socialAutopilotSet, ["on"])).toMatch(/patch/);
  });

  it("are the same keys in English, Polish and Spanish, every key the panels use exists, and the copy is honest", () => {
    const keys = (m: unknown) => flat((m as { Desktop: Tree }).Desktop).filter((k) => k.startsWith("postizProposed") || k.startsWith("postizAutopilot") || k.startsWith("postizQueue") || k.startsWith("aiPlan") || k.endsWith(".plan")).sort();
    expect(keys(pl)).toEqual(keys(en));
    expect(keys(es)).toEqual(keys(en));
    expect(keys(en).length).toBeGreaterThan(40);
    const all = new Set(flat((en as unknown as { Desktop: Tree }).Desktop));
    for (const file of ["PostsPanel.tsx", "AiPanel.tsx", "PostizPostCard.tsx"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", file), "utf8");
      const used = [...source.matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
      expect(used.filter((k) => !all.has(k)), file).toEqual([]);
    }
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, Record<string, string>> }[]) {
      expect(Object.keys(m.Desktop.postizQueueStatus).sort()).toEqual(["approved", "failed", "posted", "proposed", "skipped"]);
      expect(Object.keys(m.Desktop.postizProposedBy).sort()).toEqual(["ai", "user"]);
      expect(Object.keys(m.Desktop.postizAutopilotLang).sort()).toEqual(["en", "es", "pl"]);
      expect(Object.keys(m.Desktop.postizAutopilotNote).sort()).toEqual(["dayFull", "needsAi", "noChannels", "noClips"]);
      const d = m.Desktop as unknown as Record<string, string>;
      expect(d.postizProposedTitle).toContain("{count}");
      expect(d.postizProposedReason).toContain("{reason}");
      expect(d.postizAutopilotEvery).toContain("{hours}");
      expect(d.postizAutopilotLastPlanned).toContain("{date}");
      expect(d.postizAutopilotProposed).toContain("{count, plural");
      expect(d.aiPlanTitle).toContain("{count}");
      expect(typeof m.Desktop.aiTask.plan).toBe("string");
      expect(typeof m.Desktop.aiTaskHint.plan).toBe("string");
      expect(typeof m.Desktop.aiPlaceholder.plan).toBe("string");
      // the house style on every new string: no dashes as punctuation, no semicolons
      for (const key of keys(m)) {
        const text = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m.Desktop) as string;
        expect(text, key).not.toMatch(/—| – |;/);
      }
    }
    expect(en.Desktop.postizAutopilotHonest).toBe("The autopilot only proposes. Nothing is posted until you approve it here.");
    expect(en.Desktop.aiPlanHint).toContain("Nothing is posted until you approve");
    expect(en.Desktop.aiTaskHint.plan).toContain("Nothing is posted until you approve");
    expect(pl.Desktop.postizAutopilotHonest).not.toMatch(/\bthe\b|\bonly\b/);
    expect(es.Desktop.postizAutopilotHonest).not.toMatch(/\bthe\b|\bonly\b/);
  });
});
