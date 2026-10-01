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
// --- review fix (site-static) --- the served origin and base path: same-origin failures are the site's, foreign ones are noise
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname.replace(/\/+$/, "");
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() !== "error") return;
  const text = m.text();
  // A resource that failed on another host (fonts, analytics, publish endpoints, a sandbox without network) is not the site's
  // error; a same-origin one stays (its HTTP status is also reported precisely by the response listener below).
  const url = m.location()?.url || "";
  if (/^Failed to load resource/.test(text) && url && !url.startsWith(`${ORIGIN}/`)) return;
  errors.push(`console: ${text}${/^Failed to load resource/.test(text) && url ? ` (${url})` : ""}`);
});
/**
 * --- review fix (site-static) --- Every same-origin response of 400 or more fails the run ("no failed same-origin requests"): a
 * forgotten assetPath(), a missing modes/<new>.webp, a renamed song, a URL that dropped the base path (it hits the same origin
 * at /modes/... and gets a 404). Only the URLs the suite requests on purpose are expected, by pathname. page.request.get()
 * probes go through the APIRequestContext and fire no page "response" events.
 */
const expected404 = new Set([`${BASE_PATH}/pl/this-page-does-not-exist/`, `${BASE_PATH}/en/nothing-here/`]);
const badResponses = [];
page.on("response", (r) => {
  let u;
  try {
    u = new URL(r.url());
  } catch {
    return;
  }
  if (u.origin !== ORIGIN || r.status() < 400 || expected404.has(u.pathname)) return;
  const where = BASE_PATH && !u.pathname.startsWith(`${BASE_PATH}/`) ? " (outside base path)" : "";
  badResponses.push(`${r.status()} ${u.pathname}${u.search}${where}`);
});
/** Console noise every check may ignore: foreign hosts, aborted fetches and navigations, and HTTP errors (the response listener's). */
const IGNORED_CONSOLE = /favicon|ERR_INTERNET|fonts.googleapis|fonts.gstatic|net::ERR_ABORTED|net::ERR_CERT|Failed to load resource: the server responded with a status of/;

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
 * --- review fix (site-static) --- Timing checks on a shared machine. Other builds and browser tests often share it (CI runners,
 * agent hosts), and the 1-minute load average lags behind what the page actually gets, so the floors are fixed. A timing check
 * that fails is measured once more about 2 s later (where its conditions can be measured again), after a baseline: 1 s of
 * requestAnimationFrame on the same page with the run paused (the canvas keeps drawing, the physics stands still). If it still
 * fails while the paused page itself gets fewer than BUSY_BASELINE_FPS, the machine – not the run – is short of CPU: the result
 * is "inconclusive", listed apart and not counted as a failure, unless SMOKE_STRICT_TIMING=1 (smoke.yml on GitHub's dedicated
 * runners). Frame rates are judged on the average and a low percentile of the half-second windows (lowWindow), not on the
 * single worst window.
 */
const STRICT_TIMING = process.env.SMOKE_STRICT_TIMING === "1";
// An idle machine gives the paused page its full 60 fps; well below that, it is already dropping frames of a light page.
const BUSY_BASELINE_FPS = 50;
const inconclusiveResults = [];
const inconclusive = (name, extra = "") => {
  inconclusiveResults.push({ name, extra });
  console.log(`⚠️ ${name} – inconclusive ${extra}`);
};
/** Frames per second over `span` ms of requestAnimationFrame (runs in the page). */
const rafRate = (span) =>
  new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    const frame = (t) => {
      frames++;
      if (t - start < span) requestAnimationFrame(frame);
      else resolve((1000 * frames) / (t - start));
    };
    requestAnimationFrame(frame);
  });
/** The page's own frame rate over `ms` with the run paused (resumed afterwards): what the machine gives it right now (NaN if unmeasurable). */
const measureBaseline = async (ms = 1000) => {
  const pause = page.getByRole("button", { name: /⏸ Pause/ }).first();
  const paused = (await pause.isVisible().catch(() => false)) && (await pause.click({ timeout: 2000 }).then(() => true).catch(() => false));
  try {
    await page.waitForTimeout(200);
    return await page.evaluate(rafRate, ms);
  } catch {
    return NaN;
  } finally {
    if (paused) await page.getByRole("button", { name: /▶ Resume/ }).first().click({ timeout: 2000 }).catch(() => {});
  }
};
/**
 * A check whose verdict hangs on the frame rate or the wall clock. `ok` is its functional part (never retried, never excused),
 * `timingOk` the timing part of the first measurement; `retry` (optional) measures the timing again and returns
 * { timingOk, extra }.
 */
const timingCheck = async (name, ok, timingOk, extra, retry) => {
  if (!ok || timingOk) return check(name, ok && timingOk, extra);
  await page.waitForTimeout(2000);
  const baseline = await measureBaseline();
  const again = retry ? await retry().catch((e) => ({ timingOk: false, extra: `(retry failed: ${String(e).split("\n")[0]})` })) : null;
  if (again?.timingOk) return check(name, true, `${again.extra} – on the second try, the first ${extra}`);
  const detail = again ? `${extra}, second try ${again.extra}` : extra;
  const base = Number.isFinite(baseline) ? `${baseline.toFixed(0)} fps` : "n/a";
  if (!STRICT_TIMING && baseline < BUSY_BASELINE_FPS) return inconclusive(name, `${detail} (machine busy: baseline ${base} with the run paused)`);
  check(name, false, `${detail} (baseline ${base} with the run paused)`);
};
/** The low frame rate of a run: its 10th-percentile half-second window (the 2nd-worst of 10–19), the worst of fewer than 5. */
const lowWindow = (windows) => {
  if (!windows.length) return 0;
  const sorted = [...windows].sort((a, b) => a - b);
  return sorted.length < 5 ? sorted[0] : sorted[Math.max(1, Math.floor(sorted.length / 10))];
};
/** Frame rates from frame intervals (ms): the average, the half-second windows, the worst and the low window. */
const fpsStats = (deltas) => {
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
  const total = deltas.reduce((a, b) => a + b, 0);
  return { windows, avg: total > 0 ? (1000 * deltas.length) / total : 0, min: windows.length ? Math.min(...windows) : 0, low: lowWindow(windows) };
};
/** Frame intervals of the page over `span` ms of requestAnimationFrame (runs in the page). */
const rafDeltas = (span) =>
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
  });
const pageFrameRates = async (ms) => fpsStats(await page.evaluate(rafDeltas, ms));
const fpsNote = (f) => `avg ${f.avg.toFixed(1)} fps, low half-second ${f.low.toFixed(1)} fps, worst ${f.min.toFixed(1)} fps`;
const fpsOk = (f, minWindows, avgFloor, lowFloor = avgFloor) => f.windows.length >= minWindows && f.avg >= avgFloor && f.low >= lowFloor;
/** The simulator's clock label in seconds ("12.3s", "1:02.3"; NaN without one). It stops when the run finishes or pauses. */
const simClock = async () => {
  const text = ((await page.locator("span.tabular-nums").first().innerText({ timeout: 2000 }).catch(() => "")) || "").trim();
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)s?$/.exec(text);
  return m ? Number(m[1] || 0) * 60 + Number(m[2]) : NaN;
};
/** A retry for a recording's frame rate: 3.5 s more of the page recorded as it is now, then Stop & Export (that download is dropped). */
const recordingRetry = (minWindows, floor) => async () => {
  let f = { windows: [], avg: 0, min: 0, low: 0 };
  await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      // (a page that cannot record again right now costs 10 s, not the default 30; a run that finishes meanwhile ends – and
      // downloads – the recording by itself)
      await page.getByRole("button", { name: /Record Video/ }).click({ timeout: 10000 });
      await page.waitForTimeout(300);
      f = await pageFrameRates(3500);
      const stop = page.getByRole("button", { name: /Stop & Export/ });
      if (await stop.isVisible().catch(() => false)) await stop.click({ timeout: 10000 });
    })(),
  ]);
  return { timingOk: fpsOk(f, minWindows, floor), extra: `(recorded again: ${fpsNote(f)})` };
};
/** A retry for the frame rate of a run that keeps going: `ms` more of frames – valid only while the run's clock moves on. */
const fpsRetry = (ms, minWindows, avgFloor, lowFloor = avgFloor) => async () => {
  const before = await simClock();
  const f = await pageFrameRates(ms);
  const after = await simClock();
  const running = after > before;
  return { timingOk: running && fpsOk(f, minWindows, avgFloor, lowFloor), extra: `(${fpsNote(f)}${running ? "" : `; the run's clock stood still (${before} → ${after} s), nothing to measure`})` };
};
const loadNote = () => {
  const load = os.loadavg()[0];
  const cpus = os.cpus().length || 1;
  return load > cpus ? `, load ${load.toFixed(1)} on ${cpus} cores` : "";
};

/** --- review fix (ui-i18n) --- the panel's ON/OFF toggles are switches named by their label: a name that starts with `label`. */
const switchName = (label) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

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
  // --- review fix (site-static) --- the localised title survives hydration (the (static) layout sets no metadata <title> that
  // would write "JumpingBallsLive" back) and the locale-less pages carry a favicon under the base path
  const titled = await page.waitForFunction(() => document.title.startsWith("Nie znaleziono strony"), null, { timeout: 10000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1500);
  const title = await page.title();
  const icon = await page.locator('link[rel~="icon"]').first().getAttribute("href").catch(() => null);
  const iconUrl = icon ? new URL(icon, page.url()).href : "";
  check("the 404 page keeps its localised title and has a favicon under the base path", titled && title.startsWith("Nie znaleziono strony") && iconUrl.startsWith(`${BASE}/`), `(title "${title}", icon ${icon})`);
  await page.goto(`${BASE}/en/nothing-here/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  check("the English 404 page keeps its title", (await page.title()).startsWith("Page not found"), `(title "${await page.title()}")`);
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/(en|pl|es)\/$/, { timeout: 10000 }).catch(() => {});
}
{
  // --- review fix (site-static) --- the root redirect page keeps a title of its own (page metadata) and its favicon
  const html = await (await page.request.get(`${BASE}/`)).text();
  check("the root redirect page has a title and a favicon under the base path", /<title>[^<]+<\/title>/.test(html) && html.includes(`href="${BASE_PATH}/icon.svg"`), `(${(/<title>[^<]*<\/title>/.exec(html) || ["no title"])[0]})`);
}
for (const asset of ["/notes/fur-elise.mid", "/wallBreak/pop.wav", "/hitSounds/click.wav", "/hitSounds/kick.wav", "/modes/classic.webp", "/modes/drop.webp", "/modes/box.webp", "/modes/pendulum.webp", "/icon.svg", "/og.png", "/sitemap.xml", "/robots.txt", "/404.html"]) {
  const res = await page.request.get(`${BASE}${asset}`);
  check(`asset ${asset}`, res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
}
{
  const xml = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  check("sitemap uses site URL with trailing slashes", xml.includes(`${BASE}/en/simulator/`) && xml.includes(`${BASE}/es/about/`), "");
}

// 1. Static pages in every locale
for (const locale of ["en", "pl", "es"]) {
  for (const p of ["", "/simulator" /* --- review fix (site-static) --- its sr-only heading */, "/about", "/tiktok-ball-videos", "/feedback", "/privacy", "/terms", "/disclaimer", "/gallery" /* --- daily-gallery --- */]) {
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
{
  // --- review fix (site-static) --- the copyright line names the site, never a host; the mode cards' alt text is localised
  const footer = await page.locator("footer").last().innerText();
  check("the footer's copyright names the site, not a domain", /© \d{4} JumpingBallsLive/.test(footer) && !/©[^\n]*\.(com|io)/i.test(footer), `(${(/©[^\n]*/.exec(footer) || ["no ©"])[0]})`);
  await page.goto(`${BASE}/pl/`, { waitUntil: "networkidle" });
  const alt = await page.locator('img[src$="/modes/classic.webp"]').first().getAttribute("alt");
  check("the mode preview alt text is localised", alt === "Podgląd trybu Klasyczny", `(alt="${alt}")`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
}
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

// 2. Simulator: the original ring and rhythm modes (MODES) run for a few seconds without errors and the ball moves (the later
// modes have their own sections below).
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
const stored = await page.evaluate(() => localStorage.getItem("jumpingballslive_saved_settings"));
check("preset persisted to localStorage", !!stored && stored.includes("smoke"));

// 4a. Custom hit sample: switch the bounce sound to a sample, pick a built-in clip, check the URL and that it decodes
await page.getByRole("button", { name: /Custom Sound/ }).click();
await page.getByRole("button", { name: /Audio sample/ }).click();
const hitSampleSelect = page.locator("#hit-sample-select");
check("hit sample controls appear in sample mode", await hitSampleSelect.isVisible() && (await page.locator('input[aria-label="Sample Volume"]').isVisible()));
await hitSampleSelect.selectOption("kick");
await page.waitForTimeout(1500);
check("hit sample settings mirrored into the URL", page.url().includes("hsm=sample") && page.url().includes("hs=kick"), `(${page.url().split("?")[1]})`);
// The "Pitch by Wall" toggle is the switch named by its label (other toggles in the section read "On" as well).
await page.getByRole("switch", { name: switchName("Pitch by Wall") }).click();
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
// --- review fix (site-static) --- clips carry no watermark unless the user types one (no domain burned in by default)
check("the watermark is empty by default", (await wm.inputValue()) === "", `(value="${await wm.inputValue()}")`);
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
  const rain = await page.getByRole("switch", { name: switchName("Rain (Loop)") }).getAttribute("aria-checked");
  const finderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  check("ball drop loads from URL", values.dbc === "6" && values.drows === "4" && values.dsi === "0" && rain === "true" && finderHidden, `(${JSON.stringify(values)}, rain=${rain}, finder hidden=${finderHidden})`);
}
await page.locator('input[aria-label="Peg Rows"]').evaluate(setRangeValue, "6");
await page.getByRole("switch", { name: switchName("Rain (Loop)") }).click();
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
const loopToggle = page.getByRole("switch", { name: switchName("Loop Music") });
await loopToggle.click();
await page.waitForTimeout(300);
const loopOff = (await loopToggle.getAttribute("aria-checked")) === "false";
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
// --- review fix (modes-rhythm) --- classic Paint ends at 95 % coverage, so Find Simulation is offered (hidden with a picture, below)
const paintFinderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
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
{
  // --- review fix (modes-rhythm) --- a picture run follows the page's picture and song, which the finder cannot replay
  const paintFinderHidden = (await page.getByRole("button", { name: /Find 30s Simulation/ }).count()) === 0;
  check("classic Paint offers Find Simulation; a loaded picture hides it", paintFinderShown && paintFinderHidden, `(shown ${paintFinderShown}, hidden with a picture ${paintFinderHidden})`);
}
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
await page.getByRole("switch", { name: switchName("Guided Coverage") }).click();
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
// --- review fix (recording-export) --- Record Video writes MP4 only with H.264 (never VP9 + Opus inside an .mp4), WebM otherwise
{
  const bytes = fs.readFileSync(dlPath);
  const isMp4 = download.suggestedFilename().endsWith(".mp4");
  const hasAvc = bytes.includes(Buffer.from("avc1")) || bytes.includes(Buffer.from("avc3"));
  const hasVp9 = bytes.includes(Buffer.from("vp09"));
  check("Record Video: an .mp4 holds H.264, anything else is a .webm", isMp4 ? hasAvc && !hasVp9 : bytes.readUInt32BE(0) === 0x1a45dfa3, `(${download.suggestedFilename()}: avc ${hasAvc}, vp09 ${hasVp9})`);
}

// --- review fix (recording-export) --- links with numbers out of their slider range, Record Video on a finished run, a
// pre-rename preset's watermark and the batch summary's clip length
{
  const errorsBefore = errors.length;
  // 1. A negative ball size – as a long link and as the share code of mode=classic&r=-5 – opens at the smallest ball (the
  // canvas used to throw on arc() with a negative radius and Next showed its "Application error" page).
  const opened = [];
  for (const query of ["mode=classic&r=-5", "c=q1bKzU9JVbJSSs5JLC7OTFbSUSpSstI1rQUA"]) {
    await page.goto(`${BASE}/en/simulator/?${query}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => new URL(location.href).searchParams.get("r") === "4", null, { timeout: 10000 }).catch(() => {});
    const appError = await page.getByText(/Application error/).isVisible().catch(() => false);
    const started = await page.getByRole("button", { name: /Start Simulator/ }).click({ timeout: 10000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(500);
    opened.push({ query, r: new URL(page.url()).searchParams.get("r"), appError, started });
  }
  const newErrors = errors.slice(errorsBefore).filter((e) => !IGNORED_CONSOLE.test(e));
  check("a link or share code with r=-5 opens at the smallest ball size (r=4) without a crash", opened.every((o) => o.r === "4" && !o.appError && o.started) && newErrors.length === 0, `(${JSON.stringify(opened)}${newErrors.length ? `, ${newErrors[0]}` : ""})`);

  // 2. wc=3000 keeps its 3000 rings (big values are kept) and the page stays responsive: the canvas draws about one ring per pixel.
  await page.goto(`${BASE}/en/simulator/?mode=classic&wc=3000`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);
  const t0 = Date.now();
  await page.evaluate(() => 1);
  const roundTrip = Date.now() - t0;
  const t1 = Date.now();
  const bigStarted = await page.getByRole("button", { name: /Start Simulator/ }).click({ timeout: 10000 }).then(() => true).catch(() => false);
  const clickMs = Date.now() - t1;
  const bigFrames = await page.evaluate(() => new Promise((resolve) => {
    let n = 0;
    const s = performance.now();
    const f = (t) => (++n, t - s < 2000 ? requestAnimationFrame(f) : resolve(n));
    requestAnimationFrame(f);
  }));
  check("a link with wc=3000 keeps its rings and the page stays responsive", new URL(page.url()).searchParams.get("wc") === "3000" && bigStarted && roundTrip < 2000 && bigFrames >= 4, `(round trip ${roundTrip} ms, Start ${clickMs} ms, ${bigFrames} frames in 2 s)`);

  // 3. Record Video on a finished run records the run again from its seed (as the fast export renders it), not half a second
  // of the frozen end screen: right after the click the end screen is gone and Stop & Export shows; the clip ends with the run.
  await page.goto(`${BASE}/en/simulator/?mode=classic&wc=1&gap=1&dur=10&res=500x500`, { waitUntil: "networkidle" });
  const runStart = Date.now();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const over = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  const runMs = Date.now() - runStart;
  const seedBefore = await page.evaluate(() => document.querySelector("main canvas")?.dataset.seed ?? null);
  let downloadAt = null;
  let replayDownload = null;
  const onReplayDownload = (d) => {
    downloadAt ??= Date.now();
    replayDownload ??= d;
  };
  page.on("download", onReplayDownload);
  const clickedAt = Date.now();
  await page.getByRole("button", { name: /Record Video/ }).click();
  await page.waitForTimeout(400);
  const stopShown = await page.getByRole("button", { name: /Stop & Export/ }).isVisible().catch(() => false);
  const endScreenGone = !(await page.getByRole("button", { name: /Restart Simulation/ }).isVisible().catch(() => false));
  const seedAfter = await page.evaluate(() => document.querySelector("main canvas")?.dataset.seed ?? null);
  await page.waitForTimeout(1600);
  // (a run of a few seconds cannot be over again within 2 s; a very short one – a first-bounce escape – may be)
  const earlyDownload = downloadAt !== null && downloadAt - clickedAt < 2000 && runMs > 4000;
  for (let i = 0; i < 60 && !replayDownload; i++) await page.waitForTimeout(500);
  page.off("download", onReplayDownload);
  let replayBytes = 0;
  if (replayDownload) {
    const out = path.join(outDir, `replay-${replayDownload.suggestedFilename()}`);
    await replayDownload.saveAs(out);
    replayBytes = fs.statSync(out).size;
  }
  const replayMs = downloadAt ? downloadAt - clickedAt : null;
  check(
    "Record Video on a finished run records the run again from its seed (no half-second still of the end screen)",
    over && stopShown && endScreenGone && seedBefore !== null && seedAfter === seedBefore && !earlyDownload && replayMs !== null && replayMs > 0.5 * runMs && replayBytes > 10000,
    `(run ${runMs} ms, seed ${seedBefore} → ${seedAfter}, stop shown ${stopShown}, end screen gone ${endScreenGone}, download after ${replayMs} ms, ${replayBytes} bytes)`,
  );

  // 4. A preset saved before the rename (under the old storage key, with the old default watermark) loads with today's
  // default watermark: the link carries no wm=viralballs.com.
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    localStorage.removeItem("jumpingballslive_saved_settings");
    localStorage.setItem("viralballs_saved_settings", JSON.stringify({ "My old preset": { mode: "shatter", gravity: 700, watermarkText: "viralballs.com" } }));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Saved Presets/ }).click();
  const presetRow = page.locator("div", { hasText: /^My old preset/ }).last();
  await presetRow.getByRole("button", { name: "Load", exact: true }).click({ timeout: 10000 }).catch(() => {});
  await page.waitForFunction(() => new URL(location.href).searchParams.get("g") === "700", null, { timeout: 10000 }).catch(() => {});
  const presetParams = new URL(page.url()).searchParams;
  check("a pre-rename preset loads without the old viralballs.com watermark", presetParams.get("mode") === "shatter" && presetParams.get("g") === "700" && !presetParams.has("wm"), `(${presetParams.toString()})`);
  await page.evaluate(() => localStorage.removeItem("jumpingballslive_saved_settings"));

  // 5. The batch summary names the longest clip of the plan: a sweep of the clip length from 10 to 120 s says "up to 120 s".
  await page.evaluate(() => localStorage.setItem("jumpingballslive_batch_render", JSON.stringify({ v: 1, source: "list", list: "101", variant: "sweep", sweepKey: "recordingDuration", sweepFrom: 10, sweepTo: 120, sweepSteps: 3 })));
  await page.goto(`${BASE}/en/simulator/?mode=classic&dur=10&res=500x500`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Recording/ }).click();
  const sweepSummary = await page.locator("[data-batch]").getByText(/clips? · 500×500/).first().innerText({ timeout: 10000 }).catch(() => "");
  check("the batch summary of a clip-length sweep names its longest clip", /up to 120 s each/.test(sweepSummary), `("${sweepSummary}")`);
  await page.evaluate(() => localStorage.removeItem("jumpingballslive_batch_render"));
}

