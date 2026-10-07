/**
 * Record the page doing the thing it is named after.
 *
 *   npm run capture
 *
 * A project whose whole argument is "watch this happen" cannot lead with a
 * still image. The hiring engineer audit put it plainly: the first screen of
 * this repository is eight filenames, and everything good about it is three
 * minutes further in than anyone will go.
 *
 * What gets recorded, and why this and not something prettier: a sentence is
 * typed, the model runs entirely in the browser, forty four candidate intents
 * collapse to one, the words get their slot tags, and twenty four attention
 * fields appear. Then a different head is selected and the large field changes,
 * because the whole claim of the page is that those fields differ and that you
 * can go looking through them.
 *
 * It starts and stops its own server. `tokenlab`'s capture does not, and it
 * died with ERR_CONNECTION_REFUSED on the afternoon that repository was
 * published, which is the second time a tool here has assumed somebody had
 * already run `npm run dev`.
 *
 * The sentence is pinned. A capture of a random sentence has numbers in it that
 * nothing can check, and the README quotes what this recording shows.
 */

import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reachable } from './wait-for.mjs'
import { requireFfmpeg } from './ffmpeg.mjs'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5183
const BASE = `http://localhost:${PORT}/`
const OUT = resolve(root, 'docs/think.gif')
const WORK = resolve(root, '.capture')

const SENTENCE = process.env.WIT_SENTENCE ?? 'σβήσε τα φώτα στην κουζίνα'

/*
 * A seam for the failure path, because the failure path is the half that was
 * broken and the half nothing ran.
 *
 * WS-F5. `CAPTURE_FAIL_AT=start` throws just after the page loads, which is
 * what a slow vocabulary, a missing font or a machine that prefers reduced
 * motion produce on their own, and what `tokenlab` had to produce by hand to
 * measure the same defect. `check-capture-exit.mjs` at the workspace uses it on
 * every project that films itself. Three lines of test seam against a gate that
 * would otherwise have to edit this file to run.
 */
const FAIL_AT = process.env.CAPTURE_FAIL_AT ?? ''
const SIZE = { width: 1000, height: 820 }
const FPS = 10
const WIDTH = 880
/*
 * Ten frames a second and sixty four colours, not twelve and two hundred and
 * fifty six. This is a heat map in one hue and a few chips of text: the palette
 * is not where the information is, and the recruiter audit was right that a
 * better encoder is not the fix. Fewer frames and a shorter run are.
 */
/*
 * The band worth watching: the box, the verdict, and the fields under it.
 *
 * Captured at 1000 wide rather than 1240 and scaled to the same 880, so
 * everything in frame is about a quarter larger. The recruiter audit looked at
 * this on a phone, where the README image lands at 356 pixels, and called it a
 * smear. A tighter frame is the only lever: the output width is what GitHub
 * renders into, and the type size is set by how much page is in shot.
 */
const CROP = 'crop=1000:760:0:30'

const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', shell: true,
})
/*
 * Synchronous, because an exit handler runs after the event loop has drained and
 * an async spawn from inside one never starts. That mistake leaked 62 vite
 * servers on this machine before anybody counted them. See tools/serve.mjs.
 */
let stopped = false
const stop = () => {
  if (stopped || !server.pid) return
  stopped = true
  try {
    spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    // Already gone. Never the error the caller sees.
  }
}
process.on('exit', stop)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    stop()
    process.exit(130)
  })
}


rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

/*
 * WDEP-F1. This was `wait-on`, forty installed packages for one await. The
 * thirteen lines it is now is the same poll: fetch until it answers, with a
 * timeout per attempt so a server that accepts and then hangs cannot eat the
 * whole budget.
 */
if (!(await reachable(`http://localhost:${PORT}/`, 60_000))) {
  console.error(`FAIL  nothing answered on http://localhost:${PORT}/ within 60 seconds`)
  process.exit(1)
}

/*
 * ffmpeg before the browser, WS-F6.
 *
 * The call used to be on line 322, which is after a browser launch, a five
 * megabyte model download and twelve seconds of recording, and a reader
 * without ffmpeg got `spawnSync ffmpeg ENOENT` at the end of all of it. The
 * question "do you have the program this needs" is answerable in a second, so
 * it is answered here, and the version is kept for `docs/capture.json`.
 */
