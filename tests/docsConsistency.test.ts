import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { MODE_IDS } from "@/lib/physics/types";
import { MODE_CATEGORIES, MODE_CATEGORY_IDS } from "@/lib/modes";
import { SITE_NAME, SITE_SLUG } from "@/lib/site";
import { EXPORT_BASE_NAME } from "@/lib/recording/recorder";
import { batchZipBase } from "@/lib/recording/batch";
import { PROJECT_EXTENSION, projectFileName } from "@/lib/project";
import { clipFileName } from "@/lib/publish/clips";
import { scheduleMarkdown } from "@/lib/bot/output";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- review fix (docs-consistency) --- The README and the code comments against the code they describe: the mode families,
 * the smoke-test section numbers, the registration points of the extension guide, the rebrand (name and download names from
 * SITE_NAME), the social preview script and a few comments that named functions or maps that do not exist.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const README = read("README.md");
const CATALOGS = { en, pl, es } as Record<string, Record<string, unknown>>;
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Every string of a catalog with its dotted key. */
function strings(node: unknown, prefix = "", out: [string, string][] = []): [string, string][] {
  if (typeof node === "string") out.push([prefix, node]);
  else if (Array.isArray(node)) node.forEach((v, i) => strings(v, `${prefix}[${i}]`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) strings(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

/** The source files under a folder (recursively). */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(rel);
  }
  return out;
}

/** The README line that starts with `start` (exactly one). */
function readmeLine(start: string): string {
  const lines = README.split("\n").filter((l) => l.startsWith(start));
  expect(lines, start).toHaveLength(1);
  return lines[0];
}

describe("README vs code: the mode families", () => {
  it("the Game modes row names exactly the families of MODE_CATEGORY_IDS and every mode under its own family", () => {
    const row = readmeLine("| **Game modes** |");
    const cell = row.split("|")[2];
    const bold = [...cell.matchAll(/\*\*(\w+)\*\*/g)].map((m) => m[1]);
    expect(bold).toEqual([...MODE_CATEGORY_IDS]);
    const starts = MODE_CATEGORY_IDS.map((family) => cell.indexOf(`**${family}**`));
    MODE_CATEGORY_IDS.forEach((family, i) => {
      const segment = cell.slice(starts[i], i + 1 < starts.length ? starts[i + 1] : undefined);
      for (const id of MODE_IDS.filter((m) => MODE_CATEGORIES[m] === family)) {
        const name = (en.Modes as Record<string, { name?: string }>)[id]?.name;
        expect(name, id).toBeTruthy();
        expect(segment, `${id} (${name}) under ${family}`).toContain(name);
      }
    });
  });

  it("step 4 of 'Add a game mode' offers every family and says what a new family needs", () => {
    const step = readmeLine("4. Add the card order and the family");
    for (const family of MODE_CATEGORY_IDS) expect(step).toContain(`\`${family}\``);
    for (const point of ["MODE_CATEGORY_IDS", "CATEGORY_HEADINGS", "src/components/site/ModesOverview.tsx", "Headings.modes<Family>"]) expect(step).toContain(point);
    expect(readmeLine("  lib/modes.ts ")).toContain(MODE_CATEGORY_IDS.join(" / "));
  });

  it("every family has its heading on the mode cards in every locale, and lib/modes.ts describes every family", () => {
    const overview = read("src/components/site/ModesOverview.tsx");
    const headings = /const CATEGORY_HEADINGS = \{([^\n]*)\} as const;/.exec(overview)?.[1] ?? "";
    const modes = read("src/lib/modes.ts");
    for (const family of MODE_CATEGORY_IDS) {
      const key = `modes${cap(family)}`;
      expect(headings, family).toContain(`${family}: "${key}"`);
      for (const [locale, catalog] of Object.entries(CATALOGS)) expect((catalog.Headings as Record<string, string>)[key], `${locale} Headings.${key}`).toBeTruthy();
      expect(modes).toContain(` * - "${family}": `);
      expect(overview).toContain(family);
    }
    expect(modes).not.toMatch(/The two families/);
  });
});

describe("README vs code: smoke-test section numbers", () => {
  it("every 'smoke test (section N)' points at a section of scripts/smoke-test.mjs about the same feature", () => {
    const smoke = read("scripts/smoke-test.mjs");
    const titles = new Map<string, string[]>();
    for (const m of smoke.matchAll(/^\/\/ (\d+[a-z]?)\. ([^:.(\n]*)/gm)) titles.set(m[1], [...(titles.get(m[1]) ?? []), m[2]]);
    const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 5));
    let heading = "";
    let refs = 0;
    for (const line of README.split("\n")) {
      if (line.startsWith("### ")) heading = line.slice(4);
      for (const m of line.matchAll(/smoke test \(section (\d+[a-z]?)/g)) {
        refs++;
        const own = words(heading);
        const candidates = titles.get(m[1]) ?? [];
        expect(candidates.length, `section ${m[1]} (README "${heading}")`).toBeGreaterThan(0);
        expect(
          candidates.some((title) => [...words(title)].some((w) => own.has(w))),
          `README "${heading}" cites smoke section ${m[1]}, which is "${candidates.join(" / ")}"`,
        ).toBe(true);
      }
    }
    expect(refs).toBeGreaterThan(10);
    expect(README).toContain("the smoke test (section 29) checks the preview and the card, the URL and the controls");
  });

  it("the smoke test drives every mode (smoke.yml: 'every mode'), the first ones through MODES and the rest in their own sections", () => {
    const smoke = read("scripts/smoke-test.mjs");
    const list = /^const MODES = \[(.*)\];/m.exec(smoke)?.[1] ?? "";
    for (const id of MODE_IDS) expect(list.includes(`"${id}"`) || new RegExp(`mode=${id}(?![A-Za-z])`).test(smoke), id).toBe(true);
    expect(smoke).not.toMatch(/^\/\/ 2\. Simulator: every mode runs/m);
  });
});

describe("README vs code: the extension guide's registration points", () => {
  it("every GameMode class is exported from modes/index.ts", () => {
    const index = read("src/lib/physics/modes/index.ts");
    const dir = "src/lib/physics/modes";
    let classes = 0;
    for (const file of fs.readdirSync(path.join(ROOT, dir))) {
      if (!file.endsWith(".ts") || file === "index.ts") continue;
      for (const m of read(path.join(dir, file)).matchAll(/export class (\w+) implements GameMode/g)) {
        classes++;
        expect(index, `${m[1]} (${file})`).toMatch(new RegExp(`export \\{[^}]*\\b${m[1]}\\b[^}]*\\} from "\\./${file.replace(/\.ts$/, "")}"`));
      }
    }
    expect(classes).toBe(MODE_IDS.length);
  });

  it("every mode-settings setter of the engine is applied in initEngineForMode() (the fast export and every mode init use it)", () => {
    const engine = read("src/lib/physics/engine.ts");
    const simulator = read("src/components/simulator/Simulator.tsx");
    const start = simulator.indexOf("const initEngineForMode = useCallback(");
    expect(start).toBeGreaterThan(0);
    const body = simulator.slice(start, simulator.indexOf("}, []);", start));
    const setters = [...engine.matchAll(/^ {2}(set[A-Z]\w*Settings)\(/gm)].map((m) => m[1]);
    expect(setters.length).toBeGreaterThan(10);
    for (const setter of setters) expect(body, setter).toContain(`engine.${setter}(`);
  });

  it("the guide names initEngineForMode(), modes/index.ts and modeNames", () => {
    const setting = readmeLine("5. Apply it:");
    for (const point of ["PhysicsConfig", "initEngineForMode()", "ModeSettings", "createEngineForSettings()"]) expect(setting).toContain(point);
    const register = readmeLine("2. Register it:");
    for (const point of ["src/lib/physics/modes/index.ts", "modeNames", "initEngineForMode()"]) expect(register).toContain(point);
    expect(read("src/components/simulator/Controls.tsx")).toMatch(/const modeNames: Record<ModeId, string> = \{/);
  });
});

describe("rebrand: the name comes from SITE_NAME", () => {
  it("SITE_SLUG is SITE_NAME as a file-name slug and names every download", () => {
    expect(SITE_SLUG).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(SITE_SLUG.replace(/-/g, "")).toBe(SITE_NAME.toLowerCase().replace(/[^a-z0-9]/g, ""));
    expect(EXPORT_BASE_NAME).toBe(`${SITE_SLUG}-export`);
    expect(batchZipBase(new Date(2026, 8, 29, 14, 32))).toBe(`${SITE_SLUG}-batch-20260929-1432`);
    expect(projectFileName("")).toBe(`${SITE_SLUG}-project${PROJECT_EXTENSION}`);
    expect(clipFileName("", "video/mp4")).toBe(`${SITE_SLUG}-clip.mp4`);
  });

  it("no download name in src/ is a literal (comments aside)", () => {
    const literal = /["'`]jumpingballslive-(export|batch|clip)\b|`jumpingballslive-(bot-)?\$\{/; // (MANIFEST_FORMAT, PROJECT_FORMAT: fixed format ids)
    for (const file of sourceFiles("src")) {
      const code = read(file)
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l));
      for (const line of code) expect(literal.test(line), `${file}: ${line.trim()}`).toBe(false);
    }
  });

  it("no message writes the site name out: every locale says {siteName}", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [key, text] of strings(catalog)) expect(text.includes(SITE_NAME), `${locale} ${key}`).toBe(false);
      expect((catalog.Controls as Record<string, string>).projectErrorNotProject, locale).toContain("{siteName}");
    }
  });

  it("the bot's posting schedule fills the site name in", () => {
    const md = scheduleMarkdown([], en.ViralBot as Record<string, unknown>, { date: "2026-10-01", platform: "reels" });
    expect(md).toContain(SITE_NAME);
    expect(md).not.toContain("{siteName}");
  });

  it("the Rebrand section lists the social preview, the accent literal and what stays fixed", () => {
    const section = README.slice(README.indexOf("### Rebrand"), README.indexOf("\n### ", README.indexOf("### Rebrand") + 5));
    for (const point of ["SITE_SLUG", "generate-og.mjs", "#93d119", "_STORAGE_KEY", "PROJECT_FORMAT", "PROJECT_EXTENSION", "select-mode"]) expect(section).toContain(point);
  });
});

