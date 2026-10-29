import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { numbersIn } from "@/lib/crew/clip";
import { toRequest, type CardDraft } from "@/lib/desktop/socialCard";
import {
  AUTONOMY_CHANNEL_DAY_MAX,
  AUTONOMY_CONSENT_VERSION,
  AUTONOMY_HEALTH_COOLDOWN_MS,
  AUTONOMY_LEAD_MS,
  AUTONOMY_MAX_LEAD_MS,
  AUTONOMY_PLATFORMS,
  AUTONOMY_REASONS,
  DEFAULT_AUTONOMY,
  checkBeforeCreate,
  clipProblems,
  compareVersions,
  consentProblems,
  consentWidens,
  countOver,
  decideAutonomy,
  eligibilityProblems,
  laneProblems,
  makeConsent,
  pauseCheck,
  paused,
  requestOfProposal,
  resumeProblems,
  resumed,
  sanitizeAutonomy,
  scheduleFor,
  splitChannels,
  stampText,
  tickableChannels,
  turnedOff,
  watchNeeded,
  type AccountPost,
  type AutonomyClip,
  type AutonomyContext,
  type AutonomyItem,
  type AutonomyLiveChannel,
  type AutonomyReason,
  type AutonomyState,
  type ItemOutcome,
} from "@/lib/desktop/autonomy";

/*
 * --- autonomy --- "Fully autonomous" as pure rules (lib/desktop/autonomy.ts, the learner plan's C11). Every "never" of C11 is
 * a test: each refusal alone against one clean world (provenance, lanes, the crew's keep, the render, the words, the accounts,
 * the volume, the consent, the clock and the mode), the time picked just before each create (60 to 90 minutes ahead, the
 * window, quiet hours, the spacing on both sides, the day's caps across midnight and a DST change, the pair's gap, the
 * licence's end), the self-pauses with their reasons, Resume, the practice day, the request it builds, and the stored block.
 */

// --- autonomy ---

