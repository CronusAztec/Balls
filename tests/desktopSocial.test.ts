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
import { BRIDGE_METHODS, IPC, POSTIZ_DEFAULT_URL, checkIpcArgs, type DesktopApi, type PostizChannel, type PostizConnection, type PostizKeyStatus, type PostizNotice } from "@/lib/desktop/contract";
import { AccountsView, POSTIZ_PLATFORM_NAMES, platformLabel, savePostizKey, type AccountsViewState } from "@/components/simulator/desktop/AccountsPanel";
import { EntitlementRequiredError, type EntitlementDecision } from "@/lib/billing/guard";

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
    expect(section).toMatch(/tab === "accounts" && <AccountsPanel/);
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
    return { bridge: { social: { key: { set, status: vi.fn(), forget: vi.fn() }, channels: { list: vi.fn() }, notices: { list: vi.fn() } } } as unknown as Pick<DesktopApi, "social">, set };
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
  it("has the five phase-1 methods and their argument checks", () => {
    const social = Object.entries(BRIDGE_METHODS).filter(([k]) => k.startsWith("social."));
    expect(social).toEqual([
      ["social.key.status", "social:key-status"],
      ["social.key.set", "social:key-set"],
      ["social.key.forget", "social:key-forget"],
      ["social.channels.list", "social:channels"],
      ["social.notices.list", "social:notices"],
    ]);
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
      for (const key of Object.keys(m.Desktop).filter((k) => k.startsWith("postiz"))) {
        expect(m.Desktop[key], key).not.toMatch(/—| – |;/);
      }
    }
    expect((pl as unknown as { Desktop: Record<string, string> }).Desktop.postizIntro).not.toMatch(/\bthe\b|\bkey\b/);
    expect((es as unknown as { Desktop: Record<string, string> }).Desktop.postizIntro).not.toMatch(/\bthe\b|\bkey\b/);
  });
});
