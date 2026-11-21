"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { ModeId } from "@/lib/physics/types";
import { MODE_SHELF_IDS, MODE_SORT_IDS, SHOW_SHELF_EVENT, WALL_QUERY_MAX, isNewMode, modeShelves, shelfOf, sortModes, wallStateFromSearch, wallStateToSearch, type ModeSort, type ShelfId } from "@/lib/siteDesign";
import { searchModes, type ModeSearchItem } from "@/lib/modeSearch"; // --- mode-search ---
import { readRecentModes, rememberRecentMode } from "@/lib/modeRecent"; // --- mode-shelves ---
import { BUILD_VERSION } from "@/lib/buildInfo";
import { assetPath } from "@/lib/site";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import Kbd from "@/components/ui/Kbd";
import { inputClass } from "@/components/ui/Field";
import { IconClose, IconSearch, IconSparkle } from "@/components/ui/icons";
import { cx } from "@/components/ui/cx";
import PosterCard from "./PosterCard";

/** Heading key (Headings namespace) of each mode family; a family without one falls back to its chip label. */
const CATEGORY_HEADINGS = { escape: "modesEscape", rhythm: "modesRhythm", battle: "modesBattle" /* --- odd-string-battle --- */, journey: "modesJourney" /* --- gerald-journey --- */, lab: "modesLab" /* --- blueprint --- */ } as const;
// --- mode-shelves --- the wall's headings are its shelves' (lib/siteDesign.ts): a shelf named like a family of the registry
// keeps that family's heading, the three shelves a visitor's words added have their own
const HEADING_KEYS: Readonly<Record<string, string>> = { ...CATEGORY_HEADINGS, music: "modesMusic", loops: "modesLoops", smash: "modesSmash" };

/**
 * --- mode-shelves --- What the studio's mode picker remembers while the page lives: the shelf, the sort and how far its
 * list was scrolled. The dialog is rendered only while it is open, so its own state is gone at every close.
 */
const pickerMemory: { shelf: ShelfId | "all"; sort: ModeSort; scrollTop: number | null } = { shelf: "all", sort: "featured", scrollTop: null };

/** The sort's down arrow (the second ink), drawn as the select's background. */
const SORT_ARROW = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none' stroke='#a8a8b0' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='m5.5 8 4.5 4.5L14.5 8'/></svg>")}")`;

/** The nearest ancestor that scrolls its content (the dialog's body, for the picker). */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let at = el.parentElement; at; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === "auto" || overflow === "scroll") return at;
  }
  return null;
}

/*
 * The modes wall. --- site-redesign --- Every mode as a poster card under its heading, with filter chips. On the landing
 * page a card links to the studio with that mode; inside the studio's mode picker (`interactive`) a card dispatches the
 * DOM event the simulator listens to, so the mode switches in place, and `onPicked` closes the picker. The section keeps
 * id="modes" either way.
 * --- mode-shelves --- The headings and chips are the shelves of lib/siteDesign.ts (escape, battle, music, loops, smash,
 * journey and lab modes: what a visitor looks for, not the registry's families of lib/modes.ts). Above them, a bar that
 * stays under the header while the wall is in view: a search field (lib/modeSearch.ts: names, one-liners, shelves and
 * search words, in the page's language and in English), a sort (Featured, Newest, A to Z) and the chips, which scroll
 * sideways on a narrow screen. A search or a sort other than Featured shows one flat grid. A card of a mode that arrived in
 * the last two minor versions wears a "New" badge.
 * On the landing page the state lives in the address (?family=battle&q=merge&sort=az, written with replaceState and read
 * after mount, so the first render is the server's), and "/" focuses the search. In the picker the search takes the focus
 * on open (on a touch screen the current card does, so no keyboard covers the cards), a Recent row holds the last picks,
 * the shelf, the sort and the scroll position are remembered, the current card is scrolled into view, the arrow keys move
 * between the cards, and "Surprise me" picks a mode at random.
 */
