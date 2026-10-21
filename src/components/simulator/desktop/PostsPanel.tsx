"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { AUTOPILOT_LANGUAGES, type AutopilotSettings, type LibraryItem, type PostizChannel, type PostizNotice, type SocialAuditEntry, type SocialPostOutcome, type SocialQueueItem } from "@/lib/desktop/contract";
import { AUTOPILOT_PER_DAY_MAX, AUTOPILOT_PER_DAY_MIN } from "@/lib/desktop/autopilot"; // --- social-autopilot ---
import type { SocialBridge } from "@/lib/desktop/capabilities"; // --- old-bridge --- (the section shows this tab only with an app that has Postiz)
import type { CardPrefill } from "./PostizPostCard";
import type { AutopilotApi } from "./useAutopilot"; // --- social-autopilot ---
import { platformLabel } from "./AccountsPanel";
import { Card, dangerBtn, errorText, ghostBtn, inputClass, primaryBtn } from "./ui";

/*
 * --- social-postiz --- The Posts tab (phase 2 of docs/SOCIAL-AUTOPILOT.md): what became of the posts the user approved, as
 * Postiz reports it for the last two weeks and the next – Scheduled, Posted (with the link), Failed (with Postiz's message)
 * and Drafts – with Retry (the card again, prefilled with the channel and the text, for the clip the audit log remembers) and
 * Delete (after a confirmation that says every channel of that post goes with it), plus Postiz's own notices.
 */

export const POSTS_DAYS = 14;

export interface PostsViewState {
  /** null: no key stored (the tab points to Accounts). */
  configured: boolean | null;
  posts: SocialPostOutcome[];
  notices: PostizNotice[];
  error: string | null;
  message: string | null;
  busy: boolean;
}

export type PostGroup = "scheduled" | "posted" | "failed" | "drafts";
export const POST_GROUPS: readonly PostGroup[] = ["scheduled", "posted", "failed", "drafts"];

export function groupOf(post: SocialPostOutcome): PostGroup {
  return post.state === "PUBLISHED" ? "posted" : post.state === "ERROR" ? "failed" : post.state === "DRAFT" ? "drafts" : "scheduled";
}

/** The Library clip a Postiz post was made from, through the audit log (null when the log does not remember it). */
export function clipOfPost(postId: string, audit: readonly SocialAuditEntry[], library: readonly LibraryItem[]): LibraryItem | null {
  const entry = audit.find((e) => e.action === "createPosts" && e.postIds.includes(postId));
  if (!entry?.clipId) return null;
  return library.find((i) => i.id === entry.clipId && i.exists) ?? null;
}

/** --- social-autopilot --- The card's prefill for a queued proposal: its channels, texts, settings, time, reason and id. */
export function prefillOfProposal(item: SocialQueueItem): CardPrefill {
  return {
    queueItemId: item.id,
    channelIds: item.channels.map((c) => c.integrationId),
    texts: Object.fromEntries(item.channels.map((c) => [c.integrationId, c.text])),
    settings: Object.fromEntries(item.channels.map((c) => [c.integrationId, c.settings])),
    when: item.when,
    reason: item.reason,
  };
}

/** --- social-autopilot --- The queue items the Proposed group shows: waiting for review, on their way, or failed (Review again). */
export function proposedItems(queue: readonly SocialQueueItem[]): SocialQueueItem[] {
  return queue.filter((i) => i.status === "proposed" || i.status === "approved" || i.status === "failed");
}

