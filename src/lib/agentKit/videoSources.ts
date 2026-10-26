/*
 * --- inspiration --- The video sources of the agent toolbox's inspiration tools (trending, fetch-video, inspire; analyse
 * and frames with a url). The owner wants agents to take inspiration from other creators' trending and viral simulation
 * videos, analyse them and make our clips better (AGENTS.md, the owner's decisions). Pure: yt-dlp's command lines as
 * argument arrays (no shell, built here and nowhere else, unit-tested in tests/inspiration.test.ts), the check every video
 * link passes, and the parsers of what yt-dlp prints (one JSON object per line). scripts/agent/videoSources.mjs runs yt-dlp
 * and hands its output here.
 *
 *  - A link is http: or https: with a host name, no user name or password, no space or control character, at most
 *    URL_MAX_CHARS, and never this machine or its private network (localhost, a literal loopback, private, link-local or
 *    shared address in any IPv4 or IPv6 spelling, a name without a dot or under a private suffix such as .local or
 *    .internal, a name that spells a private address first such as 127.0.0.1.nip.io): yt-dlp fetches whatever it is given,
 *    so a link must not reach a service on the machine it runs on. Before yt-dlp runs, scripts/agent/videoSources.mjs also
 *    refuses a host that resolves to such an address (isPrivateAddress). That is a check of the link and of where its host
 *    resolves when it is checked, not a firewall: yt-dlp resolves the name again and follows redirects.
 *  - Every yt-dlp run ignores the user's and the system's yt-dlp configuration (--ignore-config: a config could name another
 *    output folder or an --exec command) and keeps no cache (--no-cache-dir: it writes nothing outside .agent-out/).
 *  - A link always follows `--`, so a link that looks like an option is never read as one.
 *  - One video per link: every page read and every download takes the first entry of a list at most (--playlist-items 1),
 *    so a playlist, channel, profile, hashtag or search page never runs through all of its videos, and a link that turns
 *    out to be such a list is refused with a clear error (listLinkError).
 * Titles and channel names are other people's text: they are cut to TEXT_MAX_CHARS, stripped of control characters and only
 * ever reported as data.
 */

export type VideoPlatform = "youtube" | "tiktok" | "instagram" | "other";
/** Where a video row came from: a search, the hashtag's Shorts feed, or a link the caller gave. */
export type VideoSource = "search" | "shorts" | "url";

export const URL_MAX_CHARS = 2048;
export const QUERY_MAX_CHARS = 200;
export const TEXT_MAX_CHARS = 200;
/** The longest video that counts as short-form (YouTube Shorts run up to three minutes). */
export const SHORT_MAX_SEC = 180;
export const DEFAULT_QUERY = "ball simulation";

