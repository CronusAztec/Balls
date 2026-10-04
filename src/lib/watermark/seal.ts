import { LICENSE_PUBLIC_KEY, LICENSE_STORAGE_KEY, isPlan } from "@/lib/billing/config";
import { getEntitlementStore } from "@/lib/billing/entitlement";
import { ENTITLEMENT_WAIT_MS } from "@/lib/billing/guard";
import { decodeLicense, importLicenseKey, licenseExpired, verifyLicense, type LicenseCheck } from "@/lib/billing/license";
import { paintWatermark, prepareWatermark, type WatermarkFrame } from "./paint";

/*
 * --- free-watermark --- THE gate of the watermark: whether a video carries it. Every output path asks it once, when its
 * recording or export starts – the page recorder (`VideoRecorder.startRecording()`) and the fast export (`renderFast()`), and
 * through the fast export the batch render, the viral bot and the desktop app's render queue – and holds the answer, a
 * `WatermarkSeal`, in the closure of its frame loop; the compositor (`drawRecordingFrame()`) hands it to `stampFrame()` with
 * every frame, which draws the mark unless the seal is a clean one.
 *
 * The decision: `sealWatermark()` reads the licence token this browser stores (localStorage "jbl.license", an ES256-signed
 * JWT) and verifies it again right there – signature with the build's public key (`LICENSE_PUBLIC_KEY`: the production key,
 * or the committed TEST key of a test-mode build), header, payload and expiry. Only a verified, unexpired Pro licence gives
 * a clean seal; no token, a damaged, foreign, tampered or expired one gives a marked seal. The verdict lives in this module's
 * private WeakMap, keyed by the frozen seal object: nothing outside can read it except through `sealVerdict()`, and nothing
 * can set it – no setter, option, flag, DOM attribute, class, data-* attribute, CSS variable, global, URL parameter or
 * plain localStorage flag reaches it, and an object that merely looks like a seal is marked. Editing the stored token makes
 * it invalid (= marked).
 *
 * Hardening against the console: WebCrypto's `importKey` / `verify` and the clock are captured when the bundle loads, so
 * `crypto.subtle.verify = async () => true` or `Date.now = () => 0` typed into DevTools afterwards reaches nothing; and a
 * verification patched before that is caught by a canary – the same signed bytes with one bit of the signature flipped must
 * NOT verify. What this cannot stop is JavaScript that is changed before it runs (a DevTools local override, an extension, a
 * userscript), or a visitor capturing the live canvas or the screen themselves: README "Free-video watermark" says so – only
 * rendering on a server would be a guarantee.
 */

type Subtle = Pick<SubtleCrypto, "importKey" | "verify">;

/** WebCrypto as it was when the bundle loaded (null without a secure context: then every seal is marked). */
const SUBTLE: Subtle | null = (() => {
  try {
    const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
    if (!subtle) return null;
    return Object.freeze({ importKey: subtle.importKey.bind(subtle), verify: subtle.verify.bind(subtle) }) as unknown as Subtle;
  } catch {
    return null;
  }
})();
/** The clock as it was when the bundle loaded. */
const NOW: () => number = Date.now.bind(Date);

/** The answer of the gate for one recording or export: an opaque, frozen token whose verdict only this module knows. */
export interface WatermarkSeal {
  readonly kind: "watermark-seal";
  /** When it was sealed (ms since the epoch). */
  readonly sealedAt: number;
}

/** What a compositor passes with every frame: the seal of its run and the time into the clip (the badge's corner). */
export interface FrameMark {
  seal: WatermarkSeal | null;
  clipMs: number;
}

export type WatermarkVerdict = "clean" | "marked";

const verdicts = new WeakMap<object, boolean>();

function mint(clean: boolean): WatermarkSeal {
  const seal: WatermarkSeal = Object.freeze({ kind: "watermark-seal" as const, sealedAt: NOW() });
  verdicts.set(seal, clean);
  return seal;
}

