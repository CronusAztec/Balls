import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout, { legalDate } from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription", { siteDomain: SITE_DOMAIN }),
    alternates: { canonical: pageUrl(locale, "/privacy"), languages: localeAlternates("/privacy") },
  };
}

const PLAIN = ["howWeUse", "cookies", "thirdParty", "retention", "children", "changes"] as const;
// --- site-redesign --- the sections in page order (their ids are the table of contents' anchors)
const SECTIONS = ["introduction", "information", ...PLAIN, "adsenseNotice", "consent", "contact", "publishing"] as const;

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Privacy" });
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
      <section id="introduction">
        <h2>{t("introduction.title")}</h2>
        <p>{t("introduction.content", v)}</p>
      </section>
      <section id="information">
        <h2>{t("information.title")}</h2>
        <p>{t("information.subtitle")}</p>
        <ul>
          {(["analytics", "localStorage", "images"] as const).map((k) => (
            <li key={k}>
              <strong>{t(`information.${k}.label`)}</strong> {t(`information.${k}.content`)}
            </li>
          ))}
        </ul>
      </section>
      {PLAIN.map((k) => (
        <section key={k} id={k}>
          <h2>{t(`${k}.title`)}</h2>
          <p>{t(`${k}.content`)}</p>
        </section>
      ))}
      <section id="adsenseNotice">
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
      </section>
      <section id="consent">
        <h2>{t("consent.title")}</h2>
        <p>{t("consent.content")}</p>
      </section>
      <section id="contact">
        <h2>{t("contact.title")}</h2>
        <p>
          {t("contact.content")} <Link href="/feedback">{t("contact.feedbackLink")}</Link>.
        </p>
      </section>
      {/* --- social-publish --- what the Publish block sends where (and the YouTube API Services disclosures) */}
      <section id="publishing">
        <h2>{t("publishing.title")}</h2>
        <p>{t("publishing.content")}</p>
        <p>
          {t("publishing.youtube1")}{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener noreferrer">
            {t("publishing.ytTermsLink")}
          </a>
          {t("publishing.youtube2")}{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">
            {t("publishing.googlePrivacyLink")}
          </a>
          {t("publishing.youtube3")}{" "}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">
            {t("publishing.revokeLink")}
          </a>
          {t("publishing.youtube4")}
        </p>
      </section>
    </ProseLayout>
  );
}
