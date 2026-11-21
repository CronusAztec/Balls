"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { BASE_PATH, SITE_NAME } from "@/lib/site";
import { bestLocale, localeOfPath, unprefixedRedirectScript } from "@/lib/localeRedirect"; // --- site-nav ---
import NotFoundContent from "@/components/site/NotFoundContent";
import en from "../../../messages/en.json";
import pl from "../../../messages/pl.json";
import es from "../../../messages/es.json";

// --- review fix (site-static) --- only the namespaces the 404 page renders (NotFoundContent, Navbar, Footer, LanguageSwitcher,
// InstallAppButton), read by static property access so webpack's JSON tree-shaking leaves the rest of the catalogs (the
// simulator's ~1,900 keys) out of the /404 chunk. A namespace a component of this page starts to use must be added here.
// --- site-redesign --- the header, the footer and the language list read their labels from SiteRedesign (navigation,
// footer columns, mode families, the search hint), the footer's family headings from Headings, the gallery link from
// Gallery; --- desktop-exe --- the navbar's and footer's Windows app link from DesktopLink.
// --- review fix (site-redesign) --- every field is written out per locale: a catalog handed to a function (or spread) is
// used whole, and webpack then ships all three catalogs in the /404 chunk (tests/siteStatic.test.ts rejects it).
// --- site-nav --- the third way back, "See the modes", is the hero's label.
type SiteChrome = Pick<typeof en.SiteRedesign, "nav" | "footer" | "lang" | "families"> & { studio: Pick<typeof en.SiteRedesign.studio, "search">; hero: Pick<typeof en.SiteRedesign.hero, "seeModes"> };
type StaticMessages = Pick<typeof en, "NotFound" | "Navbar" | "Footer" | "Pwa" | "Headings" | "DesktopLink"> & {
  Gallery: Pick<typeof en.Gallery, "navLabel">;
  SiteRedesign: SiteChrome;
};
const MESSAGES: Record<Locale, StaticMessages> = {
  en: { NotFound: en.NotFound, Navbar: en.Navbar, Footer: en.Footer, Gallery: { navLabel: en.Gallery.navLabel }, DesktopLink: en.DesktopLink, Pwa: en.Pwa, Headings: en.Headings, SiteRedesign: { nav: en.SiteRedesign.nav, footer: en.SiteRedesign.footer, lang: en.SiteRedesign.lang, families: en.SiteRedesign.families, studio: { search: en.SiteRedesign.studio.search }, hero: { seeModes: en.SiteRedesign.hero.seeModes } } },
  pl: { NotFound: pl.NotFound, Navbar: pl.Navbar, Footer: pl.Footer, Gallery: { navLabel: pl.Gallery.navLabel }, DesktopLink: pl.DesktopLink, Pwa: pl.Pwa, Headings: pl.Headings, SiteRedesign: { nav: pl.SiteRedesign.nav, footer: pl.SiteRedesign.footer, lang: pl.SiteRedesign.lang, families: pl.SiteRedesign.families, studio: { search: pl.SiteRedesign.studio.search }, hero: { seeModes: pl.SiteRedesign.hero.seeModes } } },
  es: { NotFound: es.NotFound, Navbar: es.Navbar, Footer: es.Footer, Gallery: { navLabel: es.Gallery.navLabel }, DesktopLink: es.DesktopLink, Pwa: es.Pwa, Headings: es.Headings, SiteRedesign: { nav: es.SiteRedesign.nav, footer: es.SiteRedesign.footer, lang: es.SiteRedesign.lang, families: es.SiteRedesign.families, studio: { search: es.SiteRedesign.studio.search }, hero: { seeModes: es.SiteRedesign.hero.seeModes } } },
};

/**
 * The language of the 404 page: the one the URL the static host failed to serve names (/<base>/<locale>/...), and for an
 * address without a language (--- site-nav ---) the one the visitor's browser asks for first.
 */
function localeFromLocation(): Locale {
  if (typeof window === "undefined") return routing.defaultLocale;
  return localeOfPath(window.location.pathname, BASE_PATH) ?? bestLocale(window.navigator.languages?.length ? window.navigator.languages : [window.navigator.language ?? ""]);
}

/**
 * Localised 404 page for static hosting. The HTML is rendered in the default locale; once it
 * runs in the browser it switches to the language found in the requested URL.
 * --- site-nav --- An address typed without its language that names a page of the site ("/pricing/",
 * "/simulator/?mode=fightLeague") is no dead end: a script in the page's HTML sends the visitor on to that page in their
 * browser's language, query and hash kept, before the 404 is drawn (lib/localeRedirect.ts).
 */
export default function NotFoundStatic() {
  const [locale, setLocale] = useState<Locale>(routing.defaultLocale);
  useEffect(() => {
    const detected = localeFromLocation();
    setLocale(detected);
    document.documentElement.lang = detected;
  }, []);
  return (
    <>
      {/* --- site-nav --- first in the body: it runs while the HTML is parsed, so a known page's address moves on before anything is drawn */}
      <script dangerouslySetInnerHTML={{ __html: unprefixedRedirectScript(BASE_PATH) }} />
      <NextIntlClientProvider key={locale} locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
        {/* --- review fix (ui-i18n) --- React owns the page's single <title> (hoisted into <head>), in the detected language */}
        <title>{`${MESSAGES[locale].NotFound.title} – ${SITE_NAME}`}</title>
        <NotFoundContent />
      </NextIntlClientProvider>
    </>
  );
}
