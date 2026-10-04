/**
 * The bar measures against a scale, and never draws over its own number.
 *
 *   npm run check:race
 *
 * WD-F5. The bar was absolutely positioned against the whole row, so its width
 * was a percentage of a box that included the percentage column. Measured at
 * tick 196 on the sentence the page opens with:
 *
 *     leader 95.8%: bar right 1051, label 1036 to 1077
 *     15 of the label's 41 pixels sat on saturated orange, reading "95." "8%"
 *     the label starts 844 of 896 pixels along, so every leader above 94.2
 *     percent of the row was cut, which is the normal case here
 *
 * It is the most quoted number on the page, it is in the README's own picture,
 * and it was visibly broken in half. The bar lives in a track of its own now,
 * which is the name's column.
 *
 * ## What this holds
 *
 *   1. No bar ever reaches its own percentage label, at any probability. The
 *      assertion is overlap in pixels and the bar is pushed to 100 percent
 *      first, because the defect only appears on a confident answer and the
 *      page's opening sentence is one.
 *   2. The right corners are square. A rounded right edge makes a pill, and a
 *      pill of arbitrary length is a shape rather than a quantity: at 95
 *      percent the radius was rounding off the one end a reader reads.
 *   3. A losing row is still visible. At 0.1 percent the bar was a 1 pixel dot
 *      with a 6 pixel radius; `min-width` keeps it a hairline, and a scale
 *      whose smallest value disappears is a scale that cannot be read.
 *
 * The first assertion is measured at both 1280 and 390, because the label's
 * column is `auto` and the row's width is not, so the share at which the old
 * bug appeared moves with the viewport.
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

/** Every row's bar against its own label, plus what the bar is shaped like. */
const LOOK = () => {
  const out = []
  for (const li of document.querySelectorAll('.race li')) {
    const bar = li.querySelector('.bar')
    const pct = li.querySelector('.pct')
    if (!bar || !pct) continue
    const b = bar.getBoundingClientRect()
    const p = pct.getBoundingClientRect()
    const style = getComputedStyle(bar)
    out.push({
      text: pct.textContent.trim(),
      leader: li.classList.contains('is-leader'),
      overlap: Math.round(Math.max(0, Math.min(b.right, p.right) - Math.max(b.left, p.left))),
      labelWidth: Math.round(p.width),
      width: +b.width.toFixed(1),
      topRight: style.borderTopRightRadius,
      bottomRight: style.borderBottomRightRadius,
    })
  }
  return out
}

try {
  const browser = await chromium.launch()

  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    await page.goto(server.url)
    await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
    await page.waitForTimeout(1600)

    /*
     * The page's own answer first, then the same rows forced to the extremes.
     * A gate that only looks at whatever the model happened to say is a gate
     * whose coverage depends on the weights.
     */
    const cases = [
      ['as the page answers it', null],
      ['every row at 100 percent', 1],
      ['every row at 99.9 percent', 0.999],
      ['every row at 0.1 percent', 0.001],
    ]

    for (const [what, forced] of cases) {
      if (forced !== null) {
        await page.evaluate((p) => {
          for (const li of document.querySelectorAll('.race li')) li.style.setProperty('--p', String(p))
        }, forced)
        await page.waitForTimeout(350)
      }
      const rows = await page.evaluate(LOOK)
      if (rows.length === 0) {
        fail(`at ${width}, ${what}: no rows on the page`)
        continue
      }
      const touching = rows.filter((r) => r.overlap > 0)
      if (touching.length > 0) {
        const worst = touching.sort((a, b) => b.overlap - a.overlap)[0]
        fail(
          `at ${width}, ${what}: ${touching.length} of ${rows.length} bars reach their own percentage`,
          `the worst puts ${worst.overlap} of ${worst.labelWidth} pixels of "${worst.text}" on the bar. ` +
            `A number drawn half on a saturated colour and half on the page is read as two numbers.`,
        )
      } else {
        console.log(`  ok      at ${width}, ${what}: no bar reaches its label, across ${rows.length} rows`)
      }

      if (forced === 0.001) {
        const vanished = rows.filter((r) => r.width < 2)
        if (vanished.length > 0) {
          fail(
            `at ${width}: ${vanished.length} bars are under 2 pixels wide at 0.1 percent`,
            'A scale whose smallest value disappears is a scale a reader cannot read.',
          )
        } else {
          console.log(`  ok      at ${width}: the smallest bar is still ${Math.min(...rows.map((r) => r.width))} pixels wide`)
        }
      }
    }

    const shape = (await page.evaluate(LOOK))[0]
    if (shape.topRight !== '0px' || shape.bottomRight !== '0px') {
      fail(
        `at ${width} the bar's right corners are rounded, ${shape.topRight} and ${shape.bottomRight}`,
        'A rounded end makes a pill, and a pill of arbitrary length is a shape rather than a quantity.',
      )
    } else {
      console.log(`  ok      at ${width} the bar ends square, so its length is the thing being read`)
    }
    await page.close()
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nThe most quoted number on this page is the one it was drawing over.')
  process.exit(1)
}

console.log('race: the bar measures against its own column and the percentage is read in one piece')
