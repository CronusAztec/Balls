/**
 * --- go-live-kit --- The operator's public details, from repository variables (empty when unset): the legal pages (terms,
 * privacy) and the pricing page show them – docs/GO-LIVE.md, "Legal pages, support e-mail, operator details". A module of its
 * own rather than lib/site.ts: site.ts is also bundled for the browser by tests and scripts that define only its own
 * NEXT_PUBLIC_ variables, and an unknown `process.env` read would break those bundles.
 */
export const SUPPORT_EMAIL = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
export const LEGAL_NAME = (process.env.NEXT_PUBLIC_LEGAL_NAME || "").trim();
export const LEGAL_ADDRESS = (process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "").trim();
