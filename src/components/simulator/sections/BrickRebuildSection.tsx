"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, Slider, Toggle, onBtn, type Matcher, type Translate } from "../ControlPrimitives";
import { inputClass } from "@/components/ui/Field";
import { RANGES, type SimulatorSettings } from "@/lib/settings";
import { BR_ORDERS, BR_PICTURES, BR_PRESET_IDS, BR_PRESET_LABELS, BR_SYMMETRY_MODES, BRICK_REBUILD_LOOK, brickRebuildBallsShown, brickRebuildPresetFields, type BrOrder, type BrPicture, type BrPresetId, type BrSymmetryMode } from "@/lib/physics/brickRebuildSettings";
import { BR_TEXT_MAX } from "@/lib/physics/brickPicture";
import { brickGridSize, brickLayoutOf } from "@/lib/physics/brickRebuild";
import { brickUploadStore, loadBrickUpload, type BrickUpload } from "../brickUpload";

/*
 * --- brick-rebuild --- The Brick Smash controls (lib/physics/brickRebuildSettings.ts), in the Mode row while the mode is active
 * (and in the Ball section while the settings search is in use): the presets (Smash the emblem, Avalanche, Big picture, Classic
 * breakout, Gold capsules, Kaleidoscope), the picture (the built-in emblem, your own upload – it stays in this page, never in a
 * link – or typed text), the grid and the wall, the balls and the spawns, the bricks' hits, the phases and the rebuild's order,
 * the groove's drop, the gold capsules, the kaleidoscope and the outlined balls. The labels live in the `BrickRebuild`
 * namespace (the search and the command palette read them there too: Controls.tsx). Simulator.tsx hands the settings to the
 * engine and restarts the run when one that the physics reads changes (the picture, the text, the order and the outline follow
 * live) and turns the uploaded picture into bricks (components/simulator/brickUpload.ts).
 */

export interface BrickRebuildSectionProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
  update: (patch: Partial<SimulatorSettings>) => void;
}

/** Search keys of the controls rendered here (added to SECTION_KEYS.ball in Controls.tsx so the search box finds them). */
export const BRICK_REBUILD_KEYS = ["brPreset", "brPicture", "brUpload", "brText", "brCols", "brRows", "brWall", "brBalls", "brEvery", "brSpeed", "brSize", "brHp", "brDuration", "brSettle", "brRebuild", "brOrder", "brDrop", "brBed", "brCapsules", "brCapsuleChance", "brSplit", "brSymmetry", "brSymmetryMode", "brHole", "brOutline"];

const PICTURE_LABELS: Record<BrPicture, string> = { emblem: "pictureEmblem", upload: "pictureUpload", text: "pictureText" };
const ORDER_LABELS: Record<BrOrder, string> = { layers: "orderLayers", random: "orderRandom", rows: "orderRows" };
const SYMMETRY_LABELS: Record<BrSymmetryMode, string> = { mirror: "symmetryMirror", rotate: "symmetryRotate" };

const pick = (active: boolean) => `px-1 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${active ? onBtn : "bg-surface-2 text-ink-2 hover:bg-surface-3"}`;

/** A number as the panel shows it: at most `digits` decimals, trailing zeros dropped. */
function short(value: number, digits = 2): string {
  return Number.isFinite(value) ? String(Number(value.toFixed(digits))) : "–";
}

/** The section's translator: a key of the `BrickRebuild` namespace, else the Controls namespace's (the primitives' shared words). */
function useBrickRebuildTranslator(t: Translate): Translate {
  const br = useTranslations("BrickRebuild");
  return useMemo(() => {
    const own = (key: string) => br.has(key as never);
    const fn = ((key: string, values?: Record<string, string | number | Date>) => (own(key) ? br(key as never, values as never) : t(key as never, values as never))) as unknown as Translate;
    Object.assign(fn, {
      has: (key: string) => own(key) || t.has(key as never),
      raw: (key: string) => (own(key) ? br.raw(key as never) : t.raw(key as never)),
      rich: (key: string, values?: never) => (own(key) ? br.rich(key as never, values) : t.rich(key as never, values)),
      markup: (key: string, values?: never) => (own(key) ? br.markup(key as never, values) : t.markup(key as never, values)),
    });
    return fn;
  }, [br, t]);
}

