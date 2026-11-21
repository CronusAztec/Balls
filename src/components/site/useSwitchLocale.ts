"use client";

import { useCallback } from "react";
import { useParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import type { Locale } from "@/i18n/routing";
import { handOverState } from "@/lib/siteTrail";

/*
 * --- site-nav --- Shows this page in another language without losing the visitor's place: the same page, its query (the
 * studio's whole setup lives there), its hash and the scroll position. The header's language list and the footer's
 * language links both switch through it. The address is read at the click, never while rendering, so the static HTML
 * and the first client render agree. The page's history state is handed over too (lib/siteTrail.ts): the modes wall
 * keeps its search there, and a wall that finds it knows this is no new arrival and leaves the scroll position alone.
 */
export function useSwitchLocale(): (code: Locale) => void {
  const router = useRouter();
  const pathname = usePathname();
  const params = useParams();
  return useCallback(
    (code: Locale) => {
      const { search, hash } = window.location;
      handOverState(pathname, window.history.state);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace({ pathname: (pathname + search + hash) as any, params: params as Record<string, string> } as never, { locale: code, scroll: false });
    },
    [router, pathname, params],
  );
}
