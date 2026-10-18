/**
 * NOIR Music — artwork tile.
 *
 * The native `ArtworkView` pattern: a `surface2` square with a muted-amber
 * glyph fallback whenever there is no embedded cover. Artwork blobs are read
 * lazily from IndexedDB and cached as object URLs, one per track id.
 */

import { useEffect, useState } from 'react';
import type { ID } from '@/audio/models';
import { getArtwork } from '@/audio/library';
import { MusicNoteIcon } from './Icons';

const urlCache = new Map<ID, string>();

export function Artwork({
  trackId,
  hasArtwork,
  size,
  unavailable = false,
}: {
  trackId: ID;
  hasArtwork: boolean;
  /** CSS length, e.g. "46px" or "min(74vw, 340px)". */
  size: string;
  unavailable?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasArtwork) {
      setUrl(null);
      return;
    }
    let cancelled = false;
    const cached = urlCache.get(trackId);
    if (cached) {
      setUrl(cached);
      return;
    }
    void getArtwork(trackId)
      .then((blob) => {
        if (cancelled || !blob) return;
        const objectUrl = URL.createObjectURL(blob);
        urlCache.set(trackId, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [trackId, hasArtwork]);

  return (
    <span
      className={`artwork${unavailable ? ' artwork-unavailable' : ''}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {url ? (
        <img src={url} alt="" draggable={false} />
      ) : (
        <span className="artwork-glyph">
          <MusicNoteIcon size={scaleGlyph(size)} />
        </span>
      )}
    </span>
  );
}

/** Glyph is ~34% of the tile, like the native component. */
function scaleGlyph(size: string): number {
  const parsed = parseFloat(size);
  if (Number.isFinite(parsed)) return Math.round(parsed * 0.34);
  return 24;
}