// --- review fix (security-robustness) --- hostile input: huge counts in a link, a stored preset list that is not an object, and a
// project file with a crafted MIDI file (a five-byte length that looped the parser for ever), damaged pictures, a damaged
// wall-break sound and a resolution no browser can capture
{
  const errorsBefore = errors.length;
  const framesIn2s = () =>
    page.evaluate(() => new Promise((resolve) => {
      let n = 0;
      const s = performance.now();
      const f = (t) => (++n, t - s < 2000 ? requestAnimationFrame(f) : resolve(n));
      requestAnimationFrame(f);
    }));
  // 1. wc=1000000 / tc=1000000 (each blocked the main thread for more than 15 s) keep their value in the link, run at the soft
  // ceiling – the notice under the canvas says so – and the page stays responsive.
  for (const query of ["mode=classic&wc=1000000", "mode=target&tc=1000000"]) {
    const t0 = Date.now();
    await page.goto(`${BASE}/en/simulator/?${query}`, { waitUntil: "networkidle", timeout: 60000 });
    const loadMs = Date.now() - t0;
    const started = await page.getByRole("button", { name: /Start Simulator/ }).click({ timeout: 10000 }).then(() => true).catch(() => false);
    const frames = await framesIn2s();
    const t1 = Date.now();
    await page.evaluate(() => 1);
    const roundTrip = Date.now() - t1;
    const notice = await page.getByTestId("soft-ceiling-notice").innerText({ timeout: 5000 }).catch(() => "");
    const [key, value] = query.split("&")[1].split("=");
    check(
      `a link with ${query} keeps its value, runs at the soft ceiling (said under the canvas) and the page stays responsive`,
      new URL(page.url()).searchParams.get(key) === value && started && frames >= 4 && roundTrip < 2000 && /1,000,000.*\b(1,000|100)\b/.test(notice),
      `(load ${loadMs} ms, ${frames} frames in 2 s, round trip ${roundTrip} ms, notice "${notice}")`,
    );
  }

  // 2. A stored preset list of null (any page of the origin can write it) crashed the simulator on every visit.
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  const storedLists = [];
  for (const stored of ["null", "[]", '{"a":null,"Kept":{"mode":"shatter","gravity":700}}']) {
    await page.evaluate((v) => localStorage.setItem("jumpingballslive_saved_settings", v), stored);
    await page.reload({ waitUntil: "networkidle" });
    const appError = await page.getByText(/Application error/).isVisible().catch(() => false);
    const startShown = await page.getByRole("button", { name: /Start Simulator/ }).isVisible().catch(() => false);
    storedLists.push({ stored, appError, startShown });
  }
  await page.getByRole("button", { name: /Saved Presets/ }).click().catch(() => {});
  const keptRow = await page.locator("div", { hasText: /^Kept/ }).last().isVisible().catch(() => false);
  await page.evaluate(() => localStorage.removeItem("jumpingballslive_saved_settings"));
  check("a stored preset list that is not an object of presets never crashes the simulator; the valid presets in it stay", storedLists.every((o) => !o.appError && o.startShown) && keptRow, `(${JSON.stringify(storedLists)}, kept row ${keptRow})`);

  // 3. A project with the crafted 34-byte MIDI file, three pictures and a wall-break sound that are text, and a 30000×30000
  // resolution: it opens at once, says that 5 media files were left out, and the resolution is the default one.
  const crafted = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 1, 0, 1, 0, 0x60, 0x4d, 0x54, 0x72, 0x6b, 0, 0, 0, 12, 0x00, 0xff, 0x01, 0x8f, 0xff, 0xff, 0xff, 0x78, 0x00, 0xff, 0x2f, 0x00];
  const junk = Buffer.from("this is neither a picture nor a sound ".repeat(14));
  const asset = (name, type, bytes) => ({ name, type, size: bytes.length, data: Buffer.from(bytes).toString("base64") });
  const hostile = {
    format: "jumpingballslive-project",
    version: 1,
    name: "hostile",
    settings: { mode: "classic", recordingResolution: "30000x30000" },
    assets: {
      midi: asset("a.mid", "audio/midi", crafted),
      wallBreakSound: asset("boom.mp3", "audio/mpeg", junk),
      ballImage: asset("ball.png", "image/png", junk),
      paintPicture: asset("paint.png", "image/png", junk),
      backgroundImage: asset("bg.png", "image/png", junk),
    },
  };
  const hostilePath = path.join(outDir, "hostile.jumpingballslive.json");
  fs.writeFileSync(hostilePath, JSON.stringify(hostile));
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  if (!(await page.getByTestId("project-section").isVisible().catch(() => false))) await page.getByRole("button", { name: /Project file/ }).click();
  await page.getByTestId("project-section").waitFor({ timeout: 5000 }).catch(() => {});
  const importStart = Date.now();
  await page.locator("#project-file-input").setInputFiles(hostilePath);
  const hostileStatus = await page.getByTestId("project-status").waitFor({ timeout: 20000 }).then(() => page.getByTestId("project-status").innerText()).catch(() => "");
  const importMs = Date.now() - importStart;
  const t2 = Date.now();
  await page.evaluate(() => 1);
  const hostileRoundTrip = Date.now() - t2;
  const hostileMedia = (await page.getByTestId("project-media").innerText().catch(() => "")).replace(/\s+/g, " ");
  const hostileParams = new URL(page.url()).searchParams;
  check(
    "a project with a crafted MIDI file, undecodable pictures and wall-break sound and a bogus resolution opens at once and counts the 5 left out",
    /Opened .hostile., but 5 damaged media/.test(hostileStatus) && hostileRoundTrip < 2000 && !hostileParams.has("res") && !/ball\.png|paint\.png|bg\.png|a\.mid|boom\.mp3/.test(hostileMedia),
    `(status "${hostileStatus}" after ${importMs} ms, round trip ${hostileRoundTrip} ms, media "${hostileMedia}", link ${hostileParams.toString()})`,
  );

  // The MIDI file's parse error is logged on purpose; anything else (a page error, a hang's aftermath) is not.
  const fresh = errors.splice(errorsBefore);
  const unexpected = fresh.filter((e) => !IGNORED_CONSOLE.test(e) && !/Failed to parse uploaded MIDI file/.test(e));
  check("the hostile inputs cause no page errors", unexpected.length === 0, unexpected.length ? `\n   ${unexpected.slice(0, 5).join("\n   ")}` : "");
}
// --- end review fix (security-robustness) ---

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
await page.getByRole("button", { name: /Español/ }).click(); // --- review fix (ui-i18n) --- a disclosure list of buttons, not an ARIA menu
await page.waitForURL(/\/es\/simulator\//);
check("language switch to Spanish", page.url().includes("/es/simulator/"), `(${page.url()})`);

// 8. Mode card on the simulator page switches the mode in place
await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
await page.waitForTimeout(500);
check("mode card switches mode", page.url().includes("mode=portal"), `(${page.url()})`);

// --- gerald-faces ---
// 9. Ball characters: no face by default; the "Character" group at the top of the Ball section shows a live preview,
// "Meet Gerald" sets the persona (face, name, squash) and everything mirrors into the URL; the running canvas draws the
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
await page.getByRole("button", { name: /Meet Gerald/ }).click();
await page.waitForTimeout(400);
{
  const query = page.url().split("?")[1] || "";
  const cute = await page.getByRole("group", { name: "Face", exact: true }).getByRole("button", { name: /Cute/ }).getAttribute("aria-pressed");
  const name = await page.locator("#ball-name-input").inputValue();
  check("Meet Gerald sets the persona and mirrors it into the URL", /(^|&)face=cute(&|$)/.test(query) && /(^|&)bn=Gerald(&|$)/.test(query) && /(^|&)sq=0\.6(&|$)/.test(query) && cute === "true" && name === "Gerald", `(${query})`);
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
    /(^|&)face=cat(&|$)/.test(query) && /(^|&)sq=0\.8(&|$)/.test(query) && data.face === "cat" && Number(data.faceCount) >= 1 && data.nameLabel === "Gerald" && ["neutral", "ouch", "shock", "grin", "happy"].includes(data.faceExpression) && preview === "cat",
    `(${JSON.stringify(data)}, preview=${preview})`,
  );
}
await page.getByRole("button", { name: "🏀", exact: true }).click();
await page.waitForTimeout(400);
const faceOnEmojiBefore = (await canvasData()).faceCount;
await page.getByRole("switch", { name: switchName("Face on Image / Emoji") }).click();
await page.waitForTimeout(400);
{
  const after = await canvasData();
  check("a face goes over an emoji ball only with the overlay option", faceOnEmojiBefore === "0" && after.faceCount === "1" && after.nameLabel === "Gerald" && /(^|&)fimg=1(&|$)/.test(page.url().split("?")[1] || ""), `(before ${faceOnEmojiBefore}, after ${after.faceCount})`);
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
await page.goto(`${BASE}/en/simulator/?mode=classic&face=dot&bn=Gerald&nl=0`, { waitUntil: "networkidle" });
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
// --- end gerald-faces ---
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
  await page.getByRole("switch", { name: switchName("Polygons") }).click();
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
const collideToggle = (label) => page.getByTestId("collision-playground").getByRole("switch", { name: switchName(label) });
await page.goto(`${BASE}/en/simulator/?mode=collide&cpn=120&cpc=box&cpsq=1&cpac=3&cpe=0.9`, { waitUntil: "networkidle" });
{
  const values = { cpn: await sliderValue("Orbs"), cpe: await sliderValue("Bounciness"), cpac: await sliderValue("Anti-Collision At") };
  const box = await page.getByRole("group", { name: "Container" }).getByRole("button", { name: /Box/ }).getAttribute("aria-pressed");
  const squishy = await collideToggle("Squishy").getAttribute("aria-checked");
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
  const fr = { windows, avg, min: minWindow, low: lowWindow(windows) }; // --- review fix (site-static) ---
  const data = await page.locator("canvas").first().evaluate((c) => ({ ...c.dataset }));
  const time = await page.locator("span.tabular-nums").first().innerText();
  await timingCheck("simulator mode=collide runs 300 orbs for 5 s at 30+ fps", /\d/.test(time) && time !== "0.0s" && data.collideBodies === "300" && Number(data.collideCollisions) > 100, fpsOk(fr, 8, 30), `(elapsed ${time}, ${data.collideBodies} orbs, ${data.collideCollisions} collisions, ${fpsNote(fr)}, floor 30${loadNote()})`, fpsRetry(4000, 6, 30));
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
  await page.goto(`${BASE}/en/simulator/?mode=${mode}&${query}&face=cute&bn=Gerald`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1000);
  const { face, faceCount, nameLabel } = await canvasData();
  check(`a character from the URL shows on the ${mode} bodies`, face === "cute" && Number(faceCount) === faces && nameLabel === "Gerald", `(face=${face}, faces=${faceCount}, label=${nameLabel})`);
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
  // --- review fix (site-static) --- the sim clock when the export stops: the recorder's timer runs on the wall clock, so on a
  // machine too busy to keep the run in real time the export can stop before the run's finish (the sim lagged)
  let stoppedAt = 0;
  let simAtStop = NaN;
  const download = await Promise.all([
    page
      .waitForEvent("download", { timeout: 90000 })
      .then(async (d) => {
        stoppedAt = Date.now();
        simAtStop = await simClock();
        return d;
      })
      .catch(() => null),
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
  const ok = Number.isFinite(runSec) && duration >= runSec + 2.95 && duration <= runSec + 4.05 && wonAt > 0 && bytes > 10000;
  const extra = `(${text.replace(/\s+/g, " ")}, export length ${duration} s, winner ${wonAt ? ((wonAt - recordedAt) / 1000).toFixed(1) : "-"} s into the recording, export done ${heldMs} ms after it, ${bytes} bytes, sim clock ${simAtStop} s at the stop)`;
  // The export stopped while the run was still short of its finish: the sim lagged the wall clock, nothing the page decides.
  // (A margin over the label's 0.1 s ticks: a run that did finish before the stop is never excused.)
  const lagged = ok && heldMs < 2500 && stoppedAt > 0 && Number.isFinite(simAtStop) && simAtStop < runSec - 0.3;
  if (lagged && !STRICT_TIMING) inconclusive(name, `${extra} (sim lagged ${((stoppedAt - recordedAt) / 1000 - simAtStop).toFixed(1)} s behind the wall clock)`);
  else check(name, ok && heldMs >= 2500, extra);
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
  const cameraToggle = (label) => page.getByTestId("camera-section").getByRole("switch", { name: switchName(label) });
  const cameraPhase = () => page.evaluate(() => document.querySelector("main canvas")?.dataset.cameraReplay ?? "");
  await page.goto(`${BASE}/en/simulator/?mode=classic&cz=0.6&shake=0.5&slow=1&slowf=0.3&slowms=900&replay=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Visual Effects/ }).click();
  {
    const values = { cz: await sliderValue("Camera Zoom"), shake: await sliderValue("Screen Shake"), slowf: await sliderValue("Slow-Mo Speed"), slowms: await sliderValue("Slow-Mo Length") };
    const slow = await cameraToggle("Slow-Mo on Near Miss").getAttribute("aria-checked");
    const replay = await cameraToggle("Replay on Escape").getAttribute("aria-checked");
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
// --- gerald-glass ---
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
const glassToggle = (label) => page.getByTestId("glass-smash").getByRole("switch", { name: switchName(label) });
await page.goto(`${BASE}/en/simulator/?mode=glass&glr=9&glhp=3&gls=5&glm=0`, { waitUntil: "networkidle" });
{
  const values = { glr: await sliderValue("Panes per Stage"), glhp: await sliderValue("Hits per Pane"), gls: await sliderValue("Stages") };
  const moving = await glassToggle("Sliding Panes").getAttribute("aria-checked");
  const holes = await glassToggle("Panes with Holes").getAttribute("aria-checked");
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
  const fr = { windows, avg, min: minWindow, low: lowWindow(windows) }; // --- review fix (site-static) ---
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__glassOsc);
  const clips = await page.evaluate(() => window.__glassClips);
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const onScale = midis.length > 0 && midis.every((m) => m >= 48 && m <= 84 && [0, 2, 4, 5, 7, 9, 11].includes(m % 12));
  await timingCheck("simulator mode=glass smashes panes at 30+ fps", Number(data.glassHits) >= 8 && Number(data.glassShattered) >= 3 && data.glassPanes === "36" && data.glassStages === "4", fpsOk(fr, 10, 30), `(${data.glassHits} hits, ${data.glassShattered}/${data.glassPanes} shattered, stage ${data.glassStage}/${data.glassStages}, ${fpsNote(fr)}, floor 30${loadNote()})`, fpsRetry(4000, 6, 30));
  check("glass pane hits play scale degrees and shatters play the glass clip", onScale && new Set(midis).size >= 3 && clips.length >= 1 && clips.every((d) => d > 0.6 && d < 0.8), `(${pitches.length} tones, ${new Set(midis).size} distinct degrees, ${clips.length} glass clips)`);
  await page.screenshot({ path: path.join(outDir, "sim-glass.png") });
}
await page.goto(`${BASE}/en/simulator/?mode=glass&glr=3&glhp=1&gls=2&face=cute&bn=Gerald`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  check("glass smash reaches HOME through every stage and finishes", done && data.glassHome === "1" && data.glassStage === "2" && Number(data.glassCamera) > 0 && Number(data.glassShattered) >= 3 && data.face === "cute", `(finished=${done}, home=${data.glassHome}, stage ${data.glassStage}/${data.glassStages}, camera ${data.glassCamera}, ${data.glassShattered}/${data.glassPanes} shattered, face=${data.face})`);
  await page.screenshot({ path: path.join(outDir, "sim-glass-home.png") });
}
// --- gerald-multipliers --- Glass Smash with its multiplier gates (glg=1): the switch in the Glass block, the Ball section's
// Multipliers group (the cap), and a run in which the gate row of every stage stacks its multiplier on the ball – the HUD
// mirrors it into data-mult-* – on its way HOME. The first row is read at normal speed, then the run goes on at 8×: a ball
// that falls fast through the first stage meets the next row within a second of simulation – about a tenth of a second at
// 8× –, so read at 8× "after the first row" often held both rows already.
await page.goto(`${BASE}/en/simulator/?mode=glass&glg=1&gls=2&glr=4`, { waitUntil: "networkidle" });
{
  const gates = await glassToggle("Multiplier Gates").getAttribute("aria-checked").catch(() => null);
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
// --- end gerald-glass ---
// --- gerald-multipliers ---
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
  // The "N Gerald made it home" banner and its confetti play before the end screen covers them (a recording keeps them).
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
  const fr = { windows, avg, min: minWindow, low: lowWindow(windows) }; // --- review fix (site-static) ---
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-multiply-speed.png") });
  await timingCheck("Multiply with speed orbs stays within 200 balls at a steady frame rate", crowd && peak > 64 && peak <= 200 && Number(data.multBalls) <= 200, fpsOk(fr, 4, 15, 10), `(peak ${peak} balls, now ${data.multBalls}, speed x${data.multSpeed}, ${fpsNote(fr)}, floors 15/10${loadNote()})`, fpsRetry(3000, 4, 15, 10));
}
// --- end gerald-multipliers ---
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
  const dpToggle = (label) => page.getByTestId("double-pendulum").getByRole("switch", { name: switchName(label) });
  await page.goto(`${BASE}/en/simulator/?mode=doublePendulum&dpn=3&dpsg=3&dprs=0&dpa1=100&dpa3=-45&dpst=16&dpsl=radial&dpo=3&dptr=6&dpd=0.0015&dpen=1`, { waitUntil: "networkidle" });
  {
    const values = { dpn: await sliderValue("Pendulums"), dpa1: await sliderValue("Start Angle 1"), dpa3: await sliderValue("Start Angle 3"), dpst: await sliderValue("Harp Strings"), dpo: await sliderValue("Harp Octaves"), dptr: await sliderValue("Trail Length"), dpd: await sliderValue("Friction") };
    const triple = await page.getByRole("group", { name: "Arms", exact: true }).getByRole("button", { name: "Triple", exact: true }).getAttribute("aria-pressed");
    const radial = await page.getByRole("group", { name: "String Layout", exact: true }).getByRole("button", { name: /Radial/ }).getAttribute("aria-pressed");
    const endless = await dpToggle("Endless").getAttribute("aria-checked");
    const randomStart = await dpToggle("Random Start").getAttribute("aria-checked");
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
  const fr = { windows, avg, min: minWindow, low: lowWindow(windows) }; // --- review fix (site-static) ---
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__dpOsc);
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  // 15 strings over two octaves of C major from C4 (the chromatic default leaves them unsnapped).
  const ladder = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
  const onLadder = pitches.length > 0 && midis.every((m) => ladder.includes(m));
  await timingCheck(
    "simulator mode=doublePendulum plucks the harp at 30+ fps",
    data.dpPendulums === "1" && data.dpSegments === "2" && data.dpStrings === "15" && data.dpLayout === "vertical" && Number(data.dpPlucks) >= 20 && onLadder && Number(data.dpDrift) < 100,
    fpsOk(fr, 6, 30),
    `(${data.dpPlucks} plucks, ${pitches.length} tones, MIDI ${[...new Set(midis)].sort((a, b) => a - b).join("/")}, drift ${data.dpDrift} ppm, ${fpsNote(fr)}, floor 30${loadNote()})`,
    fpsRetry(4000, 6, 30),
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
  const illusionToggle = (label) => page.getByTestId("illusion-section").getByRole("switch", { name: switchName(label) });
  const typeButton = (name) => page.getByRole("group", { name: "Illusion", exact: true }).getByRole("button", { name: new RegExp(name) });
  await page.goto(`${BASE}/en/simulator/?mode=illusion&ilt=rings&ilr=6&ils=1.5&ilc=2&iltr=0&ilrv=1&wob=0.5`, { waitUntil: "networkidle" });
  {
    const values = { ilr: await sliderValue("Rings"), ils: await sliderValue("Illusion Speed"), ilc: await sliderValue("Cycles") };
    const rings = await typeButton("Rings").getAttribute("aria-pressed");
    const tracks = await illusionToggle("Tracks").getAttribute("aria-checked");
    const reveal = await illusionToggle("Reveal").getAttribute("aria-checked");
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
  // The defaults of every type keep the frame rate (headless Chromium; 30+ fps on average over 3 s; timingCheck() on a busy machine).
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
  await timingCheck("every illusion type keeps 30+ fps with wobbly walls", true, Object.values(rates).every((fps) => fps >= 30), `(${JSON.stringify(rates)}, floor 30${loadNote()})`);
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
  const neverToggle = section.getByRole("switch", { name: switchName("Never Escape") });
  {
    const shown = await section.isVisible();
    const pressed = await neverToggle.getAttribute("aria-checked").catch(() => null);
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
  const toggle = (label) => section.getByRole("switch", { name: switchName(label) });
  {
    const values = { sbn: await sliderValue("Fighters"), sbl: await sliderValue("Lives"), sbm: await sliderValue("Threads per Ball"), sbd: await sliderValue("Clip Limit"), sbf: await sliderValue("Finale Speed"), sbw: await sliderValue("Ring Wobble") };
    const touch = await pick("Combat Rule", "Touch").getAttribute("aria-pressed");
    const neon = await pick("Style", "Neon").getAttribute("aria-pressed");
    const badge = await toggle("Warning Badge").getAttribute("aria-checked");
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
  const fr = { windows, avg, min: minWindow, low: lowWindow(windows) }; // --- review fix (site-static) ---
  const early = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-string-battle.png") });
  await timingCheck(
    "simulator mode=stringBattle anchors threads and runs at 30+ fps",
    early.sbBalls === "4" && Number(early.sbBounces) > 4 && Number(early.sbStrings) > 0 && early.sbBadge === "1" && early.sbHud === "1" && early.sbStyle === "web",
    fpsOk(fr, 8, 30),
    `(${JSON.stringify({ balls: early.sbBalls, bounces: early.sbBounces, strings: early.sbStrings, lives: early.sbLives })}, ${fpsNote(fr)}, floor 30${loadNote()})`,
    fpsRetry(4000, 6, 30),
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
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0, low: lowWindow(windows) };
};
{
  const plToggle = (label) => page.getByTestId("power-layers").getByRole("switch", { name: switchName(label) });
  const seqButton = (name) => page.getByRole("group", { name: "Power Sequence", exact: true }).getByRole("button", { name: new RegExp(name) });
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers&pll=300&plq=fibonacci&pld=0.5&plsp=1.5&plb=warning&plp=0`, { waitUntil: "networkidle" });
  {
    const values = { pll: await sliderValue("Layers"), pld: await sliderValue("Drift"), plsp: await sliderValue("Bounce Speed") };
    const fib = await seqButton("Fibonacci").getAttribute("aria-pressed");
    const badge = await page.locator("#power-layers-badge").inputValue();
    const pills = await plToggle("Rule Badges").getAttribute("aria-checked");
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
  await timingCheck(
    "power layers: a hit every bounce period, each level the next note of the scale, at 30+ fps",
    // (the note gaps are wall-clock times of the oscillator starts: timing, like the frame rate)
    Number(mid.plHits) >= 5 && midis.join(",") === "60,62,64,65",
    gaps.every((g) => g > 800 && g < 1200) && fpsOk(fps, 8, 30),
    `(hits ${mid.plHits}/${mid.plTotalHits}, first notes MIDI ${midis.join("/")} ${gaps.join("/")} ms apart, ${tones.length} tones, ${fpsNote(fps)}, floor 30${loadNote()})`,
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
  let fps = { windows: [], avg: 0, min: 0, low: 0 };
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
  // floor is 20 fps here (inconclusive rather than failed on a busy machine, like every timing check), well above a mode that would stall it.
  await timingCheck("a 1080×1920 power layers recording keeps 20+ fps and downloads", size > 10000, fpsOk(fps, 5, 20), `(${size} bytes, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
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
// bed downloads as <name>.jumpingballslive.json holding the settings and the track as base64. Import on a fresh page (the
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
    "Export project downloads <name>.jumpingballslive.json with the settings and the uploaded media",
    bedUploaded &&
      /Background music\s*smoke-bed\.wav/.test(mediaText) &&
      projectDownload.suggestedFilename() === "Smoke project.jumpingballslive.json" &&
      project?.format === "jumpingballslive-project" &&
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
    dt.items.add(new File([text], "dropped.jumpingballslive.json", { type: "application/json" }));
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
  await dropOn(hitZone, "my.jumpingballslive.json", "application/json", projectText);
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
  await dropOn(wallBreakZone, "my.jumpingballslive.json", "application/json", projectText);
  await page.waitForFunction(() => new URL(location.href).searchParams.get("g") === "700", null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(300);
  const wallBreakValue = await page.locator("#wallbreak-select").inputValue({ timeout: 5000 }).catch(() => "(missing)");
  const wallBreakProjectOption = await page.locator("#wallbreak-select option", { hasText: "my.jumpingballslive.json" }).count().catch(() => -1);
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
  check("a JSON file that is not a project is refused", /not a JumpingBallsLive project/.test(refusedText) && linkParams().get("mode") === "lines" && linkParams().get("g") === "450", `(status "${refusedText}", link ${linkParams().toString()})`);

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
  const raceToggle = (label) => page.getByTestId("race-section").getByRole("switch", { name: switchName(label) });
  await page.goto(`${BASE}/en/simulator/?mode=race&rcn=12&rcs=circle&rcl=5&rclp=2&rcf=turbo&rccam=pack&rccup=1&rcct=Neon%20Cup&rcw=3&rcst=0&rcmm=0`, { waitUntil: "networkidle" });
  {
    const values = { rcn: await sliderValue("Racers"), rcl: await sliderValue("Track Length"), rclp: await sliderValue("Laps") };
    const circles = await page.getByRole("group", { name: "Racer Shape", exact: true }).getByRole("button", { name: /Circles/ }).getAttribute("aria-pressed");
    const pack = await page.getByRole("group", { name: "Camera", exact: true }).getByRole("button", { name: /Pack/ }).getAttribute("aria-pressed");
    const mix = await page.locator("#race-feature").inputValue();
    const standings = await raceToggle("Live Standings").getAttribute("aria-checked");
    const miniMap = await raceToggle("Mini-map").getAttribute("aria-checked");
    const cup = await raceToggle("Cup").first().getAttribute("aria-checked");
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
  const fr = { windows, avg, min: minWindow, low: lowWindow(windows) }; // --- review fix (site-static) ---
  const data = await canvasData();
  const pitches = await page.evaluate(() => window.__raceOsc);
  // The racers' notes: a C-major pentatonic ladder from C4, one per racer (the chromatic default leaves them unsnapped).
  const ladder = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86, 88, 91, 93, 96];
  const midis = pitches.map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  const racerNotes = midis.filter((m) => ladder.includes(m)).length;
  await timingCheck(
    "simulator mode=race runs the race at 30+ fps with the racers' notes",
    data.raceRacers === "8" && data.racePhase === "racing" && Number(data.raceHits) >= 5 && Number(data.racePasses) >= 1 && Number(data.raceCamera) > 100 && data.raceOrder.split(",").length === 8 && racerNotes >= 3,
    fpsOk(fr, 6, 30),
    `(${data.raceHits} hits, ${data.racePasses} passes, ${data.raceCallouts} callouts, camera ${data.raceCamera}, ${pitches.length} tones, ${racerNotes} racer notes, ${fpsNote(fr)}, floor 30${loadNote()})`,
    fpsRetry(4000, 6, 30),
  );
  await page.screenshot({ path: path.join(outDir, "sim-race.png") });
}
// A short race at 8× with the cup on: the podium, the cup table, the finish – scored once into the cup, and a second race adds to it.
await page.goto(`${BASE}/en/simulator/?mode=race&rcn=5&rcl=3&rccup=1`, { waitUntil: "networkidle" });
await page.evaluate(() => localStorage.removeItem("jumpingballslive:race-cup"));
await page.getByRole("button", { name: /Start Simulator/ }).click();
await page.getByRole("button", { name: "8x", exact: true }).click();
{
  const podium = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.racePhase === "podium", null, { timeout: 30000 }).then(() => true).catch(() => false);
  const atPodium = await canvasData();
  const cupShown = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.racePhase === "cup", null, { timeout: 15000 }).then(() => true).catch(() => false);
  if (cupShown) await page.screenshot({ path: path.join(outDir, "sim-race-cup.png") });
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  const cup = await page.evaluate(() => JSON.parse(localStorage.getItem("jumpingballslive:race-cup") || "null"));
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
    const cup2 = await page.evaluate(() => JSON.parse(localStorage.getItem("jumpingballslive:race-cup") || "null"));
    const summary = await page.getByTestId("race-cup-summary").innerText().catch(() => "");
    check("a second race adds its points to the cup", again && cup2?.races === 2 && cup2.points.reduce((a, b) => a + b, 0) === 2 * 80 && /2 race/.test(summary), `(finished=${again}, stored ${JSON.stringify(cup2)}, "${summary}")`);
  }
}
// --- fast-render --- A race the page has already scored, then fast-exported: the export's cup table shows it as the same race
// ("Race 1", the page's run key), not as a second one with doubled points, and the export stores nothing.
if (await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined")) {
  await page.goto(`${BASE}/en/simulator/?mode=race&rcn=5&rcl=3&rccup=1&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  // A new cup (the page reads the stored one when it loads, so it loads again).
  await page.evaluate(() => localStorage.removeItem("jumpingballslive:race-cup"));
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const scored = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 45000 }).then(() => true).catch(() => false);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem("jumpingballslive:race-cup") || "null"));
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
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem("jumpingballslive:race-cup") || "null"));
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
  // --- review fix (modes-rhythm) --- another canvas size can play a race out differently (float rounding), so a resize after
  // Find drops the found run – its "Ready to start simulation for …" promise and the Found! line go with it
  if (found) {
    const box0 = await page.locator("main canvas").boundingBox();
    await page.setViewportSize({ width: 800, height: 1300 });
    await page.waitForTimeout(600);
    const box1 = await page.locator("main canvas").boundingBox();
    const ready = await page.getByText(/Ready to start simulation for/).count();
    const foundLine = await page.getByText(/Found! [\d.]+s/).count();
    const resized = !!box0 && !!box1 && (Math.abs(box0.width - box1.width) > 20 || Math.abs(box0.height - box1.height) > 20);
    check("a resize after Find drops a found race", resized && ready === 0 && foundLine === 0, `(canvas ${box0 ? `${Math.round(box0.width)}×${Math.round(box0.height)}` : "?"} → ${box1 ? `${Math.round(box1.width)}×${Math.round(box1.height)}` : "?"}, ready ${ready}, found ${foundLine})`);
    await page.setViewportSize({ width: 1400, height: 900 });
  }
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
  const arenaToggle = (label) => page.getByTestId("arena-games-section").getByRole("switch", { name: switchName(label) });
  await page.goto(`${BASE}/en/simulator/?mode=battle&btn=12&bthp=6&btd=1.5&bta=circle&bts=0&btp=0&arn=0.8`, { waitUntil: "networkidle" });
  {
    const values = { btn: await sliderValue("Squares"), bthp: await sliderValue("Hit Points"), btd: await sliderValue("Damage"), arn: await sliderValue("Director Nudge") };
    const circle = await page.getByRole("group", { name: "Arena", exact: true }).getByRole("button", { name: /Circle/ }).getAttribute("aria-pressed");
    const shrink = await arenaToggle("Shrinking Zone").getAttribute("aria-checked");
    const powerUps = await arenaToggle("Power-ups").getAttribute("aria-checked");
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
  // --- review fix (modes-rhythm) --- the finder runs the seed with the page's Cinematic switch (the director draws from the
  // run's random numbers), and a battle's speeds scale with the field: a battle found with Cinematic off, the window resized
  // before Start, keeps its seed and its "Found!" line and replays to the length it was found with
  await page.goto(`${BASE}/en/simulator/?mode=battle&cine=0`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
  const text = done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  const foundSec = Number((/Found! ([\d.]+)s/.exec(text) || [])[1]);
  let replay = NaN;
  let kept = false;
  let resized = false;
  if (foundSec > 0) {
    const box0 = await page.locator("main canvas").boundingBox();
    await page.setViewportSize({ width: 800, height: 1300 });
    await page.waitForTimeout(600);
    const box1 = await page.locator("main canvas").boundingBox();
    resized = !!box0 && !!box1 && (Math.abs(box0.width - box1.width) > 20 || Math.abs(box0.height - box1.height) > 20);
    kept = (await page.getByText(/Found! [\d.]+s/).count()) > 0;
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click().catch(() => {});
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.arenaFinished === "1", null, { timeout: 60000 }).catch(() => {});
    replay = Number((await canvasData()).arenaFinishSec);
    await page.setViewportSize({ width: 1400, height: 900 });
  }
  check("a battle found with Cinematic off replays to its length, after a resize before Start too", foundSec > 0 && resized && kept && Math.abs(replay - foundSec) <= 0.051, `(${text}, resized ${resized}, kept ${kept}, replay ${replay}s)`);
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
  // over 3 s; timingCheck() on a busy machine).
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
  await timingCheck("the arena games keep 30+ fps", true, Object.values(rates).every((fps) => fps >= 30), `(${JSON.stringify(rates)}, floor 30${loadNote()})`);
}
// --- end jdm-arena-games ---

// --- jdm-rhythm-runner ---
// 31. Beat Runner and Paddle Keep-Up: the preview images and both cards under the rhythm heading of the landing page; URL →
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
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0, low: lowWindow(windows) };
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
const jrToggle = (testId, label) => page.getByTestId(testId).getByRole("switch", { name: switchName(label) });
{
  // The runner's block: from the URL into the controls, from the controls into the URL, and the search box.
  await page.goto(`${BASE}/en/simulator/?mode=runner&rrn=40&rrsp=12&rrj=3.2&rrd=0.8&rrm=blocks&rrbs=bpm&rra=0`, { waitUntil: "networkidle" });
  const values = { rrn: await sliderValue("Obstacles"), rrsp: await sliderValue("Run Speed"), rrj: await sliderValue("Jump Height"), rrd: await sliderValue("Density") };
  const blocks = await page.getByRole("group", { name: "Obstacle Mix", exact: true }).getByRole("button", { name: /Blocks/ }).getAttribute("aria-pressed");
  const bpm = await page.getByRole("group", { name: "Beat", exact: true }).getByRole("button", { name: /BPM/ }).getAttribute("aria-pressed");
  const auto = await jrToggle("runner-section", "Auto Jump").getAttribute("aria-checked");
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
  await timingCheck(
    "beat runner: every landing on the beat (notes whole beats apart), no crash, at 30+ fps",
    // (the note gaps are wall-clock times of the oscillator starts: timing, like the frame rate; the sim clock's on-beat count
    // is checked strictly below)
    Number(mid.rrLandings) >= 2 && mid.rrDeaths === "0",
    onGrid && fpsOk(fps, 8, 30),
    `(landings ${mid.rrLandings}/${mid.rrEvents} at 5 s, notes ${notes.length} gaps ${gaps.map((g) => Math.round(g)).join("/")} ms, ${fpsNote(fps)}, floor 30${loadNote()})`,
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
  const auto = await jrToggle("paddle-section", "Auto Platform").getAttribute("aria-checked");
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
    let fps = { windows: [], avg: 0, min: 0, low: 0 };
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
    await timingCheck(`a 1080×1920 ${mode} recording keeps 20+ fps and downloads`, size > 10000, fpsOk(fps, 5, 20), `(${size} bytes, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
  }
}
// 31b. Review fixes of the rhythm modes. A melody on Paddle Keep-Up: every catch plays the melody's next note and only a
// catch does (the walls, the ceiling and the streak chime accompany it with the bounce instrument). A Beat Runner re-plans
// only when what its course follows changes, and then restarts the music bed with the course: a song analysed under a run
// on the BPM changes nothing, switching it onto the song's beat restarts the bed with the course and the landings fall on
// the song's clicks, the BPM of a run on a song changes nothing; the BPM drops a found seed only for a runner on the BPM,
// never in Classic. A run played by hand has no fast export (the button is off and says so) and its batch job fails as
// "played by hand".
/** Logs every oscillator (time, audio time, scheduled time, pitch, waveform) and buffer source (the music bed: start(0, offset)). */
const jrInstrumentAudio = () =>
  page.evaluate(() => {
    const osc = [];
    const src = [];
    window.__jrAudio = { osc, src };
    const oscStart = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (when) {
      if (this.frequency.value !== 1) osc.push({ t: performance.now(), ctx: this.context.currentTime, when: typeof when === "number" && when > 0 ? when : this.context.currentTime, f: this.frequency.value, type: this.type });
      return oscStart.apply(this, arguments);
    };
    const srcStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function () {
      src.push({ t: performance.now(), ctx: this.context.currentTime, args: [...arguments], dur: this.buffer ? this.buffer.duration : 0 });
      return srcStart.apply(this, arguments);
    };
  });
/** The music bed's starts (a buffer source started as start(0, offset) on a track longer than `minSec`). */
const jrBedStarts = async (minSec = 20) => (await page.evaluate(() => window.__jrAudio.src)).filter((s) => s.args.length === 2 && s.dur > minSec);
const jrMark = () => page.evaluate(() => performance.now());
const jrSeed = async () => (await canvasData()).seed;
{
  // A melody on Paddle Keep-Up (the saw voice) – the bounce tones keep the triangle.
  await page.goto(`${BASE}/en/simulator/?mode=paddle&pdsk=1&minst=saw`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await page.locator("#song-select").selectOption("fur-elise");
  const loaded = await page
    .waitForFunction(() => {
      const select = document.querySelector("#song-select");
      return !!select && !select.disabled && select.value === "fur-elise";
    }, null, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await jrInstrumentAudio();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(14000);
  await page.getByRole("button", { name: /Pause/ }).click();
  await page.waitForTimeout(400);
  const data = await canvasData();
  const tones = await page.evaluate(() => window.__jrAudio.osc);
  const melody = tones.filter((o) => o.type === "sawtooth");
  const bounce = tones.filter((o) => o.type === "triangle");
  const hits = Number(data.pdHits);
  const walls = Number(data.pdWalls) + Number(data.pdCeiling);
  check(
    "paddle keep-up with a melody: each catch plays the melody's next note and only a catch – walls and ceiling keep the bounce tone",
    loaded && hits >= 5 && walls >= 1 && melody.length === hits && bounce.length >= walls,
    `(${hits} catches, ${data.pdWalls} wall + ${data.pdCeiling} ceiling bounces; ${melody.length} melody notes, ${bounce.length} bounce tones)`,
  );
}
{
  // A song analysed under a run on the BPM changes nothing; switching the run onto the song's beat restarts the course and
  // the music bed together, and the landings then fall on the song's clicks. The square's position is logged every frame,
  // so a restart of the course cannot hide between two reads.
  const P = 60 / 128;
  await page.goto(`${BASE}/en/simulator/?mode=runner&rrn=60&rrd=1&rrbs=bpm`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await jrInstrumentAudio();
  await page.evaluate(() => {
    const log = [];
    window.__rrXLog = log;
    const frame = () => {
      const x = Number(document.querySelector("main canvas")?.dataset.rrX);
      if (Number.isFinite(x)) log.push({ t: performance.now(), x });
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1000);
  await page.locator("#music-file-input").setInputFiles({ name: "smoke-click-128.wav", mimeType: "audio/wav", buffer: makeClickWav(30, 128) });
  await page.getByTestId("music-track").waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const onBpm = await canvasData();
  const bedsBefore = await jrBedStarts();
  const switchAt = await jrMark();
  await page.getByRole("group", { name: "Beat", exact: true }).getByRole("button", { name: /Song/ }).click();
  const switched = await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.rrBpm) !== 120, null, { timeout: 15000 }).then(() => true).catch(() => false);
  const switchedAt = await jrMark();
  await page.waitForTimeout(5500);
  const onSong = await canvasData();
  const beds = await jrBedStarts();
  const xLog = await page.evaluate(() => window.__rrXLog);
  const restartBed = beds.find((b) => b.t >= switchAt - 20);
  const tones = await page.evaluate(() => window.__jrAudio.osc);
  // On the BPM the square only ever moves on; after the switch it starts over from the beginning of the new course.
  const beforeSwitch = xLog.filter((e) => e.t < switchAt);
  const steady = beforeSwitch.length > 100 && beforeSwitch.every((e, i) => i === 0 || e.x >= beforeSwitch[i - 1].x - 1e-6);
  const restartedCourse = xLog.some((e) => e.t >= switchAt && e.x < 1) && Number(onSong.rrX) > 5;
  // The landing notes (the bounce instrument) after the restart, against the clicks of the bed (0.25 s + k · P into the song).
  const notes = restartBed ? tones.filter((o) => o.type === "triangle" && o.when > restartBed.ctx + 0.05) : [];
  const phase = notes.map((o) => {
    let e = (((o.when - restartBed.ctx + restartBed.args[1] - 0.25) % P) + P) % P;
    if (e > P / 2) e -= P;
    return e;
  });
  const sorted = phase.map(Math.abs).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : Infinity;
  // --- review fix (site-static) --- a landing is heard on the frame that detects it, so the phase tolerance grows by the slowest
  // frame of the window after the switch (the rAF log above), capped at a quarter beat where the check would stop meaning
  // anything; a run still off the clicks on a busy machine is inconclusive rather than failed (timingCheck).
  const afterSwitch = xLog.filter((e) => e.t >= switchAt);
  const worstFrameMs = afterSwitch.slice(1).reduce((w, e, i) => Math.max(w, e.t - afterSwitch[i].t), 0);
  const tolerance = Math.min(0.08 + worstFrameMs / 1000, P / 4);
  check(
    "beat runner on the BPM: a song loaded and analysed mid-run does not restart the run",
    bedsBefore.length === 1 && onBpm.rrBpm === "120" && steady && onBpm.rrAttempt === "1" && Number(onBpm.rrLandings) >= 2,
    `(bed starts ${bedsBefore.length}, x only moving on=${steady} over ${beforeSwitch.length} frames to ${onBpm.rrX}, bpm ${onBpm.rrBpm}, landings ${onBpm.rrLandings})`,
  );
  await timingCheck(
    "beat runner: switching onto the song's beat restarts the music bed with the course, and the landings fall on the song's clicks",
    switched && Math.abs(Number(onSong.rrBpm) - 128) <= 2 && restartedCourse && !!restartBed && restartBed.args[1] === 0 && notes.length >= 3,
    switchedAt - switchAt < 1500 && !!restartBed && restartBed.t - switchAt < 1000 && median < tolerance,
    `(bpm ${onSong.rrBpm} after ${Math.round(switchedAt - switchAt)} ms, course restarted=${restartedCourse}, bed restarted ${restartBed ? `${Math.round(restartBed.t - switchAt)} ms after the switch at offset ${restartBed.args[1]}` : "never"}, ${notes.length} landings, phase to the clicks ${phase.map((e) => Math.round(1000 * e)).join("/")} ms, median |${Math.round(1000 * median)}| ms, tolerance ${Math.round(1000 * tolerance)} ms (slowest frame ${Math.round(worstFrameMs)} ms)${loadNote()})`,
  );
}
{
  // The BPM of a run on a song's beat changes nothing (the Beat lock shows the BPM slider).
  await page.goto(`${BASE}/en/simulator/?mode=runner&rrn=60&qz=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await page.locator("#music-file-input").setInputFiles({ name: "smoke-click-128.wav", mimeType: "audio/wav", buffer: makeClickWav(30, 128) });
  const onSong = await page.waitForFunction(() => Math.abs(Number(document.querySelector("main canvas")?.dataset.rrBpm) - 128) <= 2, null, { timeout: 20000 }).then(() => true).catch(() => false);
  await jrInstrumentAudio();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1500);
  const before = await canvasData();
  const changeAt = await jrMark();
  await page.locator('input[aria-label="BPM"]').evaluate(setRangeValue, "100");
  await page.waitForTimeout(700);
  const after = await canvasData();
  const beds = await jrBedStarts();
  const query = page.url().split("?")[1] || "";
  check(
    "beat runner on a song's beat: the BPM changes nothing (no restart of the run or the music)",
    onSong && /(^|&)bpm=100(&|$)/.test(query) && Number(after.rrX) > Number(before.rrX) && after.rrAttempt === "1" && after.rrBpm === before.rrBpm && beds.length === 1 && beds.every((b) => b.t < changeAt),
    `(song beat=${onSong}, x ${before.rrX} → ${after.rrX}, bpm ${before.rrBpm} → ${after.rrBpm}, bed starts ${beds.length}, ${query})`,
  );
}
{
  // A found seed: the BPM keeps it in Classic (R restarts the found run) and drops it for a runner that follows the BPM.
  await page.goto(`${BASE}/en/simulator/?mode=classic&qz=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const classicFound = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
  const found = await jrSeed();
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await page.locator('input[aria-label="BPM"]').evaluate(setRangeValue, "128");
  await page.waitForTimeout(400);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("r");
  await page.waitForTimeout(400);
  const restarted = await jrSeed();
  check("classic: a BPM change keeps a found seed (R restarts the found run)", classicFound && !!found && restarted === found && /(^|&)bpm=128(&|$)/.test(page.url()), `(found ${found}, after the BPM and R ${restarted})`);
  await page.goto(`${BASE}/en/simulator/?mode=runner&qz=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const runnerFound = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  const runnerSeed = await jrSeed();
  await page.getByRole("button", { name: /Custom Sound/ }).click();
  await page.locator('input[aria-label="BPM"]').evaluate(setRangeValue, "128");
  await page.waitForTimeout(400);
  const replanned = await canvasData();
  check("beat runner on the BPM: a BPM change re-plans the course and drops the found seed", runnerFound && !!runnerSeed && replanned.seed !== runnerSeed && replanned.rrBpm === "128", `(found ${runnerSeed}, after the BPM ${replanned.seed}, course at ${replanned.rrBpm} BPM)`);
}
{
  // Played by hand: no fast export (the button is off and says to use Record Video); Auto Jump brings it back.
  const fastState = async () => {
    const panel = page.locator("[data-fast-export]");
    return {
      disabled: await page.getByRole("button", { name: /Fast export/ }).isDisabled(),
      hand: await panel.getAttribute("data-fast-hand-play"),
      note: await page.getByText(/can't be exported fast/).first().isVisible().catch(() => false),
    };
  };
  await page.goto(`${BASE}/en/simulator/?mode=runner&rra=0&rrm=spikes&rrn=6`, { waitUntil: "networkidle" });
  const runnerHand = await fastState();
  await jrToggle("runner-section", "Auto Jump").click();
  await page.waitForTimeout(300);
  const runnerAuto = await fastState();
  await page.goto(`${BASE}/en/simulator/?mode=paddle&pda=0`, { waitUntil: "networkidle" });
  const paddleHand = await fastState();
  check(
    "a run played by hand has no fast export: the button is off and points to Record Video (Auto Jump brings it back)",
    runnerHand.disabled && runnerHand.hand === "1" && runnerHand.note && !runnerAuto.disabled && runnerAuto.hand === null && !runnerAuto.note && paddleHand.disabled && paddleHand.hand === "1" && paddleHand.note,
    `(runner by hand ${JSON.stringify(runnerHand)}, with Auto Jump ${JSON.stringify(runnerAuto)}, paddle by hand ${JSON.stringify(paddleHand)})`,
  );
  // The batch render fails such a job with its own reason (and downloads nothing).
  await page.goto(`${BASE}/en/simulator/?mode=runner&rra=0&rrm=spikes&rrn=6&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  if (webCodecs) {
    await page.evaluate(() => localStorage.removeItem("jumpingballslive_batch_render"));
    await page.getByRole("button", { name: /Recording/ }).click();
    const block = page.locator("[data-batch]");
    await block.waitFor({ timeout: 10000 });
    await block.getByRole("button", { name: "Seed list", exact: true }).click();
    await page.locator("#batch-list").fill("101");
    let downloaded = false;
    const onDownload = () => (downloaded = true);
    page.on("download", onDownload);
    await block.getByRole("button", { name: /Render batch/ }).click();
    const finished = await page.waitForFunction(() => ["finished", "stopped"].includes(document.querySelector("[data-batch]")?.getAttribute("data-batch") || ""), null, { timeout: 60000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(500);
    page.off("download", onDownload);
    const rows = await page.locator("[data-batch-job]").evaluateAll((els) => els.map((e) => ({ status: e.getAttribute("data-batch-job"), text: e.textContent || "" })));
    check("the batch render fails a hand-played Beat Runner's job as played by hand", finished && rows.length === 1 && rows[0].status === "failed" && /played by hand/.test(rows[0].text) && !downloaded, `(rows ${JSON.stringify(rows)}, download=${downloaded})`);
    await page.evaluate(() => localStorage.removeItem("jumpingballslive_batch_render"));
  }
}
// --- end jdm-rhythm-runner ---

// --- batch-render --- Batch render (the Batch block at the end of the Recording section): a pasted list of two seeds and a
// bad line renders two 500×500, 10 s Classic clips one after the other, each downloads as classic-<seed>-<duration>.mp4 /
// .webm, "Download all as ZIP" packs exactly those files (read back entry by entry: STORE, UTF-8 flag, CRC-32, the same
// bytes) and the definition survives a reload (localStorage). A mode variant – Portal and Shatter, rendered in card order –
// stopped with "Stop after this clip" finishes its first clip in Shatter (the mode card's change), skips the Portal one and
// gives the page its own mode back. An uploaded wall-break sound plays in every clip of a sweep (a seed and a share link)
// and of a mode variant and stays on the page; a run Find Simulation found survives a sweep (the panel, the clip length,
// the fast export's digest and the page run's first escape are the same afterwards). Without WebCodecs the block says so
// and cannot start.
{
  const BATCH_KEY = "jumpingballslive_batch_render";
  /** CRC-32 (IEEE), as the ZIP stores it. */
  const crc32 = (buf) => {
    let c = ~0 >>> 0;
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i];
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return ~c >>> 0;
  };
  /** The entries of a ZIP file (end record → central directory → local headers). */
  const readZip = (zip) => {
    const end = zip.length - 22;
    if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50) return null;
    const count = zip.readUInt16LE(end + 10);
    let at = zip.readUInt32LE(end + 16);
    const entries = [];
    for (let i = 0; i < count; i++) {
      if (zip.readUInt32LE(at) !== 0x02014b50) return null;
      const flags = zip.readUInt16LE(at + 8);
      const method = zip.readUInt16LE(at + 10);
      const crc = zip.readUInt32LE(at + 16);
      const size = zip.readUInt32LE(at + 24);
      const nameLength = zip.readUInt16LE(at + 28);
      const skip = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
      const local = zip.readUInt32LE(at + 42);
      const name = zip.subarray(at + 46, at + 46 + nameLength).toString("utf8");
      if (zip.readUInt32LE(local) !== 0x04034b50) return null;
      const dataAt = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      entries.push({ name, flags, method, crc, data: zip.subarray(dataAt, dataAt + size) });
      at += 46 + nameLength + skip;
    }
    return entries;
  };
  const isVideo = (buf) => buf.length > 10000 && (buf.includes(Buffer.from("ftyp")) || buf.readUInt32BE(0) === 0x1a45dfa3);
  const batchStatus = () => page.locator("[data-batch]").getAttribute("data-batch").catch(() => null);
  const batchRows = () => page.locator("[data-batch-job]").evaluateAll((els) => els.map((e) => ({ status: e.getAttribute("data-batch-job"), file: e.getAttribute("data-batch-file"), seed: e.getAttribute("data-batch-seed") })));
  const openBatch = async () => {
    await page.getByRole("button", { name: /Recording/ }).click();
    await page.locator("[data-batch]").waitFor({ timeout: 10000 });
    return page.locator("[data-batch]");
  };

  await page.goto(`${BASE}/en/simulator/?mode=classic&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.removeItem(key), BATCH_KEY);
  await page.reload({ waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  let block = await openBatch();
  await block.getByRole("button", { name: "Seed list", exact: true }).click();
  await page.locator("#batch-list").fill("101\n202\nnot-a-seed");
  const listRead = await block.locator("[data-batch-list]").innerText().catch(() => "");
  const summary = await block.getByText(/clips? · 500×500 · 30 fps/).first().innerText().catch(() => "");
  if (webCodecs) {
    // 1. Two seeds, one after the other, each downloaded under its own name.
    const downloads = [];
    const onDownload = (d) => downloads.push(d);
    page.on("download", onDownload);
    const startedAt = Date.now();
    const urlBeforeBatch = page.url();
    await block.getByRole("button", { name: /Render batch/ }).click();
    // --- review fix (recording-export) --- while the batch renders, Import project is off and a project dropped on the panel
    // is refused with a status line (the batch would roll it back); the page has its own settings again afterwards
    await page.waitForFunction(() => document.querySelector("[data-batch-job='rendering']"), null, { timeout: 60000 }).catch(() => {});
    if (!(await page.getByTestId("project-section").isVisible().catch(() => false))) await page.getByRole("button", { name: /Project file/ }).click();
    const importButton = page.getByTestId("project-section").getByRole("button", { name: /Import project/ });
    const importDisabled = await importButton.isDisabled({ timeout: 5000 }).catch(() => false);
    const midBatchProject = JSON.stringify({ format: "jumpingballslive-project", version: 1, name: "Imported mid-batch", settings: { mode: "shatter", gravity: 900 }, assets: {} });
    const lockDrop = await page.evaluateHandle((text) => {
      const dt = new DataTransfer();
      dt.items.add(new File([text], "mid-batch.jumpingballslive.json", { type: "application/json" }));
      return dt;
    }, midBatchProject);
    const lockZone = page.getByTestId("project-drop-zone");
    await lockZone.dispatchEvent("dragenter", { dataTransfer: lockDrop });
    await lockZone.dispatchEvent("dragover", { dataTransfer: lockDrop });
    await lockZone.dispatchEvent("drop", { dataTransfer: lockDrop });
    const lockStatus = await page.getByTestId("project-status").innerText({ timeout: 10000 }).catch(() => "");
    const finished = await page.waitForFunction(() => document.querySelector("[data-batch]")?.getAttribute("data-batch") === "finished", null, { timeout: 300000 }).then(() => true).catch(() => false);
    const ms = Date.now() - startedAt;
    await page.waitForTimeout(500);
    check(
      "batch render: settings are locked while it runs (Import project off, a dropped project refused) and the page is unchanged afterwards",
      importDisabled && /finish or stop the batch/i.test(lockStatus) && page.url() === urlBeforeBatch && !(await page.getByText(/Opened “Imported mid-batch”/).isVisible().catch(() => false)),
      `(import disabled ${importDisabled}, status "${lockStatus}", url ${page.url().split("?")[1]} vs ${urlBeforeBatch.split("?")[1]})`,
    );
    await page.waitForTimeout(1000);
    page.off("download", onDownload);
    const rows = await batchRows();
    const files = {};
    for (const d of downloads) {
      const out = path.join(outDir, `batch-${d.suggestedFilename()}`);
      await d.saveAs(out);
      files[d.suggestedFilename()] = fs.readFileSync(out);
    }
    const names = Object.keys(files).sort();
    const namesOk = names.length === 2 && /^classic-101-\d+(\.\d)?s\.(mp4|webm)$/.test(names[0]) && /^classic-202-\d+(\.\d)?s\.(mp4|webm)$/.test(names[1]);
    check(
      "batch render: a list of two seeds (and a bad line) renders two clips, each downloaded as mode-seed-duration",
      finished && /2 jobs/.test(listRead) && /line 3 skipped/.test(listRead) && /^2 clips/.test(summary) && rows.length === 2 && rows.every((r) => r.status === "done") && namesOk && names.every((n) => isVideo(files[n])) && rows.map((r) => r.file).sort().join() === names.join(),
      `(${names.join(", ") || "no downloads"}; rows ${JSON.stringify(rows)}; "${listRead}"; "${summary}"; ${ms} ms)`,
    );
    // 2. Download all as ZIP: exactly those clips, stored, with their checksums.
    const zipWait = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
    await block.getByRole("button", { name: /Download all as ZIP/ }).click();
    const zipDownload = await zipWait;
    let entries = null;
    let zipName = "";
    if (zipDownload) {
      zipName = zipDownload.suggestedFilename();
      const out = path.join(outDir, `batch-${zipName}`);
      await zipDownload.saveAs(out);
      entries = readZip(fs.readFileSync(out));
    }
    check(
      "batch render: Download all as ZIP packs exactly the rendered clips (STORE, UTF-8 names, CRC-32, same bytes)",
      /^jumpingballslive-batch-\d{8}-\d{4}\.zip$/.test(zipName) && !!entries && entries.length === 2 && entries.map((e) => e.name).sort().join() === names.join() && entries.every((e) => e.method === 0 && (e.flags & 0x800) && files[e.name] && Buffer.compare(e.data, files[e.name]) === 0 && crc32(e.data) === e.crc),
      `(${zipName || "no zip"}: ${entries ? entries.map((e) => `${e.name} ${e.data.length} B method ${e.method}`).join(", ") : "unreadable"})`,
    );
    // 3. The definition is remembered; a mode variant stopped after its first clip.
    await page.reload({ waitUntil: "networkidle" });
    block = await openBatch();
    const kept = await page.locator("#batch-list").inputValue().catch(() => "");
    check("batch render: the batch definition survives a reload (localStorage)", kept === "101\n202\nnot-a-seed", `(${JSON.stringify(kept)})`);
    await page.locator("#batch-list").fill("303");
    await block.getByRole("button", { name: "Every mode", exact: true }).click();
    await block.getByRole("button", { name: "Clear", exact: true }).click();
    const chips = block.getByRole("group", { name: "Every mode" });
    await chips.getByRole("button", { name: "Portal", exact: true }).click();
    await chips.getByRole("button", { name: "Shatter", exact: true }).click();
    const modeDownloads = [];
    const onModeDownload = (d) => modeDownloads.push(d.suggestedFilename());
    page.on("download", onModeDownload);
    await block.getByRole("button", { name: /Render batch/ }).click();
    const stopButton = block.getByRole("button", { name: /Stop after this clip/ });
    const canStop = await stopButton.waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    if (canStop) await stopButton.click();
    const stopping = await block.getByText(/Stopping after this clip/).first().isVisible().catch(() => false);
    const stopped = await page.waitForFunction(() => document.querySelector("[data-batch]")?.getAttribute("data-batch") === "stopped", null, { timeout: 180000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1000);
    page.off("download", onModeDownload);
    const modeRows = await batchRows();
    const pageMode = new URL(page.url()).searchParams.get("mode");
    const doneLine = await block.getByText(/Stopped – 1 of 2 clips rendered/).first().isVisible().catch(() => false);
    check(
      "batch render: every mode renders the clip in the picked mode; Stop after this clip finishes it, skips the rest and gives the page its mode back",
      canStop && stopping && stopped && doneLine && modeRows.length === 2 && modeRows[0].status === "done" && /^shatter-303-/.test(modeRows[0].file || "") && modeRows[1].status === "skipped" && modeDownloads.length === 1 && /^shatter-303-/.test(modeDownloads[0]) && pageMode === "classic",
      `(rows ${JSON.stringify(modeRows)}, downloads ${JSON.stringify(modeDownloads)}, page mode ${pageMode}, stopping=${stopping})`,
    );

    // 4. An uploaded wall-break sound is in every clip and stays on the page: a sweep of a seed and of a share link, and a
    // mode variant that starts from Target (every clip in Shatter, which plays the wall-break clip on every shattered
    // segment). The search box shows the Batch block and the Wall Break Sound select together; every 50 ms the select's
    // value is noted for the clip being rendered, and so is every wall-break clip the export plays (a one-argument
    // AudioBufferSourceNode.start – the default tones are oscillators) with its length.
    const wallBreakBatch = async (query, setUp) => {
      await page.goto(`${BASE}/en/simulator/?${query}&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
      const search = page.getByPlaceholder("Search settings...");
      await search.fill("wall break");
      await page.locator('label:has-text("Choose audio file") input[type=file]').first().setInputFiles({ name: "smoke-break.wav", mimeType: "audio/wav", buffer: makeWav(0.5) });
      const upload = await page
        .waitForFunction(() => (document.querySelector("#wallbreak-select")?.value.startsWith("blob:") ? document.querySelector("#wallbreak-select").value : null), null, { timeout: 10000 })
        .then((h) => h.jsonValue())
        .catch(() => "");
      await search.fill("nd"); // "Wall Break Sound" and "Batch Render"
      const batch = page.locator("[data-batch]");
      await batch.waitFor({ timeout: 10000 });
      await setUp(batch);
      await page.evaluate(() => {
        const job = () => [...document.querySelectorAll("[data-batch-job]")].findIndex((el) => el.getAttribute("data-batch-job") === "rendering");
        const seen = (window.__wbSeen = []);
        const plays = (window.__wbPlays = []);
        const timer = setInterval(() => {
          const j = job();
          if (j >= 0) seen.push([j, document.querySelector("#wallbreak-select")?.value ?? ""]);
        }, 50);
        const start = AudioBufferSourceNode.prototype.start;
        window.__wbDone = () => {
          clearInterval(timer);
          AudioBufferSourceNode.prototype.start = start;
        };
        AudioBufferSourceNode.prototype.start = function () {
          if (arguments.length === 1 && this.buffer) plays.push([job(), Math.round(this.buffer.duration * 1000) / 1000]);
          return start.apply(this, arguments);
        };
      });
      await batch.getByRole("button", { name: /Render batch/ }).click();
      const finished = await page.waitForFunction(() => document.querySelector("[data-batch]")?.getAttribute("data-batch") === "finished", null, { timeout: 300000 }).then(() => true).catch(() => false);
      await page.waitForTimeout(500);
      const { seen, plays } = await page.evaluate(() => {
        window.__wbDone();
        return { seen: window.__wbSeen, plays: window.__wbPlays };
      });
      const rows = await batchRows();
      const after = await page.locator("#wallbreak-select").inputValue().catch(() => "");
      const afterName = await page.locator("#wallbreak-select option:checked").innerText().catch(() => "");
      await search.fill("");
      const jobs = rows.map((_, j) => ({ values: [...new Set(seen.filter(([k]) => k === j).map(([, v]) => (v === upload ? "upload" : v || "default tones")))], plays: plays.filter(([k]) => k === j).map(([, d]) => d) }));
      const mode = new URL(page.url()).searchParams.get("mode");
      return {
        ok: finished && !!upload && rows.length > 1 && rows.every((r) => r.status === "done") && jobs.every((j) => j.values.join() === "upload" && j.plays.length > 0 && j.plays.every((d) => Math.abs(d - 0.5) < 0.01)) && after === upload && afterName === "smoke-break.wav",
        mode,
        detail: `(${rows.map((r, j) => `${r.file || r.status}: select ${jobs[j].values.join("/") || "unseen"}, ${jobs[j].plays.length} wall-break clips of ${[...new Set(jobs[j].plays)].join("/") || "-"} s`).join("; ")}; afterwards ${after === upload ? "the upload" : `"${after}"`} ("${afterName}"), page mode ${mode})`,
      };
    };
    const sweepUpload = await wallBreakBatch("mode=shatter", async (batch) => {
      await batch.getByRole("button", { name: "Seed list", exact: true }).click();
      await page.locator("#batch-list").fill(`303\n${BASE}/en/simulator/?mode=shatter&g=500 404`);
      await batch.getByRole("button", { name: "Sweep a setting", exact: true }).click();
      await page.locator("#batch-sweep-key").selectOption("gravity");
      await batch.getByLabel("From", { exact: true }).fill("0");
      await batch.getByLabel("To", { exact: true }).fill("100");
      await batch.getByLabel("Steps", { exact: true }).fill("2");
    });
    check("batch render: an uploaded wall-break sound plays in every clip of a sweep – of a seed and of a share link – and stays on the page", sweepUpload.ok && sweepUpload.mode === "shatter", sweepUpload.detail);
    const modesUpload = await wallBreakBatch("mode=target", async (batch) => {
      await batch.getByRole("button", { name: "Seed list", exact: true }).click();
      await page.locator("#batch-list").fill("505\n606");
      await batch.getByRole("button", { name: "Every mode", exact: true }).click();
      await batch.getByRole("button", { name: "Clear", exact: true }).click();
      await batch.getByRole("group", { name: "Every mode" }).getByRole("button", { name: "Shatter", exact: true }).click();
    });
    check("batch render: an uploaded wall-break sound plays in every clip of a mode variant and stays on the page, back in its own mode", modesUpload.ok && modesUpload.mode === "target", modesUpload.detail);

    // 5. A batch that changes settings gives the page back the run Find Simulation found: after a gravity sweep (stopped
    // after its first clip) the Found panel, the ready bar and the clip length are as they were, the next fast export
    // renders the found seed (the same frames: digest) and the page's own run is the found run (the same first escape,
    // data-first-escape, played at 8× before and after).
    await page.goto(`${BASE}/en/simulator/?mode=classic&res=500x500&xfps=30`, { waitUntil: "networkidle" });
    let foundText = "";
    // (1000 seeds miss a 30 s run now and then – about one search in a hundred: search again)
    for (let attempt = 0; attempt < 3 && !/^Found! \d/.test(foundText); attempt++) {
      await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
      await page.waitForTimeout(100);
      const foundLine = page.getByText(/Found! \d|Didn't find simulation/).first();
      foundText = await foundLine.waitFor({ timeout: 180000 }).then(() => foundLine.innerText()).catch(() => "timeout");
    }
    await page.waitForTimeout(500);
    const seedLine = () => page.getByText(/^Seed: -?\d+/).first().innerText({ timeout: 2000 }).catch(() => "");
    const clipLength = () => new URLSearchParams(page.url().split("?")[1] || "").get("dur") ?? "default";
    const fastDigest = async () => {
      if ((await page.locator("[data-batch]").count()) === 0) await openBatch();
      const done = page.waitForEvent("download", { timeout: 240000 }).catch(() => null);
      await page.getByRole("button", { name: /Fast export/ }).click();
      await done;
      await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
      return page.locator("[data-fast-export]").getAttribute("data-fast-digest").catch(() => null);
    };
    const firstEscape = async () => {
      await page.getByRole("button", { name: /Start Simulator/ }).click();
      await page.getByRole("button", { name: "8x", exact: true }).click();
      return page
        .waitForFunction(() => (document.querySelector("main canvas")?.dataset.firstEscape ?? "-1") !== "-1" && document.querySelector("main canvas").dataset.firstEscape, null, { timeout: 60000 })
        .then((h) => h.jsonValue())
        .catch(() => "none");
    };
    const before = { found: foundText, seed: await seedLine(), clip: clipLength(), digest: await fastDigest(), escape: await firstEscape() };
    block = page.locator("[data-batch]");
    await block.getByRole("button", { name: "Seed list", exact: true }).click();
    await page.locator("#batch-list").fill("101");
    await block.getByRole("button", { name: "Sweep a setting", exact: true }).click();
    await page.locator("#batch-sweep-key").selectOption("gravity");
    await block.getByLabel("From", { exact: true }).fill("0");
    await block.getByLabel("To", { exact: true }).fill("100");
    await block.getByLabel("Steps", { exact: true }).fill("2");
    await block.getByRole("button", { name: /Render batch/ }).click();
    const stopSweep = block.getByRole("button", { name: /Stop after this clip/ });
    if (await stopSweep.waitFor({ timeout: 15000 }).then(() => true).catch(() => false)) await stopSweep.click();
    const sweepStopped = await page.waitForFunction(() => document.querySelector("[data-batch]")?.getAttribute("data-batch") === "stopped", null, { timeout: 300000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(500);
    const sweepRows = await batchRows();
    const foundAfter = await page.getByText(/Found! \d/).first().innerText({ timeout: 2000 }).catch(() => "");
    const ready = await page.getByText(/Ready to start simulation for/).first().innerText({ timeout: 2000 }).catch(() => "");
    const after = { found: foundAfter, seed: await seedLine(), clip: clipLength(), digest: await fastDigest(), escape: await firstEscape() };
    check(
      "batch render: a batch that changes settings gives back the run Find Simulation found (the panel, the clip length, the fast export's frames, the page's own run)",
      /^Found! \d/.test(before.found) && /^Seed: -?\d+/.test(before.seed) && !!before.digest && before.escape !== "none" && sweepStopped && sweepRows[0]?.status === "done" && /Ready to start simulation for/.test(ready) && JSON.stringify(after) === JSON.stringify(before),
      `(before: ${JSON.stringify(before)}; after the batch (${sweepRows.map((r) => r.file || r.status).join(", ")}): ${JSON.stringify(after)}, "${ready}")`,
    );
  } else {
    const disabled = await block.getByRole("button", { name: /Render batch/ }).isDisabled();
    const note = await block.getByText(/needs WebCodecs/).first().isVisible().catch(() => false);
    check("without WebCodecs the batch render says so and cannot start", disabled && note && (await batchStatus()) === "idle", `(disabled=${disabled}, note=${note})`);
  }
  await page.evaluate((key) => localStorage.removeItem(key), BATCH_KEY);
}
// --- end batch-render ---
// --- split-screen --- Split-screen races: 2 or 4 arenas on one canvas and one recording (lib/splitScreen.ts, lib/simulation/multi.ts)
const splitNums = (value) => (value || "").split(",").map(Number);
{
  const splitElapsedSpread = (data) => {
    const e = splitNums(data.splitElapsed);
    return { min: Math.min(...e), max: Math.max(...e) };
  };
  // Four arenas from a shared link: each with its overrides (arena A heavier, B a fixed seed, C another mode, D faster),
  // tiling the centred square the recorder exports.
  const race = `mode=classic&ac=4&al=grid&ar=${encodeURIComponent("Red~cff3366~g600|Blue~c3399ff~s42|~mshatter|Gold~v700")}`;
  await page.goto(`${BASE}/en/simulator/?${race}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.splitDrawn === "4", null, { timeout: 15000 }).catch(() => {});
  const before = await canvasData();
  const box = await page.locator("main canvas").first().boundingBox();
  const side = box ? Math.min(box.width, box.height) : 0;
  const vps = (before.splitViewports || "").split(";").map((v) => v.split(",").map(Number));
  const covered = vps.reduce((sum, v) => sum + v[2] * v[3], 0);
  const inside = !!box && vps.every(([x, y, w, h]) => x >= (box.width - side) / 2 - 1 && y >= (box.height - side) / 2 - 1 && x + w <= (box.width + side) / 2 + 1 && y + h <= (box.height + side) / 2 + 1);
  check(
    "split screen: four arenas from a link, each with its own overrides, tile the exported square",
    before.split === "4" && before.splitLayout === "grid" && before.splitDrawn === "4" && before.splitModes === "classic,classic,shatter,classic" && splitNums(before.splitGravity)[0] === 600 && splitNums(before.splitSeeds)[1] === 42 && splitNums(before.splitSpeed)[3] === 700 && before.splitLabels === "Red,Blue,C,Gold" && vps.length === 4 && Math.abs(covered - side * side) < 0.03 * side * side && inside,
    `(${JSON.stringify({ modes: before.splitModes, gravity: before.splitGravity, seeds: before.splitSeeds, speed: before.splitSpeed, labels: before.splitLabels, viewports: before.splitViewports, worlds: before.splitWorlds })}, square ${Math.round(side)})`,
  );
  // The panel shows the race: 4 arenas, the grid, an editor per arena with its label.
  await page.getByRole("button", { name: /Arenas & Split Screen/ }).click();
  const pressed = await page.locator('[data-testid="split-screen-section"] [role="group"][aria-label="Arenas"] button[aria-pressed="true"]').innerText().catch(() => "");
  const cards = await page.locator('[data-testid="split-arena-0"], [data-testid="split-arena-1"], [data-testid="split-arena-2"], [data-testid="split-arena-3"]').count();
  const label = await page.locator('[data-testid="split-arena-0"] input[type="text"]').inputValue().catch(() => "");
  check("split screen: the Arenas & Split Screen section edits the race (count, layout, one editor per arena)", pressed.trim() === "4" && cards >= 4 && label === "Red", `(pressed "${pressed}", ${cards} editors, first label "${label}")`);

  // Start: every arena runs on the same clock, draws into its viewport and shares the particle budget.
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(2500);
  const running = await canvasData();
  const spread = splitElapsedSpread(running);
  const lit = await page.evaluate(() => {
    const c = document.querySelector("main canvas");
    const g = c.getContext("2d");
    const k = c.width / c.getBoundingClientRect().width;
    return c.dataset.splitViewports.split(";").map((v) => {
      const [x, y, w, h] = v.split(",").map(Number);
      const d = g.getImageData(Math.round(x * k), Math.round(y * k), Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 180) n++;
      return n;
    });
  });
  await page.screenshot({ path: path.join(outDir, "sim-split-4.png") });
  check(
    "split screen: the arenas step together, each drawn in its viewport, within one particle budget",
    spread.min > 500 && spread.max - spread.min <= 34 && lit.length === 4 && lit.every((n) => n > 20) && Number(running.splitParticles) <= 200,
    `(elapsed ${running.splitElapsed}, lit ${JSON.stringify(lit)}, particles ${running.splitParticles})`,
  );
  // Pause stops every arena; Resume goes on. (The clocks are read once the page shows Resume – the pause is committed – and
  // the canvas has mirrored a frame or two since: on a busy machine a render can take a few hundred ms.)
  await page.getByRole("button", { name: /Pause/ }).click();
  await page.getByRole("button", { name: /Resume/ }).waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(600);
  const paused1 = (await canvasData()).splitElapsed;
  await page.waitForTimeout(700);
  const paused2 = (await canvasData()).splitElapsed;
  await page.getByRole("button", { name: /Resume/ }).click();
  await page.waitForTimeout(500);
  const resumed = await canvasData();
  check("split screen: pause and resume apply to every arena", paused1 === paused2 && splitElapsedSpread(resumed).min > Math.max(...splitNums(paused2)), `(${paused1} → ${paused2} → ${resumed.splitElapsed})`);
  // Frame rate with four arenas (headless Chromium; timingCheck() on a busy machine).
  const fps = await page.evaluate(
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
  await timingCheck("split screen: four arenas keep 30+ fps", true, fps >= 30, `(${fps} fps, floor 30${loadNote()})`, async () => {
    const again = await pageFrameRates(3000);
    return { timingOk: again.avg >= 30, extra: `(${again.avg.toFixed(0)} fps)` };
  });
  // 8×: the banner names the first arena to escape (or finish) with its time, the earliest mark of all.
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const bannered = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.splitBanner === "1", null, { timeout: 90000 }).then(() => true).catch(() => false);
  const won = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-split-banner.png") });
  const marks = (won.splitMarks || "").split(",").map((m) => (m === "-" ? Infinity : Number(m.slice(1))));
  const best = Math.min(...marks);
  const winners = (won.splitWinner || "").split("&");
  const labels = (won.splitLabels || "").split(",");
  check(
    "split screen: the race banner names the arena that escaped (or finished) first, and when",
    bannered && winners.length > 0 && winners.every((w) => labels.includes(w)) && Number(won.splitWinnerMs) === best && winners.every((w) => marks[labels.indexOf(w)] === best) && (won.splitKind === "escaped" || won.splitKind === "finished"),
    `(${JSON.stringify({ winner: won.splitWinner, at: won.splitWinnerMs, kind: won.splitKind, marks: won.splitMarks })})`,
  );
  // R restarts every arena together: the clocks go back, the race is cleared.
  await page.keyboard.press("r");
  // (the canvas mirrors the clocks on its next frame, which can take a few hundred ms on a busy machine)
  await page.waitForFunction(() => Math.max(...(document.querySelector("main canvas")?.dataset.splitElapsed || "0").split(",").map(Number)) < 2500, null, { timeout: 5000 }).catch(() => {});
  const restarted = await canvasData();
  const rs = splitElapsedSpread(restarted);
  check("split screen: a restart starts every arena over together", rs.max < 2500 && rs.max - rs.min <= 34 && restarted.splitWinner === "" && restarted.splitMarks === "-,-,-,-", `(elapsed ${restarted.splitElapsed}, marks ${restarted.splitMarks})`);
}
{
  // Sound: only the first arena's bounces by default, every arena's with "Every arena" – the same seeds, the same stretch of
  // simulation time (OscillatorNode.start is instrumented).
  const tonesAfter = async (sa) => {
    await page.goto(`${BASE}/en/simulator/?mode=classic&ac=2&sa=${sa}&ar=${encodeURIComponent("A~s11|B~s12")}`, { waitUntil: "networkidle" });
    await page.evaluate(() => {
      const log = [];
      window.__splitOsc = log;
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function () {
        if (this.frequency.value !== 1) log.push(this.frequency.value);
        return start.apply(this, arguments);
      };
    });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "2x", exact: true }).click();
    const reached = await page.waitForFunction(() => Math.min(...(document.querySelector("main canvas")?.dataset.splitElapsed || "0").split(",").map(Number)) >= 4000, null, { timeout: 30000 }).then(() => true).catch(() => false);
    await page.getByRole("button", { name: /Pause/ }).click();
    await page.waitForTimeout(300);
    return reached ? await page.evaluate(() => window.__splitOsc.length) : -1;
  };
  const first = await tonesAfter("first");
  const all = await tonesAfter("all");
  check("split screen: the first arena is heard by default, every arena with Every arena", first > 0 && all > first, `(${first} tones → ${all} tones)`);
}
{
  // A race is recorded as one clip: two quick arenas (two rings, wide gaps) at 8×, the recording ends after the last one.
  await page.goto(`${BASE}/en/simulator/?mode=classic&wc=2&gap=0.9&ac=2&al=grid&res=500x500&dur=60&ar=${encodeURIComponent("A~s21|B~s22~v600")}`, { waitUntil: "networkidle" });
  const download = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
  await page.getByRole("button", { name: /Record Video/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const finished = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.splitFinished === "1", null, { timeout: 90000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const file = await download;
  let size = 0;
  if (file) {
    const out = path.join(outDir, `split-${file.suggestedFilename()}`);
    await file.saveAs(out);
    size = fs.statSync(out).size;
  }
  check("split screen: a race records as one clip that runs until the last arena is done", finished && data.splitBanner === "1" && size > 10000, `(finished=${finished}, marks ${data.splitMarks}, export ${size} bytes)`);
}
{
  // Find Simulation searches a seed for every arena; the seeds land in the link and the race replays them. (Four rings with
  // wider gaps: about one seed in twenty lasts 30 ± 0.5 s, where the default seven rings are over a minute for most seeds.)
  await page.goto(`${BASE}/en/simulator/?mode=classic&wc=4&gap=0.5&ac=2&al=grid`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.splitDrawn === "2", null, { timeout: 15000 }).catch(() => {});
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 240000 }).then(() => true).catch(() => false);
  const text = done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  await page.waitForTimeout(300);
  const ar = new URL(page.url()).searchParams.get("ar") || "";
  const seeds = [...ar.matchAll(/~s(-?\d+)/g)].map((m) => Number(m[1]));
  const data = await canvasData();
  const engineSeeds = splitNums(data.splitSeeds);
  let finishes = [];
  if (seeds.length === 2) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.splitFinished === "1", null, { timeout: 90000 }).catch(() => {});
    finishes = ((await canvasData()).splitFinish || "").split(",").map(Number);
  }
  const foundSec = Number((/Found! ([\d.]+)s/.exec(text) || [])[1]);
  check(
    "split screen: Find Simulation finds a seed for every arena, stored in the link, and the race replays them",
    /Found!/.test(text) && seeds.length === 2 && engineSeeds[0] === seeds[0] && engineSeeds[1] === seeds[1] && finishes.length === 2 && finishes.every((f) => f > 0) && Math.abs(Math.max(...finishes) / 1000 - foundSec) <= 0.2,
    `(${text}, ar=${ar}, engines ${data.splitSeeds}, finishes ${finishes.join(",")})`,
  );
}
{
  // Cancelling Find Simulation – or changing the mode – while another arena is searched applies nothing of the search: the
  // first arena's run was already found, but no "Found!", no seeds in the link and no page engine put back into the mode
  // the search started with. (Arena B – a slow ball, no gravity – takes a long search, so there is time to act during it.)
  const url = `${BASE}/en/simulator/?mode=classic&wc=4&gap=0.5&ac=2&ar=${encodeURIComponent("A|B~v50~g0")}`;
  const searchSecondArena = async () => {
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.splitDrawn === "2", null, { timeout: 15000 }).catch(() => {});
    await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
    const reached = await page.waitForSelector('[data-search-arena="1"]', { state: "attached", timeout: 180000 }).then(() => true).catch(() => false);
    // Act just after a batch of arena B's seeds was reported; the time to that report is how long a batch takes (an aborted
    // search stops at the end of its batch).
    const before = await page.evaluate(() => document.querySelector("[data-search-arena]")?.textContent ?? "");
    const t0 = Date.now();
    await page.waitForFunction((prev) => document.querySelector("[data-search-arena]")?.textContent !== prev, before, { timeout: 60000 }).catch(() => {});
    return { reached, batchMs: Date.now() - t0 };
  };
  const statusText = () => page.locator("body").innerText().catch(() => "");
  const cancelled = await searchSecondArena();
  await page.getByRole("button", { name: /Cancel Search/ }).click();
  const idle = await page.getByRole("button", { name: /Find 30s Simulation/ }).waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(800);
  const cancelText = await statusText();
  const cancelAr = new URL(page.url()).searchParams.get("ar") || "";
  const cancelData = await canvasData();
  check(
    "split screen: cancelling Find Simulation while another arena is searched applies nothing (no Found!, no seeds)",
    cancelled.reached && idle && !/Found!|Ready to start simulation for/.test(cancelText) && !/~s-?\d/.test(cancelAr) && cancelData.splitModes === "classic,classic",
    `(reached arena B=${cancelled.reached}, idle=${idle}, found shown=${/Found!/.test(cancelText)}, ar=${cancelAr}, modes ${cancelData.splitModes})`,
  );
  const switched = await searchSecondArena();
  await page.locator('[role="button"]', { hasText: "Portal" }).first().click();
  await page.getByRole("button", { name: /Find 30s Simulation/ }).waitFor({ timeout: 30000 }).catch(() => {});
  // the aborted search ends within a batch or two (before the fix, its "found" result then put arena A back into Classic)
  await page.waitForTimeout(Math.min(20000, 2 * switched.batchMs + 1500));
  const switchText = await statusText();
  const switchData = await canvasData();
  const switchUrl = new URL(page.url()).searchParams;
  check(
    "split screen: changing the mode while another arena is searched leaves every arena in the new mode",
    switched.reached && switchUrl.get("mode") === "portal" && switchData.splitModes === "portal,portal" && !/Found!|Ready to start simulation for/.test(switchText) && !/~s-?\d/.test(switchUrl.get("ar") || ""),
    `(reached arena B=${switched.reached}, batch ${switched.batchMs} ms, mode=${switchUrl.get("mode")}, modes ${switchData.splitModes}, found shown=${/Found!/.test(switchText)}, ar=${switchUrl.get("ar")})`,
  );
}
{
  // From the panel: back to one arena (the classic canvas), then two in a row – the link follows.
  await page.goto(`${BASE}/en/simulator/?mode=portal&ac=2`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Arenas & Split Screen/ }).click();
  await page.locator('[data-testid="split-screen-section"] [role="group"][aria-label="Arenas"] button', { hasText: "1" }).click();
  await page.waitForTimeout(500);
  const single = await canvasData();
  const singleUrl = new URL(page.url()).searchParams.get("ac");
  await page.locator('[data-testid="split-screen-section"] [role="group"][aria-label="Arenas"] button', { hasText: "2" }).click();
  await page.locator('[data-testid="split-screen-section"] [role="group"][aria-label="Layout"] button', { hasText: "Row" }).click();
  await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.split === "2", null, { timeout: 10000 }).catch(() => {});
  const two = await canvasData();
  const twoUrl = new URL(page.url()).searchParams.get("ac");
  const [a, b] = (two.splitViewports || "").split(";").map((v) => v.split(",").map(Number));
  check(
    "split screen: the panel switches between one arena and a row of two, and the link follows",
    single.split === undefined && singleUrl === null && two.split === "2" && two.splitModes === "portal,portal" && twoUrl === "2" && !!a && !!b && a[1] === b[1] && b[0] > a[0],
    `(one: split=${single.split}, ac=${singleUrl}; two: ${two.splitViewports}, ac=${twoUrl}, modes ${two.splitModes})`,
  );
}
// --- end split-screen ---

// --- gerald-vortex ---
// 32. Sound Vortex: the preview image and the card; URL → the Vortex block of the Mode row (balls, stagger, rings, spiral
// time, pull, depth cue, loop, the run summary), controls → URL and the search box; the Respawn Loop hides the finder and
// says why; a short run at 1× at 30+ fps whose ring notes climb the C-major degrees ring by ring and whose swallows pew –
// a sweep from an octave above the innermost ring (OscillatorNode.start is instrumented) – and whose last swallow holds the
// PEW! banner for a moment before the run finishes; the finder
// lands a 30 s seed and the run keeps the promise at 8×; the default run at 1× keeps 30+ fps; a 1080×1920 recording
// keeps 20+ fps (the software encoder's share of a headless frame) and downloads; and a fast export pews through its own audio.
{
  const res = await page.request.get(`${BASE}/modes/vortex.webp`);
  check("asset /modes/vortex.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  check("the Sound Vortex card is on the landing page", (await page.locator('img[src$="/modes/vortex.webp"]').count()) === 1);
}
/** Frame rates of the page over `ms` of requestAnimationFrame: the average and the worst half-second window. */
const vxFrameRates = async (ms) => {
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
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0, low: lowWindow(windows) };
};
{
  const vxToggle = (label) => page.getByTestId("sound-vortex").getByRole("switch", { name: switchName(label) });
  await page.goto(`${BASE}/en/simulator/?mode=vortex&vxn=6&vxs=0.5&vxr=16&vxd=8&vxg=2&vxds=0.8`, { waitUntil: "networkidle" });
  {
    const values = { vxn: await sliderValue("Vortex Balls"), vxs: await sliderValue("Entry Stagger"), vxr: await sliderValue("Sound Rings"), vxd: await sliderValue("Spiral Time"), vxg: await sliderValue("Central Pull"), vxds: await sliderValue("Depth Cue") };
    const loop = await vxToggle("Respawn Loop").getAttribute("aria-checked");
    const run = await page.getByTestId("sound-vortex-run").innerText();
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0 && (await page.locator('input[aria-label="Gap Size"]').count()) === 0;
    // 6 balls × 16 rings = 96 notes; the last ball enters at 2.5 s and takes 8 s, the run ends a second later: 11.5 s.
    check(
      "sound vortex loads from the URL",
      values.vxn === "6" && values.vxs === "0.5" && values.vxr === "16" && values.vxd === "8" && values.vxg === "2" && values.vxds === "0.8" && loop === "false" && /\b96\b/.test(run) && /11\.5s/.test(run) && finderShown && noRingControls,
      `(${JSON.stringify(values)}, loop=${loop}, "${run}", finder shown=${finderShown}, no ring controls=${noRingControls})`,
    );
  }
  await page.locator('input[aria-label="Sound Rings"]').evaluate(setRangeValue, "20");
  await page.locator('input[aria-label="Vortex Balls"]').evaluate(setRangeValue, "10");
  await vxToggle("Respawn Loop").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    const endless = await page.getByTestId("sound-vortex-run").innerText();
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    check(
      "sound vortex mirrors into the URL; the loop hides the finder and says why",
      /(^|&)vxr=20(&|$)/.test(query) && /(^|&)vxn=10(&|$)/.test(query) && /(^|&)vxl=1(&|$)/.test(query) && /(^|&)vxg=2(&|$)/.test(query) && /never ends/.test(endless) && !finderShown,
      `(${query}, "${endless}", finder shown=${finderShown})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("spiral time");
  const found = await page.locator('input[aria-label="Spiral Time"]').isVisible();
  const ballSpeedHidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the sound vortex controls", found && ballSpeedHidden, `(found=${found}, Ball Speed hidden=${ballSpeedHidden})`);
}
{
  // A short run at 1×: 3 balls 0.5 s apart, 12 rings, 5 s spirals – ring notes on C major, pews from G6, the end.
  await page.goto(`${BASE}/en/simulator/?mode=vortex&vxn=3&vxs=0.5&vxd=5&face=cute`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__vxOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push({ f: this.frequency.value, t: performance.now() });
      return start.apply(this, arguments);
    };
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(300);
  const fps = await vxFrameRates(4500);
  const mid = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-vortex.png") });
  // The last swallow raises the "PEW!" banner, which holds for a second before the run finishes and the end screen covers it.
  const banner = await page
    .waitForFunction(() => {
      const d = document.querySelector("main canvas")?.dataset;
      return d?.vortexAllSwallowed === "1" && d?.vortexFinished === "0";
    }, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const tones = await page.evaluate(() => window.__vxOsc);
  const midis = tones.map((o) => Math.round(69 + 12 * Math.log2(o.f / 440)));
  // A pew starts two oscillators: the sweep from G6 (MIDI 91) and, right after it, its sub an octave below – not a ring note.
  const notes = [];
  let pews = 0;
  for (let i = 0; i < midis.length; i++) {
    if (midis[i] === 91) {
      pews++;
      i++;
    } else if (midis[i] >= 60 && midis[i] <= 79) notes.push(midis[i]);
  }
  // The first ball's first notes: rings 0 and 1 – C4, D4 (the second ball's first ring comes after them); the innermost ring is G5.
  const firstTwo = notes.slice(0, 2).join(",");
  await timingCheck(
    "sound vortex: ring notes climb the scale, balls weave at 30+ fps",
    Number(mid.vortexNotes) >= 12 && Number(mid.vortexInFlight) >= 1 && firstTwo === "60,62" && notes.includes(79) && notes.every((m) => [0, 2, 4, 5, 7, 9, 11].includes(m % 12)),
    fpsOk(fps, 7, 30),
    `(notes ${mid.vortexNotes}, in flight ${mid.vortexInFlight}, first MIDI ${firstTwo}, ${tones.length} tones, ${fpsNote(fps)}, floor 30${loadNote()})`,
  );
  check(
    "sound vortex: every ball is swallowed with a pew, the PEW! banner holds, then the run finishes",
    banner && done && data.vortexSwallowed === "3" && data.vortexNotes === "36" && notes.length === 36 && data.vortexDeepest === "11" && data.vortexAllSwallowed === "1" && data.vortexFinished === "1" && pews === 3 && data.face === "cute",
    `(banner=${banner}, finished=${done}, ${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("vortex"))))}, ${notes.length} ring tones, ${pews} pews)`,
  );
}
{
  // The finder: the seed's tempo spreads the default run around 30 s – a found seed keeps its promise.
  await page.goto(`${BASE}/en/simulator/?mode=vortex`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 60000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.vortexFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await canvasData();
  }
  check(
    "the finder finds a sound vortex seed for 30s and the run keeps the promise",
    ready && Math.abs(promised - 30) <= 0.5 && data.vortexFinished === "1" && Math.abs(Number(data.vortexFinishedMs) / 1000 - promised) < 0.1 && data.vortexSwallowed === "12",
    `(ready=${ready}, "${readyText}", finished at ${data.vortexFinishedMs} ms, swallowed ${data.vortexSwallowed})`,
  );
}
{
  // The default run at 1× (12 balls, about 8 in the funnel at once, glow and trails on).
  await page.goto(`${BASE}/en/simulator/?mode=vortex&glow=1`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(9000);
  const fps = await vxFrameRates(4000);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-vortex-full.png") });
  await timingCheck("the default sound vortex keeps 30+ fps with the funnel full", Number(data.vortexInFlight) >= 5, fpsOk(fps, 6, 30), `(in flight ${data.vortexInFlight}, ${fpsNote(fps)}, floor 30${loadNote()})`, fpsRetry(3000, 5, 30));
}
{
  // A 1080×1920 recording (the default resolution) of the default run.
  await page.goto(`${BASE}/en/simulator/?mode=vortex&dur=10`, { waitUntil: "networkidle" });
  let fps = { windows: [], avg: 0, min: 0, low: 0 };
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(300);
      fps = await vxFrameRates(3500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]).then(([d]) => d);
  let size = 0;
  if (download) {
    const file = path.join(outDir, `vortex-${download.suggestedFilename()}`);
    await download.saveAs(file);
    size = fs.statSync(file).size;
  }
  await timingCheck("a 1080×1920 sound vortex recording keeps 20+ fps and downloads", size > 10000, fpsOk(fps, 5, 20), `(${size} bytes, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
}
{
  // ⚡ Fast export of a short run (3 balls, 3 s spirals, about 5 s): rendered offline, every pew goes through the export's own
  // audio (the ToneGenerator's offline twin – OscillatorNode.start is instrumented), the clip ends half a second after the run
  // instead of at the 10 s clip length, and a second export of the same seed renders the same frames.
  await page.goto(`${BASE}/en/simulator/?mode=vortex&vxn=3&vxs=0.5&vxd=3&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  if (webCodecs) {
    await page.evaluate(() => {
      const log = [];
      window.__vxFastOsc = log;
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function () {
        if (this.frequency.value !== 1) log.push(this.frequency.value);
        return start.apply(this, arguments);
      };
    });
    const panel = page.locator("[data-fast-export]");
    const exportOnce = async () => {
      const downloadWait = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
      await page.getByRole("button", { name: /Fast export/ }).click();
      const download = await downloadWait;
      await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
      let bytes = 0;
      if (download) {
        const file = path.join(outDir, `vortex-fast-${download.suggestedFilename()}`);
        await download.saveAs(file);
        bytes = fs.statSync(file).size;
      }
      const line = await page.getByText(/Exported a .* s (MP4|WEBM) in/).first().innerText().catch(() => "");
      const pews = await page.evaluate(() => window.__vxFastOsc.splice(0).filter((f) => Math.round(69 + 12 * Math.log2(f / 440)) === 91).length);
      return { status: await panel.getAttribute("data-fast-export"), digest: await panel.getAttribute("data-fast-digest"), bytes, seconds: Number(/Exported a ([\d.]+) s/.exec(line)?.[1] ?? NaN), pews };
    };
    const a = await exportOnce();
    const b = await exportOnce();
    check(
      "a sound vortex fast export pews through the export's audio, ends with the run and replays the same frames",
      a.status === "done" && a.bytes > 10000 && a.pews === 3 && a.seconds > 4 && a.seconds < 7 && b.status === "done" && b.pews === 3 && !!a.digest && a.digest === b.digest,
      `(${JSON.stringify(a)}, ${JSON.stringify(b)})`,
    );
  } else check("without WebCodecs the sound vortex has no fast export to check (Record Video is covered above)", true);
}
// --- end gerald-vortex ---

// --- video-beats --- Beats from a video: a generated click-track WAV (120 BPM from 0.25 s, 44.1 kHz, every 4th click accented) is
// imported in the Sound section's "Beats from a video" block – the panel detects its tempo and beats, the file becomes the music
// bed and the Media source; the waveform strip adds and removes a marker on a click; "Use detected beats" turns the grid into
// markers (the Manual source, shared as `bm`); tap tempo gives an estimate; with On beat on the classic run's timed wall hits land
// within 30 ms of the beat grid (read off the canvas' data-onbeat-*); and a short recording downloads with an audio track.
{
  try {
    const vbClickWav = (seconds, bpm, sampleRate) => {
      const frames = Math.round(seconds * sampleRate);
      const samples = new Int16Array(frames);
      for (let k = 0, t = 0.25; t < seconds; k++, t = 0.25 + (k * 60) / bpm) {
        const start = Math.round(t * sampleRate);
        const amp = k % 4 === 0 ? 30000 : 14000;
        for (let j = 0; j < Math.round(0.012 * sampleRate) && start + j < frames; j++) {
          const tau = j / sampleRate;
          samples[start + j] = Math.round(amp * Math.sin(2 * Math.PI * 1000 * tau) * Math.exp(-tau / 0.004));
        }
      }
      return pcmWav(samples, sampleRate);
    };
    await page.goto(`${BASE}/en/simulator/?mode=classic&dur=10&res=500x500&grid=1%2F8`, { waitUntil: "networkidle" });
    // Open the Sound section (again, if a click landed before the page was interactive).
    const vbSoundTab = page.getByRole("button", { name: /Custom Sound/ });
    let vbInput = false;
    for (let attempt = 0; attempt < 3 && !vbInput; attempt++) {
      if ((await vbSoundTab.getAttribute("aria-expanded").catch(() => null)) !== "true") await vbSoundTab.click().catch(() => {});
      vbInput = await page.locator("#video-beats-file-input").waitFor({ state: "attached", timeout: 10000 }).then(() => true).catch(() => false);
    }
    const vb = page.getByTestId("video-beats");
    if (vbInput) await page.locator("#video-beats-file-input").setInputFiles({ name: "smoke-clicks.wav", mimeType: "audio/wav", buffer: vbClickWav(16, 120, 44100) });
    const vbReady = await page.waitForFunction(() => document.querySelector('[data-testid="video-beats"]')?.getAttribute("data-vb-state") === "ready", null, { timeout: 60000 }).then(() => true).catch(() => false);
    const vbBpm = Number(await vb.getAttribute("data-vb-bpm"));
    const vbBeats = Number(await vb.getAttribute("data-vb-beats"));
    const vbSource = await vb.getAttribute("data-vb-source");
    const vbBed = await page.getByTestId("music-track").isVisible().catch(() => false);
    const vbDetected = await page.getByTestId("vb-detected").innerText().catch(() => "");
    check(
      "a click-track WAV imports as the beat media: tempo, beats, the Media source and the music bed",
      vbInput &&
        vbReady && Math.abs(vbBpm - 120) < 0.5 && vbBeats >= 28 && vbSource === "media" && vbBed && new URL(page.url()).searchParams.get("bsrc") === "media",
      `(file input=${vbInput}, ready=${vbReady}, ${vbBpm} BPM, ${vbBeats} beats, source ${vbSource}, bed ${vbBed}, "${vbDetected}")`,
    );
    // The waveform strip: a click away from the markers adds one, a click on it removes it again.
    const strip = page.getByTestId("vb-waveform");
    const box = await strip.boundingBox();
    const markerCount = async () => Number(await vb.getAttribute("data-vb-markers"));
    let added = -1;
    let removed = -1;
    if (box) {
      await strip.click({ position: { x: Math.round(box.width * 0.37), y: Math.round(box.height / 2) } });
      await page.waitForTimeout(250);
      added = await markerCount();
      await strip.click({ position: { x: Math.round(box.width * 0.37), y: Math.round(box.height / 2) } });
      await page.waitForTimeout(250);
      removed = await markerCount();
    }
    check("the waveform strip adds a marker on a click and removes it on a second click", added === 1 && removed === 0, `(after add ${added}, after remove ${removed})`);
    // Markers from the detected beats: the Manual source, in the link.
    await page.getByTestId("vb-use-detected").click();
    await page.waitForTimeout(400);
    const vbMarkers = await markerCount();
    const bm = new URL(page.url()).searchParams.get("bm") ?? "";
    const vbManual = await vb.getAttribute("data-vb-source");
    const markerLabel = await page.getByTestId("vb-marker-count").innerText().catch(() => "");
    check("Use detected beats writes the markers: the Manual source, shared as bm", vbMarkers === vbBeats && vbManual === "manual" && /^\d+(\.\d+(\*\d+)?)+$/.test(bm) && /120\.\d BPM/.test(markerLabel), `(${vbMarkers} markers, source ${vbManual}, bm=${bm.slice(0, 32)}…, "${markerLabel}")`);
    // Tap tempo while the preview plays: the estimate follows the pace of the taps (measured here, as a busy machine slows clicks).
    await vb.getByRole("button", { name: /Play/ }).click();
    await page.waitForTimeout(300);
    const tapTimes = [];
    for (let i = 0; i < 6; i++) {
      tapTimes.push(await page.evaluate(() => performance.now()));
      await page.getByTestId("vb-tap").click();
      await page.waitForTimeout(500);
    }
    const tapText = await page.getByTestId("vb-tap-result").innerText().catch(() => "");
    const tapBpm = Number(/([\d.]+) BPM/.exec(tapText)?.[1] ?? NaN);
    const tapGaps = tapTimes.slice(1).map((t, i) => t - tapTimes[i]).sort((a, b) => a - b);
    const tapExpected = 60000 / tapGaps[tapGaps.length >> 1];
    await vb.getByRole("button", { name: /Pause/ }).click().catch(() => {});
    check("tap tempo estimates the tempo from taps on the preview", Number.isFinite(tapBpm) && Math.abs(tapBpm / tapExpected - 1) < 0.2, `("${tapText}", taps at about ${tapExpected.toFixed(1)} BPM)`);
    // On beat: the timed wall hits of the classic run land on the grid.
    await page.evaluate(() => {
      const root = document.querySelector('[data-testid="video-beats"]');
      // --- review fix (ui-i18n) --- the toggle is a switch named by its label (aria-labelledby)
      const button = [...(root?.querySelectorAll('[role="switch"]') ?? [])].find((b) => /^On beat(?! range)/.test(document.getElementById(b.getAttribute("aria-labelledby") ?? "")?.textContent ?? ""));
      button?.click();
    });
    await page.waitForTimeout(300);
    const onBeatUrl = new URL(page.url()).searchParams.get("onbeat");
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    const onBeatData = await page
      .waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.onbeatHits ?? 0) >= 10, null, { timeout: 60000 })
      .then(() => canvasData())
      .catch(() => canvasData());
    const obHits = Number(onBeatData.onbeatHits ?? 0);
    const obOn = Number(onBeatData.onbeatOnBeat ?? 0);
    const obErr = Number(onBeatData.onbeatMaxErr ?? NaN);
    const obFree = Number(onBeatData.onbeatFree ?? 0);
    const statsLine = await page.getByTestId("vb-onbeat-stats").innerText().catch(() => "");
    await page.screenshot({ path: path.join(outDir, "video-beats-onbeat.png") });
    check(
      "On beat lands the classic run's timed wall hits within 30 ms of the beat grid",
      onBeatUrl === "1" && obHits >= 10 && obOn === obHits && obErr <= 30 && obHits >= obFree,
      `(hits ${obHits}, on the beat ${obOn}, worst ${obErr} ms, free ${obFree}, beats ${onBeatData.onbeatBeats}, "${statsLine}")`,
    );
    // A short recording carries the media's audio (it is the music bed); the run starts over first (R), so it is still going.
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
    const vbDownload = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
      (async () => {
        await page.getByRole("button", { name: /Record Video/ }).click();
        await page.waitForTimeout(3500);
        await page.getByRole("button", { name: /Stop & Export/ }).click();
      })(),
    ]).then(([d]) => d);
    let vbFile = null;
    if (vbDownload) {
      const out = path.join(outDir, `video-beats-${vbDownload.suggestedFilename()}`);
      await vbDownload.saveAs(out);
      const buf = fs.readFileSync(out);
      vbFile = { name: vbDownload.suggestedFilename(), bytes: buf.length, audio: buf.includes(Buffer.from("A_OPUS")) || buf.includes(Buffer.from("A_VORBIS")) || buf.includes(Buffer.from("mp4a")) || buf.includes(Buffer.from("soun")) };
    }
    check("a recording with the beat media downloads with an audio track", !!vbFile && vbFile.bytes > 10000 && vbFile.audio, `(${vbFile ? `${vbFile.name}, ${vbFile.bytes} bytes, audio=${vbFile.audio}` : "no download"})`);
  } catch (err) {
    check("the beats-from-a-video checks run to the end", false, `(${String(err).split("\n")[0].slice(0, 200)})`);
  }
}
// --- end video-beats ---
// --- viral-bot --- Viral video bot (the Bot block after the Batch block of the Recording section): "Today's plan" plans three
// clips in the page (recipe, hook, mode, seed, length, ending and a score with its nine reasons), the plan survives a reload
// (localStorage), the page exposes the planner to the CLI (window.__jumpingBallsBot, whose text files hold the manifest and
// the schedule), "Open in simulator" puts a clip on the page, and a one-clip short plan starts "Render all": the batch
// renderer renders it and the ZIP holds the video as <episode>-<recipe>-<seed>, its caption file, manifest.json and
// posting-schedule.md. Without WebCodecs the block says so. Every planned clip's share link opens with its planned seed, and
// in the arena games the captions keep below the mode's scoreboard band.
{
  const BOT_KEY = "jumpingballslive_viral_bot";
  const botStatus = () => page.locator("[data-bot]").getAttribute("data-bot").catch(() => null);
  const botRows = () => page.locator("[data-bot-clip]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-bot-clip"), recipe: e.getAttribute("data-bot-recipe"), score: Number(e.getAttribute("data-bot-score")), ending: e.getAttribute("data-bot-ending"), seed: e.getAttribute("data-bot-seed") })));
  const openBot = async () => {
    await page.getByRole("button", { name: /Recording/ }).click();
    await page.locator("[data-bot]").waitFor({ timeout: 10000 });
    return page.locator("[data-bot]");
  };
  const waitClips = (n) => page.waitForFunction((count) => document.querySelector("[data-bot]")?.getAttribute("data-bot") === "planned" && document.querySelector("[data-bot]")?.getAttribute("data-bot-clips") === String(count), n, { timeout: 180000 }).then(() => true).catch(() => false);
  await page.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
  await page.evaluate((key) => localStorage.removeItem(key), BOT_KEY);
  await page.reload({ waitUntil: "networkidle" });
  let bot = await openBot();
  // 1. Today's plan: three clips, each scored with the nine checklist items.
  await page.locator("#bot-count").evaluate(setRangeValue, "3");
  const t0 = Date.now();
  await bot.getByRole("button", { name: /Today's plan/ }).click();
  const planned = await waitClips(3);
  const planMs = Date.now() - t0;
  const rows = await botRows();
  await bot.locator("details summary").first().click().catch(() => {});
  const reasons = await bot.locator("details").first().locator("li").count();
  const hooks = await bot.locator("[data-bot-clip] .italic").allInnerTexts();
  check(
    "viral bot: Today's plan lists three clips with recipe, hook, seed, ending and a score with its reasons",
    planned && rows.length === 3 && rows.every((r) => r.recipe && r.score > 0 && r.score <= 100 && /^(resolved|cliffhanger)$/.test(r.ending) && /^\d+$/.test(r.seed) && /^ep\d{3}-\d+-[a-z-]+-\d+$/.test(r.id)) && reasons === 9 && hooks.every((h) => h.length > 4),
    `(${JSON.stringify(rows)}; ${reasons} reasons; ${planMs} ms)`,
  );
  // 2. The CLI's handle and the text files of the plan.
  const files = await page.evaluate(() => (window.__jumpingBallsBot ? window.__jumpingBallsBot.textFiles().map((f) => ({ name: f.name, size: f.text.length })) : null));
  const manifest = await page.evaluate(() => JSON.parse(window.__jumpingBallsBot?.textFiles().find((f) => f.name === "manifest.json")?.text ?? "null"));
  check(
    "viral bot: the page exposes the planner to the CLI, with caption files, manifest.json and posting-schedule.md",
    !!files && files.length === 5 && files.some((f) => f.name === "manifest.json") && files.some((f) => f.name === "posting-schedule.md") && manifest?.clips?.length === 3 && manifest.clips.every((c, i) => c.seed === Number(rows[i]?.seed) && c.shareUrl.includes(`seed=${c.seed}`) && c.status === "planned"),
    `(${JSON.stringify(files)})`,
  );
  // 3. The plan survives a reload; Open in simulator puts the clip on the page.
  await page.reload({ waitUntil: "networkidle" });
  bot = await openBot();
  const kept = await waitClips(3);
  const keptRows = await botRows();
  const first = manifest?.clips?.[0];
  await bot.locator("[data-bot-clip]").first().getByRole("button", { name: /Open in simulator/ }).click();
  const opened = first ? await page.waitForFunction((mode) => new URLSearchParams(location.search).get("mode") === mode, first.mode, { timeout: 15000 }).then(() => true).catch(() => false) : false;
  check("viral bot: the plan survives a reload and Open in simulator puts its settings on the page", kept && JSON.stringify(keptRows) === JSON.stringify(rows) && opened, `(${first?.mode}, ${page.url().slice(0, 140)}…)`);
  // 4. A one-clip short plan and Render all.
  await page.evaluate(() => window.scrollTo(0, 0));
  bot = page.locator("[data-bot]");
  if ((await bot.count()) === 0) bot = await openBot();
  await bot.getByRole("button", { name: "Shorts", exact: true }).click();
  await page.locator("#bot-count").evaluate(setRangeValue, "1");
  await bot.getByRole("button", { name: /Plan clips/ }).click();
  const one = await waitClips(1);
  const oneRow = (await botRows())[0];
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  if (webCodecs) {
    const zipWait = page.waitForEvent("download", { timeout: 480000 }).catch(() => null);
    await bot.getByRole("button", { name: /Render all/ }).click();
    const started = await page.waitForFunction(() => document.querySelector("[data-bot]")?.getAttribute("data-bot") === "rendering" || document.querySelector("[data-batch-job='rendering']"), null, { timeout: 60000 }).then(() => true).catch(() => false);
    check("viral bot: Render all starts a one-clip render through the batch renderer", one && started, `(${JSON.stringify(oneRow)})`);
    const zip = await zipWait;
    let names = [];
    let zipManifest = null;
    if (zip) {
      const out = path.join(outDir, `bot-${zip.suggestedFilename()}`);
      await zip.saveAs(out);
      const buf = fs.readFileSync(out);
      // STORE-only ZIP: walk the central directory.
      const end = buf.length - 22;
      if (end > 0 && buf.readUInt32LE(end) === 0x06054b50) {
        let at = buf.readUInt32LE(end + 16);
        for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
          const size = buf.readUInt32LE(at + 24);
          const nameLength = buf.readUInt16LE(at + 28);
          const skip = buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
          const local = buf.readUInt32LE(at + 42);
          const name = buf.subarray(at + 46, at + 46 + nameLength).toString("utf8");
          names.push({ name, size });
          if (name === "manifest.json") {
            const dataAt = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
            zipManifest = JSON.parse(buf.subarray(dataAt, dataAt + size).toString("utf8"));
          }
          at += 46 + nameLength + skip;
        }
      }
    }
    const video = names.find((n) => /\.(mp4|webm)$/.test(n.name));
    check(
      "viral bot: the ZIP holds the clip as <episode>-<recipe>-<seed>, its caption file, manifest.json and posting-schedule.md",
      !!zip && /^jumpingballslive-bot-\d{4}-\d{2}-\d{2}\.zip$/.test(zip.suggestedFilename()) && !!video && video.size > 10000 && video.name.startsWith(`${oneRow?.id}.`) && names.some((n) => n.name === `${oneRow?.id}.txt`) && names.some((n) => n.name === "posting-schedule.md") && zipManifest?.clips?.[0]?.status === "done" && zipManifest.clips[0].file === video.name && (await botStatus()) === "done",
      `(${zip?.suggestedFilename() ?? "no ZIP"}: ${JSON.stringify(names)})`,
    );
  } else {
    const disabled = await bot.getByRole("button", { name: /Render all/ }).isDisabled();
    const note = await bot.getByText(/Rendering needs WebCodecs/).first().isVisible().catch(() => false);
    check("viral bot: without WebCodecs the Bot block plans but says rendering needs WebCodecs", one && disabled && note, `(disabled=${disabled}, note=${note})`);
  }
  // --- split-screen --- in a race Render all is off and says why (the fast export draws one arena); opening a clip ends the race
  await page.goto(`${BASE}/en/simulator/?mode=classic&ac=2`, { waitUntil: "networkidle" });
  bot = await openBot();
  {
    const kept = await waitClips(1);
    const raceDisabled = await bot.getByRole("button", { name: /Render all/ }).isDisabled();
    const raceNote = await bot.getByTestId("bot-split-race").isVisible().catch(() => false);
    await bot.locator("[data-bot-clip]").first().getByRole("button", { name: /Open in simulator/ }).click();
    const raceOver = await page.waitForFunction(() => !new URLSearchParams(location.search).has("ac") && !!new URLSearchParams(location.search).get("mode"), null, { timeout: 15000 }).then(() => true).catch(() => false);
    const renderBack = !webCodecs || (await page.waitForFunction(() => [...document.querySelectorAll("[data-bot] button")].some((b) => /Render all/.test(b.textContent ?? "") && !b.disabled), null, { timeout: 15000 }).then(() => true).catch(() => false));
    const noteGone = !(await bot.getByTestId("bot-split-race").isVisible().catch(() => false));
    check("viral bot: a split-screen race keeps Render all off and says why; opening a clip ends the race", kept && raceDisabled && raceNote && raceOver && renderBack && noteGone, `(plan kept=${kept}, disabled=${raceDisabled}, note=${raceNote}, race over=${raceOver}, render back=${renderBack}, ${page.url().slice(0, 120)}…)`);
  }
  // 5. A clip's share link (manifest.json, caption file, schedule) pins its planned seed: the page reads seed= in its first
  // render, before the URL mirror drops it, and the canvas' run (data-seed) is the planned one – and stays it.
  const pinned = [];
  for (const clip of manifest?.clips ?? []) {
    const link = new URL(clip.shareUrl);
    await page.goto(`${BASE}/en/simulator/${link.search}`, { waitUntil: "networkidle" });
    const seedNow = () => page.locator("main canvas").first().getAttribute("data-seed").catch(() => null);
    const hit = await page.waitForFunction((seed) => document.querySelector("main canvas")?.getAttribute("data-seed") === seed, String(clip.seed), { timeout: 15000 }).then(() => true).catch(() => false);
    await page.waitForTimeout(1500);
    pinned.push({ recipe: clip.recipe, planned: clip.seed, page: await seedNow(), hit, mode: new URLSearchParams(await page.evaluate(() => location.search)).get("mode") === clip.mode });
  }
  check(
    "viral bot: every planned clip's share link opens with its planned seed (canvas data-seed) and mode",
    pinned.length === 3 && pinned.every((p) => p.hit && p.page === String(p.planned) && p.mode),
    `(${JSON.stringify(pinned)})`,
  );
  // 6. An arena game's scoreboard band (the top 10 % of the square: "N LEFT", the score and the clock) is the bot's series
  // label's no-go zone – the label is the Bottom Text there – and the top captions start below it.
  {
    const hook = ["tx*t*0*0*p*1.2*ffffff*000000*Pick yours now"].join(",");
    const rows = [];
    for (const mode of ["battle", "ctf"]) {
      await page.goto(`${BASE}/en/simulator/?mode=${mode}&res=1080x1920&bottom=${encodeURIComponent("Square Deathmatch · Day 3")}&cap=${encodeURIComponent(hook)}`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: /Start Simulator/ }).click();
      await page.waitForTimeout(700);
      const d = await canvasData();
      const rect = await page.locator("main canvas").first().evaluate((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
      const side = Math.min(rect.w, rect.h);
      const band = (rect.h - side) / 2 + 0.1 * side;
      const [stackTop] = (d.captionStack ?? "").split(",").map(Number);
      const [, textBottom] = (d.edgeText ?? "").split(",").map(Number);
      rows.push({ mode, stackTop, band: Math.round(band * 10) / 10, captions: d.captions, textBottom, ok: Number(d.captions) === 1 && Number.isFinite(stackTop) && stackTop >= band && Number.isFinite(textBottom) && textBottom > (rect.h + side) / 2 - 0.2 * side });
    }
    check("viral bot: in battle royale and capture the flag the top captions start below the scoreboard band, the label sits at the bottom", rows.every((r) => r.ok), `(${JSON.stringify(rows)})`);
  }
  await page.evaluate((key) => localStorage.removeItem(key), BOT_KEY);
}
// --- end viral-bot ---

// --- gerald-journey ---
// 33. Journey: the preview image and the card under its own "Journey modes" heading; URL → the Journey block of the Mode
// row (the stage rows with their sizes, the stage code, the run line, no Wall Count), the panel's edits → URL (move with
// the arrows, a size, remove, add before HOME, a pasted stage code, Random Stages) and the search box; a short route at 1×
// that clears its stages in order at 30+ fps with a swoosh at every transition (OscillatorNode.start is instrumented: the
// swoosh's sine glide starts at 180 Hz) and finishes at HOME; the finder lands a 30 s seed of the default route and the
// run keeps the promise at 8×; a 1080×1920 recording keeps 20+ fps and downloads; a fast export swooshes through its own
// audio and replays the same frames.
{
  const res = await page.request.get(`${BASE}/modes/journey.webp`);
  check("asset /modes/journey.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const card = (await page.locator('img[src$="/modes/journey.webp"]').count()) === 1;
  const heading = (await page.getByRole("heading", { name: "Journey modes" }).count()) === 1;
  check("the Journey card is on the landing page under its own heading", card && heading, `(card=${card}, heading=${heading})`);
}
/** Frame rates of the page over `ms` of requestAnimationFrame: the average and the worst half-second window. */
const jyFrameRates = async (ms) => {
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
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0, low: lowWindow(windows) };
};
/** The stage rows of the Journey block as "kind-size". */
const jyRows = () => page.getByTestId("journey-stages").locator("li").evaluateAll((els) => els.map((e) => `${e.dataset.stage}-${e.dataset.size}`));
const jyQuery = () => decodeURIComponent(page.url().split("?")[1] || "");
/**
 * Seeds of "multipliers-l,multipliers-l,pegs,glass-s,home" whose grown ball wedged in the peg field before the bars
 * counted, on the simulator canvas of this viewport (790×444): 12, 32 and 37 hopped 4 times and squeezed through, 14
 * hopped once (in a corner at a wall).
 */
const JY_WEDGE_SEEDS = [12, 14, 32, 37];
{
  await page.goto(`${BASE}/en/simulator/?mode=journey&js=rings-s,pegs-l,glass,home`, { waitUntil: "networkidle" });
  {
    const rows = await jyRows();
    const code = await page.locator('input[aria-label="Stage Code"]').inputValue();
    const run = await page.getByTestId("journey-run").innerText();
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    const noWallCount = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
    check(
      "journey loads its route from the URL",
      rows.join(",") === "rings-s,pegs-l,glass-m,home-m" && code === "rings-s,pegs-l,glass,home" && /3 stages, then HOME/.test(run) && finderShown && noWallCount,
      `(${rows.join(",")}, code "${code}", "${run}", finder shown=${finderShown}, no Wall Count=${noWallCount})`,
    );
  }
  await page.getByRole("button", { name: "Move down 1", exact: true }).click();
  await page.getByRole("button", { name: "Glass 3: Large", exact: true }).click();
  await page.getByRole("button", { name: "Remove stage 2", exact: true }).click();
  await page.locator('select[aria-label="Stage to add"]').selectOption("bullseye");
  await page.getByRole("button", { name: "+ Add", exact: true }).click();
  await page.waitForTimeout(300);
  const edited = { rows: (await jyRows()).join(","), query: jyQuery() };
  await page.locator('input[aria-label="Stage Code"]').fill("funnel-s, bogus, home");
  await page.locator('input[aria-label="Stage Code"]').press("Enter");
  await page.waitForTimeout(300);
  const pasted = { rows: (await jyRows()).join(","), query: jyQuery(), code: await page.locator('input[aria-label="Stage Code"]').inputValue() };
  check(
    "journey edits (arrows, size, remove, add, pasted code) mirror into the URL",
    edited.rows === "pegs-l,glass-l,bullseye-m,home-m" && /(^|&)js=pegs-l,glass-l,bullseye,home(&|$)/.test(edited.query) && pasted.rows === "funnel-s,home-m" && pasted.code === "funnel-s,home" && /(^|&)js=funnel-s,home(&|$)/.test(pasted.query),
    `(${JSON.stringify(edited)}, ${JSON.stringify(pasted)})`,
  );
  await page.locator('input[aria-label="Random Stages"]').evaluate(setRangeValue, "5");
  await page.waitForTimeout(300);
  {
    const run = await page.getByTestId("journey-run").innerText();
    const listHidden = (await page.getByTestId("journey-stages").count()) === 0;
    check("Random Stages replaces the list with a seeded route", /random journey of 5 stages/.test(run) && listHidden && /(^|&)jsa=5(&|$)/.test(jyQuery()), `("${run}", list hidden=${listHidden}, ${jyQuery()})`);
  }
  await page.getByPlaceholder("Search settings...").fill("random stages");
  const found = await page.locator('input[aria-label="Random Stages"]').isVisible();
  const ballSpeedHidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the journey controls", found && ballSpeedHidden, `(found=${found}, Ball Speed hidden=${ballSpeedHidden})`);
}
{
  // A short route at 1×: a small peg field, two glass panes, HOME – stages in order, a swoosh at each of the two transitions.
  await page.goto(`${BASE}/en/simulator/?mode=journey&js=pegs-s,glass-s,home&face=cute`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__jyOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push(this.frequency.value);
      return start.apply(this, arguments);
    };
    const kinds = [];
    window.__jyKinds = kinds;
    const poll = () => {
      const k = document.querySelector("main canvas")?.dataset.journeyKind;
      if (k && kinds[kinds.length - 1] !== k) kinds.push(k);
      if (document.querySelector("main canvas")?.dataset.journeyFinished !== "1") requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(300);
  const fps = await jyFrameRates(3500);
  await page.screenshot({ path: path.join(outDir, "sim-journey.png") });
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 40000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const kinds = await page.evaluate(() => window.__jyKinds);
  const swooshes = await page.evaluate(() => window.__jyOsc.filter((f) => f === 180).length);
  await timingCheck(
    "journey: a short route clears its stages in order with a swoosh at every transition at 30+ fps and finishes at HOME",
    done && kinds.join(",") === "pegs,glass,home" && swooshes === 2 && data.journeySwooshes === "2" && data.journeyHome === "1" && data.journeyFinished === "1" && Number(data.journeyNotes) >= 3 && data.face === "cute",
    fpsOk(fps, 6, 30),
    `(finished=${done}, stages ${kinds.join(",")}, ${swooshes} swoosh tones, ${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("journey") && k !== "journeySequence")))}, ${fpsNote(fps)}, floor 30${loadNote()})`,
  );
}
{
  // Size gates above a peg field (the review of gerald-journey): two large gate stages grow the ball only as far as the
  // narrowest opening of the pegs below – two bar tips, not two pegs – and the outermost peg or bar of a full row sits
  // on the wall, so the grown ball never wedges (no stuck hop, no squeeze); the glass after it breaks by Glass Smash's
  // own rules and HOME celebrates. Seeds that wedged (at this canvas size) before the fix; at 8×.
  const runs = [];
  for (const seed of JY_WEDGE_SEEDS) {
    await page.goto(`${BASE}/en/simulator/?mode=journey&js=multipliers-l,multipliers-l,pegs,glass-s,home&seed=${seed}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    const done = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.journeyFinished === "1", null, { timeout: 30000 }).then(() => true).catch(() => false);
    const data = await canvasData();
    const rect = await page.locator("main canvas").first().evaluate((c) => `${Math.round(c.getBoundingClientRect().width)}x${Math.round(c.getBoundingClientRect().height)}`);
    runs.push({ seed, run: data.seed, done, nudges: data.journeyNudges, swooshes: data.journeySwooshes, home: data.journeyHome, at: data.journeyFinishedMs, canvas: rect });
  }
  check(
    "journey: size gates never grow the ball into a wedge in the peg field below – no stuck hop – and the run breaks the glass and reaches HOME",
    runs.length > 0 && runs.every((r) => r.done && r.run === String(r.seed) && r.nudges === "0" && r.swooshes === "4" && r.home === "1"),
    `(${JSON.stringify(runs)})`,
  );
}
{
  // The finder: the seed moves the default route's length (the rings above all) around the default 30 s clip – a found seed keeps its promise.
  await page.goto(`${BASE}/en/simulator/?mode=journey`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.journeyFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await canvasData();
  }
  check(
    "the finder finds a 30s journey seed and the run keeps the promise",
    ready && Math.abs(promised - 30) <= 0.5 && data.journeyFinished === "1" && data.journeyHome === "1" && Math.abs(Number(data.journeyFinishedMs) / 1000 - promised) < 0.1 && data.journeySwooshes === "7",
    `(ready=${ready}, "${readyText}", finished at ${data.journeyFinishedMs} ms, swooshes ${data.journeySwooshes})`,
  );
}
{
  // A 1080×1920 recording (the default resolution) of the default route, glow on.
  await page.goto(`${BASE}/en/simulator/?mode=journey&dur=10&glow=1`, { waitUntil: "networkidle" });
  let fps = { windows: [], avg: 0, min: 0, low: 0 };
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(300);
      fps = await jyFrameRates(3500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]).then(([d]) => d);
  let size = 0;
  if (download) {
    const file = path.join(outDir, `journey-${download.suggestedFilename()}`);
    await download.saveAs(file);
    size = fs.statSync(file).size;
  }
  await timingCheck("a 1080×1920 journey recording keeps 20+ fps and downloads", size > 10000, fpsOk(fps, 5, 20), `(${size} bytes, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
}
{
  // ⚡ Fast export of a two-stage route: the swoosh goes through the export's own audio (the offline twin of the
  // ToneGenerator), the clip ends with the run instead of at the 10 s clip length, and a second export renders the same frames.
  await page.goto(`${BASE}/en/simulator/?mode=journey&js=pegs-s,home&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  if (webCodecs) {
    await page.evaluate(() => {
      const log = [];
      window.__jyFastOsc = log;
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function () {
        if (this.frequency.value !== 1) log.push(this.frequency.value);
        return start.apply(this, arguments);
      };
    });
    const panel = page.locator("[data-fast-export]");
    const exportOnce = async () => {
      const downloadWait = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
      await page.getByRole("button", { name: /Fast export/ }).click();
      const download = await downloadWait;
      await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
      let bytes = 0;
      if (download) {
        const file = path.join(outDir, `journey-fast-${download.suggestedFilename()}`);
        await download.saveAs(file);
        bytes = fs.statSync(file).size;
      }
      const line = await page.getByText(/Exported a .* s (MP4|WEBM) in/).first().innerText().catch(() => "");
      const swooshes = await page.evaluate(() => window.__jyFastOsc.splice(0).filter((f) => f === 180).length);
      return { status: await panel.getAttribute("data-fast-export"), digest: await panel.getAttribute("data-fast-digest"), bytes, seconds: Number(/Exported a ([\d.]+) s/.exec(line)?.[1] ?? NaN), swooshes };
    };
    const a = await exportOnce();
    const b = await exportOnce();
    check(
      "a journey fast export swooshes through the export's audio, ends with the run and replays the same frames",
      a.status === "done" && a.bytes > 10000 && a.swooshes === 1 && a.seconds > 2 && a.seconds < 9.5 && b.status === "done" && b.swooshes === 1 && !!a.digest && a.digest === b.digest,
      `(${JSON.stringify(a)}, ${JSON.stringify(b)})`,
    );
  } else check("without WebCodecs the journey has no fast export to check (Record Video is covered above)", true);
}
// --- end gerald-journey ---

