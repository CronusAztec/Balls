import type { LibraryItem } from "./contract";

/*
 * --- desktop-exe --- EXTENSION POINT for one-click publishing from the desktop Library.
 *
 * The Publish feature (direct YouTube upload, the relay, share – built on its own branch) plugs in here when it is merged:
 * it registers one target per path with `registerPublishTarget()`, and the Library shows a "Publish to …" button per
 * target for every clip (the button hands the target the clip's file, read through the app, and its post copy). Until a
 * target is registered, the Library offers "Copy post text" and "Show in folder" only.
 *
 *   // --- desktop-exe --- publish hook (in the Publish feature's page code):
 *   registerPublishTarget({ id: "youtube", label: "YouTube", publish: (clip) => uploadToYouTube(clip.file, clip.title, clip.caption) });
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
  publish(clip: PublishClip): Promise<{ url?: string } | void>;
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
