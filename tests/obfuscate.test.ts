import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  BANNER,
  EXCLUDED_CHUNK_PREFIXES,
  deleteSourceMaps,
  isExcludedChunk,
  obfuscateChunk,
  obfuscateExport,
  selectChunks,
} from "../scripts/obfuscate.mjs";

/**
 * --- code-obfuscation --- the build-time obfuscation of the static export (scripts/obfuscate.mjs): which chunks are
 * obfuscated and which loader chunks are skipped, the proprietary banner, the deletion of source maps, idempotency and
 * reproducibility – all on a tiny fake out/ tree in a temp dir (no real Next build needed).
 */

const tmpDirs: string[] = [];
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "obf-"));
  tmpDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fake export: loader chunks (to skip), app + numbered chunks (to obfuscate, wrapped like webpack modules so their
 * local identifiers rename away), out/sw.js (outside chunks/, must be untouched) and a stray .map (must be deleted). */
function fakeExport() {
  const out = tmpDir();
  const chunks = path.join(out, "_next", "static", "chunks");
  const sim = path.join(chunks, "app", "[locale]", "simulator");
  fs.mkdirSync(sim, { recursive: true });
  const write = (rel: string, body: string) => fs.writeFileSync(path.join(chunks, rel), body);
  for (const name of ["webpack", "framework", "main", "main-app", "polyfills"]) {
    write(`${name}-abc123.js`, `/* ${name} loader */ var keep = "PhysicsEngine"; console.log(keep);`);
  }
  write("123-abc123.js", "(function(){ function bounceMath(x){ return x * 2; } var FinderRequest = bounceMath(21); return FinderRequest; })();");
  write(
    "app/[locale]/simulator/page-abc123.js",
    "(function(){ class PhysicsEngine { step(){ return 42; } } var FinderRequest = new PhysicsEngine(); var bounceMath = FinderRequest.step(); return bounceMath; })();",
  );
  fs.writeFileSync(path.join(out, "sw.js"), "/* service worker */ var v = 'PhysicsEngine'; console.log(v);");
  fs.writeFileSync(path.join(chunks, "123-abc123.js.map"), "{}");
  return { out, chunks };
}

const base = (p: string) => path.basename(p);

describe("obfuscate: chunk selection", () => {
  it("skips exactly the loader chunks and selects the app and numbered chunks", () => {
    const { out } = fakeExport();
    const { obfuscate, skip } = selectChunks(out);
    expect(skip.map(base).sort()).toEqual(["framework-abc123.js", "main-abc123.js", "main-app-abc123.js", "polyfills-abc123.js", "webpack-abc123.js"]);
    expect(obfuscate.map(base).sort()).toEqual(["123-abc123.js", "page-abc123.js"]);
    // out/sw.js lives outside chunks/, so it is neither selected nor skipped (and never obfuscated).
    expect([...obfuscate, ...skip].some((p) => base(p) === "sw.js")).toBe(false);
  });

  it("isExcludedChunk matches only the loader prefixes", () => {
    expect(EXCLUDED_CHUNK_PREFIXES).toEqual(["webpack-", "framework-", "main-", "main-app-", "polyfills-"]);
    for (const name of ["webpack-x.js", "framework-x.js", "main-x.js", "main-app-x.js", "polyfills-x.js"]) expect(isExcludedChunk(name)).toBe(true);
    for (const name of ["123-x.js", "page-x.js", "4bd1b696-x.js", "app-x.js"]) expect(isExcludedChunk(name)).toBe(false);
  });
});

describe("obfuscate: obfuscation in place", () => {
  it("banners and obfuscates app chunks, leaves loader chunks and sw.js, deletes .map", () => {
    const { out, chunks } = fakeExport();
    const webpackBefore = fs.readFileSync(path.join(chunks, "webpack-abc123.js"), "utf8");
    const swBefore = fs.readFileSync(path.join(out, "sw.js"), "utf8");

    const report = obfuscateExport(out);
    expect(report.count).toBe(2);
    expect(report.skipped.length).toBe(5);
    expect(report.mapsDeleted).toEqual(["_next/static/chunks/123-abc123.js.map"]);
    expect(fs.existsSync(path.join(chunks, "123-abc123.js.map"))).toBe(false);

    const simChunk = fs.readFileSync(path.join(chunks, "app", "[locale]", "simulator", "page-abc123.js"), "utf8");
    expect(simChunk.startsWith(BANNER)).toBe(true);
    for (const id of ["PhysicsEngine", "bounceMath", "FinderRequest"]) expect(simChunk).not.toContain(id);

    const numbered = fs.readFileSync(path.join(chunks, "123-abc123.js"), "utf8");
    expect(numbered.startsWith(BANNER)).toBe(true);
    for (const id of ["bounceMath", "FinderRequest"]) expect(numbered).not.toContain(id);

    // Loader chunks and sw.js are byte-for-byte untouched and carry no banner.
    expect(fs.readFileSync(path.join(chunks, "webpack-abc123.js"), "utf8")).toBe(webpackBefore);
    expect(fs.readFileSync(path.join(out, "sw.js"), "utf8")).toBe(swBefore);
    expect(fs.readFileSync(path.join(chunks, "framework-abc123.js"), "utf8").startsWith(BANNER)).toBe(false);
  });

  it("is idempotent: a second pass re-banners nothing", () => {
    const { out, chunks } = fakeExport();
    obfuscateExport(out);
    const once = fs.readFileSync(path.join(chunks, "123-abc123.js"), "utf8");
    const report2 = obfuscateExport(out);
    expect(report2.count).toBe(0);
    expect(fs.readFileSync(path.join(chunks, "123-abc123.js"), "utf8")).toBe(once);
    expect(once.split(BANNER).length - 1).toBe(1); // exactly one banner
  });

  it("obfuscateChunk is reproducible for a given file name and always banners", () => {
    const src = "(function(){ var secret = { PhysicsEngine: 1 }; return secret.PhysicsEngine; })();";
    const a = obfuscateChunk(src, { name: "page-abc.js" });
    const b = obfuscateChunk(src, { name: "page-abc.js" });
    expect(a).toBe(b); // seeded by the file name
    expect(a.startsWith(BANNER)).toBe(true);
    const c = obfuscateChunk(src, { name: "page-xyz.js" });
    expect(c.startsWith(BANNER)).toBe(true);
    // Already-banner'd input is returned unchanged (guards a double pass).
    expect(obfuscateChunk(a, { name: "page-abc.js" })).toBe(a);
  });

  it("deleteSourceMaps removes only .map files", () => {
    const out = tmpDir();
    fs.mkdirSync(path.join(out, "a"), { recursive: true });
    fs.writeFileSync(path.join(out, "a", "x.js.map"), "{}");
    fs.writeFileSync(path.join(out, "a", "x.js"), "1");
    expect(deleteSourceMaps(out)).toEqual(["a/x.js.map"]);
    expect(fs.existsSync(path.join(out, "a", "x.js"))).toBe(true);
    expect(fs.existsSync(path.join(out, "a", "x.js.map"))).toBe(false);
  });

  it("the banner is the proprietary notice", () => {
    expect(BANNER).toBe("/*! JumpingBallsLive - proprietary software. Copying, modification, reverse engineering and reuse are prohibited. */");
  });
});
