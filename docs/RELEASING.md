# Releasing: one push updates everything

This page is for the owner. It explains what happens after you push a change, how to release a new version of the
Windows app, and how to undo a bad release. The full launch checklist (payments, legal pages, the domain) is in
[GO-LIVE.md](GO-LIVE.md).

GitHub only keeps the code and runs the builds: the website is served by Cloudflare, the Windows app's downloads and updates
by the Releases of a second, public repository that holds the installers only (the downloads repository), so this repository can be private ("Making the repository private" below).

The **product branch** is `claude/optimistic-johnson-46x3qg`. If you rename it to `main` in GitHub (Settings → General →
Default branch → the pencil icon), everything keeps working: both names are listed in the workflows. Other branches only get
the lint and the type check: the website never deploys from them, not even when someone presses "Run workflow" on them. The
Worker and the Windows app deploy from another branch only when you pick that branch in **Run workflow** yourself
("Deploy billing worker", or "Windows app" with **publish** ticked).

## What updates when

| What | When it updates | How long | Where to watch |
| --- | --- | --- | --- |
| Website (jumpingballslive.com) | every push to the product branch | about 25 min | Actions → "Build and deploy the site" |
| Payment Worker (Cloudflare) | a push that changes `billing/`, once the variable `BILLING_AUTODEPLOY` is `1` (the first deploy is by hand) | about 2 min, then a health check | Actions → "Deploy billing worker" |
| Windows app | a push that changes the version in `desktop/package.json` | 8–15 min to the release; installed apps update within 4 hours or at their next start | Actions → "Windows app", then <https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/latest.yml> |

**Which build is live?** Every build names itself with three facts: the release version (`version` in `package.json`), the
commit and the commit's date. The footer of every page shows them (`v1.10.0 · 8fa8dbb · 2026-10-14`, the full commit in the
tooltip, a link to the changelog), <https://jumpingballslive.com/version.json> says what is live right now (also the full
commit, the build id `1.10.0+8fa8dbb` and when it was built), and the page source has `<meta name="jbl-build" content="1.10.0+8fa8dbb">`.
`curl -sI https://jumpingballslive.com/en/ | grep -i x-build` shows the same id as a header. The footer shows the build a page
was loaded from, so a tab that has been open for days shows an older one until it is reloaded; `version.json` is always the live
one. The Windows app shows its own version in the title bar, in **Help → About** and in the Desktop group (GPU tab, App card),
together with the website build inside it.

## Ship a website change

1. Edit the files (or ask your developer to).
2. Say it in the changelog (a change visitors can notice; skip it for a change nobody sees). Put a release at the top of
   `releases` in `src/content/changelog.json`: the next website version (1.10.0 → 1.10.1 for a fix, 1.11.0 for something new), today's
   date, a headline of at most 60 characters and the items, each written in English, Polish and Spanish. Raise `version` in
   `package.json` to the same number with `npm version 1.10.1 --no-git-tag-version`, then run `npm run changelog` to rewrite
   `CHANGELOG.md`. The entry, the version bump and `CHANGELOG.md` go in the same commit: `npx vitest run tests/changelog.test.ts
   tests/copyStyle.test.ts` fails when one of them is missing or an entry breaks the copy style. The entry appears on
   `/en/changelog/`, `/pl/changelog/` and `/es/changelog/` when the site deploys.
3. `git add <the files>` (with `src/content/changelog.json`, `CHANGELOG.md`, `package.json` and `package-lock.json`)
4. `git commit -m "Say what changed"`
5. `git push`

The Actions tab then shows the run: the checks and the build take about 6 minutes, the browser test runs on four machines
at once for about 12–15 minutes, and the deploy takes a minute or two; the last step asks jumpingballslive.com which build
it serves and fails if it is not this one. **A red run publishes nothing**: the site that is live stays as it was. When it is
green, open <https://jumpingballslive.com/version.json>: `siteVersion` is the version you set in `package.json` and `commit`
starts with the commit you pushed (the footer of a freshly loaded page says the same).

## Release the Windows app

1. Pick the next version. It must always be higher than the last one: 1.0.3 → 1.0.4 → 1.0.5 … Raise the second number
   for bigger changes (1.0.9 → 1.1.0). Three plain numbers only: a version like 1.0.4-rc.1 is refused (the website and the
   download page only show x.y.z releases).
2. Say it in the changelog: put a release for the Windows app at the top of `releases` in `src/content/changelog.json` (its
   `product` is `app`, its `version` the one you picked, a headline and the items in English, Polish and Spanish), then run
   `npm run changelog`. The entry goes in the same commit as the version bump, because the app carries the site: the changelog page
   inside the app must list its own version, and the same entry becomes the notes of both GitHub releases (`node
   scripts/changelog.mjs --notes app 1.0.4` prints them; a version without an entry gets a one-line text). The first time an
   updated app starts it shows "What's new in 1.0.4" once, with a link to this entry, but only an app that already has the
   notice does: 1.3.0 is the first version with it and only remembers its own version, so a 1.2.0 install updated to 1.3.0
   sees nothing, and the notice first appears at the update after that.
