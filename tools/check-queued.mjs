/**
 * A control used before the model arrives says so, and is kept.
 *
 *   npm run check:queued
 *
 * WH-F4, the half of it that survived tick 111. The progress line, the byte
 * count and the bar arrived then; `aria-busy` and the chips did not. Measured at
 * tick 166 at 8 Mbit, during the download:
 *
 *   aria-busy    null on body, main, the status line and the result
 *   six chips    disabled false, aria-disabled null, tabindex 0,
 *                cursor pointer, opacity 1, identical to after the model
 *   a click      fills the box with the sentence and answers nothing
 *   the line     "loading the model", unchanged by the click
 *
 * `think()` began `if (!router) return`, and every control on this page routes
 * through it. The sentence was never lost: `boot()` ends by answering whatever
 * is in the box. The page simply never said so, so a visitor watched a chip do
 * nothing and drew the obvious conclusion.
 *
 * ## What is checked
 *
 *   1. `main` is aria-busy while the graph is arriving, and is not afterwards
 *   2. a chip clicked during the download is acknowledged within 500 ms, in the
 *      line a visitor is watching and in the live region a screen reader hears
 *   3. the sentence it promised is the sentence that gets answered
 *   4. a download that fails withdraws the promise rather than leaving it
 *
 * Four is the one that would have been left out. A page that says "then it
 * answers what is in the box" and then cannot is worse than one that said
 * nothing, and the hostile stranger pass found this repository's last version of
 * that bug by pulling the network out.
 */

import { chromium } from 'playwright'

/** 8 Mbit down, 40 ms. Long enough that a click lands mid download. */
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

  /* ---- the download, with a chip clicked in the middle of it ---- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...THROTTLE })

    await page.goto(BASE, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelectorAll('[data-samples] button').length > 0, null, { timeout: 30_000 })

    const duringBusy = await page.evaluate(() => document.querySelector('main')?.getAttribute('aria-busy') ?? null)
    if (duringBusy !== 'true') {
      fail(`main carried aria-busy=${JSON.stringify(duringBusy)} while the model was downloading`, 'The controls are usable and the thing behind them is not here yet, which is what the attribute is for.')
    } else {
      console.log('  ok      main is aria-busy while the graph arrives')
    }

    const sentence = await page.locator('[data-samples] button').first().textContent()
    await page.locator('[data-samples] button').first().click()
    await page.waitForTimeout(500)

    const after = await page.evaluate(() => ({
      line: document.querySelector('[data-status]')?.textContent?.trim() ?? '',
      said: document.querySelector('[data-announce]')?.textContent?.trim() ?? '',
      box: document.querySelector('#input')?.value ?? '',
      answered: !!document.querySelector('[data-word]'),
    }))

    if (after.answered) {
      fail('the model answered during its own download, so this gate is not measuring what it thinks')
    }
    if (!/then it answers what is in the box/.test(after.line)) {
      fail(`the line said ${JSON.stringify(after.line)} after a chip was clicked mid download`, 'A chip that fills the box and says nothing is a control that looks live and does nothing, which is the finding.')
    } else {
      console.log(`  ok      the line names the queue: ${JSON.stringify(after.line)}`)
    }
    if (!after.said.includes(sentence.trim())) {
      fail(`the live region said ${JSON.stringify(after.said)}`, `It has to name the sentence, which is ${JSON.stringify(sentence.trim())}, or a screen reader gets the silence the sighted visitor used to get.`)
    } else {
      console.log('  ok      the live region names the sentence it is holding')
    }

    /* And the promise is kept: that sentence, not the default sample. */
    await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 180_000 })
    const kept = await page.evaluate(() => ({
      box: document.querySelector('#input')?.value ?? '',
      words: [...document.querySelectorAll('[data-word]')].map((w) => w.textContent.trim()).join(' '),
      busy: document.querySelector('main')?.getAttribute('aria-busy') ?? null,
    }))
    if (kept.box !== sentence.trim()) {
      fail(`the box holds ${JSON.stringify(kept.box)} and the chip put ${JSON.stringify(sentence.trim())} in it`)
    } else if (!kept.words.length) {
      fail('the model arrived and answered nothing')
    } else {
      console.log(`  ok      it answered the sentence it promised, ${kept.words.split(' ').length} words drawn`)
    }
    if (kept.busy !== null) {
      fail(`main still carries aria-busy=${JSON.stringify(kept.busy)} after the model answered`)
    } else {
      console.log('  ok      and stops being busy once the model is here')
    }

    await context.close()
  }

  /* ---- and the download that never finishes ---- */
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    /*
     * Held, then dropped, rather than refused outright. An immediate abort puts
     * the page in its failed state before a chip can be clicked, and the case
     * worth testing is the one the hostile stranger found: a visitor who asked
     * for something and then lost the network.
     */
    await page.route('**/*.onnx', async (route) => {
      await new Promise((r) => setTimeout(r, 3000))
      await route.abort()
    })

    await page.goto(BASE, { waitUntil: 'commit' })
    await page.waitForFunction(() => document.querySelectorAll('[data-samples] button').length > 0, null, { timeout: 30_000 })
    await page.locator('[data-samples] button').first().click()

    const promised = await page.evaluate(() => document.querySelector('[data-announce]')?.textContent?.trim() ?? '')
    if (!/will answer this when it arrives/.test(promised)) {
      fail(`the page did not promise anything before the download failed: ${JSON.stringify(promised)}`, 'Then this half of the gate is testing a page that never made the promise it is supposed to withdraw.')
    }

    await page.waitForFunction(
      () => (document.querySelector('[data-status]')?.textContent ?? '').includes('did not load'),
      null,
      { timeout: 60_000 },
    )

    const broken = await page.evaluate(() => ({
      busy: document.querySelector('main')?.getAttribute('aria-busy') ?? null,
      line: document.querySelector('[data-status]')?.textContent?.trim() ?? '',
      said: document.querySelector('[data-announce]')?.textContent?.trim() ?? '',
      disabled: document.querySelector('#input')?.disabled,
    }))

    if (broken.busy !== null) {
      fail(`main is still aria-busy after the model failed`, 'A page that cannot load is not loading.')
    } else {
      console.log('  ok      a failed download stops the page being busy')
    }
    if (/then it answers what is in the box|will answer this when it arrives/.test(`${broken.line} ${broken.said}`)) {
      fail(`the page is still promising an answer it cannot give: ${JSON.stringify(broken.line)} / ${JSON.stringify(broken.said)}`)
    } else {
      console.log('  ok      and withdraws the promise it made to the chip')
    }
    if (!broken.disabled) {
      fail('the box is still enabled after the model failed')
    }

    await context.close()
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA control that looks live and does nothing is the page telling a visitor it is broken.')
  process.exit(1)
}

console.log('queued: the page is busy while it is busy, and a chip clicked into the gap is answered and said so')
