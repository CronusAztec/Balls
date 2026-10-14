#!/usr/bin/env bash
# jbl-deploy (feature vps-site-deployer): puts the website on Cloudflare from the VPS, by itself, whenever the watched branch moves.
#
# A systemd timer (install.sh) runs this every five minutes. It only ever CALLS OUT – to GitHub (git, the checks API) and to
# Cloudflare (Wrangler) – and listens on no port, so nobody can reach in through it. One run:
#   1. asks GitHub which commit the branch is at (git ls-remote); stops when that commit is the one already deployed,
#   2. (JBL_REQUIRE_GREEN=1) waits until the repository's own checks – the "build" job of "Build and deploy the site": lint and type
#      check – are green for that commit, and never deploys a red one,
#   3. fetches exactly that commit, installs, runs the production guard (the live billing keys, never the test ones), builds the static
#      site for the domain's root, stamps it with the commit (out/build.txt) and runs `wrangler deploy`,
#   4. asks the live site for /build.txt until it names the commit, and only then calls it deployed.
# A commit that failed is not tried again for six hours (a new commit is tried at once). Everything is in `journalctl -u jbl-deploy`.
#
# Settings come from /etc/jbl-deploy/env (written by install.sh, readable by the service only):
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   required: the token needs "Edit Cloudflare Workers" and the zone's DNS edit
#   JBL_GITHUB_TOKEN   only for a PRIVATE repository: a fine-grained token for that one repository, read-only (Contents: Read, Checks: Read).
#                      It is used for `git ls-remote`, `git fetch` and the checks lookup, and for nothing else. Each token reaches only the
#                      step that needs it: the build (npm, Next.js, the repository's own scripts) sees neither it nor the Cloudflare token.
#   JBL_REPO (CronusAztec/Balls)   JBL_BRANCH (main)   JBL_SITE_URL (https://jumpingballslive.com)
#   JBL_REQUIRE_GREEN (1)   JBL_FEEDBACK_GITHUB_REPO (the repo, while it is public with Issues on; empty once it is private)
#   JBL_FEEDBACK_EMAIL, JBL_SUPPORT_EMAIL, JBL_LEGAL_NAME, JBL_LEGAL_ADDRESS   the operator's public details the legal pages show
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
JBL_FEEDBACK_GITHUB_REPO="${JBL_FEEDBACK_GITHUB_REPO-$JBL_REPO}"

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

# a JSON file the next reader (a person, or the AI that pushed the commit) can look at: jbl-deploy.sh --status
write_result() { # state(ok|failed|waiting|skipped) sha message
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
    hint=""
    [ -n "${JBL_GITHUB_TOKEN:-}" ] || hint=", or the repository is private and JBL_GITHUB_TOKEN is not set"
    logline "cannot read $JBL_BRANCH of $JBL_REPO from GitHub (network, the branch is gone$hint): nothing to do"
    exit 0
  fi
  if [ "$HEAD_SHA" = "$(state_get last-ok)" ]; then exit 0; fi
  if [ "$HEAD_SHA" = "$(state_get last-failed)" ]; then
    age=$(( $(now) - $(state_get last-failed-at || echo 0) ))
    if [ "$age" -lt "$JBL_RETRY_SECONDS" ]; then exit 0; fi
  fi
fi

# ------------------------------------------------------------------ 2. the repository's own checks
if [ "$JBL_REQUIRE_GREEN" = "1" ] && [ -z "$FORCED_SHA" ]; then
  runs="$({
    [ -z "${JBL_GITHUB_TOKEN:-}" ] || printf 'Authorization: Bearer %s\n' "$JBL_GITHUB_TOKEN"
    printf 'Accept: application/vnd.github+json\n'
  } | curl -fsS --max-time 30 -H @- "https://api.github.com/repos/$JBL_REPO/commits/$HEAD_SHA/check-runs?per_page=100" 2>/dev/null || true)"
  verdict="$(printf '%s' "$runs" | node -e '
    let s = "";
    process.stdin.on("data", (c) => (s += c)).on("end", () => {
      try {
        const runs = JSON.parse(s).check_runs.filter((r) => r.name === "build");
        if (!runs.length) return console.log("none");
        if (runs.some((r) => r.status === "completed" && r.conclusion === "success")) return console.log("green");
        if (runs.every((r) => r.status === "completed")) return console.log("red");
        console.log("pending");
      } catch {
        console.log("unknown");
      }
    });
  ' 2>/dev/null || echo unknown)"
  case "$verdict" in
    green) ;;
    red)
      logline "$HEAD_SHA: the repository's checks are red: not deploying it"
      write_result skipped "$HEAD_SHA" "checks are red"
      state_set last-failed "$HEAD_SHA"
      state_set last-failed-at "$(now)"
      exit 0
      ;;
    *)
      hint=""
      [ "$verdict" != "unknown" ] || [ -n "${JBL_GITHUB_TOKEN:-}" ] || hint=" - a private repository needs JBL_GITHUB_TOKEN"
      logline "$HEAD_SHA: the repository's checks are not finished yet ($verdict$hint): waiting"
      write_result waiting "$HEAD_SHA" "checks: $verdict"
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
scrub env \
  SITEMAP_LASTMOD="$(git log -1 --format=%cI "$HEAD_SHA" 2>/dev/null || date -u +%FT%TZ)" \
  NEXT_PUBLIC_SITE_URL="$JBL_SITE_URL" \
  NEXT_PUBLIC_BASE_PATH="" \
  NEXT_PUBLIC_GITHUB_REPO="$JBL_FEEDBACK_GITHUB_REPO" \
  NEXT_PUBLIC_FEEDBACK_EMAIL="${JBL_FEEDBACK_EMAIL:-}" \
  NEXT_PUBLIC_SUPPORT_EMAIL="${JBL_SUPPORT_EMAIL:-}" \
  NEXT_PUBLIC_LEGAL_NAME="${JBL_LEGAL_NAME:-}" \
  NEXT_PUBLIC_LEGAL_ADDRESS="${JBL_LEGAL_ADDRESS:-}" \
  NEXT_PUBLIC_PUBLISH_RELAY_URL="${JBL_RELAY_URL:-https://relay.jumpingballslive.com}" \
  NEXT_PUBLIC_LICENSE_PUBLIC_KEY="$LICENSE_PUBLIC_KEY" \
  NEXT_PUBLIC_BILLING_API="$BILLING_API_URL" \
  npx next build --no-lint
scrub node scripts/postexport.mjs
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