3. Run `npm run release:desktop -- 1.0.4`. It writes the version into three files – `desktop/package.json`,
   `desktop/package-lock.json` and `src/lib/desktop/release.ts` – and prints three git lines. Add the changelog files to the first one:

   ```
   git add desktop/package.json desktop/package-lock.json src/lib/desktop/release.ts src/content/changelog.json CHANGELOG.md
   git commit -m "Windows app 1.0.4"
   git push
   ```

4. Watch Actions → "Windows app" (8–15 minutes). When it is green, <https://github.com/CronusAztec/jumpingballslive-windows/releases/latest> serves the
   installer, the portable EXE, `SHA256SUMS.txt` (checksums) and `latest.yml` (what installed apps read), and GitHub →
   Releases in this repository keeps `desktop-v1.0.4` as the archive (its notes list the changes since the last release by themselves). The
   same push deploys the website, whose download page then names the new version.

When the release comes in a pull request, do not merge until the pull request's **Windows app** check is green (on a pull
request that workflow builds, tests, packages and smoke-runs the app; it publishes nothing). The website deploys within about ten
minutes of the merge, on its own and without waiting for the Windows job, and from then on the download page, the press page and the
changelog already name the new version. After the merge watch Actions → "Windows app" and the `version:` line of
<https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/latest.yml>: it must show the new version. On a
red run fix forward as the next patch version (1.3.0 → 1.3.1) with the same notes; re-running the failed run repairs a transient failure.

