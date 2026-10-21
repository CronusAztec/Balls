import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import en from "../messages/en.json";
import pl from "../messages/pl.json";
import es from "../messages/es.json";
import { BRIDGE_METHODS, EVENT_CHANNELS, IPC, POSTIZ_DEFAULT_URL, checkIpcArgs, type LibraryItem, type PostizChannel, type PostizConnection, type PostizKeyStatus, type PostizNotice, type SocialPostOutcome } from "@/lib/desktop/contract";
import { AccountsView, POSTIZ_PLATFORM_NAMES, platformLabel, savePostizKey, type AccountsViewState } from "@/components/simulator/desktop/AccountsPanel";
import { PostizPostCardView, initialCardState, type PostCardState } from "@/components/simulator/desktop/PostizPostCard";
import { PostsView, clipOfPost, groupOf, type PostsViewState } from "@/components/simulator/desktop/PostsPanel";
import { approveLabelKey, cardChannelOf, cardProblems, defaultSettingsFor, defaultTextFor, genericFieldsOf, isoToLocal, localToIso, toRequest, type CardChannel, type CardDraft, type TikTokSettings, type YouTubeSettings } from "@/lib/desktop/socialCard";
import { EntitlementRequiredError, type EntitlementDecision } from "@/lib/billing/guard";
import type { SocialBridge } from "@/lib/desktop/capabilities";

/*
 * --- social-postiz --- The page's side of phase 1 (docs/SOCIAL-AUTOPILOT.md): the Accounts tab in every state it shows (no key,
 * a key with channels and notices, a failure), the Pro gate in front of saving a key, the bridge namespace the page calls,
 * and the Postiz strings in the three languages.
 */

(globalThis as { React?: unknown }).React = React; // (vitest compiles .tsx with the classic JSX runtime)

type Messages = typeof en;
const LOCALES: Record<string, Messages> = { en, pl: pl as unknown as Messages, es: es as unknown as Messages };

function render(state: AccountsViewState, locale = "en"): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(AccountsView, { state, onSave: async () => true, onForget: () => {}, onRefresh: () => {} }),
    ),
  );
}

const channels: PostizChannel[] = [
  { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: "https://cdn.postiz.example/tt.png", disabled: false, customer: null },
  { id: "int-yt", name: "Gerald Shorts", platform: "youtube", picture: null, disabled: true, customer: { id: "c1", name: "Studio" } },
  { id: "int-bs", name: "gerald.bsky.social", platform: "bluesky", picture: null, disabled: false, customer: null },
];
const notices: PostizNotice[] = [{ id: "n1", content: "TikTok login expired", createdAt: "2026-10-18T09:00:00.000Z", read: false }];
const status = (configured: boolean, encryption = true): PostizKeyStatus => ({ configured, baseUrl: configured ? "https://postiz.example.com/api" : POSTIZ_DEFAULT_URL, encryption });
const base: AccountsViewState = { status: null, channels: [], notices: [], error: null, message: null, busy: false };

