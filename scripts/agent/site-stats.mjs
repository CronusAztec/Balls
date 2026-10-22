/**
 * --- agent-cli --- `npm run agent -- site-stats` (owner-run): the site's aggregate numbers for a period from the owner's own
 * statistics service – Plausible (Stats API v2) or Umami – with the owner's key from the environment (or the git-ignored
 * .env files, read by scripts/dotenv.mjs). What is asked of which host, and what of the answer is printed, is in
 * scripts/agent/owner-stats.mjs: totals and event counts only. Without a key it prints "not configured" and exits 0. It is a
 * CLI command only (the MCP wrapper does not offer it), and the key never appears in its output.
 */
import { loadDotEnv } from "../dotenv.mjs";
import { ROOT } from "./paths.mjs";
import { statsConfigFromEnv, statsRequests, statsSummary, withoutSecret } from "./owner-stats.mjs";

const TIMEOUT_MS = 15_000;

/**
 * @param {unknown} _tb the bundled toolbox (unused: the owner-run halves live in owner-stats.mjs)
 * @param {{ days?: number }} args
 * @param {{ env?: Record<string, string | undefined> | null, fetchImpl?: (url: string, init: any) => Promise<Response>, now?: number }} [options]
 */
export async function siteStatsTool(_tb, args, { env = null, fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  if (!env) {
    loadDotEnv(ROOT);
    env = process.env;
  }
  const found = statsConfigFromEnv(env);
  if ("missing" in found) {
    return { configured: false, message: `not configured: set ${found.missing.join(", ")} (docs/agents/CLI.md, "Owner-run commands")` };
  }
  const config = found.config;
  const days = args.days ?? 30;
  const answers = {};
  for (const r of statsRequests(config, days, now)) {
    let res;
    try {
      res = await fetchImpl(r.url, { method: r.method, headers: r.headers, body: r.body, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" });
    } catch (e) {
      throw new Error(withoutSecret(`${config.provider} did not answer (${e instanceof Error ? e.message : String(e)})`, config.apiKey));
    }
    if (!res.ok) throw new Error(`${config.provider} answered ${res.status} to the ${r.name} request${res.status === 401 || res.status === 403 ? " – check the API key and the site id" : ""}`);
    answers[r.name] = await res.json();
  }
  const host = new URL(config.provider === "plausible" ? config.host : config.base).host;
  return { configured: true, provider: config.provider, host, days, summary: statsSummary(config.provider, answers) };
}
