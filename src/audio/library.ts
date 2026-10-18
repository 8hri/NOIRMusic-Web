/**
 * NOIR Music — library persistence and import pipeline.
 *
 * The web counterpart of the native app's `ImportService` + SwiftData layer,
 * reshaped for the browser:
 *
 *   - Audio content lives in **IndexedDB as Blobs** (`noir-music` database,
 *     `audio` and `artwork` object stores, keyed by track id). Blobs survive
 *     reloads and app restarts; the service worker precache never touches
 *     them, so an install stays small and the library is never uploaded
 *     anywhere.
 *   - Metadata (tracks, playlists, preferences) lives in LocalStorage through
 *     a guarded read/write helper: one key, one typed blob, validated on
 *     load, safe on corrupted storage.
 *   - Duplicate detection uses a **SHA-256 content hash** via `SubtleCrypto`
 *     — exactly like the native `contentHash`, and filenames alone are never
 *     identity.
 *   - Tags (title/artist/album) and cover art are read from the file itself
 *     by `metadata.ts`; whatever cannot be parsed falls back to the filename.
 *
 * Everything that touches the DOM or IndexedDB is clearly split from the pure
 * validation/normalization helpers below it, so the rule set is unit-testable
 * in Node without a browser (tests/library.test.ts).
 */

import type {
  ID,
  ImportResult,
  MusicPreferences,
  Playlist,
  RepeatMode,
  Track,
} from './models';
import {
  defaultMusicPreferences,
  emptyImportResult,
  VISUALIZER_MODE_ORDER,
} from './models';
import { parseTrackMetadata } from './metadata';
import {
  storageRead,
  storageRemove,
  storageWrite,
} from '@/lib/storage';

const META_KEY = 'noirmusic.meta.v1';
const DB_NAME = 'noir-music';
const DB_VERSION = 1;
const STORE_AUDIO = 'audio';
const STORE_ARTWORK = 'artwork';

export interface MusicMeta {
  schemaVersion: number;
  tracks: Track[];
  playlists: Playlist[];
  prefs: MusicPreferences;
}

const CURRENT_SCHEMA_VERSION = 1;

export function defaultMusicMeta(): MusicMeta {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tracks: [],
    playlists: [],
    prefs: defaultMusicPreferences(),
  };
}

// ---------------------------------------------------------------------------
// Metadata: load / save / validate (LocalStorage, guarded)
// ---------------------------------------------------------------------------

/**
 * Validates a loaded metadata blob before trusting it. Anything unexpected
 * falls back to a safe empty state; we never invent records the user did not
 * create.
 */
export function normalizeMusicMeta(raw: unknown): MusicMeta {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return defaultMusicMeta();
  }
  const root = raw as Record<string, unknown>;

  const tracks = Array.isArray(root.tracks) ? root.tracks : [];
  const validatedTracks: Track[] = [];
  const seenIds = new Set<ID>();
  for (const item of tracks) {
    const track = normalizeTrack(item);
    if (track && !seenIds.has(track.id)) {
      seenIds.add(track.id);
      validatedTracks.push(track);
    }
  }

  const playlists = Array.isArray(root.playlists) ? root.playlists : [];
  const validatedPlaylists: Playlist[] = [];
  const seenPlaylistIds = new Set<ID>();
  const knownTrackIds = new Set<ID>(validatedTracks.map((track) => track.id));
  for (const item of playlists) {
    const playlist = normalizePlaylist(item, knownTrackIds);
    if (playlist && !seenPlaylistIds.has(playlist.id)) {
      seenPlaylistIds.add(playlist.id);
      validatedPlaylists.push(playlist);
    }
  }

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    tracks: validatedTracks,
    playlists: validatedPlaylists,
    prefs: normalizePrefs(root.prefs),
  };
}

