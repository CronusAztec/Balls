import { describe, expect, it } from "vitest";
import { SEED_PARAM, linkSeedOf, linkWithSeed, withLinkSeed } from "@/lib/runLink";
import { parseSeed } from "@/lib/recording/batch";
import { shareCodeUrl } from "@/lib/shareCode";

/*
 * --- run-link --- The seed a studio link carries while a run is pinned (lib/runLink.ts): the address bar and the copied
 * share link name it, so the link opens the same run, and lose it once the run is no longer pinned.
 */

describe("the seed a link carries", () => {
  it("is the pinned seed, never one during a split-screen race or a daily challenge", () => {
    expect(linkSeedOf({ pinned: 899165806, arenaCount: 1, daily: false })).toBe(899165806);
    expect(linkSeedOf({ pinned: 0, arenaCount: 1, daily: false })).toBe(0);
    expect(linkSeedOf({ pinned: -12, arenaCount: 1, daily: false })).toBe(-12);
    expect(linkSeedOf({ pinned: null, arenaCount: 1, daily: false })).toBeNull();
    expect(linkSeedOf({ pinned: 7, arenaCount: 2, daily: false })).toBeNull();
    expect(linkSeedOf({ pinned: 7, arenaCount: 1, daily: true })).toBeNull();
    expect(linkSeedOf({ pinned: Number.NaN, arenaCount: 1, daily: false })).toBeNull();
  });

  it("goes into the address with every other parameter kept, and comes out again", () => {
    expect(withLinkSeed("?mode=pendulum&bc=12", 7)).toBe("mode=pendulum&bc=12&seed=7");
    expect(withLinkSeed("mode=pendulum&seed=3&bc=12", 7)).toBe("mode=pendulum&seed=7&bc=12");
    expect(withLinkSeed("?mode=pendulum&seed=7&bc=12&utm_source=tiktok", null)).toBe("mode=pendulum&bc=12&utm_source=tiktok");
    expect(withLinkSeed("", null)).toBe("");
    expect(withLinkSeed("?daily=2026-11-21&mode=classic", 5)).toBe("daily=2026-11-21&mode=classic&seed=5");
    // what the page reads back on load is the same seed
    expect(parseSeed(new URLSearchParams(withLinkSeed("?mode=classic", 1655893239)).get(SEED_PARAM))).toBe(1655893239);
    expect(parseSeed(new URLSearchParams(withLinkSeed("?mode=classic", -42)).get(SEED_PARAM))).toBe(-42);
  });

  it("goes into a short share link and a long one, its path and hash untouched", () => {
    const short = shareCodeUrl("https://example.test/en/simulator/", "q1bKzU9JVbJSSs5JLC7OTFaqBQA");
    expect(linkWithSeed(short, 899165806)).toBe("https://example.test/en/simulator/?c=q1bKzU9JVbJSSs5JLC7OTFaqBQA&seed=899165806");
    expect(linkWithSeed(short, null)).toBe(short);
    expect(linkWithSeed("https://example.test/en/simulator/?mode=classic&seed=1#studio", 2)).toBe("https://example.test/en/simulator/?mode=classic&seed=2#studio");
    expect(linkWithSeed("https://example.test/en/simulator/?seed=1", null)).toBe("https://example.test/en/simulator/");
    expect(linkWithSeed("/pl/simulator/", 9)).toBe("/pl/simulator/?seed=9");
  });
});
