"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LOCALE_OPTIONS } from "@/i18n/routing";
import { SITE_DOMAIN, SITE_NAME } from "@/lib/site";
import { modeFamilies } from "@/lib/siteDesign";
import InstallAppButton from "@/components/site/InstallAppButton"; // --- pwa ---
import Kbd from "@/components/ui/Kbd";
import { useModifierKey } from "@/components/ui/useModifierKey";
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The footer: four columns – Product, Modes (one link per family, opening its first mode), Legal and
 * Language (this page in the other languages) – then the wordmark line with the keyboard shortcuts.
 */

const FAMILY_HEADINGS: Record<string, string> = { escape: "modesEscape", rhythm: "modesRhythm", battle: "modesBattle", journey: "modesJourney" };

export default function Footer() {
  const t = useTranslations("Footer");
  const s = useTranslations("SiteRedesign");
  const headings = useTranslations("Headings");
  const gallery = useTranslations("Gallery"); // --- daily-gallery ---
  const desktop = useTranslations("Desktop"); // --- desktop-exe ---
  const locale = useLocale();
  const pathname = usePathname();
  const mod = useModifierKey();

  const product = [
    { href: "/simulator", label: s("nav.studio") },
    { href: "/gallery", label: gallery("navLabel") },
    { href: "/download", label: desktop("navLabel") },
    { href: "/tiktok-ball-videos", label: t("tiktok") },
    { href: "/about", label: t("about") },
    { href: "/feedback", label: t("feedback") },
  ];
  const legal = [
    { href: "/privacy", label: t("privacy") },
    { href: "/terms", label: t("terms") },
    { href: "/disclaimer", label: t("disclaimer") },
  ];
  const familyLabel = (id: string) => (FAMILY_HEADINGS[id] ? headings(FAMILY_HEADINGS[id]) : s.has(`families.${id}`) ? s(`families.${id}`) : id);
  const linkClass = "text-sm text-ink-2 transition-colors duration-150 hover:text-ink";

  return (
    <footer className="border-t border-line bg-bg">
      <div className="site-container grid grid-cols-2 gap-x-6 gap-y-10 py-12 md:grid-cols-4">
        <nav aria-label={s("footer.product")}>
          <h2 className="eyebrow text-ink-3">{s("footer.product")}</h2>
          <ul className="mt-4 space-y-3">
            {product.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
          {/* --- pwa --- only while the browser offers to install the site */}
          <InstallAppButton />
        </nav>
        <nav aria-label={s("footer.modes")}>
          <h2 className="eyebrow text-ink-3">{s("footer.modes")}</h2>
          <ul className="mt-4 space-y-3">
            {modeFamilies().map((f) => (
              <li key={f.id}>
                <Link href={`/simulator?mode=${f.modes[0]}`} className={linkClass}>
                  {familyLabel(f.id)}
                </Link>
                <span className="num ml-2 text-xs text-ink-3">{f.modes.length}</span>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={s("footer.legal")}>
          <h2 className="eyebrow text-ink-3">{s("footer.legal")}</h2>
          <ul className="mt-4 space-y-3">
            {legal.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <nav aria-label={s("lang.label")}>
          <h2 className="eyebrow text-ink-3">{s("lang.label")}</h2>
          <ul className="mt-4 space-y-3">
            {LOCALE_OPTIONS.map((opt) => (
              <li key={opt.code}>
                <Link href={pathname} locale={opt.code} lang={opt.code} aria-current={opt.code === locale ? "true" : undefined} className={cx(linkClass, opt.code === locale && "text-ink")}>
                  {opt.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t border-line">
        <div className="site-container flex flex-col gap-3 py-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <p>
            <span className="font-display text-sm font-bold tracking-[-0.02em] text-ink-2">{SITE_NAME}</span>
            <span className="mx-2">·</span>© {new Date().getFullYear()} {SITE_DOMAIN}
          </p>
          <p className="hidden items-center gap-2 sm:flex" aria-label={t("shortcuts")}>
            <span>{t("shortcuts")}</span>
            <Kbd>Space</Kbd>
            <span>{t("pauseResume")}</span>
            <Kbd>R</Kbd>
            <span>{t("restart")}</span>
            <Kbd>{mod} K</Kbd>
            <span>{s("studio.search")}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
