import { CHECKOUT_FROM_STORAGE_KEY } from "./config";
import { locales } from "@/i18n/routing";
import { BASE_PATH } from "@/lib/site";

/*
 * --- paywall-gate --- Where a buyer goes back to after a checkout that started in the studio. The studio keeps its setup in
 * its own address (Simulator.tsx mirrors the settings into the query), so when a checkout has to leave in the studio's own
 * tab (the new tab it normally opens was refused), that address is remembered in sessionStorage – which survives the round
 * trip through the provider's page in the same tab – and the pricing page's success state offers "Back to your setup".
 * Only this site's own studio page is ever followed: /<base path>/<locale>/simulator/ with its query.
 */

type Session = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `path` when it is this site's studio page (pathname + search, no fragment, nothing foreign), else null. */
export function studioReturnPath(path: string | null | undefined, basePath: string = BASE_PATH): string | null {
  if (typeof path !== "string" || path.length > 8000) return null;
  const pattern = new RegExp(`^${escape(basePath)}/(?:${locales.map(escape).join("|")})/simulator/(?:\\?[^#\\s]*)?$`);
  return pattern.test(path) ? path : null;
}

/** Remembers the studio address a same-tab checkout leaves from. */
export function rememberCheckoutFrom(storage: Session | null, location: Pick<Location, "pathname" | "search">): void {
  const path = studioReturnPath(`${location.pathname}${location.search}`);
  if (!path) return;
  try {
    storage?.setItem(CHECKOUT_FROM_STORAGE_KEY, path);
  } catch {
    /* storage blocked: the studio opens with its defaults */
  }
}

/** The remembered studio address (validated again), null without one. */
export function checkoutFrom(storage: Pick<Storage, "getItem"> | null): string | null {
  try {
    return studioReturnPath(storage?.getItem(CHECKOUT_FROM_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

/** Forgets the remembered studio address (it has been offered). */
export function forgetCheckoutFrom(storage: Session | null): void {
  try {
    storage?.removeItem(CHECKOUT_FROM_STORAGE_KEY);
  } catch {
    /* storage blocked */
  }
}

/** The page's sessionStorage, null when it is blocked (or outside a browser). */
export function sessionStore(): Session | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}
