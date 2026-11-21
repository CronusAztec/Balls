import { describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { MODE_CARD_ORDER } from "@/lib/modes";
import {
  MODE_SHELF_IDS,
  MODE_SHELVES,
  MODE_SINCE,
  MODE_SINCE_BASELINE,
  MODE_SORT_IDS,
  WALL_DEFAULTS,
  WALL_QUERY_MAX,
  aspectRatioLabel,
  familyOf,
  isNewMode,
  modeFamilies,
  modeShelves,
  modesForFilter,
  modesOnShelf,
  modeNeighbours,
  paletteControlEntries,
  paletteMatches,
  shelfOf,
  sortModes,
  wallStateFromSearch,
  wallStateToSearch,
  type PaletteEntry,
  type PaletteGroup,
} from "@/lib/siteDesign";
import { MODE_SEARCH_WORDS, SEARCH_LOCALES, SHELF_SEARCH_WORDS, modePaletteWords, modeSearchWords, searchModes, type ModeSearchItem } from "@/lib/modeSearch"; // --- mode-search ---
import { RECENT_MODES_KEY, RECENT_MODES_MAX, parseRecentModes, readRecentModes, rememberRecentMode, withRecentMode } from "@/lib/modeRecent"; // --- mode-shelves ---
import changelog from "@/content/changelog.json";
import pkg from "../package.json";
import { paletteKeyGroups, type ControlSection } from "@/components/simulator/Controls";
import { MODE_BLOCK_KEYS, MODE_BLOCK_KEY_SET, sectionKeyShown, wallControlsOf, type PanelShown } from "@/components/simulator/panelKeys";
import { supportsObstacles } from "@/lib/physics/obstacleEditor";
import { SETTING_SEARCH_WORDS, settingSearchWords } from "@/components/simulator/panelKeys"; // --- panel-basics ---
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/* --- site-redesign --- the pure parts of the new layout: mode families, the stage strip's format, the palette matcher,
   the messages of the redesign and the design rules the sweep established. */

type Tree = { [key: string]: string | Tree };
const flat = (tree: Tree, prefix = ""): string[] => Object.entries(tree).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));

describe("mode families", () => {
  it("cover every mode exactly once, in card order, and only non-empty families", () => {
    const families = modeFamilies();
    const all = families.flatMap((f) => f.modes);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(MODE_CARD_ORDER.filter((m) => MODE_IDS.includes(m)).sort());
    for (const f of families) {
      expect(f.modes.length).toBeGreaterThan(0);
      for (const m of f.modes) expect(familyOf(m)).toBe(f.id);
      expect(f.modes).toEqual(MODE_CARD_ORDER.filter((m) => f.modes.includes(m)));
    }
  });

  it("filter to one family or show them all", () => {
    expect(modesForFilter("all")).toEqual(modeFamilies().flatMap((f) => f.modes));
    for (const f of modeFamilies()) expect(modesForFilter(f.id)).toEqual(f.modes);
  });

  it("have a translated chip label in every language", () => {
    for (const m of [en, pl, es]) for (const f of modeFamilies()) expect((m.SiteRedesign.families as Record<string, string>)[f.id]?.length ?? 0).toBeGreaterThan(0);
  });
});

