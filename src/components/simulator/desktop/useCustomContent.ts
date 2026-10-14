"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DesktopApi } from "@/lib/desktop/contract";
import { EMPTY_CONTENT, resolveCustomContent, type CustomContent } from "@/lib/desktop/custom";
import { MAX_CUSTOM_MODES, type CustomModeSpec } from "@/lib/desktop/ai/customMode";
import { MAX_CUSTOM_FIGHTERS, type CustomFighterSpec } from "@/lib/physics/modes/fightLeagueCustom";
import { setCustomFighters } from "@/lib/physics/modes/fightLeagueRoster";
import { messageOf, stripIpcPrefix } from "@/lib/desktop/errors";

/*
 * --- custom-content --- The player's own fighters and modes: read from the app's data folder when the Desktop group starts (the
 * fighters join the Ball Fight League's roster at once), written back after every change. Rebuilt through the builders on every
 * read and write, so the document on disk can only ever hold entries that pass them.
 */

export interface CustomContentApi {
  content: CustomContent;
  /** The first read has finished (the roster has its custom fighters). */
  loaded: boolean;
  /** The last write that failed, or null. */
  error: string | null;
  addFighter: (spec: CustomFighterSpec) => Promise<boolean>;
  removeFighter: (id: string) => Promise<void>;
  addMode: (spec: CustomModeSpec) => Promise<boolean>;
  removeMode: (id: string) => Promise<void>;
}

export function useCustomContent(bridge: DesktopApi | null): CustomContentApi {
  const [content, setContent] = useState<CustomContent>(EMPTY_CONTENT);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<CustomContent>(EMPTY_CONTENT);

  useEffect(() => {
    if (!bridge?.custom) return;
    let live = true;
    bridge.custom
      .load()
      .then((raw) => {
        if (!live) return;
        const { content: next, rows } = resolveCustomContent(raw);
        ref.current = next;
        setCustomFighters(rows);
        setContent(next);
      })
      .catch(() => {})
      .finally(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [bridge]);

  /** Applies `change` to the latest document, rebuilds it, publishes it to the roster and the page and writes it. */
  const commit = useCallback(
    async (change: (c: CustomContent) => CustomContent): Promise<boolean> => {
      if (!bridge?.custom) return false;
      const { content: next, rows } = resolveCustomContent(change(ref.current));
      const before = ref.current;
      ref.current = next;
      setCustomFighters(rows);
      setContent(next);
      try {
        await bridge.custom.save(next);
        setError(null);
        return true;
      } catch (err) {
        // not on disk: back to what was, so the page never shows what the next start would lose
        ref.current = before;
        setCustomFighters(resolveCustomContent(before).rows);
        setContent(before);
        setError(stripIpcPrefix(messageOf(err)));
        return false;
      }
    },
    [bridge],
  );

  const addFighter = useCallback((spec: CustomFighterSpec) => (ref.current.fighters.length >= MAX_CUSTOM_FIGHTERS ? Promise.resolve(false) : commit((c) => ({ ...c, fighters: [...c.fighters, spec] }))), [commit]);
  const removeFighter = useCallback(async (id: string) => void (await commit((c) => ({ ...c, fighters: c.fighters.filter((f) => f.id !== id) }))), [commit]);
  const addMode = useCallback((spec: CustomModeSpec) => (ref.current.modes.length >= MAX_CUSTOM_MODES ? Promise.resolve(false) : commit((c) => ({ ...c, modes: [...c.modes, spec] }))), [commit]);
  const removeMode = useCallback(async (id: string) => void (await commit((c) => ({ ...c, modes: c.modes.filter((m) => m.id !== id) }))), [commit]);

  return { content, loaded, error, addFighter, removeFighter, addMode, removeMode };
}
