import { describe, expect, it, vi } from "vitest";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { NumberFieldProps } from "@/components/simulator/NumberField";
import QueuePanel from "@/components/simulator/desktop/QueuePanel";
import { QUEUE_FPS_RANGE } from "@/lib/desktop/presets";
import { EMPTY_QUEUE } from "@/lib/desktop/renderQueue";
import { defaultSettings } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- insights --- (review fix) The render queue's frame-rate field (components/simulator/desktop/QueuePanel.tsx), as a
 * screen reader and the eye get it once a rate past 60 is typed: the add form has no slider, so 90 or 120 fps is a plain
 * choice, never tinted or called "past the slider's usual range", and the line under the field (a typed rate is added, from
 * 30 up) is the field's description. The panel is rendered on the server, as the desktop panel tests render theirs; the
 * field it renders is rendered again with the rate typed, since a server render cannot type.
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
const { default: RealNumberField } = await vi.importActual<typeof import("@/components/simulator/NumberField")>("@/components/simulator/NumberField");

type Messages = typeof en;
const LOCALES = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };
const withIntl = (node: React.ReactElement, locale: keyof typeof LOCALES) =>
  renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, node)).replace(/&#x27;/g, "'");
const attr = (html: string, name: string) => html.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1] ?? null;

/** The add form in `locale`: its markup and the props of its frame-rate field. */
function panel(locale: keyof typeof LOCALES) {
  fields.length = 0;
  const queue = { state: EMPTY_QUEUE, resumable: null, folder: "", cutting: null, lastError: null, add: () => 0, pendingCuts: () => [] } as unknown as React.ComponentProps<typeof QueuePanel>["queue"];
  const page = { settings: defaultSettings("classic"), busy: false, pageSeed: () => 1 } as unknown as React.ComponentProps<typeof QueuePanel>["page"];
  const html = withIntl(createElement(QueuePanel, { bridge: {} as React.ComponentProps<typeof QueuePanel>["bridge"], queue, page, folder: "", onFolder: () => {} }), locale);
  const props = fields.find((f) => f.settingKey === "queueFps");
  if (!props) throw new Error("no frame-rate field");
  return { html, props };
}

describe("the render queue's frame-rate field", () => {
  it("is described by the line under it, which says a typed rate from 30 up is added, in en, pl and es", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      const { html } = panel(locale);
      const field = /<input[^>]*data-number-field="queueFps"[^>]*>/.exec(html)?.[0] ?? "";
      const describedBy = attr(field, "aria-describedby");
      expect([locale, !!describedBy]).toEqual([locale, true]);
      const hint = new RegExp(`<p[^>]*\\sid="${describedBy!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([^<]*)</p>`).exec(html)?.[1];
      expect([locale, hint]).toEqual([locale, LOCALES[locale].Desktop.queueFpsTyped]);
    }
  });

  it("shows a typed 90 or 120 fps as a plain choice: no warn tint and no slider's range named, the arrows still 30 apart", () => {
    for (const locale of ["en", "pl", "es"] as const) {
      const { props } = panel(locale);
      expect([locale, props.range]).toEqual([locale, QUEUE_FPS_RANGE]); // (its arrow keys step 30, from 30 up)
      for (const typed of [90, 120, 59.94]) {
        const field = withIntl(createElement(RealNumberField, { ...props, value: typed }), locale);
        expect([locale, typed, attr(field, "value"), attr(field, "data-beyond"), attr(field, "title"), field.includes("text-warn")]).toEqual([locale, typed, String(typed), null, null, false]);
      }
      // the same field with a slider beside it would call 120 past the slider (the page's own export field does)
      const sliderField = withIntl(createElement(RealNumberField, { ...props, sliderless: false, value: 120 }), locale);
      expect([locale, attr(sliderField, "data-beyond"), sliderField.includes("text-warn")]).toEqual([locale, "1", true]);
    }
  });
});