export default function ModesOverview({
  interactive = false,
  current,
  onPicked,
  variant = "page",
  focusRef,
  surpriseLabel,
}: {
  interactive?: boolean;
  current?: ModeId;
  onPicked?: () => void;
  variant?: "page" | "picker";
  /** The picker's dialog focuses this on open: the wall points it at its search field, or at the current card on a touch screen. */
  focusRef?: RefObject<HTMLElement | null>;
  /** The name of the picker's random pick (the studio's "Surprise me"); without it there is no such button. */
  surpriseLabel?: string;
}) {
  const t = useTranslations("Modes");
  const headings = useTranslations("Headings");
  const s = useTranslations("SiteRedesign");
  const locale = useLocale();
  const picker = variant === "picker";
  const [shelf, setShelf] = useState<ShelfId | "all">(picker ? pickerMemory.shelf : "all");
  const [sort, setSort] = useState<ModeSort>(picker ? pickerMemory.sort : "featured");
  const [query, setQuery] = useState("");
  /** The landing page has read its address: only then may the wall write it. */
  const [addressRead, setAddressRead] = useState(false);
  const [recent, setRecent] = useState<ModeId[]>([]);
  /** The card the arrow keys last stood on (the picker's one tab stop among the cards). */
  const [stoodOn, setStoodOn] = useState<ModeId | null>(null);
  const [chipsFade, setChipsFade] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  /** Where the wall's content starts, right under the bar. */
  const startRef = useRef<HTMLDivElement>(null);
  /** The visitor changed the search, the shelf or the sort: the new list is shown from its start. */
  const fromStart = useRef(false);

  const shelves = modeShelves();
  const every = shelves.flatMap((f) => f.modes);
  const total = every.length;
  const chipLabel = (id: string) => (s.has(`families.${id}`) ? s(`families.${id}`) : id.charAt(0).toUpperCase() + id.slice(1));
  const heading = (id: string) => (HEADING_KEYS[id] ? headings(HEADING_KEYS[id]) : chipLabel(id));
  const nameOf = (id: ModeId) => t(`${id}.name`);

  // What the search finds (best first), then the chosen shelf's part of it, then the sort.
  const q = query.trim();
  const items = (): ModeSearchItem[] => every.map((id) => ({ id, name: nameOf(id), description: t(`${id}.description`), shelf: chipLabel(shelfOf(id)) }));
  const found = q ? searchModes(items(), q, locale) : every;
  const countOn = (id: ShelfId | "all") => (id === "all" ? found.length : found.filter((m) => shelfOf(m) === id).length);
  const onShelf = shelf === "all" ? found : found.filter((m) => shelfOf(m) === shelf);
  const flat = !!q || sort !== "featured";
  const listed = sort === "featured" ? onShelf : sortModes(onShelf, sort, nameOf, locale);
  const tabStop = stoodOn && listed.includes(stoodOn) ? stoodOn : current && listed.includes(current) ? current : listed[0];

  const changeQuery = (value: string) => {
    const next = value.slice(0, WALL_QUERY_MAX);
    if (next === query) return;
    fromStart.current = true;
    setQuery(next);
    // a search looks on the chosen shelf while something there matches, else on every shelf
    if (shelf !== "all" && next.trim() && !searchModes(items(), next, locale).some((m) => shelfOf(m) === shelf)) setShelf("all");
  };
  const clearSearch = () => {
    changeQuery("");
    inputRef.current?.focus({ preventScroll: true });
  };
  const changeShelf = (id: ShelfId | "all") => {
    if (id === shelf) return;
    fromStart.current = true;
    setShelf(id);
  };
  const changeSort = (id: ModeSort) => {
    if (id === sort) return;
    fromStart.current = true;
    setSort(id);
  };

  const pick = (id: ModeId) => {
    rememberRecentMode(id, current);
    window.dispatchEvent(new CustomEvent("jumpingballslive:select-mode", { detail: id }));
    onPicked?.();
  };
  const surprise = () => {
    const others = every.filter((m) => m !== current);
    if (others.length) pick(others[Math.floor(Math.random() * others.length)]);
  };

  // --- mode-shelves --- the landing page: the wall's state comes from the address after mount, follows Back and Forward, and
  // a link to a shelf clicked on this very page (the footer's)
  useEffect(() => {
    if (picker) return;
    const read = () => {
      const state = wallStateFromSearch(window.location.search);
      setShelf(state.shelf);
      setQuery(state.query);
      setSort(state.sort);
    };
    const show = (e: Event) => {
      const id = (e as CustomEvent<unknown>).detail;
      if (typeof id !== "string" || !(MODE_SHELF_IDS as readonly string[]).includes(id)) return;
      setShelf(id as ShelfId);
      setQuery("");
    };
    read();
    setAddressRead(true);
    window.addEventListener("popstate", read);
    window.addEventListener(SHOW_SHELF_EVENT, show);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener(SHOW_SHELF_EVENT, show);
    };
  }, [picker]);
  // ... and goes back into it a moment after it changes (replaceState: no history entry per letter; other parameters stay).
  // A filtered wall's address ends in #modes, so a shared link opens on the wall.
  useEffect(() => {
    if (picker || !addressRead) return;
    const timer = window.setTimeout(() => {
      try {
        const search = wallStateToSearch({ shelf, query, sort }, window.location.search);
        if (search === window.location.search) return;
        const filtered = shelf !== "all" || !!query.trim() || sort !== "featured";
        window.history.replaceState(null, "", `${window.location.pathname}${search}${filtered ? "#modes" : window.location.hash}`);
      } catch {
        /* an address that cannot be written (a browser that limits how often): the wall works without it */
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [picker, addressRead, shelf, query, sort]);

  // --- mode-shelves --- "/" focuses the search of the landing page, unless the visitor is typing somewhere or a dialog is open
  useEffect(() => {
    if (picker) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const at = document.activeElement;
      if (at instanceof HTMLElement && (at.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(at.tagName))) return;
      if (document.querySelector("dialog[open]")) return;
      const input = inputRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus({ preventScroll: true });
      input.select();
      // (the bar is in view while the wall is: only a visitor above or below the wall is taken to it)
      const box = input.getBoundingClientRect();
      if (box.top < 56 || box.bottom > window.innerHeight) sectionRef.current?.scrollIntoView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [picker]);

  // --- mode-shelves --- the picker: the last picks (this browser's storage, read after mount), and what its dialog focuses
  useEffect(() => {
    if (!picker) return;
    setRecent(readRecentModes());
    if (!focusRef) return;
    const touch = typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
    const card = current ? sectionRef.current?.querySelector<HTMLElement>(`[data-mode-card="${current}"]`) : null;
    focusRef.current = touch ? (card ?? chipsRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]') ?? inputRef.current) : inputRef.current;
    // Read once, as the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // ... where its list was scrolled to, with the current mode's card in view (after the dialog has opened: next frame)
  useEffect(() => {
    if (!picker) return;
    const section = sectionRef.current;
    const scroller = section ? scrollerOf(section) : null;
    if (!section || !scroller) return;
    const frame = window.requestAnimationFrame(() => {
      if (pickerMemory.scrollTop !== null) scroller.scrollTop = pickerMemory.scrollTop;
      const card = current ? section.querySelector<HTMLElement>(`[data-mode-card="${current}"]`) : null;
      if (!card) return;
      const box = card.getBoundingClientRect();
      const top = barRef.current?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top;
      if (box.top < top || box.bottom > scroller.getBoundingClientRect().bottom) card.scrollIntoView({ block: "center" });
    });
    const onScroll = () => {
      pickerMemory.scrollTop = scroller.scrollTop;
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!picker) return;
    pickerMemory.shelf = shelf;
    pickerMemory.sort = sort;
  }, [picker, shelf, sort]);

  // --- mode-shelves --- a list the visitor just changed starts right under the bar: someone deep in the wall who types a
  // search would otherwise look at the end of a shorter list, or past it, with the bar gone. Only then: the state read from
  // the address leaves the scroll position alone, so Back returns to the card a visitor left from.
  useEffect(() => {
    if (!fromStart.current) return;
    fromStart.current = false;
    const start = startRef.current;
    const bar = barRef.current;
    if (!start || !bar) return;
    const scroller = picker ? scrollerOf(start) : null;
    const under = (scroller ? scroller.getBoundingClientRect().top : 56) + bar.getBoundingClientRect().height;
    const delta = start.getBoundingClientRect().top - under;
    if (delta >= -1) return;
    if (scroller) scroller.scrollTop += delta;
    else window.scrollBy({ top: delta, behavior: "instant" });
  }, [picker, query, shelf, sort]);

  // --- mode-shelves --- the chips scroll sideways when they do not fit: a fade on the right says there are more
  useEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const update = () => setChipsFade(row.scrollWidth - row.clientWidth - row.scrollLeft > 4);
    update();
    row.addEventListener("scroll", update, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [locale]);

  // ... and the pressed chip is in view in its row (a shelf from the address or the picker's memory may sit past the edge)
  useEffect(() => {
    const row = chipsRef.current;
    const chip = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !chip) return;
    const box = chip.getBoundingClientRect();
    const frame = row.getBoundingClientRect();
    if (box.left < frame.left + 16 || box.right > frame.right - 16) row.scrollLeft += box.left - frame.left - (frame.width - box.width) / 2;
  }, [shelf]);

  /** Where an arrow key leads from a card of the picker: the cards in reading order, a row being the cards at one height. */
  const moveFrom = (from: HTMLElement, key: string): HTMLElement | "search" | null => {
    const cards = Array.from(sectionRef.current?.querySelectorAll<HTMLElement>("[data-mode-card]") ?? []);
    const index = cards.indexOf(from);
    if (index < 0) return null;
    if (key === "ArrowRight") return cards[index + 1] ?? null;
    if (key === "ArrowLeft") return cards[index - 1] ?? null;
    if (key === "Home") return cards[0];
    if (key === "End") return cards[cards.length - 1];
    const here = from.getBoundingClientRect();
    const down = key === "ArrowDown";
    const away = cards.map((el) => ({ el, box: el.getBoundingClientRect() })).map((c) => ({ ...c, dy: down ? c.box.top - here.top : here.top - c.box.top })).filter((c) => c.dy > 8);
    if (!away.length) return down ? null : "search";
    const nearest = Math.min(...away.map((c) => c.dy));
    return away.filter((c) => c.dy < nearest + 8).reduce((a, b) => (Math.abs(b.box.left - here.left) < Math.abs(a.box.left - here.left) ? b : a)).el;
  };
  const onCardKey = (e: KeyboardEvent<HTMLDivElement>, id: ModeId) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(id);
      return;
    }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
    const to = moveFrom(e.currentTarget, e.key);
    if (!to) return;
    e.preventDefault();
    if (to === "search") inputRef.current?.focus();
    else to.focus();
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const first = () => sectionRef.current?.querySelector<HTMLElement>("[data-mode-card]");
    if (e.key === "Enter" && q) {
      // the best match: the link opens the studio, the picker's card switches the mode
      e.preventDefault();
      first()?.click();
    } else if (e.key === "ArrowDown" && interactive) {
      e.preventDefault();
      (sectionRef.current?.querySelector<HTMLElement>('[data-mode-card][tabindex="0"]') ?? first())?.focus();
    } else if (e.key === "Escape" && query) {
      // Esc empties a search first (in the picker too: the dialog closes on the next one)
      e.preventDefault();
      changeQuery("");
    }
  };

  const card = (id: ModeId, headingLevel: "h3" | "h4") => {
    const name = nameOf(id);
    const isCurrent = current === id;
    const badge = isCurrent ? (
      <span className="eyebrow rounded-sm bg-accent px-1.5 py-0.5 text-accent-ink">{s("modesWall.current")}</span>
    ) : isNewMode(id, BUILD_VERSION) ? (
      <span className="eyebrow rounded-sm bg-ink px-1.5 py-0.5 text-bg" data-testid="mode-new">
        {s("modesWall.new")}
      </span>
    ) : undefined;
    const content = (
      <PosterCard
        image={assetPath(`/modes/${id}.webp`)}
        alt={t("previewAlt", { name }) /* --- review fix (ui-i18n) --- */}
        name={name}
        tag={chipLabel(shelfOf(id))}
        description={t(`${id}.description`)}
        current={isCurrent}
        badge={badge}
        headingLevel={headingLevel}
      />
    );
    // (a card the keyboard moves to stops clear of the header and the bar)
    const cardClass = cx("group block min-w-0 rounded-xl cursor-pointer", picker ? "scroll-mt-40" : "scroll-mt-48");
    return interactive ? (
      <div key={id} role="button" tabIndex={id === tabStop ? 0 : -1} aria-pressed={isCurrent} data-mode-card={id} className={cardClass} onClick={() => pick(id)} onKeyDown={(e) => onCardKey(e, id)} onFocus={() => setStoodOn(id)}>
        {content}
      </div>
    ) : (
      <Link key={id} href={`/simulator?mode=${id}`} data-mode-card={id} className={cardClass} onClick={() => rememberRecentMode(id)}>
        {content}
      </Link>
    );
  };

  const surpriseClass = "shrink-0 items-center justify-center gap-2 rounded-full border border-line text-sm font-medium whitespace-nowrap text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink cursor-pointer [@media(pointer:coarse)]:min-h-11";
  const chips = (
    <div ref={chipsRef} className={cx("-mx-4 mt-2 flex overflow-x-auto px-4 py-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden", chipsFade && "[mask-image:linear-gradient(to_right,#000_calc(100%_-_3rem),transparent)]")}>
      {picker && surpriseLabel && (
        <button type="button" onClick={surprise} aria-label={surpriseLabel} title={surpriseLabel} data-testid="modes-surprise-chip" className={cx("mr-2 inline-flex sm:hidden", surpriseClass, "h-8 w-8 [@media(pointer:coarse)]:min-w-11")}>
          <IconSparkle size={16} className="text-accent" />
        </button>
      )}
      <div role="group" aria-label={s("modesWall.filterLabel")} className="flex gap-2">
        <Chip pressed={shelf === "all"} onClick={() => changeShelf("all")} count={countOn("all")}>
          {s("modesWall.all")}
        </Chip>
        {shelves.map((f) => (
          <Chip key={f.id} pressed={shelf === f.id} onClick={() => changeShelf(f.id)} count={countOn(f.id)} disabled={!!q && shelf !== f.id && countOn(f.id) === 0} className="disabled:cursor-not-allowed disabled:opacity-40">
            {chipLabel(f.id)}
          </Chip>
        ))}
      </div>
    </div>
  );

  // --- mode-shelves --- the bar: sticky under the 56 px header on the page, at the top of the dialog's body in the picker
  const bar = (
    <div ref={barRef} data-testid="modes-bar" className={cx("sticky z-30 border-b border-line", picker ? "top-0 -mx-4 -mt-4 bg-surface-1 px-4 pb-2 pt-4 sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6" : "top-14 -mx-4 mt-8 bg-bg px-4 py-2 sm:-mx-6 sm:px-6")}>
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-xs">
          {/* (the picker on a phone leaves the glass out: its field is 150 px wide at 360 px, and the placeholder says what it is) */}
          <IconSearch size={16} className={cx("pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3", picker && "hidden sm:block")} />
          <input
            ref={inputRef}
            type="search"
            enterKeyHint="search"
            value={query}
            onChange={(e) => changeQuery(e.target.value)}
            onKeyDown={onSearchKey}
            aria-label={s("modesWall.search")}
            placeholder={s("modesWall.search")}
            autoComplete="off"
            spellCheck={false}
            data-testid="modes-search"
            // (16 px text on a touch screen: a phone's browser zooms the page into a field with smaller text)
            className={cx(inputClass, "[&::-webkit-search-cancel-button]:appearance-none [@media(pointer:coarse)]:text-base", picker ? "pl-3 sm:pl-9" : "pl-9", query ? "pr-10" : picker ? "pr-3" : "pr-3 [@media(pointer:fine)]:pr-10")}
          />
          {query ? (
            <button
              type="button"
              onClick={clearSearch}
              aria-label={s("modesWall.clear")}
              className="absolute right-1 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 hover:bg-surface-2 hover:text-ink cursor-pointer [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
            >
              <IconClose size={14} />
            </button>
          ) : (
            !picker && (
              <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 [@media(pointer:fine)]:block">
                <Kbd>/</Kbd>
              </span>
            )
          )}
        </div>
        <label className="ml-auto flex shrink-0 items-center gap-2">
          <span className="sr-only text-sm text-ink-3 sm:not-sr-only">{s("modesWall.sortLabel")}</span>
          <select
            value={sort}
            onChange={(e) => changeSort(e.target.value as ModeSort)}
            data-testid="modes-sort"
            style={{ backgroundImage: SORT_ARROW, backgroundSize: "16px 16px", backgroundPosition: "right 8px center" }}
            className="h-9 appearance-none rounded-md border border-line bg-surface-1 bg-no-repeat pl-3 pr-8 text-md text-ink transition-colors duration-150 hover:border-line-strong focus:border-accent-dim cursor-pointer [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:text-base"
          >
            {MODE_SORT_IDS.map((id) => (
              <option key={id} value={id}>
                {s(`modesWall.sort.${id}`)}
              </option>
            ))}
          </select>
        </label>
        {/* (from 640 px: on a phone the search needs the room, and the random pick leads the chip row) */}
        {picker && surpriseLabel && (
          <button type="button" onClick={surprise} data-testid="modes-surprise" className={cx("hidden sm:inline-flex", surpriseClass, "h-9 px-3")}>
            <IconSparkle size={16} className="text-accent" />
            {surpriseLabel}
          </button>
        )}
      </div>
      {chips}
    </div>
  );

  const shownRecent = picker && !q ? recent.filter((id) => id !== current && every.includes(id)) : [];

  // One grid for the whole wall: a family with a full row of modes or more spans every column, a small family (one or two
  // modes) only as many as it has, so small families share a row. Each family is a subgrid of it (its heading on top).
  // --- review fix (blueprint) --- a family packs its rows at the top (content-start): sharing a row with a taller family, its
  // heading would otherwise grow to fill the row and push its divider and cards out of line with its neighbour's
  // --- mode-shelves --- (a search or a sort shows the cards alone, in one flat grid of the same columns)
  const wallGrid = cx("grid gap-x-4", flat ? "gap-y-8" : "gap-y-12", picker ? "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5");

  return (
    <section ref={sectionRef} id="modes" aria-labelledby={variant === "page" ? "modes-title" : undefined} aria-label={picker ? s("studio.modePicker") : undefined} className={variant === "page" ? "site-container scroll-mt-20 py-16 sm:py-20" : "p-4 sm:p-6"}>
      {variant === "page" && (
        <div>
          <h2 id="modes-title" className="text-2xl font-bold text-ink">
            {headings("modes")}
          </h2>
          <p className="mt-3 max-w-[58ch] text-md text-ink-2">{s("modesWall.intro", { count: total })}</p>
        </div>
      )}
      {bar}
      <div ref={startRef} />
      {/* --- mode-shelves --- what a search found, said aloud too; with nothing found, the way back */}
      <div className={q ? (listed.length ? "mt-4" : "flex flex-col items-center gap-4 py-16 text-center") : "sr-only"}>
        <p aria-live="polite" data-testid="modes-found" className={listed.length ? "text-sm text-ink-3" : "text-md text-ink-2"}>
          {q ? (listed.length ? s("modesWall.found", { count: listed.length }) : s("modesWall.empty", { query: q })) : ""}
        </p>
        {q && listed.length === 0 && (
          <Button variant="secondary" size="sm" onClick={clearSearch}>
            {s("modesWall.clear")}
          </Button>
        )}
      </div>
      {shownRecent.length > 0 && (
        <div className="mt-4 flex items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-testid="modes-recent">
          <span className="eyebrow shrink-0 text-ink-3">{s("modesWall.recent")}</span>
          {shownRecent.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => pick(id)}
              className="inline-flex h-8 shrink-0 items-center gap-2 rounded-full border border-line pl-1 pr-3 text-sm whitespace-nowrap text-ink-2 transition-colors duration-150 hover:border-line-strong hover:text-ink cursor-pointer [@media(pointer:coarse)]:min-h-11"
            >
              {/* (a background, not a picture: the row repeats cards of the wall below) */}
              <span aria-hidden="true" className="h-6 w-6 rounded-full bg-surface-3 bg-cover bg-center" style={{ backgroundImage: `url("${assetPath(`/modes/${id}.webp`)}")` }} />
              {nameOf(id)}
            </button>
          ))}
        </div>
      )}
      <div className={cx(wallGrid, picker ? "mt-6" : "mt-10")}>
        {flat
          ? listed.map((m) => card(m, "h3"))
          : shelves
              .filter((f) => shelf === "all" || f.id === shelf)
              .map(({ id, modes }) => (
                <div key={id} className="grid grid-cols-subgrid content-start gap-y-0" style={{ gridColumn: modes.length > 2 ? "1 / -1" : `span ${modes.length}` }}>
                  <h3 className="col-span-full mb-5 flex items-baseline gap-3 border-b border-line pb-3 text-md font-medium text-ink">
                    {heading(id)}
                    <span aria-hidden="true" className="num text-xs text-ink-3">
                      {modes.length}
                    </span>
                  </h3>
                  <div className="col-span-full grid grid-cols-subgrid gap-y-8">{modes.map((m) => card(m, "h4"))}</div>
                </div>
              ))}
      </div>
    </section>
  );
}
