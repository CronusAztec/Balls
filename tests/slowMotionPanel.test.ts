import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import type { Translate } from "@/components/simulator/ControlPrimitives";
import UnlimitedSection, { UNLIMITED_KEYS } from "@/components/simulator/sections/UnlimitedSection";
import CameraSection from "@/components/simulator/sections/CameraSection";
import BullseyeSection from "@/components/simulator/sections/BullseyeSection";
import FightLeagueSection from "@/components/simulator/sections/FightLeagueSection";
import StringBattleSection from "@/components/simulator/sections/StringBattleSection";
import { paletteKeyGroups } from "@/components/simulator/Controls";
import type { PanelShown } from "@/components/simulator/panelKeys";
import { defaultSettings, type SimulatorSettings } from "@/lib/settings";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- slow-motion --- (plan step 9) The Slow motion switch in the panel: the next item at the top of Ball & Physics, on its
 * own neutral card under the Wide sliders box (data-testid slow-motion-toggle), found by the search box and the command
 * palette on its own card, and the notes of the controls it overrides while it is off (the Camera's near-miss slow motion and
 * its sliders, the replay's speed, Fight League's KO Slow Motion, Bullseye, the String Battle duel). With it on, the default,
 * none of them shows anything new. (review fixes) The overridden controls dim their own label (ink-3, AA contrast) and their
 * track or switch graphic, never the tooltip's ancestors, and name their note through aria-describedby.
 */

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

const controls = en.Controls as Record<string, string>;
const t = ((key: string, values?: Record<string, unknown>) => String(new IntlMessageFormat(controls[key] ?? key, "en").format(values as Record<string, string>))) as unknown as Translate;
const render = (child: React.ReactElement, locale = "en", messages: unknown = en) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale, messages, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, child));
const escapeRe = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/**
 * The switch named `name` in rendered markup, found the way a screen reader finds it: a role="switch" button whose
 * aria-labelledby points at an element with exactly that text. Its state (aria-checked), its test id, and its accessible
 * content (what is left once the aria-hidden ON / OFF word is taken out: nothing). Null when no switch has that name.
 */
const switchNamed = (html: string, name: string) => {
  const label = new RegExp(`<span id="([^"]+)">${escapeRe(name)}</span>`).exec(html);
  if (!label) return null;
  const button = new RegExp(`<button([^>]*)aria-labelledby="${escapeRe(label[1])}"([^>]*)>(.*?)</button>`).exec(html);
  if (!button) return null;
  const attrs = button[1] + button[2];
  if (!/role="switch"/.test(attrs)) return null;
  const shown = /<span aria-hidden="true">([^<]*)<\/span>/.exec(button[3])?.[1] ?? null;
  return { checked: /aria-checked="([a-z]+)"/.exec(attrs)?.[1] ?? null, testId: /data-testid="([^"]+)"/.exec(attrs)?.[1] ?? null, shown, spoken: button[3].replace(/<span aria-hidden="true">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, "") };
};
/** The panel's matcher (Controls.tsx): a key or its Controls label containing the query. */
const matcherOf = (search: string) => (key: string) => !search || key.toLowerCase().includes(search.toLowerCase()) || (controls[key] ?? "").toLowerCase().includes(search.toLowerCase());
const props = (s: SimulatorSettings, search = "") => ({ t, search, matches: matcherOf(search), settings: s, update: () => {} });
const settingsOf = (mode: ModeId, patch: Partial<SimulatorSettings> = {}): SimulatorSettings => ({ ...defaultSettings(mode), ...patch });
const section = (component: unknown, s: SimulatorSettings, search = "") => render(createElement(component as React.FC<ReturnType<typeof props>>, props(s, search)));

