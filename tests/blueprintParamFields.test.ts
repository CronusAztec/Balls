import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { BLUEPRINT_CATALOG_IDS, BLUEPRINT_LIMITS, BLUEPRINT_RADIUS_CEILING, BLUEPRINT_SPEED_CEILING, HeadlessBlueprint, applyBlueprintParams, blueprintNumberBounds, catalogBlueprint, encodeBlueprint, formatParamValues, paramBounds, paramPlayed, paramsPlayed, parseParamValues, sanitizeBlueprint, validateBlueprint, type Blueprint, type BlueprintCatalogId } from "@/lib/blueprint";
import BlueprintSection, { blueprintParamDisplay, blueprintParamRules } from "@/components/simulator/sections/BlueprintSection";
import { resolveBlueprintSpec } from "@/lib/physics/modes/blueprint";
import { settingsCatalog } from "@/lib/desktop/ai/settingsPatch";
import type { NumberFieldProps } from "@/components/simulator/NumberField";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import { IDLE_FIELD, checkTypedNumber, numberFieldReduce, stepNumber, type NumberRules } from "@/lib/uncap";
import { defaultSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- unlimited-sizes --- Mode Lab's number fields (components/simulator/sections/BlueprintSection.tsx): a Blueprint
 * parameter's field takes as its floor and top the bound the language itself holds that number to – the sanitizer's own rule
 * at the parameter's path (lib/blueprint/sanitize.ts `blueprintNumberBounds()`, `paramBounds()`) – never the slider's start
 * or end. Main narrowed several catalog sliders so each game still makes a clip at both ends of the drag (Peg Race's spin
 * 15–35, Ring Breaker's gap 24–30, Tier Climb's target 6–8 and gravity 200–1200, Grow or Go's exit 14–40 and size 4–20): those
 * ends shape the track only. A still exit, a 20° gap or tier 5 typed in the field plays as typed, an arrow press steps on from
 * a value below the slider's start, and a value the language refuses is refused with its bound named.
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

// every number field the panel renders, with the props it was given (the real field still renders the markup)
const fields = vi.hoisted(() => [] as NumberFieldProps[]);
vi.mock("@/components/simulator/NumberField", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/simulator/NumberField")>();
  return {
    ...real,
    default: (props: NumberFieldProps) => {
      fields.push(props);
      return real.default(props);
    },
  };
});

type Messages = typeof en;
const LOCALES: Record<"en" | "pl" | "es", Messages> = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };
type Locale = keyof typeof LOCALES;

/**
 * The panel rendered on the server for `settings`, in `locale`: its markup, the props of every number field in it and the
 * settings patches it sends (a field's onCommit sets its slider's value).
 */
const render = (patch: Partial<SimulatorSettings>, locale: Locale = "en") => {
  const t = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Controls" as never }) as unknown as Translate;
  const settings = { ...defaultSettings("blueprint"), mode: "blueprint", ...patch } as SimulatorSettings;
  const updates: Partial<SimulatorSettings>[] = [];
  fields.length = 0;
  const html = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(BlueprintSection, { t, search: "", matches: () => true, settings, update: (u: Partial<SimulatorSettings>) => updates.push(u) }),
    ),
  );
  return { html, fields: [...fields], updates };
};
/** The opening tag of the number field of slider `i`. */
const fieldTag = (html: string, i: number) => html.match(new RegExp(`<input[^>]*data-number-field="blParam${i}"[^>]*>`))?.[0] ?? "";

/** What the field does with typed `text`: the value it commits, or why it refuses it. */
const typed = (f: NumberFieldProps, text: string) => {
  const typing = numberFieldReduce(IDLE_FIELD, { type: "type", text }, f.value ?? Number.NaN, f.range, f.rules);
  const done = numberFieldReduce(typing.state, { type: "commit" }, f.value ?? Number.NaN, f.range, f.rules);
  return done.commit !== undefined ? { commit: done.commit } : { refused: done.state.error };
};
/** The value an arrow press (↓ -1, ↑ 1) on the field commits. */
const arrow = (f: NumberFieldProps, direction: 1 | -1) => numberFieldReduce(IDLE_FIELD, { type: "step", direction }, f.value ?? Number.NaN, f.range, f.rules).commit;

/** The slider index of parameter `id` of catalog game `game`. */
const slider = (game: BlueprintCatalogId, id: string) => catalogBlueprint(game).params.findIndex((p) => p.id === id);

