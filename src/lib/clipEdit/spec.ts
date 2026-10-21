/*
 * --- clip-editor --- The post-export cut: what the Clip editor does to a finished video before it is posted. A clip made
 * in the studio often opens on a still frame, a small ring and a counter at zero – the second most viewers leave in. The
 * editor cuts in where the action is (`startSec`, `lengthSec`), crops in on the ring (`zoom`), keeps a hook question and
 * the site's address on screen from the first frame, and fades to an end card that names the site. Everything here is
 * pure: the spec, its ranges and storage, the output timeline and the frame geometry; draw.ts paints a frame of it and
 * render.ts encodes the file – in the browser on the website, and in the Windows app, which runs the same page.
 */
import { SITE_DOMAIN, SITE_SLUG } from "@/lib/site";

export interface ClipEditSpec {
  /** Seconds into the source where the cut begins. */
  startSec: number;
  /** Seconds of action kept. */
  lengthSec: number;
  /** Crop-in factor: 1 keeps the frame, 1.3 shows the middle 77 %. */
  zoom: number;
  /** The question at the top, from the first frame ("" for none). */
  hook: string;
  /** The address under the hook and on the end card ("" for none). */
  url: string;
  /** Seconds of end card after the action (0 for none). */
  cardSec: number;
}

export const CLIP_EDIT_RANGES = {
  startSec: { min: 0, max: 600, step: 0.5 },
  lengthSec: { min: 3, max: 60, step: 0.5 },
  zoom: { min: 1, max: 2, step: 0.05 },
  cardSec: { min: 0, max: 4, step: 0.5 },
} as const;

export const CLIP_EDIT_TEXT_MAX = 60;
/** The shortest cut (the length slider's floor): what a model's answer must leave room for before the file's end. */
export const SHORTEST_CUT_SEC = CLIP_EDIT_RANGES.lengthSec.min;

export const DEFAULT_CLIP_EDIT: ClipEditSpec = { startSec: 3, lengthSec: 11, zoom: 1.25, hook: "Will it escape?", url: SITE_DOMAIN, cardSec: 1.5 };

/** The file the editor writes: vertical, 30 fps – what TikTok, Reels and Shorts take. */
export const CLIP_EDIT_OUTPUT = { width: 1080, height: 1920, fps: 30 } as const;

/** The fade from the last frame of action into the end card. */
export const CARD_FADE_SEC = 0.4;
/** The audio fade under the end of the action. */
export const AUDIO_FADE_SEC = 0.6;

export const CLIP_EDIT_STORAGE_KEY = "jumpingballslive_clipEdit";

// --- uncap-all --- the sliders' maximums are where the sliders stop, not the values: a typed length or start travels as it
// is (fitClipEdit fits the cut to the source's length); only the floors hold, which the geometry needs
const atLeast = (v: unknown, floor: number, fallback: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(floor, n);
};
const text = (v: unknown, fallback: string): string => (typeof v === "string" ? v.slice(0, CLIP_EDIT_TEXT_MAX) : fallback);

/** A spec from anything (storage, a form): numbers below their floor raised to it, missing fields defaulted. */
export function parseClipEdit(raw: unknown): ClipEditSpec {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_CLIP_EDIT;
  return {
    startSec: atLeast(r.startSec, CLIP_EDIT_RANGES.startSec.min, d.startSec),
    lengthSec: atLeast(r.lengthSec, CLIP_EDIT_RANGES.lengthSec.min, d.lengthSec),
    zoom: atLeast(r.zoom, CLIP_EDIT_RANGES.zoom.min, d.zoom),
    hook: text(r.hook, d.hook),
    url: text(r.url, d.url),
    cardSec: atLeast(r.cardSec, CLIP_EDIT_RANGES.cardSec.min, d.cardSec),
  };
}

/**
 * The spec fitted to a source of `durationSec` seconds: the cut starts at least one second before the end and never runs
 * past it (a source shorter than the minimum length is kept whole).
 */
export function fitClipEdit(spec: ClipEditSpec, durationSec: number): ClipEditSpec {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return spec;
  const startSec = Math.max(0, Math.min(spec.startSec, Math.max(0, durationSec - 1)));
  const room = Math.max(0.5, durationSec - startSec);
  return { ...spec, startSec, lengthSec: Math.round(Math.min(spec.lengthSec, room) * 10) / 10 };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;
const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadClipEdit(storage: StorageLike | null = defaultStorage()): ClipEditSpec {
  try {
    const raw = storage?.getItem(CLIP_EDIT_STORAGE_KEY);
    return raw ? parseClipEdit(JSON.parse(raw)) : { ...DEFAULT_CLIP_EDIT };
  } catch {
    return { ...DEFAULT_CLIP_EDIT };
  }
}

export function saveClipEdit(spec: ClipEditSpec, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(CLIP_EDIT_STORAGE_KEY, JSON.stringify(spec));
  } catch {
    /* storage full or blocked: the spec lives for the session */
  }
}

