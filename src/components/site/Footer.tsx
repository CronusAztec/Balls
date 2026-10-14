"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LOCALE_OPTIONS } from "@/i18n/routing";
import { SITE_NAME } from "@/lib/site";
import { BUILD_COMMIT, BUILD_COMMIT_DATE, buildLabel } from "@/lib/buildInfo"; // --- build-identity ---
import { LEGAL_NAME } from "@/lib/operator"; // --- build-identity --- the imprint line (empty until the owner sets NEXT_PUBLIC_LEGAL_NAME)
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
  const desktop = useTranslations("DesktopLink"); // --- desktop-exe --- (a small namespace: every page hands it to the client)
  const locale = useLocale();
  const pathname = usePathname();
  const mod = useModifierKey();

  const product = [
    { href: "/simulator", label: s("nav.studio") },
    { href: "/gallery", label: gallery("navLabel") },
    { href: "/download", label: desktop("navLabel") } /* --- desktop-exe --- */,
    { href: "/pricing", label: t("pricing") } /* --- paywall-gate --- */,
    { href: "/tiktok-ball-videos", label: t("tiktok") },
    { href: "/about", label: t("about") },
    { href: "/feedback", label: t("feedback") },
    { href: "/changelog", label: t("changelog") } /* --- build-identity --- */,
    { href: "/press", label: t("press") } /* --- build-identity --- */,
  ];
  const legal = [
    { href: "/privacy", label: t("privacy") },
    { href: "/terms", label: t("terms") },
    { href: "/disclaimer", label: t("disclaimer") },
  ];
  const familyLabel = (id: string) => (FAMILY_HEADINGS[id] ? headings(FAMILY_HEADINGS[id]) : s.has(`families.${id}`) ? s(`families.${id}`) : id);
  const linkClass = "text-sm text-ink-2 transition-colors duration-150 hover:text-ink [@media(pointer:coarse)]:py-1.5"; // --- perf-pass --- 17 px high links get a 29 px target on touch screens
  // --- build-identity --- the stamp's tooltip: the full commit and its date (just the commit when no date is known, "local build" without git)
  const stampTip = BUILD_COMMIT ? (BUILD_COMMIT_DATE ? t("buildTip", { commit: BUILD_COMMIT, date: BUILD_COMMIT_DATE }) : BUILD_COMMIT) : t("buildTipDev");

  return (
    <footer className="border-t border-line bg-bg">
      <nav aria-label={t("navLabel")} className="site-container grid grid-cols-2 gap-x-6 gap-y-10 py-12 md:grid-cols-4">
        <div>
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
        </div>
        <div>
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
        </div>
        <div>
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
        </div>
        <div>
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
        </div>
      </nav>
      <div className="border-t border-line">
        <div className="site-container flex flex-col gap-3 py-6 text-xs text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p>
              {/* --- review fix (site-static) --- the name, never a host: the copyright line names no URL */}
              © {new Date().getFullYear()} {SITE_NAME}
            </p>
            {/* --- build-identity --- who runs the site: nothing while NEXT_PUBLIC_LEGAL_NAME is empty */}
            {LEGAL_NAME && <p data-testid="footer-imprint">{t("operatedBy", { name: LEGAL_NAME })}</p>}
            {/* --- build-identity --- the build this page was loaded from: release, commit, commit date. Its own element (the © line
                stays as it is), the full commit and date in the tooltip, a link to what changed. /version.json says what is live. */}
            <p>
              <Link
                href="/changelog"
                data-testid="build-stamp"
                title={stampTip}
                className="num transition-colors duration-150 hover:text-ink"
              >
                {buildLabel()}
              </Link>
            </p>
          </div>
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
