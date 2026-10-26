import { validateJson, type JsonSchema } from "@/lib/desktop/ai/jsonSchema";
import { DEFAULT_QUERY, SHORT_MAX_SEC, URL_MAX_CHARS } from "./videoSources";
import { FRAMES_CEILING, SHEET_TILES_CEILING } from "@/lib/videoAnalysis/ffmpegArgs";

/*
 * --- agent-cli --- The fixed tool table of the agent toolbox: one entry per command of `npm run agent -- <tool> --json '{…}'`
 * (scripts/agent/cli.mjs) with its input schema (the JSON-schema subset of lib/desktop/ai/jsonSchema.ts, also valid JSON
 * Schema for the MCP wrapper's tools/list) and what it may touch. The CLI checks every call against it before anything runs;
 * scripts/agent/mcp.mjs lists exactly the entries marked `mcp`. Nothing here runs anything.
 *
 * What a tool may touch:
 *  - writes: "none", or ".agent-out" (its results only under <repo>/.agent-out/), plus what `alsoWrites` names: the caches
 *    outside it (every call keeps the bundled toolbox in the agent cache, a private folder of this user's cache folder);
 *  - network: "none", "localhost" (the CLI's own static server for the local export; the browser is fenced to it),
 *    "owner" (the owner's own Plausible / Umami / Postiz host from the environment – owner-run commands only, never MCP), or
 *    --- inspiration --- "web" (video sites through yt-dlp: a search, a Shorts feed, a video's page and its file – the
 *    inspiration tools, which learn from other creators' trending and viral videos, the owner's decision of October 2026;
 *    a link is checked first: http or https, never one that names this machine or its private network or whose host
 *    resolves there when it is checked – a check of the link, not a firewall).
 */

export type ToolWrites = "none" | ".agent-out";
export type ToolNetwork = "none" | "localhost" | "owner" | "web";

export interface AgentToolSpec {
  name: string;
  title: string;
  description: string;
  input: JsonSchema;
  writes: ToolWrites;
  network: ToolNetwork;
  /** Listed by the MCP wrapper (the owner-run commands are CLI only). */
  mcp: boolean;
  /** Arguments the MCP wrapper leaves out of the tool's schema and refuses: CLI only (a person runs them on purpose). */
  cliOnly?: readonly string[];
  /** What it writes besides its results: caches and build output, outside .agent-out/ (listed by --help). */
  alsoWrites?: readonly string[];
  /** How long a call may run before the MCP wrapper stops it (ms). */
  timeoutMs: number;
}

/**
 * --- review fix (blueprint) --- The longest link a tool takes: a Mode Lab link carries a whole Blueprint (a code of up to
 * BLUEPRINT_CODE_MAX_CHARS, 8,019 characters, for a spec at the 6 KB ceiling) beside the site's address and the other
 * settings, so a game bp-link writes is a game simulate, preview and render play. As long as bpCode, which takes such links too.
 */
export const LINK_MAX_CHARS = 20_000;
const link: JsonSchema = { type: "string", minLength: 1, maxLength: LINK_MAX_CHARS, description: "A share link of the simulator (https://…/simulator/?mode=…&seed=…, a ?c= short link, or just its query string). Never fetched: only its parameters are read." };
const mode: JsonSchema = { type: "string", minLength: 1, maxLength: 40, pattern: "^[A-Za-z]+$", description: "A mode id (see the modes tool); its default settings. Give link or mode, not both." };
const seed: JsonSchema = { type: "integer", minimum: -2147483648, maximum: 4294967295, description: "The run's seed (default: the link's seed=, else 1)." };
const out: JsonSchema = { type: "string", minLength: 1, maxLength: 80, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$", description: "A folder name under .agent-out/<tool>/ for the files (default: one named after the request)." };
const build: JsonSchema = { type: "string", enum: ["auto", "reuse", "force"], description: "The local export: auto (default) rebuilds when the working tree changed since the last build, reuse takes the last build as it is, force always rebuilds." };
const world: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["width", "height"],
  properties: { width: { type: "number", minimum: 100, maximum: 4000 }, height: { type: "number", minimum: 100, maximum: 4000 } },
  description: "The world in CSS px (default 800 × 600, the finder's nominal world; the page's canvas is usually another size, so a seed found there may play differently here).",
};

