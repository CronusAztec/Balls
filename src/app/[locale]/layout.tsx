import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SITE_NAME, SITE_URL, absoluteUrl, pageUrl } from "@/lib/site";
import Analytics from "@/components/site/Analytics";
import { localeAlternates } from "@/i18n/alternates";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code
// --- pwa ---
import PwaRegister from "@/components/site/PwaRegister";
import { PWA_ICON_FILES, PWA_THEME_COLOR } from "@/lib/pwa";
import { assetPath } from "@/lib/site";
// --- end pwa ---
import { SHARED_CLIENT_NAMESPACES, pickMessages } from "@/i18n/clientMessages"; // --- review fix (performance) ---
import "../globals.css";
import { fontVariables } from "../fonts"; // --- site-redesign --- self-hosted type (no font CDN)

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

// --- pwa --- browser UI colour of the page and of the installed app
export const viewport: Viewport = { themeColor: PWA_THEME_COLOR };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Layout" });
  const title = t("metaTitle", { siteName: SITE_NAME });
  const description = t("metaDescription", { count: MODE_CARD_ORDER.length });
  return {
    metadataBase: new URL(SITE_URL),
    title,
    description,
    // Absolute URLs so they stay correct when the site lives in a sub-folder (GitHub Pages).
    icons: { icon: absoluteUrl("/icon.svg"), apple: absoluteUrl(PWA_ICON_FILES.appleTouch) },
    // --- pwa --- installable app: the web app manifest (src/app/manifest.ts) and the iOS home-screen title
    manifest: assetPath("/manifest.webmanifest"),
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
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
    <html lang={locale} className={`dark ${fontVariables}`} style={{ colorScheme: "dark" }}>
      <body className="antialiased">
        {/* --- review fix (performance) --- only what the shared client components read (pages add their own: i18n/clientMessages.ts) */}
        <NextIntlClientProvider messages={pickMessages(messages, SHARED_CLIENT_NAMESPACES)}>{children}</NextIntlClientProvider>
        <Analytics />
        <PwaRegister />
      </body>
    </html>
  );
}
