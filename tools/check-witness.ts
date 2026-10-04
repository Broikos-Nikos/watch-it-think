/**
 * The witness's two controls, measured, against the two files that quote them.
 *
 *   npm run check:witness
 *
 * WME2-F7. The README said reversing the layer order or rolling the head axis
 * "fails this one at 9.6e-01". `meta.json` said both fail "at about 9.8e-01".
 * One claim, two numbers, in the two files that state it, and nothing produced
 * either: they were hand mutations quoted out of commit messages, `f0ff6e4` on
 * a sample of four English sentences and `8488859` after the sample became both
 * languages and 63 tokens long. The README's figure was the roll's, applied to
 * both controls, and `meta.json` carried the older sample's in the file the
 * README calls "written by the tool that measured it".
 *
 * This is the evidence for the strongest claim in the README: that the one
 * output nothing else can check is checked. A number nothing produces is not
 * evidence.
 *
 * ## What is held
 *
 *   1. Both controls are re-measured here, from `public/model/router.int8.onnx`
 *      through this project's own tokenizer, and compared to what `meta.json`
 *      records. Not read back: measured.
 *   2. The README quotes both, to one decimal in exponential form, and the two
 *      numbers are not the same number.
 *   3. The sample the controls run on is the sample the witness ran on, by
 *      token count, so a control measured on four short English sentences
 *      cannot be quoted against a witness that ran on two 60 token ones.
 *   4. No control value survives in prose. `meta.json`'s note carried one for
 *      eleven days.
 *
 * TOLERANCE is not slack for this machine, where two runs agree exactly. It is
 * for a runner whose int8 kernels land the cube somewhere slightly different,
 * and it is three orders of magnitude below the distance between the controls
 * and the zero they are being contrasted with.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONTROL_IDS, exponent, measureControls } from './witness-controls.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TOLERANCE = 1e-3

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')
const witness = meta.parity?.attentionAgainstNumpyWitness
const recorded = witness?.controls

if (!recorded) {
  fail(
    'meta.json records no measured controls under parity.attentionAgainstNumpyWitness',
    'Run npm run witness:controls -- --write. The README quotes these two numbers.',
  )
  process.exit(1)
}

const measured = await measureControls()

/* 1. the numbers, against the file that claims them */
for (const id of CONTROL_IDS) {
  const want = recorded[id]
  const got = measured.worst[id]
  if (typeof want !== 'number') {
    fail(`meta.json records no ${id}`)
  } else if (Math.abs(want - got) > TOLERANCE) {
    fail(
      `${id}: meta.json says ${exponent(want)} and the graph says ${exponent(got)}`,
      `${Math.abs(want - got).toExponential(1)} apart, over a tolerance of ${TOLERANCE.toExponential(0)}. ` +
        'Run npm run witness:controls -- --write.',
    )
  } else {
    console.log(`  ok      ${id}: ${exponent(got)}, measured here and in meta.json`)
  }
}

/* 2. the README quotes both, and they are two numbers rather than one */
const quoted = CONTROL_IDS.map((id) => exponent(measured.worst[id]).replace('e-1', 'e-01'))
const missing = quoted.filter((q) => !readme.includes(q))
if (missing.length > 0) {
  fail(
    `the README does not state ${missing.join(' and ')}`,
    `it has to quote both controls: ${quoted.join(' and ')}. ` +
      'One figure for two mutations is how this finding started.',
  )
} else if (new Set(quoted).size === 1) {
  console.log(`  ok      the README quotes ${quoted[0]} for both controls, which is what they measure`)
} else {
  console.log(`  ok      the README quotes ${quoted.join(' and ')}, one for each control`)
}

/* 3. the controls ran on the witness's own sample */
const ours = measured.sample.map((s) => s.tokens).sort((a, b) => a - b)
const theirs = [...(witness.sentenceTokens ?? [])].sort((a: number, b: number) => a - b)
if (theirs.length === 0) {
  fail('meta.json records no sentenceTokens, so the two samples cannot be compared')
} else if (ours.length !== theirs.length || ours.some((n, i) => n !== theirs[i])) {
  fail(
    `the controls ran on ${ours.join(', ')} token sentences and the witness ran on ${theirs.join(', ')}`,
    'A control measured on a different sample from the witness is not that witness’s control.',
  )
} else {
  console.log(`  ok      both ran on the same four sentences, ${ours.join(', ')} tokens`)
}

/* 4. and no control value is left in prose anywhere */
const PROSE = [
  ['public/model/meta.json, the witness note', String(witness.note ?? '')],
  ['tools/export_onnx.py', readFileSync(resolve(root, 'tools/export_onnx.py'), 'utf8')],
]
const LOOSE = /\b\d\.\d+e-0?1\b/i
for (const [where, text] of PROSE) {
  /*
   * Shipped strings, not commentary.
   *
   * The first version of this flagged the comment in `export_onnx.py` that
   * explains the defect, which quotes both of the old numbers because that is
   * what it is explaining. A gate that greps has to strip its own subject's
   * prose first, which is the third time that has been written down in this
   * workspace. A `#` line in a python tool reaches nobody; the note inside
   * `meta.json` is served to the page.
   */
  const lines = text
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .filter((l) => LOOSE.test(l) && !/witness:controls/.test(l))
  if (lines.length > 0) {
    fail(
      `${where} still writes a control value into prose`,
      `${JSON.stringify(lines[0].trim().slice(0, 110))}. These two numbers come from npm run witness:controls.`,
    )
  } else {
    console.log(`  ok      ${where} states no control value of its own`)
  }
}

if (failed > 0) {
  console.error('\nThe strongest claim in this README rests on two numbers. They are measured or they are decoration.')
  process.exit(1)
}

console.log(
  `witness: both controls measured from the shipped graph, ${CONTROL_IDS.map((id) => `${id} ${exponent(measured.worst[id])}`).join(', ')}`,
)
