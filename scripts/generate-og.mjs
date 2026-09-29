/**
 * Renders public/og.png, the 1200×630 social preview image (Open Graph / Twitter card): a screenshot of the
 * simulator page, taken from the exported site in headless Chromium a few seconds into the default run.
 *
 * Requires the exported site to be served (BASE_URL, default http://localhost:3000 plus NEXT_PUBLIC_BASE_PATH;
 * see `npm start`) and Playwright. Run: node scripts/generate-og.mjs
 */
import { chromium } from "playwright";
import path from "path";
import { loadDotEnv } from "./dotenv.mjs";

loadDotEnv();
const BASE = (process.env.BASE_URL || `http://localhost:3000${process.env.NEXT_PUBLIC_BASE_PATH || ""}`).replace(/\/+$/, "");
const OUT = path.resolve("public/og.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/en/simulator/?glow=1`, { waitUntil: "networkidle" });
  await page.waitForSelector("canvas");
  const start = page.getByRole("button", { name: /Start Simulator/ });
  if (await start.isVisible().catch(() => false)) await start.click();
  await page.waitForTimeout(4500); // a few rings drawn, the timer at ~4.5 s
  await page.screenshot({ path: OUT, type: "png", clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote ${OUT}`);
} finally {
  await browser.close();
}
