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

// 0. Static hosting: root redirect, 404 page, assets and sitemap under the base path
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForURL(/\/(en|pl|es)\/$/, { timeout: 10000 }).catch(() => {});
check("root redirects to a locale", /\/(en|pl|es)\/$/.test(page.url()), `(${page.url()})`);
{
  const res = await page.goto(`${BASE}/pl/this-page-does-not-exist/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.lang === "pl", null, { timeout: 5000 }).catch(() => {});
  const h1 = await page.locator("h1").first().innerText().catch(() => "");
  check("unknown URL serves localised 404", res.status() === 404 && (await page.evaluate(() => document.documentElement.lang)) === "pl" && h1.length > 0, `(${res.status()}, lang=${await page.evaluate(() => document.documentElement.lang)}, h1="${h1}")`);
}
for (const asset of ["/notes/fur-elise.mid", "/wallBreak/pop.wav", "/hitSounds/click.wav", "/hitSounds/kick.wav", "/modes/classic.webp", "/modes/drop.webp", "/modes/box.webp", "/modes/pendulum.webp", "/icon.svg", "/og.png", "/sitemap.xml", "/robots.txt", "/404.html"]) {
  const res = await page.request.get(`${BASE}${asset}`);
  check(`asset ${asset}`, res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
}
{
  const xml = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  check("sitemap uses site URL with trailing slashes", xml.includes(`${BASE}/en/simulator/`) && xml.includes(`${BASE}/es/blog/`), "");
}

// 1. Static pages in every locale
for (const locale of ["en", "pl", "es"]) {
  for (const p of ["", "/blog", "/about", "/tiktok-ball-videos", "/feedback", "/privacy", "/terms", "/disclaimer", "/blog/every-viralballs-mode-explained"]) {
    const res = await page.goto(`${BASE}/${locale}${p}/`, { waitUntil: "networkidle" });
    const h1 = await page.locator("h1").first().innerText().catch(() => "");
    check(`GET /${locale}${p}`, res.status() === 200 && h1.length > 0, `(${res.status()}, h1="${h1.slice(0, 40)}")`);
  }
}
await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
const previewImg = page.locator('img[src$="/modes/classic.webp"]').first();
await previewImg.scrollIntoViewIfNeeded();
const previewLoaded = await previewImg
  .evaluate((img) => (img.complete && img.naturalWidth > 0) || new Promise((r) => { img.onload = () => r(img.naturalWidth > 0); img.onerror = () => r(false); setTimeout(() => r(img.naturalWidth > 0), 5000); }))
  .catch(() => false);
check("mode preview image loads under base path", previewLoaded, `(src=${await previewImg.getAttribute("src")})`);
await page.screenshot({ path: path.join(outDir, "landing.png"), fullPage: true });

// 1b. Feedback form (static build: GitHub issue, email or endpoint channel)
await page.goto(`${BASE}/en/feedback/`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  window.__opened = [];
  window.open = (u) => {
    window.__opened.push(String(u));
    return {};
  };
});
await page.locator("#feedback-message").fill("Smoke test feedback message");
const submitBtn = page.locator('form button[type="submit"]');
const submitEnabled = await submitBtn.isEnabled();
if (submitEnabled) {
  await submitBtn.click();
  const ok = await page.getByText(/Thank you!/).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  const opened = await page.evaluate(() => window.__opened);
  check("feedback form submits", ok, `(opened: ${opened.map((u) => u.slice(0, 60)).join(", ") || "none"})`);
} else {
  check("feedback form explains missing channel", await page.getByRole("status").isVisible());
}

// 2. Simulator: every mode runs for a few seconds without errors and the ball moves.
for (const mode of MODES) {
  await page.goto(`${BASE}/en/simulator/?mode=${mode}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(2500);
  const time = await page.locator("span.tabular-nums").first().innerText();
  const modeLabel = await page.locator("main .rounded-lg.bg-zinc-800 span.font-medium").first().innerText().catch(() => "");
  check(`simulator mode=${mode} runs`, /\d/.test(time) && time !== "0.0s", `(elapsed ${time}, mode label "${modeLabel}")`);
  await page.screenshot({ path: path.join(outDir, `sim-${mode}.png`) });
}

// 3. Pause / restart shortcuts
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(800);
await page.keyboard.press("Space");
await page.waitForTimeout(300);
check("Space pauses", await page.getByRole("button", { name: /Resume/ }).isVisible());
await page.keyboard.press("Space");
await page.keyboard.press("KeyR");
await page.waitForTimeout(300);
check("R restarts (still running)", await page.getByRole("button", { name: /Pause/ }).isVisible());

// 4. Controls: search box, advanced options, preset save/load
await page.getByPlaceholder("Search settings...").fill("gravity");
check("search shows Gravity control", await page.locator('input[aria-label="Gravity"]').isVisible());
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: /Saved Presets/ }).click();
await page.getByPlaceholder("Preset name...").fill("smoke");
await page.getByRole("button", { name: "Save", exact: true }).click();
check("preset saved", await page.getByText("smoke", { exact: true }).isVisible());
const stored = await page.evaluate(() => localStorage.getItem("viralballs_saved_settings"));
check("preset persisted to localStorage", !!stored && stored.includes("smoke"));

// 4a. Custom hit sample: switch the bounce sound to a sample, pick a built-in clip, check the URL and that it decodes
await page.getByRole("button", { name: /Custom Sound/ }).click();
await page.getByRole("button", { name: /Audio sample/ }).click();
const hitSampleSelect = page.locator("#hit-sample-select");
check("hit sample controls appear in sample mode", await hitSampleSelect.isVisible() && (await page.locator('input[aria-label="Sample Volume"]').isVisible()));
await hitSampleSelect.selectOption("kick");
await page.waitForTimeout(1500);
check("hit sample settings mirrored into the URL", page.url().includes("hsm=sample") && page.url().includes("hs=kick"), `(${page.url().split("?")[1]})`);
// The "Pitch by Wall" toggle is the button right after its label (other toggles in the section read "On" as well).
await page.locator('label:has-text("Pitch by Wall") + button').click();
await page.waitForTimeout(200);
check("pitch-by-wall toggle mirrored into the URL", page.url().includes("hspw=0"), `(${page.url().split("?")[1]})`);
await page.getByRole("button", { name: /Synth tones/ }).click();
await page.waitForTimeout(200);
check("song picker returns in tones mode", (await page.locator("#song-select").isVisible()) && !page.url().includes("hsm="));

// 4a'. Song slicer (the Sound section is still open): upload a generated WAV, the panel shows it, slicing switches on
// (mirrored into the URL) and it can be removed
await page.locator("#slice-song-input").setInputFiles({ name: "smoke-song.wav", mimeType: "audio/wav", buffer: makeWav() });
const sliceFile = page.getByTestId("slice-song-file");
const sliceLoaded = await sliceFile.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
await page.waitForTimeout(1500); // a few bounces play slices through the audio graph
const sliceInfo = sliceLoaded ? await sliceFile.innerText() : "";
check("song slicer decodes an uploaded song", sliceLoaded && sliceInfo.includes("smoke-song.wav") && /0:02/.test(sliceInfo) && page.url().includes("slice=1"), `(${sliceInfo.replace(/\s+/g, " ").trim()} | ${page.url().split("?")[1]})`);

// 4a''. Pausing cuts the slice that is sounding and the song resumes from the cut point, not from the end of that
// slice. AudioBufferSourceNode.start/stop are instrumented: slices are the only sources started with an offset and
// a duration. Slices are made 1 s long so the pause lands well inside one.
await page.locator('input[aria-label="Slice Length"]').evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, "1000");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
await page.evaluate(() => {
  const proto = AudioBufferSourceNode.prototype;
  const log = { starts: [], stops: [] };
  window.__sliceLog = log;
  const start = proto.start;
  const stop = proto.stop;
  proto.start = function (when, offset, duration) {
    if (typeof duration === "number") log.starts.push({ when, offset, duration });
    return start.apply(this, arguments);
  };
  proto.stop = function (when) {
    log.stops.push(when);
    return stop.apply(this, arguments);
  };
});
const nextSliceAfter = (count) =>
  page
    .waitForFunction((n) => window.__sliceLog.starts.length > n, count, { polling: 10, timeout: 8000 })
    .then(() => true)
    .catch(() => false);
let pauseCase = null;
for (let attempt = 0; attempt < 5 && !pauseCase; attempt++) {
  const before = await page.evaluate(() => window.__sliceLog.starts.length);
  if (!(await nextSliceAfter(before))) break;
  await page.waitForTimeout(80); // pause clearly inside the slice
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Space");
  await page.waitForTimeout(400);
  const paused = await page.getByRole("button", { name: /Resume/ }).isVisible();
  const log = await page.evaluate(() => window.__sliceLog);
  const cut = log.starts[log.starts.length - 1];
  const stopAt = log.stops[log.stops.length - 1] ?? -1;
  // A usable capture: the pause faded out a slice that was still sounding (its stop is scheduled after its start and before its end).
  if (paused && cut && stopAt > cut.when + 0.03 && stopAt < cut.when + cut.duration) {
    const count = log.starts.length;
    await page.keyboard.press("Space");
    const resumed = await nextSliceAfter(count);
    const starts = await page.evaluate(() => window.__sliceLog.starts);
    pauseCase = { cut, stopAt, next: resumed ? starts[count] : null };
  } else {
    if (paused) await page.keyboard.press("Space"); // resume and try again with the next slice
    await page.waitForTimeout(300);
  }
}
const cutElapsed = pauseCase ? pauseCase.stopAt - pauseCase.cut.when : NaN; // includes the short cut fade
const nextOffset = pauseCase?.next?.offset ?? NaN;
check(
  "song slicer resumes from the pause point",
  !!pauseCase?.next && Math.abs(nextOffset - (pauseCase.cut.offset + cutElapsed)) < 0.03 && nextOffset < pauseCase.cut.offset + pauseCase.cut.duration - 0.05,
  pauseCase ? `(slice ${pauseCase.cut.offset.toFixed(3)}s+${pauseCase.cut.duration.toFixed(3)}s paused after ${cutElapsed.toFixed(3)}s, resumed at ${nextOffset.toFixed(3)}s)` : "(no slice could be cut by a pause)",
);
await page.getByRole("button", { name: "Remove song" }).click();
check("song slicer removes the song", (await sliceFile.count()) === 0 && (await page.locator("#slice-song-input").count()) === 1);
await page.getByRole("button", { name: /Custom Sound/ }).click();

// 4b. Text inputs keep focus while typing (helper components must not remount)
await page.getByRole("button", { name: /Recording/ }).click();
await page.getByLabel("Show Advanced Options").check();
const wm = page.locator("#watermark-input");
await wm.click();
await wm.press("Control+A");
await wm.pressSequentially("hello world", { delay: 30 });
check("typing keeps focus (watermark input)", (await wm.inputValue()) === "hello world", `(value="${await wm.inputValue()}")`);
await page.getByLabel("Show Advanced Options").uncheck();

// 4b'. Physics extras (the "Advanced physics" groups of the Ball and Wall sections): URL → sliders, slider → URL,
// the search box finds them and the run plays with all of them on
await page.goto(`${BASE}/en/simulator/?mode=classic&drag=0.01&wx=0.2&spin=0.5&wb=0.9&bw=0.1&bws=1.5&rg=30`, { waitUntil: "networkidle" });
await page.getByLabel("Show Advanced Options").check();
await page.getByRole("button", { name: /Ball & Physics/ }).click();
const sliderValue = (label) => page.locator(`input[aria-label="${label}"]`).inputValue();
{
  const values = { drag: await sliderValue("Air Drag"), wx: await sliderValue("Wind (Horizontal)"), wy: await sliderValue("Wind (Vertical)"), spin: await sliderValue("Spin"), rg: await sliderValue("Rotating Gravity") };
  check("physics extras load from URL (ball section)", values.drag === "0.01" && values.wx === "0.2" && values.wy === "0" && values.spin === "0.5" && values.rg === "30", `(${JSON.stringify(values)})`);
}
await page.locator('input[aria-label="Rotating Gravity"]').evaluate(setRangeValue, "45");
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  check("physics extras mirror into the URL", /(^|&)rg=45(&|$)/.test(query) && /(^|&)drag=0.01(&|$)/.test(query) && /(^|&)wx=0.2(&|$)/.test(query) && /(^|&)wb=0.9(&|$)/.test(query) && /(^|&)bws=1.5(&|$)/.test(query), `(${query})`);
}
await page.getByRole("button", { name: /Wall Settings/ }).click();
{
  const values = { wb: await sliderValue("Wall Bounciness"), bw: await sliderValue("Breathing Walls"), bws: await sliderValue("Breathing Speed") };
  check("physics extras load from URL (wall section)", values.wb === "0.9" && values.bw === "0.1" && values.bws === "1.5", `(${JSON.stringify(values)})`);
}
await page.getByPlaceholder("Search settings...").fill("wind");
check("search finds the wind controls", (await page.locator('input[aria-label="Wind (Horizontal)"]').isVisible()) && (await page.locator('input[aria-label="Wind (Vertical)"]').isVisible()) && !(await page.locator('input[aria-label="Air Drag"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(2500);
{
  const time = await page.locator("span.tabular-nums").first().innerText();
  check("simulator runs with the physics extras on", /\d/.test(time) && time !== "0.0s", `(elapsed ${time})`);
}
await page.getByLabel("Show Advanced Options").uncheck();

// 4b''. Merge & split balls (the "Ball Interaction" block of the Ball section): URL → controls, controls → URL, the split
// limits only show in split mode (but the search box still finds them) and the run plays with splitting on
await page.goto(`${BASE}/en/simulator/?mode=classic&bi=split&smr=6&mb=12`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Ball & Physics/ }).click();
const interactionGroup = page.getByRole("group", { name: "Ball Interaction" });
{
  const pressed = await interactionGroup.getByRole("button", { name: "Split", exact: true }).getAttribute("aria-pressed");
  const values = { smr: await sliderValue("Smallest Split Ball"), mb: await sliderValue("Ball Cap") };
  check("ball interaction loads from URL", pressed === "true" && values.smr === "6" && values.mb === "12", `(split pressed=${pressed}, ${JSON.stringify(values)})`);
}
await interactionGroup.getByRole("button", { name: "Merge", exact: true }).click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  const splitSlidersHidden = (await page.locator('input[aria-label="Ball Cap"]').count()) === 0;
  check("ball interaction mirrors into the URL", /(^|&)bi=merge(&|$)/.test(query) && /(^|&)smr=6(&|$)/.test(query) && /(^|&)mb=12(&|$)/.test(query) && splitSlidersHidden, `(${query}, split sliders hidden=${splitSlidersHidden})`);
}
await page.getByPlaceholder("Search settings...").fill("ball cap");
check("search finds the split limits in merge mode", (await page.locator('input[aria-label="Ball Cap"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await interactionGroup.getByRole("button", { name: "Split", exact: true }).click();
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(3000);
{
  const time = await page.locator("span.tabular-nums").first().innerText();
  const query = page.url().split("?")[1] || "";
  check("simulator runs with ball splitting on", /\d/.test(time) && time !== "0.0s" && /(^|&)bi=split(&|$)/.test(query), `(elapsed ${time}, ${query})`);
}

// 4b'''. Ball Drop (the mode without rings): URL → the board controls in the Mode row, controls → URL, Rain hides the
// seed finder, the search box finds the board controls, and the run plays with obstacles and size-pitched hit sounds
// (OscillatorNode.start is instrumented: the 1 Hz keep-alive oscillator is never a bounce sound)
await page.goto(`${BASE}/en/simulator/?mode=drop&dbc=6&drows=4&dsi=0&dloop=1`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__oscLog = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    if (this.frequency.value !== 1) log.push(this.frequency.value);
    return start.apply(this, arguments);
  };
});
{
  const values = { dbc: await sliderValue("Ball Count"), drows: await sliderValue("Peg Rows"), dsi: await sliderValue("Release Interval") };
  const rain = await page.locator('label:has-text("Rain (Loop)") + button').getAttribute("aria-pressed");
  const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  check("ball drop loads from URL", values.dbc === "6" && values.drows === "4" && values.dsi === "0" && rain === "true" && finderHidden, `(${JSON.stringify(values)}, rain=${rain}, finder hidden=${finderHidden})`);
}
await page.locator('input[aria-label="Peg Rows"]').evaluate(setRangeValue, "6");
await page.locator('label:has-text("Rain (Loop)") + button').click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
  check("ball drop mirrors into the URL", /(^|&)drows=6(&|$)/.test(query) && /(^|&)dbc=6(&|$)/.test(query) && !/(^|&)dloop=/.test(query) && finderShown, `(${query}, finder shown=${finderShown})`);
}
await page.getByPlaceholder("Search settings...").fill("peg rows");
check("search finds the ball drop controls", (await page.locator('input[aria-label="Peg Rows"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(3500);
{
  const time = await page.locator("span.tabular-nums").first().innerText();
  const pitches = await page.evaluate(() => window.__oscLog);
  const distinct = new Set(pitches.map((f) => Math.round(f))).size;
  const inRange = pitches.every((f) => f >= 110 && f <= 1760);
  check("simulator runs the ball drop board with size-pitched hit sounds", /\d/.test(time) && time !== "0.0s" && distinct >= 2 && inRange, `(elapsed ${time}, ${pitches.length} tones, ${distinct} distinct pitches)`);
  await page.screenshot({ path: path.join(outDir, "sim-drop-board.png") });
}

// 4b''''. An overfull Ball Drop board – 40 balls of size 30 at full size spread, more than the board can hold – still
// finishes: the pile above the top counts as resting and a release that finds no room ends the run with the balls that
// fit, so the finished overlay (Restart Simulation) appears; at 8× the pile settles within a few seconds of real time.
await page.goto(`${BASE}/en/simulator/?mode=drop&dbc=40&dsv=1&dsi=0&r=30`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const restart = page.getByRole("button", { name: /Restart Simulation/ });
  let finished = false;
  try {
    await restart.waitFor({ state: "visible", timeout: 60_000 });
    finished = true;
  } catch {
    finished = false;
  }
  const time = await page.locator("span.tabular-nums").first().innerText();
  check("overfull ball drop board still settles and finishes", finished, `(elapsed ${time})`);
  await page.screenshot({ path: path.join(outDir, "sim-drop-overfull.png") });
}

// 4b'''''. Bouncing Shapes (the box arena): URL → the Box arena controls in the Mode row, controls → URL, the countdown
// switched off hides the seed finder, the search box finds the controls, and the run plays one of the four wall notes
// per hit (OscillatorNode.start is instrumented again; the canvas mirrors the hit count into data-box-hits)
await page.goto(`${BASE}/en/simulator/?mode=box&bxs=dvd&bxn=2&bxr=2%3A3&bxc=0&bxgr=2`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__oscLog = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    if (this.frequency.value !== 1) log.push(this.frequency.value);
    return start.apply(this, arguments);
  };
});
{
  const values = { bxn: await sliderValue("Shape Count"), bxc: await sliderValue("Countdown"), bxgr: await sliderValue("Grow Per Hit") };
  const dvd = await page.getByRole("group", { name: "Shape", exact: true }).getByRole("button", { name: /DVD logo/ }).getAttribute("aria-pressed");
  const ratio = await page.getByRole("group", { name: "Speed Ratio" }).getByRole("button", { name: "2:3", exact: true }).getAttribute("aria-pressed");
  const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
  check("bouncing shapes load from URL", values.bxn === "2" && values.bxc === "0" && values.bxgr === "2" && dvd === "true" && ratio === "true" && finderHidden && noRingControls, `(${JSON.stringify(values)}, dvd=${dvd}, 2:3=${ratio}, finder hidden=${finderHidden})`);
}
await page.locator('input[aria-label="Countdown"]').evaluate(setRangeValue, "12");
await page.getByRole("group", { name: "Shape", exact: true }).getByRole("button", { name: /Square/ }).click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
  check("bouncing shapes mirror into the URL", /(^|&)bxc=12(&|$)/.test(query) && /(^|&)bxn=2(&|$)/.test(query) && /(^|&)bxr=2(%3A|:)3(&|$)/.test(query) && !/(^|&)bxs=/.test(query) && finderShown, `(${query}, finder shown=${finderShown})`);
}
await page.getByPlaceholder("Search settings...").fill("speed ratio");
check("search finds the bouncing shapes controls", (await page.getByRole("group", { name: "Speed Ratio" }).isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(3500);
{
  const time = await page.locator("span.tabular-nums").first().innerText();
  const pitches = await page.evaluate(() => window.__oscLog);
  const hits = Number(await page.locator("canvas").first().getAttribute("data-box-hits"));
  const wallNotes = new Set([523, 659, 784, 1047]);
  const distinct = new Set(pitches.map((f) => Math.round(f)));
  const onWallNotes = pitches.length > 0 && [...distinct].every((f) => wallNotes.has(f));
  check("simulator runs the box arena with one note per wall", /\d/.test(time) && time !== "0.0s" && hits >= 4 && onWallNotes && distinct.size >= 2, `(elapsed ${time}, ${hits} hits, ${pitches.length} tones, pitches ${[...distinct].join("/")})`);
  await page.screenshot({ path: path.join(outDir, "sim-box-arena.png") });
}

// 4b''''''. A DVD logo reaches a corner in every seed (odd axis ratio + corner lock): the first corner comes within its
// first few hits and the canvas mirrors the count into data-box-corners
await page.goto(`${BASE}/en/simulator/?mode=box&bxs=dvd&bxn=1&bxc=0`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  let corners = 0;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    corners = Number(await page.locator("canvas").first().getAttribute("data-box-corners"));
    if (corners >= 1) break;
    await page.waitForTimeout(250);
  }
  const hits = Number(await page.locator("canvas").first().getAttribute("data-box-hits"));
  check("dvd logo reaches a corner", corners >= 1 && hits <= 12, `(${corners} corner(s) after ${hits} hits)`);
  await page.screenshot({ path: path.join(outDir, "sim-box-corner.png") });
}

// 4b'''''''. The seed finder works for Bouncing Shapes: the seeded tempo makes the run length continuous, so "Find 30s
// Simulation" finds a seed once the target is inside the ±15 % band. The band scales with the box on screen (the shapes
// move in px/s), so when 30 s is out of reach at this viewport the check does what the "closest" message tells a user
// to do – scales the countdown accordingly – and searches once more.
await page.goto(`${BASE}/en/simulator/?mode=box`, { waitUntil: "networkidle" });
{
  const runFinder = async () => {
    await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
    const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 90_000 }).then(() => true).catch(() => false);
    return done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  };
  let text = await runFinder();
  let countdown = 30;
  if (!/Found!/.test(text)) {
    const closestText = await page.getByText(/Closest/).first().innerText().catch(() => "");
    const closest = Number((closestText.match(/([\d.]+)s/) || [])[1]);
    if (closest > 0) {
      countdown = Math.max(1, Math.min(99, Math.round((30 * 30) / closest)));
      await page.locator('input[aria-label="Countdown"]').evaluate(setRangeValue, String(countdown));
      await page.waitForTimeout(300);
      text = await runFinder();
    }
    text += ` [closest ${closest}s → countdown ${countdown}]`;
  }
  check("find simulation finds a 30 s bouncing shapes run", /Found! (29\.[5-9]|30\.[0-5])s/.test(text), `(${text})`);
}

// 4b''. Pendulum Wave: URL → the Pendulum wave controls in the Mode row, controls → URL, the cycles at "never" hide
// the seed finder, the search box finds the controls, a fixed-length run makes the finder say so instead of testing seeds,
// and the run plays scale-degree notes and chords (OscillatorNode.start is instrumented again; the canvas mirrors the
// counts into data-pendulum-notes / data-pendulum-chords), keeps going through a trails change and falls silent once finished
await page.goto(`${BASE}/en/simulator/?mode=pendulum&pwl=arc&pwn=8&pwk=6&pwt=12&pwc=0&pws=both`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__oscLog = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    if (this.frequency.value !== 1) log.push(this.frequency.value);
    return start.apply(this, arguments);
  };
});
{
  const values = { pwn: await sliderValue("Pendulums"), pwk: await sliderValue("Base Swings"), pwt: await sliderValue("Cycle Length"), pwc: await sliderValue("Cycles") };
  const arc = await page.getByRole("group", { name: "Layout", exact: true }).getByRole("button", { name: /Arc/ }).getAttribute("aria-pressed");
  const both = await page.getByRole("group", { name: "Play a Note" }).getByRole("button", { name: "Both", exact: true }).getAttribute("aria-pressed");
  const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
  check("pendulum wave loads from URL", values.pwn === "8" && values.pwk === "6" && values.pwt === "12" && values.pwc === "0" && arc === "true" && both === "true" && finderHidden && noRingControls, `(${JSON.stringify(values)}, arc=${arc}, both=${both}, finder hidden=${finderHidden})`);
}
await page.locator('input[aria-label="Cycles"]').evaluate(setRangeValue, "2");
await page.getByRole("group", { name: "Layout", exact: true }).getByRole("button", { name: /Circle/ }).click();
await page.getByRole("group", { name: "Polygon" }).getByRole("button", { name: "5", exact: true }).click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
  check("pendulum wave mirrors into the URL", /(^|&)pwc=2(&|$)/.test(query) && /(^|&)pwl=circle(&|$)/.test(query) && /(^|&)pwp=5(&|$)/.test(query) && /(^|&)pwn=8(&|$)/.test(query) && !/(^|&)pwa=/.test(query) && finderShown, `(${query}, finder shown=${finderShown})`);
}
await page.getByPlaceholder("Search settings...").fill("wave chord");
check("search finds the pendulum wave controls", (await page.getByText("Wave Chord").first().isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
// Two cycles of 12 s always last 24 s: the finder says so at once instead of testing seeds.
await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
{
  const shown = await page.getByText(/always lasts exactly 24\.0s/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("finder explains a fixed-length pendulum run", shown);
  if (shown) await page.getByRole("button", { name: "Try again", exact: true }).click();
}
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(4000);
{
  const time = await page.locator("span.tabular-nums").first().innerText();
  const pitches = await page.evaluate(() => window.__oscLog);
  const notes = Number(await page.locator("canvas").first().getAttribute("data-pendulum-notes"));
  const chords = Number(await page.locator("canvas").first().getAttribute("data-pendulum-chords"));
  // Every pitch is a degree of C major between C4 and C7 (the chromatic default leaves them unsnapped).
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const onScale = pitches.length > 0 && midis.every((m) => m >= 60 && m <= 96 && [0, 2, 4, 5, 7, 9, 11].includes(m % 12));
  const distinct = new Set(midis);
  check("simulator runs the pendulum wave with scale-degree notes and chords", /\d/.test(time) && time !== "0.0s" && notes >= 8 && chords >= 1 && onScale && distinct.size >= 4, `(elapsed ${time}, ${notes} notes, ${chords} chords, ${pitches.length} tones, ${distinct.size} distinct degrees)`);
  await page.screenshot({ path: path.join(outDir, "sim-pendulum.png") });
}
// The trails only change the drawing: the run goes on (the note count keeps growing instead of starting over).
{
  const canvas = page.locator("canvas").first();
  const before = Number(await canvas.getAttribute("data-pendulum-notes"));
  await page.locator('input[aria-label="Trails"]').evaluate(setRangeValue, "0.8");
  await page.waitForTimeout(500);
  const after = Number(await canvas.getAttribute("data-pendulum-notes"));
  check("a pendulum trails change keeps the run going", before > 0 && after >= before, `(${before} → ${after} notes)`);
}
// Two cycles later the run finishes and the row holds its final alignment in silence under the end screen.
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const canvas = page.locator("canvas").first();
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const notes = Number(await canvas.getAttribute("data-pendulum-notes"));
  const tones = await page.evaluate(() => window.__oscLog.length);
  await page.waitForTimeout(1500);
  const notesLater = Number(await canvas.getAttribute("data-pendulum-notes"));
  const tonesLater = await page.evaluate(() => window.__oscLog.length);
  const cycles = await canvas.getAttribute("data-pendulum-cycles");
  check("a finished pendulum wave holds its alignment in silence", done && cycles === "2" && notes > 0 && notesLater === notes && tonesLater === tones, `(finished=${done}, cycles ${cycles}, notes ${notes} → ${notesLater}, tones ${tones} → ${tonesLater})`);
}

// 4c. Instruments, scales and beat lock (Sound section): URL → controls, controls → URL, and the run still plays
await page.goto(`${BASE}/en/simulator/?mode=classic&inst=marimba&scale=minor&root=9&qz=1&bpm=140&grid=1%2F16`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Custom Sound/ }).click();
{
  const inst = await page.locator("#instrument-select").inputValue();
  const scale = await page.locator("#scale-select").inputValue();
  const bpm = await page.locator('input[aria-label="BPM"]').inputValue();
  const rootPressed = await page.getByRole("group", { name: "Root note" }).getByRole("button", { name: "A", exact: true }).getAttribute("aria-pressed");
  const gridPressed = await page.getByRole("group", { name: "Grid" }).getByRole("button", { name: "1/16", exact: true }).getAttribute("aria-pressed");
  check("music settings load from URL", inst === "marimba" && scale === "minor" && bpm === "140" && rootPressed === "true" && gridPressed === "true", `(inst=${inst}, scale=${scale}, bpm=${bpm}, root A=${rootPressed}, grid 1/16=${gridPressed})`);
}
await page.locator("#instrument-select").selectOption("pluck");
await page.locator("#scale-select").selectOption("pentatonic");
await page.getByRole("group", { name: "Grid" }).getByRole("button", { name: "1/4", exact: true }).click();
await page.waitForTimeout(300);
check("music settings mirror into URL", /inst=pluck/.test(page.url()) && /scale=pentatonic/.test(page.url()) && /grid=1%2F4/.test(page.url()) && /qz=1/.test(page.url()), `(${page.url().split("?")[1]})`);
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(2500);
{
  const time = await page.locator("span.tabular-nums").first().innerText();
  check("simulator runs with pluck + pentatonic + beat lock", /\d/.test(time) && time !== "0.0s", `(elapsed ${time})`);
}
await page.getByPlaceholder("Search settings...").fill("beat");
check("search finds the beat lock", (await page.getByText("Beat lock (BPM)").isVisible()) && (await page.locator('input[aria-label="BPM"]').isVisible()) && !(await page.locator("#instrument-select").isVisible()));
await page.getByPlaceholder("Search settings...").fill("");

// 4d. The three sound features together: mode-only controls stay searchable whatever the current mode is, an
// undecodable hit sample shows an error state instead of silently playing the tones, and a melody keeps its own voice
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.getByPlaceholder("Search settings...").fill("hit sample");
check("search finds the hit sample picker in tones mode", (await page.locator("#hit-sample-select").isVisible()) && !(await page.locator("#song-select").isVisible()));
await page.getByPlaceholder("Search settings...").fill("root");
check("search finds the root note with the chromatic scale", await page.getByRole("group", { name: "Root note" }).isVisible());
await page.getByPlaceholder("Search settings...").fill("grid");
check("search finds the beat grid with the lock off", await page.getByRole("group", { name: "Grid" }).isVisible());
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: /Custom Sound/ }).click();
await page.getByRole("button", { name: /Audio sample/ }).click();
await page.locator("#hit-sample-input").setInputFiles({ name: "not-audio.wav", mimeType: "audio/wav", buffer: Buffer.from("definitely not audio data, just text") });
const hitSampleError = page.getByTestId("hit-sample-error");
const hitErrorShown = await hitSampleError.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
check("undecodable hit sample shows an error state", hitErrorShown && (await page.locator("#hit-sample-select").inputValue()) === "custom", `(${hitErrorShown ? (await hitSampleError.innerText()).slice(0, 60) : "no error shown"})`);
await page.locator("#hit-sample-select").selectOption("click");
check("built-in hit sample clears the error state", await hitSampleError.waitFor({ state: "detached", timeout: 10000 }).then(() => true).catch(() => false));
await page.getByRole("button", { name: /Synth tones/ }).click();
await page.locator("#song-select").selectOption({ index: 1 });
const melodySelect = page.locator("#melody-instrument-select");
const melodyShown = await melodySelect.waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
check("melody gets its own instrument (sine by default)", melodyShown && (await melodySelect.inputValue()) === "sine" && (await page.locator("#instrument-select").inputValue()) === "triangle");
await melodySelect.selectOption("marimba");
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  check("melody instrument mirrored into the URL", /(^|&)minst=marimba(&|$)/.test(query) && !/(^|&)inst=/.test(query), `(${query})`);
}
await page.waitForTimeout(1500); // a few melody notes play through the marimba voice
await page.getByRole("button", { name: /Custom Sound/ }).click();

