"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useLocale, useMessages, useTranslations } from "next-intl";
import Tooltip from "../Tooltip";
import { offBtn, onBtn, selectClass, type Matcher, type Translate } from "../ControlPrimitives";
import type { BotPanelProps } from "../useViralBot";
import type { BotCopy } from "@/lib/bot/copy";
import { composePost, editDraft, emptyDraft, fieldsFor, hasOverrides, resetPlatform, type Counter, type DraftField, type PublishDraft } from "@/lib/publish/caption";
import type { PublishClip } from "@/lib/publish/clips";
import { accountViews, getPublishController, sendPlan, type AccountView, type PublishSnapshot, type SendItem } from "@/lib/publish/controller";
import { defaultDraft } from "@/lib/publish/copy";
import { PUBLISH_PLATFORMS, VISIBILITIES, type PublishPlatform, type Visibility } from "@/lib/publish/platforms";
import { SITE_NAME } from "@/lib/site";
import { isDesktopApp } from "@/lib/desktop/bridge"; // --- desktop-exe ---

/*
 * --- social-publish --- The "Publish" block of the Recording section (after the Viral video bot block): the clip to send
 * (the last recording, fast export, batch or bot clip, or a picked file), its words per platform with the platforms'
 * limits, the connected TikTok, Instagram and YouTube accounts – several per platform – and "Send to selected", which
 * sends the clip to every ticked account in one click; the quick-share buttons that need no set-up; the relay profiles
 * and the YouTube app set-up; the recent sends. The state lives in lib/publish/controller.ts.
 */

/** Search keys of the block (added to SECTION_KEYS.recording in Controls.tsx; the labels are in the Controls namespace). */
export const PUBLISH_KEYS = ["publish", "publishAccounts", "publishQuickShare"];

const PLATFORM_NAMES: Record<PublishPlatform, string> = { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube" };
const PLATFORM_ICONS: Record<PublishPlatform, string> = { tiktok: "🎵", instagram: "📸", youtube: "▶️" };
const smallBtn = "px-2 py-1 rounded-md text-[11px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed";
const inputClass = "w-full px-2.5 py-1.5 bg-zinc-800 text-white rounded-lg border border-zinc-700 focus:border-cyan-600 focus:outline-none placeholder-zinc-500 text-xs";

function modeLabel(t: Translate, mode: string | null): string | null {
  if (!mode) return null;
  const key = `mode${mode.charAt(0).toUpperCase()}${mode.slice(1)}`;
  return t.has(key) ? t(key) : mode;
}

/** A known error in the page's language (its code under `Publish.errors`), else the error's own text. */
const errorText = (p: Translate, code: string | null, raw: string | null) => (code && p.has(`errors.${code}`) ? p(`errors.${code}`) : raw);

const mb = (bytes: number) => (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0);

function Avatar({ src, name, platform }: { src: string | null; name: string; platform: PublishPlatform }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" referrerPolicy="no-referrer" className="w-6 h-6 rounded-full object-cover shrink-0 bg-zinc-700" />;
  }
  return (
    <span aria-hidden="true" className="w-6 h-6 rounded-full shrink-0 bg-zinc-700 text-[10px] flex items-center justify-center text-zinc-200">
      {name.trim().charAt(0).toUpperCase() || PLATFORM_ICONS[platform]}
    </span>
  );
}

function CounterBadge({ c, p }: { c: Counter; p: Translate }) {
  return (
    <span className={`tabular-nums ${c.over ? "text-red-400 font-semibold" : c.used > 0.9 * c.max ? "text-amber-300" : "text-zinc-500"}`} data-publish-counter={c.id} data-over={c.over ? "1" : "0"}>
      {p(`counters.${c.id}`, { used: c.used, max: c.max })}
    </span>
  );
}

