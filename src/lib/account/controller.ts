import { AccountClient, AccountError, checkCredentials, type AccountErrorCode, type FetchLike, type RelayHealth } from "./client";
import { ACCOUNT_EVENT, loadAccount, saveAccount, type StoredAccount } from "./store";
import { getPublishController } from "@/lib/publish/controller";
import { normalizeRelayUrl } from "@/lib/publish/relayClient";

/*
 * --- user-accounts --- The account's state and actions, outside React (a module-level controller the Account page reads with
 * useSyncExternalStore). It signs a user up or in on the relay, keeps the session in this browser (store.ts) and hands the
 * session to the Publish feature as its relay profile (`ACCOUNT_PROFILE_ID`), so every TikTok, Instagram and YouTube account
 * connected under the user shows up in the Publish block – in the browser, the installed PWA and the Windows app alike – and
 * a sign-out takes that profile away again. The Publish controller owns the connected accounts (list, connect, disconnect,
 * send); this one owns who is signed in.
 */

/** The id of the Publish relay profile that carries the signed-in user's session. */
export const ACCOUNT_PROFILE_ID = "account";
const RELAY_URL_KEY = "jumpingballslive_account_relay";

/** The part of the Publish controller the account needs (the real one, or a fake in tests). */
export interface PublishLink {
  start(): void;
  saveProfile(input: { id?: string; url: string; key: string; label: string }): string | null;
  removeProfile(id: string): void;
  profile(id: string): { url: string; key: string } | null;
}

export interface AccountSnapshot {
  /** Loaded from storage (false on the server and before the page first mounts). */
  ready: boolean;
  /** NEXT_PUBLIC_PUBLISH_RELAY_URL of the build ("" when unset). */
  envRelayUrl: string;
  /** The relay a sign-in goes to: the one typed in "Server", else the build's. "" when there is none. */
  relayUrl: string;
  session: StoredAccount | null;
  health: RelayHealth | null;
  healthStatus: "idle" | "loading" | "ok" | "error";
  /** A request is in flight. */
  busy: boolean;
  error: string | null;
  errorCode: AccountErrorCode | null;
  /** What just happened, for a one-line confirmation. */
  notice: "passwordChanged" | "sessionEnded" | "deleted" | "signedOut" | null;
}

export interface AccountDeps {
  fetch: () => FetchLike;
  storage: () => Pick<Storage, "getItem" | "setItem"> & Partial<Pick<Storage, "removeItem">> | null;
  window: () => (Window & typeof globalThis) | null;
  now: () => number;
  envRelayUrl: string;
  publish: () => PublishLink;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const codeOf = (err: unknown): AccountErrorCode => (err instanceof AccountError ? err.code : "unknown");

export class AccountController {
  private snap: AccountSnapshot;
  private readonly serverSnap: AccountSnapshot;
  private readonly listeners = new Set<() => void>();
  private started = false;
  private healthSerial = 0;