// --- blueprint --- a Blueprint, given one way: a spec (the JSON object), a link code, a catalog id or the Lite form
const bpSpec: JsonSchema = { type: "object", description: "A Blueprint v1 spec (the JSON object; docs/agents/BLUEPRINTS.md). Give spec, code, catalog or lite: exactly one." };
const bpCode: JsonSchema = {
  type: "string",
  minLength: 3,
  maxLength: LINK_MAX_CHARS,
  description: "A Blueprint link code (b1.…), or a Mode Lab link / query string holding bls=b1.… or blp=<catalog id> (never fetched); its slider values (blv) are applied, as the page plays them.",
};
const bpCatalog: JsonSchema = { type: "string", minLength: 1, maxLength: 40, pattern: "^[A-Za-z]+$", description: "A built-in Blueprint's id (hatchery, ringBreaker, conquer, tierClimb, plinkoRace, growEscape)." };
const bpLite: JsonSchema = { type: "object", description: "A Blueprint in the Lite form (enum words only: the app's small local model writes it)." };
// --- review fix (blueprint) --- the sliders a game is played with, as a link's blv writes them
const bpParams: JsonSchema = {
  type: "string",
  maxLength: 400,
  pattern: "^[0-9eE+., -]*$",
  description: "Slider values, comma-separated in the order of the spec's params (an empty place keeps the spec's own value), as a Mode Lab link's blv writes them: \"3,60\". They replace a link's own blv.",
};
const bpInput = { spec: bpSpec, code: bpCode, catalog: bpCatalog, lite: bpLite, params: bpParams };
// --- inspiration --- a video link (fetched with yt-dlp, never opened by the browser), a search, the ranking, the fetch size
const videoUrl: JsonSchema = { type: "string", minLength: 8, maxLength: URL_MAX_CHARS, pattern: "^[Hh][Tt][Tt][Pp][Ss]?://", description: "A video link: TikTok, Instagram, YouTube (a Short too) or any site yt-dlp reads; http or https, never this machine or its private network (the link and where its host resolves are checked). One video: a playlist, channel, profile or hashtag link is refused. Fetched into .agent-out/inbox/." };
const videoUrls: JsonSchema = { type: "array", minItems: 1, items: videoUrl, description: "Video links to add (TikTok, Instagram, YouTube or any site), each read with yt-dlp for its numbers." };
const queryArg: JsonSchema = { type: "string", minLength: 1, maxLength: 200, description: `What to search for (default "${DEFAULT_QUERY}" when no urls are given).` };
const sortByArg: JsonSchema = { type: "string", enum: ["views", "viewsPerDay"], description: "The order, most first (default views)." };
const maxHeightArg: JsonSchema = { type: "integer", minimum: 1, description: "A fetched video's shorter side at most, in px (default 1080: a 1080 × 1920 short stays whole)." };
/** --- inspiration --- What the analyser writes besides its result: ffmpeg's scratch folder, removed when it ends. */
const ANALYSE_SCRATCH = "the agent cache in this user's cache folder (~/.cache/jbl-agent): ffmpeg's scratch folder, removed when the analysis ends (JBL_AGENT_CACHE)";
/** --- inspiration --- The tools that take a video as a file (path) or a link (url): exactly one of them. */
export const PATH_OR_URL_TOOLS: ReadonlySet<string> = new Set(["analyse", "frames"]);

/** The tools that take a Blueprint (exactly one of spec, code, catalog, lite). */
export const BLUEPRINT_INPUT_TOOLS: ReadonlySet<string> = new Set(["bp-validate", "bp-check", "bp-link"]);