// 4e. Background music bed: upload a track in the Sound section, the panel lists it with its length, the mix controls
// appear and the volume reaches the URL. AudioBufferSourceNode.start is instrumented: the bed is the only source
// started as `start(0, offset)` (two arguments), so its starts show when it plays, from where, and whether it loops.
// The bed waits for the run, starts with it, pauses with Space, resumes from the pause position, restarts with R,
// keeps pause/resume working after Loop is switched off on a track that has already wrapped, and the track can be
// removed.
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__bedLog = log;
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (when, offset) {
    if (arguments.length === 2) log.push({ when, offset, loop: this.loop });
    return start.apply(this, arguments);
  };
});
await page.getByRole("button", { name: /Custom Sound/ }).click();
const musicTrack = page.getByTestId("music-track");
const musicLoaded = await uploadMusicBed(4);
const musicInfo = musicLoaded ? await musicTrack.innerText() : "";
check("music bed decodes an uploaded track", musicLoaded && musicInfo.includes("smoke-bed.wav") && /0:04/.test(musicInfo), `(${musicInfo.replace(/\s+/g, " ").trim()})`);
const musicVolume = page.locator('input[aria-label="Music Volume"]');
check("music bed controls appear with a track", (await musicVolume.isVisible()) && (await page.locator('input[aria-label="Ducking"]').isVisible()) && (await page.getByTestId("music-duck-meter").isVisible()));
await musicVolume.evaluate(setRangeValue, "0.3");
await page.waitForTimeout(200);
check("music volume mirrored into the URL", /(^|&)mv=0.3(&|$)/.test(page.url().split("?")[1] || ""), `(${page.url().split("?")[1]})`);
check("music bed waits for the run", (await page.evaluate(() => window.__bedLog.length)) === 0 && (await page.getByTestId("music-playing").count()) === 0);
await page.getByRole("button", { name: /Start Simulator/ }).click();
const musicPlaying = await page.getByTestId("music-playing").waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
const bedFirstStart = await page.evaluate(() => window.__bedLog[0] ?? null);
check("music bed starts with the run and loops", musicPlaying && !!bedFirstStart && bedFirstStart.offset === 0 && bedFirstStart.loop === true, `(${JSON.stringify(bedFirstStart)})`);
await page.waitForTimeout(1200);
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("Space");
await page.waitForTimeout(400);
check("music bed pauses with the run", (await page.getByRole("button", { name: /Resume/ }).isVisible()) && (await page.getByTestId("music-playing").count()) === 0);
await page.keyboard.press("Space");
const bedResumed = await page.getByTestId("music-playing").waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
const bedSecondStart = await page.evaluate(() => window.__bedLog[1] ?? null);
check("music bed resumes from the pause position", bedResumed && !!bedSecondStart && bedSecondStart.offset > 0.8 && bedSecondStart.offset < 4, `(resumed at ${bedSecondStart ? bedSecondStart.offset.toFixed(2) : "?"}s)`);
await page.keyboard.press("KeyR");
await page.waitForTimeout(300);
const bedThirdStart = await page.evaluate(() => window.__bedLog[2] ?? null);
check("R restarts the music bed from the start offset", !!bedThirdStart && bedThirdStart.offset === 0 && (await page.getByTestId("music-playing").isVisible()), `(${JSON.stringify(bedThirdStart)})`);

// 4e'. Switching Loop off on a track that has already wrapped must not break pause/resume: the looping source's
// playhead is (start + elapsed) % duration, so the bed has to resume from that wrapped position (below the track
// length) instead of treating the track as finished. The run restarted from 0 with R a moment ago.
await page.waitForTimeout(4400); // the 4 s track wraps
const loopToggle = page.locator('label:has-text("Loop Music") + button');
await loopToggle.click();
await page.waitForTimeout(300);
const loopOff = (await loopToggle.getAttribute("aria-pressed")) === "false";
const soundingAfterLoopOff = await page.getByTestId("music-playing").isVisible(); // the source had not ended
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press("Space");
await page.waitForTimeout(400);
const pausedAfterLoopOff = (await page.getByRole("button", { name: /Resume/ }).isVisible()) && (await page.getByTestId("music-playing").count()) === 0;
await page.keyboard.press("Space");
const bedResumedUnlooped = await page.getByTestId("music-playing").waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
const bedFourthStart = await page.evaluate(() => window.__bedLog[3] ?? null);
check(
  "music bed resumes from the wrapped position after Loop is switched off",
  loopOff && soundingAfterLoopOff && pausedAfterLoopOff && bedResumedUnlooped && !!bedFourthStart && bedFourthStart.loop === false && bedFourthStart.offset > 0 && bedFourthStart.offset < 4,
  `(loop off=${loopOff}, sounding=${soundingAfterLoopOff}, paused=${pausedAfterLoopOff}, resumed=${bedResumedUnlooped}, start=${JSON.stringify(bedFourthStart)})`,
);
await loopToggle.click(); // back to looping for the checks that follow
await page.waitForTimeout(200);
await page.getByRole("button", { name: "Remove music" }).click();
await page.waitForTimeout(200);
check("music bed removes the track", (await musicTrack.count()) === 0 && (await page.locator("#music-file-input").count()) === 1 && (await page.getByTestId("music-playing").count()) === 0);
await page.getByPlaceholder("Search settings...").fill("ducking");
check("search finds the ducking control without a track", await page.locator('input[aria-label="Ducking"]').isVisible());
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: /Custom Sound/ }).click();

// 4f. Picture Paint: a PNG generated in the page (canvas.toDataURL → File via DataTransfer) is uploaded as the picture
// of Paint mode; a click-track music bed gets its tempo detected (the readout shows 120 BPM); the run reveals the
// picture – the canvas mirrors the coverage % the HUD draws into data-paint-coverage, and the red pixels of the picture
// multiply inside the arena – and exposes the HUD state (schedule + beat); the settings reach the URL; the search box
// finds the controls; removing the picture returns to the classic Paint trail (the MODES loop above already runs it).
await page.goto(`${BASE}/en/simulator/?mode=paint`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 200;
  const g = c.getContext("2d");
  g.fillStyle = "#ff2020";
  g.fillRect(0, 0, 200, 200);
  g.fillStyle = "#ffffff";
  g.fillRect(70, 70, 60, 60);
  const bytes = atob(c.toDataURL("image/png").split(",")[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const dt = new DataTransfer();
  dt.items.add(new File([arr], "smoke-picture.png", { type: "image/png" }));
  const input = document.querySelector("#paint-picture-input");
  input.files = dt.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
});
const paintPicture = page.getByTestId("paint-picture");
const pictureLoaded = await paintPicture.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
check("picture paint accepts a PNG generated in the page", pictureLoaded && (await paintPicture.innerText()).includes("smoke-picture.png"));
const bpmReadout = page.getByTestId("paint-detected-bpm");
{
  const text = await bpmReadout.innerText();
  check("picture paint asks for a song before a beat is known", text.length > 0 && !/\d+ BPM/.test(text), `(${text.slice(0, 60)})`);
}
await page.getByRole("button", { name: /Custom Sound/ }).click();
await page.locator("#music-file-input").setInputFiles({ name: "smoke-click.wav", mimeType: "audio/wav", buffer: makeClickWav(8, 120) });
await page.getByTestId("music-track").waitFor({ timeout: 15000 }).catch(() => {});
const bpmDetected = await page
  .waitForFunction(() => /120 BPM/.test(document.querySelector('[data-testid="paint-detected-bpm"]')?.textContent || ""), null, { timeout: 20000 })
  .then(() => true)
  .catch(() => false);
check("picture paint detects the tempo of the music bed", bpmDetected, `(${(await bpmReadout.innerText()).slice(0, 60)})`);
await page.getByRole("button", { name: /Custom Sound/ }).click();
const paintCanvasData = () => page.evaluate(() => ({ ...document.querySelector("main canvas").dataset }));
/** Red picture pixels sampled inside the arena of the visible canvas (device pixels; Paint's arena is 0.75 of the half-size). */
const arenaRedCount = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("main canvas");
    const g = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const R = (Math.min(w, h) / 2) * 0.75;
    const data = g.getImageData(0, 0, w, h).data;
    let red = 0;
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > 0.9 * R * R) continue;
        const i = 4 * (y * w + x);
        if (data[i] > 150 && data[i + 1] < 90 && data[i + 2] < 90) red++;
      }
    }
    return red;
  });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(1500);
const paintData1 = await paintCanvasData();
const red1 = await arenaRedCount();
await page.waitForTimeout(4000);
const paintData2 = await paintCanvasData();
const red2 = await arenaRedCount();
check(
  "picture paint reveals the picture as the ball paints",
  paintData1.paintPicture === "1" && Number(paintData2.paintCoverage) > Number(paintData1.paintCoverage) && red2 > red1,
  `(coverage ${paintData1.paintCoverage}% → ${paintData2.paintCoverage}%, red samples ${red1} → ${red2})`,
);
check("picture paint HUD shows the schedule and the beat", ["onSchedule", "behind", "ahead"].includes(paintData2.paintPace) && paintData2.paintBeat === "120", `(pace=${paintData2.paintPace}, beat=${paintData2.paintBeat} BPM)`);
await page.locator('input[aria-label="Brush Size"]').evaluate(setRangeValue, "2");
await page.locator('label:has-text("Guided Coverage") + button').click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  check("picture paint settings mirror into the URL", /(^|&)pbr=2(&|$)/.test(query) && /(^|&)pgd=0(&|$)/.test(query), `(${query})`);
}
await page.getByPlaceholder("Search settings...").fill("brush");
check("search finds the picture paint controls", (await page.locator('input[aria-label="Brush Size"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.getByRole("button", { name: "Remove picture" }).click();
await page.waitForTimeout(700);
{
  const paintData3 = await paintCanvasData();
  check("removing the picture returns to the classic paint trail", (await paintPicture.count()) === 0 && paintData3.paintPicture === "0" && Number(paintData3.paintCoverage) >= 0, `(coverage ${paintData3.paintCoverage}%)`);
  // The beat sync (still switched on, the music bed still playing) is released with the picture: the mode clears
  // its beat state on the next step, so the HUD stops showing the tempo and the canvas stops drawing the pulse.
  await page.waitForTimeout(1000);
  const paintData4 = await paintCanvasData();
  check("removing the picture mid-run releases the beat sync", paintData3.paintBeat === "0" && paintData4.paintBeat === "0" && paintData4.paintPicture === "0", `(beat ${paintData3.paintBeat} → ${paintData4.paintBeat}, picture ${paintData4.paintPicture})`);
}

// 5. Recording: 3-second clip downloads, with the music bed mixed into the audio track
await page.goto(`${BASE}/en/simulator/?mode=classic&dur=10`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Custom Sound/ }).click();
const bedForRecording = await uploadMusicBed(2);
await page.getByRole("button", { name: /Recording/ }).click();
await page.locator("#resolution-select").selectOption("500x500");
const durationSlider = page.locator('input[aria-label="Duration"]');
await durationSlider.evaluate((el) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, "10");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
});
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 40000 }),
  (async () => {
    await page.getByRole("button", { name: /Record Video/ }).click();
    await page.waitForTimeout(3500);
    await page.getByRole("button", { name: /Stop & Export/ }).click();
  })(),
]);
const dlPath = path.join(outDir, download.suggestedFilename());
await download.saveAs(dlPath);
const size = fs.statSync(dlPath).size;
check("video recorded and downloaded", size > 10000, `(${download.suggestedFilename()}, ${size} bytes, music bed ${bedForRecording ? "on" : "OFF"})`);

// 6. Find Simulation
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
await page.waitForTimeout(100);
const found = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
const resultText = found ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
check("find simulation completes", found, `(${resultText})`);

// 7. Language switcher
await page.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /English/ }).click();
await page.getByRole("menuitem", { name: /Español/ }).click();
await page.waitForURL(/\/es\/simulator\//);
check("language switch to Spanish", page.url().includes("/es/simulator/"), `(${page.url()})`);

// 8. Mode card on the simulator page switches the mode in place
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
await page.waitForTimeout(500);
check("mode card switches mode", page.url().includes("mode=portal"), `(${page.url()})`);

// --- boris-faces ---
// 9. Ball characters: no face by default; the "Character" group at the top of the Ball section shows a live preview,
// "Meet Boris" sets the persona (face, name, squash) and everything mirrors into the URL; the running canvas draws the
// face and the name label (mirrored into data-face / data-face-count / data-name-label), a custom emoji hides the face
// until "Face on Image / Emoji" is on, the search box finds the controls, the URL restores a character on the bodies
// of Bouncing Shapes, the label toggle hides the name, the expressions keep their proportions (sampled from
// data-face-expression every 100 ms until the escape: in Classic the face is mostly neutral and winces only on the hard
// rebounds, in Shatter the burst of segment breaks startles it now and then instead of keeping it in shock), and the cat
// face chirps through the ToneGenerator on a minority of the bounces (OscillatorNode.start is instrumented: the chirp is
// the only sawtooth with the default triangle bounce voice, one triangle per bounce note).
const canvasData = () => page.evaluate(() => ({ ...document.querySelector("main canvas").dataset }));
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(600);
{
  const data = await canvasData();
  check("no ball face by default", data.face === undefined && data.nameLabel === undefined && !/(^|&)face=/.test(page.url().split("?")[1] || ""), `(${JSON.stringify(data)})`);
}
await page.getByRole("button", { name: /Ball & Physics/ }).click();
check("character group shows a live face preview", await page.getByTestId("face-preview").isVisible());
await page.getByRole("button", { name: /Meet Boris/ }).click();
await page.waitForTimeout(400);
{
  const query = page.url().split("?")[1] || "";
  const cute = await page.getByRole("group", { name: "Face", exact: true }).getByRole("button", { name: /Cute/ }).getAttribute("aria-pressed");
  const name = await page.locator("#ball-name-input").inputValue();
  check("Meet Boris sets the persona and mirrors it into the URL", /(^|&)face=cute(&|$)/.test(query) && /(^|&)bn=Boris(&|$)/.test(query) && /(^|&)sq=0\.6(&|$)/.test(query) && cute === "true" && name === "Boris", `(${query})`);
}
await page.getByRole("group", { name: "Face", exact: true }).getByRole("button", { name: /Cat/ }).click();
await page.locator('input[aria-label="Squash & Stretch"]').evaluate(setRangeValue, "0.8");
await page.waitForTimeout(1200);
{
  const query = page.url().split("?")[1] || "";
  const data = await canvasData();
  const preview = await page.getByTestId("face-preview").getAttribute("data-face");
  check(
    "the canvas draws the face and the name label",
    /(^|&)face=cat(&|$)/.test(query) && /(^|&)sq=0\.8(&|$)/.test(query) && data.face === "cat" && Number(data.faceCount) >= 1 && data.nameLabel === "Boris" && ["neutral", "ouch", "shock", "grin", "happy"].includes(data.faceExpression) && preview === "cat",
    `(${JSON.stringify(data)}, preview=${preview})`,
  );
}
await page.getByRole("button", { name: "🏀", exact: true }).click();
await page.waitForTimeout(400);
const faceOnEmojiBefore = (await canvasData()).faceCount;
await page.locator('label:has-text("Face on Image / Emoji") + button').click();
await page.waitForTimeout(400);
{
  const after = await canvasData();
  check("a face goes over an emoji ball only with the overlay option", faceOnEmojiBefore === "0" && after.faceCount === "1" && after.nameLabel === "Boris" && /(^|&)fimg=1(&|$)/.test(page.url().split("?")[1] || ""), `(before ${faceOnEmojiBefore}, after ${after.faceCount})`);
}
await page.getByPlaceholder("Search settings...").fill("squash");
check("search finds the character controls", (await page.locator('input[aria-label="Squash & Stretch"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.goto(`${BASE}/en/simulator/?mode=box&face=angry&bn=Tester&r=18`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(1200);
{
  const data = await canvasData();
  check("a character from the URL shows on the Bouncing Shapes bodies", data.face === "angry" && Number(data.faceCount) === 3 && data.nameLabel === "Tester", `(${JSON.stringify(data)})`);
}
await page.goto(`${BASE}/en/simulator/?mode=classic&face=dot&bn=Boris&nl=0`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(800);
{
  const data = await canvasData();
  check("the name label switches off", data.face === "dot" && data.faceCount === "1" && data.nameLabel === "", `(${JSON.stringify(data)})`);
}
/** Samples the first face's expression every 100 ms and tallies the samples taken before its escape (the first grin). */
const sampleExpressions = async (count = 80) => {
  const seen = [];
  for (let i = 0; i < count; i++) {
    await page.waitForTimeout(100);
    seen.push((await canvasData()).faceExpression ?? "");
  }
  const firstGrin = seen.indexOf("grin");
  const before = firstGrin < 0 ? seen : seen.slice(0, firstGrin);
  const tally = { neutral: 0, happy: 0, ouch: 0, shock: 0 };
  for (const e of before) if (e in tally) tally[e]++;
  return { samples: before.length, ...tally };
};
await page.goto(`${BASE}/en/simulator/?mode=classic&face=cute&r=16`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const mix = await sampleExpressions();
  check(
    "classic: the face is mostly neutral and winces only on the hard rebounds",
    mix.samples >= 20 && mix.ouch > 0 && mix.ouch < 0.4 * mix.samples && mix.neutral + mix.happy >= 0.5 * mix.samples,
    `(${JSON.stringify(mix)})`,
  );
}
await page.goto(`${BASE}/en/simulator/?mode=shatter&face=cute&r=16`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const mix = await sampleExpressions();
  check(
    "shatter: the segment breaks startle the face now and then, not all the time",
    mix.samples >= 20 && mix.shock > 0 && mix.shock <= 0.6 * mix.samples && mix.neutral + mix.happy + mix.ouch >= 0.3 * mix.samples,
    `(${JSON.stringify(mix)})`,
  );
}
await page.goto(`${BASE}/en/simulator/?mode=classic&face=cat&fsnd=1&r=20`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__oscTypes = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function () {
    if (this.frequency.value !== 1) log.push(this.type);
    return start.apply(this, arguments);
  };
});
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(8000);
{
  const types = await page.evaluate(() => window.__oscTypes);
  const chirps = types.filter((t) => t === "sawtooth").length;
  const notes = types.filter((t) => t === "triangle").length;
  check("the cat face chirps through the ToneGenerator", chirps >= 1 && notes >= 1, `(${chirps} chirps, ${notes} bounce notes, ${types.length} oscillators)`);
  check("the cat chirps on a minority of the bounces, not on every note", chirps <= Math.max(2, 0.6 * notes), `(${chirps} chirps, ${notes} bounce notes)`);
  await page.screenshot({ path: path.join(outDir, "sim-character.png") });
}
// --- end boris-faces ---
// --- themes
// 10. Themes and backgrounds: the Theme block opens the Visual section; a theme card applies its look (URL, gradient
// background read back from the canvas pixels, particle style handed to the engine); its colours stay editable (the
// card then reads "edited"); a picture generated in the page becomes the cover-fitted, dimmed background (never in
// the URL); the reactive background still flashes on top of it during a run; a portrait export with the picture
// records; the Default card clears the theme and removing the picture falls back to the solid colour.
await page.goto(`${BASE}/en/simulator/?mode=classic&bg=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Visual Effects/ }).click();
{
  const themeGroup = page.getByRole("group", { name: "Theme" });
  const themeCanvasData = () => page.evaluate(() => ({ ...document.querySelector("main canvas").dataset }));
  /** RGB of the visible canvas at a fraction of its size (device pixels). */
  const canvasPixel = (fx, fy) =>
    page.evaluate(([fx, fy]) => {
      const c = document.querySelector("main canvas");
      const x = Math.min(c.width - 1, Math.max(0, Math.round(fx * c.width)));
      const y = Math.min(c.height - 1, Math.max(0, Math.round(fy * c.height)));
      return [...c.getContext("2d").getImageData(x, y, 1, 1).data.slice(0, 3)];
    }, [fx, fy]);
  const near = (px, rgb, tol) => px.every((v, i) => Math.abs(v - rgb[i]) <= tol);
  const themeQuery = () => page.url().split("?")[1] || "";
  {
    const cards = await themeGroup.getByRole("button").count();
    const defaultPressed = await themeGroup.getByRole("button", { name: "Default", exact: true }).getAttribute("aria-pressed");
    const data = await themeCanvasData();
    const corner = await canvasPixel(0.01, 0.01);
    check("theme cards open the Visual section, plain look by default", cards >= 9 && defaultPressed === "true" && data.background === "solid" && data.particleStyle === "confetti" && near(corner, [10, 10, 10], 3), `(${cards} cards, default pressed=${defaultPressed}, bg=${data.background}, particles=${data.particleStyle}, corner ${corner})`);
  }
  await themeGroup.getByRole("button", { name: "Sunset", exact: true }).click();
  await page.waitForTimeout(400);
  {
    const query = themeQuery();
    const data = await themeCanvasData();
    const top = await canvasPixel(0.01, 0.01);
    const bottom = await canvasPixel(0.01, 0.99);
    check(
      "a theme card applies its look (URL, gradient background, particle style)",
      /(^|&)theme=sunset(&|$)/.test(query) && /(^|&)bgt=gradient(&|$)/.test(query) && /(^|&)ps=petals(&|$)/.test(query) && /(^|&)rwalls=0(&|$)/.test(query) && /(^|&)trc=/.test(query) && data.background === "gradient" && data.particleStyle === "petals" && near(top, [45, 27, 105], 8) && near(bottom, [179, 57, 81], 10),
      `(${query}, top ${top}, bottom ${bottom}, particles ${data.particleStyle})`,
    );
  }
  await page.locator('input[aria-label="Bottom"]').fill("#ff0000");
  await page.getByRole("group", { name: "Particle Style" }).getByRole("button", { name: "Pixels", exact: true }).click();
  await page.waitForTimeout(400);
  {
    const query = themeQuery();
    const data = await themeCanvasData();
    const bottom = await canvasPixel(0.01, 0.99);
    const edited = await page.getByTestId("theme-edited").isVisible();
    const stillPicked = await themeGroup.getByRole("button", { name: "Sunset", exact: true }).getAttribute("aria-pressed");
    check("theme colours stay individually editable", /(^|&)bg2=%23ff0000(&|$)/.test(query) && /(^|&)ps=pixels(&|$)/.test(query) && near(bottom, [255, 0, 0], 10) && edited && stillPicked === "true" && data.particleStyle === "pixels", `(${query}, bottom ${bottom}, edited=${edited}, picked=${stillPicked})`);
  }
  await page.getByRole("group", { name: "Background" }).getByRole("button", { name: "Image", exact: true }).click();
  await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 160;
    c.height = 90;
    const g = c.getContext("2d");
    g.fillStyle = "#3060ff";
    g.fillRect(0, 0, 160, 90);
    const bytes = atob(c.toDataURL("image/png").split(",")[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([arr], "smoke-background.png", { type: "image/png" }));
    const input = document.querySelector("#theme-bg-input");
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const bgImage = page.getByTestId("theme-bg-image");
  const bgLoaded = await bgImage.waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(400);
  {
    const query = themeQuery();
    const data = await themeCanvasData();
    const px = await canvasPixel(0.01, 0.5);
    // #3060ff darkened by the default 35 % dim ≈ (31, 62, 166)
    check("a background picture is cover-fitted and dimmed, and stays out of the URL", bgLoaded && (await bgImage.innerText()).includes("smoke-background.png") && data.background === "image" && near(px, [31, 62, 166], 10) && !/(^|&)bgt=/.test(query), `(bg=${data.background}, pixel ${px}, ${query})`);
  }
  await page.locator('input[aria-label="Picture Dim"]').evaluate(setRangeValue, "0.8");
  await page.waitForTimeout(300);
  {
    const px = await canvasPixel(0.01, 0.5);
    check("picture dim darkens the background", near(px, [10, 19, 51], 8) && /(^|&)bgd=0.8(&|$)/.test(themeQuery()), `(pixel ${px})`);
  }
  const reactiveBase = await canvasPixel(0.2, 0.5);
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const flash = await page.evaluate(
    (base) =>
      new Promise((resolve) => {
        const c = document.querySelector("main canvas");
        const g = c.getContext("2d");
        const x = Math.round(0.2 * c.width);
        const y = Math.round(0.5 * c.height);
        const t0 = performance.now();
        let max = 0;
        const tick = () => {
          const d = g.getImageData(x, y, 1, 1).data;
          max = Math.max(max, Math.abs(d[0] - base[0]) + Math.abs(d[1] - base[1]) + Math.abs(d[2] - base[2]));
          if (max >= 6 || performance.now() - t0 > 8000) resolve(max);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
    reactiveBase,
  );
  {
    const time = await page.locator("span.tabular-nums").first().innerText();
    check("reactive background flashes over the picture background", flash >= 6 && /\d/.test(time) && time !== "0.0s", `(max change ${flash} over base ${reactiveBase}, elapsed ${time})`);
  }
  await page.screenshot({ path: path.join(outDir, "sim-theme.png") });
  await page.getByRole("button", { name: /Recording/ }).click();
  const [themeDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 40000 }),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(2500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]);
  const themeDlPath = path.join(outDir, `theme-${themeDownload.suggestedFilename()}`);
  await themeDownload.saveAs(themeDlPath);
  const themeDlSize = fs.statSync(themeDlPath).size;
  check("portrait export records with a picture background", themeDlSize > 10000, `(${themeDownload.suggestedFilename()}, ${themeDlSize} bytes)`);
  await page.getByRole("button", { name: /Visual Effects/ }).click();
  await themeGroup.getByRole("button", { name: "Default", exact: true }).click();
  await page.waitForTimeout(300);
  {
    const query = themeQuery();
    const data = await themeCanvasData();
    check("the Default card clears the theme and keeps the picture", !/(^|&)theme=/.test(query) && !/(^|&)ps=/.test(query) && !/(^|&)rwalls=/.test(query) && data.background === "image" && data.particleStyle === "confetti", `(${query}, bg=${data.background}, particles=${data.particleStyle})`);
  }
  await page.getByRole("button", { name: "Remove background picture" }).click();
  await page.waitForTimeout(300);
  {
    const data = await themeCanvasData();
    const pressed = await page.getByRole("group", { name: "Background" }).getByRole("button", { name: "Solid", exact: true }).getAttribute("aria-pressed");
    check("removing the picture falls back to the solid background", data.background === "solid" && pressed === "true" && (await bgImage.count()) === 0, `(bg=${data.background}, solid pressed=${pressed})`);
  }
  await page.getByPlaceholder("Search settings...").fill("particle");
  check("search finds the particle style", (await page.getByRole("group", { name: "Particle Style" }).isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
}
// --- end themes
// --- jdm-polyrhythm ---
// 11. Metronomes & Polyrhythms: the preview image, URL → the controls in the Mode row, controls → URL,
// the cycles at "never" hide the seed finder, the search box finds the controls, a fixed-length run makes the finder say
// so, and a run ticks, aligns (analytically: data-poly-alignments), plays notes and chords (OscillatorNode.start is
// instrumented), switches its layout live without restarting, pitches 3:4:5 by ratio as G4–C5–E5, and 400 voices keep running.
{
  const res = await page.request.get(`${BASE}/modes/polyrhythm.webp`);
  check("asset /modes/polyrhythm.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/simulator/?mode=polyrhythm&prl=metronomes&prt=custom&prcu=3%2C4%2C5&prcs=2&prc=0&pra=4`, { waitUntil: "networkidle" });
  const pressed = (group, name) => page.getByRole("group", { name: group, exact: true }).getByRole("button", { name, exact: true }).getAttribute("aria-pressed");
  {
    const values = { prcs: await sliderValue("Cycle Length"), prc: await sliderValue("Cycles"), pra: await sliderValue("Accent Every"), prcu: await page.locator("#poly-custom-ratios").inputValue() };
    const metronomes = await page.getByRole("group", { name: "Layout", exact: true }).getByRole("button", { name: /Metronomes/ }).getAttribute("aria-pressed");
    const custom = await pressed("Tempos", "Custom");
    const realign = await page.getByTestId("poly-realign").innerText();
    const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0 && (await page.locator('input[aria-label="Voices"]').count()) === 0;
    check("polyrhythm loads from URL", values.prcs === "2" && values.prc === "0" && values.pra === "4" && values.prcu === "3,4,5" && metronomes === "true" && custom === "true" && /every 2s/.test(realign) && finderHidden && noRingControls, `(${JSON.stringify(values)}, metronomes=${metronomes}, custom=${custom}, "${realign}", finder hidden=${finderHidden})`);
  }
  await page.getByRole("group", { name: "Layout", exact: true }).getByRole("button", { name: /Rings/ }).click();
  await page.getByRole("group", { name: "Tempos", exact: true }).getByRole("button", { name: "Harmonic", exact: true }).click();
  await page.locator('input[aria-label="Voices"]').evaluate(setRangeValue, "24");
  await page.locator('input[aria-label="Cycles"]').evaluate(setRangeValue, "2");
  await page.locator('label:has-text("Polygons") + button').click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    check("polyrhythm mirrors into the URL", /(^|&)prn=24(&|$)/.test(query) && /(^|&)prc=2(&|$)/.test(query) && /(^|&)prp=1(&|$)/.test(query) && /(^|&)prcs=2(&|$)/.test(query) && !/(^|&)prl=/.test(query) && !/(^|&)prt=/.test(query) && finderShown, `(${query}, finder shown=${finderShown})`);
  }
  await page.getByPlaceholder("Search settings...").fill("accent every");
  check("search finds the polyrhythm controls", (await page.locator('input[aria-label="Accent Every"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
  // Two cycles of 2 s always last 4 s: the finder says so at once instead of testing seeds.
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  {
    const shown = await page.getByText(/Polyrhythms always lasts exactly 4\.0s/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check("finder explains a fixed-length polyrhythm run", shown);
    if (shown) await page.getByRole("button", { name: "Try again", exact: true }).click();
  }
  await page.goto(`${BASE}/en/simulator/?mode=polyrhythm&prl=spiral&prt=custom&prcu=3%2C4%2C5&prcs=2&prc=0&prnum=1`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__polyOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push(this.frequency.value);
      return start.apply(this, arguments);
    };
  });
  const polyData = () => page.locator("canvas").first().evaluate((c) => ({ ...c.dataset }));
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(4500);
  const run1 = await polyData();
  {
    const time = await page.locator("span.tabular-nums").first().innerText();
    const pitches = await page.evaluate(() => window.__polyOsc);
    // Voices 3, 4 and 5 play the first three degrees of C major from C4 (the chromatic default leaves them unsnapped).
    const midis = new Set(pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440))));
    const onScale = pitches.length > 0 && [...midis].every((m) => [60, 62, 64].includes(m));
    check("simulator runs the polyrhythm: ticks, analytic alignments, notes and chords", /\d/.test(time) && time !== "0.0s" && run1.polyVoices === "3" && Number(run1.polyTicks) >= 20 && Number(run1.polyAlignments) >= 2 && run1.polyLayout === "spiral" && onScale && midis.size === 3, `(elapsed ${time}, ${JSON.stringify(run1)}, ${pitches.length} tones, degrees ${[...midis].join("/")})`);
    await page.screenshot({ path: path.join(outDir, "sim-polyrhythm.png") });
  }
  // The layout switches live: the rhythm carries on (no restart, the counters keep growing).
  await page.getByRole("group", { name: "Layout", exact: true }).getByRole("button", { name: /Arcs/ }).click();
  await page.waitForTimeout(1500);
  {
    const run2 = await polyData();
    check("polyrhythm layout switches live without restarting", run2.polyLayout === "arcs" && Number(run2.polyTicks) > Number(run1.polyTicks) && Number(run2.polyAlignments) >= Number(run1.polyAlignments), `(${JSON.stringify(run1)} → ${JSON.stringify(run2)})`);
  }
  // Pitch by ratio: every voice plays its own tempo ratio as a harmonic of C3, so 3:4:5 sounds G4–C5–E5 (MIDI 67, 72,
  // 76: harmonics 3, 4 and 5), as the tooltip says – not the ratios over the slowest voice (C3–F3–A3).
  await page.goto(`${BASE}/en/simulator/?mode=polyrhythm&prt=custom&prcu=3%2C4%2C5&prcs=2&prc=0&prpb=ratio`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__polyOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push(this.frequency.value);
      return start.apply(this, arguments);
    };
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(2500);
  {
    const pitches = await page.evaluate(() => window.__polyOsc);
    const midis = new Set(pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440))));
    check("polyrhythm pitch by ratio plays 3:4:5 as the chord G4–C5–E5", pitches.length > 0 && midis.size === 3 && [67, 72, 76].every((m) => midis.has(m)), `(${pitches.length} tones, MIDI ${[...midis].sort((a, b) => a - b).join("/")})`);
  }
  await page.goto(`${BASE}/en/simulator/?mode=polyrhythm&prn=400&prc=0`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(3000);
  {
    const big = await polyData();
    const fps = await page.getByText(/\d+ FPS/).first().innerText().catch(() => "?");
    check("polyrhythm runs 400 voices", big.polyVoices === "400" && Number(big.polyTicks) > 2000, `(${JSON.stringify(big)}, ${fps})`);
    await page.screenshot({ path: path.join(outDir, "sim-polyrhythm-400.png") });
  }
}
// --- end jdm-polyrhythm ---

