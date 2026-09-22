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

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, renameSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5183
const BASE = `http://localhost:${PORT}/`
const OUT = resolve(root, 'docs/think.gif')
const WORK = resolve(root, '.capture')

const SENTENCE = process.env.WIT_SENTENCE ?? 'σβήσε τα φώτα στην κουζίνα'
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
const stop = () => {
  if (server.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
}
process.on('exit', stop)

rmSync(WORK, { recursive: true, force: true })
mkdirSync(WORK, { recursive: true })

const { default: waitOn } = await import('wait-on')
await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: SIZE,
  deviceScaleFactor: 1,
  recordVideo: { dir: WORK, size: SIZE },
})
// The clock the trim is measured against. Recording begins when the context
// does, so everything before this point is the model downloading.
const videoStart = Date.now()

const page = await context.newPage()
await page.goto(BASE, { waitUntil: 'domcontentloaded' })

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

const startedAt = Date.now()

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
const looked = await page.evaluate(() => {
  const s = getComputedStyle(document.documentElement)
  const pick = ['--ink', '--lift', '--text', '--flame', '--flame-bright', '--scale-hue', '--focus']
  const out = {}
  for (const k of pick) out[k] = s.getPropertyValue(k).trim()
  out.bodyFont = getComputedStyle(document.body).fontFamily
  return out
})

const seconds = (Date.now() - startedAt) / 1000
await context.close()
await browser.close()
stop()

const video = readdirSync(WORK).find((f) => f.endsWith('.webm'))
if (!video) {
  console.error('FAIL  playwright wrote no video')
  process.exit(1)
}
const webm = resolve(WORK, video)

// Before ffmpeg, not after: it writes into docs/ and the first run of this
// tool died with "No such file or directory" pointing at its own output.
mkdirSync(resolve(root, 'docs'), { recursive: true })

const ff = (args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' })
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

ff([...trim, '-i', webm, '-vf', `${filters},palettegen=max_colors=64:stats_mode=diff`, palette])
ff([
  ...trim, '-i', webm,
  '-i', palette,
  '-lavfi', `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
  '-loop', '0',
  OUT,
])

renameSync(webm, resolve(root, 'docs/think.webm'))
rmSync(WORK, { recursive: true, force: true })

writeFileSync(
  resolve(root, 'docs/capture.json'),
  JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), sentence: SENTENCE, looked }, null, 2) + '\n',
)

const { size } = await import('node:fs').then((m) => m.promises.stat(OUT))
console.log(`docs/think.gif   ${(size / 1e6).toFixed(2)} MB at ${FPS} fps, ${WIDTH}px wide`)
console.log(`docs/think.webm  kept alongside it, for anywhere that takes video`)
console.log(`sentence: ${JSON.stringify(SENTENCE)}, ${seconds.toFixed(1)}s of action`)
console.log(`trimmed ${offset.toFixed(2)}s of model download off the front`)
