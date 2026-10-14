/**
 * --- seo --- Draws the social cards: public/og/<locale>/<page>.png, 1200x630, the picture a shared link shows (Open Graph and
 * Twitter card) for the nine pages that have a card of their own, in English, Polish and Spanish (27 files). It needs no server:
 * the card is an HTML page drawn with the Chromium that Playwright installs (the same browser the smoke test uses), like
 * scripts/generate-icons.mjs.
 *
 *   npm run og:cards                         all 27
 *   node scripts/generate-og-cards.mjs --locale pl --page gallery     one card (either flag alone narrows by that)
 *
 *  - The headline and the line under it come from the `Seo.card.<page>` messages of messages/<locale>.json (the copy rules of
 *    docs/COPY-STYLE.md: at most 42 and 80 characters), with {siteName} filled in. No number of modes or version is drawn: a
 *    committed picture would go stale with the next release.
 *  - The brand mark is public/icon.svg; the type is the site's own (src/fonts, Space Grotesk and Hanken Grotesk, with the latin-ext
 *    files Polish and Spanish need), embedded in the page because Chromium will not load file:// fonts into a page set from a string.
 *  - The design is flat on purpose (a few solid shapes, one gradient ball): each card stays well under the 150 KB the sharing
 *    sites are happy with. Text stays inside the central 1000x500 pixels that LinkedIn and WhatsApp keep when they crop.
 *  - src/lib/seo.ts (OG_CARD_PAGES) names the same pages; tests/seo.test.ts checks that the lists agree, that every card exists
 *    and is a 1200x630 PNG. public/og.png (scripts/generate-og.mjs, a screenshot of the simulator) stays the default card of the
 *    pages without one.
 * Run it after changing the copy, the icon or the design, and commit the PNGs. CHROME_PATH points at another Chromium.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p));

const LOCALES = ["en", "pl", "es"];
/** The pages with a card: OG_CARD_PAGES in src/lib/seo.ts. */
const PAGES = ["home", "simulator", "gallery", "download", "pricing", "about", "tiktok-ball-videos", "changelog", "press"];
const WIDTH = 1200;
const HEIGHT = 630;
const MAX_BYTES = 150 * 1024;

const SITE_NAME = /SITE_NAME = "([^"]+)"/.exec(read("src", "lib", "site.ts").toString("utf8"))?.[1] ?? "JumpingBallsLive";
/** What the card prints under the headline: the live address, without the scheme (OG_DOMAIN overrides it). */
const DOMAIN = (process.env.OG_DOMAIN || process.env.NEXT_PUBLIC_SITE_DOMAIN || "jumpingballslive.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");

// The site's colours (src/app/globals.css): page, text, second text, accent.
const BG = "#0b0b0d";
const INK = "#f2f2ed";
const INK_2 = "#a8a8b0";
const ACCENT = "#b0f02a";

const args = process.argv.slice(2);
const flag = (name) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};
const onlyLocale = flag("locale");
const onlyPage = flag("page");
if ((onlyLocale && !LOCALES.includes(onlyLocale)) || (onlyPage && !PAGES.includes(onlyPage))) {
  console.error(`generate-og-cards: unknown --locale or --page (locales: ${LOCALES.join(", ")}; pages: ${PAGES.join(", ")})`);
  process.exit(1);
}

/** The two subset files of a family as @font-face rules with the unicode-range src/app/fonts.ts uses (the browser takes the glyph from the right one). */
const LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";
function fontFaces(family, file, weights) {
  return [
    ["latin-ext", LATIN_EXT],
    ["latin", LATIN],
  ]
    .map(([subset, range]) => `@font-face{font-family:"${family}";font-weight:${weights};font-display:block;src:url(data:font/woff2;base64,${read("src", "fonts", `${file}-${subset}.woff2`).toString("base64")}) format("woff2");unicode-range:${range}}`)
    .join("");
}
const FONTS = fontFaces("OG Display", "space-grotesk", "300 700") + fontFaces("OG UI", "hanken-grotesk", "100 900");

const iconSvg = read("public", "icon.svg").toString("base64");
const ICON = `data:image/svg+xml;base64,${iconSvg}`;

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (text) => text.replaceAll("{siteName}", SITE_NAME);

