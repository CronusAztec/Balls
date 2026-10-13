# JumpingBallsLive publish relay

A small, self-hosted server that lets the simulator's **Publish** block (Recording section) and the viral bot's CLI post
clips to **TikTok**, **Instagram** and **YouTube** accounts – several per platform, for several people.

The site itself is a static export on Cloudflare: it cannot keep an app secret, and it cannot give Instagram or TikTok a
public URL to download a clip from. The relay does exactly those two things and nothing else:

- it holds the **app secrets** (TikTok client secret, Meta app secret, Google client secret) in its environment and runs
  the OAuth sign-ins;
- it keeps the connected accounts and their **refresh tokens** in a JSON file on its own disk – a token never goes back
  to a browser;
- it takes an uploaded clip, serves it at a **public, unguessable URL** for 24 hours and publishes it to every account you
  chose, reporting per account (status, progress, link, a clear error);
- **access keys**: the admin creates one key per person; every key sees only the accounts it connected, so a team – or a
  few creators – share one relay, each with their own TikTok / Instagram / YouTube accounts.

It is one file (`server.mjs`), Node 22, no dependencies, no framework, and it is **not** part of the site's build.

> YouTube also works **without** the relay: the Publish block can upload straight from the browser with a Google OAuth
> client ID (see the main README, “Publish”). The relay's YouTube path is for keeping channels signed in for months
> (refresh tokens) and for the bot CLI.

## Run it

```bash
cp relay/.env.example relay/.env      # fill in the values (see below)
node relay/server.mjs                 # listens on PORT (8787), data in RELAY_DATA_DIR (./relay-data)
node relay/server.mjs create-key "Alice"   # an access key without the HTTP API (prints it once)
```

Locally the site (`npm run dev` / `npm start`) talks to `http://localhost:8787` if `RELAY_ALLOWED_ORIGINS` contains
`http://localhost:3000`. The platforms, however, need to reach the relay: the OAuth redirect URIs and the clip URLs must be
public HTTPS, so for real posting deploy it (or put a tunnel such as `cloudflared tunnel --url http://localhost:8787` in
front and use that URL as `RELAY_PUBLIC_URL`).

### Deploy on Render (free tier)

