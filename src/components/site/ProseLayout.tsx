import type { ReactNode } from "react";
import Navbar from "./Navbar";
import Footer from "./Footer";
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The reading pages (about, the TikTok guide, feedback, privacy, terms, disclaimer, download): the
 * header, then one 680 px column – an eyebrow, the title and the lede over the text – and, on the legal pages from
 * 1280 px, a sticky table of contents in the left margin. The column's typography is `.prose-body` in globals.css.
 */

/** The legal pages' "last updated" date (privacy, terms, disclaimer). */
export const LEGAL_LAST_UPDATED = "2026-07-20";

/** LEGAL_LAST_UPDATED as a long date in the page's language. */
export function legalDate(locale: string): string {
  return new Date(LEGAL_LAST_UPDATED + "T00:00:00Z").toLocaleDateString(locale === "pl" ? "pl-PL" : locale === "es" ? "es-ES" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export interface TocEntry {
  id: string;
  label: string;
}

export default function ProseLayout({
  eyebrow,
  title,
  lede,
  meta,
  toc,
  tocLabel,
  plain = false,
  width = "prose",
  children,
  testId,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  /** A small mono line under the lede (the legal pages' "Last updated"). */
  meta?: ReactNode;
  /** The sections to list in the margin (from 1280 px); their ids are the sections' ids. */
  toc?: TocEntry[];
  tocLabel?: string;
  /** Children without the prose typography (a form, cards). */
  plain?: boolean;
  /** "prose": the 680 px reading column; "wide": the 1200 px container (cards, the download page). */
  width?: "prose" | "wide";
  children: ReactNode;
  testId?: string;
}) {
  const hasToc = !!toc && toc.length > 0;
  return (
    <div className="min-h-screen bg-bg text-ink">
      <Navbar />
      <main id="content" className="site-container py-12 sm:py-16 lg:py-20" data-testid={testId}>
        <div className={cx(hasToc && "xl:grid xl:grid-cols-[minmax(0,1fr)_680px_minmax(0,1fr)] xl:gap-12")}>
          {hasToc && (
            <nav aria-label={tocLabel} className="hidden xl:block">
              <div className="sticky top-24 max-w-[220px]">
                <p className="eyebrow text-ink-3">{tocLabel}</p>
                <ol className="mt-4 space-y-1 border-l border-line">
                  {toc.map((entry) => (
                    <li key={entry.id}>
                      <a href={`#${entry.id}`} className="-ml-px block border-l border-transparent py-1 pl-4 text-sm text-ink-2 transition-colors duration-150 hover:border-ink-3 hover:text-ink">
                        {entry.label}
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </nav>
          )}
          <article className={cx(width === "prose" ? "prose-column" : "w-full", "mx-auto")}>
            <header className={cx("border-b border-line pb-8", width === "wide" && "max-w-[680px] border-b-0 pb-0")}>
              {eyebrow && <p className="eyebrow text-ink-3">{eyebrow}</p>}
              <h1 className={cx("text-2xl font-bold text-ink lg:text-3xl", !!eyebrow && "mt-3")}>{title}</h1>
              {lede && <p className="mt-4 text-lg leading-relaxed text-ink-2">{lede}</p>}
              {meta && <p className="num mt-4 text-xs text-ink-3">{meta}</p>}
            </header>
            <div className={cx(plain ? "mt-10" : "prose-body mt-8")}>{children}</div>
          </article>
        </div>
      </main>
      <Footer />
    </div>
  );
}
