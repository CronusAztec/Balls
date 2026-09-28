import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SITE_NAME, SITE_URL, absoluteUrl, pageUrl } from "@/lib/site";
import Analytics from "@/components/site/Analytics";
import "../globals.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** Builds hreflang alternates for a path (used by every page's metadata). */
export function localeAlternates(path: string) {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = pageUrl(l, path);
  languages["x-default"] = pageUrl(routing.defaultLocale, path);
  return languages;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Layout" });
  const title = t("metaTitle", { siteName: SITE_NAME });
  const description = t("metaDescription");
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    // Absolute URLs so they stay correct when the site lives in a sub-folder (GitHub Pages).
    icons: { icon: absoluteUrl("/icon.svg") },
    alternates: { canonical: pageUrl(locale), languages: localeAlternates("") },
    openGraph: { title, description, url: pageUrl(locale), siteName: SITE_NAME, type: "website", images: [absoluteUrl("/og.png")] },
    twitter: { card: "summary_large_image", title, description, images: [absoluteUrl("/og.png")] },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const messages = await getMessages();
  return (
    <html lang={locale} className="dark" style={{ colorScheme: "dark" }}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font -- App Router root layout: the stylesheet is shared by every page */}
        <link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@400;600;700;800&family=Hanken+Grotesk:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider messages={messages}>{children}</NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