/* --- mode-shelves --- the visitor's layer over the registry: where the wall, the picker and the footer put each mode */
describe("mode shelves", () => {
  const cap = (id: string) => id[0].toUpperCase() + id.slice(1);

  it("place every mode with a card exactly once, on the shelves in their order", () => {
    const shelves = modeShelves();
    expect(shelves.map((f) => f.id)).toEqual([...MODE_SHELF_IDS]);
    const all = shelves.flatMap((f) => f.modes);
    expect(new Set(all).size).toBe(all.length);
    // the wall shows exactly the modes the hero counts (the smoke suite compares the two numbers)
    expect([...all].sort()).toEqual([...modesForFilter("all")].sort());
    expect(Object.keys(MODE_SHELVES).sort()).toEqual([...MODE_IDS].sort());
    for (const f of shelves) {
      expect(f.modes.length).toBeGreaterThan(0);
      for (const m of f.modes) expect(shelfOf(m)).toBe(f.id);
      expect(modesOnShelf(f.id)).toEqual(f.modes);
      // a shelf's order is the order MODE_SHELVES writes its modes in
      expect(f.modes).toEqual((Object.keys(MODE_SHELVES) as ModeId[]).filter((m) => MODE_SHELVES[m] === f.id));
    }
    expect(modesOnShelf("all")).toEqual(all);
  });

  it("put every fight, team game and race under Battle with Fight League first, and none of them elsewhere", () => {
    const battle = modesOnShelf("battle");
    expect(battle[0]).toBe("fightLeague");
    expect(battle).toEqual(expect.arrayContaining(["fightLeague", "battle", "stringBattle", "ctf", "territory", "landClaim", "race", "maze"]));
    // (the registry's own "rhythm" family holds four of them: the catch-all the shelves replace on the wall)
    expect(["battle", "ctf", "fightLeague", "race"].map((m) => familyOf(m as ModeId))).toEqual(["rhythm", "rhythm", "rhythm", "rhythm"]);
  });

  it("keep the neighbours the smoke suite looks for under one heading", () => {
    const together: [ModeId[], string][] = [
      [["runner", "paddle", "drop", "beatDrop"], "music"],
      [["orbGrid", "pendulum", "hoops", "starChords", "illusion"], "loops"],
      [["classic", "conveyor", "colourSort", "brickRebuild"], "escape"],
      [["maze", "stringBattle", "landClaim", "territory", "fightLeague", "ctf"], "battle"],
      [["mergeRing", "spiralGlass", "glass"], "smash"],
      [["journey"], "journey"],
      [["blueprint"], "lab"],
    ];
    for (const [modes, shelf] of together) for (const m of modes) expect(shelfOf(m), m).toBe(shelf);
    // Journey and Lab are one card each, so they share the wall's last row (the smoke suite needs a shared row)
    expect(modeShelves().slice(-2).map((f) => [f.id, f.modes.length])).toEqual([["journey", 1], ["lab", 1]]);
  });

  it("have a chip label and a heading in every language, and only the Music heading says rhythm", () => {
    for (const [locale, m] of [["en", en], ["pl", pl], ["es", es]] as const) {
      for (const id of MODE_SHELF_IDS) {
        expect((m.SiteRedesign.families as Record<string, string>)[id]?.length ?? 0, `${locale} families.${id}`).toBeGreaterThan(0);
        expect((m.Headings as Record<string, string>)[`modes${cap(id)}`]?.length ?? 0, `${locale} Headings.modes${cap(id)}`).toBeGreaterThan(0);
      }
    }
    // scripts/smoke-test.mjs finds the Beat Runner's shelf as the first heading that says "rhythm", and looks these three up by name
    const headings = en.Headings as Record<string, string>;
    expect(MODE_SHELF_IDS.filter((id) => /rhythm/i.test(headings[`modes${cap(id)}`]))).toEqual(["music"]);
    expect([headings.modesEscape, headings.modesBattle, headings.modesJourney]).toEqual(["Escape modes", "Battle modes", "Journey modes"]);
    expect([headings.modesMusic, headings.modesLoops, headings.modesSmash]).toEqual(["Music & rhythm modes", "Loop & pattern modes", "Smash & merge modes"]);
  });

  // --- studio-fit --- the stage strip's arrows
  it("give every mode on the wall a previous and a next mode in the wall's order, round from the last to the first", () => {
    const all = modesOnShelf("all");
    all.forEach((mode, i) => expect(modeNeighbours(mode), mode).toEqual({ prev: all[(i - 1 + all.length) % all.length], next: all[(i + 1) % all.length] }));
    expect(modeNeighbours(all[0])?.prev).toBe("blueprint"); // Mode Lab ends the wall
    expect(modeNeighbours("blueprint")?.next).toBe(all[0]);
    // stepping on from any mode visits every mode once and comes back
    const seen: ModeId[] = [];
    for (let at: ModeId = all[0]; seen.length <= all.length && !seen.includes(at); at = modeNeighbours(at)!.next) seen.push(at);
    expect(seen).toEqual(all);
    expect(modeNeighbours("classic", ["classic"])).toBeNull();
    expect(modeNeighbours("classic", ["portal", "grow"])).toBeNull();
  });
});

/* --- mode-shelves --- the Newest sort and the "New" badge */
describe("when each mode arrived", () => {
  const parts = (v: string) => v.split(".").map(Number);
  const newer = (a: string, b: string) => parts(a)[0] - parts(b)[0] || parts(a)[1] - parts(b)[1] || parts(a)[2] - parts(b)[2];
  const site = (changelog.releases as { product: string; version: string; headline: { en: string }; items: { text: { en: string } }[] }[]).filter((r) => r.product === "site");

  it("is the website version whose release notes first name the mode, 1.0.0 for the ten ring modes", () => {
    expect(site.length).toBeGreaterThan(10);
    const oldestFirst = [...site].sort((a, b) => newer(a.version, b.version));
    const baseline = MODE_IDS.filter((m) => MODE_SINCE[m] === MODE_SINCE_BASELINE);
    expect([...baseline].sort()).toEqual(["accumulation", "classic", "colorMatch", "grow", "lines", "multiply", "paint", "portal", "shatter", "target"]);
    for (const mode of MODE_IDS) {
      expect(MODE_SINCE[mode], mode).toMatch(/^\d+\.\d+\.\d+$/);
      if (baseline.includes(mode)) continue;
      const name = (en.Modes as Record<string, { name?: string }>)[mode]?.name ?? "";
      expect(name, mode).not.toBe("");
      const first = oldestFirst.find((r) => [r.headline.en, ...r.items.map((i) => i.text.en)].some((text) => text.includes(name)));
      // a mode no release names yet is one still being built: it carries the version it will ship in, not an old one
      if (first) expect(MODE_SINCE[mode], `${mode} (${name}) is first named in ${first.version}`).toBe(first.version);
      else expect(newer(MODE_SINCE[mode], pkg.version), `${mode} (${name}) is in no release note yet`).toBeGreaterThanOrEqual(0);
    }
  });

  it("marks a mode new for two minor versions, and one that is ahead of the site", () => {
    expect(MODE_SINCE.blueprint).toBe("1.15.0");
    expect(["1.14.0", "1.15.0", "1.15.3", "1.16.0", "1.17.0", "1.18.0"].map((v) => isNewMode("blueprint", v))).toEqual([true, true, true, true, false, false]);
    expect(isNewMode("classic", "1.1.0")).toBe(true);
    expect(isNewMode("classic", "1.2.0")).toBe(false);
    expect(isNewMode("blueprint", "1.17.0", 3)).toBe(true);
    // another major version, or a version that is not one (vitest's and a broken build's "0.0.0-dev"), marks nothing
    for (const mode of MODE_IDS) expect(isNewMode(mode, "2.0.0") || isNewMode(mode, "0.0.0-dev") || isNewMode(mode, ""), mode).toBe(false);
  });

  it("sorts by arrival, newest first, and by name in the page's language", () => {
    expect([...MODE_SORT_IDS]).toEqual(["featured", "newest", "az"]);
    const some: ModeId[] = ["classic", "drop", "mergeRing", "multiply", "blueprint", "fightLeague"];
    const name = (m: ModeId) => (en.Modes as unknown as Record<string, { name: string }>)[m].name;
    expect(sortModes(some, "featured", name, "en")).toEqual(some);
    expect(sortModes(some, "featured", name, "en")).not.toBe(some);
    // modes of one version keep the order they came in (classic before multiply)
    expect(sortModes(some, "newest", name, "en")).toEqual(["blueprint", "mergeRing", "fightLeague", "drop", "classic", "multiply"]);
    expect(sortModes(some, "az", name, "en")).toEqual(["drop", "classic", "fightLeague", "mergeRing", "blueprint", "multiply"]); // Ball Drop, Classic, Fight League, Merge Ring, Mode Lab, Multiply
    const polish: Partial<Record<ModeId, string>> = { classic: "Żaba", drop: "ananas", box: "Łoś", glass: "Zebra", grow: "Lot" };
    expect(sortModes(["classic", "drop", "box", "glass", "grow"], "az", (m) => polish[m] ?? "", "pl")).toEqual(["drop", "grow", "box", "glass", "classic"]);
    const all = modesOnShelf("all");
    const newest = sortModes(all, "newest", name, "en");
    expect([...newest].sort()).toEqual([...all].sort());
    for (let i = 1; i < newest.length; i++) expect(newer(MODE_SINCE[newest[i - 1]], MODE_SINCE[newest[i]]), `${newest[i - 1]} before ${newest[i]}`).toBeGreaterThanOrEqual(0);
  });
});

