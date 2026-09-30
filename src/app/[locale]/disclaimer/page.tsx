import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import LegalPage from "@/components/site/LegalPage";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Disclaimer" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription", { siteName: SITE_NAME }),
    alternates: { canonical: pageUrl(locale, "/disclaimer"), languages: localeAlternates("/disclaimer") },
  };
}

export default async function DisclaimerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Disclaimer" });
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN };
  return (
    <LegalPage title={t("title")} lastUpdatedLabel={t("lastUpdated")} locale={locale}>
      {(["general", "noGuarantee", "noAffiliation", "yourContent", "asIs", "externalLinks"] as const).map((k) => (
        <div key={k} className="space-y-6">
          <h2>{t(`${k}.title`)}</h2>
          <p>{t(`${k}.content`, v)}</p>
        </div>
      ))}
      <h2>{t("changes.title")}</h2>
      <p>
        {t("changes.content")} <Link href="/privacy">{t("privacyLink")}</Link> {t("and")} <Link href="/terms">{t("termsLink")}</Link>.
      </p>
      <h2>{t("contact.title")}</h2>
      <p>
        {t("contact.content")} <Link href="/feedback">{t("feedbackLink")}</Link>.
      </p>
    </LegalPage>
  );
}
