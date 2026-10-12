import { quantisePixels, type BrickPicture } from "@/lib/physics/brickPicture";
import type { BrickField } from "@/lib/physics/brickRebuild";

/*
 * --- brick-rebuild --- Brick Smash's uploaded picture, in the page only: the panel (sections/BrickRebuildSection.tsx) loads a
 * picture file into this store, the page (Simulator.tsx) subscribes, cover-fits it into the run's grid – one pixel a cell, the
 * wall's own proportions, like Picture Paint – and hands the quantised bricks to the engine (`setBrickRebuildPicture()`). The
 * picture never leaves the browser: no link, preset, project file or share code carries it (only the picture setting "upload"
 * does; without a picture loaded the run plays the built-in emblem).
 */

export interface BrickUpload {
  /** The file's name (the panel shows it) and its decoded picture. */
  name: string;
  image: CanvasImageSource & { width: number; height: number };
}

type Listener = (upload: BrickUpload | null) => void;

class BrickUploadStore {
  private upload: BrickUpload | null = null;
  private readonly listeners = new Set<Listener>();
  get(): BrickUpload | null {
    return this.upload;
  }
  set(upload: BrickUpload | null) {
    this.upload = upload;
    for (const fn of this.listeners) fn(upload);
  }
  /** Calls `fn` with every change; returns the unsubscribe. */
  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

/** The page's one uploaded Brick Smash picture. */
export const brickUploadStore = new BrickUploadStore();

/** The largest picture file the panel reads (bytes): a phone photo fits, a raw scan is refused. */
export const BRICK_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;

/**
 * Where a picture of `imgW` × `imgH` is drawn into a `cols` × `rows` pixel grid whose wall is `wallW` × `wallH` world px: cover-fitted
 * (the wall filled, the overflow cropped evenly), in the grid's pixels (a cell is one pixel, its own proportions kept).
 */
export function brickCoverRect(imgW: number, imgH: number, cols: number, rows: number, wallW: number, wallH: number): { x: number; y: number; w: number; h: number } {
  const iw = imgW > 0 ? imgW : 1;
  const ih = imgH > 0 ? imgH : 1;
  const ww = wallW > 0 ? wallW : cols;
  const wh = wallH > 0 ? wallH : rows;
  const scale = Math.max(ww / iw, wh / ih);
  const w = (iw * scale * cols) / ww;
  const h = (ih * scale * rows) / wh;
  return { x: (cols - w) / 2, y: (rows - h) / 2, w, h };
}

/** The bricks of `upload` for `field`'s grid: cover-fitted, one pixel a cell, quantised to at most 8 colours (null without a canvas). */
export function rasteriseBrickPicture(upload: BrickUpload, field: Pick<BrickField, "cols" | "rows" | "cw" | "ch">): BrickPicture | null {
  const cols = field.cols;
  const rows = field.rows;
  if (!(cols > 0) || !(rows > 0)) return null;
  let canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(cols, rows);
  else if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = cols;
    c.height = rows;
    canvas = c;
  }
  const ctx = canvas ? (canvas.getContext("2d", { willReadFrequently: true } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null) : null;
  if (!ctx) return null;
  const r = brickCoverRect(upload.image.width, upload.image.height, cols, rows, cols * field.cw, rows * field.ch);
  ctx.imageSmoothingEnabled = true;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, cols, rows);
  ctx.drawImage(upload.image, r.x, r.y, r.w, r.h);
  const data = ctx.getImageData(0, 0, cols, rows).data;
  return quantisePixels(data, cols, rows);
}

/** Decodes a picture file for the store (rejects anything that is not a decodable image, or bigger than BRICK_UPLOAD_MAX_BYTES). */
export function loadBrickUpload(file: File): Promise<BrickUpload> {
  return new Promise((resolve, reject) => {
    if (!file || file.size > BRICK_UPLOAD_MAX_BYTES || !/^image\//.test(file.type || "image/")) {
      reject(new Error("not a picture"));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ name: file.name, image: img });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not a picture"));
    };
    img.src = url;
  });
}
