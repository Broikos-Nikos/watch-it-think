/**
 * What the witness's two controls actually measure, from the graph the page loads.
 *
 *   npm run witness:controls          prints them
 *   npm run witness:controls -- --write   writes them into meta.json
 *
 * WME2-F7. The README said reversing the layer order or rolling the head axis
 * "fails this one at 9.6e-01" and `meta.json` said both fail "at about
 * 9.8e-01". Two numbers for one claim, in the two files that state it, and
 * nothing anywhere produced either: they were hand mutations recorded in commit
 * messages, `f0ff6e4` on a sample of four English sentences and `8488859` after
 * the sample became both languages, and the README's figure is the roll's under
 * the current sample applied to both controls.
 *
 * This is the evidence for the strongest claim in the README, so it is measured
 * by a command now, and the command is this one.
 *
 * ## What it runs, and why not the exporter
 *
 * The audit asked for a flag on `tools/export_onnx.py`. That file needs torch,
 * the bslm repository and a 20 MB checkpoint that is not public, so a number it
 * printed would be a number nobody who clones this can reproduce, which is the
 * defect this finding is about in a different costume.
 *
 * Everything here reads what the repository ships: `public/model/tokenizer.json`
 * through this project's own `Tokenizer`, and `public/model/router.int8.onnx`,
 * the graph the page itself loads, through `onnxruntime-web`. Any clone with
 * `npm ci` can run it.
 *
 * ## What the number is
 *
 * The witness statistic is `max |got - want|` over every value of every field,
 * where `want` is the field recomputed from the raw weights in numpy and `got`
 * is what the graph emits. Under a control, `got` is the cube mutated: layers
 * reversed, or the head axis rolled by one.
 *
 * `want` is not available here, for the reason above, so this measures
 * `max |mutated - cube|` instead. The two differ by exactly the witness's own
 * agreement with the weights, which `meta.json` records as 1.0e-06, six orders
 * of magnitude below the quantity being reported. The printed value carries
 * that: it is the control's distance from the graph's own output, and the
 * witness's distance from the weights is the error bar on it.
 *
 * The sentences are the four the witness runs on, chosen here by the same rule
 * as in `export_onnx.py`: the shortest and the longest of each language. The
 * rule is written out in both places rather than shared, because they are in
 * different languages, and `check:witness` compares the two lists.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as ort from 'onnxruntime-web'
import { Tokenizer, type TokenizerData } from '../src/lib/tokenizer'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/*
 * The same list as `GATE_SENTENCES` in `tools/export_onnx.py`, read out of that
 * file rather than copied into this one. A second copy of a list is a second
 * thing to forget, and the whole finding here is two copies of one number.
 */
function gateSentences(): string[] {
  const py = readFileSync(resolve(root, 'tools/export_onnx.py'), 'utf8')
  const start = py.indexOf('GATE_SENTENCES = [')
  if (start < 0) throw new Error('export_onnx.py has no GATE_SENTENCES')
  const block = py.slice(py.indexOf('[', start) + 1, py.indexOf(']', start))

  /*
   * Adjacent string literals are one sentence, and the entry ends at the comma.
   *
   * Python joins "a " "b" across lines, and the two longest sentences in that
   * list are written that way. The first version of this read every line as its
   * own entry: 29 sentences instead of 22, and the sample it picked contained
   * the fragment "before the weather changes in Thessaloniki and cancel the
   * alarm I set for ". It printed numbers, and they were numbers about nothing.
   * `check:witness` holds the token counts to the ones `meta.json` recorded.
   */
  const out: string[] = []
  let buffer = ''
  for (const raw of block.split('\n')) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    for (const m of line.matchAll(/"([^"]*)"/g)) buffer += m[1]
    if (line.endsWith(',')) {
      if (buffer !== '') out.push(buffer)
      buffer = ''
    }
  }
  if (buffer !== '') out.push(buffer)
  return out
}

const isGreek = (s: string) => /[Ͱ-Ͽἀ-῿]/.test(s)

/** The shortest and the longest of each language, by token count. */
function witnessSample(texts: string[], lengthOf: (t: string) => number): string[] {
  const byLang = new Map<string, string[]>()
  for (const t of texts) {
    const lang = isGreek(t) ? 'el' : 'en'
    byLang.set(lang, [...(byLang.get(lang) ?? []), t])
  }
  const picked: string[] = []
  for (const lang of [...byLang.keys()].sort()) {
    const sorted = [...byLang.get(lang)!].sort((a, b) => lengthOf(a) - lengthOf(b))
    picked.push(sorted[0], sorted[sorted.length - 1])
  }
  return [...new Set(picked)]
}

const data: TokenizerData = JSON.parse(readFileSync(resolve(root, 'public/model/tokenizer.json'), 'utf8'))
const tok = new Tokenizer(data)

