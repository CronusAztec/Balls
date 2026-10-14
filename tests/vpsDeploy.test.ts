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
  run: (args?: string[], env?: Record<string, string>) => { status: number | null; stdout: string; calls: string[]; auth: string[]; stdin: string };
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
echo "$1 auth=\${GIT_CONFIG_VALUE_0:+yes}" >> "$STUB_LOG.auth"
case "$1" in
  ls-remote) [ "$STUB_LSREMOTE" = fail ] && exit 2; printf '%s\\t%s\\n' "$STUB_HEAD" "$3" ;;
  log) echo "2026-10-13T00:00:00+00:00" ;;
esac
exit 0`);
  stub("npm", `echo "npm $* | cf=\${CLOUDFLARE_API_TOKEN:+set} gh=\${JBL_GITHUB_TOKEN:+set}" >> "$STUB_LOG"; [ "$STUB_FAIL" = npm ] && exit 1; exit 0`);
  stub("npx", `echo "npx $* | token=\${CLOUDFLARE_API_TOKEN:+set} site=$NEXT_PUBLIC_SITE_URL base=[$NEXT_PUBLIC_BASE_PATH] gh=$NEXT_PUBLIC_GITHUB_REPO billing=$NEXT_PUBLIC_BILLING_API relay=$NEXT_PUBLIC_PUBLISH_RELAY_URL gh=\${JBL_GITHUB_TOKEN:+set} feedback=[$NEXT_PUBLIC_FEEDBACK_ENDPOINT] analytics=[$NEXT_PUBLIC_ANALYTICS_SCRIPT_URL|$NEXT_PUBLIC_ANALYTICS_SITE_ID] youtube=[$NEXT_PUBLIC_YOUTUBE_CLIENT_ID] downloads=[$NEXT_PUBLIC_DOWNLOADS_URL] support=[$NEXT_PUBLIC_SUPPORT_EMAIL] legal=[$NEXT_PUBLIC_LEGAL_NAME]" >> "$STUB_LOG"
case "$*" in
  *"next build"*) [ "$STUB_FAIL" = build ] && exit 1; mkdir -p out ;;
  *wrangler*) [ "$STUB_FAIL" = wrangler ] && exit 1; [ "$STUB_FAIL" = nolive ] || cp out/build.txt "$STUB_LIVE" ;;
esac
exit 0`);
  stub("curl", `echo "curl $*" >> "$STUB_LOG"
case "$*" in
  *api.github.com*) cat >> "$STUB_LOG.stdin" 2>/dev/null; cat "$STUB_CHECKS" ;;
  *build.txt*) cat "$STUB_LIVE" 2>/dev/null || exit 22 ;;
  *) exit 22 ;;
