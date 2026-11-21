import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import PosterCard from "@/components/site/PosterCard";
import { Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { SITE_NAME, absoluteUrl, assetPath } from "@/lib/site";
import { OG_SIZE, breadcrumbJsonLd, pageMetadata } from "@/lib/seo";
import { shelfOf } from "@/lib/siteDesign";
import { cardHref } from "@/lib/thumbnails/heroMoments";
import { MESSAGE_VALUES, MODE_FIRST_SETTINGS, MODE_INTROS, MODE_PAGE_INTROS, modeMetaDescription, modeOfSlug, modeOgImagePathIn, modePageLooks, modePageModes, modePagePath, modeSlug, relatedModes, starterSettings } from "@/lib/modePages";
import type { ModeId } from "@/lib/physics/types";
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight, IconPlay } from "@/components/ui/icons";

/*
 * --- mode-pages --- (Lane E, E3) A page for every mode, in every language: /<locale>/modes/<slug>/ (lib/modePages.ts names the
 * addresses). The mode's card picture and its one-liner, "Open in the studio" as the main action (the card's own look and seed,
 * so the run in the picture is the one that opens), how the mode plays (its panel section's intro), its looks (the gallery's
 * presets with their pictures, then Plain, the card's look and the daily challenge's), the first settings of its own block
 * with their tips and the basics every mode starts with, and the modes next to it on its shelf. Its own title, description,
 * canonical address, hreflang set and social card (public/og/modes/<slug>.jpg, drawn from the card picture). Every word on it
 * is copy that exists elsewhere, so no page repeats another: the mode's own messages, the panel's, the gallery's.
 */

/** Every mode in every language is a page of the export; any other address is the site's 404. */
export const dynamicParams = false;

export function generateStaticParams() {
  return modePageModes().map((mode) => ({ mode: modeSlug(mode) }));
}

type Params = { params: Promise<{ locale: string; mode: string }> };

function localeOf(locale: string): Locale {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

/**
 * A message by its full key ("Controls.pwDesc"), or null where the catalog lacks it (a renamed control shows nothing), with the
 * values the studio fills in (E3 review: MESSAGE_VALUES, so the arms tip says 64, not "{max}").
 */
async function messageOf(locale: string, full: string): Promise<string | null> {
  const dot = full.indexOf(".");
  const t = await getTranslations({ locale, namespace: full.slice(0, dot) as never });
  const key = full.slice(dot + 1);
  return t.has(key as never) ? (t(key as never, MESSAGE_VALUES[full] as never) as string) : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale, mode: slug } = await params;
  const mode = modeOfSlug(slug);
  if (!mode) return {};
  const t = await getTranslations({ locale, namespace: "ModePage" });
  const modes = await getTranslations({ locale, namespace: "Modes" });
  const name = modes(`${mode}.name`);
  const description = modeMetaDescription(modes(`${mode}.description`), [t("metaMore"), t("metaShort")]);
  return pageMetadata({
    locale,
    path: modePagePath(mode),
    title: t("metaTitle", { name, siteName: SITE_NAME }),
    description,
    image: { url: absoluteUrl(modeOgImagePathIn(mode, locale)), ...OG_SIZE, alt: t("cardAlt", { name, siteName: SITE_NAME }), type: "image/jpeg" },
  });
}

