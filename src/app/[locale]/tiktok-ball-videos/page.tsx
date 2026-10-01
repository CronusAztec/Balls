import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ProseLayout from "@/components/site/ProseLayout";
import { Link } from "@/i18n/navigation";
import { SITE_NAME, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { MODE_CARD_ORDER } from "@/lib/modes"; // --- review fix (ui-i18n) --- the mode count comes from the code
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "TikTokBallVideos" });
  const v = { siteName: SITE_NAME, count: MODE_CARD_ORDER.length };
  return {
    title: t("metaTitle", v),
    description: t("metaDescription", v),
    alternates: { canonical: pageUrl(locale, "/tiktok-ball-videos"), languages: localeAlternates("/tiktok-ball-videos") },
  };
}

/* --- site-redesign --- the TikTok guide in the reading column: the lede, three sections, the call to action. */
export default async function TikTokPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "TikTokBallVideos" });
  const v = { siteName: SITE_NAME };
  return (
    <ProseLayout eyebrow={t("badge")} title={t("title")} lede={t("p1", v)}>
      <p>{t("p2", v)}</p>
      <section>
        <h2>{t("h2_1")}</h2>
        <p>{t("p3", v)}</p>
        <p>{t("p4", v)}</p>
      </section>
      <section>
        <h2>{t("h2_2")}</h2>
        <p>{t("p5", v)}</p>
        <p>{t("p6", v)}</p>
      </section>
      <section>
        <h2>{t("h2_3")}</h2>
        <p>{t("p7", v)}</p>
        <p>{t("p8", v)}</p>
      </section>
      <div className="not-prose border-t border-line pt-8">
        <Link href="/simulator?mode=classic" className={buttonClass({ variant: "primary", size: "md" })}>
          {t("cta")}
          <IconArrowRight size={16} />
        </Link>
      </div>
    </ProseLayout>
  );
}
