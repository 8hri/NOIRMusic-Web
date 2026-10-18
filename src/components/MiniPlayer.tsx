/**
 * NOIR Music — mini player (persistent, above the tab bar).
 *
 * The native `MiniPlayerView` pattern: shows the current track, a play/pause
 * affordance, and — when the browser refused autoplay — an honest "tap to
 * play" hint instead of a silent UI. Tapping the body opens Now Playing.
 */

import { useMusic } from '@/audio/MusicProvider';
import { displayFontClass } from '@/lib/format';
import { Artwork } from './Artwork';
import { PauseIcon, PlayIcon } from './Icons';

export function MiniPlayer({ onOpen }: { onOpen(): void }) {
  const { current, isPlaying, togglePlay, needsGesture } = useMusic();

  if (!current) return null;

  return (
    <div className="mini-player">
      <button
        className="mini-player-body"
        onClick={onOpen}
        aria-label={`Open Now Playing for ${current.title}`}
      >
        <Artwork
          trackId={current.id}
          hasArtwork={current.hasArtwork}
          size="40px"
          unavailable={!current.isAvailable}
        />
        <span className="mini-player-titles">
          <span
            className={`mini-player-title display ${displayFontClass(current.title)}`}
          >
            {current.title}
          </span>
          <span className="mini-player-meta truncate">
            {needsGesture ? 'Tap play to continue' : (current.artistName ?? 'NOIRMusic')}
          </span>
        </span>
      </button>
      <button
        className="icon-button"
        onClick={(event) => {
          event.stopPropagation();
          togglePlay();
        }}
        aria-label={isPlaying ? 'Pause' : 'Play'}
      >
        {isPlaying ? <PauseIcon size={24} /> : <PlayIcon size={24} />}
      </button>
    </div>
  );
}