describe("the Slow motion switch in Ball & Physics (--- slow-motion ---)", () => {
  it("is the block's second row: ON by default, OFF with smo=0, next to Wide sliders", () => {
    const on = section(UnlimitedSection, settingsOf("classic"));
    expect(on).toContain('data-testid="unlimited-section"');
    // --- slow-motion --- (review fix) found by its role and name, as a screen reader finds it
    expect(switchNamed(on, "Slow motion")).toMatchObject({ checked: "true", testId: "slow-motion-toggle", shown: "ON" });
    expect(on).toContain("Slow motion");
    expect(on.indexOf('data-testid="unlimited-toggle"')).toBeLessThan(on.indexOf('data-testid="slow-motion-toggle"'));
    const off = section(UnlimitedSection, settingsOf("classic", { slowMotion: false }));
    expect(switchNamed(off, "Slow motion")).toMatchObject({ checked: "false", testId: "slow-motion-toggle", shown: "OFF" });
    // Wide sliders keeps its own state
    expect(switchNamed(off, "Wide sliders")).toMatchObject({ checked: "true", testId: "unlimited-toggle" });
  });

  it("names both switches by their labels in every locale: never by ON / OFF, the tooltip outside the name (--- slow-motion --- review fix)", () => {
    for (const [locale, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const u = catalog.Unlimited as Record<string, string>;
      for (const slowMotion of [true, false]) {
        const html = render(createElement(UnlimitedSection as unknown as React.FC<ReturnType<typeof props>>, props(settingsOf("classic", { slowMotion }))), locale, catalog);
        const slow = switchNamed(html, u.slowMotion);
        const wide = switchNamed(html, u.label);
        expect([locale, slow?.testId, slow?.checked, slow?.shown]).toEqual([locale, "slow-motion-toggle", String(slowMotion), slowMotion ? u.on : u.off]);
        expect([locale, wide?.testId, wide?.checked, wide?.shown]).toEqual([locale, "unlimited-toggle", "true", u.on]);
        // nothing of the button itself is read out but its name: the ON / OFF word is for the eye only
        expect([slow?.spoken, wide?.spoken]).toEqual(["", ""]);
        // the label is no <label> tied to nothing, and the ON / OFF words name no switch
        expect(html).not.toContain("<label");
        expect([switchNamed(html, u.on), switchNamed(html, u.off)]).toEqual([null, null]);
      }
    }
  });

  it("is found by the search box on its own card, and Wide sliders on its own", () => {
    const slow = section(UnlimitedSection, settingsOf("classic"), "slow motion");
    expect(slow).toContain('data-search-key="slowMotion"');
    expect(slow).toContain('data-testid="slow-motion-toggle"');
    expect(slow).not.toContain('data-testid="unlimited-toggle"');
    const wide = section(UnlimitedSection, settingsOf("classic"), "wide");
    expect(wide).toContain('data-search-key="unlimited"');
    expect(wide).not.toContain('data-testid="slow-motion-toggle"');
    expect(UNLIMITED_KEYS).toContain("slowMotion");
  });

  it("has a search and palette label in every locale, and the command palette offers it in Ball & Physics in every mode", () => {
    for (const catalog of [en, pl, es]) {
      const c = catalog.Controls as Record<string, string>;
      const u = catalog.Unlimited as Record<string, string>;
      expect(c.slowMotion).toBeTruthy();
      expect(u.slowMotion).toBe(c.slowMotion);
      for (const key of ["slowMotionTip", "slowMotionOffNote", "replayRealTime"]) expect(u[key], key).toBeTruthy();
    }
    const shown: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: false, batch: false, bot: false };
    for (const mode of ["classic", "bullseye", "fightLeague", "stringBattle", "blueprint"] as ModeId[]) {
      const ball = paletteKeyGroups({ ...shown, mode }, ["ball", "visual"], false).find((g) => g.section === "ball");
      expect(ball?.keys, mode).toContain("slowMotion");
    }
  });
});