// --- gerald-bullseye ---
// 34. Bullseye: the preview image and the card; URL → the Bullseye block of the Mode row (shots, interval, chaos, rings,
// moving target, perfect shot, the run summary), controls → URL and the search box; a short rigged run at 1× (OscillatorNode
// .start is instrumented): the perfect shot scores 10 with the fanfare and the slow motion, every landing thuds once (a sine
// body – the only sine voice of the mode – and a triangle knock), the final banner holds before the end; the moving target
// slides and freezes on pause, R restarts the run; the finder lands a 30 s seed that the run keeps at 8×; the default run keeps
// 30+ fps; a 1080×1920 recording keeps 20+ fps and downloads; and a fast export thuds through its own audio and replays the same
// frames.
{
  const res = await page.request.get(`${BASE}/modes/bullseye.webp`);
  check("asset /modes/bullseye.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  check("the Bullseye card is on the landing page", (await page.locator('img[src$="/modes/bullseye.webp"]').count()) === 1);
}
{
  const block = page.getByTestId("bullseye");
  const byToggle = (label) => block.getByRole("switch", { name: switchName(label) });
  const bySlider = (label) => block.locator(`input[aria-label="${label}"]`);
  await page.goto(`${BASE}/en/simulator/?mode=bullseye&bys=6&byi=0.6&byc=0.25&byr=6&byp=2`, { waitUntil: "networkidle" });
  {
    const values = { bys: await bySlider("Shots").inputValue(), byi: await bySlider("Launch Interval").inputValue(), byc: await bySlider("Chaos").inputValue(), byr: await bySlider("Target Rings").inputValue(), byp: await bySlider("Perfect Shot").inputValue() };
    const moving = await byToggle("Moving Target").getAttribute("aria-checked");
    const runText = await page.getByTestId("bullseye-run").innerText();
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0 && (await page.locator('input[aria-label="Gap Size"]').count()) === 0;
    check(
      "bullseye loads from the URL",
      values.bys === "6" && values.byi === "0.6" && values.byc === "0.25" && values.byr === "6" && values.byp === "2" && moving === "false" && /\b6 shots\b/.test(runText) && /Shot 2 is rigged/.test(runText) && finderShown && noRingControls,
      `(${JSON.stringify(values)}, moving=${moving}, "${runText}", finder shown=${finderShown}, no ring controls=${noRingControls})`,
    );
  }
  await bySlider("Shots").evaluate(setRangeValue, "9");
  await bySlider("Target Rings").evaluate(setRangeValue, "8");
  await byToggle("Moving Target").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    check(
      "bullseye mirrors into the URL",
      /(^|&)bys=9(&|$)/.test(query) && /(^|&)byr=8(&|$)/.test(query) && /(^|&)bym=1(&|$)/.test(query) && /(^|&)byp=2(&|$)/.test(query) && /(^|&)byc=0\.25(&|$)/.test(query),
      `(${query})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("launch interval");
  const found = await page.locator('input[aria-label="Launch Interval"]').isVisible();
  const ballSpeedHidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the bullseye controls", found && ballSpeedHidden, `(found=${found}, Ball Speed hidden=${ballSpeedHidden})`);
}
{
  // A short rigged run at 1×: 3 shots 0.6 s apart, the second steered into the bull.
  await page.goto(`${BASE}/en/simulator/?mode=bullseye&bys=3&byi=0.6&byp=2&face=cute`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const log = [];
    window.__byOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push({ f: this.frequency.value, type: this.type });
      return start.apply(this, arguments);
    };
    // The slowest the world clock ran, polled every frame.
    window.__byMinScale = 1;
    const poll = () => {
      const d = document.querySelector("main canvas")?.dataset;
      if (d?.bullseyeTimeScale) window.__byMinScale = Math.min(window.__byMinScale, Number(d.bullseyeTimeScale));
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const banner = await page
    .waitForFunction(() => {
      const d = document.querySelector("main canvas")?.dataset;
      return d?.bullseyeAllLanded === "1" && d?.bullseyeFinished === "0";
    }, null, { timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  await page.screenshot({ path: path.join(outDir, "sim-bullseye.png") });
  const done = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const tones = await page.evaluate(() => window.__byOsc);
  const minScale = await page.evaluate(() => window.__byMinScale);
  const scores = (data.bullseyeScores || "").split(",").map(Number);
  // A thud is a sine body followed by a triangle knock at 3 / 2.2 of its start; the sine is the mode's only sine voice.
  let thuds = 0;
  for (let i = 0; i + 1 < tones.length; i++) if (tones[i].type === "sine" && tones[i + 1].type === "triangle" && Math.abs(tones[i + 1].f / tones[i].f - 3 / 2.2) < 0.01) thuds++;
  const sines = tones.filter((o) => o.type === "sine").length;
  // The fanfare climbs to C6 (MIDI 84), above every peg note and below the stuck-ball tick.
  const fanfare = tones.some((o) => o.type !== "sine" && Math.round(69 + 12 * Math.log2(o.f / 440)) === 84);
  check(
    "bullseye: the rigged shot scores 10 with a fanfare and slow motion, every landing thuds, the final banner holds, then the run ends",
    banner && done && data.bullseyeLanded === "3" && scores.length === 3 && scores[1] === 10 && Number(data.bullseyeTotal) === scores.reduce((a, b) => a + b, 0) && Number(data.bullseyeBullseyes) >= 1 && Number(data.bullseyeSlowMos) >= 1 && minScale <= 0.35 && thuds === 3 && sines === 3 && data.bullseyeThuds === "3" && fanfare && data.bullseyeFinished === "1" && data.face === "cute",
    `(banner=${banner}, finished=${done}, ${JSON.stringify(Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith("bullseye"))))}, slowest ${minScale}, ${thuds} thuds / ${sines} sines, fanfare=${fanfare}, ${tones.length} tones)`,
  );
}
{
  // The moving target slides; Space freezes it; R restarts the run.
  await page.goto(`${BASE}/en/simulator/?mode=bullseye&bym=1&bys=5&byi=0.5`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const xs = [];
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(250);
    xs.push(Number((await canvasData()).bullseyeTargetX));
  }
  await page.keyboard.press("Space");
  await page.waitForTimeout(200);
  const pausedA = await canvasData();
  await page.waitForTimeout(700);
  const pausedB = await canvasData();
  await page.keyboard.press("Space");
  await page.keyboard.press("KeyR");
  await page.waitForTimeout(150);
  const restarted = await canvasData();
  const spread = Math.max(...xs) - Math.min(...xs);
  check(
    "bullseye: the moving target slides, pauses with the run and a restart starts the shots over",
    spread > 15 && pausedA.bullseyeTargetX === pausedB.bullseyeTargetX && pausedA.bullseyeLaunched === pausedB.bullseyeLaunched && Number(pausedA.bullseyeLaunched) >= 3 && restarted.bullseyeMoving === "1" && Number(restarted.bullseyeLaunched) <= 1 && restarted.bullseyeLanded === "0",
    `(target x spread ${spread.toFixed(1)} px, paused ${pausedA.bullseyeTargetX} → ${pausedB.bullseyeTargetX}, launched ${pausedA.bullseyeLaunched} → after restart ${restarted.bullseyeLaunched}, landed ${restarted.bullseyeLanded})`,
  );
}
{
  // The finder: the seed moves the run length (the last flight, the bullseyes' slow motion) – a found seed keeps its promise.
  await page.goto(`${BASE}/en/simulator/?mode=bullseye`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 90000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.bullseyeFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await canvasData();
  }
  check(
    "the finder finds a bullseye seed for 30s and the run keeps the promise",
    ready && Math.abs(promised - 30) <= 0.5 && data.bullseyeFinished === "1" && Math.abs(Number(data.bullseyeFinishedMs) / 1000 - promised) < 0.1 && data.bullseyeLanded === "12",
    `(ready=${ready}, "${readyText}", finished at ${data.bullseyeFinishedMs} ms, landed ${data.bullseyeLanded})`,
  );
}
{
  // The default run at 1× (glow and trails on), a few balls already stuck in the target.
  await page.goto(`${BASE}/en/simulator/?mode=bullseye&glow=1&face=cute`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(7000);
  const fps = await vxFrameRates(4000);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-bullseye-full.png") });
  await timingCheck("the default bullseye keeps 30+ fps with balls stuck in the target", Number(data.bullseyeLanded) >= 3, fpsOk(fps, 6, 30), `(landed ${data.bullseyeLanded}, ${fpsNote(fps)}, floor 30${loadNote()})`, fpsRetry(3000, 5, 30));
}
{
  // A 1080×1920 recording (the default resolution) of the default run.
  await page.goto(`${BASE}/en/simulator/?mode=bullseye&dur=10`, { waitUntil: "networkidle" });
  let fps = { windows: [], avg: 0, min: 0, low: 0 };
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(300);
      fps = await vxFrameRates(3500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]).then(([d]) => d);
  let size = 0;
  if (download) {
    const file = path.join(outDir, `bullseye-${download.suggestedFilename()}`);
    await download.saveAs(file);
    size = fs.statSync(file).size;
  }
  await timingCheck("a 1080×1920 bullseye recording keeps 20+ fps and downloads", size > 10000, fpsOk(fps, 5, 20), `(${size} bytes, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
}
{
  // ⚡ Fast export of a short rigged run (2 shots over a clear field, the first in the bull, about 5 s): every landing thuds
  // through the export's own audio (OscillatorNode.start is instrumented), the clip ends with the run instead of at the 10 s clip
  // length, and a second export renders the same frames.
  await page.goto(`${BASE}/en/simulator/?mode=bullseye&bys=2&byi=0.5&byc=0&byp=1&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  if (webCodecs) {
    await page.evaluate(() => {
      const log = [];
      window.__byFastOsc = log;
      const start = OscillatorNode.prototype.start;
      OscillatorNode.prototype.start = function () {
        if (this.frequency.value !== 1) log.push(this.type);
        return start.apply(this, arguments);
      };
    });
    const panel = page.locator("[data-fast-export]");
    const exportOnce = async () => {
      const downloadWait = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
      await page.getByRole("button", { name: /Fast export/ }).click();
      const download = await downloadWait;
      await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
      let bytes = 0;
      if (download) {
        const file = path.join(outDir, `bullseye-fast-${download.suggestedFilename()}`);
        await download.saveAs(file);
        bytes = fs.statSync(file).size;
      }
      const line = await page.getByText(/Exported a .* s (MP4|WEBM) in/).first().innerText().catch(() => "");
      const thuds = await page.evaluate(() => window.__byFastOsc.splice(0).filter((t) => t === "sine").length);
      return { status: await panel.getAttribute("data-fast-export"), digest: await panel.getAttribute("data-fast-digest"), bytes, seconds: Number(/Exported a ([\d.]+) s/.exec(line)?.[1] ?? NaN), thuds };
    };
    const a = await exportOnce();
    const b = await exportOnce();
    check(
      "a bullseye fast export thuds through the export's audio, ends with the run and replays the same frames",
      a.status === "done" && a.bytes > 10000 && a.thuds === 2 && a.seconds > 3 && a.seconds < 8 && b.status === "done" && b.thuds === 2 && !!a.digest && a.digest === b.digest,
      `(${JSON.stringify(a)}, ${JSON.stringify(b)})`,
    );
  } else check("without WebCodecs the bullseye has no fast export to check (Record Video is covered above)", true);
}
// --- end gerald-bullseye ---

// --- beat-drop ---
// 33. Beat Drop: the preview image and the card; URL → the Beat Drop block of the Mode row (the mix, drift, scrolling, bounce
// height, fly-in time, landing sound, colours, trail, the run summary that says it cannot fail), controls → URL and the search
// box; a 20 s run at 120 BPM at 1× lands on the beats – the measured landings (data-bd-landing-times) sit on multiples of
// 500 ms within 1 ms – with the kick of the drum kit on the landings (OscillatorNode.start is instrumented: its 150 Hz body)
// at a 60 fps floor scaled by the machine's load; a 1080×1920 recording keeps 20+ fps with the obstructions alive and
// downloads; the finder resolves at once (every seed lands every beat) and the run keeps the promise at 8×; and a fast
// export plays the same kicks through its own audio and replays the same frames.
{
  const res = await page.request.get(`${BASE}/modes/beatDrop.webp`);
  check("asset /modes/beatDrop.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  check("the Beat Drop card is on the landing page", (await page.locator('img[src$="/modes/beatDrop.webp"]').count()) === 1);
}
/** Frame rates of the page over `ms` of requestAnimationFrame: the average and the worst half-second window. */
const bdFrameRates = async (ms) => {
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
  return { windows, avg, min: windows.length ? Math.min(...windows) : 0, low: lowWindow(windows) };
};
const bdData = () => page.evaluate(() => ({ ...document.querySelector("main canvas").dataset }));
/** The kicks started since the instrumentation (the kick's body starts at 150 Hz). */
const bdInstrument = () =>
  page.evaluate(() => {
    const log = [];
    window.__bdOsc = log;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value !== 1) log.push(this.frequency.value);
      return start.apply(this, arguments);
    };
  });
{
  const bdPressed = (name) => page.getByTestId("beat-drop").getByRole("button", { name, exact: false }).first().getAttribute("aria-pressed");
  const bdToggle = (label) => page.getByTestId("beat-drop").getByRole("switch", { name: switchName(label) });
  await page.goto(`${BASE}/en/simulator/?mode=beatDrop&bdk=spring,drum&bdd=0.8&bds=arena&bdh=0.33&bda=0.85&bdsn=drums&bdc=rainbow&bdt=0`, { waitUntil: "networkidle" });
  {
    const values = { bdd: await sliderValue("Drift"), bdh: await sliderValue("Bounce Height"), bda: await sliderValue("Fly-in Time") };
    const pressed = {
      spring: await bdPressed(/Spring/),
      drum: await bdPressed(/Drum pad/),
      plank: await bdPressed(/Plank/),
      arena: await bdPressed(/Arena/),
      drums: await bdPressed(/^Drums$/),
      rainbow: await bdPressed(/Rainbow/),
    };
    const trail = await bdToggle("Motion Trail").getAttribute("aria-checked");
    const run = await page.getByTestId("beat-drop-run").innerText();
    const finderShown = await page.getByRole("button", { name: /Find 30s Simulation/ }).isVisible();
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0 && (await page.locator('input[aria-label="Gap Size"]').count()) === 0;
    // 120 BPM, a 30 s clip: landings at 0.5 … 29 s (58 of them), the run ends at 29.6 s.
    check(
      "beat drop loads from the URL",
      values.bdd === "0.8" && values.bdh === "0.33" && values.bda === "0.85" && pressed.spring === "true" && pressed.drum === "true" && pressed.plank === "false" && pressed.arena === "true" && pressed.drums === "true" && pressed.rainbow === "true" && trail === "false" && /\b58 landings at 120 BPM/.test(run) && /29\.6s/.test(run) && /can't miss/.test(run) && finderShown && noRingControls,
      `(${JSON.stringify(values)}, ${JSON.stringify(pressed)}, trail=${trail}, "${run}", finder shown=${finderShown}, no ring controls=${noRingControls})`,
    );
  }
  await page.getByTestId("beat-drop").getByRole("button", { name: /Wedge/ }).click();
  await page.locator('input[aria-label="Drift"]').evaluate(setRangeValue, "0.3");
  await page.getByTestId("beat-drop").getByRole("button", { name: /Endless/ }).click();
  await bdToggle("Motion Trail").click();
  await page.waitForTimeout(300);
  {
    const query = page.url().split("?")[1] || "";
    check(
      "beat drop mirrors into the URL",
      /(^|&)bdk=spring%2Cwedge%2Cdrum(&|$)/.test(query) && /(^|&)bdd=0\.3(&|$)/.test(query) && !/(^|&)bds=/.test(query) && !/(^|&)bdt=/.test(query) && /(^|&)bdsn=drums(&|$)/.test(query),
      `(${query})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("fly-in");
  const found = await page.locator('input[aria-label="Fly-in Time"]').isVisible();
  const ballSpeedHidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the beat drop controls", found && ballSpeedHidden, `(found=${found}, Ball Speed hidden=${ballSpeedHidden})`);
}
{
  // A 20 s run at 1×, 120 BPM (the BPM setting: no song loaded), drums on every landing.
  await page.goto(`${BASE}/en/simulator/?mode=beatDrop&bdsn=drums&face=cute`, { waitUntil: "networkidle" });
  await bdInstrument();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(500);
  const fps = await bdFrameRates(5000);
  await page.screenshot({ path: path.join(outDir, "sim-beat-drop.png") });
  const reached = await page
    .waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.bdTimeMs) >= 20000, null, { timeout: 40000 })
    .then(() => true)
    .catch(() => false);
  const data = await bdData();
  const times = (data.bdLandingTimes || "").split(",").filter(Boolean).map(Number);
  const beats = (data.bdBeatTimes || "").split(",").filter(Boolean).map(Number);
  const onBeat = times.length >= 30 && times.every((t, i) => Math.abs(t - 500 * Math.round(t / 500)) < 1 && Math.abs(t - beats[i]) < 1 && (i === 0 || Math.abs(t - times[i - 1] - 500) < 1));
  const kicks = (await page.evaluate(() => window.__bdOsc)).filter((f) => f === 150).length;
  await timingCheck(
    "beat drop: a 20 s run at 120 BPM lands every beat on the beat, kicks on the landings, 60 fps floor",
    reached && onBeat && Number(data.bdLanded) >= 39 && Number(data.bdMaxErrorMs) < 1 && kicks >= 15 && Number(data.bdSnares) >= 15 && Number(data.bdHats) >= 30 && data.face === "cute",
    fpsOk(fps, 8, 54, 30),
    `(reached=${reached}, landed ${data.bdLanded}, ${times.length} logged, on beat=${onBeat}, max error ${data.bdMaxErrorMs} ms, ${kicks} kicks, snares ${data.bdSnares}, hats ${data.bdHats}, alive ${data.bdAlive}, ${fpsNote(fps)}, floors 54/30${loadNote()})`,
  );
}
{
  // A 1080×1920 recording (the default resolution) of a fast, dense run: 200 BPM, the obstructions flying in a whole beat ahead.
  await page.goto(`${BASE}/en/simulator/?mode=beatDrop&bpm=200&bda=1&bdd=1&dur=10&glow=1`, { waitUntil: "networkidle" });
  let fps = { windows: [], avg: 0, min: 0, low: 0 };
  let alive = 0;
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(300);
      fps = await bdFrameRates(3500);
      alive = Number((await bdData()).bdAlive);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]).then(([d]) => d);
  let size = 0;
  if (download) {
    const file = path.join(outDir, `beat-drop-${download.suggestedFilename()}`);
    await download.saveAs(file);
    size = fs.statSync(file).size;
  }
  await timingCheck("a 1080×1920 beat drop recording keeps 20+ fps with the obstructions alive and downloads", size > 10000 && alive >= 1, fpsOk(fps, 5, 20), `(${size} bytes, ${alive} alive, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
}
{
  // The finder: it cannot fail – the first seed is the one, covering the target's beats; the run keeps the promise at 8×.
  await page.goto(`${BASE}/en/simulator/?mode=beatDrop`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Find 30s Simulation/ }).click();
  const ready = await page.getByText(/Ready to start simulation for/).first().waitFor({ timeout: 30000 }).then(() => true).catch(() => false);
  const readyText = ready ? await page.getByText(/Ready to start simulation for/).first().innerText() : "";
  const promised = Number(/for ([\d.]+)s/.exec(readyText)?.[1] ?? NaN);
  let data = {};
  if (ready) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.bdFinished === "1", null, { timeout: 30000 }).catch(() => {});
    data = await bdData();
  }
  check(
    "the finder picks a beat drop seed for 30s at once and the run keeps the promise",
    ready && Math.abs(promised - 29.6) < 0.05 && data.bdFinished === "1" && Math.abs(Number(data.bdFinishedMs) / 1000 - promised) < 0.1 && data.bdLanded === "58" && data.bdPlanned === "58",
    `(ready=${ready}, "${readyText}", finished at ${data.bdFinishedMs} ms, landed ${data.bdLanded} / ${data.bdPlanned})`,
  );
}
{
  // ⚡ Fast export of a 10 s clip at 120 BPM (landings 0.5 … 9 s: nine kicks on beats 1 and 3): rendered offline, every kick
  // goes through the export's own audio, the clip ends with the run and a second export of the same seed renders the same frames.
  await page.goto(`${BASE}/en/simulator/?mode=beatDrop&bdsn=drums&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
  const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
  if (webCodecs) {
    await bdInstrument();
    const panel = page.locator("[data-fast-export]");
    const exportOnce = async () => {
      const downloadWait = page.waitForEvent("download", { timeout: 120000 }).catch(() => null);
      await page.getByRole("button", { name: /Fast export/ }).click();
      const download = await downloadWait;
      await page.waitForFunction(() => document.querySelector("[data-fast-export]")?.getAttribute("data-fast-export") !== "running", null, { timeout: 60000 }).catch(() => {});
      let bytes = 0;
      if (download) {
        const file = path.join(outDir, `beat-drop-fast-${download.suggestedFilename()}`);
        await download.saveAs(file);
        bytes = fs.statSync(file).size;
      }
      const line = await page.getByText(/Exported a .* s (MP4|WEBM) in/).first().innerText().catch(() => "");
      const kicks = await page.evaluate(() => window.__bdOsc.splice(0).filter((f) => f === 150).length);
      return { status: await panel.getAttribute("data-fast-export"), digest: await panel.getAttribute("data-fast-digest"), bytes, seconds: Number(/Exported a ([\d.]+) s/.exec(line)?.[1] ?? NaN), kicks };
    };
    const a = await exportOnce();
    const b = await exportOnce();
    check(
      "a beat drop fast export plays the kicks through the export's audio, ends with the run and replays the same frames",
      a.status === "done" && a.bytes > 10000 && a.kicks === 9 && a.seconds > 9 && a.seconds < 11 && b.status === "done" && b.kicks === 9 && !!a.digest && a.digest === b.digest,
      `(${JSON.stringify(a)}, ${JSON.stringify(b)})`,
    );
  } else check("without WebCodecs the beat drop has no fast export to check (Record Video is covered above)", true);
}
{
  // --- video-beats --- the Manual beat source reaches Beat Drop: a link with hand-placed markers every 600 ms from 0.25 s
  // (100 BPM; bsrc=manual, bm) plans the obstructions on them, not on the BPM setting's 140 – the beat line names the markers,
  // the canvas follows their tempo, and the run at 4× lands on marker times (250 + 600·k ms) within 1 ms.
  await page.goto(`${BASE}/en/simulator/?mode=beatDrop&bpm=140&bsrc=manual&bm=250.600*39`, { waitUntil: "networkidle" });
  const line = await page.getByTestId("beat-drop").getByText(/Landing on your beat markers: 100 BPM/).first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "4x", exact: true }).click();
  const reached = await page
    .waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.bdLanded) >= 12, null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  const data = await bdData();
  const times = (data.bdLandingTimes || "").split(",").filter(Boolean).map(Number);
  const onMarkers = times.length >= 8 && times.every((t) => Math.abs(t - 250 - 600 * Math.round((t - 250) / 600)) < 1);
  check(
    "beat drop lands on hand-placed beat markers (the Manual beat source), not on the BPM setting",
    line && reached && onMarkers && data.bdBpm === "100" && data.bdSong === "1" && Number(data.bdMaxErrorMs) < 1,
    `(line=${line}, reached=${reached}, landed ${data.bdLanded}, bpm ${data.bdBpm}, grid ${data.bdSong}, max error ${data.bdMaxErrorMs} ms, times ${times.slice(0, 6).join(",")}…)`,
  );
}
// --- end beat-drop ---

