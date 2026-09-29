"use client";

import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { looksLikeProjectFile } from "@/lib/project";

/**
 * --- project-files --- Wraps the controls panel so a `.viralballs.json` file dropped anywhere on it is imported.
 * The panel's own drop zones (MIDI, songs, samples, pictures) handle their drops first – a drop they took is left
 * alone – and the outline only shows while a JSON file is dragged, so they keep their own highlight.
 */
export default function ProjectDropZone({ className, label, onFile, children }: { className?: string; label: string; onFile: (file: File) => void; children: ReactNode }) {
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
      onDragOver={(e) => {
        if (!carriesJson(e) || e.isDefaultPrevented()) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDrop={(e) => {
        depth.current = 0;
        setActive(false);
        if (e.isDefaultPrevented()) return; // an inner drop zone took it
        const file = Array.from(e.dataTransfer?.files ?? []).find((f) => looksLikeProjectFile(f));
        if (!file) return;
        e.preventDefault();
        onFile(file);
      }}
    >
      {children}
      {active && (
        <div className="pointer-events-none absolute inset-0 z-30 rounded-lg border-2 border-dashed border-[#93d119] bg-[#93d119]/5 flex items-start justify-center pt-24" aria-hidden="true">
          <span className="px-3 py-1.5 rounded-lg bg-zinc-950/90 text-[#93d119] text-xs font-semibold shadow-lg">📥 {label}</span>
        </div>
      )}
    </div>
  );
}
