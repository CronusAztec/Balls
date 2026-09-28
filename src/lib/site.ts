/** Central place for branding. Change these two values to rebrand the whole site. */
export const SITE_NAME = "ViralBalls";
export const SITE_DOMAIN = "viralballs.com";

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
).replace(/\/$/, "");

/** Accent colour used across the UI (buttons, sliders, active states). */
export const ACCENT = "#93d119";
export const ACCENT_LIGHT = "#b0f02a";
