import { describe, expect, it } from "vitest";
import { AUTONOMY_CREATES_PER_HOUR, AUTONOMY_SPACING_MS } from "@/lib/desktop/autonomy";
import { CHANNEL_COOLDOWN_MS, CREATE_CALLS_PER_HOUR } from "../src/social/audit";

/*
 * --- autonomy --- Fully autonomous (lib/desktop/autonomy.ts, the learner plan's C11) plans its posts inside the app's own
 * posting guards (src/social/audit.ts, which src/social/posting.ts enforces at every create): one post per account every 20
 * minutes, under 60 create calls an hour from one key. The page's pure file cannot import the app's code, so it holds the
 * same two numbers, and this test keeps them equal: with a wider cooldown here, the approver would plan posts that
 * posting.ts then refuses, and Fully autonomous would pause on its own refused post.
 */

// --- autonomy ---

describe("Fully autonomous plans inside the app's posting guards", () => {
  it("spaces an account's posts by the channel's cooldown and stays under the same create calls an hour", () => {
    expect(AUTONOMY_SPACING_MS).toBe(CHANNEL_COOLDOWN_MS);
    expect(AUTONOMY_CREATES_PER_HOUR).toBe(CREATE_CALLS_PER_HOUR);
  });
});

// --- end autonomy ---
