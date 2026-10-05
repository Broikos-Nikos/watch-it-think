/**
 * The picture at the top of the README is a picture of this page.
 *
 *   npm run check:capture
 *
 * `docs/think.gif` was recorded on one tick, the palette was replaced two ticks
 * later, and the README went on saying "That is the real page in a real
 * browser" over a recording that was green while the page had become flame and
 * blue. Nothing failed. Nothing could: a GIF cannot go stale loudly, and every
 * other gate here checks code or numbers.
 *
 * The recruiter audit found it in ten seconds, which is the whole point of that
 * perspective, and called it the one picture that would have stopped them being
 * a picture of a page that no longer exists.
 *
 * So the capture writes down the tokens it was made under, into
 * `docs/capture.json`, and this compares them against the page that exists now.
 * It does not compare pixels: a screenshot diff would fail on every sentence
 * the model routes differently, which is most of them, and a gate that cries
 * wolf is a gate that gets skipped. It compares the things that make the
 * recording look like a different product.
 *
 * Which, for one version of this file, meant eight colours and a typeface. The
 * recruiter came back a second time and found the same class of defect
 * untouched: the recording showed the old headline, "Five million parameters,
 * running on your machine", one commit before it became "I trained this model.
 * Watch it think." No custom property moved, so this gate passed over a picture
 * of a page saying something else, while guarding a README sentence that says
 * the picture is the real page.
 *
 * A gate written in response to a complaint about a headline has to look at the
 * headline. It now compares the words as well as the paint, and a recording
 * made before it did is treated as no recording at all.
 *
 * ## And the drawing, which is neither the paint nor the words
 *
 * WME2-F5, the measurement pass of 24 September. The thumbnails stopped being
 * scaled panel by panel at `b090561`, which is the fix this project's main
 * instrument most recently had, and the recording that stayed in the README
 * showed 22 of 24 heads at one palette colour against a page running 87.6
 * through 165.7. Not one custom property moved, so this file printed "the
 * picture shows the page that exists".
 *
 * Reproduced at tick 200 against a build that succeeded, by scaling the grid to
 * 0.35 of its peak, which is the same defect in the other direction: the page
 * went to 145.7 through 165.7, a spread of 20.0 where it had been 77.3, the
 * worst thumbnail 58.1 luma from the one in the recording, and this gate said
 * ok three times.
 *
 * So the recording writes down the peak luma of all twenty four thumbnails and
 * this reads the same twenty four off the page. Measured identical across two
 * runs to 0.0 and unaffected by clicking a head, so TOLERANCE is not for the
 * noise here: it is for a machine whose int8 kernels put the cube somewhere
 * slightly different, and 8 is an eighth of what the defect moves.
 *
 * ## How small a change this catches, measured rather than claimed
 *
 * The grid rescaled to 0.35 of its peak fails on 19 of 24, the worst 64.4 luma
 * out. To 0.9 it fails on 14 of 24, the worst 7.8 luma and 0.047 of the grid's
 * own range, which is the control that made SHAPE exist: in luma alone that one
 * passed. To 0.97 it passes. So the floor is somewhere around a 5 percent
 * rescale, and a change smaller than that is one this gate will not see.
 *
 * If this ever fails on a runner while passing here, the thing to suspect is
 * not the tolerance. Every number this project publishes comes out of the same
 * int8 graph, and a cube that lands somewhere else on another machine is a
 * finding about the measurement, not about the picture.
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const record = resolve(root, 'docs/capture.json')
const gif = resolve(root, 'docs/think.gif')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

if (!existsSync(gif)) {
  fail('docs/think.gif is missing, and the README leads with it')
  process.exit(1)
}
if (!existsSync(record)) {
  fail(
    'docs/capture.json is missing, so nothing records what the page looked like when it was filmed',
    'run npm run capture',
  )
  process.exit(1)
}

const was = JSON.parse(readFileSync(record, 'utf8'))

// The words the recording is required to have written down. A capture.json
// without them was made by the tool that only knew about colours, and the
// honest thing to do with it is refuse it rather than compare the six keys it
// does have and print "ok".
const WORDS = ['headline', 'standfirst']
const unrecorded = WORDS.filter((k) => !(k in was.looked))

/* The same refusal, for the same reason, one defect later. */
if (!was.drawing || !Array.isArray(was.drawing.thumbs) || was.drawing.thumbs.length === 0) {
  fail(
    'docs/capture.json records nothing about the drawing, so it was made before this gate read pixels',
    'It wrote down a palette and two sentences, none of which move when the thumbnails are rescaled. Run npm run capture.',
  )
}

