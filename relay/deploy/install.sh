#!/usr/bin/env bash
# JumpingBallsLive relay on a VPS (feature vps-deploy): one command, safe to run again (a second run updates).
#
#   curl -fsSL https://raw.githubusercontent.com/CronusAztec/Balls/BRANCH/relay/deploy/install.sh | sudo bash -s -- relay.example.com --branch BRANCH
#
# Options:  --branch NAME    the branch to deploy (default: the product branch)
#           --origins LIST   the sites allowed to call the relay: comma-separated https origins, no paths
#                            (default: this project's three: jumpingballslive.com, www.jumpingballslive.com, cronusaztec.github.io)
#           --no-firewall    leave ufw alone
#
# For Debian or Ubuntu, as root. It installs Docker and git when they are missing, puts the code in /opt/jumpingballslive,
# writes relay/deploy/.env once (a later run keeps it: your platform keys live there), opens ports 80 and 443 when ufw is
# already on, starts the relay and Caddy (the HTTPS certificate comes by itself), waits until the relay answers and schedules
# a nightly backup of its data (14 days in /var/backups/jbl-relay). Nothing it prints is secret.
set -euo pipefail

REPO="https://github.com/CronusAztec/Balls.git"
DIR="/opt/jumpingballslive"
BACKUPS="/var/backups/jbl-relay"
DEFAULT_BRANCH="claude/optimistic-johnson-46x3qg"
DEFAULT_ORIGINS="https://jumpingballslive.com,https://www.jumpingballslive.com,https://cronusaztec.github.io"
HTTPS_OK=0

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh DOMAIN [--branch NAME] [--origins https://a.example,https://b.example] [--no-firewall]
  DOMAIN         the name the relay answers on, e.g. relay.example.com (its A record must point at this server, DNS only)
  --branch       the branch of the repository to deploy
  --origins      the sites allowed to call the relay (comma-separated origins, no paths)
  --no-firewall  do not touch ufw
EOF
}

valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; }

