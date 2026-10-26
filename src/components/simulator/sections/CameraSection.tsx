"use client";

import { useId } from "react";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, type Matcher, type Translate } from "../ControlPrimitives";
import { replayEligible } from "@/lib/simulation/camera";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { Overridden, SlowMotionOffNote } from "./UnlimitedSection"; // --- slow-motion ---

export interface CameraSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.visual in Controls.tsx). */
export const CAMERA_KEYS = ["cameraZoom", "screenShake", "slowMoOnNearMiss", "slowMoFactor", "slowMoMs", "replayOnEscape"];

const pct = (v: number) => `${Math.round(100 * v)}%`;

/**
 * The "Camera" group of the Visual section: zoom toward the ball, screen shake on wall breaks, slow motion on
 * near misses (speed and length) and the escape replay. The values live in SimulatorSettings (see
 * lib/simulation/camera.ts) and only the canvas reads them – the view, the clock it feeds the fixed-step engine
 * and the replay are all rendering, so seeds and found simulations stay valid.
 * --- slow-motion --- While the Slow motion switch (Ball & Physics) is off, the near-miss slow motion and its sliders show as
 * overridden with a note, and the replay says it plays at normal speed; their values are kept for when it is back on.
 * (review fix) The sliders name the near-miss note while it is on screen, and have their own (camera-slow-mo-sliders-off)
 * whenever it is not: a search for "slow" with the near-miss slow motion off, or for "slow-mo speed".
 */
export default function CameraSection({ t, search, matches, settings: s, update }: CameraSectionProps) {
  // --- slow-motion --- (review fix) only while a slider is shown: a search for neither leaves no overridden block behind
  const showSlowMoSliders = (s.slowMoOnNearMiss || !!search) && (!search || matches("slowMoFactor") || matches("slowMoMs"));
  const nearMissOverridden = s.slowMoOnNearMiss && !s.slowMotion; // --- slow-motion ---
  // --- slow-motion --- (review fix) the near-miss note speaks for the speed and length sliders too (they name it), while it is
  // shown; when it is not (a search that leaves the toggle out, or the near-miss slow motion off itself), the sliders show
  // their own note, so every dimmed control has a note on screen and names it
  const nearMissNote = useId();
  const nearMissNoteShown = nearMissOverridden && (!search || matches("slowMoOnNearMiss"));
  const body = (
    <>
      {!search && (
        <div className="space-y-1">
          <label className="text-sm font-medium text-ink-2">
            {t("cameraGroup")}
            <Tooltip text={t("cameraGroupTip")} />
          </label>
          <p className="text-xs text-ink-3 leading-relaxed">{t("cameraGroupDesc")}</p>
        </div>
      )}
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="cameraZoom"
        tipKey="cameraZoomTip"
        value={s.cameraZoom}
        range={RANGES.cameraZoom}
        onChange={(v) => update({ cameraZoom: v })}
        display={s.cameraZoom > 0 ? pct(s.cameraZoom) : t("cameraOff")}
      />
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="screenShake"
        tipKey="screenShakeTip"
        value={s.screenShake}
        range={RANGES.screenShake}
        onChange={(v) => update({ screenShake: v })}
        display={s.screenShake > 0 ? pct(s.screenShake) : t("cameraOff")}
      />
      <Searchable search={search} matches={matches} labelKey="slowMoOnNearMiss">
        <Overridden on={nearMissOverridden} noteId={nearMissNote} note={<SlowMotionOffNote settings={s} testId="camera-slow-motion-off" />}>
          <Toggle t={t} labelKey="slowMoOnNearMiss" tipKey="slowMoOnNearMissTip" value={s.slowMoOnNearMiss} onChange={(v) => update({ slowMoOnNearMiss: v })} caseStyle="title" />
        </Overridden>
      </Searchable>
      {showSlowMoSliders && (
        <Overridden
          on={!s.slowMotion}
          noteId={nearMissNoteShown ? nearMissNote : undefined}
          note={nearMissNoteShown ? undefined : <SlowMotionOffNote settings={s} testId="camera-slow-mo-sliders-off" />}
          spacing="space-y-4"
        >
          <Slider
            t={t}
            search={search}
            matches={matches}
            labelKey="slowMoFactor"
            tipKey="slowMoFactorTip"
            value={s.slowMoFactor}
            range={RANGES.slowMoFactor}
            onChange={(v) => update({ slowMoFactor: v })}
            display={`${s.slowMoFactor.toFixed(2)}×`}
          />
          <Slider
            t={t}
            search={search}
            matches={matches}
            labelKey="slowMoMs"
            tipKey="slowMoMsTip"
            value={s.slowMoMs}
            range={RANGES.slowMoMs}
            onChange={(v) => update({ slowMoMs: v })}
            display={`${s.slowMoMs} ms`}
          />
        </Overridden>
      )}
      <Searchable search={search} matches={matches} labelKey="replayOnEscape">
        <div className="space-y-1">
          <Toggle t={t} labelKey="replayOnEscape" tipKey="replayOnEscapeTip" value={s.replayOnEscape} onChange={(v) => update({ replayOnEscape: v })} caseStyle="title" />
          {s.replayOnEscape && !replayEligible(s.mode) && <p className="text-xs text-warn/90">{t("replayOnEscapeModes")}</p>}
          {s.replayOnEscape && <SlowMotionOffNote settings={s} testId="camera-replay-real-time" messageKey="replayRealTime" /> /* --- slow-motion --- (the replay plays at 1x) */}
        </div>
      </Searchable>
    </>
  );
  // While searching, the matching controls stand on their own like every other control of the section.
  return search ? (
    body
  ) : (
    <div className="space-y-4 pt-3 border-t border-line" data-testid="camera-section">
      {body}
    </div>
  );
}
