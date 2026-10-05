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
 *
 * There are two halves, and the second is where a figure is **counted rather
 * than merely found**: every millisecond in the README has to be a latency
 * `meta.json` produces, so a figure corrected in one place and left stale in
 * another is caught by being unaccounted for rather than by being wrong. The
 * percentages are swept the same way by `check:upstream` and the sizes over
 * the wire by `check:weight`.
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
  /*
   * WR-F5. The table led with a bold 74.53% and no anchor, while the tag row
   * two lines below carried its 74.98% floor in the row label: the recruiter
   * pass read the biggest number on the page as a C. The anchor is one
   * division, so it is held like every other figure rather than typed:
   * one correct answer out of however many intents this model has.
   */
  ['the guess the intent number is read against', `${(100 / meta.intents.length).toFixed(2)}%`],
  /*
   * WDR-F6 named the page's version of this: "5.28 MB over the wire" described
   * one file of the seven a visit fetches. The page's sentence was fixed at tick
   * 150 and this label was not, so the gate holding the claims went on calling
   * the graph on disk the thing that goes over the wire. It is 5.28 MB of int8
   * weights; gzipped it is 4.32, and a first visit is 8.19 across ten files.
   * check:weight holds all of those to dist. This holds this one to meta.json.
   */
  ['the int8 graph on disk, as the download section states it', `${(q.bytesInt8 / 1e6).toFixed(2)} MB int8 graph`],
  ['shrink factor, as the sentence now states it', `${q.shrink} times that size`],
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
  const hits = readme.split(value).length - 1
  if (hits === 0) {
    failed++
    console.error(`FAIL  ${what}: the measurement says ${JSON.stringify(value)} and the README does not say it`)
  }
}

/*
 * ---- and the comments that cite the same file ------------------------------
 *
 * WM2-F8. `src/lib/router.ts` carries the four latency figures in prose, eight
 * lines above the sentence "meta.json carries these numbers under
 * quantisation.int8.byLength". Measured at tick 209: it said 0.57, 0.94, 1.80,
 * 3.66 against 0.576, 0.968, 1.919, 3.697, so all four were wrong at the two
 * decimals it writes and one by 6.2 percent.
 *
 * It is the most carefully reasoned prose in the source and the place a
 * maintainer goes to understand why wasm was chosen over a WebGPU bridge. A
 * comment that cites a file and disagrees with it teaches a reader to stop
 * trusting the comments, which is worse than the six percent.
 *
 * So a source file that cites `meta.json` is held to it the way the README is.
 * The list is deliberately short: a file earns a place here by naming the file
 * it is quoting, which is the thing that makes a stale figure a contradiction
 * rather than a rounding.
 */
const CITING = [['src/lib/router.ts', 'quantisation.int8.byLength', claims.filter(([what]) => what.startsWith('latency at '))]]

for (const [file, cites, owed] of CITING) {
  const text = readFileSync(resolve(root, file), 'utf8')
  if (!text.includes(cites)) {
    failed++
    console.error(`FAIL  ${file} no longer says it carries ${cites}`)
    console.error('      This list is for files that cite the measurement. One that does not should not be here.')
    continue
  }
  const missing = owed.filter(([, value]) => !text.includes(value))
  if (missing.length > 0) {
    failed++
    console.error(`FAIL  ${file} cites ${cites} and contradicts it in ${missing.length} of ${owed.length} figures`)
    console.error(`      it does not say ${missing.map(([, v]) => JSON.stringify(v)).join(', ')}`)
  } else {
    console.log(`  ok      ${file} cites ${cites} and all ${owed.length} of its figures match`)
  }
}

