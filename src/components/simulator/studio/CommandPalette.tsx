"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import Kbd from "@/components/ui/Kbd";
import { IconChevronRight, IconSearch } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import { paletteMatches, type PaletteEntry } from "@/lib/siteDesign";

/*
 * --- site-redesign --- The studio's command palette (Cmd/Ctrl+K, or the rail's Search item): one field over every group
 * of the panel and every searchable control in them (the panel's SECTION_KEYS and labels, matched by lib/siteDesign.ts).
 * Arrow keys move, Enter opens, Esc closes; the focus stays in the field (aria-activedescendant) and returns to whatever
 * opened the palette. Choosing a control opens its group and focuses it (Controls.tsx).
 */
export default function CommandPalette({ entries, icons, onChoose, onClose }: { entries: readonly PaletteEntry[]; icons: Record<string, ReactNode>; onChoose: (entry: PaletteEntry) => void; onClose: () => void }) {
  const t = useTranslations("SiteRedesign");
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();
  // Best first within each list, the groups above the settings (one heading each).
  const matches = useMemo(() => {
    const ranked = paletteMatches(entries, query);
    return [...ranked.filter((e) => e.kind === "section"), ...ranked.filter((e) => e.kind === "control")];
  }, [entries, query]);
  const current = Math.min(index, Math.max(0, matches.length - 1));

  const choose = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    onChoose(entry);
  };
  const move = (delta: number) => {
    if (!matches.length) return;
    const next = (current + delta + matches.length) % matches.length;
    setIndex(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(matches[current]);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      onClose();
    }
  };

  let lastKind: PaletteEntry["kind"] | null = null;
  return (
    <Dialog title={t("studio.paletteTitle")} hideTitle closeLabel={t("dialog.close")} onClose={onClose} placement="top" initialFocus={inputRef} bodyClassName="flex flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
        <IconSearch size={18} className="text-ink-3" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${id}-list`}
          aria-activedescendant={matches.length ? `${id}-o${current}` : undefined}
          aria-autocomplete="list"
          aria-label={t("studio.paletteTitle")}
          placeholder={t("studio.palettePlaceholder")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          data-no-ring=""
          className="h-full min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-3 outline-none"
          autoComplete="off"
          spellCheck={false}
        />
        <Kbd>Esc</Kbd>
      </div>
      <div ref={listRef} id={`${id}-list`} role="listbox" aria-label={t("studio.paletteTitle")} className="min-h-0 flex-1 overflow-y-auto p-2">
        {matches.length === 0 && <p className="px-3 py-8 text-center text-sm text-ink-3">{t("studio.paletteEmpty", { query })}</p>}
        {matches.map((entry, i) => {
          const header = entry.kind !== lastKind ? (entry.kind === "section" ? t("studio.paletteSections") : t("studio.paletteControls")) : null;
          lastKind = entry.kind;
          const on = i === current;
          return (
            <div key={`${entry.kind}-${entry.section}-${entry.key}`} role="presentation">
              {header && (
                <p role="presentation" className="eyebrow px-3 pb-1 pt-3 text-ink-3">
                  {header}
                </p>
              )}
              <div
                id={`${id}-o${i}`}
                role="option"
                aria-selected={on}
                data-index={i}
                onMouseMove={() => setIndex(i)}
                onClick={() => choose(entry)}
                className={cx("flex h-10 items-center gap-3 rounded-md px-3 text-sm cursor-pointer", on ? "bg-surface-3 text-ink" : "text-ink-2")}
              >
                <span className={cx("inline-flex w-5 justify-center", on ? "text-accent" : "text-ink-3")}>{icons[entry.section]}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.kind === "control" && <span className="max-w-[45%] shrink-0 truncate text-xs text-ink-3">{entry.sectionLabel}</span>}
                <IconChevronRight size={16} className={cx("shrink-0", on ? "text-ink-2" : "text-transparent")} />
              </div>
            </div>
          );
        })}
      </div>
      <div className="hidden shrink-0 items-center gap-4 border-t border-line px-4 py-2.5 text-xs text-ink-3 sm:flex">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          {t("studio.paletteMove")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd>
          {t("studio.paletteOpen")}
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          {t("studio.paletteClose")}
        </span>
      </div>
    </Dialog>
  );
}
