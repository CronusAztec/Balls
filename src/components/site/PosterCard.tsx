import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The poster card of the modes wall, the mode picker and the gallery: the preview picture full-bleed
 * in a square (the centred square of a preview is exactly what a clip records), then the name with a mono tag and a short
 * description. Calm hover: the hairline brightens, nothing moves. The interactive wrapper (link, button) is
 * the caller's; this is the content.
 * --- copy-pass --- the description is never clamped: a mode's one-liner (60 to 110 characters in English, up to 140 in
 * Polish and Spanish, bounded by tests/copyStyle.test.ts and docs/COPY-STYLE.md) reads in full at every width. Four lines
 * fit a card of 214 px or more, but on 320 to 640 px screens the cards are 136 to 187 px wide (152 px in the studio's picker
 * at 390) and need five to seven, so any clamp would end some mid-sentence (the smoke test measures them at 390 and 640 px).
 * --- mode-shelves --- the tag sits on its own small line above the name, on phones too, and the name wraps instead of
 * ending in an ellipsis ("Harfa z podwójnym wahadłem" needs two lines of a phone's card; in the gallery the tag is a mode's
 * name, which used to squeeze the preset's). The name stays first in the markup, so a card still reads name, tag, one-liner.
 * While a picture loads, its square shows a faint ring on the surface colour, not a black hole.
 * --- site-nav --- `priority` loads a card's picture with the page (the gallery's first row, its largest paint), where every
 * other card waits until it is scrolled near.
 * --- home-looks --- (E2 review) `low` asks for a picture after everything else (the landing page's row of looks, which a
 * phone's lazy loading fetches on the first open, 600 px under the first screen): it never competes with the studio's prefetch.
 */
export default function PosterCard({
  image,
  alt,
  name,
  tag,
  description,
  badge,
  footer,
  current = false,
  headingLevel = "h4",
  priority = false,
  low = false,
}: {
  image: string;
  alt: string;
  name: ReactNode;
  tag?: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  footer?: ReactNode;
  current?: boolean;
  /** The name's heading level in the page outline (h4 under a family heading, h2 on the gallery). */
  headingLevel?: "h2" | "h3" | "h4";
  /** The picture is in the first screen: it loads at once, ahead of the page's other pictures. */
  priority?: boolean;
  /** The picture comes after the page's other requests (fetchpriority="low"). */
  low?: boolean;
}) {
  const Heading = headingLevel;
  return (
    <>
      <div className={cx("relative aspect-square overflow-hidden rounded-xl border bg-surface-2 transition-colors duration-150", current ? "border-accent" : "border-line group-hover:border-line-strong")}>
        {/* --- mode-shelves --- the placeholder a loading picture covers */}
        <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-1/4 w-1/4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-line" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={alt} loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : low ? "low" : undefined} decoding="async" width={360} height={360} className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150 group-hover:opacity-90" />
        {badge && <span className="absolute left-2 top-2">{badge}</span>}
      </div>
      <div className="mt-3 flex flex-col-reverse gap-0.5">
        <Heading className="min-w-0 break-words font-sans text-md font-medium tracking-normal text-ink">{name}</Heading>
        {tag && <span className="eyebrow min-w-0 break-words text-ink-3">{tag}</span>}
      </div>
      {description && <p className="mt-1 text-sm text-ink-2" data-poster-description="">{description}</p>}
      {footer}
    </>
  );
}
