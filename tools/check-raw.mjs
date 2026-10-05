/**
 * The page hands the tokenizer exactly what was typed.
 *
 *   npm run check:raw
 *
 * WH-F7 and WH-F8. `think()` used to read `el.input.value.trim()`, and `trim`
 * strips U+FEFF, which is the one character twenty lines of `tokenizer.ts` exist
 * to preserve: Python's `str.strip()` leaves it, so a sentence pasted out of a
 * file carries a byte order mark into the model and this port has to carry it
 * too. `trim` also leaves U+0085 and U+001C to U+001F, which Python calls
 * whitespace and JavaScript does not, so an input of nothing but those survived
 * the empty check and got a confident answer to nothing.
 *
 * Both were fixed in `src`, and both stayed invisible to every gate here. That is
 * the finding this file is really about. Measured at tick 167 by putting `.trim()`
 * back in `main.ts` and running the whole chain:
 *
 *   npm run build           passes, nineteen gates green
 *   npm run check:input     ok  a leading byte order mark is kept:
 *                               3 positions against 2 without it
 *
 * `check:input` calls the tokenizer module directly. It was green while the page
 * that ships stripped the mark before the module ever saw it, which is this
 * repository's oldest recurring failure in a new place: the assertion measures a
 * proxy for the thing it claims.
 *
 * ## What is checked
 *
 * The page, in a browser, against `tools/tokenizer-expected.json`, which is what
 * the Python tokenizer produced. For each sentence taken from that fixture:
 *
 *   the page reports exactly as many positions as Python produced ids
 *   or, where Python found no words, the page refuses to answer
 *
 * So the byte order mark cases are one row of a general assertion rather than a
 * special case, and the number is Python's rather than mine.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(resolve(root, 'tools/tokenizer-expected.json'), 'utf8'))

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/*
 * The sentences that make the difference, by name rather than by index: a
 * fixture regenerated from a different sample would renumber, and a gate that
 * silently moves to a different sentence is a gate about nothing.
 */
/*
 * By code point, because the literal is exactly what `check:source` refuses and
 * an escape in a string is one careless editor away from being normalised back
 * into the character it stands for. This file wrote it three times before this
 * line existed.
 */
const BOM = String.fromCharCode(0xfeff)

const WANTED = [
  /* Escaped, never literal: `check:source` exists because an invisible
     character in a source file once made a regex that could never match, and a
     gate about the byte order mark is the last file that gets to carry one. */
  `${BOM}turn off the kitchen lights`,
  `turn off the kitchen lights${BOM}`,
  '',
  ' ',
  'a\u0085b',
  'a\u001Cb',
  'a\u001Db',
  'a\u001Eb',
  'a\u001Fb',
  'don’t stop',
  'ΟΔΟΣ ΕΡΜΟΥ',
  'Θα είμαι εκεί σε δέκα λεπτά, έχει απαίσια κίνηση σήμερα.',
]

const cases = WANTED.map((text) => {
  const found = fixture.cases.find((c) => c.text === text)
  if (!found) fail(`tokenizer-expected.json has no case for ${JSON.stringify(text)}`, 'It is one of the sentences a port gets wrong, so the fixture is supposed to carry it.')
  return found
}).filter(Boolean)

/*
 * And the five characters typed on their own, which the fixture does not carry:
 * it has `a\u0085b` and the four others in that shape, and Python tokenizes
 * every one of them into `['a', 'b']`. A character that contributes no word
 * between two letters contributes no word on its own either, so a string of
 * nothing but it has nothing to answer. That derivation is the reason these are
 * in a second list rather than pretending to be fixture rows: the assertion is
 * mine, and the evidence for it is Python's.
 *
 * WH-F8 is exactly this input: `trim` does not strip any of them, so they used
 * to survive the empty check and get smalltalk.greet at 36.4 percent over a wall
 * of uniform green.
 */
