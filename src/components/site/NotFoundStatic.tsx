"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { locales, routing, type Locale } from "@/i18n/routing";
import { BASE_PATH, SITE_NAME } from "@/lib/site";
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
type SiteChrome = Pick<typeof en.SiteRedesign, "nav" | "footer" | "lang" | "families"> & { studio: Pick<typeof en.SiteRedesign.studio, "search"> };
type StaticMessages = Pick<typeof en, "NotFound" | "Navbar" | "Footer" | "Pwa" | "Headings" | "DesktopLink"> & {
  Gallery: Pick<typeof en.Gallery, "navLabel">;
  SiteRedesign: SiteChrome;
};
const chrome = (c: typeof en): SiteChrome => ({
  nav: c.SiteRedesign.nav,
  footer: c.SiteRedesign.footer,
  lang: c.SiteRedesign.lang,
  families: c.SiteRedesign.families,
  studio: { search: c.SiteRedesign.studio.search },
});
const MESSAGES: Record<Locale, StaticMessages> = {
  en: { NotFound: en.NotFound, Navbar: en.Navbar, Footer: en.Footer, Gallery: { navLabel: en.Gallery.navLabel }, DesktopLink: en.DesktopLink, Pwa: en.Pwa, Headings: en.Headings, SiteRedesign: chrome(en) },
  pl: { NotFound: pl.NotFound, Navbar: pl.Navbar, Footer: pl.Footer, Gallery: { navLabel: pl.Gallery.navLabel }, DesktopLink: pl.DesktopLink, Pwa: pl.Pwa, Headings: pl.Headings, SiteRedesign: chrome(pl) },
  es: { NotFound: es.NotFound, Navbar: es.Navbar, Footer: es.Footer, Gallery: { navLabel: es.Gallery.navLabel }, DesktopLink: es.DesktopLink, Pwa: es.Pwa, Headings: es.Headings, SiteRedesign: chrome(es) },
};

/** Reads the locale from the URL the static host failed to serve (/<base>/<locale>/...). */
function localeFromLocation(): Locale {
  if (typeof window === "undefined") return routing.defaultLocale;
  let p = window.location.pathname;
  if (BASE_PATH && p.startsWith(BASE_PATH)) p = p.slice(BASE_PATH.length);
  const first = p.split("/").filter(Boolean)[0];
  return locales.includes(first as Locale) ? (first as Locale) : routing.defaultLocale;
}

/**
 * Localised 404 page for static hosting. The HTML is rendered in the default locale; once it
 * runs in the browser it switches to the language found in the requested URL.
 */
export default function NotFoundStatic() {
  const [locale, setLocale] = useState<Locale>(routing.defaultLocale);
  useEffect(() => {
    const detected = localeFromLocation();
    setLocale(detected);
    document.documentElement.lang = detected;
  }, []);
  return (
    <NextIntlClientProvider key={locale} locale={locale} messages={MESSAGES[locale]} timeZone="UTC">
      {/* --- review fix (ui-i18n) --- React owns the page's single <title> (hoisted into <head>), in the detected language */}
      <title>{`${MESSAGES[locale].NotFound.title} – ${SITE_NAME}`}</title>
      <NotFoundContent />
    </NextIntlClientProvider>
  );
}
