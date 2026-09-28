import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import LegalPage from "@/components/site/LegalPage";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "../layout";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription", { siteDomain: SITE_DOMAIN }),
    alternates: { canonical: pageUrl(locale, "/privacy"), languages: localeAlternates("/privacy") },
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Privacy" });
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN };
  return (
    <LegalPage title={t("title")} lastUpdatedLabel={t("lastUpdated")} locale={locale}>
      <h2>{t("introduction.title")}</h2>
      <p>{t("introduction.content", v)}</p>
      <h2>{t("information.title")}</h2>
      <p>{t("information.subtitle")}</p>
      <ul>
        {(["analytics", "localStorage", "images"] as const).map((k) => (
          <li key={k}>
            <strong>{t(`information.${k}.label`)}</strong> {t(`information.${k}.content`)}
          </li>
        ))}
      </ul>
      {(["howWeUse", "cookies", "thirdParty", "retention", "children", "changes"] as const).map((k) => (
        <div key={k} className="space-y-6">
          <h2>{t(`${k}.title`)}</h2>
          <p>{t(`${k}.content`)}</p>
        </div>
      ))}
      <h2>{t("adsenseNotice.title")}</h2>
      <p>{t("adsenseNotice.line1")}</p>
      <p>
        {t("adsenseNotice.line2")}{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
          {t("adsenseNotice.privacyLink")}
        </a>{" "}
        {t("adsenseNotice.line3")}{" "}
        <a href="https://policies.google.com/terms" target="_blank" rel="noopener noreferrer">
          {t("adsenseNotice.termsLink")}
        </a>
        {t("adsenseNotice.line4")}{" "}
        <a href="https://adssettings.google.com" target="_blank" rel="noopener noreferrer">
          {t("adsenseNotice.optOutLink")}
        </a>
        {t("adsenseNotice.line5")}
      </p>
      <h2>{t("consent.title")}</h2>
      <p>{t("consent.content")}</p>
      <h2>{t("contact.title")}</h2>
      <p>
        {t("contact.content")} <Link href="/feedback">{t("contact.feedbackLink")}</Link>.
      </p>
    </LegalPage>
  );
}
