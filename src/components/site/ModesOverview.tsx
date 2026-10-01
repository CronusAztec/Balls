"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { MODE_CATEGORY_IDS, modesInCategory } from "@/lib/modes";
import { assetPath } from "@/lib/site";

const cardClass =
  "bg-slate-900/40 backdrop-blur-sm border border-slate-800 rounded-3xl overflow-hidden flex flex-col cursor-pointer hover:border-cyan-500/30 hover:bg-slate-900/60 transition-all duration-300 group shadow-sm hover:shadow-cyan-500/5 hover:-translate-y-1";

/** Heading key (Headings namespace) of each mode family. */
const CATEGORY_HEADINGS = { escape: "modesEscape", rhythm: "modesRhythm", battle: "modesBattle" /* --- odd-string-battle --- */, journey: "modesJourney" /* --- gerald-journey --- */ } as const;

/**
 * Mode cards, grouped under a heading per family (escape modes, rhythm modes – see lib/modes.ts). On the
 * simulator page a click dispatches a DOM event the simulator listens to (so the mode switches in place);
 * elsewhere the card links to the simulator.
 */
export default function ModesOverview({ interactive = false }: { interactive?: boolean }) {
  const t = useTranslations("Modes");
  const headings = useTranslations("Headings");
  const groups = MODE_CATEGORY_IDS.map((category) => ({ category, modes: modesInCategory(category).filter((m) => MODE_IDS.includes(m)) })).filter((g) => g.modes.length > 0);

  const inner = (id: ModeId) => (
    <>
      <div className="relative w-full aspect-video bg-slate-800/50 flex items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={assetPath(`/modes/${id}.webp`)} alt={t("previewAlt", { name: t(`${id}.name`) }) /* --- review fix (site-static) --- localised alt text */} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
      </div>
      <div className="p-6 flex flex-col gap-2">
        <h3 className="text-xl font-black text-white group-hover:text-cyan-400 transition-colors tracking-tight">{t(`${id}.name`)}</h3>
        <p className="text-sm text-slate-400 leading-relaxed font-medium">{t(`${id}.description`)}</p>
      </div>
    </>
  );

  return (
    <section id="modes" className="w-full max-w-6xl mx-auto mt-12 px-4 scroll-mt-16">
      <h2 className="text-3xl font-black text-white mb-10 text-center tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">{headings("modes")}</h2>
      {groups.map(({ category, modes }) => (
        <div key={category} className="mb-12 last:mb-0">
          <h3 className="text-sm font-bold uppercase tracking-[0.2em] text-cyan-400 mb-5 text-center">{headings(CATEGORY_HEADINGS[category])}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {modes.map((id) =>
              interactive ? (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  className={cardClass}
                  onClick={() => window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: id }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: id }));
                    }
                  }}
                >
                  {inner(id)}
                </div>
              ) : (
                <Link key={id} href={`/simulator?mode=${id}`} className={cardClass}>
                  {inner(id)}
                </Link>
              ),
            )}
          </div>
        </div>
      ))}
    </section>
  );
}