describe("Mode Lab: each slider's number field is bounded by the language, not by the slider", () => {
  it("reads every catalog slider's bound from the sanitizer's own rule at its path", () => {
    const table = Object.fromEntries(BLUEPRINT_CATALOG_IDS.map((id) => [id, Object.fromEntries(catalogBlueprint(id).params.map((p, i) => [p.id, paramBounds(catalogBlueprint(id))[i]]))]));
    expect(table).toEqual({
      hatchery: { layers: { min: 1, max: BLUEPRINT_LIMITS.tileRows, integer: true }, glass: { min: 1, integer: true }, speed: { min: -BLUEPRINT_SPEED_CEILING, max: BLUEPRINT_SPEED_CEILING } },
      ringBreaker: { rings: { min: 1, max: BLUEPRINT_LIMITS.rings, integer: true }, gap: { min: 5, max: 180 }, spin: {} },
      // (Colour Conquest's balls a colour: a variable its spawners count by, a whole number from 0 to a spawn's 8 balls)
      conquer: { per: { min: 0, max: BLUEPRINT_LIMITS.perSpawn, integer: true }, boost: { min: 0, above: true } },
      tierClimb: { target: { min: 1, max: BLUEPRINT_LIMITS.maxTier, integer: true }, rain: { min: 0 }, gravity: {} },
      // (Peg Race's peg rows: its grid of 7 columns stops at the obstacle ceiling, 6 rows – the slider's end is the language's here)
      plinkoRace: { exit: { min: 1, max: 180 }, spin: {}, rows: { min: 1, max: Math.floor(BLUEPRINT_LIMITS.obstacles / 7), integer: true } },
      growEscape: { grow: {}, exit: { min: 1, max: 180 }, size: { min: 0, above: true, max: BLUEPRINT_RADIUS_CEILING } },
    });
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      const all = blueprintNumberBounds(bp);
      expect([id, paramBounds(bp)]).toEqual([id, bp.params.map((p) => all.get(p.at) ?? {})]);
    }
  });

  it("keeps a value at the bound as written and changes one past it, exactly as sanitizing the game does", () => {
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      paramBounds(bp).forEach((b, i) => {
        // (kept: what the game plays is the value as written – its number in the spec, a counted variable as the runtime counts it)
        const play = (v: number) => {
          const values = bp.params.map((_, k) => (k === i ? v : null));
          const { notes } = applyBlueprintParams(bp, values);
          return { kept: paramPlayed(bp, values, i) === v && notes.length === 0 };
        };
        const name = `${id}.${bp.params[i].id}`;
        // the field's floor and top are where the sanitizer starts to change the value
        if (b.min !== undefined) {
          expect([name, "floor", play(b.above ? b.min + 0.5 : b.min)]).toEqual([name, "floor", { kept: true }]);
          expect([name, "past the floor", play(b.above ? b.min : b.min - 1)]).toEqual([name, "past the floor", { kept: false }]);
        } else expect([name, "no floor", play(-1e6)]).toEqual([name, "no floor", { kept: true }]);
        if (b.max !== undefined) {
          expect([name, "top", play(b.max)]).toEqual([name, "top", { kept: true }]);
          expect([name, "past the top", play(b.max + 1)]).toEqual([name, "past the top", { kept: false }]);
        } else expect([name, "no top", play(1e6)]).toEqual([name, "no top", { kept: true }]);
      });
    }
  });

  it("never makes a slider's start the field's floor: the narrowed sliders take what main's drag no longer reaches", () => {
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      const bounds = paramBounds(bp);
      bp.params.forEach((p, i) => {
        const rules = blueprintParamRules(bounds[i]);
        // the floor is the language's (Glass Hatchery's glass strength starts at 1 HP in both), never the slider's own start
        expect([`${id}.${p.id}`, rules.min, rules.above === true, rules.max]).toEqual([`${id}.${p.id}`, bounds[i].min, bounds[i].above === true, bounds[i].max]);
        if (bounds[i].min === undefined || bounds[i].min! < p.min) {
          const below = p.min - p.step;
          if (bounds[i].min === undefined || (bounds[i].above ? below > bounds[i].min! : below >= bounds[i].min!)) expect([`${id}.${p.id}`, checkTypedNumber(String(below), rules)]).toEqual([`${id}.${p.id}`, { ok: true, value: below }]);
        }
      });
    }
    const rulesOf = (game: BlueprintCatalogId, id: string) => {
      const bp = catalogBlueprint(game);
      const i = slider(game, id);
      return blueprintParamRules(paramBounds(bp)[i]);
    };
    const accepts = (game: BlueprintCatalogId, id: string, text: string) => checkTypedNumber(text, rulesOf(game, id));
    // the review's values: each below its slider's start, each inside the language
    expect(accepts("plinkoRace", "spin", "0")).toEqual({ ok: true, value: 0 });
    expect(accepts("plinkoRace", "spin", "5")).toEqual({ ok: true, value: 5 });
    expect(accepts("plinkoRace", "spin", "-20")).toEqual({ ok: true, value: -20 }); // (a spin either way: the language bounds none)
    expect(accepts("ringBreaker", "gap", "20")).toEqual({ ok: true, value: 20 });
    expect(accepts("tierClimb", "target", "5")).toEqual({ ok: true, value: 5 });
    expect(accepts("tierClimb", "gravity", "100")).toEqual({ ok: true, value: 100 });
    expect(accepts("growEscape", "exit", "10")).toEqual({ ok: true, value: 10 });
    expect(accepts("growEscape", "size", "2")).toEqual({ ok: true, value: 2 });
    // ...and the language's own bounds, named
    expect(accepts("ringBreaker", "gap", "4")).toEqual({ ok: false, reason: "belowMin", min: 5 });
    expect(accepts("ringBreaker", "gap", "181")).toEqual({ ok: false, reason: "aboveMax", max: 180 });
    expect(accepts("tierClimb", "target", "0")).toEqual({ ok: false, reason: "belowMin", min: 1 });
    expect(accepts("tierClimb", "target", "100")).toEqual({ ok: false, reason: "aboveMax", max: BLUEPRINT_LIMITS.maxTier });
    expect(accepts("growEscape", "size", "0")).toEqual({ ok: false, reason: "notAbove", min: 0 });
    expect(accepts("growEscape", "size", String(BLUEPRINT_RADIUS_CEILING + 1))).toEqual({ ok: false, reason: "aboveMax", max: BLUEPRINT_RADIUS_CEILING });
    // whole numbers only where the language counts (a tier): never because the slider steps by whole numbers (a gap of 24–30 in
    // degrees keeps 22.5)
    expect([rulesOf("tierClimb", "target").integer, rulesOf("ringBreaker", "gap").integer, rulesOf("growEscape", "grow").integer]).toEqual([true, false, false]);
  });

  it("follows the walker's later cuts: the tile ceiling over rows and the palette's length over a colour", () => {
    const bp = sanitizeBlueprint({
      v: 1,
      meta: { name: "Cuts" },
      bodies: [{ id: "b", color: 1 }],
      tiles: { rows: 3, cols: 48 },
      spawners: [{ body: "b" }],
      look: { palette: ["#ff0000", "#00ff00", "#0000ff"] },
      finish: { timeoutSec: 30 },
      params: [
        { id: "rows", at: "tiles.rows", min: 1, max: 6, step: 1 },
        { id: "col", at: "bodies[0].color", min: 0, max: 2, step: 1 },
      ],
    }).blueprint;
    const [rows, col] = paramBounds(bp);
    expect(rows).toEqual({ min: 1, max: Math.floor(BLUEPRINT_LIMITS.tiles / 48), integer: true });
    expect(col).toEqual({ min: 0, max: 2, integer: true });
    // (the same tops the sanitizer keeps a value under)
    expect(applyBlueprintParams(bp, [rows.max!, col.max!]).notes).toEqual([]);
    expect(applyBlueprintParams(bp, [rows.max! + 1, null]).notes.length).toBeGreaterThan(0);
    expect(applyBlueprintParams(bp, [null, col.max! + 1]).notes.length).toBeGreaterThan(0);
  });
});

