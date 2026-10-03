// Storage.
//
// Everything persists in one Cloudflare KV namespace (binding ENTITLEMENTS). The Worker only ever
// touches KV through the tiny `KV` interface below, so the tests swap in an in-memory map and never
// need a real namespace. `Repo` owns the key shapes and the (de)serialisation.
//
// KV has no transactions: two writers of one key at once keep only the last write. So every fact a
// webhook (or a claim) learns lives under its own key, written by one kind of event only, and nothing
// is a record that several events rewrite (see entitlements.ts):
//
//   sub:<stripe|paypal>:<subscription id>:link    who bought it (e-mail, plan, Stripe customer, refs)
//   sub:<stripe|paypal>:<subscription id>:paid    how far it is paid (only ever moves later)
//   sub:<stripe|paypal>:<subscription id>:state   its latest status (the newest event wins)
//   sub:stripe:<subscription id>:ended            when Stripe deleted it (the first answer stays)
//   grant:crypto:<payment id | order-<order id>>  one crypto payment's prepaid days (once per payment)
//   idx:<e-mail>:<stripe|paypal|crypto>:<id>      the e-mail's index: one key per subscription or grant,
//                                                 found by listing the prefix (distinct keys never
//                                                 overwrite each other, so the index is append-only)
//   order:crypto:<order id> · order:paypal:<order id>   the orders the checkouts created
//   event:<provider>:<id>                          webhook idempotency (expires after 30 days)

import { addRef, deriveEntitlement, normalizeEmail } from "./entitlements";
import type {
  CryptoGrant,
  Entitlement,
  Facts,
  Plan,
  SubscriptionEnded,
  SubscriptionFacts,
  SubscriptionLink,
  SubscriptionPaid,
  SubscriptionProvider,
  SubscriptionState,
} from "./entitlements";

/** One page of a KV key listing. */
export interface KVListPage {
  keys: { name: string }[];
  list_complete: boolean;
  cursor?: string;
}

/** The slice of Cloudflare's KVNamespace this Worker uses. A real KVNamespace satisfies it. */
export interface KV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; cursor?: string }): Promise<KVListPage>;
}

/** An in-memory KV for tests and `wrangler dev` smoke runs. Honours TTLs against an injectable clock. */
export class MemoryKV implements KV {
  private map = new Map<string, { value: string; expiresAt?: number }>();
  constructor(
    private now: () => number = () => Date.now() / 1000,
    /** Keys per list page (KV's own default is 1000; the tests use a small one to follow cursors). */
    private pageSize = 1000,
  ) {}