export const AGENT_TOOLS: readonly AgentToolSpec[] = [
  {
    name: "modes",
    title: "Mode catalog",
    description: "Every mode: id, family, English name, settings prefix and field count. With {mode}: that mode's fields with default, slider range, share-link key and whether the engine reads it.",
    input: { type: "object", additionalProperties: false, properties: { mode } },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 60_000,
  },
  {
    name: "simulate",
    title: "Simulate a seed headlessly",
    description: "Runs one seed of a share link (or a mode's defaults) in Node exactly as the seed finder does and returns finished / finishSec (the finder's time), balls per second, sound events per type, the mode's state, view and progress (JSON-safe), a NaN flag and work counts. Deterministic.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        link,
        mode,
        seed,
        seconds: { type: "number", minimum: 0.1, maximum: 600, description: "Simulated seconds at most (default 30); the run stops at its finish unless continueAfterFinish." },
        world,
        continueAfterFinish: { type: "boolean", description: "Keep stepping after the run finished (default false)." },
      },
    },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 120_000,
  },
  {
    name: "fingerprint",
    title: "Determinism fingerprint",
    description: "A mode's fingerprint by the tests/extras.test.ts recipe (seed 12345, 600 frames) and its diff against that file's BASELINE entry. Without {mode}: every mode, equal or not. A moved fingerprint is a behaviour change to fix, never a number to re-record.",
    input: { type: "object", additionalProperties: false, properties: { mode } },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 120_000,
  },
  {
    name: "preview",
    title: "Preview contact sheet",
    description: "A PNG contact sheet of a link (or mode) at the given seconds, rendered by the real page's still camera in headless Chromium from a local export of the working tree. Watermarked like any free visitor's picture.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        link,
        mode,
        seed,
        times: { type: "array", minItems: 1, maxItems: 12, items: { type: "number", minimum: 0, maximum: 600 }, description: "Seconds of the run, one picture each (default [1, 3, 5])." },
        size: { type: "integer", minimum: 64, maximum: 640, description: "Side of each picture in px (default 320)." },
        camera: { type: "object", additionalProperties: false, properties: { x: { type: "number" }, y: { type: "number" }, zoom: { type: "number", minimum: 0.1, maximum: 20 } }, description: "The still camera (default: the whole world)." },
        out,
        build,
      },
    },
    writes: ".agent-out",
    network: "localhost",
    alsoWrites: ["the agent cache in this user's cache folder (~/.cache/jbl-agent): the local export of the working tree (JBL_AGENT_CACHE)"],
    mcp: true,
    timeoutMs: 15 * 60_000,
  },
  {
    name: "render",
    title: "Render a clip",
    description: "A short clip of a link (or mode) through the page's own fast export (the batch path of window.__jumpingBallsBot.renderLink), with its export digest and render result. Watermarked like a free render. WebM from a browser without H.264 is also converted to MP4 when ffmpeg is present.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        link,
        mode,
        seed,
        seconds: { type: "number", minimum: 10, maximum: 60, description: "Clip length in seconds (default 10: the site's shortest clip; at most 60 here)." },
        mp4: { type: "boolean", description: "Convert a WebM clip to MP4 with ffmpeg when present (default true)." },
        out,
        build,
      },
    },
    writes: ".agent-out",
    network: "localhost",
    alsoWrites: ["the agent cache in this user's cache folder (~/.cache/jbl-agent): the local export of the working tree (JBL_AGENT_CACHE)"],
    mcp: true,
    timeoutMs: 20 * 60_000,
  },
  {
    name: "site-shot",
    title: "Website screenshots",
    description: "PNG screenshots of pages of the local export of the working tree at the given widths, so an agent sees the website it edits.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        pages: { type: "array", minItems: 1, maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200, pattern: "^/[A-Za-z0-9/_.-]*$" }, description: "Site paths (default [\"/en/\"])." },
        widths: { type: "array", minItems: 1, maxItems: 4, items: { type: "integer", minimum: 320, maximum: 2560 }, description: "Viewport widths in px (default [390, 1280])." },
        fullPage: { type: "boolean", description: "The whole page, not only the first screen (default true)." },
        out,
        build,
      },
    },
    writes: ".agent-out",
    network: "localhost",
    alsoWrites: ["the agent cache in this user's cache folder (~/.cache/jbl-agent): the local export of the working tree (JBL_AGENT_CACHE)"],
    mcp: true,
    timeoutMs: 15 * 60_000,
  },
  {
    name: "analyse",
    title: "Analyse a video",
    description: "Numeric features of a video (duration, fps, size, scene cuts, motion, colour, loop seam, loudness, tempo) with ffmpeg (JBL_FFMPEG, FFMPEG_PATH, the Windows app's bundled one, else the system's): your own clips, or other creators' trending and viral videos. Give a file inside the repository (path), or a link (url: TikTok, Instagram, YouTube or any site), which is fetched into .agent-out/inbox/ first, as fetch-video does, then measured exactly as a file. Nothing is uploaded; the file is read, not copied.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1000, description: "The file, relative to the repository root or absolute inside it (e.g. .agent-out/inbox/clip.mp4). Give path or url." },
        url: videoUrl,
        sampleHz: { type: "number", minimum: 0.5, maximum: 10, description: "Picture samples per second for motion and colour (default 2, the rate clip features compare at)." },
        maxSec: { type: "number", minimum: 1, maximum: 300, description: "Seconds analysed from the start at most (default 300)." },
        maxHeight: maxHeightArg,
      },
    },
    writes: ".agent-out",
    network: "web",
    alsoWrites: [ANALYSE_SCRATCH],
    mcp: true,
    timeoutMs: 40 * 60_000,
  },
  // --- inspiration --- other creators' trending and viral videos: find them, fetch them, look at them, learn from them
  {
    name: "frames",
    title: "Frames and contact sheets",
    description: "Still frames of a video for a vision-capable AI to look at: `count` frames spread evenly over it, the opening seconds (the hook) in finer steps, and a contact sheet PNG of each, in .agent-out/frames/<name>/. A file inside the repository (path) or a link (url, fetched into .agent-out/inbox/ first).",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", minLength: 1, maxLength: 1000, description: "The video file inside the repository. Give path or url." },
        url: videoUrl,
        count: { type: "integer", minimum: 1, description: `Frames spread evenly over the video (default 12; never more than the video has, nor ${FRAMES_CEILING}: the result's limited says so; a sheet shows ${SHEET_TILES_CEILING} of them at most).` },
        hookSec: { type: "number", minimum: 0, description: "The opening seconds shown in finer steps (default 3; 0: none)." },
        hookStepSec: { type: "number", minimum: 0.04, description: `The step of the opening frames (default 0.25 s; no finer than one frame, and ${FRAMES_CEILING} frames at most).` },
        width: { type: "integer", minimum: 64, description: "Each frame's width in px (default 540; the height keeps the picture's shape)." },
        sheet: { type: "boolean", description: "Also lay the frames out on contact sheets (default true)." },
        out,
        maxHeight: maxHeightArg,
      },
    },
    writes: ".agent-out",
    network: "web",
    mcp: true,
    timeoutMs: 30 * 60_000,
  },
  {
    name: "trending",
    title: "Trending videos",
    description: `Finds trending and viral videos: a YouTube search (yt-dlp ytsearch), plus the query's hashtag Shorts feed when maxDurationSec is at most ${SHORT_MAX_SEC}, and any TikTok, Instagram or YouTube links you give (urls). Each video comes with its link, platform, title, channel, views, likes, comments, length, upload date and views per day (from its own page unless details is false), sorted by views or views per day, short-form first when maxDurationSec is at most ${SHORT_MAX_SEC}. Writes nothing.`,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: queryArg,
        limit: { type: "integer", minimum: 1, description: "Videos returned (default 20; no maximum: a larger one takes longer)." },
        platform: { type: "string", enum: ["youtube"], description: "Where the query is searched (default youtube). TikTok and Instagram videos: give their links in urls." },
        minViews: { type: "integer", minimum: 0, description: "Leave out videos with fewer views (or an unknown count)." },
        maxDurationSec: { type: "number", minimum: 1, description: `Leave out longer videos; at most ${SHORT_MAX_SEC} also reads the Shorts feed and puts short-form first.` },
        sortBy: sortByArg,
        urls: videoUrls,
        details: { type: "boolean", description: "Read each video's own page for likes, comments, the upload date and exact views (default true; false: the search rows alone, faster)." },
      },
    },
    writes: "none",
    network: "web",
    mcp: true,
    timeoutMs: 20 * 60_000,
  },
  {
    name: "fetch-video",
    title: "Fetch a video",
    description: "Downloads one video (TikTok, Instagram, YouTube or any site yt-dlp reads) into .agent-out/inbox/<platform>-<id>.mp4 with its info JSON beside it, and returns the path and its numbers (views, likes, comments, length, upload date). A video already there is reused unless force. yt-dlp from the PATH or JBL_YTDLP; ffmpeg merges the picture and the sound into MP4.",
    input: {
      type: "object",
      additionalProperties: false,
      required: ["url"],
      properties: { url: videoUrl, maxHeight: maxHeightArg, force: { type: "boolean", description: "Download again even when the file is in .agent-out/inbox/ (default false)." } },
    },
    writes: ".agent-out",
    network: "web",
    mcp: true,
    timeoutMs: 30 * 60_000,
  },
  {
    name: "inspire",
    title: "Learn from trending videos",
    description: `The whole pipeline: trending → fetch the top videos → analyse and frames for each → a report of what separates the most viewed from the rest (length, cuts, motion, the first second, colour, loudness, tempo, the loop seam, titles, themes) with recommendations in our own levers (modes, settings and their link keys, Blueprint mechanics, clip length, the hook, captions, music tempo), compared with our own renders (.agent-out/render or ours). Writes .agent-out/inspiration/<date>-<slug>/report.json and report.md and appends every measured video to .agent-out/inspiration/dataset.jsonl (or the named dataset; once per video).`,
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: queryArg,
        limit: { type: "integer", minimum: 1, description: "Trending videos considered (default 20)." },
        top: { type: "integer", minimum: 1, description: "Videos fetched and measured, from the top of the list (default 8)." },
        urls: videoUrls,
        minViews: { type: "integer", minimum: 0, description: "Leave out videos with fewer views." },
        maxDurationSec: { type: "number", minimum: 1, description: `Leave out longer videos (default ${SHORT_MAX_SEC}: short-form, as our clips are).` },
        sortBy: sortByArg,
        maxHeight: maxHeightArg,
        frames: { type: "boolean", description: "Also write each video's frames and contact sheets (default true)." },
        stills: { type: "boolean", description: "When a YouTube video cannot be fetched, read its public stills instead (the opening frame, 25, 50 and 75%, the cover): a stills-sheet.png and their colours (default true)." },
        ours: { type: "string", minLength: 1, maxLength: 1000, description: "A folder inside the repository with our own renders to compare (default .agent-out/render)." },
        oursMax: { type: "integer", minimum: 0, description: "Our renders measured, newest first (default 8; 0: none)." },
        dataset: { type: "string", minLength: 1, maxLength: 40, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$", description: "The dataset the measured videos are added to: .agent-out/inspiration/<dataset>.jsonl (default dataset), one per topic if you like." },
      },
    },
    writes: ".agent-out",
    network: "web",
    alsoWrites: [ANALYSE_SCRATCH],
    mcp: true,
    timeoutMs: 120 * 60_000,
  },
  {
    name: "guard",
    title: "Core guard",
    description: "Runs the core guard (npm run guard: types, lint, the core tests, the fingerprint lock and the protected-path report) and returns its exit code (0 green, 1 failed, 2 green but a higher tier is required), report and the end of its output.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: {
        browser: { type: "boolean", description: "Also the browser tier (guard --browser)." },
        baseline: { type: "boolean", description: "Record the failures the untouched tree already has (guard --baseline; refused on a tree with any change). CLI only: not offered over MCP." },
        plan: { type: "boolean", description: "Plan only (guard --plan): what would run and the static checks' findings (fingerprint lock, protected-path report, test weakening) in about a second; nothing runs." },
        withSlow: { type: "boolean", description: "Also the slow tests the change pulls in (guard --with-slow)." },
        base: { type: "string", minLength: 1, maxLength: 100, pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]*$", description: "The git ref the change is measured against (guard --base; default the merge base with origin/main). CLI only: not offered over MCP (a later base hides the change's committed commits from the static checks)." },
      },
    },
    writes: ".agent-out",
    alsoWrites: ["node_modules/.cache/jbl-guard: the guard's state (type-check, ESLint and vitest caches, logs, the baseline)", ".next/ and out/ of the repository, with browser: the /smoke build tier 1 serves"],
    network: "none",
    mcp: true,
    // --- ai-guard --- a baseline excuses failures: recording one is a person's step on an untouched tree, not a tool call;
    // and a base narrows what is measured (base "HEAD" hides every committed weakened test and re-recorded fingerprint)
    cliOnly: ["baseline", "base"],
    timeoutMs: 30 * 60_000,
  },
  {
    name: "explain",
    title: "Explain a failure",
    description: "Sorts a failure (vitest, tsc, eslint or smoke output) into a source pin, a behaviour change, a fingerprint, a timeout, a type or lint error, and says which fix is legitimate and what never to do.",
    input: { type: "object", additionalProperties: false, required: ["failure"], properties: { failure: { type: "string", minLength: 1, maxLength: 200_000 } } },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 60_000,
  },
  // --- blueprint --- the Blueprint language's tools (src/lib/blueprint/, docs/agents/BLUEPRINTS.md): pure, no browser, no files
  {
    name: "bp-schema",
    title: "Blueprint schema",
    description: "The Blueprint v1 language: its JSON Schema (full form, or the enum-only Lite form), the whole vocabulary in under 500 tokens, and the sandbox's ceilings.",
    input: { type: "object", additionalProperties: false, properties: { form: { type: "string", enum: ["full", "lite"], description: "Which form (default full)." } } },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 60_000,
  },
  {
    name: "bp-validate",
    title: "Validate a Blueprint",
    description: "Checks a Blueprint strictly: every problem as `path: sentence`. Also returns what the tolerant sanitizer would change, the plain-language summary, its canonical size, digest and link code.",
    input: { type: "object", additionalProperties: false, properties: bpInput },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 60_000,
  },
  {
    name: "bp-check",
    title: "Playability check",
    description: "Plays a Blueprint headless on seeds 1-4 (or the given ones) with the Blueprint interpreter (src/lib/blueprint/runtime/), and judges it playable, endless or broken on deterministic counts, with plain feedback per problem. Deterministic; the wall time is only an advisory.",
    input: {
      type: "object",
      additionalProperties: false,
      properties: { ...bpInput, seeds: { type: "array", minItems: 1, maxItems: 8, items: { type: "integer", minimum: 0, maximum: 4294967295 }, description: "The seeds (default [1, 2, 3, 4]: the verdict's own)." } },
    },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 5 * 60_000,
  },
  {
    name: "bp-link",
    title: "Blueprint link",
    description: "The link code (b1.…), the simulator link (?mode=blueprint&bls=…, the blueprint mode's link key) and the site's short share code (?c=…) of a Blueprint, with their lengths.",
    input: { type: "object", additionalProperties: false, properties: { ...bpInput, locale: { type: "string", enum: ["en", "pl", "es"], description: "The link's locale (default en)." } } },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 60_000,
  },
  {
    name: "bp-docs",
    title: "Blueprint guide",
    description: "docs/agents/BLUEPRINTS.md as the code generates it, and whether the committed file is current (npm run blueprints:docs rewrites it).",
    input: { type: "object", additionalProperties: false, properties: { markdown: { type: "boolean", description: "Include the generated Markdown (default true)." } } },
    writes: "none",
    network: "none",
    mcp: true,
    timeoutMs: 120_000,
  },
  {
    name: "site-stats",
    title: "Website statistics (owner-run)",
    description: "Aggregate website numbers from the owner's own Plausible (Stats API v2) or Umami, with the owner's key from the environment. Without a key: 'not configured'.",
    input: { type: "object", additionalProperties: false, properties: { days: { type: "integer", minimum: 1, maximum: 365, description: "The period (default 30 days)." } } },
    writes: "none",
    network: "owner",
    mcp: false,
    timeoutMs: 60_000,
  },
  {
    name: "postiz-probe",
    title: "Postiz analytics probe (owner-run)",
    description: "Which analytics series the owner's Postiz returns per channel and for recent posts: labels and point counts only, no numbers. POSTIZ_URL and POSTIZ_API_KEY from the environment; without them: 'not configured'.",
    input: { type: "object", additionalProperties: false, properties: { days: { type: "integer", enum: [7, 30, 90], description: "The period (default 30)." }, posts: { type: "integer", minimum: 0, maximum: 20, description: "Recent posts probed (default 5)." } } },
    writes: "none",
    network: "owner",
    mcp: false,
    timeoutMs: 120_000,
  },
];

