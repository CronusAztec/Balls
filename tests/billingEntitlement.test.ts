import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_LAPSED_STORAGE_KEY, LICENSE_REF_STORAGE_KEY, LICENSE_STORAGE_KEY, LICENSE_TEST_PUBLIC_KEY } from "@/lib/billing/config";
import { TEST_MODE_NOTICE, createEntitlementStore, parseLapsed, type Entitlement, type EntitlementDeps } from "@/lib/billing/entitlement";
import { checkEntitlement, isEntitlementRefusal, requireEntitlement, EntitlementRequiredError } from "@/lib/billing/guard";
import { gate, requestUnlock, subscribeUnlock, withEntitlement, type UnlockRequest } from "@/lib/billing/unlock";
import { verifyLicense } from "@/lib/billing/license";
import { VideoRecorder } from "@/lib/recording/recorder";
import { signForeignLicense, signTestLicense } from "../scripts/lib/test-license.mjs";

/*
 * --- paywall-gate --- The entitlement store (src/lib/billing/entitlement.ts): its transitions over a stored licence,
 * the focus and storage events, installing and removing a licence; and the guard (guard.ts) every video-creating action
 * asks, with the Unlock channel (unlock.ts) a refusal opens the dialog through.
 */

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => (this.data.has(k) ? (this.data.get(k) as string) : null);
  setItem = (k: string, v: string) => void this.data.set(k, String(v));
  removeItem = (k: string) => void this.data.delete(k);
}

class Events {
  handlers = new Map<string, Set<(e: Event) => void>>();
  addEventListener = (type: string, h: (e: Event) => void) => void (this.handlers.get(type) ?? this.handlers.set(type, new Set()).get(type)!).add(h);
  removeEventListener = (type: string, h: (e: Event) => void) => void this.handlers.get(type)?.delete(h);
  fire(type: string, init: Record<string, unknown> = {}) {
    for (const h of this.handlers.get(type) ?? []) h({ type, ...init } as unknown as Event);
  }
}

