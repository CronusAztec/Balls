/*
 * --- site-redesign --- The small info tooltip next to a control's label (the API the panel has always used:
 * <Tooltip text="…" />). The text stays in the DOM – it is part of the control's description for screen readers and
 * of the names tools match – and shows on hover in a surface-3 bubble.
 */
export default function Tooltip({ text }: { text: string }) {
  return (
    <span className="group/tip relative ml-1 inline-flex items-center align-middle cursor-help text-ink-3 hover:text-ink-2">
      <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="10" cy="10" r="7" />
        <path d="M10 9.2v4.3M10 6.6v.1" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-56 -translate-x-1/2 rounded-md border border-line bg-surface-3 px-2.5 py-2 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-ink whitespace-normal opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100">
        {text}
      </span>
    </span>
  );
}
