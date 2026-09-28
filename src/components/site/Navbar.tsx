"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { SITE_NAME } from "@/lib/site";
import LanguageSwitcher from "./LanguageSwitcher";

export default function Navbar({ backHref, backLabel }: { backHref?: string; backLabel?: string }) {
  const t = useTranslations("Navbar");
  const [open, setOpen] = useState(false);
  return (
    <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <Link href="/" className="group flex items-center gap-2.5 text-xl sm:text-2xl font-extrabold tracking-tight text-slate-50 hover:text-[#93d119] transition-colors" aria-label={t("goHome")}>
          <span className="w-3.5 h-3.5 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 shadow-[0_0_16px_rgba(6,182,212,0.45)] animate-bounce" style={{ animationDuration: "1.4s" }} />
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
          <Link href="/blog" className="hidden sm:inline-flex text-sm text-zinc-400 hover:text-[#93d119] transition-colors font-medium">
            {t("blog")}
          </Link>
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          <button
            type="button"
            className="sm:hidden flex flex-col items-center justify-center w-9 h-9 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? t("closeMenu") : t("openMenu")}
            aria-expanded={open}
          >
            <span className="block w-5 h-0.5 bg-zinc-300 rounded-full transition-all duration-300 ease-in-out" style={{ transform: open ? "translateY(3px) rotate(45deg)" : "none" }} />
            <span className="block w-5 h-0.5 bg-zinc-300 rounded-full transition-all duration-300 ease-in-out mt-1" style={{ opacity: open ? 0 : 1 }} />
            <span className="block w-5 h-0.5 bg-zinc-300 rounded-full transition-all duration-300 ease-in-out mt-1" style={{ transform: open ? "translateY(-5px) rotate(-45deg)" : "none" }} />
          </button>
        </div>
      </div>
      <div className="sm:hidden overflow-hidden transition-all duration-300 ease-in-out" style={{ maxHeight: open ? "300px" : "0px", opacity: open ? 1 : 0 }}>
        <nav className="flex flex-col gap-1 px-4 pb-4 pt-1 border-t border-zinc-800">
          <Link href="/simulator" className="px-3 py-2 text-sm text-zinc-300 hover:text-[#93d119] transition-colors font-medium" onClick={() => setOpen(false)}>
            {t("simulator")}
          </Link>
          <Link href="/blog" className="px-3 py-2 text-sm text-zinc-300 hover:text-[#93d119] transition-colors font-medium" onClick={() => setOpen(false)}>
            {t("blog")}
          </Link>
          <div className="px-3 py-2">
            <LanguageSwitcher isMobileMenu />
          </div>
        </nav>
      </div>
    </header>
  );
}
