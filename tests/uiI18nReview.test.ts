import { describe, expect, it } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";
import { Toggle, type Translate } from "@/components/simulator/ControlPrimitives";
import EscapeModeSection, { ESCAPE_MODE_KEYS, ESCAPE_MODE_KEYS_BY_MODE } from "@/components/simulator/sections/EscapeModeSection";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { PhysicsEngine } from "@/lib/physics/engine";
import type { ModeId, PhysicsConfig } from "@/lib/physics/types";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";

/*
 * Review fixes (ui-i18n): the settings search finds the escape modes' Mode-row controls, Wall Count / Gap Size are only
 * offered where they act, the ON/OFF toggles are named switches, the mode count in the copy comes from the code, and the
 * last hard-coded English strings have message keys.
 */

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

const LOCALES = { en, pl, es } as const;
type Messages = Record<string, unknown>;

/** A translator over the Controls namespace of `messages` (plain ICU formatting, like next-intl's). */
function translator(messages: Messages, locale: string): Translate {
  const controls = messages.Controls as Record<string, string>;
  const t = ((key: string, values?: Record<string, unknown>) => {
    const text = controls[key];
    if (text === undefined) throw new Error(`missing Controls.${key}`);
    return String(new IntlMessageFormat(text, locale).format(values as Record<string, string>));
  }) as unknown as Translate;
  (t as unknown as { has: (k: string) => boolean }).has = (k: string) => k in controls;
  return t;
}

/** Every string of a message tree with its dotted key. */
function* strings(tree: unknown, prefix = ""): Generator<[string, string]> {
  if (typeof tree === "string") yield [prefix, tree];
  else if (Array.isArray(tree)) for (let i = 0; i < tree.length; i++) yield* strings(tree[i], `${prefix}.${i}`);
  else if (tree && typeof tree === "object") for (const [k, v] of Object.entries(tree)) yield* strings(v, prefix ? `${prefix}.${k}` : k);
}

describe("settings search: the escape modes' Mode-row controls", () => {
  it("lists every label key the block renders, for its own mode, and every key has a label in every language", () => {
    expect(Object.keys(ESCAPE_MODE_KEYS_BY_MODE).sort()).toEqual(["accumulation", "colorMatch", "grow", "lines", "multiply", "target"]);
    expect([...ESCAPE_MODE_KEYS].sort()).toEqual([...new Set(Object.values(ESCAPE_MODE_KEYS_BY_MODE).flat())].sort());
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const controls = messages.Controls as Record<string, string>;
      for (const key of ESCAPE_MODE_KEYS) expect(controls[key], `${locale} Controls.${key}`).toBeTruthy();
    }
  });

  it("while searching, renders exactly the control that matches – a switch for Spikes, the slider for Growth Rate", () => {
    const t = translator(en, "en");
    const render = (mode: ModeId, query: string, patch: Partial<SimulatorSettings> = {}) => {
      const settings = { ...defaultSettings(mode), ...patch };
      const matches = (key: string) => (t as unknown as { has: (k: string) => boolean }).has(key) && (key.toLowerCase().includes(query.toLowerCase()) || t(key).toLowerCase().includes(query.toLowerCase()));
      // (--- uncap-all x ui-i18n --- the sliders read the Uncap messages through next-intl: render inside its provider)
      return renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, createElement(EscapeModeSection, { t, search: query, matches, settings, update: () => {} })));
    };
    const spikes = render("accumulation", "Spikes", { spikesEnabled: false });
    expect(spikes).toContain('role="switch"');
    expect(spikes).toContain(">Spikes<");
    expect(spikes).not.toContain("Escape Time");
    // The spike count is found even while spikes are off (otherwise the search would show an empty Ball section).
    const spike = render("accumulation", "spike", { spikesEnabled: false });
    expect(spike).toContain('role="switch"');
    expect(spike).toContain(`aria-label="${t("spikeCount")}"`);
    const growth = render("grow", "Growth Rate");
    expect(growth).toContain(`aria-label="${t("growthRate")}"`);
    expect(growth).not.toContain('role="switch"');
    const lineColor = render("grow", "Line Color", { growLines: false });
    expect(lineColor).toContain(`aria-label="${t("lineColor")}"`);
    for (const mode of Object.keys(ESCAPE_MODE_KEYS_BY_MODE) as ModeId[]) {
      for (const key of ESCAPE_MODE_KEYS_BY_MODE[mode]!) expect(render(mode, t(key)), `${mode}: ${key}`).not.toBe("");
    }
    // Another mode's key renders nothing (Classic has no block at all).
    expect(render("classic", "Spikes")).toBe("");
  });
});

describe("Toggle is a switch named by its label", () => {
  it("has role switch, aria-checked and aria-labelledby pointing at the label text only (not the tooltip); ON/OFF is hidden", () => {
    const t = translator(en, "en");
    for (const value of [false, true]) {
      const html = renderToStaticMarkup(createElement(Toggle, { t, labelKey: "rotation", tipKey: "rotationTip", value, onChange: () => {} }));
      expect(html).not.toContain("<label");
      expect(html).toContain('role="switch"');
      expect(html).toContain(`aria-checked="${value}"`);
      expect(html).not.toContain("aria-pressed");
      const id = /aria-labelledby="([^"]+)"/.exec(html)?.[1];
      expect(id).toBeTruthy();
      expect(html).toContain(`<span id="${id}">${t("rotation")}</span>`);
      expect(html).toContain(`<span aria-hidden="true">${value ? t("onText") : t("offText")}</span>`);
    }
  });
});

