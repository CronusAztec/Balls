import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";
import JsonLd from "@/components/site/JsonLd"; // --- seo ---
import { breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "About" });
  const v = { siteName: SITE_NAME };
  // --- seo --- the card carries the page's short social title and line (the search title and description are longer)
  return pageMetadata({
    locale,
    path: "/about",
    title: t("metaTitle", v),
    description: t("metaDescription", v),
    social: { title: t("metaOgTitle", v), description: t("metaOgDescription", v) },
  });
}

/*
 * --- site-redesign --- the story, then what the tool is, how far it bends and how a clip leaves it (the About.tool* /
 * tweak* / export* sections), then what we care about, privacy, who makes it and where it is going – one reading column.
 */
export default async function AboutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "About" });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("badge"), path: "/about" }]); // --- seo --- the trail Home > this page (last child: the prose rules space siblings)
  const v = { siteName: SITE_NAME };
  const link = (href: string) =>
    function RichLink(chunks: React.ReactNode) {
      return <Link href={href}>{chunks}</Link>;
    };
  return (
    <ProseLayout eyebrow={t("badge")} title={t("title", v)} lede={t("metaDescription", v)}>
      <p>{t("p1", v)}</p>
      <p>{t("p2", v)}</p>
      <section>
        <h2>{t("toolTitle", v)}</h2>
        <p>{t("toolP1", v)}</p>
        <p>{t("toolP2", v)}</p>
      </section>
      <section>
        <h2>{t("tweakTitle", v)}</h2>
        <p>{t("tweakP", v)}</p>
      </section>
      <section>
        <h2>{t("exportTitle", v)}</h2>
        <p>{t("exportP", v)}</p>
      </section>
      <section>
        <h2>{t("h2_1")}</h2>
        <p>{t("p3", v)}</p>
        <p>{t("p4", v)}</p>
      </section>
      <section>
        <h2>{t("h2_2")}</h2>
        <p>{t.rich("p5", { ...v, privacy: link("/privacy") })}</p>
      </section>
      <section>
        <h2>{t("h2_3")}</h2>
        <p>{t.rich("p6", { ...v, feedback: link("/feedback") })}</p>
      </section>
      <section>
        <h2>{t("h2_4")}</h2>
        <p>{t.rich("p7", v)}</p>
      </section>
      <div className="not-prose border-t border-line pt-8">
        <Link href="/simulator" className={buttonClass({ variant: "primary", size: "md" })}>
          {t("cta")}
          <IconArrowRight size={16} />
        </Link>
      </div>
      <JsonLd data={breadcrumbs} />
    </ProseLayout>
  );
}