  constructor(private readonly deps: AccountDeps) {
    const initial: AccountSnapshot = {
      ready: false,
      envRelayUrl: deps.envRelayUrl,
      relayUrl: normalizeRelayUrl(deps.envRelayUrl) ?? "",
      session: null,
      health: null,
      healthStatus: "idle",
      busy: false,
      error: null,
      errorCode: null,
      notice: null,
    };
    this.snap = initial;
    this.serverSnap = initial;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  getSnapshot = (): AccountSnapshot => this.snap;
  getServerSnapshot = (): AccountSnapshot => this.serverSnap;

  private set(patch: Partial<AccountSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }

  private client(url = this.snap.session?.relayUrl || this.snap.relayUrl): AccountClient {
    return new AccountClient(url, this.deps.fetch());
  }

  private announce(): void {
    try {
      this.deps.window()?.dispatchEvent(new Event(ACCOUNT_EVENT));
    } catch {
      /* no window: nothing to tell */
    }
  }

  private customRelayUrl(): string {
    try {
      return normalizeRelayUrl(this.deps.storage()?.getItem(RELAY_URL_KEY) ?? "") ?? "";
    } catch {
      return "";
    }
  }

  /** Loads what this browser remembers, hands a live session to Publish and checks it against the relay (once). */
  start(): void {
    if (this.started) return;
    this.started = true;
    const session = loadAccount(this.deps.now(), this.deps.storage());
    const relayUrl = session?.relayUrl || this.customRelayUrl() || normalizeRelayUrl(this.deps.envRelayUrl) || "";
    this.set({ ready: true, session, relayUrl });
    if (session) {
      this.linkPublish(session);
      void this.verify();
    }
    if (relayUrl) void this.loadHealth();
  }

  /** Makes sure Publish has the session as its relay profile (an existing, unchanged one is left alone). */
  private linkPublish(session: StoredAccount): void {
    const publish = this.deps.publish();
    publish.start();
    const existing = publish.profile(ACCOUNT_PROFILE_ID);
    if (existing && existing.url === session.relayUrl && existing.key === session.token) return;
    publish.saveProfile({ id: ACCOUNT_PROFILE_ID, url: session.relayUrl, key: session.token, label: session.user.email });
  }

  private unlinkPublish(): void {
    const publish = this.deps.publish();
    publish.start();
    if (publish.profile(ACCOUNT_PROFILE_ID)) publish.removeProfile(ACCOUNT_PROFILE_ID);
  }

  /** Whether the relay takes new accounts and which platform apps it has. */
  async loadHealth(): Promise<void> {
    const serial = ++this.healthSerial;
    const url = this.snap.session?.relayUrl || this.snap.relayUrl;
    if (!url) return void this.set({ health: null, healthStatus: "idle" });
    this.set({ healthStatus: "loading" });
    try {
      const health = await this.client(url).health();
      if (serial === this.healthSerial) this.set({ health, healthStatus: "ok" });
    } catch {
      if (serial === this.healthSerial) this.set({ health: null, healthStatus: "error" });
    }
  }

  /** Asks the relay whether the stored session is alive; a dead one signs out (a dropped connection keeps it). */
  async verify(): Promise<void> {
    const session = this.snap.session;
    if (!session) return;
    try {
      const user = await this.client(session.relayUrl).me(session.token);
      if (this.snap.session?.token === session.token && user.email !== session.user.email) this.adopt({ ...session, user });
    } catch (err) {
      if (err instanceof AccountError && (err.code === "unauthorized" || err.code === "session_expired") && this.snap.session?.token === session.token) {
        this.clear("sessionEnded");
      }
    }
  }

  private adopt(session: StoredAccount): void {
    saveAccount(session, this.deps.storage());
    this.set({ session, relayUrl: session.relayUrl, error: null, errorCode: null });
    this.linkPublish(session);
    this.announce();
  }

  private clear(notice: AccountSnapshot["notice"]): void {
    saveAccount(null, this.deps.storage());
    this.set({ session: null, notice, error: null, errorCode: null });
    this.unlinkPublish();
    this.announce();
  }

  /** Sets the relay the sign-in goes to (a self-hosted one); "" goes back to the build's. Returns false for a bad address. */
  setRelayUrl(input: string): boolean {
    const raw = input.trim();
    const url = raw ? normalizeRelayUrl(raw) : normalizeRelayUrl(this.deps.envRelayUrl);
    if (raw && !url) {
      this.set({ error: "The server address is not a valid http(s) address.", errorCode: "badUrl" });
      return false;
    }
    try {
      const storage = this.deps.storage();
      if (raw) storage?.setItem(RELAY_URL_KEY, url!);
      else if (storage?.removeItem) storage.removeItem(RELAY_URL_KEY);
      else storage?.setItem(RELAY_URL_KEY, "");
    } catch {
      /* storage blocked: used for this session */
    }
    this.set({ relayUrl: url ?? "", health: null, healthStatus: "idle", error: null, errorCode: null });
    void this.loadHealth();
    return true;
  }

  private async enter(mode: "signup" | "login", email: string, password: string, name?: string): Promise<boolean> {
    if (this.snap.busy) return false;
    const bad = checkCredentials(email, password, mode);
    if (bad) {
      this.set({ error: bad === "badEmail" ? "Enter a valid email address." : "Use a password of at least 8 characters.", errorCode: bad, notice: null });
      return false;
    }
    if (!this.snap.relayUrl) {
      this.set({ error: "No server is set up for accounts yet.", errorCode: "badUrl", notice: null });
      return false;
    }
    this.set({ busy: true, error: null, errorCode: null, notice: null });
    try {
      const client = this.client(this.snap.relayUrl);
      const answer = mode === "signup" ? await client.signup(email, password, name) : await client.login(email, password);
      this.adopt({ version: 1, relayUrl: client.base, token: answer.token, expiresAt: Date.parse(answer.expiresAt) || this.deps.now() + 30 * 24 * 3600 * 1000, user: answer.user });
      this.set({ busy: false });
      return true;
    } catch (err) {
      this.set({ busy: false, error: message(err), errorCode: codeOf(err) });
      return false;
    }
  }

  signup(email: string, password: string, name?: string): Promise<boolean> {
    return this.enter("signup", email, password, name);
  }

  login(email: string, password: string): Promise<boolean> {
    return this.enter("login", email, password);
  }

  /** Signs out of this browser (the relay forgets the session; a dropped connection does not keep the user signed in). */
  async logout(): Promise<void> {
    const session = this.snap.session;
    if (!session) return;
    this.set({ busy: true });
    try {
      await this.client(session.relayUrl).logout(session.token);
    } catch {
      /* the session ends on the relay by itself */
    }
    this.set({ busy: false });
    this.clear("signedOut");
  }

  async changePassword(current: string, next: string): Promise<boolean> {
    const session = this.snap.session;
    if (!session || this.snap.busy) return false;
    if (next.length < 8) {
      this.set({ error: "Use a password of at least 8 characters.", errorCode: "weakPassword", notice: null });
      return false;
    }
    this.set({ busy: true, error: null, errorCode: null, notice: null });
    try {
      await this.client(session.relayUrl).changePassword(session.token, current, next);
      this.set({ busy: false, notice: "passwordChanged" });
      return true;
    } catch (err) {
      this.set({ busy: false, error: message(err), errorCode: codeOf(err) });
      return false;
    }
  }

  /** Deletes the account on the relay (with every connected TikTok / Instagram / YouTube account) and signs out here. */
  async deleteAccount(password: string): Promise<boolean> {
    const session = this.snap.session;
    if (!session || this.snap.busy) return false;
    this.set({ busy: true, error: null, errorCode: null, notice: null });
    try {
      await this.client(session.relayUrl).deleteAccount(session.token, password);
      this.set({ busy: false });
      this.clear("deleted");
      return true;
    } catch (err) {
      this.set({ busy: false, error: message(err), errorCode: codeOf(err) });
      return false;
    }
  }

  dismiss(): void {
    this.set({ error: null, errorCode: null, notice: null });
  }
}

let controller: AccountController | null = null;

/** The page's controller (one per tab). */
export function getAccountController(): AccountController {
  if (!controller) {
    controller = new AccountController({
      fetch: () => (url, init) => fetch(url, init),
      storage: () => {
        try {
          return typeof localStorage !== "undefined" ? localStorage : null;
        } catch {
          return null;
        }
      },
      window: () => (typeof window !== "undefined" ? window : null),
      now: () => Date.now(),
      envRelayUrl: process.env.NEXT_PUBLIC_PUBLISH_RELAY_URL ?? "",
      publish: () => {
        const pc = getPublishController();
        return {
          start: () => pc.start(),
          saveProfile: (input) => pc.saveProfile(input),
          removeProfile: (id) => pc.removeProfile(id),
          profile: (id) => pc.getSnapshot().stored.relayProfiles.find((p) => p.id === id) ?? null,
        };
      },
    });
  }
  return controller;
}