const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;
/** 20 Nov 2026, 15:00 in Warsaw (UTC+1). */
const NOW = Date.parse("2026-11-20T14:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const FILE = { sha256: "ab".repeat(32), bytes: 1_000_000 };
const CUT_FILE = { sha256: "cd".repeat(32), bytes: 400_000 };
const CONSENT_AT = NOW - 3 * D;

const LIVE: AutonomyLiveChannel[] = [
  { id: "ig-1", platform: "instagram", profile: "jbl.balls", disabled: false, refreshNeeded: false },
  { id: "yt-1", platform: "youtube", profile: "JBL", disabled: false, refreshNeeded: false },
  { id: "ig-2", platform: "instagram-standalone", profile: "other.account", disabled: false, refreshNeeded: false },
  { id: "tt-1", platform: "tiktok", profile: "jbl", disabled: false, refreshNeeded: false },
  { id: "tb-1", platform: "tiktok-business", profile: "jblbiz", disabled: false, refreshNeeded: false },
  { id: "fb-1", platform: "facebook", profile: "JBL page", disabled: false, refreshNeeded: false },
];

function baseState(): AutonomyState {
  return {
    consent: {
      version: AUTONOMY_CONSENT_VERSION,
      at: iso(CONSENT_AT),
      appVersion: "1.8.0",
      postiz: { baseUrl: "https://api.postiz.com", organizationId: "org-1" },
      accounts: [
        { channelId: "ig-1", platform: "instagram", profile: "jbl.balls", perDay: 3, trialPairs: 1, youtube: null },
        { channelId: "yt-1", platform: "youtube", profile: "JBL", perDay: 2, trialPairs: 0, youtube: { type: "public", selfDeclaredMadeForKids: "no" } },
      ],
      practise: true,
    },
    pause: null,
    resumedAt: null,
    deleteOnWarning: true,
    lastRunAt: iso(NOW - 5 * MIN),
  };
}

function baseCtx(): AutonomyContext {
  return {
    now: NOW,
    postizNow: NOW,
    offsetMinAt: () => 60,
    appVersion: "1.8.0",
    realKey: true,
    licence: { pro: true, testMode: false, expiresAt: iso(NOW + 30 * D) },
    postiz: { configured: true, baseUrl: "https://api.postiz.com", organizationId: "org-1", keySavedAt: iso(CONSENT_AT - D), postNumbers: true, trialRoute: true, channels: LIVE },
    learner: { learn: true, paused: false, newestPassId: "pass-7", decisions: [] },
    autopilot: { quietFrom: "22:00", quietTo: "08:00", language: "en" },
    queue: [],
    posts: [],
    createCallsLastHour: 0,
    digest: sha,
    readNumbers: numbersIn,
    names: ["Thor", "Loki"],
  };
}

/** The stamp's hash taken again, as proposePass does in the main process. */
function stamp(item: AutonomyItem): AutonomyItem {
  return { ...item, pass: item.pass ? { ...item.pass, hash: sha(stampText(item)) } : null };
}

function baseItem(over: Partial<AutonomyItem> = {}): AutonomyItem {
  const item: AutonomyItem = {
    id: "it-1",
    clipId: "clip-1",
    video: "job:j1",
    status: "proposed",
    by: "ai",
    origin: "learnerPass",
    createdAt: iso(NOW - H),
    held: false,
    splitFrom: null,
    when: iso(NOW + 75 * MIN),
    channels: [{ integrationId: "ig-1", platform: "instagram", text: "Red escapes first. Watch until the end 🔊 #satisfying", settings: { __type: "instagram" }, lane: "normal" }],
    pass: { passId: "pass-7", date: "2026-11-20", role: "best", testId: null, pair: null, window: { from: iso(NOW + 30 * MIN), to: iso(NOW + 3 * H) }, hash: "" },
    ...over,
  };
  return stamp(item);
}

function baseClip(over: Partial<AutonomyClip> = {}): AutonomyClip {
  return {
    id: "clip-1",
    exists: true,
    file: FILE,
    review: { verdict: "keep", stage: "post", depth: "quick", gates: [], file: FILE },
    watermark: "sealed",
    family: "escape",
    mode: "classic",
    facts: { numbers: [1, 20], winner: null, contestants: [] },
    ...over,
  };
}

const trialChannel = (over: Record<string, unknown> = {}) => ({ integrationId: "ig-1", platform: "instagram", text: "Which ball escapes first? 🔊 #satisfying", settings: { __type: "instagram", post_type: "post", is_trial_reel: true, graduation_strategy: "MANUAL", ...over }, lane: "trialReel" as const });

interface World {
  state: AutonomyState;
  ctx: AutonomyContext;
  item: AutonomyItem;
  clip: AutonomyClip;
}

function world(change?: (w: World) => void): World {
  const w: World = { state: baseState(), ctx: baseCtx(), item: baseItem(), clip: baseClip() };
  change?.(w);
  if (!w.ctx.queue.some((q) => q.id === w.item.id)) w.ctx = { ...w.ctx, queue: [w.item, ...w.ctx.queue] };
  return w;
}

const decide = (w: World) => decideAutonomy(w.state, w.ctx, new Map([[w.clip.id, w.clip]]));
const outcomeOf = (w: World, id = w.item.id): ItemOutcome => decide(w).items.find((o) => o.itemId === id)!;
const reasonsOf = (w: World): AutonomyReason[] => {
  const o = outcomeOf(w);
  return o.kind === "wait" ? o.reasons : [];
};

/** The item waits for the person for good with `reason`, and nothing is created. */
function refuses(change: (w: World) => void, reason: AutonomyReason) {
  const w = world(change);
  const o = outcomeOf(w);
  expect(o.kind, reason).toBe("wait");
  expect(reasonsOf(w), reason).toContain(reason);
  expect(decide(w).items.some((x) => x.kind === "create"), reason).toBe(false);
}

/** A post on an account. */
const post = (over: Partial<AccountPost> & Pick<AccountPost, "channelId" | "at">): AccountPost => ({ postId: `p-${over.channelId}-${over.at}`, state: "QUEUE", by: "user", ...over });

describe("the clean case", () => {
  it("creates the learner's own, unchanged, crew-kept, sealed proposal 60 to 90 minutes before its time", () => {
    const w = world();
    const d = decide(w);
    expect(d.status).toBe("on");
    expect(d.check).toEqual({ off: null, pause: null, deleteOwn: [] });
    expect(d.items).toEqual([{ itemId: "it-1", kind: "create", at: NOW + 75 * MIN, request: { clipId: "clip-1", channels: [{ id: "ig-1", platform: "instagram", text: w.item.channels[0].text, settings: { __type: "instagram", post_type: "post" } }], when: iso(NOW + 75 * MIN) } }]);
    expect(eligibilityProblems(w.item, w.state, w.ctx)).toEqual([]);
  });

  it("is the same decision for the same inputs, whatever the queue's order", () => {
    const second = baseItem({ id: "it-2", clipId: "clip-2", video: "job:j2", when: iso(NOW + 80 * MIN), channels: [{ integrationId: "yt-1", platform: "youtube", text: "20 rings, 1 ball.", settings: { __type: "youtube", title: "Which ball escapes first?" }, lane: "normal" }] });
    const clips = new Map([
      ["clip-1", baseClip()],
      ["clip-2", baseClip({ id: "clip-2" })],
    ]);
    const a = world((w) => (w.ctx.queue = [w.item, second]));
    const b = world((w) => (w.ctx.queue = [second, w.item]));
    const da = decideAutonomy(a.state, a.ctx, clips);
    expect(da).toEqual(decideAutonomy(b.state, b.ctx, clips));
    expect(da.items.map((o) => o.kind)).toEqual(["create", "create"]);
  });
});

describe("never: provenance", () => {
  it("refuses an item made by propose (Plan posts, Send to Posts tab) or by the person", () => {
    const w = world((x) => (x.item = stamp({ ...x.item, origin: "ai" })));
    expect(eligibilityProblems(w.item, w.state, w.ctx)).toContain("notLearner");
    expect(decide(w).items).toEqual([]); // the approver never takes it: it waits on its card as today
    expect(eligibilityProblems(stamp({ ...w.item, origin: "user" }), w.state, w.ctx)).toContain("notLearner");
  });

  it("refuses a learnerPass item once a propose for the same clip is in the queue", () => {
    refuses((w) => (w.ctx.queue = [w.item, { ...baseItem({ id: "plan-1", origin: "ai", pass: null }) }]), "otherProposal");
    refuses((w) => (w.ctx.queue = [w.item, { ...baseItem({ id: "plan-2", clipId: "clip-cut", origin: "ai", pass: null }) }]), "otherProposal"); // its cut (the same video)
    // the part split off it for the person is no other proposal
    const w = world((x) => (x.ctx.queue = [x.item, { ...baseItem({ id: "it-1-tt", splitFrom: "it-1" }) }]));
    expect(outcomeOf(w).kind).toBe("create");
  });

  it("refuses a held item, an edited item, a hash that no longer matches, a split-off part and an item without a stamp", () => {
    refuses((w) => (w.item = stamp({ ...w.item, held: true })), "held");
    refuses((w) => (w.item = stamp({ ...w.item, by: "user", channels: [{ ...w.item.channels[0], text: "Red escapes." }] })), "edited");
    refuses((w) => (w.item = { ...w.item, channels: [{ ...w.item.channels[0], text: "Red escapes at last." }] }), "hashChanged");
    refuses((w) => (w.item = { ...w.item, when: iso(NOW + 80 * MIN) }), "hashChanged");
    refuses((w) => (w.item = stamp({ ...w.item, splitFrom: "it-0" })), "splitOff");
    refuses((w) => (w.item = { ...w.item, pass: null }), "noStamp");
  });

  it("refuses an item from an older pass, over 24 hours old, or made before the consent or the last Resume", () => {
    refuses((w) => (w.item = stamp({ ...w.item, pass: { ...w.item.pass!, passId: "pass-6" } })), "olderPass");
    refuses((w) => (w.item = stamp({ ...w.item, createdAt: iso(NOW - 25 * H) })), "tooOld");
    refuses((w) => (w.state.consent!.at = iso(NOW - 30 * MIN)), "beforeConsent");
    refuses((w) => (w.state.resumedAt = iso(NOW - 30 * MIN)), "beforeConsent");
  });

  it("refuses an item made during the practice day, and a test or block with a verdict, or any verdict since", () => {
    // the practice day ended 6 hours ago: an item made an hour ago is no practice item, one made 10 hours ago is
    const w = world((x) => (x.state.consent!.at = iso(NOW - 30 * H)));
    expect(outcomeOf(w).kind).toBe("create");
    refuses((x) => {
      x.state.consent!.at = iso(NOW - 30 * H);
      x.item = stamp({ ...x.item, createdAt: iso(NOW - 10 * H) });
    }, "practised");
    refuses((x) => {
      x.item = stamp({ ...x.item, pass: { ...x.item.pass!, role: "test", testId: "normal:3:length~short" } });
      x.ctx.learner = { ...x.ctx.learner, decisions: [{ testId: "normal:3:length~short", decidedAt: iso(NOW - 5 * D), verdict: "kept" }] };
    }, "testClosed");
    refuses((x) => (x.ctx.learner = { ...x.ctx.learner, decisions: [{ testId: "normal:2:ending~cliffhanger", decidedAt: iso(NOW - 30 * MIN), verdict: "notKept" }] }), "planChanged");
  });

  it("approves nothing when turned on over a queue of 10-day-old items, closed-test items and practice-day items", () => {
    const old = baseItem({ id: "old", clipId: "c-old", video: "job:old", createdAt: iso(NOW - 10 * D) });
    const closed = baseItem({ id: "closed", clipId: "c-closed", video: "job:closed", pass: { ...baseItem().pass!, role: "check", testId: "check:4" } });
    const practice = baseItem({ id: "practice", clipId: "c-practice", video: "job:practice", createdAt: iso(NOW - 2 * H) });
    const w = world((x) => {
      x.state.consent!.at = iso(NOW - 25 * H); // the practice day ended an hour ago
      x.item = practice;
      x.ctx.queue = [practice, old, closed];
      x.ctx.learner = { ...x.ctx.learner, decisions: [{ testId: "check:4", decidedAt: iso(NOW - 26 * H), verdict: "held" }] };
    });
    const clips = new Map(["c-old", "c-closed", "c-practice"].map((id) => [id, baseClip({ id })]));
    const d = decideAutonomy(w.state, w.ctx, clips);
    expect(d.items.map((o) => o.kind)).toEqual(["wait", "wait", "wait"]);
    expect(d.items.every((o) => o.kind === "wait" && o.final)).toBe(true);
  });
});

describe("never: lanes", () => {
  it("refuses a Trial Reel with an added channel, without MANUAL, on YouTube or as a story", () => {
    const trial = (channels: AutonomyItem["channels"]) => (w: World) => (w.item = stamp({ ...w.item, channels, pass: { ...w.item.pass!, role: "trialA", testId: "block:2", pair: 1 } }));
    refuses(trial([trialChannel(), { integrationId: "yt-1", platform: "youtube", text: "x", settings: { __type: "youtube", title: "Balls" }, lane: "trialReel" }]), "trialChannels");
    refuses(trial([trialChannel({ graduation_strategy: "SS_PERFORMANCE" })]), "trialSettings");
    refuses(trial([trialChannel({ is_trial_reel: undefined })]), "trialSettings");
    refuses(trial([{ integrationId: "yt-1", platform: "youtube", text: "x", settings: { __type: "youtube", title: "Balls", is_trial_reel: true, graduation_strategy: "MANUAL" }, lane: "trialReel" }]), "trialChannels");
    refuses(trial([trialChannel({ post_type: "story" })]), "story");
    refuses(trial([{ ...trialChannel(), lane: "normal" }]), "laneMismatch");
  });

  it("refuses a test item listing YouTube, a best item with a trial field, and a type that is not the channel's", () => {
    refuses((w) => (w.item = stamp({ ...w.item, pass: { ...w.item.pass!, role: "test", testId: "normal:3:length~short" }, channels: [w.item.channels[0], { integrationId: "yt-1", platform: "youtube", text: "x", settings: { __type: "youtube", title: "Balls" }, lane: "normal" }] })), "testChannels");
    refuses((w) => (w.item = stamp({ ...w.item, channels: [{ ...w.item.channels[0], settings: { __type: "instagram", is_trial_reel: true } }] })), "trialFieldOutsideTrial");
    refuses((w) => (w.item = stamp({ ...w.item, channels: [{ ...w.item.channels[0], settings: { __type: "instagram-standalone" } }] })), "typeMismatch");
    expect(laneProblems("test", [{ platform: "instagram", settings: { __type: "instagram" }, lane: "normal" }, { platform: "tiktok", settings: { __type: "tiktok" }, lane: "normal" }])).toEqual([]);
    expect(laneProblems("trialB", [trialChannel()])).toEqual([]);
  });

  it("splits off every channel the app may not post to: TikTok, TikTok Business, other platforms, unticked accounts", () => {
    const channels = ["ig-1", "tt-1", "tb-1", "fb-1", "ig-2", "yt-1"].map((id) => ({ integrationId: id, platform: LIVE.find((l) => l.id === id)!.platform }));
    const { auto, person } = splitChannels(channels, baseState().consent);
    expect(auto.map((c) => c.integrationId)).toEqual(["ig-1", "yt-1"]);
    expect(person.map((c) => c.integrationId)).toEqual(["tt-1", "tb-1", "fb-1", "ig-2"]);
    expect(splitChannels(channels, null).auto).toEqual([]);
    expect([...AUTONOMY_PLATFORMS]).toEqual(["instagram", "instagram-standalone", "youtube"]);
  });
});

describe("never: the crew's keep, the render, the words", () => {
  it("refuses a clip the crew did not keep on this very file", () => {
    refuses((w) => (w.clip = baseClip({ review: null })), "notReviewed");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, verdict: "notReviewed" } })), "notReviewed");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, depth: "rules" } })), "rulesOnly");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, verdict: "split" } })), "split");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, verdict: "drop" } })), "dropped");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, verdict: "fix" } })), "notKept");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, keepAnyway: true } })), "keepAnyway");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, stage: "pre" } })), "stagePre");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, gates: ["G4"] } })), "gateFailed");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, file: { ...FILE, sha256: "ef".repeat(32) } } })), "reviewFileMismatch");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, file: { ...FILE, bytes: FILE.bytes + 1 } } })), "reviewFileMismatch");
    refuses((w) => (w.clip = baseClip({ review: { ...baseClip().review!, file: null } })), "reviewFileMismatch");
    // a cut of a kept master: the review is the master's, the file is the cut's
    refuses((w) => (w.clip = baseClip({ file: CUT_FILE })), "reviewFileMismatch");
    refuses((w) => (w.clip = baseClip({ exists: false })), "clipMissing");
    expect(clipProblems(undefined)).toEqual(["clipMissing"]);
  });

  it("refuses a free, test-sealed or unknown render, and the battle family", () => {
    refuses((w) => (w.clip = baseClip({ watermark: "free" })), "watermarkFree");
    refuses((w) => (w.clip = baseClip({ watermark: "sealedTest" })), "watermarkTest");
    refuses((w) => (w.clip = baseClip({ watermark: null })), "watermarkUnknown");
    refuses((w) => (w.clip = baseClip({ family: "battle" })), "battleFamily");
    refuses((w) => (w.clip = baseClip({ mode: "fightLeague", family: null })), "battleFamily");
  });

  it("refuses words that fail the text gate, with the gate's reasons", () => {
    for (const text of ["Follow for more!", "Watch it at balls.com", "This one goes viral", "50 rings, one ball", "Thor escapes"]) {
      const w = world((x) => (x.item = stamp({ ...x.item, channels: [{ ...x.item.channels[0], text }] })));
      const o = outcomeOf(w);
      expect(o.kind === "wait" && o.reasons.includes("words") && o.words.length > 0, text).toBe(true);
    }
  });

  it("refuses what the card itself would refuse", () => {
    refuses((w) => (w.item = stamp({ ...w.item, channels: [{ ...w.item.channels[0], text: `Red escapes ${Array.from({ length: 31 }, (_, i) => `#t${String.fromCharCode(97 + (i % 26))}${i}`).join(" ")}` }] })), "cardRules");
  });
});

describe("never: accounts", () => {
  const onChannel = (id: string, platform: string, settings: Record<string, unknown> = { __type: platform }) => (w: World) => (w.item = stamp({ ...w.item, channels: [{ integrationId: id, platform, text: "Red escapes first.", settings, lane: "normal" }] }));
  it("refuses an account outside the consent, TikTok, TikTok Business and every other platform", () => {
    refuses(onChannel("ig-2", "instagram-standalone"), "notConsented");
    refuses(onChannel("tt-1", "tiktok"), "platformNotAllowed");
    refuses(onChannel("tb-1", "tiktok-business"), "platformNotAllowed");
    refuses(onChannel("fb-1", "facebook"), "platformNotAllowed");
    refuses((w) => (w.item = stamp({ ...w.item, channels: [] })), "noAccount");
  });

  it("refuses a live identifier that differs from the item's platform or type, a disabled channel and a changed profile", () => {
    refuses((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.map((l) => (l.id === "ig-1" ? { ...l, platform: "instagram-standalone" } : l)) }), "platformChanged");
    refuses((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.map((l) => (l.id === "ig-1" ? { ...l, disabled: true } : l)) }), "accountDisabled");
    refuses((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.map((l) => (l.id === "ig-1" ? { ...l, refreshNeeded: true } : l)) }), "accountDisabled");
    refuses((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.map((l) => (l.id === "ig-1" ? { ...l, profile: "someone.else" } : l)) }), "profileChanged");
    refuses((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.filter((l) => l.id !== "ig-1") }), "accountGone");
    refuses((w) => (w.ctx.postiz = { ...w.ctx.postiz, postNumbers: false }), "postizOld");
  });
});

