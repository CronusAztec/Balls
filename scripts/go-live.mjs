#!/usr/bin/env node
// --- go-live-kit --- `npm run go-live`: the launch wizard. It walks you through Cloudflare, the licence key, Stripe, PayPal,
// NOWPayments, the Worker deploy and the GitHub variables in plain language, asking for every value once.
//
//   npm run go-live                          test mode first (test cards, sandbox accounts, the public test licence key)
//   npm run go-live -- --mode live           real money: your own key pair, live keys, the GitHub variables
//   npm run go-live -- --dry-run             prints every command (secret values as [hidden]) and runs nothing
//   npm run go-live -- --skip paypal,crypto  leaves those steps out (also: stripe, github); --yes takes the default answers
//
// Rules it keeps: every pasted value is checked before it is used (a wrong shape asks again, with the reason); secret values
// reach the tools only on their standard input – never in a command line – and are never printed, logged or written to a
// file; the only file it changes is billing/wrangler.toml (the storage id and the site origins: no secret, commit it).
// Re-running it is safe: press Enter to keep what the Worker already has, the price and plan scripts reuse what exists, and
// the storage is never created twice. docs/GO-LIVE.md walks through it question by question.

import { spawn } from "node:child_process";
import { createPublicKey } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import * as readline from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  BILLING_DIR,
  IS_WINDOWS,
  PUBLIC_KEY_RE,
  ROOT,
  TEST_PRIVATE_D,
  TEST_PUBLIC_KEY,
  WRANGLER_TOML,
  ghRunner,
  isHttpsOrigin,
  parseGitRemote,
  parseOptions,
  readBillingConfig,
  readTestKey,
  repoFromGit,
} from "./lib/go-live-common.mjs";

export { parseGitRemote };

// --- checking what the owner pastes ------------------------------------------------------------------------------------

/** @typedef {{ ok: boolean, value?: any, reason?: string, jwk?: any }} Checked */
/** @returns {Checked} */
const ok = (value, extra = {}) => ({ ok: true, value, ...extra });
/** @returns {Checked} */
const bad = (reason) => ({ ok: false, reason });
const clean = (v) => String(v ?? "").trim();
const B64URL_43 = /^[A-Za-z0-9_-]{43}$/;

/**
 * Every value the wizard asks for, checked by its shape: `{ ok: true, value }` (trimmed, normalised) or
 * `{ ok: false, reason }` in plain words. `mode` ("live" | "test") decides which keys fit.
 */
export const VALIDATORS = {
  stripeSecretKey(v, mode) {
    const s = clean(v);
    const m = /^(sk|rk)_(live|test)_[A-Za-z0-9]{16,}$/.exec(s);
    if (!m) return bad('a Stripe secret key starts with "sk_live" or "sk_test" and an underscore (Developers → API keys → Secret key)');
    if (mode && m[2] !== mode) return bad(`this is a ${m[2]} key, and we are setting up ${mode} mode – ${mode === "live" ? "switch Stripe's Test mode off" : "switch Stripe's Test mode on"} and copy the key again`);
    return ok(s);
  },
  stripeWebhookSecret(v) {
    const s = clean(v);
    return /^whsec_[A-Za-z0-9]{16,}$/.test(s) ? ok(s) : bad("the signing secret starts with whsec_ (the webhook endpoint's page → Signing secret → Reveal)");
  },
  stripePriceId(v) {
    const s = clean(v);
    return /^price_[A-Za-z0-9]{8,}$/.test(s) ? ok(s) : bad("a price id starts with price_ (Products → JumpingBallsLive Pro → the price → its id)");
  },
  paypalClientId(v) {
    const s = clean(v);
    return /^[A-Za-z0-9_-]{40,}$/.test(s) ? ok(s) : bad("a PayPal Client ID is a long string of letters, digits, - and _ (Apps & Credentials → your app)");
  },
  paypalClientSecret(v) {
    const s = clean(v);
    return /^[A-Za-z0-9_-]{40,}$/.test(s) ? ok(s) : bad("a PayPal secret is a long string of letters, digits, - and _ (Apps & Credentials → your app → Secret)");
  },
  paypalWebhookId(v) {
    const s = clean(v);
    return /^[A-Z0-9]{10,32}$/.test(s) ? ok(s) : bad("a PayPal Webhook ID is 10–32 capital letters and digits (your app → Webhooks → the Webhook ID column)");
  },
  paypalPlanId(v) {
    const s = clean(v);
    return /^P-[A-Z0-9]{8,}$/.test(s) ? ok(s) : bad("a PayPal plan id starts with P- followed by capital letters and digits");
  },
  nowpaymentsApiKey(v) {
    const s = clean(v);
    return /^[A-Za-z0-9-]{16,64}$/.test(s) ? ok(s) : bad("a NOWPayments API key is 16–64 letters, digits and dashes (Store settings → API keys)");
  },
  nowpaymentsIpnSecret(v) {
    const s = clean(v);
    return /^\S{8,128}$/.test(s) ? ok(s) : bad("the IPN secret is 8–128 characters without spaces (Store settings → Instant Payment Notifications)");
  },
  cloudflareApiToken(v) {
    const s = clean(v);
    return /^[A-Za-z0-9_-]{30,}$/.test(s) ? ok(s) : bad("a Cloudflare API token is a long string of letters, digits, - and _ (My Profile → API Tokens)");
  },
  cloudflareAccountId(v) {
    const s = clean(v).toLowerCase();
    return /^[0-9a-f]{32}$/.test(s) ? ok(s) : bad("a Cloudflare Account ID is 32 characters 0-9 and a-f (Workers & Pages → Account details)");
  },
  kvNamespaceId(v) {
    const s = clean(v).toLowerCase();
    return /^[0-9a-f]{32}$/.test(s) ? ok(s) : bad("a KV namespace id is 32 characters 0-9 and a-f");
  },
  publicKey(v, mode) {
    const s = clean(v);
    if (!PUBLIC_KEY_RE.test(s)) return bad("a licence public key is 122 characters starting MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE (line 2 of the key generator)");
    if (mode === "live" && s === TEST_PUBLIC_KEY) return bad("this is the public TEST key – a live site needs your own key pair");
    return ok(s);
  },
  /** The private key as JSON – bare, or line 1 of the key generator ({"privateJwk":{…}}); value is the JSON the Worker stores. */
  privateJwk(v, mode, publicKey) {
    let parsed;
    try {
      parsed = JSON.parse(clean(v));
    } catch {
      return bad("paste the whole line that starts with { (line 1 of the key generator)");
    }
    const jwk = parsed && typeof parsed === "object" && parsed.privateJwk && typeof parsed.privateJwk === "object" ? parsed.privateJwk : parsed;
    if (!jwk || jwk.kty !== "EC" || jwk.crv !== "P-256") return bad("this is not a P-256 private key (kty EC, crv P-256)");
    for (const part of ["x", "y", "d"]) if (typeof jwk[part] !== "string" || !B64URL_43.test(jwk[part])) return bad(`the key's "${part}" part is missing or malformed – is this the private half (line 1)?`);
    if (mode === "live" && jwk.d === TEST_PRIVATE_D) return bad("this is the public TEST key – a live site needs your own key pair");
    const own = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d };
    if (publicKey) {
      let derived = "";
      try {
        derived = publicKeyFromPrivateJwk(own);
      } catch {
        return bad("this private key is not a valid P-256 key");
      }
      if (derived !== clean(publicKey)) return bad("this private key does not belong to that public key – use the two lines of the same key generator run");
    }
    return ok(JSON.stringify(own), { jwk: own });
  },
  email(v) {
    const s = clean(v);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? ok(s) : bad("an e-mail address looks like name@example.com");
  },
  origin(v) {
    const s = clean(v).toLowerCase().replace(/\/+$/, "");
    return /^https:\/\/[a-z0-9.-]+(:\d+)?$/.test(s) ? ok(s) : bad("type the address with https:// and nothing after the domain, like https://www.example.com");
  },
  workerUrl(v) {
    const s = clean(v).toLowerCase().replace(/\/+$/, "");
    if (/^https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev$/.test(s) || isHttpsOrigin(s)) return ok(s);
    return bad("the Worker's address looks like https://jumpingballslive-billing.<your-subdomain>.workers.dev (Wrangler printed it)");
  },
};

