/**
 * The one program this repository runs that npm did not install.
 *
 * WS-F6, the supply chain pass of 22 September: "ffmpeg is an undeclared,
 * unpinned binary taken off PATH, and it makes the repository's front door".
 * `tools/capture.mjs` called `execFileSync('ffmpeg', ...)` with the name bare,
 * so on Windows whatever `ffmpeg.exe` comes first in PATH won, and nothing in
 * `package.json`, `tools/requirements.txt` or the README said the program was
 * needed at all. Measured at tick 217, with ffmpeg taken off PATH:
 *
 *     ENOENT: spawnSync ffmpeg ENOENT
 *
 * and the line that threw it is 322, which is 165 lines and one browser launch
 * and one model load after the work starts.
 *
 * ## Why this is not `ffmpeg-static`
 *
 * That was the auditor's first option and it is the better one in general: a
 * pinned devDependency exporting a path removes the PATH question entirely.
 * `deps-cap.json` forbids it. The cap is 38 packages, it may only fall, and it
 * exists because WDEP-F1 found `wait-on` costing 40 packages for one await.
 * Adding 77 MB of binary to an install that WS-F12 already calls out would be
 * the same mistake with a different name, so the repository's own ratchet
 * chose the other fix: name it, resolve it once, check it, and record which
 * one actually made the committed recording.
 *
 * ## What this does
 *
 *   FFMPEG=/path/to/ffmpeg   an explicit choice wins over PATH
 *
 * `resolveFfmpeg()` finds the program, runs `-version`, and returns its path
 * and version string. `requireFfmpeg()` is the same thing with the error a
 * reader can act on, and `capture.mjs` calls it **before** it launches a
 * browser, so the answer to "do you have ffmpeg" arrives in a second rather
 * than after a model has been downloaded.
 *
 * Pinned is the one word in the finding this cannot deliver. A version of a
 * program on somebody else's machine is not something a repository can fix,
 * so what is recorded instead is which build made the GIF that is committed:
 * `docs/capture.json` carries it, and the next person to re-record can see
 * whether they are using the same one.
 */

import { execFileSync } from 'node:child_process'

export const FFMPEG_ENV = 'FFMPEG'

/** How a reader is told to get it. Named here so the README, the gate and the
    error all quote the same sentence rather than three similar ones. */
export const FFMPEG_HOW =
  'Install ffmpeg and put it on PATH (winget install Gyan.FFmpeg, brew install ffmpeg, apt install ffmpeg), or set FFMPEG to its full path.'

/**
 * @returns {{ path: string, version: string } | { path: string, error: string }}
 */
export function resolveFfmpeg() {
  const path = process.env[FFMPEG_ENV] || 'ffmpeg'
  try {
    const out = execFileSync(path, ['-version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    /* The first line is `ffmpeg version 8.1.2-essentials_build-www.gyan.dev
       Copyright ...`, and the version is what comes between. */
    /* Trimmed before the replace, not after. ffmpeg's output is CRLF here, and
       `.*$` in a pattern without the m flag will not cross the `\r`, so the
       first version of this printed the whole copyright line into the gate's
       ok line and into docs/capture.json. */
    const first = out.split('\n')[0].trim()
    const version = first.replace(/^ffmpeg version\s*/, '').replace(/\s*Copyright.*$/, '').trim()
    return { path, version: version || first }
  } catch (err) {
    const e = /** @type {any} */ (err)
    return { path, error: e.code === 'ENOENT' ? `not found as ${JSON.stringify(path)}` : String(e.message).split('\n')[0] }
  }
}

/** The same, and it exits rather than returning a problem. */
export function requireFfmpeg() {
  const found = resolveFfmpeg()
  if ('error' in found) {
    console.error(`FAIL  ffmpeg: ${found.error}`)
    console.error(`      ${FFMPEG_HOW}`)
    console.error('      This is checked before the browser starts, because it used to throw ENOENT after one.')
    process.exit(1)
  }
  return found
}
