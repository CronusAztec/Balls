#!/usr/bin/env bash
# JumpingBallsLive relay on a VPS (feature vps-deploy): one command, safe to run again (a second run updates).
#
#   curl -fsSL https://raw.githubusercontent.com/CronusAztec/Balls/BRANCH/relay/deploy/install.sh | bash -s -- relay.example.com --branch BRANCH
#
# Options:  --branch NAME          the branch to deploy (default: the product branch)
#           --origins LIST         the sites allowed to call the relay: comma-separated https origins, no paths
#                                  (default: this project's three: jumpingballslive.com, www.jumpingballslive.com, cronusaztec.github.io)
#           --use-existing-caddy   a Caddy already holds ports 80 and 443 on this server: do not start a second one, add the relay's
#                                  domain to the existing one as one more site. Its Caddyfile is backed up first, checked before and
#                                  after, and put back if the check fails or another site on the server answers differently afterwards.
#           --caddyfile PATH       that Caddy's config (default: the --config of the running Caddy, else /etc/caddy/Caddyfile)
#           --skip-dns-check       trust that the domain's A record points here (use it when this server has several addresses)
#           --no-firewall          leave ufw alone (it is left alone anyway with --use-existing-caddy)
#
# For Debian or Ubuntu, as root. It installs Docker and git when they are missing, puts the code in /opt/jumpingballslive, writes
# relay/deploy/.env once (a later run keeps it: your platform keys live there), starts the relay (and, unless you share a Caddy,
# Caddy in a container, which gets the HTTPS certificate by itself), waits until the relay answers and schedules a nightly backup of
# its data (14 days in /var/backups/jbl-relay). Nothing it prints is secret.
set -euo pipefail

REPO="https://github.com/CronusAztec/Balls.git"
DIR="/opt/jumpingballslive"
BACKUPS="/var/backups/jbl-relay"
DEFAULT_BRANCH="claude/optimistic-johnson-46x3qg"
DEFAULT_ORIGINS="https://jumpingballslive.com,https://www.jumpingballslive.com,https://cronusaztec.github.io"
RELAY_PORT=8787
EXISTING_CADDY=0
CADDYFILE=""
DNS_OK=0
WIRED=0
HTTPS_OK=0
LAST_BACKUP=""

say() { printf '\n==> %s\n' "$*"; }
warn() { printf '!! %s\n' "$*" >&2; }
die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh DOMAIN [--branch NAME] [--origins https://a.example,https://b.example]
                         [--use-existing-caddy [--caddyfile PATH]] [--skip-dns-check] [--no-firewall]
  DOMAIN               the name the relay answers on, e.g. relay.example.com (its A record must point at this server, DNS only)
  --branch             the branch of the repository to deploy
  --origins            the sites allowed to call the relay (comma-separated origins, no paths)
  --use-existing-caddy add the relay to the Caddy already on this server instead of starting a second one
  --caddyfile          that Caddy's config file (default: found from the running Caddy, else /etc/caddy/Caddyfile)
  --skip-dns-check     trust that the domain's A record points here
  --no-firewall        do not touch ufw
EOF
}

valid_domain() { [[ "$1" =~ ^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$ ]]; }

valid_branch() { [[ "$1" =~ ^[A-Za-z0-9._/-]+$ ]] && [[ "$1" != -* ]]; }

valid_origins() {
  local one='https?://[A-Za-z0-9.-]+(:[0-9]+)?'
  [[ "$1" =~ ^${one}(,${one})*$ ]]
}

valid_path() { [[ "$1" =~ ^/[A-Za-z0-9._/@+-]+$ ]]; }

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

describe_port() { ss -ltnpH "sport = :$1" 2>/dev/null | head -3; }

# An earlier run of this installer already owns what it would start: that is an update, not a conflict.
stack_running() { (cd "$DIR/relay/deploy" && docker compose ps -q "$1" 2>/dev/null | grep -q .); }

