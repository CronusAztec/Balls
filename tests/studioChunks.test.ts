import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { STUDIO_DRAW_MODULE, STUDIO_PAGE_ENTRY, studioChunkSplit, studioDrawCacheGroup } from "../scripts/lib/studio-chunks.cjs";

/*
 * --- studio-chunk-split --- (finding g3-7) The offline studio. Obfuscated, the studio's page chunk had grown to 4.4 MB, over the
 * service worker's 4 MiB precache cap (scripts/pwa/build.mjs MAX_PRECACHE_FILE_BYTES), so the worker left it out and the studio did
 * not load offline. scripts/lib/studio-chunks.cjs moves the mode drawing into a numbered chunk of its own through next.config.ts's
 * webpack hook; this file keeps that group to the files it was measured on (every *Renderer.ts and Fight League's drawing, never the
 * canvas, the recorder, the watermark or the engine), to the studio's client production build, and wired in. It also keeps the second
 * half of the finding from coming back: an import() that takes the whole engine, settings or modes module keeps every export name of
 * it unshortened in every chunk (`new X.PhysicsEngine(` shipped in the studio's chunk, as the obfuscator keeps property names).
 * The built files themselves are checked by the static-hosting smoke block and tests/perfGuards.test.ts (a built export).
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const SIMULATOR = "src/components/simulator";

/** Every file under `dir` (relative to ROOT), as posix paths relative to ROOT. */
function walk(dir: string): string[] {
  const out: string[] = [];
  const recur = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) recur(child);
      else if (entry.isFile()) out.push(child);
    }
  };
  recur(dir);
  return out.sort();
}

describe("the studio's drawing chunk (studio-chunk-split)", () => {
  const all = walk("src");

  it("takes every mode renderer and every Fight League drawing file, and nothing else under src/", () => {
    const expected = all.filter((f) => {
      if (!f.startsWith(`${SIMULATOR}/`)) return false;
      const rel = path.posix.relative(SIMULATOR, f);
      const parts = rel.split("/");
      if (parts.length === 1) return path.posix.extname(rel) === ".ts" && path.posix.basename(rel, ".ts").endsWith("Renderer") && rel !== "Renderer.ts";
      return parts.length === 2 && parts[0] === "fightLeague" && path.posix.extname(parts[1]) === ".ts";
    });
    const matched = all.filter((f) => STUDIO_DRAW_MODULE.test(path.join(ROOT, f)));
    expect(matched).toEqual(expected);
    expect(expected.length).toBeGreaterThan(40); // never a vacuous pass
    expect(STUDIO_DRAW_MODULE.test("C:\\b\\src\\components\\simulator\\bullseyeRenderer.ts")).toBe(true);
  });

  it("never takes the files the studio needs at once or the watermark", () => {
    const kept = [
      `${SIMULATOR}/Canvas.tsx`,
      `${SIMULATOR}/Simulator.tsx`,
      `${SIMULATOR}/fastRenderCanvas.tsx`,
      `${SIMULATOR}/liveMarkHud.ts`,
      `${SIMULATOR}/splitScreenCanvas.tsx`,
      "src/lib/physics/director.ts",
      "src/lib/physics/engine.ts",
    ];
    for (const file of kept) {
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
      expect(STUDIO_DRAW_MODULE.test(path.join(ROOT, file)), file).toBe(false);
    }
    const watermark = walk("src/lib/watermark");
    const sections = walk(`${SIMULATOR}/sections`);
    expect(watermark.length).toBeGreaterThan(0);
    expect(sections.length).toBeGreaterThan(0);
    expect([...watermark, ...sections].filter((f) => STUDIO_DRAW_MODULE.test(path.join(ROOT, f)))).toEqual([]);
  });

  it("the studio's entry is the one Next builds", () => {
    expect(fs.existsSync(path.join(ROOT, "src/app/[locale]/simulator/page.tsx"))).toBe(true);
    expect(STUDIO_PAGE_ENTRY).toBe("app/[locale]/simulator/page");
  });

  it("adds the group to the client production build only, keeping Next's groups", () => {
    const fresh = () => ({ optimization: { splitChunks: { cacheGroups: { framework: {}, lib: {} } } as Record<string, unknown> } });
    for (const options of [{ dev: true, isServer: false }, { dev: false, isServer: true }]) {
      const config = fresh();
      expect(studioChunkSplit(config, options)).toBe(false);
      expect(config).toEqual(fresh());
    }
    const off = { optimization: { splitChunks: false } };
    expect(studioChunkSplit(off, { dev: false, isServer: false })).toBe(false);
    expect(off).toEqual({ optimization: { splitChunks: false } });
    const client = fresh();
    expect(studioChunkSplit(client, { dev: false, isServer: false })).toBe(true);
    expect(Object.keys(client.optimization.splitChunks.cacheGroups as Record<string, unknown>)).toEqual(["framework", "lib", "studioDraw"]);
  });

  it("the group: only the studio's entry, always split, below webpack's default group, unnamed", () => {
    const group = studioDrawCacheGroup();
    expect(group.chunks({ name: STUDIO_PAGE_ENTRY })).toBe(true);
    expect(group.chunks({ name: "app/[locale]/page" })).toBe(false);
    expect(group.chunks({ name: null })).toBe(false);
    expect(group.enforce).toBe(true);
    expect(group.priority).toBeLessThan(-20);
    expect("name" in group).toBe(false);
  });

  it("next.config.ts calls it from its webpack hook", () => {
    const code = read("next.config.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, "");
    expect(code).toMatch(/import \{[^}]*\bstudioChunkSplit\b[^}]*\} from "\.\/scripts\/lib\/studio-chunks\.cjs"/);
    expect(code).toMatch(/webpack:\s*\(config,\s*\{\s*dev,\s*isServer\s*\}\)\s*=>/);
    expect(code).toMatch(/studioChunkSplit\(config,\s*\{\s*dev,\s*isServer\s*\}\)/);
  });
});

