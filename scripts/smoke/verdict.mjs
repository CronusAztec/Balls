/**
 * --- smoke-sharding --- The verdict of a sharded smoke run: the "Every shard passed" step of deploy.yml's smoke-summary job,
 *
 *   RESULT=<needs.smoke.result> SUMMARY=<steps.summary.outcome> SHARD_TIMEOUT_MINUTES=<the shards' timeout-minutes> \
 *     GH_TOKEN=… BRANCH=<github.ref_name> node scripts/smoke/verdict.mjs
 *
 * prints its verdict (a ::notice or an ::error workflow command when there is something to say) and exits 0 – every shard
 * passed with every block of the suite in exactly one of them, or there is nothing to deploy and nothing went wrong – or 1.
 *
 * GitHub ends a shard that hits its `timeout-minutes` with the conclusion `cancelled`, exactly like a shard that a newer push
 * cancelled through the concurrency group, so a `cancelled` result is looked up in this run's jobs (`gh api`): a shard that ran
 * out of time – the "exceeded the maximum execution time" annotation on its check run, or a run time within a minute of its
 * limit – fails the verdict like a shard that failed, newer run or not. Only when every cancelled shard stopped short of its
 * limit and a newer run of this workflow on the branch exists is the run superseded (a notice: it deploys nothing and the newer
 * run deploys). A lookup that fails fails the verdict: a cancelled shard that cannot be told from a timed-out one is no pass.
 */
import { execFile } from "child_process";
import { pathToFileURL } from "url";

/** The name of every shard job of the matrix starts with this (`name: smoke (shard ${{ matrix.shard }} of 4)`). */
export const SHARD_JOB_PREFIX = "smoke (shard ";
/** GitHub's annotation on a job that ran out of time ("The job has exceeded the maximum execution time of 45m0s"). */
export const TIMEOUT_ANNOTATION = /exceeded the maximum execution time/i;
/** A cancelled shard that ran to within this many seconds of its limit ran out of time, whatever ended it. */
export const TIMEOUT_MARGIN_SECONDS = 60;
/** The workflow whose newer runs supersede this one when GITHUB_WORKFLOW_REF does not say. */
export const DEFAULT_WORKFLOW = "deploy.yml";

/**
 * @typedef {{ id?: number, name?: string, status?: string, conclusion?: string | null, started_at?: string | null, completed_at?: string | null }} WorkflowJob
 *   a job of the REST API's "list jobs for a workflow run"
 * @typedef {{ pass: boolean, level: "info" | "notice" | "error", message: string }} Verdict
 * @typedef {object} VerdictInput
 * @property {string | undefined} result needs.smoke.result: success, failure, cancelled or skipped
 * @property {string | undefined} summary the outcome of the "Slowest blocks of all shards" step (every block in exactly one shard)
 * @property {number} timeoutMinutes the shard jobs' timeout-minutes
 * @property {string} repo owner/name (GITHUB_REPOSITORY)
 * @property {string | number} runId this run (GITHUB_RUN_ID)
 * @property {string} branch the branch whose newer runs supersede this one (github.ref_name)
 * @property {string} [workflow] the workflow file (deploy.yml)
 * @property {(path: string) => Promise<any>} api a GET of a REST API path → its JSON; throws when the request fails
 */

/** @param {"info" | "notice"} level @param {string} message @returns {Verdict} */
const pass = (level, message) => ({ pass: true, level, message });
/** @param {string} message @returns {Verdict} */
const fail = (message) => ({ pass: false, level: "error", message });
/** The first line of an error, for a message. @param {unknown} e */
const firstLine = (e) => String(e instanceof Error ? e.message : e).trim().split("\n")[0];
/** Minutes with one decimal. @param {number} seconds */
const minutes = (seconds) => (seconds / 60).toFixed(1);

/**
 * A workflow command's message escaped as the runner reads it back (`%`, CR and LF), so text from the API or from `gh` – a
 * URL-encoded branch in an error, say – shows as it is.
 * @param {string} message
 * @returns {string}
 */
