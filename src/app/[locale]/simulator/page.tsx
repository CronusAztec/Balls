import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl"; // --- review fix (performance) --- (the whole catalogue for this page)
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import ModesOverview from "@/components/site/ModesOverview";
import FeedbackCta from "@/components/site/FeedbackCta";
import Simulator from "@/components/simulator/Simulator";
import EditorialSections from "@/components/site/EditorialSections";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SimulatorPage" });
  const title = t("metaTitle", { siteName: SITE_NAME });
  const description = t("metaDescription", { count: MODE_CARD_ORDER.length });
  return {
    title,
    description,
    alternates: { canonical: pageUrl(locale, "/simulator"), languages: localeAlternates("/simulator") },
    openGraph: { title, description, url: pageUrl(locale, "/simulator"), siteName: SITE_NAME, type: "website" },
  };
}

export default async function SimulatorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  // --- review fix (performance) --- the simulator's panel reads nearly every namespace: this page gets the whole catalogue
  // (the provider fills it in from the request config; the layout passes only the shared namespaces)
  return (
    <NextIntlClientProvider>
      <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-cyan-500/30 font-sans">
        <Navbar backHref="/" backLabel={t("Navbar.back")} />
        {/* --- review fix (site-static) --- the page's main heading for search and screen readers, outside the Suspense boundary */}
        <h1 className="sr-only">{t("SimulatorPage.heading")}</h1>
        <div className="sm:hidden mx-4 mb-3 mt-3 px-4 py-3 rounded-lg bg-blue-900/40 border border-blue-800/50 text-blue-300 text-xs leading-relaxed text-center">{t("Hero.mobileNotice")}</div>
        <Suspense fallback={<div className="container mx-auto px-4 py-16 text-center text-zinc-500">…</div>}>
          <Simulator />
        </Suspense>
        <FeedbackCta />
        <ModesOverview interactive />
        <EditorialSections />
        <Footer showShortcuts />
      </div>
    </NextIntlClientProvider>
  );
}
