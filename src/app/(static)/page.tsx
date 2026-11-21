import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { BASE_PATH, SITE_NAME, absoluteUrl } from "@/lib/site";
import { pageMetadata } from "@/lib/seo"; // --- site-nav ---
import { MODE_CARD_ORDER } from "@/lib/modes";

/**
 * The static export has no middleware, so "/" is a tiny page that sends the visitor to the
 * best matching language: an inline script picks a locale from navigator.languages (the
 * same negotiation next-intl's middleware does on a server), and a <meta refresh> falls
 * back to the default locale when JavaScript is disabled.
 */
const redirectScript = `(function () {
  var locales = ${JSON.stringify(routing.locales)};
  var pick = ${JSON.stringify(routing.defaultLocale)};
  var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
  outer: for (var i = 0; i < langs.length; i++) {
    var l = String(langs[i]).toLowerCase();
    for (var j = 0; j < locales.length; j++) {
      if (l === locales[j] || l.indexOf(locales[j] + "-") === 0) { pick = locales[j]; break outer; }
    }
  }
  location.replace(${JSON.stringify(BASE_PATH)} + "/" + pick + "/" + location.search + location.hash);
})();`;

// --- review fix (ui-i18n) --- the title moved here from the (static) layout (the 404 page sets its own)
// --- site-nav --- The bare address is the one a visitor types and the one a clip's watermark prints. Pasted into a chat it
// used to show a bare name and no picture: a link preview does not follow the redirect below. So this page carries the
// English home page's head (title, description, card, Twitter card), built by the helper every page uses, with /en/ as its
// canonical address. The (static) layout still keeps it out of search results.
export async function generateMetadata(): Promise<Metadata> {
  const locale = routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Layout" });
  return pageMetadata({ locale, path: "", title: t("metaTitle", { siteName: SITE_NAME }), description: t("metaDescription", { count: MODE_CARD_ORDER.length }), image: "home", fallbackImageUrl: absoluteUrl("/og.png") });
}

export default function RootRedirect() {
  const fallback = `${BASE_PATH}/${routing.defaultLocale}/`;
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${fallback}`} />
      <script dangerouslySetInnerHTML={{ __html: redirectScript }} />
      <main className="min-h-screen bg-bg text-ink font-sans flex items-center justify-center px-4">
        <p className="text-center text-ink-2">
          <span className="block text-2xl font-extrabold text-ink mb-3">{SITE_NAME}</span>
          <a href={fallback} className="text-accent underline">
            Continue to {SITE_NAME}
          </a>
        </p>
      </main>
    </>
  );
}
