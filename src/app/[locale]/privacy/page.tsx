import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout, { legalDate } from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_DOMAIN, SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { LEGAL_ADDRESS, LEGAL_NAME, SUPPORT_EMAIL } from "@/lib/operator"; // --- go-live-kit --- (--- legal-copy --- the controller block shows all three)

/*
 * --- legal-copy --- The privacy policy states what the code does and nothing else: who runs the site (the operator's details from
 * lib/operator.ts, else the feedback form), that the site sets no cookies, the visit statistics Cloudflare injects at the edge
 * (verified on the live site: a data-cf-beacon script with spa mode), the optional action-counting service (only when the build has
 * NEXT_PUBLIC_ANALYTICS_SCRIPT_URL, named by its host), who else handles data, retention as the code keeps it, the visitor's rights,
 * advertising (the product is advertised elsewhere, no ad pixels load), the Windows app's network use (desktop/src), publishing and
 * payments. The section numbers are computed from ORDER so a section can be added without renumbering the messages.
 * tests/legalCopy.test.ts pins the claims that must stay true.
 */

/** The page's sections in order: their ids are the table of contents' anchors; "payments" reads the Billing namespace. */
const ORDER = [
  "introduction",
  "controller",
  "information",
  "howWeUse",
  "cookies",
  "thirdParty",
  "retention",
  "rights",
  "children",
  "advertising",
  "consent",
  "publishing",
  "payments",
  "windowsApp",
  "changes",
  "contact",
] as const;
type SectionId = (typeof ORDER)[number];

/** The companies of the third-party list, with the page of their own privacy policy (each one answered 200 on 2026-10-14). */
const THIRD_PARTY = [
  ["cloudflare", "https://www.cloudflare.com/privacypolicy/"],
  ["stripe", "https://stripe.com/privacy"],
  ["nowpayments", "https://nowpayments.io/privacy-policy"],
  ["google", "https://policies.google.com/privacy"],
  ["github", "https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement"],
  ["huggingface", "https://huggingface.co/privacy"],
] as const;

/** The Windows app's network uses, in the order the list shows them (desktop/src: updater.ts, models, ai/cloud.ts, social/postiz.ts, the billing and relay calls of the bundled site). --- social-postiz --- Postiz: the key stays on the PC, a clip goes to the user's own Postiz only on Approve. */
const APP_USES = ["updates", "licence", "models", "cloud", "postiz", "accounts"] as const;

/**
 * The host of the optional action-counting service: the build's NEXT_PUBLIC_ANALYTICS_SCRIPT_URL (src/components/site/Analytics.tsx
 * loads it). Empty when the build has none, and then the page names Cloudflare Web Analytics alone.
 */
