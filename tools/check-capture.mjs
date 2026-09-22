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
 *
 * Which, for one version of this file, meant eight colours and a typeface. The
 * recruiter came back a second time and found the same class of defect
 * untouched: the recording showed the old headline, "Five million parameters,
 * running on your machine", one commit before it became "I trained this model.
 * Watch it think." No custom property moved, so this gate passed over a picture
 * of a page saying something else, while guarding a README sentence that says
 * the picture is the real page.
 *
 * A gate written in response to a complaint about a headline has to look at the
 * headline. It now compares the words as well as the paint, and a recording
 * made before it did is treated as no recording at all.
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
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

// The words the recording is required to have written down. A capture.json
// without them was made by the tool that only knew about colours, and the
// honest thing to do with it is refuse it rather than compare the six keys it
// does have and print "ok".
const WORDS = ['headline', 'standfirst']
const unrecorded = WORDS.filter((k) => !(k in was.looked))
if (unrecorded.length > 0) {
  fail(
    `docs/capture.json records no ${unrecorded.join(' and ')}, so it was made before this gate read words`,
    'It wrote down eight colours and a font, none of which move when a sentence is rewritten. Run npm run capture.',
  )
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
  const page = await browser.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  // The standfirst is written from meta.json during boot, so an empty one here
  // would read as drift when it is only impatience.
  await page.waitForFunction(
    () => (document.querySelector('[data-standfirst]')?.textContent ?? '').trim().length > 0,
    null,
    { timeout: 30_000 },
  )

  const now = await page.evaluate((keys) => {
    const s = getComputedStyle(document.documentElement)
    const out = {}
    for (const k of keys) out[k] = s.getPropertyValue(k).trim()
    out.bodyFont = getComputedStyle(document.body).fontFamily
    out.headline = document.querySelector('h1')?.textContent?.trim() ?? ''
    out.standfirst = document.querySelector('[data-standfirst]')?.textContent?.trim() ?? ''
    return out
  }, Object.keys(was.looked).filter((k) => k.startsWith('--')))

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
    console.log(
      `  ok      the recording of ${was.recorded} was made under the palette the page still has, ` +
        `saying ${JSON.stringify(was.looked.headline)}`,
    )
  }

  await browser.close()
} finally {
  server.stop()
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
