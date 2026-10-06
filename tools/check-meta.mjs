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

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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

  /*
   * Every library whose arithmetic reaches a recorded number, by version.
   *
   * WS-F4, the supply chain pass: `measuredOn` recorded the runtime, the thread
   * count, the CPU, the Python and the OS, and not numpy and not torch. numpy
   * computes `parity.attentionAgainstNumpyWitness`, the independent
   * recomputation of every attention field from the raw weights, which is the
   * strongest claim this repository makes and exists precisely to survive the
   * objection that a passing gate might be passing on a wrong cube. Its value
   * is quoted to seventeen digits.
   *
   * `requirements.txt` pins all four now, and `tools/requirements.txt` says why
   * 2.5.2 rather than something else: the exporter was re-run against the same
   * checkpoint under it and all four parity values came back bit identical.
   * Held here against the pins, because a version recorded in `meta.json` that
   * the requirements do not install is two claims that disagree.
   */
  const libs = q.measuredOn?.libraries
  const REQUIRED = ['numpy', 'torch', 'onnx', 'onnxruntime']
  if (!libs) {
    fail(
      'quantisation.measuredOn.libraries',
      'no library versions, so the witness is a residual out of arithmetic nothing names. Run python tools/record_libraries.py',
    )
  } else {
    const absent = REQUIRED.filter((k) => !libs[k])
    if (absent.length > 0) {
      fail('quantisation.measuredOn.libraries', `does not record ${absent.join(', ')}`)
    } else {
      const reqPath = resolve(root, 'tools/requirements.txt')
      /* Only lines that actually pin. A bare `numpy` split on `==` gives
         `['numpy']`, which `Map` stores as a key with the value undefined, and
         the first version of this reported "requirements.txt pins undefined"
         instead of "does not pin numpy". The unpinned case is the finding. */
      const pins = new Map(
        readFileSync(reqPath, 'utf8')
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith('#') && l.includes('=='))
          .map((l) => l.split('==')),
      )
      const unpinnedFirst = REQUIRED.filter((k) => !pins.has(k))
      if (unpinnedFirst.length > 0) {
        fail(
          'tools/requirements.txt',
          `does not pin ${unpinnedFirst.join(', ')}, and meta.json records ${unpinnedFirst.map((k) => `${k} ${libs[k]}`).join(', ')} as what produced the numbers in this file`,
        )
      }
      /* `2.14.0+cu126` against a pin of `2.14.0`: the local build tag is part of
         what ran and not part of what pip was asked for, so the pin has to be a
         prefix rather than equal. */
      const off = REQUIRED.filter((k) => pins.has(k) && !String(libs[k]).startsWith(pins.get(k)))
      if (off.length > 0) {
        fail(
          'quantisation.measuredOn.libraries',
          `${off.map((k) => `${k} ran ${libs[k]} and tools/requirements.txt pins ${pins.get(k)}`).join('; ')}. A reader installing the requirements would not get the numbers in this file.`,
        )
      }
    }
  }

  /*
   * The graph the browser runs, against its own bytes.
   *
   * WS-F3, the supply chain pass of 22 September: "the one file every visitor
   * downloads and executes is the one file with no hash". `meta.json` hashed
   * four input files, two of which it also records as `obtainable: false`,
   * and recorded `router.int8.onnx` by byte count alone. The README's honest
   * limits say "you can check that you have the same files", and the file a
   * reader most needs to check was the one they could not.
   *
   * Recomputed here rather than compared between two recorded numbers, which
   * is the only version of this assertion that is worth anything: it catches
   * the graph being replaced without the numbers being remeasured, which is
   * the failure the rest of this gate exists for, and it catches either of
   * the two tools that write the field writing it wrong.
   */
  if (!q.sha256Int8) {
    fail('quantisation.sha256Int8', 'the graph the browser downloads and runs is recorded by size alone, and a byte count is not a hash')
  } else {
    const graph = resolve(root, 'public/model/router.int8.onnx')
    if (!existsSync(graph)) {
      fail('quantisation.sha256Int8', 'public/model/router.int8.onnx is not here, so the hash describes nothing')
    } else {
      const bytes = readFileSync(graph)
      const sha = createHash('sha256').update(bytes).digest('hex')
      if (sha !== q.sha256Int8) {
        fail(
          'quantisation.sha256Int8',
          `recorded ${q.sha256Int8.slice(0, 16)}, the shipped graph is ${sha.slice(0, 16)}. Re-run the quantiser, or node tools/seal-artefact.mjs if only the seal is stale`,
        )
      } else if (bytes.length !== q.bytesInt8) {
        fail('quantisation.bytesInt8', `says ${q.bytesInt8} and the file is ${bytes.length}`)
      }
    }
  }
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

    // Both accuracy figures or neither. The argmax one alone is a different
    // and more flattering claim than the one the deployed weights support, and
    // it shipped alone for twenty eight ticks under a devlog entry asserting
    // it could not.
    const a = g.withAbstain
    if (typeof g.intentAccuracy === 'number' && !a) {
      fail(`quantisation.${graph}.withAbstain`, 'an argmax accuracy with no abstaining figure beside it')
      continue
    }
    for (const k of ['threshold', 'intentAccuracy', 'abstained', 'rows']) {
      if (typeof a[k] !== 'number') fail(`quantisation.${graph}.withAbstain`, `no ${k}`)
    }
    if (a.rows !== g.rowsEvaluated) {
      fail(`quantisation.${graph}.withAbstain`, `measured on ${a.rows} rows against ${g.rowsEvaluated} for the argmax figure`)
    }
    if (a.intentAccuracy > g.intentAccuracy) {
      fail(`quantisation.${graph}.withAbstain`, 'scores above the argmax figure, which cannot happen if it is the same weights declining')
    }
  }

  // The harness being right is the premise of every accuracy number here.
  const c = q.crossCheck
  if (!c) {
    fail('quantisation.crossCheck', 'no record that this harness agrees with the reference implementation')
  } else {
    if (typeof c.seed !== 'number') fail('quantisation.crossCheck', 'no seed, so the rows it ran on cannot be recovered')
    if (c.argmaxDisagreements !== 0) {
      fail('quantisation.crossCheck', `${c.argmaxDisagreements} rows where the harness and the reference disagree`)
    }
    if (c.onnxArgmaxAccuracy !== c.referenceArgmaxAccuracy) {
      fail('quantisation.crossCheck', 'the harness and the reference do not agree on the sample')
    }
  }
}