/* --- mode-shelves --- ?family=battle&q=merge&sort=az on the landing page */
describe("the wall's state in the address", () => {
  it("reads the shelf, the search and the sort, and falls back to the default for anything else", () => {
    expect(wallStateFromSearch("")).toEqual(WALL_DEFAULTS);
    expect(WALL_DEFAULTS).toEqual({ shelf: "all", query: "", sort: "featured" });
    expect(wallStateFromSearch("?family=battle&q=merge%20ring&sort=az")).toEqual({ shelf: "battle", query: "merge ring", sort: "az" });
    expect(wallStateFromSearch("?family=rhythm&sort=oldest&utm_source=x")).toEqual(WALL_DEFAULTS); // (the registry's family is no shelf)
    expect(wallStateFromSearch("?family=__proto__&sort=constructor")).toEqual(WALL_DEFAULTS);
    expect(wallStateFromSearch(`?q=${"a".repeat(200)}`).query).toHaveLength(WALL_QUERY_MAX);
  });

  it("writes only what differs from the default and keeps every other parameter", () => {
    expect(wallStateToSearch(WALL_DEFAULTS)).toBe("");
    expect(wallStateToSearch({ shelf: "battle", query: "", sort: "featured" })).toBe("?family=battle");
    expect(wallStateToSearch({ shelf: "battle", query: "  merge ring ", sort: "az" }, "?utm_source=clip&family=escape")).toBe("?utm_source=clip&family=battle&q=merge+ring&sort=az");
    expect(wallStateToSearch(WALL_DEFAULTS, "?family=battle&q=a&sort=newest&utm_source=clip")).toBe("?utm_source=clip");
    expect(wallStateToSearch(WALL_DEFAULTS, "?family=battle&q=a")).toBe("");
  });

  it("round-trips every shelf with every sort", () => {
    for (const shelf of ["all", ...MODE_SHELF_IDS] as const) {
      for (const sort of MODE_SORT_IDS) {
        const state = { shelf, query: "żółw & co", sort };
        expect(wallStateFromSearch(wallStateToSearch(state, "?gclid=1"))).toEqual(state);
      }
    }
  });
});