export type VideoUrlCheck = { ok: true; url: string; platform: VideoPlatform } | { ok: false; error: string };

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Whether a dotted IPv4 address is this machine, its private network, link-local, shared (CGNAT) or not routable. */
function privateIpv4(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** --- inspiration --- Names only a private network answers: special-use or never delegated (printer.local, metadata.google.internal). */
const PRIVATE_SUFFIXES = ["local", "localdomain", "internal", "intranet", "lan", "home", "corp", "private", "home.arpa"];

/** Whether a URL's host name (as URL.hostname writes it) is this machine or its private network. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  const v4 = IPV4.exec(host);
  if (v4) return privateIpv4(Number(v4[1]), Number(v4[2]));
  if (!host.includes(":")) {
    // --- inspiration --- a name without a dot (intranet), under a private suffix, or spelling a private address first
    // (127.0.0.1.nip.io, 10-0-0-1.sslip.io: wildcard names that answer with the address they spell)
    if (!host.includes(".")) return true;
    if (PRIVATE_SUFFIXES.some((x) => host === x || host.endsWith(`.${x}`))) return true;
    const spelled = /^(\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-](\d{1,3})[.-]/.exec(host);
    return !!spelled && spelled.slice(1).every((p) => Number(p) <= 255) && privateIpv4(Number(spelled[1]), Number(spelled[2]));
  }
  if (host === "::" || host === "::1" || /^f[cd][0-9a-f]{0,2}:/.test(host) || /^fe[89a-f][0-9a-f]?:/.test(host)) return true;
  // --- inspiration --- multicast; IPv4-compatible (::/96: URL writes [::127.0.0.1] as ::7f00:1); IPv4-translated
  // (::ffff:0:0/96); NAT64 (64:ff9b::/96 and the local-use 64:ff9b:1::/48): never a public video site's address
  if (/^ff[0-9a-f]{2}:/.test(host) || /^::([0-9a-f]{1,4}(:[0-9a-f]{1,4})?)?$/.test(host) || /^::ffff:0:/.test(host) || /^64:ff9b:/.test(host)) return true;
  // 6to4 (2002::/16) of a private IPv4 address
  const sixToFour = /^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4})(:|$)/.exec(host);
  if (sixToFour) {
    const hi = parseInt(sixToFour[1], 16);
    if (privateIpv4(hi >> 8, hi & 0xff)) return true;
  }
  // an IPv4 address in IPv6 clothing (URL writes ::ffff:127.0.0.1 as ::ffff:7f00:1)
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    return privateIpv4(hi >> 8, hi & 0xff);
  }
  const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
  return dotted ? isPrivateHost(dotted[1]) : false;
}

/**
 * --- inspiration --- Whether an address a host name resolves to (dns.lookup's answer: dotted IPv4, or IPv6 in any spelling,
 * with or without a zone) is this machine or its private network; anything that is not an address counts as private.
 */
export function isPrivateAddress(address: string): boolean {
  const a = String(address).trim().toLowerCase().replace(/%.*$/, "");
  if (!a.includes(":")) return IPV4.test(a) ? isPrivateHost(a) : true;
  try {
    return isPrivateHost(new URL(`http://[${a}]/`).hostname);
  } catch {
    return true;
  }
}

/** The platform a host name belongs to. */
export function platformOfHost(hostname: string): VideoPlatform {
  const h = hostname.toLowerCase().replace(/\.$/, "");
  const is = (domain: string) => h === domain || h.endsWith(`.${domain}`);
  if (is("youtube.com") || is("youtu.be") || is("youtube-nocookie.com")) return "youtube";
  if (is("tiktok.com")) return "tiktok";
  if (is("instagram.com")) return "instagram";
  return "other";
}

/** A video link checked (see the header): the normalised link and its platform, or why it is refused. */
export function checkVideoUrl(input: unknown): VideoUrlCheck {
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return { ok: false, error: "No link given" };
  if (text.length > URL_MAX_CHARS) return { ok: false, error: `The link is ${text.length} characters long; at most ${URL_MAX_CHARS}` };
  if (/[\s\u0000-\u001f\u007f]/.test(text)) return { ok: false, error: "The link has a space or a control character" };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: `"${text.slice(0, 60)}" is not a link (http:// or https://)` };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, error: `Only http: and https: links are fetched, not ${url.protocol}` };
  if (url.username || url.password) return { ok: false, error: "A link with a user name or password is refused" };
  if (!url.hostname) return { ok: false, error: "The link has no host" };
  if (isPrivateHost(url.hostname)) return { ok: false, error: `${url.hostname} is this machine or its private network: only public video sites are fetched` };
  url.hash = "";
  return { ok: true, url: url.href, platform: platformOfHost(url.hostname) };
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

/** The platform's own id of a video in its link (a YouTube video or Short, a TikTok, an Instagram reel or post), else null. */
export function videoIdOfUrl(link: string): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const platform = platformOfHost(url.hostname);
  const parts = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (platform === "youtube") {
    if (url.hostname.toLowerCase().endsWith("youtu.be")) id = parts[0] ?? null;
    else if (url.searchParams.get("v")) id = url.searchParams.get("v");
    else if (["shorts", "embed", "live", "v"].includes(parts[0] ?? "")) id = parts[1] ?? null;
  } else if (platform === "tiktok") {
    const at = parts.findIndex((p) => p === "video" || p === "photo" || p === "v");
    id = at >= 0 ? (parts[at + 1] ?? null) : null;
    if (id && !/^\d+$/.test(id)) id = id.replace(/\.html$/, "");
  } else if (platform === "instagram") {
    const at = parts.findIndex((p) => ["reel", "reels", "p", "tv"].includes(p));
    id = at >= 0 ? (parts[at + 1] ?? null) : null;
  }
  return id && ID.test(id) ? id : null;
}

