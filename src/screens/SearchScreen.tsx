/**
 * NOIR Music — Search screen (DESIGN.md §2).
 *
 * Local search over track title / artist / album / filename, with the Songs /
 * Albums / Artists / Playlists filters. Query and filter survive navigation by
 * living in the app-level screen state. No spinners — local data is instant.
 */

import { useMemo, useState } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import type { ID } from '@/audio/models';
import { displayFontClass } from '@/lib/format';
import { TrackRow } from '@/components/TrackRow';

type Filter = 'songs' | 'albums' | 'artists' | 'playlists';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'songs', label: 'Songs' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'playlists', label: 'Playlists' },
];

export function SearchScreen({
  onPlayTrack,
  onOpenPlaylist,
}: {
  onPlayTrack(trackId: ID): void;
  onOpenPlaylist(playlistId: ID): void;
}) {
  const { tracks, playlists, current, playTrack } = useMusic();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('songs');

  const needle = query.trim().toLowerCase();

  const songResults = useMemo(() => {
    if (!needle) return [];
    return tracks.filter((track) =>
      [track.title, track.artistName, track.albumTitle, track.fileName]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [tracks, needle]);

  const albums = useMemo(() => {
    if (!needle) return [];
    const seen = new Set<string>();
    const results: Array<{ album: string; artist?: string; count: number; trackId: ID }> = [];
    for (const track of tracks) {
      if (!track.albumTitle) continue;
      const album = track.albumTitle;
      if (!album.toLowerCase().includes(needle) && !needle) continue;
      if (seen.has(album.toLowerCase())) continue;
      if (
        !album.toLowerCase().includes(needle) &&
        !(track.artistName ?? '').toLowerCase().includes(needle)
      ) {
        continue;
      }
      seen.add(album.toLowerCase());
      results.push({
        album,
        artist: track.artistName,
        count: tracks.filter((item) => item.albumTitle === album).length,
        trackId: track.id,
      });
    }
    return results;
  }, [tracks, needle]);

  const artists = useMemo(() => {
    if (!needle) return [];
    const seen = new Map<string, number>();
    for (const track of tracks) {
      const artist = track.artistName?.trim();
      if (!artist) continue;
      if (!artist.toLowerCase().includes(needle)) continue;
      seen.set(artist, (seen.get(artist) ?? 0) + 1);
    }
    return Array.from(seen.entries())
      .map(([name, count]) => ({ name, count, trackId: tracks.find((t) => t.artistName === name)?.id }))
      .filter((entry): entry is { name: string; count: number; trackId: ID } => Boolean(entry.trackId));
  }, [tracks, needle]);

  const playlistResults = useMemo(() => {
    if (!needle) return [];
    return playlists.filter((playlist) =>
      playlist.title.toLowerCase().includes(needle),
    );
  }, [playlists, needle]);

  return (
    <div className="page">
      <input
        className="text-input"
        type="search"
        inputMode="search"
        placeholder="Songs, artists, albums, playlists"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        aria-label="Search your library"
      />
      <div className="chips" role="group" aria-label="Search filters">
        {FILTERS.map((candidate) => (
          <button
            key={candidate.id}
            className="chip"
            aria-pressed={filter === candidate.id}
            onClick={() => setFilter(candidate.id)}
          >
            {candidate.label}
          </button>
        ))}
      </div>

      {!needle && (
        <div className="empty">
          <h2 className="display" style={{ fontSize: '24px' }}>
            Search your library
          </h2>
          <p>Type to find tracks, albums, artists, and playlists.</p>
        </div>
      )}

      {needle && filter === 'songs' && (
        <Results
          empty="No songs match."
          count={songResults.length}
        >
          {songResults.map((track) => (
            <TrackRow
              key={track.id}
              track={track}
              active={current?.id === track.id}
              onPlay={onPlayTrack}
            />
          ))}
        </Results>
      )}

      {needle && filter === 'albums' && (
        <Results empty="No albums match." count={albums.length}>
          {albums.map((entry) => (
            <button
              key={entry.album}
              className="track-row"
              onClick={() => playTrack(entry.trackId)}
            >
              <span className="track-row-titles">
                <span className={`track-row-title display ${displayFontClass(entry.album)}`}>
                  {entry.album}
                </span>
                <span className="track-row-meta">
                  {entry.artist ?? 'Unknown artist'} · {entry.count} song{entry.count > 1 ? 's' : ''}
                </span>
              </span>
            </button>
          ))}
        </Results>
      )}

      {needle && filter === 'artists' && (
        <Results empty="No artists match." count={artists.length}>
          {artists.map((entry) => (
            <button
              key={entry.name}
              className="track-row"
              onClick={() => playTrack(entry.trackId)}
            >
              <span className="track-row-titles">
                <span className={`track-row-title display ${displayFontClass(entry.name)}`}>
                  {entry.name}
                </span>
                <span className="track-row-meta">{entry.count} song{entry.count > 1 ? 's' : ''}</span>
              </span>
            </button>
          ))}
        </Results>
      )}

      {needle && filter === 'playlists' && (
        <Results empty="No playlists match." count={playlistResults.length}>
          {playlistResults.map((playlist) => (
            <button
              key={playlist.id}
              className="track-row"
              onClick={() => onOpenPlaylist(playlist.id)}
            >
              <span className="track-row-titles">
                <span className={`track-row-title display ${displayFontClass(playlist.title)}`}>
                  {playlist.title}
                </span>
                <span className="track-row-meta">
                  {playlist.trackIds.length} song{playlist.trackIds.length > 1 ? 's' : ''}
                </span>
              </span>
            </button>
          ))}
        </Results>
      )}
    </div>
  );
}

function Results({
  empty,
  count,
  children,
}: {
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) {
    return (
      <div className="empty" style={{ padding: '40px 0' }}>
        <p>{empty}</p>
      </div>
    );
  }
  return <div className="row-list">{children}</div>;
}
