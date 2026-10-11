"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Tooltip from "../Tooltip";
import type { Translate } from "../ControlPrimitives";
import { FL_BY_ID } from "@/lib/physics/modes/fightLeagueRoster";
import { FL_CLIP_SLOTS, type FlClipSlot } from "@/lib/audio/flSoundResolve";
import { decodeWithBrowser, exportFlClipSet, flClipKey, flClipStore, importFlClipSet, parseWav16, prepareFlClip, type FlClipRecord } from "@/lib/audio/flClips";

/**
 * --- fl-overhaul --- (Stage 4) The "Custom sounds" panel under the fighter pickers: for every fighter chosen for the match
 * (not a random slot) its six clip slots – attack, hit, ability, KO, an optional intro, win – each with Add (a file picker),
 * Play and Remove, the rights note, and Export set / Import set (`<name>.jumpingballslive.zip`). A refused file says why
 * (larger than 2 MB, not a playable audio clip). The clips live in this browser's IndexedDB (lib/audio/flClips.ts): never
 * uploaded, never in a link or a project file. The root carries `data-fl-clips` (the slots holding a clip, `fighter:slot`
 * sorted) and `data-fl-clip-played` (the last one played here) for the smoke test.
 */
export interface FlCustomSoundsPanelProps {
  t: Translate;
  /** The fighters chosen for the match (roster ids; random slots left out by the caller or ignored here). */
  fighterIds: readonly string[];
  /** The Custom Sounds switch: off, the clips stay but do not play in the fight. */
  enabled: boolean;
}

const btn = "px-2 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer bg-surface-2 text-ink-2 hover:bg-surface-3 disabled:opacity-40 disabled:cursor-default";

export default function FlCustomSoundsPanel({ t, fighterIds, enabled }: FlCustomSoundsPanelProps) {
  const [records, setRecords] = useState<readonly FlClipRecord[]>([]);
  const [message, setMessage] = useState<{ error: boolean; text: string } | null>(null);
  const [played, setPlayed] = useState("");
  const ctxRef = useRef<AudioContext | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => flClipStore().subscribe((r) => setRecords(r)), []);
  useEffect(
    () => () => {
      void ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    },
    [],
  );
  const fighters = useMemo(() => [...new Set(fighterIds)].filter((id) => FL_BY_ID.has(id)), [fighterIds]);
  const byKey = useMemo(() => new Map(records.map((r) => [r.key, r])), [records]);
  const keys = useMemo(() => records.map((r) => r.key).sort().join(" "), [records]);

  const add = async (id: string, slot: FlClipSlot, file: File | undefined) => {
    if (!file) return;
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      setMessage({ error: true, text: t("flClipBadFile") });
      return;
    }
    const res = await prepareFlClip(file.name, bytes, id, slot, decodeWithBrowser);
    if (!res.ok) {
      setMessage({ error: true, text: t(res.error === "tooLarge" ? "flClipTooLarge" : "flClipBadFile") });
      return;
    }
    await flClipStore().put(res.record);
    setMessage(null);
  };

  const play = (rec: FlClipRecord) => {
    const wav = parseWav16(rec.bytes);
    if (!wav || wav.channels[0].length === 0) return;
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = ctxRef.current ?? (ctxRef.current = new Ctor());
      if (ctx.state === "suspended") void ctx.resume();
      const buffer = ctx.createBuffer(wav.channels.length, wav.channels[0].length, wav.sampleRate);
      wav.channels.forEach((d, c) => buffer.copyToChannel(d, c));
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = Math.min(4, 0.4 / Math.max(0.05, rec.peak));
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
    } catch {
      // no audio output here: the slot still counts as played
    }
    setPlayed(rec.key);
  };

  const exportSet = () => {
    if (records.length === 0) return;
    const { fileName, bytes } = exportFlClipSet(records);
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const importSet = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await importFlClipSet(await file.arrayBuffer(), decodeWithBrowser);
      for (const r of res.records) await flClipStore().put(r);
      const bad = res.refused.length > 0 ? ` ${t("flClipBadFile")}` : "";
      setMessage({ error: res.refused.length > 0, text: `${t("flClipImported", { count: res.records.length })}${bad}` });
    } catch {
      setMessage({ error: true, text: t("flClipImportBad") });
    }
  };

  return (
    <div className={`space-y-2 rounded-lg border border-line p-2 ${enabled ? "" : "opacity-70"}`} data-testid="fl-custom-sounds" data-fl-clips={keys} data-fl-clip-played={played}>
      <p className="text-sm font-medium text-ink-2">
        {t("flClipPanel")}
        <Tooltip text={t("flClipPanelTip")} />
      </p>
      <p className="text-[11px] text-ink-3 leading-relaxed" data-testid="fl-clip-rights">
        {t("flClipRightsNote")}
      </p>
      {!enabled && <p className="text-[11px] text-ink-3">{t("flClipOff")}</p>}
      {fighters.length === 0 && <p className="text-xs text-ink-3">{t("flClipEmpty")}</p>}
      {fighters.map((id) => {
        const row = FL_BY_ID.get(id)!;
        return (
          <div key={id} className="space-y-1" data-testid={`fl-clips-${id}`}>
            <p className="text-xs font-semibold text-ink">{row.name}</p>
            <div className="grid gap-1">
              {FL_CLIP_SLOTS.map((slot) => {
                const key = flClipKey(id, slot);
                const rec = byKey.get(key);
                const label = t(`flClipSlots_${slot}`);
                const inputId = `fl-clip-input-${id}-${slot}`;
                return (
                  <div key={slot} className="flex items-center gap-1.5 text-xs" data-testid={`fl-clip-${id}-${slot}`}>
                    <span className="w-24 shrink-0 text-ink-2">{label}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-3" title={rec?.name}>
                      {rec ? rec.name || key : "–"}
                    </span>
                    <input
                      id={inputId}
                      type="file"
                      accept="audio/*,.wav,.ogg,.flac,.mp3,.m4a,.aac,.webm"
                      className="sr-only"
                      aria-label={t("flClipFile", { slot: label, name: row.name })}
                      data-testid={inputId}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        void add(id, slot, file);
                      }}
                    />
                    <button type="button" className={btn} onClick={() => document.getElementById(inputId)?.click()} data-testid={`fl-clip-add-${id}-${slot}`}>
                      {t("flClipAdd")}
                    </button>
                    <button type="button" className={btn} disabled={!rec} onClick={() => rec && play(rec)} data-testid={`fl-clip-play-${id}-${slot}`}>
                      {t("flClipPlay")}
                    </button>
                    <button type="button" className={btn} disabled={!rec} onClick={() => void flClipStore().remove(key)} data-testid={`fl-clip-remove-${id}-${slot}`}>
                      {t("flClipRemove")}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {message && (
        <p role={message.error ? "alert" : "status"} className={`text-xs ${message.error ? "text-red-500" : "text-ink-2"}`} data-testid="fl-clip-message">
          {message.text}
        </p>
      )}
      <div className="flex gap-1.5">
        <button type="button" className={btn} disabled={records.length === 0} onClick={exportSet} data-testid="fl-clip-export">
          {t("flClipExport")}
        </button>
        <button type="button" className={btn} onClick={() => importRef.current?.click()} data-testid="fl-clip-import">
          {t("flClipImport")}
        </button>
        <input
          ref={importRef}
          type="file"
          accept=".zip,application/zip"
          className="sr-only"
          aria-label={t("flClipImport")}
          data-testid="fl-clip-import-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void importSet(file);
          }}
        />
      </div>
    </div>
  );
}