/*
 * Two tolerances, because they are measuring against two different risks.
 *
 * TOLERANCE is in luma, against a machine whose int8 kernels put the cube
 * somewhere slightly different from this one's. Measured here: 0.0 across two
 * runs, so 8 is all slack and none of it is noise.
 *
 * SHAPE is each thumbnail against the brightest thumbnail in its own grid, and
 * it exists because the luma tolerance alone let a control through. Rescaling
 * the whole grid to 0.9 of its peak moved every panel by less than 8 and the
 * gate said ok; the same change in shape terms is far larger, because the ramp
 * is not linear. A grid shift that moves all 24 together, which is what a
 * different machine would do, leaves the shape alone.
 */
const TOLERANCE = 8
const SHAPE = 0.03
if (unrecorded.length > 0) {
  fail(
    `docs/capture.json records no ${unrecorded.join(' and ')}, so it was made before this gate read words`,
    'It wrote down eight colours and a font, none of which move when a sentence is rewritten. Run npm run capture.',
  )
}


/*
 * The server comes from tools/serve.mjs: one preview on a port the operating
 * system hands out, proved to be serving this build. Each gate used to spawn
 * its own on a hardcoded number, which is how ten of them leaked and how one
 * was caught reporting green against a page it never started.
 *
 * WIT_URL, when set, is a server somebody else already started, which is what
 * npm run verify does for the whole browser pass.
 */
const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()
const BASE = server.url

