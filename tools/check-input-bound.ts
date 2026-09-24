/**
 * No input can take the page away from the visitor.
 *
 *   npm run check:input
 *
 * The hostile stranger audit pasted 32,000 characters of ordinary English with
 * the spaces removed and the tab was gone for 21,574 ms: a screenshot request
 * issued during it timed out at 15,000 ms because the renderer could not
 * answer. 1 MB of the same text with its spaces left in went through in 483 ms,
 * so this was never about size. `encodeWord` rescans every adjacent pair on
 * every merge, which is fine for a word and quadratic for a paste that has no
 * spaces in it to break it up.
 *
 * The fix is a bound rather than a faster loop, because the right answer to
 * "what does the model do with a 32,000 character word" is that it only ever
 * sees 64 tokens of it. This gate holds that bound: every input below,
 * including ones chosen to be as hostile as the audit's, must tokenise inside
 * BUDGET_MS.
 *
 * The budget is deliberately far above what the fix achieves. A gate that sits
 * one millisecond above the current number fails on a slow morning and teaches
 * everyone to ignore it.
 *
 * **It is a rate, not a wall clock, and that was a correction.** A flat 250 ms
 * was set when every case was 32 kilobytes or smaller, where the worst reading
 * was 60 ms. A 128 kilobyte case was added later and nobody revisited the
 * number: it reads 254 ms, so the budget that the docstring above calls "far
 * above" was four milliseconds below it, and the gate went red on 2026-09-23
 * with nothing having changed. A flat budget across cases spanning 8 kilobytes
 * to a megabyte either lets the small ones off or fails the large ones.
 *
 * So each case is held to **milliseconds per kilobyte**, which is what the fix
 * actually achieved: the bound turned a quadratic scan into a linear one, and
 * linear is a rate. The no space cases run at about 2 ms per kilobyte, the
 * budget is 4, and that headroom is the "slow morning" the docstring asks for.
 * The absolute ceiling stays as well, at a full second, because the original
 * disaster was 21,574 ms and no rate argument should let that back in.
 */

import { Tokenizer, hasWords, type TokenizerData } from '../src/lib/tokenizer'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vocab = JSON.parse(
  readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'),
) as TokenizerData
const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))
const maxLen: number = meta.maxLen

/** About twice the measured 2 ms per kilobyte of the worst shaped input. */
const BUDGET_MS_PER_KB = 4
/** And nothing may block the tab for a second whatever its size. */
const CEILING_MS = 1000

const ENGLISH =
  'set an alarm for seven thirty tomorrow and turn off the kitchen lights then ' +
  'add milk and bread to the shopping list before the weather changes again '
const GREEK =
  'βάλε ξυπνητήρι στις εφτά και μισή και σβήσε τα φώτα στην κουζίνα και μετά ' +
  'πρόσθεσε γάλα και ψωμί στη λίστα πριν αλλάξει ο καιρός ξανά '

/** The audit's input: real text with every space taken out. */
const unspaced = (seed: string, chars: number) =>
  seed.replace(/ /g, '').repeat(Math.ceil(chars / seed.length) + 1).slice(0, chars)

const cases: { name: string; text: string }[] = [
  { name: 'english, spaces removed, 8k', text: unspaced(ENGLISH, 8_000) },
  { name: 'english, spaces removed, 32k', text: unspaced(ENGLISH, 32_000) },
  { name: 'english, spaces removed, 128k', text: unspaced(ENGLISH, 128_000) },
  { name: 'greek, spaces removed, 32k', text: unspaced(GREEK, 32_000) },
  { name: 'one letter repeated, 64k', text: 'a'.repeat(64_000) },
  { name: 'random latin, 32k', text: Array.from({ length: 32_000 }, () => String.fromCharCode(97 + ((Math.random() * 26) | 0))).join('') },
  { name: 'ordinary spaced text, 1 MB', text: ENGLISH.repeat(Math.ceil(1_000_000 / ENGLISH.length)) },
  { name: 'combining marks, 32k', text: 'a' + '́'.repeat(32_000) },
  { name: 'no separators at all, 32k', text: '​'.repeat(32_000) },
  { name: 'punctuation only, 32k', text: '!'.repeat(32_000) },
]

/**
 * The loop that was replaced, kept so the replacement can be held to it.
 *
 * `check:tokenizer` holds the tokenizer to 242 sentences, which is a thin basis
 * for claiming a rewritten algorithm is equivalent: it is exactly the argument
 * that failed at tick 31, when 230 sentences reported "identical" over a defect.
 * So the old implementation lives here, obviously correct and far too slow, and
 * the fast one has to agree with it on inputs nobody wrote by hand.
 *
 * This is the scan, verbatim: every adjacent pair rescanned on every merge,
 * leftmost of the lowest rank wins, array rebuilt each time.
 */