/* --- mode-search --- the search field of the wall and the picker */
describe("mode search", () => {
  const CATALOGS = { en, pl, es } as const;
  const itemsOf = (locale: keyof typeof CATALOGS): ModeSearchItem[] =>
    modesOnShelf("all").map((id) => {
      const mode = (CATALOGS[locale].Modes as unknown as Record<string, { name: string; description: string }>)[id];
      return { id, name: mode.name, description: mode.description, shelf: (CATALOGS[locale].SiteRedesign.families as Record<string, string>)[shelfOf(id)] };
    });
  const find = (locale: keyof typeof CATALOGS, query: string) => searchModes(itemsOf(locale), query, locale);

  it("finds every mode first by its own name, in every language", () => {
    for (const locale of SEARCH_LOCALES) for (const item of itemsOf(locale)) expect(find(locale, item.name)[0], `${locale} "${item.name}"`).toBe(item.id);
  });

  it("finds what a visitor wants to see: a fight, a race, a merge, a loop, music, a countdown", () => {
    expect(find("en", "fight")).toEqual(modesOnShelf("battle"));
    expect(find("en", "race")).toEqual(["race", "maze"]);
    expect(find("en", "merge")[0]).toBe("mergeRing");
    expect([...find("en", "merge")].sort()).toEqual([...modesOnShelf("smash")].sort());
    expect(find("en", "loop")).toEqual(modesOnShelf("loops"));
    expect(find("en", "music")).toEqual(modesOnShelf("music"));
    expect(find("en", "countdown")).toEqual(["target", "box"]);
    expect(find("en", "duel")).toEqual(["fightLeague", "stringBattle"]);
    expect(find("en", "dvd")).toEqual(["box"]);
    expect(find("en", "ctf")).toEqual(["ctf"]);
  });

  it("ranks the name above the search words, the words above the shelf, the shelf above the one-liner", () => {
    // "Metronomes & Polyrhythms" holds the word, the Music shelf answers to it
    expect(find("en", "rhythm")).toEqual(["polyrhythm", ...modesOnShelf("music")]);
    // two names, a search word (Shatter), then the rest of the Smash shelf
    expect(find("en", "smash").slice(0, 3)).toEqual(["brickRebuild", "glass", "shatter"]);
    // a name that starts with the search comes before one that only holds the word
    expect(find("en", "glass").slice(0, 2)).toEqual(["glass", "spiralGlass"]);
    expect(find("en", "pendulum").slice(0, 2)).toEqual(["pendulum", "doublePendulum"]);
    // every word of the search has to match
    expect(find("en", "beat run")).toEqual(["runner"]);
    expect(find("en", "fight zzz")).toEqual([]);
  });

  it("answers in Polish and Spanish, without diacritics, and to the English name on every page", () => {
    expect(find("pl", "walka")).toEqual(modesOnShelf("battle"));
    expect(find("pl", "petla")).toEqual(modesOnShelf("loops"));
    expect(find("pl", "pętla")).toEqual(modesOnShelf("loops"));
    expect(find("pl", "wyscig")).toEqual(["race", "maze"]);
    expect(find("pl", "laczenie")[0]).toBe("mergeRing");
    expect(find("es", "pelea")).toEqual(modesOnShelf("battle"));
    expect(find("es", "fusion")[0]).toBe("mergeRing");
    expect(find("es", "musica")).toEqual(modesOnShelf("music"));
    for (const locale of ["pl", "es"] as const) {
      expect(find(locale, "fight league"), locale).toEqual(["fightLeague"]);
      expect(find(locale, "merge ring"), locale).toEqual(["mergeRing"]);
      expect(find(locale, "spiral glass"), locale).toEqual(["spiralGlass"]);
    }
  });

  // --- review fix (mode-shelves) --- a visitor types the plural or the form their language bends the word into
  it("finds a plural or an inflected word: fights, races, battles, walki, peleas", () => {
    expect(find("en", "fights")).toEqual(find("en", "fight"));
    expect(find("en", "fighting")).toEqual(find("en", "fight"));
    expect(find("en", "races")).toEqual(["race", "maze"]);
    expect(find("en", "battles")).toEqual(find("en", "battle"));
    expect(find("en", "battle")).toEqual(["battle", "stringBattle", ...modesOnShelf("battle").filter((m) => m !== "battle" && m !== "stringBattle")]);
    expect(find("en", "duels")).toEqual(["fightLeague", "stringBattle"]);
    expect(find("en", "songs")).toEqual(modesOnShelf("music"));
    expect(find("en", "loops")).toEqual(modesOnShelf("loops"));
    expect(find("en", "merging")[0]).toBe("mergeRing");
    expect([...find("en", "merging")].sort()).toEqual([...modesOnShelf("smash")].sort());
    expect(find("pl", "walki")).toEqual(modesOnShelf("battle"));
    expect(find("pl", "bitwy")).toEqual(find("pl", "bitwa"));
    expect(find("pl", "bitwa").length).toBe(modesOnShelf("battle").length);
    expect(find("pl", "pojedynki")).toEqual(["fightLeague", "stringBattle"]);
    expect(find("pl", "muzyczne")).toEqual(modesOnShelf("music"));
    expect(find("pl", "drużyna")).toEqual(expect.arrayContaining(["ctf", "territory", "landClaim"]));
    expect(find("es", "peleas")).toEqual(modesOnShelf("battle"));
    expect(find("es", "luchas")).toEqual(modesOnShelf("battle"));
    expect(find("es", "batallas")).toEqual(find("es", "batalla"));
    expect(find("es", "batalla").length).toBe(modesOnShelf("battle").length);
    expect(find("es", "duelos")).toEqual(["fightLeague", "stringBattle"]);
    expect(find("es", "canciones")).toEqual(modesOnShelf("music"));
    // (a form of a word never lists a mode twice)
    for (const q of ["fight", "walka", "pelea", "loop", "music"]) for (const locale of SEARCH_LOCALES) expect(new Set(find(locale, q)).size, `${locale} ${q}`).toBe(find(locale, q).length);
    // four letters in common are the least: three find nothing more than the word did
    expect(find("en", "racks")).toEqual([]);
    expect(find("en", "fig")).toEqual(find("en", "fight"));
  });

  it("finds every mode first by its English name on the Polish and the Spanish page", () => {
    for (const locale of ["pl", "es"] as const) for (const item of itemsOf("en")) expect(find(locale, item.name)[0], `${locale} "${item.name}"`).toBe(item.id);
  });

  it("passes over a word that says nothing, and its start while it is typed, but finds no mode by such words alone", () => {
    for (const locale of ["pl", "es"] as const) {
      for (const typed of ["capture t", "capture th", "capture the", "capture the f", "capture the flag"]) expect(find(locale, typed), `${locale} "${typed}"`).toEqual(["ctf"]);
      expect(find(locale, "the"), locale).toEqual([]);
      expect(find(locale, "of the"), locale).toEqual([]);
    }
    expect(find("en", "capture the flag")).toEqual(["ctf"]);
    expect(find("en", "fight zzz the")).toEqual([]);
  });

  it("gives every mode for an empty search, nothing for nonsense, and never the same mode twice", () => {
    const all = modesOnShelf("all");
    expect(find("en", "")).toEqual(all);
    expect(find("en", "   ")).toEqual(all);
    expect(find("en", "zzzz")).toEqual([]);
    expect(find("en", "?!")).toEqual(all); // (no letter or digit: nothing to look for)
    for (const q of ["a", "b", "ball", "s"]) expect(new Set(find("en", q)).size, q).toBe(find("en", q).length);
    // an unknown language searches with the English words
    expect(searchModes(itemsOf("en"), "duel", "de")).toEqual(["fightLeague", "stringBattle"]);
  });

  it("has search words for every mode and every shelf in English, Polish and Spanish", () => {
    expect(Object.keys(MODE_SEARCH_WORDS).sort()).toEqual([...MODE_IDS].sort());
    expect(Object.keys(SHELF_SEARCH_WORDS).sort()).toEqual([...MODE_SHELF_IDS].sort());
    for (const [id, words] of [...Object.entries(MODE_SEARCH_WORDS), ...Object.entries(SHELF_SEARCH_WORDS)]) {
      for (const locale of SEARCH_LOCALES) {
        const list = words[locale].split(" ");
        expect(list.length, `${id} ${locale}`).toBeGreaterThanOrEqual(2);
        expect(list.length, `${id} ${locale}`).toBeLessThanOrEqual(8);
        expect(words[locale], `${id} ${locale}`).toBe(words[locale].toLowerCase().trim());
        expect(new Set(list).size, `${id} ${locale}`).toBe(list.length);
      }
    }
    expect(modeSearchWords("fightLeague", "pl")).toBe(`${MODE_SEARCH_WORDS.fightLeague.pl} ${MODE_SEARCH_WORDS.fightLeague.en} fight League`);
    expect(modeSearchWords("fightLeague", "en")).toBe(`${MODE_SEARCH_WORDS.fightLeague.en} fight League`);
  });
});