const sentences = gateSentences()
if (sentences.length === 0) throw new Error('no gate sentences were read out of export_onnx.py')
const sample = witnessSample(sentences, (t) => tok.encodeText(t).ids.length)

ort.env.wasm.numThreads = 1
const session = await ort.InferenceSession.create(
  readFileSync(resolve(root, 'public/model/router.int8.onnx')),
  { executionProviders: ['wasm'] },
)

type Cube = { data: Float32Array; layers: number; heads: number; positions: number }

async function cubeFor(text: string): Promise<Cube> {
  const { ids, cases } = tok.encodeText(text)
  const out = await session.run({
    ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    cases: new ort.Tensor('int64', BigInt64Array.from(cases.map(BigInt)), [1, cases.length]),
  })
  const att = out.attention
  const [layers, , heads, positions] = att.dims as number[]
  return { data: att.data as Float32Array, layers, heads, positions }
}

/** Where one field starts in the flat tensor. The batch axis is 1 throughout. */
const at = (c: Cube, layer: number, head: number) => (layer * c.heads + head) * c.positions * c.positions

function worstAgainst(c: Cube, map: (layer: number, head: number) => [number, number]): number {
  let worst = 0
  const n = c.positions * c.positions
  for (let layer = 0; layer < c.layers; layer++) {
    for (let head = 0; head < c.heads; head++) {
      const [l2, h2] = map(layer, head)
      const a = at(c, layer, head)
      const b = at(c, l2, h2)
      for (let i = 0; i < n; i++) {
        const d = Math.abs(c.data[a + i] - c.data[b + i])
        if (d > worst) worst = d
      }
    }
  }
  return worst
}

const controls = [
  {
    id: 'layersReversed',
    says: 'the layer order reversed',
    map: (c: Cube) => (layer: number, head: number) => [c.layers - 1 - layer, head] as [number, number],
  },
  {
    id: 'headAxisRolled',
    says: 'the head axis rolled by one',
    map: (c: Cube) => (layer: number, head: number) => [layer, (head + 1) % c.heads] as [number, number],
  },
]

export interface Measured {
  sample: { text: string; tokens: number; values: Record<string, number> }[]
  worst: Record<string, number>
}

/** Exported so `check:witness` measures rather than reads a number back. */
export async function measureControls(): Promise<Measured> {
  const out: Measured = { sample: [], worst: {} }
  for (const text of sample) {
    const cube = await cubeFor(text)
    const values: Record<string, number> = {}
    for (const control of controls) {
      const v = worstAgainst(cube, control.map(cube))
      values[control.id] = v
      out.worst[control.id] = Math.max(out.worst[control.id] ?? 0, v)
    }
    out.sample.push({ text, tokens: tok.encodeText(text).ids.length, values })
  }
  return out
}

export const CONTROL_IDS = controls.map((c) => c.id)
export const exponent = (v: number) => v.toExponential(1)

/*
 * The command only runs when it is the command. `check:witness` imports the
 * function above, and a module that measured on import would make that gate's
 * timing depend on which file node reached first.
 */
/* `pathToFileURL`, not a template: on Windows the argv path is C:\... and the
   hand built URL came out with two slashes against import.meta.url's three, so
   the guard was false and the command printed nothing at all. */
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main()

async function main() {
const { sample: rows, worst } = await measureControls()
const perSentence: Record<string, Record<string, number>> = Object.fromEntries(
  rows.map((r) => [r.text, r.values]),
)

console.log(`witness controls, on the ${sample.length} sentences the witness runs`)
for (const text of sample) {
  const ids = tok.encodeText(text).ids.length
  const parts = controls.map((c) => `${c.id} ${exponent(perSentence[text][c.id])}`).join(', ')
  console.log(`  ${String(ids).padStart(3)} tokens  ${parts}  ${JSON.stringify(text)}`)
}
for (const control of controls) {
  console.log(`  worst: ${control.says} differs from the graph's own output by ${exponent(worst[control.id])}`)
}

if (process.argv.includes('--write')) {
  const metaPath = resolve(root, 'public/model/meta.json')
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  const entry = meta.parity?.attentionAgainstNumpyWitness
  if (!entry) throw new Error('meta.json has no parity.attentionAgainstNumpyWitness')
  entry.controls = {
    measuredBy: 'npm run witness:controls',
    against: 'public/model/router.int8.onnx, the graph the page loads',
    note:
      'the distance between the mutated cube and the graph own output. The witness own ' +
      'agreement with the weights, recorded above, is the error bar on these.',
    layersReversed: worst.layersReversed,
    headAxisRolled: worst.headAxisRolled,
  }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')
  console.log(`wrote both into ${metaPath}`)
}
}