function normalizeTrack(raw: unknown): Track | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.title !== 'string' || !t.title.trim()) return null;
  if (typeof t.fileName !== 'string' || !t.fileName) return null;
  return {
    id: t.id,
    title: t.title,
    artistName: typeof t.artistName === 'string' ? t.artistName : undefined,
    albumTitle: typeof t.albumTitle === 'string' ? t.albumTitle : undefined,
    fileName: t.fileName,
    duration: typeof t.duration === 'number' && t.duration >= 0 ? t.duration : 0,
    fileSize: typeof t.fileSize === 'number' && t.fileSize >= -1 ? t.fileSize : -1,
    sourceFormat:
      typeof t.sourceFormat === 'string' && /^\w{1,8}$/.test(t.sourceFormat)
        ? t.sourceFormat
        : t.fileName.split('.').pop()?.toLowerCase() ?? '',
    contentHash:
      typeof t.contentHash === 'string' && /^[0-9a-f]{8,128}$/i.test(t.contentHash)
        ? t.contentHash.toLowerCase()
        : '',
    dateAdded:
      typeof t.dateAdded === 'string' && !Number.isNaN(new Date(t.dateAdded).getTime())
        ? t.dateAdded
        : new Date().toISOString(),
    isAvailable: t.isAvailable !== false,
    isFavorite: t.isFavorite === true,
    hasArtwork: t.hasArtwork === true,
  };
}

function normalizePlaylist(
  raw: unknown,
  knownTrackIds: ReadonlySet<ID>,
): Playlist | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.id !== 'string' || !p.id) return null;
  if (typeof p.title !== 'string' || !p.title.trim()) return null;
  const ids = Array.isArray(p.trackIds) ? p.trackIds : [];
  const trackIds: ID[] = [];
  const seen = new Set<ID>();
  for (const item of ids) {
    // Drop dangling ids: a playlist only references tracks that still exist.
    if (typeof item === 'string' && item && !seen.has(item) && knownTrackIds.has(item)) {
      seen.add(item);
      trackIds.push(item);
    }
  }
  return {
    id: p.id,
    title: p.title,
    trackIds,
    createdAt:
      typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
    updatedAt:
      typeof p.updatedAt === 'string' ? p.updatedAt : new Date().toISOString(),
  };
}

function normalizePrefs(raw: unknown): MusicPreferences {
  const prefs = defaultMusicPreferences();
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return prefs;
  const p = raw as Record<string, unknown>;
  if (p.appearance === 'light' || p.appearance === 'dark') {
    prefs.appearance = p.appearance;
  }
  if (VISUALIZER_MODE_ORDER.includes(p.visualizerMode as never)) {
    prefs.visualizerMode = p.visualizerMode as MusicPreferences['visualizerMode'];
  }
  if (
    typeof p.visualizerSensitivity === 'number' &&
    Number.isFinite(p.visualizerSensitivity) &&
    p.visualizerSensitivity >= 0.5 &&
    p.visualizerSensitivity <= 2
  ) {
    prefs.visualizerSensitivity = p.visualizerSensitivity;
  }
  if (typeof p.reduceVisualizerMotion === 'boolean') {
    prefs.reduceVisualizerMotion = p.reduceVisualizerMotion;
  }
  return prefs;
}

export function loadMusicMeta(): MusicMeta {
  const raw = storageRead(META_KEY);
  if (raw === null) return defaultMusicMeta();
  try {
    return normalizeMusicMeta(JSON.parse(raw));
  } catch {
    // Corrupt JSON: reset to a safe empty state rather than crash.
    return defaultMusicMeta();
  }
}

export function saveMusicMeta(meta: MusicMeta): boolean {
  return storageWrite(META_KEY, JSON.stringify(meta));
}

// ---------------------------------------------------------------------------
// Blob storage: IndexedDB (audio + artwork)
// ---------------------------------------------------------------------------

/** Browser-only by design; Node tests never touch this path. */
function openMusicDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this environment.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open the music database.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_AUDIO)) {
        db.createObjectStore(STORE_AUDIO, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ARTWORK)) {
        db.createObjectStore(STORE_ARTWORK, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

interface AudioRecord {
  id: ID;
  blob: Blob;
}

function blobTransaction(
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => void,
): Promise<void> {
  return openMusicDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const txn = db.transaction(store, mode);
        txn.oncomplete = () => resolve();
        txn.onerror = () => reject(txn.error ?? new Error('IndexedDB failure.'));
        run(txn.objectStore(store));
        db.close();
      }),
  );
}