describe("Mode Lab: the panel's number field", () => {
  it("shows a link's still exit in Peg Race as 0, takes 0 and 5 typed, and steps down from 0 instead of up to the slider's 15", () => {
    const i = slider("plinkoRace", "spin");
    const { html, fields: all } = render({ blPreset: "plinkoRace", blParams: `${",".repeat(i)}0` });
    const f = all.find((x) => x.settingKey === `blParam${i}`)!;
    expect([f.value, f.range]).toEqual([0, { min: 15, max: 35, step: 5 }]);
    expect(fieldTag(html, i)).toMatch(/value="0"/);
    expect(fieldTag(html, i)).toMatch(/data-beyond="1"/); // (the slider's comfort range is 15–35: the value runs as typed)
    expect(typed(f, "0")).toEqual({ commit: 0 });
    expect(typed(f, "5")).toEqual({ commit: 5 });
    expect(arrow(f, -1)).toBe(-5);
    expect(arrow(f, 1)).toBe(5);
    // (the drag is main's tuned 15–35: the track itself is unchanged)
    expect(html).toMatch(/<input type="range" min="15" max="35" step="5"/);
  });

  it("takes Ring Breaker's 20° gap and steps down from it, and refuses the language's 4° and 181° with the bound named", () => {
    const i = slider("ringBreaker", "gap");
    const { html, fields: all } = render({ blPreset: "ringBreaker", blParams: `${",".repeat(i)}20` });
    const f = all.find((x) => x.settingKey === `blParam${i}`)!;
    expect(fieldTag(html, i)).toMatch(/value="20"/);
    expect(typed(f, "20")).toEqual({ commit: 20 });
    expect(typed(f, "5")).toEqual({ commit: 5 });
    expect(arrow(f, -1)).toBe(19);
    expect(typed(f, "4")).toEqual({ refused: { reason: "belowMin", min: 5, text: "4" } });
    expect(typed(f, "181")).toEqual({ refused: { reason: "aboveMax", min: undefined, max: 180, text: "181" } });
    // the arrows stop at the language's ends
    expect(arrow({ ...f, value: 5 }, -1)).toBe(5);
    expect(arrow({ ...f, value: 180 }, 1)).toBe(180);
    // the refusals' words, in every language (Uncap.errBelowMin, Uncap.errAboveMax)
    for (const locale of ["en", "pl", "es"] as const) {
      const u = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Uncap" as never }) as unknown as (key: string, values: Record<string, string>) => string;
      expect([locale, u("errAboveMax", { max: "180" })]).toEqual([locale, expect.stringContaining("180")]);
      expect([locale, u("errBelowMin", { min: "5" })]).toEqual([locale, expect.stringContaining("5")]);
    }
  });

  it("gives every slider of every catalog game the language's rules, Tier Climb's target 5 and gravity 100 and Grow or Go's exit 10 and size 2 among them", () => {
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      const { fields: all } = render({ blPreset: id });
      bp.params.forEach((p, i) => {
        const f = all.find((x) => x.settingKey === `blParam${i}`);
        const want: NumberRules = blueprintParamRules(paramBounds(bp)[i]);
        expect([`${id}.${p.id}`, f?.rules]).toEqual([`${id}.${p.id}`, want]);
      });
    }
    const fieldOf = (game: BlueprintCatalogId, id: string) => {
      const i = slider(game, id);
      return render({ blPreset: game }).fields.find((x) => x.settingKey === `blParam${i}`)!;
    };
    expect(typed(fieldOf("tierClimb", "target"), "5")).toEqual({ commit: 5 });
    expect(typed(fieldOf("tierClimb", "gravity"), "100")).toEqual({ commit: 100 });
    expect(typed(fieldOf("growEscape", "exit"), "10")).toEqual({ commit: 10 });
    expect(typed(fieldOf("growEscape", "size"), "2")).toEqual({ commit: 2 });
    expect(arrow({ ...fieldOf("tierClimb", "target"), value: 5 }, -1)).toBe(4);
    expect(arrow({ ...fieldOf("growEscape", "exit"), value: 10 }, -1)).toBe(9);
  });

  it("leaves the settings' own number fields as they were: a slider that names no rules keeps its setting's", () => {
    expect(stepNumber(20, -1, { min: 15, max: 35, step: 5 }, { min: 15 })).toBe(15);
    expect(checkTypedNumber("1e12", { min: 0 })).toEqual({ ok: true, value: 1e12 }); // (no top unless one is given)
  });
});

// --- unlimited-sizes --- (review round) the field keeps what the language keeps, one spelling per number, bounds across
// numbers, values written exactly, and a link's value past its bound said as what plays

/** A link spec: sanitized (as resolveBlueprintSpec reads a link's) and its `bls` code. */
const linkSpec = (raw: Record<string, unknown>) => {
  const bp = sanitizeBlueprint(raw).blueprint;
  return { bp, code: encodeBlueprint(bp) };
};
/** The number field of slider `i` of a rendered panel. */
const fieldAt = (all: NumberFieldProps[], i: number) => all.find((x) => x.settingKey === `blParam${i}`)!;
/** Whether `v` plays as written at slider `i` (the others as `values` has them): the value the game plays and nothing repaired. */
const plays = (bp: Blueprint, i: number, v: number, values: (number | null)[] = []) => {
  const all = bp.params.map((_, k) => (k === i ? v : (values[k] ?? null)));
  const { notes } = applyBlueprintParams(bp, all);
  return paramPlayed(bp, all, i) === v && notes.length === 0;
};

