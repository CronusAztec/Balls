/*
 * --- canonical-redirects --- The site's Worker script. The static export in ./out is served by Workers static assets
 * (wrangler.toml, [assets]); with `run_worker_first` every request passes through here first, so the two canonical redirects
 * that used to need the Cloudflare dashboard (SSL/TLS → "Always Use HTTPS", a Redirect Rule from www) live in the repository:
 *   http://…            → https://…            (same host, path and query)
 *   https://www.<host>/ → https://<host>/      (same path and query)
 * Everything else is handed to the assets binding unchanged. Local addresses (wrangler dev, tests) are never redirected to https.
 * Tested by tests/workerRedirects.test.ts; the live check is `npm run launch:check` (A10).
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);

/** The address a request must be redirected to (301), or null when it is already canonical. */
export function redirectFor(urlString) {
  const url = new URL(urlString);
  let changed = false;
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    url.protocol = "https:";
    url.port = ""; // the default port of https, whatever http used
    changed = true;
  }
  if (url.hostname.startsWith("www.") && url.hostname.length > 4) {
    url.hostname = url.hostname.slice(4);
    changed = true;
  }
  return changed ? url.toString() : null;
}

const worker = {
  /** @param {Request} request @param {{ ASSETS: { fetch(request: Request): Promise<Response> } }} env */
  async fetch(request, env) {
    const to = redirectFor(request.url);
    if (to) return Response.redirect(to, 301);
    return env.ASSETS.fetch(request);
  },
};

export default worker;
