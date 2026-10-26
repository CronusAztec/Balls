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
import { RespawnControl, SwarmLimitControl, showsRespawn, showsSwarmLimit } from "@/components/simulator/sections/ConveyorSection";
import CollisionPlaygroundSection from "@/components/simulator/sections/CollisionPlaygroundSection";
import { paletteKeyGroups } from "@/components/simulator/Controls";
import { sectionKeyShown, type PanelShown } from "@/components/simulator/panelKeys";
import { BOUNCE_MATH_SPAWN_MODES } from "@/lib/physics/bounceMathRuntime";
import { RESPAWN_MODES } from "@/lib/physics/respawn";
import { RING_MAX_BODIES, collideBodyCount, collideSettingsOf, resolveCollideSettings } from "@/lib/physics/modes/collide";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { modeSettingsOfSettings, physicsConfigOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings, presetToSettings, type SimulatorSettings } from "@/lib/settings";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";

/*
 * --- unlimited-sizes --- (review round 1) The growth-cap settings in the panel (plan step 16): the Swarm Limit shows in
 * every mode it stops new balls in, not only beside the respawn timer; Collision Playground's Orbs readout follows Bodies on
 * the Ring ("100 on the ring", "10 on the ring") the way the run builds it; and the Bracket Size tip points at the Bout Time
 * Cap instead of the old fixed 45 s, in en, pl and es.
 */

// The components are compiled with the classic JSX transform here (tsconfig keeps JSX for Next): React must be global.
(globalThis as { React?: unknown }).React = React;

