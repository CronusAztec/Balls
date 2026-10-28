import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { CLIENT_BUILD, MARKER, findBuilds, fixLines, patchSource } from "../scripts/patch-react-hydration-replay.mjs";

/**
 * --- react-hydration-replay --- The hydration replay bug of the React that Next 15 bundles, and the patch that fixes it
 * (scripts/patch-react-hydration-replay.mjs, run on install).
 *
 * In Chromium: Next's own scheduler, react and react-dom/client production builds (loaded through a small CommonJS shim)
 * hydrate server HTML, inside startTransition as Next does, where a host element's child is a lazy whose _init throws a
 * thenable that turns fulfilled during React's yield. React then replays the host element; the build as Next ships it matches
 * the element against its own first child ("Minified React error #418 (args HTML)") and renders the page again on the
 * client, the patched build keeps the server's nodes. HYDRATION_REPLAY_CLIENT_BUILD=<file> loads another react-dom-client
 * production build in place of Next's, for example the original from `npm pack next@15.5.26`, on which the first check
 * fails. The rendered checks are skipped when Chromium cannot start (a failure with JBL_REQUIRE_BROWSER=1).
 *
 * Without a browser: every bundled build carries the fix, the inserted lines are React 19.3's own, and the script patches a
 * copy once, leaves it alone the second time and stops naming the file when it finds neither text. Once Next bundles React
 * 19.3 or later (Next 16.2+), the script goes and so do the checks that read its marker.
 */

const ROOT = path.resolve(__dirname, "..");
const NEXT = path.join(ROOT, "node_modules", "next");
const COMPILED = path.join(NEXT, "dist", "compiled");
const SCRIPT = path.join(ROOT, "scripts", "patch-react-hydration-replay.mjs");
const read = (file: string) => fs.readFileSync(file, "utf8");
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Why a build of Next's React can lack the patch, and what to run: npm runs the postinstall only for a plain install. */
const NOT_PATCHED = "Next's bundled React is not patched: npm runs the postinstall only for a plain `npm install` or `npm ci`, and `npm install <package>`, `npm update`, `npm audit fix` and --ignore-scripts skip it. Run `npm install` or `node scripts/patch-react-hydration-replay.mjs`";

/** A build as Next ships it: the patch only inserts lines, so taking them out again gives the original. */
function withoutPatch(text: string): string {
  const m = new RegExp(`^([ \\t]*)${escapeRegExp(MARKER)}\\n[ \\t]*var fiber = ([A-Za-z_$][\\w$]*);\\n`, "m").exec(text);
  if (!m) throw new Error(`the build carries no patch to take out. ${NOT_PATCHED}`);
  const block = fixLines(m[2], m[1]);
  if (text.slice(m.index, m.index + block.length) !== block) throw new Error("the patched lines differ from the script's");
  return text.slice(0, m.index) + text.slice(m.index + block.length);
}

/** `case 5:` up to `default:` in replaySuspendedUnitOfWork (or replayBeginWork), each line trimmed. */
function case5(text: string): string[] {
  const start = text.indexOf("function replaySuspendedUnitOfWork(");
  const end = text.indexOf("function throwAndUnwindWorkLoop(", start);
  const region = text.slice(start, end);
  const from = region.indexOf("case 5:");
  return region.slice(from, region.indexOf("default:", from)).split("\n").map((line) => line.trim()).filter(Boolean);
}

