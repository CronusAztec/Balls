"use client";

/** Small "ⓘ" hover tooltip used next to control labels. */
export default function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative group ml-1 inline-flex items-center cursor-help">
      <span className="text-zinc-600 text-xs">ⓘ</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-700 text-zinc-200 text-xs leading-snug whitespace-normal w-48 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-150 z-50 shadow-lg border border-zinc-600">
        {text}
      </span>
    </span>
  );
}
