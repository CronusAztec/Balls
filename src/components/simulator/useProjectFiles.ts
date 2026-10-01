"use client";

/**
 * --- project-files --- The page's side of the project files (lib/project.ts): it gathers the settings and the media
 * uploaded in this session into `<name>.jumpingballslive.json` for "Export project", and loads such a file back – settings
 * first (like a preset), then every medium through the page's own upload handlers, then the project's own switches
 * over whatever those handlers turned on. The panel block (sections/ProjectSection.tsx) and the drop zone around
 * the panel (ProjectDropZone.tsx) only call `onExport()` / `onImport(file)`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useTranslations } from "next-intl";
import { SONGS } from "@/lib/audio/songs";
import {
  PROJECT_MAX_BYTES,
  PROJECT_MAX_FILE_BYTES,
  PROJECT_WARN_BYTES,
  assetToDataUrl,
  buildProject,
  dataUrlByteLength,
  dataUrlToAsset,
  defaultAssetName,
  formatBytes,
  looksLikeProjectFile,
  parseProject,
  projectFileName,
  projectMediaPatch,
  projectNameFromFileName,
  projectSizeCheck,
  sanitizeProjectName,
  serializeProject,
  type LoadedProject,
  type ProjectAsset,
  type ProjectAssetKind,
  type ProjectAssets,
  type ProjectError,
} from "@/lib/project";
import type { SimulatorSettings } from "@/lib/settings";

/** The original files of the audio uploads (the page keeps only decoded buffers or blob: URLs of them). */
export interface ProjectUploads {
  hitSample?: File;
  wallBreakSound?: File;
  sliceSong?: File;
  musicBed?: File;
  midi?: File;
  beatMedia?: File; // --- video-beats --- the imported video / audio (it is the music bed while loaded)
}

/** A named picture kept as a data: URL (Picture Paint, background). */
interface PictureInfo {
  name: string;
  url: string;
}

/** What is loaded right now, as the page's state holds it. */
export interface ProjectMediaState {
  ballImage: string | null;
  ballEmoji: string | null;
  customHitSampleName: string | null;
  customWallBreakName: string | null;
  sliceSongName: string | null;
  musicTrackName: string | null;
  /** Built-in melody id, "custom-upload" for an uploaded MIDI file, or null. */
  customSoundId: string | null;
  customMidiName: string | null;
  paintPicture: PictureInfo | null;
  backgroundImage: PictureInfo | null;
  /** --- video-beats --- The imported video / audio file's name, or null. */
  beatMediaName?: string | null;
}

/** How the page loads things – the same handlers the panel's upload buttons use. */
export interface ProjectMediaActions {
  loadSettings: (settings: Partial<SimulatorSettings>) => void;
  update: (patch: Partial<SimulatorSettings>) => void;
  setBallImage: (url: string | null) => void;
  setBallEmoji: (emoji: string | null) => void;
  setPaintPicture: (picture: PictureInfo | null) => void;
  setBackgroundImage: (picture: PictureInfo | null) => void;
  onHitSampleUpload: (file: File) => void;
  onWallBreakSoundUpload: (file: File) => void;
  onSliceSongUpload: (file: File) => Promise<void>;
  onSliceSongClear: () => void;
  onMusicUpload: (file: File) => Promise<void>;
  onMusicRemove: () => void;
  onCustomMidiUpload: (file: File) => Promise<void>;
  onCustomSoundSelect: (id: string | null) => Promise<void>;
  /** --- video-beats --- Imports a video / audio file for its beats (it becomes the music bed). */
  onBeatMediaUpload?: (file: File) => Promise<void>;
}

export interface ProjectFilesOptions {
  settings: SimulatorSettings;
  uploads: MutableRefObject<ProjectUploads>;
  media: ProjectMediaState;
  actions: ProjectMediaActions;
  /**
   * --- review fix (recording-export) --- A batch render or a fast export is running: an import is refused with a status line
   * (the batch would put its own settings back over the project's, the export renders the settings it started with).
   */
  locked?: boolean;
}

/** One loaded medium in the panel's list. */
export interface ProjectMediumInfo {
  kind: ProjectAssetKind;
  name: string;
  bytes: number;
}

/** A line under the buttons: a translation key of the Controls namespace and its values. */
export interface ProjectStatus {
  tone: "ok" | "warn" | "error";
  key: string;
  values?: Record<string, string | number>;
}

/** Everything the panel block shows and does. */
export interface ProjectPanelProps {
  name: string;
  onNameChange: (name: string) => void;
  /** The file name an export would get with the current name. */
  fileName: string;
  media: ProjectMediumInfo[];
  totalBytes: number;
  warnBytes: number;
  busy: "export" | "import" | null;
  status: ProjectStatus | null;
  onExport: () => void;
  onImport: (file: File) => void;
  /** --- review fix (recording-export) --- Import project is off (a batch render or a fast export is running). */
  importLocked: boolean;
}

