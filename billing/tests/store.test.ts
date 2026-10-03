import { describe, expect, it } from "vitest";
import { MemoryKV, Repo } from "../src/store";
import { NOW, seedCrypto, seedStripe } from "./helpers";

const DAY = 86400;

describe("the store's facts", () => {
  it("lists an e-mail's index across pages (cursors followed) and derives its entitlement", async () => {
    const kv = new MemoryKV(() => NOW, 2);
    const repo = new Repo(kv);
    await seedStripe(repo, { sub: "sub_1", session: "cs_1", periodEnd: NOW + 10 * DAY });
    await seedStripe(repo, { sub: "sub_2", session: "cs_2", customer: "cus_2", periodEnd: NOW + 40 * DAY });
    await seedCrypto(repo, { order: "o1", payment: "p1" });
    await seedCrypto(repo, { email: "someone@else.com", order: "o9", payment: "p9" });
    const page = await kv.list({ prefix: "idx:buyer@example.com:" });
    expect(page.list_complete).toBe(false); // three entries, two per page
    const facts = await repo.factsFor("Buyer@Example.com");
    expect(facts.subscriptions.map((s) => s.id).sort()).toEqual(["sub_1", "sub_2"]);
    expect(facts.grants.map((g) => g.orderId)).toEqual(["o1"]);
    const ent = await repo.entitlementFor("buyer@example.com");
    expect(ent).toMatchObject({ provider: "stripe", periodEnd: NOW + 40 * DAY });
    expect(ent!.refs).toEqual(expect.arrayContaining(["cs_1", "cs_2", "sub_1", "sub_2", "o1"]));
  });

  it("only ever moves a paid period later, keeps the newest state and the first end, and merges links", async () => {
    const repo = new Repo(new MemoryKV(() => NOW));
    await repo.recordPaid("stripe", "sub_1", { email: "a@b.co", periodEnd: NOW + 30 * DAY, plan: "monthly" });
    expect((await repo.recordPaid("stripe", "sub_1", { email: "a@b.co", periodEnd: NOW + 5 * DAY })).periodEnd).toBe(NOW + 30 * DAY);
    expect((await repo.getPaid("stripe", "sub_1"))!.periodEnd).toBe(NOW + 30 * DAY);
    await repo.recordState("stripe", "sub_1", { status: "cancel_at_period_end", at: NOW + 10 });
    await repo.recordState("stripe", "sub_1", { status: "active", at: NOW }); // an older event, delivered late
    await repo.recordEnded("stripe", "sub_1", NOW + 50);
    await repo.recordEnded("stripe", "sub_1", NOW + 90);
    const facts = await repo.getSubscriptionFacts("stripe", "sub_1");
    expect(facts.state).toEqual({ status: "cancel_at_period_end", at: NOW + 10 });
    expect(facts.ended).toEqual({ at: NOW + 50 });
    await repo.linkSubscription("paypal", "I-1", { email: "A@B.co", plan: "yearly", refs: ["ord-1"] });
    const link = await repo.linkSubscription("paypal", "I-1", { email: "a@b.co", refs: ["ord-2"] });
    expect(link).toEqual({ email: "a@b.co", plan: "yearly", refs: ["ord-1", "ord-2"] });
  });
});
