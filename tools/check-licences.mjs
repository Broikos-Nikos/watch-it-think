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

  /*
   * The file is the unmodified MIT text, and this gate used to require that it
   * was not.
   *
   * It asserted a sentence saying the model weights are excluded, which was
   * added in good faith and did two things nobody checked. GitHub's classifier
   * reads the whole file and will not name a licence it does not recognise, so
   * three appended lines turned the sidebar from MIT into "NOASSERTION" on the
   * day this published, while `tokenlab`, with the same text unmodified, showed
   * MIT. And the sentence said the weights "are not in this repository" while
   * `public/model/router.int8.onnx` sat five megabytes away in the same tree.
   *
   * So the exclusion moves to the README, which already drew the distinction
   * the LICENSE lost, and this compares against the canonical text. The
   * previous gate is the reason this one exists: it checked that a sentence was
   * present and never asked what the sentence did to the file it was in.
   */
  const MIT_OPENING = 'MIT License'
  const MIT_BODY = [
    'Permission is hereby granted, free of charge, to any person obtaining a copy',
    'The above copyright notice and this permission notice shall be included in all',
    'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR',
    'OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE',
    'SOFTWARE.',
  ]
  const flat = text.replace(/\s+/g, ' ').trim()
  const missing = MIT_BODY.filter((line) => !flat.includes(line.replace(/\s+/g, ' ')))
  // Everything after the closing word is an addition, and an addition is what
  // stops the classifier.
  const trailing = text.slice(text.indexOf('SOFTWARE.') + 'SOFTWARE.'.length).trim()

  if (!text.startsWith(MIT_OPENING) || missing.length > 0) {
    fail(`the LICENSE is not the MIT text, ${missing.length} of its clauses are missing or altered`)
  } else if (!/Nikos Broikos/.test(text)) {
    fail('the LICENSE does not name the copyright holder')
  } else if (trailing.length > 0) {
    fail(
      `there are ${trailing.length} characters appended after the MIT text`,
      'GitHub will not classify a licence file it does not recognise, so the sidebar shows ' +
        'NOASSERTION and the repository reads as unlicensed: ' +
        JSON.stringify(trailing.slice(0, 60)),
    )
  } else {
    console.log('  ok      LICENSE is the unmodified MIT text and names the holder')
  }

  // The exclusion still has to be stated, in the place that can carry a nuance
  // a licence file cannot: the int8 graph IS committed and the checkpoint and
  // the test set are not.
  if (!/not in this repository/i.test(readme) || !/int8 graph the page runs on \*is\* committed/i.test(readme)) {
    fail(
      'the README no longer says which model files are here and which are not',
      'that distinction left the LICENSE because it was wrong there, so it has to be right here',
    )
  } else {
    console.log('  ok      the README says what is committed and what is not')
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
