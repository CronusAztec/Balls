#!/usr/bin/env bash
# jbl-deploy (feature vps-site-deployer): puts the website on Cloudflare from the VPS, by itself, whenever the watched branch moves.
#
# A systemd timer (install.sh) runs this every ten minutes. It only ever CALLS OUT – to GitHub (git, the Actions API) and to
# Cloudflare (Wrangler) – and listens on no port, so nobody can reach in through it. One run:
#   1. asks GitHub which commit the branch is at (git ls-remote); stops when that commit is the one already deployed,
#   2. (JBL_REQUIRE_GREEN=1) waits until the repository's own check – the "build" job of the workflow "Build and deploy the site": lint,
#      type check, unit tests and the production build – is green for that commit on the watched branch, and never deploys a red one. The
#      job is read through the Actions API (the workflow's runs for the commit, then their jobs), because a fine-grained token has no
#      "Checks" permission at all but can have "Actions: Read-only"; only a job named exactly "build" of deploy.yml counts (section 2 below),
#   3. fetches exactly that commit, installs, runs the production guard (the live billing keys, never the test ones), builds the static
#      site for the domain's root, stamps it with the commit (out/build.txt) and runs `wrangler deploy`,
#   4. asks the live site for /build.txt until it names the commit, and only then calls it deployed.
# A commit that failed is not tried again for six hours (a new commit is tried at once). Everything is in `journalctl -u jbl-deploy`.
#
# Settings come from /etc/jbl-deploy/env (written by install.sh, readable by the service only):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   required: the token needs "Edit Cloudflare Workers" and the zone's DNS edit
#   JBL_GITHUB_TOKEN   only for a PRIVATE repository: a fine-grained token for that one repository, read-only (Contents: Read, Actions: Read).
#                      It is used for `git ls-remote`, `git fetch` and the workflow-run lookup, and for nothing else. Each token reaches only
#                      the step that needs it: the build (npm, Next.js, the repository's own scripts) sees neither it nor the Cloudflare token.
#   JBL_REPO (CronusAztec/Balls)   JBL_BRANCH (main)   JBL_SITE_URL (https://jumpingballslive.com)
#   JBL_REQUIRE_GREEN (1: wait for the build job described above; 0: deploy every new commit, for a token that has no Actions permission)
#   JBL_FEEDBACK_GITHUB_REPO (empty: the feedback form opens no GitHub issues; set it to OWNER/NAME only while that
#                      repository is public with Issues on)
#   JBL_SUPPORT_EMAIL, JBL_FEEDBACK_EMAIL, JBL_LEGAL_NAME, JBL_LEGAL_ADDRESS   the operator's public details the legal pages and the
#                      feedback form show (without a support e-mail the site has no way to be reached: scripts/go-live-check.mjs warns)
#   JBL_LEGAL_VAT_ID, JBL_LEGAL_REGISTRATION, JBL_LEGAL_COUNTRY   the VAT number, the register entry and the country (the terms' governing
#                      law), shown when set
#   JBL_FEEDBACK_ENDPOINT, JBL_ANALYTICS_SCRIPT_URL, JBL_ANALYTICS_SITE_ID, JBL_YOUTUBE_CLIENT_ID, JBL_DOWNLOADS_URL   optional public build
#                      settings, passed on as NEXT_PUBLIC_* exactly like the GitHub Actions deploy does (empty: off / the built-in default)
#   JBL_RELAY_URL (https://relay.jumpingballslive.com)   JBL_STATE_DIR (/var/lib/jbl-deploy)   JBL_GIT_URL (https://github.com/<repo>.git)
#   JBL_RETRY_SECONDS (21600)
# `jbl-deploy.sh --status` prints the last result; `jbl-deploy.sh --sha <40 hex>` deploys that commit now (a rollback): a person naming
# a commit on the server decides, so neither the branch nor GitHub's checks are asked.
set -Eeuo pipefail # (-E: the failure handler below also runs for a command that fails inside a function)

CONF="${JBL_DEPLOY_CONF:-/etc/jbl-deploy/env}"
if [ -r "$CONF" ]; then
  # (not exported: a setting reaches a child process only where it is passed on purpose, below)
  # shellcheck disable=SC1090
  . "$CONF"
fi
export GIT_TERMINAL_PROMPT=0 # a private repository without a token fails at once instead of waiting for a password

