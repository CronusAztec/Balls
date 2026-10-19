import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout from "@/components/site/ProseLayout";
import { SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { fontLicences, packageLicences, type ThirdPartyLicence } from "@/lib/licences";

/*
 * --- legal-audit --- The third-party licences page: the site's production dependencies with their licence texts (read from
 * node_modules at build time, lib/licences.ts), the self-hosted fonts under the SIL Open Font License 1.1, and where the
 * Windows app lists its own components (ffmpeg under the GPL, Electron, Chromium, llama.cpp). The long texts sit in
 * <details> blocks. Linked from the footer's Legal column and listed in the sitemap.
 */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Licences" });
  return pageMetadata({ locale, path: "/licences", title: t("metaTitle", { siteName: SITE_NAME }), description: t("metaDescription", { siteName: SITE_NAME }) }); // --- seo ---
}

const SECTIONS = ["packages", "fonts", "app"] as const;

function LicenceBlock({ item }: { item: ThirdPartyLicence }) {
  const label = [item.name, item.version].filter(Boolean).join(" ");
  return (
    <details data-testid="licence" data-licence-name={item.name}>
      <summary>
        {label}
        {item.licence ? ` · ${item.licence}` : ""}
      </summary>
      {item.text && <pre className="whitespace-pre-wrap text-xs leading-relaxed">{item.text}</pre>}
    </details>
  );
}

export default async function LicencesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "Licences" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("title"), path: "/licences" }]); // --- seo ---
  const packages = packageLicences();
  const fonts = fontLicences();
  return (
    <ProseLayout eyebrow={site("footer.legal")} title={t("title")} lede={t("lede", { siteName: SITE_NAME })} toc={SECTIONS.map((id) => ({ id, label: t(`${id}Title`) }))} tocLabel={site("prose.onThisPage")}>
      <section id="packages">
        <h2>{t("packagesTitle")}</h2>
        {packages.map((p) => (
          <LicenceBlock key={p.name} item={p} />
        ))}
      </section>
      <section id="fonts">
        <h2>{t("fontsTitle")}</h2>
        <p>{t("fontsText")}</p>
        {fonts.map((f) => (
          <LicenceBlock key={f.name} item={f} />
        ))}
      </section>
      <section id="app">
        <h2>{t("appTitle")}</h2>
        <p>{t("appText")}</p>
      </section>
      <JsonLd data={breadcrumbs} />
    </ProseLayout>
  );
}
