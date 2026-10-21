import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { LOOP_CAPTION_BASE_TAGS, clipLoopCaptionContext, hasMentionOrCta, loopCaption, loopCaptionContext, loopHashtags, loopHook, stripCallsToAction, stripMentions } from "@/lib/publish/loopCaption";
import { offerPublishClip } from "@/lib/publish/clips"; // --- low-findings ---
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

// --- low-findings --- the Loop style caption follows the clip (its run's mode and numbers), not the page's settings of the moment
describe("--- low-findings --- a clip's loop-style words", () => {
  const growMultiply = { ...defaultSettings("grow"), growLaw: "multiply" as const, growStep: 11, recordingDuration: 40 };
  const growAdd = { ...defaultSettings("grow"), growLaw: "add" as const, growStep: 3, recordingDuration: 25 };
  const classic = { ...defaultSettings("classic"), recordingDuration: 20 };

  it("keeps the words of the run a clip was made of when the page has moved on", () => {
    // a Classic recording, the page since switched to Grow multiply: no "11 % bigger every bounce" for a Classic clip
    const classicClip = { mode: "classic", durationSec: 21.4, loopCaption: loopCaptionContext(classic) };
    expect(clipLoopCaptionContext(classicClip, loopCaptionContext(growMultiply))).toEqual({ mode: "classic", hookKey: "seconds", factKey: "", count: 21 });
    // a Grow multiply clip, the page now on Grow add 3 px: still 11 % a bounce, with its fact
    const growClip = { mode: "grow", durationSec: 38.53, loopCaption: loopCaptionContext(growMultiply) };
    expect(clipLoopCaptionContext(growClip, loopCaptionContext(growAdd))).toEqual({ mode: "grow", hookKey: "growMultiply", factKey: "growMultiplyFact", count: 11 });
  });

  it("counts a clip's own seconds, never the page's clip length of the moment", () => {
    const fast = { mode: "classic", durationSec: 38.53, loopCaption: loopCaptionContext({ ...classic, recordingDuration: 40 }) };
    expect(clipLoopCaptionContext(fast, loopCaptionContext({ ...classic, recordingDuration: 90 })).count).toBe(39);
    // a recording whose length is not read yet: the seconds it was made with
    expect(clipLoopCaptionContext({ ...fast, durationSec: null }, loopCaptionContext({ ...classic, recordingDuration: 90 })).count).toBe(40);
  });

  it("without words of its own: the page's for a clip of its mode or of no known mode, else that mode's seconds", () => {
    const page = loopCaptionContext(growMultiply);
    expect(clipLoopCaptionContext({ mode: null, durationSec: null }, page)).toEqual(page);
    expect(clipLoopCaptionContext({ mode: "grow", durationSec: 12, loopCaption: null }, page)).toEqual(page);
    expect(clipLoopCaptionContext({ mode: "hoops", durationSec: 14.6, loopCaption: null }, page)).toEqual({ mode: "hoops", hookKey: "seconds", factKey: "", count: 15 });
    expect(clipLoopCaptionContext({ mode: "nope", durationSec: 9, loopCaption: null }, page)).toEqual(page);
  });

  it("is taken when the page offers the clip to the Publish block", () => {
    const clip = offerPublishClip({ blob: new Blob(["x"], { type: "video/mp4" }), name: "c.mp4", source: "fast", durationSec: 38.53, mode: "grow", seed: 1, loopCaption: loopCaptionContext(growMultiply) });
    expect(clip.loopCaption).toEqual(loopCaptionContext(growMultiply));
    expect(offerPublishClip({ blob: new Blob(["x"], { type: "video/mp4" }), name: "d.mp4", source: "file" }).loopCaption).toBeNull();
  });

  // a cut from the Publish block ("Edit for TikTok") is the same run: it keeps the source clip's bot copy and loop words
  it("goes with a cut made from a Publish clip, with the viral bot's clip id", () => {
    const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const read = (f: string) => strip(fs.readFileSync(path.join(__dirname, "..", f), "utf8"));
    const publish = read("src/components/simulator/sections/PublishSection.tsx");
    expect(publish).toMatch(/<ClipEditorDialog source=\{\{ blob: editing\.blob, name: editing\.name, mode: editing\.mode, seed: editing\.seed, botClipId: editing\.botClipId, loopCaption: editing\.loopCaption\s*, cutFile: editing\.cutFile \}\}/);
    const dialog = read("src/components/simulator/clipEditor/ClipEditorDialog.tsx");
    expect(dialog).toMatch(/botClipId\?: string \| null;\s+loopCaption\?: LoopCaptionContext \| null;/);
    expect(dialog).toMatch(/offerPublishClip\(\{ blob: result\.blob, name, source: "edit", durationSec: result\.durationSec, mode: source\.mode \?\? null, seed: source\.seed \?\? null, botClipId: source\.botClipId \?\? null, loopCaption: source\.loopCaption \?\? null, library \}\)/);
    // what the cut then offers: the source's words, its own length counted
    const source = offerPublishClip({ blob: new Blob(["x"], { type: "video/mp4" }), name: "bot.mp4", source: "bot", durationSec: 38.53, mode: "classic", seed: 1, botClipId: "ep023-2-escape", loopCaption: loopCaptionContext(classic) });
    const cut = offerPublishClip({ blob: new Blob(["y"], { type: "video/mp4" }), name: "bot-tiktok.mp4", source: "edit", durationSec: 14.2, mode: source.mode, seed: source.seed, botClipId: source.botClipId, loopCaption: source.loopCaption });
    expect(cut).toMatchObject({ botClipId: "ep023-2-escape", loopCaption: loopCaptionContext(classic) });
    expect(clipLoopCaptionContext(cut, loopCaptionContext(growMultiply))).toEqual({ mode: "classic", hookKey: "seconds", factKey: "", count: 14 });
  });
});
