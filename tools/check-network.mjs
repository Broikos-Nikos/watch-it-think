/**
 * Nothing you type leaves this page, held by something rather than written down.
 *
 *   npm run check:network      (or npm run verify, which starts the server)
 *
 * WS-F2. This page makes the claim four times: the README says "It runs on your
 * machine and nothing you type leaves the page", `src/lib/router.ts` says
 * "nothing is recorded and nothing is sent anywhere", `index.html` says it to a
 * visitor with javascript off, and `src/main.ts` prints it into the standfirst
 * that every visitor reads.
 *
 * The supply chain audit verified it was true and filed the finding anyway,
 * which is the right call: the claim was held by the present contents of a 139
 * MB dependency that is bumped by hand. Measured again at tick 189 on the built
 * page:
 *
 *     11 requests, all of them on load, all of them to its own origin
 *      0 requests while a secret, six head clicks, five hovers and a sample
 *        were put through the page
 *      0 requests carrying the text from the box
 *      0 in localStorage, sessionStorage, document.cookie, service workers
 *
 * So the claim is true and now it fails closed. The policy in `index.html` is
 * the browser's half; this is the half that watches what actually went out.
 *
 * ## The three assertions, and why the third is not the second again
 *
 *   1. The documents still make the claim. A gate that guards a sentence nobody
 *      makes any more is a gate that passes forever.
 *   2. Every request went to this origin. That is the obvious one and it is the
 *      weaker one.
 *   3. Nothing carried what was typed. A page can keep every request on its own
 *      origin and still put your text in a query string, and for a page whose
 *      selling point is that your sentence never leaves the browser, that is
 *      the assertion that matters.
 *
 * And the policy itself is checked for being **in the head**, not merely in the
 * file. `WICON-F1`: the inline favicon was double quoted inside a double quoted
 * attribute, so the parser ended the head at the icon and the first policy
 * added here was refused with "delivered via a <meta> element outside the
 * document's <head>, which is disallowed. The policy has been ignored." A
 * policy the browser ignores is worse than none, because it reads like one.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/* 1. The claims this gate exists to keep true, each where it is made. */
const CLAIMS = [
  ['README.md', 'nothing you type leaves the page'],
  ['src/lib/router.ts', 'nothing is sent anywhere'],
  ['src/main.ts', 'nothing you type leaves this page'],
]
for (const [file, claim] of CLAIMS) {
  const text = readFileSync(resolve(root, file), 'utf8').replace(/\s+/g, ' ')
  if (!text.includes(claim)) {
    fail(
      `${file} no longer says ${JSON.stringify(claim)}`,
      'If the promise changed, this gate changes with it rather than quietly guarding nothing.',
    )
  }
}
if (failed === 0) console.log(`  ok      all ${CLAIMS.length} documents still make the claim this gate holds`)

const { serve, useShared } = await import('./serve.mjs')
const server = process.env.WIT_URL ? await useShared(process.env.WIT_URL) : await serve()