check_ports() {
  stack_running caddy && return 0
  local port
  for port in 80 443; do
    if port_busy "$port"; then
      warn "port $port is already in use:"
      describe_port "$port" >&2
      if describe_port "$port" | grep -q 'caddy'; then
        die "that is a Caddy already on this server. To share it, run this again with --use-existing-caddy: the relay joins it as one more site, your Caddyfile is backed up first and nothing else changes."
      fi
      die "port $port is used by another program (listed above). Stop it, or put the relay behind it by hand (see \"Run it on a VPS\" in relay/README.md)."
    fi
  done
  return 0
}

check_relay_port() {
  stack_running relay && return 0
  if port_busy "$RELAY_PORT"; then
    warn "port $RELAY_PORT is already in use:"
    describe_port "$RELAY_PORT" >&2
    die "the relay needs 127.0.0.1:$RELAY_PORT: stop the program above, or change the port by hand (see \"Run it on a VPS\" in relay/README.md)."
  fi
  return 0
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
  # Caddy in a container only when this installer is not sharing one that is already on the server.
  sed -i '/^COMPOSE_PROFILES=/d' "$file"
  if [ "$EXISTING_CADDY" = 0 ]; then
    [ -z "$(tail -c1 "$file")" ] || printf '\n' >>"$file"
    printf 'COMPOSE_PROFILES=caddy\n' >>"$file"
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
  local domain="$1" skip="$2" mine dns
  DNS_OK=0
  if [ "$skip" = 1 ]; then
    DNS_OK=1
    say "DNS check skipped (--skip-dns-check)"
    return 0
  fi
  mine="$(curl -4fsS --max-time 8 https://icanhazip.com 2>/dev/null | tr -d '[:space:]' || true)"
  dns="$(getent ahostsv4 "$domain" 2>/dev/null | awk 'NR==1 {print $1}' || true)"
  if [ -z "$dns" ]; then
    warn "$domain does not resolve yet: add an A record (DNS only) named ${domain%%.*} pointing at ${mine:-this server}."
  elif [ -z "$mine" ]; then
    warn "could not tell this server's own address to compare with $dns: carrying on"
    DNS_OK=1
  elif [ "$dns" != "$mine" ]; then
    warn "$domain points at $dns but this server is $mine: fix the A record (DNS only). HTTPS cannot start until it matches."
  else
    DNS_OK=1
    say "DNS: $domain points at this server ($dns)"
  fi
}

start_stack() {
  say "Building and starting the relay"
  (cd "$DIR/relay/deploy" && docker compose up -d --build </dev/null)
}

wait_for_relay() {
  local id state="" _
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
  say "The relay is running on 127.0.0.1:$RELAY_PORT"
}

wait_for_https() {
  local domain="$1" _
  say "Waiting for HTTPS on $domain (the certificate takes up to a minute once DNS is right)"
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

# --- sharing a Caddy that is already on the server ---------------------------------------------------------------------------

# The --config of the Caddy in a list of command lines (stdin), if there is one: only a line that is the caddy program itself
# running ("/usr/bin/caddy run ..."), never one that merely mentions it.
config_from_ps() {
  awk '$1 ~ /(^|\/)caddy$/ && $2 == "run" {
    for (i = 3; i <= NF; i++) {
      if ($i == "--config" && i < NF) { print $(i + 1); exit }
      if ($i ~ /^--config=/) { sub(/^--config=/, "", $i); print $i; exit }
    }
  }'
}

# Processes named caddy only (pgrep -x), with their command lines.
find_caddyfile() {
  local cfg
  cfg="$(pgrep -ax caddy 2>/dev/null | sed 's/^[0-9]* //' | config_from_ps || true)"
  printf '%s\n' "${cfg:-/etc/caddy/Caddyfile}"
}

