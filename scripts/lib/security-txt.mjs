/*
 * --- security-txt --- /.well-known/security.txt (RFC 9116): how a security researcher reaches the operator. Written by
 * scripts/postexport.mjs into out/.well-known/ when the build knows a support address: NEXT_PUBLIC_SUPPORT_EMAIL (the variable
 * the legal pages use), JBL_SUPPORT_EMAIL (the VPS deployer's name for it), else the mailto link the privacy page was built
 * with (a postexport that runs without the build's variables, as the VPS deployer does, still gets the same address).
 * The file is a dot path, so the service worker's precache never lists it.
 */

/** The mailto address of the first mailto: link in an HTML page, or "". */
export function mailtoFromHtml(html) {
  const m = /href="mailto:([^"?]+)/i.exec(String(html ?? ""));
  return m ? m[1].trim() : "";
}

/** The contents of security.txt: Contact and Expires are required by RFC 9116, Expires at most a year ahead. */
export function securityTxt({ contact, siteUrl, now = new Date() }) {
  if (!contact) throw new Error("security.txt needs a contact address");
  const expires = new Date(now.getTime());
  expires.setUTCDate(expires.getUTCDate() + 364);
  expires.setUTCHours(0, 0, 0, 0);
  const base = String(siteUrl ?? "").replace(/\/+$/, "");
  const lines = [
    "# Security contact of this site (RFC 9116). Report a vulnerability to the address below.",
    `Contact: mailto:${contact}`,
    `Expires: ${expires.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
    "Preferred-Languages: en, pl, es",
  ];
  if (base) {
    lines.push(`Canonical: ${base}/.well-known/security.txt`);
    lines.push(`Policy: ${base}/en/privacy/`);
  }
  return lines.join("\n") + "\n";
}
