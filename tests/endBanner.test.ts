import fs from "fs";
import path from "path";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import {
  END_BANNER_BOTTOM,
  END_BANNER_HOLD_MS,
  END_BANNER_IN_MS,
  END_BANNER_MIN_CONTRAST,
  END_BANNER_PLATE,
  END_BANNER_SUB_COLOR,
  END_BANNER_TOP,
  EndBannerLayer,
  accumulationBannerAt,
  contrast,
  drawEndBannerStrip,
  endBannerEntrance,
  endBannerPlateLuminance,
  endBannerSubLines,
  endBannerTitleColor,
  hexRgb,
  layoutEndBanner,
  luminance,
  placeEndBanner,
} from "@/components/simulator/endBanner";
import { BEAT_DROP_ON_TIME_MS, DEFAULT_BEAT_DROP_LABELS } from "@/components/simulator/beatDropRenderer";
import { FL_NOIR_TIMER_GAP, FL_NOIR_TITLE_W, flNoirTitleWidth } from "@/components/simulator/fightLeague/noir";
import { GLASS_LABEL_AT, drawGlassWorld, glassDots, glassLabelX, type GlassRenderOptions } from "@/components/simulator/glassRenderer";
import { MAZE_BANNER_FULL_MS, mazeBannerPhase, mazeStripPlace } from "@/components/simulator/mazeRenderer";
import { gateLabelHidden } from "@/components/simulator/multiplierRenderer";
import { PODIUM_REST_BOTTOM, PODIUM_REST_TOP, podiumRestRows } from "@/components/simulator/raceRenderer";
import { finderRequestOfSettings } from "@/lib/bot/finderRequest";
import { defaultSettings } from "@/lib/settings";
import { createEngineForSettings } from "@/lib/simulation/finder";
import { BADGE_HEIGHT, BADGE_INSET, badgeMetrics } from "@/lib/watermark/layout";
import { LiveHud, liveBadgeBox, placeLiveBadge, type LivePlacement } from "@/lib/watermark/liveLayout";
import { fakeCanvas, type FakeCall } from "./fakeCanvas";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- end-banner --- Every ending can be read: the modes' shared end banner (components/simulator/endBanner.ts) and the
 * endings that go through it or sit beside it.
 *  - the banner: a plate at full opacity whatever the pass around it uses, every colour the canvas gives it readable on the
 *    plate over any page, the line under it 20 px tall in a 540 px wide feed, long lines on two lines, a short entrance on
 *    the frames' clock;
 *  - the end lines count in all three languages (no "teleport(s)"), and Beat Drop says its result in words;
 *  - the maze's banner makes room for the race once it has been read, the race's list under the podium stays above the
 *    watermark badge, Fight League's title stays clear of the match clock in a 9:16 export, Glass Smash's stage label is not
 *    at the wall where the badge sits.
 */

const canvasSource = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Canvas.tsx"), "utf8");

/** The colour of every bigBanner() call in Canvas.tsx (literals, both arms of a `cond ? "#a" : "#b"`). */
function bannerColours(): string[] {
  const colours = new Set<string>();
  for (const line of canvasSource.split("\n")) {
    if (!/\bbigBanner\(/.test(line) || /const bigBanner/.test(line)) continue;
    for (const m of line.matchAll(/"(#[0-9a-fA-F]{3,6})"/g)) colours.add(m[1]);
  }
  return [...colours];
}

const texts = (calls: FakeCall[]) => calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));

