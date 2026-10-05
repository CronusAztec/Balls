import { describeError } from "@/lib/desktop/errors";
import { anthropicClient, hostOf, type AnthropicLike } from "./ai/cloud";

/*
 * --- desktop-ai-fix --- The main process's HTTP. Node's own fetch (undici) ignores the Windows certificate store and the
 * system proxy, so behind an antivirus that scans HTTPS (Kaspersky, ESET, Avast/AVG, Bitdefender) or a company proxy every
 * model download and cloud call of 1.0.2 failed with a bare "fetch failed". Electron's net.fetch goes through Chromium's
 * network stack – the system proxy / PAC and the OS certificate store, like the app's own page and electron-updater – so
 * the model manager, the OpenAI-compatible adapter and the Anthropic SDK all get it from here. Node's fetch is kept as the
 * fallback – a request net.fetch cannot get an answer for (no HTTP response at all) is tried once more through it, which
 * covers the opposite case (a CA Node knows and the system store does not) – and for the status panel's comparison (TLS
 * interception shows as one working and the other not).
 */

/** Electron's `net.fetch` signature (a subset: what the app passes). */
export type NetFetch = (input: string | Request, init?: RequestInit) => Promise<Response>;

export interface NetworkDeps {
  /** For the model manager's downloads. */
  modelFetch: typeof fetch;
  /** For the OpenAI-compatible adapter (AiService). */
  aiFetch: typeof fetch;
  /** The Anthropic SDK's client over the same fetch. */
  anthropic: (apiKey: string, baseUrl: string) => AnthropicLike;
}

/** `net.fetch` as the `fetch` the services take (a URL object is passed on as its string). */
export function asFetch(netFetch: NetFetch): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => netFetch(input instanceof URL ? input.toString() : input, init)) as typeof fetch;
}

/** The URL a fetch call is for. */
function urlOf(input: string | URL | Request): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

/**
 * `primary` (net.fetch) first; when it gets no answer at all (it throws – an HTTP error status is an answer), the same request
 * once more through `fallback` (Node's fetch). A request that was stopped is not retried. When both fail, the error says both.
 */
export function withFallback(primary: typeof fetch, fallback: typeof fetch | null, log: (message: string) => void = () => {}): typeof fetch {
  if (!fallback) return primary;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    try {
      return await primary(input, init);
    } catch (err) {
      if (init?.signal?.aborted || (err as { name?: string })?.name === "AbortError") throw err;
      try {
        const response = await fallback(input, init);
        log(`net.fetch could not reach ${hostOf(urlOf(input))} (${describeError(err)}); Node's fetch could`);
        return response;
      } catch (err2) {
        if (init?.signal?.aborted || (err2 as { name?: string })?.name === "AbortError") throw err2;
        throw new Error(`${describeError(err)}; through Node's fetch: ${describeError(err2)}`, { cause: err });
      }
    }
  }) as typeof fetch;
}

/** Every main-process HTTP client over Electron's net.fetch (`nodeFetch`: the fallback). */
export function networkDeps(netFetch: NetFetch, nodeFetch: typeof fetch | null = null, log: (message: string) => void = () => {}): NetworkDeps {
  const f = withFallback(asFetch(netFetch), nodeFetch, log);
  return { modelFetch: f, aiFetch: f, anthropic: (apiKey, baseUrl) => anthropicClient(apiKey, baseUrl, f) };
}
