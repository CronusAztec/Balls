// --- clip-editor --- The post-export cut (lib/clipEdit): the spec and its storage, the output timeline, the crop and the
// frame compositor – which stamps every frame with the run's seal, last.
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { CARD_FADE_SEC, CLIP_EDIT_OUTPUT, CLIP_EDIT_STORAGE_KEY, CLIP_EDIT_TEXT_MAX, DEFAULT_CLIP_EDIT, TEXT_MAX_SHARE, TEXT_MIN_SCALE, audioGainAt, cardAlphaAt, clipTimeline, cropRect, editFileName, fitClipEdit, fitTextLines, hookLayout, loadClipEdit, localClipEdit, parseClipEdit, saveClipEdit, sourceTimeAt, type ClipEditSpec } from "@/lib/clipEdit/spec";
import { drawEditFrame, fanMadeLine } from "@/lib/clipEdit/draw";
import { BADGE_HEIGHT, BADGE_INSET } from "@/lib/watermark/layout";
import { ClipEditOpenError, ClipEditSeekError, clipEditErrorKey, cutAudio, liveProgress, openSourceVideo, seekVideo } from "@/lib/clipEdit/render";
import { libraryEditOpen, refitClipEdit, type LibraryEditItem } from "@/lib/clipEdit/propose";
import { FastRenderUnsupportedError } from "@/lib/recording/fastRender";
import { sealWatermark } from "@/lib/watermark/seal";
import { fakeCanvas, fakeDocument, type FakeCall } from "./fakeCanvas";

const ROOT = path.join(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

describe("the clip edit spec", () => {
  it("defaults, floors and trims whatever it is given, and never caps a number at its slider's end (uncap-all)", () => {
    expect(parseClipEdit(null)).toEqual(DEFAULT_CLIP_EDIT);
    const s = parseClipEdit({ startSec: -4, lengthSec: 999, zoom: "1.5", hook: "x".repeat(100), url: 7, cardSec: 2 });
    expect(s.startSec).toBe(0);
    expect(s.lengthSec).toBe(999);
    expect(parseClipEdit({ zoom: 0.2, lengthSec: 1 })).toMatchObject({ zoom: 1, lengthSec: 3 });
    expect(s.zoom).toBe(1.5);
    expect(s.hook).toHaveLength(60);
    expect(s.url).toBe(DEFAULT_CLIP_EDIT.url);
    expect(s.cardSec).toBe(2);
  });

  it("fits the cut to the source: it starts a second before the end at the latest and never runs past it", () => {
    const d = DEFAULT_CLIP_EDIT;
    expect(fitClipEdit(d, 23)).toEqual(d);
    expect(fitClipEdit({ ...d, startSec: 30 }, 23)).toMatchObject({ startSec: 22, lengthSec: 1 });
    expect(fitClipEdit({ ...d, startSec: 3, lengthSec: 11 }, 8)).toMatchObject({ startSec: 3, lengthSec: 5 });
    expect(fitClipEdit(d, NaN)).toEqual(d);
  });

  it("round-trips through storage and survives junk there", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(loadClipEdit(storage)).toEqual(DEFAULT_CLIP_EDIT);
    saveClipEdit({ ...DEFAULT_CLIP_EDIT, hook: "Red or blue?", zoom: 1.4 }, storage);
    expect(store.has(CLIP_EDIT_STORAGE_KEY)).toBe(true);
    expect(loadClipEdit(storage)).toMatchObject({ hook: "Red or blue?", zoom: 1.4 });
    store.set(CLIP_EDIT_STORAGE_KEY, "{nope");
    expect(loadClipEdit(storage)).toEqual(DEFAULT_CLIP_EDIT);
  });

  // --- clip-locale --- a first cut's hook is in the page's language; what the user stored wins over it
  it("starts a first cut with the hook in the page's language, and keeps what the user stored", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const pl = localClipEdit("Czy ucieknie?");
    expect(pl).toEqual({ ...DEFAULT_CLIP_EDIT, hook: "Czy ucieknie?" });
    expect(localClipEdit("")).toEqual(DEFAULT_CLIP_EDIT);
    expect(localClipEdit("y".repeat(99)).hook).toHaveLength(CLIP_EDIT_TEXT_MAX);
    expect(loadClipEdit(storage, pl).hook).toBe("Czy ucieknie?");
    expect(loadClipEdit(null, pl).hook).toBe("Czy ucieknie?");
    store.set(CLIP_EDIT_STORAGE_KEY, "{nope");
    expect(loadClipEdit(storage, pl).hook).toBe("Czy ucieknie?");
    saveClipEdit({ ...DEFAULT_CLIP_EDIT, hook: "" }, storage); // no hook is a choice: it stays empty
    expect(loadClipEdit(storage, pl).hook).toBe("");
    // a stored spec of an older build without a hook takes the page's one too
    store.set(CLIP_EDIT_STORAGE_KEY, JSON.stringify({ zoom: 1.4 }));
    expect(loadClipEdit(storage, pl)).toMatchObject({ zoom: 1.4, hook: "Czy ucieknie?" });
    for (const loc of ["en", "es", "pl"]) {
      const ideas = (JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: { ideas: { escape: string } } }).ClipEditor.ideas;
      expect(localClipEdit(ideas.escape).hook, loc).toBe(ideas.escape);
    }
    expect((JSON.parse(read("messages/en.json")) as { ClipEditor: { ideas: { escape: string } } }).ClipEditor.ideas.escape).toBe(DEFAULT_CLIP_EDIT.hook);
    // the dialog and the AI's cuts start from it; the Library's "Suggest with AI" hands the dialog's own spec as the base
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).toMatch(/const defaults = localClipEdit\(t\("ideas\.escape"\)\);\s+return parseClipEdit\(\{ \.\.\.loadClipEdit\(undefined, defaults\), \.\.\.initialSpec \}, defaults\);/);
    const section = read("src/components/simulator/sections/DesktopSection.tsx");
    expect(section).toMatch(/const base = loadClipEdit\(undefined, localClipEdit\(editor\("ideas\.escape"\)\)\);/);
    expect(section).not.toMatch(/loadClipEdit\(\)/);
    expect(section).toMatch(/suggestCut\(bridge, [^\n]*parseClipEdit\(input\.current\)/);
  });

  it("names the file after its source", () => {
    expect(editFileName("jumpingballslive-export.mp4")).toBe("jumpingballslive-export-tiktok.mp4");
    expect(editFileName("clip.webm", "webm")).toBe("clip-tiktok.webm");
    // a TikTok render is already named so: its cut is "-cut", never "-tiktok-tiktok"
    expect(editFileName("Pip-tiktok.mp4")).toBe("Pip-tiktok-cut.mp4");
    expect(editFileName("")).toBe("jumpingballslive-clip-tiktok.mp4");
  });
});

