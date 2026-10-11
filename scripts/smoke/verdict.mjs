/**
 * --- smoke-sharding --- The verdict on a sharded smoke run: the "Every shard passed" step of deploy.yml's smoke-summary job,
 *
 *   RESULT=<needs.smoke.result> SUMMARY=<steps.summary.outcome> SHARD_TIMEOUT_MINUTES=<the shards' timeout-minutes> \
 *     GH_TOKEN=<token> BRANCH=<github.ref_name> node scripts/smoke/verdict.mjs
 *
 * (GITHUB_REPOSITORY, GITHUB_RUN_ID and GITHUB_WORKFLOW_REF come from the runner) prints the verdict – a ::notice or an ::error
 * workflow command when there is something to say – and exits 0 (the deploy may go ahead, or there is nothing to deploy and
 * nothing went wrong) or 1.
 *
 * GitHub ends a job that hits its `timeout-minutes` with the conclusion `cancelled`, the same conclusion as a shard that a newer
 * push cancels through its concurrency group (run 183's smoke job ran 45 minutes into its limit and ended `cancelled`; run 174's
 * was cancelled by run 175 after 19), so `needs.smoke.result == 'cancelled'` cannot tell a hung shard from a superseded run.
 * A cancelled result is looked up in this run's jobs (`gh api`): a cancelled shard that carries GitHub's "exceeded the maximum
 * execution time" annotation, or that ran to within a minute of its limit, ran out of time and fails the verdict like a failed
 * shard, newer run or not. Only when every cancelled shard stopped short of its limit and a newer run of the workflow on the
 * branch exists is the run superseded: a notice, nothing deployed (the newer run deploys), not a failure. A lookup that fails
 * fails the verdict: a cancelled shard that cannot be told from a timed-out one is no pass.
 *
 * Run by hand (with a gh login) it judges any past run the same way: GITHUB_REPOSITORY=owner/repo GITHUB_RUN_ID=<id>
 * BRANCH=<branch> RESULT=cancelled SUMMARY=success SHARD_TIMEOUT_MINUTES=45 node scripts/smoke/verdict.mjs
 */
import { execFile } from "child_process";
import { pathToFileURL } from "url";

/** A smoke shard job of the run: `smoke (shard 3 of 4)` (the matrix's name), or `smoke` – the single job before the shards. */
export const SHARD_JOB = /^smoke(?: \(shard \d+ of \d+\))?$/;
/** GitHub's annotation on a job that hit its timeout-minutes ("The job has exceeded the maximum execution time of 45m0s"). */
export const TIMEOUT_ANNOTATION = /exceeded the maximum execution time/i;
/** A cancelled shard that ran to within this many seconds of its timeout-minutes ran out of time (44 of 45 minutes). */
export const TIMEOUT_MARGIN_SECONDS = 60;
/** The workflow a newer run must be of to supersede this one when GITHUB_WORKFLOW_REF does not name it. */
export const DEFAULT_WORKFLOW = "deploy.yml";

/**
 * @typedef {{ id?: number, name?: string, status?: string, conclusion?: string | null, started_at?: string | null, completed_at?: string | null }} Job
 *   a job as GitHub's "list jobs for a workflow run" returns it
 * @typedef {{ pass: boolean, level: "info" | "notice" | "error", message: string }} Verdict
 * @typedef {(path: string) => Promise<any>} Api a GET of a REST API path → its JSON; it throws when the request fails
 * @typedef {object} VerdictInput
 * @property {string | undefined} result needs.smoke.result: success, failure, cancelled or skipped
 * @property {string | undefined} summary the outcome of the "Slowest blocks of all shards" step (every block in exactly one shard)
 * @property {number} timeoutMinutes the shard jobs' timeout-minutes
 * @property {string} repo owner/name (GITHUB_REPOSITORY)
 * @property {string | number} runId this run (GITHUB_RUN_ID)
 * @property {string} branch the branch a newer run must be on to supersede this one (github.ref_name)
 * @property {string} [workflow] the workflow file a newer run must be of (deploy.yml)
 * @property {Api} api
 */

/** @param {string} message @returns {Verdict} */
const failure = (message) => ({ pass: false, level: "error", message });
/** The first line of an error's message. @param {unknown} error */
const firstLine = (error) => String(error instanceof Error ? error.message : error).trim().split("\n")[0];

/**
 * Seconds from a job's start to its end (NaN while either is missing).
 * @param {Job} job
 * @returns {number}
 */
export function jobSeconds(job) {
  return (Date.parse(job.completed_at ?? "") - Date.parse(job.started_at ?? "")) / 1000;
}

/**
 * Why a cancelled shard counts as having run out of time, or null when it stopped short of its limit: GitHub's timeout
 * annotation on it, else a run time within TIMEOUT_MARGIN_SECONDS of its limit (a job-level timeout cannot strike sooner, and a
 * shard's part of the suite takes some 12 minutes: one still running that close to its limit had hung, whatever ended it).
 * @param {Job} job
 * @param {string[] | null} annotations the messages of the job's check-run annotations (null: they could not be read)
 * @param {number} timeoutMinutes
 * @returns {string | null}
 */
export function timeoutEvidence(job, annotations, timeoutMinutes) {
  const note = annotations?.find((message) => TIMEOUT_ANNOTATION.test(message));
  if (note) return `"${note.trim()}"`;
  const seconds = jobSeconds(job);
  return seconds >= timeoutMinutes * 60 - TIMEOUT_MARGIN_SECONDS ? `it ran ${(seconds / 60).toFixed(1)} of its ${timeoutMinutes} minutes` : null;
}

