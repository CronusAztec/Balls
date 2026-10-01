import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout, { legalDate } from "@/components/site/ProseLayout";
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

const PLAIN = ["general", "noGuarantee", "noAffiliation", "yourContent", "asIs", "externalLinks"] as const;
// --- site-redesign --- the sections in page order (their ids are the table of contents' anchors)
const SECTIONS = [...PLAIN, "changes", "contact"] as const;

export default async function DisclaimerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Disclaimer" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN };
  return (
    <ProseLayout
      eyebrow={site("footer.legal")}
      title={t("title")}
      meta={`${t("lastUpdated")}: ${legalDate(locale)}`}
      toc={SECTIONS.map((id) => ({ id, label: t(`${id}.title`) }))}
      tocLabel={site("prose.onThisPage")}
    >
      {PLAIN.map((k) => (
        <section key={k} id={k}>
          <h2>{t(`${k}.title`)}</h2>
          <p>{t(`${k}.content`, v)}</p>
        </section>
      ))}
      <section id="changes">
        <h2>{t("changes.title")}</h2>
        <p>
          {t("changes.content")} <Link href="/privacy">{t("privacyLink")}</Link> {t("and")} <Link href="/terms">{t("termsLink")}</Link>.
        </p>
      </section>
      <section id="contact">
        <h2>{t("contact.title")}</h2>
        <p>
          {t("contact.content")} <Link href="/feedback">{t("feedbackLink")}</Link>.
        </p>
      </section>
    </ProseLayout>
  );
}
