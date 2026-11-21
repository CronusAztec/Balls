"use client";

import { useId, useState, type ReactNode } from "react";
import Tooltip from "@/components/ui/Tooltip";
import { IconChevronDown } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

/*
 * --- panel-basics --- A named row of a panel group that opens its block on demand: the Recording group's Batch Render,
 * Clip planner and Publish, so the group's everyday settings fit one screen. The row is the block's heading, with the
 * block's info tip (globals.css leaves the block's own heading line out inside it). Once opened, the block stays mounted
 * while the row is closed again, so what it holds is kept. The page opens a row itself when the command palette or
 * another button lands in it; while the search box is in use the page shows the blocks as they are, without rows.
 */
export default function FoldRow({ id, label, tip, open, onToggle, children }: { id: string; label: string; tip?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const bodyId = useId();
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className="border-t border-line pt-1" data-fold-row={id}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={onToggle}
        data-recording-row={id}
        className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-1 rounded-md px-2 py-2 text-left text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink cursor-pointer"
      >
        <span>{label}</span>
        {tip && <Tooltip text={tip} />}
        <IconChevronDown size={16} className={cx("ml-auto text-ink-3 transition-transform duration-150", open && "rotate-180")} />
      </button>
      {(open || seen) && (
        <div id={bodyId} hidden={!open} className="studio-fold-body pb-2 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
