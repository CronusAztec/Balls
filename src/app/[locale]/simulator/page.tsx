import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import ModesOverview from "@/components/site/ModesOverview";
import Simulator from "@/components/simulator/Simulator";
import EditorialSections from "@/components/site/EditorialSections";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "SimulatorPage" });
  const title = t("metaTitle", { siteName: SITE_NAME });
  const description = t("metaDescription");
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
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-cyan-500/30 font-sans">
      <Navbar variant="studio" />
      <Suspense fallback={<div className="container mx-auto px-4 py-16 text-center text-zinc-500">…</div>}>
        <Simulator />
      </Suspense>
      <ModesOverview interactive />
      <EditorialSections />
      <Footer />
    </div>
  );
}