/** A short, stable hash of a text (FNV-1a, 32 bits, hex): a name for a link without an id of its own. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** The key two rows of one video share (the dataset and the ranking deduplicate by it): platform:id, else the link itself. */
export function videoKey(platform: VideoPlatform, id: string | null, link: string): string {
  if (id && ID.test(id)) return `${platform}:${id}`;
  try {
    const url = new URL(link);
    url.hash = "";
    return `${platform}:${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
  } catch {
    return `${platform}:${link}`;
  }
}

/** The file name a downloaded video gets in .agent-out/inbox/ (without its extension): <platform>-<id>. */
export function videoFileName(meta: { platform: VideoPlatform; id: string | null; url: string }): string {
  const id = meta.id && ID.test(meta.id) ? meta.id : textHash(meta.url);
  return `${meta.platform}-${id}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
}

/** A search query checked: one line of at most QUERY_MAX_CHARS, spaces collapsed. */
export function checkQuery(input: unknown): { ok: true; query: string } | { ok: false; error: string } {
  const text = typeof input === "string" ? input.replace(/\s+/g, " ").trim() : "";
  if (!text) return { ok: false, error: "The query is empty" };
  if (text.length > QUERY_MAX_CHARS) return { ok: false, error: `The query is longer than ${QUERY_MAX_CHARS} characters` };
  if (/[\u0000-\u001f\u007f]/.test(text)) return { ok: false, error: "The query has a control character" };
  return { ok: true, query: text };
}

/** yt-dlp's YouTube search for `count` results of `query`. */
export function searchTarget(query: string, count: number): string {
  return `ytsearch${Math.max(1, Math.floor(count))}:${query}`;
}

/** --- inspiration --- The words of a query a hashtag is made of: without "shorts" (the feed is the Shorts one already). */
const tagWords = (query: string) =>
  query
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w && w !== "shorts" && w !== "short");

const feedOf = (words: readonly string[]) => {
  const tag = words.join("").slice(0, 100);
  return tag ? `https://www.youtube.com/hashtag/${encodeURIComponent(tag)}/shorts` : null;
};

/** The YouTube Shorts feed of the query as a hashtag (ball simulation → #ballsimulation), null when no letter is left. */
export function shortsFeedUrl(query: string): string | null {
  return feedOf(tagWords(query));
}

/**
 * --- inspiration --- The Shorts feeds to try in turn, until one has videos: the whole query's hashtag, then the hashtags of
 * its last two and its first two words (a long query is seldom a tag: "satisfying physics simulation shorts" has no feed,
 * #physicssimulation has), at most three, none twice.
 */
export function shortsFeedUrls(query: string): string[] {
  const words = tagWords(query);
  const tries = [words, words.length > 2 ? words.slice(-2) : [], words.length > 2 ? words.slice(0, 2) : []];
  return [...new Set(tries.map(feedOf).filter((u): u is string => u !== null))];
}

/** What every yt-dlp run starts with (see the header). */
export const YTDLP_BASE: readonly string[] = ["--ignore-config", "--no-cache-dir"];

/** A search or feed listed flat (one line per video: its link, title, views and length when the site shows them). */
export function ytListArgs(target: string, count: number): string[] {
  if (/[\0\r\n]/.test(target)) throw new Error("The search has a control character");
  return [...YTDLP_BASE, "--flat-playlist", "--dump-json", "--playlist-end", String(Math.max(1, Math.floor(count))), "--", target];
}

