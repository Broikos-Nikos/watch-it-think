/**
 * The TypeScript tokenizer against the Python one, id for id.
 *
 *   python tools/dump_python_tokenizer.py --bslm-repo /path/to/bslm
 *   npm run check:tokenizer
 *
 * The model was trained on ids from `bslm/tokenizer.py`. A port that is close
 * produces ids the model has never seen, and the page then shows a worse model
 * than the one that was actually trained, with nothing on screen to say so. So
 * the bar is not "close": one differing id fails the build.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Tokenizer, wordTokenize, normalize, caseId, type TokenizerData } from '../src/lib/tokenizer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const expectedPath = resolve(root, 'tools/tokenizer-expected.json')

let expected: {
  maxLen: number
  cases: {
    text: string
    words: string[]
    caseIds: number[]
    ids: number[]
    cases: number[]
    wordIndex: number[]
  }[]
}

try {
  expected = JSON.parse(readFileSync(expectedPath, 'utf8'))
} catch {
  console.error(
    'tools/tokenizer-expected.json is missing. Generate it first:\n' +
      '  python tools/dump_python_tokenizer.py --bslm-repo /path/to/bslm',
  )
  process.exit(1)
}

const data: TokenizerData = JSON.parse(
  readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'),
)
const tok = new Tokenizer(data)

const same = (a: readonly unknown[], b: readonly unknown[]) =>
  a.length === b.length && a.every((v, i) => v === b[i])

let failed = 0
const report = (text: string, what: string, got: unknown, want: unknown) => {
  failed++
  if (failed > 8) return
  console.error(`FAIL  ${what}`)
  console.error(`      input: ${JSON.stringify(text.slice(0, 70))}`)
  console.error(`      python: ${JSON.stringify(want)}`)
  console.error(`      ts:     ${JSON.stringify(got)}`)
}

for (const c of expected.cases) {
  const words = wordTokenize(normalize(c.text))
  if (!same(words, c.words)) {
    report(c.text, 'the pre-tokenizer split the text differently', words, c.words)
    continue // every later comparison would just repeat this one
  }

  const cases = words.map(caseId)
  if (!same(cases, c.caseIds)) report(c.text, 'case ids differ', cases, c.caseIds)

  const enc = tok.encode(words, expected.maxLen)
  if (!same(enc.ids, c.ids)) report(c.text, 'token ids differ', enc.ids, c.ids)
  if (!same(enc.cases, c.cases)) report(c.text, 'per token case ids differ', enc.cases, c.cases)
  if (!same(enc.wordIndex, c.wordIndex)) {
    report(c.text, 'word index differs', enc.wordIndex, c.wordIndex)
  }
}

if (failed > 0) {
  if (failed > 8) console.error(`      ... and ${failed - 8} more`)
  console.error(
    `\n${failed} disagreements with bslm/tokenizer.py over ${expected.cases.length} sentences. ` +
      `The model was trained on the Python ids, so these are wrong, not different.`,
  )
  process.exit(1)
}

const tokens = expected.cases.reduce((a, c) => a + c.ids.length, 0)
console.log(
  `${expected.cases.length} sentences, ${tokens} tokens, identical to bslm/tokenizer.py`,
)
