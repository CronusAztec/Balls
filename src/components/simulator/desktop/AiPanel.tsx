"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CLOUD_DEFAULTS, type CloudProvider, type DesktopApi, type DesktopPrefs } from "@/lib/desktop/contract";
import { BOT_PLATFORMS, type BotPlatform } from "@/lib/bot/playbook";
import { AI_TASKS, type DesktopAiApi } from "./useDesktopAi";
import type { CustomContentApi } from "./useCustomContent"; // --- custom-content ---
import { weaponLabel } from "@/lib/physics/modes/fightLeagueRoster";
import type { DesktopPageHooks } from "./pageHooks";
import { Bar, Card, Chip, formatBytes, ghostBtn, inputClass, primaryBtn } from "./ui";
import { applyCopyToPublish } from "@/lib/publish/desktopTargets"; // --- desktop-exe --- the copy goes into the Publish block's draft
// --- desktop-ai-fix --- the AI status panel, the first-run card, the run's progress and timings
import AiStatusPanel from "./AiStatusPanel";
import AiSetupCard, { needsSetup } from "./AiSetupCard";

/*
 * --- desktop-exe --- The AI studio panel: which model answers (a local GGUF – downloaded here with its licence shown, or a
 * file you pick – or a cloud provider with your own key), the four jobs (make videos, copy for Publish, settings assistant,
 * ideas), the reply streaming in with the tool calls and retries under it, and each job's result: planned clips (already
 * queued), copy per platform, the applied settings with Undo, ideas that plan on a click.
 * --- desktop-ai-fix --- With the AI status panel on top, a first-run card while nothing can answer, "Reading the request…
 * N s" / "Writing… N s" during a run with a timing line per turn, a note when the model runs on the CPU and, after a
 * failure on the GPU, a switch to the CPU.
 * --- ai-cut --- Make videos can also cut each clip for TikTok (a checkbox with the platforms; the render queue cuts the
 * clip after its render, lib/clipEdit); the clips card shows the cut the AI proposed under each clip.
 */

