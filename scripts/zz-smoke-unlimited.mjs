/**
 * Headless browser smoke test against the exported site. Build and serve it first, e.g.
 *   NEXT_PUBLIC_BASE_PATH=/Balls NEXT_PUBLIC_SITE_URL=http://localhost:3000/Balls npm run build
 *   npm start -- --base /Balls            # serves ./out like GitHub Pages
 *   BASE_URL=http://localhost:3000/Balls npm run smoke
 *
 * It checks the root redirect, the 404 page, assets under the base path, opens every page in
 * every locale, starts the simulator in each mode, exercises the physics extras, the ball interactions, the Ball Drop
 * board, the Bouncing Shapes box, the Pendulum Wave rig, the sound features (hit samples, song slicer, instruments, background music bed) and Picture Paint (a
 * generated PNG revealed on the beat of a click track), records a short clip with the music bed, runs the seed
 * finder, submits the feedback form, switches language and reports console errors.
 */
import { chromium } from "playwright";
import fs from "fs";
import os from "os";
import path from "path";
import { loadDotEnv } from "./dotenv.mjs";

loadDotEnv();
const BASE = (process.env.BASE_URL || `http://localhost:3000${process.env.NEXT_PUBLIC_BASE_PATH || ""}`).replace(/\/+$/, "");
const MODES = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow", "drop", "box", "pendulum"];
const outDir = process.env.OUT_DIR || path.join(process.cwd(), "smoke-output");
fs.mkdirSync(outDir, { recursive: true });

const launchOpts = { args: ["--autoplay-policy=no-user-gesture-required"] };
if (process.env.CHROME_PATH) launchOpts.executablePath = process.env.CHROME_PATH;
const browser = await chromium.launch(launchOpts);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

/** A short 16-bit mono PCM WAV (sine sweep) for the song-slicer and music-bed upload checks. */
function makeWav(seconds = 2, sampleRate = 8000) {
  const frames = Math.round(seconds * sampleRate);
  const samples = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    samples[i] = Math.round(12000 * Math.sin(2 * Math.PI * (220 + 220 * t) * t));
  }
  return pcmWav(samples, sampleRate);
}

/** A click track (12 ms 1 kHz bursts on every beat, the first 0.25 s in) for the Picture Paint beat-detection check. */
function makeClickWav(seconds = 8, bpm = 120, sampleRate = 8000) {
  const frames = Math.round(seconds * sampleRate);
  const samples = new Int16Array(frames);
  for (let t = 0.25; t < seconds; t += 60 / bpm) {
    const start = Math.round(t * sampleRate);
    for (let j = 0; j < Math.round(0.012 * sampleRate) && start + j < frames; j++) {
      const tau = j / sampleRate;
      samples[start + j] = Math.round(28000 * Math.sin(2 * Math.PI * 1000 * tau) * Math.exp(-tau / 0.004));
    }
  }
  return pcmWav(samples, sampleRate);
}

