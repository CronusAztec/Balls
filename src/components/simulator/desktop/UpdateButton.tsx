"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { DesktopApi, UpdateStatus } from "@/lib/desktop/contract";
import { UPDATE_LATEST_NOTE_MS, manualCheckAnswered, updateButtonBusy, updateButtonModel, type UpdateButtonModel, type UpdateButtonNote } from "@/lib/desktop/updateButton";
import { pageUrl } from "@/lib/site";
import { IconCheck, IconDownload, IconReset, IconRestart, IconWarning } from "@/components/ui/icons";

/*
 * --- manual-update --- The update control in the Desktop group's top bar, on every tab: Check for updates, Checking…, the
 * download's percent, Restart and update (not while a video is being made), "You have the latest version" for a moment after a
 * manual check found nothing (this button's, the Help menu's or the GPU tab's), Try again with the Download page after an
 * error, and for a build that cannot update itself (the portable EXE, a development run) the honest note and the Download page
 * instead of a button that would do nothing. The Download page opens in the system browser like every other web link of the
 * app. The states are lib/desktop/updateButton.ts. A button that cannot be clicked for now (asked, checking, downloading,
 * Restart and update waiting for a render) is aria-disabled and ignores clicks instead of taking the native `disabled`, which
 * would drop a keyboard user's focus to the page, and the note's live region is always there, its text changing, so a screen
 * reader reads the result as it comes.
 */

const base = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";
const LOOK: Record<UpdateButtonModel["kind"], string> = {
  check: `${base} bg-accent/10 border-accent/60 text-accent hover:bg-accent/20`,
  checking: `${base} bg-accent/10 border-accent/40 text-accent aria-disabled:opacity-70`,
  downloading: `${base} bg-accent/10 border-accent/40 text-accent aria-disabled:opacity-70 num`,
  install: `${base} bg-accent border-accent text-accent-ink hover:bg-accent-strong disabled:opacity-40 aria-disabled:opacity-40`,
  retry: `${base} bg-surface-2 border-warn/60 text-ink hover:bg-surface-3`,
  unsupported: `${base} bg-surface-2 border-line-strong text-ink hover:bg-surface-3`,
};
const NOTE_LOOK: Record<UpdateButtonNote, string> = { latest: "text-accent", offline: "text-warn", failed: "text-warn", portable: "text-ink-3", devBuild: "text-ink-3", waitRender: "text-ink-3" };

export interface UpdateButtonViewProps {
  status: UpdateStatus | null;
  rendering?: boolean;
  justChecked?: boolean;
  asking?: boolean;
  /** Whether the wait note shows beside a disabled Restart and update (the update banner shows it already while it is open). */
  waitHint?: boolean;
  downloadUrl: string;
  onCheck: () => void;
  onInstall: () => void;
}

