/**
 * The page says how far along the download is, while it is happening.
 *
 *   npm run check:progress
 *
 * The performance audit ran against the live host the morning this published
 * and measured the first visit at **41.2 seconds** to the first answer, at 1.6
 * Mbit with 150 ms of latency, which is a phone on a train. For all 41 seconds
 * the page said `loading the model`. That string ships in `index.html` so it is
 * there from first paint, which is why the finding was corrected down from "no
 * sign anything is happening": there is a sign. It is three words that never
 * move, and nothing a visitor can look at distinguishes a download in progress
 * from one that has stalled.
 *
 * Every other gate here would have passed that page forever. `check:boot`
 * proves what you typed during the download survives it, `check:weight` proves
 * the download is inside its budget, and neither asks what the visitor is
 * looking at while it happens.
 *
 * The connection is throttled through CDP rather than by delaying the route,
 * because the thing under test is a stream arriving in pieces and a delayed
 * `route.continue()` delivers it all at once after a pause. Eight megabit is
 * chosen so the download takes about four seconds: long enough that progress is
 * observable, short enough to sit in a suite that runs on every push.
 *
 * Five assertions, and the last two are the ones that stop this being a gate
 * about a string:
 *
 *   1. the line changes while the graph arrives, more than once
 *   2. the bytes it names only ever go up, and end at the size meta.json records
 *   3. `aria-valuenow` tracks them, so it is a progress bar and not a sentence
 *   4. the line does not move the page when the bar appears or when it goes
 *   5. and a failed download leaves no progress bar behind, which is the one the
 *      hostile stranger found by pulling the network out
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))
const EXPECTED = meta.quantisation?.bytesInt8 ?? 0

/** 8 Mbit down, 40 ms. About four seconds for this graph. */
const THROTTLE = { downloadThroughput: (8 * 1024 * 1024) / 8, uploadThroughput: (1 * 1024 * 1024) / 8, latency: 40 }

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()
const BASE = server.url

