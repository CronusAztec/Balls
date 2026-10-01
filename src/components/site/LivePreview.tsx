"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { assetPath } from "@/lib/site";
import type { ModeId } from "@/lib/physics/types";
import { cx } from "@/components/ui/cx";

/*
 * --- site-redesign --- The hero's live, muted mini simulation in a 9:16 phone frame: the real engine with a fixed seed
 * (livePreviewRenderer.ts, loaded after the page is up), rotating through a few modes every 8 s. It pauses while it is
 * scrolled out of view or the tab is hidden. With prefers-reduced-motion, or when the engine cannot start, the frame shows
 * the mode's preview picture instead (a background picture, not an <img>: the mode cards stay the page's only <img> of
 * each preview). A click opens the playing mode in the studio.
 */

const MODES: readonly ModeId[] = ["classic", "multiply", "drop", "grow"];
const ROTATE_MS = 8000;
const FRAME_W = 270;
const FRAME_H = 480;

export default function LivePreview() {
  const t = useTranslations("SiteRedesign");
  const modes = useTranslations("Modes");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  // null until mounted (the static HTML shows the picture); then "live" or "still".
  const [view, setView] = useState<"live" | "still" | null>(null);
  const mode = MODES[index];

  useEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const decide = () => setView(reduce.matches ? "still" : "live");
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
  }, [view]);

  useEffect(() => {
    if (view !== "live") return;
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
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
    import("./livePreviewRenderer")
      .then(({ createPreviewEngine, drawPreview, stepPreview }) => {
        if (cancelled) return;
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
        drawPreview(ctx, engine, FRAME_W, FRAME_H, palette);
        tick = (now: number) => {
          raf = 0;
          if (cancelled || !visible || document.visibilityState !== "visible") return;
          const frameMs = last ? Math.min(now - last, 100) : 16.666;
          last = now;
          stepPreview(engine, state, frameMs);
          drawPreview(ctx, engine, FRAME_W, FRAME_H, palette);
          schedule();
        };
        observer.observe(frame);
        document.addEventListener("visibilitychange", onVisibility);
        schedule();
      })
      .catch((err: unknown) => {
        console.warn("Live preview unavailable:", err);
        if (!cancelled) setView("still");
      });
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [view, mode]);

  const name = modes(`${mode}.name`);
  return (
    <figure className="mx-auto w-[min(270px,72vw)] lg:mx-0" aria-label={t("hero.previewLabel", { mode: name })}>
      <Link href={`/simulator?mode=${mode}`} className="group block rounded-[var(--radius-stage)]" aria-label={t("hero.previewOpen", { mode: name })} data-testid="live-preview">
        <div ref={frameRef} className="relative aspect-[9/16] overflow-hidden rounded-[var(--radius-stage)] border border-line-strong bg-black transition-colors duration-150 group-hover:border-ink-3">
          {view === "live" ? (
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
          ) : (
            <div aria-hidden="true" className="absolute inset-0 bg-black bg-contain bg-center bg-no-repeat" style={{ backgroundImage: `url("${assetPath(`/modes/${mode}.webp`)}")` }} />
          )}
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-3">
            <span className="eyebrow inline-flex items-center gap-1.5 text-ink-2">
              <span className={cx("h-1.5 w-1.5 rounded-full", view === "live" ? "bg-accent" : "bg-ink-3")} />
              {view === "live" ? t("hero.live") : t("hero.preview")}
            </span>
            <span className="eyebrow text-ink-3">9:16</span>
          </div>
        </div>
      </Link>
      <figcaption className="mt-3 flex items-center justify-between gap-3">
        <span className="truncate text-sm font-medium text-ink">{name}</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {MODES.map((m, i) => (
            <span key={m} className={cx("h-1 rounded-full transition-all duration-200", i === index ? "w-4 bg-ink" : "w-1.5 bg-surface-3")} />
          ))}
        </span>
      </figcaption>
    </figure>
  );
}