function ClipCard({ s, clip, p, t }: { s: PublishSnapshot; clip: PublishClip | null; p: Translate; t: Translate }) {
  const c = getPublishController();
  const thumb = clip ? s.thumbs[clip.id] : null;
  return (
    <div className="space-y-2">
      {clip ? (
        <div className="flex gap-2.5 items-center rounded-lg bg-zinc-800/50 border border-zinc-700/40 p-2" data-publish-clip-source={clip.source} data-publish-clip-name={clip.name}>
          {thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={p("thumbAlt")} className="w-12 h-16 object-cover rounded-md bg-black shrink-0" />
          ) : (
            <span aria-hidden="true" className="w-12 h-16 rounded-md bg-zinc-900 flex items-center justify-center text-lg shrink-0">
              🎬
            </span>
          )}
          <div className="flex-1 min-w-0 text-xs">
            <div className="text-zinc-100 font-medium truncate" title={clip.name}>
              {clip.name}
            </div>
            <div className="text-[11px] text-zinc-400 flex flex-wrap gap-x-2">
              <span>{p(`sources.${clip.source}`)}</span>
              {clip.durationSec !== null && <span>· {p("seconds", { sec: clip.durationSec.toFixed(1) })}</span>}
              <span>· {p("megabytes", { mb: mb(clip.bytes) })}</span>
              {modeLabel(t, clip.mode) && <span>· {modeLabel(t, clip.mode)}</span>}
            </div>
          </div>
          <button type="button" onClick={() => c.removeClip(clip.id)} className={`${smallBtn} ${offBtn}`} aria-label={p("removeClip")} title={p("removeClip")}>
            ✕
          </button>
        </div>
      ) : (
        <p className="text-[11px] text-zinc-500 leading-snug" data-testid="publish-no-clip">
          {p("noClip")}
        </p>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        {s.clips.length > 1 && (
          <select aria-label={p("pickClip")} value={s.clipId ?? ""} onChange={(e) => c.selectClip(e.target.value)} className={`${selectClass} text-xs px-2 py-1.5 flex-1 min-w-0`}>
            {s.clips.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} · {p(`sources.${x.source}`)}
              </option>
            ))}
          </select>
        )}
        <label className={`${smallBtn} ${offBtn} inline-flex items-center gap-1`}>
          📁 {p("chooseFile")}
          <input
            id="publish-file-input"
            type="file"
            accept="video/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) c.addFile(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>
    </div>
  );
}

