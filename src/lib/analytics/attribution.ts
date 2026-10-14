// --- analytics --- the campaign parameters of an ad link (UTM names and the ad platforms' click ids) and how they are kept
/*
 * An ad click lands on a localised address such as /en/simulator/?utm_source=tiktok&gclid=abc. The studio mirrors its settings into
 * the address bar (Simulator.tsx, history.replaceState) and that used to rewrite the whole query, so the campaign was gone within
 * seconds, before any statistics script read it. The mirror now carries the names below over (`withAttribution`), and nothing else:
 * no storage, no cookie, no copy anywhere – the address bar is the only place the values live.
 *
 * Pure functions, no DOM: unit-tested in tests/analytics.test.ts.
 */

/** The query names kept through the settings mirror: UTM (utm_id is the platforms' campaign id) and the click ids Google, Meta, TikTok, Microsoft, X and Reddit append. */
export const ATTRIBUTION_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "ttclid",
  "msclkid",
  "twclid",
  "rdt_cid",
] as const;

export type AttributionParam = (typeof ATTRIBUTION_PARAMS)[number];

/** The longest value kept (a Meta click id is about 100 to 300 characters): a longer one is not a campaign value and is dropped, not cut. */
export const ATTRIBUTION_MAX_LENGTH = 512;

const ALLOWED: ReadonlySet<string> = new Set(ATTRIBUTION_PARAMS);

/** The allow-listed pairs of a query string (`?a=b` or `a=b`) or of URLSearchParams, in the order of `ATTRIBUTION_PARAMS`. */
export function preservedParams(search: string | URLSearchParams | null | undefined): URLSearchParams {
  const source = typeof search === "string" ? new URLSearchParams(search) : (search ?? new URLSearchParams());
  const out = new URLSearchParams();
  for (const name of ATTRIBUTION_PARAMS) {
    const value = source.get(name);
    if (value !== null && value !== "" && value.length <= ATTRIBUTION_MAX_LENGTH) out.set(name, value);
  }
  return out;
}

/**
 * `params` (the settings' own pairs) plus the campaign pairs of `search` (the address bar's current query), the settings' pairs
 * first. A settings pair is never replaced: the names cannot collide today (the settings' keys are short codes), and the
 * test keeps it that way.
 */
export function withAttribution(params: URLSearchParams, search: string | URLSearchParams | null | undefined): URLSearchParams {
  for (const [name, value] of preservedParams(search)) if (!params.has(name)) params.set(name, value);
  return params;
}

/** `href` without the campaign pairs (the link a visitor shares must not carry the ad that brought them). Unparseable input is returned as it is. */
export function withoutAttribution(href: string): string {
  try {
    const url = new URL(href);
    for (const name of ATTRIBUTION_PARAMS) url.searchParams.delete(name);
    return url.toString();
  } catch {
    return href;
  }
}

/** True for the names of `ATTRIBUTION_PARAMS`. */
export function isAttributionParam(name: string): name is AttributionParam {
  return ALLOWED.has(name);
}
