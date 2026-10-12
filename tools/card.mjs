/**
 * The picture a pasted link unfurls into, produced rather than remembered.
 *
 *   npm run card
 *
 * `tokenlab` RC-F11, the recruiter pass of 2026-09-24: pasting the live URL
 * into Slack, a mail client or LinkedIn produced a bare link with no preview.
 * That finding was fixed in `tokenlab` alone and the sweep at tick 229, the day
 * `promptcost` went up, measured the other six published pages with curl, which
 * is what an unfurler sees because none of them run JavaScript:
 *
 *     tokenlab        og:type og:url og:title og:description og:image  all present
 *     watch-it-think  none of the eight
 *     chunkline       none of the eight
 *     agentscope      none of the eight
 *     evalkit         none of the eight
 *     gatewaylab      none of the eight
 *     promptcost      og:type og:title og:description, and no url, image or card
 *
 * Six of seven published pages hand a messaging app a bare link. The rule had
 * been written into the workspace's own rule list as "gated per project by
 * tools/check-head.mjs" since tick 153, and that file existed in exactly one
 * project, which is the shape worth naming: a rule recorded as general,
 * enforced in the project it was found in.
 *
 * ## Why the card is taken rather than drawn
 *
 * A card drawn in a separate template is a second thing to keep true, and
 * `tokenlab` DR-F8 is what happens when a picture outlives what it is a
 * picture of. This one is a screenshot of the page's own first screen at the
 * size the services crop to, 1200 by 630, so it cannot disagree with the page
 * without the page having changed.
 *
 * It is not byte reproducible: fonts rasterise differently on another machine
 * and anything animated is timed. `state/artefacts.json` in the workspace
 * holds it by hash for drift rather than for a reader's verification, which is
 * the right instrument for the one artefact nobody opens on purpose.
 *
 * ## The draft and the rename
 *
 * The screenshot is written beside the work and renamed on success, for the
 * reason `tools/capture.mjs` does: a tool that writes a committed asset in
 * place destroys it on any failure, measured at 2,832,450 bytes to 0 on
 * `tokenlab docs/shatter.gif`. `basename(OUT)` and not a hand split path,
 * because `OUT.split('/').pop()` is a no-op on Windows and `resolve(WORK, ...)`
 * of an absolute path returns the committed file itself.
 */

import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = resolve(root, 'public/card.png')
const WORK = resolve(root, '.capture/card')
const RECORD = resolve(root, 'docs/card.json')

/* What Slack, LinkedIn, iMessage and the rest crop an og:image to. Taken of the
   viewport rather than of any one element, so the picture is that shape exactly
   rather than whatever the first section happens to be. */
const VIEWPORT = { width: 1200, height: 630 }

/* The page is served and then left alone for this long. Everything here opens
   with something measured already on screen, under the rule that the one
   element a non technical reader can use holds something true on arrival, so
   this is settling time for a transition rather than a wait for content. */
const SETTLE_MS = 2500

const server = await serve()
const browser = await chromium.launch()

try {
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 })
  await page.goto(server.url, { waitUntil: 'networkidle' })

  /* The headline, which is what the card is of. An empty one is a blank card,
     and three projects shipped an empty h1 filled in by script until tick 226. */
  await page.waitForFunction(
    () => (document.querySelector('[data-headline]') ?? document.querySelector('h1'))?.textContent?.trim().length > 0,
    null,
    { timeout: 60_000 },
  )
  await page.waitForTimeout(SETTLE_MS)

  const seen = await page.evaluate(() => {
    const head = (k) => document.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.content ?? ''
    const rgb = getComputedStyle(document.body).backgroundColor
    const hex = rgb.match(/\d+/g)?.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('') ?? ''
    return {
      title: document.title,
      background: hex ? `#${hex}` : rgb,
      headline: (document.querySelector('[data-headline]') ?? document.querySelector('h1'))?.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      ogTitle: head('og:title'),
      ogImage: head('og:image'),
      firstScreenChars: document.body.innerText.slice(0, 400).replace(/\s+/g, ' ').trim().length,
      /*
       * Every number the rendered page shows, which is what a sentence in the
       * head is held to. The description is hand written and nothing
       * recomputed it: measured at tick 229 across the seven published pages,
       * three carried a number the page disagrees with, `evalkit` 177 against
       * 178, `gatewaylab` 336 against 337 and `chunkline` 478,000 against
       * 479,384. Two of the three had already been corrected on the page by
       * the tick that found them and left behind in the head.
       */
      numbers: [...new Set(document.body.innerText.match(/\d[\d,]*(?:\.\d+)?/g) ?? [])].sort(),
    }
  })

  if (!seen.headline) throw new Error('the page has no headline, so there is nothing to take a card of')

  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
  const draft = resolve(WORK, basename(OUT))
  await page.screenshot({ path: draft })

  const bytes = statSync(draft).size
  if (bytes < 10_000) throw new Error(`the card came out at ${bytes} bytes, which is a blank page and not a card`)

  mkdirSync(dirname(OUT), { recursive: true })
  renameSync(draft, OUT)
  rmSync(WORK, { recursive: true, force: true })

  mkdirSync(dirname(RECORD), { recursive: true })
  writeFileSync(
    RECORD,
    `${JSON.stringify(
      {
        why: 'What was on screen when public/card.png was taken, so a caption or an og:description can be held to the picture rather than to a memory of it.',
        made: new Date().toISOString().slice(0, 10),
        viewport: VIEWPORT,
        deviceScaleFactor: 1,
        bytes,
        seen,
      },
      null,
      2,
    )}\n`,
  )

  console.log(`card: ${bytes.toLocaleString('en-US')} bytes at ${VIEWPORT.width} by ${VIEWPORT.height}`)
  console.log(`      ${seen.headline.slice(0, 100)}`)
} finally {
  await browser.close()
  server.stop()
}

if (!existsSync(OUT)) {
  console.error('FAIL  public/card.png was not written')
  process.exit(1)
}
