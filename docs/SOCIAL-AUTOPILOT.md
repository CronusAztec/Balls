# Social autopilot: connected accounts, tokens on the user's PC, an approval queue

> **Status (2026-10-18): draft, being revised.** The owner chose to post through Postiz (postiz.com) instead of the app talking to
> each platform itself; the videos are still made locally. Sections 1 and 5 (what the platforms allow, what stays out of scope)
> still hold; sections 2 to 4 (tokens on the PC, a relay exchange mode, per-platform clients) are superseded by the Postiz design.

Design (2026-10-18). What the Windows app will do with a creator's own TikTok, Instagram and YouTube accounts, how the sign-in
tokens stay on the creator's computer, and what the platforms' official rules allow. Facts about the platforms come from their
developer documentation as read on 2026-10-18; the relay and app facts from the code (relay/server.mjs, desktop/src, src/lib/publish).

## 1. What the platforms allow (the ceiling)

"Control all functions of the account" is bounded by what each platform's official API offers. Anything beyond it would need the
account's password or browser session, which the platforms' terms forbid and which gets accounts and apps banned. The app stays
inside the official APIs.

| Function | TikTok | Instagram (professional account) | YouTube |
|---|---|---|---|
| Post a video | yes (Direct Post; private-only until TikTok audits the app) | yes (Reels; also Stories and carousels) | yes (incl. Shorts) |
| Schedule | no native field: the app posts at the chosen time | no native field: the app posts at the chosen time | native `publishAt` (private until then) |
| Edit title / description after posting | no | caption no; comments on/off yes | yes (title, description, tags, privacy, thumbnail) |
| Delete a post | no | yes (Facebook-login apps only) | yes |
| List own videos and their counts | yes (public videos; views, likes, comments, shares) | yes | yes |
| Read comments | no | yes | yes |
| Reply to / hide / delete comments | no | yes (reply to top-level, hide, delete own) | yes (reply, approve, reject, delete own) |
| Analytics beyond counts | no | yes (reach, saves, shares, watch time, follower demographics) | yes (YouTube Analytics: watch time, retention, subscribers) |
| Playlists | – | – | yes |
| AI-made label | `is_aigc` | `is_ai_generated` | `containsSyntheticMedia` |

Rules that shape the design (all three platforms say the same thing in their own words): the user must expressly consent to each
action before it runs; TikTok's audit checklist requires that privacy, comment, duet and stitch settings are chosen by the user
every time, with no defaults; Meta forbids bots "at very high frequencies" and prefilled content the person did not write; YouTube
forbids automating uploads, comments or likes without the user's prior, specific consent. So: **a queue that proposes, and a person
who approves, is allowed; posting or replying with nobody looking is not.** The autopilot proposes; it never posts on its own.

Before real users can connect: TikTok app review and Content Posting audit (until then posts are private and at most 5 users a day),
Meta App Review with Business Verification (until then only people with a role on the app), Google sensitive-scope verification
(until then sign-ins die after 7 days). These are the owner's applications, with the relay's callback addresses and the site's privacy
and terms pages. docs/RELEASING.md gets a section.

## 2. Where the logins live

Today the relay keeps every connected account's tokens in `relay.json` on the server and does the posting. The new design keeps the
tokens on the creator's PC, sealed with Windows' DPAPI through Electron's `safeStorage` (the `SecretBox` the app already uses for
the cloud AI key), and the Electron main process talks to the platforms directly.

What the relay still has to do, because the platforms require the app secret for it:

| Step | TikTok | Instagram | YouTube |
|---|---|---|---|
| Authorization code → tokens | relay (secret) | relay (secret, plus the 60-day exchange) | **PC** (public client, PKCE, no secret) |
| Refresh | relay (secret) | PC (`refresh_access_token`, no secret) | PC (no secret) |
| Redirect address | loopback `http://127.0.0.1:<port>` (TikTok allows it for desktop apps), code + PKCE verifier handed to the relay | the relay's HTTPS callback (Meta documents only HTTPS) | loopback on the PC |
| Posting and account actions | PC | PC (the clip still needs a public URL for 24 h: the relay's `/media` store, or the user's own upload later) | PC |

New relay mode, `RELAY_TOKENS=client`: the OAuth callback and the new `POST /api/oauth/exchange` and `POST /api/oauth/refresh`
return the tokens **once, to the signed-in user's app** (over the user's session) instead of storing them. The relay's state store
keeps no tokens in that mode; backups hold none. The existing server-side mode stays for the website (a browser cannot keep a token
safe) and is unchanged.