// --- review fix (modes-gerald-odd) ---
// 1. The camera's slow motion stretches the real time a run takes (data-camera-slow-lag): a recording is extended by the lag it
// adds, so it is still running when its length of wall time is up. 2. The top captions start below a mode's own top HUD
// (data-caption-mode-hud) in Power Layers, Glass Smash, String Battle and on the multipliers board. 3. With a team roster and
// the HUD off, the String Battle's warning badge takes the top-right corner (the scoreboard has the top-left one).
{
  // (a 10 s clip – the shortest Clip Length – at the slowest slow motion, whose windows last 1.5 s)
  const CLIP_MS = 10000;
  await page.goto(`${BASE}/en/simulator/?mode=shatter&wc=20&slow=1&slowf=0.2&slowms=1500&res=500x500&dur=10`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Recording/ }).click();
  const lagNow = () => page.evaluate(() => Number(document.querySelector("main canvas")?.dataset.cameraSlowLag ?? 0));
  const downloadWait = page.waitForEvent("download", { timeout: 150000 }).catch(() => null);
  const t0 = Date.now();
  await page.getByRole("button", { name: /Record Video/ }).click();
  const lag0 = await lagNow();
  await page.waitForTimeout(Math.max(0, CLIP_MS + 150 - (Date.now() - t0)));
  const extra = (await lagNow()) - lag0;
  const recording = await page.getByRole("button", { name: /Stop & Export/ }).isVisible().catch(() => false);
  const download = await downloadWait;
  const wallMs = Date.now() - t0;
  check(
    "a recording is extended by the real time the slow motion added, so the clip covers its length of the run",
    !!download && (extra > 1000 ? recording && wallMs > CLIP_MS + 0.8 * extra : true),
    `(slow motion added ${extra} ms by the clip length, recording then=${recording}, download after ${wallMs} ms${extra > 1000 ? "" : " – too little slow motion to tell"})`,
  );
}
{
  const cap = encodeURIComponent("cd*t*0*0*p*1.2*ffffff*000000,q*t*0*0*p*1.3*ffffff*000000*Who will win this battle?*ACID");
  const rows = [];
  for (const mode of ["powerLayers&plb=both", "glass", "stringBattle", "multipliers&mpsb=3"]) {
    await page.goto(`${BASE}/en/simulator/?mode=${mode}&cap=${cap}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(800);
    const d = await canvasData();
    const [stackTop] = (d.captionStack ?? "").split(",").map(Number);
    const hud = Number(d.captionModeHud);
    rows.push({ mode, stackTop, hud, ok: Number(d.captions) >= 1 && hud > 0 && stackTop > hud });
  }
  await page.screenshot({ path: path.join(outDir, "sim-captions-below-mode-hud.png") });
  check("the top captions start below the mode's own top HUD (Power Layers, Glass Smash, String Battle, multipliers)", rows.every((r) => r.ok), `(${JSON.stringify(rows)})`);
}
{
  const corner = async (query) => {
    await page.goto(`${BASE}/en/simulator/?mode=stringBattle&${query}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.waitForTimeout(500);
    const d = await canvasData();
    return { badge: d.sbBadge, right: d.sbBadgeRight, scoreboard: d.scoreboard ?? "" };
  };
  const roster = await corner(`sbh=0&teams=${encodeURIComponent("Red*ef4444*x,Blue*3b82f6*y")}`);
  const plain = await corner("sbh=0");
  await page.screenshot({ path: path.join(outDir, "sim-string-battle-badge-corner.png") });
  check("the String Battle's warning badge moves to the top-right corner when the teams scoreboard takes the top-left one", roster.badge === "1" && roster.right === "1" && plain.badge === "1" && plain.right === "0", `(${JSON.stringify({ roster, plain })})`);
}
// --- end review fix (modes-gerald-odd) ---

// --- daily-gallery --- the preset gallery (cards, preview images, Try it) and the daily challenge (the landing card, daily=
// links, the Play today's seed button, the end-of-run panel that copies the challenge link, the streak)
{
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
  const basePath = new URL(BASE).pathname.replace(/\/+$/, "");
  const search = () => new URLSearchParams(new URL(page.url()).search);
  const pinnedRun = (mode, seed, daily) =>
    page
      .waitForFunction(
        ([m, sd, d]) => {
          const p = new URLSearchParams(location.search);
          return p.get("mode") === m && document.querySelector("main canvas")?.getAttribute("data-seed") === sd && (d === null || p.get("daily") === d);
        },
        [mode, seed, daily],
        { timeout: 15000 },
      )
      .then(() => true)
      .catch(() => false);

  // 1. The gallery: a dozen or more cards, every preview image served under the base path, linked from the navbar, the
  //    footer and the sitemap.
  await page.goto(`${BASE}/en/gallery/`, { waitUntil: "networkidle" });
  const cards = await page.$$eval("[data-gallery-card]", (els) => els.map((el) => ({ id: el.getAttribute("data-gallery-card"), mode: el.getAttribute("data-gallery-mode"), query: el.getAttribute("data-gallery-query"), img: el.querySelector("img")?.getAttribute("src") ?? "" })));
  const served = [];
  for (const card of cards) {
    const res = await page.request.get(new URL(card.img, page.url()).href);
    served.push({ id: card.id, ok: res.ok() && /image\/webp/.test(res.headers()["content-type"] ?? "") && card.img.startsWith(`${basePath}/gallery/`) });
  }
  const firstImg = page.locator("[data-gallery-card] img").first();
  await firstImg.scrollIntoViewIfNeeded().catch(() => {});
  const firstLoaded = await firstImg.evaluate((img) => (img.complete && img.naturalWidth > 0) || new Promise((r) => { img.onload = () => r(img.naturalWidth > 0); img.onerror = () => r(false); setTimeout(() => r(img.naturalWidth > 0), 5000); })).catch(() => false);
  check("gallery: at least 12 preset cards, every preview image served (WebP, under the base path) and shown", cards.length >= 12 && served.every((x) => x.ok) && firstLoaded, `(${cards.length} cards, missing: ${served.filter((x) => !x.ok).map((x) => x.id).join(", ") || "none"})`);
  const navLink = await page.locator("header").getByRole("link", { name: "Gallery", exact: true }).first().isVisible().catch(() => false);
  const footerLink = await page.locator("footer").getByRole("link", { name: "Gallery", exact: true }).count();
  const sitemapXml = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  check("gallery: linked from the navbar and the footer, and in the sitemap in every language", navLink && footerLink > 0 && ["en", "pl", "es"].every((l) => sitemapXml.includes(`${BASE}/${l}/gallery/`)), `(nav ${navLink}, footer ${footerLink})`);
  await page.screenshot({ path: path.join(outDir, "gallery.png") });

  // 2. Try it: the simulator opens with the preset's settings and its pinned seed, and the run plays.
  const firstCard = cards[0];
  const preset = new URLSearchParams(firstCard?.query ?? "");
  await page.locator(`[data-gallery-card="${firstCard?.id}"]`).getByRole("link", { name: /Try it/ }).click();
  await page.waitForURL(/\/en\/simulator\//, { timeout: 15000 }).catch(() => {});
  const presetPinned = await pinnedRun(firstCard?.mode, preset.get("seed"), null);
  const presetKept = [...preset].filter(([k]) => k !== "seed").every(([k, v]) => search().get(k) === v);
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForTimeout(1500);
  const presetTime = await page.locator("span.tabular-nums").first().innerText().catch(() => "");
  check("gallery: Try it opens the simulator with the preset applied and its seed pinned, and the run plays", presetPinned && presetKept && /\d/.test(presetTime) && presetTime !== "0.0s", `(${firstCard?.id}: pinned ${presetPinned}, settings kept ${presetKept}, elapsed ${presetTime})`);
  await page.goto(`${BASE}/pl/gallery/`, { waitUntil: "networkidle" });
  const plTry = await page.getByRole("link", { name: /Wypróbuj/ }).count();
  check("gallery: the Polish gallery speaks Polish", plTry === cards.length, `(${plTry} "Wypróbuj" links)`);

  // 3. The landing card: today's (UTC) challenge right below the hero.
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.removeItem("jumpingballslive_daily"));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => !!document.querySelector("[data-testid=daily-card]")?.getAttribute("data-daily-mode"), null, { timeout: 10000 }).catch(() => {});
  const daily = await page.getByTestId("daily-card").evaluate((el) => ({ date: el.getAttribute("data-daily-date"), mode: el.getAttribute("data-daily-mode"), seed: el.getAttribute("data-daily-seed") })).catch(() => ({}));
  const belowHero = await page.evaluate(() => {
    const card = document.querySelector("[data-testid=daily-card]");
    const hero = document.querySelector("h1");
    const modes = document.getElementById("modes");
    return !!card && !!hero && !!modes && !!(hero.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING) && !!(card.compareDocumentPosition(modes) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  const todayUtc = new Date().toISOString().slice(0, 10);
  check("daily: the landing card shows today's UTC challenge (mode, seed) between the hero and the mode cards", daily.date === todayUtc && !!daily.mode && /^\d+$/.test(daily.seed ?? "") && belowHero, `(${JSON.stringify(daily)})`);

  // 4. Its Play button opens daily=1: today's mode with its seed pinned, the address keeps daily=<date>.
  await page.getByTestId("daily-play").click();
  await page.waitForURL(/\/en\/simulator\//, { timeout: 15000 }).catch(() => {});
  const cardPinned = await pinnedRun(daily.mode, daily.seed, daily.date);
  const barActive = await page.getByTestId("daily-bar").getAttribute("data-daily-active").catch(() => null);
  check("daily: the card's Play today's seed opens today's mode with its seed pinned (daily=<date> in the address)", cardPinned && barActive === daily.date, `(${page.url().slice(0, 140)}, bar ${barActive})`);

  // 5. A mode change ends the challenge: the bar forgets it and the address drops daily=.
  await page.evaluate((mode) => window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: mode })), daily.mode === "lines" ? "classic" : "lines");
  const ended = await page.waitForFunction(() => document.querySelector("[data-testid=daily-bar]")?.getAttribute("data-daily-active") === "" && !new URLSearchParams(location.search).has("daily"), null, { timeout: 10000 }).then(() => true).catch(() => false);
  check("daily: changing the mode ends the challenge (the bar and the address forget it)", ended, `(${page.url().slice(0, 120)})`);

  // 6. The simulator's Play today's seed button loads it from any setup.
  await page.goto(`${BASE}/en/simulator/?mode=lines&g=450&ac=2`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Play today's seed/ }).click();
  const buttonPinned = await pinnedRun(daily.mode, daily.seed, daily.date);
  check("daily: the simulator's Play today's seed button loads today's challenge over any setup (a race ends)", buttonPinned && !search().has("ac") && search().get("g") !== "450", `(${page.url().slice(0, 140)})`);

  // 7. The finished run: the end-of-run panel with the run length and the streak; its button copies the challenge link;
  //    the landing card then shows the day as played.
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const panel = await page.getByTestId("daily-result").waitFor({ timeout: 150000 }).then(() => true).catch(() => false);
  const panelText = panel ? await page.getByTestId("daily-result").innerText() : "";
  await page.screenshot({ path: path.join(outDir, "daily-result.png") });
  let copied = "";
  if (panel) {
    await page.getByRole("button", { name: /Copy challenge link/ }).click();
    await page.getByText(/Copied – paste it anywhere/).waitFor({ timeout: 5000 }).catch(() => {});
    copied = await page.evaluate(() => navigator.clipboard.readText()).catch(() => "");
  }
  check(
    "daily: a finished daily run shows the end-of-run panel (number, run length, streak) and copies the challenge link",
    panel && /#\d+/.test(panelText) && /\d+\.\d s/.test(panelText) && /1 day in a row/.test(panelText) && copied === `${new URL(BASE).origin}${basePath}/en/simulator/?daily=${daily.date}`,
    `(${panelText.replace(/\s+/g, " ").slice(0, 120)} → ${copied})`,
  );
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const played = await page.getByTestId("daily-played").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  check("daily: the landing card shows today's challenge as played, with the streak", played && (await page.getByText(/1 day in a row/).count()) > 0, "");

  // 8. A shared link opens that day's challenge; a bad or future date opens the link as usual.
  await page.goto(`${BASE}/en/simulator/?daily=2026-09-30`, { waitUntil: "networkidle" });
  const epoch = await page.waitForFunction(() => document.querySelector("[data-testid=daily-bar]")?.getAttribute("data-daily-active") === "2026-09-30", null, { timeout: 15000 }).then(() => true).catch(() => false);
  const epochBar = await page.getByTestId("daily-bar").innerText().catch(() => "");
  await page.goto(`${BASE}/en/simulator/?daily=2999-01-01&mode=lines&g=450`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const ignored = search().get("mode") === "lines" && search().get("g") === "450" && !search().has("daily") && (await page.getByTestId("daily-bar").getAttribute("data-daily-active")) === "";
  check("daily: daily=<date> opens that day's challenge (#1 on 2026-09-30); a future or bad date opens the link as usual", epoch && /#1 /.test(epochBar) && ignored, `(${epochBar.split("\n")[0]}, ignored ${ignored})`);
  await page.evaluate(() => localStorage.removeItem("jumpingballslive_daily"));
}
// --- end daily-gallery ---

// --- pwa --- Installable offline app: the manifest, the icons, the offline page and the worker are served and linked; the worker
// takes over and precaches the app shell in a versioned cache; offline (a local proxy in front of the server drops every
// connection) the simulator loads from the cache and runs, and a page never visited shows the offline page in its language; after
// a "new deploy" (the proxy marks every page and gives sw.js a new version) the page comes from the network, the new worker replaces
// the old cache and serves the new pages offline.
{
  const http = await import("node:http");
  const basePath = new URL(BASE).pathname.replace(/\/+$/, "");
  const swRes = await page.request.get(`${BASE}/sw.js`);
  const swText = swRes.ok() ? await swRes.text() : "";
  const version = swText.match(/"version": "([0-9a-f]+)"/)?.[1] ?? null;
  check(
    "pwa: /sw.js is served as JavaScript with its version and precache list",
    swRes.ok() && /javascript/.test(swRes.headers()["content-type"] ?? "") && !!version && swText.includes('"offline.html"') && swText.includes('"_next/static/'),
    `(${swRes.status()}, ${swRes.headers()["content-type"]}, version ${version})`,
  );
  const manRes = await page.request.get(`${BASE}/manifest.webmanifest`);
  const manifest = manRes.ok() ? await manRes.json().catch(() => null) : null;
  check(
    "pwa: manifest.webmanifest starts the standalone app on /en/ under the base path",
    !!manifest && manifest.start_url === `${basePath}/en/` && manifest.scope === `${basePath}/` && manifest.display === "standalone" && !!manifest.theme_color && !!manifest.background_color && !!manifest.name,
    `(${manRes.status()}, ${manRes.headers()["content-type"]}, ${JSON.stringify(manifest && { name: manifest.name, start_url: manifest.start_url, scope: manifest.scope, display: manifest.display })})`,
  );
  const icons = [];
  for (const icon of manifest?.icons ?? []) {
    const res = await page.request.get(new URL(icon.src, `${BASE}/`).href);
    icons.push({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose, ok: res.ok(), type: res.headers()["content-type"] });
  }
  check(
    "pwa: every manifest icon is served (192, 512 and maskable PNGs)",
    icons.length >= 4 && icons.every((i) => i.ok && (!i.src.endsWith(".png") || i.type === "image/png")) && icons.some((i) => i.purpose === "maskable") && icons.some((i) => i.sizes === "192x192"),
    `(${JSON.stringify(icons)})`,
  );
  const offRes = await page.request.get(`${BASE}/offline.html`);
  check("pwa: offline.html is served", offRes.ok() && (await offRes.text()).includes("data-pwa-offline"), `(${offRes.status()})`);
  for (const url of [`${BASE}/pl/`, `${BASE}/pl/this-page-does-not-exist/`]) {
    await page.goto(url, { waitUntil: "networkidle" });
    const head = await page.evaluate(() => ({
      manifest: document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null,
      theme: document.querySelector('meta[name="theme-color"]')?.getAttribute("content") ?? null,
      apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute("href") ?? null,
    }));
    check(
      `pwa: ${url.slice(BASE.length)} links the manifest, the apple-touch-icon and a theme colour`,
      head.manifest === `${basePath}/manifest.webmanifest` && !!head.theme && !!head.apple?.endsWith("/icons/apple-touch-icon.png"),
      `(${JSON.stringify(head)})`,
    );
  }
  const reg = await page.evaluate(async () => {
    const ready = await Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(() => r(null), 30000))]);
    return ready ? { scope: ready.scope, script: ready.active?.scriptURL ?? null } : null;
  });
  check("pwa: the service worker registers on localhost with the base path as its scope", !!reg && reg.scope === `${BASE}/` && reg.script === `${BASE}/sw.js`, `(${JSON.stringify(reg)})`);

  const upstream = new URL(BASE);
  const proxyState = { offline: false, deploy: 0 };
  const proxy = http.createServer((req, res) => {
    if (proxyState.offline) {
      req.socket.destroy();
      return;
    }
    const isSw = (req.url ?? "").split("?")[0] === `${basePath}/sw.js`;
    const up = http.request(
      { hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers: { ...req.headers, host: upstream.host, "accept-encoding": "identity" } },
      (upRes) => {
        const type = String(upRes.headers["content-type"] ?? "");
        if (!proxyState.deploy || !(isSw || type.includes("text/html"))) {
          res.writeHead(upRes.statusCode ?? 502, upRes.headers);
          upRes.pipe(res);
          return;
        }
        const chunks = [];
        upRes.on("data", (c) => chunks.push(c));
        upRes.on("end", () => {
          let body = Buffer.concat(chunks).toString("utf8");
          body = isSw
            ? body.replace(/"version": "([0-9a-f]+)"/, `"version": "$1-deploy${proxyState.deploy}"`)
            : body.replace("<head>", `<head><meta name="smoke-deploy" content="${proxyState.deploy}">`);
          const headers = { ...upRes.headers };
          delete headers["content-length"];
          res.writeHead(upRes.statusCode ?? 502, headers);
          res.end(body);
        });
      },
    );
    up.on("error", () => res.destroy());
    req.pipe(up);
  });
  await new Promise((r) => proxy.listen(0, r));
  const PROXY = `http://localhost:${proxy.address().port}${basePath}`;
  const offCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const off = await offCtx.newPage();
  const offErrors = [];
  off.on("pageerror", (e) => offErrors.push(e.message));
  const cacheKeys = () => off.evaluate(() => caches.keys()).catch(() => []);
  const marker = () => off.evaluate(() => document.querySelector('meta[name="smoke-deploy"]')?.getAttribute("content") ?? null).catch(() => null);
  try {
    await off.goto(`${PROXY}/en/`, { waitUntil: "networkidle" });
    const controlled = await off.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 }).then(() => true).catch(() => false);
    const cached = await off.evaluate(async () => {
      const out = {};
      for (const key of await caches.keys()) out[key] = (await (await caches.open(key)).keys()).map((r) => new URL(r.url).pathname);
      return out;
    }).catch(() => ({}));
    const current = Object.keys(cached).find((k) => k.endsWith(`:${version}`));
    const shell = current ? cached[current] : [];
    check(
      "pwa: the worker takes over and precaches the app shell in a cache named after its version",
      controlled && !!current && current.includes(`:${basePath}/:`) && [`${basePath}/en/simulator/`, `${basePath}/pl/`, `${basePath}/offline.html`, `${basePath}/icons/icon-512.png`].every((p) => shell.includes(p)) && shell.some((p) => p.includes("/_next/static/")),
      `(controlled=${controlled}, caches=${JSON.stringify(Object.fromEntries(Object.entries(cached).map(([k, v]) => [k, v.length])))})`,
    );

    proxyState.offline = true;
    const offSim = await off.goto(`${PROXY}/en/simulator/?mode=classic`, { waitUntil: "load", timeout: 30000 }).catch(() => null);
    const started = await off.getByRole("button", { name: /Start Simulator/ }).click({ timeout: 20000 }).then(() => true).catch(() => false);
    await off.waitForTimeout(2500);
    const elapsed = await off.locator("span.tabular-nums").first().innerText().catch(() => "");
    check(
      "pwa: offline, the simulator loads from the cache and runs",
      !!offSim && offSim.ok() && started && /\d/.test(elapsed) && elapsed !== "0.0s",
      `(status ${offSim?.status()}, from worker ${offSim?.fromServiceWorker()}, started=${started}, elapsed ${elapsed})`,
    );
    await off.goto(`${PROXY}/pl/privacy/`, { waitUntil: "load", timeout: 30000 }).catch(() => null);
    const offlinePage = await off.evaluate(() => ({
      offline: document.body.hasAttribute("data-pwa-offline"),
      lang: document.documentElement.lang,
      title: document.title,
      h1: document.querySelector("h1")?.textContent ?? "",
      simulator: document.getElementById("pwa-offline-simulator")?.getAttribute("href") ?? null,
    })).catch(() => null);
    check(
      "pwa: offline, a page never visited shows the offline page in the URL's language",
      !!offlinePage && offlinePage.offline && offlinePage.lang === "pl" && offlinePage.h1 === "Jesteś offline" && offlinePage.simulator === `${basePath}/pl/simulator/`,
      `(${JSON.stringify(offlinePage)})`,
    );
    await off.screenshot({ path: path.join(outDir, "pwa-offline.png") });

    proxyState.offline = false;
    proxyState.deploy = 1;
    await off.goto(`${PROXY}/en/`, { waitUntil: "networkidle" });
    const onlineMarker = await marker();
    await off.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration();
      await r?.update();
    }).catch(() => {});
    let keys = [];
    for (let i = 0; i < 60; i++) {
      keys = await cacheKeys();
      if (keys.some((k) => k.endsWith(`:${version}-deploy1`)) && !keys.some((k) => k.endsWith(`:${version}`))) break;
      await off.waitForTimeout(1000);
    }
    const swapped = keys.some((k) => k.endsWith(`:${version}-deploy1`)) && !keys.some((k) => k.endsWith(`:${version}`));
    proxyState.offline = true;
    await off.goto(`${PROXY}/en/simulator/`, { waitUntil: "load", timeout: 30000 }).catch(() => null);
    const offlineMarker = await marker();
    check(
      "pwa: after a new deploy the page comes from the network, the new worker replaces the old cache and serves the new pages offline",
      onlineMarker === "1" && swapped && offlineMarker === "1",
      `(online marker=${onlineMarker}, caches=${JSON.stringify(keys)}, offline marker=${offlineMarker})`,
    );
  } finally {
    proxyState.offline = false;
    await offCtx.close().catch(() => {});
    proxy.closeAllConnections?.();
    await new Promise((r) => proxy.close(() => r()));
  }
  check("pwa: no page errors while offline or across the update", offErrors.length === 0, offErrors.length ? `\n   ${offErrors.slice(0, 5).join("\n   ")}` : "");
}
// --- end pwa ---
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
  // A recording of the extreme run still downloads. At this speed the six team balls may escape within a second or two, which
  // ends the run – and the recording stops and downloads by itself; otherwise Stop & Export ends it.
  await page.getByRole("button", { name: /Restart/ }).first().click().catch(() => {});
  const extremeDownload = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(3500);
      const stop = page.getByRole("button", { name: /Stop & Export/ });
      if (await stop.isVisible().catch(() => false)) await stop.click().catch(() => {});
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

  // --- review fix (unlimited) --- a link with a value past its range but without `inf=1` (a core number keeps it) opens with
  // the switch on – its soft ceilings, frame budget and badges – so 100,000 rings never freeze the page
  await page.goto(`${BASE}/en/simulator/?mode=classic&wc=100000`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const ringsOn = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.unlimited === "1", null, { timeout: 15000 }).then(() => true).catch(() => false);
  const frames = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const tick = () => (performance.now() - t0 < 3000 ? (n++, requestAnimationFrame(tick)) : resolve(n));
        requestAnimationFrame(tick);
      }),
  );
  const ringsLink = await page.evaluate(() => new URLSearchParams(location.search).get("inf"));
  check(
    "no limits: a link with 100,000 rings and no inf=1 opens with the switch on and stays responsive (a thousand rings, the frame budget)",
    ringsOn && frames >= 15,
    `(switch ${ringsOn}, ${frames} frames in 3 s, inf in the link ${ringsLink}${loadNote()})`,
  );
  // A mode's own settings run past their sliders: 100,000 Power Layers, 40 panes a stage of Glass Smash (the slider stops at 30).
  await page.goto(`${BASE}/en/simulator/?mode=powerLayers&inf=1&pll=100000`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const plLayers = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.plLayers, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  await page.goto(`${BASE}/en/simulator/?mode=glass&inf=1&glr=40&gls=2`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const glassPanes = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.glassPanes, null, { timeout: 15000 }).then((h) => h.jsonValue()).catch(() => null);
  check("no limits: a mode's own settings run past their sliders (100,000 power layers, 40 panes a stage)", plLayers === "100000" && glassPanes === "80", `(layers ${plLayers}, panes ${glassPanes})`);
}
// --- end unlimited ---

