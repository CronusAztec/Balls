"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useTranslations } from "next-intl";
import { SHARE_CODE_PARAM, decodeShareCode, makeShareCode, mergeShareParams, shareCodeUrl, type ShareEncodeResult } from "@/lib/shareCode";
import { settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";
import { withoutAttribution } from "@/lib/analytics/attribution"; // --- analytics ---

import { IconClose } from "@/components/ui/icons"; // --- site-redesign ---
/**
 * --- project-files --- The page's side of the short share codes (lib/shareCode.ts): the share button copies
 * `?c=<code>` (kept ready for the current settings, so the copy happens inside the click), and a link that arrives with
 * `?c=` is decoded once on load and applied like a preset – the code first, the link's other parameters on top.
 * The address bar keeps mirroring the long, readable link, so long links work as before.
 * --- unlimited-sizes --- Settings too big for a code the page could open again whole are shared as the long link, and the
 * page says so (`tooLarge`; a code used to be cut, or made too long to open).
 */

/** How long the settings must stay put before the short link is re-encoded (sliders fire on every step). */
const ENCODE_DELAY_MS = 150;

function pageAddress(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** --- unlimited-sizes --- The link the share button copies, and whether it is the long one because the settings do not fit a code. */
export interface ShareLinkChoice {
  link: string;
  tooLarge: boolean;
}

export interface ShortShareLink {
  /** The link of the current settings when it is ready (--- unlimited-sizes --- the long one when they do not fit a code), else null. */
  get: () => ShareLinkChoice | null;
  /** Encodes the current settings now; the long link when the browser has no CompressionStream (--- unlimited-sizes --- or the settings do not fit a code). */
  make: () => Promise<ShareLinkChoice>;
}

/** --- unlimited-sizes --- The short link of a code, or the long link of the page (without the ad that brought the visitor). */
function linkOf(made: ShareEncodeResult): ShareLinkChoice {
  if (made.ok) return { link: shareCodeUrl(pageAddress(), made.code), tooLarge: false };
  return { link: withoutAttribution(window.location.href), tooLarge: made.error === "too-large" }; // --- analytics --- (the ad that brought the visitor is not part of the link they share)
}

/** Keeps the short link of the current settings ready for the share button. */
export function useShortShareLink(settings: SimulatorSettings): ShortShareLink {
  const key = useMemo(() => settingsToSearchParams(settings).toString(), [settings]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const cache = useRef<{ key: string; made: ShareEncodeResult } | null>(null); // --- unlimited-sizes --- (a refusal is kept too)
  useEffect(() => {
    if (cache.current?.key === key) return;
    const id = setTimeout(() => {
      makeShareCode(new URLSearchParams(key))
        .then((made) => {
          if (made.ok || made.error === "too-large") cache.current = { key, made };
        })
        .catch(() => undefined);
    }, ENCODE_DELAY_MS);
    return () => clearTimeout(id);
  }, [key]);
  return useMemo<ShortShareLink>(
    () => ({
      get: () => (cache.current && cache.current.key === keyRef.current ? linkOf(cache.current.made) : null),
      make: async () => {
        const made = await makeShareCode(new URLSearchParams(keyRef.current)).catch((): ShareEncodeResult => ({ ok: false, error: "unsupported" }));
        return linkOf(made);
      },
    }),
    [],
  );
}

export type ShareCodeNoticeKind = "invalid" | "unsupported" | "tooLarge"; // --- unlimited-sizes --- (tooLarge: the long link was copied)

/**
 * Opens a `?c=` link: decodes the code once (after mount – DecompressionStream is asynchronous) and hands the merged
 * settings to `apply`. The notice says when a code could not be read.
 */
export function useShareCodeLoader(initialSearch: string, apply: (settings: SimulatorSettings) => void): { notice: ShareCodeNoticeKind | null; dismiss: () => void } {
  const [notice, setNotice] = useState<ShareCodeNoticeKind | null>(null);
  const search = useRef(initialSearch);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(search.current);
    const code = params.get(SHARE_CODE_PARAM);
    if (code === null) return;
    void decodeShareCode(code).then((result) => {
      if (!result.ok) {
        setNotice(result.error);
        return;
      }
      applyRef.current(settingsFromSearchParams(mergeShareParams(result.params, params)));
    });
  }, []);
  return useMemo(() => ({ notice, dismiss: () => setNotice(null) }), [notice]);
}

const NOTICE_KEYS: Record<ShareCodeNoticeKind, string> = {
  invalid: "Simulator.shareCodeInvalid",
  unsupported: "Simulator.shareCodeUnsupported",
  tooLarge: "Simulator.shareLinkTooLarge", // --- unlimited-sizes ---
};

/** A share code that could not be read (--- unlimited-sizes --- or made), said under the canvas (never on it, so a recording does not show it). */
export function ShareCodeNotice({ t, notice, onDismiss }: { t: ReturnType<typeof useTranslations>; notice: ShareCodeNoticeKind | null; onDismiss: () => void }) {
  if (!notice) return null;
  return (
    <p className="mt-1.5 flex items-start gap-2 text-xs text-warn/90 leading-relaxed" role="status" data-testid={notice === "tooLarge" ? "share-link-notice" : "share-code-notice"}>
      <span className="flex-1">{t(NOTICE_KEYS[notice])}</span>
      <button type="button" onClick={onDismiss} aria-label={t("Simulator.shareCodeDismiss")} className="text-ink-3 hover:text-ink-2 cursor-pointer">
        <IconClose size={14} />
      </button>
    </p>
  );
}