/**
 * --- inspiration --- One video per link (see the header): --no-playlist reads the video of a link that names a video and a
 * playlist, and --playlist-items 1 reads only the first entry of a link that names a list alone (a playlist, a channel or
 * its Shorts tab, a TikTok profile, a hashtag or a search page), never every entry.
 */
export const ONE_VIDEO: readonly string[] = ["--no-playlist", "--playlist-items", "1"];

/**
 * Each video's own page, one JSON line per link, nothing downloaded: likes, comments, upload date, length. A link that fails
 * is skipped (--ignore-errors) and its error printed; a page without playable formats still gives its numbers
 * (--ignore-no-formats-error), and YouTube's mobile web client is asked too, which answers where the default clients meet a
 * bot check.
 */
export function ytInfoArgs(urls: readonly string[]): string[] {
  for (const u of urls) if (!checkVideoUrl(u).ok) throw new Error(`Not a video link yt-dlp may fetch: ${u.slice(0, 80)}`);
  return [...YTDLP_BASE, "--dump-json", "--skip-download", ...ONE_VIDEO, "--ignore-no-formats-error", "--ignore-errors", "--extractor-args", "youtube:player_client=default,mweb", "--", ...urls];
}

/**
 * --- inspiration --- Whether a page yt-dlp printed is an entry of a list (a playlist, a channel, a profile, a hashtag or a
 * search page, or a post of several clips) rather than a lone video: a lone video's page has no playlist_index.
 */
export function isListEntry(info: Record<string, unknown>): boolean {
  return info._type === "playlist" || info._type === "multi_video" || typeof info.playlist_index === "number" || (typeof info.playlist_id === "string" && info.playlist_id !== "");
}

/**
 * --- inspiration --- Why a link is refused when its page is a list's entry, null when it is not, or when the link names one
 * video by its own id (an Instagram post of several clips gives its first clip): a list is never fetched as a video.
 */
export function listLinkError(link: string, info: Record<string, unknown>): string | null {
  if (!isListEntry(info) || videoIdOfUrl(link) !== null) return null;
  const name = cleanText(info.playlist_title) ?? cleanText(info.playlist);
  return `${link.slice(0, 200)} is a list of videos${name ? ` ("${name}")` : ""} – a playlist, channel, profile, hashtag or search page – not one video: give the link of one video (trending finds a search's and a hashtag feed's videos)`;
}

/**
 * --- inspiration --- Which of the links yt-dlp was given a list entry's page came from: the one its playlist_webpage_url
 * names (a channel link may come back as one of its tabs: /@name as /@name/videos), else null. An entry's original_url is
 * the entry's own link, never the list's.
 */