describe("never: volume", () => {
  it("refuses a second Trial Reel pair on the account's day", () => {
    const w = world((x) => {
      x.item = stamp({ ...x.item, channels: [trialChannel()], pass: { ...x.item.pass!, role: "trialA", testId: "block:2", pair: 2 } });
      x.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - 4 * H), by: "app", state: "PUBLISHED", lane: "trialReel", testId: "block:2", pair: 1 }), post({ channelId: "ig-1", at: iso(NOW - 2 * H), by: "app", state: "PUBLISHED", lane: "trialReel", testId: "block:2", pair: 1 })];
    });
    expect(outcomeOf(w)).toMatchObject({ kind: "wait", reasons: ["missedTime"], final: true, block: "trialPairsFull" });
  });

  it("counts a post made in Postiz's own editor against the day's cap", () => {
    const yt = (w: World) => (w.item = stamp({ ...w.item, channels: [{ integrationId: "yt-1", platform: "youtube", text: "Red escapes first.", settings: { __type: "youtube", title: "Which ball escapes first?" }, lane: "normal" }] }));
    const withPosts = (posts: AccountPost[]) => world((w) => {
      yt(w);
      w.ctx.posts = posts;
    });
    const mine = post({ channelId: "yt-1", at: iso(NOW - 5 * H), by: "app", state: "PUBLISHED" });
    expect(outcomeOf(withPosts([mine])).kind).toBe("create");
    expect(outcomeOf(withPosts([mine, post({ channelId: "yt-1", at: iso(NOW - 3 * H), by: "outside", state: "PUBLISHED" })]))).toMatchObject({ kind: "wait", block: "dayFull" });
    // never more than 7 on an account in a day, whoever made them
    const many = Array.from({ length: AUTONOMY_CHANNEL_DAY_MAX }, (_, i) => post({ channelId: "ig-1", at: iso(NOW - (i + 1) * 30 * MIN), by: "outside", state: "PUBLISHED" }));
    const w = world((x) => {
      x.state.consent!.accounts[0] = { ...x.state.consent!.accounts[0], perDay: 5, trialPairs: 2 };
      x.ctx.posts = many;
    });
    expect(outcomeOf(w)).toMatchObject({ kind: "wait", block: "dayFull" });
  });

  it("keeps the cap over any 24 hours across midnight, and over the local day across a DST change", () => {
    // UTC, no quiet hours: two posts late on 19 Nov, the item at 00:30 on 20 Nov. The local day is empty, the last 24 hours are not.
    const t = Date.parse("2026-11-20T00:30:00Z");
    const ytItem = (when: number) => (w: World) => {
      w.ctx = { ...w.ctx, now: when - 75 * MIN, postizNow: when - 75 * MIN, offsetMinAt: () => 0, autopilot: { ...w.ctx.autopilot, quietFrom: "03:00", quietTo: "03:00" } };
      w.state.lastRunAt = iso(when - 80 * MIN);
      w.item = stamp({ ...w.item, createdAt: iso(when - 2 * H), when: iso(when), channels: [{ integrationId: "yt-1", platform: "youtube", text: "Red escapes first.", settings: { __type: "youtube", title: "Which ball escapes first?" }, lane: "normal" }], pass: { ...w.item.pass!, window: null } });
    };
    const late = [post({ channelId: "yt-1", at: "2026-11-19T22:00:00.000Z", by: "user", state: "PUBLISHED" }), post({ channelId: "yt-1", at: "2026-11-19T23:00:00.000Z", by: "app", state: "PUBLISHED" })];
    const w = world((x) => {
      ytItem(t)(x);
      x.ctx.posts = late;
    });
    expect(countOver(late, t, w.ctx)).toBe(2);
    expect(outcomeOf(w)).toMatchObject({ kind: "wait", block: "dayFull" });
    // the same posts two days earlier leave the item alone
    const free = world((x) => {
      ytItem(t)(x);
      x.ctx.posts = late.map((p) => ({ ...p, at: iso(Date.parse(p.at) - 2 * D) }));
    });
    expect(outcomeOf(free).kind).toBe("create");

    // Warsaw, 25 Oct 2026: clocks go back at 01:00 UTC, so that local day lasts 25 hours. A post at 00:10 local (22:10 UTC on
    // the 24th) and the item at 23:50 local (22:50 UTC on the 25th) are 24 h 40 min apart but on one local day.
    const warsaw = (at: number) => (at < Date.parse("2026-10-25T01:00:00Z") ? 120 : 60);
    const item = Date.parse("2026-10-25T22:50:00Z");
    const dst = world((x) => {
      ytItem(item)(x);
      x.ctx = { ...x.ctx, offsetMinAt: warsaw };
      x.state.consent!.at = iso(item - 4 * D);
      x.ctx.postiz = { ...x.ctx.postiz, keySavedAt: iso(item - 5 * D) };
      x.state.consent!.accounts[1] = { ...x.state.consent!.accounts[1], perDay: 1 };
      x.ctx.posts = [post({ channelId: "yt-1", at: "2026-10-24T22:10:00.000Z", by: "outside", state: "PUBLISHED" })];
    });
    expect(outcomeOf(dst)).toMatchObject({ kind: "wait", block: "dayFull" });
    // with a fixed +1 h the post would fall on the day before, and the item would go out
    expect(outcomeOf({ ...dst, ctx: { ...dst.ctx, offsetMinAt: () => 60 } }).kind).toBe("create");
  });

  it("never posts a video twice on an account: a master and its cut are one", () => {
    refuses((w) => (w.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - 2 * D), by: "user", state: "PUBLISHED", video: "job:j1", clipId: "clip-master" })]), "duplicate");
    refuses((w) => (w.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - 2 * D), by: "app", state: "ERROR", clipId: "clip-1", error: "Media expired, please upload again", seenAt: iso(NOW - 2 * D) })]), "duplicate");
  });

  it("keeps 20 minutes on both sides of every post on the account, a person's 'now' post included", () => {
    // UTC, no quiet hours; the item planned for 12:10 with no window of its own
    const at = (hhmm: string) => Date.parse(`2026-11-20T${hhmm}:00Z`);
    const at1210 = (w: World) => {
      w.ctx = { ...w.ctx, now: at("10:55"), postizNow: at("10:55"), offsetMinAt: () => 0, autopilot: { ...w.ctx.autopilot, quietFrom: "03:00", quietTo: "03:00" } };
      w.state.lastRunAt = iso(at("10:50"));
      w.item = stamp({ ...w.item, createdAt: iso(at("10:00")), when: iso(at("12:10")), pass: { ...w.item.pass!, window: null } });
    };
    const withPosts = (posts: AccountPost[]) => world((w) => {
      at1210(w);
      w.ctx.posts = posts;
    });
    expect(outcomeOf(withPosts([post({ channelId: "ig-1", at: iso(at("12:00")) }), post({ channelId: "ig-1", at: iso(at("21:00")) })]))).toMatchObject({ kind: "wait", block: "spacing" });
    // out of order: the other post is the later one
    expect(outcomeOf(withPosts([post({ channelId: "ig-1", at: iso(at("12:25")) })]))).toMatchObject({ kind: "wait", block: "spacing" });
    // a person's post for "now", made at 12:05 (its real time), next to the item's 12:10
    expect(outcomeOf(withPosts([post({ channelId: "ig-1", at: iso(at("12:05")), state: "PUBLISHED" })]))).toMatchObject({ kind: "wait", block: "spacing" });
    expect(outcomeOf(withPosts([post({ channelId: "ig-1", at: iso(at("11:50")) }), post({ channelId: "ig-1", at: iso(at("12:30")) })])).kind).toBe("create");
    // another account, a draft, a failed post and a post gone from Postiz take no room
    expect(outcomeOf(withPosts([post({ channelId: "yt-1", at: iso(at("12:10")) }), post({ channelId: "ig-1", at: iso(at("12:10")), state: "DRAFT" }), post({ channelId: "ig-1", at: iso(at("12:12")), state: "ERROR", error: "Caption is too long", seenAt: iso(at("10:00")) })])).kind).toBe("create");
  });

  it("makes the creates of one tick count against each other", () => {
    const second = baseItem({ id: "it-2", clipId: "clip-2", video: "job:j2", when: iso(NOW + 80 * MIN), pass: { ...baseItem().pass!, window: null } });
    const w = world((x) => (x.ctx.queue = [x.item, second]));
    const d = decideAutonomy(w.state, w.ctx, new Map([["clip-1", baseClip()], ["clip-2", baseClip({ id: "clip-2" })]]));
    expect(d.items.map((o) => o.kind)).toEqual(["create", "wait"]);
    expect(d.items[1]).toMatchObject({ block: "spacing" });
  });
});