export function commandData(message) {
  return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * Seconds from a job's start to its end (NaN when either time is missing or unreadable).
 * @param {WorkflowJob | null | undefined} job
 * @returns {number}
 */
export function jobSeconds(job) {
  return (Date.parse(job?.completed_at ?? "") - Date.parse(job?.started_at ?? "")) / 1000;
}

/**
 * Why a cancelled shard counts as having run out of time, or null when it stopped short of its limit: GitHub's timeout
 * annotation on its check run, else a run time within TIMEOUT_MARGIN_SECONDS of `timeoutMinutes` (a job-level timeout cannot
 * come sooner, and a shard still running that close to its limit – the suite's part takes some 12 minutes – hung anyway).
 * @param {WorkflowJob} job
 * @param {string[] | null} annotations the messages of its check run's annotations (null: they could not be read)
 * @param {number} timeoutMinutes
 * @returns {string | null}
 */
export function timeoutEvidence(job, annotations, timeoutMinutes) {
  const note = annotations?.find((message) => TIMEOUT_ANNOTATION.test(message));
  if (note) return `"${note.trim()}"`;
  const seconds = jobSeconds(job);
  if (Number.isFinite(seconds) && seconds >= timeoutMinutes * 60 - TIMEOUT_MARGIN_SECONDS) return `it ran ${minutes(seconds)} of its ${timeoutMinutes} minutes`;
  return null;
}

/**
 * The workflow file of a GITHUB_WORKFLOW_REF ("owner/repo/.github/workflows/deploy.yml@refs/heads/main" → "deploy.yml");
 * DEFAULT_WORKFLOW when it says none.
 * @param {string | undefined} ref
 * @returns {string}
 */
export function workflowFile(ref) {
  return /\.github\/workflows\/([^/@]+)@/.exec(ref ?? "")?.[1] ?? DEFAULT_WORKFLOW;
}

/**
 * The verdict on a run's smoke shards. It reads the API only for a `cancelled` result: the shard jobs of this run, the
 * annotations of the cancelled ones and – when none of them ran out of time – the newest run of the workflow on the branch.
 * @param {VerdictInput} input
 * @returns {Promise<Verdict>}
 */
export async function smokeVerdict(input) {
  switch (input.result) {
    case "success":
      return input.summary === "success"
        ? pass("info", "Every smoke shard passed, every block of the suite in exactly one of them.")
        : fail("every shard passed, but not every block of the suite ran in exactly one of them (see 'Slowest blocks of all shards')");
    case "skipped":
      return pass("notice", "the smoke shards did not run (the build did not finish); nothing is deployed");
    case "cancelled":
      return cancelledVerdict(input);
    default:
      return fail(`a smoke shard ended with '${input.result ?? ""}' – see the failing 'smoke (shard x of 4)' job`);
  }
}

/**
 * A `cancelled` result: a timeout (a failure), a newer push (a notice) or neither (a failure).
 * @param {VerdictInput} input
 * @returns {Promise<Verdict>}
 */
async function cancelledVerdict({ repo, runId, branch, workflow = DEFAULT_WORKFLOW, timeoutMinutes, api }) {
  /** @type {WorkflowJob[]} */
  let shards;
  try {
    const data = await api(`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
    if (!Array.isArray(data?.jobs)) throw new Error("the answer has no list of jobs");
    shards = data.jobs.filter((/** @type {WorkflowJob} */ job) => typeof job?.name === "string" && job.name.startsWith(SHARD_JOB_PREFIX));
  } catch (e) {
    return fail(`a smoke shard was cancelled, and this run's jobs could not be read to tell a shard that ran out of time from one a newer push cancelled (${firstLine(e)})`);
  }
  const broken = shards.filter((job) => !["success", "cancelled", "skipped"].includes(job.conclusion ?? ""));
  if (broken.length) return fail(`${broken.map((job) => `${job.name} ended with '${job.conclusion ?? job.status}'`).join(", ")} – see ${broken.length === 1 ? "that job" : "those jobs"}`);
  const cancelled = shards.filter((job) => job.conclusion === "cancelled");
  if (!cancelled.length) return fail(`the smoke shards ended 'cancelled', but none of this run's ${shards.length} shard jobs is cancelled – see the 'smoke (shard x of 4)' jobs`);

  const timedOut = [];
  for (const job of cancelled) {
    /** @type {string[] | null} */
    let annotations = null;
    try {
      const list = await api(`repos/${repo}/check-runs/${job.id}/annotations?per_page=100`);
      if (Array.isArray(list)) annotations = list.map((a) => String(a?.message ?? ""));
    } catch {
      // unreadable: the run time alone decides
    }
    const evidence = timeoutEvidence(job, annotations, timeoutMinutes);
    if (evidence) timedOut.push(`${job.name} ran out of time (${evidence})`);
  }
  if (timedOut.length) return fail(`${timedOut.join("; ")} – a shard that times out fails the smoke test, even when a newer run supersedes this one`);

  let newest = null;
  try {
    const data = await api(`repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
    newest = data?.workflow_runs?.[0]?.id ?? null;
  } catch (e) {
    return fail(`a smoke shard was cancelled before its time limit, and the newest run of ${workflow} on ${branch} could not be read to tell whether a newer push supersedes this one (${firstLine(e)}) – see the 'smoke (shard x of 4)' jobs`);
  }
  if (newest !== null && Number(newest) > Number(runId)) {
    return pass("notice", `the smoke shards were cancelled before their time limit: run ${newest}, a newer push, supersedes this run; nothing is deployed`);
  }
  return fail(`a smoke shard was cancelled before its time limit, but no newer run of ${workflow} on ${branch} supersedes this one – see the 'smoke (shard x of 4)' jobs`);
}

/**
 * A GET of the GitHub REST API with the GitHub CLI (`gh api <path>`, authenticated by GH_TOKEN) → the parsed JSON.
 * @param {string} path
 * @returns {Promise<any>}
 */
export function ghApi(path) {
  return new Promise((resolve, reject) => {
    execFile("gh", ["api", path], { encoding: "utf8", maxBuffer: 16 << 20, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`gh api ${path}: ${firstLine(stderr || error)}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error(`gh api ${path}: ${firstLine(e)}`));
      }
    });
  });
}

