/**
 * NOIR Music — visualizer canvas.
 *
 * Draws the four native modes (bars / wave / spectrum / minimal) from live
 * analyser data published by the audio engine. Rules carried over from the
 * native `VisualizerView`:
 *
 *   - Mode switching never touches the audio path — a different render mode
 *     simply reads different data next frame.
 *   - Reduce-motion (OS setting or the app's own toggle) freezes the bars to
 *     a single flat frame; audio playback is never affected.
 *   - When no analyser is available, the canvas renders one calm flat row so
 *     the Now Playing layout stays composed instead of showing an error.
 */

import { useEffect, useRef } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import {
  aggregateBands,
  scaleBands,
  spectrumColor,
  VISUALIZER_PALETTE,
} from '@/audio/visualizerModel';

export function Visualizer({ height = 64 }: { height?: number }) {
  const { prefs, frequencyBands, waveformSamples, isPlaying } = useMusic();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const reduceMotion =
      prefs.reduceVisualizerMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sensitivity = prefs.visualizerSensitivity;
    const mode = prefs.visualizerMode;

    const draw = () => {
      frameRef.current = null;
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (
        canvas.width !== Math.round(cssWidth * dpr) ||
        canvas.height !== Math.round(cssHeight * dpr)
      ) {
        canvas.width = Math.round(cssWidth * dpr);
        canvas.height = Math.round(cssHeight * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, cssWidth, cssHeight);

      const palette = getComputedStyle(canvas).getPropertyValue('--accent').trim() ||
        VISUALIZER_PALETTE.bars;
      context.fillStyle = palette;
      context.strokeStyle = palette;

      const rawBands = frequencyBands();
      const scaled = rawBands ? scaleBands(rawBands, sensitivity) : null;

      switch (mode) {
        case 'bars':
          drawBars(context, cssWidth, cssHeight, scaled);
          break;
        case 'wave':
          drawWave(context, cssWidth, cssHeight, waveformSamples(), scaled);
          break;
        case 'spectrum':
          drawSpectrum(context, cssWidth, cssHeight, scaled);
          break;
        case 'minimal':
          drawMinimal(context, cssWidth, cssHeight, scaled);
          break;
      }

      // Only animate while playing (or once, under reduced motion).
      if (isPlaying && !reduceMotion) {
        frameRef.current = window.requestAnimationFrame(draw);
      }
    };

    draw();

    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [
    prefs.visualizerMode,
    prefs.visualizerSensitivity,
    prefs.reduceVisualizerMotion,
    frequencyBands,
    waveformSamples,
    isPlaying,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: `${height}px`, display: 'block' }}
      aria-hidden="true"
    />
  );
}

function drawBars(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[] | null,
) {
  const values = bands ?? flat(width);
  const count = Math.min(values.length, 48);
  const gap = 3;
  const barWidth = (width - gap * (count - 1)) / count;
  for (let i = 0; i < count; i += 1) {
    const value = values[i];
    const barHeight = Math.max(2, value * height);
    const x = i * (barWidth + gap);
    const y = height - barHeight;
    roundedRect(context, x, y, barWidth, barHeight, Math.min(barWidth / 2, 2));
    context.fill();
  }
}

function drawWave(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  samples: number[] | null,
  bands: number[] | null,
) {
  const values = samples ? scaleValues(samples) : bands ?? flat(width);
  const count = values.length;
  if (count < 2) return;
  context.lineWidth = 1.5;
  context.beginPath();
  for (let i = 0; i < count; i += 1) {
    const x = (i / (count - 1)) * width;
    const y = height - values[i] * height;
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function drawSpectrum(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[] | null,
) {
  const values = bands ?? flat(width);
  const count = Math.min(values.length, 48);
  const gap = 3;
  const barWidth = (width - gap * (count - 1)) / count;
  for (let i = 0; i < count; i += 1) {
    const value = values[i];
    const barHeight = Math.max(2, value * height);
    context.fillStyle = spectrumColor(i, count);
    roundedRect(
      context,
      i * (barWidth + gap),
      height - barHeight,
      barWidth,
      barHeight,
      Math.min(barWidth / 2, 2),
    );
    context.fill();
  }
  context.fillStyle = VISUALIZER_PALETTE.bars;
}

function drawMinimal(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  bands: number[] | null,
) {
  const groupCount = 12;
  const values = aggregateBands(bands ?? [], groupCount);
  const gap = 8;
  const barWidth = (width - gap * (groupCount - 1)) / groupCount;
  for (let i = 0; i < groupCount; i += 1) {
    const value = values[i] ?? 0;
    const barHeight = Math.max(2, value * height);
    const x = i * (barWidth + gap);
    roundedRect(
      context,
      x,
      height - barHeight,
      barWidth,
      barHeight,
      Math.min(barWidth / 2, 3),
    );
    context.fill();
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/** A flat baseline, so an unavailable analyser still composes into the layout. */
function flat(width: number): number[] {
  return Array.from({ length: Math.min(48, Math.floor(width / 6)) }, () => 0.03);
}

function scaleValues(values: number[]): number[] {
  return values.map((value) => Math.min(Math.max(value * 1.6, 0), 1));
}
