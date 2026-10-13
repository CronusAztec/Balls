import { describe, expect, it } from "vitest";
import { AccountClient, AccountError, checkCredentials, isEmail, parseSession } from "@/lib/account/client";
import { ACCOUNT_STORAGE_KEY, loadAccount, parseStoredAccount, saveAccount, type StoredAccount } from "@/lib/account/store";
import { ACCOUNT_PROFILE_ID, AccountController, type AccountDeps, type PublishLink } from "@/lib/account/controller";
import en from "../messages/en.json";
import es from "../messages/es.json";
import pl from "../messages/pl.json";

/*
 * --- user-accounts --- The page's side of the relay's user accounts: the client against a scripted fetch, the stored session,
 * and the controller (sign up, sign in, sign out, a dead session, the Publish relay profile it keeps) with fake storage,
 * window and Publish link. The relay's own half is tested in relay/relay.test.mjs.
 */

const RELAY = "https://relay.example";
const NOW = 1_800_000_000_000;
const user = { id: "u_1", email: "alice@example.com", name: "Alice" };
const session = (token = "jbs_abc") => ({ token, expiresAt: new Date(NOW + 30 * 24 * 3600 * 1000).toISOString(), user });

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A scripted relay: `routes` maps "METHOD /path" to a status and a JSON body (or a function of the call). */
function scripted(routes: Record<string, { status?: number; body?: unknown } | ((call: Call) => { status?: number; body?: unknown }) | Error>) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    const method = String(init.method ?? "GET").toUpperCase();
    const call: Call = { url, method, headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const route = routes[`${method} ${new URL(url).pathname}`];
    if (!route) throw new Error(`unexpected ${method} ${url}`);
    if (route instanceof Error) throw route;
    const out = typeof route === "function" ? route(call) : route;
    return new Response(out.body === undefined ? null : JSON.stringify(out.body), { status: out.status ?? 200, headers: { "Content-Type": "application/json" } });
  };
  return { fetchImpl, calls };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

describe("account client", () => {
  it("checks emails and passwords before asking", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("not an email@x.com")).toBe(false);
    expect(checkCredentials("bad", "longenough", "signup")).toBe("badEmail");
    expect(checkCredentials("a@b.co", "short", "signup")).toBe("weakPassword");
    expect(checkCredentials("a@b.co", "short", "login")).toBeNull(); // an old, shorter password may still sign in
    expect(checkCredentials("a@b.co", "", "login")).toBe("weakPassword");
    expect(checkCredentials("a@b.co", "longenough", "signup")).toBeNull();
  });

  it("signs up and in, sending JSON and reading the session", async () => {
    const { fetchImpl, calls } = scripted({ "POST /api/auth/signup": { status: 201, body: session() }, "POST /api/auth/login": { body: session("jbs_login") } });
    const client = new AccountClient(RELAY + "/", fetchImpl);
    expect(client.base).toBe(RELAY);
    const made = await client.signup(" alice@example.com ", "correct horse", " Alice ");
    expect(made.token).toBe("jbs_abc");
    expect(calls[0].body).toEqual({ email: "alice@example.com", password: "correct horse", name: "Alice" });
    expect(calls[0].headers["Content-Type"]).toBe("application/json");
    expect(calls[0].headers.Authorization).toBeUndefined();
    expect((await client.login("alice@example.com", "correct horse")).token).toBe("jbs_login");
    expect(calls[1].body).toEqual({ email: "alice@example.com", password: "correct horse" });
  });

  it("turns the relay's errors into codes and never throws anything else", async () => {
    const { fetchImpl } = scripted({
      "POST /api/auth/login": { status: 401, body: { error: { code: "bad_credentials", message: "Wrong email or password." } } },
      "POST /api/auth/signup": { status: 409, body: { error: { code: "email_taken", message: "taken" } } },
      "GET /api/health": { status: 502, body: null },
      "GET /api/me": Object.assign(new Error("offline"), {}),
    });
    const client = new AccountClient(RELAY, fetchImpl);
    await expect(client.login("a@b.co", "x")).rejects.toMatchObject({ code: "bad_credentials", status: 401 });
    await expect(client.signup("a@b.co", "xxxxxxxx")).rejects.toMatchObject({ code: "email_taken" });
    await expect(client.health()).rejects.toMatchObject({ code: "server" });
    await expect(client.me("jbs_x")).rejects.toMatchObject({ code: "network" });
    expect(() => new AccountClient("ftp://nope", fetchImpl)).toThrow(AccountError);
    // A relay that answers 200 with something else is not a relay.
    const odd = new AccountClient(RELAY, scripted({ "POST /api/auth/login": { body: { hello: 1 } } }).fetchImpl);
    await expect(odd.login("a@b.co", "x")).rejects.toMatchObject({ code: "server" });
  });

  it("reads health defensively and sends the token as a Bearer", async () => {
    const { fetchImpl, calls } = scripted({
      "GET /api/health": { body: { ok: true, platforms: { tiktok: true, instagram: false }, signup: false } },
      "GET /api/me": { body: { user } },
      "POST /api/auth/logout": { body: { ok: true } },
      "POST /api/auth/password": { body: { ok: true } },
      "DELETE /api/auth/user": { body: { ok: true } },
    });
    const client = new AccountClient(RELAY, fetchImpl);
    expect(await client.health()).toEqual({ signup: false, platforms: { tiktok: true, instagram: false, youtube: false } });
    expect(await client.me("jbs_abc")).toEqual(user);
    await client.logout("jbs_abc");
    await client.changePassword("jbs_abc", "old", "new password");
    await client.deleteAccount("jbs_abc", "pw");
    expect(calls.slice(1).every((c) => c.headers.Authorization === "Bearer jbs_abc")).toBe(true);
    expect(calls[3].body).toEqual({ current: "old", next: "new password" });
    expect(calls[4].method).toBe("DELETE");
  });

  it("parses sessions strictly", () => {
    expect(parseSession(session())?.user.name).toBe("Alice");
    expect(parseSession({ ...session(), token: "plain-access-key" })).toBeNull(); // an access key is not a session
    expect(parseSession({ ...session(), user: { id: 1 } })).toBeNull();
    expect(parseSession(null)).toBeNull();
  });
});

