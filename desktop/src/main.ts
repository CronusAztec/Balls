import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, net, protocol, safeStorage, screen, session, shell, type MenuItemConstructorOptions } from "electron";
import fs from "fs/promises";
import { existsSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Store from "electron-store";
import electronUpdater from "electron-updater";
import ffmpegStatic from "ffmpeg-static";
import { DESKTOP_EVENTS, IPC, type BenchmarkResult, type DesktopInfo, type DesktopPrefs, type EncoderProbe, type GpuStatus, type MediaKind, type MenuAction, type PickedFile, type VideoCodec } from "@/lib/desktop/contract";
import { appLocations } from "./paths";
import { APP_HOST, APP_ORIGIN, APP_SCHEME, contentType, isAppUrl, isExternalWebUrl, popupMayNavigate, resolveSiteRequest, startUrl, windowOpenAction } from "./protocol";
import { gpuStatusOf, gpuSwitches, preferredVendor } from "./gpu";
import { DEFAULT_PREFS, DEFAULT_WINDOW, resolvePrefs, restoreWindowState, sanitizePrefs, type WindowState } from "./prefs";
import { Logger } from "./logger";
import { JsonFileStore } from "./journal";
import { Library } from "./library";
import { RenderSaver } from "./render";
import { probeEncoders } from "./ffmpeg/encoders";
import { buildBenchmarkArgs } from "./ffmpeg/args";
import { bundledFfmpegPath, ffmpegRunner, resolveFfmpeg, runFfmpeg } from "./ffmpeg/run";
import { ModelManager } from "./models/manager";
import { LocalModelRunner, checkLocalAi, type LlamaModuleLike } from "./ai/local";
import { SecretBox } from "./ai/secrets";
import { AiService, DEFAULT_CLOUD, type CloudSettings } from "./ai/service";
import { UpdateController } from "./updater";
import { MENU, MENU_LABELS, menuLanguage } from "./menu";
import { MAX_PICKED_BYTES, dialogFilters, filesInArgv, mediaKindOf, mimeOf } from "./media";
import { registerHandlers, type HandlerTable } from "./handlers";
// --- desktop-ai-fix --- net.fetch for every main-process request, node-llama-cpp's console lines in main.log, the AI status panel
import os from "os";
import type { AiDiagnoseOptions } from "@/lib/desktop/contract";
import { describeError } from "@/lib/desktop/errors";
import { networkDeps } from "./net";
import { mirrorConsole } from "./consoleMirror";
import { runAiDiagnostics, type DiagnosticsDeps } from "./ai/diagnostics";

/*
 * --- desktop-exe --- The Windows app's main process: the whole simulator (the site's static export on app://), GPU video
 * rendering (GPU switches, WebCodecs on the GPU in the page, ffmpeg with NVENC / AMF / QSV here), the render queue's disk
 * side, the AI studio's models and a native shell – window state, menu, tray, shortcuts, dialogs, single instance,
 * auto-update. `electron . --smoke` loads the simulator, checks the bridge end to end, prints the GPU status and exits.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.argv.includes("--smoke");
const SAFE_MODE = process.argv.includes("--safe-mode") || process.env.JBL_SAFE_MODE === "1";
const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || null;
if (portableDir) app.setPath("userData", path.join(portableDir, "JumpingBallsLive-data"));
if (SMOKE && process.env.JBL_SMOKE_DATA) app.setPath("userData", process.env.JBL_SMOKE_DATA);

// Before the app is ready: the app:// scheme's privileges (a secure, standard origin: WebCodecs, fetch, storage) and the GPU switches.
protocol.registerSchemesAsPrivileged([{ scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
const SWITCHES = gpuSwitches(process.platform, SAFE_MODE);
for (const [name, value] of SWITCHES) app.commandLine.appendSwitch(name, value);
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
if (SAFE_MODE) app.disableHardwareAcceleration();

/** --- desktop-ai-fix --- How long quitting waits for the local model to stop and unload. */
const QUIT_UNLOAD_MS = 8000;

const gotLock = SMOKE || app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  start();
}