export async function putAudioBlob(id: ID, blob: Blob): Promise<void> {
  await blobTransaction(STORE_AUDIO, 'readwrite', (store) => {
    store.put({ id, blob } satisfies AudioRecord);
  });
}

export async function getAudioBlob(id: ID): Promise<Blob | undefined> {
  const db = await openMusicDb();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const txn = db.transaction(STORE_AUDIO, 'readonly');
    const request = txn.objectStore(STORE_AUDIO).get(id);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to read audio.'));
    request.onsuccess = () => {
      const record = request.result as AudioRecord | undefined;
      resolve(record?.blob);
    };
    db.close();
  });
}

export async function deleteAudioBlob(id: ID): Promise<void> {
  await blobTransaction(STORE_AUDIO, 'readwrite', (store) => {
    store.delete(id);
  });
}

export async function putArtwork(id: ID, blob: Blob): Promise<void> {
  await blobTransaction(STORE_ARTWORK, 'readwrite', (store) => {
    store.put({ id, blob } satisfies AudioRecord);
  });
}

export async function getArtwork(id: ID): Promise<Blob | undefined> {
  const db = await openMusicDb();
  return new Promise<Blob | undefined>((resolve, reject) => {
    const txn = db.transaction(STORE_ARTWORK, 'readonly');
    const request = txn.objectStore(STORE_ARTWORK).get(id);
    request.onerror = () =>
      reject(request.error ?? new Error('Failed to read artwork.'));
    request.onsuccess = () => {
      const record = request.result as AudioRecord | undefined;
      resolve(record?.blob);
    };
    db.close();
  });
}

export async function deleteArtwork(id: ID): Promise<void> {
  await blobTransaction(STORE_ARTWORK, 'readwrite', (store) => {
    store.delete(id);
  });
}

// ---------------------------------------------------------------------------
// Import pipeline
// ---------------------------------------------------------------------------

/**
 * Containers Safari/iOS can actually decode. OGG/Opus are excluded on purpose:
 * Safari lacks native decoders, and importing a file that can never play is
 * worse than refusing it up front with an honest reason.
 */
export const IMPORTABLE_EXTENSIONS: ReadonlySet<string> = new Set([
  'mp3',
  'm4a',
  'aac',
  'wav',
  'aif',
  'aiff',
  'flac',
]);

export function classifyFile(fileName: string): {
  extension: string;
  importable: boolean;
} {
  const extension = fileName.split('.').pop()?.toLowerCase().trim() ?? '';
  return {
    extension,
    importable: IMPORTABLE_EXTENSIONS.has(extension),
  };
}

/**
 * SHA-256 hex digest of file content, using `SubtleCrypto` (available on iOS
 * Safari). Falls back to an empty string only when the API is missing — the
 * caller then keeps uniqueness through id + filename and duplicates simply
 * become possible again, never silent corruption.
 */
export async function contentHashOfFile(file: File): Promise<string> {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return '';
  }
}

/**
 * Reads a file's duration with a temporary audio element, without decoding the
 * whole stream. Resolves to 0 on any failure or timeout — the track can still
 * be played and scrubbed live.
 */
export function probeFileDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof Audio === 'undefined') {
      resolve(0);
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const cleanup = (value: number) => {
      URL.revokeObjectURL(url);
      audio.removeEventListener('loadedmetadata', onMeta);
      audio.removeEventListener('error', onError);
      resolve(value);
    };
    const onMeta = () => {
      const duration = audio.duration;
      cleanup(Number.isFinite(duration) && duration > 0 ? duration : 0);
    };
    const onError = () => cleanup(0);
    audio.addEventListener('loadedmetadata', onMeta);
    audio.addEventListener('error', onError);
    audio.preload = 'metadata';
    audio.src = url;
    // Metadata can hang on malformed containers; don't block import forever.
    window.setTimeout(() => cleanup(0), 4000);
  });
}

/**
 * Import a batch of user-selected files.
 *
 * Each file is: classified (extension gate) → hashed (duplicate identity) →
 * tag-parsed (title/artist/album/artwork from the container) → duration-probed
 * → stored as a Blob in IndexedDB → recorded in metadata. The batch result
 * mirrors the native app's `ImportResult` so the UI can report imported /
 * duplicate / unsupported / failed counts honestly.
 */
