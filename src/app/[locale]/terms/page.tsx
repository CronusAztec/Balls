import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout, { legalDate } from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { LEGAL_ADDRESS, LEGAL_COUNTRY, LEGAL_NAME, LEGAL_REGISTRATION, LEGAL_VAT_ID, SUPPORT_EMAIL } from "@/lib/operator"; // --- go-live-kit --- (--- legal-audit --- VAT, register, country)
import { PLANS, formatUsd } from "@/lib/billing/config"; // --- go-live-kit --- the prices in the Pro section come from the plans

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Terms" });
  return pageMetadata({ locale, path: "/terms", title: t("metaTitle", { siteName: SITE_NAME }), description: t("metaDescription", { siteName: SITE_NAME, siteDomain: SITE_DOMAIN }) }); // --- seo ---
}

/*
 * --- legal-audit --- The sections in page order (their ids are the table of contents' anchors; /pricing links #refunds). The
 * numbers are computed from ORDER, like the privacy policy's, so a section can be added without renumbering the messages.
 * The Billing namespace holds the Pro sections (pro, delivery, refunds, withdrawal, operator); the Terms namespace the rest.
 */
const ORDER = ["acceptance", "description", "pro", "delivery", "refunds", "withdrawal", "operator", "ugc", "acceptable", "age", "intellectual", "ai", "takedown", "warranties", "liability", "termination", "changes", "law", "contact"] as const;
type SectionId = (typeof ORDER)[number];
const BILLING_SECTIONS: readonly SectionId[] = ["pro", "delivery", "refunds", "withdrawal", "operator"];
/** The Terms sections of one title and one paragraph, with {siteName} and {siteDomain}, around the takedown section. */
const PLAIN_BEFORE_TAKEDOWN: readonly SectionId[] = ["age", "intellectual", "ai"];
const PLAIN_AFTER_TAKEDOWN: readonly SectionId[] = ["warranties", "liability", "termination", "changes"];

