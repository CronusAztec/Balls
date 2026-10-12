// --- go-live-kit --- What `npm run go-live` (scripts/go-live.mjs) and `npm run go-live:check` (scripts/go-live-check.mjs)
// share: where things are, the one price file, the public TEST key, the key and URL shapes, the git remote and the `gh` runner.
// Node only, no dependencies. Nothing here reads or prints a secret.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BILLING_DIR = path.join(ROOT, "billing");
export const WRANGLER_TOML = path.join(BILLING_DIR, "wrangler.toml");
export const TEST_KEY_FILE = path.join(ROOT, "tests", "fixtures", "license-test-key.json");
export const DEFAULT_REPO = "CronusAztec/Balls";
export const SERVICE_NAME = "jumpingballslive-billing";
export const IS_WINDOWS = process.platform === "win32";

/**
 * The committed TEST licence public key (tests/fixtures/license-test-key.json → publicSpkiBase64url; the same constant as
 * src/lib/billing/config.ts LICENSE_TEST_PUBLIC_KEY). Anyone can sign licences with its private half, so a live site must
 * never verify with it. A test checks it against the fixture.
 */
export const TEST_PUBLIC_KEY =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE-VrvsDyDq0VpFeKfqI8l87Q2eosUd8aahdPHUMDc-TtNiCReADNxMtur3zPDfu-sH8xkl8iVIc6_ls8E7gLnfQ";
/** The TEST key's private scalar (public on purpose – it is the committed test pair). */
export const TEST_PRIVATE_D = "Gh0shGrJs8GvRL--b-ABeiqq1Z-MYbJ3Vi02ahCLQGo";

/** A licence public key: base64url of a P-256 SPKI DER, always this 36-character prefix and 122 characters long. */
export const PUBLIC_KEY_RE = /^MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE[A-Za-z0-9_-]{86}$/;

/** billing/billing-config.json: the prices, the plan lengths, the Stripe API version and the webhook event lists. */
export function readBillingConfig() {
  return JSON.parse(fs.readFileSync(path.join(BILLING_DIR, "billing-config.json"), "utf8"));
}

/** The committed TEST key pair (its private half goes into the Worker in test mode). */
export function readTestKey() {
  return JSON.parse(fs.readFileSync(TEST_KEY_FILE, "utf8"));
}

/** Whether a value is an https:// origin (scheme and host, an optional port, no path; one trailing slash is tolerated). */
export function isHttpsOrigin(value) {
  if (typeof value !== "string" || !value) return false;
  const clean = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(clean);
    return url.protocol === "https:" && url.origin === clean.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * owner/repo of a git remote URL: https (with or without .git, with credentials or through a proxy path) and the ssh forms
 * (git@github.com:owner/repo.git, ssh://git@github.com/owner/repo.git). Null when it has no two path segments.
 */
export function parseGitRemote(url) {
  if (typeof url !== "string") return null;
  let rest = url.trim();
  if (!rest) return null;
  const scp = /^[^/@\s]+@[^:/\s]+:(.+)$/.exec(rest); // git@github.com:owner/repo.git
  if (scp) rest = scp[1];
  else {
    try {
      rest = new URL(rest).pathname;
    } catch {
      return null;
    }
  }
  const parts = rest.replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const [owner, repo] = parts.slice(-2);
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) return null;
  return { owner, repo, slug: `${owner}/${repo}` };
}

/** owner/repo from `git remote get-url origin`, or the default repository. */
export function repoFromGit(cwd = ROOT) {
  const r = spawnSync("git", ["remote", "get-url", "origin"], { cwd, encoding: "utf8" });
  return (r.status === 0 && parseGitRemote(r.stdout)) || parseGitRemote(`https://github.com/${DEFAULT_REPO}`);
}

/** The GitHub Pages address of a repository: https://<owner lower-cased>.github.io/<repo> (the root for <owner>.github.io). */
export function pagesSiteUrl({ owner, repo }) {
  const host = `${owner.toLowerCase()}.github.io`;
  return repo.toLowerCase() === host ? `https://${host}` : `https://${host}/${repo}`;
}

/**
 * Runs the real GitHub CLI: gh(args, { input }) → { ok, code, stdout, stderr }. `input` (a secret's value) goes on stdin,
 * never into the arguments. A missing `gh` answers ok: false.
 */
export function ghRunner(args, { input } = {}) {
  const r = spawnSync("gh", args, { encoding: "utf8", input: input ?? undefined, stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
  if (r.error) return { ok: false, code: -1, stdout: "", stderr: String(r.error.message ?? r.error) };
  return { ok: r.status === 0, code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** `--name value` / `--name=value` / `--flag` command-line options (everything after the script name). */
export function parseOptions(argv, { booleans = [], strings = [] } = {}) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq === -1 ? undefined : eq);
    if (booleans.includes(name)) {
      out[name] = eq === -1 ? true : !/^(0|false|no)$/i.test(arg.slice(eq + 1));
    } else if (strings.includes(name)) {
      const value = eq === -1 ? argv[++i] : arg.slice(eq + 1);
      if (value === undefined || (eq === -1 && value.startsWith("--"))) throw new Error(`--${name} needs a value`);
      out[name] = value;
    } else {
      throw new Error(`Unknown option --${name}`);
    }
  }
  return out;
}