describe("Mode Lab: a field keeps a decimal wherever the language does, whatever the slider's step", () => {
  it("rounds only where the language counts, and commits every other typed decimal inside the bound exactly as it plays", () => {
    for (const id of BLUEPRINT_CATALOG_IDS) {
      const bp = catalogBlueprint(id);
      const bounds = paramBounds(bp);
      bp.params.forEach((p, i) => {
        const name = `${id}.${p.id}`;
        const rules = blueprintParamRules(bounds[i]);
        expect([name, rules.integer]).toEqual([name, bounds[i].integer === true]);
        if (bounds[i].integer) return;
        // a step and a half above the language's floor (the slider's start where there is none): a decimal on any slider
        const v = (bounds[i].min ?? p.min) + 0.5;
        expect([name, checkTypedNumber(String(v), rules)]).toEqual([name, { ok: true, value: v }]);
        expect([name, plays(bp, i, v)]).toEqual([name, true]);
      });
    }
  });

  it("takes the review's values as typed: a 0.4 px ball, a 0.4 s boost, a 20.5° and a 22.5° gap, a 2.5° exit", () => {
    const fieldOf = (game: BlueprintCatalogId, id: string) => fieldAt(render({ blPreset: game }).fields, slider(game, id));
    const cases: [BlueprintCatalogId, string, string, number][] = [
      ["growEscape", "size", "0.4", 0.4],
      ["growEscape", "size", "0.5", 0.5],
      ["growEscape", "size", "2.5", 2.5],
      ["conquer", "boost", "0.4", 0.4],
      ["conquer", "boost", "2.5", 2.5],
      ["ringBreaker", "gap", "20.5", 20.5],
      ["ringBreaker", "gap", "22.5", 22.5],
      ["plinkoRace", "exit", "2.5", 2.5],
      ["growEscape", "exit", "12.5", 12.5],
    ];
    for (const [game, id, text, value] of cases) {
      expect([game, id, typed(fieldOf(game, id), text)]).toEqual([game, id, { commit: value }]);
      expect([game, id, plays(catalogBlueprint(game), slider(game, id), value)]).toEqual([game, id, true]);
    }
    // ("More than 0" is never said of 0.4: only 0 and below are refused, and a counted tier still rounds as the game does)
    expect(typed(fieldOf("growEscape", "size"), "0")).toEqual({ refused: { reason: "notAbove", min: 0, text: "0" } });
    expect(typed(fieldOf("tierClimb", "target"), "5.4")).toEqual({ commit: 5 });
    // (balls a colour are counted too: the spawners count by them, whole, so a typed 0.4 commits the 0 it plays)
    expect(typed(fieldOf("conquer", "per"), "0.4")).toEqual({ commit: 0 });
    expect(plays(catalogBlueprint("conquer"), slider("conquer", "per"), 0)).toBe(true);
  });

  it("shows a typed decimal in the slider's value too, in the page's number format", () => {
    const unit = (u: string, n: string) => (u === "deg" ? `${n}°` : u === "px" ? `${n} px` : `${n} ${u}`);
    const gap = slider("ringBreaker", "gap");
    expect(blueprintParamDisplay(catalogBlueprint("ringBreaker"), gap, 25.5, "en", unit)).toBe("25.5°");
    expect(blueprintParamDisplay(catalogBlueprint("ringBreaker"), gap, 25.5, "pl", unit)).toBe("25,5°");
    expect(blueprintParamDisplay(catalogBlueprint("ringBreaker"), gap, 25, "en", unit)).toBe("25°");
    expect(blueprintParamDisplay(catalogBlueprint("growEscape"), slider("growEscape", "size"), 4.25, "es", unit)).toBe("4,25 px");
    // (a step under 1 keeps its own decimals: 0.08 s, never 0.080000)
    expect(blueprintParamDisplay(catalogBlueprint("tierClimb"), slider("tierClimb", "rain"), 0.08, "en", unit)).toBe("0.08 s");
  });
});

describe("Mode Lab: a parameter's path has one spelling", () => {
  const raw = (params: Record<string, unknown>[]) => ({ ...catalogBlueprint("growEscape"), params });

  it("keeps bodies[00].radius as bodies[0].radius, so its field finds the radius's bound", () => {
    const { bp, code } = linkSpec(raw([{ id: "size", at: "bodies[00].radius", min: 4, max: 20, step: 1 }]));
    expect(bp.params[0].at).toBe("bodies[0].radius");
    expect(paramBounds(bp)).toEqual([{ min: 0, above: true, max: BLUEPRINT_RADIUS_CEILING }]);
    // (a spec still written the other way finds it as well: the bound is looked up by the walker's spelling)
    expect(paramBounds({ ...bp, params: [{ ...bp.params[0], at: "bodies[00].radius" }] })).toEqual([{ min: 0, above: true, max: BLUEPRINT_RADIUS_CEILING }]);
    const f = fieldAt(render({ blSpec: code }).fields, 0);
    expect(f.rules).toEqual({ min: 0, above: true, max: BLUEPRINT_RADIUS_CEILING, integer: false });
    expect(typed(f, "-5")).toEqual({ refused: { reason: "notAbove", min: 0, text: "-5" } });
    expect(typed(f, "0")).toEqual({ refused: { reason: "notAbove", min: 0, text: "0" } });
    expect(typed(f, "1e9")).toEqual({ refused: { reason: "aboveMax", min: undefined, max: BLUEPRINT_RADIUS_CEILING, text: "1e9" } });
    expect(typed(f, "12")).toEqual({ commit: 12 });
  });

  it("refuses a second slider on the same number written another way", () => {
    const spec = raw([
      { id: "a", at: "bodies[0].radius", min: 4, max: 20, step: 1 },
      { id: "b", at: "bodies[00].radius", min: 4, max: 20, step: 1 },
    ]);
    expect(validateBlueprint(spec).join("\n")).toMatch(/params\[1\]\.at: "bodies\[0\]\.radius" has a slider already/);
    expect(sanitizeBlueprint(spec).blueprint.params.map((p) => p.id)).toEqual(["a"]);
  });
});

