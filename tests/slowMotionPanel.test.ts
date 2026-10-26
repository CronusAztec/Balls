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
import { paletteKeyGroups, sectionDefaults } from "@/components/simulator/Controls";
import type { PanelShown } from "@/components/simulator/panelKeys";
import { defaultSettings, presetToSettings, settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder"; // --- review fix --- (the tooltip's exceptions, in the code)
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { RealTimeClock, STEP_MS, type RealTimeStepper } from "@/lib/simulation/realTime";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- slow-motion --- (plan step 9) The Slow motion switch in the panel: the next item at the top of Ball & Physics, on its
 * own neutral card under the Wide sliders box (data-testid slow-motion-toggle), found by the search box and the command
 * palette on its own card, and the notes of the controls it overrides while it is off (the Camera's near-miss slow motion and
 * its sliders, the replay's speed, Fight League's KO Slow Motion, Bullseye, the String Battle duel). With it on, the default,
 * none of them shows anything new. (review fixes) The overridden controls dim their own label (ink-3, AA contrast) and their
 * track or switch graphic, never the tooltip's ancestors, and name their note through aria-describedby. A control that stays
 * live (the String Battle duel: its hunt and heartbeat stay) is never dimmed: it has its note alone.
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

  it("the tooltip promises only what holds with it off: the moments and the replay at normal speed, a heavy run slowed only by a device that cannot keep up, a Time scale rule still on (--- review fix ---)", () => {
    // (it said every run plays in real time and a heavy run skips frames instead of slowing down: 50,000 balls played at 1 to
    // 4 % of real time with the switch off, and a Bounce math Time scale rule still scales the run's clock)
    const FALSE_CLAIMS: Record<"en" | "pl" | "es", RegExp[]> = {
      en: [/every run plays in real time/i, /instead of slowing/i],
      pl: [/każdy przebieg gra w czasie rzeczywistym/i, /zamiast zwalniać/i],
      es: [/cada partida va en tiempo real/i, /en vez de frenar/i],
    };
    for (const [locale, catalog, budget] of [["en", en, 300], ["pl", pl, 380], ["es", es, 380]] as const) {
      const tip = (catalog.Unlimited as Record<string, string>).slowMotionTip;
      const c = catalog.Controls as Record<string, string>;
      const timeScale = (catalog.BounceMath as unknown as { param: Record<string, string> }).param.timeScale;
      // the documented exception names the controls as the panel names them, within the tooltip budgets
      expect([locale, tip.includes(c.bounceMath), tip.includes(timeScale), tip.includes(c.cameraGroup), tip.length <= budget]).toEqual([locale, true, true, true, true]);
      for (const claim of FALSE_CLAIMS[locale]) expect([locale, String(claim), claim.test(tip)]).toEqual([locale, String(claim), false]);
      // docs/COPY-STYLE.md: no parentheses, dashes or semicolons in a string this long
      expect([locale, /[();—]|\s–\s/.test(tip)]).toEqual([locale, false]);
    }
    // what the exceptions are in the code: with the switch off a Time scale rule of 0.3 still plays a second of steps as 0.3 s,
    // and the step pays the page's real-time clock in full (its time scale is not slow motion's), so the run plays at 0.3x
    const rule = { param: "timeScale", trigger: "start", every: 1, op: "set", amount: 0.3, scope: "ball" };
    const s = presetToSettings({ ...defaultSettings("classic"), slowMotion: false, bounceMath: [rule] } as unknown as SimulatorSettings);
    expect([s.slowMotion, s.bounceMath.length]).toEqual([false, 1]);
    const engine = createEngineForSettings(physicsConfigOfSettings(s), "classic", modeSettingsOfSettings(s), 7);
    for (let i = 0; i < 60; i++) engine.update(1000 / 60, 0);
    expect(engine.getElapsedMs()).toBeCloseTo(300, 3);
    expect(engine.getStepTimeScale()).toBe(1);
    // and a device that cannot keep up: a run that keeps up loses nothing, one whose steps cost 40 ms each falls behind, and
    // the clock counts what it lost (the real-time badge shows it)
    const lostOver = (stepCpuMs: number) => {
      let now = 0;
      const stepper: RealTimeStepper = { step: () => ((now += stepCpuMs), 1), now: () => now };
      const clock = new RealTimeClock();
      for (let i = 0; i <= 60; i++) {
        now = Math.max(now, i * STEP_MS);
        clock.tick(now, { running: true, simSpeed: 1, drawDue: true }, stepper);
      }
      return clock.lostMs;
    };
    expect(lostOver(0.5)).toBe(0);
    expect(lostOver(40)).toBeGreaterThan(0);
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
    // the camera keeps the generic note (--- review fix --- the duel has its own: its cuts, see below)
    const camera = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false }));
    expect(elementWith(camera, 'data-testid="camera-slow-motion-off"')).toContain(en.Unlimited.slowMotionOffNote.replace(/&/g, "&amp;"));
    const duel = section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true, slowMotion: false }));
    expect(elementWith(duel, 'data-testid="sb-slow-motion-off"')).toContain(en.Unlimited.duelOffNote.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
  });
});

