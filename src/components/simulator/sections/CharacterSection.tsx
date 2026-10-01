"use client";

import { useEffect, useRef } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { drawCatEars, drawFace, type FaceView } from "../faceRenderer";
import { GERALD_PERSONA, FACE_STYLES, MAX_NAME_LENGTH, geraldPersonaPatch, type FaceStyle } from "@/lib/character/character";
import type { Expression } from "@/lib/character/expression";
import { BlinkClock, lookTarget, squashAmount, squashScales, type Vec } from "@/lib/character/eyes";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface CharacterSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** The custom ball picture (data: URL) or emoji, if any: the preview wears it and the "face over image" switch appears. */
  ballImage: string | null;
  ballEmoji: string | null;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx). */
export const CHARACTER_KEYS = ["ballFace", "ballName", "nameLabel", "ballSquash", "faceOverImage", "faceSounds", "geraldPersona"];

const FACE_OPTIONS: Record<FaceStyle, { labelKey: string }> = {
  none: { labelKey: "faceNone" },
  dot: { labelKey: "faceDot" },
  cute: { labelKey: "faceCute" },
  cool: { labelKey: "faceCool" },
  cat: { labelKey: "faceCat" },
  angry: { labelKey: "faceAngry" },
};

/** The preview acts out every expression in a loop: [expression, ms]. */
const PREVIEW_SCRIPT: readonly [Expression, number][] = [
  ["neutral", 1800],
  ["ouch", 420],
  ["neutral", 900],
  ["shock", 750],
  ["grin", 1000],
  ["happy", 1300],
];
const PREVIEW_LOOP_MS = PREVIEW_SCRIPT.reduce((sum, [, ms]) => sum + ms, 0);
const PREVIEW_SIZE = 76;

/**
 * The live swatch: the ball (its colour, emoji or picture) wearing the chosen face, looking around, blinking on a
 * seeded schedule and running through ouch → shock → grin → happy, squashing on the "ouch" when squash is on – drawn
 * with the same code as the simulator canvas. It animates only while it is on screen (the section is open).
 */
