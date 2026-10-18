/**
 * NOIR Music — Library screen (DESIGN.md §2).
 *
 * An editorial feed of the user's tracks: top bar with the wordmark, a
 * "Your Library" heading, the import entry point, Recently Added, and the
 * full Songs list. Empty state explains what the app does and how to start.
 */

import { useMusic } from '@/audio/MusicProvider';
import type { ID } from '@/audio/models';
import { displayFontClass } from '@/lib/format';
import { ImportButton } from '@/components/ImportButton';
import { TrackRow, metaLine } from '@/components/TrackRow';
import { Artwork } from '@/components/Artwork';
import { ChevronDownIcon, PlayIcon } from '@/components/Icons';

const RECENT_LIMIT = 6;

export function LibraryScreen({
  onPlayTrack,
  onOpenTrackMenu,
}: {
  onPlayTrack(trackId: ID): void;
  onOpenTrackMenu(trackId: ID): void;
}) {
  const { tracks, current } = useMusic();

  if (tracks.length === 0) {
    return (
      <div className="page">
        <div className="empty">
          <h2 className="display">Your library is empty.</h2>
          <p>
            Import music from your device. Files stay on your phone — nothing is
            uploaded anywhere.
          </p>
          <ImportButton />
        </div>
      </div>
    );
  }

  // dateAdded desc — most recent first, like the native Recently Added rail.
  const byAdded = [...tracks].sort(
    (a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime(),
  );
  const recent = byAdded.slice(0, RECENT_LIMIT);

  return (
    <div className="page">
      <div className="section-heading">
        <h2>Recently Added</h2>
        <span className="meta">{tracks.length} total</span>
      </div>
      <div className="row-list">
        {recent.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            active={current?.id === track.id}
            onPlay={onPlayTrack}
            onAddToPlaylist={onOpenTrackMenu}
          />
        ))}
      </div>

      <div className="section-heading">
        <h2>Songs</h2>
        <ImportButton variant="icon" label="Import music" />
      </div>
      <div className="row-list">
        {byAdded.map((track) => (
          <TrackRow
            key={track.id}
            track={track}
            active={current?.id === track.id}
            onPlay={onPlayTrack}
            onAddToPlaylist={onOpenTrackMenu}
          />
        ))}
      </div>
    </div>
  );
}

export { ChevronDownIcon, PlayIcon, metaLine, displayFontClass, Artwork };
