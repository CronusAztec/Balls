/* --- desktop-exe --- File names of rendered clips (shared by the page's render queue and the app's saver). */

/** A file name the app accepts: letters, digits, dash, underscore and dot; at most 80 characters. */
export function safeFileBase(name: string): string {
  const clean = name
    .replace(/[łŁ]/g, (c) => (c === "ł" ? "l" : "L"))
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return clean || "clip";
}

