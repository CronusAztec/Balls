"use client";

import { useId } from "react";
import Tooltip from "../Tooltip";
import { Searchable, offBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { LOOP_CLIP_RULES, LOOP_CLIP_SLOTS, type LoopClipSlotId } from "@/lib/audio/loopClips";

/*
 * --- loop-foundation --- The Sound section's loop clip slots (lib/audio/loopClips.ts): for every loop family's voice – a
 * bounce, a bar strike, a chime, a ladder step, a landing, the bed, an impact, the completion, the reset, the drone – the owner
 * may load an audio clip they licence themselves; it plays instead of the synthesis, live and in every recording and export.
 * A clip is decoded in this session and stays on the device: never uploaded, never shipped, never tracked.
 */

export interface LoopClipView {
  slot: LoopClipSlotId;
  /** The loaded file's name, null without a clip. */
  name: string | null;
  gainDb: number;
}

export interface LoopClipsPanelProps {
  clips: readonly LoopClipView[];
  onLoad: (slot: LoopClipSlotId, file: File) => void;
  onClear: (slot: LoopClipSlotId) => void;
  onGain: (slot: LoopClipSlotId, gainDb: number) => void;
  /** The slot whose file could not be decoded (null: none). */
  failed: LoopClipSlotId | null;
}

/** Search keys of the block (the Sound section's). */
export const LOOP_CLIP_KEYS = ["loopClips"];

const SLOT_LABELS: Record<LoopClipSlotId, string> = {
  bounce: "loopClipBounce",
  barStrike: "loopClipBarStrike",
  chime: "loopClipChime",
  progressStep: "loopClipProgressStep",
  land: "loopClipLand",
  bed: "loopClipBed",
  impact: "loopClipImpact",
  completion: "loopClipCompletion",
  reset: "loopClipReset",
  drone: "loopClipDrone",
};

export default function LoopClipsSection({ t, search, matches, panel }: { t: Translate; search: string; matches: Matcher; panel: LoopClipsPanelProps }) {
  const baseId = useId();
  const loaded = panel.clips.filter((c) => c.name !== null).length;
  return (
    <Searchable search={search} matches={matches} labelKey="loopClips">
      <details className="space-y-2" data-testid="loop-clips" data-loop-clips={loaded}>
        <summary className="text-sm font-medium text-ink-2 flex items-center cursor-pointer">
          {t("loopClips")}
          {loaded > 0 && <span className="ml-2 text-xs text-accent">{loaded}</span>}
          <Tooltip text={t("loopClipsTip")} />
        </summary>
        <p className="text-xs text-ink-3 leading-relaxed">{t("loopClipsNote")}</p>
        <ul className="space-y-1.5">
          {LOOP_CLIP_SLOTS.map((slot) => {
            const view = panel.clips.find((c) => c.slot === slot);
            const rule = LOOP_CLIP_RULES[slot];
            const inputId = `${baseId}-${slot}`;
            return (
              <li key={slot} className="space-y-1" data-loop-clip={slot} data-loaded={view?.name ? "1" : "0"}>
                <div className="flex items-center gap-2 text-xs">
                  <span className="flex-1 min-w-0 truncate text-ink-2">
                    {t(SLOT_LABELS[slot])}
                    {view?.name ? <span className="text-ink-3"> · {view.name}</span> : null}
                  </span>
                  <label htmlFor={inputId} className={`px-2 py-1 rounded-md text-xs cursor-pointer ${offBtn}`}>
                    {t(view?.name ? "loopClipReplace" : "loopClipLoad")}
                  </label>
                  <input
                    id={inputId}
                    type="file"
                    accept="audio/*"
                    className="sr-only"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) panel.onLoad(slot, file);
                      e.target.value = "";
                    }}
                  />
                  {view?.name && (
                    <button type="button" onClick={() => panel.onClear(slot)} className={`px-2 py-1 rounded-md text-xs cursor-pointer ${offBtn}`}>
                      {t("loopClipClear")}
                    </button>
                  )}
                </div>
                {view?.name && (
                  <input
                    type="range"
                    min={rule.gainMinDb}
                    max={rule.gainMaxDb}
                    step={0.5}
                    value={view.gainDb}
                    onChange={(e) => panel.onGain(slot, Number(e.target.value))}
                    aria-label={t("loopClipGain", { slot: t(SLOT_LABELS[slot]) })}
                    className="w-full h-1.5 bg-surface-2 rounded-full appearance-none cursor-pointer"
                  />
                )}
                {panel.failed === slot && <p className="text-xs text-danger">{t("loopClipFailed")}</p>}
              </li>
            );
          })}
        </ul>
      </details>
    </Searchable>
  );
}
