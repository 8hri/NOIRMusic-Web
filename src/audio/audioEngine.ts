/**
 * NOIR Music — browser audio engine.
 *
 * The web counterpart of the native app's AVAudioEngine layer
 * (`AudioPlayerController` + `AnalyserProvider` + `AudioSession`), built on a
 * single `HTMLAudioElement` plus an opt-in Web Audio analyser:
 *
 *   - One source of truth for `play / pause / seek / rate / volume`, mirroring
 *     the transport surface the native UI already expects.
 *   - `handlePreviousTap` carries the native "~3 s" rule: within the first
 *     three seconds, Previous means *previous track*; afterwards it restarts
 *     the current track. Playback state is never disturbed by the decision.
 *   - The analyser is created lazily on the first user-initiated play (an
 *     AudioContext can only resume inside a gesture on iOS). If Web Audio is
 *     unavailable or the node fails, playback continues untouched and the
 *     visualizer simply stays flat — degradation, never breakage.
 *   - `navigator.mediaSession` metadata + action handlers provide lock-screen
 *     and Control-Center controls *where supported*. This is a device-test
 *     requirement, not a guarantee — the provider reports support honestly.
 *
 * This module is browser-only by construction and holds no React state.
 */

import type { Track } from './models';

/** Seconds into a track before Previous switches from "restart" to "back". */
export const PREVIOUS_RESTART_SECONDS = 3;

/** Logical analyser bin count before UI aggregation (power of 2, for FFT). */
export const ANALYSER_FFT_SIZE = 128;

export interface AudioEngineCallbacks {
  onPositionChange?(position: number, duration: number): void;
  onDurationChange?(duration: number): void;
  onEnded?(): void;
  onError?(error: Error): void;
  onPlaybackChange?(isPlaying: boolean): void;
  onRateChange?(rate: number): void;
  onVolumeChange?(volume: number): void;
  onCanPlay?(): void;
}

export type PreviousTapResult = 'restarted' | 'previous';

export class AudioEngine {
  private readonly element: HTMLAudioElement;
  private readonly callbacks: AudioEngineCallbacks;
  private objectUrl: string | null = null;
  private loadedTrackId: string | null = null;
  private context: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private frequencyBuffer: Uint8Array | null = null;
  private timeBuffer: Uint8Array | null = null;
  private analyticFailure = false;

  constructor(callbacks: AudioEngineCallbacks) {
    this.callbacks = callbacks;
    this.element = document.createElement('audio');
    this.element.preload = 'auto';
    // Elements created for playback should not capture focus on tap.
    this.element.setAttribute('aria-hidden', 'true');
    this.element.style.display = 'none';

    this.element.addEventListener('timeupdate', () => {
      this.callbacks.onPositionChange?.(this.position, this.duration);
    });
    this.element.addEventListener('durationchange', () => {
      this.callbacks.onDurationChange?.(this.duration);
    });
    this.element.addEventListener('loadedmetadata', () => {
      this.callbacks.onDurationChange?.(this.duration);
    });
    this.element.addEventListener('ended', () => {
      this.callbacks.onPlaybackChange?.(false);
      this.callbacks.onEnded?.();
    });
    // Both user taps and external surfaces (lock screen, Control Center,
    // another app taking the route) arrive as the same element events.
    this.element.addEventListener('pause', () => {
      this.callbacks.onPlaybackChange?.(false);
    });
    this.element.addEventListener('play', () => {
      this.callbacks.onPlaybackChange?.(true);
    });
    this.element.addEventListener('ratechange', () => {
      this.callbacks.onRateChange?.(this.element.playbackRate);
    });
    this.element.addEventListener('volumechange', () => {
      this.callbacks.onVolumeChange?.(this.element.volume);
    });
    this.element.addEventListener('error', () => {
      const error = this.element.error;
      this.callbacks.onError?.(
        new Error(
          `Audio error${error ? ` (code ${error.code})` : ''}: ${
            this.loadedTrackId ?? 'unknown track'
          }`,
        ),
      );
    });
    this.element.addEventListener('canplay', () => {
      this.callbacks.onCanPlay?.();
    });
  }