function CaptionEditor({ s, clip, p, regenerate }: { s: PublishSnapshot; clip: PublishClip; p: Translate; regenerate: () => void }) {
  const c = getPublishController();
  const [tab, setTab] = useState<PublishPlatform | "all">("all");
  const draft: PublishDraft = s.drafts[clip.id] ?? emptyDraft();
  const platform = tab === "all" ? null : tab;
  const fields = platform ? fieldsFor(draft, platform) : draft;
  const set = (field: DraftField, value: string) => c.setDraft(clip.id, editDraft(draft, platform, field, value));
  const posts = PUBLISH_PLATFORMS.map((x) => composePost(draft, x));
  const shown = platform ? posts.filter((x) => x.platform === platform) : posts;
  return (
    <div className="space-y-2" data-publish-editor={tab}>
      <div className="flex flex-wrap gap-1" role="tablist" aria-label={p("wordsTitle")}>
        {(["all", ...PUBLISH_PLATFORMS] as const).map((x) => {
          const over = x !== "all" && !posts.find((y) => y.platform === x)!.ok;
          return (
            <button key={x} type="button" role="tab" aria-selected={tab === x} onClick={() => setTab(x)} className={`${smallBtn} ${tab === x ? onBtn : offBtn} ${over ? "ring-1 ring-red-500" : ""}`}>
              {x === "all" ? p("tabAll") : `${PLATFORM_ICONS[x]} ${PLATFORM_NAMES[x]}`}
              {x !== "all" && hasOverrides(draft, x) ? " •" : ""}
            </button>
          );
        })}
        <button type="button" onClick={regenerate} className={`${smallBtn} ${offBtn} ml-auto`} title={p("regenerateTip")}>
          ✨ {p("regenerate")}
        </button>
      </div>
      <label className="block text-[11px] text-zinc-400 space-y-1">
        <span>{p("fieldTitle")}</span>
        <input type="text" value={fields.title} onChange={(e) => set("title", e.target.value)} className={inputClass} data-publish-field="title" />
      </label>
      <label className="block text-[11px] text-zinc-400 space-y-1">
        <span>{p("fieldCaption")}</span>
        <textarea value={fields.caption} onChange={(e) => set("caption", e.target.value)} rows={4} className={`${inputClass} resize-y leading-snug`} data-publish-field="caption" />
      </label>
      <label className="block text-[11px] text-zinc-400 space-y-1">
        <span>{p("fieldHashtags")}</span>
        <input type="text" value={fields.hashtags} onChange={(e) => set("hashtags", e.target.value)} className={inputClass} placeholder="#bouncingball #satisfying" data-publish-field="hashtags" />
      </label>
      {platform && hasOverrides(draft, platform) && (
        <button type="button" onClick={() => c.setDraft(clip.id, resetPlatform(draft, platform))} className={`${smallBtn} ${offBtn}`}>
          ↩ {p("useShared")}
        </button>
      )}
      <ul className="space-y-0.5 text-[11px]" aria-label={p("limits")}>
        {shown.map((post) => (
          <li key={post.platform} className="flex flex-wrap gap-x-2" data-publish-limits={post.platform}>
            <span className="text-zinc-300">
              {PLATFORM_ICONS[post.platform]} {PLATFORM_NAMES[post.platform]}
            </span>
            {post.counters.map((ct) => (
              <CounterBadge key={ct.id} c={ct} p={p} />
            ))}
          </li>
        ))}
      </ul>
      {platform === null ? <p className="text-[11px] text-zinc-500 leading-snug">{p("sharedNote")}</p> : <p className="text-[11px] text-zinc-500 leading-snug">{p(`platformNote.${platform}`)}</p>}
    </div>
  );
}

function AccountRow({ a, s, p }: { a: AccountView; s: PublishSnapshot; p: Translate }) {
  const c = getPublishController();
  const label = a.handle ? `${a.name} · ${a.handle}` : a.name;
  return (
    <li className="flex items-center gap-2 text-xs" data-publish-account={a.key} data-publish-platform={a.platform} data-publish-via={a.via}>
      <input type="checkbox" checked={a.checked} onChange={(e) => c.toggleAccount(a.key, e.target.checked)} className="accent-[#93d119] w-4 h-4 cursor-pointer" aria-label={p("sendTo", { name: label })} disabled={s.sending} />
      <Avatar src={a.avatar} name={a.name} platform={a.platform} />
      <span className="flex-1 min-w-0 truncate text-zinc-200" title={a.note ?? label}>
        {label}
      </span>
      <span className="text-[10px] text-zinc-500 shrink-0">{p(a.via === "relay" ? "viaRelay" : "viaDirect")}</span>
      {a.expired &&
        (a.via === "youtube" ? (
          <button type="button" onClick={() => void c.reauthYouTube(a.key)} className={`${smallBtn} bg-amber-500/20 text-amber-200 hover:bg-amber-500/30`}>
            {p("signInAgain")}
          </button>
        ) : (
          <button type="button" onClick={() => c.connectRelay(a.platform)} className={`${smallBtn} bg-amber-500/20 text-amber-200 hover:bg-amber-500/30`}>
            {p("reconnect")}
          </button>
        ))}
      <button type="button" onClick={() => (a.via === "youtube" ? c.removeYouTube(a.id) : void c.removeRelayAccount(a.id))} className={`${smallBtn} ${offBtn}`} aria-label={p("removeAccount", { name: label })} title={p("removeAccount", { name: label })} disabled={s.sending}>
        ✕
      </button>
    </li>
  );
}