describe("never: consent, clock and mode", () => {
  const nothingCreated = (w: World, wait: AutonomyReason) => {
    const d = decide(w);
    expect(d.wait, wait).toBe(wait);
    expect(d.items.some((o) => o.kind === "create"), wait).toBe(false);
    expect(reasonsOf(w), wait).toContain(wait);
  };

  it("waits when the clock is off by more than 5 minutes, or unknown", () => {
    nothingCreated(world((w) => (w.ctx.postizNow = NOW - 6 * MIN)), "clockOff");
    nothingCreated(world((w) => (w.ctx.postizNow = null)), "clockUnknown");
    expect(outcomeOf(world((w) => (w.ctx.postizNow = NOW - 4 * MIN))).kind).toBe("create");
  });

  it("waits while learning is off or paused, in licence test mode, before the licence is handed, and while a create is unsettled", () => {
    nothingCreated(world((w) => (w.ctx.learner = { ...w.ctx.learner, paused: true })), "learningPaused");
    nothingCreated(world((w) => (w.ctx.learner = { ...w.ctx.learner, learn: false })), "learningOff");
    nothingCreated(world((w) => (w.ctx.licence = { ...w.ctx.licence!, testMode: true })), "testMode");
    nothingCreated(world((w) => (w.ctx.realKey = false)), "testMode");
    nothingCreated(world((w) => (w.ctx.licence = null)), "licenceMissing");
    nothingCreated(world((w) => (w.ctx.postiz = { ...w.ctx.postiz, postNumbers: null })), "postizUnchecked");
    nothingCreated(world((w) => (w.ctx.createCallsLastHour = 60)), "createLimit");
    // a create whose answer never came: nothing more until Postiz's list settles it, and it counts on its account meanwhile
    const unsettled = world((w) => (w.ctx.posts = [post({ channelId: "yt-1", at: iso(NOW + 2 * H), state: "intent", by: "app", postId: null })]));
    nothingCreated(unsettled, "unsettled");
    expect(countOver(unsettled.ctx.posts, NOW + 2 * H, unsettled.ctx)).toBe(1);
  });

  it("pauses on an older consent version, and turns Off in an app older than the consent's", () => {
    const old = world((w) => (w.state.consent!.version = AUTONOMY_CONSENT_VERSION - 1));
    expect(pauseCheck(old.state, old.ctx).pause?.reason).toBe("consentVersion");
    expect(resumeProblems(old.state, old.ctx)).toContain("consentVersion");
    const older = world((w) => (w.ctx.appVersion = "1.7.9"));
    const d = decide(older);
    expect(d.status).toBe("off");
    expect(d.check.off).toBe("appOlder");
    expect(d.items).toEqual([]);
    expect(compareVersions("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.8.0", "1.8.0-beta")).toBe(0);
  });
});

