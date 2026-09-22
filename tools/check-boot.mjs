/**
 * What the visitor typed during the download survives the download.
 *
 *   npm run check:boot
 *
 * `boot()` ended with `el.input.value = SAMPLES[0]` and then `await think()`,
 * unconditionally. A cold visit fetches 19.8 MB, which takes about a minute on
 * a phone connection, and typing into the box while you wait is the normal
 * thing to do. The hostile stranger audit did exactly that with the graph
 * throttled: it typed "what is the weather in Athens", waited 61,452 ms, and
 * the box came back reading "turn off the kitchen lights" with an answer for a
 * sentence the visitor had not written.
 *
 * Not ignored. Overwritten, and answered as something else.
 *
 * Two assertions, because the fix has two halves and only one of them is
 * obvious:
 *
 *   typed during load     -> the typed sentence is still there afterwards
 *   nothing typed at all  -> the sample still appears, as it always did
 *
 * The second is what stops the fix being "delete the line". An empty box on
 * arrival is a worse page than one that shows you what it can do, so the
 * sample has to survive for the visitor who waits.
 *
 * The model is delayed by intercepting its request rather than by throttling
 * the whole context, because the race is specifically between the graph
 * arriving and the visitor typing, and everything else on the page should load
 * at its normal speed while that happens.
 */

import { chromium } from 'playwright'

const DELAY_MS = 6000
const TYPED = 'what is the weather in Athens'


let failed = 0

/** Open the page with the graph held back, run `during` while it is in flight. */
async function withSlowModel(browser, during) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await context.newPage()

  await page.route('**/router.int8.onnx', async (route) => {
    await new Promise((r) => setTimeout(r, DELAY_MS))
    await route.continue()
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('textarea')
  const result = await during(page)

  // boot() finishes when the first real answer is on screen.
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 60_000 })
  await page.waitForTimeout(800)

  const value = await page.inputValue('textarea')
  await context.close()
  return { value, ...result }
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

  // 1. The visitor types while the model is still coming.
  {
    const { value } = await withSlowModel(browser, async (page) => {
      await page.fill('textarea', TYPED)
      const mid = await page.inputValue('textarea')
      if (mid !== TYPED) throw new Error(`could not type during load, box held ${JSON.stringify(mid)}`)
      return {}
    })

    if (value !== TYPED) {
      failed++
      console.error('FAIL  a sentence typed during the download was overwritten')
      console.error(`        typed: ${JSON.stringify(TYPED)}`)
      console.error(`        after boot: ${JSON.stringify(value)}`)
    } else {
      console.log(`  ok      typed during the download, kept: ${JSON.stringify(value)}`)
    }
  }

  // 2. The visitor types nothing and waits. The sample must still arrive.
  {
    const { value } = await withSlowModel(browser, async () => ({}))
    if (!value || value.trim() === '') {
      failed++
      console.error('FAIL  nothing was typed and the box came up empty, so the page shows a visitor nothing')
    } else {
      console.log(`  ok      nothing typed, sample shown: ${JSON.stringify(value)}`)
    }
  }

  // 3. The visitor types before the page's own script has even run.
  //
  // The first two cases delay the model, which is the minute long window. This
  // is the other one, and the fix for the first left it open: `touched` was set
  // by a listener attached in boot(), and boot() cannot run until the module has
  // downloaded, parsed and executed. The textarea is in index.html and is
  // typeable from first paint. The second deep review measured that window at
  // 1,356 ms on a slow connection.
  //
  // So the bundle is held back rather than the model, which is the only way to
  // be inside it.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()

    // Every script, not the first one: the bundle is more than one file and
    // holding only one of them let the rest through, so the app booted anyway
    // and this timed out waiting for a box that had already been overwritten.
    let open = true
    const waiting = []
    await page.route('**/*.js', async (route) => {
      if (open) await new Promise((r) => waiting.push(r))
      await route.continue()
    })

    // `commit`, not `domcontentloaded`: DOMContentLoaded waits for module
    // scripts, and this test works by not letting them arrive. Waiting for it
    // here hung for thirty seconds against a page that was rendered and
    // typeable the whole time, which is the point being tested.
    await page.goto(BASE, { waitUntil: 'commit' })
    await page.waitForSelector('textarea')

    const EARLY = 'typed before the script existed'
    await page.fill('textarea', EARLY)

    // Only now let the application load.
    open = false
    for (const release of waiting) release()
    await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 120_000 })
    await page.waitForTimeout(900)

    const value = await page.inputValue('textarea')
    if (value !== EARLY) {
      failed++
      console.error('FAIL  a sentence typed before the page script ran was overwritten')
      console.error(`        typed: ${JSON.stringify(EARLY)}`)
      console.error(`        after boot: ${JSON.stringify(value)}`)
    } else {
      console.log('  ok      typed before the script ran, kept')
    }
    await context.close()
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error(`\n${failed} of 3 boot cases wrong.`)
  process.exit(1)
}

console.log('3 boot cases: what the visitor typed survives, before the script and during the download, and an untouched box still gets the sample')