describe("stored account", () => {
  const stored: StoredAccount = { version: 1, relayUrl: RELAY, token: "jbs_abc", expiresAt: NOW + 1000, user };

  it("round-trips a live session and drops an expired, forged or unreadable one", () => {
    const storage = memoryStorage();
    saveAccount(stored, storage);
    expect(loadAccount(NOW, storage)).toEqual(stored);
    expect(loadAccount(NOW + 2000, storage)).toBeNull(); // expired
    expect(parseStoredAccount({ ...stored, token: "not-a-session" }, NOW)).toBeNull();
    expect(parseStoredAccount({ ...stored, relayUrl: "javascript:alert(1)" }, NOW)).toBeNull();
    expect(parseStoredAccount({ ...stored, user: { id: "x" } }, NOW)).toBeNull();
    storage.setItem(ACCOUNT_STORAGE_KEY, "{broken");
    expect(loadAccount(NOW, storage)).toBeNull();
    saveAccount(null, storage);
    expect(storage.data.has(ACCOUNT_STORAGE_KEY)).toBe(false);
  });

  it("works without storage", () => {
    expect(loadAccount(NOW, null)).toBeNull();
    expect(() => saveAccount(stored, null)).not.toThrow();
    const throwing = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(loadAccount(NOW, throwing)).toBeNull();
    expect(() => saveAccount(stored, throwing)).not.toThrow();
  });
});

