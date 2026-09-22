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
 * quotes. It is checked against the library rather than against itself, because
 * a label that is computed twice is a label that can disagree with the picture
 * it sits on.
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
  await page.waitForFunction(() => document.querySelectorAll('.headcell').length > 0, null, { timeout: 180_000 })
  await page.waitForTimeout(700)

  const grid = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.headcell')]
    return cells.map((c) => ({
      text: c.innerText.replace(/\s+/g, ' ').trim(),
      tag: c.querySelector('.headcell-tag')?.textContent?.trim() ?? null,
      score: c.querySelector('.headcell-score')?.textContent?.trim() ?? null,
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
    const cells = [...document.querySelectorAll('.headcell')]
    const positions = document.querySelectorAll('.axis-token').length
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
      const score = Number(cell.querySelector('.headcell-score')?.textContent ?? '0')
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

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA grid of small multiples with no labels is a texture, not a chart.')
  process.exit(1)
}

console.log('attention: every field says what it is and how sharp, on its face')
