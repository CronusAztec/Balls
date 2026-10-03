// HTTP plumbing: CORS, JSON responses, a body-size limit, stable error codes and a tiny router.
// No framework — just the Fetch API the Workers runtime already provides.

/** The largest request body the Worker will read, in bytes. */
export const MAX_BODY_BYTES = 20 * 1024;

/**
 * Whether an Origin is allowed: the configured SITE_ORIGIN, or any localhost / 127.0.0.1 origin on
 * any port (so the site can be developed locally against a deployed Worker). A missing Origin (same
 * origin, curl, a server-to-server webhook) is allowed through with no CORS headers.
 */
export function isAllowedOrigin(origin: string | null, siteOrigin: string | undefined): boolean {
  if (!origin) return false;
  if (siteOrigin && origin === siteOrigin.replace(/\/$/, "")) return true;
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if ((url.protocol === "http:" || url.protocol === "https:") &&
        (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1")) {
      return true;
    }
  } catch {
    // not a URL
  }
  return false;
}

/**
 * The Windows app's origin: it loads the site's static export from its own app:// protocol
 * (desktop/src/protocol.ts, APP_ORIGIN), so its pricing page and Restore call the Worker from there. No
 * web page can claim this origin, so granting it CORS lets only the app read the answers. It is never a
 * returnUrl (validateReturnUrl takes http(s) pages of the site only).
 */
export const DESKTOP_APP_ORIGIN = "app://jumpingballslive";

/** Whether a request Origin may read the answers: the site, localhost, or the Windows app. */
export function isCorsOrigin(origin: string | null, siteOrigin: string | undefined): boolean {
  return origin === DESKTOP_APP_ORIGIN || isAllowedOrigin(origin, siteOrigin);
}

/** The CORS headers for a given request Origin (empty when the Origin is not allowed). */
export function corsHeaders(origin: string | null, siteOrigin: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { Vary: "Origin" };
  if (isCorsOrigin(origin, siteOrigin) && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return headers;
}

/** A JSON response carrying the CORS headers. */
export function json(
  body: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors },
  });
}

/** A `{ error, message }` response. Codes are stable; messages never leak secrets or provider text. */
export function errorResponse(
  code: string,
  message: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return json({ error: code, message }, status, cors);
}

/** Thrown inside a handler to return a `{ error, message }` response with the given status. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/**
 * Read a request body as text, refusing anything over MAX_BODY_BYTES. Checks the Content-Length
 * header first, then the actual byte length (a chunked body has no length header).
 */
export async function readBodyText(request: Request): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared && Number(declared) > MAX_BODY_BYTES) {
    throw new ApiError("body_too_large", "Request body is too large.", 413);
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ApiError("body_too_large", "Request body is too large.", 413);
  }
  return text;
}

/** Read and parse a JSON body (object), within the size limit. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await readBodyText(request);
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError("invalid_json", "Request body is not valid JSON.", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ApiError("invalid_json", "Request body must be a JSON object.", 400);
  }
  return parsed as Record<string, unknown>;
}

export type RouteHandler = (request: Request, rawPath: string) => Promise<Response>;

interface Route {
  method: string;
  path: string;
  handler: RouteHandler;
}

/**
 * A minimal exact-path router. Dispatches on method + path, answers OPTIONS preflight, and tells a
 * 404 (unknown path) apart from a 405 (known path, wrong method). The caller passes the CORS headers
 * so every response — hits, misses and errors alike — carries them.
 */
export class Router {
  private routes: Route[] = [];

  add(method: string, path: string, handler: RouteHandler): this {
    this.routes.push({ method, path, handler });
    return this;
  }

  get(path: string, handler: RouteHandler): this {
    return this.add("GET", path, handler);
  }

  post(path: string, handler: RouteHandler): this {
    return this.add("POST", path, handler);
  }

  async handle(request: Request, cors: Record<string, string>): Promise<Response> {
    const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const samePath = this.routes.filter((r) => r.path === path);
    if (samePath.length === 0) {
      return errorResponse("not_found", "No such endpoint.", 404, cors);
    }
    const route = samePath.find((r) => r.method === request.method);
    if (!route) {
      const allow = [...new Set(samePath.map((r) => r.method)), "OPTIONS"].join(", ");
      return new Response(
        JSON.stringify({ error: "method_not_allowed", message: "Method not allowed." }),
        { status: 405, headers: { "Content-Type": "application/json; charset=utf-8", Allow: allow, ...cors } },
      );
    }

    try {
      return await route.handler(request, path);
    } catch (err) {
      if (err instanceof ApiError) {
        return errorResponse(err.code, err.message, err.status, cors);
      }
      // Never surface an unexpected error's text (it might carry a provider response).
      return errorResponse("internal_error", "Something went wrong.", 500, cors);
    }
  }
}
