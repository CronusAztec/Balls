# The site deployer for the VPS

jumpingballslive.com is a static export served by a Cloudflare Worker. This puts a new version of it there **from your VPS, without
anyone typing the build commands**: you install it once; after that, whatever lands on the watched branch (and passes GitHub's checks)
is built and deployed within about ten minutes.

```
git clone https://github.com/CronusAztec/Balls.git && cd Balls
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
* The watched branch defaults to `claude/nice-davinci-sn70l7`. After the pull request is merged, switch to `main`:
  `sudo sed -i "s#^JBL_BRANCH=.*#JBL_BRANCH='main'#" /etc/jbl-deploy/env`.
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

Once the repository is private, set `JBL_FEEDBACK_GITHUB_REPO=` (empty) and `JBL_FEEDBACK_EMAIL=…` in that file – the feedback form can
no longer open GitHub issues – and give the service read access to the code (the script fetches from `JBL_GIT_URL`; a private
repository needs a read-only deploy key, as in `relay/README.md`, "A private repository"). The checks gate (`JBL_REQUIRE_GREEN=1`) also
needs the public checks API: with a private repository set `JBL_REQUIRE_GREEN=0` or add a read token.

## How the AI that makes the changes uses it

It pushes to the watched branch, waits for GitHub's check to go green, and then reads `https://jumpingballslive.com/build.txt`: when it
prints the commit it pushed, the deploy happened. It has no access to this server and needs none.

Tests: `tests/vpsDeploy.test.ts` runs the whole script against stand-ins for git, npm, npx, node's two build scripts and curl: the order
of the steps, a red or pending check, a failing step, the retry window, the lock, a rollback by hash and the status file.
