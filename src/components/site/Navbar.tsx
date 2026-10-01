"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";
import LanguageSwitcher from "./LanguageSwitcher";
import { buttonClass } from "@/components/ui/Button";
import IconButton from "@/components/ui/IconButton";
import { IconArrowLeft, IconArrowRight, IconClose, IconMenu } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The header of every page: a 56 px bar with the wordmark, the four destinations (Studio, Gallery,
 * the Windows app, About), the language switcher and the one primary action, "Open the studio". On the studio itself the
 * action is left out and a compact back link leads home – the studio's own strip sits on its stage. Below 768 px the links
 * and the switcher move into a sheet under the bar, behind the menu button: a disclosure that is inert while closed (out
 * of the tab order and the accessibility tree), right after its button in the tab order, and closed again by Escape.
 */

export default function Navbar({ variant = "default" }: { variant?: "default" | "studio" }) {
  const t = useTranslations("SiteRedesign");
  const nav = useTranslations("Navbar");
  const gallery = useTranslations("Gallery"); // --- daily-gallery ---
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const studio = variant === "studio";
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Escape closes the open menu, and returns the focus to the menu button when it was inside the menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = !!menuRef.current?.contains(document.activeElement);
      setMenuOpen(false);
      if (inside) toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const links = [
    { href: "/simulator", label: t("nav.studio") },
    { href: "/gallery", label: gallery("navLabel") },
    { href: "/download", label: t("nav.windowsApp") } /* --- desktop-exe --- */,
    { href: "/about", label: t("nav.about") },
  ];
  const isCurrent = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-line bg-bg">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-1.5 focus:text-sm focus:font-medium focus:text-accent-ink">
        {t("nav.skip")}
      </a>
      <div className={cx("flex h-full items-center gap-6", studio ? "px-3 sm:px-4" : "site-container")}>
        <div className="flex min-w-0 items-center gap-1">
          {studio && (
            <Link href="/" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-ink-2 hover:bg-surface-2 hover:text-ink [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11" aria-label={nav("goHome")} title={nav("goHome")}>
              <IconArrowLeft size={18} />
            </Link>
          )}
          <Link href="/" className="min-w-0 truncate rounded-sm font-display text-[17px] font-bold tracking-[-0.02em] text-ink" aria-label={studio ? undefined : nav("goHome")}>
            <span>{SITE_NAME}</span>
          </Link>
        </div>

        <nav aria-label={t("nav.primary")} className="hidden h-full items-center md:flex">
          {links.map((link) => {
            const current = isCurrent(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={current ? "page" : undefined}
                className={cx(
                  "relative inline-flex h-full items-center px-3 text-sm font-medium transition-colors duration-150",
                  current ? "text-ink after:absolute after:inset-x-3 after:bottom-[-1px] after:h-px after:bg-accent" : "text-ink-2 hover:text-ink",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <div className="hidden md:block">
            <LanguageSwitcher />
          </div>
          {!studio && (
            <Link href="/simulator" className={buttonClass({ variant: "primary", size: "sm", className: "hidden sm:inline-flex" })}>
              {t("nav.openStudio")}
              <IconArrowRight size={16} />
            </Link>
          )}
          <IconButton
            ref={toggleRef}
            className="md:hidden"
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
              "fixed inset-x-0 bottom-0 top-14 z-40 flex flex-col gap-6 overflow-y-auto bg-bg p-4 transition-[opacity,transform] duration-200 ease-out md:hidden",
              menuOpen ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0",
            )}
          >
            <nav aria-label={t("nav.primary")} className="flex flex-col">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isCurrent(link.href) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                  className={cx("flex h-12 items-center border-b border-line text-base font-medium", isCurrent(link.href) ? "text-ink" : "text-ink-2 hover:text-ink")}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
            <LanguageSwitcher isMobileMenu />
            {!studio && (
              <Link href="/simulator" onClick={() => setMenuOpen(false)} className={buttonClass({ variant: "primary", size: "md", block: true })}>
                {t("nav.openStudio")}
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
