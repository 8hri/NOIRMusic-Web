/**
 * NOIR Music — the import entry point.
 *
 * A hidden `<input type="file" multiple>` is the only browser-native channel
 * that works reliably on iOS Safari (no drag-drop, no File System Access).
 * `accept` is advisory, not a guarantee: the import pipeline classifies and
 * rejects what the container decoders cannot play.
 */

import { useRef, type ReactNode } from 'react';
import { useMusic } from '@/audio/MusicProvider';
import { PlusIcon } from './Icons';

const ACCEPT_AUDIO =
  '.mp3,.m4a,.aac,.wav,.aif,.aiff,.flac,audio/mpeg,audio/mp4,audio/x-m4a,audio/wav,audio/x-wav,audio/flac,audio/aiff';

export function ImportButton({
  variant = 'pill',
  label = 'Import Music',
  children,
}: {
  variant?: 'pill' | 'icon';
  label?: string;
  children?: ReactNode;
}) {
  const { importFiles } = useMusic();
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT_AUDIO}
        style={{ display: 'none' }}
        onChange={async (event) => {
          const files = event.target.files;
          if (!files || files.length === 0) return;
          await importFiles(Array.from(files));
          // Reset so picking the same file twice still fires a change event.
          event.target.value = '';
        }}
      />
      {variant === 'pill' ? (
        <button
          className="pill-button primary"
          onClick={() => inputRef.current?.click()}
        >
          <PlusIcon size={18} />
          {children ?? label}
        </button>
      ) : (
        <button
          className="icon-button accent"
          onClick={() => inputRef.current?.click()}
          aria-label={label}
        >
          <PlusIcon />
        </button>
      )}
    </>
  );
}
