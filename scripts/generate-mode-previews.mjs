/**
 * --- mode-thumbnails --- Renders the picture of every mode card, public/modes/<mode>.webp: the mode at its hero moment – the
 * settings, seed, second and camera of its line in HERO_MOMENTS (src/lib/thumbnails/heroMoments.ts) – rendered by the real
 * simulator in headless Chromium through the page's still camera (window.__jumpingBallsStill: the fast export's offline,
 * deterministic canvas, so an entry gives the same picture on any machine, however busy), and framed the same way for
 * every card (src/lib/thumbnails/heroFrame.ts): a THUMB_SIZE square (2× the ~240 px card), the shared inset, vignette and
 * mode-coloured edge glow, WebP under THUMB_MAX_BYTES (60 KB) – the quality steps down until it fits. Each file's size is
 * printed; a mode of MODE_IDS without a hero moment (or a card on the served site without one) stops the run before
 * anything is written, so a new mode must add its line.
 *
 * Requires the exported site to be served (BASE_URL, default http://localhost:3000 plus NEXT_PUBLIC_BASE_PATH; see
 * `npm start`) and Playwright. Run: node scripts/generate-mode-previews.mjs (npm run previews)
 * MODES=drop,classic renders only those modes (e.g. the card picture of a new mode without re-rendering the others).
 * Picking a hero moment: SWEEP=2:14:1 (from:to:step seconds) with MODES=<mode> and optionally SEEDS=1,2,3 writes a
 * contact sheet per mode – a row per seed, a picture per second, framed like the cards – to OUT_DIR (default: the
 * system's temp folder) instead of public/modes; RAW=1 adds the whole world of each second, unframed (to place a camera),
 * EXTRA=<query> tries settings on top of the entry's and CAMERA=x,y,zoom another camera.
 *
 * --- daily-gallery --- The preset gallery's card images too: public/gallery/<id>.webp (640×360) for every card of the
 * served /en/gallery/ page (src/content/gallery.ts), each rendered from the card's query – its settings and pinned seed –
 * at the card's `previewAt` second. GALLERY=1 renders only the gallery, GALLERY=neon-escape,string-art only those cards;
 * with MODES set (and no GALLERY) only mode previews are rendered, with neither both are.
 */
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadDotEnv } from "./dotenv.mjs";
import { LICENSE_STORAGE_KEY, installLicenseScript, signTestLicense } from "./lib/test-license.mjs"; // --- mode-thumbnails ---

loadDotEnv();
const BASE = (process.env.BASE_URL || `http://localhost:3000${process.env.NEXT_PUBLIC_BASE_PATH || ""}`).replace(/\/+$/, "");
// --- mode-thumbnails --- the mode list and its hero moments come from the TypeScript the site and the tests use
// (src/lib/thumbnails/heroMoments.ts; the per-mode table that used to be here – query and wait – is HERO_MOMENTS now)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Bundles the hero table, the frame constants and MODE_IDS for Node with esbuild (a vitest dependency) and imports them. */
async function loadHeroModule() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    throw new Error("esbuild is not installed – run `npm install` (it comes with the dev dependencies).");
  }
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mode-thumbnails-")), "hero.mjs");
  await esbuild.build({
    stdin: {
      contents: 'export * from "./src/lib/thumbnails/heroMoments"; export * from "./src/lib/thumbnails/heroFrame"; export { MODE_IDS } from "./src/lib/physics/types";',
      resolveDir: ROOT,
      loader: "ts",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "error",
  });
  return import(pathToFileURL(outfile).href);
}

