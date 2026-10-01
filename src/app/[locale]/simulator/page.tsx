import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
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
  // --- site-redesign --- the studio fills the first screen under the header; the guide (physics, modes, tips, help) reads below
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Navbar variant="studio" />
      <div id="content">
        <Suspense fallback={<div className="flex h-[calc(100svh-56px)] items-center justify-center text-sm text-ink-3">…</div>}>
          <Simulator />
        </Suspense>
      </div>
      <EditorialSections />
      <Footer />
    </div>
  );
}
