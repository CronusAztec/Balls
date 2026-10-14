import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";

/*
 * --- vps-site-deployer --- deploy/vps/jbl-deploy.sh runs here, whole, against stand-ins for git, npm, npx, curl, sleep and the two build
 * scripts node would run (the real node is used for its JSON): the order of the steps, the "build" job of the site workflow as a gate (read
 * through GitHub's Actions API: the workflow's runs for the commit, then the jobs of each run), a failing step, the retry window, the lock,
 * a rollback by hash and the status file. install.sh and uninstall.sh are checked for syntax and for what they must never do (print the
 * token) and must always set (the service's sandboxing); the token check of install.sh --private runs against a stand-in for curl too.
 */

const DIR = path.join(__dirname, "..", "deploy", "vps");
const SCRIPT = path.join(DIR, "jbl-deploy.sh");
const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const TOKEN = "github_pat_TESTTOKEN0123456789abcdefghij";

// What GitHub's Actions API answers for one commit: the runs of deploy.yml (newest first) and the jobs of each run.
interface Job { name: string; status: string; conclusion: string | null }
interface Run { id: number; jobs: Job[]; head_sha?: string; head_branch?: string; status?: string }
const job = (name: string, status: string, conclusion: string | null = null): Job => ({ name, status, conclusion });
const run = (id: number, ...jobs: Job[]): Run => ({ id, jobs });
const going = (r: Run, status = "in_progress"): Run => ({ ...r, status }); // (the run itself is not finished, whatever its jobs say)
const onBranch = (r: Run, head_branch: string): Run => ({ ...r, head_branch });
const BUILD_OK = job("build", "completed", "success");
const BUILD_RED = job("build", "completed", "failure");
const BUILD_RUNNING = job("build", "in_progress");
const BUILD_QUEUED = job("build", "queued");
const SMOKE_OK = job("smoke (shard 2 of 4)", "completed", "success");
const SMOKE_RED = job("smoke (shard 1 of 4)", "completed", "failure");
const DEPLOY_RED = job("deploy", "completed", "failure");
const GREEN = [run(101, BUILD_OK, SMOKE_RED, DEPLOY_RED)]; // (the smoke and deploy jobs failing must not matter)
const RED = [run(101, BUILD_RED, SMOKE_OK)];
const PENDING = [run(101, BUILD_RUNNING)];
const NONE: Run[] = [];
const API = "https://api.github.com/repos/CronusAztec/Balls";
const RUNS_URL = (sha: string, branch = "main") => `${API}/actions/workflows/deploy.yml/runs?head_sha=${sha}&per_page=5&branch=${branch}`;
const JOBS_URL = (id: number) => `${API}/actions/runs/${id}/jobs?per_page=100`;

// (a test that starts the script in a loop gets room for a busy two-core runner: the default of five seconds is too tight for a dozen runs)
const SLOW = 30_000;

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
  /** The runs of deploy.yml that GitHub lists for a commit (default SHA_A) pushed to a branch (default main), and the jobs of each run. */
  setRuns: (runs: Run[], sha?: string, branch?: string) => void;
  /** One raw answer: "runs-<sha>" or "jobs-<run id>", with the HTTP status it comes with (0: no answer at all; "silent": curl prints nothing). */
  setApi: (name: string, body: string, status?: number | "silent") => void;
}

function sandbox(): Sandbox {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-deploy-"));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, "bin");
  const state = path.join(root, "state");
  const log = path.join(root, "calls.log");
  const api = path.join(root, "api");
  const live = path.join(root, "live.txt");
  fs.mkdirSync(bin);
  fs.mkdirSync(api);
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
  // (the GitHub API stand-in answers like curl without -f: the body, then with -w the status on a line of its own; a missing answer is a 404)
  stub("curl", `printf 'curl %s\\n' "$*" >> "$STUB_LOG"
case "$*" in
  *api.github.com*)
    cat >> "$STUB_LOG.stdin" 2>/dev/null
    for url in "$@"; do :; done
    case "$url" in
      */actions/workflows/deploy.yml/runs*) key="runs-$(echo "$url" | sed -n 's/.*head_sha=\\([0-9a-f]*\\).*/\\1/p')" ;;
      */actions/runs/*/jobs*) key="jobs-$(echo "$url" | sed 's#.*/actions/runs/\\([0-9]*\\)/jobs.*#\\1#')" ;;
      *) key=other ;;
    esac
    code=404; body='{"message":"Not Found"}'
    if [ -f "$STUB_API/$key.json" ]; then code=$(cat "$STUB_API/$key.status"); body=$(cat "$STUB_API/$key.json"); fi
    case "$*" in *http_code*) tail=$(printf '\\n%s' "$code") ;; *) tail= ;; esac
    if [ "$code" = silent ]; then exit 7; fi
    if [ "$code" = 0 ]; then printf '\\n000'; exit 28; fi
    printf '%s%s' "$body" "$tail"
    ;;
  *build.txt*) cat "$STUB_LIVE" 2>/dev/null || exit 22 ;;
  *) exit 22 ;;
esac`);
  stub("sleep", "exit 0");
  stub("node", `case "$1" in
  scripts/go-live-check.mjs) echo "node $* | lk=\${LICENSE_PUBLIC_KEY:+set} billing=$BILLING_API_URL cf=\${CLOUDFLARE_API_TOKEN:+set} gh=\${JBL_GITHUB_TOKEN:+set}" >> "$STUB_LOG"; [ "$STUB_FAIL" = guard ] && exit 1; exit 0 ;;
  scripts/postexport.mjs) echo "node $* | cf=\${CLOUDFLARE_API_TOKEN:+set} gh=\${JBL_GITHUB_TOKEN:+set} site=[$NEXT_PUBLIC_SITE_URL] base=[$NEXT_PUBLIC_BASE_PATH] sha=[$JBL_BUILD_SHA]" >> "$STUB_LOG"; mkdir -p out; exit 0 ;;
  *) exec "${process.execPath}" "$@" ;;
esac`);
  const setApi = (name: string, body: string, status: number | "silent" = 200) => {
    fs.writeFileSync(path.join(api, `${name}.json`), body);
    fs.writeFileSync(path.join(api, `${name}.status`), String(status));
  };
  const setRuns = (runs: Run[], sha = SHA_A, branch = "main") => {
    setApi(`runs-${sha}`, JSON.stringify({ total_count: runs.length, workflow_runs: runs.map((r) => ({ id: r.id, name: "Build and deploy the site", path: ".github/workflows/deploy.yml", event: "push", head_sha: r.head_sha ?? sha, head_branch: r.head_branch ?? branch, status: r.status ?? "completed" })) }));
    for (const r of runs) setApi(`jobs-${r.id}`, JSON.stringify({ total_count: r.jobs.length, jobs: r.jobs.map((j, n) => ({ id: r.id * 10 + n, run_id: r.id, ...j })) }));
  };
  for (const sha of [SHA_A, SHA_B]) setRuns(GREEN, sha);
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
    STUB_API: api,
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
    setRuns,
    setApi,
  };
}

