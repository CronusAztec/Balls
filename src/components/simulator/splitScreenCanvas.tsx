"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ForwardedRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import type { CanvasHandle, CanvasProps } from "./Canvas";
import type { OfflineCanvasDriver, OfflineFrameRenderer } from "@/lib/recording/fastRender";
import type { PhysicsEngine } from "@/lib/physics/engine";
import type { MultiArenaRunner } from "@/lib/simulation/multi";
import { SPLIT_FINISH_HOLD_MS, arenaViewports, bannerAnchor, formatRaceSeconds, type ArenaLayout, type ArenaViewport } from "@/lib/splitScreen";
import { CaptionLayer, type CaptionView } from "./captionsRenderer";
import { edgeTextBounds, emptyEdgeTextLines, exportEdgeTextLines, liveEdgeTextLines } from "@/lib/captions";
import { recordingTextLayout, type RecordingCrop } from "@/lib/recording/recorder";
import { BackgroundPainter, type BackgroundLook } from "./themeRenderer";
import { DEFAULT_BACKGROUND_COLORS } from "@/lib/themes";
import { ACCENT } from "@/lib/site";

/*
 * --- split-screen --- The page's canvas during a split-screen race (lib/splitScreen.ts, lib/simulation/multi.ts). Every
 * arena is drawn by its own hidden instance of the page's canvas – the very same draw routine a single arena uses, with
 * every prop the page gives the canvas – in offline mode (fast-render's driver: no loop of its own, its world at its
 * viewport's scale), into a canvas of its viewport's size. This stage runs the one animation loop: each frame it lets the
 * runner catch restarts, has every arena step and draw, and composes them into the visible canvas – the viewports tile
 * the centred square the recorder crops, so a recording holds the whole race – with the arena labels, the race banner
 * (who escaped / finished first, and when), the watermark, the Top / Bottom Text and the captions on top.
 * Canvas.tsx exports its component wrapped in this; with one arena it renders the canvas as it always did.
 */

type CanvasComponent = ForwardRefExoticComponent<CanvasProps & RefAttributes<CanvasHandle>>;

/** The banner's words, from the page (translated). */
export interface SplitScreenLabels {
  escaped: (label: string) => string;
  finished: (label: string) => string;
  tie: (labels: string) => string;
  seconds: (seconds: string) => string;
}

/** What the page hands the canvas during a race (null / one engine: the single canvas). */
export interface SplitScreenCanvasOptions {
  runner: MultiArenaRunner;
  /** The arenas' engines, the page's first. */
  engines: readonly PhysicsEngine[];
  layout: ArenaLayout;
  /** Each arena's label and colour (its ball colour). */
  labels: readonly string[];
  colors: readonly string[];
  /** Every arena's sounds are heard (else the first arena's only: the others' character chirps stay quiet too). */
  soundAll: boolean;
  text?: SplitScreenLabels;
}

const DEFAULT_TEXT: SplitScreenLabels = {
  escaped: (label) => `${label} escaped first!`,
  finished: (label) => `${label} finished first!`,
  tie: (labels) => `${labels} tie!`,
  seconds: (s) => `${s} s`,
};
const MEDALS = ["🥇", "🥈", "🥉", "4"];
const TWO_PI = Math.PI * 2;
/** How often (ms) the race's numbers are mirrored onto the element (data-split-*) for tools and the smoke test. */
const DATASET_MS = 150;

interface ArenaSlot {
  renderer: OfflineFrameRenderer | null;
  /** The stage clock when this arena drew its first frame (its own clock counts from there); NaN before. */
  origin: number;
}

export function withSplitScreen(Inner: CanvasComponent): CanvasComponent {
  const CanvasWithSplitScreen = forwardRef<CanvasHandle, CanvasProps>(function CanvasWithSplitScreen(props, ref) {
    const split = props.splitScreen ?? null;
    if (!split || split.engines.length < 2) return <Inner {...props} ref={ref} />;
    return <SplitScreenStage props={props} split={split} Inner={Inner} handleRef={ref} />;
  });
  return CanvasWithSplitScreen;
}