function pcmWav(samples, sampleRate) {
  const frames = samples.length;
  const buf = Buffer.alloc(44 + 2 * frames);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + 2 * frames, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(2 * sampleRate, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(2 * frames, 40);
  for (let i = 0; i < frames; i++) buf.writeInt16LE(samples[i], 44 + 2 * i);
  return buf;
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "✅" : "❌"} ${name} ${extra}`);
};

/**
 * Frame-rate floors for the performance checks. Other builds and browser tests often share the
 * machine (CI runners, agent hosts); when the 1-minute load average exceeds the core count the
 * floor scales down in proportion (never below 8 fps) so a busy box does not fail a check that
 * measures the site rather than its neighbours. The measured numbers are always printed.
 */
const fpsFloor = (fps) => {
  const load = os.loadavg()[0];
  const cpus = os.cpus().length || 1;
  return load > cpus ? Math.max(8, Math.round((fps * cpus) / load)) : fps;
};
const loadNote = () => {
  const load = os.loadavg()[0];
  const cpus = os.cpus().length || 1;
  return load > cpus ? `, load ${load.toFixed(1)} on ${cpus} cores` : "";
};

/** Sets a React-controlled range input the way a user drag would (runs in the page). */
const setRangeValue = (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
};

/** Uploads the generated WAV as the background music track (the Sound section must be open) and waits for the panel to list it. */
const uploadMusicBed = async (seconds) => {
  await page.locator("#music-file-input").setInputFiles({ name: "smoke-bed.wav", mimeType: "audio/wav", buffer: makeWav(seconds) });
  return page.getByTestId("music-track").waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
};

// --- unlimited --- No limits: an extreme link – the switch on, 50,000 balls and a huge speed – opens with the crowd on the
// canvas and the "x… real time" badge (the frame budget slices the run), the page stays responsive (a click registers within
// 300 ms while the run crawls), the panel shows the switch on with the typed values, and a recording still downloads.
{
  await page.goto(`${BASE}/en/simulator/?mode=classic&inf=1&nb=50000&s=1000000&dur=10&res=500x500`, { waitUntil: "networkidle" });
  const unlimitedData = () => page.evaluate(() => ({ ...document.querySelector("main canvas").dataset }));
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  // The crowd appears with the run's first step (the Ball Count past the six team balls)…
  const spawned = await page
    .waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.unlimitedCrowd) > 0, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const first = await unlimitedData();
  // …and the huge speed makes the run crawl: the frame budget and the time dilation show as "x… real time".
  const sliced = await page
    .waitForFunction(() => {
      const d = document.querySelector("main canvas")?.dataset;
      return d?.unlimited === "1" && d.unlimitedSlow === "1";
    }, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const data = await unlimitedData();
  // Responsiveness under the load: the time from a real mouse click being issued to its event in the page.
  await page.evaluate(() => {
    window.__unlimitedClicks = [];
    document.addEventListener("pointerdown", () => window.__unlimitedClicks.push(performance.now()), { capture: true });
  });
  const sectionButton = page.getByRole("button", { name: /Ball & Physics/ });
  const box = await sectionButton.boundingBox();
  const latencies = [];
  for (let i = 0; i < 3 && box; i++) {
    const issued = await page.evaluate(() => performance.now());
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForFunction((n) => window.__unlimitedClicks.length > n, i, { timeout: 5000 }).catch(() => {});
    const at = await page.evaluate((n) => window.__unlimitedClicks[n] ?? NaN, i);
    latencies.push(at - issued);
  }
  const worstClick = Math.max(...latencies);
  // The Ball & Physics section is open (odd number of clicks): the switch is on and the speed input holds the typed value.
  const toggleOn = (await page.getByTestId("unlimited-toggle").getAttribute("aria-pressed").catch(() => null)) === "true";
  const speedInput = await page.locator('input[data-unlimited-input="ballSpeed"]').inputValue().catch(() => "");
  check(
    "no limits: an extreme link (50,000 balls, huge speed) runs time-sliced with the real-time badge and stays responsive",
    spawned && Number(first.unlimitedBalls) >= 45000 && sliced && Number(data.unlimitedRealtime) < 0.9 && latencies.length === 3 && worstClick < 300 && toggleOn && speedInput === "1000000",
    `(spawned=${spawned}, balls ${first.unlimitedBalls} → ${data.unlimitedBalls}, sliced=${sliced}, real time x${data.unlimitedRealtime}, lod ${first.unlimitedLod}, clicks ${latencies.map((l) => Math.round(l)).join("/")} ms, toggle ${toggleOn}, speed input "${speedInput}"${loadNote()})`,
  );
  // A recording of the extreme run still downloads.
  await page.getByRole("button", { name: /Restart/ }).first().click().catch(() => {});
  const extremeDownload = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(3500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ])
    .then(([dl]) => dl)
    .catch(() => null);
  let extremeBytes = 0;
  if (extremeDownload) {
    const file = path.join(outDir, `unlimited-${extremeDownload.suggestedFilename()}`);
    await extremeDownload.saveAs(file);
    extremeBytes = fs.statSync(file).size;
  }
  check("no limits: the extreme run records and downloads", extremeBytes > 10000, `(${extremeDownload?.suggestedFilename() ?? "no download"}, ${extremeBytes} bytes)`);
  // A ball bigger than the arena: THE BALL ATE THE ARENA ends the run (the outgrow finish, data-unlimited-ate).
  await page.goto(`${BASE}/en/simulator/?mode=classic&inf=1&r=100000`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const ate = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.unlimitedAte === "1", null, { timeout: 15000 }).then(() => true).catch(() => false);
  const ateData = await unlimitedData();
  check("no limits: a ball bigger than the arena eats it (the run ends with its banner)", ate && ateData.multOutgrew === "1", `(ate=${ate}, outgrew ${ateData.multOutgrew})`);
}

const hardErrors = errors.filter((e) => !/favicon|ERR_INTERNET|net::ERR|fonts.googleapis|fonts.gstatic|Failed to load resource/.test(e));
check("no console/page errors", hardErrors.length === 0, hardErrors.length ? `\n   ${hardErrors.slice(0, 10).join("\n   ")}` : "");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