Threat model: the token on the PC is as safe as the Windows account (DPAPI, user-bound). The relay sees TikTok and Instagram tokens
in transit at exchange and refresh time and forgets them. A stolen app secret still only lets an attacker mint tokens for users who
sign in at the attacker's relay, which is why the app pins the relay address of the build.

## 3. The pieces

```
Windows app (Electron main)                                 relay (Node, the owner's server)
  social/tokens.ts      sealed token store (SecretBox)        /api/oauth/exchange   TikTok + Instagram code → tokens (secret)
  social/oauth.ts       loopback listener, PKCE, state        /api/oauth/refresh    TikTok refresh (secret)
  social/platforms/     tiktok.ts instagram.ts youtube.ts     /oauth/:p/callback    (RELAY_TOKENS=client: hands tokens to the app once)
  social/queue.ts       approval queue + scheduler            /media                public clip URL for Instagram (24 h)
  social/audit.ts       what the app did, when, on whose say
page (React, app:// only)
  Accounts tab: connect / disconnect, what each connection may do, "Forget everything"
  Queue tab: proposals → Approve / Edit / Skip; scheduled posts; results with links
  Autopilot card: what it may propose, how often, quiet hours; "Propose now"
AI studio (existing agent framework)
  task "plan": from the render queue's finished clips + playbook → proposals (clip, caption per platform, time, platform settings left for the user)
  task "reply": draft replies to new comments (YouTube, Instagram) → proposals
```

Bridge: a new `social` namespace on `window.desktop` (contract.ts, preload, handlers, the ipc test's key list), with methods
`accounts.list/connect/disconnect/forget`, `queue.list/approve/edit/skip/retry`, `settings.get/set`, `inbox.list` (comments),
`insights.get`, and events `social:queue`, `social:progress`. Every method is argument-checked in `checkIpcArgs` as today.

The approval queue item: `{ id, kind: post|reply|edit|delete, accountId, platform, clipId?, text, settings (privacy, comments, duet,
stitch, aiLabel, brandedContent), when, status: proposed|approved|scheduled|running|done|failed|skipped, result {link}, by: ai|user,
log[] }`. **A proposed item never runs. An approved item runs at `when`, while the app is open (tray counts). If the app was closed
past `when`, the item waits for the user's confirmation again (it does not post late on its own). TikTok settings must be chosen
by the user on the approval card (no defaults); YouTube uses `publishAt` so the scheduling is the platform's.**

Rate and spam guards (hard limits in code, not settings): at most 1 post per account per 20 minutes, 15 TikTok posts per creator
per day, Instagram's live `content_publishing_limit`, YouTube's 100 uploads per day; replies only to comments the user has seen in
the Queue tab; the AI's reply drafts are marked and the user edits or approves each one. An audit log (`social-audit.json`) lists
every action with the time, the account and who approved it, shown under Accounts → History.

## 4. Phases

1. **Token store and sign-in on the PC** (relay client mode + exchange/refresh endpoints; app: loopback OAuth for YouTube and
   TikTok, relay callback for Instagram; sealed store; Accounts tab; tests with stand-in platform servers).
2. **Posting from the PC** (platform clients ported from relay/server.mjs's adapters, which already take an injected `ctx`;
   Instagram's clip goes through the relay's `/media`; one approval card per post; the Library's Publish target uses the queue).
3. **Queue and scheduler** (approval states, `when`, the "app was closed" rule, YouTube `publishAt`, retries, audit log, Queue tab).
4. **Account actions** (YouTube: edit, delete, playlists, thumbnails; Instagram: comments on/off, delete; comments inbox for both
   with reply/hide/delete; insights cards).
5. **Autopilot proposals** (AI tasks "plan" and "reply" through the existing agent framework; settings for cadence and quiet hours;
   every proposal lands in the queue).
6. **Copy, legal, release** (privacy policy: what the app stores on the PC and what passes through the relay; terms: the platforms'
   rules; relay README; changelog Windows app 1.4.0; docs/RELEASING.md on the three platform applications).

Each phase ships behind the existing `publish` entitlement (Pro), is covered by vitest with stand-in HTTP servers, and gets a
read-only review (deploy safety, security, copy) before it reaches `main`.

## 5. Out of scope, on purpose

Posting or replying without a person approving each action; anything that needs the account password or a browser session;
buying or trading engagement; cross-posting other people's content; TikTok comments and analytics, Instagram caption edits
(the APIs do not offer them); Facebook, X, Threads, Bluesky (later, same framework).
