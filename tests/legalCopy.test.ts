import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { PLANS, formatUsd } from "@/lib/billing/config";
import { faqPrices } from "@/lib/faqValues";

/*
 * --- legal-copy --- The legal, privacy, claims and download-page copy says only what the code does. This file pins the claims
 * that must stay true (and the places a wrong one used to be): no PayPal before payment, no promise of direct publishing while the
 * channels cannot be connected, a controller block on the privacy page, no cookie statement the code contradicts, the Fight League
 * notice in every language, the FAQ price from the plans, the checkout line, and the download page's disclosures.
 */

type Locale = "en" | "pl" | "es";
const ROOT = path.join(__dirname, "..");
const read = (...parts: string[]) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

function flatten(node: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (typeof node === "string") out[prefix] = node;
  else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  return out;
}
const FLAT: Record<Locale, Record<string, string>> = { en: flatten(en), pl: flatten(pl), es: flatten(es) };
const each = (fn: (locale: Locale, flat: Record<string, string>) => void) => (Object.keys(FLAT) as Locale[]).forEach((l) => fn(l, FLAT[l]));
const render = (text: string, locale: Locale, values: Record<string, unknown> = {}) => String(new IntlMessageFormat(text, locale).format(values as never));

describe("PayPal", () => {
  // PayPal is off on the live billing Worker (GET /config: providers.paypal false). These are the only strings that may name it: each is
  // rendered only when the backend lists PayPal as on (the pay button, the email hint) or to the owner of a PayPal licence (Manage on PayPal).
  const ALLOWED = ["Billing.pay.paypal", "Billing.email.hintPaypal", "Billing.manage.paypal", "Billing.manage.paypalHint"];
  it("is named in no visible message except the provider-specific ones, in any language", () => {
    each((locale, flat) => {
      const named = Object.entries(flat).filter(([key, text]) => /paypal/i.test(text) && !ALLOWED.includes(key));
      expect(named.map(([key, text]) => `${locale} ${key}: ${text.slice(0, 80)}`)).toEqual([]);
      for (const key of ALLOWED) expect(flat[key], `${locale} ${key}`).toBeTruthy();
    });
  });
  it("is not offered by the pay buttons until the backend has said it is on", () => {
    const cards = read("src", "components", "billing", "PlanCards.tsx");
    expect(cards).toMatch(/configState === "unconfigured" \? \[\.\.\.PROVIDERS\] : PROVIDERS\.filter\(\(p\) => p !== "paypal"\)/);
    expect(cards).toContain('shown.includes("paypal")'); // the email hint's PayPal sentence
  });
});

