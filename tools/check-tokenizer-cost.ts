/**
 * The tokenizer in front of a 2.5 ms model cannot cost seconds.
 *
 *   npm run check:cost
 *
 * WDR-F8. `encodeWord` rescanned every adjacent pair on every merge, so it was
 * quadratic in the length of a word, and `encode` kept calling it for every word
 * in the input after the 64 id cap was reached, because the `break` left the
 * outer loop running. The audit measured this, with the shipped vocabulary, on
 * one word of common letters:
 *
 *   1,000 characters      21 ms
 *   2,000                 69 ms
 *   4,000                297 ms
 *   8,000              1,133 ms
 *   16,000             6,731 ms
 *
 * Both halves were fixed before this gate existed: `encodeWord` merges through a
 * binary min heap and `encode` breaks out of the outer loop. Measured again at
 * tick 161, same machine, same vocabulary:
 *
 *   1,000 characters     2.0 ms        200 words of 1,000 chars    0.9 ms
 *   2,000                2.3 ms        1,000 of them               4.3 ms
 *   4,000                2.8 ms        1 MB of ordinary prose     39.1 ms
 *   8,000                3.3 ms
 *   16,000               6.1 ms
 *
 * 6.7 seconds to 6.1 milliseconds, and 200 long words now cost what one costs.
 * Nothing held that, which is why this exists: correctness is gated by
 * `check:tokenizer` against the Python port, and cost was gated by nobody.
 *
 * ## Ratios, not stopwatches
 *
 * The two assertions that matter are shapes rather than speeds, so they hold on
 * a slow runner as well as on this machine:
 *
 *   how the cost grows with the length of one word: quadratic would be 256x
 *     across the range measured, and the ceiling here is 25x
 *   what 200 long words cost against one: the outer loop break makes it 1x, and
 *     without it the work is 200x
 *
 * There is an absolute ceiling too, with fifty times the headroom of the
 * measurement, because a ratio cannot catch everything getting slower at once.
 *
 * The control is a tokenizer written the way the finding describes, timed on the
 * same inputs by the same assertions: not a revert of this project's file, the
 * shape the finding named. It fails all three, and it sits behind
 * WIT_COST_CONTROL because being twelve seconds slow is what it is for.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Tokenizer, normalize, wordTokenize, type TokenizerData } from '../src/lib/tokenizer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const data: TokenizerData = JSON.parse(readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'))

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const SHORT_WORD = 'a'.repeat(1_000)
const LONG_WORD = 'a'.repeat(16_000)
/*
 * The same letter as the two above, and that is not cosmetic: 'c' merges away in
 * a handful of passes on this vocabulary and 'a' does not, so a spread measured
 * on one and a growth measured on the other are two different experiments. Found
 * by writing it the other way first: the control's spread came out at 1.9x, which
 * would have been read as the outer loop break already being there.
 */
const MANY = Array.from({ length: 200 }, () => SHORT_WORD).join(' ')

/** Median of three, on a fresh tokenizer each time so the cache cannot answer. */
function ms(encode: (text: string) => unknown, text: string): number {
  const runs = [0, 0, 0].map(() => {
    const t0 = performance.now()
    encode(text)
    return performance.now() - t0
  })
  return runs.sort((a, b) => a - b)[1]!
}

const shipped = (text: string) => new Tokenizer(data).encodeText(text, 64)

/*
 * The shape the finding described, for the control: every adjacent pair rescanned
 * on every merge, and every word encoded whatever the cap says. Deliberately not
 * a revert of the project's file, which would mean keeping a broken copy of it
 * in the tree: this is the algorithm, in twenty lines, on the same vocabulary.
 */
const merges = new Map(data.merges.map(([a, b, rank]) => [`${a}\u0000${b}`, rank]))
const vocab = new Map(Object.entries(data.vocab))

function slowWord(word: string): number[] {
  let sym = [...word.toLowerCase()].map((c, i) => (i === 0 ? c : `##${c}`))
  for (;;) {
    let bestRank = Infinity
    let at = -1
    for (let i = 0; i + 1 < sym.length; i++) {
      const rank = merges.get(`${sym[i]}\u0000${sym[i + 1]}`)
      if (rank !== undefined && rank < bestRank) {
        bestRank = rank
        at = i
      }
    }
    if (at < 0) break
    sym = [...sym.slice(0, at), sym[at]! + sym[at + 1]!.replace(/^##/, ''), ...sym.slice(at + 2)]
  }
  return sym.map((s) => vocab.get(s) ?? vocab.get('[UNK]')!)
}

function slowEncode(text: string): number[] {
  const ids: number[] = []
  for (const w of wordTokenize(normalize(text))) {
    // No break: the finding's outer loop, which tokenised every word and threw
    // the result away.
    for (const id of slowWord(w)) if (ids.length < 64) ids.push(id)
  }
  return ids
}

/** The three assertions, applied to whichever implementation is handed in. */
function judge(name: string, encode: (text: string) => unknown): boolean {
  const short = ms(encode, SHORT_WORD)
  const long = ms(encode, LONG_WORD)
  const many = ms(encode, MANY)
  const growth = long / Math.max(short, 0.05)
  const spread = many / Math.max(short, 0.05)

  const problems: string[] = []
  if (growth > 25) problems.push(`a word sixteen times the length costs ${growth.toFixed(0)} times as much, and quadratic is what that looks like`)
  if (spread > 4) problems.push(`200 long words cost ${spread.toFixed(0)} times one of them, so the cap is not stopping the work`)
  if (long > 300) problems.push(`16,000 characters in one word takes ${long.toFixed(0)} ms of blocked main thread`)

  console.log(
    `  ${name.padEnd(28)} 1k ${short.toFixed(1)} ms, 16k ${long.toFixed(1)} ms, 200 words ${many.toFixed(1)} ms` +
      `  (growth ${growth.toFixed(1)}x, spread ${spread.toFixed(1)}x)`,
  )
  for (const p of problems) console.log(`      ${p}`)
  return problems.length === 0
}

if (!judge('the tokenizer that ships', shipped)) {
  fail('the tokenizer costs more than the model it feeds', 'The page claims 2.5 ms of inference on the visitor\'s own machine.')
}

/*
 * And the control, which is the same assertions pointed at the shape the finding
 * described. It is behind a variable rather than run every build because it is
 * the slow one: twelve seconds against the shipped tokenizer's fifty
 * milliseconds, which is the whole point of it and not a price to pay on every
 * push.
 *
 *   WIT_COST_CONTROL=1 npm run check:cost
 *
 * Run at tick 161, and the numbers are in the devlog: growth 396x, spread 296x,
 * 6,917 ms for one 16,000 character word. A control that lives one variable away
 * from the gate is one anybody can re-run; a control that lives only in a commit
 * message is one nobody ever does.
 */
if (!process.env.WIT_COST_CONTROL) {
  console.log('  ok      the control is one variable away: WIT_COST_CONTROL=1 npm run check:cost')
} else if (judge('the shape WDR-F8 described', slowEncode)) {
  fail(
    'the quadratic tokenizer passes these thresholds',
    'Then they are not measuring what they were written for, and the gate above them is decoration.',
  )
} else {
  console.log('  ok      and the shape the finding described fails them, in the same run')
}

if (failed > 0) {
  console.error('\nA tokenizer that costs three orders of magnitude more than the model, for input the model never sees.')
  process.exit(1)
}

console.log('cost: one long word is milliseconds, and the work stops where the context does')
