/**
 * NOIR Music — playback queue, ported from the native app's
 * `NOIRMusic/Domain/Playback/PlaybackQueue.swift`.
 *
 * Everything in this module is pure: functions take a `PlaybackQueueState`
 * and return a new one, so React state updates stay immutable and the whole
 * rule set is unit-testable without a DOM (see tests/queue.test.ts).
 *
 * Ported rules (kept identical to the Swift original):
 *   - `items` is the canonical intended play order, unique by track id;
 *     `items[currentIndex]` is always the current track.
 *   - **Next** advances one entry in the effective order (shuffled or
 *     canonical), skipping unavailable tracks. Repeat-one replays the current
 *     track instead of advancing.
 *   - **End of queue**: repeat-all wraps to the first available entry —
 *     replaying the current track only when no alternative is available;
 *     repeat-off refuses to advance, leaving the current track untouched.
 *   - **Previous** walks backward in the effective order, skipping unavailable
 *     tracks; at the beginning, repeat-all wraps to the last entry. The
 *     "restart the current track after ~3 s of playback" rule lives in the
 *     provider (it depends on elapsed time), not here.
 *   - **Shuffle**: the current track moves to the front of the permutation, so
 *     toggling shuffle never changes what is playing and never replays the
 *     current track; turning it off restores the canonical order.
 *   - **Reconcile** refreshes entries from the library and drops removed
 *     records; only the library flags availability.
 */

import type { ID, RepeatMode, Track } from './models';

/** A permutation of `0..<count`; a broken shuffler falls back to order. */
export interface PlaybackShuffler {
  permutation(count: number): number[];
}

/** Deterministic shuffler for tests (mirrors Swift's injected test shuffler). */
export function makeSeededShuffler(permutation: number[]): PlaybackShuffler {
  return { permutation: () => [...permutation] };
}