export function toolSpec(name: string): AgentToolSpec | null {
  return AGENT_TOOLS.find((t) => t.name === name) ?? null;
}

export type ToolArgsCheck = { ok: true; args: Record<string, unknown> } | { ok: false; errors: string[] };

/** The call's arguments checked against the tool's schema (plus the link-or-mode rule of the tools that take either). */
export function checkToolArgs(name: string, args: unknown): ToolArgsCheck {
  const spec = toolSpec(name);
  if (!spec) return { ok: false, errors: [`Unknown tool "${name}" (the tools: ${AGENT_TOOLS.map((t) => t.name).join(", ")})`] };
  const value = args === undefined || args === null ? {} : args;
  const errors = validateJson(spec.input, value);
  if (errors.length) return { ok: false, errors };
  const a = value as Record<string, unknown>;
  if ("link" in (spec.input.properties ?? {}) && a.link !== undefined && a.mode !== undefined) return { ok: false, errors: ["Give link or mode, not both"] };
  // --- blueprint --- one Blueprint a call
  if (BLUEPRINT_INPUT_TOOLS.has(name) && ["spec", "code", "catalog", "lite"].filter((k) => a[k] !== undefined).length !== 1) return { ok: false, errors: ["Give exactly one of spec, code, catalog or lite"] };
  // --- inspiration --- one video a call: a file or a link
  if (PATH_OR_URL_TOOLS.has(name) && ["path", "url"].filter((k) => a[k] !== undefined).length !== 1) return { ok: false, errors: ["Give path (a file inside the repository) or url (a video link), exactly one"] };
  return { ok: true, args: a };
}
