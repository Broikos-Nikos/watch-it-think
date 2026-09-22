/**
 * Nothing runs code at install time without somebody having looked at it.
 *
 *   npm run check:install
 *
 * `package.json` carried this:
 *
 *   "allowScripts": { "esbuild@0.25.12": true, "protobufjs": false }
 *
 * which is the configuration block for `@lavamoat/allow-scripts`, and that
 * package is not a dependency of this project. Not in `node_modules`, zero
 * occurrences in the lockfile, invoked by no script. So `protobufjs` ran its
 * install script exactly as it always had, under a line that said it was being
 * stopped.
 *
 * A control that does nothing is worse than no control, because it answers the
 * question nobody then asks again. The supply chain audit found it and it was
 * the only high finding in that pass.
 *
 * Two ways to make it real were on the table and both change how `npm install`
 * behaves, by way of an `.npmrc` with `ignore-scripts=true`. Two days before
 * this repository is published, and with "five minutes from clone" being the
 * thing the last audit failed it on, breaking a stranger's `npm install` is the
 * worst outcome available. So this takes the property that block was pretending
 * to give, which is knowing when a package starts running code at install time,
 * and leaves installation alone.
 *
 * Every entry below was looked at. That is the whole point: the list is not a
 * filter, it is a record that somebody read them.
 *
 * ---
 *
 * A correction, 2026-09-22, and it runs the other way to most of them.
 *
 * The supply chain audit reported `allowScripts` in package.json as dead
 * configuration for `@lavamoat/allow-scripts`, a package not installed here,
 * and called it a security control that does nothing. I agreed, deleted the
 * block, and wrote the first version of this file to catch the class.
 *
 * Both of us were wrong. npm 11 reads `allowScripts` itself. Verified on npm
 * 11.16.0 rather than argued: with the block removed, `npm ci` prints
 *
 *   npm warn allow-scripts 2 packages have install scripts not yet covered
 *     protobufjs@7.6.6 (postinstall: node scripts/postinstall)
 *     esbuild@0.25.12 (postinstall: node install.js)
 *
 * and with it restored it prints nothing and esbuild's binary is still linked.
 * So the block was a working control, `"protobufjs": false` was genuinely
 * stopping that script, and deleting it removed protection rather than theatre.
 *
 * The maintainer audit found the consequence from the other end: this gate
 * would have failed the build on whatever `npm approve-scripts` wrote.
 *
 * What survives is the part that was always this file's own idea, the reviewed
 * list, plus a new job: npm warns about uncovered install scripts and a warning
 * is a thing people scroll past, so here it is a failure.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))

/**
 * Packages allowed to run code at install time, each with why it needs to and
 * what its script actually does. Read, not assumed: the protobufjs entry is
 * what it is because the file was opened.
 */
const REVIEWED = {
  'node_modules/tsx/node_modules/esbuild':
    'downloads and links the platform binary. tsx cannot run without it, and tsx runs three of the gates.',
  'node_modules/protobufjs':
    'scripts/postinstall.js warns about a version scheme when pkg.versionScheme is set. It is not set, so the script returns on its fourth line and does nothing.',
  'node_modules/fsevents':
    'macOS file watching, optional, and never installed on Windows, which is why npm does not warn about it here. Its install script builds the native binding; blocking it on a Mac would quietly drop vite back to polling, so it is allowed rather than refused.',
  'node_modules/playwright/node_modules/fsevents':
    'the same package again, under playwright.',
}

let failed = 0

// ---- every install script is one somebody has read ------------------------
const found = Object.entries(lock.packages ?? {})
  .filter(([, v]) => v.hasInstallScript)
  .map(([k]) => k)

for (const path of found) {
  if (!(path in REVIEWED)) {
    failed++
    console.error(`FAIL  ${path} runs code at install time and nobody has written down why`)
    console.error('      Read its install script, then add it to REVIEWED with what it does.')
  }
}

// A name in the list that is no longer in the tree is a note about a package
// that left, and it makes the list a worse record every time it happens.
for (const path of Object.keys(REVIEWED)) {
  if (!found.includes(path)) {
    failed++
    console.error(`FAIL  ${path} is in the reviewed list and is not in the lockfile any more`)
  }
}

if (failed === 0) {
  console.log(`  ok      ${found.length} packages run install scripts, each one reviewed and written down`)
}

// ---- every install script is covered by npm's own allow list --------------
//
// npm prints a warning for these and nobody reads warnings. A package that
// starts running code at install time should stop the build, not colour some
// text yellow.
const allow = pkg.allowScripts ?? {}
const uncovered = found.filter((path) => {
  const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length)
  const version = lock.packages[path]?.version
  // npm keys these as name@version, and accepts a bare name too.
  return !(`${name}@${version}` in allow) && !(name in allow)
})

if (uncovered.length > 0) {
  failed++
  console.error(`FAIL  ${uncovered.length} packages run install scripts that allowScripts does not cover`)
  for (const u of uncovered) {
    const name = u.slice(u.lastIndexOf('node_modules/') + 'node_modules/'.length)
    console.error(`      ${name}@${lock.packages[u]?.version}`)
  }
  console.error('      npm approve-scripts writes these. Decide true or false for each.')
} else {
  console.log(`  ok      all ${found.length} install scripts are covered by allowScripts, npm's own list`)
}

// ---- no configuration block that nothing reads ----------------------------
//
// The general shape of the defect, not just the one instance of it: a key in
// package.json that configures a tool which is not installed reads as a policy
// and is a decoration.
const OWNERS = {
  // `allowScripts` is deliberately NOT here. It was, and it was wrong: npm 11
  // reads that key natively, so the gate failed the build on the exact block
  // `npm approve-scripts` writes. See the note above the coverage check below.
  lavamoat: 'lavamoat',
  eslintConfig: 'eslint',
  prettier: 'prettier',
  jest: 'jest',
  husky: 'husky',
  'lint-staged': 'lint-staged',
  browserslist: 'browserslist',
  nyc: 'nyc',
  c8: 'c8',
}

const installed = new Set(
  Object.keys(lock.packages ?? {})
    .filter((p) => p.startsWith('node_modules/'))
    .map((p) => p.slice('node_modules/'.length)),
)

for (const [key, owner] of Object.entries(OWNERS)) {
  if (key in pkg && !installed.has(owner)) {
    failed++
    console.error(`FAIL  package.json has "${key}", which only ${owner} reads, and ${owner} is not installed`)
    console.error('      Either install the tool or delete the block. A policy nothing enforces is a lie.')
  }
}

if (failed > 0) {
  console.error(`\n${failed} install time problems.`)
  process.exit(1)
}

console.log('install: no unreviewed install scripts, and no configuration nothing reads')
