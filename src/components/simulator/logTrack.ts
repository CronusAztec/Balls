/*
 * --- low-findings-2 --- A logarithmic slider track (ControlPrimitives' Slider with `log`): for a setting whose interesting values
 * span decades – the chaos fan's start spread, a millionth to a whole degree – a linear track puts everything below a thousandth
 * in its first pixel. Positions 0 … steps + 1 of the <input type="range">: position 0 is the range's minimum (the fan's 0°: no
 * spread at all), positions 1 … steps + 1 run from `low` to the range's maximum evenly in the logarithm (every decade the same
 * length), the values rounded to three significant digits so a decade's ends are exact (0.001, not 0.000999…). The number field
 * beside the track stays exact and unbounded: a value between two positions, below `low` or past the maximum is kept as typed and
 * the thumb sits on the nearest position (or the track's end).
 */

export interface LogTrackSpec {
  /** The smallest positive value on the track (position 1). */
  low: number;
  /** The largest (the last position): the slider's maximum. */
  high: number;
  /** Positions a decade. */
  perDecade: number;
  /** Position 0's value: the slider's minimum. */
  min: number;
}

/** The last position of the track (positions run 0 … this). */
export function logTrackEnd(spec: LogTrackSpec): number {
  return Math.max(1, Math.round(spec.perDecade * Math.log10(spec.high / spec.low))) + 1;
}

/** The value at track position `pos` (whole positions; out-of-track positions clamp to the ends). */
export function logTrackValue(pos: number, spec: LogTrackSpec): number {
  const end = logTrackEnd(spec);
  const p = Math.round(Math.min(end, Math.max(0, pos)));
  if (p <= 0) return spec.min;
  const exponent = Math.log10(spec.low) + ((p - 1) * Math.log10(spec.high / spec.low)) / (end - 1);
  return Number(Math.pow(10, exponent).toPrecision(3));
}

/** The track position nearest `value` (0 for the minimum or below, the track's ends past them; NaN sits at 0). */
export function logTrackPosition(value: number, spec: LogTrackSpec): number {
  const end = logTrackEnd(spec);
  if (!(value > spec.min) || !(value > 0)) return 0;
  if (value <= spec.low) return 1;
  if (value >= spec.high) return end;
  return Math.min(end, Math.max(1, 1 + Math.round(((end - 1) * Math.log10(value / spec.low)) / Math.log10(spec.high / spec.low))));
}
