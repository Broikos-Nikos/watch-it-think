/**
 * The sentence above `concentration()` is the arithmetic inside it.
 *
 *   npm run check:concentration
 *
 * WDR-F4. The docstring said "one minus the normalised entropy of the average
 * row" and the code computes one minus the average of the per row normalised
 * entropies. Entropy is concave, so those are not close. Measured at tick 157 on
 * the shipped int8 graph, "turn off the kitchen lights", through the project's
 * own Router:
 *
 *   L1H1   the code 0.4330   the old sentence 0.0475
 *   L1H4   the code 0.5664   the old sentence 0.0831
 *   L6H2   the code 0.6897   the old sentence 0.4412
 *   in all 24 fields the old sentence's number was the lower one
 *
 * The code is the half that was published: the commit introducing the field
 * quotes 43 percent for layer 1 head 1 and 69 percent for layer 6 head 2. The
 * sentence was wrong, and it is the only definition a reader gets of the number
 * the thumbnails are sorted and labelled by.
 *
 * ## What this does
 *
 * Both quantities, written out here independently of the library, against fields
 * whose answers are known by hand. Then `concentration()` is required to be one
 * of them to twelve decimal places and to differ from the other, and the
 * docstring is required to name the one it is.
 *
 * No model and no browser: the fields are constructed, so this runs in
 * `npm run check` on every build rather than in the browser pass. The numbers
 * above came from the real graph and are in the record; what has to be held
 * every time is the identity, and an identity needs no data to be true.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { concentration, type Field } from '../src/lib/attention'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/** One minus the average of the per row normalised entropies. What the code does. */
function meanOfRowEntropies(values: Float32Array, positions: number): number {
  let total = 0
  for (let q = 0; q < positions; q++) {
    let h = 0
    for (let k = 0; k < positions; k++) {
      const v = values[q * positions + k]!
      if (v > 1e-9) h -= v * Math.log(v)
    }
    total += h / Math.log(positions)
  }
  return 1 - total / positions
}

/** One minus the normalised entropy of the average row. What the sentence said. */
function entropyOfMeanRow(values: Float32Array, positions: number): number {
  const avg = new Float64Array(positions)
  for (let q = 0; q < positions; q++) {
    for (let k = 0; k < positions; k++) avg[k]! += values[q * positions + k]! / positions
  }
  let h = 0
  for (let k = 0; k < positions; k++) {
    const v = avg[k]!
    if (v > 1e-9) h -= v * Math.log(v)
  }
  return 1 - h / Math.log(positions)
}

const field = (positions: number, fill: (q: number, k: number) => number): Field => {
  const values = new Float32Array(positions * positions)
  for (let q = 0; q < positions; q++) {
    let sum = 0
    for (let k = 0; k < positions; k++) {
      const v = fill(q, k)
      values[q * positions + k] = v
      sum += v
    }
    for (let k = 0; k < positions; k++) values[q * positions + k]! /= sum
  }
  return { layer: 0, head: 0, values }
}

const N = 8
/*
 * The case that separates them, and it is not a corner case: every token
 * attends to exactly one position and each row picks a different one. That is a
 * perfectly sharp head, which is what the page is asking about, and its average
 * row is uniform. The old sentence scores it zero.
 */
const diagonal = field(N, (q, k) => (q === k ? 1 : 1e-9))
const uniform = field(N, () => 1)
const peaked = field(N, (q, k) => (k === (q + 1) % N ? 10 : 1))

const cases: [string, Field][] = [
  ['a perfectly sharp head, every row on its own position', diagonal],
  ['a head that spreads everything evenly', uniform],
  ['a head with one strong link per row', peaked],
]

for (const [name, f] of cases) {
  const mine = concentration(f, N)
  const rows = meanOfRowEntropies(f.values, N)
  const mean = entropyOfMeanRow(f.values, N)
  if (Math.abs(mine - rows) > 1e-12) {
    fail(
      `on ${name}, concentration() returns ${mine.toFixed(6)} and the average of the per row entropies is ${rows.toFixed(6)}`,
      'The function and the sentence above it have to be the same arithmetic, and this is the arithmetic the sentence names.',
    )
  } else {
    console.log(`  ok      ${name}: ${mine.toFixed(4)}, and the other quantity would say ${mean.toFixed(4)}`)
  }
}

/*
 * And they have to be different, or the identity above proves nothing. The
 * diagonal is the case where the difference is total: 1 against 0.
 */
const sharp = concentration(diagonal, N)
const sharpOther = entropyOfMeanRow(diagonal.values, N)
if (sharp - sharpOther < 0.5) {
  fail(
    `the two quantities agree to within ${(sharp - sharpOther).toFixed(4)} on a perfectly sharp head`,
    'If they cannot be told apart here, this gate is checking nothing and the docstring could say either.',
  )
}

/*
 * The sentence itself. A gate that holds the code to a formula and leaves the
 * comment alone is the same defect with an extra step.
 */
const src = readFileSync(resolve(root, 'src/lib/attention.ts'), 'utf8').replace(/\s+/g, ' ')
const WANTED = 'One minus the average of the per row normalised entropies'
const OLD = 'One minus the normalised entropy of the average row'
if (!src.includes(WANTED)) {
  fail(`the docstring does not say ${JSON.stringify(WANTED)}`, 'It is the only definition a reader gets of the number the thumbnails are sorted by.')
}
if (src.includes(`${OLD}. A head`)) {
  fail('the docstring describes the entropy of the average row again', 'That is the other quantity, and on a sharp head it reads as zero.')
}

if (failed > 0) {
  console.error('\nA number a page is sorted by, defined by a sentence that describes something else.')
  process.exit(1)
}

console.log('concentration: the function computes what the sentence above it says, and the two quantities are far apart')
