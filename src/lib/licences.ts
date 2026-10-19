import fs from "node:fs";
import path from "node:path";

/*
 * --- legal-audit --- The third-party licences page's data, read at build time (the page is a server component of a static
 * export, so this never runs in the browser): the site's production dependencies from package.json with each package's
 * licence id and licence text out of node_modules, and the three self-hosted fonts with their SIL Open Font License texts
 * (src/fonts). The dependency list is read, never written down here, so the page stays true when a package comes or goes.
 */

export interface ThirdPartyLicence {
  /** The package or font family name. */
  name: string;
  /** The package's version ("" for a font). */
  version: string;
  /** The SPDX licence id as the package declares it ("OFL-1.1" for the fonts). */
  licence: string;
  /** The licence text shipped with the package or font ("" when none is found). */
  text: string;
}

const ROOT = process.cwd();
const LICENCE_FILES = ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE", "LICENCE.md", "LICENCE.txt", "license", "license.md", "license.txt", "COPYING"];

/** The self-hosted fonts (src/app/fonts.ts) and their OFL files. */
export const FONT_LICENCES: readonly { name: string; file: string }[] = [
  { name: "Space Grotesk", file: "OFL-SpaceGrotesk.txt" },
  { name: "Hanken Grotesk", file: "OFL-HankenGrotesk.txt" },
  { name: "JetBrains Mono", file: "OFL-JetBrainsMono.txt" },
];

function readFirst(dir: string, names: readonly string[]): string {
  for (const name of names) {
    const file = path.join(dir, name);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return fs.readFileSync(file, "utf8").trim();
  }
  return "";
}

/** The production dependencies of package.json, alphabetically, each with its licence id and text from node_modules. */
export function packageLicences(root = ROOT): ThirdPartyLicence[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  return Object.keys(pkg.dependencies ?? {})
    .sort()
    .map((name) => {
      const dir = path.join(root, "node_modules", name);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { version?: string; license?: string | { type?: string } };
      const licence = typeof meta.license === "string" ? meta.license : (meta.license?.type ?? "");
      return { name, version: meta.version ?? "", licence, text: readFirst(dir, LICENCE_FILES) };
    });
}

/** The three fonts with their SIL Open Font License 1.1 texts (src/fonts/OFL-*.txt). */
export function fontLicences(root = ROOT): ThirdPartyLicence[] {
  return FONT_LICENCES.map((f) => ({ name: f.name, version: "", licence: "OFL-1.1", text: readFirst(path.join(root, "src", "fonts"), [f.file]) }));
}