describe("the controls the switch overrides say so while it is off (--- slow-motion ---)", () => {
  it("Camera: the near-miss slow motion and its sliders dimmed with a note, the replay at normal speed; nothing with it on", () => {
    const camera = { slowMoOnNearMiss: true, replayOnEscape: true };
    const on = section(CameraSection, settingsOf("classic", camera));
    expect(on).not.toContain("data-slow-motion-overridden");
    expect(on).not.toContain("data-slow-motion-off-note");
    const off = section(CameraSection, settingsOf("classic", { ...camera, slowMotion: false }));
    expect(off).toContain('data-testid="camera-slow-motion-off"');
    expect(off).toContain(en.Unlimited.slowMotionOffNote.replace(/&/g, "&amp;"));
    expect(off).toContain('data-testid="camera-replay-real-time"');
    expect(off.match(/data-slow-motion-overridden/g)?.length).toBe(2); // the toggle, and the speed and length sliders
    // (the values are untouched: the sliders still hold them, for when the switch is back on)
    expect(off).toContain('aria-label="Slow-Mo Speed"');
    // A near-miss slow motion that is off itself is not overridden: no note, only the replay's.
    const nearMissOff = section(CameraSection, settingsOf("classic", { slowMotion: false, replayOnEscape: false }));
    expect(nearMissOff).not.toContain("data-slow-motion-off-note");
  });

  it("Fight League's KO Slow Motion, Bullseye and the String Battle duel", () => {
    expect(section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true }))).not.toContain("fl-slow-motion-off");
    const fl = section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true, slowMotion: false }));
    expect(fl).toContain('data-testid="fl-slow-motion-off"');
    expect(section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: false, slowMotion: false }))).not.toContain("fl-slow-motion-off");
    expect(section(BullseyeSection, settingsOf("bullseye"))).not.toContain("bullseye-slow-motion-off");
    expect(section(BullseyeSection, settingsOf("bullseye", { slowMotion: false }))).toContain('data-testid="bullseye-slow-motion-off"');
    expect(section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true }))).not.toContain("sb-slow-motion-off");
    expect(section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true, slowMotion: false }))).toContain('data-testid="sb-slow-motion-off"');
  });
});

// --- slow-motion --- (review fixes) markup helpers: the element that starts at `index` (its own tag, nesting counted), and
// the element carrying an attribute
const elementAt = (html: string, index: number) => {
  const tag = /^<([a-z]+)/.exec(html.slice(index))?.[1];
  if (!tag) return "";
  const re = new RegExp(`<${tag}[\\s>]|</${tag}>`, "g");
  re.lastIndex = index;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(index, m.index + m[0].length);
  }
  return html.slice(index);
};
const elementWith = (html: string, attribute: string) => {
  const at = html.indexOf(attribute);
  return at < 0 ? "" : elementAt(html, html.lastIndexOf("<", at));
};
/** The opening tag of the element carrying `attribute`. */
const openingTag = (html: string, attribute: string) => {
  const at = html.indexOf(attribute);
  return at < 0 ? "" : html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";
const describedByOf = (tag: string) => /aria-describedby="([^"]*)"/.exec(tag)?.[1]?.split(" ") ?? [];
/**
 * Every element of `html` whose own class list dims it: a plain opacity of 1 to 99 (opacity-60; not hover:, disabled: or
 * group-hover/tip:, and not the tooltip bubble's own opacity-0, which is its hidden state and turns 100 on hover).
 */
const dimmedElements = (html: string) => [...html.matchAll(/<[a-z]+[^>]*class="(?:[^"]* )?opacity-[1-9]\d?(?: [^"]*)?"[^>]*>/g)].map((m) => elementAt(html, m.index ?? 0));
const TOOLTIP = "group/tip";

describe("the Slow motion row stands on its own card (--- slow-motion --- review fix)", () => {
  it("is the next item under the Wide sliders box, on the neutral card a search result stands on, whatever Wide sliders is", () => {
    const cards = new Set<string>();
    for (const unlimited of [true, false]) {
      for (const slowMotion of [true, false]) {
        const html = section(UnlimitedSection, settingsOf("classic", { unlimited, slowMotion }));
        const box = elementWith(html, 'data-testid="unlimited-section"');
        const card = elementWith(html, 'data-testid="slow-motion-card"');
        // the Wide sliders box holds its switch and its warning only
        expect(box).toContain('data-testid="unlimited-toggle"');
        expect(box).toContain(en.Unlimited.warning);
        expect(box).not.toContain("slow-motion");
        // the Slow motion card holds its switch, follows the box, and never takes the box's warn colours
        expect(switchNamed(card, "Slow motion")?.testId).toBe("slow-motion-toggle");
        expect(html.indexOf(card)).toBe(html.indexOf(box) + box.length);
        const cardClass = classOf(openingTag(html, 'data-testid="slow-motion-card"'));
        expect(cardClass).not.toMatch(/warn/);
        cards.add(cardClass);
      }
    }
    expect([...cards]).toEqual(["rounded-lg border border-line bg-surface-2/60 p-3"]);
    // the search view's card for it is the same card
    const searched = section(UnlimitedSection, settingsOf("classic"), "slow motion");
    expect(classOf(openingTag(searched, 'data-search-key="slowMotion"'))).toBe([...cards][0]);
  });
});