const controls = en.Controls as Record<string, string>;
const t = ((key: string, values?: Record<string, unknown>) => String(new IntlMessageFormat(controls[key] ?? key, "en").format(values as Record<string, string>))) as unknown as Translate;
const render = (child: React.ReactElement) => renderToStaticMarkup(createElement(NextIntlClientProvider, { locale: "en", messages: en, timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>, child));
const props = (s: SimulatorSettings) => ({ t, search: "", matches: () => true, settings: s, update: () => {} });
const section = (component: unknown, s: SimulatorSettings) => render(createElement(component as React.FC<ReturnType<typeof props>>, props(s)));
const PANEL: Omit<PanelShown, "mode"> = { ballPicture: false, showTrails: true, glassGates: false, wobblyWalls: false, simulationFound: false, bannerText: false, arenas: false, teams: false, captions: false, videoBackground: false, videoBeats: false, batch: false, bot: false };
const STEP = 1000 / 60;

describe("the Swarm Limit in the panel: wherever the swarm's ceiling stops new balls", () => {
  it("shows in Classic, Multiply and every mode bounce math's balls rules copy balls in, and nowhere else", () => {
    const spawning = new Set<ModeId>([...RESPAWN_MODES, ...BOUNCE_MATH_SPAWN_MODES]);
    expect(spawning.size).toBe(10);
    for (const mode of MODE_IDS) {
      const shown = spawning.has(mode);
      expect([mode, showsSwarmLimit(mode)]).toEqual([mode, shown]);
      const html = section(SwarmLimitControl, defaultSettings(mode));
      expect([mode, html.includes('data-testid="swarm-limit"'), html.includes('aria-label="Swarm Limit"')]).toEqual([mode, shown, shown]);
      // the search box and the command palette offer it exactly where the panel shows it
      expect([mode, sectionKeyShown("swarmLimit", { ...PANEL, mode }, false)]).toEqual([mode, shown]);
      const ball = paletteKeyGroups({ ...PANEL, mode }, ["ball"], false).find((g) => g.section === "ball");
      expect([mode, ball?.keys.includes("swarmLimit") ?? false]).toEqual([mode, shown]);
    }
    // the respawn timer itself stays in Classic and Multiply only, and no longer carries the Swarm Limit
    for (const mode of ["lines", "target", "accumulation"] as const) {
      expect([mode, showsRespawn(mode), section(RespawnControl, defaultSettings(mode))]).toEqual([mode, false, ""]);
      expect(section(SwarmLimitControl, { ...defaultSettings(mode), swarmLimit: 50 })).toMatch(/aria-label="Swarm Limit"[^>]*/);
    }
    expect(section(RespawnControl, defaultSettings("classic"))).not.toContain('aria-label="Swarm Limit"');
  });

  it("is the ceiling a balls rule stops at in Lines, Target and Accumulation, which the control now reaches", () => {
    const rule = { param: "balls", trigger: "bounce", every: 1, op: "multiply", amount: 2, scope: "ball" };
    for (const mode of ["lines", "target", "accumulation"] as const) {
      const s = presetToSettings({ ...defaultSettings(mode), swarmLimit: 40, bounceMath: [rule] } as unknown as SimulatorSettings);
      expect([mode, s.swarmLimit]).toEqual([mode, 40]);
      const engine = createEngineForSettings(physicsConfigOfSettings(s), mode, modeSettingsOfSettings(s), 5);
      let most = 0;
      for (let i = 0; i < 600; i++) {
        engine.update(STEP, 0);
        engine.consumeSoundEvents();
        most = Math.max(most, engine.getBalls().length);
      }
      expect([mode, most]).toEqual([mode, 40]);
    }
  });
});

describe("Collision Playground's Orbs readout follows Bodies on the Ring", () => {
  const playground = (patch: Partial<SimulatorSettings>) => ({ ...defaultSettings("collide"), cpRing: true, ...patch });
  const readout = (patch: Partial<SimulatorSettings>) => {
    const html = section(CollisionPlaygroundSection, playground(patch));
    return /data-uncap-slider="cpCount"[\s\S]*?<span class="num[^"]*">([^<]*)<\/span>/.exec(html)?.[1] ?? html;
  };

  it("says how many bodies the ring plays: its own count, 36 by default, and the orbs when there are fewer", () => {
    expect(readout({ cpCount: 300, cpRingCount: 100 })).toBe("100 on the ring");
    expect(readout({ cpCount: 30, cpRingCount: 10 })).toBe("10 on the ring");
    expect(readout({ cpCount: 300, cpRingCount: RING_MAX_BODIES })).toBe(`${RING_MAX_BODIES} on the ring`);
    expect(readout({ cpCount: 30, cpRingCount: RING_MAX_BODIES })).toBe("30");
    expect(readout({ cpCount: 300, cpRingCount: 100, cpRing: false })).toBe("300");
  });

  it("is the number of bodies the run builds", () => {
    for (const [cpCount, cpRingCount] of [[300, 100], [30, 10], [300, RING_MAX_BODIES], [30, RING_MAX_BODIES]]) {
      const s = presetToSettings(playground({ cpCount, cpRingCount }));
      const engine = createEngineForSettings(physicsConfigOfSettings(s), "collide", modeSettingsOfSettings(s), 7);
      const bodies = collideBodyCount(resolveCollideSettings(collideSettingsOf(s)));
      expect([cpCount, cpRingCount, engine.getCollideView().count]).toEqual([cpCount, cpRingCount, bodies]);
      expect(bodies).toBe(Math.min(cpCount, cpRingCount));
    }
  });

  it("has an Orbs tip that points at Bodies on the Ring instead of a fixed 36, in every locale", () => {
    for (const [locale, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const c = catalog.Controls as Record<string, string>;
      expect([locale, c.cpCountTip.includes(c.cpRingCount)]).toEqual([locale, true]);
      expect([locale, /(at most|najwyżej|como mucho) 36/.test(c.cpCountTip)]).toEqual([locale, false]);
      expect([locale, c.cpCountTip.includes(";")]).toEqual([locale, false]);
    }
  });
});

describe("Fight League's Bracket Size tip names the Bout Time Cap", () => {
  it("points at the Bout Time Cap instead of the old fixed 45 s, in every locale", () => {
    for (const [locale, catalog] of [["en", en], ["pl", pl], ["es", es]] as const) {
      const c = catalog.Controls as Record<string, string>;
      expect([locale, c.flBracketSizeTip.includes("45")]).toEqual([locale, false]);
      expect([locale, c.flBracketSizeTip.includes(c.flBoutCap)]).toEqual([locale, true]);
    }
  });
});