const ERROR_KEYS: Record<ProjectError, string> = {
  "not-json": "projectErrorNotJson",
  "not-project": "projectErrorNotProject",
  "newer-version": "projectErrorNewer",
  "too-large": "projectErrorTooLarge",
};

/** The upload of `kind` still backs what the page shows (a later, failed upload of another file does not count). */
function uploadIfCurrent(file: File | undefined, shownName: string | null): File | null {
  return file && shownName !== null && file.name === shownName ? file : null;
}

/** The loaded media, without reading them: kind, name and byte size (in the order of PROJECT_ASSET_KINDS). */
function listMedia(settings: SimulatorSettings, uploads: ProjectUploads, m: ProjectMediaState): { info: ProjectMediumInfo; file: File | null; dataUrl: string | null }[] {
  const out: { info: ProjectMediumInfo; file: File | null; dataUrl: string | null }[] = [];
  const addUrl = (kind: ProjectAssetKind, name: string | null, url: string | null) => {
    if (!url) return;
    const type = /^data:([^;,]*)/.exec(url)?.[1] ?? "";
    out.push({ info: { kind, name: name || defaultAssetName(kind, type), bytes: dataUrlByteLength(url) }, file: null, dataUrl: url });
  };
  const addFile = (kind: ProjectAssetKind, file: File | null) => {
    if (file) out.push({ info: { kind, name: file.name, bytes: file.size }, file, dataUrl: null });
  };
  addUrl("ballImage", null, m.ballImage);
  addFile("hitSample", uploadIfCurrent(uploads.hitSample, m.customHitSampleName));
  // The uploaded wall-break sound is only in play while it is the selected one (the panel lists it only then).
  addFile("wallBreakSound", settings.wallBreakSound?.startsWith("blob:") ? uploadIfCurrent(uploads.wallBreakSound, m.customWallBreakName) : null);
  addFile("sliceSong", uploadIfCurrent(uploads.sliceSong, m.sliceSongName));
  addFile("musicBed", uploadIfCurrent(uploads.musicBed, m.musicTrackName));
  addFile("midi", m.customSoundId === "custom-upload" ? uploadIfCurrent(uploads.midi, m.customMidiName) : null);
  addUrl("paintPicture", m.paintPicture?.name ?? null, m.paintPicture?.url ?? null);
  addUrl("backgroundImage", m.backgroundImage?.name ?? null, m.backgroundImage?.url ?? null);
  addFile("beatMedia", uploadIfCurrent(uploads.beatMedia, m.beatMediaName ?? null)); // --- video-beats ---
  return out;
}

function toFile(asset: ProjectAsset): File {
  return new File([asset.bytes as Uint8Array<ArrayBuffer>], asset.name, { type: asset.type });
}

