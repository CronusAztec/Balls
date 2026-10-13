import { normalizeRelayUrl } from "@/lib/publish/relayClient";

/*
 * --- user-accounts --- The page's side of the relay's user accounts (relay/server.mjs, "USER ACCOUNTS"): an email and a
 * password make an account; the relay answers with a session token that works exactly like an access key (Authorization:
 * Bearer jbs_…), so the TikTok / Instagram / YouTube accounts connected under it follow the user to every browser and to the
 * Windows app. The password goes to the relay once (HTTPS) and is never stored here; only the token is.
 *
 *   GET    /api/health         → { signup, platforms }            whether the relay takes new accounts, which apps it has
 *   POST   /api/auth/signup    { email, password, name? } → { token, expiresAt, user }
 *   POST   /api/auth/login     { email, password }        → { token, expiresAt, user }
 *   POST   /api/auth/logout    (Bearer)                   → { ok }
 *   POST   /api/auth/password  (Bearer) { current, next } → { ok }
 *   DELETE /api/auth/user      (Bearer) { password }      → { ok }   deletes the user and every connected account
 *   GET    /api/me             (Bearer)                   → { user }  the check that a stored session is still alive
 *
 * `fetch` is injected, every answer is read defensively (a non-JSON body or an unknown shape is an error, never a throw).
 */

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AccountUser {
  id: string;
  email: string;
  name: string;
}

export interface SessionAnswer {
  token: string;
  /** ISO time the session ends. */
  expiresAt: string;
  user: AccountUser;
}

export interface RelayHealth {
  /** Whether the relay takes new accounts. */
  signup: boolean;
  platforms: { tiktok: boolean; instagram: boolean; youtube: boolean };
}

export type AccountErrorCode =
  | "badUrl"
  | "network"
  | "badEmail"
  | "weakPassword"
  | "bad_email"
  | "weak_password"
  | "bad_password"
  | "email_taken"
  | "bad_credentials"
  | "rate_limited"
  | "signup_closed"
  | "session_expired"
  | "unauthorized"
  | "server"
  | "unknown";

export class AccountError extends Error {
  readonly code: AccountErrorCode;
  readonly status?: number;
  constructor(code: AccountErrorCode, message: string, status?: number) {
    super(message);
    this.name = "AccountError";
    this.code = code;
    this.status = status;
  }
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** A plausible email (the relay is the judge; this spares a round trip for an obvious typo). */
export const isEmail = (value: string) => value.trim().length <= 254 && EMAIL_PATTERN.test(value.trim());

/** The error code of a form's values before anything is sent, or null when they are fine. */
export function checkCredentials(email: string, password: string, mode: "signup" | "login"): "badEmail" | "weakPassword" | null {
  if (!isEmail(email)) return "badEmail";
  if (mode === "signup" && password.length < PASSWORD_MIN) return "weakPassword";
  if (password.length === 0) return "weakPassword";
  return null;
}

const SERVER_CODES: readonly AccountErrorCode[] = ["bad_email", "weak_password", "bad_password", "email_taken", "bad_credentials", "rate_limited", "signup_closed", "session_expired", "unauthorized"];

function errorFor(status: number, json: unknown): AccountError {
  const e = json && typeof json === "object" ? (json as { error?: { code?: unknown; message?: unknown } | string }).error : undefined;
  const message = typeof e === "string" ? e : e && typeof e.message === "string" ? e.message : null;
  const serverCode = e && typeof e === "object" && typeof e.code === "string" ? e.code : null;
  const known = SERVER_CODES.find((c) => c === serverCode);
  if (known) return new AccountError(known, message ?? known, status);
  if (status === 401) return new AccountError("unauthorized", message ?? "Not signed in.", status);
  if (status >= 500) return new AccountError("server", message ?? `The relay failed (HTTP ${status}).`, status);
  return new AccountError("unknown", message ?? `The relay refused the request (HTTP ${status}).`, status);
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export function parseUser(raw: unknown): AccountUser | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.email !== "string") return null;
  return { id: raw.id, email: raw.email, name: typeof raw.name === "string" && raw.name ? raw.name : raw.email.split("@")[0] };
}

export function parseSession(raw: unknown): SessionAnswer | null {
  if (!isRecord(raw) || typeof raw.token !== "string" || !raw.token.startsWith("jbs_") || typeof raw.expiresAt !== "string") return null;
  const user = parseUser(raw.user);
  return user ? { token: raw.token, expiresAt: raw.expiresAt, user } : null;
}

export class AccountClient {
  readonly base: string;

  constructor(
    url: string,
    private readonly fetchImpl: FetchLike,
  ) {
    const base = normalizeRelayUrl(url);
    if (!base) throw new AccountError("badUrl", "The server address is not a valid http(s) address.");
    this.base = base;
  }

  private async call(path: string, init: RequestInit = {}, token?: string): Promise<unknown> {
    const headers: Record<string, string> = { ...((init.headers as Record<string, string>) ?? {}) };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.body) headers["Content-Type"] = "application/json";
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    } catch (err) {
      throw new AccountError("network", `Could not reach ${this.base}: ${err instanceof Error ? err.message : String(err)}`);
    }
    let json: unknown = null;
    try {
      const text = await res.text();
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) throw errorFor(res.status, json);
    return json;
  }

  async health(): Promise<RelayHealth> {
    const json = await this.call("/api/health");
    const p = isRecord(json) && isRecord(json.platforms) ? json.platforms : {};
    return { signup: !isRecord(json) || json.signup !== false, platforms: { tiktok: p.tiktok === true, instagram: p.instagram === true, youtube: p.youtube === true } };
  }

  private async session(path: string, body: Record<string, unknown>): Promise<SessionAnswer> {
    const answer = parseSession(await this.call(path, { method: "POST", body: JSON.stringify(body) }));
    if (!answer) throw new AccountError("server", "The relay answered with no session – is this address a JumpingBallsLive relay?");
    return answer;
  }

  signup(email: string, password: string, name?: string): Promise<SessionAnswer> {
    return this.session("/api/auth/signup", { email: email.trim(), password, ...(name?.trim() ? { name: name.trim() } : {}) });
  }

  login(email: string, password: string): Promise<SessionAnswer> {
    return this.session("/api/auth/login", { email: email.trim(), password });
  }

  /** The signed-in user of a token (the check that a stored session is still alive). */
  async me(token: string): Promise<AccountUser> {
    const json = await this.call("/api/me", {}, token);
    const user = isRecord(json) ? parseUser(json.user) : null;
    if (!user) throw new AccountError("unauthorized", "This token is not a user session.");
    return user;
  }

  async logout(token: string): Promise<void> {
    await this.call("/api/auth/logout", { method: "POST" }, token);
  }

  async changePassword(token: string, current: string, next: string): Promise<void> {
    await this.call("/api/auth/password", { method: "POST", body: JSON.stringify({ current, next }) }, token);
  }

  async deleteAccount(token: string, password: string): Promise<void> {
    await this.call("/api/auth/user", { method: "DELETE", body: JSON.stringify({ password }) }, token);
  }
}
