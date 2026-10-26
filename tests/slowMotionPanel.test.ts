import { describe, expect, it } from "vitest";
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
 * --- slow-motion --- (plan step 9) The Slow motion switch in the panel: the second row of the block at the top of Ball &
 * Physics (data-testid slow-motion-toggle), found by the search box and the command palette on its own card, and the notes of
 * the controls it overrides while it is off (the Camera's near-miss slow motion and its sliders, the replay's speed, Fight
 * League's KO Slow Motion, Bullseye, the String Battle duel). With it on, the default, none of them shows anything new.
 */

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

const controls = en.Controls as Record<string, string>;
const t = ((key: string, values?: Record<string, unknown>) => String(new IntlMessageFormat(controls[key] ?? key, "en").format(values as Record<string, string>))) as unknown as Translate;
const render = (child: React.ReactElement) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, child));
/** The panel's matcher (Controls.tsx): a key or its Controls label containing the query. */
const matcherOf = (search: string) => (key: string) => !search || key.toLowerCase().includes(search.toLowerCase()) || (controls[key] ?? "").toLowerCase().includes(search.toLowerCase());
const props = (s: SimulatorSettings, search = "") => ({ t, search, matches: matcherOf(search), settings: s, update: () => {} });
const settingsOf = (mode: ModeId, patch: Partial<SimulatorSettings> = {}): SimulatorSettings => ({ ...defaultSettings(mode), ...patch });
const section = (component: unknown, s: SimulatorSettings, search = "") => render(createElement(component as React.FC<ReturnType<typeof props>>, props(s, search)));

describe("the Slow motion switch in Ball & Physics (--- slow-motion ---)", () => {
  it("is the block's second row: ON by default, OFF with smo=0, next to Wide sliders", () => {
    const on = section(UnlimitedSection, settingsOf("classic"));
    expect(on).toContain('data-testid="unlimited-section"');
    expect(on).toMatch(/aria-pressed="true" data-testid="slow-motion-toggle"[^>]*>ON</);
    expect(on).toContain("Slow motion");
    expect(on.indexOf('data-testid="unlimited-toggle"')).toBeLessThan(on.indexOf('data-testid="slow-motion-toggle"'));
    const off = section(UnlimitedSection, settingsOf("classic", { slowMotion: false }));
    expect(off).toMatch(/aria-pressed="false" data-testid="slow-motion-toggle"[^>]*>OFF</);
    // Wide sliders keeps its own state
    expect(off).toMatch(/aria-pressed="true" data-testid="unlimited-toggle"/);
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
