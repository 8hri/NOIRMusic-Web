/**
 * NOIR Music — tab bar (the four primary destinations, DESIGN.md §2).
 */

import {
  MusicNoteIcon,
  PlaylistsIcon,
  SearchIcon,
  SlidersIcon,
} from './Icons';

export type Tab = 'library' | 'search' | 'playlists' | 'settings';

export const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof MusicNoteIcon }> = [
  { id: 'library', label: 'Library', icon: MusicNoteIcon },
  { id: 'search', label: 'Search', icon: SearchIcon },
  { id: 'playlists', label: 'Playlists', icon: PlaylistsIcon },
  { id: 'settings', label: 'Settings', icon: SlidersIcon },
];

export function TabBar({
  active,
  onChange,
}: {
  active: Tab;
  onChange(tab: Tab): void;
}) {
  return (
    <nav className="tabbar" aria-label="Primary">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            className={`tabbar-item${selected ? ' selected' : ''}`}
            aria-current={selected ? 'page' : undefined}
            onClick={() => onChange(tab.id)}
          >
            <Icon size={23} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
