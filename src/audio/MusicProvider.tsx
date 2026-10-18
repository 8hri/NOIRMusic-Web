/**
 * NOIR Music — React provider wiring the player together.
 *
 * One context, one `AudioEngine`, one queue. Everything the UI needs is
 * exposed through `useMusic()`; nothing about playback state lives in
 * component state. Rules (why this shape):
 *
 *   - The engine is created once and owned by the provider; React state
 *     mirrors its events. Playback never re-creates the element, so seeking
 *     and background transitions survive re-renders.
 *   - On launch the saved queue snapshot is restored *paused*: the browser
 *     forbids autoplay after a reload anyway, and surprising the user with
 *     sound would be worse. Position is restored so Play resumes where it
 *     stopped.
 *   - Queue snapshots and library metadata are persisted right after the
 *     transitions that change them (track change, shuffle/repeat, pause,
 *     throttled progress) — never on every animation frame.
 *   - Auto-advance past `ended` is attempted only with the gesture sticky
 *     note in mind: if the browser refuses, we surface "tap play" instead of
 *     silently stopping.
 */

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useToast } from '@/lib/toast';
import { isPersistenceLimited } from '@/lib/storage';
import type { ID, ImportResult, MusicPreferences, Playlist, Track } from './models';
import {
  advanceNext,
  advancePrevious,
  currentTrack,
  cycleRepeatMode,
  emptyQueue,
  jumpTo,
  reconcileQueue,
  seedQueue,
  setShuffle,
  systemShuffler,
  type PlaybackQueueState,
} from './queue';
import { AudioEngine } from './audioEngine';
import {
  clearAllMusicData,
  createPlaylist as createPlaylistOp,
  defaultMusicMeta,
  deletePlaylist as deletePlaylistOp,
  getArtwork,
  getAudioBlob,
  importFilesIntoLibrary,
  loadMusicMeta,
  loadQueueSnapshot,
  type MusicMeta,
  normalizeMusicMeta,
  removeTrackFromLibrary,
  removeTrackFromPlaylist,
  renamePlaylist,
  saveMusicMeta,
  saveQueueSnapshot,
  toggleTrackFavorite,
} from './library';

type Appearance = MusicPreferences['appearance'];
type VisualizerMode = MusicPreferences['visualizerMode'];

export interface MusicContextValue {
  // ------------------------------------------------------------- library
  tracks: Track[];
  playlists: Playlist[];
  prefs: MusicPreferences;
  storageLimited: boolean;
  importFiles(files: ReadonlyArray<File>): Promise<ImportResult>;
  deleteTrack(id: ID): Promise<void>;
  toggleFavorite(id: ID): void;
  clearLibrary(): void;
  // ------------------------------------------------------------ playlists
  createPlaylist(title: string, trackIds?: ID[]): Playlist | null;
  renamePlaylist(id: ID, title: string): void;
  deletePlaylist(id: ID): void;
  addTracksToPlaylist(id: ID, trackIds: ID[]): void;
  removeTrackFromPlaylist(id: ID, trackId: ID): void;
  // ---------------------------------------------------------- now playing
  queue: PlaybackQueueState;
  current: Track | null;
  isPlaying: boolean;
  position: number;
  duration: number;
  rate: number;
  volume: number;
  /** Browser blocked playback (needs a tap): show the affordance, not a loop. */
  needsGesture: boolean;
  analyserAvailable: boolean;
  playTrack(trackId: ID, seedIds?: ReadonlyArray<ID>): void;
  togglePlay(): void;
  play(): void;
  pause(): void;
  next(): void;
  previous(): void;
  jumpToTrack(trackId: ID): void;
  toggleShuffle(): void;
  cycleRepeat(): void;
  seek(seconds: number): void;
  setRate(rate: number): void;
  setVolume(volume: number): void;
  frequencyBands(): number[] | null;
  waveformSamples(): number[] | null;
  // ------------------------------------------------------------- settings
  setAppearance(appearance: Appearance): void;
  setVisualizerMode(mode: VisualizerMode): void;
  setVisualizerSensitivity(value: number): void;
  setReduceVisualizerMotion(enabled: boolean): void;
}

const MusicContext = createContext<MusicContextValue | null>(null);

export function useMusic(): MusicContextValue {
  const value = useContext(MusicContext);
  if (!value) {
    throw new Error('useMusic must be used inside <MusicProvider>.');
  }
  return value;
}

/** Snapshots are written on meaningful transitions, not every timeupdate. */
const SNAPSHOT_INTERVAL_MS = 5000;

