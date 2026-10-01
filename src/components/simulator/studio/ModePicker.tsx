"use client";

import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import ModesOverview from "@/components/site/ModesOverview";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- site-redesign --- The studio's mode picker: the modes wall (poster cards, family chips) in a dialog, opened from the
 * Mode group and the stage strip. A card switches the mode in place (the select-mode event the simulator listens to) and
 * closes the dialog; the section inside keeps id="modes".
 */
export default function ModePicker({ current, onClose }: { current: ModeId; onClose: () => void }) {
  const t = useTranslations("SiteRedesign");
  return (
    <Dialog title={t("studio.modePicker")} closeLabel={t("dialog.close")} onClose={onClose} placement="center">
      <ModesOverview interactive variant="picker" current={current} onPicked={onClose} />
    </Dialog>
  );
}
