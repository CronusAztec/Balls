import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MODE_IDS } from "@/lib/physics/types";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams } from "@/lib/settings";
import { clipStartSettings } from "@/lib/clipPacing";
import { modePageLooks } from "@/lib/modePages";
import { startQuery, startSettings } from "@/lib/studioLooks";

/*
 * --- pace-as-look --- The link base and the start look (lib/studioLooks.ts startSettings, startQuery). A link reads a mode on
 * its link base (`defaultSettings`): what `?mode=X` plays, and what every shared link, preset, project file and share code is
 * written against. The page itself starts a mode in its start look (`clipStartSettings` on top), and so does every link the
 * site writes into a mode: the start query names the start look's fields, so it plays the page's own first run.
 *  - (d) the start query of every mode reads back to its start look;
 *  - (h) no simulator link in the site's code is built by hand from `mode=${…}`: a bare mode link plays the link base, not the
 *    run the page starts in. The links that may name a mode are the start query, the card's and the picture's (cardQuery,
 *    heroQuery: their own settings and seed), a gallery preset's (galleryHref: its literal query) and a mode page's Challenge
 *    look (the daily deal's settings).
 */

const ROOT = path.resolve(__dirname, "..");

describe("(d) the start look as a link", () => {
  it("is the link base with the start look on top, for every mode", () => {
    for (const mode of MODE_IDS) expect(startSettings(mode), mode).toEqual({ ...defaultSettings(mode), ...clipStartSettings(mode) });
  });

  it("reads back to the start look for every mode, and names nothing for a mode without one", () => {
    for (const mode of MODE_IDS) {
      const params = new URLSearchParams(startQuery(mode));
      expect([mode, params.get("mode"), params.has("seed")]).toEqual([mode, mode, false]);
      expect(settingsFromSearchParams(params), mode).toEqual(startSettings(mode));
      expect(startQuery(mode)).toBe(settingsToSearchParams(startSettings(mode)).toString());
      if (Object.keys(clipStartSettings(mode)).length === 0) expect(startQuery(mode)).toBe(settingsToSearchParams(defaultSettings(mode)).toString());
    }
    // Classic's start look, the page's first run: the Ring Ladder pace with the ring sounds (its link base: gap 0.4 at 400, silent rings)
    expect(startQuery("classic")).toBe("mode=classic&s=500&gap=1&shake=0.3&glow=1&wbreak=all&resn=1");
    expect(settingsFromSearchParams(new URLSearchParams("mode=classic"))).toMatchObject({ gapSize: 0.4, ballSpeed: 400, ringSound: false });
  });

  it("is what a mode page's Plain look opens", () => {
    for (const mode of MODE_IDS) {
      const plain = modePageLooks(mode).find((look) => look.kind === "plain");
      expect([mode, plain?.href]).toEqual([mode, `/simulator?${startQuery(mode)}`]);
    }
  });
});

// --- (h) the site's own links into a mode ---
/** A place that may build a mode's link from `mode=${…}`: the file and the function around it. */
const LINK_BUILDERS: readonly { file: string; fn: string; why: string }[] = [
  { file: "src/lib/thumbnails/heroMoments.ts", fn: "cardQuery", why: "a card's link: its own settings and its picture's seed" },
  { file: "src/lib/thumbnails/heroMoments.ts", fn: "heroQuery", why: "a picture's link: its own settings and seed" },
  { file: "src/lib/modePages.ts", fn: "modePageLooks", why: "a mode page's Challenge look: the daily deal's settings (Plain is the start query)" },
  { file: "src/lib/studioLooks.ts", fn: "lookSettings", why: "reads a look's settings on the link base into settings: no link" },
];

/** The function a position of `text` sits in: the last `function name(` before it. */
function functionAt(text: string, at: number): string {
  let name = "";
  for (const m of text.slice(0, at).matchAll(/\bfunction\s+([A-Za-z0-9_$]+)\s*[(<]/g)) name = m[1];
  return name;
}

/** The hand-built mode links of a source file: `mode=${…}` (not `data-mode=${…}`) and a literal `/simulator?mode=`, outside comments. */
function handBuiltModeLinks(text: string): { line: number; fn: string; code: string }[] {
  const found: { line: number; fn: string; code: string }[] = [];
  let offset = 0;
  text.split("\n").forEach((code, i) => {
    const trimmed = code.trim();
    const comment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
    if (!comment) for (const m of code.matchAll(/(?<![\w-])mode=\$\{|\/simulator\?mode=/g)) found.push({ line: i + 1, fn: functionAt(text, offset + (m.index ?? 0)), code: trimmed });
    offset += code.length + 1;
  });
  return found;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("(h) the site's own links into a mode open its start look", () => {
  it("builds no simulator link by hand from a mode in src/app, src/lib or src/components", () => {
    const stray: string[] = [];
    const used = new Set<string>();
    for (const dir of ["src/app", "src/lib", "src/components"]) {
      for (const file of sourceFiles(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file).split(path.sep).join("/");
        for (const hit of handBuiltModeLinks(fs.readFileSync(file, "utf8"))) {
          const builder = LINK_BUILDERS.find((b) => b.file === rel && b.fn === hit.fn);
          if (builder) used.add(`${builder.file} ${builder.fn}`);
          else stray.push(`${rel}:${hit.line} (${hit.fn || "top level"}): ${hit.code}`);
        }
      }
    }
    expect(stray).toEqual([]);
    // every place the list names still builds one (a builder that moved or went is taken off the list, never left behind)
    expect([...used].sort()).toEqual(LINK_BUILDERS.map((b) => `${b.file} ${b.fn}`).sort());
  });

  it("would notice: a hand-built studio link, a bare literal one and a link built in a component", () => {
    const sample = [
      "export default function Page() {",
      "  return <Link href={`/simulator?mode=${mode}`} />;",
      "}",
      "function cta() {",
      '  return "/simulator?mode=classic";',
      "}",
      "// a comment about /simulator?mode=race is no link",
      "const css = `[data-mode=${mode}]{display:none}`;",
    ].join("\n");
    expect(handBuiltModeLinks(sample).map((hit) => [hit.line, hit.fn])).toEqual([
      [2, "Page"],
      [5, "cta"],
    ]);
    expect(handBuiltModeLinks("const q = [`mode=${mode}`, look].join(\"&\");").length).toBe(1);
  });

  it("opens the start look from the site's entry points: the TikTok page's button and the changelog's Try links", () => {
    const tiktok = fs.readFileSync(path.join(ROOT, "src/app/[locale]/tiktok-ball-videos/page.tsx"), "utf8");
    expect(tiktok).toContain('href={`/simulator?${startQuery("classic")}`}');
    expect(tiktok).toContain('data-track-id="tiktok_cta"');
    const changelog = fs.readFileSync(path.join(ROOT, "src/app/[locale]/changelog/page.tsx"), "utf8");
    expect(changelog).toContain("href={`/simulator?${startQuery(mode)}`}");
  });
});
// --- end (h) ---
