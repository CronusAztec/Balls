"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname, useWarmUp } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";
import { pageBefore, visitPage } from "@/lib/siteTrail"; // --- site-nav ---
import LanguageSwitcher from "./LanguageSwitcher";
import { buttonClass } from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { IconArrowLeft, IconArrowRight, IconClose, IconMenu, IconUsers } from "@/components/ui/icons";
import { useAccountHint } from "@/lib/account/hint"; // --- user-accounts ---
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The header of every page: a 56 px bar with the wordmark, the destinations, the language switcher
 * and the one primary action, "Open the studio". On the studio itself the action is left out and a compact back link
 * leads back to the modes – the studio's own strip sits on its stage. Below 1024 px the links and the switcher move into
 * a sheet under the bar, behind the menu button: a disclosure that is inert while closed (out of the tab order and the
 * accessibility tree), right after its button in the tab order, and closed again by Escape.
 * --- site-nav --- The destinations are Modes (the wall of the landing page, one tap from every page), Gallery, the
 * Windows app, Pricing, About and the Changelog (in the bar from 1280 px, in the sheet always). The studio has one link,
 * the primary action: on a phone under 390 px it leaves the bar to the wordmark, which never shrinks, and the sheet
 * keeps it. The full bar starts at 1024 px: between 768 and 1023 px its links wrapped and squeezed the wordmark to "J…".
 * While the sheet is open the page behind it is inert and does not scroll, Escape closes it and the focus returns to the
 * menu button. The studio's back arrow goes back in the browser's history when the visitor came from the landing page
 * (they return to the card they left), else it is a link to the wall.
 */