export default async function ModePage({ params }: Params) {
  const { locale, mode: slug } = await params;
  const mode = modeOfSlug(slug);
  if (!mode) notFound();
  setRequestLocale(locale);
  const lang = localeOf(locale);
  const t = await getTranslations({ locale, namespace: "ModePage" });
  const modes = await getTranslations({ locale, namespace: "Modes" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const controls = await getTranslations({ locale, namespace: "Controls" });
  const gallery = await getTranslations({ locale, namespace: "Gallery" });
  const name = modes(`${mode}.name`);
  const shelf = shelfOf(mode);
  const shelfName = site(`families.${shelf}`);
  // (the studio block's intro, or for a block without one the page's own: E3 review, every page says how its mode plays)
  const intro = MODE_INTROS[mode] ? await messageOf(locale, MODE_INTROS[mode]) : MODE_PAGE_INTROS.includes(mode) ? t(`intro.${mode}` as never) : null;
  const looks = modePageLooks(mode);
  const presets = looks.filter((look) => look.preset);
  const otherLooks = looks.filter((look) => !look.preset);
  // (each setting's name and tip; one a catalog lacks, a control renamed since, is left out)
  const own = (await Promise.all((MODE_FIRST_SETTINGS[mode] ?? []).map(async (key) => ({ key, name: await messageOf(locale, key), tip: await messageOf(locale, `${key}Tip`) })))).filter((s): s is { key: string; name: string; tip: string } => !!s.name && !!s.tip);
  const basics = starterSettings(mode).filter((key) => controls.has(key as never));
  const ownSettings = own.length > 0; // (E3 review: a mode with no settings of its own titles the section as the basics)
  const related = relatedModes(mode);
  const studio = cardHref(mode);
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name, path: modePagePath(mode) }]);
  const sectionTitle = "text-xl font-bold text-ink sm:text-2xl";
  return (
    <div className="min-h-screen bg-bg text-ink">
      <JsonLd data={breadcrumbs} />
      <Navbar />
      <main id="content" data-mode-page={mode}>
        <div className="site-container py-10 sm:py-14 lg:py-16">
          {/* the mode: its shelf, name and one-liner, the main action, and its card picture beside them from 768 px */}
          <header className="grid items-center gap-8 md:grid-cols-[minmax(0,1fr)_minmax(0,360px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:gap-14">
            <div className="min-w-0">
              <p className="eyebrow text-ink-3">
                <Link href={`/?family=${shelf}#modes`} className="inline-flex items-center hover:text-ink-2 [@media(pointer:coarse)]:min-h-11" data-testid="mode-page-shelf">
                  {shelfName}
                </Link>
              </p>
              <h1 className="mt-3 break-words text-2xl font-bold text-ink sm:text-3xl lg:text-4xl">{name}</h1>
              <p className="mt-4 max-w-[56ch] text-lg leading-relaxed text-ink-2">{modes(`${mode}.description`)}</p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
                <Link href={studio} className={buttonClass({ variant: "primary", size: "md", className: "max-w-full max-sm:h-auto max-sm:py-2.5 max-sm:whitespace-normal" })} data-testid="mode-page-open">
                  <IconPlay size={16} />
                  {t("open")}
                </Link>
                {presets.length > 0 && (
                  <a href="#looks" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong [@media(pointer:coarse)]:min-h-11">
                    {t("looksJump")}
                    <IconArrowRight size={16} />
                  </a>
                )}
              </div>
            </div>
            <Link href={studio} className="group relative block aspect-square w-full max-w-[440px] overflow-hidden rounded-2xl border border-line bg-surface-2 hover:border-line-strong md:justify-self-end" aria-label={t("open")} tabIndex={-1}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={assetPath(`/modes/${mode}.webp`)} alt={modes("previewAlt", { name })} width={480} height={480} loading="eager" fetchPriority="high" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
            </Link>
          </header>

          {intro && (
            <section className="mt-14 max-w-[680px]" aria-labelledby="mode-how">
              <h2 id="mode-how" className={sectionTitle}>
                {t("howTitle")}
              </h2>
              <p className="mt-4 text-md leading-relaxed text-ink-2">{intro}</p>
            </section>
          )}

          {/* the looks: the gallery's presets as its cards, then the studio's other looks as links */}
          <section id="looks" className="mt-14 scroll-mt-24" aria-labelledby="mode-looks" data-testid="mode-page-looks">
            <h2 id="mode-looks" className={sectionTitle}>
              {t("looksTitle")}
            </h2>
            <p className="mt-3 max-w-[680px] text-md text-ink-2">{t("looksIntro")}</p>
            {presets.length > 0 && (
              <ul className="mt-8 grid grid-cols-1 gap-x-4 gap-y-10 min-[360px]:grid-cols-2 sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4">
                {presets.map((look) => {
                  const preset = look.preset!;
                  const presetName = preset.name[lang];
                  return (
                    <li key={look.id} className="flex min-w-0" data-mode-page-look={look.id}>
                      <article className="group relative flex w-full min-w-0 flex-col">
                        <PosterCard
                          image={assetPath(`/gallery/${preset.id}.webp`)}
                          alt={gallery("imageAlt", { name: presetName })}
                          name={presetName}
                          description={preset.description[lang]}
                          headingLevel="h3"
                          footer={
                            <Link href={look.href} aria-label={gallery("tryAria", { name: presetName })} className="mt-3 inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent after:absolute after:inset-0 after:content-[''] hover:text-accent-strong" data-testid="mode-page-try">
                              <IconPlay size={14} />
                              {gallery("tryIt")}
                            </Link>
                          }
                        />
                      </article>
                    </li>
                  );
                })}
              </ul>
            )}
            {otherLooks.length > 0 && (
              <div className="mt-8 flex flex-wrap items-center gap-2">
                <span className="mr-1 text-sm text-ink-3">{t("otherLooks")}</span>
                {otherLooks.map((look) => (
                  <Link key={look.id} href={look.href} className="inline-flex h-8 items-center rounded-full border border-line px-3 text-sm font-medium text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink [@media(pointer:coarse)]:min-h-11" data-mode-page-other-look={look.id}>
                    {look.name[lang]}
                  </Link>
                ))}
              </div>
            )}
          </section>

          {/* the first settings: the mode's own block (each control's name and tip), then the basics every mode starts with */}
          <section className="mt-14 max-w-[760px]" aria-labelledby="mode-settings" data-testid="mode-page-settings">
            <h2 id="mode-settings" className={sectionTitle}>
              {ownSettings ? t("settingsTitle") : t("basicsTitle")}
            </h2>
            {ownSettings && (
              <dl className="mt-6 space-y-5">
                {own.map((setting) => (
                  <div key={setting.key} className="border-l-2 border-line pl-4">
                    <dt className="text-md font-medium text-ink">{setting.name}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-ink-2">{setting.tip}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className="mt-6 text-sm text-ink-3">{ownSettings ? t("basicsAlso") : t("basicsOnly")}</p>
            {/* (E3 review) the basics as plain words between dots: names to look for in the studio, not chips that look tappable */}
            <ul className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-sm text-ink-2" data-testid="mode-page-basics">
              {basics.map((key) => (
                <li key={key} className="after:ml-2 after:text-ink-3 after:content-['·'] last:after:content-none">
                  {controls(key as never)}
                </li>
              ))}
            </ul>
          </section>

          {/* the modes next to it: its shelf's, as the wall's cards, each opening its own page */}
          <section className="mt-14" aria-labelledby="mode-related" data-testid="mode-page-related">
            <h2 id="mode-related" className={sectionTitle}>
              {t("relatedTitle")}
            </h2>
            <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:gap-x-6 lg:grid-cols-4">
              {related.map((other: ModeId) => (
                <li key={other} className="flex min-w-0">
                  <Link href={modePagePath(other)} className="group block w-full min-w-0 rounded-xl" data-mode-page-related={other}>
                    <PosterCard image={assetPath(`/modes/${other}.webp`)} alt={modes("previewAlt", { name: modes(`${other}.name`) })} name={modes(`${other}.name`)} tag={site(`families.${shelfOf(other)}`)} description={modes(`${other}.description`)} headingLevel="h3" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          <div className="mt-16 flex flex-col items-start gap-5 border-t border-line pt-10 sm:flex-row sm:items-center sm:justify-between">
            <Link href="/#modes" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong [@media(pointer:coarse)]:min-h-11" data-testid="mode-page-all">
              {t("allModes")}
              <IconArrowRight size={16} />
            </Link>
            {/* (E3 review) a long name wraps on a phone instead of widening the page, as the top button does */}
            <Link href={studio} className={buttonClass({ variant: "primary", size: "md", className: "max-w-full max-sm:h-auto max-sm:py-2.5 max-sm:whitespace-normal sm:shrink-0" })} data-testid="mode-page-open-bottom">
              {t("openNamed", { name })}
              <IconArrowRight size={16} />
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
