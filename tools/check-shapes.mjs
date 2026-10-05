/**
 * The answer fills a shape that is already there.
 *
 *   npm run check:shapes
 *
 * WD-F12, the design eye pass of 22 September: "the state between loading and
 * answered is a hole, and the answer lands by shoving the input box 74 pixels
 * down the page". Measured again at tick 207, with the graph held back six
 * seconds so the loading state could be seen at all:
 *
 *     the box's top, loading 352.9, answered 352.9     the shove is gone
 *     the document, loading 1000, answered 1989        989 pixels in one frame
 *     the first screen, loading: painted down to y=565 of 1000
 *     clearing the box: back to 1000, and every one of those pixels again on
 *     the next keystroke
 *
 * The standfirst half of the finding had been fixed and nobody recorded it: the
 * text ships in the document and the box does not move. The collapse had not.
 *
 * The result section is in flow from first paint now, with `data-state` saying
 * whether it holds an answer, and `drawSkeleton` puts the same six rows and
 * twenty four cells there empty. What remains is 129 pixels: the figcaption
 * under the field, whose text is about the sentence, and a few line boxes that
 * only the answer can fill. The bar below is 160 rather than 0 because of them,
 * and the gate prints what it measured so the number cannot quietly grow back.
 *
 * ## What is held
 *
 *   1. The document is the same height within 160 pixels, waiting or answered.
 *   2. The box a visitor is typing in does not move between the two.
 *   3. Clearing the box does not scroll the reader and does not take the region
 *      out of flow.
 *   4. The waiting state says nothing a reader could take for an answer: no
 *      intent, no confidence, no percentage.
 *
 * ## One thing this gate does not claim
 *
 * ## Two things that looked like one, and the order they were untangled in
 *
 * The finding says a reader 933 pixels down who clears the box is thrown to the
 * top. Measuring that with `page.fill('')` is measuring the harness: fill
 * scrolls the element it fills into view, and on the fixed page it moved the
 * reader on its own. So this gate clears with an input event and no focus, and
 * on the fixed page the scroll stays at 933 before and after.
 *
 * Then the control put `hidden` back, and the throw happened anyway, with no
 * focus anywhere: the document collapses to 1000, the viewport is 1000, the
 * maximum scroll is 0 and the browser clamps. The finding was right, the first
 * reading of it was the instrument, and both are true at once. The assertion
 * below is the one that holds either way.
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/* What the two states may differ by, in pixels of document. */
const BUDGET = 160

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

const LOOK = () => ({
  doc: document.documentElement.scrollHeight,
  boxTop: +(document.querySelector('textarea').getBoundingClientRect().top + window.scrollY).toFixed(1),
  scrollY: Math.round(window.scrollY),
  state: document.querySelector('[data-result]')?.dataset.state ?? null,
  inFlow: (document.querySelector('[data-result]')?.getBoundingClientRect().height ?? 0) > 100,
  readable: [
    (document.querySelector('[data-intent]')?.textContent ?? '').trim(),
    (document.querySelector('[data-confidence]')?.textContent ?? '').trim(),
    ...[...document.querySelectorAll('[data-race] [data-row-pct]')].map((e) => e.textContent.trim()),
  ].filter(Boolean),
})

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1 })

  /*
   * The graph held back, because the loading state is the thing being measured
   * and it is over in 300 milliseconds against a local server. The audit could
   * only describe it; this reproduces it.
   */
  await page.route('**/*.onnx', async (route) => {
    await new Promise((r) => setTimeout(r, 5000))
    await route.continue()
  })

  await page.goto(server.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(700)
  const waiting = await page.evaluate(LOOK)

  await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 180_000 })
  await page.waitForTimeout(1500)
  const answered = await page.evaluate(LOOK)

  /* 1. the same height */
  const grew = answered.doc - waiting.doc
  if (Math.abs(grew) > BUDGET) {
    fail(
      `the document grows ${grew} pixels when the answer lands, over a budget of ${BUDGET}`,
      `${waiting.doc} waiting, ${answered.doc} answered. It was 989 before this gate existed, and that is a page rearranging itself under the reader.`,
    )
  } else {
    console.log(`  ok      the document grows ${grew}px when the answer lands, inside ${BUDGET}`)
  }

  /* 2. the box does not move */
  if (Math.abs(answered.boxTop - waiting.boxTop) > 1) {
    fail(
      `the box moves ${(answered.boxTop - waiting.boxTop).toFixed(1)} pixels when the answer lands`,
      'It moved 74 when this was filed, at the moment the finding itself says the visitor is typing.',
    )
  } else {
    console.log(`  ok      the box stays at y=${answered.boxTop} through both states`)
  }

  /* 4. and the waiting state is not an answer */
  if (waiting.state !== 'waiting' || waiting.readable.length > 0) {
    fail(
      `while waiting the page says state=${waiting.state} and shows ${JSON.stringify(waiting.readable.slice(0, 3))}`,
      'A skeleton that invents content is worse than a gap.',
    )
  } else if (!waiting.inFlow) {
    fail('the result section is not in flow while waiting', 'That is the collapse this gate exists for.')
  } else {
    console.log('  ok      waiting shows the shape and no number, and it is in flow')
  }

  /* 3. clearing moves nothing */
  await page.evaluate(() => {
    const where = document.querySelector('[data-attention]').getBoundingClientRect().top + window.scrollY - 40
    window.scrollTo({ top: where, behavior: 'instant' })
  })
  await page.waitForTimeout(250)
  const before = await page.evaluate(LOOK)
  /*
   * Cleared with an input event rather than `page.fill`, which scrolls the box
   * into view and would be this gate measuring playwright.
   */
  await page.evaluate(() => {
    const t = document.querySelector('textarea')
    t.value = ''
    t.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await page.waitForTimeout(900)
  const after = await page.evaluate(LOOK)

  if (after.scrollY !== before.scrollY) {
    fail(
      `clearing the box moved the reader from ${before.scrollY} to ${after.scrollY}`,
      `the document went ${before.doc} to ${after.doc}. A reader looking at the evidence did not ask to be moved.`,
    )
  } else if (after.state !== 'waiting' || !after.inFlow) {
    fail(
      `after clearing, state=${after.state} and the region is ${after.inFlow ? 'in flow' : 'out of flow'}`,
      'Hiding it is what took 989 pixels out of the document.',
    )
  } else if (after.readable.length > 0) {
    fail(`after clearing, the page still shows ${JSON.stringify(after.readable.slice(0, 3))}`, 'That is the previous sentence’s answer.')
  } else {
    console.log(`  ok      clearing leaves the reader at ${after.scrollY} and the document within ${Math.abs(after.doc - before.doc)}px`)
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA page with no designed loading state and a binary collapse reads as unfinished, whatever finally appears.')
  process.exit(1)
}

console.log('shapes: the answer fills a shape that is already there, and clearing the box leaves the page where it was')
