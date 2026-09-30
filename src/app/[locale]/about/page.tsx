import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import SectionHeading from "@/components/site/SectionHeading";
import { Link } from "@/i18n/navigation";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  const v = { siteName: SITE_NAME };
  return {
    title: t("metaTitle", v),
    description: t("metaDescription", v),
    alternates: { canonical: pageUrl(locale, "/about"), languages: localeAlternates("/about") },
    openGraph: { title: t("metaOgTitle", v), description: t("metaOgDescription", v) },
  };
}

export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "About" });
  const v = { siteName: SITE_NAME };
  const link = (href: string) =>
    function RichLink(chunks: React.ReactNode) {
      return (
        <Link href={href} className="text-cyan-400 font-semibold hover:underline">
          {chunks}
        </Link>
      );
    };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <Navbar backHref="/" />
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <SectionHeading as="h1" badge={t("badge")} title={t("title", v)} />
        <div className="space-y-5 text-[15px] sm:text-base leading-relaxed text-slate-300">
          <p>{t("p1", v)}</p>
          <p>{t("p2", v)}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_1")}</h2>
          <p>{t("p3", v)}</p>
          <p>{t("p4", v)}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_2")}</h2>
          <p>{t.rich("p5", { ...v, privacy: link("/privacy") })}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_3")}</h2>
          <p>{t.rich("p6", { ...v, feedback: link("/feedback") })}</p>
          <h2 className="text-2xl font-bold text-slate-50 pt-4">{t("h2_4")}</h2>
          <p>{t.rich("p7", v)}</p>
          <div className="pt-6 text-center">
            <Link href="/simulator" className="btn-bounce inline-flex px-7 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-blue-600 to-cyan-600">
              {t("cta")}
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