describe("publishing claims", () => {
  // Sales and legal copy: what a visitor reads before paying. (Account.connections.*, Publish.* and Controls.* are the signed-in channel UI and the studio.)
  const SALES = [/^Billing\.(?!privacy|manage|pay|claim|restore|paste|licenseError|dialog|account\.)/, /^Terms\./, /^FAQ\./, /^About\./, /^TikTokBallVideos\./, /^Layout\./, /^SiteRedesign\./, /^DesktopLink\./, /^Account\.(metaDescription|lede|free|next\.text)$/];
  const PROMISES: Record<Locale, RegExp[]> = {
    en: [/publish(es|ing)? (directly )?(to|on) (TikTok|Instagram|YouTube)/i, /post(s|ing)? directly/i, /connect (as many|your|every)/i, /one[- ](click|tap)/i, /adds? publish(ing)?\b/i],
    pl: [/publikowani[ea] (bezpośrednio )?na (TikTok|Instagram|YouTube)/i, /dodaje publikowanie/i, /połącz (tyle|wszystkie)/i],
    es: [/publicar (directamente )?en (TikTok|Instagram|YouTube)/i, /añade (la )?publicación/i, /conecta (tantas|todas)/i],
  };
  it("does not promise publishing to TikTok, Instagram or YouTube in the pricing, terms, FAQ or ad-facing copy", () => {
    each((locale, flat) => {
      const hits = Object.entries(flat)
        .filter(([key]) => SALES.some((re) => re.test(key)))
        .filter(([, text]) => PROMISES[locale].some((re) => re.test(text)));
      expect(hits.map(([key, text]) => `${locale} ${key}: ${text.slice(0, 90)}`)).toEqual([]);
    });
  });
  it("has patterns that catch the wording this replaced, over a real set of keys", () => {
    expect(PROMISES.en.some((re) => re.test("Pro exports them clean and adds Publish."))).toBe(true);
    expect(PROMISES.en.some((re) => re.test("Publish to TikTok, Instagram and YouTube"))).toBe(true);
    expect(PROMISES.en.some((re) => re.test("Connect as many TikTok, Instagram and YouTube accounts as you like."))).toBe(true);
    expect(PROMISES.pl.some((re) => re.test("Publikowanie na TikToku, Instagramie i YouTube"))).toBe(true);
    expect(PROMISES.pl.some((re) => re.test("dodaje publikowanie na Twoich kontach"))).toBe(true);
    expect(PROMISES.es.some((re) => re.test("Publicar en TikTok, Instagram y YouTube"))).toBe(true);
    expect(PROMISES.es.some((re) => re.test("añade la publicación en tus cuentas"))).toBe(true);
    each((_locale, flat) => expect(Object.keys(flat).filter((key) => SALES.some((re) => re.test(key))).length).toBeGreaterThan(150));
  });
  it("says what Pro adds as sharing with the share sheet or a download", () => {
    expect(en.Billing.compare.create.publish).toBe("Share to TikTok, Instagram and YouTube with the share sheet or a download");
    expect(en.Billing.lede).toContain("quick share");
    expect(en.Billing.terms.content).toContain("quick share");
    expect(en.Billing.terms.content).toContain("share sheet or a download");
    for (const locale of ["pl", "es"] as const) {
      const flat = FLAT[locale];
      expect(flat["Billing.compare.create.publish"], locale).not.toBe(FLAT.en["Billing.compare.create.publish"]);
      expect(flat["Billing.terms.content"], locale).toMatch(locale === "pl" ? /szybkie udostępnianie/ : /envío rápido/);
    }
  });
  it("lets the Account page say that channels cannot be connected, from the relay's own answer", () => {
    each((locale, flat) => {
      expect(flat["Account.closed.title"], locale).toBeTruthy();
      expect(flat["Account.closed.text"], locale).toBeTruthy();
    });
    const panel = read("src", "components", "account", "AccountPanel.tsx");
    // the notice shows when the relay's health listed no platform: it reads the answer, there is no literal switch
    expect(panel).toMatch(/healthStatus === "ok" && !!a\.health && !a\.health\.platforms\.tiktok && !a\.health\.platforms\.instagram && !a\.health\.platforms\.youtube/);
    expect(panel).toContain('data-testid="account-channels-closed"');
    // the client reads the platforms from /api/health
    expect(read("src", "lib", "account", "client.ts")).toMatch(/platforms: \{ tiktok: p\.tiktok === true, instagram: p\.instagram === true, youtube: p\.youtube === true \}/);
  });
});

