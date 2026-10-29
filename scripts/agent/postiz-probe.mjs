/**
 * --- agent-cli --- `npm run agent -- postiz-probe` (owner-run, before the Insights work is built): what the owner's own
 * Postiz really returns for analytics, per channel and for a few recent posts – the series labels and how many points each
 * has, nothing else (no values, no channel names, no post text). It goes through the Windows app's own Postiz client
 * (desktop/src/social/postiz.ts, bundled here with esbuild), so it asks exactly what the app would:
 *   GET <POSTIZ_URL>/public/v1/integrations, /analytics/<channel>?date=<days>, /posts?startDate&endDate and
 *   /analytics/post/<post>?date=<days>, with the raw POSTIZ_API_KEY in the Authorization header.
 * POSTIZ_URL and POSTIZ_API_KEY come from the environment (or the git-ignored .env files); without them it prints
 * "not configured" and exits 0. CLI only: the MCP wrapper does not offer it.
 *
 * --- insights --- The owner's pilot (L0, docs/agents/CLI.md "Owner-run commands", docs/SOCIAL-AUTOPILOT.md section 6): per
 * recent published post it also prints its age in hours, whether it asked Postiz to be a Trial Reel (its settings
 * is_trial_reel and graduation_strategy: what was asked, not proof that Instagram did so), and for each series whether its
 * total is above zero (yes or no, never the total); and whether the per-post route answers at all (Postiz 2.18.0 or newer:
 * a 404 is "your Postiz is older than 2.18"; after it, or after a 429, the other posts are not asked). Errors are printed by
 * kind, never with Postiz's message. The client's own shapes leave out a post's settings and Postiz's {missing: true}, so the fetch the client
 * is given keeps a copy of those two answers' JSON (the post list and each post's numbers); the client still makes every
 * request and reads every answer itself. With no published post in the period it checks the route once with a made-up post
 * id, which a Postiz 2.18 or newer answers with an empty list.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { loadDotEnv } from "../dotenv.mjs";
import { ROOT, cacheDir } from "./paths.mjs";
import { POST_NOTES, POST_ROUTE_OLDER, ageHours, errorKind, platformMatches, postAnswerKind, postRouteOf, postizConfigFromEnv, rawRouteOf, seriesFacts, seriesShapes, settingsById, trialAsked, withoutSecret } from "./owner-stats.mjs";

/** The made-up post id of the route check (no published post in the period): a Postiz 2.18 or newer answers it with []. */
export const ROUTE_CHECK_ID = "jbl-probe-route-check";
/** The most of an answer the probe copies (the client's own cap). */
const RAW_MAX_BYTES = 8 * 1024 * 1024;

async function loadPostizClient() {
  const esbuild = await import("esbuild");
  const outfile = path.join(cacheDir("bundle"), "postiz.mjs");
  await esbuild.build({
    stdin: { contents: 'export { PostizClient, PostizError } from "./desktop/src/social/postiz";', resolveDir: ROOT, loader: "ts" },
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    alias: { "@": path.join(ROOT, "src") },
    logLevel: "error",
  });
  return import(`${pathToFileURL(outfile).href}?v=${fs.statSync(outfile).mtimeMs}`);
}

/**
 * The fetch the client is given: every answer goes to the client as it came; of the post list and of each post's numbers a
 * copy of the JSON is kept in `raw` ("posts", "post:<id>"), for what the client's shapes leave out.
 * @param {(url: string, init: any) => Promise<Response>} fetchImpl
 * @param {Map<string, unknown>} raw
 */
function keepingRaw(fetchImpl, raw) {
  return async (/** @type {string} */ url, /** @type {any} */ init) => {
    const response = await fetchImpl(url, init);
    const route = response.ok ? rawRouteOf(String(url)) : null;
    if (route && !(Number(response.headers.get("content-length") ?? "0") > RAW_MAX_BYTES)) {
      try {
        raw.set(route.route === "posts" ? "posts" : `post:${route.id}`, JSON.parse(await response.clone().text()));
      } catch {
        // not JSON (or not readable): the client says what it makes of it
      }
    }
    return response;
  };
}

/**
 * @param {unknown} _tb the bundled toolbox (unused: the owner-run halves live in owner-stats.mjs)
 * @param {{ days?: number, posts?: number, platform?: string }} args (platform: only that platform's recent posts, so the pilot's
 *   two reels stay among them on a busy account)
 * @param {{ env?: Record<string, string | undefined> | null, fetchImpl?: (url: string, init: any) => Promise<Response>, now?: number, client?: any, clientModule?: { PostizClient: any } | null }} [options]
 *   client: a stand-in client (its answers are read through its own shapes only); clientModule: the module that exports
 *   PostizClient (the tests hand in desktop/src/social/postiz.ts; the CLI bundles it)
 */
