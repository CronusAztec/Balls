import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { Browser, Page } from "playwright";
import { compile } from "tailwindcss";
import en from "../messages/en.json";
import LibraryPanel from "@/components/simulator/desktop/LibraryPanel";
import { ScoreChipView } from "@/components/simulator/desktop/ScoreChip";
import { genesOfCut, genesOfSavedFile, genesWithScore, type ClipGenes } from "@/lib/insights/genes";
import { scoreOfSettings } from "@/lib/insights/score";
import { RECIPES } from "@/lib/bot/playbook";
import { planClip } from "@/lib/bot/planner";
import { planSource, seedSource } from "@/lib/desktop/queueSources";
import { defaultCaption } from "@/lib/captions";
import { defaultSettings } from "@/lib/settings";
import type { LibraryItem } from "@/lib/desktop/contract";

/*
 * --- insights --- (review fix) The Library's cards while one card's score reasons are open, laid out in Chromium with the
 * site's own Tailwind CSS (src/app/globals.css, built for the classes the panel renders). The reasons open in the card's flow
 * (ScoreChip.tsx), and the cards sit in a grid whose rows stretch their cards to one height, with the buttons at the bottom
 * (`mt-auto`): opening one card's reasons stretched every card of its row to the open card's height, and the neighbours' Play,
 * Show in folder and Re-render rows jumped down 340 px at 1280 px under an empty block. Closed, a row keeps its cards at one
 * height with their buttons lined up; open, no other card grows and none shows an empty block above its buttons. The checks
 * are skipped when Chromium cannot start (a failure with JBL_REQUIRE_BROWSER=1).
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

const ROOT = path.resolve(__dirname, "..");
const withIntl = (node: React.ReactElement) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, node));

/** The site's CSS for the classes of `html`: globals.css (its theme, its base and its own rules) with Tailwind's utilities. */
async function siteCss(html: string): Promise<string> {
  const file = path.join(ROOT, "src", "app", "globals.css");
  const compiler = await compile(fs.readFileSync(file, "utf8"), {
    base: path.dirname(file),
    loadStylesheet: async (id: string, base: string) => {
      const at = id === "tailwindcss" ? path.join(ROOT, "node_modules", "tailwindcss", "index.css") : path.resolve(base, id);
      return { path: at, base: path.dirname(at), content: fs.readFileSync(at, "utf8") };
    },
  });
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  return compiler.build([...classes]);
}

const settings = { ...defaultSettings("classic"), recordingDuration: 20, captions: [{ ...defaultCaption("text", { text: "Can it escape?" }), start: 0, end: 2.5 }] };
const scored = genesWithScore(seedSource(settings, 42).meta!.genes!, scoreOfSettings(settings, { firstImpactSec: 0.4, payoffSec: 17, clipSec: 20 }));
const plan = planClip(RECIPES[0], 3, "reels", { copy: (en as unknown as { ViralBot: Parameters<typeof planClip>[3]["copy"] }).ViralBot, search: false });
const planned = genesOfSavedFile(planSource(plan).meta!.genes!, { durationSec: plan.timing.clipSec, cut: "master" });
const item = (genes: ClipGenes | undefined, id: string): LibraryItem => ({
  id,
  path: `C:/clips/${id}.mp4`,
  fileName: `${id}.mp4`,
  bytes: 12_345_678,
  durationSec: 20,
  width: 1080,
  height: 1920,
  encoder: "h264_nvenc",
  createdAt: 1_700_000_000_000,
  exists: true,
  thumbnail: null,
  meta: { title: "A clip", mode: "classic", seed: 42, link: "https://example.com/en/simulator/?mode=classic", platform: "tiktok", hook: "Can it escape?", caption: "Who gets out?", hashtags: ["#balls"], queueJobId: null, ...(genes ? { genes } : {}) },
});
// a scored clip, one saved before scores (no chip), a plan's master and its cut (no chip), a second scored clip
const ITEMS = [item(scored, "scored"), item(undefined, "old"), item(planned, "planned"), item(genesOfCut(planned, { durationSec: 11.5, hook: "Who gets out first?", sameHook: false }), "cut"), item(scored, "scored-2")];
const bridge = {} as React.ComponentProps<typeof LibraryPanel>["bridge"];
const closed = withIntl(createElement(LibraryPanel, { bridge, items: ITEMS, onRefresh: () => {}, onRerender: () => {} }));
/** The first card's chip as it renders open (ScoreChip's own state flips it): swapped in for the closed one in the page. */
const open = withIntl(createElement(ScoreChipView, { genes: scored, open: true, onToggle: () => {}, onClose: () => {}, panelId: "score-reasons-grid", testId: "library-score" }));

