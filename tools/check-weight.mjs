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

import { gzipSync } from 'node:zlib'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE = process.env.WIT_LIVE

/** Generous against 8.14, tight enough that adding a second runtime fails. */
const BUDGET_MB = 10

let failed = 0

/*
 * The server comes from tools/serve.mjs: one preview on a port the operating
 * system hands out, proved to be serving this build. Each gate used to spawn
 * its own on a hardcoded number, which is how ten of them leaked and how one
 * was caught reporting green against a page it never started.
 *
 * WIT_URL, when set, is a server somebody else already started, which is what
 * npm run verify does for the whole browser pass.
 */
const { serve, useShared } = await import('./serve.mjs')
// With WIT_LIVE set this measures a real host, which is deliberately not this
// build, so it is the one case that skips the identity check.
const server = LIVE
  ? { url: LIVE, stop: () => {} }
  : process.env.WIT_URL
    ? await useShared(process.env.WIT_URL)
    : await serve()
const BASE = server.url

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

  const asked = new Map()
  const missing = []
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (!asked.has(u.pathname)) asked.set(u.pathname, r.headers())
    /*
     * Nothing a visit asks for should be absent.
     *
     * Written for the favicon 404 that every load used to log, and it does not
     * catch that one: measured, headless chromium never requests
     * `/favicon.ico` at all, so no gate driving it can see that response. The
     * audit saw it in a browser with a visible tab. The declaration is asserted
     * in `check:first-screen` instead, which is the cause rather than the
     * symptom, and this stays because it catches every other missing thing.
     */
    if (r.status() === 404) missing.push(u.pathname)
  })

  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  await page.waitForTimeout(800)

  // Read before the browser closes. The first version of this asked a closed
  // page and died in the gate rather than in the thing the gate watches.
  const pageSays = await page.evaluate(() => {
    const text = document.querySelector('[data-footer]')?.textContent ?? ''
    const m = text.match(/([\d.]+) MB over the wire/)
    // The same quantity the footer sums, recomputed here. This half only checks
    // that the page's arithmetic is internally consistent; the half below checks
    // it against the network stack, which is the independent one, and it exists
    // because this one was the only check for a day and could not disagree.
    const received =
      performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) +
      (performance.getEntriesByType('navigation')[0]?.transferSize ?? 0)
    return { printed: m ? Number(m[1]) : null, received: received / 1e6 }
  })

  /*
   * ---- and the second visit, against the network stack rather than the page --
   *
   * The assertion above compares the footer with `encodedBodySize` summed on the
   * same page, which is the page's own formula recomputed. It cannot disagree
   * with the footer, and it never meets a warm cache, so it was green while the
   * page told every returning visitor that 8.24 MB had arrived when nothing had.
   * The audit caught it by reloading, which this gate never did.
   *
   * So the second visit is measured from **outside the page**: CDP's
   * `Network.loadingFinished` carries `encodedDataLength`, which is what the
   * network stack actually received, and a cache hit contributes nothing to it.
   * Two independent numbers rather than one number twice.
   */
  const warm = await (async () => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const p1 = await ctx.newPage()
    const cdp = await ctx.newCDPSession(p1)
    await cdp.send('Network.enable')

    let received = 0
    cdp.on('Network.loadingFinished', (e) => { received += e.encodedDataLength ?? 0 })

    const load = async (page) => {
      await page.goto(BASE, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
      await page.waitForTimeout(600)
      return page.evaluate(() => (document.querySelector('[data-footer]')?.textContent ?? '').trim())
    }

    await load(p1)
    received = 0
    const second = await load(p1)
    const measured = received
    await ctx.close()
    return { footer: second, received: measured }
  })()

  const printedWarm = Number(warm.footer.match(/([\d.]+) MB over the wire/)?.[1] ?? 0)
  const receivedMb = warm.received / 1e6
  if (Math.abs(printedWarm - receivedMb) > 0.35) {
    failed++
    console.error(
      `FAIL  on a second visit the footer says ${printedWarm} MB over the wire and the network stack received ${receivedMb.toFixed(2)} MB`,
    )
    console.error('      encodedBodySize counts a cache hit; transferSize does not, and a visitor paid for neither')
  } else {
    console.log(
      `  ok      a second visit: ${JSON.stringify(warm.footer.slice(0, 52))}, network stack received ${receivedMb.toFixed(2)} MB`,
    )
  }

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

  /*
   * The page's own sentence, against what the page's own browser received.
   *
   * The footer says "N MB over the wire" and for twenty eight ticks N was
   * meta.json's record of the int8 graph on disk. Nothing caught it, including
   * this gate, which was busy holding the README to a measurement while the
   * identical claim one file over went unchecked. The live host settled it:
   * 4.33 MB for that file, 8.23 MB for the visit, and the page saying 5.28.
   *
   * The assertion is not against this gate's own total, which would be wrong
   * twice over: under `vite preview` nothing is compressed, so the browser
   * really does receive 19.8 MB and the page should say so. It is against what
   * the browser recorded in the same load. "Print what you downloaded" is true
   * on every host, needs no tolerance, and cannot drift.
   */
  if (pageSays.printed === null) {
    failed++
    console.error('FAIL  the page does not say what the visit cost over the wire')
  } else if (Math.abs(pageSays.printed - pageSays.received) > 0.05) {
    failed++
    console.error(
      `FAIL  the page says ${pageSays.printed} MB over the wire and its own browser received ` +
        `${pageSays.received.toFixed(2)} MB`,
    )
    console.error('      a size on disk is not a size on the wire, and this host may compress')
  } else {
    console.log(`  ok      the page says ${pageSays.printed} MB over the wire and that is what it received`)
  }

  if (missing.length > 0) {
    failed++
    console.error(`FAIL  a first visit asks for ${missing.length} thing${missing.length === 1 ? '' : 's'} that is not there: ${[...new Set(missing)].join(', ')}`)
    console.error('      every one of those is a 404 in the console of a reader who came to check')
  } else {
    console.log(`  ok      nothing a first visit asks for is missing, across ${asked.size} requests`)
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
  server.stop()
}

if (failed > 0) {
  console.error('\nThe download is what a visitor waits for before anything works.')
  process.exit(1)
}

console.log('weight: a first visit is inside its budget, and the runtime is the small build')
