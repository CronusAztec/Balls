/**
 * --- agent-cli --- `npm run agent -- postiz-probe` (owner-run, before the Insights work is built): what the owner's own
 * Postiz really returns for analytics, per channel and for a few recent posts – the series labels and how many points each
 * has, nothing else (no values, no channel names, no post text). It goes through the Windows app's own Postiz client
 * (desktop/src/social/postiz.ts, bundled here with esbuild), so it asks exactly what the app would:
 *   GET <POSTIZ_URL>/public/v1/integrations, /analytics/<channel>?date=<days>, /posts?startDate&endDate and
 *   /analytics/post/<post>?date=<days>, with the raw POSTIZ_API_KEY in the Authorization header.
 * POSTIZ_URL and POSTIZ_API_KEY come from the environment (or the git-ignored .env files); without them it prints
 * "not configured" and exits 0. CLI only: the MCP wrapper does not offer it.
 */
import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { loadDotEnv } from "../dotenv.mjs";
import { ROOT, cacheDir } from "./paths.mjs";
import { postizConfigFromEnv, seriesShapes, withoutSecret } from "./owner-stats.mjs";

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
 * @param {unknown} _tb the bundled toolbox (unused: the owner-run halves live in owner-stats.mjs)
 * @param {{ days?: number, posts?: number }} args
 * @param {{ env?: Record<string, string | undefined> | null, fetchImpl?: (url: string, init: any) => Promise<Response>, now?: number, client?: any }} [options]
 */
export async function postizProbeTool(_tb, args, { env = null, fetchImpl = globalThis.fetch, now = Date.now(), client = null } = {}) {
  if (!env) {
    loadDotEnv(ROOT);
    env = process.env;
  }
  const found = postizConfigFromEnv(env);
  if ("missing" in found) return { configured: false, message: `not configured: set ${found.missing.join(" and ")} (docs/agents/CLI.md, "Owner-run commands")` };
  const days = args.days ?? 30;
  const postCount = args.posts ?? 5;
  const key = found.config.apiKey;
  const safe = (e) => withoutSecret(e instanceof Error ? `${e.code ? `${e.code}: ` : ""}${e.message}` : String(e), key);
  let postiz = client;
  if (!postiz) {
    const { PostizClient } = await loadPostizClient();
    postiz = new PostizClient({ baseUrl: found.config.baseUrl, apiKey: key, fetch: fetchImpl });
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
  if (postCount > 0) {
    let posts = [];
    try {
      posts = await postiz.posts({ startDate: new Date(now - days * 86_400_000).toISOString(), endDate: new Date(now).toISOString() });
    } catch (e) {
      postShapes.push({ error: `Postiz did not list the posts (${safe(e)})` });
    }
    const recent = posts
      .filter((p) => p.state === "PUBLISHED")
      .sort((a, b) => String(b.publishDate).localeCompare(String(a.publishDate)))
      .slice(0, postCount);
    for (const [index, p] of recent.entries()) {
      const platform = p.integration?.platform ?? null;
      try {
        postShapes.push({ index, platform, series: seriesShapes(await postiz.postAnalytics(p.id, days)) });
      } catch (e) {
        postShapes.push({ index, platform, error: safe(e) });
      }
    }
  }
  let host = null;
  try {
    host = new URL(postiz.baseUrl ?? found.config.baseUrl).host;
  } catch {
    host = null;
  }
  return { configured: true, host, days, channels: channelShapes, posts: postShapes };
}