describe("the output timeline", () => {
  const spec = { ...DEFAULT_CLIP_EDIT, startSec: 3, lengthSec: 11, cardSec: 1.5 };
  const tl = clipTimeline(spec, 30);

  it("is the action then the card, the fade over the action's last moments", () => {
    expect(tl).toMatchObject({ actionSec: 11, cardSec: 1.5, totalSec: 12.5, frames: 375 });
    expect(tl.fadeStartSec).toBeCloseTo(11 - CARD_FADE_SEC);
    expect(cardAlphaAt(tl, 0)).toBe(0);
    expect(cardAlphaAt(tl, 10.5)).toBe(0);
    expect(cardAlphaAt(tl, 11 - CARD_FADE_SEC / 2)).toBeCloseTo(0.5);
    expect(cardAlphaAt(tl, 11)).toBe(1);
    expect(cardAlphaAt(tl, 12.4)).toBe(1);
  });

  it("has no card and no fade when the card is off", () => {
    const none = clipTimeline({ ...spec, cardSec: 0 }, 30);
    expect(none).toMatchObject({ totalSec: 11, fadeStartSec: 11, frames: 330 });
    expect(cardAlphaAt(none, 10.99)).toBe(0);
  });

  it("plays the source from the start of the cut and holds its last frame under the card", () => {
    expect(sourceTimeAt(spec, 0)).toBe(3);
    expect(sourceTimeAt(spec, 5)).toBe(8);
    expect(sourceTimeAt(spec, 12)).toBe(14);
  });

  it("fades the sound out under the end of the action and keeps the card silent", () => {
    expect(audioGainAt(tl, 0)).toBe(1);
    expect(audioGainAt(tl, 10)).toBe(1);
    expect(audioGainAt(tl, 10.7)).toBeCloseTo(0.5);
    expect(audioGainAt(tl, 11)).toBe(0);
    expect(audioGainAt(tl, 12)).toBe(0);
  });

  it("cuts the decoded sound at the start of the cut and pads it under the card", () => {
    const rate = 100;
    const src = new Float32Array(30 * rate).fill(0.5);
    const decoded = { numberOfChannels: 1, getChannelData: () => src } as unknown as AudioBuffer;
    const out = cutAudio(decoded, spec, tl, rate);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(1250);
    expect(out[0][0]).toBe(0.5);
    expect(out[1][500]).toBe(0.5);
    expect(out[0][1099]).toBeLessThan(0.05);
    expect(out[0][1200]).toBe(0);
    // a source without sound gives silence of the right length
    expect(cutAudio(null, spec, tl, rate)[0]).toHaveLength(1250);
  });
});

describe("the frame geometry", () => {
  it("crops the centred 9:16 window of the source and shrinks it by the zoom", () => {
    const whole = cropRect(1080, 1920, 1);
    expect(whole).toEqual({ sx: 0, sy: 0, sw: 1080, sh: 1920 });
    const landscape = cropRect(1920, 1080, 1);
    expect(landscape.sh).toBe(1080);
    expect(landscape.sw).toBeCloseTo(607.5);
    expect(landscape.sx).toBeCloseTo((1920 - 607.5) / 2);
    const zoomed = cropRect(1080, 1920, 1.25);
    expect(zoomed.sw).toBe(864);
    expect(zoomed.sh).toBe(1536);
    expect(zoomed.sx).toBe(108);
    expect(zoomed.sy).toBe(192);
  });

  it("puts the hook in the top band, under a phone's status bar, the address under it", () => {
    const l = hookLayout();
    expect(l.hookY).toBeGreaterThan(0.08 * CLIP_EDIT_OUTPUT.height);
    expect(l.urlY).toBeGreaterThan(l.hookY + l.hookFont);
    expect(l.hookFont).toBeGreaterThan(l.urlFont);
  });

  // --- clip-fit --- the bot's caption rule: wrap onto the lines allowed, shrink until they fit, squeeze only past the floor
  it("fits text to a width: wraps first, shrinks when the lines run out, never past its floor", () => {
    const measure = (line: string, size: number) => 0.5 * line.length * size;
    expect(fitTextLines("Will it escape?", 78, 888, 2, measure)).toEqual({ lines: ["Will it escape?"], size: 78 });
    const two = fitTextLines("Wait for the very last bounce of all", 78, 888, 2, measure);
    expect(two.size).toBe(78);
    expect(two.lines).toHaveLength(2);
    expect(two.lines.join(" ")).toBe("Wait for the very last bounce of all");
    for (const l of two.lines) expect(measure(l, two.size)).toBeLessThanOrEqual(888);
    const long = "It grows every bounce. Watch it fill the ring. And then some more.";
    const shrunk = fitTextLines(long, 78, 888, 2, measure);
    expect(shrunk.size).toBeLessThan(78);
    expect(shrunk.size).toBeGreaterThanOrEqual(Math.round(TEXT_MIN_SCALE * 78));
    expect(shrunk.lines).toHaveLength(2);
    for (const l of shrunk.lines) expect(measure(l, shrunk.size)).toBeLessThanOrEqual(888);
    // one line allowed (an address): only shrinking; a word wider than the floor allows keeps its words for the squeeze
    const one = fitTextLines("x".repeat(60), 43, 400, 1, measure);
    expect(one).toEqual({ lines: ["x".repeat(60)], size: Math.round(TEXT_MIN_SCALE * 43) });
    expect(fitTextLines("a b c d e f g h", 100, 120, 2, measure).lines.join(" ")).toBe("a b c d e f g h");
    expect(fitTextLines("   ", 78, 888, 2, measure).lines).toEqual([]);
  });
});

