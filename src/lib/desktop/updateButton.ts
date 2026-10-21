import { UPDATE_MANUAL_NONE, type UpdateStatus } from "./contract";

/*
 * --- manual-update --- What the Windows app's top bar update control shows for the updater's status (desktop/src/updater.ts):
 * Check for updates, Checking…, the download's percent, Restart and update (never while a clip renders or is cut, nor while the
 * page's own fast export, recording or batch runs: the update then installs when the app quits), the result of a check, and
 * the Download page when the check failed or this build cannot update itself (the portable EXE, a development run). Pure, so
 * tests/desktopUpdateButton.test.ts reads every state.
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
  /** A clip renders, encodes or is being cut, or the page makes a video of its own (pageMakesVideo): no restart now. */
  rendering?: boolean;
  /** A manual check just answered "none" (checkFoundNothing; the "latest version" note shows for UPDATE_LATEST_NOTE_MS). */
  justChecked?: boolean;
  /** A click was sent and its answer has not come back yet (a second click must not start a second check). */
  asking?: boolean;
}

/**
 * --- manual-update --- Whether the page itself is making a video: its fast export, Record video or its batch (the render
 * queue renders through the batch too). None of them is a queue job, and a restart now would lose it, so Restart and update
 * waits for them like it waits for a queue job (DesktopSection's `rendering`). Find Simulation and the engine loading lose
 * nothing and do not count.
 */
export function pageMakesVideo(page: { recording: boolean; fastExport: { status: string }; batchRun: { status: string } }): boolean {
  return page.recording || page.fastExport.status === "running" || page.batchRun.status === "running" || page.batchRun.status === "stopping";
}

/**
 * Whether a status earns "You have the latest version": the "none" a manual check ends in, which the updater marks with
 * UPDATE_MANUAL_NONE (desktop/src/updater.ts), whichever control asked (the top bar's button, the Help menu, the GPU tab).
 * Never a bare change from "checking" to "none": the quiet schedule's checks pass through "checking" too, and a failed one is
 * put back to the "none" it found, so that change proves nothing about who asked or how it went.
 */
export function checkFoundNothing(status: UpdateStatus | null | undefined): boolean {
  return status?.state === "none" && status.message === UPDATE_MANUAL_NONE;
}

/**
 * --- manual-update --- Whether the status the page just got is a manual check's answer arriving now: a marked "none"
 * (checkFoundNothing) after a status that was not one. The updater keeps that mark until the next check, maybe hours later
 * (the whole session with auto-update off), so the first status the page reads (`previous` null: the mount, a reload, a
 * change of language) is an old answer and never says "latest" again. A new check always passes through "checking" first.
 */
export function manualCheckAnswered(previous: UpdateStatus | null | undefined, next: UpdateStatus | null | undefined): boolean {
  return !!previous && !checkFoundNothing(previous) && checkFoundNothing(next);
}

/**
 * A button that cannot be clicked for now keeps its focus: aria-disabled, never the native `disabled` (which drops a
 * keyboard user's focus to the page). That is a check asked for, under way or downloading, and Restart and update waiting
 * for a render: the download can end while a keyboard user waits on the button.
 */
export function updateButtonBusy(m: UpdateButtonModel, asking = false): boolean {
  return !m.enabled && (asking || m.kind === "checking" || m.kind === "downloading" || m.kind === "install");
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
