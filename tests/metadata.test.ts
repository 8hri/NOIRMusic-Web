/**
 * NOIR Music — embedded metadata parser tests.
 *
 * Builds synthetic ID3v2.3 / ID3v2.2 / FLAC / MP4 buffers and verifies the
 * parser reads text frames and cover art and ignores malformed tags.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseId3, parseFlac, parseMp4 } from '../src/audio/metadata';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/** Minimal ID3v2.3 tag: header + text frame(s) + optional APIC. */
function buildId3v23(
  frames: Array<{ id: string; payload: Uint8Array }>,
): Uint8Array {
  const body: number[] = [];
  for (const frame of frames) {
    const idBytes = encoder.encode(frame.id);
    if (idBytes.length !== 4) throw new Error('v2.3 frame ids are 4 chars');
    body.push(...idBytes);
    body.push(...u32be(frame.payload.length));
    body.push(0, 0); // flags
    body.push(...frame.payload);
  }
  const header = [
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00, // version 2.3
    0x00, // flags
    ...synchsafe(body.length, 4),
  ];
  return Uint8Array.from([...header, ...body]);
}

function buildId3v22(
  frames: Array<{ id: string; payload: Uint8Array }>,
): Uint8Array {
  const body: number[] = [];
  for (const frame of frames) {
    const idBytes = encoder.encode(frame.id);
    if (idBytes.length !== 3) throw new Error('v2.2 frame ids are 3 chars');
    body.push(...idBytes);
    body.push(...u24be(frame.payload.length));
    body.push(...frame.payload);
  }
  const header = [0x49, 0x44, 0x33, 0x02, 0x00, 0x00, ...synchsafe(body.length, 4)];
  return Uint8Array.from([...header, ...body]);
}

/** Text frame body: encoding byte + string. */
function frameText(text: string, encoding = 0): Uint8Array {
  const bytes = encoder.encode(text);
  return Uint8Array.from([encoding, ...bytes]);
}

function framePicture(mime: string, data: Uint8Array): Uint8Array {
  const mimeBytes = encoder.encode(mime);
  const parts = [
    0x00, // encoding ISO-8859-1
    ...mimeBytes,
    0x00, // mime terminator
    0x03, // picture type: front cover
    ...encoder.encode('Cover'),
    0x00, // description terminator
    ...data,
  ];
  return Uint8Array.from(parts);
}

const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

