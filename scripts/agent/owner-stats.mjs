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
 *  postiz-probe – which analytics series the owner's Postiz returns: series labels and point counts, never the numbers; per
 *   recent post also its age in hours, whether it asked to be a Trial Reel, whether each series' total is above zero (yes or
 *   no) and whether the per-post route answers (Postiz 2.18.0 or newer).
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

/* ------------------------------------------------------------------ postiz-probe: the pilot's per-post facts (C10) */
// --- insights --- The owner's pilot (L0): what it needs from each recent post (docs/agents/CLI.md, "Owner-run commands"; docs/
// SOCIAL-AUTOPILOT.md, section 6): its age, whether it asked to be a Trial Reel, and whether each of its series' totals is
// above zero – yes or no, never the total – plus whether the per-post route answers at all (Postiz 2.18.0 or newer). The
// shapes are Postiz's own (gitroomhq/postiz-app, read at 64f00fd6): GET /public/v1/posts answers {posts: [...]} with each
// post's `settings` as the JSON text it was created with; GET /public/v1/analytics/post/:id answers
// [{label, percentageChange, data: [{total: "<text>", date}]}], [] (no numbers yet, the platform withholds them, or Postiz
// could not read them) or {missing: true} (Postiz lost the post's id on the platform); a Postiz older than 2.18.0 has no
// such route and answers 404.

/** What a 404 on the per-post route means. */
export const POST_ROUTE_OLDER = "your Postiz is older than 2.18: no per-post numbers";
/** What an answer of the per-post route means. */
export const POST_ROUTE_ANSWERS = "GET /public/v1/analytics/post/:id answers: Postiz 2.18.0 or newer";

/**
 * Each error kind the probe prints – the Windows app's PostizError codes – in its own words. Postiz's message is never printed:
 * it can carry a post id, a platform's text or a request address.
 */
export const POSTIZ_ERROR_KINDS = Object.freeze({
  badUrl: "the Postiz address is not valid",
  network: "Postiz could not be reached, or did not answer in time",
  unauthorized: "Postiz does not accept this API key",
  noSubscription: "this Postiz workspace has no active subscription",
  forbidden: "Postiz refused this for this key",
  notFound: "Postiz does not know this route or item",
  tooLarge: "Postiz's answer was too large",
  rateLimited: "Postiz asks for a pause (too many requests): run the probe again in an hour",
  badRequest: "Postiz did not accept the request",
  server: "Postiz answered with an error on its side",
  unknown: "Postiz answered unexpectedly",
});

/**
 * An error by its kind: the client's code, the HTTP status and what it means – never the error's message.
 * @param {unknown} error
 * @param {{ postRoute?: boolean }} [options] postRoute: a call of GET /analytics/post/:id, where a 404 means a Postiz older than 2.18
 * @returns {{ kind: string, status: number | null, meaning: string }}
 */
export function errorKind(error, { postRoute = false } = {}) {
  const e = /** @type {{ code?: unknown, status?: unknown }} */ (error && typeof error === "object" ? error : {});
  const kind = typeof e.code === "string" && Object.hasOwn(POSTIZ_ERROR_KINDS, e.code) ? e.code : "unknown";
  const status = typeof e.status === "number" && Number.isInteger(e.status) ? e.status : null;
  const routeMissing = postRoute && (status === 404 || (status === null && kind === "notFound"));
  return { kind, status, meaning: routeMissing ? POST_ROUTE_OLDER : POSTIZ_ERROR_KINDS[/** @type {keyof typeof POSTIZ_ERROR_KINDS} */ (kind)] };
}

/**
 * Whole hours since the post's publishDate (an ISO time), or null when Postiz gave none that reads.
 * @param {unknown} publishDate
 * @param {number} now
 * @returns {number | null}
 */
export function ageHours(publishDate, now) {
  const at = typeof publishDate === "string" ? Date.parse(publishDate) : NaN;
  return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 3_600_000)) : null;
}

/** The two graduation strategies Postiz takes for a Trial Reel: MANUAL ("I share it myself") and SS_PERFORMANCE (Instagram shares it if it does well). */
export const GRADUATIONS = Object.freeze(["MANUAL", "SS_PERFORMANCE"]);

/**
 * What a post asked Postiz for in its settings (the JSON text Postiz answers with, or an object): whether it is a Trial Reel
 * – is_trial_reel read as Postiz reads it (true, or the text "true" in any case) – and, for a trial, its graduation strategy
 * ("not set": Postiz then sends MANUAL; "other": a value Postiz would refuse, never echoed). This is what was asked, not proof
 * that Instagram treated the post so. "unknown": the answer carried no settings, or none that read.
 * @param {unknown} settings
 * @returns {{ trialReel: "yes" | "no" | "unknown", graduation?: "MANUAL" | "SS_PERFORMANCE" | "not set" | "other" }}
 */
export function trialAsked(settings) {
  if (settings === undefined) return { trialReel: "unknown" };
  let s = settings;
  if (typeof s === "string") {
    if (!s.trim()) return { trialReel: "no" };
    try {
      s = JSON.parse(s);
    } catch {
      return { trialReel: "unknown" };
    }
  }
  if (s === null) return { trialReel: "no" };
  if (typeof s !== "object" || Array.isArray(s)) return { trialReel: "unknown" };
  const asked = /** @type {Record<string, unknown>} */ (s).is_trial_reel;
  if (!(typeof asked === "string" ? asked.toLowerCase() === "true" : Boolean(asked))) return { trialReel: "no" };
  const g = /** @type {Record<string, unknown>} */ (s).graduation_strategy;
  const graduation = g === "MANUAL" || g === "SS_PERFORMANCE" ? g : g === undefined || g === null || g === "" ? "not set" : "other";
  return { trialReel: "yes", graduation };
}

