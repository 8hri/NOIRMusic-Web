/**
 * NOIR Music — Settings screen (DESIGN.md §2 Settings).
 *
 * Appearance, visualizer options, storage facts, and library controls. Every
 * setting maps to a persisted preference; the storage section states plainly
 * how much room the library takes and what "limited storage mode" means.
 */

import { useState } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import { formatBytes } from '@/lib/format';
import { musicStorageBytes } from '@/audio/library';
import {
  VISUALIZER_MODE_LABELS,
  VISUALIZER_MODE_ORDER,
} from '@/audio/models';
import { Sheet } from '@/components/Sheet';
import { CheckIcon, WarningIcon } from '@/components/Icons';

export function SettingsScreen() {
  const {
    prefs,
    tracks,
    playlists,
    storageLimited,
    setAppearance,
    setVisualizerMode,
    setVisualizerSensitivity,
    setReduceVisualizerMotion,
    clearLibrary,
  } = useMusic();
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <div className="page">
      <div className="section-heading">
        <h2>Settings</h2>
      </div>

      <div className="setting-list">
        <div className="setting-row">
          <span className="setting-label">Appearance</span>
          <div className="segmented" role="group" aria-label="Appearance">
            {(['system', 'light', 'dark'] as const).map((choice) => (
              <button
                key={choice}
                aria-pressed={prefs.appearance === choice}
                onClick={() => setAppearance(choice)}
              >
                {choice === 'system' ? 'Auto' : choice === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="section-heading">
        <h2>Visualizer</h2>
      </div>
      <div className="setting-list">
        <div className="setting-row">
          <span className="setting-label">Mode</span>
          <div className="segmented" role="group" aria-label="Visualizer mode">
            {VISUALIZER_MODE_ORDER.map((mode) => (
              <button
                key={mode}
                aria-pressed={prefs.visualizerMode === mode}
                onClick={() => setVisualizerMode(mode)}
              >
                {VISUALIZER_MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </div>

        <div className="setting-row">
          <span className="setting-label">Sensitivity</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.25}
            value={prefs.visualizerSensitivity}
            onChange={(event) =>
              setVisualizerSensitivity(Number(event.target.value))
            }
            aria-label="Visualizer sensitivity"
            style={{ accentColor: 'var(--accent)' }}
          />
        </div>

        <div className="setting-row">
          <span className="setting-label">Reduce motion</span>
          <button
            className="chip"
            aria-pressed={prefs.reduceVisualizerMotion}
            onClick={() => setReduceVisualizerMotion(!prefs.reduceVisualizerMotion)}
          >
            {prefs.reduceVisualizerMotion ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="section-heading">
        <h2>Library &amp; Storage</h2>
      </div>
      <div className="setting-list">
        <div className="setting-row">
          <span className="setting-label">Tracks</span>
          <span className="setting-note">{tracks.length}</span>
        </div>
        <div className="setting-row">
          <span className="setting-label">Playlists</span>
          <span className="setting-note">{playlists.length}</span>
        </div>
        <div className="setting-row">
          <span className="setting-label">Stored audio</span>
          <span className="setting-note">
            {formatBytes(
              musicStorageBytes({
                schemaVersion: 1,
                tracks,
                playlists,
                prefs,
              }),
            )}
          </span>
        </div>
        {storageLimited && (
          <div
            className="setting-row"
            style={{ color: 'var(--danger)', gap: '10px' }}
          >
            <WarningIcon size={18} />
            <span className="setting-note" style={{ color: 'var(--danger)' }}>
              Private browsing or storage limits are blocking writes. Import
              only small libraries here, or use normal browsing mode.
            </span>
          </div>
        )}
        <div className="setting-row">
          <span className="setting-label">Clear library</span>
          <button
            className="chip"
            style={{ color: 'var(--danger)' }}
            onClick={() => setConfirmingClear(true)}
          >
            Remove all
          </button>
        </div>
      </div>

      <div className="section-heading">
        <h2>About</h2>
      </div>
      <p className="setting-note">
        NOIRMusic is a local-first player. Your audio files are stored in this
        browser only — nothing is uploaded, there is no account, and no backend
        exists. Offline playback and lock-screen controls depend on your
        device's browser support.
      </p>
      <p className="setting-note" style={{ marginTop: '8px' }}>
        Fonts: Instrument Serif &amp; Vazirmatn (OFL 1.1).
      </p>

      {confirmingClear && (
        <Sheet title="Clear library?" onClose={() => setConfirmingClear(false)}>
          <p className="setting-note">
            This permanently removes every track, playlist, and artwork image
            stored in this browser. It cannot be undone.
          </p>
          <div
            style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '12px',
              marginTop: '16px',
            }}
          >
            <button
              className="pill-button"
              onClick={() => setConfirmingClear(false)}
            >
              Cancel
            </button>
            <button
              className="pill-button"
              style={{ color: 'var(--danger)' }}
              onClick={() => {
                setConfirmingClear(false);
                clearLibrary();
              }}
            >
              Clear Everything
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}

export { CheckIcon };
