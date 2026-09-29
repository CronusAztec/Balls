/**
 * Renders a preview image for every game mode by running the real simulator in headless
 * Chromium and grabbing the canvas as WebP. Output: public/modes/<mode>.webp (640×360).
 *
 * Requires the exported site to be served (BASE_URL, default http://localhost:3000 plus
 * NEXT_PUBLIC_BASE_PATH; see `npm start`) and Playwright.
 * Run: node scripts/generate-mode-previews.mjs
 * MODES=drop,classic renders only those modes (e.g. the card image of a new mode without re-rendering the others).
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { loadDotEnv } from "./dotenv.mjs";

loadDotEnv();
const BASE = (process.env.BASE_URL || `http://localhost:3000${process.env.NEXT_PUBLIC_BASE_PATH || ""}`).replace(/\/+$/, "");
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
  drop: { wait: 7000, query: "dbc=16&dsi=0.2&dsv=0.7&glow=1" },
  box: { wait: 5500, query: "bxs=dvd&bxn=3&bxc=60&glow=1" },
  pendulum: { wait: 6000, query: "pwn=20&pwk=24&pwt=40&pwtr=0.5&glow=1" },
  polyrhythm: { wait: 4000, query: "prt=custom&prcu=3,4,5,6,7,8,9,10&prcs=12&prp=1&prnum=1&glow=1" }, // --- jdm-polyrhythm ---
  // --- jdm-collisions ---
  collide: { wait: 5000, query: "cpsq=1&glow=1" },
  // --- boris-glass --- mid-stage 3: sliding panes, holes, cracks and shards in view
  glass: { wait: 11500, query: "face=cute&glow=1" },
  // --- boris-multipliers ---
  multipliers: { wait: 3000, query: "mpsb=3&mprw=10" },
  // --- jdm-double-pendulum --- a fixed chaotic start: a long rainbow trail over the harp
  doublePendulum: { wait: 7000, query: "dprs=0&dpa1=150&dpa2=120&dptr=8&glow=1" },
  // --- jdm-illusions --- the white spaces mid-reveal: the painted arena, the painters and the hidden heart emerging
  illusion: { wait: 11000, query: "ilt=whitespace&ilpt=heart&glow=1" },
};
const only = process.env.MODES ? process.env.MODES.split(",").map((m) => m.trim()).filter(Boolean) : null;
const outDir = path.join(process.cwd(), "public", "modes");
fs.mkdirSync(outDir, { recursive: true });

const launchOpts = { args: ["--autoplay-policy=no-user-gesture-required"] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });

for (const [mode, cfg] of Object.entries(MODES)) {
  if (only && !only.includes(mode)) continue;
  await page.goto(`${BASE}/en/simulator/?mode=${mode}&wm=&${cfg.query}`, { waitUntil: "networkidle" });
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
