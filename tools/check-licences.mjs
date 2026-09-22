/**
 * Everything this page ships says who wrote it and under what terms.
 *
 *   npm run check:licences
 *
 * The supply chain audit found three separate gaps. `package.json` had no
 * `license` field, so every tool that reads it reported the project as
 * unlicensed while the README said "Code MIT". There was no `LICENSE` file, so
 * GitHub's detection, which reads the file and not the prose, would show
 * nothing in the sidebar of a repository whose two most borrowable pieces are a
 * tokenizer port and an attention witness.
 *
 * And the third one is the one that matters. It grepped all three shipped
 * artefacts, the bundle, the runtime's loader and the 14.2 MB wasm binary, for
 * Microsoft's copyright: zero hits in all three. MIT requires its notice to
 * travel with substantial portions, and a third of a gigabyte of somebody
 * else's work was travelling without it.
 *
 * A static site has nowhere to put a notice except a file it serves, so the
 * notice is a file it serves, and this checks that it is still there, still
 * complete, and still lists every dependency that actually reaches the page.
 *
 * The list is derived from the lockfile rather than written here, because a
 * hand written list of dependencies is a list that was true once.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

// ---- the project's own position, in all three places it is read ------------
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const readme = readFileSync(resolve(root, 'README.md'), 'utf8')

if (!existsSync(resolve(root, 'LICENSE'))) {
  fail('there is no LICENSE file', "GitHub reads the file, not the prose, and shows nothing without it")
} else {
  const text = readFileSync(resolve(root, 'LICENSE'), 'utf8')
  if (!/MIT License/.test(text) || !/Nikos Broikos/.test(text)) {
    fail('the LICENSE file does not name MIT and the copyright holder')
  } else if (!/model weights are not distributed/i.test(text)) {
    fail(
      'the LICENSE does not say the weights are excluded',
      'the one thing in this project it does not cover is the thing people would assume it does',
    )
  } else {
    console.log('  ok      LICENSE is MIT, names the holder, and excludes the weights')
  }
}

if (pkg.license !== 'MIT') {
  fail(`package.json says license ${JSON.stringify(pkg.license)} and the README says MIT`)
} else if (!/Code MIT/.test(readme)) {
  fail('the README no longer says the code is MIT, so the metadata and the prose disagree')
} else {
  console.log('  ok      package.json, LICENSE and the README all say MIT')
}

// ---- every dependency that reaches the page is named in the notices --------
const notices = resolve(root, 'public/THIRD-PARTY-NOTICES.md')
if (!existsSync(notices)) {
  fail('public/THIRD-PARTY-NOTICES.md is missing, so the notices do not travel with the page')
} else {
  const text = readFileSync(notices, 'utf8')

  const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'))
  const shipped = Object.entries(lock.packages)
    .filter(([k, v]) => k.startsWith('node_modules/') && !v.dev)
    .map(([k]) => k.slice('node_modules/'.length))
    // @types and undici-types are types only: they are not dev in the lockfile
    // but nothing of theirs is in the bundle.
    .filter((n) => !n.startsWith('@types/') && n !== 'undici-types')

  const missing = shipped.filter((n) => {
    const base = n.startsWith('@protobufjs/') ? '@protobufjs' : n
    return !text.includes(base)
  })

  if (missing.length > 0) {
    fail(
      `${missing.length} shipped packages are not in the notices`,
      missing.join(', '),
    )
  } else {
    console.log(`  ok      all ${shipped.length} shipped packages are named in the notices`)
  }

  // The specific thing the audit found absent.
  if (!/Copyright \(c\) Microsoft Corporation/.test(text)) {
    fail("the runtime's copyright notice is not in the file that ships with it")
  } else {
    console.log("  ok      the runtime's copyright travels with the page")
  }

  // The fonts are under two different licences and getting that backwards is a
  // mistake this workspace has already made once, in the sibling project.
  if (!/Manrope[\s\S]*Open Font License/.test(text) || !/Roboto Mono[\s\S]*Apache/.test(text)) {
    fail('the notices do not record Manrope as OFL and Roboto Mono as Apache 2.0')
  } else {
    console.log('  ok      both fonts are recorded under the right licence')
  }
}

if (failed > 0) {
  console.error('\nEverything shipped has an author, and most of them asked for one thing in return.')
  process.exit(1)
}

console.log('licences: the project states its own, and every dependency that ships is named')
