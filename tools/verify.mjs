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
import { serve } from './serve.mjs'

const GATES = [
  'check:layout',
  'check:boot',
  'check:draw',
  'check:announce',
  'check:keyboard',
  'check:motion',
  'check:attention',
  'check:weight',
  'check:capture',
  'check:first-screen',
]

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

const total = ((Date.now() - started) / 1000).toFixed(1)

if (failed > 0) {
  console.error(`${failed} of ${GATES.length} browser gates failed, in ${total}s.`)
  process.exit(1)
}

console.log(`${GATES.length} browser gates, one server, ${total}s.`)
