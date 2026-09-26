/**
 * The number under the box, and what it is allowed to claim.
 *
 * The first inference of a fresh session is several times the steady state one,
 * and `boot()` ends by running one, so the first figure a visitor ever saw was
 * the worst one the page will ever produce, printed to a precision that implied
 * it was stable. Measured on the native runtime as a lower bound on the effect:
 * first run 0.98 ms against a 0.72 ms median.
 *
 * WD2-F5. The rewrite that fixed that kept the cold run in the sample set and
 * called `sorted[Math.floor(n / 2)]` the median, and at two samples that is the
 * **larger** of the two. Measured at tick 179 on a cold 51.2 ms followed by
 * four warm ones:
 *
 *   51.2  ->  51.2 ms, first run
 *    2.4  ->  51.2 ms, median of 2      the cold number, dressed as a median
 *    2.6  ->   2.6 ms, median of 3
 *    2.3  ->   2.6 ms, median of 4      the upper middle, not the middle
 *    2.5  ->   2.5 ms, median of 5
 *
 * So the one figure the rewrite existed to stop showing was shown again, with a
 * word in front of it that made it look measured.
 *
 * Two rules, and they are separate:
 *
 *   the cold run is reported and then **left out of the samples**, because a
 *   median that contains it is a median of two different things
 *
 *   an even number of samples takes the mean of the two middle values, which
 *   is what a median is
 */

/** The middle, or the mean of the two middles. */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2
}

export interface Latency {
  /** Record a run and say what the page should print for it. */
  report(ms: number): string
  /** The warm samples held, oldest first. Exposed for the gate. */
  readonly samples: readonly number[]
}

/**
 * @param keep how many warm runs the median is taken over, five by default:
 *   long enough to be steady, short enough to follow a page that has just been
 *   given a much longer sentence.
 */
export function makeLatency(keep = 5): Latency {
  const samples: number[] = []
  let cold = true

  return {
    get samples() {
      return samples
    },
    report(ms: number): string {
      if (cold) {
        cold = false
        return `${ms.toFixed(1)} ms, first run`
      }
      samples.push(ms)
      if (samples.length > keep) samples.shift()
      if (samples.length === 1) return `${ms.toFixed(1)} ms`
      return `${median(samples).toFixed(1)} ms, median of ${samples.length}`
    },
  }
}
