"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Navbar({ backHref, backLabel }: { backHref?: string; backLabel?: string }) {
  const t = useTranslations("Navbar");
  const gallery = useTranslations("Gallery"); // --- daily-gallery ---
  const desktop = useTranslations("DesktopLink"); // --- desktop-exe --- (a small namespace: every page hands it to the client)
  const [open, setOpen] = useState(false);
  // --- review fix (ui-i18n) --- the collapsed mobile menu is inert (out of the tab order and the accessibility tree);
  // Escape closes the open menu and returns focus to the hamburger when it was inside the menu.
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const inside = !!menuRef.current?.contains(document.activeElement);
      setOpen(false);
      if (inside) toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="group flex items-center gap-2.5 text-xl sm:text-2xl font-extrabold tracking-tight text-slate-50 hover:text-[#93d119] transition-colors" aria-label={t("goHome")}>
          <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 shadow-[0_0_16px_rgba(6,182,212,0.45)] motion-safe:animate-bounce" style={{ animationDuration: "1.4s" }} />
          {SITE_NAME}
        </Link>
        <div className="flex items-center gap-3">
          {backHref && (
            <Link href={backHref} className="text-sm text-zinc-400 hover:text-white transition-colors">
              {backLabel ?? t("back")}
            </Link>
          )}
          <Link href="/simulator" className="hidden sm:inline-flex text-sm text-zinc-400 hover:text-[#93d119] transition-colors font-medium">
            {t("simulator")}
          </Link>
          {/* --- daily-gallery --- */}
          <Link href="/gallery" className="hidden sm:inline-flex text-sm text-zinc-400 hover:text-[#93d119] transition-colors font-medium">
            {gallery("navLabel")}
          </Link>
          {/* --- desktop-exe --- */}
          <Link href="/download" className="hidden md:inline-flex text-sm text-zinc-400 hover:text-[#93d119] transition-colors font-medium">
            {desktop("navLabel")}
          </Link>
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <button
            ref={toggleRef}
            type="button"
            className="sm:hidden flex flex-col items-center justify-center w-9 h-9 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? t("closeMenu") : t("openMenu")}
            aria-expanded={open}
            aria-controls={menuId}
          >
            <span className="block w-5 h-0.5 bg-zinc-300 rounded-full transition-all duration-300 ease-in-out" style={{ transform: open ? "translateY(3px) rotate(45deg)" : "none" }} />
            <span className="block w-5 h-0.5 bg-zinc-300 rounded-full transition-all duration-300 ease-in-out mt-1" style={{ opacity: open ? 0 : 1 }} />
            <span className="block w-5 h-0.5 bg-zinc-300 rounded-full transition-all duration-300 ease-in-out mt-1" style={{ transform: open ? "translateY(-5px) rotate(-45deg)" : "none" }} />
          </button>
        </div>
      </div>
      <div ref={menuRef} id={menuId} data-testid="mobile-menu" inert={!open} className="sm:hidden overflow-hidden transition-all duration-300 ease-in-out" style={{ maxHeight: open ? "300px" : "0px", opacity: open ? 1 : 0 }}>
        <nav className="flex flex-col gap-1 px-4 pb-4 pt-1 border-t border-zinc-800">
          <Link href="/simulator" className="px-3 py-2 text-sm text-zinc-300 hover:text-[#93d119] transition-colors font-medium" onClick={() => setOpen(false)}>
            {t("simulator")}
          </Link>
          {/* --- daily-gallery --- */}
          <Link href="/gallery" className="px-3 py-2 text-sm text-zinc-300 hover:text-[#93d119] transition-colors font-medium" onClick={() => setOpen(false)}>
            {gallery("navLabel")}
          </Link>
          {/* --- desktop-exe --- */}
          <Link href="/download" className="px-3 py-2 text-sm text-zinc-300 hover:text-[#93d119] transition-colors font-medium" onClick={() => setOpen(false)}>
            {desktop("navLabel")}
          </Link>
          <div className="px-3 py-2">
            <LanguageSwitcher isMobileMenu />
          </div>
        </nav>
      </div>
    </header>
  );
}