export default function BrickRebuildSection({ t: controls, search, matches, settings: s, update }: BrickRebuildSectionProps) {
  const t = useBrickRebuildTranslator(controls);
  const [upload, setUpload] = useState<BrickUpload | null>(() => brickUploadStore.get());
  const [uploadError, setUploadError] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => brickUploadStore.subscribe(setUpload), []);
  const kaleidoscope = s.brSymmetry > 1;
  const grid = brickGridSize(s.brCols, s.brRows, brickLayoutOf(s.brSymmetry));
  const shown = brickRebuildBallsShown(s);
  const applyPreset = (id: BrPresetId) => {
    const fields = brickRebuildPresetFields(id);
    update({ ...fields, backgroundType: BRICK_REBUILD_LOOK.backgroundType, backgroundColors: [...BRICK_REBUILD_LOOK.backgroundColors], themeId: BRICK_REBUILD_LOOK.themeId, showTrails: false, showGlow: false, loopHud: true });
    if (id === "bigPicture" && !brickUploadStore.get()) fileRef.current?.click();
  };
  const onFile = (file: File | undefined) => {
    if (!file) return;
    setUploadError(false);
    loadBrickUpload(file)
      .then((u) => {
        brickUploadStore.set(u);
        update({ brPicture: "upload" });
      })
      .catch(() => setUploadError(true));
  };
  const showUpload = s.brPicture === "upload" || (!!search && matches("brUpload"));
  return (
    <div className="space-y-3 pt-2" data-testid="brick-rebuild-section" data-br-picture={s.brPicture} data-br-upload={upload ? "1" : "0"} data-br-grid={`${grid.cols}x${grid.rows}`} data-br-shown={String(shown.shown)}>
      {!search && <p className="text-xs text-ink-3 leading-relaxed">{t("desc")}</p>}
      <Searchable search={search} matches={matches} labelKey="brPreset">
        <div className="space-y-1.5">
          <span className="text-sm font-medium text-ink-2 flex items-center">
            {t("brPreset")}
            <Tooltip text={t("brPresetTip")} />
          </span>
          <div className="grid grid-cols-2 gap-1.5" data-testid="br-presets">
            {BR_PRESET_IDS.map((id) => (
              <button key={id} type="button" onClick={() => applyPreset(id)} className={pick(false)} data-br-preset={id}>
                {t(BR_PRESET_LABELS[id])}
              </button>
            ))}
          </div>
        </div>
      </Searchable>
      <ButtonRow t={t} search={search} matches={matches} labelKey="brPicture" tipKey="brPictureTip" values={BR_PICTURES} labels={PICTURE_LABELS} value={s.brPicture} onChange={(brPicture) => update({ brPicture })} columns={3} />
      {showUpload && (
        <Searchable search={search} matches={matches} labelKey="brUpload">
          <div className="space-y-1.5" data-testid="br-upload">
            <span className="text-sm font-medium text-ink-2 flex items-center">
              {t("brUpload")}
              <Tooltip text={t("brUploadTip")} />
            </span>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className={pick(false)} data-testid="br-upload-button">
                {upload ? t("uploadReplace") : t("uploadChoose")}
              </button>
              {upload && (
                <button type="button" onClick={() => brickUploadStore.set(null)} className={pick(false)} data-testid="br-upload-remove">
                  {t("uploadRemove")}
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="br-upload-input" onChange={(e) => onFile(e.target.files?.[0] ?? undefined)} />
            </div>
            <p className="text-xs text-ink-3 leading-relaxed" data-testid="br-upload-note">
              {uploadError ? t("uploadError") : upload ? t("uploadLoaded", { name: upload.name }) : t("uploadNone")}
            </p>
          </div>
        </Searchable>
      )}
      {(s.brPicture === "text" || (!!search && matches("brText"))) && (
        <Searchable search={search} matches={matches} labelKey="brText">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium text-ink-2 flex items-center">
              {t("brText")}
              <Tooltip text={t("brTextTip")} />
            </span>
            <input type="text" value={s.brText} maxLength={BR_TEXT_MAX} onChange={(e) => update({ brText: e.target.value })} placeholder={t("brTextPlaceholder")} className={`${inputClass} text-sm`} aria-label={t("brText")} data-testid="br-text" spellCheck={false} />
          </label>
        </Searchable>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="brCols" tipKey="brColsTip" value={s.brCols} range={RANGES.brCols} onChange={(v) => update({ brCols: v })} display={String(s.brCols)} />
      {(!kaleidoscope || !!search) && <Slider t={t} search={search} matches={matches} labelKey="brRows" tipKey="brRowsTip" value={s.brRows} range={RANGES.brRows} onChange={(v) => update({ brRows: v })} display={String(s.brRows)} />}
      {(!kaleidoscope || !!search) && <Slider t={t} search={search} matches={matches} labelKey="brWall" tipKey="brWallTip" value={s.brWall} range={RANGES.brWall} onChange={(v) => update({ brWall: v })} display={`${short(s.brWall, 0)}%`} />}
      {!search && (
        <p className="text-xs text-ink-3 leading-relaxed" data-testid="br-grid-note">
          {t("gridNote", { cols: grid.cols, rows: grid.rows, bricks: grid.cols * grid.rows })}
        </p>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="brBalls" tipKey="brBallsTip" value={s.brBalls} range={RANGES.brBalls} onChange={(v) => update({ brBalls: v })} display={String(s.brBalls)} />
      <Slider t={t} search={search} matches={matches} labelKey="brEvery" tipKey="brEveryTip" value={s.brEvery} range={RANGES.brEvery} onChange={(v) => update({ brEvery: v })} display={s.brEvery > 0 ? String(s.brEvery) : t("everyOff")} />
      <Slider t={t} search={search} matches={matches} labelKey="brSpeed" tipKey="brSpeedTip" value={s.brSpeed} range={RANGES.brSpeed} onChange={(v) => update({ brSpeed: v })} display={short(s.brSpeed, 0)} />
      <Slider t={t} search={search} matches={matches} labelKey="brSize" tipKey="brSizeTip" value={s.brSize} range={RANGES.brSize} onChange={(v) => update({ brSize: v })} display={short(s.brSize, 1)} />
      <Slider t={t} search={search} matches={matches} labelKey="brHp" tipKey="brHpTip" value={s.brHp} range={RANGES.brHp} onChange={(v) => update({ brHp: v })} display={String(s.brHp)} />
      <Slider t={t} search={search} matches={matches} labelKey="brDuration" tipKey="brDurationTip" value={s.brDuration} range={RANGES.brDuration} onChange={(v) => update({ brDuration: v })} display={`${short(s.brDuration, 0)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="brSettle" tipKey="brSettleTip" value={s.brSettle} range={RANGES.brSettle} onChange={(v) => update({ brSettle: v })} display={`${short(s.brSettle, 1)}s`} />
      <Slider t={t} search={search} matches={matches} labelKey="brRebuild" tipKey="brRebuildTip" value={s.brRebuild} range={RANGES.brRebuild} onChange={(v) => update({ brRebuild: v })} display={`${short(s.brRebuild, 1)}s`} />
      <ButtonRow t={t} search={search} matches={matches} labelKey="brOrder" tipKey="brOrderTip" values={BR_ORDERS} labels={ORDER_LABELS} value={s.brOrder} onChange={(brOrder) => update({ brOrder })} columns={3} />
      <Slider t={t} search={search} matches={matches} labelKey="brDrop" tipKey="brDropTip" value={s.brDrop} range={RANGES.brDrop} onChange={(v) => update({ brDrop: v })} display={`${short(s.brDrop, 1)}s`} />
      <Searchable search={search} matches={matches} labelKey="brBed">
        <Toggle t={t} labelKey="brBed" tipKey="brBedTip" value={s.brBed} onChange={(v) => update({ brBed: v })} />
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="brCapsules">
        <Toggle t={t} labelKey="brCapsules" tipKey="brCapsulesTip" value={s.brCapsules} onChange={(v) => update({ brCapsules: v })} />
      </Searchable>
      {(s.brCapsules || !!search) && (
        <>
          <Slider t={t} search={search} matches={matches} labelKey="brCapsuleChance" tipKey="brCapsuleChanceTip" value={s.brCapsuleChance} range={RANGES.brCapsuleChance} onChange={(v) => update({ brCapsuleChance: v })} display={`${short(100 * s.brCapsuleChance, 0)}%`} />
          <Slider t={t} search={search} matches={matches} labelKey="brSplit" tipKey="brSplitTip" value={s.brSplit} range={RANGES.brSplit} onChange={(v) => update({ brSplit: v })} display={`×${s.brSplit}`} />
        </>
      )}
      <Slider t={t} search={search} matches={matches} labelKey="brSymmetry" tipKey="brSymmetryTip" value={s.brSymmetry} range={RANGES.brSymmetry} onChange={(v) => update({ brSymmetry: v })} display={s.brSymmetry > 1 ? String(s.brSymmetry) : t("symmetryOff")} />
      {(kaleidoscope || !!search) && (
        <>
          <ButtonRow t={t} search={search} matches={matches} labelKey="brSymmetryMode" tipKey="brSymmetryModeTip" values={BR_SYMMETRY_MODES} labels={SYMMETRY_LABELS} value={s.brSymmetryMode} onChange={(brSymmetryMode) => update({ brSymmetryMode })} columns={2} />
          <Slider t={t} search={search} matches={matches} labelKey="brHole" tipKey="brHoleTip" value={s.brHole} range={RANGES.brHole} onChange={(v) => update({ brHole: v })} display={`${short(s.brHole, 0)}%`} />
          {!search && (
            <p className="text-xs text-ink-3 leading-relaxed" data-testid="br-kaleidoscope-note">
              {t("kaleidoscopeNote", { real: shown.real, shown: shown.shown })}
            </p>
          )}
        </>
      )}
      <Searchable search={search} matches={matches} labelKey="brOutline">
        <Toggle t={t} labelKey="brOutline" tipKey="brOutlineTip" value={s.brOutline} onChange={(v) => update({ brOutline: v })} />
      </Searchable>
    </div>
  );
}

/** One of the section's option rows (a labelled group of buttons, the active one pressed). */
function ButtonRow<V extends string>({ t, search, matches, labelKey, tipKey, values, labels, value, onChange, columns }: { t: Translate; search: string; matches: Matcher; labelKey: string; tipKey: string; values: readonly V[]; labels: Record<V, string>; value: V; onChange: (v: V) => void; columns: 2 | 3 }) {
  return (
    <Searchable search={search} matches={matches} labelKey={labelKey}>
      <div className="space-y-1.5">
        <span className="text-sm font-medium text-ink-2 flex items-center">
          {t(labelKey)}
          <Tooltip text={t(tipKey)} />
        </span>
        <div className={`grid ${columns === 3 ? "grid-cols-3" : "grid-cols-2"} gap-1`} role="group" aria-label={t(labelKey)}>
          {values.map((v) => (
            <button type="button" key={v} onClick={() => onChange(v)} aria-pressed={value === v} className={pick(value === v)} data-br-option={`${labelKey}:${v}`}>
              {t(String(labels[v]))}
            </button>
          ))}
        </div>
      </div>
    </Searchable>
  );
}