/**
 * The decision for a licence check at `nowMs`: "clean" (no watermark) only for a licence whose signature, header and payload
 * verified, with a plan, before its exp (the contract's clock skew allowed); "marked" for everything else.
 */
export function watermarkDecision(check: LicenseCheck | null | undefined, nowMs: number): WatermarkVerdict {
  if (!check || check.ok !== true || !check.payload) return "marked";
  if (!isPlan(check.payload.plan) || licenseExpired(check.payload, nowMs)) return "marked";
  return "clean";
}

function storedLicence(): string | null {
  try {
    const value = (globalThis as { localStorage?: Storage }).localStorage?.getItem(LICENSE_STORAGE_KEY);
    return typeof value === "string" && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

/** A licence check or a renewal of a lapsed subscription still in flight first (bounded), so a renewed licence counts. */
async function licenceSettled(): Promise<void> {
  try {
    const store = getEntitlementStore();
    const state = store.getSnapshot();
    if (state.status !== "checking" && !state.renewing) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([store.whenIdle(), new Promise<void>((resolve) => (timer = setTimeout(resolve, ENTITLEMENT_WAIT_MS)))]);
    clearTimeout(timer);
  } catch {
    /* no store (Node): the stored licence decides */
  }
}

/** True only for a verified, unexpired Pro licence, checked with the WebCrypto captured at load – and the canary. */
async function cleanLicence(token: string | null): Promise<boolean> {
  if (!token || !SUBTLE) return false;
  let key: CryptoKey;
  try {
    key = await importLicenseKey(LICENSE_PUBLIC_KEY, SUBTLE);
  } catch {
    return false;
  }
  const now = NOW();
  const check = await verifyLicense(token, { publicKey: key, subtle: SUBTLE, now });
  if (watermarkDecision(check, now) !== "clean") return false;
  // The canary: a verification that was patched to say yes says yes to a broken signature too.
  const decoded = decodeLicense(token);
  if (!decoded) return false;
  const broken = decoded.signature.slice();
  broken[broken.length - 1] ^= 0x01;
  try {
    return !(await SUBTLE.verify({ name: "ECDSA", hash: "SHA-256" }, key, broken as BufferSource, decoded.signingInput as BufferSource));
  } catch {
    return false;
  }
}

/**
 * Seals the watermark decision for one recording or export: waits for a licence check or renewal in flight (at most
 * `ENTITLEMENT_WAIT_MS`), then verifies the stored licence again. Never throws; anything but a verified, unexpired Pro
 * licence gives a marked seal.
 */
export async function sealWatermark(): Promise<WatermarkSeal> {
  await licenceSettled();
  let clean = false;
  try {
    clean = await cleanLicence(storedLicence());
  } catch {
    clean = false;
  }
  return mint(clean);
}

/** "clean" only for a seal this module made from a verified, unexpired Pro licence; null, a look-alike or anything else is "marked". */
export function sealVerdict(seal: unknown): WatermarkVerdict {
  return typeof seal === "object" && seal !== null && verdicts.get(seal) === true ? "clean" : "marked";
}

/**
 * Draws the watermark into the composed frame (`ctx`, the compositor's own canvas) unless `seal` is a clean one. Throws
 * `WatermarkUnavailableError` (paint.ts) when the mark cannot be drawn: the compositor stops rather than export without it.
 */
export function stampFrame(ctx: CanvasRenderingContext2D, seal: unknown, frame: WatermarkFrame): void {
  if (sealVerdict(seal) === "clean") return;
  paintWatermark(ctx, frame);
}

/** Builds the mark of a frame size before the first frame of a marked run (a failure surfaces before anything records). */
export function prepareStamp(seal: unknown, frame: Pick<WatermarkFrame, "width" | "height" | "square">): void {
  if (sealVerdict(seal) === "clean") return;
  prepareWatermark(frame);
}
