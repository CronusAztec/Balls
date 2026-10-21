import { UPDATE_MANUAL_NONE, type UpdateStatus } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- Auto-update from the downloads repository (electron-updater's generic provider reads latest.yml at
 * https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download – the address electron-builder wrote into the app's app-update.yml, see
 * desktop/electron-builder.config.cjs – downloads the new installer in the background and installs it when the app quits;
 * versions before 1.1.0 read GitHub Releases instead). It runs only in an
 * installed build; the portable EXE cannot replace itself, so it only links the download. Offline, or
 * whatever goes wrong, the status says "error" in the Help menu / GPU panel and the app carries on – an update check
 * never throws into the app. --- manual-update --- The "Update automatically" preference drives the quiet schedule only:
 * off, nothing checks by itself, but a manual check (the top bar's update button, the Help menu, the GPU panel) still finds
 * the update and downloads it, so it always ends in "ready" and Restart and update.
 */

/** --- desktop-autorelease --- The scheduled checks: 8 s after launch (the window is up, the page has loaded), then every 4 hours. */
export const UPDATE_INITIAL_DELAY_MS = 8000;
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** --- desktop-autorelease --- The states a quiet (scheduled) check leaves alone: work under way, or an update waiting to install. */
const QUIET_SKIP: ReadonlySet<UpdateStatus["state"]> = new Set(["checking", "available", "downloading", "ready"]);
/** --- manual-update --- The states a manual check leaves alone too: the download is under way, or done (Restart and update is next). */
const MANUAL_SKIP: ReadonlySet<UpdateStatus["state"]> = new Set(["available", "downloading", "ready"]);

export interface UpdaterTimers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  setInterval: (fn: () => void, ms: number) => unknown;
  clearInterval: (handle: unknown) => void;
}

export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  logger: unknown;
  on(event: string, listener: (...args: never[]) => void): unknown;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(): void;
}

export interface UpdaterOptions {
  /** Whether this run may update at all (false: the smoke run). */
  enabled: boolean;
  packaged: boolean;
  portable: boolean;
  /** --- manual-update --- The "Update automatically" preference (absent: on). Off, start() schedules nothing, manual checks still work. */
  autoUpdate?: () => boolean;
  online: () => boolean;
  log: (message: string) => void;
  emit: (status: UpdateStatus) => void;
}

export class UpdateController {
  private current: UpdateStatus = { state: "idle", version: null, progress: null, message: null };
  // --- desktop-autorelease --- the schedule start() set up (stop() clears it)
  private timers: UpdaterTimers | null = null;
  private firstTimer: unknown = null;
  private intervalTimer: unknown = null;
  // --- desktop-autorelease --- the status a quiet check found, while it runs (its failure restores it instead of "error")
  private quietBefore: UpdateStatus | null = null;
  // --- manual-update --- the check under way (one at a time) and whether it is still a quiet one
  private running: Promise<UpdateStatus> | null = null;
  private runningQuiet = false;
  // --- manual-update --- the status a quiet check found when the download it started is still running: electron-updater
  // resolves checkForUpdates() before the download ends, so a failed download's "error" comes after the check is over
  private downloadQuietBefore: UpdateStatus | null = null;

  constructor(private readonly updater: UpdaterLike | null, private readonly options: UpdaterOptions) {
    if (!this.active) {
      this.set({ state: "disabled", version: null, progress: null, message: options.portable ? "portable" : options.packaged ? "off" : "development build" });
      return;
    }
    const u = updater as UpdaterLike;
    u.autoDownload = true;
    u.autoInstallOnAppQuit = true;
    u.logger = null;
    u.on("checking-for-update", () => this.set({ state: "checking", version: null, progress: null, message: null }));
    u.on("update-available", (info: { version?: string }) => this.set({ state: "available", version: info?.version ?? null, progress: 0, message: null }));
    u.on("update-not-available", () => this.set({ state: "none", version: null, progress: null, message: null }));
    u.on("download-progress", (p: { percent?: number }) => this.set({ ...this.current, state: "downloading", progress: Math.max(0, Math.min(1, (p?.percent ?? 0) / 100)) }));
    u.on("update-downloaded", (info: { version?: string }) => {
      this.downloadQuietBefore = null;
      this.set({ state: "ready", version: info?.version ?? this.current.version, progress: 1, message: null });
    });
    u.on("error", (err: Error) => {
      options.log(`update error: ${err?.message ?? String(err)}`);
      // --- desktop-autorelease --- electron-updater also emits a failed check as "error": a quiet check's stays in the log
      if (this.quietBefore) return;
      // --- manual-update --- so does the download a quiet check started: the status goes back to what that check found, and
      // the next scheduled check tries again (no "Update check failed" on every tab for work nobody asked for)
      const before = this.downloadQuietBefore;
      this.downloadQuietBefore = null;
      if (before && (this.current.state === "available" || this.current.state === "downloading")) return this.set(before);
      this.set({ state: "error", version: null, progress: null, message: err?.message ?? "update failed" });
    });
  }

  /** Whether this build can update itself (an installed build, not the portable EXE, not a development run or the smoke run). */
  get active(): boolean {
    return !!this.updater && this.options.enabled && this.options.packaged && !this.options.portable;
  }

