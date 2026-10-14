"use client";

import { useEffect } from "react";
import { SITE_DOMAIN, SITE_URL } from "@/lib/site";
import { ANALYTICS_SCRIPT_URL, bindTrackClicks, dropTrackQueue, flushTrackQueue, trackingAllowed } from "@/lib/analytics/track";
import { carriesClaim } from "@/lib/analytics/attribution";

/**
 * --- analytics --- Optional privacy-friendly statistics. Set NEXT_PUBLIC_ANALYTICS_SCRIPT_URL (and NEXT_PUBLIC_ANALYTICS_SITE_ID) to
 * load a script such as Plausible, Umami or Rybbit; README "Analytics events" lists what is counted.
 *
 * The script is added by this component after the page has loaded, and only when every gate holds (lib/analytics/track.ts
 * `trackingAllowed`): a script address was built in, the page is served over http or https, it is not the Windows app, and the
 * browser sends neither Do Not Track nor Global Privacy Control. Behind a gate nothing is added and no request goes to the
 * service. The same effect binds the one delegated listener for the `data-track` buttons and links, and sends what waited
 * for the script once it has loaded. While the address carries a checkout receipt (?claim=...&ref=..., see carriesClaim) the script is
 * held back and added once the page has removed the query: a statistics service sends the whole address with its first page view.
 *
 * The attributes are the services' own: `data-domain` (Plausible, the site's host name), `data-website-id` (Umami) and
 * `data-site-id` (Rybbit) carry the optional NEXT_PUBLIC_ANALYTICS_SITE_ID, `data-do-not-track` makes Umami honour the browser's
 * setting itself as well.
 */

/** The host name Plausible's `data-domain` wants: no scheme, no path (the site may live in a sub-folder). */
function siteHost(): string {
  try {
    return new URL(SITE_URL).hostname;
  } catch {
    return SITE_DOMAIN.replace(/\/.*$/, "");
  }
}

const SCRIPT_MARK = "data-jbl-stats";

export default function Analytics() {
  useEffect(() => {
    if (!ANALYTICS_SCRIPT_URL || !trackingAllowed()) return;
    const unbind = bindTrackClicks();
    const add = () => {
      if (document.querySelector(`script[${SCRIPT_MARK}]`)) return;
      const script = document.createElement("script");
      script.defer = true;
      script.src = ANALYTICS_SCRIPT_URL;
      script.setAttribute(SCRIPT_MARK, "");
      script.setAttribute("data-domain", siteHost());
      const siteId = process.env.NEXT_PUBLIC_ANALYTICS_SITE_ID;
      if (siteId) {
        script.setAttribute("data-website-id", siteId);
        script.setAttribute("data-site-id", siteId);
      }
      script.setAttribute("data-do-not-track", "true");
      script.addEventListener("load", flushTrackQueue);
      script.addEventListener("error", dropTrackQueue);
      document.head.appendChild(script);
    };
    let timer: number | undefined;
    if (!carriesClaim(window.location.search)) add();
    else {
      // a buyer is back from the checkout: the pricing page settles the claim and removes ?claim=&ref= itself; a claim that stays pending
      // or fails leaves them in the address, and then the script is never added on that visit
      timer = window.setInterval(() => {
        if (carriesClaim(window.location.search)) return;
        window.clearInterval(timer);
        timer = undefined;
        add();
      }, 400);
    }
    return () => {
      unbind();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, []);
  return null;
}