const FFMPEG = requireFfmpeg()
console.log(`ffmpeg ${FFMPEG.version}${process.env.FFMPEG ? ` (FFMPEG=${FFMPEG.path})` : ''}`)

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: WORK, size: SIZE },
})
// The clock the trim is measured against. Recording begins when the context
// does, so everything before this point is the model downloading.
const videoStart = Date.now()

/*
 * Everything the recorder does, inside one try.
 *
 * WS-F5, and `tokenlab` DR-F9 before it in the same words. Playwright only
 * finalises a video when its context closes, so until this wrapper existed any
 * throw between here and the end left `.capture/` behind with a **zero byte**
 * webm in it and the recording gone. Measured at tick 199 by throwing right
 * after the model arrives: 0 bytes. Throwing after `browser.close()` instead,
 * which is the line ffmpeg is on the other side of and so where this actually
 * fails: **971,857 bytes** of finished recording, left in a directory nothing
 * mentions.
 *
 * The server did not leak either way, and neither did the browser: nothing
 * answered on 5183 afterwards and the chromium process count was 9 before and
 * 9 after. `process.on('exit', stop)` and Playwright's own exit handling were
 * already doing their half.
 */
let looked = null
let drawing = null
let seconds = 0
let failure = null
/*
 * Hoisted, because the trim below reads it and the trim is outside the try.
 * It was `const startedAt` inside the block from tick 199 until tick 200, and
 * `npm run capture` died on `startedAt is not defined` every time it got as far
 * as encoding. Nothing caught it: the gate written in the same tick as the
 * wrapper drives the failure path, which exits before this line is reached.
 */
let startedAt = 0

try {
const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })

/*
 * The seam fires here and not a line earlier. A context with no page in it has
 * no video to finalise, so throwing before the first `newPage` tests the
 * message and not the thing the message is about.
 */
if (FAIL_AT === 'start') {
  await page.waitForTimeout(500)
  throw new Error('CAPTURE_FAIL_AT=start, the seam the failure path is tested through')
}

// Wait for the model rather than for a timeout. 5.28 MB off a local server is
// fast, and the recording should not open on a spinner either way.
await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 120_000 })
await page.waitForTimeout(700)

// Frame the box, not the headline. The headline is prose and belongs in the
// README; the loop is for the part that moves. The first attempt at this
// cropped a band that contained neither the box nor the verdict, which is what
// looking at the output rather than at the numbers catches.
await page.evaluate(() => {
  const box = document.querySelector('textarea')
  const y = box.getBoundingClientRect().top + window.scrollY - 30
  window.scrollTo({ top: y, behavior: 'instant' })
})
await page.waitForTimeout(400)

// Clear what boot() put there, so the recording opens on an empty box and the
// viewer sees the sentence arrive rather than finding it already answered.
await page.fill('textarea', '')
await page.waitForTimeout(500)

startedAt = Date.now()

// Typed, not pasted. The point is watching the answer move while the sentence
// is still being written.
await page.type('textarea', SENTENCE, { delay: 85 })
await page.waitForTimeout(1400)

// Then go looking through the heads, which is the activity the page exists for.
//
// Re-resolved on every click rather than collected once: selecting a head calls
// replaceChildren on the whole grid, so a handle taken before the first click
// is detached by the time the second one is wanted. That is WP-F3, the finding
// about rebuilding everything for a change that altered no data, turning up in
// the tooling rather than in the page.
// Pan down to them rather than cutting. The scroll is part of the argument:
// it says there is more here than the answer.
await page.evaluate(() => {
  const heads = document.querySelector('[data-heads]')
  const y = heads.getBoundingClientRect().top + window.scrollY - 90
  window.scrollTo({ top: y, behavior: 'smooth' })
})
await page.waitForTimeout(1200)

const count = await page.locator('.headcell').count()
for (const i of [9, 21]) {
  if (i < count) {
    await page.locator('.headcell').nth(i).click()
    await page.waitForTimeout(950)
  }
}
await page.waitForTimeout(700)

