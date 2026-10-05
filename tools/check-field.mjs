/**
 * The big field holds its size on the page and its resolution in the file.
 *
 *   npm run check:field
 *
 * WD-F13, the design eye pass of 22 September: "the big canvas resizes as you
 * type, so the only thing that moves is the layout". Measured again at tick
 * 208, typing one sentence at six lengths:
 *
 *     8 tokens  canvas 540px   16 tokens  canvas 540px
 *     the element: 540 throughout, 0 pixels of movement
 *     the audit measured 240 at 30 characters and 390 at 73, moving 183
 *
 * It does not reproduce. The fix is the one the audit asked for and it is in
 * two halves: `drawField` still sizes the **backing store** by the token count,
 * `min(520, max(240, positions * 26))`, and the stylesheet gives the element
 * `width: 100%` and `aspect-ratio: 1`, so the frame is constant and the grid
 * inside it gets finer as the sentence grows. The 35 pixels that still move
 * while typing are the tag row taking a second line, which is the reader's own
 * words and not the furniture.
 *
 * `check:motion` holds the half that was fixed, and it bites: tying the element
 * back to its backing store makes it report "the attention field took 3
 * different widths while typing".
 *
 * ## The half nobody was watching
 *
 * The other half had nothing at all. Measured at tick 208 on a 47 token
 * sentence, with the backing store frozen at its floor of 240:
 *
 *     backing 520, 11.06 pixels a cell, 3,991 distinct colours
 *     backing 240,  5.11 pixels a cell,   138 distinct colours
 *
 * Ninety six percent of the picture's colour gone, and `check:draw`,
 * `check:motion`, `check:attention` and `check:axes` all passed. The thumbnails
 * have had this assertion since WDR-F3, where drawing a 61 token field into a
 * 44 pixel canvas dropped 48 percent of the cells; the field that the whole
 * page is built around had never been asked.
 *
 * So this gate holds both halves in one place: the element's width is the
 * column's, whatever the sentence, and the backing store is the sentence's,
 * whatever the column.
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/*
 * Whole pixels a cell at the longest sentence this page accepts, and how much
 * colour the picture is left with. Both measured before they were written here:
 * 11.06 and 3,991 against 5.11 and 138 with the store frozen, so the floors are
 * well under what a correct page produces and well over what a broken one does.
 */
const PIXELS_A_CELL = 8
const COLOURS = 1000

const GROWING = [
  'remind me to',
  'remind me to call my sister on Friday',
  'remind me to call my sister on Friday afternoon about the invoice',
  'remind me to call my sister on Friday afternoon about the invoice for the kitchen lights',
]

const LONG =
  'remind me to call my sister on Friday afternoon about the invoice for the kitchen lights and then ' +
  'add milk bread and coffee to the shopping list before the weather changes in Thessaloniki and ' +
  'cancel the alarm I set for seven thirty tomorrow'

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

const LOOK = () => {
  const c = document.querySelector('[data-field]')
  const r = c.getBoundingClientRect()
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
  const seen = new Set()
  for (let i = 0; i < d.length; i += 4) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])
  const tokens = document.querySelectorAll('.axis-token').length
  return {
    tokens,
    backing: c.width,
    shown: Math.round(r.width),
    perCell: +(c.width / Math.max(1, tokens)).toFixed(2),
    colours: seen.size,
  }
}

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 })
  await page.goto(server.url)
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  await page.waitForTimeout(1200)

  /* 1. the element does not move while the sentence grows */
  const seen = []
  for (const text of GROWING) {
    await page.fill('textarea', text)
    await page.waitForTimeout(800)
    seen.push(await page.evaluate(LOOK))
  }
  const widths = [...new Set(seen.map((s) => s.shown))]
  if (widths.length > 1) {
    fail(
      `the field took ${widths.length} widths across ${seen.map((s) => s.tokens).join(', ')} tokens: ${widths.join(', ')}px`,
      'The frame is the column’s and the grid inside it is the sentence’s. Tying them together is what made the page slide while the picture sat still.',
    )
  } else {
    console.log(`  ok      the field holds ${widths[0]}px across ${seen.map((s) => s.tokens).join(', ')} tokens`)
  }

  /* 2. and the backing store does move, which is the half with no gate */
  const stores = [...new Set(seen.map((s) => s.backing))]
  if (stores.length < 2) {
    fail(
      `the backing store stayed at ${stores[0]} across ${seen.map((s) => s.tokens).join(', ')} tokens`,
      'Resolution is the thing that is supposed to follow the sentence. A constant store means the longest sentence is drawn at the shortest one’s detail.',
    )
  } else {
    console.log(`  ok      the backing store follows the sentence: ${stores.join(', ')}`)
  }

  /* 3. at the longest sentence, every cell still has whole pixels and the
        picture still has its colour */
  await page.fill('textarea', LONG)
  await page.waitForTimeout(1800)
  const long = await page.evaluate(LOOK)

  if (long.tokens < 40) {
    fail(`the long sentence came out as ${long.tokens} tokens, so this measured the easy case`)
  } else if (long.perCell < PIXELS_A_CELL) {
    fail(
      `at ${long.tokens} tokens each cell gets ${long.perCell} pixels of a ${long.backing} store, under ${PIXELS_A_CELL}`,
      'Below a few whole pixels a cell the drawing drops cells rather than blending them, which is WDR-F3 on the thumbnails.',
    )
  } else if (long.colours < COLOURS) {
    fail(
      `at ${long.tokens} tokens the field holds ${long.colours} distinct colours, under ${COLOURS}`,
      `${long.backing} store, ${long.perCell} pixels a cell. Frozen at its floor this reads 138, and every other drawing gate passes.`,
    )
  } else {
    console.log(
      `  ok      at ${long.tokens} tokens: ${long.backing} store, ${long.perCell} pixels a cell, ${long.colours} distinct colours`,
    )
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nThe frame is the column’s and the resolution is the sentence’s. Each needs the other held still.')
  process.exit(1)
}

console.log('field: the frame holds its size on the page and the grid inside it follows the sentence')
