import { composePost, emptyDraft, type ComposedPost, type PublishDraft } from "./caption";
import { offerPublishClip, publishClips, removePublishClip, setClipDuration, subscribePublishClips, type PublishClip } from "./clips";
import { PUBLISH_PLATFORMS, type PublishPlatform, type Visibility } from "./platforms";
import { RelayClient, RelayError, normalizeRelayUrl, xhrSendForm, type RelayAccount, type RelayInfo, type RelayJob, type RelayProfile } from "./relayClient";
import { quickShare as runQuickShare, shareText, type ShareEnv } from "./share";
import { addRecent, defaultPublishState, loadPublishState, newId, relayKey, savePublishState, youtubeKey, type PublishStoredState, type RecentSend, type StoredYouTubeAccount } from "./store";
import { readVideoInfo } from "./thumbnail";
import { YouTubeError, fetchMyChannel, gisOf, loadGoogleIdentity, requestYouTubeToken, uploadToYouTube, type FetchLike, type GisOauth2, type YouTubeToken } from "./youtube";

/*
 * --- social-publish --- The Publish block's state and actions, outside React (a module-level controller the block reads
 * with useSyncExternalStore): sends keep running and their progress stays when the Recording section closes. It ties the
 * clip inbox (clips.ts), the three delivery paths – YouTube straight from the browser (youtube.ts), the relay for TikTok,
 * Instagram and YouTube (relayClient.ts), the quick share (share.ts) – and what this browser remembers (store.ts).
 *
 * One click sends the selected clip to every ticked account: each direct YouTube account uploads on its own (resumable,
 * with progress), the relay accounts of the relay in use go up in one job (the clip is uploaded once, the relay posts it to
 * every account and reports per account). An expired YouTube sign-in shows "Sign in again", which asks Google in a popup
 * (a click, so the browser allows it) and carries on with that upload.
 */

export type SendStatus = "queued" | "uploading" | "processing" | "published" | "failed" | "needsAuth";

export interface SendItem {
  key: string;
  platform: PublishPlatform;
  via: "youtube" | "relay";
  label: string;
  status: SendStatus;
  progress: number;
  link: string | null;
  error: string | null;
  /** "yt.<YouTubeErrorCode>" / "relay.<RelayErrorCode>" when the page knows the error (the block translates it). */
  code: string | null;
  note: string | null;
}

export interface RelayView {
  profileId: string | null;
  status: "idle" | "loading" | "ok" | "error";
  accounts: RelayAccount[];
  info: RelayInfo | null;
  error: string | null;
  /** "relay.<RelayErrorCode>" of the error, when known. */
  errorCode: string | null;
}

export interface ShareNote {
  platform: PublishPlatform;
  kind: "shared" | "cancelled" | "failed" | "desktop";
  copied: boolean;
  opened: boolean;
  downloaded: boolean;
}

export interface PublishSnapshot {
  /** Loaded from storage (false on the server and before the block first mounts). */
  ready: boolean;
  stored: PublishStoredState;
  /** NEXT_PUBLIC_YOUTUBE_CLIENT_ID of the build ("" when unset). */
  envClientId: string;
  /** NEXT_PUBLIC_PUBLISH_RELAY_URL of the build: the relay URL the form suggests ("" when unset). */
  envRelayUrl: string;
  clips: readonly PublishClip[];
  clipId: string | null;
  thumbs: Record<string, string | null>;
  drafts: Record<string, PublishDraft>;
  relay: RelayView;
  youtube: { status: "idle" | "loading" | "connecting"; error: string | null; code: string | null };
  /** A relay sign-in in progress. */
  connecting: PublishPlatform | null;
  /** The sign-in page when the browser blocked its popup. */
  connectLink: string | null;
  sends: SendItem[];
  sending: boolean;
  share: ShareNote | null;
  /** The last "Test connection": the key's label, its accounts and the relay's platforms, or the error. */
  test: { profileId: string; ok: boolean; label: string; accounts: number; platforms: PublishPlatform[]; error: string | null } | null;
}

/** An account the block lists and can send to. */
export interface AccountView {
  key: string;
  platform: PublishPlatform;
  via: "youtube" | "relay";
  id: string;
  name: string;
  handle: string | null;
  avatar: string | null;
  /** A direct YouTube token that has expired, or a relay account the relay could not refresh. */
  expired: boolean;
  checked: boolean;
  note: string | null;
}

