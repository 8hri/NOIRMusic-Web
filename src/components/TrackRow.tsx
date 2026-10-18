/**
 * NOIR Music — track row and its action sheet.
 *
 * The editorial row from DESIGN.md §2: artwork tile, serif title, muted
 * artist/album meta, hairline separators. The overflow sheet mirrors the
 * native context menu: play, favorite, add to a playlist, remove.
 */

import { useState } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import type { ID, Track } from '@/audio/models';
import { displayFontClass, formatDuration } from '@/lib/format';
import { Artwork } from './Artwork';
import { Sheet } from './Sheet';
import {
  ChevronDownIcon,
  HeartFilledIcon,
  HeartIcon,
  MoreIcon,
  NowPlayingEqualizerIcon,
  PlayIcon,
  PlusIcon,
  TrashIcon,
} from './Icons';

export function TrackRow({
  track,
  active,
  onPlay,
  onAddToPlaylist,
  showArtwork = true,
}: {
  track: Track;
  active: boolean;
  onPlay(trackId: ID): void;
  onAddToPlaylist?(trackId: ID): void;
  showArtwork?: boolean;
}) {
  const { toggleFavorite, deleteTrack } = useMusic();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <button
        className={`track-row${active ? ' active' : ''}`}
        onClick={() => onPlay(track.id)}
        aria-label={`Play ${track.title}`}
      >
        {showArtwork && (
          <Artwork
            trackId={track.id}
            hasArtwork={track.hasArtwork}
            size="46px"
            unavailable={!track.isAvailable}
          />
        )}
        <span className="track-row-titles">
          <span
            className={`track-row-title display ${displayFontClass(track.title)}`}
          >
            {track.title}
          </span>
          <span className="track-row-meta truncate">
            {metaLine(track)}
          </span>
        </span>
        {active && (
          <span className="icon-button accent" style={{ pointerEvents: 'none' }} aria-hidden="true">
            <NowPlayingEqualizerIcon size={18} />
          </span>
        )}
        <span
          className="icon-button muted"
          role="button"
          tabIndex={0}
          aria-label={`More actions for ${track.title}`}
          onClick={(event) => {
            event.stopPropagation();
            setMenuOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.stopPropagation();
              setMenuOpen(true);
            }
          }}
        >
          <MoreIcon size={18} />
        </span>
      </button>

      {menuOpen && (
        <Sheet title={track.title} onClose={() => setMenuOpen(false)}>
          <div className="row-list">
            <button
              className="track-row"
              style={{ borderTop: 0 }}
              onClick={() => {
                setMenuOpen(false);
                onPlay(track.id);
              }}
            >
              <span className="icon-button accent" aria-hidden="true">
                <PlayIcon size={20} />
              </span>
              <span className="track-row-titles">
                <span className="track-row-title">Play</span>
              </span>
            </button>
            <button
              className="track-row"
              onClick={() => {
                setMenuOpen(false);
                toggleFavorite(track.id);
              }}
            >
              <span className="icon-button accent" aria-hidden="true">
                {track.isFavorite ? (
                  <HeartFilledIcon size={20} />
                ) : (
                  <HeartIcon size={20} />
                )}
              </span>
              <span className="track-row-titles">
                <span className="track-row-title">
                  {track.isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
                </span>
              </span>
            </button>
            <button
              className="track-row"
              onClick={() => {
                setMenuOpen(false);
                onAddToPlaylist?.(track.id);
              }}
            >
              <span className="icon-button accent" aria-hidden="true">
                <PlusIcon size={20} />
              </span>
              <span className="track-row-titles">
                <span className="track-row-title">Add to Playlist…</span>
              </span>
            </button>
            <button
              className="track-row"
              onClick={() => {
                setMenuOpen(false);
                void deleteTrack(track.id);
              }}
            >
              <span className="icon-button" style={{ color: 'var(--danger)' }} aria-hidden="true">
                <TrashIcon size={20} />
              </span>
              <span className="track-row-titles">
                <span className="track-row-title" style={{ color: 'var(--danger)' }}>
                  Remove from Library
                </span>
              </span>
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}

export function metaLine(track: Track): string {
  const parts: string[] = [];
  if (track.artistName) parts.push(track.artistName);
  else if (track.albumTitle) parts.push(track.albumTitle);
  else parts.push('Unknown artist');
  if (track.duration > 0) parts.push(formatDuration(track.duration));
  return parts.join(' · ');
}

export { ChevronDownIcon };