function setup(overrides: Partial<EntitlementDeps> = {}) {
  const storage = new MemoryStorage();
  const events = new Events();
  const info = vi.fn();
  const verify = vi.fn((token: string) => verifyLicense(token, { publicKey: LICENSE_TEST_PUBLIC_KEY }));
  const store = createEntitlementStore({ storage: () => storage, verify, testMode: true, events: () => events as unknown as Window, info, ...overrides });
  return { store, storage, events, info, verify };
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const settle = async (store: { whenSettled: () => Promise<Entitlement> }) => {
  await store.whenSettled();
  for (let i = 0; i < 5; i++) await flush();
};

describe("the entitlement store", () => {
  it("starts checking, then settles Free without a licence (and says test mode once, with console.info)", async () => {
    const { store, info } = setup();
    expect(store.getSnapshot().status).toBe("checking");
    expect(store.getServerSnapshot().status).toBe("checking");
    store.start();
    store.start();
    await settle(store);
    expect(store.getSnapshot()).toMatchObject({ status: "free", plan: null, email: null, testMode: true, dropped: null });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(TEST_MODE_NOTICE);
    expect(store.getServerSnapshot().status).toBe("checking");
  });

  it("goes Pro with a valid stored licence and tells its listeners", async () => {
    const { store, storage } = setup();
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense({ sub: "Pro@Example.com", plan: "monthly", provider: "crypto", days: 30 }));
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().status));
    store.start();
    await settle(store);
    const s = store.getSnapshot();
    expect(s).toMatchObject({ status: "pro", plan: "monthly", provider: "crypto", email: "pro@example.com", testMode: true, dropped: null });
    expect(s.expiresAt! - Date.now()).toBeGreaterThan(29 * 86400_000);
    expect(seen.at(-1)).toBe("pro");
  });

  it("drops an expired licence but keeps what its renewal needs: the receipt and the licence's email, plan and provider", async () => {
    const { store, storage } = setup();
    const exp = Math.floor(Date.now() / 1000) - 86400;
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense({ sub: "Buyer@Example.com", plan: "monthly", provider: "stripe", exp }));
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify({ provider: "stripe", ref: "cs_1" }));
    store.start();
    await settle(store);
    const lapsed = { email: "buyer@example.com", plan: "monthly", provider: "stripe", expiresAt: exp * 1000 };
    expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: "expired", lapsed, renewing: false });
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(LICENSE_REF_STORAGE_KEY)!)).toEqual({ provider: "stripe", ref: "cs_1" });
    expect(parseLapsed(storage.getItem(LICENSE_LAPSED_STORAGE_KEY))).toEqual(lapsed);
    // the next page load (a new store over the same storage) still knows the lapsed licence
    const again = createEntitlementStore({ storage: () => storage, verify: (t) => verifyLicense(t, { publicKey: LICENSE_TEST_PUBLIC_KEY }), testMode: true, info: () => {} });
    again.start();
    await settle(again);
    expect(again.getSnapshot()).toMatchObject({ status: "free", dropped: "expired", lapsed });
    // the backend said the subscription is over: the receipt and the lapsed licence are forgotten, the reason stays
    again.forgetReceipt();
    expect(again.getSnapshot()).toMatchObject({ status: "free", dropped: "expired", lapsed: null });
    expect(storage.getItem(LICENSE_REF_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LICENSE_LAPSED_STORAGE_KEY)).toBeNull();
  });

  it("drops a licence signed with another key, or garbage, as invalid – with its receipt and any lapsed licence", async () => {
    for (const token of [signForeignLicense(), "not.a.licence", "garbage"]) {
      const { store, storage } = setup();
      storage.setItem(LICENSE_STORAGE_KEY, token);
      storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify({ provider: "stripe", ref: "cs_1" }));
      storage.setItem(LICENSE_LAPSED_STORAGE_KEY, JSON.stringify({ email: "a@b.co", plan: "monthly", provider: "stripe", expiresAt: 1 }));
      store.start();
      await settle(store);
      expect(store.getSnapshot(), token).toMatchObject({ status: "free", dropped: "invalid", lapsed: null });
      expect(storage.getItem(LICENSE_STORAGE_KEY)).toBeNull();
      expect(storage.getItem(LICENSE_REF_STORAGE_KEY)).toBeNull();
      expect(storage.getItem(LICENSE_LAPSED_STORAGE_KEY)).toBeNull();
    }
  });

  it("reads only a well-formed lapsed record", () => {
    expect(parseLapsed(null)).toBeNull();
    expect(parseLapsed("{bad")).toBeNull();
    expect(parseLapsed(JSON.stringify({ email: "a@b.co", plan: "weekly", expiresAt: 1 }))).toBeNull();
    expect(parseLapsed(JSON.stringify({ email: " A@B.co ", plan: "yearly", provider: "nope", expiresAt: 5 }))).toEqual({ email: "a@b.co", plan: "yearly", provider: null, expiresAt: 5 });
  });

  it("installing a licence ends a lapse; removing it forgets everything", async () => {
    const { store, storage } = setup();
    storage.setItem(LICENSE_REF_STORAGE_KEY, JSON.stringify({ provider: "paypal", ref: "I-1" }));
    storage.setItem(LICENSE_LAPSED_STORAGE_KEY, JSON.stringify({ email: "a@b.co", plan: "monthly", provider: "paypal", expiresAt: 1 }));
    store.start();
    await settle(store);
    expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: "expired", lapsed: { email: "a@b.co" } });
    expect((await store.install(signTestLicense({ sub: "a@b.co", provider: "paypal" }), { provider: "paypal", ref: "I-1" })).ok).toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "pro", dropped: null, lapsed: null });
    expect(storage.getItem(LICENSE_LAPSED_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(LICENSE_REF_STORAGE_KEY)).not.toBeNull();
    storage.setItem(LICENSE_LAPSED_STORAGE_KEY, JSON.stringify({ email: "a@b.co", plan: "monthly", provider: "paypal", expiresAt: 1 }));
    store.clear();
    expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: null, lapsed: null });
    for (const key of [LICENSE_STORAGE_KEY, LICENSE_REF_STORAGE_KEY, LICENSE_LAPSED_STORAGE_KEY]) expect(storage.getItem(key)).toBeNull();
  });

  it("says when a renewal is in flight, through every state change, and lets the guard wait for it", async () => {
    const { store, storage } = setup();
    store.start();
    await settle(store);
    store.setRenewing(true);
    expect(store.getSnapshot().renewing).toBe(true);
    const decision = requireEntitlement("record", { store });
    await flush();
    // a renewed licence arrives while the renewal is still running: the flag stays until it is over
    await store.install(signTestLicense());
    expect(store.getSnapshot()).toMatchObject({ status: "pro", renewing: true });
    store.setRenewing(false);
    await expect(decision).resolves.toMatchObject({ ok: true, feature: "record" });
    expect(store.getSnapshot().renewing).toBe(false);
    // and without one the guard gives up after its timeout
    store.clear();
    store.setRenewing(true);
    await expect(requireEntitlement("record", { store, timeoutMs: 20 })).resolves.toMatchObject({ ok: false, reason: "free" });
    store.setRenewing(false);
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBeNull();
  });

  it("keeps the licence when the site's own key cannot be used (a misconfigured build)", async () => {
    const token = signTestLicense();
    const { store, storage } = setup({ verify: (t) => verifyLicense(t, { publicKey: "broken" }) });
    storage.setItem(LICENSE_STORAGE_KEY, token);
    store.start();
    await settle(store);
    expect(store.getSnapshot().status).toBe("free");
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBe(token);
  });

  it("checks again on the window's focus and on another tab's change (the storage event)", async () => {
    const { store, storage, events, verify } = setup();
    store.start();
    await settle(store);
    expect(store.getSnapshot().status).toBe("free");
    // another tab claimed a licence
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense());
    events.fire("storage", { key: "something-else" });
    await settle(store);
    expect(store.getSnapshot().status).toBe("free");
    events.fire("storage", { key: LICENSE_STORAGE_KEY });
    await settle(store);
    expect(store.getSnapshot().status).toBe("pro");
    // and removed it again; this tab notices on the focus
    storage.removeItem(LICENSE_STORAGE_KEY);
    const calls = verify.mock.calls.length;
    events.fire("focus");
    await settle(store);
    expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: null });
    expect(verify.mock.calls.length).toBe(calls); // nothing to verify
    store.stop();
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense());
    events.fire("focus");
    await settle(store);
    expect(store.getSnapshot().status).toBe("free"); // stopped: no listeners left
  });

  it("keeps the last answer on show while it checks again (no flicker on focus)", async () => {
    const { store, storage, events } = setup();
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense());
    store.start();
    await settle(store);
    const seen: string[] = [];
    store.subscribe(() => seen.push(store.getSnapshot().status));
    events.fire("focus");
    await settle(store);
    expect(seen.every((s) => s === "pro")).toBe(true);
  });

  it("installs a valid licence (with its receipt reference) and refuses an invalid one without storing it", async () => {
    const { store, storage } = setup();
    store.start();
    await settle(store);
    const bad = await store.install(signForeignLicense());
    expect(bad).toEqual({ ok: false, error: "signature" });
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBeNull();
    expect(store.getSnapshot().status).toBe("free");
    const token = signTestLicense({ plan: "yearly", provider: "stripe" });
    const good = await store.install(`  ${token}\n`, { provider: "stripe", ref: "cs_test_1" });
    expect(good.ok).toBe(true);
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBe(token);
    expect(JSON.parse(storage.getItem(LICENSE_REF_STORAGE_KEY)!)).toEqual({ provider: "stripe", ref: "cs_test_1" });
    expect(store.getSnapshot()).toMatchObject({ status: "pro", plan: "yearly", dropped: null });
    expect(store.token()).toBe(token);
    // a licence installed without a receipt (a pasted key) drops the previous one's receipt: it would renew the wrong purchase
    const pasted = signTestLicense({ plan: "monthly", provider: "paypal" });
    expect((await store.install(pasted)).ok).toBe(true);
    expect(storage.getItem(LICENSE_REF_STORAGE_KEY)).toBeNull();
    expect(store.getSnapshot()).toMatchObject({ status: "pro", plan: "monthly", provider: "paypal" });
    store.clear();
    expect(store.getSnapshot()).toMatchObject({ status: "free", dropped: null });
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBeNull();
    expect(store.token()).toBeNull();
  });

  it("lets the newest check win a race", async () => {
    const hold: { release?: () => void } = {};
    const slow = signTestLicense({ plan: "monthly" });
    const { store, storage } = setup({
      verify: async (t) => {
        if (t === slow) await new Promise<void>((r) => (hold.release = r));
        return verifyLicense(t, { publicKey: LICENSE_TEST_PUBLIC_KEY });
      },
    });
    storage.setItem(LICENSE_STORAGE_KEY, slow);
    const first = store.refresh();
    await flush();
    const yearly = signTestLicense({ plan: "yearly" });
    await store.install(yearly);
    hold.release?.();
    await first;
    expect(store.getSnapshot()).toMatchObject({ status: "pro", plan: "yearly" });
    expect(storage.getItem(LICENSE_STORAGE_KEY)).toBe(yearly);
  });

  it("works without storage or events (Node, a blocked localStorage)", async () => {
    const store = createEntitlementStore({ storage: () => null, verify: async () => ({ ok: false, error: "malformed" }), testMode: false, info: () => {} });
    store.start();
    await settle(store);
    expect(store.getSnapshot()).toMatchObject({ status: "free", testMode: false });
    expect((await store.install(signTestLicense())).ok).toBe(false);
  });
});