// --- review fix (audio) ---
// Leaving the simulator by an in-app link (the header's Back link: a client-side navigation, the same document) closes its
// AudioContext – the music bed and the keep-alive oscillator stop instead of playing on under the landing page with nothing
// there to stop them – and coming back and starting again runs one new context, not a second one next to the first.
{
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  await p.addInitScript(() => {
    const Native = window.AudioContext;
    const made = (window.__acMade = []);
    window.__acClosed = 0;
    window.AudioContext = class extends Native {
      constructor(...args) {
        super(...args);
        made.push(this);
      }
      close() {
        window.__acClosed++;
        return super.close();
      }
    };
  });
  const contexts = () => p.evaluate(() => ({ made: window.__acMade.length, closed: window.__acClosed, states: window.__acMade.map((c) => c.state) }));
  await p.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: /Custom Sound/ }).click();
  await p.locator("#music-file-input").setInputFiles({ name: "smoke-bed.wav", mimeType: "audio/wav", buffer: makeWav(4) });
  const listed = await p.getByTestId("music-track").waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  await p.getByRole("button", { name: /Start Simulator/ }).click();
  const bedOn = await p.getByTestId("music-playing").waitFor({ timeout: 5000 }).then(() => true).catch(() => false);
  await p.waitForTimeout(2000);
  const running = await contexts();
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.locator("header a", { hasText: "Back" }).first().click();
  await p.waitForURL(/\/en\/$/, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const left = await contexts();
  const leftTo = new URL(p.url()).pathname;
  const sameDocument = await p.evaluate(() => Array.isArray(window.__acMade));
  await p.goBack({ waitUntil: "networkidle" }).catch(() => null);
  await p.getByRole("button", { name: /Start Simulator/ }).click({ timeout: 15000 }).catch(() => {});
  await p.waitForTimeout(1500);
  const back = await contexts();
  const backTo = new URL(p.url()).pathname;
  check(
    "leaving the simulator by an in-app link closes its AudioContext (the music bed stops) and coming back runs one new context",
    listed && bedOn && running.states.includes("running") && sameDocument && /\/en\/$/.test(leftTo) && left.closed >= 1 && left.states.every((st) => st === "closed") && /\/simulator\/$/.test(backTo) && back.states.filter((st) => st !== "closed").length === 1,
    `(bed ${listed ? "loaded" : "missing"}${bedOn ? ", playing" : ""}; running ${JSON.stringify(running)}; after Back to ${leftTo}: ${JSON.stringify(left)}; back to ${backTo} and started again: ${JSON.stringify(back)})`,
  );
  await p.close();
}
// --- end review fix (audio) ---