export default async function TermsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Terms" });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("title"), path: "/terms" }]); // --- seo --- the trail Home > this page (last child: the prose rules space siblings)
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const billing = await getTranslations({ locale, namespace: "Billing" }); // --- paywall-gate --- the Pro subscriptions section
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN };
  const label = (id: SectionId) => (BILLING_SECTIONS.includes(id) ? billing(id === "pro" ? "terms.title" : `terms.${id}.title`) : t(`${id}.title`));
  const heading = (id: SectionId) => `${ORDER.indexOf(id) + 1}. ${label(id)}`;
  // --- legal-audit --- where to write: the support address, else the site itself (its feedback page; launch-check A3 fails a live site without the address)
  const contact = SUPPORT_EMAIL || SITE_DOMAIN;
  const address = LEGAL_ADDRESS ? `, ${LEGAL_ADDRESS}` : "";
  const bracket = (key: string) => `[${billing(key)}]`;
  const plain = (k: SectionId) => (
    <section key={k} id={k}>
      <h2>{heading(k)}</h2>
      <p>{t(`${k}.content`, v)}</p>
      {/* --- code-obfuscation --- the software (its obfuscated code and the Gerald artwork) is proprietary */}
      {k === "intellectual" && <p>{t("proprietaryNotice", v)}</p>}
    </section>
  );
  return (
    <ProseLayout
      eyebrow={site("footer.legal")}
      title={t("title")}
      meta={`${t("lastUpdated")}: ${legalDate(locale)}`}
      toc={ORDER.map((id) => ({ id, label: heading(id) }))}
      tocLabel={site("prose.onThisPage")}
    >
      <section id="acceptance">
        <h2>{heading("acceptance")}</h2>
        <p>{t("acceptance.content", v)}</p>
      </section>
      <section id="description">
        <h2>{heading("description")}</h2>
        <p>{t("description.content", v)}</p>
      </section>
      {/* --- paywall-gate --- the free playground and the Pro subscriptions */}
      <section id="pro">
        <h2>{heading("pro")}</h2>
        <p>{billing("terms.content", { monthly: formatUsd(PLANS.monthly.usd, locale), yearly: formatUsd(PLANS.yearly.usd, locale) })}</p>
      </section>
      {/* --- go-live-kit --- delivery, cancellation and refunds, and who the buyer is buying from (the operator's details come
          from the repository variables LEGAL_NAME / LEGAL_ADDRESS); --- legal-audit --- the EU and UK right of withdrawal with
          its model form, the VAT number and the register entry */}
      <section id="delivery">
        <h2>{heading("delivery")}</h2>
        <p>{billing("terms.delivery.content")}</p>
      </section>
      <section id="refunds">
        <h2>{heading("refunds")}</h2>
        <p>{billing("terms.refunds.content", { email: contact })}</p>
      </section>
      <section id="withdrawal">
        <h2>{heading("withdrawal")}</h2>
        <p>{billing("terms.withdrawal.content", { email: contact })}</p>
        <p data-testid="terms-withdrawal-form">
          {billing("terms.withdrawal.form", {
            legalName: LEGAL_NAME || billing("terms.withdrawal.operatorFallback"),
            email: contact,
            date: bracket("terms.withdrawal.formDate"),
            buyerEmail: bracket("terms.withdrawal.formEmail"),
            ref: bracket("terms.withdrawal.formRef"),
          })}
        </p>
      </section>
      <section id="operator">
        <h2>{heading("operator")}</h2>
        <p>{LEGAL_NAME ? billing("terms.operator.named", { siteName: SITE_NAME, legalName: LEGAL_NAME, address }) : billing("terms.operator.unnamed", { siteName: SITE_NAME, siteDomain: SITE_DOMAIN })}</p>
        {LEGAL_NAME && (LEGAL_VAT_ID || LEGAL_REGISTRATION) && (
          <p data-testid="terms-operator-identity">
            {[LEGAL_VAT_ID && billing("terms.operator.vat", { vat: LEGAL_VAT_ID }), LEGAL_REGISTRATION && billing("terms.operator.registration", { registration: LEGAL_REGISTRATION })].filter(Boolean).join(" ")}
          </p>
        )}
      </section>
      <section id="ugc">
        <h2>{heading("ugc")}</h2>
        <p>{t("ugc.subtitle")}</p>
        <ul>
          <li>{t("ugc.item1")}</li>
          <li>{t("ugc.item2")}</li>
          <li>{t("ugc.item3")}</li>
        </ul>
        <p>{t("ugc.footer", v)}</p>
        {/* --- legal-audit --- the licence a publish through the relay gives us: storage for 24 hours and the send, nothing more */}
        <p>{t("ugc.licence")}</p>
        {/* --- review fix (blueprint) --- games shared in links: the author's words, not ours, and never posing as the site */}
        <p>{t("ugc.games", v)}</p>
      </section>
      <section id="acceptable">
        <h2>{heading("acceptable")}</h2>
        <p>{t("acceptable.subtitle")}</p>
        <ul>
          <li>{t("acceptable.item1")}</li>
          <li>{t("acceptable.item2")}</li>
          <li>{t("acceptable.item3")}</li>
          <li>{t("acceptable.item4")}</li>
        </ul>
        {/* --- social-postiz --- posting through Postiz from the Windows app: Postiz's terms and the platforms' rules apply, the user answers for what they approve */}
        <p>{t("acceptable.postiz")}</p>
        {/* --- legal-audit --- the YouTube API Services require this sentence of every client's terms */}
        <p>{t("acceptable.youtube")}</p>
      </section>
      {PLAIN_BEFORE_TAKEDOWN.map(plain)}
      {/* --- legal-audit --- the notice-and-takedown route for the relay's clips: what to send, what we do, the copyright agent when the build names one */}
      <section id="takedown">
        <h2>{heading("takedown")}</h2>
        <p>{t("takedown.content", { email: contact })}</p>
        {LEGAL_NAME && SUPPORT_EMAIL && <p data-testid="terms-copyright-agent">{t("takedown.agent", { legalName: LEGAL_NAME, address: LEGAL_ADDRESS || SITE_DOMAIN, email: SUPPORT_EMAIL })}</p>}
      </section>
      {PLAIN_AFTER_TAKEDOWN.map(plain)}
      {/* --- legal-audit --- the governing law: the operator's country (LEGAL_COUNTRY), else the country where the operator is established */}
      <section id="law">
        <h2>{heading("law")}</h2>
        <p>{t("law.content", { country: LEGAL_COUNTRY || t("law.countryFallback") })}</p>
      </section>
      <section id="contact">
        <h2>{heading("contact")}</h2>
        <p>
          {t("contact.content")} <Link href="/feedback">{t("contact.feedbackLink")}</Link>.
        </p>
        {/* --- go-live-kit --- the support address, when the repository variable SUPPORT_EMAIL is set */}
        {SUPPORT_EMAIL && (
          <p>
            {billing("support.lead")} <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
          </p>
        )}
      </section>
      <JsonLd data={breadcrumbs} />
    </ProseLayout>
  );
}
