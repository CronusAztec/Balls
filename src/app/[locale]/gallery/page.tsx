import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import JsonLd from "@/components/site/JsonLd";
import PosterCard from "@/components/site/PosterCard";
import GalleryShelfMemory from "@/components/site/GalleryShelfMemory"; // --- site-nav ---
import { Link } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing, type Locale } from "@/i18n/routing";
import { GALLERY, galleryHref } from "@/content/gallery";
import { SITE_NAME, assetPath, pageUrl } from "@/lib/site";
import { breadcrumbJsonLd, itemListJsonLd, pageMetadata } from "@/lib/seo"; // --- seo ---
import { MODE_SHELF_IDS, modesOnShelf, shelfOf, type ShelfId } from "@/lib/siteDesign"; // --- site-nav ---
import type { ModeId } from "@/lib/physics/types"; // --- gallery-every-mode ---
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight, IconPlay } from "@/components/ui/icons";

/*
 * --- daily-gallery --- The preset gallery: curated setups (src/content/gallery.ts) with their preview images and a "Try it"
 * link that opens the simulator with the preset applied. --- site-redesign --- a wall of poster cards (the modes wall's
 * card): the picture, the name with the mode as its tag, two lines of description and the one Try it link, stretched over
 * the whole card so the picture opens it too.
 * --- site-nav --- Two cards a row from 360 px (a phone showed one a screen), the first row's pictures load with the page,
 * and the modes wall's shelf chips filter the presets by their mode's shelf. The chips are radio buttons styled as chips,
 * as on the changelog: they work without scripts, and the CSS hides the cards of the other shelves. The chosen shelf goes
 * into the address (?family=music, GalleryShelfMemory.tsx), so Back from a preset and a reload show it again.
 * --- gallery-every-mode --- Every mode has a preset now, so a second row of chips names the modes of the chosen shelf (none
 * under All, where fifty chips would push the cards out of the first screen), each with its number of presets when it has
 * more than one, after an All chip that shows the whole shelf again. (E2 review) The mode chips are a radio group of their
 * own (gallery-mode, with its own legend): one Tab stop for the shelves and one for the modes, the arrow keys stay in one row
 * and reach every chip of it (in one group with the shelves, the arrows stepped from shelf to shelf and the keyboard reached
 * one mode chip of fifty). A mode filters only together with its own shelf, so a mode left on under another shelf hides
 * nothing; its rules are this page's own (modeFilterCss: one per mode, not a class each in the site's stylesheet), and the
 * mode goes into the address as ?family=music&mode=songRing.
 */

/** Hides every card that is not on the chosen shelf (each class is written out: the CSS is built from the source text). */
const SHELF_FILTER: Record<ShelfId, string> = {
  escape: "has-[#gallery-shelf-escape:checked]:[&_li:not([data-shelf=escape])]:hidden",
  battle: "has-[#gallery-shelf-battle:checked]:[&_li:not([data-shelf=battle])]:hidden",
  music: "has-[#gallery-shelf-music:checked]:[&_li:not([data-shelf=music])]:hidden",
  loops: "has-[#gallery-shelf-loops:checked]:[&_li:not([data-shelf=loops])]:hidden",
  smash: "has-[#gallery-shelf-smash:checked]:[&_li:not([data-shelf=smash])]:hidden",
  journey: "has-[#gallery-shelf-journey:checked]:[&_li:not([data-shelf=journey])]:hidden",
  lab: "has-[#gallery-shelf-lab:checked]:[&_li:not([data-shelf=lab])]:hidden",
};
const CHIP_CLASS =
  "inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-full border border-line px-3 text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent [@media(pointer:coarse)]:min-h-11";
/** --- gallery-every-mode --- A mode chip: the shelf chip a size smaller (on a touch screen it keeps the 44 px target). */
const MODE_CHIP_CLASS =
  "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border border-line px-2.5 text-xs font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink peer-checked:border-accent peer-checked:bg-accent peer-checked:text-accent-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent [@media(pointer:coarse)]:min-h-11";
