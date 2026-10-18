/**
 * NOIR Music — embedded metadata parsing (ID3, MP4/iTunes, FLAC).
 *
 * The web app has no backend and no dependency on a tag library, so this
 * module reads the common container formats directly:
 *
 *   - MP3 (and the ID3 chunk some WAV/AIFF writers emit) → ID3v2.2 / 2.3 / 2.4
 *   - M4A / AAC / MP4  → the `moov → udta → meta → ilst` iTunes atom chain
 *   - FLAC             → VORBIS_COMMENT (+ PICTURE) metadata blocks
 *
 * Parsing is strictly best effort: a malformed or truncated tag resolves to
 * `null` or a partial result, and the import pipeline falls back to the
 * filename. Metadata is decoration — it must never block a playable file.
 */

export interface TrackMetadata {
  title?: string;
  artist?: string;
  album?: string;
  /** Decoded embedded artwork, validated against a known image signature. */
  artwork?: Blob;
}

/** Read at most this many bytes from the head of a file when tag hunting. */
const HEAD_BYTES = 2 * 1024 * 1024;

const IMAGE_SIGNATURES: ReadonlyArray<readonly [string, number[]]> = [
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47]],
  ['image/webp', [0x52, 0x49, 0x46, 0x46]],
  ['image/gif', [0x47, 0x49, 0x46]],
];

/** Validates raw picture bytes against a known signature; returns a Blob. */
function artworkBlob(bytes: Uint8Array, declaredMime: string | undefined): Blob | undefined {
  const mime = declaredMime?.toLowerCase().split('/')[1];
  for (const [type, signature] of IMAGE_SIGNATURES) {
    if (bytes.length < signature.length) continue;
    const matches = signature.every(
      (byte, index) => bytes[index] === byte,
    );
    if (matches) {
      return new Blob([bytes.slice().buffer], { type });
    }
    if (mime && type.endsWith(mime)) return undefined;
  }
  // HEIC/HEIF artwork from modern rips has no magic handled above; keep it
  // only when the tag declared an image type explicitly.
  if (mime && (mime === 'heic' || mime === 'heif' || mime === 'avif')) {
    return new Blob([bytes.slice().buffer], { type: `image/${mime}` });
  }
  return undefined;
}

function decodeText(bytes: Uint8Array, encoding: number): string {
  try {
    if (encoding === 1) {
      // UTF-16 with BOM
      return new TextDecoder('utf-16').decode(bytes);
    }
    if (encoding === 2) return new TextDecoder('utf-16be').decode(bytes);
    if (encoding === 3) return new TextDecoder('utf-8').decode(bytes);
    return new TextDecoder('iso-8859-1').decode(bytes);
  } catch {
    return '';
  }
}

function clean(value: string): string | undefined {
  const trimmed = value.replace(/\0+$/, '').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses embedded metadata for one file. Resolves to `null` when the
 * container has no readable tag; the caller then falls back gracefully.
 */
export async function parseTrackMetadata(
  file: File,
): Promise<TrackMetadata | null> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const head = file.slice(0, HEAD_BYTES);
  let buffer: ArrayBuffer;
  try {
    buffer = await head.arrayBuffer();
  } catch {
    return null;
  }
  const bytes = new Uint8Array(buffer);

  if (extension === 'flac') return parseFlac(bytes);
  if (extension === 'mp3') return parseId3(bytes, 0);
  if (extension === 'm4a' || extension === 'aac' || extension === 'mp4') {
    return parseMp4(bytes);
  }
  // wav / aif / aiff: ID3 chunk lives at an arbitrary offset — search.
  if (extension === 'wav' || extension === 'aif' || extension === 'aiff') {
    const offset = findId3(bytes);
    if (offset >= 0) return parseId3(bytes, offset);
    return null;
  }
  return null;
}