describe("README vs code: the social preview image", () => {
  it("scripts/generate-og.mjs renders public/og.png, which every page's Open Graph / Twitter card uses, and the README says so", () => {
    expect(read("scripts/generate-og.mjs")).toContain('path.resolve("public/og.png")');
    expect(read("src/app/[locale]/layout.tsx")).toContain('absoluteUrl("/og.png")');
    expect(fs.existsSync(path.join(ROOT, "public/og.png"))).toBe(true);
    expect(README).toContain("node scripts/generate-og.mjs");
    expect(README).toMatch(/^ {2}og\.png +social preview image/m);
  });
});

describe("code comments name things that exist", () => {
  it("settings.ts names only URL-key maps that exist", () => {
    const all = sourceFiles("src/lib").map(read).join("\n");
    for (const name of new Set(read("src/lib/settings.ts").match(/\b[A-Z_]*URL_KEYS\b/g) ?? [])) {
      expect(all, name).toMatch(new RegExp(`const ${name}\\b`));
    }
  });

  it("every function the multipliers.ts header cites is defined there", () => {
    const source = read("src/lib/physics/multipliers.ts");
    const header = source.slice(0, source.indexOf("*/"));
    const names = [...header.matchAll(/`(\w+)\(\)`/g)].map((m) => m[1]);
    expect(names).toContain("planStep");
    for (const name of names) expect(source, name).toMatch(new RegExp(`^\\s*(export\\s+)?(function\\s+)?${name}\\s*\\(`, "m"));
  });
});
