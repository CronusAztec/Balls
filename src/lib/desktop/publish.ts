import type { LibraryItem } from "./contract";

/*
 * --- desktop-exe --- EXTENSION POINT for one-click publishing from the desktop Library.
 *
 * A publishing path registers one target with `registerPublishTarget()`, and the Library shows a "Publish to …" button per
 * target for every clip it is `available` for (the button hands the target the clip's file, read through the app, and its
 * post copy). The Publish feature registers its paths through lib/publish/desktopTargets.ts – the accounts ticked in the
 * Publish block (the relay) and the quick share – while the Desktop group is shown. Without a target, the Library offers
 * "Copy post text" and "Show in folder" only.
 */

export interface PublishClip {
  item: LibraryItem;
  file: File;
  title: string;
  caption: string;
  hashtags: string[];
}

export interface PublishTarget {
  id: string;
  /** The button's label (already localised by the feature). */
  label: string;
  /** Whether the target offers this clip (every clip when absent). */
  available?(item: LibraryItem): boolean;
  /** Publishes the clip: the post's link and/or a line for the Library to show (localised), or nothing. */
  publish(clip: PublishClip): Promise<{ url?: string; message?: string } | void>;
}

const targets = new Map<string, PublishTarget>();
const listeners = new Set<() => void>();
/** The current list, replaced (never mutated) on every change – a stable snapshot for `useSyncExternalStore`. */
let snapshot: PublishTarget[] = [];

function changed() {
  snapshot = [...targets.values()];
  for (const l of listeners) l();
}

export function registerPublishTarget(target: PublishTarget): () => void {
  targets.set(target.id, target);
  changed();
  return () => {
    targets.delete(target.id);
    changed();
  };
}

export function publishTargets(): PublishTarget[] {
  return snapshot;
}

export function onPublishTargetsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The post text of a clip: its caption and hashtags (what "Copy post text" copies). */
export function postText(meta: Pick<LibraryItem["meta"], "caption" | "hashtags" | "title">): string {
  const caption = meta.caption?.trim() || meta.title;
  const tags = meta.hashtags.filter(Boolean).join(" ");
  return tags ? `${caption}\n\n${tags}` : caption;
}