const attr = (html: string, testId: string) => html.match(new RegExp(`<[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? "";

describe("the Accounts tab", () => {
  it("is the fifth tab of the Desktop group", () => {
    // (the section is read as text: importing it would pull the site's navigation into a Node test)
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    expect(section).toMatch(/export const DESKTOP_TABS = \["gpu", "queue", "ai", "library", "accounts"/);
    expect(section).toContain("`desktop-tab-${id}`");
    // --- old-bridge --- (in an app older than Postiz the tab says which version brings it)
    expect(section).toMatch(/tab === "accounts" && \(socialBridge \? <AccountsPanel bridge=\{socialBridge\}[^\n]*: <NeedsNewerApp capability="social" \/>\)/);
  });

  it("without a key: the paste card with the default address, a password field, the explanation, and no channel list", () => {
    const html = render({ ...base, status: status(false) });
    expect(attr(html, "postiz-status")).toContain('data-postiz-configured="0"');
    expect(html).toContain(en.Desktop.postizStatusNone);
    expect(attr(html, "postiz-url")).toContain(`value="${POSTIZ_DEFAULT_URL}"`);
    const key = attr(html, "postiz-key");
    expect(key).toContain('type="password"');
    expect(key).toContain('value=""');
    expect(key.toLowerCase()).toContain('autocomplete="off"');
    expect(attr(html, "postiz-save")).toContain("disabled"); // nothing pasted yet
    expect(html).toContain("Postiz → Settings → Developers → Public API");
    expect(html).toContain("The key stays on this PC.");
    expect(html).not.toContain('data-testid="postiz-channels"');
    expect(html).not.toContain('data-testid="postiz-notices"');
    expect(html).not.toContain('data-testid="postiz-forget"');
  });

  it("with a key: the stored address, the channels with picture, name, platform and the disabled badge, the notices, Refresh and Forget", () => {
    const html = render({ ...base, status: status(true), channels, notices, message: "Connected to Gerald Studio · 3 channels" });
    expect(attr(html, "postiz-status")).toContain('data-postiz-configured="1"');
    expect(html).toContain("Key saved · https://postiz.example.com/api");
    expect(attr(html, "postiz-url")).toContain('value="https://postiz.example.com/api"');
    // the key is never echoed back: the field is empty and offers to replace the saved one
    const key = attr(html, "postiz-key");
    expect(key).toContain('value=""');
    expect(key).toContain(en.Desktop.postizKeyReplace);
    expect(html).toContain('data-testid="postiz-forget"');
    expect(html).toContain('data-testid="postiz-refresh"');
    expect(html).toContain("Channels · 3");
    const rows = html.match(/<li[^>]*data-testid="postiz-channel"[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(3);
    expect(rows[0]).toContain('data-platform="tiktok"');
    expect(rows[0]).toContain('src="https://cdn.postiz.example/tt.png"');
    expect(rows[0]).toContain("Gerald on TikTok");
    expect(rows[0]).toContain("TikTok");
    expect(rows[0]).toContain('data-disabled="0"');
    const badge = (row: string) => row.match(/<span[^>]*uppercase[^>]*>([^<]*)<\/span>/)?.[1] ?? null;
    expect(badge(rows[0] ?? "")).toBeNull();
    expect(rows[1]).toContain('data-disabled="1"');
    expect(badge(rows[1] ?? "")).toBe(en.Desktop.postizDisabled);
    expect(rows[1]).toContain("YouTube · Studio");
    expect(rows[1]).not.toContain("<img");
    expect(rows[2]).toContain("Bluesky");
    expect(html).toContain('data-testid="postiz-notices"');
    expect(html).toContain("TikTok login expired");
    expect(html).toContain("2026-10-18 09:00");
    expect(attr(html, "postiz-message")).toBeTruthy();
    expect(html).toContain("Connected to Gerald Studio · 3 channels");
    expect(html).not.toContain('data-testid="postiz-error"');
    // an empty channel list says where channels come from
    const empty = render({ ...base, status: status(true) });
    expect(empty).toContain(en.Desktop.postizChannelsEmpty);
    expect(empty).toContain(en.Desktop.postizNoticesEmpty);
  });

  it("shows a failure in red, the busy label while checking, and the missing-encryption warning", () => {
    const failed = render({ ...base, status: status(false), error: "Postiz does not accept this API key" });
    expect(attr(failed, "postiz-error")).toContain('role="alert"');
    expect(failed).toContain("Postiz does not accept this API key");
    const busy = render({ ...base, status: status(true), busy: true });
    expect(busy).toContain(en.Desktop.postizSaving);
    expect(attr(busy, "postiz-save")).toContain("disabled");
    expect(attr(busy, "postiz-forget")).toContain("disabled");
    const noCrypto = render({ ...base, status: status(false, false) });
    expect(noCrypto).toContain(en.Desktop.postizNoEncryption);
    // before the bridge answered: nothing claimed either way
    const loading = render(base);
    expect(attr(loading, "postiz-status")).toContain('data-postiz-configured="0"');
    expect(loading).not.toContain(en.Desktop.postizStatusNone);
  });

  it("renders in Polish and Spanish with the same structure", () => {
    for (const locale of ["pl", "es"]) {
      const html = render({ ...base, status: status(true), channels, notices }, locale);
      expect(html).toContain(LOCALES[locale].Desktop.postizTitle);
      expect(html).toContain(LOCALES[locale].Desktop.postizForget);
      expect(html).toContain(LOCALES[locale].Desktop.postizDisabled);
      expect(html.match(/data-testid="postiz-channel"/g)).toHaveLength(3);
    }
  });

  it("names the platforms as they name themselves and leaves unknown identifiers as they are", () => {
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("instagram-standalone")).toBe("Instagram");
    expect(platformLabel("youtube")).toBe("YouTube");
    expect(platformLabel("some-new-network")).toBe("some-new-network");
    for (const name of Object.values(POSTIZ_PLATFORM_NAMES)) expect(name.length).toBeGreaterThan(0);
  });
});

describe("saving a Postiz key is Pro", () => {
  const connection: PostizConnection = { organization: { id: "org-1", name: "Gerald Studio" }, channels };
  const bridge = () => {
    const set = vi.fn(async () => connection);
    return { bridge: { social: { key: { set, status: vi.fn(), forget: vi.fn() }, channels: { list: vi.fn() }, notices: { list: vi.fn() } } } as unknown as Pick<SocialBridge, "social">, set };
  };

  it("refuses without an entitlement: the Unlock dialog opens and nothing reaches the bridge", async () => {
    const { bridge: b, set } = bridge();
    const unlock = vi.fn();
    const refusal: EntitlementDecision = { ok: false, feature: "publish", reason: "free" };
    await expect(savePostizKey(b, { baseUrl: POSTIZ_DEFAULT_URL, apiKey: "pz_key" }, { require: async () => refusal, unlock })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(unlock).toHaveBeenCalledWith(refusal);
    expect(set).not.toHaveBeenCalled();
    const expired: EntitlementDecision = { ok: false, feature: "publish", reason: "expired" };
    await expect(savePostizKey(b, { baseUrl: POSTIZ_DEFAULT_URL, apiKey: "pz_key" }, { require: async () => expired, unlock })).rejects.toThrow(/Pro licence/);
    expect(set).not.toHaveBeenCalled();
  });

  it("saves through the bridge with a Pro licence", async () => {
    const { bridge: b, set } = bridge();
    const unlock = vi.fn();
    const grant: EntitlementDecision = { ok: true, feature: "publish", plan: "monthly", expiresAt: Date.now() + 1000 };
    await expect(savePostizKey(b, { baseUrl: POSTIZ_DEFAULT_URL, apiKey: "pz_key" }, { require: async () => grant, unlock })).resolves.toEqual(connection);
    expect(set).toHaveBeenCalledWith({ baseUrl: POSTIZ_DEFAULT_URL, apiKey: "pz_key" });
    expect(unlock).not.toHaveBeenCalled();
  });

  it("uses the real guard by default (the page's entitlement store answers 'free' in a test)", async () => {
    const { bridge: b, set } = bridge();
    await expect(savePostizKey(b, { baseUrl: POSTIZ_DEFAULT_URL, apiKey: "pz_key" })).rejects.toBeInstanceOf(EntitlementRequiredError);
    expect(set).not.toHaveBeenCalled();
  });
});

describe("the social bridge namespace", () => {
  it("has the five phase-1 methods, the seven of phase 2, the eight of phases 3–4, and their argument checks", () => {
    const social = Object.entries(BRIDGE_METHODS).filter(([k]) => k.startsWith("social."));
    expect(social).toEqual([
      ["social.key.status", "social:key-status"],
      ["social.key.set", "social:key-set"],
      ["social.key.forget", "social:key-forget"],
      ["social.channels.list", "social:channels"],
      ["social.notices.list", "social:notices"],
      // phase 2
      ["social.prepare", "social:prepare"],
      ["social.post", "social:post"],
      ["social.posts", "social:posts"],
      ["social.postDelete", "social:post-delete"],
      ["social.audit", "social:audit"],
      ["social.channelSettings", "social:channel-settings"],
      ["social.slot", "social:slot"],
      // --- social-autopilot --- phases 3–4
      ["social.queue.list", "social:queue-list"],
      ["social.queue.propose", "social:queue-propose"],
      ["social.queue.approve", "social:queue-approve"],
      ["social.queue.edit", "social:queue-edit"],
      ["social.queue.skip", "social:queue-skip"],
      ["social.queue.remove", "social:queue-remove"],
      ["social.autopilot.get", "social:autopilot-get"],
      ["social.autopilot.set", "social:autopilot-set"],
    ]);
    expect(EVENT_CHANNELS.socialProgress).toBe("social:progress");
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: POSTIZ_DEFAULT_URL, apiKey: "k" }])).toBeNull();
    expect(checkIpcArgs(IPC.socialKeySet, [{ baseUrl: POSTIZ_DEFAULT_URL, apiKey: "" }])).toMatch(/apiKey/);
    expect(checkIpcArgs(IPC.socialChannels, [true])).toBeNull();
    expect(checkIpcArgs(IPC.socialNotices, [-1])).toMatch(/page/);
  });
});

type Tree = { [k: string]: string | Tree };
function flat(o: Tree, prefix = ""): string[] {
  return Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [`${prefix}${k}`] : flat(v, `${prefix}${k}.`)));
}

describe("the Postiz strings", () => {
  const postizKeys = (m: unknown) => flat((m as { Desktop: Tree }).Desktop).filter((k) => k.startsWith("postiz") || k === "tab.accounts").sort();
  it("are the same keys in English, Polish and Spanish, and every key the panel uses exists", () => {
    expect(postizKeys(pl)).toEqual(postizKeys(en));
    expect(postizKeys(es)).toEqual(postizKeys(en));
    expect(postizKeys(en).length).toBeGreaterThan(20);
    const all = new Set(flat((en as unknown as { Desktop: Tree }).Desktop));
    const panel = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", "AccountsPanel.tsx"), "utf8");
    const used = [...panel.matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(15);
    expect(used.filter((k) => !all.has(k))).toEqual([]);
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, string> }[]) {
      expect(m.Desktop.postizConnected).toContain("{organization}");
      expect(m.Desktop.postizConnected).toContain("{count, plural");
      expect(m.Desktop.postizStatusOn).toContain("{baseUrl}");
      expect(m.Desktop.postizChannelsTitle).toContain("{count}");
      expect(m.Desktop.postizWhereKey).toContain("Settings → Developers → Public API");
      // the house style: no dashes as punctuation, no semicolons, no stray English in the translations
      // (phase 2 added nested groups such as postizPhase and postizGroup: every string under a postiz* key is checked)
      for (const key of flat((m as unknown as { Desktop: Tree }).Desktop).filter((k) => k.startsWith("postiz"))) {
        const text = key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], m.Desktop) as string;
        expect(text, key).not.toMatch(/—| – |;/);
      }
    }
    expect((pl as unknown as { Desktop: Record<string, string> }).Desktop.postizIntro).not.toMatch(/\bthe\b|\bkey\b/);
    expect((es as unknown as { Desktop: Record<string, string> }).Desktop.postizIntro).not.toMatch(/\bthe\b|\bkey\b/);
  });
});

/* ------------------------------------------------------------------ phase 2: the approval card and the Posts tab */

const item: LibraryItem = {
  id: "lib1",
  path: "C:/Videos/glass.mp4",
  fileName: "glass.mp4",
  bytes: 4_000_000,
  durationSec: 12,
  width: 1080,
  height: 1920,
  encoder: "h264_nvenc",
  createdAt: 1,
  exists: true,
  thumbnail: "data:image/jpeg;base64,/9j/",
  meta: { title: "Glass smash", mode: "glass", seed: 7, link: "https://x/en/simulator/?mode=glass", platform: "tiktok", hook: "Pip vs glass", caption: "Which floor breaks first?", hashtags: ["#glass", "#asmr"], queueJobId: null },
};
const cardChannels: PostizChannel[] = [...channels, { id: "int-ig", name: "gerald.reels", platform: "instagram-standalone", picture: null, disabled: false, customer: null }];
const NOW = Date.parse("2026-10-18T12:00:00.000Z");

function renderCard(state: PostCardState, locale = "en"): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
      createElement(PostizPostCardView, { item, state, now: NOW, onDraft: () => {}, onApprove: () => {}, onClose: () => {}, onSlot: () => {} }),
    ),
  );
}
const cardState = (draft: Partial<CardDraft>, over: Partial<PostCardState> = {}): PostCardState => ({ ...initialCardState(item), channels: cardChannels, draft: { ...initialCardState(item).draft, ...draft }, ...over });
const chosen = (id: string, text?: string): CardChannel => cardChannelOf(cardChannels.find((c) => c.id === id)!, item.meta, text);
const problemKeys = (html: string) => [...html.matchAll(/data-problem="([^"]+)"/g)].map((m) => m[1]);
// (React renders a disabled button as `disabled=""`; the button's classes carry "disabled:" variants, so the attribute is checked)
const approve = (html: string) => (/ disabled=""/.test(attr(html, "postiz-approve")) ? "disabled" : "enabled");
const approveText = (html: string) => html.match(/<button[^>]*data-testid="postiz-approve"[^>]*>([^<]*)<\/button>/)?.[1] ?? "";
const tiktokReady: TikTokSettings = { __type: "tiktok", privacy_level: "PUBLIC_TO_EVERYONE", comment: true, duet: false, stitch: false, brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: "DIRECT_POST", video_made_with_ai: true, autoAddMusic: "no" }; // --- review fix (social-postiz) ---

describe("the Postiz approval card", () => {
  it("is opened from the Library's target and sits above the tabs; the Posts tab is the sixth", () => {
    const section = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "sections", "DesktopSection.tsx"), "utf8");
    expect(section).toMatch(/export const DESKTOP_TABS = \["gpu", "queue", "ai", "library", "accounts"[^,\]]*, "posts"/);
    expect(section).toMatch(/tab === "posts" && socialBridge && \(\s*<PostsPanel\s+bridge=\{socialBridge\}/); // --- social-autopilot --- (the panel takes the autopilot and Review now)
    expect(section).toContain('{tab === "posts" && !socialBridge && <NeedsNewerApp capability="social" />}'); // --- old-bridge ---
    expect(section).toMatch(/postizCard && socialBridge && <PostizPostCard/);
    expect(section).toContain("onOpenPostizCard: (item) =>");
  });

  it("shows the clip, every channel (disabled ones greyed and unticked), and holds Approve until a channel is ticked", () => {
    const html = renderCard(cardState({}));
    expect(html).toContain('data-testid="postiz-post-card"');
    expect(attr(html, "postiz-card-clip")).toBeTruthy();
    expect(html).toContain("Glass smash");
    expect(html).toContain("12.0 s · 3.8 MB · 1080×1920");
    const rows = html.match(/<label[^>]*data-testid="postiz-card-channel"[^>]*>/g) ?? [];
    expect(rows).toHaveLength(4);
    expect(rows[1]).toContain('data-platform="youtube"');
    expect(rows[1]).toContain('data-disabled="1"');
    expect(rows[1]).toContain("opacity-50");
    expect(html).toMatch(/data-testid="postiz-card-channel" data-platform="youtube"[^>]*>\s*<input type="checkbox"[^>]*disabled/);
    expect(approve(html)).toContain("disabled");
    expect(problemKeys(html)).toEqual(["postizProblemNoChannel"]);
    expect(approveText(html)).toBe("Post now to 0 channels");
    expect(html).toContain(en.Desktop.postizCardIntro);
    expect(html).toContain(en.Desktop.postizApproveHint);
    // nothing claims the clip is on its way or done
    expect(html).not.toContain('data-testid="postiz-card-progress"');
    expect(html).not.toContain('data-testid="postiz-card-result"');
  });

  it("TikTok: Approve stays disabled until the audience and comments, duet and stitch are chosen (no defaults), the clip is marked AI, the audit note is shown", () => {
    const tt = chosen("int-tt");
    expect(tt.text).toBe("Which floor breaks first?\n\n#glass #asmr");
    expect(tt.settings).toEqual({ __type: "tiktok", brand_content_toggle: false, brand_organic_toggle: false, content_posting_method: "DIRECT_POST", video_made_with_ai: true, autoAddMusic: "no" });
    const html = renderCard(cardState({ channels: [tt] }));
    expect(approve(html)).toContain("disabled");
    expect(problemKeys(html)).toEqual(["postizProblemTikTokPrivacy", "postizProblemTikTokInteractions"]);
    expect(html).toContain(en.Desktop.postizTikTokAuditNote);
    expect(html).toContain("posts privately whatever you choose");
    for (const level of ["PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"]) expect(attr(html, `postiz-tt-privacy-${level}`)).not.toContain("checked");
    for (const k of ["comment", "duet", "stitch"]) expect(attr(html, `postiz-tt-${k}`)).toContain('data-chosen="0"');
    expect(attr(html, "postiz-tt-ai")).toContain("checked");
    // --- review fix (social-postiz) --- Postiz requires autoAddMusic; the card offers it off, as "yes" | "no" in the request
    expect(attr(html, "postiz-tt-music")).not.toContain("checked");
    expect(html).toContain(en.Desktop.postizTikTokAutoMusic);
    expect(attr(renderCard(cardState({ channels: [{ ...tt, settings: { ...tiktokReady, autoAddMusic: "yes" } }] })), "postiz-tt-music")).toContain("checked");
    expect(toRequest({ clipId: "lib1", channels: [{ ...tt, settings: { ...tiktokReady, autoAddMusic: "yes" } }], when: { kind: "now" } }).channels[0].settings).toMatchObject({ autoAddMusic: "yes" });
    expect(toRequest({ clipId: "lib1", channels: [{ ...tt, settings: { ...tiktokReady, autoAddMusic: undefined as unknown as "no" } }], when: { kind: "now" } }).channels[0].settings).toMatchObject({ autoAddMusic: "no" });
    expect(attr(html, "postiz-tt-brand-content")).not.toContain("checked");
    expect(attr(html, "postiz-tt-method-DIRECT_POST")).toContain("checked");
    expect(html).toContain(en.Desktop.postizTikTokDirectHint);
    // the audience alone is not enough; the audience and the three interactions are
    const partly = renderCard(cardState({ channels: [{ ...tt, settings: { ...tt.settings, privacy_level: "SELF_ONLY", comment: false } as TikTokSettings }] }));
    expect(problemKeys(partly)).toEqual(["postizProblemTikTokInteractions"]);
    expect(approve(partly)).toContain("disabled");
    const ready = renderCard(cardState({ channels: [{ ...tt, settings: tiktokReady }] }));
    expect(problemKeys(ready)).toEqual([]);
    expect(approve(ready)).not.toContain("disabled");
    expect(approveText(ready)).toBe("Post now to 1 channel");
    expect(attr(ready, "postiz-tt-privacy-PUBLIC_TO_EVERYONE")).toContain("checked");
    for (const k of ["comment", "duet", "stitch"]) expect(attr(ready, `postiz-tt-${k}`)).toContain('data-chosen="1"');
    // UPLOAD explains the inbox
    const upload = renderCard(cardState({ channels: [{ ...tt, settings: { ...tiktokReady, content_posting_method: "UPLOAD" } }] }));
    expect(upload).toContain(en.Desktop.postizTikTokUploadHint);
    // the request carries the full settings
    expect(toRequest({ clipId: "lib1", channels: [{ ...tt, settings: { ...tiktokReady, title: " Smash " } }], when: { kind: "now" } })).toEqual({
      clipId: "lib1",
      channels: [{ id: "int-tt", platform: "tiktok", text: tt.text, settings: { ...tiktokReady, title: "Smash" } }],
      when: "now",
    });
  });

  it("TikTok: branded content cannot be visible to the user only – the card says so and blocks Approve", () => {
    const tt = chosen("int-tt");
    const branded = renderCard(cardState({ channels: [{ ...tt, settings: { ...tiktokReady, privacy_level: "SELF_ONLY", brand_content_toggle: true } }] }));
    expect(problemKeys(branded)).toEqual(["postizProblemTikTokBrandedPrivate"]);
    expect(attr(branded, "postiz-tt-branded-private")).toBeTruthy();
    expect(branded).toContain(en.Desktop.postizProblemTikTokBrandedPrivate);
    expect(approve(branded)).toContain("disabled");
    const organic = cardProblems({ clipId: "lib1", channels: [{ ...tt, settings: { ...tiktokReady, privacy_level: "SELF_ONLY", brand_organic_toggle: true } }], when: { kind: "now" } }, NOW);
    expect(organic.map((p) => p.key)).toEqual(["postizProblemTikTokBrandedPrivate"]);
    const publicBranded = renderCard(cardState({ channels: [{ ...tt, settings: { ...tiktokReady, brand_content_toggle: true } }] }));
    expect(problemKeys(publicBranded)).toEqual([]);
    expect(approve(publicBranded)).not.toContain("disabled");
    // the caption limit and the title limit
    expect(cardProblems({ clipId: "lib1", channels: [{ ...tt, text: "x".repeat(2201), settings: { ...tiktokReady, title: "t".repeat(91) } }], when: { kind: "now" } }, NOW).map((p) => [p.key, p.params?.max])).toEqual([
      ["postizProblemTextLong", 2200],
      ["postizProblemTikTokTitle", 90],
    ]);
  });

  it("YouTube: the title (2 to 100), the visibility and made-for-kids are required with no defaults; the description is the text", () => {
    const yt = cardChannelOf({ id: "int-yt", platform: "youtube", name: "Gerald Shorts" }, item.meta);
    expect(yt.settings).toEqual({ __type: "youtube", title: "Glass smash" });
    const html = renderCard(cardState({ channels: [yt] }));
    expect(problemKeys(html)).toEqual(["postizProblemYouTubeVisibility", "postizProblemYouTubeKids"]);
    expect(approve(html)).toContain("disabled");
    expect(attr(html, "postiz-yt-title")).toContain('value="Glass smash"');
    expect(html).toContain(en.Desktop.postizTextDescription);
    for (const v of ["public", "private", "unlisted"]) expect(attr(html, `postiz-yt-type-${v}`)).not.toContain("checked");
    expect(attr(html, "postiz-yt-kids-yes")).not.toContain("checked");
    expect(attr(html, "postiz-yt-kids-no")).not.toContain("checked");
    const short = cardProblems({ clipId: "lib1", channels: [{ ...yt, settings: { __type: "youtube", title: "G", type: "public", selfDeclaredMadeForKids: "no" } }], when: { kind: "now" } }, NOW);
    expect(short.map((p) => p.key)).toEqual(["postizProblemYouTubeTitle"]);
    const angle = cardProblems({ clipId: "lib1", channels: [{ ...yt, settings: { __type: "youtube", title: "a <b>", type: "public", selfDeclaredMadeForKids: "no" } }], when: { kind: "now" } }, NOW);
    expect(angle.map((p) => p.key)).toEqual(["postizProblemYouTubeTitle"]);
    const long = cardProblems({ clipId: "lib1", channels: [{ ...yt, text: "ż".repeat(2501), settings: { __type: "youtube", title: "Glass", type: "public", selfDeclaredMadeForKids: "no", tags: "x".repeat(501) } }], when: { kind: "now" } }, NOW);
    expect(long.map((p) => p.key)).toEqual(["postizProblemTextLong", "postizProblemYouTubeTags"]); // 2501 two-byte characters are over 5000 bytes
    // --- review fix (social-postiz) --- Postiz takes "yes" | "no", not a boolean: a boolean counts as unanswered
    expect(cardProblems({ clipId: "lib1", channels: [{ ...yt, settings: { __type: "youtube", title: "Glass", type: "public", selfDeclaredMadeForKids: false as unknown as "no" } }], when: { kind: "now" } }, NOW).map((p) => p.key)).toEqual(["postizProblemYouTubeKids"]);
    const ready: YouTubeSettings = { __type: "youtube", title: "Glass smash", type: "unlisted", selfDeclaredMadeForKids: "no", tags: "glass, asmr, ,physics" };
    const ok = renderCard(cardState({ channels: [{ ...yt, settings: ready }] }));
    expect(problemKeys(ok)).toEqual([]);
    expect(attr(ok, "postiz-yt-kids-no")).toContain("checked");
    expect(attr(renderCard(cardState({ channels: [{ ...yt, settings: { ...ready, selfDeclaredMadeForKids: "yes" } }] })), "postiz-yt-kids-yes")).toContain("checked");
    expect(toRequest({ clipId: "lib1", channels: [{ ...yt, settings: { ...ready, selfDeclaredMadeForKids: "yes" } }], when: { kind: "now" } }).channels[0].settings).toMatchObject({ selfDeclaredMadeForKids: "yes" });
    expect(approve(ok)).not.toContain("disabled");
    expect(toRequest({ clipId: "lib1", channels: [{ ...yt, settings: ready }], when: { kind: "now" } }).channels[0].settings).toEqual({
      __type: "youtube",
      title: "Glass smash",
      type: "unlisted",
      selfDeclaredMadeForKids: "no",
      tags: [
        { value: "glass", label: "glass" },
        { value: "asmr", label: "asmr" },
        { value: "physics", label: "physics" },
      ],
    });
  });

  it("Instagram: a video post is a Reel (public) or a story, collaborators become Postiz's list, 30 hashtags at most", () => {
    const ig = chosen("int-ig");
    expect(ig.settings).toEqual({ __type: "instagram-standalone", post_type: "post" });
    const post = renderCard(cardState({ channels: [ig] }));
    expect(attr(post, "postiz-ig-post")).toContain("checked");
    expect(post).toContain(en.Desktop.postizInstagramReelHint);
    expect(post).toContain("39/2200");
    expect(post).toContain("2/30 hashtags");
    expect(problemKeys(post)).toEqual([]);
    expect(approve(post)).not.toContain("disabled");
    const story = renderCard(cardState({ channels: [{ ...ig, settings: { __type: "instagram-standalone", post_type: "story", collaborators: "@friend, other.name, " } }] }));
    expect(attr(story, "postiz-ig-story")).toContain("checked");
    expect(story).toContain(en.Desktop.postizInstagramStoryHint);
    expect(toRequest({ clipId: "lib1", channels: [{ ...ig, settings: { __type: "instagram-standalone", post_type: "story", collaborators: "@friend, other.name, " } }], when: { kind: "draft" } })).toEqual({
      clipId: "lib1",
      channels: [{ id: "int-ig", platform: "instagram-standalone", text: ig.text, settings: { __type: "instagram-standalone", post_type: "story", collaborators: [{ label: "friend" }, { label: "other.name" }] } }],
      when: "draft",
    });
    const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    expect(cardProblems({ clipId: "lib1", channels: [{ ...ig, text: tags }], when: { kind: "now" } }, NOW).map((p) => p.key)).toEqual(["postizProblemHashtags"]);
    expect(defaultSettingsFor("instagram")).toEqual({ __type: "instagram", post_type: "post" });
  });

  it("other platforms: caption only, or the required fields of Postiz's schema as simple inputs", () => {
    const bs = chosen("int-bs");
    expect(bs.settings).toEqual({ __type: "bluesky" });
    const plain = renderCard(cardState({ channels: [bs] }, { schemas: { "int-bs": { identifier: "bluesky", maxLength: 300, settings: [] } } }));
    expect(plain).not.toContain('data-testid="postiz-generic-form"');
    expect(plain).toContain("/300");
    expect(problemKeys(plain)).toEqual([]);
    const schema = { settings: [{ name: "subreddit", type: "string", required: true }, { name: "nsfw", type: "boolean", required: true }, { name: "flair", type: "string", required: false }, { name: "kind", options: ["link", "self"], required: true }] };
    expect(genericFieldsOf(schema)).toEqual([
      { name: "subreddit", type: "string", required: true, options: [] },
      { name: "nsfw", type: "boolean", required: true, options: [] },
      { name: "kind", type: "enum", required: true, options: ["link", "self"] },
    ]);
    expect(genericFieldsOf({ settings: { properties: { title: { type: "string" }, flair: { type: "string" } }, required: ["title"] } })).toEqual([{ name: "title", type: "string", required: true, options: [] }]);
    expect(genericFieldsOf(null)).toEqual([]);
    expect(genericFieldsOf({ identifier: "x" })).toEqual([]);
    const form = renderCard(cardState({ channels: [bs] }, { schemas: { "int-bs": schema } }));
    expect(form).toContain('data-testid="postiz-generic-form"');
    expect(attr(form, "postiz-generic-subreddit")).toBeTruthy();
    expect(problemKeys(form)).toEqual(["postizProblemRequired", "postizProblemRequired", "postizProblemRequired"]);
    expect(form).toContain("gerald.bsky.social: Fill in subreddit.");
    const filled = renderCard(cardState({ channels: [{ ...bs, settings: { __type: "bluesky", subreddit: "r/balls", nsfw: false, kind: "link" } }] }, { schemas: { "int-bs": schema } }));
    expect(problemKeys(filled)).toEqual([]);
    expect(approve(filled)).not.toContain("disabled");
    // the long caption of a platform the card has no form of: Postiz's maxLength
    expect(cardProblems({ clipId: "lib1", channels: [{ ...bs, text: "x".repeat(301) }], when: { kind: "now" } }, NOW, {}, { "int-bs": { maxLength: 300 } }).map((p) => p.params?.max)).toEqual([300]);
  });

  it("when: now, a schedule (local time, in the future, with Next free slot) or a draft – and the Approve button says what will happen", () => {
    const tt = { ...chosen("int-tt"), settings: tiktokReady };
    const now = renderCard(cardState({ channels: [tt, chosen("int-ig")] }));
    expect(approveText(now)).toBe("Post now to 2 channels");
    expect(attr(now, "postiz-when-now")).toContain("checked");
    expect(now).not.toContain('data-testid="postiz-when-local"');
    const past = renderCard(cardState({ channels: [tt], when: { kind: "schedule", local: isoToLocal("2026-10-18T11:00:00.000Z") } }));
    expect(problemKeys(past)).toEqual(["postizProblemWhenPast"]);
    expect(approve(past)).toContain("disabled");
    expect(past).toContain(en.Desktop.postizProblemWhenPast);
    expect(attr(past, "postiz-slot")).toBeTruthy();
    expect(attr(past, "postiz-when-local")).toBeTruthy();
    const nothing = renderCard(cardState({ channels: [tt], when: { kind: "schedule", local: "" } }));
    expect(problemKeys(nothing)).toEqual(["postizProblemWhenInvalid"]);
    const future = renderCard(cardState({ channels: [tt], when: { kind: "schedule", local: isoToLocal("2026-10-19T17:00:00.000Z") } }));
    expect(problemKeys(future)).toEqual([]);
    expect(approve(future)).not.toContain("disabled");
    expect(approveText(future)).toMatch(/^Schedule for .+ · 1 channel$/);
    expect(approveLabelKey({ kind: "schedule", local: "x" })).toBe("postizApproveSchedule");
    const draft = renderCard(cardState({ channels: [tt], when: { kind: "draft" } }));
    expect(approveText(draft)).toBe("Save draft in Postiz · 1 channel");
    expect(draft).toContain(en.Desktop.postizWhenDraftHint);
    // the local time round-trips through UTC ISO
    const iso = "2026-10-19T17:30:00.000Z";
    expect(localToIso(isoToLocal(iso))).toBe(iso);
    expect(localToIso("soon")).toBeNull();
    expect(toRequest({ clipId: "lib1", channels: [tt], when: { kind: "schedule", local: isoToLocal(iso) } }).when).toBe(iso);
    // a channel with no slot button: none ticked
    const none = renderCard(cardState({ when: { kind: "schedule", local: isoToLocal(iso) } }));
    expect(attr(none, "postiz-slot")).toContain("disabled");
  });

  it("while sending: the progress line and a locked Approve; afterwards: the result per channel with the link, Postiz's error or 'waiting'", () => {
    const tt = { ...chosen("int-tt"), settings: tiktokReady };
    const ig = chosen("int-ig");
    const busy = renderCard(cardState({ channels: [tt] }, { busy: true, progress: { clipId: "lib1", phase: "uploading", percent: 40 } }));
    expect(approve(busy)).toContain("disabled");
    expect(busy).toContain(en.Desktop.postizApproving);
    expect(busy).toContain("Uploading the clip to Postiz · 40%");
    expect(attr(busy, "postiz-card-progress")).toBeTruthy();
    const starting = renderCard(cardState({ channels: [tt] }, { busy: true }));
    expect(starting).toContain(en.Desktop.postizPhase.starting);
    const result = { postIds: [{ channelId: "int-tt", postId: "p1" }, { channelId: "int-ig", postId: "p2" }], group: "g1" };
    const outcomes: Record<string, SocialPostOutcome> = {
      p1: { id: "p1", channel: null, state: "PUBLISHED", publishDate: "", releaseUrl: "https://www.tiktok.com/@gerald/video/1", error: null, content: "" },
      p2: { id: "p2", channel: null, state: "ERROR", publishDate: "", releaseUrl: null, error: "Instagram refused the video", content: "" },
    };
    const done = renderCard(cardState({ channels: [tt, ig] }, { result, outcomes }));
    expect(approve(done)).toContain("disabled");
    expect(done).toContain("Created 2 posts. Postiz is publishing now.");
    const rows = done.match(/<li[^>]*data-testid="postiz-card-outcome"[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('data-state="PUBLISHED"');
    expect(rows[0]).toContain('href="https://www.tiktok.com/@gerald/video/1"');
    expect(rows[1]).toContain('data-state="ERROR"');
    expect(rows[1]).toContain("Instagram refused the video");
    expect(done).toContain(en.Desktop.postizCardDone);
    const waiting = renderCard(cardState({ channels: [tt] }, { result: { postIds: [{ channelId: "int-tt", postId: "p1" }], group: null }, polling: true }));
    expect(waiting).toContain(en.Desktop.postizWaitingPostiz);
    const later = renderCard(cardState({ channels: [tt] }, { result: { postIds: [{ channelId: "int-tt", postId: "p1" }], group: null }, polling: false }));
    expect(later).toContain(en.Desktop.postizSeePostsTab);
    const scheduled = renderCard(cardState({ channels: [tt], when: { kind: "schedule", local: isoToLocal("2026-10-19T17:00:00.000Z") } }, { result }));
    expect(scheduled).toContain("Scheduled 2 posts.");
    const failed = renderCard(cardState({ channels: [tt] }, { error: "A clip is already on its way to Postiz. Wait for it to finish, then approve this one." }));
    expect(attr(failed, "postiz-card-error")).toContain('role="alert"');
    expect(failed).toContain("already on its way");
    expect(approve(failed)).not.toContain("disabled"); // the user may try again
  });

  it("pre-fills each channel with the clip's caption and hashtags, cut to the platform's limit", () => {
    expect(defaultTextFor(item.meta, "tiktok")).toBe("Which floor breaks first?\n\n#glass #asmr");
    expect(defaultTextFor({ title: "T", caption: null, hashtags: [] }, "youtube")).toBe("T");
    const long = defaultTextFor({ title: "T", caption: "word ".repeat(600), hashtags: ["#a"] }, "tiktok");
    expect(long.length).toBeLessThanOrEqual(2200);
    expect(long.endsWith("word")).toBe(true);
    expect(defaultTextFor({ title: "T", caption: "x".repeat(400), hashtags: [] }, "bluesky")).toHaveLength(400); // no known limit
  });

  it("renders in Polish and Spanish with the same structure", () => {
    for (const locale of ["pl", "es"]) {
      const html = renderCard(cardState({ channels: [chosen("int-tt"), chosen("int-ig")] }), locale);
      const m = LOCALES[locale].Desktop;
      expect(html).toContain(m.postizCardIntro);
      expect(html).toContain(m.postizTikTokAuditNote);
      expect(html).toContain(m.postizInstagramReelHint);
      expect(html).toContain(m.postizWhenNow);
      expect(problemKeys(html)).toEqual(["postizProblemTikTokPrivacy", "postizProblemTikTokInteractions"]);
      expect(html.match(/data-testid="postiz-card-channel"/g)).toHaveLength(4);
    }
  });
});

describe("the Posts tab", () => {
  const posts: SocialPostOutcome[] = [
    { id: "p1", channel: { id: "int-tt", name: "Gerald on TikTok", platform: "tiktok", picture: "https://cdn.postiz.example/tt.png" }, state: "PUBLISHED", publishDate: "2026-10-18T10:00:00.000Z", releaseUrl: "https://www.tiktok.com/@gerald/video/1", error: null, content: "Which floor breaks first?" },
    { id: "p2", channel: { id: "int-yt", name: "Gerald Shorts", platform: "youtube", picture: null }, state: "QUEUE", publishDate: "2026-10-19T17:00:00.000Z", releaseUrl: null, error: null, content: "Tomorrow" },
    { id: "p3", channel: { id: "int-ig", name: "gerald.reels", platform: "instagram-standalone", picture: null }, state: "ERROR", publishDate: "2026-10-17T10:00:00.000Z", releaseUrl: null, error: "Instagram refused the video", content: "Failed one" },
    { id: "p4", channel: null, state: "DRAFT", publishDate: "2026-10-20T10:00:00.000Z", releaseUrl: null, error: null, content: "A draft" },
  ];
  const renderPosts = (state: Partial<PostsViewState>, locale = "en") =>
    renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale, messages: LOCALES[locale], timeZone: "UTC" } as unknown as React.ComponentProps<typeof NextIntlClientProvider>,
        createElement(PostsView, { state: { configured: true, posts: [], notices: [], error: null, message: null, busy: false, ...state }, onRefresh: () => {}, onRetry: () => {}, onDelete: () => {}, onAccounts: () => {} }),
      ),
    );

  it("groups the posts into Scheduled, Posted, Failed and Drafts with the channel, time, link or error, Retry on the failed ones and Delete on all", () => {
    const html = renderPosts({ posts, notices });
    expect(html).toContain('data-testid="desktop-posts"');
    expect(html).toContain(en.Desktop.postizPostsIntro);
    for (const g of ["scheduled", "posted", "failed", "drafts"]) expect(attr(html, `postiz-group-${g}`), g).toBeTruthy();
    const order = [...html.matchAll(/data-testid="postiz-group-([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["scheduled", "posted", "failed", "drafts"]);
    expect(html).toContain("Scheduled · 1");
    const rows = html.match(/<li[^>]*data-testid="postiz-post"[^>]*>[\s\S]*?<\/li>/g) ?? [];
    expect(rows).toHaveLength(4);
    const posted = rows.find((r) => r.includes('data-post-id="p1"'))!;
    expect(posted).toContain('href="https://www.tiktok.com/@gerald/video/1"');
    expect(posted).toContain('src="https://cdn.postiz.example/tt.png"');
    expect(posted).toContain("Gerald on TikTok");
    expect(posted).toContain("TikTok");
    expect(posted).not.toContain('data-testid="postiz-post-retry"');
    expect(posted).toContain('data-testid="postiz-post-delete"');
    const failed = rows.find((r) => r.includes('data-post-id="p3"'))!;
    expect(failed).toContain("Instagram refused the video");
    expect(failed).toContain('data-testid="postiz-post-retry"');
    expect(failed).toContain('data-testid="postiz-post-delete"');
    expect(rows.filter((r) => r.includes('data-testid="postiz-post-retry"'))).toHaveLength(1);
    expect(rows.filter((r) => r.includes('data-testid="postiz-post-delete"'))).toHaveLength(4);
    expect(html).toContain("TikTok login expired");
    expect([...posts].map(groupOf)).toEqual(["posted", "scheduled", "failed", "drafts"]);
    // the delete confirmation names the group rule
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, string> }[]) expect(m.Desktop.postizDeleteConfirm).toContain("{channel}");
    expect(en.Desktop.postizDeleteConfirm).toContain("every channel");
  });

  it("without a key points to Accounts; empty, failed and busy states", () => {
    const noKey = renderPosts({ configured: false });
    expect(attr(noKey, "postiz-posts-nokey")).toBeTruthy();
    expect(noKey).toContain(en.Desktop.tab.accounts);
    expect(noKey).not.toContain('data-testid="postiz-posts-notices"');
    const empty = renderPosts({});
    expect(empty).toContain(en.Desktop.postizPostsEmpty);
    expect(empty).toContain('data-testid="postiz-posts-notices"');
    const failed = renderPosts({ error: "Postiz could not be reached" });
    expect(attr(failed, "postiz-posts-error")).toContain('role="alert"');
    const busy = renderPosts({ posts, busy: true });
    expect(attr(busy, "postiz-posts-refresh")).toContain("disabled");
    expect(busy).toMatch(/data-testid="postiz-post-delete"[^>]*disabled|disabled[^>]*data-testid="postiz-post-delete"/);
    for (const locale of ["pl", "es"]) {
      const html = renderPosts({ posts }, locale);
      expect(html).toContain(LOCALES[locale].Desktop.postizGroup.failed);
      expect(html.match(/data-testid="postiz-post"/g)).toHaveLength(4);
    }
  });

  it("finds the clip of a post through the audit log for Retry", () => {
    const audit = [
      { at: "2026-10-18T12:00:00.000Z", action: "createPosts" as const, channels: ["int-tt", "int-ig"], postIds: ["p1", "p3"], by: "user" as const, clipId: "lib1", when: "now" },
      { at: "2026-10-18T12:05:00.000Z", action: "deletePost" as const, channels: [], postIds: ["p9"], by: "user" as const, clipId: null, when: null },
    ];
    expect(clipOfPost("p3", audit, [item])).toBe(item);
    expect(clipOfPost("p9", audit, [item])).toBeNull();
    expect(clipOfPost("p3", audit, [{ ...item, exists: false }])).toBeNull();
    expect(clipOfPost("p3", audit, [])).toBeNull();
  });
});

describe("the phase-2 strings", () => {
  it("exist for every key the card and the Posts tab use, in all three languages, with the same nested groups", () => {
    const all = new Set(flat((en as unknown as { Desktop: Tree }).Desktop));
    for (const file of ["PostizPostCard.tsx", "PostsPanel.tsx"]) {
      const source = fs.readFileSync(path.join(__dirname, "..", "src", "components", "simulator", "desktop", file), "utf8");
      const used = [...source.matchAll(/\bt\("([A-Za-z0-9_.]+)"/g)].map((m) => m[1]);
      expect(used.length, file).toBeGreaterThan(10);
      expect(used.filter((k) => !all.has(k)), file).toEqual([]);
    }
    for (const m of [en, pl, es] as unknown as { Desktop: Record<string, Record<string, string>> }[]) {
      expect(Object.keys(m.Desktop.postizPhase).sort()).toEqual(["creating", "done", "starting", "transcoding", "uploading"]);
      expect(Object.keys(m.Desktop.postizTikTokPrivacyLevel).sort()).toEqual(["FOLLOWER_OF_CREATOR", "MUTUAL_FOLLOW_FRIENDS", "PUBLIC_TO_EVERYONE", "SELF_ONLY"]);
      expect(Object.keys(m.Desktop.postizTikTokInteraction).sort()).toEqual(["comment", "duet", "stitch"]);
      expect(Object.keys(m.Desktop.postizTikTokMethodName).sort()).toEqual(["DIRECT_POST", "UPLOAD"]);
      expect(Object.keys(m.Desktop.postizYouTubeVisibilityName).sort()).toEqual(["private", "public", "unlisted"]);
      expect(Object.keys(m.Desktop.postizGroup).sort()).toEqual(["drafts", "failed", "posted", "scheduled"]);
      expect(typeof m.Desktop.tab.posts).toBe("string");
      const d = m.Desktop as unknown as Record<string, string>;
      for (const key of ["postizApproveNow", "postizApproveSchedule", "postizApproveDraft"]) expect(d[key], key).toContain("{count, plural");
      expect(d.postizApproveSchedule).toContain("{date}");
      expect(d.postizPhase).toBeTypeOf("object");
      // honest: the app posts nothing the user has not approved, and TikTok posts privately until the audit
      expect(d.postizCardIntro.length).toBeGreaterThan(40);
      expect(d.postizTikTokAuditNote).toMatch(/Postiz/);
    }
    expect(en.Desktop.postizCardIntro).toContain("The app posts nothing you have not approved here.");
    expect(en.Desktop.postizTikTokAuditNote).toContain("Until TikTok has audited the Postiz app");
    expect(en.Desktop.postizPostButton).toBe("Post with Postiz");
    expect(pl.Desktop.postizPostButton).not.toMatch(/\bPost with\b/);
    expect(es.Desktop.postizPostButton).not.toMatch(/\bPost with\b/);
  });
});
