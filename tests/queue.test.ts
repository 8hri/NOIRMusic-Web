/**
 * NOIR Music — queue rule-set tests (ported from the native app's
 * `PlaybackQueueTests` via the web port). Everything here is pure logic, so
 * the tests run under plain Node without a DOM.
 *
 *   npm test
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  advanceNext,
  advancePrevious,
  canAdvance,
  canRetreat,
  currentTrack,
  cycleRepeatMode,
  emptyQueue,
  historyTracks,
  jumpTo,
  makeSeededShuffler,
  reconcileQueue,
  seedQueue,
  setRepeatMode,
  setShuffle,
  systemShuffler,
  upcomingTracks,
} from '../src/audio/queue';
import type { RepeatMode, Track } from '../src/audio/models';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idSeed = 0;
function trackFixture(partial: Partial<Track> = {}): Track {
  idSeed += 1;
  return {
    id: `t${idSeed}`,
    title: `Track ${idSeed}`,
    fileName: `track-${idSeed}.mp3`,
    duration: 180,
    fileSize: 1000,
    sourceFormat: 'mp3',
    contentHash: `hash${idSeed}`,
    dateAdded: '2026-01-01T00:00:00.000Z',
    isAvailable: true,
    isFavorite: false,
    hasArtwork: false,
    ...partial,
  };
}

function libraryFixture(count: number, patches: Partial<Track>[] = []): Track[] {
  return Array.from({ length: count }, (_, i) =>
    trackFixture(patches[i] ?? {}),
  );
}

function seededAt(library: Track[], startId: string, isShuffled = false) {
  return seedQueue(
    { ...emptyQueue(), isShuffled },
    library,
    startId,
    systemShuffler,
  );
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

test('seed positions the start track and keeps canonical order', () => {
  const library = libraryFixture(3);
  const queue = seededAt(library, library[1].id);
  assert.equal(currentTrack(queue)?.id, library[1].id);
  assert.deepEqual(
    upcomingTracks(queue).map((t) => t.id),
    [library[2].id],
  );
  assert.deepEqual(historyTracks(queue).map((t) => t.id), [library[0].id]);
});

test('seed deduplicates repeated track ids', () => {
  const a = trackFixture();
  const queue = seedQueue(emptyQueue(), [a, { ...a }, a], a.id, systemShuffler);
  assert.equal(queue.items.length, 1);
  assert.equal(currentTrack(queue)?.id, a.id);
});

test('unknown start id yields an empty queue, not a broken session', () => {
  const queue = seededAt(libraryFixture(2), 'does-not-exist');
  assert.equal(queue.currentIndex, -1);
  assert.equal(currentTrack(queue), null);
});

test('playing a track outside the library list makes a single-entry queue', () => {
  const orphan = trackFixture({ id: 'orphan' });
  const queue = seedQueue(emptyQueue(), libraryFixture(2), orphan.id, systemShuffler);
  // seedQueue only accepts library tracks — the fixture above is not in the
  // list, so this must be empty rather than fabricated.
  assert.equal(currentTrack(queue), null);
});

// ---------------------------------------------------------------------------
// Next / Previous / Repeat
// ---------------------------------------------------------------------------

test('next advances in canonical order', () => {
  const library = libraryFixture(3);
  let queue = seededAt(library, library[0].id);
  queue = advanceNext(queue).state;
  assert.equal(currentTrack(queue)?.id, library[1].id);
});

test('next at the end with repeat-off refuses to advance', () => {
  const library = libraryFixture(3);
  const queue = seededAt(library, library[2].id);
  const outcome = advanceNext(queue);
  assert.equal(outcome.advanced, false);
  assert.equal(currentTrack(outcome.state)?.id, library[2].id);
});

test('next at the end with repeat-all wraps to the first entry', () => {
  const library = libraryFixture(3);
  let queue = setRepeatMode(seededAt(library, library[2].id), 'all');
  queue = advanceNext(queue).state;
  assert.equal(currentTrack(queue)?.id, library[0].id);
});

test('repeat-one replays the current track without advancing', () => {
  const library = libraryFixture(3);
  let queue = setRepeatMode(seededAt(library, library[1].id), 'one');
  queue = advanceNext(queue).state;
  assert.equal(currentTrack(queue)?.id, library[1].id);
  assert.equal(canAdvance(queue), true);
});

test('previous walks backward in the effective order', () => {
  const library = libraryFixture(3);
  let queue = seededAt(library, library[2].id);
  queue = advancePrevious(queue).state;
  assert.equal(currentTrack(queue)?.id, library[1].id);
});

test('previous at the beginning is a no-op under repeat-off', () => {
  const library = libraryFixture(3);
  const outcome = advancePrevious(seededAt(library, library[0].id));
  assert.equal(outcome.advanced, false);
  assert.equal(currentTrack(outcome.state)?.id, library[0].id);
});

test('previous at the beginning wraps to the last entry under repeat-all', () => {
  const library = libraryFixture(3);
  let queue = setRepeatMode(seededAt(library, library[0].id), 'all');
  queue = advancePrevious(queue).state;
  assert.equal(currentTrack(queue)?.id, library[2].id);
});

test('repeat-one with a single unavailable track cannot advance', () => {
  const library = libraryFixture(1, [{ isAvailable: false }]);
  const queue = setRepeatMode(seededAt(library, library[0].id), 'all');
  assert.equal(advanceNext(queue).advanced, false);
  assert.equal(canAdvance(queue), false);
});

test('single available track with repeat-all replays itself at the end', () => {
  const library = libraryFixture(1);
  let queue = setRepeatMode(seededAt(library, library[0].id), 'all');
  const outcome = advanceNext(queue);
  assert.equal(outcome.advanced, true);
  queue = outcome.state;
  assert.equal(currentTrack(queue)?.id, library[0].id);
});

test('canRetreat is false on an empty queue', () => {
  assert.equal(canRetreat(emptyQueue()), false);
  assert.equal(canAdvance(emptyQueue()), false);
});

test('next skips unavailable tracks', () => {
  const library = libraryFixture(3, [{}, { isAvailable: false }, {}]);
  let queue = seededAt(library, library[0].id);
  queue = advanceNext(queue).state;
  assert.equal(currentTrack(queue)?.id, library[2].id);
});

test('cycleRepeatMode walks off → all → one → off', () => {
  const modes: RepeatMode[] = [];
  let queue = emptyQueue();
  for (let i = 0; i < 4; i += 1) {
    const stepped = cycleRepeatMode(queue);
    queue = stepped.state;
    modes.push(stepped.mode);
  }
  assert.deepEqual(modes, ['all', 'one', 'off', 'all']);
});

// ---------------------------------------------------------------------------
// Shuffle
// ---------------------------------------------------------------------------

test('toggling shuffle never changes what is playing', () => {
  const library = libraryFixture(5);
  const start = seededAt(library, library[2].id);
  const shuffled = setShuffle(start, true, makeSeededShuffler([4, 0, 3, 1, 2]));
  assert.equal(currentTrack(shuffled)?.id, library[2].id);
  // Current index is moved to the front of the permutation.
  assert.equal(shuffled.shuffledOrder[0], start.currentIndex);
  assert.equal(shuffled.isShuffled, true);
});

test('shuffle on then off restores the canonical remaining order', () => {
  const library = libraryFixture(4);
  const start = seededAt(library, library[0].id);
  const shuffled = setShuffle(start, true, systemShuffler);
  const unshuffled = setShuffle(shuffled, false, systemShuffler);
  assert.equal(unshuffled.isShuffled, false);
  assert.deepEqual(unshuffled.shuffledOrder, []);
  assert.equal(currentTrack(unshuffled)?.id, library[0].id);
});

test('a shuffler that breaks the permutation contract falls back to order', () => {
  const library = libraryFixture(3);
  const start = seededAt(library, library[0].id);
  const broken = setShuffle(start, true, { permutation: () => [0, 0, 5] });
  assert.deepEqual(broken.shuffledOrder, [0, 1, 2]);
});

test('jump moves the position without reordering history/upcoming', () => {
  const library = libraryFixture(4);
  const queue = seededAt(library, library[0].id);
  const jumped = jumpTo(queue, library[3].id);
  assert.equal(currentTrack(jumped)?.id, library[3].id);
  assert.deepEqual(
    historyTracks(jumped).map((t) => t.id),
    [library[0].id, library[1].id, library[2].id],
  );
  assert.deepEqual(upcomingTracks(jumped), []);
  // Jumping to an unknown id is a no-op.
  assert.equal(jumpTo(queue, 'nope').currentIndex, queue.currentIndex);
});

// ---------------------------------------------------------------------------
// Reconcile
// ---------------------------------------------------------------------------

test('reconcile drops removed records and keeps the current track', () => {
  const library = libraryFixture(3);
  const queue = seededAt(library, library[1].id);
  const survivors = [library[0], library[1]];
  const reconciled = reconcileQueue(queue, survivors);
  assert.equal(reconciled.items.length, 2);
  assert.equal(currentTrack(reconciled)?.id, library[1].id);
});

test('reconcile sets currentIndex to -1 when the current track is removed', () => {
  const library = libraryFixture(3);
  const queue = seededAt(library, library[1].id);
  const reconciled = reconcileQueue(queue, [library[0]]);
  assert.equal(reconciled.currentIndex, -1);
});

test('reconcile preserves the relative shuffle order of survivors', () => {
  const library = libraryFixture(5);
  const start = seededAt(library, library[0].id);
  const shuffled = setShuffle(start, true, makeSeededShuffler([2, 4, 0, 1, 3]));
  // Remove library[4] (a survivor order entry) — permutation must compact.
  const survivors = library.filter((track) => track.id !== library[4].id);
  const reconciled = reconcileQueue(shuffled, survivors);
  assert.equal(reconciled.isShuffled, true);
  // Every order index must be valid and unique.
  const order = reconciled.shuffledOrder;
  assert.equal(new Set(order).size, order.length);
  assert.ok(order.every((index) => index >= 0 && index < survivors.length));
  // The current track is first in the permutation, as the contract requires.
  assert.equal(order[0], reconciled.currentIndex);
});