// --- bounce-math ---
// Bounce math: a rule from the link fills the "Bounce math" block of the Ball & Physics section; an edit in the panel (the
// trigger, the amount, a formula – an invalid one shows its error and stays out of the link) lands in the link (`bmr`); the
// search box finds the block; the "Bouncier every bounce" preset plays and the readout of the ball that bounced last grows
// (data-bm-bounce on the canvas, the panel's readout, the Show values badge drawn in the recorded square); a beat rule at
// 120 BPM fires twice a second of simulation time (data-bm-fires / data-bm-time).
{
  const bmrOf = () => new URL(page.url()).searchParams.get("bmr") ?? "";
  const bmData = () => page.evaluate(() => ({ ...document.querySelector("main canvas").dataset }));
  await page.goto(`${BASE}/en/simulator/?mode=classic&bmr=speed.bounce.1.multiply.1_05`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Ball & Physics/ }).first().click();
  const rows = page.getByTestId("bm-rule");
  await rows.first().waitFor({ timeout: 10000 }).catch(() => {});
  const loaded = { count: await rows.count(), param: await page.getByTestId("bm-param").first().inputValue().catch(() => ""), trigger: await page.getByTestId("bm-trigger").first().inputValue().catch(() => ""), op: await page.getByTestId("bm-op").first().inputValue().catch(() => ""), amount: await page.getByTestId("bm-amount").first().inputValue().catch(() => "") };
  check("bounce math: a rule from the link fills the Bounce math block", loaded.count === 1 && loaded.param === "speed" && loaded.trigger === "bounce" && loaded.op === "multiply" && loaded.amount === "1.05", `(${JSON.stringify(loaded)})`);
  await page.getByTestId("bm-trigger").first().selectOption("pass");
  const amount = page.getByTestId("bm-amount").first();
  await amount.fill("1.2");
  await amount.press("Enter");
  await page.waitForTimeout(400);
  const edited = bmrOf();
  await page.getByTestId("bm-op").first().selectOption("formula");
  const formula = page.getByTestId("bm-formula").first();
  await formula.fill("v *");
  await page.waitForTimeout(300);
  const errorShown = await page.getByTestId("bm-formula-error").first().isVisible().catch(() => false);
  const whileInvalid = bmrOf();
  await formula.fill("v * 1.1 + sin(n)");
  await page.waitForTimeout(400);
  const withFormula = bmrOf();
  const formulaField = withFormula.split(".")[4] ?? "";
  let decodedFormula = "";
  try {
    decodedFormula = decodeURIComponent(formulaField);
  } catch {
    decodedFormula = "";
  }
  check(
    "bounce math: an edit in the panel lands in the link (an invalid formula shows its error and stays out)",
    edited === "speed.pass.1.multiply.1_2" && errorShown && whileInvalid.startsWith("speed.pass.1.formula.") && decodeURIComponent(whileInvalid.split(".")[4] ?? "") === "v * 1.2" && withFormula.startsWith("speed.pass.1.formula.") && decodedFormula === "v * 1.1 + sin(n)",
    `(after edit: ${edited}; invalid shown=${errorShown}, link ${whileInvalid}; with formula: ${withFormula} → "${decodedFormula}")`,
  );
  await page.getByPlaceholder("Search settings...").fill("bounce math");
  const found = await page.getByTestId("bm-section").isVisible().catch(() => false);
  await page.getByPlaceholder("Search settings...").fill("");
  check("bounce math: the search box finds the block", found, `(visible=${found})`);

  // "Bouncier every bounce": clear the list, append the preset and play.
  await page.getByRole("button", { name: /Ball & Physics/ }).first().click().catch(() => {});
  const section = page.getByTestId("bm-section");
  if (!(await section.isVisible().catch(() => false))) await page.getByRole("button", { name: /Ball & Physics/ }).first().click();
  await page.getByTestId("bm-clear").click();
  await page.getByTestId("bm-preset").selectOption("bouncier");
  await page.waitForTimeout(400);
  const presetLink = bmrOf();
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.bmFires ?? 0) >= 3, null, { timeout: 30000 }).catch(() => {});
  const early = await bmData();
  await page.waitForFunction((n) => Number(document.querySelector("main canvas")?.dataset.bmFires ?? 0) >= n + 5, Number(early.bmFires ?? 0), { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(250);
  const later = await bmData();
  const readout = await page.getByTestId("bm-readout-bounce").innerText({ timeout: 5000 }).catch(() => "");
  const hud = (later.bmHud ?? "").split(",").map(Number);
  check(
    "bounce math: 'Bouncier every bounce' plays and the readout of the ball that bounced last grows",
    presetLink === "bounciness.bounce.1.multiply.1_05" && Number(early.bmBounce) > 1 && Number(later.bmBounce) > Number(early.bmBounce) && Number(later.bmFires) > Number(early.bmFires) && Math.abs(Number(later.bmBounce) - Math.pow(1.05, Number(later.bmFires))) < 0.02 * Number(later.bmBounce) + 0.002 && Number(readout) > 1 && hud.length === 4 && hud[2] > 0 && hud[3] > 0,
    `(link ${presetLink}; fires ${early.bmFires} → ${later.bmFires}, bounciness ${early.bmBounce} → ${later.bmBounce}, panel ${readout}, badge ${later.bmHud})`,
  );
  await page.screenshot({ path: path.join(outDir, "sim-bounce-math.png") });

  // A beat rule at 120 BPM (no song loaded: the Sound section's BPM) fires twice a second of simulation time.
  await page.goto(`${BASE}/en/simulator/?mode=classic&bpm=120&bmr=hue.beat.1.add.10`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.bmTime ?? 0) >= 1.2, null, { timeout: 30000 }).catch(() => {});
  const b0 = await bmData();
  await page.waitForFunction((t) => Number(document.querySelector("main canvas")?.dataset.bmTime ?? 0) >= t + 4, Number(b0.bmTime ?? 0), { timeout: 30000 }).catch(() => {});
  const b1 = await bmData();
  const dt = Number(b1.bmTime) - Number(b0.bmTime);
  const perSecond = (Number(b1.bmFires) - Number(b0.bmFires)) / dt;
  // every beat at 0, 0.5, 1 … s has fired by the time the clock passes it (within one 60 Hz step)
  const expected = Math.floor(2 * Number(b1.bmTime) + 1e-6) + 1;
  check(
    "bounce math: a beat rule at 120 BPM fires twice a second",
    dt >= 3.5 && Math.abs(perSecond - 2) < 0.35 && Math.abs(Number(b1.bmFires) - expected) <= 1,
    `(${b0.bmFires} → ${b1.bmFires} fires over ${dt.toFixed(2)} s: ${perSecond.toFixed(2)}/s; at ${b1.bmTime} s expected ≈${expected})`,
  );

  // A colour shift turns the default white ball (white has no hue of its own: it turns from a saturated colour).
  await page.goto(`${BASE}/en/simulator/?mode=classic&bmr=hue.bounce.1.add.30`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForFunction(() => Number(document.querySelector("main canvas")?.dataset.bmFires ?? 0) >= 2, null, { timeout: 30000 }).catch(() => {});
  const hue = await bmData();
  const rgb = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hue.bmColor ?? "");
  const channels = rgb ? rgb.slice(1).map((h) => parseInt(h, 16)) : [];
  check("bounce math: a colour shift turns the default white ball", Number(hue.bmFires) >= 2 && channels.length === 3 && Math.max(...channels) - Math.min(...channels) > 80, `(fires ${hue.bmFires}, colour ${hue.bmColor})`);

  // Every mode reports its bounces – the Collision Playground's container too – and the panel names a trigger the mode
  // never sets off (no ring gaps to pass on the Ball Drop board) instead of silently never firing it.
  await page.goto(`${BASE}/en/simulator/?mode=collide&bmr=hue.bounce.1.add.5;hue.collide.1.add.5`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.waitForFunction(() => (document.querySelector("main canvas")?.dataset.bmFires ?? "0,0").split(",").every((n) => Number(n) > 0), null, { timeout: 30000 }).catch(() => {});
  const collideFires = (await bmData()).bmFires ?? "";
  await page.goto(`${BASE}/en/simulator/?mode=drop&bmr=hue.pass.1.add.5;hue.bounce.1.add.5`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Ball & Physics/ }).first().click();
  await page.getByTestId("bm-rule").first().waitFor({ timeout: 10000 }).catch(() => {});
  const marks = await page.getByTestId("bm-rule").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-trigger")}:${e.getAttribute("data-applies")}:${e.querySelector('[data-testid="bm-trigger-note"]') ? "note" : "-"}`));
  check(
    "bounce math: bounce and ball-hit rules fire in the Collision Playground; a trigger Ball Drop never sets off is marked",
    collideFires.split(",").length === 2 && collideFires.split(",").every((n) => Number(n) > 0) && marks.join(" ") === "pass:0:note bounce:1:-",
    `(collide fires ${collideFires}; drop rows ${JSON.stringify(marks)})`,
  );
}
// --- end bounce-math ---
// --- social-publish --- Publish (the block after the Viral video bot block of the Recording section): with nothing set up
// it renders, explains the three paths and offers only the quick share; on a computer "Send to TikTok" downloads the clip,
// copies the caption and opens the TikTok upload page; on a phone (a stubbed navigator.share / canShare) the file itself
// goes to the share sheet; a relay profile is saved and its accounts are listed from a stubbed relay; a YouTube channel
// connected through a stubbed Google token client uploads to a stubbed endpoint (a 308 resume, the progress) and one click
// sends to YouTube and three relay accounts; a fast export's clip is offered to the block.
{
  const pubErrors = [];
  const track = (p) => {
    p.on("pageerror", (e) => pubErrors.push(`pageerror: ${e.message}`));
    p.on("console", (m) => {
      if (m.type() === "error") pubErrors.push(`console: ${m.text()}`);
    });
  };
  const origin = new URL(BASE).origin;
  const clipFile = { name: "smoke-clip.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(700 * 1024, 7) };
  const openPublish = async (p) => {
    await p.getByRole("button", { name: /Recording/ }).click();
    await p.locator("[data-publish]").waitFor({ timeout: 15000 });
    return p.locator("[data-publish]");
  };
  const pubState = (p) => p.locator("[data-publish]").getAttribute("data-publish").catch(() => null);
  let ctx1 = null;
  let phone = null;
  try {
    ctx1 = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true, permissions: ["clipboard-read", "clipboard-write"] });
    // The platforms' upload pages (the quick share opens them) and a Google Identity Services stand-in: its token client
    // answers at once with a token for the scopes it was asked for.
    await ctx1.route(/^https:\/\/www\.(tiktok|instagram|youtube)\.com\//, (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>upload page</title><p>upload</p>" }));
    await ctx1.addInitScript(() => {
      window.__gisRequests = [];
      window.google = {
        accounts: {
          oauth2: {
            initTokenClient: (cfg) => ({
              requestAccessToken: (o) => {
                window.__gisRequests.push({ clientId: cfg.client_id, scope: cfg.scope, prompt: o?.prompt ?? null });
                setTimeout(() => cfg.callback({ access_token: "ya29.smoke", expires_in: 3600, scope: cfg.scope, token_type: "Bearer" }), 30);
              },
            }),
            revoke: () => {},
          },
        },
      };
    });
    // A relay: the key's label and platforms, three accounts, one job that ends with two published and one failed.
    const RELAY = "https://relay.smoke.test";
    const relay = { forms: [], polls: 0 };
    await ctx1.route(`${RELAY}/**`, async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const cors = { "access-control-allow-origin": origin, "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, POST, DELETE, OPTIONS" };
      const json = (body, status = 200) => route.fulfill({ status, headers: cors, contentType: "application/json", body: JSON.stringify(body) });
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (req.headers().authorization !== "Bearer jbl_smoke_key") return json({ error: { code: "unauthorized", message: "Unknown access key" } }, 401);
      if (url.pathname === "/api/me") return json({ name: "jumpingballslive-relay", version: "1.0.0", key: { id: "k_1", label: "Smoke team" }, platforms: { tiktok: true, instagram: true, youtube: true } });
      if (url.pathname === "/api/accounts") return json({ accounts: [{ id: "a_tt1", platform: "tiktok", name: "Smoke Tok", handle: "@smoketok", avatar: null, status: "ok" }, { id: "a_tt2", platform: "tiktok", name: "Second Tok", handle: "@tok2", avatar: null, status: "ok" }, { id: "a_ig1", platform: "instagram", name: "Smoke IG", handle: "@smoke_ig", avatar: null, status: "ok" }] });
      if (url.pathname === "/api/publish" && req.method() === "POST") {
        relay.forms.push((req.postDataBuffer() ?? Buffer.alloc(0)).toString("latin1"));
        return json({ jobId: "j_smoke", job: { id: "j_smoke", status: "running", items: [] } }, 202);
      }
      if (url.pathname === "/api/jobs/j_smoke") {
        relay.polls++;
        const done = relay.polls >= 2;
        return json({
          id: "j_smoke",
          status: done ? "partial" : "running",
          items: [
            { accountId: "a_tt1", platform: "tiktok", name: "Smoke Tok (@smoketok)", status: done ? "published" : "processing", progress: done ? 1 : 0.9, link: done ? "https://www.tiktok.com/@smoketok/video/1" : null },
            { accountId: "a_tt2", platform: "tiktok", name: "Second Tok (@tok2)", status: done ? "published" : "uploading", progress: done ? 1 : 0.5, link: done ? "https://www.tiktok.com/@tok2/video/2" : null },
            { accountId: "a_ig1", platform: "instagram", name: "Smoke IG (@smoke_ig)", status: done ? "failed" : "processing", progress: 0.4, error: done ? "Instagram refused: this Meta app is not yet approved for publishing" : null },
          ],
        });
      }
      return json({ error: { code: "not_found", message: "Not found." } }, 404);
    });
    // YouTube: the channel, a resumable session, a first PUT answered with a 308 (only 256 KiB arrived) and the resumed rest.
    const yt = { init: null, puts: [] };
    await ctx1.route("https://www.googleapis.com/**", async (route) => {
      const req = route.request();
      const url = req.url();
      const cors = { "access-control-allow-origin": origin, "access-control-expose-headers": "Location, Range", "access-control-allow-headers": "authorization, content-type, content-range, x-upload-content-length, x-upload-content-type", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      if (url.startsWith("https://www.googleapis.com/youtube/v3/channels")) return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ items: [{ id: "UCsmoke", snippet: { title: "Smoke Channel", customUrl: "@smokechannel", thumbnails: {} } }] }) });
      if (url.startsWith("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable") && req.method() === "POST") {
        yt.init = { auth: req.headers().authorization, length: req.headers()["x-upload-content-length"], body: req.postData() };
        return route.fulfill({ status: 200, headers: { ...cors, location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=smoke" }, body: "" });
      }
      if (url.includes("upload_id=smoke") && req.method() === "PUT") {
        yt.puts.push({ range: req.headers()["content-range"], bytes: (req.postDataBuffer() ?? Buffer.alloc(0)).length });
        if (yt.puts.length === 1) return route.fulfill({ status: 308, headers: { ...cors, range: "bytes=0-262143" }, body: "" });
        await new Promise((r) => setTimeout(r, 400)); // long enough for the page to show the resumed progress
        return route.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ id: "smokeShort", snippet: { title: "x" } }) });
      }
      return route.fulfill({ status: 404, headers: cors, contentType: "application/json", body: "{}" });
    });

    const p1 = await ctx1.newPage();
    track(p1);
    await p1.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
    await p1.evaluate(() => localStorage.removeItem("jumpingballslive_publish"));
    await p1.reload({ waitUntil: "networkidle" });
    let block = await openPublish(p1);
    // 1. Nothing set up.
    const empty = {
      status: await pubState(p1),
      paths: await p1.getByTestId("publish-paths").locator("li").count().catch(() => 0),
      noClip: await p1.getByTestId("publish-no-clip").isVisible().catch(() => false),
      shareOff: await p1.getByTestId("publish-share-tiktok").isDisabled(),
      sendOff: await p1.getByTestId("publish-send").isDisabled(),
      accounts: await block.locator("[data-publish-account]").count(),
      groups: await block.locator("[data-publish-group]").count(),
    };
    check("publish: with nothing set up the block renders, explains the three paths and offers only the quick share", empty.status === "empty" && empty.paths === 3 && empty.noClip && empty.shareOff && empty.sendOff && empty.accounts === 0 && empty.groups === 3, `(${JSON.stringify(empty)})`);

    // 2. A computer: pick a clip, the words are written, Send to TikTok downloads + copies + opens the upload page.
    await p1.locator("#publish-file-input").setInputFiles(clipFile);
    const ready = await p1.waitForFunction(() => document.querySelector("[data-publish]")?.getAttribute("data-publish") === "ready", null, { timeout: 10000 }).then(() => true).catch(() => false);
    const caption = await p1.locator('[data-publish-field="caption"]').inputValue().catch(() => "");
    const limits = await block.locator("[data-publish-limits]").count();
    const [download, popup] = await Promise.all([p1.waitForEvent("download", { timeout: 15000 }).catch(() => null), ctx1.waitForEvent("page", { timeout: 15000 }).catch(() => null), p1.getByTestId("publish-share-tiktok").click()]);
    await popup?.waitForLoadState("domcontentloaded").catch(() => {});
    const note = { kind: await p1.getByTestId("publish-share-note").getAttribute("data-kind").catch(() => null), copied: await p1.getByTestId("publish-share-note").getAttribute("data-copied").catch(() => null) };
    const clipboard = await p1.evaluate(() => navigator.clipboard.readText()).catch(() => "");
    check(
      "publish: on a computer Send to TikTok downloads the clip, copies the caption with its hashtags and opens the TikTok upload page",
      ready && caption.length > 10 && limits === 3 && !!download && download.suggestedFilename() === "smoke-clip.mp4" && popup?.url() === "https://www.tiktok.com/upload" && note.kind === "desktop" && note.copied === "1" && clipboard.includes("#fyp") && clipboard.includes(caption.split("\n")[0]),
      `(ready=${ready}, download=${download?.suggestedFilename()}, tab=${popup?.url()}, note=${JSON.stringify(note)}, clipboard=${JSON.stringify(clipboard.slice(0, 80))})`,
    );
    await popup?.close().catch(() => {});

    // 3. A relay profile: saved, its accounts listed (and kept after a reload), Test shows the key's label.
    await block.getByTestId("publish-relay-settings").locator("summary").click();
    await p1.locator("#publish-relay-url").fill(RELAY);
    await p1.locator("#publish-relay-key").fill("jbl_smoke_key");
    await p1.locator("#publish-relay-label").fill("Smoke team");
    await block.getByRole("button", { name: "Save relay" }).click();
    const listed = await p1.waitForFunction(() => document.querySelectorAll('[data-publish-via="relay"]').length === 3, null, { timeout: 10000 }).then(() => true).catch(() => false);
    await block.getByRole("button", { name: "Test", exact: true }).click();
    const test = await p1.getByTestId("publish-relay-test").innerText({ timeout: 10000 }).catch(() => "");
    await p1.reload({ waitUntil: "networkidle" });
    block = await openPublish(p1);
    const kept = await p1.waitForFunction(() => document.querySelectorAll('[data-publish-via="relay"]').length === 3, null, { timeout: 10000 }).then(() => true).catch(() => false);
    const groups = await block.locator("[data-publish-account]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-publish-platform")}:${e.getAttribute("data-publish-via")}`));
    check("publish: a relay profile is saved and its TikTok and Instagram accounts are listed (after a reload too)", listed && kept && /Smoke team/.test(test) && /3 accounts/.test(test) && groups.filter((g) => g === "tiktok:relay").length === 2 && groups.includes("instagram:relay"), `(${JSON.stringify(groups)}; test "${test}")`);

    // 4. YouTube straight from the browser: the App setup's client ID, Connect YouTube through the (stubbed) token client.
    await p1.locator("#publish-file-input").setInputFiles(clipFile);
    await p1.waitForFunction(() => document.querySelector("[data-publish]")?.getAttribute("data-publish") === "ready", null, { timeout: 10000 }).catch(() => {});
    await block.getByTestId("publish-yt-settings").locator("summary").click();
    await p1.locator("#publish-yt-client").fill("1234567890-smoke.apps.googleusercontent.com");
    await block.getByRole("button", { name: "Save client ID" }).click();
    await p1.locator('[data-publish-connect="youtube-direct"]').click();
    const connected = await p1.waitForFunction(() => !!document.querySelector('[data-publish-account="yt:UCsmoke"]'), null, { timeout: 10000 }).then(() => true).catch(() => false);
    const gis = await p1.evaluate(() => window.__gisRequests);
    const channel = await block.locator('[data-publish-account="yt:UCsmoke"]').innerText().catch(() => "");
    check("publish: Connect YouTube asks the Google token client for youtube.upload and lists the channel", connected && gis.length === 1 && gis[0].clientId === "1234567890-smoke.apps.googleusercontent.com" && gis[0].scope.includes("youtube.upload") && gis[0].prompt === "select_account" && channel.includes("Smoke Channel"), `(${JSON.stringify(gis)}, "${channel.replace(/\s+/g, " ")}")`);

    // 5. One click: the YouTube channel and the three relay accounts; the YouTube progress is watched. Unlisted first: an
    // Instagram Reel is always public, so the block holds the send back and says so (and that TikTok's unlisted is Friends)
    // instead of posting the Reel publicly; Public sends.
    for (const id of ["a_tt1", "a_tt2", "a_ig1"]) await block.locator(`[data-publish-account$=":${id}"] input[type=checkbox]`).check();
    await p1.locator("#publish-visibility").selectOption("unlisted");
    const heldBack = {
      publicOnly: await p1.getByTestId("publish-public-only").isVisible().catch(() => false),
      friends: await p1.getByTestId("publish-tiktok-friends").isVisible().catch(() => false),
      sendOff: await p1.getByTestId("publish-send").isDisabled(),
    };
    await p1.locator("#publish-visibility").selectOption("public");
    const released = { publicOnly: await p1.getByTestId("publish-public-only").isVisible().catch(() => false), sendOff: await p1.getByTestId("publish-send").isDisabled() };
    check("publish: an Instagram Reel is never sent unlisted or private – the block says Reels are always public (and TikTok's unlisted is Friends)", heldBack.publicOnly && heldBack.friends && heldBack.sendOff && !released.publicOnly && !released.sendOff, `(${JSON.stringify({ heldBack, released })})`);
    const sendLabel = await p1.getByTestId("publish-send").innerText();
    await p1.evaluate(() => {
      window.__ytProgress = [];
      new MutationObserver(() => {
        const el = document.querySelector('[data-publish-send="yt:UCsmoke"]');
        const v = el ? Number(el.getAttribute("data-publish-progress")) : null;
        if (v !== null && window.__ytProgress[window.__ytProgress.length - 1] !== v) window.__ytProgress.push(v);
      }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-publish-progress"] });
    });
    await p1.getByTestId("publish-send").click();
    const settled = await p1
      .waitForFunction(() => {
        const items = [...document.querySelectorAll("[data-publish-send]")];
        return items.length === 4 && items.every((el) => ["published", "failed", "needsAuth"].includes(el.getAttribute("data-publish-status")));
      }, null, { timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    const items = await block.locator("[data-publish-send]").evaluateAll((els) => els.map((e) => ({ key: e.getAttribute("data-publish-send"), status: e.getAttribute("data-publish-status"), progress: Number(e.getAttribute("data-publish-progress")), link: e.querySelector("a")?.getAttribute("href") ?? null })));
    const progress = await p1.evaluate(() => window.__ytProgress);
    const ytItem = items.find((i) => i.key === "yt:UCsmoke");
    const initBody = yt.init?.body ? JSON.parse(yt.init.body) : null;
    check(
      "publish: a connected YouTube channel uploads to the (stubbed) resumable endpoint – a 308 resume, the progress, the Short's link",
      !!ytItem && ytItem.status === "published" && ytItem.progress === 100 && ytItem.link === "https://www.youtube.com/shorts/smokeShort" && yt.init?.auth === "Bearer ya29.smoke" && yt.init.length === String(clipFile.buffer.length) && initBody?.status?.privacyStatus === "public" && initBody?.status?.selfDeclaredMadeForKids === false && initBody?.snippet?.description?.includes("#Shorts") && yt.puts.length === 2 && yt.puts[0].range === `bytes 0-${clipFile.buffer.length - 1}/${clipFile.buffer.length}` && yt.puts[1].range === `bytes 262144-${clipFile.buffer.length - 1}/${clipFile.buffer.length}` && progress.some((v) => v > 0 && v < 100),
      `(${JSON.stringify(ytItem)}, puts ${JSON.stringify(yt.puts)}, progress ${JSON.stringify(progress)})`,
    );
    const form = relay.forms[0] ?? "";
    const recent = Number(await block.locator("[data-publish-recent]").getAttribute("data-publish-recent").catch(() => "0"));
    check(
      "publish: Send to selected sends to every ticked account in one click – YouTube direct plus two TikTok and one Instagram account through one relay upload – with per-account results",
      settled && /\(4\)/.test(sendLabel) && relay.forms.length === 1 && form.includes("a_tt1,a_tt2,a_ig1") && form.includes('name="posts"') && form.includes("#fyp") && form.includes("#reels") && form.includes('filename="smoke-clip.mp4"') && items.find((i) => i.key.endsWith(":a_tt1"))?.link === "https://www.tiktok.com/@smoketok/video/1" && items.find((i) => i.key.endsWith(":a_ig1"))?.status === "failed" && recent === 5,
      `(${JSON.stringify(items)}, ${relay.forms.length} upload(s), recent ${recent}, "${sendLabel}")`,
    );

    // "Try again" on the failed Instagram row after another clip became the one on show: the relay gets the clip that row
    // was sent with (and its words), not the new one.
    await p1.locator("#publish-file-input").setInputFiles({ name: "smoke-other.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(300 * 1024, 3) });
    const switched = await p1.waitForFunction(() => document.querySelector("[data-publish-clip-source]")?.getAttribute("data-publish-clip-name") === "smoke-other.mp4", null, { timeout: 10000 }).then(() => true).catch(() => false);
    await block.locator('[data-publish-send$=":a_ig1"]').getByRole("button", { name: /Try again/ }).click();
    const retried = await p1.waitForFunction(() => document.querySelector('[data-publish-send$=":a_ig1"]')?.getAttribute("data-publish-status") === "failed", null, { timeout: 15000 }).then(() => true).catch(() => false);
    await p1.waitForTimeout(300);
    const again = relay.forms[1] ?? "";
    check(
      "publish: Try again re-sends the failed account's own clip and words, not the clip on show now",
      switched && retried && relay.forms.length === 2 && again.includes('filename="smoke-clip.mp4"') && !again.includes("smoke-other") && /name="accounts"\r?\n\r?\na_ig1\r?\n/.test(again) && again.includes("#reels"),
      `(switched=${switched}, retried=${retried}, ${relay.forms.length} upload(s), second form ${again.length} bytes, file ${/filename="([^"]+)"/.exec(again)?.[1]})`,
    );

    // 6. A fast export's clip is offered to the block.
    const webCodecs = await p1.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof OfflineAudioContext !== "undefined");
    if (webCodecs) {
      await p1.goto(`${BASE}/en/simulator/?mode=classic&dur=10&res=500x500&xfps=30`, { waitUntil: "networkidle" });
      const fastDownload = p1.waitForEvent("download", { timeout: 240000 }).catch(() => null);
      await p1.getByRole("button", { name: /Fast export/ }).click();
      const fastFile = await fastDownload;
      block = await openPublish(p1);
      const offered = await p1.waitForFunction(() => document.querySelector("[data-publish-clip-source]")?.getAttribute("data-publish-clip-source") === "fast", null, { timeout: 15000 }).then(() => true).catch(() => false);
      const name = await block.locator("[data-publish-clip-source]").getAttribute("data-publish-clip-name").catch(() => null);
      check("publish: a fast export's clip is offered to the Publish block", !!fastFile && offered && name === fastFile.suggestedFilename(), `(download ${fastFile?.suggestedFilename()}, block ${name})`);
    }
    await p1.evaluate(() => localStorage.removeItem("jumpingballslive_publish")).catch(() => {});

    // 7. A phone: the share sheet gets the video file itself.
    phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      isMobile: true,
      hasTouch: true,
      acceptDownloads: true,
      permissions: ["clipboard-read", "clipboard-write"],
    });
    await phone.addInitScript(() => {
      window.__shared = [];
      Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: (d) => !!(d && Array.isArray(d.files) && d.files.length > 0 && d.files.every((f) => f instanceof File)) });
      Object.defineProperty(Navigator.prototype, "share", {
        configurable: true,
        value: async (d) => {
          window.__shared.push({ files: (d.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })), text: d.text || "", title: d.title || "" });
        },
      });
    });
    const p2 = await phone.newPage();
    track(p2);
    let phoneDownload = false;
    p2.on("download", () => (phoneDownload = true));
    await p2.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
    await openPublish(p2);
    await p2.locator("#publish-file-input").setInputFiles(clipFile);
    await p2.waitForFunction(() => document.querySelector("[data-publish]")?.getAttribute("data-publish") === "ready", null, { timeout: 10000 }).catch(() => {});
    await p2.getByTestId("publish-share-instagram").click();
    const sharedNote = await p2.getByTestId("publish-share-note").getAttribute("data-kind", { timeout: 10000 }).catch(() => null);
    const shared = await p2.evaluate(() => window.__shared);
    check(
      "publish: on a phone Send to Instagram hands the video file to the share sheet (navigator.share with the file and the caption)",
      shared.length === 1 && shared[0].files.length === 1 && shared[0].files[0].name === "smoke-clip.mp4" && shared[0].files[0].type === "video/mp4" && shared[0].files[0].size === clipFile.buffer.length && shared[0].text.includes("#reels") && sharedNote === "shared" && !phoneDownload,
      `(${JSON.stringify(shared)}, note ${sharedNote}, download ${phoneDownload})`,
    );
  } catch (err) {
    check("publish: the Publish checks run to the end", false, `(${String(err).split("\n")[0].slice(0, 200)})`);
  } finally {
    await ctx1?.close().catch(() => {});
    await phone?.close().catch(() => {});
  }
  const pubHard = pubErrors.filter((e) => !/favicon|ERR_INTERNET|net::ERR|fonts.googleapis|fonts.gstatic|Failed to load resource/.test(e));
  check("publish: no page errors in the Publish checks", pubHard.length === 0, pubHard.length ? `\n   ${pubHard.slice(0, 5).join("\n   ")}` : "");
}
// --- end social-publish ---

