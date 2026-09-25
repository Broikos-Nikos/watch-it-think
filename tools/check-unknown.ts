/**
 * The page says which of the tokens the model has never seen.
 *
 *   npm run check:unknown
 *
 * WH-F10. This vocabulary is 4,000 tokens built from Greek and English
 * assistant requests, and every emoji is outside it. Measured at tick 168 with
 * the shipped tokenizer:
 *
 *   emoji <face> in the middle   words 5, ids 11, unknown 1
 *   the Greek flag alone         words 2, ids 3,  unknown 2
 *   a skin toned thumb           words 2, ids 3,  unknown 2
 *   a lamp in a sentence         words 5, ids 6,  unknown 1
 *
 * The flag is U+1F1EC and U+1F1F7, two regional indicators, and a lone regional
 * indicator draws as the letter in a box: G and R. The thumb is U+1F44D and the
 * swatch U+1F3FD. `[^\w\s]` matches one code point at a time in Python too, so
 * the split is what the model was given rather than the port drifting, and the
 * page drew all of it without a word of explanation.
 *
 * ## What is checked
 *
 * The page, against a count recomputed here from `src/lib/tokenizer.ts` and the
 * shipped `public/model/tokenizer.json`, which is the same shape as `check:raw`:
 * read the number off the page, compute it again in node, compare.
 *
 *   the note appears exactly when the sentence has an unknown token in it
 *   the number in it is the number of unknown tokens, recomputed
 *   it names the split characters when there are any, and does not when there
 *     are none
 *   the chips still show one per word, because grouping them back together
 *     would make the page disagree with its own token count
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { Tokenizer, normalize, wordTokenize } from '../src/lib/tokenizer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tok = new Tokenizer(JSON.parse(readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8')))

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/*
 * By code point, never as literals. A file about characters that render as
 * something other than themselves is the last file that should contain them,
 * and the terminal this runs in draws half of them as boxes anyway.
 */
const FLAG = String.fromCodePoint(0x1f1ec, 0x1f1f7)
const THUMB = String.fromCodePoint(0x1f44d, 0x1f3fd)
const FACE = String.fromCodePoint(0x1f600)
const LAMP = String.fromCodePoint(0x1f4a1)

const CASES = [
  { text: 'turn off the kitchen lights', name: 'a plain sentence' },
  { text: `turn off the ${LAMP} lights`, name: 'a lamp in a sentence' },
  { text: `emoji ${FACE} in the middle`, name: 'a face in the middle' },
  { text: FLAG, name: 'the Greek flag alone' },
  { text: THUMB, name: 'a skin toned thumb' },
]

/** The same two numbers the page computes, computed here instead. */
const expect = (text: string) => {
  const words = wordTokenize(normalize(text))
  const { ids } = tok.encode(words, 64)
  const unknown = ids.filter((id) => id === tok.unk).length
  let split = 0
  for (const { segment } of new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(normalize(text))) {
    if (wordTokenize(segment).length > 1) split++
  }
  return { words: words.length, unknown, split }
}

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  await page.goto(server.url)
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })

  const type = (text: string) =>
    page.evaluate((t) => {
      const box = document.querySelector('#input') as HTMLTextAreaElement
      box.value = t
      box.dispatchEvent(new Event('input', { bubbles: true }))
    }, text)

  for (const c of CASES) {
    const want = expect(c.text)

    /* Primed into the other state first, so the note read here cannot be the
       one left over from the case before. check:raw learned this the hard way
       at tick 167, by believing a stale status line for twenty minutes. */
    await type(want.unknown > 0 ? 'turn off the kitchen lights' : FLAG)
    await page
      .waitForFunction((hidden) => (document.querySelector('[data-unknown-note]') as HTMLElement | null)?.hidden === hidden, want.unknown > 0, {
        timeout: 20_000,
      })
      .catch(() => {})

    await type(c.text)
    await page
      .waitForFunction((hidden) => (document.querySelector('[data-unknown-note]') as HTMLElement | null)?.hidden === hidden, want.unknown === 0, {
        timeout: 20_000,
      })
      .catch(() => {})

    const got = await page.evaluate(() => ({
      hidden: !!(document.querySelector('[data-unknown-note]') as HTMLElement | null)?.hidden,
      note: document.querySelector('[data-unknown-note]')?.textContent?.trim() ?? '',
      chips: document.querySelectorAll('.tags .word').length,
    }))

    if (want.unknown === 0) {
      if (!got.hidden) fail(`${c.name} has nothing unknown in it and the page said ${JSON.stringify(got.note)}`)
      else console.log(`  ok      ${c.name}: nothing unknown, and the page says nothing`)
      continue
    }

    if (got.hidden) {
      fail(`${c.name}: ${want.unknown} of its tokens ${want.unknown === 1 ? 'is' : 'are'} unknown to the model and the page does not say so`, 'Every emoji is outside this vocabulary, and a page that draws them as chips beside a confident answer is claiming to have read them.')
      continue
    }

    const stated = Number(/^(\d+) tokens? here/.exec(got.note)?.[1] ?? NaN)
    if (stated !== want.unknown) {
      fail(`${c.name}: the note says ${Number.isNaN(stated) ? JSON.stringify(got.note) : stated} and the tokenizer says ${want.unknown}`)
    } else {
      console.log(`  ok      ${c.name}: ${want.unknown} unknown, said, and recomputed here`)
    }

    const saysSplit = /reaches it as more than one token|reach it as more than one token/.test(got.note)
    if (want.split > 0 && !saysSplit) {
      fail(`${c.name}: ${want.split} of its characters is more than one token and the note does not mention it`, `The note is ${JSON.stringify(got.note)}. A flag that draws as G and R is a lie about the reader's own text unless the page says why.`)
    } else if (want.split === 0 && saysSplit) {
      fail(`${c.name}: the note claims a character was split and none was`, JSON.stringify(got.note))
    } else if (want.split > 0) {
      console.log(`  ok      ${c.name}: and it names the ${want.split} character that arrives in pieces`)
    }

    if (got.chips !== want.words) {
      fail(
        `${c.name}: ${got.chips} chips drawn against ${want.words} words`,
        'The chips are what the model was given. Grouping the halves back together would make this page disagree with the token count beside it.',
      )
    }
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nA page that draws a symbol the model cannot read, beside a confident answer, is claiming to have read it.')
  process.exit(1)
}

console.log(`unknown: ${CASES.length} sentences, and the page says which tokens the model has never seen`)