try {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } })
  const origin = new URL(server.url).origin
  const requests = []
  page.on('request', (r) =>
    requests.push({ url: r.url(), method: r.method(), type: r.resourceType(), body: r.postData() ?? '' }),
  )

  /*
   * And what the policy refused, which the request list cannot show.
   *
   * The first control written for this gate added a `fetch` to example.com
   * carrying the text from the box, and the gate passed: `connect-src 'self'`
   * blocked it inside the renderer, so `page.on('request')` never fired and
   * every assertion below stayed green. A page that tries to send your sentence
   * somewhere and is stopped by its own policy is still a page that tries, and
   * a gate that reports that as clean is measuring the policy rather than the
   * code.
   */
  const refused = []
  page.on('console', (m) => {
    const t = m.text()
    if (m.type() === 'error' && /Content Security Policy|Refused to connect|violates the following/i.test(t)) {
      refused.push(t.replace(/\s+/g, ' ').slice(0, 140))
    }
  })

  await page.goto(server.url)
  await page.waitForFunction(() => !!document.querySelector('.word'), null, { timeout: 180_000 })
  await page.waitForTimeout(2500)
  const onLoad = requests.length

  /* 2. The policy, in the head, where a browser will take it. */
  const policy = await page.evaluate(() => {
    const meta = document.head.querySelector('meta[http-equiv="Content-Security-Policy"]')
    return {
      inHead: Boolean(meta),
      anywhere: Boolean(document.querySelector('meta[http-equiv="Content-Security-Policy"]')),
      content: meta?.getAttribute('content') ?? '',
      bodyFirst: document.body.firstElementChild?.tagName?.toLowerCase() ?? '',
    }
  })
  if (!policy.inHead) {
    fail(
      policy.anywhere
        ? 'the Content-Security-Policy is in the document but not in the head, so the browser ignores it'
        : 'the page ships no Content-Security-Policy',
      `document.body.firstElementChild is <${policy.bodyFirst}>, which is where to look if the head ended early`,
    )
  } else if (!/connect-src 'self'/.test(policy.content)) {
    fail(`the policy does not restrict connect-src to 'self'`, policy.content.slice(0, 120))
  } else {
    console.log(`  ok      the policy is in the head and holds connect-src to this origin`)
  }

  /*
   * Then everything a visitor does. A beacon usually fires on an action rather
   * than on load, so a gate that only measures the load would miss the thing it
   * is looking for.
   */
  const secret = `ΜΥΣΤΙΚΟ-${Math.random().toString(36).slice(2, 10)}-4111111111111111`
  await page.fill('textarea', secret)
  await page.waitForTimeout(1500)
  for (let i = 0; i < 6; i++) {
    await page.locator('.headcell').nth(i).click()
    await page.waitForTimeout(120)
  }
  for (let i = 0; i < 5; i++) {
    await page.locator('.axis-token').nth(i).hover()
    await page.waitForTimeout(120)
  }
  await page.waitForTimeout(3000)

  /* 3. Everything it asked for, it asked of itself. */
  const foreign = requests.filter((r) => new URL(r.url).origin !== origin)
  if (foreign.length > 0) {
    fail(
      `${foreign.length} of ${requests.length} requests went to somebody else`,
      foreign.map((r) => `${r.method} ${r.type} ${r.url}`).join('\n      '),
    )
  } else {
    console.log(
      `  ok      ${requests.length} requests, every one to its own origin: ${onLoad} on load and ` +
        `${requests.length - onLoad} while the page was used`,
    )
  }

  /* 4. And none of them carried what was typed. */
  const carrying = requests.filter(
    (r) => r.url.includes(secret) || r.body.includes(secret) || decodeURIComponent(r.url).includes(secret),
  )
  if (carrying.length > 0) {
    fail(
      `${carrying.length} requests carried the text from the box`,
      carrying.map((r) => `${r.method} ${r.url.slice(0, 120)}`).join('\n      ') +
        '\n      Same origin or not, this page promises the sentence never goes anywhere.',
    )
  } else {
    console.log(`  ok      nothing carried the ${secret.length} characters typed into the box`)
  }

  /* 5. And it did not try and get stopped. */
  if (refused.length > 0) {
    fail(
      `${refused.length} request${refused.length === 1 ? ' was' : 's were'} refused by the page's own policy`,
      refused.slice(0, 3).join('\n      ') +
        '\n      The policy doing its job is not the same as the code not trying.',
    )
  } else {
    console.log('  ok      the policy refused nothing, because nothing asked')
  }

  /* 6. And it kept nothing either. A sentence that stays on the machine but is
     written to disk is still a sentence the visitor did not agree to keep. */
  const kept = await page.evaluate(async () => ({
    localStorage: Object.keys(localStorage).length,
    sessionStorage: Object.keys(sessionStorage).length,
    cookie: document.cookie.length,
    workers: (await navigator.serviceWorker?.getRegistrations?.())?.length ?? 0,
  }))
  const stored = Object.entries(kept).filter(([, n]) => n > 0)
  if (stored.length > 0) {
    fail(`the page kept something: ${stored.map(([k, n]) => `${k} ${n}`).join(', ')}`)
  } else {
    console.log('  ok      nothing in localStorage, sessionStorage, cookies or a service worker')
  }

  await browser.close()
} finally {
  server.stop()
}

if (failed > 0) {
  console.error('\nThe loudest sentence on a page is the one that most needs something behind it.')
  process.exit(1)
}

console.log('network: the page talks only to itself, keeps nothing, and the browser is told to enforce it')
