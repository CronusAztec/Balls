#!/usr/bin/env bash
# Removes the site deployer from the VPS (feature vps-site-deployer): the timer, the service and the script. The settings (with the
# Cloudflare token), the build folder and the user stay unless you say --purge:
#   sudo bash deploy/vps/uninstall.sh            stop it and remove the timer, the service and /opt/jbl-deploy
#   sudo bash deploy/vps/uninstall.sh --purge    also delete /etc/jbl-deploy (the token), /var/lib/jbl-deploy and the jbldeploy user
# Rolling the Cloudflare token (My Profile → API Tokens → Roll) is what makes an old copy of it useless, whatever is left on disk.
set -euo pipefail

[ "$(id -u)" = 0 ] || { echo "error: run as root: sudo bash deploy/vps/uninstall.sh" >&2; exit 1; }

systemctl disable --now jbl-deploy.timer >/dev/null 2>&1 || true
systemctl stop jbl-deploy.service >/dev/null 2>&1 || true
rm -f /etc/systemd/system/jbl-deploy.service /etc/systemd/system/jbl-deploy.timer
systemctl daemon-reload
rm -rf /opt/jbl-deploy
echo "==> the timer, the service and the script are removed"

if [ "${1:-}" = "--purge" ]; then
  rm -rf /etc/jbl-deploy /var/lib/jbl-deploy
  if id -u jbldeploy >/dev/null 2>&1; then userdel jbldeploy 2>/dev/null || true; fi
  echo "==> the settings (the token), the build folder and the jbldeploy user are removed"
  echo "    a swap file made by install.sh (/swapfile) is left alone: swapoff /swapfile && rm /swapfile, and its /etc/fstab line, remove it"
else
  echo "    the token is still in /etc/jbl-deploy/env; --purge deletes it"
fi
