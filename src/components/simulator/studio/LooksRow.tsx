"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale } from "next-intl";
import type { Locale } from "@/i18n/routing";
import type { ModeId } from "@/lib/physics/types";
import type { SimulatorSettings } from "@/lib/settings";
import { activeLook, lookPatch, lookRow } from "@/lib/studioLooks";
import Chip from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";

/*
 * --- studio-looks --- The Looks row at the top of the studio's Mode block: Plain (the page's start look), the look the mode
 * card's picture shows, the mode's gallery presets and its daily challenge's look (src/content/looks.ts, read by
 * lib/studioLooks.ts). A chip puts its look on through the panel's own update path, so Undo takes it back; the chip of the look
 * the page shows is pressed, and none is once the visitor changes one of the fields the row sets. On a narrow panel the row
 * scrolls sideways like the modes wall's chips, a fade on the right saying there are more.
 */
export default function LooksRow({ mode, settings, update, label, disabled = false }: { mode: ModeId; settings: SimulatorSettings; update: (patch: Partial<SimulatorSettings>) => void; label: string; disabled?: boolean }) {
  const locale = useLocale() as Locale;
  const row = useMemo(() => lookRow(mode), [mode]);
  const active = activeLook(row, settings);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState(false);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () => setFade(el.scrollWidth - el.clientWidth - el.scrollLeft > 4);
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener("scroll", measure);
      observer?.disconnect();
    };
  }, [row, locale]);
  // ... and the pressed chip is in view in its row (a look far along the row, put on by a card, a link or Undo)
  useEffect(() => {
    const el = scrollerRef.current;
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !chip) return;
    const box = chip.getBoundingClientRect();
    const frame = el.getBoundingClientRect();
    if (box.left < frame.left || box.right > frame.right - 16) el.scrollLeft += box.left - frame.left - (frame.width - box.width) / 2;
  }, [active]);
  if (row.looks.length < 2) return null;
  return (
    <div data-testid="studio-looks" data-look-active={active ?? ""}>
      <h3 id="studio-looks-title" className="eyebrow mb-2 text-ink-3">
        {label}
      </h3>
      <div
        ref={scrollerRef}
        role="group"
        aria-labelledby="studio-looks-title"
        className={cx("-mx-1 flex gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", fade && "[mask-image:linear-gradient(to_right,#000_calc(100%_-_2.5rem),transparent)]")}
      >
        {row.looks.map((look) => (
          <Chip
            key={look.id}
            pressed={active === look.id}
            disabled={disabled}
            onClick={() => {
              const patch = lookPatch(row, look, settings);
              if (Object.keys(patch).length > 0) update(patch);
            }}
            data-look={look.id}
            className="shrink-0 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {look.name[locale] ?? look.name.en}
          </Chip>
        ))}
      </div>
    </div>
  );
}
