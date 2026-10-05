"use client";

import { useEffect, useRef } from "react";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { FastRenderHost } from "@/lib/recording/fastRender";
import { renderStills } from "@/lib/thumbnails/stillRender";
import { THUMB_MAX_BYTES, THUMB_SIZE, backdropOf, dataUrlBytes, drawHeroThumbnail, encodeUnderBudget, heroRenderScale, heroSourceRect, type HeroCamera } from "@/lib/thumbnails/heroFrame";
import { prepareStamp, sealVerdict, sealWatermark, stampFrame } from "@/lib/watermark/seal"; // --- watermark-everywhere ---

/*
 * --- mode-thumbnails --- The page's still camera, for tools: `window.__jumpingBallsStill.capture()` renders the page's
 * settings (the mode, its settings, the link's pinned `seed=`) offline – the fast export's deterministic canvas stepped to the
 * seconds asked for (lib/thumbnails/stillRender.ts) – and hands back each second as a framed card picture: the camera's
 * square with the shared inset, vignette and mode-coloured edge glow (lib/thumbnails/heroFrame.ts), WebP under the byte
 * budget or a lossless PNG. scripts/generate-mode-previews.mjs makes the mode cards' pictures with it (the hero moments of
 * lib/thumbnails/heroMoments.ts). The page's own run is not touched.
 *
 * --- watermark-everywhere --- A still is a picture of the run like a video's frame, so it carries the free watermark like one:
 * each capture is sealed when it starts (free-watermark's gate, `sealWatermark()`: the stored licence verified again) and
 * every picture it hands back – the framed card and the raw world – is stamped (`stampFrame()`) unless that seal is a verified
 * Pro licence's. The still camera thus gives a visitor without Pro no clean frame of a simulation (it is reachable from the
 * console); the generator runs as Pro, so the cards stay clean – and refuses to write pictures a capture reports as
 * `watermarked` (a build that did not accept its licence).
 */

export interface HeroStillRequest {
  /** Seconds of the run to picture (one picture each). */
  times: number[];
  camera?: HeroCamera;
  /** The mode's colour for the edge glow ("#rrggbb"). */
  tint?: string;
  /** The picture's side in px (THUMB_SIZE). */
  size?: number;
  /** "webp" (default): under `maxBytes`, the quality stepped down until it fits; "png": lossless (contact sheets). */
  format?: "webp" | "png";
  maxBytes?: number;
  /** A seed other than the page engine's (by default the run's: a link's `seed=` pins it). */
  seed?: number;
  /** Also hand back the whole world of each second, unframed (PNG, 1 device px per world px) – for checking a camera. */
  raw?: boolean;
}

export interface HeroStillFrame {
  sec: number;
  dataUrl: string;
  bytes: number;
  /** The WebP quality it took (null: PNG). */
  quality: number | null;
  /** The run was over by then. */
  finished: boolean;
  raw?: string;
}

export interface HeroStillResult {
  seed: number;
  mode: string;
  world: { width: number; height: number };
  /** Device px per world px the world was drawn at. */
  scale: number;
  frames: HeroStillFrame[];
  /** --- watermark-everywhere --- The pictures carry the free watermark (the capture's seal is not a verified Pro licence's). */
  watermarked: boolean;
}

declare global {
  interface Window {
    __jumpingBallsStill?: {
      version: number;
      /** True once the page's engine is up (and no recording, search or export is running). */
      ready: () => boolean;
      capture: (request: HeroStillRequest) => Promise<HeroStillResult>;
    };
  }
}

export interface HeroStillOptions {
  /** The page's fast-export host (the hidden canvas is mounted through it). */
  host: FastRenderHost;
  /** The page's engine (its world and seed). */
  getEngine: () => PhysicsEngine | null;
  /** A fresh engine set up like the page's (the fast export's set-up) for `seed`. */
  createEngine: (seed: number) => PhysicsEngine;
  mode: string;
  /** Why a still cannot be taken now (a recording, a search, an export), or null. */
  busy: string | null;
}