/**
 * --- gallery-every-mode --- The page's own rules for the mode chips: All hides the mode row; a shelf chip on keeps the mode
 * row to that shelf's modes (its All chip stays); a mode chip on, together with its own shelf's chip, hides the other modes'
 * cards. Mode and shelf ids are plain words, so the selectors need no quotes.
 */
function modeFilterCss(modes: readonly ModeId[], shelves: readonly ShelfId[]): string {
  const root = "#gallery-filter";
  // (under All the row is hidden: a shelf opens its modes, so the first screen keeps its cards and not a wall of fifty chips)
  const rules: string[] = [`${root}:has(#gallery-shelf-all:checked) [data-gallery-mode-row]{display:none}`];
  for (const shelf of shelves) rules.push(`${root}:has(#gallery-shelf-${shelf}:checked) [data-mode-chip]:not([data-shelf=${shelf}]){display:none}`);
  for (const mode of modes) rules.push(`${root}:has(#gallery-shelf-${shelfOf(mode)}:checked):has(#gallery-mode-${mode}:checked) [data-gallery-item]:not([data-mode=${mode}]){display:none}`);
  return rules.join("\n");
}

/** How many cards load their picture with the page: the first row at the widest layout (four columns). */
const FIRST_ROW = 4;

function localeOf(locale: string): Locale {
  return hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "Gallery" });
  const v = { siteName: SITE_NAME, count: GALLERY.length };
  return pageMetadata({ locale, path: "/gallery", title: t("metaTitle", v), description: t("metaDescription", v) }); // --- seo ---
}

