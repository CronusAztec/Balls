/*
 * --- changelog --- The anchor of a release on the /changelog page: "<product>-<version with dashes>", so "app" + "1.3.0"
 * is "app-1-3-0" (a dot would need escaping in a #selector and cannot be a message key). A file of its own so the two
 * small client components (the Windows app's notes) can build an anchor without importing the changelog's data.
 */

export type ChangeProduct = "site" | "app";

/** The anchor of the release of `product` at `version` ("site", "1.10.0" gives "site-1-10-0"). */
export function releaseId(product: ChangeProduct, version: string): string {
  return `${product}-${version.replace(/\./g, "-")}`;
}

/** The anchor of the Windows app's release with this version ("1.3.0" gives "app-1-3-0"). */
export function appReleaseId(version: string): string {
  return releaseId("app", version);
}

/** The anchor of the website's release with this version. */
export function siteReleaseId(version: string): string {
  return releaseId("site", version);
}
