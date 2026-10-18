/**
 * NOIR Music — domain models for the web player.
 *
 * Ported from NOIRMusic (native Swift) `Track.swift` / `Playlist.swift`, minus
 * the fields that only make sense for a file-system app (`relativeFilePath`)
 * and plus the ones the web pipeline needs (`contentHash` stays — it drives
 * duplicate detection exactly as in the native import service).
 */

export type ID = string;

/** Mirrors PlaybackQueue.swift's `RepeatMode` (off → all → one). */
export type RepeatMode = 'off' | 'all' | 'one';

/**
 * One track in the library.
 *
 * `id` is stable across imports, restarts, and queue entries (native: UUID;
 * web: a generated `m_<base36>_<random>` string).
 * `duration` is seconds; 0 when metadata could not be read.
 * `fileSize` is the byte size of the stored blob; -1 when unknown.
 * `contentHash` is a SHA-256 hex digest — filenames alone are never identity.
 */
export interface Track {
  id: ID;
  title: string;
  artistName?: string;
  albumTitle?: string;
  /** Display name of the stored file, including extension. */
  fileName: string;
  /** Seconds; 0 when unknown (the track can still be played and scrubbed). */
  duration: number;
  /** Bytes of the stored blob; -1 when unknown. */
  fileSize: number;
  /** Lowercased extension of the stored file ('mp3', 'm4a', …). */
  sourceFormat: string;
  /** SHA-256 hex digest of the file content. Drives duplicate detection. */
  contentHash: string;
  /** ISO-8601 UTC string of when the track was imported. */
  dateAdded: string;
  /** Bubble persisted with the record; reconciliation can flip it to false. */
  isAvailable: boolean;
  /** Favorite flag backs the auto-generated Favorites playlist. */
  isFavorite: boolean;
  /** Whether embedded artwork was extracted into the artwork store. */
  hasArtwork: boolean;
}

export interface Playlist {
  id: ID;
  title: string;
  /** Ordered track ids, unique. */
  trackIds: ID[];
  createdAt: string;
  updatedAt: string;
}

export interface MusicPreferences {
  /** 'system' follows prefers-color-scheme; 'light'|'dark' forces it. */
  appearance: 'system' | 'light' | 'dark';
  visualizerMode: VisualizerMode;
  /** 0.5…2.0; multiplies raw band values (VisualizerModel.swift `scaled`). */
  visualizerSensitivity: number;
  /** Reduce visualizer motion independent of the OS setting. */
  reduceVisualizerMotion: boolean;
}

export type VisualizerMode = 'bars' | 'wave' | 'spectrum' | 'minimal';

export const VISUALIZER_MODE_ORDER: ReadonlyArray<VisualizerMode> = [
  'bars',
  'wave',
  'spectrum',
  'minimal',
];

export const VISUALIZER_MODE_LABELS: Record<VisualizerMode, string> = {
  bars: 'Bars',
  wave: 'Wave',
  spectrum: 'Spectrum',
  minimal: 'Minimal',
};

export function defaultMusicPreferences(): MusicPreferences {
  return {
    appearance: 'system',
    visualizerMode: 'bars',
    visualizerSensitivity: 1,
    reduceVisualizerMotion: false,
  };
}

/** Result of one import batch, reported to the UI like the native app does. */
export interface ImportResult {
  imported: number;
  duplicates: string[];
  unsupported: string[];
  failed: string[];
}

export function emptyImportResult(): ImportResult {
  return { imported: 0, duplicates: [], unsupported: [], failed: [] };
}