const DERIVED = ['\u0085', '\u001C', '\u001D', '\u001E', '\u001F']

const name = (text) =>
  JSON.stringify(text).replace(/\\u([0-9a-f]{4})/gi, (_, h) => `\\u${h.toUpperCase()}`)

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).split('\n')[0]))

  await page.goto(server.url)
  await page.waitForFunction(() => !!document.querySelector('[data-word]'), null, { timeout: 180_000 })

  const trials = [
    ...cases.map((c) => ({ text: c.text, expected: c.words.length === 0 ? 0 : c.ids.length, from: 'Python' })),
    ...DERIVED.map((text) => ({ text, expected: 0, from: 'the fixture rows that tokenize it away' })),
  ]

  /*
   * Set through the DOM and dispatch, rather than typing. `page.fill` is fine
   * for text but these are control characters, and the point is the exact code
   * points arriving in `el.input.value`.
   */
  const type = (text) =>
    page.evaluate((t) => {
      const box = document.querySelector('#input')
      box.value = t
      box.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)

  const untilLine = (test) => page.waitForFunction(test, null, { timeout: 20_000 }).catch(() => {})
  const REFUSED = () => (document.querySelector('[data-status]')?.textContent ?? '').includes('type something')
  const COUNTED = () => /^\d+ position/.test(document.querySelector('[data-status]')?.textContent ?? '')

  for (const c of trials) {
    const expected = c.expected

    /*
     * Primed into the opposite state first, and this is not ceremony.
     *
     * The first version of this loop set the text and waited for "a line with a
     * number in it", which was already true from the trial before, so it read a
     * stale line: `don’t stop` came back as 3 positions, which is the count for
     * the straight apostrophe, and for twenty minutes I believed the page was
     * normalising U+2019. It was not. The line it reported belonged to
     * `a\u001Fb`. Priming means the state this reads cannot be the one before it.
     */
    if (expected === 0) {
      await type('turn off the kitchen lights')
      await untilLine(COUNTED)
    } else {
      await type('')
      await untilLine(REFUSED)
    }

    await type(c.text)
    await untilLine(expected === 0 ? REFUSED : COUNTED)

    const got = await page.evaluate(() => ({
      line: document.querySelector('[data-status]')?.textContent?.trim() ?? '',
      /* `data-state`, not `hidden`: WD-F12 put this region in flow at all times. */
      hidden: document.querySelector('[data-result]')?.dataset.state === 'waiting',
      chips: document.querySelectorAll('[data-axis] [data-token]').length,
    }))
    const positions = Number(/^(\d+) position/.exec(got.line)?.[1] ?? NaN)

    if (expected === 0) {
      if (!got.hidden || !got.line.includes('type something')) {
        fail(
          `${name(c.text)} got an answer: ${JSON.stringify(got.line)}, result hidden=${got.hidden}`,
          `${c.from} finds no words in it, so there is nothing to be confident about.`,
        )
      } else {
        console.log(`  ok      ${name(c.text)} is refused, and ${c.from} finds no words in it`)
      }
      continue
    }

    if (positions !== expected) {
      fail(
        `${name(c.text)}: the page reports ${Number.isNaN(positions) ? JSON.stringify(got.line) : positions} positions and ${c.from} says ${expected}`,
        c.text.includes(BOM)
          ? 'A byte order mark that the page drops before the tokenizer sees it is the page correcting an input the model was trained on.'
          : 'The page and the Python it was trained against have to agree on how many tokens a sentence is.',
      )
    } else {
      console.log(`  ok      ${name(c.text)} is ${expected} positions on the page and ${expected} ids in Python`)
    }
  }

  if (errors.length > 0) fail(`${errors.length} uncaught page errors while typing`, errors.slice(0, 2).join('; '))

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA gate that calls the module cannot see the page correcting the input on its way in.')
  process.exit(1)
}

console.log(`raw: ${cases.length} sentences, and the page counts every one of them the way Python does`)