describe("overridden controls stay readable and say why (--- slow-motion --- review fixes)", () => {
  // (--- review fix --- the String Battle duel is no overridden control: it stays live, see "a live control keeps its look")
  const overridden = () => ({
    camera: section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false })),
    fl: section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true, slowMotion: false })),
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
    const { camera, fl } = overridden();
    for (const [name, html, label] of [["camera", camera, "Slow-Mo on Near Miss"], ["fl", fl, "KO Slow Motion"]] as const) {
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
    const { camera, fl } = overridden();
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
    // the sliders shown by a search with the near-miss toggle hidden name no note that is not there: (--- review fix ---) they
    // show their own, and name it
    const searched = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false }), "slow-mo speed");
    expect(searched).not.toContain("camera-slow-motion-off");
    expect(describedByNote(searched, 'aria-label="Slow-Mo Speed"', "camera-slow-mo-sliders-off")).toBe(true);
    // a default page: no description, no dimming
    for (const html of [section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true })), section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true })), section(StringBattleSection, settingsOf("stringBattle", { sbDuel: true }))]) {
      expect(html).not.toContain("aria-describedby");
      expect(html).not.toContain("data-overridden-track");
    }
  });
});

describe("a live control keeps its look, with a note only (--- slow-motion --- review fix)", () => {
  /** The markup without the slow-motion notes (the element of each `data-slow-motion-off-note`). */
  const withoutNotes = (html: string) => {
    let out = html;
    for (let at = out.indexOf("data-slow-motion-off-note"); at >= 0; at = out.indexOf("data-slow-motion-off-note")) out = out.replace(elementAt(out, out.lastIndexOf("<", at)), "");
    return out;
  };

  it("String Battle's Final Duel: drawn as with the switch on, not dimmed and described by nothing, the duel's own note under it, in every locale", () => {
    // (it was dimmed as overridden, which says the control does nothing now: the duel's hunt and heartbeat stay, only its cuts' slow motion goes)
    for (const [locale, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const u = catalog.Unlimited as Record<string, string>;
      const html = (s: SimulatorSettings) => render(createElement(StringBattleSection as unknown as React.FC<ReturnType<typeof props>>, props(s)), locale, catalog);
      const off = html(settingsOf("stringBattle", { sbDuel: true, slowMotion: false }));
      const on = html(settingsOf("stringBattle", { sbDuel: true }));
      expect([locale, off.includes("data-slow-motion-overridden"), off.includes("data-overridden-track"), off.includes("aria-describedby")]).toEqual([locale, false, false, false]);
      expect([locale, withoutNotes(off) === on]).toEqual([locale, true]);
      const note = elementWith(off, 'data-testid="sb-slow-motion-off"');
      expect([locale, note.includes(u.duelOffNote.replace(/&/g, "&amp;").replace(/'/g, "&#x27;")), note.includes(u.slowMotionOffNote.replace(/&/g, "&amp;"))]).toEqual([locale, true, false]);
      // right under the switch, which stays a live switch (on, not disabled)
      const duelSwitch = switchNamed(off, "Final Duel");
      expect([locale, duelSwitch?.checked]).toEqual([locale, "true"]);
      expect(off.indexOf('data-testid="sb-slow-motion-off"')).toBeGreaterThan(off.indexOf("Final Duel"));
      expect(openingTag(off, 'aria-checked="true"')).not.toContain("disabled");
      // the duel off: nothing to say
      expect([locale, html(settingsOf("stringBattle", { sbDuel: false, slowMotion: false })).includes("sb-slow-motion-off")]).toEqual([locale, false]);
      // the note names the duel's cuts, not the duel: the control is not "this plays in real time"
      expect([locale, u.duelOffNote.length <= 160, u.duelOffNote !== u.slowMotionOffNote]).toEqual([locale, true, true]);
    }
  });

  it("the duel switch takes effect with Slow motion off: on, the last two balls hunt each other; off, they never do", () => {
    const run = (sbDuel: boolean) => {
      const s = settingsOf("stringBattle", { sbDuel, slowMotion: false });
      const engine = createEngineForSettings(physicsConfigOfSettings(s), "stringBattle", modeSettingsOfSettings(s), 3);
      for (let ms = 0; ms < 240_000 && !engine.isSimulationFinished(); ms += STEP_MS) {
        engine.update(STEP_MS, 0);
        engine.consumeSoundEvents();
      }
      const v = engine.getStringBattleView();
      return { finished: engine.isSimulationFinished(), duel: v.duel, hunted: v.homings > 0 };
    };
    expect(run(true)).toEqual({ finished: true, duel: true, hunted: true });
    expect(run(false)).toEqual({ finished: true, duel: false, hunted: false });
  });
});

describe("every dimmed control has its note on screen (--- slow-motion --- review fix)", () => {
  /**
   * The overridden blocks of `html` that break the rule: a block with no control in it, or a control (a switch, a range
   * input, a number field) that names no note, or names an id whose element holds none. One line each.
   */
  const brokenBlocks = (html: string) => {
    const out: string[] = [];
    for (let at = html.indexOf("data-slow-motion-overridden"); at >= 0; at = html.indexOf("data-slow-motion-overridden", at + 1)) {
      const block = elementAt(html, html.lastIndexOf("<", at));
      const controls = [...block.matchAll(/<(?:button|input)[^>]*>/g)].map((m) => m[0]).filter((tag) => /role="switch"|<input/.test(tag));
      if (controls.length === 0) out.push("a dimmed block with no control in it");
      for (const tag of controls) {
        const ids = describedByOf(tag);
        const named = ids.length > 0 && ids.every((id) => elementWith(html, `id="${id}"`).includes("data-slow-motion-off-note"));
        if (!named) out.push(`no note named by ${tag.slice(0, 80)}`);
      }
    }
    return out;
  };
  /** The notes of `html` that speak for nothing on screen (the replay's, a live control's, stands on its own and is left out). */
  const strayNotes = (html: string) => {
    const named = new Set([...html.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((m) => m[1].split(" ")));
    const out: string[] = [];
    for (let at = html.indexOf("data-slow-motion-off-note"); at >= 0; at = html.indexOf("data-slow-motion-off-note", at + 1)) {
      const tag = html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
      if (/data-testid="camera-replay-real-time"/.test(tag)) continue;
      const before = html.slice(0, html.lastIndexOf("<", at));
      const owner = /<div id="([^"]+)">$/.exec(before)?.[1];
      if (!owner || !named.has(owner)) out.push(tag);
    }
    return out;
  };

  it("Camera, searched or not: every overridden block holds a note or names one, and no note stands alone (the near-miss slow motion on or off)", () => {
    // (a search for "slow" with the near-miss slow motion off showed the speed and length sliders dimmed with no note at all)
    for (const search of ["", "slow", "slow-mo", "slow-mo speed", "length", "near miss", "zoom", "replay"]) {
      for (const slowMoOnNearMiss of [true, false]) {
        const html = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss, replayOnEscape: true, slowMotion: false }), search);
        const label = `${JSON.stringify(search)} near miss ${slowMoOnNearMiss ? "on" : "off"}`;
        expect([label, brokenBlocks(html)]).toEqual([label, []]);
        expect([label, strayNotes(html)]).toEqual([label, []]);
      }
    }
    // the finding's own search: "slow" with the near-miss slow motion off shows the sliders dimmed, with their note
    const slow = section(CameraSection, settingsOf("classic", { slowMotion: false }), "slow");
    expect(slow.match(/data-slow-motion-overridden/g)?.length).toBe(1);
    expect(slow).toContain('data-testid="camera-slow-mo-sliders-off"');
    expect(slow).toContain(en.Unlimited.slowMotionOffNote.replace(/&/g, "&amp;"));
    // the near-miss note shown: the sliders name it and add none of their own
    const nearMiss = section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false }), "slow");
    expect([nearMiss.includes('data-testid="camera-slow-motion-off"'), nearMiss.includes("camera-slow-mo-sliders-off")]).toEqual([true, false]);
    // a search for neither slider leaves no dimmed block behind
    expect(section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true, slowMotion: false }), "zoom")).not.toContain("data-slow-motion-overridden");
    // and with the switch on, nothing of it
    for (const search of ["", "slow"]) expect(section(CameraSection, settingsOf("classic", { slowMoOnNearMiss: true }), search)).not.toContain("data-slow-motion-off-note");
  });

  it("the other overridden controls hold their notes too: Fight League's KO Slow Motion, searched or not", () => {
    for (const search of ["", "slow", "ko"]) {
      const html = section(FightLeagueSection, settingsOf("fightLeague", { flSlowMo: true, slowMotion: false }), search);
      expect([search, brokenBlocks(html), strayNotes(html)]).toEqual([search, [], []]);
    }
  });
});

