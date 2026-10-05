import { describe, expect, it } from "vitest";
import { LOOP_CAPTION_BASE_TAGS, hasMentionOrCta, loopCaption, loopCaptionContext, loopHashtags, loopHook, stripCallsToAction, stripMentions } from "@/lib/publish/loopCaption";
import { defaultSettings } from "@/lib/settings";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";

/*
 * --- loop-foundation --- The "Loop style" caption preset (lib/publish/loopCaption.ts): a lowercase hook led by a number and
 * ending in " 🔊", an optional fact paragraph, four or five hashtags starting #satisfying #oddlysatisfying – no mentions, no
 * call to action.
 */

describe("Loop style captions", () => {
  it("leads the hook with its number, lowercase, ending in one speaker", () => {
    expect(loopHook("{count}% Bigger Every Bounce until it fills the circle", 11)).toBe("11% bigger every bounce until it fills the circle 🔊");
    expect(loopHook("Bounces To Fill The Circle 🔊", 29)).toBe("29 bounces to fill the circle 🔊"); // (a hook without its number's place is led by it)
    expect(loopHook("{count} seconds of grow", 17.25)).toBe("17.3 seconds of grow 🔊");
    const hook = loopHook("{count} px bigger every bounce", 6);
    expect(hook).toMatch(/^\d/);
    expect(hook.endsWith(" 🔊")).toBe(true);
    expect(hook).toBe(hook.toLowerCase());
    expect([...hook.matchAll(/🔊/gu)]).toHaveLength(1);
  });

  it("drops mentions and calls to action", () => {
    expect(stripMentions("look @someone at this")).toBe("look at this");
    expect(stripCallsToAction("The ball grows. Follow for more! It fills the circle.")).toBe("The ball grows. It fills the circle.");
    expect(hasMentionOrCta("link in bio")).toBe(true);
    expect(hasMentionOrCta("it grows every bounce")).toBe(false);
    const c = loopCaption({ mode: "grow", hook: "{count}% bigger every bounce @friend", count: 11, fact: "It doubles every few bounces. Like and subscribe!" });
    expect(hasMentionOrCta(c.caption)).toBe(false);
    expect(hasMentionOrCta(c.title)).toBe(false);
  });

  it("starts the hashtags with #satisfying #oddlysatisfying and keeps four or five", () => {
    expect(LOOP_CAPTION_BASE_TAGS).toEqual(["#satisfying", "#oddlysatisfying"]);
    for (const mode of ["grow", "classic", "orbGrid", null] as const) {
      const tags = loopHashtags(mode);
      expect(tags.slice(0, 2)).toEqual(["#satisfying", "#oddlysatisfying"]);
      expect(tags.length).toBeGreaterThanOrEqual(4);
      expect(tags.length).toBeLessThanOrEqual(5);
      expect(new Set(tags.map((t) => t.toLowerCase())).size).toBe(tags.length);
      expect(tags.some((t) => /^#(fyp|foryou|reels|shorts)$/i.test(t))).toBe(false);
    }
    expect(loopHashtags("grow", ["#fyp", "#more", "#evenmore"])).toEqual(["#satisfying", "#oddlysatisfying", "#physics", "#bouncingball", "#exponentialgrowth"]);
  });

  it("writes the Grow post from the page's settings in every language (hook, fact paragraph, tags)", () => {
    const s = { ...defaultSettings("grow"), growLaw: "multiply" as const, growStep: 11 };
    const ctx = loopCaptionContext(s);
    expect(ctx).toEqual({ mode: "grow", hookKey: "growMultiply", factKey: "growMultiplyFact", count: 11 });
    expect(loopCaptionContext({ ...s, growLaw: "approach" }).count).toBe(s.growRate);
    expect(loopCaptionContext({ ...defaultSettings("classic"), recordingDuration: 30.4 })).toMatchObject({ hookKey: "seconds", count: 30 });
    for (const catalog of [en, pl, es] as Record<string, unknown>[]) {
      const words = catalog.LoopCaption as Record<string, string>;
      const post = loopCaption({ mode: "grow", hook: words[ctx.hookKey], count: ctx.count, fact: words[ctx.factKey] });
      const [hook, fact] = post.caption.split("\n\n");
      expect(hook).toMatch(/^11/);
      expect(hook.endsWith(" 🔊")).toBe(true);
      expect(hook).toBe(hook.toLowerCase());
      expect(fact).toContain("11");
      expect(post.hashtags.split(" ").slice(0, 2)).toEqual(["#satisfying", "#oddlysatisfying"]);
      expect(post.title).not.toContain("🔊");
    }
    expect(Object.keys(pl.LoopCaption).sort()).toEqual(Object.keys(en.LoopCaption).sort());
    expect(Object.keys(es.LoopCaption).sort()).toEqual(Object.keys(en.LoopCaption).sort());
    // without a fact the caption is the hook alone
    expect(loopCaption({ mode: "grow", hook: "{count} bounces", count: 9 }).caption).toBe("9 bounces 🔊");
  });
});
