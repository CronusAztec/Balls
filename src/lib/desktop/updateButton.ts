import type { UpdateStatus } from "./contract";

/*
 * --- manual-update --- What the Windows app's top bar update control shows for the updater's status (desktop/src/updater.ts):
 * Check for updates, Checking…, the download's percent, Restart and update (never while a clip renders or is cut: the update
 * then installs when the app quits), the result of a check, and the Download page when the check failed or this build cannot
 * update itself (the portable EXE, a development run). Pure, so tests/desktopUpdateButton.test.ts reads every state.
 */

/** How long "You have the latest version" stays beside the button after a check found nothing. */
export const UPDATE_LATEST_NOTE_MS = 6000;

export type UpdateButtonKind = "check" | "checking" | "downloading" | "install" | "retry" | "unsupported";
export type UpdateButtonNote = "latest" | "offline" | "failed" | "portable" | "devBuild" | "waitRender";

export interface UpdateButtonModel {
  /** The button: check (or check again), busy (checking, downloading), Restart and update, Try again, or the Download page link. */
  kind: UpdateButtonKind;
  /** Whether a click does something now. */
  enabled: boolean;
  /** The download in percent (0 to 100) while it runs. */
  progress: number | null;
  /** The short text beside the button. */
  note: UpdateButtonNote | null;
  /** Whether the Download page link goes with it (after an error; for a build that cannot update itself it is the control). */
  downloadLink: boolean;
}

export interface UpdateButtonContext {
  /** A clip renders, encodes or is being cut: no restart now. */
  rendering?: boolean;
  /** A check just ended with "none" (the "latest version" note shows for UPDATE_LATEST_NOTE_MS). */
  justChecked?: boolean;
  /** A click was sent and its answer has not come back yet (a second click must not start a second check). */
  asking?: boolean;
}

export function updateButtonModel(status: UpdateStatus | null, { rendering = false, justChecked = false, asking = false }: UpdateButtonContext = {}): UpdateButtonModel {
  const base: UpdateButtonModel = { kind: "check", enabled: !asking, progress: null, note: null, downloadLink: false };
  if (!status) return base;
  switch (status.state) {
    case "disabled":
      return { ...base, kind: "unsupported", enabled: true, note: status.message === "portable" ? "portable" : "devBuild", downloadLink: true };
    case "checking":
      return { ...base, kind: "checking", enabled: false };
    case "available":
    case "downloading":
      return { ...base, kind: "downloading", enabled: false, progress: Math.round(Math.max(0, Math.min(1, status.progress ?? 0)) * 100) };
    case "ready":
      return { ...base, kind: "install", enabled: !rendering && !asking, note: rendering ? "waitRender" : null };
    case "error":
      return { ...base, kind: "retry", note: status.message === "offline" ? "offline" : "failed", downloadLink: true };
    case "none":
      return { ...base, note: justChecked ? "latest" : null };
    default:
      return base;
  }
}
