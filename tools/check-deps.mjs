/**
 * What this repository asks somebody to install, with a ceiling on it.
 *
 *   npm run check:deps
 *
 * WDEP-F1, carried from tokenlab SC-F5 the same day it was written there.
 * Measured at tick 155, against the lockfile as it was committed:
 *
 *   78 packages installed, against 18 to 23 in every other project here
 *   40 of those 78 were wait-on and its closure
 *   what it was doing: one await in tools/capture.mjs, waiting for a local
 *     server before filming
 *
 * Each one is an account that can publish a new version into this build, and
 * two of them, `lodash` and `minimist`, have prior art in exactly that failure
 * mode. After: 38.
 *
 * ## Two rules
 *
 * 1. **A ratchet.** The count of packages npm actually installs on one machine
 *    may only fall, and `deps-cap.json` carries the number and why. A tree grows
 *    one convenience at a time and nothing ever says so: the ceiling is what
 *    makes the next one a decision. Lowering it is a line in a commit message;
 *    raising it is a line in `DECISIONS.md`.
 *
 * 2. **Everything declared is used.** Every name in `dependencies` and
 *    `devDependencies` is referenced somewhere that is not the manifest or the
 *    lockfile: imported, invoked in a script, or named in the workflow. A
 *    dependency whose last use was deleted is the cheapest 40 packages anybody
 *    ever installed.
 *
 * The per package tails are printed whether it passes or fails, because the
 * number on its own says nothing about what to do with it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
const cap = JSON.parse(readFileSync(resolve(root, 'deps-cap.json'), 'utf8'))

const entries = Object.entries(lock.packages ?? {}).filter(([k]) => k.startsWith('node_modules/'))
/*
 * Platform optional entries are excluded because they are the same package for
 * eight architectures and only one of them ever lands on a machine: counting
 * them would make the number about the lockfile rather than about what anybody
 * installs.
 */
const installed = entries.filter(([, v]) => !v.optional)

/** Everything a top level package pulls in, through the lockfile's own graph. */
function closure(name) {
  const seen = new Set()
  const stack = [name]
  while (stack.length > 0) {
    const n = stack.pop()
    if (seen.has(n)) continue
    seen.add(n)
    const deps = (lock.packages[`node_modules/${n}`] ?? {}).dependencies ?? {}
    for (const d of Object.keys(deps)) if (!seen.has(d)) stack.push(d)
  }
  return seen
}

const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) }
const tails = Object.keys(declared)
  .map((name) => ({ name, tail: closure(name).size - 1 }))
  .sort((a, b) => b.tail - a.tail)

console.log(`  ${installed.length} packages installed, ${entries.length - installed.length} more that are platform optional`)
for (const { name, tail } of tails) {
  console.log(`  ${String(tail).padStart(3)} ${tail === 1 ? 'package ' : 'packages'} under ${name}`)
}

if (installed.length > cap.cap) {
  fail(
    `${installed.length} packages install, and the ceiling is ${cap.cap}`,
    'Either the new one earns its place in DECISIONS.md and the ceiling moves, or it goes. The tails above say which one arrived.',
  )
} else if (installed.length < cap.cap) {
  fail(
    `${installed.length} packages install and the ceiling is still ${cap.cap}`,
    `Lower it to ${installed.length} in deps-cap.json. A ratchet that is not tightened is a ceiling nobody is under.`,
  )
}

/*
 * And the second rule. The manifest and the lockfile are excluded, and so is
 * node_modules: a package is used when something in this repository names it.
 */
const SKIP = new Set(['node_modules', 'dist', '.git', '.capture'])
const TEXT = /\.(mjs|cjs|js|ts|tsx|json|yml|yaml|md|html)$/
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (TEXT.test(entry) && !/^package(-lock)?\.json$/.test(entry)) out.push(full)
  }
  return out
}

const files = walk(root)
const haystack = files.map((f) => readFileSync(f, 'utf8')).join('\n') + '\n' + JSON.stringify(pkg.scripts ?? {})
/**
 * A types package is used by the type checker rather than by a name anybody
 * writes, so it is asked for differently: `@types/x` is used when `x` is, and
 * `@types/node` when anything imports a `node:` builtin. The gate found this on
 * its first run by failing on `@types/node`, which nothing in this repository
 * names and every tool in it depends on.
 */
const usesNodeBuiltins = haystack.includes("from 'node:")
const used = (name) => {
  if (haystack.includes(name)) return true
  if (!name.startsWith('@types/')) return false
  const of = name.slice('@types/'.length)
  if (of === 'node') return usesNodeBuiltins
  return haystack.includes(of)
}

for (const name of Object.keys(declared)) {
  if (used(name)) continue
  fail(
    `${name} is declared and nothing in the repository names it`,
    'A dependency whose last use was deleted stays in the lockfile, in the install, and in the list of accounts that can publish into this build.',
  )
}

if (failed > 0) {
  console.error('\nThe reader of a repository about rigour looks at the tree.')
  process.exit(1)
}

console.log(`deps: ${installed.length} packages install, at the ceiling, and every one of the ${Object.keys(declared).length} declared is used`)