describe("the hydration replay patch of Next's bundled React", () => {
  const builds = findBuilds(NEXT);

  it("is in every react-dom build Next bundles that replays suspended work, the export's client build among them", () => {
    expect(builds).toContain(path.join(NEXT, CLIENT_BUILD));
    expect(builds.map((file) => path.relative(COMPILED, file))).toEqual(expect.arrayContaining([
      path.join("react-dom", "cjs", "react-dom-client.production.js"),
      path.join("react-dom", "cjs", "react-dom-client.development.js"),
      path.join("react-dom", "cjs", "react-dom-profiling.profiling.js"),
    ]));
    for (const file of builds) {
      const text = read(file);
      expect(patchSource(text, file).status, `${file}: ${NOT_PATCHED}`).toBe("already-patched");
      expect(text.split(MARKER).length - 1, file).toBe(1);
      expect(case5(text)[2], file).toBe(MARKER.trim()); // right after case 5: and resetHooksOnUnwind(...)
    }
  });

  it("inserts React 19.3's own lines (node_modules/react-dom, React 19.3)", () => {
    const upstreamFile = path.join(ROOT, "node_modules", "react-dom", "cjs", "react-dom-client.production.js");
    const upstream = read(upstreamFile);
    expect(patchSource(upstream).status).toBe("upstream");
    const ours = case5(read(path.join(NEXT, CLIENT_BUILD))).filter((line) => line !== MARKER.trim());
    expect(ours).toEqual(case5(upstream));
  });

  it("patches a copy of the builds as Next ships them once, then leaves them alone", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-hydration-replay-"));
    try {
      const copy = path.join(tmp, "next");
      const copies = builds.map((file) => {
        const target = path.join(copy, path.relative(NEXT, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, withoutPatch(read(file)));
        return { file, target };
      });
      const run = () => spawnSync(process.execPath, [SCRIPT, "--next-dir", copy], { encoding: "utf8" });
      const first = run();
      expect(first.status, first.stderr).toBe(0);
      const lines = first.stdout.trim().split("\n");
      expect(lines).toHaveLength(copies.length);
      for (const line of lines) expect(line).toMatch(/^patch-react-hydration-replay: next\/dist\/compiled\/react-dom(-experimental)?\/cjs\/[\w.-]+\.js: patched$/);
      for (const { file, target } of copies) expect(read(target) === read(file), target).toBe(true); // the installed builds, byte for byte
      const mtimes = copies.map(({ target }) => fs.statSync(target).mtimeMs);
      const second = run();
      expect(second.status, second.stderr).toBe(0);
      expect(second.stdout.trim().split("\n")).toEqual(lines.map((line) => line.replace(/: patched$/, ": already patched, nothing to do")));
      expect(copies.map(({ target }) => fs.statSync(target).mtimeMs)).toEqual(mtimes);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("stops the install naming the file when neither the old lines nor the fix are there, and writes nothing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-hydration-replay-"));
    try {
      const copy = path.join(tmp, "next");
      for (const file of builds) {
        const target = path.join(copy, path.relative(NEXT, file));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const original = withoutPatch(read(file));
        // A future React whose case 5 reads differently.
        fs.writeFileSync(target, file.endsWith(CLIENT_BUILD) ? original.replace(/resetHooksOnUnwind\(next\);\n/, "resetHooksOnUnwind(next);\n      somethingNew(next);\n") : original);
      }
      const before = builds.map((file) => read(path.join(copy, path.relative(NEXT, file))));
      const result = spawnSync(process.execPath, [SCRIPT, "--next-dir", copy], { encoding: "utf8" });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("next/dist/compiled/react-dom/cjs/react-dom-client.production.js");
      expect(result.stderr).toContain("React 19.3 or later (Next 16.2+)");
      expect(builds.map((file) => read(path.join(copy, path.relative(NEXT, file))))).toEqual(before);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

/** Next's scheduler, react and react-dom production builds plus `client`, as CommonJS modules behind window.__nextReact. */
function reactPage(client: string): string {
  const modules: Record<string, string> = {
    "next/dist/compiled/scheduler": read(path.join(COMPILED, "scheduler", "cjs", "scheduler.production.js")),
    "next/dist/compiled/react": read(path.join(COMPILED, "react", "cjs", "react.production.js")),
    "next/dist/compiled/react-dom": read(path.join(COMPILED, "react-dom", "cjs", "react-dom.production.js")),
    "next/dist/compiled/react-dom/client": client,
  };
  const defs = Object.entries(modules).map(([id, source]) => `${JSON.stringify(id)}: function (module, exports, require) {\n${source}\n}`).join(",\n");
  return `(function () {
    var defs = {${defs}};
    var cache = {};
    function require(id) {
      if (!(id in defs)) throw new Error("no module " + id);
      if (!cache[id]) { var module = { exports: {} }; cache[id] = module; defs[id](module, module.exports, require); }
      return cache[id].exports;
    }
    window.__nextReact = { React: require("next/dist/compiled/react"), ReactDOMClient: require("next/dist/compiled/react-dom/client") };
  })();`;
}

interface Hydration {
  committed: boolean;
  recoverable: string[];
  otherErrors: string[];
  sameHost: boolean;
  sameChild: boolean;
  html: string;
}

describe("hydration replay in Chromium", () => {
  let browser: Browser | null = null;

  beforeAll(async () => {
    try {
      const { chromium } = await import("playwright");
      browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
    } catch (err) {
      // --- ai-guard --- JBL_REQUIRE_BROWSER=1 (the core guard sets it) makes a missing Chromium a failure, never a silent skip
      if (process.env.JBL_REQUIRE_BROWSER === "1") throw new Error(`JBL_REQUIRE_BROWSER=1: Chromium did not start for the hydration replay checks: ${String(err)}`);
      console.warn("Chromium is not available – the hydration replay checks are skipped:", err);
      browser = null;
    }
  }, 120000);
  afterAll(async () => {
    await browser?.close();
  });

  /** Hydrates <div id="host"><span id="server-child">server</span></div> with the span behind a lazy row, on `client`. */
  async function hydrate(client: string): Promise<Hydration> {
    const page = await browser!.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") pageErrors.push(msg.text());
    });
    try {
      await page.setContent('<!doctype html><html><body><div id="root"><div id="host"><span id="server-child">server</span></div></div></body></html>');
      await page.addScriptTag({ content: reactPage(client) });
      const result = await page.evaluate(async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { React, ReactDOMClient } = (window as any).__nextReact;
        const h = React.createElement;
        const container = document.getElementById("root")!;
        const host = document.getElementById("host");
        const serverChild = document.getElementById("server-child");
        const recoverable: string[] = [];
        const otherErrors: string[] = [];
        const message = (err: unknown) => String((err as Error)?.message ?? err);
        let committed: () => void = () => undefined;
        const commit = new Promise<void>((resolve) => (committed = resolve));
        function Child() {
          React.useEffect(() => committed(), []);
          return h("span", { id: "server-child" }, "server");
        }
        // A server-component row still streaming in: a thenable with React's status fields, fulfilled in a microtask,
        // that is while React yields to the browser after the first attempt suspended on it.
        const listeners: Array<(value: unknown) => void> = [];
        const row: { status: string; value: unknown; then: (ok: (value: unknown) => void) => void } = {
          status: "pending",
          value: undefined,
          then(ok) {
            if (row.status === "fulfilled") ok(row.value);
            else listeners.push(ok);
          },
        };
        let scheduled = false;
        const lazy = {
          $$typeof: Symbol.for("react.lazy"),
          _payload: row,
          _init(payload: typeof row) {
            if (payload.status === "fulfilled") return payload.value;
            if (!scheduled) {
              scheduled = true;
              queueMicrotask(() => {
                payload.status = "fulfilled";
                payload.value = h(Child);
                for (const ok of listeners.splice(0)) ok(payload.value);
              });
            }
            throw payload;
          },
        };
        React.startTransition(() => {
          ReactDOMClient.hydrateRoot(container, h("div", { id: "host" }, lazy), {
            onRecoverableError: (err: unknown) => recoverable.push(message(err)),
            onCaughtError: (err: unknown) => otherErrors.push(message(err)),
            onUncaughtError: (err: unknown) => otherErrors.push(message(err)),
          });
        });
        const done = await Promise.race([commit.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000))]);
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          committed: done,
          recoverable,
          otherErrors,
          sameHost: document.getElementById("host") === host,
          sameChild: document.getElementById("server-child") === serverChild,
          html: container.innerHTML,
        };
      });
      return { ...result, otherErrors: [...result.otherErrors, ...pageErrors] };
    } finally {
      await page.close();
    }
  }

  it("keeps the server's nodes when a host element that suspended on a lazy row is replayed (Next's patched build)", async (ctx) => {
    if (!browser) return ctx.skip();
    const clientFile = process.env.HYDRATION_REPLAY_CLIENT_BUILD || path.join(NEXT, CLIENT_BUILD);
    const r = await hydrate(read(clientFile));
    expect(r.committed).toBe(true);
    expect(r.recoverable).toEqual([]);
    expect(r.otherErrors).toEqual([]);
    expect(r.sameHost).toBe(true);
    expect(r.sameChild).toBe(true);
    expect(r.html).toBe('<div id="host"><span id="server-child">server</span></div>');
  }, 60000);

  it("reproduces the mismatch on the build as Next ships it (the patch's lines taken out)", async (ctx) => {
    if (!browser) return ctx.skip();
    const r = await hydrate(withoutPatch(read(path.join(NEXT, CLIENT_BUILD))));
    expect(r.committed).toBe(true);
    expect(r.recoverable).toHaveLength(1);
    expect(r.recoverable[0]).toContain("Minified React error #418");
    expect(r.recoverable[0]).toContain("args[]=HTML");
    expect(r.sameChild).toBe(false); // React threw the server HTML away and rendered on the client
    expect(r.html).toBe('<div id="host"><span id="server-child">server</span></div>');
  }, 60000);
});
