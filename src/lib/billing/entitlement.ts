import { useEffect, useSyncExternalStore } from "react";
import { CLOCK_SKEW_SEC, LICENSE_LAPSED_STORAGE_KEY, LICENSE_PUBLIC_KEY, LICENSE_REF_STORAGE_KEY, LICENSE_STORAGE_KEY, LICENSE_TEST_MODE, isPlan, isProvider, type Plan, type Provider } from "./config";
import { licenseExpiresAtMs, verifyLicense, type LicenseCheck, type LicensePayload } from "./license";

/*
 * --- paywall-gate --- Who may create videos in this browser: a small live store (like the stores of components/simulator)
 * over the licence token kept in localStorage ("jbl.license"). It verifies the token when the page starts, whenever the
 * window gets the focus and whenever another tab changes the token (the storage event). A token that does not verify is
 * dropped from storage with its receipt. One that has EXPIRED is dropped too, but not forgotten: a subscription's licence
 * runs out at the end of every paid period unless the page fetched the renewed one in time, so the receipt it was claimed
 * with stays ("jbl.license.ref") and the expired licence's email, plan and provider are kept ("jbl.license.lapsed") – the
 * quiet renewal (account.ts) asks the backend for the renewed licence with them, and only the backend's "no longer active"
 * or "unknown reference" (or Remove from this browser) forgets them. `useEntitlement()` is the hook the pricing page, the
 * Unlock dialog, the account row and the lock badges read; the guard (guard.ts) reads the same store.
 *
 * States: "checking" until the first verification has answered (WebCrypto is asynchronous), then "free" or "pro". A later
 * re-check keeps the last answer on show until it has its own (no flicker on every focus).
 */

export type EntitlementStatus = "checking" | "free" | "pro";

/** A licence that ran out in this browser: what the renewal asks the backend about. */
export interface LapsedLicence {
  email: string;
  plan: Plan;
  provider: Provider | null;
  /** Its exp (ms). */
  expiresAt: number;
}

export interface Entitlement {
  status: EntitlementStatus;
  plan: Plan | null;
  provider: Provider | null;
  email: string | null;
  /** The licence's exp (ms): the paid period's end plus the grace days. */
  expiresAt: number | null;
  /** The licence's iat (ms), null without one. */
  issuedAt: number | null;
  /** This build verifies with the committed TEST key (no NEXT_PUBLIC_LICENSE_PUBLIC_KEY). */
  testMode: boolean;
  /** Why the last stored token was dropped, until a licence is installed (the account row explains it). */
  dropped: "expired" | "invalid" | null;
  /** The licence that ran out, while the page may still renew it (Free only). */
  lapsed: LapsedLicence | null;
  /** The backend is being asked for a renewed licence right now ("Renewing your licence…"). */
  renewing: boolean;
}

/** What the store needs from its surroundings (the browser's by default; the unit tests hand in their own). */
export interface EntitlementDeps {
  storage: () => Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  verify: (token: string) => Promise<LicenseCheck>;
  testMode: boolean;
  /** Where the focus and storage events come from (null: none, e.g. in Node). */
  events?: () => Pick<Window, "addEventListener" | "removeEventListener"> | null;
  /** The test-mode notice, once at start (console.info by default: the smoke test fails on console errors, not on info). */
  info?: (message: string) => void;
}

const freeState = (testMode: boolean, dropped: Entitlement["dropped"] = null, lapsed: LapsedLicence | null = null): Entitlement => ({
  status: "free",
  plan: null,
  provider: null,
  email: null,
  expiresAt: null,
  issuedAt: null,
  testMode,
  dropped,
  lapsed,
  renewing: false,
});

const lapsedFrom = (p: LicensePayload): LapsedLicence => ({ email: p.sub, plan: p.plan, provider: p.provider, expiresAt: licenseExpiresAtMs(p) });

/** A stored lapsed record, or null when it is not one. */
export function parseLapsed(raw: string | null): LapsedLicence | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof LapsedLicence, unknown>> | null;
    if (!v || typeof v !== "object" || typeof v.email !== "string" || !v.email.trim() || !isPlan(v.plan) || typeof v.expiresAt !== "number" || !Number.isFinite(v.expiresAt)) return null;
    return { email: v.email.trim().toLowerCase(), plan: v.plan, provider: isProvider(v.provider) ? v.provider : null, expiresAt: v.expiresAt };
  } catch {
    return null;
  }
}

export const TEST_MODE_NOTICE = "Licensing is in test mode – payments are not configured yet (no NEXT_PUBLIC_LICENSE_PUBLIC_KEY: licences are verified with the committed TEST key).";

type Waiter = { test: (state: Entitlement) => boolean; resolve: (state: Entitlement) => void };

