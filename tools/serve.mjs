/**
 * One preview server, on a port nobody else can be holding, proved to be ours.
 *
 * Eleven tools in this directory each started their own `vite preview` on a
 * hardcoded port, waited for it to answer, and measured whatever answered. The
 * maintainer audit found the consequence twice over: ten leaked servers on this
 * machine from earlier runs, and one gate demonstrably reporting green against
 * a page it had never started, because something was already listening on the
 * number it had picked.
 *
 * `waitOn` cannot tell those apart. It asks whether the port answers, and a
 * stale server from an hour ago answers beautifully.
 *
 * Three things fix it, and all three are here so no gate has to remember them:
 *
 * 1. **The port comes from the operating system.** Bind to 0, read the number,
 *    let it go, hand it to vite. A number nobody chose is a number nobody else
 *    is already using.
 * 2. **The server proves it is ours.** The page it serves must be byte for byte
 *    the `dist/index.html` on disk. A stale server serving an older build fails
 *    here rather than passing quietly.
 * 3. **Cleanup works off Windows.** The old blocks called `taskkill`, which does
 *    not exist on a Mac or in CI, so on every machine that is not this one the
 *    servers were simply left running.
 *
 * And one thing that is not a fix but is the point: `serve()` is called once
 * for a whole run of browser gates rather than once per gate. Ten spawns of
 * `npm run preview` cost 74 of the 87 seconds the build used to take.
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as sleep } from 'node:timers/promises'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** A port the OS says is free, right now. */
function freePort() {
  return new Promise((ok, no) => {
    const s = createServer()
    s.once('error', no)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address()
      s.close(() => ok(port))
    })
  })
}

/**
 * Prove the thing answering at `url` is this build.
 *
 * Exported because a handed-in URL needs this as much as one we started. The
 * first version of `serve()` only checked the server it spawned itself, so a
 * gate given `WIT_URL` trusted it without looking, which is the same hole in a
 * new shape: verifying only what you already believe.
 */
export async function proveItIsOurs(url) {
  const wanted = readFileSync(resolve(root, 'dist/index.html'), 'utf8')
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  const got = await res.text()
  if (got !== wanted) {
    throw new Error(
      `something is answering on ${url} but it is not this build.\n` +
        `      Served ${got.length} bytes, dist/index.html is ${wanted.length}.\n` +
        `      This is the failure that used to pass: a server nobody checked.`,
    )
  }
}

/**
 * A server somebody else started, checked before it is used.
 */
export async function useShared(url) {
  await proveItIsOurs(url)
  return { url, port: new URL(url).port, stop: () => {} }
}

/**
 * Start `vite preview`, wait for it, and prove the thing answering is the build
 * on disk.
 *
 * Returns `{ url, port, stop }`. Call `stop()` in a `finally`.
 */
export async function serve({ timeoutMs = 60_000 } = {}) {
  const port = await freePort()
  const url = `http://localhost:${port}/`

  const child = spawn('npm', ['run', 'preview', '--', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
    shell: true,
    cwd: root,
  })

  const stop = () => {
    if (!child.pid) return
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
    } else {
      // vite preview under npm is a child of a child, so the group goes.
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          // already gone
        }
      }
    }
  }
  process.on('exit', stop)

  const wanted = readFileSync(resolve(root, 'dist/index.html'), 'utf8')
  const deadline = Date.now() + timeoutMs

  for (;;) {
    if (Date.now() > deadline) {
      stop()
      throw new Error(`no server answered on ${url} within ${timeoutMs} ms`)
    }
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (res.ok) {
        const got = await res.text()
        if (got !== wanted) {
          stop()
          throw new Error(
            `something is answering on ${url} but it is not this build.\n` +
              `      Served ${got.length} bytes, dist/index.html is ${wanted.length}.\n` +
              `      This is the failure that used to pass: a stale server on a fixed port.`,
          )
        }
        return { url, port, stop }
      }
    } catch (err) {
      if (String(err.message).includes('not this build')) throw err
    }
    await sleep(120)
  }
}
