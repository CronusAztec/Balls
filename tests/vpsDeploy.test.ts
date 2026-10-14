import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

/*
 * --- vps-site-deployer --- deploy/vps/jbl-deploy.sh runs here, whole, against stand-ins for git, npm, npx, curl, sleep and the two build
 * scripts node would run (the real node is used for its JSON): the order of the steps, the repository's checks as a gate, a failing
 * step, the retry window, the lock, a rollback by hash and the status file. install.sh and uninstall.sh are checked for syntax and
 * for what they must never do (print the token) and must always set (the service's sandboxing).
 */

const DIR = path.join(__dirname, "..", "deploy", "vps");
const SCRIPT = path.join(DIR, "jbl-deploy.sh");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const GREEN = JSON.stringify({ check_runs: [{ name: "build", status: "completed", conclusion: "success" }, { name: "smoke", status: "completed", conclusion: "failure" }] });
const RED = JSON.stringify({ check_runs: [{ name: "build", status: "completed", conclusion: "failure" }] });
const PENDING = JSON.stringify({ check_runs: [{ name: "build", status: "in_progress", conclusion: null }] });
const NONE = JSON.stringify({ check_runs: [] });

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

interface Sandbox {
  state: string;
  log: string;
  run: (args?: string[], env?: Record<string, string>) => { status: number | null; stdout: string; calls: string[] };
  result: () => { state: string; sha: string; message: string; at: string };
  file: (name: string) => string | null;
  setChecks: (json: string) => void;
}

function sandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-deploy-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const state = path.join(root, "state");
  const log = path.join(root, "calls.log");
  const checks = path.join(root, "checks.json");
  const live = path.join(root, "live.txt");
  fs.mkdirSync(bin);
  const stub = (name: string, body: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  stub("git", `echo "git $*" >> "$STUB_LOG"
case "$1" in
  ls-remote) [ "$STUB_LSREMOTE" = fail ] && exit 2; printf '%s\\t%s\\n' "$STUB_HEAD" "$3" ;;
  log) echo "2026-10-13T00:00:00+00:00" ;;
esac
exit 0`);
  stub("npm", `echo "npm $*" >> "$STUB_LOG"; [ "$STUB_FAIL" = npm ] && exit 1; exit 0`);
  stub("npx", `echo "npx $* | token=\${CLOUDFLARE_API_TOKEN:+set} site=$NEXT_PUBLIC_SITE_URL base=[$NEXT_PUBLIC_BASE_PATH] gh=$NEXT_PUBLIC_GITHUB_REPO billing=$NEXT_PUBLIC_BILLING_API relay=$NEXT_PUBLIC_PUBLISH_RELAY_URL" >> "$STUB_LOG"
case "$*" in
  *"next build"*) [ "$STUB_FAIL" = build ] && exit 1; mkdir -p out ;;
  *wrangler*) [ "$STUB_FAIL" = wrangler ] && exit 1; [ "$STUB_FAIL" = nolive ] || cp out/build.txt "$STUB_LIVE" ;;
esac
exit 0`);
  stub("curl", `echo "curl $*" >> "$STUB_LOG"
case "$*" in
  *api.github.com*) cat "$STUB_CHECKS" ;;
  *build.txt*) cat "$STUB_LIVE" 2>/dev/null || exit 22 ;;
  *) exit 22 ;;
esac`);
  stub("sleep", "exit 0");
  stub("node", `case "$1" in
  scripts/go-live-check.mjs) echo "node $* | lk=\${LICENSE_PUBLIC_KEY:+set} billing=$BILLING_API_URL" >> "$STUB_LOG"; [ "$STUB_FAIL" = guard ] && exit 1; exit 0 ;;
  scripts/postexport.mjs) echo "node $*" >> "$STUB_LOG"; mkdir -p out; exit 0 ;;
  *) exec "${process.execPath}" "$@" ;;
esac`);
  fs.writeFileSync(checks, GREEN);
  const base: Record<string, string> = {
    PATH: `${bin}:${process.env.PATH}`,
    HOME: root,
    JBL_DEPLOY_CONF: path.join(root, "no-such-file"),
    JBL_STATE_DIR: state,
    JBL_VERIFY_TRIES: "3",
    JBL_VERIFY_WAIT: "0",
    CLOUDFLARE_API_TOKEN: "test-token-0123456789",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    STUB_LOG: log,
    STUB_CHECKS: checks,
    STUB_LIVE: live,
    STUB_HEAD: SHA_A,
  };
  return {
    state,
    log,
    run(args = [], env = {}) {
      fs.writeFileSync(log, "");
      const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...base, ...env } as NodeJS.ProcessEnv, timeout: 60_000 });
      return { status: r.status, stdout: `${r.stdout}${r.stderr}`, calls: fs.readFileSync(log, "utf8").split("\n").filter(Boolean) };
    },
    result: () => JSON.parse(fs.readFileSync(path.join(state, "last-result.json"), "utf8")),
    file: (name) => (fs.existsSync(path.join(state, name)) ? fs.readFileSync(path.join(state, name), "utf8").trim() : null),
    setChecks: (json) => fs.writeFileSync(checks, json),
  };
}

