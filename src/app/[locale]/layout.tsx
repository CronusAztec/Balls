import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/site";
import { pageMetadata } from "@/lib/seo"; // --- seo ---
import { buildId } from "@/lib/buildInfo"; // --- build-identity ---
import Analytics from "@/components/site/Analytics";
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
  // --- seo --- the home page's head (title, canonical, hreflang, Open Graph, Twitter, the language's card): lib/seo.ts builds
  // every page's head the same way. The default card, for a page or a language without a card of its own, is the simulator screenshot.
  const home = await pageMetadata({ locale, path: "", title, description, image: "home", fallbackImageUrl: absoluteUrl("/og.png") });
  return {
    metadataBase: new URL(SITE_URL),
    ...home,
    // Absolute URLs so they stay correct when the site lives in a sub-folder (GitHub Pages).
    // --- seo --- the .ico for old browsers and crawlers (32 and 48 px, public/favicon.ico), the SVG for current ones, 48 and 192 px PNGs (Google lists a favicon in multiples of 48 px)
    icons: {
      icon: [
        { url: absoluteUrl("/favicon.ico"), type: "image/x-icon", sizes: "32x32 48x48" },
        { url: absoluteUrl("/icon.svg"), type: "image/svg+xml", sizes: "any" },
        { url: absoluteUrl("/icons/icon-48.png"), type: "image/png", sizes: "48x48" },
        { url: absoluteUrl(PWA_ICON_FILES.icon192), type: "image/png", sizes: "192x192" },
      ],
      apple: absoluteUrl(PWA_ICON_FILES.appleTouch),
    },
    // --- pwa --- installable app: the web app manifest (src/app/manifest.ts) and the iOS home-screen title
    manifest: assetPath("/manifest.webmanifest"),
    appleWebApp: { capable: true, title: SITE_NAME, statusBarStyle: "black-translucent" },
    // --- build-identity --- <meta name="jbl-build" content="1.10.0+8fa8dbb"> on every page: which build served it (view-source, ad review tools)
    other: { "jbl-build": buildId() },
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
