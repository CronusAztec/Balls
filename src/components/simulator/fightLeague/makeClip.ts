import { finderRequestOfSettings, type BotWorld } from "@/lib/bot/finderRequest";
import type { SimulatorSettings } from "@/lib/settings";
import { simulateSeed } from "@/lib/simulation/finder";
import { FL_CLIP_PACE_SEEDS, flMedianSec, type FlClipBucket, type FlClipPlan, type FlClipStory } from "@/lib/physics/modes/fightLeagueClip";

/*
 * --- fl-overhaul --- (Stage 6) "Make a clip" between the Fight League block and the page: the block asks for a clip (a bucket
 * and a story) through `flClipBridge`; Simulator.tsx measures the matchup's pace (`measureFlKoSec()`), plans the clip
 * (lib/physics/modes/fightLeagueClip.ts), runs Find Simulation with it – its progress and its result in the finder's own strip –
 * and reports back here (searching, found with the KO's place in the clip, or missed), which the block shows and writes into
 * its data attributes (data-fl-clip-plan, data-fl-clip-ko, data-fl-clip-state).
 */

export interface FlClipRequest {
  bucket: FlClipBucket;
  story: FlClipStory;
}

export type FlClipState = "idle" | "measuring" | "searching" | "found" | "missed";

export interface FlClipStatus {
  state: FlClipState;
  plan: FlClipPlan | null;
  /** The found clip: its length (s), the final KO's place in it (0–1; null for a cliffhanger) and the seed. */
  recordingSec: number | null;
  koFraction: number | null;
  seed: number | null;
}

const IDLE: FlClipStatus = { state: "idle", plan: null, recordingSec: null, koFraction: null, seed: null };

type RequestListener = (request: FlClipRequest) => void;
type StatusListener = () => void;

/** The page's one bridge: requests from the block to the page, the status back (a store for useSyncExternalStore). */
class FlClipBridge {
  private requestListeners = new Set<RequestListener>();
  private statusListeners = new Set<StatusListener>();
  private status: FlClipStatus = IDLE;

  /** The page listens for requests (returns the unsubscribe). */
  onRequest = (listener: RequestListener) => {
    this.requestListeners.add(listener);
    return () => {
      this.requestListeners.delete(listener);
    };
  };

  /** The block asks for a clip; false when no page listens. */
  request(request: FlClipRequest): boolean {
    if (this.requestListeners.size === 0) return false;
    for (const l of [...this.requestListeners]) l(request);
    return true;
  }

  subscribe = (listener: StatusListener) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };

  getStatus = (): FlClipStatus => this.status;
  getServerStatus = (): FlClipStatus => IDLE;

  setStatus(status: Partial<FlClipStatus> & { state: FlClipState }) {
    this.status = { ...IDLE, ...(status.state === "found" || status.state === "missed" || status.state === "searching" || status.state === "measuring" ? { plan: this.status.plan } : {}), ...status };
    for (const l of [...this.statusListeners]) l();
  }

  reset() {
    this.status = IDLE;
    for (const l of [...this.statusListeners]) l();
  }
}

export const flClipBridge = new FlClipBridge();

/**
 * The matchup's median KO (s into the run) at its current settings: `FL_CLIP_PACE_SEEDS` seeds simulated headless in the page's
 * world (the seed finder's engine and request – lib/bot/finderRequest.ts – so it is the run the finder will search), each followed
 * at most `maxSec`. Null when no seed finished. Deterministic: the same settings always give the same pace.
 */
export function measureFlKoSec(settings: SimulatorSettings, world: BotWorld, maxSec = 240): number | null {
  const request = finderRequestOfSettings(settings, world, maxSec);
  const ends: number[] = [];
  for (const seed of FL_CLIP_PACE_SEEDS) {
    const ms = simulateSeed(seed, request, 1000 * maxSec);
    if (ms < 1000 * maxSec) ends.push(ms / 1000);
  }
  return flMedianSec(ends);
}