// --- jdm-collisions ---
// 12. Collision Playground: the preview image, URL → the "Collision playground" block of the Mode
// row, controls → URL, the search box, the finder hidden for this endless mode, 300 orbs running 5 s without the frame
// rate dropping below 30 fps in any half-second window while every collision note sits on the pentatonic size ladder
// (OscillatorNode.start is instrumented again) and at most 12 of them start in any frame at 8× playback, the
// anti-collision switch and the lollipop ring (data-collide-*).
{
  const res = await page.request.get(`${BASE}/modes/collide.webp`);
  check("asset /modes/collide.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
}
/** The On/Off button of a toggle in the Collision playground block, by the start of its label (tooltips mention other toggles). */
const collideToggle = (label) => page.getByTestId("collision-playground").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
await page.goto(`${BASE}/en/simulator/?mode=collide&cpn=120&cpc=box&cpsq=1&cpac=3&cpe=0.9`, { waitUntil: "networkidle" });
{
  const values = { cpn: await sliderValue("Orbs"), cpe: await sliderValue("Bounciness"), cpac: await sliderValue("Anti-Collision At") };
  const box = await page.getByRole("group", { name: "Container" }).getByRole("button", { name: /Box/ }).getAttribute("aria-pressed");
  const squishy = await collideToggle("Squishy").getAttribute("aria-pressed");
  const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
  check("collision playground loads from URL", values.cpn === "120" && values.cpe === "0.9" && values.cpac === "3" && box === "true" && squishy === "true" && finderHidden && noRingControls, `(${JSON.stringify(values)}, box=${box}, squishy=${squishy}, finder hidden=${finderHidden})`);
}
await page.locator('input[aria-label="Orbs"]').evaluate(setRangeValue, "200");
await page.getByRole("group", { name: "Container" }).getByRole("button", { name: /Circle/ }).click();
await collideToggle("Sync Start").click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  check("collision playground mirrors into the URL", /(^|&)cpn=200(&|$)/.test(query) && /(^|&)cpsy=1(&|$)/.test(query) && !/(^|&)cpc=/.test(query) && /(^|&)cpsq=1(&|$)/.test(query), `(${query})`);
}
await page.getByPlaceholder("Search settings...").fill("anti-collision");
check("search finds the collision playground controls", (await page.locator('input[aria-label="Anti-Collision At"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.goto(`${BASE}/en/simulator/?mode=collide`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__oscLog = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (when) {
    if (this.frequency.value !== 1) log.push(this.frequency.value);
    return start.apply(this, arguments);
  };
});
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(500);
{
  // Frame intervals over 5 s of the default playground (300 orbs), in half-second windows.
  const deltas = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    5000,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  const minWindow = Math.min(...windows);
  const data = await page.locator("canvas").first().evaluate((c) => ({ ...c.dataset }));
  const time = await page.locator("span.tabular-nums").first().innerText();
  check("simulator mode=collide runs 300 orbs for 5 s at 30+ fps", /\d/.test(time) && time !== "0.0s" && data.collideBodies === "300" && Number(data.collideCollisions) > 100 && windows.length >= 8 && minWindow >= fpsFloor(30), `(elapsed ${time}, ${data.collideBodies} orbs, ${data.collideCollisions} collisions, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`);
  // Every note is a degree of the C major pentatonic ladder (C3 … A5), the chromatic default leaving it unsnapped.
  const pitches = await page.evaluate(() => window.__oscLog);
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const onLadder = pitches.length > 0 && midis.every((m) => m >= 48 && m <= 81 && [0, 2, 4, 7, 9].includes(m % 12));
  const distinct = new Set(midis);
  check("collision notes are pitched by orb size on the pentatonic ladder", Number(data.collideNotes) > 50 && onLadder && distinct.size >= 5, `(${data.collideNotes} notes, ${pitches.length} tones, ${distinct.size} distinct degrees)`);
  await page.screenshot({ path: path.join(outDir, "sim-collide.png") });
  // The note budget is per rendered frame, not per 60 Hz step: at 8× every frame runs eight or more steps and still
  // starts at most 12 oscillators (one per triangle note), instead of up to 12 per step piling up in one frame.
  await page.getByRole("button", { name: "8x", exact: true }).click();
  await page.waitForTimeout(300);
  const perFrame = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const counts = [];
        let seen = window.__oscLog.length;
        const end = performance.now() + ms;
        const frame = (t) => {
          const n = window.__oscLog.length;
          counts.push(n - seen);
          seen = n;
          if (t < end) requestAnimationFrame(frame);
          else resolve(counts.slice(1));
        };
        requestAnimationFrame(frame);
      }),
    2000,
  );
  {
    const total = perFrame.reduce((a, b) => a + b, 0);
    const busiest = Math.max(...perFrame);
    check("collision notes stay within 12 per frame at 8× playback", perFrame.length >= 20 && total >= perFrame.length && busiest <= 12, `(${perFrame.length} frames, ${total} tones, avg ${(total / Math.max(1, perFrame.length)).toFixed(1)}, busiest frame ${busiest})`);
  }
}
await page.goto(`${BASE}/en/simulator/?mode=collide&cpac=2&cpg=0.8`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const canvas = page.locator("canvas").first();
  const anti = await page.waitForFunction(() => document.querySelector("canvas")?.dataset.collideAnti === "1", null, { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  const before = Number(await canvas.getAttribute("data-collide-collisions"));
  await page.waitForTimeout(1000);
  const after = Number(await canvas.getAttribute("data-collide-collisions"));
  check("collision playground switches to anti-collision", anti && before > 0 && after === before, `(anti=${anti}, collisions ${before} → ${after})`);
  await page.screenshot({ path: path.join(outDir, "sim-collide-anti.png") });
}
await page.goto(`${BASE}/en/simulator/?mode=collide&cpr=1&cpg=0.5`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(2500);
{
  const data = await page.locator("canvas").first().evaluate((c) => ({ ...c.dataset }));
  const shown = await page.getByText("36 on the ring").first().isVisible().catch(() => false);
  check("collision playground puts lollipops on a ring", data.collideBodies === "36" && Number(data.collideCollisions) > 0 && shown, `(${data.collideBodies} lollipops, ${data.collideCollisions} collisions, count label ${shown ? "shown" : "missing"})`);
  await page.screenshot({ path: path.join(outDir, "sim-collide-ring.png") });
}
// --- end jdm-collisions ---
// 13. Ball characters on the bodies the newer rhythm modes draw themselves: a face and a name from the URL show on
// every Metronomes & Polyrhythms voice and on the first MAX_CHARACTER_BALLS (80) Collision Playground orbs.
for (const [mode, query, faces] of [["polyrhythm", "prt=custom&prcu=3%2C4%2C5&prc=0", 3], ["collide", "cpn=120", 80]]) {
  await page.goto(`${BASE}/en/simulator/?mode=${mode}&${query}&face=cute&bn=Boris`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1000);
  const { face, faceCount, nameLabel } = await canvasData();
  check(`a character from the URL shows on the ${mode} bodies`, face === "cute" && Number(faceCount) === faces && nameLabel === "Boris", `(face=${face}, faces=${faceCount}, label=${nameLabel})`);
}

// --- teams ---
/**
 * Finds a 30 s run of Classic with the given extra query (a team roster and more), records it at 1× and checks
 * that the finder set the export length to the run plus the winner banner's 3 s hold, and that the export stops
 * only after the banner has been on screen for most of that hold (the recorder copies the canvas).
 */
const findAndRecordTeams = async (query, name) => {
  await page.goto(`${BASE}/en/simulator/?mode=classic&${query}&res=500x500`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  await page.waitForTimeout(100);
  const result = page.getByText(/Found!|Didn't find simulation/).first();
  const found = await result.waitFor({ timeout: 180000 }).then(() => true).catch(() => false);
  const text = found ? await result.innerText() : "timeout";
  const runSec = Number((/Found! ([\d.]+)s/.exec(text) || [])[1]);
  // The panel hides the length slider while a found run is loaded; the link carries it (`dur`).
  await page.waitForTimeout(500);
  const duration = Number(new URLSearchParams(page.url().split("?")[1] || "").get("dur"));
  let wonAt = 0;
  let recordedAt = 0;
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 90000 }).catch(() => null),
    (async () => {
      if (!Number.isFinite(runSec)) return;
      await page.getByRole("button", { name: /Record Video/ }).click();
      recordedAt = Date.now();
      await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 80000 }).catch(() => {});
      wonAt = Date.now();
    })(),
  ]).then(([d]) => d);
  const doneAt = Date.now();
  let bytes = 0;
  if (download) {
    const file = path.join(outDir, `teams-found-${download.suggestedFilename()}`);
    await download.saveAs(file);
    bytes = fs.statSync(file).size;
  }
  const heldMs = wonAt ? doneAt - wonAt : 0;
  check(
    name,
    Number.isFinite(runSec) && duration >= runSec + 2.95 && duration <= runSec + 4.05 && wonAt > 0 && bytes > 10000 && heldMs >= 2500,
    `(${text.replace(/\s+/g, " ")}, export length ${duration} s, winner ${wonAt ? ((wonAt - recordedAt) / 1000).toFixed(1) : "-"} s into the recording, export done ${heldMs} ms after it, ${bytes} bytes)`,
  );
};

// 14. Team balls with scoreboard: URL → the Teams section (roster rows, scoreboard corner) and the Ball Count slider, the
// old `two=1` link as two balls, controls → URL (a fourth team renamed with its own emoji, the corner), the search box,
// a Classic run of three teams that scores per team on the canvas (data-team-*: teams, labels, bounces/walls/escapes),
// ends – at 8× – with a winner held on screen before the end screen, and records that banner into the export; Color
// Match with several balls credits the segments too.
{
  const roster = "Red*ef4444*🔥,Blue*3b82f6*💧,Green*22c55e*🍀";
  const teamsQuery = () => new URLSearchParams(page.url().split("?")[1] || "");
  const positionButton = (name) => page.getByRole("group", { name: "Scoreboard Position" }).getByRole("button", { name });
  await page.goto(`${BASE}/en/simulator/?mode=classic&teams=${encodeURIComponent(roster)}&tsp=top-right`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Teams & Scoreboard/ }).click();
  {
    const names = await page.locator('[data-testid="team-row"] input[aria-label$=" name"]').evaluateAll((els) => els.map((e) => e.value));
    const emojis = await page.locator('[data-testid="team-row"] input[aria-label$=" emoji"]').evaluateAll((els) => els.map((e) => e.value));
    const right = await positionButton(/Top right/).getAttribute("aria-pressed");
    check("teams load from URL", names.join(",") === "Red,Blue,Green" && emojis.join("") === "🔥💧🍀" && right === "true", `(${names.join(",")} ${emojis.join("")}, top right=${right})`);
  }
  await page.getByRole("button", { name: /Add Team/ }).click();
  await page.getByLabel("Team 4 name", { exact: true }).fill("Gold Rush");
  await page.getByLabel("Team 4 emoji", { exact: true }).fill("⭐");
  await positionButton(/Top left/).click();
  await page.waitForTimeout(300);
  {
    const q = teamsQuery();
    check("teams mirror into the URL", q.get("teams") === `${roster},Gold Rush*eab308*⭐` && q.get("two") === "1" && !q.has("tsp") && !q.has("nb"), `(teams=${q.get("teams")}, two=${q.get("two")}, tsp=${q.get("tsp")})`);
  }
  await page.getByRole("button", { name: /Ball & Physics/ }).click();
  check("the ball count follows the roster", (await sliderValue("Ball Count")) === "4", `(${await sliderValue("Ball Count")})`);
  await page.getByPlaceholder("Search settings...").fill("scoreboard");
  check("search finds the scoreboard controls", (await page.getByRole("group", { name: "Scoreboard Position" }).isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
  await page.goto(`${BASE}/en/simulator/?mode=classic&two=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Ball & Physics/ }).click();
  const twoBallCount = await sliderValue("Ball Count");
  await page.locator('input[aria-label="Ball Count"]').evaluate(setRangeValue, "5");
  await page.waitForTimeout(300);
  {
    const q = teamsQuery();
    check("the old two-ball link reads as two balls and a count above two gets its own key", twoBallCount === "2" && q.get("nb") === "5" && q.get("two") === "1", `(two=1 → ${twoBallCount} balls; ${q.toString()})`);
  }
  // A short Classic run: three rings with wide gaps and fast balls, so three teams escape within seconds at 8×.
  await page.goto(`${BASE}/en/simulator/?mode=classic&teams=${encodeURIComponent(roster)}&wc=3&gap=0.8&s=700`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1000);
  {
    const data = await canvasData();
    const bounces = (data.teamStats || "").split(",").reduce((acc, t) => acc + Number(t.split("/")[0]), 0);
    check("team balls carry names and the scoreboard counts per team", data.teams === "3" && data.teamLabels === "3" && data.scoreboard === "top-left" && (data.teamStats || "").split(",").length === 3 && bounces > 0, `(${JSON.stringify({ teams: data.teams, labels: data.teamLabels, stats: data.teamStats, scoreboard: data.scoreboard })})`);
    await page.screenshot({ path: path.join(outDir, "sim-teams.png") });
  }
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const won = await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 30000 }).then(() => true).catch(() => false);
    const data = await canvasData();
    const totals = (data.teamStats || "").split(",").reduce((acc, t) => t.split("/").map((v, i) => acc[i] + Number(v)), [0, 0, 0]);
    const endScreenEarly = await page.getByRole("button", { name: /Restart Simulation/ }).isVisible();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(outDir, "sim-teams-winner.png") });
    const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
    check("the run ends with a winner banner held before the end screen", won && ["Red", "Blue", "Green", "tie"].includes(data.teamWinner) && totals[1] === 3 && totals[2] === 3 && !endScreenEarly && endScreen, `(winner=${data.teamWinner}, bounces/walls/escapes=${totals.join("/")}, end screen early=${endScreenEarly}, later=${endScreen})`);
  }
  // The recorder copies the canvas, and the export only stops after the banner's hold: the winner is in the video.
  await page.goto(`${BASE}/en/simulator/?mode=classic&teams=${encodeURIComponent(roster)}&wc=3&gap=0.8&s=700&res=500x500`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  {
    let wonAt = 0;
    const [teamDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      (async () => {
        await page.getByRole("button", { name: /Record Video/ }).click();
        await page.getByRole("button", { name: "8x", exact: true }).click();
        await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 45000 }).catch(() => {});
        wonAt = Date.now();
      })(),
    ]);
    const heldMs = wonAt ? Date.now() - wonAt : 0;
    const dlPath = path.join(outDir, `teams-${teamDownload.suggestedFilename()}`);
    await teamDownload.saveAs(dlPath);
    const bytes = fs.statSync(dlPath).size;
    check("the export records the winner banner before it stops", bytes > 10000 && heldMs >= 2500, `(${teamDownload.suggestedFilename()}, ${bytes} bytes, recorded ${heldMs} ms after the winner)`);
  }
  await page.goto(`${BASE}/en/simulator/?mode=colorMatch&teams=${encodeURIComponent(roster)}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const scored = await page.waitForFunction(() => (document.querySelector("main canvas")?.dataset.teamStats || "").split(",").some((t) => Number(t.split("/")[1]) > 0), null, { timeout: 20000 }).then(() => true).catch(() => false);
    const data = await canvasData();
    check("Color Match plays with three team balls and credits the segments they break", scored && data.teams === "3", `(${data.teamStats})`);
    await page.screenshot({ path: path.join(outDir, "sim-teams-colormatch.png") });
  }
  // Shatter with breathing walls at their widest (bw=0.3): the escape that ends the run is on the frozen scoreboard, so
  // the banner names a team that escaped (the escape scan measures against the live, pulsing outer wall – the one
  // Shatter's own end test uses – instead of the widest pulse, which the run used to end before reaching).
  await page.goto(`${BASE}/en/simulator/?mode=shatter&teams=${encodeURIComponent(roster)}&bw=0.3`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const won = await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 90000 }).then(() => true).catch(() => false);
    const data = await canvasData();
    const escapes = (data.teamStats || "").split(",").map((t) => Number(t.split("/")[2]));
    const winnerIndex = ["Red", "Blue", "Green"].indexOf(data.teamWinner);
    const winnerEscapes = winnerIndex >= 0 ? escapes[winnerIndex] : Math.max(0, ...escapes);
    await page.screenshot({ path: path.join(outDir, "sim-teams-shatter-breathing.png") });
    check("with breathing walls the escape that ends a Shatter run is on the scoreboard and wins", won && escapes.reduce((a, b) => a + b, 0) >= 1 && winnerEscapes >= 1, `(winner=${data.teamWinner}, bounces/walls/escapes per team=${data.teamStats})`);
  }
  // Grow takes two balls at most (every ball grows to about the ring's size, so more would crush each other through
  // the sealed ring): a roster of four keeps its teams but plays its first two – the Ball Count stops at two, Add Team
  // is disabled and a note says so – and at 8× neither ball leaves the ring.
  {
    const roster4 = `${roster},Gold*eab308*⭐`;
    await page.goto(`${BASE}/en/simulator/?mode=grow&teams=${encodeURIComponent(roster4)}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Ball & Physics/ }).click();
    const count = await sliderValue("Ball Count");
    const max = await page.locator('input[aria-label="Ball Count"]').getAttribute("max");
    await page.getByRole("button", { name: /Teams & Scoreboard/ }).click();
    const note = await page.getByTestId("teams-cap-note").isVisible().catch(() => false);
    const addDisabled = await page.getByRole("button", { name: /Add Team/ }).isDisabled();
    const rows = await page.locator('[data-testid="team-row"]').count();
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForTimeout(5000);
    const data = await canvasData();
    const stats = (data.teamStats || "").split(",");
    check(
      "Grow plays two team balls at most and neither leaves the sealed ring",
      count === "2" && max === "2" && note && addDisabled && rows === 4 && data.teams === "2" && stats.length === 2 && stats.every((t) => Number(t.split("/")[2]) === 0) && teamsQuery().get("teams") === roster4,
      `(ball count ${count} of max ${max}, note=${note}, add disabled=${addDisabled}, rows=${rows}, teams in play=${data.teams}, stats=${data.teamStats}, teams=${teamsQuery().get("teams")})`,
    );
  }
  // Find Simulation + Record with teams, at 1×: the finder sets the export length to the run plus the winner's 3 s
  // hold, and the export keeps recording through the banner and its confetti instead of stopping when its length
  // runs out right after the run.
  await findAndRecordTeams(`teams=${encodeURIComponent(roster)}`, "Find + Record with teams keeps the winner banner in the export");
}
// --- end teams ---
// --- camera ---
// 15. Cinematic camera: URL → the Camera group of the Visual section, controls → URL, the search box; a Classic run
// zooms toward the ball, shakes on a wall break and slows the clock on a near miss (data-camera-*); a quick Classic
// escape recorded at 8× replays its last 2 s at half speed with the REPLAY badge while the recording keeps going,
// and only then do the export and the end screen follow.
{
  const cameraToggle = (label) => page.getByTestId("camera-section").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  const cameraPhase = () => page.evaluate(() => document.querySelector("main canvas")?.dataset.cameraReplay ?? "");
  await page.goto(`${BASE}/en/simulator/?mode=classic&cz=0.6&shake=0.5&slow=1&slowf=0.3&slowms=900&replay=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Visual Effects/ }).click();
  {
    const values = { cz: await sliderValue("Camera Zoom"), shake: await sliderValue("Screen Shake"), slowf: await sliderValue("Slow-Mo Speed"), slowms: await sliderValue("Slow-Mo Length") };
    const slow = await cameraToggle("Slow-Mo on Near Miss").getAttribute("aria-pressed");
    const replay = await cameraToggle("Replay on Escape").getAttribute("aria-pressed");
    check("camera settings load from URL into the Camera group", values.cz === "0.6" && values.shake === "0.5" && values.slowf === "0.3" && values.slowms === "900" && slow === "true" && replay === "true", `(${JSON.stringify(values)}, slow=${slow}, replay=${replay})`);
  }
  await page.locator('input[aria-label="Camera Zoom"]').evaluate(setRangeValue, "0.8");
  await cameraToggle("Slow-Mo on Near Miss").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    const slidersHidden = (await page.locator('input[aria-label="Slow-Mo Speed"]').count()) === 0;
    check("camera controls mirror into the URL", /(^|&)cz=0\.8(&|$)/.test(query) && !/(^|&)slow=/.test(query) && /(^|&)replay=1(&|$)/.test(query) && slidersHidden, `(${query}, slow-mo sliders hidden=${slidersHidden})`);
  }
  await page.getByPlaceholder("Search settings...").fill("shake");
  check("search finds the camera controls", (await page.locator('input[aria-label="Screen Shake"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");

  await page.goto(`${BASE}/en/simulator/?mode=classic&cz=1&shake=1&slow=1&slowf=0.2&slowms=1200`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "2x", exact: true }).click();
  {
    const slowed = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.cameraTimeScale) < 0.5, null, { timeout: 45000, polling: "raf" }).then(() => true).catch(() => false);
    await page.screenshot({ path: path.join(outDir, "sim-camera-slowmo.png") });
    const data = await canvasData();
    check(
      "camera zooms toward the ball, shakes on a wall break and slows the clock on a near miss",
      slowed && Number(data.cameraScale) > 1.6 && Number(data.cameraShakes) > 0 && Number(data.cameraSlowMo) > 0 && data.cameraReplay === "idle",
      `(slowed=${slowed}, scale ${data.cameraScale}, time scale ${data.cameraTimeScale}, shakes ${data.cameraShakes}, slow-mo windows ${data.cameraSlowMo})`,
    );
  }
  {
    // The slowed run is drawn between physics steps: at 0.2× (0.4 steps a frame at 2×) the engine's whole-step
    // positions stand still in most frames, the drawn ball moves in every one (the canvas counts the slow-motion
    // frames and those that drew the ball where it already was).
    const counted = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.cameraSlowFrames) >= 30, null, { timeout: 45000 }).then(() => true).catch(() => false);
    const data = await canvasData();
    const frames = Number(data.cameraSlowFrames);
    const still = Number(data.cameraSlowStill);
    check("live slow motion glides: the ball moves in every slowed frame", counted && still <= Math.max(1, 0.05 * frames), `(${frames} slow-motion frames, ${still} with the ball standing still)`);
  }

  await page.goto(`${BASE}/en/simulator/?mode=classic&wc=2&gap=0.9&replay=1&shake=0.6&res=500x500&dur=60`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Recording/ }).click();
  const replayDownload = page.waitForEvent("download", { timeout: 90000 }).catch(() => null);
  await page.getByRole("button", { name: /Record Video/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const playing = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.cameraReplay === "playing", null, { timeout: 60000, polling: "raf" }).then(() => true).catch(() => false);
    const playingAt = Date.now();
    const recordingDuringReplay = await page.getByRole("button", { name: /Stop & Export/ }).isVisible().catch(() => false);
    const endScreenDuringReplay = await page.getByRole("button", { name: /Restart Simulation/ }).isVisible().catch(() => false);
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, "sim-camera-replay.png") });
    const mid = await canvasData();
    const done = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.cameraReplay === "done", null, { timeout: 20000 }).then(() => true).catch(() => false);
    const replayMs = Date.now() - playingAt;
    const download = await replayDownload;
    let size = 0;
    if (download) {
      const file = path.join(outDir, `replay-${download.suggestedFilename()}`);
      await download.saveAs(file);
      size = fs.statSync(file).size;
    }
    const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    check(
      "escape replay plays at half speed, recorded, before the end screen",
      playing && recordingDuringReplay && !endScreenDuringReplay && mid.cameraReplay === "playing" && mid.cameraReplays === "1" && done && replayMs > 1500 && replayMs < 9000 && size > 10000 && endScreen && (await cameraPhase()) === "done",
      `(playing=${playing}, recording during replay=${recordingDuringReplay}, end screen during replay=${endScreenDuringReplay}, replay ${replayMs} ms, export ${size} bytes, end screen=${endScreen})`,
    );
  }
  // Without a recording: Restart Simulation runs again, and the end screen waits for the replay.
  await page.getByRole("button", { name: /Restart Simulation/ }).click();
  {
    const restarted = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.cameraReplay === "idle", null, { timeout: 5000, polling: "raf" }).then(() => true).catch(() => false);
    const playing = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.cameraReplay === "playing", null, { timeout: 60000, polling: "raf" }).then(() => true).catch(() => false);
    await page.waitForTimeout(500);
    const heldBack = !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible().catch(() => false)) && (await cameraPhase()) === "playing";
    const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    check("the end screen waits for the escape replay", restarted && playing && heldBack && endScreen && (await cameraPhase()) === "done", `(restarted=${restarted}, playing=${playing}, held back=${heldBack}, end screen=${endScreen})`);
  }
}
// --- end camera ---

