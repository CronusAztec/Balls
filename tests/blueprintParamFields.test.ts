import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { BLUEPRINT_CATALOG_IDS, BLUEPRINT_LIMITS, BLUEPRINT_RADIUS_CEILING, BLUEPRINT_SPEED_CEILING, applyBlueprintParams, blueprintNumberBounds, catalogBlueprint, numberAt, paramBounds, sanitizeBlueprint, type BlueprintCatalogId } from "@/lib/blueprint";
import BlueprintSection, { blueprintParamRules } from "@/components/simulator/sections/BlueprintSection";
import type { NumberFieldProps } from "@/components/simulator/NumberField";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import { IDLE_FIELD, checkTypedNumber, numberFieldReduce, stepNumber, type NumberRules } from "@/lib/uncap";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
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

/** The panel rendered on the server for `settings`, in `locale`: its markup and the props of every number field in it. */
const render = (patch: Partial<SimulatorSettings>, locale: Locale = "en") => {
  const t = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Controls" as never }) as unknown as Translate;
  const settings = { ...defaultSettings("blueprint"), mode: "blueprint", ...patch } as SimulatorSettings;
  fields.length = 0;
  const html = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(BlueprintSection, { t, search: "", matches: () => true, settings, update: () => {} }),
    ),
  );
  return { html, fields: [...fields] };
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
      conquer: { per: {}, boost: { min: 0, above: true } },
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
        const at = bp.params[i].at;
        const play = (v: number) => {
          const { blueprint, notes } = applyBlueprintParams(
            bp,
            bp.params.map((_, k) => (k === i ? v : null)),
          );
          return { kept: numberAt(blueprint, at) === v && notes.length === 0 };
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
        const rules = blueprintParamRules(bounds[i], { min: p.min, max: p.max, step: p.step });
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
      const p = bp.params[i];
      return blueprintParamRules(paramBounds(bp)[i], { min: p.min, max: p.max, step: p.step });
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
    // whole numbers where the language counts (a tier), or the slider steps by whole numbers (a gap of 24–30 in degrees)
    expect([rulesOf("tierClimb", "target").integer, rulesOf("ringBreaker", "gap").integer, rulesOf("growEscape", "grow").integer]).toEqual([true, true, false]);
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
        const want: NumberRules = blueprintParamRules(paramBounds(bp)[i], { min: p.min, max: p.max, step: p.step });
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
