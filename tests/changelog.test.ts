import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { describe, expect, it } from "vitest";
import { CHANGELOG, CHANGE_KINDS, CHANGE_PRODUCTS, appReleaseId, entryText, formatChangelogDate, latestRelease, releaseId, siteReleaseId } from "@/content/changelog";
import { PAGE_CLIENT_NAMESPACES } from "@/i18n/clientMessages";
import sitemap from "@/app/sitemap";
import { DESKTOP_VERSION } from "@/lib/desktop/release";
import { WHATS_NEW_STORAGE_KEY, claimWhatsNew, compareVersions, whatsNewDecision, type SeenStore } from "@/lib/desktop/whatsNew";
import { SITE_NAME, pageUrl } from "@/lib/site";
import * as changelogScript from "../scripts/changelog.mjs";
import { ghCalls, releaseBody } from "../scripts/release/publish-downloads.mjs";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- changelog --- The data of the /changelog page (src/content/changelog.json), the page's contract and its place in the site,
 * and the things that are made from the data: CHANGELOG.md and the release notes (scripts/changelog.mjs), the body of the public
 * release (scripts/release/publish-downloads.mjs) and the Windows app's "What's new" notice. The text rules of docs/COPY-STYLE.md
 * run in tests/copyStyle.test.ts (it scans these entries); the three rules below that the other tests apply to every message
 * (the site name, the domain, a hard-coded mode count) are repeated here because this file is not a message catalog.
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const LOCALES = ["en", "pl", "es"] as const;
type Catalog = { Changelog: Record<string, string>; ChangelogLive: Record<string, string>; WhatsNew: Record<string, string> };
const CATALOGS = { en, pl, es } as unknown as Record<(typeof LOCALES)[number], Catalog>;
const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const cmp = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => (SEMVER.exec(v) ?? []).slice(1).map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};
// tests/siteStatic.test.ts and tests/uiI18nReview.test.ts: a literal count of modes
const HARD_CODED = /\b\d+\s+(unique |simulation |unikalnymi |únicos )?(modes|modos|trybów|trybami|tryby)\b/i;
const COUNT_WORDS: Record<string, string> = {
  en: "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty",
  pl: "dwa|dwóch|trzy|trzech|cztery|czterech|pięć|pięciu|sześć|sześciu|siedem|siedmiu|osiem|ośmiu|dziewięć|dziewięciu|dziesięć|dziesięciu|jedenaście|jedenastu|dwanaście|dwunastu|trzynaście|trzynastu|dwadzieścia|dwudziestu|trzydzieści|trzydziestu",
  es: "dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta",
};
const countRe = (locale: string) => new RegExp(`(?<![\\p{L}\\d])(?:[2-9]|\\d{2,}|${COUNT_WORDS[locale]})(?![\\p{L}\\d])\\s+(?:[\\p{L}-]+\\s+)?(?:modes?|modos?|tryb(?:y|ów|ami|ach|u|em)?)(?!\\p{L})`, "iu");

