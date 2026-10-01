"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { EXIT_BEHAVIORS, supportsMovingExits, supportsSplats, type ExitBehavior } from "@/lib/physics/exitSplat";

/*
 * --- gerald-exit-splat --- The panel blocks of the moving exits and the splat barrier (lib/physics/exitSplat.ts): "Exit
 * behaviour" closes the Wall section (Classic, Accumulation, Multiply – the ring modes whose rings have one exit each), "Splat
 * barrier" follows Wobbly Walls in the Visual section (the ring modes). Both show whenever the search box is in use, so it
 * finds them; their search keys go into SECTION_KEYS (Controls.tsx) and their rules into panelKeys.ts (the command palette).
 */

/** Search keys of the Exit behaviour block (SECTION_KEYS.wall). */
export const EXIT_BEHAVIOR_KEYS = ["exitBehavior", "exitJumpSeconds", "exitSense", "exitFleeSpeed"];
/** Search keys of the Splat barrier block (SECTION_KEYS.visual). */
export const SPLAT_BARRIER_KEYS = ["splatBarrier", "splatSize", "splatMax"];

const OPTIONS: Record<ExitBehavior, { labelKey: string; descKey: string }> = {
  rotate: { labelKey: "exitRotate", descKey: "exitRotateDesc" },
  jump: { labelKey: "exitJump", descKey: "exitJumpDesc" },
  flee: { labelKey: "exitFlee", descKey: "exitFleeDesc" },
  shrink: { labelKey: "exitShrink", descKey: "exitShrinkDesc" },
};

export interface ExitSplatSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/**
 * Exit behaviour: rotate (the exits turn with their rings, as always) / jump / flee / shrink, with the sliders the chosen
 * one uses – the exit timer (jump, shrink), the sense (jump, flee) and the flee speed.
 */
export function ExitBehaviorControls({ t, search, matches, settings: s, update }: ExitSplatSectionProps) {
  if (!supportsMovingExits(s.mode) && !search) return null;
  const behavior = s.exitBehavior;
  const showTimer = behavior === "jump" || behavior === "shrink" || !!search;
  const showSense = behavior === "jump" || behavior === "flee" || !!search;
  const showFlee = behavior === "flee" || !!search;
  return (
    <>
      <Searchable search={search} matches={matches} labelKey="exitBehavior">
        <div className="space-y-2" data-testid="exit-behavior">
          <label className="text-sm font-medium text-ink-2">
            {t("exitBehavior")}
            <Tooltip text={t("exitBehaviorTip")} />
          </label>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("exitBehavior")}>
            {EXIT_BEHAVIORS.map((value) => (
              <button
                type="button"
                key={value}
                data-exit={value}
                onClick={() => update({ exitBehavior: value })}
                aria-pressed={behavior === value}
                className={`flex-auto whitespace-nowrap px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${behavior === value ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`}
              >
                {t(OPTIONS[value].labelKey)}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-3 leading-relaxed">
            {t(OPTIONS[behavior].descKey)}
            {behavior !== "rotate" && ` ${t("exitHoldNote")}`}
          </p>
        </div>
      </Searchable>
      {showTimer && <Slider t={t} search={search} matches={matches} labelKey="exitJumpSeconds" tipKey="exitJumpSecondsTip" value={s.exitJumpSeconds} range={RANGES.exitJumpSeconds} onChange={(v) => update({ exitJumpSeconds: v })} display={`${s.exitJumpSeconds.toFixed(1)} s`} />}
      {showSense && <Slider t={t} search={search} matches={matches} labelKey="exitSense" tipKey="exitSenseTip" value={s.exitSense} range={RANGES.exitSense} onChange={(v) => update({ exitSense: v })} display={s.exitSense === 0 ? t("exitSenseOff") : `${s.exitSense}°`} />}
      {showFlee && <Slider t={t} search={search} matches={matches} labelKey="exitFleeSpeed" tipKey="exitFleeSpeedTip" value={s.exitFleeSpeed} range={RANGES.exitFleeSpeed} onChange={(v) => update({ exitFleeSpeed: v })} display={`${s.exitFleeSpeed}°/s`} />}
    </>
  );
}

/** Splat barrier: wall hits leave solid splats of paint in the ball's colour (their size and how many stand at once). */
export function SplatBarrierControls({ t, search, matches, settings: s, update }: ExitSplatSectionProps) {
  if (!supportsSplats(s.mode) && !search) return null;
  const showSliders = s.splatBarrier || !!search;
  return (
    <>
      <Searchable search={search} matches={matches} labelKey="splatBarrier">
        <div className="space-y-2" data-testid="splat-barrier">
          <Toggle t={t} labelKey="splatBarrier" tipKey="splatBarrierTip" value={s.splatBarrier} onChange={(v) => update({ splatBarrier: v })} caseStyle="title" />
          {s.splatBarrier && s.mode === "grow" && <p className="text-xs text-ink-3 leading-relaxed">{t("splatGrowNote")}</p>}
        </div>
      </Searchable>
      {showSliders && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="splatSize" tipKey="splatSizeTip" value={s.splatSize} range={RANGES.splatSize} onChange={(v) => update({ splatSize: v })} display={`${s.splatSize.toFixed(2)}×`} />
          <Slider t={t} search={search} matches={matches} labelKey="splatMax" tipKey="splatMaxTip" value={s.splatMax} range={RANGES.splatMax} onChange={(v) => update({ splatMax: v })} display={String(s.splatMax)} />
        </>
      )}
    </>
  );
}
