import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import { ClaimPanel, LicencePanel, PasteKeyForm, PricingPlans, PricingTestMode, RestoreForm } from "@/components/billing/PricingClient";
import { IconLock } from "@/components/billing/LockBadge";
import { IconCheck, IconMinus } from "@/components/ui/icons";
import { pageClientNamespaces, pickMessages } from "@/i18n/clientMessages";
import { localeAlternates } from "@/i18n/alternates";
import { PLANS, formatUsd, yearlySavingPercent } from "@/lib/billing/config";
import { SITE_NAME, absoluteUrl, pageUrl } from "@/lib/site";

/*
 * --- paywall-gate --- The pricing page: what plays for free and what Pro adds (--- free-watermark --- everyone makes videos;
 * Free's carry a watermark, Pro's do not, and Publish is Pro), the two plans with their pay buttons, the purchase a checkout
 * returns with (?claim=…&ref=…), this browser's licence with Manage subscription and its receipt reference, Restore
 * purchase and Paste a licence key. The static parts render here; the live ones are client components
 * (components/billing/PricingClient.tsx) with the Billing namespace (i18n/clientMessages.ts).
 */

const PLAY_ROWS = ["modes", "sound", "finder", "presets", "gallery", "editor"] as const;
const CREATE_ROWS = ["record", "fastExport", "batch", "bot", "publish", "desktop"] as const;
/** --- free-watermark --- the video-making rows Free has too – with the watermark (Publish stays Pro). */
const WATERMARKED_ROWS: readonly string[] = ["record", "fastExport", "batch", "bot", "desktop"];
const NOTES = ["renew", "crypto", "licence", "devices", "watermark" /* --- free-watermark --- */] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Billing" });
  const title = t("metaTitle", { siteName: SITE_NAME });
  const description = t("metaDescription", { siteName: SITE_NAME, monthly: formatUsd(PLANS.monthly.usd, locale), yearly: formatUsd(PLANS.yearly.usd, locale) });
  return {
    title,
    description,
    alternates: { canonical: pageUrl(locale, "/pricing"), languages: localeAlternates("/pricing") },
    openGraph: { title, description, url: pageUrl(locale, "/pricing"), siteName: SITE_NAME, type: "website", images: [absoluteUrl("/og.png")] },
  };
}

/** --- free-watermark --- Included, with a word under the tick ("With watermark" on Free, "No watermark" on Pro). */
function MarkNote({ label, note, tone }: { label: string; note: string; tone: "free" | "pro" }) {
  return (
    <span className={`inline-flex flex-col items-center gap-0.5 ${tone === "pro" ? "text-accent" : "text-ink-2"}`}>
      <IconCheck size={18} />
      <span className="sr-only">{label}: </span>
      <span className="text-xs leading-tight">{note}</span>
    </span>
  );
}

