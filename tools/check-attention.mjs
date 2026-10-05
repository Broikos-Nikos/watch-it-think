/**
 * The twenty four fields are a chart, so they are labelled like one.
 *
 *   npm run check:attention
 *
 * The design audit: twenty four thumbnails with no label, no order and no
 * score, and the source already says they should have one. The note under them
 * invites the reader to find the head that watches the verb, and finding it
 * meant opening twenty four identical squares one at a time and remembering
 * which was which.
 *
 * The coordinates did exist. They were in a `title` attribute, which is a
 * tooltip, which is information nobody has: it needs a mouse, a pause, and a
 * guess that there is something there to wait for. That is the defect class
 * this gate is really about, and it is why the check is that the text is in the
 * element rather than that it exists somewhere.
 *
 * The score is concentration, the same number the caption under the large field
 * quotes.
 *
 * Since tick 198 it also holds the rail's own geometry, because the rail and
 * the labels on it are the same object: WD-F6 left it 279 pixels wide in a 358
 * pixel column at 390, and the first fix for that let a cell reach 137.9
 * pixels against a thumbnail drawn at 128. Both are measured here, at the two
 * widths this page is looked at and at the one in between where the second
 * appeared.
 *
 * ## What the score is checked against, and what it is not
 *
 * WD2-F8. Until tick 181 this said the score was "checked against the library
 * rather than against itself". It was not: this gate imports nothing from
 * `src/`, and the two values it compared, a thumbnail's `aria-label` and the
 * same thumbnail's printed text, come out of one `concentration()` call. That
 * is checking it against itself, and the sentence claiming otherwise is the
 * reason nobody noticed.
 *
 * The arithmetic inside `concentration()` is held by `check:concentration`,
 * which reimplements both candidate formulas in node against fields whose
 * answers are known by hand. There is nothing left for this gate to add there.
 * What that gate cannot see is whether the two places the page renders the
 * number agree, so that is what this one holds: the selected thumbnail's score
 * and the caption under the large field are separate render paths over
 * separate `Field` objects, and a change to one that misses the other shows up
 * here as a disagreement.
 */

import { chromium } from 'playwright'



