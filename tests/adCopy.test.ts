import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { PLANS, yearlySavingPercent } from "@/lib/billing/config";
import { SITE_NAME } from "@/lib/site";
import { ATTRIBUTION_PARAMS } from "@/lib/analytics/attribution";
import { RECIPES, SAFE_ZONE, type BotFamily, type BotPlatform } from "@/lib/bot/playbook";
import { dayIndexOf, daySlots, resolveBucket } from "@/lib/bot/planner";
import { PORTRAIT_SAFE_MARGINS, exportSquare } from "@/lib/watermark/layout";
import { FL_ROSTER } from "@/lib/physics/modes/fightLeagueRoster";
import { parseArgs } from "../scripts/viral-bot.mjs";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/**
 * --- press --- The ad kit cannot rot: docs/ads/copy.json is every line of docs/ADS.md as data, and these tests hold it to the limit
 * of its field, to docs/COPY-STYLE.md, to the claims the kit bans (docs/ADS.md section 2), to the prices of the billing config and
 * to the Fight League roster (no fighter or franchise in an ad); and they hold docs/ADS.md to the copy (every line, with its count),
 * to the address rules (a localised address, the UTM names, the parameters the studio keeps) and to the viral bot (every command in it
 * parses, uses an escape or rhythm family, and plans the recipe named on its row, computed with the bot's own planner).
 */

const ROOT = path.resolve(__dirname, "..");
const ADS = fs.readFileSync(path.join(ROOT, "docs", "ADS.md"), "utf8");
const GO_LIVE = fs.readFileSync(path.join(ROOT, "docs", "GO-LIVE.md"), "utf8");

type Locale = "en" | "pl" | "es";
interface Entry {
  platform: string;
  set: string;
  field: string;
  locale: Locale;
  text: string;
  limit: number;
  reserved?: number;
  hold?: boolean;
}
const FILE = JSON.parse(fs.readFileSync(path.join(ROOT, "docs", "ads", "copy.json"), "utf8")) as { entries: Entry[] };
const ENTRIES = FILE.entries;
const LOCALES: Locale[] = ["en", "pl", "es"];
const length = (text: string) => [...text].length;
const counted = (e: Entry) => length(e.text) + (e.reserved ?? 0);
const where = (e: Entry) => `${e.platform}/${e.set}/${e.field}/${e.locale}: ${e.text}`;
const select = (platform: string, field: string, locale: Locale, set?: string) => ENTRIES.filter((e) => e.platform === platform && e.field === field && e.locale === locale && (set === undefined || e.set === set));

/** The limits each field has in docs/ADS.md, pinned here so a limit cannot be raised in the data alone. Google's are from its help page, the rest are third-party figures: confirm in each platform's UI. */
const LIMITS: Record<string, Record<string, number>> = {
  "google-rsa": { headline: 30, description: 90, path1: 15, path2: 15 },
  meta: { "primary-text": 125, headline: 27, description: 30 },
  tiktok: { "ad-text": 100, "display-name": 20 },
  x: { post: 280, "card-headline": 23 },
  reddit: { headline: 150 },
  youtube: { headline: 40, "long-headline": 90, description: 90, "business-name": 25 },
};

