# The ad kit

Everything needed to buy traffic for JumpingBallsLive and keep every claim true: what to say, what never to say, where the click lands, the copy of each platform in English, Polish and Spanish, how to make the creatives with the product itself, how to measure without ad pixels, and the owner's steps. Written 14 October 2026 against the website 1.10.0. The facts below are read from the code (file names are given), and the platform limits are marked **confirm in the platform UI**: they come from third-party spec pages, except Google's responsive search ad limits, and platforms change them.

Two files carry the copy as data, and a test keeps the kit from rotting: [`docs/ads/copy.json`](ads/copy.json) holds every line with its limit, and `tests/adCopy.test.ts` checks every limit, the house copy style ([`docs/COPY-STYLE.md`](COPY-STYLE.md)), the banned claims, the prices against the billing config, that this page carries every line, and that every address and every bot command in it is valid. Change the copy in `copy.json`, then here.

Before any money is spent, run `npm run go-live:check` and `npm run launch:check` and read [section 10](#10-launch-day-checklist). The order of the owner's steps is in [section 12](#12-owner-steps) and in [`docs/GO-LIVE.md`](GO-LIVE.md), section 14.2.

## 1. Positioning and the one promise

**The line:** Make satisfying ball physics clips for TikTok, Reels and Shorts. Free in your browser, no account. Pro removes the watermark.

**The one promise:** you can make a satisfying ball physics clip in your browser in a minute, for free. Every ad says this in its own way and nothing else. The ad does not sell the Windows app, Pro or a result.

**The price,** read from `src/lib/billing/config.ts` (`PLANS`) and held equal to `billing/billing-config.json`: Pro costs $6.99 a month or $49 a year, which saves 42%. Free clips carry a small watermark and Pro removes it. Payment is by card or crypto: the live billing Worker answers `providers: { stripe: true, paypal: false, crypto: true }` (checked 14 October 2026).

**Proof points that are allowed,** each true today:

| Claim | True today? | Evidence |
| --- | --- | --- |
| Free in the browser, no account, no install | yes | FAQ q1 and q4, hero sub |
| 45 modes (the number is `MODE_CARD_ORDER.length`) | yes on 14 October 2026 | the landing page's own `{count}`; `npm run launch:check` compares the live count with `docs/ads/copy.json` |
| Vertical 1080×1920 export, MP4 in Chrome and Safari, WebM in Firefox | yes | FAQ q2, `RESOLUTIONS` in `src/lib/settings.ts` |
| Free clips carry a small watermark, Pro removes it | yes | pricing page, `src/lib/watermark/*` |
| Pro $6.99 a month or $49 a year, saves 42% | yes | `PLANS`, `yearlySavingPercent()` |
| Cancel any time | yes for a card (Stripe's portal), a crypto payment is a prepaid period that does not renew | `Billing.pay.cryptoNote`. Say it only while the support mailbox answers (section 12, step 1) |
| Pay by card, Apple Pay, Google Pay or crypto | yes | the live `/config`: stripe and crypto on |
| English, Polish and Spanish | yes | `src/i18n/routing.ts` |
| Every bounce can play a note | yes, "can" | the default sound is a tone, notes follow a chosen melody or scale. Never write "plays a note on every bounce" without "can" |
| A daily challenge | yes | `?daily=1`, the landing page's card |

## 2. Banned claims

Nothing in an ad, a caption, a creative, a landing page link text or the press kit may say or show:

| Banned | Why |
| --- | --- |
| "Go viral", "viral" (any language), guaranteed views, followers, reach or growth | The Disclaimer says the opposite (no guarantee of results). Platforms treat it as a misleading claim and Meta bans asserting a personal attribute ("want to go viral?") |
| Earnings: "earn money", income, "get paid", Creator Rewards, monetisation | No result is promised, and the product has no payout |
| "Best", "number one", "#1", "ultimate", "unlimited", any comparison with a named app, creator or price | Unprovable. The comment in `src/lib/billing/config.ts` that mentions competitors' prices is not for ads |
| PayPal | It is off in the live billing Worker. A line may say "card or crypto" |
| "Publish to TikTok, Instagram and YouTube" | No visitor can connect a channel yet (the relay's `/api/health` lists every platform as off). Say "post", "share" or "export", and never "publish" |
| Fight League, any fighter, and any franchise or character name (Marvel, DC, Nintendo, Pokémon, Star Wars, Thor, Loki and the rest of the roster) | The mode is a fan-made simulation and the names belong to their owners. No ad, creative, hook or press line uses a fighter name or footage of that mode. The bot without `--family` plans escape and rhythm clips only. `--family all` and `--family battle` are the only way to get Fight League clips, so never pass them for the kit and pass `--family escape` or `--family rhythm` (section 7). The landing pages show the mode card too: section 4 says where paid traffic may land until the owner has decided about it |
| Third-party music, platform logos or an "official" or "endorsed by" line | Use the built-in tones and the public-domain melodies. Platform names are used only to say where a clip can go ("for TikTok, Reels and Shorts") |
| The Windows app, until the installer is code signed | Section 3, audience C |
| Other creators' or accounts' names, or a clip title | House rule (`docs/COPY-STYLE.md`) |
| Flashing or strobing visuals | Meta, TikTok and Google police them **[confirm each policy]**. Do not use the `territory` recipe, which burns in a "FLASHING LIGHTS" badge, and preview every clip before upload |
| "Cancel any time" while nobody answers the support mailbox | It is only true with a contact route |

## 3. Audiences

| | Audience | What they want | Where | Status |
| --- | --- | --- | --- | --- |
| A | Creators: people who make TikToks, Reels and Shorts | A clip in a minute without a game engine | TikTok, Meta, YouTube, X | Start here |
| B | Viewers of "satisfying" and ASMR clips | To watch and listen, then try it | Meta Reels, TikTok | Second. Say "tap play and turn the sound on": sound starts only after a tap |
| C | Windows power users | GPU encoding, a render queue, an AI studio | Google, Meta | HOLD. The installer is not code signed, Windows SmartScreen and Chrome warn, and the platforms' software policies are strict about unsigned downloads **[check each policy]** |
| D | People who search | "ball physics simulator", "bouncing ball video maker", "tiktok ball video" | Google Search | Third. Keywords are unvalidated, no volumes were checked. Start with exact and phrase match and add negatives: crack, unity, physics homework, ball sort, steam, minecraft |

Languages: English first. Polish and Spanish are separate campaigns with their own geography (Poland, Spain), their own copy (below) and the landing page `/pl/` or `/es/`. The Spanish is Peninsular ("vídeo", "pelotas"): decide before targeting Latin America. The product is not directed at children (`Privacy.children`): exclude under 18 where the platform allows it.

## 4. Destinations and the UTM naming

Rules, in this order:

1. The destination is always `https://jumpingballslive.com/<locale>/…` with the locale in the path (`en`, `pl`, `es`). Never the bare domain: it only redirects in the browser and replaces the real referrer with the site's own address (measured on the live site on 14 October 2026).
2. Never `/simulator/` for cold traffic: a visitor who has not seen the product lands on the landing page or the gallery first. The simulator is for warm traffic (followers, newsletter, bio link, the daily challenge).
3. Every link carries the UTM names below. The studio keeps them in the address bar (`ATTRIBUTION_PARAMS` in `src/lib/analytics/attribution.ts`: `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`, `utm_id`, `gclid`, `gbraid`, `wbraid`, `fbclid`, `ttclid`, `msclkid`, `twclid`, `rdt_cid`). The ad platforms add their own click ids.
4. Lower case, no spaces. `_` between the words of a campaign, `-` inside a recipe name.

**Open decision, the Fight League card (owner decision B3).** The landing pages `/en/`, `/pl/` and `/es/` show the Fight League mode card in the modes wall, and their FAQ names the mode. The card's picture is a frame with third-party character names, which belong to their owners (section 2 and the legal audit). Until the owner has decided what to do about it, do not send paid traffic from TikTok, Meta or Google to those three pages, and ignore the first row of the table below. The pages that do not show the card are the gallery (its presets have names of their own and none from that mode), `/en/tiktok-ball-videos/`, `/en/pricing/` and `/en/download/` (checked in the code on 14 October 2026: only the landing page has the modes wall and the FAQ, and the studio's mode picker has the card too). None of them pitches the product to a creator as well as the landing page does: the gallery shows finished looks to viewers, the TikTok page is written for search, pricing opens on the price and the download page is for the Windows app, which is on hold. So the honest plan is this. Point Meta's viewer ads at the gallery of the ad's language, point Google Search at `/en/tiktok-ball-videos/`, and hold the TikTok creator ads until the card is dealt with. The three ways out are to take the card and its picture off the landing page, to replace them with a neutral picture and a line that names no character, or to accept the risk after counsel has read the legal audit.

| Audience | Destination | Why |
| --- | --- | --- |
| Creators, social (A) | `/en/`, `/pl/`, `/es/` | The promise, the price line and the live preview in one screen. Nothing on it rewrites the address |
| Viewers (B) | `/en/gallery/` | The best visual page: the preset gallery, each card opens the studio with that preset |
| Creators, search (A, D) | `/en/` and `/en/tiktok-ball-videos/` | The page that answers the search |
| Windows (C, HOLD) | `/en/download/` | Only after signing |
| Warm traffic | `/en/simulator/?daily=1` | Today's challenge, for followers and the bio link, never a paid cold click |

| Parameter | Rule | Values |
| --- | --- | --- |
| `utm_source` | the platform, lower case | `tiktok`, `meta`, `google`, `youtube`, `x`, `reddit`, `bing`, `bio`, `newsletter`, `press`, `creator-<handle>` |
| `utm_medium` | the channel type | `paid_social`, `cpc`, `paid_video`, `organic_social`, `referral`, `email` |
| `utm_campaign` | `YYMM_goal_audience` | `2610_launch_creators`, `2610_launch_satisfying`, `2610_search_creators`, `2610_daily` |
| `utm_content` | `cNN_<recipe>_<ratio>_<secs>s_<locale>` for a clip, `tNN` for a text post | `c01_ring-escape_9x16_15s_en` |
| `utm_term` | Google keyword only | `{keyword}` (ValueTrack) |
| `utm_id` | the platform's campaign id | `{campaignid}` (Google), `__CAMPAIGN_ID__` (TikTok macro), `{{campaign.id}}` (Meta) **[confirm the macros in each UI]** |

Final URLs, one per use (English; for Polish and Spanish change `/en/` to `/pl/` or `/es/` and the last letters of `utm_content`). The rows that land on a landing page (`/en/`, `/pl/`, `/es/`) are on hold until the Fight League decision above:

| Use | Final URL |
| --- | --- |
| TikTok, creators | `https://jumpingballslive.com/en/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=2610_launch_creators&utm_content=c01_ring-escape_9x16_15s_en` |
| Meta, viewers | `https://jumpingballslive.com/en/gallery/?utm_source=meta&utm_medium=paid_social&utm_campaign=2610_launch_satisfying&utm_content=c04_pendulum-wave_9x16_20s_en` |
| Google Search | `https://jumpingballslive.com/en/?utm_source=google&utm_medium=cpc&utm_campaign=2610_search_creators&utm_content={creative}&utm_term={keyword}` |
| Polish, TikTok | `https://jumpingballslive.com/pl/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=2610_launch_creators&utm_content=c01_ring-escape_9x16_15s_pl` |
| Spanish, TikTok | `https://jumpingballslive.com/es/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=2610_launch_creators&utm_content=c01_ring-escape_9x16_15s_es` |
| Warm: the daily challenge | `https://jumpingballslive.com/en/simulator/?daily=1&utm_source=x&utm_medium=organic_social&utm_campaign=2610_daily&utm_content=t01` |
| Warm: a profile's bio link | `https://jumpingballslive.com/en/?utm_source=bio&utm_medium=referral&utm_campaign=2610_bio&utm_content=t02` |
| Windows (HOLD) | `https://jumpingballslive.com/en/download/?utm_source=google&utm_medium=cpc&utm_campaign=2610_windows&utm_content={creative}` |

`npm run launch:check -- --browser` opens the English landing page and the studio with `utm_source` and a click id and checks that both are still in the address after four seconds.

## 5. Copy sets

Every line below is in `docs/ads/copy.json` with its limit, and a test counts it. The column "Chars" is `length / limit` in characters (not bytes). For X the count includes the 23 characters X counts for a link and one space. Voice follows `docs/COPY-STYLE.md`: plain and short, no dashes as punctuation, no semicolons, "satisfying" as the genre word, no other creator named. Polish and Spanish are written as native copy, not as glosses.

Call to action everywhere: **Learn more**, never "Play game" (the product is a tool, not a game) and never "Download" (nothing to install for the web tool). Never name a button after Publish.

### Google Ads: responsive search ads

Limits: up to 15 headlines of 30 characters, up to 4 descriptions of 90, and two display path fields of 15 (Google's help page for responsive search ads, **confirm in Google Ads**). Pin the first headline to position 1 and leave the rest unpinned. Pin the brand headline to position 3 only if brand safety needs it. Final URL: the Google Search row of section 4.

#### English

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Ball Physics Video Maker | 24 / 30 |
| Headline 2 | Satisfying Ball Physics | 23 / 30 |
| Headline 3 | Free in Your Browser | 20 / 30 |
| Headline 4 | No Sign-Up, No Install | 22 / 30 |
| Headline 5 | Vertical 1080×1920 Export | 25 / 30 |
| Headline 6 | Made for TikTok and Reels | 25 / 30 |
| Headline 7 | 45 Ball Physics Modes | 21 / 30 |
| Headline 8 | Make a Ball Video Today | 23 / 30 |
| Headline 9 | Bouncing Ball Video Maker | 25 / 30 |
| Headline 10 | Pick a Mode, Press Play | 23 / 30 |
| Headline 11 | JumpingBallsLive | 16 / 30 |
| Headline 12 | Pro Removes the Watermark | 25 / 30 |
| Headline 13 | Pro from $6.99 a Month | 22 / 30 |
| Headline 14 | Record, Export, Post | 20 / 30 |
| Headline 15 | Try Today's Ball Challenge | 26 / 30 |
| Description 1 | Pick one of 45 modes, tune the physics and press play. Free, in your browser, no account. | 89 / 90 |
| Description 2 | Export vertical 1080×1920 clips for TikTok, Reels and Shorts. Free ones carry a watermark. | 90 / 90 |
| Description 3 | Rings to escape, rhythm machines and duels. Bounces can play notes. Start in seconds. | 85 / 90 |
| Description 4 | Pro removes the watermark for $6.99 a month. Cancel any time. | 61 / 90 |
| Path 1 | ball-physics | 12 / 15 |
| Path 2 | video-maker | 11 / 15 |

Display URL: `jumpingballslive.com/ball-physics/video-maker`. The path is for show: it does not have to exist.

#### Polski

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Kreator filmów z piłkami | 24 / 30 |
| Headline 2 | Satysfakcjonująca fizyka | 24 / 30 |
| Headline 3 | Za darmo w przeglądarce | 23 / 30 |
| Headline 4 | Bez konta i instalacji | 22 / 30 |
| Headline 5 | Pionowy eksport 1080×1920 | 25 / 30 |
| Headline 6 | Gotowe na TikToka i Reels | 25 / 30 |
| Headline 7 | 45 trybów fizyki piłek | 22 / 30 |
| Headline 8 | Zrób film z piłką dziś | 22 / 30 |
| Headline 9 | Wybierz tryb i naciśnij start | 29 / 30 |
| Headline 10 | Pro usuwa znak wodny | 20 / 30 |
| Headline 11 | Pro od 6,99 USD miesięcznie | 27 / 30 |
| Headline 12 | Nagraj, eksportuj, wrzuć | 24 / 30 |
| Headline 13 | Wyzwanie dnia z piłką | 21 / 30 |
| Headline 14 | JumpingBallsLive | 16 / 30 |
| Headline 15 | Symulator fizyki piłek | 22 / 30 |
| Description 1 | Wybierz jeden z 45 trybów, dostrój fizykę i naciśnij start. Za darmo, bez konta. | 80 / 90 |
| Description 2 | Wyeksportuj pionowy klip 1080×1920 pod TikToka, Reels i Shorts. Darmowe mają znak wodny. | 88 / 90 |
| Description 3 | Pierścienie do ucieczki, maszyny rytmu i pojedynki. Każde odbicie może zagrać nutę. | 83 / 90 |
| Description 4 | Pro usuwa znak wodny od 6,99 USD miesięcznie. Zrezygnujesz w każdej chwili. | 75 / 90 |
| Path 1 | fizyka-pilek | 12 / 15 |
| Path 2 | generator-wideo | 15 / 15 |

Display URL: `jumpingballslive.com/fizyka-pilek/generator-wideo`. The path is for show: it does not have to exist.

#### Español

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Creador de vídeos de pelotas | 28 / 30 |
| Headline 2 | Física de pelotas en vídeo | 26 / 30 |
| Headline 3 | Gratis en tu navegador | 22 / 30 |
| Headline 4 | Sin registro ni instalación | 27 / 30 |
| Headline 5 | Exporta en vertical 1080×1920 | 29 / 30 |
| Headline 6 | Listo para TikTok y Reels | 25 / 30 |
| Headline 7 | 45 modos de física de pelotas | 29 / 30 |
| Headline 8 | Crea tu vídeo de pelotas hoy | 28 / 30 |
| Headline 9 | Elige un modo y dale al play | 28 / 30 |
| Headline 10 | Pro quita la marca de agua | 26 / 30 |
| Headline 11 | Pro desde 6,99 US$ al mes | 25 / 30 |
| Headline 12 | Graba, exporta y sube | 21 / 30 |
| Headline 13 | Reto diario de pelotas | 22 / 30 |
| Headline 14 | JumpingBallsLive | 16 / 30 |
| Headline 15 | Simulador de pelotas | 20 / 30 |
| Description 1 | Elige uno de los 45 modos, ajusta la física y dale al play. Gratis y sin cuenta. | 80 / 90 |
| Description 2 | Exporta un clip vertical 1080×1920 para TikTok, Reels y Shorts. Gratis, con marca de agua. | 90 / 90 |
| Description 3 | Anillos de escape, máquinas de ritmo y duelos. Cada rebote puede tocar una nota. | 80 / 90 |
| Description 4 | Pro quita la marca de agua desde 6,99 US$ al mes. Cancela cuando quieras. | 73 / 90 |
| Path 1 | fisica-pelotas | 14 / 15 |
| Path 2 | creador-video | 13 / 15 |

Display URL: `jumpingballslive.com/fisica-pelotas/creador-video`. The path is for show: it does not have to exist.

### Meta (Facebook and Instagram)

Limits: primary text 125 characters visible (the field takes more), headline 27 recommended (40 at most), link description 30. Placements: Reels, Stories and Feed. Call to action: Learn more. The headline of a Reels overlay is shorter than a Feed headline, so keep it short. **Confirm in Ads Manager.**

#### Audience A: creators

**English**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Make satisfying ball physics clips in your browser. Pick a mode, press play, export vertical. | 93 / 125 |
| Headline | Make Ball Physics Videos | 24 / 27 |
| Description | Free, no account | 16 / 30 |

**Polski**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Zrób satysfakcjonujące klipy z fizyką piłek w przeglądarce. Wybierz tryb, naciśnij start, eksportuj. | 100 / 125 |
| Headline | Filmy z fizyką piłek | 20 / 27 |
| Description | Za darmo, bez konta | 19 / 30 |

**Español**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Crea clips satisfactorios de física de pelotas en tu navegador. Elige un modo, dale al play y exporta. | 102 / 125 |
| Headline | Vídeos de física de pelotas | 27 / 27 |
| Description | Gratis y sin cuenta | 19 / 30 |

#### Audience B: viewers of satisfying clips

**English**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Tap play and turn the sound on. Every bounce can play a note. Pick a mode and watch it go, free. | 96 / 125 |
| Headline | Ball Physics You Can Play | 25 / 27 |
| Description | 45 modes, no sign-up | 20 / 30 |

**Polski**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Naciśnij start i włącz dźwięk. Każde odbicie może zagrać nutę. Wybierz tryb i patrz, za darmo. | 94 / 125 |
| Headline | Fizyka piłek do zabawy | 22 / 27 |
| Description | 45 trybów, bez konta | 20 / 30 |

**Español**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Dale al play y activa el sonido. Cada rebote puede tocar una nota. Elige un modo y míralo, gratis. | 98 / 125 |
| Headline | Física de pelotas jugable | 25 / 27 |
| Description | 45 modos, sin registro | 22 / 30 |

#### Audience A, the Classic hook

**English**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | One ball, a stack of rings, one gap each. Will it get out? Make your own clip in a minute. Free. | 96 / 125 |
| Headline | Will It Escape? | 15 / 27 |
| Description | Free, no account | 16 / 30 |

**Polski**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Jedna piłka, stos pierścieni, w każdym jedna szczelina. Ucieknie? Zrób własny klip w minutę. Za darmo. | 102 / 125 |
| Headline | Czy ucieknie? | 13 / 27 |
| Description | Za darmo, bez konta | 19 / 30 |

**Español**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Una pelota, una pila de anillos, un hueco en cada uno. ¿Saldrá? Haz tu clip en un minuto. Gratis. | 97 / 125 |
| Headline | ¿Escapará? | 10 / 27 |
| Description | Gratis y sin cuenta | 19 / 30 |

#### Audience C: the Windows app (HOLD until the installer is code signed)

**English**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | The ball physics studio for Windows. Your graphics card encodes the clips and a queue works through batches for you. | 116 / 125 |
| Headline | Free Windows Download | 21 / 27 |
| Description | Free download | 13 / 30 |

**Polski**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | Studio fizyki piłek na Windows. Karta graficzna koduje klipy, a kolejka przerabia serie za Ciebie. | 98 / 125 |
| Headline | Darmowa aplikacja Windows | 25 / 27 |
| Description | Pobierz za darmo | 16 / 30 |

**Español**

| Field | Text | Chars |
| --- | --- | --- |
| Primary text | El estudio de física de pelotas para Windows. Tu tarjeta gráfica codifica los clips y una cola procesa lotes por ti. | 116 / 125 |
| Headline | App gratis para Windows | 23 / 27 |
| Description | Descarga gratuita | 17 / 30 |

### TikTok Ads

Limits: ad text 100 characters, display name 2 to 20 Latin characters (no emoji). Video 9:16 at 1080×1920, 15 seconds recommended and 60 at most. Call to action: Learn more. Objective: Traffic. **Confirm in TikTok Ads Manager.**

#### English

| Field | Text | Chars |
| --- | --- | --- |
| Ad text 1 | One ball, one gap, a wall that breaks. Make your own ball physics clip. Free in your browser. | 93 / 100 |
| Ad text 2 | Satisfying ball physics in a minute. Pick a mode, press play, export vertical. Free. | 84 / 100 |
| Ad text 3 | Turn the sound on. Every bounce can play a note. Make your own clip, no account. | 80 / 100 |
| Display name | JumpingBallsLive | 16 / 20 |

#### Polski

| Field | Text | Chars |
| --- | --- | --- |
| Ad text 1 | Jedna piłka, jedna szczelina, ściana, która pęka. Zrób własny klip. Za darmo w przeglądarce. | 92 / 100 |
| Ad text 2 | Satysfakcjonująca fizyka piłek w minutę. Wybierz tryb, naciśnij start, eksportuj pionowo. | 89 / 100 |
| Ad text 3 | Włącz dźwięk. Każde odbicie może zagrać nutę. Zrób własny klip, bez konta. | 74 / 100 |
| Display name | JumpingBallsLive | 16 / 20 |

#### Español

| Field | Text | Chars |
| --- | --- | --- |
| Ad text 1 | Una pelota, un hueco, un muro que se rompe. Haz tu clip de física de pelotas. Gratis. | 85 / 100 |
| Ad text 2 | Física de pelotas satisfactoria en un minuto. Elige un modo, dale al play y exporta en vertical. | 96 / 100 |
| Ad text 3 | Activa el sonido. Cada rebote puede tocar una nota. Haz tu clip, sin cuenta. | 76 / 100 |
| Display name | JumpingBallsLive | 16 / 20 |

### X

Limits: a post is 280 characters and a link counts for 23, so the count below is the text, a space and the link. A card headline of 23 characters or less fits every card type. Video: MP4 or MOV, H.264 and AAC. **Confirm in X Ads.**

#### English

| Field | Text | Chars |
| --- | --- | --- |
| Post 1 | Pick a mode, tune the physics, press play. Free in your browser, no account. Export a vertical clip ready to post. | 138 / 280 |
| Post 2 | One ball. A stack of rings. One gap each. Will it get out? Make your own ball physics clip, free. | 121 / 280 |
| Post 3 | Your next TikTok, Reel or Short: a ball, some rings and a note on every bounce. Free to try, no sign-up. | 128 / 280 |
| Card headline | Make Ball Physics Clips | 23 / 23 |

#### Polski

| Field | Text | Chars |
| --- | --- | --- |
| Post 1 | Wybierz tryb, dostrój fizykę, naciśnij start. Za darmo w przeglądarce, bez konta. Eksportuj pionowy klip gotowy do wrzucenia. | 149 / 280 |
| Post 2 | Jedna piłka. Stos pierścieni. W każdym jedna szczelina. Ucieknie? Zrób własny klip z fizyką piłek, za darmo. | 132 / 280 |
| Card headline | Klipy z fizyką piłek | 20 / 23 |

#### Español

| Field | Text | Chars |
| --- | --- | --- |
| Post 1 | Elige un modo, ajusta la física y dale al play. Gratis en tu navegador y sin cuenta. Exporta un clip vertical listo para subir. | 151 / 280 |
| Post 2 | Una pelota. Una pila de anillos. Un hueco en cada uno. ¿Saldrá? Haz tu propio clip de física de pelotas, gratis. | 136 / 280 |
| Card headline | Clips de pelotas | 16 / 23 |

### Reddit

Limits: a promoted post headline takes 300 characters and 150 is the working limit used here. Reddit readers dislike a polished ad: keep the voice flat and say what it is. The link goes in the post, not in the video. Video 5 to 30 seconds at up to 30 fps, image 4:3 at 1440×1080 or 1:1 at 1200×1200. **Confirm in Reddit Ads.**

#### English

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | A free browser tool for satisfying ball physics clips. 45 modes, vertical export, no account. | 93 / 150 |
| Headline 2 | One ball, a stack of rings, one gap each. Make your own escape clip in a minute, free in your browser. | 102 / 150 |
| Headline 3 | Tune the physics, pick a sound, export a vertical clip. Free to play, free clips carry a small watermark. | 105 / 150 |

#### Polski

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Darmowe narzędzie w przeglądarce do klipów z fizyką piłek. 45 trybów, pionowy eksport, bez konta. | 97 / 150 |

#### Español

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Una herramienta gratis en el navegador para clips de física de pelotas. 45 modos, exportación vertical, sin cuenta. | 115 / 150 |

### YouTube Shorts and Demand Gen

Limits: headline 40, long headline 90, description 90, business name 25. Vertical video up to 60 seconds for Shorts. **Confirm in Google Ads.**

#### English

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Make Satisfying Ball Physics Clips | 34 / 40 |
| Headline 2 | Free Ball Physics Video Maker | 29 / 40 |
| Headline 3 | Pick a Mode, Press Play | 23 / 40 |
| Headline 4 | Vertical Clips in Your Browser | 30 / 40 |
| Headline 5 | Pro Removes the Watermark | 25 / 40 |
| Long headline | Make satisfying ball physics clips in your browser. Free, no account, export vertical. | 86 / 90 |
| Description 1 | Pick one of 45 modes, tune the physics and press play. Free, in your browser, no account. | 89 / 90 |
| Description 2 | Export vertical 1080×1920 clips for TikTok, Reels and Shorts. Free ones carry a watermark. | 90 / 90 |
| Business name | JumpingBallsLive | 16 / 25 |

#### Polski

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Klipy z fizyką piłek za darmo | 29 / 40 |
| Headline 2 | Kreator filmów z piłkami | 24 / 40 |
| Headline 3 | Wybierz tryb i naciśnij start | 29 / 40 |
| Headline 4 | Pionowe klipy w przeglądarce | 28 / 40 |
| Headline 5 | Pro usuwa znak wodny | 20 / 40 |
| Long headline | Zrób satysfakcjonujące klipy z fizyką piłek. Za darmo, bez konta, eksport pionowy. | 82 / 90 |
| Description 1 | Wybierz jeden z 45 trybów, dostrój fizykę i naciśnij start. Za darmo, bez konta. | 80 / 90 |
| Description 2 | Wyeksportuj pionowy klip 1080×1920 pod TikToka, Reels i Shorts. Darmowe mają znak wodny. | 88 / 90 |
| Business name | JumpingBallsLive | 16 / 25 |

#### Español

| Field | Text | Chars |
| --- | --- | --- |
| Headline 1 | Clips de física de pelotas gratis | 33 / 40 |
| Headline 2 | Creador de vídeos de pelotas | 28 / 40 |
| Headline 3 | Elige un modo y dale al play | 28 / 40 |
| Headline 4 | Clips verticales en tu navegador | 32 / 40 |
| Headline 5 | Pro quita la marca de agua | 26 / 40 |
| Long headline | Crea clips satisfactorios de física de pelotas. Gratis, sin cuenta, exporta en vertical. | 88 / 90 |
| Description 1 | Elige uno de los 45 modos, ajusta la física y dale al play. Gratis y sin cuenta. | 80 / 90 |
| Description 2 | Exporta un clip vertical 1080×1920 para TikTok, Reels y Shorts. Gratis, con marca de agua. | 90 / 90 |
| Business name | JumpingBallsLive | 16 / 25 |

## 6. Creative specs and safe zones

Limits are third-party figures: **confirm in the platform UI**, which refuses a wrong file anyway.

| Placement | Size | Length | How to get it from the product |
| --- | --- | --- | --- |
| TikTok, Reels, Shorts, Stories | 1080×1920, 30 or 60 fps (30 for Reddit) | 8 to 15 s short, 15 to 30 s standard | The bot (section 7), or the studio: Recording → Recording Resolution `1080×1920 (Vertical, TikTok)` (the default), Duration 10 to 120 s, the fast export |
| Feed, 1:1 | 1080×1080 | 8 to 20 s | The arena is the centred square of the 1080×1920 frame (`exportSquare()` in `src/lib/watermark/layout.ts`). Cut it from a vertical clip with the command below. The studio's own square export is only 500×500: do not upload that |
| Feed, 4:5 | 1080×1350 | 8 to 20 s | The same, with the other crop |
| YouTube, X and Reddit landscape | 1920×1080 | 15 to 30 s | The studio's `1920×1080 (Full HD)` resolution |
| Stills and thumbnails | 1080×1920, 1200×1200, 1200×628 | n/a | A frame of a rendered clip, with the command below |

Cut a square, a 4:5 and a 30 fps copy from a vertical clip (the arena is 1080 pixels wide and starts 420 pixels from the top of the 1920):

```
ffmpeg -i c01_ring-escape_9x16_15s_en.mp4 -vf crop=1080:1080:0:420 -c:a copy c01_ring-escape_1x1_15s_en.mp4
ffmpeg -i c01_ring-escape_9x16_15s_en.mp4 -vf crop=1080:1350:0:285 -c:a copy c01_ring-escape_4x5_15s_en.mp4
ffmpeg -i c01_ring-escape_9x16_15s_en.mp4 -r 30 -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac c01_ring-escape_9x16_15s_en_30fps.mp4
ffmpeg -i c01_ring-escape_9x16_15s_en.mp4 -ss 00:00:08 -frames:v 1 still_9x16.png
```

The crops re-encode the video and copy the audio. Check each result in the platform's preview.

**Safe zones.** The product's own, in `PORTRAIT_SAFE_MARGINS` (`src/lib/watermark/layout.ts`): 6% left, 12.5% right, 8% top and 20% bottom of a vertical frame, which is what the free-tier badge and the bot's hook line respect (the bot keeps every pill out of the bottom 20% and the right 12%: `SAFE_ZONE` in `src/lib/bot/playbook.ts`). **For paid Reels and Stories placements use a larger zone,** about 14% at the top, 35% at the bottom, 40% at the bottom right and 6% at the sides **[one third-party source: confirm in the Ads Manager preview]**, which leaves roughly 950×980 pixels in the middle.

What that means for this product: the arena square spans y 420 to 1500 of the 1920, so its lowest 250 pixels and the free-tier watermark badge (it sits in a lower corner and swaps sides every 6 seconds) are under the platform's own buttons. Keep the hook and the payoff above y 1250. Burn no call to action into the clip: the Top Text and Bottom Text bars are the letterbox and the bottom bar is inside the covered zone. The call to action is the ad's own button and text. For an end card use an animated caption in the middle of the arena for the last two seconds.

Without a Pro licence the clips carry the watermark. That is acceptable for brand recognition and it covers the lower corners, so the payoff must not live there.

## 7. Which clips make the best creatives, and how to produce them

The viral bot (README "Viral video bot", `docs/virality-playbook.md`) plans a clip after what the playbook says works: motion in the first second, the rule on screen in one line, a visible countdown, a payoff at 80 to 90% of the clip and a recurring cast. Use these recipes, with the resolved ending, 15 to 30 seconds (the `standard` length bucket) or 8 to 15 seconds (`short`):

| Recipe | Family | Why | A date it leads the day | Command |
| --- | --- | --- | --- | --- |
| `ring-escape` | escape | The classic for creators: a ball, rings with one gap each, will it get out? It plays Classic, Portal or Accumulation. | 2026-10-17 | `node scripts/viral-bot.mjs --date 2026-10-17 --count 1 --family escape --platform tiktok --bucket standard --ending resolved --out ads-bot-output` |
| `multipliers-board` | escape | For creators: a board of multipliers, a clear counter, a payoff when the board breaks. | 2026-10-15 | `node scripts/viral-bot.mjs --date 2026-10-15 --count 1 --family escape --platform tiktok --bucket standard --ending resolved --out ads-bot-output` |
| `grow-fill` | escape | For viewers of satisfying clips: the ball grows with every bounce until it fills the ring. | 2026-10-19 | `node scripts/viral-bot.mjs --date 2026-10-19 --count 1 --family escape --platform tiktok --bucket standard --ending resolved --out ads-bot-output` |
| `pendulum-wave` | rhythm | For viewers: pendulums drift out of step and meet again in a chord. Sound is the hook, so the ad says to turn it on. | 2026-10-15 | `node scripts/viral-bot.mjs --date 2026-10-15 --count 1 --family rhythm --platform tiktok --bucket standard --ending resolved --out ads-bot-output` |
| `drop-symphony` | rhythm | For viewers: balls fall through pegs and every peg is a note. Sound is the hook. | 2026-10-17 | `node scripts/viral-bot.mjs --date 2026-10-17 --count 1 --family rhythm --platform tiktok --bucket standard --ending resolved --out ads-bot-output` |
| `glass-smash` | rhythm | For creators: Gerald, the bot's own ball with a face, drops through floors of glass and every landing cracks a pane. | 2026-10-14 | `node scripts/viral-bot.mjs --date 2026-10-14 --count 1 --family rhythm --platform tiktok --bucket standard --ending resolved --out ads-bot-output` |

The hook lines, as the bot writes them (`ViralBot.recipes.<recipe>.hook` in `messages/*.json`; the `{…}` parts come from the plan, so each clip states its own numbers):

| Recipe | English | Polski | Español |
| --- | --- | --- | --- |
| `ring-escape` | Can it escape in {seconds} seconds? | Czy ucieknie w {seconds} s? | ¿Escapará en {seconds} segundos? |
| `multipliers-board` | x2 x4 x8… until it breaks. | x2 x4 x8… aż pęknie. | x2 x4 x8… hasta que reviente. |
| `grow-fill` | It grows every bounce. Watch it fill the ring. | Rośnie z każdym odbiciem. Patrz, jak wypełni krąg. | Crece con cada rebote. Mira cómo llena el anillo. |
| `pendulum-wave` | {count} pendulums. Wait for the chord. | Wahadła: {count}. Czekaj na akord. | {count} péndulos. Espera al acorde. |
| `drop-symphony` | {count} balls. Every peg is a note. | Piłki: {count}. Każdy kołek to nuta. | {count} pelotas. Cada clavo es una nota. |
| `glass-smash` | Gerald vs {stages} floors of glass. | Gerald kontra piętra szkła: {stages}. | Gerald contra {stages} pisos de cristal. |

Every command above plans exactly that recipe for that date: the bot's plan is a function of the date, the family, the count and the length bucket (`daySlots()` in `src/lib/bot/planner.ts`), so the same date always gives the same recipe, and `tests/adCopy.test.ts` re-computes the plan for every row. A recipe comes back on a fixed cycle (escape recipes every 6 days, rhythm recipes every 4 days: the rotation is in `node scripts/viral-bot.mjs --plan --date 2026-10-14 --family escape --count 1 --platform tiktok --bucket standard`). Use `--locale pl` or `--locale es` for Polish and Spanish: the studio then loads in that language and the hook, the captions and the hashtags are in it.

**Always pass `--family escape` or `--family rhythm`.** Without `--family` the bot plans escape and rhythm clips and no Fight League clip (the legal audit), while `--family all` and `--family battle` plan Fight League clips (fight-duel, fight-upset, fight-bracket, fight-boss), which this kit never uses. The battle family also holds the `territory` recipe with its flashing badge.

**How to produce, four ways** (a clean video needs a Pro licence: without one the clips carry the watermark):

1. **Studio, one clip.** Pick the mode, set Top Text to the hook line, leave the Recording Resolution at `1080×1920 (Vertical, TikTok)`, record or use the fast export (offline, frame exact, the same seed gives the same frames).
2. **Studio, a set.** Recording → Batch Render: one ZIP of clips with their seeds.
3. **Command line, the whole kit.** Needs a served build of the site, Playwright's Chromium and ffmpeg. `BOT_LICENSE` is your licence key (the pricing page, Copy licence key). Serve the site with `npm run build && npm start` or point `BASE_URL` at the live site, then:

```
BASE_URL=http://localhost:3000 BOT_LICENSE=<your licence key> node scripts/viral-bot.mjs --count 4 --platform tiktok --family escape --bucket standard --ending resolved --out ads-bot-output
```

   It renders each clip with the fast export, converts a WebM to MP4 (H.264 and AAC) with ffmpeg, and writes a caption file per clip, `manifest.json` and `posting-schedule.md`. `--dry-run` plans in Node without a browser and writes only the text files, which is a quick way to see which recipe and which hook a date gives.
4. **Windows app, the render queue** with the source "Viral bot plan" (GPU encoding, resumes after a restart).

The bot prints each clip's plan (recipe, mode, seed, length, payoff time, score from 0 to 100 and the hook) and names the files `ep016-1-glass-smash-23087698.mp4`: the episode, the clip, the recipe and the seed. A clip marked `(closest)` met no seed in the search that fits the length and the payoff exactly: add `--max-seeds 100` or take another date. Every command on this page was run on 14 October 2026 against a build of this repository (`--dry-run` for all six recipe rows, and one full render of `glass-smash`: 1080×1920 at 60 fps, H.264 and AAC, with the crops and the still below cut from it).

**Name every creative as its `utm_content`** (rename the file the bot wrote): `c01_ring-escape_9x16_15s_en.mp4`. Test three hook lines per recipe and the resolved ending against the cut-before-the-result ending (the bot alternates them when `--ending` is left at `auto`).

**Do not use:** any `battle` family recipe (Fight League and the flashing badge), the `race` recipes (the 3-2-1 gate opens at 1.8 s, so the first impact comes late: `docs/virality-playbook.md`), and any clip with a song other than the built-in tones and the public-domain melodies. The mascot of the bot's clips is Gerald, the ball with a face. Who owns the artwork of Gerald and of the Gerald persona is for the owner to confirm with counsel (the legal audit lists it as unverified).

## 8. Measurement, phase A: no pixels

Phase A uses no ad-platform pixel, sets no cookie and shows no consent banner. The privacy policy says the site shares nothing with ad networks, the audience is in the EU and counsel has not signed off on pixels, so phase A is: UTM names, a cookie-free counter, the platforms' own numbers and Stripe's.

**What is counted**

| Where | What | Needs |
| --- | --- | --- |
| The ad platform | impressions, clicks, spend, video views, cost per click | nothing |
| Cloudflare Web Analytics | page views and referrers, no events | added at the edge by Cloudflare, not by this repository |
| The statistics service, if the owner installs one (Plausible or Umami) | sessions by `utm_campaign` and `utm_content`, and the events `sim_start`, `clip_export`, `checkout_start`, `purchase` | `NEXT_PUBLIC_ANALYTICS_SCRIPT_URL` and `NEXT_PUBLIC_ANALYTICS_SITE_ID` (the VPS: `JBL_ANALYTICS_SCRIPT_URL`, `JBL_ANALYTICS_SITE_ID`). The README table "Analytics events" lists what is sent. Off for visitors who send Do Not Track or Global Privacy Control, and off in the Windows app |
| Stripe | payments and refunds | nothing |
| GitHub | the Windows app's downloads: `gh api repos/CronusAztec/jumpingballslive-windows/releases --jq '.[].assets[]\|{name,download_count}'` | the GitHub CLI; `latest.yml` is fetched by every installed app on each update check, so its count is an active-install proxy |

**How to read it.** Choose the objective Traffic or Video views on every platform: there is no conversion objective without a pixel. Every day, write down the spend and the clicks of each ad from the platform, and the sessions, `sim_start` and `clip_export` of the same `utm_content` from the statistics service. A `purchase` is attributed by the service's session, which is right when the buyer comes back from the checkout within the same visit and misses a crypto payment that confirms later: reconcile payments by day against Stripe and the ad spend, and accept the loss in phase A.

**Phase B** (later, and only with a consent banner, counsel's review and a change to the billing Worker): carry `utm_campaign` and the click id into the Stripe Checkout Session, then send conversions from the server (Meta Conversions API, TikTok Events API, Google offline import). The privacy text must change at the same time. Nothing in this kit needs it.

## 9. KPIs and the test plan

The funnel, all on the web: impression → click → landing view → `sim_start` → `clip_export` → `unlock_open` → `checkout_start` → `purchase`. Read the cost per click, per `sim_start`, per `clip_export` and per `purchase`, the refund rate (a first card payment is refundable for 14 days), and the share rate (`share_copy` per `clip_export`).

**No baseline exists** in the repository or on the live site. Set targets after the first 7 days and promise none. A reading is worth nothing before about 100 clicks per cell.

Test one variable at a time, 3 to 5 days each, with an equal budget in each cell:

| # | Variable | Cells |
| --- | --- | --- |
| 1 | The hook line | ring-escape against multipliers-board, the same copy and audience |
| 2 | The ending | resolved against cut-before-the-result |
| 3 | The destination | `/en/` against `/en/gallery/` |
| 4 | The Search headline | "Free in Your Browser" against "Pro Removes the Watermark" |
| 5 | The language | English against Polish against Spanish, as separate geography campaigns |

Stop rule: pause a cell after 300 clicks with no `clip_export`. That points at the destination, not the creative.

## 10. Launch-day checklist

1. [ ] `npm run go-live:check` is green (payments, Worker, keys).
2. [ ] `npm run launch:check` has no FAIL, and its WARNs are understood. Run it with `--browser` once for the campaign parameters. What must be green before spending is listed in `docs/GO-LIVE.md`, section 14.2.
3. [ ] <https://jumpingballslive.com/build.txt> and <https://jumpingballslive.com/version.json> name the commit you intend to advertise.
4. [ ] A real card payment in live mode and a refund have been tested (`docs/GO-LIVE.md`, section 6c).
5. [ ] Each ad's final URL has been opened on a phone: the page loads fast and the campaign parameters are still in the address after 5 seconds.
6. [ ] With the statistics service installed: it receives `clip_export`, `checkout_start` and `purchase` from a real browser, and nothing from a browser that sends Do Not Track or from the Windows app. The privacy page names the service.
7. [ ] The support mailbox answers and shows on the privacy, terms and pricing pages and on the press page.
8. [ ] The pricing page and the ad say the same: card or crypto, no PayPal, no Publish.
9. [ ] The ad previews were checked for safe zones and for flashing.
10. [ ] Budgets are capped per day and per campaign. A person who can pause everything is named.
11. [ ] Stripe and Cloudflare alerts are on.

## 11. Compliance checklist

- **Claims and "free".** The watermark and the price are stated above the fold of the landing page (the hero's price line). No PayPal, no Publish. "Cancel any time" is true for a card only.
- **Substantiation.** No "viral", no comparative price claims, no "best". Platform names are descriptive only, and the Disclaimer says the site is not affiliated with them.
- **Intellectual property.** No Fight League, no third-party music, no platform logos in a creative. Counsel reviews the use of "TikTok", "Reels" and "Shorts" in ad text (Google keeps a trademark complaint list).
- **Privacy and consent.** Phase A has no pixels and no cookies. The action counter (the statistics service) honours Do Not Track and Global Privacy Control and is off in the Windows app. Cloudflare Web Analytics, which the edge adds to page views, honours neither signal. Do not declare "honours Do Not Track" for the whole of phase A in an ad platform's data-practice form. A pixel needs a consent banner and a change to the privacy policy first.
- **Photosensitivity.** No flashing recipes. Preview each clip.
- **Payments.** The refund rule is one rule on the pricing page (`Billing.notes.refunds`), in the terms (`Billing.terms.refunds`) and here: a first card payment is refunded in full when asked within 14 days, and renewals and crypto payments are not refundable unless the law of the buyer's country says so. The wording is reviewed against the EU withdrawal rules for digital content. The statement descriptor, VAT and sales tax are set up (`docs/GO-LIVE.md`, sections 12 and 13).
- **Business identity and contact.** The operator's name, address and support e-mail are visible (the variables `JBL_LEGAL_NAME`, `JBL_LEGAL_ADDRESS`, `JBL_SUPPORT_EMAIL`) and the advertiser accounts use the same name and address.
- **Children.** The product is not directed at children under 13 (`Privacy.children`): exclude under 18 where the platform allows it.
- **Software distribution.** The installer is unsigned (`Desktop.smartScreenBody`): no Windows ad until it is signed. Checksums are published with every release.

## 12. Owner steps

Only the owner can do these. They are in order.

1. **The support mailbox and the operator's details.** Create the support address (Cloudflare → Email Routing → forward `support@jumpingballslive.com` to an inbox that someone reads). On the VPS put `JBL_SUPPORT_EMAIL`, `JBL_FEEDBACK_EMAIL`, `JBL_LEGAL_NAME` and `JBL_LEGAL_ADDRESS` in `/etc/jbl-deploy/env`, then rebuild the live commit: `sudo -u jbldeploy /opt/jbl-deploy/jbl-deploy.sh --sha "$(cat /var/lib/jbl-deploy/last-ok)"`. Check with `curl -s https://jumpingballslive.com/en/privacy/ | grep -c mailto`. Without these the site has no way to be reached, and ad platforms and card networks expect one.
2. **The canonical redirects.** http → https and `www.jumpingballslive.com` → `jumpingballslive.com` are made by the site's own Worker (`worker/redirects.mjs`) from website 1.11.1 on: deploy that build and `npm run launch:check` (A10) confirms both. The dashboard settings (SSL/TLS → Always Use HTTPS, Rules → Redirect Rules) are optional now.
3. **The statistics service.** Choose Plausible or Umami (Cloudflare Web Analytics cannot count events), install it (hosted, or on the VPS), set `JBL_ANALYTICS_SCRIPT_URL` and `JBL_ANALYTICS_SITE_ID` in `/etc/jbl-deploy/env`, redeploy as in step 1, create the goals `clip_export`, `checkout_start` and `purchase`, and check with a real browser. The privacy policy names the service by the script's host. Before spending, confirm in the service's dashboard that it stores no query string other than `utm_*` (the studio's address also carries the run's settings, and the service sees the whole address), and that the receipt reference of a checkout return (`?claim=` and `ref=`) never appears in it: the site keeps the script off while that reference is in the address.
4. **PayPal and Publish.** Decide PayPal: turn it on in the billing Worker (then restore it in the legal copy, `docs/GO-LIVE.md` section 12), or leave it off and keep it out of every ad. Decide Publish: register the TikTok, Meta and Google apps and pass their reviews, or keep selling "share" and "export" only.
5. **Code signing.** Buy a code-signing certificate and set `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` (`docs/GO-LIVE.md`, section 11) before any Windows ad.
6. **Ad accounts and verification.** Google Ads (advertiser verification with the legal name and country), Meta Business (business verification, domain verification with a DNS TXT record in Cloudflare, and the beneficiary and payer for the EU), TikTok Ads (a business account). Use the same legal name and address everywhere. Verify the domain in Google Search Console (`docs/GO-LIVE.md`, section 14.1). Create the brand handles (TikTok, Instagram, YouTube, X, Reddit): the site's structured data carries `sameAs` once they exist.
7. **Counsel.** Have a lawyer review the privacy text, the refund text, the use of "TikTok", "Reels" and "Shorts" in ads, and the Fight League notice.
8. **The creatives.** Render the set (section 7), name each file as its `utm_content`, preview each in the platform's preview for safe zones and for flashing, and upload it with the copy of section 5.
9. **Launch small.** One campaign per platform, one audience, three creatives and a daily cap. Read the results after 7 days (section 9).
