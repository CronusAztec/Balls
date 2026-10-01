"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { useTranslations } from "next-intl";
import { SHARE_CODE_PARAM, decodeShareCode, encodeShareCode, mergeShareParams, shareCodeUrl } from "@/lib/shareCode";
import { settingsFromSearchParams, settingsToSearchParams, type SimulatorSettings } from "@/lib/settings";

import { IconClose } from "@/components/ui/icons"; // --- site-redesign ---
/**
 * --- project-files --- The page's side of the short share codes (lib/shareCode.ts): the share button copies
 * `?c=<code>` (kept ready for the current settings, so the copy happens inside the click), and a link that arrives with
 * `?c=` is decoded once on load and applied like a preset – the code first, the link's other parameters on top.
 * The address bar keeps mirroring the long, readable link, so long links work as before.
 */

/** How long the settings must stay put before the short link is re-encoded (sliders fire on every step). */
const ENCODE_DELAY_MS = 150;

function pageAddress(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

export interface ShortShareLink {
  /** The short link of the current settings when it is ready, else null. */
  get: () => string | null;
  /** Encodes the current settings now; the long link when the browser has no CompressionStream. */
  make: () => Promise<string>;
}

/** Keeps the short link of the current settings ready for the share button. */
export function useShortShareLink(settings: SimulatorSettings): ShortShareLink {
  const key = useMemo(() => settingsToSearchParams(settings).toString(), [settings]);
  const keyRef = useRef(key);
  keyRef.current = key;
  const cache = useRef<{ key: string; code: string } | null>(null);
  useEffect(() => {
    if (cache.current?.key === key) return;
    const id = setTimeout(() => {
      encodeShareCode(new URLSearchParams(key))
        .then((code) => {
          if (code) cache.current = { key, code };
        })
        .catch(() => undefined);
    }, ENCODE_DELAY_MS);
    return () => clearTimeout(id);
  }, [key]);
  return useMemo<ShortShareLink>(
    () => ({
      get: () => (cache.current && cache.current.key === keyRef.current ? shareCodeUrl(pageAddress(), cache.current.code) : null),
      make: async () => {
        const code = await encodeShareCode(new URLSearchParams(keyRef.current)).catch(() => null);
        return code ? shareCodeUrl(pageAddress(), code) : window.location.href;
      },
    }),
    [],
  );
}

export type ShareCodeNoticeKind = "invalid" | "unsupported";

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

/** A share code that could not be read, said under the canvas (never on it, so a recording does not show it). */
export function ShareCodeNotice({ t, notice, onDismiss }: { t: ReturnType<typeof useTranslations>; notice: ShareCodeNoticeKind | null; onDismiss: () => void }) {
  if (!notice) return null;
  return (
    <p className="mt-1.5 flex items-start gap-2 text-xs text-warn/90 leading-relaxed" role="status" data-testid="share-code-notice">
      <span className="flex-1">{t(notice === "invalid" ? "Simulator.shareCodeInvalid" : "Simulator.shareCodeUnsupported")}</span>
      <button type="button" onClick={onDismiss} aria-label={t("Simulator.shareCodeDismiss")} className="text-ink-3 hover:text-ink-2 cursor-pointer">
        <IconClose size={14} />
      </button>
    </p>
  );
}
