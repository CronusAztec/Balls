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
 * --- review fix (panel-basics) --- The info tip is the row's sibling of the button, not inside it (no control inside a
 * control: Enter on the tip shows the tip): the button holds the label and stretches over the whole row (its ::after), the
 * tip sits above that stretch, the chevron lets a press through to it.
 */
export default function FoldRow({ id, label, tip, open, onToggle, children }: { id: string; label: string; tip?: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  const bodyId = useId();
  const [seen, setSeen] = useState(open);
  if (open && !seen) setSeen(true);
  return (
    <div className="border-t border-line pt-1" data-fold-row={id}>
      <div className="relative -mx-2 flex w-[calc(100%+1rem)] items-center gap-1 rounded-md px-2 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2 hover:text-ink">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          data-recording-row={id}
          className="min-w-0 text-left cursor-pointer after:absolute after:inset-0 after:rounded-md after:content-['']"
        >
          {label}
        </button>
        {tip && (
          <span className="relative z-10 inline-flex">
            <Tooltip text={tip} />
          </span>
        )}
        <IconChevronDown size={16} aria-hidden="true" className={cx("pointer-events-none ml-auto text-ink-3 transition-transform duration-150", open && "rotate-180")} />
      </div>
      {(open || seen) && (
        <div id={bodyId} hidden={!open} className="studio-fold-body pb-2 pt-1">
          {children}
        </div>
      )}
    </div>
  );
}
