/**
 * NOIRMusic Web — app shell.
 *
 * Theme application, tab navigation, and the Now Playing overlay. Music
 * state lives entirely in <MusicProvider>; this tree only renders it.
 */

import { useEffect, useState } from 'react';
import { MusicProvider, useMusic } from '@/audio/MusicProvider';
import { ToastProvider } from '@/lib/toast';
import { TabBar, type Tab } from '@/components/TabBar';
import { MiniPlayer } from '@/components/MiniPlayer';
import { LibraryScreen } from '@/screens/LibraryScreen';
import { SearchScreen } from '@/screens/SearchScreen';
import { PlaylistsScreen } from '@/screens/PlaylistsScreen';
import { SettingsScreen } from '@/screens/SettingsScreen';
import { NowPlayingScreen } from '@/screens/NowPlayingScreen';
import type { ID } from '@/audio/models';

function Shell() {
  const { prefs, playTrack } = useMusic();
  const [tab, setTab] = useState<Tab>('library');
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<ID | null>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);

  // Apply the appearance preference to the document root.
  useEffect(() => {
    const root = document.documentElement;
    if (prefs.appearance === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.dataset.theme = prefs.appearance;
    }
    const themeColor = root.dataset.theme;
    if (themeColor === 'dark') {
      document
        .querySelector('meta[name="theme-color"]:not([media])')
        ?.setAttribute('content', '#121110');
    }
  }, [prefs.appearance]);

  const handlePlayTrack = (trackId: ID) => {
    playTrack(trackId);
    setNowPlayingOpen(true);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="brand display">NOIR</span>
        <span className="meta">{screenTitleFor(tab)}</span>
      </header>
      <main className="app-content">
        {tab === 'library' && (
          <LibraryScreen
            onPlayTrack={handlePlayTrack}
            onOpenTrackMenu={() => {
              // Track rows own their own action sheets; this hook exists for
              // future bulk-add flows and stays inert until then.
            }}
          />
        )}
        {tab === 'search' && (
          <SearchScreen
            onPlayTrack={handlePlayTrack}
            onOpenPlaylist={(playlistId) => {
              setTab('playlists');
              setSelectedPlaylistId(playlistId);
            }}
          />
        )}
        {tab === 'playlists' && (
          <PlaylistsScreen
            selectedPlaylistId={selectedPlaylistId}
            onSelectPlaylist={setSelectedPlaylistId}
            onPlayTrack={handlePlayTrack}
          />
        )}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <MiniPlayer onOpen={() => setNowPlayingOpen(true)} />
      <TabBar
        active={tab}
        onChange={(next) => {
          if (next === 'playlists') setSelectedPlaylistId(null);
          setTab(next);
        }}
      />
      {nowPlayingOpen && <NowPlayingScreen onClose={() => setNowPlayingOpen(false)} />}
    </div>
  );
}

function screenTitleFor(tab: Tab): string {
  switch (tab) {
    case 'library':
      return 'Your Library';
    case 'search':
      return 'Search';
    case 'playlists':
      return 'Playlists';
    case 'settings':
      return 'Settings';
  }
}

export default function App() {
  return (
    <ToastProvider>
      <MusicProvider>
        <Shell />
      </MusicProvider>
    </ToastProvider>
  );
}
