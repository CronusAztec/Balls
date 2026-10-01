import type { ReactNode } from "react";
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The poster card of the modes wall, the mode picker and the gallery: the preview picture full-bleed
 * in a square (the centred square of a preview is exactly what a clip records), then the name with a mono tag and one or
 * two lines of description. Calm hover: the hairline brightens, nothing moves. The interactive wrapper (link, button) is
 * the caller's; this is the content.
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
}) {
  const Heading = headingLevel;
  return (
    <>
      <div className={cx("relative aspect-square overflow-hidden rounded-xl border bg-black transition-colors duration-150", current ? "border-accent" : "border-line group-hover:border-line-strong")}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt={alt} loading="lazy" decoding="async" width={360} height={360} className="absolute inset-0 h-full w-full object-cover transition-opacity duration-150 group-hover:opacity-90" />
        {badge && <span className="absolute left-2 top-2">{badge}</span>}
      </div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <Heading className="min-w-0 truncate font-sans text-md font-medium tracking-normal text-ink">{name}</Heading>
        {tag && <span className="eyebrow hidden shrink-0 text-ink-3 sm:inline">{tag}</span>}
      </div>
      {description && <p className="mt-1 line-clamp-2 text-sm text-ink-2">{description}</p>}
      {footer}
    </>
  );
}
