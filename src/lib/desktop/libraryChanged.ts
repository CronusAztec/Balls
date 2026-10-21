/*
 * --- cut-reedit --- "The Library changed", page-wide. The Desktop group reads the Library again on its own saves (the queue,
 * the Library's Edit for TikTok); a clip saved from outside it, the Publish block's Clip editor in the Windows app, tells it
 * here, so the open Library tab shows the new cut at once.
 */

const listeners = new Set<() => void>();

/** Says the Library has a new or changed item (every listener reads it again). */
export function notifyLibraryChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Calls `listener` whenever the Library changed; returns the unsubscribe (an effect's clean-up). */
export function onLibraryChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
