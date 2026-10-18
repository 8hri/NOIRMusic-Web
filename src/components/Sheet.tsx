/**
 * NOIR Music — bottom sheet.
 *
 * A fixed overlay with a backdrop, a grab handle, and a scrollable body. Same
 * affordance as the native `QueueSheet` / `AddTracksSheet` modal presentations.
 */

import { type ReactNode, useEffect } from 'react';
import { CloseIcon } from './Icons';

export function Sheet({
  title,
  onClose,
  children,
  closeLabel = 'Close',
}: {
  title?: string;
  onClose(): void;
  children: ReactNode;
  closeLabel?: string;
}) {
  // Backdrop tap and Escape both dismiss; a hardware back is the platform's.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-handle" />
        {title && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 var(--inset)',
            }}
          >
            <h2 className="sheet-title" style={{ margin: 0, padding: 0 }}>
              {title}
            </h2>
            <button
              className="icon-button muted"
              onClick={onClose}
              aria-label={closeLabel}
            >
              <CloseIcon size={20} />
            </button>
          </div>
        )}
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