/* --- mode-shelves --- the command palette lists the modes and Change mode next to the groups and the settings */
describe("command palette: the modes", () => {
  const names = en.Modes as unknown as Record<string, { name: string }>;
  const entries: PaletteEntry[] = [
    { kind: "section", section: "mode", key: "mode", label: "Mode", sectionLabel: "Mode" },
    { kind: "section", section: "ball", key: "ball", label: "Ball & Physics", sectionLabel: "Ball & Physics" },
    { kind: "control", section: "ball", key: "gravity", label: "Gravity", sectionLabel: "Ball & Physics" },
    { kind: "control", section: "ball", key: "ballSize", label: "Ball Size", sectionLabel: "Ball & Physics" },
    { kind: "action", section: "mode", key: "changeMode", label: "Change mode", sectionLabel: "" },
    ...modesOnShelf("all").map((id): PaletteEntry => ({ kind: "mode", section: "mode", key: id, label: names[id].name, sectionLabel: "", words: modeSearchWords(id, "en") })),
  ];
  const keys = (query: string, kind?: PaletteEntry["kind"]) => paletteMatches(entries, query, 200).filter((e) => !kind || e.kind === kind).map((e) => e.key);

  it("lists the groups and Change mode for an empty query, and no mode", () => {
    expect(keys("")).toEqual(["mode", "ball", "changeMode"]);
  });

  it("finds a mode by its name and by its search words", () => {
    expect(keys("pendulum", "mode")).toEqual(["pendulum", "doublePendulum", "drawingMachine"]);
    expect(keys("merge ring")).toEqual(["mergeRing"]);
    expect(keys("duel", "mode")).toEqual(["fightLeague", "stringBattle"]);
    expect(keys("change")).toEqual(["changeMode"]);
  });

  // --- review fix (mode-shelves) --- the palette's mode entries carry the shelf's words too (Controls.tsx hands it modePaletteWords)
  it("finds the modes of a shelf by the shelf's words, as the picker does, in every language", () => {
    const CATALOGS = { en, pl, es } as const;
    const modeKeys = (locale: keyof typeof CATALOGS, query: string) => {
      const local = CATALOGS[locale].Modes as unknown as Record<string, { name: string }>;
      const list: PaletteEntry[] = [
        { kind: "control", section: "ball", key: "gravity", label: "Gravity", sectionLabel: "Ball & Physics" },
        ...modesOnShelf("all").map((id): PaletteEntry => ({ kind: "mode", section: "mode", key: id, label: local[id].name, sectionLabel: "", words: modePaletteWords(id, locale) })),
      ];
      return paletteMatches(list, query, 200).filter((e) => e.kind === "mode").map((e) => e.key);
    };
    expect(modePaletteWords("fightLeague", "pl")).toBe(`${modeSearchWords("fightLeague", "pl")} ${SHELF_SEARCH_WORDS.battle.pl} ${SHELF_SEARCH_WORDS.battle.en}`);
    expect(modePaletteWords("fightLeague", "en")).toBe(`${modeSearchWords("fightLeague", "en")} ${SHELF_SEARCH_WORDS.battle.en}`);
    expect([...modeKeys("en", "fight")].sort()).toEqual([...modesOnShelf("battle")].sort());
    expect(modeKeys("en", "fight")[0]).toBe("fightLeague");
    expect([...modeKeys("en", "loop")].sort()).toEqual([...modesOnShelf("loops")].sort());
    expect([...modeKeys("en", "merge")].sort()).toEqual([...modesOnShelf("smash")].sort());
    expect(modeKeys("en", "merge")[0]).toBe("mergeRing");
    expect(modeKeys("en", "music")).toEqual(expect.arrayContaining(modesOnShelf("music")));
    expect([...modeKeys("pl", "walka")].sort()).toEqual([...modesOnShelf("battle")].sort());
    expect([...modeKeys("pl", "pętla")].sort()).toEqual([...modesOnShelf("loops")].sort());
    expect([...modeKeys("es", "pelea")].sort()).toEqual([...modesOnShelf("battle")].sort());
    // a setting's name still lists no mode, with the shelves' words in
    for (const q of ["grav", "gravity", "gravity variation", "export project", "speed", "size", "wall", "trail"]) for (const locale of SEARCH_LOCALES) expect(modeKeys(locale, q), `${locale} ${q}`).toEqual([]);
  });

  it("does not answer to a setting's or a group's name with every mode", () => {
    // (the smoke suite types "grav" in Classic and expects one Gravity and no mode among the options)
    for (const q of ["grav", "gravity", "gravity variation", "export project", "speed", "size", "wall", "trail"]) expect(keys(q, "mode"), q).toEqual([]);
    expect(keys("mode", "mode")).toEqual(["blueprint"]); // Mode Lab, by its own name
    expect(keys("mode")).toEqual(expect.arrayContaining(["mode", "changeMode"]));
  });
});

