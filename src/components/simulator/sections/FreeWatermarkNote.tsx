"use client";

import { useTranslations } from "next-intl";
import { useEntitlement } from "@/lib/billing/entitlement";
import { requestUnlock } from "@/lib/billing/unlock";
import { SITE_NAME } from "@/lib/site";

/**
 * --- free-watermark --- The line under the stage for a visitor without a Pro licence: the videos made here carry the
 * watermark (while a recording runs: this one does), with "Remove the watermark", which opens the Unlock dialog.
 *
 * Display only – the gate (lib/watermark/seal.ts) seals the decision from the verified licence when a recording or export
 * starts. Always mounted (hidden while the licence is checked and for Pro), so a visitor who deletes it from the page leaves
 * React nothing to trip over.
 */
export default function FreeWatermarkNote({ recording }: { recording: boolean }) {
  const t = useTranslations("Watermark");
  const { status } = useEntitlement();
  const free = status === "free";
  return (
    <p className="text-xs leading-relaxed text-ink-3" data-testid="free-watermark-note" data-recording={recording ? "1" : "0"} hidden={!free} role="note">
      <span>{recording ? t("noteRecording", { siteName: SITE_NAME }) : t("note", { siteName: SITE_NAME })}</span>{" "}
      <button type="button" onClick={() => requestUnlock()} className="cursor-pointer font-medium text-accent hover:text-accent-strong" data-testid="free-watermark-remove">
        {t("remove")}
      </button>
    </p>
  );
}
