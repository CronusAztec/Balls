/**
 * --- viral-bot --- The viral video bot, headless: plans a day of clips after docs/virality-playbook.md, renders them with
 * the simulator's fast export in headless Chromium and writes the videos, a caption file per clip, manifest.json and
 * posting-schedule.md – and, only with --post, publishes them to Instagram as Reels through the Graph API.
 *
 *   node scripts/viral-bot.mjs --count 5 --platform reels --out bot-output [--date YYYY-MM-DD] [--family escape]
 *                              [--bucket standard] [--ending resolved] [--locale en] [--max-seeds 24] [--dry-run] [--post]
 *
 * Rendering needs the exported site served (BASE_URL, default http://localhost:3000 plus NEXT_PUBLIC_BASE_PATH; see
 * `npm start`) and Playwright's Chromium: the page plans with its own canvas size (so a planned seed plays exactly as
 * planned) and renders through its batch renderer (window.__jumpingBallsBot). --dry-run plans in Node instead – the same
 * planner, bundled from src/lib/bot with esbuild – and writes only the text files; no browser, no site needed.
 *
 * --post (never without it) needs IG_USER_ID, IG_ACCESS_TOKEN and BOT_VIDEO_BASE_URL (the public HTTPS location the
 * output folder is uploaded to, so Instagram can download the MP4s); IG_GRAPH_VERSION / IG_GRAPH_HOST are optional.
 * Without them, or when a post fails, the manual upload steps are printed instead.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { loadDotEnv } from "./dotenv.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `Usage: node scripts/viral-bot.mjs [options]

  --count N          clips to plan (1–20, default 3)
  --platform P       reels | tiktok | shorts (default reels)
  --out DIR          output folder (default bot-output)
  --date YYYY-MM-DD  the day to plan (default: today) – the same date gives the same plan
  --family F         all | escape | rhythm | battle (default all)
  --bucket B         auto | short | standard | long (default auto: the platform's)
  --ending E         auto | resolved | cliffhanger (default auto: alternating)
  --locale L         en | pl | es (captions and hashtags; default en)
  --max-seeds N      seeds searched per clip (default 24)
  --dry-run          plan only (in Node, no browser): captions, manifest.json, posting-schedule.md
  --post             publish the rendered clips to Instagram (needs IG_USER_ID, IG_ACCESS_TOKEN, BOT_VIDEO_BASE_URL)
  --post-only        publish the clips an earlier run rendered into --out (its manifest.json) – after you uploaded
                     that folder to BOT_VIDEO_BASE_URL; nothing is planned or rendered
  --help             this text

Environment: BASE_URL (the served site), CHROME_PATH (a Chromium to use), and for --post IG_USER_ID, IG_ACCESS_TOKEN,
BOT_VIDEO_BASE_URL, IG_GRAPH_VERSION, IG_GRAPH_HOST.`;

class UsageError extends Error {}

/** Parses the command line (exported for the tests). */
export function parseArgs(argv) {
  const opts = { count: 3, platform: "reels", out: "bot-output", date: null, family: "all", bucket: "auto", ending: "auto", locale: "en", maxSeeds: 24, dryRun: false, post: false, postOnly: false, help: false };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) throw new UsageError(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [name, inline] = arg.includes("=") ? [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)] : [arg, null];
    const take = () => {
      if (inline !== null) return inline;
      const v = value(i, name);
      i++;
      return v;
    };
    switch (name) {
      case "--count": {
        const n = Number(take());
        if (!Number.isInteger(n) || n < 1 || n > 20) throw new UsageError("--count must be a whole number from 1 to 20");
        opts.count = n;
        break;
      }
      case "--platform":
        opts.platform = take();
        if (!["reels", "tiktok", "shorts"].includes(opts.platform)) throw new UsageError("--platform must be reels, tiktok or shorts");
        break;
      case "--out":
        opts.out = take();
        break;
      case "--date":
        opts.date = take();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) throw new UsageError("--date must be YYYY-MM-DD");
        break;
      case "--family":
        opts.family = take();
        if (!["all", "escape", "rhythm", "battle"].includes(opts.family)) throw new UsageError("--family must be all, escape, rhythm or battle");
        break;
      case "--bucket":
        opts.bucket = take();
        if (!["auto", "short", "standard", "long"].includes(opts.bucket)) throw new UsageError("--bucket must be auto, short, standard or long");
        break;
      case "--ending":
        opts.ending = take();
        if (!["auto", "resolved", "cliffhanger"].includes(opts.ending)) throw new UsageError("--ending must be auto, resolved or cliffhanger");
        break;
      case "--locale":
        opts.locale = take();
        if (!["en", "pl", "es"].includes(opts.locale)) throw new UsageError("--locale must be en, pl or es");
        break;
      case "--max-seeds": {
        const n = Number(take());
        if (!Number.isInteger(n) || n < 1 || n > 500) throw new UsageError("--max-seeds must be a whole number from 1 to 500");
        opts.maxSeeds = n;
        break;
      }
      case "--dry-run":
        opts.dryRun = true;
        break;
      case "--post":
        opts.post = true;
        break;
      case "--post-only":
        opts.postOnly = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      default:
        throw new UsageError(`Unknown option ${arg}`);
    }
  }
  if (opts.dryRun && (opts.post || opts.postOnly)) throw new UsageError("--dry-run renders nothing, so there is nothing to post");
  if (opts.post && opts.postOnly) throw new UsageError("--post renders and posts; --post-only posts what was rendered – pick one");
  return opts;
}

