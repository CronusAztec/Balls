import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { MODE_IDS, type ModeId } from "@/lib/physics/types";
import { MODE_CARD_ORDER } from "@/lib/modes";
import { defaultSettings, settingsFromSearchParams } from "@/lib/settings";
import { HERO_BAND_SHARE, HERO_BASE_QUERY, HERO_MOMENTS, HERO_PAYOFF_LAG_SEC, HERO_TAIL_SEC, heroMomentSec, heroQuery, missingHeroModes } from "@/lib/thumbnails/heroMoments";
import {
  HERO_WORLD,
  THUMB_CSS_SIZE,
  THUMB_INSET,
  THUMB_MAX_BYTES,
  THUMB_QUALITIES,
  THUMB_SIZE,
  backdropOf,
  dataUrlBytes,
  encodeUnderBudget,
  heroRenderScale,
  heroSourceRect,
  heroSubjectRect,
  tintRgba,
} from "@/lib/thumbnails/heroFrame";
import { STILL_MAX_SEC, stillFrameIndex, stillSchedule } from "@/lib/thumbnails/stillRender";
import { coverFrameOf } from "@/lib/bot/cover";
import { batchTextFiles, buildManifest, captionFileText, coverText, scheduleMarkdown } from "@/lib/bot/output";
import { planDay, type ClipPlan } from "@/lib/bot/planner";
import type { BotCopy } from "@/lib/bot/copy";

/*
 * --- mode-thumbnails --- The mode cards' pictures: the hero table (a moment for every mode, links that do what they say), the
 * shared frame (square, inset, budget), the still schedule, the pictures on disk (WebP, THUMB_SIZE square, under the budget –
 * the smoke test checks them again as served) and the viral bot's covers (the clip's hero moment, not its first frame).
 */

const ROOT = path.resolve(__dirname, "..");
const table = HERO_MOMENTS as Readonly<Record<string, (typeof HERO_MOMENTS)[ModeId] | undefined>>;
const copy = en.ViralBot as BotCopy;

/** The pairs of a query string (`a=1&b=2`), decoded. */
const pairs = (query: string) => [...new URLSearchParams(query).entries()];

