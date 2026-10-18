/*
 * --- social-postiz --- How the app learns what became of its posts (phase 2 of docs/SOCIAL-AUTOPILOT.md): no webhook reaches
 * a desktop app, so the Posts tab and the card ask `GET /posts?startDate&endDate` and read the state of every row –
 * QUEUE (scheduled), PUBLISHED (with the link), ERROR (with Postiz's message), DRAFT. The window runs `days` back and the
 * same `days` forward, so a post scheduled for next week shows under Scheduled.
 */

import type { SocialPostOutcome } from "@/lib/desktop/contract";
import type { PostizClient, PostizPost } from "./postiz";

const DAY_MS = 24 * 60 * 60_000;

/** The ISO window of `days` back and `days` forward from `now`. */
export function outcomeWindow(days: number, now: number = Date.now()): { startDate: string; endDate: string } {
  const span = Math.max(1, Math.floor(days)) * DAY_MS;
  return { startDate: new Date(now - span).toISOString(), endDate: new Date(now + span).toISOString() };
}

/** A Postiz row as the page shows it. */
export function outcomeOf(post: PostizPost): SocialPostOutcome {
  return {
    id: post.id,
    channel: post.integration ? { id: post.integration.id, name: post.integration.name, platform: post.integration.platform, picture: post.integration.picture } : null,
    state: post.state,
    publishDate: post.publishDate,
    releaseUrl: post.releaseURL,
    error: post.error,
    content: post.content,
  };
}

/** The posts of the window, newest first. */
export async function recentPosts(client: PostizClient, days: number, now: number = Date.now()): Promise<SocialPostOutcome[]> {
  const posts = await client.posts(outcomeWindow(days, now));
  return posts.map(outcomeOf).sort((a, b) => (Date.parse(b.publishDate) || 0) - (Date.parse(a.publishDate) || 0));
}