  // ------------------------------------------------------------------ source

  /**
   * Loads a track's Blob. Object URLs are created per load and revoked on the
   * next load or disposal — the Blob itself survives in IndexedDB, so nothing
   * is lost across restarts, and the URL is never persisted.
   */
  async loadSource(trackId: string, blob: Blob): Promise<void> {
    if (this.loadedTrackId === trackId && this.objectUrl) return;
    this.releaseObjectUrl();
    const url = URL.createObjectURL(blob);
    this.objectUrl = url;
    this.loadedTrackId = trackId;
    this.element.src = url;
    this.element.load();
  }

  get currentTrackId(): string | null {
    return this.loadedTrackId;
  }

  /** Whether mediaSession + position state can be reported at all. */
  static get mediaSessionSupported(): boolean {
    return typeof navigator !== 'undefined' && 'mediaSession' in navigator;
  }

  // --------------------------------------------------------------- transport

  /**
   * Starts playback. `NotAllowedError` means the browser needs a user gesture
   * first (iOS Safari's rule) — the caller surfaces a hint rather than
   * silently failing.
   */
  async play(): Promise<void> {
    this.attachAnalyser();
    await this.resumeContext();
    try {
      await this.element.play();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') {
        throw error;
      }
      this.callbacks.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  pause(): void {
    this.element.pause();
  }

  get isPlaying(): boolean {
    return !this.element.paused && !this.element.ended;
  }

  get position(): number {
    return Number.isFinite(this.element.currentTime) ? this.element.currentTime : 0;
  }

  get duration(): number {
    const duration = this.element.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  }

  seek(seconds: number): void {
    const duration = this.duration;
    const target = Math.min(Math.max(0, seconds), duration || seconds);
    try {
      this.element.currentTime = target;
    } catch {
      // Seeking can throw before metadata loads; ignore — the UI clamps.
    }
    this.updatePositionState();
  }

  get rate(): number {
    return this.element.playbackRate;
  }

  setRate(rate: number): void {
    const clamped = Math.min(Math.max(rate, 0.5), 2);
    this.element.playbackRate = clamped;
  }

  get volume(): number {
    return this.element.volume;
  }

  setVolume(volume: number): void {
    this.element.volume = Math.min(Math.max(volume, 0), 1);
  }

  /**
   * The native "~3 s" Previous rule: early in a track, tapping Previous goes
   * to the previous track; later it restarts the current one. Decided here so
   * callers never need to reason about transport state.
   */
  handlePreviousTap(): PreviousTapResult {
    if (this.position > PREVIOUS_RESTART_SECONDS) {
      this.seek(0);
      return 'restarted';
    }
    return 'previous';
  }

  // --------------------------------------------------------------- analyser

  private attachAnalyser(): void {
    if (this.analyser || this.analyticFailure) return;
    const AudioContextClass =
      typeof AudioContext !== 'undefined'
        ? AudioContext
        : (window as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
    if (!AudioContextClass) {
      this.analyticFailure = true;
      return;
    }
    try {
      const context = new AudioContextClass();
      const source = context.createMediaElementSource(this.element);
      const analyser = context.createAnalyser();
      analyser.fftSize = ANALYSER_FFT_SIZE;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyser.connect(context.destination);
      this.context = context;
      this.sourceNode = source;
      this.analyser = analyser;
      this.frequencyBuffer = new Uint8Array(analyser.frequencyBinCount);
      this.timeBuffer = new Uint8Array(analyser.fftSize);
    } catch {
      // Without an analyser the app still plays perfectly; decoration only.
      this.analyticFailure = true;
    }
  }

  private async resumeContext(): Promise<void> {
    try {
      await this.context?.resume();
    } catch {
      // Context resume failing does not block element playback.
    }
  }

  get analyserAvailable(): boolean {
    return this.analyser !== null;
  }

  /** Normalized [0,1] frequency bands, or null until an analyser exists. */
  frequencyBands(): number[] | null {
    if (!this.analyser || !this.frequencyBuffer) return null;
    this.analyser.getByteFrequencyData(
      this.frequencyBuffer as Uint8Array<ArrayBuffer>,
    );
    const bands: number[] = [];
    for (let i = 0; i < this.frequencyBuffer.length; i += 1) {
      bands.push(this.frequencyBuffer[i] / 255);
    }
    return bands;
  }

  /** Normalized [0,1] waveform samples, or null until an analyser exists. */
  waveformSamples(): number[] | null {
    if (!this.analyser || !this.timeBuffer) return null;
    this.analyser.getByteTimeDomainData(
      this.timeBuffer as Uint8Array<ArrayBuffer>,
    );
    const samples: number[] = [];
    for (let i = 0; i < this.timeBuffer.length; i += 1) {
      samples.push(Math.abs(this.timeBuffer[i] - 128) / 128);
    }
    return samples;
  }

  // ----------------------------------------------------------- media session

  /** Artwork the PWA ships, at sizes iOS lock screen may request. */
  private static readonly ARTWORK = [
    { src: '/icons/apple-touch-icon-180.png', sizes: '180x180', type: 'image/png' },
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
  ];

  /**
   * Publishes Now Playing metadata to the system media session. Called on
   * track change; support is reported by `mediaSessionSupported` and must be
   * re-verified on a real device.
   */
  setMediaSessionMetadata(track: Track, artworkUrl?: string): void {
    if (!AudioEngine.mediaSessionSupported) return;
    try {
      const artwork = artworkUrl
        ? [
            { src: artworkUrl, sizes: '512x512', type: 'image/png' },
            ...AudioEngine.ARTWORK,
          ]
        : [...AudioEngine.ARTWORK];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: track.artistName ?? 'NOIRMusic',
        album: track.albumTitle ?? 'NOIRMusic',
        artwork,
      });
      navigator.mediaSession.playbackState = this.isPlaying ? 'playing' : 'paused';
    } catch {
      // Metadata is decoration; never let it break playback.
    }
  }