function findId3(bytes: Uint8Array): number {
  // Naive scan; tags sit near the head in practice.
  const limit = Math.min(bytes.length, 256 * 1024) - 3;
  for (let i = 0; i < limit; i += 1) {
    if (
      bytes[i] === 0x49 && // I
      bytes[i + 1] === 0x44 && // D
      bytes[i + 2] === 0x33 // 3
    ) {
      return i;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// ID3v2
// ---------------------------------------------------------------------------

/** Synchsafe integer: 7 bits per byte, MSB first. */
function synchsafe(bytes: Uint8Array, offset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    value = (value << 7) | (bytes[offset + i] & 0x7f);
  }
  return value;
}

function integer(bytes: Uint8Array, offset: number, count: number): number {
  let value = 0;
  for (let i = 0; i < count; i += 1) {
    value = (value << 8) | bytes[offset + i];
  }
  return value;
}

/** Reverses ID3v2 unsynchronisation: drop 0x00 that follows 0xFF. */
function deunsynchronise(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    out.push(bytes[i]);
    if (bytes[i] === 0xff && i + 1 < bytes.length && bytes[i + 1] === 0x00) {
      i += 1;
    }
  }
  return Uint8Array.from(out);
}

export function parseId3(bytes: Uint8Array, offset: number): TrackMetadata | null {
  const view = bytes;
  if (offset + 10 > view.length) return null;
  if (
    view[offset] !== 0x49 ||
    view[offset + 1] !== 0x44 ||
    view[offset + 2] !== 0x33
  ) {
    return null;
  }
  const major = view[offset + 3];
  if (major !== 2 && major !== 3 && major !== 4) return null;
  const flags = view[offset + 5];
  const tagSize = synchsafe(view, offset + 6, 4);
  let cursor = offset + 10;
  const tagEnd = Math.min(cursor + tagSize, view.length);

  let body: Uint8Array = view.slice(cursor, tagEnd);
  if (flags & 0x80) {
    body = deunsynchronise(body);
  }
  // Extended header: skip (v2.3/2.4 sizes differ; both are safe to pass).
  if (flags & 0x40) {
    if (body.length < 4) return null;
    const extSize = major === 4
      ? synchsafe(body, 0, 4)
      : integer(body, 0, 4);
    if (extSize + 4 > body.length) return null;
    body = body.slice(extSize + 4);
  }

  const meta: TrackMetadata = {};
  const isV2 = major === 2;
  const frameIdLength = isV2 ? 3 : 4;
  cursor = 0;

  while (cursor + frameIdLength + (isV2 ? 3 : 4) <= body.length) {
    const id = String.fromCharCode(
      ...body.slice(cursor, cursor + frameIdLength),
    );
    if (!/^[A-Z0-9©]+$/.test(id)) break;

    let size: number;
    let frameFlags = 0;
    if (isV2) {
      size = integer(body, cursor + 3, 3);
    } else if (major === 4) {
      size = synchsafe(body, cursor + 4, 4);
      frameFlags = integer(body, cursor + 8, 2);
    } else {
      size = integer(body, cursor + 4, 4);
      frameFlags = integer(body, cursor + 8, 2);
    }
    const headerLength = isV2 ? frameIdLength + 3 : frameIdLength + 6;
    cursor += headerLength; // id + size (+ 2 flag bytes in v2.3/v2.4)

    if (size <= 0 || cursor + size > body.length) break;

    let frame: Uint8Array = body.slice(cursor, cursor + size);
    cursor += size;

    if (major === 4 && frameFlags & 0x01) {
      frame = deunsynchronise(frame);
    }

    if (id === 'TIT2' || id === 'TT2') {
      const value = readTextFrame(frame);
      if (value) meta.title = value;
    } else if (id === 'TPE1' || id === 'TP1') {
      const value = readTextFrame(frame);
      if (value) meta.artist = value;
    } else if (id === 'TALB' || id === 'TAL') {
      const value = readTextFrame(frame);
      if (value) meta.album = value;
    } else if (id === 'APIC' || id === 'PIC') {
      const artwork = readPictureFrame(frame, id === 'PIC');
      if (artwork && !meta.artwork) meta.artwork = artwork;
    }
  }

  return hasAny(meta) ? meta : null;
}

function readTextFrame(frame: Uint8Array): string | undefined {
  if (frame.length < 1) return undefined;
  const encoding = frame[0];
  return clean(decodeText(frame.slice(1), encoding));
}

function readPictureFrame(
  frame: Uint8Array,
  legacy: boolean,
): Blob | undefined {
  if (frame.length < 4) return undefined;
  const encoding = frame[0];
  let cursor = 1;
  const isUtf16 = encoding === 1 || encoding === 2;

  if (legacy) {
    // v2.2 PIC: 3-char image format, 1 byte picture type, description.
    const format = decodeText(frame.slice(cursor, cursor + 3), 0).toLowerCase();
    cursor += 3;
    cursor += 1; // picture type
    const terminator = isUtf16 ? [0x00, 0x00] : [0x00];
    const descEnd = findTerminator(frame, cursor, terminator);
    if (descEnd < 0) return undefined;
    cursor = descEnd + terminator.length;
    const data = frame.slice(cursor);
    const mime = format === 'jpg' ? 'image/jpeg' : `image/${format}`;
    return artworkBlob(data, mime);
  }

  // v2.3/2.4 APIC: MIME \0, picture type, description \0, data.
  const mimeEnd = findTerminator(frame, cursor, [0x00]);
  if (mimeEnd < 0) return undefined;
  const mime = decodeText(frame.slice(cursor, mimeEnd), 0);
  cursor = mimeEnd + 1;
  if (cursor >= frame.length) return undefined;
  cursor += 1; // picture type
  const terminator = isUtf16 ? [0x00, 0x00] : [0x00];
  const descEnd = findTerminator(frame, cursor, terminator);
  if (descEnd < 0) return undefined;
  cursor = descEnd + terminator.length;
  const data = frame.slice(cursor);
  return artworkBlob(data, mime || undefined);
}

function findTerminator(
  frame: Uint8Array,
  start: number,
  terminator: ReadonlyArray<number>,
): number {
  for (let i = start; i <= frame.length - terminator.length; i += 1) {
    let matches = true;
    for (let j = 0; j < terminator.length; j += 1) {
      if (frame[i + j] !== terminator[j]) {
        matches = false;
        break;
      }
    }
    if (matches) return i;
  }
  return -1;
}

function hasAny(meta: TrackMetadata): boolean {
  return Boolean(meta.title || meta.artist || meta.album || meta.artwork);
}

// ---------------------------------------------------------------------------
// MP4 / iTunes atoms
// ---------------------------------------------------------------------------

interface Atom {
  type: string;
  start: number; // header position
  body: number; // body start
  end: number; // body end (exclusive)
}

function readAtom(bytes: Uint8Array, offset: number): Atom | null {
  if (offset + 8 > bytes.length) return null;
  let size = integer(bytes, offset, 4);
  const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
  let body = offset + 8;
  if (size === 1) {
    // 64-bit extended size
    if (offset + 16 > bytes.length) return null;
    const high = integer(bytes, offset + 8, 4);
    const low = integer(bytes, offset + 12, 4);
    if (high !== 0) return null; // >4GB atom; not realistic here
    size = low;
    body = offset + 16;
  } else if (size === 0) {
    // extends to end of file
    size = bytes.length - offset;
  }
  if (size < 8) return null;
  const end = Math.min(offset + size, bytes.length);
  return { type, start: offset, body, end };
}

/** Finds the first atom of `type` among the direct children of a parent body. */
function findAtom(bytes: Uint8Array, parent: Atom, type: string): Atom | null {
  for (let offset = parent.body; offset < parent.end; ) {
    const atom = readAtom(bytes, offset);
    if (!atom) break;
    if (atom.type === type) return atom;
    offset = atom.end;
  }
  return null;
}

export function parseMp4(bytes: Uint8Array): TrackMetadata | null {
  const ftyp = readAtom(bytes, 0);
  if (!ftyp) return null;

  const walkUdta = (container: Atom, depth: number): Atom | null => {
    if (depth > 4) return null;
    if (container.type === 'udta') return container;
    for (let offset = container.body; offset < container.end; ) {
      const atom = readAtom(bytes, offset);
      if (!atom) break;
      const found = walkUdta(atom, depth + 1);
      if (found) return found;
      offset = atom.end;
    }
    return null;
  };

  const moov = findAtom(bytes, ftyp, 'moov') ?? (() => {
    // Search the whole buffer for moov if the naive parent walk fails.
    for (let offset = 0; offset + 8 < bytes.length; ) {
      const atom = readAtom(bytes, offset);
      if (!atom) break;
      if (atom.type === 'moov') return atom;
      offset = atom.end;
    }
    return null;
  })();
  if (!moov) return null;

  const udta = walkUdta(moov, 0);
  if (!udta) return null;

  const meta = findAtom(bytes, udta, 'meta');
  if (!meta) return null;

  const ilst = findAtom(bytes, { ...meta, body: meta.body + 4 }, 'ilst');
  if (!ilst) return null;

  const out: TrackMetadata = {};
  for (let offset = ilst.body; offset < ilst.end; ) {
    const tag = readAtom(bytes, offset);
    if (!tag) break;
    const data = findAtom(bytes, tag, 'data');
    if (data) {
      const payload = bytes.slice(data.body + 8, data.end);
      if (tag.type === '©nam') {
        const value = clean(decodeText(payload, 3));
        if (value) out.title = value;
      } else if (tag.type === '©ART') {
        const value = clean(decodeText(payload, 3));
        if (value) out.artist = value;
      } else if (tag.type === '©alb') {
        const value = clean(decodeText(payload, 3));
        if (value) out.album = value;
      } else if (tag.type === 'covr') {
        const artwork = artworkBlob(payload.slice(1), undefined);
        if (artwork && !out.artwork) out.artwork = artwork;
      }
    }
    offset = tag.end;
  }

  return hasAny(out) ? out : null;
}

// ---------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------

export function parseFlac(bytes: Uint8Array): TrackMetadata | null {
  if (bytes.length < 4 + 4) return null;
  if (
    bytes[0] !== 0x66 || bytes[1] !== 0x4c || bytes[2] !== 0x61 || bytes[3] !== 0x43 // "fLaC"
  ) {
    return null;
  }

  const meta: TrackMetadata = {};
  let offset = 4;

  while (offset + 4 <= bytes.length) {
    const header = bytes[offset];
    const isLast = (header & 0x80) !== 0;
    const type = header & 0x7f;
    const size = integer(bytes, offset + 1, 3);
    offset += 4;
    if (offset + size > bytes.length) break;

    const block = bytes.slice(offset, offset + size);

    if (type === 4) {
      // VORBIS_COMMENT (little-endian counts, UTF-8 strings)
      let cursor = 0;
      const vendorLength = readUint32LE(block, cursor);
      cursor += 4;
      if (cursor + vendorLength > block.length) break;
      cursor += vendorLength;
      if (cursor + 4 > block.length) break;
      const count = readUint32LE(block, cursor);
      cursor += 4;
      for (let i = 0; i < count && cursor + 4 <= block.length; i += 1) {
        const length = readUint32LE(block, cursor);
        cursor += 4;
        if (cursor + length > block.length) break;
        const entry = decodeText(block.slice(cursor, cursor + length), 3);
        cursor += length;
        const equals = entry.indexOf('=');
        if (equals <= 0) continue;
        const key = entry.slice(0, equals).toUpperCase();
        const value = clean(entry.slice(equals + 1));
        if (!value) continue;
        if (key === 'TITLE' && !meta.title) meta.title = value;
        else if (key === 'ARTIST' && !meta.artist) meta.artist = value;
        else if (key === 'ALBUM' && !meta.album) meta.album = value;
      }
    } else if (type === 6) {
      // PICTURE: type, mime, description, dimensions, then data
      let cursor = 4; // picture type
      if (cursor + 4 > block.length) break;
      const mimeLength = readUint32BE(block, cursor);
      cursor += 4;
      if (cursor + mimeLength > block.length) break;
      const mime = decodeText(block.slice(cursor, cursor + mimeLength), 3);
      cursor += mimeLength;
      if (cursor + 4 > block.length) break;
      const descLength = readUint32BE(block, cursor);
      cursor += 4;
      if (cursor + descLength + 16 > block.length) break;
      cursor += descLength;
      cursor += 16; // width, height, color depth, color count
      if (cursor + 4 > block.length) break;
      const dataLength = readUint32BE(block, cursor);
      cursor += 4;
      if (cursor + dataLength > block.length) break;
      const artwork = artworkBlob(block.slice(cursor, cursor + dataLength), mime || undefined);
      if (artwork && !meta.artwork) meta.artwork = artwork;
    }

    if (isLast) break;
    offset += size;
  }

  return hasAny(meta) ? meta : null;
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  );
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) return 0;
  return (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  );
}
