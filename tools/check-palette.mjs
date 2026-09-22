/**
 * The house palette is the house palette, and the scale is not the accent.
 *
 *   npm run check:palette
 *
 * Every project published from this workspace is meant to look like it came
 * from the same hand. `../../STYLEGUIDE.md` is that hand, taken from
 * broikos.gr's live stylesheet, and this file holds this project to it.
 *
 * The design audit's finding was that the page was the house style's opposite
 * on every axis that mattered: a cool default dark with the hue turned green,
 * beside a sibling published the day before in warm near black. The one house
 * token that had arrived was spent on a focus ring.
 *
 * The second half is the part a palette check would normally miss. The heat map
 * and the brand were the same green, so the hottest cell of a 98,304 cell field
 * was louder than the answer. An accent that points at 98,304 things points at
 * nothing, and `STYLEGUIDE.md` now records that as the first of four places the
 * house style is wrong on an instrument.
 *
 * So the scale hue and the accent hue are checked for distance, not just for
 * presence, and they are checked in both files that set them: CSS for the page
 * and TypeScript for the canvas, which cannot share a value and can very easily
 * drift apart.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}
const css = readFileSync(resolve(root, 'src/style.css'), 'utf8')
const main = readFileSync(resolve(root, 'src/main.ts'), 'utf8')

/*
 * The house values, read from a file that is actually in this repository.
 *
 * This gate used to read `../../STYLEGUIDE.md`, which lives in the workspace
 * above and is not tracked anywhere, so `npm run build` died here with an
 * ENOENT in any clean clone. It was the third step of `npm run check`, on a
 * repository a day from being published, and the maintainer audit found it by
 * doing the one thing nobody had done: cloning it.
 *
 * `house-tokens.json` is generated from the guide by `npm run vendor:tokens`
 * and committed. The guide is still the source of truth, and the check below
 * re-verifies the copy against it whenever the guide happens to be present.
 */
const house = JSON.parse(readFileSync(resolve(root, 'house-tokens.json'), 'utf8')).tokens

const declared = (name) => {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`))
  return m ? m[1].trim() : null
}

// ---- the neutrals and the accent come from the house, not from taste -------
const fromGuide = (token) => house[token] ?? null

// If the workspace guide is reachable, the vendored copy is held to it. If it
// is not, which is every machine except the one this was written on, the gate
// still runs. A gate that only works where it was written is not a gate.
const guidePath = resolve(root, '../../STYLEGUIDE.md')
if (existsSync(guidePath)) {
  const guide = readFileSync(guidePath, 'utf8')
  const live = Object.fromEntries(
    [...guide.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]),
  )
  const drifted = Object.entries(house).filter(([k, v]) => live[k] && live[k] !== v)
  if (drifted.length > 0) {
    fail(
      `house-tokens.json is ${drifted.length} values behind STYLEGUIDE.md`,
      drifted.map(([k, v]) => `--${k}: vendored ${v}, guide ${live[k]}`).join(' | ') +
        '. Run npm run vendor:tokens.',
    )
  } else {
    console.log('  ok      the vendored tokens still match the workspace guide')
  }
} else {
  console.log('  note    STYLEGUIDE.md is not here, so the vendored tokens are the authority')
}

const REQUIRED = [
  ['ink', 'ink-1'],
  ['ink-deep', 'ink-0'],
  ['lift', 'ink-2'],
  ['text', 'paper'],
  ['dim', 'dim'],
  ['faint', 'faint'],
  ['flame', 'flame-1'],
  ['flame-bright', 'flame-0'],
  ['flame-deep', 'flame-2'],
]

for (const [here, there] of REQUIRED) {
  const mine = declared(here)?.toLowerCase()
  const house = fromGuide(there)
  if (!house) {
    fail(`STYLEGUIDE.md does not define --${there}, so this check cannot run`)
  } else if (mine !== house) {
    fail(`--${here} is ${mine} and the house --${there} is ${house}`)
  }
}

if (failed === 0) console.log(`  ok      ${REQUIRED.length} tokens match STYLEGUIDE.md exactly`)

// ---- the scale is not the accent -------------------------------------------
const scaleHue = Number(declared('scale-hue'))
const heatHue = Number(main.match(/const HEAT_HUE = (\d+)/)?.[1])
const FLAME_HUE = 45 // #ff6a00 is oklch(0.701 0.201 44.8)

if (!Number.isFinite(scaleHue)) {
  fail('--scale-hue is not declared in style.css')
} else if (scaleHue !== heatHue) {
  fail(
    `--scale-hue is ${scaleHue} and HEAT_HUE in main.ts is ${heatHue}`,
    'the page and the canvas would draw the same quantity in two different colours',
  )
} else {
  const d = Math.min(Math.abs(scaleHue - FLAME_HUE), 360 - Math.abs(scaleHue - FLAME_HUE))
  if (d < 90) {
    fail(
      `the scale hue ${scaleHue} is ${d} degrees from flame`,
      'a heat map in the accent colour makes the accent point at 98,304 cells, which is nowhere',
    )
  } else {
    console.log(`  ok      the scale is hue ${scaleHue}, ${d} degrees from flame, and CSS and canvas agree`)
  }
}

// ---- flame is spent on the argument, not on furniture ----------------------
//
// Named selectors rather than a count, because the question is not how much
// orange there is, it is what the orange is pointing at.
const ALLOWED = ['.intent', '.confidence', ':focus-visible', '.race li.is-leader', '::selection', '--flame', '--focus']

const flameUses = []
for (const block of css.split('}')) {
  if (!/var\(--flame|var\(--focus/.test(block)) continue
  const selector = block.split('{')[0].trim().split('\n').pop().trim()
  if (!selector || selector.startsWith('/*') || selector.startsWith(':root')) continue
  if (!ALLOWED.some((a) => selector.includes(a))) flameUses.push(selector)
}

if (flameUses.length > 0) {
  fail(
    `flame is used on ${flameUses.length} selectors it is not reserved for`,
    flameUses.join(' | '),
  )
} else {
  console.log('  ok      flame appears only on the answer, the leader and the focus ring')
}

// ---- the faces are the house faces, with their Greek -----------------------
if (!/font-family:\s*'Manrope'/.test(css)) {
  fail('Manrope is not declared, and it is the house body face')
} else if (!/manrope-var\.woff2/.test(css)) {
  fail('Manrope is named but no file is served for it, so it falls back to system-ui')
} else {
  console.log('  ok      Manrope is declared and self hosted')
}

if (failed > 0) {
  console.error(`\n${failed} palette problems. Every project here should look like the same hand.`)
  process.exit(1)
}

console.log('palette: the house tokens, a scale that is not the accent, and flame on the argument')
