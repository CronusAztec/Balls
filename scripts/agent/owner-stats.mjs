/**
 * --- agent-cli --- The owner-run commands' pure halves (scripts/agent/site-stats.mjs, scripts/agent/postiz-probe.mjs):
 * which host is asked, with which request, and what of the answer is printed. Nothing here fetches; the CLI does, only
 * when the owner set the keys, and only to the host named here:
 *
 *  site-stats – aggregate website numbers for a period, from the owner's own statistics service:
 *   - Plausible Stats API v2: POST <PLAUSIBLE_HOST, default https://plausible.io>/api/v2/query with
 *     `Authorization: Bearer <PLAUSIBLE_API_KEY>`, site PLAUSIBLE_SITE_ID (else JBL_ANALYTICS_SITE_ID): one aggregate query
 *     (visitors, visits, pageviews, bounce rate, visit duration) and one by goal (the site's events);
 *   - Umami: GET <base>/websites/<UMAMI_WEBSITE_ID, else JBL_ANALYTICS_SITE_ID>/stats and …/metrics?type=event – Umami Cloud
 *     (https://api.umami.is/v1, header `x-umami-api-key: <UMAMI_API_KEY>`) unless UMAMI_HOST names a self-hosted Umami
 *     (<UMAMI_HOST>/api, `Authorization: Bearer <UMAMI_API_KEY>`).
 *   Only totals come back – no visitor, page address or referrer list.
 *  postiz-probe – which analytics series the owner's Postiz returns: series labels and point counts, never the numbers.
 *
 * Without a key either prints "not configured" and exits 0. A key never appears in a request summary or a message.
 * Kept in scripts/, not src/: the site's code names no statistics vendor and no vendor host (tests/analytics.test.ts).
 */

/** @typedef {Record<string, string | undefined>} Env */

/**
 * @typedef {{ provider: "plausible", host: string, apiKey: string, siteId: string } | { provider: "umami", base: string, apiKey: string, websiteId: string, cloud: boolean }} StatsConfig
 * @typedef {{ name: string, url: string, method: "GET" | "POST", headers: Record<string, string>, body?: string }} StatsRequest
 *   (name: what the request is for – "aggregate", "goals", "stats", "events")
 */

export const UMAMI_CLOUD_BASE = "https://api.umami.is/v1";
export const PLAUSIBLE_DEFAULT_HOST = "https://plausible.io";

/** @param {string | undefined} v */
const clean = (v) => String(v ?? "").trim();

/**
 * An https origin (or http on localhost / 127.0.0.1), without a trailing slash; throws on anything else.
 * @param {string} input
 * @param {string} what
 * @returns {string}
 */
export function statsOrigin(input, what) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${what} is not an address: use https://your-host`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error(`${what} must be https:// (http only on localhost)`);
  if (url.username || url.password) throw new Error(`${what} must not carry a user name or password`);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * The statistics service the environment names, or the variables it lacks (none set at all: not configured).
 * @param {Env} env
 * @returns {{ config: StatsConfig } | { missing: string[] }}
 */
export function statsConfigFromEnv(env) {
  const siteFallback = clean(env.JBL_ANALYTICS_SITE_ID);
  const plausibleKey = clean(env.PLAUSIBLE_API_KEY);
  if (plausibleKey) {
    const siteId = clean(env.PLAUSIBLE_SITE_ID) || siteFallback;
    if (!siteId) return { missing: ["PLAUSIBLE_SITE_ID (or JBL_ANALYTICS_SITE_ID)"] };
    return { config: { provider: "plausible", host: statsOrigin(clean(env.PLAUSIBLE_HOST) || PLAUSIBLE_DEFAULT_HOST, "PLAUSIBLE_HOST"), apiKey: plausibleKey, siteId } };
  }
  const umamiKey = clean(env.UMAMI_API_KEY);
  if (umamiKey) {
    const websiteId = clean(env.UMAMI_WEBSITE_ID) || siteFallback;
    if (!websiteId) return { missing: ["UMAMI_WEBSITE_ID (or JBL_ANALYTICS_SITE_ID)"] };
    const host = clean(env.UMAMI_HOST);
    return { config: { provider: "umami", base: host ? `${statsOrigin(host, "UMAMI_HOST")}/api` : UMAMI_CLOUD_BASE, apiKey: umamiKey, websiteId, cloud: !host } };
  }
  return { missing: ["PLAUSIBLE_API_KEY or UMAMI_API_KEY"] };
}

/**
 * The period: the last `days` whole days up to today (UTC), as ISO dates and as epoch ms (start of the first day, now).
 * @param {number} days
 * @param {number} now
 * @returns {{ from: string, to: string, startAt: number, endAt: number }}
 */
export function statsPeriod(days, now) {
  const n = Math.max(1, Math.min(365, Math.round(days)));
  const today = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const start = today - (n - 1) * 86_400_000;
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString().slice(0, 10);
  return { from: iso(start), to: iso(today), startAt: start, endAt: now };
}

export const PLAUSIBLE_METRICS = ["visitors", "visits", "pageviews", "bounce_rate", "visit_duration"];