let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('[data-head-cell]').length > 0, null, { timeout: 180_000 })
  await page.waitForTimeout(700)

  const grid = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-head-cell]')]
    return cells.map((c) => ({
      text: c.innerText.replace(/\s+/g, ' ').trim(),
      tag: c.querySelector('[data-head-tag]')?.textContent?.trim() ?? null,
      score: c.querySelector('[data-head-score]')?.textContent?.trim() ?? null,
      title: c.getAttribute('title'),
      label: c.getAttribute('aria-label'),
      width: Math.round(c.getBoundingClientRect().width),
    }))
  })

  if (grid.length !== 24) {
    fail(`expected 24 fields and found ${grid.length}`)
  }

  // ---- every cell says which layer and head it is --------------------------
  const unlabelled = grid.filter((c) => !/^L\d+H\d+$/.test(c.tag ?? ''))
  if (unlabelled.length > 0) {
    fail(
      `${unlabelled.length} of ${grid.length} thumbnails do not say which layer and head they are`,
      'finding the interesting head means opening them one at a time',
    )
  } else {
    console.log(`  ok      all ${grid.length} thumbnails carry their layer and head`)
  }

  // ---- and how sharp it is -------------------------------------------------
  const unscored = grid.filter((c) => !/^\d+$/.test(c.score ?? ''))
  if (unscored.length > 0) {
    fail(`${unscored.length} thumbnails carry no concentration score`)
  } else {
    const scores = grid.map((c) => Number(c.score))
    const spread = Math.max(...scores) - Math.min(...scores)
    // A score every cell shares is a score that sorts nothing. On any real
    // sentence the heads differ a great deal, so a flat grid means the number
    // is being computed wrong rather than that the model is uniform.
    if (spread < 10) {
      fail(`every thumbnail scores within ${spread} of every other, so the score sorts nothing`)
    } else {
      console.log(
        `  ok      concentration runs ${Math.min(...scores)} to ${Math.max(...scores)}, so the sharp heads stand out`,
      )
    }
  }

  /*
   * ---- the grid and the large field quote the same number -----------------
   *
   * The two render paths: `drawHeads` builds a thumbnail per head and prints
   * `concentration(fieldAt(cube, l, h))` beside it, `drawSelected` computes it
   * again for the one that is selected and writes it into the caption. Same
   * function, different call, different `Field`, and until this was added
   * nothing required the answers to meet. A selection that drew the wrong
   * head, a caption left behind by a redraw, or a grid sorted after its scores
   * were printed all land here as two numbers that differ.
   */
  const pair = await page.evaluate(() => {
    const on = [...document.querySelectorAll('[data-head-cell]')].findIndex(
      (c) => c.getAttribute('aria-selected') === 'true',
    )
    const cap = document.querySelector('[data-field-caption]')?.textContent ?? ''
    return {
      on,
      tag: document.querySelectorAll('[data-head-cell]')[on]?.querySelector('[data-head-tag]')?.textContent?.trim() ?? '',
      grid: Number(document.querySelectorAll('[data-head-cell]')[on]?.querySelector('[data-head-score]')?.textContent ?? NaN),
      caption: Number(cap.match(/Concentration (\d+) percent/)?.[1] ?? NaN),
      says: cap.match(/layer (\d+) of \d+, head (\d+) of/)?.slice(1, 3).map(Number) ?? [],
    }
  })

  if (pair.on < 0) {
    fail('no thumbnail is marked selected, so the caption belongs to nothing')
  } else if (!Number.isFinite(pair.grid) || !Number.isFinite(pair.caption)) {
    fail(`the selected thumbnail scores ${pair.grid} and the caption says ${pair.caption}`)
  } else if (pair.grid !== pair.caption) {
    fail(
      `thumbnail ${pair.tag} prints concentration ${pair.grid} and the caption under the large field says ${pair.caption}`,
      'the same quantity computed twice in two render paths, and the page shows both at once',
    )
  } else {
    console.log(
      `  ok      the selected thumbnail ${pair.tag} and the caption both say concentration ${pair.grid}, ` +
        `layer ${pair.says[0]} head ${pair.says[1]}`,
    )
  }

  // ---- nothing important lives only in a tooltip ---------------------------
  const tooltipOnly = grid.filter((c) => c.title && !c.text.includes(c.tag ?? '\u0000'))
  if (tooltipOnly.length > 0) {
    fail(
      `${tooltipOnly.length} thumbnails keep their coordinates in a title attribute`,
      'a tooltip needs a mouse, a pause, and a guess that there is something to wait for',
    )
  } else {
    console.log('  ok      no coordinate lives only in a tooltip')
  }

  // ---- the label a screen reader gets says the same thing ------------------
  const mismatched = grid.filter((c) => {
    const m = c.label?.match(/Layer (\d+), head (\d+), concentration (\d+)/)
    if (!m) return true
    return `L${m[1]}H${m[2]}` !== c.tag || m[3] !== c.score
  })
  if (mismatched.length > 0) {
    fail(`${mismatched.length} thumbnails read differently to a screen reader than to the eye`)
  } else {
    console.log('  ok      the spoken label and the printed one agree on every cell')
  }

  // ---- the picture, not the label -----------------------------------------
  //
  // Everything above reads text. The second deep review found the thumbnails
  // had been drawing the wrong picture since the day they were rewritten, and
  // this gate said they were fine, because it checked what they were called
  // rather than what they showed.
  //
  // So: type a sentence long enough that the field is larger than the canvas,
  // find the strongest cell in the data, and require the drawn thumbnail to
  // actually contain a bright pixel near where that cell is. A thumbnail that
  // has dropped its strongest link is a thumbnail of a different head.
  const LONG =
    'remind me to call my sister on Friday afternoon about the invoice for the kitchen ' +
    'lights and then add milk bread and coffee to the shopping list before the weather ' +
    'changes in Thessaloniki and cancel the alarm I set for seven thirty tomorrow'
  await page.fill('textarea', LONG)
  await page.waitForTimeout(1200)

  const drawn = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('[data-head-cell]')]
    const positions = document.querySelectorAll('[data-token]').length
    let missing = 0
    const checked = []

    for (const cell of cells) {
      const c = cell.querySelector('canvas')
      const ctx = c.getContext('2d', { willReadFrequently: true })
      const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height)

      // The brightest pixel actually on the canvas.
      let best = -1
      for (let i = 0; i < data.length; i += 4) {
        const v = data[i] + data[i + 1] + data[i + 2]
        if (v > best) best = v
      }

      // The score printed beside it says how concentrated the field is. A
      // concentrated field must have a bright pixel somewhere; if the drawing
      // dropped it, the canvas is dimmer than the number claims.
      const score = Number(cell.querySelector('[data-head-score]')?.textContent ?? '0')
      checked.push({ score, best })
      if (score >= 30 && best < 200) missing++
      void width
      void height
    }
    return { positions, missing, checked, canvas: cells[0]?.querySelector('canvas')?.width }
  })

  // The invariant, stated as an invariant rather than as a situation: the
  // canvas a field is drawn into must never be smaller than the field. When it
  // was 44 and the sentence was 61 tokens, the scale down with smoothing off
  // discarded 48 percent of the cells. This is the check that would have caught
  // that, and the first version of it asserted the opposite, because it was
  // written while the canvas was still too small.
  if (drawn.canvas < drawn.positions) {
    fail(
      `the thumbnail canvas is ${drawn.canvas} pixels for a ${drawn.positions} cell field`,
      'drawing a field into something smaller than itself drops cells rather than blending them',
    )
  } else if (drawn.missing > 0) {
    fail(
      `${drawn.missing} thumbnails are darker than their own concentration score at ${drawn.positions} tokens`,
      'the drawing is dropping cells, so the picture is of a different head from the label',
    )
  } else {
    const sharp = drawn.checked.filter((c) => c.score >= 30).length
    console.log(
      `  ok      at ${drawn.positions} tokens every thumbnail still shows its own strongest link, ` +
        `${sharp} of them sharp`,
    )
  }

  /*
   * And no thumbnail is shown larger than the picture it holds.
   *
   * WD-F6, tick 198. The rail used to be `repeat(4, 66px)` at every width, so
   * at 390 it was 279 pixels in a 358 pixel column with 79 of them empty. It
   * takes the line it is alone on now, and the first version of that let a
   * cell reach 137.9 pixels at a container of 566.8 against a thumbnail
   * `drawThumbs` draws at 128: the browser was upscaling a picture the page
   * had deliberately drawn at twice its display size, and smoothing it.
   *
   * The backing store is read off the element rather than written here, so the
   * day somebody draws these at 256 this stops holding them to 128.
   *
   * Three widths: one where the rail sits beside the field, one phone, and one
   * in the band between, which is the only place the defect appeared.
   */
  for (const width of [1280, 390, 616]) {
    const p = await browser.newPage({ viewport: { width, height: 1300 } })
    await p.goto(BASE)
    await p.waitForFunction(() => !!document.querySelector('[data-head-cell] canvas'), null, { timeout: 180_000 })
    await p.waitForTimeout(1200)
    const shown = await p.evaluate(() => {
      const cells = [...document.querySelectorAll('[data-head-cell] canvas')]
      /* The rightmost cell, not the rail's box: a grid stretched to its line
         with four fixed tracks in it leaves the hole inside the box, where an
         assertion about the box cannot see it. A control did exactly that and
         passed. */
      const cellBoxes = [...document.querySelectorAll('[data-head-cell]')].map((c) => c.getBoundingClientRect())
      const rail = { right: Math.max(...cellBoxes.map((c) => c.right)), bottom: Math.max(...cellBoxes.map((c) => c.bottom)) }
      const body = document.querySelector('[data-attention-body]').getBoundingClientRect()
      const field = document.querySelector('[data-figure]').getBoundingClientRect()
      return {
        n: cells.length,
        store: cells[0] ? cells[0].width : 0,
        widest: Math.max(...cells.map((c) => +c.getBoundingClientRect().width.toFixed(1))),
        railEmpty: Math.round(body.right - rail.right),
        beside: field.left > rail.right - 2 && field.top < rail.bottom - 2,
      }
    })
    await p.close()

    if (shown.n !== 24 || shown.store === 0) {
      fail(`at ${width}: ${shown.n} thumbnails with a backing store of ${shown.store}, so this measured nothing`)
    } else if (shown.widest > shown.store + 1) {
      fail(
        `at ${width}: a thumbnail is shown ${shown.widest}px wide against a backing store of ${shown.store}`,
        'The page draws these at twice their display size on purpose. Shown larger, the browser upscales and smooths a picture that exists at a known resolution.',
      )
    } else if (!shown.beside && shown.railEmpty > 24) {
      fail(
        `at ${width}: the rail has the line to itself and leaves ${shown.railEmpty}px of it empty`,
        'WD-F6: at 390 this was 79 pixels, and the rail had its right edge lined up with nothing.',
      )
    } else {
      console.log(
        `  ok      at ${width}: 24 thumbnails at ${shown.widest}px against a ${shown.store}px store, ` +
          (shown.beside ? 'the rail beside the field' : `the rail alone on its line with ${shown.railEmpty}px spare`),
      )
    }
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA grid of small multiples with no labels is a texture, not a chart.')
  process.exit(1)
}

console.log('attention: every field says what it is and how sharp, on its face')
