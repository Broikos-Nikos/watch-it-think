/**
 * The gate counts written in prose, against the gates that exist.
 *
 *   npm run check:counts
 *
 * `.github/workflows/pages.yml` opened with "Nineteen gates, and all nineteen
 * run here", and `docs/PUBLISH.md` repeated it. Registering `check:progress`
 * made both sentences wrong the moment it was added, and nothing anywhere would
 * have said so. The file that enforces every other gate is a bad place to keep
 * a number no command produces, and that defect is the oldest recurring one in
 * this repository: six stale latency figures in two comments, a README phrase
 * that outlived its measurement, a picture of a headline the page had thrown
 * away.
 *
 * The counts are derived, never written: `npm run check` is the chain that runs
 * before the build, and `tools/verify.mjs` lists the browser ones. Adding a gate
 * anywhere changes this number and fails until the prose is corrected, which is
 * the whole point.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// The prose is written in words, because it is prose. Numerals in a sentence
// about how careful the project is would read as a machine wrote it.
const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen', 'twenty', 'twenty one', 'twenty two', 'twenty three', 'twenty four', 'twenty five',
]

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const verify = readFileSync(resolve(root, 'tools/verify.mjs'), 'utf8')

const buildGates = (pkg.scripts.check.match(/check:[a-z-]+/g) ?? []).length
const browserGates = (verify.match(/'check:[a-z-]+',/g) ?? []).length
const all = buildGates + browserGates

let failed = 0

if (buildGates === 0 || browserGates === 0) {
  failed++
  console.error(`FAIL  counted ${buildGates} build gates and ${browserGates} browser gates, so this is reading the wrong files`)
}

const word = (n) => WORDS[n] ?? String(n)

/*
 * The README is in this list because it was not, and it was wrong.
 *
 * It told a reader to run `npm run verify` for "ten browser gates" when there
 * were twelve, and this gate was watching the workflow and the publish document
 * and not the file most people actually read. Found by sweeping the task queue
 * rather than by anything failing, which is the wrong way to find it.
 */
const FILES = ['.github/workflows/pages.yml', 'docs/PUBLISH.md', 'README.md']
for (const file of FILES) {
  const text = readFileSync(resolve(root, file), 'utf8')
  const missing = []
  // Near, in either order. The workflow says "`npm run build` runs ten of them"
  // and the publish doc says "ten in `npm run build`". Both are correct English,
  // and a gate that accepts only one word order is a gate about phrasing, which
  // this repository has written three times and regretted three times.
  const flat = text.replace(/\s+/g, ' ')
  const near = (n, phrase) => {
    const w = word(n)
    return (
      new RegExp(`\\b${w}\\b[^.]{0,120}${phrase}`, 'i').test(flat) ||
      new RegExp(`${phrase}[^.]{0,120}\\b${w}\\b`, 'i').test(flat)
    )
  }

  // The README does not quote the total or the build count, only the browser
  // one, so it is not held to numbers it never states.
  const readmeOnly = file === 'README.md'
  if (!readmeOnly && !new RegExp(`\\b${word(all)}\\b`, 'i').test(flat)) missing.push(`${word(all)}, the total`)
  if (!readmeOnly && !near(buildGates, 'npm run build')) missing.push(`${word(buildGates)} near npm run build`)
  if (!near(browserGates, 'npm run verify')) missing.push(`${word(browserGates)} near npm run verify`)

  if (missing.length > 0) {
    failed++
    console.error(`FAIL  ${file} does not state the real gate counts`)
    console.error(`      missing: ${missing.join('; ')}`)
  } else {
    console.log(`  ok      ${file} says ${word(all)}, ${word(buildGates)} in build and ${word(browserGates)} in verify`)
  }
}

if (failed > 0) {
  console.error('\nA number in prose that no command produces is a number that drifts.')
  process.exit(1)
}

console.log(`counts: ${all} gates, and all ${FILES.length} files that say so are right`)
