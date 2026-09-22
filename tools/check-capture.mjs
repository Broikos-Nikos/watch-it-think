/**
 * The picture at the top of the README is a picture of this page.
 *
 *   npm run check:capture
 *
 * `docs/think.gif` was recorded on one tick, the palette was replaced two ticks
 * later, and the README went on saying "That is the real page in a real
 * browser" over a recording that was green while the page had become flame and
 * blue. Nothing failed. Nothing could: a GIF cannot go stale loudly, and every
 * other gate here checks code or numbers.
 *
 * The recruiter audit found it in ten seconds, which is the whole point of that
 * perspective, and called it the one picture that would have stopped them being
 * a picture of a page that no longer exists.
 *
 * So the capture writes down the tokens it was made under, into
 * `docs/capture.json`, and this compares them against the page that exists now.
 * It does not compare pixels: a screenshot diff would fail on every sentence
 * the model routes differently, which is most of them, and a gate that cries
 * wolf is a gate that gets skipped. It compares the things that make the
 * recording look like a different product.
 */

import { spawn } from 'node:child_process'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5205
const record = resolve(root, 'docs/capture.json')
const gif = resolve(root, 'docs/think.gif')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

if (!existsSync(gif)) {
  fail('docs/think.gif is missing, and the README leads with it')
  process.exit(1)
}
if (!existsSync(record)) {
  fail(
    'docs/capture.json is missing, so nothing records what the page looked like when it was filmed',
    'run npm run capture',
  )
  process.exit(1)
}

const was = JSON.parse(readFileSync(record, 'utf8'))

const server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
  stdio: 'ignore', shell: true,
})
const stop = () => {
  if (server.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
}
process.on('exit', stop)

try {
  const { default: waitOn } = await import('wait-on')
  await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })

  const now = await page.evaluate((keys) => {
    const s = getComputedStyle(document.documentElement)
    const out = {}
    for (const k of keys) out[k] = s.getPropertyValue(k).trim()
    out.bodyFont = getComputedStyle(document.body).fontFamily
    return out
  }, Object.keys(was.looked).filter((k) => k !== 'bodyFont'))

  const drifted = []
  for (const [k, v] of Object.entries(was.looked)) {
    if (now[k] !== v) drifted.push(`${k}: filmed ${JSON.stringify(v)}, page is ${JSON.stringify(now[k])}`)
  }

  if (drifted.length > 0) {
    fail(
      `the page has changed in ${drifted.length} ways since the recording was made on ${was.recorded}`,
      drifted.join('\n      ') + '\n      Run npm run capture. The README calls this the real page.',
    )
  } else {
    console.log(`  ok      the recording of ${was.recorded} was made under the palette the page still has`)
  }

  await browser.close()
} finally {
  stop()
}

// The README claims this is the real page, so that sentence has to be there for
// the check above to be guarding anything.
// Whitespace flattened, because the sentence wraps and the first version of
// this matched a phrase that is not the one the README uses. It said "real page
// in a real browser" and the README says "the real page, recorded by npm run
// capture from a real browser": the check was testing my memory of the sentence
// rather than the sentence.
const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\s+/g, ' ')
if (!/That is the real page, recorded by .npm run capture. from a real browser/.test(readme)) {
  fail('the README no longer claims the picture is the real page, so this gate is guarding nothing')
} else {
  console.log('  ok      the README makes the claim this gate exists to keep true')
}

// Weight, because it is the first thing anybody downloads and the recruiter
// audit measured it at 3.85 MB.
const mb = statSync(gif).size / 1e6
if (mb > 4) {
  fail(`docs/think.gif is ${mb.toFixed(2)} MB`, 'fewer frames and a shorter run, not a better encoder')
} else {
  console.log(`  ok      docs/think.gif is ${mb.toFixed(2)} MB`)
}

if (failed > 0) {
  console.error('\nThe picture at the top is the only thing most people will look at.')
  process.exit(1)
}

console.log('capture: the picture shows the page that exists, and the README can say so')
