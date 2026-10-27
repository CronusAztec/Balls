"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { useTranslations } from "next-intl";
import { CHECKLIST, type ChecklistId } from "@/lib/bot/playbook";
import { GENE_REASON_NUMBERS, type ClipGenes, type GeneReason } from "@/lib/insights/genes";

/*
 * --- insights --- The playbook's score of a clip (C6, lib/insights/score.ts) as a chip on the approval card (PostizPostCard),
 * the Library and the Queue: "Playbook 72", and a button that opens its reasons below it, one line per checklist item with
 * its points, worded as the viral bot words them (ViralBot.reasons; the two that quote the clip's own words get Insights'
 * words, since the genes keep no text). It says it is the playbook's score, not yet measured on the channel, and advice only:
 * nothing reads it to allow or refuse a post.
 *
 * Accessible: a real button with aria-expanded and aria-controls, a name that starts with its visible label and reads the
 * score out of 100 ("Playbook 72 out of 100": a voice command that names the label finds it, WCAG 2.5.3) and, once, as its
 * description, that it is not yet measured (its title; never in the name as well), Escape closes the reasons and keeps the
 * focus on the button, the marks are hidden from screen readers (the points are read as words). The reasons open in the flow, not over it, so a card that clips its overflow or a 360 px panel shows them whole.
 * A clip without a score (an older Library item, a link's clip still queued) shows no chip.
 */

// --- insights ---

/** The reasons that quote the clip's words (its hook, its series label): Insights words them without the quote. */
const QUOTING = new Set(["hookOk", "seriesOk"]);
const MAX: Record<ChecklistId, number> = Object.fromEntries(CHECKLIST.map((c) => [c.id, c.points])) as Record<ChecklistId, number>;

/** One checklist item as the chip lists it: its points (from the genes' share), its most and its verdict when the genes keep it. */
export interface ScoreLine {
  id: ChecklistId;
  points: number;
  max: number;
  reason: GeneReason | null;
}

/** The chip's lines, in the checklist's order: the items the genes scored. */
export function scoreLines(genes: Pick<ClipGenes, "checklist" | "reasons">): ScoreLine[] {
  const lines: ScoreLine[] = [];
  for (const { id } of CHECKLIST) {
    const share = genes.checklist?.[id];
    if (typeof share !== "number") continue;
    lines.push({ id, points: Math.round(share * MAX[id]), max: MAX[id], reason: genes.reasons?.[id] ?? null });
  }
  return lines;
}

/** The colour of a score: the viral bot's bands (90 and 75). */
const tone = (score: number) => (score >= 90 ? "border-accent/70 text-accent" : score >= 75 ? "border-warn/70 text-warn" : "border-danger/70 text-danger");

/** What Escape does on the chip: closes the reasons when they are open (true: the key was used). */
export function chipKey(key: string, open: boolean): boolean {
  return key === "Escape" && open;
}

export function ScoreChipView({ genes, open, onToggle, onClose, panelId, testId = "score-chip" }: { genes: ClipGenes | null | undefined; open: boolean; onToggle: () => void; onClose: () => void; panelId: string; testId?: string }) {
  const i = useTranslations("Insights");
  const b = useTranslations("ViralBot");
  if (!genes || typeof genes.planScore !== "number") return null;
  const score = Math.round(genes.planScore);
  const lines = scoreLines(genes);
  const keyDown = (e: KeyboardEvent) => {
    if (!chipKey(e.key, open)) return;
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };
  const reasonText = (reason: GeneReason) => {
    if (QUOTING.has(reason.key)) return i(`reasons.${reason.key}`);
    const values: Record<string, string | number> = Object.fromEntries(GENE_REASON_NUMBERS.map((k) => [k, "–"]));
    return b(`reasons.${reason.key}`, { ...values, kind: "–", ...reason.values });
  };
  return (
    <div className="w-full min-w-0 text-xs" data-testid={testId} data-score={score} data-open={open ? "1" : "0"}>
      <button type="button" className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border bg-surface-2 font-semibold tabular-nums cursor-pointer hover:bg-surface-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${tone(score)}`} aria-expanded={open} aria-controls={panelId} aria-label={i("chipLabel", { score })} title={i("unmeasured")} onClick={onToggle} onKeyDown={keyDown} data-testid={`${testId}-button`}>
        <span aria-hidden="true">{i("chip", { score })}</span>
        <span aria-hidden="true" className="text-ink-3">{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div id={panelId} role="region" aria-label={i("title", { score })} className="mt-1.5 w-full rounded-lg border border-line-strong bg-surface-2 p-2.5 space-y-1.5 break-words" onKeyDown={keyDown} data-testid={`${testId}-reasons`}>
          <p className="font-semibold text-ink">{i("title", { score })}</p>
          <p className="text-ink-3">
            {i("unmeasured")} {i("note")}
          </p>
          {lines.length > 0 && (
            <ul className="space-y-1">
              {lines.map((line) => (
                <li key={line.id} className="flex gap-1.5 leading-snug" data-score-item={line.id}>
                  <span aria-hidden="true" className={line.points === line.max ? "text-accent" : line.points > 0 ? "text-warn" : "text-danger"}>
                    {line.points === line.max ? "✓" : line.points > 0 ? "◐" : "✕"}
                  </span>
                  <span className="flex-1 min-w-0 text-ink-2">
                    <span className="text-ink-3">{b(`checklist.${line.id}`)}:</span> {line.reason ? reasonText(line.reason) : null}
                  </span>
                  <span className="shrink-0 text-ink-3 tabular-nums">
                    <span aria-hidden="true">
                      {line.points}/{line.max}
                    </span>
                    <span className="sr-only">{i("points", { points: line.points, max: line.max })}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** The chip with its own open state (closed at first). */
export default function ScoreChip({ genes, testId }: { genes: ClipGenes | null | undefined; testId?: string }) {
  const [open, setOpen] = useState(false);
  const panelId = `score-reasons-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  return <ScoreChipView genes={genes} open={open} onToggle={() => setOpen((o) => !o)} onClose={() => setOpen(false)} panelId={panelId} testId={testId} />;
}

// --- end insights ---