function download(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function useProjectFiles(options: ProjectFilesOptions): { panel: ProjectPanelProps; importFile: (file: File) => void } {
  const t = useTranslations("Controls");
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  });
  const [name, setName] = useState("");
  const [busy, setBusyState] = useState<"export" | "import" | null>(null);
  const busyRef = useRef<"export" | "import" | null>(null);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const setBusy = (value: "export" | "import" | null) => {
    busyRef.current = value;
    setBusyState(value);
  };

  const { settings, uploads, media } = options;
  const listed = useMemo(
    () => listMedia(settings, uploads.current, media),
    // The uploads ref changes together with the names in `media`; the wall-break sound's selection lives in the settings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.wallBreakSound, media.ballImage, media.customHitSampleName, media.customWallBreakName, media.sliceSongName, media.musicTrackName, media.customSoundId, media.customMidiName, media.paintPicture, media.backgroundImage, media.beatMediaName], // --- video-beats --- (beatMediaName)
  );
  const totalBytes = listed.reduce((sum, m) => sum + m.info.bytes, 0);
  const defaultName = `jumpingballslive-${settings.mode}`;
  const fileName = projectFileName(name || defaultName);

  const onExport = useCallback(async () => {
    if (busyRef.current) return;
    const o = latest.current;
    const items = listMedia(o.settings, o.uploads.current, o.media);
    const total = items.reduce((sum, m) => sum + m.info.bytes, 0);
    const check = projectSizeCheck(total);
    if (check === "too-large") {
      setStatus({ tone: "error", key: "projectTooLarge", values: { size: formatBytes(total), max: formatBytes(PROJECT_MAX_BYTES) } });
      return;
    }
    if (check === "warn" && !window.confirm(t("projectLargeConfirm", { size: formatBytes(total), limit: formatBytes(PROJECT_WARN_BYTES) }))) return;
    setBusy("export");
    setStatus(null);
    try {
      const assets: ProjectAssets = {};
      for (const item of items) {
        const asset = item.file
          ? { name: item.info.name, type: item.file.type, bytes: new Uint8Array(await item.file.arrayBuffer()) }
          : dataUrlToAsset(item.info.name, item.dataUrl ?? "");
        if (asset) assets[item.info.kind] = asset;
      }
      const melody = o.media.customSoundId && SONGS.some((song) => song.id === o.media.customSoundId) ? o.media.customSoundId : null;
      const projectName = sanitizeProjectName(name) || `jumpingballslive-${o.settings.mode}`;
      const text = serializeProject(buildProject({ name: projectName, settings: o.settings, extras: { ballEmoji: o.media.ballEmoji, melody }, assets }));
      const blob = new Blob([text], { type: "application/json" });
      const file = projectFileName(projectName);
      download(blob, file);
      setStatus({ tone: check === "warn" ? "warn" : "ok", key: "projectExported", values: { file, size: formatBytes(blob.size) } });
    } catch (err) {
      console.error("Project export failed:", err);
      setStatus({ tone: "error", key: "projectExportError" });
    } finally {
      setBusy(null);
    }
  }, [name, t]);

  /** Settings like a preset, then the media through the page's handlers, then the project's own switches. */
  const applyProject = useCallback(async (project: LoadedProject) => {
    const { actions } = latest.current;
    const a = project.assets;
    actions.loadSettings(project.settings);
    actions.setBallImage(a.ballImage ? assetToDataUrl(a.ballImage) : null);
    actions.setBallEmoji(a.ballImage ? null : project.extras.ballEmoji);
    actions.setPaintPicture(a.paintPicture ? { name: a.paintPicture.name, url: assetToDataUrl(a.paintPicture) } : null);
    actions.setBackgroundImage(a.backgroundImage ? { name: a.backgroundImage.name, url: assetToDataUrl(a.backgroundImage) } : null);
    if (a.hitSample) actions.onHitSampleUpload(toFile(a.hitSample));
    if (a.wallBreakSound) actions.onWallBreakSoundUpload(toFile(a.wallBreakSound));
    actions.onSliceSongClear();
    actions.onMusicRemove();
    const loads: Promise<void>[] = [];
    if (a.sliceSong) loads.push(actions.onSliceSongUpload(toFile(a.sliceSong)));
    if (a.musicBed) loads.push(actions.onMusicUpload(toFile(a.musicBed)));
    if (a.beatMedia && actions.onBeatMediaUpload) loads.push(actions.onBeatMediaUpload(toFile(a.beatMedia))); // --- video-beats --- (it becomes the bed)
    loads.push(a.midi ? actions.onCustomMidiUpload(toFile(a.midi)) : actions.onCustomSoundSelect(project.extras.melody));
    await Promise.all(loads);
    actions.update(projectMediaPatch(project));
  }, []);

  const onImport = useCallback(
    async (file: File) => {
      if (busyRef.current) return;
      // --- review fix (recording-export) --- (a dropped project too: said, not silently ignored)
      if (latest.current.locked) {
        setStatus({ tone: "warn", key: "projectImportLocked" });
        return;
      }
      if (!looksLikeProjectFile(file)) {
        setStatus({ tone: "error", key: "projectErrorNotFile", values: { file: file.name } });
        return;
      }
      if (file.size > PROJECT_MAX_FILE_BYTES) {
        setStatus({ tone: "error", key: "projectErrorTooLarge", values: { max: formatBytes(PROJECT_MAX_BYTES) } });
        return;
      }
      setBusy("import");
      setStatus(null);
      try {
        const result = parseProject(await file.text());
        if (!result.ok) {
          setStatus({ tone: "error", key: ERROR_KEYS[result.error], values: { max: formatBytes(PROJECT_MAX_BYTES) } });
          return;
        }
        await applyProject(result.project);
        const projectName = result.project.name || projectNameFromFileName(file.name);
        setName(projectName);
        const skipped = result.project.skipped.length;
        setStatus(skipped ? { tone: "warn", key: "projectImportedSkipped", values: { name: projectName, count: skipped } } : { tone: "ok", key: "projectImported", values: { name: projectName } });
      } catch (err) {
        console.error("Project import failed:", err);
        setStatus({ tone: "error", key: "projectErrorRead" });
      } finally {
        setBusy(null);
      }
    },
    [applyProject],
  );

  const exportProject = useCallback(() => void onExport(), [onExport]);
  const importFile = useCallback((file: File) => void onImport(file), [onImport]);
  const panel = useMemo<ProjectPanelProps>(
    () => ({
      name,
      onNameChange: (value: string) => setName(value.slice(0, 80)),
      fileName,
      media: listed.map((m) => m.info),
      totalBytes,
      warnBytes: PROJECT_WARN_BYTES,
      busy,
      status,
      onExport: exportProject,
      onImport: importFile,
      importLocked: !!options.locked, // --- review fix (recording-export) ---
    }),
    [name, fileName, listed, totalBytes, busy, status, exportProject, importFile, options.locked],
  );
  return { panel, importFile };
}
