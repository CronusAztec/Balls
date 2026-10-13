# Releasing: one push updates everything

This page is for the owner. It explains what happens after you push a change, how to release a new version of the
Windows app, and how to undo a bad release. The full launch checklist (payments, legal pages, the domain) is in
[GO-LIVE.md](GO-LIVE.md).

GitHub only keeps the code and runs the builds: the website is served by Cloudflare, the Windows app's downloads and updates
by Cloudflare too (the downloads host), so the repository can be private ("Making the repository private" below).

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
| Windows app | a push that changes the version in `desktop/package.json` | 8–15 min to the release; installed apps update within 4 hours or at their next start | Actions → "Windows app", then <https://downloads.jumpingballslive.com/latest.yml> |

## Ship a website change

1. Edit the files (or ask your developer to).
2. `git add <the files>`
3. `git commit -m "Say what changed"`
4. `git push`

The Actions tab then shows the run: the checks and the build take about 6 minutes, the browser test runs on four machines
at once for about 12–15 minutes, and the deploy takes a minute or two; the last step asks jumpingballslive.com which build
it serves and fails if it is not this one. **A red run publishes nothing**: the site that is live stays as it was.

## Release the Windows app

1. Pick the next version. It must always be higher than the last one: 1.0.3 → 1.0.4 → 1.0.5 … Raise the second number
   for bigger changes (1.0.9 → 1.1.0). Three plain numbers only: a version like 1.0.4-rc.1 is refused (the website and the
   download page only show x.y.z releases).
2. Run `npm run release:desktop -- 1.0.4`. It writes the version into three files – `desktop/package.json`,
   `desktop/package-lock.json` and `src/lib/desktop/release.ts` – and prints three git lines.
3. Run the three lines it printed:

   ```
   git add desktop/package.json desktop/package-lock.json src/lib/desktop/release.ts
   git commit -m "Windows app 1.0.4"
   git push
   ```

4. Watch Actions → "Windows app" (8–15 minutes). When it is green, <https://downloads.jumpingballslive.com> serves the
   installer, the portable EXE, `SHA256SUMS.txt` (checksums) and `latest.yml` (what installed apps read), and GitHub →
   Releases keeps `desktop-v1.0.4` as the archive (its notes list the changes since the last release by themselves). The
   same push deploys the website, whose download page then names the new version.

What your users see: the installed app checks 8 seconds after it starts and then every 4 hours. It downloads the update in
the background, shows a Windows notification and a banner with **Restart and update** and **Later**, and installs it when
they click Restart or when they close the app. It never interrupts a render: Restart waits until the render queue is done.

- People on **1.0.2** must install the new version once by hand (its updater refuses unsigned updates). The download page
  and the release notes say so.
- The **portable EXE** never updates itself; people download the new one from the download page.
- Apps older than **1.1.0** look for updates in GitHub Releases, not on the downloads host: they only find a release while
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

The browser test saves screenshots: open the run, scroll to **Artifacts** and download `smoke-screenshots`.

## Roll back

