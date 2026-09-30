import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import SectionHeading from "@/components/site/SectionHeading";
import JsonLd from "@/components/site/JsonLd";
import { Link } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { GALLERY, galleryHref } from "@/content/gallery";
import { SITE_NAME, absoluteUrl, assetPath, pageUrl } from "@/lib/site";
import { localeAlternates } from "../layout";

/* --- daily-gallery --- The preset gallery: curated setups (src/content/gallery.ts) with their preview images and a "Try it" link that opens the simulator with the preset applied. */

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
    <div className="min-h-screen bg-slate-950 text-slate-50 selection:bg-cyan-500/30 font-sans">
      <JsonLd data={listJsonLd} />
      <Navbar backHref="/" />
      <main className="container mx-auto px-4 py-12 max-w-6xl">
        <SectionHeading as="h1" badge={t("badge")} title={t("title", v)} description={t("intro", v)} />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="gallery-grid">
          {GALLERY.map((preset) => {
            const name = preset.name[lang];
            return (
              <article
                key={preset.id}
                id={preset.id}
                className="bg-slate-900/40 backdrop-blur-sm border border-slate-800 rounded-3xl overflow-hidden flex flex-col hover:border-cyan-500/30 hover:bg-slate-900/60 transition-all duration-300 group shadow-sm hover:shadow-cyan-500/5 hover:-translate-y-1 scroll-mt-20"
                data-gallery-card={preset.id}
                data-gallery-mode={preset.mode}
                data-gallery-query={preset.query}
                data-preview-at={preset.previewAt}
              >
                <div className="relative w-full aspect-video bg-slate-800/50 overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={assetPath(`/gallery/${preset.id}.webp`)} alt={t("imageAlt", { name })} loading="lazy" width={640} height={360} className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                  <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-950/80 border border-slate-700/60 text-[11px] font-bold text-slate-200 backdrop-blur-sm">{modes(`${preset.mode}.name`)}</span>
                </div>
                <div className="p-6 flex flex-col gap-2 flex-1">
                  <h2 className="text-xl font-black text-white group-hover:text-cyan-400 transition-colors tracking-tight">{name}</h2>
                  <p className="text-sm text-slate-400 leading-relaxed font-medium">{preset.description[lang]}</p>
                  <div className="mt-auto pt-3">
                    <Link
                      href={galleryHref(preset)}
                      aria-label={t("tryAria", { name })}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-slate-950 bg-gradient-to-r from-cyan-600 to-cyan-500 shadow-lg shadow-cyan-600/10 hover:scale-105 active:scale-95 transition-all"
                      data-testid="gallery-try"
                    >
                      ▶ {t("tryIt")}
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <div className="mt-12 text-center space-y-4">
          <p className="text-slate-400 max-w-xl mx-auto leading-relaxed">{t("outro")}</p>
          <Link href="/simulator" className="btn-bounce inline-flex px-7 py-3 rounded-xl font-bold text-slate-950 bg-gradient-to-r from-blue-600 to-cyan-600">
            {t("cta")}
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