describe("the changelog data", () => {
  it("is a list of releases and nothing else, each with exactly the fields of the schema", () => {
    const file = JSON.parse(read("src/content/changelog.json")) as { releases: Record<string, unknown>[] };
    expect(Object.keys(file)).toEqual(["releases"]);
    expect(file.releases.length).toBeGreaterThan(0);
    for (const r of file.releases) {
      expect(Object.keys(r).sort(), String(r.id)).toEqual(["date", "headline", "id", "items", "product", "version"]);
      for (const item of r.items as Record<string, unknown>[]) expect(Object.keys(item).sort(), String(r.id)).toEqual(["kind", "text"]);
    }
  });

  it("has releases with a version, an id made from product and version, a real date and at least one item", () => {
    const ids = new Set<string>();
    for (const r of CHANGELOG) {
      expect(ids.has(r.id), `${r.id} twice`).toBe(false);
      ids.add(r.id);
      expect(CHANGE_PRODUCTS, r.id).toContain(r.product);
      expect(r.version, r.id).toMatch(SEMVER);
      expect(r.id, r.id).toMatch(/^(site|app)-\d+-\d+-\d+$/);
      expect(r.id, r.id).toBe(releaseId(r.product, r.version));
      expect(r.id, r.id).toBe(r.product === "app" ? appReleaseId(r.version) : siteReleaseId(r.version));
      expect(r.date, r.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${r.date}T00:00:00Z`).toISOString().slice(0, 10), `${r.id} is a real day`).toBe(r.date);
      expect(r.items.length, r.id).toBeGreaterThan(0);
    }
  });

  it("is newest first: dates never rise down the list, and the versions of each product always fall", () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date, `${CHANGELOG[i - 1].id} before ${CHANGELOG[i].id}`).toBe(true);
    for (const product of CHANGE_PRODUCTS) {
      const versions = CHANGELOG.filter((r) => r.product === product).map((r) => r.version);
      expect(versions.length, product).toBeGreaterThan(0);
      for (let i = 1; i < versions.length; i++) expect(cmp(versions[i - 1], versions[i]), `${product} ${versions[i - 1]} before ${versions[i]}`).toBeGreaterThan(0);
    }
  });

  it("names the Windows app version the site advertises (src/lib/desktop/release.ts) as its newest app release", () => {
    expect(latestRelease("app")?.version).toBe(DESKTOP_VERSION);
  });

  // The release commit bumps the root package.json together with the entry ("add the entry in the same commit as the version bump",
  // README, Changelog). Red while the entry is ahead of package.json: that is the reminder.
  it("names the website version in package.json as its newest website release", () => {
    const version = (JSON.parse(read("package.json")) as { version: string }).version;
    expect(latestRelease("site")?.version).toBe(version);
  });

  it("gives every release a headline of at most 60 characters in English, Polish and Spanish", () => {
    for (const r of CHANGELOG) {
      expect(Object.keys(r.headline).sort(), r.id).toEqual([...LOCALES].sort());
      for (const locale of LOCALES) {
        const headline = r.headline[locale];
        expect(headline, `${r.id} ${locale}`).toBe(headline.trim());
        expect([...headline].length, `${r.id} ${locale}`).toBeGreaterThan(5);
        expect([...headline].length, `${r.id} ${locale}`).toBeLessThanOrEqual(60);
        if (locale !== "en") expect(headline, `${r.id} ${locale} is not the English headline`).not.toBe(r.headline.en);
      }
    }
  });

  it("writes every item in English, Polish and Spanish, as one to three sentences of 16 to 220 characters", () => {
    for (const r of CHANGELOG) {
      r.items.forEach((item, i) => {
        expect(CHANGE_KINDS, `${r.id}.${i}`).toContain(item.kind);
        expect(Object.keys(item.text).sort(), `${r.id}.${i}`).toEqual([...LOCALES].sort());
        for (const locale of LOCALES) {
          const text = item.text[locale];
          expect(text, `${r.id}.${i} ${locale}`).toBe(text.trim());
          expect([...text].length, `${r.id}.${i} ${locale}`).toBeGreaterThanOrEqual(16);
          expect([...text].length, `${r.id}.${i} ${locale}`).toBeLessThanOrEqual(220);
          expect(text, `${r.id}.${i} ${locale}`).toMatch(/[.!?]$/);
          expect((text.match(/[.!?](\s|$)/g) ?? []).length, `${r.id}.${i} ${locale}`).toBeLessThanOrEqual(3);
          if (locale !== "en") expect(text, `${r.id}.${i} ${locale} is not the English text`).not.toBe(item.text.en);
        }
      });
    }
  });

  it("applies the whole-catalog rules to its text: no site name written out, no domain or address, no literal count of modes, only the {siteName} placeholder", () => {
    for (const r of CHANGELOG) {
      const texts: [string, string, (typeof LOCALES)[number]][] = [];
      for (const locale of LOCALES) {
        texts.push([`${r.id}.headline`, r.headline[locale], locale]);
        r.items.forEach((item, i) => texts.push([`${r.id}.${i}`, item.text[locale], locale]));
      }
      for (const [key, text, locale] of texts) {
        const where = `${key} ${locale}: ${text.slice(0, 60)}`;
        expect(text.includes(SITE_NAME), where).toBe(false);
        expect(text.toLowerCase().includes("jumpingballslive.com"), where).toBe(false);
        expect(/https?:\/\/|\bwww\.\w/i.test(text), where).toBe(false);
        expect(HARD_CODED.test(text), where).toBe(false);
        expect(countRe(locale).test(text), where).toBe(false);
        expect(text.replaceAll("{siteName}", "").includes("{") || text.replaceAll("{siteName}", "").includes("}"), where).toBe(false);
      }
    }
  });

  it("fills {siteName} in with the site name and nothing else", () => {
    expect(entryText("Welcome to {siteName}. {siteName} is new.")).toBe(`Welcome to ${SITE_NAME}. ${SITE_NAME} is new.`);
    expect(entryText("No placeholder.")).toBe("No placeholder.");
  });

  it("formats a date in the page's language, always the UTC day", () => {
    expect(formatChangelogDate("2026-10-13", "en")).toBe("13 October 2026");
    expect(formatChangelogDate("2026-10-13", "pl")).toBe("13 października 2026");
    expect(formatChangelogDate("2026-10-13", "es")).toBe("13 de octubre de 2026");
    expect(formatChangelogDate("2026-01-01", "en")).toBe("1 January 2026");
  });

  it("builds anchors from product and version", () => {
    expect(releaseId("site", "1.10.0")).toBe("site-1-10-0");
    expect(appReleaseId("1.3.0")).toBe("app-1-3-0");
    expect(siteReleaseId("1.9.0")).toBe("site-1-9-0");
  });
});

describe("CHANGELOG.md and the release notes (scripts/changelog.mjs)", () => {
  const { checkChangelog, mdEscape, readReleases, releaseNotes, releaseTitle, renderChangelog, renderRelease, run } = changelogScript;
  const SAMPLE = [
    {
      id: "app-2-0-0",
      product: "app",
      version: "2.0.0",
      date: "2027-01-02",
      headline: { en: "A *big* one for {siteName}", pl: "x", es: "y" },
      items: [
        { kind: "fixed", text: { en: "Fixed a crash.", pl: "a", es: "b" } },
        { kind: "new", text: { en: "A new thing.", pl: "a", es: "b" } },
        { kind: "improved", text: { en: "Faster [start].", pl: "a", es: "b" } },
      ],
    },
    { id: "site-1-0-0", product: "site", version: "1.0.0", date: "2027-01-01", headline: { en: "First", pl: "x", es: "y" }, items: [{ kind: "new", text: { en: "Hello.", pl: "a", es: "b" } }] },
  ];

  it("reads the same data as the page and the same site name as src/lib/site.ts", () => {
    expect(readReleases().map((r: { id: string }) => r.id)).toEqual(CHANGELOG.map((r) => r.id));
    expect(changelogScript.SITE_NAME).toBe(SITE_NAME);
  });

  it("has a CHANGELOG.md that is what `npm run changelog` writes (run it after changing an entry)", () => {
    const { ok, expected, actual } = checkChangelog(readReleases());
    expect(actual, "CHANGELOG.md is missing: run npm run changelog").not.toBeNull();
    expect(ok, "CHANGELOG.md is out of date: run npm run changelog").toBe(true);
    expect(actual).toBe(expected);
    const run1 = spawnSync(process.execPath, [path.join(ROOT, "scripts", "changelog.mjs"), "--check"], { encoding: "utf8" });
    expect(run1.status, run1.stderr).toBe(0);
    const scripts = (JSON.parse(read("package.json")) as { scripts: Record<string, string> }).scripts;
    expect(scripts.changelog).toBe("node scripts/changelog.mjs --write");
    expect(scripts["changelog:check"]).toBe("node scripts/changelog.mjs --check");
  });

  it("lists every release newest first as `## Website 1.10.0 · date`, its headline and its items under New, Improved and Fixed", () => {
    const md = read("CHANGELOG.md");
    expect(md.startsWith("# Changelog\n")).toBe(true);
    expect(md).toMatch(/generated from `src\/content\/changelog\.json`/);
    const headings = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(headings).toEqual(CHANGELOG.map((r) => `${r.product === "app" ? "Windows app" : "Website"} ${r.version} · ${r.date}`));
    for (const r of CHANGELOG) {
      for (const item of r.items) expect(md, `${r.id}`).toContain(mdEscape(entryText(item.text.en)));
      expect(md, r.id).toContain(mdEscape(entryText(r.headline.en)));
    }
    expect([...md.matchAll(/^### (.+)$/gm)].every((m) => ["New", "Improved", "Fixed"].includes(m[1]))).toBe(true);
    expect(md.endsWith("\n") && !md.endsWith("\n\n")).toBe(true);
  });

  it("renders a release: heading with the date, the headline, then a list per kind in the order New, Improved, Fixed", () => {
    expect(releaseTitle(SAMPLE[0])).toBe("Windows app 2.0.0");
    expect(renderRelease(SAMPLE[0])).toBe(
      ["## Windows app 2.0.0 · 2027-01-02", "", "A \\*big\\* one for JumpingBallsLive", "", "### New", "", "- A new thing.", "", "### Improved", "", "- Faster \\[start\\].", "", "### Fixed", "", "- Fixed a crash."].join("\n"),
    );
    const md = renderChangelog(SAMPLE);
    expect(md.indexOf("## Windows app 2.0.0")).toBeLessThan(md.indexOf("## Website 1.0.0"));
    expect(md.endsWith("- Hello.\n")).toBe(true);
  });

  it("prints a release's notes: the headline, then a bullet per item that starts with its kind, no heading and no front matter", () => {
    expect(releaseNotes(SAMPLE, "app", "2.0.0")).toBe(["A \\*big\\* one for JumpingBallsLive", "", "- **New:** A new thing.", "- **Improved:** Faster \\[start\\].", "- **Fixed:** Fixed a crash."].join("\n"));
    expect(releaseNotes(SAMPLE, "site", "1.0.0")).toBe(["First", "", "- **New:** Hello."].join("\n"));
    expect(releaseNotes(SAMPLE, "app", "1.0.0")).toBeNull();
    expect(releaseNotes(SAMPLE, "site", "2.0.0")).toBeNull();
  });

  it("has notes for every release that name no repository, address or heading", () => {
    for (const r of CHANGELOG) {
      const notes = releaseNotes(readReleases(), r.product, r.version) as string;
      expect(notes, r.id).toBeTruthy();
      expect(notes.split("\n").filter((line) => line.startsWith("- ")).length, r.id).toBe(r.items.length);
      expect(notes, r.id).toContain(entryText(r.headline.en).replace(/([\\`*_[\]<>])/g, "\\$1"));
      expect(/github\.com|https?:\/\/|^#|^---/m.test(notes), r.id).toBe(false);
    }
  });

  it("works as a command: --notes prints, an unknown release exits 1, a wrong call exits 2, --write then --check agree", () => {
    const script = path.join(ROOT, "scripts", "changelog.mjs");
    const newest = latestRelease("app")!;
    const notes = spawnSync(process.execPath, [script, "--notes", "app", newest.version], { encoding: "utf8" });
    expect(notes.status, notes.stderr).toBe(0);
    expect(notes.stdout).toBe(`${releaseNotes(readReleases(), "app", newest.version)}\n`);
    expect(spawnSync(process.execPath, [script, "--notes", "app", "0.0.1"], { encoding: "utf8" }).status).toBe(1);
    expect(spawnSync(process.execPath, [script, "--notes", "web", "1.0.0"], { encoding: "utf8" }).status).toBe(2);
    expect(spawnSync(process.execPath, [script], { encoding: "utf8" }).status).toBe(2);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-"));
    try {
      const dataFile = path.join(dir, "changelog.json");
      const markdownFile = path.join(dir, "CHANGELOG.md");
      fs.writeFileSync(dataFile, JSON.stringify({ releases: SAMPLE }));
      const messages: string[] = [];
      const io = { dataFile, markdownFile, out: (m: string) => messages.push(m), err: (m: string) => messages.push(`ERR ${m}`) };
      expect(run(["--check"], io), "no file yet").toBe(1);
      expect(run(["--write"], io)).toBe(0);
      expect(run(["--check"], io)).toBe(0);
      fs.writeFileSync(markdownFile, `${fs.readFileSync(markdownFile, "utf8")}\nEdited by hand.\n`);
      expect(run(["--check"], io), "a hand edit is caught").toBe(1);
      expect(messages.some((m) => m.startsWith("ERR CHANGELOG.md is out of date"))).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the public release's notes (scripts/release/publish-downloads.mjs)", () => {
  const names = ["a.exe"];

  it("starts the body with the changelog's notes and keeps the download and checksum lines after them", () => {
    const newest = latestRelease("app")!;
    const entry = changelogScript.releaseNotes(changelogScript.readReleases(), "app", newest.version) as string;
    const body = releaseBody(newest.version, entry);
    expect(body.startsWith(entry)).toBe(true);
    expect(body).toContain(`- Installer (per user, no admin): JumpingBallsLive-Setup-${newest.version}.exe – updates itself.`);
    expect(body).toContain(`- Portable: JumpingBallsLive-${newest.version}-portable.exe – runs without installing.`);
    expect(body).toContain("Checksums: SHA256SUMS.txt.");
    expect(/github\.com|https?:\/\//.test(body)).toBe(false);
  });

  it("falls back to the short text a version without an entry always had", () => {
    for (const entry of [null, undefined, "", "  "]) {
      expect(releaseBody("0.0.1", entry as string | null | undefined).startsWith("JumpingBallsLive for Windows 0.0.1.\n\n- Installer")).toBe(true);
    }
  });

  it("hands the body to `gh release create`, and only there", () => {
    const [create, publish] = ghCalls("o/r", "dist", "1.2.3", names, false, "Headline\n\n- **New:** Thing.");
    expect(create[create.indexOf("--notes") + 1]).toBe(releaseBody("1.2.3", "Headline\n\n- **New:** Thing."));
    expect(publish).not.toContain("--notes");
    const [upload] = ghCalls("o/r", "dist", "1.2.3", names, true, "Headline");
    expect(upload).not.toContain("--notes");
    expect(ghCalls("o/r", "dist", "1.2.3", names, false)[0][ghCalls("o/r", "dist", "1.2.3", names, false)[0].indexOf("--notes") + 1]).toBe(releaseBody("1.2.3"));
  });

  it("is what the GitHub release of the workflow says too: the same command, from a checkout that has the data", () => {
    const desktop = read(".github/workflows/desktop.yml");
    expect(desktop).toContain('node scripts/changelog.mjs --notes app "$VERSION"');
    expect(desktop).toContain("--generate-notes");
    const checkout = /name: Check out \(the publish script\)\r?\n\s+uses: actions\/checkout@v4\r?\n\s+with:\r?\n\s+sparse-checkout: \|\r?\n((?: {12}\S.*\r?\n)+)/.exec(desktop)?.[1] ?? "";
    expect(checkout.split("\n").map((l) => l.trim()).filter(Boolean)).toEqual(["scripts/release", "src/content"]);
    // the script resolves the data from its own place, whatever the working directory
    expect(read("scripts/release/publish-downloads.mjs")).toContain('from "../changelog.mjs"');
  });
});

describe("the changelog page in the site", () => {
  it("has its chrome texts in every language: the kind labels, the filter, the release titles and the notices", () => {
    for (const locale of LOCALES) {
      const c = CATALOGS[locale].Changelog;
      for (const key of ["metaTitle", "metaDescription", "badge", "title", "intro", "filterLabel", "filterAll", "filterSite", "filterApp", "releaseSite", "releaseApp", "kindNew", "kindImproved", "kindFixed", "outro", "feedback", "download"]) expect(c[key], `${locale} Changelog.${key}`).toBeTruthy();
      expect(c.releaseApp, locale).toContain("{version}");
      expect(c.releaseSite, locale).toContain("{version}");
      expect(c.metaTitle, locale).toContain("{siteName}");
      expect(CATALOGS[locale].ChangelogLive.youRun, locale).toContain("{version}");
      expect(CATALOGS[locale].WhatsNew.title, locale).toContain("{version}");
      for (const key of ["title", "body", "link", "dismiss"]) expect(CATALOGS[locale].WhatsNew[key], `${locale} WhatsNew.${key}`).toBeTruthy();
    }
  });

  it("is a static, indexable, localised page: metadata with canonical and alternates, a <time> per release, a heading with the version, the headline", () => {
    const page = read("src/app/[locale]/changelog/page.tsx");
    expect(page).toContain("export async function generateMetadata");
    // --- seo --- the canonical, the language alternates and the social tags come from the shared helper (src/lib/seo.ts, tests/seo.test.ts)
    expect(page).toContain('pageMetadata({ locale, path: "/changelog"');
    expect(page).toContain('pageUrl(locale, "/changelog")'); // the JSON-LD's own address
    expect(page).toContain("setRequestLocale(locale)");
    expect(page).toContain("<time dateTime={r.date}");
    expect(page).toContain('t(r.product === "app" ? "releaseApp" : "releaseSite", { version: r.version })');
    expect(page).toContain("r.headline[lang]");
    expect(page).toContain("latestRelease(");
    expect(page).not.toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it("is in the sitemap in every language", () => {
    expect(read("src/app/sitemap.ts")).toMatch(/["']\/changelog["']/);
    const entries = sitemap().filter((e) => e.url.includes("/changelog/"));
    expect(entries.map((e) => e.url).sort()).toEqual(LOCALES.map((l) => pageUrl(l, "/changelog")).sort());
  });
  it("is linked from the footer with a text in every language", () => {
    expect(read("src/components/site/Footer.tsx")).toMatch(/href:\s*["']\/changelog["']/);
    for (const locale of LOCALES) expect((CATALOGS[locale] as unknown as { Footer: Record<string, string> }).Footer.changelog, locale).toBeTruthy();
  });

  it("hands the client only the small ChangelogLive namespace and the version numbers, never the page's own text or the data", () => {
    expect(PAGE_CLIENT_NAMESPACES["/changelog"]).toEqual(["ChangelogLive"]);
    const note = read("src/components/site/ChangelogYourVersion.tsx");
    expect(note).not.toMatch(/from "@\/content\/changelog"/);
    expect(read("src/components/simulator/desktop/WhatsNew.tsx")).not.toMatch(/from "@\/content\/changelog"/);
  });
});

describe("the Windows app's What's new notice", () => {
  const store = (initial: Record<string, string> = {}): SeenStore & { data: Record<string, string> } => {
    const data = { ...initial };
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
  };

  it("shows nothing on the first run, and stores the version quietly", () => {
    expect(whatsNewDecision(null, "1.3.0")).toEqual({ show: false, remember: true });
    const s = store();
    expect(claimWhatsNew(s, "1.3.0")).toBe(false);
    expect(s.data[WHATS_NEW_STORAGE_KEY]).toBe("1.3.0");
  });

  it("shows once after the version has risen, then not again", () => {
    const s = store({ [WHATS_NEW_STORAGE_KEY]: "1.2.0" });
    expect(claimWhatsNew(s, "1.3.0")).toBe(true);
    expect(s.data[WHATS_NEW_STORAGE_KEY]).toBe("1.3.0");
    expect(claimWhatsNew(s, "1.3.0")).toBe(false);
    expect(claimWhatsNew(s, "1.10.0"), "1.10.0 is newer than 1.3.0").toBe(true);
  });

  it("stores a lower version (an older build installed again) without a notice, and ignores a version that is not x.y.z", () => {
    const s = store({ [WHATS_NEW_STORAGE_KEY]: "1.3.0" });
    expect(claimWhatsNew(s, "1.2.0")).toBe(false);
    expect(s.data[WHATS_NEW_STORAGE_KEY]).toBe("1.2.0");
    expect(whatsNewDecision("1.2.0", "dev")).toEqual({ show: false, remember: false });
    expect(whatsNewDecision("garbage", "1.2.0")).toEqual({ show: false, remember: true });
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2", "1.2.0")).toBeNull();
  });

  it("shows nothing when the storage cannot be used", () => {
    expect(claimWhatsNew(null, "1.3.0")).toBe(false);
    const broken: SeenStore = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(claimWhatsNew(broken, "1.3.0")).toBe(false);
    const full: SeenStore = { getItem: () => "1.2.0", setItem: () => { throw new Error("quota"); } };
    expect(claimWhatsNew(full, "1.3.0"), "it could not remember, so it would come back at every start").toBe(false);
  });

  it("is mounted in the Desktop section, reads the WhatsNew namespace and links the release of the running version", () => {
    expect(read("src/components/simulator/sections/DesktopSection.tsx")).toMatch(/import WhatsNew from "\.\.\/desktop\/WhatsNew"/);
    expect(read("src/components/simulator/sections/DesktopSection.tsx")).toContain("<WhatsNew");
    const component = read("src/components/simulator/desktop/WhatsNew.tsx");
    expect(component).toMatch(/^"use client";/);
    expect(component).toContain('useTranslations("WhatsNew")');
    expect(component).toContain("getDesktop()");
    expect(component).toContain("/changelog#${appReleaseId(version)}");
  });
});