type Card = { name: string; top: number; height: number; buttons: number; gap: number };

describe("the Library's grid while a card's score reasons are open, laid out in Chromium", () => {
  let browser: Browser | null = null;
  let page: Page | null = null;
  let css = "";

  beforeAll(async () => {
    css = await siteCss(closed + open);
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
      page = await browser.newPage();
    } catch (err) {
      // --- ai-guard --- JBL_REQUIRE_BROWSER=1 (the core guard sets it) makes a missing Chromium a failure, never a silent skip
      if (process.env.JBL_REQUIRE_BROWSER === "1") throw new Error(`JBL_REQUIRE_BROWSER=1: Chromium did not start for the Library grid check: ${String(err)}`);
      console.warn("Chromium is not available – the Library grid check is skipped:", err);
      await browser?.close().catch(() => undefined);
      browser = null;
      page = null;
    }
  }, 120000);
  afterAll(async () => {
    await browser?.close();
  });

  /** Every card's top, height, the top of its button row and the room between its last line and that row. */
  const cards = (p: Page) =>
    p.evaluate(() =>
      [...document.querySelectorAll("[data-library-item]")].map((li) => {
        const row = li.querySelector(".mt-auto")!;
        const above = row.previousElementSibling!.getBoundingClientRect();
        const box = li.getBoundingClientRect();
        const buttons = row.getBoundingClientRect();
        return { name: li.getAttribute("data-library-item")!, top: Math.round(box.top), height: Math.round(box.height), buttons: Math.round(buttons.top), gap: Math.round(buttons.top - above.bottom) };
      }),
    );
  const rows = (list: Card[]) => [...new Set(list.map((c) => c.top))].map((top) => list.filter((c) => c.top === top));

  it("keeps the other cards at their own height, with nothing above their buttons, at two and three columns", async () => {
    if (!page) return;
    expect(closed).toContain('data-testid="library-score"');
    expect(css).toContain(".mt-auto");
    for (const width of [700, 1280, 1600]) {
      await page.setViewportSize({ width, height: 1200 });
      await page.setContent(`<!doctype html><html class="dark"><head><style>${css}</style></head><body><main style="padding:16px">${closed}</main></body></html>`);
      const before = await cards(page);
      const grid = rows(before);
      expect([width, grid[0].length]).toEqual([width, width >= 1280 ? 3 : 2]);
      // closed: a row's cards share one height and line their buttons up
      for (const row of grid) expect([width, new Set(row.map((c) => c.height)).size, new Set(row.map((c) => c.buttons)).size]).toEqual([width, 1, 1]);
      await page.evaluate((html) => {
        document.querySelector('[data-testid="library-score"]')!.outerHTML = html;
      }, open);
      const after = await cards(page);
      const [first, ...others] = after;
      expect([width, first.name, first.height > before[0].height + 100]).toEqual([width, "scored.mp4", true]);
      for (const card of others) {
        const was = before.find((c) => c.name === card.name)!;
        // no other card grows, and none shows an empty block above its buttons (the row's own 4 px padding at most)
        expect([width, card.name, card.height <= was.height, card.gap <= 6]).toEqual([width, card.name, true, true]);
        // the open card's row-mates keep their buttons where they were, or higher (a card without a chip is a line shorter)
        if (was.top === before[0].top) expect([width, card.name, card.buttons <= was.buttons]).toEqual([width, card.name, true]);
      }
    }
  });
});
