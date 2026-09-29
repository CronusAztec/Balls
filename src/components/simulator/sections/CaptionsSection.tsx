"use client";

import { useState } from "react";
import Tooltip from "../Tooltip";
import { ResetButton, Searchable, Slider, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import type { ControlSection } from "../Controls";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import {
  CAPTION_ANIMATIONS,
  CAPTION_POSITIONS,
  CAPTION_TYPES,
  MAX_CAPTIONS,
  MAX_CAPTION_ANSWER_LENGTH,
  MAX_CAPTION_TEXT_LENGTH,
  defaultCaption,
  isCaptionType,
  isOpenEnded,
  type Caption,
  type CaptionAnimation,
  type CaptionPosition,
  type CaptionStyle,
  type CaptionType,
} from "@/lib/captions";

export interface CaptionsSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  onReset: (section: ControlSection) => void;
}

/** Search keys of the Captions section (SECTION_KEYS.captions in Controls.tsx). */
export const CAPTION_KEYS = ["captions", "captionAdd", "captionType", "captionText", "captionAnswer", "captionPosition", "captionStart", "captionEnd", "captionAnimation", "captionSize", "captionColor", "captionBackground"];

const TYPE_LABELS: Record<CaptionType, { icon: string; labelKey: string }> = {
  countdown: { icon: "⏱️", labelKey: "captionTypeCountdown" },
  wallCounter: { icon: "🧱", labelKey: "captionTypeWallCounter" },
  progress: { icon: "▬", labelKey: "captionTypeProgress" },
  question: { icon: "❓", labelKey: "captionTypeQuestion" },
  text: { icon: "💬", labelKey: "captionTypeText" },
};
const POSITION_LABELS: Record<CaptionPosition, string> = { top: "captionTop", center: "captionCenter", bottom: "captionBottom" };
const ANIMATION_LABELS: Record<CaptionAnimation, string> = { fade: "captionFade", slide: "captionSlide", pop: "captionPop" };

/** The label and tip of a caption's text field, per type (a question's text is the question, a counter's an optional label). */
function textField(type: CaptionType): { labelKey: string; tipKey: string; placeholderKey: string } {
  if (type === "question") return { labelKey: "captionQuestion", tipKey: "captionQuestionTip", placeholderKey: "captionDefaultQuestion" };
  if (type === "text") return { labelKey: "captionText", tipKey: "captionTextTip", placeholderKey: "captionDefaultText" };
  if (type === "countdown") return { labelKey: "captionLabel", tipKey: "captionCountdownLabelTip", placeholderKey: "captionCountdownPlaceholder" };
  if (type === "wallCounter") return { labelKey: "captionLabel", tipKey: "captionWallLabelTip", placeholderKey: "captionWallPlaceholder" };
  return { labelKey: "captionLabel", tipKey: "captionProgressLabelTip", placeholderKey: "captionProgressPlaceholder" };
}

/** A new caption of `type`, with translated default texts for the question and the free text. */
function newCaption(t: Translate, type: CaptionType): Caption {
  if (type === "question") return defaultCaption(type, { text: t("captionDefaultQuestion"), answer: t("captionDefaultAnswer") });
  if (type === "text") return defaultCaption(type, { text: t("captionDefaultText") });
  return defaultCaption(type);
}