function Accounts({ s, p, now, inApp }: { s: PublishSnapshot; p: Translate; now: number; inApp: boolean }) {
  const c = getPublishController();
  const accounts = accountViews(s, now);
  const profile = s.stored.relayProfiles.find((x) => x.id === s.relay.profileId) ?? null;
  const relayApps = s.relay.info?.platforms;
  const hasClientId = !!(s.stored.youtubeClientId || s.envClientId);
  const relayButton = (platform: PublishPlatform, label: string) => {
    const missing = !profile ? p("needsRelay") : relayApps && !relayApps[platform] ? p("relayNoApp", { platform: PLATFORM_NAMES[platform] }) : null;
    return (
      <button type="button" onClick={() => c.connectRelay(platform)} disabled={!!missing || !!s.connecting || s.relay.status === "error"} title={missing ?? undefined} className={`${smallBtn} border border-[#93d119]/50 text-[#93d119] hover:bg-[#93d119]/10`} data-publish-connect={`relay-${platform}`}>
        + {label}
      </button>
    );
  };
  return (
    <div className="space-y-2.5" data-publish-accounts={accounts.length}>
      {PUBLISH_PLATFORMS.map((platform) => {
        const list = accounts.filter((a) => a.platform === platform);
        return (
          <div key={platform} className="space-y-1.5" data-publish-group={platform}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-zinc-300">
                {PLATFORM_ICONS[platform]} {PLATFORM_NAMES[platform]}
              </span>
              <span className="text-[10px] text-zinc-500">{p("accountCount", { count: list.length })}</span>
              <span className="ml-auto flex gap-1 flex-wrap">
                {/* --- desktop-exe --- Google's sign-in needs a web origin it accepts; app:// is not one: in the app YouTube goes through the relay */}
                {platform === "youtube" && !inApp && (
                  <button type="button" onClick={() => void c.connectYouTube()} disabled={!hasClientId || s.youtube.status !== "idle"} title={hasClientId ? undefined : p("needsClientId")} className={`${smallBtn} border border-[#93d119]/50 text-[#93d119] hover:bg-[#93d119]/10`} data-publish-connect="youtube-direct">
                    + {s.youtube.status === "idle" ? p("connectGoogle") : p("connecting")}
                  </button>
                )}
                {platform === "youtube" ? (profile && relayApps?.youtube ? relayButton("youtube", p("connectViaRelay")) : null) : relayButton(platform, p("connectPlatform", { platform: PLATFORM_NAMES[platform] }))}
              </span>
            </div>
            {list.length > 0 && (
              <ul className="space-y-1 pl-1">
                {list.map((a) => (
                  <AccountRow key={a.key} a={a} s={s} p={p} />
                ))}
              </ul>
            )}
          </div>
        );
      })}
      {s.connecting && (
        <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-300" role="status">
          <span>{p("waitingSignIn", { platform: PLATFORM_NAMES[s.connecting] })}</span>
          <button type="button" onClick={() => c.cancelConnect()} className={`${smallBtn} ${offBtn}`}>
            {p("cancel")}
          </button>
        </div>
      )}
      {s.connectLink && (
        <p className="text-[11px] text-amber-300">
          {p("popupBlocked")}{" "}
          <a href={s.connectLink} target="_blank" rel="noopener" className="underline text-[#93d119]">
            {p("openSignIn")}
          </a>
        </p>
      )}
      {s.youtube.error && (
        <p className="text-[11px] text-red-400 leading-snug" title={s.youtube.error}>
          {errorText(p, s.youtube.code, s.youtube.error)}
        </p>
      )}
      {s.relay.error && (
        <p className="text-[11px] text-red-400 leading-snug" data-testid="publish-relay-error" title={s.relay.error}>
          {p("relayError", { error: errorText(p, s.relay.errorCode, s.relay.error) ?? "" })}
        </p>
      )}
      {s.relay.status === "loading" && <p className="text-[11px] text-zinc-500">{p("loadingAccounts")}</p>}
    </div>
  );
}