/*
 * ---- and the other direction, which is the half that counts ---------------
 *
 * WD2-F8. The loop above used to carry the comment "Counted, not merely found:
 * a figure that appears twice and is corrected in only one place is the defect
 * this is for". It counted nothing: `hits` was computed and then only compared
 * to zero, so a stale duplicate passed. The obvious repair, failing on
 * `hits > 1`, is worse than the defect: measured at tick 181, eight of the
 * twenty five claims above legitimately appear more than once, "0" twenty one
 * times, "97.28%" three, and the gate would fail on a correct README.
 *
 * A figure corrected in one place and not the other leaves behind a figure of
 * the right shape that the measurement does not produce, so that is the thing
 * to look for, and it is what `promptcost` and `retrievalbench` already do.
 * The percentages on this page are swept by `check:upstream`, which resolves
 * every one to `meta.json` or to a pinned entry in `docs/upstream.json`, and
 * the sizes over the wire are held to `dist` by `check:weight`. The
 * milliseconds were swept by nothing, which is where the stale number in this
 * project actually appeared: WM2-F8 is a latency comment left quoting 0.98 ms
 * against 0.72 ms after the numbers moved.
 */
const produced = new Set()
for (const b of int8.byLength) {
  produced.add(b.medianMs.toFixed(2))
  produced.add(String(b.medianMs))
}
for (const v of [int8.latency?.medianMs, int8.latency?.p95Ms, q.fp32?.latency?.medianMs]) {
  if (typeof v === 'number') {
    produced.add(v.toFixed(2))
    produced.add(String(v))
  }
}
const inProse = [...new Set(readme.match(/\b\d{1,4}\.\d{1,2}(?= ms\b)/g) ?? [])]
const orphans = inProse.filter((f) => !produced.has(f))
if (orphans.length > 0) {
  failed++
  console.error(
    `FAIL  the README states ${orphans.join(', ')} ms and meta.json produces no such latency`,
  )
  console.error(`      it produces ${[...produced].filter((p) => p.includes('.')).sort().join(', ')}`)
} else {
  console.log(
    `  ok      all ${inProse.length} millisecond figures in the README are latencies meta.json produces`,
  )
}

// The split the accuracy was measured on has to be named, because the same
// numbers on an easier set would be a different claim.
if (q.testSet?.split === 'adversarial' && !/adversarial/i.test(readme)) {
  failed++
  console.error('FAIL  the numbers come from the adversarial split and the README does not say so')
}

/*
 * The tag accuracy is meaningless without its baseline, which is high: most
 * words carry no slot. Shipping 97.28% alone is the finding WP-F6 raised and
 * WM-F6 raised again from the measurement side.
 *
 * Beside it, and not merely somewhere in the file. Until tick 170 this asked
 * whether the word "baseline" occurred anywhere in the README, which is a
 * question a careless edit answers by accident: measured then, replacing 74.98
 * with 12.34 left this gate green, and deleting the whole paragraph while
 * leaving the word in the next sentence left it green too. Both were caught, by
 * `check:upstream`, which holds the pinned number in both directions. So the
 * number was safe and this assertion was not the reason.
 *
 * What it asks now: the baseline value comes from `docs/upstream.json` rather
 * than from a literal here, and the value itself, not the word, has to appear
 * in every block that quotes the accuracy. A reader who meets the table does not
 * read the rest of the file first, so the floor moved into the row label: "slot
 * tag accuracy, against a 74.98% floor".
 */
/*
 * And the same for the intent accuracy, on both surfaces that print it.
 *
 * WR-F5, the recruiter pass of 22 September: "the biggest number in the
 * document reads as a failing grade, and the only baseline given belongs to
 * the other number". The tag figure, two rows down, had carried its floor in
 * the row label since tick 170 because of the assertion below. The intent
 * figure, which is the larger type and the one a reader quotes, had nothing.
 *
 * Its scale is how many ways there are to be wrong: 44 intents, so a coin
 * scores 2.27%. Derived from `meta.intents`, never written down, so it cannot
 * drift from the labels the model ships with.
 *
 * In bold, and not in every paragraph. The tag rule below asks every paragraph
 * that quotes the number, because the tag floor is surprising and a reader can
 * meet that figure anywhere. This one asks where the figure is **set in bold**,
 * which in this README is the row a reader takes away, because the sentence
 * under the table reasons about 74.53 against 72.63 and making it recite the
 * baseline again would be the kind of assertion an author edits out.
 *
 * ## The page, not just the file
 *
 * The footer said "74.53% ... against 74.58% before quantisation", which has
 * the shape of a scale and is not one: int8 against float32 is this model
 * measured twice. The finding was filed against the README and the page had it
 * too, which is why this reads `src/main.ts` as well. What it can see there is
 * the sentence being built, not the sentence on screen; `check:weight` is what
 * drives a browser at that footer.
 */
