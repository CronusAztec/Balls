import { describe, expect, it } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import ScoreChip, { ScoreChipView, chipKey, scoreLines } from "@/components/simulator/desktop/ScoreChip";
import { PostizPostCardView, initialCardState } from "@/components/simulator/desktop/PostizPostCard";
import LibraryPanel from "@/components/simulator/desktop/LibraryPanel";
import QueuePanel from "@/components/simulator/desktop/QueuePanel";
import { genesOfCut, genesOfSavedFile, genesWithScore, type ClipGenes } from "@/lib/insights/genes";
import { scoreOfSettings } from "@/lib/insights/score";
import { CHECKLIST, RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import { planSource, seedSource } from "@/lib/desktop/queueSources";
import { EMPTY_QUEUE, enqueue, expandBatch } from "@/lib/desktop/renderQueue";
import { cardProblems } from "@/lib/desktop/socialCard";
import { defaultCaption } from "@/lib/captions";
import { defaultSettings } from "@/lib/settings";
import type { LibraryItem } from "@/lib/desktop/contract";

/*
 * --- insights --- The score chip (components/simulator/desktop/ScoreChip.tsx) on the approval card, the Library and the
 * Queue, rendered as the desktop panel tests render theirs: closed and open, in the three languages, as a screen reader
 * gets it (a named button that says the score is the playbook's and unmeasured, the reasons as a region it controls, the
 * points as words), within a 360 px panel, and never touching what Approve allows.
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

type Messages = typeof en;
const LOCALES: Record<string, Messages> = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };
const withIntl = (node: React.ReactElement, locale = "en") => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, node)).replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const format = (text: string, locale: string, values: Record<string, string | number> = {}) => String(new IntlMessageFormat(text, locale).format(values));

const settings = { ...defaultSettings("classic"), recordingDuration: 20, captions: [{ ...defaultCaption("text", { text: "Can it escape?" }), start: 0, end: 2.5 }] };
const scored = genesWithScore(seedSource(settings, 42).meta!.genes!, scoreOfSettings(settings, { firstImpactSec: 0.4, payoffSec: 17, clipSec: 20 }));
const view = (genes: ClipGenes | null | undefined, open: boolean, locale = "en") => withIntl(createElement(ScoreChipView, { genes, open, onToggle: () => {}, onClose: () => {}, panelId: "score-reasons-t1" }), locale);
const attr = (html: string, name: string) => html.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

describe("the score chip", () => {
  it("is a named button that says the score is the playbook's and not yet measured, closed at first", () => {
    for (const locale of ["en", "pl", "es"]) {
      const i = LOCALES[locale].Insights;
      const html = view(scored, false, locale);
      expect([locale, (html.match(/<button/g) ?? []).length]).toEqual([locale, 1]);
      expect([locale, attr(html, "aria-expanded"), attr(html, "aria-controls"), attr(html, "aria-label"), attr(html, "title")]).toEqual([locale, "false", "score-reasons-t1", format(i.chipLabel, locale, { score: scored.planScore! }), i.unmeasured]);
      expect(html).toContain(format(i.chip, locale, { score: scored.planScore! }));
      expect(html).not.toContain('role="region"');
      expect(attr(html, "data-score")).toBe(String(scored.planScore));
    }
    // the chip with its own state starts closed
    expect(withIntl(createElement(ScoreChip, { genes: scored }))).toContain('aria-expanded="false"');
  });

  // --- insights --- (review fix) WCAG 2.5.3: a voice command that says the label it sees ("click Poradnik 64") finds the button,
  // and a screen reader says once that the score is not yet measured (the description), not twice (name and description)
  it("has a name that starts with its visible label, and says it is unmeasured once, as its description", () => {
    for (const locale of ["en", "pl", "es"]) {
      const i = LOCALES[locale].Insights;
      const html = view(scored, false, locale);
      const name = attr(html, "aria-label") ?? "";
      const visible = format(i.chip, locale, { score: scored.planScore! });
      expect([locale, name.startsWith(visible), name.includes(String(scored.planScore)), name.includes("100")]).toEqual([locale, true, true, true]);
      expect([locale, name.includes(i.unmeasured), name.includes(i.unmeasured.replace(/[.。]$/, ""))]).toEqual([locale, false, false]);
      expect([locale, attr(html, "title")]).toEqual([locale, i.unmeasured]);
    }
  });

  it("opens its reasons below it: the region it controls, every checklist item with its verdict and its points as words", () => {
    for (const locale of ["en", "pl", "es"]) {
      const m = LOCALES[locale];
      const html = view(scored, true, locale);
      const region = html.slice(html.indexOf('role="region"') - 60);
      expect([locale, attr(html, "aria-expanded"), attr(region, "id"), attr(region, "aria-label")]).toEqual([locale, "true", "score-reasons-t1", format(m.Insights.title, locale, { score: scored.planScore! })]);
      expect(html).toContain(m.Insights.unmeasured);
      expect(html).toContain(m.Insights.note);
      expect([locale, [...html.matchAll(/data-score-item="([a-z]+)"/g)].map((x) => x[1])]).toEqual([locale, CHECKLIST.map((c) => c.id)]);
      for (const line of scoreLines(scored)) {
        expect(html).toContain(format(m.Insights.points, locale, { points: line.points, max: line.max }));
        expect(html).toContain(`${m.ViralBot.checklist[line.id]}:`);
      }
      // a verdict with its numbers in the bot's words; the hook's in Insights' (the genes keep no words)
      const motion = scored.reasons!.motion!;
      expect(html).toContain(format((m.ViralBot.reasons as Record<string, string>)[motion.key], locale, { ...motion.values } as Record<string, number>));
      expect(scored.reasons!.hook!.key).toBe("hookOk");
      expect(html).toContain(m.Insights.reasons.hookOk);
      // no key or placeholder left unfilled
      expect([locale, html.match(/Insights\.|ViralBot\.|\{[a-z]+\}/g)]).toEqual([locale, null]);
      // the marks are for the eye only
      expect(html).toMatch(/<span aria-hidden="true" class="text-(accent|warn|danger)">[✓◐✕]<\/span>/);
    }
  });

  it("shows no chip for a clip without a score, and only the points for genes that keep no verdicts", () => {
    expect(view(null, true)).toBe("");
    expect(view(undefined, false)).toBe("");
    expect(view(seedSource(settings, 1).meta!.genes!, true)).toBe("");
    const bare: ClipGenes = { ...scored, reasons: undefined };
    delete bare.reasons;
    const html = view(bare, true);
    expect([...html.matchAll(/data-score-item=/g)].length).toBe(CHECKLIST.length);
    expect(html).not.toContain(en.Insights.reasons.hookOk);
  });

  it("closes on Escape, and only when open", () => {
    expect([chipKey("Escape", true), chipKey("Escape", false), chipKey("Enter", true), chipKey(" ", true)]).toEqual([true, false, false, false]);
  });

  it("takes the bot's colours for the score's band", () => {
    const tone = (score: number) => attr(view({ ...scored, planScore: score }, false).match(/<button[^>]*>/)?.[0] ?? "", "class");
    expect(tone(95)).toContain("text-accent");
    expect(tone(80)).toContain("text-warn");
    expect(tone(40)).toContain("text-danger");
  });

  it("fits a 360 px panel: nothing wider than its container, long words wrap, the reasons in the flow", () => {
    const html = view(scored, true, "pl");
    expect(html).not.toMatch(/\b(min-)?w-(\[[^\]]+\]|\d{2,}|screen)/);
    expect(html).not.toMatch(/\babsolute\b|\bfixed\b|whitespace-nowrap/);
    expect(attr(html.slice(html.indexOf('role="region"') - 60), "class")).toContain("w-full");
    expect(html).toContain("break-words");
  });
});

describe("the chip on the panels", () => {
  const plan = planClip(RECIPES[0], 3, "reels", { copy: (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot, search: false });
  const planned = planSource(plan).meta!.genes!;
  const item = (genes: ClipGenes | undefined, id = "a"): LibraryItem => ({
    id,
    path: `C:/clips/${id}.mp4`,
    fileName: `${id}.mp4`,
    bytes: 1_000_000,
    durationSec: 20,
    width: 1080,
    height: 1920,
    encoder: "h264_nvenc",
    createdAt: 1,
    exists: true,
    thumbnail: null,
    meta: { title: "A clip", mode: "classic", seed: 42, link: "https://example.com/en/simulator/?mode=classic", platform: "tiktok", hook: "Can it escape?", caption: "Who gets out?", hashtags: ["#balls"], queueJobId: null, ...(genes ? { genes } : {}) },
  });

  it("sits under the clip on the approval card, and Approve and the card's problems never read it", () => {
    const low = { ...scored, planScore: 3 };
    const render = (genes: ClipGenes | undefined) => {
      const it = item(genes);
      return withIntl(createElement(PostizPostCardView, { item: it, state: initialCardState(it), now: 0, onDraft: () => {}, onApprove: () => {}, onClose: () => {}, onSlot: () => {} }));
    };
    const withScore = render(low);
    const without = render(undefined);
    expect(withScore).toContain('data-testid="postiz-card-score"');
    expect(without).not.toContain('data-testid="postiz-card-score"');
    const approve = (html: string) => html.match(/<button[^>]*data-testid="postiz-approve"[^>]*>/)?.[0];
    expect(approve(withScore)).toBe(approve(without));
    expect(cardProblems(initialCardState(item(low)).draft, 0, {}, {})).toEqual(cardProblems(initialCardState(item(undefined)).draft, 0, {}, {}));
  });

  it("shows each Library clip's score, and none for a clip saved before scores", () => {
    const html = withIntl(createElement(LibraryPanel, { bridge: {} as React.ComponentProps<typeof LibraryPanel>["bridge"], items: [item(planned, "planned"), item(undefined, "old")], onRefresh: () => {}, onRerender: () => {} }));
    expect((html.match(/data-testid="library-score"/g) ?? []).length).toBe(1);
    expect(html).toContain(`data-score="${planned.planScore}"`);
  });

  // --- insights --- (review fix) a cut's chip showed its master's score: "Length: 23 s", the master's payoff and hook
  it("shows no chip on a TikTok cut's Library item or approval card: its master's score is not the cut's", () => {
    const master = genesOfSavedFile(planned, { durationSec: 23, cut: "master" });
    const cut = genesOfCut(master, { durationSec: 11.5, hook: "Who gets out first?", sameHook: false });
    const library = withIntl(createElement(LibraryPanel, { bridge: {} as React.ComponentProps<typeof LibraryPanel>["bridge"], items: [item(master, "master"), item(cut, "cut")], onRefresh: () => {}, onRerender: () => {} }));
    expect([...library.matchAll(/data-testid="library-score"[^>]*data-score="(\d+)"/g)].map((m) => Number(m[1]))).toEqual([Math.round(master.planScore!)]);
    const card = (genes: ClipGenes) => {
      const it = item(genes);
      return withIntl(createElement(PostizPostCardView, { item: it, state: initialCardState(it), now: 0, onDraft: () => {}, onApprove: () => {}, onClose: () => {}, onSlot: () => {} }));
    };
    expect(card(master)).toContain('data-testid="postiz-card-score"');
    expect(card(cut)).not.toContain('data-testid="postiz-card-score"');
  });

  it("shows a plan's score in the Queue from the start, and a link's once it is rendered", () => {
    let n = 0;
    const jobs = expandBatch([planSource(plan), seedSource(settings, 7)], { resolutions: ["1080x1920"], fps: [60], codecs: ["h264"], presets: ["native"] });
    const state = enqueue(EMPTY_QUEUE, jobs, 1, () => `job-${++n}`);
    const queue = { state, resumable: null, folder: "", cutting: null, lastError: null, add: () => 0, pendingCuts: () => [] } as unknown as React.ComponentProps<typeof QueuePanel>["queue"];
    const page = { settings: defaultSettings("classic"), busy: false, pageSeed: () => 1 } as unknown as React.ComponentProps<typeof QueuePanel>["page"];
    for (const locale of ["en", "pl", "es"]) {
      const html = withIntl(createElement(QueuePanel, { bridge: {} as React.ComponentProps<typeof QueuePanel>["bridge"], queue, page, folder: "", onFolder: () => {} }), locale);
      expect([locale, (html.match(/data-testid="job-score"/g) ?? []).length]).toEqual([locale, 1]);
    }
    const done = { ...state, jobs: state.jobs.map((j) => (j.id === "job-2" ? { ...j, status: "done" as const, meta: { ...j.meta, genes: scored } } : j)) };
    const html = withIntl(createElement(QueuePanel, { bridge: {} as React.ComponentProps<typeof QueuePanel>["bridge"], queue: { ...queue, state: done }, page, folder: "", onFolder: () => {} }));
    expect((html.match(/data-testid="job-score"/g) ?? []).length).toBe(2);
  });
});
