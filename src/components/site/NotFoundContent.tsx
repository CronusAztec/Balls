import { useTranslations } from "next-intl";
import Navbar from "@/components/site/Navbar";
import Footer from "@/components/site/Footer";
import { Link } from "@/i18n/navigation";
import { buttonClass } from "@/components/ui/Button";
import { IconArrowRight } from "@/components/ui/icons";

/*
 * Shared body of the 404 page (used by app/[locale]/not-found.tsx and the static /404 page). --- site-redesign --- the
 * three rings of the logo with the ball already out through the gaps, the code as a mono eyebrow, the title and the two
 * ways back.
 */
export default function NotFoundContent() {
  const t = useTranslations("NotFound");
  return (
    <div className="flex min-h-screen flex-col bg-bg text-ink">
      <Navbar />
      <main id="content" className="site-container flex flex-1 items-center py-16 sm:py-24">
        <div className="grid w-full items-center gap-12 md:grid-cols-[minmax(0,1fr)_280px]">
          <div className="max-w-[560px]">
            <p className="eyebrow text-ink-3">404</p>
            <h1 className="mt-3 text-2xl font-bold text-ink lg:text-3xl">{t("title")}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{t("description")}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/" className={buttonClass({ variant: "primary", size: "md" })}>
                {t("home")}
              </Link>
              <Link href="/simulator" className={buttonClass({ variant: "secondary", size: "md" })}>
                {t("simulator")}
                <IconArrowRight size={16} />
              </Link>
            </div>
          </div>
          <svg viewBox="0 0 200 200" className="hidden w-full max-w-[280px] text-line-strong md:block" aria-hidden="true" focusable="false">
            <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M 158 100 A 58 58 0 1 1 129 49.8" />
              <path d="M 136 100 A 36 36 0 1 1 118 68.8" transform="rotate(40 100 100)" />
              <path d="M 180 100 A 80 80 0 1 1 140 30.7" transform="rotate(-25 100 100)" />
            </g>
            <circle cx="186" cy="22" r="7" className="fill-accent" />
          </svg>
        </div>
      </main>
      <Footer />
    </div>
  );
}
