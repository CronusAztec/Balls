/*
 * --- social-postiz --- The Postiz API key at rest: `{ baseUrl, keySealed }` in the app's electron-store under a `postiz`
 * block (like the cloud AI key's `cloud` block), the key sealed with the same SecretBox (Windows' safeStorage). `status()`
 * never returns the key; `set()` checks a new key against Postiz before it replaces the old one, so a typo keeps the working
 * key; `forget()` removes it. Pasting a key is the user's consent for the app to act on that Postiz workspace.
 */

import { POSTIZ_DEFAULT_URL, type PostizConnection, type PostizKeyInput, type PostizKeyStatus } from "@/lib/desktop/contract";
import type { SecretBox } from "../ai/secrets";
import { PostizClient, PostizError, normalisePostizBase } from "./postiz";

export interface PostizSettings {
  /** What the user typed (the client normalises it to `<base>/public/v1`). */
  baseUrl: string;
  /** The API key sealed by SecretBox (base64), "" when none. */
  keySealed: string;
}

export const DEFAULT_POSTIZ: PostizSettings = { baseUrl: POSTIZ_DEFAULT_URL, keySealed: "" };

export interface PostizKeyStoreDeps {
  settings: () => PostizSettings;
  setSettings: (settings: PostizSettings) => void;
  secrets: SecretBox;
  /** The HTTP client the Postiz calls use (main.ts: Electron's net.fetch). */
  fetch?: typeof fetch;
  log?: (level: "info" | "warn" | "error", message: string) => void;
  /** The tests shorten the client's timeouts. */
  timeoutMs?: number;
}

/** The address is kept only when it is one the client would call: https, or http on this PC. */
export function validatePostizUrl(baseUrl: string): string {
  const text = String(baseUrl ?? "").trim();
  if (text.length > 500) throw new PostizError("badUrl", "The Postiz address is too long");
  normalisePostizBase(text);
  return text.replace(/\/+$/, "");
}

export class PostizKeyStore {
  constructor(private readonly deps: PostizKeyStoreDeps) {}

  private settings(): PostizSettings {
    return { ...DEFAULT_POSTIZ, ...(this.deps.settings() ?? {}) };
  }

  /** The key itself, for the client only (null: none stored, or the sealed one cannot be opened on this PC). */
  private key(): string | null {
    return this.deps.secrets.open(this.settings().keySealed);
  }

  /** Whether a key is stored, where it points and whether this PC can seal one – never the key. */
  status(): PostizKeyStatus {
    const s = this.settings();
    return { configured: this.key() !== null, baseUrl: s.baseUrl || POSTIZ_DEFAULT_URL, encryption: this.deps.secrets.available };
  }

  /** A client over the stored key (null without one). */
  client(): PostizClient | null {
    const key = this.key();
    if (!key) return null;
    return this.clientFor(this.settings().baseUrl, key);
  }

  private clientFor(baseUrl: string, apiKey: string): PostizClient {
    return new PostizClient({ baseUrl, apiKey, fetch: this.deps.fetch, log: this.deps.log, timeoutMs: this.deps.timeoutMs });
  }

  /**
   * Checks the address and the key with Postiz (`is-connected`, `me`, `integrations`), then seals and keeps them. A key Postiz
   * refuses, or an address that does not answer, throws its PostizError and the previous key stays.
   */
  async set(input: PostizKeyInput): Promise<PostizConnection> {
    const baseUrl = validatePostizUrl(input.baseUrl);
    const apiKey = String(input.apiKey ?? "").trim();
    if (!apiKey) throw new PostizError("unauthorized", "Paste the Postiz API key first");
    if (!this.deps.secrets.available) throw new PostizError("unknown", "Secure storage is not available on this system: the key was not saved");
    const client = this.clientFor(baseUrl, apiKey);
    if (!(await client.isConnected())) throw new PostizError("unauthorized", "Postiz does not accept this API key", { status: 401 });
    const organization = await client.me();
    if (!organization.id) throw new PostizError("unknown", "This address does not answer like Postiz: check it", { status: 200 });
    const channels = await client.integrations();
    this.deps.setSettings({ baseUrl, keySealed: this.deps.secrets.seal(apiKey) });
    this.deps.log?.("info", `postiz: key saved for ${client.baseUrl} (${organization.name}, ${channels.length} channels)`);
    return { organization, channels };
  }

  /** Removes the key (the address stays, so the field shows what it was). */
  forget(): PostizKeyStatus {
    const s = this.settings();
    if (s.keySealed) this.deps.log?.("info", "postiz: key forgotten");
    this.deps.setSettings({ baseUrl: s.baseUrl, keySealed: "" });
    return this.status();
  }
}