/** Free text that ends up on the legal pages (a name or an address): one line, a sensible length. */
function legalText(max) {
  return (v) => {
    const s = clean(v).replace(/\s+/g, " ");
    if (s.length > max) return bad(`keep it under ${max} characters`);
    if (/[<>{}"]/.test(s)) return bad("leave out < > { } and quotes");
    return ok(s);
  };
}

// --- reading what the tools print --------------------------------------------------------------------------------------

/** The key generator's two lines (stderr noise and blank lines ignored): { privateJwk, privateJwkJson, publicKey } or null. */
export function parseKeygenOutput(stdout) {
  let privateJwk = null;
  let publicKey = null;
  for (const raw of String(stdout ?? "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!privateJwk && line.startsWith("{")) {
      const checked = VALIDATORS.privateJwk(line);
      if (checked.ok) privateJwk = checked.jwk;
    } else if (!publicKey && PUBLIC_KEY_RE.test(line)) publicKey = line;
  }
  if (!privateJwk || !publicKey) return null;
  return { privateJwk, privateJwkJson: JSON.stringify(privateJwk), publicKey };
}

/** The namespace id `wrangler kv namespace create` prints ({ binding = "ENTITLEMENTS", id = "…" }, TOML or JSON). */
export function parseKvCreateOutput(stdout) {
  const m = /(?<![\w-])id"?\s*[=:]\s*"([0-9a-f]{32})"/.exec(String(stdout ?? ""));
  return m ? m[1] : null;
}

/** `wrangler kv namespace list` (a JSON array, possibly after a banner): [{ id, title }]. */
export function parseKvList(stdout) {
  return jsonArray(stdout)
    .filter((n) => n && typeof n.id === "string" && typeof n.title === "string")
    .map((n) => ({ id: n.id, title: n.title }));
}

/** `wrangler secret list` (a JSON array of { name, type }): the secret names the Worker has. */
export function parseSecretList(stdout) {
  return jsonArray(stdout)
    .map((s) => s?.name)
    .filter((n) => typeof n === "string");
}

function jsonArray(stdout) {
  const text = String(stdout ?? "");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** NAME=value lines (what the price and plan scripts print) as an object. */
export function parseEnvLines(stdout) {
  const out = {};
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const m = /^\s*([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

/** The Worker's address `wrangler deploy` prints: https://<name>.<subdomain>.workers.dev (null when there is none). */
export function parseWorkerUrl(stdout) {
  const m = /https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev\b/i.exec(String(stdout ?? ""));
  return m ? m[0].toLowerCase() : null;
}

/** The first Cloudflare account id in `wrangler whoami`'s table (32 hex characters), or null. */
export function parseAccountId(stdout) {
  const m = /\b([0-9a-f]{32})\b/.exec(String(stdout ?? ""));
  return m ? m[1] : null;
}

/** The base64url SPKI public key of a P-256 JWK (only x and y are used), as the site's LICENSE_PUBLIC_KEY spells it. */
export function publicKeyFromPrivateJwk(jwk) {
  const der = createPublicKey({ key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, format: "jwk" }).export({ type: "spki", format: "der" });
  return Buffer.from(der).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// --- billing/wrangler.toml ---------------------------------------------------------------------------------------------

/**
 * Write the storage id (the ENTITLEMENTS [[kv_namespaces]] block's `id = "…"` – the placeholder or an older id) and the
 * site origins (`SITE_ORIGIN = "…"` under [vars]) into wrangler.toml's text; every other line stays as it is. Idempotent.
 */
export function patchWranglerToml(text, { kvId, siteOrigin } = {}) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const header = (l) => /^\s*\[/.test(l);
  if (kvId) {
    for (let i = 0; i < lines.length; i++) {
      if (!/^\s*\[\[\s*kv_namespaces\s*\]\]\s*(#.*)?$/.test(lines[i])) continue;
      let end = i + 1;
      while (end < lines.length && !header(lines[end])) end++;
      const block = lines.slice(i + 1, end);
      const binding = block.findIndex((l) => /^\s*binding\s*=\s*"ENTITLEMENTS"/.test(l));
      if (binding === -1) continue;
      const idLine = block.findIndex((l) => /^\s*id\s*=\s*"[^"]*"/.test(l));
      if (idLine !== -1) {
        lines[i + 1 + idLine] = lines[i + 1 + idLine].replace(/^(\s*id\s*=\s*)"[^"]*"/, `$1"${kvId}"`);
      } else {
        lines.splice(i + 2 + binding, 0, `id = "${kvId}"`);
      }
      break;
    }
  }
  if (siteOrigin) {
    let table = "";
    let done = false;
    let varsLine = -1;
    for (let i = 0; i < lines.length && !done; i++) {
      const h = /^\s*\[\s*([^\]]+?)\s*\]/.exec(lines[i]);
      if (header(lines[i])) {
        table = h ? h[1] : lines[i].trim();
        if (table === "vars") varsLine = i;
        continue;
      }
      if (table === "vars" && /^\s*SITE_ORIGIN\s*=\s*"[^"]*"/.test(lines[i])) {
        lines[i] = lines[i].replace(/^(\s*SITE_ORIGIN\s*=\s*)"[^"]*"/, `$1"${siteOrigin}"`);
        done = true;
      }
    }
    if (!done) {
      if (varsLine !== -1) lines.splice(varsLine + 1, 0, `SITE_ORIGIN = "${siteOrigin}"`);
      else {
        const firstTable = lines.findIndex((l) => header(l));
        const at = firstTable === -1 ? lines.length : firstTable;
        lines.splice(at, 0, "[vars]", `SITE_ORIGIN = "${siteOrigin}"`, "");
      }
    }
  }
  return lines.join(eol);
}

/** The values wrangler.toml holds now: the Worker's name, the storage id and the site origins. */
export function readWranglerToml(text) {
  const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(text)?.[1] ?? "jumpingballslive-billing";
  const kv = /\[\[\s*kv_namespaces\s*\]\][^[]*?binding\s*=\s*"ENTITLEMENTS"[^[]*?(?:^|\n)\s*id\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? "";
  const origins = /^\s*SITE_ORIGIN\s*=\s*"([^"]*)"/m.exec(text)?.[1] ?? "";
  return { name, kvId: /^[0-9a-f]{32}$/.test(kv) ? kv : "", siteOrigins: origins.split(/[\s,]+/).filter(Boolean) };
}

// --- the commands ------------------------------------------------------------------------------------------------------

const NPX = IS_WINDOWS ? "npx.cmd" : "npx";
const NPM = IS_WINDOWS ? "npm.cmd" : "npm";
/** Stands in for a value a step before produces (the plan is printed before it exists). */
export const FROM_EARLIER_STEP = "(from the step before)";

/** A Wrangler command, run in billing/. */
export function wrangler(label, args, extra = {}) {
  return { label, cmd: NPX, args: ["wrangler", ...args], cwd: "billing", secret: false, ...extra };
}

/** `wrangler secret put NAME` with the value on standard input – never in the command line. */
export function secretPut(name, value) {
  return wrangler(`Store ${name} in the Worker`, ["secret", "put", name], { stdin: String(value), secret: true });
}

/** A Node script of the repository (run from its root). `env` carries a key a script needs – not the command line. */
function nodeScript(label, script, extra = {}) {
  return { label, cmd: process.execPath, args: [script], cwd: ".", secret: false, ...extra };
}

export function keygenCommand() {
  return nodeScript("Make a new licence key pair", "billing/scripts/keygen.mjs", { secret: true, quiet: true });
}

export function stripePricesCommand(secretKey) {
  return nodeScript("Find or create the Stripe product and its two prices", "billing/scripts/stripe-create-prices.mjs", { env: { STRIPE_SECRET_KEY: secretKey }, secret: true });
}

export function paypalPlansCommand({ clientId, clientSecret }, mode) {
  return nodeScript("Find or create the PayPal product and its two plans", "billing/scripts/paypal-create-plans.mjs", {
    env: { PAYPAL_CLIENT_ID: clientId, PAYPAL_CLIENT_SECRET: clientSecret, PAYPAL_ENV: mode === "live" ? "live" : "sandbox" },
    secret: true,
  });
}

/** The secret puts of the values given (undefined: keep what the Worker has). */
function putAll(pairs) {
  return pairs.filter(([, value]) => value !== undefined && value !== null).map(([name, value]) => secretPut(name, value));
}

export function stripeSecretCommands(s) {
  return putAll([
    ["STRIPE_SECRET_KEY", s.secretKey],
    ["STRIPE_PRICE_MONTHLY", s.prices?.monthly],
    ["STRIPE_PRICE_YEARLY", s.prices?.yearly],
    ["STRIPE_AUTOMATIC_TAX", s.automaticTax === undefined ? undefined : s.automaticTax ? "1" : "0"],
    ["STRIPE_WEBHOOK_SECRET", s.webhookSecret],
  ]);
}

export function paypalSecretCommands(p, mode) {
  return putAll([
    ["PAYPAL_CLIENT_ID", p.clientId],
    ["PAYPAL_CLIENT_SECRET", p.clientSecret],
    ["PAYPAL_ENV", mode === "live" ? "live" : "sandbox"],
    ["PAYPAL_PLAN_MONTHLY", p.plans?.monthly],
    ["PAYPAL_PLAN_YEARLY", p.plans?.yearly],
    ["PAYPAL_WEBHOOK_ID", p.webhookId],
  ]);
}

export function cryptoSecretCommands(c, mode) {
  return putAll([
    ["NOWPAYMENTS_API_KEY", c.apiKey],
    ["NOWPAYMENTS_IPN_SECRET", c.ipnSecret],
    ["NOWPAYMENTS_SANDBOX", mode === "live" ? "0" : "1"],
  ]);
}

export function githubCommands(g, repo) {
  const out = [];
  for (const [name, value] of Object.entries(g.variables ?? {})) {
    if (value) out.push({ label: `Set the GitHub variable ${name}`, cmd: "gh", args: ["variable", "set", name, "--body", value, "--repo", repo], cwd: ".", secret: false });
  }
  for (const [name, value] of Object.entries(g.secrets ?? {})) {
    if (value) out.push({ label: `Set the GitHub secret ${name}`, cmd: "gh", args: ["secret", "set", name, "--repo", repo], cwd: ".", stdin: value, secret: true });
  }
  return out;
}

/**
 * The commands a complete set of answers runs, in the wizard's order: { label, cmd, args, cwd, stdin?, env?, secret }[].
 * Secret values are only ever in `stdin` (or, for the price and plan scripts, `env`) – never in `args`. Values a step before
 * produces (a generated key, created price ids) are FROM_EARLIER_STEP here.
 */
export function planCommands(answers) {
  const mode = answers.mode === "live" ? "live" : "test";
  const out = [];
  if (answers.kv?.create) out.push(wrangler("Create the storage (KV namespace)", ["kv", "namespace", "create", "ENTITLEMENTS"]));
  out.push(wrangler("Deploy the Worker (first time, to learn its address)", ["deploy"]));
  const licence = answers.licence;
  if (licence?.generate) out.push(keygenCommand(), secretPut("LICENSE_PRIVATE_JWK", FROM_EARLIER_STEP));
  else if (licence?.privateJwkJson) out.push(secretPut("LICENSE_PRIVATE_JWK", licence.privateJwkJson));
  if (answers.stripe) {
    const s = { ...answers.stripe };
    if (s.prices === "create") {
      out.push(stripePricesCommand(s.secretKey ?? FROM_EARLIER_STEP));
      s.prices = { monthly: FROM_EARLIER_STEP, yearly: FROM_EARLIER_STEP };
    }
    out.push(...stripeSecretCommands(s));
  }
  if (answers.paypal) {
    const p = { ...answers.paypal };
    if (p.plans === "create") {
      out.push(paypalPlansCommand({ clientId: p.clientId ?? FROM_EARLIER_STEP, clientSecret: p.clientSecret ?? FROM_EARLIER_STEP }, mode));
      p.plans = { monthly: FROM_EARLIER_STEP, yearly: FROM_EARLIER_STEP };
    }
    out.push(...paypalSecretCommands(p, mode));
  }
  if (answers.crypto) out.push(...cryptoSecretCommands(answers.crypto, mode));
  out.push(wrangler("Deploy the Worker with everything in place", ["deploy"]));
  if (answers.github && mode === "live") out.push(...githubCommands(answers.github, answers.repo));
  return out;
}

/** How a command is shown: the environment and standard input as [hidden], never their values. */
export function describeCommand(c) {
  const env = Object.keys(c.env ?? {}).map((k) => `${k}=[hidden] `).join("");
  const where = c.cwd === "billing" ? "(in billing/) " : "";
  const cmd = c.cmd === process.execPath ? "node" : c.cmd.replace(/\.cmd$/, "");
  const args = c.args.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a));
  return `${where}${env}${cmd} ${args.join(" ")}${c.stdin !== undefined ? "  < [hidden]" : ""}`;
}

// --- running them ------------------------------------------------------------------------------------------------------

class WizardError extends Error {
  constructor(message, code = 1) {
    super(message);
    this.code = code;
  }
}

/** Run one command. Secret values go to its standard input; its output is kept, never echoed. */
function execute(c, { childEnv, interactive = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(c.cmd, c.args, {
      cwd: path.join(ROOT, c.cwd ?? "."),
      env: { ...process.env, ...childEnv, ...(c.env ?? {}) },
      shell: IS_WINDOWS && /\.cmd$/.test(c.cmd),
      stdio: interactive ? "inherit" : ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    if (!interactive) {
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.stdin.on("error", () => {});
      if (c.stdin !== undefined) child.stdin.end(c.stdin);
      else child.stdin.end();
    }
    child.on("error", (err) => resolve({ code: 127, stdout, stderr: `${stderr}${err.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function makeRunner({ dryRun, childEnv }) {
  return async function run(c, { allowFail = false, interactive = false, dryOutput = "" } = {}) {
    if (dryRun) {
      console.log(`  $ ${describeCommand(c)}`);
      return { code: 0, stdout: dryOutput, stderr: "" };
    }
    console.log(`  … ${c.label}`);
    const r = await execute(c, { childEnv, interactive });
    if (r.code !== 0 && !allowFail) {
      const tail = r.stderr.trim().split(/\r?\n/).slice(-20).join("\n");
      throw new WizardError(`"${c.label}" failed (exit code ${r.code}).${tail ? `\n${tail}` : ""}\nFix what it says and run npm run go-live again – what is already done stays done.`, r.code || 1);
    }
    return r;
  };
}

// --- asking ------------------------------------------------------------------------------------------------------------

/** Questions on the terminal. Hidden answers are not echoed on a terminal; piped answers are read line by line. */
class Prompter {
  constructor(input = process.stdin, output = process.stdout) {
    this.output = output;
    this.isTTY = !!input.isTTY;
    this.muted = false;
    const self = this;
    const sink = new Writable({
      write(chunk, enc, cb) {
        if (!self.muted) output.write(chunk, enc);
        cb();
      },
    });
    this.rl = readline.createInterface({ input, output: sink, terminal: this.isTTY });
    this.queue = [];
    this.waiters = [];
    this.closed = false;
    this.rl.on("line", (line) => {
      const w = this.waiters.shift();
      if (w) w(line);
      else this.queue.push(line);
    });
    this.rl.on("close", () => {
      this.closed = true;
      for (const w of this.waiters.splice(0)) w(null);
    });
    this.rl.on("SIGINT", () => {
      this.output.write("\nStopped. Nothing secret was saved; run npm run go-live again to continue.\n");
      process.exit(130);
    });
  }

  next() {
    if (this.queue.length) return Promise.resolve(this.queue.shift());
    if (this.closed) return Promise.resolve(null);
    return new Promise((r) => this.waiters.push(r));
  }

  /** The answer (trimmed), or null when the input has ended. */
  async ask(question, { hidden = false } = {}) {
    this.output.write(question);
    if (hidden && this.isTTY) this.muted = true;
    const answer = await this.next();
    if (hidden && this.isTTY) {
      this.muted = false;
      this.output.write("\n");
    } else if (!this.isTTY) this.output.write("\n");
    return answer === null ? null : answer.trim();
  }

  close() {
    this.rl.close();
  }
}

// --- the wizard --------------------------------------------------------------------------------------------------------

const say = (...lines) => console.log(lines.join("\n"));
const heading = (title) => console.log(`\n── ${title} ${"─".repeat(Math.max(4, 66 - title.length))}`);

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

async function fetchHealth(workerUrl) {
  try {
    const res = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function main(argv = process.argv.slice(2)) {
  const opts = parseOptions(argv, { booleans: ["dry-run", "yes", "help"], strings: ["mode", "skip"] });
  if (opts.help) {
    say("Usage: npm run go-live [-- --mode test|live] [--dry-run] [--skip stripe,paypal,crypto,github] [--yes]", "The guide: docs/GO-LIVE.md");
    return 0;
  }
  const dryRun = !!opts["dry-run"];
  const skip = new Set(String(opts.skip ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  for (const s of skip) if (!["stripe", "paypal", "crypto", "github"].includes(s)) throw new WizardError(`--skip takes stripe, paypal, crypto and github, not "${s}"`);
  if (opts.mode && opts.mode !== "live" && opts.mode !== "test") throw new WizardError("--mode is test or live");

  const config = readBillingConfig();
  const childEnv = {}; // a Cloudflare token pasted here reaches the child processes only
  const run = makeRunner({ dryRun, childEnv });
  const prompter = new Prompter();
  const done = { secrets: [], kept: [], variables: [], files: [] };

  const ended = () => new WizardError("The answers ended before the wizard was done. Run npm run go-live again – what is done stays done.");
  const yesNo = async (question, def) => {
    if (opts.yes) {
      console.log(`${question} ${def ? "yes" : "no"} (--yes)`);
      return def;
    }
    for (;;) {
      const a = await prompter.ask(`${question} [${def ? "Y/n" : "y/N"}] `);
      if (a === null || a === "") return def;
      if (/^y(es)?$/i.test(a)) return true;
      if (/^no?$/i.test(a)) return false;
      console.log("  Please answer y or n.");
    }
  };
  /** A value: validated; Enter (or the end of the input) takes `fallback` when there is one. */
  const value = async (question, check, { fallback, optional = false, hidden = false } = {}) => {
    for (;;) {
      const a = await prompter.ask(question, { hidden });
      if (a === null) {
        if (fallback !== undefined || optional) return fallback;
        throw ended();
      }
      if (a === "") {
        if (fallback !== undefined || optional) return fallback;
        console.log("  This one is needed.");
        continue;
      }
      const r = check(a);
      if (r.ok) return r.value;
      console.log(`  That does not look right: ${r.reason}. Try again.`);
    }
  };
  let known = null; // the Worker's secret names (null: unknown, e.g. in a dry run – then Enter may keep anything)
  /** A secret: hidden, validated; Enter keeps the Worker's own (when it has one) and returns undefined. */
  const secret = async (name, question, where, check, { hidden = true } = {}) => {
    const has = known === null || known.has(name);
    const paste = hidden ? "Paste it (hidden)" : "Paste it";
    for (;;) {
      const a = await prompter.ask(`${question}\n  Where: ${where}\n  ${has ? `${paste}, or press Enter to keep the one the Worker has: ` : `${paste}: `}`, { hidden });
      if (a === null || a === "") {
        if (has) {
          done.kept.push(name);
          return undefined;
        }
        if (a === null) throw ended();
        console.log(`  The Worker has no ${name} yet – it is needed.`);
        continue;
      }
      const r = check(a);
      if (r.ok) return r.value;
      console.log(`  That does not look right: ${r.reason}. Try again.`);
    }
  };
  const putSecrets = async (commands) => {
    for (const c of commands) {
      await run(c);
      done.secrets.push(c.args[c.args.length - 1]);
    }
  };

  try {
    say(
      "JumpingBallsLive – go-live wizard",
      "This puts your payment keys into the billing Worker on Cloudflare and the public settings into GitHub.",
      "Nothing secret is printed or saved on this computer. docs/GO-LIVE.md explains every question.",
      dryRun ? "DRY RUN: the commands are printed with secret values as [hidden]; nothing runs and no file changes." : "",
    );

    // 1. Preflight
    heading("Checking this computer");
    if (nodeMajor() < 20) throw new WizardError(`Node.js 20 or newer is needed (this is ${process.versions.node}). Install it from https://nodejs.org and run this again.`);
    const wranglerBin = path.join(BILLING_DIR, "node_modules", ".bin", IS_WINDOWS ? "wrangler.cmd" : "wrangler");
    if (!fs.existsSync(wranglerBin)) {
      if (!(await yesNo("The Worker's tools are not installed. Install them now (npm ci in billing/)?", true))) throw new WizardError("The Worker's tools are needed: run `cd billing && npm ci`, then this again.");
      await run({ label: "Install the Worker's tools", cmd: NPM, args: ["ci"], cwd: "billing", secret: false });
    }
    let whoami = dryRun ? { code: 0, stdout: "" } : await run(wrangler("Check the Cloudflare login", ["whoami"]), { allowFail: true });
    if (dryRun) console.log(`  $ ${describeCommand(wrangler("", ["whoami"]))}`);
    const loggedIn = (r) => /You are logged in/i.test(`${r.stdout}${r.stderr ?? ""}`);
    if (!dryRun && !loggedIn(whoami)) {
      say("Wrangler (Cloudflare's tool) is not logged in.");
      const viaBrowser = await yesNo("Log in with your browser now? (No: paste a Cloudflare API token instead)", true);
      if (viaBrowser) {
        prompter.rl.pause(); // the login has the terminal to itself
        try {
          await run(wrangler("Log in to Cloudflare (a browser window opens)", ["login"]), { interactive: true });
        } finally {
          prompter.rl.resume();
        }
      }
      else {
        childEnv.CLOUDFLARE_API_TOKEN = await value(
          "Cloudflare API token (My Profile → API Tokens → Create Token → \"Edit Cloudflare Workers\" template, add Account → Workers KV Storage → Edit) – hidden: ",
          VALIDATORS.cloudflareApiToken,
          { hidden: true },
        );
      }
      whoami = await run(wrangler("Check the Cloudflare login", ["whoami"]), { allowFail: true });
      if (!loggedIn(whoami)) throw new WizardError("Still not logged in to Cloudflare. Run `cd billing && npx wrangler login`, then this again.");
    }
    const accountId = parseAccountId(whoami.stdout);
    const ghReady = dryRun ? true : ghRunner(["auth", "status"]).ok;
    const remote = repoFromGit();
    const repo = remote.slug;
    say(
      `  Cloudflare: ${dryRun ? "(not checked in a dry run)" : "logged in"}`,
      `  GitHub: ${ghReady ? `the gh tool can set the variables of ${repo}` : `gh is not installed or not logged in – the wizard prints what to paste into ${repo}'s settings`}`,
      "",
      "The plan:",
      "  1. Storage: find or create the Worker's KV namespace and write its id into billing/wrangler.toml.",
      "  2. Deploy the Worker once, to learn its address.",
      "  3. The licence key: the public test key (test mode) or your own key pair (live mode).",
      "  4. Stripe, PayPal and NOWPayments: paste each key once; the wizard stores it in the Worker.",
      "  5. Deploy the Worker again with everything in place.",
      "  6. GitHub: the public settings the website is built with (live mode only).",
    );

    // 2. Mode
    heading("Test or live");
    let mode = opts.mode;
    if (!mode) {
      mode = await value("Are we testing (test cards, sandbox accounts) or going live with real money? [test/live] (Enter = test): ", (a) =>
        /^(test|live)$/i.test(a) ? ok(a.toLowerCase()) : bad("type test or live"),
        { fallback: "test" },
      );
    }
    say(
      mode === "test"
        ? "Test mode: the Worker signs with the public TEST licence key; Stripe test keys, the PayPal sandbox and the NOWPayments sandbox. The live site stays in test mode; you point it at the Worker yourself (the wizard says how at the end)."
        : "Live mode: your own licence key pair, live Stripe / PayPal / NOWPayments keys, and the two GitHub variables that switch the website to live payments.",
    );

    // 3. Site origins
    heading("Where the website lives");
    const tomlText = fs.readFileSync(WRANGLER_TOML, "utf8");
    const toml = readWranglerToml(tomlText);
    const pagesOrigin = `https://${remote.owner.toLowerCase()}.github.io`;
    let origins = [...new Set([pagesOrigin, ...toml.siteOrigins.map((o) => o.toLowerCase().replace(/\/+$/, ""))])];
    const own = await value(
      `Do you have your own domain for the site? Enter it like https://www.example.com, or press Enter to keep: ${origins.join(" ")}\n  > `,
      VALIDATORS.origin,
      { optional: true },
    );
    if (own) origins = [...new Set([...origins, own])];
    const siteOrigin = origins.join(" ");

    // 4. Storage
    heading("Storage (Cloudflare KV)");
    let kvId = toml.kvId;
    const kvTitle = `${toml.name}-ENTITLEMENTS`;
    const list = await run(wrangler("Look for the storage", ["kv", "namespace", "list"]), { dryOutput: "[]" });
    const found = parseKvList(list.stdout).find((n) => n.title === kvTitle || n.id === kvId);
    if (found) {
      kvId = found.id;
      say(`  Found the storage "${found.title}".`);
    } else {
      const created = await run(wrangler("Create the storage (KV namespace)", ["kv", "namespace", "create", "ENTITLEMENTS"]), { dryOutput: 'id = "0123456789abcdef0123456789abcdef"' });
      kvId = parseKvCreateOutput(created.stdout);
      if (!kvId) kvId = await value("Wrangler did not print the new namespace's id. Paste it (32 characters): ", VALIDATORS.kvNamespaceId);
    }
    const patched = patchWranglerToml(tomlText, { kvId, siteOrigin });
    if (dryRun) say(`  Would write billing/wrangler.toml: the storage id and SITE_ORIGIN = "${siteOrigin}"`);
    else if (patched !== tomlText) {
      fs.writeFileSync(WRANGLER_TOML, patched);
      done.files.push("billing/wrangler.toml");
      say("  Wrote billing/wrangler.toml – commit and push it: it holds no secret.");
    }

    // 5. First deploy
    heading("Deploying the Worker");
    const deploy1 = await run(wrangler("Deploy the Worker (first time, to learn its address)", ["deploy"]), { dryOutput: "https://jumpingballslive-billing.your-subdomain.workers.dev" });
    let workerUrl = parseWorkerUrl(deploy1.stdout);
    if (!workerUrl) workerUrl = await value("Paste the Worker's address Wrangler printed (https://….workers.dev): ", VALIDATORS.workerUrl);
    say(`  The Worker lives at ${workerUrl} – this is BILLING_API_URL and the start of every webhook address below.`);
    if (!dryRun) {
      const listed = await run(wrangler("Read which secrets the Worker has (names only)", ["secret", "list"]), { allowFail: true });
      known = new Set(parseSecretList(listed.stdout));
    }

    // 6. Licence key
    heading("The licence key");
    let publicKey = null;
    if (mode === "test") {
      await putSecrets([secretPut("LICENSE_PRIVATE_JWK", JSON.stringify(readTestKey().privateJwk))]);
      publicKey = TEST_PUBLIC_KEY;
      say("  The Worker signs with the public TEST key (the site's test mode verifies it).");
    } else {
      const health = dryRun ? null : await fetchHealth(workerUrl);
      const hasReal = dryRun ? true : !!(known?.has("LICENSE_PRIVATE_JWK") && health?.signingKey?.configured && !health.signingKey.test);
      let keep = false;
      if (hasReal) keep = await yesNo(`The Worker already has your own licence key${health?.signingKey?.publicKey ? ` (public half ${health.signingKey.publicKey.slice(0, 12)}…)` : ""}. Keep it? (No makes a new pair – every buyer then restores once)`, true);
      if (keep) {
        publicKey = health?.signingKey?.publicKey ?? null;
        done.kept.push("LICENSE_PRIVATE_JWK");
      } else if (await yesNo("Do you already have a licence key pair (the two lines of an earlier key generator run)?", false)) {
        publicKey = await value("The public key (line 2, starts MFkw…): ", (a) => VALIDATORS.publicKey(a, "live"));
        const jwk = await value("The private key (line 1, starts with {) – hidden: ", (a) => VALIDATORS.privateJwk(a, "live", publicKey), { hidden: true });
        await putSecrets([secretPut("LICENSE_PRIVATE_JWK", jwk)]);
      } else {
        const gen = await run(keygenCommand(), { dryOutput: `${JSON.stringify({ privateJwk: readTestKey().privateJwk })}\n${TEST_PUBLIC_KEY}\n` });
        const pair = parseKeygenOutput(gen.stdout);
        if (!pair) throw new WizardError("The key generator did not print a key pair.");
        await putSecrets([secretPut("LICENSE_PRIVATE_JWK", dryRun ? FROM_EARLIER_STEP : pair.privateJwkJson)]);
        publicKey = dryRun ? "(the new public key)" : pair.publicKey;
      }
      if (!keep) {
        say(
          "  The private key now lives only in Cloudflare; it cannot be read back. If it is ever lost, run this again – buyers then",
          "  restore their licence once with their email and receipt reference.",
        );
      }
    }

    // 7. Stripe
    let stripeOn = false;
    if (!skip.has("stripe")) {
      heading("Stripe (cards)");
      stripeOn = true;
      const s = {};
      s.secretKey = await secret(
        "STRIPE_SECRET_KEY",
        `Your Stripe secret key – the ${mode} one (it starts with sk_${mode}).`,
        `dashboard.stripe.com → Developers → API keys → Secret key (${mode === "live" ? "Test mode switched OFF" : "Test mode switched ON"})`,
        (a) => VALIDATORS.stripeSecretKey(a, mode),
      );
      const keptPrices = known === null || (known.has("STRIPE_PRICE_MONTHLY") && known.has("STRIPE_PRICE_YEARLY"));
      if (s.secretKey === undefined && keptPrices && (await yesNo("Keep the Worker's two Stripe price ids?", true))) {
        done.kept.push("STRIPE_PRICE_MONTHLY", "STRIPE_PRICE_YEARLY");
      } else if (s.secretKey === undefined || (await yesNo("Do you already have the two price ids (price_…)?", false))) {
        s.prices = {
          monthly: await value(`The monthly price id ($${config.plans.monthly.usd} a month): `, VALIDATORS.stripePriceId),
          yearly: await value(`The yearly price id ($${config.plans.yearly.usd} a year): `, VALIDATORS.stripePriceId),
        };
      } else {
        const r = await run(stripePricesCommand(s.secretKey), { dryOutput: "STRIPE_PRICE_MONTHLY=price_fromScript1\nSTRIPE_PRICE_YEARLY=price_fromScript2" });
        const ids = parseEnvLines(r.stdout);
        if (!VALIDATORS.stripePriceId(ids.STRIPE_PRICE_MONTHLY ?? "").ok || !VALIDATORS.stripePriceId(ids.STRIPE_PRICE_YEARLY ?? "").ok) throw new WizardError("The Stripe price script did not print two price ids.");
        s.prices = { monthly: ids.STRIPE_PRICE_MONTHLY, yearly: ids.STRIPE_PRICE_YEARLY };
        say(`  Prices: ${s.prices.monthly} (monthly), ${s.prices.yearly} (yearly).`);
      }
      s.automaticTax = await yesNo("Do you use Stripe Tax (Settings → Tax, with your registrations added)?", false);
      say(
        "",
        `  Now in Stripe (${mode === "live" ? "live mode" : "Test mode"}): Developers → Webhooks → Add endpoint`,
        `    Endpoint URL:  ${workerUrl}${config.stripe.webhookPath}`,
        `    API version:   ${config.stripe.apiVersion}`,
        `    Events (exactly these ${config.stripe.webhookEvents.length}): ${config.stripe.webhookEvents.join(", ")}`,
        "  Also, once: Settings → Billing → Customer portal → allow cancelling and updating cards → Save,",
        "  and Settings → Emails → Successful payments: on (Stripe then e-mails the receipt).",
      );
      s.webhookSecret = await secret("STRIPE_WEBHOOK_SECRET", "The endpoint's signing secret (whsec_…).", "the endpoint's page → Signing secret → Reveal", VALIDATORS.stripeWebhookSecret);
      await putSecrets(stripeSecretCommands(s));
    }

    // 8. PayPal
    let paypalOn = false;
    if (!skip.has("paypal")) {
      heading("PayPal");
      paypalOn = true;
      const p = {};
      const tab = mode === "live" ? "Live" : "Sandbox";
      p.clientId = await secret("PAYPAL_CLIENT_ID", "Your PayPal app's Client ID.", `developer.paypal.com → Apps & Credentials → ${tab} → your app (with Subscriptions ticked) → Client ID`, VALIDATORS.paypalClientId);
      p.clientSecret = await secret("PAYPAL_CLIENT_SECRET", "Your PayPal app's Secret.", `the same app page → Secret key → Show`, VALIDATORS.paypalClientSecret);
      const keptPlans = known === null || (known.has("PAYPAL_PLAN_MONTHLY") && known.has("PAYPAL_PLAN_YEARLY"));
      const canCreate = p.clientId !== undefined && p.clientSecret !== undefined;
      if (!canCreate && keptPlans && (await yesNo("Keep the Worker's two PayPal plan ids?", true))) {
        done.kept.push("PAYPAL_PLAN_MONTHLY", "PAYPAL_PLAN_YEARLY");
      } else if (!canCreate || (await yesNo("Do you already have the two plan ids (P-…)?", false))) {
        p.plans = {
          monthly: await value(`The monthly plan id ($${config.plans.monthly.usd} a month): `, VALIDATORS.paypalPlanId),
          yearly: await value(`The yearly plan id ($${config.plans.yearly.usd} a year): `, VALIDATORS.paypalPlanId),
        };
      } else {
        const r = await run(paypalPlansCommand(p, mode), { dryOutput: "PAYPAL_PLAN_MONTHLY=P-FROMSCRIPT01\nPAYPAL_PLAN_YEARLY=P-FROMSCRIPT02" });
        const ids = parseEnvLines(r.stdout);
        if (!VALIDATORS.paypalPlanId(ids.PAYPAL_PLAN_MONTHLY ?? "").ok || !VALIDATORS.paypalPlanId(ids.PAYPAL_PLAN_YEARLY ?? "").ok) throw new WizardError("The PayPal plan script did not print two plan ids.");
        p.plans = { monthly: ids.PAYPAL_PLAN_MONTHLY, yearly: ids.PAYPAL_PLAN_YEARLY };
        say(`  Plans: ${p.plans.monthly} (monthly), ${p.plans.yearly} (yearly).`);
      }
      say(
        "",
        `  Now on developer.paypal.com (${tab}): your app → Webhooks → Add Webhook`,
        `    Webhook URL:  ${workerUrl}${config.paypal.webhookPath}`,
        `    Events (exactly these ${config.paypal.webhookEvents.length}): ${config.paypal.webhookEvents.join(", ")}`,
      );
      p.webhookId = await secret("PAYPAL_WEBHOOK_ID", "The new webhook's Webhook ID.", "your app → Webhooks → the Webhook ID column", VALIDATORS.paypalWebhookId, { hidden: false });
      await putSecrets(paypalSecretCommands(p, mode));
    }

    // 9. NOWPayments
    let cryptoOn = false;
    if (!skip.has("crypto")) {
      heading("NOWPayments (crypto)");
      cryptoOn = true;
      const site = mode === "live" ? "account.nowpayments.io" : "account-sandbox.nowpayments.io";
      say(
        "  Before this: Store settings → Payout wallets – add your own wallet address for every coin you want to be paid in",
        "  (or turn on auto-conversion to one coin). This is how the crypto reaches your wallets; the repository never holds one.",
      );
      const c = {};
      c.apiKey = await secret("NOWPAYMENTS_API_KEY", "Your NOWPayments API key.", `${site} → Store settings → API keys`, VALIDATORS.nowpaymentsApiKey);
      c.ipnSecret = await secret("NOWPAYMENTS_IPN_SECRET", "Your IPN secret key.", `${site} → Store settings → Instant Payment Notifications → IPN secret key`, VALIDATORS.nowpaymentsIpnSecret);
      say(`  Paste this as the IPN callback URL on the same page: ${workerUrl}${config.nowpayments.ipnPath}`);
      await putSecrets(cryptoSecretCommands(c, mode));
    }

    // 10. Final deploy
    heading("Deploying the Worker again");
    await run(wrangler("Deploy the Worker with everything in place", ["deploy"]));
    if (mode === "live" && !publicKey && !dryRun) publicKey = (await fetchHealth(workerUrl))?.signingKey?.publicKey ?? null;
    if (mode === "live" && !publicKey) publicKey = await value("Paste the Worker's licence PUBLIC key (curl <worker>/health shows it as publicKey): ", (a) => VALIDATORS.publicKey(a, "live"));

    // 11. GitHub
    const variables = {};
    if (!skip.has("github")) {
      heading("GitHub");
      if (mode === "test") {
        say(
          "  Test mode sets nothing on GitHub: the live site stays in test mode.",
          "  To test on the live site: open it, press F12 → Console, run",
          `    localStorage.setItem("jbl.billingApi", "${workerUrl}")`,
          "  reload, and go to Pricing.",
        );
      } else {
        variables.BILLING_API_URL = workerUrl;
        variables.LICENSE_PUBLIC_KEY = publicKey;
        variables.SUPPORT_EMAIL = await value("The e-mail address buyers can write to (shown on the terms and pricing pages; recommended – Enter to skip): ", VALIDATORS.email, { optional: true });
        variables.LEGAL_NAME = await value("Your name or business name as the terms should show it (optional – Enter to skip): ", legalText(120), { optional: true });
        variables.LEGAL_ADDRESS = await value("Your business address for the terms (optional – Enter to skip): ", legalText(200), { optional: true });
        const secrets = {};
        if (await yesNo("Set the two secrets GitHub's \"Deploy billing worker\" workflow needs (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID)?", true)) {
          secrets.CLOUDFLARE_API_TOKEN =
            childEnv.CLOUDFLARE_API_TOKEN ??
            (await value(
              "A Cloudflare API token for GitHub (My Profile → API Tokens → Create Token → \"Edit Cloudflare Workers\" template, add Account → Workers KV Storage → Edit) – hidden: ",
              VALIDATORS.cloudflareApiToken,
              { hidden: true },
            ));
          secrets.CLOUDFLARE_ACCOUNT_ID = accountId ?? (await value("Your Cloudflare Account ID (Workers & Pages → Account details): ", VALIDATORS.cloudflareAccountId));
        }
        if (ghReady) {
          for (const c of githubCommands({ variables, secrets }, repo)) {
            await run(c);
            if (!c.secret) done.variables.push(c.args[2]);
          }
        } else {
          say("", `  Paste these in GitHub: ${repo} → Settings → Secrets and variables → Actions.`, "  Variables tab (public values):");
          for (const [k, v] of Object.entries(variables)) if (v) say(`    ${k} = ${v}`);
          if (Object.keys(secrets).length) say("  Secrets tab:", "    CLOUDFLARE_API_TOKEN = [hidden – the token you just pasted]", `    CLOUDFLARE_ACCOUNT_ID = ${secrets.CLOUDFLARE_ACCOUNT_ID ?? "[your account id]"}`);
        }
      }
    }

    // 12. Summary
    heading("Done");
    const secretLines = [...new Set(done.secrets)].map((n) => `${n} (set)`).concat([...new Set(done.kept)].map((n) => `${n} (kept)`));
    say(
      `  Worker secrets: ${secretLines.join(", ") || "none changed"}`,
      `  Worker address (BILLING_API_URL): ${workerUrl}`,
      `  Licence public key: ${publicKey ?? "(unchanged)"}`,
      `  Site origins: ${siteOrigin}`,
      `  Payments: ${[stripeOn && "Stripe", paypalOn && "PayPal", cryptoOn && "NOWPayments"].filter(Boolean).join(", ") || "none set up in this run"}`,
      done.variables.length ? `  GitHub variables set: ${done.variables.join(", ")} – push or re-run "Build and deploy to GitHub Pages" to rebuild the site.` : "",
      done.files.length ? `  Commit and push: ${done.files.join(", ")}` : "",
      `  Next: npm run go-live:check${mode === "test" ? " -- --mode test" : ""}`,
      "  Then the first purchases: docs/GO-LIVE.md, section 6 (test first, then go live).",
    );
    return 0;
  } finally {
    prompter.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`\ngo-live: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(err instanceof WizardError ? err.code : 1);
    },
  );
}
