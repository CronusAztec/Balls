"use client";

import { useId, useState, type ReactNode } from "react";
import { IconPlus } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";

export interface AccordionItem {
  question: string;
  answer: ReactNode;
}

/**
 * Single-open accordion for the FAQ and the troubleshooting list. --- site-redesign --- hairline rows, the question in
 * the interface face, a plus that turns into a cross; `columns` splits the rows into two columns from 1024 px.
 */
export default function Accordion({ items, compact = false, columns = 1 }: { items: AccordionItem[]; compact?: boolean; columns?: 1 | 2 }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const id = useId();
  const half = Math.ceil(items.length / 2);
  const groups = columns === 2 ? [items.slice(0, half).map((item, i) => [item, i] as const), items.slice(half).map((item, i) => [item, i + half] as const)] : [items.map((item, i) => [item, i] as const)];
  return (
    <div className={cx("grid gap-x-12", columns === 2 && "lg:grid-cols-2")}>
      {groups.map((group, g) => (
        <div key={g} className="border-t border-line">
          {group.map(([item, i]) => {
            const open = openIndex === i;
            return (
              <div key={i} className="border-b border-line">
                <h3 className="font-sans text-base font-normal tracking-normal">
                  <button
                    type="button"
                    id={`${id}-q${i}`}
                    onClick={() => setOpenIndex(open ? null : i)}
                    aria-expanded={open}
                    aria-controls={`${id}-a${i}`}
                    className={cx("flex w-full items-start justify-between gap-4 text-left cursor-pointer", compact ? "py-3" : "py-4")}
                  >
                    <span className={cx("font-medium text-ink", compact ? "text-sm" : "text-md")}>{item.question}</span>
                    <IconPlus size={18} className={cx("mt-0.5 text-ink-3 transition-transform duration-150", open && "rotate-45")} />
                  </button>
                </h3>
                {open && (
                  <div id={`${id}-a${i}`} role="region" aria-labelledby={`${id}-q${i}`} className={cx("pb-4 pr-8 text-ink-2 animate-fadeIn", compact ? "text-sm" : "text-md")}>
                    {item.answer}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