describe("Mode Lab: a bound across numbers holds with the other sliders where they are", () => {
  // Glass Hatchery's tiles on a 3 × 8 grid with a slider on each of rows, columns, the inner and the outer edge
  const hatchery = catalogBlueprint("hatchery");
  const tiles = linkSpec({
    ...hatchery,
    tiles: { ...hatchery.tiles, layout: "grid", rows: 3, cols: 8 },
    params: [
      { id: "rows", at: "tiles.rows", min: 1, max: 10, step: 1 },
      { id: "cols", at: "tiles.cols", min: 1, max: 48, step: 1 },
      { id: "inner", at: "tiles.inner", min: 0.1, max: 0.6, step: 0.05 },
      { id: "outer", at: "tiles.outer", min: 0.5, max: 0.95, step: 0.05 },
    ],
  });

  it("tops the rows at the tile ceiling over the columns the cols slider holds now", () => {
    const { bp, code } = tiles;
    expect(paramBounds(bp)[0]).toEqual({ min: 1, max: BLUEPRINT_LIMITS.tileRows, integer: true }); // (8 columns: the rows' own top)
    expect(paramBounds(bp, parseParamValues(",48"))[0]).toEqual({ min: 1, max: Math.floor(BLUEPRINT_LIMITS.tiles / 48), integer: true });
    const f = fieldAt(render({ blSpec: code, blParams: ",48" }).fields, 0);
    expect(f.rules?.max).toBe(Math.floor(BLUEPRINT_LIMITS.tiles / 48));
    expect(typed(f, "13")).toEqual({ refused: { reason: "aboveMax", min: undefined, max: 12, text: "13" } });
    expect(typed(f, "12")).toEqual({ commit: 12 });
    expect(plays(bp, 0, 12, [null, 48])).toBe(true);
    expect(plays(bp, 0, 13, [null, 48])).toBe(false);
    // ...and the columns' top over the rows the rows slider holds now
    const cols = fieldAt(render({ blSpec: code, blParams: "24" }).fields, 1);
    expect(cols.rules?.max).toBe(Math.floor(BLUEPRINT_LIMITS.tiles / 24));
    expect(plays(bp, 1, cols.rules!.max!, [24])).toBe(true);
    expect(plays(bp, 1, cols.rules!.max! + 1, [24])).toBe(false);
  });

  it("keeps the inner edge below the outer one: each field refuses the other's value, as the sanitizer would reset both", () => {
    const { bp, code } = tiles;
    const [, , inner, outer] = paramBounds(bp);
    expect(inner).toEqual({ min: 0.05, max: bp.tiles!.outer, below: true });
    expect(outer).toEqual({ min: bp.tiles!.inner, above: true, max: 1 });
    const all = render({ blSpec: code }).fields;
    expect(typed(fieldAt(all, 2), String(bp.tiles!.outer))).toEqual({ refused: { reason: "notBelow", min: undefined, max: bp.tiles!.outer, text: String(bp.tiles!.outer) } });
    expect(typed(fieldAt(all, 2), "0.8")).toEqual({ commit: 0.8 });
    expect(typed(fieldAt(all, 3), String(bp.tiles!.inner))).toEqual({ refused: { reason: "notAbove", min: bp.tiles!.inner, text: String(bp.tiles!.inner) } });
    // (each bound is where sanitizing starts to change the value)
    expect(plays(bp, 2, 0.8)).toBe(true);
    expect(plays(bp, 2, bp.tiles!.outer)).toBe(false);
    expect(plays(bp, 3, bp.tiles!.inner + 0.01)).toBe(true);
    expect(plays(bp, 3, bp.tiles!.inner)).toBe(false);
    // with the outer slider at 0.6 the inner field stops below 0.6, and an arrow press never lands on it
    const moved = fieldAt(render({ blSpec: code, blParams: ",,,0.6" }).fields, 2);
    expect(moved.rules).toMatchObject({ max: 0.6, below: true });
    expect(typed(moved, "0.6")).toEqual({ refused: { reason: "notBelow", min: undefined, max: 0.6, text: "0.6" } });
    expect(arrow({ ...moved, value: 0.55 }, 1)).toBe(0.55);
    for (const locale of ["en", "pl", "es"] as const) {
      const u = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Uncap" as never }) as unknown as (key: string, values: Record<string, string>) => string;
      expect([locale, u("errNotBelow", { max: "0.6" })]).toEqual([locale, expect.stringContaining("0.6")]);
    }
  });

  it("tops a peg grid's rows over the columns now, and the columns over the rows now", () => {
    const peg = catalogBlueprint("plinkoRace");
    const { bp, code } = linkSpec({
      ...peg,
      obstacles: [{ ...peg.obstacles[0], rows: 2, cols: 7 }],
      params: [
        { id: "rows", at: "obstacles[0].rows", min: 1, max: 6, step: 1 },
        { id: "cols", at: "obstacles[0].cols", min: 1, max: 24, step: 1 },
      ],
    });
    const L = BLUEPRINT_LIMITS.obstacles;
    expect(fieldAt(render({ blSpec: code, blParams: ",24" }).fields, 0).rules?.max).toBe(Math.floor(L / 24));
    expect(fieldAt(render({ blSpec: code, blParams: "6" }).fields, 1).rules?.max).toBe(Math.floor(L / 6));
    expect(plays(bp, 1, Math.floor(L / 6), [6])).toBe(true);
    expect(plays(bp, 1, Math.floor(L / 6) + 1, [6])).toBe(false);
  });

  it("says the new bounds to the app AI the same way", () => {
    const line = settingsCatalog({ ...defaultSettings("blueprint"), blSpec: tiles.code, blParams: ",48" }).split("\n").find((l) => l.startsWith("blParams"))!;
    expect(line).toContain(`rows (whole number from 1 up to ${Math.floor(BLUEPRINT_LIMITS.tiles / 48)}, slider 1–10, step 1)`);
    expect(line).toContain(`inner (number from 0.05 and below ${tiles.bp.tiles!.outer}, slider 0.1–0.6, step 0.05)`);
    expect(line).toContain(`outer (number above ${tiles.bp.tiles!.inner} up to 1, slider 0.5–0.95, step 0.05)`);
  });
});

describe("Mode Lab: the link carries the value the field took", () => {
  it("writes Tier Climb's 0.0004 s rain exactly, so the rain gets faster instead of stopping", () => {
    const i = slider("tierClimb", "rain");
    const panel = render({ blPreset: "tierClimb" });
    const f = fieldAt(panel.fields, i);
    expect(typed(f, "0.0004")).toEqual({ commit: 0.0004 });
    f.onCommit(0.0004); // (what the field does with that commit: the slider's value, into the settings)
    expect(panel.updates).toEqual([{ blParams: ",0.0004" }]);
    const settings = settingsFromSearchParams(settingsToSearchParams({ ...defaultSettings("blueprint"), mode: "blueprint", blPreset: "tierClimb", blParams: ",0.0004" } as SimulatorSettings));
    expect(settings.blParams).toBe(",0.0004");
    const played = resolveBlueprintSpec({ preset: "tierClimb", spec: "", params: settings.blParams });
    expect([played.blueprint.spawners[0].everySec, played.notes]).toEqual([0.0004, []]);
  });

  it("reads back every typed number exactly", () => {
    const values = [0.0004, 1e-7, 2.5, 22.5, 0.1 + 0.2, 123456.789012, -0.0005, 1e21, -3];
    expect(parseParamValues(formatParamValues(values))).toEqual(values);
    expect(formatParamValues([null, 0.0004, 1e21])).toBe(",0.0004,1e21");
  });
});

