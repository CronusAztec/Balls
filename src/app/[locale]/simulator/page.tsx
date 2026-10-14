import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NextIntlClientProvider } from "next-intl"; // --- review fix (performance) --- (the whole catalogue for this page)
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import Simulator from "@/components/simulator/Simulator";
import EditorialSections from "@/components/site/EditorialSections";
import { SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SimulatorPage" });
  const count = MODE_CARD_ORDER.length;
  return pageMetadata({ locale, path: "/simulator", title: t("metaTitle", { siteName: SITE_NAME, count }), description: t("metaDescription", { count }) }); // --- seo ---
}

export default async function SimulatorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("SimulatorPage.heading"), path: "/simulator" }]); // --- seo ---
  // --- site-redesign --- the studio fills the first screen under the header; the guide (physics, modes, tips, help) reads below.
  // --- review fix (performance) --- the simulator's panel reads nearly every namespace: this page gets the whole catalogue
  // (the provider fills it in from the request config; the layout passes only the shared namespaces)
  return (
    <NextIntlClientProvider>
      <div className="min-h-screen bg-bg text-ink">
        <JsonLd data={breadcrumbs} />
        <Navbar variant="studio" />
        {/* --- review fix (site-static) --- the page's main heading for search and screen readers, outside the Suspense boundary */}
        <h1 className="sr-only">{t("SimulatorPage.heading")}</h1>
        <div id="content">
          <Suspense fallback={<div className="flex h-[calc(100svh-56px)] items-center justify-center text-sm text-ink-3">…</div>}>
            <Simulator />
          </Suspense>
        </div>
        <EditorialSections />
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
