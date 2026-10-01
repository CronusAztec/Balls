/**
 * --- review fix (ui-i18n) --- respects the visitor's "reduce motion" setting for scripted scrolling: `scrollIntoView` gets
 * `behavior: "auto"` (an instant jump) instead of a smooth glide while `(prefers-reduced-motion: reduce)` matches.
 */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** The scroll behaviour for `scrollIntoView` / `scrollTo`: smooth unless the visitor asked for reduced motion. */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
