// Storage.
//
// Everything persists in one Cloudflare KV namespace (binding ENTITLEMENTS). The Worker only ever
// touches KV through the tiny `KV` interface below, so the tests swap in an in-memory map and never
// need a real namespace. `Repo` owns the key shapes and the (de)serialisation.

import { normalizeEmail } from "./entitlements";
import type { Entitlement, Plan, Provider } from "./entitlements";

/** The slice of Cloudflare's KVNamespace this Worker uses. A real KVNamespace satisfies it. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** An in-memory KV for tests and `wrangler dev` smoke runs. Honours TTLs against an injectable clock. */
export class MemoryKV implements KV {
  private map = new Map<string, { value: string; expiresAt?: number }>();
  constructor(private now: () => number = () => Date.now() / 1000) {}

  async get(key: string): Promise<string | null> {
    const entry = this.map.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return null;
    }
    return entry.value;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt =
      options?.expirationTtl !== undefined ? this.now() + options.expirationTtl : undefined;
    this.map.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

/** A pending or settled crypto order (NOWPayments has no subscriptions, so we track each invoice). */
export interface CryptoOrder {
  email: string;
  plan: Plan;
  status: "pending" | "granted" | "partially_paid" | "failed" | "refunded" | "expired";
  paymentIds: string[];
}

/** What we remember about a PayPal subscription we created, keyed by our own order id. */
export interface PaypalOrder {
  subscriptionId: string;
}

// 30 days: long enough that no provider resends an event we would re-process, short enough that the
// idempotency keys do not pile up for ever.
const EVENT_TTL_SECONDS = 30 * 86400;

/** Typed access to the entitlement store. All key shapes live here and nowhere else. */
export class Repo {
  constructor(private kv: KV) {}

  private userKey(email: string): string {
    return `user:${normalizeEmail(email)}`;
  }

  async getUser(email: string): Promise<Entitlement | null> {
    return this.readJson<Entitlement>(this.userKey(email));
  }

  async putUser(entitlement: Entitlement): Promise<void> {
    await this.kv.put(this.userKey(entitlement.email), JSON.stringify(entitlement));
  }

  /** Map a provider reference (session / subscription / order id) to the e-mail that owns it. */
  async getRefEmail(provider: Provider, id: string): Promise<string | null> {
    return this.kv.get(`ref:${provider}:${id}`);
  }

  async putRef(provider: Provider, id: string, email: string): Promise<void> {
    await this.kv.put(`ref:${provider}:${id}`, normalizeEmail(email));
  }

  /**
   * Mark a provider event as handled. Returns true the first time (caller should process it) and
   * false if it was already seen, so every webhook handler is idempotent. The key expires after a
   * month.
   */
  async markEventSeen(provider: string, id: string): Promise<boolean> {
    const key = `event:${provider}:${id}`;
    if (await this.kv.get(key)) return false;
    await this.kv.put(key, "1", { expirationTtl: EVENT_TTL_SECONDS });
    return true;
  }

  /**
   * Release an idempotency key so the provider's retry can process the event again. Called when
   * processing failed after the event was marked seen, so a transient error does not lose the event.
   */
  async forgetEvent(provider: string, id: string): Promise<void> {
    await this.kv.delete(`event:${provider}:${id}`);
  }

  async getCryptoOrder(id: string): Promise<CryptoOrder | null> {
    return this.readJson<CryptoOrder>(`order:crypto:${id}`);
  }

  async putCryptoOrder(id: string, order: CryptoOrder): Promise<void> {
    await this.kv.put(`order:crypto:${id}`, JSON.stringify(order));
  }

  async getPaypalOrder(id: string): Promise<PaypalOrder | null> {
    return this.readJson<PaypalOrder>(`order:paypal:${id}`);
  }

  async putPaypalOrder(id: string, order: PaypalOrder): Promise<void> {
    await this.kv.put(`order:paypal:${id}`, JSON.stringify(order));
  }

  private async readJson<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}