function referenceEncodeWord(word: string, merges: Map<string, number>, vocabIds: Map<string, number>, unk: number): number[] {
  const chars = [...word.toLowerCase()]
  let syms = chars.length === 0 ? [] : [chars[0], ...chars.slice(1).map((c) => `##${c}`)]

  while (syms.length > 1) {
    let best = -1
    let rank: number | null = null
    for (let i = 0; i < syms.length - 1; i++) {
      const r = merges.get(`${syms[i]}\u0000${syms[i + 1]}`)
      if (r !== undefined && (rank === null || r < rank)) {
        best = i
        rank = r
      }
    }
    if (best === -1) break
    const a = syms[best]
    const b = syms[best + 1]
    const merged = b.startsWith('##') ? a + b.slice(2) : a + b
    syms = [...syms.slice(0, best), merged, ...syms.slice(best + 2)]
  }
  return syms.map((s) => vocabIds.get(s) ?? unk)
}

const tokenizer = new Tokenizer(vocab)
let failed = 0

// ---- the replacement against the loop it replaced -------------------------
{
  const merges = new Map(vocab.merges.map(([a, b, rank]) => [`${a}\u0000${b}`, rank]))
  const vocabIds = new Map(Object.entries(vocab.vocab))
  const unk = vocabIds.get('<unk>')!

  // A fixed seed, so a failure can be reproduced from the line it prints.
  let seed = 20260921
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

  const ALPHABETS = [
    'abcdefghijklmnopqrstuvwxyz',
    'αβγδεζηθικλμνξοπρστυφχψω',
    'αβγδabcd',            // mixed scripts inside one word
    'αάββγγδδεέ',          // accents, where the merge table is densest
    'aA1_',                 // digits and underscore, which are word characters
  ]

  let mismatches = 0
  let checked = 0
  for (let i = 0; i < 3_000; i++) {
    const alpha = ALPHABETS[(rnd() * ALPHABETS.length) | 0]
    const len = 1 + ((rnd() * 60) | 0)
    let word = ''
    for (let c = 0; c < len; c++) word += alpha[(rnd() * alpha.length) | 0]

    const fast = tokenizer.encodeWord(word)
    const slow = referenceEncodeWord(word, merges, vocabIds, unk)
    checked++
    if (fast.length !== slow.length || fast.some((v, j) => v !== slow[j])) {
      mismatches++
      if (mismatches <= 3) {
        console.error(`FAIL  differential: ${JSON.stringify(word)}`)
        console.error(`        fast ${fast.join(',')}`)
        console.error(`        slow ${slow.join(',')}`)
      }
    }
  }

  // Longer words too, where the two implementations diverge in cost rather
  // than in behaviour. 2,000 characters is about as much as the old loop can
  // be asked for without this gate becoming the slow thing.
  for (const len of [200, 800, 2_000]) {
    let word = ''
    for (let c = 0; c < len; c++) word += 'abcdefghijklmnopqrstuvwxyz'[(rnd() * 26) | 0]
    const fast = tokenizer.encodeWord(word)
    const slow = referenceEncodeWord(word, merges, vocabIds, unk)
    checked++
    if (fast.length !== slow.length || fast.some((v, j) => v !== slow[j])) {
      mismatches++
      console.error(`FAIL  differential at ${len} characters: ${fast.length} pieces against ${slow.length}`)
    }
  }

  if (mismatches > 0) {
    failed++
    console.error(`\nFAIL  ${mismatches} of ${checked} words tokenise differently from the loop this replaced`)
  } else {
    console.log(`  ok      ${checked.toLocaleString('en-US')} random words identical to the loop this replaced`)
  }
}

/*
 * The median of five, not one reading.
 *
 * This gate failed on 2026-09-23 at 253, 258, 269 and 278 ms against a 250 ms
 * budget, on a machine that had been running chromium all night, and it passed
 * on the same commit hours earlier. Nothing about the tokenizer had changed. A
 * timing gate that reads a single sample is measuring the machine as much as the
 * code, and a budget three milliseconds above the reading is a budget that goes
 * red on a busy morning and teaches everyone to ignore it.
 *
 * Five runs, take the middle. The budget stays at 250 rather than being raised
 * to make this go green, because raising a budget to fit the reading is how a
 * budget stops meaning anything. If the median is over, the tokenizer really is
 * slower and that is worth failing for.
 *
 * The first run is kept in the report beside the median, because a cold first
 * call is what an actual visitor gets and a median that hides it would be
 * measuring the wrong thing in the other direction.
 */
const REPS = 5

