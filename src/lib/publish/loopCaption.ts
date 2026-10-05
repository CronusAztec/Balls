import { normalizeHashtag, withoutPlatformTags } from "./caption";
import type { ModeId } from "@/lib/physics/types";

/*
 * --- loop-foundation --- The "Loop style" caption preset (the Publish caption editor's button): the words of the loop clips'
 * posts – a lowercase hook led by a number and ending in " 🔊", an optional plain-English fact paragraph under it, and four or
 * five hashtags, #satisfying and #oddlysatisfying first, then the topic's. No mentions and no call to action (no "follow",
 * "like", "comment", "link in bio"…): a line that asks for one is dropped. Pure; the words come translated (`LoopCaption`).
 */

/** The hashtags every loop-style post starts with. */
export const LOOP_CAPTION_BASE_TAGS = ["#satisfying", "#oddlysatisfying"] as const;
/** The topic tags a mode adds after them (two or three: four or five in all). */
export const LOOP_CAPTION_TOPIC_TAGS: Readonly<Partial<Record<ModeId, readonly string[]>>> = {
  grow: ["#physics", "#bouncingball", "#exponentialgrowth"],
  starChords: ["#math", "#geometry", "#creativecoding"], // --- chord-stars ---
};
/** Any other mode's topic tags. */
export const LOOP_CAPTION_DEFAULT_TAGS = ["#physics", "#bouncingball"] as const;
/** The speaker that ends every hook. */
export const LOOP_CAPTION_SPEAKER = " 🔊";

/** What a call to action looks like (a line with one is dropped). */
const CALL_TO_ACTION = /\b(follow|subscribe|like (?:and|&) (?:share|follow|subscribe)|like for|comment|share (?:this|with)|tag (?:a|your) friend|link in (?:my )?bio|check out|dm me|turn on notifications|save this)\b/i;

/** The text without @mentions (and the space they leave). */
export function stripMentions(text: string): string {
  return text.replace(/(^|\s)@[\p{L}\p{N}_.]+/gu, "$1").replace(/[ \t]{2,}/g, " ").trim();
}

/** The text without its sentences that ask for something (a call to action). */
export function stripCallsToAction(text: string): string {
  const sentences = text.split(/(?<=[.!?…])\s+/);
  return sentences.filter((s) => !CALL_TO_ACTION.test(s)).join(" ").trim();
}

/** True when `text` has a mention or a call to action (the preset's own words never do). */
export function hasMentionOrCta(text: string): boolean {
  return /(^|\s)@[\p{L}\p{N}_]/u.test(text) || CALL_TO_ACTION.test(text);
}

/** The hook: lowercase, led by its number, ending in " 🔊" (one speaker, however it came). */
export function loopHook(template: string, count: number | null, locale?: string): string {
  const n = count !== null && Number.isFinite(count) ? formatCount(count) : "";
  let hook = template.replace("{count}", n).replace(/🔊/gu, "");
  hook = stripCallsToAction(stripMentions(hook)).replace(/\s+/g, " ").trim();
  try {
    hook = hook.toLocaleLowerCase(locale);
  } catch {
    hook = hook.toLowerCase();
  }
  // a hook without its number's place (a hand-written one) is led by the number; a template keeps the number where it put it
  if (n && !template.includes("{count}")) hook = `${n} ${hook}`.trim();
  return `${hook}${LOOP_CAPTION_SPEAKER}`;
}

/** A count as a hook leads with it: a whole number, or one decimal for a small fraction (5.5). */
function formatCount(count: number): string {
  const r = Math.round(count * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The four or five hashtags: #satisfying #oddlysatisfying, then the topic's (no repeats, no platform tags). */
export function loopHashtags(mode: ModeId | null | undefined, extra: readonly string[] = []): string[] {
  const topic = [...(mode ? (LOOP_CAPTION_TOPIC_TAGS[mode] ?? LOOP_CAPTION_DEFAULT_TAGS) : LOOP_CAPTION_DEFAULT_TAGS), ...extra];
  const out: string[] = [...LOOP_CAPTION_BASE_TAGS];
  for (const raw of withoutPlatformTags(topic.map((t) => normalizeHashtag(t) ?? "").filter(Boolean))) {
    if (out.length >= 5) break;
    if (!out.some((t) => t.toLowerCase() === raw.toLowerCase())) out.push(raw.toLowerCase());
  }
  for (const fill of LOOP_CAPTION_DEFAULT_TAGS) if (out.length < 4 && !out.includes(fill)) out.push(fill);
  return out;
}

export interface LoopCaptionInput {
  mode: ModeId | null | undefined;
  /** The hook's words with `{count}` where its number goes ("{count}% bigger every bounce until it fills the circle"). */
  hook: string;
  /** The number the hook leads with (null: none known – the hook keeps its words). */
  count: number | null;
  /** The plain-English fact under the hook ("" for none). */
  fact?: string;
  /** The title (YouTube) – the hook without its speaker when left out. */
  title?: string;
  locale?: string;
}

/** The draft's fields in the loop style: the hook (and the fact) as the caption, the hook as the title, the hashtags. */
export function loopCaption(input: LoopCaptionInput): { title: string; caption: string; hashtags: string } {
  const hook = loopHook(input.hook, input.count, input.locale);
  const fact = input.fact ? stripCallsToAction(stripMentions(input.fact.replace("{count}", input.count !== null && Number.isFinite(input.count) ? formatCount(input.count) : ""))) : "";
  const caption = fact ? `${hook}\n\n${fact}` : hook;
  const title = (input.title ? stripCallsToAction(stripMentions(input.title)) : hook.slice(0, -LOOP_CAPTION_SPEAKER.length)).trim();
  return { title, caption, hashtags: loopHashtags(input.mode).join(" ") };
}

/** What the caption editor's "Loop style" needs of the page's settings: the mode, the translation keys of its hook and fact, and the number. */
export interface LoopCaptionContext {
  mode: ModeId;
  /** Keys under `LoopCaption` (the fact "" for none). */
  hookKey: string;
  factKey: string;
  count: number | null;
}

/**
 * The loop-style words of a run with these settings: Grow by its law – "{count}% bigger every bounce…" (multiply), "{count} px
 * bigger…" (add), "{count}% closer…" (the classic approach) –, any other mode its clip's seconds.
 */
export function loopCaptionContext(s: { mode: ModeId; growLaw?: string; growStep?: number; growRate?: number; recordingDuration: number; scBalls?: number /* --- chord-stars --- */ }): LoopCaptionContext {
  // --- chord-stars --- Chord Stars by its balls: "{count} balls, one circle, …" and the fact of the inner circles
  if (s.mode === "starChords") return { mode: s.mode, hookKey: "starChords", factKey: "starChordsFact", count: s.scBalls ?? null };
  if (s.mode === "grow") {
    if (s.growLaw === "multiply") return { mode: s.mode, hookKey: "growMultiply", factKey: "growMultiplyFact", count: s.growStep ?? null };
    if (s.growLaw === "add") return { mode: s.mode, hookKey: "growAdd", factKey: "", count: s.growStep ?? null };
    return { mode: s.mode, hookKey: "growApproach", factKey: "", count: s.growRate ?? null };
  }
  return { mode: s.mode, hookKey: "seconds", factKey: "", count: Number.isFinite(s.recordingDuration) ? Math.round(s.recordingDuration) : null };
}
