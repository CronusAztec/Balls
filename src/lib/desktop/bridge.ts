import { DESKTOP_API_VERSION, type DesktopApi, type PickedFile } from "./contract";

/*
 * --- desktop-exe --- The page's view of the desktop app: `window.desktop` exists only inside the Windows app (its preload
 * script puts it there), so every desktop feature is gated on `getDesktop()` and the website keeps working exactly as before.
 */

declare global {
  interface Window {
    desktop?: DesktopApi;
  }
}

/** The app's bridge, or null on the website (or a bridge of another major version). Call it after mount: the static page has no window. */
export function getDesktop(): DesktopApi | null {
  if (typeof window === "undefined") return null;
  const bridge = window.desktop;
  if (!bridge || typeof bridge !== "object" || bridge.apiVersion !== DESKTOP_API_VERSION) return null;
  return bridge;
}

/** True inside the desktop app. */
export function isDesktopApp(): boolean {
  return getDesktop() !== null;
}

/** A file the main process read (native dialog, drop, second instance) as a `File` the page's upload handlers take. */
export function pickedToFile(picked: PickedFile): File {
  const bytes = picked.data instanceof Uint8Array ? picked.data : new Uint8Array(picked.data as ArrayBufferLike);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy.buffer], picked.name, { type: picked.mimeType || "application/octet-stream" });
}

/** The bytes of a Blob for the IPC bridge (structured clone takes a Uint8Array). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
