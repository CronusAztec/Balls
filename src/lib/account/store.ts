import { normalizeRelayUrl } from "@/lib/publish/relayClient";
import { parseUser, type AccountUser } from "./client";

/*
 * --- user-accounts --- What this browser remembers of the signed-in account (localStorage, one key): the relay's address, the
 * session token and who it belongs to. Never the password. Every read and write is wrapped: the account works for the session
 * without storage. Not mirrored into the URL, presets or project files – the token stays here.
 */

export const ACCOUNT_STORAGE_KEY = "jumpingballslive_account";
export const ACCOUNT_STATE_VERSION = 1;
/** Announced on `window` whenever the signed-in account changes in this tab (the navbar listens). */
export const ACCOUNT_EVENT = "jbl-account-changed";

export interface StoredAccount {
  version: number;
  /** The relay that holds the account (normalised, no trailing slash). */
  relayUrl: string;
  token: string;
  /** Epoch ms the session ends. */
  expiresAt: number;
  user: AccountUser;
}

type StorageLike = Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">>;

const defaultStorage = (): StorageLike | null => {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
};

/** A stored session, validated; null for anything else (also an expired one). */
export function parseStoredAccount(raw: unknown, now: number): StoredAccount | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const relayUrl = typeof r.relayUrl === "string" ? normalizeRelayUrl(r.relayUrl) : null;
  const user = parseUser(r.user);
  const expiresAt = typeof r.expiresAt === "number" && Number.isFinite(r.expiresAt) ? r.expiresAt : 0;
  if (!relayUrl || !user || typeof r.token !== "string" || !r.token.startsWith("jbs_") || expiresAt <= now) return null;
  return { version: ACCOUNT_STATE_VERSION, relayUrl, token: r.token, expiresAt, user };
}

export function loadAccount(now: number, storage: StorageLike | null = defaultStorage()): StoredAccount | null {
  try {
    const raw = storage?.getItem(ACCOUNT_STORAGE_KEY);
    return raw ? parseStoredAccount(JSON.parse(raw), now) : null;
  } catch {
    return null;
  }
}

export function saveAccount(account: StoredAccount | null, storage: StorageLike | null = defaultStorage()): void {
  try {
    if (account) storage?.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(account));
    else if (storage?.removeItem) storage.removeItem(ACCOUNT_STORAGE_KEY);
    else storage?.setItem(ACCOUNT_STORAGE_KEY, "");
  } catch {
    /* storage full or blocked: the account lives for the session */
  }
}