describe("the Slow motion tooltip and the KO note say what the switch does (--- slow-motion --- review fix)", () => {
  it("the tooltip sends the visitor to Camera for the near miss, which is off by default, within the tooltip budgets", () => {
    expect(defaultSettings("classic").slowMoOnNearMiss).toBe(false);
    for (const [locale, catalog, budget] of [["en", en, 300], ["pl", pl, 380], ["es", es, 380]] as const) {
      const tip = (catalog.Unlimited as Record<string, string>).slowMotionTip;
      const camera = (catalog.Controls as Record<string, string>).cameraGroup;
      expect([locale, tip.includes(camera), tip.length <= budget]).toEqual([locale, true, true]);
    }
    // (the old claim: "On: near misses, bullseyes and knockouts slow time down for a moment.")
    expect(en.Unlimited.slowMotionTip).not.toMatch(/^On: near misses/);
  });

  it("KO Slow Motion's note says the winner's card comes at once, in the words of the control's own tip, in every locale", () => {
    for (const [locale, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const u = catalog.Unlimited as Record<string, string>;
      const c = catalog.Controls as Record<string, string>;
      const html = render(createElement(FightLeagueSection as unknown as React.FC<ReturnType<typeof props>>, props(settingsOf("fightLeague", { flSlowMo: true, slowMotion: false }))), locale, catalog);
      const note = elementWith(html, 'data-testid="fl-slow-motion-off"');
      expect([locale, note.includes(u.koOffNote.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"))]).toEqual([locale, true]);
      expect(note).not.toContain(u.slowMotionOffNote.replace(/&/g, "&amp;"));
      // the tip's "Off: the card comes at once." and the note end on the same words
      const lastWords = (text: string) => text.split(" ").slice(-3).join(" ");
      expect([locale, lastWords(u.koOffNote)]).toEqual([locale, lastWords(c.flSlowMoTip)]);
    }
    // the camera and the duel keep the generic note
    const camera = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false }));
    expect(elementWith(camera, 'data-testid="camera-slow-motion-off"')).toContain(en.Unlimited.slowMotionOffNote.replace(/&/g, "&amp;"));
    const duel = section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true, slowMotion: false }));
    expect(elementWith(duel, 'data-testid="sb-slow-motion-off"')).toContain(en.Unlimited.slowMotionOffNote.replace(/&/g, "&amp;"));
  });
});

