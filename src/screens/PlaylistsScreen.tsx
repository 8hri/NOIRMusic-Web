/**
 * NOIR Music — Playlists screen and playlist detail.
 *
 * Favorites and Recently Played are generated views, as DESIGN.md §2 allows;
 * user playlists are ordinary editable lists. Mosaic artwork is approximated
 * with the first track's tile plus a count badge (single image keeps the
 * interface restrained and the code honest).
 */

import { useState } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import type { ID } from '@/audio/models';
import { displayFontClass, pluralize } from '@/lib/format';
import { Artwork } from '@/components/Artwork';
import { ImportButton } from '@/components/ImportButton';
import { Sheet } from '@/components/Sheet';
import { TrackRow } from '@/components/TrackRow';
import { PlayIcon, PlusIcon, TrashIcon } from '@/components/Icons';

type GeneratedView = 'favorites';

export function PlaylistsScreen({
  selectedPlaylistId,
  onSelectPlaylist,
  onPlayTrack,
}: {
  selectedPlaylistId: ID | null;
  onSelectPlaylist(playlistId: ID | null): void;
  onPlayTrack(trackId: ID): void;
}) {
  const { playlists, tracks, createPlaylist } = useMusic();
  const [creating, setCreating] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');

  const favorites = tracks.filter((track) => track.isFavorite);
  const recentlyPlayed = [...tracks]
    .sort(
      (a, b) => new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime(),
    )
    .slice(0, 5);

  if (selectedPlaylistId) {
    const playlist = playlists.find((item) => item.id === selectedPlaylistId);
    if (playlist) {
      return (
        <PlaylistDetail
          playlist={playlist}
          onBack={() => onSelectPlaylist(null)}
          onPlayTrack={onPlayTrack}
        />
      );
    }
  }

  return (
    <div className="page">
      <div className="section-heading">
        <h2>Playlists</h2>
        <button
          className="icon-button accent"
          onClick={() => setCreating(true)}
          aria-label="New playlist"
        >
          <PlusIcon />
        </button>
      </div>

      {playlists.length === 0 && favorites.length === 0 && tracks.length === 0 && (
        <div className="empty">
          <h2 className="display" style={{ fontSize: '24px' }}>No playlists yet</h2>
          <p>Create one from your songs, or import music first.</p>
          <ImportButton variant="pill" label="Import Music" />
        </div>
      )}

      <div className="row-list">
        {favorites.length > 0 && (
          <GeneratedRow
            title="Favorites"
            count={favorites.length}
            trackId={favorites[0].id}
            hasArtwork={favorites[0].hasArtwork}
            onOpen={() => onSelectPlaylist('favorites' as ID)}
          />
        )}
        {recentlyPlayed.length > 0 && (
          <GeneratedRow
            title="Recently Played"
            count={recentlyPlayed.length}
            trackId={recentlyPlayed[0].id}
            hasArtwork={recentlyPlayed[0].hasArtwork}
            onOpen={() => onSelectPlaylist('recently-played' as ID)}
          />
        )}
      </div>

      <div className="row-list" style={{ marginTop: 'var(--section-gap)' }}>
        {playlists.map((playlist) => {
          const first = tracks.find((track) => track.id === playlist.trackIds[0]);
          return (
            <button
              key={playlist.id}
              className="track-row"
              onClick={() => onSelectPlaylist(playlist.id)}
            >
              {first ? (
                <Artwork
                  trackId={first.id}
                  hasArtwork={first.hasArtwork}
                  size="46px"
                />
              ) : (
                <span
                  className="artwork"
                  style={{ width: '46px', height: '46px' }}
                  aria-hidden="true"
                >
                  <span className="artwork-glyph">
                    <PlusIcon size={16} />
                  </span>
                </span>
              )}
              <span className="track-row-titles">
                <span
                  className={`track-row-title display ${displayFontClass(playlist.title)}`}
                >
                  {playlist.title}
                </span>
                <span className="track-row-meta">
                  {pluralize(playlist.trackIds.length, 'song')}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      {creating && (
        <Sheet title="New Playlist" onClose={() => setCreating(false)}>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const created = createPlaylist(draftTitle);
              if (created) {
                setCreating(false);
                setDraftTitle('');
                onSelectPlaylist(created.id);
              }
            }}
          >
            <input
              className="text-input"
              type="text"
              placeholder="Playlist name"
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              autoFocus
              aria-label="Playlist name"
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: '12px',
                marginTop: '16px',
              }}
            >
              <button
                type="button"
                className="pill-button"
                onClick={() => {
                  setCreating(false);
                  setDraftTitle('');
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="pill-button primary"
                disabled={draftTitle.trim().length === 0}
              >
                Create
              </button>
            </div>
          </form>
        </Sheet>
      )}
    </div>
  );
}

function GeneratedRow({
  title,
  count,
  trackId,
  hasArtwork,
  onOpen,
}: {
  title: string;
  count: number;
  trackId: ID;
  hasArtwork: boolean;
  onOpen(): void;
}) {
  return (
    <button className="track-row" onClick={onOpen}>
      <Artwork trackId={trackId} hasArtwork={hasArtwork} size="46px" />
      <span className="track-row-titles">
        <span className={`track-row-title display ${displayFontClass(title)}`}>
          {title}
        </span>
        <span className="track-row-meta">{pluralize(count, 'song')}</span>
      </span>
    </button>
  );
}

function PlaylistDetail({
  playlist,
  onBack,
  onPlayTrack,
}: {
  playlist: { id: ID } | { title: string; trackIds: ID[]; id: ID };
  onBack(): void;
  onPlayTrack(trackId: ID): void;
}) {
  const { tracks, current, addTracksToPlaylist, removeTrackFromPlaylist, deletePlaylist } =
    useMusic();
  const [adding, setAdding] = useState(false);

  // Generated views (Favorites / Recently Played) resolve track lists dynamically.
  const isGenerated = !('trackIds' in playlist);
  const resolvedTracks: typeof tracks = isGenerated
    ? playlist.id === 'favorites'
      ? tracks.filter((track) => track.isFavorite)
      : [...tracks].sort(
          (a, b) =>
            new Date(b.dateAdded).getTime() - new Date(a.dateAdded).getTime(),
        )
    : (playlist.trackIds
        .map((id) => tracks.find((track) => track.id === id))
        .filter((track): track is (typeof tracks)[number] => track !== undefined));

  const candidates = tracks.filter(
    (track) => !('trackIds' in playlist) || !playlist.trackIds.includes(track.id),
  );

  return (
    <div className="page">
      <button
        className="track-row"
        style={{ borderTop: 0 }}
        onClick={onBack}
      >
        <span className="icon-button muted" aria-hidden="true">
          <PlayIcon size={18} style={{ transform: 'rotate(180deg)' }} />
        </span>
        <span className="track-row-titles">
          <span className="track-row-meta" style={{ fontSize: '13px' }}>
            Playlists
          </span>
        </span>
      </button>

      <h1 className="page-heading" style={{ marginTop: '4px' }}>
        {'title' in playlist ? playlist.title : 'Playlist'}
      </h1>
      <p className="setting-note" style={{ marginTop: 0 }}>
        {pluralize(resolvedTracks.length, 'song')}
      </p>

      {resolvedTracks.length > 0 && (
        <button
          className="pill-button primary"
          style={{ marginTop: '8px', marginBottom: '4px' }}
          onClick={() => onPlayTrack(resolvedTracks[0].id)}
        >
          <PlayIcon size={16} />
          Play
        </button>
      )}

      <div className="row-list" style={{ marginTop: '12px' }}>
        {resolvedTracks.map((track) => (
          <div key={track.id} style={{ position: 'relative' }}>
            <TrackRow
              track={track}
              active={current?.id === track.id}
              onPlay={onPlayTrack}
              showArtwork
            />
            {/* Removal is only meaningful for editable playlists. */}
            {'trackIds' in playlist && (
              <span
                className="icon-button muted"
                role="button"
                tabIndex={0}
                aria-label={`Remove ${track.title} from playlist`}
                style={{ position: 'absolute', right: '56px', top: '50%', transform: 'translateY(-50%)' }}
                onClick={(event) => {
                  event.stopPropagation();
                  removeTrackFromPlaylist(playlist.id, track.id);
                }}
              >
                <TrashIcon size={18} />
              </span>
            )}
          </div>
        ))}
      </div>

      {resolvedTracks.length === 0 && (
        <div className="empty" style={{ padding: '32px 0' }}>
          <p>This playlist is empty. Add songs from your library.</p>
        </div>
      )}

      {'trackIds' in playlist && (
        <>
          <button
            className="pill-button"
            style={{ marginTop: 'var(--section-gap)' }}
            onClick={() => setAdding(true)}
          >
            <PlusIcon size={16} />
            Add Songs
          </button>
          <button
            className="pill-button"
            style={{ marginTop: '12px', color: 'var(--danger)' }}
            onClick={() => {
              deletePlaylist(playlist.id);
              onBack();
            }}
          >
            <TrashIcon size={16} />
            Delete Playlist
          </button>
        </>
      )}

      {adding && (
        <Sheet title="Add Songs" onClose={() => setAdding(false)}>
          {candidates.length === 0 ? (
            <p className="setting-note">Every track is already in this playlist.</p>
          ) : (
            <div className="row-list">
              {candidates.map((track) => (
                <button
                  key={track.id}
                  className="track-row"
                  onClick={() => {
                    addTracksToPlaylist(playlist.id, [track.id]);
                  }}
                >
                  <Artwork
                    trackId={track.id}
                    hasArtwork={track.hasArtwork}
                    size="46px"
                  />
                  <span className="track-row-titles">
                    <span
                      className={`track-row-title display ${displayFontClass(track.title)}`}
                    >
                      {track.title}
                    </span>
                    <span className="track-row-meta truncate">
                      {track.artistName ?? 'Unknown artist'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Sheet>
      )}
    </div>
  );
}

export type { GeneratedView };