/** The output clip in time: the action, then the card, with the fade over the action's last moments. */
export interface ClipTimeline {
  actionSec: number;
  cardSec: number;
  /** Where the card starts fading in (the action's end when there is no card). */
  fadeStartSec: number;
  totalSec: number;
  frames: number;
}

export function clipTimeline(spec: ClipEditSpec, fps: number = CLIP_EDIT_OUTPUT.fps): ClipTimeline {
  const actionSec = spec.lengthSec;
  const cardSec = spec.cardSec;
  const fadeStartSec = cardSec > 0 ? Math.max(0, actionSec - CARD_FADE_SEC) : actionSec;
  const totalSec = actionSec + cardSec;
  return { actionSec, cardSec, fadeStartSec, totalSec, frames: Math.max(1, Math.round(totalSec * fps)) };
}

/** The source time shown at `tSec` of the output: the action plays, the card holds the last frame. */
export function sourceTimeAt(spec: ClipEditSpec, tSec: number): number {
  return spec.startSec + Math.min(Math.max(0, tSec), spec.lengthSec);
}

/** How much of the end card covers the frame at `tSec`: 0 during the action, 1 on the card, a ramp between. */
export function cardAlphaAt(timeline: ClipTimeline, tSec: number): number {
  if (timeline.cardSec <= 0 || tSec < timeline.fadeStartSec) return 0;
  if (tSec >= timeline.actionSec) return 1;
  const span = timeline.actionSec - timeline.fadeStartSec;
  return span > 0 ? Math.min(1, (tSec - timeline.fadeStartSec) / span) : 1;
}

/** The audio gain at `tSec`: full, fading out under the action's last moments, silent on the card. */
export function audioGainAt(timeline: ClipTimeline, tSec: number): number {
  if (tSec >= timeline.actionSec) return 0;
  const fadeStart = Math.max(0, timeline.actionSec - AUDIO_FADE_SEC);
  if (tSec <= fadeStart) return 1;
  return Math.max(0, 1 - (tSec - fadeStart) / Math.max(1e-6, timeline.actionSec - fadeStart));
}

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * The part of a `sw` × `sh` source that fills a `w` × `h` frame: the centred window of the frame's aspect (cover, never
 * bars), shrunk by `zoom` around the centre – the ring and the ball come closer, the edges go.
 */
export function cropRect(sourceWidth: number, sourceHeight: number, zoom: number, w: number = CLIP_EDIT_OUTPUT.width, h: number = CLIP_EDIT_OUTPUT.height): SourceRect {
  const z = Math.max(1, zoom);
  const targetAspect = w / h;
  let cw = sourceWidth;
  let ch = sourceHeight;
  if (cw / ch > targetAspect) cw = ch * targetAspect;
  else ch = cw / targetAspect;
  cw /= z;
  ch /= z;
  return { sx: (sourceWidth - cw) / 2, sy: (sourceHeight - ch) / 2, sw: cw, sh: ch };
}

export interface HookLayout {
  hookFont: number;
  urlFont: number;
  hookY: number;
  urlY: number;
  padX: number;
  padY: number;
}

/** Where the hook and the address sit: in the top band, below where a phone's status bar and TikTok's own chrome land. */
export function hookLayout(w: number = CLIP_EDIT_OUTPUT.width, h: number = CLIP_EDIT_OUTPUT.height): HookLayout {
  const hookFont = Math.round(0.072 * w);
  const urlFont = Math.round(0.04 * w);
  return { hookFont, urlFont, hookY: Math.round(0.095 * h), urlY: Math.round(0.095 * h + 1.35 * hookFont + 0.55 * urlFont), padX: Math.round(0.4 * hookFont), padY: Math.round(0.3 * hookFont) };
}

/** `<source base>-tiktok.mp4`: the edited file next to its source's name (`-cut` when the source is a TikTok render already named so). */
export function editFileName(sourceName: string, extension = "mp4"): string {
  const base = sourceName.replace(/\.(mp4|webm|mov|m4v|mkv)$/i, "").trim() || `${SITE_SLUG}-clip`;
  return /-tiktok$/i.test(base) ? `${base}-cut.${extension}` : `${base}-tiktok.${extension}`;
}
