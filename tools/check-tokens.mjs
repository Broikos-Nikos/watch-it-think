/**
 * Space, corners and colour are decided once, in `:root`.
 *
 *   npm run check:tokens
 *
 * WD-F10, the design eye pass of 22 September: "ten gap values, six radii,
 * seven surface darks, and fifteen colour literals outside the token block".
 * Measured again at tick 205, and two of its four parts had grown rather than
 * gone:
 *
 *     gaps   11 distinct, 2 3 4 5 5.6 6.4 8 12.8 14.4 16 17.6 20 pixels,
 *            across 13 declarations, four of them section gaps in four
 *            different containers
 *     radii  8 distinct, 2 3 4 5 6 8 12 999, with the axis chip at 4 and the
 *            tag chip at 5 doing the same job four hundred pixels apart
 *     colour 10 oklch literals outside :root, down from fifteen
 *     surfaces: does not reproduce. Five painted surfaces on the page at
 *            luma 0, 12.6, 16.9, 39.3 and 41, which is a ramp and not a pile,
 *            and the stray warm one the audit called "the only warm surface
 *            nobody decided to make warm" is now the flame leader bar, which
 *            somebody did decide.
 *
 * ## What is held
 *
 *   1. Every `gap`, `column-gap`, `row-gap` and `border-radius` is a token.
 *      A raw pixel is how eleven of one and eight of the other happened: each
 *      was reasonable where it was typed.
 *   2. The scales are small. Five space steps, four radii, and the gate says
 *      the number rather than trusting the names, so adding `--gap-6` fails
 *      here rather than quietly making the scale six.
 *   3. No `oklch()` outside `:root` except a colour computed from a value. The
 *      one exception is `.headcell-score`, whose lightness is the
 *      concentration it prints, and that is a ramp rather than a choice.
 *
 * A file gate, like `check:type` beside it: all three are facts about
 * `src/style.css`, and WM2-F7 two ticks ago was about assertions that borrow a
 * browser to read a committed file.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const css = readFileSync(resolve(root, 'src/style.css'), 'utf8')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/* Comments stripped: this file's subject explains itself in prose that quotes
   the old values, and a gate that greps its subject's commentary has been
   wrong about exactly that five times in this workspace. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
const rootBlock = code.slice(code.indexOf(':root'), code.indexOf('\n}', code.indexOf(':root')))

/* How many steps each scale is allowed. The point is not the number, it is that
   the number is small and stated: a scale nobody can add to quietly. */
const LIMITS = { gap: 5, radius: 4 }

const declared = (prefix) => [...rootBlock.matchAll(new RegExp(`--${prefix}-[a-z0-9]+:`, 'g'))].length

for (const [name, limit] of Object.entries(LIMITS)) {
  const n = declared(name)
  if (n === 0) {
    fail(`no --${name}-* tokens are declared in :root`)
  } else if (n > limit) {
    fail(
      `the ${name} scale has ${n} steps, over ${limit}`,
      'WD-F10 was eleven gaps and eight radii, each one reasonable where it was typed.',
    )
  } else {
    console.log(`  ok      ${n} --${name}-* steps, at or under ${limit}`)
  }
}

/* 1. every spacing and corner value is one of them */
const RAW = [
  ['gap', /(?:^|[\s;{])(?:gap|column-gap|row-gap):\s*([^;]+);/g],
  ['border-radius', /(?:^|[\s;{])border-radius:\s*([^;]+);/g],
]
for (const [what, re] of RAW) {
  const raw = []
  let total = 0
  for (const m of code.matchAll(re)) {
    total++
    const value = m[1].trim()
    /* Zero is not a size, and a value made only of tokens and zeroes is fine:
       `var(--radius-1) 0 0 var(--radius-1)` is one corner rule, not four. */
    const parts = value.split(/\s+/).filter((p) => p !== '0' && p !== '0px')
    if (parts.every((p) => p.startsWith('var('))) continue
    raw.push(`${what}: ${value}`)
  }
  if (raw.length > 0) {
    fail(
      `${raw.length} of ${total} ${what} declarations are not on a scale`,
      `${raw.slice(0, 3).join('; ')}. Each of these was reasonable where it was typed, which is the whole defect.`,
    )
  } else {
    console.log(`  ok      all ${total} ${what} declarations are tokens`)
  }
}

/* 2. no colour outside the token block, except one computed from a value */
const outside = []
for (const m of code.matchAll(/oklch\([^;]*?\)/g)) {
  const at = m.index ?? 0
  if (at >= code.indexOf(':root') && at < code.indexOf('\n}', code.indexOf(':root'))) continue
  /* A lightness computed from a custom property is a ramp, not a choice: the
     thumbnail score brightens with the concentration it prints. */
  if (m[0].includes('calc(')) continue
  outside.push(m[0].slice(0, 54))
}
if (outside.length > 0) {
  fail(
    `${outside.length} colour ${outside.length === 1 ? 'literal is' : 'literals are'} written outside :root`,
    `${outside.slice(0, 3).join('; ')}. This is how the one warm surface on a cool page got there: nobody chose it, it was typed.`,
  )
} else {
  const named = [...rootBlock.matchAll(/--[a-z0-9-]+:/g)].length
  console.log(`  ok      every colour is one of the ${named} names in :root, or a ramp computed from a value`)
}

if (failed > 0) {
  console.error('\nA system is a small set of decisions applied everywhere, not a large set made where each was needed.')
  process.exit(1)
}

console.log('tokens: space, corners and colour are decided once, in :root, and used by name everywhere else')