const hero = await loadHeroModule();
const missing = hero.missingHeroModes();
if (missing.length) {
  console.error(`No hero moment for ${missing.join(", ")}: add ${missing.length === 1 ? "its line" : "their lines"} to HERO_MOMENTS in src/lib/thumbnails/heroMoments.ts (settings, seed, second, camera, tint) – every mode card needs one.`);
  process.exit(1);
}
const only = process.env.MODES ? process.env.MODES.split(",").map((m) => m.trim()).filter(Boolean) : null;
const unknown = (only ?? []).filter((m) => !hero.MODE_IDS.includes(m));
if (unknown.length) {
  console.error(`MODES names no mode: ${unknown.join(", ")} (the modes: ${hero.MODE_IDS.join(", ")}).`);
  process.exit(1);
}
const modes = hero.MODE_IDS.filter((m) => !only || only.includes(m));
/** SWEEP=from:to:step (seconds): contact sheets for picking a hero moment instead of the card pictures. */
function parseSweep(text) {
  if (!text) return null;
  const [from, to, step] = text.split(":").map(Number);
  if (![from, to, step].every(Number.isFinite) || step <= 0 || to < from) throw new Error(`SWEEP=${text}: use from:to:step in seconds, e.g. SWEEP=2:14:1`);
  const times = [];
  for (let t = from; t <= to + 1e-9 && times.length < 60; t += step) times.push(Math.round(t * 1000) / 1000);
  return times;
}
const sweep = parseSweep(process.env.SWEEP);
const sweepSeeds = process.env.SEEDS ? process.env.SEEDS.split(",").map((s) => Number(s.trim())).filter(Number.isFinite) : null;
const sweepDir = path.resolve(process.env.OUT_DIR || path.join(os.tmpdir(), "mode-thumbnails-sweep"));
/** While sweeping, EXTRA=<query> tries settings on top of the hero query and CAMERA=x,y,zoom another camera. */
const sweepExtra = process.env.EXTRA ? process.env.EXTRA.replace(/^[?&]+/, "") : "";
const sweepCamera = process.env.CAMERA ? (([x, y, zoom]) => ({ x, y, zoom }))(process.env.CAMERA.split(",").map(Number)) : null;
// --- end mode-thumbnails ---
const galleryOnly = !!process.env.GALLERY && !process.env.MODES;
const galleryIds = process.env.GALLERY && !["1", "all", "true"].includes(process.env.GALLERY) ? process.env.GALLERY.split(",").map((m) => m.trim()).filter(Boolean) : null;
const renderGallery = (!!process.env.GALLERY || !process.env.MODES) && !sweep; // --- mode-thumbnails --- (a sweep renders no gallery)
const outDir = path.join(process.cwd(), "public", "modes");
fs.mkdirSync(outDir, { recursive: true });

