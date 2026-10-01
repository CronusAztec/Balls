"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { COLLIDE_CONTAINERS, RING_MAX_BODIES, type CollideContainer } from "@/lib/physics/modes/collide";

export interface CollisionPlaygroundSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const COLLISION_PLAYGROUND_KEYS = ["cpCount", "cpSizeSpread", "cpContainer", "cpGravity", "cpRestitution", "cpSquishy", "cpSyncStart", "cpAntiCollisionAt", "cpRing"];

const CONTAINER_OPTIONS: Record<CollideContainer, { labelKey: string }> = {
  circle: { labelKey: "cpContainerCircle" },
  box: { labelKey: "cpContainerBox" },
};

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;
const pct = (v: number) => `${Math.round(100 * v)}%`;

/**
 * "Collision playground" controls of the Collision Playground mode, shown in the Mode row while the mode is active
 * (and in the Ball section while the settings search is in use): orb count and size spread, container, gravity,
 * restitution, and the squishy / sync start / anti-collision / lollipop ring variants. The values live in
 * SimulatorSettings like everything else; Simulator.tsx forwards them to the engine (see
 * lib/physics/modes/collide.ts) and restarts the playground when they change.
 */
export default function CollisionPlaygroundSection({ t, search, matches, settings: s, update }: CollisionPlaygroundSectionProps) {
  const onRing = Math.min(s.cpCount, RING_MAX_BODIES);
  return (
    <div className="space-y-3 pt-2" data-testid="collision-playground">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-ink-2">{t("cpTitle")}</p>
          <p className="text-xs text-ink-3 leading-relaxed">{t("cpDesc")}</p>
        </div>
      )}
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="cpCount"
        tipKey="cpCountTip"
        value={s.cpCount}
        range={RANGES.cpCount}
        onChange={(v) => update({ cpCount: v })}
        display={s.cpRing && s.cpCount > RING_MAX_BODIES ? t("cpCountOnRing", { count: onRing }) : String(s.cpCount)}
      />
      <Slider t={t} search={search} matches={matches} labelKey="cpSizeSpread" tipKey="cpSizeSpreadTip" value={s.cpSizeSpread} range={RANGES.cpSizeSpread} onChange={(v) => update({ cpSizeSpread: v })} display={pct(s.cpSizeSpread)} />
      {(!s.cpRing || !!search) && (
        <Searchable search={search} matches={matches} labelKey="cpContainer">
          <div className="space-y-2">
            <label className="text-sm font-medium text-ink-2">
              {t("cpContainer")}
              <Tooltip text={t("cpContainerTip")} />
            </label>
            <div className="grid grid-cols-2 gap-1" role="group" aria-label={t("cpContainer")}>
              {COLLIDE_CONTAINERS.map((container) => (
                <button type="button" key={container} onClick={() => update({ cpContainer: container })} aria-pressed={s.cpContainer === container} className={pick(s.cpContainer === container)}>
                  {t(CONTAINER_OPTIONS[container].labelKey)}
                </button>
              ))}
            </div>
          </div>
        </Searchable>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="cpGravity" tipKey="cpGravityTip" value={s.cpGravity} range={RANGES.cpGravity} onChange={(v) => update({ cpGravity: v })} display={pct(s.cpGravity)} />
      <Slider t={t} search={search} matches={matches} labelKey="cpRestitution" tipKey="cpRestitutionTip" value={s.cpRestitution} range={RANGES.cpRestitution} onChange={(v) => update({ cpRestitution: v })} display={s.cpRestitution.toFixed(2)} />
      <Searchable search={search} matches={matches} labelKey="cpSquishy">
        <Toggle t={t} labelKey="cpSquishy" tipKey="cpSquishyTip" value={s.cpSquishy} onChange={(v) => update({ cpSquishy: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="cpSyncStart">
        <Toggle t={t} labelKey="cpSyncStart" tipKey="cpSyncStartTip" value={s.cpSyncStart} onChange={(v) => update({ cpSyncStart: v })} />
      </Searchable>
      <Slider
        t={t}
        search={search}
        matches={matches}
        labelKey="cpAntiCollisionAt"
        tipKey="cpAntiCollisionAtTip"
        value={s.cpAntiCollisionAt}
        range={RANGES.cpAntiCollisionAt}
        onChange={(v) => update({ cpAntiCollisionAt: v })}
        display={s.cpAntiCollisionAt === 0 ? t("cpAntiOff") : `${s.cpAntiCollisionAt}s`}
      />
      <Searchable search={search} matches={matches} labelKey="cpRing">
        <Toggle t={t} labelKey="cpRing" tipKey="cpRingTip" value={s.cpRing} onChange={(v) => update({ cpRing: v })} />
      </Searchable>
    </div>
  );
}