describe("docs/ads/copy.json: shape and limits", () => {
  it("has the fields of the schema and the limit that docs/ADS.md states for each field of each platform", () => {
    expect(ENTRIES.length).toBeGreaterThan(100);
    for (const e of ENTRIES) {
      expect(Object.keys(LIMITS), where(e)).toContain(e.platform);
      expect(Object.keys(LIMITS[e.platform]), where(e)).toContain(e.field);
      expect(LOCALES, where(e)).toContain(e.locale);
      expect(typeof e.set === "string" && e.set.length > 0, where(e)).toBe(true);
      expect(e.limit, where(e)).toBe(LIMITS[e.platform][e.field]);
      expect(typeof e.text === "string" && e.text.length > 0, where(e)).toBe(true);
      expect(e.text, where(e)).toBe(e.text.trim());
      expect(e.text, where(e)).not.toMatch(/\s{2,}|\n/);
      if (e.reserved !== undefined) expect(e.platform === "x" && e.field === "post" && e.reserved === 24, where(e)).toBe(true); // the 23 characters X counts for a link and the space before it
    }
  });

  it("keeps every line within the limit of its field, counted in characters with the part the platform adds", () => {
    const over = ENTRIES.filter((e) => counted(e) > e.limit).map((e) => `${counted(e)}/${e.limit} ${where(e)}`);
    expect(over).toEqual([]);
  });

  it("gives every platform a full set in every language", () => {
    for (const locale of LOCALES) {
      expect(select("google-rsa", "headline", locale), `google headlines ${locale}`).toHaveLength(15);
      expect(select("google-rsa", "description", locale), `google descriptions ${locale}`).toHaveLength(4);
      expect(select("google-rsa", "path1", locale)).toHaveLength(1);
      expect(select("google-rsa", "path2", locale)).toHaveLength(1);
      for (const e of [...select("google-rsa", "path1", locale), ...select("google-rsa", "path2", locale)]) expect(e.text, where(e)).toMatch(/^[a-z0-9_-]+$/);
      for (const set of ["creators", "viewers", "classic-hook", "windows"]) {
        for (const field of Object.keys(LIMITS.meta)) expect(select("meta", field, locale, set), `meta ${set} ${field} ${locale}`).toHaveLength(1);
      }
      expect(select("tiktok", "ad-text", locale).length, `tiktok ${locale}`).toBeGreaterThanOrEqual(3);
      expect(select("tiktok", "display-name", locale)).toHaveLength(1);
      expect(select("x", "post", locale).length, `x ${locale}`).toBeGreaterThanOrEqual(2);
      expect(select("x", "card-headline", locale)).toHaveLength(1);
      expect(select("reddit", "headline", locale).length, `reddit ${locale}`).toBeGreaterThanOrEqual(1);
      expect(select("youtube", "headline", locale)).toHaveLength(5);
      expect(select("youtube", "long-headline", locale)).toHaveLength(1);
      expect(select("youtube", "description", locale)).toHaveLength(2);
      expect(select("youtube", "business-name", locale)).toHaveLength(1);
    }
  });

  it("repeats no line within a field and a language (Google refuses duplicate headlines), and holds only the Windows app set", () => {
    const seen = new Set<string>();
    for (const e of ENTRIES) {
      const key = [e.platform, e.set, e.field, e.locale, e.text.toLowerCase()].join("|");
      expect(seen.has(key), where(e)).toBe(false);
      seen.add(key);
    }
    expect(new Set(ENTRIES.filter((e) => e.hold).map((e) => `${e.platform}/${e.set}`))).toEqual(new Set(["meta/windows"]));
    expect(ENTRIES.filter((e) => e.platform === "meta" && e.set === "windows").every((e) => e.hold === true)).toBe(true);
  });

  it("writes Polish and Spanish as their own copy: no line is the English one (the brand name apart)", () => {
    const english = new Set(ENTRIES.filter((e) => e.locale === "en").map((e) => e.text.toLowerCase()));
    for (const e of ENTRIES.filter((x) => x.locale !== "en" && x.text !== SITE_NAME)) expect(english.has(e.text.toLowerCase()), where(e)).toBe(false);
  });
});

// The other creators' account names, built from parts so this file does not spell them (tests/copyStyle.test.ts does the same).
const ACCOUNTS = [["gerald", "bounces"], ["odd", "playground"], ["project", ".jdm"], ["particles", "flow"], ["weapon", "ball", "arena"], ["ball", "thing", "sim"], ["loop", "mechanics"]].map((p) => p.join(""));
const BANNED_FILLER = ["endlessly", "hypnotic", "mesmerising", "mesmerizing", "seamless", "effortless", "dependable", "deterministic"];

