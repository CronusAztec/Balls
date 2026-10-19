// --- clip-editor --- The post-export cut (lib/clipEdit): the spec and its storage, the output timeline, the crop and the
// frame compositor – which stamps every frame with the run's seal, last.
import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { CARD_FADE_SEC, CLIP_EDIT_OUTPUT, CLIP_EDIT_STORAGE_KEY, DEFAULT_CLIP_EDIT, audioGainAt, cardAlphaAt, clipTimeline, cropRect, editFileName, fitClipEdit, hookLayout, loadClipEdit, parseClipEdit, saveClipEdit, sourceTimeAt } from "@/lib/clipEdit/spec";
import { drawEditFrame } from "@/lib/clipEdit/draw";
import { cutAudio } from "@/lib/clipEdit/render";
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
});

describe("the frame compositor", () => {
  afterEach(() => vi.unstubAllGlobals());

  const draw = async (tSec: number, spec = DEFAULT_CLIP_EDIT) => {
    vi.stubGlobal("document", fakeDocument());
    const seal = await sealWatermark();
    const canvas = fakeCanvas(1080, 1920);
    const source = fakeCanvas(1080, 1920);
    const tl = clipTimeline(spec, 30);
    drawEditFrame(canvas.ctx as unknown as CanvasRenderingContext2D, { image: source as unknown as CanvasImageSource, width: 1080, height: 1920 }, 1080, 1920, spec, tl, tSec, { title: "Make your own", note: "free" }, { seal, clipMs: tSec * 1000 });
    return canvas.ctx.calls;
  };
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
    expect(dialog).toMatch(/useState<ClipEditSpec>\(\(\) => parseClipEdit\(\{ \.\.\.loadClipEdit\(\), \.\.\.initialSpec \}\)\)/);
    // the suggest hook on the desktop side: the open source's length and the spec on screen in, a spec and a summary out
    expect(dialog).toMatch(/suggest\?: \(input: \{ durationSec: number; current: ClipEditSpec; request\?: string; signal\?: AbortSignal \}\) => Promise<\{ spec: ClipEditSpec; summary: string \}>/);
    expect(dialog).toMatch(/desktop\?\.suggest && durationSec !== null && \(/);
    expect(dialog).toContain('data-testid="clip-edit-suggest"');
    expect(dialog).toContain('data-testid="clip-edit-suggested"');
    expect(dialog).toMatch(/\{suggesting \? t\("suggesting"\) : t\("suggest"\)\}/);
    expect(dialog).toMatch(/t\("suggested", \{ summary: suggestion\.summary \}\)/);
    expect(dialog).toMatch(/t\("suggestFailed", \{ error \}\)/);
    // the proposal lands through the same floors as the stored spec, and the Render button waits for it
    expect(dialog).toMatch(/setSpec\(parseClipEdit\(proposed\)\)/);
    expect(dialog).toMatch(/const canRender = [^\n]*!suggesting/);
    // persistence moved from "every spec change" into the user's own edits: no effect saves the spec any more
    expect(dialog).not.toMatch(/useEffect\(\(\) => saveClipEdit\(spec\)/);
    expect(dialog).toMatch(/const set = <K extends keyof ClipEditSpec>[\s\S]*?saveClipEdit\(next\);[\s\S]*?setSpec\(next\);/);
    expect(dialog).not.toMatch(/saveClipEdit\((?!next\))/);
    // closing the dialog drops a proposal still on its way
    expect(dialog).toMatch(/suggestAbortRef\.current\?\.abort\(\)/);
    // the old ids a smoke tool looks for stay
    for (const id of ["clip-edit-render", "clip-edit-hook", "clip-edit-url", "clip-edit-scrub", "clip-edit-done", "clip-edit-error"]) expect(dialog).toContain(`data-testid="${id}"`);
    expect(dialog).toContain("data-clip-editor={render.status}");

    const library = read("src/components/simulator/desktop/LibraryPanel.tsx");
    expect(library).toMatch(/onSuggestCut\?: LibrarySuggestCut/);
    expect(library).toMatch(/export type LibrarySuggestCut = \(item: LibraryItem, input: \{ durationSec: number; current: ClipEditSpec; request\?: string; signal\?: AbortSignal \}\) => Promise<\{ spec: ClipEditSpec; summary: string \}>/);
    // a master opens with its proposed cut whole; a cut file (queueJobId `<job>-cut`) only with the look it was made with
    expect(library).toMatch(/<ClipEditorDialog source=\{editing\.source\} initialSpec=\{initialCut\(editing\.item\)\}/);
    expect(library).toMatch(/queueJobId\?\.endsWith\("-cut"\)\) return \{ zoom: cut\.zoom, hook: cut\.hook, cardSec: cut\.cardSec \}/);
    expect(library).not.toMatch(/url: cut\.url/); // the address stays the user's remembered one
    expect(read("src/components/simulator/desktop/useRenderQueue.ts")).toMatch(/queueJobId: `\$\{job\.id\}-cut`/);
    expect(library).toMatch(/suggest: onSuggestCut \? \(input\) => onSuggestCut\(editing\.item, input\) : undefined/);
    // the Library's own words are Desktop keys only: the editor's live in ClipEditor
    expect(library).not.toMatch(/t\("suggest/);
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
});