describe("the privacy page", () => {
  const page = read("src", "app", "[locale]", "privacy", "page.tsx");
  it("starts with a controller block: the operator's name, address and support address, else the feedback form", () => {
    expect(page).toContain('import { LEGAL_ADDRESS, LEGAL_NAME, SUPPORT_EMAIL } from "@/lib/operator"');
    expect(page).toContain('t("controller.named"');
    expect(page).toContain('t("controller.unnamed"');
    expect(page).toContain('reach("controller.writeTo", "controller.useForm")');
    each((locale, flat) => {
      expect(flat["Privacy.controller.named"], locale).toMatch(/\{legalName\}\{address\}/);
      expect(flat["Privacy.controller.unnamed"], locale).toContain("{siteDomain}");
      expect(flat["Privacy.controller.writeTo"], locale).toContain("<mail>{email}</mail>");
      expect(flat["Privacy.controller.useForm"], locale).toMatch(/<link>[^<]+<\/link>/);
    });
    const named = render(en.Privacy.controller.named, "en", { siteName: "Site", legalName: "A. Person", address: ", 1 High Street, Town" });
    expect(named).toBe("Site is run by A. Person, 1 High Street, Town.");
  });
  it("numbers its sections from one list, controller second, and renders the rights, advertising, consent and Windows app sections", () => {
    const order = /const ORDER = \[([\s\S]*?)\] as const;/.exec(page)?.[1].match(/"(\w+)"/g)?.map((s) => s.replace(/"/g, "")) ?? [];
    expect(order.slice(0, 3)).toEqual(["introduction", "controller", "information"]);
    for (const id of ["rights", "advertising", "consent", "publishing", "payments", "windowsApp", "contact"]) expect(order, id).toContain(id);
    for (const id of order.filter((x) => x !== "payments")) each((locale, flat) => expect(flat[`Privacy.${id}.title`], `${locale} ${id}`).toBeTruthy());
    expect(page).toContain("const heading = (id: SectionId) => `${ORDER.indexOf(id) + 1}. ${label(id)}`");
    // the titles carry no number of their own any more
    each((locale, flat) => {
      for (const [key, text] of Object.entries(flat)) if (/^Privacy\.[A-Za-z]+\.title$/.test(key)) expect(text, `${locale} ${key}`).not.toMatch(/^\d+\./);
    });
  });
  it("says what the code does about cookies, analytics, advertising and the legacy statements", () => {
    // no cookie is set anywhere in the site's code
    const sources = walk(path.join(ROOT, "src")).filter((f) => /\.(ts|tsx)$/.test(f));
    const cookieWrites = sources.filter((f) => /document\.cookie\s*=|Set-Cookie|cookies\(\)\.set/.test(fs.readFileSync(f, "utf8")));
    expect(cookieWrites.map((f) => path.relative(ROOT, f))).toEqual([]);
    expect(en.Privacy.cookies.content).toMatch(/^This site sets no cookies\./);
    expect(pl.Privacy.cookies.content).toMatch(/^Ta strona nie ustawia plików cookie\./);
    expect(es.Privacy.cookies.content).toMatch(/^Este sitio no instala cookies\./);
    // the advertising section says the product is advertised elsewhere and loads no pixels; no ad code exists in the site
    const adCode = sources.filter((f) => /adsbygoogle|googlesyndication|googletagmanager|gtag\(|fbq\(|ttq\.|connect\.facebook\.net|snap\.licdn/.test(fs.readFileSync(f, "utf8")));
    expect(adCode.map((f) => path.relative(ROOT, f))).toEqual([]);
    expect(en.Privacy.advertising.content).toContain("We do not show ads on this site");
    expect(en.Privacy.advertising.content).toContain("no advertising pixels");
    // the statements that used to be wrong
    each((locale, flat) => {
      const privacy = Object.entries(flat).filter(([key]) => key.startsWith("Privacy.") && !key.includes("metaD") );
      expect(privacy.filter(([, text]) => /AdSense|minimal cookies|minimalnej liczby plików cookie|mínimo de cookies|a privacy-focused service/i.test(text)).map(([k]) => `${locale} ${k}`)).toEqual([]);
      expect(flat["Privacy.adsenseNotice.title"], locale).toBeUndefined();
    });
    // Cloudflare Web Analytics is named, and the action-counting service only when the build has a script address
    each((locale, flat) => expect(flat["Privacy.information.analytics.content"], locale).toContain("Cloudflare Web Analytics"));
    expect(page).toContain("NEXT_PUBLIC_ANALYTICS_SCRIPT_URL");
    expect(page).toMatch(/\(host \? \["events"\] : \[\]\)/);
    expect(page).toMatch(/\{host && <p>\{t\("advertising\.campaign", v\)\}<\/p>\}/);
    each((locale, flat) => {
      expect(flat["Privacy.information.events.content"], locale).toContain("{host}");
      expect(flat["Privacy.advertising.campaign"], locale).toContain("{host}");
    });
    // --- review fix (copy) --- the service sees the whole address: the campaign name, the ad click identifier and, in the studio, the run's settings
    expect(en.Privacy.information.events.content).toContain("ad click identifier");
    expect(en.Privacy.information.events.content).toContain("settings of your run");
    expect(en.Privacy.information.events.content).not.toMatch(/never receives your email, your settings/);
    expect(en.Privacy.advertising.campaign).toContain("ad click identifier");
    expect(en.Privacy.windowsApp.licence.content).toMatch(/buy, restore or manage Pro/);
  });
  it("says what the Windows app sends where, as desktop/src does it", () => {
    const updater = read("desktop", "src", "updater.ts");
    expect(updater).toContain("UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000"); // "every four hours"
    expect(en.Privacy.windowsApp.updates.content).toContain("every four hours");
    expect(pl.Privacy.windowsApp.updates.content).toContain("co cztery godziny");
    expect(es.Privacy.windowsApp.updates.content).toContain("cada cuatro horas");
    expect(read("desktop", "electron-builder.config.cjs")).toContain("https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download"); // the update feed is on GitHub
    expect(read("desktop", "src", "ai", "diagnostics.ts")).toContain('NETWORK_TEST_URL = "https://huggingface.co/');
    expect(read("src", "lib", "billing", "config.ts")).toContain("RENEWAL_RETRY_MS"); // the licence renewals the app and the site ask the billing server for
    // "no usage data, no crash reports": nothing in the app's code collects either
    const appCode = walk(path.join(ROOT, "desktop", "src")).filter((f) => f.endsWith(".ts"));
    const collectors = appCode.filter((f) => /crashReporter|telemetry|analytics|sentry|bugsnag/i.test(fs.readFileSync(f, "utf8")));
    expect(collectors.map((f) => path.relative(ROOT, f))).toEqual([]);
    expect(en.Privacy.windowsApp.intro).toContain("no usage data and no crash reports");
  });
  it("names the people it is shared with and links their policies", () => {
    for (const id of ["cloudflare", "stripe", "nowpayments", "google", "github", "huggingface"]) expect(page, id).toContain(`["${id}", "https://`);
    each((locale, flat) => {
      for (const id of ["cloudflare", "stripe", "nowpayments", "google", "github", "huggingface"]) {
        expect(flat[`Privacy.thirdParty.${id}.name`], locale).toBeTruthy();
        expect(flat[`Privacy.thirdParty.${id}.use`], locale).toBeTruthy();
      }
    });
  });
  it("is dated 14 October 2026 or later, and keeps its style (no dashes between words, no semicolons)", () => {
    const dated = /export const LEGAL_LAST_UPDATED = "(\d{4}-\d{2}-\d{2})"/.exec(read("src", "lib", "legalDates.ts"))?.[1] ?? "";
    expect(dated >= "2026-10-14").toBe(true);
    each((locale, flat) => {
      for (const [key, text] of Object.entries(flat)) {
        if (!/^(Privacy\.(?!meta)|Disclaimer\.fanMade|Terms\.(description|ugc\.footer|intellectual)|Billing\.privacy)/.test(key)) continue;
        expect(text, `${locale} ${key}`).not.toMatch(/ — | – |;/);
      }
    });
  });
});

describe("Fight League notice", () => {
  it("is on the Disclaimer page in every language, with the way to ask for a name to be removed", () => {
    each((locale, flat) => {
      expect(flat["Disclaimer.fanMade.title"], locale).toBeTruthy();
      expect(flat["Disclaimer.fanMade.content"], locale).toContain("Fight League");
      expect(flat["Disclaimer.fanMade.content"], locale).toContain("{siteName}");
      expect(flat["Disclaimer.fanMade.rightsEmail"], locale).toContain("<mail>{email}</mail>");
      expect(flat["Disclaimer.fanMade.rightsForm"], locale).toMatch(/<link>[^<]+<\/link>/);
    });
    expect(en.Disclaimer.fanMade.content).toMatch(/fan-made simulation/);
    expect(en.Disclaimer.fanMade.content).toMatch(/not affiliated with, endorsed by or sponsored by them/);
    const page = read("src", "app", "[locale]", "disclaimer", "page.tsx");
    expect(page).toContain('"fanMade"');
    expect(page).toContain('k === "fanMade"');
    expect(page).toMatch(/SUPPORT_EMAIL\s*\? t\.rich\("fanMade\.rightsEmail"/); // the e-mail line only when the build has one
  });
  it("narrows the FAQ answer on commercial use and the terms on ownership", () => {
    each((locale, flat) => {
      expect(flat["FAQ.q3.answer"], locale).toContain("Fight League");
      expect(flat["Terms.ugc.footer"], locale).toContain("Fight League");
      expect(flat["Terms.intellectual.content"], locale).toContain("Fight League");
    });
  });
});

describe("prices", () => {
  it("FAQ q1 names no price of its own: it takes {monthly} and {yearly} from the plans", () => {
    each((locale, flat) => {
      const answer = flat["FAQ.q1.answer"];
      expect(answer, locale).toContain("{monthly}");
      expect(answer, locale).toContain("{yearly}");
      expect(answer, locale).not.toMatch(/6[.,]99|\b49\b/);
    });
    expect(faqPrices("en")).toEqual({ monthly: formatUsd(PLANS.monthly.usd, "en"), yearly: formatUsd(PLANS.yearly.usd, "en") });
    expect(render(en.FAQ.q1.answer, "en", { ...faqPrices("en"), siteName: "Site" })).toContain("$6.99 a month or $49 a year");
    expect(render(pl.FAQ.q1.answer, "pl", { ...faqPrices("pl"), siteName: "Site" })).toMatch(/6,99.*miesięcznie.*49.*rocznie/);
    expect(render(es.FAQ.q1.answer, "es", { ...faqPrices("es"), siteName: "Site" })).toMatch(/6,99.*al mes.*49.*al año/);
    // both places that format the answers pass the prices
    expect(read("src", "app", "[locale]", "page.tsx")).toContain("const v = { siteName: SITE_NAME, ...prices };");
    expect(read("src", "app", "[locale]", "page.tsx")).toContain("<FAQ {...prices} />");
    expect(read("src", "components", "site", "FAQ.tsx")).toContain("{ siteName: SITE_NAME, monthly, yearly }");
  });
  it("shows a checkout line under the pay buttons: US dollars, tax, and a link to the Terms", () => {
    each((locale, flat) => {
      expect(flat["Billing.checkout.line"], locale).toMatch(/<terms>[^<]+<\/terms>/);
    });
    expect(en.Billing.checkout.line).toBe("Prices are in US dollars. Tax may be added at checkout. By paying you accept the <terms>Terms</terms>.");
    const cards = read("src", "components", "billing", "PlanCards.tsx");
    expect(cards).toContain('t.rich("checkout.line"');
    expect(cards).toContain("assetPath(`/${locale}/terms/`)");
    expect(cards.indexOf('t.rich("checkout.line"')).toBeGreaterThan(cards.indexOf("PLAN_IDS.map"));
  });
});

describe("claims that cannot be shown", () => {
  it("the TikTok guide and the clip-length tip no longer say what TikTok rewards or where engagement peaks", () => {
    expect(en.TikTokBallVideos.p1).not.toMatch(/steadiest/i);
    expect(en.TikTokBallVideos.p2).not.toMatch(/engagement peaks/i);
    expect(en.TikTokBallVideos.p3).not.toMatch(/rewards/i);
    expect(en.Editorial.tipClipLengthBody).not.toMatch(/does best/i);
    expect(pl.TikTokBallVideos.p1).not.toMatch(/najpewniejszych/);
    expect(pl.TikTokBallVideos.p2).not.toMatch(/najwyższe/);
    expect(pl.Editorial.tipClipLengthBody).not.toMatch(/najlepiej działa/);
    expect(es.TikTokBallVideos.p1).not.toMatch(/más constantes/);
    expect(es.TikTokBallVideos.p2).not.toMatch(/más alta/);
    expect(es.Editorial.tipClipLengthBody).not.toMatch(/funcionan mejor/);
  });
});

describe("the download page", () => {
  const page = read("src", "app", "[locale]", "download", "page.tsx");
  it("says the app is free, what the free version lacks and what Pro costs, from the plans, with inline Terms and Privacy links", () => {
    each((locale, flat) => {
      expect(flat["Desktop.setupNote"], locale).toContain("{price}");
      expect(flat["Desktop.setupLegal"], locale).toMatch(/<terms>[^<]+<\/terms>/);
      expect(flat["Desktop.setupLegal"], locale).toMatch(/<privacy>[^<]+<\/privacy>/);
    });
    expect(en.Desktop.setupNote).toBe("Free to download and use. Videos made without Pro carry a small watermark. Pro costs {price} a month.");
    expect(page).toContain('t("setupNote", { price: formatUsd(PLANS.monthly.usd, locale) })');
    expect(page).toContain('href="/terms"');
    expect(page).toContain('href="/privacy"');
  });
  it("is honest about the unsigned installer: what the warnings say, how to check the file, what to choose", () => {
    expect(en.Desktop.smartScreenBody).toContain("not code-signed yet");
    expect(pl.Desktop.smartScreenBody).toContain("nie jest jeszcze podpisany");
    expect(es.Desktop.smartScreenBody).toContain("todavía no tiene firma");
    for (const locale of ["en", "pl", "es"] as const) {
      expect(FLAT[locale]["Desktop.smartScreenVerify"], locale).toContain("Get-FileHash");
      expect(FLAT[locale]["Desktop.smartScreenVerify"], locale).toContain("<virustotal>VirusTotal</virustotal>");
      expect(FLAT[locale]["Desktop.smartScreenSteps"], locale).toBeTruthy();
    }
    // the installer really is unsigned until a certificate is set (the page must change the day it is not)
    expect(read("desktop", "electron-builder.config.cjs")).toContain("const signed = !!process.env.WIN_CSC_LINK");
    each((locale, flat) => {
      const downloadKeys = Object.entries(flat).filter(([key]) => /^Desktop\.(smartScreen|setup|privacy|portable|intro|requirements|features)/.test(key) || key.startsWith("DesktopAiFix.download"));
      expect(downloadKeys.filter(([, text]) => /GitHub Actions|automatically by GitHub|builds? automatic|Built automatically/i.test(text)).map(([k]) => `${locale} ${k}`)).toEqual([]);
    });
  });
  it("has no stale 1.0.2 note and says the graphics card encodes the videos", () => {
    each((locale, flat) => {
      expect(flat["DesktopAiFix.downloadUpdateNote"], locale).toBeUndefined();
      expect(Object.entries(flat).filter(([key, text]) => key.startsWith("DesktopAiFix.download") && /1\.0\.2/.test(text))).toEqual([]);
    });
    expect(page).not.toContain("download-update-note");
    expect(en.Desktop.intro).toContain("Your graphics card encodes the videos");
    expect(en.Desktop.intro).not.toMatch(/GPU renders/);
    expect(en.DesktopLink.heroNote).toContain("GPU video encoding");
    expect(en.Desktop.features.gpu).toContain("AV1 on newer cards");
    expect(pl.Desktop.intro).not.toMatch(/GPU renderuje/);
    expect(es.Desktop.intro).not.toMatch(/GPU renderiza/);
  });
  it("carries the third-party notice and the audio line, as the installer and the scripts have it", () => {
    each((locale, flat) => {
      expect(flat["Desktop.privacyNoticesFfmpeg"], locale).toContain("ffmpeg");
      expect(flat["Desktop.privacyNoticesFfmpeg"], locale).toContain("GPL");
      expect(flat["Desktop.privacyNoticesOther"], locale).toContain("Llama");
      expect(flat["Desktop.privacyNoticesOther"], locale).toContain("Electron");
      expect(flat["Desktop.privacyAudio"], locale).toBeTruthy();
    });
    expect(page).toContain('t("privacyNoticesFfmpeg")');
    expect(page).toContain('t("privacyAudio")');
    // ffmpeg and its licence texts are unpacked next to the app, and the default model is Llama 3.2
    const config = read("desktop", "electron-builder.config.cjs");
    expect(config).toContain('"node_modules/ffmpeg-static/**"');
    expect(read("desktop", "package.json")).toContain('"ffmpeg-static"');
    expect(read("desktop", "src", "models", "catalog.ts")).toContain("Llama-3.2-3B-Instruct");
    // the sounds are synthesised and the melodies public domain
    expect(read("scripts", "generate-sounds.py")).toContain("Synthesises the built-in sound effects");
    expect(read("scripts", "generate-midi.py")).toContain("public-domain melody");
  });
});

describe("feedback", () => {
  it("tells a visitor that feedback is unavailable, not how to configure the build, and offers the e-mail line", () => {
    each((locale, flat) => {
      expect(flat["Feedback.notConfigured"], locale).not.toMatch(/NEXT_PUBLIC|build|compil|budowaniem/i);
      expect(flat["Feedback.emailInstead"], locale).toContain("{email}");
    });
    expect(en.Feedback.notConfigured).toBe("Feedback is not available right now. Please try again later.");
    expect(en.Feedback.emailInstead).toBe("Write to {email} instead.");
  });
});

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}
