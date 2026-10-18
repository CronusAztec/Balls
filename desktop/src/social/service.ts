/*
 * --- social-postiz --- What the `social` bridge namespace does in the main process (phase 1): the key's status, set and
 * forget, the channel list (cached for a minute, `refresh` skips the cache) and Postiz's notices. Without a stored key the
 * lists are empty rather than errors: the page reads `key.status()` first and shows the paste card.
 */

import type { PostizChannel, PostizConnection, PostizKeyInput, PostizKeyStatus, PostizNotice } from "@/lib/desktop/contract";
import type { PostizKeyStore } from "./keys";

/** How long the channel list is served from memory. */
export const CHANNELS_CACHE_MS = 60_000;

export class SocialService {
  private channels: { at: number; list: PostizChannel[] } | null = null;

  constructor(
    private readonly keys: PostizKeyStore,
    private readonly now: () => number = Date.now,
  ) {}

  keyStatus(): PostizKeyStatus {
    return this.keys.status();
  }

  /** A new key: checked with Postiz, then kept; the channels it answered with fill the cache. */
  async setKey(input: PostizKeyInput): Promise<PostizConnection> {
    const connection = await this.keys.set(input);
    this.channels = { at: this.now(), list: connection.channels };
    return connection;
  }

  forgetKey(): PostizKeyStatus {
    this.channels = null;
    return this.keys.forget();
  }

  /** The channels connected in Postiz (from the cache when it is under a minute old, unless `refresh`). */
  async listChannels(refresh = false): Promise<PostizChannel[]> {
    const client = this.keys.client();
    if (!client) {
      this.channels = null;
      return [];
    }
    if (!refresh && this.channels && this.now() - this.channels.at < CHANNELS_CACHE_MS) return this.channels.list;
    const list = await client.integrations();
    this.channels = { at: this.now(), list };
    return list;
  }

  /** Postiz's own notices, a page at a time (never cached: they are what changed since the last look). */
  async listNotices(page = 0): Promise<PostizNotice[]> {
    const client = this.keys.client();
    if (!client) return [];
    return client.notifications(page);
  }
}
