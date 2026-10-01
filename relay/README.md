# JumpingBallsLive publish relay

A small, self-hosted server that lets the simulator's **Publish** block (Recording section) and the viral bot's CLI post
clips to **TikTok**, **Instagram** and **YouTube** accounts – several per platform, for several people.

The site itself is a static export on GitHub Pages: it cannot keep an app secret, and it cannot give Instagram or TikTok a
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
   address Render gives you), `RELAY_ALLOWED_ORIGINS` (`https://cronusaztec.github.io` for this repository's Pages site),
   `RELAY_ADMIN_KEY` and the app keys of the platforms you want.
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
fly secrets set RELAY_PUBLIC_URL=https://<app>.fly.dev RELAY_ALLOWED_ORIGINS=https://cronusaztec.github.io RELAY_ADMIN_KEY=… TIKTOK_CLIENT_KEY=… …
fly deploy
```

On Railway: **New Project → Deploy from GitHub repo**, set the service's root directory to `relay`, add a volume mounted at
`/data`, and the same variables (Railway sets `PORT`).

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
7. The relay uploads the file in chunks (`FILE_UPLOAD`). With `TIKTOK_SOURCE=pull`, TikTok downloads the clip from
   `<relay>/media/…` instead – verify the relay's domain as a **URL prefix** in the developer portal first.

### Instagram (Meta app)

Instagram publishes **Reels** from a public video URL – the relay serves the uploaded clip for it. The account must be an
Instagram **professional** account (Business or Creator). Reels want **MP4 (H.264 + AAC)**, 9:16, 3–90 s (Chrome and Safari
export MP4; a WebM clip is refused with a note). About 50 API posts per account per 24 hours.

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
   `<relay>/oauth/youtube/callback` (for the browser-only path, add the site's origin – e.g. `https://cronusaztec.github.io`
   – under **Authorized JavaScript origins** of the same or another client).
4. Client ID / secret → `YT_CLIENT_ID` / `YT_CLIENT_SECRET`.
5. While the consent screen is in *Testing*, refresh tokens expire after **7 days** (reconnect, or publish the app). Videos
   uploaded through a project Google has not **audited** are locked to **private**; request an audit (YouTube API Services
   compliance) to upload publicly. An upload costs ~1,600 of the default 10,000 daily quota units (about 6 a day).

## API

All JSON; `Authorization: Bearer <access key>` unless noted; CORS for the origins in `RELAY_ALLOWED_ORIGINS`.

| Method and path | What it does |
| --- | --- |
| `GET /api/health` | No key. `{ ok, name, version, platforms: { tiktok, instagram, youtube } }` – which platforms have app keys |
| `GET /api/me` | The key's `{ id, label }` and the platforms |
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
- There is no rate limiting: give keys only to people you trust, and revoke a key you no longer need.
