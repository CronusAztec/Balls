import NotFoundStatic from "@/components/site/NotFoundStatic";

/**
 * Exported to out/404/index.html and copied to out/404.html by scripts/postexport.mjs.
 * Next.js treats the "/404" path specially and ignores metadata exported here, so the
 * document title is set by NotFoundStatic in the browser. The (static) layout must not set a
 * title either: a metadata <title> hydrates after NotFoundStatic's effect and overwrites
 * document.title with its own text (--- review fix (site-static) ---).
 */
export default function NotFoundPage() {
  return <NotFoundStatic />;
}
