/**
 * Copy the house palette out of the workspace guide and into this repository.
 *
 *   npm run vendor:tokens
 *
 * `STYLEGUIDE.md` lives two directories above this one, in a workspace that is
 * not a git repository. `check:palette` read it directly, which was pleasant
 * while everything sat on one machine and meant `npm run build` died on its
 * third step in any clean clone, with an ENOENT and a node stack trace, on a
 * repository about to be published.
 *
 * The guide stays the source of truth. This writes the part this project needs
 * into `house-tokens.json`, which is tracked, and `check:palette` reads that.
 * When the guide is present the gate also re-verifies the copy against it, so
 * the two cannot drift apart in silence; when it is absent, which is every
 * machine but this one, the gate still runs on the vendored values.
 *
 * Generated, not hand copied, because a hand copied palette is a palette that
 * was right once.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const guidePath = resolve(root, '../../STYLEGUIDE.md')

if (!existsSync(guidePath)) {
  console.error(`FAIL  ${guidePath} is not here, so there is nothing to vendor from.`)
  console.error('      This script only runs in the workspace that holds the guide.')
  process.exit(1)
}

const guide = readFileSync(guidePath, 'utf8')
const tokens = Object.fromEntries(
  [...guide.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toLowerCase()]),
)

if (Object.keys(tokens).length < 6) {
  console.error(`FAIL  only found ${Object.keys(tokens).length} tokens in the guide, which cannot be right`)
  process.exit(1)
}

const out = {
  _: 'Generated from STYLEGUIDE.md by tools/vendor-house-tokens.mjs. Do not edit by hand.',
  why:
    'The palette gate used to read ../../STYLEGUIDE.md directly, which is in the workspace above this ' +
    'repository and not in it, so npm run build died on its third step in any clean clone. The guide is ' +
    'still the source of truth; this is a copy of the part this project needs, and the gate re-verifies ' +
    'it against the guide whenever the guide is present.',
  source: 'https://broikos.gr, read via STYLEGUIDE.md',
  vendored: new Date().toISOString().slice(0, 10),
  tokens,
}

writeFileSync(resolve(root, 'house-tokens.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`vendored ${Object.keys(tokens).length} tokens into house-tokens.json`)