/**
 * The step: the verdict from the environment, printed (`::notice` / `::error` with the title "Smoke test" when it says
 * something) → the exit code.
 * @param {Record<string, string | undefined>} [env]
 * @param {(path: string) => Promise<any>} [api]
 * @param {(line: string) => void} [log]
 * @returns {Promise<number>}
 */
export async function main(env = process.env, api = ghApi, log = (line) => console.log(line)) {
  const timeoutMinutes = Number(env.SHARD_TIMEOUT_MINUTES);
  if (!env.SHARD_TIMEOUT_MINUTES || !(timeoutMinutes > 0)) {
    log(`::error title=Smoke test::${commandData(`SHARD_TIMEOUT_MINUTES must be the smoke shards' timeout-minutes, got '${env.SHARD_TIMEOUT_MINUTES ?? ""}'`)}`);
    return 1;
  }
  const verdict = await smokeVerdict({
    result: env.RESULT,
    summary: env.SUMMARY,
    timeoutMinutes,
    repo: env.GITHUB_REPOSITORY ?? "",
    runId: env.GITHUB_RUN_ID ?? "",
    branch: env.BRANCH || env.GITHUB_REF_NAME || "",
    workflow: workflowFile(env.GITHUB_WORKFLOW_REF),
    api,
  });
  log(verdict.level === "info" ? verdict.message : `::${verdict.level} title=Smoke test::${commandData(verdict.message)}`);
  return verdict.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