const guess = `${(100 / meta.intents.length).toFixed(2)}%`
const boldWith = readmeRaw
  .split(/\n\s*\n/)
  .map((p) => p.replace(/\s+/g, ' '))
  .filter((p) => new RegExp(`\\*\\*\\s*${int8.intentAccuracy}\\s*%\\s*\\*\\*`).test(p))

if (boldWith.length === 0) {
  failed++
  console.error(
    `FAIL  the README never sets the intent accuracy ${int8.intentAccuracy}% in bold, so this gate cannot tell which figure it is about`,
  )
} else {
  const anchored = boldWith.filter((p) => p.includes(guess))
  if (anchored.length < boldWith.length) {
    failed++
    console.error(
      `FAIL  ${int8.intentAccuracy}% is set in bold in ${boldWith.length} block${boldWith.length === 1 ? '' : 's'} and ${boldWith.length - anchored.length} of them ${boldWith.length - anchored.length === 1 ? 'does' : 'do'} not name the ${guess} guess between ${meta.intents.length} intents`,
    )
    console.error('      A reader who did school reads 74 as a C. The scale is how many ways there are to be wrong.')
  } else {
    console.log(
      `  ok      ${int8.intentAccuracy}% is in bold in ${boldWith.length} block${boldWith.length === 1 ? '' : 's'}, every one naming the ${guess} guess`,
    )
  }
}

const mainTs = readFileSync(resolve(root, 'src/main.ts'), 'utf8')
const footerCall = mainTs.match(/el\.footer\.textContent[\s\S]{0,700}/)?.[0] ?? ''
if (!/100 \/ m\.intents\.length/.test(mainTs)) {
  failed++
  console.error('FAIL  src/main.ts does not derive the guess from meta.intents, so the footer prints a baseline typed by hand or none')
} else if (!/\$\{guess\}/.test(footerCall)) {
  failed++
  console.error(
    `FAIL  the page footer quotes the intent accuracy without the ${guess} guess beside it`,
    )
  console.error('      It read "against 74.58% before quantisation", which is this model measured twice, not a scale.')
} else {
  console.log(`  ok      the page footer names the ${guess} guess, derived from meta.intents`)
}

const pinned = JSON.parse(readFileSync(resolve(root, 'docs/upstream.json'), 'utf8'))
const baseline = pinned.numbers?.find((n) => n.id === 'tag-majority-baseline')?.value
/* From the raw text, not from `readme`: that one has had its newlines flattened
   twenty lines above, so splitting it on a blank line gives a single paragraph
   holding the whole file and this assertion passes on any README at all. It was
   written that way first, and the only reason it is not still written that way
   is that the control was run. */
const paragraphs = readmeRaw.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, ' '))
const quoting = paragraphs.filter((p) => p.includes(`${int8.tagAccuracy}%`))

if (!baseline) {
  failed++
  console.error('FAIL  docs/upstream.json no longer pins tag-majority-baseline, so this gate has nothing to hold the tag accuracy to')
} else if (quoting.length > 0) {
  const withIt = quoting.filter((p) => p.includes(baseline))
  if (withIt.length < quoting.length) {
    failed++
    console.error(
      `FAIL  the tag accuracy ${int8.tagAccuracy}% is quoted in ${quoting.length} place${quoting.length === 1 ? '' : 's'} and ${quoting.length - withIt.length} of them ${quoting.length - withIt.length === 1 ? 'does' : 'do'} not name the ${baseline} baseline`,
    )
    console.error('      Most words carry no slot, so the floor is high and the number reads better than it is.')
  }
  if (!readme.includes(baseline)) {
    failed++
    console.error(`FAIL  the README never says the ${baseline} baseline that docs/upstream.json pins`)
  }
}

if (failed > 0) {
  console.error(`\n${failed} claims in README.md are not what the measurement says.`)
  process.exit(1)
}

console.log(`${claims.length} claims in README.md check out against meta.json`)
