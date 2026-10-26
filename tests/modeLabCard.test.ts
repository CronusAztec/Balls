import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser, Page } from "playwright";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- review fix (blueprint) --- The Mode Lab card's name reads in full next to its family tag in every language. A
 * poster card (src/components/site/PosterCard.tsx) puts the name (the ui face, 500, 14 px, truncated with an ellipsis)
 * and the tag (the mono face, 12 px, upper case, 0.08em tracking) on one line, 12 px apart (gap-3). The tag shows from
 * 640 px on, and the narrowest cards it shows on are at 640 px: the modes wall's (ModesOverview.tsx: a 24 px gutter
 * each side, three columns 16 px apart), (640 − 2 × 24 − 2 × 16) / 3 ≈ 186.7 px, and the studio's Change mode picker's
 * (ModePicker.tsx: the same wall in a dialog of min(960 px, 100vw − 32 px) with 24 px of padding and a thin scrollbar,
 * allowed 12 px), (608 − 2 × 24 − 12 − 2 × 16) / 3 = 172 px. Below 640 px the name is alone on two columns: the
 * picker's at 360 px (16 px of padding) is (328 − 2 × 16 − 16) / 2 = 140 px. "Laboratorium trybów" next to
 * LABORATORIUM, and "Laboratorio de modos" next to LABORATORIO, took 243 px and were cut to "Laboratorium t…" at every
 * desktop width. With the tag "Lab" in both, "Laboratorio de modos" still took 175.9 px, over the picker's 172, so
 * Spanish calls it "Lab de modos". The text is measured in Chromium with the site's own font files (src/app/fonts.ts,
 * each with its unicode range); the check is skipped when Chromium cannot start (a failure with JBL_REQUIRE_BROWSER=1).
 */

const ROOT = path.resolve(__dirname, "..");
/** The narrowest cards that show the family tag (the modes wall and the studio's picker at 640 px), and the room between the name and the tag. */
const NARROWEST_CARDS_PX = { wall: (640 - 2 * 24 - 2 * 16) / 3, picker: (Math.min(960, 640 - 32) - 2 * 24 - 12 - 2 * 16) / 3 };
const NAME_TAG_GAP_PX = 12;
/** The narrowest card a phone shows (the picker at 360 px, two columns): the name alone, without the tag. */
const PHONE_CARD_PX = (Math.min(960, 360 - 32) - 2 * 16 - 16) / 2;

type Messages = { Modes: { blueprint: { name: string } }; SiteRedesign: { families: Record<string, string> } };
const LOCALES: [string, Messages][] = [
  ["en", en as unknown as Messages],
  ["pl", pl as unknown as Messages],
  ["es", es as unknown as Messages],
];

/** The site's font files with their unicode ranges, as src/app/fonts.ts declares them (file name → range). */
function siteFonts(): { file: string; range: string; data: string }[] {
  const src = fs.readFileSync(path.join(ROOT, "src", "app", "fonts.ts"), "utf8");
  const out: { file: string; range: string; data: string }[] = [];
  for (const m of src.matchAll(/src: "\.\.\/fonts\/([a-z-]+\.woff2)"[\s\S]*?prop: "unicode-range", value: "([^"]+)"/g))
    out.push({ file: m[1], range: m[2], data: fs.readFileSync(path.join(ROOT, "src", "fonts", m[1])).toString("base64") });
  return out;
}

describe("the Mode Lab card, measured in Chromium with the site's fonts", () => {
  let browser: Browser | null = null;
  let page: Page | null = null;

  beforeAll(async () => {
    try {
      const fonts = siteFonts();
      expect(fonts.map((f) => f.file)).toEqual(expect.arrayContaining(["hanken-grotesk-latin.woff2", "hanken-grotesk-latin-ext.woff2", "jetbrains-mono-latin.woff2", "jetbrains-mono-latin-ext.woff2"]));
      const { chromium } = await import("playwright");
      browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
      page = await browser.newPage();
      await page.setContent("<!doctype html><html><body></body></html>");
      // every file as its own face, named after its family (the ext range listed first, as the site's stacks do)
      await page.evaluate(async (list) => {
        for (const f of list) {
          const face = new FontFace(f.file.startsWith("hanken") ? "SiteUi" : f.file.startsWith("jetbrains") ? "SiteMono" : "SiteDisplay", `url(data:font/woff2;base64,${f.data})`, { unicodeRange: f.range, weight: "100 900" });
          await face.load();
          document.fonts.add(face);
        }
      }, fonts);
    } catch (err) {
      // --- ai-guard --- JBL_REQUIRE_BROWSER=1 (the core guard sets it) makes a missing Chromium a failure, never a silent skip
      if (process.env.JBL_REQUIRE_BROWSER === "1") throw new Error(`JBL_REQUIRE_BROWSER=1: Chromium did not start for the Mode Lab card check: ${String(err)}`);
      console.warn("Chromium is not available – the Mode Lab card check is skipped:", err);
      await browser?.close().catch(() => undefined);
      browser = null;
      page = null;
    }
  }, 120000);
  afterAll(async () => {
    await browser?.close();
  });

  it("fits the card's name and its family tag on one line of the narrowest wall and picker card, and the name alone on a phone, in English, Polish and Spanish", async (ctx) => {
    if (!page) return ctx.skip();
    const texts = LOCALES.map(([locale, m]) => ({ locale, name: m.Modes.blueprint.name, tag: m.SiteRedesign.families.lab }));
    const widths = await page.evaluate((list) => {
      const span = document.createElement("span");
      document.body.appendChild(span);
      const width = (text: string, css: string) => {
        span.style.cssText = `white-space:nowrap;${css}`;
        span.textContent = text;
        return span.getBoundingClientRect().width;
      };
      return list.map((x) => ({
        name: width(x.name, "font-family:SiteUi;font-weight:500;font-size:14px;letter-spacing:normal"),
        tag: width(x.tag, "font-family:SiteMono;font-weight:400;font-size:12px;letter-spacing:0.08em;text-transform:uppercase"),
        loaded: document.fonts.check("500 14px SiteUi", x.name) && document.fonts.check("400 12px SiteMono", x.tag.toUpperCase()),
      }));
    }, texts);
    // (the faces loaded – the browser says so – and a mono tag is 0.6 em a letter plus its tracking, so LAB is about 24.5 px.
    // A Chromium without subpixel text positioning, like the CI runner's, rounds each advance to a whole pixel: 7 px, not
    // 7.2, so the word may come out up to half a pixel a letter narrower or wider.)
    expect(widths.map((w) => w.loaded)).toEqual(texts.map(() => true));
    expect(Math.abs(widths[0].tag - 3 * (0.6 * 12 + 0.08 * 12))).toBeLessThanOrEqual(3 * 0.5);
    expect([NARROWEST_CARDS_PX.wall, NARROWEST_CARDS_PX.picker, PHONE_CARD_PX].map((w) => Math.round(w * 10) / 10)).toEqual([186.7, 172, 140]);
    texts.forEach((x, i) => {
      const line = Math.round((widths[i].name + NAME_TAG_GAP_PX + widths[i].tag) * 10) / 10;
      const name = Math.round(widths[i].name * 10) / 10;
      const fits = { wall: line <= NARROWEST_CARDS_PX.wall, picker: line <= NARROWEST_CARDS_PX.picker, phone: name <= PHONE_CARD_PX };
      expect({ ...x, fits, line, name }).toEqual({ ...x, fits: { wall: true, picker: true, phone: true }, line, name });
    });
  });
});
