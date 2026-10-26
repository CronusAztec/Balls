/*
 * --- social-postiz --- The audit log of what the app changed in Postiz (phase 2 of docs/SOCIAL-AUTOPILOT.md): every
 * `createPosts` and `deletePost`, with the time, the channels, the post ids, the clip and who approved it (always the user:
 * nothing reaches Postiz without the card's Approve). It lives in social-audit.json in the app's data folder, newest first,
 * through the same crash-safe JsonFileStore as the library index. The posting guards read it too, so "one post per channel
 * every 20 minutes" and "under 60 create calls an hour" hold across a restart of the app.
 *
 * --- insights --- A created post's line also keeps the genes of the clip it showed, with the TikTok audience the card chose
 * (lib/insights/genes.ts, copied at approval): the attribution ledger, so a post id keeps what made it after the Library file
 * or the queue item is deleted. The genes are sanitised on every write and every load; a line without them (written before
 * 1.6.0) loads as it was stored.
 */

import type { SocialAuditEntry } from "@/lib/desktop/contract";
import { sanitizeGenes } from "@/lib/insights/genes"; // --- insights ---
import type { JsonFileStore } from "../journal";

/** A channel gets at most one created post every 20 minutes. */
export const CHANNEL_COOLDOWN_MS = 20 * 60_000;
/** The app stays under 60 create calls an hour from one key (Postiz allows 90). */
export const CREATE_CALLS_PER_HOUR = 60;
export const HOUR_MS = 60 * 60_000;
/** How many lines the file keeps. */
export const AUDIT_MAX_ENTRIES = 2000;

export type AuditInput = Omit<SocialAuditEntry, "at" | "by"> & { at?: string };

// --- insights ---
/** A stored line with its genes sanitised: a record that is not one is dropped, a line without genes is kept as it was. */
export function withAuditGenes(entry: SocialAuditEntry): SocialAuditEntry {
  if (!("genes" in entry)) return entry;
  const { genes, ...rest } = entry;
  const clean = sanitizeGenes(genes);
  return clean ? { ...rest, genes: clean } : rest;
}
// --- end insights ---

export class SocialAudit {
  private cache: SocialAuditEntry[] | null = null;

  constructor(
    private readonly store: JsonFileStore<SocialAuditEntry[]>,
    private readonly now: () => number = Date.now,
  ) {}

  /** The entries, newest first (the file is read once, then kept in memory). */
  private async entries(): Promise<SocialAuditEntry[]> {
    if (!this.cache) {
      const list = await this.store.read();
      // --- review fix (social-postiz) --- the lists too, so a hand-edited entry cannot make `lastCreateFor` throw
      this.cache = Array.isArray(list) ? list.filter((e) => e && typeof e === "object" && typeof e.at === "string" && typeof e.action === "string" && Array.isArray(e.channels) && Array.isArray(e.postIds)).map(withAuditGenes) : []; // --- insights --- (genes sanitised on load)
    }
    return this.cache;
  }

  async record(input: AuditInput): Promise<SocialAuditEntry> {
    const entry: SocialAuditEntry = {
      at: input.at ?? new Date(this.now()).toISOString(),
      action: input.action,
      channels: [...input.channels],
      postIds: [...input.postIds],
      by: "user",
      clipId: input.clipId ?? null,
      when: input.when ?? null,
      ...(input.video ? { video: input.video } : {}), // --- ai-cut --- the video the post showed (a master and its cut are one)
      ...(input.genes !== undefined ? { genes: input.genes } : {}), // --- insights --- the clip's genes (sanitised just below)
    };
    const stored = withAuditGenes(entry); // --- insights --- (genes sanitised on write)
    const list = [stored, ...(await this.entries())].slice(0, AUDIT_MAX_ENTRIES);
    this.cache = list;
    await this.store.write(list);
    return stored;
  }

  /** The newest `limit` entries. */
  async recent(limit = 50): Promise<SocialAuditEntry[]> {
    return (await this.entries()).slice(0, Math.max(0, limit));
  }

  /** When a post was last created for `channelId` (ms since the epoch), null when never. */
  async lastCreateFor(channelId: string): Promise<number | null> {
    for (const e of await this.entries()) {
      if (e.action !== "createPosts" || !e.channels.includes(channelId)) continue;
      const at = Date.parse(e.at);
      if (Number.isFinite(at)) return at;
    }
    return null;
  }

  /** How many create calls were made since `sinceMs`. */
  async createCallsSince(sinceMs: number): Promise<number> {
    let n = 0;
    for (const e of await this.entries()) {
      if (e.action !== "createPosts") continue;
      const at = Date.parse(e.at);
      if (Number.isFinite(at) && at >= sinceMs) n++;
    }
    return n;
  }
}