// What the page looked like when this was recorded.
//
// A GIF cannot go stale loudly. The palette was replaced two ticks after this
// recording was made, the README kept saying "that is the real page in a real
// browser", and nothing anywhere failed: the recruiter audit found it by
// looking at a green picture of a page that is now flame and blue.
//
// So the recording writes down the tokens it was made under, and check:capture
// compares them against the page that exists.
looked = await page.evaluate(() => {
  const s = getComputedStyle(document.documentElement)
  const pick = ['--ink', '--lift', '--text', '--flame', '--flame-bright', '--scale-hue', '--focus']
  const out = {}
  for (const k of pick) out[k] = s.getPropertyValue(k).trim()
  out.bodyFont = getComputedStyle(document.body).fontFamily

  // The words, not only the paint.
  //
  // The first version of this recorded eight colours and a typeface, and the
  // headline changed one commit after the recording was made without anything
  // noticing. The recruiter's whole complaint had been about that headline, so
  // the gate written to stop a stale picture was watching everything except the
  // thing the picture was stale about.
  out.headline = document.querySelector('h1')?.textContent?.trim() ?? ''
  out.standfirst = document.querySelector('[data-standfirst]')?.textContent?.trim() ?? ''
  return out
})

/*
 * And what the drawing looked like, which is the half the paint cannot say.
 *
 * WME2-F5. `check:capture` compared seven custom properties, a font, the
 * headline and the standfirst, and passed over a recording made before the
 * thumbnails stopped being scaled panel by panel: the filmed grid showed 22 of
 * 24 heads at one palette colour while the page had gone to 87.6 through
 * 165.7. Every property it watched had stayed put, because a change to the
 * drawing is not a change to the paint.
 *
 * So the recording writes down the peak luma of each of the twenty four
 * thumbnails, read straight off their canvases with `getImageData`, and the
 * gate reads the same twenty four off the page that exists. Measured at tick
 * 200: identical across two runs to 0.0, and unchanged by clicking a head, so
 * the comparison can be tight.
 */
drawing = await page.evaluate(() => {
  const peak = (c) => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let top = 0
    for (let i = 0; i < d.length; i += 4) {
      const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      if (v > top) top = v
    }
    return +top.toFixed(1)
  }
  const thumbs = [...document.querySelectorAll('.headcell')].map((cell) => ({
    tag: cell.querySelector('.headcell-tag')?.textContent?.trim() ?? '',
    peak: peak(cell.querySelector('canvas')),
  }))
  const peaks = thumbs.map((t) => t.peak)
  return { thumbs, spread: +(Math.max(...peaks) - Math.min(...peaks)).toFixed(1) }
})

seconds = (Date.now() - startedAt) / 1000
} catch (err) {
  failure = err
} finally {
  /*
   * Closed even when something above threw, because this is what writes the
   * video file. A failed run that keeps its recording can be looked at; one
   * that loses it leaves a stack trace and an empty directory.
   */
  await context.close().catch(() => {})
  await browser.close().catch(() => {})
  stop()
}

if (failure) {
  console.error(`FAIL  ${failure.message}`)
  const kept = existsSync(WORK) ? readdirSync(WORK).filter((f) => f.endsWith('.webm')) : []
  if (kept.length > 0) {
    const bytes = kept.reduce((n, f) => n + statSync(resolve(WORK, f)).size, 0)
    console.error(`      the recording is in ${WORK}, ${bytes} bytes, finished and kept, for looking at`)
    console.error('      .capture is in .gitignore, so it cannot reach a commit. Delete it when you are done.')
  } else {
    console.error(`      nothing was recorded, and ${WORK} is empty`)
  }
  process.exit(1)
}

const video = readdirSync(WORK).find((f) => f.endsWith('.webm'))
if (!video) {
  console.error('FAIL  playwright wrote no video')
  process.exit(1)
}
const webm = resolve(WORK, video)

