"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { looksLikeProjectFile } from "@/lib/project";

/**
 * --- project-files --- Wraps the controls panel so a `.jumpingballslive.json` file dropped anywhere on it is imported.
 * A project file is caught in the capture phase, before the panel's own drop zones (MIDI, songs, samples, pictures,
 * wall-break sound, theme background) see it: none of them takes JSON, and each passes whatever it is given to its
 * upload handler, so a project dropped on one of them must still open as a project. Other files go through to them.
 * The outline only shows while a JSON file is dragged, so the inner zones keep their own highlight for their files.
 */
export default function ProjectDropZone({
  className,
  label,
  onFile,
  children,
  disabled = false,
  lockedLabel,
}: {
  className?: string;
  label: string;
  onFile: (file: File) => void;
  children: ReactNode;
  /**
   * --- review fix (recording-export) --- Importing is locked (a batch render or a fast export is running): a project file is
   * still caught – it must not reach an inner zone – and handed to `onFile`, which refuses it with a status line; the
   * outline says so (`lockedLabel`).
   */
  disabled?: boolean;
  lockedLabel?: string;
}) {
  const [active, setActive] = useState(false);
  const depth = useRef(0);

  /** A drag that carries a JSON file (browsers expose the item types, not the names, while dragging). */
  const carriesJson = (e: DragEvent) => Array.from(e.dataTransfer?.items ?? []).some((item) => item.kind === "file" && item.type === "application/json");

  return (
    <div
      className={`relative ${className ?? ""}`}
      data-testid="project-drop-zone"
      onDragEnter={(e) => {
        if (!carriesJson(e)) return;
        depth.current += 1;
        setActive(true);
      }}
      onDragLeave={() => {
        if (depth.current === 0) return;
        depth.current -= 1;
        if (depth.current === 0) setActive(false);
      }}
      // Capture phase: a project file never reaches an inner drop zone (it would load it as a sound, a MIDI or a picture).
      onDragOverCapture={(e) => {
        if (!carriesJson(e)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(e) => {
        // The names are known on drop: a `.json` whose type the browser left empty is caught here too.
        const file = Array.from(e.dataTransfer?.files ?? []).find((f) => looksLikeProjectFile(f));
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        depth.current = 0;
        setActive(false);
        onFile(file);
      }}
      onDrop={() => {
        // Another file, dropped on an inner zone (which took it) or on the panel: the drag is over.
        depth.current = 0;
        setActive(false);
      }}
    >
      {children}
      {active && (
        <div className={`pointer-events-none absolute inset-0 z-30 rounded-lg border-2 border-dashed flex items-start justify-center pt-24 ${disabled ? "border-amber-400 bg-amber-400/5" : "border-[#93d119] bg-[#93d119]/5"}`} aria-hidden="true">
          <span className={`px-3 py-1.5 rounded-lg bg-zinc-950/90 text-xs font-semibold shadow-lg ${disabled ? "text-amber-400" : "text-[#93d119]"}`}>{disabled ? `⏳ ${lockedLabel ?? label}` : `📥 ${label}`}</span>
        </div>
      )}
    </div>
  );
}
