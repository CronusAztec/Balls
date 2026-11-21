import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import StudioLink from "./StudioLink"; // --- link-warm-up ---
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";
import { modesForFilter } from "@/lib/siteDesign";
import DownloadAppButton from "./DownloadAppButton"; // --- desktop-exe ---
import LivePreview from "./LivePreview";
import { PLANS, formatUsd } from "@/lib/billing/config"; // --- paywall-gate ---
import { assetPath } from "@/lib/site"; // --- studio-first-open ---
import type { ModeId } from "@/lib/physics/types";
import { cardHref } from "@/lib/thumbnails/heroMoments"; // --- card-looks ---

/*
 * --- site-redesign --- The landing hero: the headline (at most eight words), one sentence, the primary action, the way
 * to the modes wall and the Windows app; on the right, from 1024 px, the live mini simulation in its 9:16 frame. A row of
 * mono readouts underlines the claim with numbers instead of adjectives.
 * --- studio-first-open --- Below 1024 px the live frame comes after the text, under the first screen, so a row of four
 * well-known modes' pictures sits right under the buttons there: the first screen of a phone shows pictures, not only text,
 * and each opens its mode in the studio. (Background pictures, like the live frame's, not <img>: the mode cards stay the
 * page's only <img> of each preview, and a hidden row loads none.)
 */

/** --- studio-first-open --- The modes of the phone's picture row: an escape, a battle, a maze and a rhythm machine. */
export const HERO_MODES: readonly ModeId[] = ["classic", "fightLeague", "maze", "songRing"];

export default function Hero() {
  const t = useTranslations("SiteRedesign");
  const modes = useTranslations("Modes"); // --- studio-first-open --- (server-side: the picture row's names)
  const desktop = useTranslations("DesktopLink"); // --- desktop-exe --- (server-side: the button's labels as props)
  const billing = useTranslations("Billing"); // --- paywall-gate --- (server-side: the line under the call to action)
  const locale = useLocale();
  const count = modesForFilter("all").length;
  return (
    <section className="border-b border-line" aria-labelledby="hero-title">
      <div className="site-container grid items-center gap-12 py-12 sm:py-16 lg:grid-cols-[minmax(0,1fr)_270px] lg:gap-20 lg:py-20 xl:gap-28">
        <div className="min-w-0">
          <div className="eyebrow text-ink-3">{t("hero.eyebrow")}</div>
          <h1 id="hero-title" className="mt-5 max-w-[17ch] text-2xl font-bold text-ink sm:text-3xl lg:text-4xl">
            {t("hero.title")}
          </h1>
          <p className="mt-6 max-w-[46ch] text-base text-ink-2 sm:text-lg">{t("hero.sub", { count })}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <StudioLink className={buttonClass({ variant: "primary", size: "md" })} data-track="cta_click" data-track-id="hero_studio">
              {t("nav.openStudio")}
              <IconArrowRight size={18} />
            </StudioLink>
            {/* --- site-nav --- the way to the wall, for every visitor (it used to show only inside the Windows app). Second, so a
                phone keeps it on the first row beside the primary action and the hero grows by nothing. */}
            <a href="#modes" className={buttonClass({ variant: "ghost", size: "md" })}>
              {t("hero.seeModes")}
            </a>
            <DownloadAppButton label={desktop("heroButton")} note={desktop("heroNote")} />
          </div>
          {/* --- studio-first-open --- below 1024 px: four modes' pictures, each a way into the studio with that mode */}
          <ul className="mt-6 grid max-w-md grid-cols-4 gap-2 sm:gap-3 lg:hidden" data-testid="hero-modes">
            {HERO_MODES.map((id) => {
              const name = modes(`${id}.name`);
              return (
                <li key={id} className="min-w-0">
                  <Link href={cardHref(id) /* --- card-looks --- the look its picture shows */} className="group block rounded-lg" aria-label={t("hero.previewOpen", { mode: name })}>
                    <span aria-hidden="true" className="block aspect-square rounded-lg border border-line bg-surface-2 bg-cover bg-center transition-colors duration-150 group-hover:border-line-strong" style={{ backgroundImage: `url("${assetPath(`/modes/${id}.webp`)}")` }} />
                    <span className="mt-1.5 block text-xs leading-tight text-ink-2 group-hover:text-ink">{name}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
          {/* --- paywall-gate --- what is free and what Pro costs, under the call to action */}
          <p className="mt-4 max-w-[46ch] text-sm text-ink-3" data-testid="hero-pricing">
            {billing("landing.line", { price: formatUsd(PLANS.monthly.usd, locale) })}{" "}
            {/* --- site-nav --- (on a touch screen the link's target is 44 px high: the padding is taken back by the margin, so the line keeps its height) */}
            <Link href="/pricing" className="font-medium text-accent hover:text-accent-strong [@media(pointer:coarse)]:-my-3 [@media(pointer:coarse)]:inline-block [@media(pointer:coarse)]:py-3" data-track="cta_click" data-track-id="hero_pricing">
              {billing("landing.link")}
            </Link>
          </p>
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