/*
 * `config` describes the graph, and nothing in it describes the training run.
 *
 * It used to be the training config copied verbatim, which carries
 * `dropout: 0.1`. An exported ONNX graph has no dropout in it at all, because
 * dropout is a training time regulariser that leaves no node behind, so a reader
 * of this file was told the shipped model has something it does not have, in a
 * block where everything else is measured. The measurement audit put it as: the
 * two fields that are transcribed look measured too.
 *
 * The value is kept under `trainingOnly`, because it is true of the run that
 * produced the weights and somebody will want it. `tools/export_onnx.py` splits
 * them on the same list.
 */
const TRAINING_ONLY = ['dropout']
for (const k of TRAINING_ONLY) {
  if (meta.config && k in meta.config) {
    fail('config', `carries ${k}, which describes the training run and not the exported graph`)
  }
  if (!meta.trainingOnly || !(k in meta.trainingOnly)) {
    fail('trainingOnly', `does not carry ${k}, so moving it out of config lost it`)
  }
}

/*
 * The project's central claim, in one place rather than four.
 *
 * "trained from random init" appears in meta.json, index.html's description,
 * package.json and the router's docstring, sourced from one literal that no
 * gate touched. Four copies of a claim drift one at a time, and this is the
 * claim the whole repository rests on.
 */
const CLAIM = 'trained from random init'

/*
 * Each carrier in its own words, and the README was not a carrier at all.
 *
 * The list was three files that repeat the literal, which left out the one
 * document a reader meets first, because the README says the same thing in
 * English rather than in the exporter's phrasing. Measured at tick 171 by
 * rewriting its opening to "fine tuned from a public base model" and
 * "Pretrained weights, distilled from a bigger model": `npm run build` passed,
 * nineteen gates, zero failures. The claim the whole repository rests on was
 * reversed in the file that states it to the reader and nothing noticed.
 *
 * So the phrases are listed per file instead of assuming one spelling. A
 * paraphrase is still a copy, and a copy that no gate names is the one that
 * drifts.
 */
const CARRIERS = {
  'index.html': [CLAIM],
  'package.json': [CLAIM],
  'src/lib/router.ts': [CLAIM],
  'README.md': ['trained from nothing', 'No pretrained weights', 'nothing distilled from a bigger model'],
}

if (!meta.source?.includes(CLAIM)) {
  fail('source', `does not say "${CLAIM}", which is the claim this project rests on`)
} else {
  for (const [file, phrases] of Object.entries(CARRIERS)) {
    const text = readFileSync(resolve(root, file), 'utf8').replace(/\s+/g, ' ')
    const missing = phrases.filter((phrase) => !text.includes(phrase))
    if (missing.length > 0) {
      fail(
        'source',
        `${file} no longer says ${missing.map((m) => JSON.stringify(m)).join(' or ')}, and meta.json still claims "${CLAIM}"`,
      )
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
if (int8?.withAbstain) {
  console.log(
    `  int8 ${int8.intentAccuracy}% argmax, ${int8.withAbstain.intentAccuracy}% declining ` +
      `${int8.withAbstain.abstained} of ${int8.withAbstain.rows} below ${int8.withAbstain.threshold}`,
  )
}
if (q?.crossCheck) {
  console.log(
    `  cross check vs ${q.crossCheck.reference}: ${q.crossCheck.argmaxDisagreements} disagreements ` +
      `over ${q.crossCheck.rows} rows, seed ${q.crossCheck.seed}`,
  )
}
if (int8?.latency) {
  console.log(
    `  int8 ${int8.latency.medianMs} ms median over ${int8.latency.runs} runs ` +
      `(p05 ${int8.latency.p05Ms}, p95 ${int8.latency.p95Ms}), ` +
      `${q.measuredOn.threads} thread, ${q.measuredOn.runtime}`,
  )
  console.log(`  by length: ${int8.byLength.map((b) => `T=${b.tokens} ${b.medianMs}ms`).join('  ')}`)
}
if (q?.sha256Int8) {
  console.log(
    `  the shipped graph is the measured graph: ${q.bytesInt8.toLocaleString('en-US')} bytes, ` +
      `sha256 ${q.sha256Int8.slice(0, 16)}, recomputed here`,
  )
}
if (q?.measuredOn?.libraries) {
  console.log(
    `  the witness is reproducible: numpy ${q.measuredOn.libraries.numpy}, torch ${q.measuredOn.libraries.torch}, ` +
      `all four pinned in tools/requirements.txt`,
  )
}
