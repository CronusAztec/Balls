import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import SectionHeading from "@/components/site/SectionHeading";
import JsonLd from "@/components/site/JsonLd";
import { SITE_NAME, absoluteUrl, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { LATEST_RELEASE_URL, PORTABLE_ASSET, RELEASES_URL, SETUP_ASSET, latestAssetUrl } from "@/lib/desktop/release";

/* --- desktop-exe --- The download page of the Windows app: the latest installer and portable EXE from GitHub Releases, the requirements, the SmartScreen note (the EXE is unsigned until a code-signing certificate is set up) and what the app adds. */

const REQUIREMENTS = ["os", "gpu", "disk", "ram"] as const;
const FEATURES = [
  ["gpu", "🖥️"],
  ["queue", "🎞️"],
  ["ai", "🤖"],
  ["library", "📚"],
] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Desktop" });
  const v = { siteName: SITE_NAME };
  const title = t("metaTitle", v);
  const description = t("metaDescription", v);
  return {
    title,
    description,
    alternates: { canonical: pageUrl(locale, "/download"), languages: localeAlternates("/download") },
    openGraph: { title, description, url: pageUrl(locale, "/download"), siteName: SITE_NAME, type: "website", images: [absoluteUrl("/og.png")] },
  };
}

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Desktop" });
  const v = { siteName: SITE_NAME };
  const appJsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `${SITE_NAME} for Windows`,
    operatingSystem: "Windows 10, Windows 11",
    applicationCategory: "MultimediaApplication",
    downloadUrl: latestAssetUrl(SETUP_ASSET),
    url: pageUrl(locale, "/download"),
    description: t("metaDescription", v),
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 font-sans">
      <JsonLd data={appJsonLd} />
      <Navbar />
      <main className="container mx-auto px-4 py-12 max-w-5xl" data-testid="download-page">
        <SectionHeading as="h1" badge={t("badge")} title={t("title", v)} description={t("intro")} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-slate-900/50 border border-cyan-500/30 rounded-3xl p-6 flex flex-col gap-3">
            <h2 className="text-xl font-black text-white">{t("setupTitle")}</h2>
            <p className="text-sm text-slate-400 leading-relaxed">{t("setupBody")}</p>
            <a href={latestAssetUrl(SETUP_ASSET)} className="mt-auto inline-flex justify-center px-6 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500 shadow-lg shadow-cyan-600/20 hover:scale-[1.02] transition-all" data-testid="download-setup" rel="nofollow">
              ⬇ {t("setupButton")}
            </a>
          </section>
          <section className="bg-slate-900/50 border border-slate-800 rounded-3xl p-6 flex flex-col gap-3">
            <h2 className="text-xl font-black text-white">{t("portableTitle")}</h2>
            <p className="text-sm text-slate-400 leading-relaxed">{t("portableBody")}</p>
            <a href={latestAssetUrl(PORTABLE_ASSET)} className="mt-auto inline-flex justify-center px-6 py-3 rounded-xl font-bold text-slate-200 border border-zinc-700 hover:border-cyan-500 hover:text-cyan-400 transition-all" data-testid="download-portable" rel="nofollow">
              ⬇ {t("portableButton")}
            </a>
          </section>
        </div>
        <p className="mt-4 text-center text-sm">
          <a href={LATEST_RELEASE_URL} className="text-cyan-400 hover:underline" data-testid="download-releases">
            {t("allReleases")}
          </a>
          <span className="text-slate-600"> · </span>
          <a href={RELEASES_URL} className="text-slate-400 hover:underline">
            GitHub Releases
          </a>
        </p>

        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
          <section className="bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
            <h2 className="text-lg font-bold text-white mb-3">{t("requirementsTitle")}</h2>
            <ul className="space-y-2 text-sm text-slate-300 list-disc pl-5" data-testid="download-requirements">
              {REQUIREMENTS.map((k) => (
                <li key={k}>{t(`requirements.${k}`)}</li>
              ))}
            </ul>
          </section>
          <section className="bg-amber-950/20 border border-amber-800/40 rounded-3xl p-6" data-testid="download-smartscreen">
            <h2 className="text-lg font-bold text-amber-200 mb-3">{t("smartScreenTitle")}</h2>
            <p className="text-sm text-slate-300 leading-relaxed">{t("smartScreenBody")}</p>
          </section>
        </div>

        <section className="mt-12">
          <h2 className="text-2xl font-black text-white mb-5">{t("featuresTitle")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {FEATURES.map(([k, icon]) => (
              <div key={k} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5 text-sm text-slate-300 leading-relaxed">
                <span className="text-2xl mr-2">{icon}</span>
                {t(`features.${k}`)}
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 bg-slate-900/40 border border-slate-800 rounded-3xl p-6">
          <h2 className="text-lg font-bold text-white mb-2">{t("privacyTitle")}</h2>
          <p className="text-sm text-slate-300 leading-relaxed">{t("privacyBody")}</p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
