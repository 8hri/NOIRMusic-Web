# NOIRMusic Web

A local-first music player as an installable Progressive Web App. Import your
audio files from the browser; they stay on your device. No account, no backend,
no upload, no analytics.

This repository is the web counterpart of the native iOS app
[`8hri/NoirMusic`](https://github.com/8hri/NoirMusic), built to be usable on an
iPhone without a Mac, a paid developer membership, or any app signing. The
native project remains the reference and the fallback.

## What was reused from the native app

| Native (Swift)                     | Web (TypeScript)                 | How                                   |
| ---------------------------------- | -------------------------------- | ------------------------------------- |
| `Track.swift` / `Playlist.swift`   | `src/audio/models.ts`            | Ported field-for-field (minus file-system-only fields) |
| `PlaybackQueue.swift`              | `src/audio/queue.ts`             | Pure-function port; identical rules, 100% of the ported rule set is unit-tested |
| `ImportService.swift` (dedup)      | `src/audio/library.ts`           | SHA-256 content hash via SubtleCrypto; same duplicate semantics |
| `AudioPlayerController` / `AnalyserProvider` | `src/audio/audioEngine.ts` | Rewritten on `HTMLAudioElement` + Web Audio `AnalyserNode` |
| `VisualizerModel.swift`            | `src/audio/visualizerModel.ts`   | Ported presentation math (scale/aggregate/palette) |
| `Theme.swift` design tokens        | `src/styles/tokens.css`          | Exact hex values, both appearances |
| Instrument Serif + Vazirmatn fonts | `public/fonts/` (OFL 1.1)        | Same files, served locally |
| Approved 1024×1024 app icon        | `public/icons/*`                 | Rasterized by `npm run icons` from `assets/appicon-1024.png` |
| `DESIGN.md` IA and principles      | Screen structure                 | Four tabs, mini player, editorial rows |

Metadata parsing (`src/audio/metadata.ts`) is **new**: ID3v2.2/2.3/2.4,
MP4/iTunes `ilst` atoms, and FLAC Vorbis comments, including embedded artwork
extraction with image-signature validation. No tag library is used.

## Local development

```bash
npm install      # once
npm run icons    # regenerate public/icons from assets/appicon-1024.png
npm run dev      # dev server on http://localhost:5174
npm run typecheck
npm test         # pure-logic tests under Node's built-in runner (47 tests)
npm run build    # typecheck + production build into dist/
npm run preview  # serve the built app on the network
```

Dependencies are deliberately minimal: React 19, Vite 7, TypeScript,
`vite-plugin-pwa` (Workbox), and `sharp` (dev-only, icon rasterization). There
is no backend and no network dependency at runtime.

## How the app works

- **Import**: `<input type="file" multiple accept="audio/*">` — the only
  channel that works reliably on iOS Safari. Files are validated by extension
  against containers Safari can decode (mp3, m4a, aac, wav, aif, aiff, flac;
  ogg/opus are rejected up front with an honest reason), hashed for duplicate
  detection, tag-parsed for title/artist/album/artwork, duration-probed, then
  stored.
- **Storage**: audio and artwork live as `Blob`s in IndexedDB
  (`noir-music` database, `audio` and `artwork` stores). Track metadata,
  playlists, preferences, and the queue snapshot live in LocalStorage, guarded
  and validated on load. The service worker never caches audio blobs.
- **Playback**: a single `HTMLAudioElement` owns transport state; React mirrors
  its events. The Web Audio analyser is created lazily on the first
  user-initiated play (an `AudioContext` can only resume inside a gesture on
  iOS); if Web Audio is unavailable, playback is untouched and the visualizer
  stays flat.
- **Media Session**: lock-screen and Control Center metadata and controls are
  registered where `navigator.mediaSession` exists. **This is not verified on a
  real device yet — see the QA checklist.**
- **Offline shell**: Workbox precaches HTML/JS/CSS/fonts/icons and serves
  `index.html` for navigations. `registerType: 'autoUpdate'` means the app
  checks for a new shell on launch and swaps when there is one; audio blobs are
  never touched.

## Deployment

The app is a static bundle; any HTTPS static host works. The build is
base-`/` by default. **Nothing is deployed yet** — when you are ready:

**Cloudflare Pages / Netlify / Vercel (recommended, free, HTTPS included):**

1. `npm run build`
2. Deploy `dist/` with the framework preset "Vite" or build command
   `npm run build` and output directory `dist`.
3. Confirm the deployed URL serves `manifest.webmanifest` and
   `/icons/icon-512.png`.

**GitHub Pages (requires the repository to be public):**

1. `npm run build -- --base=/NOIRMusic-Web/`
2. Publish `dist/` to the `gh-pages` branch (or Actions), then enable Pages.

The manifest's `start_url` and `scope` are `/`; verify the icon and manifest
URLs resolve under the final host before installing on a phone.

## Installing on an iPhone (Safari → Home Screen)

1. Open the HTTPS URL in Safari (not in-app browsers).
2. Tap the **Share** icon → **Add to Home Screen** → **Add**.
3. Launch NOIRMusic from the Home Screen icon. It runs standalone, outside
   Safari's chrome.
4. On first launch, use **Library → Import Music** and pick audio files from
   Files or your library. Playback authorization is granted per file gesture.

Note: on iOS, the system decides how long IndexedDB survives. Adding to the
Home Screen and launching from the icon gives the app its own persistent
storage compartment, unlike a Safari tab.

## Real-device QA checklist (NOT yet performed)

These behaviors must be confirmed on a real iPhone before any "works" claim:

- [ ] Import an MP3 and an M4A; metadata (title/artist/album) shows correctly.
- [ ] Album artwork extracted from tags displays; fallback glyph otherwise.
- [ ] Playback starts, pauses, seeks; next/previous follow the 3-second rule.
- [ ] Screen locks → audio continues; lock-screen controls appear and respond.
- [ ] Lock-screen metadata (title/artist/artwork) matches the current track.
- [ ] Headphones/Bluetooth route change pauses or transfers as expected.
- [ ] Kill the Home Screen app, relaunch → library and queue survive; position
      resumes near where it stopped (restored paused, not auto-playing).
- [ ] Airplane mode → the app shell loads and the library still plays.
- [ ] Toggle light/dark in Settings and confirm correct theme in both.
- [ ] Shuffle and repeat behave (repeat-one replays; repeat-all wraps).
- [ ] Visualizer responds while playing in at least Bars mode; stays flat when
      paused; does not interfere with background playback.
- [ ] Unsupported file (e.g. .ogg) is rejected with an honest message.

Known limitations to verify or document honestly:

- OGG/Opus are not importable — Safari has no native decoder.
- Background playback and lock-screen controls depend on iOS granting the
  media session; if the system suspends the tab, playback stops like any web
  audio app. This has not been verified on a device.
- iOS may evict IndexedDB under storage pressure; the app reports limited
  storage mode when LocalStorage writes fail.

## Project layout

```
src/audio/      models, queue rules, library/IndexedDB, metadata parser,
                audio engine, Media Session wiring, React provider
src/components/  icons, artwork, sheets, visualizer, rows, mini player
src/screens/    library, search, playlists (+ detail), settings, now playing
src/styles/     tokens (theme), base, app chrome
tests/          queue, library, metadata, format — pure logic, zero deps
scripts/        icon generator, Node test-runner resolver hooks
assets/         source app icon (1024px, from the native repository)
```

## License feel

Fonts are OFL 1.1 (see `public/fonts/OFL-1.1.txt`). Everything else here is
your own code to use as you like.