// Rings behind the mark: solid flat circles, the faint echo of the ring the ball escapes from.
const ECHOES = [195, 265, 340, 420];
const echoRings = ECHOES.map((r, i) => `<circle cx="930" cy="315" r="${r}" fill="none" stroke="#18181c" stroke-width="${i % 2 ? 2 : 3}"/>`).join("");

function cardHtml({ title, sub }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${FONTS}
*{box-sizing:border-box}
html,body{margin:0;width:${WIDTH}px;height:${HEIGHT}px;background:${BG};overflow:hidden}
body{position:relative;color:${INK};font-family:"OG UI",sans-serif;-webkit-font-smoothing:antialiased}
svg.echo{position:absolute;inset:0}
.mark{position:absolute;left:690px;top:75px;width:480px;height:480px}
.brand{position:absolute;left:100px;top:72px;display:flex;align-items:center;gap:14px;font:700 28px/1 "OG Display",sans-serif;letter-spacing:-0.02em}
.brand img{width:44px;height:44px;display:block}
.copy{position:absolute;left:100px;top:150px;width:600px}
.bar{width:72px;height:8px;border-radius:4px;background:${ACCENT};margin-bottom:28px}
h1{margin:0;font:700 62px/1.05 "OG Display",sans-serif;letter-spacing:-0.025em;color:${INK}}
p{margin:22px 0 0;font:500 30px/1.32 "OG UI",sans-serif;color:${INK_2}}
.domain{position:absolute;left:100px;bottom:68px;font:600 26px/1 "OG UI",sans-serif;color:${ACCENT};letter-spacing:0.01em}
</style></head><body>
<svg class="echo" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" xmlns="http://www.w3.org/2000/svg">${echoRings}</svg>
<img class="mark" src="${ICON}" alt="">
<div class="brand"><img src="${ICON}" alt="">${escapeHtml(SITE_NAME)}</div>
<div class="copy"><div class="bar"></div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(sub)}</p></div>
<div class="domain">${escapeHtml(DOMAIN)}</div>
</body></html>`;
}

const launchOpts = {};
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  for (const locale of LOCALES) {
    if (onlyLocale && locale !== onlyLocale) continue;
    const messages = JSON.parse(read("messages", `${locale}.json`).toString("utf8"));
    const outDir = path.join(root, "public", "og", locale);
    fs.mkdirSync(outDir, { recursive: true });
    for (const name of PAGES) {
      if (onlyPage && name !== onlyPage) continue;
      const card = messages.Seo?.card?.[name];
      if (!card?.title || !card?.sub) {
        console.error(`generate-og-cards: messages/${locale}.json has no Seo.card.${name}.title and .sub`);
        failed = true;
        continue;
      }
      const title = fill(card.title);
      const sub = fill(card.sub);
      if ([...title].length > 42 || [...sub].length > 80) console.warn(`generate-og-cards: ${locale}/${name} is over the copy budget (headline 42, line 80): ${[...title].length} / ${[...sub].length}`);
      await page.setContent(cardHtml({ title, sub }));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
      // The headline keeps to three lines: a long one in a long language takes a smaller size rather than a fourth line.
      const fit = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        let size = 62;
        const lines = () => Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight));
        while (lines() > 3 && size > 48) {
          size -= 2;
          h1.style.fontSize = `${size}px`;
        }
        const box = document.querySelector(".copy").getBoundingClientRect();
        return { size, lines: lines(), bottom: box.bottom, right: box.right };
      });
      if (fit.lines > 3 || fit.bottom > 500) {
        console.error(`generate-og-cards: ${locale}/${name} does not fit (${fit.lines} lines, text ends at ${Math.round(fit.bottom)} px)`);
        failed = true;
      }
      const file = path.join(outDir, `${name}.png`);
      const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
      fs.writeFileSync(file, png);
      const kb = (png.length / 1024).toFixed(1);
      console.log(`generate-og-cards: wrote ${path.relative(root, file)} (${kb} KB, headline ${fit.size} px)`);
      if (png.length > MAX_BYTES) {
        console.error(`generate-og-cards: ${path.relative(root, file)} is ${kb} KB, over the ${MAX_BYTES / 1024} KB budget`);
        failed = true;
      }
    }
  }
} finally {
  await browser.close();
}
if (failed) process.exit(1);
