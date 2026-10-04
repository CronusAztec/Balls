import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout, { legalDate } from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Terms" });
  return {
    title: t("metaTitle", { siteName: SITE_NAME }),
    description: t("metaDescription", { siteDomain: SITE_DOMAIN }),
    alternates: { canonical: pageUrl(locale, "/terms"), languages: localeAlternates("/terms") },
  };
}

const PLAIN = ["intellectual", "warranties", "liability", "changes"] as const;
// --- site-redesign --- the sections in page order (their ids are the table of contents' anchors)
const SECTIONS = ["acceptance", "description", "ugc", "acceptable", ...PLAIN, "contact"] as const;

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Terms" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const billing = await getTranslations({ locale, namespace: "Billing" }); // --- paywall-gate --- the Pro subscriptions section
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN };
  return (
    <ProseLayout
      eyebrow={site("footer.legal")}
      title={t("title")}
      meta={`${t("lastUpdated")}: ${legalDate(locale)}`}
      toc={SECTIONS.flatMap((id) => [{ id, label: t(`${id}.title`) }, ...(id === "description" ? [{ id: "pro", label: billing("terms.title") }] : [])]) /* --- paywall-gate --- (the Pro section after the description) */}
      tocLabel={site("prose.onThisPage")}
    >
      <section id="acceptance">
        <h2>{t("acceptance.title")}</h2>
        <p>{t("acceptance.content", v)}</p>
      </section>
      <section id="description">
        <h2>{t("description.title")}</h2>
        <p>{t("description.content", v)}</p>
      </section>
      {/* --- paywall-gate --- the free playground and the Pro subscriptions */}
      <section id="pro">
        <h2>{billing("terms.title")}</h2>
        <p>{billing("terms.content")}</p>
      </section>
      <section id="ugc">
        <h2>{t("ugc.title")}</h2>
        <p>{t("ugc.subtitle")}</p>
        <ul>
          <li>{t("ugc.item1")}</li>
          <li>{t("ugc.item2")}</li>
          <li>{t("ugc.item3")}</li>
        </ul>
        <p>{t("ugc.footer", v)}</p>
      </section>
      <section id="acceptable">
        <h2>{t("acceptable.title")}</h2>
        <p>{t("acceptable.subtitle")}</p>
        <ul>
          <li>{t("acceptable.item1")}</li>
          <li>{t("acceptable.item2")}</li>
          <li>{t("acceptable.item3")}</li>
          <li>{t("acceptable.item4")}</li>
        </ul>
      </section>
      {PLAIN.map((k) => (
        <section key={k} id={k}>
          <h2>{t(`${k}.title`)}</h2>
          <p>{t(`${k}.content`, v)}</p>
          {/* --- code-obfuscation --- the software (its obfuscated code and the Gerald artwork) is proprietary */}
          {k === "intellectual" && <p>{t("proprietaryNotice", v)}</p>}
        </section>
      ))}
      <section id="contact">
        <h2>{t("contact.title")}</h2>
        <p>
          {t("contact.content")} <Link href="/feedback">{t("contact.feedbackLink")}</Link>.
        </p>
      </section>
    </ProseLayout>
  );
}
