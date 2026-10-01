import { isPublishPlatform, isVisibility, type PublishPlatform, type Visibility } from "./platforms";
import { normalizeRelayUrl, type RelayProfile } from "./relayClient";

/*
 * --- social-publish --- What the Publish block remembers in this browser (localStorage, one key): the YouTube OAuth client
 * ID of the App setup panel, the YouTube accounts connected directly (channel, avatar and the access token – browser apps
 * get no refresh token, and nothing leaves this browser), the relay profiles (URL, access key, label) and the one in use,
 * the visibility, which accounts are ticked and the last 50 sends. Every read and write is wrapped: the block works (for
 * the session) without storage. Never mirrored into the URL, presets or project files – keys and tokens stay here.
 */

export const PUBLISH_STORAGE_KEY = "jumpingballslive_publish";
export const PUBLISH_STATE_VERSION = 1;
export const RECENT_MAX = 50;

export interface StoredYouTubeAccount {
  /** The channel id. */
  id: string;
  title: string;
  handle: string | null;
  avatar: string | null;
  accessToken: string;
  /** Epoch ms. */
  expiresAt: number;
  addedAt: number;
}

export type RecentStatus = "published" | "failed" | "shared" | "opened";

export interface RecentSend {
  id: string;
  at: number;
  clip: string;
  platform: PublishPlatform;
  account: string;
  via: "youtube" | "relay" | "share";
  status: RecentStatus;
  link: string | null;
  error: string | null;
}

export interface PublishStoredState {
  version: number;
  youtubeClientId: string;
  youtubeAccounts: StoredYouTubeAccount[];
  relayProfiles: RelayProfile[];
  activeRelay: string | null;
  visibility: Visibility;
  /** Ticked account keys ("yt:<channel>", "relay:<profile>:<account>"). */
  checked: string[];
  recent: RecentSend[];
}

export function defaultPublishState(): PublishStoredState {
  return { version: PUBLISH_STATE_VERSION, youtubeClientId: "", youtubeAccounts: [], relayProfiles: [], activeRelay: null, visibility: "public", checked: [], recent: [] };
}

const str = (v: unknown, max = 4000): string | null => (typeof v === "string" ? v.slice(0, max) : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function parseYouTubeAccount(raw: unknown): StoredYouTubeAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 200);
  const accessToken = str(r.accessToken);
  if (!id || accessToken === null) return null;
  return { id, title: str(r.title, 200) || "YouTube", handle: str(r.handle, 200), avatar: str(r.avatar, 2000), accessToken, expiresAt: num(r.expiresAt) ?? 0, addedAt: num(r.addedAt) ?? 0 };
}

function parseProfile(raw: unknown): RelayProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 100);
  const url = normalizeRelayUrl(str(r.url, 2000) ?? "");
  if (!id || !url) return null;
  return { id, url, key: str(r.key, 500) ?? "", label: str(r.label, 100) ?? "" };
}

function parseRecent(raw: unknown): RecentSend | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const status = r.status;
  const via = r.via;
  if (!isPublishPlatform(r.platform) || (status !== "published" && status !== "failed" && status !== "shared" && status !== "opened") || (via !== "youtube" && via !== "relay" && via !== "share")) return null;
  const link = str(r.link, 2000);
  return { id: str(r.id, 100) ?? String(num(r.at) ?? 0), at: num(r.at) ?? 0, clip: str(r.clip, 300) ?? "", platform: r.platform, account: str(r.account, 300) ?? "", via, status, link: link && /^https?:\/\//.test(link) ? link : null, error: str(r.error, 1000) };
}

/** A stored state, validated (bad entries dropped, the rest defaulted). */
export function parsePublishState(raw: unknown): PublishStoredState {
  const d = defaultPublishState();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const list = <T,>(v: unknown, parse: (x: unknown) => T | null) => (Array.isArray(v) ? v.map(parse).filter((x): x is T => x !== null) : []);
  const relayProfiles = list(r.relayProfiles, parseProfile);
  const activeRelay = str(r.activeRelay, 100);
  return {
    version: PUBLISH_STATE_VERSION,
    youtubeClientId: str(r.youtubeClientId, 300)?.trim() ?? "",
    youtubeAccounts: list(r.youtubeAccounts, parseYouTubeAccount),
    relayProfiles,
    activeRelay: activeRelay && relayProfiles.some((p) => p.id === activeRelay) ? activeRelay : relayProfiles[0]?.id ?? null,
    visibility: isVisibility(r.visibility) ? r.visibility : d.visibility,
    checked: Array.isArray(r.checked) ? r.checked.filter((k): k is string => typeof k === "string").slice(0, 200) : [],
    recent: list(r.recent, parseRecent).slice(0, RECENT_MAX),
  };
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

export function loadPublishState(storage: StorageLike | null = defaultStorage()): PublishStoredState {
  try {
    const raw = storage?.getItem(PUBLISH_STORAGE_KEY);
    return raw ? parsePublishState(JSON.parse(raw)) : defaultPublishState();
  } catch {
    return defaultPublishState();
  }
}

export function savePublishState(state: PublishStoredState, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(PUBLISH_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage full or blocked: the state lives for the session */
  }
}

/** The recent list with an entry on top, capped. */
export function addRecent(list: readonly RecentSend[], entry: RecentSend, max = RECENT_MAX): RecentSend[] {
  return [entry, ...list.filter((r) => r.id !== entry.id)].slice(0, max);
}

/** Account keys, as the ticks store them. */
export const youtubeKey = (channelId: string) => `yt:${channelId}`;
export const relayKey = (profileId: string, accountId: string) => `relay:${profileId}:${accountId}`;

/** A fresh id ("p-…"). */
export function newId(prefix: string, random: () => number = Math.random): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(random() * 1e9).toString(36)}`;
}