// --- teams + camera ---
// 16. Teams with the escape replay: a Classic run of three teams with Replay on Escape replays the escape first – the
// replayed balls keep their teams (names drawn on them), the winner banner waits – then the banner is held before the
// end screen.
{
  const roster = "Red*ef4444*🔥,Blue*3b82f6*💧,Green*22c55e*🍀";
  await page.goto(`${BASE}/en/simulator/?mode=classic&teams=${encodeURIComponent(roster)}&wc=3&gap=0.8&s=700&replay=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const playing = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.cameraReplay === "playing", null, { timeout: 60000, polling: "raf" }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  const during = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-teams-replay.png") });
  const won = await page
    .waitForFunction(() => {
      const d = document.querySelector("main canvas")?.dataset;
      return d?.cameraReplay === "done" && !!d.teamWinner;
    }, null, { timeout: 20000, polling: "raf" })
    .then(() => true)
    .catch(() => false);
  const wonAt = Date.now();
  const endScreenEarly = await page.getByRole("button", { name: /Restart Simulation/ }).isVisible();
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const heldMs = Date.now() - wonAt;
  check(
    "with teams the escape replay plays first (team names on the replayed balls), then the winner banner, then the end screen",
    playing && during.cameraReplay === "playing" && !during.teamWinner && Number(during.teamLabels) >= 1 && won && !endScreenEarly && endScreen && heldMs >= 2000,
    `(playing=${playing}, during replay: winner="${during.teamWinner}", labels=${during.teamLabels}; won=${won}, end screen early=${endScreenEarly}, held ${heldMs} ms)`,
  );
  // Find + Record at 1× with the replay too: the export length (run + 3 s) runs out while the escape replay plays,
  // before the banner even shows – the export waits for the replay and the banner's hold instead of cutting them.
  await findAndRecordTeams(`teams=${encodeURIComponent(roster)}&replay=1`, "Find + Record with teams and the escape replay keeps the replay and then the winner banner in the export");
}
// --- end teams + camera ---
// --- boris-glass ---
// 17. Glass Smash: the preview image and the glass clip, URL → the "Glass" block of the Mode row, controls → URL, the
// search box, the finder shown (every run ends at HOME), the Sound section naming the mode's default wall-break clip,
// a default run at 30+ fps whose pane hits are scale degrees of C major (OscillatorNode.start is instrumented) and whose
// shatters play the glass clip (the only one-argument AudioBufferSourceNode.start), and a short run to HOME at 8×
// (data-glass-*: stages, hits, shattered panes, camera, HOME) that ends with the finished overlay.
for (const asset of ["/modes/glass.webp", "/wallBreak/glass.wav"]) {
  const res = await page.request.get(`${BASE}${asset}`);
  check(`asset ${asset}`, res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
}
/** The On/Off button of a toggle in the Glass block, by the start of its label. */
const glassToggle = (label) => page.getByTestId("glass-smash").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
await page.goto(`${BASE}/en/simulator/?mode=glass&glr=9&glhp=3&gls=5&glm=0`, { waitUntil: "networkidle" });
{
  const values = { glr: await sliderValue("Panes per Stage"), glhp: await sliderValue("Hits per Pane"), gls: await sliderValue("Stages") };
  const moving = await glassToggle("Sliding Panes").getAttribute("aria-pressed");
  const holes = await glassToggle("Panes with Holes").getAttribute("aria-pressed");
  const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
  const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
  const runSize = await page.getByTestId("glass-run-size").innerText().catch(() => "");
  check("glass smash loads from URL", values.glr === "9" && values.glhp === "3" && values.gls === "5" && moving === "false" && holes === "true" && finderShown && noRingControls && /\d+ panes/.test(runSize), `(${JSON.stringify(values)}, moving=${moving}, holes=${holes}, finder shown=${finderShown}, "${runSize}")`);
}
await page.locator('input[aria-label="Stages"]').evaluate(setRangeValue, "2");
await glassToggle("Panes with Holes").click();
await page.waitForTimeout(300);
{
  const query = page.url().split("?")[1] || "";
  check("glass smash mirrors into the URL", /(^|&)gls=2(&|$)/.test(query) && /(^|&)glh=0(&|$)/.test(query) && /(^|&)glr=9(&|$)/.test(query) && /(^|&)glm=0(&|$)/.test(query), `(${query})`);
}
await page.getByPlaceholder("Search settings...").fill("hits per pane");
check("search finds the glass smash controls", (await page.locator('input[aria-label="Hits per Pane"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
await page.getByPlaceholder("Search settings...").fill("");
await page.goto(`${BASE}/en/simulator/?mode=glass`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Custom Sound/ }).click();
{
  const label = await page.locator("#wallbreak-select option").first().innerText();
  check("the Sound section names the glass clip as the mode's wall-break sound", label === "Mode default (Glass)", `("${label}")`);
}
await page.evaluate(() => {
  const osc = [];
  const clips = [];
  window.__glassOsc = osc;
  window.__glassClips = clips;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function () {
    if (this.frequency.value !== 1) osc.push(this.frequency.value);
    return start.apply(this, arguments);
  };
  const bufferStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function () {
    if (arguments.length === 1 && this.buffer) clips.push(this.buffer.duration);
    return bufferStart.apply(this, arguments);
  };
});
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(400);
{
  const deltas = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    6000,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  const minWindow = Math.min(...windows);
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__glassOsc);
  const clips = await page.evaluate(() => window.__glassClips);
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const onScale = midis.length > 0 && midis.every((m) => m >= 48 && m <= 84 && [0, 2, 4, 5, 7, 9, 11].includes(m % 12));
  check("simulator mode=glass smashes panes at 30+ fps", Number(data.glassHits) >= 8 && Number(data.glassShattered) >= 3 && data.glassPanes === "36" && data.glassStages === "4" && windows.length >= 10 && minWindow >= fpsFloor(30), `(${data.glassHits} hits, ${data.glassShattered}/${data.glassPanes} shattered, stage ${data.glassStage}/${data.glassStages}, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`);
  check("glass pane hits play scale degrees and shatters play the glass clip", onScale && new Set(midis).size >= 3 && clips.length >= 1 && clips.every((d) => d > 0.6 && d < 0.8), `(${pitches.length} tones, ${new Set(midis).size} distinct degrees, ${clips.length} glass clips)`);
  await page.screenshot({ path: path.join(outDir, "sim-glass.png") });
}
await page.goto(`${BASE}/en/simulator/?mode=glass&glr=3&glhp=1&gls=2&face=cute&bn=Boris`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("glass smash reaches HOME through every stage and finishes", done && data.glassHome === "1" && data.glassStage === "2" && Number(data.glassCamera) > 0 && Number(data.glassShattered) >= 3 && data.face === "cute", `(finished=${done}, home=${data.glassHome}, stage ${data.glassStage}/${data.glassStages}, camera ${data.glassCamera}, ${data.glassShattered}/${data.glassPanes} shattered, face=${data.face})`);
  await page.screenshot({ path: path.join(outDir, "sim-glass-home.png") });
}
// --- boris-multipliers --- Glass Smash with its multiplier gates (glg=1): the switch in the Glass block, the Ball section's
// Multipliers group (the cap), and a run in which the gate row of every stage stacks its multiplier on the ball – the HUD
// mirrors it into data-mult-* – on its way HOME. The first row is read at normal speed, then the run goes on at 8×: a ball
// that falls fast through the first stage meets the next row within a second of simulation – about a tenth of a second at
// 8× –, so read at 8× "after the first row" often held both rows already.
await page.goto(`${BASE}/en/simulator/?mode=glass&glg=1&gls=2&glr=4`, { waitUntil: "networkidle" });
{
  const gates = await glassToggle("Multiplier Gates").getAttribute("aria-pressed").catch(() => null);
  await page.getByRole("button", { name: /Ball & Physics/ }).click();
  const group = await page.getByTestId("multipliers-section").isVisible().catch(() => false);
  check("glass smash multiplier gates load from the URL, with the Multipliers group in the Ball section", gates === "true" && group, `(gates=${gates}, multipliers group=${group})`);
}
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(300);
{
  const hud = await canvasData();
  const through = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.glassGates ?? 0) >= 1, null, { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(100);
  const first = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-glass-gates.png") });
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const product = Number(data.multSpeed) * Number(data.multSize) * Number(data.multDamage);
  const firstProduct = Number(first.multSpeed) * Number(first.multSize) * Number(first.multDamage);
  check(
    "glass smash gates stack a multiplier on the ball at every stage on its way HOME",
    hud.multSpeed !== undefined && through && firstProduct > 1 && done && data.glassHome === "1" && data.glassGates === "2" && product > firstProduct && data.multBalls === "1",
    `(HUD from the start=${hud.multSpeed !== undefined}, after the first row (rows ${first.glassGates}) speed x${first.multSpeed} size x${first.multSize} dmg x${first.multDamage}; at HOME=${data.glassHome} rows ${data.glassGates}, speed x${data.multSpeed} size x${data.multSize} dmg x${data.multDamage})`,
  );
}
// --- end boris-glass ---
// --- boris-multipliers ---
// 18. Multipliers: the preview image; the "Multipliers" group of the Ball section (URL → controls); pickups in Classic
// (three orbs per 10 s that float for 20 s) are taken and change the HUD badges – the canvas mirrors them into
// data-mult-* –; the multipliers board shows its Mode-row block, counts arrivals HOME at 8× (data-mult-home grows) and
// finishes with every ball home or gone.
{
  const res = await page.request.get(`${BASE}/modes/multipliers.webp`);
  check("asset /modes/multipliers.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
}
await page.goto(`${BASE}/en/simulator/?mode=classic&mpk=1&mpr=3&mpl=20&mpty=speed%2Csize%2Cdamage`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Ball & Physics/ }).click();
{
  const section = page.getByTestId("multipliers-section");
  const shown = await section.isVisible().catch(() => false);
  const pressed = await section.getByRole("button", { name: /Speed/ }).first().getAttribute("aria-pressed").catch(() => null);
  const ballsOff = await section.getByRole("button", { name: /Balls/ }).first().getAttribute("aria-pressed").catch(() => null);
  check("multipliers group shows in the Ball section with the URL's pickups", shown && pressed === "true" && ballsOff === "false", `(shown=${shown}, speed=${pressed}, balls=${ballsOff})`);
}
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const took = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.multPickups ?? 0) >= 1, null, { timeout: 45000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(200);
  const data = await canvasData();
  const product = Number(data.multSpeed) * Number(data.multSize) * Number(data.multDamage);
  check("multiplier pickups in Classic change the HUD badges", took && product > 1, `(${data.multPickups} taken, speed x${data.multSpeed}, size x${data.multSize}, dmg x${data.multDamage}, ${data.multOrbs} orbs afloat)`);
  await page.screenshot({ path: path.join(outDir, "sim-multipliers-pickups.png") });
}
await page.goto(`${BASE}/en/simulator/?mode=multipliers&mprw=4&mpsb=3`, { waitUntil: "networkidle" });
{
  const block = await page.getByTestId("multipliers-board").isVisible().catch(() => false);
  check("multipliers board controls show in the Mode row", block, "");
}
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "sim-multipliers.png") });
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const arrived = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.multHome ?? 0) > 0, null, { timeout: 40000 }).then(() => true).catch(() => false);
  const done = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.multDone === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const doneAt = Date.now();
  const endScreenEarly = await page.getByRole("button", { name: /Restart Simulation/ }).isVisible();
  const data = await canvasData();
  check("the multipliers board counts arrivals home and finishes", arrived && done && Number(data.multHome) > 0 && data.multActive === "0", `(home ${data.multHome}, clones ${data.multClones}, gate passes ${data.multGates}, in play ${data.multActive}, done ${data.multDone})`);
  await page.screenshot({ path: path.join(outDir, "sim-multipliers-home.png") });
  // The "N Boris made it home" banner and its confetti play before the end screen covers them (a recording keeps them).
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const heldMs = Date.now() - doneAt;
  check("the board's \"made it home\" banner is held on screen before the end screen", done && !endScreenEarly && endScreen && heldMs >= 1000, `(end screen at once=${endScreenEarly}, shown ${heldMs} ms after the finish)`);
}
// A ball that outgrows the arena (big ball, size orbs only, three per 10 s) ends the run with OUTGREW THE ARENA, held on
// screen before the end screen too.
await page.goto(`${BASE}/en/simulator/?mode=classic&r=30&mpk=1&mpr=3&mpl=30&mpty=size`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const out = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.multOutgrew === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const outAt = Date.now();
  const endScreenEarly = await page.getByRole("button", { name: /Restart Simulation/ }).isVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, "sim-multipliers-outgrew.png") });
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  const heldMs = Date.now() - outAt;
  const data = await canvasData();
  check("OUTGREW THE ARENA is held on screen before the end screen", out && !endScreenEarly && endScreen && heldMs >= 1000, `(outgrew=${data.multOutgrew} at size x${data.multSize}, end screen at once=${endScreenEarly}, shown ${heldMs} ms after the finish)`);
}
// Teams and multipliers together: the stat badges start below the teams' scoreboard in its default top-left corner of the
// recorded square – live (data-mult-hud-top ≥ data-scoreboard-bottom) and in the export, where the scoreboard sits flush.
await page.goto(`${BASE}/en/simulator/?mode=classic&nb=2&teams=${encodeURIComponent("Red*ef4444*A,Blue*3b82f6*B")}&mpk=1&mpr=3&mpl=30&mpty=speed`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const badge = await page.waitForFunction(() => {
    const d = document.querySelector("main canvas")?.dataset;
    return !!d && Number(d.multSpeed) > 1 && Number(d.multHudTop) >= 0;
  }, null, { timeout: 45000 }).then(() => true).catch(() => false);
  const live = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-multipliers-teams.png") });
  let rec = {};
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 40000 }),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(1500);
      rec = await canvasData();
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]);
  const dlPath = path.join(outDir, `teams-multipliers-${download.suggestedFilename()}`);
  await download.saveAs(dlPath);
  const bytes = fs.statSync(dlPath).size;
  const clear = (d) => d.scoreboard === "top-left" && Number(d.scoreboardBottom) > 0 && Number(d.multHudTop) >= Number(d.scoreboardBottom);
  check(
    "multiplier badges start below the teams' scoreboard, live and in the export",
    // (the recording drops the live inset under the page's buttons, if the canvas had one: the scoreboard never sits lower)
    badge && clear(live) && clear(rec) && Number(rec.scoreboardBottom) <= Number(live.scoreboardBottom) && bytes > 10000,
    `(speed x${live.multSpeed}; live: badges at y ${live.multHudTop}, scoreboard to y ${live.scoreboardBottom}; recording: badges at y ${rec.multHudTop}, scoreboard to y ${rec.scoreboardBottom}; export ${bytes} bytes)`,
  );
}
// Multiply with speed orbs: the new balls inherit the speed, so the count used to explode (700–1500 balls, physics frames
// of 20–100 ms and hiccups of a second). With multipliers in play Multiply stops spawning at 200 balls and the crowd's
// pairs come from a spatial hash: after running up to the cap at 8×, the ball count stays within it and 1× keeps a
// steady frame rate (this headless browser draws the 200 balls and their trails in software at 20–30 fps on a busy
// machine; the exploding count used to fall to a few frames a second, with hiccups of a second).
await page.goto(`${BASE}/en/simulator/?mode=multiply&mpk=1&mpr=3&mpl=30&mpty=speed`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const crowd = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.multBalls ?? 0) > 64, null, { timeout: 60000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(4000);
  const peak = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        let most = 0;
        const end = performance.now() + ms;
        const frame = (t) => {
          most = Math.max(most, Number(document.querySelector("main canvas")?.dataset.multBalls ?? 0));
          if (t < end) requestAnimationFrame(frame);
          else resolve(most);
        };
        requestAnimationFrame(frame);
      }),
    2000,
  );
  await page.getByRole("button", { name: "1x", exact: true }).click();
  const deltas = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    3000,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  const minWindow = Math.min(...windows);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-multiply-speed.png") });
  check("Multiply with speed orbs stays within 200 balls at a steady frame rate", crowd && peak > 64 && peak <= 200 && Number(data.multBalls) <= 200 && windows.length >= 4 && avg >= fpsFloor(15) && minWindow >= fpsFloor(10), `(peak ${peak} balls, now ${data.multBalls}, speed x${data.multSpeed}, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps, floors ${fpsFloor(15)}/${fpsFloor(10)}${loadNote()})`);
}
// --- end boris-multipliers ---
// --- captions ---
// 19. Animated captions: a link with a countdown, a wall counter, a progress bar and a question fills the Captions
// section; a caption added from the panel lands in the link; the search box finds the caption fields; a Classic
// run shows them on the canvas (data-caption-*), the countdown counts down, and at 8× the question's answer is
// revealed when the ball escapes, with every wall counted; a Target run answered at its finish holds the end screen
// until the answer is seen; the captions survive a mode change.
{
  const cap = ["cd*t*0*0*p*1.2*ffffff*000000", "wc*t*0*0*s*1*93d119*000000", "pg*b*0*0*f*1*93d119*27272a", "q*c*0*0*p*1.3*ffffff*000000*Will it escape?*YES!"].join(",");
  await page.goto(`${BASE}/en/simulator/?mode=classic&dur=30&cap=${encodeURIComponent(cap)}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Captions/ }).first().click();
  const rows = page.getByTestId("caption-row");
  const types = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-caption-type")));
  check("captions from the link fill the Captions section", types.join(",") === "countdown,wallCounter,progress,question", `(${types.join(",")})`);
  await page.getByTestId("caption-add-text").click();
  await page.waitForTimeout(400);
  const linked = new URL(page.url()).searchParams.get("cap") ?? "";
  check("a caption added in the panel lands in the link", (await rows.count()) === 5 && linked === `${cap},tx*b*0*0*f*1*ffffff**Watch till the end!`, `(${await rows.count()} rows, cap=${linked.slice(-60)})`);
  await page.getByPlaceholder("Search settings...").fill("answer");
  const answerField = await page.locator('input[aria-label="Caption 4 answer"]').inputValue().catch(() => null);
  check("the search box finds the caption fields", answerField === "YES!", `(answer field: ${answerField})`);
  await page.getByPlaceholder("Search settings...").fill("");
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1500);
  const early = await canvasData();
  const texts = early.captionTexts ?? "";
  check("captions show on the canvas while the run plays", Number(early.captions) === 5 && /\b0:(29|30|28)\b/.test(texts) && /Wall \d\/7/.test(texts) && texts.includes("Will it escape?") && texts.includes("Watch till the end!") && early.captionReveal === "0", `(${early.captions} drawn: "${texts}", reveal=${early.captionReveal})`);
  await page.screenshot({ path: path.join(outDir, "sim-captions.png") });
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const revealed = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.captionReveal === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  const late = await canvasData();
  const lateTexts = late.captionTexts ?? "";
  const clock = /\b(\d+):(\d\d)\b/.exec(lateTexts);
  const secondsLeft = clock ? 60 * Number(clock[1]) + Number(clock[2]) : -1;
  check("the question's answer pops in at the escape, the wall counter reads every wall and the countdown ran down", revealed && lateTexts.includes("Will it escape? → YES!") && lateTexts.includes("Wall 7/7") && secondsLeft >= 0 && secondsLeft < 28, `(revealed=${revealed}, "${lateTexts}")`);
  await page.screenshot({ path: path.join(outDir, "sim-captions-reveal.png") });
  // A run whose answer comes with its finish (Target: the ring never opens) holds the end screen while the answer pops in.
  await page.goto(`${BASE}/en/simulator/?mode=target&tc=5&cap=${encodeURIComponent("q*t*0*0*p*1.3*ffffff*000000*Done?*YES!")}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const answered = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.captionReveal === "1", null, { timeout: 90000 }).then(() => true).catch(() => false);
  const heldAtReveal = !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible());
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  const targetTexts = (await canvasData()).captionTexts ?? "";
  check("a question answered at the finish holds the end screen until the answer is seen", answered && heldAtReveal && endScreen && targetTexts.includes("Done? → YES!"), `(revealed=${answered}, held=${heldAtReveal}, end screen=${endScreen}, "${targetTexts}")`);
  await page.goto(`${BASE}/en/simulator/?mode=classic&cap=${encodeURIComponent(cap)}`, { waitUntil: "networkidle" });
  await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
  await page.waitForTimeout(500);
  const after = new URL(page.url()).searchParams;
  check("captions carry over a mode change", after.get("mode") === "portal" && after.get("cap") === cap, `(mode=${after.get("mode")}, cap=${(after.get("cap") ?? "").slice(0, 60)})`);
}
// 19b. Captions in Shatter and with the Top / Bottom Text: Shatter's wall counter counts every wall the ball dug through
// (all of them at the escape, not only the walls whose every segment is gone); the top and bottom stacks start clear of
// the Top / Bottom Text lines, live and – against the lines the recorder draws into the export frame – while recording;
// and a clip recorded from the middle of a run counts its own time: its countdown starts at the recording duration and
// its progress bar at 0 %, whatever the run's clock (here 8×) says.
{
  const shatterCap = ["wc*t*0*0*s*1*93d119*000000", "q*c*0*0*p*1.3*ffffff*000000*Will it escape?*YES!"].join(",");
  await page.goto(`${BASE}/en/simulator/?mode=shatter&cap=${encodeURIComponent(shatterCap)}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const escaped = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.captionReveal === "1", null, { timeout: 90000 }).then(() => true).catch(() => false);
  const shatterTexts = (await canvasData()).captionTexts ?? "";
  const walls = /Wall (\d+)\/(\d+)/.exec(shatterTexts);
  check("Shatter's wall counter counts every wall the ball broke through (all of them at the escape)", escaped && !!walls && walls[1] === walls[2] && Number(walls[2]) === 10, `(escaped=${escaped}, "${shatterTexts}")`);

  /** "top,bottom[,font size]" data attribute → numbers. */
  const nums = (v) => (v ?? "").split(",").map(Number);
  /** The stacks start beyond the text lines: a line's glyphs reach about half a font size around its centre. */
  const clearOfText = (d) => {
    const [stackTop, stackBottom] = nums(d.captionStack);
    const [textTop, textBottom, fs] = nums(d.edgeText);
    return { ok: Number.isFinite(stackTop) && Number.isFinite(fs) && fs > 0 && stackTop > textTop + 0.5 * fs && stackBottom < textBottom - 0.5 * fs, info: `stack ${d.captionStack}, text lines ${d.edgeText}` };
  };
  const textCap = ["cd*t*0*0*p*1.2*ffffff*000000", "pg*b*0*0*f*1*93d119*27272a"].join(",");
  await page.goto(`${BASE}/en/simulator/?mode=classic&dur=30&res=1080x1920&top=${encodeURIComponent("CAN IT ESCAPE?")}&bottom=${encodeURIComponent("follow for more")}&cap=${encodeURIComponent(textCap)}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(600);
  const live = await canvasData();
  const liveClear = clearOfText(live);
  check("the top and bottom captions start clear of the Top / Bottom Text (live)", Number(live.captions) === 2 && liveClear.ok, `(${liveClear.info})`);
  await page.screenshot({ path: path.join(outDir, "sim-captions-text.png") });
  // Let the run's clock race ahead at 8×, then record: the clip's countdown and progress bar start from its own zero.
  await page.getByRole("button", { name: "8x", exact: true }).click();
  await page.waitForTimeout(800);
  const before = (await canvasData()).captionTexts ?? "";
  let recorded = null;
  const [clipDownload] = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(900);
      recorded = await canvasData();
      // (A run that finished meanwhile stops and exports on its own.)
      await page.getByRole("button", { name: /Stop & Export/ }).click({ timeout: 5000 }).catch(() => {});
    })(),
  ]);
  const clipTexts = recorded?.captionTexts ?? "";
  const clipClock = /\b0:(\d\d)\b/.exec(clipTexts);
  const clipPct = /(\d+)%/.exec(clipTexts);
  const runClock = /\b0:(\d\d)\b/.exec(before);
  check(
    "a clip recorded mid-run counts its own time: the countdown starts at the duration, the progress bar at 0 %",
    !!clipClock && Number(clipClock[1]) >= 28 && !!clipPct && Number(clipPct[1]) <= 5 && !!runClock && Number(runClock[1]) < 26,
    `(run before Record: "${before}", 0.9 s into the clip: "${clipTexts}")`,
  );
  const recClear = recorded ? clearOfText(recorded) : { ok: false, info: "no data" };
  const liveLines = nums(live.edgeText);
  const recLines = nums(recorded?.edgeText);
  check(
    "while recording, the captions keep clear of the text lines the recorder draws into the export frame",
    recClear.ok && recLines.length === 3 && Math.abs(recLines[2] - liveLines[2]) > 0.05 && !!clipDownload,
    `(${recClear.info}; live lines ${live.edgeText}; download=${clipDownload ? clipDownload.suggestedFilename() : "none"})`,
  );
}
// --- end captions ---

// --- obstacle-editor ---
// 20. Obstacle editor: URL → the Obstacles section (a row per obstacle, the bumper boost) and the canvas (data-obstacles),
// the ready screen shrinks to a bar so the obstacles stay visible and editable; a mouse drag moves a peg (the URL follows
// on release), a click + Backspace deletes a bumper – also right after a panel slider was used (the click takes the focus
// off it) –, a touch drag (pointerType "touch") moves the blocker, the dropdown adds a spinner on a free spot; a run at 8×
// hits the obstacles (hits, bumper kicks, the spinner turning), pausing makes them draggable again, Clear All empties the
// layout, and the section is not offered outside the ring modes.
{
  const layout = "p:0.5,0,6;b:-0.5,0,10;k:0,0.5,40,0;s:0,-0.5,50,0,30;b:0.22,0,12";
  await page.goto(`${BASE}/en/simulator/?mode=classic&obs=${encodeURIComponent(layout)}&obb=1.8`, { waitUntil: "networkidle" });
  const obsParam = () => new URL(page.url()).searchParams.get("obs") ?? "";
  /** The URL's obstacles as [code, ...numbers]. */
  const obsList = () =>
    obsParam()
      .split(";")
      .filter(Boolean)
      .map((part) => [part.split(":")[0], ...part.split(":")[1].split(",").map(Number)]);
  const box = await page.locator("main canvas").boundingBox();
  const R = (Math.min(box.width, box.height) / 2) * 0.75;
  const at = (ax, ay) => ({ x: box.x + box.width / 2 + ax * R, y: box.y + box.height / 2 + ay * R });
  /** Lets the page commit a change (React state → URL) and the canvas draw a frame or two. */
  const settle = () => page.waitForTimeout(250);
  const sectionButtonsClassic = await page.getByRole("button", { name: /^🚧/ }).count();
  await page.getByRole("button", { name: /Obstacles/ }).first().click();
  const rows = await page.getByTestId("obstacle-row").count();
  const boost = await sliderValue("Bumper Boost");
  const readyBar = await page.getByTestId("obstacle-ready-bar").isVisible();
  const editing = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.obstacleEditing === "1", null, { timeout: 5000 }).then(() => true).catch(() => false);
  const hint = await page.getByTestId("obstacle-canvas-hint").isVisible();
  const touchAction = await page.evaluate(() => document.querySelector("main canvas").style.touchAction);
  check(
    "obstacles from the URL: a row each in the Obstacles section, the bumper boost, the ready bar, the hint and canvas editing",
    rows === 5 && boost === "1.8" && readyBar && editing && hint && touchAction === "none" && (await canvasData()).obstacles === "5",
    `(rows=${rows}, boost=${boost}, bar=${readyBar}, editing=${editing}, hint=${hint}, touch-action=${touchAction})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-obstacles-ready.png") });

  // A mouse drag moves the peg; the URL follows on release (arena radii, so it matches the pointer's arena position).
  const from = at(0.5, 0);
  const to = at(0.3, 0.35);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await settle();
  const peg = obsList()[0];
  check("dragging a peg on the canvas moves it and updates the URL", peg[0] === "p" && Math.abs(peg[1] - 0.3) < 0.02 && Math.abs(peg[2] - 0.35) < 0.02 && peg[3] === 6, `(${obsParam()})`);

  // Nudge a panel slider first (the Bumper Boost, focused and moved; the focus stays on it, as after any slider use – without
  // scrolling the page, so the canvas stays where it was measured), then click the first bumper: the click takes the focus
  // off the slider, so Backspace deletes the bumper.
  const boostSlider = page.locator('input[aria-label="Bumper Boost"]');
  await boostSlider.evaluate((el) => el.focus({ preventScroll: true }));
  await boostSlider.evaluate(setRangeValue, "1.85");
  await settle();
  const focusBefore = await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("type") ?? ""}`);
  const bumper = at(-0.5, 0);
  await page.mouse.click(bumper.x, bumper.y);
  await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.obstacleSelected === "1", null, { timeout: 3000 }).catch(() => {});
  const selected = (await canvasData()).obstacleSelected;
  const focusAfter = await page.evaluate(() => `${document.activeElement?.tagName}:${document.activeElement?.getAttribute("type") ?? ""}`);
  await page.keyboard.press("Backspace");
  await settle();
  const afterDelete = obsList();
  const nudged = new URL(page.url()).searchParams.get("obb");
  check(
    "a click selects an obstacle and Backspace deletes it – also right after a panel slider was used",
    selected === "1" && focusBefore === "INPUT:range" && !focusAfter.startsWith("INPUT") && nudged === "1.85" && afterDelete.length === 4 && afterDelete.filter((o) => o[0] === "b").length === 1 && (await page.getByTestId("obstacle-row").count()) === 4,
    `(selected=${selected}, focus ${focusBefore} → ${focusAfter}, obb=${nudged}, ${obsParam()})`,
  );

  // A touch drag (pointer events with pointerType "touch") moves the blocker.
  const tFrom = at(0, 0.5);
  const tTo = at(-0.35, 0.6);
  await page.evaluate(
    ([a, b]) => {
      const canvas = document.querySelector("main canvas");
      const fire = (type, p) => canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 41, pointerType: "touch", isPrimary: true, clientX: p.x, clientY: p.y, buttons: type === "pointerup" ? 0 : 1 }));
      fire("pointerdown", a);
      for (let i = 1; i <= 6; i++) fire("pointermove", { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 });
      fire("pointerup", b);
    },
    [tFrom, tTo],
  );
  await settle();
  const blocker = obsList().find((o) => o[0] === "k");
  check("a touch drag moves the blocker", !!blocker && Math.abs(blocker[1] + 0.35) < 0.02 && Math.abs(blocker[2] - 0.6) < 0.02 && blocker[3] === 40, `(${obsParam()})`);

  // The dropdown adds a spinner on a free spot.
  await page.locator("#obstacle-kind-select").selectOption("spinner");
  await page.getByRole("button", { name: /Add Obstacle/ }).click();
  await settle();
  const added = obsList();
  const spinners = added.filter((o) => o[0] === "s");
  check("the kind dropdown adds a spinner", added.length === 5 && spinners.length === 2 && (await page.getByTestId("obstacle-row").count()) === 5 && (await canvasData()).obstacles === "5", `(${obsParam()})`);

  // A run at 8×: the ball hits the obstacles and the bumper kicks it; the spinners turn; editing is off meanwhile.
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const angle0 = Number((await canvasData()).spinnerAngle);
  const hit = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.obstacleHits ?? 0) > 0 && Number(document.querySelector("main canvas")?.dataset.bumperHits ?? 0) > 0, null, { timeout: 30000 }).then(() => true).catch(() => false);
  // The spinner turns 180°/s of simulation time: its angle moves within a frame or two at 8× (the hit may come first).
  const turned = await page.waitForFunction((a0) => Number(document.querySelector("main canvas")?.dataset.spinnerAngle) !== a0, angle0, { timeout: 5000 }).then(() => true).catch(() => false);
  const running = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-obstacles-running.png") });
  check(
    "a run hits the obstacles, bumpers kick and spinners turn (no editing while it runs)",
    hit && turned && running.obstacleEditing === "0" && !(await page.getByTestId("obstacle-canvas-hint").isVisible()),
    `(hits=${running.obstacleHits}, bumper kicks=${running.bumperHits}, spinner ${angle0}° → ${running.spinnerAngle}°, editing=${running.obstacleEditing})`,
  );

  // Paused: draggable again. The bumper near the centre moves.
  const pause = page.getByRole("button", { name: /Pause/ });
  const stillRunning = await pause.isVisible().catch(() => false);
  if (stillRunning) {
    await pause.click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.obstacleEditing === "1", null, { timeout: 5000 }).catch(() => {});
    const bFrom = at(0.22, 0);
    const bTo = at(-0.2, -0.25);
    await page.mouse.move(bFrom.x, bFrom.y);
    await page.mouse.down();
    await page.mouse.move(bTo.x, bTo.y, { steps: 6 });
    await page.mouse.up();
    await settle();
  }
  const pausedBumper = obsList().find((o) => o[0] === "b");
  check("while paused an obstacle can be dragged again", stillRunning && !!pausedBumper && Math.abs(pausedBumper[1] + 0.2) < 0.03 && Math.abs(pausedBumper[2] + 0.25) < 0.03, `(was running=${stillRunning}, ${obsParam()})`);

  // Clear All empties the layout (URL, list, canvas).
  await page.getByRole("button", { name: /Clear All Obstacles/ }).click();
  await settle();
  check("Clear All removes every obstacle", obsParam() === "" && (await page.getByTestId("obstacle-row").count()) === 0 && (await canvasData()).obstacles === undefined, `(obs="${obsParam()}")`);

  // Outside the ring modes the section is not offered and nothing is drawn (the layout stays in the link).
  await page.goto(`${BASE}/en/simulator/?mode=drop&obs=${encodeURIComponent(layout)}`, { waitUntil: "networkidle" });
  await settle();
  const offered = await page.getByRole("button", { name: /^🚧/ }).count();
  check(
    "no Obstacles section and no obstacles outside the ring modes (the layout stays in the link)",
    sectionButtonsClassic === 1 && offered === 0 && (await canvasData()).obstacles === undefined && obsParam() === layout,
    `(section buttons: classic ${sectionButtonsClassic}, drop ${offered}; obs="${obsParam()}")`,
  );
}
// 20b. A found seed and the layout: with a found seed the compact ready bar quotes the found run's length together with the
// "do not change settings" warning; moving an obstacle drops the seed, so the bar stops quoting it, the warning goes and the
// finder panel no longer says "Found!". (A 60 s target: runs with this layout are long, so the finder hits one quickly.)
{
  const layout = "p:0.5,0,6;b:-0.3,-0.2,10";
  await page.goto(`${BASE}/en/simulator/?mode=classic&obs=${encodeURIComponent(layout)}`, { waitUntil: "networkidle" });
  await page.locator("#find-duration").evaluate(setRangeValue, "60");
  await page.getByRole("button", { name: /Find 60s Simulation/ }).click();
  await page.waitForTimeout(100);
  const outcomeText = page.getByText(/Found! \d|Didn't find simulation/).first();
  const outcome = await outcomeText.waitFor({ timeout: 150000 }).then(() => outcomeText.innerText()).catch(() => "timeout");
  const bar = page.getByTestId("obstacle-ready-bar");
  const foundBar = ((await bar.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const warned = await page.getByTestId("obstacle-ready-warning").isVisible().catch(() => false);
  // --- timeline --- the Find button can sit below the fold (the panel's section list grew), and clicking it scrolls the page
  // until the canvas is out of view: bring the canvas back before measuring where to drag.
  await page.locator("main canvas").scrollIntoViewIfNeeded();
  const box = await page.locator("main canvas").boundingBox();
  const R = (Math.min(box.width, box.height) / 2) * 0.75;
  const at = (ax, ay) => ({ x: box.x + box.width / 2 + ax * R, y: box.y + box.height / 2 + ay * R });
  const from = at(0.5, 0);
  const to = at(0.2, 0.35);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const moved = (new URL(page.url()).searchParams.get("obs") ?? "").split(";")[0];
  const movedBar = ((await bar.innerText().catch(() => "")) || "").replace(/\s+/g, " ");
  const warnedAfter = await page.getByTestId("obstacle-ready-warning").isVisible().catch(() => false);
  const foundAfter = await page.getByText(/Found! \d/).count();
  check(
    "a found seed: the ready bar quotes it with the warning; moving an obstacle drops the seed, its length and the warning",
    /Found!/.test(outcome) && /Ready to start simulation for \d+(\.\d)?s/.test(foundBar) && warned && moved !== "p:0.5,0,6" && /Ready to start the simulation/.test(movedBar) && !/simulation for/.test(movedBar) && !warnedAfter && foundAfter === 0,
    `(finder: "${outcome}", bar "${foundBar}" warning=${warned} → moved ${moved}: bar "${movedBar}" warning=${warnedAfter}, "Found!" shown ${foundAfter}×)`,
  );
}
// 20c. The ball stays in its ring. Grow with the panel's first spinner (s:0,-0.3,50,0,20): the spinner's push-out used to
// carry the grown ball's centre across the sealed ring, which then pushed the ball out for good and left the ring empty –
// 50 s into a run at 8× (a countdown caption over a 2-minute clip serves as the run's clock) the white ball still fills the
// ring's inner disc. Lines with a spinner at full speed and length (s:0,0.3,120,0,120): its flings used to throw the ball
// through the sealed ring within seconds, after which nothing was hit again – 20 s and 40 s in, the ball still hits it.
{
  const growLink = `${BASE}/en/simulator/?mode=grow&dur=120&obs=${encodeURIComponent("s:0,-0.3,50,0,20")}&cap=${encodeURIComponent("cd*t*0*0*f*1*ffffff*")}`;
  await page.goto(growLink, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const reached = await page
    .waitForFunction(
      () => {
        const m = /(\d+):(\d\d)/.exec(document.querySelector("main canvas")?.dataset.captionTexts ?? "");
        return !!m && 60 * Number(m[1]) + Number(m[2]) <= 70;
      },
      null,
      { timeout: 60000 },
    )
    .then(() => true)
    .catch(() => false);
  /** Share of the ring's inner disc (80 % of its radius, device pixels) drawn bright – the white ball. */
  const lit = await page.evaluate(() => {
    const canvas = document.querySelector("main canvas");
    const c = canvas.getContext("2d");
    const r = (Math.min(canvas.width, canvas.height) / 2) * 0.75 * 0.8;
    const size = Math.max(1, Math.round(2 * r));
    const data = c.getImageData(Math.round(canvas.width / 2 - r), Math.round(canvas.height / 2 - r), size, size).data;
    let inside = 0;
    let bright = 0;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - size / 2;
        const dy = y + 0.5 - size / 2;
        if (dx * dx + dy * dy > r * r) continue;
        inside++;
        const i = 4 * (y * size + x);
        if (data[i] + data[i + 1] + data[i + 2] > 3 * 180) bright++;
      }
    }
    return inside ? bright / inside : 0;
  });
  await page.screenshot({ path: path.join(outDir, "sim-obstacles-grow.png") });
  check("Grow with the panel's first spinner keeps its grown ball inside the ring (50 s in at 8×)", reached && lit > 0.3, `(50 s reached=${reached}, ${(100 * lit).toFixed(1)} % of the ring's inner disc lit)`);

  await page.goto(`${BASE}/en/simulator/?mode=lines&dur=120&obs=${encodeURIComponent("s:0,0.3,120,0,120")}&cap=${encodeURIComponent("cd*t*0*0*f*1*ffffff*")}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  /** The spinner's hit count once the countdown shows `left` seconds or less (−1 when it never got there). */
  const hitsAt = async (left) => {
    const ok = await page
      .waitForFunction(
        (l) => {
          const m = /(\d+):(\d\d)/.exec(document.querySelector("main canvas")?.dataset.captionTexts ?? "");
          return !!m && 60 * Number(m[1]) + Number(m[2]) <= l;
        },
        left,
        { timeout: 60000 },
      )
      .then(() => true)
      .catch(() => false);
    return ok ? Number((await canvasData()).obstacleHits ?? -1) : -1;
  };
  const hits20 = await hitsAt(100);
  const hits40 = await hitsAt(80);
  check("Lines with a spinner at full speed and length keeps the ball in the ring: it still hits the spinner 40 s in", hits20 > 0 && hits40 > hits20, `(spinner hits 20 s in: ${hits20}, 40 s in: ${hits40})`);
}
// --- end obstacle-editor ---

// --- obstacle-editor + captions ---
// 21. Obstacles and captions together: one link fills both sections and, before the start, the ready bar keeps the
// obstacles editable; a run draws the captions over the obstacles in play (hits counted, editing off); a mode change
// keeps both in the link.
{
  const layout = "p:0.5,0,6;b:0.22,0,12;s:0,-0.5,50,0,30";
  const cap = ["cd*t*0*0*p*1.2*ffffff*000000", "wc*t*0*0*s*1*93d119*000000"].join(",");
  const link = `${BASE}/en/simulator/?mode=classic&dur=30&obs=${encodeURIComponent(layout)}&cap=${encodeURIComponent(cap)}`;
  await page.goto(link, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Obstacles/ }).first().click();
  const obstacleRows = await page.getByTestId("obstacle-row").count();
  await page.getByRole("button", { name: /Captions/ }).first().click();
  const captionRows = await page.getByTestId("caption-row").count();
  const readyBar = await page.getByTestId("obstacle-ready-bar").isVisible();
  const editing = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.obstacleEditing === "1", null, { timeout: 5000 }).then(() => true).catch(() => false);
  check("one link fills the Obstacles and the Captions sections; the obstacles stay editable before the start", obstacleRows === 3 && captionRows === 2 && readyBar && editing, `(obstacle rows=${obstacleRows}, caption rows=${captionRows}, bar=${readyBar}, editing=${editing})`);
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const hit = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.obstacleHits ?? 0) > 0, null, { timeout: 30000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const texts = data.captionTexts ?? "";
  check(
    "a run draws the captions over the obstacles in play",
    hit && Number(data.captions) === 2 && /Wall \d\/7/.test(texts) && /\b\d:\d\d\b/.test(texts) && data.obstacles === "3" && data.obstacleEditing === "0",
    `(hits=${data.obstacleHits}, ${data.captions} captions: "${texts}", obstacles=${data.obstacles}, editing=${data.obstacleEditing})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-obstacles-captions.png") });
  await page.goto(link, { waitUntil: "networkidle" });
  await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
  await page.waitForTimeout(500);
  const after = new URL(page.url()).searchParams;
  check("obstacles and captions both carry over a mode change", after.get("mode") === "portal" && after.get("obs") === layout && after.get("cap") === cap, `(mode=${after.get("mode")}, obs=${after.get("obs")}, cap=${(after.get("cap") ?? "").slice(0, 60)})`);
}
// --- end obstacle-editor + captions ---

// --- jdm-double-pendulum ---
// 22. Double Pendulum Harp & sparring: the preview image, URL → the "Double pendulum" block of the Mode row, controls →
// URL, the search box, the finder (Endless hides it; the clip length decides the run length, so a matching target is
// found with the first seed – keeping the clip length – and a missing one is explained), a default run at 30+ fps whose
// notes all belong to the harp's C major ladder (OscillatorNode.start is instrumented) with the energy held
// (data-dp-drift), a sparring run whose mirrored pendulums hit each other, a triple pendulum on a radial harp, a
// 10 s clip at 8× that finishes after its finale and, restarted, plucks the harp through the whole clip again, and a
// stiff light-over-heavy rig at 8× whose energy holds within 10 ppm.
{
  const res = await page.request.get(`${BASE}/modes/doublePendulum.webp`);
  check("asset /modes/doublePendulum.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
}
{
  /** The On/Off button of a toggle in the Double pendulum block, by the start of its label (tooltips mention other toggles). */
  const dpToggle = (label) => page.getByTestId("double-pendulum").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dpn=3&dpsg=3&dprs=0&dpa1=100&dpa3=-45&dpst=16&dpsl=radial&dpo=3&dptr=6&dpd=0.0015&dpen=1`, { waitUntil: "networkidle" });
  {
    const values = { dpn: await sliderValue("Pendulums"), dpa1: await sliderValue("Start Angle 1"), dpa3: await sliderValue("Start Angle 3"), dpst: await sliderValue("Harp Strings"), dpo: await sliderValue("Harp Octaves"), dptr: await sliderValue("Trail Length"), dpd: await sliderValue("Friction") };
    const triple = await page.getByRole("group", { name: "Arms", exact: true }).getByRole("button", { name: "Triple", exact: true }).getAttribute("aria-pressed");
    const radial = await page.getByRole("group", { name: "String Layout", exact: true }).getByRole("button", { name: /Radial/ }).getAttribute("aria-pressed");
    const endless = await dpToggle("Endless").getAttribute("aria-pressed");
    const randomStart = await dpToggle("Random Start").getAttribute("aria-pressed");
    const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
    check(
      "double pendulum loads from URL",
      values.dpn === "3" && values.dpa1 === "100" && values.dpa3 === "-45" && values.dpst === "16" && values.dpo === "3" && values.dptr === "6" && values.dpd === "0.0015" && triple === "true" && radial === "true" && endless === "true" && randomStart === "false" && finderHidden,
      `(${JSON.stringify(values)}, triple=${triple}, radial=${radial}, endless=${endless}, random=${randomStart}, finder hidden=${finderHidden})`,
    );
  }
  await page.locator('input[aria-label="Harp Strings"]').evaluate(setRangeValue, "9");
  await page.getByRole("group", { name: "String Layout", exact: true }).getByRole("button", { name: /Vertical/ }).click();
  await dpToggle("Sparring").click();
  await dpToggle("Endless").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    const countDisabled = await page.locator('input[aria-label="Pendulums"]').isDisabled();
    check(
      "double pendulum mirrors into the URL",
      /(^|&)dpst=9(&|$)/.test(query) && /(^|&)dpsp=1(&|$)/.test(query) && /(^|&)dpd=0.0015(&|$)/.test(query) && /(^|&)dpsg=3(&|$)/.test(query) && !/(^|&)dpsl=/.test(query) && !/(^|&)dpen=/.test(query) && finderShown && countDisabled,
      `(${query}, finder shown=${finderShown}, count disabled while sparring=${countDisabled})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("harp octaves");
  check("search finds the double pendulum controls", (await page.locator('input[aria-label="Harp Octaves"]').isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
}
// The run always lasts the clip length: a 30 s clip is found with the first seed, a 12 s clip is explained.
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
{
  const found = await page.getByText(/Ready to start simulation for 30\.0s/).first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  // The clip length is the run length: the found seed keeps it (no rounding up to a 31 s clip).
  const query = page.url().split("?")[1] || "";
  check("finder finds a double pendulum run of the clip length at once, keeping the clip length", found && !/(^|&)dur=/.test(query), `(found=${found}, ${query})`);
}
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dur=12`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
{
  const shown = await page.getByText(/Double Pendulum run always lasts exactly 12\.0s/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("finder explains a double pendulum run fixed by the clip length", shown);
  if (shown) await page.getByRole("button", { name: "Try again", exact: true }).click();
}
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__dpOsc = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function () {
    if (this.frequency.value !== 1) log.push(this.frequency.value);
    return start.apply(this, arguments);
  };
});
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(500);
{
  // Frame intervals over 4 s of the default harp (one double pendulum, 15 strings, a 4 s trail), in half-second windows.
  const deltas = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    4000,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  const minWindow = Math.min(...windows);
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__dpOsc);
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  // 15 strings over two octaves of C major from C4 (the chromatic default leaves them unsnapped).
  const ladder = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
  const onLadder = pitches.length > 0 && midis.every((m) => ladder.includes(m));
  check(
    "simulator mode=doublePendulum plucks the harp at 30+ fps",
    data.dpPendulums === "1" && data.dpSegments === "2" && data.dpStrings === "15" && data.dpLayout === "vertical" && Number(data.dpPlucks) >= 20 && onLadder && Number(data.dpDrift) < 100 && windows.length >= 6 && minWindow >= fpsFloor(30),
    `(${data.dpPlucks} plucks, ${pitches.length} tones, MIDI ${[...new Set(midis)].sort((a, b) => a - b).join("/")}, drift ${data.dpDrift} ppm, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-double-pendulum.png") });
}
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dpsp=1&dprs=0&dpa1=45&dpa2=90&dpst=0&dpen=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const hit = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.dpHits ?? 0) > 0, null, { timeout: 15000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  const data = await canvasData();
  check("double pendulum spars: two mirrored pendulums hit each other, the energy held", hit && data.dpPendulums === "2" && data.dpSpar === "1" && Number(data.dpHits) > 0 && data.dpPlucks === "0" && Number(data.dpDrift) < 100, `(${JSON.stringify(data)})`);
  await page.screenshot({ path: path.join(outDir, "sim-double-pendulum-spar.png") });
}
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dpsg=3&dpn=2&dpsl=radial&dpst=12`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
{
  const plucked = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.dpPlucks ?? 0) > 3, null, { timeout: 15000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("double pendulum runs two triple pendulums on a radial harp", plucked && data.dpSegments === "3" && data.dpPendulums === "2" && data.dpLayout === "radial" && data.dpStrings === "12", `(${JSON.stringify(data)})`);
  await page.screenshot({ path: path.join(outDir, "sim-double-pendulum-triple.png") });
}
// A 10 s clip at 8×: the finale holds the rig under the "TIME!" banner, then the run finishes at the clip length.
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dur=10`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const time = await page.locator("span.tabular-nums").first().innerText();
  check("a double pendulum run finishes at the clip length after its finale", done && data.dpDone === "1" && Number(data.dpPlucks) > 20 && Number(data.dpDrift) < 100, `(finished=${done}, elapsed ${time}, ${JSON.stringify(data)})`);
  // Restart Simulation re-inits the same mode instance: the new run starts with still strings and plucks the harp
  // through the whole clip again (the previous run's pluck times, on its own clock, used to mute every string for as
  // long as that run had lasted – the restarted clip played a pluck or two).
  if (done) {
    const restartButton = page.getByRole("button", { name: /Restart Simulation/ });
    await restartButton.click();
    await restartButton.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    const again = await restartButton.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    const second = await canvasData();
    check("a restarted double pendulum run plucks the harp again", again && second.dpDone === "1" && Number(second.dpPlucks) > 20, `(first run ${data.dpPlucks} plucks, restarted run ${second.dpPlucks} plucks, finished=${again})`);
  }
}
// A light bob over a heavy one (masses 0.2 over 5, arms 0.2 and 1, gravity 3) is stiff – its light joint whips round at
// hundreds of rad/s – yet without friction the energy holds (data-dp-drift, ppm of Σm·g·L; sub-steps sized from the
// rates at the start of a step alone let this rig lose percents of its energy within a minute) and the harp plays on.
await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dpm1=0.2&dpm2=5&dpl1=0.2&dpg=3&dpen=1`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  let worst = 0;
  let samples = 0;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(250);
    const d = await canvasData();
    if (d.dpDrift !== undefined) {
      worst = Math.max(worst, Number(d.dpDrift));
      samples++;
    }
  }
  const data = await canvasData();
  check("a light-over-heavy double pendulum holds its energy without friction", samples >= 20 && worst <= 10 && Number(data.dpPlucks) > 20 && data.dpDone !== "1", `(worst drift ${worst} ppm over ${samples} samples, ${JSON.stringify(data)})`);
}
// --- end jdm-double-pendulum ---
// --- jdm-illusions ---
// 23. Circle Illusion and Wobbly Walls: the preview image and the card; URL → the Illusion block of the Mode row (type,
// count, speed, tracks, reveal, cycles) and the Wobbly Walls slider of the Visual section, controls → URL, the search
// box, the finder (a fixed-length rings run says so, the nested circles hide it); a lines run whose balls stay exactly on
// the hidden rolling circle while every rim touch plays a C-major degree (OscillatorNode.start is instrumented); a rings
// run that lines up; nested circles that collide and wobble; a white-spaces run at 8× that reveals its picture – read
// back from the canvas pixels: the probe inside the picture bright, the painted arena dark – and holds it before the end
// screen; the frame rate of every type's defaults; Wobbly Walls in Classic.
{
  const res = await page.request.get(`${BASE}/modes/illusion.webp`);
  check("asset /modes/illusion.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  check("the Circle Illusion card is on the landing page", (await page.locator('img[src$="/modes/illusion.webp"]').count()) === 1);
}
{
  const illusionToggle = (label) => page.getByTestId("illusion-section").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  const typeButton = (name) => page.getByRole("group", { name: "Illusion", exact: true }).getByRole("button", { name: new RegExp(name) });
  await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=rings&ilr=6&ils=1.5&ilc=2&iltr=0&ilrv=1&wob=0.5`, { waitUntil: "networkidle" });
  {
    const values = { ilr: await sliderValue("Rings"), ils: await sliderValue("Illusion Speed"), ilc: await sliderValue("Cycles") };
    const rings = await typeButton("Rings").getAttribute("aria-pressed");
    const tracks = await illusionToggle("Tracks").getAttribute("aria-pressed");
    const reveal = await illusionToggle("Reveal").getAttribute("aria-pressed");
    const cycle = await page.getByTestId("illusion-cycle").innerText();
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0 && (await page.locator('input[aria-label="Balls"]').count()) === 0;
    await page.getByRole("button", { name: /Visual Effects/ }).click();
    const wob = await sliderValue("Wobbly Walls");
    check(
      "circle illusion loads from URL",
      values.ilr === "6" && values.ils === "1.5" && values.ilc === "2" && rings === "true" && tracks === "false" && reveal === "true" && /16s/.test(cycle) && noRingControls && wob === "0.5",
      `(${JSON.stringify(values)}, rings=${rings}, tracks=${tracks}, reveal=${reveal}, "${cycle}", wobble=${wob})`,
    );
    // Two cycles of 16 s always last 32 s: the finder says so at once instead of testing seeds.
    await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
    const shown = await page.getByText(/Circle Illusion always lasts exactly 32\.0s/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    check("finder explains a fixed-length illusion run", shown);
    if (shown) await page.getByRole("button", { name: "Try again", exact: true }).click();
  }
  await typeButton("Lines").click();
  await page.locator('input[aria-label="Balls"]').evaluate(setRangeValue, "12");
  await page.locator('input[aria-label="Cycles"]').evaluate(setRangeValue, "0");
  await page.locator('input[aria-label="Wobbly Walls"]').evaluate(setRangeValue, "0.8");
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
    check("circle illusion mirrors into the URL", !/(^|&)ilt=/.test(query) && /(^|&)ilb=12(&|$)/.test(query) && !/(^|&)ilc=/.test(query) && /(^|&)wob=0.8(&|$)/.test(query) && /(^|&)ilrv=1(&|$)/.test(query) && finderHidden, `(${query}, finder hidden=${finderHidden})`);
  }
  await page.getByPlaceholder("Search settings...").fill("hidden picture");
  const pictureFound = await page.locator("#illusion-pattern-select").isVisible();
  await page.getByPlaceholder("Search settings...").fill("wobbly");
  const wobbleFound = await page.locator('input[aria-label="Wobbly Walls"]').isVisible();
  check("search finds the illusion controls and Wobbly Walls", pictureFound && wobbleFound && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
}
const instrumentOscillators = () =>
  page.evaluate(() => {
    const log = [];
    window.__ilOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push(this.frequency.value);
      return start.apply(this, arguments);
    };
  });
{
  // Lines: 8 balls, 4 s a cycle – a touch every quarter second, each ball its own C-major degree from C4.
  await page.goto(`${BASE}/en/simulator/?mode=illusion&ilrv=1`, { waitUntil: "networkidle" });
  await instrumentOscillators();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  let worstError = 0;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    worstError = Math.max(worstError, Number((await canvasData()).illusionCircleError));
  }
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__ilOsc);
  const midis = new Set(pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440))));
  const major = [60, 62, 64, 65, 67, 69, 71, 72];
  check(
    "the lines illusion keeps every ball on the hidden rolling circle and plays a note per rim touch",
    data.illusionType === "lines" && data.illusionBodies === "8" && Number(data.illusionNotes) >= 8 && worstError < 0.01 && pitches.length > 0 && [...midis].every((m) => major.includes(m)) && midis.size >= 6 && data.wobble === undefined,
    `(${JSON.stringify(data)}, worst circle error ${worstError}px, ${pitches.length} tones, MIDI ${[...midis].sort((a, b) => a - b).join("/")})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-illusion-lines.png") });
}
{
  // Rings at 3×: a cycle of 8 s, the balls line up once per cycle.
  await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=rings&ils=3&ilrv=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "4x", exact: true }).click();
  const aligned = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.illusionAlignments ?? 0) >= 1, null, { timeout: 20000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("the rings illusion bounces and lines up every cycle", aligned && data.illusionType === "rings" && Number(data.illusionNotes) > 40, `(${JSON.stringify(data)})`);
  await page.screenshot({ path: path.join(outDir, "sim-illusion-rings.png") });
}
{
  // Nested: the circles collide and their walls wobble even with Wobbly Walls at 0; the run is endless, so no finder.
  await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=nested`, { waitUntil: "networkidle" });
  const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const wobbled = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.wobble ?? 0) >= 1, null, { timeout: 10000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  const data = await canvasData();
  check("the nested circles collide, play and wobble; the finder is hidden", wobbled && finderHidden && data.illusionBodies === "3" && Number(data.illusionCollisions) > 0 && Number(data.illusionNotes) > 0, `(${JSON.stringify(data)}, finder hidden=${finderHidden})`);
  await page.screenshot({ path: path.join(outDir, "sim-illusion-nested.png") });
}
{
  // White spaces at 8×: the balls paint until the picture is revealed; the picture stays bright, the paint is dark,
  // and the end screen waits for the reveal.
  await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=whitespace&ilp=8`, { waitUntil: "networkidle" });
  const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const revealed = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.illusionFinished === "1", null, { timeout: 45000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(400);
  const data = await canvasData();
  const pixels = await page.evaluate(() => {
    const c = document.querySelector("main canvas");
    const g = c.getContext("2d");
    const dpr = c.width / c.getBoundingClientRect().width;
    const at = (s) => {
      const [x, y] = (s || "0,0").split(",").map(Number);
      return Array.from(g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data).slice(0, 3);
    };
    return { picture: at(c.dataset.illusionProbe), paint: at(c.dataset.illusionPaper) };
  });
  const endScreenHeld = !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible());
  await page.screenshot({ path: path.join(outDir, "sim-illusion-whitespace.png") });
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  check(
    "white spaces: the balls paint the arena and reveal the hidden picture, held before the end screen",
    finderShown && revealed && Number(data.illusionCoverage) >= 98 && !!data.illusionPattern && (pixels.picture[0] + pixels.picture[1] + pixels.picture[2]) / 3 > 140 && pixels.paint.every((v) => v < 60) && endScreenHeld && endScreen,
    `(finder shown=${finderShown}, ${JSON.stringify(data)}, picture px ${pixels.picture}, paint px ${pixels.paint}, held=${endScreenHeld}, end screen=${endScreen})`,
  );
}
{
  // Few painters or big ones reach every pocket: two painters on the cross (once stuck at 84–97 % for minutes) and a smile
  // painted with Ball Size 16 (once 97.7 % forever) are revealed – rebounds steer toward white they can reach, and from
  // 90 % a run in which no new cell is found for 6 s is revealed as well.
  const outcomes = {};
  for (const [name, query] of [
    ["cross, 2 painters", "ilpt=cross&ilp=2"],
    ["smile, ball size 16", "ilpt=smile&ilp=5&r=16"],
  ]) {
    await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=whitespace&${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    const revealed = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.illusionFinished === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
    const d = await canvasData();
    outcomes[name] = { revealed, coverage: d.illusionCoverage, pattern: d.illusionPattern };
  }
  check("white spaces reach every pocket: two painters on a cross, big painters on a smile", Object.values(outcomes).every((o) => o.revealed && Number(o.coverage) >= 90), `(${JSON.stringify(outcomes)})`);
}
{
  // The defaults of every type keep the frame rate (headless Chromium; 30+ fps on average over 3 s, fpsFloor() on a busy machine).
  const rates = {};
  for (const type of ["lines", "rings", "nested", "whitespace"]) {
    await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=${type}&wob=1`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(500);
    rates[type] = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const frame = (t) => {
            frames++;
            if (t - start < ms) requestAnimationFrame(frame);
            else resolve(Math.round((1000 * frames) / (t - start)));
          };
          requestAnimationFrame(frame);
        }),
      3000,
    );
  }
  check("every illusion type keeps 30+ fps with wobbly walls", Object.values(rates).every((fps) => fps >= fpsFloor(30)), `(${JSON.stringify(rates)}, floor ${fpsFloor(30)}${loadNote()})`);
}
{
  // Wobbly Walls in a ring mode: the rings deform where the ball hits them (data-wobble counts the walls wobbling), off by default.
  await page.goto(`${BASE}/en/simulator/?mode=classic&wob=1&s=700`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const wobbled = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.wobble ?? 0) >= 1, null, { timeout: 10000 }).then(() => true).catch(() => false);
  await page.screenshot({ path: path.join(outDir, "sim-classic-wobble.png") });
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1500);
  const plain = await canvasData();
  check("Wobbly Walls make the rings of Classic wobble (and are off by default)", wobbled && plain.wobble === undefined, `(wobbled=${wobbled}, default data-wobble=${plain.wobble})`);
}
{
  // The cap: a Shatter ball wedged between two rings touches both every step, yet no ring moves further than its full
  // amplitude (data-wobble-peak ≤ 1 of it, data-wobble-max-px ≤ WOBBLE_MAX_PX = 30 px at Wobbly Walls 1) – one wave per
  // contact once piled up into bulges bent across the neighbouring rings.
  await page.goto(`${BASE}/en/simulator/?mode=shatter&wob=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  let wobbled = false;
  for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(250);
    if (Number((await canvasData()).wobble ?? 0) >= 1) wobbled = true;
  }
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-shatter-wobble.png") });
  check("Wobbly Walls never bend a Shatter ring past its amplitude", wobbled && Number(data.wobbleMaxPx) > 0 && Number(data.wobbleMaxPx) <= 30 && Number(data.wobblePeak) <= 1, `(largest ${data.wobbleMaxPx} px, ${data.wobblePeak} of the amplitude, wobbled=${wobbled})`);
}
{
  // The Collision Playground's circle container is a wall the orbs hit: Wobbly Walls is offered there (not for the box,
  // which has no circular wall) and the circle bulges where an orb hits it (wall 0 of data-wobble).
  await page.goto(`${BASE}/en/simulator/?mode=collide&cpc=box&wob=0.6`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Visual Effects/ }).click();
  const boxSlider = await page.locator('input[aria-label="Wobbly Walls"]').count();
  await page.goto(`${BASE}/en/simulator/?mode=collide&wob=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Visual Effects/ }).click();
  const circleSlider = await sliderValue("Wobbly Walls").catch(() => null);
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const wobbled = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.wobble ?? 0) >= 1, null, { timeout: 15000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-collide-wobble.png") });
  check(
    "Wobbly Walls in the Collision Playground: offered for the circle container (not the box), which wobbles where orbs hit it",
    boxSlider === 0 && circleSlider === "1" && wobbled && Number(data.wobblePeak) <= 1,
    `(box slider ${boxSlider}, circle slider ${circleSlider}, wobbled=${wobbled}, data-wobble ${data.wobble}, peak ${data.wobblePeak}, ${data.wobbleMaxPx} px)`,
  );
}
// --- end jdm-illusions ---
// --- rigged ---
// 24. Rigged outcomes: URL → the Rigged Outcomes group under the Drama Director (advanced options) with its storytelling
// warning and the note under the canvas, controls → URL, the search box; a Never Escape run at 8× in which the rig acts
// and no ball escapes; a three-team race won by the Forced Winner – in Classic, in Shatter (nobody else gets out), with
// merging balls (the run ends) and with x2 BALLS orbs (the rivals do not out-escape it); Never Escape switching the Forced
// Winner off in Shatter but not in Classic; Find Simulation's Outcome select – a run without an escape in Classic, a
// first escape at a chosen second in Multiply (whose finder shows now) and a won race.
{
  const rigQuery = () => new URLSearchParams(page.url().split("?")[1] || "");
  const finderResult = async (timeout = 120_000) => {
    const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout }).then(() => true).catch(() => false);
    return done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  };
  await page.goto(`${BASE}/en/simulator/?mode=classic&ne=1&wc=3&gap=0.6`, { waitUntil: "networkidle" });
  await page.getByLabel("Show advanced options").check();
  await page.getByRole("button", { name: /Visual Effects/ }).click();
  const section = page.getByTestId("rigged-section");
  const neverToggle = section.locator('label:has-text("Never Escape") + button');
  {
    const shown = await section.isVisible();
    const pressed = await neverToggle.getAttribute("aria-pressed").catch(() => null);
    const warning = await page.getByTestId("rigged-warning").isVisible();
    const note = await page.getByTestId("rigged-note").innerText().catch(() => "");
    check("rigged outcomes load from the URL", shown && pressed === "true" && warning && /no ball can escape/.test(note), `(section=${shown}, never escape=${pressed}, warning=${warning}, note="${note}")`);
  }
  await neverToggle.click();
  await page.waitForTimeout(300);
  const offQuery = rigQuery();
  const noteGone = (await page.getByTestId("rigged-note").count()) === 0;
  await neverToggle.click();
  await page.waitForTimeout(300);
  check("never escape mirrors into the URL", !offQuery.has("ne") && noteGone && rigQuery().get("ne") === "1", `(off: ne=${offQuery.get("ne")}, note gone=${noteGone}; on: ne=${rigQuery().get("ne")})`);
  await page.getByPlaceholder("Search settings...").fill("forced winner");
  check("search finds the forced winner", (await page.locator("#forced-winner-select").isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  await page.waitForTimeout(12_000);
  {
    const data = await canvasData();
    const ended = await page.getByRole("button", { name: /Restart Simulation/ }).isVisible();
    const acted = Number(data.rigSteers) + Number(data.rigGuides) + Number(data.rigSeals);
    await page.screenshot({ path: path.join(outDir, "sim-rigged-never-escape.png") });
    check(
      "a Never Escape run at 8× keeps every ball in while the rig steers",
      data.rigNeverEscape === "1" && data.firstEscape === "-1" && !ended && acted > 0,
      `(${JSON.stringify({ never: data.rigNeverEscape, firstEscape: data.firstEscape, steers: data.rigSteers, guides: data.rigGuides, seals: data.rigSeals, nearMisses: data.rigNearMisses })}, ended=${ended})`,
    );
  }
  // A three-team race – three rings with wide gaps and fast balls, as in section 14 – that Green is set to win.
  const roster = "Red*ef4444*🔥,Blue*3b82f6*💧,Green*22c55e*🍀";
  await page.goto(`${BASE}/en/simulator/?mode=classic&teams=${encodeURIComponent(roster)}&fw=2&wc=3&gap=0.8&s=700`, { waitUntil: "networkidle" });
  const winnerNote = await page.getByTestId("rigged-note").innerText().catch(() => "");
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const won = await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 45_000 }).then(() => true).catch(() => false);
    const data = await canvasData();
    await page.screenshot({ path: path.join(outDir, "sim-rigged-winner.png") });
    check("a Forced Winner race is won by the chosen team", won && data.teamWinner === "Green" && data.rigWinner === "2" && /Green wins/.test(winnerNote), `(winner=${data.teamWinner}, rig winner=${data.rigWinner}, stats=${data.teamStats}, note="${winnerNote}")`);
  }
  // The story carries over a mode change, with the roster it belongs to.
  await page.locator('[role="button"]', { hasText: "Shatter" }).first().click();
  await page.waitForTimeout(500);
  {
    const after = rigQuery();
    check("the rig carries over a mode change", after.get("mode") === "shatter" && after.get("fw") === "2" && after.get("teams") === roster, `(mode=${after.get("mode")}, fw=${after.get("fw")}, teams=${after.get("teams")})`);
  }
  /** Plays the linked race at 8× until the winner banner and returns the canvas data (per-team "bounces/walls/escapes" in teamStats). */
  const rigRace = async (query, timeout = 60_000) => {
    await page.goto(`${BASE}/en/simulator/?${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    const won = await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout }).then(() => true).catch(() => false);
    const data = await canvasData();
    const escapes = (data.teamStats || "").split(",").map((t) => Number(t.split("/")[2]));
    return { won, data, escapes };
  };
  // Shatter ends with the first escape: the way out stays shut to the others until the run is over (not only until the
  // chosen ball enters its gap or is counted out), so nobody else escapes and Green wins.
  {
    const { won, data, escapes } = await rigRace(`mode=shatter&teams=${encodeURIComponent(roster)}&fw=2&s=700`);
    check("a Forced Winner Shatter race is won by the chosen team and nobody else gets out", won && data.teamWinner === "Green" && data.rigWinner === "2" && escapes[2] >= 1 && escapes[0] === 0 && escapes[1] === 0, `(winner=${data.teamWinner}, stats=${data.teamStats})`);
  }
  // The merge interaction fuses balls: the chosen ball is never merged out of the story (the merged ball plays on for
  // Green), so the run ends – it used to hold the others in forever once Green's ball was absorbed.
  {
    const { won, data } = await rigRace(`mode=classic&teams=${encodeURIComponent(roster)}&fw=2&wc=3&gap=0.8&s=700&bi=merge`);
    check("a Forced Winner race with merging balls ends, won by the chosen team", won && data.teamWinner === "Green", `(winner=${data.teamWinner || "none – the run did not end"}, stats=${data.teamStats})`);
  }
  // x2 BALLS orbs clone only the chosen team's balls in Classic, where every ball escapes: the rivals cannot out-escape it.
  {
    const { won, data, escapes } = await rigRace(`mode=classic&teams=${encodeURIComponent(roster)}&fw=2&wc=3&gap=0.8&s=700&mpk=1&mpty=balls&mpr=3`);
    check("x2 BALLS orbs do not let the rivals out-escape a Forced Winner", won && data.teamWinner === "Green" && escapes[0] <= 1 && escapes[1] <= 1, `(winner=${data.teamWinner}, stats=${data.teamStats})`);
  }
  // Never Escape keeps everyone in: where the chosen team can only win by escaping (Shatter) the Forced Winner is off –
  // the note under the canvas does not claim the win, the panel says why and the rig mirrors no winner. Classic keeps both.
  await page.goto(`${BASE}/en/simulator/?mode=shatter&teams=${encodeURIComponent(roster)}&fw=2&ne=1`, { waitUntil: "networkidle" });
  {
    const note = await page.getByTestId("rigged-note").innerText().catch(() => "");
    await page.getByLabel("Show advanced options").check();
    await page.getByRole("button", { name: /Visual Effects/ }).click();
    const why = await page.getByTestId("forced-winner-never-escape").isVisible().catch(() => false);
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(800);
    const data = await canvasData();
    await page.locator('[role="button"]', { hasText: "Classic" }).first().click();
    await page.waitForTimeout(500);
    const classicNote = await page.getByTestId("rigged-note").innerText().catch(() => "");
    const whyInClassic = await page.getByTestId("forced-winner-never-escape").isVisible().catch(() => false);
    check(
      "Never Escape switches the Forced Winner off where the win needs an escape (Shatter), not in Classic",
      /no ball can escape/.test(note) && !/wins/.test(note) && why && data.rigWinner === "-1" && data.rigNeverEscape === "1" && /no ball can escape/.test(classicNote) && /Green wins/.test(classicNote) && !whyInClassic,
      `(Shatter note "${note}", hint=${why}, rig winner=${data.rigWinner}; Classic note "${classicNote}", hint=${whyInClassic})`,
    );
  }
  // Find Simulation: a Classic run without an escape for the whole clip.
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  {
    const options = await page.locator("#find-outcome option").evaluateAll((els) => els.map((e) => e.value));
    await page.locator("#find-outcome").selectOption("never-escapes");
    const button = page.getByRole("button", { name: /Find a 30s Run Without an Escape/ });
    const labelled = await button.isVisible();
    await button.click();
    const text = await finderResult();
    const ready = await page.getByText(/Ready to start simulation for 30\.0s/).first().isVisible().catch(() => false);
    check("Find Simulation finds a run without an escape", options.join(",") === "duration,never-escapes,escapes-at" && labelled && /Found! No escape in 30\.0s/.test(text) && ready, `(options=${options.join(",")}, "${text}", ready=${ready})`);
  }
  // Multiply never ends, so it had no finder; its outcomes give it one: the first escape at a chosen second.
  await page.goto(`${BASE}/en/simulator/?mode=multiply`, { waitUntil: "networkidle" });
  {
    const options = await page.locator("#find-outcome option").evaluateAll((els) => els.map((e) => e.value));
    await page.locator("#find-outcome").selectOption("escapes-at");
    await page.locator("#find-escape-at").evaluate(setRangeValue, "4");
    const button = page.getByRole("button", { name: /Find a Run That Escapes at 4\.0s/ });
    const labelled = await button.isVisible();
    await button.click();
    const text = await finderResult();
    const at = Number((/First escape at ([\d.]+)s/.exec(text) || [])[1]);
    check("Find Simulation finds a first escape at a chosen second in Multiply", options.join(",") === "never-escapes,escapes-at" && labelled && Math.abs(at - 4) <= 0.52, `(options=${options.join(",")}, "${text}")`);
  }
  // A won race, searched for: Blue wins.
  await page.goto(`${BASE}/en/simulator/?mode=classic&teams=${encodeURIComponent(roster)}&wc=3&gap=0.8&s=700`, { waitUntil: "networkidle" });
  {
    await page.locator("#find-outcome").selectOption("winner");
    await page.locator("#find-winner").selectOption("1");
    const button = page.getByRole("button", { name: /Find a Run Blue Wins/ });
    const labelled = await button.isVisible();
    await button.click();
    const text = await finderResult();
    check("Find Simulation finds a race the chosen team wins", labelled && /Found! Blue wins/.test(text), `("${text}")`);
  }
}
// --- end rigged ---
// --- timeline ---
// 25. Timeline keyframes: a link with keyframes fills the Timeline section (a row per keyframe) and the bar under the
// canvas (a marker per keyframe); the sliders of the automated settings show the value the run starts with, locked, with an
// AUTO badge; a run at 8× plays the keyframes on the simulation clock – the engine's values follow them (data-timeline-engine)
// while the link keeps the settings as they were (the automation is never written back); a keyframe added from the panel at
// the current time locks its slider, and it, an edited value and a removed keyframe land in the link; the search box finds
// the section; the keyframes carry over a mode change. Then the engine side: a seed found mid-run with breathing walls and
// keyframes replays as found (the restart re-builds the rings from their base radii); a keyframed gravity rotation turns
// gravity by its integral (never backwards, data-timeline-phase); a breathing speed ramp keeps every ball in Lines' gapless
// ring; a Ball Size ramp scales Grow's growing ball instead of holding it at the keyframed size (data-timeline-ball-radius).
{
  const kf = "g_0_0_4_1500*r_0_8_3_20";
  const autoLabel = (name) => page.locator("label", { has: page.getByTestId("timeline-auto-badge") }).filter({ hasText: name }).first();
  const labelText = async (name) => ((await autoLabel(name).innerText({ timeout: 5000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
  const timelineTime = async () => Number((await page.getByTestId("timeline-bar").getAttribute("data-timeline-time")) ?? -1);
  await page.goto(`${BASE}/en/simulator/?mode=classic&kf=${kf}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Timeline/ }).first().click();
  const rows = page.getByTestId("timeline-row");
  const keys = await rows.evaluateAll((els) => els.map((el) => el.getAttribute("data-key")));
  const markers = await page.getByTestId("timeline-marker").count();
  const barShown = await page.getByTestId("timeline-bar").isVisible();
  check("keyframes from the link fill the Timeline section and the bar under the canvas", keys.join(",") === "gravity,ballRadius,ballRadius,gravity" && markers === 4 && barShown, `(rows=${keys.join(",")}, markers=${markers}, bar=${barShown})`);
  await page.getByRole("button", { name: /Ball & Physics/ }).first().click();
  const sizeSlider = page.getByRole("slider", { name: "Ball Size", exact: true });
  const lockedBefore = await sizeSlider.isDisabled({ timeout: 5000 }).catch(() => false);
  const startValue = await sizeSlider.inputValue({ timeout: 5000 }).catch(() => "");
  const startText = await labelText("Ball Size");
  check("an automated slider shows the value the run starts with, locked, with an AUTO badge", lockedBefore && startValue === "8" && /\b8px\s*AUTO\b/i.test(startText), `(locked=${lockedBefore}, value=${startValue}, label="${startText}")`);
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const reached = await page.waitForFunction(() => Number(document.querySelector('[data-testid="timeline-bar"]')?.dataset.timelineTime ?? 0) > 4.5, null, { timeout: 30000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(300);
  const bar = page.getByTestId("timeline-bar");
  const engineValues = (await bar.getAttribute("data-timeline-engine")) ?? "";
  const liveValues = (await bar.getAttribute("data-timeline-live")) ?? "";
  const playhead = await page.getByTestId("timeline-playhead").evaluate((el) => parseFloat(el.style.left));
  const sizeText = await labelText("Ball Size");
  const linkAfterRun = new URL(page.url()).searchParams;
  check(
    "a run plays the keyframes on the simulation clock without writing them into the settings",
    reached && engineValues === "gravity=1500,ballRadius=20" && liveValues === engineValues && playhead > 0 && /\b20px\s*AUTO\b/i.test(sizeText) && linkAfterRun.get("kf") === kf && !linkAfterRun.has("g") && !linkAfterRun.has("r"),
    `(t>4.5 s=${reached}, engine: ${engineValues}, live: ${liveValues}, playhead ${playhead}%, slider: "${sizeText}", link kf=${linkAfterRun.get("kf")}, g=${linkAfterRun.get("g")}, r=${linkAfterRun.get("r")})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-timeline.png") });
  // Pause (Space), pick Ball Speed, set the value the keyframe gets and add it at the current time.
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: /Timeline/ }).first().click();
  await page.getByTestId("timeline-setting").selectOption("ballSpeed");
  await page.getByTestId("timeline-value-slider").evaluate(setRangeValue, "600");
  const before = await timelineTime();
  await page.getByTestId("timeline-add").click();
  await page.waitForTimeout(400);
  const afterAdd = await timelineTime();
  const added = new URL(page.url()).searchParams.get("kf") ?? "";
  const addedTime = Number(/\*s_([\d.]+)_600\*/.exec(added)?.[1] ?? NaN);
  const rowsAfterAdd = await rows.count();
  await page.getByRole("button", { name: /Ball & Physics/ }).first().click();
  const speedLocked = await page.getByRole("slider", { name: "Ball Speed", exact: true }).isDisabled({ timeout: 5000 }).catch(() => false);
  const speedText = await labelText("Ball Speed");
  check(
    "a keyframe added in the panel at the current time lands in the link and locks its slider",
    addedTime >= before - 0.06 && addedTime <= afterAdd + 0.06 && rowsAfterAdd === 5 && added.startsWith("g_0_0_4_1500*s_") && added.endsWith("*r_0_8_3_20") && speedLocked && /\b600\s*AUTO\b/i.test(speedText),
    `(kf=${added}, clock ${before}–${afterAdd} s, rows=${rowsAfterAdd}, Ball Speed locked=${speedLocked}, label "${speedText}")`,
  );
  // Edit the first keyframe's value (gravity at 0 s) and remove the gravity keyframe at 4 s (the fourth row).
  await page.getByRole("button", { name: /Timeline/ }).first().click();
  const firstValue = rows.first().getByTestId("timeline-value");
  await firstValue.fill("300");
  await firstValue.press("Enter");
  await page.waitForTimeout(300);
  await rows.nth(3).getByRole("button", { name: /Remove keyframe/ }).click();
  await page.waitForTimeout(400);
  const edited = new URL(page.url()).searchParams.get("kf") ?? "";
  const rowsAfterEdit = await rows.count();
  check("an edited value and a removed keyframe land in the link", /^g_0_300\*s_[\d.]+_600\*r_0_8_3_20$/.test(edited) && rowsAfterEdit === 4, `(kf=${edited}, rows=${rowsAfterEdit})`);
  await page.getByPlaceholder("Search settings...").fill("keyframe");
  const found = await page.getByTestId("timeline-section").isVisible().catch(() => false);
  await page.getByPlaceholder("Search settings...").fill("");
  check("the search box finds the Timeline section", found, `(visible=${found})`);
  await page.goto(`${BASE}/en/simulator/?mode=classic&kf=${kf}`, { waitUntil: "networkidle" });
  await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
  await page.waitForTimeout(500);
  const after = new URL(page.url()).searchParams;
  const markersAfter = await page.getByTestId("timeline-marker").count();
  check("keyframes carry over a mode change", after.get("mode") === "portal" && after.get("kf") === kf && markersAfter === 4, `(mode=${after.get("mode")}, kf=${after.get("kf")}, markers=${markersAfter})`);

  /** Waits (at most `timeout` ms) until the bar's simulation clock reaches `sec`; returns the clock it read, −1 on a timeout. */
  const reachTime = (sec, timeout = 60_000) =>
    page
      .waitForFunction((s) => Number(document.querySelector('[data-testid="timeline-bar"]')?.dataset.timelineTime ?? -1) >= s, sec, { timeout })
      .then(timelineTime)
      .catch(() => -1);
  const barData = async () => page.getByTestId("timeline-bar").evaluate((el) => ({ ...el.dataset }));
  const valuesOf = (text) => Object.fromEntries((text || "").split(",").filter(Boolean).map((pair) => pair.split("=")).map(([k, v]) => [k, Number(v)]));

  // A restart re-builds breathing rings from their base radii whatever the old run's clock: a seed found mid-run (3 s
  // in, rotation-speed keyframes, breathing walls) replays on the page's engine exactly as the finder ran it – still
  // going a second before the found length, over a second after it.
  await page.goto(`${BASE}/en/simulator/?mode=classic&bw=0.15&bws=0.5&kf=rs_0_1_20_1.2`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const midRun = await reachTime(3.3);
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const foundText = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 180_000 }).then(() => page.getByText(/Found!|Didn't find simulation/).first().innerText()).catch(() => "timeout");
  const foundSec = Number((/Found! ([\d.]+)s/.exec(foundText) || [])[1]);
  let beforeEnd = -1;
  let runningBefore = false;
  let afterEnd = -1;
  let endedAfter = false;
  if (Number.isFinite(foundSec)) {
    await page.getByRole("button", { name: /Resume/ }).first().click();
    beforeEnd = await reachTime(foundSec - 1.2, 90_000);
    runningBefore = beforeEnd > 0 && !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible());
    afterEnd = await reachTime(foundSec + 1.2, 30_000);
    endedAfter = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  }
  check(
    "a seed found mid-run with breathing walls and keyframes replays as found",
    midRun >= 3.3 && Number.isFinite(foundSec) && runningBefore && afterEnd > 0 && endedAfter,
    `(found at ${midRun}s: "${foundText}"; running at ${beforeEnd}s: ${runningBefore}; ended by ${afterEnd}s: ${endedAfter})`,
  );

  // A keyframed turning rate turns gravity by its integral: 90 °/s, easing to 0 °/s between 10 and 20 s, turns it
  // 900° + 450° – never backwards – and leaves it there (data-timeline-phase: the degrees the engine has turned it).
  await page.goto(`${BASE}/en/simulator/?mode=classic&kf=rg_10_90_20_0`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const turns = [];
  const turnStart = Date.now();
  while (Date.now() - turnStart < 30_000) {
    const d = await barData().catch(() => ({}));
    const t = Number(d.timelineTime ?? -1);
    const turned = valuesOf(d.timelinePhase).rotatingGravity;
    if (Number.isFinite(turned)) turns.push({ t, turned });
    if (t >= 23) break;
    await page.waitForTimeout(150);
  }
  {
    const early = turns.filter((s) => s.t > 1 && s.t < 9.5);
    const monotone = turns.every((s, i) => i === 0 || s.turned >= turns[i - 1].turned - 1e-6);
    const last = turns[turns.length - 1];
    const live = valuesOf((await barData().catch(() => ({}))).timelineLive).rotatingGravity;
    check(
      "a keyframed gravity rotation turns gravity by its integral, never backwards",
      turns.length > 5 && monotone && early.length > 0 && early.every((s) => Math.abs(s.turned - 90 * s.t) < 1) && last.t >= 20 && last.turned === 1350 && live === 0,
      `(${turns.length} samples, monotone=${monotone}, early ${early.map((s) => `${s.t}s:${s.turned}°`).slice(0, 3).join(" ")}, last ${last ? `${last.t}s:${last.turned}°` : "none"}, live rate ${live})`,
    );
  }

  // A pulse speed ramp (0.5 → 3 Hz between 2 and 8 s) at the widest pulse keeps every ball inside Lines' gapless ring –
  // the phase is integrated, so the walls never pulse faster than the keyframes say (no first escape is ever recorded).
  await page.goto(`${BASE}/en/simulator/?mode=lines&bw=0.3&bws=0.5&kf=bws_2_0.5_8_3`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const at = await reachTime(12);
    const d = await barData().catch(() => ({}));
    const t = Number(d.timelineTime ?? -1);
    const pulses = valuesOf(d.timelinePhase).breathingSpeed;
    const data = await canvasData();
    check(
      "a keyframed breathing speed pulses at its keyframed rate and never lets a ball through a gapless ring",
      at >= 12 && data.firstEscape === "-1" && Math.abs(pulses - (11.5 + 3 * (t - 8))) < 0.05,
      `(t=${t}s, pulses=${pulses} (expected ${(11.5 + 3 * (t - 8)).toFixed(3)}), first escape=${data.firstEscape})`,
    );
  }

  // A keyframed Ball Size scales Grow's growing ball instead of holding it at the keyframed size (8 → 12 px over 10 s,
  // the fastest growth): half-way through the ramp the ball is far bigger than the Ball Size, and at its end still growing.
  await page.goto(`${BASE}/en/simulator/?mode=grow&gr=10&kf=r_0_8_10_12`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  {
    const mid = await reachTime(6);
    const m = await barData().catch(() => ({}));
    const midSize = Number(m.timelineBallRadius ?? 0);
    const midBall = valuesOf(m.timelineEngine).ballRadius;
    const end = await reachTime(10.2);
    const d = await barData().catch(() => ({}));
    const size = Number(d.timelineBallRadius ?? 0);
    const engineValues = valuesOf(d.timelineEngine);
    check(
      "a keyframed Ball Size scales a growing ball instead of resetting it",
      mid >= 6 && midBall < 12 && midSize > 3 * midBall && end >= 10.2 && engineValues.ballRadius === 12 && size >= midSize,
      `(t=${mid}s: Ball Size ${midBall}px, largest ball ${midSize}px; t=${end}s: Ball Size ${engineValues.ballRadius}px, largest ball ${size}px)`,
    );
  }
}
// --- end timeline ---

// --- odd-string-battle ---
// 26. String Battle: the preview image and the card under the battle heading; URL → the String Battle block of the Mode row
// (rule, style, fighters, lives, threads, clip limit, finale, wobble, badge), controls → URL, the search box, the finder's
// outcomes; a default battle at 4× that ends with one ball standing – threads cut, lives lost, bounce notes on the pentatonic
// ladder, plucks and shatter noise bursts (OscillatorNode / AudioBufferSourceNode.start instrumented), the badge, the HUD,
// the winner banner, the slow motion on the final cut and a held end screen; the frame rate of the defaults; the neon style
// (the painted moiré, the jelly ring, glitch bars, no HUD); a roster whose rigged Blue wins under the teams banner; and Find
// Simulation's winner outcome.
{
  const res = await page.request.get(`${BASE}/modes/stringBattle.webp`);
  check("asset /modes/stringBattle.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const card = await page.locator('img[src$="/modes/stringBattle.webp"]').count();
  const heading = await page.getByRole("heading", { name: "Battle modes" }).count();
  check("the String Battle card is on the landing page under the battle heading", card === 1 && heading === 1, `(cards=${card}, heading=${heading})`);
}
{
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle&sbn=5&sbl=6&sbm=20&sbr=touch&sbst=neon&sbd=60&sbf=2.4&sbw=0.3&sbb=0`, { waitUntil: "networkidle" });
  const section = page.getByTestId("string-battle-section");
  const pick = (group, name) => section.getByRole("group", { name: group, exact: true }).getByRole("button", { name: new RegExp(name) });
  const toggle = (label) => section.locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  {
    const values = { sbn: await sliderValue("Fighters"), sbl: await sliderValue("Lives"), sbm: await sliderValue("Threads per Ball"), sbd: await sliderValue("Clip Limit"), sbf: await sliderValue("Finale Speed"), sbw: await sliderValue("Ring Wobble") };
    const touch = await pick("Combat Rule", "Touch").getAttribute("aria-pressed");
    const neon = await pick("Style", "Neon").getAttribute("aria-pressed");
    const badge = await toggle("Warning Badge").getAttribute("aria-pressed");
    const noHudToggle = (await toggle("WEB DOMINION HUD").count()) === 0;
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
    const options = await page.locator("#find-outcome option").evaluateAll((els) => els.map((e) => e.value));
    check(
      "string battle loads from URL",
      values.sbn === "5" && values.sbl === "6" && values.sbm === "20" && values.sbd === "60" && values.sbf === "2.4" && values.sbw === "0.3" && touch === "true" && neon === "true" && badge === "false" && noHudToggle && noRingControls && options.join(",") === "duration,winner",
      `(${JSON.stringify(values)}, touch=${touch}, neon=${neon}, badge=${badge}, hud toggle hidden=${noHudToggle}, finder outcomes=${options.join(",")})`,
    );
  }
  await pick("Combat Rule", "Cut").click();
  await pick("Style", "Web").click();
  await page.locator('input[aria-label="Fighters"]').evaluate(setRangeValue, "3");
  await toggle("Warning Badge").click();
  await page.waitForTimeout(300);
  {
    const query = new URLSearchParams(page.url().split("?")[1] || "");
    const hudShown = (await toggle("WEB DOMINION HUD").count()) === 1;
    check(
      "string battle mirrors into the URL",
      query.get("mode") === "stringBattle" && query.get("sbn") === "3" && query.get("sbl") === "6" && !query.has("sbr") && !query.has("sbst") && !query.has("sbb") && query.get("sbd") === "60" && hudShown,
      `(${query.toString()}, hud toggle=${hudShown})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("clip limit");
  const found = await page.locator('input[aria-label="Clip Limit"]').isVisible();
  const hidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the string battle controls", found && hidden, `(clip limit=${found}, ball speed hidden=${hidden})`);
}
{
  // A default battle at 4×: four balls, four lives each, the cut rule, the web style.
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const osc = [];
    const buffers = [];
    window.__sbOsc = osc;
    window.__sbBuffers = buffers;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) osc.push(this.frequency.value);
      return start.apply(this, arguments);
    };
    const play = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      buffers.push(this.buffer ? this.buffer.duration : 0);
      return play.apply(this, arguments);
    };
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  // The frame rate of the defaults at 1×, before the finish.
  const deltas = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    5000,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  const minWindow = Math.min(...windows);
  const early = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-string-battle.png") });
  check(
    "simulator mode=stringBattle anchors threads and runs at 30+ fps",
    early.sbBalls === "4" && Number(early.sbBounces) > 4 && Number(early.sbStrings) > 0 && early.sbBadge === "1" && early.sbHud === "1" && early.sbStyle === "web" && windows.length >= 8 && minWindow >= fpsFloor(30),
    `(${JSON.stringify({ balls: early.sbBalls, bounces: early.sbBounces, strings: early.sbStrings, lives: early.sbLives })}, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`,
  );
  await page.getByRole("button", { name: "4x", exact: true }).click();
  const ended = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.sbFinished === "1", null, { timeout: 60_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  const data = await canvasData();
  const held = !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible());
  await page.screenshot({ path: path.join(outDir, "sim-string-battle-winner.png") });
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  const lives = (data.sbLives || "").split(",").map(Number);
  const winner = Number(data.sbWinner);
  check(
    "a default string battle ends with one ball standing, its winner banner held before the end screen",
    ended && data.sbAlive === "1" && winner >= 0 && lives[winner] > 0 && lives.filter((l) => l === 0).length === 3 && Number(data.sbCuts) >= 12 && Number(data.sbLivesLost) >= 12 && data.sbSlowMos === "1" && data.sbBanner === "1" && !!data.sbWinnerName && held && endScreen,
    `(${JSON.stringify({ alive: data.sbAlive, winner: data.sbWinner, name: data.sbWinnerName, lives: data.sbLives, kills: data.sbKills, cuts: data.sbCuts, lost: data.sbLivesLost, finale: data.sbFinale, speed: data.sbSpeed, strobe: data.sbStrobe })}, held=${held}, end screen=${endScreen})`,
  );
  const pitches = await page.evaluate(() => window.__sbOsc);
  const buffers = await page.evaluate(() => window.__sbBuffers);
  const notes = pitches.filter((f) => f < 1100).map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const ladder = [72, 74, 76, 79, 81, 84];
  const tinkles = pitches.filter((f) => Math.abs(f - 2637.02) < 1 || Math.abs(f - 3520) < 1 || Math.abs(f - 4186.01) < 1).length;
  check(
    "string battle bounces play one pentatonic degree per ball, cuts pluck and shatters burst",
    notes.length > 10 && notes.every((m) => ladder.includes(m)) && new Set(notes).size >= 3 && tinkles >= 9 && buffers.length >= 3 + 1,
    `(${notes.length} notes, MIDI ${[...new Set(notes)].sort((a, b) => a - b).join("/")}, ${tinkles} shard tinkles, ${buffers.length} buffer sources)`,
  );
}
{
  // The neon style: endless lines painted into a layer that is never cleared, the jelly ring, glitch bars, no HUD.
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle&sbst=neon`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "2x", exact: true }).click();
  const wobbled = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.sbWobble === "1", null, { timeout: 15_000 }).then(() => true).catch(() => false);
  const glitched = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.sbGlitches ?? 0) >= 1, null, { timeout: 30_000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(400);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-string-battle-neon.png") });
  const reduced = data.sbReducedMotion === "1";
  check(
    "the neon string battle paints moiré lines, wobbles its ring and glitches on a lost life",
    data.sbStyle === "neon" && Number(data.sbPainted) > 100 && wobbled && (glitched || reduced) && data.sbHud === "0" && data.sbBadge === "1",
    `(${JSON.stringify({ painted: data.sbPainted, glitches: data.sbGlitches, wobble: wobbled, hud: data.sbHud, lost: data.sbLivesLost, reduced: data.sbReducedMotion })})`,
  );
}
{
  // A roster: Red and Blue (the other two balls take the palette); Blue is the Forced Winner, and the teams banner crowns it.
  const roster = "Red*ef4444*🔥,Blue*3b82f6*💧";
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle&teams=${encodeURIComponent(roster)}&fw=1`, { waitUntil: "networkidle" });
  const note = await page.getByTestId("rigged-note").innerText().catch(() => "");
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const won = await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 60_000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-string-battle-teams.png") });
  check(
    "a rigged string battle is won by the chosen roster ball under the teams banner",
    won && data.teamWinner === "Blue" && data.sbWinner === "1" && data.sbWinnerName === "Blue" && data.teams === "4" && data.sbBanner === "0" && /Blue wins/.test(note),
    `(winner=${data.teamWinner}, sb winner=${data.sbWinner} ${data.sbWinnerName}, teams=${data.teams}, stats=${data.teamStats}, own banner=${data.sbBanner}, note="${note}")`,
  );
}
{
  // Find Simulation: a battle ACID (the third ball) wins.
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle`, { waitUntil: "networkidle" });
  await page.locator("#find-outcome").selectOption("winner");
  await page.locator("#find-winner").selectOption("2");
  const button = page.getByRole("button", { name: /Find a Run ACID Wins/ });
  const labelled = await button.isVisible();
  await button.click();
  const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
  const text = done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  check("Find Simulation finds a string battle the chosen ball wins", labelled && /Found! ACID wins/.test(text), `("${text}")`);
}
{
  // Find Simulation with nine lives: a battle outlasts the 30 s duration, so the finder follows every one to its end (the
  // last ball standing – not whoever leads when the duration is up). The found battle, played to its end at 8×, is really
  // ACID's, and the recording length covers all of it plus the winner banner's hold.
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle&sbl=9`, { waitUntil: "networkidle" });
  await page.locator("#find-outcome").selectOption("winner");
  await page.locator("#find-winner").selectOption("2");
  const hint = await page.getByTestId("finder-outcome-hint").innerText().catch(() => "");
  await page.getByRole("button", { name: /Find a Run ACID Wins/ }).click();
  const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 180_000 }).then(() => true).catch(() => false);
  const text = done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  const foundSec = Number((/\(([\d.]+)s\)/.exec(text) || [])[1]);
  await page.waitForTimeout(500);
  const dur = Number(new URLSearchParams(page.url().split("?")[1] || "").get("dur") ?? 30); // the link leaves out the default 30 s
  let data = {};
  if (/Found! ACID wins/.test(text)) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.sbFinished === "1", null, { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(300);
    data = await canvasData();
  }
  check(
    "Find Simulation follows a nine-life string battle to its end: the found battle is really ACID's, recorded whole",
    /last one standing/.test(hint) && /Found! ACID wins/.test(text) && foundSec > 0 && data.sbFinished === "1" && data.sbWinner === "2" && data.sbWinnerName === "ACID" && data.sbAlive === "1" && dur >= Math.min(120, foundSec + 3 - 0.05) && dur < foundSec + 4.05,
    `("${text}", dur=${dur}, played: ${JSON.stringify({ finished: data.sbFinished, winner: data.sbWinner, name: data.sbWinnerName, alive: data.sbAlive, lives: data.sbLives })}, hint="${hint}")`,
  );
}
{
  // A resize mid-battle (a phone turned, a window dragged narrower), paused so the frame shows the resized battle before
  // the next step: every ball stays where it was in the ring (data-sb-in-ring) and every fighter's previous position –
  // where the cut rule tests its next move from – moved with its ball (data-sb-stale-px, the largest gap: 0), so the
  // resize itself cuts no thread and costs no life.
  await page.goto(`${BASE}/en/simulator/?mode=stringBattle`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.sbStrings ?? 0) >= 8, null, { timeout: 15_000 }).catch(() => {});
  const trials = [];
  for (const size of [{ width: 760, height: 1040 }, { width: 1400, height: 900 }, { width: 980, height: 640 }, { width: 1400, height: 900 }]) {
    await page.keyboard.press("Space");
    await page.waitForTimeout(200);
    const before = await canvasData();
    const box0 = await page.locator("main canvas").boundingBox();
    await page.setViewportSize(size);
    await page.waitForTimeout(400);
    const box1 = await page.locator("main canvas").boundingBox();
    const held = await canvasData();
    await page.keyboard.press("Space");
    await page.waitForTimeout(600);
    const after = await canvasData();
    const resized = !!box0 && !!box1 && (Math.abs(box0.width - box1.width) > 20 || Math.abs(box0.height - box1.height) > 20);
    trials.push({ resized, running: before.sbFinished === "0" && held.sbFinished === "0", stale: Number(held.sbStalePx), inRing: held.sbInRing === "1", lost: Number(after.sbLivesLost) - Number(held.sbLivesLost), size: `${box0 ? Math.round(box0.width) : "?"}×${box0 ? Math.round(box0.height) : "?"}→${box1 ? Math.round(box1.width) : "?"}×${box1 ? Math.round(box1.height) : "?"}` });
  }
  await page.setViewportSize({ width: 1400, height: 900 });
  check(
    "a resize mid string battle keeps the balls in the ring and leaves no stale move for the cut rule",
    trials.length === 4 && trials.every((t) => t.resized && t.running && t.stale <= 0.5 && t.inRing),
    `(${JSON.stringify(trials)})`,
  );
}
// --- end odd-string-battle ---

// --- odd-power-layers ---
// 27. Power Layers: the preview image and the card; URL → the Power layers block of the Mode row (layers, sequence, drift,
// bounce speed, corner badge, rule pills), controls → URL and the search box; the finder (the default run's fixed 8.8 s –
// 7 hits × 1 s + the finale – is explained at once, chaos seeds are searched and keep their promise); a default run at 1×
// – a hit every bounce period, each level the next C-major degree (OscillatorNode.start is instrumented), the stack
// emptied, freedom and the end screen, at 30+ fps; a chaos run of 800 layers at 8× to freedom; and a 1080×1920
// recording of the mode that keeps 20+ fps (the software encoder's share of a headless frame) and downloads.
{
  const res = await page.request.get(`${BASE}/modes/powerLayers.webp`);
  check("asset /modes/powerLayers.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  check("the Power Layers card is on the landing page", (await page.locator('img[src$="/modes/powerLayers.webp"]').count()) === 1);
}
/** Frame-time deltas (ms) of the page over `ms` of requestAnimationFrame, and the half-second windows' frame rates. */
const plFrameRates = async (ms) => {
  const deltas = await page.evaluate(
    (span) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + span;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    ms,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0 };
};
{
  const plToggle = (label) => page.getByTestId("power-layers").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  const seqButton = (name) => page.getByRole("group", { name: "Power Sequence", exact: true }).getByRole("button", { name: new RegExp(name) });
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers&pll=300&plq=fibonacci&pld=0.5&plsp=1.5&plb=warning&plp=0`, { waitUntil: "networkidle" });
  {
    const values = { pll: await sliderValue("Layers"), pld: await sliderValue("Drift"), plsp: await sliderValue("Bounce Speed") };
    const fib = await seqButton("Fibonacci").getAttribute("aria-pressed");
    const badge = await page.locator("#power-layers-badge").inputValue();
    const pills = await plToggle("Rule Badges").getAttribute("aria-pressed");
    const run = await page.getByTestId("power-layers-run").innerText();
    const hint = await page.getByTestId("power-layers-sequence").innerText();
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0 && (await page.locator('input[aria-label="Balls"]').count()) === 0;
    // Fibonacci against 300 layers: 1, 1, 2, 3, 5 … 144 – 12 hits, 2/3 s apart, + the 1.8 s finale = 9.8 s.
    check(
      "power layers load from the URL",
      values.pll === "300" && values.pld === "0.5" && values.plsp === "1.5" && fib === "true" && badge === "warning" && pills === "false" && /\b12 hits\b/.test(run) && /9\.8s/.test(run) && /1, 1, 2, 3, 5, 8/.test(hint) && noRingControls,
      `(${JSON.stringify(values)}, fibonacci=${fib}, badge=${badge}, pills=${pills}, "${run}", "${hint}")`,
    );
  }
  await seqButton("Primes").click();
  await page.locator('input[aria-label="Layers"]').evaluate(setRangeValue, "500");
  await plToggle("Rule Badges").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    check("power layers mirror into the URL", /(^|&)plq=primes(&|$)/.test(query) && /(^|&)pll=500(&|$)/.test(query) && !/(^|&)plp=/.test(query) && /(^|&)plb=warning(&|$)/.test(query) && /(^|&)plsp=1.5(&|$)/.test(query), `(${query})`);
  }
  await page.getByPlaceholder("Search settings...").fill("power sequence");
  const found = await page.getByRole("group", { name: "Power Sequence", exact: true }).isVisible();
  const ballSpeedHidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the power layers controls", found && ballSpeedHidden, `(found=${found}, Ball Speed hidden=${ballSpeedHidden})`);
}
{
  // The default run always lasts 7 hits × 1 s + the 1.8 s finale: the finder says so at once.
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const shown = await page.getByText(/Power Layers always lasts exactly 8\.8s/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("finder explains a fixed-length power layers run", shown);
  if (shown) await page.getByRole("button", { name: "Try again", exact: true }).click();
  // Chaos: the seed decides the hit count, so the finder searches – and the found run lasts hits × 1 s + 1.8 s.
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers&plq=random`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.plFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await canvasData();
  }
  check(
    "the finder finds a chaos seed for 30s and the run keeps the promise",
    ready && Math.abs(promised - 30) <= 0.5 && data.plFinished === "1" && Math.abs(Number(data.plTotalHits) * 1 + 1.8 - promised) < 0.05,
    `(ready=${ready}, "${readyText}", hits ${data.plTotalHits}, finished=${data.plFinished})`,
  );
}
{
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__plOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push({ f: this.frequency.value, t: performance.now() });
      return start.apply(this, arguments);
    };
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(300);
  const fps = await plFrameRates(5500);
  const mid = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-power-layers.png") });
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const tones = await page.evaluate(() => window.__plOsc);
  const first = tones.slice(0, 4);
  const midis = first.map((o) => Math.round(69 + 12 * Math.log2(o.f / 440)));
  const gaps = first.slice(1).map((o, i) => Math.round(o.t - first[i].t));
  check(
    "power layers: a hit every bounce period, each level the next note of the scale, at 30+ fps",
    Number(mid.plHits) >= 5 && midis.join(",") === "60,62,64,65" && gaps.every((g) => g > 800 && g < 1200) && fps.windows.length >= 8 && fps.min >= fpsFloor(30),
    `(hits ${mid.plHits}/${mid.plTotalHits}, first notes MIDI ${midis.join("/")} ${gaps.join("/")} ms apart, ${tones.length} tones, avg ${fps.avg.toFixed(1)} fps, worst half-second ${fps.min.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`,
  );
  check(
    "power layers empty the stack, fall to freedom and finish",
    done && data.plGone === "120" && data.plHits === "7" && data.plFreed === "1" && data.plFinished === "1" && data.plBigHits === "3" && data.plPower === "128",
    `(finished=${done}, ${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("pl"))))})`,
  );
}
{
  // Chaos against 800 layers at 8×, with both corner badges.
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers&plq=random&pll=800&plb=both`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const done = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.plFinished === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("a chaos run of 800 layers ends in freedom", done && data.plGone === "800" && data.plHits === data.plTotalHits && data.plFreed === "1" && data.plBadge === "both" && data.plSequence === "random", `(finished=${done}, hits ${data.plHits}/${data.plTotalHits}, gone ${data.plGone})`);
  await page.screenshot({ path: path.join(outDir, "sim-power-layers-chaos.png") });
}
{
  // A 1080×1920 recording (the default resolution) of the default run.
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers&dur=10`, { waitUntil: "networkidle" });
  let fps = { windows: [], avg: 0, min: 0 };
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(300);
      fps = await plFrameRates(3500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]).then(([d]) => d);
  let size = 0;
  if (download) {
    const file = path.join(outDir, `power-layers-${download.suggestedFilename()}`);
    await download.saveAs(file);
    size = fs.statSync(file).size;
  }
  // Headless Chromium encodes the 1080×1920 export in software on the CPU – the bulk of a recorded frame in every mode – so the
  // floor is 20 fps here (scaled down on a busy machine like every frame-rate check), well above a mode that would stall it.
  check("a 1080×1920 power layers recording keeps 20+ fps and downloads", size > 10000 && fps.windows.length >= 5 && fps.min >= fpsFloor(20), `(${size} bytes, avg ${fps.avg.toFixed(1)} fps, worst half-second ${fps.min.toFixed(1)} fps, floor ${fpsFloor(20)}${loadNote()})`);
}
// --- end odd-power-layers ---

// --- fast-render --- Fast export: a 500×500, 10 s Classic clip at 30 fps is rendered offline (WebCodecs) and downloads as an
// MP4 or WebM with a video and an audio track of the clip's length, the progress bar runs meanwhile, a second export of the
// same seed has the same frames (digest), and Cancel stops a long export without a download. Without WebCodecs the button
// must say so and start Record Video instead.
{
  /** Length (s) and tracks of an MP4 (mvhd, hdlr) or WebM (Segment Info Duration, CodecIDs) file. */
  const probeVideoFile = (buf) => {
    if (buf.includes(Buffer.from("ftyp"))) {
      const at = buf.indexOf(Buffer.from("mvhd"));
      if (at < 0) return { container: "mp4", duration: -1, video: false, audio: false };
      const v1 = buf[at + 4] === 1;
      const timescale = buf.readUInt32BE(at + (v1 ? 24 : 16));
      const duration = v1 ? Number(buf.readBigUInt64BE(at + 28)) : buf.readUInt32BE(at + 20);
      return { container: "mp4", duration: duration / timescale, video: buf.includes(Buffer.from("vide")), audio: buf.includes(Buffer.from("soun")) };
    }
    let duration = -1;
    for (let i = buf.indexOf(Buffer.from([0x44, 0x89])); i >= 0 && i < buf.length - 10; i = buf.indexOf(Buffer.from([0x44, 0x89]), i + 1)) {
      if (buf[i + 2] === 0x88) duration = buf.readDoubleBE(i + 3) / 1000;
      else if (buf[i + 2] === 0x84) duration = buf.readFloatBE(i + 3) / 1000;
      if (duration > 0) break;
    }
    return { container: "webm", duration, video: buf.includes(Buffer.from("V_VP")), audio: buf.includes(Buffer.from("A_OPUS")) };
  };
  const fastPanel = page.locator("[data-fast-export]");
  const fastState = async () => ({ status: await fastPanel.getAttribute("data-fast-export"), digest: await fastPanel.getAttribute("data-fast-digest") });
  await page.goto(`${BASE}/en/simulator/?mode=classic&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  const fastButton = page.getByRole("button", { name: /Fast export/ });
  if (webCodecs) {
    const exportOnce = async (label) => {
      const downloadWait = page.waitForEvent("download", { timeout: 240000 }).catch(() => null);
      const startedAt = Date.now();
      await fastButton.click();
      const progress = await page.getByRole("progressbar", { name: /Fast export progress/ }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
      const download = await downloadWait;
      await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
      const ms = Date.now() - startedAt;
      const state = await fastState();
      let file = null;
      if (download) {
        const out = path.join(outDir, `fast-${label}-${download.suggestedFilename()}`);
        await download.saveAs(out);
        const buf = fs.readFileSync(out);
        file = { name: download.suggestedFilename(), bytes: buf.length, ...probeVideoFile(buf) };
      }
      return { progress, state, file, ms };
    };
    const first = await exportOnce("a");
    const f = first.file;
    const doneLine = await page.getByText(/Exported a .* s (MP4|WEBM) in/).first().innerText().catch(() => "");
    check(
      "fast export renders a 10 s clip offline and downloads it with video and audio tracks",
      first.progress && first.state.status === "done" && !!f && f.bytes > 10000 && f.video && f.audio && f.duration > 2 && f.duration <= 10.05 && /\.(mp4|webm)$/.test(f.name) && !!doneLine,
      `(${f ? `${f.name}, ${f.container}, ${f.duration.toFixed(2)} s, ${f.bytes} bytes, video=${f.video}, audio=${f.audio}` : "no download"}, progress bar=${first.progress}, ${first.ms} ms, "${doneLine}")`,
    );
    const second = await exportOnce("b");
    check(
      "fast export is reproducible: the same seed renders the same frames",
      second.state.status === "done" && !!first.state.digest && first.state.digest === second.state.digest && !!second.file && Math.abs(second.file.duration - (f?.duration ?? -1)) < 1e-6,
      `(digests ${first.state.digest} / ${second.state.digest}, lengths ${f?.duration} / ${second.file?.duration} s)`,
    );
    // Cancel: a long 1080×1920 export stops on Cancel, reports it and downloads nothing; the page's run can start afterwards.
    await page.goto(`${BASE}/en/simulator/?mode=classic&dur=60&res=1080x1920`, { waitUntil: "networkidle" });
    let cancelDownload = false;
    const onDownload = () => (cancelDownload = true);
    page.on("download", onDownload);
    await page.getByRole("button", { name: /Fast export/ }).click();
    const running = await page.getByRole("progressbar", { name: /Fast export progress/ }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1500);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    const cancelled = await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") === "cancelled", null, { timeout: 20000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1000);
    page.off("download", onDownload);
    const hiddenCanvases = await page.evaluate(() => document.querySelectorAll("canvas").length);
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(1500);
    const liveRuns = await page.evaluate(() => document.querySelector("canvas")?.width > 0);
    check("fast export cancels without a download and the page runs on", running && cancelled && !cancelDownload && liveRuns, `(running=${running}, cancelled=${cancelled}, download=${cancelDownload}, canvases=${hiddenCanvases})`);
  } else {
    await fastButton.click();
    const note = await page.getByText(/can't encode video by itself/).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
    const recording = await page.getByRole("button", { name: /Stop & Export/ }).first().isVisible().catch(() => false);
    check("without WebCodecs the fast export explains itself and records in real time", note && recording, `(note=${note}, recording=${recording})`);
    if (recording) await page.getByRole("button", { name: /Stop & Export/ }).first().click();
  }
}
// --- end fast-render ---
// --- project-files ---
// 28. Project files and short share codes. Export: a setup with an obstacle, keyframes, a text and an uploaded music
// bed downloads as <name>.viralballs.json holding the settings and the track as base64. Import on a fresh page (the
// file input, then a drop on the panel) restores the settings and the track; a JSON file that is not a project is
// refused with a message. Share: the share button copies a ?c= link (base64url); opening it applies the setup,
// parameters after the code win, and a damaged code is reported under the canvas; the search box finds the block.
{
  const projectLink = "mode=shatter&g=700&top=Project+smoke&obs=p%3A0.2%2C-0.3%2C6%3Bb%3A-0.4%2C0.1%2C8%3Bp%3A0.5%2C0.5%2C5&kf=g_0_300_4_1200";
  const linkParams = () => new URL(page.url()).searchParams;
  const setupRestored = (p) => p.get("mode") === "shatter" && p.get("g") === "700" && p.get("top") === "Project smoke" && (p.get("obs") ?? "").split(";").length === 3 && p.get("kf") === "g_0_300_4_1200";
  const openProjectBlock = async () => {
    if (!(await page.getByTestId("project-section").isVisible().catch(() => false))) await page.getByRole("button", { name: /Project file/ }).click();
    await page.getByTestId("project-section").waitFor({ timeout: 5000 });
  };
  const projectStatus = () =>
    page
      .getByTestId("project-status")
      .waitFor({ timeout: 20000 })
      .then(() => page.getByTestId("project-status").innerText())
      .catch(() => "");

  await page.goto(`${BASE}/en/simulator/?${projectLink}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  const bedUploaded = await uploadMusicBed(2);
  await openProjectBlock();
  await page.locator("#project-name").fill("Smoke project");
  const mediaText = (await page.getByTestId("project-media").innerText()).replace(/\s+/g, " ");
  const [projectDownload] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Export project/ }).click()]);
  const projectPath = path.join(outDir, projectDownload.suggestedFilename());
  await projectDownload.saveAs(projectPath);
  const projectText = fs.readFileSync(projectPath, "utf8");
  let project = null;
  try {
    project = JSON.parse(projectText);
  } catch {
    /* reported below */
  }
  const bed = project?.assets?.musicBed;
  check(
    "Export project downloads <name>.viralballs.json with the settings and the uploaded media",
    bedUploaded &&
      /Background music\s*smoke-bed\.wav/.test(mediaText) &&
      projectDownload.suggestedFilename() === "Smoke project.viralballs.json" &&
      project?.format === "viralballs-project" &&
      project?.version === 1 &&
      project?.name === "Smoke project" &&
      project?.settings?.mode === "shatter" &&
      project?.settings?.gravity === 700 &&
      project?.settings?.obstacles?.length === 3 &&
      project?.settings?.keyframes?.length === 2 &&
      bed?.name === "smoke-bed.wav" &&
      bed?.size === makeWav(2).length &&
      Buffer.from(bed?.data ?? "", "base64").equals(makeWav(2)),
    `(${projectDownload.suggestedFilename()}, ${projectText.length} chars, media "${mediaText}", bed ${bed ? `${bed.name} ${bed.size} B` : "missing"})`,
  );

  // Import through the file input on a fresh page.
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  await openProjectBlock();
  await page.locator("#project-file-input").setInputFiles(projectPath);
  const importText = await projectStatus();
  await page.waitForTimeout(300);
  const importedParams = linkParams();
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  const importedTrack = await page.getByTestId("music-track").innerText({ timeout: 10000 }).catch(() => "");
  check(
    "Import project restores the settings and the media",
    /Opened .Smoke project./.test(importText) && setupRestored(importedParams) && importedTrack.includes("smoke-bed.wav") && (await page.locator("#project-name").inputValue().catch(() => "")) === "Smoke project",
    `(status "${importText}", link ${importedParams.toString()}, track "${importedTrack.replace(/\s+/g, " ").trim()}")`,
  );

  // Drop the file on the panel: the outline shows while it is dragged, the drop imports it.
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  const dropZone = page.getByTestId("project-drop-zone");
  const dataTransfer = await page.evaluateHandle((text) => {
    const dt = new DataTransfer();
    dt.items.add(new File([text], "dropped.viralballs.json", { type: "application/json" }));
    return dt;
  }, projectText);
  await dropZone.dispatchEvent("dragenter", { dataTransfer });
  await dropZone.dispatchEvent("dragover", { dataTransfer });
  const outlineShown = await page.getByText("Drop the project file to open it").isVisible().catch(() => false);
  await dropZone.dispatchEvent("drop", { dataTransfer });
  const dropText = await projectStatus();
  await page.waitForTimeout(300);
  check("dropping a project file on the panel imports it", outlineShown && /Opened/.test(dropText) && setupRestored(linkParams()), `(outline ${outlineShown}, status "${dropText}", link ${linkParams().toString()})`);

  // A project dropped on one of the panel's own drop zones (the hit sample, the wall-break sound) still opens as a project –
  // it is not loaded as a sound – while an audio file dropped there still goes to that zone.
  const dropOn = async (target, name, type, content) => {
    const dt = await page.evaluateHandle(
      ({ name, type, content }) => {
        const d = new DataTransfer();
        const bytes = typeof content === "string" ? content : new Uint8Array(content);
        d.items.add(new File([bytes], name, { type }));
        return d;
      },
      { name, type, content },
    );
    await target.dispatchEvent("dragenter", { dataTransfer: dt });
    await target.dispatchEvent("dragover", { dataTransfer: dt });
    await target.dispatchEvent("drop", { dataTransfer: dt });
  };
  const decodeErrors = [];
  const onDecodeError = (msg) => {
    if (msg.type() === "error" || /decode/i.test(msg.text())) decodeErrors.push(msg.text());
  };
  page.on("console", onDecodeError);
  await page.goto(`${BASE}/en/simulator/?mode=classic&hsm=sample&hs=kick`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  const hitZone = page.locator("label:has(#hit-sample-input)");
  await hitZone.waitFor({ timeout: 10000 });
  await dropOn(hitZone, "my.viralballs.json", "application/json", projectText);
  const hitDropText = await projectStatus();
  await page.waitForTimeout(300);
  const hitDropParams = linkParams();
  check(
    "a project dropped on the hit-sample drop zone opens as a project, not as a sample",
    /Opened/.test(hitDropText) && setupRestored(hitDropParams) && !hitDropParams.has("hsm") && !decodeErrors.some((e) => /decode/i.test(e)),
    `(status "${hitDropText}", link ${hitDropParams.toString()}, errors ${JSON.stringify(decodeErrors.slice(0, 2))})`,
  );
  await page.goto(`${BASE}/en/simulator/?mode=classic&g=450`, { waitUntil: "networkidle" });
  // The search shows the wall-break picker and its drop zone together.
  await page.getByPlaceholder("Search settings...").fill("Wall Break");
  const wallBreakZone = page.locator('label:has-text("Import Custom Wall Break Sound") + label');
  await wallBreakZone.waitFor({ timeout: 10000 });
  decodeErrors.length = 0;
  await dropOn(wallBreakZone, "my.viralballs.json", "application/json", projectText);
  await page.waitForFunction(() => new URL(location.href).searchParams.get("g") === "700", null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const wallBreakValue = await page.locator("#wallbreak-select").inputValue({ timeout: 5000 }).catch(() => "(missing)");
  const wallBreakProjectOption = await page.locator("#wallbreak-select option", { hasText: "my.viralballs.json" }).count().catch(() => -1);
  await page.getByPlaceholder("Search settings...").fill(""); // the search hides the Project file block and its status
  const wallDropText = await projectStatus();
  check(
    "a project dropped on the wall-break drop zone opens as a project, not as a wall-break sound",
    /Opened/.test(wallDropText) && setupRestored(linkParams()) && wallBreakValue !== "(missing)" && !wallBreakValue.startsWith("blob:") && wallBreakProjectOption === 0 && !decodeErrors.some((e) => /decode/i.test(e)),
    `(status "${wallDropText}", wall break "${wallBreakValue.slice(0, 40)}", project option ${wallBreakProjectOption}, link ${linkParams().toString()}, errors ${JSON.stringify(decodeErrors.slice(0, 2))})`,
  );
  await page.goto(`${BASE}/en/simulator/?mode=classic&hsm=sample&hs=kick`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await hitZone.waitFor({ timeout: 10000 });
  await dropOn(hitZone, "dropped-hit.wav", "audio/wav", [...makeWav(1)]);
  const hitTaken = await page.waitForFunction(() => document.querySelector("#hit-sample-select")?.value === "custom", null, { timeout: 10000 }).then(() => true).catch(() => false);
  const noProject = !(await page.getByTestId("project-status").isVisible().catch(() => false));
  check("an audio file dropped on the hit-sample zone still loads as the hit sample", hitTaken && noProject && linkParams().get("hsm") === "sample", `(custom=${hitTaken}, project status=${!noProject}, link ${linkParams().toString()})`);
  page.off("console", onDecodeError);

  // A JSON file that is not a project is refused, and the page keeps its settings.
  await page.goto(`${BASE}/en/simulator/?mode=lines&g=450`, { waitUntil: "networkidle" });
  await openProjectBlock();
  await page.locator("#project-file-input").setInputFiles({ name: "other.json", mimeType: "application/json", buffer: Buffer.from('{"hello":"world"}') });
  const refusedText = await projectStatus();
  check("a JSON file that is not a project is refused", /not a ViralBalls project/.test(refusedText) && linkParams().get("mode") === "lines" && linkParams().get("g") === "450", `(status "${refusedText}", link ${linkParams().toString()})`);

  // Short share codes.
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  await page.goto(`${BASE}/en/simulator/?${projectLink}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600); // the short link is re-encoded 150 ms after the last change
  const longLink = page.url();
  await page.getByRole("button", { name: /Copy share link/ }).click();
  await page.getByText("Link copied!").waitFor({ timeout: 5000 }).catch(() => {});
  const shortLink = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  const codeMatch = /\/en\/simulator\/\?c=([A-Za-z0-9_-]+)$/.exec(shortLink);
  check("the share button copies a short ?c= link", !!codeMatch, `(${shortLink.length} chars, long link ${longLink.length}: ${shortLink.slice(0, 90)}…)`);
  if (codeMatch) {
    await page.goto(shortLink, { waitUntil: "networkidle" });
    const opened = await page.waitForFunction(() => new URL(location.href).searchParams.get("g") === "700", null, { timeout: 10000 }).then(() => true).catch(() => false);
    const openedParams = linkParams();
    check("a ?c= link opens the shared setup (the address bar shows the long link)", opened && setupRestored(openedParams) && !openedParams.has("c"), `(${openedParams.toString()})`);
    await page.goto(`${shortLink}&g=900&wc=4`, { waitUntil: "networkidle" });
    const overridden = await page.waitForFunction(() => new URL(location.href).searchParams.get("top") === "Project smoke", null, { timeout: 10000 }).then(() => true).catch(() => false);
    const overParams = linkParams();
    check("parameters after the code win over the code", overridden && overParams.get("mode") === "shatter" && overParams.get("g") === "900" && overParams.get("wc") === "4" && overParams.get("kf") === "g_0_300_4_1200", `(${overParams.toString()})`);
  }
  await page.goto(`${BASE}/en/simulator/?c=not-a-real-code&g=450`, { waitUntil: "networkidle" });
  const noticeShown = await page.getByTestId("share-code-notice").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("a damaged share code is reported under the canvas and the other parameters still apply", noticeShown && linkParams().get("g") === "450", `(notice ${noticeShown}, link ${linkParams().toString()})`);
  await page.getByPlaceholder("Search settings...").fill("export");
  const foundBySearch = await page.getByTestId("project-section").isVisible().catch(() => false);
  await page.getByPlaceholder("Search settings...").fill("");
  check("the search box finds the Project file block", foundBySearch);
}
// --- end project-files ---
// --- jdm-race ---
// 29. Square Racing Grand Prix: the preview image and the card; URL → the Race block of the Mode row (racers, shape, track
// length, laps, obstacle mix, camera, standings, mini-map, cup and its title, the staged winner with its warnings), controls →
// URL, the search box, the Teams tab's note; a default race at 30+ fps whose obstacle notes are the racers' notes
// (OscillatorNode.start is instrumented) while the standings follow the overtakes (data-race-*); a short race at 8× that
// reaches its podium and the cup table, scored into the cup in localStorage, and a second race that adds to it; a staged
// winner who wins; the finder timing a race.
{
  const res = await page.request.get(`${BASE}/modes/race.webp`);
  check("asset /modes/race.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  check("the Square Racing Grand Prix card is on the landing page", (await page.locator('img[src$="/modes/race.webp"]').count()) === 1);
}
{
  /** The On/Off button of a toggle in the Race block, by the start of its label. */
  const raceToggle = (label) => page.getByTestId("race-section").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  await page.goto(`${BASE}/en/simulator/?mode=race&rcn=12&rcs=circle&rcl=5&rclp=2&rcf=turbo&rccam=pack&rccup=1&rcct=Neon%20Cup&rcw=3&rcst=0&rcmm=0`, { waitUntil: "networkidle" });
  {
    const values = { rcn: await sliderValue("Racers"), rcl: await sliderValue("Track Length"), rclp: await sliderValue("Laps") };
    const circles = await page.getByRole("group", { name: "Racer Shape", exact: true }).getByRole("button", { name: /Circles/ }).getAttribute("aria-pressed");
    const pack = await page.getByRole("group", { name: "Camera", exact: true }).getByRole("button", { name: /Pack/ }).getAttribute("aria-pressed");
    const mix = await page.locator("#race-feature").inputValue();
    const standings = await raceToggle("Live Standings").getAttribute("aria-pressed");
    const miniMap = await raceToggle("Mini-map").getAttribute("aria-pressed");
    const cup = await raceToggle("Cup").first().getAttribute("aria-pressed");
    const title = await page.locator("#race-cup-title").inputValue();
    const winner = await page.locator("#race-winner").inputValue();
    const warned = (await page.getByTestId("race-rig-warning").isVisible()) && (await page.getByTestId("race-rigged-note").isVisible());
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
    check(
      "race loads from URL",
      values.rcn === "12" && values.rcl === "5" && values.rclp === "2" && circles === "true" && pack === "true" && mix === "turbo" && standings === "false" && miniMap === "false" && cup === "true" && title === "Neon Cup" && winner === "3" && warned && noRingControls,
      `(${JSON.stringify(values)}, circles=${circles}, pack=${pack}, mix=${mix}, standings=${standings}, minimap=${miniMap}, cup=${cup}, title=${title}, winner=${winner}, warned=${warned})`,
    );
  }
  await page.locator('input[aria-label="Racers"]').evaluate(setRangeValue, "7");
  await page.getByRole("group", { name: "Racer Shape", exact: true }).getByRole("button", { name: /Squares/ }).click();
  await page.locator("#race-feature").selectOption("gates");
  await page.getByRole("group", { name: "Camera", exact: true }).getByRole("button", { name: /Leader/ }).click();
  await raceToggle("Live Standings").click();
  await page.locator("#race-winner").selectOption("-1");
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    const roster = await page.getByTestId("race-roster").locator("span.inline-flex").count();
    check(
      "race mirrors into the URL",
      /(^|&)rcn=7(&|$)/.test(query) && !/(^|&)rcs=/.test(query) && /(^|&)rcf=gates(&|$)/.test(query) && !/(^|&)rccam=/.test(query) && !/(^|&)rcst=/.test(query) && !/(^|&)rcw=/.test(query) && /(^|&)rcct=Neon/.test(query) && roster === 7 && !(await page.getByTestId("race-rigged-note").isVisible()),
      `(${query}, roster chips ${roster})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("obstacle mix");
  check("search finds the race controls", (await page.locator("#race-feature").isVisible()) && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()));
  await page.getByPlaceholder("Search settings...").fill("");
  await page.getByRole("button", { name: /Teams & Scoreboard/ }).click();
  check("the Teams tab says the race takes its roster", await page.getByTestId("teams-race-note").isVisible());
}
await page.goto(`${BASE}/en/simulator/?mode=race`, { waitUntil: "networkidle" });
await page.evaluate(() => {
  const log = [];
  window.__raceOsc = log;
  const start = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function () {
    if (this.frequency.value !== 1) log.push(this.frequency.value);
    return start.apply(this, arguments);
  };
});
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.waitForTimeout(2500);
await page.evaluate(() => (window.__raceOsc.length = 0)); // the notes of the race, not the countdown's beeps
{
  // Frame intervals over 4 s of the default race (8 racers, 8 screens), in half-second windows.
  const deltas = await page.evaluate(
    (ms) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + ms;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    4000,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  const minWindow = Math.min(...windows);
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__raceOsc);
  // The racers' notes: a C-major pentatonic ladder from C4, one per racer (the chromatic default leaves them unsnapped).
  const ladder = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const racerNotes = midis.filter((m) => ladder.includes(m)).length;
  check(
    "simulator mode=race runs the race at 30+ fps with the racers' notes",
    data.raceRacers === "8" && data.racePhase === "racing" && Number(data.raceHits) >= 5 && Number(data.racePasses) >= 1 && Number(data.raceCamera) > 100 && data.raceOrder.split(",").length === 8 && racerNotes >= 3 && windows.length >= 6 && minWindow >= fpsFloor(30),
    `(${data.raceHits} hits, ${data.racePasses} passes, ${data.raceCallouts} callouts, camera ${data.raceCamera}, ${pitches.length} tones, ${racerNotes} racer notes, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-race.png") });
}
// A short race at 8× with the cup on: the podium, the cup table, the finish – scored once into the cup, and a second race adds to it.
await page.goto(`${BASE}/en/simulator/?mode=race&rcn=5&rcl=3&rccup=1`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("viralballs:race-cup"));
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const podium = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.racePhase === "podium", null, { timeout: 30000 }).then(() => true).catch(() => false);
  const atPodium = await canvasData();
  const cupShown = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.racePhase === "cup", null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (cupShown) await page.screenshot({ path: path.join(outDir, "sim-race-cup.png") });
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  const cup = await page.evaluate(() => JSON.parse(localStorage.getItem("viralballs:race-cup") || "null"));
  const winner = Number(atPodium.raceWinner);
  check(
    "a short race reaches its podium and the cup table, scored into the cup",
    podium && cupShown && done && atPodium.raceFinished === "5" && winner >= 0 && cup?.races === 1 && cup?.points?.[winner] === 25 && cup.points.reduce((a, b) => a + b, 0) === 25 + 18 + 15 + 12 + 10,
    `(podium=${podium}, cup=${cupShown}, done=${done}, ${JSON.stringify(atPodium)}, stored ${JSON.stringify(cup)})`,
  );
  if (done) {
    const restartButton = page.getByRole("button", { name: /Restart Simulation/ });
    await restartButton.click();
    await restartButton.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    const again = await restartButton.waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
    const cup2 = await page.evaluate(() => JSON.parse(localStorage.getItem("viralballs:race-cup") || "null"));
    const summary = await page.getByTestId("race-cup-summary").innerText().catch(() => "");
    check("a second race adds its points to the cup", again && cup2?.races === 2 && cup2.points.reduce((a, b) => a + b, 0) === 2 * 80 && /2 race/.test(summary), `(finished=${again}, stored ${JSON.stringify(cup2)}, "${summary}")`);
  }
}
// --- fast-render --- A race the page has already scored, then fast-exported: the export's cup table shows it as the same race
// ("Race 1", the page's run key), not as a second one with doubled points, and the export stores nothing.
if (await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined")) {
  await page.goto(`${BASE}/en/simulator/?mode=race&rcn=5&rcl=3&rccup=1&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  // A new cup (the page reads the stored one when it loads, so it loads again).
  await page.evaluate(() => localStorage.removeItem("viralballs:race-cup"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const scored = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 45000 }).then(() => true).catch(() => false);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("viralballs:race-cup") || "null"));
  // Every "Race n" line the export's (hidden) canvas draws.
  await page.evaluate(() => {
    const main = document.querySelector("main canvas");
    const seen = new Set();
    window.__exportRaceLines = seen;
    const fillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...rest) {
      if (this.canvas !== main && /^Race \d+$/.test(String(text))) seen.add(String(text));
      return fillText.call(this, text, ...rest);
    };
  });
  const downloadWait = page.waitForEvent("download", { timeout: 240000 }).catch(() => null);
  await page.getByRole("button", { name: /Fast export/ }).click();
  const download = await downloadWait;
  await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
  const status = await page.locator("[data-fast-export]").getAttribute("data-fast-export").catch(() => "");
  const lines = await page.evaluate(() => [...(window.__exportRaceLines ?? [])]);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("viralballs:race-cup") || "null"));
  check(
    "a fast export of a race the page already scored draws the same cup table (no second race, no doubled points)",
    scored && before?.races >= 1 && !!download && status === "done" && lines.length === 1 && lines[0] === `Race ${before.races}` && after?.races === before.races && JSON.stringify(after.points) === JSON.stringify(before.points),
    `(scored=${scored}, stored before ${JSON.stringify(before)}, export ${status}, drawn ${JSON.stringify(lines)}, stored after ${JSON.stringify(after)})`,
  );
}
// A staged winner: the director favours racer 3 (Gold) at the swap zones and turbo pads – and Gold wins.
await page.goto(`${BASE}/en/simulator/?mode=race&rcn=6&rcl=4&rcw=3`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const podium = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.racePhase === "podium", null, { timeout: 40000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("a staged race is won by the favoured racer", podium && data.raceWinner === "3", `(podium=${podium}, ${JSON.stringify(data)})`);
  await page.screenshot({ path: path.join(outDir, "sim-race-podium.png") });
}
// The longest track (20 screens × 5 laps, minutes of racing) at 8×: the time limit grows with the track (800 s here, the
// default race's 240 s), so the race is never cut off before anybody is home – the staged favourite (racer 2) wins it.
await page.goto(`${BASE}/en/simulator/?mode=race&rcl=20&rclp=5&rcw=2`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const limit = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.raceTimeLimit, null, { timeout: 10000 }).then((h) => h.jsonValue()).catch(() => "");
  const podium = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.racePhase === "podium", null, { timeout: 240000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check(
    "the longest track is raced to the finish: the time limit grows with it and the staged favourite wins",
    limit === "800" && podium && data.raceWinner === "2" && Number(data.raceFinished) >= 3,
    `(limit ${limit}s, podium=${podium}, ${JSON.stringify({ winner: data.raceWinner, finished: data.raceFinished, phase: data.racePhase, lap: data.raceLap })})`,
  );
  if (podium) await page.screenshot({ path: path.join(outDir, "sim-race-long-podium.png") });
}
// The finder times races: every seed builds another track, so a 30 s run is found among the seeds.
await page.goto(`${BASE}/en/simulator/?mode=race`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
{
  const found = await page.getByText(/Ready to start simulation for (29\.[5-9]|30\.[0-5])/).first().waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
  check("finder finds a 30 s race", found);
}
// --- end jdm-race ---
// --- jdm-arena-games ---
// 30. Battle Royale and Capture the Flag: the preview images and the cards; URL → the "Arena games" block of the Mode
// row, controls → URL, the search box; a battle at 8× fought to the last square standing – every other square knocked
// out, notes played, the winner banner held before the end screen; Find Simulation finds a 30 s battle and the found
// seed replays to its length; a capture-the-flag game won on the score (captures counted, flags back home or carried);
// names from the Teams roster; the frame rate of 20 squares and of a 4 – 4 game.
{
  for (const mode of ["battle", "ctf"]) {
    const res = await page.request.get(`${BASE}/modes/${mode}.webp`);
    check(`asset /modes/${mode}.webp`, res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  }
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const cards = (await page.locator('img[src$="/modes/battle.webp"]').count()) + (await page.locator('img[src$="/modes/ctf.webp"]').count());
  check("the Battle Royale and Capture the Flag cards are on the landing page", cards === 2, `(${cards})`);
}
{
  const arenaToggle = (label) => page.getByTestId("arena-games-section").locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
  await page.goto(`${BASE}/en/simulator/?mode=battle&btn=12&bthp=6&btd=1.5&bta=circle&bts=0&btp=0&arn=0.8`, { waitUntil: "networkidle" });
  {
    const values = { btn: await sliderValue("Squares"), bthp: await sliderValue("Hit Points"), btd: await sliderValue("Damage"), arn: await sliderValue("Director Nudge") };
    const circle = await page.getByRole("group", { name: "Arena", exact: true }).getByRole("button", { name: /Circle/ }).getAttribute("aria-pressed");
    const shrink = await arenaToggle("Shrinking Zone").getAttribute("aria-pressed");
    const powerUps = await arenaToggle("Power-ups").getAttribute("aria-pressed");
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
    check(
      "battle royale loads from URL",
      values.btn === "12" && values.bthp === "6" && values.btd === "1.5" && values.arn === "0.8" && circle === "true" && shrink === "false" && powerUps === "false" && noRingControls,
      `(${JSON.stringify(values)}, circle=${circle}, shrink=${shrink}, power-ups=${powerUps})`,
    );
  }
  await page.locator('input[aria-label="Squares"]').evaluate(setRangeValue, "10");
  await page.getByRole("group", { name: "Arena", exact: true }).getByRole("button", { name: /Box/ }).click();
  await arenaToggle("Shrinking Zone").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    check("battle royale mirrors into the URL", /(^|&)btn=10(&|$)/.test(query) && !/(^|&)bta=/.test(query) && !/(^|&)bts=/.test(query) && /(^|&)btp=0(&|$)/.test(query), `(${query})`);
  }
  await page.getByPlaceholder("Search settings...").fill("power-ups");
  const powerFound = await arenaToggle("Power-ups").isVisible().catch(() => false);
  await page.getByPlaceholder("Search settings...").fill("director nudge");
  const nudgeFound = await page.locator('input[aria-label="Director Nudge"]').isVisible();
  check("search finds the arena-game controls", powerFound && nudgeFound && !(await page.locator('input[aria-label="Ball Speed"]').isVisible()), `(power-ups=${powerFound}, nudge=${nudgeFound})`);
  await page.getByPlaceholder("Search settings...").fill("");
}
{
  // A default battle at 8×: every square but one is knocked out, the clashes and bounces play notes (OscillatorNode.start is
  // instrumented), and the winner banner holds the end screen back for a moment.
  await page.goto(`${BASE}/en/simulator/?mode=battle`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__arenaOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push(this.frequency.value);
      return start.apply(this, arguments);
    };
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1500);
  const early = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-battle.png") });
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const finished = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const held = !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible());
  await page.screenshot({ path: path.join(outDir, "sim-battle-winner.png") });
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  const tones = await page.evaluate(() => window.__arenaOsc.length);
  check(
    "a battle is fought to the last square standing, with notes, and its winner banner is held",
    Number(early.arenaDrawn) === 8 && finished && data.arenaSquares === "8" && data.arenaAlive === "1" && data.arenaKos === "7" && Number(data.arenaHits) > 7 && Number(data.arenaNotes) > 0 && !!data.arenaWinner && data.arenaWinner !== "draw" && tones > 0 && held && endScreen,
    `(start ${JSON.stringify({ drawn: early.arenaDrawn, hits: early.arenaHits })}, end ${JSON.stringify({ alive: data.arenaAlive, kos: data.arenaKos, hits: data.arenaHits, notes: data.arenaNotes, pickups: data.arenaPickups, zone: data.arenaZone, winner: data.arenaWinner })}, ${tones} tones, held=${held}, end screen=${endScreen})`,
  );
}
{
  // Find Simulation: a battle always ends, so a 30 s one is found; the found seed replays to the length it was found with
  // (the finder shows it rounded to one decimal, so within 0.05 s) and the clip is that length plus the winner banner's hold,
  // rounded up.
  await page.goto(`${BASE}/en/simulator/?mode=battle`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
  const text = done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  const foundSec = Number((/Found! ([\d.]+)s/.exec(text) || [])[1]);
  const dur = new URL(page.url()).searchParams.get("dur");
  let replay = NaN;
  if (foundSec > 0) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "1", null, { timeout: 60000 }).catch(() => {});
    replay = Number((await canvasData()).arenaFinishSec);
  }
  check("find simulation finds a 30 s battle that replays to its length", /Found! (29\.[5-9]|30\.[0-5])s/.test(text) && Math.abs(replay - foundSec) <= 0.051 && dur === String(Math.ceil(replay + 3 - 1e-9)), `(${text}, dur=${dur}, replay ${replay}s)`);
  // The found seed fights the same battle on another canvas: after a resize (a phone rotation, a smaller window) Restart
  // replays it to the same end with the same winner – the battle's margins scale with the field, like its speeds.
  if (replay > 0) {
    const first = await canvasData();
    const boxBefore = await page.locator("main canvas").boundingBox();
    const restartButton = page.getByRole("button", { name: /Restart Simulation/ });
    const ended = await restartButton.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    await page.setViewportSize({ width: 760, height: 1040 });
    await page.waitForTimeout(600);
    const boxAfter = await page.locator("main canvas").boundingBox();
    let again = NaN;
    let winner = "";
    if (ended) {
      await restartButton.click();
      await page.getByRole("button", { name: "8x", exact: true }).click().catch(() => {});
      await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "0", null, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "1", null, { timeout: 60000 }).catch(() => {});
      const data = await canvasData();
      again = Number(data.arenaFinishSec);
      winner = data.arenaWinner;
    }
    const resized = !!boxBefore && !!boxAfter && (Math.abs(boxBefore.width - boxAfter.width) > 20 || Math.abs(boxBefore.height - boxAfter.height) > 20);
    check(
      "a found battle replays the same on a resized canvas (same end, same winner)",
      ended && resized && again === replay && winner === first.arenaWinner,
      `(canvas ${boxBefore ? `${Math.round(boxBefore.width)}×${Math.round(boxBefore.height)}` : "?"} → ${boxAfter ? `${Math.round(boxAfter.width)}×${Math.round(boxAfter.height)}` : "?"}, end ${replay}s → ${again}s, winner ${first.arenaWinner} → ${winner})`,
    );
    await page.setViewportSize({ width: 1400, height: 900 });
  }
}
{
  // Capture the flag, first to two: captures are counted and the score decides (or the clock, if nobody gets there).
  await page.goto(`${BASE}/en/simulator/?mode=ctf&ctfw=2`, { waitUntil: "networkidle" });
  const values = { ctfn: await sliderValue("Squares per Team"), ctfw: await sliderValue("Captures to Win") };
  const limit = await page.getByTestId("ctf-time-limit").innerText();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(outDir, "sim-ctf.png") });
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const finished = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-ctf-winner.png") });
  const [a, b] = (data.arenaScore || "0:0").split(":").map(Number);
  const onScore = Math.max(a, b) === 2;
  check(
    "capture the flag: captures score, the first to two wins (or the better score when time runs out)",
    values.ctfn === "2" && values.ctfw === "2" && /27s/.test(limit) && finished && data.arenaGame === "ctf" && data.arenaSquares === "4" && Number(data.arenaCaptures) === a + b && (onScore ? data.arenaWinner !== "draw" : Number(data.arenaFinishSec) >= 26.9) && /^(base|carried|dropped),(base|carried|dropped)$/.test(data.arenaFlags || ""),
    `(${JSON.stringify(values)}, "${limit}", ${JSON.stringify({ score: data.arenaScore, captures: data.arenaCaptures, drops: data.arenaDrops, returns: data.arenaReturns, flags: data.arenaFlags, winner: data.arenaWinner, at: data.arenaFinishSec })})`,
  );
}
{
  // Names and colours from the Teams roster; a battle between three: the winner is one of them.
  await page.goto(`${BASE}/en/simulator/?mode=battle&btn=3&teams=${encodeURIComponent("Alpha*ff0000*,Beta*00ff00*")}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const finished = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "1", null, { timeout: 60000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("the Teams roster names the squares (colour names for the rest)", finished && ["Alpha", "Beta", "Green"].includes(data.arenaWinner), `(winner=${data.arenaWinner})`);
  await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
  await page.waitForTimeout(500);
  check("the arena data leaves with the mode", (await canvasData()).arenaGame === undefined);
}
{
  // Frame rate: 20 squares with power-ups and the zone, and a 4 – 4 capture the flag (headless Chromium; 30+ fps on average
  // over 3 s, fpsFloor() on a busy machine).
  const rates = {};
  for (const [name, query] of [["battle 20", "mode=battle&btn=20&glow=1"], ["ctf 4-4", "mode=ctf&ctfn=4&glow=1"]]) {
    await page.goto(`${BASE}/en/simulator/?${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(500);
    rates[name] = await page.evaluate(
      (ms) =>
        new Promise((resolve) => {
          let frames = 0;
          const start = performance.now();
          const frame = (t) => {
            frames++;
            if (t - start < ms) requestAnimationFrame(frame);
            else resolve(Math.round((1000 * frames) / (t - start)));
          };
          requestAnimationFrame(frame);
        }),
      3000,
    );
  }
  check("the arena games keep 30+ fps", Object.values(rates).every((fps) => fps >= fpsFloor(30)), `(${JSON.stringify(rates)}, floor ${fpsFloor(30)}${loadNote()})`);
}
// --- end jdm-arena-games ---

// --- jdm-rhythm-runner ---
// 28. Beat Runner and Paddle Keep-Up: the preview images and both cards under the rhythm heading of the landing page; URL →
// the Mode-row blocks and back into the URL, the search box; a Beat Runner at 1× – every landing on a beat of the 120 BPM
// grid (data-rr-on-beat equals the landings, the notes – OscillatorNode.start is instrumented – come whole beats apart), no
// crash, 30+ fps, the finish; the default course at 8× to LEVEL COMPLETE and the end screen; a hand-played run – Space
// jumps instead of pausing, no jump crashes and restarts the section (ATTEMPT 2), the finder is hidden; the finder times an
// auto run for 30 s and the run keeps the promise; Paddle Keep-Up – URL → controls, a default game at 8× to GAME OVER
// after the allowed misses with a note per catch, skill 100% hides the finder, the arrow keys move a hand-played platform,
// the finder finds a 30 s game; a 1080×1920 recording of each keeps 20+ fps and downloads.
{
  for (const mode of ["runner", "paddle"]) {
    const res = await page.request.get(`${BASE}/modes/${mode}.webp`);
    check(`asset /modes/${mode}.webp`, res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  }
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const inRhythm = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("#modes h3")].find((h) => /rhythm/i.test(h.textContent || ""));
    const group = heading?.nextElementSibling;
    return ["runner", "paddle"].map((m) => !!group?.querySelector(`img[src$="/modes/${m}.webp"]`));
  });
  check("the Beat Runner and Paddle Keep-Up cards sit under the rhythm heading", inRhythm.every(Boolean), `(${JSON.stringify(inRhythm)})`);
}
/** Frame rates of the page over `ms` of requestAnimationFrame: the average and the worst half-second window. */
const jrFrameRates = async (ms) => {
  const deltas = await page.evaluate(
    (span) =>
      new Promise((resolve) => {
        const out = [];
        let last = performance.now();
        const end = last + span;
        const frame = (t) => {
          out.push(t - last);
          last = t;
          if (t < end) requestAnimationFrame(frame);
          else resolve(out);
        };
        requestAnimationFrame(frame);
      }),
    ms,
  );
  const windows = [];
  let acc = 0;
  let frames = 0;
  for (const d of deltas) {
    acc += d;
    frames++;
    if (acc >= 500) {
      windows.push((1000 * frames) / acc);
      acc = 0;
      frames = 0;
    }
  }
  const avg = (1000 * deltas.length) / deltas.reduce((a, b) => a + b, 0);
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0 };
};
/** Logs the frequency and time of every oscillator the page starts (the ToneGenerator's notes). */
const jrInstrumentTones = () =>
  page.evaluate(() => {
    const log = [];
    window.__jrOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push({ f: this.frequency.value, t: performance.now() });
      return start.apply(this, arguments);
    };
  });
const jrToggle = (testId, label) => page.getByTestId(testId).locator(`xpath=.//label[starts-with(normalize-space(.), "${label}")]/following-sibling::button[1]`);
{
  // The runner's block: from the URL into the controls, from the controls into the URL, and the search box.
  await page.goto(`${BASE}/en/simulator/?mode=runner&rrn=40&rrsp=12&rrj=3.2&rrd=0.8&rrm=blocks&rrbs=bpm&rra=0`, { waitUntil: "networkidle" });
  const values = { rrn: await sliderValue("Obstacles"), rrsp: await sliderValue("Run Speed"), rrj: await sliderValue("Jump Height"), rrd: await sliderValue("Density") };
  const blocks = await page.getByRole("group", { name: "Obstacle Mix", exact: true }).getByRole("button", { name: /Blocks/ }).getAttribute("aria-pressed");
  const bpm = await page.getByRole("group", { name: "Beat", exact: true }).getByRole("button", { name: /BPM/ }).getAttribute("aria-pressed");
  const auto = await jrToggle("runner-section", "Auto Jump").getAttribute("aria-pressed");
  const run = await page.getByTestId("runner-run").innerText();
  const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
  check(
    "the beat runner loads from the URL",
    values.rrn === "40" && values.rrsp === "12" && values.rrj === "3.2" && values.rrd === "0.8" && blocks === "true" && bpm === "true" && auto === "false" && /Space/.test(run) && noRingControls,
    `(${JSON.stringify(values)}, blocks=${blocks}, bpm=${bpm}, auto=${auto}, "${run}")`,
  );
  await page.getByRole("group", { name: "Obstacle Mix", exact: true }).getByRole("button", { name: /Mixed/ }).click();
  await jrToggle("runner-section", "Auto Jump").click();
  await page.locator('input[aria-label="Obstacles"]').evaluate(setRangeValue, "30");
  await page.waitForTimeout(300);
  const query = page.url().split("?")[1] || "";
  const info = await page.getByTestId("runner-run").innerText();
  check("the beat runner mirrors into the URL", /(^|&)rrn=30(&|$)/.test(query) && !/(^|&)rrm=/.test(query) && !/(^|&)rra=/.test(query) && /(^|&)rrbs=bpm(&|$)/.test(query) && /30 obstacles on a 120 BPM beat/.test(info), `(${query}, "${info}")`);
  await page.getByPlaceholder("Search settings...").fill("obstacle mix");
  const found = await page.getByRole("group", { name: "Obstacle Mix", exact: true }).isVisible();
  const hidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the beat runner controls", found && hidden, `(found=${found}, Ball Speed hidden=${hidden})`);
}
{
  // Auto jump at 1×: every landing on the beat, a note per landing whole beats apart, no crash, 30+ fps, then the finish.
  await page.goto(`${BASE}/en/simulator/?mode=runner&rrn=8&rrm=mixed`, { waitUntil: "networkidle" });
  await jrInstrumentTones();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(300);
  const fps = await jrFrameRates(5000);
  const mid = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-runner.png") });
  const done = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.rrFinished === "1", null, { timeout: 30000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const tones = await page.evaluate(() => window.__jrOsc);
  // One note per landing (the finale chord and the arpeggio come after the last one); a frame or two of jitter is allowed.
  const notes = tones.slice(0, Number(data.rrLandings || 0));
  const gaps = notes.slice(1).map((o, i) => o.t - notes[i].t);
  const onGrid = notes.length >= 2 && gaps.every((g) => Math.abs(g / 500 - Math.round(g / 500)) * 500 < 120 && g > 380);
  check(
    "beat runner: every landing on the beat (notes whole beats apart), no crash, at 30+ fps",
    Number(mid.rrLandings) >= 2 && mid.rrDeaths === "0" && onGrid && fps.windows.length >= 8 && fps.min >= fpsFloor(30),
    `(landings ${mid.rrLandings}/${mid.rrEvents} at 5 s, notes ${notes.length} gaps ${gaps.map((g) => Math.round(g)).join("/")} ms, avg ${fps.avg.toFixed(1)} fps, worst half-second ${fps.min.toFixed(1)} fps, floor ${fpsFloor(30)}${loadNote()})`,
  );
  check(
    "beat runner: the course is cleared on the beat to LEVEL COMPLETE",
    done && data.rrFinished === "1" && data.rrCrossed === "1" && data.rrLandings === data.rrEvents && data.rrOnBeat === data.rrLandings && data.rrCleared === data.rrEvents && data.rrDeaths === "0" && data.rrAuto === "1" && data.rrBpm === "120",
    `(finished=${done}, ${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("rr"))))})`,
  );
}
{
  // The default course (24 obstacles) at 8× to its end screen.
  await page.goto(`${BASE}/en/simulator/?mode=runner`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const end = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("beat runner: the default course at 8× ends on its end screen", end && data.rrFinished === "1" && Number(data.rrEvents) >= 24 && data.rrOnBeat === data.rrEvents && data.rrDeaths === "0", `(end screen=${end}, landings ${data.rrLandings}/${data.rrEvents}, on beat ${data.rrOnBeat})`);
  await page.screenshot({ path: path.join(outDir, "sim-runner-complete.png") });
}
{
  // Played by hand: the finder is hidden, Space jumps (the run does not pause), no jump crashes and restarts the section.
  await page.goto(`${BASE}/en/simulator/?mode=runner&rra=0&rrm=spikes`, { waitUntil: "networkidle" });
  const finder = await page.getByRole("button", { name: /Find \d+s Simulation/ }).count();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(400);
  await page.keyboard.press("Space");
  await page.waitForTimeout(700);
  const afterJump = await canvasData();
  const stillRunning = await page.getByRole("button", { name: /Pause/ }).isVisible();
  const crashed = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.rrAttempt || 0) >= 2, null, { timeout: 15000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-runner-manual.png") });
  check(
    "beat runner by hand: Space jumps (no pause), a crash restarts the section, no finder",
    finder === 0 && Number(afterJump.rrJumps) >= 1 && stillRunning && crashed && Number(data.rrDeaths) >= 1 && data.rrAuto === "0",
    `(finder buttons ${finder}, jumps ${afterJump.rrJumps}, running=${stillRunning}, attempt ${data.rrAttempt}, deaths ${data.rrDeaths})`,
  );
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("beat runner by hand: Escape pauses", await page.getByRole("button", { name: /Resume/ }).isVisible());
}
{
  // The finder times an auto run: 30 s, and the found run ends where it promised.
  await page.goto(`${BASE}/en/simulator/?mode=runner`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.rrFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await canvasData();
  }
  check("the finder finds a 30s beat runner and the run keeps the promise", ready && Math.abs(promised - 30) <= 0.5 && Math.abs(Number(data.rrEndSec) - promised) < 0.1, `(ready=${ready}, "${readyText}", ends at ${data.rrEndSec}s)`);
}
{
  // Paddle Keep-Up: the block from the URL; a perfect controller hides the finder.
  await page.goto(`${BASE}/en/simulator/?mode=paddle&pdsk=0.85&pdm=4&pdw=0.3&pdsp=0.4&pdu=0.05`, { waitUntil: "networkidle" });
  const values = { pdsk: await sliderValue("Skill"), pdm: await sliderValue("Misses Allowed"), pdw: await sliderValue("Platform Width"), pdsp: await sliderValue("Spin"), pdu: await sliderValue("Speed-Up") };
  const auto = await jrToggle("paddle-section", "Auto Platform").getAttribute("aria-pressed");
  const info = await page.getByTestId("paddle-info").innerText();
  const finderBefore = await page.getByRole("button", { name: /Find \d+s Simulation/ }).count();
  await page.locator('input[aria-label="Skill"]').evaluate(setRangeValue, "1");
  await page.waitForTimeout(300);
  const finderAfter = await page.getByRole("button", { name: /Find \d+s Simulation/ }).count();
  const perfect = await page.getByTestId("paddle-info").innerText();
  const query = page.url().split("?")[1] || "";
  check(
    "paddle keep-up loads from the URL; skill 100% never misses, so no finder",
    values.pdsk === "0.85" && values.pdm === "4" && values.pdw === "0.3" && values.pdsp === "0.4" && values.pdu === "0.05" && auto === "true" && /5 lives/.test(info) && finderBefore === 1 && finderAfter === 0 && /never misses/.test(perfect) && /(^|&)pdsk=1(&|$)/.test(query),
    `(${JSON.stringify(values)}, auto=${auto}, "${info}", finder ${finderBefore} → ${finderAfter}, ${query})`,
  );
}
{
  // A default game at 8×: a note per catch, GAME OVER after the allowed misses, the end screen.
  await page.goto(`${BASE}/en/simulator/?mode=paddle`, { waitUntil: "networkidle" });
  await jrInstrumentTones();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, "sim-paddle.png") });
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const end = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const tones = await page.evaluate(() => window.__jrOsc);
  await page.screenshot({ path: path.join(outDir, "sim-paddle-over.png") });
  check(
    "paddle keep-up: a note per catch, GAME OVER after the allowed misses",
    end && data.pdFinished === "1" && data.pdOver === "1" && data.pdMisses === "3" && data.pdAllowed === "2" && Number(data.pdHits) >= 1 && tones.length >= Number(data.pdHits) && data.pdAuto === "1",
    `(end screen=${end}, ${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("pd"))))}, ${tones.length} tones)`,
  );
}
{
  // Played by hand: the arrow keys move the platform.
  await page.goto(`${BASE}/en/simulator/?mode=paddle&pda=0`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(300);
  const x0 = Number((await canvasData()).pdX);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(400);
  await page.keyboard.up("ArrowRight");
  const x1 = Number((await canvasData()).pdX);
  await page.keyboard.down("ArrowLeft");
  await page.waitForTimeout(700);
  await page.keyboard.up("ArrowLeft");
  const x2 = Number((await canvasData()).pdX);
  const finder = await page.getByRole("button", { name: /Find \d+s Simulation/ }).count();
  check("paddle keep-up by hand: the arrow keys move the platform, no finder", x1 > x0 + 0.1 && x2 < x1 - 0.1 && finder === 0, `(x ${x0} → ${x1} → ${x2}, finder buttons ${finder})`);
}
{
  // The finder finds a 30 s game over and the game keeps the promise.
  await page.goto(`${BASE}/en/simulator/?mode=paddle`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.pdFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await canvasData();
  }
  check("the finder finds a 30s paddle game and the game keeps the promise", ready && Math.abs(promised - 30) <= 0.5 && Math.abs(Number(data.pdEndSec) - promised) < 0.1, `(ready=${ready}, "${readyText}", game over + hold at ${data.pdEndSec}s)`);
}
{
  // 1080×1920 recordings (the default resolution) of both modes.
  for (const mode of ["runner", "paddle"]) {
    await page.goto(`${BASE}/en/simulator/?mode=${mode}&dur=10`, { waitUntil: "networkidle" });
    let fps = { windows: [], avg: 0, min: 0 };
    const download = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
      (async () => {
        await page.getByRole("button", { name: /Record Video/ }).click();
        await page.waitForTimeout(300);
        fps = await jrFrameRates(3500);
        await page.getByRole("button", { name: /Stop & Export/ }).click();
      })(),
    ]).then(([d]) => d);
    let size = 0;
    if (download) {
      const file = path.join(outDir, `${mode}-${download.suggestedFilename()}`);
      await download.saveAs(file);
      size = fs.statSync(file).size;
    }
    check(`a 1080×1920 ${mode} recording keeps 20+ fps and downloads`, size > 10000 && fps.windows.length >= 5 && fps.min >= fpsFloor(20), `(${size} bytes, avg ${fps.avg.toFixed(1)} fps, worst half-second ${fps.min.toFixed(1)} fps, floor ${fpsFloor(20)}${loadNote()})`);
  }
}
// --- end jdm-rhythm-runner ---

const hardErrors = errors.filter((e) => !/favicon|ERR_INTERNET|net::ERR|fonts.googleapis|fonts.gstatic|Failed to load resource/.test(e));
check("no console/page errors", hardErrors.length === 0, hardErrors.length ? `\n   ${hardErrors.slice(0, 10).join("\n   ")}` : "");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