/* --- mode-shelves --- the picker's Recent row */
describe("recent modes", () => {
  it("reads only a list of known mode ids, each once, at most six", () => {
    expect(RECENT_MODES_MAX).toBe(6);
    for (const raw of [null, undefined, "", "not json", "{}", '"classic"', "42"]) expect(parseRecentModes(raw), String(raw)).toEqual([]);
    expect(parseRecentModes('["fightLeague","nope",7,null,"classic","fightLeague","__proto__"]')).toEqual(["fightLeague", "classic"]);
    expect(parseRecentModes(JSON.stringify(MODE_IDS))).toEqual(MODE_IDS.slice(0, 6));
  });

  it("puts a pick first, once, and drops the oldest past six", () => {
    expect(withRecentMode([], "classic")).toEqual(["classic"]);
    expect(withRecentMode(["classic", "drop"], "drop")).toEqual(["drop", "classic"]);
    const six: ModeId[] = ["classic", "drop", "box", "glass", "grow", "lines"];
    expect(withRecentMode(six, "paint")).toEqual(["paint", "classic", "drop", "box", "glass", "grow"]);
  });

  it("remembers a pick with the mode it replaces, in this browser's storage only, and works without one", () => {
    // Node has no window: nothing is read, nothing is thrown
    expect(readRecentModes()).toEqual([]);
    expect(() => rememberRecentMode("classic", "drop")).not.toThrow();
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) } });
    try {
      rememberRecentMode("fightLeague", "classic"); // (Classic came from a link: it was never picked, and is the way back)
      expect(readRecentModes()).toEqual(["fightLeague", "classic"]);
      rememberRecentMode("drop", "fightLeague");
      rememberRecentMode("drop", "drop");
      rememberRecentMode("mergeRing");
      expect(readRecentModes()).toEqual(["mergeRing", "drop", "fightLeague", "classic"]);
      expect([...store.keys()]).toEqual([RECENT_MODES_KEY]);
      expect(JSON.parse(store.get(RECENT_MODES_KEY) ?? "null")).toEqual(["mergeRing", "drop", "fightLeague", "classic"]);
      // a storage that refuses (private mode, a full quota)
      vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } } });
      expect(readRecentModes()).toEqual([]);
      expect(() => rememberRecentMode("classic", "drop")).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("aspectRatioLabel", () => {
  it("reduces an export resolution to its ratio", () => {
    expect(aspectRatioLabel("1080x1920")).toBe("9:16");
    expect(aspectRatioLabel("1920x1080")).toBe("16:9");
    expect(aspectRatioLabel("1280x720")).toBe("16:9");
    expect(aspectRatioLabel("500x500")).toBe("1:1");
    expect(aspectRatioLabel("1080 × 1350")).toBe("4:5");
  });
  it("gives nothing for an unreadable value", () => {
    expect(aspectRatioLabel("")).toBe("");
    expect(aspectRatioLabel("wide")).toBe("");
    expect(aspectRatioLabel("0x100")).toBe("");
  });
});

describe("paletteMatches", () => {
  const entries: PaletteEntry[] = [
    { kind: "section", section: "ball", key: "ball", label: "Ball & Physics", sectionLabel: "Ball & Physics" },
    { kind: "section", section: "sound", key: "sound", label: "Custom Sound", sectionLabel: "Custom Sound" },
    { kind: "control", section: "ball", key: "gravity", label: "Gravity", sectionLabel: "Ball & Physics" },
    { kind: "control", section: "ball", key: "ballSpeed", label: "Ball Speed", sectionLabel: "Ball & Physics" },
    { kind: "control", section: "wall", key: "rotatingGravity", label: "Rotating Gravity", sectionLabel: "Wall Settings" },
    { kind: "control", section: "sound", key: "wallBreakSound", label: "Dźwięk przebicia ściany", sectionLabel: "Własny dźwięk" },
  ];
  it("lists the sections for an empty query", () => {
    expect(paletteMatches(entries, "  ").map((e) => e.key)).toEqual(["ball", "sound"]);
  });
  it("ranks a label that starts with the query first", () => {
    expect(paletteMatches(entries, "grav").map((e) => e.key)).toEqual(["gravity", "rotatingGravity"]);
  });
  it("matches every word, in the label, the section name or the key", () => {
    expect(paletteMatches(entries, "ball speed").map((e) => e.key)[0]).toBe("ballSpeed");
    expect(paletteMatches(entries, "physics grav").map((e) => e.key)).toEqual(["gravity"]);
    expect(paletteMatches(entries, "zzz")).toEqual([]);
  });
  it("folds diacritics, so plain typing finds Polish and Spanish labels", () => {
    expect(paletteMatches(entries, "dzwiek sciany").map((e) => e.key)).toEqual(["wallBreakSound"]);
    expect(paletteMatches(entries, "wlasny").map((e) => e.key)).toContain("wallBreakSound");
  });
  it("stops at the limit", () => {
    expect(paletteMatches(entries, "a", 2)).toHaveLength(2);
  });
});

