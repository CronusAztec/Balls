"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { Searchable, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import type { SimulatorSettings } from "@/lib/settings";
import { flPinnedSlots, flShowKind, matchFighters, slotTeam, type FlMatch } from "@/lib/physics/modes/fightLeague";
import { FL_BY_ID, type FlFighterRow } from "@/lib/physics/modes/fightLeagueRoster";
import { flWinChances } from "@/lib/physics/modes/fightLeagueShow";
import { FL_CLIP_BUCKETS, FL_CLIP_BUCKET_SEC, flClipPlanAttr, flClipStories, flClipUpsetPossible, isFlClipBucket, isFlClipStory, type FlClipBucket, type FlClipStory } from "@/lib/physics/modes/fightLeagueClip";
import { FL_TIER_SIZES, flTierFileName, flTierGroupKey, flTierGroups, parseFlTierGroup, type FlTierGroup, type FlTierSize } from "@/lib/physics/modes/fightLeagueTier";
import { flClipBridge } from "../fightLeague/makeClip";
import { tierCard } from "../fightLeague/cards";
import { flFontsReady } from "../fightLeague/text";
import { downloadExport } from "@/lib/recording/fastRender";

/*
 * --- fl-overhaul --- (Stage 6) The Fight League block's creator tools (rendered inside FightLeagueSection):
 *
 *  - Make a clip (fl-make-clip): a length bucket (short 15 s, standard 25 s, long 75 s) and a story (any KO, an upset – offered
 *    when a side can be the underdog –, a clutch win, a comeback, an ability finish, a cliffhanger for one match, a bracket's
 *    champion, the boss falling); the page plans it and runs Find Simulation (lib/physics/modes/fightLeagueClip.ts, Simulator.tsx),
 *    whose strip shows the progress and the result; this block shows where the found KO lands. Data: data-fl-clip-plan
 *    (bucket|story|the KO window), data-fl-clip-state, data-fl-clip-ko (the KO's place in the clip), data-fl-clip-sec;
 *  - Tier list (fl-tier-list, fl-tier-story): a division's or a conference's card (`tierCard()` in fightLeague/cards.ts on an
 *    offscreen canvas) downloaded as a 1080 × 1350 or 1080 × 1920 PNG (canvas.toBlob, the export's download path); data-fl-tier
 *    names the last card's group, data-fl-tier-size its size.
 */

/** Search keys of the creator tools (FIGHT_LEAGUE_KEYS adds them). */
export const FIGHT_LEAGUE_CREATOR_KEYS = ["flCreator", "flMakeClip", "flClipBucket", "flClipStory", "flTierList"];

const SLOT_FIELDS = ["flFighterA", "flFighterB", "flFighterC", "flFighterD", "flFighterE", "flFighterF"] as const;

/** The sides of one match as fighter rows (null: a slot is drawn by the seed, so any side may be the underdog). */
function matchSides(s: SimulatorSettings): FlFighterRow[][] | null {
  const match = s.flMatch as FlMatch;
  const n = matchFighters(match);
  const sides: FlFighterRow[][] = [];
  for (let i = 0; i < n; i++) {
    const row = FL_BY_ID.get(s[SLOT_FIELDS[i]]);
    if (!row) return null;
    const team = match === "2v2" || match === "3v3" ? slotTeam(match, i) : i;
    (sides[team] ??= []).push(row);
  }
  return sides;
}

export interface FightLeagueCreatorProps {
  t: Translate;
  search: string;
  matches: Matcher;
  settings: SimulatorSettings;
}