export class EntitlementStore {
  private state: Entitlement;
  private readonly serverState: Entitlement;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private serial = 0;
  private renewingFlag = false;
  private waiters: Waiter[] = [];
  private detach: (() => void) | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: EntitlementDeps) {
    this.state = { ...freeState(deps.testMode), status: "checking" };
    this.serverState = this.state;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): Entitlement => this.state;
  /** The pre-rendered page's state: always "checking" (the static export knows no licence). */
  getServerSnapshot = (): Entitlement => this.serverState;

  private set(next: Entitlement) {
    this.state = next.renewing === this.renewingFlag ? next : { ...next, renewing: this.renewingFlag };
    this.scheduleExpiry();
    for (const l of this.listeners) l();
    if (this.waiters.length) {
      const due = this.waiters.filter((w) => w.test(this.state));
      this.waiters = this.waiters.filter((w) => !due.includes(w));
      for (const w of due) w.resolve(this.state);
    }
  }

  private waitFor(test: (state: Entitlement) => boolean): Promise<Entitlement> {
    if (test(this.state)) return Promise.resolve(this.state);
    return new Promise<Entitlement>((resolve) => this.waiters.push({ test, resolve }));
  }

  /** A licence that runs out while the page is open turns the page Free at its exp (checked again then). */
  private scheduleExpiry() {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    if (!this.started || this.state.status !== "pro" || this.state.expiresAt === null) return;
    const delay = this.state.expiresAt + CLOCK_SKEW_SEC * 1000 + 1000 - Date.now();
    if (delay > 0 && delay < 2 ** 31 - 1) this.expiryTimer = setTimeout(() => void this.refresh(), delay);
  }

  /** Starts listening (focus, storage) and checks the stored licence; idempotent. */
  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.deps.testMode) (this.deps.info ?? ((m: string) => console.info(m)))(TEST_MODE_NOTICE);
    const target = this.deps.events?.() ?? null;
    if (target) {
      const onFocus = () => void this.refresh();
      const onStorage = (e: Event) => {
        const key = (e as StorageEvent).key;
        if (key === null || key === LICENSE_STORAGE_KEY || key === LICENSE_LAPSED_STORAGE_KEY) void this.refresh();
      };
      target.addEventListener("focus", onFocus);
      target.addEventListener("storage", onStorage);
      this.detach = () => {
        target.removeEventListener("focus", onFocus);
        target.removeEventListener("storage", onStorage);
      };
    }
    void this.refresh();
  }

  /** Stops listening (tests; the page keeps its store for its lifetime). */
  stop(): void {
    this.detach?.();
    this.detach = null;
    this.started = false;
    this.scheduleExpiry();
  }

  private storage() {
    try {
      return this.deps.storage();
    } catch {
      return null;
    }
  }

  private read(key = LICENSE_STORAGE_KEY): string | null {
    try {
      return this.storage()?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  /** Removes the given keys (storage blocked: nothing to remove). */
  private removeKeys(...keys: string[]) {
    try {
      const storage = this.storage();
      for (const key of keys) storage?.removeItem(key);
    } catch {
      /* storage blocked */
    }
  }

  /** An expired licence: off the licence key, but its receipt stays and its email, plan and provider are kept for the renewal. */
  private lapse(lapsed: LapsedLicence) {
    try {
      const storage = this.storage();
      storage?.removeItem(LICENSE_STORAGE_KEY);
      storage?.setItem(LICENSE_LAPSED_STORAGE_KEY, JSON.stringify(lapsed));
    } catch {
      /* storage blocked: the page renews from this state while it is open */
    }
  }

  /** The raw licence token stored in this browser (for "Copy licence key" and the bot), null without one. */
  token(): string | null {
    return this.read();
  }

  /** The state a verification answer gives (and what to do with the stored token). */
  private apply(check: LicenseCheck): { next: Entitlement; drop: "none" | "lapse" | "all" } {
    const testMode = this.deps.testMode;
    if (check.ok) {
      const p = check.payload;
      return { next: { status: "pro", plan: p.plan, provider: p.provider, email: p.sub, expiresAt: licenseExpiresAtMs(p), issuedAt: p.iat ? p.iat * 1000 : null, testMode, dropped: null, lapsed: null, renewing: false }, drop: "none" };
    }
    // The site's own key cannot be used (a misconfigured build): keep the visitor's licence for a fixed build.
    if (check.error === "key") return { next: freeState(testMode, this.state.dropped, this.state.lapsed), drop: "none" };
    // Expired but genuine (its signature verified): its subscription may have renewed – keep what the renewal needs.
    if (check.error === "expired" && check.payload) return { next: freeState(testMode, "expired", lapsedFrom(check.payload)), drop: "lapse" };
    return { next: freeState(testMode, check.error === "expired" ? "expired" : "invalid"), drop: "all" };
  }

  /** Verifies the stored licence again; resolves with the state it settles in (the newest check wins a race). */
  async refresh(): Promise<Entitlement> {
    const id = ++this.serial;
    const token = this.read();
    if (!token) {
      if (id === this.serial) {
        // A licence that ran out earlier (this page or another) is still waiting for its renewal.
        const lapsed = parseLapsed(this.read(LICENSE_LAPSED_STORAGE_KEY));
        const next = freeState(this.deps.testMode, lapsed ? "expired" : this.state.dropped, lapsed);
        const same = this.state.status === "free" && this.state.dropped === next.dropped && JSON.stringify(this.state.lapsed) === JSON.stringify(next.lapsed);
        this.set(same ? this.state : next);
      }
      return this.state;
    }
    const check = await this.deps.verify(token).catch((): LicenseCheck => ({ ok: false, error: "key" }));
    if (id !== this.serial) return this.whenSettled();
    const { next, drop } = this.apply(check);
    // Another tab may have stored a new licence meanwhile: only the token that was checked is dropped.
    if (drop !== "none" && this.read() === token) {
      if (drop === "lapse" && next.lapsed) this.lapse(next.lapsed);
      else this.removeKeys(LICENSE_STORAGE_KEY, LICENSE_REF_STORAGE_KEY, LICENSE_LAPSED_STORAGE_KEY);
    }
    this.set(next);
    return next;
  }

  /** Verifies `token` and, when it is a valid licence, stores it (with the receipt reference it came with) and goes Pro. */
  async install(token: string, ref?: { provider: Provider; ref: string } | null): Promise<LicenseCheck> {
    const trimmed = String(token ?? "").trim();
    const check = await this.deps.verify(trimmed).catch((): LicenseCheck => ({ ok: false, error: "key" }));
    if (!check.ok) return check;
    try {
      const storage = this.storage();
      storage?.setItem(LICENSE_STORAGE_KEY, trimmed);
      // the receipt of this licence – a previous licence's receipt would renew the wrong purchase
      if (ref) storage?.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify(ref));
      else storage?.removeItem(LICENSE_REF_STORAGE_KEY);
      storage?.removeItem(LICENSE_LAPSED_STORAGE_KEY);
    } catch {
      /* storage blocked: the licence lasts as long as this page */
    }
    this.serial++;
    this.set(this.apply(check).next);
    return check;
  }

  /** Removes the licence from this browser ("Remove licence from this browser") – with its receipt and a lapsed licence. */
  clear(): void {
    this.removeKeys(LICENSE_STORAGE_KEY, LICENSE_REF_STORAGE_KEY, LICENSE_LAPSED_STORAGE_KEY);
    this.serial++;
    this.set(freeState(this.deps.testMode));
  }

  /**
   * Forgets the receipt and a lapsed licence: the backend said the subscription is no longer active, or does not know the
   * reference – asking again would never renew anything. A licence still stored stays (it runs until its exp).
   */
  forgetReceipt(): void {
    this.removeKeys(LICENSE_REF_STORAGE_KEY, LICENSE_LAPSED_STORAGE_KEY);
    if (this.state.lapsed) this.set({ ...this.state, lapsed: null });
  }

  /** Says that a renewal request is (or is no longer) in flight. */
  setRenewing(renewing: boolean): void {
    if (this.renewingFlag === renewing) return;
    this.renewingFlag = renewing;
    this.set(this.state);
  }

  /** Resolves once the store has an answer ("free" or "pro"); starts it when nobody has. */
  whenSettled(): Promise<Entitlement> {
    if (this.state.status !== "checking") return Promise.resolve(this.state);
    // Waiting first: without a stored licence the check answers at once, inside start().
    const settled = this.waitFor((s) => s.status !== "checking");
    this.start();
    return settled;
  }

  /** Resolves once the store has an answer and no renewal is in flight (what the guard waits for). */
  whenIdle(): Promise<Entitlement> {
    const idle = this.waitFor((s) => s.status !== "checking" && !s.renewing);
    if (this.state.status === "checking") this.start();
    return idle;
  }
}

export function createEntitlementStore(deps: EntitlementDeps): EntitlementStore {
  return new EntitlementStore(deps);
}

let store: EntitlementStore | null = null;

/** The page's store (one per tab), on the browser's localStorage and the build's public key. */
export function getEntitlementStore(): EntitlementStore {
  if (!store) {
    store = createEntitlementStore({
      storage: () => {
        try {
          return typeof localStorage !== "undefined" ? localStorage : null;
        } catch {
          return null;
        }
      },
      verify: (token) => verifyLicense(token, { publicKey: LICENSE_PUBLIC_KEY }),
      testMode: LICENSE_TEST_MODE,
      events: () => (typeof window !== "undefined" ? window : null),
    });
  }
  return store;
}

/** The entitlement of this browser, live; starts the store on mount. "checking" while the page pre-renders and hydrates. */
export function useEntitlement(): Entitlement {
  const s = getEntitlementStore();
  useEffect(() => s.start(), [s]);
  return useSyncExternalStore(s.subscribe, s.getSnapshot, s.getServerSnapshot);
}
