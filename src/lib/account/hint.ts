"use client";

import { useEffect, useState } from "react";
import { ACCOUNT_EVENT, ACCOUNT_STORAGE_KEY, loadAccount } from "./store";

/*
 * --- user-accounts --- The navbar's cheap peek at who is signed in: one localStorage read, no request, nothing of the Publish
 * feature loaded (so it lives apart from hooks.ts, which runs the whole controller). Kept current when the account changes in
 * this tab (ACCOUNT_EVENT) or another one (storage).
 */

/** The name of the signed-in user, null when nobody is (and on the server and before the first effect). */
export function useAccountHint(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setName(loadAccount(Date.now())?.user.name ?? null);
    read();
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === ACCOUNT_STORAGE_KEY) read();
    };
    window.addEventListener(ACCOUNT_EVENT, read);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ACCOUNT_EVENT, read);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return name;
}
