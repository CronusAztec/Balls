# Social autopilot: videos made locally, posted through Postiz, every post approved by the user

Design (2026-10-18, revised the same day for Postiz). The Windows app keeps making the videos with the local AI (the render queue
and the AI studio that exist today) and hands finished clips to **Postiz** (postiz.com, cloud or self-hosted), where the creator has
already connected their TikTok, Instagram, YouTube and other channels. Postiz holds the platform logins and posts from its own
servers at the scheduled time; the app never sees a platform token. The user gives the app one thing: their Postiz API key.

Facts about Postiz come from docs.postiz.com, the Postiz OpenAPI description and the postiz-app source on 2026-10-18; facts about
the platforms from their developer documentation the same day.

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

## 2. Postiz does the connecting and the posting

| | Who does it |
|---|---|
| Connect a TikTok / Instagram / YouTube account | the user, inside Postiz (Add channel): Postiz runs the OAuth and keeps the tokens |
| Keep the login alive (token refresh) | Postiz |
| Post at the scheduled time, retry, report the link or the error | Postiz's servers (the app can be closed) |
| Make the video, the caption and the hashtags | the app, locally (render queue + AI studio) |
| Decide what goes out, when, with which settings | the user, on the approval card in the app |
| Upload the clip and create the post | the app, with the user's API key |

What the app needs from the user: the Postiz **API key** (Settings → Developers → Public API in Postiz; one key per workspace,
no scopes, it never expires on its own) and, for a self-hosted Postiz, its backend address. The key is sealed with Windows'
`safeStorage` in the same `SecretBox` the app uses for the cloud AI key, and never leaves the PC except in the `Authorization`
header to the Postiz address the user set. Pasting a key into the app is the user's consent for the app to act on that
workspace; "Forget key" removes it.

Postiz API facts the design relies on (base `https://api.postiz.com/public/v1`, or `<backend>/public/v1` self-hosted;
header `Authorization: <key>` without "Bearer"):

- `GET /is-connected`, `GET /me`, `GET /integrations` – check the key, list the channels (id, name, platform identifier, picture,
  disabled flag).
- `POST /upload` (multipart field `file`, **MP4 only**, up to 1 GB; images 10 MB) → `{id, path}`. The app's renders are MP4 already
  (the WebM fast export is transcoded by the bundled ffmpeg before upload).
- `POST /posts` – `type: now | schedule | draft`, `date` (UTC), one `posts[]` entry per channel with `value[{content,
  image:[{id,path,thumbnailTimestamp}]}]` and the provider `settings` (`__type` is mandatory). Returns the post ids. Rate limit:
  90 create calls an hour (100 on the cloud); the app batches every channel of one clip into one call.
- `GET /integration-settings/:id` – the provider's rules, length limits and settings schema (the app renders the TikTok, Instagram
  and YouTube forms from the schemas it knows, and falls back to this for other platforms).
- `GET /posts?startDate&endDate` – state `QUEUE | PUBLISHED | ERROR | DRAFT`, `releaseURL`, `error`: how the app learns the outcome
  (no webhook reaches a desktop app).
