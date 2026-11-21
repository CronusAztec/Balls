import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { hasLocale } from "next-intl";
import { routing } from "@/i18n/routing";
import PosterCard from "./PosterCard";
import { GALLERY, galleryHref, homeGallery } from "@/content/gallery";
import { assetPath } from "@/lib/site";
import { IconArrowRight, IconPlay } from "@/components/ui/icons";

/*
 * --- home-looks --- The landing page's row under the hero: "Start from a finished look", six presets of the gallery
 * (HOME_GALLERY_IDS in src/content/gallery.ts) as the gallery's poster cards, each opening the studio with its settings and
 * its seed, and the way to the whole gallery. Below 1024 px the row scrolls sideways, two cards and a part of the third in
 * view, so the long landing page grows by one row; from 1024 px the six sit side by side. The pictures load lazily and sit
 * in squares of a fixed shape, so nothing moves while they come in.
 */
export default function HomeGallery() {
  const t = useTranslations("Gallery");
  const modes = useTranslations("Modes");
  const locale = useLocale();
  const lang = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const presets = homeGallery();
  return (
    <section className="border-b border-line" aria-labelledby="home-gallery-title" data-testid="home-gallery">
      <div className="site-container py-12 sm:py-16">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div className="max-w-[680px]">
            <h2 id="home-gallery-title" className="text-xl font-bold text-ink sm:text-2xl">
              {t("homeTitle")}
            </h2>
            <p className="mt-3 text-md text-ink-2">{t("intro", { count: GALLERY.length })}</p>
          </div>
          <Link href="/gallery" className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-strong [@media(pointer:coarse)]:min-h-11" data-testid="home-gallery-all">
            {t("homeAll")}
            <IconArrowRight size={16} />
          </Link>
        </div>
        <ul className="-mx-4 mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:grid lg:grid-cols-6 lg:overflow-visible lg:px-0 [&::-webkit-scrollbar]:hidden">
          {presets.map((preset) => {
            const name = preset.name[lang];
            return (
              <li key={preset.id} className="flex w-[42vw] max-w-[200px] shrink-0 snap-start lg:w-auto lg:max-w-none" data-home-look={preset.id}>
                <article className="group relative flex w-full min-w-0 flex-col">
                  <PosterCard
                    image={assetPath(`/gallery/${preset.id}.webp`)}
                    alt={t("imageAlt", { name })}
                    name={name}
                    tag={modes(`${preset.mode}.name`)}
                    headingLevel="h3"
                    footer={
                      <Link
                        href={galleryHref(preset)}
                        aria-label={t("tryAria", { name })}
                        className="mt-2 inline-flex items-center gap-1.5 self-start text-sm font-medium text-accent after:absolute after:inset-0 after:content-[''] hover:text-accent-strong"
                        data-testid="home-gallery-try"
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
    </section>
  );
}
