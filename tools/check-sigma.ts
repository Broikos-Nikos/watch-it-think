/**
 * The final sigma, measured, and the prose around it held to the measurement.
 *
 *   npm run check:sigma
 *
 * WDR-F9. `tools/dump_python_tokenizer.py` said its Greek case covers "upper
 * case Greek, where JavaScript lower cases a final sigma and Python does not".
 * That is false in both directions and it is the theory that broke the port.
 * Measured at tick 162, in both languages, on this machine:
 *
 *   'ΟΔΟΣ'.lower()        U+03BF U+03B4 U+03BF U+03C2    Python
 *   'ΟΔΟΣ'.toLowerCase()  U+03BF U+03B4 U+03BF U+03C2    JavaScript
 *   per code point, both  U+03BF U+03B4 U+03BF U+03C3
 *   'Σ' alone, both       U+03C3
 *
 * Both apply the rule. The difference that matters is the whole word against the
 * code point, in either language, and the per character version produced `##σ`
 * where the model expects `##ς`. The finding called those two token ids apart;
 * measured here they are adjacent, 63 and 64, which changes nothing about the
 * defect and is the number this file will print.
 *
 * The comment survived the fix because it lived in the file that generates the
 * gate's expectations, which is the worst place for it: `commit 22c9d44` is
 * explicitly about this and its own best line is "the comment had been written
 * before anything was measured".
 *
 * ## What this checks
 *
 * The runtime first, because a claim about a language is checkable in it:
 *
 *   lowercasing the whole word ends in a final sigma
 *   lowercasing code point by code point does not
 *   the two therefore disagree, which is what the case exists to catch
 *   this project's own tokenizer takes the first road, and the ids it produces
 *     for ΟΔΟΣ differ from the ids the per character version would produce
 *
 * Then the prose, in both files: neither may claim the languages differ here,
 * and both have to name what actually does.
 *
 * Python is not run. It is not in this project's CI and it does not need to be:
 * the measurement above is recorded, and what could rot is the sentence, which
 * is read from disk every time this runs.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Tokenizer, type TokenizerData } from '../src/lib/tokenizer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const cp = (s: string) => [...s].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

const WORD = 'ΟΔΟΣ'
const FINAL = 'ς'
const MEDIAL = 'σ'

const whole = WORD.toLowerCase()
const perCodePoint = [...WORD].map((c) => c.toLowerCase()).join('')

if (!whole.endsWith(FINAL)) {
  fail(`toLowerCase on the whole word gives ${cp(whole)}`, 'The final sigma rule is what the Greek case in the dump tool exists to cover.')
}
if (!perCodePoint.endsWith(MEDIAL)) {
  fail(`lowercasing code point by code point gives ${cp(perCodePoint)}`, 'The point of the case is that this road is the wrong one, so it has to be the wrong one.')
}
if (whole === perCodePoint) {
  fail('the two ways of lowercasing agree', 'Then this case catches nothing, and the port could take either road.')
} else {
  console.log(`  ok      whole word ${cp(whole)}, per code point ${cp(perCodePoint)}`)
}

/*
 * And the tokenizer, because the sentence is about tokens rather than about
 * strings: the two spellings land on adjacent ids, and the model was trained on
 * one of them.
 */
const data: TokenizerData = JSON.parse(readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'))
const tok = new Tokenizer(data)
const ours = tok.encodeWord(WORD)
const theirs = tok.encodeWord(perCodePoint)
if (JSON.stringify(ours) === JSON.stringify(theirs)) {
  fail(
    'the tokenizer gives the same ids for both spellings',
    `${JSON.stringify(ours)} either way, so nothing downstream could tell the two roads apart.`,
  )
} else {
  console.log(`  ok      the ids differ: ${JSON.stringify(ours)} against ${JSON.stringify(theirs)}`)
}

/*
 * The prose. This is the half that rotted: the arithmetic was fixed in
 * September and the sentence describing it was not.
 */
const files: [string, string][] = [
  ['tools/dump_python_tokenizer.py', readFileSync(resolve(root, 'tools/dump_python_tokenizer.py'), 'utf8')],
  ['src/lib/tokenizer.ts', readFileSync(resolve(root, 'src/lib/tokenizer.ts'), 'utf8')],
]

for (const [name, text] of files) {
  const flat = text.replace(/\s+/g, ' ')
  /*
   * The claim, in the shape it was written in: a language named on one side of
   * "final sigma" and a denial on the other. Quoting the old sentence in order
   * to correct it is allowed, and both files now do exactly that, so the pattern
   * asks for the assertion rather than for the words: a denial that is not
   * inside a sentence about what used to be said.
   */
  const denial = /(JavaScript|Python) lower cases a final sigma and (Python|JavaScript) does not/i.exec(flat)
  if (denial && !/Until tick 162|had been written before anything was measured/i.test(flat)) {
    fail(`${name} says ${JSON.stringify(denial[0])}`, 'Both languages apply the rule. This sentence is the theory that broke the port.')
  }
  if (!/whole word/i.test(flat) || !/code point/i.test(flat)) {
    fail(
      `${name} does not say what the difference actually is`,
      'It is the whole word against the code point, in either language, and that is the only part a reader needs.',
    )
  }
}

if (failed > 0) {
  console.error('\nThe comment that caused the bug, in the file that generates the gate.')
  process.exit(1)
}

console.log('sigma: both ways of lowercasing measured, and both files say which one the port takes')