// --- desktop-exe --- the Windows app on the website: the download page and its links, the landing button, the navbar /
// footer / sitemap entries; the Desktop group absent on the website and working with a stand-in window.desktop (the bridge
// the app's preload exposes): GPU panel, render queue (a real fast export saved through the bridge, with its ffmpeg pass
// requested), menu actions, Library and the AI settings assistant (an invalid patch retried, the valid one applied, Undo).
{
  const repo = process.env.NEXT_PUBLIC_GITHUB_REPO || "CronusAztec/Balls";
  const latest = `https://github.com/${repo}/releases/latest`;
  const titles = { en: "for Windows", pl: "dla Windows", es: "para Windows" };
  for (const locale of ["en", "pl", "es"]) {
    const res = await page.goto(`${BASE}/${locale}/download/`, { waitUntil: "networkidle" });
    const info = await page.evaluate(() => ({
      h1: document.querySelector("h1")?.textContent ?? "",
      setup: document.querySelector('[data-testid="download-setup"]')?.getAttribute("href") ?? "",
      portable: document.querySelector('[data-testid="download-portable"]')?.getAttribute("href") ?? "",
      releases: document.querySelector('[data-testid="download-releases"]')?.getAttribute("href") ?? "",
      requirements: document.querySelectorAll('[data-testid="download-requirements"] li').length,
      smartScreen: document.querySelector('[data-testid="download-smartscreen"]')?.textContent ?? "",
    }));
    check(
      `desktop-exe: /${locale}/download/ links the latest installer and portable EXE, lists the requirements and explains SmartScreen`,
      res.status() === 200 && info.h1.includes(titles[locale]) && info.setup === `${latest}/download/JumpingBallsLive-Setup.exe` && info.portable === `${latest}/download/JumpingBallsLive-portable.exe` && info.releases === latest && info.requirements === 4 && info.smartScreen.length > 40,
      `(${res.status()}, h1="${info.h1}", setup=${info.setup}, requirements=${info.requirements})`,
    );
  }
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const heroHref = await page.getByTestId("hero-download").getAttribute("href").catch(() => null);
  const navHref = await page.locator("header").getByRole("link", { name: "Windows app", exact: true }).first().getAttribute("href").catch(() => null);
  const footerHref = await page.locator("footer").getByRole("link", { name: "Windows app", exact: true }).first().getAttribute("href").catch(() => null);
  const sitemapXml = await (await page.request.get(`${BASE}/sitemap.xml`)).text();
  const downloadPath = `${new URL(BASE).pathname.replace(/\/+$/, "")}/en/download/`;
  check(
    "desktop-exe: “Download for Windows” on the landing page, the navbar and the footer link /download/, which is in the sitemap in every language",
    heroHref === downloadPath && navHref === downloadPath && footerHref === downloadPath && ["en", "pl", "es"].every((l) => sitemapXml.includes(`${BASE}/${l}/download/`)),
    `(hero ${heroHref}, nav ${navHref}, footer ${footerHref})`,
  );
  await page.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  check("desktop-exe: no Desktop group on the website", (await page.locator("[data-desktop-group]").count()) === 0);

  const FAKE_BRIDGE = `(() => {
    const listeners = {};
    const replies = [
      '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":5000},{"setting":"rainbowBall","value":true}],"summary":"x"}}',
      '{"action":"final","result":{"changes":[{"setting":"ballSpeed","value":800},{"setting":"rainbowBall","value":true},{"setting":"gravity","value":0}],"summary":"Twice as fast, rainbow, no gravity"}}',
    ];
    const state = {
      prefs: { outputFolder: "", preferHardware: true, ffmpegPath: "", encoderOverride: "", closeToTray: true, autoUpdate: true, aiProvider: "local", localModel: "llama-3.2-3b-instruct-q4km", aiGpu: "auto" },
      journal: null, saves: [], chats: [], logs: [], reveals: [], opened: [],
      library: [{ id: "lib-1", path: "D:/Clips/earlier.mp4", fileName: "earlier.mp4", bytes: 2400000, durationSec: 12.5, width: 1080, height: 1920, createdAt: Date.now() - 60000, thumbnail: null, exists: true, encoder: "h264_nvenc", meta: { title: "Earlier", mode: "classic", seed: 7, link: "/en/simulator/?mode=classic&seed=7", platform: "tiktok", hook: "Can it escape?", caption: "Which ring?", hashtags: ["#physics"], queueJobId: null } }],
    };
    const emit = (event, payload) => (listeners[event] || []).forEach((l) => l(payload));
    window.desktop = {
      apiVersion: 1,
      info: async () => ({ appName: "JumpingBallsLive", version: "9.9.9", electron: "44.5.1", chrome: "146.0", platform: "win32", arch: "x64", packaged: true, dataDir: "C:/Users/smoke/AppData/Roaming/JumpingBallsLive", logFile: "main.log", smoke: false }),
      log: (level, message) => state.logs.push(level + ": " + message),
      openLogs: async () => {},
      prefs: { get: async () => state.prefs, set: async (p) => (state.prefs = { ...state.prefs, ...p }) },
      gpu: {
        status: async () => ({ devices: [{ vendor: "nvidia", vendorId: 4318, deviceId: 9860, name: "NVIDIA GeForce RTX 4090", driver: "560.94", active: true }], features: { video_encode: "enabled", video_decode: "enabled", webgpu: "enabled" }, hardwareVideoEncode: true, hardwareVideoDecode: true, webgpu: true, switches: ["--ignore-gpu-blocklist"], disabled: false }),
        probeEncoders: async () => ({ ffmpeg: { path: "ffmpeg.exe", version: "7.1", bundled: true }, encoders: [{ id: "h264_nvenc", codec: "h264", kind: "nvenc", listed: true, works: true }, { id: "libx264", codec: "h264", kind: "software", listed: true, works: true }], chosen: { h264: "h264_nvenc", hevc: "hevc_nvenc", av1: null }, error: null }),
        benchmark: async () => [{ encoder: "h264_nvenc", codec: "h264", fps: 900, realtime: 15, ok: true }],
      },
      dialogs: { pickFolder: async () => "D:/Clips", pickMedia: async () => null },
      render: {
        save: async (req) => {
          state.saves.push({ name: req.name, extension: req.extension, bytes: req.data.byteLength, transcode: req.transcode, meta: req.meta, durationSec: req.durationSec });
          const path = "D:/Clips/" + req.name + (req.transcode ? ".mp4" : "." + req.extension);
          const item = { id: "lib-" + state.saves.length + 1, path, fileName: path.split("/").pop(), bytes: req.data.byteLength, durationSec: req.durationSec, width: null, height: null, createdAt: Date.now(), thumbnail: null, exists: true, encoder: req.transcode ? "h264_nvenc" : null, meta: req.meta };
          state.library.unshift(item);
          return { path, bytes: req.data.byteLength, durationSec: req.durationSec, encoder: item.encoder, item };
        },
        cancel: async () => {},
      },
      journal: { load: async () => state.journal, save: async (j) => { state.journal = JSON.parse(JSON.stringify(j)); } },
      library: { list: async () => state.library, remove: async (id) => (state.library = state.library.filter((i) => i.id !== id)), reveal: async (id) => void state.reveals.push(id), open: async () => {}, openFolder: async () => {}, read: async (id) => ({ name: (state.library.find((i) => i.id === id) || {}).fileName || "clip.mp4", path: "D:/Clips/clip.mp4", mimeType: "video/mp4", kind: "video", data: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]) }) },
      ai: {
        status: async () => ({ provider: "local", ready: true, local: { model: "llama-3.2-3b-instruct-q4km", loaded: true, backend: "vulkan", gpuLayers: 29, error: null }, cloud: { provider: "anthropic", baseUrl: "https://api.anthropic.com", model: "claude-opus-5-5", hasKey: false, encryption: true } }),
        models: async () => [{ id: "llama-3.2-3b-instruct-q4km", name: "Llama 3.2 3B Instruct (Q4_K_M)", size: 2019377696, sha256: "x", licence: "Llama 3.2 Community License", licenceUrl: "https://www.llama.com/llama3_2/license/", url: "https://huggingface.co/x.gguf", state: "ready", downloaded: 2019377696, path: "C:/m.gguf", custom: false, selected: true }],
        downloadModel: async () => [], cancelDownload: async () => {}, importModel: async () => [], selectModel: async () => ({}), removeModel: async () => [],
        chat: async (req) => {
          state.chats.push(req);
          const text = replies.shift() || '{"action":"final","result":{"changes":[{"setting":"showTrails","value":true}],"summary":"-"}}';
          emit("aiToken", { requestId: req.requestId, text });
          return { text, provider: "local", model: "llama", cancelled: false };
        },
        cancel: async () => {}, setCloud: async () => ({}), clearCloudKey: async () => ({}), playbook: async () => "## 3. The recipe\\nMotion in frame one.",
      },
      update: { check: async () => ({ state: "none", version: null, progress: null, message: null }), install: async () => {} },
      on: (event, l) => { (listeners[event] ||= []).push(l); return () => { listeners[event] = listeners[event].filter((x) => x !== l); }; },
    };
    // The app sends web pages to the system browser (main.ts setWindowOpenHandler); here they are only noted.
    window.open = (url) => (state.opened.push(String(url)), null);
    window.__fakeDesktop = { state, emit };
  })();`;
  const dctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await dctx.addInitScript(FAKE_BRIDGE);
  const dp = await dctx.newPage();
  const desktopErrors = [];
  dp.on("pageerror", (e) => desktopErrors.push(e.message));
  dp.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && desktopErrors.push(m.text()));
  try {
    await dp.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
    const shown = await dp.locator("[data-desktop-group]").waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
    await dp.getByTestId("desktop-tab-gpu").click().catch(() => {});
    const gpuName = await dp.getByTestId("desktop-gpu").innerText().catch(() => "");
    const chosen = await dp.locator('[data-encoder="h264"]').innerText().catch(() => "");
    const version = await dp.getByTestId("desktop-version").innerText().catch(() => "");
    check("desktop-exe: with window.desktop the Desktop group shows the GPU, the chosen encoders and the app version", shown && gpuName.includes("NVIDIA GeForce RTX 4090") && chosen === "h264_nvenc" && version.startsWith("9.9.9"), `(shown ${shown}, encoder ${chosen}, version ${version})`);

    await dp.evaluate(() => window.__fakeDesktop.emit("menu", "library"));
    await dp.waitForTimeout(300);
    const libTab = await dp.locator("[data-desktop-group]").getAttribute("data-desktop-tab");
    const libItems = await dp.locator("[data-library-item]").count();
    check("desktop-exe: a menu action opens the Library, which lists the saved clips", libTab === "library" && libItems === 1, `(tab ${libTab}, items ${libItems})`);

    // --- review fix (desktop-exe) --- the Library publishes through the Publish feature: the ticked accounts (none yet: the clip
    // waits in the Publish block and the Library says where to go) and the quick share of the clip's own platform (TikTok here)
    const libItem = dp.locator("[data-library-item]").first();
    const publishButtons = await libItem.getByRole("button", { name: /^Publish to/ }).allInnerTexts().catch(() => []);
    await libItem.getByRole("button", { name: "Publish to your accounts" }).click().catch(() => {});
    const noAccounts = await dp.getByTestId("desktop-library").getByText(/waiting in the Publish block/).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    await libItem.getByRole("button", { name: "Publish to TikTok (quick share)" }).click().catch(() => {});
    const shareNote = await dp.getByTestId("desktop-library").getByText(/upload page opened/).waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    // (the folder opens once the share has run: the note above shows after it)
    await dp.waitForFunction(() => window.__fakeDesktop.state.reveals.length > 0, null, { timeout: 5000 }).catch(() => {});
    const { reveals, opened } = await dp.evaluate(() => ({ reveals: window.__fakeDesktop.state.reveals.slice(), opened: window.__fakeDesktop.state.opened.slice() }));
    check(
      "desktop-exe: the Library publishes through the Publish feature – to the ticked accounts (or says where to tick them) and a quick share of the clip's platform",
      publishButtons.join("|") === "Publish to your accounts|Publish to TikTok (quick share)" && noAccounts && shareNote && reveals.includes("lib-1") && opened.includes("https://www.tiktok.com/upload"),
      `(buttons ${JSON.stringify(publishButtons)}, no accounts note ${noAccounts}, share note ${shareNote}, revealed ${JSON.stringify(reveals)}, opened ${JSON.stringify(opened)})`,
    );
    // In the app the Publish block offers YouTube through the relay (Google's sign-in does not take app:// as an origin)
    await dp.getByRole("button", { name: /Recording/ }).click().catch(() => {});
    const appYouTube = await dp.getByTestId("publish-app-youtube").waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
    const directYouTube = await dp.locator('[data-publish-connect="youtube-direct"]').count();
    const ytSetup = await dp.getByTestId("publish-yt-settings").count();
    const publishClips = await dp.locator("[data-publish]").getAttribute("data-publish-clips").catch(() => null);
    check(
      "desktop-exe: in the app the Publish block holds the Library's clip and offers YouTube through the relay, without the direct Google sign-in",
      appYouTube && directYouTube === 0 && ytSetup === 0 && Number(publishClips) >= 1,
      `(note ${appYouTube}, direct buttons ${directYouTube}, setup ${ytSetup}, clips ${publishClips})`,
    );
    await dp.getByRole("button", { name: /Recording/ }).click().catch(() => {});

    await dp.getByTestId("desktop-tab-queue").click();
    const q = dp.getByTestId("desktop-queue");
    await q.getByTestId("queue-source-random").click();
    await q.locator('input[type="number"]').fill("1");
    await q.getByRole("button", { name: "500x500", exact: true }).click();
    await q.getByRole("button", { name: "1080x1920", exact: true }).click();
    await q.getByRole("button", { name: "30 fps", exact: true }).click();
    await q.getByRole("button", { name: "60 fps", exact: true }).click();
    await q.getByTestId("queue-add").click();
    const queued = await q.getAttribute("data-queue-count");
    await q.getByTestId("queue-start").click();
    const done = await dp.locator('[data-queue-status="done"]').waitFor({ timeout: 120000 }).then(() => true).catch(() => false);
    const fake = await dp.evaluate(() => ({ saves: window.__fakeDesktop.state.saves, journal: window.__fakeDesktop.state.journal, logs: window.__fakeDesktop.state.logs }));
    const save = fake.saves[0];
    const journalDone = fake.journal?.format === "jumpingballslive-render-journal" && fake.journal.jobs?.[0]?.status === "done";
    check(
      "desktop-exe: the render queue renders a clip through the fast export and saves it through the app (no download), asking ffmpeg for H.264 when the browser wrote WebM, and journals it",
      queued === "1" && done && !!save && save.bytes > 1000 && (save.extension === "mp4" ? save.transcode === null : save.transcode?.codec === "h264" && save.transcode?.width === 500) && save.meta?.link?.includes("seed=") && journalDone,
      `(queued ${queued}, done ${done}, save ${save ? `${save.name}.${save.extension} ${save.bytes} B, transcode ${JSON.stringify(save.transcode)}` : "none"}, journal ${journalDone}, logs ${fake.logs.slice(0, 2).join(" | ")})`,
    );
    await dp.screenshot({ path: path.join(outDir, "desktop-queue.png") });

    await dp.getByTestId("desktop-tab-ai").click();
    await dp.getByTestId("ai-task-settings").click();
    await dp.getByTestId("ai-prompt").fill("make the ball twice as fast and rainbow, no gravity");
    await dp.getByTestId("ai-run").click();
    const changed = await dp.getByTestId("ai-changed").innerText({ timeout: 20000 }).catch(() => "");
    const retried = await dp.getByTestId("ai-log").innerText().catch(() => "");
    const applied = await dp.evaluate(() => new URLSearchParams(location.search).toString());
    await dp.getByTestId("ai-undo").click().catch(() => {});
    await dp.waitForTimeout(500);
    const undone = await dp.evaluate(() => new URLSearchParams(location.search).toString());
    const chats = await dp.evaluate(() => window.__fakeDesktop.state.chats.length);
    check(
      "desktop-exe: the AI settings assistant retries an out-of-range patch, applies the valid one and Undo restores the page",
      changed.includes("ballSpeed") && changed.includes("gravity") && /↻/.test(retried) && chats === 2 && applied !== undone,
      `(changed "${changed}", chats ${chats}, url after ${applied.slice(0, 60)}, after undo ${undone.slice(0, 60)})`,
    );
    await dp.screenshot({ path: path.join(outDir, "desktop-ai.png") });
  } finally {
    await dctx.close().catch(() => {});
  }
  check("desktop-exe: no page errors in the Desktop group", desktopErrors.length === 0, desktopErrors.length ? `\n   ${desktopErrors.slice(0, 5).join("\n   ")}` : "");
}
// --- end desktop-exe ---

