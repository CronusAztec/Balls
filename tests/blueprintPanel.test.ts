import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { BLUEPRINT_CATALOG_IDS, PlayabilityRun, catalogBlueprint, paramUnit, paramValue, sanitizeBlueprint, type BlueprintCatalogId, type ParamUnit } from "@/lib/blueprint";
import BlueprintSection, { CHECK_SLICE_MS, blueprintParamDisplay, copyGameLink } from "@/components/simulator/sections/BlueprintSection";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- review fix (blueprint) --- Mode Lab's panel (components/simulator/sections/BlueprintSection.tsx) as a visitor meets it:
 * every slider says its unit in the page's number format, the check's progress, Copy link's outcome and the verdict are live
 * regions, Copy link says when it could not copy, and the check of a stranger's heavy game yields to the page within a seed.
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

type Messages = typeof en;
const LOCALES: Record<"en" | "pl" | "es", Messages> = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };
type Locale = keyof typeof LOCALES;

/** A unit's message (Blueprint.unit.<unit>) in `locale`, with the number filled in. */
const unitText = (locale: Locale) => {
  const t = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Blueprint.unit" as never }) as unknown as (key: string, values: Record<string, string>) => string;
  return (unit: Exclude<ParamUnit, "">, n: string) => t(unit, { n });
};

/** The panel rendered on the server for `settings`, in `locale`. */
const render = (patch: Partial<SimulatorSettings>, locale: Locale = "en") => {
  const t = createTranslator({ locale, messages: LOCALES[locale] as never, namespace: "Controls" as never }) as unknown as Translate;
  const settings = { ...defaultSettings("blueprint"), mode: "blueprint", ...patch } as SimulatorSettings;
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(BlueprintSection, { t, search: "", matches: () => true, settings, update: () => {} }),
    ),
  );
};
/** The opening tag of the element that carries `data-testid`. */
const tag = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("blueprint panel: a slider says its unit", () => {
  it("reads each catalog slider's unit from the number it changes: seconds, degrees, degrees a second, px, px/s, px/s², or a count", () => {
    const units = Object.fromEntries(BLUEPRINT_CATALOG_IDS.map((id) => [id, catalogBlueprint(id).params.map((_, i) => paramUnit(catalogBlueprint(id), i))]));
    expect(units).toEqual({
      hatchery: ["", "", "pxPerSec"],
      ringBreaker: ["", "deg", "degPerSec"],
      conquer: ["", "s"],
      tierClimb: ["", "s", "pxPerSec2"],
      plinkoRace: ["deg", "degPerSec", ""],
      growEscape: ["px", "deg", ""],
    });
  });

  it("shows a value in the page's number format with its unit, in English, Polish and Spanish", () => {
    const shown = (id: BlueprintCatalogId, i: number, locale: Locale) => {
      const bp = catalogBlueprint(id);
      return blueprintParamDisplay(bp, i, paramValue(bp, i), locale, unitText(locale));
    };
    expect(["en", "pl", "es"].map((l) => shown("conquer", 1, l as Locale))).toEqual(["6 s", "6 s", "6 s"]);
    expect(shown("growEscape", 1, "en")).toMatch(/^\d+°$/);
    expect(shown("ringBreaker", 2, "es")).toMatch(/^\d+°\/s$/);
    expect(shown("hatchery", 2, "pl")).toMatch(/^\d+ px\/s$/);
    expect(shown("tierClimb", 2, "en")).toMatch(/^\d+ px\/s²$/);
    // a step under 1 keeps its decimals, written the locale's way; a count shows bare
    expect([shown("tierClimb", 1, "en"), shown("tierClimb", 1, "pl"), shown("tierClimb", 1, "es")]).toEqual(["0.08 s", "0,08 s", "0,08 s"]);
    expect(shown("growEscape", 0, "pl")).toMatch(/^\d,\d px$/);
    expect(shown("hatchery", 0, "en")).toMatch(/^\d+$/);
  });

  it("draws the playing game's sliders with their units on the page", () => {
    const html = render({ blPreset: "conquer" }, "pl");
    expect(html).toContain(pl.Blueprints.conquer.params.boost);
    expect(html).toMatch(/>6 s</);
    expect(render({ blPreset: "ringBreaker" }, "en")).toMatch(/>\d+°\/s</);
  });
});