describe("overridden controls stay readable and say why (--- slow-motion --- review fixes)", () => {
  const overridden = () => ({
    camera: section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false })),
    fl: section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true, slowMotion: false })),
    duel: section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true, slowMotion: false })),
  });

  it("dims no ancestor of a tooltip: only the track or the switch graphic, which hold no tooltip", () => {
    for (const [name, html] of Object.entries(overridden())) {
      const blocks: string[] = [];
      for (let at = html.indexOf('data-slow-motion-overridden=""'); at >= 0; at = html.indexOf('data-slow-motion-overridden=""', at + 1)) blocks.push(elementAt(html, html.lastIndexOf("<", at)));
      expect([name, blocks.length > 0]).toEqual([name, true]);
      for (const block of blocks) {
        expect([name, block.includes(TOOLTIP)]).toEqual([name, true]); // (the overridden controls do have tooltips)
        expect(classOf(block.slice(0, block.indexOf(">") + 1))).not.toMatch(/(^| )opacity-/);
        const dimmed = dimmedElements(block);
        expect([name, dimmed.length > 0]).toEqual([name, true]);
        for (const el of dimmed) {
          expect([name, el.includes(TOOLTIP)]).toEqual([name, false]);
          expect(el.slice(0, el.indexOf(">") + 1)).toContain("data-overridden-track");
        }
      }
    }
  });

  it("dims the labels to ink-3, which keeps 4.5:1 or more on every panel surface (the tokens of globals.css)", () => {
    const { camera, fl, duel } = overridden();
    for (const [name, html, label] of [["camera", camera, "Slow-Mo on Near Miss"], ["fl", fl, "KO Slow Motion"], ["duel", duel, "Final Duel"]] as const) {
      const labelSpan = new RegExp(`<span class="([^"]*)"><span id="[^"]+">${escapeRe(label)}</span>`).exec(html);
      expect([name, labelSpan?.[1]]).toEqual([name, "flex min-w-0 items-center text-sm font-medium text-ink-3"]);
    }
    expect(classOf(/<label[^>]*>(?:(?!<\/label>).)*Slow-Mo Speed/.exec(camera)?.[0] ?? "")).toContain("text-ink-3");
    // undimmed with the switch on: the labels as they always were
    const on = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true }));
    expect(on).not.toContain("text-ink-3\"><span id=");
    expect(on).not.toContain("data-overridden-track");
    const css = fs.readFileSync(path.join(__dirname, "..", "src", "app", "globals.css"), "utf8");
    const token = (name: string) => {
      const hex = new RegExp(`--color-${name}:\\s*#([0-9a-f]{6})`, "i").exec(css)?.[1];
      if (!hex) throw new Error(`no --color-${name}`);
      return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a: number[], b: number[]) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    for (const surface of ["bg", "surface-1", "surface-2", "surface-3"]) expect([surface, contrast(token("ink-3"), token(surface)) >= 4.5]).toEqual([surface, true]);
    // (opacity 0.6 on ink-2 over surface-1 was 3.6:1)
    const blend = (fg: number[], bg: number[], alpha: number) => fg.map((c, i) => alpha * c + (1 - alpha) * bg[i]);
    expect(contrast(blend(token("ink-2"), token("surface-1"), 0.6), token("surface-1"))).toBeLessThan(4.5);
  });

  it("names the note through aria-describedby on the switch, the slider's track and its number field; nothing with the switch on", () => {
    const { camera, fl, duel } = overridden();
    const describedByNote = (html: string, controlAttr: string, noteTestId: string) => {
      const ids = describedByOf(openingTag(html, controlAttr));
      return ids.length > 0 && ids.every((id) => elementWith(html, `id="${id}"`).includes(`data-testid="${noteTestId}"`));
    };
    const switchAttr = (html: string, name: string) => {
      const label = new RegExp(`<span id="([^"]+)">${escapeRe(name)}</span>`).exec(html);
      return `aria-labelledby="${label?.[1]}"`;
    };
    expect(describedByNote(camera, switchAttr(camera, "Slow-Mo on Near Miss"), "camera-slow-motion-off")).toBe(true);
    expect(describedByNote(camera, 'aria-label="Slow-Mo Speed"', "camera-slow-motion-off")).toBe(true);
    expect(describedByNote(camera, 'aria-label="Slow-Mo Length"', "camera-slow-motion-off")).toBe(true);
    expect(describedByNote(camera, 'data-number-field="slowMoFactor"', "camera-slow-motion-off")).toBe(true);
    expect(describedByNote(fl, switchAttr(fl, "KO Slow Motion"), "fl-slow-motion-off")).toBe(true);
    expect(describedByNote(duel, switchAttr(duel, "Final Duel"), "sb-slow-motion-off")).toBe(true);
    // the sliders shown by a search with the near-miss toggle hidden name no note that is not there
    const searched = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false }), "slow-mo speed");
    expect(searched).not.toContain("camera-slow-motion-off");
    expect(describedByOf(openingTag(searched, 'aria-label="Slow-Mo Speed"'))).toEqual([]);
    // a default page: no description, no dimming
    for (const html of [section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true })), section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true })), section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true }))]) {
      expect(html).not.toContain("aria-describedby");
      expect(html).not.toContain("data-overridden-track");
    }
  });
});