function u32be(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function u24be(value: number): number[] {
  return [(value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

function synchsafe(value: number, count: number): number[] {
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    out[i] = value & 0x7f;
    value >>>= 7;
  }
  return out;
}

// ---------------------------------------------------------------------------
// ID3
// ---------------------------------------------------------------------------

test('ID3v2.3: reads title, artist, and album', () => {
  const bytes = buildId3v23([
    { id: 'TIT2', payload: frameText('Nightfall') },
    { id: 'TPE1', payload: frameText('The Feed Quartet') },
    { id: 'TALB', payload: frameText('Quiet Rooms') },
  ]);
  const meta = parseId3(bytes, 0);
  assert.equal(meta?.title, 'Nightfall');
  assert.equal(meta?.artist, 'The Feed Quartet');
  assert.equal(meta?.album, 'Quiet Rooms');
});

test('ID3v2.3: reads UTF-8 text frames', () => {
  const bytes = buildId3v23([
    { id: 'TIT2', payload: frameText('شب', 3) },
  ]);
  assert.equal(parseId3(bytes, 0)?.title, 'شب');
});

test('ID3v2.3: extracts JPEG artwork and validates the signature', () => {
  const bytes = buildId3v23([
    { id: 'APIC', payload: framePicture('image/jpeg', JPEG) },
  ]);
  const artwork = parseId3(bytes, 0)?.artwork;
  assert.equal(artwork?.type, 'image/jpeg');
});

test('ID3v2.3: rejects artwork whose bytes are not an image', () => {
  const garbage = Uint8Array.from([0x01, 0x02, 0x03, 0x04]);
  const bytes = buildId3v23([
    { id: 'APIC', payload: framePicture('image/png', garbage) },
  ]);
  assert.equal(parseId3(bytes, 0)?.artwork, undefined);
});

test('ID3v2.2: reads legacy 3-char frames (TT2/TP1)', () => {
  const bytes = buildId3v22([
    { id: 'TT2', payload: frameText('Old Eyes') },
    { id: 'TP1', payload: frameText('Brass Index') },
  ]);
  const meta = parseId3(bytes, 0);
  assert.equal(meta?.title, 'Old Eyes');
  assert.equal(meta?.artist, 'Brass Index');
});

test('ID3v2.4: synchsafe frame sizes parse', () => {
  // Same builder cannot emit v2.4 directly; craft one frame by hand.
  const payload = frameText('Quarter');
  const body: number[] = [
    ...encoder.encode('TIT2'),
    ...synchsafe(payload.length, 4),
    0x00, 0x00,
    ...payload,
  ];
  const header = [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, ...synchsafe(body.length, 4)];
  const meta = parseId3(Uint8Array.from([...header, ...body]), 0);
  assert.equal(meta?.title, 'Quarter');
});

test('Garbage input returns null instead of throwing', () => {
  assert.equal(parseId3(Uint8Array.from([1, 2, 3, 4]), 0), null);
  assert.equal(parseId3(Uint8Array.from([]), 0), null);
});

test('Truncated tag body yields whatever survived', () => {
  const bytes = buildId3v23([{ id: 'TIT2', payload: frameText('Half') }]);
  // Slice the tail: the header declares more body than present.
  const truncated = bytes.slice(0, bytes.length - 2);
  const meta = parseId3(truncated, 0);
  // The frame's declared size exceeds the buffer, so the walk stops; the
  // result may be the partial tag or null, but never a throw.
  assert.ok(meta === null || meta.title === 'Half');
});

// ---------------------------------------------------------------------------
// FLAC
// ---------------------------------------------------------------------------

/** Synthetic FLAC: "fLaC" + one VORBIS_COMMENT block marked last. */
function buildFlac(comments: Array<[string, string]>): Uint8Array {
  const vendor = encoder.encode('libFLAC 1.4');
  const body: number[] = [
    ...u32le(vendor.length),
    ...vendor,
    ...u32le(comments.length),
  ];
  for (const [key, value] of comments) {
    const entry = encoder.encode(`${key}=${value}`);
    body.push(...u32le(entry.length));
    body.push(...entry);
  }
  const header = [
    0x66, 0x4c, 0x61, 0x43, // "fLaC"
    0x80 | 4, // last-block flag + VORBIS_COMMENT
    ...u24be(body.length),
  ];
  return Uint8Array.from([...header, ...body]);
}

function u32le(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

test('FLAC: reads Vorbis comments', () => {
  const bytes = buildFlac([
    ['TITLE', 'Cold Open'],
    ['ARTIST', 'Nora Lumen'],
    ['ALBUM', 'Bright Windows'],
  ]);
  const meta = parseFlac(bytes);
  assert.equal(meta?.title, 'Cold Open');
  assert.equal(meta?.artist, 'Nora Lumen');
  assert.equal(meta?.album, 'Bright Windows');
});

test('FLAC: no comment block returns null', () => {
  const header = Uint8Array.from([
    0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 0, 0,
  ]);
  assert.equal(parseFlac(header), null);
});

test('FLAC: non-FLAC buffer returns null', () => {
  assert.equal(parseFlac(Uint8Array.from([0x49, 0x44, 0x33, 0x03])), null);
});

// ---------------------------------------------------------------------------
// MP4
// ---------------------------------------------------------------------------

/**
 * Atom types are four raw bytes. The iTunes tag names use the
 * Latin-1 copyright sign (0xA9), so a UTF-8 encoder would corrupt them.
 */
function fourCharCode(type: string): number[] {
  return [...type].map((char) => char.charCodeAt(0));
}

function atom(type: string, body: Array<number | number[]>): number[] {
  const flat = body.flatMap((item) => (Array.isArray(item) ? item : [item]));
  const size = 8 + flat.length;
  return [...u32be(size), ...fourCharCode(type), ...flat];
}

/** Synthetic M4A: ftyp → moov → udta → meta → ilst → ©nam/©ART/©alb. */
function buildM4a(): Uint8Array {
  const dataAtom = (payload: number[]) =>
    atom('data', [...u32be(1), ...u32be(0), ...payload]);
  const ilst = atom('ilst', [
    atom('©nam', dataAtom([...encoder.encode('Paper Moon')])),
    atom('©ART', dataAtom([...encoder.encode('The Ivory Set')])),
    atom('©alb', dataAtom([...encoder.encode('Small Hours')])),
  ]);
  const meta = atom('meta', [...u32be(0), ...ilst]);
  const moov = atom('moov', [...atom('udta', [...meta])]);
  const ftyp = atom('ftyp', [...encoder.encode('M4A ')]);
  return Uint8Array.from([...ftyp, ...moov]);
}

test('MP4: reads the iTunes ilst chain', () => {
  const meta = parseMp4(buildM4a());
  assert.equal(meta?.title, 'Paper Moon');
  assert.equal(meta?.artist, 'The Ivory Set');
  assert.equal(meta?.album, 'Small Hours');
});

test('MP4: missing udta returns null', () => {
  const ftypOnly = Uint8Array.from(atom('ftyp', [...encoder.encode('M4A ')]));
  assert.equal(parseMp4(ftypOnly), null);
});
