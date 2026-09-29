"use client";

import { forwardRef, useState, useSyncExternalStore, type ForwardRefExoticComponent, type RefAttributes } from "react";
import type { CanvasHandle, CanvasProps } from "./Canvas";
import type { FastRenderJob } from "@/lib/recording/fastRender";
import { exportRaceOptions } from "./raceRenderer";

/*
 * --- fast-render --- The page's canvas, plus – while a fast export runs – a second, hidden instance of it that renders the
 * export (lib/recording/fastRender.ts). The second instance gets every prop the page gives the visible one (so each look,
 * overlay and feature of the canvas is in the export without being listed here), frozen when the export starts, on the
 * export's own engine and in offline mode: no animation loop, the export's size and clock, recording from its first frame.
 * Canvas.tsx exports its component wrapped in this.
 */

type CanvasComponent = ForwardRefExoticComponent<CanvasProps & RefAttributes<CanvasHandle>>;

const noSubscribe = () => () => {};
const noJob = (): FastRenderJob | null => null;

export function withFastRender(Inner: CanvasComponent): CanvasComponent {
  /** The export's canvas: the page's props as they were when the export started, on the export's engine and clock. */
  function OfflineCanvas({ job, props }: { job: FastRenderJob; props: CanvasProps }) {
    // The race's cup table scores the exported race under the page's run key (the export's engine counts its runs from 1).
    const [frozen] = useState<CanvasProps>(() => ({ ...props, race: exportRaceOptions(props.race, job.raceKey) }));
    return (
      <Inner
        {...frozen}
        physicsEngine={job.engine}
        offline={job.driver}
        fastRender={null}
        isStarted
        isPaused={false}
        simSpeed={1}
        audioIntensity={0}
        obstacleEditing={false}
        onObstaclesChange={undefined}
        onCharacterChirp={job.onChirp}
      />
    );
  }

  const CanvasWithFastRender = forwardRef<CanvasHandle, CanvasProps>(function CanvasWithFastRender(props, ref) {
    const host = props.fastRender ?? null;
    const job = useSyncExternalStore(host ? host.subscribe : noSubscribe, host ? host.getJob : noJob, noJob);
    return (
      <>
        <Inner {...props} ref={ref} />
        {job && <OfflineCanvas key={job.id} job={job} props={props} />}
      </>
    );
  });
  return CanvasWithFastRender;
}
