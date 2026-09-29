/**
 * Fast export: an OfflineAudioContext seen through the export clock.
 *
 * The ToneGenerator and its players (hit sampler, song slicer, music bed) schedule every sound at "now" – the context's
 * `currentTime` – and wake a suspended context before they play. An OfflineAudioContext stands at 0 and stays
 * "suspended" until it renders, so the fast export hands them this view of it instead: `currentTime` reads the export
 * clock (seconds of the clip being rendered), `state` is "running" and `resume()` / `suspend()` / `close()` resolve at
 * once, while every other member (node factories, `destination`, `sampleRate`, `decodeAudioData`…) is the real
 * context's. So the whole clip is scheduled up front through exactly the code the page plays live – same instruments,
 * scale, beat grid, melody, samples, song slices and ducking – and rendered in one go afterwards.
 */
export function clockedAudioContext(context: BaseAudioContext, clock: () => number): AudioContext {
  const resolved = () => Promise.resolve();
  return new Proxy(context, {
    get(target, prop) {
      if (prop === "currentTime") return clock();
      if (prop === "state") return "running";
      if (prop === "resume" || prop === "suspend" || prop === "close") return resolved;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  }) as unknown as AudioContext;
}
