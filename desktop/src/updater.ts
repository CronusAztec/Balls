import type { UpdateStatus } from "@/lib/desktop/contract";

/*
 * --- desktop-exe --- Auto-update from GitHub Releases (electron-updater reads latest.yml of the newest release of
 * CronusAztec/Balls, downloads the new installer in the background and installs it when the app quits). It runs only in an
 * installed build with auto-update on; the portable EXE cannot replace itself, so it only links the download. Offline, or
 * whatever goes wrong, the status says "error" in the Help menu / GPU panel and the app carries on – an update check
 * never throws into the app.
 */

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

  /** Looks for an update; offline or failing, it reports and returns – never throws. */
  async check(): Promise<UpdateStatus> {
    if (!this.active) return this.current;
    if (!this.options.online()) {
      this.set({ state: "error", version: null, progress: null, message: "offline" });
      return this.current;
    }
    try {
      await (this.updater as UpdaterLike).checkForUpdates();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.options.log(`update check failed: ${message}`);
      this.set({ state: "error", version: null, progress: null, message });
    }
    return this.current;
  }

  install(): void {
    if (this.active && this.current.state === "ready") (this.updater as UpdaterLike).quitAndInstall();
  }
}
