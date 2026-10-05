/**
 * The picture is the same picture whatever the last sentence was.
 *
 *   npm run check:pin
 *
 * WD2-F6. Pinning token 40 of a 47 token sentence and then typing a five token
 * one left `pinnedToken` at 40. No chip could show it, because there is no
 * fortieth chip; `preview()` returns early whenever a pin exists, so hovering
 * stopped doing anything; and the field was drawn through the dim ramp for
 * every cell, because every row is "not the focused row". Nothing on screen
 * said why, and nothing on screen could undo it.
 *
 * Measured at tick 180, the same five token sentence drawn twice:
 *
 *   clean               mean 75.4, brightest 166, hover lights 1 chip
 *   after a stale pin   mean 84.1, brightest 190, hover lights 0
 *
 * ## Why the assertion is equality rather than a threshold
 *
 * "The field is dimmer" is the obvious assertion and it is the wrong one: the
 * dim ramp is the same lightness at a quarter of the chroma, and a desaturated
 * blue has a **higher** relative luminance than a saturated one, so the washed
 * out picture measures brighter. A gate written around "dimmer" would have
 * passed the defect and failed the fix.
 *
 * So: the same sentence has to produce the same pixels, whatever was on screen
 * before it. That is exact, it needs no number chosen by hand, and it catches
 * any other piece of state that leaks across a sentence.
 */

import { chromium } from 'playwright'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const SHORT = 'turn off the lights'
const LONG =
  'remind me to call my sister on Friday afternoon about the invoice for the kitchen ' +
  'lights and then add milk bread and coffee to the shopping list before the weather ' +
  'changes in Thessaloniki and cancel the alarm I set for seven thirty tomorrow'

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

/** A cheap digest of the drawn field, plus what the axis is doing. */
const LOOK = () => {
  const c = document.querySelector('[data-field]')
  const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data
  let hash = 0
  for (let i = 0; i < d.length; i += 4) {
    hash = (hash * 31 + d[i] * 7 + d[i + 1] * 13 + d[i + 2] * 17 + d[i + 3]) >>> 0
  }
  return {
    hash,
    size: `${c.width}x${c.height}`,
    chips: document.querySelectorAll('[data-token]').length,
    pinned: document.querySelectorAll('[data-token][data-pinned]').length,
    focused: document.querySelectorAll('[data-token][data-focus]').length,
  }
}

try {
  const browser = await chromium.launch()
  const readings = {}

  for (const pinFirst of [false, true]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } })
    await page.goto(server.url)
    await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 180_000 })

    if (pinFirst) {
      await page.fill('textarea', LONG)
      await page.waitForFunction(() => document.querySelectorAll('[data-token]').length > 40, null, { timeout: 60_000 })
      await page.locator('[data-token]').nth(40).click()
      await page.waitForTimeout(250)
      const pinned = await page.evaluate(() => document.querySelectorAll('[data-token][data-pinned]').length)
      if (pinned !== 1) fail(`the pin did not take: ${pinned} chips pinned on the long sentence`)
    }

    await page.fill('textarea', SHORT)
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-token]').length === n,
      5,
      { timeout: 60_000 },
    )
    await page.waitForTimeout(400)

    const seen = await page.evaluate(LOOK)
    await page.locator('[data-token]').nth(2).hover()
    await page.waitForTimeout(250)
    seen.hoverLights = await page.evaluate(() => document.querySelectorAll('[data-token][data-focus]').length)

    readings[pinFirst ? 'afterPin' : 'clean'] = seen
    await page.close()
  }

  const { clean, afterPin } = readings

  if (clean.hash !== afterPin.hash) {
    fail(
      `the same sentence draws a different field depending on what was pinned before it`,
      `clean ${clean.hash} against ${afterPin.hash}, both ${clean.size}. A picture that depends on invisible state is a picture a reader cannot trust.`,
    )
  } else {
    console.log(`  ok      the same sentence draws the same field either way, digest ${clean.hash}`)
  }

  if (afterPin.pinned !== 0) {
    fail(`${afterPin.pinned} chips are pinned after a sentence that has no fortieth token`)
  } else {
    console.log('  ok      the pin is gone with the sentence it belonged to')
  }

  if (afterPin.hoverLights !== clean.hoverLights || clean.hoverLights !== 1) {
    fail(
      `hovering a chip lights ${afterPin.hoverLights} of them after a stale pin, and ${clean.hoverLights} without one`,
      'preview() returns early while a pin exists, so a pin nobody can see turns the axis off.',
    )
  } else {
    console.log('  ok      hovering still lights exactly one chip afterwards')
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nState that outlives what it points at is state a reader cannot see and cannot undo.')
  process.exit(1)
}

console.log('pin: a pin dies with its sentence, and the field does not remember it')