/** The page's background look (the canvas' sides and the recording's letterbox bars show it, like a single canvas). */
function lookOf(p: CanvasProps, image: HTMLImageElement | null): BackgroundLook {
  return { type: p.backgroundType ?? "solid", colors: p.backgroundColors ?? DEFAULT_BACKGROUND_COLORS, dim: p.backgroundDim ?? 0.35, image };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function SplitScreenStage({ props, split, Inner, handleRef }: { props: CanvasProps; split: SplitScreenCanvasOptions; Inner: CanvasComponent; handleRef: ForwardedRef<CanvasHandle> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number; dpr: number } | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const splitRef = useRef(split);
  splitRef.current = split;
  const slotsRef = useRef<ArenaSlot[]>([]);
  /** The stage clock (performance.now() of the frame being drawn), which every arena's driver reads relative to its origin. */
  const clockRef = useRef(0);
  const fpsRef = useRef(60);
  const recordingRef = useRef(false);
  const clipStartRef = useRef(0);
  const exportSizeRef = useRef<{ width: number; height: number } | null>(null);
  const songProgressRef = useRef<number | null>(null);
  const captionLayerRef = useRef<CaptionLayer | null>(null);
  const painterRef = useRef<BackgroundPainter | null>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);

  // The background picture (the letterbox bars and the canvas' sides show it, like a single canvas).
  const backgroundImage = props.backgroundImage ?? null;
  useEffect(() => {
    if (!backgroundImage) {
      bgImageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
    };
    img.src = backgroundImage;
    return () => {
      img.onload = null;
    };
  }, [backgroundImage]);

  // The canvas' size (CSS px) and device pixel ratio; the runner lays the arenas' worlds out from it.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (!(r.width > 0 && r.height > 0)) return;
      setSize((prev) => (prev && Math.abs(prev.width - r.width) < 0.5 && Math.abs(prev.height - r.height) < 0.5 && prev.dpr === dpr ? prev : { width: r.width, height: r.height, dpr }));
    };
    measure();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const count = split.engines.length;
  const viewports = useMemo<ArenaViewport[]>(() => (size ? arenaViewports(size.width, size.height, count, split.layout) : []), [size, count, split.layout]);
  // Before the arenas draw (their effects are passive): the engines get their worlds (a run that has not started starts over in it).
  const runner = split.runner;
  useLayoutEffect(() => {
    if (size) runner.setCanvasSize(size.width, size.height);
  }, [runner, size, count, split.layout]);

  // One driver per arena: its world, drawn at the viewport's scale in device px, on the stage clock from its first frame.
  const drivers = useMemo<OfflineCanvasDriver[]>(() => {
    const dpr = size?.dpr ?? 1;
    return viewports.map((vp, i) => {
      const slot = (slotsRef.current[i] ??= { renderer: null, origin: NaN });
      return {
        worldWidth: vp.world.width,
        worldHeight: vp.world.height,
        scale: dpr * vp.scale,
        exportWidth: vp.world.width,
        exportHeight: vp.world.height,
        frameMs: 1000 / 60,
        now: () => clockRef.current - (Number.isNaN(slot.origin) ? clockRef.current : slot.origin),
        attach: (renderer) => {
          slot.renderer = renderer;
          slot.origin = NaN;
        },
      };
    });
  }, [viewports, size?.dpr]);

  useImperativeHandle(handleRef, () => ({
    getCanvas: () => canvasRef.current,
    setRecording: (v: boolean, exportSize?: { width: number; height: number }) => {
      if (v && !recordingRef.current) clipStartRef.current = performance.now();
      recordingRef.current = v;
      exportSizeRef.current = v ? (exportSize ?? null) : null;
    },
    setAudioIntensity: () => {},
    setSongProgress: (v: number | null) => {
      songProgressRef.current = v;
      slotsRef.current[0]?.renderer?.setSongProgress(v);
    },
    fpsRef,
    noteWallBreak: () => slotsRef.current[0]?.renderer?.noteWallBreak(),
    paintRecordingBackground: (c: CanvasRenderingContext2D, width: number, height: number, crop: RecordingCrop) => (painterRef.current ??= new BackgroundPainter()).paintExport(c, width, height, crop, lookOf(propsRef.current, bgImageRef.current)),
    holdsEndScreen: () =>
      slotsRef.current.some((s, i) => i < splitRef.current.engines.length && !!s.renderer?.holdsEndScreen()) ||
      (captionLayerRef.current?.holdsEndScreen() ?? false) ||
      splitRef.current.runner.holding(performance.now(), SPLIT_FINISH_HOLD_MS),
  }));

  // The one loop: restarts caught, every arena stepped and drawn, the frame composed.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = size.dpr;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const W = size.width;
    const H = size.height;
    const side = Math.min(W, H);
    const ox = (W - side) / 2;
    const oy = (H - side) / 2;
    const captionLayer = (captionLayerRef.current ??= new CaptionLayer());
    const painter = (painterRef.current ??= new BackgroundPainter());
    const captionView: CaptionView = { width: W, height: H, insetTop: 0, insetBottom: 0, topMin: 0, bottomMax: Infinity, dtMs: 0, clipTimeSec: -1 };
    const edgeLines = emptyEdgeTextLines();
    const exportText = { fontSize: 0, topY: 0, bottomY: 0 };
    let raf = 0;
    let last = 0;
    let lastData = 0;
    let bannerVersion = -1;
    let bannerNames: readonly string[] | null = null;
    let bannerText = "";
    let bannerSub = "";
    let bannerSince = 0; // when the banner (re)appeared: it pops in
    let labelTimes: string[] = [];
    let labelPlaces: number[] = [];
    const setData = (key: string, value: string) => {
      if (canvas.dataset[key] !== value) canvas.dataset[key] = value;
    };

    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      if (now - last < 15) return;
      const dt = last > 0 ? Math.min(now - last, 100) : 16.7;
      last = now;
      const sp = splitRef.current;
      const p = propsRef.current;
      const runner = sp.runner;
      const slots = slotsRef.current;
      const n = Math.min(viewports.length, sp.engines.length);
      clockRef.current = now;
      runner.beforeFrame();
      for (let i = 0; i < n; i++) {
        const slot = slots[i];
        if (!slot?.renderer) continue;
        if (Number.isNaN(slot.origin)) slot.origin = now;
        slot.renderer.renderFrame();
      }
      runner.afterFrame(now);

      // The frame: the background (the canvas' sides show it), the arenas, their borders and labels.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = p.backgroundColor ?? "#0a0a0a";
      ctx.fillRect(0, 0, W, H);
      painter.paint(ctx, W, H, lookOf(p, bgImageRef.current), dpr);
      for (let i = 0; i < n; i++) {
        const r = slots[i]?.renderer;
        const vp = viewports[i];
        if (r && r.canvas.width > 0 && r.canvas.height > 0) ctx.drawImage(r.canvas, vp.x, vp.y, vp.width, vp.height);
      }
      const lineW = Math.max(1.5, 0.004 * side);
      ctx.save();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.22)";
      ctx.lineWidth = lineW;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const vp = viewports[i];
        if (vp.x + vp.width < ox + side - 1) {
          ctx.moveTo(vp.x + vp.width, vp.y + 4);
          ctx.lineTo(vp.x + vp.width, vp.y + vp.height - 4);
        }
        if (vp.y + vp.height < oy + side - 1) {
          ctx.moveTo(vp.x + 4, vp.y + vp.height);
          ctx.lineTo(vp.x + vp.width - 4, vp.y + vp.height);
        }
      }
      ctx.stroke();
      ctx.restore();

      // The race: arena labels with each arena's time and place, the banner of the first escape / finish.
      const standings = runner.standings();
      const version = runner.version();
      if (version !== bannerVersion || sp.labels !== bannerNames) {
        bannerVersion = version;
        bannerNames = sp.labels;
        const text = sp.text ?? DEFAULT_TEXT;
        const marks = runner.marksOf();
        labelTimes = sp.labels.map((_, i) => {
          const m = marks[i];
          const ms = m ? (m.escapeMs >= 0 ? m.escapeMs : m.finishMs) : -1;
          return ms >= 0 ? text.seconds(formatRaceSeconds(ms)) : "";
        });
        labelPlaces = sp.labels.map((_, i) => standings.order.indexOf(i));
        let next = "";
        if (standings.winners.length > 0) {
          const names = standings.winners.map((i) => sp.labels[i] ?? String(i + 1));
          next = `🏁 ${names.length > 1 ? text.tie(names.join(" & ")) : standings.kind === "escaped" ? text.escaped(names[0]) : text.finished(names[0])}`;
          bannerSub = text.seconds(formatRaceSeconds(standings.timeMs));
        }
        if (next !== bannerText) bannerSince = now;
        bannerText = next;
      }
      // Live, a canvas about as wide as it is tall has the page's buttons over its corners: the labels keep clear of them.
      const live = !recordingRef.current && (W - side) / 2 < 170;
      for (let i = 0; i < n; i++) {
        const vp = viewports[i];
        const fs = Math.max(10, Math.min(26, 0.07 * Math.min(vp.width, vp.height)));
        // The bottom row's labels sit at its bottom edge, away from the banner between the rows.
        const bottomRow = vp.y > oy + 1 && vp.y + vp.height >= oy + side - 1;
        const label = sp.labels[i] ?? String(i + 1);
        const place = labelPlaces[i] ?? -1;
        const time = labelTimes[i] ?? "";
        const text = place >= 0 ? `${MEDALS[place] ?? place + 1} ${label} · ${time}` : label;
        ctx.save();
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textBaseline = "middle";
        const pad = 0.45 * fs;
        const dot = 0.55 * fs;
        const w = ctx.measureText(text).width + 2 * pad + dot + 0.4 * fs;
        const h = 1.6 * fs;
        const x = vp.x + 0.35 * fs;
        const y = bottomRow ? vp.y + vp.height - 0.35 * fs - h - (live ? 56 : 0) : vp.y + 0.35 * fs + (live && vp.y <= oy + 1 ? 52 : 0);
        roundRect(ctx, x, y, w, h, h / 2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = place === 0 ? ACCENT : "rgba(255, 255, 255, 0.25)";
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x + pad + dot / 2, y + h / 2, dot / 2, 0, TWO_PI);
        ctx.fillStyle = sp.colors[i] ?? ACCENT;
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillText(text, x + pad + dot + 0.4 * fs, y + h / 2 + 0.5);
        ctx.restore();
      }
      // The watermark, once, faint in the middle of the square (the arenas draw none of their own).
      if (p.watermarkText) {
        ctx.save();
        const fs = Math.max(14, 0.045 * side);
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = 0.15;
        ctx.fillStyle = "#ffffff";
        ctx.fillText(p.watermarkText, ox + side / 2, bannerText && sp.layout === "grid" ? oy + 0.5 * side + 1.6 * fs : oy + side / 2);
        ctx.restore();
      }

      if (bannerText) {
        const fs = Math.max(14, 0.05 * side);
        const age = now - bannerSince;
        const pop = age < 280 ? 0.7 + 0.3 * Math.sin((Math.PI / 2) * (age / 280)) : 1;
        const cy = oy + bannerAnchor(sp.layout, n) * side;
        ctx.save();
        ctx.translate(ox + side / 2, cy);
        ctx.scale(pop, pop);
        ctx.font = `bold ${fs}px sans-serif`;
        const w1 = ctx.measureText(bannerText).width;
        ctx.font = `${0.6 * fs}px sans-serif`;
        const w2 = ctx.measureText(bannerSub).width;
        const w = Math.min(0.96 * side, Math.max(w1, w2) + 1.6 * fs);
        const h = 2.3 * fs;
        roundRect(ctx, -w / 2, -h / 2, w, h, 0.5 * fs);
        ctx.fillStyle = "rgba(8, 10, 6, 0.82)";
        ctx.shadowColor = ACCENT;
        ctx.shadowBlur = 18;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.lineWidth = 2;
        ctx.strokeStyle = ACCENT;
        ctx.stroke();
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.fillText(bannerText, 0, -0.38 * fs, 0.92 * side);
        ctx.fillStyle = ACCENT;
        ctx.font = `bold ${0.6 * fs}px sans-serif`;
        ctx.fillText(bannerSub, 0, 0.62 * fs);
        ctx.restore();
      }

      // Top / Bottom Text (the recorder draws its own copy at export resolution while it records).
      const cy = oy + side / 2;
      const hasTop = !!p.topText;
      const hasBottom = !!p.bottomText;
      liveEdgeTextLines(side, cy, 0.85 * (side / 2), p.textSize ?? 1, hasTop, hasBottom, edgeLines);
      if ((hasTop || hasBottom) && !recordingRef.current) {
        ctx.save();
        ctx.font = `bold ${edgeLines.fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = 0.95;
        ctx.shadowColor = "rgba(0, 0, 0, 0.7)";
        ctx.shadowBlur = 8;
        if (p.topText) ctx.fillText(p.topText, W / 2, edgeLines.topY);
        if (p.bottomText) ctx.fillText(p.bottomText, W / 2, edgeLines.bottomY);
        ctx.restore();
      }

      // The captions over the whole square, on the first arena's run (its clock, walls and finish).
      const captionOptions = p.captions ?? null;
      const playing = !p.isPaused && !!p.isStarted;
      if (captionOptions && sp.engines[0]) {
        const live = !recordingRef.current && (W - side) / 2 < 170;
        const exportSize = recordingRef.current ? exportSizeRef.current : null;
        if (exportSize && (hasTop || hasBottom)) {
          recordingTextLayout(exportSize.width, exportSize.height, p.textSize ?? 1, exportText);
          exportEdgeTextLines(exportText, exportSize.width, exportSize.height, side, oy, hasTop, hasBottom, edgeLines);
        }
        captionView.insetTop = live ? 52 : 0;
        captionView.insetBottom = live ? 56 : 0;
        edgeTextBounds(edgeLines, 0, captionView);
        captionView.dtMs = playing ? dt : 0;
        captionView.clipTimeSec = recordingRef.current ? Math.max(0, now - clipStartRef.current) / 1000 : -1;
        captionLayer.draw(ctx, sp.engines[0], captionOptions, captionView);
      } else captionLayer.clear();

      // The race's numbers on the element, for tools and the smoke test.
      if (now - lastData >= DATASET_MS) {
        lastData = now;
        const engines = sp.engines;
        setData("split", String(n));
        setData("splitLayout", sp.layout);
        setData("splitSound", sp.soundAll ? "all" : "first");
        setData("splitViewports", viewports.map((v) => `${Math.round(v.x)},${Math.round(v.y)},${Math.round(v.width)},${Math.round(v.height)}`).join(";"));
        setData("splitWorlds", engines.map((e) => `${Math.round(e.config.width)}x${Math.round(e.config.height)}`).join(";"));
        setData("splitDrawn", String(slots.slice(0, n).filter((s) => s?.renderer && !Number.isNaN(s.origin)).length));
        setData("splitElapsed", engines.map((e) => String(Math.round(e.getElapsedMs()))).join(","));
        setData("splitSeeds", engines.map((e) => String(e.getSeed())).join(","));
        setData("splitModes", engines.map((e) => e.getCurrentModeName()).join(","));
        setData("splitGravity", engines.map((e) => String(e.config.gravity)).join(","));
        setData("splitSpeed", engines.map((e) => String(e.config.ballSpeed)).join(","));
        setData("splitBalls", engines.map((e) => String(e.getBalls().length)).join(","));
        setData("splitParticles", String(engines.reduce((sum, e) => sum + e.getParticles().length, 0)));
        setData("splitLabels", sp.labels.join(","));
        setData("splitMarks", runner.marksOf().map((m) => (m.escapeMs >= 0 ? `e${Math.round(m.escapeMs)}` : m.finishMs >= 0 ? `f${Math.round(m.finishMs)}` : "-")).join(","));
        setData("splitFinish", runner.marksOf().map((m) => (m.finishMs >= 0 ? String(Math.round(m.finishMs)) : "-")).join(","));
        setData("splitWinner", standings.winners.map((i) => sp.labels[i] ?? String(i + 1)).join("&"));
        setData("splitWinnerMs", standings.timeMs >= 0 ? String(Math.round(standings.timeMs)) : "");
        setData("splitKind", standings.kind ?? "");
        setData("splitBanner", bannerText ? "1" : "0");
        setData("splitFinished", runner.allFinished() ? "1" : "0");
      }
      fpsRef.current = 0.9 * fpsRef.current + 0.1 * (1000 / Math.max(1, dt));
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [size, viewports]);

  // The data attributes go with the race.
  useEffect(() => {
    const canvas = canvasRef.current;
    return () => {
      if (!canvas) return;
      for (const key of Object.keys(canvas.dataset)) if (key.startsWith("split")) delete canvas.dataset[key];
    };
  }, []);

  return (
    <>
      <canvas ref={canvasRef} className="w-full h-full rounded-lg" style={{ display: "block" }} data-testid="split-screen-canvas" />
      {drivers.map((driver, i) => {
        const engine = split.engines[i];
        if (!engine) return null;
        return (
          <Inner
            key={i}
            {...props}
            physicsEngine={engine}
            offline={driver}
            fastRender={null}
            splitScreen={null}
            captions={null}
            watermarkText=""
            topText=""
            bottomText=""
            audioIntensity={0}
            obstacleEditing={false}
            onObstaclesChange={undefined}
            onCharacterChirp={i === 0 || split.soundAll ? props.onCharacterChirp : undefined}
          />
        );
      })}
    </>
  );
}