describe("Wall Count and Gap Size do nothing in Grow and Portal (so the Wall section leaves them out)", () => {
  const config: PhysicsConfig = { width: 800, height: 600, gravity: 300, bounce: 1, damping: 0, ballSpeed: 400, rotationSpeed: 1, wallCount: 7, gapSize: 0.4, ballColor: "#ffffff", ballRadius: 8, audioIntensity: 0 };
  const layout = (mode: ModeId, patch: Partial<PhysicsConfig>) => {
    const engine = new PhysicsEngine({ ...config });
    engine.setSeed(3);
    engine.initMode(mode);
    engine.setConfig(patch);
    return engine.getCircularWalls().map((w) => ({ radius: Math.round(w.radius), gaps: w.gaps.map((g) => +(g.endAngle - g.startAngle).toFixed(3)) }));
  };
  it("Grow and Portal keep their ring whatever the wall count and the gap size; Classic rebuilds", () => {
    for (const mode of ["grow", "portal"] as ModeId[]) {
      expect(layout(mode, { wallCount: 3, gapSize: 0.3 }), mode).toEqual(layout(mode, { wallCount: 12, gapSize: 1.2 }));
      expect(layout(mode, { wallCount: 12, gapSize: 1.2 })).toHaveLength(1);
    }
    expect(layout("classic", { wallCount: 3, gapSize: 0.3 })).toHaveLength(3);
    expect(layout("classic", { wallCount: 12, gapSize: 1.2 })).toHaveLength(12);
  });
});

describe("the mode count in the copy", () => {
  const NUMBER_WORDS: Record<keyof typeof LOCALES, string> = {
    en: "two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty",
    pl: "dwa|dwóch|trzy|trzech|cztery|czterech|pięć|pięciu|sześć|sześciu|siedem|siedmiu|osiem|ośmiu|dziewięć|dziewięciu|dziesięć|dziesięciu|jedenaście|jedenastu|dwanaście|dwunastu|trzynaście|trzynastu|dwadzieścia|dwudziestu|trzydzieści|trzydziestu",
    es: "dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta",
  };

  it("never hard-codes how many modes there are (a number, digits or words, next to mode / tryb / modo)", () => {
    for (const [locale, messages] of Object.entries(LOCALES) as [keyof typeof LOCALES, Messages][]) {
      const count = new RegExp(`(?<![\\p{L}\\d])(?:[2-9]|\\d{2,}|${NUMBER_WORDS[locale]})(?![\\p{L}\\d])\\s+(?:[\\p{L}-]+\\s+)?(?:modes?|modos?|tryb(?:y|ów|ami|ach|u|em)?)(?!\\p{L})`, "iu");
      const offenders = [...strings(messages)].filter(([, text]) => count.test(text)).map(([key, text]) => `${locale} ${key}: ${text.slice(0, 80)}`);
      expect(offenders).toEqual([]);
    }
  });

  it("formats {count} from the mode list in the hero, the meta descriptions, the feature list and How it works", () => {
    const n = MODE_CARD_ORDER.length;
    expect(n).toBeGreaterThanOrEqual(26);
    for (const [locale, messages] of Object.entries(LOCALES) as [keyof typeof LOCALES, Record<string, Record<string, unknown>>][]) {
      const texts = [(messages.SiteRedesign.hero as unknown as { sub: string }).sub /* --- site-redesign --- the hero sentence moved */, messages.SimulatorPage.metaDescription, messages.Layout.metaDescription, messages.Layout.featuresModes, (messages.HowItWorks.step1 as { description: string }).description, messages.TikTokBallVideos.metaDescription] as string[];
      for (const text of texts) {
        expect(text, `${locale}: ${text}`).toContain("{count");
        const out = String(new IntlMessageFormat(text, locale).format({ count: n, siteName: "JumpingBallsLive" }));
        expect(out).toContain(String(n));
        expect(out).not.toContain("{");
      }
    }
    // Polish: the feature line takes the right plural form for any count.
    const featuresPl = (n: number) => String(new IntlMessageFormat(pl.Layout.featuresModes, "pl").format({ count: n }));
    expect(featuresPl(30)).toBe("30 trybów symulacji");
    expect(featuresPl(32)).toBe("32 tryby symulacji");
  });
});

describe("no hard-coded English in localised UI", () => {
  it("has the mode-card alt text, the footer landmark label and the upload fallbacks in every language", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      const m = messages as unknown as Record<string, Record<string, string>>;
      const alt = String(new IntlMessageFormat(m.Modes.previewAlt, locale).format({ name: "X" }));
      expect(alt).toContain("X");
      expect(m.Footer.navLabel).toBeTruthy();
      expect(m.Controls.uploadedMidi).toBeTruthy();
      expect(m.Controls.customWallBreak).toBeTruthy();
      expect(String(new IntlMessageFormat(m.Controls.obstacleXOf, locale).format({ n: 2 }))).toContain("2");
      expect(String(new IntlMessageFormat(m.Controls.obstacleYOf, locale).format({ n: 2 }))).toContain("2");
      if (locale !== "en") expect(alt).not.toContain("mode preview");
    }
  });
});
