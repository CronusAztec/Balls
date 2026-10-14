// --- seo --- one place for what search engines and link previews read: every page's metadata, the social cards' addresses and the JSON-LD blocks
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { localeAlternates } from "@/i18n/alternates";
import { SITE_NAME, SITE_URL, absoluteUrl, pageUrl } from "@/lib/site";
import { LEGAL_NAME, SUPPORT_EMAIL } from "@/lib/operator";
import { latestRelease } from "@/content/changelog";

/*
 * Next merges metadata one level deep: a page that sets `openGraph` replaces the layout's whole object, so a page that sets
 * only some of it publishes the home page's address or no picture. Every page therefore builds its head with pageMetadata():
 *
 *   export async function generateMetadata({ params }) {
 *     const { locale } = await params;
 *     const t = await getTranslations({ locale, namespace: "About" });
 *     return pageMetadata({ locale, path: "/about", title: t("metaTitle", v), description: t("metaDescription", v) });
 *   }
 *
 * The title and description are the only inputs a page must give. The helper adds the canonical address and the hreflang set,
 * a complete Open Graph card (address = canonical, site name, type, locale and the other two, the picture with its size and
 * alt text) and the Twitter card. The picture is the page's own card, public/og/<locale>/<page>.png (scripts/generate-og-cards.mjs),
 * found from the path; a page without a card (the legal pages, the feedback form, the account page) shows the default one,
 * public/og.png. tests/seo.test.ts calls every page's generateMetadata and holds the result to these rules.
 */

/** The size of every card, in pixels: 1.91 : 1, what Facebook, X, LinkedIn and WhatsApp show without cropping. */
export const OG_SIZE = { width: 1200, height: 630 } as const;

/** The pages that have a card of their own in every language (scripts/generate-og-cards.mjs draws exactly these). */
export const OG_CARD_PAGES = ["home", "simulator", "gallery", "download", "pricing", "about", "tiktok-ball-videos", "changelog", "press"] as const;
export type OgCardPage = (typeof OG_CARD_PAGES)[number];

/** The route of each card page, as pageMetadata's `path` ("" is the home page). */
export const OG_CARD_PATHS: Record<OgCardPage, string> = {
  home: "",
  simulator: "/simulator",
  gallery: "/gallery",
  download: "/download",
  pricing: "/pricing",
  about: "/about",
  "tiktok-ball-videos": "/tiktok-ball-videos",
  changelog: "/changelog",
  press: "/press",
};

/** The card of every page that has none of its own, and the fallback if one is missing (scripts/generate-og.mjs). */
export const DEFAULT_OG_PATH = "/og.png";

/** The Open Graph locale of each site language ("og:locale"). */
export const OG_LOCALES: Record<string, string> = { en: "en_US", pl: "pl_PL", es: "es_ES" };

export interface OgImage {
  url: string;
  width: number;
  height: number;
  alt: string;
  type: "image/png";
}

const isCardPage = (page: string): page is OgCardPage => (OG_CARD_PAGES as readonly string[]).includes(page);

/** The card page whose route is `path` ("/about/" and "/about" alike), if there is one. */
export function cardPageForPath(path: string): OgCardPage | undefined {
  const clean = path.replace(/\/+$/, "");
  return OG_CARD_PAGES.find((page) => OG_CARD_PATHS[page] === clean);
}

/**
 * The picture a page shows when its link is shared: the page's card in the page's language, or `fallbackUrl` (the default
 * card) for a page or a language without one.
 */
export function ogImage(locale: string, page: string | undefined, alt: string, fallbackUrl: string = absoluteUrl(DEFAULT_OG_PATH)): OgImage {
  const own = page !== undefined && isCardPage(page) && (routing.locales as readonly string[]).includes(locale);
  return { url: own ? absoluteUrl(`/og/${locale}/${page}.png`) : fallbackUrl, ...OG_SIZE, alt, type: "image/png" };
}

