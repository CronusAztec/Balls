"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { assetPath } from "@/lib/site";
import type { ModeId } from "@/lib/physics/types";
import { cx } from "@/components/ui/cx";
import type { LiveFrame } from "@/lib/watermark/live"; // --- watermark-everywhere ---

/*
 * --- site-redesign --- The hero's live, muted mini simulation in a 9:16 phone frame: the real engine with a fixed seed
 * (livePreviewEngine.ts, loaded after the page is up), rotating through a few modes every 8 s. It pauses while it is
 * scrolled out of view or the tab is hidden. With prefers-reduced-motion, or when the engine cannot start, the frame shows
 * the mode's preview picture instead (a background picture, not an <img>: the mode cards stay the page's only <img> of
 * each preview). A click opens the playing mode in the studio.
 * --- studio-first-open --- The picture is always there, under the canvas, and the canvas fades in over it once it has drawn
 * its first frame (it was black for seconds while the engine loaded). The engine's chunk loads only when at least half the
 * frame is in view and the browser is idle (4 s at most), so it never freezes a first screen it is not on; with Save-Data or
 * a slow connection (2g, 3g) the picture stays, as with reduced motion. The dots under the frame are buttons: each shows its
 * mode in the frame.
 */

const MODES: readonly ModeId[] = ["classic", "multiply", "drop", "grow"];
const ROTATE_MS = 8000;
const FRAME_W = 270;
const FRAME_H = 480;

/** --- studio-first-open --- The two modules the live frame needs, loaded together once the frame is half in view. */
type PreviewModules = typeof import("./livePreviewEngine") & Pick<typeof import("@/lib/watermark/live"), "stampLiveFrame">;

/** --- studio-first-open --- The visitor asks to save data, or the connection is slow: the picture stays. */
function lightweight(): boolean {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return !!connection && (connection.saveData === true || /^(slow-2g|2g|3g)$/.test(connection.effectiveType ?? ""));
}

