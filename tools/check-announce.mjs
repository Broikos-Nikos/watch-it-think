/**
 * A screen reader is told the answer, not the telemetry.
 *
 *   npm run check:announce
 *
 * The only live region on this page was the line reading "6 positions, 6
 * layers, 4 heads, 3.0 ms". It changes on every keystroke, so the experience
 * was that sentence repeated forever while the one number this page exists to
 * work out was never spoken at all. The performance and access audit put it
 * exactly that way, and it is the kind of defect that is invisible to everyone
 * who can see the screen.
 *
 * Four things are checked, and the third is the one that stops the obvious fix
 * from being a worse bug: a live region that fires on every input is one a
 * screen reader user switches off, which leaves them where they started.
 */

import { chromium } from 'playwright'

const SENTENCE = 'turn off the kitchen lights in the bedroom at seven thirty tomorrow'


let failed = 0
const fail = (what) => {
  failed++
  console.error(`FAIL  ${what}`)
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
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 120_000 })
  await page.waitForTimeout(1200)

  // ---- 1. the telemetry is not announced ----------------------------------
  const statusLive = await page.evaluate(() => {
    const s = document.querySelector('[data-status]')
    return { live: s?.getAttribute('aria-live'), role: s?.getAttribute('role'), text: s?.textContent }
  })
  if (statusLive.live || statusLive.role === 'status' || statusLive.role === 'alert') {
    fail(`the telemetry line is still a live region (aria-live=${statusLive.live}, role=${statusLive.role})`)
    console.error(`      it reads ${JSON.stringify(statusLive.text)} and changes on every keystroke`)
  } else {
    console.log('  ok      the telemetry line is not a live region')
  }

  // ---- 2. there is one, and it says the answer ----------------------------
  await page.fill('textarea', '')
  await page.waitForTimeout(300)

  const counted = await page.evaluate(async (sentence) => {
    const region = document.querySelector('[data-announce]')
    if (!region) return { missing: true }

    const seen = []
    const obs = new MutationObserver(() => {
      const t = region.textContent.trim()
      if (t && t !== seen[seen.length - 1]) seen.push(t)
    })
    obs.observe(region, { childList: true, characterData: true, subtree: true })

    const box = document.querySelector('textarea')
    // Typed a character at a time, which is what a person does and what the
    // naive version of this fires on.
    for (const ch of sentence) {
      box.value += ch
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 25))
    }
    await new Promise((r) => setTimeout(r, 2500))
    obs.disconnect()

    return { seen, keystrokes: sentence.length, final: region.textContent.trim() }
  }, SENTENCE)

  if (counted.missing) {
    fail('there is no live region announcing the result at all')
  } else {
    const intent = await page.textContent('[data-intent]')
    if (!counted.final.includes(intent.trim())) {
      fail(`the announcement does not name the intent. It says ${JSON.stringify(counted.final)}, the page says ${JSON.stringify(intent)}`)
    } else {
      console.log(`  ok      announced: ${JSON.stringify(counted.final)}`)
    }

    // ---- 3. it settles rather than firing per keystroke -------------------
    // Sixty six keystrokes must not be sixty six announcements. A handful is
    // fine and expected: the answer genuinely changes as a sentence is typed.
    const BUDGET = 8
    if (counted.seen.length > BUDGET) {
      fail(
        `the live region changed ${counted.seen.length} times over ${counted.keystrokes} keystrokes, ` +
          `over the ${BUDGET} a settled announcement should take`,
      )
    } else {
      console.log(
        `  ok      ${counted.seen.length} announcements over ${counted.keystrokes} keystrokes, settled rather than per key`,
      )
    }
  }

  // ---- 4. the canvases say something --------------------------------------
  const label = await page.getAttribute('[data-field]', 'aria-label')
  if (!label || !/layer \d+ of \d+/.test(label)) {
    fail(`the large attention canvas has no useful text alternative: ${JSON.stringify(label)}`)
  } else {
    console.log(`  ok      the attention field describes itself: ${JSON.stringify(label.slice(0, 64))}...`)
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error(`\n${failed} announcement problems. The page computes one number and must say it.`)
  process.exit(1)
}

console.log('announcements: the answer is spoken, the telemetry is not, and typing does not spam it')
