import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout, { legalDate } from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { SUPPORT_EMAIL } from "@/lib/operator"; // --- legal-copy ---

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Disclaimer" });
  return pageMetadata({ locale, path: "/disclaimer", title: t("metaTitle", { siteName: SITE_NAME }), description: t("metaDescription", { siteName: SITE_NAME }) }); // --- seo ---
}

const PLAIN = ["general", "noGuarantee", "noAffiliation", "fanMade" /* --- legal-copy --- the Fight League notice */, "yourContent", "asIs", "externalLinks"] as const;
// --- site-redesign --- the sections in page order (their ids are the table of contents' anchors)
const SECTIONS = [...PLAIN, "changes", "contact"] as const;

export default async function DisclaimerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Disclaimer" });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("title"), path: "/disclaimer" }]); // --- seo --- the trail Home > this page (last child: the prose rules space siblings)
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
          {/* --- legal-copy --- Fight League is a fan-made simulation: how a rights holder asks for a name to be removed (the support
              address when the build has one, else the feedback page) */}
          {k === "fanMade" && (
            <p>
              {SUPPORT_EMAIL
                ? t.rich("fanMade.rightsEmail", { email: SUPPORT_EMAIL, mail: (chunks) => <a href={`mailto:${SUPPORT_EMAIL}`}>{chunks}</a> })
                : t.rich("fanMade.rightsForm", { link: (chunks) => <Link href="/feedback">{chunks}</Link> })}
            </p>
          )}
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
      <JsonLd data={breadcrumbs} />
    </ProseLayout>
  );
}