valid_branch() { [[ "$1" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$1" != -* ]]; }

valid_origins() {
  local one='https?://[A-Za-z0-9.-]+(:[0-9]+)?'
  [[ "$1" =~ ^${one}(,${one})*$ ]]
}

check_os() {
  [ -r /etc/os-release ] || die "cannot tell the operating system (no /etc/os-release); this installer is for Debian or Ubuntu"
  # shellcheck disable=SC1091
  . /etc/os-release
  case " ${ID:-} ${ID_LIKE:-} " in
    *" debian "* | *" ubuntu "*) ;;
    *) die "this installer is for Debian or Ubuntu (this is ${PRETTY_NAME:-unknown}); on another system follow \"Run it on a VPS\" in relay/README.md by hand" ;;
  esac
}

ensure_packages() {
  local -a missing=()
  command -v git >/dev/null 2>&1 || missing+=(git)
  command -v curl >/dev/null 2>&1 || missing+=(curl)
  [ -e /etc/ssl/certs/ca-certificates.crt ] || missing+=(ca-certificates)
  if [ "${#missing[@]}" -gt 0 ]; then
    say "Installing ${missing[*]}"
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -qq </dev/null
    apt-get install -y -qq "${missing[@]}" </dev/null
  fi
}

ensure_docker() {
  if ! command -v docker >/dev/null 2>&1; then
    say "Installing Docker (the official get.docker.com script)"
    curl -fsSL https://get.docker.com | sh
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null 2>&1 || die "Docker Compose is missing: install the docker-compose-plugin package, then run this again"
}

fetch_code() {
  local branch="$1"
  say "Getting the code (branch $branch)"
  if [ -d "$DIR/.git" ]; then
    git -C "$DIR" fetch --quiet --depth 1 origin "$branch" </dev/null
    git -C "$DIR" checkout --quiet --force -B deploy FETCH_HEAD
  else
    if [ -e "$DIR" ] && [ -n "$(ls -A "$DIR" 2>/dev/null)" ]; then
      die "$DIR exists and is not a checkout of this project: move it away first"
    fi
    git clone --quiet --depth 1 --branch "$branch" "$REPO" "$DIR" </dev/null
  fi
  [ -f "$DIR/relay/deploy/docker-compose.yml" ] || die "branch $branch has no relay/deploy kit: use --branch with a branch that has it"
}

port_busy() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

check_ports() {
  # An earlier run of this installer already owns the ports: that is an update, not a conflict.
  if (cd "$DIR/relay/deploy" && docker compose ps -q caddy 2>/dev/null | grep -q .); then
    return 0
  fi
  local port
  for port in 80 443; do
    if port_busy "$port"; then
      die "port $port is already used by another program (see: ss -ltnp). Stop it, or put the relay behind it by hand."
    fi
  done
}

write_env() {
  local domain="$1" origins="$2" file="$DIR/relay/deploy/.env" current
  if [ -f "$file" ]; then
    say "Keeping your existing $file"
    current="$(grep -E '^RELAY_DOMAIN=' "$file" | head -1 | cut -d= -f2- || true)"
    [ "$current" = "$domain" ] || warn "the existing .env names '${current}', not '$domain': edit it if that is not what you want"
  else
    say "Writing $file"
    (
      umask 077
      printf 'RELAY_DOMAIN=%s\nRELAY_PUBLIC_URL=https://%s\nRELAY_ALLOWED_ORIGINS=%s\n' "$domain" "$domain" "$origins" >"$file"
    )
  fi
  chmod 600 "$file"
}

open_firewall() {
  [ "$1" = 1 ] || return 0
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q '^Status: active'; then
    ufw allow 80/tcp >/dev/null
    ufw allow 443 >/dev/null
    say "ufw: ports 80 and 443 are open"
  else
    say "No active ufw firewall found: make sure your provider's firewall lets ports 80 and 443 in"
  fi
}

check_dns() {
  local domain="$1" mine dns
  mine="$(curl -4fsS --max-time 8 https://icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)"
  dns="$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
  if [ -z "$dns" ]; then
    warn "$domain does not resolve yet: add an A record (DNS only) pointing at ${mine:-this server}. The certificate comes by itself once it does."
  elif [ -n "$mine" ] && [ "$dns" != "$mine" ]; then
    warn "$domain points at $dns but this server is $mine: fix the A record (DNS only). HTTPS cannot start until it matches."
  else
    say "DNS: $domain points at this server ($dns)"
  fi
}

start_stack() {
  say "Building and starting the relay and Caddy"
  (cd "$DIR/relay/deploy" && docker compose up -d --build </dev/null)
}

wait_for_relay() {
  local domain="$1" id state=""
  id="$(cd "$DIR/relay/deploy" && docker compose ps -q relay)"
  for _ in $(seq 1 45); do
    state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
    [ "$state" = healthy ] && break
    sleep 2
  done
  if [ "$state" != healthy ]; then
    (cd "$DIR/relay/deploy" && docker compose logs --tail 40 relay) || true
    die "the relay did not become healthy (its log is above)"
  fi
  say "The relay is running. Waiting for HTTPS on $domain (the certificate takes up to a minute once DNS is right)"
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 6 "https://$domain/api/health" >/dev/null 2>&1; then
      HTTPS_OK=1
      return 0
    fi
    sleep 3
  done
}

install_backup() {
  install -d -m 700 "$BACKUPS"
  cat >/etc/cron.d/jbl-relay-backup <<EOF
# JumpingBallsLive relay: a nightly copy of its data (accounts and their tokens), kept 14 days
17 3 * * * root umask 077; tar czf $BACKUPS/relay-\$(date +\%F).tgz -C $DIR/relay/deploy data 2>/dev/null; find $BACKUPS -name 'relay-*.tgz' -mtime +14 -delete
EOF
  chmod 644 /etc/cron.d/jbl-relay-backup
}

summary() {
  local domain="$1"
  say "Done"
  if [ "$HTTPS_OK" = 1 ]; then
    echo "The relay answers at https://$domain/api/health"
  else
    echo "The relay runs, but https://$domain/api/health does not answer yet. Almost always this is DNS: the A record for $domain must point at this server and be DNS only. Caddy keeps trying; to watch it: cd $DIR/relay/deploy && docker compose logs -f caddy"
  fi
  cat <<EOF

Next:
  - Add your platform keys to $DIR/relay/deploy/.env (the .env.example beside it lists them), then:
      cd $DIR/relay/deploy && docker compose up -d
  - Update later by running this same command again.
  - Logs: cd $DIR/relay/deploy && docker compose logs -f
  - Backups: $BACKUPS (nightly, 14 days). Copy them off this server now and then.
EOF
}

main() {
  local domain="" branch="$DEFAULT_BRANCH" origins="$DEFAULT_ORIGINS" firewall=1
  while [ $# -gt 0 ]; do
    case "$1" in
      --branch)
        [ $# -ge 2 ] || die "--branch needs a branch name"
        branch="$2"
        shift 2
        ;;
      --origins)
        [ $# -ge 2 ] || die "--origins needs a comma-separated list"
        origins="$2"
        shift 2
        ;;
      --no-firewall)
        firewall=0
        shift
        ;;
      -h | --help)
        usage
        exit 0
        ;;
      -*) die "unknown option $1 (see --help)" ;;
      *)
        [ -z "$domain" ] || die "give one domain only"
        domain="$1"
        shift
        ;;
    esac
  done
  if [ -z "$domain" ]; then
    usage >&2
    die "give the relay's domain, for example relay.example.com"
  fi
  valid_domain "$domain" || die "'$domain' is not a valid domain name"
  valid_branch "$branch" || die "'$branch' is not a valid branch name"
  valid_origins "$origins" || die "--origins must be comma-separated http(s) origins without paths, e.g. https://example.com,https://www.example.com"
  [ "$(id -u)" -eq 0 ] || die "run this as root, for example: curl -fsSL <address of this script> | sudo bash -s -- $domain"
  check_os
  ensure_packages
  ensure_docker
  fetch_code "$branch"
  check_ports
  write_env "$domain" "$origins"
  open_firewall "$firewall"
  check_dns "$domain"
  start_stack
  wait_for_relay "$domain"
  install_backup
  summary "$domain"
}

# JBL_SOURCE_ONLY=1 loads the functions without running them (relay/relay.test.mjs tests the validators that way).
[ "${JBL_SOURCE_ONLY:-0}" = 1 ] || main "$@"
