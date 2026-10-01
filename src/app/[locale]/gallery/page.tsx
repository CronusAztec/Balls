import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import PosterCard from "@/components/site/PosterCard";
import { Link } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { GALLERY, galleryHref } from "@/content/gallery";
import { SITE_NAME, absoluteUrl, assetPath, pageUrl } from "@/lib/site";
import { localeAlternates } from "@/i18n/alternates";
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight, IconPlay } from "@/components/ui/icons";

/*
 * --- daily-gallery --- The preset gallery: curated setups (src/content/gallery.ts) with their preview images and a "Try it"
 * link that opens the simulator with the preset applied. --- site-redesign --- a wall of poster cards (the modes wall's
 * card): the picture, the name with the mode as its tag, two lines of description and the one Try it link, stretched over
 * the whole card so the picture opens it too.
 */

function localeOf(locale: string): Locale {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Gallery" });
  const v = { siteName: SITE_NAME, count: GALLERY.length };
  const title = t("metaTitle", v);
  const description = t("metaDescription", v);
  return {
    title,
    description,
    alternates: { canonical: pageUrl(locale, "/gallery"), languages: localeAlternates("/gallery") },
    openGraph: { title, description, url: pageUrl(locale, "/gallery"), siteName: SITE_NAME, type: "website", images: [absoluteUrl(`/gallery/${GALLERY[0].id}.webp`)] },
  };
}

export default async function GalleryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = localeOf(locale);
  const t = await getTranslations({ locale, namespace: "Gallery" });
  const modes = await getTranslations({ locale, namespace: "Modes" });
  const v = { siteName: SITE_NAME, count: GALLERY.length };
  const listJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: t("title", v),
    itemListElement: GALLERY.map((preset, i) => ({ "@type": "ListItem", position: i + 1, name: preset.name[lang], url: `${pageUrl(locale, "/simulator")}?${preset.query}` })),
  };
  return (
    <div className="min-h-screen bg-bg text-ink">
      <JsonLd data={listJsonLd} />
      <Navbar />
      <main id="content">
        <div className="site-container py-12 sm:py-16 lg:py-20">
          <header className="max-w-[680px]">
            <p className="eyebrow text-ink-3">
              {t("badge")} <span className="num text-ink-2">· {GALLERY.length}</span>
            </p>
            <h1 className="mt-3 text-2xl font-bold text-ink lg:text-3xl">{t("title", v)}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{t("intro", v)}</p>
          </header>
          <ul className="mt-12 grid grid-cols-1 gap-x-6 gap-y-10 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="gallery-grid">
            {GALLERY.map((preset) => {
              const name = preset.name[lang];
              return (
                <li key={preset.id} className="flex">
                  <article
                    id={preset.id}
                    className="group relative flex w-full scroll-mt-24 flex-col"
                    data-gallery-card={preset.id}
                    data-gallery-mode={preset.mode}
                    data-gallery-query={preset.query}
                    data-preview-at={preset.previewAt}
                  >
                    <PosterCard
                      image={assetPath(`/gallery/${preset.id}.webp`)}
                      alt={t("imageAlt", { name })}
                      name={name}
                      tag={modes(`${preset.mode}.name`)}
                      description={preset.description[lang]}
                      headingLevel="h2"
                      footer={
                        <Link
                          href={galleryHref(preset)}
                          aria-label={t("tryAria", { name })}
                          className="mt-3 inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent after:absolute after:inset-0 after:content-[''] hover:text-accent-strong"
                          data-testid="gallery-try"
                        >
                          <IconPlay size={14} />
                          {t("tryIt")}
                        </Link>
                      }
                    />
                  </article>
                </li>
              );
            })}
          </ul>
          <div className="mt-16 flex flex-col items-start gap-5 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-[56ch] text-md text-ink-2">{t("outro")}</p>
            <Link href="/simulator" className={buttonClass({ variant: "primary", size: "md", className: "shrink-0" })}>
              {t("cta")}
              <IconArrowRight size={16} />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