function FacePreview({ settings, ballImage, ballEmoji, label }: { settings: SimulatorSettings; ballImage: string | null; ballEmoji: string | null; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef({ settings, ballEmoji, image: null as HTMLImageElement | null });
  stateRef.current.settings = settings;
  stateRef.current.ballEmoji = ballEmoji;

  useEffect(() => {
    if (!ballImage) {
      stateRef.current.image = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      stateRef.current.image = img;
    };
    img.src = ballImage;
    return () => {
      img.onload = null;
    };
  }, [ballImage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = PREVIEW_SIZE * dpr;
    canvas.height = PREVIEW_SIZE * dpr;
    const blink = new BlinkClock(0x5eed);
    const look: Vec = { x: 0, y: 0 };
    const scales: Vec = { x: 1, y: 1 };
    const view: FaceView = { expression: "neutral", closure: 0, lookX: 0, lookY: 0 };
    const t0 = performance.now();
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const { settings: s, ballEmoji: emoji, image } = stateRef.current;
      const t = performance.now() - t0;
      let at = t % PREVIEW_LOOP_MS;
      let expression: Expression = "neutral";
      let since = 0;
      for (const [e, ms] of PREVIEW_SCRIPT) {
        if (at < ms) {
          expression = e;
          since = at;
          break;
        }
        at -= ms;
      }
      // Eyes circle slowly, as if following a ball around the ring.
      lookTarget(Math.cos(t / 700), 0.7 * Math.sin(t / 700), 1, look, 0.5);
      view.expression = expression;
      view.closure = blink.closure(t);
      view.lookX = look.x;
      view.lookY = look.y;
      const size = PREVIEW_SIZE;
      const r = 0.3 * size;
      const cx = size / 2;
      const cy = size / 2 - 0.02 * size;
      const body = s.rainbowBall ? `hsl(${Math.floor((0.08 * t) % 360)}, 100%, 55%)` : s.ballColor;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);
      ctx.save();
      const d = expression === "ouch" ? squashAmount(since, 1.2, s.ballSquash) : 0;
      if (d !== 0) {
        // Squashed against an imaginary floor under the ball.
        squashScales(d, scales);
        ctx.translate(cx, cy + r);
        ctx.scale(scales.y, scales.x);
        ctx.translate(-cx, -(cy + r));
      }
      const sprite = !!emoji || !!image;
      const faceOn = s.ballFace !== "none" && (!sprite || s.faceOverImage);
      if (faceOn && s.ballFace === "cat") drawCatEars(ctx, cx, cy, r, body);
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      if (emoji) {
        ctx.clip();
        ctx.font = `${Math.round(2.1 * r)}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(emoji, cx, cy + 0.12 * r);
      } else if (image) {
        ctx.clip();
        ctx.drawImage(image, cx - r, cy - r, 2 * r, 2 * r);
      } else {
        ctx.fillStyle = body;
        ctx.fill();
      }
      ctx.restore();
      if (faceOn) drawFace(ctx, cx, cy, r, s.ballFace, view, body);
      ctx.restore();
    };
    frame();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <canvas
        ref={canvasRef}
        data-testid="face-preview"
        data-face={settings.ballFace}
        aria-hidden="true"
        className="rounded-xl bg-bg border border-line-strong/70"
        style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}
      />
      {label && <span className="text-xs font-semibold text-ink-2 max-w-[76px] truncate">{label}</span>}
    </div>
  );
}

/**
 * "Character" group at the top of the Ball & Physics section: the face (with a live preview), the name label,
 * squash-and-stretch, the face over a custom picture, the cat's chirps and the "Meet Gerald" persona button. The
 * values live in SimulatorSettings (see lib/character/character.ts) and only the canvas reads them – nothing here
 * touches the physics, so seeds and found simulations stay valid.
 */
export default function CharacterSection({ t, search, matches, settings: s, update, ballImage, ballEmoji }: CharacterSectionProps) {
  const hasSprite = !!ballImage || !!ballEmoji;
  const showLabelToggle = !!s.ballName || !!search;
  const showOverImage = (hasSprite && s.ballFace !== "none") || !!search;
  const showSounds = s.ballFace === "cat" || !!search;
  const body = (
    <>
      {!search && (
        <div className="flex items-center justify-between gap-2">
          <label className="text-sm font-medium text-ink-2">
            {t("character")}
            <Tooltip text={t("characterTip")} />
          </label>
        </div>
      )}
      <Searchable search={search} matches={matches} labelKey="ballFace">
        <div className="flex items-start gap-3">
          <FacePreview settings={s} ballImage={ballImage} ballEmoji={ballEmoji} label={s.nameLabel ? s.ballName : ""} />
          <div className="flex-1 space-y-2 min-w-0">
            <label className="text-sm font-medium text-ink-2">
              {t("ballFace")}
              <Tooltip text={t("ballFaceTip")} />
            </label>
            <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("ballFace")}>
              {FACE_STYLES.map((style) => (
                <button
                  type="button"
                  key={style}
                  onClick={() => update({ ballFace: style })}
                  aria-pressed={s.ballFace === style}
                  className={`px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer truncate ${s.ballFace === style ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
                >
                  {t(FACE_OPTIONS[style].labelKey)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="geraldPersona">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-ink-3 leading-relaxed">{t("geraldPersonaDesc")}</p>
          <button
            type="button"
            onClick={() => update(geraldPersonaPatch(s))}
            aria-pressed={s.ballFace === GERALD_PERSONA.ballFace && s.ballName === GERALD_PERSONA.ballName}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-surface-2 text-accent border border-accent/40 hover:bg-surface-3"
          >
            {t("geraldPersona")}
          </button>
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="ballName">
        <div className="space-y-2">
          <label className="text-sm font-medium text-ink-2 flex items-center" htmlFor="ball-name-input">
            {t("ballName")}
            <Tooltip text={t("ballNameTip")} />
          </label>
          <input
            id="ball-name-input"
            type="text"
            value={s.ballName}
            onChange={(e) => update({ ballName: e.target.value.slice(0, MAX_NAME_LENGTH) })}
            placeholder={t("ballNamePlaceholder")}
            maxLength={MAX_NAME_LENGTH}
            className="w-full px-3 py-2 bg-surface-2 text-ink rounded-lg border border-line-strong focus:border-accent-dim placeholder:text-ink-3 text-sm"
          />
        </div>
      </Searchable>
      {showLabelToggle && (
        <Searchable search={search} matches={matches} labelKey="nameLabel">
          <Toggle t={t} labelKey="nameLabel" tipKey="nameLabelTip" value={s.nameLabel} onChange={(v) => update({ nameLabel: v })} caseStyle="title" />
        </Searchable>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="ballSquash" tipKey="ballSquashTip" value={s.ballSquash} range={RANGES.ballSquash} onChange={(v) => update({ ballSquash: v })} display={`${Math.round(100 * s.ballSquash)}%`} />
      {showOverImage && (
        <Searchable search={search} matches={matches} labelKey="faceOverImage">
          <Toggle t={t} labelKey="faceOverImage" tipKey="faceOverImageTip" value={s.faceOverImage} onChange={(v) => update({ faceOverImage: v })} caseStyle="title" />
        </Searchable>
      )}
      {showSounds && (
        <Searchable search={search} matches={matches} labelKey="faceSounds">
          <div className="space-y-1">
            <Toggle t={t} labelKey="faceSounds" tipKey="faceSoundsTip" value={s.faceSounds} onChange={(v) => update({ faceSounds: v })} caseStyle="title" />
            {s.faceSounds && s.hitSoundMode === "sample" && <p className="text-xs text-warn/90">{t("faceSoundsSampleNote")}</p>}
          </div>
        </Searchable>
      )}
    </>
  );
  // While searching, the matching controls stand on their own like every other control of the section.
  return search ? body : <div className="space-y-4 pb-3 border-b border-line">{body}</div>;
}
