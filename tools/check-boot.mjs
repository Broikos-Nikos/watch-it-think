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

import { spawn } from 'node:child_process'
import { chromium } from 'playwright'

const PORT = 5179
const BASE = `http://localhost:${PORT}/`
const DELAY_MS = 6000
const TYPED = 'what is the weather in Athens'

const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore',
  shell: true,
})
const stop = () => {
  if (server.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
}
process.on('exit', stop)

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

try {
  const { default: waitOn } = await import('wait-on')
  await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })
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

  await browser.close()
} finally {
  stop()
}

if (failed > 0) {
  console.error(`\n${failed} of 2 boot cases wrong.`)
  process.exit(1)
}

console.log('2 boot cases: what the visitor typed survives, and an untouched box still gets the sample')