// Before ffmpeg, not after: it writes into docs/ and the first run of this
// tool died with "No such file or directory" pointing at its own output.
mkdirSync(resolve(root, 'docs'), { recursive: true })
  /*
   * The encoder writes a draft, and the committed picture is renamed into place.
   *
   * ACAP-F1, swept from tokenlab DR-F9. ffmpeg opens its output and truncates it
   * before it knows whether the filters are valid, so a second pass with one
   * wrong index empties the first thing in the README and says nothing unless
   * somebody looks at the file. Measured at tick 223 on a copy of this
   * project's own asset:
   *
   *   ffmpeg -y ... -lavfi "...[x];[x][7:v]paletteuse..." copy.gif
   *   before 651,062 bytes      after 0 bytes
   *
   * Seven of the eight capture tools here were writing their committed asset in
   * place. The draft lives in .capture, which is in .gitignore, so a failed
   * encode cannot reach a commit and cannot damage what is already in one.
   */

/* `basename`, not a split on a forward slash. `resolve()` returns backslashes

   on Windows, so OUT.split(/[/]/).pop() gives back the whole absolute path and

   resolve(WORK, <absolute>) returns that same path: the draft would be the

   committed file and the fix would be a no op. Measured at tick 223, before it

   shipped. */

const draft = resolve(WORK, basename(OUT))

const ff = (args) => execFileSync(FFMPEG.path, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
const palette = resolve(WORK, 'palette.png')
const filters = `${CROP},fps=${FPS},scale=${WIDTH}:-1:flags=lanczos`

// The load is trimmed off the front: the recording starts just before the
// typing does. What the download costs belongs in the README as a number, not
// as eleven seconds of a loop that plays forever.
//
// A little air before the first keystroke, so the loop does not start mid
// motion when it wraps around.
const LEAD_IN = 0.4
const offset = Math.max(0, (startedAt - videoStart) / 1000 - LEAD_IN)
const trim = ['-ss', String(offset)]
/*
 * The second seam, at the encoder.
 *
 * `start` proves what a dying run leaves behind. It proves nothing about the
 * run that works, and tick 199 wrapped this recorder in a try that scoped a
 * `const` the trim arithmetic below reads, so `npm run capture` died on a
 * ReferenceError every time it got this far, with the gate written in the same
 * tick green. This one throws after everything the recorder and the arithmetic
 * do and before the first frame is encoded, so the whole success path runs and
 * nothing in docs/ is rewritten.
 */
if (FAIL_AT === 'encode') {
  /* Reported here rather than thrown: by this line the recorder's try is
     closed, in two of these seven, and an uncaught throw would print a node
     stack instead of saying where the recording is. */
  const kept = existsSync(WORK) ? readdirSync(WORK).filter((f) => f.endsWith('.webm')) : []
  const bytes = kept.reduce((n, f) => n + statSync(resolve(WORK, f)).size, 0)
  console.error('FAIL  CAPTURE_FAIL_AT=encode, the seam that proves the success path runs')
  console.error(`      the recording is in ${WORK}, ${bytes} bytes, finished and kept, for looking at`)
  console.error('      .capture is in .gitignore, so it cannot reach a commit. Delete it when you are done.')
  process.exit(1)
}


ff([...trim, '-i', webm, '-vf', `${filters},palettegen=max_colors=64:stats_mode=diff`, palette])
ff([
  ...trim, '-i', webm,
  '-i', palette,
  '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  '-loop', '0',
  draft,
])
renameSync(draft, OUT)

renameSync(webm, resolve(root, 'docs/think.webm'))
rmSync(WORK, { recursive: true, force: true })

writeFileSync(
  resolve(root, 'docs/capture.json'),
  JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), ffmpeg: FFMPEG.version, sentence: SENTENCE, looked, drawing }, null, 2) + '\n',
)

const { size } = await import('node:fs').then((m) => m.promises.stat(OUT))
console.log(`docs/think.gif   ${(size / 1e6).toFixed(2)} MB at ${FPS} fps, ${WIDTH}px wide`)
console.log(`docs/think.webm  kept alongside it, for anywhere that takes video`)
console.log(`sentence: ${JSON.stringify(SENTENCE)}, ${seconds.toFixed(1)}s of action`)
console.log(`trimmed ${offset.toFixed(2)}s of model download off the front`)
