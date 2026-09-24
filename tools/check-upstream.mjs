/**
 * Every percentage in the README is accounted for, one way or the other.
 *
 *   npm run check:upstream
 *
 * `check:claims` holds twenty four figures against `meta.json` and fails the
 * build when one drifts. It covers the numbers the pipeline produces. It says
 * nothing about a number the pipeline does not produce, and one of those had
 * been sitting in the README for eleven ticks: **74.98 percent**, the share of
 * gold word tags that are `O`, which is the baseline that makes 97.28 percent
 * tag accuracy readable. It is true, it is the most useful caveat on the page,
 * and nothing anywhere could check it.
 *
 * It cannot be recomputed here. The tag distribution is not in `meta.json`,
 * putting it there means re-running `tools/quantize.py`, and that needs the
 * checkpoint and the test set, which `meta.json` itself records as
 * `obtainable: false`. Deleting the number to satisfy a rule about
 * reproducibility would take the caveat off the page and leave the flattering
 * figure standing alone, which is the wrong trade.
 *
 * So it is pinned in `docs/upstream.json` with the file it was measured
 * against, that file's hash, the method, and the audit that found it. And this
 * gate closes the hole properly rather than for one number:
 *
 *   1. every number in `docs/upstream.json` appears in the README as written
 *   2. every one names a source file, a hash, and whether it can be obtained
 *   3. **every percentage in the README is either a meta.json claim or one of
 *      these**, so nothing can sit in prose unaccounted for again
 *
 * Three is the assertion that matters. One and two only keep this file honest;
 * three is what would have caught 74.98.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n')
const upstream = JSON.parse(readFileSync(resolve(root, 'docs/upstream.json'), 'utf8'))
const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

// ---- 1 and 2: the pinned numbers are present and carry their provenance ----
for (const n of upstream.numbers) {
  if (!readme.includes(n.value)) {
    fail(`docs/upstream.json pins ${n.value} and the README does not say it`, `the entry is ${n.id}`)
    continue
  }
  const src = n.measuredAgainst ?? {}
  const missing = ['path', 'sha256'].filter((k) => !src[k])
  if (missing.length > 0 || typeof src.obtainable !== 'boolean') {
    fail(`${n.id} does not name where it came from`, `missing ${[...missing, typeof src.obtainable !== 'boolean' && 'obtainable'].filter(Boolean).join(', ')}`)
  } else if (!n.method || !n.foundBy) {
    fail(`${n.id} has no method or no record of who found it`)
  } else {
    console.log(`  ok      ${n.value} is pinned to ${src.path} ${src.sha256.slice(0, 12)}, obtainable ${src.obtainable}`)
  }
}

// ---- 3: nothing else is loose -----------------------------------------------
//
// The figures check:claims already holds, rebuilt here from the same source it
// uses, so this gate cannot fall out of step with it by listing them by hand.
const q = meta.quantisation
const int8 = q.int8
const covered = new Set(
  [
    `${int8.intentAccuracy}%`,
    `${q.fp32.intentAccuracy}%`,
    `${int8.withAbstain.intentAccuracy}%`,
    `${int8.tagAccuracy}%`,
    `${q.fp32.tagAccuracy}%`,
    `${int8.exactMatch}%`,
    `${q.fp32.exactMatch}%`,
  ].filter(Boolean),
)
for (const n of upstream.numbers) covered.add(n.value)

const inReadme = [...new Set(readme.match(/\d+\.\d+%/g) ?? [])]
const loose = inReadme.filter((p) => !covered.has(p))

if (loose.length > 0) {
  fail(
    `${loose.length} percentage${loose.length === 1 ? ' in the README comes' : 's in the README come'} from nowhere: ${loose.join(', ')}`,
    'either it is a meta.json figure and check:claims should hold it, or it was measured elsewhere and belongs in docs/upstream.json with its source',
  )
} else {
  console.log(`  ok      all ${inReadme.length} percentages in the README are accounted for, ${upstream.numbers.length} of them upstream`)
}

if (failed > 0) {
  console.error('\nA number nobody can check is a number that was never checked.')
  process.exit(1)
}

console.log('upstream: every percentage in the README is produced here or pinned to where it was produced')
