"use client";

import { useState } from "react";
import { Searchable, Slider, Toggle, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import { CUSTOM_HIT_SAMPLE_ID, HIT_SAMPLES, type HitSampleStatus } from "@/lib/audio/sampler";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface HitSampleSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
  /** Name of the clip uploaded in this session (selectable as "custom"), or null when none was uploaded. */
  customHitSampleName: string | null;
  /** Decode state of the selected clip; "error" is shown under the picker (the tones play meanwhile). */
  hitSampleStatus: HitSampleStatus;
  onUpload: (file: File) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.sound in Controls.tsx). */
export const HIT_SAMPLE_KEYS = ["hitSample", "importHitSample", "hitSamplePitchByWall", "hitSampleVolume"];

/** Drop zone for an audio file (the hit-sample upload); accepts any audio/* file. */
function AudioDropZone({ inputId, idleText, dragText, onFile }: { inputId?: string; idleText: string; dragText: string; onFile: (file: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const file = e.dataTransfer.files?.[0];
        if (file) onFile(file);
      }}
      className={`flex items-center justify-center gap-2 w-full px-4 py-3 rounded-lg font-medium transition-all text-xs cursor-pointer border border-dashed ${
        drag ? `bg-[#93d119]/10 border-[#93d119] text-[#93d119] scale-[1.02] shadow-lg` : "bg-zinc-800 border-zinc-600 text-zinc-300 hover:bg-zinc-700 hover:border-zinc-500"
      }`}
    >
      <span className="text-lg">{drag ? "📥" : "📁"}</span>
      <span className="font-semibold">{drag ? dragText : idleText}</span>
      <input
        id={inputId}
        type="file"
        accept=".mp3,.wav,.ogg,.aac,.m4a,.flac,.webm,audio/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            onFile(file);
            e.target.value = "";
          }
        }}
      />
    </label>
  );
}

/**
 * "Custom hit sample" block of the Sound section, shown in "sample" mode (and while the
 * settings search is in use): the clip picker with its decode state, the upload drop zone,
 * the pitch-by-wall toggle and the sample volume. The clip itself is decoded and played by
 * the HitSampler inside the ToneGenerator (see lib/audio/sampler.ts and Simulator.tsx);
 * this component only edits the settings and hands the uploaded file up.
 */
export default function HitSampleSection({ t, search, matches, settings: s, update, customHitSampleName, hitSampleStatus, onUpload }: HitSampleSectionProps) {
  return (
    <>
      <Searchable search={search} matches={matches} labelKey="hitSample">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300" htmlFor="hit-sample-select">
            {t("hitSample")}
          </label>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("hitSampleDesc")}</p>
          <select id="hit-sample-select" value={s.hitSampleId} onChange={(e) => update({ hitSampleId: e.target.value })} className={selectClass}>
            {HIT_SAMPLES.map((sample) => (
              <option key={sample.id} value={sample.id}>
                {t(sample.nameKey)}
              </option>
            ))}
            {customHitSampleName && <option value={CUSTOM_HIT_SAMPLE_ID}>{t("hitSampleCustomOption", { name: customHitSampleName })}</option>}
          </select>
          {hitSampleStatus === "loading" && (
            <div className="flex items-center gap-2 text-xs text-zinc-400" role="status">
              <div className="w-3.5 h-3.5 border-2 border-[#93d119] border-t-transparent rounded-full animate-spin" />
              {t("hitSampleLoading")}
            </div>
          )}
          {hitSampleStatus === "error" && (
            <p className="text-[11px] text-red-400 leading-relaxed" role="alert" data-testid="hit-sample-error">
              ⚠️ {t("hitSampleDecodeError")}
            </p>
          )}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="importHitSample">
        <div className="space-y-2">
          <label className="text-sm font-medium text-zinc-300">{t("importHitSample")}</label>
          <AudioDropZone inputId="hit-sample-input" idleText={t("chooseHitSampleFile")} dragText={t("dropHitSampleHere")} onFile={onUpload} />
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="hitSamplePitchByWall">
        <Toggle t={t} labelKey="hitSamplePitchByWall" tipKey="hitSamplePitchByWallTip" value={s.hitSamplePitchByWall} onChange={(v) => update({ hitSamplePitchByWall: v })} caseStyle="title" />
      </Searchable>
      <Slider t={t} search={search} matches={matches} labelKey="hitSampleVolume" tipKey="hitSampleVolumeTip" value={s.hitSampleVolume} range={RANGES.hitSampleVolume} onChange={(v) => update({ hitSampleVolume: v })} display={`${Math.round(s.hitSampleVolume * 100)}%`} left="🔈" right="🔊" />
    </>
  );
}
