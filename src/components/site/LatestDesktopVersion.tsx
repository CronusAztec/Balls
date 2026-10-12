"use client";
import { useEffect, useState } from "react";

/*
 * --- desktop-autorelease --- The Windows app's version on the download page: the build-time version (DESKTOP_VERSION, in the
 * static HTML and the JSON-LD) until the browser has asked GitHub which release is the latest – the same release the fixed
 * download links serve – then that version and a "What's new" link to its release page. Offline, rate-limited (60 requests an
 * hour per address, so the answer is kept for an hour in sessionStorage) or on a tag that is not desktop-v<x.y.z>, the
 * build-time version stays. Nothing here throws into the page.
 */
export const LATEST_CACHE_KEY = "jbl.desktopLatest";
export const LATEST_CACHE_MS = 60 * 60 * 1000;

type Latest = { version: string; url: string };

/** The version and release page of a GitHub "latest release" answer whose tag is desktop-v<x.y.z>; null for anything else. */
export function parseLatest(json: unknown): Latest | null {
  if (!json || typeof json !== "object") return null;
  const { tag_name: tag, html_url: url } = json as { tag_name?: unknown; html_url?: unknown };
  if (typeof tag !== "string" || typeof url !== "string" || !url) return null;
  const m = /^desktop-v(\d+\.\d+\.\d+)$/.exec(tag);
  return m ? { version: m[1], url } : null;
}

/** A fresh answer kept in sessionStorage, or null. */
function cached(): Latest | null {
  try {
    const raw = sessionStorage.getItem(LATEST_CACHE_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as { version?: unknown; url?: unknown; at?: unknown };
    if (typeof c.version !== "string" || typeof c.url !== "string" || typeof c.at !== "number") return null;
    return Date.now() - c.at < LATEST_CACHE_MS ? { version: c.version, url: c.url } : null;
  } catch {
    return null;
  }
}

function remember(latest: Latest) {
  try {
    sessionStorage.setItem(LATEST_CACHE_KEY, JSON.stringify({ ...latest, at: Date.now() }));
  } catch {
    /* private mode or full storage: asked again next time */
  }
}

export default function LatestDesktopVersion({
  repo,
  fallbackVersion,
  fallbackUrl,
  versionTemplate,
  whatsNewTemplate,
}: {
  repo: string;
  fallbackVersion: string;
  fallbackUrl: string;
  versionTemplate: string;
  whatsNewTemplate: string;
}) {
  // the server render and the first client render agree: the build-time version
  const [latest, setLatest] = useState<Latest>({ version: fallbackVersion, url: fallbackUrl });

  useEffect(() => {
    let live = true;
    const hit = cached();
    if (hit) {
      setLatest(hit);
      return;
    }
    void (async () => {
      try {
        const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) return;
        const found = parseLatest(await res.json());
        if (!found) return;
        remember(found);
        if (live) setLatest(found);
      } catch {
        /* offline, blocked or timed out: the build-time version stays */
      }
    })();
    return () => {
      live = false;
    };
  }, [repo]);

  return (
    <p className="font-medium text-ink" data-testid="download-version">
      {versionTemplate.replace("{version}", latest.version)}{" "}
      <a href={latest.url} className="font-normal text-accent hover:text-accent-strong" data-testid="download-whats-new" rel="nofollow">
        {whatsNewTemplate.replace("{version}", latest.version)}
      </a>
    </p>
  );
}
