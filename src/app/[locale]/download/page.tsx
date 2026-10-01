import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import { SITE_NAME, absoluteUrl, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { LATEST_RELEASE_URL, PORTABLE_ASSET, RELEASES_URL, SETUP_ASSET, latestAssetUrl } from "@/lib/desktop/release";
import { buttonClass } from "@/components/ui/Button";
import { IconBolt, IconDesktop, IconDownload, IconExternal, IconFolder, IconSparkle, IconVideo, IconWarning, type IconProps } from "@/components/ui/icons";

/*
 * --- desktop-exe --- The download page of the Windows app: the latest installer and portable EXE from GitHub Releases, the
 * requirements, the SmartScreen note (the EXE is unsigned until a code-signing certificate is set up) and what the app adds.
 * --- site-redesign --- the two downloads side by side (the installer first, in the accent), then the requirements and the
 * SmartScreen note, what the app adds as a ruled list with icons, and the privacy note.
 */

const REQUIREMENTS = ["os", "gpu", "disk", "ram"] as const;
const FEATURES: readonly (readonly ["gpu" | "queue" | "ai" | "library", (p: IconProps) => React.ReactNode])[] = [
  ["gpu", IconBolt],
  ["queue", IconVideo],
  ["ai", IconSparkle],
  ["library", IconFolder],
];

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
    <div className="min-h-screen bg-bg text-ink">
      <JsonLd data={appJsonLd} />
      <Navbar />
      <main id="content" className="site-container py-12 sm:py-16 lg:py-20" data-testid="download-page">
        <header className="max-w-[680px]">
          <p className="eyebrow inline-flex items-center gap-2 text-ink-3">
            <IconDesktop size={16} />
            {t("badge")}
          </p>
          <h1 className="mt-3 text-2xl font-bold text-ink lg:text-3xl">{t("title", v)}</h1>
          <p className="mt-4 text-lg leading-relaxed text-ink-2">{t("intro")}</p>
        </header>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          <section className="flex flex-col gap-3 rounded-xl border border-accent-dim/60 bg-surface-1 p-6" aria-labelledby="dl-setup">
            <h2 id="dl-setup" className="font-sans text-lg font-medium tracking-normal text-ink">
              {t("setupTitle")}
            </h2>
            <p className="text-md text-ink-2">{t("setupBody")}</p>
            <a href={latestAssetUrl(SETUP_ASSET)} className={buttonClass({ variant: "primary", size: "md", className: "mt-auto self-start" })} data-testid="download-setup" rel="nofollow">
              <IconDownload size={16} />
              {t("setupButton")}
            </a>
          </section>
          <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-6" aria-labelledby="dl-portable">
            <h2 id="dl-portable" className="font-sans text-lg font-medium tracking-normal text-ink">
              {t("portableTitle")}
            </h2>
            <p className="text-md text-ink-2">{t("portableBody")}</p>
            <a href={latestAssetUrl(PORTABLE_ASSET)} className={buttonClass({ variant: "secondary", size: "md", className: "mt-auto self-start" })} data-testid="download-portable" rel="nofollow">
              <IconDownload size={16} />
              {t("portableButton")}
            </a>
          </section>
        </div>
        <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <a href={LATEST_RELEASE_URL} className="inline-flex items-center gap-1.5 font-medium text-accent hover:text-accent-strong" data-testid="download-releases">
            {t("allReleases")}
            <IconExternal size={14} />
          </a>
          <a href={RELEASES_URL} className="text-ink-3 hover:text-ink-2">
            GitHub Releases
          </a>
        </p>

        <div className="mt-16 grid grid-cols-1 gap-x-12 gap-y-10 border-t border-line pt-10 lg:grid-cols-2">
          <section aria-labelledby="dl-requirements">
            <h2 id="dl-requirements" className="text-xl font-bold text-ink">
              {t("requirementsTitle")}
            </h2>
            <ul className="mt-5 border-t border-line" data-testid="download-requirements">
              {REQUIREMENTS.map((k) => (
                <li key={k} className="border-b border-line py-3 text-md text-ink-2">
                  {t(`requirements.${k}`)}
                </li>
              ))}
            </ul>
          </section>
          <section className="self-start rounded-xl border border-warn/30 bg-warn/5 p-6" data-testid="download-smartscreen" aria-labelledby="dl-smartscreen">
            <h2 id="dl-smartscreen" className="flex items-center gap-2 font-sans text-lg font-medium tracking-normal text-warn">
              <IconWarning size={18} />
              {t("smartScreenTitle")}
            </h2>
            <p className="mt-3 text-md text-ink-2">{t("smartScreenBody")}</p>
          </section>
        </div>

        <section className="mt-16 border-t border-line pt-10" aria-labelledby="dl-features">
          <h2 id="dl-features" className="text-xl font-bold text-ink">
            {t("featuresTitle")}
          </h2>
          <ul className="mt-6 grid grid-cols-1 gap-x-12 md:grid-cols-2">
            {FEATURES.map(([k, Icon]) => (
              <li key={k} className="flex gap-4 border-t border-line py-5">
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-1 text-accent">
                  <Icon size={18} />
                </span>
                <p className="text-md text-ink-2">{t(`features.${k}`)}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16 max-w-[680px] border-t border-line pt-10" aria-labelledby="dl-privacy">
          <h2 id="dl-privacy" className="text-xl font-bold text-ink">
            {t("privacyTitle")}
          </h2>
          <p className="mt-3 text-md text-ink-2">{t("privacyBody")}</p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