function start() {
  const locations = appLocations({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, appPath: app.getAppPath(), userData: app.getPath("userData"), portableDir });
  const logger = new Logger(locations.logsDir);
  logger.info(`start ${app.getName()} ${app.getVersion()} electron ${process.versions.electron} site ${locations.siteRoot}${SAFE_MODE ? " (safe mode)" : ""}`);
  process.on("uncaughtException", (err) => logger.error(`uncaught: ${err.stack ?? err.message}`));
  process.on("unhandledRejection", (err) => logger.error(`unhandled rejection: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
  mirrorConsole(console, (level, message) => logger.write(level, message)); // --- desktop-ai-fix --- node-llama-cpp's backend choice and fallbacks

  const store = new Store<{ prefs: DesktopPrefs; window: WindowState; cloud: CloudSettings }>({ name: "config", defaults: { prefs: DEFAULT_PREFS, window: DEFAULT_WINDOW, cloud: DEFAULT_CLOUD } });
  const prefs = (): DesktopPrefs => resolvePrefs(store.get("prefs"));
  const setPrefs = (patch: Partial<DesktopPrefs>) => store.set("prefs", { ...prefs(), ...sanitizePrefs(patch) });

  let win: BrowserWindow | null = null;
  let tray: Tray | null = null;
  let quitting = false;
  let trayNoticeShown = false;
  const send = (channel: string, payload: unknown) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const defaultOutputFolder = () => path.join(app.getPath("videos"), "JumpingBallsLive");
  const outputFolder = () => prefs().outputFolder || defaultOutputFolder();

  /* ---------------------------------------------------------------- GPU and ffmpeg */
  const bundledFfmpeg = bundledFfmpegPath(ffmpegStatic as unknown as string | null);
  const ffmpeg = () => resolveFfmpeg(prefs().ffmpegPath, bundledFfmpeg);
  let gpuCache: GpuStatus | null = null;
  const gpuStatus = async (): Promise<GpuStatus> => {
    const info = await app.getGPUInfo("complete").catch(() => app.getGPUInfo("basic").catch(() => ({})));
    gpuCache = gpuStatusOf(info, app.getGPUFeatureStatus() as unknown as Record<string, string>, SWITCHES, SAFE_MODE);
    return gpuCache;
  };
  let probeCache: Promise<EncoderProbe> | null = null;
  const probe = (force = false): Promise<EncoderProbe> => {
    if (!probeCache || force) {
      probeCache = (async () => {
        const bin = ffmpeg();
        if (!bin) return { ffmpeg: null, encoders: [], chosen: { h264: null, hevc: null, av1: null }, error: "ffmpeg not found" };
        const vendor = preferredVendor((gpuCache ?? (await gpuStatus())).devices);
        const result = await probeEncoders(ffmpegRunner(bin.path), bin, vendor, prefs().encoderOverride);
        logger.info(`encoders: ${JSON.stringify(result.chosen)}${result.error ? ` (${result.error})` : ""}`);
        return result;
      })();
    }
    return probeCache;
  };
  const benchmark = async (): Promise<BenchmarkResult[]> => {
    const bin = ffmpeg();
    if (!bin) return [];
    const p = await probe();
    const picks = new Map<string, VideoCodec>();
    for (const codec of ["h264", "hevc", "av1"] as VideoCodec[]) {
      const chosen = p.chosen[codec];
      if (chosen) picks.set(chosen, codec);
    }
    if (p.encoders.some((e) => e.id === "libx264" && e.listed)) picks.set("libx264", "h264");
    const results: BenchmarkResult[] = [];
    const seconds = 5;
    for (const [encoder, codec] of picks) {
      const t0 = Date.now();
      const r = await runFfmpeg(bin.path, buildBenchmarkArgs(encoder, codec, seconds), { timeoutMs: 120000 }).catch((err: Error) => ({ code: 1, stdout: "", stderr: err.message }));
      const wall = Math.max(0.001, (Date.now() - t0) / 1000);
      const fps = (seconds * 60) / wall;
      results.push({ encoder, codec, fps: Math.round(fps * 10) / 10, realtime: Math.round((fps / 60) * 100) / 100, ok: r.code === 0, ...(r.code === 0 ? {} : { error: r.stderr.slice(-300) }) });
    }
    return results;
  };

  /* ---------------------------------------------------------------- services */
  const library = new Library(locations.libraryFile, locations.thumbsDir);
  const journal = new JsonFileStore(locations.journalFile);
  const saver = new RenderSaver({
    outputFolder,
    ffmpeg: () => ffmpeg()?.path ?? null,
    probe: () => probe(),
    run: runFfmpeg,
    library,
    emit: (e) => send(DESKTOP_EVENTS.renderProgress, e),
    log: logger.info,
  });
  // --- desktop-ai-fix --- every download and cloud call over Electron's net.fetch (the system proxy and certificate store)
  const http = networkDeps((input, init) => net.fetch(input, init), globalThis.fetch, logger.warn);
  const models = new ModelManager({ dir: locations.modelsDir, onProgress: (e) => send(DESKTOP_EVENTS.modelProgress, e), fetch: http.modelFetch });
  const local = new LocalModelRunner(() => import("node-llama-cpp") as unknown as Promise<LlamaModuleLike>, logger.info);
  const secrets = new SecretBox(safeStorage);
  const cloudSettings = (): CloudSettings => ({ ...DEFAULT_CLOUD, ...(store.get("cloud") ?? {}) });
  const ai = new AiService({
    prefs,
    setPrefs,
    cloud: cloudSettings,
    setCloud: (cloud) => store.set("cloud", cloud),
    secrets,
    local,
    modelPath: (id) => models.readyPath(id),
    emitToken: (requestId, text) => send(DESKTOP_EVENTS.aiToken, { requestId, text }),
    // --- desktop-ai-fix ---
    fetch: http.aiFetch,
    anthropic: http.anthropic,
    log: (level, message) => logger.write(level, message),
    readyModels: async () => (await models.list(prefs().localModel)).filter((m) => m.state === "ready").map((m) => m.id),
  });
  // --- desktop-ai-fix --- a 1.0.2 install whose download was never "used": the ready model is selected
  void ai.ensureSelectedModel().catch((err: unknown) => logger.warn(`selecting a ready model: ${describeError(err)}`));
  const updater = new UpdateController(electronUpdater.autoUpdater as unknown as ConstructorParameters<typeof UpdateController>[0], {
    enabled: prefs().autoUpdate && !SMOKE,
    packaged: app.isPackaged,
    portable: portableDir !== null,
    online: () => net.isOnline(),
    log: logger.warn,
    emit: (s) => send(DESKTOP_EVENTS.update, s),
  });

  const readPicked = async (file: string): Promise<PickedFile> => {
    const size = statSync(file).size;
    if (size > MAX_PICKED_BYTES) throw new Error("The file is larger than 1 GB");
    const data = new Uint8Array(await fs.readFile(file));
    return { name: path.basename(file), path: file, mimeType: mimeOf(file), kind: mediaKindOf(file), data };
  };

  const info = (): DesktopInfo => ({
    appName: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    platform: process.platform,
    arch: process.arch,
    packaged: app.isPackaged,
    dataDir: locations.dataDir,
    logFile: logger.file,
    smoke: SMOKE,
  });

  /* ---------------------------------------------------------------- --- desktop-ai-fix --- the AI status panel */
  const homeDir = os.homedir();
  const withoutHome = (text: string) => (homeDir && homeDir.length > 2 ? text.split(homeDir).join("~") : text);
  const gbText = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  const diagnosticsDeps: DiagnosticsDeps = {
    prefs,
    cloud: () => {
      const c = cloudSettings();
      return { provider: c.provider, baseUrl: c.baseUrl, model: c.model };
    },
    key: () => secrets.open(cloudSettings().keySealed),
    encryption: () => secrets.available,
    modelEntry: async (id) => (await models.list(id)).find((m) => m.id === id) ?? null,
    redact: withoutHome,
    runtime: (gpu, start) => local.runtime(gpu, start),
    probe: (modelPath, gpu) => local.probe(modelPath, gpu),
    localStatus: () => local.status(),
    lastErrors: () => ai.lastFailures(),
    netFetch: (input, init) => net.fetch(input as string, init),
    nodeFetch: globalThis.fetch,
    appFetch: http.aiFetch,
    facts: () => ({
      app: { name: app.getName(), version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, packaged: app.isPackaged, portable: portableDir !== null, safeMode: SAFE_MODE, dataDir: withoutHome(locations.dataDir) },
      os: { platform: process.platform, arch: process.arch, type: os.type(), release: os.release(), version: typeof os.version === "function" ? os.version() : "", cpus: `${os.cpus().length} × ${os.cpus()[0]?.model ?? "?"}`, ram: `${gbText(os.freemem())} free of ${gbText(os.totalmem())}` },
    }),
    gpu: async () => (await gpuStatus()).devices.map((d) => ({ name: d.name, vendor: d.vendor, driver: d.driver, active: d.active })),
    logTail: async () => {
      const handle = await fs.open(logger.file, "r").catch(() => null);
      if (!handle) return [];
      try {
        const { size } = await handle.stat();
        const length = Math.min(size, 64 * 1024);
        const buf = Buffer.alloc(length);
        await handle.read(buf, 0, length, size - length);
        return buf.toString("utf8").split(/\r?\n/).filter(Boolean).slice(-200).map(withoutHome);
      } finally {
        await handle.close();
      }
    },
  };

  /* ---------------------------------------------------------------- IPC */
  const table: HandlerTable = {
    [IPC.info]: () => info(),
    [IPC.log]: (level, message) => logger.write(level as "info" | "warn" | "error", `[page] ${String(message)}`),
    [IPC.openLogs]: async () => void (await shell.openPath(locations.logsDir)),
    [IPC.prefsGet]: () => prefs(),
    [IPC.prefsSet]: (patch) => {
      const before = prefs();
      setPrefs(patch as Partial<DesktopPrefs>);
      const after = prefs();
      if (before.ffmpegPath !== after.ffmpegPath || before.encoderOverride !== after.encoderOverride) probeCache = null;
      if (before.localModel !== after.localModel || before.aiGpu !== after.aiGpu) void local.unload();
      return after;
    },
    [IPC.gpuStatus]: () => gpuStatus(),
    [IPC.gpuProbe]: (force) => probe(force === true),
    [IPC.gpuBenchmark]: () => benchmark(),
    [IPC.pickFolder]: async () => {
      const r = win ? await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], defaultPath: outputFolder() }) : { canceled: true, filePaths: [] };
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    [IPC.pickMedia]: async (kind) => {
      if (!win) return null;
      const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: dialogFilters(kind as MediaKind) });
      if (r.canceled || !r.filePaths[0]) return null;
      return readPicked(r.filePaths[0]);
    },
    [IPC.renderSave]: (request) => saver.save(request as Parameters<RenderSaver["save"]>[0]),
    [IPC.renderCancel]: (jobId) => saver.cancel(jobId as string),
    [IPC.journalLoad]: () => journal.read(),
    [IPC.journalSave]: (value) => journal.write(value),
    [IPC.libraryList]: () => library.list(),
    [IPC.libraryRemove]: (id, deleteFile) => library.remove(id as string, deleteFile as boolean, (file) => shell.trashItem(file)),
    [IPC.libraryReveal]: async (id) => {
      const item = await library.get(id as string);
      if (item) shell.showItemInFolder(item.path);
    },
    [IPC.libraryOpen]: async (id) => {
      const item = await library.get(id as string);
      if (item) await shell.openPath(item.path);
    },
    [IPC.libraryRead]: async (id) => {
      const item = await library.get(id as string);
      if (!item) throw new Error("Not in the library");
      return readPicked(item.path);
    },
    [IPC.libraryOpenFolder]: async () => {
      await fs.mkdir(outputFolder(), { recursive: true });
      await shell.openPath(outputFolder());
    },
    [IPC.aiStatus]: () => ai.status(),
    [IPC.aiModels]: () => models.list(prefs().localModel),
    [IPC.aiModelDownload]: (id) => {
      void models.download(id as string).then(
        // --- desktop-ai-fix --- a finished download is selected when the selected model is not ready (Run stayed disabled in 1.0.2)
        () => {
          logger.info(`model ${String(id)} downloaded`);
          void ai.ensureSelectedModel(String(id)).catch((err: unknown) => logger.warn(`selecting ${String(id)}: ${describeError(err)}`));
        },
        (err: Error) => logger.warn(`model ${String(id)}: ${describeError(err)}`),
      );
      return models.list(prefs().localModel);
    },
    [IPC.aiModelCancel]: (id) => models.cancel(id as string),
    [IPC.aiModelImport]: async () => {
      if (!win) return models.list(prefs().localModel);
      const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: dialogFilters("model") });
      if (r.canceled || !r.filePaths[0]) return models.list(prefs().localModel);
      const list = await models.importFile(r.filePaths[0]);
      const added = list.find((m) => m.path === r.filePaths[0]);
      if (added) setPrefs({ localModel: added.id });
      return models.list(prefs().localModel);
    },
    [IPC.aiModelSelect]: async (id) => {
      setPrefs({ localModel: id as string });
      await local.unload();
      return ai.status();
    },
    [IPC.aiModelRemove]: async (id) => {
      if (prefs().localModel === id) await local.unload();
      return models.remove(id as string, prefs().localModel);
    },
    [IPC.aiChat]: (request) => ai.chat(request as Parameters<AiService["chat"]>[0]),
    [IPC.aiCancel]: (requestId) => ai.cancel(requestId as string),
    [IPC.aiSetCloud]: (config) => ai.setCloud(config as Parameters<AiService["setCloud"]>[0]),
    [IPC.aiClearCloudKey]: () => ai.clearCloudKey(),
    [IPC.aiPlaybook]: () => fs.readFile(locations.playbook, "utf8").catch(() => ""),
    [IPC.updateCheck]: () => updater.check(),
    [IPC.updateInstall]: () => updater.install(),
    [IPC.aiDiagnose]: (options) => runAiDiagnostics(diagnosticsDeps, (options ?? {}) as AiDiagnoseOptions), // --- desktop-ai-fix ---
  };

  /* ---------------------------------------------------------------- window, menu, tray */
  const iconPath = path.join(locations.siteRoot, "icons", "icon-512.png");
  const labels = MENU_LABELS[menuLanguage(app.getLocale())];
  const menuAction = (action: MenuAction) => {
    if (win) {
      if (!win.isVisible()) win.show();
      win.focus();
    }
    send(DESKTOP_EVENTS.menu, action);
  };
  const runCommand = async (command: string) => {
    switch (command) {
      case "output-folder": {
        if (!win) return;
        const r = await dialog.showOpenDialog(win, { properties: ["openDirectory", "createDirectory"], defaultPath: outputFolder() });
        if (!r.canceled && r.filePaths[0]) setPrefs({ outputFolder: r.filePaths[0] });
        return;
      }
      case "open-logs":
        await shell.openPath(locations.logsDir);
        return;
      case "check-updates":
        await updater.check();
        return;
      case "website":
        await shell.openExternal("https://cronusaztec.github.io/Balls/");
        return;
      case "download-page":
        await shell.openExternal("https://cronusaztec.github.io/Balls/en/download/");
        return;
      case "releases":
        await shell.openExternal("https://github.com/CronusAztec/Balls/releases");
        return;
      case "about":
        await dialog.showMessageBox({ type: "info", title: "JumpingBallsLive", message: `JumpingBallsLive ${app.getVersion()}`, detail: `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}\n${locations.dataDir}` });
        return;
      case "reload":
        win?.webContents.reload();
        return;
      case "devtools":
        win?.webContents.toggleDevTools();
        return;
      case "quit":
        quitting = true;
        app.quit();
        return;
    }
  };
  const buildMenu = () => {
    const template: MenuItemConstructorOptions[] = MENU.map((group) => ({
      label: labels[group.id] ?? group.id,
      submenu: group.entries.map((entry): MenuItemConstructorOptions => {
        if (entry === "separator") return { type: "separator" };
        const base: MenuItemConstructorOptions = { label: labels[entry.id] ?? entry.id, accelerator: entry.accelerator };
        if ("role" in entry.run) return { ...base, role: entry.run.role };
        if ("action" in entry.run) {
          const action = entry.run.action;
          return { ...base, click: () => menuAction(action) };
        }
        const command = entry.run.command;
        return { ...base, click: () => void runCommand(command) };
      }),
    }));
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };
  const buildTray = () => {
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (image.isEmpty()) return;
      tray = new Tray(image.resize({ width: 16, height: 16 }));
      tray.setToolTip(labels.trayTip);
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: labels.show, click: () => (win ? (win.show(), win.focus()) : createWindow()) },
          { label: labels.queue, click: () => menuAction("queue") },
          { label: labels.library, click: () => menuAction("library") },
          { type: "separator" },
          { label: labels.quit, click: () => void runCommand("quit") },
        ]),
      );
      tray.on("click", () => (win ? (win.show(), win.focus()) : createWindow()));
    } catch (err) {
      logger.warn(`tray unavailable: ${err instanceof Error ? err.message : String(err)}`);
      tray = null;
    }
  };

  let pendingFiles = filesInArgv(process.argv);
  const deliverFiles = async (files: string[]) => {
    for (const file of files) {
      try {
        send(DESKTOP_EVENTS.openFile, await readPicked(file));
      } catch (err) {
        logger.warn(`open ${file}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  function createWindow() {
    const displays = screen.getAllDisplays().map((d) => d.workArea);
    const state = restoreWindowState(store.get("window"), displays, screen.getPrimaryDisplay().workArea);
    win = new BrowserWindow({
      x: state.x,
      y: state.y,
      width: state.width,
      height: state.height,
      minWidth: 800,
      minHeight: 600,
      show: false,
      title: "JumpingBallsLive",
      backgroundColor: "#020617",
      icon: existsSync(iconPath) ? iconPath : undefined,
      webPreferences: {
        preload: path.join(here, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
        // A render keeps going with the window minimised or in the tray.
        backgroundThrottling: false,
      },
    });
    if (state.maximized) win.maximize();
    win.once("ready-to-show", () => win?.show());
    let saveTimer: ReturnType<typeof setTimeout> | undefined;
    const saveState = () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        if (!win || win.isDestroyed()) return;
        const b = win.getNormalBounds();
        store.set("window", { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
      }, 400);
    };
    win.on("resize", saveState);
    win.on("move", saveState);
    win.on("close", (event) => {
      if (win && !win.isDestroyed()) {
        const b = win.getNormalBounds();
        store.set("window", { x: b.x, y: b.y, width: b.width, height: b.height, maximized: win.isMaximized() });
      }
      if (!quitting && !SMOKE && tray && prefs().closeToTray) {
        event.preventDefault();
        win?.hide();
        if (!trayNoticeShown && Notification.isSupported()) {
          trayNoticeShown = true;
          new Notification({ title: "JumpingBallsLive", body: labels.trayHidden }).show();
        }
      }
    });
    win.on("closed", () => {
      win = null;
    });
    const contents = win.webContents;
    // --- review fix (desktop-exe) --- the Publish block's sign-in popups (the relay's, Google's) open as child windows the page
    // keeps a handle on – a small sandboxed window without the app's bridge (the preload only serves app:// pages) – every
    // other web link opens in the system browser, as before
    contents.setWindowOpenHandler(({ url, frameName }) => {
      const action = windowOpenAction(url, frameName);
      if (action === "popup") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: { width: 520, height: 760, autoHideMenuBar: true, backgroundColor: "#0b0b0f", webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } },
        };
      }
      if (action === "external") void shell.openExternal(url);
      return { action: "deny" };
    });
    contents.on("did-create-window", (child) => {
      const popup = child.webContents;
      // A sign-in popup stays a web page: no app:// (or file:) navigation, and its own popups go to the system browser.
      popup.on("will-navigate", (event, url) => {
        if (!popupMayNavigate(url)) event.preventDefault();
      });
      popup.on("will-redirect", (event, url) => {
        if (!popupMayNavigate(url)) event.preventDefault();
      });
      popup.setWindowOpenHandler(({ url }) => {
        if (isExternalWebUrl(url)) void shell.openExternal(url);
        return { action: "deny" };
      });
    });
    contents.on("will-navigate", (event, url) => {
      if (isAppUrl(url)) return;
      event.preventDefault();
      if (isExternalWebUrl(url)) void shell.openExternal(url);
    });
    contents.on("did-finish-load", () => {
      if (pendingFiles.length) {
        const files = pendingFiles;
        pendingFiles = [];
        setTimeout(() => void deliverFiles(files), 1500);
      }
    });
    contents.on("render-process-gone", (_e, details) => logger.error(`renderer gone: ${details.reason}`));
    // The page's errors go to the log (and to the console in a smoke run).
    contents.on("console-message", (event) => {
      const e = event as unknown as { level?: string | number; message?: string };
      const level = String(e.level ?? "");
      if (level === "error" || level === "3" || level === "warning" || level === "2") {
        logger.write(level === "error" || level === "3" ? "error" : "warn", `[console] ${e.message ?? ""}`);
        if (SMOKE) console.log(`console ${level}: ${e.message ?? ""}`);
      }
    });
    void win.loadURL(startUrl(app.getLocale()));
    if (SMOKE) void runSmoke();
  }

  /* ---------------------------------------------------------------- smoke run */
  async function runSmoke() {
    const deadline = Date.now() + Number(process.env.JBL_SMOKE_TIMEOUT_MS || 90000);
    const out: Record<string, unknown> = { url: null };
    let ok = false;
    try {
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1000));
        if (!win) break;
        const evaluation = win.webContents
          .executeJavaScript(
            `(async () => {
              const within = (p, name) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(name + " timed out")), 5000))]);
              const d = window.desktop;
              const group = document.querySelector("[data-desktop-group]");
              if (!d || !group) {
                let prefsError = null;
                try { if (d) await within(d.prefs.get(), "prefs.get"); } catch (e) { prefsError = String(e); }
                return { ready: false, bridge: !!d, apiVersion: d ? d.apiVersion : null, group: !!group, canvas: !!document.querySelector("canvas"), prefsError };
              }
              const info = await within(d.info(), "info");
              const gpu = await within(d.gpu.status(), "gpu.status");
              const prefs = await within(d.prefs.get(), "prefs.get");
              const notFound = await fetch("/definitely-not-here/").then((r) => r.status);
              return { ready: true, bridge: true, group: true, canvas: !!document.querySelector("canvas"), title: document.title, lang: document.documentElement.lang, version: info.version, gpuDevices: gpu.devices.length, prefs: prefs.aiProvider, notFound, sw: "serviceWorker" in navigator ? (await navigator.serviceWorker.getRegistrations().catch(() => [])).length : -1, webcodecs: typeof VideoEncoder !== "undefined", secure: window.isSecureContext };
            })()`,
          )
          .catch((err: Error) => ({ ready: false, error: err.message }));
        // A busy renderer can hold executeJavaScript for a long time; never let one probe outlive the deadline.
        const page = (await Promise.race([evaluation, new Promise((r) => setTimeout(() => r({ ready: false, error: "page probe timed out" }), 15000))])) as Record<string, unknown>;
        Object.assign(out, page, { url: win.webContents.getURL() });
        if (page.ready) {
          ok = page.canvas === true && page.bridge === true && page.group === true && page.notFound === 404 && page.secure === true;
          break;
        }
      }
      const gpu = await gpuStatus();
      out.gpu = { devices: gpu.devices, hardwareVideoEncode: gpu.hardwareVideoEncode, hardwareVideoDecode: gpu.hardwareVideoDecode, webgpu: gpu.webgpu, features: gpu.features, switches: gpu.switches };
      const encoders = await probe();
      out.encoders = { ffmpeg: encoders.ffmpeg, chosen: encoders.chosen, working: encoders.encoders.filter((e) => e.works).map((e) => e.id), error: encoders.error };
      out.ai = await ai.status();
      // --- review fix (desktop-exe) --- the local AI must be able to start in the package: node-llama-cpp imports (its llama/
      // files shipped), its CPU backend loads and it builds a grammar. ai.status() alone never imports it.
      const llama = await checkLocalAi(() => import("node-llama-cpp"));
      out.localAi = llama;
      if (!llama.ok) ok = false;
      out.update = updater.status;
      // --- desktop-ai-fix --- the AI status panel's checks answer in the package (quick: no network, no model load)
      const diagnosis = await runAiDiagnostics(diagnosticsDeps, { deep: false });
      out.aiDiagnose = diagnosis.checks.map((c) => `${c.id}:${c.level}:${c.code}`);
      if (diagnosis.checks.length !== 5 || !diagnosis.report.app) ok = false;
      // --- desktop-ai-fix --- JBL_SMOKE_MODEL: the real AI path – a Settings and a Captions job through the page's AI panel,
      // the bridge, AiService and llama.cpp, within JBL_SMOKE_AI_TIMEOUT_MS
      if (process.env.JBL_SMOKE_MODEL) {
        const tasks = ok ? await smokeAiTasks() : { ok: false, error: "the page did not load" };
        out.aiTasks = tasks;
        if (!tasks.ok) ok = false;
      }
    } catch (err) {
      out.error = err instanceof Error ? err.message : String(err);
      ok = false;
    }
    console.log(`SMOKE_RESULT ${JSON.stringify(out)}`);
    console.log(ok ? "SMOKE OK" : "SMOKE FAILED");
    quitting = true;
    // --- desktop-ai-fix --- llama.cpp stopped before the process ends (app.exit skips before-quit)
    await Promise.race([local.unload().catch(() => {}), new Promise((r) => setTimeout(r, QUIT_UNLOAD_MS))]);
    app.exit(ok ? 0 : 1);
  }

  /* ---------------------------------------------------------------- --- desktop-ai-fix --- the smoke run's real AI jobs */
  let smokeModelError: string | null = null;
  /** JBL_SMOKE_MODEL (a GGUF file) becomes the selected local model of the smoke run's data folder. */
  async function prepareSmokeModel(file: string): Promise<void> {
    const full = path.resolve(file);
    const list = await models.importFile(full);
    const entry = list.find((m) => m.path === full);
    if (!entry) throw new Error(`${full} was not added as a model`);
    setPrefs({ localModel: entry.id, aiProvider: "local", aiGpu: process.env.JBL_SMOKE_AI_GPU === "off" ? "off" : "auto" });
    logger.info(`smoke: local model ${entry.id} from ${full}, run on ${prefs().aiGpu}`);
  }
  const SMOKE_AI_JOBS = [
    { task: "settings", prompt: "make the ball twice as fast and rainbow, no gravity", done: '[data-testid="ai-changed"]' },
    { task: "copy", prompt: "", done: '[data-testid="ai-copy-result"]' },
  ] as const;
  /** Runs each job in the AI panel the way a user does (task, prompt, Run) and waits for its result card or its error. */
  async function smokeAiTasks(): Promise<Record<string, unknown> & { ok: boolean }> {
    if (smokeModelError) return { ok: false, error: smokeModelError };
    const deadline = Date.now() + Number(process.env.JBL_SMOKE_AI_TIMEOUT_MS || 900000);
    const page = async (js: string, ms = 15000): Promise<Record<string, unknown>> => {
      if (!win) return { probeError: "no window" };
      const evaluation = win.webContents.executeJavaScript(js).catch((err: Error) => ({ probeError: err.message }));
      return (await Promise.race([evaluation, new Promise((r) => setTimeout(() => r({ probeError: "page probe timed out" }), ms))])) as Record<string, unknown>;
    };
    await page(`document.querySelector('[data-testid="desktop-tab-ai"]')?.click(); true`);
    const out: Record<string, unknown> = { model: prefs().localModel, runOn: prefs().aiGpu };
    let ok = true;
    for (const job of SMOKE_AI_JOBS) {
      const t0 = Date.now();
      const started = await page(
        `(async () => {
          const q = (s) => document.querySelector(s);
          await new Promise((r) => setTimeout(r, 300));
          q('[data-testid="ai-task-${job.task}"]')?.click();
          await new Promise((r) => setTimeout(r, 300));
          const box = q('[data-testid="ai-prompt"]');
          if (!box) return { error: "no prompt box in the AI panel" };
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(box, ${JSON.stringify(job.prompt)});
          box.dispatchEvent(new Event("input", { bubbles: true }));
          for (let i = 0; i < 80; i++) {
            const run = q('[data-testid="ai-run"]');
            if (run && !run.disabled) { run.click(); return { started: true }; }
            await new Promise((r) => setTimeout(r, 500));
          }
          return { error: "Run stayed disabled: " + (q('[data-testid="desktop-ai"]')?.innerText ?? "").slice(0, 400) };
        })()`,
        60000,
      );
      if (!started.started) {
        out[job.task] = { ok: false, error: started.error ?? started.probeError };
        ok = false;
        continue;
      }
      let outcome: Record<string, unknown> | null = null;
      while (!outcome && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        const state = await page(`(() => {
          const q = (s) => document.querySelector(s);
          const err = q('[data-testid="ai-error"]');
          const done = q('${job.done}');
          return { error: err ? err.innerText : null, done: done ? done.innerText.slice(0, 800) : null, running: !!q('[data-testid="ai-stop"]'), log: (q('[data-testid="ai-log"]')?.innerText ?? "").slice(-800) };
        })()`);
        if (state.probeError) continue;
        if (state.error) outcome = { ok: false, error: state.error, log: state.log };
        else if (state.done && !state.running) {
          const text = String(state.done);
          const hashtags = (text.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
          const valid = job.task === "copy" ? hashtags >= 3 : text.trim().length > 0;
          outcome = { ok: valid, result: text.slice(0, 400), log: state.log, ...(job.task === "copy" ? { hashtags } : {}) };
        }
      }
      if (!outcome) {
        await page(`document.querySelector('[data-testid="ai-stop"]')?.click(); true`);
        outcome = { ok: false, error: `no result within JBL_SMOKE_AI_TIMEOUT_MS` };
      }
      out[job.task] = { ...outcome, ms: Date.now() - t0 };
      if (!outcome.ok) ok = false;
    }
    const status = await ai.status();
    out.local = status.local;
    out.lastError = status.lastError;
    return { ok, ...out };
  }

  /* ---------------------------------------------------------------- lifecycle */
  app.on("second-instance", (_event, argv) => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
    void deliverFiles(filesInArgv(argv));
  });
  // --- desktop-ai-fix --- once: stop the AI, wait (bounded) for llama.cpp to finish the stopped reply and unload, then quit –
  // quitting mid-generation aborted the process with a Napi::Error in 1.0.2
  let quitPrepared = false;
  app.on("before-quit", (event) => {
    quitting = true;
    ai.cancelAll();
    models.cancelAll();
    if (quitPrepared) return;
    quitPrepared = true;
    event.preventDefault();
    const bound = new Promise<void>((resolve) => setTimeout(resolve, QUIT_UNLOAD_MS));
    void Promise.race([local.unload().catch((err: unknown) => logger.warn(`unloading the model: ${describeError(err)}`)), bound]).finally(() => app.quit());
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("activate", () => {
    if (!win) createWindow();
  });

  void app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(["clipboard-sanitized-write", "clipboard-read", "fullscreen", "notifications", "media"].includes(permission)));
    protocol.handle(APP_SCHEME, async (request) => {
      const url = new URL(request.url);
      if (url.host !== APP_HOST) return new Response("Not found", { status: 404 });
      const res = resolveSiteRequest(locations.siteRoot, url.pathname, url.search, {
        kind: (p) => {
          try {
            const s = statSync(p);
            return s.isDirectory() ? "dir" : s.isFile() ? "file" : null;
          } catch {
            return null;
          }
        },
      });
      if (res.kind === "redirect") return new Response(null, { status: 301, headers: { location: res.location } });
      if (res.kind === "missing") return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
      const body = await fs.readFile(res.file);
      return new Response(body, { status: res.status, headers: { "content-type": contentType(res.file), "cache-control": "no-cache" } });
    });
    registerHandlers(ipcMain, table, logger.warn);
    // --- desktop-ai-fix --- the smoke run's model (JBL_SMOKE_MODEL) is selected before the page asks for the AI status
    if (SMOKE && process.env.JBL_SMOKE_MODEL) await prepareSmokeModel(process.env.JBL_SMOKE_MODEL).catch((err: unknown) => void (smokeModelError = describeError(err)));
    buildMenu();
    if (!SMOKE) buildTray();
    if (!existsSync(locations.siteRoot)) logger.error(`site export missing at ${locations.siteRoot} – run \`npm run site\` in desktop/`);
    createWindow();
    logger.info(`window at ${APP_ORIGIN}`);
    if (!SMOKE) setTimeout(() => void updater.check(), 8000);
  });
}
