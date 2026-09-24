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
  /*
   * Bound to its own phrase, not to anything within 120 characters of it.
   *
   * "Near, in either order" was written so the workflow could say "`npm run
   * build` runs twelve of them" and the publish doc "twelve in `npm run
   * build`". It bought that and gave the assertion away: with both counts at
   * twelve, the verify number satisfied the build check and the build number
   * satisfied the verify one. Measured in a scratch clone by the audit,
   * `docs/PUBLISH.md` mutated to "eleven in `npm run build`" **passed**.
   *
   * Each number is read from the position it occupies now: directly before the
   * phrase, or directly after it in "`npm run build` runs twelve of them".
   */
  const flat = text.replace(/\s+/g, ' ')

  /*
   * Every number standing next to the phrase, not just one of them.
   *
   * Asking whether a correct sentence exists is not the same as asking whether
   * an incorrect one does, and the difference is a file that says both. The
   * README did: the opening paragraph said twelve and the command block below it
   * said nine, and a gate looking for the right number found it and stopped.
   * Restoring "nine file gates" passed.
   *
   * So this collects what the file claims and requires all of it to be right.
   */
  /*
   * Within thirty characters either side, whatever the phrasing.
   *
   * The three real shapes in these files are "twelve in `npm run build`",
   * "`npm run build` runs twelve of them" and "npm run build  # typecheck,
   * twelve file gates". A pattern written for the first two missed the third,
   * which is the one that was wrong, so the control restoring "nine file gates"
   * passed twice before this line was widened. Shapes are not the thing; being
   * next to the phrase is.
   */
  const NUMBER = '(' + WORDS.join('|') + ')'
  const claims = (phrase) => {
    const found = []
    for (const re of [
      // "twelve in `npm run build`"
      new RegExp(`\\b${NUMBER}\\b[^.]{0,30}${phrase}`, 'gi'),
      // "`npm run build` runs twelve of them"
      new RegExp(`${phrase}[^.]{0,20}runs [^.]{0,12}\\b${NUMBER}\\b`, 'gi'),
      // "npm run build  # typecheck, twelve file gates"
      new RegExp(`${phrase}[^.]{0,30}\\b${NUMBER}\\b[^.]{0,12}gates?\\b`, 'gi'),
    ]) {
      for (const m of flat.matchAll(re)) found.push(m[1].toLowerCase())
    }
    return found
  }

  const states = (n, phrase) => {
    const found = claims(phrase)
    if (found.length === 0) return false
    return found.every((f) => f === word(n))
  }

  /*
   * Every file is held to every count, and the README was not.
   *
   * It was exempted on the premise that it "does not quote the total or the
   * build count". It quoted the build count twice and both were wrong: "Eight
   * gates run on every build" above a table of eight, three of which run only in
   * verify, and "nine file gates" in the command block. The exemption then
   * printed `ok README.md says twenty four, twelve in build and twelve in
   * verify`, which was a sentence about the README that was not true of it.
   */
  if (!new RegExp(`\\b${word(all)}\\b`, 'i').test(flat)) missing.push(`${word(all)}, the total`)
  if (!states(buildGates, 'npm run build')) missing.push(`${word(buildGates)} against npm run build`)
  if (!states(browserGates, 'npm run verify')) missing.push(`${word(browserGates)} against npm run verify`)

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
