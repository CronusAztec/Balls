/*
 * --- social-autopilot --- The proposal queue (phases 3–4 of docs/SOCIAL-AUTOPILOT.md), kept in social-queue.json of the
 * app's data folder through the crash-safe JsonFileStore and restored on start. An item is a clip, its channels with the text
 * and whatever settings are known, when, a status and who wrote the text (the planner or the user).
 *
 * Rules in code:
 *  - a `proposed` item never calls Postiz: nothing in this file talks to Postiz except `approve`, which runs the existing
 *    `ClipPoster.postClip` with the request the approval card produced – the card is the only path to a post;
 *  - `approve` marks the item posted (with the post ids) or failed (with the error); `skip`, `remove` and `edit` (text,
 *    settings, when) are the user's; `edit` marks the text `by: "user"`;
 *  - at most 200 items (finished ones go first when the cap bites), proposals older than 14 days are dropped, and a new
 *    proposal for a clip and channel that is already proposed is merged into that item instead of doubling it;
 *  - the `social:queue` event carries the whole list on every change.
 */

import { randomUUID } from "crypto";
import { SOCIAL_QUEUE_MAX, type SocialPostRequest, type SocialPostResult, type SocialProposalInput, type SocialQueueBy, type SocialQueueEdit, type SocialQueueItem, type SocialQueueStatus, tiktokUserOnlyKeysIn } from "@/lib/desktop/contract";
import { proposalExpired } from "@/lib/desktop/autopilot";
import type { JsonFileStore } from "../journal";
import type { ClipPoster } from "./posting";

/** The queue keeps this many log lines per item. */
export const QUEUE_LOG_MAX = 20;

export interface SocialQueueDeps {
  store: JsonFileStore<SocialQueueItem[]>;
  /** The only way to Postiz: the card's request, run as it is. */
  poster: Pick<ClipPoster, "postClip">;
  emit: (items: SocialQueueItem[]) => void;
  log?: (level: "info" | "warn" | "error", message: string) => void;
  now?: () => number;
  id?: () => string;
}

const STATUSES: readonly SocialQueueStatus[] = ["proposed", "approved", "skipped", "posted", "failed"];
/** Items that are done: the first to go when the cap bites. */
const FINISHED: readonly SocialQueueStatus[] = ["skipped", "posted", "failed"];

/** A stored item as the queue trusts it (a hand-edited file cannot make a method throw); null when it is not one. */
export function sanitizeQueueItem(raw: unknown): SocialQueueItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !r.id || typeof r.clipId !== "string" || !r.clipId) return null;
  if (!STATUSES.includes(r.status as SocialQueueStatus)) return null;
  if (typeof r.createdAt !== "string" || !Number.isFinite(Date.parse(r.createdAt))) return null;
  if (!Array.isArray(r.channels)) return null;
  const channels = r.channels.flatMap((c) => {
    const ch = c as Record<string, unknown> | null;
    if (!ch || typeof ch !== "object" || typeof ch.integrationId !== "string" || !ch.integrationId || typeof ch.platform !== "string") return [];
    const settings = ch.settings && typeof ch.settings === "object" && !Array.isArray(ch.settings) ? ({ ...(ch.settings as Record<string, unknown>) } as Record<string, unknown>) : { __type: ch.platform };
    for (const key of tiktokUserOnlyKeysIn(settings)) delete settings[key]; // the user chooses these on the card, never from the file
    return [{ integrationId: ch.integrationId, platform: ch.platform, text: typeof ch.text === "string" ? ch.text : "", settings }];
  });
  if (channels.length === 0) return null;
  return {
    id: r.id,
    clipId: r.clipId,
    channels,
    when: r.when === "now" || r.when === "draft" || (typeof r.when === "string" && Number.isFinite(Date.parse(r.when))) ? (r.when as string) : null,
    status: r.status as SocialQueueStatus,
    by: r.by === "user" ? "user" : "ai",
    reason: typeof r.reason === "string" ? r.reason.slice(0, 300) : "",
    createdAt: r.createdAt,
    postIds: Array.isArray(r.postIds) ? r.postIds.filter((p): p is { channelId: string; postId: string } => !!p && typeof p === "object" && typeof (p as { postId?: unknown }).postId === "string" && typeof (p as { channelId?: unknown }).channelId === "string") : [],
    error: typeof r.error === "string" ? r.error : null,
    log: Array.isArray(r.log) ? r.log.filter((l): l is { at: string; text: string } => !!l && typeof l === "object" && typeof (l as { at?: unknown }).at === "string" && typeof (l as { text?: unknown }).text === "string").slice(-QUEUE_LOG_MAX) : [],
  };
}