try {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 180_000 })
  // The standfirst is written from meta.json during boot, so an empty one here
  // would read as drift when it is only impatience.
  await page.waitForFunction(
    () => (document.querySelector('[data-standfirst]')?.textContent ?? '').trim().length > 0,
    null,
    { timeout: 30_000 },
  )

  const now = await page.evaluate((keys) => {
    const s = getComputedStyle(document.documentElement)
    const out = {}
    for (const k of keys) out[k] = s.getPropertyValue(k).trim()
    out.bodyFont = getComputedStyle(document.body).fontFamily
    out.headline = document.querySelector('h1')?.textContent?.trim() ?? ''
    out.standfirst = document.querySelector('[data-standfirst]')?.textContent?.trim() ?? ''
    return out
  }, Object.keys(was.looked).filter((k) => k.startsWith('--')))

  const drifted = []
  for (const [k, v] of Object.entries(was.looked)) {
    if (now[k] !== v) drifted.push(`${k}: filmed ${JSON.stringify(v)}, page is ${JSON.stringify(now[k])}`)
  }

  if (drifted.length > 0) {
    fail(
      `the page has changed in ${drifted.length} ways since the recording was made on ${was.recorded}`,
      drifted.join('\n      ') + '\n      Run npm run capture. The README calls this the real page.',
    )
  } else {
    console.log(
      `  ok      the recording of ${was.recorded} was made under the palette the page still has, ` +
        `saying ${JSON.stringify(was.looked.headline)}`,
    )
  }

  /*
   * And then the picture itself, on the sentence the recording was made with.
   *
   * The page boots with its own sentence, so the one that was filmed has to be
   * typed back in: a grid drawn from a different sentence is a different grid,
   * and comparing it would be the cry wolf this file's header refuses.
   */
  if (was.drawing && Array.isArray(was.drawing.thumbs) && was.drawing.thumbs.length > 0) {
    await page.fill('textarea', '')
    await page.waitForTimeout(300)
    await page.fill('textarea', was.sentence)
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-head-cell] canvas').length === n,
      was.drawing.thumbs.length,
      { timeout: 60_000 },
    )
    await page.waitForTimeout(1500)

    const now = await page.evaluate(() => {
      const peak = (c) => {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
        let top = 0
        for (let i = 0; i < d.length; i += 4) {
          const v = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
          if (v > top) top = v
        }
        return +top.toFixed(1)
      }
      return [...document.querySelectorAll('[data-head-cell]')].map((cell) => ({
        tag: cell.querySelector('[data-head-tag]')?.textContent?.trim() ?? '',
        peak: peak(cell.querySelector('canvas')),
      }))
    })

    if (now.length !== was.drawing.thumbs.length) {
      fail(
        `the recording has ${was.drawing.thumbs.length} thumbnails and the page draws ${now.length}`,
        'The grid is the instrument. A different number of panels is a different picture.',
      )
    } else {
      const topWas = Math.max(...was.drawing.thumbs.map((t) => t.peak))
      const topNow = Math.max(...now.map((t) => t.peak))
      const moved = was.drawing.thumbs
        .map((t, i) => ({
          tag: t.tag,
          was: t.peak,
          now: now[i].peak,
          by: +Math.abs(t.peak - now[i].peak).toFixed(1),
          shape: +Math.abs(t.peak / topWas - now[i].peak / topNow).toFixed(3),
        }))
        .filter((d) => d.by > TOLERANCE || d.shape > SHAPE)
        .sort((a, b) => b.by - a.by)

      const peaks = now.map((t) => t.peak)
      const spread = +(Math.max(...peaks) - Math.min(...peaks)).toFixed(1)
      const spreadBy = +Math.abs(spread - (was.drawing.spread ?? spread)).toFixed(1)

      if (moved.length > 0) {
        fail(
          `${moved.length} of ${now.length} thumbnails are drawn differently from the recording of ${was.recorded}`,
          `worst ${moved[0].tag}: filmed ${moved[0].was}, the page draws ${moved[0].now}, ${moved[0].by} luma apart ` +
            `and ${moved[0].shape} of the grid's own range. ` +
            `Spread filmed ${was.drawing.spread}, page ${spread}.
      ` +
            'Run npm run capture. A palette that has not moved does not mean the picture has not.',
        )
      } else if (spreadBy > TOLERANCE) {
        fail(
          `the grid's spread was ${was.drawing.spread} when it was filmed and is ${spread} now`,
          'Every panel is within tolerance and the grid is not, which is a scale change rather than a drawing change.',
        )
      } else {
        console.log(
          `  ok      all ${now.length} thumbnails are drawn as they were filmed, within ${TOLERANCE} luma and ` +
            `${SHAPE} of the grid's range, spread ${spread} against ${was.drawing.spread}`,
        )
      }
    }
  }

  await browser.close()
} finally {
  server.stop()
}

// The README claims this is the real page, so that sentence has to be there for
// the check above to be guarding anything.
// Whitespace flattened, because the sentence wraps and the first version of
// this matched a phrase that is not the one the README uses. It said "real page
// in a real browser" and the README says "the real page, recorded by npm run
// capture from a real browser": the check was testing my memory of the sentence
// rather than the sentence.
const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\s+/g, ' ')
if (!/That is the real page, recorded by .npm run capture. from a real browser/.test(readme)) {
  fail('the README no longer claims the picture is the real page, so this gate is guarding nothing')
} else {
  console.log('  ok      the README makes the claim this gate exists to keep true')
}

// Weight, because it is the first thing anybody downloads and the recruiter
// audit measured it at 3.85 MB.
const mb = statSync(gif).size / 1e6
if (mb > 4) {
  fail(`docs/think.gif is ${mb.toFixed(2)} MB`, 'fewer frames and a shorter run, not a better encoder')
} else {
  console.log(`  ok      docs/think.gif is ${mb.toFixed(2)} MB`)
}

if (failed > 0) {
  console.error('\nThe picture at the top is the only thing most people will look at.')
  process.exit(1)
}

console.log('capture: the picture shows the page that exists, and the README can say so')
