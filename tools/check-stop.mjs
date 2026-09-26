/**
 * The server this file starts is a server this file can stop.
 *
 *   npm run check:stop
 *
 * WD2-F9. `serve.mjs` exists because sixty five leaked `vite preview`
 * processes took this machine to the point where `spawn` began failing with
 * UNKNOWN. Its header lists three things it fixes and the third is "cleanup
 * works off Windows". That half had never run: the POSIX branch kills the
 * process group `-child.pid`, and the child was not spawned `detached`, so it
 * does not lead a group and the call throws. Measured at tick 182 with the
 * options the file used to pass:
 *
 *     process.kill(-22200, 'SIGTERM')  ->  ESRCH
 *     after the fallback child.kill('SIGTERM'): 3 of 4 still alive
 *     the preview still answers: true
 *
 * The tree is four deep, `cmd.exe` then npm then `cmd.exe` then the `node`
 * holding the port, so signalling `child.pid` reaches the shell and nothing
 * else. The old comment said "a child of a child", which is one level short of
 * what is there.
 *
 * ## Why this gate is behavioural and the workspace one is not
 *
 * `tools/check-groups.mjs` at the workspace reads all 174 tool files and
 * requires any file that kills a process group to spawn one, which is the
 * class and catches it on every machine including this one. It cannot tell
 * whether the kill then works. This can, for the platform it runs on: start a
 * server, stop it, and require the port to go quiet. Here that exercises
 * `taskkill /T`; on a Mac or in CI it exercises the group kill, which is the
 * half that was broken, so this gate is worth more there than it is here and
 * is written to run in both places.
 *
 * It starts its own server on purpose and ignores `WIT_URL`. A gate about
 * stopping a server cannot be handed one it is not allowed to stop.
 */

import { spawnSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

import { serve } from './serve.mjs'

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/** Does anything answer there, right now. */
async function answers(url) {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    return res.ok
  } catch {
    return false
  }
}

/**
 * Who is holding the port, named rather than counted, because "something is
 * still listening" sends the next reader to a task manager.
 */
function holder(port) {
  try {
    if (process.platform === 'win32') {
      const out = spawnSync('netstat', ['-ano'], { encoding: 'utf8' }).stdout ?? ''
      const line = out.split('\n').find((l) => l.includes(`:${port}`) && l.includes('LISTENING'))
      const pid = line?.trim().split(/\s+/).pop()
      if (!pid) return 'nothing is listening, and yet it answered'
      const name =
        spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH', '/FO', 'CSV'], { encoding: 'utf8' }).stdout ?? ''
      return `pid ${pid}, ${name.split(',')[0]?.replace(/"/g, '').trim() || 'unknown'}`
    }
    const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).stdout ?? ''
    return out.split('\n')[1]?.trim() || 'lsof named nothing'
  } catch {
    return 'could not be identified'
  }
}

const server = await serve()

if (!(await answers(server.url))) {
  fail(`serve() returned ${server.url} and nothing answers there`)
} else {
  console.log(`  ok      the preview answers on ${server.url} before it is stopped`)
}

server.stop()

/*
 * Five seconds, polled. `stop()` is synchronous by design, because it has to be
 * callable from an exit handler, but the operating system tearing four
 * processes down is not, and a gate that reads the port the instant `stop()`
 * returns would be measuring the kernel rather than the cleanup.
 */
let quiet = false
const deadline = Date.now() + 5_000
while (Date.now() < deadline) {
  if (!(await answers(server.url))) {
    quiet = true
    break
  }
  await sleep(150)
}

if (!quiet) {
  fail(
    `the preview still answers on ${server.url} five seconds after stop()`,
    `${holder(server.port)} is still holding it. A server that survives its own cleanup is the leak this file exists to stop.`,
  )
} else {
  console.log(`  ok      the port is quiet within five seconds of stop(), nothing left holding ${server.port}`)
}

/*
 * And twice, because `stop()` is registered on `exit`, on SIGINT and on
 * SIGTERM as well as being called in a `finally`, so on a normal run it is
 * called at least twice. The second call must be a no-op and must not throw:
 * a cleanup that throws in a `finally` replaces the error the caller was
 * measuring with its own, which is how two runs were lost on 2026-09-24.
 */
try {
  server.stop()
  console.log('  ok      calling stop() again does nothing and throws nothing')
} catch (err) {
  fail('the second stop() threw', String(err?.message ?? err))
}

if (failed > 0) {
  console.error('\nThe cleanup that has never run is the one on the machine that is not this one.')
  process.exit(1)
}

console.log('stop: the server goes away when it is told to, and says so twice')