export default function Navbar({ variant = "default" }: { variant?: "default" | "studio" }) {
  const t = useTranslations("SiteRedesign");
  const nav = useTranslations("Navbar");
  const footer = useTranslations("Footer"); // --- site-nav --- the Changelog's name
  const gallery = useTranslations("Gallery"); // --- daily-gallery ---
  const desktop = useTranslations("DesktopLink"); // --- desktop-exe --- (a small namespace: every page hands it to the client)
  const pathname = usePathname();
  const signedInAs = useAccountHint(); // --- user-accounts --- the name of who is signed in (nothing until the page has read its storage)
  const [menuOpen, setMenuOpen] = useState(false);
  const studio = variant === "studio";
  const menuId = useId();
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // --- site-nav --- the open menu owns the screen: Escape closes it and the focus goes back to the menu button, the rest
  // of the page (everything beside the header) is inert and does not scroll under the sheet, and a window widened to the
  // full bar's width closes it (the sheet is hidden there, and a page left inert would be dead)
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    const header = headerRef.current;
    const behind = Array.from(header?.parentElement?.children ?? []).filter((el) => el !== header && el.tagName !== "SCRIPT" && !el.hasAttribute("inert"));
    for (const el of behind) el.setAttribute("inert", "");
    const root = document.documentElement;
    const before = { overflow: root.style.overflow, paddingRight: root.style.paddingRight };
    const scrollbar = window.innerWidth - root.clientWidth;
    // (on the root element alone: with the body locked as well, focusing a control of the sticky header scrolls the page to its top)
    root.style.overflow = "hidden";
    // (a desktop window loses its scrollbar with the scroll: its width is kept, so the bar does not jump)
    if (scrollbar > 0) root.style.paddingRight = `${scrollbar}px`;
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (wide.matches) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      document.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      for (const el of behind) el.removeAttribute("inert");
      root.style.overflow = before.overflow;
      root.style.paddingRight = before.paddingRight;
    };
  }, [menuOpen]);

  // --- site-nav --- every page's header says which page is shown, so the studio's back arrow knows where the visitor came from
  useEffect(() => visitPage(pathname), [pathname]);
  /** The studio's back arrow: back in history to the landing page the visitor came from; any other click follows the link. */
  const goBack = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || pageBefore() !== "/") return;
    e.preventDefault();
    window.history.back();
  };

  const warm = useWarmUp("/simulator"); // --- link-warm-up --- the studio is loaded when a visitor shows intent, not in the background
  // --- site-nav --- `wide` marks a link the bar shows from 1280 px only (the sheet always lists it)
  const links: { href: string; label: string; track: string | null; wide?: boolean }[] = [
    { href: "/#modes", label: t("footer.modes"), track: null },
    { href: "/gallery", label: gallery("navLabel"), track: "nav_gallery" },
    { href: "/download", label: desktop("navLabel"), track: "nav_download" } /* --- desktop-exe --- */,
    { href: "/pricing", label: nav("pricing"), track: "nav_pricing" } /* --- paywall-gate --- */,
    { href: "/about", label: t("nav.about"), track: null },
    { href: "/changelog", label: footer("changelog"), track: null, wide: true },
  ];
  /** On the landing page the wall is on the page: a plain "#modes", so the browser scrolls there and loads nothing. */
  const onLanding = pathname === "/";
  // --- analytics --- the links that lead to a conversion step are counted by the one delegated click listener (lib/analytics/track.ts)
  const tracked = (id: string | null) => (id ? { "data-track": "cta_click", "data-track-id": id } : {});
  const isCurrent = (href: string) => !href.includes("#") && (pathname === href || pathname.startsWith(`${href}/`));
  const accountLabel = signedInAs ?? nav("account"); // --- user-accounts ---

  return (
    <header ref={headerRef} className="sticky top-0 z-40 h-14 border-b border-line bg-bg">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-accent-ink">
        {t("nav.skip")}
      </a>
      <div className={cx("flex h-full items-center gap-3 sm:gap-6", studio ? "px-3 sm:px-4" : "site-container")}>
        <div className="flex shrink-0 items-center gap-1">
          {studio && (
            <Link href="/#modes" onClick={goBack} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" title={nav("back")}>
              <IconArrowLeft size={18} />
              {/* the old header's Back link, by name: the arrow is the label for the eye */}
              <span className="sr-only">{nav("back")}</span>
            </Link>
          )}
          {/* --- site-nav --- the wordmark keeps its width at every screen size (it used to end in an ellipsis under 390 px) */}
          <Link href="/" className="shrink-0 rounded-sm font-display text-[17px] font-bold tracking-[-0.02em] whitespace-nowrap text-ink" title={studio ? undefined : nav("goHome")}>
            <span>{SITE_NAME}</span>
          </Link>
        </div>

        <nav aria-label={t("nav.primary")} className="hidden h-full shrink-0 items-center lg:flex">
          {links.map((link) => {
            const current = isCurrent(link.href);
            const className = cx(
              "relative h-full items-center px-3 text-sm font-medium whitespace-nowrap transition-colors duration-150",
              link.wide ? "hidden xl:inline-flex" : "inline-flex",
              current ? "text-ink after:absolute after:inset-x-3 after:bottom-[-1px] after:h-px after:bg-accent" : "text-ink-2 hover:text-ink",
            );
            return link.href === "/#modes" && onLanding ? (
              <a key={link.href} href="#modes" className={className}>
                {link.label}
              </a>
            ) : (
              <Link key={link.href} href={link.href} aria-current={current ? "page" : undefined} {...tracked(link.track)} className={className}>
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex min-w-0 items-center gap-2">
          {/* --- user-accounts --- the account: its name once signed in, "Account" before */}
          <Link
            href="/account"
            aria-current={isCurrent("/account") ? "page" : undefined}
            title={nav("account")}
            data-testid="navbar-account"
            data-signed-in={signedInAs ? "1" : "0"}
            className={cx("hidden h-8 min-w-0 max-w-[10rem] items-center gap-1.5 rounded-md px-2 text-sm font-medium transition-colors duration-150 hover:bg-surface-2 hover:text-ink lg:inline-flex", isCurrent("/account") ? "text-ink" : "text-ink-2")}
          >
            <IconUsers size={16} className="shrink-0" />
            <span className="truncate">{accountLabel}</span>
          </Link>
          <div className="hidden shrink-0 lg:block">
            <LanguageSwitcher />
          </div>
          {/* --- site-nav --- (max-[389px]: a variant wins over the button's own inline-flex, which a bare "hidden" did not) */}
          {!studio && (
            <Link href="/simulator" className={buttonClass({ variant: "primary", size: "sm", className: "shrink-0 max-[389px]:hidden" })} {...tracked("nav_cta")} {...warm}>
              {t("nav.openStudio")}
              <IconArrowRight size={16} />
            </Link>
          )}
          <IconButton
            ref={toggleRef}
            className="lg:hidden"
            label={menuOpen ? nav("closeMenu") : nav("openMenu")}
            icon={menuOpen ? <IconClose /> : <IconMenu />}
            tooltip="none"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            onClick={() => setMenuOpen((v) => !v)}
          />
          <div
            ref={menuRef}
            id={menuId}
            data-testid="mobile-menu"
            inert={!menuOpen}
            className={cx(
              "fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col gap-6 overflow-y-auto overscroll-contain bg-bg p-4 transition-[opacity,transform] duration-200 ease-out lg:hidden",
              menuOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0",
            )}
          >
            <nav aria-label={t("nav.primary")} className="flex flex-col">
              {links.map((link) => {
                const className = cx("flex h-12 items-center border-b border-line text-base font-medium", isCurrent(link.href) ? "text-ink" : "text-ink-2 hover:text-ink");
                return link.href === "/#modes" && onLanding ? (
                  <a key={link.href} href="#modes" onClick={() => setMenuOpen(false)} className={className}>
                    {link.label}
                  </a>
                ) : (
                  <Link key={link.href} href={link.href} aria-current={isCurrent(link.href) ? "page" : undefined} onClick={() => setMenuOpen(false)} {...tracked(link.track)} className={className}>
                    {link.label}
                  </Link>
                );
              })}
              {/* --- user-accounts --- */}
              <Link
                href="/account"
                aria-current={isCurrent("/account") ? "page" : undefined}
                onClick={() => setMenuOpen(false)}
                className={cx("flex h-12 items-center gap-2 border-b border-line text-base font-medium", isCurrent("/account") ? "text-ink" : "text-ink-2 hover:text-ink")}
              >
                <IconUsers size={18} />
                <span className="truncate">{accountLabel}</span>
              </Link>
            </nav>
            <LanguageSwitcher isMobileMenu />
            {!studio && (
              <Link href="/simulator" onClick={() => setMenuOpen(false)} className={buttonClass({ variant: "primary", size: "md", block: true })} {...tracked("nav_cta")} {...warm}>
                {t("nav.openStudio")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
