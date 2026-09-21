/**
 * Every number the page downloads has to say what it is a measurement of.
 *
 *   npm run check:meta
 *
 * `meta.json` is the one file in this project that a reader can open without
 * running anything, and for a long time it was the least careful. It shipped
 * four parity numbers under one tolerance when three tolerances applied. It
 * shipped `"sentences": 20` next to a gate that saw four. And it shipped
 * `msPerSentence: 0.71` with no runtime, no thread count, no repeat count and
 * no spread, which is how this repository ended up with five different numbers
 * for the same quantity, from 0.71 to 3.4, and no way to tell which was which.
 *
 * None of those was caught by a gate, because every gate here checked the
 * model and none of them read the file the browser actually fetches. This one
 * does, and it checks a single property: a measurement must arrive with its
 * method attached.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const meta = JSON.parse(readFileSync(resolve(root, 'public/model/meta.json'), 'utf8'))

const problems = []
const fail = (where, what) => problems.push(`${where}: ${what}`)

// ---- every parity entry carries its own tolerance and its own sample -------
if (!meta.parity) fail('parity', 'missing entirely')
for (const [name, p] of Object.entries(meta.parity ?? {})) {
  if (typeof p !== 'object' || p === null) {
    fail(`parity.${name}`, 'is a bare number, so its tolerance and sample are somebody else\'s')
    continue
  }
  if (typeof p.value !== 'number') fail(`parity.${name}`, 'has no value')
  if (typeof p.tolerance !== 'number') fail(`parity.${name}`, 'has no tolerance of its own')
  if (typeof p.sentences !== 'number') fail(`parity.${name}`, 'does not say how many sentences it saw')
  if (!p.note) fail(`parity.${name}`, 'has no note saying what it is evidence of')
  if (typeof p.value === 'number' && typeof p.tolerance === 'number' && p.value > p.tolerance) {
    fail(`parity.${name}`, `value ${p.value} exceeds its own tolerance ${p.tolerance}`)
  }
}

// ---- the witness has to have covered both languages -----------------------
const w = meta.parity?.attentionAgainstNumpyWitness
if (w && !(w.languages?.includes('el') && w.languages?.includes('en'))) {
  fail('parity.attentionAgainstNumpyWitness', `ran on ${JSON.stringify(w.languages)}, not both languages`)
}

// ---- every input is named, hashed, and honest about being obtainable ------
if (!meta.inputs) fail('inputs', 'missing: nothing records which files these numbers came from')
for (const [name, i] of Object.entries(meta.inputs ?? {})) {
  if (name === 'bslm') {
    if (!i.commit) fail('inputs.bslm', 'no commit, so the code behind these numbers is unidentified')
    continue
  }
  if (!i.sha256) fail(`inputs.${name}`, 'no sha256, so nobody can tell if they have the same file')
  if (typeof i.obtainable !== 'boolean') fail(`inputs.${name}`, 'does not say whether a reader can get it')
}

// ---- no latency number without its method ---------------------------------
const q = meta.quantisation
if (q) {
  if (!q.measuredOn?.runtime) fail('quantisation.measuredOn', 'no runtime recorded for the timings')
  if (typeof q.measuredOn?.threads !== 'number') fail('quantisation.measuredOn', 'no thread count')
  if (!q.testSet?.sha256) fail('quantisation.testSet', 'the evaluated file is not identified')
  if (typeof q.rowsRead !== 'number' || typeof q.rowsEvaluated !== 'number') {
    fail('quantisation', 'rowsRead and rowsEvaluated are not both recorded')
  }

  for (const graph of ['fp32', 'int8']) {
    const g = q[graph]
    if (!g) {
      fail(`quantisation.${graph}`, 'missing')
      continue
    }
    // This is the specific shape the finding was about: a single averaged
    // millisecond with nothing beside it.
    if ('msPerSentence' in g) {
      fail(`quantisation.${graph}.msPerSentence`, 'a bare mean with no spread and no method. Use latency.')
    }
    const l = g.latency
    if (!l) {
      fail(`quantisation.${graph}.latency`, 'no latency block')
      continue
    }
    for (const k of ['medianMs', 'p05Ms', 'p95Ms', 'runs']) {
      if (typeof l[k] !== 'number') fail(`quantisation.${graph}.latency`, `no ${k}`)
    }
    if (l.runs < 100) fail(`quantisation.${graph}.latency`, `${l.runs} runs is not a distribution`)
    if (l.p95Ms < l.medianMs) fail(`quantisation.${graph}.latency`, 'p95 below the median')
    if (!g.byLength?.length) {
      fail(`quantisation.${graph}.byLength`, 'no latency against token count, and attention is quadratic in it')
    }
  }
}

if (problems.length > 0) {
  console.error('meta.json ships numbers without their method:\n')
  for (const p of problems) console.error(`  FAIL  ${p}`)
  console.error(`\n${problems.length} problems. A measurement without its method is an anecdote.`)
  process.exit(1)
}

const int8 = q?.int8
console.log(
  `meta.json: ${Object.keys(meta.parity).length} parity entries each with their own tolerance, ` +
    `${Object.keys(meta.inputs).length} inputs named and hashed`,
)
if (int8?.latency) {
  console.log(
    `  int8 ${int8.latency.medianMs} ms median over ${int8.latency.runs} runs ` +
      `(p05 ${int8.latency.p05Ms}, p95 ${int8.latency.p95Ms}), ` +
      `${q.measuredOn.threads} thread, ${q.measuredOn.runtime}`,
  )
  console.log(`  by length: ${int8.byLength.map((b) => `T=${b.tokens} ${b.medianMs}ms`).join('  ')}`)
}
