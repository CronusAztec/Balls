"use client";

import { useState, type ReactNode } from "react";

export interface AccordionItem {
  question: string;
  answer: ReactNode;
}

/** Simple single-open accordion used for the FAQ and troubleshooting sections. */
export default function Accordion({ items, compact = false }: { items: AccordionItem[]; compact?: boolean }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  return (
    <div className="space-y-2">
      {items.map((item, i) => {
        const open = openIndex === i;
        return (
          <div key={i} className={`border border-zinc-800 overflow-hidden ${compact ? "rounded-lg" : "rounded-2xl"}`}>
            <button
              type="button"
              onClick={() => setOpenIndex(open ? null : i)}
              aria-expanded={open}
              className="cursor-pointer w-full flex items-center justify-between px-5 py-4 text-left hover:bg-zinc-800/50 transition-colors"
            >
              <span className={compact ? "text-sm font-medium text-white pr-4" : "font-bold text-white text-sm sm:text-base pr-4"}>{item.question}</span>
              <span className="text-zinc-500 shrink-0 text-lg mt-0.5" aria-hidden="true">
                {open ? "−" : "+"}
              </span>
            </button>
            {open && <div className={`px-5 pb-4 text-zinc-400 leading-relaxed animate-fadeIn ${compact ? "text-sm" : "text-sm sm:text-base"}`}>{item.answer}</div>}
          </div>
        );
      })}
    </div>
  );
}