describe("paletteControlEntries", () => {
  const groups: PaletteGroup[] = [
    { section: "mode", label: "Mode", keys: ["boxGravity"] },
    { section: "ball", label: "Ball & Physics", keys: ["gravity", "gravity", "noLabel", "gravityAlias", "ballPhysics", "ballSpeed"] },
    { section: "wall", label: "Wall Settings", keys: ["gravity", "wallCount"] },
  ];
  const labels: Record<string, string> = { boxGravity: "Gravity", gravity: "Gravity", gravityAlias: "gravity ", ballPhysics: "Ball & Physics", ballSpeed: "Ball Speed", wallCount: "Wall Count" };
  const entries = paletteControlEntries(groups, (key) => labels[key] ?? null);
  it("keep a key once, skip keys without a label and one of two labels alike in a group", () => {
    expect(entries.map((e) => `${e.section}:${e.key}`)).toEqual(["mode:boxGravity", "ball:gravity", "ball:ballSpeed", "wall:wallCount"]);
  });
  it("leave out a control named like its own group (the group's entry covers it)", () => {
    expect(entries.some((e) => e.key === "ballPhysics")).toBe(false);
  });
  it("carry the group's name as the section label", () => {
    expect(entries.find((e) => e.key === "ballSpeed")).toEqual({ kind: "control", section: "ball", key: "ballSpeed", label: "Ball Speed", sectionLabel: "Ball & Physics" });
  });
});

describe("command palette: what each mode offers (review fix)", () => {
  const PANEL: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };
  const railOf = (mode: ModeId): ControlSection[] => ["ball", "wall", "visual", "sound", "teams", ...(supportsObstacles(mode) ? (["obstacles"] as const) : []), "captions", "timeline", "arenas", "recording"];
  const entriesOf = (mode: ModeId, extra: Partial<PanelShown> = {}, catalog: { Controls: unknown } = en) => {
    const controls = catalog.Controls as Record<string, unknown>;
    const groups = paletteKeyGroups({ ...PANEL, ...extra, mode }, railOf(mode), true).map((g) => ({ ...g, label: g.section }));
    return paletteControlEntries(groups, (key) => (typeof controls[key] === "string" ? (controls[key] as string) : null));
  };
  const where = (entries: PaletteEntry[], label: string) => entries.filter((e) => e.label === label).map((e) => `${e.section}:${e.key}`);

  it("offer one Gravity in Classic and no other mode's gravity (Bouncing Shapes', Ball Drop's, the orbs', the pendulum's, the vortex's)", () => {
    const classic = entriesOf("classic");
    expect(where(classic, "Gravity")).toEqual(["ball:gravity"]);
    for (const key of ["boxGravity", "dropGravityVariation", "cpGravity", "dpGravity", "vxGravity"]) expect(classic.some((e) => e.key === key), key).toBe(false);
    expect(paletteMatches(classic, "grav").map((e) => e.label)).toEqual(["Gravity", "Rotating Gravity"]);
  });

  it("offer a mode's own block under the Mode group, in that mode only", () => {
    expect(where(entriesOf("box"), "Gravity")).toEqual(["mode:boxGravity", "ball:gravity"]);
    expect(where(entriesOf("drop"), "Gravity Variation")).toEqual(["mode:dropGravityVariation"]);
    expect(where(entriesOf("accumulation"), "Spikes")).toEqual(["mode:spikes"]);
    expect(entriesOf("classic").some((e) => e.section === "mode")).toBe(false);
    for (const mode of MODE_IDS) {
      const entries = entriesOf(mode);
      const own = new Set(MODE_BLOCK_KEYS[mode] ?? []);
      for (const e of entries) {
        if (MODE_BLOCK_KEY_SET.has(e.key)) expect(own.has(e.key) && e.section === "mode", `${mode} ${e.section}:${e.key}`).toBe(true);
      }
      // one entry per label in a group
      const seen = new Set<string>();
      for (const e of entries) {
        const id = `${e.section}:${e.label.toLowerCase()}`;
        expect(seen.has(id), `${mode} ${id}`).toBe(false);
        seen.add(id);
      }
    }
  });

  it("leave out what the mode or a setting hides: Wall Count, Ball Count, the arena editor, the caption form, Add Team", () => {
    expect(entriesOf("classic").some((e) => e.key === "wallCount")).toBe(true);
    for (const mode of ["accumulation", "box", "drop"] as const) expect(entriesOf(mode).some((e) => e.key === "wallCount"), mode).toBe(false);
    expect(wallControlsOf("grow")).toEqual({ wallCount: false, thickness: true, gapControls: true, gapSize: false });
    expect(entriesOf("classic").some((e) => e.key === "ballCount")).toBe(true);
    expect(entriesOf("box").some((e) => e.key === "ballCount")).toBe(false);
    expect(entriesOf("classic").some((e) => e.key === "twoBalls")).toBe(false); // (a search alias of the Ball Count)
    expect(entriesOf("classic").some((e) => e.key === "splitArenaGravity")).toBe(false);
    expect(entriesOf("classic", { arenas: true }).some((e) => e.key === "splitArenaGravity")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "captionStart")).toBe(false);
    expect(entriesOf("classic", { captions: true }).some((e) => e.key === "captionStart")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "teamAdd")).toBe(false);
    expect(entriesOf("classic", { teams: true }).some((e) => e.key === "teamAdd")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "vbVideoOpacity")).toBe(false);
    expect(entriesOf("classic", { videoBackground: true }).some((e) => e.key === "vbVideoOpacity")).toBe(true);
    expect(entriesOf("classic").some((e) => e.key === "timeline")).toBe(false); // (the Timeline group's own word)
    expect(sectionKeyShown("ballColor", { ...PANEL, mode: "classic", ballPicture: true }, false)).toBe(false);
    expect(sectionKeyShown("multiplierPickups", { ...PANEL, mode: "drop" }, false)).toBe(false);
  });

  it("keep the Project file's entries under Saved Presets", () => {
    expect(where(entriesOf("classic"), "Export project")).toEqual(["presets:exportProject"]);
  });

  it("name every entry in Polish and Spanish too", () => {
    for (const mode of MODE_IDS) {
      for (const e of entriesOf(mode)) {
        for (const [lang, catalog] of [["pl", pl], ["es", es]] as const) expect(typeof (catalog.Controls as Record<string, unknown>)[e.key], `${lang} ${mode} ${e.key}`).toBe("string");
      }
    }
  });

  it("know the block of every mode that has one in the Mode group (Controls.tsx modeSpecific())", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "Controls.tsx"), "utf8");
    const body = src.slice(src.indexOf("const modeSpecific = () => {"), src.indexOf("default:", src.indexOf("const modeSpecific = () => {")));
    const modes = [...body.matchAll(/case "(\w+)":/g)].map((m) => m[1]);
    expect(modes.length).toBeGreaterThan(20);
    for (const mode of modes) expect(MODE_BLOCK_KEYS[mode as ModeId]?.length ?? 0, mode).toBeGreaterThan(0);
    expect(src).toContain("const walls = wallControlsOf(s.mode);");
  });
});

