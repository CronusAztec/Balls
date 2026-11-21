"use client";

import type { ComponentProps } from "react";
import { NextIntlClientProvider } from "next-intl";

/*
 * --- review fix (studio-first-open) --- The locale layout's message provider: next-intl's client provider, reached through a
 * client module that only the layout imports. A page that wraps itself in next-intl's provider (the simulator page, with
 * nearly the whole catalogue) shares that client module with the layout, and the build lists a shared client module with
 * the page's scripts. A client-side navigation draws the layout again from the new page's data, so the layout's provider
 * waited for the whole studio to load, above every boundary the studio has: the page the visitor left stayed on screen,
 * unchanged, for about 8 s on a phone, and the studio's loading screen never showed. Through this module the layout's
 * provider needs the layout's own scripts alone, which every page has loaded.
 */
export default function SiteMessages(props: ComponentProps<typeof NextIntlClientProvider>) {
  return <NextIntlClientProvider {...props} />;
}