/** --- studio-chunk-split --- The import() calls of the engine, the settings, the modes or the finder in `text` that take the whole module. */
function wholeModuleImports(text: string): { at: number; module: string }[] {
  const offenders: { at: number; module: string }[] = [];
  for (const m of text.matchAll(/import\(\s*(?:\/\*([\s\S]*?)\*\/\s*)?["'](@\/lib\/(?:physics|settings|simulation)[^"']*)["']\s*\)/g)) {
    const at = m.index ?? 0;
    const before = text.slice(Math.max(0, at - 80), at);
    if (/webpackExports\s*:/.test(m[1] ?? "")) continue; // names what it uses (or nothing)
    if (/(?:const|let|var)\s*\{[^}]*\}\s*=\s*await\s*$/.test(before)) continue; // destructured: webpack sees the names
    if (/typeof\s+$/.test(before)) continue; // a type query, erased
    offenders.push({ at, module: m[2] });
  }
  return offenders;
}

describe("no import() takes the whole engine, settings, modes or finder module (studio-chunk-split)", () => {
  it("no import() of the engine, the settings, the modes or the finder takes the whole module", () => {
    const files = walk("src").filter((f) => /\.tsx?$/.test(f));
    const offenders: string[] = [];
    let livePreviewHits = 0;
    for (const file of files) {
      const text = read(file);
      if (file === "src/components/site/LivePreview.tsx") livePreviewHits = [...text.matchAll(/import\(\s*(?:\/\*[\s\S]*?\*\/\s*)?["']@\/lib\/(?:physics|settings|simulation)[^"']*["']\s*\)/g)].length;
      for (const o of wholeModuleImports(text)) offenders.push(`${file}:${text.slice(0, o.at).split("\n").length} import("${o.module}")`);
    }
    expect(offenders).toEqual([]);
    expect(livePreviewHits).toBeGreaterThanOrEqual(8); // the live preview's ENGINE_STEPS: never a vacuous pass
  });

  it("would notice one", () => {
    expect(wholeModuleImports('() => import(/* webpackChunkName: "x" */ "@/lib/physics/engine")')).toHaveLength(1);
    expect(wholeModuleImports('const { PhysicsEngine } = await import("@/lib/physics/engine");')).toHaveLength(0);
  });
});