JBL_REPO="${JBL_REPO:-CronusAztec/Balls}"
JBL_BRANCH="${JBL_BRANCH:-main}"
JBL_SITE_URL="${JBL_SITE_URL:-https://jumpingballslive.com}"
JBL_REQUIRE_GREEN="${JBL_REQUIRE_GREEN:-1}"
JBL_STATE_DIR="${JBL_STATE_DIR:-/var/lib/jbl-deploy}"
JBL_GIT_URL="${JBL_GIT_URL:-https://github.com/${JBL_REPO}.git}"
JBL_RETRY_SECONDS="${JBL_RETRY_SECONDS:-21600}"
JBL_VERIFY_TRIES="${JBL_VERIFY_TRIES:-18}"
JBL_VERIFY_WAIT="${JBL_VERIFY_WAIT:-10}"
# The paywall's two public values: the live licence key and the billing Worker (the same defaults as .github/workflows/deploy.yml).
LICENSE_PUBLIC_KEY="${LICENSE_PUBLIC_KEY:-MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE5Q9-e4H4jsJ0U34xlaAeMGIHpq5mV260PbJs0fVCZx5x3HgT9OTNN6Jk1WtKDGPxj6GkusFBjURGz240mV941A}"
BILLING_API_URL="${BILLING_API_URL:-https://jumpingballslive-billing.jumpingballslive.workers.dev}"
# (empty by default: the source repository is private, so a feedback form that opens its issues would send visitors to a 404)
JBL_FEEDBACK_GITHUB_REPO="${JBL_FEEDBACK_GITHUB_REPO-}"

WORK="$JBL_STATE_DIR/work"
SHA_RE='^[0-9a-f]{40}$'

logline() { printf '%s jbl-deploy: %s\n' "$(date -u +%FT%TZ)" "$*"; }
now() { date +%s; }
state_get() { cat "$JBL_STATE_DIR/$1" 2>/dev/null || true; }
state_set() { printf '%s\n' "$2" >"$JBL_STATE_DIR/$1"; }

# git that talks to GitHub: with JBL_GITHUB_TOKEN the credential travels in the environment of that one command (never in its arguments,
# which any user on the server could read), without it the repository must be public
gh_git() {
  if [ -n "${JBL_GITHUB_TOKEN:-}" ]; then
    local basic
    basic="$(printf 'x-access-token:%s' "$JBL_GITHUB_TOKEN" | base64 | tr -d '\n')"
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=http.extraHeader GIT_CONFIG_VALUE_0="Authorization: Basic $basic" git "$@"
  else
    git "$@"
  fi
}
# runs a command of the build without any of the tokens
scrub() { env -u CLOUDFLARE_API_TOKEN -u CLOUDFLARE_ACCOUNT_ID -u JBL_GITHUB_TOKEN "$@"; }
# one read-only GET of the GitHub API for $JBL_REPO ($1: the path after /repos/OWNER/NAME): the answer goes to $api_body, the HTTP status to
# $api_code (000: no answer at all). The credential travels on curl's stdin (-H @-), never in its arguments; there is no -f, so the status
# survives (what a 403 or 404 means depends on whether a token is set). Without JBL_GITHUB_TOKEN it works for a public repository.
gh_api() {
  local out
  out="$({
    [ -z "${JBL_GITHUB_TOKEN:-}" ] || printf 'Authorization: Bearer %s\n' "$JBL_GITHUB_TOKEN"
    printf 'Accept: application/vnd.github+json\n'
  } | curl -sS --max-time 30 -w '\n%{http_code}' -H @- "https://api.github.com/repos/$JBL_REPO$1" 2>/dev/null || true)"
  api_code="${out##*$'\n'}"
  [[ "$api_code" =~ ^[0-9]{3}$ ]] || api_code=000
  api_body="${out%$'\n'*}"
}

# a JSON file the next reader (a person, or the AI that pushed the commit) can look at: jbl-deploy.sh --status
write_result() { # state(ok|failed|waiting|skipped|unreachable) sha message
  node -e '
    const [state, sha, message, dir] = process.argv.slice(1);
    require("fs").writeFileSync(dir + "/last-result.json", JSON.stringify({ state, sha, message, at: new Date().toISOString() }, null, 2) + "\n");
  ' "$1" "$2" "$3" "$JBL_STATE_DIR" || true
}

if [ "${1:-}" = "--status" ]; then
  cat "$JBL_STATE_DIR/last-result.json" 2>/dev/null || echo '{"state":"never run"}'
  exit 0
fi

