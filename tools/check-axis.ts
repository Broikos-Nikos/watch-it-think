/**
 * The axis stays readable on the sentence that fills it.
 *
 *   npm run check:axis
 *
 * WH-F11: "the axis stops labelling anything when a word is long: 59 of 64 chips
 * read '..' on a pasted hash, and the axis is the only label the large field
 * has". Measured at tick 169 on `the hash is 9f86…a08 ok`, before anything was
 * changed:
 *
 *   64 chips, 0 reading '..', 0 empty
 *   first ten: cls the hash ##sh is <the whole 64 character hash> ##f ##8 ##6 ##d
 *
 * So the half the finding names was fixed at tick 103 and the axis was still
 * unreadable, for the opposite reason. The first piece of a word is labelled
 * with the whole word, so that chip measured **454 pixels against a median of
 * 32** at 1280, and **358 of the 358 available** at 390, wrapping to two lines
 * inside itself. One chip was the row.
 *
 * ## What is checked
 *
 *   nothing reads '..' and nothing is empty, which is the finding as written
 *   no label is longer than the longest token this vocabulary holds, which is
 *     read from `public/model/tokenizer.json` rather than written down here
 *   no chip is wider than half the axis, at 1280 and at 390
 *   the whole word is still reachable: the cut chip's aria-label carries all 64
 *     characters, because a screen reader has no row to run out of
 *
 * The third is the one that would be missing if this gate were written from the
 * finding's words alone: the label length is what the page controls, and the
 * width is what a reader actually meets.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vocab: Record<string, number> = JSON.parse(
  readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'),
).vocab

/** The same number the page derives, derived again here. */
const LONGEST = Math.max(...Object.keys(vocab).map((t) => (t.startsWith('##') ? t.length - 2 : t.length)))

const HASH = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const SENTENCE = `the hash is ${HASH} ok`

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

try {
  const browser = await chromium.launch()

  for (const width of [1280, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } })
    await page.goto(server.url)
    await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 180_000 })

    await page.evaluate((text) => {
      const box = document.querySelector('#input') as HTMLTextAreaElement
      box.value = text
      box.dispatchEvent(new Event('input', { bubbles: true }))
    }, SENTENCE)
    await page.waitForFunction(
      (n) => document.querySelectorAll('[data-token]').length > n,
      10,
      { timeout: 60_000 },
    )

    /* No named helper inside this function: tsx compiles one into a call to
       esbuild's `__name`, which does not exist in the page, and the failure
       arrives as "ReferenceError: __name is not defined" from a line that looks
       fine. */
    const seen = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll('[data-token]')]
      const widths = nodes.map((n) => n.getBoundingClientRect().width)
      const sorted = [...widths].sort((a, b) => a - b)
      const longest = nodes.reduce((a, b) => ((b.textContent ?? '').length > (a.textContent ?? '').length ? b : a))
      return {
        labels: nodes.map((n) => n.textContent ?? ''),
        widest: Math.round(Math.max(...widths)),
        median: Math.round(sorted[Math.floor(sorted.length / 2)]),
        axis: Math.round(document.querySelector('[data-axis]')!.getBoundingClientRect().width),
        longestAria: longest.getAttribute('aria-label') ?? '',
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })

    const dots = seen.labels.filter((l) => l === '..').length
    const empty = seen.labels.filter((l) => l.trim() === '').length
    if (dots > 0 || empty > 0) {
      fail(
        `at ${width}: ${dots} of ${seen.labels.length} chips read '..' and ${empty} are empty`,
        'This is the finding as the hostile stranger pass wrote it: the axis is the only label the 520 pixel field has.',
      )
    } else {
      console.log(`  ok      ${width}: ${seen.labels.length} chips, none of them '..' and none empty`)
    }

    const over = seen.labels.filter((l) => [...l].length > LONGEST + 1)
    if (over.length > 0) {
      fail(
        `at ${width}: ${over.length} label${over.length === 1 ? '' : 's'} longer than the ${LONGEST} characters the longest token in this vocabulary stands for`,
        `The longest is ${[...over[0]].length} characters. A label longer than a token is showing more than the token it sits under.`,
      )
    } else {
      console.log(`  ok      ${width}: no label longer than the vocabulary's own longest token, ${LONGEST}`)
    }

    if (seen.widest > seen.axis / 2) {
      fail(
        `at ${width}: the widest chip is ${seen.widest}px in an axis ${seen.axis}px wide, median ${seen.median}px`,
        'One chip taking half the row is the axis going unreadable exactly when it is fullest, whatever the labels say.',
      )
    } else {
      console.log(`  ok      ${width}: widest chip ${seen.widest}px, median ${seen.median}px, axis ${seen.axis}px`)
    }

    if (!seen.longestAria.includes(HASH)) {
      fail(
        `at ${width}: the cut chip's aria-label does not carry the whole word`,
        `It reads ${JSON.stringify(seen.longestAria.slice(0, 60))}. A screen reader has no row to run out of, so cutting for it buys nothing and costs the word.`,
      )
    } else {
      console.log(`  ok      ${width}: the whole ${HASH.length} character word is still in the aria-label`)
    }

    if (seen.pageOverflow > 0) fail(`at ${width}: the page scrolls sideways by ${seen.pageOverflow}px`)

    await page.close()
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nThe axis is the only label the large field has, and it is the one that has to survive a full sentence.')
  process.exit(1)
}

console.log(`axis: 64 positions at two widths, every chip labelled, none of them wider than half the row`)