export async function postizProbeTool(_tb, args, { env = null, fetchImpl = globalThis.fetch, now = Date.now(), client = null, clientModule = null } = {}) {
  if (!env) {
    loadDotEnv(ROOT);
    env = process.env;
  }
  const found = postizConfigFromEnv(env);
  if ("missing" in found) return { configured: false, message: `not configured: set ${found.missing.join(" and ")} (docs/agents/CLI.md, "Owner-run commands")` };
  const days = args.days ?? 30;
  const postCount = args.posts ?? 5;
  const key = found.config.apiKey;
  const safe = (/** @type {unknown} */ e) => withoutSecret(e instanceof Error ? `${/** @type {any} */ (e).code ? `${/** @type {any} */ (e).code}: ` : ""}${e.message}` : String(e), key);
  /** @type {Map<string, unknown>} */
  const raw = new Map();
  let postiz = client;
  if (!postiz) {
    const { PostizClient } = clientModule ?? (await loadPostizClient());
    postiz = new PostizClient({ baseUrl: found.config.baseUrl, apiKey: key, fetch: keepingRaw(fetchImpl, raw) });
  }
  let channels;
  try {
    channels = await postiz.integrations();
  } catch (e) {
    throw new Error(`Postiz did not list the channels (${safe(e)})`);
  }
  const channelShapes = [];
  for (const [index, ch] of channels.entries()) {
    try {
      channelShapes.push({ index, platform: ch.platform, disabled: ch.disabled === true, series: seriesShapes(await postiz.analytics(ch.id, days)) });
    } catch (e) {
      channelShapes.push({ index, platform: ch.platform, disabled: ch.disabled === true, error: safe(e) });
    }
  }
  const postShapes = [];
  /** @type {({ ok: true } | { ok: false, error: { kind: string, status: number | null, meaning: string } })[]} */
  const routeCalls = [];
  let routeCheckedWith = "not asked (posts is 0)";
  if (postCount > 0) {
    let posts = [];
    let listed = true;
    try {
      posts = await postiz.posts({ startDate: new Date(now - days * 86_400_000).toISOString(), endDate: new Date(now).toISOString() });
    } catch (e) {
      listed = false;
      postShapes.push({ error: `Postiz did not list the posts (${safe(e)})` });
    }
    const settings = settingsById(raw.get("posts"));
    const recent = posts
      .filter((/** @type {any} */ p) => p.state === "PUBLISHED" && platformMatches(p.integration?.platform, args.platform))
      .sort((/** @type {any} */ a, /** @type {any} */ b) => String(b.publishDate).localeCompare(String(a.publishDate)))
      .slice(0, postCount);
    // after a 404 (no such route) or a 429 (Postiz asks for a pause) the other posts are not asked
    let stopAsking = false;
    for (const [index, p] of recent.entries()) {
      const facts = {
        index,
        platform: p.integration?.platform ?? null,
        ageHours: ageHours(p.publishDate, now),
        ...trialAsked(settings.has(p.id) ? settings.get(p.id) : p.settings),
      };
      if (stopAsking) {
        postShapes.push({ ...facts, answer: "skipped" });
        continue;
      }
      try {
        const series = await postiz.postAnalytics(p.id, days);
        routeCalls.push({ ok: true });
        const kind = raw.has(`post:${p.id}`) ? postAnswerKind(raw.get(`post:${p.id}`)) : series.length ? "series" : "empty";
        postShapes.push({ ...facts, answer: kind === "series" && !series.length ? "unreadable" : kind, ...(series.length ? { series: seriesFacts(series) } : {}) });
      } catch (e) {
        const error = errorKind(e, { postRoute: true });
        routeCalls.push({ ok: false, error });
        stopAsking = error.meaning === POST_ROUTE_OLDER || error.kind === "rateLimited";
        postShapes.push({ ...facts, answer: "error", error });
      }
    }
    routeCheckedWith = recent.length ? "the recent posts below" : `a made-up post id (${listed ? `no published${args.platform ? ` ${args.platform}` : ""} post in the period` : "the posts could not be listed"})`;
    if (!recent.length) {
      try {
        await postiz.postAnalytics(ROUTE_CHECK_ID, days);
        routeCalls.push({ ok: true });
      } catch (e) {
        routeCalls.push({ ok: false, error: errorKind(e, { postRoute: true }) });
      }
    }
  }
  let host = null;
  try {
    host = new URL(postiz.baseUrl ?? found.config.baseUrl).host;
  } catch {
    host = null;
  }
  return { configured: true, host, days, channels: channelShapes, postRoute: { ...postRouteOf(routeCalls), checkedWith: routeCheckedWith }, posts: postShapes, notes: [...POST_NOTES] };
}
