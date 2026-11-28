"use client";

import { useTranslations } from "next-intl";
import Button, { type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { IconSparkle } from "@/components/ui/icons";
import type { MakeClipKind } from "@/lib/bot/makeClip"; // --- make-clip-start ---

/*
 * --- make-clip --- The "Make me a clip" button of the studio (the Mode block's starter area and the ready screen): one press
 * makes a clip of the mode on the page and opens it (useViralBot.ts makeClip). It says "Making your clip…" while it plans and
 * "Another clip" while the page shows the clip it made, and is off while the page records, renders a batch, races in split
 * screen or plays a daily challenge.
 */

/** What the page tells the studio about "Make me a clip". */
export interface MakeClipProps {
  /** Makes one clip of the page's mode and opens it. */
  onMake: () => void;
  /** A clip is being planned. */
  busy: boolean;
  /** The page shows the clip it made (its seed still pinned): the next press is "Another clip". */
  made: boolean;
  /** Recording, a batch, a split-screen race, a daily challenge or the page still loading: no clip can be made now. */
  disabled: boolean;
  /**
   * --- make-clip-start --- (round two A7) What the press makes (lib/bot/makeClip.ts makeClipKind): a template's clip with its
   * hook, or the mode's start look on a run Find found, which ends on the run's own finale.
   */
  kind: MakeClipKind;
}

export default function MakeClipButton({ make, variant = "primary", size = "md", block = false, className, testId }: { make: MakeClipProps; variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string; testId: string }) {
  const t = useTranslations("SiteRedesign.studio");
  return (
    <Button
      variant={make.made && variant === "primary" ? "secondary" : variant}
      size={size}
      block={block}
      className={className}
      // (E1 review) while it plans the button keeps its focus, so a keyboard or a screen reader stays on it: it is marked
      // disabled and ignores a press instead of being disabled outright
      onClick={make.busy ? undefined : make.onMake}
      disabled={make.disabled}
      aria-disabled={make.busy || undefined}
      aria-busy={make.busy || undefined}
      title={t("makeClipTip")}
      icon={<IconSparkle size={16} className={make.busy ? "animate-pulse" : undefined} />}
      data-testid={testId}
      data-make-state={make.busy ? "busy" : make.made ? "made" : "idle"}
    >
      {make.busy ? t("makeClipBusy") : make.made ? t("makeClipAnother") : t("makeClip")}
    </Button>
  );
}
