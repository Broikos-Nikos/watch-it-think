/**
 * The table returns the colour the curve asks for, to one unit per channel.
 *
 *   npm run check:ramp
 *
 * WD2-F10. The field is drawn from a 256 row lookup table rather than by
 * building an `oklch(...)` string per cell, which is what took painting one
 * field from 144 ms to 1.1 ms. A table is an approximation of the curve it was
 * built from, and nothing measured how good an approximation it was.
 *
 * It was not good enough. The index was `(shown * 255) | 0`, which truncates,
 * so every cell sat half a step below the colour the curve asks for and the
 * bias only ever went one way. Measured at tick 184 over 200,001 values:
 *
 *     normal ramp  truncating  worst channel error 2, mean 0.5763,
 *                              at v=0.13301, rgb(0,79,114) vs rgb(0,80,116)
 *                  rounding    worst channel error 1, mean 0.3473
 *     dim ramp     truncating  worst 1, mean 0.6542
 *                  rounding    worst 1, mean 0.4147
 *
 * `check:draw` states the bar: "One unit per channel is the resolution of the
 * format. Anything larger is a different colour, not a rounding difference."
 * It then tests `oklchToRgb` against the browser's own `oklch()` parser and
 * never the table lookup, so the one place this project exceeded its own
 * tolerance was the one place it did not look. That is the gap this fills, and
 * it is why `rampStep` is exported: a gate that recomputed the index itself
 * would be testing its own copy rather than the code that ships.
 *
 * ## The two assertions
 *
 *   1. **Every value lands within one unit per channel** of the continuous
 *      colour, on both ramps, at the hue the page draws with. The curve is
 *      written out here rather than imported, so a change to `rampStep`'s
 *      `sqrt` shows up as a disagreement instead of cancelling out.
 *   2. **The table never folds back.** Relative luminance across the 256 rows
 *      has to be non-decreasing, because the picture's whole claim is that a
 *      brighter cell means a larger number. A table that dips in the middle
 *      would pass assertion 1 at every point and still lie about the ordering,
 *      and nothing else in this project would notice.
 *
 * No browser and no model: this is arithmetic, so it runs in `npm run build`
 * with the other twenty one rather than in the suite that needs a server.
 */

import { oklchToRgb, rampFor, rampStep } from '../src/lib/attention'

/* The hue the page draws the field in, and the one `check:palette` holds
   against the stylesheet. The dim ramp is the same curve at a quarter of the
   chroma, which is what `drawField` hands a row that is not focused. */
const HUE = 235
const SAMPLES = 200_001
const BAR = 1

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/** The colour the page would have asked the browser for, with no table. */
const exact = (shown: number, chroma: number) =>
  oklchToRgb(0.18 + shown * 0.62, (0.03 + shown * 0.17) * chroma, HUE)

const { normal, dim } = rampFor(HUE)

for (const [name, ramp, chroma] of [
  ['normal', normal, 1],
  ['dim', dim, 0.25],
] as const) {
  let worst = 0
  let at = 0
  let got: readonly number[] = []
  let want: readonly number[] = []
  let sum = 0

  for (let i = 0; i < SAMPLES; i++) {
    const v = i / (SAMPLES - 1)
    const step = rampStep(v)
    const shown = v >= 1 ? 1 : Math.sqrt(v)
    const table = [ramp[step * 3]!, ramp[step * 3 + 1]!, ramp[step * 3 + 2]!]
    const curve = exact(shown, chroma)
    let e = 0
    for (let c = 0; c < 3; c++) e = Math.max(e, Math.abs(table[c]! - curve[c]!))
    sum += e
    if (e > worst) {
      worst = e
      at = v
      got = table
      want = curve
    }
  }

  const mean = sum / SAMPLES
  if (worst > BAR) {
    fail(
      `the ${name} ramp is ${worst} units per channel from the curve it was built from, over the ${BAR} unit bar`,
      `worst at v=${at.toFixed(5)}, the table gives rgb(${got.join(',')}) where the curve asks for rgb(${want.join(',')}), mean ${mean.toFixed(4)}`,
    )
  } else {
    console.log(
      `  ok      the ${name} ramp is within ${worst} unit per channel of its curve over ${SAMPLES.toLocaleString('en-US')} values, mean ${mean.toFixed(4)}`,
    )
  }
}

/*
 * Ordering. Relative luminance, the same weighting `check:contrast` uses, so
 * "brighter" means what it means everywhere else in this workspace.
 */
const lum = (r: number, g: number, b: number) => {
  const f = (c: number) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

for (const [name, ramp] of [
  ['normal', normal],
  ['dim', dim],
] as const) {
  const dips: string[] = []
  let previous = -1
  for (let i = 0; i < 256; i++) {
    const l = lum(ramp[i * 3]!, ramp[i * 3 + 1]!, ramp[i * 3 + 2]!)
    if (l < previous - 1e-9) dips.push(`step ${i}`)
    previous = l
  }
  if (dips.length > 0) {
    fail(
      `the ${name} ramp gets darker as the number gets larger, at ${dips.length} of its 256 steps`,
      `${dips.slice(0, 6).join(', ')}. A cell that is brighter has to mean a cell that is larger, or the picture is not a scale.`,
    )
  } else {
    console.log(`  ok      the ${name} ramp never darkens as the value rises, across all 256 steps`)
  }
}

if (failed > 0) {
  console.error('\nA lookup table is an approximation, and an approximation nobody measured is a claim nobody checked.')
  process.exit(1)
}

console.log('ramp: the table is the curve, to the resolution of the format, and it only ever rises')