export async function importFilesIntoLibrary(
  files: ReadonlyArray<File>,
  meta: MusicMeta,
): Promise<{ meta: MusicMeta; result: ImportResult }> {
  const nextMeta: MusicMeta = {
    ...meta,
    tracks: [...meta.tracks],
    playlists: [...meta.playlists],
  };
  const result: ImportResult = emptyImportResult();

  for (const file of files) {
    const { extension, importable } = classifyFile(file.name);
    if (!importable) {
      result.unsupported.push(file.name);
      continue;
    }

    let hash = '';
    try {
      hash = await contentHashOfFile(file);
    } catch {
      result.failed.push(file.name);
      continue;
    }
    if (hash && nextMeta.tracks.some((track) => track.contentHash === hash)) {
      result.duplicates.push(file.name);
      continue;
    }

    try {
      // Best-effort embedded tags; failure only means the filename is used.
      let tags: Awaited<ReturnType<typeof parseTrackMetadata>> = null;
      try {
        tags = await parseTrackMetadata(file);
      } catch {
        tags = null;
      }

      const duration = await probeFileDuration(file);
      const id = makeTrackId();
      const track: Track = {
        id,
        title: tags?.title ?? titleFromFileName(file.name),
        artistName: tags?.artist,
        albumTitle: tags?.album,
        fileName: file.name,
        duration,
        fileSize: file.size,
        sourceFormat: extension,
        contentHash: hash,
        dateAdded: new Date().toISOString(),
        isAvailable: true,
        isFavorite: false,
        hasArtwork: false,
      };
      await putAudioBlob(id, file);
      if (tags?.artwork) {
        try {
          await putArtwork(id, tags.artwork);
          track.hasArtwork = true;
        } catch {
          // Artwork is decoration; a failed store does not fail the import.
        }
      }
      nextMeta.tracks = [track, ...nextMeta.tracks];
      result.imported += 1;
    } catch {
      result.failed.push(file.name);
    }
  }

  return { meta: nextMeta, result: result };
}

/** "Song 2.mp3" → "Song 2" — the native spike's filename fallback. */
export function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return withoutExtension.trim() || fileName;
}

let idCounter = 0;