/** Random shuffle for production runs (mirrors `SystemPlaybackShuffler`). */
export const systemShuffler: PlaybackShuffler = {
  permutation(count) {
    const order = Array.from({ length: count }, (_, i) => i);
    for (let i = order.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  },
};

export interface PlaybackQueueState {
  /** Canonical intended play order; unique by track id. */
  items: Track[];
  /** Position in `items`; -1 when nothing is loaded. */
  currentIndex: number;
  /** Whether traversal follows `shuffledOrder` instead of the canonical order. */
  isShuffled: boolean;
  /** Permutation of `items` indices with the current track first. */
  shuffledOrder: number[];
  repeatMode: RepeatMode;
}

export function emptyQueue(): PlaybackQueueState {
  return {
    items: [],
    currentIndex: -1,
    isShuffled: false,
    shuffledOrder: [],
    repeatMode: 'off',
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function currentTrack(state: PlaybackQueueState): Track | null {
  const { items, currentIndex } = state;
  if (currentIndex < 0 || currentIndex >= items.length) return null;
  return items[currentIndex];
}

const TRACK_NONE: unique symbol = Symbol('none');
function trackAt(
  state: PlaybackQueueState,
  index: number,
): Track | typeof TRACK_NONE {
  if (index < 0 || index >= state.items.length) return TRACK_NONE;
  return state.items[index];
}

/** Effective traversal order: the permutation when shuffling, else canonical. */
function effectiveIndices(state: PlaybackQueueState): number[] {
  return state.isShuffled
    ? state.shuffledOrder
    : Array.from({ length: state.items.length }, (_, i) => i);
}

/** Position of the current track inside the effective order; -1 when unloaded. */
function currentPosition(state: PlaybackQueueState): number {
  if (state.currentIndex < 0) return -1;
  return effectiveIndices(state).indexOf(state.currentIndex);
}

export function upcomingTracks(state: PlaybackQueueState): Track[] {
  const order = effectiveIndices(state);
  const position = currentPosition(state);
  if (position < 0) return [];
  return order
    .slice(position + 1)
    .map((i) => trackAt(state, i))
    .filter((t): t is Track => t !== TRACK_NONE);
}

export function historyTracks(state: PlaybackQueueState): Track[] {
  const order = effectiveIndices(state);
  const position = currentPosition(state);
  if (position <= 0) return [];
  // Played-in-order: oldest first, mirroring `upcomingTracks`.
  return order
    .slice(0, position)
    .map((i) => trackAt(state, i))
    .filter((t): t is Track => t !== TRACK_NONE);
}

/** Next would do something (advance, wrap, or replay under repeat-one). */
export function canAdvance(state: PlaybackQueueState): boolean {
  if (state.currentIndex < 0) return false;
  if (state.repeatMode === 'one') return true;
  const position = currentPosition(state);
  return nextPlayable(state, position) !== -1;
}

/** Previous would move to another entry. */
export function canRetreat(state: PlaybackQueueState): boolean {
  if (state.currentIndex < 0) return false;
  const position = currentPosition(state);
  return previousPlayable(state, position) !== -1;
}

// ---------------------------------------------------------------------------
// Seeding and modes
// ---------------------------------------------------------------------------

/**
 * Starts a session at `startId`: canonical order comes from `libraryTracks`
 * (deduplicated, unique by id), positioned at the start entry. Playing a track
 * outside the library list becomes a single-entry queue. Shuffle and repeat
 * preferences survive; the shuffle order is rebuilt with the current track
 * first.
 */
export function seedQueue(
  state: PlaybackQueueState,
  libraryTracks: Track[],
  startId: ID,
  shuffler: PlaybackShuffler,
): PlaybackQueueState {
  const seen = new Set<ID>();
  const seeded: Track[] = [];
  for (const track of libraryTracks) {
    if (!seen.has(track.id)) {
      seen.add(track.id);
      seeded.push(track);
    }
  }
  let currentIndex = seeded.findIndex((t) => t.id === startId);
  if (currentIndex < 0) {
    const startTrack = libraryTracks.find((t) => t.id === startId);
    if (startTrack) {
      seeded.unshift(startTrack);
      currentIndex = 0;
    } else {
      // Unknown track id: empty queue rather than a broken session.
      return { ...state, items: [], currentIndex: -1, shuffledOrder: [] };
    }
  }
  const next: PlaybackQueueState = {
    ...state,
    items: seeded,
    currentIndex,
    shuffledOrder: [],
  };
  return next.isShuffled ? setShuffle(next, true, shuffler) : next;
}

export function setShuffle(
  state: PlaybackQueueState,
  enabled: boolean,
  shuffler: PlaybackShuffler,
): PlaybackQueueState {
  if (state.items.length === 0) {
    return { ...state, isShuffled: enabled, shuffledOrder: [] };
  }
  if (!enabled) {
    return { ...state, isShuffled: false, shuffledOrder: [] };
  }

  const raw = shuffler.permutation(state.items.length);
  let order: number[];
  if (
    raw.length === state.items.length &&
    raw.every((i) => i >= 0 && i < state.items.length) &&
    new Set(raw).size === raw.length
  ) {
    order = raw;
  } else {
    // A shuffler that breaks the permutation contract falls back to the
    // canonical order rather than corrupting traversal.
    order = Array.from({ length: state.items.length }, (_, i) => i);
  }
  if (state.currentIndex >= 0) {
    order = order.filter((i) => i !== state.currentIndex);
    order.unshift(state.currentIndex);
  }
  return { ...state, isShuffled: true, shuffledOrder: order };
}

export function setRepeatMode(
  state: PlaybackQueueState,
  mode: RepeatMode,
): PlaybackQueueState {
  return { ...state, repeatMode: mode };
}

export function cycleRepeatMode(state: PlaybackQueueState): {
  state: PlaybackQueueState;
  mode: RepeatMode;
} {
  const next: RepeatMode =
    state.repeatMode === 'off' ? 'all' : state.repeatMode === 'all' ? 'one' : 'off';
  return { state: { ...state, repeatMode: next }, mode: next };
}

/**
 * Jumps to a queue entry (queue sheet) without re-seeding from the library.
 * The traversal order — and therefore the history/upcoming split — is stable:
 * only the current position moves.
 */
export function jumpTo(
  state: PlaybackQueueState,
  trackId: ID,
): PlaybackQueueState {
  const index = state.items.findIndex((t) => t.id === trackId);
  if (index < 0) return state;
  return { ...state, currentIndex: index };
}

// ---------------------------------------------------------------------------
// Advancing
// ---------------------------------------------------------------------------

export interface AdvanceOutcome {
  state: PlaybackQueueState;
  /** Always true when the caller may keep playing; false when it must stop. */
  advanced: boolean;
}

/**
 * Next-button and end-of-track completion share this rule: repeat-one replays
 * the current track (index unchanged); otherwise advance to the next available
 * entry in the effective order, wrapping at the end under repeat-all.
 */
export function advanceNext(state: PlaybackQueueState): AdvanceOutcome {
  if (state.currentIndex < 0) return { state, advanced: false };
  if (state.repeatMode === 'one') return { state, advanced: true };
  const position = currentPosition(state);
  const next = nextPlayable(state, position);
  if (next < 0) return { state, advanced: false };
  return { state: { ...state, currentIndex: next }, advanced: true };
}

/** Step back in the effective order, wrapping at the beginning under all. */
export function advancePrevious(state: PlaybackQueueState): AdvanceOutcome {
  if (state.currentIndex < 0) return { state, advanced: false };
  const position = currentPosition(state);
  const previous = previousPlayable(state, position);
  if (previous < 0) return { state, advanced: false };
  return { state: { ...state, currentIndex: previous }, advanced: true };
}

// ---------------------------------------------------------------------------
// Library consistency
// ---------------------------------------------------------------------------

/**
 * Refreshes entries from a fresh library list (the store stays the authority
 * for availability and metadata), drops records that are gone, keeps the
 * current track's identity when it survives, and preserves the relative
 * shuffle order of the survivors. When the current track was removed,
 * `currentIndex` becomes -1 and the caller decides what to do.
 */
export function reconcileQueue(
  state: PlaybackQueueState,
  libraryTracks: Track[],
): PlaybackQueueState {
  const byId = new Map<ID, Track>();
  for (const track of libraryTracks) byId.set(track.id, track);

  const oldItems = state.items;
  const currentId = currentTrack(state)?.id;
  const oldOrder = state.shuffledOrder;

  const items = oldItems.filter((t) => byId.has(t.id));

  // Map surviving old positions to their new indices.
  const oldToNew = new Map<number, number>();
  for (let oldIndex = 0; oldIndex < oldItems.length; oldIndex += 1) {
    if (byId.has(oldItems[oldIndex].id)) {
      oldToNew.set(oldIndex, oldToNew.size);
    }
  }
  const currentIndex = currentId
    ? items.findIndex((t) => t.id === currentId)
    : -1;

  let shuffledOrder = state.shuffledOrder;
  if (state.isShuffled) {
    let order = oldOrder
      .map((i) => oldToNew.get(i))
      .filter((i): i is number => typeof i === 'number');
    if (currentIndex >= 0) {
      order = order.filter((i) => i !== currentIndex);
      order.unshift(currentIndex);
    }
    shuffledOrder = order;
  }

  return { ...state, items, currentIndex, shuffledOrder };
}

// ---------------------------------------------------------------------------
// Private: playable-index search with repeat rules
// ---------------------------------------------------------------------------

/**
 * Index in `items` of the next playable entry. Equal to the current index when
 * the current track replays (repeat-all with no other available entry); -1
 * when advancing is impossible.
 */
function nextPlayable(state: PlaybackQueueState, position: number): number {
  const order = effectiveIndices(state);
  const after = order.slice(position + 1);
  for (const index of after) {
    const track = trackAt(state, index);
    if (track !== TRACK_NONE && track.isAvailable) return index;
  }
  if (state.repeatMode === 'all') {
    const current = order[position];
    for (const index of order) {
      if (index === current) continue;
      const track = trackAt(state, index);
      if (track !== TRACK_NONE && track.isAvailable) return index;
    }
    const currentTrackEntry = trackAt(state, current);
    if (currentTrackEntry !== TRACK_NONE && currentTrackEntry.isAvailable) {
      return current;
    }
  }
  return -1;
}

/** Index in `items` of the previous playable entry, wrapping under repeat-all. */
function previousPlayable(state: PlaybackQueueState, position: number): number {
  const order = effectiveIndices(state);
  for (let index = position - 1; index >= 0; index -= 1) {
    const track = trackAt(state, order[index]);
    if (track !== TRACK_NONE && track.isAvailable) return order[index];
  }
  if (state.repeatMode === 'all') {
    const current = order[position];
    for (let index = order.length - 1; index >= 0; index -= 1) {
      if (order[index] === current) continue;
      const track = trackAt(state, order[index]);
      if (track !== TRACK_NONE && track.isAvailable) return order[index];
    }
    const currentTrackEntry = trackAt(state, current);
    if (currentTrackEntry !== TRACK_NONE && currentTrackEntry.isAvailable) {
      return current;
    }
  }
  return -1;
}
