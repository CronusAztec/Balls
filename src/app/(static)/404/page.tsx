import NotFoundStatic from "@/components/site/NotFoundStatic";

/**
 * Exported to out/404/index.html and copied to out/404.html by scripts/postexport.mjs.
 * Next.js treats the "/404" path specially and ignores metadata exported here, so the
 * document title is rendered by NotFoundStatic (a React <title>, localised in the browser).
 */
export default function NotFoundPage() {
  return <NotFoundStatic />;
}
