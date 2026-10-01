"use client";

import { useEffect, useState } from "react";
import { NextIntlClientProvider } from "next-intl";
import { locales, routing, type Locale } from "@/i18n/routing";
import { BASE_PATH, SITE_NAME } from "@/lib/site";
import NotFoundContent from "@/components/site/NotFoundContent";
import en from "../../../messages/en.json";
import pl from "../../../messages/pl.json";
import es from "../../../messages/es.json";

const MESSAGES: Record<Locale, typeof en> = { en, pl, es };

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
