/*
 * --- social-postiz --- What the `social` bridge namespace does in the main process (phase 1): the key's status, set and
 * forget, the channel list (cached for a minute, `refresh` skips the cache) and Postiz's notices. Without a stored key the
 * lists are empty rather than errors: the page reads `key.status()` first and shows the paste card.
 */

import { SOCIAL_POSTS_DAYS, type PostizChannel, type PostizConnection, type PostizKeyInput, type PostizKeyStatus, type PostizNotice, type SocialChannelSettings, type SocialPostOutcome, type SocialSlot } from "@/lib/desktop/contract";
import type { SocialAudit } from "./audit";
import type { PostizKeyStore } from "./keys";
import { recentPosts } from "./outcomes";
import { PostizError } from "./postiz";

/** How long the channel list is served from memory. */
export const CHANNELS_CACHE_MS = 60_000;

export class SocialService {
  private channels: { at: number; list: PostizChannel[] } | null = null;

  constructor(
    private readonly keys: PostizKeyStore,
    private readonly now: () => number = Date.now,
    /** Phase 2: the audit log a delete is written to (without it, deletes are refused). */
    private readonly audit: SocialAudit | null = null,
  ) {}

  private clientOrThrow() {
    const client = this.keys.client();
    if (!client) throw new PostizError("unauthorized", "Paste the Postiz API key in the Accounts tab first");
    return client;
  }

  /* ---------------------------------------------------------------- phase 2: outcomes, delete, settings, slots */

  /** The posts of the last `days` and the next (scheduled ones too), newest first; empty without a key. */
  async recentPosts(days = SOCIAL_POSTS_DAYS): Promise<SocialPostOutcome[]> {
    const client = this.keys.client();
    if (!client) return [];
    return recentPosts(client, days, this.now());
  }

  /** Removes a post – Postiz removes its whole group (the page has confirmed that) – and writes the audit line. */
  async deletePost(postId: string): Promise<void> {
    const client = this.clientOrThrow();
    if (!this.audit) throw new Error("The audit log is not available, so nothing was removed");
    await client.deletePost(postId);
    await this.audit.record({ action: "deletePost", channels: [], postIds: [postId], clipId: null, when: null });
  }

  /** The provider's rules and settings schema for a channel (the card's generic form). */
  async channelSettings(channelId: string): Promise<SocialChannelSettings> {
    return this.clientOrThrow().integrationSettings(channelId);
  }

  /** Postiz's next free slot for a channel. */
  async slot(channelId: string): Promise<SocialSlot> {
    const slot = await this.clientOrThrow().findSlot(channelId);
    if (!slot.date || !Number.isFinite(Date.parse(slot.date))) throw new PostizError("unknown", "Postiz did not name a free slot for this channel");
    return { date: new Date(slot.date).toISOString() };
  }

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