describe("pausing itself, and Resume", () => {
  const pauseOf = (w: World) => pauseCheck(w.state, w.ctx).pause;

  it("pauses on any failed post of its own (the first one: no second is waited for), with its reason", () => {
    const w = world((x) => (x.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - 2 * H), by: "app", state: "ERROR", error: "Media expired, please upload again", seenAt: iso(NOW - MIN) })]));
    expect(pauseOf(w)).toEqual({ reason: "ownPostFailed", at: iso(NOW), until: null, channelId: "ig-1" });
    const d = decide(w);
    expect(d.status).toBe("paused");
    expect(d.items.some((o) => o.kind === "create")).toBe(false);
    // an unknown text pauses too (fail closed), and names itself
    expect(pauseOf(world((x) => (x.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - 2 * H), by: "app", state: "ERROR", error: "Something odd", seenAt: iso(NOW - MIN) })])))?.reason).toBe("unknownError");
    expect(pauseOf(world((x) => (x.ctx.posts = [post({ channelId: "yt-1", at: iso(NOW - 2 * H), by: "app", state: "ERROR", error: null, seenAt: iso(NOW - MIN) })])))?.reason).toBe("unknownError");
  });

  it("pauses every account for 48 hours on each of Postiz's account warnings, on a post the person made, and removes only its own still-scheduled posts there", () => {
    const warnings = [
      "Instagram blocked your request",
      "Instagram detected that your post is spam, please try again with different content",
      "Instagram user is restricted",
      "Something is wrong with your connected user, please re-authenticate",
      "You session has been invalidated, this can usually happen from frequent posting, please re-authenticate, and wait 1-2 days before posting again",
      "Instagram requires you to log in at instagram.com and follow its instructions before posting can resume. After that, please reconnect this channel.",
      "You have reached the maximum of 25 posts per day, allowed for your account",
      "Page posting for today is limited, please try again tomorrow",
    ];
    const mineLater = post({ channelId: "ig-1", postId: "own-later", at: iso(NOW + 70 * MIN), by: "app", state: "QUEUE" });
    const minePublished = post({ channelId: "ig-1", postId: "own-done", at: iso(NOW - 3 * H), by: "app", state: "PUBLISHED" });
    const personLater = post({ channelId: "ig-1", postId: "person-later", at: iso(NOW + 80 * MIN), by: "user", state: "QUEUE" });
    const mineYouTube = post({ channelId: "yt-1", postId: "own-yt", at: iso(NOW + 60 * MIN), by: "app", state: "QUEUE" });
    for (const error of warnings) {
      const w = world((x) => (x.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - H), by: "user", state: "ERROR", error, platform: "instagram", seenAt: iso(NOW - MIN) }), mineLater, minePublished, personLater, mineYouTube]));
      const check = pauseCheck(w.state, w.ctx);
      expect(check.pause, error).toEqual({ reason: "accountHealth", at: iso(NOW), until: iso(NOW + AUTONOMY_HEALTH_COOLDOWN_MS), channelId: "ig-1" });
      expect(check.deleteOwn, error).toEqual([{ channelId: "ig-1", postId: "own-later" }]);
    }
    // "only tell me"
    const tell = world((x) => {
      x.state.deleteOnWarning = false;
      x.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - H), by: "outside", state: "ERROR", error: warnings[0], seenAt: iso(NOW - MIN) }), mineLater];
    });
    expect(pauseCheck(tell.state, tell.ctx)).toMatchObject({ pause: { reason: "accountHealth" }, deleteOwn: [] });
    // Resume waits 48 hours, then needs nothing more
    const p = pauseCheck(tell.state, tell.ctx).pause!;
    const pausedState = paused(tell.state, p);
    const later = { ...tell.ctx, posts: [] };
    expect(resumeProblems(pausedState, later)).toEqual(["cooldown"]);
    expect(resumeProblems(pausedState, { ...later, now: NOW + AUTONOMY_HEALTH_COOLDOWN_MS + MIN })).toEqual([]);
  });

  it("pauses on an account turned off or needing a reconnect in Postiz", () => {
    expect(pauseOf(world((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.map((l) => (l.id === "yt-1" ? { ...l, refreshNeeded: true } : l)) })))).toMatchObject({ reason: "accountHealth", channelId: "yt-1" });
  });

  it("escalates a pause to the account warning, but never deletes twice for one warning", () => {
    const warning = post({ channelId: "ig-1", at: iso(NOW - 10 * MIN), by: "user", state: "ERROR", error: "Instagram blocked your request", seenAt: iso(NOW - MIN) });
    const own = post({ channelId: "ig-1", postId: "own-later", at: iso(NOW + 70 * MIN), by: "app", state: "QUEUE" });
    const userPaused = world((w) => {
      w.state.pause = { reason: "user", at: iso(NOW - 30 * MIN), until: null, channelId: null };
      w.ctx.posts = [warning, own];
    });
    const check = pauseCheck(userPaused.state, userPaused.ctx);
    expect(check.pause?.reason).toBe("accountHealth");
    expect(check.deleteOwn).toEqual([{ channelId: "ig-1", postId: "own-later" }]);
    const after = { ...userPaused, state: paused(userPaused.state, check.pause!), ctx: { ...userPaused.ctx, now: NOW + 5 * MIN } };
    expect(pauseCheck(after.state, after.ctx)).toEqual({ off: null, pause: null, deleteOwn: [] });
    // another pause never replaces a pause that is on
    expect(paused(after.state, { reason: "user", at: iso(NOW), until: null, channelId: null })).toBe(after.state);
  });

  it("does not pause on a known error of a person's post, nor on any post of an account outside the consent", () => {
    expect(pauseOf(world((w) => (w.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - H), by: "user", state: "ERROR", error: "Caption is too long", seenAt: iso(NOW - MIN) })])))).toBeNull();
    expect(pauseOf(world((w) => (w.ctx.posts = [post({ channelId: "ig-2", at: iso(NOW - H), by: "user", state: "ERROR", error: "Instagram blocked your request", seenAt: iso(NOW - MIN) })])))).toBeNull();
    expect(pauseOf(world((w) => (w.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - H), by: "user", state: "ERROR", error: "Something odd", seenAt: iso(NOW - MIN) })])))?.reason).toBe("unknownError");
    // what happened before the last Resume is forgotten
    expect(pauseOf(world((w) => {
      w.state.resumedAt = iso(NOW - 10 * MIN);
      w.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - H), by: "app", state: "ERROR", error: "Media expired, please upload again", seenAt: iso(NOW - 20 * MIN) })];
    }))).toBeNull();
  });

  it("pauses when one of its scheduled posts is deleted in Postiz, and on a change the learner sent back", () => {
    expect(pauseOf(world((w) => (w.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW + H), by: "app", state: "QUEUE", gone: true, seenAt: iso(NOW - MIN) })])))?.reason).toBe("ownPostDeleted");
    expect(pauseOf(world((w) => (w.ctx.learner = { ...w.ctx.learner, decisions: [{ testId: "check:4", decidedAt: iso(NOW - 10 * MIN), verdict: "wentBack" }] })))?.reason).toBe("wentBack");
  });

  it("pauses when Pro ends, the key is removed or saved again, an account changes, or it has not run for more than 48 hours", () => {
    expect(pauseOf(world((w) => (w.ctx.licence = { ...w.ctx.licence!, pro: false })))?.reason).toBe("proEnded");
    expect(pauseOf(world((w) => (w.ctx.licence = { ...w.ctx.licence!, expiresAt: iso(NOW - MIN) })))?.reason).toBe("proEnded");
    expect(pauseOf(world((w) => (w.ctx.postiz = { ...w.ctx.postiz, configured: false })))?.reason).toBe("keyRemoved");
    expect(pauseOf(world((w) => (w.ctx.postiz = { ...w.ctx.postiz, keySavedAt: iso(NOW - H) })))?.reason).toBe("keyChanged");
    expect(pauseOf(world((w) => (w.ctx.postiz = { ...w.ctx.postiz, organizationId: "org-2" })))?.reason).toBe("keyChanged");
    expect(pauseOf(world((w) => (w.ctx.postiz = { ...w.ctx.postiz, channels: LIVE.map((l) => (l.id === "yt-1" ? { ...l, profile: "Someone" } : l)) })))).toMatchObject({ reason: "accountChanged", channelId: "yt-1" });
    // the approver last ran 3 days ago (the app closed, or rolled back to 1.6.0 and forward again)
    const gap = world((w) => (w.state.lastRunAt = iso(NOW - 3 * D)));
    expect(pauseOf(gap)?.reason).toBe("gap");
    expect(decide(gap).status).toBe("paused");
    expect(resumeProblems(paused(gap.state, pauseOf(gap)!), gap.ctx)).toEqual([]);
  });

  it("resumes with one press once the cause is gone, and items made before Resume never qualify", () => {
    const w = world((x) => (x.state.pause = { reason: "user", at: iso(NOW - 2 * H), until: null, channelId: null }));
    expect(decide(w).items).toEqual([{ itemId: "it-1", kind: "wait", reasons: ["paused"], final: false, words: [], card: [] }]);
    const back = resumed(w.state, NOW);
    expect(back.pause).toBeNull();
    expect(eligibilityProblems(w.item, back, w.ctx)).toContain("beforeConsent");
    expect(resumeProblems(w.state, { ...w.ctx, licence: null })).toContain("proEnded");
    expect(resumeProblems(w.state, { ...w.ctx, learner: { ...w.ctx.learner, learn: false } })).toContain("learningOff");
    expect(resumeProblems(turnedOff(w.state), w.ctx)).toEqual(["off"]);
  });

  it("checks Pause again just before each create attempt, the 429 retry included", () => {
    const w = world();
    const clips = new Map([[w.clip.id, w.clip]]);
    expect(checkBeforeCreate("it-1", w.state, w.ctx, clips).outcome?.kind).toBe("create");
    // "Pause posting" pressed during the upload or the 429 wait
    const pausedNow = { ...w.state, pause: { reason: "user" as const, at: iso(NOW + 10 * MIN), until: null, channelId: null } };
    expect(checkBeforeCreate("it-1", pausedNow, { ...w.ctx, now: NOW + 15 * MIN, postizNow: NOW + 15 * MIN }, clips).outcome).toMatchObject({ kind: "wait", reasons: ["paused"] });
    // the person opened its card meanwhile
    const held = stamp({ ...w.item, held: true });
    expect(checkBeforeCreate("it-1", w.state, { ...w.ctx, queue: [held] }, clips).outcome).toMatchObject({ kind: "wait", final: true });
    expect(checkBeforeCreate("nope", w.state, w.ctx, clips).outcome).toBeNull();
  });

  it("pauses when the per-post route fails just before a Trial Reel, and waits while it is not asked", () => {
    const trial = (w: World) => (w.item = stamp({ ...w.item, channels: [trialChannel()], pass: { ...w.item.pass!, role: "trialA", testId: "block:2", pair: 1 } }));
    const failed = world((w) => {
      trial(w);
      w.ctx.postiz = { ...w.ctx.postiz, trialRoute: false };
    });
    const d = decide(failed);
    expect(d.status).toBe("paused");
    expect(d.check.pause?.reason).toBe("trialCheckFailed");
    expect(d.items.some((o) => o.kind === "create")).toBe(false);
    const unasked = world((w) => {
      trial(w);
      w.ctx.postiz = { ...w.ctx.postiz, trialRoute: null };
    });
    expect(outcomeOf(unasked)).toMatchObject({ kind: "wait", reasons: ["trialRouteUnchecked"], final: false });
    const ok = world(trial);
    expect(outcomeOf(ok)).toMatchObject({ kind: "create", request: { channels: [{ settings: { __type: "instagram", post_type: "post", is_trial_reel: true, graduation_strategy: "MANUAL" } }] } });
  });
});