function SendRow({ item, p }: { item: SendItem; p: Translate }) {
  const c = getPublishController();
  const pct = Math.round(100 * item.progress);
  const tone = item.status === "published" ? "text-[#93d119]" : item.status === "failed" ? "text-red-400" : item.status === "needsAuth" ? "text-amber-300" : "text-zinc-300";
  return (
    <li className="space-y-1 text-xs" data-publish-send={item.key} data-publish-status={item.status} data-publish-progress={pct}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true">{PLATFORM_ICONS[item.platform]}</span>
        <span className="flex-1 min-w-0 truncate text-zinc-200">{item.label}</span>
        <span className={`shrink-0 ${tone}`}>
          {p(`status.${item.status}`)}
          {(item.status === "uploading" || item.status === "processing") && ` ${pct}%`}
        </span>
      </div>
      {(item.status === "uploading" || item.status === "processing" || item.status === "queued") && (
        <div className="h-1 rounded-full bg-zinc-900 overflow-hidden" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={item.label}>
          <div className="h-full rounded-full bg-[#93d119] transition-[width] duration-150" style={{ width: `${pct}%` }} />
        </div>
      )}
      {item.link && (
        <a href={item.link} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#93d119] underline break-all" data-publish-link={item.key}>
          {p("openPost")} ↗
        </a>
      )}
      {item.note && <p className="text-[11px] text-amber-300 leading-snug">{item.note === "private" || item.note === "unlisted" ? p(`visibilityNote.${item.note}`) : item.note}</p>}
      {item.error && (
        <p className="text-[11px] text-red-400 leading-snug" title={item.error}>
          {errorText(p, item.code, item.error)}
        </p>
      )}
      {item.status === "failed" && (
        <button type="button" onClick={() => void c.retry(item.key)} className={`${smallBtn} ${offBtn}`}>
          ↻ {p("retry")}
        </button>
      )}
      {item.status === "needsAuth" && (
        <button type="button" onClick={() => void c.reauthYouTube(item.key)} className={`${smallBtn} bg-amber-500/20 text-amber-200 hover:bg-amber-500/30`}>
          {p("signInAgain")}
        </button>
      )}
    </li>
  );
}