describe("Mode Lab: a link's value past the language's bound says what plays", () => {
  const tipOf = (html: string, i: number) => fieldTag(html, i).match(/title="([^"]*)"/)?.[1] ?? "";

  it("shows Ring Breaker's gap 500 with the 180 it plays, never 'the value runs as typed', and steps down onto 180", () => {
    const i = slider("ringBreaker", "gap");
    const { html, fields: all } = render({ blPreset: "ringBreaker", blParams: `${",".repeat(i)}500` });
    expect(paramPlayed(catalogBlueprint("ringBreaker"), parseParamValues(`${",".repeat(i)}500`), i)).toBe(180);
    const f = fieldAt(all, i);
    expect(f.value).toBe(500);
    expect(f.changedTip).toBe("Past this game's own bounds, so it plays 180. The link keeps your number.");
    expect(fieldTag(html, i)).toMatch(/data-changed="1"/);
    expect(tipOf(html, i)).toMatch(/so it plays 180\./);
    expect(tipOf(html, i)).not.toMatch(/runs as typed/);
    expect(html).toContain(`data-uncap-plays="blParam${i}"`);
    expect(arrow(f, 1)).toBe(500); // (up from past the top: nothing; it never lowers the value)
    expect(arrow(f, -1)).toBe(180);
  });

  it("says the same of Tier Climb's tier 100 and of a gap of 2 below the floor, and nothing of a value that plays", () => {
    const target = render({ blPreset: "tierClimb", blParams: "100" });
    expect(fieldAt(target.fields, 0).changedTip).toMatch(/so it plays 99\./);
    expect(arrow(fieldAt(target.fields, 0), 1)).toBe(100);
    const i = slider("ringBreaker", "gap");
    const low = fieldAt(render({ blPreset: "ringBreaker", blParams: `${",".repeat(i)}2` }).fields, i);
    expect(low.changedTip).toMatch(/so it plays 5\./);
    expect(arrow(low, -1)).toBe(2); // (down from below the floor: nothing; it never raises the value)
    expect(arrow(low, 1)).toBe(5);
    const fine = render({ blPreset: "ringBreaker", blParams: `${",".repeat(i)}20` });
    expect(fieldAt(fine.fields, i).changedTip).toBeUndefined();
    expect(fieldTag(fine.html, i)).not.toMatch(/data-changed/);
    expect(fine.html).not.toContain("data-uncap-plays");
  });

  it("says a part the game leaves out, when a link's values together drop a peg grid", () => {
    const peg = catalogBlueprint("plinkoRace");
    const { bp, code } = linkSpec({
      ...peg,
      obstacles: [{ ...peg.obstacles[0], rows: 2, cols: 7 }],
      params: [
        { id: "rows", at: "obstacles[0].rows", min: 1, max: 6, step: 1 },
        { id: "cols", at: "obstacles[0].cols", min: 1, max: 24, step: 1 },
      ],
    });
    const played = resolveBlueprintSpec({ preset: "plinkoRace", spec: code, params: "6,24" }).blueprint;
    expect(played.obstacles).toEqual([]);
    expect([paramPlayed(bp, [6, 24], 0), paramPlayed(bp, [6, 24], 1)]).toEqual([null, null]);
    // (the bounds are read with the values the link holds: the dropped grid's rows stop at the room the other patterns leave it
    // under its 24 columns – 48 obstacles, none taken –, its columns at that room under its 6 rows)
    expect(paramBounds(bp, [6, 24])).toEqual([
      { min: 1, max: Math.floor(BLUEPRINT_LIMITS.obstacles / 24), integer: true },
      { min: 1, max: Math.floor(BLUEPRINT_LIMITS.obstacles / 6), integer: true },
    ]);
    const { fields: all } = render({ blSpec: code, blParams: "6,24" });
    expect(fieldAt(all, 0).changedTip).toBe("Past this game's own bounds, so the game leaves this part out. The link keeps your number.");
  });

  it("has the words in every language, the number filled in", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      const u = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Uncap" as never }) as unknown as (key: string, values?: Record<string, string>) => string;
      expect([locale, u("playsAs", { value: "180" })]).toEqual([locale, expect.stringContaining("180")]);
      expect([locale, u("playsNone").length > 20]).toEqual([locale, true]);
    }
    expect(fieldAt(render({ blPreset: "ringBreaker", blParams: `${",".repeat(slider("ringBreaker", "gap"))}500` }, "pl").fields, slider("ringBreaker", "gap")).changedTip).toBe(pl.Uncap.playsAs.replace("{value}", "180"));
  });
});

// --- unlimited-sizes --- (review round 3) a variable a count reads, bounds read on the values a link holds, a dropped pattern
// told apart from the ones that still play, an arrow press out of a strict bound, and a slider's value past its range in its unit

describe("Mode Lab: a variable a count reads is bounded and played as that count", () => {
  const conquer = catalogBlueprint("conquer");
  const per = slider("conquer", "per");
  const at = (v: string) => `${",".repeat(per)}${v}`;
  /** The balls in Colour Conquest's arena a moment after the start, with balls a colour at `v`. */
  const ballsAtStart = (v: string) => {
    const r = new HeadlessBlueprint(conquer, { seed: 1, params: at(v) });
    for (let k = 0; k < 3; k++) r.step();
    return r.run.count("balls");
  };

  it("says what a link's balls a colour play – the runtime's whole count of 0 to 8 –, never that they run as typed", () => {
    for (const [link, played] of [["0.4", 0], ["2.5", 3], ["20", BLUEPRINT_LIMITS.perSpawn], ["-3", 0], ["1e9", BLUEPRINT_LIMITS.perSpawn]] as const) {
      expect([link, paramPlayed(conquer, parseParamValues(at(link)), per)]).toEqual([link, played]);
      // (four colours: the arena holds four times what one plays)
      expect([link, ballsAtStart(link)]).toEqual([link, 4 * played]);
      const { html, fields: all } = render({ blPreset: "conquer", blParams: at(link) });
      expect([link, fieldAt(all, per).changedTip]).toEqual([link, `Past this game's own bounds, so it plays ${played}. The link keeps your number.`]);
      expect([link, html.includes(`data-uncap-plays="blParam${per}"`)]).toEqual([link, true]);
    }
    // (a whole count inside them plays as written, and says nothing)
    expect(ballsAtStart("5")).toBe(20);
    const fine = render({ blPreset: "conquer", blParams: at("5") });
    expect(fieldAt(fine.fields, per).changedTip).toBeUndefined();
    expect(fine.html).not.toContain("data-uncap-plays");
  });

  it("gives the field the count's bound: whole numbers from 0 to a spawn's 8 balls, refused past them with the bound named", () => {
    const f = fieldAt(render({ blPreset: "conquer" }).fields, per);
    expect(f.rules).toEqual({ min: 0, max: BLUEPRINT_LIMITS.perSpawn, integer: true });
    expect(typed(f, "-3")).toEqual({ refused: { reason: "belowMin", min: 0, text: "-3" } });
    expect(typed(f, "9")).toEqual({ refused: { reason: "aboveMax", min: undefined, max: BLUEPRINT_LIMITS.perSpawn, text: "9" } });
    expect(typed(f, "1e9")).toEqual({ refused: { reason: "aboveMax", min: undefined, max: BLUEPRINT_LIMITS.perSpawn, text: "1e9" } });
    expect(typed(f, "2.5")).toEqual({ commit: 3 });
    expect(typed(f, "8")).toEqual({ commit: 8 });
    // ...and the app AI is told the same
    const line = settingsCatalog({ ...defaultSettings("blueprint"), blPreset: "conquer" }).split("\n").find((l) => l.startsWith("blParams"))!;
    expect(line).toContain(`per (whole number from 0 up to ${BLUEPRINT_LIMITS.perSpawn}, slider 2–8, step 1)`);
  });

  it("bounds a split's into from 2, and leaves a variable a rule changes, or a count of a formula, unbounded", () => {
    const base = { v: 1, meta: { name: "Counts" }, bodies: [{ id: "b" }], finish: { timeoutSec: 30 } };
    const split = linkSpec({
      ...base,
      vars: [{ id: "k", start: 3 }],
      spawners: [{ body: "b" }],
      rules: [{ when: "wallHit", do: [{ act: "split", into: "k" }] }],
      params: [{ id: "k", at: "vars[0].start", min: 2, max: 6, step: 1 }],
    }).bp;
    expect(paramBounds(split)).toEqual([{ min: 2, max: BLUEPRINT_LIMITS.perSpawn, integer: true }]);
    expect(paramPlayed(split, [1], 0)).toBe(2);
    const changed = linkSpec({
      ...base,
      vars: [{ id: "k", start: 3 }],
      spawners: [{ body: "b", count: "k" }],
      rules: [{ when: "timer", sec: 1, do: [{ act: "var", id: "k", op: "add", value: 1 }] }],
      params: [{ id: "k", at: "vars[0].start", min: 1, max: 6, step: 1 }],
    }).bp;
    expect([paramBounds(changed), paramPlayed(changed, [0.4], 0)]).toEqual([[{}], 0.4]);
    const formula = linkSpec({ ...base, vars: [{ id: "k", start: 3 }], spawners: [{ body: "b", count: "k * 2" }], params: [{ id: "k", at: "vars[0].start", min: 1, max: 6, step: 1 }] }).bp;
    expect(paramBounds(formula)).toEqual([{}]);
  });
});