export default async function GalleryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const lang = localeOf(locale);
  const t = await getTranslations({ locale, namespace: "Gallery" });
  const modes = await getTranslations({ locale, namespace: "Modes" });
  const site = await getTranslations({ locale, namespace: "SiteRedesign" });
  const v = { siteName: SITE_NAME, count: GALLERY.length };
  // --- site-nav --- the shelves that hold a preset, in the wall's order, each with its number of presets
  const shelves = MODE_SHELF_IDS.map((id) => ({ id, count: GALLERY.filter((preset) => shelfOf(preset.mode) === id).length })).filter((shelf) => shelf.count > 0);
  // --- gallery-every-mode --- the modes that hold a preset, in the wall's order, each with its number of presets
  const modeChips = modesOnShelf("all")
    .map((id) => ({ id, count: GALLERY.filter((preset) => preset.mode === id).length }))
    .filter((chip) => chip.count > 0);
  // --- seo --- the list (builders in lib/seo.ts) and the trail Home > Gallery
  const listJsonLd = itemListJsonLd({ name: t("title", v), items: GALLERY.map((preset) => ({ name: preset.name[lang], url: `${pageUrl(locale, "/simulator")}?${preset.query}` })) });
  const breadcrumbs = await breadcrumbJsonLd(locale, [{ name: t("badge"), path: "/gallery" }]);
  return (
    <div className="min-h-screen bg-bg text-ink">
      <JsonLd data={listJsonLd} />
      <JsonLd data={breadcrumbs} />
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
          {/* The filter: the radios (each before its label), then the list. :has() on the wrapper hides the other shelves' cards. */}
          <div id="gallery-filter" className={shelves.map((shelf) => SHELF_FILTER[shelf.id]).join(" ")} data-testid="gallery-filter">
            <style dangerouslySetInnerHTML={{ __html: modeFilterCss(modeChips.map((chip) => chip.id), shelves.map((shelf) => shelf.id)) }} />
            {/* (min-w-0: a fieldset is as wide as its content by default, and the row would widen a phone's page instead of scrolling) */}
            <GalleryShelfMemory name="gallery-shelf" modeName="gallery-mode" />
            <fieldset className="mt-10 min-w-0">
              <legend className="sr-only">{t("filterLabel")}</legend>
              <div className="-mx-4 flex min-w-0 gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0 [&::-webkit-scrollbar]:hidden">
                {[{ id: "all" as const, count: GALLERY.length }, ...shelves].map((shelf) => (
                  <span key={shelf.id} className="contents">
                    <input type="radio" name="gallery-shelf" id={`gallery-shelf-${shelf.id}`} value={shelf.id} defaultChecked={shelf.id === "all"} className="peer sr-only" />
                    <label htmlFor={`gallery-shelf-${shelf.id}`} className={CHIP_CLASS}>
                      {shelf.id === "all" ? site("modesWall.all") : site(`families.${shelf.id}`)}
                      <span className="num text-xs opacity-70">{shelf.count}</span>
                    </label>
                  </span>
                ))}
              </div>
            </fieldset>
            {/* --- gallery-every-mode --- the chosen shelf's modes, the chips a size smaller: one line that scrolls sideways on a
                touch screen, as the shelves do on a phone, wrapped from 640 px for a mouse, which has no sideways scroll; a radio
                group of their own (E2 review), All first */}
            <fieldset className="min-w-0" data-gallery-mode-row="">
              <legend className="sr-only">{t("modeFilterLabel")}</legend>
              <div className="-mx-4 mt-2 flex min-w-0 gap-1.5 overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:mx-0 sm:px-0 [@media(pointer:fine)]:sm:flex-wrap [&::-webkit-scrollbar]:hidden" data-testid="gallery-mode-chips">
                <span className="contents">
                  <input type="radio" name="gallery-mode" id="gallery-mode-all" value="all" defaultChecked className="peer sr-only" />
                  <label htmlFor="gallery-mode-all" className={MODE_CHIP_CLASS}>
                    {site("modesWall.all")}
                  </label>
                </span>
                {modeChips.map((chip) => (
                  <span key={chip.id} className="contents" data-mode-chip={chip.id} data-shelf={shelfOf(chip.id)}>
                    <input type="radio" name="gallery-mode" id={`gallery-mode-${chip.id}`} value={chip.id} className="peer sr-only" />
                    <label htmlFor={`gallery-mode-${chip.id}`} className={MODE_CHIP_CLASS}>
                      {modes(`${chip.id}.name`)}
                      {chip.count > 1 && <span className="num opacity-70">{chip.count}</span>}
                    </label>
                  </span>
                ))}
              </div>
            </fieldset>
            <ul className="mt-8 grid grid-cols-1 gap-x-4 gap-y-10 min-[360px]:grid-cols-2 sm:gap-x-6 lg:grid-cols-3 xl:grid-cols-4" data-testid="gallery-grid">
              {GALLERY.map((preset, index) => {
                const name = preset.name[lang];
                return (
                  <li key={preset.id} className="flex min-w-0" data-shelf={shelfOf(preset.mode)} data-mode={preset.mode} data-gallery-item="">
                    <article
                      id={preset.id}
                      className="group relative flex w-full min-w-0 scroll-mt-24 flex-col"
                      data-gallery-card={preset.id}
                      data-gallery-mode={preset.mode}
                      data-gallery-query={preset.query}
                      data-preview-at={preset.previewAt}
                      data-preview-camera={preset.camera ? JSON.stringify(preset.camera) : undefined}
                    >
                      <PosterCard
                        image={assetPath(`/gallery/${preset.id}.webp`)}
                        alt={t("imageAlt", { name })}
                        name={name}
                        tag={modes(`${preset.mode}.name`)}
                        description={preset.description[lang]}
                        headingLevel="h2"
                        priority={index < FIRST_ROW}
                        footer={
                          <Link
                            href={galleryHref(preset)}
                            aria-label={t("tryAria", { name })}
                            className="mt-3 inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent after:absolute after:inset-0 after:content-[''] hover:text-accent-strong"
                            data-testid="gallery-try"
                            data-track="cta_click"
                            data-track-id="gallery_try"
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
          </div>
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