/** The control itself, from the status and what the page knows (pure: the tests render it). */
export function UpdateButtonView({ status, rendering = false, justChecked = false, asking = false, waitHint = true, downloadUrl, onCheck, onInstall }: UpdateButtonViewProps) {
  const t = useTranslations("Desktop");
  const m = updateButtonModel(status, { rendering, justChecked, asking });
  const label = (): string => {
    if (m.kind === "checking") return t("updateButton.checking");
    if (m.kind === "downloading") return t("updateButton.downloading", { progress: m.progress ?? 0 });
    if (m.kind === "install") return t("appRestartUpdate");
    if (m.kind === "retry") return t("updateButton.retry");
    if (m.kind === "unsupported") return t("updateButton.getLatest");
    return t("appCheckUpdates");
  };
  const noteText = (note: UpdateButtonNote): string => {
    if (note === "latest") return t("updateButton.latest");
    if (note === "offline") return t("updateButton.offline");
    if (note === "failed") return t("updateButton.failed");
    if (note === "portable") return t("updateButton.portable");
    if (note === "devBuild") return t("updateButton.devBuild");
    return t("updateWaitRender");
  };
  const note = m.note === "waitRender" && !waitHint ? null : m.note;
  const busy = updateButtonBusy(m, asking);
  const iconSize = 14;
  const icon =
    m.kind === "checking" ? (
      <IconReset size={iconSize} className="motion-safe:animate-spin" />
    ) : m.kind === "install" ? (
      <IconRestart size={iconSize} />
    ) : m.kind === "retry" ? (
      <IconWarning size={iconSize} />
    ) : m.kind === "check" && m.note === "latest" ? (
      <IconCheck size={iconSize} />
    ) : (
      <IconDownload size={iconSize} />
    );
  const readyTitle = status?.state === "ready" ? (rendering ? t("updateWaitRender") : t("update.ready", { version: status.version ?? "", progress: 100 })) : undefined;
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={t("appUpdate")} data-update-state={status?.state ?? "unknown"}>
      {m.kind === "unsupported" ? (
        <a href={downloadUrl} target="_blank" rel="noreferrer" className={LOOK.unsupported} data-testid="desktop-update-button" data-update-kind={m.kind}>
          {icon}
          {label()}
        </a>
      ) : (
        <button
          type="button"
          className={LOOK[m.kind]}
          disabled={!m.enabled && !busy}
          aria-disabled={busy || undefined}
          aria-busy={m.kind === "checking" || m.kind === "downloading" || undefined}
          title={readyTitle}
          onClick={!m.enabled ? undefined : m.kind === "install" ? onInstall : onCheck}
          data-testid="desktop-update-button"
          data-update-kind={m.kind}
        >
          {icon}
          {label()}
        </button>
      )}
      {/* the live region stays mounted, empty without a note: a region inserted with its text already in it is often not read */}
      <span className={note ? `text-xs ${NOTE_LOOK[note]}` : "text-xs"} role="status" aria-live="polite" title={note && status?.state === "error" ? (status.message ?? undefined) : undefined} data-testid="desktop-update-note" data-note={note ?? undefined}>
        {note ? noteText(note) : null}
      </span>
      {m.downloadLink && m.kind !== "unsupported" && (
        <a href={downloadUrl} target="_blank" rel="noreferrer" className="text-xs text-ink-2 underline underline-offset-2 hover:text-ink" data-testid="desktop-update-download">
          {t("updateButton.website")}
        </a>
      )}
    </div>
  );
}

/**
 * The control with its behaviour: a click checks (and the check downloads what it finds, auto-update on or off), the button
 * stays busy until the answer comes back, and "You have the latest version" shows for a moment when a manual check found
 * nothing: this button's, the Help menu's or the GPU tab's, as the updater marks that "none" (checkFoundNothing). The quiet
 * schedule's checks, which pass through "checking" too, and a failed one the updater puts back to "none", never show it.
 * Nor does the marked "none" the page reads when it mounts (manualCheckAnswered): that answer may be hours old.
 */
export default function UpdateButton({ bridge, update, rendering, waitHint }: { bridge: DesktopApi; update: UpdateStatus | null; rendering: boolean; waitHint?: boolean }) {
  const locale = useLocale();
  const [asking, setAsking] = useState(false);
  const [justChecked, setJustChecked] = useState(false);
  // --- manual-update --- the status this button saw last (null until the first one: the one read on mount is not news)
  const seen = useRef<UpdateStatus | null>(null);
  // --- manual-update --- the note for a moment, until it times out or the next status (a new check) comes
  useEffect(() => {
    const previous = seen.current;
    seen.current = update;
    if (!manualCheckAnswered(previous, update)) return;
    setJustChecked(true);
    const timer = setTimeout(() => setJustChecked(false), UPDATE_LATEST_NOTE_MS);
    return () => {
      clearTimeout(timer);
      setJustChecked(false);
    };
  }, [update]);
  const check = () => {
    if (asking) return;
    setAsking(true);
    setJustChecked(false);
    bridge.update
      .check()
      .catch(() => {})
      .finally(() => setAsking(false));
  };
  return <UpdateButtonView status={update} rendering={rendering} justChecked={justChecked} asking={asking} waitHint={waitHint} downloadUrl={pageUrl(locale, "/download")} onCheck={check} onInstall={() => void bridge.update.install()} />;
}
