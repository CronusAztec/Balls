"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { POSTIZ_DEFAULT_URL, type PostizChannel, type PostizConnection, type PostizKeyInput, type PostizKeyStatus, type PostizNotice } from "@/lib/desktop/contract";
import { EntitlementRequiredError, requireEntitlement, type EntitlementDecision, type EntitlementRefusal } from "@/lib/billing/guard";
import { requestUnlock } from "@/lib/billing/unlock";
import type { SocialBridge } from "@/lib/desktop/capabilities"; // --- old-bridge --- (the section shows this tab only with an app that has Postiz)
import { Card, dangerBtn, errorText, ghostBtn, inputClass, primaryBtn } from "./ui";

/*
 * --- social-postiz --- The Accounts tab (phase 1 of docs/SOCIAL-AUTOPILOT.md): the user pastes their Postiz address and API
 * key, the app checks the key with Postiz and keeps it sealed on this PC, and the tab lists the channels connected inside
 * Postiz (picture, name, platform, a "disabled" badge) and Postiz's own notices. The key field is never filled back in: the
 * bridge only ever says whether a key is stored. Saving a key is Pro (`publish`): the guard first, the Unlock dialog on a
 * refusal, like the Library's Publish targets.
 */

/** Postiz's provider identifiers as the platforms call themselves (the same in every language; an unknown one shows as it is). */
export const POSTIZ_PLATFORM_NAMES: Readonly<Record<string, string>> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  "instagram-standalone": "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  threads: "Threads",
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  linkedin: "LinkedIn",
  "linkedin-page": "LinkedIn",
  pinterest: "Pinterest",
  reddit: "Reddit",
  discord: "Discord",
  slack: "Slack",
  telegram: "Telegram",
  lemmy: "Lemmy",
  dribbble: "Dribbble",
  nostr: "Nostr",
  vk: "VK",
  warpcast: "Warpcast",
  medium: "Medium",
  hashnode: "Hashnode",
  devto: "Dev.to",
};

export function platformLabel(platform: string): string {
  return POSTIZ_PLATFORM_NAMES[platform] ?? platform;
}

export interface SaveKeyDeps {
  require?: (feature: "publish") => Promise<EntitlementDecision>;
  unlock?: (refusal: EntitlementRefusal) => void;
}

/**
 * Saves a key through the bridge – after the Pro guard: a refusal opens the Unlock dialog and throws, and nothing reaches the
 * main process (the tests hand in their own guard and dialog).
 */
export async function savePostizKey(bridge: Pick<SocialBridge, "social">, input: PostizKeyInput, deps: SaveKeyDeps = {}): Promise<PostizConnection> {
  const decision = await (deps.require ?? requireEntitlement)("publish");
  if (!decision.ok) {
    (deps.unlock ?? requestUnlock)(decision);
    throw new EntitlementRequiredError(decision);
  }
  return bridge.social.key.set(input);
}

/** What the tab shows, apart from the two fields: the stored key's status and what Postiz answered. */
export interface AccountsViewState {
  status: PostizKeyStatus | null;
  channels: PostizChannel[];
  notices: PostizNotice[];
  /** The last failure (a refused key, Postiz unreachable), shown in red. */
  error: string | null;
  /** A confirmation ("Connected to …", "The key was removed"). */
  message: string | null;
  busy: boolean;
}

export default function AccountsPanel({ bridge }: { bridge: SocialBridge }) {
  const t = useTranslations("Desktop");
  const [state, setState] = useState<AccountsViewState>({ status: null, channels: [], notices: [], error: null, message: null, busy: false });
  const patch = useCallback((p: Partial<AccountsViewState>) => setState((s) => ({ ...s, ...p })), []);

  const load = useCallback(
    async (refresh: boolean) => {
      try {
        const status = await bridge.social.key.status();
        if (!status.configured) {
          patch({ status, channels: [], notices: [] });
          return;
        }
        const [channels, notices] = await Promise.all([bridge.social.channels.list(refresh), bridge.social.notices.list(0)]);
        patch({ status, channels, notices, error: null });
      } catch (err) {
        patch({ error: errorText(err) });
      }
    },
    [bridge, patch],
  );
  useEffect(() => void load(false), [load]);

  const save = async (input: PostizKeyInput) => {
    patch({ busy: true, error: null, message: null });
    try {
      const connection = await savePostizKey(bridge, input);
      patch({ message: t("postizConnected", { organization: connection.organization.name, count: connection.channels.length }), channels: connection.channels });
      await load(false);
      return true;
    } catch (err) {
      // the Unlock dialog is open: the status line says why nothing was saved
      patch({ error: err instanceof EntitlementRequiredError ? t("postizProOnly") : errorText(err) });
      return false;
    } finally {
      patch({ busy: false });
    }
  };
  const forget = async () => {
    patch({ busy: true, error: null, message: null });
    try {
      const status = await bridge.social.key.forget();
      patch({ status, channels: [], notices: [], message: t("postizForgotten") });
    } catch (err) {
      patch({ error: errorText(err) });
    } finally {
      patch({ busy: false });
    }
  };

  return <AccountsView state={state} onSave={save} onForget={() => void forget()} onRefresh={() => void load(true)} />;
}

