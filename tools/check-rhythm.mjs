/**
 * The air down this page says which part is the answer.
 *
 *   npm run check:rhythm
 *
 * WD-F11, the design eye pass of 22 September: "the rhythm gives the answer the
 * same air as a row of chips". Measured again at tick 206 at 1280, and it had
 * got worse rather than better:
 *
 *     the box to the chips            20
 *     the chips to the telemetry      20
 *     the telemetry to the answer     20
 *     the answer to the race          20
 *     the race to the tags            20
 *     the tags to the attention       20
 *
 * Six identical gaps: a layout saying that `light.control 95.8%` matters
 * exactly as much as the grey line of timings above it. The audit filed it as
 * 16 16 16 20 20 20, and tick 205 put every value on a scale and made the last
 * of the difference disappear, which is what tidying costs when it happens
 * before deciding what the tidiness is for.
 *
 * Three tiers now, and this gate is the statement of them:
 *
 *   inside a group    the box, its chips and its telemetry are one thing
 *   under the answer  the race and the tags are its detail, bound close to it
 *   between regions   what you typed, what it answered, what it looked at
 *
 * ## Why this one opens a browser
 *
 * Unlike `check:type` and `check:tokens` beside it, the thing being asserted
 * here is not in the stylesheet. The gap between the tags and the attention
 * section is a container gap plus a margin plus a border, resolved by layout,
 * and three of the six distances on this page are that shape. A file gate would
 * be asserting the arithmetic it just did, which is WM2-F7's defect in reverse.
 *
 * The margin of 1 pixel is for the rounding at the edges of a flex gap, and the
 * tiers are compared to each other rather than to numbers: the gate asks that a
 * section break is more than twice an in-group gap, which is the thing a reader
 * sees, and not that it is 32 pixels, which is a decision the stylesheet is
 * allowed to revise.
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

/* The blocks a reader meets, in the order they meet them. */
const BLOCKS = [
  ['the box', 'textarea', 'input'],
  ['the chips', '.samples', 'input'],
  ['the telemetry', '.status', 'input'],
  ['the answer', '.verdict', 'answer'],
  ['the race', '.race', 'answer'],
  ['the tags', '.tags', 'answer'],
  ['the attention section', '.attention', 'evidence'],
]

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 }, deviceScaleFactor: 1 })
  await page.goto(server.url)
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  await page.waitForTimeout(1500)

  const boxes = await page.evaluate((blocks) => {
    return blocks
      .map(([name, sel, region]) => {
        const el = document.querySelector(sel)
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { name, region, top: +(r.top + window.scrollY).toFixed(1), bottom: +(r.bottom + window.scrollY).toFixed(1) }
      })
      .filter(Boolean)
  }, BLOCKS)

  if (boxes.length !== BLOCKS.length) {
    fail(
      `${boxes.length} of ${BLOCKS.length} blocks are on the page`,
      'The page has been rearranged and this gate is measuring something else.',
    )
  } else {
    const gaps = []
    for (let i = 1; i < boxes.length; i++) {
      gaps.push({
        from: boxes[i - 1].name,
        to: boxes[i].name,
        gap: +(boxes[i].top - boxes[i - 1].bottom).toFixed(1),
        across: boxes[i - 1].region !== boxes[i].region,
      })
    }

    const within = gaps.filter((g) => !g.across)
    const between = gaps.filter((g) => g.across)
    const widestWithin = Math.max(...within.map((g) => g.gap))
    const tightestBetween = Math.min(...between.map((g) => g.gap))

    /* 1. a region boundary is more air than anything inside a region */
    if (tightestBetween <= widestWithin * 2 - 1) {
      fail(
        `the smallest break between regions is ${tightestBetween} and the largest gap inside one is ${widestWithin}`,
        `${between.map((g) => `${g.from} to ${g.to} ${g.gap}`).join('; ')}. ` +
          'Six identical gaps is a page saying the answer matters as much as the timings above it.',
      )
    } else {
      console.log(`  ok      a region break is ${tightestBetween}px against ${widestWithin}px inside a region`)
    }

    /* 2. the answer's own detail is bound tighter than the input group */
    const underAnswer = gaps.filter((g) => g.from === 'the answer' || g.from === 'the race').map((g) => g.gap)
    const inInput = gaps.filter((g) => g.to === 'the chips' || g.to === 'the telemetry').map((g) => g.gap)
    if (Math.max(...underAnswer) >= Math.min(...inInput)) {
      fail(
        `the race and the tags sit ${underAnswer.join(' and ')} under the answer, against ${inInput.join(' and ')} inside the input group`,
        'They are the answer’s supporting detail. Detail that is no closer to its owner than anything else is not detail.',
      )
    } else {
      console.log(`  ok      the answer's detail is ${underAnswer.join(' and ')}px under it, inside ${inInput.join(' and ')}px groups`)
    }

    /* 3. and the distinct gaps are few */
    const distinct = [...new Set(gaps.map((g) => g.gap))].sort((a, b) => a - b)
    if (distinct.length > 4) {
      fail(
        `${distinct.length} distinct vertical gaps down the page: ${distinct.join(', ')}`,
        'Three tiers is the claim. A fourth is somebody adding air where it was needed.',
      )
    } else {
      console.log(`  ok      ${distinct.length} distinct gaps down the page: ${distinct.join(', ')}`)
    }
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nSpacing is how a layout says what is important. Six equal gaps say nothing is.')
  process.exit(1)
}

console.log('rhythm: three tiers of air, and the answer is the one with a region to itself')
