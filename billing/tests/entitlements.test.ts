import { describe, expect, it } from "vitest";
import {
  addRef,
  cryptoPeriodEnd,
  isEntitled,
  newEntitlement,
  normalizeEmail,
  planDays,
} from "../src/entitlements";

const DAY = 86400;
const NOW = 1767225600;

describe("entitlement maths", () => {
  it("normalises e-mail", () => {
    expect(normalizeEmail("  Buyer@Example.COM ")).toBe("buyer@example.com");
  });

  it("knows the prepaid days of each plan", () => {
    expect(planDays("monthly")).toBe(30);
    expect(planDays("yearly")).toBe(365);
  });

  it("starts a crypto period from now when there is none", () => {
    expect(cryptoPeriodEnd(undefined, "monthly", NOW)).toBe(NOW + 30 * DAY);
    expect(cryptoPeriodEnd(0, "yearly", NOW)).toBe(NOW + 365 * DAY);
  });

  it("starts from now when the old period already lapsed", () => {
    const lapsed = NOW - 10 * DAY;
    expect(cryptoPeriodEnd(lapsed, "monthly", NOW)).toBe(NOW + 30 * DAY);
  });

  it("stacks a renewal on top of an unexpired period", () => {
    const future = NOW + 10 * DAY;
    expect(cryptoPeriodEnd(future, "monthly", NOW)).toBe(future + 30 * DAY);
    expect(cryptoPeriodEnd(future, "yearly", NOW)).toBe(future + 365 * DAY);
  });

  it("only entitles a record with a real paid period", () => {
    const ent = newEntitlement("a@b.com", "monthly", "stripe", NOW);
    expect(isEntitled(ent)).toBe(false); // periodEnd 0
    ent.periodEnd = NOW + DAY;
    expect(isEntitled(ent)).toBe(true);
    expect(isEntitled(null)).toBe(false);
  });

  it("adds refs without duplicating", () => {
    const ent = newEntitlement("a@b.com", "monthly", "stripe", NOW);
    addRef(ent, "r1");
    addRef(ent, "r1");
    addRef(ent, "r2");
    addRef(ent, undefined);
    expect(ent.refs).toEqual(["r1", "r2"]);
  });
});
