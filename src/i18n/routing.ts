import { defineRouting } from "next-intl/routing";

/**
 * All supported locales. To add a language:
 *  1. add its code here,
 *  2. create messages/<code>.json (copy messages/en.json and translate),
 *  3. add an entry to LOCALE_OPTIONS below (label + flag for the switcher).
 */
export const locales = ["en", "pl", "es"] as const;
export type Locale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: "en",
  localePrefix: "always",
});

export const LOCALE_OPTIONS: { code: Locale; label: string; flag: string }[] = [
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "pl", label: "Polski", flag: "🇵🇱" },
  { code: "es", label: "Español", flag: "🇪🇸" },
];
