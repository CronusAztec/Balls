"use client";

import type { ComponentProps } from "react";
import { Link, useWarmUp } from "@/i18n/navigation";

/*
 * --- link-no-prefetch --- A link to the studio that loads the studio when a visitor shows intent (pointer over, finger down,
 * keyboard focus) instead of in the background of every page (src/i18n/navigation.ts). The landing page's main call to action is
 * a server component, so this small client component carries the handlers.
 */
export default function StudioLink(props: Omit<ComponentProps<typeof Link>, "href"> & { href?: "/simulator" }) {
  const warm = useWarmUp("/simulator");
  return <Link {...props} {...warm} href="/simulator" />;
}
