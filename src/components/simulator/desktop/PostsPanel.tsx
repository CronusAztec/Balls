"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import type { DesktopApi, LibraryItem, PostizNotice, SocialAuditEntry, SocialPostOutcome } from "@/lib/desktop/contract";
import type { CardPrefill } from "./PostizPostCard";
import { platformLabel } from "./AccountsPanel";
import { Card, dangerBtn, errorText, ghostBtn } from "./ui";

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

export default function PostsPanel({ bridge, onRetry, onAccounts }: { bridge: DesktopApi; onRetry: (item: LibraryItem, prefill: CardPrefill) => void; onAccounts: () => void }) {
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

  return <PostsView state={state} onRefresh={() => void load()} onRetry={(p) => void retry(p)} onDelete={(p) => void remove(p)} onAccounts={onAccounts} />;
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