describe("the guard", () => {
  const pro = (over: Partial<Entitlement> = {}): Entitlement => ({ status: "pro", plan: "yearly", provider: "stripe", email: "a@b.co", expiresAt: Date.now() + 86400_000, issuedAt: null, testMode: true, dropped: null, lapsed: null, renewing: false, ...over });

  it("grants a Pro licence and refuses Free, unverified and expired ones with a typed refusal", () => {
    const now = Date.now();
    expect(checkEntitlement("record", pro(), now)).toMatchObject({ ok: true, feature: "record", plan: "yearly" });
    expect(checkEntitlement("fastExport", { ...pro(), status: "free", plan: null, expiresAt: null }, now)).toEqual({ ok: false, feature: "fastExport", reason: "free" });
    expect(checkEntitlement("batch", { ...pro(), status: "checking" }, now)).toEqual({ ok: false, feature: "batch", reason: "unverified" });
    expect(checkEntitlement("bot", pro({ expiresAt: now - 61_000 }), now)).toEqual({ ok: false, feature: "bot", reason: "expired" });
    expect(checkEntitlement("bot", pro({ expiresAt: now - 59_000 }), now).ok).toBe(true);
    expect(isEntitlementRefusal({ ok: false, feature: "publish", reason: "free" })).toBe(true);
    expect(isEntitlementRefusal({ ok: false, feature: "nope", reason: "free" })).toBe(false);
    expect(new EntitlementRequiredError({ ok: false, feature: "download", reason: "free" }).refusal.feature).toBe("download");
  });

  it("waits for a licence check in flight before it decides, and gives up after its timeout", async () => {
    const { store, storage } = setup();
    storage.setItem(LICENSE_STORAGE_KEY, signTestLicense());
    expect(store.getSnapshot().status).toBe("checking");
    await expect(requireEntitlement("record", { store })).resolves.toMatchObject({ ok: true, feature: "record" });
    const stuck = createEntitlementStore({ storage: () => storage, verify: () => new Promise(() => {}), testMode: true, info: () => {} });
    await expect(requireEntitlement("renderQueue", { store: stuck, timeoutMs: 20 })).resolves.toEqual({ ok: false, feature: "renderQueue", reason: "unverified" });
    const free = setup().store;
    await expect(requireEntitlement("publish", { store: free })).resolves.toEqual({ ok: false, feature: "publish", reason: "free" });
  });
});

