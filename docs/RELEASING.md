# Releasing: one push updates everything

This page is for the owner. It explains what happens after you push a change, how to release a new version of the
Windows app, and how to undo a bad release. The full launch checklist (payments, legal pages, the domain) is in
[GO-LIVE.md](GO-LIVE.md).

The **product branch** is `claude/optimistic-johnson-46x3qg`. If you rename it to `main` in GitHub (Settings → Branches),
everything keeps working: both names are listed in the workflows. Other branches are only built and checked; they never
publish anything, not even when someone presses "Run workflow" on them.

## What updates when

| What | When it updates | How long | Where to watch |
| --- | --- | --- | --- |
| Website | every push to the product branch | about 25 min | Actions → "Build and deploy to GitHub Pages" |
| Payment Worker (Cloudflare) | a push that changes `billing/`, once the variable `BILLING_AUTODEPLOY` is `1` (the first deploy is by hand) | about 2 min, then a health check | Actions → "Deploy billing worker" |
| Windows app | a push that changes the version in `desktop/package.json` | 6–10 min to the release; installed apps update within 4 hours or at their next start | Actions → "Windows app", then GitHub → Releases |

## Ship a website change

1. Edit the files (or ask your developer to).
2. `git add <the files>`
3. `git commit -m "Say what changed"`
4. `git push`

The Actions tab then shows the run: the checks and the build take about 6 minutes, the browser test runs on four machines
at once for about 12–15 minutes, and the deploy takes a minute. **A red run publishes nothing**: the site that is live
stays as it was.

## Release the Windows app

1. Pick the next version. It must always be higher than the last one: 1.0.3 → 1.0.4 → 1.0.5 … Raise the second number
   for bigger changes (1.0.9 → 1.1.0).
2. Run `npm run release:desktop -- 1.0.4`. It writes the version into three files – `desktop/package.json`,
   `desktop/package-lock.json` and `src/lib/desktop/release.ts` – and prints three git lines.
3. Run the three lines it printed:

   ```
   git add desktop/package.json desktop/package-lock.json src/lib/desktop/release.ts
   git commit -m "Windows app 1.0.4"
   git push
   ```

4. Watch Actions → "Windows app" (6–10 minutes). When it is green, GitHub → Releases shows `desktop-v1.0.4` with the
   installer, the portable EXE, `SHA256SUMS.txt` (checksums) and `latest.yml` (what installed apps read). The release
   notes list the changes since the last release by themselves.

What your users see: the installed app checks 8 seconds after it starts and then every 4 hours. It downloads the update in
the background, shows a Windows notification and a banner with **Restart and update** and **Later**, and installs it when
they click Restart or when they close the app. It never interrupts a render: Restart waits until the render queue is done.

- People on **1.0.2** must install the new version once by hand (its updater refuses unsigned updates). The download page
  and the release notes say so.
- The **portable EXE** never updates itself; people download the new one from the download page.
- The download page shows the newest version without a rebuild of the website.

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
  is back.
- **Worker**: revert the commit and push, or Cloudflare dashboard → Workers & Pages → the Worker → **Deployments** →
  **Rollback** (instant).
- **Windows app**: GitHub → Releases → the bad release → **Delete**, then Tags → delete `desktop-v<version>`. New downloads
  get the previous version again. Apps that already installed the bad version keep it until you publish a higher one, so
  the real fix is the next version (`npm run release:desktop -- 1.0.5`).

## Your own domain

1. Buy the name (for example `jumpingballs.live`) at a registrar. In its DNS settings add, for the bare name (`@`):
   - four **A** records: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - four **AAAA** records: `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`, `2606:50c0:8003::153`
   - and one **CNAME** record `www` → `cronusaztec.github.io`
2. GitHub → Settings → Pages → **Custom domain** → type the bare name → **Save**. When the DNS check is green (minutes to an
   hour; new records can take 24–48 hours), tick **Enforce HTTPS**.
3. Settings → Secrets and variables → Actions → Variables → add `CUSTOM_DOMAIN` = `jumpingballs.live`. The next push
   builds the site for the new address, and the next Windows release uses it for its links.
4. Add `https://jumpingballs.live` (and the `www` address if you use it) to `SITE_ORIGIN` in `billing/wrangler.toml`,
   commit, push, and deploy the Worker. Until then the Worker deploy stops and the website run warns you.
5. If you run the publish relay, add the new address to its `RELAY_ALLOWED_ORIGINS`.
6. Protect the name: your profile → Settings → Pages → **Verified domains** → add it.

## Hosting

**The repository stays public.** The Windows app is downloaded from GitHub Releases and checks GitHub Releases for
updates; both only work without a login when the repository is public. The website code people can see is scrambled
(obfuscated), and every secret (payment keys, the licence signing key) lives in the Cloudflare Worker, not in the
repository. If you ever want the source private, the releases would first have to move to a separate public repository –
ask a developer.

GitHub Pages is free for a public repository (a private one needs GitHub Pro, $4/month). You can host the website on
**Cloudflare Pages** instead, from the same Cloudflare account as the Worker: create the project once with
`npx wrangler pages project create <name> --production-branch main`, set the variables `SITE_HOST` = `cloudflare-pages`
and `CF_PAGES_PROJECT` = `<name>`, and make sure the secrets `CLOUDFLARE_API_TOKEN` (with "Cloudflare Pages: Edit") and
`CLOUDFLARE_ACCOUNT_ID` exist. This changes only where the website lives; the Windows app still comes from GitHub
Releases, so the repository still stays public.

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
| `CUSTOM_DOMAIN` | variable | your domain without `https://` (e.g. `jumpingballs.live`); empty: `cronusaztec.github.io/Balls` |
| `SITE_HOST` | variable | `cloudflare-pages` publishes the website to Cloudflare Pages; empty: GitHub Pages |
| `CF_PAGES_PROJECT` | variable | the Cloudflare Pages project name (only with `SITE_HOST`) |
| `BILLING_AUTODEPLOY` | variable | `1` deploys the payment Worker on every push that changes `billing/` |
| `BILLING_API_URL` | variable | the Worker's address (`https://….workers.dev`); the site, the app and the health check use it |
| `LICENSE_PUBLIC_KEY` | variable | the public half of the licence key; empty: the site and the app run in test mode |
| `DESKTOP_CUDA` | variable | `1` packs the NVIDIA (CUDA) build of the local AI into automatic releases (about 180 MB more) |
| `FEEDBACK_ENDPOINT`, `FEEDBACK_EMAIL` | variables | where the feedback form sends messages |
| `ANALYTICS_SCRIPT_URL`, `ANALYTICS_SITE_ID` | variables | the visitor statistics script, if you use one |
| `YOUTUBE_CLIENT_ID` | variable | the Google sign-in for direct YouTube uploads from the Publish block |
| `PUBLISH_RELAY_URL` | variable | the publish relay the Publish block suggests |
| `CLOUDFLARE_API_TOKEN` | secret | deploys the Worker (and Cloudflare Pages); needs "Edit Cloudflare Workers" and "Workers KV Storage: Edit" |
| `CLOUDFLARE_ACCOUNT_ID` | secret | your Cloudflare account id (Workers & Pages → right-hand column) |
| `WIN_CSC_LINK` | secret | the code-signing certificate (.pfx as base64) |
| `WIN_CSC_KEY_PASSWORD` | secret | its password |
