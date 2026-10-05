"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import Dialog from "@/components/ui/Dialog";
import { useMediaQuery } from "@/components/ui/useMediaQuery";
import { cx } from "@/components/ui/cx";
import type { Translate } from "../ControlPrimitives";
import { FL_RANDOM, flRandomToken, isFlSlotValue, parseFlRandom } from "@/lib/physics/modes/fightLeague";
import { FL_BY_ID, FL_CONFERENCE_IDS, FL_CONFERENCES, FL_ROSTER, conferenceOf, fightersOf, type FlConference, type FlDivision, type FlFighterRow, type FlRole } from "@/lib/physics/modes/fightLeagueRoster";
import { flTypeAhead, searchFighters } from "@/lib/physics/modes/fightLeagueSearch";

/*
 * --- fl-overhaul --- (Stage 2) The fighter picker of one slot of the Fight League block: a chip (a mini ball in the fighter's
 * colours, its name, its division and a role glyph; data-testid fl-fighter-<slot>) opening a dialog – centred near the top
 * on wide screens, a bottom sheet of at most 70 % of the height on phones; the native <dialog> keeps the focus inside and
 * gives it back to the chip – with
 *   - a search box (fl-picker-search) over names, short names, ids, sources, abilities, weapons and divisions, case- and
 *     diacritic-insensitive, ranked by lib/physics/modes/fightLeagueSearch.ts; it searches the whole roster,
 *   - division tabs grouped by conference with their counts ('All' first; fl-picker-tab-<division>, fl-picker-tab-all),
 *     opening on the slot's division,
 *   - a tile grid (3 columns on phones, 5 wider; fl-picker-tile-<value>): a 28 px ball, the name, the role and a NEW badge –
 *     and the random tiles writing the slot tokens ('Random · any' = random, 'Random · Marvel' = random:marvel, 'Random ·
 *     Anime' = random:anime),
 *   - a Recent row: the last 8 picks (localStorage, inside try/catch: without storage the row is simply empty).
 * Keys: the arrows move through the grid (the focus stays in the search box: aria-activedescendant), Enter picks, Esc closes;
 * typing searches; on a tab, typing jumps to the first fighter of the tab whose name starts with the letters (type-ahead).
 */

const RECENT_KEY = "fl-picker-recent";
const RECENT_MAX = 8;

function readRecent(): string[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((v): v is string => isFlSlotValue(v)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function pushRecent(value: string) {
  try {
    const list = [value, ...readRecent().filter((v) => v !== value)].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* no storage: the row stays empty */
  }
}

type Tab = "all" | FlDivision;

/** A tile: a fighter, or a random token (any, a division, a conference). */
interface Item {
  value: string;
  row: FlFighterRow | null;
  label: string;
}

/** The division a slot value opens the picker on ('all' for plain random and a conference token). */
function tabOf(value: string): Tab {
  const row = FL_BY_ID.get(value);
  if (row) return row.division;
  const scope = parseFlRandom(value);
  return scope?.kind === "division" ? scope.id : "all";
}

/** A small glyph per role (our own vector shapes), with the role's name as its title. */
export function RoleGlyph({ role, title, className }: { role: FlRole; title: string; className?: string }) {
  const path: Record<FlRole, ReactNode> = {
    tank: <path d="M8 1.5 13.5 3.5V8c0 3.2-2.4 5.6-5.5 6.5C4.9 13.6 2.5 11.2 2.5 8V3.5Z" />,
    bruiser: <rect x="3" y="3" width="10" height="10" rx="2" />,
    duelist: <path d="M3 3 13 13M13 3 3 13" strokeWidth="2.2" fill="none" />,
    glass: <path d="M8 1.5 14 8 8 14.5 2 8Z" fill="none" strokeWidth="1.8" />,
    ranged: (
      <>
        <circle cx="8" cy="8" r="5.5" fill="none" strokeWidth="1.6" />
        <circle cx="8" cy="8" r="1.8" />
      </>
    ),
    control: <path d="M8 1.8 13.4 4.9V11.1L8 14.2 2.6 11.1V4.9Z" fill="none" strokeWidth="1.8" />,
    summoner: (
      <>
        <circle cx="4" cy="11" r="2" />
        <circle cx="8" cy="5" r="2" />
        <circle cx="12" cy="11" r="2" />
      </>
    ),
    support: <path d="M6.5 2.5h3v4h4v3h-4v4h-3v-4h-4v-3h4Z" />,
  };
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={cx("shrink-0", className)} role="img" aria-label={title}>
      <title>{title}</title>
      {path[role]}
    </svg>
  );
}

/** A fighter's body as a CSS ball (`size` px): the body colour, the accent as a ring, a glow when the look has one; "?" for random. */
export function MiniBall({ row, size = 28 }: { row: FlFighterRow | null; size?: number }) {
  if (!row) {
    return (
      <span aria-hidden="true" className="inline-flex shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong bg-surface-2 font-bold text-ink-2" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>
        ?
      </span>
    );
  }
  const glow = row.look?.glow;
  return (
    <span
      aria-hidden="true"
      className="inline-block shrink-0 rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 35% 30%, color-mix(in srgb, ${row.body} 70%, white) 0%, ${row.body} 55%, color-mix(in srgb, ${row.body} 75%, black) 100%)`,
        boxShadow: `inset 0 0 0 ${Math.max(2, Math.round(size / 9))}px ${row.accent}${glow ? `, 0 0 ${Math.round(size / 3)}px ${glow}` : ""}`,
      }}
    />
  );
}

