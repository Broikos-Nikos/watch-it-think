/**
 * A sentence longer than the context says so, on the page and in the evaluator.
 *
 *   npm run check:cap            (needs a server, so npm run verify runs it)
 *
 * WDR-F7. The model has a 64 token context. `wordTags` builds its array by word
 * index and then filters out the holes, so a word past the cap leaves no gap:
 * the tag row just ends. Measured on the live page at tick 160 with a 67 word
 * sentence:
 *
 *   words typed        67
 *   words tagged       58
 *   the row ended at   "alarm"
 *   the sentence ended at "morning"
 *   the status said    "64 positions, 6 layers, 4 heads"
 *   anything about it  nothing, anywhere on the page
 *
 * Nine words gone from a page whose whole argument is showing the working.
 *
 * The same shape was in the evaluator, and there it moved a published number's
 * direction: `first_pos.get(w)` returned `None` for a word outside `max_len`
 * and the loop did `continue`, which removed the word from `tag_total` and left
 * `ok_tags` True, so a sentence whose tail the model never saw could still
 * count towards `exactMatch`. The deep reviewer checked whether that inflated
 * the published numbers and it did not: the longest of the 10,578 held out rows
 * is 20 words. The bias was latent, which is the kind that surfaces the day the
 * data changes.
 *
 * ## What is checked
 *
 * 1. A sentence past the cap draws the note, the note names the right number of
 *    words, and the tagged words plus the dropped ones account for the sentence.
 * 2. A sentence inside the cap draws no note at all, because a page that always
 *    warns is a page nobody reads.
 * 3. `quantize.py` still counts a dropped word as a miss. That one is read out
 *    of the source rather than run, because the evaluator needs the held out
 *    data and the weights, neither of which is in this repository: the gate that
 *    could run it is the gate that cannot exist here.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { serve, useShared } from './serve.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/** Long enough to pass 64 tokens on any tokenizer this page could carry. */
const WORDS = 67
const LONG = Array.from({ length: WORDS - 1 }, (_, i) =>
  ['turn', 'off', 'the', 'kitchen', 'lights', 'and', 'then', 'set', 'an', 'alarm', 'for', 'the'][i % 12],
)
  .concat('morning')
  .join(' ')
const SHORT = 'turn off the kitchen lights'

const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()
const browser = await chromium.launch()

try {
  const page = await browser.newPage()
  await page.goto(server.url, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => document.querySelectorAll('[data-head-cell]').length > 0, null, { timeout: 180_000 })

  const read = async (text) => {
    await page.fill('textarea, input[type=text]', text)
    await page.waitForTimeout(1200)
    return page.evaluate(() => {
      const note = document.querySelector('[data-cap-note]')
      return {
        typed: document.querySelector('textarea, input[type=text]').value.trim().split(/\s+/).length,
        tagged: document.querySelector('[data-tags]').children.length,
        noteShown: note ? !note.hidden && note.textContent.trim().length > 0 : false,
        note: note?.textContent?.trim() ?? '',
      }
    })
  }

  const long = await read(LONG)
  if (!long.noteShown) {
    fail(
      `${long.typed} words in, ${long.tagged} tagged, and the page says nothing about the rest`,
      'This is the state the finding described: the row ends early and the reader is told the sentence was 64 positions.',
    )
  } else {
    const dropped = long.typed - long.tagged
    const said = Number(/The last (\d+) word/.exec(long.note)?.[1] ?? NaN)
    if (said !== dropped) {
      fail(
        `the note says ${said} words did not fit and ${dropped} are missing from the row`,
        `${long.typed} typed, ${long.tagged} tagged: ${JSON.stringify(long.note.slice(0, 90))}`,
      )
    } else {
      console.log(`  ok      ${long.typed} words in, ${long.tagged} tagged, and the note names the other ${dropped}`)
    }
    if (!long.note.includes('64 token')) {
      fail('the note does not say what the limit is', `${JSON.stringify(long.note.slice(0, 90))}`)
    }
  }

  const short = await read(SHORT)
  if (short.noteShown) {
    fail(
      `a ${short.typed} word sentence draws the note as well`,
      `${JSON.stringify(short.note.slice(0, 90))}\n      A page that warns about everything is a page whose warnings are furniture.`,
    )
  } else {
    console.log(`  ok      a ${short.typed} word sentence draws no note, and all ${short.tagged} words are tagged`)
  }
} finally {
  await browser.close().catch(() => {})
  server.stop()
}

/*
 * And the evaluator. Read rather than run: `quantize.py` needs `bslm.pt` and
 * the held out rows, and neither is in this repository, which is recorded in
 * meta.json as `obtainable: false`. So this asserts the shape of the branch
 * that made the metric optimistic, which is the part that was wrong.
 */
const py = readFileSync(resolve(root, 'tools/quantize.py'), 'utf8')
const branch = /if pos is None:([\s\S]{0,1600}?)\n            tag_total \+= 1/.exec(py)
if (!branch) {
  fail('quantize.py no longer has the branch for a word outside max_len in the form this gate reads')
} else {
  const body = branch[1]
  if (!/ok_tags = False/.test(body)) {
    fail(
      'a word outside max_len no longer counts against the sentence',
      'It leaves exactMatch True for a sentence whose tail the model never saw, which is the optimistic direction.',
    )
  }
  if (!/dropped_words \+= 1/.test(body)) {
    fail('quantize.py stopped counting the words that fell outside the context', 'A number nobody counts is a number nobody can quote.')
  }
  if (!/"droppedWords"/.test(py) || !/"truncatedRows"/.test(py)) {
    fail('the quantisation block no longer records droppedWords and truncatedRows')
  }
  if (failed === 0) console.log('  ok      quantize.py counts a word outside the context as a miss and records how many')
}

if (failed > 0) {
  console.error('\nA page that shows its working cannot drop the end of the sentence quietly.')
  process.exit(1)
}

console.log('cap: a sentence past the context says so, a sentence inside it does not, and the evaluator counts the difference')