export function MusicProvider({ children }: { children: ReactNode }) {
  const toast = useToast();

  const [meta, setMeta] = useState<MusicMeta>(() =>
    typeof window === 'undefined'
      ? defaultMusicMeta()
      : loadMusicMeta(),
  );
  const [queue, setQueue] = useState<PlaybackQueueState>(() => emptyQueue());
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [rate, setRateState] = useState(1);
  const [volume, setVolumeState] = useState(1);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [analyserAvailable, setAnalyserAvailable] = useState(false);

  const engineRef = useRef<AudioEngine | null>(null);
  const metaRef = useRef(meta);
  const queueRef = useRef(queue);
  const pendingRestoreRef = useRef<number | null>(null);
  const lastSnapshotRef = useRef(0);
  const artworkUrlRef = useRef<string | null>(null);

  metaRef.current = meta;
  queueRef.current = queue;

  // ------------------------------------------------------------- persistence

  useEffect(() => {
    saveMusicMeta(meta);
  }, [meta]);

  const persistSnapshot = useCallback(() => {
    const state = queueRef.current;
    if (state.currentIndex < 0) return;
    saveQueueSnapshot({
      itemIds: state.items.map((track) => track.id),
      currentIndex: state.currentIndex,
      isShuffled: state.isShuffled,
      repeatMode: state.repeatMode,
      positionSeconds: engineRef.current?.position ?? 0,
    });
  }, []);

  const handlePlaybackChange = useCallback(
    (playing: boolean) => {
      setIsPlaying(playing);
      if (playing) {
        setNeedsGesture(false);
      } else {
        // Pausing is a natural checkpoint: persist immediately.
        persistSnapshot();
        lastSnapshotRef.current = Date.now();
      }
    },
    [persistSnapshot],
  );

  // ------------------------------------------------------------- load + play

  const loadTrack = useCallback(
    async (track: Track, options: { autoplay: boolean }) => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        const blob = await getAudioBlob(track.id);
        if (!blob) {
          setMeta((prev) => ({
            ...prev,
            tracks: prev.tracks.map((item) =>
              item.id === track.id ? { ...item, isAvailable: false } : item,
            ),
          }));
          toast.show(`The audio for “${track.title}” is missing.`, {
            tone: 'error',
          });
          return;
        }
        await engine.loadSource(track.id, blob);
        engine.setMediaSessionMetadata(track, artworkUrlRef.current ?? undefined);
        if (options.autoplay) {
          try {
            await engine.play();
            setNeedsGesture(false);
          } catch (error) {
            if (
              error instanceof DOMException &&
              error.name === 'NotAllowedError'
            ) {
              setNeedsGesture(true);
            } else {
              toast.show('Playback failed for this track.', { tone: 'error' });
            }
          }
        }
      } catch {
        toast.show('Could not load this track.', { tone: 'error' });
      }
    },
    [toast],
  );

  // --------------------------------------------------------- lifecycle: mount

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const engine = new AudioEngine({
      onPositionChange: (next) => {
        setPosition(next);
        const now = Date.now();
        if (now - lastSnapshotRef.current >= SNAPSHOT_INTERVAL_MS) {
          lastSnapshotRef.current = now;
          persistSnapshot();
        }
      },
      onDurationChange: (next) => {
        setDuration(next);
        const restoreTo = pendingRestoreRef.current;
        if (restoreTo !== null && engineRef.current && next > 0) {
          pendingRestoreRef.current = null;
          engineRef.current.seek(Math.min(restoreTo, next));
        }
      },
      onEnded: () => {
        // Auto-advance mirrors the native player; repeat-one is handled by
        // the queue rule set (it replays the same entry).
        const state = queueRef.current;
        const outcome = advanceNext(state);
        if (!outcome.advanced) {
          engineRef.current?.updatePositionState();
          return;
        }
        setQueue(outcome.state);
        const nextTrack = currentTrack(outcome.state);
        if (nextTrack) {
          void loadTrack(nextTrack, { autoplay: true });
        }
      },
      onPlaybackChange: handlePlaybackChange,
      onRateChange: setRateState,
      onVolumeChange: setVolumeState,
      onError: (error) => {
        toast.show(error.message, { tone: 'error' });
      },
    });
    engineRef.current = engine;

    engine.setMediaSessionHandlers({
      onPlay: () => void engine.play(),
      onPause: () => engine.pause(),
      onPreviousTrack: () => {
        const outcome = advancePrevious(queueRef.current);
        if (outcome.advanced) {
          setQueue(outcome.state);
          const target = currentTrack(outcome.state);
          if (target) void loadTrack(target, { autoplay: true });
        }
      },
      onNextTrack: () => {
        const outcome = advanceNext(queueRef.current);
        if (outcome.advanced) {
          setQueue(outcome.state);
          const target = currentTrack(outcome.state);
          if (target) void loadTrack(target, { autoplay: true });
        }
      },
      onSeekTo: (seconds) => engine.seek(seconds),
      onSeekForward: () => engine.seek(engine.position + 15),
      onSeekBackward: () => engine.seek(engine.position - 15),
    });

    // Restore the saved session — paused, at the remembered position.
    const snapshot = loadQueueSnapshot();
    const library = metaRef.current.tracks;
    if (snapshot && snapshot.itemIds.length > 0) {
      const items = snapshot.itemIds
        .map((id) => library.find((track) => track.id === id))
        .filter((track): track is Track => track !== undefined);
      const currentIndex = Math.min(snapshot.currentIndex, items.length - 1);
      const target = items[currentIndex];
      if (target) {
        const restored: PlaybackQueueState = {
          items,
          currentIndex,
          isShuffled: snapshot.isShuffled,
          shuffledOrder: [],
          repeatMode: snapshot.repeatMode,
        };
        setQueue(
          restored.isShuffled
            ? setShuffle(restored, true, systemShuffler)
            : restored,
        );
        pendingRestoreRef.current = snapshot.positionSeconds;
        void loadTrack(target, { autoplay: false });

        // Cached artwork URL keeps lock-screen metadata honest.
        if (target.hasArtwork) {
          void getArtwork(target.id).then((blob) => {
            if (blob && artworkUrlRef.current === null) {
              artworkUrlRef.current = URL.createObjectURL(blob);
              engine.setMediaSessionMetadata(
                target,
                artworkUrlRef.current ?? undefined,
              );
            }
          });
        }
      }
    }

    return () => {
      persistSnapshot();
      if (artworkUrlRef.current) {
        URL.revokeObjectURL(artworkUrlRef.current);
        artworkUrlRef.current = null;
      }
      engine.dispose();
      engineRef.current = null;
    };
    // Mount once. Intentionally empty deps; loadTrack/toast are stable enough
    // for one-shot wiring and re-running would rebuild the audio element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------ library ops

  const importFiles = useCallback(
    async (files: ReadonlyArray<File>): Promise<ImportResult> => {
      const current = metaRef.current;
      const { meta: next, result } = await importFilesIntoLibrary(files, current);
      if (next !== current) {
        setMeta((prev) =>
          prev === current ? next : mergeImported(prev, next, current),
        );
        setQueue((prev) => reconcileQueue(prev, next.tracks));
      }
      if (result.imported > 0) {
        toast.show(`${result.imported} track${result.imported > 1 ? 's' : ''} added to your library.`, {
          tone: 'success',
        });
      }
      if (result.duplicates.length > 0) {
        toast.show(`${result.duplicates.length} file${result.duplicates.length > 1 ? 's' : ''} already in your library.`, {
          tone: 'info',
        });
      }
      if (result.unsupported.length > 0) {
        toast.show(
          `${result.unsupported.length} file${result.unsupported.length > 1 ? 's' : ''} not supported (mp3, m4a, wav, flac).`,
          { tone: 'info' },
        );
      }
      if (result.failed.length > 0) {
        toast.show(`${result.failed.length} file${result.failed.length > 1 ? 's' : ''} failed to import.`, {
          tone: 'error',
        });
      }
      return result;
    },
    [toast],
  );

  const deleteTrack = useCallback(
    async (id: ID) => {
      const next = await removeTrackFromLibrary(metaRef.current, id);
      setMeta(next);
      setQueue((prev) => reconcileQueue(prev, next.tracks));
      const engine = engineRef.current;
      if (engine?.currentTrackId === id) {
        engine.pause();
      }
      toast.show('Track removed from your library.', { tone: 'info' });
    },
    [toast],
  );

  const toggleFavorite = useCallback((id: ID) => {
    setMeta((prev) => toggleTrackFavorite(prev, id));
  }, []);

  const clearLibrary = useCallback(() => {
    clearAllMusicData();
    setMeta(normalizeMusicMeta(null));
    setQueue(emptyQueue());
    engineRef.current?.pause();
    engineRef.current?.clearMediaSession();
    toast.show('Library cleared.', { tone: 'info' });
  }, [toast]);

  // ----------------------------------------------------------- playlist ops

  const createPlaylist = useCallback((title: string, trackIds?: ID[]) => {
    let created: Playlist | null = null;
    setMeta((prev) => {
      const { meta: next, playlist } = createPlaylistOp(
        prev,
        title,
        trackIds ?? [],
      );
      created = playlist;
      return next;
    });
    return created;
  }, []);

  const rename = useCallback((id: ID, title: string) => {
    setMeta((prev) => renamePlaylist(prev, id, title));
  }, []);

  const removePlaylist = useCallback((id: ID) => {
    setMeta((prev) => deletePlaylistOp(prev, id));
  }, []);

  const addToPlaylist = useCallback((id: ID, trackIds: ID[]) => {
    setMeta((prev) => {
      const playlist = prev.playlists.find((item) => item.id === id);
      if (!playlist) return prev;
      return {
        ...prev,
        playlists: prev.playlists.map((item) =>
          item.id === id
            ? {
                ...item,
                trackIds: [...new Set([...item.trackIds, ...trackIds])],
                updatedAt: new Date().toISOString(),
              }
            : item,
        ),
      };
    });
  }, []);

  const removeFromPlaylist = useCallback((id: ID, trackId: ID) => {
    setMeta((prev) => removeTrackFromPlaylist(prev, id, trackId));
  }, []);

  // --------------------------------------------------------- transport ops

  const playTrack = useCallback(
    (trackId: ID, seedIds?: ReadonlyArray<ID>) => {
      const library = metaRef.current.tracks;
      const seed = seedIds
        ? seedIds
            .map((id) => library.find((track) => track.id === id))
            .filter((track): track is Track => track !== undefined)
        : library;
      const next = seedQueue(queueRef.current, seed, trackId, systemShuffler);
      setQueue(next);
      const target = currentTrack(next);
      if (target) {
        pendingRestoreRef.current = null;
        void ensureArtworkUrl(target);
        void loadTrack(target, { autoplay: true });
      }
    },
    [loadTrack],
  );

  /** Keeps lock-screen artwork in sync when the current track changes. */
  const ensureArtworkUrl = useCallback(async (track: Track) => {
    if (!track.hasArtwork) {
      if (artworkUrlRef.current) {
        URL.revokeObjectURL(artworkUrlRef.current);
        artworkUrlRef.current = null;
      }
      return;
    }
    const blob = await getArtwork(track.id).catch(() => undefined);
    if (artworkUrlRef.current) {
      URL.revokeObjectURL(artworkUrlRef.current);
      artworkUrlRef.current = null;
    }
    if (blob) {
      artworkUrlRef.current = URL.createObjectURL(blob);
      engineRef.current?.setMediaSessionMetadata(
        track,
        artworkUrlRef.current ?? undefined,
      );
    }
  }, []);

  const play = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (currentTrack(queueRef.current) === null) {
      const first = metaRef.current.tracks[0];
      if (first) {
        playTrack(first.id);
      }
      return;
    }
    void engine
      .play()
      .then(() => setNeedsGesture(false))
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          setNeedsGesture(true);
        }
      });
  }, [playTrack]);

  const pause = useCallback(() => {
    engineRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, pause, play]);

  const next = useCallback(() => {
    const outcome = advanceNext(queueRef.current);
    if (!outcome.advanced) return;
    setQueue(outcome.state);
    const target = currentTrack(outcome.state);
    if (target) {
      void ensureArtworkUrl(target);
      void loadTrack(target, { autoplay: true });
    }
  }, [loadTrack, ensureArtworkUrl]);

  const previous = useCallback(() => {
    const engine = engineRef.current;
    // The native "~3 s" rule: late in a track, Previous restarts it instead
    // of jumping back.
    if (engine && engine.handlePreviousTap() === 'restarted') return;
    const outcome = advancePrevious(queueRef.current);
    if (!outcome.advanced) return;
    setQueue(outcome.state);
    const target = currentTrack(outcome.state);
    if (target) {
      void ensureArtworkUrl(target);
      void loadTrack(target, { autoplay: true });
    }
  }, [loadTrack, ensureArtworkUrl]);

  const jumpToTrack = useCallback(
    (trackId: ID) => {
      setQueue((prev) => jumpTo(prev, trackId));
      const target = metaRef.current.tracks.find((track) => track.id === trackId);
      if (target) {
        void ensureArtworkUrl(target);
        void loadTrack(target, { autoplay: true });
      }
    },
    [loadTrack, ensureArtworkUrl],
  );

  const toggleShuffle = useCallback(() => {
    setQueue((prev) => setShuffle(prev, !prev.isShuffled, systemShuffler));
  }, []);

  const cycleRepeat = useCallback(() => {
    setQueue((prev) => cycleRepeatMode(prev).state);
  }, []);

  const seek = useCallback((seconds: number) => {
    engineRef.current?.seek(seconds);
    setPosition(engineRef.current?.position ?? seconds);
  }, []);

  const setRate = useCallback((value: number) => {
    engineRef.current?.setRate(value);
  }, []);

  const setVolume = useCallback((value: number) => {
    engineRef.current?.setVolume(value);
  }, []);

  const frequencyBands = useCallback(
    () => engineRef.current?.frequencyBands() ?? null,
    [],
  );
  const waveformSamples = useCallback(
    () => engineRef.current?.waveformSamples() ?? null,
    [],
  );

  // ------------------------------------------------------------- settings

  const setAppearance = useCallback((appearance: Appearance) => {
    setMeta((prev) => ({ ...prev, prefs: { ...prev.prefs, appearance } }));
  }, []);
  const setVisualizerMode = useCallback((mode: VisualizerMode) => {
    setMeta((prev) => ({ ...prev, prefs: { ...prev.prefs, visualizerMode: mode } }));
  }, []);
  const setVisualizerSensitivity = useCallback((value: number) => {
    setMeta((prev) => ({
      ...prev,
      prefs: { ...prev.prefs, visualizerSensitivity: value },
    }));
  }, []);
  const setReduceVisualizerMotion = useCallback((enabled: boolean) => {
    setMeta((prev) => ({
      ...prev,
      prefs: { ...prev.prefs, reduceVisualizerMotion: enabled },
    }));
  }, []);

  // Persist queue transitions (track/shuffle/repeat) right when they happen.
  useEffect(() => {
    persistSnapshot();
  }, [queue.currentIndex, queue.isShuffled, queue.repeatMode, persistSnapshot]);

  // Apply the analyser flag once the engine has attempted attachment.
  useEffect(() => {
    if (analyserAvailable || !engineRef.current) return;
    if (engineRef.current.analyserAvailable) {
      setAnalyserAvailable(true);
    }
  }, [analyserAvailable, isPlaying]);

  const value = useMemo<MusicContextValue>(
    () => ({
      tracks: meta.tracks,
      playlists: meta.playlists,
      prefs: meta.prefs,
      storageLimited: isPersistenceLimited(),
      importFiles,
      deleteTrack,
      toggleFavorite,
      clearLibrary,
      createPlaylist,
      renamePlaylist: rename,
      deletePlaylist: removePlaylist,
      addTracksToPlaylist: addToPlaylist,
      removeTrackFromPlaylist: removeFromPlaylist,
      queue,
      current: currentTrack(queue),
      isPlaying,
      position,
      duration,
      rate,
      volume,
      needsGesture,
      analyserAvailable,
      playTrack,
      togglePlay,
      play,
      pause,
      next,
      previous,
      jumpToTrack,
      toggleShuffle,
      cycleRepeat,
      seek,
      setRate,
      setVolume,
      frequencyBands,
      waveformSamples,
      setAppearance,
      setVisualizerMode,
      setVisualizerSensitivity,
      setReduceVisualizerMotion,
    }),
    [
      meta,
      queue,
      isPlaying,
      position,
      duration,
      rate,
      volume,
      needsGesture,
      analyserAvailable,
      importFiles,
      deleteTrack,
      toggleFavorite,
      clearLibrary,
      createPlaylist,
      rename,
      removePlaylist,
      addToPlaylist,
      removeFromPlaylist,
      playTrack,
      togglePlay,
      play,
      pause,
      next,
      previous,
      jumpToTrack,
      toggleShuffle,
      cycleRepeat,
      seek,
      setRate,
      setVolume,
      frequencyBands,
      waveformSamples,
      setAppearance,
      setVisualizerMode,
      setVisualizerSensitivity,
      setReduceVisualizerMotion,
    ],
  );

  return <MusicContext.Provider value={value}>{children}</MusicContext.Provider>;
}

/**
 * Import runs against `baseline`; if other state moved meanwhile, keep only the
 * newly resolved tracks and re-validate against the fresher meta.
 */
function mergeImported(prev: MusicMeta, next: MusicMeta, baseline: MusicMeta): MusicMeta {
  if (prev === baseline) return next;
  const added = next.tracks.filter(
    (track) => !baseline.tracks.some((item) => item.id === track.id),
  );
  return {
    ...prev,
    tracks: [...added, ...prev.tracks],
  };
}
