/**
 * --- agent-cli --- The browser tools: preview, render and site-shot look at the real site – the local export of the working
 * tree (local-build.mjs) – in headless Chromium (Playwright, a dev dependency; the browser it finds: PLAYWRIGHT_BROWSERS_PATH
 * or its own cache, or CHROME_PATH – this CLI never downloads one).
 *
 *  - The export is served by a small static server on 127.0.0.1 and a free port, for the length of one call.
 *  - The browser is fenced to it: every request to another origin is aborted, service workers are blocked, so the page can
 *    reach nothing but the export (no font CDN, no statistics script, no update check).
 *  - No licence is installed: the page treats the browser as a free visitor, so the still camera stamps its pictures and the
 *    fast export seals its clips with the watermark, exactly as for anyone without Pro (the committed TEST licence stays
 *    inside the smoke harness). A picture or a clip the page reports as not watermarked is refused, never written.
 *  - Files go to .agent-out/<tool>/<name>/ only (paths.mjs outputDir), each written under a fresh name and renamed into place
 *    (paths.mjs writeFileSafe), so a symbolic link at the target is replaced, never written through.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { spawnSync } from "child_process";
import { ensureLocalExport } from "./local-build.mjs";
import { defaultOutName, freshSibling, outputDir, repoRelative, writeFileSafe } from "./paths.mjs";
import { resolveFfmpeg } from "./analyse.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".mid": "audio/midi",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
};

/** Serves `dir` on 127.0.0.1 (a free port) like the static host: dir/ → index.html, /foo → foo.html, else 404.html. */
export function startStaticServer(dir) {
  const root = path.resolve(dir);
  const send = (res, status, file) => {
    res.writeHead(status, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  };
  const server = http.createServer((req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
      if (/[\0-\x1f]/.test(pathname)) pathname = "/__none__";
      const file = path.resolve(root, `.${pathname}`);
      const inside = file === root || file.startsWith(root + path.sep);
      const stat = inside && fs.existsSync(file) ? fs.statSync(file) : null;
      if (stat?.isDirectory()) {
        if (!pathname.endsWith("/")) {
          res.writeHead(301, { Location: `${pathname}/` });
          return res.end();
        }
        const index = path.join(file, "index.html");
        if (fs.existsSync(index)) return send(res, 200, index);
      } else if (stat?.isFile()) return send(res, 200, file);
      else if (inside && fs.existsSync(`${file}.html`)) return send(res, 200, `${file}.html`);
      const missing = path.join(root, "404.html");
      if (fs.existsSync(missing)) return send(res, 404, missing);
      res.writeHead(404);
      res.end();
    } catch {
      res.writeHead(500);
      res.end();
    }
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

async function playwright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright is not installed – run `npm install` (it comes with the dev dependencies).");
  }
}

/**
 * Opens a browser fenced to `origin` and runs `fn(context)`; always closes the browser. `blocked` collects every request
 * the fence stopped (origin + path), so a page that tries to reach out is reported.
 */
export async function withFencedBrowser(origin, fn, viewport = { width: 1400, height: 900 }) {
  const { chromium } = await playwright();
  const launch = { args: ["--autoplay-policy=no-user-gesture-required"] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  let browser;
  try {
    browser = await chromium.launch(launch);
  } catch (e) {
    throw new Error(`Chromium could not start (${String(e.message).split("\n")[0]}). Point PLAYWRIGHT_BROWSERS_PATH or CHROME_PATH at an installed Chromium – this CLI never downloads one.`);
  }
  const blocked = new Set();
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block", acceptDownloads: false });
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith(`${origin}/`) || url === origin || url.startsWith("data:") || url.startsWith("blob:")) return route.continue();
      try {
        const u = new URL(url);
        blocked.add(`${u.origin}${u.pathname}`.slice(0, 200));
      } catch {
        blocked.add(url.slice(0, 200));
      }
      return route.abort("blockedbyclient");
    });
    return await fn(context, blocked);
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Collects the page's errors (page errors, console errors, failed same-origin requests) for the result. */
function watchErrors(page, origin) {
  const errors = [];
  const add = (e) => {
    if (errors.length < 20) errors.push(String(e).slice(0, 300));
  };
  page.on("pageerror", (e) => add(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/blockedbyclient|ERR_BLOCKED_BY_CLIENT/i.test(m.text())) add(`console: ${m.text()}`);
  });
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(origin) && !/aborted|blockedbyclient/i.test(r.failure()?.errorText ?? "")) add(`request failed: ${r.url().slice(origin.length)} (${r.failure()?.errorText})`);
  });
  return errors;
}

/** The local export (built when stale), served for the length of `fn(origin, site)`. */
async function withLocalSite(build, fn) {
  let site;
  try {
    site = await ensureLocalExport(build ?? "auto");
  } catch (e) {
    throw new Error(`This tool needs a built export of the site, and the local build failed: ${e.message}`);
  }
  const server = await startStaticServer(site.dir);
  try {
    return await fn(server.origin, { key: site.key, head: site.head.slice(0, 12), dirty: site.dirty, rebuilt: site.rebuilt });
  } finally {
    await server.close();
  }
}