/**
 * The facts of a post's series: each label, how many points it has, and whether its total is above zero ("yes" or "no",
 * never the total). The total is the series' own, else the sum of its points (Postiz sends each point's total as text).
 * @param {readonly { label?: unknown, total?: unknown, data?: unknown, [key: string]: unknown }[]} series (Postiz's own fields, percentageChange among them, are let through and never read)
 * @returns {{ label: string, points: number, aboveZero: "yes" | "no" }[]}
 */
export function seriesFacts(series) {
  return seriesShapes(series).map((shape, i) => {
    const s = series[i];
    const points = Array.isArray(s.data) ? s.data : [];
    const own = s.total;
    const total = typeof own === "number" || (typeof own === "string" && own.trim() !== "") ? Number(own) : points.reduce((n, p) => n + (Number(p && typeof p === "object" ? p.total : NaN) || 0), 0);
    return { ...shape, aboveZero: total > 0 ? "yes" : "no" };
  });
}

/**
 * What the per-post route answered, from its raw JSON: "series" (at least one series), "empty" (none: no numbers yet, the
 * platform withholds them, or Postiz could not read them – Postiz answers [] for all three), "missing" ({missing: true}:
 * Postiz lost the post's id on the platform) or "unreadable".
 * @param {unknown} raw
 * @returns {"series" | "empty" | "missing" | "unreadable"}
 */
export function postAnswerKind(raw) {
  if (Array.isArray(raw)) return raw.length ? "series" : "empty";
  if (raw && typeof raw === "object") {
    const r = /** @type {Record<string, unknown>} */ (raw);
    if (r.missing === true) return "missing";
    if (Array.isArray(r.analytics)) return r.analytics.length ? "series" : "empty";
  }
  return "unreadable";
}

/**
 * Which of the two answers the probe reads raw a request asks for: the post list (…/public/v1/posts) or one post's numbers
 * (…/public/v1/analytics/post/<id>); null for any other.
 * @param {string} url
 * @returns {{ route: "posts" } | { route: "post", id: string } | null}
 */
export function rawRouteOf(url) {
  let pathname;
  try {
    pathname = new URL(url).pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
  if (/\/public\/v1\/posts$/.test(pathname)) return { route: "posts" };
  const m = /\/public\/v1\/analytics\/post\/([^/]+)$/.exec(pathname);
  if (!m) return null;
  try {
    return { route: "post", id: decodeURIComponent(m[1]) };
  } catch {
    return null;
  }
}

/**
 * Each post's settings by its id, from the raw answer of GET /posts ({posts: [...]}, or a bare list). A post without the
 * field is left out (its trial is then "unknown").
 * @param {unknown} raw
 * @returns {Map<string, unknown>}
 */
export function settingsById(raw) {
  const r = /** @type {Record<string, unknown> | null} */ (raw && typeof raw === "object" ? raw : null);
  const list = Array.isArray(raw) ? raw : r && Array.isArray(r.posts) ? r.posts : [];
  /** @type {Map<string, unknown>} */
  const out = new Map();
  for (const p of list) if (p && typeof p === "object" && typeof p.id === "string" && Object.hasOwn(p, "settings")) out.set(p.id, p.settings);
  return out;
}

/**
 * Whether the per-post route answers, from its calls in order: "yes" once one answered; "no" on a 404 (a Postiz older than
 * 2.18); "unknown" when every call failed otherwise (the last kind is named); "not asked" without a call.
 * @param {readonly ({ ok: true } | { ok: false, error: { kind: string, status: number | null, meaning: string } })[]} calls
 * @returns {{ answers: "yes" | "no" | "unknown" | "not asked", meaning: string }}
 */
export function postRouteOf(calls) {
  if (!calls.length) return { answers: "not asked", meaning: "no per-post call was made" };
  if (calls.some((c) => c.ok)) return { answers: "yes", meaning: POST_ROUTE_ANSWERS };
  const failed = /** @type {{ ok: false, error: { kind: string, status: number | null, meaning: string } }[]} */ (calls.filter((c) => !c.ok));
  if (failed.some((c) => c.error.meaning === POST_ROUTE_OLDER)) return { answers: "no", meaning: POST_ROUTE_OLDER };
  return { answers: "unknown", meaning: `no call to it succeeded (${failed[failed.length - 1].error.kind}): run the probe again later` };
}

/**
 * Whether a post's platform (its Postiz identifier) is the one asked for: the same, or a variant of it (instagram takes
 * instagram-standalone, tiktok takes tiktok-business). No platform asked: every post.
 * @param {unknown} platform
 * @param {string | undefined} wanted
 * @returns {boolean}
 */
export function platformMatches(platform, wanted) {
  if (!wanted) return true;
  return typeof platform === "string" && (platform === wanted || platform.startsWith(`${wanted}-`));
}

/** What the probe's per-post facts mean, printed with them. */
export const POST_NOTES = Object.freeze([
  "trialReel and graduation are what each post asked Postiz for (its settings is_trial_reel and graduation_strategy), not proof that Instagram treated it so: check the reel in the Instagram app",
  "graduation MANUAL is 'I share it myself'; SS_PERFORMANCE is Instagram's automatic sharing; 'not set' means Postiz sends MANUAL",
  "aboveZero says only whether a series' total is above zero: no value is printed",
  "ageHours counts whole hours from the post's publishDate",
  "answer: series (numbers came back), empty (none yet, the platform withholds them, or Postiz could not read them), missing (Postiz lost the post's id on the platform), error (by kind), skipped (not asked: the route is missing, or Postiz asked for a pause)",
]);