function setup(options: { routes: Parameters<typeof scripted>[0]; storage?: ReturnType<typeof memoryStorage>; env?: string }) {
  const { fetchImpl, calls } = scripted(options.routes);
  const storage = options.storage ?? memoryStorage();
  const profiles = new Map<string, { url: string; key: string; label: string }>();
  const saved: string[] = [];
  const publish: PublishLink = {
    start: () => {},
    saveProfile: (input) => {
      profiles.set(input.id ?? "?", { url: input.url, key: input.key, label: input.label });
      saved.push(`${input.id}:${input.key}`);
      return null;
    },
    removeProfile: (id) => void profiles.delete(id),
    profile: (id) => profiles.get(id) ?? null,
  };
  const events: string[] = [];
  const win = { dispatchEvent: (e: Event) => void events.push(e.type) } as unknown as Window & typeof globalThis;
  const deps: AccountDeps = { fetch: () => fetchImpl, storage: () => storage, window: () => win, now: () => NOW, envRelayUrl: options.env ?? RELAY, publish: () => publish };
  const controller = new AccountController(deps);
  return { controller, calls, storage, profiles, saved, events };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("account controller", () => {
  it("signs up, keeps the session and gives Publish the relay profile", async () => {
    const t = setup({ routes: { "GET /api/health": { body: { signup: true, platforms: { tiktok: true, instagram: true, youtube: true } } }, "POST /api/auth/signup": { status: 201, body: session() } } });
    t.controller.start();
    await flush();
    expect(t.controller.getSnapshot()).toMatchObject({ ready: true, relayUrl: RELAY, session: null, healthStatus: "ok" });
    expect(await t.controller.signup("alice@example.com", "correct horse", "Alice")).toBe(true);
    const snap = t.controller.getSnapshot();
    expect(snap.session).toMatchObject({ token: "jbs_abc", relayUrl: RELAY, user });
    expect(snap.error).toBeNull();
    expect(t.profiles.get(ACCOUNT_PROFILE_ID)).toEqual({ url: RELAY, key: "jbs_abc", label: "alice@example.com" });
    expect(JSON.parse(t.storage.data.get(ACCOUNT_STORAGE_KEY)!).token).toBe("jbs_abc");
    expect(JSON.stringify([...t.storage.data.values()])).not.toContain("correct horse"); // the password is never kept
    expect(t.events).toContain("jbl-account-changed");
  });

  it("refuses bad input without asking and reports the relay's answer for a wrong password", async () => {
    const t = setup({ routes: { "GET /api/health": { body: {} }, "POST /api/auth/login": { status: 401, body: { error: { code: "bad_credentials", message: "Wrong email or password." } } } } });
    t.controller.start();
    await flush();
    expect(await t.controller.signup("nope", "correct horse")).toBe(false);
    expect(t.controller.getSnapshot().errorCode).toBe("badEmail");
    expect(await t.controller.signup("a@b.co", "short")).toBe(false);
    expect(t.controller.getSnapshot().errorCode).toBe("weakPassword");
    expect(t.calls.filter((c) => c.method === "POST")).toHaveLength(0);
    expect(await t.controller.login("alice@example.com", "wrong")).toBe(false);
    expect(t.controller.getSnapshot()).toMatchObject({ errorCode: "bad_credentials", session: null, busy: false });
    expect(t.profiles.size).toBe(0);
    t.controller.dismiss();
    expect(t.controller.getSnapshot().error).toBeNull();
  });

  it("says so when the build has no server, and uses one typed in", async () => {
    const t = setup({ routes: { "GET /api/health": { body: { signup: true } }, "POST /api/auth/login": { body: session() } }, env: "" });
    t.controller.start();
    expect(t.controller.getSnapshot().relayUrl).toBe("");
    expect(await t.controller.login("alice@example.com", "whatever")).toBe(false);
    expect(t.controller.getSnapshot().errorCode).toBe("badUrl");
    expect(t.controller.setRelayUrl("not a url ::")).toBe(false);
    expect(t.controller.setRelayUrl("my-relay.example.com/")).toBe(true);
    expect(t.controller.getSnapshot().relayUrl).toBe("https://my-relay.example.com");
    expect(await t.controller.login("alice@example.com", "whatever")).toBe(true);
    expect(t.controller.getSnapshot().session?.relayUrl).toBe("https://my-relay.example.com");
    // Back to the build's default (none here).
    expect(t.controller.setRelayUrl("")).toBe(true);
  });

  it("restores a stored session on start, linking Publish and confirming it with the relay", async () => {
    const storage = memoryStorage();
    saveAccount({ version: 1, relayUrl: RELAY, token: "jbs_old", expiresAt: NOW + 60_000, user }, storage);
    const t = setup({ storage, routes: { "GET /api/health": { body: { signup: true } }, "GET /api/me": { body: { user: { ...user, email: "alice@new.example" } } } } });
    t.controller.start();
    expect(t.controller.getSnapshot().session?.token).toBe("jbs_old");
    expect(t.profiles.get(ACCOUNT_PROFILE_ID)?.key).toBe("jbs_old");
    await flush();
    expect(t.controller.getSnapshot().session?.user.email).toBe("alice@new.example");
    expect(t.calls.find((c) => c.url.endsWith("/api/me"))?.headers.Authorization).toBe("Bearer jbs_old");
  });

  it("signs out when the relay no longer knows the session, but keeps it when the relay is just unreachable", async () => {
    const make = (me: { status?: number; body?: unknown } | Error) => {
      const storage = memoryStorage();
      saveAccount({ version: 1, relayUrl: RELAY, token: "jbs_old", expiresAt: NOW + 60_000, user }, storage);
      return setup({ storage, routes: { "GET /api/health": { body: {} }, "GET /api/me": me } });
    };
    const dead = make({ status: 401, body: { error: { code: "session_expired", message: "ended" } } });
    dead.controller.start();
    await flush();
    expect(dead.controller.getSnapshot()).toMatchObject({ session: null, notice: "sessionEnded" });
    expect(dead.profiles.size).toBe(0);
    expect(dead.storage.data.has(ACCOUNT_STORAGE_KEY)).toBe(false);
    const offline = make(new Error("offline"));
    offline.controller.start();
    await flush();
    expect(offline.controller.getSnapshot().session?.token).toBe("jbs_old");
    expect(offline.profiles.has(ACCOUNT_PROFILE_ID)).toBe(true);
  });

  it("signs out (even when the relay is unreachable) and removes the Publish profile", async () => {
    const t = setup({ routes: { "GET /api/health": { body: {} }, "POST /api/auth/login": { body: session() }, "POST /api/auth/logout": new Error("offline") } });
    t.controller.start();
    await flush();
    await t.controller.login("alice@example.com", "whatever");
    expect(t.profiles.size).toBe(1);
    await t.controller.logout();
    expect(t.controller.getSnapshot()).toMatchObject({ session: null, notice: "signedOut", busy: false });
    expect(t.profiles.size).toBe(0);
    expect(t.storage.data.has(ACCOUNT_STORAGE_KEY)).toBe(false);
  });

  it("changes the password and deletes the account", async () => {
    const t = setup({
      routes: {
        "GET /api/health": { body: {} },
        "POST /api/auth/login": { body: session() },
        "POST /api/auth/password": (call) => ((call.body as { current: string }).current === "right" ? { body: { ok: true } } : { status: 401, body: { error: { code: "bad_credentials", message: "wrong" } } }),
        "DELETE /api/auth/user": { body: { ok: true } },
      },
    });
    t.controller.start();
    await flush();
    await t.controller.login("alice@example.com", "whatever");
    expect(await t.controller.changePassword("wrong", "a new password")).toBe(false);
    expect(t.controller.getSnapshot().errorCode).toBe("bad_credentials");
    expect(await t.controller.changePassword("right", "short")).toBe(false);
    expect(t.controller.getSnapshot().errorCode).toBe("weakPassword");
    expect(await t.controller.changePassword("right", "a new password")).toBe(true);
    expect(t.controller.getSnapshot()).toMatchObject({ notice: "passwordChanged", error: null });
    expect(await t.controller.deleteAccount("a new password")).toBe(true);
    expect(t.controller.getSnapshot()).toMatchObject({ session: null, notice: "deleted" });
    expect(t.profiles.size).toBe(0);
  });
});

describe("account messages", () => {
  const flat = (node: unknown, prefix = "", out: Record<string, string> = {}) => {
    if (typeof node === "string") out[prefix] = node;
    else if (node && typeof node === "object") for (const [k, v] of Object.entries(node)) flat(v, prefix ? `${prefix}.${k}` : k, out);
    return out;
  };

  it("exist in every language with the same keys and placeholders", () => {
    const base = flat(en.Account);
    expect(Object.keys(base).length).toBeGreaterThan(60);
    for (const [name, catalogue] of [["es", es], ["pl", pl]] as const) {
      const other = flat(catalogue.Account);
      expect(Object.keys(other).sort(), name).toEqual(Object.keys(base).sort());
      for (const [key, text] of Object.entries(base)) {
        // the arguments of a message: the word right after "{" that is followed by "}" or ",", not a plural branch like "{no accounts}"
        const names = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]))].sort().join(",");
        expect(names(other[key]), `${name} ${key}`).toBe(names(text));
        expect(/<terms>|<privacy>/.test(text), key).toBe(/<terms>|<privacy>/.test(other[key]));
      }
    }
  });

  it("have a message for every error code the client can raise", () => {
    for (const code of ["network", "badUrl", "badEmail", "weakPassword", "bad_email", "weak_password", "bad_password", "email_taken", "bad_credentials", "rate_limited", "signup_closed", "session_expired", "unauthorized", "server", "unknown"]) {
      expect((en.Account.errors as Record<string, string>)[code], code).toBeTypeOf("string");
    }
  });
});
