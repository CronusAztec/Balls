import type { UpdateStatus } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- Auto-update from the downloads repository (electron-updater's generic provider reads latest.yml at
 * https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download – the address electron-builder wrote into the app's app-update.yml, see
 * desktop/electron-builder.config.cjs – downloads the new installer in the background and installs it when the app quits;
 * versions before 1.1.0 read GitHub Releases instead). It runs only in an
 * installed build with auto-update on; the portable EXE cannot replace itself, so it only links the download. Offline, or
 * whatever goes wrong, the status says "error" in the Help menu / GPU panel and the app carries on – an update check
 * never throws into the app.
 */

/** --- desktop-autorelease --- The scheduled checks: 8 s after launch (the window is up, the page has loaded), then every 4 hours. */
export const UPDATE_INITIAL_DELAY_MS = 8000;
export const UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** --- desktop-autorelease --- The states a quiet (scheduled) check leaves alone: work under way, or an update waiting to install. */
const QUIET_SKIP: ReadonlySet<UpdateStatus["state"]> = new Set(["checking", "available", "downloading", "ready"]);

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
  enabled: boolean;
  packaged: boolean;
  portable: boolean;
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
    u.on("update-downloaded", (info: { version?: string }) => this.set({ state: "ready", version: info?.version ?? this.current.version, progress: 1, message: null }));
    u.on("error", (err: Error) => {
      options.log(`update error: ${err?.message ?? String(err)}`);
      // --- desktop-autorelease --- electron-updater also emits a failed check as "error": a quiet check's stays in the log
      if (this.quietBefore) return;
      this.set({ state: "error", version: null, progress: null, message: err?.message ?? "update failed" });
    });
  }

  get active(): boolean {
    return !!this.updater && this.options.enabled && this.options.packaged && !this.options.portable;
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
   * ones (see check()). Nothing happens for an inactive controller (portable, development build, auto-update off, the smoke
   * run) or when it is already started. The download runs in the background (autoDownload); the page shows a banner and the
   * main process one notification when it is ready; it installs on the user's click or when the app quits.
   */
  start(timers: UpdaterTimers = globalThis as unknown as UpdaterTimers, delays = { initialDelayMs: UPDATE_INITIAL_DELAY_MS, intervalMs: UPDATE_INTERVAL_MS }): void {
    if (!this.active || this.timers) return;
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
   * asked for – electron-updater's own "error" event included). A manual check (the Help menu, the GPU panel) behaves as before.
   */
  async check(options: { quiet?: boolean } = {}): Promise<UpdateStatus> {
    if (!this.active) return this.current;
    const quiet = options.quiet === true;
    if (quiet && QUIET_SKIP.has(this.current.state)) return this.current;
    if (!this.options.online()) {
      if (quiet) this.options.log("update check skipped: offline");
      else this.set({ state: "error", version: null, progress: null, message: "offline" });
      return this.current;
    }
    const before = this.current;
    if (quiet) this.quietBefore = before;
    try {
      await (this.updater as UpdaterLike).checkForUpdates();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log(`update check failed: ${message}`);
      if (!quiet) this.set({ state: "error", version: null, progress: null, message });
      else if (this.current !== before) this.set(before); // "checking" (electron-updater's event) back to what it was
    } finally {
      if (quiet) this.quietBefore = null;
    }
    return this.current;
  }

  install(): void {
    if (this.active && this.current.state === "ready") (this.updater as UpdaterLike).quitAndInstall();
  }
}
