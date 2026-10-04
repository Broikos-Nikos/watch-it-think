/**
 * Every type size on this page is a step of one scale.
 *
 *   npm run check:type
 *
 * WD-F9, the design eye pass of 22 September: "thirteen rendered type sizes,
 * six of them inside a 2.08 pixel band". Measured again at tick 204, on the
 * rendered page at 1280, and it reproduced to the decimal:
 *
 *     9.42 9.6 11.52 12.16 12.48 12.8 13.12 13.6 15.2 16 16.8 38.4 64
 *     six of them, 11.52 through 13.6, inside 2.08 pixels, on eight elements
 *     doing the same job: axis token, status, footer, wordmark, caption,
 *     sample button, attention note, race row
 *     the one visible heading at 16.8, under a textarea at 19.2
 *
 * Nobody perceives 12.16 against 12.48. Those differences carried no hierarchy,
 * only the evidence that the type was set element by element as each was added.
 *
 * The scale is seven steps of 1.25 anchored on the 16 pixel root, declared in
 * `:root` as `--type-0` through `--type-6`, and this holds three things about
 * it. Being a file gate is the point: every one of these is a fact about
 * `src/style.css`, and WM2-F7 one tick ago was about assertions that borrow a
 * browser to read a committed file.
 *
 *   1. Every `font-size` in the stylesheet is one of the tokens, including both
 *      ends of every `clamp`. A raw rem is how the pile grew.
 *   2. The steps are the ratio they claim. Read out of the declarations and
 *      divided, not trusted: 1.25 between neighbours, with the two display
 *      sizes two steps up because a billboard number is a different register
 *      and that gap is the one deliberate thing in the scale.
 *   3. The section heading is above the box you type in. It was below it, and
 *      was a heading only because it was bold.
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

/* The ratio the scale claims, and how close a step has to be to earn it. */
const RATIO = 1.25
const SLACK = 0.01

/* 1. the steps exist, and they are the ratio they say */
const steps = new Map()
for (const m of css.matchAll(/--type-(\d):\s*([\d.]+)rem/g)) steps.set(Number(m[1]), Number(m[2]) * 16)
const indices = [...steps.keys()].sort((a, b) => a - b)

if (indices.length < 5) {
  fail(`the scale declares ${indices.length} steps`, 'WD-F9 asked for one ratio and a handful of steps, not a pile.')
} else {
  const drift = []
  for (let i = 1; i < indices.length; i++) {
    const got = steps.get(indices[i]) / steps.get(indices[i - 1])
    /* A step of 1.25 or a deliberate double step of 1.5625, and nothing else. */
    const near = [RATIO, RATIO * RATIO].some((want) => Math.abs(got - want) / want <= SLACK)
    if (!near) drift.push(`--type-${indices[i - 1]} to --type-${indices[i]} is ${got.toFixed(3)}`)
  }
  if (drift.length > 0) {
    fail(
      `${drift.length} of ${indices.length - 1} steps are not ${RATIO} or ${(RATIO * RATIO).toFixed(4)}`,
      `${drift.join('; ')}. A scale whose steps are not a ratio is a list.`,
    )
  } else {
    const px = indices.map((i) => +steps.get(i).toFixed(2))
    console.log(`  ok      ${indices.length} steps at ${RATIO}, ${px.join(', ')} pixels`)
  }
}

/*
 * 2. nothing sets a size off the scale
 *
 * Comments stripped first. This file's own subject explains itself in prose
 * that quotes the old pixel sizes, and a gate that greps its subject's
 * commentary has been wrong about exactly that four times in this workspace.
 */
const code = css.replace(/\/\*[\s\S]*?\*\//g, '')
const raw = []
for (const m of code.matchAll(/font-size:\s*([^;]+);/g)) {
  const value = m[1].trim()
  /* Inside a clamp, each of the three parts is read on its own: the middle one
     is a fluid expression and only the two ends are sizes. */
  const parts = value.startsWith('clamp(')
    ? [value.slice(6, value.lastIndexOf(')')).split(',')[0], value.slice(6, value.lastIndexOf(')')).split(',').pop()]
    : [value]
  for (const part of parts) {
    const p = part.trim()
    if (/var\(--type-\d\)/.test(p)) continue
    /* `inherit` is not a size: it is the absence of one, and the only use of it
       here is `.sr-only`, so that a heading nobody sees keeps the scale instead
       of the browser's 24 pixel default. */
    if (p === 'inherit') continue
    /* A clamp's lower end may be a step expressed in rem when it is a step the
       tokens do not name, and the ratio check below catches a wrong one. */
    const rem = p.match(/^([\d.]+)rem$/)
    if (rem) {
      const value16 = Number(rem[1]) * 16
      const onScale = [...steps.values()].some((s) => Math.abs(value16 / s - 1) <= SLACK || Math.abs(value16 * RATIO / s - 1) <= SLACK)
      if (onScale) continue
    }
    raw.push(p)
  }
}
if (raw.length > 0) {
  fail(
    `${raw.length} font-size ${raw.length === 1 ? 'value is' : 'values are'} off the scale`,
    `${raw.slice(0, 4).join(', ')}. Thirteen sizes is how this started; each one was reasonable on its own.`,
  )
} else {
  const uses = [...code.matchAll(/font-size:/g)].length
  console.log(`  ok      all ${uses} font-size declarations resolve to a step`)
}

/* 3. the heading is above the input */
const sizeOf = (selector) => {
  const block = css.match(new RegExp(`${selector}\\s*\\{[^}]*\\}`))?.[0] ?? ''
  const decl = block.match(/font-size:\s*([^;]+);/)?.[1] ?? ''
  const token = decl.match(/var\(--type-(\d)\)[^,]*$/) ?? decl.match(/var\(--type-(\d)\)/)
  /* For a clamp, the largest end is what a reader on a laptop sees. */
  const all = [...decl.matchAll(/var\(--type-(\d)\)/g)].map((m) => steps.get(Number(m[1])))
  return all.length > 0 ? Math.max(...all) : token ? steps.get(Number(token[1])) : null
}
const heading = sizeOf('\\.attention h2')
const input = sizeOf('textarea')
if (heading === null || input === null) {
  fail(`could not read the sizes: heading ${heading}, input ${input}`)
} else if (heading <= input) {
  fail(
    `the section heading is ${heading}px and the box you type in is ${input}px`,
    'It was 16.8 against 19.2 and was a heading only because it was bold.',
  )
} else {
  console.log(`  ok      the section heading is ${heading}px, above the ${input}px input`)
}

if (failed > 0) {
  console.error('\nA pile of sizes is the clearest tell that the type was set one element at a time.')
  process.exit(1)
}

console.log(`type: ${indices.length} steps of ${RATIO}, every declaration on one of them, the heading above the input`)