describe("the time: just in time, picked before each attempt", () => {
  const sched = (w: World, postizNow: number) => scheduleFor(w.item, w.state, w.ctx, postizNow);

  it("creates only when the time is 60 to 90 minutes away", () => {
    expect(outcomeOf(world((w) => (w.item = stamp({ ...w.item, when: iso(NOW + 100 * MIN) }))))).toEqual({ itemId: "it-1", kind: "later", at: NOW + 100 * MIN, reason: "notYet" });
    expect(outcomeOf(world((w) => (w.item = stamp({ ...w.item, when: iso(NOW + 61 * MIN) })))).kind).toBe("create");
    // its planned time 30 minutes away: the earliest minute 60 minutes ahead inside its window
    const soon = world((w) => (w.item = stamp({ ...w.item, when: iso(NOW + 30 * MIN) })));
    expect(outcomeOf(soon)).toMatchObject({ kind: "create", at: NOW + AUTONOMY_LEAD_MS });
    // no window of its own: missed
    expect(outcomeOf(world((w) => (w.item = stamp({ ...w.item, when: iso(NOW + 30 * MIN), pass: { ...w.item.pass!, window: null } }))))).toMatchObject({ kind: "wait", reasons: ["missedTime"], final: true, block: "window" });
  });

  it("is never under 60 minutes after the attempt: after a 40-minute upload, and after a 429 with a 5-minute Retry-After", () => {
    const w = world((x) => (x.item = stamp({ ...x.item, when: iso(NOW + 85 * MIN) })));
    expect(sched(w, NOW)).toEqual({ kind: "at", at: NOW + 85 * MIN });
    const afterUpload = sched(w, NOW + 40 * MIN);
    expect(afterUpload.kind).toBe("at");
    if (afterUpload.kind === "at") expect(afterUpload.at - (NOW + 40 * MIN)).toBeGreaterThanOrEqual(AUTONOMY_LEAD_MS);
    const after429 = sched(w, NOW + 45 * MIN);
    if (after429.kind !== "at") throw new Error("no time after the 429");
    expect(after429.at - (NOW + 45 * MIN)).toBeGreaterThanOrEqual(AUTONOMY_LEAD_MS);
    expect(after429.at - (NOW + 45 * MIN)).toBeLessThanOrEqual(AUTONOMY_MAX_LEAD_MS);
    // the window ends at the planned time: nothing fits after the upload
    const tight = world((x) => (x.item = stamp({ ...x.item, when: iso(NOW + 85 * MIN), pass: { ...x.item.pass!, window: { from: iso(NOW + 30 * MIN), to: iso(NOW + 85 * MIN) } } })));
    expect(sched(tight, NOW + 40 * MIN)).toEqual({ kind: "none", reason: "window" });
    // a PC clock that jumps after Postiz's last answer is caught against the upload's own Date
    const jumped = world((x) => (x.ctx = { ...x.ctx, now: NOW + 52 * MIN, postizNow: NOW + 40 * MIN }));
    expect(checkBeforeCreate("it-1", jumped.state, jumped.ctx, new Map([[jumped.clip.id, jumped.clip]])).outcome).toMatchObject({ kind: "wait", reasons: ["clockOff"] });
  });

  it("is never after the licence's end", () => {
    const ends = (minutes: number) => world((x) => (x.ctx.licence = { ...x.ctx.licence!, expiresAt: iso(NOW + minutes * MIN) }));
    expect(sched(ends(80), NOW)).toEqual({ kind: "at", at: NOW + 75 * MIN });
    // the licence ends before the planned time: the earliest time an hour ahead, still before the end
    expect(sched(ends(70), NOW)).toEqual({ kind: "at", at: NOW + 60 * MIN });
    expect(sched(ends(50), NOW)).toEqual({ kind: "none", reason: "licenceEnd" });
    expect(outcomeOf(ends(50))).toMatchObject({ kind: "wait", reasons: ["missedTime"], block: "licenceEnd" });
  });

  it("keeps quiet hours", () => {
    // 22:30 local, its window 22:00 to 23:00: all quiet
    const quiet = world((x) => {
      x.ctx = { ...x.ctx, now: Date.parse("2026-11-20T20:15:00Z"), postizNow: Date.parse("2026-11-20T20:15:00Z") };
      x.state.lastRunAt = iso(Date.parse("2026-11-20T20:10:00Z"));
      x.item = stamp({ ...x.item, createdAt: iso(Date.parse("2026-11-20T19:00:00Z")), when: "2026-11-20T21:30:00.000Z", pass: { ...x.item.pass!, window: { from: "2026-11-20T21:00:00.000Z", to: "2026-11-20T22:00:00.000Z" } } });
    });
    expect(sched(quiet, quiet.ctx.postizNow!)).toEqual({ kind: "none", reason: "quiet" });
    // a window from 07:30 to 09:00 local, planned for 07:45: the first minute out of quiet hours, 08:00
    const morning = world((x) => {
      x.item = stamp({ ...x.item, when: "2026-11-21T06:45:00.000Z", pass: { ...x.item.pass!, window: { from: "2026-11-21T06:30:00.000Z", to: "2026-11-21T08:00:00.000Z" } } });
    });
    expect(sched(morning, Date.parse("2026-11-21T05:20:00Z"))).toEqual({ kind: "later", at: Date.parse("2026-11-21T07:00:00Z") });
    expect(sched(morning, Date.parse("2026-11-21T05:45:00Z"))).toEqual({ kind: "at", at: Date.parse("2026-11-21T07:00:00Z") });
  });

  it("keeps 2 hours inside a Trial Reel pair", () => {
    const pairA = (w: World) => (w.item = stamp({ ...w.item, channels: [trialChannel()], pass: { ...w.item.pass!, role: "trialA", testId: "block:2", pair: 1 } }));
    const w = world((x) => {
      pairA(x);
      x.ctx.posts = [post({ channelId: "ig-1", at: iso(NOW - 30 * MIN), by: "app", state: "PUBLISHED", lane: "trialReel", testId: "block:2", pair: 1, clipId: "clip-b" })];
    });
    expect(sched(w, NOW)).toEqual({ kind: "at", at: NOW + 90 * MIN });
  });
});

