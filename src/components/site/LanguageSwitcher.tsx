"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALE_OPTIONS, type Locale } from "@/i18n/routing";

export default function LanguageSwitcher({ isMobileMenu = false }: { isMobileMenu?: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // --- review fix (ui-i18n) --- a disclosure (button + list of buttons), not an ARIA menu: Escape closes it and returns
  // focus to the trigger, and tabbing out of it closes it.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const current = LOCALE_OPTIONS.find((o) => o.code === locale) || LOCALE_OPTIONS[0];

  const switchTo = (code: Locale) => {
    setOpen(false);
    if (code === locale) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace({ pathname: (pathname + search) as any, params: params as Record<string, string> } as never, { locale: code });
  };

  return (
    <div
      className={isMobileMenu ? "w-full" : "relative"}
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        // Only a focus move to another element outside closes it (a click elsewhere is handled by the mousedown listener).
        const next = e.relatedTarget as Node | null;
        if (next && !ref.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        className={`flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 transition-all group cursor-pointer ${isMobileMenu ? "w-full justify-between" : "min-w-[120px]"}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-lg" aria-hidden="true">
            {current.flag}
          </span>
          <span className="text-sm font-medium text-zinc-300 group-hover:text-white transition-colors">{current.label}</span>
        </div>
        <svg className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className={`mt-2 w-full bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-[60] animate-fadeIn ${isMobileMenu ? "relative" : "absolute top-full right-0 min-w-[140px]"}`}>
          <ul id={listId} className="py-1">
            {LOCALE_OPTIONS.map((opt) => (
              <li key={opt.code}>
                <button
                  type="button"
                  lang={opt.code}
                  aria-current={locale === opt.code ? "true" : undefined}
                  onClick={() => switchTo(opt.code)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors cursor-pointer ${locale === opt.code ? "bg-blue-500/10 text-blue-400 font-medium" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"}`}
                >
                  <span className="text-lg" aria-hidden="true">
                    {opt.flag}
                  </span>
                  <span>{opt.label}</span>
                  {locale === opt.code && (
                    <svg className="w-4 h-4 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
