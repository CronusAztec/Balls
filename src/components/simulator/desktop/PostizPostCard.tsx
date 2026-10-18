"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { DesktopApi, LibraryItem, PostizChannel, SocialChannelSettings, SocialPostOutcome, SocialPostResult, SocialPreparedClip, SocialProgressEvent } from "@/lib/desktop/contract";
import {
  TIKTOK_INTERACTIONS,
  TIKTOK_PRIVACY,
  TIKTOK_TITLE_MAX,
  YOUTUBE_VISIBILITIES,
  approveLabelKey,
  cardChannelOf,
  cardProblems,
  captionLimitOf,
  familyOf,
  genericFieldsOf,
  hashtagCount,
  isoToLocal,
  localToIso,
  toRequest,
  utf8Bytes,
  type CardChannel,
  type CardDraft,
  type CardProblem,
  type GenericField,
  type GenericSettings,
  type InstagramSettings,
  type TikTokSettings,
  type YouTubeSettings,
} from "@/lib/desktop/socialCard";
import { LIMITS } from "@/lib/publish/platforms";
import { platformLabel } from "./AccountsPanel";
import { Bar, Card, errorText, formatBytes, formatSeconds, ghostBtn, inputClass, primaryBtn } from "./ui";

/*
 * --- social-postiz --- The approval card (phase 2 of docs/SOCIAL-AUTOPILOT.md): a Library clip, the channels connected in
 * Postiz to tick, per channel the text (pre-filled from the clip's caption and hashtags) and the provider's settings – TikTok's
 * privacy and interaction choices with no defaults, Instagram's post or story, YouTube's title, visibility and made-for-kids,
 * a generic form for the rest – and when it goes out: now, a scheduled time (Postiz's next free slot on a button) or a draft
 * in Postiz. Nothing reaches Postiz until Approve, whose label says what will happen. Then the progress (transcode, upload,
 * create) and the outcome per channel, polled from Postiz for up to three minutes.
 */

/** What Retry (the Posts tab) hands the card: the channels and texts of the failed post. */
export interface CardPrefill {
  channelIds?: string[];
  texts?: Record<string, string>;
  /** --- social-autopilot --- A queued proposal under review: Approve goes through `queue.approve` and marks it. */
  queueItemId?: string;
  /** --- social-autopilot --- The proposal's settings per channel (a YouTube title; never TikTok's choices, which the user makes here). */
  settings?: Record<string, Record<string, unknown>>;
  /** --- social-autopilot --- The proposed time: "now", "draft" or a UTC ISO time. */
  when?: "now" | "draft" | string | null;
  /** --- social-autopilot --- The planner's sentence, shown on the card. */
  reason?: string;
}

/** --- social-autopilot --- A proposal's settings laid over the platform's defaults, TikTok's user-only choices left out whatever came. */
export function prefilledSettings(defaults: CardChannel["settings"], proposed: Record<string, unknown> | undefined): CardChannel["settings"] {
  if (!proposed) return defaults;
  const extra = { ...proposed };
  for (const key of ["privacy_level", "comment", "duet", "stitch", "__type"]) delete extra[key];
  return { ...defaults, ...extra } as CardChannel["settings"];
}

/** --- social-autopilot --- The card's "when" for a proposal's time (a time that has passed falls back to now). */
export function prefilledWhen(when: CardPrefill["when"], now: number = Date.now()): CardDraft["when"] {
  if (when === "draft") return { kind: "draft" };
  if (typeof when === "string" && when !== "now" && Date.parse(when) > now) return { kind: "schedule", local: isoToLocal(when) };
  return { kind: "now" };
}

export interface PostCardState {
  /** The channels Postiz lists (null until they arrived). */
  channels: PostizChannel[] | null;
  /** Postiz's settings schema per channel of a platform the card has no form of (null: asked, none). */
  schemas: Record<string, SocialChannelSettings | null>;
  draft: CardDraft;
  /** The clip as Postiz will take it (null until known). */
  prepared: SocialPreparedClip | null;
  busy: boolean;
  progress: SocialProgressEvent | null;
  result: SocialPostResult | null;
  /** What Postiz says of the created posts, by post id. */
  outcomes: Record<string, SocialPostOutcome>;
  polling: boolean;
  error: string | null;
  slotBusy: boolean;
}