describe("blueprint panel: the check, Copy link and the verdict speak to a screen reader", () => {
  it("has a live region for the check's progress, for Copy link's outcome and for the verdict, in every language", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      const html = render({ blPreset: "hatchery" }, locale);
      for (const id of ["blueprint-check-progress", "blueprint-copy-status", "blueprint-verdict-status"]) {
        const el = tag(html, id);
        expect([locale, id, el.includes('role="status"') && el.includes('aria-live="polite"')]).toEqual([locale, id, true]);
      }
      // the check's button starts the check (and, while it runs, stops it): it is never disabled
      expect(tag(html, "blueprint-check")).not.toMatch(/\sdisabled/);
      expect(html).toContain(LOCALES[locale].Controls.blCheck);
    }
    for (const locale of ["en", "pl", "es"] as const) {
      const c = LOCALES[locale].Controls as Record<string, string>;
      for (const key of ["blCheckStop", "blCopied", "blCopyFailed", "blLinkField"]) expect([locale, key, (c[key] ?? "").length > 3]).toEqual([locale, key, true]);
    }
  });

  it("says Copy link failed – no clipboard, or one that refuses – instead of doing nothing", async () => {
    const written: string[] = [];
    expect(await copyGameLink("https://x/a", { writeText: async (s: string) => void written.push(s) })).toBe("copied");
    expect(written).toEqual(["https://x/a"]);
    expect(await copyGameLink("https://x/a", undefined)).toBe("failed");
    expect(await copyGameLink("https://x/a", null)).toBe("failed");
    expect(await copyGameLink("https://x/a", {} as never)).toBe("failed");
    expect(await copyGameLink("https://x/a", { writeText: () => Promise.reject(new DOMException("blocked", "NotAllowedError")) })).toBe("failed");
    expect(
      await copyGameLink("https://x/a", {
        writeText: () => {
          throw new Error("sync");
        },
      }),
    ).toBe("failed");
  });
});

describe("blueprint panel: the check of a stranger's heavy game never freezes the tab", () => {
  // the review's game: six spawners of 8 balls every 0.2 s up to 400, radius 5, a finish it never reaches in 180 s – well
  // inside every ceiling, its code 809 characters – once at speed 300 and once at 3,000
  const heavy = (speed: number) =>
    sanitizeBlueprint({
      v: 1,
      meta: { name: "Heavy" },
      bodies: [{ id: "b", radius: 5 }],
      spawners: Array.from({ length: 6 }, () => ({ body: "b", count: 8, everySec: 0.2, maxTotal: 400, speed, at: "random" })),
      sound: { voices: { ballHit: "hit" } },
      finish: { timeoutSec: 180, any: [{ when: "escaped", atLeast: 1 }] },
    }).blueprint;

  it("stops each slice on the clock within a seed: a 4 ms slice plays at most 4 steps, so a seed takes many slices", () => {
    let clock = 0;
    const now = () => (clock += 1);
    const run = new PlayabilityRun(heavy(300), [1]);
    let slices = 0;
    while (slices < 200 && !run.slice(4, now)) slices++;
    // 200 slices of at most 4 steps are at most 800 of the seed's 10,800 steps: still on the first seed
    expect([slices, run.seedsDone, run.done]).toEqual([200, 0, null]);
  });

  it("keeps every slice of the panel's check short on the real clock while the crowd fills the arena", () => {
    for (const speed of [300, 3000]) {
      const run = new PlayabilityRun(heavy(speed));
      let worst = 0;
      for (let i = 0; i < 150 && !run.done; i++) {
        const t0 = performance.now();
        run.slice(CHECK_SLICE_MS, () => performance.now());
        worst = Math.max(worst, performance.now() - t0);
      }
      expect([speed, worst < 100]).toEqual([speed, true]);
    }
  });
});