export default function FightLeagueCreatorSection({ t, search, matches, settings: s }: FightLeagueCreatorProps) {
  const fl = useTranslations("FightLeague");
  const status = useSyncExternalStore(flClipBridge.subscribe, flClipBridge.getStatus, flClipBridge.getServerStatus);
  const [bucket, setBucket] = useState<FlClipBucket>("standard");
  const [storyPick, setStory] = useState<FlClipStory>("any");
  const [tierKey, setTierKey] = useState("division:marvel");
  const [tierBusy, setTierBusy] = useState(false);
  const [lastTier, setLastTier] = useState<{ group: string; size: string } | null>(null);
  const kind = flShowKind({ match: s.flMatch, bestOf: s.flBestOf });
  const pinned = flPinnedSlots(SLOT_FIELDS.map((f) => s[f])).length;
  const sides = kind === "single" ? matchSides(s) : null;
  const upsetPossible = flClipUpsetPossible(sides ? flWinChances(sides).chances : null);
  const stories = flClipStories({ kind, pinned, upsetPossible });
  const story = stories.includes(storyPick) ? storyPick : "any";
  const busy = status.state === "measuring" || status.state === "searching";
  const planAttr = status.plan ? flClipPlanAttr(status.plan) : flClipPlanAttr({ bucket, story, kind, cliffhanger: kind === "single" && story === "cliffhanger" });
  const groupLabel = (g: FlTierGroup) => (g.kind === "division" ? fl(`division_${g.id}`) : fl(`conference_${g.id}`));
  const groups = flTierGroups();

  const makeTier = async (size: FlTierSize) => {
    const group = parseFlTierGroup(tierKey);
    if (!group || tierBusy) return;
    setTierBusy(true);
    try {
      await flFontsReady();
      const { width, height } = FL_TIER_SIZES[size];
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      tierCard(ctx, group, { width, height }, { title: t("flTierTitle", { group: groupLabel(group) }), subtitle: t("flTierSubtitle"), disclaimer: t("flTierDisclaimer") });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return;
      downloadExport(blob, "png", flTierFileName(group, width, height).replace(/\.png$/, ""));
      setLastTier({ group: group.id, size: `${width}x${height}` });
    } finally {
      setTierBusy(false);
    }
  };

  const statusText =
    status.state === "measuring"
      ? t("flClipMeasuring")
      : status.state === "searching"
        ? t("flClipSearching")
        : status.state === "found" && status.recordingSec !== null
          ? status.koFraction !== null
            ? t("flClipFound", { sec: status.recordingSec, pct: Math.round(100 * status.koFraction) })
            : t("flClipFoundCut", { sec: status.recordingSec })
          : status.state === "missed"
            ? t("flClipMissed")
            : "";

  return (
    <div className="space-y-3" data-testid="fl-creator">
      <Searchable search={search} matches={matches} labelKey="flCreator">
        <p className="pt-2 text-xs font-bold uppercase tracking-wide text-ink-3">
          {t("flCreator")}
          <Tooltip text={t("flCreatorTip")} />
        </p>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flMakeClip">
        <div className="space-y-2" data-testid="fl-clip-block" data-fl-clip-plan={planAttr} data-fl-clip-state={status.state} data-fl-clip-ko={status.koFraction !== null ? status.koFraction.toFixed(3) : ""} data-fl-clip-sec={status.recordingSec ?? ""}>
          <p className="text-sm font-medium text-ink-2">
            {t("flMakeClip")}
            <Tooltip text={t("flMakeClipTip")} />
          </p>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-ink-3">
              <span className="block">{t("flClipBucket")}</span>
              <select value={bucket} onChange={(e) => isFlClipBucket(e.target.value) && setBucket(e.target.value)} className={`${selectClass} text-sm`} data-testid="fl-clip-bucket" disabled={busy}>
                {FL_CLIP_BUCKETS.map((b) => (
                  <option key={b} value={b}>
                    {t(`flClipBucket_${b}`, { sec: FL_CLIP_BUCKET_SEC[b] })}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-ink-3">
              <span className="block">{t("flClipStory")}</span>
              <select value={story} onChange={(e) => isFlClipStory(e.target.value) && setStory(e.target.value)} className={`${selectClass} text-sm`} data-testid="fl-clip-story" disabled={busy}>
                {stories.map((st) => (
                  <option key={st} value={st}>
                    {t(`flClipStory_${st}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            type="button"
            onClick={() => flClipBridge.request({ bucket, story })}
            disabled={busy}
            className="w-full px-3 py-2 rounded-lg text-sm font-semibold bg-accent text-accent-ink hover:brightness-110 transition-all cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="fl-make-clip"
          >
            {busy ? t("flClipBusy") : t("flMakeClip")}
          </button>
          {statusText && (
            <p className="text-xs text-ink-3 leading-relaxed" data-testid="fl-clip-status" aria-live="polite">
              {statusText}
            </p>
          )}
        </div>
      </Searchable>
      <Searchable search={search} matches={matches} labelKey="flTierList">
        <div className="space-y-2" data-testid="fl-tier-block" data-fl-tier={lastTier?.group ?? ""} data-fl-tier-size={lastTier?.size ?? ""}>
          <label className="text-sm font-medium text-ink-2" htmlFor="fl-tier-group">
            {t("flTierList")}
            <Tooltip text={t("flTierListTip")} />
          </label>
          <select id="fl-tier-group" value={tierKey} onChange={(e) => setTierKey(e.target.value)} className={`${selectClass} text-sm`} data-testid="fl-tier-group">
            <optgroup label={t("flTierDivisions")}>
              {groups
                .filter((g) => g.kind === "division")
                .map((g) => (
                  <option key={flTierGroupKey(g)} value={flTierGroupKey(g)}>
                    {groupLabel(g)}
                  </option>
                ))}
            </optgroup>
            <optgroup label={t("flTierConferences")}>
              {groups
                .filter((g) => g.kind === "conference")
                .map((g) => (
                  <option key={flTierGroupKey(g)} value={flTierGroupKey(g)}>
                    {groupLabel(g)}
                  </option>
                ))}
            </optgroup>
          </select>
          <div className="grid grid-cols-2 gap-1">
            <button type="button" onClick={() => void makeTier("post")} disabled={tierBusy} className="px-2 py-1.5 rounded-lg text-xs font-medium bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer disabled:opacity-60" data-testid="fl-tier-list">
              {t("flTierPost")}
            </button>
            <button type="button" onClick={() => void makeTier("story")} disabled={tierBusy} className="px-2 py-1.5 rounded-lg text-xs font-medium bg-surface-2 text-ink-2 hover:bg-surface-3 cursor-pointer disabled:opacity-60" data-testid="fl-tier-story">
              {t("flTierStory")}
            </button>
          </div>
        </div>
      </Searchable>
    </div>
  );
}