describe("the Unlock channel and the guarded entry points", () => {
  afterEach(() => vi.restoreAllMocks());
  beforeEach(() => void vi.spyOn(console, "info").mockImplementation(() => {})); // the page's store says "test mode" once

  it("opens the dialog for a refusal (the page's store is Free in Node: no localStorage) and runs nothing", async () => {
    const requests: UnlockRequest[] = [];
    const off = subscribeUnlock((r) => requests.push(r));
    const action = vi.fn();
    await expect(withEntitlement("record", action)).resolves.toBe(false);
    expect(action).not.toHaveBeenCalled();
    expect(gate("download")).toBe(false);
    requestUnlock();
    off();
    requestUnlock();
    expect(requests.map((r) => [r.feature, r.reason])).toEqual([
      ["record", "free"],
      ["download", "free"],
      [null, null],
    ]);
    expect(requests[2].serial).toBeGreaterThan(requests[1].serial);
  });

  it("the recorder refuses to start without a licence – a call around the page meets the guard – and says why", async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = { MediaRecorder: g.MediaRecorder, document: g.document };
    const created = vi.fn();
    g.MediaRecorder = Object.assign(
      class {
        constructor() {
          created();
        }
      },
      { isTypeSupported: () => true },
    );
    g.document = { createElement: () => ({ getContext: () => ({}), captureStream: () => ({ getVideoTracks: () => [] }) }) };
    try {
      const recorder = new VideoRecorder({ width: 1080, height: 1920 } as unknown as HTMLCanvasElement);
      await expect(recorder.startRecording({ resolution: { width: 1080, height: 1920 } })).resolves.toBe(false);
      expect(created).not.toHaveBeenCalled();
      expect(recorder.isRecording()).toBe(false);
      expect(recorder.lastRefusal()).toEqual({ ok: false, feature: "record", reason: "free" });
    } finally {
      Object.assign(g, saved);
    }
  });
});
