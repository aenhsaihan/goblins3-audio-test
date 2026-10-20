# Goblins 3: isolated CD audio test

This is a separate GitHub Pages test, not an update to the working Goblins 3 site. It tests the measured cooperative mixer-timer improvement in ScummVM's web backend. No commercial game files, CD music, demo data, user saves, or recorded game audio are published.

Import your legally acquired DOS CD ZIP at this address. Imports remain in this browser's IndexedDB and are never uploaded. A separate hostname means the working site's CD files and saves are not available here; the original site is not changed. Candidate and comparison modes share this test's own saves. Save before switching: switching restarts the game.

On iPhone, open in Safari, import the ZIP, and tap **Play audio fix**. To test installed landscape mode, add this test address to the Home Screen separately. Check the animated intro, Blount/Wynona spoken scenes, inputs, panning and save/load. **Compare original timing** launches the exact stable engine pair against the same imported CD files. No service worker is installed.

## Build

Use Node 22.13 or later: `npm install`, `npm run build`, `npm test`, `npm run preview`. Pages serves the committed `docs/` directory from `main`. All frontend paths work below a repository subpath.

The frontend importer and touch player are adapted from stable source commit `ab324ca6026dc7ea8e8b63687cfbcdd5b0e14335` of https://github.com/aenhsaihan/goblins3-web. Only the shell, hosting paths, isolated import database, and engine selection differ.

## Corresponding engine source

ScummVM is GPL-3.0-or-later; see `COPYING`. Complete base source is https://github.com/chkuendig/scummvm/tree/de7b4e39851d0111ec7e3f1165fd9c2997ee9419, and all candidate modifications are in `patches/scummvm-audio-test.patch`. Apply that patch to that commit. Baseline source differs only by the low-DPI window flag (the first file in the patch). Emscripten SDK 6.0.11 and SDL3 are used. Configure:

```
./configure --host=wasm32-unknown-emscripten --build=wasm32-unknown-emscripten --enable-release --disable-all-engines --enable-engine=gob --disable-cloud --disable-fluidsynth --disable-freetype2 --enable-ogg --enable-vorbis
make -j8
```

The candidate is the **exact measured** pair, not a newly recompiled release. Dormant trace hooks remain in it; this player does not enable `Module.audioTrace`. Its timer fix is activated by `service_timers=1`, set by the candidate player before starting the engine. No decoder or audio speed changes are made.

External Web MIDI enumeration is skipped in this dedicated CD/AdLib test so startup cannot wait on an unrelated device-permission prompt. CD music, embedded speech and software AdLib do not use an external MIDI device.

Candidate SHA-256: JS `41a8319a4999f486b4883e11f3797f7e915aeee0f0f256fb79bfd177583999b7`; WASM `7eeac96190be191ec3f87f62ec1a1987660fe4862b1cbe93f7e697796f3c8b42`.

Stable SHA-256: JS `fb05b5483d214e5763ebbed90689d446c0a019d8982cce60367c908caab9739f`; WASM `621b8bfb41a16f19073853733e43d5323facf485e6f4d6ee465d0264f40913f9`.

ScummVM support files in `docs/data` are from the same source build family. The ZIP importer uses [fflate 0.7.5](https://github.com/101arrowz/fflate), MIT licensed; its license is included in `docs/vendor`. The TypeScript importer source is retained in `src/`; its only dependency is bundled locally, with no CDN imports.

On the tested Mac browser, intro empty mixer requests fell from 478/1,188 to zero in two complete runs while 356 movie frames still took 50.7 seconds. Physical iPhone and specific dialogue scenes remain user tests; this is not a claim that all audio or gameplay regressions are resolved.