export default function PostsPanel({ bridge, onRetry, onAccounts, autopilot, onReview }: { bridge: SocialBridge; onRetry: (item: LibraryItem, prefill: CardPrefill) => void; onAccounts: () => void; autopilot?: AutopilotApi; onReview?: (item: LibraryItem, prefill: CardPrefill) => void }) {
  const t = useTranslations("Desktop");
  const [state, setState] = useState<PostsViewState>({ configured: null, posts: [], notices: [], error: null, message: null, busy: false });
  const patch = useCallback((p: Partial<PostsViewState>) => setState((s) => ({ ...s, ...p })), []);

  const load = useCallback(async () => {
    patch({ busy: true });
    try {
      const status = await bridge.social.key.status();
      if (!status.configured) {
        patch({ configured: false, posts: [], notices: [], busy: false });
        return;
      }
      const [posts, notices] = await Promise.all([bridge.social.posts(POSTS_DAYS), bridge.social.notices.list(0)]);
      patch({ configured: true, posts, notices, error: null, busy: false });
    } catch (err) {
      patch({ error: errorText(err), busy: false });
    }
  }, [bridge, patch]);
  useEffect(() => void load(), [load]);

  const remove = async (post: SocialPostOutcome) => {
    if (!window.confirm(t("postizDeleteConfirm", { channel: post.channel?.name ?? "" }))) return;
    patch({ busy: true, error: null, message: null });
    try {
      await bridge.social.postDelete(post.id);
      patch({ message: t("postizDeleted") });
      await load();
    } catch (err) {
      patch({ error: errorText(err), busy: false });
    }
  };
  const retry = async (post: SocialPostOutcome) => {
    patch({ error: null, message: null });
    try {
      const [audit, library] = await Promise.all([bridge.social.audit(500), bridge.library.list()]);
      const item = clipOfPost(post.id, audit, library);
      if (!item) {
        patch({ error: t("postizRetryNoClip") });
        return;
      }
      onRetry(item, { channelIds: post.channel ? [post.channel.id] : [], texts: post.channel ? { [post.channel.id]: post.content } : {} });
    } catch (err) {
      patch({ error: errorText(err) });
    }
  };

  // --- social-autopilot --- Review and approve: the card opens prefilled for the proposal's clip (the user completes TikTok's choices there)
  const review = (item: SocialQueueItem) => {
    const clip = autopilot?.library.find((i) => i.id === item.clipId && i.exists);
    if (!clip) {
      patch({ error: t("postizRetryNoClip") });
      return;
    }
    onReview?.(clip, prefillOfProposal(item));
  };

  return (
    <div className="space-y-4">
      {autopilot && state.configured && (
        <ProposedView items={proposedItems(autopilot.queue)} library={autopilot.library} channels={autopilot.channels} busy={autopilot.busy} error={autopilot.error} onReview={review} onSkip={(id) => void autopilot.skip(id)} onRemove={(id) => void autopilot.remove(id)} onText={(id, channelId, text) => void autopilot.editText(id, channelId, text)} />
      )}
      {autopilot && state.configured && <AutopilotView settings={autopilot.settings} channels={autopilot.channels} planning={autopilot.planning} note={autopilot.note} busy={autopilot.busy} onChange={(p) => void autopilot.setSettings(p)} onProposeNow={() => void autopilot.proposeNow()} />}
      <PostsView state={state} onRefresh={() => void load()} onRetry={(p) => void retry(p)} onDelete={(p) => void remove(p)} onAccounts={onAccounts} />
    </div>
  );
}

/* ------------------------------------------------------------------ --- social-autopilot --- the Proposed group */