export interface FighterPickerProps {
  /** The Controls translator. */
  t: Translate;
  /** 0–3 (A–D). */
  slot: number;
  /** The slot's value: a fighter id or a random token. */
  value: string;
  onChange: (value: string) => void;
}

export default function FighterPicker({ t, slot, value, onChange }: FighterPickerProps) {
  const fl = useTranslations("FightLeague");
  const letter = "ABCD"[slot] ?? "A";
  const [open, setOpen] = useState(false);
  const row = FL_BY_ID.get(value) ?? null;
  const divisionLabel = (d: FlDivision) => fl(`division_${d}`);
  const conferenceLabel = (c: FlConference) => fl(`conference_${c}`);
  const tokenLabel = (v: string): string => {
    const scope = parseFlRandom(v);
    if (!scope || scope.kind === "any") return t("flPickerRandomAny");
    return scope.kind === "division" ? t("flPickerRandomDivision", { division: divisionLabel(scope.id) }) : t("flPickerRandomConference", { conference: conferenceLabel(scope.id) });
  };
  const name = row ? row.name : tokenLabel(value);
  const scopeChip = row ? divisionLabel(row.division) : null;
  return (
    <>
      <button
        type="button"
        id={`fl-fighter-${slot}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${t("flPickerOpen", { slot: letter })}: ${name}`}
        data-testid={`fl-fighter-${letter}`}
        data-value={value}
        className="flex w-full min-h-11 items-center gap-2.5 rounded-lg border border-line-strong bg-surface-2 px-2.5 py-1.5 text-left cursor-pointer hover:bg-surface-3 focus-visible:border-accent"
      >
        <MiniBall row={row} size={24} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
        {scopeChip && <span className="max-w-[45%] shrink truncate rounded-full bg-surface-3 px-2 py-0.5 text-[11px] text-ink-2">{scopeChip}</span>}
        {row && <RoleGlyph role={row.role} title={fl(`role_${row.role}`)} className="text-ink-3" />}
      </button>
      {open && (
        <PickerDialog
          t={t}
          letter={letter}
          value={value}
          onClose={() => setOpen(false)}
          onPick={(v) => {
            pushRecent(v);
            onChange(v);
            setOpen(false);
          }}
          tokenLabel={tokenLabel}
        />
      )}
    </>
  );
}