describe("docs/ads/copy.json: docs/COPY-STYLE.md", () => {
  it("uses no em dash and no spaced en dash, no semicolon, no parentheses in a line of 80 characters or more, no emoji", () => {
    for (const e of ENTRIES) {
      expect(e.text, where(e)).not.toContain("—");
      expect(e.text, where(e)).not.toContain(" – ");
      expect(e.text, where(e)).not.toContain(";");
      if (length(e.text) >= 80) expect(e.text, where(e)).not.toMatch(/[()]/);
      expect(e.text, where(e)).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("never names another creator's account and does not use the filler words", () => {
    for (const e of ENTRIES) {
      const lower = e.text.toLowerCase();
      expect(ACCOUNTS.some((name) => lower.includes(name)), where(e)).toBe(false);
      expect(BANNED_FILLER.some((word) => lower.includes(word)), where(e)).toBe(false);
    }
  });

  it("uses 'satisfying' (the genre word) at most once in a line", () => {
    for (const e of ENTRIES) expect((e.text.match(/satisfying/gi) ?? []).length, where(e)).toBeLessThanOrEqual(1);
  });

  it("writes the site name as it is written (the display name and the business name are the site's)", () => {
    for (const e of ENTRIES.filter((x) => x.field === "display-name" || x.field === "business-name")) expect(e.text, where(e)).toBe(SITE_NAME);
    for (const e of ENTRIES) if (e.text.toLowerCase().includes("jumpingballs")) expect(e.text.includes(SITE_NAME), where(e)).toBe(true);
  });
});

/** The claims docs/ADS.md section 2 bans, in each language the copy is written in. */
const BANNED: Record<Locale, RegExp[]> = {
  en: [/\bviral\b/i, /\bearn(s|ed|ing|ings)?\b/i, /\bmoney\b/i, /\bincome\b/i, /\bget paid\b/i, /creator rewards?/i, /\bbest\b/i, /number one|#\s?1\b/i, /\bultimate\b/i, /\bunlimited\b/i, /\bguarantee/i, /paypal/i, /\bpublish/i, /\bofficial/i, /\bendorsed\b/i, /fight league/i],
  pl: [/wiral/i, /zarab|zarob|dochod|pieni[ąęd]/i, /najlepsz/i, /numer jeden/i, /bez limitu|nieograniczon/i, /gwarancj|gwarantu/i, /paypal/i, /publik/i, /oficjaln/i, /fight league/i],
  es: [/viral/i, /\bganar\b|\bganas\b|\bgana\b|ganancia|ingreso|dinero/i, /\bmejor(es)?\b/i, /n[úu]mero uno/i, /ilimitad/i, /garantiz|garant[ií]a/i, /paypal/i, /public(a|ar|aci[óo]n|ación)\b/i, /oficial/i, /fight league/i],
};
/** Franchise and company names that are not ours to use in an ad (the roster's sources are added from the code). */
const FRANCHISES = ["Marvel", "DC Comics", "Nintendo", "Pokémon", "Pokemon", "Star Wars", "Disney", "Pixar", "Zelda", "Naruto", "Dragon Ball", "Batman", "Superman", "Spider-Man", "Sonic", "Minecraft"];
const wholeWord = (word: string) => new RegExp(`(?<![\\p{L}\\d])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`, "u");

describe("docs/ads/copy.json: the banned claims", () => {
  it("makes none of the banned claims (viral, earnings, superlatives, PayPal, Publish, Fight League) in any language", () => {
    for (const e of ENTRIES) for (const re of BANNED[e.locale]) expect(re.test(e.text), `${re} in ${where(e)}`).toBe(false);
  });

  it("names no Fight League fighter, no source franchise of the roster and no other franchise", () => {
    const names = new Set<string>();
    for (const row of FL_ROSTER) {
      names.add(row.name);
      names.add(row.source);
    }
    for (const franchise of FRANCHISES) names.add(franchise);
    expect(names.size).toBeGreaterThan(100);
    const hits: string[] = [];
    for (const e of ENTRIES) for (const name of names) if (name.length >= 3 && wholeWord(name).test(e.text)) hits.push(`${name} in ${where(e)}`);
    expect(hits).toEqual([]);
  });

  it("names no platform as an official partner and shows no platform logo (only the platforms' names, to say where a clip can go)", () => {
    for (const e of ENTRIES) expect(e.text, where(e)).not.toMatch(/\b(TikTok|Instagram|YouTube)(®|™)/);
  });
});

/** The Pro prices as each language's copy writes a dollar amount. */
const priceForms = (usd: number): string[] => {
  const cents = Number.isInteger(usd) ? String(usd) : usd.toFixed(2);
  const comma = cents.replace(".", ",");
  return [`$${cents}`, `${comma} USD`, `${comma} US$`];
};

describe("docs/ads/copy.json: facts from the code", () => {
  it("states the Pro price of the billing config and no other price", () => {
    const allowed = new Set([...priceForms(PLANS.monthly.usd), ...priceForms(PLANS.yearly.usd)]);
    let found = 0;
    for (const e of ENTRIES) {
      const prices = e.text.match(/\$\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?(?:USD|US\$)/g) ?? [];
      for (const p of prices) {
        found++;
        expect(allowed.has(p.replace(/\$\s/, "$")), `${p} in ${where(e)}`).toBe(true);
      }
    }
    expect(found).toBeGreaterThanOrEqual(6); // the Search headline and the description of each language, at least
  });

  it("never claims more modes than the studio has, and keeps no other bare number besides the frame size", () => {
    const modes = MODE_CARD_ORDER.length;
    let found = 0;
    for (const e of ENTRIES) {
      const rest = e.text.replace(/1080×1920/g, "").replace(/\$\s?\d+(?:[.,]\d+)?|\d+(?:[.,]\d+)?\s?(?:USD|US\$)/g, "");
      for (const n of rest.match(/\d+/g) ?? []) {
        found++;
        expect(Number(n), `${n} in ${where(e)}`).toBeLessThanOrEqual(modes);
        expect(Number(n), `${n} in ${where(e)}`).toBeGreaterThanOrEqual(30);
      }
    }
    expect(found).toBeGreaterThan(10);
  });

  it("matches the mode count the landing page's own meta description is written with (npm run launch:check compares the live site)", () => {
    for (const catalog of [en, pl, es]) expect(catalog.Layout.metaDescription).toContain("{count}");
    const counts = new Set<string>();
    for (const e of ENTRIES) for (const m of e.text.match(/\b\d{2}\b(?= (?:Ball Physics )?(?:modes|trybów|modos|modes\b))/g) ?? []) counts.add(m);
    expect(counts.size).toBeGreaterThan(0);
    for (const c of counts) expect(Number(c)).toBeLessThanOrEqual(MODE_CARD_ORDER.length);
  });
});

describe("docs/ADS.md carries the copy", () => {
  it("has every line of copy.json in a row with its count: | text | length / limit |", () => {
    const missing = ENTRIES.filter((e) => !ADS.includes(`| ${e.text} | ${counted(e)} / ${e.limit} |`)).map(where);
    expect(missing).toEqual([]);
  });

  it("marks the Windows app set as HOLD and keeps the platform limits marked 'confirm'", () => {
    expect(ADS).toMatch(/Audience C: the Windows app \(HOLD until the installer is code signed\)/);
    expect((ADS.match(/confirm in/gi) ?? []).length).toBeGreaterThanOrEqual(6);
  });

  it("states the real price, the saving and the payment methods", () => {
    expect(ADS).toContain(`$${PLANS.monthly.usd} a month or $${PLANS.yearly.usd} a year, which saves ${yearlySavingPercent(PLANS)}%`);
    expect(ADS).toContain("card or crypto");
    expect(ADS).toMatch(/PayPal[^\n]*\bOff\b|PayPal \| It is off/i);
  });
});

/** The UTM names of docs/ADS.md section 4. */
const SOURCES = ["tiktok", "meta", "google", "youtube", "x", "reddit", "bing", "bio", "newsletter", "press"];
const MEDIUMS = ["paid_social", "cpc", "paid_video", "organic_social", "referral", "email"];
const EXEMPT = /\/(build\.txt|version\.json)$|\/en\/privacy\/$|\/<locale/;
const urls = (ADS.match(/https:\/\/jumpingballslive\.com[^\s`|)>]*/g) ?? []).filter((u) => !EXEMPT.test(u));

describe("docs/ADS.md addresses", () => {
  it("lists the UTM names, every source and medium of the naming table", () => {
    for (const name of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"]) expect(ADS, name).toContain(`| \`${name}\` |`);
    for (const value of [...SOURCES, ...MEDIUMS]) expect(ADS, value).toContain(`\`${value}\``);
    expect(ADS).toContain("`creator-<handle>`");
  });

  it("sends every ad to a localised address (never the bare domain, never the studio for cold traffic) with valid UTM names", () => {
    expect(urls.length).toBeGreaterThanOrEqual(8);
    for (const raw of urls) {
      const url = new URL(raw.replace(/\{[a-z]+\}/g, "x"));
      const locale = url.pathname.split("/")[1];
      expect(LOCALES, raw).toContain(locale);
      const source = url.searchParams.get("utm_source") ?? "";
      const medium = url.searchParams.get("utm_medium") ?? "";
      const campaign = url.searchParams.get("utm_campaign") ?? "";
      const content = url.searchParams.get("utm_content") ?? "";
      expect(SOURCES.includes(source) || /^creator-[a-z0-9._-]+$/.test(source), `${raw} source`).toBe(true);
      expect(MEDIUMS, `${raw} medium`).toContain(medium);
      expect(campaign, `${raw} campaign`).toMatch(/^\d{4}(_[a-z]+){1,2}$/);
      expect(content, `${raw} content`).toMatch(/^(c\d{2}_[a-z-]+_(9x16|1x1|4x5|16x9)_\d+s_(en|pl|es)|t\d{2}|x)$/);
      const clip = /^c\d{2}_([a-z-]+)_[^_]+_\d+s_(en|pl|es)$/.exec(content);
      if (clip) {
        expect(RECIPES.map((r) => r.id), `${raw} recipe`).toContain(clip[1]);
        expect(clip[2], `${raw}: the language of utm_content is the language of the address`).toBe(locale);
      }
      // paid traffic and the Windows app never land in the studio: only warm traffic (organic and referral) may
      if (url.pathname.startsWith(`/${locale}/simulator/`)) expect(["organic_social", "referral", "email"], raw).toContain(medium);
      for (const key of url.searchParams.keys()) expect(([...ATTRIBUTION_PARAMS, "daily"] as string[]).includes(key), `${raw}: ${key} must survive the studio's address rewrite`).toBe(true);
    }
  });

  it("names the bare domain only to forbid it", () => {
    expect(ADS).not.toMatch(/https:\/\/jumpingballslive\.com\/?(?=[\s`|)>]|$)/);
  });
});

describe("docs/ADS.md and the viral bot", () => {
  const commands = [...ADS.matchAll(/node scripts\/viral-bot\.mjs([^\n`]*)/g)].map((m) => m[1].trim());
  const argv = (line: string) => line.split(/\s+/).filter(Boolean);

  it("only shows commands the bot's own parser accepts, with an escape or rhythm family when it plans clips", () => {
    expect(commands.length).toBeGreaterThanOrEqual(8);
    for (const line of commands) {
      const opts = parseArgs(argv(line));
      expect(["escape", "rhythm"], `--family in: ${line}`).toContain(opts.family);
      expect(opts.post, line).toBe(false);
      expect(opts.relay, line).toBeNull();
    }
  });

  it("names, on every recipe row, the recipe the row's own command plans on that date (the bot's planner, recomputed)", () => {
    const rows = ADS.split("\n").filter((l) => /^\| `[a-z-]+` \| (escape|rhythm) \|/.test(l));
    expect(rows).toHaveLength(6);
    const known = new Set(RECIPES.map((r) => r.id));
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      const recipe = cells[1].replaceAll("`", "");
      const date = cells[4];
      const command = /node scripts\/viral-bot\.mjs([^`]*)`/.exec(row)?.[1] ?? "";
      expect(known.has(recipe), recipe).toBe(true);
      const opts = parseArgs(argv(command));
      expect(opts.date, row).toBe(date);
      expect(opts.family, row).toBe(cells[2]);
      expect(opts.count, row).toBe(1);
      const bucket = resolveBucket(opts.platform as BotPlatform, opts.bucket as "auto");
      const plan = (iso: string) => daySlots(dayIndexOf(iso), opts.count, opts.family as BotFamily, "", bucket)[0].recipe;
      expect(plan(date).id, `${row} plans ${plan(date).id}`).toBe(recipe);
      expect(plan(date).family, recipe).toBe(opts.family);
      // the rotation: escape recipes come back every 6 days, rhythm recipes every 4 (what the page says)
      const later = new Date(Date.parse(`${date}T00:00:00Z`) + (opts.family === "escape" ? 6 : 4) * 86_400_000).toISOString().slice(0, 10);
      expect(plan(later).id, `${recipe} again on ${later}`).toBe(recipe);
    }
    expect(ADS).toContain("escape recipes every 6 days, rhythm recipes every 4 days");
  });

  it("never lists a Fight League recipe or the territory recipe as one to use, and says why the default family is not used", () => {
    const recipeRows = ADS.split("\n").filter((l) => /^\| `[a-z-]+` \| (escape|rhythm) \|/.test(l));
    for (const row of recipeRows) expect(row, row).not.toMatch(/fight|territory/);
    expect(ADS).toContain("`--family all`");
    expect(RECIPES.filter((r) => r.id.startsWith("fight-")).every((r) => r.family === "battle")).toBe(true); // what makes the default unsafe
  });

  it("has the bot's own hook line, in every language, for every recipe it names", () => {
    const catalogs = { en, pl, es } as unknown as Record<Locale, { ViralBot: { recipes: Record<string, { hook: string }> } }>;
    const camel = (id: string) => id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
    const rows = ADS.split("\n").filter((l) => /^\| `[a-z-]+` \| (escape|rhythm) \|/.test(l));
    for (const row of rows) {
      const id = /^\| `([a-z-]+)`/.exec(row)?.[1] ?? "";
      for (const locale of LOCALES) expect(ADS, `${id} ${locale}`).toContain(catalogs[locale].ViralBot.recipes[camel(id)].hook);
    }
  });
});

describe("docs/ADS.md and the product", () => {
  it("states the product's own safe margins, the bot's safe zone and the arena square the crops cut", () => {
    const pct = (n: number) => `${n * 100}%`;
    expect(ADS).toContain(`${pct(PORTRAIT_SAFE_MARGINS.left)} left, ${pct(PORTRAIT_SAFE_MARGINS.right)} right, ${pct(PORTRAIT_SAFE_MARGINS.top)} top and ${pct(PORTRAIT_SAFE_MARGINS.bottom)} bottom`);
    expect(ADS).toContain(`bottom ${pct(SAFE_ZONE.bottom)} and the right ${pct(SAFE_ZONE.right)}`);
    const square = exportSquare(1080, 1920);
    expect(ADS).toContain(`crop=${square.width}:${square.height}:${square.x}:${square.y}`);
    const fourFive = { width: 1080, height: 1350, x: 0, y: (1920 - 1350) / 2 };
    expect(ADS).toContain(`crop=${fourFive.width}:${fourFive.height}:${fourFive.x}:${fourFive.y}`);
    expect(ADS).toContain(`y ${square.y} to ${square.y + square.height}`);
  });

  it("points at the launch check, the go-live guide's section 14.2 and the owner steps, which exist", () => {
    expect(ADS).toContain("npm run launch:check");
    expect(ADS).toContain("npm run go-live:check");
    expect(GO_LIVE).toMatch(/^### 14\.2 Publish and ads\b/m);
    expect(GO_LIVE).toContain("docs/ADS.md");
    expect(GO_LIVE).toContain("launch:check");
    const scripts = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts;
    expect(scripts["launch:check"]).toBe("node scripts/launch-check.mjs");
    for (const variable of ["JBL_SUPPORT_EMAIL", "JBL_FEEDBACK_EMAIL", "JBL_LEGAL_NAME", "JBL_LEGAL_ADDRESS", "JBL_ANALYTICS_SCRIPT_URL", "JBL_ANALYTICS_SITE_ID"]) {
      expect(ADS, variable).toContain(variable);
      expect(fs.readFileSync(path.join(ROOT, "deploy", "vps", "jbl-deploy.sh"), "utf8"), `${variable} is passed by the deployer`).toContain(variable);
    }
  });
});
