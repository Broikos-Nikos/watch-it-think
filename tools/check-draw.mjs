/**
 * The colours are the browser's colours, and a field paints inside its budget.
 *
 *   npm run check:draw
 *
 * The drawing loop used to build an `oklch(...)` string and assign it to
 * `fillStyle` once per cell: 4,096 strings built, parsed and colour converted
 * for one field at a 64 token sentence, and 98,304 across the grid of
 * twenty four. The performance audit measured 144 ms to paint one field where
 * 1.1 ms draws the same picture.
 *
 * It now builds a 256 step ramp per hue, writes one pixel per cell into an
 * ImageData, and scales it up with smoothing off. The risk that moves with that
 * is not speed, it is colour: the conversion from oklch to sRGB is now mine
 * instead of the browser's, and a conversion that is subtly wrong would repaint
 * every field on this page in slightly the wrong colour with nothing to say so.
 *
 * So the first half of this gate is not a unit test of my arithmetic against my
 * own expectations. It renders each colour twice, once through the browser's
 * `oklch()` parser and once through `oklchToRgb`, and requires them to agree.
 * The browser is the authority on what `oklch(0.6 0.12 148)` looks like.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The function under test, lifted out of the module as source so the page can
// run exactly what ships rather than a copy that has drifted.
const src = readFileSync(resolve(root, 'src/lib/attention.ts'), 'utf8')
const fn = src.slice(
  src.indexOf('export function oklchToRgb'),
  src.indexOf('\n}', src.indexOf('export function oklchToRgb')) + 2,
)
if (!fn.includes('0.3963377774')) {
  console.error('FAIL  could not lift oklchToRgb out of src/lib/attention.ts')
  process.exit(1)
}
const plain = fn
  .replace('export function oklchToRgb(L: number, C: number, hDeg: number): [number, number, number] {',
           'function oklchToRgb(L, C, hDeg) {')
  .replace('}) as [number, number, number]', '})')


let failed = 0

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

  // ---- half one: my conversion against the browser's ----------------------
  const colour = await page.evaluate(({ plain }) => {
    eval(plain)
    const c = document.createElement('canvas')
    c.width = 1
    c.height = 1
    const ctx = c.getContext('2d', { willReadFrequently: true })

    // The whole ramp the page actually uses, at both chroma levels, over every
    // hue the encodings and the heat map use.
    const worst = { diff: 0, at: null }
    let checked = 0
    for (const hue of [148, 155, 200, 250, 295, 45, 0, 359]) {
      for (let i = 0; i < 256; i += 3) {
        const v = i / 255
        const L = 0.18 + v * 0.62
        for (const C of [0.03 + v * 0.17, (0.03 + v * 0.17) * 0.25]) {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = `oklch(${L} ${C} ${hue})`
          ctx.fillRect(0, 0, 1, 1)
          const [br, bg, bb] = ctx.getImageData(0, 0, 1, 1).data
          const [mr, mg, mb] = oklchToRgb(L, C, hue)
          const d = Math.max(Math.abs(br - mr), Math.abs(bg - mg), Math.abs(bb - mb))
          checked++
          if (d > worst.diff) {
            worst.diff = d
            worst.at = { hue, L: +L.toFixed(4), C: +C.toFixed(4), browser: [br, bg, bb], mine: [mr, mg, mb] }
          }
        }
      }
    }
    return { worst, checked }
  }, { plain })

  // One unit per channel is the resolution of the format. Anything larger is a
  // different colour, not a rounding difference.
  if (colour.worst.diff > 1) {
    failed++
    console.error(`FAIL  oklchToRgb disagrees with the browser by ${colour.worst.diff} per channel`)
    console.error(`        ${JSON.stringify(colour.worst.at)}`)
  } else {
    console.log(
      `  ok      ${colour.checked.toLocaleString('en-US')} colours match the browser's own oklch parser, ` +
        `worst channel difference ${colour.worst.diff}`,
    )
  }

  // ---- half two: geometry, and the budget ---------------------------------
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 120_000 })

  // Measured at a full context, not at the six token sample the page opens on.
  // The audit's 144 ms was a 64 position field, which is 4,096 cells; six
  // positions is 36, and a budget met at 36 cells says nothing about 4,096.
  const LONG =
    'remind me to call my sister on Friday afternoon about the invoice for the kitchen ' +
    'lights and then add milk bread and coffee to the shopping list before the weather ' +
    'changes in Thessaloniki and cancel the alarm I set for seven thirty tomorrow'
  await page.fill('textarea', LONG)
  await page.waitForTimeout(1200)

  // The page's own large canvas is the thing that matters, so it is measured
  // rather than a synthetic one: select every head in turn and time the repaint
  // the visitor actually triggers.
  const perf = await page.evaluate(async () => {
    const cells = [...document.querySelectorAll('.headcell')]
    const times = []
    for (let i = 0; i < cells.length; i++) {
      const t0 = performance.now()
      cells[i].click()
      times.push(performance.now() - t0)
      await new Promise((r) => requestAnimationFrame(r))
    }
    times.sort((a, b) => a - b)
    return {
      heads: cells.length,
      medianMs: +times[Math.floor(times.length / 2)].toFixed(2),
      worstMs: +times[times.length - 1].toFixed(2),
      positions: document.querySelectorAll('.axis-token').length,
    }
  })

  // Generous against the 144 ms the audit measured, and far above what the
  // change achieves, because a gate set just under the current number fails on
  // a slow morning and teaches everyone to ignore it.
  const BUDGET_MS = 60
  if (perf.worstMs > BUDGET_MS) {
    failed++
    console.error(
      `FAIL  selecting a head took ${perf.worstMs} ms, over the ${BUDGET_MS} ms budget ` +
        `(median ${perf.medianMs} ms over ${perf.heads} heads)`,
    )
  } else {
    console.log(
      `  ok      selecting a head: ${perf.medianMs} ms median, ${perf.worstMs} ms worst, ` +
        `over ${perf.heads} heads at ${perf.positions} positions`,
    )
  }

  // Geometry: a field drawn from an identity matrix must be bright on the
  // diagonal and dark off it, which catches a transposed or offset write into
  // the pixel buffer that a colour test cannot see.
  const geom = await page.evaluate(() => {
    const c = document.querySelector('[data-field]')
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const n = document.querySelectorAll('.axis-token').length
    const cell = Math.min(c.width, c.height) / n
    const at = (q, k) => {
      const d = ctx.getImageData(Math.floor((k + 0.5) * cell), Math.floor((q + 0.5) * cell), 1, 1).data
      return d[0] + d[1] + d[2]
    }
    // Row 0 of a real field is the sentence vector and is never empty, so the
    // check is that the drawn image is not uniform: a buffer written wrong is
    // almost always flat.
    const vals = []
    for (let q = 0; q < n; q++) for (let k = 0; k < n; k++) vals.push(at(q, k))
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    return { n, min, max, spread: max - min }
  })

  if (geom.spread < 60) {
    failed++
    console.error(`FAIL  the drawn field is nearly uniform, spread ${geom.spread} over ${geom.n * geom.n} cells`)
  } else {
    console.log(`  ok      the drawn field has structure, spread ${geom.spread} over ${geom.n * geom.n} cells`)
  }

  /*
   * ---- half three: every thumbnail contains its own strongest link ---------
   *
   * The deep review measured this on the real page at 61 tokens and found **10
   * of the 24 thumbnails with a lower maximum than the head they claim to
   * show**. `drawField` writes one pixel per cell and scales, and a 44 pixel
   * backing store is a downscale past 44 tokens, with smoothing off, which is
   * point sampling: 48 percent of the cells were never read.
   *
   * Two things answer it and only one of them was in place. The canvas is 128
   * rather than 44, so at the 64 token maximum every cell gets two whole pixels
   * and there is no downscale left to go wrong. That is a number in a caller,
   * and `drawField` is exported and has two of them, so the second answer is in
   * the function: when the destination really is smaller than the field it now
   * max pools rather than point samples, which keeps every peak at full
   * strength instead of dropping or dimming it.
   *
   * This is the assertion the review asked for and nothing had: at a full
   * length sentence, each thumbnail's brightest pixel is as bright as the same
   * head drawn on the large canvas. Max pooling is what makes that an equality
   * rather than a tolerance. Averaging would divide a lone strong link by the
   * size of its block, and these thumbnails exist to be scanned for exactly
   * that kind of link.
   */
  // Longer than half two's sentence, and that is the point. Half two's gives 44
  // positions, and at 44 into a 128 pixel canvas every cell has almost three
  // pixels, so the downscale this half exists to catch cannot happen and the
  // gate would pass without testing anything. This one runs the context to its
  // 64 token ceiling, where a 44 pixel canvas would be dropping cells.
  const FULL =
    'remind me to call my sister on Friday afternoon about the invoice for the kitchen ' +
    'lights and then add milk bread and coffee to the shopping list before the weather ' +
    'changes in Thessaloniki and cancel the alarm I set for seven thirty tomorrow and ' +
    'send a message to Maria about the files she asked for yesterday evening after work ' +
    'and book a table for four at the place near the harbour on Saturday night please'
  await page.fill('textarea', FULL)
  await page.waitForFunction(() => document.querySelectorAll('.headcell').length > 0, null, { timeout: 60_000 })
  await page.waitForTimeout(700)

  const brightest = (sel, nth) =>
    page.evaluate(
      ({ sel, nth }) => {
        const canvas = nth === null ? document.querySelector(sel) : document.querySelectorAll(sel)[nth]
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let best = 0
        for (let i = 0; i < d.length; i += 4) {
          const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
          if (lum > best) best = lum
        }
        return best
      },
      { sel, nth },
    )

  // .axis-token, not .word. Words are what the visitor typed; positions are
  // what the model sees, and the tokenizer splits some words into several.
  // Half two already counts them this way and the first version of this half
  // did not, so it reported 57 for a field that was larger than that.
  const positions = await page.evaluate(() => document.querySelectorAll('.axis-token').length)
  const cells = await page.locator('.headcell canvas').count()
  /*
   * What this asserted until the thumbnails were given a shared scale: every
   * thumbnail's brightest pixel is as bright as the same head on the large
   * canvas. That worked while both normalised to their own field's peak, and it
   * became wrong the moment the grid started normalising to the cube's peak,
   * which is the point of a small multiple. 22 of 24 thumbnails are now
   * legitimately dimmer than the large canvas and should be.
   *
   * The purpose survives the proxy. It was never really about the large canvas;
   * it was that no cell gets dropped, and that the grid can be compared across.
   * Both are testable directly, and the second one is what the measurement audit
   * asked for:
   *
   *   the brightest thumbnail is the head with the strongest link
   *   the dimmest is measurably dimmer, which per field scaling made impossible
   *
   * The field peaks come off the page rather than out of the gate: the caption
   * under the large canvas prints "strongest single link N percent" for whatever
   * head is selected, so selecting each head in turn reads them all.
   */
  const heads = []
  for (let i = 0; i < cells; i++) {
    await page.locator('.headcell').nth(i).click()
    await page.waitForTimeout(90)
    const caption = (await page.textContent('[data-field-caption]')) ?? ''
    const strongest = Number(caption.match(/strongest single link (\d+) percent/)?.[1] ?? NaN)
    heads.push({ i, strongest, thumb: await brightest('.headcell canvas', i) })
  }

  const byPeak = [...heads].sort((a, b) => b.strongest - a.strongest)
  const byLight = [...heads].sort((a, b) => b.thumb - a.thumb)
  const spread = byLight[0].thumb - byLight[byLight.length - 1].thumb

  if (positions < 60) {
    failed++
    console.error(`FAIL  the test sentence made only ${positions} positions, too short to reach the downscale`)
  } else if (heads.some((h) => Number.isNaN(h.strongest))) {
    failed++
    console.error('FAIL  the caption did not report the strongest link for every head, so this cannot be checked')
  } else if (byLight[0].i !== byPeak[0].i) {
    failed++
    console.error(
      `FAIL  the brightest thumbnail is head ${byLight[0].i} and the strongest link is in head ${byPeak[0].i}`,
    )
    console.error('      the grid is not on one scale, so the panels cannot be compared with each other')
  } else if (spread < 20) {
    failed++
    console.error(`FAIL  all ${cells} thumbnails are within ${spread.toFixed(0)} of each other in brightness`)
    console.error(
      `      the field peaks run from ${byPeak[byPeak.length - 1].strongest} to ${byPeak[0].strongest} percent, ` +
        'so a grid where they all look alike is scaling each panel to itself',
    )
  } else {
    console.log(
      `  ok      the grid shares one scale: peaks ${byPeak[byPeak.length - 1].strongest} to ${byPeak[0].strongest} percent, ` +
        `brightness spread ${spread.toFixed(0)}, brightest is the strongest head`,
    )
  }

  /*
   * And the dimmest panel is still readable.
   *
   * The shared scale is what makes the grid honest and it is also what can make
   * it unreadable: with a linear ramp the weakest heads drew at 46 against a
   * page background of 6, near black squares whose structure could not be seen.
   * A square root between the value and the ramp lifts them without changing
   * anybody's order, and this is the assertion that stops the curve being
   * quietly removed.
   *
   * Both readings were taken on this gate's own sentence rather than on the
   * audit's, so the floor sits between comparable numbers: **40 with the linear
   * ramp, 75 with the square root**. 58 is roughly halfway, which gives the
   * failing case eighteen points of margin and the passing case seventeen. A
   * floor set at 70 would have had five points of room above the real reading,
   * which is the "one millisecond above the current number" mistake this
   * repository has already made once with a timing budget and once with a
   * character budget.
   */
  const FLOOR = 58
  const dimmest = byLight[byLight.length - 1]
  if (dimmest.thumb < FLOOR) {
    failed++
    console.error(
      `FAIL  the dimmest thumbnail peaks at ${dimmest.thumb.toFixed(0)}, under the ${FLOOR} floor`,
    )
    console.error(
      `      head ${dimmest.i} has a strongest link of ${dimmest.strongest} percent and cannot be read on the grid you pick from`,
    )
  } else {
    console.log(`  ok      the dimmest panel peaks at ${dimmest.thumb.toFixed(0)}, over the ${FLOOR} floor`)
  }

  // The curve is on the page, not only in the code. An undeclared transform on a
  // heat map is the other kind of dishonest.
  const note = (await page.textContent('[data-attention-note]')) ?? ''
  if (!/square root/i.test(note)) {
    failed++
    console.error('FAIL  the colour is not linear in the value and the page does not say so')
  } else {
    console.log('  ok      the page declares the curve it draws with')
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error(`\n${failed} drawing checks failed.`)
  process.exit(1)
}

console.log('drawing: colours match the browser, a head switch is inside budget, the field has structure')
