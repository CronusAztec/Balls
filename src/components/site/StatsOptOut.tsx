"use client";

import { useEffect, useState } from "react";
import { STATS_OFF_KEY } from "@/lib/analytics/track";

/*
 * --- legal-audit --- The privacy policy's switch for the action counts: a small client island on an otherwise static page. It
 * writes localStorage `jbl.stats.off` = "1" (lib/analytics/track.ts reads it: `trackingAllowed()` is then false, so the loader
 * injects no script and `track()` sends nothing in this browser) and shows the way back. The labels come from the server page,
 * so the island reads no message catalogue of its own. Every storage access is wrapped: a private window or blocked storage
 * leaves the switch showing the opt-out and nothing breaks.
 */

export interface StatsOptOutLabels {
  optOut: string;
  optedOut: string;
  optIn: string;
}

function readOff(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(STATS_OFF_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOff(off: boolean): void {
  try {
    if (off) window.localStorage.setItem(STATS_OFF_KEY, "1");
    else window.localStorage.removeItem(STATS_OFF_KEY);
  } catch {
    /* storage blocked: the page still renders */
  }
}

export default function StatsOptOut({ labels }: { labels: StatsOptOutLabels }) {
  const [off, setOff] = useState(false);
  useEffect(() => setOff(readOff()), []); // after hydration: the static HTML always shows the opt-out
  const toggle = (next: boolean) => {
    writeOff(next);
    setOff(readOff()); // what the storage really holds (blocked storage: the switch stays on the opt-out)
  };
  const button = "underline hover:text-ink";
  return (
    <span className="block pt-1" data-testid="stats-opt-out" data-off={off ? "1" : "0"}>
      {off ? (
        <>
          <span>{labels.optedOut}</span>{" "}
          <button type="button" className={button} onClick={() => toggle(false)}>
            {labels.optIn}
          </button>
        </>
      ) : (
        <button type="button" className={button} onClick={() => toggle(true)}>
          {labels.optOut}
        </button>
      )}
    </span>
  );
}
