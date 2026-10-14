#!/usr/bin/env bash
# Installs the site deployer on the VPS (feature vps-site-deployer): one command, safe to run again.
#
#   git clone --branch main https://github.com/CronusAztec/Balls.git && cd Balls && sudo bash deploy/vps/install.sh
#   (--branch main: the repository's default branch on GitHub may still be another one)
#   (read deploy/vps/README.md and jbl-deploy.sh first – it is short; this runs as root)
#
# Options:  --branch NAME     the branch to watch and deploy (default: main)
#           --repo OWNER/NAME the repository (default: CronusAztec/Balls)
#           --swap            make a 2 GB swap file when the server has less than 3.5 GB of memory + swap (the build needs about 2 GB)
#           --no-first-run    install and start the timer, but do not deploy right now (the timer's first run is 2 minutes after this)
#           --every MINUTES   how often the timer looks for a new commit: 5 to 1440 minutes (default: 10; a re-run without it sets 10 again)
#           --reconfigure     ask for the Cloudflare token and account ID again (a normal re-run keeps /etc/jbl-deploy/env)
#           --private         the repository is (or is about to be) PRIVATE: ask for a read-only GitHub token for it, keep it with the other
#                             settings and stop asking the feedback form to open GitHub issues. Run it BEFORE you switch the repository to private.
#                             Create the token at GitHub → Settings → Developer settings → Fine-grained tokens: Only select repositories →
#                             this one; permissions Contents: Read-only and Checks: Read-only (Metadata is added by itself); the longest expiry.
#
# For Debian or Ubuntu with systemd, as root. It installs git, curl and Node.js 22 when they are missing, creates the unprivileged user
# `jbldeploy`, keeps the Cloudflare token in /etc/jbl-deploy/env (readable by that user only; nothing here prints it), and starts a
# timer that runs /opt/jbl-deploy/jbl-deploy.sh every ten minutes. That script only makes outbound calls (GitHub, Cloudflare); this
# installer opens no port and gives nobody a login. Remove it all with deploy/vps/uninstall.sh.
set -euo pipefail

BRANCH="main"
REPO="CronusAztec/Balls"
SWAP=0
FIRST_RUN=1
EVERY=10
RECONFIGURE=0
PRIVATE=0
DEFAULT_ACCOUNT="a1a1303c1defe6eafca7065581715c2e"
USER_NAME="jbldeploy"
STATE="/var/lib/jbl-deploy"
CONF_DIR="/etc/jbl-deploy"
BIN_DIR="/opt/jbl-deploy"

say() { printf '==> %s\n' "$*"; }
# set_conf KEY VALUE: KEY='VALUE' in $CONF (replaces that line, keeps every other line and the file's owner and mode). VALUE has no quote.
set_conf() {
  local tmp
  tmp="$(mktemp)"
  { grep -v "^$1=" "$CONF" || true; printf "%s='%s'\n" "$1" "$2"; } >"$tmp"
  cat "$tmp" >"$CONF"
  rm -f "$tmp"
}
# What was typed or pasted at a prompt, without the invisible bits a terminal adds: the "bracketed paste" markers (ESC[200~ ... ESC[201~,
# which show up as ^[[200~ ... ~), other control characters and every space or line break.
clean_input() { printf '%s' "$1" | LC_ALL=C sed -E 's/(\x1b)?\[20[01]~//g' | LC_ALL=C tr -d '\000-\037\177[:space:]'; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --repo) REPO="${2:-}"; shift 2 ;;
    --swap) SWAP=1; shift ;;
    --no-first-run) FIRST_RUN=0; shift ;;
    --every) [ $# -ge 2 ] || die "--every needs a number of minutes"; EVERY="$2"; shift 2 ;;
    --reconfigure) RECONFIGURE=1; shift ;;
    --private) PRIVATE=1; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) die "unknown option $1 (see --help)" ;;
  esac
done

[[ "$EVERY" =~ ^[0-9]{1,4}$ ]] && [ "$EVERY" -ge 5 ] && [ "$EVERY" -le 1440 ] || die "--every must be a whole number of minutes from 5 to 1440"
[ "$(id -u)" = 0 ] || die "run as root: sudo bash deploy/vps/install.sh"
[[ "$REPO" =~ ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$ ]] || die "--repo must look like OWNER/NAME"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || die "--branch has characters a branch name does not"
command -v apt-get >/dev/null 2>&1 || die "this installer is for Debian or Ubuntu (apt-get)"
[ -d /run/systemd/system ] || die "systemd is needed (the timer)"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE/jbl-deploy.sh" ] || die "jbl-deploy.sh is not next to install.sh"