describe("the request it builds itself", () => {
  it("is what the card would send for the same choices, with YouTube's choices from the consent only", () => {
    const consent = baseState().consent!;
    const item = baseItem({ channels: [
      { integrationId: "ig-1", platform: "instagram", text: "Red escapes first.", settings: { __type: "instagram" }, lane: "normal" },
      { integrationId: "yt-1", platform: "youtube", text: "Red escapes first.", settings: { __type: "youtube", title: "Which ball escapes first?", type: "private", selfDeclaredMadeForKids: "yes" }, lane: "normal" },
    ], thumbnailMs: 12_400 });
    const at = NOW + 75 * MIN;
    const draft: CardDraft = {
      clipId: "clip-1",
      channels: [
        { id: "ig-1", platform: "instagram", name: "jbl.balls", text: "Red escapes first.", settings: { __type: "instagram", post_type: "post" } },
        { id: "yt-1", platform: "youtube", name: "JBL", text: "Red escapes first.", settings: { __type: "youtube", title: "Which ball escapes first?", type: "public", selfDeclaredMadeForKids: "no" } },
      ],
      when: { kind: "schedule", local: "" },
      thumbnailMs: 12_400,
    };
    const card = { ...toRequest({ ...draft, when: { kind: "now" } }), when: iso(at) };
    expect(requestOfProposal(item, at, consent)).toEqual(card);
    const yt = requestOfProposal(item, at, consent).channels[1].settings;
    expect(yt).toMatchObject({ type: "public", selfDeclaredMadeForKids: "no" });
  });

  it("sends Instagram's trial fields only on a Trial Reel, always with MANUAL", () => {
    const consent = baseState().consent!;
    const trial = baseItem({ channels: [trialChannel({ graduation_strategy: "SS_PERFORMANCE" })], pass: { ...baseItem().pass!, role: "trialB", testId: "block:2", pair: 1 } });
    expect(requestOfProposal(trial, NOW, consent).channels[0].settings).toEqual({ __type: "instagram", post_type: "post", is_trial_reel: true, graduation_strategy: "MANUAL" });
    expect(requestOfProposal(baseItem(), NOW, consent).channels[0].settings).toEqual({ __type: "instagram", post_type: "post" });
  });
});

describe("the practice day", () => {
  it("sends nothing for 24 hours, says when each would go out, and never sends those items later", () => {
    const practice = world((w) => {
      w.state.consent!.at = iso(NOW - 3 * H);
      w.ctx.postiz = { ...w.ctx.postiz, keySavedAt: iso(NOW - D) };
      w.state.lastRunAt = iso(NOW - 5 * MIN);
    });
    const d = decide(practice);
    expect(d.status).toBe("practising");
    expect(d.items).toEqual([{ itemId: "it-1", kind: "practise", at: NOW + 75 * MIN }]);
    // a day later the same item is a practice item: it waits for the person for good
    const after = { ...practice, ctx: { ...practice.ctx, now: NOW + 22 * H, postizNow: NOW + 22 * H }, state: { ...practice.state, lastRunAt: iso(NOW + 22 * H - 5 * MIN) } };
    expect(outcomeOf(after)).toMatchObject({ kind: "wait", final: true });
    expect(reasonsOf(after)).toContain("practised");
    // unticked: no practice day
    const none = world((w) => {
      w.state.consent!.at = iso(NOW - 3 * H);
      w.state.consent!.practise = false;
      w.ctx.postiz = { ...w.ctx.postiz, keySavedAt: iso(NOW - D) };
    });
    expect(outcomeOf(none).kind).toBe("create");
  });
});

