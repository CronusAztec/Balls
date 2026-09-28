/**
 * Renders a preview image for every game mode by running the real simulator in headless
 * Chromium and grabbing the canvas as WebP. Output: public/modes/<mode>.webp (640×360).
 *
 * Requires a running server (BASE_URL, default http://localhost:3000) and Playwright.
 * Run: node scripts/generate-mode-previews.mjs
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const MODES = {
  classic: { wait: 6000, query: "glow=1&wbreak=all" },
  accumulation: { wait: 9000, query: "spikes=1&at=3" },
  multiply: { wait: 7000, query: "rball=1&glow=1" },
  lines: { wait: 9000, query: "rlines=1&ldot=1" },
  paint: { wait: 12000, query: "r=14&g=100" },
  target: { wait: 6000, query: "" },
  portal: { wait: 7000, query: "glow=1" },
  shatter: { wait: 5000, query: "" },
  colorMatch: { wait: 8000, query: "" },
  grow: { wait: 12000, query: "glines=1&rlines=1&glow=1" },
};
const outDir = path.join(process.cwd(), "public", "modes");
fs.mkdirSync(outDir, { recursive: true });

const launchOpts = { args: ["--autoplay-policy=no-user-gesture-required"] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

for (const [mode, cfg] of Object.entries(MODES)) {
  await page.goto(`${BASE}/en/simulator?mode=${mode}&wm=&${cfg.query}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(cfg.wait);
  // Grab the canvas pixels directly (no HUD buttons) and crop to a 16:9 centre region.
  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const w = 640;
    const h = 360;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    const g = out.getContext("2d");
    const sw = canvas.width;
    const sh = canvas.height;
    const targetRatio = w / h;
    let cw = sw;
    let ch = sw / targetRatio;
    if (ch > sh) {
      ch = sh;
      cw = sh * targetRatio;
    }
    g.drawImage(canvas, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
    return out.toDataURL("image/webp", 0.85);
  });
  const buf = Buffer.from(dataUrl.split(",")[1], "base64");
  fs.writeFileSync(path.join(outDir, `${mode}.webp`), buf);
  console.log(`wrote public/modes/${mode}.webp (${buf.length} bytes)`);
}
await browser.close();