- `PUT /posts/:id/status` (draft ↔ schedule), `PUT /posts/:id/settings`, `DELETE /posts/:id` (**removes the whole group**: the app
  deletes one channel's post only after a confirmation that names the other channels in the group).
- `GET /find-slot/:id` – Postiz's next free slot for a channel ("Next free slot" on the card).
- `GET /analytics/:integration?date=7|30|90`, `GET /analytics/post/:postId` – the Insights card.
- `GET /notifications` – Postiz's own notices (a token that expired, a post that failed), shown under Accounts.

Provider settings the approval card must collect (Postiz validates them, so the card never sends a post Postiz would refuse):

- **TikTok** `__type:"tiktok"`: `privacy_level` (PUBLIC_TO_EVERYONE | MUTUAL_FOLLOW_FRIENDS | FOLLOWER_OF_CREATOR | SELF_ONLY),
  `duet`, `stitch`, `comment`, `brand_content_toggle`, `brand_organic_toggle`, `content_posting_method` (DIRECT_POST | UPLOAD),
  `video_made_with_ai`, `autoAddMusic` ("yes" | "no"), optional `title` (≤ 90). TikTok's audit rules require the user to choose privacy and the three interaction
  settings every time, with no defaults – the card shows them unset. Until TikTok audits the Postiz app in use, posts go out
  SELF_ONLY whatever was chosen; the card says so.
- **Instagram** `__type:"instagram"` (Facebook-linked) or `"instagram-standalone"`: `post_type` post (a Reel when the media is one
  video) | story; optional trial reel, collaborators. Reels are always public. Postiz asks for MP4 ≤ 300 MB, 1920 px wide, 25 Mbps.
- **YouTube** `__type:"youtube"`: `title` (2–100), `type` public | private | unlisted, `selfDeclaredMadeForKids` ("yes" | "no"), `tags`, optional
  `thumbnail` (an uploaded image). The description is the post content (≤ 5000).
- Other channels the user connected in Postiz (Threads, Bluesky, Mastodon, X, LinkedIn, Facebook pages, Pinterest, …): the card
  offers them with the settings form from `/integration-settings`, or caption-only where Postiz needs only `__type`.

What is still true from the platform rules (section 1): the user must consent to each post before it is created, so the app never
calls `POST /posts` with `type: now` or `schedule` for anything the user has not approved on its card. Drafts (`type: draft`) are
how the autopilot's proposals could also appear inside Postiz's calendar; the app keeps its own queue as the source of truth and
only mirrors approved posts to Postiz.

## 3. The pieces

```
Windows app, Electron main (Node 22, no new dependencies)          Postiz (cloud or the user's own server)
  social/postiz.ts     API client: key check, channels, upload,      /is-connected /me /integrations
                       posts, status, settings, delete, slots,       /upload /posts /find-slot
                       analytics, notifications (fetch + FormData)   /analytics /notifications
  social/keys.ts       the sealed API key + base URL (SecretBox,
                       electron-store "postiz" block)
  social/queue.ts      the proposal queue: items, states, merge,
                       cap, approve = the card's request through
                       ClipPoster (built: phase 3)
  social/autopilot.ts  the autopilot's settings block (phase 4)
  social/transcode.ts  WebM → MP4 (bundled ffmpeg) before upload
  social/audit.ts      social-audit.json: every call that changed
                       something, with the time and who approved,
                       and a created post's clip genes (section 5)
page (React, app:// only; the Desktop group gets two tabs)
  Accounts tab   paste the key (and address), channels with their platform and picture, Postiz notices, Insights, Forget key
  Queue tab      proposals → Approve (opens the settings card) / Edit / Skip; scheduled; posted (with links); failed (with the
                 Postiz error and Retry); "Next free slot"
  Autopilot card what it may propose (which channels, how many a day, quiet hours, caption language); "Propose now"
AI studio (the existing agent framework; the model is local by default)
  task "plan"    finished clips in the Library + the viral playbook + the channels' recent performance (analytics) →
                 proposals: clip, per-channel caption/title/hashtags, a suggested time (Postiz's free slot), never the TikTok
                 privacy/interaction settings (the user picks those)
  task "copy"    (exists) per-platform copy, now addressed to the channels Postiz lists
```

Bridge: one new `social` namespace on `window.desktop` (contract.ts, preload.ts, handlers.ts, the key list in
desktop/tests/ipc.test.ts): `key.status/set/forget`, `channels.list`, `queue.list/propose/approve/edit/skip/retry/remove`,
`posts.recent`, `slots.next(channelId)`, `insights.get(channelId|postId, days)`, `notices.list`, `settings.get/set`; events
`social:queue` (the queue changed), `social:progress` (an upload under way). Every argument is checked in `checkIpcArgs`.

Queue item: `{ id, clipId (Library item), channels: [{ integrationId, platform, text, settings }], when (UTC ISO | "now"),
status: proposed | approved | uploading | created | published | failed | skipped, postIds[], links[], error, by: ai | user,
log[] }`.

Rules in code:
- A **proposed** item never reaches Postiz. **Approve** collects the provider settings, uploads the clip once, and creates the post
  (`schedule` with `when`, or `now`). From then on Postiz owns the timing: the app may be closed.
- The app checks outcomes while open (every 2 minutes while anything is in QUEUE, plus on start): PUBLISHED → link, ERROR → the
  Postiz error on the card with Retry (a new post; the failed one is deleted after confirmation).
- Guards: 1 upload at a time; at most 1 approved post per channel per 20 minutes; respect 429 with backoff; never more than 60
  create calls an hour from one key (Postiz allows 90); TikTok DIRECT_POST notes the "private until audited" rule on the card.
- The AI's text is marked `by: ai` until the user edits or approves it. Nothing the AI wrote is sent unedited without the user
  seeing it on the card.
- Audit log and a "Forget key" that also clears the queue's Postiz ids.
- The audit line of every post the app creates keeps the genes of its clip (section 5), so its numbers can be joined to what
  made it later; nothing more goes to Postiz.

## 4. Phases

1. **Postiz client and key** – `social/postiz.ts` + `keys.ts` with tests against a stand-in Postiz server (every endpoint above,
   401/413/429/5xx, MP4-only); the Accounts tab (key, channels, notices); the `social` bridge namespace. Pro-gated (`publish`).
   **Built** (2026-10-18): `desktop/src/social/{postiz,keys,service}.ts`, the `social` namespace (`key`, `channels`, `notices`),
   `AccountsPanel.tsx`; tests in `desktop/tests/postiz.test.ts` and `tests/desktopSocial.test.ts`.
2. **Post a Library clip through Postiz** – the Library's "Post with Postiz" target; the approval card with the TikTok, Instagram
   and YouTube forms (and the generic form); transcode to MP4 when needed; upload; create; outcome polling; the Posts tab's
   "posted" and "failed" lists.
   **Built** (2026-10-18): `desktop/src/social/{posting,outcomes,audit}.ts` (`ClipPoster.prepareClip/postClip`: MP4 pass-through
   or the bundled ffmpeg's H.264 + AAC transcode into a hidden temporary file next to the clip, one upload, ONE `POST /posts`
   with every channel, `social:progress` events; the guards: one clip at a time, one post per channel every 20 minutes and
   under 60 creates an hour from `social-audit.json`, a 429 waited once; `recentPosts(days)` reads `days` back and forward
   so scheduled posts show), the `social` bridge's `prepare`, `post`, `posts`, `postDelete`, `audit`, `channelSettings`,
   `slot`; the page's `src/lib/desktop/socialCard.ts` (the card's rules, pure) with `PostizPostCard.tsx` (TikTok's privacy and
   comment / duet / stitch as yes-no choices with no default, branded content blocked at SELF_ONLY, DIRECT_POST or UPLOAD
   explained, "made with AI" on by default; Instagram post or story; YouTube title, visibility, made-for-kids; Postiz's schema
   for the rest; now / schedule with "Next free slot" / draft; Approve says what will happen; the outcome polled for 3 minutes)
   and `PostsPanel.tsx` (the **Posts** tab: Scheduled / Posted / Failed / Drafts, Retry through the audit log's clip id, Delete
   after a confirmation naming the group rule); tests in `desktop/tests/postizPosting.test.ts`, `tests/desktopSocial.test.ts`
   and `tests/desktopPublish.test.ts`. Not in this phase: a thumbnail-frame picker (`thumbnailMs` travels but the card does
   not set it), edit / skip of a post, restoring a half-finished post after a restart (phase 3).
