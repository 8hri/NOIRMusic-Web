/**
 * NOIR Music — visualizer presentation model, ported from the native app's
 * `VisualizerModel.swift` / `BandPresentation`.
 *
 * Pure presentation logic only: sensitivity scaling, clamping to [0, 1], and
 * the coarse aggregation Minimal mode uses. Mode switching touches only this
 * layer — the audio element and analyser keep running regardless, so changing
 * modes can never disrupt playback (native DESIGN.md §4).
 */

import type { VisualizerMode } from './models';
import { VISUALIZER_MODE_LABELS, VISUALIZER_MODE_ORDER } from './models';

/** Next mode in the picker order (menu cycles; Settings lists all modes). */
export function nextVisualizerMode(mode: VisualizerMode): VisualizerMode {
  const index = VISUALIZER_MODE_ORDER.indexOf(mode);
  if (index < 0) return 'bars';
  return VISUALIZER_MODE_ORDER[(index + 1) % VISUALIZER_MODE_ORDER.length];
}

/**
 * The restrained multi-hue palette DESIGN.md §3 reserves for the visualizer:
 * coral, violet, cyan, amber. High saturation lives only here.
 */
export const VISUALIZER_PALETTE = {
  bars: '#C39A63',
  wave: '#C39A63',
  spectrum: ['#E8736A', '#9882DC', '#60C7D4', '#E0AC60'] as const,
} as const;

export function spectrumColor(bandIndex: number, count: number): string {
  const colors = VISUALIZER_PALETTE.spectrum;
  if (count <= 1) return colors[0];
  const position = (bandIndex / (count - 1)) * (colors.length - 1);
  const i = Math.round(position);
  return colors[Math.min(Math.max(i, 0), colors.length - 1)];
}

export const VISUALIZER_MODE_LABEL = VISUALIZER_MODE_LABELS;

/**
 * Scales raw band values by sensitivity (0.5…2.0, default 1) and clamps to
 * [0, 1]. When analysis data is unavailable, paused, or stopped, the provider
 * publishes all-zero bands — the visuals settle flat, playback is unaffected.
 */
export function scaleBands(
  bands: ReadonlyArray<number>,
  sensitivity: number,
): number[] {
  const multiplier = Math.min(Math.max(sensitivity, 0.5), 2);
  return bands.map((value) => Math.min(Math.max(value * multiplier, 0), 1));
}

/**
 * Aggregates `bands` into `count` groups by max — Minimal mode's fewer,
 * wider elements. An empty input stays flat.
 */
export function aggregateBands(
  bands: ReadonlyArray<number>,
  count: number,
): number[] {
  if (count <= 0) return [];
  if (bands.length === 0) return Array.from({ length: count }, () => 0);
  if (bands.length <= count) return [...bands];

  const groupSize = bands.length / count;
  const out: number[] = [];
  for (let group = 0; group < count; group += 1) {
    const start = Math.floor(group * groupSize);
    const end = Math.max(start + 1, Math.floor((group + 1) * groupSize));
    let max = 0;
    for (let i = start; i < end && i < bands.length; i += 1) {
      if (bands[i] > max) max = bands[i];
    }
    out.push(max);
  }
  return out;
}