export interface ControllerDeps {
  fetch: () => FetchLike;
  window: () => (Window & typeof globalThis) | null;
  storage: () => Pick<Storage, "getItem" | "setItem"> | null;
  now: () => number;
  envClientId: string;
  envRelayUrl: string;
}

/** Tokens this close to expiring are renewed before an upload (ms). */
const TOKEN_MARGIN_MS = 60 * 1000;

export function accountViews(s: PublishSnapshot, now: number): AccountView[] {
  const checked = new Set(s.stored.checked);
  const out: AccountView[] = [];
  const profileId = s.relay.profileId;
  if (profileId) {
    for (const a of s.relay.accounts) {
      const key = relayKey(profileId, a.id);
      out.push({ key, platform: a.platform, via: "relay", id: a.id, name: a.name, handle: a.handle, avatar: a.avatar, expired: a.status === "expired", checked: checked.has(key), note: a.note });
    }
  }
  for (const a of s.stored.youtubeAccounts) {
    const key = youtubeKey(a.id);
    out.push({ key, platform: "youtube", via: "youtube", id: a.id, name: a.title, handle: a.handle, avatar: a.avatar, expired: a.expiresAt - now < TOKEN_MARGIN_MS, checked: checked.has(key), note: null });
  }
  return out;
}

/** What "Send to selected" would do: the ticked accounts, and the platforms whose words are over a limit. */
export function sendPlan(s: PublishSnapshot, now: number): { targets: AccountView[]; blocked: PublishPlatform[]; posts: Partial<Record<PublishPlatform, ComposedPost>>; instagramNeedsMp4: boolean } {
  const targets = accountViews(s, now).filter((a) => a.checked);
  const clip = s.clips.find((c) => c.id === s.clipId) ?? null;
  const draft = (clip && s.drafts[clip.id]) || emptyDraft();
  const posts: Partial<Record<PublishPlatform, ComposedPost>> = {};
  for (const p of PUBLISH_PLATFORMS) if (targets.some((t) => t.platform === p)) posts[p] = composePost(draft, p);
  const blocked = PUBLISH_PLATFORMS.filter((p) => posts[p] && !posts[p]!.ok);
  const instagramNeedsMp4 = !!clip && targets.some((t) => t.platform === "instagram") && !clip.type.includes("mp4");
  return { targets, blocked, posts, instagramNeedsMp4 };
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** The error's code for the block's translations ("yt.quota", "relay.unauthorized"), null for other errors. */
export function errorCode(err: unknown): string | null {
  if (err instanceof YouTubeError) return `yt.${err.code}`;
  if (err instanceof RelayError) return `relay.${err.code}`;
  return null;
}

export class PublishController {
  private snap: PublishSnapshot;
  private readonly serverSnap: PublishSnapshot;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private gis: GisOauth2 | null = null;
  /** What a "Sign in again" continues: the item's clip, post and visibility. */
  private readonly pendingAuth = new Map<string, { clip: PublishClip; post: ComposedPost; visibility: Visibility }>();
  private relayRefresh = 0;
  private connectCleanup: (() => void) | null = null;
  private focusCleanup: (() => void) | null = null;

  constructor(private readonly deps: ControllerDeps) {
    const initial: PublishSnapshot = {
      ready: false,
      stored: defaultPublishState(),
      envClientId: deps.envClientId,
      envRelayUrl: deps.envRelayUrl,
      clips: [],
      clipId: null,
      thumbs: {},
      drafts: {},
      relay: { profileId: null, status: "idle", accounts: [], info: null, error: null, errorCode: null },
      youtube: { status: "idle", error: null, code: null },
      connecting: null,
      connectLink: null,
      sends: [],
      sending: false,
      share: null,
      test: null,
    };
    this.snap = initial;
    this.serverSnap = initial;
  }

  /* ------------------------------------------------------------ store plumbing */

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = (): PublishSnapshot => this.snap;
  getServerSnapshot = (): PublishSnapshot => this.serverSnap;

  private set(patch: Partial<PublishSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private setStored(patch: Partial<PublishStoredState>): void {
    const stored = { ...this.snap.stored, ...patch };
    savePublishState(stored, this.deps.storage());
    this.set({ stored });
  }

  private patchItem(key: string, patch: Partial<SendItem>): void {
    this.set({ sends: this.snap.sends.map((i) => (i.key === key ? { ...i, ...patch } : i)) });
  }

  /** Loads what this browser remembers and starts following the clip inbox (once). */
  start(): void {
    if (this.started) return;
    this.started = true;
    const stored = loadPublishState(this.deps.storage());
    this.set({ ready: true, stored, relay: { ...this.snap.relay, profileId: stored.activeRelay } });
    this.syncClips();
    subscribePublishClips(() => this.syncClips());
    if (stored.activeRelay) void this.refreshRelay();
    if (this.clientId()) void this.prepareYouTube();
  }

  private syncClips(): void {
    const clips = publishClips();
    const newest = clips[0]?.id ?? null;
    const known = new Set(this.snap.clips.map((c) => c.id));
    // A new clip becomes the one to send.
    const clipId = newest && !known.has(newest) ? newest : clips.some((c) => c.id === this.snap.clipId) ? this.snap.clipId : newest;
    // Thumbnails of clips no longer listed are dropped; only the clip on show gets one (a batch of 50 clips decodes one).
    const listed = new Set(clips.map((c) => c.id));
    const thumbs = Object.fromEntries(Object.entries(this.snap.thumbs).filter(([id]) => listed.has(id)));
    this.set({ clips, clipId, thumbs });
    this.ensureThumb();
  }

  /** Reads the thumbnail and length of the clip on show, once. */
  private ensureThumb(): void {
    const clip = this.snap.clips.find((c) => c.id === this.snap.clipId);
    if (clip && !(clip.id in this.snap.thumbs)) void this.loadThumb(clip);
  }

  private async loadThumb(clip: PublishClip): Promise<void> {
    this.set({ thumbs: { ...this.snap.thumbs, [clip.id]: null } });
    const win = this.deps.window();
    if (!win) return;
    const info = await readVideoInfo(clip.blob, win.document);
    if (!this.snap.clips.some((c) => c.id === clip.id)) return; // removed meanwhile
    this.set({ thumbs: { ...this.snap.thumbs, [clip.id]: info.thumb } });
    if (info.durationSec) setClipDuration(clip.id, info.durationSec);
  }

  /* ------------------------------------------------------------ clip and words */

  selectClip(id: string): void {
    if (!this.snap.clips.some((c) => c.id === id)) return;
    this.set({ clipId: id });
    this.ensureThumb();
  }

  /** A video file picked from the disk joins the clips. */
  addFile(file: File): void {
    offerPublishClip({ blob: file, name: file.name, source: "file" });
  }

  removeClip(id: string): void {
    removePublishClip(id);
  }

  /** Sets a clip's first draft unless it has one. */
  ensureDraft(clipId: string, make: () => PublishDraft): void {
    if (this.snap.drafts[clipId]) return;
    this.set({ drafts: { ...this.snap.drafts, [clipId]: make() } });
  }

  setDraft(clipId: string, draft: PublishDraft): void {
    this.set({ drafts: { ...this.snap.drafts, [clipId]: draft } });
  }

  setVisibility(visibility: Visibility): void {
    this.setStored({ visibility });
  }

  toggleAccount(key: string, on: boolean): void {
    const checked = this.snap.stored.checked.filter((k) => k !== key);
    if (on) checked.push(key);
    this.setStored({ checked });
  }

  clearRecent(): void {
    this.setStored({ recent: [] });
  }

  private addRecentEntry(entry: Omit<RecentSend, "id" | "at">): void {
    this.setStored({ recent: addRecent(this.snap.stored.recent, { ...entry, id: newId("s"), at: this.deps.now() }) });
  }

  /* ------------------------------------------------------------ YouTube, direct */

  clientId(): string {
    return (this.snap.stored.youtubeClientId || this.snap.envClientId).trim();
  }

  setClientId(id: string): void {
    this.setStored({ youtubeClientId: id.trim() });
    if (id.trim()) void this.prepareYouTube();
  }

  /** Loads Google's sign-in script ahead of the click, so the click can open its popup at once. */
  async prepareYouTube(): Promise<void> {
    const win = this.deps.window();
    if (!win || this.gis) return;
    this.gis = gisOf(win);
    if (this.gis) return;
    try {
      this.gis = await loadGoogleIdentity(win, win.document);
    } catch {
      /* the click tries again and reports it */
    }
  }

  private async token(prompt: string): Promise<YouTubeToken> {
    const win = this.deps.window();
    if (!win) throw new YouTubeError("config", "No browser window.");
    const clientId = this.clientId();
    if (!clientId) throw new YouTubeError("config", "Set up a Google OAuth client ID first (App setup).");
    let gis = this.gis ?? gisOf(win);
    if (!gis) {
      this.set({ youtube: { status: "loading", error: null, code: null } });
      gis = await loadGoogleIdentity(win, win.document);
    }
    this.gis = gis;
    this.set({ youtube: { status: "connecting", error: null, code: null } });
    return requestYouTubeToken(gis, clientId, { prompt, now: this.deps.now });
  }

  private upsertYouTube(account: StoredYouTubeAccount): void {
    const accounts = this.snap.stored.youtubeAccounts.filter((a) => a.id !== account.id);
    const key = youtubeKey(account.id);
    const checked = this.snap.stored.checked.includes(key) ? this.snap.stored.checked : [...this.snap.stored.checked, key];
    this.setStored({ youtubeAccounts: [...accounts, account], checked });
  }

  private async channelFor(token: YouTubeToken): Promise<Omit<StoredYouTubeAccount, "accessToken" | "expiresAt" | "addedAt">> {
    try {
      const ch = await fetchMyChannel(this.deps.fetch(), token.accessToken);
      return { id: ch.id, title: ch.title, handle: ch.handle, avatar: ch.avatar };
    } catch (err) {
      if (err instanceof YouTubeError && err.code === "noChannel") throw err;
      // No read permission or no answer: keep the account under a name of its own.
      return { id: `google-${token.accessToken.slice(-10).replace(/[^\w-]/g, "")}`, title: "YouTube", handle: null, avatar: null };
    }
  }

  /** "Connect YouTube": a Google account picker in a popup, then the channel's name and avatar. Call it from a click. */
  async connectYouTube(): Promise<void> {
    try {
      const token = await this.token("select_account");
      const ch = await this.channelFor(token);
      const old = this.snap.stored.youtubeAccounts.find((a) => a.id === ch.id);
      this.upsertYouTube({ ...ch, accessToken: token.accessToken, expiresAt: token.expiresAt, addedAt: old?.addedAt ?? this.deps.now() });
      this.set({ youtube: { status: "idle", error: null, code: null } });
    } catch (err) {
      this.set({ youtube: { status: "idle", error: err instanceof YouTubeError && err.code === "cancelled" ? null : message(err), code: errorCode(err) } });
    }
  }

  removeYouTube(id: string): void {
    const account = this.snap.stored.youtubeAccounts.find((a) => a.id === id);
    const win = this.deps.window();
    if (account?.accessToken && win) {
      try {
        gisOf(win)?.revoke?.(account.accessToken);
      } catch {
        /* best effort */
      }
    }
    this.setStored({ youtubeAccounts: this.snap.stored.youtubeAccounts.filter((a) => a.id !== id), checked: this.snap.stored.checked.filter((k) => k !== youtubeKey(id)) });
  }

  /** "Sign in again" for an account (a click): renews its token and carries on with an upload that waited for it. */
  async reauthYouTube(key: string): Promise<void> {
    const account = this.snap.stored.youtubeAccounts.find((a) => youtubeKey(a.id) === key);
    try {
      const token = await this.token(account ? "" : "select_account");
      const ch = await this.channelFor(token);
      this.upsertYouTube({ ...ch, accessToken: token.accessToken, expiresAt: token.expiresAt, addedAt: account?.addedAt ?? this.deps.now() });
      this.set({ youtube: { status: "idle", error: null, code: null } });
      const pending = this.pendingAuth.get(key);
      if (!pending) return;
      this.pendingAuth.delete(key);
      if (account && ch.id !== account.id) {
        this.patchItem(key, { status: "failed", error: `Signed in as another channel (${ch.title}) – it was added to the list; tick it and send again.` });
        return;
      }
      this.set({ sending: true });
      await this.runYouTube(key, pending.clip, pending.post, pending.visibility);
      this.finishSend();
    } catch (err) {
      this.set({ youtube: { status: "idle", error: err instanceof YouTubeError && err.code === "cancelled" ? null : message(err), code: errorCode(err) } });
    }
  }

  private async runYouTube(key: string, clip: PublishClip, post: ComposedPost, visibility: Visibility): Promise<void> {
    const account = this.snap.stored.youtubeAccounts.find((a) => youtubeKey(a.id) === key);
    if (!account) {
      this.patchItem(key, { status: "failed", error: "This YouTube account is no longer connected." });
      return;
    }
    if (account.expiresAt - this.deps.now() < TOKEN_MARGIN_MS) {
      this.pendingAuth.set(key, { clip, post, visibility });
      this.patchItem(key, { status: "needsAuth", error: null, note: null });
      return;
    }
    this.patchItem(key, { status: "uploading", progress: 0, error: null, code: null, link: null });
    try {
      const file = new File([clip.blob], clip.name, { type: clip.type });
      const video = await uploadToYouTube(this.deps.fetch(), account.accessToken, file, { title: post.title, description: post.text, tags: post.tags, privacy: visibility }, { onProgress: (p) => this.patchItem(key, { progress: p.total ? p.sent / p.total : 1 }) });
      this.patchItem(key, { status: "published", progress: 1, link: video.url, note: visibility === "public" ? null : visibility });
    } catch (err) {
      if (err instanceof YouTubeError && err.code === "auth") {
        this.pendingAuth.set(key, { clip, post, visibility });
        this.patchItem(key, { status: "needsAuth", error: null });
        return;
      }
      this.patchItem(key, { status: "failed", error: message(err), code: errorCode(err) });
    }
    this.logItem(key, clip);
  }

  /* ------------------------------------------------------------ the relay */

  private activeProfile(): RelayProfile | null {
    const s = this.snap.stored;
    return s.relayProfiles.find((p) => p.id === (this.snap.relay.profileId ?? s.activeRelay)) ?? null;
  }

  private client(profile: Pick<RelayProfile, "url" | "key">): RelayClient {
    const win = this.deps.window();
    const XHR = win && "XMLHttpRequest" in win ? win.XMLHttpRequest : null;
    return new RelayClient(profile, { fetch: this.deps.fetch(), sendForm: XHR ? xhrSendForm(XHR) : undefined });
  }

  /** Adds or updates a relay profile (and makes it the one in use); returns an error message, or null. */
  saveProfile(input: { id?: string; url: string; key: string; label: string }): string | null {
    const url = normalizeRelayUrl(input.url);
    if (!url) return "url";
    if (!input.key.trim()) return "key";
    const id = input.id ?? newId("p");
    const profile: RelayProfile = { id, url, key: input.key.trim(), label: input.label.trim() || new URL(url).host };
    const profiles = this.snap.stored.relayProfiles.filter((p) => p.id !== id);
    this.setStored({ relayProfiles: [...profiles, profile], activeRelay: id });
    this.set({ relay: { profileId: id, status: "idle", accounts: [], info: null, error: null, errorCode: null }, test: null });
    void this.refreshRelay();
    return null;
  }

  removeProfile(id: string): void {
    const profiles = this.snap.stored.relayProfiles.filter((p) => p.id !== id);
    const activeRelay = this.snap.stored.activeRelay === id ? (profiles[0]?.id ?? null) : this.snap.stored.activeRelay;
    this.setStored({ relayProfiles: profiles, activeRelay, checked: this.snap.stored.checked.filter((k) => !k.startsWith(`relay:${id}:`)) });
    this.set({ relay: { profileId: activeRelay, status: "idle", accounts: [], info: null, error: null, errorCode: null }, test: null });
    if (activeRelay) void this.refreshRelay();
  }

  selectProfile(id: string): void {
    if (!this.snap.stored.relayProfiles.some((p) => p.id === id)) return;
    this.setStored({ activeRelay: id });
    this.set({ relay: { profileId: id, status: "idle", accounts: [], info: null, error: null, errorCode: null }, test: null });
    void this.refreshRelay();
  }

  /** Reloads the accounts (and the relay's platforms) of the relay in use. */
  async refreshRelay(): Promise<void> {
    const profile = this.activeProfile();
    if (!profile) return;
    const serial = ++this.relayRefresh;
    this.set({ relay: { ...this.snap.relay, profileId: profile.id, status: "loading", error: null, errorCode: null } });
    try {
      const client = this.client(profile);
      const [info, accounts] = await Promise.all([client.info(), client.accounts()]);
      if (serial !== this.relayRefresh) return;
      this.set({ relay: { profileId: profile.id, status: "ok", accounts, info, error: null, errorCode: null } });
    } catch (err) {
      if (serial !== this.relayRefresh) return;
      this.set({ relay: { profileId: profile.id, status: "error", accounts: [], info: null, error: message(err), errorCode: errorCode(err) } });
    }
  }

  /** "Test connection": the key's label and the platforms the relay has apps for. */
  async testProfile(id: string): Promise<void> {
    const profile = this.snap.stored.relayProfiles.find((p) => p.id === id);
    if (!profile) return;
    try {
      const client = this.client(profile);
      const info = await client.info();
      const accounts = await client.accounts();
      this.set({ test: { profileId: id, ok: true, label: info.key?.label ?? "", accounts: accounts.length, platforms: PUBLISH_PLATFORMS.filter((p) => info.platforms[p]), error: null } });
    } catch (err) {
      this.set({ test: { profileId: id, ok: false, label: "", accounts: 0, platforms: [], error: message(err) } });
    }
  }

  /**
   * "Connect TikTok / Instagram / YouTube (relay)": opens a popup at once (in the click), asks the relay for a one-time
   * sign-in link and sends the popup there; the relay's callback page reports back (postMessage) and closes, and the
   * accounts reload. A blocked popup leaves the link to click.
   */
  connectRelay(platform: PublishPlatform): void {
    const profile = this.activeProfile();
    const win = this.deps.window();
    if (!profile || !win) return;
    this.connectCleanup?.();
    let popup: Window | null = null;
    try {
      popup = win.open("about:blank", "jbl-relay-connect", "popup,width=520,height=760");
    } catch {
      popup = null;
    }
    this.set({ connecting: platform, connectLink: null, relay: { ...this.snap.relay, error: null, errorCode: null } });
    const relayOrigin = new URL(profile.url).origin;
    let done = false;
    const finish = (error: string | null, code: string | null = null) => {
      if (done) return;
      done = true;
      cleanup();
      this.set({ connecting: null, connectLink: error ? this.snap.connectLink : null, relay: { ...this.snap.relay, error, errorCode: code } });
      // A failed sign-in added nothing (and a reload would wipe its message).
      if (!error) void this.refreshRelay();
    };
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== relayOrigin || !e.data || typeof e.data !== "object" || (e.data as { source?: unknown }).source !== "jumpingballslive-relay") return;
      const data = e.data as { type?: string; message?: string; accounts?: unknown };
      // The accounts a sign-in just added are ticked, like a newly connected YouTube channel.
      if (data.type === "connected" && Array.isArray(data.accounts)) {
        const added = data.accounts.map((a) => (a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string" ? relayKey(profile.id, (a as { id: string }).id) : null)).filter((k): k is string => !!k && !this.snap.stored.checked.includes(k));
        if (added.length) this.setStored({ checked: [...this.snap.stored.checked, ...added] });
      }
      finish(data.type === "error" ? data.message || "The sign-in failed." : null);
    };
    const poll = win.setInterval(() => {
      if (popup && popup.closed) finish(null);
    }, 700);
    const timeout = win.setTimeout(() => finish(null), 10 * 60 * 1000);
    const cleanup = () => {
      win.removeEventListener("message", onMessage);
      win.clearInterval(poll);
      win.clearTimeout(timeout);
      this.connectCleanup = null;
    };
    this.connectCleanup = cleanup;
    win.addEventListener("message", onMessage);
    // A sign-in page with a Cross-Origin-Opener-Policy cuts the popup off from this page: the callback's postMessage then
    // never arrives and the popup reads as closed at once. So the accounts also reload whenever this page gets the focus
    // back in the next ten minutes (the user finished, or gave up on, the sign-in in the other window).
    this.focusCleanup?.();
    let lastFocus = 0;
    const onFocus = () => {
      if (this.deps.now() - lastFocus < 1500) return;
      lastFocus = this.deps.now();
      void this.refreshRelay();
    };
    const focusTimer = win.setTimeout(() => this.focusCleanup?.(), 10 * 60 * 1000);
    this.focusCleanup = () => {
      win.removeEventListener("focus", onFocus);
      win.clearTimeout(focusTimer);
      this.focusCleanup = null;
    };
    win.addEventListener("focus", onFocus);
    this.client(profile)
      .connectLink(platform, win.location.origin)
      .then((url) => {
        if (popup && !popup.closed) popup.location.href = url;
        else {
          const tab = win.open(url, "jbl-relay-connect");
          if (!tab) this.set({ connectLink: url });
          else popup = tab;
        }
      })
      .catch((err) => {
        try {
          popup?.close();
        } catch {
          /* ignore */
        }
        finish(message(err), errorCode(err));
      });
  }

  /** Stops waiting for a relay sign-in. */
  cancelConnect(): void {
    this.connectCleanup?.();
    this.set({ connecting: null, connectLink: null });
  }

  async removeRelayAccount(id: string): Promise<void> {
    const profile = this.activeProfile();
    if (!profile) return;
    try {
      await this.client(profile).removeAccount(id);
      this.setStored({ checked: this.snap.stored.checked.filter((k) => k !== relayKey(profile.id, id)) });
    } catch (err) {
      // Gone already: the reload shows it. Anything else keeps its message (a reload would wipe it).
      if (!(err instanceof RelayError && err.code === "notFound")) {
        this.set({ relay: { ...this.snap.relay, error: message(err), errorCode: errorCode(err) } });
        return;
      }
    }
    await this.refreshRelay();
  }

  private async runRelay(profile: RelayProfile, keys: string[], clip: PublishClip, posts: Partial<Record<PublishPlatform, ComposedPost>>, visibility: Visibility): Promise<void> {
    const prefix = `relay:${profile.id}:`;
    const ids = keys.map((k) => k.slice(prefix.length));
    for (const k of keys) this.patchItem(k, { status: "uploading", progress: 0, error: null, code: null, link: null, note: null });
    try {
      const client = this.client(profile);
      const composed: Partial<Record<PublishPlatform, { title: string; text: string; hashtags: string[]; tags: string[] }>> = {};
      for (const p of PUBLISH_PLATFORMS) if (posts[p]) composed[p] = { title: posts[p]!.title, text: posts[p]!.text, hashtags: posts[p]!.hashtags, tags: posts[p]!.tags };
      const file = new File([clip.blob], clip.name, { type: clip.type });
      const { jobId, job } = await client.publish({ file, fileName: clip.name, accounts: ids, posts: composed, visibility, durationSec: clip.durationSec }, (sent, total) => {
        const progress = total ? sent / total : 0;
        for (const k of keys) this.patchItem(k, { progress });
      });
      const apply = (j: RelayJob) => {
        for (const it of j.items) {
          const key = `${prefix}${it.accountId}`;
          this.patchItem(key, { status: it.status, progress: it.status === "published" ? 1 : it.progress, link: it.link, error: it.error, code: null, note: it.note });
        }
      };
      if (job) apply(job);
      const final = await client.waitForJob(jobId, { onUpdate: apply });
      apply(final);
    } catch (err) {
      for (const k of keys) {
        const item = this.snap.sends.find((i) => i.key === k);
        if (item?.status !== "published") this.patchItem(k, { status: "failed", error: message(err), code: errorCode(err) });
      }
    }
    for (const k of keys) this.logItem(k, clip);
  }

  /* ------------------------------------------------------------ send */

  /** "Send to selected": the clip to every ticked account at once. */
  async sendSelected(): Promise<void> {
    if (this.snap.sending) return;
    const s = this.snap;
    const clip = s.clips.find((c) => c.id === s.clipId);
    if (!clip) return;
    const plan = sendPlan(s, this.deps.now());
    const targets = plan.targets.filter((t) => !plan.blocked.includes(t.platform));
    if (targets.length === 0) return;
    const visibility = s.stored.visibility;
    this.set({
      sending: true,
      sends: targets.map((t) => ({ key: t.key, platform: t.platform, via: t.via, label: t.handle ? `${t.name} (${t.handle})` : t.name, status: "queued" as SendStatus, progress: 0, link: null, error: null, code: null, note: null })),
    });
    const jobs: Promise<void>[] = [];
    for (const t of targets.filter((x) => x.via === "youtube")) jobs.push(this.runYouTube(t.key, clip, plan.posts.youtube!, visibility));
    const profile = this.activeProfile();
    const relayKeys = targets.filter((x) => x.via === "relay").map((x) => x.key);
    if (profile && relayKeys.length) jobs.push(this.runRelay(profile, relayKeys, clip, plan.posts, visibility));
    await Promise.all(jobs);
    this.finishSend();
  }

  /** An item that published or failed goes into the recent sends. */
  private logItem(key: string, clip: PublishClip): void {
    const i = this.snap.sends.find((x) => x.key === key);
    if (!i || (i.status !== "published" && i.status !== "failed")) return;
    this.addRecentEntry({ clip: clip.name, platform: i.platform, account: i.label, via: i.via, status: i.status, link: i.link, error: i.error });
  }

  /** The send is over once no account is still on its way (one waiting for "Sign in again" is not). */
  private finishSend(): void {
    this.set({ sending: this.snap.sends.some((i) => i.status === "uploading" || i.status === "processing" || i.status === "queued") });
  }

  /** Sends one failed account again. */
  async retry(key: string): Promise<void> {
    const item = this.snap.sends.find((i) => i.key === key);
    const clip = this.snap.clips.find((c) => c.id === this.snap.clipId);
    if (!item || !clip || item.status !== "failed") return;
    const plan = sendPlan({ ...this.snap, stored: { ...this.snap.stored, checked: [key] } }, this.deps.now());
    const post = plan.posts[item.platform];
    if (!post || !post.ok) return;
    this.set({ sending: true });
    if (item.via === "youtube") await this.runYouTube(key, clip, post, this.snap.stored.visibility);
    else {
      const profile = this.activeProfile();
      if (profile && key.startsWith(`relay:${profile.id}:`)) await this.runRelay(profile, [key], clip, plan.posts, this.snap.stored.visibility);
      else this.patchItem(key, { status: "failed", error: "This account belongs to another relay profile." });
    }
    this.finishSend();
  }

  /* ------------------------------------------------------------ quick share */

  /** "Send to TikTok / Instagram / YouTube" without an account: share sheet or download + clipboard + upload page. Call it from a click. */
  async quickShare(platform: PublishPlatform, env?: ShareEnv): Promise<void> {
    const clip = this.snap.clips.find((c) => c.id === this.snap.clipId);
    const win = this.deps.window();
    if (!clip || !win) return;
    const post = composePost(this.snap.drafts[clip.id] ?? emptyDraft(), platform);
    const file = new File([clip.blob], clip.name, { type: clip.type });
    const result = await runQuickShare({ platform, file, text: shareText(platform, post), title: post.title, env: env ?? { navigator: win.navigator, document: win.document, open: (url, target) => win.open(url, target) } });
    if (result.method === "share") {
      this.set({ share: { platform, kind: result.outcome, copied: result.copied, opened: false, downloaded: false } });
      if (result.outcome === "shared") this.addRecentEntry({ clip: clip.name, platform, account: "", via: "share", status: "shared", link: null, error: null });
    } else {
      this.set({ share: { platform, kind: "desktop", copied: result.copied, opened: result.opened, downloaded: result.downloaded } });
      this.addRecentEntry({ clip: clip.name, platform, account: "", via: "share", status: "opened", link: result.url, error: null });
    }
  }

  dismissShare(): void {
    this.set({ share: null });
  }
}

let controller: PublishController | null = null;

/** The page's controller (one per tab). */
export function getPublishController(): PublishController {
  if (!controller) {
    controller = new PublishController({
      fetch: () => (url, init) => fetch(url, init),
      window: () => (typeof window !== "undefined" ? window : null),
      storage: () => {
        try {
          return typeof localStorage !== "undefined" ? localStorage : null;
        } catch {
          return null;
        }
      },
      now: () => Date.now(),
      envClientId: process.env.NEXT_PUBLIC_YOUTUBE_CLIENT_ID ?? "",
      envRelayUrl: process.env.NEXT_PUBLIC_PUBLISH_RELAY_URL ?? "",
    });
  }
  return controller;
}
