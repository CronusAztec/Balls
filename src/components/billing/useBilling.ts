"use client";

import { useEffect, useMemo, useState } from "react";
import { BillingClient, type BillingConfig, type BillingResult } from "@/lib/billing/api";
import { renewQuietly } from "@/lib/billing/account";
import { LICENSE_TEST_MODE, billingApiBase } from "@/lib/billing/config";
import { getEntitlementStore, useEntitlement } from "@/lib/billing/entitlement";
import { BASE_PATH, SITE_URL } from "@/lib/site";

/*
 * --- paywall-gate --- The page's link to the billing backend: its address (the build's NEXT_PUBLIC_BILLING_API, or the
 * test-mode override – read after mounting, the static page has no localStorage), a client for it and its /config (cached
 * for the page: the pricing page and the Unlock dialog share one request). Without an address the pay buttons say that
 * payments are not configured and nothing is sent anywhere.
 */

export type BillingConfigState = "unconfigured" | "loading" | "ready" | "failed";

export interface BillingLink {
  /** The backend's address, null when payments are not configured (or before mounting). */
  base: string | null;
  client: BillingClient | null;
  config: BillingConfig | null;
  configState: BillingConfigState;
  /** The site or the backend runs on test keys: the yellow line says so. */
  testMode: boolean;
  /** False until mounted (the address is read from the browser). */
  mounted: boolean;
}

let configCache: { base: string; promise: Promise<BillingResult<BillingConfig>> } | null = null;

function loadConfig(base: string, client: BillingClient): Promise<BillingResult<BillingConfig>> {
  if (!configCache || configCache.base !== base) {
    const promise = client.config();
    configCache = { base, promise };
    // a failed request is asked again next time (the network may be back)
    void promise.then((r) => {
      if (!r.ok && configCache?.promise === promise) configCache = null;
    });
  }
  return configCache.promise;
}

/**
 * The pricing page of the page's language as a plain address (with the base path and the static export's trailing slash).
 * The studio's pieces link with it rather than next-intl's Link: the panel's module graph stays free of next/navigation.
 */
export function pricingHref(locale: string, hash = ""): string {
  return `${BASE_PATH}/${locale}/pricing/${hash}`;
}

/** Where a checkout returns to: this site (with its base path) – or, inside the desktop app (app://), the public site. */
export function siteBaseUrl(): string {
  if (typeof window !== "undefined" && /^https?:$/.test(window.location.protocol)) return `${window.location.origin}${BASE_PATH}`;
  return SITE_URL;
}

export function useBilling(): BillingLink {
  const [base, setBase] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [configState, setConfigState] = useState<BillingConfigState>("loading");
  useEffect(() => {
    setBase(billingApiBase());
    setMounted(true);
  }, []);
  // http checkout addresses are followed only against a test-mode backend on this machine's network (`wrangler dev`)
  const client = useMemo(() => (base ? new BillingClient(base, undefined, LICENSE_TEST_MODE) : null), [base]);
  useEffect(() => {
    if (!mounted) return;
    if (!base || !client) {
      setConfigState("unconfigured");
      return;
    }
    let alive = true;
    setConfigState("loading");
    void loadConfig(base, client).then((r) => {
      if (!alive) return;
      setConfig(r.ok ? r.value : null);
      setConfigState(r.ok ? "ready" : "failed");
    });
    return () => {
      alive = false;
    };
  }, [base, client, mounted]);
  return { base, client, config, configState, testMode: LICENSE_TEST_MODE || config?.testMode === true, mounted };
}

/**
 * Renews a subscription's licence quietly near its end (lib/billing/account.ts `renewQuietly`). Asks nothing – not even
 * /config – unless a renewal is due, and nothing without a backend.
 */
export function useLicenseRenewal(): void {
  const e = useEntitlement();
  useEffect(() => {
    if (e.status !== "pro") return;
    const base = billingApiBase();
    if (!base) return;
    let storage: Storage | null = null;
    try {
      storage = localStorage;
    } catch {
      storage = null;
    }
    void renewQuietly(getEntitlementStore(), new BillingClient(base, undefined, LICENSE_TEST_MODE), storage, Date.now()).catch(() => {});
  }, [e.status, e.expiresAt]);
}
