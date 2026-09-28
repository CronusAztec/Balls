import Script from "next/script";

/**
 * Optional privacy-friendly analytics. Set NEXT_PUBLIC_ANALYTICS_SCRIPT_URL (and optionally
 * NEXT_PUBLIC_ANALYTICS_SITE_ID) to load a script such as Plausible, Umami or Rybbit.
 * Nothing is loaded when the variable is unset.
 */
export default function Analytics() {
  const src = process.env.NEXT_PUBLIC_ANALYTICS_SCRIPT_URL;
  if (!src) return null;
  const siteId = process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID;
  return <Script src={src} strategy="afterInteractive" data-site-id={siteId} data-website-id={siteId} defer />;
}
