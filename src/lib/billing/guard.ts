import { CLOCK_SKEW_SEC, type Plan } from "./config";
import { getEntitlementStore, type Entitlement, type EntitlementStore } from "./entitlement";

/*
 * --- free-watermark --- Since the watermark gate, video creation is no longer refused: everyone records and exports, and a
 * video without a verified Pro licence carries the watermark (lib/watermark/seal.ts decides that, per recording or export).
 * This guard now decides what stays Pro beyond the watermark – Publish (`gate("publish")`, the desktop Library's targets) –
 * and its types name the features the Unlock dialog can mention. The original design, for the record:
 *
 * --- paywall-gate --- THE guard of video creation. Every way of making a video file asks it first: the page's Record
 * Video (Simulator.tsx `toggleRecording`) and the recorder itself (`VideoRecorder.startRecording`), the fast export
 * (Simulator.tsx `startFastExport` and `renderFast`), the batch runner (useBatchRender's start, which the viral bot's
 * renders and the desktop render queue go through as well), the viral bot's record step (useViralBot's render), the
 * desktop render queue's enqueue (useRenderQueue's add), Publish's send, and the downloads of rendered videos. The UI
 * only puts a lock on the buttons – they stay visible and their sections editable – and turns a refusal into the Unlock
 * dialog (unlock.ts), so a free visitor can prepare everything and see what Pro does; a call that went around the UI meets
 * the same refusal here.
 *
 * HONEST LIMITS: this browser-side gate is advisory. The page's code runs on the visitor's machine and a browser can be
 * patched to skip any check; what cannot be forged is the signed licence itself – an ES256 signature made with the billing
 * backend's private key and verified here with the public key baked into the build. Only rendering on a server would
 * enforce video creation fully.
 */

/** The video-creating actions the guard decides on (the Unlock dialog and the lock badges name them). */
export const PRO_FEATURES = ["record", "fastExport", "batch", "bot", "publish", "renderQueue", "download"] as const;
export type ProFeature = (typeof PRO_FEATURES)[number];

export interface EntitlementGrant {
  ok: true;
  feature: ProFeature;
  plan: Plan;
  /** The licence's exp (ms). */
  expiresAt: number;
}

/**
 * A typed refusal the callers turn into the Unlock dialog: no licence ("free"), a licence past its exp ("expired") or no
 * answer from the licence check in time ("unverified").
 */
export interface EntitlementRefusal {
  ok: false;
  feature: ProFeature;
  reason: "free" | "expired" | "unverified";
}

export type EntitlementDecision = EntitlementGrant | EntitlementRefusal;

/** Decides from an entitlement and the clock (synchronous; the store's current state by default). */
export function checkEntitlement(feature: ProFeature, entitlement: Entitlement = getEntitlementStore().getSnapshot(), now: number = Date.now()): EntitlementDecision {
  if (entitlement.status === "checking") return { ok: false, feature, reason: "unverified" };
  if (entitlement.status !== "pro" || !entitlement.plan || entitlement.expiresAt === null) return { ok: false, feature, reason: "free" };
  if (now > entitlement.expiresAt + CLOCK_SKEW_SEC * 1000) return { ok: false, feature, reason: "expired" };
  return { ok: true, feature, plan: entitlement.plan, expiresAt: entitlement.expiresAt };
}

export interface RequireEntitlementOptions {
  store?: EntitlementStore;
  /** How long to wait for a licence check in flight (ms). */
  timeoutMs?: number;
  now?: () => number;
}

/** How long the guard waits for the first licence check (a WebCrypto verification takes milliseconds). */
export const ENTITLEMENT_WAIT_MS = 5000;

/**
 * The guard: waits for a licence check still in flight (the page's first moments) or a renewal of a licence that ran out
 * ("Renewing your licence…" – a renewed subscription should not meet the Unlock dialog), then decides. Never throws; a
 * refusal is a value the caller turns into the Unlock dialog (`requestUnlock()`) or, in a library entry point, into
 * `EntitlementRequiredError`.
 */
export async function requireEntitlement(feature: ProFeature, options: RequireEntitlementOptions = {}): Promise<EntitlementDecision> {
  const store = options.store ?? getEntitlementStore();
  let entitlement = store.getSnapshot();
  if (entitlement.status === "checking" || entitlement.renewing) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Entitlement>((resolve) => (timer = setTimeout(() => resolve(store.getSnapshot()), options.timeoutMs ?? ENTITLEMENT_WAIT_MS)));
    entitlement = await Promise.race([store.whenIdle(), timeout]);
    clearTimeout(timer);
  }
  return checkEntitlement(feature, entitlement, (options.now ?? Date.now)());
}

/** Thrown by a library entry point (renderFast, the recorder) the guard refused; carries the refusal for the dialog. */
export class EntitlementRequiredError extends Error {
  constructor(readonly refusal: EntitlementRefusal) {
    super(`A Pro licence is needed for ${refusal.feature} (${refusal.reason})`);
    this.name = "EntitlementRequiredError";
  }
}

export function isEntitlementRefusal(value: unknown): value is EntitlementRefusal {
  return !!value && typeof value === "object" && (value as { ok?: unknown }).ok === false && (PRO_FEATURES as readonly string[]).includes(String((value as { feature?: unknown }).feature));
}
