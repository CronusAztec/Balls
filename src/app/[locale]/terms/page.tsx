import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import LegalPage from "@/components/site/LegalPage";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME, SITE_URL } from "@/lib/site";
import { localeAlternates } from "../layout";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Terms" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription", { siteDomain: SITE_DOMAIN }),
    alternates: { canonical: `${SITE_URL}/${locale}/terms`, languages: localeAlternates("/terms") },
  };
}

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Terms" });
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN };
  return (
    <LegalPage title={t("title")} lastUpdatedLabel={t("lastUpdated")} locale={locale}>
      <h2>{t("acceptance.title")}</h2>
      <p>{t("acceptance.content", v)}</p>
      <h2>{t("description.title")}</h2>
      <p>{t("description.content", v)}</p>
      <h2>{t("ugc.title")}</h2>
      <p>{t("ugc.subtitle")}</p>
      <ul>
        <li>{t("ugc.item1")}</li>
        <li>{t("ugc.item2")}</li>
        <li>{t("ugc.item3")}</li>
      </ul>
      <p>{t("ugc.footer", v)}</p>
      <h2>{t("acceptable.title")}</h2>
      <p>{t("acceptable.subtitle")}</p>
      <ul>
        <li>{t("acceptable.item1")}</li>
        <li>{t("acceptable.item2")}</li>
        <li>{t("acceptable.item3")}</li>
        <li>{t("acceptable.item4")}</li>
      </ul>
      {(["intellectual", "warranties", "liability", "changes"] as const).map((k) => (
        <div key={k} className="space-y-6">
          <h2>{t(`${k}.title`)}</h2>
          <p>{t(`${k}.content`, v)}</p>
        </div>
      ))}
      <h2>{t("contact.title")}</h2>
      <p>
        {t("contact.content")} <Link href="/feedback">{t("contact.feedbackLink")}</Link>.
      </p>
    </LegalPage>
  );
}
