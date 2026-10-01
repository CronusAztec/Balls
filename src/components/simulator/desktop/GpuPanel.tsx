"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { BenchmarkResult, DesktopApi, DesktopInfo, DesktopPrefs, EncoderProbe, GpuStatus, UpdateStatus } from "@/lib/desktop/contract";
import { lastVideoAcceleration, setHardwarePreferred } from "@/lib/desktop/gpuEncode";
import { Card, errorText, ghostBtn, inputClass, primaryBtn } from "./ui";

/*
 * --- desktop-exe --- The GPU panel: the GPU Chromium runs on and what it accelerates (video encode / decode, WebGPU), the
 * fast export's GPU preference and what the last export used, ffmpeg (bundled or a full build the user points to) with
 * every encoder it lists, whether its test encode worked and which one is used per codec, a benchmark, and the app's
 * version, update state and logs.
 */

export default function GpuPanel({ bridge, prefs, info, update, onPrefs }: { bridge: DesktopApi; prefs: DesktopPrefs; info: DesktopInfo | null; update: UpdateStatus | null; onPrefs: (patch: Partial<DesktopPrefs>) => void }) {
  const t = useTranslations("Desktop");
  const [gpu, setGpu] = useState<GpuStatus | null>(null);
  const [probe, setProbe] = useState<EncoderProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [bench, setBench] = useState<BenchmarkResult[] | null>(null);
  const [benching, setBenching] = useState(false);
  const [ffmpegPath, setFfmpegPath] = useState(prefs.ffmpegPath);
  const [error, setError] = useState<string | null>(null);

  const runProbe = useCallback(
    (force: boolean) => {
      setProbing(true);
      bridge.gpu
        .probeEncoders(force)
        .then(setProbe)
        .catch((err: unknown) => setError(errorText(err)))
        .finally(() => setProbing(false));
    },
    [bridge],
  );
  useEffect(() => {
    bridge.gpu.status().then(setGpu).catch((err: unknown) => setError(errorText(err)));
    runProbe(false);
  }, [bridge, runProbe]);

  const last = lastVideoAcceleration();
  const yes = (v: boolean) => (v ? t("gpuYes") : t("gpuNo"));
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4" data-testid="desktop-gpu">
      <Card title={t("gpuDevicesTitle")}>
        {gpu ? (
          <>
            <ul className="space-y-1 text-xs" data-gpu-devices={gpu.devices.length}>
              {gpu.devices.length === 0 && <li className="text-zinc-500">{t("gpuNoDevices")}</li>}
              {gpu.devices.map((d) => (
                <li key={`${d.vendorId}-${d.deviceId}`} className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${d.active ? "bg-[#93d119]" : "bg-zinc-600"}`} />
                  <span className="text-zinc-200 font-medium">{d.name}</span>
                  <span className="text-zinc-500">{d.driver}</span>
                  {d.active && <span className="text-[10px] text-[#93d119]">{t("gpuActive")}</span>}
                </li>
              ))}
            </ul>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="text-zinc-500">{t("gpuVideoEncode")}</dt>
              <dd className={gpu.hardwareVideoEncode ? "text-[#93d119]" : "text-zinc-400"} data-testid="gpu-video-encode">{yes(gpu.hardwareVideoEncode)}</dd>
              <dt className="text-zinc-500">{t("gpuVideoDecode")}</dt>
              <dd className={gpu.hardwareVideoDecode ? "text-[#93d119]" : "text-zinc-400"}>{yes(gpu.hardwareVideoDecode)}</dd>
              <dt className="text-zinc-500">WebGPU</dt>
              <dd className={gpu.webgpu ? "text-[#93d119]" : "text-zinc-400"}>{yes(gpu.webgpu)}</dd>
            </dl>
            {gpu.disabled && <p className="text-xs text-amber-400">{t("gpuSafeMode")}</p>}
            <details className="text-[10px] text-zinc-500">
              <summary className="cursor-pointer">{t("gpuSwitches")}</summary>
              <p className="mt-1 font-mono break-all">{gpu.switches.join(" ")}</p>
              <p className="mt-1 font-mono break-all">{Object.entries(gpu.features).map(([k, v]) => `${k}: ${v}`).join(" · ")}</p>
            </details>
          </>
        ) : (
          <p className="text-xs text-zinc-500">…</p>
        )}
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input
            type="checkbox"
            checked={prefs.preferHardware}
            onChange={(e) => {
              setHardwarePreferred(e.target.checked);
              onPrefs({ preferHardware: e.target.checked });
            }}
            className="w-4 h-4"
            style={{ accentColor: "#93d119" }}
            data-testid="gpu-prefer-hardware"
          />
          {t("gpuPreferHardware")}
        </label>
        <p className="text-[11px] text-zinc-500">{last ? t("gpuLastExport", { codec: last.codec, mode: last.acceleration === "prefer-hardware" ? t("gpuModeHardware") : t("gpuModeAuto") }) : t("gpuNoExportYet")}</p>
      </Card>

      <Card
        title={t("ffmpegTitle")}
        actions={
          <>
            <button type="button" className={ghostBtn} disabled={probing} onClick={() => runProbe(true)} data-testid="gpu-probe">
              {probing ? t("ffmpegProbing") : t("ffmpegProbe")}
            </button>
            <button
              type="button"
              className={primaryBtn}
              disabled={benching || !probe?.ffmpeg}
              onClick={() => {
                setBenching(true);
                bridge.gpu
                  .benchmark()
                  .then(setBench)
                  .catch((err: unknown) => setError(errorText(err)))
                  .finally(() => setBenching(false));
              }}
              data-testid="gpu-benchmark"
            >
              {benching ? t("benchRunning") : t("benchRun")}
            </button>
          </>
        }
      >
        {probe?.ffmpeg ? (
          <p className="text-xs text-zinc-400">
            ffmpeg {probe.ffmpeg.version} · {probe.ffmpeg.bundled ? t("ffmpegBundled") : t("ffmpegCustom")}
          </p>
        ) : (
          <p className="text-xs text-amber-400">{probe?.error ? `${t("ffmpegMissing")} (${probe.error})` : probing ? t("ffmpegProbing") : t("ffmpegMissing")}</p>
        )}
        {probe && (
          <div className="grid grid-cols-3 gap-2 text-xs" data-testid="gpu-chosen">
            {(["h264", "hevc", "av1"] as const).map((codec) => (
              <div key={codec} className="bg-zinc-800/60 rounded-lg px-2 py-1.5">
                <div className="text-zinc-500 uppercase text-[10px]">{codec}</div>
                <div className={probe.chosen[codec] ? "text-[#93d119] font-mono" : "text-zinc-500"} data-encoder={codec}>{probe.chosen[codec] ?? t("ffmpegNone")}</div>
              </div>
            ))}
          </div>
        )}
        {probe && probe.encoders.some((e) => e.listed) && (
          <details className="text-xs">
            <summary className="cursor-pointer text-zinc-400">{t("ffmpegEncoders")}</summary>
            <table className="mt-2 w-full text-[11px]">
              <tbody>
                {probe.encoders
                  .filter((e) => e.listed)
                  .map((e) => (
                    <tr key={e.id} className="border-t border-zinc-800">
                      <td className="py-1 font-mono text-zinc-300">{e.id}</td>
                      <td className="text-zinc-500">{e.kind}</td>
                      <td className={e.works ? "text-[#93d119]" : e.works === false ? "text-red-400" : "text-zinc-500"}>{e.works ? t("encoderWorks") : e.works === false ? t("encoderFails") : "–"}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </details>
        )}
        <div className="flex gap-2 items-center">
          <select className={inputClass} value={prefs.encoderOverride} onChange={(e) => onPrefs({ encoderOverride: e.target.value })} aria-label={t("encoderOverride")}>
            <option value="">{t("encoderAuto")}</option>
            {probe?.encoders
              .filter((e) => e.listed && e.codec === "h264")
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.id}
                </option>
              ))}
          </select>
          <span className="text-[11px] text-zinc-500">{t("encoderOverride")}</span>
        </div>
        <div className="flex gap-2">
          <input className={`${inputClass} flex-1`} value={ffmpegPath} placeholder={t("ffmpegPathPlaceholder")} onChange={(e) => setFfmpegPath(e.target.value)} aria-label={t("ffmpegPath")} />
          <button type="button" className={ghostBtn} onClick={() => onPrefs({ ffmpegPath: ffmpegPath.trim() })}>
            {t("save")}
          </button>
        </div>
        <p className="text-[11px] text-zinc-500">{t("ffmpegFullBuildHint")}</p>
        {bench && (
          <table className="w-full text-xs" data-testid="gpu-bench">
            <thead>
              <tr className="text-zinc-500 text-left">
                <th className="font-medium">{t("benchEncoder")}</th>
                <th className="font-medium">fps</th>
                <th className="font-medium">{t("benchRealtime")}</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((b) => (
                <tr key={b.encoder} className="border-t border-zinc-800">
                  <td className="py-1 font-mono text-zinc-300">{b.encoder}</td>
                  <td className="text-zinc-200">{b.ok ? b.fps : "–"}</td>
                  <td className={b.ok ? "text-[#93d119]" : "text-red-400"}>{b.ok ? `${b.realtime}×` : t("encoderFails")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
      </Card>

      <Card title={t("appTitle")}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-zinc-500">{t("appVersion")}</dt>
          <dd className="text-zinc-200" data-testid="desktop-version">{info ? `${info.version} (Electron ${info.electron})` : "…"}</dd>
          <dt className="text-zinc-500">{t("appData")}</dt>
          <dd className="text-zinc-400 break-all">{info?.dataDir ?? "…"}</dd>
          <dt className="text-zinc-500">{t("appUpdate")}</dt>
          <dd className="text-zinc-300" data-testid="desktop-update">{update ? t(`update.${update.state}`, { version: update.version ?? "", progress: Math.round((update.progress ?? 0) * 100) }) : "…"}</dd>
        </dl>
        <div className="flex gap-2 flex-wrap">
          <button type="button" className={ghostBtn} onClick={() => void bridge.update.check()}>
            {t("appCheckUpdates")}
          </button>
          {update?.state === "ready" && (
            <button type="button" className={primaryBtn} onClick={() => void bridge.update.install()}>
              {t("appRestartUpdate")}
            </button>
          )}
          <button type="button" className={ghostBtn} onClick={() => void bridge.openLogs()}>
            {t("appOpenLogs")}
          </button>
        </div>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={prefs.autoUpdate} onChange={(e) => onPrefs({ autoUpdate: e.target.checked })} className="w-4 h-4" style={{ accentColor: "#93d119" }} />
          {t("appAutoUpdate")}
        </label>
        <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
          <input type="checkbox" checked={prefs.closeToTray} onChange={(e) => onPrefs({ closeToTray: e.target.checked })} className="w-4 h-4" style={{ accentColor: "#93d119" }} />
          {t("appCloseToTray")}
        </label>
      </Card>
    </div>
  );
}