mkdir -p "$JBL_STATE_DIR"
exec 9>"$JBL_STATE_DIR/lock"
if ! flock -n 9; then
  logline "another run is in progress"
  exit 0
fi

FORCED_SHA=""
if [ "${1:-}" = "--sha" ]; then
  FORCED_SHA="${2:-}"
  if ! [[ "$FORCED_SHA" =~ $SHA_RE ]]; then
    logline "--sha needs a full 40-character commit hash"
    exit 2
  fi
fi

# ------------------------------------------------------------------ 1. which commit
if [ -n "$FORCED_SHA" ]; then
  HEAD_SHA="$FORCED_SHA"
else
  if ! HEAD_SHA="$(gh_git ls-remote "$JBL_GIT_URL" "refs/heads/$JBL_BRANCH" 2>/dev/null | cut -f1)" || ! [[ "$HEAD_SHA" =~ $SHA_RE ]]; then
    hint=", or the token in JBL_GITHUB_TOKEN has expired"
    [ -n "${JBL_GITHUB_TOKEN:-}" ] || hint=", or the repository is private and JBL_GITHUB_TOKEN is not set"
    logline "cannot read $JBL_BRANCH of $JBL_REPO from GitHub (network, the branch is gone$hint): nothing to do"
    write_result unreachable "" "cannot read $JBL_BRANCH of $JBL_REPO from GitHub$hint"
    exit 0
  fi
  if [ "$HEAD_SHA" = "$(state_get last-ok)" ]; then exit 0; fi
  if [ "$HEAD_SHA" = "$(state_get last-failed)" ]; then
    age=$(( $(now) - $(state_get last-failed-at || echo 0) ))
    if [ "$age" -lt "$JBL_RETRY_SECONDS" ]; then exit 0; fi
  fi
fi

# ------------------------------------------------------------------ 2. the repository's own checks
# The gate is the job named exactly "build" of .github/workflows/deploy.yml ("Build and deploy the site": lint, type check, unit tests, the
# production build) for this commit, in the runs of the watched branch. It is read through the Actions API: the workflow's runs for the
# commit and the branch, then the jobs of each run (up to five runs, newest first). Not through the commit's check runs: a fine-grained
# token has no "Checks" permission, but "Actions: Read-only" covers both calls. Runs of other workflows are never asked, and only the exact
# name counts, so the Windows workflow's "Windows build" and the "smoke (shard N of 4)" jobs cannot open the gate, and a failing smoke or
# deploy job does not close it. Only the watched branch counts: the same commit is often pushed to a feature branch first, and there the
# "build" job is green after the lint and the type check alone (the unit tests and the production build are for the product branch).
#   green    some build job completed with success (so a re-run that turns a red build green deploys, and a newer run that is still
#            going does not matter)
#   red      build jobs exist, all of them completed and none succeeded, and no run of the commit is still going: the commit is recorded
#            as failed (and, as any failed commit, not looked at again for six hours, even if it is re-run and turns green meanwhile)
#   pending  a build job is queued or running, a run of the commit is still going, or the push has not started a run (or its build job) yet
#   unknown  GitHub did not answer or the answer cannot be read
#   denied   a token is set and GitHub refuses the lookup (403 or 404): the token lacks "Actions: Read-only"
# Only green deploys; every other verdict waits for the next run.
build_verdict() { # SHA: sets $verdict and $why (a few words for the journal)
  local ids="" id words word green=0 open=0 going=0 failed=0 trouble=""
  gh_api "/actions/workflows/deploy.yml/runs?head_sha=$1&per_page=5&branch=$JBL_BRANCH"
  if [ "$api_code" = 200 ]; then
    # (the commit and the branch are checked again here, whatever GitHub listed; "going" after the ids: a listed run is not finished)
    ids="$(printf '%s' "$api_body" | node -e '
      let s = "";
      process.stdin.on("data", (c) => (s += c)).on("end", () => {
        try {
          const [sha, branch] = process.argv.slice(1);
          const runs = JSON.parse(s).workflow_runs.filter((r) => r.head_sha === sha && r.head_branch === branch).slice(0, 5);
          console.log(runs.length ? runs.map((r) => r.id).join(" ") + (runs.some((r) => r.status !== "completed") ? " going" : "") : "none");
        } catch {
          console.log("unknown");
        }
      });
    ' "$1" "$JBL_BRANCH" 2>/dev/null || echo unknown)"
    if [ "$ids" = unknown ]; then trouble="the answer cannot be read"; ids=""; fi
  else
    trouble="$api_code"
  fi
  for id in $ids; do
    if [ "$id" = going ]; then going=1; continue; fi
    [[ "$id" =~ ^[0-9]+$ ]] || continue
    gh_api "/actions/runs/$id/jobs?per_page=100"
    if [ "$api_code" != 200 ]; then trouble="$api_code"; continue; fi
    words="$(printf '%s' "$api_body" | node -e '
      let s = "";
      process.stdin.on("data", (c) => (s += c)).on("end", () => {
        try {
          const builds = JSON.parse(s).jobs.filter((r) => r.name === "build");
          for (const r of builds) console.log(r.status !== "completed" ? "open" : r.conclusion === "success" ? "success" : "failed");
        } catch {
          console.log("unknown");
        }
      });
    ' 2>/dev/null || echo unknown)"
    for word in $words; do
      case "$word" in
        success) green=1 ;;
        open) open=1 ;;
        failed) failed=1 ;;
        *) trouble="the answer cannot be read" ;;
      esac
    done
    if [ "$green" = 1 ]; then break; fi
  done
  why=""
  if [ "$green" = 1 ]; then
    verdict=green
  elif [ "$open" = 1 ] || [ "$going" = 1 ]; then
    verdict=pending
    why="the build job has not finished"
    [ "$open" = 1 ] || why="a run of the workflow for this commit is still going"
  elif [ -n "$trouble" ]; then
    verdict=unknown
    why="$trouble"
    case "$trouble" in
      000) why="GitHub did not answer" ;;
      403 | 404)
        why="GitHub answered HTTP $trouble"
        if [ -n "${JBL_GITHUB_TOKEN:-}" ]; then
          verdict=denied
          why="the token cannot read GitHub Actions: add Actions: Read-only (GitHub answered HTTP $trouble)"
        fi
        ;;
      [0-9][0-9][0-9]) why="GitHub answered HTTP $trouble" ;;
    esac
  elif [ "$failed" = 1 ]; then
    verdict=red
  else
    verdict=pending
    why="no run of the workflow for this commit yet"
    [ "$ids" = none ] || why="the workflow has no build job for this commit yet"
  fi
}