const index = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle));

describe("jbl-deploy.sh: a new commit on the branch", () => {
  it("fetches exactly that commit, builds, deploys and calls it deployed only when the live site names it", () => {
    const sb = sandbox();
    const r = sb.run();
    expect(r.status, r.stdout).toBe(0);
    const order = ["git ls-remote", "api.github.com/repos/CronusAztec/Balls/commits/" + SHA_A + "/check-runs", `git fetch -q --depth 1 origin ${SHA_A}`, `git checkout -qf ${SHA_A}`, "npm ci --no-audit", "npm ci --prefix billing", "go-live-check.mjs --deploy-guard", "next build --no-lint", "postexport.mjs", "--prefix billing wrangler deploy", "/build.txt"].map((n) => index(r.calls, n));
    expect(order.every((i) => i >= 0), JSON.stringify(r.calls)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(index(r.calls, "git ls-remote https://github.com/CronusAztec/Balls.git refs/heads/main")).toBe(0);
    expect(sb.file("last-ok")).toBe(SHA_A);
    expect(sb.result()).toMatchObject({ state: "ok", sha: SHA_A });
    expect(sb.file("last-failed")).toBeNull();
    // the build is for the root of the domain with the live billing values, the token reaches only wrangler's process
    const build = r.calls.find((c) => c.includes("next build"))!;
    expect(build).toContain("site=https://jumpingballslive.com base=[] gh=CronusAztec/Balls");
    expect(build).toContain("billing=https://jumpingballslive-billing.jumpingballslive.workers.dev");
    expect(build).toContain("relay=https://relay.jumpingballslive.com");
    expect(r.calls.find((c) => c.includes("go-live-check.mjs"))).toContain("lk=set billing=https://jumpingballslive-billing");
    expect(r.calls.find((c) => c.includes("wrangler deploy"))).toContain("token=set");
  });

  it("does nothing, and asks GitHub only once, when the commit is the one already deployed", () => {
    const sb = sandbox();
    expect(sb.run().status).toBe(0);
    const again = sb.run();
    expect(again.status).toBe(0);
    expect(again.calls).toHaveLength(1);
    expect(again.calls[0]).toContain("git ls-remote");
  });

  it("deploys the next commit at once", () => {
    const sb = sandbox();
    sb.run();
    const r = sb.run([], { STUB_HEAD: SHA_B });
    expect(r.status, r.stdout).toBe(0);
    expect(sb.file("last-ok")).toBe(SHA_B);
    expect(r.calls.some((c) => c.includes(`git fetch -q --depth 1 origin ${SHA_B}`))).toBe(true);
  });

  it("takes the repository, the branch and the site from its settings", () => {
    const sb = sandbox();
    const r = sb.run([], { JBL_REPO: "me/site", JBL_BRANCH: "release", JBL_SITE_URL: "https://example.org" });
    expect(r.calls[0]).toBe("git ls-remote https://github.com/me/site.git refs/heads/release");
    expect(r.calls.find((c) => c.includes("next build"))).toContain("site=https://example.org");
    expect(r.calls.find((c) => c.includes("/build.txt"))).toContain("https://example.org/build.txt");
  });

  it("does nothing when GitHub cannot be reached or the branch is gone", () => {
    const sb = sandbox();
    expect(sb.run([], { STUB_LSREMOTE: "fail" }).calls).toHaveLength(1);
    expect(sb.run([], { STUB_HEAD: "" }).calls).toHaveLength(1);
    expect(sb.file("last-failed")).toBeNull();
  });
});

describe("jbl-deploy.sh: the repository's checks are the gate", () => {
  it("never deploys a commit whose build check is red, and does not try it again", () => {
    const sb = sandbox();
    sb.setChecks(RED);
    const r = sb.run();
    expect(r.status).toBe(0);
    expect(r.calls.some((c) => c.includes("git fetch") || c.includes("wrangler"))).toBe(false);
    expect(sb.result()).toMatchObject({ state: "skipped", sha: SHA_A });
    expect(sb.file("last-failed")).toBe(SHA_A);
    expect(sb.run().calls).toHaveLength(1); // inside the retry window: only the ls-remote
  });

  it("waits, and tries again at the next run, while the check is still running or has not started", () => {
    const sb = sandbox();
    for (const json of [PENDING, NONE]) {
      sb.setChecks(json);
      const r = sb.run();
      expect(r.status).toBe(0);
      expect(r.calls.some((c) => c.includes("git fetch"))).toBe(false);
      expect(sb.result().state).toBe("waiting");
      expect(sb.file("last-failed")).toBeNull();
    }
    sb.setChecks(GREEN);
    expect(sb.run().status).toBe(0);
    expect(sb.file("last-ok")).toBe(SHA_A);
  });

  it("waits when the checks API cannot be read, and can be told not to ask at all", () => {
    const sb = sandbox();
    sb.setChecks("not json");
    expect(sb.run().calls.some((c) => c.includes("git fetch"))).toBe(false);
    const r = sb.run([], { JBL_REQUIRE_GREEN: "0" });
    expect(r.status, r.stdout).toBe(0);
    expect(r.calls.some((c) => c.includes("api.github.com"))).toBe(false);
    expect(sb.file("last-ok")).toBe(SHA_A);
  });
});

describe("jbl-deploy.sh: when a step fails", () => {
  for (const [fail, step] of [
    ["npm", "install the dependencies"],
    ["guard", "production guard"],
    ["build", "build the site"],
    ["wrangler", "wrangler deploy"],
  ] as const) {
    it(`stops at "${step}", records the commit as failed and never deploys after it`, () => {
      const sb = sandbox();
      const r = sb.run([], { STUB_FAIL: fail });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(`FAILED at step '${step}`);
      expect(sb.result()).toMatchObject({ state: "failed", sha: SHA_A });
      expect(sb.result().message).toContain(step);
      expect(sb.file("last-failed")).toBe(SHA_A);
      expect(sb.file("last-ok")).toBeNull();
      if (fail !== "wrangler") expect(r.calls.some((c) => c.includes("wrangler deploy"))).toBe(false);
    });
  }

  it("is not called deployed when the live site never names the commit", () => {
    const sb = sandbox();
    const r = sb.run([], { STUB_FAIL: "nolive" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("the live site does not serve");
    expect(r.calls.filter((c) => c.includes("/build.txt"))).toHaveLength(3);
    expect(sb.file("last-ok")).toBeNull();
    expect(sb.file("last-failed")).toBe(SHA_A);
  });

  it("does not retry the same failed commit inside the window, retries it after, and tries a new commit at once", () => {
    const sb = sandbox();
    expect(sb.run([], { STUB_FAIL: "build" }).status).toBe(1);
    expect(sb.run().calls).toHaveLength(1);
    const after = sb.run([], { JBL_RETRY_SECONDS: "0" });
    expect(after.status, after.stdout).toBe(0);
    expect(sb.file("last-ok")).toBe(SHA_A);
    expect(sb.run([], { STUB_FAIL: "build", STUB_HEAD: SHA_B }).status).toBe(1);
    expect(sb.file("last-failed")).toBe(SHA_B);
  });

  it("fails before touching anything when the Cloudflare settings are missing", () => {
    const sb = sandbox();
    const r = sb.run([], { CLOUDFLARE_API_TOKEN: "" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are missing");
    expect(r.calls.some((c) => c.includes("git fetch") || c.includes("npm"))).toBe(false);
  });
});

describe("jbl-deploy.sh: lock, rollback and status", () => {
  it("lets only one run work at a time", () => {
    const sb = sandbox();
    fs.mkdirSync(sb.state, { recursive: true });
    const held = spawnSync("bash", ["-c", `exec 8>"${sb.state}/lock"; flock -n 8 || exit 9; bash "${SCRIPT}"`], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.join(path.dirname(sb.log), "bin")}:${process.env.PATH}`, JBL_STATE_DIR: sb.state, JBL_DEPLOY_CONF: "/nonexistent", STUB_LOG: sb.log, STUB_HEAD: SHA_A },
    });
    expect(held.status).toBe(0);
    expect(held.stdout).toContain("another run is in progress");
    expect(fs.existsSync(sb.log)).toBe(false); // (no stand-in was called: nothing ran)
  });

  it("deploys a commit by hash on demand without asking the branch or the checks, and refuses anything else", () => {
    const sb = sandbox();
    sb.setChecks(RED);
    const r = sb.run(["--sha", SHA_B]);
    expect(r.status, r.stdout).toBe(0);
    expect(r.calls.some((c) => c.includes("git ls-remote") || c.includes("api.github.com"))).toBe(false);
    expect(r.calls.some((c) => c.includes(`git checkout -qf ${SHA_B}`))).toBe(true);
    expect(sb.file("last-ok")).toBe(SHA_B);
    for (const bad of ["main", "abc123", `${SHA_B}; rm -rf /`, SHA_B.toUpperCase(), ""]) {
      const refused = sb.run(["--sha", bad]);
      expect(refused.status, bad).toBe(2);
      expect(refused.calls, bad).toEqual([]);
    }
  });

  it("prints the last result, or says it never ran", () => {
    const sb = sandbox();
    expect(JSON.parse(sb.run(["--status"]).stdout)).toEqual({ state: "never run" });
    sb.run();
    expect(JSON.parse(sb.run(["--status"]).stdout)).toMatchObject({ state: "ok", sha: SHA_A });
  });
});

describe("install.sh and uninstall.sh", () => {
  const read = (name: string) => fs.readFileSync(path.join(DIR, name), "utf8");

  it("are valid bash", () => {
    for (const name of ["install.sh", "uninstall.sh", "jbl-deploy.sh"]) {
      const r = spawnSync("bash", ["-n", path.join(DIR, name)], { encoding: "utf8" });
      expect(r.status, `${name}: ${r.stderr}`).toBe(0);
    }
  });

  it("sandbox the service, keep the token in a file only the service user reads, and never print it", () => {
    const install = read("install.sh");
    for (const line of [
      "User=$USER_NAME",
      "NoNewPrivileges=true",
      "ProtectSystem=strict",
      "ProtectHome=true",
      "PrivateDevices=true",
      "ReadWritePaths=$STATE",
      "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX",
      "CapabilityBoundingSet=",
      "OnUnitInactiveSec=5min",
    ]) expect(install, line).toContain(line);
    expect(install).toContain("chmod 0640");
    expect(install).toContain('chown root:"$USER_NAME" "$CONF"');
    expect(install).toContain("read -r -s");
    expect(install).toContain("[A-Za-z0-9_-]{20,200}");
    for (const line of install.split("\n").filter((l) => /\$token\b|\$\{token\}/.test(l))) {
      expect(line, line).not.toMatch(/\b(echo|say|logger|tee)\b|>&2|printf '%s\\n' "\$token"/);
    }
    expect(install).not.toMatch(/ufw|iptables|listen|0\.0\.0\.0|ssh/i); // opens nothing, logs nobody in
  });

  it("uninstall removes the timer and the service, and the token only with --purge", () => {
    const un = read("uninstall.sh");
    expect(un).toContain("systemctl disable --now jbl-deploy.timer");
    expect(un).toContain("rm -rf /etc/jbl-deploy /var/lib/jbl-deploy");
    expect(un.indexOf('"${1:-}" = "--purge"')).toBeGreaterThan(un.indexOf("rm -rf /opt/jbl-deploy"));
  });
});