  /** --- manual-update --- The "Update automatically" preference as it is now. */
  private get auto(): boolean {
    return this.options.autoUpdate?.() ?? true;
  }

  get status(): UpdateStatus {
    return this.current;
  }

  private set(status: UpdateStatus) {
    this.current = status;
    this.options.emit(status);
  }

  /**
   * --- desktop-autorelease --- The scheduled checks: one `initialDelayMs` after the call, then one every `intervalMs` – quiet
   * ones (see check()). Nothing happens for an inactive controller (portable, development build, the smoke run), with
   * auto-update off (--- manual-update --- main.ts starts it when the user turns it on and stops it when they turn it off) or
   * when it is already started. The download runs in the background (autoDownload); the page shows a banner and the
   * main process one notification when it is ready; it installs on the user's click or when the app quits.
   */
  start(timers: UpdaterTimers = globalThis as unknown as UpdaterTimers, delays = { initialDelayMs: UPDATE_INITIAL_DELAY_MS, intervalMs: UPDATE_INTERVAL_MS }): void {
    if (!this.active || !this.auto || this.timers) return;
    this.timers = timers;
    const run = () => void this.check({ quiet: true });
    this.firstTimer = timers.setTimeout(() => {
      this.firstTimer = null;
      run();
    }, delays.initialDelayMs);
    this.intervalTimer = timers.setInterval(run, delays.intervalMs);
  }

  /** --- desktop-autorelease --- Clears the schedule (safe twice, and before start()). */
  stop(): void {
    const timers = this.timers;
    if (!timers) return;
    if (this.firstTimer !== null) timers.clearTimeout(this.firstTimer);
    if (this.intervalTimer !== null) timers.clearInterval(this.intervalTimer);
    this.firstTimer = null;
    this.intervalTimer = null;
    this.timers = null;
  }

  /**
   * Looks for an update; offline or failing, it reports and returns – never throws. --- desktop-autorelease --- A quiet check
   * (the schedule's) does not disturb: while a check or a download is under way, or once an update is downloaded (it installs
   * on the next restart; asking again would only fetch the same files and flicker the banner), it returns the status as it is,
   * and offline or failing it only logs and leaves the status as it found it (no "error" in the GPU panel for a check nobody
   * asked for – electron-updater's own "error" event included). A manual check (the top bar's button, the Help menu, the GPU
   * panel) says what happened. --- manual-update --- One check at a time: a second click, or the menu while the schedule's check
   * runs, waits for the check under way (which then reports like a manual one), and a manual check during a download or once
   * the update is downloaded returns the status as it is. A manual check downloads what it finds, auto-update on or off, and one
   * that finds nothing ends in "none" with the message UPDATE_MANUAL_NONE, so the page says "latest" for the menu's check too.
   * The download a quiet check started fails quietly as well (electron-updater reports it after the check has returned).
   */
  async check(options: { quiet?: boolean } = {}): Promise<UpdateStatus> {
    if (!this.active) return this.current;
    const quiet = options.quiet === true;
    if (this.running) {
      if (quiet) return this.current;
      this.runningQuiet = false;
      this.quietBefore = null;
      return this.running;
    }
    // --- manual-update --- asked by hand during the schedule's download: the user waits for it now, so its failure is said
    if (!quiet) this.downloadQuietBefore = null;
    if ((quiet ? QUIET_SKIP : MANUAL_SKIP).has(this.current.state)) return this.current;
    this.runningQuiet = quiet;
    const run = this.run().finally(() => {
      this.running = null;
      this.runningQuiet = false;
    });
    this.running = run;
    return run;
  }

  /** --- manual-update --- One check (check() makes sure there is never a second one at the same time). */
  private async run(): Promise<UpdateStatus> {
    if (!this.options.online()) {
      if (this.runningQuiet) this.options.log("update check skipped: offline");
      else this.set({ state: "error", version: null, progress: null, message: "offline" });
      return this.current;
    }
    // --- manual-update --- what a quiet check puts back is never a manual check's answer: it would say "latest" again
    const before = this.current.state === "none" && this.current.message === UPDATE_MANUAL_NONE ? { ...this.current, message: null } : this.current;
    if (this.runningQuiet) this.quietBefore = before;
    try {
      await (this.updater as UpdaterLike).checkForUpdates();
      // --- manual-update --- a quiet check that found an update leaves its download running: a failure of it is quiet too
      if (this.runningQuiet && (this.current.state === "available" || this.current.state === "downloading")) this.downloadQuietBefore = before;
      // --- manual-update --- a manual check that found nothing says so (the top bar, whichever control or menu asked)
      else if (!this.runningQuiet && this.current.state === "none") this.set({ ...this.current, message: UPDATE_MANUAL_NONE });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log(`update check failed: ${message}`);
      if (!this.runningQuiet) this.set({ state: "error", version: null, progress: null, message });
      else if (this.current !== before) this.set(before); // "checking" (electron-updater's event) back to what it was
    } finally {
      this.quietBefore = null;
    }
    return this.current;
  }

  install(): void {
    if (this.active && this.current.state === "ready") (this.updater as UpdaterLike).quitAndInstall();
  }
}