/** The stage's backdrop colour: the darkest corner pixel of the world's canvas (the inset past the world is filled with it). */
function stageBackdrop(canvas: HTMLCanvasElement): string {
  const g = canvas.getContext("2d");
  if (!g) return "#000000";
  const w = canvas.width;
  const h = canvas.height;
  const at = (x: number, y: number) => Array.from(g.getImageData(Math.max(0, Math.min(w - 1, x)), Math.max(0, Math.min(h - 1, y)), 1, 1).data);
  return backdropOf([at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)]);
}

export function useHeroStill(options: HeroStillOptions): void {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let running = false;
    window.__jumpingBallsStill = {
      version: 1,
      ready: () => !!latest.current.getEngine() && latest.current.busy === null && !running,
      capture: async (request) => {
        const o = latest.current;
        const page = o.getEngine();
        if (!page) throw new Error("The simulator is not ready yet.");
        if (o.busy) throw new Error(o.busy);
        if (running) throw new Error("A still is being taken already.");
        running = true;
        try {
          if (document.fonts?.ready) await document.fonts.ready;
          const world = { width: page.config.width, height: page.config.height };
          const seed = typeof request.seed === "number" && Number.isFinite(request.seed) ? request.seed | 0 : page.getSeed();
          const size = Math.max(16, Math.round(request.size ?? THUMB_SIZE));
          const rect = heroSourceRect(world, request.camera ?? {});
          const scale = heroRenderScale(rect.side, size);
          const out = document.createElement("canvas");
          out.width = out.height = size;
          const ctx = out.getContext("2d");
          if (!ctx) throw new Error("Canvas 2D is not available");
          // --- watermark-everywhere --- sealed once per capture, like a recording or an export; a mark that cannot be drawn
          // stops the capture before its first picture (never a clean picture instead)
          const seal = await sealWatermark();
          prepareStamp(seal, { width: size, height: size });
          const frames: HeroStillFrame[] = [];
          await renderStills({
            host: o.host,
            createEngine: () => latest.current.createEngine(seed),
            seed,
            world,
            scale,
            times: request.times,
            onFrame: (canvas, sec, info) => {
              drawHeroThumbnail(ctx, canvas, scale, rect, size, { tint: request.tint ?? "#93d119", backdrop: stageBackdrop(canvas) });
              stampFrame(ctx, seal, { width: size, height: size, clipMs: sec * 1000 }); // --- watermark-everywhere --- (last, over the frame)
              let frame: HeroStillFrame;
              if (request.format === "png") {
                const dataUrl = out.toDataURL("image/png");
                frame = { sec, dataUrl, bytes: dataUrlBytes(dataUrl), quality: null, finished: info.finished };
              } else {
                const encoded = encodeUnderBudget(out, request.maxBytes ?? THUMB_MAX_BYTES);
                if (!encoded) throw new Error(`No WebP under ${request.maxBytes ?? THUMB_MAX_BYTES} bytes for second ${sec} (or this browser writes no WebP).`);
                frame = { sec, ...encoded, finished: info.finished };
              }
              if (request.raw) {
                const raw = document.createElement("canvas");
                raw.width = world.width;
                raw.height = world.height;
                const rawCtx = raw.getContext("2d");
                if (rawCtx) {
                  rawCtx.drawImage(canvas, 0, 0, world.width, world.height);
                  stampFrame(rawCtx, seal, { width: world.width, height: world.height, clipMs: sec * 1000 }); // --- watermark-everywhere ---
                }
                frame.raw = raw.toDataURL("image/png");
              }
              frames.push(frame);
            },
          });
          return { seed, mode: o.mode, world, scale, frames, watermarked: sealVerdict(seal) === "marked" }; // --- watermark-everywhere ---
        } finally {
          running = false;
        }
      },
    };
    return () => {
      delete window.__jumpingBallsStill;
    };
  }, []);
}
