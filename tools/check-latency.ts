/**
 * The number under the box is the number it says it is.
 *
 *   npm run check:latency
 *
 * WD2-F5. The first inference of a session is several times the steady state
 * one, so the page reports it as "first run" and takes a median of the rest.
 * It kept the cold run in the sample set and called `sorted[Math.floor(n / 2)]`
 * the median, which at two samples is the larger of the two. Measured at tick
 * 179 on the shipped rule, with a cold 51.2 ms and four warm ones:
 *
 *   51.2  ->  51.2 ms, first run
 *    2.4  ->  51.2 ms, median of 2      the cold number, dressed as a median
 *    2.6  ->   2.6 ms, median of 3
 *    2.3  ->   2.6 ms, median of 4      the upper middle, not the middle
 *
 * The one figure the rewrite existed to stop showing was shown again with a
 * word in front of it that made it look measured.
 *
 * ## What is checked
 *
 *   the median of an even set is the mean of the two middles
 *   the cold run is reported once and never enters the samples
 *   no later line can print the cold number when it is the largest of them
 *   the window drops the oldest, so the figure follows the page
 *
 * All of it against `src/lib/latency.ts` itself, which is where the rule went
 * so that it could be asked these questions without a browser.
 */

import { makeLatency, median } from '../src/lib/latency'

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/* ---- the arithmetic ------------------------------------------------------ */
for (const [values, want] of [
  [[1], 1],
  [[2, 1], 1.5],
  [[3, 1, 2], 2],
  [[4, 1, 3, 2], 2.5],
  [[9, 1, 1, 1, 1], 1],
] as const) {
  const got = median(values)
  if (got !== want) fail(`median(${JSON.stringify(values)}) is ${got} and should be ${want}`)
}
console.log('  ok      the median of an even set is the mean of the two middles')

/* ---- the reporter, on the series the audit describes --------------------- */
const l = makeLatency()
const said = [51.2, 2.4, 2.6, 2.3, 2.5, 2.4].map((ms) => l.report(ms))
const wanted = [
  '51.2 ms, first run',
  '2.4 ms',
  '2.5 ms, median of 2',
  '2.4 ms, median of 3',
  '2.5 ms, median of 4',
  '2.4 ms, median of 5',
]
for (const [i, want] of wanted.entries()) {
  if (said[i] !== want) fail(`run ${i + 1} printed ${JSON.stringify(said[i])} and should print ${JSON.stringify(want)}`)
}
if (failed === 0) console.log(`  ok      the cold run is said once and never counted: ${said.slice(0, 3).join(' | ')}`)

/* ---- and it cannot come back --------------------------------------------- */
const cold = makeLatency()
const first = 51.2
const lines = [cold.report(first), ...[2.4, 2.6, 2.3, 2.5, 2.4, 2.7, 2.2].map((ms) => cold.report(ms))]
const haunted = lines.slice(1).filter((line) => line.startsWith(first.toFixed(1)))
if (haunted.length > 0) {
  fail(`the cold ${first} ms is printed again after the first run`, haunted.join(' | '))
} else {
  console.log(`  ok      ${lines.length - 1} warm lines and none of them is the ${first} ms cold run`)
}

/* ---- the window ---------------------------------------------------------- */
const windowed = makeLatency(5)
windowed.report(99)
for (const ms of [1, 1, 1, 1, 1]) windowed.report(ms)
for (const ms of [5, 5, 5, 5, 5]) windowed.report(ms)
const last = windowed.report(5)
if (!last.startsWith('5.0')) {
  fail(`after ten runs of 5 ms the line says ${JSON.stringify(last)}`, 'the window is supposed to drop the oldest, so the figure follows the page rather than averaging its history')
} else {
  console.log(`  ok      the window holds ${windowed.samples.length} and follows the page: ${last}`)
}

if (failed > 0) {
  console.error('\nA median is a promise about which number is being shown.')
  process.exit(1)
}

console.log('latency: the cold run is said once, and the median is a median')