export function ProposedView({ items, library, channels, busy, error, onReview, onSkip, onRemove, onText }: { items: SocialQueueItem[]; library: readonly LibraryItem[]; channels: readonly PostizChannel[]; busy: boolean; error: string | null; onReview: (item: SocialQueueItem) => void; onSkip: (id: string) => void; onRemove: (id: string) => void; onText: (id: string, channelId: string, text: string) => void }) {
  const t = useTranslations("Desktop");
  const time = (when: SocialQueueItem["when"]) => {
    if (when === "now" || when === null) return t("postizWhenNow");
    if (when === "draft") return t("postizWhenDraft");
    const at = Date.parse(when);
    return Number.isFinite(at) ? new Date(at).toLocaleString() : when;
  };
  return (
    <Card title={t("postizProposedTitle", { count: items.length })} testId="postiz-proposed">
      <p className="text-xs text-ink-2">{t("postizProposedIntro")}</p>
      {error && (
        <p className="text-xs text-danger" role="alert" data-testid="postiz-proposed-error">
          {error}
        </p>
      )}
      {items.length === 0 ? (
        <p className="text-xs text-ink-3" data-testid="postiz-proposed-empty">
          {t("postizProposedEmpty")}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => {
            const clip = library.find((i) => i.id === item.clipId);
            const locked = busy || item.status === "approved";
            return (
              <li key={item.id} className="rounded-lg border border-line bg-surface-2/40 p-3 space-y-2 text-xs" data-testid="postiz-proposal" data-status={item.status} data-by={item.by} data-queue-id={item.id}>
                <div className="flex gap-3 items-start">
                  <div className="w-16 h-16 bg-black rounded-lg grid place-items-center overflow-hidden shrink-0">
                    {clip?.thumbnail ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={clip.thumbnail} alt={clip.meta.title} className="h-full object-contain" />
                    ) : (
                      <span className="text-[10px] text-ink-3">MP4</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-ink font-semibold truncate">{clip ? clip.meta.title || clip.fileName : t("postizProposedClipGone")}</p>
                    <p className="text-ink-3">
                      {item.channels.map((c) => channels.find((ch) => ch.id === c.integrationId)?.name ?? platformLabel(c.platform)).join(" · ")} · {time(item.when)} · {t(`postizQueueStatus.${item.status}`)} · {t(`postizProposedBy.${item.by}`)}
                    </p>
                    {item.reason && <p className="text-ink-2">{t("postizProposedReason", { reason: item.reason })}</p>}
                    {item.status === "failed" && item.error && (
                      <p className="text-danger" data-testid="postiz-proposal-error">
                        {item.error}
                      </p>
                    )}
                  </div>
                </div>
                {item.channels.map((c) => (
                  <label key={c.integrationId} className="flex flex-col gap-1 text-ink-2">
                    <span>
                      {channels.find((ch) => ch.id === c.integrationId)?.name ?? c.integrationId} <span className="text-ink-3">· {platformLabel(c.platform)}</span>
                    </span>
                    <textarea key={`${item.id}:${c.integrationId}:${c.text}`} className={`${inputClass} min-h-[3.5rem]`} defaultValue={c.text} disabled={locked} onBlur={(e) => e.target.value !== c.text && onText(item.id, c.integrationId, e.target.value)} data-testid="postiz-proposal-text" />
                  </label>
                ))}
                <div className="flex flex-wrap gap-2 items-center">
                  <button type="button" className={primaryBtn} disabled={locked || !clip?.exists} onClick={() => onReview(item)} data-testid="postiz-proposal-review">
                    {t("postizProposedReview")}
                  </button>
                  <button type="button" className={ghostBtn} disabled={locked} onClick={() => onSkip(item.id)} data-testid="postiz-proposal-skip">
                    {t("postizProposedSkip")}
                  </button>
                  <button type="button" className={dangerBtn} disabled={locked} onClick={() => onRemove(item.id)} data-testid="postiz-proposal-remove">
                    {t("postizProposedRemove")}
                  </button>
                  <span className="text-ink-3">{t("postizProposedHint")}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ --- social-autopilot --- the Autopilot card */

export function AutopilotView({ settings, channels, planning, note, busy, onChange, onProposeNow }: { settings: AutopilotSettings | null; channels: readonly PostizChannel[]; planning: boolean; note: AutopilotApi["note"]; busy: boolean; onChange: (patch: Partial<AutopilotSettings>) => void; onProposeNow: () => void }) {
  const t = useTranslations("Desktop");
  const s = settings;
  const noteText = () => {
    if (!note) return null;
    if (note.key === "proposed") return t("postizAutopilotProposed", { count: note.count ?? 0 });
    if (note.key === "error") return note.error ?? t("postizAutopilotFailed");
    return t(`postizAutopilotNote.${note.key}`);
  };
  return (
    <Card
      title={t("postizAutopilotTitle")}
      testId="postiz-autopilot"
      actions={
        <button type="button" className={primaryBtn} disabled={!s || planning || busy || s.channels.length === 0} onClick={onProposeNow} data-testid="postiz-autopilot-now">
          {planning ? t("postizAutopilotPlanning") : t("postizAutopilotProposeNow")}
        </button>
      }
    >
      <p className="text-xs text-ink-2">{t("postizAutopilotIntro")}</p>
      <p className="text-xs text-accent" data-testid="postiz-autopilot-honest">
        {t("postizAutopilotHonest")}
      </p>
      {s && (
        <div className="space-y-2 text-xs text-ink-2" data-testid="postiz-autopilot-form" data-enabled={s.enabled ? "1" : "0"}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="accent-[#93d119]" checked={s.enabled} disabled={busy} onChange={(e) => onChange({ enabled: e.target.checked })} data-testid="postiz-autopilot-enabled" />
            {t("postizAutopilotEnable")}
          </label>
          <div className="space-y-1">
            <p className="text-ink">{t("postizAutopilotChannels")}</p>
            {channels.length === 0 ? (
              <p className="text-ink-3">{t("postizChannelsEmpty")}</p>
            ) : (
              <ul className="flex flex-wrap gap-2">
                {channels.map((c) => (
                  <li key={c.id}>
                    <label className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border cursor-pointer ${c.disabled ? "opacity-50 border-line text-ink-3" : s.channels.includes(c.id) ? "border-accent bg-accent/15 text-accent" : "border-line-strong bg-surface-2"}`} data-testid="postiz-autopilot-channel" data-on={s.channels.includes(c.id) ? "1" : "0"}>
                      <input type="checkbox" className="accent-[#93d119]" checked={s.channels.includes(c.id)} disabled={busy || c.disabled} onChange={(e) => onChange({ channels: e.target.checked ? [...s.channels, c.id] : s.channels.filter((id) => id !== c.id) })} />
                      {c.name} <span className="text-ink-3">· {platformLabel(c.platform)}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-wrap gap-3 items-center">
            <label className="flex items-center gap-2">
              {t("postizAutopilotPerDay")}
              <input type="number" className={`${inputClass} w-16`} min={AUTOPILOT_PER_DAY_MIN} max={AUTOPILOT_PER_DAY_MAX} value={s.perDay} disabled={busy} onChange={(e) => onChange({ perDay: Number(e.target.value) })} data-testid="postiz-autopilot-perday" />
            </label>
            <label className="flex items-center gap-2">
              {t("postizAutopilotQuietFrom")}
              <input type="time" className={inputClass} value={s.quietFrom} disabled={busy} onChange={(e) => onChange({ quietFrom: e.target.value })} data-testid="postiz-autopilot-quiet-from" />
            </label>
            <label className="flex items-center gap-2">
              {t("postizAutopilotQuietTo")}
              <input type="time" className={inputClass} value={s.quietTo} disabled={busy} onChange={(e) => onChange({ quietTo: e.target.value })} data-testid="postiz-autopilot-quiet-to" />
            </label>
            <label className="flex items-center gap-2">
              {t("postizAutopilotLanguage")}
              <select className={inputClass} value={s.language} disabled={busy} onChange={(e) => onChange({ language: e.target.value as AutopilotSettings["language"] })} data-testid="postiz-autopilot-language">
                {AUTOPILOT_LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {t(`postizAutopilotLang.${l}`)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-ink-3">
            {t("postizAutopilotEvery", { hours: s.proposeHours })} {s.lastPlannedAt ? t("postizAutopilotLastPlanned", { date: new Date(s.lastPlannedAt).toLocaleString() }) : t("postizAutopilotNever")}
          </p>
        </div>
      )}
      {noteText() && (
        <p className={`text-xs ${note?.key === "error" ? "text-danger" : "text-ink-2"}`} data-testid="postiz-autopilot-note">
          {noteText()}
        </p>
      )}
    </Card>
  );
}

/** The tab as a function of its state (the tests render it with every state). */
export function PostsView({ state, onRefresh, onRetry, onDelete, onAccounts }: { state: PostsViewState; onRefresh: () => void; onRetry: (post: SocialPostOutcome) => void; onDelete: (post: SocialPostOutcome) => void; onAccounts: () => void }) {
  const t = useTranslations("Desktop");
  const { configured, posts, notices, error, message, busy } = state;
  const grouped: Record<PostGroup, SocialPostOutcome[]> = { scheduled: [], posted: [], failed: [], drafts: [] };
  for (const p of posts) grouped[groupOf(p)].push(p);
  const time = (iso: string) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) ? new Date(at).toLocaleString() : iso;
  };
  return (
    <div className="space-y-4" data-testid="desktop-posts">
      <Card
        title={t("postizPostsTitle")}
        testId="postiz-posts"
        actions={
          <button type="button" className={ghostBtn} onClick={onRefresh} disabled={busy} data-testid="postiz-posts-refresh">
            {t("postizRefresh")}
          </button>
        }
      >
        <p className="text-xs text-ink-2">{t("postizPostsIntro")}</p>
        {configured === false && (
          <p className="text-xs text-ink-3" data-testid="postiz-posts-nokey">
            {t("postizPostsNoKey")}{" "}
            <button type="button" className="text-accent underline cursor-pointer" onClick={onAccounts}>
              {t("tab.accounts")}
            </button>
          </p>
        )}
        {message && (
          <p className="text-xs text-accent" data-testid="postiz-posts-message">
            {message}
          </p>
        )}
        {error && (
          <p className="text-xs text-danger" role="alert" data-testid="postiz-posts-error">
            {error}
          </p>
        )}
        {configured && posts.length === 0 && !busy && <p className="text-xs text-ink-3">{t("postizPostsEmpty")}</p>}
        {POST_GROUPS.filter((g) => grouped[g].length > 0).map((g) => (
          <div key={g} className="space-y-1.5" data-testid={`postiz-group-${g}`}>
            <p className="text-xs font-semibold text-ink">
              {t(`postizGroup.${g}`)} · {grouped[g].length}
            </p>
            <ul className="space-y-1.5">
              {grouped[g].map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 text-xs border border-line rounded-lg px-3 py-2 bg-surface-2/40" data-testid="postiz-post" data-state={p.state} data-post-id={p.id}>
                  {p.channel?.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a picture Postiz hosts, not a site asset
                    <img src={p.channel.picture} alt="" width={24} height={24} className="w-6 h-6 rounded-full object-cover bg-surface-3" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="w-6 h-6 rounded-full bg-surface-3 grid place-items-center text-[10px] text-ink-3">{platformLabel(p.channel?.platform ?? "").slice(0, 1)}</span>
                  )}
                  <span className="text-ink">{p.channel?.name ?? "?"}</span>
                  <span className="text-ink-3">{p.channel ? platformLabel(p.channel.platform) : ""}</span>
                  <span className="text-ink-3">{time(p.publishDate)}</span>
                  <span className="basis-full sm:basis-auto sm:flex-1 min-w-0 truncate text-ink-2" title={p.content}>
                    {p.content}
                  </span>
                  {p.state === "PUBLISHED" && p.releaseUrl && (
                    <a href={p.releaseUrl} target="_blank" rel="noreferrer noopener" className="text-accent underline truncate max-w-[16rem]">
                      {p.releaseUrl}
                    </a>
                  )}
                  {p.state === "ERROR" && (
                    <span className="text-danger" data-testid="postiz-post-error">
                      {p.error || t("postizStateError")}
                    </span>
                  )}
                  {p.state === "ERROR" && (
                    <button type="button" className={`${ghostBtn} !py-0.5`} disabled={busy} onClick={() => onRetry(p)} data-testid="postiz-post-retry">
                      {t("postizRetry")}
                    </button>
                  )}
                  <button type="button" className={`${dangerBtn} !py-0.5`} disabled={busy} onClick={() => onDelete(p)} data-testid="postiz-post-delete">
                    {t("postizDelete")}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
      {configured && (
        <Card title={t("postizNoticesTitle")} testId="postiz-posts-notices">
          <p className="text-xs text-ink-3">{t("postizNoticesHint")}</p>
          {notices.length === 0 ? (
            <p className="text-xs text-ink-3">{t("postizNoticesEmpty")}</p>
          ) : (
            <ul className="space-y-1.5">
              {notices.map((n) => (
                <li key={n.id} className={`text-xs border border-line rounded-lg px-3 py-2 ${n.read ? "text-ink-3" : "text-ink"}`} data-testid="postiz-notice">
                  <span className="text-ink-3 mr-2">{n.createdAt ? n.createdAt.slice(0, 16).replace("T", " ") : ""}</span>
                  {n.content}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