const writeDataUrl = (file, dataUrl) => {
  const buf = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  writeFileSafe(file, buf);
  return buf.length;
};

/** Opens the simulator on `query` and waits for its still camera (and its bot handle). */
async function openSimulator(page, origin, query) {
  const url = `${origin}/en/simulator/?${query}`;
  const res = await page.goto(url, { waitUntil: "networkidle", timeout: 120_000 });
  if (!res || !res.ok()) throw new Error(`The local export answered ${res ? res.status() : "nothing"} for /en/simulator/`);
  await page.waitForFunction(() => !!window.__jumpingBallsStill?.ready() && !!window.__jumpingBallsBot, null, { timeout: 60_000 }).catch(() => {
    throw new Error("The simulator page did not get ready (no window.__jumpingBallsStill / __jumpingBallsBot) – see the page errors");
  });
}

/* ------------------------------------------------------------------ preview */

export async function previewTool(tb, args) {
  const run = await tb.resolveRun(args);
  if (!run.ok) throw new Error(run.error);
  const times = args.times ?? [1, 3, 5];
  const size = args.size ?? 320;
  const dir = outputDir("preview", args.out ?? defaultOutName(`${run.mode}-${run.seed}`, { ...args, build: undefined }));
  return withLocalSite(args.build, (origin, build) =>
    withFencedBrowser(origin, async (context, blocked) => {
      const page = await context.newPage();
      const errors = watchErrors(page, origin);
      await openSimulator(page, origin, run.query);
      const shot = await page.evaluate((r) => window.__jumpingBallsStill.capture(r), { times, camera: args.camera, size, format: "png", seed: run.seed });
      if (shot.mode !== run.mode) throw new Error(`The page opened ${shot.mode}, not ${run.mode}`);
      // --- watermark-everywhere --- an agent's picture is a free visitor's: never a clean one
      if (!shot.watermarked) throw new Error("The page handed back pictures without the watermark: agent previews must carry it (is a licence stored in this browser?) – nothing written");
      const sheet = await page.evaluate(
        async ({ frames, size }) => {
          const images = [];
          for (const f of frames) {
            const img = new Image();
            img.src = f.dataUrl;
            await img.decode();
            images.push(img);
          }
          const cols = Math.min(4, images.length);
          const rows = Math.ceil(images.length / cols);
          const label = 22;
          const canvas = document.createElement("canvas");
          canvas.width = cols * size;
          canvas.height = rows * (size + label);
          const g = canvas.getContext("2d");
          g.fillStyle = "#111";
          g.fillRect(0, 0, canvas.width, canvas.height);
          images.forEach((img, i) => {
            const x = (i % cols) * size;
            const y = Math.floor(i / cols) * (size + label);
            g.drawImage(img, x, y + label, size, size);
            g.fillStyle = "#e5e5e5";
            g.font = "14px monospace";
            g.fillText(`${frames[i].sec}s${frames[i].finished ? " (over)" : ""}`, x + 6, y + 16);
          });
          return canvas.toDataURL("image/png");
        },
        { frames: shot.frames.map((f) => ({ dataUrl: f.dataUrl, sec: f.sec, finished: f.finished })), size },
      );
      const sheetFile = path.join(dir, "sheet.png");
      const bytes = writeDataUrl(sheetFile, sheet);
      return {
        sheet: repoRelative(sheetFile),
        bytes,
        mode: shot.mode,
        seed: shot.seed,
        world: shot.world,
        frames: shot.frames.map((f) => ({ sec: f.sec, finished: f.finished })),
        watermarked: shot.watermarked,
        link: `?${run.query}`,
        build,
        pageErrors: errors,
        blockedRequests: [...blocked],
      };
    }),
  );
}

/* ------------------------------------------------------------------ render */

/** ffmpeg arguments that turn a WebM clip into an H.264 + AAC MP4 (the picture – watermark included – re-encoded as it is). */
export function mp4Args(src, dst) {
  return ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", dst];
}