export default function LivePreview() {
  const t = useTranslations("SiteRedesign");
  const modes = useTranslations("Modes");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const modulesRef = useRef<PreviewModules | null>(null); // --- studio-first-open ---
  const [index, setIndex] = useState(0);
  const [rotation, setRotation] = useState(0); // --- studio-first-open --- (a dot picked starts the 8 s again)
  // null until mounted (the static HTML shows the picture); then "still" (reduced motion, Save-Data, a slow connection, an
  // engine that cannot start), "wait" (the picture, until the frame is half in view and the browser idle) or "live".
  const [view, setView] = useState<"live" | "wait" | "still" | null>(null);
  // --- studio-first-open --- the mode whose picture is under the canvas once the canvas has drawn (null before): the canvas
  // covers it from then on, so the picture stops following the rotation
  const [drawn, setDrawn] = useState<ModeId | null>(null);
  const mode = MODES[index];

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setView(reduce.matches || lightweight() ? "still" : modulesRef.current ? "live" : "wait");
    decide();
    reduce.addEventListener("change", decide);
    return () => reduce.removeEventListener("change", decide);
  }, []);

  // Rotate through the modes (also in the still view, so the picture changes with the caption).
  useEffect(() => {
    if (view === null) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") setIndex((i) => (i + 1) % MODES.length);
    }, ROTATE_MS);
    return () => clearInterval(id);
  }, [view, rotation]);

  // --- studio-first-open --- the engine's chunk: once at least half the frame is in view, when the browser is idle
  useEffect(() => {
    if (view !== "wait") return;
    const frame = frameRef.current;
    if (!frame) return;
    let cancelled = false;
    let idle = 0;
    let timer = 0;
    // (--- watermark-everywhere --- with the live watermark's module)
    const load = () => {
      Promise.all([import("./livePreviewEngine"), import("@/lib/watermark/live")])
        .then(([engine, { stampLiveFrame }]) => {
          if (cancelled) return;
          modulesRef.current = { ...engine, stampLiveFrame };
          setView("live");
        })
        .catch((err: unknown) => {
          console.warn("Live preview unavailable:", err);
          if (!cancelled) setView("still");
        });
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry || entry.intersectionRatio < 0.5) return;
        observer.disconnect();
        if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(load, { timeout: 4000 });
        else timer = window.setTimeout(load, 300);
      },
      { threshold: 0.5 },
    );
    observer.observe(frame);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (idle) window.cancelIdleCallback(idle);
      window.clearTimeout(timer);
    };
  }, [view]);

  useEffect(() => {
    if (view !== "live") return;
    const modules = modulesRef.current;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!modules || !canvas || !frame) return;
    const { createPreviewEngine, drawPreview, stepPreview, stampLiveFrame } = modules;
    let cancelled = false;
    let raf = 0;
    let visible = true;
    let last = 0;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) schedule();
    });
    const schedule = () => {
      if (!raf && visible && document.visibilityState === "visible" && !cancelled) raf = requestAnimationFrame(tick);
    };
    let tick: (now: number) => void = () => {};
    const onVisibility = () => {
      last = 0;
      schedule();
    };
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no 2d context");
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = FRAME_W * dpr;
      canvas.height = FRAME_H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const engine = createPreviewEngine(mode, FRAME_W, FRAME_H);
      const styles = getComputedStyle(frame);
      const palette = {
        background: "#000000",
        wall: styles.getPropertyValue("--color-ink").trim() || "#f2f2ed",
        ball: styles.getPropertyValue("--color-accent").trim() || "#b0f02a",
        ballAlt: styles.getPropertyValue("--color-ink").trim() || "#f2f2ed",
      };
      const state = { acc: 0 };
      // --- watermark-everywhere --- a free visitor's preview carries the watermark too, drawn into its pixels after each frame
      // (lib/watermark/live.ts – the same gate and mark as the studio's canvas; the whole phone frame is its area)
      const mark: LiveFrame = { canvas, ctx, nowMs: performance.now(), area: { x: 0, y: 0, width: canvas.width, height: canvas.height } };
      drawPreview(ctx, engine, FRAME_W, FRAME_H, palette);
      stampLiveFrame(mark);
      setDrawn((shown) => shown ?? mode); // --- studio-first-open --- the first frame is drawn (and marked): the canvas fades in
      tick = (now: number) => {
        raf = 0;
        if (cancelled || !visible || document.visibilityState !== "visible") return;
        const frameMs = last ? Math.min(now - last, 100) : 16.666;
        last = now;
        stepPreview(engine, state, frameMs);
        drawPreview(ctx, engine, FRAME_W, FRAME_H, palette);
        mark.nowMs = now;
        stampLiveFrame(mark); // --- watermark-everywhere --- (the frame's last pass)
        schedule();
      };
      observer.observe(frame);
      document.addEventListener("visibilitychange", onVisibility);
      schedule();
    } catch (err: unknown) {
      console.warn("Live preview unavailable:", err);
      setView("still");
    }
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [view, mode]);

  const name = modes(`${mode}.name`);
  const live = view === "live" && drawn !== null;
  const picture = live && drawn ? drawn : mode; // --- studio-first-open --- (the picture under a drawn canvas stays put)
  return (
    <figure className="mx-auto w-[min(270px,72vw)] lg:mx-0" aria-label={t("hero.previewLabel", { mode: name })}>
      {/* --- perf-pass --- the "Live" / "9:16" badges sit over the frame but outside the link: a link whose accessible name does not contain its
          visible text fails WCAG 2.5.3 (label in name), and the badges are decoration, so the link carries no text and is named by its label */}
      <div className="relative">
        <Link href={`/simulator?mode=${mode}`} className="group block rounded-[var(--radius-stage)]" aria-label={t("hero.previewOpen", { mode: name })} data-testid="live-preview">
          <div ref={frameRef} className="relative aspect-[9/16] overflow-hidden rounded-[var(--radius-stage)] border border-line-strong bg-black transition-colors duration-150 group-hover:border-ink-3">
            <div aria-hidden="true" className="absolute inset-0 bg-black bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${assetPath(`/modes/${picture}.webp`)}")` }} />
            {view === "live" && <canvas ref={canvasRef} className={cx("absolute inset-0 h-full w-full transition-opacity duration-500", drawn ? "opacity-100" : "opacity-0")} aria-hidden="true" />}
          </div>
        </Link>
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-px top-px flex items-center justify-between px-3 pt-3">
          <span className="eyebrow inline-flex items-center gap-1.5 text-ink-2">
            <span className={cx("h-1.5 w-1.5 rounded-full", live ? "bg-accent" : "bg-ink-3")} />
            {live ? t("hero.live") : t("hero.preview")}
          </span>
          <span className="eyebrow text-ink-3">9:16</span>
        </div>
      </div>
      <figcaption className="mt-2 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-ink">{name}</span>
        {/* --- studio-first-open --- the dots are buttons: each shows its mode in the frame (and the 8 s start again) */}
        <span className="-mr-2 flex shrink-0 items-center">
          {MODES.map((m, i) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setIndex(i);
                setRotation((r) => r + 1);
              }}
              aria-label={modes(`${m}.name`)}
              aria-pressed={i === index}
              className="group/dot inline-flex h-8 w-6 items-center justify-center cursor-pointer [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-9"
            >
              <span aria-hidden="true" className={cx("h-1 rounded-full transition-all duration-200", i === index ? "w-4 bg-ink" : "w-1.5 bg-surface-3 group-hover/dot:bg-ink-3")} />
            </button>
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