1. Fork / push this repository to GitHub, then on [render.com](https://render.com) → **New → Web Service** → pick the
   repository.
2. **Root Directory** `relay`, **Runtime** Node, **Build Command** `npm install` (there is nothing to install), **Start
   Command** `node server.mjs`.
3. **Environment**: the variables of `.env.example` – at least `RELAY_PUBLIC_URL` (the `https://<name>.onrender.com`
   address Render gives you), `RELAY_ALLOWED_ORIGINS` (`https://jumpingballslive.com,https://www.jumpingballslive.com` for this repository's site),
   `RELAY_CLIENT_IP_HEADER=CF-Connecting-IP` (so the sign-up limits count visitors, not Render's proxy), `RELAY_ADMIN_KEY`
   (optional: only for access keys) and the app keys of the platforms you want.
4. Keys and accounts live in `RELAY_DATA_DIR`: on the free tier the disk is wiped on every deploy / restart, so add a
   **Persistent Disk** (a paid add-on) mounted at e.g. `/var/data` and set `RELAY_DATA_DIR=/var/data`, or reconnect after a
   restart. Free instances also sleep when idle – the first request after a pause takes ~30 s (it just waits).

### Fly.io, Railway or any Docker host

`relay/Dockerfile` builds a tiny image (`node:22-alpine`, the data in the `/data` volume):

```bash
cd relay
fly launch --no-deploy            # or: docker build -t jbl-relay .
fly volumes create relay_data --size 1
# fly.toml: [mounts] source = "relay_data", destination = "/data"   and   [http_service] internal_port = 8787
fly secrets set RELAY_PUBLIC_URL=https://<app>.fly.dev RELAY_ALLOWED_ORIGINS=https://jumpingballslive.com,https://www.jumpingballslive.com RELAY_ADMIN_KEY=… TIKTOK_CLIENT_KEY=… …
fly deploy
```

On Railway: **New Project → Deploy from GitHub repo**, set the service's root directory to `relay`, add a volume mounted at
`/data`, and the same variables (Railway sets `PORT`).

### Your own VPS (Docker + Caddy)

A VPS is the simplest home for the relay when accounts matter: it has a real disk (nothing is wiped on a restart), never
sleeps and costs a few dollars a month whatever the traffic. `relay/deploy/` is a kit for it: Docker Compose runs the relay and
[Caddy](https://caddyserver.com), which fetches and renews the HTTPS certificate by itself. You need a Debian or Ubuntu
server (1 GB of memory is plenty) that you can log in to as root over SSH or through the provider's web console, a name for the
relay (for example `relay.jumpingballslive.com`) and ports 80 and 443 free.

1. **DNS**: add an **A record** for that name pointing at the server's IP address. In Cloudflare set it to **DNS only** (the
   grey cloud): behind the orange cloud every visitor would reach Caddy as a Cloudflare address and the sign-up limits would
   count them all as one.
2. **Run the installer on the server**, once:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/CronusAztec/Balls/BRANCH/relay/deploy/install.sh | sudo bash -s -- relay.example.com --branch BRANCH
   ```

   `BRANCH` is the branch with the kit (the product branch once the kit is merged). Read the script first if you like: it is
   [`relay/deploy/install.sh`](deploy/install.sh), a few hundred lines with a comment on every step. It installs Docker and git if they are missing, puts the
   code in `/opt/jumpingballslive`, writes `relay/deploy/.env` (the domain, `RELAY_PUBLIC_URL` and `RELAY_ALLOWED_ORIGINS`,
   which defaults to this project's two site addresses; `--origins https://a.example,https://b.example` changes them),
   opens ports 80 and 443 when `ufw` is already on, starts the relay and Caddy, waits until the relay answers on HTTPS and
   installs a nightly backup. It checks everything before it changes anything and stops with a plain message when something is
   off (another program on port 80, a wrong DNS record, another operating system).
3. **Check it**: `https://relay.example.com/api/health` answers with `{"ok":true,…}`.
4. **Platform keys**: register the TikTok, Meta and Google apps with the redirect URIs
   `https://relay.example.com/oauth/<platform>/callback` (see below), put their keys into `/opt/jumpingballslive/relay/deploy/.env`
   (the `.env.example` beside it lists the names) and run `docker compose up -d` in that folder.

**A server that already has a web server on ports 80 and 443.** The installer stops with a message instead of breaking it. If
the program is a **Caddy** (the message says so), run the same command again with `--use-existing-caddy`: it does **not** start
a second Caddy. The relay runs on its own, on `127.0.0.1:8787` where nothing outside the server can reach it, and the relay's
domain is added to your Caddy's Caddyfile as one more site (`relay.example.com { reverse_proxy 127.0.0.1:8787 }`). It is built
for a server that serves other things, so before it touches your Caddy it checks the config with `caddy validate`, saves a copy
next to it (`Caddyfile.bak.pre-jbl-relay.<time>`), reloads Caddy gracefully (no downtime), asks every other site in the Caddyfile
for its home page before and after, and puts the Caddyfile back and reloads again if the check fails, the reload fails or any
other site answers differently. It waits to do any of this until the domain's A record points at the server (your Caddy would
start asking Let's Encrypt for a certificate at once), so add the record first or run the command a second time; a Caddy
configured with JSON instead of a Caddyfile is left alone with instructions (`--caddyfile PATH` names a Caddyfile that is not in
the usual place). For nginx, Apache or anything else on the ports, run only the relay (`docker compose up -d` in `relay/deploy`
without `COMPOSE_PROFILES=caddy` in `.env`) and pass your domain to `127.0.0.1:8787` with that server's own proxy settings:
let it set `X-Forwarded-For` to the visitor's address (nginx: `proxy_set_header X-Forwarded-For $remote_addr;`), because the
relay counts sign-ups by that.

**A private repository.** The one-liner above downloads the installer from GitHub, which only works while the repository is
public. Once it is private, the server needs a read-only key of its own (a *deploy key*: it can read this one repository and
nothing else):

1. On the server: `ssh-keygen -t ed25519 -N "" -C jbl-relay-deploy -f /root/.ssh/jbl_deploy` (the file is created readable by
   root only) and `cat /root/.ssh/jbl_deploy.pub`.
2. In GitHub: the repository → **Settings → Deploy keys → Add deploy key** → paste the line from step 1, leave **Allow write
   access** off.
3. Run the installer **from the checkout it made earlier** (no download needed) and tell it where to get the code:

   ```bash
   bash /opt/jumpingballslive/relay/deploy/install.sh relay.example.com --repo git@github.com:OWNER/REPO.git --deploy-key /root/.ssh/jbl_deploy
   ```

   It points the checkout's `origin` at that address, uses the key for its git commands only (the first connection accepts
   GitHub's host key), updates the code and restarts the relay; `.env` and the data stay as they are. Later updates are the
   same command. On a server with no checkout yet, clone the repository once with the same key
   (`GIT_SSH_COMMAND="ssh -i /root/.ssh/jbl_deploy -o IdentitiesOnly=yes" git clone git@github.com:OWNER/REPO.git /opt/jumpingballslive`)
   and run the installer from it. If you shared a Caddy before, add `--use-existing-caddy` as before.

After the site moved to `jumpingballslive.com`, the `.env` of an older install may still list `https://cronusaztec.github.io` in
`RELAY_ALLOWED_ORIGINS`; take it out (and run `docker compose up -d` in `relay/deploy`) when you no longer use that address.

Day to day, from `/opt/jumpingballslive/relay/deploy`: `docker compose logs -f` shows the logs, `docker compose restart` restarts,
and running the installer command again **updates** (it fetches the branch and rebuilds; your `.env` and data are kept).
The data (accounts, their tokens, uploaded clips) is the folder `relay/deploy/data`; the nightly backup
(`/var/backups/jbl-relay`, 14 days, readable by root only) tars it, and a backup holds every account's tokens, so copy it
somewhere private and never publish it. To restore: `docker compose down`, unpack the archive over `relay/deploy`, `docker compose up -d`.
To remove everything: `docker compose down -v`, then delete `/opt/jumpingballslive` and `/etc/cron.d/jbl-relay-backup`.

Good practice for the server itself: log in with an SSH key and turn password logins off, keep it updated
(`unattended-upgrades` on Debian and Ubuntu) and let only ports 22, 80 and 443 in. The relay is never reachable except through
Caddy (Compose publishes only Caddy's ports). Caddy ignores an `X-Forwarded-For` a visitor sends and sets the visitor's real
address itself, so the relay's default (`RELAY_PROXY_HOPS=1`) counts the right address and no `RELAY_CLIENT_IP_HEADER` is needed.

## User accounts (sign up, sign in)

Besides access keys, the relay has **user accounts**: anyone opens the site's (or the Windows app's) **Account** page, creates
an account with an email and a password, and connects their own TikTok, Instagram and YouTube accounts – as many as they
like. They sign in on another browser, the installed app or another computer and everything is there.

- A sign-up or sign-in answers with a **session token** (`jbs_…`, 30 days, `RELAY_SESSION_DAYS`). It works exactly like an
  access key (`Authorization: Bearer …`), so every call below – accounts, connect links, publishing, jobs – is the user's own.
  The page keeps it in the browser and gives the Publish block a relay profile named after the user's email.
- Passwords are stored as **scrypt** hashes with a random salt, sessions as SHA-256 hashes; neither goes back to a browser.
  Sign-ups are limited to 10 per hour per address, sign-ins to 30 per 15 minutes per address and 10 per 15 minutes per email
  (an unknown email takes as long as a wrong password). Changing the password ends the user's other sessions; deleting the
  account forgets the user, their sessions and every connected account.
- `RELAY_SIGNUP=off` closes sign-up (existing users and access keys keep working). With a team relay you may prefer that, and
  hand out keys with `POST /api/keys` instead. An admin's key list (`GET /api/keys`) shows user accounts as keys with
  `user: true`; revoking one deletes that user.
- The Windows app's origin `app://jumpingballslive` is allowed to call the relay without being listed in
  `RELAY_ALLOWED_ORIGINS` (`RELAY_ALLOW_APP=0` turns that off), and the sign-in popup reports back to it.
- The limits go by the visitor's address, which behind a proxy is not the socket's. **On Render set
  `RELAY_CLIENT_IP_HEADER=CF-Connecting-IP`**: Cloudflare sets that header on every request to a Render web service and
  overwrites what a caller sent (Render's own guidance for the client address). Without it the relay counts `X-Forwarded-For`
  from the right (`RELAY_PROXY_HOPS`, default 1 – the last entry; Cloudflare in front of Render's balancer is 2), and never
  uses the leftmost entry, which a caller writes. On Fly.io use `Fly-Client-IP`. Only name a header the proxy overwrites: where
  nothing in front removes it (the relay reached directly), a caller could send it and dodge the limits. `RELAY_TRUST_PROXY=0`
  ignores all of these and uses the socket's address.

For the site and the app to use the relay, build them with its address: the repository variable `PUBLISH_RELAY_URL` (passed as
`NEXT_PUBLIC_PUBLISH_RELAY_URL` by `deploy.yml` and `desktop.yml`). Without it the Account page asks the visitor for the address.

## Access keys (several people on one relay)

The admin key (`RELAY_ADMIN_KEY`) only manages keys; it cannot post.

```bash
# create a key for each person / team – the "key" field is shown ONCE
curl -X POST https://my-relay.example/api/keys -H "Authorization: Bearer $RELAY_ADMIN_KEY" -H "Content-Type: application/json" -d '{"label":"Alice"}'
# list keys (labels, account counts – never the secrets)
curl https://my-relay.example/api/keys -H "Authorization: Bearer $RELAY_ADMIN_KEY"
# revoke a key (its accounts are forgotten)
curl -X DELETE https://my-relay.example/api/keys/k_1a2b3c -H "Authorization: Bearer $RELAY_ADMIN_KEY"
```

Each person then opens the simulator → **Recording → Publish → Relay**, enters the relay URL, their key and a label, and
connects their own accounts with the **Connect TikTok / Connect Instagram / via relay** buttons. Someone with several
brands can keep several **relay profiles** (URL + key + label) and switch between them. Keys are stored hashed
(SHA-256); accounts, tokens and uploaded clips are in `RELAY_DATA_DIR` (keep it private, it is `chmod 600`).

## Setting up the platform apps

Every platform wants an app of yours, with the relay's callback URL registered. `<relay>` below is `RELAY_PUBLIC_URL`.

### TikTok (Login Kit + Content Posting API)

1. [developers.tiktok.com](https://developers.tiktok.com) → **Manage apps → Connect an app**. Fill in the app details
   (icon, terms and privacy URLs – the site's `/terms` and `/privacy` pages work).
2. Add the products **Login Kit** and **Content Posting API**; in the Content Posting API enable **Direct Post**.
3. **Scopes**: `user.info.basic` and `video.publish`.
4. Login Kit → **Redirect URI**: `<relay>/oauth/tiktok/callback` (Web).
5. Copy the **Client key** and **Client secret** into `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
6. Until TikTok **audits** the app, it can be used only by the accounts added as **target users** in the sandbox, and it may
   only post **privately** (“Only me”). The relay then posts privately and says so on the account's result
   (`TIKTOK_PRIVATE_FALLBACK=0` makes it fail instead). Submit the app for review to post publicly.
7. The relay uploads the file (`FILE_UPLOAD`): whole up to 64 MB, bigger files in 10 MB chunks with the remainder in the
   last one, as TikTok's Media Transfer Guide asks. With `TIKTOK_SOURCE=pull`, TikTok downloads the clip from
   `<relay>/media/…` instead – verify the relay's domain as a **URL prefix** in the developer portal first.
8. TikTok has no "unlisted": a send with `visibility=unlisted` posts for mutual friends (Friends) and says so on the
   account's result; `private` posts as Only me.

### Instagram (Meta app)

Instagram publishes **Reels** from a public video URL – the relay serves the uploaded clip for it. The account must be an
Instagram **professional** account (Business or Creator). Reels want **MP4 (H.264 + AAC)**, 9:16, 3–90 s (Chrome and Safari
export MP4; a WebM clip is refused with a note). Reels are always **public**: a send with `visibility` `unlisted` or
`private` is refused for the Instagram accounts (the site does not send it either) instead of being posted for everyone.
About 50 API posts per account per 24 hours.

**Facebook Login for Business** (default, `IG_LOGIN=facebook`):

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** → type **Business**.
2. Add **Facebook Login for Business**; **Valid OAuth Redirect URIs**: `<relay>/oauth/instagram/callback`.
3. Permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_read_engagement`,
   `business_management` (optionally create a *configuration* with them and set `IG_CONFIG_ID`).
4. Link each Instagram professional account to a **Facebook Page** (Page settings → Linked accounts). When connecting, pick
   the Pages – every Page with an Instagram account becomes one account on the relay (one sign-in can add several).
5. App ID / App secret → `IG_APP_ID` / `IG_APP_SECRET`.
6. In **development mode** only people with a role on the app (App roles → Roles, plus Instagram testers) can connect;
   for anyone else request **Advanced Access** for `instagram_content_publish` in **App Review**. Until then a post fails
   with “this Meta app is not yet approved…”.

**Instagram API with Instagram Login** (`IG_LOGIN=instagram`, no Facebook Page needed): add the **Instagram** product
(“API setup with Instagram login”), register the same redirect URI under **Business login settings**, use its
**Instagram app ID / secret**, scopes `instagram_business_basic` and `instagram_business_content_publish`. Tokens last 60
days and the relay refreshes them when they get old.

### YouTube (Google Cloud)

1. [console.cloud.google.com](https://console.cloud.google.com) → a project → **APIs & Services → Library** → enable
   **YouTube Data API v3**.
2. **OAuth consent screen**: External; scopes `.../auth/youtube.upload` and `.../auth/youtube.readonly`; add yourself (and
   whoever connects) as **Test users** while the app is in *Testing*.
3. **Credentials → Create credentials → OAuth client ID → Web application**: **Authorized redirect URI**
   `<relay>/oauth/youtube/callback` (for the browser-only path, add the site's origin – e.g. `https://jumpingballslive.com`
   – under **Authorized JavaScript origins** of the same or another client).
4. Client ID / secret → `YT_CLIENT_ID` / `YT_CLIENT_SECRET`.
5. While the consent screen is in *Testing*, refresh tokens expire after **7 days** (reconnect, or publish the app). Videos
   uploaded through a project Google has not **audited** are locked to **private**; request an audit (YouTube API Services
   compliance) to upload publicly. An upload costs ~1,600 of the default 10,000 daily quota units (about 6 a day).

## API

All JSON; `Authorization: Bearer <access key>` unless noted; CORS for the origins in `RELAY_ALLOWED_ORIGINS`.

| Method and path | What it does |
| --- | --- |
| `GET /api/health` | No key. `{ ok, name, version, platforms: { tiktok, instagram, youtube }, signup }` – which platforms have app keys, and whether the relay takes new accounts |
| `GET /api/me` | The key's `{ id, label }`, the signed-in `user` (or `null` for an access key) and the platforms |
| `POST /api/auth/signup` | No key. `{ email, password, name? }` → `201 { token, expiresAt, user }`; `400 bad_email` / `weak_password` (8–200 characters), `409 email_taken`, `403 signup_closed`, `429 rate_limited` |
| `POST /api/auth/login` | No key. `{ email, password }` → `{ token, expiresAt, user }`; `401 bad_credentials`, `429 rate_limited` |
| `POST /api/auth/logout` | Session token. Ends that session |
| `POST /api/auth/password` | Session token. `{ current, next }`; ends the user's other sessions |
| `DELETE /api/auth/user` | Session token. `{ password }`; deletes the user, their sessions and every connected account |
| `POST /api/keys` | **Admin key.** `{ label }` → `{ id, label, key }` (the key is shown once) |
| `GET /api/keys` / `DELETE /api/keys/:id` | **Admin key.** List keys (no secrets) / revoke one and forget its accounts |
| `GET /api/accounts` | The key's accounts: `{ id, platform, name, handle, avatar, connectedAt, status: ok \| expired, note }` |
| `DELETE /api/accounts/:id` | Disconnect one of the key's accounts |
| `POST /api/connect/:platform` | `{ origin }` → `{ url }`: a one-time link (10 minutes) to open in a popup |
| `GET /connect/:platform?state=…` | Starts the platform's OAuth sign-in |
| `GET /oauth/:platform/callback` | Stores the account(s), `postMessage`s `{ source: "jumpingballslive-relay", type: "connected" \| "error", platform, accounts }` to the site and closes |
| `POST /api/publish` | `multipart/form-data`: `file` (the clip), `accounts` (ids, comma-separated), `title`, `caption`, `hashtags` and/or `posts` (JSON per platform: `{ title, text, hashtags, tags }` – the site sends these), `visibility` (`public` \| `unlisted` \| `private`) → `202 { jobId, job }` |
| `GET /api/jobs/:id` | `{ id, status: running \| done \| partial \| failed, items: [{ accountId, platform, name, status: queued \| uploading \| processing \| published \| failed, progress, link, error, note }] }` (kept 24 h) |
| `GET /media/:id.mp4` | The uploaded clip (public, Range requests) – what Instagram (and TikTok's pull mode) download |

The viral bot posts through it too: `node scripts/viral-bot.mjs --relay https://my-relay.example --relay-key $KEY
--accounts a_1,a_2` (after rendering, or with `--post-only` for what `--out` holds).

## Tests

`npx vitest run relay` (from the repository root) – the key / account store, the OAuth states, the sign-in flows and the
publish flows of all three platforms against mocked platform endpoints, with the relay running on `127.0.0.1`.

## Security notes

- Serve it over **HTTPS** only (every host above does). Keys travel in the `Authorization` header, never in URLs.
- `RELAY_ALLOWED_ORIGINS` is the CORS allow-list and the list of pages a sign-in popup may report back to.
- Clip URLs are 128-bit random and expire after `RELAY_MEDIA_TTL_HOURS` (24 h by default).
- Sign-up and sign-in are rate limited (see User accounts); everything else is not, so give access keys only to people you
  trust, revoke a key you no longer need and consider `RELAY_SIGNUP=off` on a private relay.
