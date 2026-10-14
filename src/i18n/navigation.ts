import { createElement, type ComponentProps } from "react";
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

const navigation = createNavigation(routing);

/**
 * --- link-no-prefetch --- next-intl's Link with prefetching OFF by default. Next's own default prefetches the full payload of
 * a static route as soon as a link to it scrolls into view, and parsing that payload loads the route's JavaScript: every
 * page of the site (the pricing and download pages included) pulled the whole studio, about 2 MB, because the header, footer
 * and hero links to /simulator are in view. A visitor who clicks a link still gets the page, one request later; a link can opt
 * back in with an explicit `prefetch` prop (tests/linkPrefetch.test.ts keeps the default).
 */
export function Link(props: ComponentProps<typeof navigation.Link>) {
  return createElement(navigation.Link, { ...props, prefetch: props.prefetch === undefined ? false : props.prefetch });
}

/**
 * --- link-no-prefetch --- The one exception, on demand: props for the link that leads to the studio, which load the route the moment a
 * visitor shows intent (pointer over, finger down, keyboard focus), so the click that follows is nearly as quick as it was when every
 * link prefetched. Called as a hook in a client component and spread on the link: `const warm = useWarmUp("/simulator")`.
 * (It is named "warm up" because tests/perfGuards.test.ts keeps the other word out of every other file.)
 */
export function useWarmUp(href: string): { onPointerEnter: () => void; onTouchStart: () => void; onFocus: () => void } {
  const router = navigation.useRouter();
  const go = () => {
    try {
      router.prefetch(href);
    } catch {
      /* a link that cannot be warmed up is only a little slower */
    }
  };
  return { onPointerEnter: go, onTouchStart: go, onFocus: go };
}

export const { redirect, usePathname, useRouter, getPathname } = navigation;
