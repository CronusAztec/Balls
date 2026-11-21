/**
 * --- review fix (performance) --- Which message namespaces reach the browser. Server components translate on the server;
 * only client components read the catalogue `NextIntlClientProvider` hands down, and every exported page embeds what it
 * is given in its HTML. So the locale layout passes only the namespaces the shared client components read (the navbar,
 * the footer, the language list), a page with client components of its own wraps itself in a provider with these plus its
 * own (`pageClientMessages`), and the simulator page – whose panel reads nearly everything – gets the whole catalogue.
 * A nested provider replaces its parent's messages, so a page's set includes the shared one. tests/clientMessages.test.ts
 * walks each page's client components and checks that their `useTranslations()` namespaces are covered here.
 * --- studio-first-open --- The whole catalogue but the namespaces only server components read (`studioClientNamespaces`):
 * the legal and marketing pages, the metadata and the studio page's own skeleton, about 38 KB of its HTML. The test walks
 * every module the studio's client components reach and checks that none of them names one of these.
 */

/** --- studio-first-open --- Namespaces no client component of the studio reads: the simulator page leaves them out. */
export const SERVER_ONLY_NAMESPACES = ["Privacy", "Terms", "Press", "Disclaimer", "About", "TikTokBallVideos", "Licences", "Changelog", "ChangelogLive", "Layout", "Seo", "SimulatorPage", "Editorial", "FAQ", "Feedback", "NotFound"] as const;

/** --- studio-first-open --- The simulator page's namespaces: every one of `all` but the server-only ones. */
export function studioClientNamespaces(all: readonly string[]): string[] {
  return all.filter((ns) => !(SERVER_ONLY_NAMESPACES as readonly string[]).includes(ns));
}

/**
 * Namespaces the client components on every page read (Navbar, LanguageSwitcher, the footer's InstallAppButton).
 * --- site-redesign --- the footer is a client component too (its language links follow the page) and the chrome reads its
 * labels from SiteRedesign (navigation, footer columns, mode families) and the footer's family headings from Headings.
 * --- desktop-exe --- DesktopLink: the navbar's and footer's Windows app link and the landing page's download button –
 * three strings, kept apart from the Desktop group's catalogue, which only the simulator and the download page read.
 */
export const SHARED_CLIENT_NAMESPACES = ["Navbar", "Gallery", "Pwa", "DesktopLink", "SiteRedesign", "Footer", "Headings"] as const;

/** Further namespaces of the client components of a page (by route, "" = the landing page); a page not listed has none. */
export const PAGE_CLIENT_NAMESPACES: Readonly<Record<string, readonly string[]>> = {
  // (the simulator page is not listed: it gets studioClientNamespaces() of the whole catalogue)
  "": ["Modes", "FAQ", "Daily"], // --- site-redesign --- the live preview, the modes wall, the FAQ, the daily card
  "/feedback": ["Feedback"],
  "/pricing": ["Billing"], // --- paywall-gate --- the plans, the claim, the licence and Restore purchase
  "/account": ["Account"], // --- user-accounts --- sign up, sign in, the connected channels
  "/changelog": ["ChangelogLive"], // --- changelog --- the Windows app's "you run version x" note (the page's own text is read on the server)
};

/** The static 404 page (a client component end to end): the NotFound text, the navbar and the footer. */
export const NOT_FOUND_CLIENT_NAMESPACES = [...SHARED_CLIENT_NAMESPACES, "NotFound"] as const;

/** `messages` restricted to `namespaces` (the ones it has). */
export function pickMessages<M extends Record<string, unknown>>(messages: M, namespaces: readonly string[]): Partial<M> {
  const out: Partial<M> = {};
  for (const ns of namespaces) if (Object.prototype.hasOwnProperty.call(messages, ns)) out[ns as keyof M] = messages[ns as keyof M];
  return out;
}

/** The namespaces the client components of the page at `route` read: the shared ones plus the page's own. */
export function pageClientNamespaces(route: string): string[] {
  return [...SHARED_CLIENT_NAMESPACES, ...(PAGE_CLIENT_NAMESPACES[route] ?? [])];
}
