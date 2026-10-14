import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import { SITE_NAME } from "@/lib/site";
import { breadcrumbJsonLd, pageMetadata, softwareApplicationJsonLd } from "@/lib/seo"; // --- seo ---
import { DESKTOP_VERSION, PORTABLE_ASSET, SETUP_ASSET, latestAssetUrl } from "@/lib/desktop/release";
import { buttonClass } from "@/components/ui/Button";
import { Link } from "@/i18n/navigation"; // --- legal-copy ---
import { PLANS, formatUsd } from "@/lib/billing/config"; // --- legal-copy --- the price in the free note comes from the plans
import { IconBolt, IconDesktop, IconDownload, IconFolder, IconSparkle, IconVideo, IconWarning, type IconProps } from "@/components/ui/icons";

/*
 * --- desktop-exe --- The download page of the Windows app: the latest installer and portable EXE from the downloads repository, the
 * requirements, the SmartScreen note (the EXE is unsigned until a code-signing certificate is set up) and what the app adds.
 * --- site-redesign --- the two downloads side by side (the installer first, in the accent), then the requirements and the
 * SmartScreen note, what the app adds as a ruled list with icons, and the privacy note.
 * --- desktop-ai-fix --- the current version under the downloads and that the AI model is a one-time download.
 * --- legal-copy --- under the buttons: that the download is free and what the free version lacks (a watermark; Pro costs the plans'
 * monthly price), and inline Terms and Privacy links; the SmartScreen / Chrome note is honest (unsigned, what the warnings say, how
 * to check the SHA-256 or scan the file); the third-party software and sound notices close the page.
 * --- desktop-autorelease --- the version line is the build-time version (DESKTOP_VERSION): a release bumps it in the same push
 * that deploys the site. GitHub is not involved: the downloads come from jumpingballslive.com's own host (src/lib/desktop/release.ts).
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
  return pageMetadata({ locale, path: "/download", title: t("metaTitle", v), description: t("metaDescription", v) }); // --- seo ---
}

export default async function DownloadPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Desktop" });
  const fix = await getTranslations({ locale, namespace: "DesktopAiFix" }); // --- desktop-ai-fix ---
  const v = { siteName: SITE_NAME };
  // --- seo --- (builders in lib/seo.ts: the version, the release notes link and the date of the newest release come with it) and the trail Home > Download
  const appJsonLd = softwareApplicationJsonLd({ locale, description: t("metaDescription", v), downloadUrl: latestAssetUrl(SETUP_ASSET), version: DESKTOP_VERSION }); // --- desktop-ai-fix ---
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("badge"), path: "/download" }]);
  return (
    <div className="min-h-screen bg-bg text-ink">
      <JsonLd data={appJsonLd} />
      <JsonLd data={breadcrumbs} />
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
            <a href={latestAssetUrl(SETUP_ASSET)} className={buttonClass({ variant: "primary", size: "md", className: "mt-auto self-start" })} data-testid="download-setup" data-track="download_click" data-track-kind="setup" rel="nofollow">
              <IconDownload size={16} />
              {t("setupButton")}
            </a>
          </section>
          <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-6" aria-labelledby="dl-portable">
            <h2 id="dl-portable" className="font-sans text-lg font-medium tracking-normal text-ink">
              {t("portableTitle")}
            </h2>
            <p className="text-md text-ink-2">{t("portableBody")}</p>
            <a href={latestAssetUrl(PORTABLE_ASSET)} className={buttonClass({ variant: "secondary", size: "md", className: "mt-auto self-start" })} data-testid="download-portable" data-track="download_click" data-track-kind="portable" rel="nofollow">
              <IconDownload size={16} />
              {t("portableButton")}
            </a>
          </section>
        </div>
        {/* --- legal-copy --- what the download costs and what the free version lacks, and the Terms and Privacy links right under the buttons */}
        <div className="mt-4 max-w-[680px] space-y-1.5 text-md text-ink-2" data-testid="download-terms">
          <p data-testid="download-free-note">{t("setupNote", { price: formatUsd(PLANS.monthly.usd, locale) })}</p>
          <p data-testid="download-legal">
            {t.rich("setupLegal", {
              terms: (chunks) => <Link href="/terms" className="font-medium text-accent hover:text-accent-strong">{chunks}</Link>,
              privacy: (chunks) => <Link href="/privacy" className="font-medium text-accent hover:text-accent-strong">{chunks}</Link>,
            })}
          </p>
        </div>
        <p className="mt-4 text-sm">
          <a href={latestAssetUrl("SHA256SUMS.txt")} className="text-ink-3 hover:text-ink-2" data-testid="download-checksums" data-track="download_click" data-track-kind="checksums" rel="nofollow">
            {t("checksums")}
          </a>
        </p>
        {/* --- desktop-ai-fix --- the version, the one-time model download, and the manual step for 1.0.2 installs */}
        <div className="mt-4 max-w-[680px] space-y-1.5 text-sm text-ink-2" data-testid="download-notes">
          <p className="font-medium text-ink" data-testid="download-version">
            {fix("downloadVersion", { version: DESKTOP_VERSION })}
          </p>
          <p>{fix("downloadModelNote")}</p>
        </div>

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
            {/* --- legal-copy --- the file can be checked before it is run: its SHA-256 against the checksums, or a VirusTotal scan */}
            <p className="mt-3 text-md text-ink-2">
              {t.rich("smartScreenVerify", {
                virustotal: (chunks) => (
                  <a href="https://www.virustotal.com/" target="_blank" rel="noopener noreferrer" className="font-medium text-accent hover:text-accent-strong">
                    {chunks}
                  </a>
                ),
              })}
            </p>
            <p className="mt-3 text-md text-ink-2">{t("smartScreenSteps")}</p>
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

        {/* --- legal-copy --- ffmpeg (GPL v3), Electron / Chromium / llama.cpp and the model licences, and where the built-in sounds come from */}
        <section className="mt-16 max-w-[680px] border-t border-line pt-10" aria-labelledby="dl-notices" data-testid="download-notices">
          <h2 id="dl-notices" className="text-xl font-bold text-ink">
            {t("privacyNoticesTitle")}
          </h2>
          <p className="mt-3 text-md text-ink-2">{t("privacyNoticesFfmpeg")}</p>
          <p className="mt-3 text-md text-ink-2">{t("privacyNoticesOther")}</p>
          <p className="mt-3 text-md text-ink-2">{t("privacyAudio")}</p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