export function listLinkOf(links: readonly string[], info: Record<string, unknown>): string | null {
  const page = typeof info.playlist_webpage_url === "string" ? checkVideoUrl(info.playlist_webpage_url) : null;
  if (!page?.ok) return null;
  const trim = (u: string) => u.replace(/\/+$/, "");
  const exact = links.find((l) => trim(l) === trim(page.url));
  if (exact) return exact;
  return links.find((l) => !/[?#]/.test(l) && trim(page.url).startsWith(`${trim(l)}/`)) ?? null;
}

export interface DownloadPlan {
  url: string;
  /** The folder the file is written to (a fresh one inside .agent-out/inbox/). */
  dir: string;
  /** The bare file name, without its extension (videoFileName). */
  name: string;
  /** The picture's shorter side at most, in px (yt-dlp's `res`: 1080 keeps a 1080 × 1920 short whole). */
  maxHeight: number;
  /** ffmpeg for merging and remuxing into MP4: its path, "" for the one on the PATH, null for none (one file as it comes). */
  ffmpeg: string | null;
}

/**
 * One video downloaded into `dir`/`name`.<ext> with its info JSON beside it, the final path printed on stdout. With ffmpeg:
 * the best video and audio up to maxHeight, H.264 and AAC preferred, merged or remuxed into MP4; without it: the best single
 * file. `%` in the folder is escaped (yt-dlp's output template would read it as a field).
 */
export function ytDownloadArgs(p: DownloadPlan): string[] {
  const link = checkVideoUrl(p.url);
  if (!link.ok) throw new Error(link.error);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(p.name)) throw new Error("The file name must be a bare name (letters, digits, _ -)");
  if (!p.dir || /[\0\r\n]/.test(p.dir)) throw new Error("The folder is empty or has a control character");
  const height = Math.max(1, Math.floor(p.maxHeight));
  const ffmpeg = p.ffmpeg !== null;
  const dir = p.dir.replace(/[\\/]+$/, "").replace(/%/g, "%%");
  return [
    ...YTDLP_BASE,
    ...ONE_VIDEO,
    "--no-progress",
    "--no-mtime",
    "--format",
    ffmpeg ? "bv*+ba/b" : "b",
    "--format-sort",
    `res:${height},vcodec:h264,acodec:aac,ext:mp4:m4a`,
    ...(ffmpeg ? ["--merge-output-format", "mp4", "--remux-video", "mp4"] : []),
    ...(p.ffmpeg ? ["--ffmpeg-location", p.ffmpeg] : []),
    "--write-info-json",
    "--no-write-playlist-metafiles",
    "--no-write-comments",
    "--output",
    `${dir}/${p.name}.%(ext)s`,
    "--print",
    "after_move:filepath",
    "--",
    link.url,
  ];
}

/** The JSON objects of yt-dlp's stdout, one per line (a line that is not an object is skipped). */
export function parseJsonLines(stdout: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("{")) continue;
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === "object" && !Array.isArray(v)) out.push(v as Record<string, unknown>);
    } catch {
      /* a cut-off line: skipped */
    }
  }
  return out;
}

/** yt-dlp's ERROR lines (what it could not do), each cut to 300 characters, at most `max`. */
export function ytErrorLines(stderr: string, max = 5): string[] {
  return stderr
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("ERROR:"))
    .map((l) => l.slice(6).trim().slice(0, 300))
    .slice(0, max);
}

/** Other people's text as data: control characters and runs of spaces collapsed, at most TEXT_MAX_CHARS. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]+/g, " ").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, TEXT_MAX_CHARS) : null;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
const positive = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface VideoMeta {
  /** platform:id – what the ranking and the dataset deduplicate by. */
  key: string;
  url: string;
  platform: VideoPlatform;
  id: string | null;
  title: string | null;
  channel: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  durationSec: number | null;
  /** YYYY-MM-DD. */
  uploadDate: string | null;
  /** Days since the upload (a video of today counts one day). */
  ageDays: number | null;
  viewsPerDay: number | null;
  /** Likes per view. */
  likeRate: number | null;
  width: number | null;
  height: number | null;
  /** Short-form: at most SHORT_MAX_SEC, and a Short, a TikTok, a reel or a portrait picture. */
  short: boolean;
  source: VideoSource;
  /** The numbers are from the video's own page (yt-dlp -j), not only a search or feed row (a feed rounds its view counts). */
  detailed: boolean;
}

/** YYYY-MM-DD of yt-dlp's upload_date (YYYYMMDD) or of a Unix time. */
function uploadDateOf(info: Record<string, unknown>): { date: string; ms: number } | null {
  const d = typeof info.upload_date === "string" ? /^(\d{4})(\d{2})(\d{2})$/.exec(info.upload_date) : null;
  if (d) {
    const ms = Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]));
    if (Number.isFinite(ms)) return { date: `${d[1]}-${d[2]}-${d[3]}`, ms };
  }
  for (const k of ["timestamp", "release_timestamp"]) {
    const t = positive(info[k]);
    if (t !== null) {
      const ms = t * 1000;
      return { date: new Date(ms).toISOString().slice(0, 10), ms };
    }
  }
  return null;
}

/**
 * One video's numbers from a yt-dlp JSON object (a flat search row or a page's -j), null when it names no link a video may be
 * fetched from. `nowMs` is the clock the age is measured on; `link` the link the caller gave, when there was one.
 */