/** The tab as a function of its state (the tests render it with every state; the panel above feeds it from the bridge). */
export function AccountsView({ state, onSave, onForget, onRefresh }: { state: AccountsViewState; onSave: (input: PostizKeyInput) => Promise<boolean>; onForget: () => void; onRefresh: () => void }) {
  const t = useTranslations("Desktop");
  const { status, channels, notices, error, message, busy } = state;
  const configured = status?.configured === true;
  // the address field shows the stored address until the user types (the key field is never filled in)
  const [urlEdit, setUrlEdit] = useState<string | null>(null);
  const url = urlEdit ?? status?.baseUrl ?? POSTIZ_DEFAULT_URL;
  const [key, setKey] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    void onSave({ baseUrl: url.trim(), apiKey: key }).then((ok) => {
      if (ok) setKey("");
    });
  };

  return (
    <div className="space-y-4" data-testid="desktop-accounts">
      <Card
        title={t("postizTitle")}
        testId="postiz-card"
        actions={
          configured ? (
            <button type="button" className={dangerBtn} onClick={onForget} disabled={busy} data-testid="postiz-forget">
              {t("postizForget")}
            </button>
          ) : undefined
        }
      >
        <p className="text-xs text-ink-2">{t("postizIntro")}</p>
        <p className="text-xs text-ink-3">{t("postizWhereKey")}</p>
        <div className="text-xs" data-testid="postiz-status" data-postiz-configured={configured ? "1" : "0"} role="status">
          {status === null ? (
            <span className="text-ink-3">…</span>
          ) : !status.encryption ? (
            <span className="text-danger">{t("postizNoEncryption")}</span>
          ) : configured ? (
            <span className="text-accent">{t("postizStatusOn", { baseUrl: status.baseUrl })}</span>
          ) : (
            <span className="text-ink-2">{t("postizStatusNone")}</span>
          )}
        </div>
        <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] items-end" onSubmit={submit}>
          <label className="text-xs text-ink-2 flex flex-col gap-1">
            {t("postizUrl")}
            <input
              className={inputClass}
              type="url"
              value={url}
              onChange={(e) => setUrlEdit(e.target.value)}
              placeholder={POSTIZ_DEFAULT_URL}
              maxLength={500}
              spellCheck={false}
              data-testid="postiz-url"
            />
          </label>
          <label className="text-xs text-ink-2 flex flex-col gap-1">
            {t("postizKey")}
            <input className={inputClass} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={configured ? t("postizKeyReplace") : t("postizKeyPlaceholder")} maxLength={500} autoComplete="off" spellCheck={false} data-testid="postiz-key" />
          </label>
          <button type="submit" className={primaryBtn} disabled={busy || key.trim().length === 0 || url.trim().length === 0} data-testid="postiz-save">
            {busy ? t("postizSaving") : t("postizSave")}
          </button>
        </form>
        <p className="text-xs text-ink-3">{t("postizUrlHint")}</p>
        {message && (
          <p className="text-xs text-accent" data-testid="postiz-message">
            {message}
          </p>
        )}
        {error && (
          <p className="text-xs text-danger" data-testid="postiz-error" role="alert">
            {error}
          </p>
        )}
      </Card>

      {configured && (
        <Card
          title={t("postizChannelsTitle", { count: channels.length })}
          testId="postiz-channels"
          actions={
            <button type="button" className={ghostBtn} onClick={onRefresh} disabled={busy} data-testid="postiz-refresh">
              {t("postizRefresh")}
            </button>
          }
        >
          {channels.length === 0 ? (
            <p className="text-xs text-ink-3">{t("postizChannelsEmpty")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {channels.map((c) => (
                <li key={c.id} className="flex items-center gap-3 bg-surface-2/60 border border-line rounded-lg px-3 py-2" data-testid="postiz-channel" data-platform={c.platform} data-disabled={c.disabled ? "1" : "0"}>
                  {c.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a picture Postiz hosts, not a site asset
                    <img src={c.picture} alt="" width={32} height={32} className="w-8 h-8 rounded-full object-cover bg-surface-3" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-surface-3 grid place-items-center text-xs text-ink-3">{platformLabel(c.platform).slice(0, 1)}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-ink truncate">{c.name}</div>
                    <div className="text-xs text-ink-3 truncate">
                      {platformLabel(c.platform)}
                      {c.customer?.name ? ` · ${c.customer.name}` : ""}
                    </div>
                  </div>
                  {c.disabled && <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-danger/20 text-danger border border-danger/40">{t("postizDisabled")}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {configured && (
        <Card title={t("postizNoticesTitle")} testId="postiz-notices">
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