describe("Mode Lab: bounds read on the values a link holds", () => {
  const { bp, code } = linkSpec({
    ...catalogBlueprint("hatchery"),
    params: [
      { id: "inner", at: "tiles.inner", min: 0.1, max: 0.6, step: 0.05 },
      { id: "outer", at: "tiles.outer", min: 0.5, max: 0.95, step: 0.05 },
    ],
  });

  it("keeps the outer edge above the inner edge a link holds, even when the two cross and the game resets both", () => {
    // (0.7 and 0.6 cross: the game plays its own edges, and each field is bounded by the other's held value, not the reset one)
    expect(resolveBlueprintSpec({ preset: "hatchery", spec: code, params: "0.7,0.6" }).notes).toEqual(["tiles.outer: must be above tiles.inner (0.7)"]);
    expect(paramBounds(bp, [0.7, 0.6])).toEqual([
      { min: 0.05, max: 0.6, below: true },
      { min: 0.7, above: true, max: 1 },
    ]);
    const all = render({ blSpec: code, blParams: "0.7,0.6" }).fields;
    expect(typed(fieldAt(all, 1), "0.65")).toEqual({ refused: { reason: "notAbove", min: 0.7, text: "0.65" } });
    expect(typed(fieldAt(all, 0), "0.75")).toEqual({ refused: { reason: "notBelow", min: undefined, max: 0.6, text: "0.75" } });
    // (what each field takes plays as typed with the other where it is)
    expect(typed(fieldAt(all, 1), "0.75")).toEqual({ commit: 0.75 });
    expect(plays(bp, 1, 0.75, [0.7])).toBe(true);
    expect(typed(fieldAt(all, 0), "0.55")).toEqual({ commit: 0.55 });
    expect(plays(bp, 0, 0.55, [null, 0.6])).toBe(true);
    const line = settingsCatalog({ ...defaultSettings("blueprint"), blSpec: code, blParams: "0.7,0.6" }).split("\n").find((l) => l.startsWith("blParams"))!;
    expect(line).toContain("outer (number above 0.7 up to 1, slider 0.5–0.95, step 0.05)");
  });

  it("tops a peg grid a link's values drop by the room the other patterns leave it", () => {
    const peg = catalogBlueprint("plinkoRace");
    const grid = linkSpec({
      ...peg,
      obstacles: [{ ...peg.obstacles[0], rows: 2, cols: 7 }],
      params: [
        { id: "rows", at: "obstacles[0].rows", min: 1, max: 6, step: 1 },
        { id: "cols", at: "obstacles[0].cols", min: 1, max: 24, step: 1 },
      ],
    });
    const rows = fieldAt(render({ blSpec: grid.code, blParams: "6,24" }).fields, 0);
    expect(rows.rules?.max).toBe(Math.floor(BLUEPRINT_LIMITS.obstacles / 24));
    expect(typed(rows, "3")).toEqual({ refused: { reason: "aboveMax", min: undefined, max: 2, text: "3" } });
    expect(typed(rows, "2")).toEqual({ commit: 2 });
    expect(plays(grid.bp, 0, 2, [null, 24])).toBe(true);
    expect(plays(grid.bp, 0, 3, [null, 24])).toBe(false);
  });
});

