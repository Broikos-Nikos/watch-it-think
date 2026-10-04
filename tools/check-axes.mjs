/**
 * A label sits on the thing it names, or it is not a label.
 *
 *   npm run check:axes
 *
 * WD-F7. The element was called `.axis` and labelled "Tokens, in order", and it
 * was a wrapped flex row of chips sitting outside the figure. Measured at tick
 * 197, before:
 *
 *     the field starts at x=489, the axis at x=192, 297 pixels apart,
 *     and the axis sits 79 pixels below the field
 *     14 tokens: columns a uniform 42.8px, chips 25 to 94px
 *
 * So a heat map whose rows and columns are both tokens shipped with no row
 * labels and no column labels, and the only way to know which column was
 * `weather` was to count. The caption spent two of its three sentences saying
 * in prose what an axis shows at a glance.
 *
 * Both axes are on the field's own grid now: `--n` divides the canvas, the
 * column axis and the row axis the same way, so a label is one column wide
 * because the grid says so rather than because a number was computed twice.
 *
 * ## What this holds
 *
 *   1. Every chip is its column's width, to a pixel, and the axis starts where
 *      the canvas starts. A chip that is 94 pixels over a 42.8 pixel column is
 *      not pointing at anything.
 *   2. There is one row label per token, each the height of its row, starting
 *      where the canvas starts. The matrix is square and its labels are too.
 *   3. Under the threshold the row axis is hidden and the column axis is not.
 *      A row of two character stubs is a texture pretending to be an axis, so
 *      the labels go; but the chips are also the only way to pin a token with a
 *      pointer, so they stay, as a wrapped strip that claims no alignment.
 *      Hiding both was the first attempt and it broke `check:pin` at 47 tokens
 *      and left `check:axis` measuring a widest chip of 0 pixels and passing.
 *   4. The chips are still buttons, still one per token, at every length. The
 *      axis is a control as well as a label, and four other gates count these
 *      elements.
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/* The threshold `drawAxis` uses. Stated here so the two cannot drift silently:
   if the page changes its mind about when a label stops being readable, this
   fails rather than following it. */
const FITS = 24

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

const LOOK = () => {
  const canvas = document.querySelector('[data-field]')
  const field = document.querySelector('.field')
  const chips = [...document.querySelectorAll('.axis-token')]
  const rows = [...document.querySelectorAll('.field-row')]
  const c = canvas.getBoundingClientRect()
  const n = chips.length || rows.length
  return {
    tokens: Number(getComputedStyle(field).getPropertyValue('--n')) || 0,
    fits: field.dataset.axisFits,
    column: +(c.width / Math.max(1, n)).toFixed(2),
    canvasLeft: +c.left.toFixed(1),
    canvasTop: +c.top.toFixed(1),
    chips: chips.length,
    buttons: chips.filter((x) => x.tagName === 'BUTTON').length,
    chipLeft: chips.length ? +chips[0].getBoundingClientRect().left.toFixed(1) : null,
    chipWidths: chips.map((x) => +x.getBoundingClientRect().width.toFixed(2)),
    chipLines: new Set(chips.map((x) => Math.round(x.getBoundingClientRect().top))).size,
    rows: rows.length,
    rowTop: rows.length ? +rows[0].getBoundingClientRect().top.toFixed(1) : null,
    rowHeights: rows.map((x) => +x.getBoundingClientRect().height.toFixed(2)),
    axisShown: chips.length > 0 && getComputedStyle(document.querySelector('.axis')).display !== 'none',
    rowsShown: getComputedStyle(document.querySelector('.field-rows')).display !== 'none',
    chipsClickable: chips.filter((x) => {
      const r = x.getBoundingClientRect()
      return r.width >= 8 && r.height >= 8 && getComputedStyle(x).visibility === 'visible'
    }).length,
    fieldLeft: +document.querySelector('.field').getBoundingClientRect().left.toFixed(1),
  }
}

