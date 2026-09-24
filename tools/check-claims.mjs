/**
 * Every number in the README comes out of the measurement.
 *
 *   npm run check:claims
 *
 * The README says "nothing here is typed by hand". It was typed by hand when
 * that sentence was written, which makes it the one claim in the file that was
 * false at the moment of writing, and the kind of claim this repository exists
 * to be careful about. This is what makes it true.
 *
 * `meta.json` is the authority. It is written by the tools that did the
 * measuring, the page reads it directly, and the README cannot, because prose
 * is not a data structure. So the two are held together here: each claim below
 * names the figure, where it lives in `meta.json`, and how it is spelled in the
 * README, and a mismatch fails by name rather than by diff.
 *
 * `tokenlab` has the same gate and it earned its place on its first run, by
 * catching a hand typed 1.63 against a measured 1.61.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Whitespace is flattened before matching. Prose wraps, so a phrase broken
// across two lines is the same claim as the phrase on one, and the first
// version of this gate failed on exactly that: it was measuring line breaks
// rather than numbers.
const readmeRaw = readFileSync(resolve(root, 'README.md'), 'utf8')
const readme = readmeRaw.replace(/\s+/g, ' ')
const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))
const q = meta.quantisation

const int8 = q.int8
const abstain = int8.withAbstain
const byLength = Object.fromEntries(int8.byLength.map((b) => [b.tokens, b.medianMs]))

/** A claim: what it is, the value the measurement gives, how the README spells it. */
const claims = [
  ['parameter count', meta.parameters.toLocaleString('en-US')],
  /*
   * These four are held to the words the README puts around them, not to the
   * digit, and the reason is worth the four lines.
   *
   * Measured on 2026-09-24: this file claimed `layers` as the bare string "6",
   * checked with `includes`, and "6" occurs **19 times** in README.md. `heads`
   * was "4", which occurs **23 times**. Rewrite the architecture paragraph to
   * say 8 layers and 12 heads and both assertions would still have passed, in a
   * gate whose whole purpose is that the README cannot describe a different
   * model from the one in `meta.json`.
   *
   * Four of the twenty four claims here could not fail. A gate that cannot fail
   * is not a weak gate, it is a comment that costs CI time.
   *
   * The decimals elsewhere in this list are safe by accident rather than by
   * design: `chunkline` was swept at the same time and its four rates are four
   * significant figures each, appearing exactly once. Accident is not a reason
   * to leave this shape in place, since the next claim added might be an
   * integer.
   */
  ['layers, as the architecture line says it', `${meta.config.n_layers} layers`],
  ['heads, as the architecture line says it', `${meta.config.n_heads} attention heads`],
  ['vocabulary size', meta.config.vocab_size.toLocaleString('en-US')],
  ['context length, as the architecture line says it', `${meta.maxLen} token context`],
  ['context length, where the limit is explained', `A ${meta.maxLen} token context`],
  ['intent count, as the scope section says it', `${meta.intents.length} intents`],
  ['bytes over the wire', `${(q.bytesInt8 / 1e6).toFixed(2)} MB`],
  ['shrink factor', `${q.shrink} times smaller`],
  ['held out rows', q.rowsEvaluated.toLocaleString('en-US')],
  ['int8 intent accuracy', `${int8.intentAccuracy}%`],
  ['fp32 intent accuracy', `${q.fp32.intentAccuracy}%`],
  ['abstaining accuracy', `${abstain.intentAccuracy}%`],
  ['declined rows', String(abstain.abstained)],
  ['abstain threshold', String(abstain.threshold)],
  ['tag accuracy', `${int8.tagAccuracy}%`],
  ['exact match', `${int8.exactMatch}%`],
  ['fp32 exact match', `${q.fp32.exactMatch}%`],
  ['cross check disagreements', String(q.crossCheck.argmaxDisagreements)],
  ['cross check rows', String(q.crossCheck.rows)],
  ['attention fields checked', String(meta.parity.attentionAgainstNumpyWitness.fields)],
  ['latency at 6 tokens', `${byLength[6].toFixed(2)} ms`],
  ['latency at 14 tokens', `${byLength[14].toFixed(2)} ms`],
  ['latency at 32 tokens', `${byLength[32].toFixed(2)} ms`],
  ['latency at 64 tokens', `${byLength[64].toFixed(2)} ms`],
]

let failed = 0
for (const [what, value] of claims) {
  // Counted, not merely found: a figure that appears twice and is corrected in
  // only one place is the defect this is for.
  const hits = readme.split(value).length - 1
  if (hits === 0) {
    failed++
    console.error(`FAIL  ${what}: the measurement says ${JSON.stringify(value)} and the README does not say it`)
  }
}

// The split the accuracy was measured on has to be named, because the same
// numbers on an easier set would be a different claim.
if (q.testSet?.split === 'adversarial' && !/adversarial/i.test(readme)) {
  failed++
  console.error('FAIL  the numbers come from the adversarial split and the README does not say so')
}

// The tag accuracy is meaningless without its baseline, which is high: most
// words carry no slot. Shipping 97.28% alone is the finding WP-F6 raised.
if (readme.includes(`${int8.tagAccuracy}%`) && !/baseline/i.test(readme)) {
  failed++
  console.error('FAIL  the tag accuracy is quoted with no baseline beside it')
}

if (failed > 0) {
  console.error(`\n${failed} claims in README.md are not what the measurement says.`)
  process.exit(1)
}

console.log(`${claims.length} claims in README.md check out against meta.json`)