try {
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = await context.newPage()

  const cdp = await context.newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THROTTLE })

  await page.goto(BASE, { waitUntil: 'commit' })
  await page.waitForSelector('[data-status]')

  // Where the line sits once the page has finished assembling itself and before
  // the bar exists. The bar must not move it, which is the difference between
  // reassuring a visitor and shoving the page under their thumb.
  //
  // Taken after the sample chips render rather than at `commit`. The first
  // version measured at commit and reported a 319 pixel shift, which was
  // `wire()` appending six buttons in the row above this line. That is the page
  // being built, not the bar arriving, and an assertion that cannot tell them
  // apart fails for the wrong reason and gets muted rather than fixed.
  await page.waitForFunction(() => document.querySelectorAll('[data-samples] button').length > 0, null, { timeout: 30_000 })

  /*
   * And after the standfirst has text in it, which is the second thing that
   * moves this line and was not here when the assertion was written.
   *
   * `describe()` now runs on meta.json alone, so the paragraph above the box
   * fills about a hundred milliseconds into the visit instead of after the whole
   * graph. That is a page assembling itself, not a bar shoving it, and racing it
   * made this gate fail once in several runs with "the status line moved by up
   * to 74.4px". A flaky assertion is worse than a strict one: it gets muted.
   */
  await page.waitForFunction(
    () => (document.querySelector('[data-standfirst]')?.textContent ?? '').trim().length > 0,
    null,
    { timeout: 30_000 },
  )
  const restingTop = await page.evaluate(() => document.querySelector('[data-status]').getBoundingClientRect().top)

  const seen = []
  const sample = async () => {
    const s = await page.evaluate(() => {
      const el = document.querySelector('[data-status]')
      if (!el) return null
      return {
        text: el.textContent.trim(),
        now: el.getAttribute('aria-valuenow'),
        max: el.getAttribute('aria-valuemax'),
        role: el.getAttribute('role'),
        top: el.getBoundingClientRect().top,
      }
    })
    if (s && (seen.length === 0 || seen[seen.length - 1].text !== s.text)) seen.push(s)
  }

  const deadline = Date.now() + 120_000
  let answered = false
  while (Date.now() < deadline) {
    await sample()
    answered = await page.evaluate(() => !!document.querySelector('.word'))
    if (answered) break
    await page.waitForTimeout(120)
  }
  if (!answered) {
    fail('the model never loaded inside two minutes at 8 Mbit')
  }

  const withBytes = seen.filter((s) => s.now !== null)

  // 1. it changed, and more than once
  if (withBytes.length < 2) {
    fail(
      `the line showed ${withBytes.length} progress states during the download`,
      'a static string cannot tell a visitor whether a download is moving or stalled',
    )
  } else {
    console.log(`  ok      ${withBytes.length} progress states while the graph arrived`)
    console.log(`            first: ${JSON.stringify(withBytes[0].text)}`)
    console.log(`            last:  ${JSON.stringify(withBytes[withBytes.length - 1].text)}`)
  }

  // 2. the bytes only go up, and they end where meta.json says they should
  const values = withBytes.map((s) => Number(s.now))
  const wentBackwards = values.findIndex((v, i) => i > 0 && v < values[i - 1])
  if (wentBackwards > 0) {
    fail(`the byte count went backwards at sample ${wentBackwards}: ${values[wentBackwards - 1]} then ${values[wentBackwards]}`)
  } else if (values.length > 0) {
    console.log('  ok      the byte count only ever rose')
  }

  const top = values[values.length - 1]
  if (values.length > 0 && top !== EXPECTED) {
    fail(
      `the download finished at ${top} bytes and meta.json records ${EXPECTED}`,
      'the progress is measured against the recorded size, so a mismatch means one of them is lying',
    )
  } else if (values.length > 0) {
    console.log(`  ok      it ended at ${EXPECTED.toLocaleString('en-US')} bytes, which is what meta.json records`)
  }

  // 3. it is a progress bar to a screen reader, and stops being one afterwards
  const maxes = new Set(withBytes.map((s) => s.max))
  if (withBytes.some((s) => s.role !== 'progressbar')) {
    fail('the line carried byte values without role="progressbar"')
  } else if (maxes.size !== 1 || Number([...maxes][0]) !== EXPECTED) {
    fail(`aria-valuemax was ${[...maxes].join(', ')} and should be ${EXPECTED} throughout`)
  } else {
    console.log('  ok      role=progressbar with aria-valuenow tracking the bytes, valuemax fixed')
  }

  const after = await page.evaluate(() => {
    const el = document.querySelector('[data-status]')
    return { role: el.getAttribute('role'), now: el.getAttribute('aria-valuenow'), top: el.getBoundingClientRect().top }
  })
  if (after.role !== null || after.now !== null) {
    fail('the line is still announcing itself as a progress bar after the model arrived')
  } else {
    console.log('  ok      it stops being a progress bar once the model is here')
  }

  // 4. nothing moved while the bar was on screen
  //
  // Only the samples taken during the download, against a resting position
  // measured after the page had assembled. Comparing against the state after
  // the answer arrives measures the page growing, which it is supposed to do,
  // and the first version of this assertion did exactly that and reported a 393
  // pixel shift that was the verdict appearing.
  const moved = withBytes.map((s) => s.top).filter((t) => Math.abs(t - restingTop) > 1)
  if (moved.length > 0) {
    fail(
      `the status line moved by up to ${Math.max(...moved.map((t) => Math.abs(t - restingTop))).toFixed(1)}px`,
      'a progress bar that shifts the page has traded a stalled looking page for a jumping one',
    )
  } else {
    console.log('  ok      the line never moved, before, during or after')
  }

  await context.close()

  /*
   * ---- 5. and it stops being one when the download fails ------------------
   *
   * The four assertions above all describe a download that worked. The hostile
   * stranger pass pulled the network out in the middle of one and found the
   * line carrying `role="progressbar"` and `aria-valuenow="5284077"` with "The
   * model did not load" written inside it: a screen reader told a completed
   * progress bar by the same element that was telling everyone else it had
   * failed. The cleanup sat after the `await` inside the `try`, so a throw
   * skipped it.
   *
   * The **runtime** is killed, not the graph, and the first version of this
   * killed the graph and passed against the broken code. Aborting
   * router.int8.onnx throws inside `fetch` before `onProgress` has ever been
   * called, so no progress attributes were ever set and there was nothing left
   * behind to find: the assertion was green because the condition never
   * happened. That is the defect this repository has now written down four
   * times.
   *
   * Killing the wasm reproduces what the audit actually saw: the graph arrives,
   * the bar reaches 5,284,077, and then `InferenceSession.create` throws.
   */
  const broken = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page2 = await broken.newPage()
  await page2.route('**/ort-wasm*', (r) => r.abort('failed'))
  await page2.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page2.waitForFunction(
    () => /did not load/i.test(document.querySelector('[data-status]')?.textContent ?? ''),
    null,
    { timeout: 60_000 },
  )

  const afterFailure = await page2.evaluate(() => {
    const el = document.querySelector('[data-status]')
    return {
      text: el.textContent.trim(),
      left: ['role', 'aria-valuemin', 'aria-valuemax', 'aria-valuenow'].filter((a) => el.hasAttribute(a)),
      progress: el.style.getPropertyValue('--progress'),
    }
  })

  if (afterFailure.left.length > 0 || afterFailure.progress) {
    failed++
    console.error(
      `FAIL  the failed download left ${[...afterFailure.left, afterFailure.progress && '--progress']
        .filter(Boolean)
        .join(', ')} on the status line`,
    )
    console.error(`      it reads ${JSON.stringify(afterFailure.text.slice(0, 70))} and still announces itself as a progress bar`)
  } else {
    console.log('  ok      a failed download leaves no progress bar behind, only the message')
  }
  await broken.close()

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\n41 seconds is a long time to look at a word that does not change.')
  process.exit(1)
}

console.log('progress: the page says how much of the model has arrived, and stops saying it when it has')
