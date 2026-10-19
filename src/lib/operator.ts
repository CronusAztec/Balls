/**
 * --- go-live-kit --- The operator's public details, from repository variables (empty when unset): the legal pages (terms,
 * privacy) and the pricing page show them – docs/GO-LIVE.md, "Legal pages, support e-mail, operator details". A module of its
 * own rather than lib/site.ts: site.ts is also bundled for the browser by tests and scripts that define only its own
 * NEXT_PUBLIC_ variables, and an unknown `process.env` read would break those bundles.
 *
 * --- legal-audit --- The VAT number, the register entry and the country join them: EU and UK law want a trader's name, geographic
 * address and (where it has one) VAT number on a site that sells, and the terms name the governing law by the operator's country.
 */
export const SUPPORT_EMAIL = (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || "").trim();
export const LEGAL_NAME = (process.env.NEXT_PUBLIC_LEGAL_NAME || "").trim();
export const LEGAL_ADDRESS = (process.env.NEXT_PUBLIC_LEGAL_ADDRESS || "").trim();
/** The operator's VAT number, as shown to visitors ("VAT number: …" on the terms, the privacy policy and the footer imprint). */
export const LEGAL_VAT_ID = (process.env.NEXT_PUBLIC_LEGAL_VAT_ID || "").trim();
/** The register entry (company number, trade register, sole-trader register), shown as "Registered as …". */
export const LEGAL_REGISTRATION = (process.env.NEXT_PUBLIC_LEGAL_REGISTRATION || "").trim();
/** The operator's country, as its name should read to visitors (the governing law of the terms). */
export const LEGAL_COUNTRY = (process.env.NEXT_PUBLIC_LEGAL_COUNTRY || "").trim();

/**
 * --- legal-audit --- Whether the feedback form reaches the operator privately: an endpoint or an e-mail address (the same order as
 * components/site/FeedbackForm.tsx). False when the form would open a public GitHub issue, or nothing at all: a privacy rights
 * request must never be routed to a public issue form, so the privacy policy then says to write to the postal address instead.
 */
export const FEEDBACK_REACHES_OPERATOR = !!((process.env.NEXT_PUBLIC_FEEDBACK_ENDPOINT || "").trim() || (process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "").trim() || SUPPORT_EMAIL);