  private alive(key: string): boolean {
    const entry = this.map.get(key);
    if (!entry) return false;
    if (entry.expiresAt !== undefined && entry.expiresAt <= this.now()) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  async get(key: string): Promise<string | null> {
    return this.alive(key) ? this.map.get(key)!.value : null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    const expiresAt =
      options?.expirationTtl !== undefined ? this.now() + options.expirationTtl : undefined;
    this.map.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list(options: { prefix: string; cursor?: string }): Promise<KVListPage> {
    const names = [...this.map.keys()].filter((k) => k.startsWith(options.prefix) && this.alive(k)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = names.slice(start, start + this.pageSize);
    const next = start + page.length;
    const keys = page.map((name) => ({ name }));
    return next < names.length ? { keys, list_complete: false, cursor: String(next) } : { keys, list_complete: true };
  }
}

/** A pending or settled crypto order (NOWPayments has no subscriptions, so we track each invoice). */
export interface CryptoOrder {
  email: string;
  plan: Plan;
  /** Informational: what the last IPN said (the grants themselves are separate facts). */
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

type SubFact = "link" | "paid" | "state" | "ended";

/** Typed access to the entitlement store. All key shapes live here and nowhere else. */
export class Repo {
  constructor(private kv: KV) {}

  private subKey(provider: SubscriptionProvider, id: string, fact: SubFact): string {
    return `sub:${provider}:${id}:${fact}`;
  }

  private indexPrefix(email: string): string {
    return `idx:${normalizeEmail(email)}:`;
  }

  /** Add a subscription or a crypto grant to the e-mail's index (its own key: an idempotent write). */
  private async index(email: string, kind: SubscriptionProvider | "crypto", id: string): Promise<void> {
    await this.kv.put(`${this.indexPrefix(email)}${kind}:${id}`, "1");
  }

  // --- subscriptions ---------------------------------------------------------------------------

  async getLink(provider: SubscriptionProvider, id: string): Promise<SubscriptionLink | null> {
    return this.readJson<SubscriptionLink>(this.subKey(provider, id, "link"));
  }

  /**
   * Record who bought a subscription, merged with what is stored (the references add up; a known
   * customer or plan is kept). The checkout webhook and the claim write the same facts, so a race of
   * the two loses nothing. Returns what was written.
   */
  async linkSubscription(provider: SubscriptionProvider, id: string, link: SubscriptionLink): Promise<SubscriptionLink> {
    const stored = await this.getLink(provider, id);
    const email = normalizeEmail(stored?.email ?? link.email);
    const refs = [...(stored?.refs ?? [])];
    for (const ref of link.refs) addRef(refs, ref);
    const merged: SubscriptionLink = { email, refs };
    const plan = link.plan ?? stored?.plan;
    const customerId = link.customerId ?? stored?.customerId;
    if (plan) merged.plan = plan;
    if (customerId) merged.customerId = customerId;
    await this.kv.put(this.subKey(provider, id, "link"), JSON.stringify(merged));
    await this.index(email, provider, id);
    return merged;
  }

  async getPaid(provider: SubscriptionProvider, id: string): Promise<SubscriptionPaid | null> {
    return this.readJson<SubscriptionPaid>(this.subKey(provider, id, "paid"));
  }

  /** Record how far a subscription is paid; an older period never replaces a later one. Returns the stored fact. */
  async recordPaid(provider: SubscriptionProvider, id: string, paid: SubscriptionPaid): Promise<SubscriptionPaid> {
    const stored = await this.getPaid(provider, id);
    const email = normalizeEmail(paid.email);
    await this.index(email, provider, id);
    if (stored && stored.periodEnd >= paid.periodEnd) return stored;
    const next: SubscriptionPaid = { email, periodEnd: paid.periodEnd };
    const plan = paid.plan ?? stored?.plan;
    if (plan) next.plan = plan;
    await this.kv.put(this.subKey(provider, id, "paid"), JSON.stringify(next));
    return next;
  }

  /** Record a subscription's status; an event older than the stored one is ignored. */
  async recordState(provider: SubscriptionProvider, id: string, state: SubscriptionState): Promise<void> {
    const stored = await this.readJson<SubscriptionState>(this.subKey(provider, id, "state"));
    if (stored && stored.at > state.at) return;
    await this.kv.put(this.subKey(provider, id, "state"), JSON.stringify(state));
  }

  /** Record that a subscription was deleted (its access ends there); the first answer stays. */
  async recordEnded(provider: SubscriptionProvider, id: string, at: number): Promise<void> {
    const stored = await this.readJson<SubscriptionEnded>(this.subKey(provider, id, "ended"));
    if (stored && stored.at <= at) return;
    await this.kv.put(this.subKey(provider, id, "ended"), JSON.stringify({ at }));
  }

  /** Everything stored about one subscription. */
  async getSubscriptionFacts(provider: SubscriptionProvider, id: string): Promise<SubscriptionFacts> {
    const [link, paid, state, ended] = await Promise.all([
      this.getLink(provider, id),
      this.getPaid(provider, id),
      this.readJson<SubscriptionState>(this.subKey(provider, id, "state")),
      this.readJson<SubscriptionEnded>(this.subKey(provider, id, "ended")),
    ]);
    return { provider, id, link, paid, state, ended };
  }

  // --- crypto ----------------------------------------------------------------------------------

  async getCryptoGrant(id: string): Promise<CryptoGrant | null> {
    return this.readJson<CryptoGrant>(`grant:crypto:${id}`);
  }

  async putCryptoGrant(id: string, grant: CryptoGrant): Promise<void> {
    await this.kv.put(`grant:crypto:${id}`, JSON.stringify(grant));
    await this.index(grant.email, "crypto", id);
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

  // --- an e-mail's facts -----------------------------------------------------------------------

  /** Every subscription and crypto grant the e-mail's index names, with their facts. */
  async factsFor(email: string): Promise<Facts> {
    const prefix = this.indexPrefix(email);
    const names: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await this.kv.list({ prefix, cursor });
      for (const key of page.keys) names.push(key.name);
      if (page.list_complete || !page.cursor) break;
      cursor = page.cursor;
    }
    const subscriptions: Promise<SubscriptionFacts>[] = [];
    const grants: Promise<CryptoGrant | null>[] = [];
    for (const name of names) {
      const rest = name.slice(prefix.length);
      const sep = rest.indexOf(":");
      const kind = rest.slice(0, sep);
      const id = rest.slice(sep + 1);
      if (sep <= 0 || !id) continue;
      if (kind === "stripe" || kind === "paypal") subscriptions.push(this.getSubscriptionFacts(kind, id));
      else if (kind === "crypto") grants.push(this.getCryptoGrant(id));
    }
    return {
      subscriptions: await Promise.all(subscriptions),
      grants: (await Promise.all(grants)).filter((g): g is CryptoGrant => !!g),
    };
  }

  /** What the e-mail is entitled to, derived from its facts (null: nothing at all). */
  async entitlementFor(email: string): Promise<Entitlement | null> {
    return deriveEntitlement(email, await this.factsFor(email));
  }

  // --- webhook idempotency ---------------------------------------------------------------------

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

/** Put one subscription's facts into an e-mail's facts (replacing what was read for it). */
export function withSubscription(facts: Facts, sub: SubscriptionFacts): Facts {
  return {
    subscriptions: [...facts.subscriptions.filter((s) => !(s.provider === sub.provider && s.id === sub.id)), sub],
    grants: facts.grants,
  };
}
