import localFont from "next/font/local";

/*
 * --- site-redesign --- The site's three type roles, self-hosted from src/fonts (OFL-1.1, licences next to the files) with
 * next/font/local: no request to a font CDN, and the files are served from /_next/static under the base path.
 *
 *  - display  Space Grotesk (variable 300–700): headlines only, 700 with negative tracking
 *  - ui       Hanken Grotesk (variable 100–900): everything else, at 400 / 500 / 700
 *  - mono     JetBrains Mono (variable 100–800): seeds, timers, slider readouts, number fields, keyboard hints
 *
 * Every family comes as two subset files – latin and latin-ext (Polish, Spanish …) – with their unicode-range, so an
 * English page never downloads the latin-ext file. The latin-ext face is listed first in the font stack (globals.css) and
 * has no metric fallback of its own: a glyph outside its range falls through to the latin face and, while that loads, to
 * the latin face's size-adjusted local fallback. next/font needs literal option values, hence the repeated ranges.
 */

export const displayLatin = localFont({
  src: "../fonts/space-grotesk-latin.woff2",
  weight: "300 700",
  display: "swap",
  variable: "--font-display-latin",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

export const displayExt = localFont({
  src: "../fonts/space-grotesk-latin-ext.woff2",
  weight: "300 700",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-display-ext",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

export const uiLatin = localFont({
  src: "../fonts/hanken-grotesk-latin.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-ui-latin",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

export const uiExt = localFont({
  src: "../fonts/hanken-grotesk-latin-ext.woff2",
  weight: "100 900",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-ui-ext",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

export const monoLatin = localFont({
  src: "../fonts/jetbrains-mono-latin.woff2",
  weight: "100 800",
  display: "swap",
  variable: "--font-mono-latin",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD" }],
});

export const monoExt = localFont({
  src: "../fonts/jetbrains-mono-latin-ext.woff2",
  weight: "100 800",
  display: "swap",
  preload: false,
  adjustFontFallback: false,
  variable: "--font-mono-ext",
  declarations: [{ prop: "unicode-range", value: "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF" }],
});

/** The classes that define the font variables, for the <html> element of both root layouts. */
export const fontVariables = [displayLatin, displayExt, uiLatin, uiExt, monoLatin, monoExt].map((f) => f.variable).join(" ");