function RelaySettings({ s, p }: { s: PublishSnapshot; p: Translate }) {
  const c = getPublishController();
  const [form, setForm] = useState({ url: "", key: "", label: "" });
  const [error, setError] = useState<string | null>(null);
  const profiles = s.stored.relayProfiles;
  const save = () => {
    const err = c.saveProfile({ url: form.url || s.envRelayUrl, key: form.key, label: form.label });
    if (err) setError(p(err === "url" ? "relayBadUrl" : "relayNoKey"));
    else {
      setError(null);
      setForm({ url: "", key: "", label: "" });
    }
  };
  return (
    <div className="space-y-2" data-publish-relays={profiles.length}>
      <p className="text-[11px] text-zinc-500 leading-snug">{p("relayIntro")}</p>
      {profiles.length > 0 && (
        <ul className="space-y-1.5">
          {profiles.map((profile) => {
            const active = profile.id === s.relay.profileId;
            const test = s.test?.profileId === profile.id ? s.test : null;
            return (
              <li key={profile.id} className={`rounded-lg border px-2 py-1.5 text-xs space-y-1 ${active ? "border-[#93d119]/60 bg-[#93d119]/5" : "border-zinc-700/50"}`} data-publish-relay={profile.id} data-active={active ? "1" : "0"}>
                <div className="flex items-center gap-2">
                  <input type="radio" name="publish-relay" checked={active} onChange={() => c.selectProfile(profile.id)} className="accent-[#93d119] cursor-pointer" aria-label={p("useRelay", { label: profile.label })} />
                  <span className="flex-1 min-w-0 truncate text-zinc-200" title={profile.url}>
                    {profile.label} <span className="text-zinc-500">· {profile.url.replace(/^https?:\/\//, "")}</span>
                  </span>
                  <button type="button" onClick={() => void c.testProfile(profile.id)} className={`${smallBtn} ${offBtn}`}>
                    {p("testConnection")}
                  </button>
                  <button type="button" onClick={() => c.removeProfile(profile.id)} className={`${smallBtn} ${offBtn}`} aria-label={p("removeRelay", { label: profile.label })}>
                    ✕
                  </button>
                </div>
                {test && (
                  <p className={`text-[11px] leading-snug ${test.ok ? "text-[#93d119]" : "text-red-400"}`} data-testid="publish-relay-test" data-ok={test.ok ? "1" : "0"}>
                    {test.ok ? p("testOk", { label: test.label || profile.label, accounts: test.accounts, platforms: test.platforms.map((x) => PLATFORM_NAMES[x]).join(", ") || "–" }) : p("testFailed", { error: test.error ?? "" })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <div className="grid grid-cols-1 gap-1.5">
        <input id="publish-relay-url" type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder={s.envRelayUrl || "https://my-relay.onrender.com"} className={inputClass} aria-label={p("relayUrl")} />
        <div className="grid grid-cols-2 gap-1.5">
          <input id="publish-relay-key" type="password" autoComplete="off" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder={p("relayKey")} className={inputClass} aria-label={p("relayKey")} />
          <input id="publish-relay-label" type="text" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={p("relayLabel")} className={inputClass} aria-label={p("relayLabel")} />
        </div>
        <button type="button" onClick={save} className={`${smallBtn} ${onBtn} font-semibold py-1.5`}>
          {p("saveRelay")}
        </button>
        {error && <p className="text-[11px] text-red-400">{error}</p>}
      </div>
    </div>
  );
}

function YouTubeSetup({ s, p }: { s: PublishSnapshot; p: Translate }) {
  const c = getPublishController();
  const [value, setValue] = useState(s.stored.youtubeClientId);
  useEffect(() => setValue(s.stored.youtubeClientId), [s.stored.youtubeClientId]);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] text-zinc-500 leading-snug">{p("ytSetupIntro", { origin })}</p>
      <div className="flex gap-1.5">
        <input id="publish-yt-client" type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={s.envClientId || "1234567890-abc.apps.googleusercontent.com"} className={inputClass} aria-label={p("ytClientId")} />
        <button type="button" onClick={() => c.setClientId(value)} className={`${smallBtn} ${onBtn} font-semibold shrink-0`}>
          {p("save")}
        </button>
      </div>
      {s.envClientId && !s.stored.youtubeClientId && <p className="text-[11px] text-zinc-500">{p("ytBuiltIn")}</p>}
      <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="text-[11px] text-[#93d119] underline">
        {p("ytConsole")} ↗
      </a>
    </div>
  );
}

function RecentSends({ s, p, locale }: { s: PublishSnapshot; p: Translate; locale: string }) {
  const c = getPublishController();
  const recent = s.stored.recent;
  return (
    <details className="text-xs" data-publish-recent={recent.length}>
      <summary className="cursor-pointer text-zinc-300 select-none">
        🕘 {p("recent")} <span className="text-zinc-500">({recent.length})</span>
      </summary>
      {recent.length === 0 ? (
        <p className="mt-1 text-[11px] text-zinc-500">{p("recentEmpty")}</p>
      ) : (
        <div className="mt-1.5 space-y-1.5">
          <ul className="space-y-1 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
            {recent.map((r) => (
              <li key={r.id} className="text-[11px] leading-snug flex flex-wrap gap-x-1.5" data-publish-recent-item={r.status}>
                <span className="text-zinc-500 tabular-nums">{new Date(r.at).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" })}</span>
                <span className="text-zinc-300">
                  {PLATFORM_ICONS[r.platform]} {r.account || PLATFORM_NAMES[r.platform]}
                </span>
                <span className={r.status === "failed" ? "text-red-400" : "text-[#93d119]"}>{p(`recentStatus.${r.status}`)}</span>
                <span className="text-zinc-500 truncate max-w-[10rem]" title={r.clip}>
                  {r.clip}
                </span>
                {r.link && (
                  <a href={r.link} target="_blank" rel="noopener noreferrer" className="text-[#93d119] underline">
                    {p("openPost")} ↗
                  </a>
                )}
                {r.error && <span className="text-red-400/80 w-full truncate" title={r.error}>{r.error}</span>}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => c.clearRecent()} className={`${smallBtn} ${offBtn}`}>
            {p("clearRecent")}
          </button>
        </div>
      )}
    </details>
  );
}

export default function PublishSection({ t, search, matches, bot }: { t: Translate; search: string; matches: Matcher; bot?: BotPanelProps }) {
  const p = useTranslations("Publish");
  const messages = useMessages() as Record<string, unknown>;
  const c = getPublishController();
  const s = useSyncExternalStore(c.subscribe, c.getSnapshot, c.getServerSnapshot);
  const locale = useLocale();
  const [now, setNow] = useState(() => Date.now());
  // --- desktop-exe --- inside the Windows app (no direct YouTube sign-in there: app:// is no origin Google accepts)
  const [inApp, setInApp] = useState(false);
  useEffect(() => setInApp(isDesktopApp()), []);
  useEffect(() => {
    c.start();
    const id = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(id);
  }, [c]);
  const clip = s.clips.find((x) => x.id === s.clipId) ?? null;
  const botPlan = bot?.plan ?? null;
  const makeDraft = (x: PublishClip): PublishDraft => {
    const botClip = x.botClipId ? (botPlan?.clips.find((b) => b.id === x.botClipId) ?? null) : null;
    return defaultDraft({ copy: (messages.ViralBot ?? {}) as BotCopy, strings: { title: String(p.raw("defaultTitle")), caption: String(p.raw("defaultCaption")) }, modeName: modeLabel(t, x.mode), mode: x.mode, site: SITE_NAME, botClip });
  };
  useEffect(() => {
    if (clip) c.ensureDraft(clip.id, () => makeDraft(clip));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip?.id]);

  if (search && !PUBLISH_KEYS.some(matches)) return null;

  const plan = sendPlan(s, now);
  const accounts = accountViews(s, now);
  const nothingSetUp = accounts.length === 0 && s.stored.relayProfiles.length === 0 && !s.stored.youtubeClientId && !s.envClientId;
  const canSend = !!clip && plan.targets.length > 0 && plan.blocked.length === 0 && plan.publicOnly.length === 0 && !s.sending;
  const status = s.sending ? "sending" : !clip ? "empty" : "ready";

  return (
    <div className={`space-y-3 border-t border-zinc-800 pt-3 ${search ? "p-3 bg-zinc-800/40 rounded-xl border border-zinc-700/50" : ""}`} data-publish={status} data-publish-clips={s.clips.length}>
      <span className="text-sm font-medium text-zinc-300 flex items-center">
        <span aria-hidden="true" className="mr-1.5">
          📤
        </span>
        {t("publish")}
        <Tooltip text={t("publishTip")} />
      </span>
      <p className="text-[11px] text-zinc-500 leading-snug">{p("intro")}</p>

      <ClipCard s={s} clip={clip} p={p} t={t} />

      {clip && <CaptionEditor key={clip.id} s={s} clip={clip} p={p} regenerate={() => c.setDraft(clip.id, makeDraft(clip))} />}

      {/* Path C: no set-up */}
      <div className="space-y-1.5" data-testid="publish-quick">
        <span className="text-xs font-medium text-zinc-300">⚡ {t("publishQuickShare")}</span>
        <div className="grid grid-cols-3 gap-1.5">
          {PUBLISH_PLATFORMS.map((platform) => (
            <button key={platform} type="button" onClick={() => void c.quickShare(platform)} disabled={!clip} className={`px-2 py-2 rounded-lg text-[11px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${offBtn}`} data-testid={`publish-share-${platform}`}>
              {p("shareTo", { platform: PLATFORM_NAMES[platform] })}
            </button>
          ))}
        </div>
        {s.share ? (
          <p className="text-[11px] text-zinc-300 leading-snug" data-testid="publish-share-note" data-kind={s.share.kind} data-copied={s.share.copied ? "1" : "0"}>
            {s.share.kind === "desktop"
              ? p(s.share.copied ? "shareDesktop" : "shareDesktopNoCopy", { platform: PLATFORM_NAMES[s.share.platform] })
              : p(`shareOutcome.${s.share.kind}`, { platform: PLATFORM_NAMES[s.share.platform] })}
          </p>
        ) : (
          <p className="text-[11px] text-zinc-500 leading-snug">{p("quickHint")}</p>
        )}
      </div>

      {/* Paths A and B: connected accounts */}
      <div className="space-y-2 border-t border-zinc-800/70 pt-2.5">
        <span className="text-xs font-medium text-zinc-300 flex items-center">
          🔗 {t("publishAccounts")}
        </span>
        {nothingSetUp && (
          <ul className="space-y-1 text-[11px] text-zinc-500 leading-snug list-disc pl-4" data-testid="publish-paths">
            {!inApp && <li>{p("pathDirect")}</li>}
            <li>{p("pathRelay")}</li>
            <li>{p("pathShare")}</li>
          </ul>
        )}
        <Accounts s={s} p={p} now={now} inApp={inApp} />
        {inApp && (
          <p className="text-[11px] text-zinc-500 leading-snug" data-testid="publish-app-youtube">
            {p("appYouTube")}
          </p>
        )}
        <label className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
          <span>{p("visibility")}</span>
          <select value={s.stored.visibility} onChange={(e) => c.setVisibility(e.target.value as Visibility)} className={`${selectClass} text-xs px-2 py-1 w-auto`} aria-label={p("visibility")} id="publish-visibility">
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {p(`visibilities.${v}`)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void c.sendSelected()} disabled={!canSend} className="w-full px-4 py-2.5 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 cursor-pointer bg-[#93d119] text-slate-950 hover:bg-[#a4e02a] disabled:opacity-40 disabled:cursor-not-allowed" data-testid="publish-send">
          🚀 {s.sending ? p("sending") : p("sendSelected", { count: plan.targets.length })}
        </button>
        {plan.blocked.length > 0 && <p className="text-[11px] text-red-400 leading-snug">{p("overLimit", { platforms: plan.blocked.map((x) => PLATFORM_NAMES[x]).join(", ") })}</p>}
        {plan.publicOnly.includes("instagram") && (
          <p className="text-[11px] text-red-400 leading-snug" data-testid="publish-public-only">
            {p("instagramPublicOnly")}
          </p>
        )}
        {plan.tiktokFriends && (
          <p className="text-[11px] text-amber-300 leading-snug" data-testid="publish-tiktok-friends">
            {p("tiktokUnlisted")}
          </p>
        )}
        {plan.instagramNeedsMp4 && <p className="text-[11px] text-amber-300 leading-snug">{p("instagramMp4")}</p>}
        {!clip && plan.targets.length > 0 && <p className="text-[11px] text-zinc-500">{p("sendNeedsClip")}</p>}
        {s.sends.length > 0 && (
          <ul className="space-y-2 rounded-lg bg-zinc-800/40 border border-zinc-700/40 p-2" aria-label={p("progress")} data-publish-sends={s.sends.length}>
            {s.sends.map((item) => (
              <SendRow key={item.key} item={item} p={p} />
            ))}
          </ul>
        )}
      </div>

      <details className="text-xs border-t border-zinc-800/70 pt-2.5" data-testid="publish-relay-settings">
        <summary className="cursor-pointer text-zinc-300 select-none">🛰️ {p("relaySettings")}</summary>
        <div className="mt-2">
          <RelaySettings s={s} p={p} />
        </div>
      </details>
      {!inApp && (
        <details className="text-xs" data-testid="publish-yt-settings">
          <summary className="cursor-pointer text-zinc-300 select-none">⚙️ {p("ytSetup")}</summary>
          <div className="mt-2">
            <YouTubeSetup s={s} p={p} />
          </div>
        </details>
      )}
      <RecentSends s={s} p={p} locale={locale} />
    </div>
  );
}