function statisticsHost(): string {
  try {
    const url = (process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL || "").trim();
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Privacy" });
  return pageMetadata({ locale, path: "/privacy", title: t("metaTitle", { siteName: SITE_NAME }), description: t("metaDescription", { siteName: SITE_NAME, siteDomain: SITE_DOMAIN }) }); // --- seo ---
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Privacy" });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("title"), path: "/privacy" }]); // --- seo --- the trail Home > this page (last child: the prose rules space siblings)
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const billing = await getTranslations({ locale, namespace: "Billing" }); // --- paywall-gate --- the Payments section
  const host = statisticsHost();
  const v = { siteName: SITE_NAME, siteDomain: SITE_DOMAIN, host };
  const label = (id: SectionId) => (id === "payments" ? billing("privacy.title") : t(`${id}.title`));
  const heading = (id: SectionId) => `${ORDER.indexOf(id) + 1}. ${label(id)}`;
  // The two ways to reach the operator: the support address when the build has one, else the feedback form.
  const mail = (chunks: ReactNode) => <a href={`mailto:${SUPPORT_EMAIL}`}>{chunks}</a>;
  const form = (chunks: ReactNode) => <Link href="/feedback">{chunks}</Link>;
  const reach = (withEmail: string, withForm: string) => (SUPPORT_EMAIL ? t.rich(withEmail, { email: SUPPORT_EMAIL, mail }) : t.rich(withForm, { link: form }));
  return (
    <ProseLayout
      eyebrow={site("footer.legal")}
      title={t("title")}
      meta={`${t("lastUpdated")}: ${legalDate(locale)}`}
      toc={ORDER.map((id) => ({ id, label: heading(id) }))}
      tocLabel={site("prose.onThisPage")}
    >
      <section id="introduction">
        <h2>{heading("introduction")}</h2>
        <p>{t("introduction.content", v)}</p>
      </section>
      {/* --- legal-copy --- who is responsible: the operator's name and address (lib/operator.ts) and the way to reach them */}
      <section id="controller">
        <h2>{heading("controller")}</h2>
        <p>{LEGAL_NAME ? t("controller.named", { ...v, legalName: LEGAL_NAME, address: LEGAL_ADDRESS ? `, ${LEGAL_ADDRESS}` : "" }) : t("controller.unnamed", v)}</p>
        <p>{reach("controller.writeTo", "controller.useForm")}</p>
      </section>
      <section id="information">
        <h2>{heading("information")}</h2>
        <p>{t("information.subtitle")}</p>
        <ul>
          {(["analytics", ...(host ? ["events"] : []), "localStorage", "images", "account", "payment"] as const).map((k) => (
            <li key={k}>
              <strong>{t(`information.${k}.label`)}</strong> {t(`information.${k}.content`, v)}
            </li>
          ))}
        </ul>
      </section>
      <section id="howWeUse">
        <h2>{heading("howWeUse")}</h2>
        <p>{t("howWeUse.content")}</p>
      </section>
      <section id="cookies">
        <h2>{heading("cookies")}</h2>
        <p>{t("cookies.content")}</p>
      </section>
      <section id="thirdParty">
        <h2>{heading("thirdParty")}</h2>
        <p>{t("thirdParty.intro")}</p>
        <ul>
          {THIRD_PARTY.map(([k, url]) => (
            <li key={k}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {t(`thirdParty.${k}.name`)}
              </a>{" "}
              {t(`thirdParty.${k}.use`)}
            </li>
          ))}
        </ul>
      </section>
      <section id="retention">
        <h2>{heading("retention")}</h2>
        <p>{t("retention.content")}</p>
      </section>
      <section id="rights">
        <h2>{heading("rights")}</h2>
        <p>{t("rights.content")}</p>
        <p>{reach("rights.requestEmail", "rights.requestForm")}</p>
      </section>
      <section id="children">
        <h2>{heading("children")}</h2>
        <p>{t("children.content")}</p>
      </section>
      {/* --- legal-copy --- the product is advertised on other platforms; this site shows no ads and loads no ad pixels or tags */}
      <section id="advertising">
        <h2>{heading("advertising")}</h2>
        <p>{t("advertising.content", v)}</p>
        {host && <p>{t("advertising.campaign", v)}</p>}
      </section>
      <section id="consent">
        <h2>{heading("consent")}</h2>
        <p>{t("consent.content")}</p>
      </section>
      {/* --- social-publish --- what the Publish block sends where (and the YouTube API Services disclosures) */}
      <section id="publishing">
        <h2>{heading("publishing")}</h2>
        <p>{t("publishing.content")}</p>
        <p>{t("publishing.relay")}</p>
        <p>{t("publishing.availability")}</p>
        {/* --- social-postiz --- the Windows app posts through the user's own Postiz, only after Approve; we receive nothing */}
        <p>{t("publishing.postiz")}</p>
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
      {/* --- paywall-gate --- what a Pro purchase sends where */}
      <section id="payments">
        <h2>{heading("payments")}</h2>
        <p>{billing("privacy.content")}</p>
        <p>{billing("privacy.renewals")}</p>
      </section>
      {/* --- legal-copy --- what the Windows app sends where (desktop/src has no telemetry and no crash reporter) */}
      <section id="windowsApp">
        <h2>{heading("windowsApp")}</h2>
        <p>{t("windowsApp.intro")}</p>
        <ul>
          {APP_USES.map((k) => (
            <li key={k}>
              <strong>{t(`windowsApp.${k}.label`)}</strong> {t(`windowsApp.${k}.content`)}
            </li>
          ))}
        </ul>
      </section>
      <section id="changes">
        <h2>{heading("changes")}</h2>
        <p>{t("changes.content")}</p>
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
