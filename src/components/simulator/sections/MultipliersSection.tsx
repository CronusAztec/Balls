"use client";

import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { CLONE_MODES, MULTIPLIER_COLORS, PICKUP_FACTORS, PICKUP_KINDS, PICKUP_MODES, SMASH_MODES, parsePickupTypes, type PickupKind } from "@/lib/physics/multipliers";

export interface MultipliersSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const MULTIPLIER_KEYS = ["multiplierPickups", "pickupRate", "pickupTypes", "pickupLifetime", "mpUnlimited", "mpCap", "wallSmashThreshold"];

/** Label key and icon of every pickup kind. */
const KIND_OPTIONS: Record<PickupKind, { labelKey: string; icon: string }> = {
  speed: { labelKey: "pickupKindSpeed", icon: "⚡" },
  size: { labelKey: "pickupKindSize", icon: "🎈" },
  damage: { labelKey: "pickupKindDamage", icon: "💥" },
  balls: { labelKey: "pickupKindBalls", icon: "🟢" },
  bounce: { labelKey: "pickupKindBounce", icon: "🏀" },
  gravity: { labelKey: "pickupKindGravity", icon: "🪨" },
};

/** Whether the Multipliers block shows in the Ball section for this mode: the ring modes (pickups) and the multipliers board (cap). */
export function showsMultipliersSection(mode: SimulatorSettings["mode"]): boolean {
  return PICKUP_MODES.includes(mode) || mode === "multipliers";
}

/**
 * The "Multipliers" group of the Ball section (lib/physics/multipliers.ts): floating multiplier orbs in the ring modes
 * (on/off, how often, which kinds, how long they float), the cap – none by default ("unlimited") – and the damage from
 * which a ball smashes the rings. The values live in SimulatorSettings; Simulator.tsx forwards them to the engine inside
 * the physics config, like the physics extras.
 */
export default function MultipliersSection({ t, search, matches, settings: s, update }: MultipliersSectionProps) {
  const pickupMode = PICKUP_MODES.includes(s.mode) || !!search;
  const kinds = parsePickupTypes(s.pickupTypes);
  const toggleKind = (kind: PickupKind) => {
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
    update({ pickupTypes: PICKUP_KINDS.filter((k) => next.includes(k)).join(",") });
  };
  return (
    <div className="space-y-3 pt-2 border-t border-zinc-800/60" data-testid="multipliers-section">
      {!search && (
        <div className="space-y-1">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">{t("mpTitle")}</p>
          <p className="text-xs text-zinc-500 leading-relaxed">{t("mpDesc")}</p>
        </div>
      )}
      {pickupMode && (
        <Searchable search={search} matches={matches} labelKey="multiplierPickups">
          <Toggle t={t} labelKey="multiplierPickups" tipKey="multiplierPickupsTip" value={s.multiplierPickups} onChange={(v) => update({ multiplierPickups: v })} />
        </Searchable>
      )}
      {pickupMode && (s.multiplierPickups || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="pickupRate" tipKey="pickupRateTip" value={s.pickupRate} range={RANGES.pickupRate} onChange={(v) => update({ pickupRate: v })} display={t("pickupRateValue", { rate: s.pickupRate.toFixed(1) })} left="🫧" right="🎁" />
          <Searchable search={search} matches={matches} labelKey="pickupTypes">
            <div className="space-y-2">
              <label className="text-sm font-medium text-zinc-300">
                {t("pickupTypes")}
                <Tooltip text={t("pickupTypesTip")} />
              </label>
              <div className="grid grid-cols-3 gap-1" role="group" aria-label={t("pickupTypes")}>
                {PICKUP_KINDS.map((kind) => {
                  const on = kinds.includes(kind);
                  const unavailable = kind === "balls" && !CLONE_MODES.includes(s.mode) && !search;
                  return (
                    <button
                      type="button"
                      key={kind}
                      onClick={() => toggleKind(kind)}
                      aria-pressed={on}
                      disabled={unavailable}
                      title={unavailable ? t("pickupBallsUnavailable") : undefined}
                      className={`px-1 py-1.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${on ? onBtn : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}
                      style={on ? { boxShadow: `inset 0 0 0 2px ${MULTIPLIER_COLORS[kind]}` } : undefined}
                    >
                      <span aria-hidden="true">{KIND_OPTIONS[kind].icon}</span> x{PICKUP_FACTORS[kind]} {t(KIND_OPTIONS[kind].labelKey)}
                    </button>
                  );
                })}
              </div>
            </div>
          </Searchable>
          <Slider t={t} search={search} matches={matches} labelKey="pickupLifetime" tipKey="pickupLifetimeTip" value={s.pickupLifetime} range={RANGES.pickupLifetime} onChange={(v) => update({ pickupLifetime: v })} display={`${s.pickupLifetime}s`} left="⏱️" right="⌛" />
        </>
      )}
      <Searchable search={search} matches={matches} labelKey="mpUnlimited">
        <Toggle t={t} labelKey="mpUnlimited" tipKey="mpUnlimitedTip" value={s.mpUnlimited} onChange={(v) => update(v ? { mpUnlimited: true } : { mpUnlimited: false, mpCap: s.mpCap > 0 ? s.mpCap : 32 })} />
      </Searchable>
      {(!s.mpUnlimited || !!search) && (
        <Slider t={t} search={search} matches={matches} labelKey="mpCap" tipKey="mpCapTip" value={s.mpCap} range={RANGES.mpCap} onChange={(v) => update({ mpCap: v })} display={s.mpCap === 0 ? t("mpCapOff") : `x${s.mpCap}`} left="🔒" right="∞" />
      )}
      {(SMASH_MODES.includes(s.mode) || !!search) && (
        <Slider t={t} search={search} matches={matches} labelKey="wallSmashThreshold" tipKey="wallSmashThresholdTip" value={s.wallSmashThreshold} range={RANGES.wallSmashThreshold} onChange={(v) => update({ wallSmashThreshold: v })} display={`x${s.wallSmashThreshold}`} left="🧱" right="💥" />
      )}
    </div>
  );
}
