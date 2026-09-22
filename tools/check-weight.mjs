/**
 * What a first visit actually costs, over the wire, compressed.
 *
 *   npm run check:weight
 *   WIT_LIVE=https://... npm run check:weight    measures the real host instead
 *
 * The access audit reported that twelve of the 19.8 MB were "one response
 * header away from not being sent, and nothing in the repository sets it". The
 * premise is wrong for the host this ships on, and finding that out took one
 * request:
 *
 *   webassembly.github.io/wabt/demo/libwabt.wasm
 *     Content-Type: application/wasm   Content-Encoding: gzip   212,896 bytes
 *
 * GitHub Pages gzips `application/wasm`. The audit measured `vite preview`,
 * which does not compress anything, so it was measuring the development server
 * and reporting it as the visitor's experience. Two smaller wasm files on the
 * same host, 41 and 83 bytes, come back uncompressed, which is a size threshold
 * rather than a type exclusion.
 *
 * A static site cannot set response headers, so there was never a fix available
 * in this repository. What there is, is the true number, and this gate is what
 * keeps it true:
 *
 *   19.82 MB of files, 8.14 MB over the wire, 2.4x
 *   the wasm runtime alone 14.24 MB down to 3.72 MB, 3.8x
 *   the int8 graph 5.28 MB down to 4.32 MB, 1.2x, because quantised weights are
 *   nearly incompressible and that is the floor this page cannot get under
 *
 * It measures the files the page actually requests, not everything in `dist`,
 * because a budget that counts files nobody fetches is a budget that drifts
 * without anybody noticing.
 */

import { spawn } from 'node:child_process'
import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 5189
const LIVE = process.env.WIT_LIVE
const BASE = LIVE ?? `http://localhost:${PORT}/`

/** Generous against 8.14, tight enough that adding a second runtime fails. */
const BUDGET_MB = 10

let server = null
if (!LIVE) {
  server = spawn('npm', ['run', 'preview', '--', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore', shell: true,
  })
}
const stop = () => {
  if (server?.pid) spawn('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore', shell: true })
}
process.on('exit', stop)

let failed = 0

try {
  if (!LIVE) {
    const { default: waitOn } = await import('wait-on')
    await waitOn({ resources: [`http-get://localhost:${PORT}/`], timeout: 60_000 })
  }

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  const asked = new Map()
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (!asked.has(u.pathname)) asked.set(u.pathname, r.headers())
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  await page.waitForTimeout(800)
  await browser.close()

  const rows = []
  for (const [pathname, headers] of asked) {
    if (LIVE) {
      // The host is the authority when there is one: what it sent is what the
      // visitor waited for, header and all.
      const bytes = Number(headers['content-length'] ?? 0)
      if (bytes > 0) rows.push({ name: pathname, wire: bytes, how: headers['content-encoding'] ?? 'none' })
      continue
    }

    // No live host yet, so the compressed size is computed from the file the
    // host would be compressing. Stated as what it is: a prediction of the
    // transfer, not a measurement of one.
    const rel = pathname.replace(/^\//, '')
    const file = resolve(root, 'dist', rel === '' ? 'index.html' : rel)
    if (!existsSync(file)) continue
    const raw = readFileSync(file)
    if (raw.length < 2000) continue
    rows.push({ name: rel || 'index.html', wire: gzipSync(raw, { level: 6 }).length, raw: raw.length, how: 'gzip, predicted' })
  }

  rows.sort((a, b) => b.wire - a.wire)
  const total = rows.reduce((a, r) => a + r.wire, 0)

  console.log(`  ${LIVE ? 'measured on ' + LIVE : 'predicted against the files the page requested'}`)
  for (const r of rows.slice(0, 6)) {
    const raw = r.raw ? ` from ${(r.raw / 1e6).toFixed(2)}M` : ''
    console.log(`    ${(r.wire / 1e6).toFixed(2)}M${raw.padEnd(16)} ${r.name}`)
  }

  if (total / 1e6 > BUDGET_MB) {
    failed++
    console.error(`FAIL  a first visit is ${(total / 1e6).toFixed(2)} MB over the wire, over the ${BUDGET_MB} MB budget`)
  } else {
    console.log(
      `  ok      a first visit is ${(total / 1e6).toFixed(2)} MB over the wire across ${rows.length} files, under ${BUDGET_MB} MB`,
    )
  }

  // The README states this number, so the README is held to it. Without this
  // the figure is a hand typed one in a file whose own claims gate does not
  // reach it, which is the defect check:claims exists for one section over.
  const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\s+/g, ' ')
  const stated = readme.match(/A first visit is about ([\d.]+) MB over the wire/)
  if (!stated) {
    failed++
    console.error('FAIL  the README does not state what a first visit costs over the wire')
  } else {
    const claim = Number(stated[1])
    const real = total / 1e6
    if (Math.abs(claim - real) > 0.35) {
      failed++
      console.error(`FAIL  the README says ${claim} MB over the wire and this measures ${real.toFixed(2)} MB`)
    } else {
      console.log(`  ok      the README says ${claim} MB and the measurement is ${real.toFixed(2)} MB`)
    }
  }

  // The runtime is the whole download and it must be the compressible build.
  // A jsep or asyncify build would roughly double this and the page uses
  // neither, so a change that quietly swaps one in should fail here.
  const wasm = rows.find((r) => r.name.endsWith('.wasm'))
  if (!wasm) {
    failed++
    console.error('FAIL  no wasm was requested, so this gate is measuring the wrong thing')
  } else if (/jsep|asyncify|jspi/.test(wasm.name)) {
    failed++
    console.error(`FAIL  the page is loading ${wasm.name}, not the plain simd build`)
  } else {
    console.log(`  ok      the runtime is the plain threaded simd build, ${(wasm.wire / 1e6).toFixed(2)}M on the wire`)
  }
} finally {
  stop()
}

if (failed > 0) {
  console.error('\nThe download is what a visitor waits for before anything works.')
  process.exit(1)
}

console.log('weight: a first visit is inside its budget, and the runtime is the small build')