function Mark({ on, label }: { on: boolean; label: string }) {
  return on ? (
    <span className="inline-flex items-center justify-center text-accent">
      <IconCheck size={18} />
      <span className="sr-only">{label}</span>
    </span>
  ) : (
    <span className="inline-flex items-center justify-center text-ink-3">
      <IconMinus size={18} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export default async function PricingPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Billing" });
  const clientMessages = pickMessages(await getMessages(), pageClientNamespaces("/pricing"));
  const offersJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `${SITE_NAME} Pro`,
    description: t("lede"),
    url: pageUrl(locale, "/pricing"),
    offers: (["monthly", "yearly"] as const).map((plan) => ({
      "@type": "Offer",
      name: t(`plan.${plan}`),
      price: PLANS[plan].usd.toFixed(2),
      priceCurrency: "USD",
      url: pageUrl(locale, "/pricing"),
      priceSpecification: { "@type": "UnitPriceSpecification", price: PLANS[plan].usd.toFixed(2), priceCurrency: "USD", billingDuration: plan === "monthly" ? "P1M" : "P1Y" },
    })),
  };
  const row = "border-b border-line";
  return (
    <NextIntlClientProvider messages={clientMessages}>
      <div className="min-h-screen bg-bg text-ink">
        <JsonLd data={offersJsonLd} />
        <Navbar />
        <main id="content" className="site-container py-12 sm:py-16 lg:py-20" data-testid="pricing-page">
          <header className="max-w-[680px]">
            <p className="eyebrow inline-flex items-center gap-2 text-ink-3">
              <IconLock size={16} />
              {t("eyebrow")}
            </p>
            <h1 className="mt-3 text-2xl font-bold text-ink lg:text-3xl">{t("title")}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{t("lede")}</p>
          </header>
          <PricingTestMode />
          <ClaimPanel />

          <section id="plans" className="mt-12 scroll-mt-20" aria-labelledby="pricing-plans">
            <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
              <h2 id="pricing-plans" className="text-xl font-bold text-ink">
                {t("plansTitle")}
              </h2>
              <p className="text-sm text-ink-3">{t("plansNote", { percent: yearlySavingPercent() })}</p>
            </div>
            <PricingPlans />
          </section>

          <section className="mt-16 border-t border-line pt-10" aria-labelledby="pricing-compare">
            <h2 id="pricing-compare" className="text-xl font-bold text-ink">
              {t("compare.title")}
            </h2>
            <p className="mt-2 max-w-[680px] text-md text-ink-2">{t("why")}</p>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] border-collapse text-left text-md" data-testid="pricing-compare">
                <caption className="sr-only">{t("compare.title")}</caption>
                <thead>
                  <tr className={row}>
                    <th scope="col" className="py-3 pr-4 font-medium text-ink-3">
                      <span className="eyebrow">{t("compare.feature")}</span>
                    </th>
                    <th scope="col" className="w-24 py-3 text-center">
                      <span className="eyebrow text-ink-3">{t("compare.free")}</span>
                    </th>
                    <th scope="col" className="w-24 py-3 text-center">
                      <span className="eyebrow text-accent">{t("compare.pro")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr className={row}>
                    <th scope="rowgroup" colSpan={3} className="pt-6 pb-2 text-sm font-medium text-ink">
                      {t("compare.playTitle")}
                    </th>
                  </tr>
                  {PLAY_ROWS.map((k) => (
                    <tr key={k} className={row} data-compare-row={k} data-compare-free="1">
                      <th scope="row" className="py-3 pr-4 font-normal text-ink-2">
                        {t(`compare.play.${k}`)}
                      </th>
                      <td className="py-3 text-center">
                        <Mark on label={t("compare.included")} />
                      </td>
                      <td className="py-3 text-center">
                        <Mark on label={t("compare.included")} />
                      </td>
                    </tr>
                  ))}
                  <tr className={row}>
                    <th scope="rowgroup" colSpan={3} className="pt-6 pb-2 text-sm font-medium text-ink">
                      {t("compare.createTitle")}
                    </th>
                  </tr>
                  {CREATE_ROWS.map((k) => {
                    const watermarked = WATERMARKED_ROWS.includes(k); // --- free-watermark --- Free makes it too, watermarked
                    return (
                      <tr key={k} className={row} data-compare-row={k} data-compare-free={watermarked ? "watermark" : "0"}>
                        <th scope="row" className="py-3 pr-4 font-normal text-ink-2">
                          {t(`compare.create.${k}`)}
                        </th>
                        <td className="py-3 text-center">
                          {watermarked ? <MarkNote label={t("compare.included")} note={t("compare.withWatermark")} tone="free" /> : <Mark on={false} label={t("compare.notIncluded")} />}
                        </td>
                        <td className="py-3 text-center">
                          {watermarked ? <MarkNote label={t("compare.included")} note={t("compare.noWatermark")} tone="pro" /> : <Mark on label={t("compare.included")} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section id="account" className="mt-16 scroll-mt-20 border-t border-line pt-10" aria-labelledby="pricing-account">
            <h2 id="pricing-account" className="mb-5 text-xl font-bold text-ink">
              {t("manage.title")}
            </h2>
            <LicencePanel />
          </section>

          <section id="restore" className="mt-16 scroll-mt-20 border-t border-line pt-10" aria-labelledby="pricing-restore">
            <h2 id="pricing-restore" className="mb-4 text-xl font-bold text-ink">
              {t("restore.title")}
            </h2>
            <RestoreForm />
            <PasteKeyForm />
          </section>

          <section className="mt-16 border-t border-line pt-10" aria-labelledby="pricing-notes">
            <h2 id="pricing-notes" className="text-xl font-bold text-ink">
              {t("notes.title")}
            </h2>
            <ul className="mt-5 grid grid-cols-1 gap-x-12 md:grid-cols-2">
              {NOTES.map((k) => (
                <li key={k} className="border-t border-line py-4 text-md text-ink-2">
                  {t(`notes.${k}`)}
                </li>
              ))}
            </ul>
          </section>
        </main>
        <Footer />
      </div>
    </NextIntlClientProvider>
  );
}
