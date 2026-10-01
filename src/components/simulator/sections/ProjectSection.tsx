"use client";

import { useEffect, useRef, useState } from "react";
import type { Matcher, Translate } from "../ControlPrimitives";
import type { ProjectPanelProps } from "../useProjectFiles";
import { PROJECT_EXTENSION, formatBytes, type ProjectAssetKind } from "@/lib/project";

import { IconFolder } from "@/components/ui/icons"; // --- site-redesign ---
/**
 * --- project-files --- "Project file" block of the panel, under Saved Presets: a name, the media that would go into
 * the file (with their sizes and a warning above 25 MB), Export project and Import project. Dropping a project file
 * anywhere on the panel imports it too (ProjectDropZone.tsx); the work is done in useProjectFiles.ts.
 */

/** Search keys (Controls namespace): the search box shows this block for "project", "export", "import"… */
export const PROJECT_KEYS = ["projectFiles", "exportProject", "importProject"];

const MEDIUM_LABELS: Record<ProjectAssetKind, string> = {
  ballImage: "projectMediumBallImage",
  hitSample: "projectMediumHitSample",
  wallBreakSound: "projectMediumWallBreakSound",
  sliceSong: "projectMediumSliceSong",
  musicBed: "projectMediumMusicBed",
  midi: "projectMediumMidi",
  paintPicture: "projectMediumPaintPicture",
  backgroundImage: "projectMediumBackgroundImage",
  beatMedia: "projectMediumBeatMedia", // --- video-beats ---
};

const TONES = { ok: "text-accent", warn: "text-warn", error: "text-danger" } as const;

export default function ProjectSection({ t, search, matches, project }: { t: Translate; search: string; matches: Matcher; project: ProjectPanelProps }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // A drop on the panel reports here: open the block so its result is seen.
  useEffect(() => {
    if (project.status || project.busy) setOpen(true);
  }, [project.status, project.busy]);
  if (search && !PROJECT_KEYS.some(matches)) return null;

  const busy = project.busy !== null;
  const body = (
    <div className="space-y-3" data-testid="project-section">
      <p className="text-xs text-ink-3 leading-relaxed">{t("projectFilesDesc")}</p>
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink-2" htmlFor="project-name">
          {t("projectName")}
        </label>
        <input
          id="project-name"
          type="text"
          value={project.name}
          onChange={(e) => project.onNameChange(e.target.value)}
          placeholder={t("projectNamePlaceholder")}
          maxLength={80}
          className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
        />
        <p className="text-xs text-ink-3 font-mono truncate" title={project.fileName}>
          {project.fileName}
        </p>
      </div>
      <div className="px-3 py-2 bg-surface-2/60 rounded-lg border border-line-strong/60 space-y-1" data-testid="project-media">
        {project.media.length === 0 ? (
          <p className="text-xs text-ink-3">{t("projectMediaNone")}</p>
        ) : (
          <>
            {project.media.map((m) => (
              <div key={m.kind} className="flex items-center gap-2 text-xs" data-kind={m.kind}>
                <span className="text-ink-2 shrink-0">{t(MEDIUM_LABELS[m.kind])}</span>
                <span className="flex-1 min-w-0 truncate text-ink-2" title={m.name}>
                  {m.name}
                </span>
                <span className="text-ink-3 font-mono shrink-0">{formatBytes(m.bytes)}</span>
              </div>
            ))}
            <div className="flex justify-between pt-1 border-t border-line-strong/60 text-xs">
              <span className="text-ink-2">{t("projectMediaTotal")}</span>
              <span className={`font-mono ${project.totalBytes > project.warnBytes ? "text-warn" : "text-ink-2"}`}>{formatBytes(project.totalBytes)}</span>
            </div>
          </>
        )}
      </div>
      {project.totalBytes > project.warnBytes && (
        <p className="text-xs text-warn leading-relaxed" data-testid="project-size-warning">
          {t("projectLargeWarning", { size: formatBytes(project.totalBytes), limit: formatBytes(project.warnBytes) })}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={project.onExport}
          disabled={busy}
          className="px-3 py-2 rounded-lg text-sm font-medium transition-all bg-accent text-accent-ink hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {t("exportProject")}
        </button>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || project.importLocked} // --- review fix (recording-export) --- (not while a batch or a fast export renders)
          title={project.importLocked ? t("projectImportLocked") : undefined}
          className="px-3 py-2 rounded-lg text-sm font-medium transition-all bg-surface-2 text-ink hover:bg-surface-3 border border-line-strong disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
        >
          {t("importProject")}
        </button>
        <input
          ref={inputRef}
          id="project-file-input"
          type="file"
          accept={`${PROJECT_EXTENSION},.json,application/json`}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              project.onImport(file);
              e.target.value = "";
            }
          }}
        />
      </div>
      <p className="text-xs text-ink-3 leading-relaxed">{t("projectDropHint")}</p>
      {project.importLocked && !busy && project.status?.key !== "projectImportLocked" && (
        <p className="text-xs text-warn leading-relaxed" data-testid="project-import-locked">
          {t("projectImportLocked")}
        </p>
      ) /* --- review fix (recording-export) --- */}
      {busy && (
        <div className="flex items-center gap-2 text-sm text-ink-2" role="status">
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          {t(project.busy === "export" ? "projectExporting" : "projectImporting")}
        </div>
      )}
      {!busy && project.status && (
        <p className={`text-xs leading-relaxed ${TONES[project.status.tone]}`} role="status" data-testid="project-status" data-tone={project.status.tone}>
          {t(project.status.key, project.status.values)}
        </p>
      )}
    </div>
  );

  if (search) return <div className="p-3 bg-surface-2/40 rounded-xl border border-line-strong/50 shadow-sm">{body}</div>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium text-ink-2 hover:text-ink hover:bg-surface-2 transition-all cursor-pointer border border-transparent hover:border-line-strong"
      >
        <IconFolder size={18} />
        <span>{t("projectFiles")}</span>
        <span className="text-ink-3 ml-auto">{open ? "−" : "+"}</span>
      </button>
      {open && <div className="px-4 pt-2 pb-3">{body}</div>}
    </div>
  );
}