export function videoMetaOf(info: Record<string, unknown>, { source, nowMs, link, detailed = false }: { source: VideoSource; nowMs: number; link?: string; detailed?: boolean }): VideoMeta | null {
  const candidates = [info.webpage_url, info.original_url, info.url, link].filter((v): v is string => typeof v === "string");
  const checked = candidates.map(checkVideoUrl).find((c): c is Extract<VideoUrlCheck, { ok: true }> => c.ok);
  if (!checked) return null;
  const url = checked.url;
  const platform = checked.platform;
  const id = typeof info.id === "string" && ID.test(info.id) ? info.id : videoIdOfUrl(url);
  const views = count(info.view_count);
  const likes = count(info.like_count);
  const durationSec = positive(info.duration);
  const width = count(info.width) || null;
  const height = count(info.height) || null;
  const uploaded = uploadDateOf(info);
  const ageDays = uploaded ? r2(Math.max(1, (nowMs - uploaded.ms) / 86_400_000)) : null;
  const shortLink = [link, info.url, info.original_url].some((u) => typeof u === "string" && /\/(shorts|reels?)\//.test(u));
  const shortForm = shortLink || source === "shorts" || platform === "tiktok" || platform === "instagram" || (width !== null && height !== null && height > width);
  return {
    key: videoKey(platform, id, url),
    url,
    platform,
    id,
    title: cleanText(info.title),
    channel: cleanText(info.channel) ?? cleanText(info.uploader),
    views,
    likes,
    comments: count(info.comment_count),
    shares: count(info.repost_count),
    durationSec: durationSec === null ? null : r2(durationSec),
    uploadDate: uploaded?.date ?? null,
    ageDays,
    viewsPerDay: views !== null && ageDays !== null ? Math.round(views / ageDays) : null,
    likeRate: likes !== null && views ? Math.round((likes / views) * 10000) / 10000 : null,
    width,
    height,
    short: shortForm && (durationSec === null || durationSec <= SHORT_MAX_SEC),
    source,
    detailed,
  };
}

/** A row and the same video's page merged: the page's numbers where it has them, the row's link, short-form and source kept. */
export function mergeMeta(row: VideoMeta, page: VideoMeta | null): VideoMeta {
  if (!page) return row;
  const pick = <K extends keyof VideoMeta>(k: K): VideoMeta[K] => (page[k] ?? row[k]) as VideoMeta[K];
  const durationSec = pick("durationSec");
  return {
    ...row,
    id: pick("id"),
    title: pick("title"),
    channel: pick("channel"),
    views: pick("views"),
    likes: pick("likes"),
    comments: pick("comments"),
    shares: pick("shares"),
    durationSec,
    uploadDate: pick("uploadDate"),
    ageDays: pick("ageDays"),
    viewsPerDay: pick("viewsPerDay"),
    likeRate: pick("likeRate"),
    width: pick("width"),
    height: pick("height"),
    short: (row.short || page.short) && (durationSec === null || durationSec <= SHORT_MAX_SEC),
    detailed: page.detailed || row.detailed,
  };
}

/** Whether a page's answer holds numbers (a removed or private video comes back as a bare title, nothing else). */
export function hasNumbers(meta: VideoMeta | null): meta is VideoMeta {
  return !!meta && (meta.views !== null || meta.durationSec !== null || meta.uploadDate !== null);
}

export type SortBy = "views" | "viewsPerDay";

export interface RankOptions {
  sortBy: SortBy;
  limit: number;
  minViews?: number;
  maxDurationSec?: number;
}

export interface Ranked {
  videos: VideoMeta[];
  dropped: { duplicates: number; belowMinViews: number; overMaxDuration: number; pastLimit: number };
}

/**
 * The videos deduplicated by key (the detailed row of a video wins), filtered (fewer views than minViews or an unknown count
 * when minViews is set; longer than maxDurationSec), sorted by `sortBy`, most first (an unknown value last; then views, then
 * the key, so equal input gives equal output), short-form first when maxDurationSec is at most SHORT_MAX_SEC, and cut to `limit`.
 */
export function rankVideos(videos: readonly VideoMeta[], opt: RankOptions): Ranked {
  const byKey = new Map<string, VideoMeta>();
  let duplicates = 0;
  for (const v of videos) {
    const had = byKey.get(v.key);
    if (!had) byKey.set(v.key, v);
    else {
      duplicates++;
      if (v.detailed && !had.detailed) byKey.set(v.key, { ...v, short: v.short || had.short });
    }
  }
  let belowMinViews = 0;
  let overMaxDuration = 0;
  const kept = [...byKey.values()].filter((v) => {
    if (opt.minViews !== undefined && opt.minViews > 0 && (v.views === null || v.views < opt.minViews)) {
      belowMinViews++;
      return false;
    }
    if (opt.maxDurationSec !== undefined && v.durationSec !== null && v.durationSec > opt.maxDurationSec) {
      overMaxDuration++;
      return false;
    }
    return true;
  });
  const shortsFirst = opt.maxDurationSec !== undefined && opt.maxDurationSec <= SHORT_MAX_SEC;
  const value = (v: VideoMeta) => (opt.sortBy === "viewsPerDay" ? v.viewsPerDay : v.views);
  kept.sort((a, b) => {
    if (shortsFirst && a.short !== b.short) return a.short ? -1 : 1;
    const va = value(a);
    const vb = value(b);
    if (va !== vb) return va === null ? 1 : vb === null ? -1 : vb - va;
    if (a.views !== b.views) return a.views === null ? 1 : b.views === null ? -1 : b.views - a.views;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const limit = Math.max(1, Math.floor(opt.limit));
  return { videos: kept.slice(0, limit), dropped: { duplicates, belowMinViews, overMaxDuration, pastLimit: Math.max(0, kept.length - limit) } };
}

/*
 * --- inspiration --- A YouTube video's public stills, for when its download is refused (YouTube asks a server's address to
 * sign in, TikTok blocks it): YouTube's image host serves every video's opening frame, three frames at about a quarter, half
 * and three quarters of it, and its cover, to anyone without the player. inspire saves them (scripts/agent/stills.mjs), so a
 * video that cannot be fetched is still seen on a contact sheet and its colours are measured. Only that one host is read.
 */

/** The only host stills are read from. */
export const STILLS_HOST = "i.ytimg.com";

export interface VideoStill {
  /** The bare file name it is saved as. */
  name: string;
  /** Where in the video it was taken (0–1); null for the cover, which the creator chose and need not be a moment of it. */
  at: number | null;
  label: string;
  url: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/**
 * The stills of a video: a YouTube video's opening frame (frame0), its frames at about 25, 50 and 75% (hq1–hq3, letterboxed
 * into 4:3) and its cover (oardefault, the portrait one of a Short); none for another platform or an id that is not
 * YouTube's 11 characters. `origin` stands for https://i.ytimg.com (the tests' local server).
 */
export function videoStills(meta: Pick<VideoMeta, "platform" | "id">, origin = `https://${STILLS_HOST}`): VideoStill[] {
  if (meta.platform !== "youtube" || !meta.id || !YOUTUBE_ID.test(meta.id)) return [];
  const base = `${origin.replace(/\/+$/, "")}/vi/${meta.id}`;
  return [
    { name: "still-0.jpg", at: 0, label: "start", url: `${base}/frame0.jpg` },
    { name: "still-1.jpg", at: 0.25, label: "25%", url: `${base}/hq1.jpg` },
    { name: "still-2.jpg", at: 0.5, label: "50%", url: `${base}/hq2.jpg` },
    { name: "still-3.jpg", at: 0.75, label: "75%", url: `${base}/hq3.jpg` },
    { name: "cover.jpg", at: null, label: "cover", url: `${base}/oardefault.jpg` },
  ];
}

/** The shape (width ÷ height) a video's stills are cropped to: the video's own, else 9:16 for short-form and 16:9 for the rest. */
export function stillsAspect(meta: Pick<VideoMeta, "width" | "height" | "short">): number {
  if (meta.width && meta.height && meta.width > 0 && meta.height > 0) return meta.width / meta.height;
  return meta.short ? 9 / 16 : 16 / 9;
}
