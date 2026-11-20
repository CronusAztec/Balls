"use client";

import { useRef } from "react";
import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import ModesOverview from "@/components/site/ModesOverview";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- site-redesign --- The studio's mode picker: the modes wall (poster cards, family chips) in a dialog, opened from the
 * Mode group and the stage strip. A card switches the mode in place (the select-mode event the simulator listens to) and
 * closes the dialog; the section inside keeps id="modes".
 * --- mode-shelves --- The wall brings its search, sort, Recent row and arrow keys (ModesOverview.tsx, variant "picker"). It
 * says what the dialog focuses on open (the search field, or the current card on a touch screen), and the random pick
 * takes its name from the studio's own "Surprise me".
 */
export default function ModePicker({ current, onClose }: { current: ModeId; onClose: () => void }) {
  const t = useTranslations("SiteRedesign");
  const controls = useTranslations("Controls");
  const focusRef = useRef<HTMLElement | null>(null);
  return (
    <Dialog title={t("studio.modePicker")} closeLabel={t("dialog.close")} onClose={onClose} placement="center" initialFocus={focusRef}>
      <ModesOverview interactive variant="picker" current={current} onPicked={onClose} focusRef={focusRef} surpriseLabel={controls("flSurprise")} />
    </Dialog>
  );
}
