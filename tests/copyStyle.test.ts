import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { GALLERY } from "@/content/gallery";
import { FAQ_KEYS } from "@/lib/faq";
import { MODE_CARD_ORDER } from "@/lib/modes";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- copy-pass --- The house style of docs/COPY-STYLE.md, enforced on every string a visitor reads: the site namespaces of
 * messages/*.json, the /download page's keys, the simulator's section intros (Controls.*Desc) and its longest tooltips, and
 * the preset gallery (src/content/gallery.ts). No sentence dashes, semicolons, parentheses in running copy, other creators'
 * account names or engine lectures; the budgets of the style guide; the shape of the studio guide and the FAQ.
 */

type Locale = "en" | "pl" | "es";
const LOCALES: Record<Locale, unknown> = { en, pl, es };

/** Every string of a catalog with its dotted key (array items as `.0`, `.1`, … like the spec's `Layout.features.3`). */
function flatten(node: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") out[prefix] = node;
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}

const SITE_NAMESPACES = ["Headings", "Navbar", "SimulatorPage", "Layout", "HowItWorks", "Modes", "FAQ", "Editorial", "Footer", "NotFound", "Feedback", "TikTokBallVideos", "About", "Gallery", "Pwa", "Daily", "Billing", "Watermark", "DesktopLink", "SiteRedesign"];
const DOWNLOAD_PREFIXES = ["Desktop.metaTitle", "Desktop.metaDescription", "Desktop.badge", "Desktop.title", "Desktop.intro", "Desktop.setup", "Desktop.portable", "Desktop.requirements", "Desktop.smartScreen", "Desktop.features", "Desktop.privacy", "DesktopAiFix.download", "Desktop.update" /* --- low-findings-2 --- (the Windows app's update banner) */];
const SECTION_INTRO = /^Controls\.[A-Za-z]+Desc$/;
const TIPS = ["boxSpeedRatioTip", "pwLayoutTip", "prLayoutTip", "glassGatesTip", "captionsTip", "captionTypeTip", "sbRuleTip", "batchRenderTip", "mzBrainTip", "exitBehaviorTip", "splatBarrierTip", "ogRhythmTip", "scStarPresetsTip", "flMakeClipTip"].map((k) => `Controls.${k}`).concat(["BatchRender.listHint", "ViralBot.manual.steps"]);
const COLOUR_SORT_INTRO = "ColourSort.csDesc";

/** Is this key one a visitor reads (docs/COPY-STYLE.md's scope)? */
function covered(key: string): boolean {
  if (SITE_NAMESPACES.includes(key.split(".")[0])) return true;
  if (DOWNLOAD_PREFIXES.some((p) => key === p || key.startsWith(p))) return true;
  return SECTION_INTRO.test(key) || TIPS.includes(key) || key === COLOUR_SORT_INTRO;
}

const FLAT: Record<Locale, Record<string, string>> = { en: flatten(en), pl: flatten(pl), es: flatten(es) };

/** The covered strings of a locale, the gallery's names and descriptions included (as `Gallery:<id>.name` / `.description`). */
function coveredStrings(locale: Locale): [string, string][] {
  const out = Object.entries(FLAT[locale]).filter(([key]) => covered(key));
  for (const preset of GALLERY) {
    out.push([`Gallery:${preset.id}.name`, preset.name[locale]]);
    out.push([`Gallery:${preset.id}.description`, preset.description[locale]]);
  }
  return out;
}

// The other creators' account names, built from parts so this file does not spell them (tests/landClaim.test.ts does the same).
const ACCOUNTS = [["gerald", "bounces"], ["odd", "playground"], ["project", ".jdm"], ["particles", "flow"], ["weapon", "ball", "arena"], ["ball", "thing", "sim"], ["loop", "mechanics"]].map((p) => p.join(""));