const index = (calls: string[], needle: string) => calls.findIndex((c) => c.includes(needle));

describe("jbl-deploy.sh: a new commit on the branch", () => {
  it("fetches exactly that commit, builds, deploys and calls it deployed only when the live site names it", () => {
    const sb = sandbox();
    const r = sb.run();
    expect(r.status, r.stdout).toBe(0);
    const order = ["git ls-remote", `api.github.com/repos/CronusAztec/Balls/actions/workflows/deploy.yml/runs?head_sha=${SHA_A}`, "api.github.com/repos/CronusAztec/Balls/actions/runs/101/jobs", `git fetch -q --depth 1 origin ${SHA_A}`, `git checkout -qf ${SHA_A}`, "npm ci --no-audit", "npm ci --prefix billing", "go-live-check.mjs --deploy-guard", "next build --no-lint", "postexport.mjs", "--prefix billing wrangler deploy", "/build.txt"].map((n) => index(r.calls, n));
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
    sb.setRuns(GREEN, SHA_A, "release");
    const r = sb.run([], { JBL_REPO: "me/site", JBL_BRANCH: "release", JBL_SITE_URL: "https://example.org" });
    expect(r.calls[0]).toBe("git ls-remote https://github.com/me/site.git refs/heads/release");
    expect(r.calls.find((c) => c.includes("api.github.com") && c.includes("/runs?"))).toMatch(/repos\/me\/site\/actions\/workflows\/deploy\.yml\/runs\?head_sha=a{40}&per_page=5&branch=release$/);
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

  it("with JBL_GITHUB_TOKEN (a private repository) signs ls-remote, fetch and the workflow-run lookup, and nothing else", () => {
    const sb = sandbox();
    const token = TOKEN;
    const r = sb.run([], { JBL_GITHUB_TOKEN: token });
    expect(r.status, r.stdout).toBe(0);
    const signed = r.auth.filter((l) => l.includes("auth=yes")).map((l) => l.split(" ")[0]);
    expect(signed).toEqual(["ls-remote", "fetch"]);
    expect(r.auth.filter((l) => l.startsWith("init ") || l.startsWith("checkout ") || l.startsWith("clean ")).every((l) => l.endsWith("auth="))).toBe(true);
    expect(r.stdin).toContain(`Authorization: Bearer ${token}`);
    // every lookup (the runs of the workflow, then its jobs) carries it on curl's stdin and nowhere else, and is bounded in time
    const lookups = r.calls.filter((c) => c.includes("api.github.com"));
    expect(lookups).toHaveLength(2);
    expect(r.stdin.match(/^Authorization: Bearer /gm)).toHaveLength(lookups.length);
    for (const c of lookups) expect(c, c).toContain("--max-time 30 ");
    expect(lookups.every((c) => / -H @- /.test(c))).toBe(true);
    // never in an argument list (any user of the server can read those), never in the output, never in the build
    expect(r.calls.join("\n")).not.toContain(token);
    expect(r.stdout).not.toContain(token);
    for (const needle of ["npm ci", "go-live-check.mjs", "next build", "postexport.mjs", "wrangler deploy"]) {
      expect(r.calls.find((c) => c.includes(needle)), needle).not.toMatch(/gh=set/);
    }
    expect(sb.file("last-ok")).toBe(SHA_A);
  });

  it("says a private repository needs the token when GitHub cannot be read without it, or the workflow runs cannot be seen", () => {
    const sb = sandbox();
    expect(sb.run([], { STUB_LSREMOTE: "fail" }).stdout).toContain("JBL_GITHUB_TOKEN is not set");
    const expired = sb.run([], { STUB_LSREMOTE: "fail", JBL_GITHUB_TOKEN: "github_pat_x".padEnd(40, "x") });
    expect(expired.stdout).not.toContain("JBL_GITHUB_TOKEN is not set");
    expect(expired.stdout).toContain("the token in JBL_GITHUB_TOKEN has expired"); // (the README tells the owner to look for these words)
    expect(sb.result().message).toContain("has expired");
    expect(sb.run([], { STUB_LSREMOTE: "fail" }).stdout).not.toContain("has expired");
    sb.setApi(`runs-${SHA_A}`, '{"message":"Not Found"}', 404);
    const blind = sb.run();
    expect(blind.stdout).toContain("a private repository needs JBL_GITHUB_TOKEN");
    expect(blind.stdout).not.toContain("Actions: Read-only"); // (no token: nothing to add a permission to)
  });
});

describe("jbl-deploy.sh: the build job of the site workflow is the gate (read through the Actions API)", () => {
  const touched = (calls: string[]) => calls.some((c) => c.includes("git fetch") || c.includes("wrangler"));
  const waits = (sb: Sandbox, r: ReturnType<Sandbox["run"]>, message: string | RegExp, label = "") => {
    expect(r.status, `${label} ${r.stdout}`).toBe(0);
    expect(touched(r.calls), label).toBe(false);
    expect(sb.result(), label).toMatchObject({ state: "waiting", sha: SHA_A });
    expect(sb.result().message, label).toMatch(message);
    expect(sb.file("last-failed"), label).toBeNull(); // (waiting is not failing: the next run asks again)
  };

  it("asks the Actions API for the runs of deploy.yml for that commit and then the jobs of each run, and for nothing else", () => {
    const sb = sandbox();
    const r = sb.run();
    expect(r.status, r.stdout).toBe(0);
    const asked = r.calls.filter((c) => c.includes("api.github.com")).map((c) => c.split(" ").pop());
    expect(asked).toEqual([RUNS_URL(SHA_A), JOBS_URL(101)]);
    expect(r.calls.join("\n")).not.toMatch(/check-runs|\/commits\/[0-9a-f]{40}/);
  });

  it("deploys a commit whose build job succeeded, whatever the smoke and deploy jobs of the same run did", () => {
    const sb = sandbox();
    sb.setRuns([run(101, SMOKE_RED, BUILD_OK, DEPLOY_RED)]);
    const r = sb.run();
    expect(r.status, r.stdout).toBe(0);
    expect(sb.file("last-ok")).toBe(SHA_A);
    expect(sb.result()).toMatchObject({ state: "ok", sha: SHA_A });
  });

  it("never deploys a commit whose build job is red, records it as failed, and does not try it again inside the window", () => {
    const sb = sandbox();
    sb.setRuns(RED);
    const r = sb.run();
    expect(r.status).toBe(0);
    expect(touched(r.calls)).toBe(false);
    expect(sb.result()).toMatchObject({ state: "skipped", sha: SHA_A, message: "checks are red" });
    expect(sb.file("last-failed")).toBe(SHA_A);
    expect(sb.run().calls).toHaveLength(1); // inside the retry window: only the ls-remote
    // a failed, cancelled or skipped build job is red alike; a green smoke job does not help
    for (const conclusion of ["failure", "cancelled", "skipped", "timed_out", null]) {
      const other = sandbox();
      other.setRuns([run(101, job("build", "completed", conclusion), SMOKE_OK)]);
      expect(other.run().status).toBe(0);
      expect(other.result(), String(conclusion)).toMatchObject({ state: "skipped" });
    }
  }, SLOW);

  it("waits, and tries again at the next run, while the build job is queued or running, or the push has not started a run", () => {
    const sb = sandbox();
    const cases: [string, Run[], RegExp][] = [
      ["in progress", PENDING, /pending.*has not finished/],
      ["queued", [run(101, BUILD_QUEUED)], /pending.*has not finished/],
      ["waiting for approval", [run(101, job("build", "waiting"))], /pending/],
      ["no run yet", NONE, /pending.*no run of the workflow for this commit yet/],
      ["a run whose jobs are not created yet", [run(101)], /pending.*no build job/],
    ];
    for (const [label, runs, message] of cases) {
      sb.setRuns(runs);
      const r = sb.run();
      waits(sb, r, message, label);
      expect(r.stdout, label).toContain("not finished yet");
    }
    sb.setRuns(GREEN);
    expect(sb.run().status).toBe(0);
    expect(sb.file("last-ok")).toBe(SHA_A);
  }, SLOW);

  it("waits, deploys nothing and records nothing when GitHub's answer is an error or cannot be read", () => {
    const sb = sandbox();
    const cases: [string, string, number][] = [
      ["garbage instead of JSON", "this is not json", 200],
      ["JSON without the list of runs", '{"message":"hello"}', 200],
      ["the list of runs is not a list", '{"workflow_runs":"x"}', 200],
      ["HTTP 500", '{"message":"Server Error"}', 500],
      ["HTTP 502 with a web page", "<html>Bad gateway</html>", 502],
      ["HTTP 429", '{"message":"rate limit"}', 429],
      ["no answer at all", "", 0],
    ];
    for (const [label, body, status] of cases) {
      sb.setApi(`runs-${SHA_A}`, body, status);
      const r = sb.run();
      waits(sb, r, /unknown/, label);
      expect(r.stdout, label).toContain("(unknown:");
    }
    // the same for the jobs of a run that was found (the run itself is green, but its jobs cannot be read)
    sb.setRuns(GREEN);
    const jobs: [string, string, number][] = [
      ["garbage instead of the jobs", "[1,2,3", 200],
      ["the jobs are not a list", '{"jobs":7}', 200],
      ["jobs HTTP 500", "{}", 500],
      ["no answer for the jobs", "", 0],
    ];
    for (const [label, body, status] of jobs) {
      sb.setApi("jobs-101", body, status);
      waits(sb, sb.run(), /unknown/, label);
    }
    expect(sb.file("last-ok")).toBeNull();
  }, SLOW);

  it("says what the HTTP status was when GitHub answers an error, and that nothing came back when it does not answer", () => {
    const sb = sandbox();
    sb.setApi(`runs-${SHA_A}`, "{}", 500);
    expect(sb.run().stdout).toContain("GitHub answered HTTP 500");
    sb.setApi(`runs-${SHA_A}`, "", 0);
    expect(sb.run().stdout).toContain("GitHub did not answer");
    sb.setApi(`runs-${SHA_A}`, "", "silent"); // (curl itself printed nothing, not even a status)
    const silent = sb.run();
    expect(silent.stdout).toContain("GitHub did not answer");
    expect(silent.stdout).not.toContain("no run of the workflow");
  });

  it("with a token, tells the owner to add Actions: Read-only when GitHub refuses the lookup (403 or 404), in the log and in --status", () => {
    const sentence = "the token cannot read GitHub Actions: add Actions: Read-only";
    for (const status of [403, 404]) {
      const sb = sandbox();
      sb.setApi(`runs-${SHA_A}`, '{"message":"Resource not accessible by personal access token"}', status);
      const r = sb.run([], { JBL_GITHUB_TOKEN: TOKEN });
      waits(sb, r, sentence);
      expect(r.stdout).toContain(sentence);
      expect(r.stdout).toContain(`HTTP ${status}`);
      expect(r.stdout).not.toContain("a private repository needs JBL_GITHUB_TOKEN"); // (it has one)
      expect(r.stdout).not.toContain(TOKEN);
      expect(JSON.parse(sb.run(["--status"]).stdout).message).toContain(sentence);
    }
    // the jobs lookup refused after the runs were listed: the same words
    const jobs = sandbox();
    jobs.setApi("jobs-101", '{"message":"Resource not accessible by personal access token"}', 403);
    waits(jobs, jobs.run([], { JBL_GITHUB_TOKEN: TOKEN }), sentence);
    // without a token the same refusal is "unknown", with the hint to set one
    const bare = sandbox();
    bare.setApi(`runs-${SHA_A}`, '{"message":"Not Found"}', 404);
    const r = bare.run();
    waits(bare, r, /unknown/);
    expect(r.stdout).toContain("a private repository needs JBL_GITHUB_TOKEN");
    expect(r.stdout).not.toContain("Actions: Read-only");
  }, SLOW);

  it("looks at every run of the commit: a green re-run after a red run deploys, and so does a green run beside a newer one still going", () => {
    for (const runs of [
      [run(102, BUILD_OK), run(101, BUILD_RED)], // red first, then the re-run that is green
      [run(102, BUILD_RED), run(101, BUILD_OK)], // (a green run anywhere counts)
      [run(102, BUILD_RUNNING), run(101, BUILD_OK, SMOKE_RED)], // a green run plus a newer pending one
      [run(103, BUILD_QUEUED), run(102, BUILD_RED), run(101, BUILD_OK)],
      [going(run(102), "queued"), run(101, BUILD_OK)], // a newer run queued, its jobs not created yet
    ]) {
      const sb = sandbox();
      sb.setRuns(runs);
      const r = sb.run();
      expect(r.status, r.stdout).toBe(0);
      expect(sb.file("last-ok"), JSON.stringify(runs)).toBe(SHA_A);
      expect(sb.file("last-failed")).toBeNull();
    }
  }, SLOW);

  it("with several runs and none green: red only when every build job is done, pending while one is still going", () => {
    const red = sandbox();
    red.setRuns([run(102, BUILD_RED), run(101, BUILD_RED)]);
    expect(red.run().status).toBe(0);
    expect(red.result()).toMatchObject({ state: "skipped" });
    expect(red.file("last-failed")).toBe(SHA_A);

    const pending = sandbox();
    pending.setRuns([run(102, BUILD_RUNNING), run(101, BUILD_RED)]); // (a newer run may still turn it green)
    waits(pending, pending.run(), /pending/);
    const older = sandbox();
    older.setRuns([run(102, BUILD_RED), run(101, BUILD_RUNNING)]); // (and an older one that is still going may too)
    waits(older, older.run(), /pending.*has not finished/);

    // a lookup that failed for one run does not hide a green one, but it does stop a red verdict
    const hidden = sandbox();
    hidden.setRuns([run(102, BUILD_OK), run(101, BUILD_RED)]);
    hidden.setApi("jobs-101", "{}", 500);
    expect(hidden.run().status).toBe(0);
    expect(hidden.file("last-ok")).toBe(SHA_A);
    const unsure = sandbox();
    unsure.setRuns([run(102, BUILD_RED), run(101, BUILD_RED)]);
    unsure.setApi("jobs-101", "{}", 500);
    waits(unsure, unsure.run(), /unknown/);
  }, SLOW);

  it("waits while a run of the commit is still going, even when its jobs show no running build job (or only the old failed one)", () => {
    const cases: [string, Run[]][] = [
      ["a new run queued, its jobs not created yet, beside an older red run", [going(run(102), "queued"), run(101, BUILD_RED)]],
      ["a re-run requested: the run is queued, its jobs still show the old failure", [going(run(101, BUILD_RED), "queued")]],
      ["a run in progress with no build job among its jobs yet", [going(run(102, SMOKE_OK)), run(101, BUILD_RED)]],
      ["a run waiting to be approved", [going(run(101, BUILD_RED), "waiting")]],
    ];
    for (const [label, runs] of cases) {
      const sb = sandbox();
      sb.setRuns(runs);
      const r = sb.run();
      waits(sb, r, /pending.*a run of the workflow for this commit is still going/, label);
      expect(r.stdout, label).toContain("not finished yet");
    }
    // once every run is done the red build is red again
    const done = sandbox();
    done.setRuns([run(102, SMOKE_OK), run(101, BUILD_RED)]);
    expect(done.run().status).toBe(0);
    expect(done.result()).toMatchObject({ state: "skipped" });
  }, SLOW);

  it("counts only the runs of the watched branch: a build job that is green for the same commit on another branch does not open the gate", () => {
    // (the commit went to a feature branch first, where the build job is green after the lint and the type check alone)
    const feature = (id: number) => onBranch(run(id, BUILD_OK), "claude/nice-davinci-sn70l7");
    const cases: [string, Run[], string | RegExp][] = [
      ["main's own run is still going", [run(102, BUILD_RUNNING), feature(101)], /pending.*has not finished/],
      ["main's own run is queued, no jobs yet", [going(run(102), "queued"), feature(101)], /pending.*still going/],
      ["main has no run yet", [feature(101)], /pending.*no run of the workflow for this commit yet/],
    ];
    for (const [label, runs, message] of cases) {
      const sb = sandbox();
      sb.setRuns(runs);
      const r = sb.run();
      waits(sb, r, message, label);
      expect(r.calls.some((c) => c.includes("/runs/101/jobs")), label).toBe(false); // (the other branch's jobs are not even looked at)
    }
    // main's own build failed: the feature branch's green does not rescue it
    const red = sandbox();
    red.setRuns([run(102, BUILD_RED), feature(101)]);
    expect(red.run().status).toBe(0);
    expect(red.result()).toMatchObject({ state: "skipped", sha: SHA_A });
    expect(red.file("last-failed")).toBe(SHA_A);
    // main's own green deploys, whatever the feature branch's run did
    const green = sandbox();
    green.setRuns([run(102, BUILD_OK), onBranch(run(101, BUILD_RED), "feature")]);
    expect(green.run().status).toBe(0);
    expect(green.file("last-ok")).toBe(SHA_A);
    // the branch is the deployer's own: JBL_BRANCH, not a fixed name
    const other = sandbox();
    other.setRuns([run(102, BUILD_OK)], SHA_A, "main");
    const r = other.run([], { JBL_BRANCH: "release" });
    waits(other, r, /pending.*no run of the workflow/);
    expect(r.calls.find((c) => c.includes("/runs?"))).toMatch(/&branch=release$/);
  }, SLOW);

  it("asks for the jobs of at most five runs of the commit, newest first", () => {
    const sb = sandbox();
    sb.setRuns([107, 106, 105, 104, 103, 102, 101].map((id) => run(id, BUILD_RED)));
    const r = sb.run();
    expect(r.status).toBe(0);
    expect(r.calls.filter((c) => c.includes("/jobs?")).map((c) => c.split(" ").pop())).toEqual([107, 106, 105, 104, 103].map(JOBS_URL));
    expect(sb.result()).toMatchObject({ state: "skipped" });
  });

  it("stops asking once a run is green", () => {
    const sb = sandbox();
    sb.setRuns([run(103, BUILD_OK), run(102, BUILD_RED), run(101, BUILD_RED)]);
    const r = sb.run();
    expect(r.calls.filter((c) => c.includes("/jobs?"))).toHaveLength(1);
    expect(sb.file("last-ok")).toBe(SHA_A);
  });

  it("opens the gate for a job named exactly build and for no other: not Windows build, build (x), Build, the smoke jobs, deploy", () => {
    // (all the look-alikes succeeded in one run: if any of them were taken for the build job, the verdict would be green)
    const names = ["Windows build", "build (x)", "Build", "BUILD", "build ", " build", "build-site", "smoke (shard 1 of 4)", "smoke-summary", "deploy", "Build and deploy the site"];
    const sb = sandbox();
    sb.setRuns([run(101, ...names.map((name) => job(name, "completed", "success")))]);
    const r = sb.run();
    waits(sb, r, /pending.*no build job/);
    expect(r.stdout).toContain("not finished yet");
    // another job succeeding does not rescue a red build, nor does a red other job make a green build red
    const mixed = sandbox();
    mixed.setRuns([run(101, job("Windows build", "completed", "success"), BUILD_RED)]);
    expect(mixed.run().status).toBe(0);
    expect(mixed.result()).toMatchObject({ state: "skipped" });
    const other = sandbox();
    other.setRuns([run(101, job("Windows build", "completed", "failure"), BUILD_OK, SMOKE_RED, DEPLOY_RED)]);
    expect(other.run().status).toBe(0);
    expect(other.file("last-ok")).toBe(SHA_A);
  }, SLOW);

  it("does not take a run of another commit for this one, even when GitHub lists it", () => {
    const sb = sandbox();
    sb.setRuns([{ ...run(101, BUILD_OK), head_sha: SHA_B }]);
    waits(sb, sb.run(), /pending.*no run of the workflow/);
  });

  it("can be told not to ask GitHub at all (JBL_REQUIRE_GREEN=0), even with a red build", () => {
    const sb = sandbox();
    sb.setRuns(RED);
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
    sb.setRuns(RED, SHA_B);
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

  it("--private asks for a read-only GitHub token, checks it against the repository, its commits and its workflow runs, and never prints it", () => {
    const install = read("install.sh");
    expect(install).toContain("--private) PRIVATE=1");
    expect(install).toContain("Contents: Read-only");
    expect(install).toContain("Actions: Read-only");
    expect(install).toContain("read-only: Contents + Actions");
    expect(install).toContain('"/actions/workflows/deploy.yml/runs?per_page=1"');
    expect(install).not.toContain("check-runs"); // (a fine-grained token has no Checks permission: that endpoint can never be read with one)
    expect(install).toContain("github_pat_[A-Za-z0-9_]{20,255}");
    expect(install).toContain('set_conf JBL_GITHUB_TOKEN "$gh_token"');
    expect(install).toContain('set_conf JBL_FEEDBACK_GITHUB_REPO ""');
    expect(install).toContain("-H @-"); // the token goes to curl on stdin, not on its command line
    expect(install).toContain('deploy only commits whose "build" job of the site workflow (deploy.yml) is green on GitHub'); // the hint in the settings file it writes
    for (const line of install.split("\n").filter((l) => /\$gh_token\b|\$\{gh_token\}/.test(l))) {
      expect(line, line).not.toMatch(/\b(echo|say|logger|tee)\b|>&2/);
      if (/curl/.test(line)) expect(line, line).not.toMatch(/Bearer \$gh_token[^\\]*"https/);
    }
  });

  it("prints its whole header as --help, with the permissions the token needs", () => {
    const r = spawnSync("bash", [path.join(DIR, "install.sh"), "--help"], { encoding: "utf8" });
    expect(r.status).toBe(0);
    expect(r.stdout.startsWith("# Installs the site deployer")).toBe(true);
    expect(r.stdout.trimEnd().endsWith("Remove it all with deploy/vps/uninstall.sh.")).toBe(true);
    expect(r.stdout).toContain("Contents: Read-only and Actions: Read-only");
    expect(r.stdout).toContain("JBL_REQUIRE_GREEN=0");
  });

  /**
   * The --private block of install.sh on its own (the installer as a whole needs root, apt and systemd), with the real set_conf, say, die and
   * clean_input, against a stand-in for GitHub's API that answers like a fine-grained token: the repository and its commits can be read, the
   * check-runs never, and the workflow runs only when the token has Actions: Read-only (actions: "ok") and not when it has not ("refused").
   */
  function privateCheck(opts: { conf?: string; env?: Record<string, string>; actions?: "ok" | "refused" } = {}) {
    const install = read("install.sh");
    const from = install.indexOf('if [ "$PRIVATE" = 1 ]; then');
    const to = install.indexOf("# ------------------------------------------------------------------ the operator's public details");
    expect(from).toBeGreaterThan(0);
    expect(to).toBeGreaterThan(from);
    const fn = (name: string) => install.match(new RegExp(`^${name}\\(\\) \\{(?:.*\\}$|[\\s\\S]*?^\\}$)`, "m"))?.[0] ?? "";
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-private-"));
    cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    const conf = path.join(dir, "env");
    const calls = path.join(dir, "calls.log");
    fs.writeFileSync(conf, opts.conf ?? "CLOUDFLARE_API_TOKEN='abc'\nJBL_BRANCH='main'\n# JBL_REQUIRE_GREEN=1            deploy only commits whose build job is green (0: deploy any)\n");
    for (const f of [calls, `${calls}.stdin`]) fs.writeFileSync(f, "");
    fs.writeFileSync(
      path.join(bin, "curl"),
      `#!/bin/sh
cat >> "${calls}.stdin"
printf 'curl %s\\n' "$*" >> "${calls}"
for url in "$@"; do :; done
case "$url" in
  */actions/workflows/deploy.yml/runs*) [ "$STUB_ACTIONS" = refused ] && exit 22; echo '{"total_count": 3, "workflow_runs": []}' ;;
  */commits/main) echo '{"sha": "${SHA_A}"}' ;;
  */repos/CronusAztec/Balls) echo '{"full_name": "CronusAztec/Balls"}' ;;
  *) exit 22 ;;
esac
`,
      { mode: 0o755 },
    );
    const script = ["set -euo pipefail", fn("say"), fn("die"), fn("set_conf"), fn("clean_input"), fn("gate_is_off"), "have_tty() { return 1; }", `CONF="${conf}"; REPO=CronusAztec/Balls; BRANCH=main; PRIVATE=1`, install.slice(from, to), "echo block-finished"].join("\n");
    const env: Record<string, string> = { PATH: `${bin}:${process.env.PATH}`, HOME: dir, JBL_GITHUB_TOKEN: TOKEN, STUB_ACTIONS: opts.actions ?? "ok", ...opts.env };
    const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: env as NodeJS.ProcessEnv });
    const lines = (f: string) => fs.readFileSync(f, "utf8").split("\n").filter(Boolean);
    return { status: r.status, out: `${r.stdout}${r.stderr}`, conf: fs.readFileSync(conf, "utf8"), confPath: conf, calls: lines(calls), stdin: fs.readFileSync(`${calls}.stdin`, "utf8") };
  }

  it("--private checks a token that has Actions: Read-only against the workflow runs, never against the checks, and saves it without printing it", () => {
    const r = privateCheck();
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("block-finished");
    expect(r.calls.map((c) => c.split(" ").pop())).toEqual([API, `${API}/commits/main`, `${API}/actions/workflows/deploy.yml/runs?per_page=1`]);
    expect(r.calls.join("\n")).not.toMatch(/check-runs|Checks/i);
    expect(r.stdin.match(/^Authorization: Bearer /gm)).toHaveLength(3); // (on curl's stdin each time)
    expect(r.calls.join("\n")).not.toContain(TOKEN);
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toMatch(/Checks: ?Read/i);
    expect(r.conf).toContain(`JBL_GITHUB_TOKEN='${TOKEN}'`);
    expect(r.conf).toContain("JBL_FEEDBACK_GITHUB_REPO=''");
    expect(r.conf).not.toMatch(/^JBL_REQUIRE_GREEN=/m); // (the commented hint is no setting: the gate stays on)
  });

  it("--private tells a token without the Actions permission what to do: add Actions: Read-only, do not look for Checks, or use JBL_REQUIRE_GREEN=0", () => {
    const r = privateCheck({ actions: "refused" });
    expect(r.status).toBe(1);
    expect(r.out).toContain('add "Actions: Read-only"');
    expect(r.out).toContain('GitHub\'s token form has no "Checks" permission, so do not look for one');
    expect(r.out).toContain("JBL_REQUIRE_GREEN=0");
    expect(r.out).not.toMatch(/Checks: ?Read/i);
    expect(r.out).not.toContain(TOKEN);
    expect(r.out).not.toContain("block-finished");
    expect(r.conf).not.toContain("JBL_GITHUB_TOKEN"); // (nothing is saved for a token that cannot do the job)
    expect(r.conf).not.toMatch(/^JBL_REQUIRE_GREEN=/m);
  });

  it("--private with JBL_REQUIRE_GREEN=0, in the environment of install.sh or already in the settings file, skips the Actions check and writes the setting", () => {
    const viaEnv = privateCheck({ actions: "refused", env: { JBL_REQUIRE_GREEN: "0" } });
    expect(viaEnv.status, viaEnv.out).toBe(0);
    expect(viaEnv.out).toContain("JBL_REQUIRE_GREEN=0: the Actions permission is not checked");
    expect(viaEnv.calls.map((c) => c.split(" ").pop())).toEqual([API, `${API}/commits/main`]); // (the repository and its newest commit are still read)
    expect(viaEnv.conf).toContain("JBL_REQUIRE_GREEN='0'");
    expect(viaEnv.conf).toContain(`JBL_GITHUB_TOKEN='${TOKEN}'`);
    // the settings file reads back as shell, and jbl-deploy.sh would then skip the gate
    const back = spawnSync("bash", ["-c", `. "${viaEnv.confPath}"; printf '%s' "$JBL_REQUIRE_GREEN"`], { encoding: "utf8" });
    expect(back.stdout).toBe("0");

    for (const line of ["JBL_REQUIRE_GREEN='0'", "JBL_REQUIRE_GREEN=0", 'JBL_REQUIRE_GREEN="0"']) {
      const viaConf = privateCheck({ actions: "refused", conf: `CLOUDFLARE_API_TOKEN='abc'\n${line}\n` });
      expect(viaConf.status, `${line}: ${viaConf.out}`).toBe(0);
      expect(viaConf.out, line).toContain("JBL_REQUIRE_GREEN=0: the Actions permission is not checked");
      expect(viaConf.calls.some((c) => c.includes("/actions/")), line).toBe(false);
      expect(viaConf.conf.match(/^JBL_REQUIRE_GREEN=.*$/gm), line).toEqual(["JBL_REQUIRE_GREEN='0'"]); // (one line, rewritten in the settings file's own form)
    }

    // not an escape: a commented line, another value, or an environment that says 1 (that one wins over the file)
    expect(privateCheck({ actions: "refused", conf: "# JBL_REQUIRE_GREEN=0 would skip the check\n" }).status).toBe(1);
    expect(privateCheck({ actions: "refused", conf: "JBL_REQUIRE_GREEN='1'\n" }).status).toBe(1);
    expect(privateCheck({ actions: "refused", conf: "JBL_REQUIRE_GREEN='0'\n", env: { JBL_REQUIRE_GREEN: "1" } }).status).toBe(1);
    // and with the permission, JBL_REQUIRE_GREEN=1 in the environment keeps the check
    const asked = privateCheck({ env: { JBL_REQUIRE_GREEN: "1" } });
    expect(asked.status, asked.out).toBe(0);
    expect(asked.calls.some((c) => c.includes("/actions/"))).toBe(true);
  });

  it("closes by saying what the gate is: GitHub's build job when it is on, no waiting for GitHub when JBL_REQUIRE_GREEN=0 is in the settings", () => {
    const install = read("install.sh");
    const fn = install.match(/^gate_is_off\(\) \{.*\}$/m)?.[0];
    const from = install.indexOf("if gate_is_off; then\n  gate=");
    expect(fn).toBeTruthy();
    expect(from).toBeGreaterThan(0);
    expect(install).not.toContain("GitHub's checks for it are green");
    const closing = (line: string) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jbl-banner-"));
      cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
      const conf = path.join(dir, "env");
      fs.writeFileSync(conf, `CLOUDFLARE_API_TOKEN='abc'\n${line}\n`);
      const r = spawnSync("bash", ["-c", `set -euo pipefail\n${fn}\nCONF="$1"; BRANCH=main; REPO=CronusAztec/Balls; USER_NAME=jbldeploy; BIN_DIR=/opt/jbl-deploy; EVERY=10\n${install.slice(from)}`, "_", conf], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout;
    };
    for (const line of ["JBL_REQUIRE_GREEN='0'", "JBL_REQUIRE_GREEN=0", 'JBL_REQUIRE_GREEN="0"']) {
      const out = closing(line);
      expect(out, line).toContain("deploys what lands there (every new commit, WITHOUT waiting for GitHub: JBL_REQUIRE_GREEN=0 in ");
      expect(out, line).not.toContain("is green");
    }
    for (const line of ["# JBL_REQUIRE_GREEN=1            deploy only commits whose build job is green (0: deploy any)", "JBL_REQUIRE_GREEN='1'", ""]) {
      const out = closing(line);
      expect(out, line).toContain("deploys what lands there (when the build job of the site workflow on GitHub is green).");
      expect(out, line).not.toContain("WITHOUT");
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

describe("the docs and the installer never tell the owner to give the token a Checks permission", () => {
  const ROOT = path.join(__dirname, "..");
  const textFiles = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "node_modules" ? [] : textFiles(p);
      return /\.(md|sh|txt|ya?ml)$/i.test(e.name) ? [p] : [];
    });
  // GitHub's fine-grained tokens have no Checks permission at all (and no endpoint of the check runs): anything that names it as something to grant is wrong
  const GRANTS = [
    /Checks: ?(Read|Write)/i,
    /Checks[ -]?(permission|read-only)/i,
    /(Contents|Metadata|Actions)(,| and| \+| &)\s+Checks\b/,
    /\bChecks\s*(\+|and)\s*(Contents|Actions)\b/,
    /\b[Aa]dd(ing)?\s+\\?"?Checks\b/,
    /\bChecks\s+(scope|\(read)/,
  ];
  // ... except a line that says there is none: "GitHub's token form has no Checks permission" (so nobody goes looking for it)
  const SAYS_NONE = /\bno\s+\\?"?Checks\b/i;
  const asksForChecks = (line: string) => GRANTS.some((re) => re.test(line)) && !SAYS_NONE.test(line);

  it("recognises the wording it forbids, and lets the sentence that explains why there is no such permission through", () => {
    for (const bad of [
      "Permissions → Repository: **Contents: Read-only** and **Checks: Read-only**",
      "the token cannot read the checks (add Checks: Read-only), or run with JBL_REQUIRE_GREEN=0",
      "GitHub token for $REPO (read-only: Contents + Checks; nothing is shown)",
      "with Contents and Checks read-only",
      "Without the Checks permission set `JBL_REQUIRE_GREEN=0` in the settings file",
      "read-only (Contents: Read, Checks: Read).",
      "the token needs the Checks scope",
      "add Checks (read) to the token",
      "there is no need to ask twice: add Checks: Read-only",
      'add \\"Checks\\" to it',
    ]) expect(asksForChecks(bad), bad).toBe(true);
    for (const fine of [
      "GitHub's token form has no Checks permission at all, so do not look for one",
      'GitHub\'s token form has no \\"Checks\\" permission, so do not look for one',
      "# (GitHub's token form has no Checks permission; the deployer reads the \"build\" job",
      "Permissions: Contents: Read-only and Actions: Read-only",
      "the checks are red; Checksums are published",
    ]) expect(asksForChecks(fine), fine).toBe(false);
  });

  it("holds for everything under deploy/ and docs/ and for the main README", () => {
    const files = [...textFiles(path.join(ROOT, "deploy")), ...textFiles(path.join(ROOT, "docs")), path.join(ROOT, "README.md")];
    expect(files.length).toBeGreaterThan(8);
    const hits = files.flatMap((f) =>
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .map((line, n) => ({ at: `${path.relative(ROOT, f)}:${n + 1}`, line }))
        .filter(({ line }) => asksForChecks(line))
        .map(({ at, line }) => `${at}: ${line.trim()}`),
    );
    expect(hits).toEqual([]);
  });

  it("says once where the owner reads the token's permissions, that GitHub has no Checks permission and that Actions is the one", () => {
    const readme = fs.readFileSync(path.join(DIR, "README.md"), "utf8");
    expect(readme).toContain("**Contents: Read-only** and **Actions: Read-only**");
    expect(readme).toMatch(/GitHub's token form has no Checks permission/);
    expect(readme).toContain("install.sh --reconfigure --private"); // (a new Cloudflare token rewrites the settings file and drops the GitHub token)
    expect(fs.readFileSync(path.join(ROOT, "docs", "RELEASING.md"), "utf8")).toContain("Contents and Actions read-only");
    expect(fs.readFileSync(path.join(DIR, "jbl-deploy.sh"), "utf8")).toContain("(Contents: Read, Actions: Read)");
    expect(fs.readFileSync(path.join(DIR, "install.sh"), "utf8")).toContain("permissions Contents: Read-only and Actions: Read-only");
  });
});
