import { checkEntitlement, requireEntitlement, type EntitlementRefusal, type ProFeature } from "./guard";

/*
 * --- paywall-gate --- How a refusal of the guard becomes the Unlock dialog: a tiny module-level channel. A locked action
 * calls `requestUnlock(refusal)`; the dialog's host (components/billing/UnlockDialog.tsx, mounted by the simulator)
 * listens and opens. `withEntitlement()` / `gate()` wrap an action in the guard: it runs for a Pro licence, the dialog
 * opens instead for everyone else.
 */

export interface UnlockRequest {
  /** The action that was refused (null: opened from the account row, nothing in particular). */
  feature: ProFeature | null;
  reason: EntitlementRefusal["reason"] | null;
  /** Increases with every request, so the same refusal twice reopens the dialog. */
  serial: number;
}

const listeners = new Set<(request: UnlockRequest) => void>();
let serial = 0;

/** Opens the Unlock dialog (for a refusal, or plainly). */
export function requestUnlock(refusal?: EntitlementRefusal | null): void {
  serial += 1;
  const request: UnlockRequest = { feature: refusal?.feature ?? null, reason: refusal?.reason ?? null, serial };
  for (const l of listeners) l(request);
}

/** Listens for unlock requests (the dialog's host); returns the unsubscribe. */
export function subscribeUnlock(listener: (request: UnlockRequest) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Runs `action` when the guard grants `feature`, else opens the Unlock dialog; resolves whether the action ran. */
export async function withEntitlement(feature: ProFeature, action: () => unknown): Promise<boolean> {
  const decision = await requireEntitlement(feature);
  if (!decision.ok) {
    requestUnlock(decision);
    return false;
  }
  await action();
  return true;
}

/**
 * The synchronous form for click handlers that must act within the user's gesture (a download, a share sheet): decides on
 * the store's current answer – the licence check is long done by the time a button is pressed – and opens the dialog on a
 * refusal. Returns whether the action may go on.
 */
export function gate(feature: ProFeature): boolean {
  const decision = checkEntitlement(feature);
  if (decision.ok) return true;
  requestUnlock(decision);
  return false;
}