export const POLL_EVERY_MS = 5_000;
export const POLL_FOR_MS = 3 * 60_000;

export function initialCardState(item: LibraryItem, prefill?: CardPrefill): PostCardState {
  return { channels: null, schemas: {}, draft: { clipId: item.id, channels: [], when: prefill?.when !== undefined ? prefilledWhen(prefill.when) : { kind: "now" } }, prepared: null, busy: false, progress: null, result: null, outcomes: {}, polling: false, error: null, slotBusy: false };
}

export default function PostizPostCard({ bridge, item, prefill, onClose, onPosted }: { bridge: DesktopApi; item: LibraryItem; prefill?: CardPrefill; onClose: () => void; onPosted?: () => void }) {
  const [state, setState] = useState<PostCardState>(() => initialCardState(item, prefill));
  const patch = useCallback((p: Partial<PostCardState> | ((s: PostCardState) => Partial<PostCardState>)) => setState((s) => ({ ...s, ...(typeof p === "function" ? p(s) : p) })), []);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // --- review fix (social-postiz) --- an in-flight `posts()` answer after the card closed may neither patch nor re-arm the timer
  const unmounted = useRef(false);

  // the channels (and the prefilled ones ticked), the clip as Postiz takes it
  useEffect(() => {
    let gone = false;
    bridge.social.channels
      .list()
      .then((channels) => {
        if (gone) return;
        const picked = (prefill?.channelIds ?? []).map((id) => channels.find((c) => c.id === id)).filter((c): c is PostizChannel => !!c && !c.disabled);
        patch((s) => ({
          channels,
          draft: {
            ...s.draft,
            channels: picked.map((c) => {
              const channel = cardChannelOf(c, item.meta, prefill?.texts?.[c.id]);
              return { ...channel, settings: prefilledSettings(channel.settings, prefill?.settings?.[c.id]) }; // --- social-autopilot ---
            }),
          },
        }));
        for (const c of picked) if (familyOf(c.platform) === "other") void loadSchema(c.id);
      })
      .catch((err: unknown) => !gone && patch({ error: errorText(err) }));
    bridge.social
      .prepare(item.id)
      .then((prepared) => !gone && patch({ prepared }))
      .catch((err: unknown) => !gone && patch({ error: errorText(err) }));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the prefill is read once, when the card opens
  }, [bridge, item.id, patch]);

  useEffect(() => bridge.on("socialProgress", (e) => e.clipId === item.id && patch({ progress: e })), [bridge, item.id, patch]);
  useEffect(() => {
    unmounted.current = false;
    return () => {
      unmounted.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, []);

  const loadSchema = useCallback(
    (channelId: string) => {
      patch((s) => (channelId in s.schemas ? {} : { schemas: { ...s.schemas, [channelId]: null } }));
      return bridge.social
        .channelSettings(channelId)
        .then((schema) => patch((s) => ({ schemas: { ...s.schemas, [channelId]: schema } })))
        .catch(() => {});
    },
    [bridge, patch],
  );

  const setDraft = useCallback(
    (draft: CardDraft) => {
      patch({ draft });
      for (const c of draft.channels) if (familyOf(c.platform) === "other") void loadSchema(c.id);
    },
    [patch, loadSchema],
  );

  /** Postiz's view of the created posts, every 5 s for up to 3 min (then the Posts tab has them). */
  const poll = useCallback(
    (result: SocialPostResult, startedAt: number) => {
      const ids = result.postIds.map((p) => p.postId);
      bridge.social
        .posts()
        .then((list) => {
          if (unmounted.current) return;
          const outcomes = Object.fromEntries(list.filter((o) => ids.includes(o.id)).map((o) => [o.id, o]));
          const settled = ids.every((id) => outcomes[id] && outcomes[id].state !== "QUEUE");
          const timeUp = Date.now() - startedAt >= POLL_FOR_MS;
          patch({ outcomes, polling: !settled && !timeUp });
          if (!settled && !timeUp) pollTimer.current = setTimeout(() => poll(result, startedAt), POLL_EVERY_MS);
        })
        .catch(() => {
          if (unmounted.current) return;
          if (Date.now() - startedAt < POLL_FOR_MS) pollTimer.current = setTimeout(() => poll(result, startedAt), POLL_EVERY_MS);
          else patch({ polling: false });
        });
    },
    [bridge, patch],
  );

  const approve = async () => {
    if (state.busy) return;
    patch({ busy: true, error: null, result: null, outcomes: {}, progress: null });
    try {
      const request = toRequest(state.draft);
      // --- social-autopilot --- a queued proposal is approved through the queue (which runs the same post and marks the item)
      const result = prefill?.queueItemId ? await bridge.social.queue.approve(prefill.queueItemId, request) : await bridge.social.post(request);
      patch({ result, busy: false, polling: state.draft.when.kind === "now" });
      onPosted?.();
      if (state.draft.when.kind === "now") poll(result, Date.now());
    } catch (err) {
      patch({ error: errorText(err), busy: false, progress: null });
    }
  };

  const slot = async () => {
    const first = state.draft.channels[0];
    if (!first) return;
    patch({ slotBusy: true, error: null });
    try {
      const s = await bridge.social.slot(first.id);
      patch((st) => ({ draft: { ...st.draft, when: { kind: "schedule", local: isoToLocal(s.date) } }, slotBusy: false }));
    } catch (err) {
      patch({ error: errorText(err), slotBusy: false });
    }
  };

  return <PostizPostCardView item={item} state={state} onDraft={setDraft} onApprove={() => void approve()} onClose={onClose} onSlot={() => void slot()} reason={prefill?.reason} />;
}

/* ------------------------------------------------------------------ the view */

const radio = "accent-[#93d119]";
const fieldLabel = "text-xs text-ink-2 flex flex-col gap-1";
const row = "flex flex-wrap gap-3 text-xs text-ink-2 items-center";

export function PostizPostCardView({ item, state, now = Date.now(), onDraft, onApprove, onClose, onSlot, reason }: { item: LibraryItem; state: PostCardState; now?: number; onDraft: (draft: CardDraft) => void; onApprove: () => void; onClose: () => void; onSlot: () => void; reason?: string }) {
  const t = useTranslations("Desktop");
  const { channels, draft, schemas, prepared, busy, progress, result, outcomes, polling, error } = state;
  const generic: Record<string, GenericField[]> = Object.fromEntries(draft.channels.filter((c) => familyOf(c.platform) === "other").map((c) => [c.id, genericFieldsOf(schemas[c.id])]));
  const problems = cardProblems(draft, now, generic, schemas);
  const done = result !== null;
  const canApprove = !busy && !done && problems.length === 0;

  const toggle = (channel: PostizChannel) => {
    const has = draft.channels.some((c) => c.id === channel.id);
    onDraft({ ...draft, channels: has ? draft.channels.filter((c) => c.id !== channel.id) : [...draft.channels, cardChannelOf(channel, item.meta)] });
  };
  const update = (id: string, change: Partial<CardChannel>) => onDraft({ ...draft, channels: draft.channels.map((c) => (c.id === id ? { ...c, ...change } : c)) });
  const setSettings = (c: CardChannel, settings: Partial<CardChannel["settings"]>) => update(c.id, { settings: { ...c.settings, ...settings } as CardChannel["settings"] });

  const approveLabel = () => {
    const key = approveLabelKey(draft.when);
    if (key === "postizApproveSchedule") {
      const iso = draft.when.kind === "schedule" ? localToIso(draft.when.local) : null;
      return t(key, { date: iso ? new Date(iso).toLocaleString() : "…", count: draft.channels.length });
    }
    return t(key, { count: draft.channels.length });
  };
  const problemText = (p: CardProblem) => {
    const channel = p.channelId ? draft.channels.find((c) => c.id === p.channelId) : null;
    const text = t(p.key, p.params ?? {});
    return channel ? `${channel.name}: ${text}` : text;
  };

  return (
    <Card
      title={t("postizCardTitle", { name: item.fileName })}
      testId="postiz-post-card"
      actions={
        <button type="button" className={ghostBtn} onClick={onClose} disabled={busy} data-testid="postiz-card-close">
          {done ? t("postizCardDone") : t("postizCardCancel")}
        </button>
      }
    >
      <p className="text-xs text-ink-2">{t("postizCardIntro")}</p>
      {/* --- social-autopilot --- the planner's reason, when the card reviews a proposal */}
      {reason && (
        <p className="text-xs text-ink-3" data-testid="postiz-card-reason">
          {t("postizProposedReason", { reason })}
        </p>
      )}
      {/* the clip */}
      <div className="flex gap-3 items-start" data-testid="postiz-card-clip">
        <div className="w-24 h-24 bg-black rounded-lg grid place-items-center overflow-hidden shrink-0">
          {item.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.thumbnail} alt={item.meta.title} className="h-full object-contain" />
          ) : (
            <span className="text-xs text-ink-3">MP4</span>
          )}
        </div>
        <div className="text-xs text-ink-3 space-y-0.5 min-w-0">
          <p className="text-ink font-semibold truncate">{item.meta.title || item.fileName}</p>
          <p>
            {formatSeconds(item.durationSec)} · {formatBytes(prepared?.bytes ?? item.bytes)}
            {item.width && item.height ? ` · ${item.width}×${item.height}` : ""}
          </p>
          {prepared?.transcoded && <p data-testid="postiz-card-transcoded">{t("postizCardTranscoded")}</p>}
          {!prepared && !/\.(mp4|m4v)$/i.test(item.fileName) && <p>{t("postizCardWillTranscode")}</p>}
        </div>
      </div>

      {/* the channels */}
      <div className="space-y-1.5" data-testid="postiz-card-channels">
        <p className="text-xs font-semibold text-ink">{t("postizCardChannels")}</p>
        {channels === null ? (
          <p className="text-xs text-ink-3">…</p>
        ) : channels.length === 0 ? (
          <p className="text-xs text-ink-3">{t("postizChannelsEmpty")}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {channels.map((c) => {
              const on = draft.channels.some((d) => d.id === c.id);
              return (
                <li key={c.id}>
                  <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${c.disabled ? "opacity-50 cursor-not-allowed border-line text-ink-3" : on ? "border-accent bg-accent/15 text-accent" : "border-line-strong bg-surface-2 text-ink-2"}`} data-testid="postiz-card-channel" data-platform={c.platform} data-disabled={c.disabled ? "1" : "0"} data-on={on ? "1" : "0"}>
                    <input type="checkbox" className={radio} checked={on} disabled={c.disabled || busy || done} onChange={() => toggle(c)} />
                    <span>
                      {c.name} <span className="text-ink-3">· {platformLabel(c.platform)}</span>
                      {c.disabled ? ` · ${t("postizDisabled")}` : ""}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* per channel: the text and the settings */}
      {draft.channels.map((c) => (
        <ChannelForm key={c.id} channel={c} generic={generic[c.id] ?? []} schema={schemas[c.id]} locked={busy || done} onText={(text) => update(c.id, { text })} onSettings={(s) => setSettings(c, s)} />
      ))}

      {/* when */}
      <div className="space-y-1.5" data-testid="postiz-card-when">
        <p className="text-xs font-semibold text-ink">{t("postizWhen")}</p>
        <div className={row}>
          {(["now", "schedule", "draft"] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className={radio} name="postiz-when" checked={draft.when.kind === kind} disabled={busy || done} onChange={() => onDraft({ ...draft, when: kind === "schedule" ? { kind, local: draft.when.kind === "schedule" ? draft.when.local : isoToLocal(new Date(now + 60 * 60_000).toISOString()) } : { kind } })} data-testid={`postiz-when-${kind}`} />
              {t(`postizWhen${kind === "now" ? "Now" : kind === "schedule" ? "Schedule" : "Draft"}`)}
            </label>
          ))}
        </div>
        {draft.when.kind === "schedule" && (
          <div className={row}>
            <input type="datetime-local" className={inputClass} value={draft.when.local} disabled={busy || done} onChange={(e) => onDraft({ ...draft, when: { kind: "schedule", local: e.target.value } })} data-testid="postiz-when-local" />
            <button type="button" className={ghostBtn} disabled={busy || done || state.slotBusy || draft.channels.length === 0} onClick={onSlot} data-testid="postiz-slot">
              {state.slotBusy ? "…" : t("postizNextSlot")}
            </button>
            <span className="text-ink-3">{t("postizWhenLocalHint")}</span>
          </div>
        )}
        {draft.when.kind === "draft" && <p className="text-xs text-ink-3">{t("postizWhenDraftHint")}</p>}
      </div>

      {/* approve */}
      {problems.length > 0 && !done && (
        <ul className="text-xs text-ink-3 space-y-0.5" data-testid="postiz-card-problems">
          {problems.map((p, i) => (
            <li key={`${p.channelId ?? ""}:${p.key}:${i}`} data-problem={p.key}>
              {problemText(p)}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={primaryBtn} disabled={!canApprove} onClick={onApprove} data-testid="postiz-approve">
          {busy ? t("postizApproving") : approveLabel()}
        </button>
        <span className="text-xs text-ink-3">{t("postizApproveHint")}</span>
      </div>
      {busy && (
        <div className="space-y-1" data-testid="postiz-card-progress">
          <p className="text-xs text-ink-2">{progress ? t(`postizPhase.${progress.phase}`, { percent: progress.percent }) : t("postizPhase.starting")}</p>
          <Bar value={(progress?.percent ?? 0) / 100} />
        </div>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="postiz-card-error">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-1" data-testid="postiz-card-result">
          <p className="text-xs text-accent">{t(draft.when.kind === "now" ? "postizResultNow" : draft.when.kind === "schedule" ? "postizResultScheduled" : "postizResultDraft", { count: result.postIds.length })}</p>
          <ul className="text-xs space-y-0.5">
            {result.postIds.map((p) => {
              const channel = draft.channels.find((c) => c.id === p.channelId);
              const o = outcomes[p.postId];
              return (
                <li key={p.postId} className="flex flex-wrap gap-2 items-center" data-testid="postiz-card-outcome" data-state={o?.state ?? "pending"}>
                  <span className="text-ink">{channel?.name ?? p.channelId}</span>
                  {o?.state === "PUBLISHED" && o.releaseUrl ? (
                    <a href={o.releaseUrl} target="_blank" rel="noreferrer noopener" className="text-accent underline">
                      {o.releaseUrl}
                    </a>
                  ) : o?.state === "PUBLISHED" ? (
                    <span className="text-accent">{t("postizStatePublished")}</span>
                  ) : o?.state === "ERROR" ? (
                    <span className="text-danger">{o.error || t("postizStateError")}</span>
                  ) : (
                    <span className="text-ink-3">{polling ? t("postizWaitingPostiz") : t("postizSeePostsTab")}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ one channel's text and settings */

function ChannelForm({ channel, generic, schema, locked, onText, onSettings }: { channel: CardChannel; generic: GenericField[]; schema: SocialChannelSettings | null | undefined; locked: boolean; onText: (text: string) => void; onSettings: (settings: Partial<CardChannel["settings"]>) => void }) {
  const t = useTranslations("Desktop");
  const family = familyOf(channel.platform);
  const limit = captionLimitOf(channel.platform, schema);
  const used = family === "youtube" ? utf8Bytes(channel.text) : channel.text.length;
  return (
    <div className="rounded-lg border border-line bg-surface-2/40 p-3 space-y-2" data-testid="postiz-channel-form" data-platform={channel.platform}>
      <p className="text-xs font-semibold text-ink">
        {channel.name} <span className="text-ink-3">· {platformLabel(channel.platform)}</span>
      </p>
      {family === "youtube" && (
        <label className={fieldLabel}>
          {t("postizYouTubeTitle")}
          <input className={inputClass} value={(channel.settings as YouTubeSettings).title} maxLength={LIMITS.youtube.title} disabled={locked} onChange={(e) => onSettings({ title: e.target.value })} data-testid="postiz-yt-title" />
        </label>
      )}
      <label className={fieldLabel}>
        <span className="flex justify-between">
          <span>{family === "youtube" ? t("postizTextDescription") : t("postizTextCaption")}</span>
          <span className={limit !== null && used > limit ? "text-danger" : "text-ink-3"}>
            {limit !== null ? `${used}/${limit}` : used}
            {family === "instagram" ? ` · ${t("postizHashtags", { count: hashtagCount(channel.text), max: LIMITS.instagram.hashtags })}` : ""}
          </span>
        </span>
        <textarea className={`${inputClass} min-h-[5.5rem]`} value={channel.text} disabled={locked} onChange={(e) => onText(e.target.value)} data-testid="postiz-text" />
      </label>
      {family === "tiktok" && <TikTokForm settings={channel.settings as TikTokSettings} locked={locked} onChange={onSettings} />}
      {family === "instagram" && <InstagramForm settings={channel.settings as InstagramSettings} locked={locked} onChange={onSettings} />}
      {family === "youtube" && <YouTubeForm settings={channel.settings as YouTubeSettings} locked={locked} onChange={onSettings} />}
      {family === "other" && generic.length > 0 && <GenericForm fields={generic} settings={channel.settings as GenericSettings} locked={locked} onChange={onSettings} />}
    </div>
  );
}

function TikTokForm({ settings, locked, onChange }: { settings: TikTokSettings; locked: boolean; onChange: (s: Partial<TikTokSettings>) => void }) {
  const t = useTranslations("Desktop");
  return (
    <div className="space-y-2" data-testid="postiz-tiktok-form">
      <p className="text-xs text-ink-3">{t("postizTikTokAuditNote")}</p>
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizTikTokPrivacy")}</legend>
        <div className={row}>
          {TIKTOK_PRIVACY.map((level) => (
            <label key={level} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className={radio} name="postiz-tt-privacy" checked={settings.privacy_level === level} disabled={locked} onChange={() => onChange({ privacy_level: level })} data-testid={`postiz-tt-privacy-${level}`} />
              {t(`postizTikTokPrivacyLevel.${level}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizTikTokInteractions")}</legend>
        {TIKTOK_INTERACTIONS.map((k) => (
          <div key={k} className={row} data-testid={`postiz-tt-${k}`} data-chosen={typeof settings[k] === "boolean" ? "1" : "0"}>
            <span className="w-28">{t(`postizTikTokInteraction.${k}`)}</span>
            {[true, false].map((v) => (
              <label key={String(v)} className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" className={radio} name={`postiz-tt-${k}`} checked={settings[k] === v} disabled={locked} onChange={() => onChange({ [k]: v })} />
                {t(v ? "postizAllow" : "postizDisallow")}
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizTikTokDisclosure")}</legend>
        <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
          <input type="checkbox" className={radio} checked={settings.brand_organic_toggle} disabled={locked} onChange={(e) => onChange({ brand_organic_toggle: e.target.checked })} data-testid="postiz-tt-brand-organic" />
          {t("postizTikTokBrandOrganic")}
        </label>
        <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
          <input type="checkbox" className={radio} checked={settings.brand_content_toggle} disabled={locked} onChange={(e) => onChange({ brand_content_toggle: e.target.checked })} data-testid="postiz-tt-brand-content" />
          {t("postizTikTokBrandContent")}
        </label>
        {(settings.brand_content_toggle || settings.brand_organic_toggle) && settings.privacy_level === "SELF_ONLY" && (
          <p className="text-xs text-danger" data-testid="postiz-tt-branded-private">
            {t("postizProblemTikTokBrandedPrivate")}
          </p>
        )}
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizTikTokMethod")}</legend>
        <div className={row}>
          {(["DIRECT_POST", "UPLOAD"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className={radio} name="postiz-tt-method" checked={settings.content_posting_method === m} disabled={locked} onChange={() => onChange({ content_posting_method: m })} data-testid={`postiz-tt-method-${m}`} />
              {t(`postizTikTokMethodName.${m}`)}
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-3">{t(settings.content_posting_method === "UPLOAD" ? "postizTikTokUploadHint" : "postizTikTokDirectHint")}</p>
      </fieldset>
      <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
        <input type="checkbox" className={radio} checked={settings.video_made_with_ai} disabled={locked} onChange={(e) => onChange({ video_made_with_ai: e.target.checked })} data-testid="postiz-tt-ai" />
        {t("postizTikTokMadeWithAi")}
      </label>
      {/* --- review fix (social-postiz) --- Postiz requires autoAddMusic ("yes" | "no") */}
      <label className="flex items-center gap-1.5 text-xs text-ink-2 cursor-pointer">
        <input type="checkbox" className={radio} checked={settings.autoAddMusic === "yes"} disabled={locked} onChange={(e) => onChange({ autoAddMusic: e.target.checked ? "yes" : "no" })} data-testid="postiz-tt-music" />
        {t("postizTikTokAutoMusic")}
      </label>
      <label className={fieldLabel}>
        {t("postizTikTokTitle", { max: TIKTOK_TITLE_MAX })}
        <input className={inputClass} value={settings.title ?? ""} maxLength={TIKTOK_TITLE_MAX} disabled={locked} onChange={(e) => onChange({ title: e.target.value })} data-testid="postiz-tt-title" />
      </label>
    </div>
  );
}

function InstagramForm({ settings, locked, onChange }: { settings: InstagramSettings; locked: boolean; onChange: (s: Partial<InstagramSettings>) => void }) {
  const t = useTranslations("Desktop");
  return (
    <div className="space-y-2" data-testid="postiz-instagram-form">
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizInstagramType")}</legend>
        <div className={row}>
          {(["post", "story"] as const).map((kind) => (
            <label key={kind} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className={radio} name="postiz-ig-type" checked={settings.post_type === kind} disabled={locked} onChange={() => onChange({ post_type: kind })} data-testid={`postiz-ig-${kind}`} />
              {t(kind === "post" ? "postizInstagramPost" : "postizInstagramStory")}
            </label>
          ))}
        </div>
        <p className="text-xs text-ink-3">{t(settings.post_type === "story" ? "postizInstagramStoryHint" : "postizInstagramReelHint")}</p>
      </fieldset>
      <label className={fieldLabel}>
        {t("postizInstagramCollaborators")}
        <input className={inputClass} value={settings.collaborators ?? ""} disabled={locked} placeholder="name, other.name" onChange={(e) => onChange({ collaborators: e.target.value })} data-testid="postiz-ig-collaborators" />
      </label>
    </div>
  );
}

function YouTubeForm({ settings, locked, onChange }: { settings: YouTubeSettings; locked: boolean; onChange: (s: Partial<YouTubeSettings>) => void }) {
  const t = useTranslations("Desktop");
  return (
    <div className="space-y-2" data-testid="postiz-youtube-form">
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizYouTubeVisibility")}</legend>
        <div className={row}>
          {YOUTUBE_VISIBILITIES.map((v) => (
            <label key={v} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className={radio} name="postiz-yt-type" checked={settings.type === v} disabled={locked} onChange={() => onChange({ type: v })} data-testid={`postiz-yt-type-${v}`} />
              {t(`postizYouTubeVisibilityName.${v}`)}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-1">
        <legend className="text-xs text-ink-2">{t("postizYouTubeKids")}</legend>
        <div className={row}>
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" className={radio} name="postiz-yt-kids" checked={settings.selfDeclaredMadeForKids === v} disabled={locked} onChange={() => onChange({ selfDeclaredMadeForKids: v })} data-testid={`postiz-yt-kids-${v}`} />
              {t(v === "yes" ? "postizYes" : "postizNo")}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={fieldLabel}>
        {t("postizYouTubeTags", { max: LIMITS.youtube.tagsChars })}
        <input className={inputClass} value={settings.tags ?? ""} maxLength={LIMITS.youtube.tagsChars} disabled={locked} placeholder="balls, physics, asmr" onChange={(e) => onChange({ tags: e.target.value })} data-testid="postiz-yt-tags" />
      </label>
    </div>
  );
}

function GenericForm({ fields, settings, locked, onChange }: { fields: GenericField[]; settings: GenericSettings; locked: boolean; onChange: (s: Partial<GenericSettings>) => void }) {
  const t = useTranslations("Desktop");
  return (
    <div className="space-y-2" data-testid="postiz-generic-form">
      <p className="text-xs text-ink-3">{t("postizGenericHint")}</p>
      {fields.map((f) => (
        <label key={f.name} className={fieldLabel} data-testid={`postiz-generic-${f.name}`}>
          {f.name}
          {f.type === "boolean" ? (
            <input type="checkbox" className={radio} checked={settings[f.name] === true} disabled={locked} onChange={(e) => onChange({ [f.name]: e.target.checked })} />
          ) : f.type === "enum" ? (
            <select className={inputClass} value={typeof settings[f.name] === "string" ? (settings[f.name] as string) : ""} disabled={locked} onChange={(e) => onChange({ [f.name]: e.target.value })}>
              <option value="">…</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input className={inputClass} value={typeof settings[f.name] === "string" ? (settings[f.name] as string) : ""} disabled={locked} onChange={(e) => onChange({ [f.name]: e.target.value })} />
          )}
        </label>
      ))}
    </div>
  );
}