/** Today in the local calendar ("YYYY-MM-DD"). */
function today() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Bundles src/lib/bot/node.ts for Node with esbuild (a vitest dependency) and imports it. */
async function loadPlanner() {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch {
    throw new Error("esbuild is not installed – run `npm install` (it comes with the dev dependencies).");
  }
  const outfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "viral-bot-")), "planner.mjs");
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src/lib/bot/node.ts")],
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

const readCopy = (locale) => JSON.parse(fs.readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8")).ViralBot;

function writeTextFiles(out, files) {
  for (const f of files) fs.writeFileSync(path.join(out, f.name), f.text);
}

function printPlan(plans) {
  for (const p of plans) {
    const payoff = p.payoff.atSec === null ? "–" : `${p.payoff.atSec.toFixed(1)} s`;
    console.log(`  ${p.episodeCode}  ${p.recipe.padEnd(18)} ${p.mode.padEnd(13)} seed ${String(p.seed).padEnd(11)} ${p.timing.clipSec.toFixed(1).padStart(5)} s  payoff ${payoff.padEnd(7)} ${p.ending.padEnd(11)} score ${p.score}${p.timing.found ? "" : " (closest)"}  “${p.hook}”`);
  }
}

function manualSteps(copy) {
  return `${copy.manual?.title ?? "Posting by hand"}: ${copy.manual?.steps ?? ""}`;
}

async function renderInBrowser(opts, out) {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    throw new Error("Playwright is not installed – run `npm install` and `npx playwright install chromium`.");
  }
  const base = (process.env.BASE_URL || `http://localhost:3000${process.env.NEXT_PUBLIC_BASE_PATH || ""}`).replace(/\/+$/, "");
  const launch = { args: ["--autoplay-policy=no-user-gesture-required"] };
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  const browser = await chromium.launch(launch);
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
    const page = await context.newPage();
    page.on("pageerror", (e) => console.warn(`  page error: ${e.message}`));
    const url = `${base}/${opts.locale}/simulator/`;
    const res = await page.goto(url, { waitUntil: "networkidle" }).catch((e) => {
      throw new Error(`Cannot open ${url} (${e.message}). Build the site and serve it first: npm run build && npm start (or set BASE_URL).`);
    });
    if (!res || !res.ok()) throw new Error(`${url} answered ${res ? res.status() : "nothing"} – is the exported site served there (BASE_URL)?`);
    await page.waitForFunction(() => !!window.__jumpingBallsBot, null, { timeout: 30000 }).catch(() => {
      throw new Error("The simulator page has no viral bot (window.__jumpingBallsBot) – is this build up to date?");
    });
    const webCodecs = await page.evaluate(() => typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined");
    if (!webCodecs) throw new Error("This Chromium has no WebCodecs: the fast export cannot render. Use a recent Chromium (CHROME_PATH).");
    console.log(`Planning in the page (${url}, world ${JSON.stringify(await page.evaluate(() => window.__jumpingBallsBot.world()))})…`);
    const request = { date: opts.date, platform: opts.platform, count: opts.count, family: opts.family, bucket: opts.bucket, ending: opts.ending, maxSeeds: opts.maxSeeds };
    const plans = await page.evaluate((r) => window.__jumpingBallsBot.plan(r), request);
    if (!plans.length) throw new Error("The page planned no clips.");
    printPlan(plans);
    // Every clip downloads on its own as it is done: save each under its planned name.
    const saving = [];
    page.on("download", (d) => {
      const name = path.basename(d.suggestedFilename());
      saving.push(d.saveAs(path.join(out, name)).then(() => console.log(`  ✓ ${name}`)));
    });
    console.log(`Rendering ${plans.length} clip${plans.length === 1 ? "" : "s"} (fast export, ${plans[0].settings.recordingResolution} at ${plans[0].settings.fastExportFps} fps)…`);
    const rendered = await page.evaluate(() => window.__jumpingBallsBot.render({ download: "each" }));
    await Promise.all(saving);
    writeTextFiles(out, await page.evaluate(() => window.__jumpingBallsBot.textFiles()));
    return { plans, rendered };
  } finally {
    await browser.close();
  }
}