const SENTENCES = [
  ['six tokens, the opening sentence', null],
  ['fourteen tokens', 'what is the weather in Thessaloniki tomorrow and is it going to rain'],
  [
    'forty seven tokens',
    'remind me to call my sister on Friday afternoon about the invoice for the kitchen lights and then ' +
      'add milk bread and coffee to the shopping list before the weather changes in Thessaloniki and ' +
      'cancel the alarm I set for seven thirty tomorrow',
  ],
]

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
  await page.goto(server.url)
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  await page.waitForTimeout(1200)

  for (const [what, text] of SENTENCES) {
    if (text) {
      await page.fill('textarea', text)
      await page.waitForTimeout(1800)
    }
    const r = await page.evaluate(LOOK)

    if (r.tokens === 0) {
      fail(`${what}: the field carries no --n, so nothing divides the axes`)
      continue
    }

    /* 4, first, because the rest assume the chips exist. */
    if (r.chips !== r.tokens || r.buttons !== r.chips) {
      fail(
        `${what}: ${r.chips} chips for ${r.tokens} tokens, ${r.buttons} of them buttons`,
        'The axis is a control as well as a label.',
      )
      continue
    }

    const wide = r.column >= FITS
    if (r.fits !== (wide ? 'yes' : 'no')) {
      fail(`${what}: a column is ${r.column}px and the page says it fits=${r.fits}`)
    }

    if (!wide) {
      /*
       * Only the labelling stands down.
       *
       * The row axis labels and nothing else, so under the threshold it goes.
       * The chips label and also pin, and a page that answers a long sentence
       * by removing its own controls is worse than one with no column labels:
       * `check:pin` clicks the 41st chip of a 47 token sentence and timed out
       * on an invisible button when this branch hid both.
       */
      if (r.rowsShown) {
        fail(
          `${what}: a row is ${r.column}px, under ${FITS}, and the row labels are still drawn`,
          'A column of two character stubs is a texture pretending to be an axis.',
        )
      } else if (r.chipsClickable !== r.chips) {
        fail(
          `${what}: ${r.chips - r.chipsClickable} of ${r.chips} chips are not clickable at ${r.column}px a column`,
          'The chips are the only way to pin a token with a pointer, and a long sentence is when a reader needs one.',
        )
      } else if (r.chipLines < 2) {
        fail(
          `${what}: ${r.chips} chips on one line at ${r.column}px a column, so the strip is still claiming to be a scale`,
          'Under the threshold the chips are a control, and a control the width of a column points at nothing.',
        )
      } else if (Math.abs(r.chipLeft - r.fieldLeft) > 1) {
        fail(
          `${what}: the strip starts at x=${r.chipLeft} and the figure at x=${r.fieldLeft}`,
          'A control strip that is not a scale has no reason to be indented into the canvas column.',
        )
      } else {
        console.log(
          `  ok      ${what}: a column is ${r.column}px, under ${FITS}: the row labels stand down and ${r.chips} chips stay clickable across ${r.chipLines} lines`,
        )
      }
      continue
    }

    const offBy = r.chipWidths.filter((w) => Math.abs(w - r.column) > 1)
    if (offBy.length > 0) {
      fail(
        `${what}: ${offBy.length} of ${r.chips} chips are not their column's width`,
        `the column is ${r.column}px and the chips run ${Math.min(...r.chipWidths)} to ${Math.max(...r.chipWidths)}px. ` +
          'A chip wider than the column it names is not pointing at anything.',
      )
    } else if (Math.abs(r.chipLeft - r.canvasLeft) > 1) {
      fail(
        `${what}: the axis starts at x=${r.chipLeft} and the canvas at x=${r.canvasLeft}`,
        'An axis that does not begin where its scale begins is a legend.',
      )
    } else if (r.chipLines !== 1) {
      fail(`${what}: the axis wraps onto ${r.chipLines} lines, so a column has two labels under it`)
    } else {
      console.log(
        `  ok      ${what}: ${r.chips} chips of ${r.column}px each, starting at the canvas's own x=${r.canvasLeft}`,
      )
    }

    const rowsOff = r.rowHeights.filter((h) => Math.abs(h - r.column) > 1)
    if (r.rows !== r.tokens) {
      fail(`${what}: ${r.rows} row labels for ${r.tokens} rows`)
    } else if (rowsOff.length > 0) {
      fail(`${what}: ${rowsOff.length} row labels are not their row's height`, `rows are ${r.column}px`)
    } else if (Math.abs(r.rowTop - r.canvasTop) > 1) {
      fail(`${what}: the row axis starts at y=${r.rowTop} and the canvas at y=${r.canvasTop}`)
    } else {
      console.log(`  ok      ${what}: ${r.rows} row labels of ${r.column}px each, starting at the canvas's own y`)
    }
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nAn unlabelled matrix with a chip cloud beside it is a texture, whatever the caption says.')
  process.exit(1)
}

console.log(
  'axes: both axes are on the field’s own grid, one label per track, until a track is too narrow to name and the labels stand down without taking the controls with them',
)