Check the release on a PC after installing it: the title bar reads `JumpingBallsLive 1.0.4` (with `· portable` for the portable EXE),
**Help → About** names the app version, whether it is the installer or the portable EXE and the website build inside it (its
version and commit are the website's own, see "Which build is live?" above), **Copy details** puts those lines on the clipboard
for a support message, and **Help → What's new** opens the changelog. The release job's smoke run already fails when the app's
site has no `version.json`.

What your users see: the installed app checks 8 seconds after it starts and then every 4 hours. It downloads the update in
the background, shows a Windows notification and a banner with **Restart and update** and **Later**, and installs it when
they click Restart or when they close the app. It never interrupts a render: Restart waits until the render queue is done.

- People on **1.0.2** must install the new version once by hand (its updater refuses unsigned updates). The download page
  and the release notes say so.
- The **portable EXE** never updates itself; people download the new one from the download page.
- Apps older than **1.1.0** look for updates in this repository's GitHub Releases, not in the downloads repository: they only find a release while
  the repository is public ("Making the repository private").

## Ship a Worker change

The same push: commit the change in `billing/` and push it. Before anything is deployed the workflow checks that

- the secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist,
- `billing/wrangler.toml` holds your real KV id (not the placeholder),
- your custom domain (when `CUSTOM_DOMAIN` is set) is listed in `SITE_ORIGIN` in `billing/wrangler.toml`.

If one is missing, the run stops with a message that says what to do, and the Worker that is live keeps running. After the
deploy it asks the live Worker for `/health` (or `/config`) and prints the answer – no secrets are in it.

Automatic deploys are off until you switch them on: run Actions → "Deploy billing worker" → **Run workflow** once by hand,
and when that worked, add the repository variable `BILLING_AUTODEPLOY` with the value `1`.

## Reading the Actions tab

- **Green** – it worked and is published.
- **Red** – something failed and nothing was published. Open the run, click the red job, then the red step: its last lines
  say what went wrong. Fix it and push again, or press **Re-run failed jobs** when it looks like a hiccup (a network
  timeout, for example).
- **Grey** – skipped or cancelled. A newer push cancels the older run of the website on purpose; a Windows release is
  never cancelled.
- **Is it really live?** A green run and the commit named in <https://jumpingballslive.com/version.json> are the proof. If the
  run is green but `version.json` still names an older commit, the domain is serving another deployment (see "Roll back").

The browser test saves screenshots: open the run, scroll to **Artifacts** and download `smoke-screenshots` (kept for one day: a private
repository has a small storage quota for Actions artifacts, and a full quota only costs the screenshots, not the result of the run).
If a run fails with "Artifact storage quota has been hit", old artifacts fill it: GitHub → the repository → **Actions** → open an old
run → delete its artifacts (or the run itself); GitHub recalculates the usage every 6 to 12 hours.

## Roll back

- **Website**: GitHub → the commit → **Revert**, then push the revert (or merge it). About 25 minutes later the old site
  is back. Faster: Cloudflare dashboard → Workers & Pages → `jumpingballslive` → **Deployments** → the previous one →
  **Rollback** (instant; the next push deploys the repository's state again). Afterwards `version.json` names the build that
  is live again, so check it: after a dashboard rollback it shows the earlier commit, after a revert it shows the revert commit
  (with the version `package.json` holds at that commit).
- **Worker**: revert the commit and push, or Cloudflare dashboard → Workers & Pages → the Worker → **Deployments** →
  **Rollback** (instant).
- **Windows app**: apps that already installed the bad version keep it until you publish a higher one, so the real fix is
  the next version (`npm run release:desktop -- 1.0.5`). To stop new downloads and updates at once: open the downloads repository
  (`CronusAztec/jumpingballslive-windows`) → Releases → the bad release → **Edit** → untick "Set as the latest release" and
  tick the previous release's (or delete the bad one). The download buttons and update checks then serve the previous
  release. The release in this repository can stay as the archive.

## Your own domain

The site is served at `jumpingballslive.com` and `www.jumpingballslive.com`, both attached to the Cloudflare Worker
`jumpingballslive` (`wrangler.toml` at the repository root). To serve it from another domain that is on your Cloudflare
account: add the address to `SITE_ORIGIN` in `billing/wrangler.toml` and deploy the Worker first (checkouts from an unlisted
address are refused), change the two `routes` in `wrangler.toml`, set the repository variable `CUSTOM_DOMAIN`, push, and
add the address to the publish relay's `RELAY_ALLOWED_ORIGINS`. [GO-LIVE.md](GO-LIVE.md), section 2, lists the steps.

## Hosting

| What | Where | Paid by |
| --- | --- | --- |
| The code, the builds | GitHub (a private repository and Actions) | free: 2,000 Actions minutes a month |
| The website | a Cloudflare Worker with static assets | free plan |
| The payment server | a Cloudflare Worker + KV | Workers Paid, $5 a month |
| The Windows app's downloads and updates | the Releases of a second, public GitHub repository (`jumpingballslive-windows`, installers only, no source code) | free |
| The publish relay (accounts, TikTok / Instagram / YouTube connections) | your own server, `relay.jumpingballslive.com` | the server |

**Actions minutes.** A private repository on the free GitHub plan has 2,000 minutes a month (GitHub Pro: 3,000). A website
deploy takes about 60, a Windows release about 25 (Windows minutes count double), a push to another branch about 3, and the
daily viral-video bot (`bot.yml`) about 6 – that is about 180 a month. Settings → Billing and plans shows the use. When the
minutes run out nothing deploys until the next month; take GitHub Pro or switch the bot to manual runs.

The website's code people can see is scrambled (obfuscated), and every secret (payment keys, the licence signing key) lives
in the Cloudflare Worker, not in the repository.

## The downloads repository

The installers and the update feed live in the Releases of a second GitHub repository that is **public** and holds nothing
else – no source code – so this repository can be private. The site's Download buttons and every installed app read
`https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/<file>`. Nothing depends on Cloudflare R2
or on this repository being public. One-time setup:

1. Create the repository `jumpingballslive-windows` under the same GitHub account: **Public**, with a README (a release needs
   a first commit to point at; the README should only say what the app is and link the website). Done once.
2. Create a token that can publish there and nowhere else: GitHub → your avatar → Settings → Developer settings →
   Personal access tokens → **Fine-grained tokens** → Generate new token → Resource owner: your account → Repository access:
   **Only select repositories** → `jumpingballslive-windows` → Permissions → Repository permissions → **Contents: Read and
   write** → generate and copy it. Choose the longest expiry offered; a release fails with a plain message when it has expired.
3. In this repository: Settings → Secrets and variables → Actions → **New repository secret** → name `DOWNLOADS_REPO_TOKEN`,
   value the token.
4. Release the Windows app ("Release the Windows app" above), or run **Actions → "Windows app" → Run workflow** with **publish**
   ticked. When it is green, <https://github.com/CronusAztec/jumpingballslive-windows/releases/latest/download/latest.yml>
   names the version and the website's download buttons work.

The release job stops with a plain message if the token is missing, creates the release as a draft with every file and
publishes it in one step (an installed app that asks in between still sees the previous release), and publishes nothing – no
release in this repository either – when that fails, so a re-run starts clean. GitHub accepts release files up to 2 GiB:
the installers are 150 MB, and the CUDA build (`DESKTOP_CUDA=1`, about 180 MB more) fits too.

Please keep this repository's name (`CronusAztec/jumpingballslive-windows`): it is built into every installed app's update
address and cannot be changed for apps that are already installed (GitHub redirects a renamed repository, but do not rely on
it). The repository variable `DOWNLOADS_REPO` only changes where new builds publish.

## Making the repository private

Everything a visitor or an installed app needs is on Cloudflare or in the downloads repository, with one exception: **apps older than 1.1.0** look for
updates in GitHub Releases, which a private repository hides. In this order:

1. Do "The downloads repository" above and release the Windows app once. That release is the bridge: older apps find it in this
   repository's GitHub Releases (still public) and install it, and from then on every app looks at the downloads repository.
2. Wait. An app checks 8 seconds after it starts and every 4 hours, so anyone who opens it in the next days is updated.
   Whoever opens an old app only after the switch stays on the old version and must download the new one from the website
   once. About two weeks is a fair wait.
3. Set the repository variable `FEEDBACK_EMAIL` (or `FEEDBACK_ENDPOINT` / `SUPPORT_EMAIL`): the feedback form can no longer
   open a GitHub issue for visitors.
4. If the website is deployed by the VPS deployer (`deploy/vps/`), give it its read-only token **first**: follow `deploy/vps/README.md`,
   "When the repository is private" (the token is a fine-grained one for this repository with Contents and Actions read-only; GitHub's
   token form has no Checks permission, the deployer reads the `build` job of the site workflow through the Actions API; the server then
   pulls with the token and runs `sudo bash deploy/vps/install.sh --private`). It reads the code anonymously until then, so it stops
   deploying the moment the repository is private without it.
5. Settings → General → Danger zone → **Change visibility** → **Make private**.
6. If the publish relay runs on your own server and was installed from this repository, its `git pull` needs a credential
   from then on – see `relay/README.md`, "A private repository".
7. Actions minutes: a private repository has 2,000 free a month, and one pull request runs the whole browser test (about an hour of
   runner time), one Windows release about 25 (Windows counts double). See "Hosting" above; deploying from the VPS does not use them.

## Code signing (optional)

Today the installer is not signed, so Windows SmartScreen shows "Windows protected your PC" until the user clicks
**More info → Run anyway** (the download page explains this). To sign it, add the secrets `WIN_CSC_LINK` (the .pfx
certificate as base64) and `WIN_CSC_KEY_PASSWORD`; the next release is signed. **Once you sign, never remove them**:
signed installs refuse unsigned updates.

An OV certificate (about $200–400 a year) still shows the warning until the file earns reputation, while an EV certificate
(about $300–500 a year) or Azure Trusted Signing (about $10 a month, needs a verified identity) removes it from the first
download. Without users yet the unsigned build is fine; signing is worth it once paying users arrive.

## Variables and secrets

Set them under GitHub → Settings → Secrets and variables → Actions (the **Variables** tab or the **Secrets** tab).

| Name | Kind | What it does |
| --- | --- | --- |
| `CUSTOM_DOMAIN` | variable | the site's domain without `https://`; empty: `jumpingballslive.com` |
| `BILLING_AUTODEPLOY` | variable | `1` deploys the payment Worker on every push that changes `billing/` |
| `BILLING_API_URL` | variable | the Worker's address (`https://….workers.dev`); empty: the live one built into the workflows |
| `LICENSE_PUBLIC_KEY` | variable | the public half of the licence key; empty: the live one built into the workflows |
| `DOWNLOADS_REPO` | variable | the public repository new Windows releases are published to; empty: `CronusAztec/jumpingballslive-windows` |
| `DOWNLOADS_URL` | variable | where the site links and the app updates from; empty: that repository's `releases/latest/download` |
| `DESKTOP_CUDA` | variable | `1` packs the NVIDIA (CUDA) build of the local AI into automatic releases (about 180 MB more) |
| `FEEDBACK_ENDPOINT`, `FEEDBACK_EMAIL` | variables | where the feedback form sends messages (with the repository private, set one of them or `SUPPORT_EMAIL`) |
| `ANALYTICS_SCRIPT_URL`, `ANALYTICS_SITE_ID` | variables | the visitor statistics script, if you use one |
| `YOUTUBE_CLIENT_ID` | variable | the Google sign-in for direct YouTube uploads from the Publish block |
| `PUBLISH_RELAY_URL` | variable | the publish relay the Account page and the Publish block use; empty: `https://relay.jumpingballslive.com` |
| `CLOUDFLARE_API_TOKEN` | secret | deploys the website and the Worker; needs "Edit Cloudflare Workers" (with the zone permissions for custom domains) and "Workers KV Storage: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | secret | your Cloudflare account id (Workers & Pages → right-hand column) |
| `DOWNLOADS_REPO_TOKEN` | secret | a fine-grained token with Contents: Read and write on the downloads repository only; publishes the Windows app |
| `WIN_CSC_LINK` | secret | the code-signing certificate (.pfx as base64) |
| `WIN_CSC_KEY_PASSWORD` | secret | its password |
