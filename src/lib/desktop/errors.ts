/*
 * --- desktop-ai-fix --- Error text the Windows app shows and logs. Pure (no Electron, no DOM): the main process and the page
 * share it.
 *
 *  - `stripIpcPrefix()` removes Electron's "Error invoking remote method '<channel>': Error: " wherever it sits in a message
 *    (the page used to anchor the cleanup at the start, but the agent prefixes "model: ", so 1.0.2 showed it in full).
 *  - `describeError()` is the message plus the codes of its cause chain, explained: Node's fetch (undici) only says
 *    "fetch failed" and keeps the reason (ECONNREFUSED, SELF_SIGNED_CERT_IN_CHAIN…) in `err.cause`, which never reached the
 *    user or main.log; Chromium's network stack (Electron's net.fetch) answers "net::ERR_…".
 *  - `errorChain()` is the whole chain with stacks, for main.log.
 */

const IPC_PREFIX = /Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/g;

/** A message without Electron's IPC prefix (anywhere in it, any number of times). */
export function stripIpcPrefix(text: string): string {
  return text.replace(IPC_PREFIX, "");
}

/** What a network or TLS error code means for the user. */
export const NETWORK_ERROR_HINTS: Readonly<Record<string, string>> = {
  ECONNREFUSED: "nothing answers at that address (is the server running?)",
  ECONNRESET: "the connection was reset (a firewall, proxy or antivirus may have cut it)",
  ETIMEDOUT: "the connection timed out",
  UND_ERR_CONNECT_TIMEOUT: "the connection timed out",
  UND_ERR_SOCKET: "the connection was closed unexpectedly",
  ENOTFOUND: "the host name could not be resolved (offline, or DNS is blocked)",
  EAI_AGAIN: "the host name could not be resolved (offline, or DNS is blocked)",
  ENETUNREACH: "the network is unreachable (offline?)",
  EHOSTUNREACH: "the host is unreachable",
  SELF_SIGNED_CERT_IN_CHAIN: "the TLS certificate is not trusted – an antivirus HTTPS scan or a proxy is intercepting the connection",
  UNABLE_TO_GET_ISSUER_CERT_LOCALLY: "the TLS certificate is not trusted – an antivirus HTTPS scan or a proxy is intercepting the connection",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "the TLS certificate is not trusted – an antivirus HTTPS scan or a proxy is intercepting the connection",
  DEPTH_ZERO_SELF_SIGNED_CERT: "the server's TLS certificate is self-signed",
  CERT_HAS_EXPIRED: "the TLS certificate has expired (or the PC's clock is wrong)",
  ERR_TLS_CERT_ALTNAME_INVALID: "the TLS certificate is for another host (a proxy may be intercepting the connection)",
  "net::ERR_CERT_AUTHORITY_INVALID": "the TLS certificate is not trusted – an antivirus HTTPS scan or a proxy is intercepting the connection",
  "net::ERR_CERT_DATE_INVALID": "the TLS certificate has expired (or the PC's clock is wrong)",
  "net::ERR_CONNECTION_REFUSED": "nothing answers at that address (is the server running?)",
  "net::ERR_CONNECTION_RESET": "the connection was reset (a firewall, proxy or antivirus may have cut it)",
  "net::ERR_CONNECTION_TIMED_OUT": "the connection timed out",
  "net::ERR_TIMED_OUT": "the connection timed out",
  "net::ERR_NAME_NOT_RESOLVED": "the host name could not be resolved (offline, or DNS is blocked)",
  "net::ERR_INTERNET_DISCONNECTED": "the PC is offline",
  "net::ERR_PROXY_CONNECTION_FAILED": "the system proxy does not answer",
  "net::ERR_TUNNEL_CONNECTION_FAILED": "the proxy refused the connection",
  "net::ERR_NETWORK_CHANGED": "the network changed during the request – try again",
};

interface ErrorLike {
  name?: unknown;
  message?: unknown;
  code?: unknown;
  errno?: unknown;
  cause?: unknown;
  stack?: unknown;
}

function asErrorLike(value: unknown): ErrorLike | null {
  return value && typeof value === "object" ? (value as ErrorLike) : null;
}

/** The error codes in an error's message and cause chain (ECONNREFUSED, net::ERR_…), outermost first, without repeats. */
export function errorCodes(err: unknown, depth = 6): string[] {
  const codes: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < depth && current; i++) {
    const e = asErrorLike(current);
    if (!e) break;
    if (typeof e.code === "string" && e.code && !codes.includes(e.code)) codes.push(e.code);
    const message = typeof e.message === "string" ? e.message : "";
    for (const m of message.matchAll(/net::ERR_[A-Z_]+/g)) if (!codes.includes(m[0])) codes.push(m[0]);
    current = e.cause;
  }
  return codes;
}

/** The message of any thrown value. */
export function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message || err.name;
  const e = asErrorLike(err);
  if (e && typeof e.message === "string") return e.message;
  return String(err);
}

/**
 * The message with the cause chain's codes explained: "fetch failed (SELF_SIGNED_CERT_IN_CHAIN: the TLS certificate is not
 * trusted – …)". A code the message already names is not repeated; an unknown code is shown as it is.
 */
export function describeError(err: unknown): string {
  const message = stripIpcPrefix(messageOf(err));
  const extra: string[] = [];
  for (const code of errorCodes(err)) {
    const hint = NETWORK_ERROR_HINTS[code];
    const named = message.includes(code);
    if (named && !hint) continue;
    if (hint && message.includes(hint)) continue;
    const text = named ? (hint as string) : hint ? `${code}: ${hint}` : code;
    if (!extra.includes(text)) extra.push(text);
  }
  // A cause without a code still says something ("connect ECONNREFUSED 127.0.0.1:5612" sits in the cause's message).
  const cause = asErrorLike(asErrorLike(err)?.cause);
  if (extra.length === 0 && cause && typeof cause.message === "string" && cause.message && !message.includes(cause.message)) extra.push(cause.message);
  return extra.length ? `${message} (${extra.join("; ")})` : message;
}

/** The whole chain, one line per error, with the stacks – for main.log only (never shown to the page). */
export function errorChain(err: unknown, depth = 6): string {
  const lines: string[] = [];
  let current: unknown = err;
  for (let i = 0; i < depth && current; i++) {
    const e = asErrorLike(current);
    if (!e) {
      lines.push(`${i ? "caused by: " : ""}${String(current)}`);
      break;
    }
    const name = typeof e.name === "string" ? e.name : "Error";
    const code = typeof e.code === "string" ? ` [${e.code}]` : "";
    const stack = typeof e.stack === "string" ? e.stack.split("\n").slice(1, 6).map((l) => l.trim()).join(" | ") : "";
    lines.push(`${i ? "caused by: " : ""}${name}${code}: ${typeof e.message === "string" ? e.message : ""}${stack ? ` @ ${stack}` : ""}`);
    current = e.cause;
  }
  return lines.join(" ⟵ ");
}
