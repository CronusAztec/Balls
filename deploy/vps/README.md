# The site deployer for the VPS

jumpingballslive.com is a static export served by a Cloudflare Worker. This puts a new version of it there **from your VPS, without
anyone typing the build commands**: you install it once; after that, whatever lands on the watched branch (and passes GitHub's checks)
is built and deployed within about ten minutes.

```
git clone --branch main https://github.com/CronusAztec/Balls.git && cd Balls
sudo bash deploy/vps/install.sh            # asks for the Cloudflare token once, then deploys the branch's newest commit
```

Debian or Ubuntu with systemd; about 2 GB of memory for the build (`--swap` makes a swap file when the server has less).

## What it does, and what it does not

* Every five minutes `jbl-deploy.sh` asks GitHub which commit the branch is at. If that is not the commit already deployed it
  waits for the repository's own check (the `build` job of *Build and deploy the site*: lint and type check) to be **green**, fetches
  exactly that commit, runs the **production guard** (the live billing keys – a build with the test keys is refused), builds the site
  for the root of the domain, stamps `out/build.txt` with the commit, runs `wrangler deploy` and asks the live site for `/build.txt`
  until it names that commit. Only then is it "deployed".
* A commit that failed is not retried for six hours; a newer commit is tried at once. The state is in `/var/lib/jbl-deploy`
  (`last-result.json`, `last-ok`, `last-failed`), the log in `journalctl -u jbl-deploy`.
* **It opens no port and gives nobody a login.** It only calls out: GitHub (git, the checks API) and Cloudflare (Wrangler, npm's
  registry). Nothing can connect *to* it. The service runs as the unprivileged user `jbldeploy` with systemd's sandboxing
  (no new privileges, read-only system, no home folders, no devices, network only).
* The Cloudflare token lives in `/etc/jbl-deploy/env`, mode 0640, owner `root:jbldeploy`. `install.sh` never prints it.

## The trust you are extending (read this)

Whoever can push to the watched branch of the repository can make this server run their code as `jbldeploy` and use the Cloudflare
token during the build – the same trust a GitHub Actions deploy needs, moved to your server. So:

* Give the token only what it needs: *Edit Cloudflare Workers* and the zone's *DNS: Edit* for `jumpingballslive.com`
  (not Global API Key, not account-wide admin). It never needs R2 or the billing Worker's secrets.
* Keep write access to the repository to yourself and the AI session you trust, and turn on two-factor sign-in on GitHub.
* The watched branch is `main` (`JBL_BRANCH` in `/etc/jbl-deploy/env`; `install.sh --branch NAME` writes another one). Turn on branch
  protection for `main` in GitHub (require the `build` check) if more people than you can push there.
* Making the repository private (planned after the Windows apps have updated) also closes the door to pull requests from strangers.
* To stop everything at once: `sudo systemctl stop jbl-deploy.timer`. To undo it all: `sudo bash deploy/vps/uninstall.sh --purge`,
  then roll the token in Cloudflare.

## Day to day

| What | Command |
| --- | --- |
| watch a deploy | `journalctl -u jbl-deploy -f` |
| last result | `sudo -u jbldeploy /opt/jbl-deploy/jbl-deploy.sh --status` |
| deploy now instead of waiting | `sudo systemctl start jbl-deploy.service` |
| deploy a particular commit (a rollback) | `sudo -u jbldeploy /opt/jbl-deploy/jbl-deploy.sh --sha <40-character hash>` |
| a rollback in Cloudflare itself | dashboard → Workers & Pages → `jumpingballslive` → Deployments → Rollback |
| change the token | `sudo bash deploy/vps/install.sh --reconfigure` |
| pause / resume | `sudo systemctl stop jbl-deploy.timer` / `sudo systemctl start jbl-deploy.timer` |
| settings (branch, feedback e-mail, legal details) | `/etc/jbl-deploy/env`, listed at the top of `jbl-deploy.sh` |

## When the repository is private

The deployer reads the repository (`git ls-remote`, `git fetch`) and GitHub's check results anonymously, which only works while it is
public. For a private repository give it **one read-only token**, **before** you switch the visibility:

1. GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token. Resource owner: you.
   Repository access: **Only select repositories** → `Balls`. Permissions → Repository: **Contents: Read-only** and **Checks: Read-only**
   (Metadata: Read-only is added by itself). The longest expiry GitHub offers; put the date in your calendar – a token that has expired
   makes the deployer log `cannot read main … JBL_GITHUB_TOKEN` and stop deploying.
2. On the server, in your existing checkout: `cd ~/Balls && git pull origin main && sudo bash deploy/vps/install.sh --private`.
   It asks for the token (typing is hidden), checks it against the repository, its newest commit and its checks, saves it in
   `/etc/jbl-deploy/env`, stops the feedback form from opening GitHub issues and asks for an e-mail address for it instead.
3. Look at `journalctl -u jbl-deploy -n 20`, or wait for the next deploy, and only then make the repository private.

What the token can and cannot do: read the code and the check results of that one repository – no writing, no other repository, nothing
else on your account. It is used for three calls (`git ls-remote`, `git fetch`, the checks lookup) and never reaches the build: `npm`,
Next.js and the repository's own scripts run without it and without the Cloudflare token; `wrangler` gets only the Cloudflare token.
A fresh server needs the same token to clone the code the first time (`git -c http.extraHeader="Authorization: Basic $(printf
'x-access-token:%s' "$TOKEN" | base64 -w0)" clone --branch main https://github.com/CronusAztec/Balls.git`, with `TOKEN` read by `read -rs TOKEN`).

Without the Checks permission set `JBL_REQUIRE_GREEN=0` in the settings file: the deployer then deploys every new commit of the branch
without waiting for GitHub's lint, type check and unit tests – only do that if you trust whoever can push.

## How the AI that makes the changes uses it

It pushes to the watched branch, waits for GitHub's check to go green, and then reads `https://jumpingballslive.com/build.txt`: when it
prints the commit it pushed, the deploy happened. It has no access to this server and needs none.

Tests: `tests/vpsDeploy.test.ts` runs the whole script against stand-ins for git, npm, npx, node's two build scripts and curl: the order
of the steps, a red or pending check, a failing step, the retry window, the lock, a rollback by hash and the status file.
