"use client";

import { useTranslations } from "next-intl";
import { useEntitlement } from "@/lib/billing/entitlement";
import { cx } from "@/components/ui/cx";

/** --- paywall-gate --- A padlock on the kit's 20 px grid (1.5 px strokes in currentColor, decorative). */
export function IconLock({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={cx("shrink-0", className)}>
      <rect x="4.5" y="9" width="11" height="8" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 0 1 6 0V9" />
    </svg>
  );
}

/**
 * --- paywall-gate --- The lock on a video-creating button for a free visitor: a padlock and a "Pro" tag, "Pro feature" as its
 * tooltip and in the button's accessible name. Nothing while the licence is being checked or for a Pro licence, so a Pro
 * user's buttons look – and are named – exactly as before. The button itself stays enabled: pressing it opens the Unlock
 * dialog (the guard, lib/billing/guard.ts).
 *
 * `tone`: "accent" on the quiet buttons, "inherit" on a filled one (the accent fill would swallow an accent tag).
 */
export default function LockBadge({ className, tone = "accent" }: { className?: string; tone?: "accent" | "inherit" }) {
  const t = useTranslations("Billing");
  const { status } = useEntitlement();
  if (status !== "free") return null;
  return (
    <span
      data-pro-lock=""
      title={t("proFeature")}
      className={cx(
        "inline-flex shrink-0 items-center gap-0.5 rounded-sm border px-1 font-mono text-[10px] font-medium uppercase leading-4 tracking-wide",
        tone === "accent" ? "border-accent-dim/60 text-accent" : "border-current text-current opacity-80",
        className,
      )}
    >
      <IconLock size={11} />
      <span aria-hidden="true">{t("proTag")}</span>
      <span className="sr-only">{` – ${t("proFeature")}`}</span>
    </span>
  );
}
