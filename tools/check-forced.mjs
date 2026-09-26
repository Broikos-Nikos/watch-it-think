/**
 * The picture still means what it means when the system picks the colours.
 *
 *   npm run check:forced
 *
 * WP-F9. A canvas is pixels, so forced colours repaints everything around it
 * and leaves it exactly as drawn. Measured at tick 175, the same page in both
 * modes:
 *
 *   forced colours off   background rgb(8, 6, 4)      strongest cell 0,206,255
 *   forced colours on    background rgb(255,255,255)  strongest cell 0,206,255
 *
 * Nothing in the field moved, so against the new background the weakest cells,
 * which are unpainted and therefore white, became the quietest thing on screen
 * and the near black ones the loudest, which is the opposite of what the ramp
 * means. The strongest cell fell from 10.9:1 against the page to 1.9:1.
 *
 * The fix is not to override the reader's palette, it is to use it: under
 * forced colours the ramp runs from `Canvas` to `CanvasText`, read off the page
 * rather than guessed, with `Highlight` for the focused row.
 *
 * ## What is checked, in both modes
 *
 * Contrast against the page, never luminance. Brightness is not meaning: under
 * a light forced palette the strongest cell is the darkest one, and a gate
 * written around "brightest" would have called the fixed page broken and the
 * broken page fixed. The first version of this file did exactly that.
 *
 *   the head with the strongest link is the head whose thumbnail reaches
 *     farthest from the page background
 *   the faintest head stays measurably closer to it, so the grid is readable
 *     as a comparison rather than as twenty four squares
 *   the loudest cell on the page is legible against it, 3:1 or better
 *   and under forced colours the field is drawn in the system's own two
 *     colours rather than in this page's blue
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/** WCAG relative luminance, which is what a contrast ratio is built from. */
const rel = ([r, g, b]) => {
  const f = (c) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a, b) => {
  const [hi, lo] = rel(a) >= rel(b) ? [rel(a), rel(b)] : [rel(b), rel(a)]
  return (hi + 0.05) / (lo + 0.05)
}

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

/** The painted pixel farthest from the background, which is what "loudest" is. */
const farthest = (page, nth, bg) =>
  page.evaluate(
    ({ nth }) => {
      const c = document.querySelectorAll('.headcell canvas')[nth]
      const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data
      const out = []
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue
        out.push([d[i], d[i + 1], d[i + 2]])
      }
      return out
    },
    { nth },
  ).then((painted) => painted.reduce((best, c) => Math.max(best, contrast(c, bg)), 1))

try {
  const browser = await chromium.launch()

  for (const forcedColors of ['none', 'active']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1100 }, forcedColors })
    const page = await context.newPage()
    await page.goto(server.url)
    await page.waitForFunction(() => document.querySelectorAll('.headcell').length > 0, null, { timeout: 180_000 })
    await page.waitForTimeout(400)

    const bg = await page.evaluate(() =>
      getComputedStyle(document.body)
        .backgroundColor.match(/\d+/g)
        .map(Number)
        .slice(0, 3),
    )

    /* Each head's own strongest link, read off the caption the page writes for
       whatever head is selected, and how far its thumbnail reaches from the
       page. The thumbnails share one scale, so the two orderings have to agree. */
    const heads = []
    const cells = await page.locator('.headcell').count()
    for (let i = 0; i < cells; i++) {
      await page.locator('.headcell').nth(i).click()
      await page.waitForTimeout(60)
      const caption = (await page.textContent('[data-field-caption]')) ?? ''
      heads.push({
        i,
        link: Number(caption.match(/strongest single link (\d+) percent/)?.[1] ?? NaN),
        reach: await farthest(page, i, bg),
      })
    }

    const byLink = [...heads].sort((a, b) => b.link - a.link)
    const byReach = [...heads].sort((a, b) => b.reach - a.reach)
    const loudest = byReach[0]
    const quietest = byReach[byReach.length - 1]

    if (heads.some((h) => Number.isNaN(h.link))) {
      fail(`forced colours ${forcedColors}: the caption did not report a strongest link for every head`)
    } else if (byReach[0].i !== byLink[0].i) {
      fail(
        `forced colours ${forcedColors}: head ${byLink[0].i} has the strongest link at ${byLink[0].link} percent and head ${byReach[0].i} reaches farthest from the page`,
        `${byReach[0].reach.toFixed(1)}:1 against ${byLink[0].reach.toFixed(1)}:1. The picture is upside down: the faint heads are the loud ones.`,
      )
    } else if (loudest.reach / quietest.reach < 1.5) {
      fail(
        `forced colours ${forcedColors}: every head reaches about as far, ${quietest.reach.toFixed(1)}:1 to ${loudest.reach.toFixed(1)}:1`,
        'The grid is a comparison, and a comparison where everything looks the same is a picture of nothing.',
      )
    } else {
      console.log(
        `  ok      forced colours ${forcedColors}: the strongest head is the loudest, ` +
          `${loudest.reach.toFixed(1)}:1 against ${quietest.reach.toFixed(1)}:1 for the faintest`,
      )
    }

    if (loudest.reach < 3) {
      fail(
        `forced colours ${forcedColors}: the loudest cell on the page is ${loudest.reach.toFixed(1)}:1 against the background`,
        `the background is rgb(${bg.join(', ')}). The picture is the argument, so its loudest part has to be legible.`,
      )
    } else {
      console.log(`  ok      forced colours ${forcedColors}: the loudest cell is ${loudest.reach.toFixed(1)}:1 against the page`)
    }

    /*
     * And under forced colours it is the system's colours, not this page's.
     * Chromium's forced palette is monochrome, so a painted cell still
     * carrying the page's blue is a canvas that opted out on the reader's
     * behalf.
     */
    if (forcedColors === 'active') {
      const sample = await page.evaluate(() => {
        const c = document.querySelector('[data-field]')
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data
        let worst = [0, 0, 0]
        let spread = -1
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] === 0) continue
          const s = Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2])
          if (s > spread) {
            spread = s
            worst = [d[i], d[i + 1], d[i + 2]]
          }
        }
        return { worst, spread }
      })
      if (sample.spread > 24) {
        fail(
          `the field keeps this page's own colours under forced colours: rgb(${sample.worst.join(', ')})`,
          'Forced colours means the reader has told the browser which colours they can see.',
        )
      } else {
        console.log(`  ok      and every cell is within ${sample.spread} of grey, in the system's own two colours`)
      }
    }

    await context.close()
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nThe page can be told what colours to use. It cannot be told what the picture means.')
  process.exit(1)
}

console.log('forced: the strongest head is the loudest one, in this page’s colours and in the system’s')
