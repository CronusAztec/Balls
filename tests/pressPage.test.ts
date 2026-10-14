import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { IntlMessageFormat } from "intl-messageformat";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { PLANS, yearlySavingPercent } from "@/lib/billing/config";
import { faqPrices } from "@/lib/faqValues";
import { ACCENT, ACCENT_LIGHT, SITE_NAME } from "@/lib/site";
import { PWA_THEME_COLOR } from "@/lib/pwa";
import { OG_CARD_PAGES } from "@/lib/seo";
import { FL_ROSTER } from "@/lib/physics/modes/fightLeagueRoster";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- press --- The press page (src/app/[locale]/press/page.tsx) against the code it quotes: its messages in all three languages
 * (the same keys and placeholders, the description in three lengths, no Fight League name outside the one note that says they are
 * not part of the kit), every message it reads, the logo files it links, the colours and the facts it must read from the code instead
 * of typing them. The page itself is rendered by the smoke test (block "pages").
 */

const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), "utf8");
const PAGE = read("src/app/[locale]/press/page.tsx");
type Locale = "en" | "pl" | "es";
const CATALOGS = { en, pl, es } as unknown as Record<Locale, { Press: Record<string, unknown> }>;
const LOCALES: Locale[] = ["en", "pl", "es"];

/** Every string of a message tree with its dotted key (array items as `.0`). */
function flatten(node: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") out[prefix] = node;
  else if (Array.isArray(node)) node.forEach((v, i) => flatten(v, `${prefix}.${i}`, out));
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
const press = (locale: Locale) => flatten(CATALOGS[locale].Press);

/** The ICU argument names of a message (plural and select bodies included). */
function placeholders(text: string): string[] {
  const names = new Set<string>();
  const walk = (nodes: unknown[]) => {
    for (const node of nodes as { type: number; value?: string; options?: Record<string, { value: unknown[] }>; children?: unknown[] }[]) {
      if (node.type === 1 || node.type === 2 || node.type === 6) names.add(String(node.value));
      if (node.type === 6 && node.options) for (const option of Object.values(node.options)) walk(option.value);
      if (node.type === 8 && node.children) walk(node.children);
    }
  };
  walk(new IntlMessageFormat(text, "en").getAst());
  return [...names].sort();
}

describe("the Press messages", () => {
  it("have the same keys in English, Polish and Spanish, and the same placeholders and tags in each", () => {
    const english = press("en");
    expect(Object.keys(english).length).toBeGreaterThan(60);
    for (const locale of ["pl", "es"] as Locale[]) {
      const other = press(locale);
      expect(Object.keys(other).sort(), locale).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(english)) {
        expect(placeholders(other[key]), `${locale} ${key}`).toEqual(placeholders(text));
        expect([...other[key].matchAll(/<(\w+)>/g)].map((m) => m[1]).sort(), `${locale} ${key} tags`).toEqual([...text.matchAll(/<(\w+)>/g)].map((m) => m[1]).sort());
      }
      // Polish and Spanish are written, not copied
      for (const key of ["intro", "facts.whatValue", "about.short", "about.long", "usage.items.1", "notIncluded.body", "contact.withoutEmail"]) expect(other[key], `${locale} ${key}`).not.toBe(english[key]);
    }
  });

  it("are all read by the page: every key it names exists, and every key of the catalogue is used", () => {
    const english = press("en");
    const used = new Set<string>();
    for (const m of PAGE.matchAll(/\b(?:t|t\.rich|t\.raw)\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1]);
    // the keys the page builds: the three lengths, the logo labels, the usage rules
    expect(PAGE).toContain("t(`about.${length}`");
    expect(PAGE).toContain("t(`about.${length}Label`");
    expect(PAGE).toContain("t(`brand.${file.label}`)");
    expect(PAGE).toContain("t(`usage.items.${i}`");
    for (const length of ["short", "medium", "long"]) {
      used.add(`about.${length}`);
      used.add(`about.${length}Label`);
    }
    for (const label of [...PAGE.matchAll(/label: "(file\w+)"/g)].map((m) => m[1])) used.add(`brand.${label}`);
    for (const key of Object.keys(english).filter((k) => k.startsWith("usage.items."))) used.add(key);
    used.add("usage.items");
    for (const key of [...used]) if (key !== "usage.items") expect(Object.keys(english), `the page reads ${key}`).toContain(key);
    const unused = Object.keys(english).filter((k) => !used.has(k));
    expect(unused).toEqual([]);
    expect(PAGE).toContain("fileCard"); // the social card has its own label
  });

  it("give the description in three lengths of about 25, 60 and 120 words, with the price only in the longer two", () => {
    const filled = (locale: Locale, key: string) => {
      const text = press(locale)[key];
      return String(new IntlMessageFormat(text, locale).format({ siteName: SITE_NAME, count: MODE_CARD_ORDER.length, ...faqPrices(locale), percent: yearlySavingPercent(PLANS) }));
    };
    const words = (text: string) => text.trim().split(/\s+/).length;
    for (const locale of LOCALES) {
      expect(words(filled(locale, "about.short")), `${locale} short`).toBeGreaterThanOrEqual(18);
      expect(words(filled(locale, "about.short")), `${locale} short`).toBeLessThanOrEqual(32);
      expect(words(filled(locale, "about.medium")), `${locale} medium`).toBeGreaterThanOrEqual(48);
      expect(words(filled(locale, "about.medium")), `${locale} medium`).toBeLessThanOrEqual(75);
      expect(words(filled(locale, "about.long")), `${locale} long`).toBeGreaterThanOrEqual(95);
      expect(words(filled(locale, "about.long")), `${locale} long`).toBeLessThanOrEqual(140);
      expect(placeholders(press(locale)["about.short"])).not.toContain("monthly");
      for (const key of ["about.medium", "about.long"]) expect(placeholders(press(locale)[key]), `${locale} ${key}`).toEqual(expect.arrayContaining(["monthly", "siteName", "yearly"]));
      for (const key of ["about.short", "about.medium", "about.long"]) expect(filled(locale, key), `${locale} ${key}`).not.toMatch(/[{}]/);
    }
    // the label says how many words the text really has: it takes {words}
    for (const locale of LOCALES) for (const key of ["about.shortLabel", "about.mediumLabel", "about.longLabel"]) expect(placeholders(press(locale)[key])).toEqual(["words"]);
  });

  it("carry a search title of at most 60 characters and a description of 70 to 160 (as rendered)", () => {
    for (const locale of LOCALES) {
      const p = press(locale);
      const title = String(new IntlMessageFormat(p.metaTitle, locale).format({ siteName: SITE_NAME }));
      const description = String(new IntlMessageFormat(p.metaDescription, locale).format({ siteName: SITE_NAME }));
      expect([...title].length, `${locale} ${title}`).toBeLessThanOrEqual(60);
      expect([...description].length, `${locale} ${description}`).toBeGreaterThanOrEqual(70);
      expect([...description].length, `${locale} ${description}`).toBeLessThanOrEqual(160);
      expect(title.endsWith(` – ${SITE_NAME}`), locale).toBe(true);
    }
  });

  it("name Fight League only in the note that says its names and footage are not part of the kit, and no fighter or franchise anywhere", () => {
    const names = new Set<string>(["Marvel", "Nintendo", "Pokémon", "Star Wars", "Disney"]);
    for (const row of FL_ROSTER) {
      names.add(row.name);
      names.add(row.source);
    }
    const wholeWord = (word: string) => new RegExp(`(?<![\\p{L}\\d])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "u");
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(press(locale))) {
        if (key === "notIncluded.body") {
          expect(text, `${locale} ${key}`).toContain("Fight League");
          expect(text, `${locale} ${key}`).toContain("<contact>");
        } else expect(text, `${locale} ${key}`).not.toMatch(/Fight League/i);
        for (const name of names) if (name.length >= 3) expect(wholeWord(name).test(text), `${name} in ${locale} ${key}`).toBe(false);
        expect(text.includes(SITE_NAME), `${locale} ${key} writes the site name out`).toBe(false);
      }
    }
  });

  it("promise nothing the product does not do: no viral, earnings, PayPal or Publish, and the usage rules ask not to promise either", () => {
    const banned = /viral|wiral|earn|zarab|dochod|ganar|ingreso|paypal|\bpublish|publik|publicar/i;
    for (const locale of LOCALES) for (const [key, text] of Object.entries(press(locale))) {
      if (key.startsWith("usage.items.3")) continue; // "Do not say it promises views, followers or income"
      expect(banned.test(text), `${locale} ${key}: ${text}`).toBe(false);
    }
    expect(press("en")["usage.items.3"]).toMatch(/Do not say it promises views, followers or income/);
  });
});

describe("the press page reads the code, not typed numbers", () => {
  it("is a server component, with no client component and no literal price, mode count or version", () => {
    expect(PAGE.split("\n")[0]).not.toContain("use client");
    expect(PAGE).not.toMatch(/["'`]use client["'`]/);
    expect(PAGE).not.toMatch(/\$\s?6\.99|\$\s?49\b|\b45\b|\b1\.\d+\.\d+\b/);
    for (const read of ["MODE_CARD_ORDER.length", "faqPrices(locale)", "yearlySavingPercent(PLANS)", "DESKTOP_VERSION", "buildLabel()", "SUPPORT_EMAIL", "LEGAL_NAME", "CHANGELOG", "formatChangelogDate", "ACCENT", "ACCENT_LIGHT", "PWA_THEME_COLOR"]) expect(PAGE, read).toContain(read);
    expect(PAGE).toContain("mailto:${SUPPORT_EMAIL}");
    expect(PAGE).toContain('href="/feedback"');
    expect(PAGE).toContain('link("/changelog")');
    expect(PAGE).toContain('link("/download")');
    expect(PAGE).toContain("breadcrumbJsonLd");
    expect(PAGE).toContain("pageMetadata");
    expect(PAGE).toContain('path: "/press"');
  });

  it("uses the colours of the site: the accent constants, the page background and the ink of globals.css", () => {
    const css = read("src/app/globals.css");
    expect(PAGE).toMatch(/const INK = "(#[0-9a-f]{6})"/);
    const ink = /const INK = "(#[0-9a-f]{6})"/.exec(PAGE)![1];
    expect(css).toContain(`--color-ink: ${ink};`);
    expect(css).toContain(`--color-bg: ${PWA_THEME_COLOR};`);
    expect(css).toContain(`--color-accent-dim: ${ACCENT};`);
    expect(css).toContain(`--color-accent: ${ACCENT_LIGHT};`);
  });

  it("links logo files that already ship, at the sizes it names, and a social card in every language", () => {
    const files = [...PAGE.matchAll(/\{ path: "(\/[^"]+)", label:/g)].map((m) => m[1]);
    expect(files).toEqual(["/icon.svg", "/icons/icon-512.png", "/icons/icon-192.png"]);
    for (const file of files) expect(fs.existsSync(path.join(ROOT, "public", file)), file).toBe(true);
    const size = (file: string) => {
      const b = fs.readFileSync(path.join(ROOT, "public", file));
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    };
    expect(size("/icons/icon-512.png")).toEqual({ width: 512, height: 512 });
    expect(size("/icons/icon-192.png")).toEqual({ width: 192, height: 192 });
    expect(press("en")["brand.filePng512"]).toContain("512 × 512");
    expect(press("en")["brand.filePng192"]).toContain("192 × 192");
    expect(read("public/icon.svg")).toContain("<svg");
    for (const locale of LOCALES) {
      const file = `public/og/${locale}/home.png`;
      expect(fs.existsSync(path.join(ROOT, file)), file).toBe(true);
      const b = fs.readFileSync(path.join(ROOT, file));
      expect({ width: b.readUInt32BE(16), height: b.readUInt32BE(20) }, file).toEqual({ width: 1200, height: 630 });
    }
    expect(PAGE).toContain("/og/${locale}/home.png");
    expect(PAGE).toContain("download");
  });

  it("is where the other pages expect it: the sitemap, the footer, the social cards and the smoke test", () => {
    expect(read("src/app/sitemap.ts")).toContain('"/press"');
    expect(read("src/components/site/Footer.tsx")).toContain('"/press"');
    expect(OG_CARD_PAGES).toContain("press");
    for (const locale of LOCALES) expect(fs.existsSync(path.join(ROOT, `public/og/${locale}/press.png`)), locale).toBe(true);
    const smoke = read("scripts/smoke-test.mjs");
    expect((smoke.match(/"\/press" \/\* --- press --- \*\//g) ?? []).length).toBe(2);
    expect(smoke).toContain("press: the fact sheet names the website build label");
  });
});