describe("the stored block and the consent screen", () => {
  it("sanitises the block: unknown keys dropped, a consent without a date or an account is no consent, nothing widened", () => {
    expect(sanitizeAutonomy(undefined)).toEqual(DEFAULT_AUTONOMY);
    expect(sanitizeAutonomy({ ...baseState(), extra: 1, consent: { ...baseState().consent, extra: true } })).toEqual(baseState());
    const noDate: Record<string, unknown> = { ...baseState().consent! };
    delete noDate.at;
    expect(sanitizeAutonomy({ ...baseState(), consent: noDate }).consent).toBeNull();
    expect(sanitizeAutonomy({ ...baseState(), consent: { ...baseState().consent, at: "yesterday" } }).consent).toBeNull();
    // a pause without a consent is no pause
    expect(sanitizeAutonomy({ consent: null, pause: { reason: "user", at: iso(NOW), until: null, channelId: null } }).pause).toBeNull();
    // an account that is not valid is dropped, never clamped: TikTok, a YouTube account without its choices, 9 posts a day, pairs on YouTube
    const accounts = [
      { channelId: "tt-1", platform: "tiktok", profile: "x", perDay: 1, trialPairs: 0, youtube: null },
      { channelId: "yt-1", platform: "youtube", profile: "JBL", perDay: 1, trialPairs: 0, youtube: null },
      { channelId: "ig-1", platform: "instagram", profile: "jbl.balls", perDay: 9, trialPairs: 0, youtube: null },
      { channelId: "yt-2", platform: "youtube", profile: "JBL2", perDay: 1, trialPairs: 1, youtube: { type: "public", selfDeclaredMadeForKids: "no" } },
      { channelId: "ig-3", platform: "instagram", profile: "ok", perDay: 2, trialPairs: 1, youtube: null },
    ];
    expect(sanitizeAutonomy({ consent: { ...baseState().consent, accounts } }).consent?.accounts.map((a) => a.channelId)).toEqual(["ig-3"]);
    expect(sanitizeAutonomy({ consent: { ...baseState().consent, accounts: accounts.slice(0, 4) } }).consent).toBeNull();
    expect(sanitizeAutonomy({ ...baseState(), deleteOnWarning: "no" }).deleteOnWarning).toBe(true);
    expect(sanitizeAutonomy({ ...baseState(), pause: { reason: "made up", at: iso(NOW) } }).pause).toBeNull();
    // an older config without the block is off
    expect(decideAutonomy(sanitizeAutonomy({}), baseCtx(), new Map()).status).toBe("off");
  });

  it("offers a tick only for Instagram and YouTube accounts, none ticked, YouTube's choices with no default, and Turn on only after the tick", () => {
    const { tickable, waits } = tickableChannels(LIVE);
    expect(tickable.map((c) => c.id)).toEqual(["ig-1", "yt-1", "ig-2"]);
    expect(waits.map((c) => c.id)).toEqual(["tt-1", "tb-1", "fb-1"]);
    const ctx = baseCtx();
    expect(consentProblems({ accounts: [], understood: false, practise: true }, ctx)).toEqual(["noAccount", "notUnderstood"]);
    const ig = { channelId: "ig-1", platform: "instagram" as const, profile: "", perDay: 3, trialPairs: 1, youtube: null };
    const yt = { channelId: "yt-1", platform: "youtube" as const, profile: "", perDay: 1, trialPairs: 0, youtube: null };
    expect(consentProblems({ accounts: [ig, yt], understood: true, practise: true }, ctx)).toEqual(["youtubeChoices"]);
    expect(consentProblems({ accounts: [ig], understood: true, practise: true }, ctx)).toEqual([]);
    expect(consentProblems({ accounts: [{ ...ig, channelId: "tb-1", platform: "instagram" }], understood: true, practise: true }, ctx)).toContain("accountNotAllowed");
    expect(consentProblems({ accounts: [ig], understood: true, practise: true }, { ...ctx, licence: { ...ctx.licence!, testMode: true } })).toContain("testMode");
    expect(consentProblems({ accounts: [ig], understood: true, practise: true }, { ...ctx, realKey: false })).toContain("testMode");
    expect(consentProblems({ accounts: [ig], understood: true, practise: true }, { ...ctx, licence: { ...ctx.licence!, pro: false } })).toContain("pro");
    expect(consentProblems({ accounts: [ig], understood: true, practise: true }, { ...ctx, learner: { ...ctx.learner, learn: false } })).toContain("learningOff");
    expect(consentProblems({ accounts: [ig], understood: true, practise: true }, { ...ctx, postiz: { ...ctx.postiz, configured: false } })).toContain("noKey");
    const consent = makeConsent({ accounts: [ig], understood: true, practise: true }, { now: NOW, appVersion: "1.8.0", postiz: ctx.postiz });
    expect(consent).toEqual({ version: AUTONOMY_CONSENT_VERSION, at: iso(NOW), appVersion: "1.8.0", postiz: { baseUrl: "https://api.postiz.com", organizationId: "org-1" }, accounts: [{ ...ig, profile: "jbl.balls" }], practise: true });
    expect(sanitizeAutonomy({ consent }).consent).toEqual(consent);
  });

  it("asks again when the scope widens, never when it narrows", () => {
    const consent = baseState().consent!;
    expect(consentWidens(null, consent)).toBe(true);
    expect(consentWidens(consent, consent)).toBe(false);
    expect(consentWidens(consent, { accounts: [consent.accounts[0]] })).toBe(false);
    expect(consentWidens(consent, { accounts: [{ ...consent.accounts[0], perDay: 2 }] })).toBe(false);
    expect(consentWidens(consent, { accounts: [{ ...consent.accounts[0], perDay: 4 }] })).toBe(true);
    expect(consentWidens(consent, { accounts: [{ ...consent.accounts[0], trialPairs: 2 }] })).toBe(true);
    expect(consentWidens(consent, { accounts: [...consent.accounts, { channelId: "ig-2", platform: "instagram-standalone", profile: "", perDay: 1, trialPairs: 0, youtube: null }] })).toBe(true);
    expect(consentWidens(consent, { accounts: [{ ...consent.accounts[1], youtube: { type: "unlisted", selfDeclaredMadeForKids: "no" } }] })).toBe(false);
    expect(consentWidens({ ...consent, accounts: [{ ...consent.accounts[1], youtube: { type: "unlisted", selfDeclaredMadeForKids: "no" } }] }, { accounts: [consent.accounts[1]] })).toBe(true);
    expect(consentWidens(consent, { accounts: [{ ...consent.accounts[1], youtube: { type: "public", selfDeclaredMadeForKids: "yes" } }] })).toBe(true);
    expect(consentWidens(consent, { accounts: consent.accounts, version: AUTONOMY_CONSENT_VERSION + 1 })).toBe(true);
  });

  it("watches its own posts while one is pending or was published in the last 24 hours", () => {
    expect(watchNeeded([], NOW)).toBe(false);
    expect(watchNeeded([post({ channelId: "ig-1", at: iso(NOW + H), by: "app" })], NOW)).toBe(true);
    expect(watchNeeded([post({ channelId: "ig-1", at: iso(NOW - 23 * H), by: "app", state: "PUBLISHED" })], NOW)).toBe(true);
    expect(watchNeeded([post({ channelId: "ig-1", at: iso(NOW - 25 * H), by: "app", state: "PUBLISHED" })], NOW)).toBe(false);
    expect(watchNeeded([post({ channelId: "ig-1", at: iso(NOW + H), by: "user" })], NOW)).toBe(false);
  });

  it("keeps every reason's permanence closed", () => {
    for (const [k, v] of Object.entries(AUTONOMY_REASONS)) expect(typeof v, k).toBe("boolean");
    expect(AUTONOMY_REASONS.paused).toBe(false);
    expect(AUTONOMY_REASONS.missedTime).toBe(true);
  });
});

// --- end autonomy ---