export interface PageMetadataInput {
  locale: string;
  /** The route without the language: "" for the home page, "/about", "/tiktok-ball-videos" ... */
  path: string;
  title: string;
  description: string;
  /** The card: a card page's key, or a ready picture. Default: the card of `path`, else the default card. */
  image?: OgCardPage | OgImage;
  /** A shorter title or description for the social card, where the page's own are written for search (About). */
  social?: { title?: string; description?: string };
  /** The picture to show when the page's own card is missing (default: public/og.png). The locale layout names it once. */
  fallbackImageUrl?: string;
  /** Keep the page out of search results (the feedback form, the account page). */
  noindex?: boolean;
}

/**
 * The alt text of a page's card: what the picture says (its headline and line) when it is one of the drawn cards, else a
 * line about the default screenshot. `t.has` keeps a missing message from failing the build: the page then gets the default.
 */
async function cardAlt(locale: string, page: OgCardPage | undefined): Promise<{ page: OgCardPage | undefined; alt: string }> {
  const t = await getTranslations({ locale, namespace: "Seo" });
  const v = { siteName: SITE_NAME };
  const sentence = (text: string) => (/[.!?]$/.test(text) ? text : `${text}.`); // the headline of some cards has no full stop of its own
  if (page && t.has(`card.${page}.title`) && t.has(`card.${page}.sub`)) return { page, alt: t("cardAlt", { ...v, title: sentence(t(`card.${page}.title`, v)), sub: t(`card.${page}.sub`, v) }) };
  return { page: undefined, alt: t("defaultAlt", v) };
}

/** A page's whole head: title, description, canonical, hreflang, Open Graph (complete) and Twitter card. */
export async function pageMetadata({ locale, path, title, description, image, social, fallbackImageUrl, noindex }: PageMetadataInput): Promise<Metadata> {
  const url = pageUrl(locale, path);
  const requested = typeof image === "string" ? image : image ? undefined : cardPageForPath(path);
  const picture = typeof image === "object" ? image : await cardAlt(locale, requested).then(({ page, alt }) => ogImage(locale, page, alt, fallbackImageUrl));
  const ogTitle = social?.title ?? title;
  const ogDescription = social?.description ?? description;
  return {
    title,
    description,
    alternates: { canonical: url, languages: localeAlternates(path) },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: OG_LOCALES[locale],
      alternateLocale: Object.entries(OG_LOCALES).filter(([l]) => l !== locale).map(([, ogLocale]) => ogLocale),
      images: [picture],
    },
    twitter: { card: "summary_large_image", title: ogTitle, description: ogDescription, images: [{ url: picture.url, alt: picture.alt }] },
    ...(noindex ? { robots: { index: false } } : {}),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// JSON-LD (schema.org), as plain objects for components/site/JsonLd.tsx. No ratings or reviews: there is no real data for them.
// ---------------------------------------------------------------------------------------------------------------------

const CONTEXT = "https://schema.org";
const IN_STOCK = "https://schema.org/InStock";

/** The brand as an organisation. Contact details only when the operator has set them (NEXT_PUBLIC_SUPPORT_EMAIL, NEXT_PUBLIC_LEGAL_NAME). */
export function organizationJsonLd(): Record<string, unknown> {
  return {
    "@context": CONTEXT,
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    ...(LEGAL_NAME ? { legalName: LEGAL_NAME } : {}),
    url: pageUrl(routing.defaultLocale),
    logo: absoluteUrl("/icons/icon-512.png"),
    ...(SUPPORT_EMAIL ? { contactPoint: { "@type": "ContactPoint", contactType: "customer support", email: SUPPORT_EMAIL, availableLanguage: ["English", "Polish", "Spanish"] } } : {}),
    // sameAs (the social profiles) stays out until the profiles exist.
  };
}

/** The site, at the entry page of the visitor's language (not the bare domain, which only redirects). */
export function webSiteJsonLd(locale: string): Record<string, unknown> {
  return { "@context": CONTEXT, "@type": "WebSite", name: SITE_NAME, url: pageUrl(locale), inLanguage: locale, publisher: { "@id": `${SITE_URL}/#organization` } };
}

/** Home, then the trail: `trail` is the page (and its parents), each with its visible name and its route. */
export function breadcrumbListJsonLd(locale: string, homeLabel: string, trail: readonly { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: [{ name: homeLabel, path: "" }, ...trail].map((crumb, i) => ({ "@type": "ListItem", position: i + 1, name: crumb.name, item: pageUrl(locale, crumb.path) })),
  };
}

/** breadcrumbListJsonLd with the home label in the page's language (the Seo namespace). */
export async function breadcrumbJsonLd(locale: string, trail: readonly { name: string; path: string }[]): Promise<Record<string, unknown>> {
  const t = await getTranslations({ locale, namespace: "Seo" });
  return breadcrumbListJsonLd(locale, t("breadcrumbHome"), trail);
}

/** The simulator as a web application (the home page). */
export function webApplicationJsonLd(a: { locale: string; description: string; browserRequirements: string; featureList: string[] }): Record<string, unknown> {
  return {
    "@context": CONTEXT,
    "@type": "WebApplication",
    name: SITE_NAME,
    url: pageUrl(a.locale),
    inLanguage: a.locale,
    image: ogImage(a.locale, "home", SITE_NAME).url,
    description: a.description,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "Any",
    browserRequirements: a.browserRequirements,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: IN_STOCK },
    featureList: a.featureList,
  };
}

