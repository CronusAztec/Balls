/**
 * --- land-claim --- A small built-in list of countries for the team roster's "Country" picker (Teams section): a code
 * (ISO 3166-1 alpha-2), an English name (the panel shows the localised one, `Countries.<code>` in messages/*.json), the
 * flag as an emoji (two regional-indicator symbols) and two flag colours – `[primary, secondary]`; picking a country
 * fills a roster entry with its name, its flag as the emoji and its primary colour.
 *
 * The shape `{ code, name, flag, colors }` is shared with the String Circle style of the String Battle (feature
 * string-circle), which ships the same module: the two lists merge into one.
 *
 * Pure data, no DOM. Where a font has no flag glyphs (some desktop systems draw a flag as its two letters), the canvas
 * shows the code in a badge instead (`flagCodeOf()`); see components/simulator/landClaimRenderer.ts.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, upper case ("FR"). */
  code: string;
  /** English name ("France"); the panel translates it (`Countries.FR`). */
  name: string;
  /** The flag emoji (regional indicators of the code). */
  flag: string;
  /** The flag's colours as "#rrggbb": `[primary, secondary]` – the primary is the roster colour. */
  colors: readonly [string, string];
}

/** The flag emoji of a two-letter code: two regional-indicator symbols ("FR" → 🇫🇷); "" for anything else. */
export function flagOf(code: string): string {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(0x1f1e6 + (c.charCodeAt(0) - 65), 0x1f1e6 + (c.charCodeAt(1) - 65));
}

/** The two-letter code of a flag emoji (🇫🇷 → "FR"), or "" when `text` is not one flag. */
export function flagCodeOf(text: string): string {
  const points = Array.from(typeof text === "string" ? text.trim() : "");
  if (points.length !== 2) return "";
  let out = "";
  for (const p of points) {
    const cp = p.codePointAt(0) ?? 0;
    if (cp < 0x1f1e6 || cp > 0x1f1ff) return "";
    out += String.fromCharCode(65 + cp - 0x1f1e6);
  }
  return out;
}

const C = (code: string, name: string, primary: string, secondary: string): Country => ({ code, name, flag: flagOf(code), colors: [primary, secondary] });

/** About forty countries, in the order the picker lists them (sorted by English name). */
export const COUNTRIES: readonly Country[] = [
  C("AR", "Argentina", "#74acdf", "#f6b40e"),
  C("AU", "Australia", "#00843d", "#ffcd00"),
  C("AT", "Austria", "#ed2939", "#ffffff"),
  C("BE", "Belgium", "#fdda24", "#ef3340"),
  C("BR", "Brazil", "#009c3b", "#ffdf00"),
  C("CA", "Canada", "#ff0000", "#ffffff"),
  C("CL", "Chile", "#d52b1e", "#0039a6"),
  C("CN", "China", "#ee1c25", "#ffff00"),
  C("CO", "Colombia", "#fcd116", "#003893"),
  C("DK", "Denmark", "#c8102e", "#ffffff"),
  C("EG", "Egypt", "#ce1126", "#c09300"),
  C("FI", "Finland", "#2f6fd0", "#ffffff"),
  C("FR", "France", "#0055a4", "#ef4135"),
  C("DE", "Germany", "#dd0000", "#ffce00"),
  C("GR", "Greece", "#0d5eaf", "#ffffff"),
  C("IN", "India", "#ff9933", "#138808"),
  C("ID", "Indonesia", "#ff0000", "#ffffff"),
  C("IE", "Ireland", "#169b62", "#ff883e"),
  C("IT", "Italy", "#009246", "#ce2b37"),
  C("JP", "Japan", "#bc002d", "#ffffff"),
  C("MX", "Mexico", "#006847", "#ce1126"),
  C("MA", "Morocco", "#c1272d", "#006233"),
  C("NL", "Netherlands", "#ff6b00", "#21468b"),
  C("NZ", "New Zealand", "#3a5fcd", "#cc142b"),
  C("NG", "Nigeria", "#008751", "#ffffff"),
  C("NO", "Norway", "#ba0c2f", "#3a5fcd"),
  C("PE", "Peru", "#d91023", "#ffffff"),
  C("PH", "Philippines", "#0038a8", "#ce1126"),
  C("PL", "Poland", "#dc143c", "#ffffff"),
  C("PT", "Portugal", "#006600", "#ff0000"),
  C("SA", "Saudi Arabia", "#006c35", "#ffffff"),
  C("ZA", "South Africa", "#007749", "#ffb81c"),
  C("KR", "South Korea", "#cd2e3a", "#0047a0"),
  C("ES", "Spain", "#aa151b", "#f1bf00"),
  C("SE", "Sweden", "#006aa7", "#fecc00"),
  C("CH", "Switzerland", "#ff0000", "#ffffff"),
  C("TH", "Thailand", "#a51931", "#2d2a4a"),
  C("TR", "Türkiye", "#e30a17", "#ffffff"),
  C("UA", "Ukraine", "#0057b7", "#ffd700"),
  C("GB", "United Kingdom", "#012169", "#c8102e"),
  C("US", "United States", "#b22234", "#3c3b6e"),
  C("VN", "Vietnam", "#da251d", "#ffff00"),
];

/** The country of a code (any case), or null. */
export function countryByCode(code: string): Country | null {
  const c = typeof code === "string" ? code.trim().toUpperCase() : "";
  return COUNTRIES.find((country) => country.code === c) ?? null;
}

/** The country whose flag `emoji` is (a roster entry filled from the picker), or null. */
export function countryOfFlag(emoji: string): Country | null {
  const code = flagCodeOf(emoji);
  return code ? countryByCode(code) : null;
}

/** The roster entry a picked country fills: its (localised) name, its flag as the emoji and its primary colour. */
export function countryTeamEntry(country: Country, name: string = country.name): { name: string; emoji: string; color: string } {
  return { name, emoji: country.flag, color: country.colors[0] };
}