describe("SiteRedesign messages", () => {
  it("have the same keys in English, Polish and Spanish", () => {
    const keys = (m: { SiteRedesign: unknown }) => flat(m.SiteRedesign as Tree).sort();
    expect(keys(pl)).toEqual(keys(en));
    expect(keys(es)).toEqual(keys(en));
  });
  it("keep the hero headline at eight words or fewer", () => {
    for (const m of [en, pl, es]) expect(m.SiteRedesign.hero.title.split(/\s+/).filter(Boolean).length).toBeLessThanOrEqual(8);
  });
});

describe("design rules", () => {
  it("load the fonts from src/fonts, with their OFL licences next to them", () => {
    const dir = path.join(__dirname, "..", "src", "fonts");
    const files = fs.readdirSync(dir);
    for (const family of ["space-grotesk", "hanken-grotesk", "jetbrains-mono"]) {
      expect(files).toContain(`${family}-latin.woff2`);
      expect(files).toContain(`${family}-latin-ext.woff2`);
    }
    expect(files.filter((f) => /^OFL-.*\.txt$/.test(f))).toHaveLength(3);
    for (const layout of ["app/[locale]/layout.tsx", "app/(static)/layout.tsx"]) expect(fs.readFileSync(path.join(__dirname, "..", "src", layout), "utf8")).not.toMatch(/fonts\.googleapis/);
  });
});

/* --- panel-basics --- the words a visitor types for a setting: the panel's search and the palette find it by them */
describe("command palette and panel search: the words people type", () => {
  const PANEL: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: true, batch: true, bot: true };
  const railOf = (mode: ModeId): ControlSection[] => ["ball", "wall", "visual", "sound", "teams", ...(supportsObstacles(mode) ? (["obstacles"] as const) : []), "captions", "timeline", "arenas", "recording"];
  const entriesOf = (locale: "en" | "pl" | "es", catalog: { Controls: unknown }) => {
    const controls = catalog.Controls as Record<string, unknown>;
    const groups = paletteKeyGroups({ ...PANEL, mode: "classic" }, railOf("classic"), true).map((g) => ({ ...g, label: g.section }));
    return paletteControlEntries(groups, (key) => (typeof controls[key] === "string" ? (controls[key] as string) : null), (key) => settingSearchWords(key, locale) || undefined);
  };
  const found = (entries: PaletteEntry[], query: string) => paletteMatches(entries, query, 200).filter((e) => e.kind === "control").map((e) => e.key);

  it("finds a setting by the word a visitor types, in English on every page and in the page's language", () => {
    const english = entriesOf("en", en);
    expect(found(english, "colour")).toEqual(expect.arrayContaining(["ballColor", "wallColor", "colorTrail"]));
    expect(found(english, "color")).toEqual(expect.arrayContaining(["ballColor", "wallColor", "colorTrail"]));
    expect(found(english, "length")).toContain("videoDuration");
    expect(found(english, "seconds")).toContain("videoDuration");
    expect(found(english, "hook")).toEqual(["topText"]);
    expect(found(english, "logo")).toEqual(["customWatermark"]);
    expect(found(english, "share")).toContain("publish");
    expect(found(entriesOf("pl", pl), "długość")).toContain("videoDuration");
    expect(found(entriesOf("pl", pl), "length")).toContain("videoDuration");
    expect(found(entriesOf("es", es), "gancho")).toEqual(["topText"]);
    expect(settingSearchWords("topText", "es")).toBe(`${SETTING_SEARCH_WORDS.topText.es} ${SETTING_SEARCH_WORDS.topText.en}`);
    expect(settingSearchWords("topText", "en")).toBe(SETTING_SEARCH_WORDS.topText.en);
    expect(settingSearchWords("noSuchKey", "pl")).toBe("");
  });

  it("keeps the words lower case, each once, and away from the queries the palette answers in one way", () => {
    for (const [key, words] of Object.entries(SETTING_SEARCH_WORDS)) {
      for (const locale of SEARCH_LOCALES) {
        const list = words[locale].split(" ");
        expect(words[locale], `${key} ${locale}`).toBe(words[locale].toLowerCase().trim());
        expect(new Set(list).size, `${key} ${locale}`).toBe(list.length);
      }
    }
    // (the smoke suite types "grav" in Classic and expects one Gravity; no setting's word is a mode's name)
    expect(found(entriesOf("en", en), "grav")).toEqual(["gravity", "rotatingGravity"]);
    const modeNames = MODE_IDS.map((id) => (en.Modes as unknown as Record<string, { name: string }>)[id].name.toLowerCase());
    for (const words of Object.values(SETTING_SEARCH_WORDS)) for (const word of words.en.split(" ")) expect(modeNames, word).not.toContain(word);
  });
});

