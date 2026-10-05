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
  await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 120_000 })

  /* What the page opened with, read before any half of this gate types over
     it, so the short case in half three is the state a visitor meets rather
     than a sentence this file chose. */
  const OPENING = await page.inputValue('textarea')

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
    const cells = [...document.querySelectorAll('[data-head-cell]')]
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
      positions: document.querySelectorAll('[data-token]').length,
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

  /*
   * ---- and a head change touches nothing it did not have to ---------------
   *
   * WP-F3. Choosing a head called `drawAttention`, which rebuilds the grid and
   * the axis from scratch. Measured at tick 173 on this sentence, before the
   * fix: one click replaced **all 24 thumbnails, all 24 canvases and all 64
   * axis buttons**, zero of the 112 nodes surviving, for a change that altered
   * no data. 7 ms, so it was never a delay; it was the axis being replaced
   * under a pointer that was resting on it and every canvas repainting to draw
   * what it already showed.
   *
   * Node identity is the assertion rather than a timing, because a faster
   * rebuild is still a rebuild and a budget would pass one. The three
   * attributes that are allowed to change are checked on the other side: one
   * cell selected, and it is the one that was clicked.
   */
  const reuse = await page.evaluate(async () => {
    for (const sel of ['.headcell', '.headcell canvas', '.axis-token']) {
      document.querySelectorAll(sel).forEach((n, i) => {
        n.__mark = i
      })
    }
    const cells = [...document.querySelectorAll('[data-head-cell]')]
    const target = cells.findIndex((c) => c.getAttribute('aria-selected') !== 'true')
    cells[target].click()
    await new Promise((r) => requestAnimationFrame(r))
    const kept = (sel) => [...document.querySelectorAll(sel)].filter((n) => n.__mark !== undefined).length
    const now = [...document.querySelectorAll('[data-head-cell]')]
    return {
      target,
      heads: { kept: kept('.headcell'), of: now.length },
      canvases: { kept: kept('.headcell canvas'), of: document.querySelectorAll('[data-head-cell] canvas').length },
      axis: { kept: kept('.axis-token'), of: document.querySelectorAll('[data-token]').length },
      selected: now.map((c, i) => [i, c.getAttribute('aria-selected') === 'true', c.classList.contains('is-on'), c.tabIndex === 0]),
      caption: document.querySelector('[data-field-caption]')?.textContent ?? '',
    }
  })

  const replaced = ['heads', 'canvases', 'axis'].filter((k) => reuse[k].kept < reuse[k].of)
  if (replaced.length > 0) {
    failed++
    console.error(
      `FAIL  choosing a head replaced ${replaced.map((k) => `${reuse[k].of - reuse[k].kept} of ${reuse[k].of} ${k}`).join(', ')}`,
    )
    console.error('      nothing about the data changed, so nothing about those elements had to')
  } else {
    console.log(
      `  ok      choosing a head keeps all ${reuse.heads.of} thumbnails, ${reuse.canvases.of} canvases and ${reuse.axis.of} axis chips`,
    )
  }

  const lit = reuse.selected.filter(([, sel, on, tab]) => sel || on || tab)
  if (lit.length !== 1 || lit[0][0] !== reuse.target || !lit[0].slice(1).every(Boolean)) {
    failed++
    console.error(
      `FAIL  head ${reuse.target} was chosen and the grid marks ${JSON.stringify(lit)} as selected, on, or holding the tab stop`,
    )
  } else {
    console.log(`  ok      exactly one cell is selected afterwards, and it is the one that was clicked`)
  }

  /*
   * ---- the picture is drawn the way the caption says it is read -----------
   *
   * WD2-F8. Until tick 181 this comment said "a field drawn from an identity
   * matrix must be bright on the diagonal and dark off it, which catches a
   * transposed or offset write into the pixel buffer". No identity matrix was
   * ever drawn, and the assertion underneath was `max - min >= 60` over every
   * cell, which is a function of the multiset of cell values. Measured on the
   * opening sentence at tick 181:
   *
   *   drawn field          spread 461
   *   its transpose        spread 461
   *   shifted one column   spread 461
   *
   * A permutation of the cells cannot change it, so the assertion was
   * bit for bit blind to both defects its comment named, on the only page in
   * this project where the orientation of the field is claimed to be checked.
   *
   * Statistics on the pixels will not do it either, and that was measured
   * before this was written: the field is row stochastic, so every row has a
   * bright cell and some columns have none, but the ramp is nonlinear and the
   * signature does not survive it. Over 24 head-and-length combinations the
   * row form of `concentration()` recomputed from brightness beat the column
   * form every time and by as little as 0.001, which is a coin toss, not a
   * gate.
   *
   * So the page publishes the coordinate instead. `drawSelected` writes the
   * argmax of the field to `data-strongest` and names the two tokens in the
   * caption, and this requires the brightest drawn cell to sit at that row and
   * that column. A transposed write puts it at (k, q) and fails here whenever
   * the strongest link is not on the diagonal; an offset write moves it by a
   * cell and fails always. The gate refuses a field whose strongest link is on
   * the diagonal rather than passing it, because on such a field the
   * assertion cannot tell the two orientations apart and a green tick would be
   * a lie about what was checked.
   */
  const geom = await page.evaluate(() => {
    const c = document.querySelector('[data-field]')
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const n = document.querySelectorAll('[data-token]').length
    const cell = Math.min(c.width, c.height) / n
    const img = ctx.getImageData(0, 0, c.width, c.height).data
    const at = (q, k) => {
      const i = (Math.floor((q + 0.5) * cell) * c.width + Math.floor((k + 0.5) * cell)) * 4
      return img[i] + img[i + 1] + img[i + 2]
    }
    let best = -1
    let bq = -1
    let bk = -1
    const vals = []
    for (let q = 0; q < n; q++) {
      for (let k = 0; k < n; k++) {
        const v = at(q, k)
        vals.push(v)
        if (v > best) {
          best = v
          bq = q
          bk = k
        }
      }
    }
    const said = (c.dataset.strongest ?? '').split(',').map(Number)
    return { n, bq, bk, said, best, spread: Math.max(...vals) - Math.min(...vals) }
  })

  const [sq, sk] = geom.said
  if (!Number.isInteger(sq) || !Number.isInteger(sk)) {
    failed++
    console.error(`FAIL  the canvas publishes no data-strongest, so nothing states where the field's strongest link is`)
  } else if (sq === sk) {
    failed++
    console.error(
      `FAIL  the strongest link is on the diagonal, at (${sq}, ${sk}), so this assertion cannot tell a row major field from a transposed one`,
    )
    console.error('      pick a sentence whose strongest link is off the diagonal rather than letting the check pass vacuously')
  } else if (geom.bq !== sq || geom.bk !== sk) {
    failed++
    console.error(
      `FAIL  the caption says the strongest link is row ${sq} column ${sk} and the brightest drawn cell is row ${geom.bq} column ${geom.bk}`,
    )
    console.error(
      `      ${geom.bq === sk && geom.bk === sq ? 'that is the transpose of it: rows are being drawn as columns' : 'the buffer and the coordinate disagree, so one of them is written wrong'}`,
    )
  } else {
    console.log(
      `  ok      the brightest drawn cell is at row ${sq} column ${sk}, off the diagonal, where the caption says the strongest link is`,
    )
  }

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
  await page.waitForFunction(() => document.querySelectorAll('[data-head-cell]').length > 0, null, { timeout: 60_000 })
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
  const positions = await page.evaluate(() => document.querySelectorAll('[data-token]').length)
  const cells = await page.locator('[data-head-cell] canvas').count()
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
   * Both of those are in `judge` below, which runs twice: on this half's long
   * sentence and on the sample the page opens with.
   */
  /*
   * One reading of the grid: a click per head for its caption, and the pixels
   * of its thumbnail for its brightness.
   */
  const readGrid = async () => {
    const heads = []
    for (let i = 0; i < cells; i++) {
      await page.locator('[data-head-cell]').nth(i).click()
      await page.waitForTimeout(90)
      const caption = (await page.textContent('[data-field-caption]')) ?? ''
      const strongest = Number(caption.match(/strongest single link (\d+) percent/)?.[1] ?? NaN)
      heads.push({ i, strongest, thumb: await brightest('.headcell canvas', i) })
    }
    const byPeak = [...heads].sort((a, b) => b.strongest - a.strongest)
    const byLight = [...heads].sort((a, b) => b.thumb - a.thumb)
    return { heads, byPeak, byLight, spread: byLight[0].thumb - byLight[byLight.length - 1].thumb }
  }

  /*
   * And the floor under the dimmest panel.
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
   * ramp, 76 with the square root**. That second figure was 75 until tick 184,
   * when `rampStep` stopped truncating the table index and every cell moved up
   * by the half step it had been losing. 58 is roughly halfway, which gives the
   * failing case eighteen points of margin and the passing case seventeen. A
   * floor set at 70 would have had five points of room above the real reading,
   * which is the "one millisecond above the current number" mistake this
   * repository has already made once with a timing budget and once with a
   * character budget.
   */
  const FLOOR = 58

  /**
   * The three things the measurement audit asked for, on one sentence:
   *
   *   the brightest thumbnail is the head with the strongest link
   *   the dimmest is measurably dimmer, which per field scaling made impossible
   *   and it is still readable
   *
   * The field peaks come off the page rather than out of the gate: the caption
   * under the large canvas prints "strongest single link N percent" for
   * whatever head is selected, so selecting each head in turn reads them all.
   */
  const judge = (label, g) => {
    if (g.heads.some((h) => Number.isNaN(h.strongest))) {
      failed++
      console.error(`FAIL  ${label}: the caption did not report the strongest link for every head, so this cannot be checked`)
    } else if (g.spread < 20) {
      /* Asked before the ranking, because per field scaling puts every panel at
         the same maximum and the ranking then fails on whichever index the sort
         happened to leave first, which is a true failure with a misleading
         sentence attached. Measured with the scale removed: all twenty four
         peak at 166 and the spread is 0. */
      failed++
      console.error(`FAIL  ${label}: all ${cells} thumbnails are within ${g.spread.toFixed(0)} of each other in brightness`)
      console.error(
        `      the field peaks run from ${g.byPeak[g.byPeak.length - 1].strongest} to ${g.byPeak[0].strongest} percent, ` +
          'so a grid where they all look alike is scaling each panel to itself',
      )
    } else if (g.byLight[0].i !== g.byPeak[0].i) {
      failed++
      console.error(`FAIL  ${label}: the brightest thumbnail is head ${g.byLight[0].i} and the strongest link is in head ${g.byPeak[0].i}`)
      console.error('      the grid is not on one scale, so the panels cannot be compared with each other')
    } else {
      console.log(
        `  ok      ${label}: peaks ${g.byPeak[g.byPeak.length - 1].strongest} to ${g.byPeak[0].strongest} percent, ` +
          `brightness spread ${g.spread.toFixed(0)}, brightest is the strongest head`,
      )
    }

    const dimmest = g.byLight[g.byLight.length - 1]
    if (dimmest.thumb < FLOOR) {
      failed++
      console.error(`FAIL  ${label}: the dimmest thumbnail peaks at ${dimmest.thumb.toFixed(0)}, under the ${FLOOR} floor`)
      console.error(
        `      head ${dimmest.i} has a strongest link of ${dimmest.strongest} percent and cannot be read on the grid you pick from`,
      )
    } else {
      console.log(`  ok      ${label}: the dimmest panel peaks at ${dimmest.thumb.toFixed(0)}, over the ${FLOOR} floor`)
    }
  }

  if (positions < 60) {
    failed++
    console.error(`FAIL  the test sentence made only ${positions} positions, too short to reach the downscale`)
  }
  judge('at 64 positions', await readGrid())

  /*
   * And again on the sentence a visitor actually meets.
   *
   * WM-F9 measured the spread on one long sentence and so did this gate, which
   * left the opening state untested: six positions, a 6 by 6 field where every
   * row sums to one over six cells rather than sixty four, so the peaks are
   * high everywhere and a grid scaled per panel would look most alike exactly
   * where every visitor sees it first. Measured at tick 172 on the default
   * sample: peaks 24 to 96 percent, brightness 85 to 166, spread 81, and the
   * brightest panel is the strongest head. It holds, and now it is held.
   */
  await page.fill('textarea', '')
  await page.fill('textarea', OPENING)
  await page.waitForTimeout(700)
  const short = await page.evaluate(() => document.querySelectorAll('[data-token]').length)
  if (short > 12) {
    failed++
    console.error(`FAIL  the opening sample made ${short} positions, so this is not the short case it exists for`)
  }
  judge(`at ${short} positions, the opening sample`, await readGrid())

  // The curve is on the page, not only in the code. An undeclared transform on a
  // heat map is the other kind of dishonest.
  const note = (await page.textContent('[data-attention-note]')) ?? ''
  if (!/square root/i.test(note)) {
    failed++
    console.error('FAIL  the colour is not linear in the value and the page does not say so')
  } else {
    console.log('  ok      the page declares the curve it draws with')
  }

  /*
   * ---- half five: the sweep, on a processor a sixth as fast -----------------
   *
   * WP-F6: sweeping the pointer across the axis redraws the 520 pixel field
   * synchronously per token, 47 fps on a desktop and 11 on a mid range phone.
   * It went with WP-F2, the drawing rewrite, which is what `same_root_as` on
   * the finding says and what the numbers confirm. Measured at tick 174, a
   * full 64 token sweep:
   *
   *   cpu x1   median 0.20 ms   p95 0.4   worst 0.8   total 15.9
   *   cpu x4   median 0.80 ms   p95 1.8   worst 4.0   total 64.3
   *   cpu x6   median 1.30 ms   p95 3.0   worst 5.5   total 97.6
   *
   * And 4.3 median, 9.3 at p95 when the sweep runs here, at the end of this
   * gate, on a page that has already had 24 canvases read pixel by pixel and
   * two sentences drawn through it. Both are the same page; the difference is
   * what the tab has been doing, which is worth knowing before reading a
   * budget that has to hold on a build machine.
   *
   * So the desktop reading is 5,000 fps equivalent and the slow one is 769,
   * against the 47 and 11 the audit measured. Nothing here needed fixing, and
   * nothing here was watching either: every budget in this file is measured on
   * whatever machine happens to run it, and this repository has never once
   * emulated the device the audit complained about.
   *
   * The events are dispatched rather than the mouse moved, because the cost
   * under test is the handler's, and a real sweep fires exactly these.
   */
  /* Back to the full sentence: half three left the six token sample in the
     box, and a sweep over six chips of a 36 cell field is not the sweep this
     is about. Measured both ways at tick 174 and the cost barely moves, 1.4 ms
     against 1.3, because it is dominated by the call rather than by the cells,
     which is itself worth knowing and is not a reason to test the small one. */
  await page.fill('textarea', FULL)
  await page.waitForFunction((n) => document.querySelectorAll('[data-token]').length > n, 40, { timeout: 60_000 })
  await page.waitForTimeout(500)

  const cdp = await page.context().newCDPSession(page)

  /*
   * And the throttle is proved before it is trusted. A gate that believes it is
   * measuring a slow machine, and is not, is the same failure as a control that
   * passes: this one costs a busy loop before and after to see the clock change.
   */
  const spin = () =>
    page.evaluate(() => {
      const t0 = performance.now()
      let n = 0
      while (performance.now() - t0 < 20) n++
      return n
    })
  const fast = await spin()
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  const slow = await spin()
  const ratio = fast / Math.max(slow, 1)

  if (ratio < 2) {
    failed++
    console.error(`FAIL  CPU throttling did not take: ${fast} iterations against ${slow} throttled, ratio ${ratio.toFixed(1)}`)
    console.error('      every number below would be this machine pretending to be a slower one')
  } else {
    console.log(
      `  ok      the throttle is real: ${slow.toLocaleString('en-US')} iterations in 20 ms against ` +
        `${fast.toLocaleString('en-US')} unthrottled, a ratio of ${ratio.toFixed(1)}`,
    )

    const sweep = await page.evaluate(() => {
      const tokens = [...document.querySelectorAll('[data-token]')]
      const per = []
      for (const t of tokens) {
        const t0 = performance.now()
        t.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }))
        per.push(performance.now() - t0)
        t.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))
      }
      per.sort((a, b) => a - b)
      return {
        n: tokens.length,
        median: +per[Math.floor(per.length / 2)].toFixed(2),
        p95: +per[Math.floor(per.length * 0.95)].toFixed(2),
        total: +per.reduce((a, b) => a + b, 0).toFixed(1),
      }
    })

    /*
     * One frame at 60 Hz is 16.7 ms, so a p95 inside a frame is a sweep that
     * keeps up with the display on a processor a sixth as fast as this one,
     * and the median at half a frame.
     *
     * Scaled by how fast this machine actually is at this moment, which the
     * busy loop above has just measured, and that is not a softening: written
     * as two absolute numbers at tick 174 it failed the very next morning at
     * 10.7 ms median, inside a suite run, while the same gate alone on the same
     * build read 2.4. The readings ranged 1.3, 2.4, 2.7, 3.8, 10.7 depending
     * only on what else the machine was doing, so an absolute millisecond
     * budget was measuring the load on the build agent and calling it the page.
     *
     * The reference is 16,000 throttled iterations in 20 ms, which is what an
     * idle run of this machine gives, and the scale is capped at six so a
     * machine on its knees cannot buy an unlimited budget.
     */
    const REFERENCE_ITERATIONS = 16_000
    const scale = Math.min(6, Math.max(1, REFERENCE_ITERATIONS / Math.max(slow, 1)))
    const MEDIAN_MS = +(8 * scale).toFixed(1)
    const P95_MS = +(16 * scale).toFixed(1)
    if (sweep.median > MEDIAN_MS || sweep.p95 > P95_MS) {
      failed++
      console.error(
        `FAIL  at cpu x6 a hover costs ${sweep.median} ms median and ${sweep.p95} ms at p95, over ${MEDIAN_MS} and ${P95_MS}`,
      )
      console.error(
        `      ${sweep.n} tokens, ${sweep.total} ms for the whole sweep, which is ${Math.round(1000 / sweep.median)} fps equivalent`,
      )
    } else {
      console.log(
        `  ok      at cpu x6 a hover costs ${sweep.median} ms median, ${sweep.p95} at p95, ` +
          `${sweep.total} ms for all ${sweep.n} tokens, against a budget of ${MEDIAN_MS} and ${P95_MS} ` +
          `at this machine's measured speed`,
      )
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error(`\n${failed} drawing checks failed.`)
  process.exit(1)
}

console.log('drawing: colours match the browser, a head switch is inside budget, the field has structure')