3. **Queue and schedule** – `when`, "Next free slot", drafts, edit/skip/retry/remove, the audit log, restore after a restart.
   **Built** (2026-10-18): `desktop/src/social/queue.ts` (`SocialQueue` in `social-queue.json` through the crash-safe
   JsonFileStore, restored on start; item `{ id, clipId, channels: [{ integrationId, platform, text, settings }], when,
   status proposed | approved | skipped | posted | failed, by ai | user, reason, createdAt, postIds[], error, log[] }`). Rules
   in code: a `proposed` item never calls Postiz (nothing in the file reaches Postiz except `approve`); `approve(id, request)`
   runs the existing `ClipPoster.postClip` with the request the approval card produced – the card is the only approval path –
   and marks the item posted (the post ids) or failed (the error, Approve may run again); `edit` (text, settings, when: the
   text is the user's from then on), `skip`, `remove` (refused while a post is on its way), `list`; at most 200 items
   (finished ones go first), proposals older than 14 days are dropped, a proposal for a clip and channel already `proposed` is
   merged into that item (the user's edits stay); an item left `approved` by a crash is restored as failed; TikTok's privacy
   and interaction keys are stripped from anything proposed or read back from the file; the `social:queue` event carries the
   whole list on every change. Bridge: `social.queue.list/propose/approve/edit/skip/remove`, every argument checked in
   `checkIpcArgs` (`checkSocialProposals`: 1–5 proposals a call, channels bounded like the post request, no TikTok user-only
   settings, `when` in the future or null; `checkSocialQueueEdit`). The Posts tab's **Proposed** group on top: thumbnail,
   channels, the text (editable), when, the planner's reason, status, who wrote it, **Review and approve** (the card opens
   prefilled with the texts, a YouTube title and the time; the user chooses TikTok's audience and interactions there and
   clicks Approve, which goes through `queue.approve`), Skip, Remove. Tests: `desktop/tests/socialQueue.test.ts`,
   `tests/desktopAutopilot.test.ts`. Not in this phase: "Retry" of a failed Postiz post as a queue item (the Posts tab's
   Retry still opens the card directly), Postiz drafts mirrored into the queue.
4. **Autopilot proposals** – the "plan" AI task, the Autopilot card (channels, cadence, quiet hours), proposals in the Queue tab;
   Insights cards from Postiz analytics feed the planner.
   **Built** (2026-10-18): the settings (`desktop/src/social/autopilot.ts`, the config's `autopilot` block, sanitised field by
   field in `src/lib/desktop/autopilot.ts`: `enabled` false by default, `channels`, `perDay` 1..5, `quietFrom`/`quietTo`
   "HH:MM" local 22:00–08:00, `language` en | pl | es (the app's), `proposeHours` 6, `lastPlannedAt`), the bridge's
   `social.autopilot.get/set`; the AI task **plan** (`src/lib/desktop/ai/plan.ts`, pure, on the agent framework like
   `copyTask`: the unposted clips, the autopilot's channels, the budget, the quiet hours, the local time, a playbook excerpt
   and the recent PUBLISHED / ERROR outcomes → `{ proposals: [{ clipId, channels: [{ integrationId, text, title?,
   hashtags? }], when, reason }] }`, ids as enums, ≤ perDay, texts within `lib/publish/platforms.ts`' limits, `when`
   outside the quiet hours and within 48 h, `checkFinal` refusing unknown ids and TikTok's privacy / interaction settings;
   temperature 0.6, 1500 tokens, 4 steps); `planRun.ts` gathers the inputs over the bridge and turns the answer into queue
   proposals (`__type` and a YouTube title are the only settings). The page runs it two ways: the AI studio's **Plan posts**
   job with a result card and **Send to Posts tab** (`useDesktopAi.ts`, `AiPanel.tsx`), and the trigger in `useAutopilot.ts`
   (mounted by the Desktop group's section, so it runs while the group is shown whichever tab is open): every 15 minutes
   `shouldPlanNow(settings, queue, now)` – enabled, a channel ticked, the last run older than `proposeHours`, fewer than
   `perDay` of the AI's proposals today – and, when the AI can answer and no studio job is on, the planner runs and
   `queue.propose(…, "ai")`; `lastPlannedAt` is written after every run. The Posts tab's **Autopilot** card: the toggle, the
   channel checkboxes from `social.channels`, per day, quiet hours, language, "Propose now", and the line "The autopilot
   only proposes. Nothing is posted until you approve it here." Strings in en / pl / es. Tests: `tests/desktopAutopilot.test.ts`
   (the task's schema and checks, a scripted model, `shouldPlanNow`, the quiet hours, `runPlanner` over a fake bridge, the two
   cards in three languages, the card prefilled from a proposal). Not in this phase: Postiz analytics (Insights) as a planner
   input beyond the outcome list, a planner that runs with the app closed (by design it never does).
5. **Copy, legal, release** – privacy policy (the key stays on the PC; clips go to the user's Postiz; what Postiz sees), terms
   (Postiz's and the platforms' rules), the download and pricing pages ("post through Postiz" replaces "share"), changelog
   Windows app 1.4.0, docs (RELEASING, this file), and the website's Account page: no longer the place to connect channels (it
   points to Postiz), the relay's channel-connect code is retired in a later cleanup.
   **Built** (2026-10-19): the privacy policy's Windows app list has a "Postiz:" item (`Privacy.windowsApp.postiz`: the key
   encrypted on the PC, a clip and its text to the user's own Postiz only on Approve, Postiz posts under its own terms and
   privacy policy, we receive nothing) and the publishing section a paragraph with the same facts (`Privacy.publishing.postiz`);
   the terms' Acceptable Use section a clause (`Terms.acceptable.postiz`: Postiz's terms and the platforms' rules apply, Postiz is
   not operated by us, the user answers for every post they approve); `LEGAL_LAST_UPDATED` 2026-10-19. The download page's
   feature list has "Post through Postiz" (`Desktop.features.postiz`) and the pricing page's comparison a Pro-only row
   (`Billing.compare.create.postiz`, the smoke test counts 13 rows and 2 Pro-only ones); both say the autopilot proposes and
   the user approves, neither promises scheduling or public TikTok posts. The Account page (`Account.metaDescription`,
   `lede`, `free`) now serves the browser studio's relay, and a callout on top of the panel (`Account.postiz.*`,
   `data-testid="account-postiz"`) links to postiz.com and the download page in en / pl / es; the relay sign-in and channel UI
   stay for the browser studio. Changelog: Windows app 1.4.0 and website 1.11.0 (same day) in `src/content/changelog.json`,
   `CHANGELOG.md` regenerated, `npm run release:desktop -- 1.4.0` and `npm version 1.11.0`. README ("Windows app: Postiz")
   and docs/RELEASING.md (the smoke step's AI jobs on 2-core runners) updated. Still to do: the relay's channel-connect
   retirement (the browser studio uses it), Postiz in the privacy policy's third-party list with its own policy link.

Each phase: vitest with stand-in servers, the desktop tests, a read-only review (security, copy), then `main`.

## 5. Each post keeps its clip's genes (the attribution ledger)

**Built** (2026-10-27, phase P2 of the agent platform, Windows app 1.6.0; README "Windows app: clip genes and the playbook
score"). To learn later which clips do well, the app must know what made each post, and Postiz reports its numbers per post
id (`GET /analytics/post/:postId`). So every post the app creates keeps, next to its post ids, the **genes** of the clip it
showed (`src/lib/insights/genes.ts`: what the clip was made from, what its fast export measured and its playbook score):

- **In the audit** – `SocialAuditEntry.genes` on the `createPosts` line that `social/posting.ts` writes to `social-audit.json`
  once `POST /posts` has answered. The genes are the queue item's copy when the post comes from the queue
  (`SocialQueue.approve` hands them to `ClipPoster.postClip` beside the card's request), else the Library item's (a post
  approved on the card alone). The TikTok audience the card chose goes with them (`tiktokPrivacy`: public, friends,
  followers or self, from the first TikTok channel's `privacy_level`; null without TikTok).
- **In the queue** – `SocialQueueItem.genes`: a proposal copies its clip's genes from the Library item when it is proposed
  (the main process reads them; the caller cannot hand any), so the item keeps them after the Library forgets the clip.
- **Sanitised in the main process** on every write and every load (`sanitizeGenes`: closed enums, clamped numbers, strict
  ids of 64 characters or fewer, no free text, 4 KB at most). A line or item without genes (written by 1.5.0 or earlier)
  loads exactly as it was stored; a value that is not a genes record is dropped and the rest of the line kept.
- **It survives deletion.** Deleting the Library file or the queue item leaves the audit line, so the post id keeps its
  genes (`desktop/tests/clipGenes.test.ts`). The audit keeps its newest 2000 lines, as before.
- Post hour and weekday are not stored: they follow from the post's `publishDate` in `GET /posts`.
- **Nothing more leaves the PC.** The create call carries the clip and its text, as before; the genes stay in the app's data
  folder, and the AI's planner never reads them.

## 6. The owner's check for the Insights (P7): what your Postiz returns

The Insights work (phase P7: the owner's own post statistics on the PC, joined to the genes of section 5) has to know which
analytics series the owner's Postiz really returns, per platform and per post: Postiz hands each provider's own labels
through, and they differ between providers and Postiz versions. So before P7 is designed, the owner runs the probe once
against the real Postiz and records its output here. The probe goes through the Windows app's own Postiz client and prints
series labels and point counts only: never a value, a channel name, a post text or the key (docs/agents/CLI.md, "Owner-run
commands").

1. On your own PC, in the repository, put your Postiz address and API key in the git-ignored `.env.local`, as in the app's
   Accounts tab (`https://api.postiz.com` for Postiz cloud, else your backend's address):
   ```sh
   POSTIZ_URL=https://api.postiz.com
   POSTIZ_API_KEY=paste-your-key-here
   ```
2. Run `npm run -s agent -- postiz-probe --json '{"days":30,"posts":5}'` (`days` is 7, 30 or 90; `posts` is how many recent
   published posts it reads, 0 to 20). Without the two variables it prints `not configured` and exits 0.
3. Paste its output below and fill in the tables. The key never appears in it; `host` names your Postiz server, so leave it
   out if that is private.
4. Take the key out of `.env.local` again if you do not want it kept there.

**Status: not run yet.** The development machine has no Postiz key: on 2026-10-27 the probe answered `"configured":false`
("not configured: set POSTIZ_URL and POSTIZ_API_KEY").

| Filled in by the owner | |
| --- | --- |
| Run on (date) | |
| Postiz: cloud or self-hosted | |
| `days` and `posts` | |

Per channel (the output's `channels`: the platform, whether it is disabled, and each series' `label` with its `points`, or
the `error`):

| index | platform | disabled | series (label: points) or error |
| --- | --- | --- | --- |
| | | | |

Per recent post (the output's `posts`):

| index | platform | series (label: points) or error |
| --- | --- | --- |
| | | |

The probe's output as printed:

```json
(paste it here)
```

What P7 takes from it: which labels stand for views, likes, comments, shares and followers on each platform; whether a
post's series are daily points or a single total; how many days back a post has numbers; and which platforms return nothing
(an `error`, or no series), which then get no Insights card.

## 7. Out of scope, on purpose

Posting or replying without a person approving each action; anything that needs the account password or a browser session;
buying or trading engagement; TikTok comments and analytics, Instagram caption edits (the APIs do not offer them); Facebook,
X, Threads, Bluesky (later, same framework).