export function makeTrackId(): ID {
  idCounter += 1;
  return `m_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Library / playlist operations (pure: return new metadata objects)
// ---------------------------------------------------------------------------

/** Remove a track: delete its blob and artwork, and detach it from playlists. */
export async function removeTrackFromLibrary(
  meta: MusicMeta,
  trackId: ID,
): Promise<MusicMeta> {
  await deleteAudioBlob(trackId).catch(() => {
    // The record is being dropped regardless; a failed blob delete is not fatal.
  });
  await deleteArtwork(trackId).catch(() => {
    // Same for artwork.
  });
  return {
    ...meta,
    tracks: meta.tracks.filter((track) => track.id !== trackId),
    playlists: meta.playlists.map((playlist) =>
      playlist.trackIds.includes(trackId)
        ? {
            ...playlist,
            trackIds: playlist.trackIds.filter((id) => id !== trackId),
            updatedAt: new Date().toISOString(),
          }
        : playlist,
    ),
  };
}

export function toggleTrackFavorite(
  meta: MusicMeta,
  trackId: ID,
): MusicMeta {
  return {
    ...meta,
    tracks: meta.tracks.map((track) =>
      track.id === trackId
        ? { ...track, isFavorite: !track.isFavorite }
        : track,
    ),
  };
}

export function makePlaylistId(): ID {
  idCounter += 1;
  return `pl_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function createPlaylist(
  meta: MusicMeta,
  title: string,
  trackIds: ID[] = [],
): { meta: MusicMeta; playlist: Playlist | null } {
  const trimmed = title.trim();
  if (!trimmed) return { meta, playlist: null };
  const playlist: Playlist = {
    id: makePlaylistId(),
    title: trimmed,
    trackIds: [...new Set(trackIds)],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    meta: { ...meta, playlists: [...meta.playlists, playlist] },
    playlist,
  };
}

export function renamePlaylist(
  meta: MusicMeta,
  playlistId: ID,
  title: string,
): MusicMeta {
  const trimmed = title.trim();
  if (!trimmed) return meta;
  return {
    ...meta,
    playlists: meta.playlists.map((playlist) =>
      playlist.id === playlistId
        ? { ...playlist, title: trimmed, updatedAt: new Date().toISOString() }
        : playlist,
    ),
  };
}

export function deletePlaylist(meta: MusicMeta, playlistId: ID): MusicMeta {
  return {
    ...meta,
    playlists: meta.playlists.filter(
      (playlist) => playlist.id !== playlistId,
    ),
  };
}

/** Add tracks to a playlist, unique by id, preserving given order. */
export function addTracksToPlaylist(
  meta: MusicMeta,
  playlistId: ID,
  trackIds: ID[],
): MusicMeta {
  return {
    ...meta,
    playlists: meta.playlists.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const merged = [...playlist.trackIds];
      for (const id of trackIds) {
        if (!merged.includes(id)) merged.push(id);
      }
      return {
        ...playlist,
        trackIds: merged,
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}

export function removeTrackFromPlaylist(
  meta: MusicMeta,
  playlistId: ID,
  trackId: ID,
): MusicMeta {
  return {
    ...meta,
    playlists: meta.playlists.map((playlist) =>
      playlist.id === playlistId
        ? {
            ...playlist,
            trackIds: playlist.trackIds.filter((id) => id !== trackId),
            updatedAt: new Date().toISOString(),
          }
        : playlist,
    ),
  };
}

/** Total bytes of the stored blobs, as best metadata knows. */
export function musicStorageBytes(meta: MusicMeta): number {
  return meta.tracks.reduce((sum, track) => sum + Math.max(0, track.fileSize), 0);
}

/** Wipe every music artifact: all blobs, artwork, metadata, and the queue. */
export function clearAllMusicData(): void {
  storageRemove(META_KEY);
  storageRemove(QUEUE_KEY);
  void clearBlobStores();
}

async function clearBlobStores(): Promise<void> {
  try {
    const db = await openMusicDb();
    await new Promise<void>((resolve) => {
      const txn = db.transaction([STORE_AUDIO, STORE_ARTWORK], 'readwrite');
      txn.oncomplete = () => resolve();
      txn.onerror = () => resolve();
      txn.objectStore(STORE_AUDIO).clear();
      txn.objectStore(STORE_ARTWORK).clear();
      db.close();
    });
  } catch {
    // Already-reset metadata is the source of truth; blob cleanup is best effort.
  }
}

// ---------------------------------------------------------------------------
// Queue snapshot (kept here next to the meta helpers it ships with)
// ---------------------------------------------------------------------------

export const QUEUE_KEY = 'noirmusic.queue.v1';

export interface QueueSnapshot {
  /** Track ids in canonical seeded order. */
  itemIds: ID[];
  currentIndex: number;
  isShuffled: boolean;
  repeatMode: RepeatMode;
  /** Paused playback position in seconds (restored on next launch). */
  positionSeconds: number;
}

export function saveQueueSnapshot(snapshot: QueueSnapshot): boolean {
  return storageWrite(QUEUE_KEY, JSON.stringify(snapshot));
}

export function loadQueueSnapshot(): QueueSnapshot | null {
  const raw = storageRead(QUEUE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<QueueSnapshot>;
    if (
      !Array.isArray(parsed.itemIds) ||
      typeof parsed.currentIndex !== 'number' ||
      parsed.currentIndex >= parsed.itemIds.length
    ) {
      return null;
    }
    return {
      itemIds: parsed.itemIds.filter((id) => typeof id === 'string'),
      currentIndex: parsed.currentIndex,
      isShuffled: parsed.isShuffled === true,
      repeatMode:
        parsed.repeatMode === 'all' || parsed.repeatMode === 'one'
          ? parsed.repeatMode
          : 'off',
      positionSeconds:
        typeof parsed.positionSeconds === 'number' &&
        Number.isFinite(parsed.positionSeconds)
          ? Math.max(0, parsed.positionSeconds)
          : 0,
    };
  } catch {
    return null;
  }
}
