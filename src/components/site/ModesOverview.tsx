"use client";

import { useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ModeId } from "@/lib/physics/types";
import type { ModeCategory } from "@/lib/modes";
import { modeFamilies } from "@/lib/siteDesign";
import { assetPath } from "@/lib/site";
import Chip from "@/components/ui/Chip";
import { cx } from "@/components/ui/cx";
import PosterCard from "./PosterCard";

/** Heading key (Headings namespace) of each mode family; a family without one falls back to its chip label. */
const CATEGORY_HEADINGS = { escape: "modesEscape", rhythm: "modesRhythm", battle: "modesBattle" /* --- odd-string-battle --- */, journey: "modesJourney" /* --- gerald-journey --- */ } as const;
const HEADING_KEYS: Readonly<Record<string, string>> = CATEGORY_HEADINGS;

/*
 * The modes wall. --- site-redesign --- Every mode as a poster card under its family's heading (escape, rhythm, battle and
 * journey modes – see MODE_CATEGORY_IDS in lib/modes.ts), with filter chips for the families (derived from the mode
 * registry, lib/siteDesign.ts). On the landing page a card links to the studio with that mode; inside the studio's mode
 * picker (`interactive`) a card dispatches the DOM event the simulator listens to, so the mode switches in place, and
 * `onPicked` closes the picker. The section keeps id="modes" either way.
 */
export default function ModesOverview({ interactive = false, current, onPicked, variant = "page" }: { interactive?: boolean; current?: ModeId; onPicked?: () => void; variant?: "page" | "picker" }) {
  const t = useTranslations("Modes");
  const headings = useTranslations("Headings");
  const s = useTranslations("SiteRedesign");
  const [filter, setFilter] = useState<ModeCategory | "all">("all");
  const families = modeFamilies();
  const total = families.reduce((n, f) => n + f.modes.length, 0);
  const shown = filter === "all" ? families : families.filter((f) => f.id === filter);
  const chipLabel = (id: string) => (s.has(`families.${id}`) ? s(`families.${id}`) : id.charAt(0).toUpperCase() + id.slice(1));
  const heading = (id: string) => (HEADING_KEYS[id] ? headings(HEADING_KEYS[id]) : chipLabel(id));

  const pick = (id: ModeId) => {
    window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: id }));
    onPicked?.();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>, id: ModeId) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(id);
    }
  };

  const card = (id: ModeId, family: ModeCategory) => {
    const name = t(`${id}.name`);
    const content = (
      <PosterCard
        image={assetPath(`/modes/${id}.webp`)}
        alt={t("previewAlt", { name }) /* --- review fix (ui-i18n) --- */}
        name={name}
        tag={chipLabel(family)}
        description={t(`${id}.description`)}
        current={current === id}
        badge={current === id ? <span className="eyebrow rounded-sm bg-accent px-1.5 py-0.5 text-accent-ink">{s("modesWall.current")}</span> : undefined}
      />
    );
    const cardClass = "group block min-w-0 rounded-xl cursor-pointer";
    return interactive ? (
      <div key={id} role="button" tabIndex={0} aria-pressed={current === id} className={cardClass} onClick={() => pick(id)} onKeyDown={(e) => onKey(e, id)}>
        {content}
      </div>
    ) : (
      <Link key={id} href={`/simulator?mode=${id}`} className={cardClass}>
        {content}
      </Link>
    );
  };

  const chips = (
    <div role="group" aria-label={s("modesWall.filterLabel")} className="flex flex-wrap gap-2">
      <Chip pressed={filter === "all"} onClick={() => setFilter("all")} count={total}>
        {s("modesWall.all")}
      </Chip>
      {families.map((f) => (
        <Chip key={f.id} pressed={filter === f.id} onClick={() => setFilter(f.id)} count={f.modes.length}>
          {chipLabel(f.id)}
        </Chip>
      ))}
    </div>
  );

  // One grid for the whole wall: a family with a full row of modes or more spans every column, a small family (one or two
  // modes) only as many as it has, so small families share a row. Each family is a subgrid of it (its heading on top).
  const wallGrid = cx("grid gap-x-4 gap-y-12", variant === "picker" ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5");

  return (
    <section id="modes" aria-labelledby={variant === "page" ? "modes-title" : undefined} aria-label={variant === "picker" ? s("studio.modePicker") : undefined} className={variant === "page" ? "site-container scroll-mt-20 py-16 sm:py-20" : "p-4 sm:p-6"}>
      {variant === "page" ? (
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="modes-title" className="text-2xl font-bold text-ink">
              {headings("modes")}
            </h2>
            <p className="mt-3 max-w-[58ch] text-md text-ink-2">{s("modesWall.intro", { count: total })}</p>
          </div>
          {chips}
        </div>
      ) : (
        chips
      )}
      <div className={cx(wallGrid, variant === "page" ? "mt-12" : "mt-8")}>
        {shown.map(({ id, modes }) => (
          <div key={id} className="grid grid-cols-subgrid gap-y-0" style={{ gridColumn: modes.length > 2 ? "1 / -1" : `span ${modes.length}` }}>
            <h3 className="col-span-full mb-5 flex items-baseline gap-3 border-b border-line pb-3 text-md font-medium text-ink">
              {heading(id)}
              <span aria-hidden="true" className="num text-xs text-ink-3">
                {modes.length}
              </span>
            </h3>
            <div className="col-span-full grid grid-cols-subgrid gap-y-8">{modes.map((m) => card(m, id))}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