describe("the hero table", () => {
  it("has a hero moment for every mode of MODE_IDS – every mode card – and nothing else", () => {
    expect(missingHeroModes()).toEqual([]);
    expect(Object.keys(HERO_MOMENTS).sort()).toEqual([...MODE_IDS].sort());
    for (const id of MODE_CARD_ORDER) expect(table[id], id).toBeDefined();
  });

  it("names the modes a table lacks, and the query of a mode without one throws", () => {
    expect(missingHeroModes({ classic: HERO_MOMENTS.classic }, ["classic", "drop", "maze"])).toEqual(["drop", "maze"]);
    expect(() => heroQuery("drop", {})).toThrow(/HERO_MOMENTS/);
  });

  it("every entry is complete: one-line moment, whole seed, a second of the run, a camera inside the world, a colour", () => {
    for (const id of MODE_IDS) {
      const e = HERO_MOMENTS[id];
      expect(e.moment.trim().length, id).toBeGreaterThan(10);
      expect(e.moment, id).not.toMatch(/\n/);
      expect(Number.isInteger(e.seed) && e.seed >= 0, `${id} seed`).toBe(true);
      expect(e.atSec > 0 && e.atSec <= STILL_MAX_SEC, `${id} atSec ${e.atSec}`).toBe(true);
      expect(e.tint, id).toMatch(/^#[0-9a-f]{6}$/i);
      const c = e.camera ?? {};
      for (const v of [c.x ?? 0.5, c.y ?? 0.5]) expect(v >= 0 && v <= 1, `${id} camera`).toBe(true);
      expect((c.zoom ?? 1) >= 1, `${id} zoom`).toBe(true);
      // the subject stays on the stage
      const subject = heroSubjectRect(HERO_WORLD, c);
      expect(subject.x + subject.side / 2 >= 0 && subject.x + subject.side / 2 <= HERO_WORLD.width, `${id} centre x`).toBe(true);
      expect(subject.y + subject.side / 2 >= 0 && subject.y + subject.side / 2 <= HERO_WORLD.height, `${id} centre y`).toBe(true);
    }
  });

  it("every link opens its own mode with the shared look and its seed – no caption, top text or watermark", () => {
    for (const id of MODE_IDS) {
      const e = HERO_MOMENTS[id];
      const own = pairs(e.query).map(([k]) => k);
      for (const banned of ["mode", "seed", "cap", "top", "bottom", ...pairs(HERO_BASE_QUERY).map(([k]) => k)]) expect(own, `${id} sets ${banned}`).not.toContain(banned);
      expect(pairs(e.query).find(([k]) => k === "wm")?.[1] ?? "", `${id} watermark`).toBe("");
      const query = heroQuery(id);
      const params = new URLSearchParams(query);
      expect(params.get("mode"), id).toBe(id);
      expect(params.get("seed"), id).toBe(String(e.seed));
      const s = settingsFromSearchParams(params);
      expect(s.mode, id).toBe(id);
      expect(s.showGlow, `${id} glow`).toBe(true);
      expect(s.showTrails, `${id} trails`).toBe(true);
      expect(s.watermarkText, id).toBe("");
      expect(s.topText + s.bottomText, id).toBe("");
      expect(s.captions ?? [], id).toEqual([]);
    }
    expect(HERO_BASE_QUERY).toContain("glow=1");
    expect(HERO_BASE_QUERY).toContain("trails=1");
  });

  it("every key of an entry's own settings changes the mode's run (no typo, no no-op)", () => {
    for (const id of MODE_IDS) {
      const plain = settingsFromSearchParams(new URLSearchParams(`mode=${id}`));
      for (const [key, value] of pairs(HERO_MOMENTS[id].query)) {
        const one = new URLSearchParams(`mode=${id}`);
        one.set(key, value);
        expect(settingsFromSearchParams(one), `${id}: ${key}=${value} changes nothing`).not.toEqual(plain);
      }
    }
  });

  it("keeps every mode's defaults as they were (the table only reads them)", () => {
    for (const id of MODE_IDS) expect(settingsFromSearchParams(new URLSearchParams(`mode=${id}`)).mode).toBe(defaultSettings(id).mode);
  });

  it("the README's hero table lists every mode once, with the moment, seed and second of its entry", () => {
    const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
    const start = readme.indexOf("\n### Mode thumbnails\n");
    expect(start).toBeGreaterThan(0);
    const section = readme.slice(start + 1, readme.indexOf("\n## ", start + 1) > 0 ? readme.indexOf("\n## ", start + 1) : undefined);
    const rows = section.split("\n").filter((line) => /^\| `[A-Za-z]+` \|/.test(line));
    expect(rows.map((row) => /^\| `([A-Za-z]+)`/.exec(row)?.[1]).sort()).toEqual([...MODE_IDS].sort());
    for (const id of MODE_IDS) {
      const e = HERO_MOMENTS[id];
      const cells = rows.find((row) => row.startsWith(`| \`${id}\` |`))!.split(" | ");
      expect(cells[1], `${id} moment`).toBe(e.moment);
      expect(cells[2], `${id} seed`).toBe(String(e.seed));
      expect(cells[3], `${id} second`).toBe(`${e.atSec} s`);
    }
  });
});

describe("the shared frame", () => {
  it("is a 2× square of the cards with a budget of 60 KB", () => {
    expect(THUMB_SIZE).toBe(2 * THUMB_CSS_SIZE);
    expect(THUMB_MAX_BYTES).toBe(60_000);
    expect(THUMB_QUALITIES.every((q, i) => q > 0 && q <= 1 && (i === 0 || q < THUMB_QUALITIES[i - 1]))).toBe(true);
  });

  it("frames the centred square of the world by default – what a clip records – with the same inset on every side", () => {
    const subject = heroSubjectRect(HERO_WORLD);
    expect(subject).toEqual({ x: 175, y: 0, side: 450 });
    const source = heroSourceRect(HERO_WORLD);
    expect(source.side).toBeCloseTo(450 / (1 - 2 * THUMB_INSET), 6);
    // wider than the 450 px tall world: centred on it (the backdrop past its top and bottom), inside it across
    expect(source.y).toBeCloseTo((450 - source.side) / 2, 6);
    expect(source.x + source.side / 2).toBeCloseTo(400, 6);
    // the subject sits exactly THUMB_INSET of the picture inside every edge
    expect((subject.x - source.x) / source.side).toBeCloseTo(THUMB_INSET, 6);
    expect((source.x + source.side - subject.x - subject.side) / source.side).toBeCloseTo(THUMB_INSET, 6);
  });

  it("a zoomed camera frames exactly where it points, the margin past the world's edge showing the backdrop", () => {
    const camera = { x: 0.5, y: 0.02, zoom: 3 };
    const subject = heroSubjectRect(HERO_WORLD, camera);
    expect(subject).toEqual({ x: 325, y: -66, side: 150 });
    const source = heroSourceRect(HERO_WORLD, camera);
    expect(source.side).toBeCloseTo(150 / (1 - 2 * THUMB_INSET), 6);
    expect(source.x + source.side / 2).toBeCloseTo(400, 6);
    expect(source.y + source.side / 2).toBeCloseTo(9, 6);
    expect(source.y).toBeLessThan(0);
    expect((subject.y - source.y) / source.side).toBeCloseTo(THUMB_INSET, 6);
    const odd = heroSubjectRect(HERO_WORLD, { zoom: 0.5, x: Number.NaN });
    expect(odd).toEqual({ x: 175, y: 0, side: 450 });
  });

  it("supersamples at 2–6 device px per world px and reads colours safely", () => {
    expect(heroRenderScale(489)).toBe(2);
    expect(heroRenderScale(200)).toBeGreaterThanOrEqual((2 * THUMB_SIZE) / 200);
    expect(heroRenderScale(10)).toBe(6);
    expect(tintRgba("#93d119", 0.5)).toBe("rgba(147, 209, 25, 0.5)");
    expect(tintRgba("#fff", 2)).toBe("rgba(255, 255, 255, 1)");
    expect(tintRgba("nope", 0.1)).toBe("rgba(147, 209, 25, 0.1)");
    expect(backdropOf([[30, 30, 30, 255], [10, 11, 12, 255], [200, 0, 0, 255], [11, 11, 11, 255]])).toBe("rgb(10, 11, 12)");
    expect(backdropOf([])).toBe("#000000");
  });

  it("steps the WebP quality down until the picture is under the budget, and refuses a browser without WebP", () => {
    const fake = (bytesAt: (q: number) => number, type = "image/webp") => ({
      tried: [] as number[],
      toDataURL(t?: string, q?: number) {
        this.tried.push(q ?? 1);
        return `data:${t === "image/webp" ? type : t};base64,${"A".repeat(Math.ceil((bytesAt(q ?? 1) * 4) / 3))}`;
      },
    });
    const canvas = fake((q) => Math.round(100_000 * q));
    const picked = encodeUnderBudget(canvas);
    expect(picked?.bytes).toBeLessThan(THUMB_MAX_BYTES);
    expect(picked?.quality).toBe(0.58);
    expect(canvas.tried).toEqual(THUMB_QUALITIES.slice(0, THUMB_QUALITIES.indexOf(0.58) + 1));
    expect(encodeUnderBudget(fake(() => 90_000))).toBeNull();
    expect(encodeUnderBudget(fake(() => 10, "image/png"))).toBeNull();
    expect(dataUrlBytes("data:image/webp;base64,QUJD")).toBe(3);
    expect(dataUrlBytes("data:image/webp;base64,QUI=")).toBe(2);
    expect(dataUrlBytes("nonsense")).toBe(0);
  });
});

describe("the still schedule", () => {
  it("turns seconds into the 60 Hz frames that show them, ascending and once each", () => {
    expect(stillFrameIndex(0)).toBe(0);
    expect(stillFrameIndex(1)).toBe(60);
    expect(stillFrameIndex(5.65)).toBe(339);
    expect(stillFrameIndex(-3)).toBe(0);
    expect(stillSchedule([2, 1, 1.004, -1, Number.NaN, 0.5])).toEqual([
      { frame: 30, sec: 0.5 },
      { frame: 60, sec: 1 },
      { frame: 61, sec: 1.004 },
      { frame: 120, sec: 2 },
    ]);
  });
});

/** The width and height in a WebP file's header (lossy VP8, lossless VP8L or extended VP8X), or null. */
function webpSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 30 || buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buf.toString("ascii", 12, 16);
  if (chunk === "VP8 ") return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (chunk === "VP8L") {
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  return null;
}

describe("the card pictures (public/modes)", () => {
  it("every mode has its picture: a WebP square of THUMB_SIZE under the byte budget", () => {
    for (const id of MODE_IDS) {
      const file = path.join(ROOT, "public", "modes", `${id}.webp`);
      expect(fs.existsSync(file), `${id}.webp exists`).toBe(true);
      const buf = fs.readFileSync(file);
      expect(buf.length, `${id}.webp bytes`).toBeLessThan(THUMB_MAX_BYTES);
      expect(webpSize(buf), `${id}.webp size`).toEqual({ width: THUMB_SIZE, height: THUMB_SIZE });
    }
  });
});

describe("a clip's hero moment", () => {
  it("is the payoff on screen when it comes inside the clip", () => {
    expect(heroMomentSec({ mode: "classic", clipSec: 20, payoffSec: 16 })).toEqual({ sec: 16 + HERO_PAYOFF_LAG_SEC, source: "payoff" });
    // never in the clip's last moments
    expect(heroMomentSec({ mode: "classic", clipSec: 20, payoffSec: 19.9 })).toEqual({ sec: 20 - HERO_TAIL_SEC, source: "payoff" });
  });

  it("is the last moment before the cut of a cliffhanger", () => {
    expect(heroMomentSec({ mode: "maze", clipSec: 14, payoffSec: 14.7, cutGapSec: 0.7 })).toEqual({ sec: 14 - HERO_TAIL_SEC, source: "cut" });
    expect(heroMomentSec({ mode: "maze", clipSec: 14, payoffSec: 22 })).toEqual({ sec: 14 - HERO_TAIL_SEC, source: "cut" });
  });

  it("without a payoff, the mode's card second when the clip reaches it, else late in the clip", () => {
    const card = HERO_MOMENTS.pendulum.atSec;
    expect(heroMomentSec({ mode: "pendulum", clipSec: card + 10, payoffSec: null })).toEqual({ sec: card, source: "card" });
    expect(heroMomentSec({ mode: "nope", clipSec: 10, payoffSec: null })).toEqual({ sec: HERO_BAND_SHARE * 10, source: "band" });
    expect(heroMomentSec({ mode: "classic", clipSec: 0, payoffSec: null }).sec).toBe(0);
  });
});

describe("the viral bot's covers", () => {
  const plan = (patch: { payoffSec: number | null; clipSec: number; cutGapSec?: number | null; mode?: ClipPlan["mode"] }) =>
    ({ mode: patch.mode ?? "classic", payoff: { atSec: patch.payoffSec, cutGapSec: patch.cutGapSec ?? null }, timing: { clipSec: patch.clipSec } }) as unknown as Pick<ClipPlan, "mode" | "payoff" | "timing">;

  it("takes the clip's payoff frame, not its first frame", () => {
    const cover = coverFrameOf(plan({ payoffSec: 17.2, clipSec: 20 }));
    expect(cover).toEqual({ atSec: 17.45, ms: 17450, source: "payoff" });
    expect(cover.ms).toBeGreaterThan(0);
  });

  it("stays inside the rendered clip, which can be shorter than planned", () => {
    expect(coverFrameOf(plan({ payoffSec: 17.2, clipSec: 20 }), 15)).toEqual({ atSec: 14.5, ms: 14500, source: "cut" });
    expect(coverFrameOf(plan({ payoffSec: 9, clipSec: 20 }), 15).source).toBe("payoff");
  });

  it("a cliffhanger's cover is its last moment before the cut; a clip without a payoff the mode's own hero second", () => {
    expect(coverFrameOf(plan({ payoffSec: 12.8, clipSec: 12, cutGapSec: 0.8 }))).toEqual({ atSec: 11.5, ms: 11500, source: "cut" });
    expect(coverFrameOf(plan({ payoffSec: null, clipSec: 30, mode: "orbGrid" })).atSec).toBe(HERO_MOMENTS.orbGrid.atSec);
  });

  it("every planned clip gets one inside its length; the manifest, the caption file and the schedule carry it", () => {
    const day = planDay("2026-10-04", "reels", 4, { copy, search: false });
    const rendered = [{ id: day.clips[0].id, status: "done" as const, file: `${day.clips[0].id}.mp4`, durationSec: 12.5, bytes: 1 }];
    const manifest = buildManifest(day.clips, copy, { date: day.date, platform: "reels", locale: "en" }, rendered);
    day.clips.forEach((p, i) => {
      const cover = manifest.clips[i].cover;
      const length = i === 0 ? 12.5 : p.timing.clipSec;
      expect(cover.atSec, p.id).toBeGreaterThan(0);
      expect(cover.atSec, p.id).toBeLessThanOrEqual(length - HERO_TAIL_SEC + 1e-9);
      expect(cover.ms).toBe(Math.round(cover.atSec * 1000));
      expect(captionFileText(p, copy, i === 0 ? 12.5 : null)).toContain(`Cover: ${coverText(cover, copy)}`);
    });
    const md = scheduleMarkdown(day.clips, copy, { date: day.date, platform: "reels" }, rendered);
    expect(md).toContain("## Covers");
    expect(md).toContain(`- **1.** ${coverText(manifest.clips[0].cover, copy)}`);
    const files = batchTextFiles(day.clips, copy, { date: day.date, platform: "reels", locale: "en" }, rendered);
    expect(files.find((f) => f.name === `${day.clips[0].id}.txt`)?.text).toContain(coverText(manifest.clips[0].cover, copy));
    expect(coverText({ atSec: 12.4, ms: 12400, source: "payoff" }, copy)).toBe("12.4 s – the payoff on screen");
  });

  it("is worded in every language, and the manual steps no longer say to pick a frame near the start", () => {
    const shape = (v: unknown): unknown => (v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)])) : typeof v);
    const covers = [en, pl, es].map((m) => (m.ViralBot as Record<string, unknown>).cover);
    expect(shape(covers[1])).toEqual(shape(covers[0]));
    expect(shape(covers[2])).toEqual(shape(covers[0]));
    for (const m of [en, pl, es]) {
      const cover = (m.ViralBot as { cover: { at: string; sources: Record<string, string> } }).cover;
      expect(cover.at).toContain("{sec}");
      expect(cover.at).toContain("{why}");
      expect(Object.keys(cover.sources).sort()).toEqual(["band", "card", "cut", "payoff"]);
    }
    expect(en.ViralBot.manual.steps).not.toMatch(/near the start/);
    expect(pl.ViralBot.manual.steps).not.toMatch(/z początku/);
    expect(es.ViralBot.manual.steps).not.toMatch(/del principio/);
  });
});
