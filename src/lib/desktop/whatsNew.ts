/*
 * --- changelog --- When the Windows app shows its "What's new in x.y.z" notice: once, after the app's version has risen. The last
 * version the notice has seen is kept in this browser's storage (the app's own profile). The very first run stores the version
 * and shows nothing (a new install has nothing "new" to announce); a lower version (a reinstall of an older build) is stored
 * without a notice; storage that cannot be read or written shows nothing (the notice would come back at every start).
 */

export const WHATS_NEW_STORAGE_KEY = "jumpingballslive_whatsnew";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

/** Negative, zero or positive like a comparator for two x.y.z versions; null when either is not x.y.z. */
export function compareVersions(a: string, b: string): number | null {
  const x = SEMVER.exec(a);
  const y = SEMVER.exec(b);
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d !== 0) return d;
  }
  return 0;
}

export interface WhatsNewDecision {
  /** Show the notice for the current version. */
  show: boolean;
  /** Store the current version as the last one seen. */
  remember: boolean;
}

/** What to do at start-up, given the last version seen (null: never) and the version that runs. */
export function whatsNewDecision(seen: string | null, current: string): WhatsNewDecision {
  if (!SEMVER.test(current)) return { show: false, remember: false };
  if (seen === null || !SEMVER.test(seen)) return { show: false, remember: true };
  const order = compareVersions(current, seen) ?? 0;
  if (order === 0) return { show: false, remember: false };
  return { show: order > 0, remember: true };
}

/** The part of Storage the notice uses (a test hands it a Map). */
export interface SeenStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Decides and remembers in one step: true when the notice for `current` is to be shown now. The version is stored before the
 * notice appears, so it is shown once even if the app is closed without pressing Dismiss.
 */
export function claimWhatsNew(store: SeenStore | null, current: string): boolean {
  if (!store) return false;
  try {
    const decision = whatsNewDecision(store.getItem(WHATS_NEW_STORAGE_KEY), current);
    if (decision.remember) store.setItem(WHATS_NEW_STORAGE_KEY, current);
    return decision.show;
  } catch {
    return false;
  }
}

/** The page's localStorage, or null where it cannot be reached (blocked, no window). */
export function pageStorage(): SeenStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