export async function renderTool(tb, args) {
  const run = await tb.resolveRun(args);
  if (!run.ok) throw new Error(run.error);
  const seconds = args.seconds ?? 10;
  const dir = outputDir("render", args.out ?? defaultOutName(`${run.mode}-${run.seed}`, { ...args, build: undefined }));
  return withLocalSite(args.build, (origin, build) =>
    withFencedBrowser(origin, async (context, blocked) => {
      const page = await context.newPage();
      const errors = watchErrors(page, origin);
      await openSimulator(page, origin, run.query);
      const handle = await page.evaluate(() => ({ version: window.__jumpingBallsBot?.version ?? 0, renderLink: typeof window.__jumpingBallsBot?.renderLink === "function", webCodecs: typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" }));
      if (!handle.renderLink) throw new Error(`This export's bot handle is version ${handle.version}, without renderLink (version 2): rebuild the export from this checkout ({"build":"force"})`);
      if (!handle.webCodecs) throw new Error("This Chromium has no WebCodecs: the fast export cannot render. Use a recent Chromium (CHROME_PATH).");
      const out = await page.evaluate(
        async ({ link, seconds }) => {
          const r = await window.__jumpingBallsBot.renderLink(link, { seconds });
          if (r.status !== "done") return r;
          const bytes = new Uint8Array(await r.blob.arrayBuffer());
          let binary = "";
          for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
          return { ...r, blob: undefined, base64: btoa(binary), bytes: bytes.length };
        },
        { link: `?${run.query}`, seconds },
      );
      if (out.status !== "done") throw new Error(`The page did not render the link (${out.error})`);
      const result = out.result ?? {};
      // --- free-watermark --- an agent's clip is a free render: never a clean one
      if (result.watermarked !== true) throw new Error("The page rendered the clip without the watermark: agent renders must carry it (is a licence stored in this browser?) – nothing written");
      const ext = result.format?.extension ?? (path.extname(out.file).slice(1) || "webm");
      const clip = path.join(dir, `clip.${ext}`);
      writeFileSafe(clip, Buffer.from(out.base64, "base64"));
      let mp4 = ext === "mp4" ? clip : null;
      let mp4Note = null;
      if (!mp4 && args.mp4 !== false) {
        const ffmpeg = resolveFfmpeg();
        if (!ffmpeg) mp4Note = "The browser wrote WebM (no H.264 encoder) and no ffmpeg was found to convert it to MP4.";
        else {
          const dst = path.join(dir, "clip.mp4");
          // ffmpeg writes a fresh name (it would follow a link at clip.mp4), renamed into place once complete
          const tmp = freshSibling(dst);
          const r = spawnSync(ffmpeg.path, mp4Args(clip, tmp), { encoding: "utf8", timeout: 300_000, windowsHide: true });
          if (r.status === 0 && fs.existsSync(tmp) && fs.statSync(tmp).size > 0) {
            fs.renameSync(tmp, dst);
            mp4 = dst;
          } else {
            fs.rmSync(tmp, { force: true });
            mp4Note = `ffmpeg could not convert the clip to MP4 (${(r.stderr || r.error?.message || "").trim().split("\n").pop()})`;
          }
        }
      }
      return {
        file: repoRelative(clip),
        mp4: mp4 ? repoRelative(mp4) : null,
        ...(mp4Note ? { mp4Note } : {}),
        bytes: out.bytes,
        mode: out.mode,
        seed: out.seed,
        link: `?${run.query}`,
        durationSec: out.durationSec,
        digest: result.digest ?? null,
        watermarked: result.watermarked,
        render: { format: result.format ?? null, frames: result.frames ?? null, loopCycles: result.loopCycles ?? null, loopCycleSec: result.loopCycleSec ?? null, loudnessLufs: result.loudnessLufs ?? null, loudnessGainDb: result.loudnessGainDb ?? null },
        build,
        pageErrors: errors,
        blockedRequests: [...blocked],
      };
    }),
  );
}

/* ------------------------------------------------------------------ site-shot */

const slugOf = (page) => page.replace(/^\/+|\/+$/g, "").replace(/[^A-Za-z0-9._-]+/g, "_") || "root";

/**
 * --- agent-cli --- A screenshot's file name: the page's place in the list first (01-…), so two pages whose slugs agree
 * (`/en/` and `/en`, `/en/a_b/` and `/en/a/b/`) never write one file, and each shot keeps its own.
 * @param {number} index the page's position in `pages` (0-based)
 * @param {string} page
 * @param {number} width
 * @returns {string}
 */
export const shotFileName = (index, page, width) => `${String(index + 1).padStart(2, "0")}-${slugOf(page)}-${width}.png`;

export async function siteShotTool(_tb, args) {
  const pages = args.pages ?? ["/en/"];
  const widths = args.widths ?? [390, 1280];
  const fullPage = args.fullPage !== false;
  for (const p of pages) if (p.includes("..") || p.includes("//")) throw new Error(`Bad page path ${p}`);
  const dir = outputDir("site-shot", args.out ?? defaultOutName(slugOf(pages[0]), { ...args, build: undefined }));
  return withLocalSite(args.build, (origin, build) =>
    withFencedBrowser(origin, async (context, blocked) => {
      const shots = [];
      for (const width of widths) {
        for (const [index, p] of pages.entries()) {
          const page = await context.newPage();
          await page.setViewportSize({ width, height: width <= 480 ? 844 : 800 });
          const errors = watchErrors(page, origin);
          const res = await page.goto(`${origin}${p}`, { waitUntil: "networkidle", timeout: 120_000 });
          await page.evaluate(() => document.fonts?.ready).catch(() => {});
          const file = path.join(dir, shotFileName(index, p, width));
          writeFileSafe(file, await page.screenshot({ fullPage, animations: "disabled" }));
          const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
          shots.push({ page: p, width, status: res ? res.status() : null, file: repoRelative(file), pageSize: size, horizontalScroll: size.width > width, pageErrors: errors });
          await page.close();
        }
      }
      return { shots, build, blockedRequests: [...blocked] };
    }),
  );
}
