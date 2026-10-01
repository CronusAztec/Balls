import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";
import { modesForFilter } from "@/lib/siteDesign";
import DownloadAppButton from "./DownloadAppButton"; // --- desktop-exe ---
import LivePreview from "./LivePreview";

/*
 * --- site-redesign --- The landing hero: the headline (at most eight words), one sentence, the primary action and the
 * Windows app; on the right, from 1024 px, the live mini simulation in its 9:16 frame. A row of mono readouts underlines
 * the claim with numbers instead of adjectives.
 */
export default function Hero() {
  const t = useTranslations("SiteRedesign");
  const count = modesForFilter("all").length;
  return (
    <section className="border-b border-line" aria-labelledby="hero-title">
      <div className="site-container grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_270px] lg:gap-20 lg:py-20 xl:gap-28">
        <div className="min-w-0">
          <p className="eyebrow text-ink-3">{t("hero.eyebrow")}</p>
          <h1 id="hero-title" className="mt-5 max-w-[17ch] text-2xl font-bold text-ink sm:text-3xl lg:text-4xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-[46ch] text-base text-ink-2 sm:text-lg">{t("hero.sub", { count })}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/simulator" className={buttonClass({ variant: "primary", size: "md" })}>
              {t("nav.openStudio")}
              <IconArrowRight size={18} />
            </Link>
            <DownloadAppButton
              fallback={
                <a href="#modes" className={buttonClass({ variant: "secondary", size: "md" })}>
                  {t("hero.seeModes")}
                </a>
              }
            />
          </div>
          <dl className="mt-12 grid max-w-md grid-cols-3 gap-6 border-t border-line pt-5">
            <div>
              <dt className="eyebrow text-ink-3">{t("hero.statModes")}</dt>
              <dd className="num mt-1 text-lg text-ink">{count}</dd>
            </div>
            <div>
              <dt className="eyebrow text-ink-3">{t("hero.statExport")}</dt>
              <dd className="num mt-1 text-lg text-ink">1080×1920</dd>
            </div>
            <div>
              <dt className="eyebrow text-ink-3">{t("hero.statPrice")}</dt>
              <dd className="num mt-1 text-lg text-ink">{t("hero.statPriceValue")}</dd>
            </div>
          </dl>
        </div>
        <LivePreview />
      </div>
    </section>
  );
}