esac`);
  stub("sleep", "exit 0");
  stub("node", `case "$1" in
  scripts/go-live-check.mjs) echo "node $* | lk=\${LICENSE_PUBLIC_KEY:+set} billing=$BILLING_API_URL cf=\${CLOUDFLARE_API_TOKEN:+set} gh=\${JBL_GITHUB_TOKEN:+set}" >> "$STUB_LOG"; [ "$STUB_FAIL" = guard ] && exit 1; exit 0 ;;
  scripts/postexport.mjs) echo "node $* | cf=\${CLOUDFLARE_API_TOKEN:+set} gh=\${JBL_GITHUB_TOKEN:+set} site=[$NEXT_PUBLIC_SITE_URL] base=[$NEXT_PUBLIC_BASE_PATH] sha=[$JBL_BUILD_SHA]" >> "$STUB_LOG"; mkdir -p out; exit 0 ;;
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
      for (const f of [log, `${log}.auth`, `${log}.stdin`]) fs.writeFileSync(f, "");
      const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...base, ...env } as NodeJS.ProcessEnv, timeout: 60_000 });
      const lines = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
      return { status: r.status, stdout: `${r.stdout}${r.stderr}`, calls: lines(log), auth: lines(`${log}.auth`), stdin: fs.readFileSync(`${log}.stdin`, "utf8") };
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
    expect(build).toContain("site=https://jumpingballslive.com base=[] gh= billing="); // the source repository is private: the feedback form must not open its issues by default
    expect(build).toContain("billing=https://jumpingballslive-billing.jumpingballslive.workers.dev");
    expect(build).toContain("relay=https://relay.jumpingballslive.com");
    expect(r.calls.find((c) => c.includes("go-live-check.mjs"))).toContain("lk=set billing=https://jumpingballslive-billing");
    expect(r.calls.find((c) => c.includes("wrangler deploy"))).toContain("token=set");
    // postexport (version.json's address, the commit) gets the site's address and the commit as well, not only the build: the settings file is not exported
    const post = r.calls.find((c) => c.includes("postexport.mjs"))!;
    expect(post).toContain(`site=[https://jumpingballslive.com] base=[] sha=[${SHA_A}]`);
    expect(post).not.toMatch(/cf=set|gh=set/);
    const script = fs.readFileSync(SCRIPT, "utf8");
    const at = script.indexOf('JBL_BUILD_SHA="$HEAD_SHA"');
    expect(at).toBeGreaterThan(-1); // the build learns the commit too
    expect(at).toBeLessThan(script.indexOf("npx next build --no-lint"));
  });

  it("passes the operator's public details and the optional public build settings on to the build, and nothing when they are unset", () => {
    const plain = sandbox().run();
    expect(plain.status, plain.stdout).toBe(0);
    const bare = plain.calls.find((c) => c.includes("next build"))!;
    expect(bare).toContain("feedback=[] analytics=[|] youtube=[] downloads=[] support=[] legal=[]");
    expect(plain.stdout).toContain("warning: JBL_SUPPORT_EMAIL is not set"); // the journal says so on every build until it is

    const conf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jbl-deploy-conf-")), "env");
    cleanups.push(() => fs.rmSync(path.dirname(conf), { recursive: true, force: true }));
    fs.writeFileSync(
      conf,
      [
        "JBL_SUPPORT_EMAIL='support@example.com'",
        "JBL_LEGAL_NAME='Jan Kowalski'",
        "JBL_FEEDBACK_ENDPOINT='https://forms.example.com/f'",
        "JBL_ANALYTICS_SCRIPT_URL='https://stats.example.com/script.js'",
        "JBL_ANALYTICS_SITE_ID='abc123'",
        "JBL_YOUTUBE_CLIENT_ID='123-abc.apps.googleusercontent.com'",
        "JBL_DOWNLOADS_URL='https://downloads.example.com/latest'",
        "JBL_FEEDBACK_GITHUB_REPO='someone/public-repo'",
      ].join("\n"),
    );
    const set = sandbox().run([], { JBL_DEPLOY_CONF: conf });
    expect(set.status, set.stdout).toBe(0);
    const build = set.calls.find((c) => c.includes("next build"))!;
    expect(build).toContain("gh=someone/public-repo");
    expect(build).toContain("feedback=[https://forms.example.com/f] analytics=[https://stats.example.com/script.js|abc123]");
    expect(build).toContain("youtube=[123-abc.apps.googleusercontent.com] downloads=[https://downloads.example.com/latest] support=[support@example.com] legal=[Jan Kowalski]");
    expect(set.stdout).not.toContain("JBL_SUPPORT_EMAIL is not set");
  });

  it("says in --status when it cannot read the repository, instead of staying silent (the repository went private)", () => {
    const sb = sandbox();
    const r = sb.run([], { STUB_LSREMOTE: "fail" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("cannot read main of CronusAztec/Balls");
    expect(r.stdout).toContain("JBL_GITHUB_TOKEN is not set");
    expect(sb.result()).toMatchObject({ state: "unreachable" });
    expect(sb.result().message).toContain("JBL_GITHUB_TOKEN is not set");
    expect(r.calls.some((c) => c.includes("npm ci"))).toBe(false);
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

describe("jbl-deploy.sh: tokens reach only the step that needs them", () => {
  it("keeps the Cloudflare token out of the install, the guard and the build, and gives it to wrangler alone", () => {
    const sb = sandbox();
    const r = sb.run();
    expect(r.status, r.stdout).toBe(0);
    for (const needle of ["npm ci --no-audit", "npm ci --prefix billing", "go-live-check.mjs", "next build", "postexport.mjs"]) {
      const line = r.calls.find((c) => c.includes(needle))!;
      expect(line, needle).toBeTruthy();
      expect(line, needle).not.toMatch(/(token|cf)=set/);
    }
    expect(r.calls.find((c) => c.includes("wrangler deploy"))).toContain("token=set");
  });

  it("without a GitHub token talks to a public repository: no credential on any git command or API call", () => {
    const sb = sandbox();
    const r = sb.run();
    expect(r.auth.some((l) => l.includes("auth=yes"))).toBe(false);
    expect(r.stdin).not.toContain("Authorization");
    expect(r.stdin).toContain("Accept: application/vnd.github+json");
  });

  it("with JBL_GITHUB_TOKEN (a private repository) signs ls-remote, fetch and the checks lookup, and nothing else", () => {
    const sb = sandbox();
    const token = "github_pat_TESTTOKEN0123456789abcdefghij";
    const r = sb.run([], { JBL_GITHUB_TOKEN: token });
    expect(r.status, r.stdout).toBe(0);
    const signed = r.auth.filter((l) => l.includes("auth=yes")).map((l) => l.split(" ")[0]);
    expect(signed).toEqual(["ls-remote", "fetch"]);
    expect(r.auth.filter((l) => l.startsWith("init ") || l.startsWith("checkout ") || l.startsWith("clean ")).every((l) => l.endsWith("auth="))).toBe(true);
    expect(r.stdin).toContain(`Authorization: Bearer ${token}`);
    // never in an argument list (any user of the server can read those), never in the output, never in the build
    expect(r.calls.join("\n")).not.toContain(token);
    expect(r.stdout).not.toContain(token);
    for (const needle of ["npm ci", "go-live-check.mjs", "next build", "postexport.mjs", "wrangler deploy"]) {
      expect(r.calls.find((c) => c.includes(needle)), needle).not.toMatch(/gh=set/);
    }
    expect(sb.file("last-ok")).toBe(SHA_A);
  });

  it("says a private repository needs the token when GitHub cannot be read without it, or the checks cannot be seen", () => {
    const sb = sandbox();
    expect(sb.run([], { STUB_LSREMOTE: "fail" }).stdout).toContain("JBL_GITHUB_TOKEN is not set");
    expect(sb.run([], { STUB_LSREMOTE: "fail", JBL_GITHUB_TOKEN: "github_pat_x".padEnd(40, "x") }).stdout).not.toContain("JBL_GITHUB_TOKEN is not set");
    sb.setChecks("Not Found");
    expect(sb.run().stdout).toContain("a private repository needs JBL_GITHUB_TOKEN");
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
      "OnUnitInactiveSec=${EVERY}min",
      "EVERY=10",
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

  it("cleans a typed name or address for the single-quoted settings file and keeps what is written readable by bash", () => {
    const fn = read("install.sh").match(/^clean_text\(\) \{.*\}$/m)?.[0];
    expect(fn).toBeTruthy();
    const run = (input: string) => spawnSync("bash", ["-c", `${fn}\nclean_text "$1"`, "_", input], { encoding: "utf8" }).stdout;
    expect(run("Anna Nowak")).toBe("Anna Nowak");
    expect(run("\u001b[200~Anna Nowak\u001b[201~")).toBe("Anna Nowak"); // the paste markers
    expect(run("  Jan\tKowalski  ")).toBe("JanKowalski"); // control characters go, edge spaces go
    expect(run("Jan O'Brien")).toBe("Jan O\u2019Brien"); // a single quote would end the quoting
    expect(run("ul. Długa 5, 00-001 Warszawa")).toBe("ul. Długa 5, 00-001 Warszawa");
    // whatever it returns is safe between single quotes and sourced back unchanged (no expansion, no command execution)
    const hostile = run("a $HOME `id` $(id) \\ b");
    const conf = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "jbl-conf-")), "env");
    cleanups.push(() => fs.rmSync(path.dirname(conf), { recursive: true, force: true }));
    fs.writeFileSync(conf, `JBL_LEGAL_NAME='${hostile}'\n`);
    const back = spawnSync("bash", ["-c", `. "${conf}"; printf '%s' "$JBL_LEGAL_NAME"`], { encoding: "utf8" });
    expect(back.stdout).toBe(hostile);
    expect(hostile).toContain("$HOME");
  });

  it("does not stop at a prompt when there is no terminal: /dev/tty exists but cannot be opened (cloud-init, ssh without -t)", () => {
    const install = read("install.sh");
    const fn = install.match(/^have_tty\(\) \{.*\}$/m)?.[0];
    expect(fn).toBeTruthy();
    expect(install).not.toContain("[ -r /dev/tty ]");
    // every optional prompt tolerates a failed read, so `set -e` cannot end the script before the units are written
    for (const line of install.split("\n").filter((l) => /read -r -p .*<\/dev\/tty/.test(l))) expect(line, line).toMatch(/\|\| \w+=""$/);
    const r = spawnSync("setsid", ["-w", "bash", "-c", `set -e\n${fn}\nif have_tty; then read -r -p "x " a </dev/tty || a=""; fi\necho after`], { encoding: "utf8" });
    expect(r.stdout.trim().endsWith("after"), `${r.stdout}${r.stderr}`).toBe(true);
  });

  it("asks for the support e-mail, the legal name and the address, and warns when no support e-mail is set", () => {
    const install = read("install.sh");
    for (const key of ["JBL_SUPPORT_EMAIL", "JBL_LEGAL_NAME", "JBL_LEGAL_ADDRESS"]) expect(install, key).toContain(`grep -q "^${key}=" "$CONF"`);
    expect(install).toContain("NOTE: no support e-mail is set");
    expect(read("jbl-deploy.sh")).toContain('JBL_FEEDBACK_GITHUB_REPO="${JBL_FEEDBACK_GITHUB_REPO-}"');
  });

  it("looks for a new commit every ten minutes unless --every says otherwise, and refuses a nonsense interval before touching anything", () => {
    const install = read("install.sh");
    expect(install).toMatch(/^EVERY=10$/m);
    expect(install).toContain("Description=Look for a new commit of the site every $EVERY minutes");
    expect(install).toContain("OnUnitInactiveSec=${EVERY}min");
    expect(read("jbl-deploy.sh")).toContain("runs this every ten minutes");
    const run = (...args: string[]) => spawnSync("bash", [path.join(DIR, "install.sh"), ...args], { encoding: "utf8" });
    for (const bad of ["0", "4", "1441", "abc", "10min", "-5", "99999", ""]) {
      const r = run("--every", bad);
      expect(r.status, `--every '${bad}'`).toBe(1);
      expect(r.stderr, `--every '${bad}'`).toContain("--every must be a whole number of minutes from 5 to 1440");
    }
    const bare = run("--every");
    expect(bare.status).toBe(1);
    expect(bare.stderr).toContain("--every needs a number of minutes");
    // The accepting side is checked on the validation line alone: a good value would go on to install for real on a machine that has systemd.
    const check = install.match(/^\[\[ "\$EVERY" =~.*$/m)?.[0];
    expect(check).toBeTruthy();
    for (const good of ["5", "10", "60", "1440"]) {
      const r = spawnSync("bash", ["-c", `die() { echo "$*" >&2; exit 1; }\nEVERY="$1"\n${check}`, "_", good], { encoding: "utf8" });
      expect(r.status, `--every ${good}: ${r.stderr}`).toBe(0);
    }
  });

  it("cleans what a terminal adds to a pasted token (paste markers, spaces, line breaks) and nothing else", () => {
    const fn = read("install.sh").match(/^clean_input\(\) \{.*\}$/m)?.[0];
    expect(fn).toBeTruthy();
    const run = (input: string) => spawnSync("bash", ["-c", `${fn}\nclean_input "$1"`, "_", input], { encoding: "utf8" }).stdout;
    const token = "cfut_WutBJfmN0IDWZcQTApjTAP9Vs84tFlY69pWAxAtRbd3-x_";
    expect(run(token)).toBe(token);
    expect(run(`\u001b[200~${token}\u001b[201~`)).toBe(token); // the markers as sent
    expect(run(`[200~${token}~`.replace(/~$/, ""))).toBe(token); // the escape lost on the way
    expect(run(`  ${token}\r\n\t`)).toBe(token);
    expect(run(`${token.slice(0, 20)} ${token.slice(20)}`)).toBe(token); // a break inside
    expect(run("a1a1303c1defe6eafca7065581715c2e\u001b[201~")).toBe("a1a1303c1defe6eafca7065581715c2e");
    expect(run("")).toBe("");
  });

  it("--private asks for a read-only GitHub token, checks it against the repository, its commits and its checks, and never prints it", () => {
    const install = read("install.sh");
    expect(install).toContain("--private) PRIVATE=1");
    expect(install).toContain("Contents: Read-only");
    expect(install).toContain("Checks: Read-only");
    expect(install).toContain("github_pat_[A-Za-z0-9_]{20,255}");
    expect(install).toContain('set_conf JBL_GITHUB_TOKEN "$gh_token"');
    expect(install).toContain('set_conf JBL_FEEDBACK_GITHUB_REPO ""');
    expect(install).toContain("-H @-"); // the token goes to curl on stdin, not on its command line
    for (const line of install.split("\n").filter((l) => /\$gh_token\b|\$\{gh_token\}/.test(l))) {
      expect(line, line).not.toMatch(/\b(echo|say|logger|tee)\b|>&2/);
      if (/curl/.test(line)) expect(line, line).not.toMatch(/Bearer \$gh_token[^\\]*"https/);
    }
  });

  it("set_conf replaces one setting, keeps every other line and survives odd characters in the others", () => {
    const fn = read("install.sh").match(/^set_conf\(\) \{[\s\S]*?^\}$/m)?.[0];
    expect(fn).toBeTruthy();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-conf-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const conf = path.join(dir, "env");
    fs.writeFileSync(conf, "# comment with / and & and $\nCLOUDFLARE_API_TOKEN='abc'\nJBL_GITHUB_TOKEN='old'\nJBL_BRANCH='main'\n", { mode: 0o640 });
    const run = (key: string, value: string) => spawnSync("bash", ["-c", `CONF="${conf}"\n${fn}\nset_conf "$1" "$2"`, "_", key, value], { encoding: "utf8" });
    expect(run("JBL_GITHUB_TOKEN", "github_pat_NEW").status).toBe(0);
    expect(run("JBL_FEEDBACK_GITHUB_REPO", "").status).toBe(0);
    const text = fs.readFileSync(conf, "utf8");
    expect(text).toBe("# comment with / and & and $\nCLOUDFLARE_API_TOKEN='abc'\nJBL_BRANCH='main'\nJBL_GITHUB_TOKEN='github_pat_NEW'\nJBL_FEEDBACK_GITHUB_REPO=''\n");
    expect((fs.statSync(conf).mode & 0o777).toString(8)).toBe("640");
    // the file reads back as shell
    const back = spawnSync("bash", ["-c", `. "${conf}"; printf '%s|%s|%s' "$JBL_GITHUB_TOKEN" "$JBL_FEEDBACK_GITHUB_REPO" "$JBL_BRANCH"`], { encoding: "utf8" });
    expect(back.stdout).toBe("github_pat_NEW||main");
  });

  it("uninstall removes the timer and the service, and the token only with --purge", () => {
    const un = read("uninstall.sh");
    expect(un).toContain("systemctl disable --now jbl-deploy.timer");
    expect(un).toContain("rm -rf /etc/jbl-deploy /var/lib/jbl-deploy");
    expect(un.indexOf('"${1:-}" = "--purge"')).toBeGreaterThan(un.indexOf("rm -rf /opt/jbl-deploy"));
  });
});