- **Website**: GitHub → the commit → **Revert**, then push the revert (or merge it). About 25 minutes later the old site
  is back. Faster: Cloudflare dashboard → Workers & Pages → `jumpingballslive` → **Deployments** → the previous one →
  **Rollback** (instant; the next push deploys the repository's state again).
- **Worker**: revert the commit and push, or Cloudflare dashboard → Workers & Pages → the Worker → **Deployments** →
  **Rollback** (instant).
- **Windows app**: apps that already installed the bad version keep it until you publish a higher one, so the real fix is
  the next version (`npm run release:desktop -- 1.0.5`). To stop new downloads and updates at once: Cloudflare dashboard →
  R2 → the bucket → delete `latest.yml`, `JumpingBallsLive-Setup.exe` and `JumpingBallsLive-portable.exe` (the download
  buttons and update checks then fail until the fixed release is published). The GitHub release can stay as the archive.

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
| The Windows app's downloads and updates | a Cloudflare R2 bucket at `downloads.jumpingballslive.com` | free up to 10 GB |
| The publish relay (accounts, TikTok / Instagram / YouTube connections) | your own server, `relay.jumpingballslive.com` | the server |

**Actions minutes.** A private repository on the free GitHub plan has 2,000 minutes a month (GitHub Pro: 3,000). A website
deploy takes about 60, a Windows release about 25 (Windows minutes count double), a push to another branch about 3, and the
daily viral-video bot (`bot.yml`) about 6 – that is about 180 a month. Settings → Billing and plans shows the use. When the
minutes run out nothing deploys until the next month; take GitHub Pro or switch the bot to manual runs.

The website's code people can see is scrambled (obfuscated), and every secret (payment keys, the licence signing key) lives
in the Cloudflare Worker, not in the repository.

## The downloads host

The installers and the update feed live in a Cloudflare R2 bucket that `downloads.jumpingballslive.com` serves, so nothing
depends on GitHub. One-time setup, in the Cloudflare dashboard (the account that has `jumpingballslive.com`):

1. **R2 object storage** → enable R2 (Cloudflare may ask for a payment method first; the free allowance is 10 GB of
   storage, a million uploads and ten million downloads a month, and downloads cost nothing – a release uses about 0.6 GB,
   so about fifteen releases fit before the first cent).
2. **Create bucket** → name it `jumpingballslive-downloads` (another name works if you set the repository variable
   `R2_BUCKET` to it).
3. Open the bucket (R2 object storage → Overview → the bucket) → **Settings → Custom Domains → Add** →
   `downloads.jumpingballslive.com` → **Continue** → **Connect Domain** (Cloudflare creates the DNS record itself because the
   domain is on your account). Wait until its status says **Active** (a few minutes; **Retry connection** if it sticks).
4. **My Profile → API Tokens** → the token behind the repository secret `CLOUDFLARE_API_TOKEN` → **Edit** → add the
   permission **Account → Workers R2 Storage → Edit** → save. The token's value does not change; no secret needs updating.
5. Release the Windows app ("Release the Windows app" above), or run **Actions → "Windows app" → Run workflow** with **publish** ticked.
   When it is green, <https://downloads.jumpingballslive.com/latest.yml> names the version and the website's download
   buttons work.

The release job stops with a plain message if the two Cloudflare secrets are missing, and publishes nothing – no GitHub
release either – when the upload fails, so a re-run starts clean. wrangler uploads at most 300 MiB per file: the installers
are 150 MB; the CUDA build (`DESKTOP_CUDA=1`, about 180 MB more) would not fit.

## Making the repository private

Everything a visitor or an installed app needs is on Cloudflare, with one exception: **apps older than 1.1.0** look for
updates in GitHub Releases, which a private repository hides. In this order:

1. Do "The downloads host" above and release the Windows app once. That release is the bridge: older apps find it in GitHub
   Releases (the repository is still public) and install it, and from then on every app looks at the downloads host.
2. Wait. An app checks 8 seconds after it starts and every 4 hours, so anyone who opens it in the next days is updated.
   Whoever opens an old app only after the switch stays on the old version and must download the new one from the website
   once. About two weeks is a fair wait.
3. Set the repository variable `FEEDBACK_EMAIL` (or `FEEDBACK_ENDPOINT` / `SUPPORT_EMAIL`): the feedback form can no longer
   open a GitHub issue for visitors.
4. Settings → General → Danger zone → **Change visibility** → **Make private**.
5. If the publish relay runs on your own server and was installed from this repository, its `git pull` needs a credential
   from then on – see `relay/README.md`, "A private repository".

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
| `DOWNLOADS_URL` | variable | where the Windows app is downloaded and updated from; empty: `https://downloads.jumpingballslive.com` |
| `R2_BUCKET` | variable | the R2 bucket behind it; empty: `jumpingballslive-downloads` |
| `DESKTOP_CUDA` | variable | `1` packs the NVIDIA (CUDA) build of the local AI into automatic releases (about 180 MB more – too big for the upload today) |
| `FEEDBACK_ENDPOINT`, `FEEDBACK_EMAIL` | variables | where the feedback form sends messages (with the repository private, set one of them or `SUPPORT_EMAIL`) |
| `ANALYTICS_SCRIPT_URL`, `ANALYTICS_SITE_ID` | variables | the visitor statistics script, if you use one |
| `YOUTUBE_CLIENT_ID` | variable | the Google sign-in for direct YouTube uploads from the Publish block |
| `PUBLISH_RELAY_URL` | variable | the publish relay the Account page and the Publish block use; empty: `https://relay.jumpingballslive.com` |
| `CLOUDFLARE_API_TOKEN` | secret | deploys the website and the Worker and uploads the Windows app; needs "Edit Cloudflare Workers" (with the zone permissions for custom domains), "Workers KV Storage: Edit" and "Workers R2 Storage: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | secret | your Cloudflare account id (Workers & Pages → right-hand column) |
| `WIN_CSC_LINK` | secret | the code-signing certificate (.pfx as base64) |
| `WIN_CSC_KEY_PASSWORD` | secret | its password |
