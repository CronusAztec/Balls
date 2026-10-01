import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import SectionHeading from "@/components/site/SectionHeading";
import { Link } from "@/i18n/navigation";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "TikTokBallVideos" });
  const v = { siteName: SITE_NAME, count: MODE_CARD_ORDER.length };
  return {
    title: t("metaTitle", v),
    description: t("metaDescription", v),
    alternates: { canonical: pageUrl(locale, "/tiktok-ball-videos"), languages: localeAlternates("/tiktok-ball-videos") },
  };
}

export default async function TikTokPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "TikTokBallVideos" });
  const v = { siteName: SITE_NAME };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <Navbar />
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <SectionHeading as="h1" badge={t("badge")} title={t("title")} />
        <div className="space-y-5 text-[15px] sm:text-base leading-relaxed text-slate-300">
          <p>{t("p1", v)}</p>
          <p>{t("p2", v)}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_1")}</h2>
          <p>{t("p3", v)}</p>
          <p>{t("p4", v)}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_2")}</h2>
          <p>{t("p5", v)}</p>
          <p>{t("p6", v)}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_3")}</h2>
          <p>{t("p7", v)}</p>
          <p>{t("p8", v)}</p>
          <div className="pt-6 text-center">
            <Link href="/simulator?mode=classic" className="btn-bounce inline-flex px-7 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-blue-600 to-cyan-600">
              {t("cta")}
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
