/**
 * NOIR Music — visualizer presentation and formatting tests.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  aggregateBands,
  nextVisualizerMode,
  scaleBands,
  spectrumColor,
} from '../src/audio/visualizerModel';
import {
  containsArabicScript,
  formatBytes,
  formatDuration,
} from '../src/lib/format';

test('scaleBands clamps to [0,1] and applies sensitivity', () => {
  assert.deepEqual(scaleBands([0.5, 1.5], 1), [0.5, 1]);
  assert.deepEqual(scaleBands([0.4, 0.6], 2), [0.8, 1]);
  assert.deepEqual(scaleBands([0.5], 0.1), [0.25]);
  assert.deepEqual(scaleBands([0.5], 3), [1]);
});

test('aggregateBands groups by max and keeps empty input flat', () => {
  assert.deepEqual(aggregateBands([], 4), [0, 0, 0, 0]);
  assert.deepEqual(aggregateBands([0.1, 0.9, 0.4], 3), [0.1, 0.9, 0.4]);
  assert.deepEqual(aggregateBands([0.1, 0.9, 0.4, 0.2], 2), [0.9, 0.4]);
  assert.deepEqual(aggregateBands([1, 2, 3], 0), []);
});

test('spectrumColor interpolates across the four reserved hues', () => {
  assert.equal(spectrumColor(0, 4), '#E8736A');
  assert.equal(spectrumColor(3, 4), '#E0AC60');
  assert.equal(spectrumColor(0, 1), '#E8736A');
  const seen = new Set([spectrumColor(1, 4), spectrumColor(2, 4)]);
  assert.ok(seen.has('#9882DC'));
  assert.ok(seen.has('#60C7D4'));
});

test('nextVisualizerMode cycles the picker order', () => {
  assert.equal(nextVisualizerMode('bars'), 'wave');
  assert.equal(nextVisualizerMode('minimal'), 'bars');
  assert.equal(nextVisualizerMode('unknown' as never), 'bars');
});

test('formatDuration formats minutes and hours', () => {
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(61), '1:01');
  assert.equal(formatDuration(213), '3:33');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(NaN), '0:00');
});

test('formatBytes scales KB, MB, and GB', () => {
  assert.equal(formatBytes(512), '1 KB');
  assert.equal(formatBytes(12500000), '12 MB');
  assert.equal(formatBytes(100 * 1024 * 1024), '100 MB');
  assert.equal(formatBytes(2.5 * 1024 * 1024 * 1024), '2.5 GB');
  assert.equal(formatBytes(-1), '—');
});

test('containsArabicScript detects Persian and leaves Latin alone', () => {
  assert.equal(containsArabicScript('شب'), true);
  assert.equal(containsArabicScript('Alborz'), false);
  assert.equal(containsArabicScript(''), false);
});
