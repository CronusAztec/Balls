"use client";

import { useTranslations } from "next-intl";
import { useEntitlement } from "@/lib/billing/entitlement";
import { cx } from "@/components/ui/cx";

/** --- free-watermark --- A water drop on the kit's 20 px grid (1.5 px strokes in currentColor, decorative). */
export function IconWatermark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={cx("shrink-0", className)}>
      <path d="M10 3c2.9 3.5 4.75 6.1 4.75 8.5a4.75 4.75 0 0 1-9.5 0C5.25 9.1 7.1 6.5 10 3Z" />
      <path d="M8 12.5a2 2 0 0 0 2 2" />
    </svg>
  );
}

/**
 * --- free-watermark --- The tag on a video-making button (Record Video, the fast export, Render batch, the bot's Render all,
 * the desktop queue) for a visitor without a Pro licence: the video it makes carries the watermark. A drop and "Watermark"
 * (the drop alone with `compact`, in the transport bar), the explanation as its tooltip and in the button's accessible name.
 * Nothing while the licence is being checked or for a Pro licence, so a Pro user's buttons look – and are named – as before.
 *
 * Display only: whether a video is watermarked is sealed by lib/watermark/seal.ts when it starts, from the verified licence –
 * removing this tag (or anything else on the page) changes nothing in the video.
 *
 * `tone`: "accent" on the quiet buttons, "inherit" on a filled one (the accent fill would swallow an accent tag).
 */
export default function WatermarkBadge({ className, tone = "accent", compact = false }: { className?: string; tone?: "accent" | "inherit"; compact?: boolean }) {
  const t = useTranslations("Watermark");
  const { status } = useEntitlement();
  if (status !== "free") return null;
  return (
    <span
      data-watermark-tag=""
      title={t("tagTip")}
      className={cx(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm border px-1 font-mono text-[10px] font-medium uppercase leading-4 tracking-wide",
        tone === "accent" ? "border-accent-dim/60 text-accent" : "border-current text-current opacity-80",
        className,
      )}
    >
      <IconWatermark size={11} />
      {!compact && <span aria-hidden="true">{t("tag")}</span>}
      <span className="sr-only">{` – ${t("tagTip")}`}</span>
    </span>
  );
}