# ------------------------------------------------------------------ tools
export DEBIAN_FRONTEND=noninteractive
need=()
for tool in curl git; do command -v "$tool" >/dev/null 2>&1 || need+=("$tool"); done
if [ ${#need[@]} -gt 0 ]; then
  say "installing ${need[*]}"
  apt-get update -qq
  apt-get install -y -qq ca-certificates "${need[@]}"
fi
node_major() { node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }
if [ "$(node_major)" -lt 22 ]; then
  say "installing Node.js 22 (NodeSource's setup script, which adds their apt repository)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
[ "$(node_major)" -ge 22 ] || die "Node.js 22 or newer is needed and could not be installed"
command -v flock >/dev/null 2>&1 || die "flock is missing (util-linux)"

# ------------------------------------------------------------------ memory: the Next.js build wants about 2 GB
mem_kb="$(awk '/^MemTotal:|^SwapTotal:/ {s += $2} END {print s + 0}' /proc/meminfo)"
if [ "$mem_kb" -lt 3670016 ]; then
  say "this server has $((mem_kb / 1024)) MB of memory + swap; the site build needs about 2 GB free"
  if [ "$SWAP" = 0 ] && [ -t 0 ]; then
    read -r -p "    make a 2 GB swap file at /swapfile? [y/N] " answer || answer=n
    [[ "$answer" =~ ^[Yy] ]] && SWAP=1
  fi
  if [ "$SWAP" = 1 ] && [ ! -e /swapfile ]; then
    fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >>/etc/fstab
    say "swap file made"
  fi
fi

# ------------------------------------------------------------------ user, folders, script
if ! id -u "$USER_NAME" >/dev/null 2>&1; then
  say "creating the unprivileged user $USER_NAME"
  useradd --system --home-dir "$STATE" --create-home --shell /usr/sbin/nologin "$USER_NAME"
fi
install -d -m 0755 "$BIN_DIR"
install -m 0755 "$HERE/jbl-deploy.sh" "$BIN_DIR/jbl-deploy.sh"
install -d -m 0750 -o root -g "$USER_NAME" "$CONF_DIR"
install -d -m 0750 -o "$USER_NAME" -g "$USER_NAME" "$STATE"

# ------------------------------------------------------------------ the settings (the token never appears on screen or in a log)
CONF="$CONF_DIR/env"
if [ ! -f "$CONF" ] || [ "$RECONFIGURE" = 1 ]; then
  token="${CLOUDFLARE_API_TOKEN:-}"
  account="${CLOUDFLARE_ACCOUNT_ID:-}"
  if [ -z "$token" ]; then
    [ -r /dev/tty ] || die "no terminal to ask on: run with CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID) in the environment"
    read -r -s -p "Cloudflare API token (Edit Cloudflare Workers + the zone's DNS edit; nothing is shown): " token </dev/tty
    echo
  fi
  if [ -z "$account" ]; then
    if [ -r /dev/tty ]; then
      read -r -p "Cloudflare account ID [$DEFAULT_ACCOUNT]: " account </dev/tty
    fi
    account="${account:-$DEFAULT_ACCOUNT}"
  fi
  token="$(clean_input "$token")"
  account="$(clean_input "$account")"
  [[ "$token" =~ ^[A-Za-z0-9_-]{20,200}$ ]] || die "that does not look like a Cloudflare API token (${#token} characters after cleaning; they are about 40 letters, digits, - and _)"
  [[ "$account" =~ ^[0-9a-f]{32}$ ]] || die "the account ID is 32 hex characters (this is ${#account})"
  say "checking the token with Cloudflare"
  check="$(curl -fsS --max-time 30 -H "Authorization: Bearer $token" https://api.cloudflare.com/client/v4/user/tokens/verify 2>/dev/null || true)"
  printf '%s' "$check" | grep -q '"success":true' || die "Cloudflare did not accept the token (create a new one: My Profile → API Tokens)"
  umask 077
  {
    printf '# written by deploy/vps/install.sh – only root and %s can read this file\n' "$USER_NAME"
    printf "CLOUDFLARE_API_TOKEN='%s'\n" "$token"
    printf "CLOUDFLARE_ACCOUNT_ID='%s'\n" "$account"
    printf "JBL_REPO='%s'\n" "$REPO"
    printf "JBL_BRANCH='%s'\n" "$BRANCH"
    printf '# JBL_REQUIRE_GREEN=1            deploy only commits whose "build" check on GitHub is green (0: deploy any)\n'
    printf '# JBL_FEEDBACK_GITHUB_REPO=      empty once the repository is private (the feedback form then needs JBL_FEEDBACK_EMAIL)\n'
    printf '# JBL_FEEDBACK_EMAIL=\n# JBL_SUPPORT_EMAIL=\n# JBL_LEGAL_NAME=\n# JBL_LEGAL_ADDRESS=\n'
  } >"$CONF"
  chown root:"$USER_NAME" "$CONF"
  chmod 0640 "$CONF"
  unset token check
  say "settings saved in $CONF"
else
  say "keeping the settings in $CONF (--reconfigure asks again); the branch there is not changed by this run"
fi

# ------------------------------------------------------------------ a private repository: one read-only GitHub token
if [ "$PRIVATE" = 1 ]; then
  gh_token="${JBL_GITHUB_TOKEN:-}"
  if [ -z "$gh_token" ]; then
    [ -r /dev/tty ] || die "no terminal to ask on: run with JBL_GITHUB_TOKEN in the environment"
    read -r -s -p "GitHub token for $REPO (read-only: Contents + Checks; nothing is shown): " gh_token </dev/tty
    echo
  fi
  gh_token="$(clean_input "$gh_token")"
  [[ "$gh_token" =~ ^(github_pat_[A-Za-z0-9_]{20,255}|gh[pousr]_[A-Za-z0-9]{20,255})$ ]] || die "that does not look like a GitHub token (${#gh_token} characters after cleaning; fine-grained ones start with github_pat_)"
  say "checking the token with GitHub (the repository, its newest commit and its checks)"
  api() { printf 'Authorization: Bearer %s\nAccept: application/vnd.github+json\n' "$gh_token" | curl -fsS --max-time 30 -H @- "https://api.github.com/repos/$REPO$1" 2>/dev/null; }
  # (each answer is kept in a variable first: `curl | grep -q` fails under pipefail when grep stops reading early)
  reply="$(api "" || true)"
  grep -q '"full_name"' <<<"$reply" || die "GitHub does not show $REPO to this token: select that repository for it, with Contents: Read-only"
  reply="$(api "/commits/$BRANCH" || true)"
  head_sha="$(grep -m1 -oE '"sha": *"[0-9a-f]{40}"' <<<"$reply" | grep -oE '[0-9a-f]{40}' || true)"
  [ -n "$head_sha" ] || die "the token cannot read the commits of $BRANCH (Contents: Read-only, and the branch name?)"
  reply="$(api "/commits/$head_sha/check-runs?per_page=1" || true)"
  grep -q '"total_count"' <<<"$reply" || die "the token cannot read the checks (add Checks: Read-only), or run with JBL_REQUIRE_GREEN=0 in $CONF"
  set_conf JBL_GITHUB_TOKEN "$gh_token"
  set_conf JBL_FEEDBACK_GITHUB_REPO ""
  unset gh_token
  say "the GitHub token is saved in $CONF; the feedback form no longer opens GitHub issues (it needs an e-mail address):"
  if [ -r /dev/tty ] && ! grep -q "^JBL_FEEDBACK_EMAIL=" "$CONF"; then
    read -r -p "    feedback e-mail address (Enter to set it later in $CONF): " feedback </dev/tty
    feedback="$(clean_input "$feedback")"
    if [[ "$feedback" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then set_conf JBL_FEEDBACK_EMAIL "$feedback"; fi
  fi
fi

# ------------------------------------------------------------------ systemd
cat >/etc/systemd/system/jbl-deploy.service <<EOF
[Unit]
Description=JumpingBallsLive site deployer (builds the watched branch and deploys it to Cloudflare)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$USER_NAME
Group=$USER_NAME
Environment=HOME=$STATE
ExecStart=$BIN_DIR/jbl-deploy.sh
TimeoutStartSec=2700
Nice=10
IOSchedulingClass=idle
# what the service can touch: its own state folder, the network, nothing else
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STATE
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictSUIDSGID=true
RestrictNamespaces=true
LockPersonality=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
CapabilityBoundingSet=
SystemCallArchitectures=native
EOF
cat >/etc/systemd/system/jbl-deploy.timer <<EOF
[Unit]
Description=Look for a new commit of the site every $EVERY minutes

[Timer]
OnBootSec=2min
OnUnitInactiveSec=${EVERY}min
AccuracySec=30s

[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now jbl-deploy.timer >/dev/null
if [ "$FIRST_RUN" = 1 ]; then
  say "starting the first deploy now (it builds for about five minutes)"
  systemctl start --no-block jbl-deploy.service
fi

cat <<EOF

Done. The deployer watches $BRANCH of $REPO and deploys what lands there (when GitHub's checks for it are green).
  progress / log   journalctl -u jbl-deploy -f
  last result      sudo -u $USER_NAME $BIN_DIR/jbl-deploy.sh --status
  deploy a commit  sudo -u $USER_NAME $BIN_DIR/jbl-deploy.sh --sha <40-character hash>   (a rollback is the same with an older one)
  pause            sudo systemctl stop jbl-deploy.timer        (resume: sudo systemctl start jbl-deploy.timer)
  how often        every $EVERY minutes after the last run finished (change: sudo bash deploy/vps/install.sh --every MINUTES)
  remove           sudo bash deploy/vps/uninstall.sh [--purge]
EOF