if [ "$JBL_REQUIRE_GREEN" = "1" ] && [ -z "$FORCED_SHA" ]; then
  build_verdict "$HEAD_SHA"
  case "$verdict" in
    green) ;;
    red)
      logline "$HEAD_SHA: the repository's checks are red: not deploying it"
      write_result skipped "$HEAD_SHA" "checks are red"
      state_set last-failed "$HEAD_SHA"
      state_set last-failed-at "$(now)"
      exit 0
      ;;
    denied)
      logline "$HEAD_SHA: $why: waiting (or set JBL_REQUIRE_GREEN=0 in $CONF to deploy without asking GitHub)"
      write_result waiting "$HEAD_SHA" "$why"
      exit 0
      ;;
    *)
      hint=""
      [ "$verdict" != "unknown" ] || [ -n "${JBL_GITHUB_TOKEN:-}" ] || hint=" - a private repository needs JBL_GITHUB_TOKEN"
      logline "$HEAD_SHA: the repository's checks are not finished yet ($verdict: $why$hint): waiting"
      write_result waiting "$HEAD_SHA" "checks: $verdict ($why)"
      exit 0
      ;;
  esac
fi

# ------------------------------------------------------------------ 3. build and deploy
STEP="start"
fail() {
  code=$?
  logline "FAILED at step '$STEP' (exit $code) for $HEAD_SHA"
  write_result failed "$HEAD_SHA" "failed at: $STEP"
  state_set last-failed "$HEAD_SHA"
  state_set last-failed-at "$(now)"
  exit 1
}
trap fail ERR

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] || [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  STEP="settings (CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are missing in $CONF)"
  false
fi

started="$(now)"
logline "deploying $HEAD_SHA ($JBL_BRANCH of $JBL_REPO)"
write_result waiting "$HEAD_SHA" "deploying"

STEP="fetch the commit"
mkdir -p "$WORK"
cd "$WORK"
if [ ! -d .git ]; then
  git init -q .
  git remote add origin "$JBL_GIT_URL"
fi
git remote set-url origin "$JBL_GIT_URL"
gh_git fetch -q --depth 1 origin "$HEAD_SHA"
git checkout -qf "$HEAD_SHA"
git clean -fdq
rm -rf out

STEP="install the dependencies"
scrub npm ci --no-audit --no-fund --loglevel=error
scrub npm ci --prefix billing --no-audit --no-fund --loglevel=error

STEP="production guard (the live billing keys)"
scrub env LICENSE_PUBLIC_KEY="$LICENSE_PUBLIC_KEY" BILLING_API_URL="$BILLING_API_URL" node scripts/go-live-check.mjs --deploy-guard

STEP="build the site"
[ -n "${JBL_SUPPORT_EMAIL:-}" ] || logline "warning: JBL_SUPPORT_EMAIL is not set in $CONF, so the site is built with no way for visitors to reach you (deploy/vps/README.md, \"Say who runs the site\")"
scrub env \
  SITEMAP_LASTMOD="$(git log -1 --format=%cI "$HEAD_SHA" 2>/dev/null || date -u +%FT%TZ)" \
  NEXT_PUBLIC_SITE_URL="$JBL_SITE_URL" \
  NEXT_PUBLIC_BASE_PATH="" \
  NEXT_PUBLIC_GITHUB_REPO="$JBL_FEEDBACK_GITHUB_REPO" \
  NEXT_PUBLIC_FEEDBACK_EMAIL="${JBL_FEEDBACK_EMAIL:-}" \
  NEXT_PUBLIC_SUPPORT_EMAIL="${JBL_SUPPORT_EMAIL:-}" \
  NEXT_PUBLIC_LEGAL_NAME="${JBL_LEGAL_NAME:-}" \
  NEXT_PUBLIC_LEGAL_ADDRESS="${JBL_LEGAL_ADDRESS:-}" \
  NEXT_PUBLIC_LEGAL_VAT_ID="${JBL_LEGAL_VAT_ID:-}" \
  NEXT_PUBLIC_LEGAL_REGISTRATION="${JBL_LEGAL_REGISTRATION:-}" \
  NEXT_PUBLIC_LEGAL_COUNTRY="${JBL_LEGAL_COUNTRY:-}" \
  NEXT_PUBLIC_FEEDBACK_ENDPOINT="${JBL_FEEDBACK_ENDPOINT:-}" \
  NEXT_PUBLIC_ANALYTICS_SCRIPT_URL="${JBL_ANALYTICS_SCRIPT_URL:-}" \
  NEXT_PUBLIC_ANALYTICS_SITE_ID="${JBL_ANALYTICS_SITE_ID:-}" \
  NEXT_PUBLIC_YOUTUBE_CLIENT_ID="${JBL_YOUTUBE_CLIENT_ID:-}" \
  NEXT_PUBLIC_DOWNLOADS_URL="${JBL_DOWNLOADS_URL:-}" \
  JBL_BUILD_SHA="$HEAD_SHA" \
  NEXT_PUBLIC_PUBLISH_RELAY_URL="${JBL_RELAY_URL:-https://relay.jumpingballslive.com}" \
  NEXT_PUBLIC_LICENSE_PUBLIC_KEY="$LICENSE_PUBLIC_KEY" \
  NEXT_PUBLIC_BILLING_API="$BILLING_API_URL" \
  npx next build --no-lint
scrub env NEXT_PUBLIC_SITE_URL="$JBL_SITE_URL" NEXT_PUBLIC_BASE_PATH="" JBL_BUILD_SHA="$HEAD_SHA" node scripts/postexport.mjs
printf '%s\n' "$HEAD_SHA" >out/build.txt

STEP="wrangler deploy"
env -u JBL_GITHUB_TOKEN CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" CLOUDFLARE_ACCOUNT_ID="$CLOUDFLARE_ACCOUNT_ID" npx --prefix billing wrangler deploy

# ------------------------------------------------------------------ 4. the live site names the commit
STEP="verify: the live site does not serve $HEAD_SHA after $((JBL_VERIFY_TRIES * JBL_VERIFY_WAIT)) seconds"
for _ in $(seq 1 "$JBL_VERIFY_TRIES"); do
  seen="$(curl -fsS --max-time 20 "$JBL_SITE_URL/build.txt?x=$(now)" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "$seen" = "$HEAD_SHA" ]; then
    trap - ERR
    state_set last-ok "$HEAD_SHA"
    write_result ok "$HEAD_SHA" "live after $(( $(now) - started )) s"
    logline "deployed: $JBL_SITE_URL/build.txt names $HEAD_SHA ($(( $(now) - started )) s)"
    exit 0
  fi
  sleep "$JBL_VERIFY_WAIT"
done
false
