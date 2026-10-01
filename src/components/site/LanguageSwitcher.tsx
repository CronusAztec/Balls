"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { LOCALE_OPTIONS, type Locale } from "@/i18n/routing";
import { IconCheck, IconChevronDown, IconGlobe } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

/*
 * Language switcher. --- site-redesign --- A quiet ghost button (globe, language name, chevron) that discloses the list of
 * languages – a disclosure (button + list of buttons), not an ARIA menu: the arrow keys move between them, Escape closes it
 * and returns to the button, tabbing out of it closes it. In the header's mobile sheet the languages are a plain row. The
 * page keeps its query string when the language changes.
 */
export default function LanguageSwitcher({ isMobileMenu = false }: { isMobileMenu?: boolean }) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  const t = useTranslations("SiteRedesign");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    const current = Math.max(0, LOCALE_OPTIONS.findIndex((o) => o.code === locale));
    itemsRef.current[current]?.focus();
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, locale]);

  const current = LOCALE_OPTIONS.find((o) => o.code === locale) || LOCALE_OPTIONS[0];

  const switchTo = (code: Locale) => {
    setOpen(false);
    if (code === locale) return;
    const search = typeof window !== "undefined" ? window.location.search : "";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    router.replace({ pathname: (pathname + search) as any, params: params as Record<string, string> } as never, { locale: code });
  };

  const onMenuKey = (e: KeyboardEvent<HTMLUListElement>) => {
    const items = itemsRef.current.filter(Boolean) as HTMLButtonElement[];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  };

  if (isMobileMenu) {
    return (
      <div role="group" aria-label={t("lang.label")} className="space-y-2">
        <p className="eyebrow text-ink-3">{t("lang.label")}</p>
        <div className="grid grid-cols-3 gap-2">
          {LOCALE_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.code}
              lang={opt.code}
              aria-pressed={locale === opt.code}
              onClick={() => switchTo(opt.code)}
              className={cx("h-11 rounded-md border text-sm font-medium cursor-pointer", locale === opt.code ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:text-ink")}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative"
      ref={ref}
      onBlur={(e) => {
        // Focus moving to another element outside closes it (a click elsewhere is handled by the mousedown listener).
        const next = e.relatedTarget as Node | null;
        if (next && !ref.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={`${t("lang.label")}: ${current.label}`}
        className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink cursor-pointer"
      >
        <IconGlobe size={16} />
        <span className="hidden lg:inline">{current.label}</span>
        <span className="num text-xs uppercase lg:hidden">{current.code}</span>
        <IconChevronDown size={14} className={cx("transition-transform duration-150", open && "rotate-180")} />
      </button>
      {open && (
        <ul id={listId} aria-label={t("lang.label")} onKeyDown={onMenuKey} className="absolute right-0 top-full z-50 mt-2 min-w-44 rounded-xl border border-line bg-surface-2 p-1 shadow-[var(--shadow-float)] animate-fadeIn">
          {LOCALE_OPTIONS.map((opt, i) => (
            <li key={opt.code}>
              <button
                type="button"
                ref={(el) => {
                  itemsRef.current[i] = el;
                }}
                lang={opt.code}
                aria-current={locale === opt.code ? "true" : undefined}
                onClick={() => switchTo(opt.code)}
                className={cx("flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm cursor-pointer", locale === opt.code ? "text-ink" : "text-ink-2 hover:bg-surface-3 hover:text-ink")}
              >
                <span className="num w-6 text-xs uppercase text-ink-3">{opt.code}</span>
                <span>{opt.label}</span>
                {locale === opt.code && <IconCheck size={16} className="ml-auto text-accent" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
