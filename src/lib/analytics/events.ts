// --- analytics --- the studio's and the pricing page's events, built from what the page knows (README "Analytics events")
/*
 * Small wrappers over track() so the call sites in the huge components are one line: they pick the props (short tokens and
 * numbers only – the mode id, the export size, the plan) and keep the once-only rules. All of them do nothing without a
 * statistics script address, and none ever throws. Imported by the studio and the billing screens only, never by the loader.
 */
import { getEntitlementStore } from "@/lib/billing/entitlement";
import { PLANS, type Plan, type Provider } from "@/lib/billing/config";
import { noteEntry, takeEntry, track } from "./track";

/** "free" until a verified Pro licence is installed (the same store the watermark's seal is made from). */
export function watermarkNow(): "free" | "pro" {
  try {
    return getEntitlementStore().getSnapshot().status === "pro" ? "pro" : "free";
  } catch {
    return "free";
  }
}

/** True when this page load opened the studio itself (a link, a bookmark, a typed address), not a click inside the site or a reload. */
export function landedOnThisPage(): boolean {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return !!nav && nav.type === "navigate" && new URL(nav.name).pathname === window.location.pathname;
  } catch {
    return false;
  }
}

let simStarted = false;
/** `sim_start`: the first time a run starts in this page load. `daily` when the page opened a daily-challenge link. */
export function trackSimStart(mode: string, daily: boolean): void {
  if (simStarted) return;
  simStarted = true;
  const noted = takeEntry();
  track("sim_start", { mode, entry: daily ? "daily" : (noted ?? "direct") });
}

/** The studio opened from a link: a share code that decoded (`share_open` code) or a daily-challenge link opened by address (`share_open` daily). */
export function trackShareOpen(kind: "code" | "daily"): void {
  if (kind === "code") noteEntry("share");
  track("share_open", { kind });
}

/** `clip_export`: one recording, one fast export or one batch ZIP the visitor got. `secs` is the clip length (the setting for a recording). */
export function trackClipExport(clip: { kind: "record" | "fast" | "batch"; mode?: string; res?: string; secs?: number; watermark?: "free" | "pro" }): void {
  const { mode, res, secs } = clip;
  track("clip_export", { kind: clip.kind, watermark: clip.watermark ?? watermarkNow(), ...(mode ? { mode } : {}), ...(res ? { res } : {}), ...(secs !== undefined && secs > 0 ? { secs: Math.round(secs) } : {}) });
}

const purchased = new Set<string>();
/**
 * `purchase`, with the plan's list price as revenue: once per receipt reference in this page (the claim effect can run again).
 * The reference is only compared in memory, never sent and never stored.
 */
export function trackPurchase(reference: string, plan: Plan, provider: Provider): void {
  if (purchased.has(reference)) return;
  purchased.add(reference);
  track("purchase", { plan, provider }, { currency: "USD", amount: PLANS[plan].usd });
}
