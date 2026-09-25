/**
 * Wait for a URL to answer.
 *
 *   node tools/wait-for.mjs http://localhost:4173/ 60000
 *
 * WDEP-F1, the same finding as tokenlab SC-F5 and worse here. This was
 * `wait-on`, imported once, in `tools/capture.mjs`, to wait for a local server
 * before filming. Measured at tick 155:
 *
 *   78 packages installed, against 18 to 23 in every other project here
 *   40 of those 78 were wait-on and its closure
 *   what it was doing: polling `http-get://localhost:4173/` until it answered
 *
 * Forty packages, in a published repository, for one await. Each one is an
 * account that can publish a new version into this build, and two of them,
 * `lodash` and `minimist`, have prior art in exactly that failure mode.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * True when the URL answers with a 2xx before the deadline.
 *
 * `AbortSignal.timeout` per attempt rather than one timeout over the whole
 * loop: a server that accepts a connection and then hangs would otherwise eat
 * the entire budget in a single fetch.
 */
export async function reachable(url, timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (res.ok) return true
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [url, ms] = process.argv.slice(2)
  if (!url) {
    console.error('usage: node tools/wait-for.mjs <url> [timeout ms]')
    process.exit(2)
  }
  const timeout = Number(ms ?? 60_000)
  const started = Date.now()
  if (await reachable(url, timeout)) {
    console.log(`${url} answered after ${Date.now() - started} ms`)
  } else {
    console.error(`FAIL  ${url} did not answer within ${timeout} ms`)
    process.exit(1)
  }
}