  /** Registers handlers for system play/pause/seek/skip controls. */
  setMediaSessionHandlers(handlers: {
    onPlay?(): void;
    onPause?(): void;
    onPreviousTrack?(): void;
    onNextTrack?(): void;
    onSeekTo?(seconds: number): void;
    onSeekForward?(): void;
    onSeekBackward?(): void;
  }): void {
    if (!AudioEngine.mediaSessionSupported) return;
    const session = navigator.mediaSession;
    try {
      session.setActionHandler('play', () => handlers.onPlay?.());
      session.setActionHandler('pause', () => handlers.onPause?.());
      session.setActionHandler('previoustrack', () =>
        handlers.onPreviousTrack?.(),
      );
      session.setActionHandler('nexttrack', () => handlers.onNextTrack?.());
      session.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          handlers.onSeekTo?.(details.seekTime);
        }
      });
      session.setActionHandler('seekforward', () => handlers.onSeekForward?.());
      session.setActionHandler('seekbackward', () => handlers.onSeekBackward?.());
    } catch {
      // Individual handlers may be unsupported; the transport still works.
    }
  }

  /** Clears artwork/title so the system UI does not show a stale track. */
  clearMediaSession(): void {
    if (!AudioEngine.mediaSessionSupported) return;
    try {
      navigator.mediaSession.metadata = null;
    } catch {
      // ignore
    }
  }

  /** Reports progress to the system (lock-screen scrubber), where supported. */
  updatePositionState(): void {
    if (!AudioEngine.mediaSessionSupported) return;
    const duration = this.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        position: Math.min(Math.max(this.position, 0), duration),
        playbackRate: this.element.playbackRate || 1,
      });
    } catch {
      // Position state is best-effort.
    }
  }

  // -------------------------------------------------------------- lifecycle

  private releaseObjectUrl(): void {
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }

  dispose(): void {
    this.releaseObjectUrl();
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    try {
      this.sourceNode?.disconnect();
      this.analyser?.disconnect();
      void this.context?.close();
    } catch {
      // ignore
    }
    this.context = null;
    this.sourceNode = null;
    this.analyser = null;
    this.loadedTrackId = null;
  }
}
