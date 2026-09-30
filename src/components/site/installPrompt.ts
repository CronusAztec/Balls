import type { BeforeInstallPromptEvent } from "@/lib/pwa";

/**
 * Chrome's install prompt, kept for the "Install app" button (feature pwa). The browser fires
 * `beforeinstallprompt` once the site is installable; the event is held until the visitor clicks the
 * button (preventDefault() swaps the browser's own mini-infobar for that button). A tiny store for
 * useSyncExternalStore: PwaRegister starts listening from the root layout, so an early event is not missed.
 */
let deferred: BeforeInstallPromptEvent | null = null;
let listening = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export function listenForInstallPrompt(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listenForInstallPrompt();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function installPromptAvailable(): boolean {
  return deferred !== null;
}

/** Shows the browser's install dialog; the event can be used once, so the button hides afterwards. */
export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  emit();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable";
  }
}
