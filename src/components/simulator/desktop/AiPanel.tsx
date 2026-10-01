"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CLOUD_DEFAULTS, type CloudProvider, type DesktopPrefs } from "@/lib/desktop/contract";
import { BOT_PLATFORMS, type BotPlatform } from "@/lib/bot/playbook";
import { AI_TASKS, type DesktopAiApi } from "./useDesktopAi";
import type { DesktopPageHooks } from "./pageHooks";
import { Bar, Card, Chip, formatBytes, ghostBtn, inputClass, primaryBtn } from "./ui";
import { applyCopyToPublish } from "@/lib/publish/desktopTargets"; // --- desktop-exe --- the copy goes into the Publish block's draft

/*
 * --- desktop-exe --- The AI studio panel: which model answers (a local GGUF – downloaded here with its licence shown, or a
 * file you pick – or a cloud provider with your own key), the four jobs (make videos, copy for Publish, settings assistant,
 * ideas), the reply streaming in with the tool calls and retries under it, and each job's result: planned clips (already
 * queued), copy per platform, the applied settings with Undo, ideas that plan on a click.
 */

export default function AiPanel({ ai, prefs, page, onQueueTab }: { ai: DesktopAiApi; prefs: DesktopPrefs; page: DesktopPageHooks; onQueueTab: () => void }) {
  const t = useTranslations("Desktop");
  const [prompt, setPrompt] = useState("");
  const [platforms, setPlatforms] = useState<BotPlatform[]>(["reels"]);
  const [existing, setExisting] = useState("");
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

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4" data-testid="desktop-ai">
      <div className="xl:col-span-2 space-y-4">
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
              <p className="text-[11px] text-zinc-500">{t("aiLocalHint")}</p>
              <ul className="space-y-2" data-testid="ai-models">
                {ai.models.map((m) => {
                  const p = ai.progress[m.id];
                  const downloading = m.state === "downloading" || p?.state === "downloading" || p?.state === "verifying";
                  return (
                    <li key={m.id} className={`rounded-lg border px-3 py-2 space-y-1 ${m.selected ? "border-[#93d119]/60 bg-[#93d119]/5" : "border-zinc-800"}`} data-model={m.id} data-model-state={m.state}>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-medium text-zinc-200 flex-1">{m.name}</span>
                        <span className="text-zinc-500">{formatBytes(m.size)}</span>
                      </div>
                      <p className="text-[11px] text-zinc-500">
                        {t("aiLicence")}:{" "}
                        {m.licenceUrl ? (
                          <a href={m.licenceUrl} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">
                            {m.licence}
                          </a>
                        ) : (
                          m.licence
                        )}
                      </p>
                      {downloading && (
                        <>
                          <Bar value={(p?.downloaded ?? m.downloaded) / Math.max(1, m.size)} />
                          <p className="text-[11px] text-zinc-400">
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
                        {m.selected && m.state === "ready" && <span className="text-[11px] text-[#93d119]">{t("aiInUse")}</span>}
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
              {status?.local.loaded && <p className="text-[11px] text-zinc-400" data-testid="ai-backend">{t("aiBackend", { backend: status.local.backend ?? "cpu", layers: status.local.gpuLayers ?? 0 })}</p>}
              {status?.local.error && <p className="text-[11px] text-red-400">{status.local.error}</p>}
            </>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void ai.setCloud({ provider, baseUrl, model, use: true, ...(apiKey ? { apiKey } : {}) }).then(() => setApiKey(""));
              }}
            >
              <p className="text-[11px] text-zinc-500">{t("aiCloudHint")}</p>
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
              {status && !status.cloud.encryption && <p className="text-[11px] text-amber-400">{t("aiNoEncryption")}</p>}
            </form>
          )}
          {ai.message && <p className="text-xs text-red-400">{ai.message}</p>}
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
          <p className="text-[11px] text-zinc-500">{t(`aiTaskHint.${ai.task}`)}</p>
          <textarea className={`${inputClass} w-full h-20`} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t(`aiPlaceholder.${ai.task}`)} aria-label={t("aiPrompt")} data-testid="ai-prompt" />
          {(ai.task === "videos" || ai.task === "copy") && (
            <div className="flex gap-2 flex-wrap items-center">
              <span className="text-[11px] text-zinc-500">{t("aiPlatforms")}</span>
              {BOT_PLATFORMS.map((p) => (
                <Chip key={p} on={platforms.includes(p)} onClick={() => setPlatforms((ps) => (ps.includes(p) ? (ps.length > 1 ? ps.filter((x) => x !== p) : ps) : [...ps, p]))}>
                  {t(`preset.${p}`)}
                </Chip>
              ))}
            </div>
          )}
          {ai.task === "copy" && <textarea className={`${inputClass} w-full h-14`} value={existing} onChange={(e) => setExisting(e.target.value)} placeholder={t("aiExistingCopy")} aria-label={t("aiExistingCopy")} />}
          <div className="flex gap-2 items-center">
            {ai.running ? (
              <button type="button" className={ghostBtn} onClick={ai.stop} data-testid="ai-stop">
                {t("aiStop")}
              </button>
            ) : (
              <button type="button" className={primaryBtn} disabled={!canRun || (ai.task !== "copy" && ai.task !== "ideas" && !prompt.trim())} onClick={() => ai.run(prompt.trim(), { platforms, existing })} data-testid="ai-run">
                {t("aiRun")}
              </button>
            )}
            {!canRun && <span className="text-[11px] text-amber-400">{prefs.aiProvider === "local" && !localReady ? t("aiNeedModel") : t("aiNeedKey")}</span>}
          </div>
          {(ai.stream || ai.running) && (
            <pre className="text-[11px] leading-snug text-zinc-300 bg-black/40 rounded-lg p-3 max-h-48 overflow-y-auto whitespace-pre-wrap break-words" data-testid="ai-stream">
              {ai.stream || "…"}
            </pre>
          )}
          {ai.log.length > 0 && (
            <ul className="text-[11px] space-y-0.5" data-testid="ai-log">
              {ai.log.map((line, i) => (
                <li key={i} className={line.kind === "invalid" || line.kind === "error" ? "text-amber-400" : line.kind === "tool" ? "text-cyan-300" : "text-zinc-500"}>
                  {line.kind === "invalid" ? `↻ ${t("aiRetried")}: ` : line.kind === "tool" ? "⚙ " : ""}
                  {line.text}
                </li>
              ))}
            </ul>
          )}
          {ai.error && <p className="text-xs text-red-400" data-testid="ai-error">{ai.error}</p>}
        </Card>

        {ai.result?.kind === "videos" && (
          <Card title={t("aiClipsTitle", { count: ai.result.result.clips.length })} actions={<button type="button" className={primaryBtn} onClick={onQueueTab}>{t("aiOpenQueue")}</button>}>
            <p className="text-[11px] text-[#93d119]">{t("aiClipsQueued")}</p>
            {ai.result.result.summary && <p className="text-xs text-zinc-300">{ai.result.result.summary}</p>}
            <ul className="space-y-2">
              {ai.result.result.clips.map((c) => (
                <li key={`${c.planId}-${c.name}`} className="rounded-lg border border-zinc-800 p-2 text-xs space-y-1">
                  <div className="flex gap-2">
                    <span className="font-semibold text-zinc-100 flex-1">{c.title}</span>
                    <span className="text-zinc-500">{t(`preset.${c.platform}`)}</span>
                  </div>
                  <p className="text-cyan-300">{c.hook}</p>
                  <p className="text-zinc-400 whitespace-pre-wrap">{c.caption}</p>
                  <p className="text-zinc-500">{c.hashtags.join(" ")}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {ai.result?.kind === "copy" && (
          <Card title={t("aiCopyTitle")}>
            {ai.result.result.items.map((item) => {
              const post = `${item.caption}\n\n${item.hashtags.join(" ")}`;
              return (
                <div key={item.platform} className="rounded-lg border border-zinc-800 p-2 text-xs space-y-1">
                  <div className="flex gap-2 items-center">
                    <span className="font-semibold text-zinc-100 flex-1">
                      {t(`preset.${item.platform}`)} · {item.title}
                    </span>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => copy(post, item.platform)}>
                      {copied === item.platform ? t("copied") : t("aiCopyPost")}
                    </button>
                    <button type="button" className={`${ghostBtn} !py-0.5`} onClick={() => page.update({ topText: item.hook.slice(0, 120) })}>
                      {t("aiUseHook")}
                    </button>
                  </div>
                  <p className="text-cyan-300">{item.hook}</p>
                  <p className="text-zinc-400 whitespace-pre-wrap">{item.caption}</p>
                  <p className="text-zinc-500">{item.hashtags.join(" ")}</p>
                </div>
              );
            })}
            {/* --- desktop-exe --- the copy into the Publish block: the draft of its clip on show, per platform (lib/publish/desktopTargets.ts) */}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className={`${primaryBtn} !py-0.5`} data-testid="ai-use-in-publish" onClick={() => setUsedInPublish(applyCopyToPublish(ai.result?.kind === "copy" ? ai.result.result.items : []) ? "done" : "noClip")}>
                {t("aiUseInPublish")}
              </button>
              <p className={`text-[11px] ${usedInPublish === "noClip" ? "text-amber-300" : "text-zinc-500"}`}>{usedInPublish === "done" ? t("aiUsedInPublish") : usedInPublish === "noClip" ? t("aiPublishNoClip") : t("aiPublishHint")}</p>
            </div>
          </Card>
        )}

        {ai.result?.kind === "settings" && (
          <Card title={t("aiSettingsTitle")} actions={ai.undo ? <button type="button" className={ghostBtn} onClick={ai.undoSettings} data-testid="ai-undo">{t("aiUndo")}</button> : undefined}>
            <p className="text-xs text-zinc-200">{ai.result.result.summary}</p>
            <p className="text-[11px] text-zinc-500 font-mono" data-testid="ai-changed">{ai.result.changed.join(", ") || t("aiNothingChanged")}</p>
          </Card>
        )}

        {ai.result?.kind === "ideas" && (
          <Card title={t("aiIdeasTitle")}>
            <ul className="space-y-2">
              {ai.result.result.ideas.map((idea, i) => (
                <li key={i} className="rounded-lg border border-zinc-800 p-2 text-xs space-y-1">
                  <div className="flex gap-2 items-center">
                    <span className="font-semibold text-zinc-100 flex-1">{idea.title}</span>
                    <span className="text-zinc-500">
                      {idea.recipe} · {idea.mode} · {t(`ending.${idea.ending}`)}
                    </span>
                  </div>
                  <p className="text-cyan-300">{idea.hook}</p>
                  <p className="text-zinc-400">{idea.why}</p>
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
