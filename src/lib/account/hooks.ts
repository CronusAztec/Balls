"use client";

import { useEffect, useSyncExternalStore } from "react";
import { getAccountController } from "./controller";

/*
 * --- user-accounts --- The React side of the account: `useAccount()` runs the controller (the Account page)
 */

export function useAccount() {
  const controller = getAccountController();
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getServerSnapshot);
  useEffect(() => {
    controller.start();
  }, [controller]);
  return { controller, snapshot };
}