describe("the frame compositor", () => {
  afterEach(() => vi.unstubAllGlobals());

  const drawFull = async (tSec: number, spec: ClipEditSpec = DEFAULT_CLIP_EDIT, options: { fanMade?: string | null; source?: { width: number; height: number }; card?: { title: string; note: string } } = {}) => {
    vi.stubGlobal("document", fakeDocument());
    const seal = await sealWatermark();
    const canvas = fakeCanvas(1080, 1920);
    const src = options.source ?? { width: 1080, height: 1920 };
    const source = fakeCanvas(src.width, src.height);
    // every line as drawn: its text, where, the font size it was set at and the squeeze limit it was given
    const lines: { text: string; x: number; y: number; size: number; maxWidth: number | undefined; index: number }[] = [];
    const fill = canvas.ctx.fillText as (...args: unknown[]) => void;
    canvas.ctx.fillText = (...args: unknown[]) => {
      lines.push({ text: String(args[0]), x: Number(args[1]), y: Number(args[2]), size: Number(/(\d+(?:\.\d+)?)px/.exec(canvas.ctx.font)?.[1]), maxWidth: args[3] as number | undefined, index: canvas.ctx.calls.length });
      fill(...args);
    };
    const tl = clipTimeline(spec, 30);
    drawEditFrame(canvas.ctx as unknown as CanvasRenderingContext2D, { image: source as unknown as CanvasImageSource, ...src }, 1080, 1920, spec, tl, tSec, options.card ?? { title: "Make your own", note: "free" }, { seal, clipMs: tSec * 1000, fanMade: options.fanMade ?? null });
    return { calls: canvas.ctx.calls, lines };
  };
  const draw = async (tSec: number, spec: ClipEditSpec = DEFAULT_CLIP_EDIT) => (await drawFull(tSec, spec)).calls;
  /** A drawn line's width as the fake canvas measures it (0.56 em a character), squeezed to its limit when it has one. */
  const lineWidth = (l: { text: string; size: number; maxWidth: number | undefined }) => Math.min(0.56 * l.text.length * l.size, l.maxWidth ?? Infinity);
  const inside = (l: { text: string; x: number; size: number; maxWidth: number | undefined }) => l.x - lineWidth(l) / 2 >= 0 && l.x + lineWidth(l) / 2 <= 1080;
  const texts = (calls: FakeCall[]) => calls.filter((c) => c.name === "fillText").map((c) => String(c.args[0]));
  const sourceDraw = (calls: FakeCall[]) => calls.find((c) => c.name === "drawImage" && (c.args[0] as { width?: number }).width === 1080);

  it("draws the zoomed window of the source over the whole frame, then the hook and the address", async () => {
    const calls = await draw(2);
    const d = sourceDraw(calls);
    expect(d?.args.slice(1)).toEqual([108, 192, 864, 1536, 0, 0, 1080, 1920]);
    expect(texts(calls)).toContain("Will it escape?");
    expect(texts(calls)).toContain(DEFAULT_CLIP_EDIT.url);
    expect(texts(calls)).not.toContain("Make your own");
  });

  it("shows the end card after the action, the address on it", async () => {
    const calls = await draw(DEFAULT_CLIP_EDIT.lengthSec + 0.5);
    expect(texts(calls)).toContain("Make your own");
    expect(texts(calls).filter((x) => x === DEFAULT_CLIP_EDIT.url)).toHaveLength(2);
  });

  it("draws nothing at the top when the hook and the address are empty", async () => {
    const calls = await draw(1, { ...DEFAULT_CLIP_EDIT, hook: "  ", url: "" });
    expect(texts(calls).filter((x) => !/jumpingballslive/i.test(x))).toEqual([]);
  });

  // --- clip-fit --- the AI's cuts take the plan's hook (up to 60 characters): a recipe hook of 46 is twice the frame on one line at 78 px
  it("keeps a long hook inside the frame: two lines at most, shrunk to fit, the pill around them", async () => {
    const hook = "It grows every bounce. Watch it fill the ring.";
    expect(hook).toHaveLength(46);
    const { calls, lines } = await drawFull(2, { ...DEFAULT_CLIP_EDIT, hook });
    const hookLines = lines.filter((l) => hook.includes(l.text) && l.text !== DEFAULT_CLIP_EDIT.url);
    expect(hookLines.length).toBeGreaterThanOrEqual(1);
    expect(hookLines.length).toBeLessThanOrEqual(2);
    expect(hookLines.map((l) => l.text).join(" ")).toBe(hook);
    for (const l of hookLines) {
      expect(inside(l), l.text).toBe(true);
      expect(lineWidth(l)).toBeLessThanOrEqual(TEXT_MAX_SHARE * 1080);
      expect(l.size).toBeLessThanOrEqual(hookLayout().hookFont);
      expect(l.size).toBeGreaterThanOrEqual(Math.round(TEXT_MIN_SCALE * hookLayout().hookFont));
    }
    if (hookLines.length === 2) expect(hookLines[1].y).toBeGreaterThan(hookLines[0].y + hookLines[0].size);
    // the pill holds the lines and stays inside the frame; the address pill goes under it
    const boxes = calls.filter((c) => c.name === "roundRect").map((c) => c.args as number[]);
    expect(boxes.length).toBeGreaterThanOrEqual(2);
    for (const [x, , w] of boxes) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + w).toBeLessThanOrEqual(1080);
    }
    const [hx, hy, hw, hh] = boxes[0];
    for (const l of hookLines) {
      expect(l.x - lineWidth(l) / 2).toBeGreaterThanOrEqual(hx);
      expect(l.x + lineWidth(l) / 2).toBeLessThanOrEqual(hx + hw);
      expect(l.y).toBeGreaterThan(hy);
      expect(l.y).toBeLessThan(hy + hh);
    }
    expect(boxes[1][1]).toBeGreaterThanOrEqual(hy + hh);
    // the default hook and the Polish idea the editor offers: one line each, the Polish one inside the frame too
    for (const short of ["Will it escape?", "Poczekaj na ostatnie odbicie"]) {
      const drawn = (await drawFull(2, { ...DEFAULT_CLIP_EDIT, hook: short })).lines.filter((l) => short.includes(l.text));
      expect(drawn.map((l) => l.text).join(" ")).toBe(short);
      for (const l of drawn) expect(inside(l), short).toBe(true);
    }
    expect((await drawFull(2, { ...DEFAULT_CLIP_EDIT, hook: "Will it escape?" })).lines.find((l) => l.text === "Will it escape?")?.size).toBe(hookLayout().hookFont);
  });

  it("keeps a long address inside the frame, at the top and on the end card, and the card's own words too", async () => {
    const url = "a-very-long-channel-name-for-ball-videos.example.com/watch";
    const top = (await drawFull(2, { ...DEFAULT_CLIP_EDIT, url })).lines.filter((l) => l.text === url);
    expect(top).toHaveLength(1);
    expect(inside(top[0])).toBe(true);
    const card = { title: "Zrób własną symulację i wrzuć ją na swój kanał", note: "za darmo, w przeglądarce, bez konta i bez instalowania czegokolwiek na komputerze" };
    const end = (await drawFull(DEFAULT_CLIP_EDIT.lengthSec + 0.5, { ...DEFAULT_CLIP_EDIT, url }, { card })).lines;
    for (const text of [url, card.title, card.note]) {
      const l = end.filter((x) => x.text === text);
      expect(l.length, text).toBeGreaterThanOrEqual(1);
      for (const x of l) expect(inside(x), text).toBe(true);
    }
  });

  // --- legal-audit --- main's permanent fan-made badge: the crop-in cuts it away (a 1920×1080 export at the default zoom keeps
  // rows 108 to 972, the badge sits at about 1025) and the card covers it, so a Fight League cut draws it again
  it("draws a Fight League source's fan-made badge again, over the card too, before the watermark", async () => {
    const badge = "Fan-made parody. Not affiliated.";
    expect(fanMadeLine("fightLeague", badge)).toBe(badge);
    for (const mode of ["classic", "glass", "", null, undefined]) expect(fanMadeLine(mode, badge), String(mode)).toBeNull();
    expect(fanMadeLine("fightLeague", " ")).toBeNull();
    const landscape = { width: 1920, height: 1080 };
    const crop = cropRect(landscape.width, landscape.height, DEFAULT_CLIP_EDIT.zoom);
    expect(crop.sy + crop.sh).toBeLessThan(landscape.height * (1 - BADGE_INSET - BADGE_HEIGHT / 2)); // the source's own badge is cut away
    for (const t of [2, DEFAULT_CLIP_EDIT.lengthSec - CARD_FADE_SEC / 2, DEFAULT_CLIP_EDIT.lengthSec + 0.5]) {
      const { calls, lines } = await drawFull(t, DEFAULT_CLIP_EDIT, { fanMade: badge, source: landscape });
      const drawn = lines.filter((l) => l.text === badge);
      expect(drawn, `t=${t}`).toHaveLength(1);
      const b = drawn[0];
      expect(inside(b)).toBe(true);
      // where the simulator puts it: centred in the watermark strip at the bottom of the frame's square, 1.6 % of its side
      expect(b.x).toBe(540);
      expect(b.y).toBeCloseTo(420 + 1080 * (1 - BADGE_INSET - BADGE_HEIGHT / 2), 0);
      expect(b.size).toBe(Math.round(0.016 * 1080));
      // after the card's words (when the card shows), before the watermark's stamp
      const note = lines.find((l) => l.text === "free");
      if (note) expect(b.index).toBeGreaterThan(note.index);
      const stamp = calls.findIndex((c, i) => i > b.index && c.name === "drawImage");
      expect(stamp, `t=${t}`).toBeGreaterThan(b.index);
    }
    // any other mode's cut has no badge
    expect((await drawFull(2, DEFAULT_CLIP_EDIT, { source: landscape })).lines.some((l) => l.text === badge)).toBe(false);
  });

  it("is handed the badge by every caller: the editor and the queue's cut, from the source's mode", () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const draw = strip(read("src/lib/clipEdit/draw.ts"));
    // drawn after the card, then the stamp last
    expect(draw.indexOf("if (mark.fanMade)")).toBeGreaterThan(draw.indexOf("cardAlphaAt(timeline, tSec)"));
    expect(draw.indexOf("if (mark.fanMade)")).toBeLessThan(draw.indexOf("stampFrame(ctx, mark.seal"));
    const render = strip(read("src/lib/clipEdit/render.ts"));
    expect(render).toMatch(/fanMade: string \| null;/);
    for (const c of render.match(/drawEditFrame\([^;]*\);/g) ?? []) expect(c).toMatch(/\{ seal, clipMs: t \* 1000, fanMade: options\.fanMade \}/);
    const dialog = strip(read("src/components/simulator/clipEditor/ClipEditorDialog.tsx"));
    // (--- cut-reedit --- a cut file opened as it is has the badge in its frames already: not a second one)
    expect(dialog).toMatch(/const fanMade = source\.cutFile \? null : fanMadeLine\(source\.mode, fl\("canvasFanMade"\)\);/);
    expect(dialog).toMatch(/useTranslations\("FightLeague"\)/);
    for (const c of dialog.match(/drawEditFrame\([^;]*\);/g) ?? []) expect(c).toMatch(/fanMade \}\);$/);
    const queue = strip(read("src/components/simulator/desktop/useRenderQueue.ts"));
    expect(queue).toMatch(/fanMade: fanMadeLine\(job\.settings\.mode, cutDeps\.fanMade\)/);
    expect(strip(read("src/components/simulator/sections/DesktopSection.tsx"))).toMatch(/fanMade: fl\("canvasFanMade"\)/);
    // every renderClipEdit call in the site hands it over
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(ROOT, "src"));
    let calls = 0;
    for (const f of files) {
      const src = strip(fs.readFileSync(f, "utf8"));
      for (const c of src.match(/renderClipEdit\(\{[^;]*\}\)/g) ?? []) {
        calls++;
        expect(c, path.relative(ROOT, f)).toMatch(/\bfanMade\b/);
      }
    }
    expect(calls).toBe(2);
  });

  it("stamps the watermark of a free run last, over the card too", async () => {
    const calls = await draw(DEFAULT_CLIP_EDIT.lengthSec + 1);
    const card = calls.findIndex((c) => c.name === "fillText" && c.args[0] === "Make your own");
    const after = calls.slice(card + 1);
    // the mark's tiles and badge draw after the card's words
    expect(after.some((c) => c.name === "drawImage" || c.name === "fillText")).toBe(true);
    const src = read("src/lib/clipEdit/draw.ts").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(src.trimEnd()).toMatch(/stampFrame\(ctx, mark\.seal, \{ width, height, clipMs: mark\.clipMs \}\);\s*\}$/);
  });
});