describe("the end banner's plate and colours", () => {
  it("covers every banner the canvas draws: a call per ending, each through the shared layer", () => {
    const calls = canvasSource.split("\n").filter((l) => /\bbigBanner\(/.test(l) && !/const bigBanner/.test(l));
    expect(calls.length).toBeGreaterThanOrEqual(24);
    // the old helper that drew a second look is gone, and the one drawing routine is the layer's
    expect(canvasSource).not.toMatch(/\bfitBanner\(/);
    expect(canvasSource).toMatch(/layer\.draw\(ctx, words, cx, y \+ lay\.height \/ 2, minDim, bannerDt\)/);
    expect(bannerColours().length).toBeGreaterThanOrEqual(8);
  });

  it("keeps every mode's colour readable on the plate, even over a white page", () => {
    for (const colour of bannerColours()) {
      const plate = endBannerPlateLuminance(colour);
      const title = endBannerTitleColor(colour);
      const rgb = hexRgb(title) ?? (/rgb\((\d+), (\d+), (\d+)\)/.exec(title)?.slice(1).map(Number) as [number, number, number]);
      expect(rgb, colour).toBeTruthy();
      expect(contrast(luminance(rgb[0], rgb[1], rgb[2]), plate), colour).toBeGreaterThanOrEqual(END_BANNER_MIN_CONTRAST);
      const sub = hexRgb(END_BANNER_SUB_COLOR)!;
      expect(contrast(luminance(sub[0], sub[1], sub[2]), plate), colour).toBeGreaterThanOrEqual(7);
    }
  });

  it("leaves a colour that already reads alone and only lightens the dark ones, towards white", () => {
    expect(endBannerTitleColor("#a3e635")).toBe("#a3e635");
    expect(endBannerTitleColor("#f8fafc")).toBe("#f8fafc");
    expect(endBannerTitleColor("#4ECDC4")).toBe("#4ECDC4");
    const purple = endBannerTitleColor("#6c5ce7");
    expect(purple).not.toBe("#6c5ce7");
    const [r, g, b] = /rgb\((\d+), (\d+), (\d+)\)/.exec(purple)!.slice(1).map(Number);
    // still the same purple: every channel moved up, blue stays the strongest
    expect(r).toBeGreaterThan(0x6c);
    expect(g).toBeGreaterThan(0x5c);
    expect(b).toBeGreaterThanOrEqual(0xe7);
    expect(b).toBeGreaterThan(r);
    // a colour that is no hex colour is used as it is
    expect(endBannerTitleColor("hsl(120, 80%, 60%)")).toBe("hsl(120, 80%, 60%)");
  });
});

describe("the end banner's layout", () => {
  const ctx = () => fakeCanvas(1080, 1080).ctx as unknown as CanvasRenderingContext2D;

  it("sets the title at 8 % of the square and the line under it at 4.2 %: 43 px and 22 px in a 540 px wide feed", () => {
    const lay = layoutEndBanner(ctx(), { title: "IN LINE!", sub: "All 15 pendulums back", color: "#a3e635" }, 1080);
    expect(lay.titleFs).toBeCloseTo(86.4, 1);
    expect(lay.subFs).toBeCloseTo(45.36, 1);
    expect(lay.subFs / 2).toBeGreaterThanOrEqual(20); // a 1080 px square shown 540 px wide
    expect(lay.subLines).toEqual(["All 15 pendulums back"]);
    expect(lay.width).toBeLessThanOrEqual(0.96 * 1080);
    expect(lay.height).toBeLessThan(0.3 * 1080);
    // the title's line is above the sub's, both inside the plate
    expect(lay.titleY).toBeGreaterThan(0);
    expect(lay.subY[0]).toBeGreaterThan(lay.titleY + lay.titleFs / 2);
    expect(lay.subY[0] + lay.subFs / 2).toBeLessThan(lay.height);
  });

  it("puts a long line on the two most even lines before it shrinks anything", () => {
    const g = ctx();
    const sub = "All 15 pendulums back in phase after 1 cycle";
    const lay = layoutEndBanner(g, { title: "IN LINE!", sub, color: "#a3e635" }, 1080);
    expect(lay.subLines.length).toBe(2);
    expect(lay.subLines.join(" ")).toBe(sub);
    expect(lay.subFs).toBeCloseTo(45.36, 1);
    expect(Math.abs(lay.subLines[0].length - lay.subLines[1].length)).toBeLessThanOrEqual(8);
    // a status line splits at its middle dot, whole parts on each line
    const parts = endBannerSubLines(g, "67 clones along the way · 12 lost on the board", "600 45px sans-serif", 600);
    expect(parts).toEqual(["67 clones along the way", "12 lost on the board"]);
    // a short one stays on one line, an empty one draws none
    expect(endBannerSubLines(g, "x11 in 30.8s", "600 45px sans-serif", 600)).toEqual(["x11 in 30.8s"]);
    expect(endBannerSubLines(g, "", "600 45px sans-serif", 600)).toEqual([]);
  });

  it("fits a long title and a line of one long word to 84 % of the square", () => {
    const g = ctx();
    const lay = layoutEndBanner(g, { title: "1234 Gerald the Unstoppable made it home", sub: "x".repeat(120), color: "#a3e635" }, 1080);
    expect(lay.titleFs).toBeLessThan(86.4);
    g.font = `800 ${lay.titleFs}px sans-serif`;
    expect(g.measureText("1234 Gerald the Unstoppable made it home").width).toBeLessThanOrEqual(0.84 * 1080 + 1e-6);
    expect(lay.subLines).toEqual(["x".repeat(120)]);
    g.font = `600 ${lay.subFs}px sans-serif`;
    expect(g.measureText("x".repeat(120)).width).toBeLessThanOrEqual(0.84 * 1080 + 1e-6);
    expect(lay.width).toBeLessThanOrEqual(0.96 * 1080);
  });

  it("keeps a readable size on a small canvas and gives a third line its own row", () => {
    const small = layoutEndBanner(ctx(), { title: "HOME!", sub: "8 stages in 36.7s", color: "#a3e635" }, 200);
    expect(small.titleFs).toBe(24);
    expect(small.subFs).toBe(13);
    const noted = layoutEndBanner(ctx(), { title: "AQUA ESCAPED", sub: "in 33.9s", note: "who else thought that was blood", color: "#22d3ee" }, 1080);
    expect(noted.noteY).toBeGreaterThan(noted.subY[0] + noted.subFs / 2);
    expect(noted.noteY + noted.noteFs / 2).toBeLessThan(noted.height);
    const plain = layoutEndBanner(ctx(), { title: "AQUA ESCAPED", sub: "in 33.9s", color: "#22d3ee" }, 1080);
    expect(noted.height).toBeGreaterThan(plain.height);
  });
});

describe("the end banner's entrance", () => {
  it("is short, starts well visible and settles at exactly full size and full opacity", () => {
    // a mode whose banner comes with its last step has it in a recording for the recorder's last 0.5 s only
    expect(END_BANNER_IN_MS).toBeLessThanOrEqual(250);
    const first = endBannerEntrance(0);
    expect(first.alpha).toBeGreaterThanOrEqual(0.45);
    expect(first.scale).toBeCloseTo(0.8, 6);
    let lastAlpha = 0;
    let peak = 0;
    for (let ms = 0; ms <= END_BANNER_IN_MS; ms += 1000 / 60) {
      const p = endBannerEntrance(ms);
      expect(p.alpha).toBeGreaterThanOrEqual(lastAlpha);
      expect(p.scale).toBeGreaterThanOrEqual(0.8);
      expect(p.scale).toBeLessThanOrEqual(1.05);
      lastAlpha = p.alpha;
      peak = Math.max(peak, p.scale);
    }
    expect(peak).toBeGreaterThan(1); // it overshoots: an event, not a fade
    expect(endBannerEntrance(END_BANNER_IN_MS)).toEqual({ scale: 1, alpha: 1 });
    expect(endBannerEntrance(5000)).toEqual({ scale: 1, alpha: 1 });
    expect(endBannerEntrance(0.4 * END_BANNER_IN_MS).alpha).toBe(1);
  });

  it("runs on the frames' own time: the same frames give the same banner, a pause holds it, a new showing replays it", () => {
    const words = { title: "SHATTERED!", sub: "43/180 segments destroyed", color: "#ef4444" };
    const run = (frames: number[]) => {
      const canvas = fakeCanvas(1080, 1080);
      const layer = new EndBannerLayer();
      for (const dt of frames) {
        layer.draw(canvas.ctx as unknown as CanvasRenderingContext2D, words, 540, 540, 1080, dt);
        layer.endFrame();
      }
      return { layer, calls: canvas.ctx.calls };
    };
    const sixty = Array.from({ length: 10 }, () => 1000 / 60);
    const a = run(sixty);
    const b = run(sixty);
    expect(JSON.stringify(a.calls)).toBe(JSON.stringify(b.calls));
    // the first frame is the entrance's start, each next one a frame later
    expect(a.layer.ageMs).toBeCloseTo((9 * 1000) / 60, 6);
    // paused frames (dt 0) do not move it
    expect(run([16, 0, 0, 0]).layer.ageMs).toBe(0);
    expect(run([16, 16, 0, 16]).layer.ageMs).toBe(32);
    // a frame without the banner, then the banner again: from the start
    const canvas = fakeCanvas(1080, 1080);
    const g = canvas.ctx as unknown as CanvasRenderingContext2D;
    const layer = new EndBannerLayer();
    for (let i = 0; i < 30; i++) {
      layer.draw(g, words, 540, 540, 1080, 16);
      layer.endFrame();
    }
    expect(layer.shown).toBe(true);
    expect(layer.ageMs).toBeGreaterThan(END_BANNER_IN_MS);
    layer.endFrame();
    expect(layer.shown).toBe(false);
    layer.draw(g, words, 540, 540, 1080, 16);
    expect(layer.ageMs).toBe(0);
    // and a new title replays it too
    for (let i = 0; i < 30; i++) layer.draw(g, words, 540, 540, 1080, 16);
    layer.draw(g, { ...words, title: "TIME'S UP" }, 540, 540, 1080, 16);
    expect(layer.ageMs).toBe(0);
  });
});

describe("the end banner drawn", () => {
  it("draws the plate first and the words over it at full opacity, whatever alpha the pass around it runs at", () => {
    const canvas = fakeCanvas(1080, 1080);
    const ctx = canvas.ctx;
    const g = ctx as unknown as CanvasRenderingContext2D;
    // the canvas' HUD pass inherits the camera's 0.6: record the alpha at every drawing call
    const alphas: { name: string; alpha: number; text?: string }[] = [];
    for (const name of ["fill", "stroke", "fillText"]) {
      const logged = ctx[name] as (...args: unknown[]) => unknown;
      ctx[name] = (...args: unknown[]) => {
        alphas.push({ name, alpha: ctx.globalAlpha, text: name === "fillText" ? String(args[0]) : undefined });
        return logged(...args);
      };
    }
    ctx.globalAlpha = 0.6;
    const layer = new EndBannerLayer();
    const words = { title: "OVERFLOW", sub: "Top tier Hexagon after 45 merges", color: "#fb7185" };
    for (let i = 0; i < 40; i++) {
      alphas.length = 0;
      ctx.calls.length = 0;
      layer.draw(g, words, 540, 540, 1080, 1000 / 60);
      layer.endFrame();
    }
    // after the entrance: the plate's fill, then its two border strokes, then the title and the line
    expect(alphas.map((a) => a.name)).toEqual(["fill", "stroke", "stroke", "fillText", "fillText"]);
    expect(alphas[0].alpha).toBe(1);
    expect(alphas[3]).toEqual({ name: "fillText", alpha: 1, text: "OVERFLOW" });
    expect(alphas[4]).toEqual({ name: "fillText", alpha: 1, text: "Top tier Hexagon after 45 merges" });
    // no shadow blur (a blur on 86 px letters every frame was the old banner's cost) and the state handed back
    expect(ctx.shadowBlur).toBe(0);
    expect(ctx.calls.filter((c) => c.name === "save").length).toBe(ctx.calls.filter((c) => c.name === "restore").length);
    expect(ctx.calls.some((c) => c.name === "scale")).toBe(false); // (at rest: no transform left to pay for)
    // nothing is measured once the words are laid out
    expect(ctx.calls.some((c) => c.name === "measureText")).toBe(false);
    // the plate's box, for the watermark: centred where it was asked for, inside the square
    const lay = layer.layout(g, words, 1080);
    expect(layer.rect).toEqual({ x: 540 - lay.width / 2, y: 540 - lay.height / 2, w: lay.width, h: lay.height });
    expect(layer.rect.x).toBeGreaterThan(0);
    expect(layer.rect.x + layer.rect.w).toBeLessThan(1080);
  });

  it("scales up from 0.8 on its first frame, around its own centre", () => {
    const canvas = fakeCanvas(1080, 1080);
    const layer = new EndBannerLayer();
    layer.draw(canvas.ctx as unknown as CanvasRenderingContext2D, { title: "HOME!", sub: "", color: "#a3e635" }, 300, 400, 1080, 16);
    const calls = canvas.ctx.calls;
    const translate = calls.find((c) => c.name === "translate")!;
    expect(translate.args).toEqual([300, 400]);
    const scale = calls.find((c) => c.name === "scale")!;
    expect(scale.args[0]).toBeCloseTo(0.8, 6);
    expect(texts(calls)).toEqual(["HOME!"]);
  });

  it("draws the strip as one line on the same plate, never wider than its room", () => {
    const canvas = fakeCanvas(1080, 1080);
    const box = { x: 0, y: 0, w: 0, h: 0 };
    drawEndBannerStrip(canvas.ctx as unknown as CanvasRenderingContext2D, "AQUA ESCAPED · in 33.9s", "#22d3ee", 540, 1015, 1080, 0.4 * 1080, box);
    expect(texts(canvas.ctx.calls)).toEqual(["AQUA ESCAPED · in 33.9s"]);
    expect(box.w).toBeLessThanOrEqual(0.4 * 1080 + 1e-6);
    expect(box.x + box.w / 2).toBeCloseTo(540, 6);
    expect(box.y + box.h / 2).toBeCloseTo(1015, 6);
    expect(box.h).toBeLessThan(0.07 * 1080);
    expect(canvas.ctx.globalAlpha).toBe(1);
  });
});

describe("the canvas' wiring of the end banner", () => {
  it("anchors the banners whose payoff is in the middle away from it, and holds the teams' banner clear of one in the middle", () => {
    // the Journey's HOME! sits where its stage banners were, above the door and its sign
    expect(canvasSource).toMatch(/bigBanner\(JL\.homeTitle, [^\n]*"#a3e635", 0\.27\)/);
    // the conveyor's banner goes under the bowl and its pile, and stays in the middle of the rings and the pegs
    expect(canvasSource).toMatch(/bigBanner\(CV\.title, CV\.sub, "#a3e635", conveyorView\.settings\.arena === "bowl" \? 0\.78 : undefined\)/);
    // Pendulum Wave's goes under the row of bobs, the polyrhythm rings' and the Circle Illusion's over the lower half
    expect(canvasSource).toMatch(/bigBanner\(L\.pendulumDone, [^\n]*"#a3e635", 0\.8\)/);
    expect(canvasSource).toMatch(/bigBanner\(L\.polyrhythmDone, [^\n]*settings\.layout === "rings" \? 0\.73 : undefined\)/);
    expect(canvasSource).toMatch(/bigBanner\(L\.complete, \(L\.illusionCycles [^\n]*"#a3e635", 0\.75\)/);
    expect(canvasSource).toMatch(/\|\| endBannerMid/);
    // the watermark is told where the plate is
    expect(canvasSource).toMatch(/for \(const layer of endBanners\) if \(layer\.shown\) hud\.block\(layer\.rect\.x, layer\.rect\.y, layer\.rect\.w, layer\.rect\.h\)/);
  });

  it("keeps a banner with a place of its own inside the square and between a clip's captions", () => {
    // a 1080 px square from y = 0: Pendulum Wave's banner (230 px tall) wants its centre 80 % down
    const wanted = 0.8 * 1080 - 115;
    expect(placeEndBanner(wanted, 230, 21.6, 1058.4, 425)).toBe(wanted);
    // a bottom caption whose upper edge is at 900: the banner ends above it
    expect(placeEndBanner(wanted, 230, 21.6, 890, 425)).toBe(660);
    // a top caption down to 300 under the Journey's banner (wanted 27 % down): the banner starts below it
    expect(placeEndBanner(0.27 * 1080 - 115, 230, 310, 1058.4, 425)).toBe(310);
    // no room between the stacks: the middle of the frame, where every banner was before
    expect(placeEndBanner(wanted, 230, 500, 700, 425)).toBe(425);
    // the canvas hands it the captions' stacks of the frame before
    expect(canvasSource).toMatch(/if \(captionLayer\.usesTop && captionLayer\.stackEdges\.top > top\) top = captionLayer\.stackEdges\.top \+ 0\.01 \* minDim;/);
    expect(canvasSource).toMatch(/if \(captionLayer\.usesBottom && captionLayer\.stackEdges\.bottom < bottom\) bottom = captionLayer\.stackEdges\.bottom - 0\.01 \* minDim;/);
    expect(canvasSource).toMatch(/b\.draw\(placeEndBanner\(squareTop \+ b\.at \* minDim - b\.height \/ 2, b\.height, top, bottom, cy - b\.height \/ 2\)\)/);
  });

  it("gives Classic an end card once the ball is out of the last ring, but not in a loop clip, with a roster or with captions", () => {
    expect(canvasSource).toMatch(/engine\.getCurrentModeName\(\) === "classic" && !loopHudRef\.current && !teamLayer\.isActive\(\) && !captionsRef\.current/);
    expect(canvasSource).toMatch(/if \(ringView && ringRunOut\(ringView\)\) bigBanner\(L\.escaped, \(L\.ringsOut \?\? DEFAULT_LABELS\.ringsOut!\)\(ringView\.rings, \(ringView\.outMs \/ 1000\)\.toFixed\(1\)\), "#a3e635"\)/);
    // the run it is drawn for: a default Classic run leaves its last ring, and the view says when
    const settings = defaultSettings("classic");
    const request = finderRequestOfSettings({ ...settings, wallCount: 3 }, { width: 800, height: 450 }, 240);
    const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, 7);
    let out = -1;
    for (let frame = 0; frame < 240 * 60 && out < 0; frame++) {
      engine.update(1000 / 60, 0);
      const view = engine.getRingEscapeView()!;
      if (view.outMs >= 0) out = view.outMs;
    }
    expect(out).toBeGreaterThan(0);
    expect(engine.getRingEscapeView()!.rings).toBe(3);
  });
});

/* ------------------------------------------------------------------ copy burned into videos */

const CATALOGS: Record<string, Record<string, Record<string, unknown>>> = { en, pl, es } as never;

function format(locale: string, namespace: string, key: string, values: Record<string, string | number>): string {
  const message = CATALOGS[locale][namespace][key];
  expect(typeof message, `${locale} ${namespace}.${key}`).toBe("string");
  return String(new IntlMessageFormat(String(message), locale).format(values));
}

describe("the end lines' copy", () => {
  it("has no \"(s)\" plural left in any line the canvas draws, in any language", () => {
    for (const [locale, catalog] of Object.entries(CATALOGS)) {
      for (const [namespace, entries] of Object.entries(catalog)) {
        for (const [key, value] of Object.entries(entries)) {
          if (!key.startsWith("canvas") || typeof value !== "string") continue;
          expect(value, `${locale} ${namespace}.${key}`).not.toMatch(/\((?:s|es|as|os|y|i|e|ów)\)/);
        }
      }
    }
  });

  it("counts teleports, frozen balls, cycles, stages and rings as a person would, in English, Polish and Spanish", () => {
    expect(format("en", "Simulator", "canvasAfterTeleports", { count: 1 })).toBe("After 1 teleport");
    expect(format("en", "Simulator", "canvasAfterTeleports", { count: 8 })).toBe("After 8 teleports");
    expect(format("en", "Simulator", "canvasAfterFrozenBalls", { count: 1 })).toBe("After 1 frozen ball");
    expect(format("en", "Simulator", "canvasAfterFrozenBalls", { count: 5 })).toBe("After 5 frozen balls");
    expect(format("en", "Simulator", "canvasPendulumInLine", { count: 15, cycles: 1 })).toBe("All 15 pendulums back in phase after 1 cycle");
    expect(format("en", "Simulator", "canvasPolyrhythmAligned", { count: 16, cycles: 2 })).toBe("All 16 voices back in phase after 2 cycles");
    expect(format("en", "Simulator", "canvasGlassHomeSub", { panes: 32, stages: 4 })).toBe("32 panes smashed in 4 stages");
    expect(format("en", "Simulator", "canvasGlassHomeSub", { panes: 1, stages: 1 })).toBe("1 pane smashed in 1 stage");
    expect(format("en", "Simulator", "canvasIllusionCycles", { count: 1 })).toBe("Back where it started after 1 cycle");
    // (one spelling of the unit in English end lines: "44.7s", as Merge Ring, Spiral Glass and Power Layers write it)
    expect(format("en", "Simulator", "canvasRingsOut", { rings: 7, time: "62.4" })).toBe("7 rings in 62.4s");
    expect(format("en", "Simulator", "canvasRingsOut", { rings: 1, time: "3.0" })).toBe("1 ring in 3.0s");

    expect(format("pl", "Simulator", "canvasAfterTeleports", { count: 1 })).toBe("Po 1 teleportacji");
    expect(format("pl", "Simulator", "canvasAfterTeleports", { count: 3 })).toBe("Po 3 teleportacjach");
    expect(format("pl", "Simulator", "canvasAfterTeleports", { count: 8 })).toBe("Po 8 teleportacjach");
    expect(format("pl", "Simulator", "canvasAfterFrozenBalls", { count: 1 })).toBe("Po 1 zamrożonej piłce");
    expect(format("pl", "Simulator", "canvasAfterFrozenBalls", { count: 5 })).toBe("Po 5 zamrożonych piłkach");
    expect(format("pl", "Simulator", "canvasPendulumInLine", { count: 15, cycles: 1 })).toBe("Wszystkie wahadła (15) znów w fazie po 1 cyklu");
    expect(format("pl", "Simulator", "canvasPolyrhythmAligned", { count: 16, cycles: 2 })).toBe("Wszystkie głosy (16) znów w fazie po 2 cyklach");
    expect(format("pl", "Simulator", "canvasGlassHomeSub", { panes: 32, stages: 4 })).toBe("32 rozbite tafle w 4 etapach");
    expect(format("pl", "Simulator", "canvasGlassHomeSub", { panes: 5, stages: 1 })).toBe("5 rozbitych tafli w 1 etapie");
    expect(format("pl", "Simulator", "canvasIllusionCycles", { count: 6 })).toBe("Z powrotem na starcie po 6 cyklach");
    expect(format("pl", "Simulator", "canvasRingsOut", { rings: 1, time: "3.0" })).toBe("1 pierścień w 3.0 s");
    expect(format("pl", "Simulator", "canvasRingsOut", { rings: 3, time: "9.5" })).toBe("3 pierścienie w 9.5 s");
    expect(format("pl", "Simulator", "canvasRingsOut", { rings: 7, time: "62.4" })).toBe("7 pierścieni w 62.4 s");

    expect(format("es", "Simulator", "canvasAfterTeleports", { count: 1 })).toBe("Tras 1 teletransporte");
    expect(format("es", "Simulator", "canvasAfterTeleports", { count: 8 })).toBe("Tras 8 teletransportes");
    expect(format("es", "Simulator", "canvasAfterFrozenBalls", { count: 1 })).toBe("Tras 1 pelota congelada");
    expect(format("es", "Simulator", "canvasAfterFrozenBalls", { count: 5 })).toBe("Tras 5 pelotas congeladas");
    expect(format("es", "Simulator", "canvasPendulumInLine", { count: 15, cycles: 1 })).toBe("Los 15 péndulos vuelven a estar en fase tras 1 ciclo");
    expect(format("es", "Simulator", "canvasPolyrhythmAligned", { count: 16, cycles: 2 })).toBe("Las 16 voces vuelven a estar en fase tras 2 ciclos");
    expect(format("es", "Simulator", "canvasGlassHomeSub", { panes: 32, stages: 4 })).toBe("32 paneles rotos en 4 etapas");
    expect(format("es", "Simulator", "canvasIllusionCycles", { count: 1 })).toBe("De vuelta al inicio tras 1 ciclo");
    expect(format("es", "Simulator", "canvasRingsOut", { rings: 7, time: "62.4" })).toBe("7 anillos en 62.4 s");
  });

  it("says Beat Drop's result in words: no \"0.000 ms off\"", () => {
    // the default run's worst landing is 4e-13 ms off its beat (the engine's measure)
    expect(DEFAULT_BEAT_DROP_LABELS.doneSub(58, 4.44089e-13)).toBe("58 landings, not one late");
    expect(DEFAULT_BEAT_DROP_LABELS.doneSub(1, 0)).toBe("1 landing, right on the beat");
    expect(DEFAULT_BEAT_DROP_LABELS.doneSub(58, 3.2)).toBe("58 landings, within 4 ms of the beat");
    expect(BEAT_DROP_ON_TIME_MS).toBe(0.5);
    expect(format("en", "BeatDrop", "canvasDoneSub", { count: 58 })).toBe("58 landings, not one late");
    expect(format("en", "BeatDrop", "canvasDoneSub", { count: 1 })).toBe("1 landing, right on the beat");
    expect(format("en", "BeatDrop", "canvasDoneSubOff", { count: 58, ms: 4 })).toBe("58 landings, within 4 ms of the beat");
    expect(format("pl", "BeatDrop", "canvasDoneSub", { count: 58 })).toBe("58 lądowań, wszystkie w bit");
    expect(format("pl", "BeatDrop", "canvasDoneSub", { count: 22 })).toBe("22 lądowania, wszystkie w bit");
    expect(format("pl", "BeatDrop", "canvasDoneSubOff", { count: 58, ms: 4 })).toBe("58 lądowań, najwyżej 4 ms od bitu");
    expect(format("es", "BeatDrop", "canvasDoneSub", { count: 58 })).toBe("58 aterrizajes, ninguno tarde");
    expect(format("es", "BeatDrop", "canvasDoneSubOff", { count: 58, ms: 4 })).toBe("58 aterrizajes, a menos de 4 ms del pulso");
    for (const locale of ["en", "pl", "es"]) expect(format(locale, "BeatDrop", "canvasDoneSub", { count: 58 })).not.toMatch(/0[.,]000|\bms\b/);
    // the page wires the same two lines by the same threshold
    const page = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Simulator.tsx"), "utf8");
    expect(page).toMatch(/errorMs < BEAT_DROP_ON_TIME_MS \? t\("BeatDrop\.canvasDoneSub", \{ count: landings \}\) : t\("BeatDrop\.canvasDoneSubOff", \{ count: landings, ms: Math\.ceil\(errorMs\) \}\)/);
  });
});

/* ------------------------------------------------------------------ the endings beside the banner */

describe("the maze's banner", () => {
  it("is the whole banner while it is news, a strip while the others run on, and the whole banner again at the end", () => {
    const view = { verdict: "exit" as const, verdictMs: 7000, finished: false };
    expect(mazeBannerPhase({ ...view, verdict: "" as const }, 9000)).toBe("none");
    expect(mazeBannerPhase(view, 7100)).toBe("none"); // (the 200 ms before it shows)
    expect(mazeBannerPhase(view, 7200)).toBe("full");
    expect(mazeBannerPhase(view, 7200 + MAZE_BANNER_FULL_MS - 1)).toBe("full");
    expect(mazeBannerPhase(view, 7200 + MAZE_BANNER_FULL_MS)).toBe("strip");
    expect(mazeBannerPhase(view, 45000)).toBe("strip");
    expect(mazeBannerPhase({ ...view, finished: true }, 46000)).toBe("full");
    // a run that ends with its verdict (time's up, or the last ball out) never shows the strip
    expect(mazeBannerPhase({ verdict: "time" as const, verdictMs: 60000, finished: true }, 60000 + 5000)).toBe("full");
    // long enough to read a name and a time, short next to the 39 s the others may still run
    expect(MAZE_BANNER_FULL_MS).toBeGreaterThanOrEqual(1500);
    expect(MAZE_BANNER_FULL_MS).toBeLessThanOrEqual(3000);
  });
});

describe("the race's podium", () => {
  it("lists the rest of the order above the watermark badge's strip, for every size of grid", () => {
    // an export's badge sits BADGE_INSET from the square's bottom and is BADGE_HEIGHT tall
    const badgeTop = 1 - BADGE_INSET - BADGE_HEIGHT;
    expect(PODIUM_REST_BOTTOM).toBeLessThan(badgeTop);
    for (let racers = 1; racers <= 8; racers++) {
      const { y0, step, fs } = podiumRestRows(racers);
      const rows = Math.ceil(racers / 2);
      expect(y0).toBe(PODIUM_REST_TOP);
      expect(y0 + (rows - 1) * step + fs / 2, `${racers} racers`).toBeLessThanOrEqual(PODIUM_REST_BOTTOM + 1e-9);
      expect(fs, `${racers} racers`).toBeGreaterThanOrEqual(0.0215); // (never under the 0.022 it was drawn at, within rounding)
      if (rows > 1) expect(step).toBeGreaterThan(fs); // the rows do not touch
      // the podium's own times end at 0.8025 of the square: the list starts below them
      expect(y0 - fs / 2).toBeGreaterThan(0.8025);
    }
    // up to three rows (the default eight racers) the letters are larger than before
    expect(podiumRestRows(5).fs).toBeCloseTo(0.026, 6);
  });

  it("draws no FINISH label behind the podium and slides a row that changes place over the others on its own card", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/raceRenderer.ts"), "utf8");
    expect(source).toMatch(/this\.drawFinish\(ctx, track, endScreen \? "" : labels\.finish\)/);
    expect(source).toMatch(/if \(text\) this\.label\(ctx, `🏁 \$\{text\}`/);
    expect(source).toMatch(/if \(y === target\) rowOrder\[resting\+\+\] = k;\s+else rowOrder\[--moving\] = k;/);
    expect(source).toMatch(/if \(slot >= resting\) \{\s+ctx\.fillStyle = "#101014";/);
  });
});

describe("Fight League's noir title", () => {
  it("is as wide as ever in a square frame and ends before the match clock in a 9:16 export", () => {
    const S = 1080;
    const timer = 0.053 * S; // "0:00" at 2.2 % of the side
    // a square or landscape frame: the text runs to 96.5 % of the square, the title keeps its 78 %
    expect(flNoirTitleWidth(S, 0.965 * S, timer)).toBeCloseTo(FL_NOIR_TITLE_W * S, 6);
    // a 9:16 export keeps the right 10 % free: the text ends at 88 %, and the clock is right-aligned there
    const portrait = flNoirTitleWidth(S, 0.88 * S, timer);
    expect(portrait).toBeLessThan(FL_NOIR_TITLE_W * S);
    const titleRight = S / 2 + portrait / 2;
    const clockLeft = 0.88 * S - timer;
    expect(clockLeft - titleRight).toBeGreaterThanOrEqual(FL_NOIR_TIMER_GAP * S - 1e-6);
    // the old width reached under the clock: that was the overlap
    expect(S / 2 + (FL_NOIR_TITLE_W * S) / 2).toBeGreaterThan(clockLeft);
    // without a time cap there is no clock to keep clear of
    expect(flNoirTitleWidth(S, 0.88 * S, 0)).toBeCloseTo(FL_NOIR_TITLE_W * S, 6);
    // never narrower than 30 % of the side, whatever the clock's width
    expect(flNoirTitleWidth(S, 0.88 * S, 0.5 * S)).toBeCloseTo(0.3 * S, 6);
  });
});

describe("Glass Smash's stage label", () => {
  it("is drawn under its line left of the stage dots, past the wall where the watermark badge sits", () => {
    const settings = defaultSettings("glass");
    const request = finderRequestOfSettings(settings, { width: 800, height: 450 }, 60);
    const engine = createEngineForSettings(request.physicsConfig, request.mode, request.modeSettings, 7);
    engine.update(1000 / 60, 0);
    const view = engine.getGlassView();
    const level = view.level!;
    expect(level.stages.length).toBeGreaterThan(1);
    const canvas = fakeCanvas(800, 450);
    const ctx = canvas.ctx;
    const aligned: { text: string; x: number; align: string; width: number }[] = [];
    const logged = ctx.fillText as (...args: unknown[]) => unknown;
    ctx.fillText = (...args: unknown[]) => {
      aligned.push({ text: String(args[0]), x: Number(args[1]), align: ctx.textAlign, width: (ctx.measureText as (t: string) => { width: number })(String(args[0])).width });
      return logged(...args);
    };
    const opts: GlassRenderOptions = { wallColor: () => "#ffffff", wallThickness: 2, showGlow: false, stageLabel: (n) => `STAGE ${n}`, homeLabel: "HOME" };
    // the whole shaft in view, so every stage's line is drawn
    drawGlassWorld(ctx as unknown as CanvasRenderingContext2D, view, opts, -1e6, 1e6);
    const labels = aligned.filter((a) => a.text.startsWith("STAGE "));
    expect(labels.length).toBe(level.stages.length - 1);
    const f = level.field;
    const dots = glassDots(f, level.stages.length);
    for (const label of labels) {
      expect(label.align).toBe("center");
      // 30 % of the shaft in from its left wall: under the middle the name scrolled onto the stage dots (two seconds a stage)
      expect(label.x).toBeCloseTo(f.left + GLASS_LABEL_AT * f.width, 6);
      expect(label.x).toBe(glassLabelX(f, level.stages.length, label.width));
      // its box misses the dots at the top centre, with air between
      expect(label.x + label.width / 2).toBeLessThan(dots.x0 - dots.r);
      // and it is clear of the wall, where the line scrolls through the badge's corner: a 9:16 export's badge ends 31 % of the
      // square in (8.5 % + at most a quarter of the side: the maze's strip keeps the same room)
      const square = { left: 400 - 225, side: 450 };
      expect(label.x - label.width / 2).toBeGreaterThan(square.left + 0.31 * square.side);
    }
    // a long row of dots pushes the name further left, never past the wall
    const many = glassLabelX(f, 14, 50);
    expect(many).toBeLessThan(f.left + GLASS_LABEL_AT * f.width);
    expect(many + 25).toBeLessThan(glassDots(f, 14).x0);
    expect(glassLabelX(f, 60, 50)).toBe(f.left + 4 + 25);
  });
});

/* ------------------------------------------------------------------ the review of the end banners (modes lane B1) */

describe("the verdict's hold", () => {
  it("keeps a verdict that came with the last step on screen for 1.5 s before the end screen: 2 s in a recording", () => {
    expect(END_BANNER_HOLD_MS).toBe(1500);
    const canvas = fakeCanvas(1080, 1080);
    const g = canvas.ctx as unknown as CanvasRenderingContext2D;
    const layer = new EndBannerLayer();
    const words = { title: "SETTLED!", sub: "All 24 balls at rest", color: "#a3e635" };
    expect(layer.fresh()).toBe(false); // nothing shown: nothing to wait for
    let frames = 0;
    do {
      layer.draw(g, words, 540, 540, 1080, 1000 / 60);
      layer.endFrame();
      frames++;
    } while (layer.fresh() && frames < 1000);
    // the first frame is age 0: fresh for the 90 frames of 1.5 s, then no longer
    expect(frames).toBe(91);
    // a paused run (no frame time) waits with it; a frame without the banner ends the wait
    const paused = new EndBannerLayer();
    for (let i = 0; i < 300; i++) {
      paused.draw(g, words, 540, 540, 1080, 0);
      paused.endFrame();
    }
    expect(paused.fresh()).toBe(true);
    paused.endFrame();
    expect(paused.fresh()).toBe(false);
  });

  it("is the canvas' own hold of the end screen, live and in the fast export, where nothing else holds the ending", () => {
    // the page's finish detection and the export's end tracker both ask holdsEndScreen()
    expect(canvasSource).toMatch(/holdsEndScreen: \(\) => \(cinematicRef\.current\?\.holdsEndScreen\(\) \?\? false\) \|\| \(captionLayerRef\.current\?\.holdsEndScreen\(\) \?\? false\) \|\| endBannerHoldRef\.current/);
    expect(canvasSource).toMatch(/holdsEndScreen: \(\) => cam\.holdsEndScreen\(\) \|\| captionLayer\.holdsEndScreen\(\) \|\| endBannerHoldRef\.current/);
    // not with captions of its own (the planner set the clip's length), a roster or a multipliers finish (the page holds those)
    expect(canvasSource).toMatch(/endBannerHoldRef\.current = bannerFresh && !captionsRef\.current && !teamLayer\.isActive\(\) && !engine\.endsWithMultiplierFinish\(\);/);
    expect(canvasSource).toMatch(/if \(layer\.fresh\(\)\) bannerFresh = true;/);
  });

  it("no longer dims the square or covers the verdict with the page's Restart button", () => {
    const simulator = fs.readFileSync(path.join(process.cwd(), "src/components/simulator/Simulator.tsx"), "utf8");
    const at = simulator.indexOf('{t("Simulator.restartSimulation")}');
    expect(at).toBeGreaterThan(0);
    const overlay = simulator.slice(simulator.lastIndexOf("{isStarted && finished && !isRecording && (", at), at);
    // along the bottom edge, the taps passing through to the canvas except on the button: no scrim over the whole square
    expect(overlay).toMatch(/pointer-events-none absolute inset-x-0 bottom-0 flex justify-center/);
    expect(overlay).not.toMatch(/className=\{scrim\}/);
    expect(overlay).not.toMatch(/inset-0/);
    expect(overlay).toMatch(/className="pointer-events-auto"/);
  });
});

describe("the plate", () => {
  it("lets nothing under it be read: 97 % opaque", () => {
    expect(END_BANNER_PLATE.alpha).toBeGreaterThanOrEqual(0.97);
    // a gate label of the multipliers' board (#22c55e-like, bright) through the plate: a contrast under 1.25 against the plate itself
    const through = (v: number) => END_BANNER_PLATE.alpha * 12 + (1 - END_BANNER_PLATE.alpha) * v;
    expect(contrast(luminance(through(255), through(255), through(255)), luminance(12, 12, 12))).toBeLessThan(1.25);
  });

  it("hides a multipliers gate label the plate's edge would cut, and no other", () => {
    // a plate from 400 to 600 (board y), labels 30 px tall
    expect(gateLabelHidden(500, 30, 400, 600)).toBe(true); // under it
    expect(gateLabelHidden(395, 30, 400, 600)).toBe(true); // across its upper edge
    expect(gateLabelHidden(620, 30, 400, 600)).toBe(true); // across its lower edge
    expect(gateLabelHidden(360, 30, 400, 600)).toBe(false);
    expect(gateLabelHidden(640, 30, 400, 600)).toBe(false);
    // no plate (the board still running): every label
    expect(gateLabelHidden(500, 30, Number.NaN, Number.NaN)).toBe(false);
    expect(gateLabelHidden(500, 30, undefined, undefined)).toBe(false);
    expect(canvasSource).toMatch(/multRender\.quietTop = multBoard && multBoard\.done && endBanners\[0\]\.shown \? endBanners\[0\]\.rect\.y \+ multTop : NaN;/);
  });
});

describe("a banner beside its payoff, round two", () => {
  it("puts GLASS CLEARED under the spiral's centre and FINAL FORM over the chute", () => {
    expect(canvasSource).toMatch(/bigBanner\(SG\.clearedTitle, [^\n]*"#f8fafc", 0\.82\)/);
    expect(canvasSource).toMatch(/bigBanner\(MR\.finalTitle, [^\n]*"#f8fafc", 0\.2\)/);
    // the overflow fills the whole ring: its banner stays in the middle
    expect(canvasSource).toMatch(/else bigBanner\(MR\.overflowTitle, [^\n]*"#fb7185"\);/);
  });

  it("puts Accumulation's card over the top or the bottom of the ring, wherever it covers fewer frozen balls", () => {
    const side = 1000;
    const cy = 500;
    const ball = (y: number) => ({ y, radius: 20 });
    expect(accumulationBannerAt([], cy, side)).toBe(END_BANNER_TOP);
    // three balls under the top band, one under the bottom one: the bottom
    expect(accumulationBannerAt([ball(150), ball(200), ball(260), ball(800)], cy, side)).toBe(END_BANNER_BOTTOM);
    // the other way round: the top
    expect(accumulationBannerAt([ball(180), ball(760), ball(820), ball(880)], cy, side)).toBe(END_BANNER_TOP);
    // even: the top; balls in the middle count for neither
    expect(accumulationBannerAt([ball(180), ball(820), ball(500), ball(450)], cy, side)).toBe(END_BANNER_TOP);
    // a ball that only touches a band counts
    expect(accumulationBannerAt([ball(300), ball(305)], cy, side)).toBe(END_BANNER_BOTTOM);
    expect(canvasSource).toMatch(/bigBanner\(L\.escaped, L\.afterFrozenBalls\(frozen\), "#4ECDC4", accumulationBannerAt\(engine\.getFrozenBalls\(\), cy, minDim\)\)/);
  });
});

describe("the maze's strip and the watermark badge", () => {
  it("leaves both bottom corners to the badge, in a 9:16 export and in a square one", () => {
    for (const frame of [
      { width: 1080, height: 1920 },
      { width: 1080, height: 1080 },
      { width: 1920, height: 1080 },
    ]) {
      const portrait = frame.height > frame.width;
      const side = 1080;
      // the canvas square the recorder copies, 1:1 at 1080 px, and the badge as the video layout sizes it: a quarter of the side wide at most
      const box = liveBadgeBox({ area: { x: 0, y: 0, width: side, height: side }, recording: frame });
      const badge = { width: Math.round(0.25 * side), height: badgeMetrics(side).height };
      // the strip as the maze draws it under itself, with a long name
      const canvas = fakeCanvas(side, side);
      const strip = { x: 0, y: 0, w: 0, h: 0 };
      const place = mazeStripPlace(portrait);
      drawEndBannerStrip(canvas.ctx as unknown as CanvasRenderingContext2D, "Bartholomew the Third wins! · 12.4s", "#22d3ee", place.centre * side, 0.955 * side, side, place.maxWidth * side, strip);
      expect(strip.w).toBeLessThanOrEqual(place.maxWidth * side + 1e-6);
      const hud = new LiveHud().reset(1);
      hud.block(strip.x, strip.y, strip.w, strip.h);
      const out: LivePlacement = { x: 0, y: 0, width: 0, height: 0, corner: "bottom-left", free: false };
      // the left side's six seconds, then the right side's: the badge keeps its bottom corner both times
      expect([frame.width, frame.height, placeLiveBadge(box, badge.width, badge.height, 0, hud, out).corner, out.free]).toEqual([frame.width, frame.height, "bottom-left", true]);
      expect([frame.width, frame.height, placeLiveBadge(box, badge.width, badge.height, 6000, hud, out).corner, out.free]).toEqual([frame.width, frame.height, "bottom-right", true]);
      // the strip it replaced – 40 % of the side on the square's centre – held both corners of a 9:16 export
      if (portrait) {
        const wide = new LiveHud().reset(1);
        wide.block(0.3 * side, strip.y, 0.4 * side, strip.h);
        expect(placeLiveBadge(box, badge.width, badge.height, 6000, wide, out).corner).not.toBe("bottom-right");
      }
    }
  });

  it("is told by the canvas when the frame is a 9:16 export", () => {
    expect(canvasSource).toMatch(/portrait: !!mazeExport && mazeExport\.height > mazeExport\.width/);
    expect(mazeStripPlace(true).centre).toBeLessThan(0.5); // the safe zone of a 9:16 frame is not centred
    expect(mazeStripPlace(false).centre).toBe(0.5);
  });
});

describe("the end lines' copy, round two", () => {
  it("counts clones, balls home and balls lost as a person would", () => {
    expect(format("en", "Simulator", "canvasMpMadeItHome", { count: 1, name: "Gerald" })).toBe("1 Gerald made it home");
    expect(format("en", "Simulator", "canvasMpMadeItHomeSub", { count: 1 })).toBe("1 clone along the way");
    expect(format("en", "Simulator", "canvasMpMadeItHomeSub", { count: 67 })).toBe("67 clones along the way");
    expect(format("es", "Simulator", "canvasMpMadeItHome", { count: 1, name: "Gerald" })).toBe("1 Gerald llegó a casa");
    expect(format("es", "Simulator", "canvasMpMadeItHome", { count: 56, name: "Gerald" })).toBe("56 Gerald llegaron a casa");
    expect(format("es", "Simulator", "canvasMpMadeItHomeSub", { count: 1 })).toBe("1 clon por el camino");
    expect(format("es", "Simulator", "canvasMpMadeItHomeLost", { count: 1 })).toBe("1 perdido");
    expect(format("es", "Simulator", "canvasMpMadeItHomeLost", { count: 3 })).toBe("3 perdidos");
    expect(format("pl", "Simulator", "canvasMpMadeItHome", { count: 1, name: "Gerald" })).toBe("Gerald w domu: 1");
    expect(format("pl", "Simulator", "canvasMpMadeItHomeSub", { count: 1 })).toBe("Klony po drodze: 1");
  });

  it("counts balls at rest, shapes, strings, hits, merges, tiles, stages and notes", () => {
    expect(format("en", "Simulator", "canvasBallsAtRest", { count: 1 })).toBe("1 ball at rest");
    expect(format("en", "Simulator", "canvasBallsAtRest", { count: 24 })).toBe("All 24 balls at rest");
    expect(format("en", "Simulator", "canvasBoxCounted", { count: 1 })).toBe("1 shape reached zero");
    expect(format("es", "Simulator", "canvasBoxCounted", { count: 1 })).toBe("La forma llegó a cero");
    expect(format("pl", "Simulator", "canvasBoxCounted", { count: 5 })).toBe("Wszystkie kształty (5) doszły do zera");
    expect(format("en", "Simulator", "canvasDpPlucks", { count: 1 })).toBe("1 string plucked");
    expect(format("en", "Simulator", "canvasDpHits", { count: 1 })).toBe("1 hit");
    expect(format("es", "Simulator", "canvasDpHits", { count: 1 })).toBe("1 golpe");
    expect(format("en", "Simulator", "canvasPlFreedomSub", { hits: 1, seconds: "8.8" })).toBe("1 hit · 8.8s");
    expect(format("en", "Simulator", "canvasPlFreedomSub", { hits: 10, seconds: "16.7" })).toBe("10 hits · 16.7s");
    expect(format("en", "MergeRing", "canvasFinalSub", { merges: 43, seconds: "44.7" })).toBe("43 merges in 44.7s");
    expect(format("en", "MergeRing", "canvasOverflowSub", { top: "Hexagon", merges: 1 })).toBe("Top tier Hexagon after 1 merge");
    expect(format("pl", "MergeRing", "canvasFinalSub", { merges: 22, seconds: "21.7" })).toBe("22 fuzje w 21.7 s");
    expect(format("pl", "MergeRing", "canvasFinalSub", { merges: 25, seconds: "21.7" })).toBe("25 fuzji w 21.7 s");
    expect(format("es", "MergeRing", "canvasFinalSub", { merges: 1, seconds: "9.0" })).toBe("1 fusión en 9.0 s");
    expect(format("en", "SpiralGlass", "canvasTimeoutSub", { tiles: 1 })).toBe("1 tile left");
    expect(format("es", "SpiralGlass", "canvasTimeoutSub", { tiles: 1 })).toBe("Queda 1 loseta");
    expect(format("es", "SpiralGlass", "canvasTimeoutSub", { tiles: 22 })).toBe("Quedan 22 losetas");
    expect(format("en", "Journey", "canvasHomeSub", { stages: 1, seconds: "12.0" })).toBe("1 stage in 12.0s");
    expect(format("en", "Journey", "canvasHomeSubScore", { stages: 5, seconds: "31.4", score: 40 })).toBe("5 stages in 31.4s · 40 pts");
    expect(format("en", "Vortex", "canvasDoneSub", { balls: 1, notes: 1 })).toBe("1 ball swallowed · 1 note");
    expect(format("es", "Vortex", "canvasDoneSub", { balls: 12, notes: 30 })).toBe("12 bolas tragadas · 30 notas");
    // none of them is left with a bracket placeholder the page no longer fills
    for (const [namespace, key] of [["Simulator", "canvasMpMadeItHome"], ["Simulator", "canvasMpMadeItHomeSub"], ["Simulator", "canvasMpMadeItHomeLost"], ["Simulator", "canvasBallsAtRest"], ["Simulator", "canvasBoxCounted"], ["Simulator", "canvasDpPlucks"], ["Simulator", "canvasDpHits"], ["Simulator", "canvasPlFreedomSub"], ["MergeRing", "canvasFinalSub"], ["MergeRing", "canvasOverflowSub"], ["SpiralGlass", "canvasTimeoutSub"], ["Journey", "canvasHomeSub"], ["Journey", "canvasHomeSubScore"], ["Vortex", "canvasDoneSub"]] as const) {
      for (const locale of ["en", "pl", "es"]) expect(String(CATALOGS[locale][namespace][key]), `${locale} ${namespace}.${key}`).not.toMatch(/\[[a-z]+\]/);
    }
  });
});