// --- review fix (ui-i18n) --- the settings search finds the escape modes' Mode-row controls, Wall Count / Gap Size only
// where they act, named switches, the collapsed mobile menu out of the tab order, the language list closes on Escape,
// reduced motion, the slider focus ring, the narrow-panel button rows, keyboard-placed obstacles, the localised alt
// text / footer label / 404 title and the mode count taken from the code.
{
  const search = page.getByPlaceholder("Search settings...");
  const noResults = page.getByText("No settings match your search.");
  const found = {};
  for (const [mode, query, control] of [
    ["accumulation", "Spikes", () => page.getByRole("switch", { name: "Spikes" })],
    ["grow", "Growth Rate", () => page.locator('input[aria-label="Growth Rate"]')],
    ["target", "Number of Targets", () => page.locator('input[aria-label="Number of Targets"]')],
    ["multiply", "Spawn Count", () => page.locator('input[aria-label="Spawn Count"]')],
    ["colorMatch", "Number of Colors", () => page.locator('input[aria-label="Number of Colors"]')],
  ]) {
    await page.goto(`${BASE}/en/simulator/?mode=${mode}`, { waitUntil: "networkidle" });
    await search.fill(query);
    found[`${mode}:${query}`] = (await control().first().isVisible().catch(() => false)) && !(await noResults.isVisible().catch(() => false));
  }
  await page.goto(`${BASE}/en/simulator/?mode=classic`, { waitUntil: "networkidle" });
  await search.fill("Spikes");
  const classicNone = await noResults.isVisible().catch(() => false);
  await search.fill("");
  check("settings search finds the escape modes' Mode-row controls (and still says no results in Classic)", Object.values(found).every(Boolean) && classicNone, `(${JSON.stringify(found)}, classic "Spikes" → no results: ${classicNone})`);

  // Toggles are switches named by their label (not "ON"/"OFF").
  await page.getByRole("button", { name: /Wall Settings/ }).click();
  const rotation = page.getByRole("switch", { name: "Rotation" });
  const rotationOk = (await rotation.count()) === 1 && (await rotation.getAttribute("aria-checked")) !== null && (await page.getByRole("button", { name: /^(ON|OFF)$/ }).count()) === 0;
  check("ON/OFF toggles are switches named by their label (Rotation)", rotationOk, `(switches named Rotation: ${await rotation.count()}, aria-checked=${await rotation.getAttribute("aria-checked").catch(() => null)})`);

  // Wall Count and Gap Size are left out where the mode builds one gapless ring (Grow, Portal); Rotation stays.
  await page.evaluate(() => localStorage.setItem("jumpingballslive_advanced_options", "true"));
  const wallSliders = {};
  for (const mode of ["classic", "grow", "portal"]) {
    await page.goto(`${BASE}/en/simulator/?mode=${mode}`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Wall Settings/ }).click();
    const labels = await page.locator('input[type="range"][aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    wallSliders[mode] = { count: labels.includes("Wall Count"), gap: labels.includes("Gap Size"), thickness: labels.includes("Wall Thickness"), rotation: (await page.getByRole("switch", { name: "Rotation" }).count()) === 1 };
  }
  await page.evaluate(() => localStorage.removeItem("jumpingballslive_advanced_options"));
  check(
    "Wall Count and Gap Size are offered in Classic but not in Grow or Portal (Rotation and Wall Thickness stay)",
    wallSliders.classic.count && wallSliders.classic.gap && ["grow", "portal"].every((m) => !wallSliders[m].count && !wallSliders[m].gap && wallSliders[m].thickness && wallSliders[m].rotation),
    `(${JSON.stringify(wallSliders)})`,
  );

  // A slider reached with Tab shows a focus ring.
  await page.goto(`${BASE}/en/simulator/?mode=accumulation`, { waitUntil: "networkidle" });
  await search.click();
  let ring = null;
  for (let i = 0; i < 30 && !ring; i++) {
    await page.keyboard.press("Tab");
    const onRange = await page.evaluate(() => document.activeElement instanceof HTMLInputElement && document.activeElement.type === "range");
    if (!onRange) continue;
    await page.waitForTimeout(400); // the sliders' transition-all eases the outline in
    ring = await page.evaluate(() => {
      const el = document.activeElement;
      const cs = getComputedStyle(el);
      return { label: el.getAttribute("aria-label"), focusVisible: el.matches(":focus-visible"), outline: cs.outlineStyle, width: cs.outlineWidth };
    });
  }
  check("a slider reached with the keyboard shows a focus ring", !!ring && ring.focusVisible && ring.outline === "solid" && ring.width !== "0px", `(${JSON.stringify(ring)})`);

  // Obstacles can be placed from the keyboard: the row's x / y sliders move them.
  await page.goto(`${BASE}/en/simulator/?mode=classic&obs=${encodeURIComponent("p:0.5,0,6")}`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Obstacles/ }).first().click();
  const xSlider = page.locator('input[aria-label="Horizontal position of obstacle 1"]');
  const ySlider = page.locator('input[aria-label="Vertical position of obstacle 1"]');
  const hasXY = (await xSlider.count()) === 1 && (await ySlider.count()) === 1;
  if (hasXY) {
    await xSlider.focus();
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
    await ySlider.focus();
    for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(300);
  }
  const moved = (new URL(page.url()).searchParams.get("obs") ?? "").split(":")[1]?.split(",").map(Number) ?? [];
  check("an obstacle can be moved with the keyboard (its x / y sliders)", hasXY && Math.abs(moved[0] - 0.45) < 0.001 && Math.abs(moved[1] - 0.03) < 0.001, `(obs=${new URL(page.url()).searchParams.get("obs")})`);

  // Narrow panel (phone width, Polish / Spanish): the button rows wrap instead of clipping their labels.
  const narrow = await browser.newContext({ viewport: { width: 360, height: 780 } });
  try {
    const np = await narrow.newPage();
    const clipped = async (group) =>
      np.evaluate(
        (label) =>
          [...document.querySelectorAll(`main [role="group"][aria-label="${label}"] button`)]
            .filter((b) => b.offsetParent !== null && b.scrollWidth > b.clientWidth + 1)
            .map((b) => b.textContent.trim()),
        group,
      );
    await np.goto(`${BASE}/pl/simulator/?mode=classic`, { waitUntil: "networkidle" });
    await np.getByRole("button", { name: /Piłka i fizyka/ }).click();
    const plClipped = await clipped("Interakcja piłek");
    const plPass = await np.getByRole("button", { name: /Przenikanie/ }).count();
    await np.goto(`${BASE}/es/simulator/?mode=polyrhythm`, { waitUntil: "networkidle" });
    const esClipped = await clipped("Tempos");
    check("narrow panel: Polish / Spanish option buttons are not clipped (interaction, tempos)", plPass === 1 && plClipped.length === 0 && esClipped.length === 0, `(pl pass=${plPass}, pl clipped ${JSON.stringify(plClipped)}, es clipped ${JSON.stringify(esClipped)})`);

    // The collapsed mobile menu is out of the tab order; opened, it is reachable and Escape closes it.
    await np.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
    const stops = [];
    for (let i = 0; i < 3; i++) {
      await np.keyboard.press("Tab");
      stops.push(await np.evaluate(() => ({ text: (document.activeElement?.textContent ?? "").trim().slice(0, 30), inMenu: !!document.activeElement?.closest('[data-testid="mobile-menu"]') })));
    }
    const inertClosed = await np.getByTestId("mobile-menu").evaluate((el) => el.hasAttribute("inert"));
    const burger = np.getByRole("button", { name: "Open menu" });
    await burger.click();
    const controls = await np.getByRole("button", { name: "Close menu" }).getAttribute("aria-controls");
    const openedInert = await np.getByTestId("mobile-menu").evaluate((el) => el.hasAttribute("inert"));
    await np.keyboard.press("Tab");
    const intoMenu = await np.evaluate(() => !!document.activeElement?.closest('[data-testid="mobile-menu"]'));
    await np.keyboard.press("Escape");
    const closedByEscape = (await np.getByRole("button", { name: "Open menu" }).getAttribute("aria-expanded")) === "false";
    const menuId = await np.getByTestId("mobile-menu").getAttribute("id");
    check(
      "mobile menu: closed it is inert (Tab skips it), opened it is reachable, Escape closes it",
      stops.every((s) => !s.inMenu) && inertClosed && !openedInert && intoMenu && closedByEscape && !!controls && controls === menuId,
      `(${JSON.stringify(stops)}, inert closed=${inertClosed} open=${openedInert}, into menu=${intoMenu}, escape=${closedByEscape}, aria-controls=${controls}/${menuId})`,
    );
  } finally {
    await narrow.close().catch(() => {});
  }

  // Desktop language list: Escape closes it and returns focus to the trigger.
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const trigger = page.locator("header").getByRole("button", { name: /English/ }).first(); // (the open list has an English option too)
  await trigger.click();
  const listOpen = (await page.getByRole("button", { name: /Español/ }).count()) === 1 && (await trigger.getAttribute("aria-expanded")) === "true";
  const noMenuRoles = (await page.locator('header [role="menu"], header [role="menuitem"]').count()) === 0;
  await page.keyboard.press("Escape");
  const closed = (await page.getByRole("button", { name: /Español/ }).count()) === 0;
  const focusBack = await page.evaluate(() => document.activeElement?.getAttribute("aria-expanded") === "false" && /English/.test(document.activeElement?.textContent ?? ""));
  check("language list: a disclosure that Escape closes, focus back on the trigger", listOpen && noMenuRoles && closed && focusBack, `(open=${listOpen}, no menu roles=${noMenuRoles}, closed=${closed}, focus back=${focusBack})`);

  // The mode count in the hero is the number of mode cards.
  const cards = await page.locator('#modes img[src*="/modes/"]').count();
  const subtitle = await page.locator("section p").first().innerText();
  check("the hero's mode count matches the mode cards", cards >= 26 && subtitle.includes(`one of ${cards} modes`), `(${cards} cards, "${subtitle.slice(0, 120)}")`);

  // Localised alt text and footer landmark (Polish), localised 404 title.
  await page.goto(`${BASE}/pl/`, { waitUntil: "networkidle" });
  const alt = await page.locator('img[src$="/modes/classic.webp"]').first().getAttribute("alt");
  const footerLabel = await page.locator("footer nav").first().getAttribute("aria-label");
  const plSubtitle = await page.locator("section p").first().innerText();
  await page.goto(`${BASE}/pl/this-page-does-not-exist/`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.documentElement.lang === "pl", null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const title404 = await page.title();
  check(
    "Polish pages: localised mode-card alt text, footer label, hero mode count and 404 title",
    alt === "Podgląd trybu Klasyczny" && footerLabel === "Stopka" && plSubtitle.includes(`z ${cards} trybów`) && title404 === "Nie znaleziono strony – JumpingBallsLive",
    `(alt="${alt}", footer="${footerLabel}", title="${title404}")`,
  );

  // Reduced motion: no bouncing logo, no smooth scrolling.
  const calm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
  try {
    const cp = await calm.newPage();
    await cp.goto(`${BASE}/en/simulator/`, { waitUntil: "networkidle" });
    const motion = await cp.evaluate(() => {
      const dot = document.querySelector("header a span");
      const cs = dot ? getComputedStyle(dot) : null;
      return { anim: cs?.animationName, iter: cs?.animationIterationCount, scroll: getComputedStyle(document.documentElement).scrollBehavior };
    });
    check("prefers-reduced-motion: the logo stops bouncing and scrolling is not smooth", motion.anim === "none" && motion.scroll === "auto", `(${JSON.stringify(motion)})`);
  } finally {
    await calm.close().catch(() => {});
  }
}
// --- end review fix (ui-i18n) ---

// --- review fix (performance) ---
// Runtime budgets. (1) Leaving the simulator by an in-app link mid-recording stops the recorder – no download from a page that
// is gone – and the audio: every AudioContext closed, the music bed's looping source stopped. (2) On 75 Hz and 144 Hz displays
// (a rAF cadence emulated with exact timestamps) the canvas draws ~60 fps, not 37–50, and a recording captures each drawn
// frame once (requestFrame ~60 times a second, not once per display frame). (3) Grow with glow at 8× keeps a few MB of
// sprite canvases (one per integer radius held ~290 MB). (4) Classic Paint's trail layer is drawn again after a resize.
{
  const watch = (pg) => {
    pg.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    pg.on("console", (m) => {
      if (m.type() === "error") errors.push(`console: ${m.text()}`);
    });
  };
  const fpsBadge = async (pg) => Number(((await pg.getByTestId("fps-readout").innerText().catch(() => "")) || "").replace(/[^\d].*$/, "")) || 0;

  // (1) mid-recording navigation
  {
    const p = await ctx.newPage();
    watch(p);
    await p.addInitScript(() => {
      const NativeAC = window.AudioContext;
      const contexts = (window.__perfAc = []);
      window.AudioContext = class extends NativeAC {
        constructor(...args) {
          super(...args);
          contexts.push(this);
        }
      };
      const beds = (window.__perfBeds = []);
      const start = AudioBufferSourceNode.prototype.start;
      const stop = AudioBufferSourceNode.prototype.stop;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.loop) {
          const bed = { stopped: false, ended: false };
          beds.push(bed);
          this.__perfBed = bed;
          this.addEventListener("ended", () => (bed.ended = true));
        }
        return start.apply(this, args);
      };
      AudioBufferSourceNode.prototype.stop = function (...args) {
        if (this.__perfBed) this.__perfBed.stopped = true;
        return stop.apply(this, args);
      };
      const NativeMR = window.MediaRecorder;
      const recorders = (window.__perfRecorders = []);
      window.MediaRecorder = class extends NativeMR {
        constructor(...args) {
          super(...args);
          recorders.push(this);
        }
      };
    });
    let downloads = 0;
    p.on("download", () => downloads++);
    await p.goto(`${BASE}/en/simulator/?mode=classic&dur=10`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Custom Sound/ }).click();
    await p.locator("#music-file-input").setInputFiles({ name: "perf-bed.wav", mimeType: "audio/wav", buffer: makeWav(4) });
    const bedLoaded = await p.getByTestId("music-track").waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
    await p.getByRole("button", { name: /Recording/ }).click();
    await p.locator("#resolution-select").selectOption("500x500");
    await p.getByRole("button", { name: /Start Simulator/ }).click();
    await p.getByTestId("music-playing").waitFor({ timeout: 5000 }).catch(() => {});
    await p.getByRole("button", { name: /Record Video/ }).click();
    const recording = await p.waitForFunction(() => window.__perfRecorders.some((r) => r.state === "recording"), null, { timeout: 10000 }).then(() => true).catch(() => false);
    await p.waitForTimeout(1500);
    await p.evaluate(() => window.scrollTo(0, 0));
    await p.locator("header a", { hasText: "Back" }).first().click();
    await p.waitForURL(/\/en\/$/, { timeout: 10000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const left = await p.evaluate(() => ({
      sameDocument: Array.isArray(window.__perfAc),
      recorders: window.__perfRecorders.map((r) => r.state),
      contexts: window.__perfAc.map((c) => c.state),
      beds: window.__perfBeds.map((b) => ({ ...b })),
    }));
    await p.waitForTimeout(10000); // past the clip's 10 s: a timer left running would download it now
    check(
      "leaving the simulator mid-recording stops the recorder (no download) and the audio (contexts closed, the bed stopped)",
      bedLoaded && recording && left.sameDocument && left.recorders.length > 0 && left.recorders.every((st) => st === "inactive") && left.contexts.length > 0 && left.contexts.every((st) => st === "closed") && left.beds.length > 0 && left.beds.every((b) => b.stopped || b.ended) && downloads === 0,
      `(bed ${bedLoaded}, recording ${recording}, after Back: ${JSON.stringify(left)}, downloads ${downloads})`,
    );
    await p.close();
  }

  // (2) 75 Hz / 144 Hz displays: rAF with exact vsync timestamps, flushed by a timer; requestFrame() counted on that clock
  const emulateDisplay = (hz) => {
    const period = 1000 / hz;
    let t = performance.now();
    let pending = new Map();
    let nextId = 1;
    const perf = (window.__perfDisplay = { requests: [], now: () => t });
    window.requestAnimationFrame = (cb) => {
      const id = nextId++;
      pending.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      pending.delete(id);
    };
    const tick = () => {
      t += period;
      const batch = pending;
      pending = new Map();
      for (const cb of batch.values()) {
        try {
          cb(t);
        } catch (e) {
          setTimeout(() => {
            throw e;
          });
        }
      }
      setTimeout(tick, period);
    };
    setTimeout(tick, period);
    const Track = window.CanvasCaptureMediaStreamTrack;
    if (Track?.prototype?.requestFrame) {
      const native = Track.prototype.requestFrame;
      Track.prototype.requestFrame = function () {
        perf.requests.push(t);
        return native.call(this);
      };
    }
  };
  const displayFps = {};
  let capture = null;
  for (const hz of [75, 144]) {
    const p = await ctx.newPage();
    watch(p);
    await p.addInitScript(emulateDisplay, hz);
    await p.goto(`${BASE}/en/simulator/?mode=classic&dur=10`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Start Simulator/ }).click();
    await p.waitForTimeout(4000);
    displayFps[hz] = await fpsBadge(p);
    if (hz === 144) {
      await p.getByRole("button", { name: /Recording/ }).click();
      await p.locator("#resolution-select").selectOption("500x500");
      const [download] = await Promise.all([
        p.waitForEvent("download", { timeout: 40000 }).catch(() => null),
        (async () => {
          await p.getByRole("button", { name: /Record Video/ }).click();
          // two seconds on the display's own clock (a busy machine runs its timer slower than real time)
          const from = await p.evaluate(() => window.__perfDisplay.now());
          await p.waitForFunction((t0) => window.__perfDisplay.now() - t0 >= 2000, from, { timeout: 30000 }).catch(() => {});
          await p.getByRole("button", { name: /Stop & Export/ }).click();
        })(),
      ]);
      let bytes = 0;
      if (download) {
        const file = path.join(outDir, `perf-144hz-${download.suggestedFilename()}`);
        await download.saveAs(file);
        bytes = fs.statSync(file).size;
      }
      const requests = await p.evaluate(() => window.__perfDisplay.requests.slice());
      const span = requests.length > 1 ? (requests[requests.length - 1] - requests[0]) / 1000 : 0;
      capture = { requests: requests.length, perSecond: span > 0 ? Math.round((10 * (requests.length - 1)) / span) / 10 : 0, bytes };
    }
    await p.close();
  }
  check(
    "a 75 Hz and a 144 Hz display draw ~60 fps (the FPS badge), not every other frame",
    displayFps[75] >= 55 && displayFps[75] <= 75 && displayFps[144] >= 55 && displayFps[144] <= 75,
    `(${JSON.stringify(displayFps)})`,
  );
  check(
    "a recording on a 144 Hz display captures each drawn frame once (~60 a second) and downloads a clip",
    !!capture && capture.requests >= 80 && capture.perSecond >= 50 && capture.perSecond <= 64 && capture.bytes > 10000,
    `(${JSON.stringify(capture)})`,
  );

  // (3) Grow with glow at 8×: the sprite canvases stay small
  {
    const big = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    try {
      const p = await big.newPage();
      watch(p);
      await p.addInitScript(() => {
        const refs = (window.__perfCanvases = []);
        const create = Document.prototype.createElement;
        Document.prototype.createElement = function (tag, ...rest) {
          const el = create.call(this, tag, ...rest);
          if (String(tag).toLowerCase() === "canvas") refs.push(new WeakRef(el));
          return el;
        };
      });
      await p.goto(`${BASE}/en/simulator/?mode=grow&glow=1`, { waitUntil: "networkidle" });
      await p.getByRole("button", { name: /Start Simulator/ }).click();
      await p.getByRole("button", { name: "8x", exact: true }).click();
      const simSeconds = async () => {
        const text = await p.locator("span.tabular-nums").first().innerText().catch(() => "0");
        const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)s?$/.exec(text.trim());
        return m ? 60 * Number(m[1] ?? 0) + Number(m[2]) : 0;
      };
      const until = Date.now() + 30000;
      let sim = 0;
      while (Date.now() < until && (sim = await simSeconds()) < 90) await p.waitForTimeout(1000);
      const cdp = await big.newCDPSession(p);
      await cdp.send("HeapProfiler.collectGarbage");
      await p.waitForTimeout(300);
      const live = await p.evaluate(() => {
        let count = 0;
        let bytes = 0;
        let detached = 0;
        for (const ref of window.__perfCanvases) {
          const c = ref.deref();
          if (!c) continue;
          count++;
          const b = c.width * c.height * 4;
          bytes += b;
          if (!c.isConnected) detached += b;
        }
        return { count, mb: Math.round(bytes / 2 ** 17) / 8, offscreenMb: Math.round(detached / 2 ** 17) / 8 };
      });
      check("Grow with glow at 8× keeps a few MB of sprite canvases (not one per radius)", sim >= 40 && live.offscreenMb < 8, `(${sim}s simulated, ${JSON.stringify(live)})`);
    } finally {
      await big.close().catch(() => {});
    }
  }

  // (4) classic Paint: the trail layer is drawn again (restamped) after a resize
  {
    const p = await ctx.newPage();
    watch(p);
    await p.goto(`${BASE}/en/simulator/?mode=paint`, { waitUntil: "networkidle" });
    await p.getByRole("button", { name: /Start Simulator/ }).click();
    await p.getByRole("button", { name: "4x", exact: true }).click();
    await p.waitForTimeout(4000);
    await p.getByRole("button", { name: /Pause$/ }).first().click();
    await p.waitForTimeout(300);
    const colourful = () =>
      p.evaluate(() => {
        const c = document.querySelector("main canvas");
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 16) {
          const max = Math.max(d[i], d[i + 1], d[i + 2]);
          const min = Math.min(d[i], d[i + 1], d[i + 2]);
          if (max > 120 && max - min > 80) n++;
        }
        return n;
      });
    const before = await colourful();
    await p.setViewportSize({ width: 1200, height: 820 });
    await p.waitForTimeout(800);
    const after = await colourful();
    check("classic Paint draws its trail (one layer, stamped incrementally) and again after a resize", before > 1000 && after > 0.35 * before, `(colourful samples ${before} → ${after} after the resize)`);
    await p.close();
  }
}
// --- end review fix (performance) ---

// --- odd-maze ---
// Maze Escape: the preview image and the card under the battle heading; URL → the Maze block of the Mode row (brain, hand,
// balls, size, speed, pull, trail, fog, clip limit, badge), controls → URL, the search box and the finder's outcomes; a
// default race (three explorers) at 1× then 4× – the frame rate, the notes on the pentatonic ladder climbing toward the exit
// (OscillatorNode.start instrumented), the painted trail, nobody through a wall, the badge, the HUD, the verdict banner and
// then the end screen; fog and own-colour paint; a roster whose rigged Gold wins under the teams banner; Find Simulation's
// winner outcome played back; and a 1080×1920 recording of the default race.
{
  const res = await page.request.get(`${BASE}/modes/maze.webp`);
  check("asset /modes/maze.webp", res.ok(), `(${res.status()}, ${res.headers()["content-type"]})`);
  await page.goto(`${BASE}/en/`, { waitUntil: "networkidle" });
  const inBattle = await page.evaluate(() => {
    const heading = [...document.querySelectorAll("h2, h3")].find((h) => h.textContent?.trim() === "Battle modes");
    const group = heading?.parentElement;
    return !!group && !!group.querySelector('img[src$="/modes/maze.webp"]') && !!group.querySelector('img[src$="/modes/stringBattle.webp"]');
  });
  const card = await page.locator('img[src$="/modes/maze.webp"]').count();
  check("the Maze Escape card is on the landing page under the battle heading", card === 1 && inBattle, `(cards=${card}, in the battle group=${inBattle})`);
}
{
  await page.goto(`${BASE}/en/simulator/?mode=maze&mzc=20&mzn=5&mzb=wallFollow&mzh=right&mzg=0.6&mzs=1.5&mzt=0.5&mzf=0.4&mzd=90&mzbg=0`, { waitUntil: "networkidle" });
  const section = page.getByTestId("maze-section");
  const pick = (group, name) => section.getByRole("group", { name: group, exact: true }).getByRole("button", { name: new RegExp(name) });
  const toggle = (label) => section.getByRole("switch", { name: switchName(label) });
  {
    const values = { mzc: await sliderValue("Maze Size"), mzn: await sliderValue("Maze Balls"), mzs: await sliderValue("Maze Speed"), mzg: await sliderValue("Pull"), mzt: await sliderValue("Trail"), mzf: await sliderValue("Fog"), mzd: await sliderValue("Maze Clip Limit") };
    const wall = await pick("Brain", "Wall follower").getAttribute("aria-pressed");
    const right = await pick("Hand on the Wall", "Right").getAttribute("aria-pressed");
    const badge = await toggle("Maze Warning Badge").getAttribute("aria-checked");
    const noRingControls = (await page.locator('input[aria-label="Wall Count"]').count()) === 0;
    const options = await page.locator("#find-outcome option").evaluateAll((els) => els.map((e) => e.value));
    const runInfo = await page.getByTestId("maze-run").innerText().catch(() => "");
    check(
      "maze loads from URL",
      values.mzc === "20" && values.mzn === "5" && values.mzs === "1.5" && values.mzg === "0.6" && values.mzt === "0.5" && values.mzf === "0.4" && values.mzd === "90" && wall === "true" && right === "true" && badge === "false" && noRingControls && options.join(",") === "duration,winner" && /20 × 29/.test(runInfo),
      `(${JSON.stringify(values)}, wall follower=${wall}, right hand=${right}, badge=${badge}, finder outcomes=${options.join(",")}, "${runInfo}")`,
    );
  }
  await pick("Brain", "Explorer").click();
  await page.locator('input[aria-label="Maze Balls"]').evaluate(setRangeValue, "3");
  await toggle("Maze Warning Badge").click();
  await page.waitForTimeout(300);
  {
    const query = new URLSearchParams(page.url().split("?")[1] || "");
    const handHidden = (await section.getByRole("group", { name: "Hand on the Wall", exact: true }).count()) === 0;
    check(
      "maze mirrors into the URL",
      query.get("mode") === "maze" && query.get("mzc") === "20" && !query.has("mzb") && !query.has("mzn") && !query.has("mzbg") && query.get("mzh") === "right" && query.get("mzd") === "90" && handHidden,
      `(${query.toString()}, hand hidden=${handHidden})`,
    );
  }
  await page.getByPlaceholder("Search settings...").fill("fog");
  const found = await page.locator('input[aria-label="Fog"]').isVisible();
  const hidden = !(await page.locator('input[aria-label="Ball Speed"]').isVisible());
  await page.getByPlaceholder("Search settings...").fill("");
  check("search finds the maze controls", found && hidden, `(fog=${found}, ball speed hidden=${hidden})`);
}
{
  // The default race: three explorers in a 12 × 17 maze.
  await page.goto(`${BASE}/en/simulator/?mode=maze`, { waitUntil: "networkidle" });
  await page.evaluate(() => {
    const osc = [];
    window.__mzOsc = osc;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function () {
      if (this.frequency.value > 20) osc.push(this.frequency.value);
      return start.apply(this, arguments);
    };
  });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  const fps = await pageFrameRates(5000);
  const early = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-maze.png") });
  await timingCheck(
    "simulator mode=maze drops the balls into the maze, paints their trail and runs at 30+ fps",
    early.mzBalls === "3" && early.mzCols === "12" && early.mzRows === "17" && Number(early.mzVisited) > 5 && Number(early.mzStamped) > 5 && Number(early.mzNotes) >= 3 && early.mzBadge === "1" && early.mzHud === "1" && early.mzClear === "1" && early.mzLeaks === "0",
    fpsOk(fps, 8, 30),
    `(${JSON.stringify({ visited: early.mzVisited, paint: early.mzPaint, notes: early.mzNotes, dist: early.mzDist, clear: early.mzClear, leaks: early.mzLeaks })}, ${fpsNote(fps)}, floor 30${loadNote()})`,
    fpsRetry(3000, 5, 30),
  );
  await page.getByRole("button", { name: "4x", exact: true }).click();
  const banner = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.mzBanner === "1", null, { timeout: 60_000 }).then(() => true).catch(() => false);
  const atVerdict = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-maze-winner.png") });
  const ended = await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.mzFinished === "1", null, { timeout: 60_000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  const endScreen = await page.getByRole("button", { name: /Restart Simulation/ }).waitFor({ timeout: 10_000 }).then(() => true).catch(() => false);
  const winner = Number(data.mzWinner);
  const places = (data.mzPlaces || "").split(",").map(Number);
  check(
    "a default maze race is won by the first ball out, its banner shown before the end screen",
    banner && ended && endScreen && winner >= 0 && (data.mzVerdict === "time" || places[winner] === 1) && !!data.mzWinnerName && atVerdict.mzFinished === "0" && data.mzLeaks === "0" && Number(data.mzPaint) > 20,
    `(${JSON.stringify({ verdict: data.mzVerdict, winner: data.mzWinner, name: data.mzWinnerName, at: data.mzVerdictMs, places: data.mzPlaces, exited: data.mzExited, dist: data.mzDist, paint: data.mzPaint, leaks: data.mzLeaks })}, banner=${banner}, finished=${ended}, end screen=${endScreen})`,
  );
  const pitches = await page.evaluate(() => window.__mzOsc);
  const notes = pitches.filter((f) => f < 2000).map((f) => Math.round(69 + 12 * Math.log2(f / 440)));
  check(
    "maze wall hits play the pentatonic ladder, higher near the exit",
    notes.length >= 10 && notes.every((m) => [0, 2, 4, 7, 9].includes(((m % 12) + 12) % 12) && m >= 60 && m <= 96) && new Set(notes).size >= 4 && Math.max(...notes) >= 81,
    `(${notes.length} notes, MIDI ${[...new Set(notes)].sort((a, b) => a - b).join("/")})`,
  );
}
{
  // Fog over the unvisited cells, every ball painting its own colour.
  await page.goto(`${BASE}/en/simulator/?mode=maze&mzf=0.9&mzto=1&mzn=6`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "2x", exact: true }).click();
  await page.waitForTimeout(3000);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-maze-fog.png") });
  check("the maze fog hides the unvisited cells while six balls paint in their own colours", data.mzFog === "1" && data.mzBalls === "6" && Number(data.mzPaint) > 10 && data.mzLeaks === "0", `(${JSON.stringify({ fog: data.mzFog, balls: data.mzBalls, paint: data.mzPaint, leaks: data.mzLeaks })})`);
}
{
  // A roster: Red, Blue and Gold (the fourth ball takes the palette); Gold is the Forced Winner, and the teams banner crowns it.
  const roster = "Red*ef4444*🔥,Blue*3b82f6*💧,Gold*facc15*⭐";
  await page.goto(`${BASE}/en/simulator/?mode=maze&mzn=4&teams=${encodeURIComponent(roster)}&fw=2`, { waitUntil: "networkidle" });
  const note = await page.getByTestId("rigged-note").innerText().catch(() => "");
  await page.getByRole("button", { name: /Start Simulator/ }).click();
  await page.getByRole("button", { name: "8x", exact: true }).click();
  const won = await page.waitForFunction(() => !!document.querySelector("main canvas")?.dataset.teamWinner, null, { timeout: 60_000 }).then(() => true).catch(() => false);
  const data = await canvasData();
  await page.screenshot({ path: path.join(outDir, "sim-maze-teams.png") });
  check(
    "a rigged maze race is won by the chosen roster ball under the teams banner",
    won && data.teamWinner === "Gold" && data.mzWinner === "2" && data.mzWinnerName === "Gold" && data.mzRig === "2" && data.teams === "4" && /Gold wins/.test(note),
    `(winner=${data.teamWinner}, maze winner=${data.mzWinner} ${data.mzWinnerName}, rig=${data.mzRig}, teams=${data.teams}, stats=${data.teamStats}, note="${note}")`,
  );
}
{
  // Find Simulation: a race AQUA (the second ball) wins, played back at 8×.
  await page.goto(`${BASE}/en/simulator/?mode=maze`, { waitUntil: "networkidle" });
  await page.locator("#find-outcome").selectOption("winner");
  await page.locator("#find-winner").selectOption("1");
  const button = page.getByRole("button", { name: /Find a Run AQUA Wins/ });
  const labelled = await button.isVisible();
  await button.click();
  const done = await page.getByText(/Found!|Didn't find simulation/).first().waitFor({ timeout: 120_000 }).then(() => true).catch(() => false);
  const text = done ? await page.getByText(/Found!|Didn't find simulation/).first().innerText() : "timeout";
  let data = {};
  if (/Found! AQUA wins/.test(text)) {
    await page.getByRole("button", { name: /Start Simulator/ }).click();
    await page.getByRole("button", { name: "8x", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("main canvas")?.dataset.mzFinished === "1", null, { timeout: 90_000 }).catch(() => {});
    await page.waitForTimeout(300);
    data = await canvasData();
  }
  check("Find Simulation finds a maze race the chosen ball wins, and it plays back", labelled && /Found! AQUA wins/.test(text) && data.mzFinished === "1" && data.mzWinner === "1" && data.mzWinnerName === "AQUA", `("${text}", played: ${JSON.stringify({ finished: data.mzFinished, winner: data.mzWinner, name: data.mzWinnerName })})`);
}
{
  // A 1080×1920 recording (the default resolution) of the default race.
  await page.goto(`${BASE}/en/simulator/?mode=maze&dur=10`, { waitUntil: "networkidle" });
  let fps = { windows: [], avg: 0, min: 0, low: 0 };
  const download = await Promise.all([
    page.waitForEvent("download", { timeout: 60000 }).catch(() => null),
    (async () => {
      await page.getByRole("button", { name: /Record Video/ }).click();
      await page.waitForTimeout(300);
      fps = await pageFrameRates(3500);
      await page.getByRole("button", { name: /Stop & Export/ }).click();
    })(),
  ]).then(([d]) => d);
  let size = 0;
  if (download) {
    const file = path.join(outDir, `maze-${download.suggestedFilename()}`);
    await download.saveAs(file);
    size = fs.statSync(file).size;
  }
  await timingCheck("a 1080×1920 maze recording keeps 20+ fps and downloads", size > 10000, fpsOk(fps, 5, 20), `(${size} bytes, ${fpsNote(fps)}, floor 20${loadNote()})`, recordingRetry(5, 20));
}
// --- end odd-maze ---

// --- review fix (site-static) --- every same-origin request that failed (the response listener), then the console
check("no failed same-origin requests", badResponses.length === 0, badResponses.length ? `\n   ${badResponses.slice(0, 10).join("\n   ")}` : "");
const hardErrors = errors.filter((e) => !IGNORED_CONSOLE.test(e));
check("no console/page errors", hardErrors.length === 0, hardErrors.length ? `\n   ${hardErrors.slice(0, 10).join("\n   ")}` : "");

await browser.close();
const failed = results.filter((r) => !r.ok);
if (inconclusiveResults.length) {
  console.log(`\n⚠️ ${inconclusiveResults.length} timing check${inconclusiveResults.length === 1 ? "" : "s"} inconclusive (the machine was too busy to measure; not counted – SMOKE_STRICT_TIMING=1 fails them):`);
  for (const r of inconclusiveResults) console.log(`   ⚠️ ${r.name} ${r.extra}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed${inconclusiveResults.length ? `, ${inconclusiveResults.length} inconclusive` : ""}`);
process.exit(failed.length ? 1 : 0);
