/**
 * NOIR Music — library/metadata validation tests (pure helpers only; nothing
 * here touches IndexedDB or the DOM).
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  classifyFile,
  defaultMusicMeta,
  loadQueueSnapshot,
  normalizeMusicMeta,
  saveQueueSnapshot,
  titleFromFileName,
} from '../src/audio/library';

test('classifyFile gates containers Safari cannot decode', () => {
  assert.equal(classifyFile('song.mp3').importable, true);
  assert.equal(classifyFile('SONG.M4A').importable, true);
  assert.equal(classifyFile('podcast.wav').importable, true);
  assert.equal(classifyFile('tune.ogg').importable, false);
  assert.equal(classifyFile('tune.opus').importable, false);
  assert.equal(classifyFile('notes').importable, false);
});

test('titleFromFileName strips the extension', () => {
  assert.equal(titleFromFileName('Song 2.mp3'), 'Song 2');
  assert.equal(titleFromFileName('no-extension'), 'no-extension');
  assert.equal(titleFromFileName('  spaced .flac'), 'spaced');
});

test('normalizeMusicMeta rejects corrupt input and dedupes ids', () => {
  assert.deepEqual(normalizeMusicMeta(null), defaultMusicMeta());
  assert.deepEqual(normalizeMusicMeta('garbage'), defaultMusicMeta());

  const valid = {
    id: 't1',
    title: 'Song',
    fileName: 'song.mp3',
    duration: 180,
    fileSize: 1000,
    sourceFormat: 'mp3',
    contentHash: 'deadbeef',
    dateAdded: '2026-01-01T00:00:00.000Z',
    isAvailable: true,
    isFavorite: false,
    hasArtwork: false,
  };
  const parsed = normalizeMusicMeta({
    tracks: [
      valid,
      { ...valid }, // duplicate id — dropped
      { id: 'bad', title: '', fileName: 'x.mp3' }, // no title — dropped
    ],
    playlists: [
      {
        id: 'pl1',
        title: 'Mix',
        trackIds: [valid.id, valid.id, 'stray'],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    prefs: { appearance: 'dark', visualizerMode: 'wave', visualizerSensitivity: 1.5 },
  });
  assert.equal(parsed.tracks.length, 1);
  assert.equal(parsed.tracks[0].id, valid.id);
  assert.deepEqual(parsed.playlists[0].trackIds, [valid.id]);
  assert.equal(parsed.prefs.appearance, 'dark');
  assert.equal(parsed.prefs.visualizerMode, 'wave');

  const outOfRange = normalizeMusicMeta({
    prefs: { visualizerSensitivity: 10, appearance: 'weird' },
  });
  assert.equal(outOfRange.prefs.visualizerSensitivity, 1);
  assert.equal(outOfRange.prefs.appearance, 'system');
});

test('queue snapshot round-trips and rejects malformed payloads', () => {
  assert.equal(loadQueueSnapshot(), null);
  saveQueueSnapshot({
    itemIds: ['a', 'b'],
    currentIndex: 1,
    isShuffled: true,
    repeatMode: 'all',
    positionSeconds: 12.5,
  });
  const back = loadQueueSnapshot();
  assert.equal(back?.currentIndex, 1);
  assert.equal(back?.positionSeconds, 12.5);
  assert.equal(back?.repeatMode, 'all');
  assert.equal(back?.isShuffled, true);
  saveQueueSnapshot({
    itemIds: ['a'],
    currentIndex: 5,
    isShuffled: false,
    repeatMode: 'off',
    positionSeconds: 0,
  });
  assert.equal(loadQueueSnapshot(), null);
});