function ButtonRow<T extends string>({ t, values, labels, value, onChange, ariaLabel }: { t: Translate; values: readonly T[]; labels: Readonly<Record<string, string>>; value: T; onChange: (v: T) => void; ariaLabel: string }) {
  return (
    <div className="grid grid-cols-3 gap-1" role="group" aria-label={ariaLabel}>
      {values.map((v) => (
        <button
          type="button"
          key={v}
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={`px-2 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${value === v ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
        >
          {t(labels[v])}
        </button>
      ))}
    </div>
  );
}

/** The edit form of one caption. */
function CaptionForm({ t, caption, index, onChange }: { t: Translate; caption: Caption; index: number; onChange: (patch: Partial<Caption>) => void }) {
  const n = index + 1;
  const field = textField(caption.type);
  const setStyle = (patch: Partial<CaptionStyle>) => onChange({ style: { ...caption.style, ...patch } });
  const secs = (v: number) => t("captionSeconds", { value: v.toFixed(1).replace(/\.0$/, "") });
  const id = `caption-${index}`;
  return (
    <div className="space-y-3 pt-2">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400" htmlFor={`${id}-type`}>
          {t("captionType")}
          <Tooltip text={t("captionTypeTip")} />
        </label>
        <select id={`${id}-type`} value={caption.type} onChange={(e) => isCaptionType(e.target.value) && onChange({ type: e.target.value, answer: e.target.value === "question" ? caption.answer || t("captionDefaultAnswer") : "" })} className={selectClass}>
          {CAPTION_TYPES.map((type) => (
            <option key={type} value={type}>
              {t(TYPE_LABELS[type].labelKey)}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400" htmlFor={`${id}-text`}>
          {t(field.labelKey)}
          <Tooltip text={t(field.tipKey)} />
        </label>
        <input
          id={`${id}-text`}
          type="text"
          value={caption.text}
          onChange={(e) => onChange({ text: e.target.value })}
          maxLength={MAX_CAPTION_TEXT_LENGTH}
          placeholder={t(field.placeholderKey)}
          aria-label={t("captionTextOf", { n })}
          className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
        />
      </div>
      {caption.type === "question" && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400" htmlFor={`${id}-answer`}>
            {t("captionAnswer")}
            <Tooltip text={t("captionAnswerTip")} />
          </label>
          <input
            id={`${id}-answer`}
            type="text"
            value={caption.answer}
            onChange={(e) => onChange({ answer: e.target.value })}
            maxLength={MAX_CAPTION_ANSWER_LENGTH}
            placeholder={t("captionDefaultAnswer")}
            aria-label={t("captionAnswerOf", { n })}
            className="w-full px-3 py-2 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-sm"
          />
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">
          {t("captionPosition")}
          <Tooltip text={t("captionPositionTip")} />
        </label>
        <ButtonRow t={t} values={CAPTION_POSITIONS} labels={POSITION_LABELS} value={caption.position} onChange={(position) => onChange({ position })} ariaLabel={t("captionPositionOf", { n })} />
      </div>
      <Slider t={t} search="" matches={() => true} labelKey="captionStart" tipKey="captionStartTip" value={caption.start} range={RANGES.captionStart} onChange={(start) => onChange({ start })} display={secs(caption.start)} />
      <Slider t={t} search="" matches={() => true} labelKey="captionEnd" tipKey="captionEndTip" value={caption.end} range={RANGES.captionEnd} onChange={(end) => onChange({ end })} display={isOpenEnded(caption) ? t("captionEndOpen") : secs(caption.end)} />
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-zinc-400">
          {t("captionAnimation")}
          <Tooltip text={t("captionAnimationTip")} />
        </label>
        <ButtonRow t={t} values={CAPTION_ANIMATIONS} labels={ANIMATION_LABELS} value={caption.animation} onChange={(animation) => onChange({ animation })} ariaLabel={t("captionAnimationOf", { n })} />
      </div>
      <Slider t={t} search="" matches={() => true} labelKey="captionSize" tipKey="captionSizeTip" value={caption.style.size} range={RANGES.captionSize} onChange={(size) => setStyle({ size })} display={`${caption.style.size.toFixed(1)}×`} />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400">{t("captionColor")}</label>
          <input type="color" value={caption.style.color} onChange={(e) => setStyle({ color: e.target.value })} aria-label={t("captionColorOf", { n })} className="w-full h-9 bg-zinc-800 rounded-lg cursor-pointer border border-zinc-700" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-zinc-400 flex items-center justify-between">
            <span>
              {t("captionBackground")}
              <Tooltip text={t("captionBackgroundTip")} />
            </span>
            <button
              type="button"
              onClick={() => setStyle({ background: caption.style.background ? "" : "#000000" })}
              aria-pressed={!!caption.style.background}
              aria-label={t("captionBackgroundOf", { n })}
              className={`px-2 py-0.5 rounded-md text-[10px] font-medium transition-all cursor-pointer ${caption.style.background ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
            >
              {caption.style.background ? t("onTextCase") : t("offTextCase")}
            </button>
          </label>
          <input
            type="color"
            value={caption.style.background || "#000000"}
            disabled={!caption.style.background}
            onChange={(e) => setStyle({ background: e.target.value })}
            aria-label={t("captionBackgroundColorOf", { n })}
            className="w-full h-9 bg-zinc-800 rounded-lg cursor-pointer border border-zinc-700 disabled:opacity-30 disabled:cursor-not-allowed"
          />
        </div>
      </div>
    </div>
  );
}

/**
 * The Captions section: a row per caption (its type, a short preview and its window; a click opens its edit form –
 * type, text or label, the question's answer, position, start / end, animation, size and colours – and ✕ removes
 * it) and one "Add" button per caption type. The captions are drawn by the canvas only (captionsRenderer.ts), so
 * editing them never touches the run.
 */
export default function CaptionsSection({ t, search, matches, settings: s, update, onReset }: CaptionsSectionProps) {
  const [open, setOpen] = useState(0);
  const captions = s.captions;
  const searching = !!search;
  const listShown = !searching || CAPTION_KEYS.some(matches);
  const setCaptions = (next: Caption[]) => update({ captions: next });
  const edit = (index: number, patch: Partial<Caption>) => setCaptions(captions.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const add = (type: CaptionType) => {
    if (captions.length >= MAX_CAPTIONS) return;
    setCaptions([...captions, newCaption(t, type)]);
    setOpen(captions.length);
  };
  const remove = (index: number) => {
    setCaptions(captions.filter((_, i) => i !== index));
    if (open >= index && open > 0) setOpen(open - 1);
  };
  if (!listShown) return null;
  return (
    <div className="space-y-4" data-testid="captions-section">
      <ResetButton search={search} t={t} section="captions" onReset={onReset} />
      <p className="text-xs text-zinc-400 leading-relaxed">
        {t("captionsDesc")}
        <Tooltip text={t("captionsTip")} />
      </p>
      <div className="space-y-2" data-testid="caption-list">
        {captions.length === 0 && <p className="text-xs text-zinc-500 text-center py-2">{t("captionsEmpty")}</p>}
        {captions.map((caption, i) => {
          const expanded = searching || open === i;
          const label = TYPE_LABELS[caption.type] ?? TYPE_LABELS.text;
          const preview = caption.type === "question" || caption.type === "text" ? caption.text : "";
          return (
            <div key={i} className="rounded-xl border border-zinc-700/60 bg-zinc-800/40 px-3 py-2" data-testid="caption-row" data-caption-type={caption.type}>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(expanded && !searching ? -1 : i)}
                  aria-expanded={expanded}
                  aria-label={t("captionEdit", { n: i + 1 })}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left text-sm text-zinc-200 cursor-pointer"
                >
                  <span aria-hidden="true">{label.icon}</span>
                  <span className="font-medium shrink-0">{t(label.labelKey)}</span>
                  {preview && <span className="text-zinc-500 text-xs truncate">{preview}</span>}
                  <span className="ml-auto text-zinc-500 text-[11px] shrink-0 tabular-nums">
                    {caption.start.toFixed(1).replace(/\.0$/, "")}s → {isOpenEnded(caption) ? "∞" : `${caption.end.toFixed(1).replace(/\.0$/, "")}s`}
                  </span>
                </button>
                <button type="button" onClick={() => remove(i)} aria-label={t("captionRemove", { n: i + 1 })} className="shrink-0 px-1.5 py-1 text-zinc-500 hover:text-red-400 transition-colors text-sm cursor-pointer">
                  ✕
                </button>
              </div>
              {expanded && <CaptionForm t={t} caption={caption} index={i} onChange={(patch) => edit(i, patch)} />}
            </div>
          );
        })}
      </div>
      <Searchable search={search} matches={matches} labelKey="captionAdd">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">
            {t("captionAdd")}
            <Tooltip text={t("captionAddTip", { max: MAX_CAPTIONS })} />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            {CAPTION_TYPES.map((type) => (
              <button
                type="button"
                key={type}
                onClick={() => add(type)}
                disabled={captions.length >= MAX_CAPTIONS}
                data-testid={`caption-add-${type}`}
                className="px-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer bg-zinc-800 text-[#93d119] border border-dashed border-[#93d119]/40 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed text-left"
              >
                ＋ <span aria-hidden="true">{TYPE_LABELS[type].icon}</span> {t(TYPE_LABELS[type].labelKey)}
              </button>
            ))}
          </div>
          {captions.length >= MAX_CAPTIONS && <p className="text-xs text-amber-500/90">{t("captionsLimit", { max: MAX_CAPTIONS })}</p>}
          <p className="text-xs text-zinc-500 leading-relaxed">{t("captionsClipNote", { duration: s.recordingDuration })}</p>
        </div>
      </Searchable>
    </div>
  );
}
