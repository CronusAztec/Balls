"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, offBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";

export interface UnlimitedSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the block (added to SECTION_KEYS.ball in Controls.tsx). */
export const UNLIMITED_KEYS = ["unlimited", "slowMotion" /* --- slow-motion --- */, "fullBallLimit" /* --- unlimited-sizes --- */];

/**
 * --- unlimited --- The No limits switch of the Ball & Physics section, --- uncap-all --- now "Wide sliders": nothing is
 * capped whether it is on or off (every slider has a number field for any value, lib/uncap.ts); on, the sliders of the
 * uncapped settings get a logarithmic extension up to 1B. Turning it off changes no value – a value beyond a slider
 * stays as typed, the track pins at its end.
 * --- slow-motion --- The block's second row is the Slow motion switch (`slowMotion`, link `smo=0`): on, the default, every
 * automatic slow motion plays as always; off, the run plays in real time (see lib/simulation/realTime.ts). While searching,
 * each row stands on its own card like every other control.
 */
export default function UnlimitedSection({ search, matches, settings: s, update }: UnlimitedSectionProps) {
  const u = useTranslations("Unlimited");
  const on = s.unlimited;
  const toggle = () => update({ unlimited: !on }); // --- uncap-all --- (the track only: no value is touched)
  const wide = (
    <>
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-ink">
          {u("label")}
          <Tooltip text={u("tip")} />
        </label>
        <button
          type="button"
          onClick={toggle}
          aria-pressed={on}
          data-testid="unlimited-toggle"
          className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${on ? "bg-warn text-accent-ink" : offBtn}`}
        >
          {on ? u("on") : u("off")}
        </button>
      </div>
      <p className={`text-xs ${on ? "text-warn" : "text-ink-2"}`}>{u("warning")}</p>
    </>
  );
  // --- slow-motion --- (no value of the camera, Fight League or Bullseye is touched: their sections say they are overridden)
  const slow = s.slowMotion;
  const slowRow = (
    <div className="flex items-center justify-between" data-testid="slow-motion-row">
      <label className="text-sm font-semibold text-ink">
        {u("slowMotion")}
        <Tooltip text={u("slowMotionTip")} />
      </label>
      <button
        type="button"
        onClick={() => update({ slowMotion: !slow })}
        aria-pressed={slow}
        data-testid="slow-motion-toggle"
        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${slow ? "bg-accent text-accent-ink" : offBtn}`}
      >
        {slow ? u("on") : u("off")}
      </button>
    </div>
  );
  const box = on ? "border-warn/60 bg-warn/10" : "border-line-strong/60 bg-surface-1/40";
  if (search)
    return (
      <>
        <Searchable search={search} matches={matches} labelKey="unlimited">
          <div className={`space-y-2 rounded-xl border p-3 ${box}`} data-testid="unlimited-section">
            {wide}
          </div>
        </Searchable>
        <Searchable search={search} matches={matches} labelKey="slowMotion">
          {slowRow}
        </Searchable>
      </>
    );
  return (
    <div className={`space-y-2 rounded-xl border p-3 ${box}`} data-testid="unlimited-section">
      {wide}
      <div className="border-t border-line pt-2">{slowRow}</div>
    </div>
  );
}

/**
 * --- slow-motion --- The note a section shows under a control the Slow motion switch overrides while it is off (the
 * near-miss slow motion, the escape replay's half speed, the KO finale, a bullseye, the duel's cuts): the stored value
 * is kept and plays again once the switch is back on. Nothing while the switch is on.
 */
export function SlowMotionOffNote({ settings: s, testId, replay }: { settings: SimulatorSettings; testId: string; replay?: boolean }) {
  const u = useTranslations("Unlimited");
  if (s.slowMotion) return null;
  return (
    <p className="text-xs text-warn/90" data-testid={testId} data-slow-motion-off-note="">
      {u(replay ? "replayRealTime" : "slowMotionOffNote")}
    </p>
  );
}

/**
 * --- slow-motion --- Shows controls the Slow motion switch overrides as such while `on`: dimmed (still usable, the value
 * waits for the switch), with the note under them. Off, the children render as they are, so a default page is unchanged.
 */
export function Overridden({ on, note, spacing = "space-y-1", children }: { on: boolean; note?: ReactNode; spacing?: string; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div className={spacing} data-slow-motion-overridden="">
      <div className={`${spacing} opacity-60`}>{children}</div>
      {note}
    </div>
  );
}

/** --- unlimited-sizes --- The full-physics balls a run with extreme values in play holds (the limits runtime's 2,000 by default; spawns past them join the crowd). */
export function FullBallLimitControl({ t, search, matches, settings: s, update }: UnlimitedSectionProps) {
  return (
    <div data-testid="full-ball-limit">
      <Slider t={t} search={search} matches={matches} labelKey="fullBallLimit" tipKey="fullBallLimitTip" value={s.fullBallLimit} range={RANGES.fullBallLimit} onChange={(v) => update({ fullBallLimit: v })} display={String(s.fullBallLimit)} />
    </div>
  );
}