/**
 * The requests site-stats sends for this config and period.
 * @param {StatsConfig} config
 * @param {number} days
 * @param {number} now
 * @returns {StatsRequest[]}
 */
export function statsRequests(config, days, now) {
  const period = statsPeriod(days, now);
  if (config.provider === "plausible") {
    const headers = { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" };
    const url = `${config.host}/api/v2/query`;
    const range = [period.from, period.to];
    return [
      { name: "aggregate", url, method: /** @type {const} */ ("POST"), headers, body: JSON.stringify({ site_id: config.siteId, metrics: PLAUSIBLE_METRICS, date_range: range }) },
      { name: "goals", url, method: /** @type {const} */ ("POST"), headers, body: JSON.stringify({ site_id: config.siteId, metrics: ["visitors", "events"], date_range: range, dimensions: ["event:goal"] }) },
    ];
  }
  /** @type {Record<string, string>} */
  const headers = config.cloud ? { "x-umami-api-key": config.apiKey, Accept: "application/json" } : { Authorization: `Bearer ${config.apiKey}`, Accept: "application/json" };
  const site = `${config.base}/websites/${encodeURIComponent(config.websiteId)}`;
  const q = `startAt=${period.startAt}&endAt=${period.endAt}`;
  return [
    { name: "stats", url: `${site}/stats?${q}`, method: /** @type {const} */ ("GET"), headers },
    { name: "events", url: `${site}/metrics?type=event&${q}`, method: /** @type {const} */ ("GET"), headers },
  ];
}

/** A number, or Umami's {value} form of one; null otherwise. @param {unknown} v @returns {number | null} */
const numberOf = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const value = v && typeof v === "object" ? /** @type {{ value?: unknown }} */ (v).value : undefined;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * @typedef {{ visitors: number | null, visits: number | null, pageviews: number | null, bounceRate: number | null, visitDurationSec: number | null, events: Record<string, number> }} StatsSummary
 *   (events: the count of each event – goal – in the period, by name)
 */

/**
 * What site-stats prints of the answers (by request name): totals only.
 * @param {"plausible" | "umami"} provider
 * @param {Record<string, any>} answers
 * @returns {StatsSummary}
 */
export function statsSummary(provider, answers) {
  /** @type {Record<string, number>} */
  const events = {};
  if (provider === "plausible") {
    const row = answers.aggregate?.results?.[0]?.metrics ?? [];
    const at = (/** @type {string} */ name) => numberOf(row[PLAUSIBLE_METRICS.indexOf(name)]);
    for (const r of answers.goals?.results ?? []) {
      const name = typeof r.dimensions?.[0] === "string" ? r.dimensions[0].slice(0, 40) : null;
      const count = numberOf(r.metrics?.[1]);
      if (name && count !== null) events[name] = count;
    }
    return { visitors: at("visitors"), visits: at("visits"), pageviews: at("pageviews"), bounceRate: at("bounce_rate"), visitDurationSec: at("visit_duration"), events };
  }
  const s = answers.stats ?? {};
  for (const r of Array.isArray(answers.events) ? answers.events : []) {
    const count = numberOf(r.y);
    if (typeof r.x === "string" && count !== null) events[r.x.slice(0, 40)] = count;
  }
  const visits = numberOf(s.visits);
  const bounces = numberOf(s.bounces);
  const totaltime = numberOf(s.totaltime);
  return {
    visitors: numberOf(s.visitors),
    visits,
    pageviews: numberOf(s.pageviews),
    bounceRate: visits && bounces !== null ? Math.round((1000 * bounces) / visits) / 10 : null,
    visitDurationSec: visits && totaltime !== null ? Math.round(totaltime / visits) : null,
    events,
  };
}

/* ------------------------------------------------------------------ postiz-probe */

/**
 * The shape of analytics series – each label and how many points it has – and nothing of their values.
 * @param {readonly { label?: unknown, data?: unknown }[]} series
 * @returns {{ label: string, points: number }[]}
 */
export function seriesShapes(series) {
  return series.map((s) => ({ label: typeof s.label === "string" ? s.label.slice(0, 60) : "(no label)", points: Array.isArray(s.data) ? s.data.length : 0 }));
}

/**
 * POSTIZ_URL and POSTIZ_API_KEY, or the ones missing.
 * @param {Env} env
 * @returns {{ config: { baseUrl: string, apiKey: string } } | { missing: string[] }}
 */
export function postizConfigFromEnv(env) {
  const baseUrl = clean(env.POSTIZ_URL);
  const apiKey = clean(env.POSTIZ_API_KEY);
  const missing = [...(baseUrl ? [] : ["POSTIZ_URL"]), ...(apiKey ? [] : ["POSTIZ_API_KEY"])];
  return missing.length ? { missing } : { config: { baseUrl, apiKey } };
}

/**
 * A message with every occurrence of the key cut out.
 * @param {string} text
 * @param {string} secret
 * @returns {string}
 */
export function withoutSecret(text, secret) {
  return secret ? text.split(secret).join("[key]") : text;
}
