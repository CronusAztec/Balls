/**
 * Headless browser smoke test against the exported site. Build and serve it first, e.g.
 *   NEXT_PUBLIC_BASE_PATH=/Balls NEXT_PUBLIC_SITE_URL=http://localhost:3000/Balls npm run build
 *   npm start -- --base /Balls            # serves ./out like GitHub Pages
 *   BASE_URL=http://localhost:3000/Balls npm run smoke
 *
 * It checks the root redirect, the 404 page, assets under the base path, opens every page in
 * every locale, starts the simulator in each mode, records a short clip, runs the seed
 * finder, submits the feedback form, switches language and reports console errors.
 */
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import { loadDotEnv } from "./dotenv.mjs";

loadDotEnv();
const BASE = (process.env.BASE_URL || `http://localhost:3000${process.env.NEXT_PUBLIC_BASE_PATH || ""}`).replace(/\/+$/, "");
const MODES = ["classic", "accumulation", "multiply", "lines", "paint", "target", "portal", "shatter", "colorMatch", "grow"];
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

/** A short 16-bit mono PCM WAV (sine sweep) for the song-slicer upload check. */
function makeWav(seconds = 2, sampleRate = 8000) {
  const frames = Math.round(seconds * sampleRate);
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
  for (let i = 0; i < frames; i++) {
    const t = i / sampleRate;
    buf.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * (220 + 220 * t) * t)), 44 + 2 * i);
  }
  return buf;
}

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok, extra });
  console.log(`${ok ? "✅" : "❌"} ${name} ${extra}`);
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
for (const asset of ["/notes/fur-elise.mid", "/wallBreak/pop.wav", "/hitSounds/click.wav", "/hitSounds/kick.wav", "/modes/classic.webp", "/icon.svg", "/og.png", "/sitemap.xml", "/robots.txt", "/404.html"]) {
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

// 5. Recording: 3-second clip downloads
await page.goto(`${BASE}/en/simulator/?mode=classic&dur=10`, { waitUntil: "networkidle" });
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
check("video recorded and downloaded", size > 10000, `(${download.suggestedFilename()}, ${size} bytes)`);

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

const hardErrors = errors.filter((e) => !/favicon|ERR_INTERNET|net::ERR|fonts.googleapis|fonts.gstatic|Failed to load resource/.test(e));
check("no console/page errors", hardErrors.length === 0, hardErrors.length ? `\n   ${hardErrors.slice(0, 10).join("\n   ")}` : "");

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
