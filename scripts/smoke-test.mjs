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
  check("simulator mode=collide runs 300 orbs for 5 s at 30+ fps", /\d/.test(time) && time !== "0.0s" && data.collideBodies === "300" && Number(data.collideCollisions) > 100 && windows.length >= 8 && minWindow >= 30, `(elapsed ${time}, ${data.collideBodies} orbs, ${data.collideCollisions} collisions, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps)`);
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
  check("simulator mode=glass smashes panes at 30+ fps", Number(data.glassHits) >= 8 && Number(data.glassShattered) >= 3 && data.glassPanes === "36" && data.glassStages === "4" && windows.length >= 10 && minWindow >= 30, `(${data.glassHits} hits, ${data.glassShattered}/${data.glassPanes} shattered, stage ${data.glassStage}/${data.glassStages}, avg ${avg.toFixed(1)} fps, worst half-second ${minWindow.toFixed(1)} fps)`);
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
  const data = await canvasData();
  check("the multipliers board counts arrivals home and finishes", arrived && done && Number(data.multHome) > 0 && data.multActive === "0", `(home ${data.multHome}, clones ${data.multClones}, gate passes ${data.multGates}, in play ${data.multActive}, done ${data.multDone})`);
  await page.screenshot({ path: path.join(outDir, "sim-multipliers-home.png") });
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

const hardErrors = errors.filter((e) => !/favicon|ERR_INTERNET|net::ERR|fonts.googleapis|fonts.gstatic|Failed to load resource/.test(e));
check("no console/page errors", hardErrors.length === 0, hardErrors.length ? `\n   ${hardErrors.slice(0, 10).join("\n   ")}` : "");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