/** Posts `clips` ({ id, file, caption }) as Reels; false when anything was not posted. */
async function postToInstagram(planner, clips, copy) {
  const { config, videoBaseUrl, missing } = planner.instagramConfigFromEnv(process.env);
  if (!config || !videoBaseUrl) {
    console.error(`\nPosting needs ${missing.join(", ")} (see the README, "Viral video bot"). Nothing was posted.`);
    console.error(manualSteps(copy));
    return false;
  }
  let ok = true;
  for (const clip of clips) {
    if (!clip.file) {
      console.warn(`  – ${clip.id}: not rendered, not posted`);
      ok = false;
      continue;
    }
    if (!clip.file.endsWith(".mp4")) {
      console.warn(`  – ${clip.file}: Instagram takes MP4 (H.264 + AAC); this browser rendered WebM. Convert it and post by hand.`);
      ok = false;
      continue;
    }
    const videoUrl = planner.publicVideoUrl(videoBaseUrl, clip.file);
    console.log(`  → ${clip.file} (${videoUrl})`);
    try {
      const result = await planner.publishReel((u, init) => fetch(u, init), config, { videoUrl, caption: clip.caption }, { onStatus: (status, poll) => console.log(`    status ${status || "…"} (${poll})`) });
      console.log(`    published: media ${result.mediaId}${result.permalink ? ` – ${result.permalink}` : ""}`);
    } catch (err) {
      ok = false;
      const step = err && err.step ? ` at the ${err.step} step` : "";
      console.error(`    failed${step}: ${planner.redact(err instanceof Error ? err.message : String(err), config.accessToken)}`);
      console.error(`    ${manualSteps(copy)}`);
    }
  }
  return ok;
}

export async function main(argv = process.argv.slice(2)) {
  loadDotEnv(ROOT);
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    throw err;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  opts.date = opts.date ?? today();
  const out = path.resolve(opts.out);
  fs.mkdirSync(out, { recursive: true });
  const copy = readCopy(opts.locale);
  const planner = await loadPlanner();
  if (!planner.parseIsoDate(opts.date)) {
    console.error(`--date ${opts.date} is not a calendar day.\n\n${USAGE}`);
    return 2;
  }

  if (opts.postOnly) {
    const file = path.join(out, planner.MANIFEST_FILE);
    if (!fs.existsSync(file)) {
      console.error(`${file} not found – render first (node scripts/viral-bot.mjs --out ${opts.out}).`);
      return 1;
    }
    const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    const clips = (manifest.clips ?? []).map((c) => ({ id: `${c.episode}-${c.recipe}-${c.seed}`, file: c.status === "done" ? c.file : null, caption: c.caption }));
    console.log(`Posting ${clips.length} clip${clips.length === 1 ? "" : "s"} from ${file}…`);
    return (await postToInstagram(planner, clips, copy)) ? 0 : 1;
  }

  if (opts.dryRun) {
    console.log(`Dry run: planning ${opts.count} ${opts.platform} clip${opts.count === 1 ? "" : "s"} for ${opts.date} in Node (world ${planner.DEFAULT_BOT_WORLD.width}×${planner.DEFAULT_BOT_WORLD.height}; the render plans again in the page's own world)…`);
    const day = planner.planDay(opts.date, opts.platform, opts.count, { copy, locale: opts.locale, family: opts.family, bucket: opts.bucket, ending: opts.ending, maxSeeds: opts.maxSeeds, siteUrl: process.env.NEXT_PUBLIC_SITE_URL || undefined });
    printPlan(day.clips);
    writeTextFiles(out, planner.batchTextFiles(day.clips, copy, { date: day.date, platform: opts.platform, locale: opts.locale }));
    console.log(`\nWrote ${day.clips.length} caption file${day.clips.length === 1 ? "" : "s"}, ${planner.MANIFEST_FILE} and ${planner.SCHEDULE_FILE} to ${out}. Nothing rendered, nothing posted.`);
    return 0;
  }

  const { plans, rendered } = await renderInBrowser(opts, out);
  const done = rendered.filter((r) => r.status === "done").length;
  console.log(`\n${done}/${plans.length} clips rendered into ${out} (+ caption files, ${planner.MANIFEST_FILE}, ${planner.SCHEDULE_FILE}).`);
  if (!opts.post) {
    console.log("Not posting (pass --post to publish to Instagram).");
    console.log(manualSteps(copy));
    return done === plans.length ? 0 : 1;
  }
  const clips = plans.map((p) => {
    const r = rendered.find((x) => x.id === p.id);
    return { id: p.id, file: r && r.status === "done" ? r.file : null, caption: p.post.caption };
  });
  const posted = await postToInstagram(planner, clips, copy);
  return posted && done === plans.length ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`viral-bot: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    },
  );
}