describe("Mode Lab: a pattern the obstacle ceiling drops is told apart from the ones that still play", () => {
  // Peg Race with a peg grid, a peg ring and a bar, a slider on each
  const peg = catalogBlueprint("plinkoRace");
  const { bp, code } = linkSpec({
    ...peg,
    obstacles: [
      { ...peg.obstacles[0], rows: 3, cols: 4 },
      { kind: "pegRing", radius: 0.3, count: 8 },
      { kind: "bar", y: 0.6, len: 0.4 },
    ],
    params: [
      { id: "rows", at: "obstacles[0].rows", min: 1, max: 9, step: 1 },
      { id: "ring", at: "obstacles[1].count", min: 1, max: 20, step: 1 },
      { id: "len", at: "obstacles[2].len", min: 0.1, max: 1, step: 0.1 },
    ],
  });

  it("says only the dropped ring is left out: the grid's 9 rows and the bar play, each read at its place in the game", () => {
    const played = resolveBlueprintSpec({ preset: "plinkoRace", spec: code, params: "9,20" }).blueprint;
    expect(played.obstacles.map((o) => o.kind)).toEqual(["pegGrid", "bar"]);
    expect(paramsPlayed(bp, [9, 20])).toEqual([9, null, 0.4]);
    const { html, fields: all } = render({ blSpec: code, blParams: "9,20" });
    expect([fieldAt(all, 0).changedTip, fieldAt(all, 1).changedTip, fieldAt(all, 2).changedTip]).toEqual([undefined, "Past this game's own bounds, so the game leaves this part out. The link keeps your number.", undefined]);
    expect(html.match(/data-uncap-plays="[^"]*"/g)).toEqual(['data-uncap-plays="blParam1"']);
  });

  it("bounds each pattern by the room the others leave it as the link holds them", () => {
    const L = BLUEPRINT_LIMITS.obstacles;
    // (the grid's 36 pegs and the bar kept, the ring of 20 dropped: the grid's rows and the ring each get what the others leave)
    expect(paramBounds(bp, [9, 20])).toEqual([
      { min: 1, max: Math.floor((L - 1) / 4), integer: true },
      { min: 1, max: L - 36 - 1, integer: true },
      { min: 0, above: true, max: 2 },
    ]);
    // (the ring at that top plays and so does everything else; one more, and the bar is dropped)
    expect(plays(bp, 1, L - 37, [9])).toBe(true);
    expect(paramsPlayed(bp, [9, L - 36])).toEqual([9, L - 36, null]);
    // (the grid's rows up to their top keep the bar; past it the grid still plays, the bar is dropped)
    expect(paramsPlayed(bp, [Math.floor((L - 1) / 4), 20])).toEqual([Math.floor((L - 1) / 4), null, 0.4]);
    expect(paramsPlayed(bp, [Math.floor((L - 1) / 4) + 1, 20])).toEqual([Math.floor((L - 1) / 4) + 1, null, null]);
  });
});

describe("Mode Lab: an arrow press steps out of a link's value past a strict bound", () => {
  it("steps up from below a 'more than' floor to the first value past it, and down from past a 'less than' top", () => {
    const size = slider("growEscape", "size");
    const low = fieldAt(render({ blPreset: "growEscape", blParams: `${",".repeat(size)}-5` }).fields, size);
    expect(low.rules).toMatchObject({ min: 0, above: true });
    expect(arrow(low, 1)).toBe(1);
    expect(arrow({ ...low, value: -15 }, 1)).toBe(1);
    expect(arrow(low, -1)).toBe(-5); // (down from below the floor: nothing, as before)
    const boost = slider("conquer", "boost");
    const every = fieldAt(render({ blPreset: "conquer", blParams: `${",".repeat(boost)}-3` }).fields, boost);
    expect([arrow(every, 1), arrow({ ...every, value: -30 }, 1), arrow(every, -1)]).toEqual([1, 1, -3]);
    // (Shift's ten steps land past it too)
    expect(numberFieldReduce(IDLE_FIELD, { type: "step", direction: 1, modifier: "coarse" }, -15, low.range, low.rules).commit).toBe(10);
    // the mirror: Glass Hatchery's inner edge from past the outer one steps down below it
    const hatchery = catalogBlueprint("hatchery");
    const { code } = linkSpec({ ...hatchery, params: [{ id: "inner", at: "tiles.inner", min: 0.1, max: 0.6, step: 0.05 }] });
    const inner = fieldAt(render({ blSpec: code, blParams: "0.93" }).fields, 0);
    expect(inner.rules).toMatchObject({ max: hatchery.tiles!.outer, below: true });
    const below = Number((hatchery.tiles!.outer - 0.05).toFixed(3));
    expect([arrow(inner, -1), arrow({ ...inner, value: 1.1 }, -1), arrow(inner, 1)]).toEqual([below, below, 0.93]);
    // (onto the bound itself from inside: still not taken)
    expect(arrow({ ...inner, value: below }, 1)).toBe(below);
  });

  it("leaves an 'at least' floor and a plain top as they were", () => {
    expect(stepNumber(-50, 1, { min: 24, max: 30, step: 1 }, { min: 5 })).toBe(5);
    expect(stepNumber(500, -1, { min: 24, max: 30, step: 1 }, { min: 5, max: 180 })).toBe(180);
    expect(stepNumber(0.5, -1, { min: 4, max: 20, step: 1 }, { min: 0, above: true })).toBe(0.5);
  });
});

describe("Mode Lab: a slider's value past its range keeps its unit and the page's number format", () => {
  /** The value a slider's label shows, and whether it is tinted as past the range. */
  const labelOf = (html: string, i: number) => {
    const m = html.slice(html.indexOf(`data-uncap-slider="blParam${i}"`)).match(/<span class="num shrink-0 text-xs([^"]*)">([^<]*)<\/span>/);
    return { text: m?.[2] ?? "", warn: /text-warn/.test(m?.[1] ?? "") };
  };
  const shown = (game: BlueprintCatalogId, id: string, value: string, locale: Locale = "en") => {
    const i = slider(game, id);
    return labelOf(render({ blPreset: game, blParams: `${",".repeat(i)}${value}` }, locale).html, i);
  };

  it("shows a 0.4 px ball, a 0.0004 s rain, a 20.5° gap and a 1234.5 px/s² gravity as it shows them inside the range", () => {
    expect(shown("growEscape", "size", "0.4")).toEqual({ text: "0.4 px", warn: true });
    expect(shown("growEscape", "size", "0.4", "pl")).toEqual({ text: "0,4 px", warn: true });
    expect(shown("tierClimb", "rain", "0.0004")).toEqual({ text: "0.0004 s", warn: true });
    expect(shown("tierClimb", "rain", "0.0004", "pl")).toEqual({ text: "0,0004 s", warn: true });
    expect(shown("ringBreaker", "gap", "20.5")).toEqual({ text: "20.5°", warn: true });
    expect(shown("tierClimb", "gravity", "1234.5")).toEqual({ text: "1,234.5 px/s²", warn: true });
    expect(shown("tierClimb", "gravity", "1234.5", "pl")).toEqual({ text: "1234,5 px/s²", warn: true });
    // (inside the range: as before, untinted)
    expect(shown("growEscape", "size", "4.5", "pl")).toEqual({ text: "4,5 px", warn: false });
  });

  it("keeps a huge or a tiny value short, never every digit or 0", () => {
    expect(shown("tierClimb", "gravity", "1e12")).toEqual({ text: "1T px/s²", warn: true });
    expect(shown("tierClimb", "gravity", "1e300")).toEqual({ text: "1E300 px/s²", warn: true });
    expect(shown("tierClimb", "rain", "1e-7")).toEqual({ text: "1E-7 s", warn: true });
    expect(shown("tierClimb", "rain", "1e-7", "es")).toEqual({ text: "1E-7 s", warn: true });
  });
});
