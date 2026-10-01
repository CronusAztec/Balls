/**
 * Minimal static server for the exported site (./out) that behaves like GitHub Pages:
 *  - serves the site under an optional base path (--base /Balls), 404 outside it,
 *  - redirects /dir to /dir/ and serves dir/index.html,
 *  - serves foo.html for /foo,
 *  - answers unknown URLs with out/404.html and status 404.
 *
 * Usage: node scripts/serve-static.mjs [--dir out] [--port 3000] [--base /Balls] [--host 127.0.0.1]
 * (defaults: PORT env or 3000; NEXT_PUBLIC_BASE_PATH from the shell or the .env files `next build` reads, else "";
 * every interface unless --host names one)
 */
import http from "http";
import fs from "fs";
import path from "path";
import { loadDotEnv } from "./dotenv.mjs";

loadDotEnv();
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : fallback;
};
const dir = path.resolve(opt("dir", "out"));
const port = Number(opt("port", process.env.PORT || 3000));
const base = String(opt("base", process.env.NEXT_PUBLIC_BASE_PATH || "")).replace(/\/+$/, "");
const host = opt("host", undefined); // --- review fix (site-static) --- e.g. --host 127.0.0.1 to keep `npm start` off the network

if (!fs.existsSync(dir)) {
  console.error(`serve-static: ${dir} does not exist – run \`npm run build\` first.`);
  process.exit(1);
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
};

function send(res, status, filePath) {
  const type = TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-cache" });
  // --- review fix (site-static) --- a read error (file gone, permissions) ends this response, never the server
  fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
}

function notFound(res) {
  const custom = path.join(dir, "404.html");
  if (fs.existsSync(custom)) return send(res, 404, custom);
  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("404 Not Found");
}

function redirect(res, location) {
  res.writeHead(301, { Location: location });
  res.end();
}

/** Control characters (a decoded %0a, %00…) never name a file of the export, and must never reach a header. */
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

function handle(req, res) {
  const url = new URL(req.url || "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return notFound(res);
  }
  if (CONTROL_CHARS.test(pathname)) return notFound(res); // --- review fix (site-static) ---
  if (base) {
    if (pathname === base) return redirect(res, `${base}/${url.search}`);
    if (!pathname.startsWith(`${base}/`)) return notFound(res);
    pathname = pathname.slice(base.length);
  }
  const resolved = path.resolve(dir, `.${pathname}`);
  if (resolved !== dir && !resolved.startsWith(dir + path.sep)) return notFound(res);

  const stat = fs.existsSync(resolved) ? fs.statSync(resolved) : null;
  if (stat?.isDirectory()) {
    // --- review fix (site-static) --- built from the still-encoded URL (ASCII only, base included), never the decoded path, with
    // the leading slashes collapsed so the Location can never be protocol-relative ("//host/…")
    if (!pathname.endsWith("/")) return redirect(res, `/${url.pathname.replace(/^\/+/, "")}/${url.search}`);
    const index = path.join(resolved, "index.html");
    return fs.existsSync(index) ? send(res, 200, index) : notFound(res);
  }
  if (stat?.isFile()) return send(res, 200, resolved);
  if (!pathname.endsWith("/") && fs.existsSync(`${resolved}.html`)) return send(res, 200, `${resolved}.html`);
  return notFound(res);
}

// --- review fix (site-static) --- one bad request answers 500 (or drops its connection) instead of taking the server down
const server = http.createServer((req, res) => {
  try {
    handle(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end();
    } else res.destroy();
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${path.relative(process.cwd(), dir) || "."} at http://${host && host !== "0.0.0.0" && host !== "::" ? host : "localhost"}:${port}${base}/`);
});