describe("Reset Category in Ball & Physics brings back the block at its top (--- slow-motion --- review fix)", () => {
  it("restores Wide sliders, Slow motion and Full-Physics Balls with the rest of the section: the link loses inf, smo and fbl", () => {
    // (it reset Ball Speed but left Slow motion off and Full-Physics Balls as typed: ?mode=classic&fbl=500&smo=0 stayed)
    const before = settingsFromSearchParams(new URLSearchParams("mode=classic&smo=0&inf=0&fbl=500&s=250"));
    expect([before.slowMotion, before.unlimited, before.fullBallLimit, before.ballSpeed]).toEqual([false, false, 500, 250]);
    const after: SimulatorSettings = { ...before, ...sectionDefaults("ball", "classic") };
    const link = settingsToSearchParams(after);
    expect([link.get("smo"), link.get("inf"), link.get("fbl"), link.get("s")]).toEqual([null, null, null, null]);
    expect(link.toString()).toBe(settingsToSearchParams(defaultSettings("classic")).toString());
    // both switches read ON again, as a screen reader hears them
    const html = section(UnlimitedSection, after);
    expect([switchNamed(html, "Slow motion")?.checked, switchNamed(html, "Wide sliders")?.checked]).toEqual(["true", "true"]);
  });

  it("covers every key of the block, at its default, in every mode (UNLIMITED_KEYS)", () => {
    for (const mode of ["classic", "bullseye", "fightLeague", "stringBattle", "multipliers", "blueprint"] as ModeId[]) {
      const reset = sectionDefaults("ball", mode) as Record<string, unknown>;
      const d = defaultSettings(mode) as unknown as Record<string, unknown>;
      for (const key of UNLIMITED_KEYS) expect([mode, key, key in reset, reset[key]]).toEqual([mode, key, true, d[key]]);
    }
    // (on is today's behaviour: the reset brings back what a link without smo plays)
    expect([defaultSettings("classic").slowMotion, defaultSettings("classic").unlimited]).toEqual([true, true]);
  });
});
