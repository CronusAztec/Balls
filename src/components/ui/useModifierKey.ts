"use client";

import { useSyncExternalStore } from "react";

/* --- site-redesign --- The command key as the visitor's keyboard labels it: "⌘" on Apple devices, "Ctrl" elsewhere (and in
   the static HTML, before the page knows). */
const isApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);
const subscribe = () => () => {};

export function useModifierKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(subscribe, () => (isApple() ? "⌘" : "Ctrl"), () => "Ctrl");
}
