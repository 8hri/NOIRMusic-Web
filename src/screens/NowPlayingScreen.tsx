/**
 * NOIR Music — Now Playing (full-screen, DESIGN.md §2).
 *
 * Big artwork, live visualizer, a scrubber, the transport row, and queue
 * access. The scrubber is a plain range input for reliability: custom pointer
 * handling is a well of edge cases, and correctness beats novelty here.
 */

import { useEffect, useState } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import { displayFontClass, formatDuration } from '@/lib/format';
import { Artwork } from '@/components/Artwork';
import { Sheet } from '@/components/Sheet';
import { Visualizer } from '@/components/Visualizer';
import {
  BackwardIcon,
  ChevronDownIcon,
  ForwardIcon,
  HeartFilledIcon,
  HeartIcon,
  PauseIcon,
  PlayIcon,
  QueueIcon,
  RepeatIcon,
  RepeatOneIcon,
  ShuffleIcon,
} from '@/components/Icons';

export function NowPlayingScreen({ onClose }: { onClose(): void }) {
  const {
    current,
    isPlaying,
    position,
    duration,
    rate,
    queue,
    needsGesture,
    analyserAvailable,
    togglePlay,
    next,
    previous,
    toggleShuffle,
    cycleRepeat,
    seek,
    setRate,
    toggleFavorite,
    jumpToTrack,
  } = useMusic();
  const [queueOpen, setQueueOpen] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubValue, setScrubValue] = useState(0);
  const [speedOpen, setSpeedOpen] = useState(false);

  // Live duration display while scrubbing, without fighting the engine.
  const shownPosition = scrubbing ? scrubValue : position;
  const track = current;

  // Keep the system media-session state consistent when the user hides the app.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        // The engine keeps playing; position updates are throttled to the
        // snapshot cadence. Nothing else to do here.
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  if (!track) return null;

  const remaining = Math.max(0, duration - shownPosition);
  const repeatIcon =
    queue.repeatMode === 'one' ? <RepeatOneIcon /> : <RepeatIcon />;
  const repeatActive = queue.repeatMode !== 'off';

  return (
    <div className="now-playing" role="dialog" aria-modal="true" aria-label="Now Playing">
      <div className="now-playing-header">
        <button
          className="icon-button muted"
          onClick={onClose}
          aria-label="Minimize"
        >
          <ChevronDownIcon />
        </button>
        <span className="meta truncate">Now Playing</span>
        <button
          className="icon-button muted"
          onClick={() => setQueueOpen(true)}
          aria-label="Open queue"
        >
          <QueueIcon />
        </button>
      </div>

      <div className="now-playing-body">
        <div className="now-playing-artwork">
          <Artwork
            trackId={track.id}
            hasArtwork={track.hasArtwork}
            size="min(74vw, 340px)"
            unavailable={!track.isAvailable}
          />
        </div>

        <div className="now-playing-info">
          <button
            className="icon-button now-playing-favorite"
            onClick={() => toggleFavorite(track.id)}
            aria-label={track.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
          >
            {track.isFavorite ? <HeartFilledIcon size={22} /> : <HeartIcon size={22} />}
          </button>
          <h1
            className={`now-playing-title display ${displayFontClass(track.title)}`}
          >
            {track.title}
          </h1>
          <p className="now-playing-artist">
            {track.artistName ?? 'Unknown artist'}
            {track.albumTitle ? ` — ${track.albumTitle}` : ''}
          </p>
        </div>

        {analyserAvailable && (
          <div className="now-playing-visualizer">
            <Visualizer height={56} />
          </div>
        )}

        <div className="now-playing-progress">
          <input
            className="scrubber"
            type="range"
            min={0}
            max={Math.max(1, duration)}
            step={0.1}
            value={Math.min(shownPosition, duration || 0)}
            onChange={(event) => {
              setScrubbing(true);
              setScrubValue(Number(event.target.value));
            }}
            onPointerUp={(event) => {
              seek(Number(event.currentTarget.value));
              setScrubbing(false);
            }}
            onKeyUp={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                const target = event.currentTarget as HTMLInputElement;
                seek(Number(target.value));
              }
            }}
            aria-label="Seek"
            aria-valuemin={0}
            aria-valuemax={Math.max(1, duration)}
            aria-valuenow={shownPosition}
          />
          <div className="now-playing-times">
            <span>{formatDuration(shownPosition)}</span>
            <span>{formatDuration(remaining)}</span>
          </div>
        </div>

        {needsGesture && (
          <p className="setting-note" style={{ textAlign: 'center', margin: '-4px 0 8px' }}>
            The browser paused playback. Tap play to continue.
          </p>
        )}

        <div className="now-playing-transport">
          <button
            className={`icon-button${queue.isShuffled ? ' accent' : ' muted'}`}
            onClick={toggleShuffle}
            aria-pressed={queue.isShuffled}
            aria-label="Shuffle"
          >
            <ShuffleIcon size={20} />
          </button>
          <button
            className="icon-button"
            onClick={previous}
            aria-label="Previous track"
          >
            <BackwardIcon size={28} />
          </button>
          <button
            className="icon-button now-playing-play"
            onClick={togglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <PauseIcon size={32} /> : <PlayIcon size={32} />}
          </button>
          <button
            className="icon-button"
            onClick={next}
            aria-label="Next track"
          >
            <ForwardIcon size={28} />
          </button>
          <button
            className={`icon-button${repeatActive ? ' accent' : ' muted'}`}
            onClick={cycleRepeat}
            aria-pressed={repeatActive}
            aria-label={`Repeat: ${queue.repeatMode}`}
          >
            {repeatIcon}
          </button>
        </div>

        <div className="now-playing-footer">
          <button
            className="pill-button"
            onClick={() => setSpeedOpen((open) => !open)}
            aria-expanded={speedOpen}
          >
            {rate.toFixed(2).replace(/0$/, '')}× speed
          </button>
        </div>
        {speedOpen && (
          <div className="now-playing-speeds" role="group" aria-label="Playback speed">
            {[0.75, 1, 1.25, 1.5, 1.75, 2].map((option) => (
              <button
                key={option}
                className={`pill-button${rate === option ? ' primary' : ''}`}
                onClick={() => {
                  setRate(option);
                  setSpeedOpen(false);
                }}
                aria-pressed={rate === option}
              >
                {option}×
              </button>
            ))}
          </div>
        )}
      </div>

      {queueOpen && (
        <Sheet title="Play Queue" onClose={() => setQueueOpen(false)}>
          {queue.items.length === 0 ? (
            <p className="setting-note">The queue is empty.</p>
          ) : (
            <div className="row-list">
              {queue.items.map((item) => (
                <button
                  key={item.id}
                  className={`track-row${
                    item.id === track.id ? ' active' : ''
                  }`}
                  onClick={() => {
                    jumpToTrack(item.id);
                    setQueueOpen(false);
                  }}
                >
                  <Artwork
                    trackId={item.id}
                    hasArtwork={item.hasArtwork}
                    size="46px"
                    unavailable={!item.isAvailable}
                  />
                  <span className="track-row-titles">
                    <span
                      className={`track-row-title display ${displayFontClass(item.title)}`}
                    >
                      {item.title}
                    </span>
                    <span className="track-row-meta truncate">
                      {item.artistName ?? 'Unknown artist'}
                    </span>
                  </span>
                  {item.id === track.id && (
                    <span className="meta" aria-hidden="true">Playing</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}
