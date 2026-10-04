/**
 * Every browser gate, against one server.
 *
 *   npm run verify
 *
 * Ten gates each started their own `vite preview`, waited for it, and stopped
 * it. The maintainer audit timed the result: 87 seconds for `npm run build`, of
 * which 74.6 were those ten spawns, and `check:layout` and `check:boot` alone
 * were 40 percent of the run.
 *
 * Its conclusion is the reason this file exists, and it is not about seconds:
 * past the point where a check is free you run it because you remember to
 * rather than because it costs nothing, and a gate suite people skip is worse
 * than no gate suite, because it is also believed.
 *
 * So the browser pass is one server, started once, handed to each gate through
 * WIT_URL, and `npm run build` no longer contains any of it. The split is the
 * one the sibling project `tokenlab` has had since the day it was published,
 * which is the mildly embarrassing part: the answer was already written down.
 */

import { spawn } from 'node:child_process'
import { browserReady } from './preflight.mjs'
import { serve } from './serve.mjs'

const GATES = [
  'check:layout',
  'check:boot',
  'check:progress',
  'check:degraded',
  'check:draw',
  'check:race',
  'check:announce',
  'check:keyboard',
  'check:motion',
  'check:attention',
  'check:weight',
  'check:network',
  'check:capture',
  'check:first-screen',
  'check:cap',
  'check:queued',
  'check:raw',
  'check:unknown',
  'check:axis',
  'check:axes',
  'check:forced',
  'check:pin',
]

/*
 * A hole is not an empty slot, it is a gate that always passes.
 *
 * `['a', , 'b']` has length 3 and a hole in the middle, and this runner spawns
 * `npm run undefined` for it, which npm answers by listing the scripts and
 * exiting 0. Tick 160 added `check:cap` after a line that already ended in a
 * comma and left one behind: from then until tick 164 this file ran fourteen
 * gates, printed "14 browser gates", and one of the fourteen was a no-op that
 * could never fail. `check:counts` was right the whole time, because it counts
 * the quoted names rather than the array, which is how the two numbers came
 * apart without either being obviously wrong.
 */
for (const [i, gate] of GATES.entries()) {
  if (typeof gate !== 'string') {
    console.error(`FAIL  GATES[${i}] is ${gate}, so this suite would spawn \`npm run undefined\` and count it as a pass`)
    process.exit(1)
  }
}

/* Before the server, because a server nobody can drive is not worth starting. */
await browserReady()

const started = Date.now()
const server = await serve()
console.log(`preview on ${server.url}, shared by ${GATES.length} gates\n`)

let failed = 0

try {
  for (const gate of GATES) {
    const t0 = Date.now()
    const code = await new Promise((done) => {
      const child = spawn('npm', ['run', gate], {
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, WIT_URL: server.url },
      })
      child.on('exit', (c) => done(c ?? 1))
    })
    const secs = ((Date.now() - t0) / 1000).toFixed(1)
    if (code !== 0) {
      failed++
      console.error(`\n^ ${gate} failed after ${secs}s\n`)
    } else {
      console.log(`  (${gate}, ${secs}s)\n`)
    }
  }
} finally {
  server.stop()
}

/*
 * And one that is not a browser gate and cannot share the server.
 *
 * `check:stop` starts a preview of its own and requires it to be gone after
 * `stop()`. It runs last, after the shared server above has been stopped, so
 * that the two are never confused for one another, and it is counted
 * separately because the line below says "browser gates" and it is not one.
 * A count that says more than is true is what WD2-F8 was about.
 */
const stopCode = await new Promise((done) => {
  const child = spawn('npm', ['run', 'check:stop'], { stdio: 'inherit', shell: true })
  child.on('exit', (c) => done(c ?? 1))
})
if (stopCode !== 0) failed++

const total = ((Date.now() - started) / 1000).toFixed(1)

if (failed > 0) {
  console.error(`${failed} of ${GATES.length + 1} gates failed, in ${total}s.`)
  process.exit(1)
}

console.log(`${GATES.length} browser gates and check:stop, one shared server, ${total}s.`)