# Whether a Caddyfile already has a site for the domain: one of the labels of a top-level block (not text inside a block, not a comment).
site_present() {
  awk -v want="$2" '
    BEGIN { want = tolower(want) }
    /^[^[:space:]#}]/ {
      line = tolower($0); sub(/\{.*$/, "", line)
      n = split(line, label, /[[:space:],]+/)
      for (i = 1; i <= n; i++) { gsub(/^https?:\/\//, "", label[i]); if (label[i] == want) found = 1 }
    }
    END { exit found ? 0 : 1 }' "$1"
}

# The plain host names a Caddyfile serves (not ports, not other schemes), except the one named.
plain_sites() {
  awk -v skip="$2" '
    BEGIN { skip = tolower(skip) }
    /^[^[:space:]#}{]/ {
      line = tolower($0); sub(/\{.*$/, "", line)
      n = split(line, label, /[[:space:],]+/)
      for (i = 1; i <= n; i++) {
        if (label[i] ~ /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/ && label[i] != skip && !seen[label[i]]++) print label[i]
      }
    }' "$1"
}

# "host status" for each of those sites, asked of this server's own Caddy (no DNS needed, and never through a proxy that
# happens to be set in the shell): the same before and after means the other sites did not notice anything.
site_status() {
  local host code
  while IFS= read -r host; do
    [ -n "$host" ] || continue
    code="$(curl -sk --noproxy '*' -o /dev/null -m 8 -w '%{http_code}' --resolve "$host:443:127.0.0.1" "https://$host/" 2>/dev/null || true)"
    printf '%s %s\n' "$host" "${code:-000}"
  done < <(plain_sites "$1" "$2")
}

reload_caddy() {
  local bin="$1" file="$2"
  if [ -n "${JBL_RELOAD_CMD:-}" ]; then
    sh -c "$JBL_RELOAD_CMD"
  else
    systemctl reload caddy 2>/dev/null || "$bin" reload --config "$file" --adapter caddyfile --force
  fi
}

restore_caddyfile() {
  cp -p "$1" "$2"
  reload_caddy "$3" "$2" >/dev/null 2>&1 || true
}

wire_existing_caddy() {
  local domain="$1" file bin backup before after baseline_ok=0
  file="${CADDYFILE:-$(find_caddyfile)}"
  bin="${JBL_CADDY_BIN:-$(command -v caddy || true)}"
  [ -n "$bin" ] || die "a Caddy is running but there is no caddy command here to check its config with: add the relay's site to it by hand (see \"Run it on a VPS\" in relay/README.md)"
  [ -f "$file" ] || die "the Caddyfile $file does not exist: name it with --caddyfile PATH"
  case "$file" in
    *.json) die "your Caddy is configured with JSON ($file), not a Caddyfile: add the relay's site by hand (see \"Run it on a VPS\" in relay/README.md)" ;;
  esac
  if site_present "$file" "$domain"; then
    say "$file already has a site for $domain: leaving your Caddy as it is"
    WIRED=1
    return 0
  fi
  [ -w "$file" ] || die "cannot write to $file"
  if "$bin" validate --config "$file" --adapter caddyfile >/dev/null 2>&1; then
    baseline_ok=1
  else
    warn "this shell cannot validate $file on its own (it may need the service's environment): relying on the reload's own check"
  fi
  before="$(site_status "$file" "$domain")"
  backup="$file.bak.pre-jbl-relay.$(date +%s)"
  cp -p "$file" "$backup"
  LAST_BACKUP="$backup"
  say "Adding $domain to $file (backup: $backup)"
  printf '\n\n# JumpingBallsLive relay (added by relay/deploy/install.sh)\n%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "$domain" "$RELAY_PORT" >>"$file"
  if [ "$baseline_ok" = 1 ] && ! "$bin" validate --config "$file" --adapter caddyfile >/dev/null 2>&1; then
    cp -p "$backup" "$file"
    die "Caddy does not accept $file with the relay's site added: your Caddyfile is exactly as it was (backup: $backup)"
  fi
  if ! reload_caddy "$bin" "$file" >/dev/null 2>&1; then
    restore_caddyfile "$backup" "$file" "$bin"
    die "Caddy would not reload with the relay's site added: your Caddyfile is back as it was (backup: $backup) and the running Caddy was not changed"
  fi
  sleep "${JBL_RELOAD_WAIT:-3}"
  after="$(site_status "$file" "$domain")"
  if [ "$before" != "$after" ]; then
    restore_caddyfile "$backup" "$file" "$bin"
    warn "before: $(printf '%s' "$before" | tr '\n' ';')"
    warn "after:  $(printf '%s' "$after" | tr '\n' ';')"
    die "another site on this server answered differently after the reload: your Caddyfile is back as it was (backup: $backup)"
  fi
  WIRED=1
  say "Your Caddy now passes $domain to the relay; the other sites on this server answered the same before and after"
}

summary() {
  local domain="$1"
  say "Done"
  if [ "$EXISTING_CADDY" = 1 ] && [ "$WIRED" = 0 ]; then
    cat <<EOF
The relay runs on 127.0.0.1:$RELAY_PORT, but your Caddy has not been changed yet, because $domain does not point at this server.
Add the A record (DNS only), then run this same command again: it adds the site to your Caddy.
EOF
  elif [ "$HTTPS_OK" = 1 ]; then
    echo "The relay answers at https://$domain/api/health"
  else
    echo "The relay runs, but https://$domain/api/health does not answer yet. Almost always this is DNS: the A record for $domain must point at this server and be DNS only. Caddy keeps trying; to watch it: journalctl -u caddy -f (your own Caddy) or cd $DIR/relay/deploy && docker compose logs -f caddy"
  fi
  if [ -n "$LAST_BACKUP" ]; then
    cat <<EOF

To undo the change to your Caddy: cp -p $LAST_BACKUP ${CADDYFILE:-$(find_caddyfile)} && systemctl reload caddy
EOF
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
  local domain="" branch="$DEFAULT_BRANCH" origins="$DEFAULT_ORIGINS" firewall=1 skip_dns=0
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
      --caddyfile)
        [ $# -ge 2 ] || die "--caddyfile needs a path"
        CADDYFILE="$2"
        shift 2
        ;;
      --use-existing-caddy)
        EXISTING_CADDY=1
        shift
        ;;
      --skip-dns-check)
        skip_dns=1
        shift
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
  if [ -n "$CADDYFILE" ]; then
    [ "$EXISTING_CADDY" = 1 ] || die "--caddyfile only goes with --use-existing-caddy"
    valid_path "$CADDYFILE" || die "'$CADDYFILE' is not a plain absolute path"
  fi
  [ "$(id -u)" -eq 0 ] || die "run this as root, for example: curl -fsSL <address of this script> | sudo bash -s -- $domain"
  check_os
  ensure_packages
  ensure_docker
  fetch_code "$branch"
  if [ "$EXISTING_CADDY" = 1 ]; then check_relay_port; else check_ports; fi
  write_env "$domain" "$origins"
  [ "$EXISTING_CADDY" = 1 ] || open_firewall "$firewall"
  check_dns "$domain" "$skip_dns"
  start_stack
  wait_for_relay
  if [ "$EXISTING_CADDY" = 1 ] && [ "$DNS_OK" = 1 ]; then wire_existing_caddy "$domain"; fi
  if [ "$EXISTING_CADDY" = 0 ] || [ "$WIRED" = 1 ]; then wait_for_https "$domain"; fi
  install_backup
  summary "$domain"
}

# JBL_SOURCE_ONLY=1 loads the functions without running them (relay/relay.test.mjs tests the checks and the Caddyfile edit that way).
[ "${JBL_SOURCE_ONLY:-0}" = 1 ] || main "$@"
