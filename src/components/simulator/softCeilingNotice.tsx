"use client";

import { useLocale, useTranslations } from "next-intl";
import { softCeilingNotes } from "@/lib/physics/softCeilings";
import type { SimulatorSettings } from "@/lib/settings";

/**
 * --- review fix (security-robustness) --- The badge of the soft ceilings (lib/physics/softCeilings.ts): a count the engine
 * runs below what the settings ask for – a link's wc=1000000 – is said under the canvas (never on it, so a recording does
 * not show it), with the typed value and the one that runs.
 */
export function SoftCeilingNotice({ settings }: { settings: Pick<SimulatorSettings, "mode" | "wallCount" | "targetCount" | "spikeCount" | "spikesEnabled"> }) {
  const t = useTranslations();
  const locale = useLocale();
  const notes = softCeilingNotes(settings);
  if (notes.length === 0) return null;
  const format = new Intl.NumberFormat(locale);
  return (
    <div data-testid="soft-ceiling-notice">
      {notes.map((note) => (
        <p key={note.setting} className="text-xs leading-relaxed text-warn" role="status" /* --- site-redesign --- (the studio notes' tokens) */>
          {t("Simulator.softCeiling", { setting: t(`Controls.${note.setting}`), asked: format.format(note.asked), running: format.format(note.running) })}
        </p>
      ))}
    </div>
  );
}