const BANNED_EN = ["Behind the simulation", "How the physics engine works", "What each mode does", "No rings", "Seeded and deterministic", "Find Simulation can", "endlessly", "hypnotic", "mesmerising", "mesmerizing", "seamless", "effortless", "dependable", "deterministic", "determinism", "integrator", "Runge", "sub-step"];
const BANNED_STEMS: Record<Locale, string[]> = {
  en: [],
  pl: ["hipnotyz", "nieskończenie", "deterministyczn", "integrator"],
  es: ["hipnótic", "hipnotiz", "interminable", "determinista", "determinístic", "integrador"],
};
const wholeWord = (phrase: string) => new RegExp(`(?<![\\p{L}\\d])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "iu");
// tests/siteStatic.test.ts's literal mode count
const HARD_CODED = /\b\d+\s+(unique |simulation |unikalnymi |únicos )?(modes|modos|trybów|trybami|tryby)\b/i;

/** Every offender of a rule over the covered strings of every locale, as "locale key: text". */
function offenders(rule: (text: string, key: string, locale: Locale) => boolean): string[] {
  const out: string[] = [];
  for (const locale of Object.keys(LOCALES) as Locale[]) for (const [key, text] of coveredStrings(locale)) if (rule(text, key, locale)) out.push(`${locale} ${key}: ${text.slice(0, 100)}`);
  return out;
}

/** The strings of a locale whose keys match. */
function matching(locale: Locale, re: RegExp): [string, string][] {
  return Object.entries(FLAT[locale]).filter(([key]) => re.test(key));
}

const sentences = (text: string) => (text.match(/[.!?](\s|$)/g) ?? []).length;
const length = (text: string) => [...text].length;

describe("copy style (docs/COPY-STYLE.md)", () => {
  it("covers the site namespaces, the download page, the section intros, the long tips and the gallery in every locale", () => {
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const keys = coveredStrings(locale).map(([key]) => key);
      expect(keys.length, locale).toBeGreaterThan(600);
      for (const key of [...TIPS, COLOUR_SORT_INTRO, "SiteRedesign.hero.sub", "Desktop.intro", "DesktopAiFix.downloadModelNote", "Controls.sbDesc", "Desktop.update.available", "Desktop.update.ready" /* --- low-findings-2 --- */]) expect(keys, `${locale} ${key}`).toContain(key);
    }
  });

  it("uses no dash as punctuation: no em-dash, and a spaced en-dash only as the title separator", () => {
    expect(offenders((text) => text.includes("—"))).toEqual([]);
    expect(offenders((text, key) => text.includes(" – ") && !/metaTitle$|PageTitle$/.test(key))).toEqual([]);
  });

  it("uses no semicolons", () => {
    expect(offenders((text) => text.includes(";"))).toEqual([]);
  });

  it("uses no parentheses in running copy (strings of 80 characters or more)", () => {
    expect(offenders((text) => length(text) >= 80 && /[()]/.test(text))).toEqual([]);
  });

  it("never names another creator's account", () => {
    expect(offenders((text) => ACCOUNTS.some((name) => text.toLowerCase().includes(name)))).toEqual([]);
  });

  it("does not lecture: no engine talk, no filler adjectives, in any language", () => {
    expect(offenders((text) => BANNED_EN.some((phrase) => wholeWord(phrase).test(text)))).toEqual([]);
    expect(offenders((text, _key, locale) => BANNED_STEMS[locale].some((stem) => text.toLowerCase().includes(stem)))).toEqual([]);
  });

  it("writes {siteName} rather than the site name, and {count} rather than a number of modes", () => {
    expect(offenders((text) => text.includes("JumpingBallsLive"))).toEqual([]);
    expect(offenders((text) => HARD_CODED.test(text))).toEqual([]);
  });

  it("keeps every mode card's one-liner within 60 to 110 characters in English and 140 in Polish and Spanish", () => {
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const modes = (LOCALES[locale] as { Modes: Record<string, { description?: string }> }).Modes;
      for (const id of MODE_CARD_ORDER) {
        const description = modes[id]?.description ?? "";
        expect(length(description), `${locale} ${id}`).toBeLessThanOrEqual(locale === "en" ? 110 : 140);
        expect(length(description), `${locale} ${id}`).toBeGreaterThanOrEqual(locale === "en" ? 60 : 40);
      }
    }
  });

  // The bound above is what keeps the cards tidy: the card itself never clamps the one-liner, so a phone's narrow card
  // (136 to 187 px on 320 to 640 px screens: five to seven lines) still shows it whole (the smoke test measures every card at 390 and 640 px).
  it("never clamps a mode card's one-liner on the poster card", () => {
    const card = fs.readFileSync(path.join(__dirname, "..", "src", "components", "site", "PosterCard.tsx"), "utf8");
    const description = /<p [^>]*data-poster-description[^>]*>/.exec(card)?.[0] ?? "";
    expect(description).not.toBe("");
    expect(description).not.toMatch(/line-clamp|truncate|overflow-hidden|max-h-/);
  });

  it("keeps the simulator's section intros and long tips within their budgets", () => {
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      const max = (en: number, other: number) => (locale === "en" ? en : other);
      const intros = [...matching(locale, SECTION_INTRO), [COLOUR_SORT_INTRO, FLAT[locale][COLOUR_SORT_INTRO]] as [string, string]];
      expect(intros.length, locale).toBeGreaterThan(50);
      for (const [key, text] of intros) expect(length(text), `${locale} ${key}`).toBeLessThanOrEqual(max(220, 280));
      for (const key of TIPS) expect(length(FLAT[locale][key] ?? ""), `${locale} ${key}`).toBeLessThanOrEqual(max(300, 380));
      for (const key of TIPS) expect(length(FLAT[locale][key] ?? ""), `${locale} ${key}`).toBeGreaterThan(40);
    }
  });

  it("keeps tips, help answers, FAQ answers, How it works steps and meta descriptions short", () => {
    for (const [key, text] of matching("en", /^Editorial\.tip[A-Za-z]+Body$/)) expect(length(text), key).toBeLessThanOrEqual(160);
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      for (const [key, text] of [...matching(locale, /^Editorial\.trouble[A-Za-z]+A$/), ...matching(locale, /^FAQ\.q\d+\.answer$/)]) {
        if (locale === "en") expect(length(text), key).toBeLessThanOrEqual(200);
        expect(sentences(text), `${locale} ${key}: ${text}`).toBeLessThanOrEqual(3);
      }
    }
    for (const [key, text] of matching("en", /^HowItWorks\.step\d+\.description$/)) expect(length(text), key).toBeLessThanOrEqual(110);
    const metas = ["Layout", "SimulatorPage", "About", "TikTokBallVideos", "Billing", "Gallery", "Desktop"].map((ns) => `${ns}.metaDescription`);
    for (const locale of Object.keys(LOCALES) as Locale[]) {
      for (const key of metas) {
        expect(typeof FLAT[locale][key], `${locale} ${key}`).toBe("string");
        expect(length(FLAT[locale][key]), `${locale} ${key}`).toBeLessThanOrEqual(240);
      }
    }
  });

  it("leaves the studio guide four tips and the troubleshooting rows: no physics block, no mode list", () => {
    const EDITORIAL = ["tipsBadge", "tipsTitle", "tipFindSimulationTitle", "tipFindSimulationBody", "tipTextHooksTitle", "tipTextHooksBody", "tipClipLengthTitle", "tipClipLengthBody", "tipSpeedTitle", "tipSpeedBody", "troubleBadge", "troubleTitle", "troubleExportQ", "troubleExportA", "troubleAudioQ", "troubleAudioA", "troubleSpeedQ", "troubleSpeedA", "troubleSettingsQ", "troubleSettingsA", "troubleMidiQ", "troubleMidiA", "troubleStuckQ", "troubleStuckA"];
    for (const [locale, catalog] of Object.entries(LOCALES)) expect([locale, Object.keys((catalog as { Editorial: object }).Editorial)]).toEqual([locale, EDITORIAL]);
  });

  it("asks nine FAQ questions, the same in every language and in the FAQPage data", () => {
    const nine = ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8", "q9"];
    expect([...FAQ_KEYS]).toEqual(nine);
    for (const [locale, catalog] of Object.entries(LOCALES)) {
      const faq = (catalog as { FAQ: Record<string, Record<string, string>> }).FAQ;
      expect([locale, Object.keys(faq)]).toEqual([locale, nine]);
      for (const q of nine) expect([locale, q, Object.keys(faq[q]).sort()]).toEqual([locale, q, ["answer", "question"]]);
    }
  });

  it("gives every mode one name and one description, and nothing else under Modes", () => {
    const expected = ["previewAlt", ...MODE_CARD_ORDER.flatMap((id) => [`${id}.name`, `${id}.description`])].sort();
    for (const [locale, catalog] of Object.entries(LOCALES)) expect([locale, Object.keys(flatten((catalog as { Modes: object }).Modes)).sort()]).toEqual([locale, expected]);
  });

  it("covers the same keys in English, Polish and Spanish", () => {
    const keys = (locale: Locale) => coveredStrings(locale).map(([key]) => key).sort();
    expect(keys("pl")).toEqual(keys("en"));
    expect(keys("es")).toEqual(keys("en"));
  });

  it("keeps the hero's mode-count phrases the smoke suite reads", () => {
    expect(en.SiteRedesign.hero.sub).toContain("one of {count} modes");
    expect(pl.SiteRedesign.hero.sub).toContain("z {count} trybów");
    expect(es.SiteRedesign.hero.sub).toContain("uno de los {count} modos");
  });
});