describe("the editor in the page and in the Windows app", () => {
  it("is opened from the Publish block's clip and from the Library, and the app saves the cut through the bridge", () => {
    const publish = read("src/components/simulator/sections/PublishSection.tsx");
    expect(publish).toMatch(/<ClipEditorDialog source=\{\{ blob: editing\.blob/);
    expect(publish).toContain('data-testid="publish-edit-clip"');
    const library = read("src/components/simulator/desktop/LibraryPanel.tsx");
    expect(library).toMatch(/bridge\.library\.read\(item\.id\)/);
    expect(library).toMatch(/<ClipEditorDialog source=\{editing\.source\}[\s\S]*?desktop=\{\{ bridge/);
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).toMatch(/desktop\.bridge\.render\.save\(\{[^;]*transcode: null/);
    expect(dialog).toMatch(/source: "edit"/);
    // the Windows app's own code draws nothing: the cut is made by the page it serves
    expect(dialog).not.toMatch(/PhysicsEngine|createEngineForSettings/);
  });

  // --- ai-cut --- the dialog opens on the cut it is handed and asks the app's AI for one; only the user's edits are remembered
  it("opens pre-filled, asks the app's AI from inside, and remembers only what the user changed", () => {
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).toMatch(/initialSpec\?: Partial<ClipEditSpec>/);
    expect(dialog).toMatch(/useState<ClipEditSpec>\(\(\) => \{\s+const defaults = localClipEdit\(t\("ideas\.escape"\)\);\s+return parseClipEdit\(\{ \.\.\.loadClipEdit\(undefined, defaults\), \.\.\.initialSpec \}, defaults\);/);
    // the suggest hook on the desktop side: the open source's length and the spec on screen in, a spec and a summary out
    expect(dialog).toMatch(/suggest\?: \(input: \{ durationSec: number; current: ClipEditSpec; request\?: string; signal\?: AbortSignal \}\) => Promise<\{ spec: ClipEditSpec; summary: string \}>/);
    expect(dialog).toMatch(/desktop\?\.suggest && durationSec !== null && \(/);
    expect(dialog).toContain('data-testid="clip-edit-suggest"');
    expect(dialog).toContain('data-testid="clip-edit-suggested"');
    expect(dialog).toMatch(/\{suggesting \? t\("suggesting"\) : t\("suggest"\)\}/);
    // a summary the model left out (normaliseFinal makes it "") says the cut is set, never a bare "AI: "
    expect(dialog).toMatch(/suggestion\.summary\.trim\(\) \? t\("suggested", \{ summary: suggestion\.summary\.trim\(\) \}\) : t\("suggestedPlain"\)/);
    expect(dialog).toMatch(/data-testid="clip-edit-suggested">\s+\{suggestedText\}/);
    expect(dialog).toMatch(/t\("suggestFailed", \{ error \}\)/);
    // the proposal lands through the same floors as the stored spec, and the Render button waits for it
    expect(dialog).toMatch(/setSpec\(parseClipEdit\(proposed\)\)/);
    expect(dialog).toMatch(/const canRender = [^\n]*!suggesting/);
    // persistence moved from "every spec change" into the user's own edits: no effect saves the spec any more
    expect(dialog).not.toMatch(/useEffect\(\(\) => saveClipEdit\(spec\)/);
    expect(dialog).toMatch(/const set = <K extends keyof ClipEditSpec>[\s\S]*?saveClipEdit\(next\);[\s\S]*?setSpec\(next\);/);
    // --- cut-reedit --- a trim of a cut file (its neutral spec: no address, no crop-in) never becomes the user's look
    expect(dialog).toMatch(/if \(!source\.cutFile\) saveClipEdit\(next\);/);
    expect(dialog).not.toMatch(/saveClipEdit\((?!next\))/);
    // closing the dialog drops a proposal still on its way
    expect(dialog).toMatch(/suggestAbortRef\.current\?\.abort\(\)/);
    // the old ids a smoke tool looks for stay
    for (const id of ["clip-edit-render", "clip-edit-hook", "clip-edit-url", "clip-edit-scrub", "clip-edit-done", "clip-edit-error"]) expect(dialog).toContain(`data-testid="${id}"`);
    expect(dialog).toContain("data-clip-editor={render.status}");

    const library = read("src/components/simulator/desktop/LibraryPanel.tsx");
    expect(library).toMatch(/onSuggestCut\?: LibrarySuggestCut/);
    expect(library).toMatch(/export type LibrarySuggestCut = \(item: LibraryItem, input: \{ durationSec: number; current: ClipEditSpec; request\?: string; signal\?: AbortSignal \}\) => Promise<\{ spec: ClipEditSpec; summary: string \}>/);
    // --- cut-reedit --- what it opens comes from libraryEditOpen (its cases are below): the item, the spec, whether it is a bare cut file
    expect(library).toMatch(/const \{ item, spec, cutFile \} = libraryEditOpen\(clicked, items\);/);
    expect(library).toMatch(/bridge\.library\.read\(item\.id\)[\s\S]{0,80}setEditing\(\{ source: \{ blob: file, name: item\.fileName, mode: item\.meta\.mode, seed: item\.meta\.seed, cutFile \}, item, spec \}\)/);
    expect(library).toMatch(/<ClipEditorDialog source=\{editing\.source\} initialSpec=\{editing\.spec\}/);
    expect(library).not.toMatch(/initialCut/);
    expect(read("src/lib/clipEdit/propose.ts")).not.toMatch(/url: (cut|fitted)\.url/); // a master's address stays the user's remembered one
    expect(read("src/components/simulator/desktop/useRenderQueue.ts")).toMatch(/queueJobId: `\$\{job\.id\}-cut`/);
    // the AI is asked for a cut of the item opened, never of a bare cut file (it would put a second hook and card on it)
    expect(library).toMatch(/suggest: onSuggestCut && !editing\.source\.cutFile \? \(input\) => onSuggestCut\(editing\.item, input\) : undefined/);
    // the Library's own words are Desktop keys only: the editor's live in ClipEditor
    expect(library).not.toMatch(/t\("suggest/);
  });

  // --- cut-reedit --- a cut file shows its crop-in, hook, address, end card and badge already: the look never goes on it twice
  it("opens a queue cut's master with the cut's spec, and a cut with no master as it is, with nothing added", () => {
    const look = { zoom: 1.25, hook: "Will it escape?", url: "burned.example", cardSec: 1.5 };
    type Item = LibraryEditItem & { id: string };
    const item = (id: string, queueJobId: string | null, durationSec: number | null, cut?: ClipEditSpec, exists = true): Item => ({ id, durationSec, exists, meta: { queueJobId, ...(cut ? { cut } : {}) } });
    // the master carries the plan's proposal; the queue saved the cut with the spec it rendered (refitted to the master's file)
    const proposal: ClipEditSpec = { startSec: 2.4, lengthSec: 10.6, ...look };
    const master = item("m", "job-x", 14.2, proposal);
    const cut = item("c", "job-x-cut", 12.1, { ...proposal });
    const items = [cut, master];
    // a master: its own proposal, the address left to the user's remembered spec
    expect(libraryEditOpen(master, items)).toEqual({ item: master, spec: { startSec: 2.4, lengthSec: 10.6, zoom: 1.25, hook: "Will it escape?", cardSec: 1.5 }, cutFile: false });
    // the queue's cut: its master, with the whole spec the cut was made with (start, length and look), never the burned address
    const opened = libraryEditOpen(cut, items);
    expect(opened.item).toBe(master);
    expect(opened.cutFile).toBe(false);
    expect(opened.spec).toEqual({ startSec: 2.4, lengthSec: 10.6, zoom: 1.25, hook: "Will it escape?", cardSec: 1.5 });
    expect(opened.spec).not.toHaveProperty("url");
    // refitted to the master as the queue refits: a master shorter than the cut's end keeps the length and ends with the file
    const shortMaster = item("m2", "job-y", 12, proposal);
    const shortCut = item("c2", "job-y-cut", 12.1, { ...proposal });
    const refit = refitClipEdit(proposal, 13, 12);
    expect(libraryEditOpen(shortCut, [shortCut, shortMaster]).spec).toEqual({ startSec: refit.startSec, lengthSec: refit.lengthSec, zoom: 1.25, hook: "Will it escape?", cardSec: 1.5 });
    expect(refit).toMatchObject({ startSec: 1.4, lengthSec: 10.6 });
    // a queue cut saved without its spec still opens its master, on the master's own proposal
    expect(libraryEditOpen(item("c3", "job-x-cut", 12.1), items)).toMatchObject({ item: master, spec: { startSec: 2.4 }, cutFile: false });
    // no master to open (the editor's own cut, a master forgotten or whose file is gone): the file as it is, nothing added
    const neutral = { startSec: 0, lengthSec: 12.1, zoom: 1, hook: "", url: "", cardSec: 0 };
    const editorCut = item("e", "edit-abc-cut", 12.1, { ...proposal });
    expect(libraryEditOpen(editorCut, [editorCut, master])).toEqual({ item: editorCut, spec: neutral, cutFile: true });
    expect(libraryEditOpen(cut, [cut])).toEqual({ item: cut, spec: neutral, cutFile: true });
    expect(libraryEditOpen(cut, [cut, { ...master, exists: false }])).toEqual({ item: cut, spec: neutral, cutFile: true });
    // the neutral spec wins over whatever the user remembered: no crop-in, no hook, no address, no card, the whole file
    const remembered = { ...DEFAULT_CLIP_EDIT, url: "mine.example" };
    const spec = parseClipEdit({ ...remembered, ...neutral }, remembered);
    expect(spec).toEqual(neutral);
    expect(fitClipEdit(spec, 12.13)).toMatchObject({ startSec: 0, lengthSec: 12.1 });
    expect(clipTimeline(fitClipEdit(spec, 12.13)).cardSec).toBe(0);
    // a cut file the Library could not measure: the editor's fit to the file it opens keeps the whole of it
    const unmeasured = libraryEditOpen(item("u", "edit-def-cut", null), []);
    expect(unmeasured.cutFile).toBe(true);
    expect(fitClipEdit(parseClipEdit({ ...remembered, ...unmeasured.spec }, remembered), 12.13)).toEqual({ ...neutral, lengthSec: 12.1 });
    // an item with no cut: nothing pre-filled
    expect(libraryEditOpen(item("p", null, 9), [])).toEqual({ item: expect.objectContaining({ id: "p" }), spec: undefined, cutFile: false });
  });

  // --- ai-cut --- Make videos' two checkboxes explain themselves to a screen reader, not only in a mouse's hover title
  it("gives the AI panel's cut and start checkboxes their tips as accessible descriptions", () => {
    const panel = read("src/components/simulator/desktop/AiPanel.tsx");
    for (const [id, tip, testId] of [["cutTipId", "aiCutTip", "ai-cut"], ["startTipId", "aiStartTip", "ai-start"]] as const) {
      expect(panel).toContain(`const ${id} = useId();`);
      expect(panel).toMatch(new RegExp(`<input type="checkbox"[^\\n]*aria-describedby=\\{${id}\\} data-testid="${testId}" />`));
      // outside the label (inside, the words would join the checkbox's name)
      expect(panel).toMatch(new RegExp(`</label>\\s+(\\{/\\*[^*]*\\*/\\}\\s+)?<span id=\\{${id}\\} className="sr-only">\\s+\\{t\\("${tip}"\\)\\}\\s+</span>`));
    }
  });

  it("has its words in every language", () => {
    const flat = (o: Record<string, unknown>, prefix = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v as Record<string, unknown>, `${prefix}${k}.`)));
    const keys = (loc: string) => {
      const m = JSON.parse(read(`messages/${loc}.json`)) as Record<string, Record<string, unknown>>;
      return { editor: flat(m.ClipEditor).sort(), publish: [m.Publish.editClip, m.Publish.editClipTip, (m.Publish.sources as Record<string, string>).edit], lib: m.Desktop.libEdit };
    };
    const en = keys("en");
    expect(en.editor.length).toBeGreaterThan(20);
    for (const loc of ["es", "pl"]) {
      const other = keys(loc);
      expect(other.editor).toEqual(en.editor);
      for (const s of [...other.publish, other.lib]) expect(typeof s).toBe("string");
    }
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    const all = new Set(en.editor);
    for (const m of dialog.matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)) expect(all.has(m[1]), m[1]).toBe(true);
    for (const group of ["ideas", "phase"]) expect(en.editor.filter((k) => k.startsWith(`${group}.`)).length).toBeGreaterThan(1);
    // --- ai-cut --- the AI button's words, with their variables, in every language
    for (const loc of ["en", "es", "pl"]) {
      const editor = (JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: Record<string, string> }).ClipEditor;
      for (const key of ["suggest", "suggesting", "suggested", "suggestFailed"]) expect(typeof editor[key], `${loc}.${key}`).toBe("string");
      expect(editor.suggested).toContain("{summary}");
      expect(editor.suggestFailed).toContain("{error}");
    }
  });

  // --- clip-editor --- docs/COPY-STYLE.md: one idea a sentence, rarely over 18 words, at most three things named; Polish
  // calls a hook "haczyk" everywhere (never "hak", a metal hook), Spanish the queue "cola de renderizado"
  it("words the editor and the AI cut the way the copy guide asks, with one term per language", () => {
    type M = { ClipEditor: Record<string, unknown>; Desktop: Record<string, string>; Publish: Record<string, string> };
    const msgs = (loc: string) => JSON.parse(read(`messages/${loc}.json`)) as M;
    for (const loc of ["en", "pl", "es"]) {
      const m = msgs(loc);
      for (const [key, value] of [["ClipEditor.intro", m.ClipEditor.intro as string], ["Desktop.aiCutTip", m.Desktop.aiCutTip], ["Desktop.aiStartTip", m.Desktop.aiStartTip]] as const) {
        for (const sentence of value.split(/(?<=[.!?])\s+/)) expect(sentence.split(/\s+/).length, `${loc} ${key}: ${sentence}`).toBeLessThanOrEqual(18);
        expect(value, `${loc} ${key}`).not.toMatch(/—| – |;/);
        expect(value.split(",").length, `${loc} ${key}`).toBeLessThanOrEqual(3);
      }
      for (const key of ["aiClipsStarted", "aiClipsQueued", "aiStartedNotice", "aiStartTip"]) expect(m.Desktop[key], `${loc}.${key}`).not.toMatch(/—| – |;/);
    }
    const pl = msgs("pl");
    for (const value of [pl.ClipEditor.hook as string, pl.ClipEditor.url as string, pl.Publish.editClipTip, pl.Desktop.aiCutTip]) expect(value).not.toMatch(/\bhak(iem|a|u)?\b/i);
    expect(pl.ClipEditor.hook).toMatch(/^Haczyk/);
    // the few form's verb agrees with its clips
    expect(pl.Desktop.aiStartedNotice).toMatch(/few \{# klipy od AI trafiły\}/);
    expect(pl.Desktop.aiStartedNotice).not.toMatch(/renderuje się/);
    const es = msgs("es");
    for (const key of ["aiStartTip", "aiClipsStarted", "aiStartedNotice", "aiClipsQueued", "aiQueuedNotice"]) {
      expect(es.Desktop[key], key).toContain("cola de renderizado");
      expect(es.Desktop[key], key).not.toMatch(/cola de render(?!izado)/);
    }
    expect(es.Desktop.aiCutLine).toContain("acercamiento {zoom} %");
    // the hook in each language's own quotes, as the rest of its catalog writes them
    expect(pl.Desktop.aiCutLine).toMatch(/ · „\{hook\}”$/);
    expect(es.Desktop.aiCutLine).toMatch(/ · «\{hook\}»$/);
    for (const m of [pl, es]) expect(m.Desktop.aiCutLine).not.toContain('"');
  });
});

/* ------------------------------------------------------------------ --- clip-locale --- --- clip-a11y --- */

describe("the editor's failures, progress and preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // --- clip-locale --- the failures the editor expects are typed, so the page words them in its own language
  it("throws typed errors for a file it cannot open or step through, and names their words", async () => {
    const video = { muted: false, playsInline: false, preload: "", src: "", currentTime: 0, duration: 10, readyState: 4, onerror: null as null | (() => void), onseeked: null as null | (() => void), removeAttribute: () => {}, load: () => {} };
    vi.stubGlobal("document", { createElement: () => video });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    const opening = openSourceVideo(new Blob(["x"]));
    video.onerror?.();
    await expect(opening).rejects.toBeInstanceOf(ClipEditOpenError);
    vi.useFakeTimers();
    const seeking = seekVideo(video as unknown as HTMLVideoElement, 5);
    const seen = expect(seeking).rejects.toBeInstanceOf(ClipEditSeekError);
    await vi.advanceTimersByTimeAsync(8000);
    await seen;
    expect(clipEditErrorKey(new ClipEditOpenError())).toBe("cannotOpen");
    expect(clipEditErrorKey(new ClipEditSeekError())).toBe("cannotSeek");
    expect(clipEditErrorKey(new FastRenderUnsupportedError())).toBe("unsupported");
    for (const other of [new Error("cancelled"), "x", null]) expect(clipEditErrorKey(other)).toBeNull();
    // the dialog words both of its error slots with them, and the queue's cut notice too
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).toMatch(/const key = clipEditErrorKey\(err\);\s+if \(key\) return t\(key\);/);
    expect(dialog).toMatch(/\.catch\(\(err: unknown\) => live && setOpenError\(\{ error: err \}\)\)/);
    expect(dialog).toMatch(/\{failureText\(openError\.error, t\)\}/);
    expect(dialog).toMatch(/setRender\(\{ status: "error", message: failureText\(err, t\) \}\)/);
    expect(read("src/components/simulator/desktop/useRenderQueue.ts")).toMatch(/cutDeps\.onFailed\?\.\(job, message, err\)/);
    expect(read("src/components/simulator/sections/DesktopSection.tsx")).toMatch(/const key = clipEditErrorKey\(thrown\);\s+setNotice\(key \? t\("jobCutFailedWhy", \{ name: job\.name, reason: editor\(key\) \}\) : t\("jobCutFailed", \{ name: job\.name, error \}\)\);/);
    for (const loc of ["en", "pl", "es"]) {
      const m = JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: Record<string, string>; Desktop: Record<string, string> };
      for (const key of ["cannotOpen", "cannotSeek"]) {
        expect(m.ClipEditor[key], `${loc}.${key}`).toMatch(/^\S.*\.$/);
        expect(m.ClipEditor[key], `${loc}.${key}`).not.toMatch(/—| – |;|:/);
      }
      expect(m.Desktop.jobCutFailedWhy, loc).toMatch(/\{name\}[^{]*\. \{reason\} /);
    }
    const en = JSON.parse(read("messages/en.json")) as { ClipEditor: Record<string, string> };
    for (const loc of ["pl", "es"]) {
      const m = JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: Record<string, string> };
      for (const key of ["cannotOpen", "cannotSeek", "framesLive", "progressLabel"]) expect(m.ClipEditor[key], `${loc}.${key}`).not.toBe(en.ClipEditor[key]);
    }
  });

  // --- clip-a11y --- a render reports every few frames: only the phase and quarters of it reach the screen reader
  it("says the render's phase and its quarters in a live region that stays mounted, and shows the rest in a progressbar", () => {
    expect(liveProgress({ phase: "prepare", progress: 0.02 })).toEqual({ phase: "prepare", percent: 0 });
    const frames = Array.from({ length: 450 }, (_, i) => liveProgress({ phase: "frames", progress: 0.05 + (0.8 * (i + 1)) / 450 }));
    expect(new Set(frames.map((f) => f.percent))).toEqual(new Set([0, 25, 50, 75]));
    expect(liveProgress({ phase: "audio", progress: 0.9 })).toEqual({ phase: "audio", percent: 75 });
    expect(liveProgress({ phase: "finish", progress: 1 })).toEqual({ phase: "finish", percent: 75 });
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    // the old live region around the bar is gone; the bar is a progressbar
    expect(dialog).not.toMatch(/<div className="space-y-1" role="status">/);
    expect(dialog).toMatch(/role="progressbar" aria-label=\{t\("progressLabel"\)\} aria-valuemin=\{0\} aria-valuemax=\{100\} aria-valuenow=\{percent\}/);
    // the live region is outside the rendering block, so it is there before its words are
    const block = dialog.slice(dialog.indexOf('{render.status === "rendering" && ('), dialog.indexOf('{render.status === "done" && ('));
    expect(block).toMatch(/\)\}\s+<p className="sr-only" role="status" aria-live="polite" data-testid="clip-edit-live">\s+\{liveText\}\s+<\/p>\s+$/);
    expect(dialog).toMatch(/const live = render\.status === "rendering" \? liveProgress\(render\.progress\) : null;/);
    expect(dialog).toMatch(/live\.phase === "frames" \? t\("framesLive", \{ percent: live\.percent \}\)/);
    for (const loc of ["en", "pl", "es"]) expect((JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: Record<string, string> }).ClipEditor.framesLive, loc).toContain("{percent}");
  });

  // --- clip-a11y --- Suggest with AI keeps a keyboard user's focus, and the AI's answer and the render's outcome are said
  // through the one live region that is there from the start (a region inserted with its words already in it is often not read)
  it("keeps the focus on Suggest while the AI is asked, and says its answer and the render's outcome in the mounted region", () => {
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    const at = dialog.indexOf('data-testid="clip-edit-suggest"');
    const suggest = dialog.slice(dialog.lastIndexOf("<button", at), at); // (its click is an arrow: no [^>] match)
    expect(suggest).toContain("aria-disabled={busy || undefined}");
    expect(suggest).toContain("onClick={busy ? undefined : () => void suggest()}");
    expect(suggest).not.toMatch(/\sdisabled=/);
    expect(dialog).toMatch(/const busy = rendering \|\| suggesting;/);
    // the region says the render's progress, the AI being asked, then the newest answer
    expect(dialog).toMatch(/const liveText = rendering \? progressText : suggesting \? t\("suggesting"\) : latest === "suggest" \? suggestedText : doneText;/);
    expect(dialog).toMatch(/setSuggestion\(\{ status: "running" \}\);\s+setLatest\("suggest"\);/);
    expect(dialog).toMatch(/setLatest\("render"\);[^\n]*\n\s+setRender\(\{ status: "rendering"/);
    // the visible lines show the same words without a role of their own: nothing is read twice, nothing is inserted live
    for (const id of ["clip-edit-done", "clip-edit-suggested"]) {
      const line = dialog.match(new RegExp(`<p[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
      expect(line, id).not.toBe("");
      expect(line, id).not.toMatch(/role=|aria-live/);
    }
    expect(dialog).toMatch(/data-testid="clip-edit-done">\s+\{doneText\}/);
    expect(dialog.match(/role="status"/g)).toHaveLength(1);
    // the fallback for a missing summary, in every language, plain and without a placeholder
    for (const loc of ["en", "pl", "es"]) {
      const editor = (JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: Record<string, string> }).ClipEditor;
      expect(editor.suggestedPlain, loc).toMatch(/^\S[^{}]*\.$/);
      expect(editor.suggestedPlain, loc).not.toMatch(/—| – |;/);
    }
    for (const loc of ["pl", "es"]) expect((JSON.parse(read(`messages/${loc}.json`)) as { ClipEditor: Record<string, string> }).ClipEditor.suggestedPlain).not.toBe("The AI set the cut.");
  });

  // --- clip-editor --- a seal that comes after the video (a licence renewal in flight) still draws the preview
  it("draws the preview once the seal is there, whichever comes first", () => {
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).not.toMatch(/sealRef/);
    expect(dialog).toMatch(/const \[seal, setSeal\] = useState<WatermarkSeal \| null>\(null\);/);
    expect(dialog).toMatch(/sealWatermark\(\)\.then\(\(sealed\) => live && setSeal\(sealed\)\)/);
    expect(dialog).toMatch(/if \(!canvas \|\| !opened \|\| durationSec === null \|\| rendering \|\| !seal\) return;/);
    expect(dialog).toMatch(/\}, \[scrub, [^\]]*\bseal\]\);/);
    expect(dialog).toMatch(/\{ seal, clipMs: tSec \* 1000, fanMade \}/);
  });
});