export default function AiPanel({ ai, custom, prefs, page, onQueueTab, bridge }: { ai: DesktopAiApi; custom: CustomContentApi; prefs: DesktopPrefs; page: DesktopPageHooks; onQueueTab: () => void; bridge?: DesktopApi }) {
  const t = useTranslations("Desktop");
  const tx = useTranslations("DesktopAiFix"); // --- desktop-ai-fix ---
  const tc = useTranslations("CustomContent"); // --- custom-content ---
  const [modeNote, setModeNote] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [platforms, setPlatforms] = useState<BotPlatform[]>(["reels"]);
  const [existing, setExisting] = useState("");
  const [cut, setCut] = useState(false); // --- ai-cut ---
  const [autoStart, setAutoStart] = useState(true); // --- ai-cut --- one click: the queue starts as soon as the clips are added
  const [provider, setProvider] = useState<CloudProvider>("anthropic");
  const [baseUrl, setBaseUrl] = useState(CLOUD_DEFAULTS.anthropic.baseUrl);
  const [model, setModel] = useState(CLOUD_DEFAULTS.anthropic.model);
  const [apiKey, setApiKey] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  /** --- desktop-exe --- What "Use in Publish" did: written into the draft of the Publish block's clip, or no clip there yet. */
  const [usedInPublish, setUsedInPublish] = useState<"done" | "noClip" | null>(null);
  const status = ai.status;
  useEffect(() => {
    if (!status) return;
    setProvider(status.cloud.provider);
    setBaseUrl(status.cloud.baseUrl);
    setModel(status.cloud.model);
  }, [status]);

  const copy = (text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  };
  const localReady = ai.models.some((m) => m.selected && m.state === "ready");
  const canRun = !!status?.ready;
  // --- desktop-ai-fix --- the run's progress line (seconds of the turn in progress), and whether the model runs on the CPU
  const turnSeconds = ai.turn ? Math.max(0, Math.floor((ai.now - ai.turn.startedAt) / 1000)) : 0;
  const onCpu = prefs.aiProvider === "local" && !!status?.local.loaded && status.local.backend === "cpu";
  // (a run on the GPU, or a model that failed to load with the GPU allowed: the CPU is worth a try)
  const onGpu = prefs.aiProvider === "local" && prefs.aiGpu !== "off" && !!status && (status.local.loaded ? status.local.backend !== "cpu" : !!status.local.error);

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" data-testid="desktop-ai">
      {bridge && (
        <div className="xl:col-span-5">
          <AiStatusPanel bridge={bridge} prefs={prefs} status={status} onGpu={ai.setGpu} />
        </div>
      )}
      <div className="xl:col-span-2 space-y-4">
        {needsSetup(ai) && <AiSetupCard ai={ai} />}
        <Card title={t("aiModelTitle")}>
          <div className="flex gap-2">
            <Chip on={prefs.aiProvider === "local"} onClick={() => ai.useProvider("local")} testId="ai-provider-local">
              {t("aiLocal")}
            </Chip>
            <Chip on={prefs.aiProvider === "cloud"} onClick={() => ai.useProvider("cloud")} testId="ai-provider-cloud">
              {t("aiCloud")}
            </Chip>
          </div>
          {prefs.aiProvider === "local" ? (
            <>
              <p className="text-xs text-ink-3">{t("aiLocalHint")}</p>
              <ul className="space-y-2" data-testid="ai-models">
                {ai.models.map((m) => {
                  const p = ai.progress[m.id];
                  const downloading = m.state === "downloading" || p?.state === "downloading" || p?.state === "verifying";
                  return (
                    <li key={m.id} className={`rounded-lg border px-3 py-2 space-y-1 ${m.selected ? "border-accent/60 bg-accent/5" : "border-line"}`} data-model={m.id} data-model-state={m.state}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-ink flex-1">{m.name}</span>
                        <span className="text-ink-3">{formatBytes(m.size)}</span>
                      </div>
                      <p className="text-xs text-ink-3">
                        {t("aiLicence")}:{" "}
                        {m.licenceUrl ? (
                          <a href={m.licenceUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            {m.licence}
                          </a>
                        ) : (
                          m.licence
                        )}
                      </p>
                      {downloading && (
                        <>
                          <Bar value={(p?.downloaded ?? m.downloaded) / Math.max(1, m.size)} />
                          <p className="text-xs text-ink-2">
                            {p?.state === "verifying" ? t("aiVerifying") : t("aiDownloading", { done: formatBytes(p?.downloaded ?? m.downloaded), total: formatBytes(m.size), speed: formatBytes(p?.bytesPerSec ?? 0) })}
                          </p>
                        </>
                      )}
                      <div className="flex gap-1.5 flex-wrap">
                        {(m.state === "missing" || m.state === "partial" || m.state === "corrupt") && !downloading && !m.custom && (
                          <button type="button" className={`${primaryBtn} !py-0.5`} onClick={() => ai.download(m.id)} data-testid="ai-download">
                            {m.state === "partial" ? t("aiResume", { done: formatBytes(m.downloaded) }) : t("aiDownload")}
                          </button>
                        )}
                        {downloading && (
                          <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => ai.cancelDownload(m.id)}>
                            {t("jobCancel")}
                          </button>
                        )}
                        {m.state === "ready" && !m.selected && (
                          <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => ai.select(m.id)}>
                            {t("aiUse")}
                          </button>
                        )}
                        {m.selected && m.state === "ready" && <span className="text-xs text-accent">{t("aiInUse")}</span>}
                        {(m.state === "ready" || m.state === "partial" || m.custom) && (
                          <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => ai.remove(m.id)}>
                            {m.custom ? t("aiForget") : t("jobRemove")}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className={ghostBtn} onClick={ai.importModel}>
                {t("aiPickGguf")}
              </button>
              {status?.local.loaded && <p className="text-xs text-ink-2" data-testid="ai-backend">{t("aiBackend", { backend: status.local.backend ?? "cpu", layers: status.local.gpuLayers ?? 0 })}</p>}
              {status?.local.error && <p className="text-xs text-danger">{status.local.error}</p>}
            </>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ai.setCloud({ provider, baseUrl, model, use: true, ...(apiKey ? { apiKey } : {}) }).then(() => setApiKey(""));
              }}
            >
              <p className="text-xs text-ink-3">{t("aiCloudHint")}</p>
              <select
                className={`${inputClass} w-full`}
                value={provider}
                onChange={(e) => {
                  const p = e.target.value as CloudProvider;
                  setProvider(p);
                  setBaseUrl(CLOUD_DEFAULTS[p].baseUrl);
                  setModel(CLOUD_DEFAULTS[p].model);
                }}
                aria-label={t("aiCloudProvider")}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">{t("aiOpenAiCompatible")}</option>
              </select>
              <input className={`${inputClass} w-full`} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label={t("aiCloudUrl")} placeholder="https://…" />
              <input className={`${inputClass} w-full`} value={model} onChange={(e) => setModel(e.target.value)} aria-label={t("aiCloudModel")} />
              <input className={`${inputClass} w-full`} type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={status?.cloud.hasKey ? t("aiKeyStored") : t("aiKeyPlaceholder")} aria-label={t("aiKey")} />
              <div className="flex gap-2">
                <button type="submit" className={primaryBtn}>
                  {t("save")}
                </button>
                {status?.cloud.hasKey && (
                  <button type="button" className={ghostBtn} onClick={ai.clearKey}>
                    {t("aiForgetKey")}
                  </button>
                )}
              </div>
              {status && !status.cloud.encryption && <p className="text-xs text-warn">{t("aiNoEncryption")}</p>}
            </form>
          )}
          {ai.message && <p className="text-xs text-danger">{ai.message}</p>}
        </Card>
      </div>

      <div className="xl:col-span-3 space-y-4">
        <Card title={t("aiStudioTitle")}>
          <div className="flex gap-2 flex-wrap">
            {AI_TASKS.map((k) => (
              <Chip key={k} on={ai.task === k} onClick={() => ai.setTask(k)} testId={`ai-task-${k}`}>
                {t(`aiTask.${k}`)}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-ink-3">{t(`aiTaskHint.${ai.task}`)}</p>
          <textarea className={`${inputClass} w-full h-20`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t(`aiPlaceholder.${ai.task}`)} aria-label={t("aiPrompt")} data-testid="ai-prompt" />
          {(ai.task === "videos" || ai.task === "copy") && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-xs text-ink-3">{t("aiPlatforms")}</span>
              {BOT_PLATFORMS.map((p) => (
                <Chip key={p} on={platforms.includes(p)} onClick={() => setPlatforms((ps) => (ps.includes(p) ? (ps.length > 1 ? ps.filter((x) => x !== p) : ps) : [...ps, p]))}>
                  {t(`preset.${p}`)}
                </Chip>
              ))}
              {/* --- ai-cut --- the TikTok cut per clip, after the render */}
              {ai.task === "videos" && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer ml-1" title={t("aiCutTip")}>
                  <input type="checkbox" checked={cut} onChange={(e) => setCut(e.target.checked)} className="w-4 h-4" style={{ accentColor: "#93d119" }} data-testid="ai-cut" />
                  {t("aiCut")}
                </label>
              )}
              {ai.task === "videos" && (
                <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer ml-1" title={t("aiStartTip")}>
                  <input type="checkbox" checked={autoStart} onChange={(e) => setAutoStart(e.target.checked)} className="w-4 h-4" style={{ accentColor: "#93d119" }} data-testid="ai-start" />
                  {t("aiStart")}
                </label>
              )}
            </div>
          )}
          {ai.task === "copy" && <textarea className={`${inputClass} w-full h-14`} value={existing} onChange={(e) => setExisting(e.target.value)} placeholder={t("aiExistingCopy")} aria-label={t("aiExistingCopy")} />}
          <div className="flex gap-2 items-center">
            {ai.running ? (
              <button type="button" className={ghostBtn} onClick={ai.stop} data-testid="ai-stop">
                {t("aiStop")}
              </button>
            ) : (
              <button type="button" className={primaryBtn} disabled={!canRun || (ai.task !== "copy" && ai.task !== "ideas" && ai.task !== "plan" /* --- social-autopilot --- */ && !prompt.trim())} onClick={() => ai.run(prompt.trim(), { platforms, existing, cut, start: autoStart /* --- ai-cut --- */ })} data-testid="ai-run">
                {t("aiRun")}
              </button>
            )}
            {!canRun && <span className="text-xs text-warn">{prefs.aiProvider === "local" && !localReady ? t("aiNeedModel") : t("aiNeedKey")}</span>}
            {ai.running && ai.turn && (
              <span className="text-xs text-ink-2" data-testid="ai-progress">
                {ai.turn.firstTokenAt === null ? tx("reading", { seconds: turnSeconds }) : tx("writing", { seconds: turnSeconds })}
              </span>
            )}
          </div>
          {onCpu && <p className="text-xs text-warn" data-testid="ai-cpu-note">{tx("cpuNote")}</p>}
          {(ai.stream || ai.running) && (
            <pre className="text-xs leading-snug text-ink-2 bg-black/40 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words" data-testid="ai-stream">
              {ai.stream || "…"}
            </pre>
          )}
          {ai.log.length > 0 && (
            <ul className="text-xs space-y-0.5" data-testid="ai-log">
              {ai.log.map((line, i) => (
                <li key={i} className={line.kind === "invalid" || line.kind === "error" ? "text-warn" : line.kind === "tool" ? "text-accent-strong" : "text-ink-3"} data-log-kind={line.kind}>
                  {line.kind === "invalid" ? `↻ ${t("aiRetried")}: ` : line.kind === "tool" ? "› " : ""}
                  {line.timing ? tx("turnTiming", { step: line.timing.step, first: line.timing.firstSec ?? "–", total: line.timing.totalSec }) /* --- desktop-ai-fix --- */ : line.text}
                </li>
              ))}
            </ul>
          )}
          {ai.error && <p className="text-xs text-danger" data-testid="ai-error">{ai.error}</p>}
          {/* --- desktop-ai-fix --- a run that failed on the GPU can go again on the CPU */}
          {ai.error && onGpu && (
            <button type="button" className={`${ghostBtn} self-start`} onClick={() => ai.setGpu("off")} data-testid="ai-try-cpu">
              {tx("tryCpu")}
            </button>
          )}
        </Card>

        {ai.result?.kind === "videos" && (
          <Card title={t("aiClipsTitle", { count: ai.result.result.clips.length })} actions={<button type="button" className={primaryBtn} onClick={onQueueTab}>{t("aiOpenQueue")}</button>}>
            <p className="text-xs text-accent" data-testid="ai-clips-queued">{t(ai.result.started ? "aiClipsStarted" : "aiClipsQueued") /* --- ai-cut --- what this run did, not the checkbox now */}</p>
            {ai.result.result.summary && <p className="text-xs text-ink-2">{ai.result.result.summary}</p>}
            <ul className="space-y-2">
              {ai.result.result.clips.map((c) => (
                <li key={`${c.planId}-${c.name}`} className="rounded-lg border border-line p-2 text-xs space-y-1">
                  <div className="flex gap-2">
                    <span className="font-semibold text-ink flex-1">{c.title}</span>
                    <span className="text-ink-3">{t(`preset.${c.platform}`)}</span>
                  </div>
                  <p className="text-accent-strong">{c.hook}</p>
                  <p className="text-ink-2 whitespace-pre-wrap">{c.caption}</p>
                  <p className="text-ink-3">{c.hashtags.join(" ")}</p>
                  {/* --- ai-cut --- the cut the AI proposed (the queue makes it after the render) */}
                  {c.cut && (
                    <p className="text-ink-3" data-testid="ai-cut-line">
                      {t("aiCutLine", { start: c.cut.startSec.toFixed(1), end: (c.cut.startSec + c.cut.lengthSec).toFixed(1), zoom: Math.round((c.cut.zoom - 1) * 100), hook: c.cut.hook })}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {ai.result?.kind === "copy" && (
          <Card title={t("aiCopyTitle")} testId="ai-copy-result">
            {ai.result.result.items.map((item) => {
              const post = `${item.caption}\n\n${item.hashtags.join(" ")}`;
              return (
                <div key={item.platform} className="rounded-lg border border-line p-2 text-xs space-y-1">
                  <div className="flex gap-2 items-center">
                    <span className="font-semibold text-ink flex-1">
                      {t(`preset.${item.platform}`)} · {item.title}
                    </span>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => copy(post, item.platform)}>
                      {copied === item.platform ? t("copied") : t("aiCopyPost")}
                    </button>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => page.update({ topText: item.hook.slice(0, 120) })}>
                      {t("aiUseHook")}
                    </button>
                  </div>
                  <p className="text-accent-strong">{item.hook}</p>
                  <p className="text-ink-2 whitespace-pre-wrap">{item.caption}</p>
                  <p className="text-ink-3">{item.hashtags.join(" ")}</p>
                </div>
              );
            })}
            {/* --- desktop-exe --- the copy into the Publish block: the draft of its clip on show, per platform (lib/publish/desktopTargets.ts) */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`${primaryBtn} !py-0.5`} data-testid="ai-use-in-publish" onClick={() => setUsedInPublish(applyCopyToPublish(ai.result?.kind === "copy" ? ai.result.result.items : []) ? "done" : "noClip")}>
                {t("aiUseInPublish")}
              </button>
              <p className={`text-xs ${usedInPublish === "noClip" ? "text-warn" : "text-ink-3"}`}>{usedInPublish === "done" ? t("aiUsedInPublish") : usedInPublish === "noClip" ? t("aiPublishNoClip") : t("aiPublishHint")}</p>
            </div>
          </Card>
        )}

        {ai.result?.kind === "settings" && (
          <Card title={t("aiSettingsTitle")} actions={ai.undo ? <button type="button" className={ghostBtn} onClick={ai.undoSettings} data-testid="ai-undo">{t("aiUndo")}</button> : undefined}>
            <p className="text-xs text-ink">{ai.result.result.summary}</p>
            <p className="text-xs text-ink-3 font-mono" data-testid="ai-changed">{ai.result.changed.join(", ") || t("aiNothingChanged")}</p>
          </Card>
        )}


        {/* --- custom-content --- a fighter or a mode the AI just made (already saved on this computer) */}
        {ai.result?.kind === "fighter" && (
          <Card
            title={tc("fighterTitle", { name: ai.result.row.name })}
            testId="ai-fighter-result"
            actions={
              <button type="button" className={primaryBtn} onClick={() => ai.result?.kind === "fighter" && ai.fightWith(ai.result.row.id)} title={tc("fightWithHint")} data-testid="ai-fight-with">
                {tc("fightWith")}
              </button>
            }
          >
            <p className="text-xs text-ink">{ai.result.row.description}</p>
            <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-ink-3">{tc("role")}</dt>
              <dd className="text-ink">{ai.result.row.role}</dd>
              <dt className="text-ink-3">{tc("weapon")}</dt>
              <dd className="text-ink">{weaponLabel(ai.result.row)}</dd>
              <dt className="text-ink-3">{tc("ability")}</dt>
              <dd className="text-ink">
                {ai.result.row.ability.name} <span className="text-ink-3">({ai.result.row.ability.effects.map((e) => e.p).join(" + ")})</span>
              </dd>
              <dt className="text-ink-3">{tc("stats")}</dt>
              <dd className="text-ink font-mono">{[ai.result.row.stats.hp, ai.result.row.stats.speed, ai.result.row.stats.attackSpeed, ai.result.row.stats.damage, ai.result.row.stats.castSpeed, ai.result.row.stats.size].join(" · ")}</dd>
            </dl>
            {ai.result.winRate !== null && <p className="text-xs text-ink-3">{tc("balanced", { rate: Math.round(ai.result.winRate * 100) })}</p>}
            {ai.result.notes.length > 0 && <p className="text-xs text-ink-3">{tc("adjusted", { list: ai.result.notes.join(", ") })}</p>}
            <p className="text-xs text-accent">{tc("kept")}</p>
          </Card>
        )}

        {ai.result?.kind === "mode" && (
          <Card title={tc("modeTitle", { name: ai.result.spec.name })} testId="ai-mode-result" actions={ai.undo ? <button type="button" className={ghostBtn} onClick={ai.undoSettings} data-testid="ai-undo">{tc("undo")}</button> : undefined}>
            <p className="text-xs text-ink">{ai.result.spec.description}</p>
            <p className="text-xs text-ink-3 font-mono" data-testid="ai-changed">{ai.result.changed.join(", ") || t("aiNothingChanged")}</p>
            <p className="text-xs text-accent">{tc("kept")}</p>
          </Card>
        )}

        <Card title={tc("mineTitle")} testId="ai-my-creations">
          {custom.error && <p className="text-xs text-warn">{tc("saveFailed", { error: custom.error })}</p>}
          {modeNote && <p className="text-xs text-warn">{tc("modeNotApplied", { error: modeNote })}</p>}
          {custom.content.fighters.length === 0 && custom.content.modes.length === 0 && <p className="text-xs text-ink-3">{tc("none")}</p>}
          {custom.content.fighters.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-ink-2">{tc("myFighters", { count: custom.content.fighters.length })}</h4>
              <ul className="space-y-1">
                {custom.content.fighters.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-xs rounded-lg border border-line p-2">
                    <span className="inline-block h-3 w-3 rounded-full border border-line-strong" style={{ background: f.body }} aria-hidden />
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold text-ink">{f.name}</span> <span className="text-ink-3">{f.role} · {f.weapon.kind} · {f.ability.name}</span>
                    </span>
                    <button type="button" className={`${primaryBtn} !py-0.5`} onClick={() => f.id && ai.fightWith(f.id)}>{tc("fightWith")}</button>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => f.id && void custom.removeFighter(f.id)}>{tc("delete")}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {custom.content.modes.length > 0 && (
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-ink-2">{tc("myModes", { count: custom.content.modes.length })}</h4>
              <ul className="space-y-1">
                {custom.content.modes.map((m) => (
                  <li key={m.id} className="flex items-center gap-2 text-xs rounded-lg border border-line p-2">
                    <span className="flex-1 min-w-0">
                      <span className="font-semibold text-ink">{m.name}</span> <span className="text-ink-3">{m.description}</span>
                    </span>
                    <button type="button" className={`${primaryBtn} !py-0.5`} onClick={() => setModeNote(ai.applyMode(m))}>{tc("playMode")}</button>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => void custom.removeMode(m.id)}>{tc("delete")}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>

        {/* --- social-autopilot --- the planner's proposals: shown here, queued on "Send to Posts tab", posted only from the approval card */}
        {ai.result?.kind === "plan" && (
          <Card
            title={t("aiPlanTitle", { count: ai.result.proposals.length })}
            testId="ai-plan-result"
            actions={
              <button type="button" className={primaryBtn} disabled={ai.result.sent || ai.result.proposals.length === 0} onClick={() => void ai.sendToQueue()} data-testid="ai-plan-send">
                {t("aiPlanSend")}
              </button>
            }
          >
            <p className="text-xs text-ink-3">{ai.result.sent ? t("aiPlanSent") : t("aiPlanHint")}</p>
            <ul className="space-y-2">
              {ai.result.result.proposals.map((p) => (
                <li key={p.clipId} className="rounded-lg border border-line p-2 text-xs space-y-1" data-testid="ai-plan-proposal">
                  <div className="flex gap-2 items-center">
                    <span className="font-semibold text-ink flex-1">{p.clipId}</span>
                    <span className="text-ink-3">{p.when === "now" ? t("postizWhenNow") : new Date(p.when).toLocaleString()}</span>
                  </div>
                  <p className="text-ink-2">{p.reason}</p>
                  {p.channels.map((c) => {
                    const channel = ai.result?.kind === "plan" ? ai.result.channels.find((ch) => ch.id === c.integrationId) : undefined;
                    return (
                      <div key={c.integrationId} className="rounded-lg bg-surface-2/40 p-2 space-y-0.5">
                        <p className="text-ink-3">{channel ? `${channel.name} · ${channel.platform}` : c.integrationId}</p>
                        {c.title && <p className="font-semibold text-ink">{c.title}</p>}
                        <p className="text-ink-2 whitespace-pre-wrap">{c.text}</p>
                        {c.hashtags && c.hashtags.length > 0 && <p className="text-ink-3">{c.hashtags.join(" ")}</p>}
                      </div>
                    );
                  })}
                </li>
              ))}
            </ul>
          </Card>
        )}

        {ai.result?.kind === "ideas" && (
          <Card title={t("aiIdeasTitle")}>
            <ul className="space-y-2">
              {ai.result.result.ideas.map((idea, i) => (
                <li key={i} className="rounded-lg border border-line p-2 text-xs space-y-1">
                  <div className="flex gap-2 items-center">
                    <span className="font-semibold text-ink flex-1">{idea.title}</span>
                    <span className="text-ink-3">
                      {idea.recipe} · {idea.mode} · {t(`ending.${idea.ending}`)}
                    </span>
                  </div>
                  <p className="text-accent-strong">{idea.hook}</p>
                  <p className="text-ink-2">{idea.why}</p>
                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      className={`${primaryBtn} !py-0.5`}
                      onClick={() => {
                        ai.setTask("videos");
                        setPrompt(t("aiIdeaPrompt", { title: idea.title, hook: idea.hook, recipe: idea.recipe, ending: idea.ending }));
                      }}
                    >
                      {t("aiPlanIdea")}
                    </button>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => page.changeMode(idea.mode as Parameters<DesktopPageHooks["changeMode"]>[0])}>
                      {t("aiOpenMode")}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