/** The Windows app (the download page): its version, the release notes (the changelog) and when the newest release came out. */
export function softwareApplicationJsonLd(a: { locale: string; description: string; downloadUrl: string; version: string }): Record<string, unknown> {
  const release = latestRelease("app");
  return {
    "@context": CONTEXT,
    "@type": "SoftwareApplication",
    name: `${SITE_NAME} for Windows`,
    operatingSystem: "Windows 10, Windows 11",
    applicationCategory: "MultimediaApplication",
    downloadUrl: a.downloadUrl,
    softwareVersion: a.version,
    releaseNotes: pageUrl(a.locale, "/changelog"),
    ...(release ? { dateModified: release.date } : {}),
    url: pageUrl(a.locale, "/download"),
    inLanguage: a.locale,
    image: ogImage(a.locale, "download", SITE_NAME).url,
    description: a.description,
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: IN_STOCK },
  };
}

/** Pro as a product with one offer per plan (the pricing page). */
export function productJsonLd(a: { locale: string; description: string; offers: readonly { name: string; usd: number; duration: "P1M" | "P1Y" }[] }): Record<string, unknown> {
  const url = pageUrl(a.locale, "/pricing");
  return {
    "@context": CONTEXT,
    "@type": "Product",
    name: `${SITE_NAME} Pro`,
    description: a.description,
    url,
    image: ogImage(a.locale, "pricing", SITE_NAME).url,
    brand: { "@type": "Brand", name: SITE_NAME },
    offers: a.offers.map((offer) => ({
      "@type": "Offer",
      name: offer.name,
      price: offer.usd.toFixed(2),
      priceCurrency: "USD",
      url,
      availability: IN_STOCK,
      priceSpecification: { "@type": "UnitPriceSpecification", price: offer.usd.toFixed(2), priceCurrency: "USD", billingDuration: offer.duration },
    })),
  };
}

/** A list of pages (the gallery's presets). */
export function itemListJsonLd(a: { name: string; items: readonly { name: string; url: string }[] }): Record<string, unknown> {
  return { "@context": CONTEXT, "@type": "ItemList", name: a.name, itemListElement: a.items.map((item, i) => ({ "@type": "ListItem", position: i + 1, name: item.name, url: item.url })) };
}
