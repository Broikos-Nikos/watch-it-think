/**
 * The repository carries every licence its README claims.
 *
 *   npm run check:licence
 *
 * Measured across this workspace on 2026-09-25, the morning after `chunkline`
 * was published:
 *
 *   tokenlab         states MIT   LICENSE present   corpus CC0 named in data/pairs.json
 *   watch-it-think   states MIT   LICENSE present
 *   chunkline        states MIT   LICENSE present   corpus CC BY-SA attributed per article
 *   agentscope       states MIT   no LICENSE
 *   evalkit          states MIT   no LICENSE
 *   gatewaylab       states MIT   no LICENSE
 *
 * Three repositories saying MIT in prose with nothing behind it. It is the
 * ninety second check a reviewer runs on a public repository, and the sentence
 * at the bottom of a README is a claim like any other.
 *
 * The first version of that sweep was wrong in the other direction, and the
 * correction is worth keeping: `grep '\bMIT\b'` reported `tokenlab` and
 * `watch-it-think` as claiming MIT on matches inside "committed", "limits" and
 * "emits". They do claim it, and they do carry it, but the measurement that said
 * so was reading the wrong lines. Re-run in a language whose word boundaries
 * work before believing a sweep of six repositories.
 *
 * This gate reads the claim out of the README rather than hardcoding one, so
 * rewriting the claim moves the gate with it. It checks two things:
 *
 * 1. **A code licence named in prose exists as a file**, says the same licence,
 *    names a holder, and does not still contain its template placeholders.
 *    `tokenlab` shipped a font licence with `[yyyy] [name of copyright owner]`
 *    intact and a reviewer found it in ninety seconds.
 * 2. **A data licence named in prose is named in the data.** CC0, CC BY and
 *    CC BY-SA are claims about files, and a claim about a file that the file
 *    does not carry is worse than no claim, because it looks like diligence.
 *
 * It deliberately does not check font licences. `tokenlab` has `check:licences`
 * for those, which reads each licence out of the font binary rather than out of
 * prose, and duplicating it here would be a second opinion about the same fact.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const readme = readFileSync(resolve(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n')
const flat = readme.replace(/\s+/g, ' ')

/** Code licences, matched on word boundaries so "committed" is not a claim. */
const CODE = [
  ['MIT', /\bMIT\b/, /MIT License/i],
  ['Apache-2.0', /\bApache[- ]2\.0\b/, /Apache License/i],
  ['BSD', /\bBSD[- ]3[- ]Clause\b/, /BSD 3-Clause/i],
]

/** Data licences, which are claims about committed files rather than about code. */
const DATA = [
  ['CC0', /\bCC0\b/i],
  ['CC BY-SA', /\bCC BY-SA\b/i],
  ['CC BY', /\bCC BY\b(?!-SA)/i],
]

const claimedCode = CODE.filter(([, inReadme]) => inReadme.test(flat))
const claimedData = DATA.filter(([, inReadme]) => inReadme.test(flat))

if (claimedCode.length === 0 && claimedData.length === 0) {
  fail('the README names no licence at all', 'A public repository with no licence is not open source, it is visible source.')
}

for (const [name, , inFile] of claimedCode) {
  const licPath = resolve(root, 'LICENSE')
  if (!existsSync(licPath)) {
    fail(`the README says ${name} and there is no LICENSE file`, 'The claim is the easy half.')
    continue
  }
  const lic = readFileSync(licPath, 'utf8')
  if (!inFile.test(lic)) {
    fail(`LICENSE does not say ${name} and the README does`, `LICENSE opens with ${JSON.stringify(lic.split('\n')[0])}`)
  } else if (/\[yyyy\]|\[name of copyright owner\]|\[fullname\]/i.test(lic)) {
    fail('LICENSE still has its template placeholders in it', 'tokenlab shipped exactly this and a reviewer found it in ninety seconds.')
  } else {
    const holder = lic.match(/Copyright \(c\) (\d{4}) (.+)/)
    if (!holder) {
      fail('LICENSE names no copyright holder', `${name} without a holder grants nothing to anybody.`)
    } else {
      console.log(`  ok      the README says ${name} and LICENSE says ${name}, ${holder[1]} ${holder[2].trim()}`)
    }
  }
}

/*
 * A data licence has to appear in the data. Everything committed under `data/`
 * and `src/generated/` is searched, because which file carries the provenance is
 * a per project decision and hardcoding it here would be a third place to keep
 * in step.
 */
if (claimedData.length > 0) {
  const files = []
  for (const dir of ['data', 'src/generated']) {
    const d = resolve(root, dir)
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) if (f.endsWith('.json') || f.endsWith('.md')) files.push(join(dir, f))
  }
  if (files.length === 0) {
    fail(
      `the README claims ${claimedData.map(([n]) => n).join(' and ')} and nothing is committed under data/ or src/generated/`,
      'A data licence is a claim about files. With no files it is a claim about nothing.',
    )
  } else {
    const haystack = files.map((f) => readFileSync(resolve(root, f), 'utf8')).join('\n')
    for (const [name, pattern] of claimedData) {
      if (!pattern.test(haystack)) {
        fail(
          `the README claims ${name} and no committed data file names it`,
          `searched ${files.join(', ')}. A licence claimed in prose and absent from the file it covers is worse than no claim.`,
        )
      } else {
        console.log(`  ok      ${name} is named in the committed data as well as in the README`)
      }
    }
  }
}

if (failed > 0) {
  console.error('\nA licence claimed in prose and absent from the tree is the ninety second check a reviewer runs.')
  process.exit(1)
}

console.log('licence: every licence this README claims is one the repository carries')