function PickerDialog({ t, letter, value, onClose, onPick, tokenLabel }: { t: Translate; letter: string; value: string; onClose: () => void; onPick: (value: string) => void; tokenLabel: (value: string) => string }) {
  const fl = useTranslations("FightLeague");
  const wide = useMediaQuery("(min-width: 640px)");
  const cols = wide ? 5 : 3;
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>(() => tabOf(value));
  const [index, setIndex] = useState(0);
  // (the dialog renders only after a click, never in the static HTML: storage is read at once)
  const [recent] = useState<string[]>(readRecent);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const id = useId();
  const listId = `${id}-list`;
  const divisionLabel = (d: FlDivision) => fl(`division_${d}`);

  const items = useMemo<Item[]>(() => {
    const fighter = (r: FlFighterRow): Item => ({ value: r.id, row: r, label: r.name });
    const token = (v: string): Item => ({ value: v, row: null, label: tokenLabel(v) });
    if (query.trim()) return searchFighters(query, FL_ROSTER, (d) => fl(`division_${d}`)).map(fighter);
    if (tab === "all") return [token(FL_RANDOM), ...FL_CONFERENCE_IDS.map((c) => token(flRandomToken(c))), ...FL_ROSTER.map(fighter)];
    const conference = conferenceOf(tab);
    const randoms = tab === "wildcard" ? [token(FL_RANDOM)] : [token(flRandomToken(tab)), ...(conference ? [token(flRandomToken(conference))] : []), token(FL_RANDOM)];
    return [...randoms, ...fightersOf(tab).map(fighter)];
    // tokenLabel and fl are stable for a render's locale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tab]);

  // The active tile of a new list: the slot's current value when it is in it, else the first one (state adjusted while
  // rendering, not in an effect).
  const [listOf, setListOf] = useState<Item[] | null>(null);
  if (listOf !== items) {
    setListOf(items);
    setIndex(Math.max(0, query.trim() ? 0 : items.findIndex((it) => it.value === value)));
  }

  const current = Math.min(index, Math.max(0, items.length - 1));
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  const move = (delta: number) => {
    if (!items.length) return;
    setIndex(Math.max(0, Math.min(items.length - 1, current + delta)));
  };
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const caretFree = !query;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      move(cols);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(-cols);
    } else if (e.key === "ArrowRight" && caretFree) {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowLeft" && caretFree) {
      e.preventDefault();
      move(-1);
    } else if (e.key === "Home" && caretFree) {
      e.preventDefault();
      setIndex(0);
    } else if (e.key === "End" && caretFree) {
      e.preventDefault();
      setIndex(items.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[current];
      if (it) onPick(it.value);
    }
  };

  const tabs: Tab[] = ["all", ...FL_CONFERENCE_IDS.flatMap((c) => [...FL_CONFERENCES[c]]), "wildcard"];
  const selectTab = (next: Tab) => {
    setQuery("");
    setTab(next);
  };
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>, at: Tab) => {
    const i = tabs.indexOf(at);
    const focusTab = (j: number) => {
      const next = tabs[(j + tabs.length) % tabs.length];
      selectTab(next);
      document.getElementById(`${id}-tab-${next}`)?.focus();
    };
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      focusTab(i + 1);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      focusTab(i - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusTab(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusTab(tabs.length - 1);
    } else if (e.key === "Enter" && items[current]) {
      e.preventDefault();
      onPick(items[current].value);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
      // Type-ahead: the letters typed within 0.8 s jump to the first fighter of this tab whose name starts with them.
      const now = e.timeStamp;
      typed.current = { text: now - typed.current.at < 800 ? typed.current.text + e.key : e.key, at: now };
      const rows = items.flatMap((it) => (it.row ? [it.row] : []));
      const hit = flTypeAhead(typed.current.text, rows);
      if (hit) setIndex(items.findIndex((it) => it.value === hit.id));
    }
  };

  const count = (d: Tab) => (d === "all" ? FL_ROSTER.length : fightersOf(d).length);
  const tabButton = (d: Tab) => {
    const on = !query.trim() && tab === d;
    const label = d === "all" ? t("flPickerAll") : divisionLabel(d);
    return (
      <button
        key={d}
        id={`${id}-tab-${d}`}
        type="button"
        role="tab"
        aria-selected={on}
        aria-controls={listId}
        tabIndex={on || (query.trim() && d === "all") ? 0 : -1}
        onClick={() => selectTab(d)}
        onKeyDown={(e) => onTabKey(e, d)}
        data-testid={`fl-picker-tab-${d}`}
        className={cx("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-medium whitespace-nowrap cursor-pointer [@media(pointer:coarse)]:min-h-10", on ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink")}
      >
        {label}
        <span className={cx("num", on ? "text-accent-ink/70" : "text-ink-3")}>{count(d)}</span>
      </button>
    );
  };

  const tile = (it: Item, i: number) => {
    const on = i === current;
    return (
      <div
        key={it.value}
        id={`${id}-o${i}`}
        role="option"
        aria-selected={on}
        data-index={i}
        data-testid={`fl-picker-tile-${it.value}`}
        onMouseMove={() => setIndex(i)}
        onClick={() => onPick(it.value)}
        className={cx("relative flex min-h-[84px] cursor-pointer flex-col items-center gap-1 rounded-lg border p-1.5 text-center", on ? "border-accent bg-surface-3" : "border-line bg-surface-2 hover:border-line-strong", it.value === value && "ring-1 ring-accent")}
      >
        <MiniBall row={it.row} />
        <span className="line-clamp-2 text-[11px] font-medium leading-tight text-ink">{it.label}</span>
        {it.row && <span className="text-[10px] leading-none text-ink-3">{fl(`role_${it.row.role}`)}</span>}
        {it.row?.isNew && <span className="absolute right-1 top-1 rounded bg-accent px-1 text-[9px] font-bold leading-4 text-accent-ink">{t("flPickerNew")}</span>}
      </div>
    );
  };

  const recentItems = recent.map((v) => ({ value: v, row: FL_BY_ID.get(v) ?? null, label: FL_BY_ID.get(v)?.name ?? tokenLabel(v) }));
  return (
    <Dialog title={t("flPickerOpen", { slot: letter })} closeLabel={t("flPickerClose")} onClose={onClose} placement={wide ? "top" : "bottom"} initialFocus={inputRef} className={wide ? "max-h-[min(640px,calc(100dvh-24vh))]" : "max-h-[70dvh]!"} bodyClassName="flex flex-col">
      <div className="shrink-0 space-y-2 border-b border-line p-3">
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={items.length ? `${id}-o${current}` : undefined}
          aria-autocomplete="list"
          aria-label={t("flPickerSearch")}
          placeholder={t("flPickerSearch")}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim()) setTab("all");
          }}
          onKeyDown={onSearchKey}
          autoComplete="off"
          spellCheck={false}
          data-testid="fl-picker-search"
          className="h-10 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-3 outline-none focus:border-accent"
        />
        <div role="tablist" aria-label={t("flFighters")} className="flex gap-1.5 overflow-x-auto pb-1">
          {tabButton("all")}
          {FL_CONFERENCE_IDS.map((c) => (
            <div key={c} role="presentation" className="flex shrink-0 items-center gap-1.5 border-l border-line pl-1.5">
              <span aria-hidden="true" className="eyebrow shrink-0 text-[10px] text-ink-3">
                {fl(`conference_${c}`)}
              </span>
              {FL_CONFERENCES[c].map((d) => tabButton(d))}
            </div>
          ))}
          <div role="presentation" className="flex shrink-0 items-center border-l border-line pl-1.5">
            {tabButton("wildcard")}
          </div>
        </div>
        {!query.trim() && recentItems.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto" data-testid="fl-picker-recent">
            <span className="shrink-0 text-[11px] font-medium text-ink-3">{t("flPickerRecent")}</span>
            {recentItems.map((it) => (
              <button key={it.value} type="button" onClick={() => onPick(it.value)} title={it.label} aria-label={it.label} data-testid={`fl-picker-recent-${it.value}`} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[11px] text-ink-2 cursor-pointer hover:border-line-strong hover:text-ink">
                <MiniBall row={it.row} size={16} />
                <span className="max-w-24 truncate">{it.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <div ref={listRef} id={listId} role="listbox" aria-label={t("flPickerOpen", { slot: letter })} className={cx("grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto p-3", wide ? "grid-cols-5" : "grid-cols-3")}>
        {items.length === 0 && <p className="col-span-full py-8 text-center text-sm text-ink-3">{t("flPickerEmpty")}</p>}
        {items.map(tile)}
      </div>
    </Dialog>
  );
}