/** The list within its cap: expired proposals gone, then (oldest first) finished items, then the rest. */
export function trimQueue(items: readonly SocialQueueItem[], now: number, max = SOCIAL_QUEUE_MAX): SocialQueueItem[] {
  let kept = items.filter((i) => !proposalExpired(i, now));
  if (kept.length <= max) return kept;
  const byAge = (a: SocialQueueItem, b: SocialQueueItem) => Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const finished = kept.filter((i) => FINISHED.includes(i.status)).sort(byAge);
  const drop = new Set<string>();
  for (const i of finished) {
    if (kept.length - drop.size <= max) break;
    drop.add(i.id);
  }
  kept = kept.filter((i) => !drop.has(i.id));
  if (kept.length > max) kept = [...kept].sort(byAge).slice(kept.length - max);
  return kept;
}

export class SocialQueue {
  private items: SocialQueueItem[] | null = null;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: SocialQueueDeps) {
    this.now = deps.now ?? Date.now;
    this.newId = deps.id ?? (() => randomUUID());
  }

  /** The items, newest first (the file is read once, then kept in memory). */
  private async all(): Promise<SocialQueueItem[]> {
    if (!this.items) {
      const raw = await this.deps.store.read();
      const list = Array.isArray(raw) ? raw.map(sanitizeQueueItem).filter((i): i is SocialQueueItem => i !== null) : [];
      // --- an app that crashed mid-approve left an item "approved" with no post ids: it is a failed one now, the user may approve again
      for (const item of list) {
        if (item.status === "approved") {
          item.status = "failed";
          item.error = "The app closed while this post was on its way. Check the Posts tab before you approve it again.";
          item.log = [...item.log, { at: new Date(this.now()).toISOString(), text: "restored after a restart: not completed" }].slice(-QUEUE_LOG_MAX);
        }
      }
      this.items = trimQueue(list, this.now()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    }
    return this.items;
  }

  /** Restores the file on start (and announces it). */
  async load(): Promise<SocialQueueItem[]> {
    const items = await this.all();
    this.deps.emit(items);
    return items;
  }

  private async commit(items: SocialQueueItem[]): Promise<SocialQueueItem[]> {
    const trimmed = trimQueue(items, this.now()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    this.items = trimmed;
    await this.deps.store.write(trimmed);
    this.deps.emit(trimmed);
    return trimmed;
  }

  private stamp(): string {
    return new Date(this.now()).toISOString();
  }

  private withLog(item: SocialQueueItem, text: string): SocialQueueItem {
    return { ...item, log: [...item.log, { at: this.stamp(), text }].slice(-QUEUE_LOG_MAX) };
  }

  async list(): Promise<SocialQueueItem[]> {
    return [...(await this.all())];
  }

  async get(id: string): Promise<SocialQueueItem | undefined> {
    return (await this.all()).find((i) => i.id === id);
  }

  /**
   * Adds proposals. A proposal for a clip that is already `proposed` and shares a channel with it is merged into that item:
   * its new channels are added; when the item's text is still the planner's (`by: "ai"`) the shared channels' text, the time
   * and the reason are replaced, when the user has edited it they stay.
   */
  async propose(proposals: readonly SocialProposalInput[], by: SocialQueueBy): Promise<SocialQueueItem[]> {
    const items = [...(await this.all())];
    for (const p of proposals) {
      const channels = p.channels.map((c) => {
        const settings = { __type: c.platform, ...(c.settings ?? {}) } as Record<string, unknown>;
        for (const key of tiktokUserOnlyKeysIn(settings)) delete settings[key]; // never proposed, whatever the caller sent
        return { integrationId: c.integrationId, platform: c.platform, text: c.text, settings };
      });
      const existingIndex = items.findIndex((i) => i.status === "proposed" && i.clipId === p.clipId && i.channels.some((c) => channels.some((n) => n.integrationId === c.integrationId)));
      if (existingIndex >= 0) {
        const existing = items[existingIndex];
        const replace = existing.by === "ai";
        const merged = existing.channels.map((c) => {
          const next = channels.find((n) => n.integrationId === c.integrationId);
          return next && replace ? { ...c, text: next.text, settings: { ...c.settings, ...next.settings } } : c;
        });
        for (const n of channels) if (!merged.some((c) => c.integrationId === n.integrationId)) merged.push(n);
        items[existingIndex] = this.withLog({ ...existing, channels: merged, when: replace ? p.when : existing.when, reason: replace ? p.reason : existing.reason }, `merged a new proposal (${channels.map((c) => c.platform).join(", ")})`);
        this.deps.log?.("info", `queue: merged a proposal for clip ${p.clipId} into ${existing.id}`);
        continue;
      }
      const item: SocialQueueItem = {
        id: this.newId(),
        clipId: p.clipId,
        channels,
        when: p.when,
        status: "proposed",
        by,
        reason: p.reason.slice(0, 300),
        createdAt: this.stamp(),
        postIds: [],
        error: null,
        log: [{ at: this.stamp(), text: `proposed by ${by}` }],
      };
      items.unshift(item);
      this.deps.log?.("info", `queue: proposed clip ${p.clipId} for ${channels.length} channel(s) by ${by}`);
    }
    return this.commit(items);
  }

  /**
   * The card's Approve for a queued item: the request the card produced goes to `ClipPoster.postClip` exactly as it is –
   * once – and the item becomes posted (the post ids) or failed (the error). Only a proposed or failed item may be approved,
   * and only for its own clip.
   */
  async approve(id: string, request: SocialPostRequest): Promise<SocialPostResult> {
    const items = [...(await this.all())];
    const index = items.findIndex((i) => i.id === id);
    if (index < 0) throw new Error("This proposal is not in the queue any more");
    const item = items[index];
    if (item.status !== "proposed" && item.status !== "failed") throw new Error(`This proposal was already ${item.status}`);
    if (request.clipId !== item.clipId) throw new Error("The approved request is for another clip than the proposal");
    items[index] = this.withLog({ ...item, status: "approved", error: null, channels: item.channels.map((c) => ({ ...c, text: request.channels.find((r) => r.id === c.integrationId)?.text ?? c.text })), when: request.when }, `approved by the user for ${request.channels.length} channel(s), ${request.when}`);
    await this.commit(items);
    try {
      const result = await this.deps.poster.postClip(request);
      await this.update(id, (i) => this.withLog({ ...i, status: "posted", postIds: result.postIds, error: null, by: "user" }, `posted: ${result.postIds.map((p) => p.postId).join(", ") || "no post ids"}`));
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.update(id, (i) => this.withLog({ ...i, status: "failed", error: message }, `failed: ${message.slice(0, 200)}`));
      throw err;
    }
  }

  private async update(id: string, change: (item: SocialQueueItem) => SocialQueueItem): Promise<SocialQueueItem[]> {
    const items = [...(await this.all())];
    const index = items.findIndex((i) => i.id === id);
    if (index < 0) throw new Error("This proposal is not in the queue any more");
    items[index] = change(items[index]);
    return this.commit(items);
  }

  /** The user's edit of the text, the settings or the time: the text is theirs from now on. */
  async edit(id: string, patch: SocialQueueEdit): Promise<SocialQueueItem[]> {
    return this.update(id, (item) => {
      if (item.status !== "proposed" && item.status !== "failed") throw new Error(`This proposal was already ${item.status}`);
      const channels = item.channels.map((c) => {
        const change = patch.channels?.find((p) => p.integrationId === c.integrationId);
        if (!change) return c;
        const settings = { ...c.settings, ...(change.settings ?? {}) };
        for (const key of tiktokUserOnlyKeysIn(settings)) delete settings[key];
        return { ...c, text: change.text ?? c.text, settings };
      });
      return this.withLog({ ...item, channels, when: patch.when === undefined ? item.when : patch.when, by: "user" }, "edited by the user");
    });
  }

  async skip(id: string): Promise<SocialQueueItem[]> {
    return this.update(id, (item) => {
      if (item.status !== "proposed" && item.status !== "failed") throw new Error(`This proposal was already ${item.status}`);
      return this.withLog({ ...item, status: "skipped" }, "skipped by the user");
    });
  }

  async remove(id: string): Promise<SocialQueueItem[]> {
    const items = await this.all();
    const item = items.find((i) => i.id === id);
    if (item?.status === "approved") throw new Error("This post is on its way to Postiz: wait for it to finish");
    return this.commit(items.filter((i) => i.id !== id));
  }
}
