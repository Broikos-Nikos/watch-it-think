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
 */

import { Tokenizer, type TokenizerData } from '../src/lib/tokenizer'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vocab = JSON.parse(
  readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'),
) as TokenizerData
const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))
const maxLen: number = meta.maxLen

const BUDGET_MS = 250

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

for (const { name, text } of cases) {
  const started = performance.now()
  const { ids, words } = tokenizer.encodeText(text, maxLen)
  const ms = performance.now() - started

  const over = ms > BUDGET_MS
  const wrongLength = ids.length > maxLen
  if (over || wrongLength) {
    failed++
    if (over) console.error(`FAIL  ${name}: ${ms.toFixed(0)} ms, over the ${BUDGET_MS} ms budget`)
    if (wrongLength) console.error(`FAIL  ${name}: produced ${ids.length} ids, over maxLen ${maxLen}`)
  } else {
    console.log(
      `  ok      ${name.padEnd(32)} ${ms.toFixed(0).padStart(4)} ms   ` +
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

if (failed > 0) {
  console.error(`\n${failed} inputs can take the page away from the visitor.`)
  process.exit(1)
}

console.log(`${cases.length} hostile inputs, all under ${BUDGET_MS} ms, all clamped to ${maxLen} ids`)