/**
 * The workflow file of a GITHUB_WORKFLOW_REF ("owner/repo/.github/workflows/deploy.yml@refs/heads/main" → "deploy.yml");
 * DEFAULT_WORKFLOW when it names none.
 * @param {string | undefined} ref
 * @returns {string}
 */
export function workflowFile(ref) {
  return /\.github\/workflows\/([^/@]+)@/.exec(ref ?? "")?.[1] ?? DEFAULT_WORKFLOW;
}

/**
 * A workflow command's message escaped the way the runner reads it back (`%`, CR, LF), so text from the API or from gh – a
 * URL-encoded branch in an error, say – shows as it is.
 * @param {string} message
 * @returns {string}
 */
export function commandData(message) {
  return message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

/**
 * The verdict on a run's smoke shards. Only a `cancelled` result asks the API: this run's jobs, the cancelled shards'
 * annotations and – when none of them ran out of time – the newest run of the workflow on the branch.
 * @param {VerdictInput} input
 * @returns {Promise<Verdict>}
 */
export async function smokeVerdict(input) {
  switch (input.result) {
    case "success":
      return input.summary === "success"
        ? { pass: true, level: "info", message: "All the smoke shards passed, every block of the suite in exactly one of them." }
        : failure("every shard passed, but not every block of the suite ran in exactly one of them (see 'Slowest blocks of all shards')");
    case "skipped":
      return { pass: true, level: "notice", message: "the smoke shards did not run (the build did not finish); nothing is deployed" };
    case "cancelled":
      return cancelledVerdict(input);
    default:
      return failure(`a smoke shard ended with '${input.result ?? ""}' – see the failing 'smoke (shard x of 4)' job`);
  }
}

/**
 * A `cancelled` result: a shard that ran out of time (a failure), a newer run (a notice) or neither (a failure).
 * @param {VerdictInput} input
 * @returns {Promise<Verdict>}
 */
async function cancelledVerdict({ result, repo, runId, branch, workflow = DEFAULT_WORKFLOW, timeoutMinutes, api }) {
  /** @type {Job[]} */
  let shards;
  try {
    const data = await api(`repos/${repo}/actions/runs/${runId}/jobs?filter=latest&per_page=100`);
    if (!Array.isArray(data?.jobs)) throw new Error("the answer lists no jobs");
    shards = data.jobs.filter((/** @type {Job} */ job) => SHARD_JOB.test(String(job?.name ?? "")));
  } catch (error) {
    return failure(`a smoke shard was cancelled, and this run's jobs could not be read to tell a shard that ran out of time from one a newer push cancelled (${firstLine(error)})`);
  }
  const broken = shards.filter((job) => !["success", "cancelled", "skipped"].includes(job.conclusion ?? ""));
  if (broken.length) return failure(`${broken.map((job) => `${job.name} ended with '${job.conclusion ?? job.status}'`).join(", ")} – see ${broken.length === 1 ? "that job" : "those jobs"}`);
  const cancelled = shards.filter((job) => job.conclusion === "cancelled");
  if (!cancelled.length) return failure(`the smoke shards ended '${result}', but none of this run's ${shards.length} shard jobs is cancelled – see the 'smoke (shard x of 4)' jobs`);

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
  if (timedOut.length) return failure(`${timedOut.join("; ")} – a shard that times out fails the smoke test, even when a newer run supersedes this one`);

  let newest;
  try {
    const data = await api(`repos/${repo}/actions/workflows/${encodeURIComponent(workflow)}/runs?branch=${encodeURIComponent(branch)}&per_page=1`);
    if (!Array.isArray(data?.workflow_runs)) throw new Error("the answer lists no runs");
    newest = data.workflow_runs[0]?.id;
  } catch (error) {
    return failure(`a smoke shard was cancelled before its time limit, and the newest run of ${workflow} on ${branch} could not be read to tell whether a newer push supersedes this run (${firstLine(error)})`);
  }
  if (Number(newest) > Number(runId)) return { pass: true, level: "notice", message: `the smoke shards were cancelled before their time limit: run ${newest}, a newer push, supersedes this run; nothing is deployed` };
  return failure(`a smoke shard was cancelled before its time limit, but no newer run of ${workflow} on ${branch} supersedes this run – see the 'smoke (shard x of 4)' jobs`);
}

/**
 * A GET of the GitHub REST API through the GitHub CLI (`gh api <path>`, signed in by GH_TOKEN) → the parsed JSON.
 * @type {Api}
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
 * The step: the verdict on the run the environment describes, printed (a ::notice or ::error titled "Smoke test" when it says
 * something) → the exit code.
 * @param {Record<string, string | undefined>} [env]
 * @param {Api} [api]
 * @param {(line: string) => void} [log]
 * @returns {Promise<number>}
 */
export async function main(env = process.env, api = ghApi, log = (line) => console.log(line)) {
  const timeoutMinutes = Number(env.SHARD_TIMEOUT_MINUTES);
  const verdict =
    env.SHARD_TIMEOUT_MINUTES && timeoutMinutes > 0
      ? await smokeVerdict({
          result: env.RESULT,
          summary: env.SUMMARY,
          timeoutMinutes,
          repo: env.GITHUB_REPOSITORY ?? "",
          runId: env.GITHUB_RUN_ID ?? "",
          branch: env.BRANCH || env.GITHUB_REF_NAME || "",
          workflow: workflowFile(env.GITHUB_WORKFLOW_REF),
          api,
        })
      : failure(`SHARD_TIMEOUT_MINUTES must be the smoke shards' timeout-minutes, got '${env.SHARD_TIMEOUT_MINUTES ?? ""}'`);
  log(verdict.level === "info" ? verdict.message : `::${verdict.level} title=Smoke test::${commandData(verdict.message)}`);
  return verdict.pass ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