const launchOpts = { args: ["--autoplay-policy=no-user-gesture-required"] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
// --- mode-thumbnails --- a Pro licence (signed with the committed TEST key, which a test-mode build accepts) before any page
// script runs, so nothing a free visitor's canvas might carry ends up in a card picture
const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(installLicenseScript, { key: LICENSE_STORAGE_KEY, token: signTestLicense({ sub: "previews@localhost", plan: "yearly", provider: "stripe", days: 2 }) });
const page = await context.newPage();
page.on("pageerror", (e) => console.warn(`  page error: ${e.message}`));

// --- mode-thumbnails --- the mode cards' pictures (or, with SWEEP, contact sheets for picking a hero moment)
/** Opens the simulator on `query`, waits for its world and its still camera, and checks the world the moments are tuned for. */
async function openStill(query) {
  await page.goto(`${BASE}/en/simulator/?${query}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => !!window.__jumpingBallsStill?.ready() && !!document.querySelector("main canvas")?.dataset.world, null, { timeout: 30000 }).catch(() => {
    throw new Error(`The simulator at ${BASE}/en/simulator/ has no still camera (window.__jumpingBallsStill) – build the site from this checkout and serve it first.`);
  });
  const world = await page.evaluate(() => document.querySelector("main canvas").dataset.world);
  const wanted = `${hero.HERO_WORLD.width}x${hero.HERO_WORLD.height}`;
  if (world !== wanted) throw new Error(`The stage runs a ${world} world; the hero moments are tuned for ${wanted} (a 1400 × 900 window's 16:9 stage).`);
}

/** The pictures of `request` (window.__jumpingBallsStill.capture), checked against the page's mode. */
async function capture(mode, request) {
  const result = await page.evaluate((r) => window.__jumpingBallsStill.capture(r), request);
  if (result.mode !== mode) throw new Error(`The page opened ${result.mode}, not ${mode} – does the hero query set another mode?`);
  return result;
}

/** A contact sheet (JPEG data URL) of labelled pictures, `cols` per row, drawn by the page. */
function contactSheet(cells, cols, cell) {
  return page.evaluate(
    async ({ cells, cols, cell }) => {
      const images = [];
      for (const c of cells) {
        const img = new Image();
        img.src = c.dataUrl;
        await img.decode();
        images.push(img);
      }
      const rows = Math.ceil(cells.length / cols);
      const label = 22;
      const height = Math.round(cell * (images[0].height / images[0].width));
      const canvas = document.createElement("canvas");
      canvas.width = cols * cell;
      canvas.height = rows * (height + label);
      const g = canvas.getContext("2d");
      g.fillStyle = "#111";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < cells.length; i++) {
        const x = (i % cols) * cell;
        const y = Math.floor(i / cols) * (height + label);
        g.drawImage(images[i], x, y + label, cell, height);
        g.fillStyle = "#e5e5e5";
        g.font = "14px monospace";
        g.fillText(cells[i].label, x + 6, y + 16);
      }
      return canvas.toDataURL("image/jpeg", 0.88);
    },
    { cells, cols, cell },
  );
}

const writeDataUrl = (file, dataUrl) => {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  fs.writeFileSync(file, buf);
  return buf.length;
};

// Every mode card of the served site needs a hero moment too (a card whose mode the table lacks stops the run).
if (!galleryOnly) {
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const cardModes = await page.$$eval('#modes img[src*="/modes/"]', (imgs) => imgs.map((img) => (/\/modes\/([^/.]+)\.webp/.exec(img.getAttribute("src") || "") || [])[1]).filter(Boolean));
  if (cardModes.length === 0) throw new Error(`No mode cards at ${BASE}/en/ – build the site and serve it first.`);
  const orphans = cardModes.filter((m) => !hero.HERO_MOMENTS[m]);
  if (orphans.length) {
    console.error(`The served site has mode cards without a hero moment: ${orphans.join(", ")} – add them to HERO_MOMENTS (src/lib/thumbnails/heroMoments.ts).`);
    await browser.close();
    process.exit(1);
  }
}
const results = [];
const failures = [];
for (const mode of galleryOnly ? [] : modes) {
  const entry = hero.HERO_MOMENTS[mode];
  try {
    if (sweep) {
      fs.mkdirSync(sweepDir, { recursive: true });
      const cells = [];
      const raws = [];
      for (const seed of sweepSeeds ?? [entry.seed]) {
        await openStill([hero.heroQuery(mode).replace(/(^|&)seed=[^&]*/, `$1seed=${seed}`), sweepExtra].filter(Boolean).join("&"));
        const r = await capture(mode, { times: sweep, camera: sweepCamera ?? entry.camera, tint: entry.tint, size: 320, format: "png", seed, raw: process.env.RAW === "1" });
        for (const f of r.frames) {
          cells.push({ label: `seed ${seed} · ${f.sec}s${f.finished ? " (over)" : ""}`, dataUrl: f.dataUrl });
          if (f.raw) raws.push({ label: `seed ${seed} · ${f.sec}s`, dataUrl: f.raw });
        }
      }
      const sheet = path.join(sweepDir, `${mode}-sweep.jpg`);
      writeDataUrl(sheet, await contactSheet(cells, Math.min(6, sweep.length), 320));
      console.log(`wrote ${sheet} (${cells.length} pictures)`);
      if (raws.length) {
        const rawSheet = path.join(sweepDir, `${mode}-raw.jpg`);
        writeDataUrl(rawSheet, await contactSheet(raws, Math.min(3, raws.length), 400));
        console.log(`wrote ${rawSheet}`);
      }
      continue;
    }
    await openStill(hero.heroQuery(mode));
    const r = await capture(mode, { times: [entry.atSec], camera: entry.camera, tint: entry.tint, size: hero.THUMB_SIZE, format: "webp", maxBytes: hero.THUMB_MAX_BYTES, seed: entry.seed });
    const frame = r.frames[0];
    if (!frame || !frame.dataUrl.startsWith("data:image/webp")) throw new Error("the page handed back no WebP picture");
    const bytes = writeDataUrl(path.join(outDir, `${mode}.webp`), frame.dataUrl);
    if (bytes >= hero.THUMB_MAX_BYTES) throw new Error(`${bytes} bytes, over the ${hero.THUMB_MAX_BYTES}-byte budget`);
    results.push({ mode, bytes, quality: frame.quality });
    console.log(`wrote public/modes/${mode}.webp (${(bytes / 1000).toFixed(1)} KB, WebP q${Math.round(100 * frame.quality)}, ${hero.THUMB_SIZE}×${hero.THUMB_SIZE}, seed ${r.seed} at ${frame.sec} s${frame.finished ? ", the run already over" : ""})`);
  } catch (err) {
    failures.push(mode);
    console.error(`✗ ${mode}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
if (results.length) {
  const total = results.reduce((n, r) => n + r.bytes, 0);
  const largest = results.reduce((a, b) => (b.bytes > a.bytes ? b : a));
  console.log(`${results.length} card picture${results.length === 1 ? "" : "s"}, ${(total / 1000).toFixed(1)} KB in all, the largest ${largest.mode} (${(largest.bytes / 1000).toFixed(1)} KB; the budget is ${hero.THUMB_MAX_BYTES / 1000} KB each).`);
}
if (failures.length) {
  await browser.close();
  console.error(`Failed: ${failures.join(", ")}.`);
  process.exit(1);
}
// --- end mode-thumbnails ---
// --- daily-gallery --- the gallery cards: read from the served gallery page, rendered from each card's query at its previewAt
if (renderGallery) {
  const galleryDir = path.join(process.cwd(), "public", "gallery");
  fs.mkdirSync(galleryDir, { recursive: true });
  await page.goto(`${BASE}/en/gallery/`, { waitUntil: "networkidle" });
  const cards = await page.$$eval("[data-gallery-card]", (els) => els.map((el) => ({ id: el.getAttribute("data-gallery-card"), query: el.getAttribute("data-gallery-query"), at: Number(el.getAttribute("data-preview-at")) })));
  if (cards.length === 0) throw new Error(`no gallery cards at ${BASE}/en/gallery/ – build and serve the site first`);
  for (const card of cards) {
    if (galleryIds && !galleryIds.includes(card.id)) continue;
    await page.goto(`${BASE}/en/simulator/?${card.query}&wm=`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(Math.round(1000 * (Number.isFinite(card.at) && card.at > 0 ? card.at : 5)));
    const dataUrl = await page.evaluate(() => {
      const canvas = document.querySelector("main canvas");
      const w = 640;
      const h = 360;
      const out = document.createElement("canvas");
      out.width = w;
      out.height = h;
      const g = out.getContext("2d");
      let cw = canvas.width;
      let ch = canvas.width / (w / h);
      if (ch > canvas.height) {
        ch = canvas.height;
        cw = canvas.height * (w / h);
      }
      g.drawImage(canvas, (canvas.width - cw) / 2, (canvas.height - ch) / 2, cw, ch, 0, 0, w, h);
      return out.toDataURL("image/webp", 0.85);
    });
    const buf = Buffer.from(dataUrl.split(",")[1], "base64");
    fs.writeFileSync(path.join(galleryDir, `${card.id}.webp`), buf);
    console.log(`wrote public/gallery/${card.id}.webp (${buf.length} bytes)`);
  }
}
// --- end daily-gallery ---
await browser.close();
