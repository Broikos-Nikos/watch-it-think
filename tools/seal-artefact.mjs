/**
 * Write the shipped graph's own hash into `meta.json`.
 *
 *   node tools/seal-artefact.mjs          writes it
 *   node tools/seal-artefact.mjs --check  prints what it would write
 *
 * WS-F3, the supply chain pass of 22 September: "the one file every visitor
 * downloads and executes is the one file with no hash". `meta.json` records a
 * sha256 for four input files, two of which a reader cannot obtain, and
 * records `public/model/router.int8.onnx` by byte count alone. A byte count is
 * not a hash: a graph with different weights and the same size passes it.
 *
 * ## Why this exists instead of just running the quantiser
 *
 * `tools/quantize.py` writes `meta.json`, and from this tick it writes
 * `sha256Int8` and `sha256Fp32` beside the byte counts. It cannot be run here:
 * it needs torch and `checkpoints/bslm.pt`, which `meta.json` itself records
 * as `obtainable: false`. So the field had to be backfilled by something, and
 * the something had to be a tool rather than an editor, because `meta.json`
 * being hand edited is already a finding against this project (WME2-F8).
 *
 * Two writers for one file is the drift this repository keeps being bitten by,
 * so the field they share is the one kind that cannot drift: its value is a
 * pure function of a file that is committed next to it, and `check:meta`
 * recomputes it from those bytes on every build rather than trusting either
 * writer. If the quantiser and this tool ever disagree, the gate fails, and it
 * fails on the artefact rather than on the provenance.
 *
 * It writes exactly one key, as text, and the proof is the bytes.
 *
 * The first version of this parsed `meta.json`, set the key and re-serialised,
 * with an assertion comparing the before and after as parsed objects. The
 * assertion passed and the diff was six lines:
 *
 *     -      "value": 9.059906005859375e-06,
 *     +      "value": 0.000009059906005859375,
 *     -      "tolerance": 1e-05,
 *     +      "tolerance": 0.00001,
 *
 * Python's `json.dumps` and node's `JSON.stringify` disagree about when to use
 * an exponent, so a round trip rewrites numbers the quantiser wrote and the
 * tool that exists to stop `meta.json` drifting silently rewrote five of its
 * numbers. The values are equal, which is exactly why comparing parsed objects
 * could not see it. It inserts one line now and every other byte in the file
 * is the byte the quantiser wrote.
 */

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const metaPath = resolve(root, 'public/model/meta.json')
const graphPath = resolve(root, 'public/model/router.int8.onnx')

const before = readFileSync(metaPath, 'utf8')
const meta = JSON.parse(before)
const bytes = readFileSync(graphPath)
const sha = createHash('sha256').update(bytes).digest('hex')

if (!meta.quantisation) {
  console.error('FAIL  meta.json has no quantisation block, so there is nowhere for this to go')
  process.exit(1)
}
if (meta.quantisation.bytesInt8 !== bytes.length) {
  console.error(
    `FAIL  meta.json says the graph is ${meta.quantisation.bytesInt8} bytes and it is ${bytes.length}`,
  )
  console.error('      Sealing a file the measurement does not describe would make the hash a lie with a checksum on it.')
  process.exit(1)
}

if (process.argv.includes('--check')) {
  console.log(`router.int8.onnx  ${bytes.length} bytes  sha256 ${sha}`)
  console.log(`meta.json records ${meta.quantisation.sha256Int8 ?? '(nothing)'}`)
  process.exit(0)
}

/*
 * Line by line, and the new line copies the ending of the line above it.
 *
 * `meta.json` arrives CRLF on this machine. The first textual attempt matched
 * the anchor with `\r?\n` and then appended its own bare `\n`, which put a
 * line ending into the file that none of its other 404 lines use, and git
 * drew it as a blank line above the key. Nothing here wants an opinion about
 * line endings, so it takes the one already there.
 */
const lines = before.split('\n')
const want = new RegExp(`^[ \\t]*"bytesInt8": ${bytes.length},\\r?$`)
const at = lines.findIndex((l) => want.test(l))
if (at < 0) {
  console.error(`FAIL  meta.json has no "bytesInt8": ${bytes.length} line to write beside`)
  process.exit(1)
}

let after
if (/"sha256Int8"/.test(before)) {
  after = before.replace(/"sha256Int8": "[0-9a-f]*"/, `"sha256Int8": "${sha}"`)
} else {
  const indent = lines[at].match(/^[ \t]*/)[0]
  const cr = lines[at].endsWith('\r') ? '\r' : ''
  lines.splice(at + 1, 0, `${indent}"sha256Int8": "${sha}",${cr}`)
  after = lines.join('\n')
}

/* Nothing but that one line, and the proof is the bytes rather than the
   intention. Measured line by line, because comparing the parsed objects is
   what let the first version through. */
const removed = before.split('\n').filter((l) => !after.split('\n').includes(l))
const added = after.split('\n').filter((l) => !before.split('\n').includes(l))
if (after === before) {
  console.log(`already sealed: ${sha}`)
  process.exit(0)
}
if (removed.length > 0 || added.length !== 1 || !added[0].includes('sha256Int8')) {
  console.error('FAIL  writing the hash would change something else in meta.json, so nothing was written')
  console.error(`      ${removed.length} lines removed, ${added.length} added: ${added.slice(0, 3).join(' | ')}`)
  process.exit(1)
}

writeFileSync(metaPath, after)
console.log(`sealed router.int8.onnx: ${bytes.length} bytes, sha256 ${sha}`)
