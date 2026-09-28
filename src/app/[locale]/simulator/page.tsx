import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import ModesOverview from "@/components/site/ModesOverview";
import FeedbackCta from "@/components/site/FeedbackCta";
import Simulator from "@/components/simulator/Simulator";
import EditorialSections from "@/components/site/EditorialSections";
import { SITE_NAME, SITE_URL } from "@/lib/site";
import { localeAlternates } from "../layout";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SimulatorPage" });
  const title = t("metaTitle", { siteName: SITE_NAME });
  const description = t("metaDescription");
  return {
    title,
    description,
    alternates: { canonical: `${SITE_URL}/${locale}/simulator`, languages: localeAlternates("/simulator") },
    openGraph: { title, description, url: `${SITE_URL}/${locale}/simulator`, siteName: SITE_NAME, type: "website" },
  };
}

export default async function SimulatorPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale });
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-cyan-500/30 font-sans">
      <Navbar backHref="/" backLabel={t("Navbar.back")} />
      <div className="sm:hidden mx-4 mb-3 mt-3 px-4 py-3 rounded-lg bg-blue-900/40 border border-blue-800/50 text-blue-300 text-xs leading-relaxed text-center">{t("Hero.mobileNotice")}</div>
      <Suspense fallback={<div className="container mx-auto px-4 py-16 text-center text-zinc-500">…</div>}>
        <Simulator />
      </Suspense>
      <FeedbackCta />
      <ModesOverview interactive />
      <EditorialSections />
      <Footer showShortcuts />
    </div>
  );
}
