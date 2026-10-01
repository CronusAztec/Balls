import type { Metadata } from "next";
import { routing } from "@/i18n/routing";
import { BASE_PATH, SITE_NAME } from "@/lib/site";

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
export const metadata: Metadata = { title: SITE_NAME };

export default function RootRedirect() {
  const fallback = `${BASE_PATH}/${routing.defaultLocale}/`;
  return (
    <>
      <meta httpEquiv="refresh" content={`0;url=${fallback}`} />
      <script dangerouslySetInnerHTML={{ __html: redirectScript }} />
      <main className="min-h-screen bg-slate-950 text-slate-50 font-sans flex items-center justify-center px-4">
        <p className="text-center text-zinc-400">
          <span className="block text-2xl font-extrabold text-white mb-3">{SITE_NAME}</span>
          <a href={fallback} className="text-cyan-400 underline">
            Continue to {SITE_NAME}
          </a>
        </p>
      </main>
    </>
  );
}