for (const { name, text } of cases) {
  const runs: number[] = []
  let ids: number[] = []
  let words: unknown[] = []
  for (let i = 0; i < REPS; i++) {
    /*
     * A different string every repetition, and this is the whole reason the
     * median is trustworthy.
     *
     * Running the same text five times gave 2 ms against a 280 ms first run on
     * the 128 kilobyte case, and the same 30 to 70 fold gap on every other
     * spaces removed case. That is a cache inside the tokenizer answering four
     * times out of five, so the median was measuring a cache hit and the gate
     * would have gone green while the thing it guards had not been run. Exactly
     * the defect this repository keeps writing down.
     *
     * Two characters on the front is enough to miss the cache and changes
     * nothing about the shape: a 128 kilobyte run of letters with no spaces is
     * still one word whatever it starts with.
     */
    const input = i === 0 ? text : `q${i}${text}`
    const started = performance.now()
    const out = tokenizer.encodeText(input, maxLen)
    runs.push(performance.now() - started)
    ids = out.ids
    words = out.words
  }
  const first = runs[0]
  const sorted = [...runs].sort((a, b) => a - b)
  const ms = sorted[Math.floor(REPS / 2)]

  const kb = text.length / 1024
  const rate = ms / kb
  const over = rate > BUDGET_MS_PER_KB || ms > CEILING_MS
  const wrongLength = ids.length > maxLen
  if (over || wrongLength) {
    failed++
    if (over) {
      console.error(
        `FAIL  ${name}: ${ms.toFixed(0)} ms median of ${REPS} over ${kb.toFixed(0)} KB, ` +
          `${rate.toFixed(2)} ms/KB against the ${BUDGET_MS_PER_KB} ms/KB budget ` +
          `and the ${CEILING_MS} ms ceiling (first run ${first.toFixed(0)} ms)`,
      )
    }
    if (wrongLength) console.error(`FAIL  ${name}: produced ${ids.length} ids, over maxLen ${maxLen}`)
  } else {
    console.log(
      `  ok      ${name.padEnd(32)} ${ms.toFixed(0).padStart(4)} ms median  ${rate.toFixed(2).padStart(5)} ms/KB   ` +
        `${String(ids.length).padStart(2)} ids from ${words.length.toLocaleString('en-US')} words`,
    )
  }
}

// A gate that cannot fail is not a gate. If the bound were removed, the 32k
// case would take about twenty seconds, so a budget that no case approaches is
// only meaningful if the cases are genuinely the hostile ones. The audit's
// exact shape is the second case above.
if (cases.length < 8) {
  failed++
  console.error('FAIL  too few cases for this to mean anything')
}

/*
 * The page's idea of empty is this tokenizer's idea of empty.
 *
 * It used to be `String.prototype.trim`, which disagrees with Python in both
 * directions, and each direction broke something.
 *
 * `trim` strips U+FEFF. Twenty lines of `tokenizer.ts` exist because Python's
 * `str.strip()` does not: a sentence pasted out of a file carries a byte order
 * mark, Python keeps it and makes a token of it, and `PY_SPACE` was built to
 * match. The page stripped it first, so it was quietly correcting an input the
 * model was trained to see.
 *
 * `trim` does not strip U+0085 or U+001C to U+001F, which Python calls
 * whitespace. One of those alone survived the empty check, normalised away
 * inside the tokenizer, and reached the model as `<cls>` alone, which produced a
 * verdict, a race with bars and twenty five flat squares captioned "strongest
 * single link 100 percent".
 */
// This half tests the tokenizer, which was never the broken part: it kept the
// mark all along. The page was stripping it before the tokenizer saw it, and
// that is asserted in check:degraded where it can be driven through the box.
// Both are here because the contract has two ends.
const BOM = '﻿'
const withMark = tokenizer.encodeText(`${BOM}hello`, maxLen)
const without = tokenizer.encodeText('hello', maxLen)
if (withMark.ids.length === without.ids.length) {
  failed++
  console.error(
    `FAIL  a leading byte order mark makes no difference: ${withMark.ids.length} positions either way`,
  )
  console.error('      tokenizer.ts keeps it on purpose, so something upstream is stripping it')
} else {
  console.log(
    `  ok      a leading byte order mark is kept: ${withMark.ids.length} positions against ${without.ids.length} without it`,
  )
}

// Whitespace to Python, not to JavaScript. Each one alone is nothing to say.
const PYTHON_ONLY = ['\u0085', '\u001C', '\u001D', '\u001E', '\u001F']
const answered = PYTHON_ONLY.filter((ch) => hasWords(ch))
if (answered.length > 0) {
  failed++
  console.error(
    `FAIL  ${answered.length} of ${PYTHON_ONLY.length} characters Python calls whitespace read as a sentence: ` +
      answered.map((c) => 'U+' + (c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')).join(', '),
  )
  console.error('      each one reaches the model as <cls> alone and gets a full confident answer')
} else {
  console.log(`  ok      all ${PYTHON_ONLY.length} characters Python calls whitespace count as empty`)
}

if (failed > 0) {
  console.error(`\n${failed} inputs can take the page away from the visitor.`)
  process.exit(1)
}

console.log(`${cases.length} hostile inputs, all under ${BUDGET_MS_PER_KB} ms/KB and ${CEILING_MS} ms, all clamped to ${maxLen} ids`)
