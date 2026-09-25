/**
 * What quantisation actually did, measured on the graph that ships.
 *
 *   npm run check:quant
 *
 * WDR-F10. `ACCURACY_BUDGET` is spent entirely on intent accuracy, and the
 * headline of this page is the attention field, which no number described at
 * all. The quantising call argued the point away instead: "the attention output
 * is a probability field the page draws. Quantising the activations around it
 * would show up as banding in something a visitor is looking at directly, so
 * only the weights are quantised."
 *
 * That last clause is not what the option does. Measured on
 * `public/model/router.int8.onnx` at tick 163, counting distinct nodes:
 *
 *   DynamicQuantizeLinear        27
 *   MatMulInteger                27
 *   activation tensors quantised 27, six of them inside attention
 *   float MatMuls inside attn    12, two per block: the scores and the values
 *   quantised MatMuls inside attn 12, two per block: qkv and proj
 *   Softmax nodes                 6, one per block, in float
 *
 * So the intent was right and the sentence was wrong. `MatMulConstBOnly` leaves
 * the two matmuls with dynamic inputs in float, which is why the softmax the
 * page draws is float arithmetic; everything with a weight matrix is int8, and
 * the activations feeding those are quantised per tensor at runtime. The field
 * still moves, because the scores come out of an int8 projection.
 *
 * ## What is checked
 *
 * The graph, because it is the artifact:
 *
 *   the two matmuls per block that carry the field stay in float
 *   the projections are quantised, or nothing was gained
 *   every Softmax is in float
 *
 * And the source, because the fix the finding asked for is a number this
 * repository cannot produce: `quantize.py` needs `bslm.pt` and the held out
 * rows, and `meta.json` records both as not obtainable. So the measurement is
 * written, budgeted and recorded, and this asserts it is still there for the
 * next run rather than pretending to have run it.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

/*
 * The graph is an argument so that a control can hand this a different one:
 *   node tools/check-quantisation.mjs path/to/other.onnx
 */
const model = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'public/model/router.int8.onnx')
const graph = readFileSync(model).toString('latin1')
const distinct = (pattern) => new Set(graph.match(pattern) ?? []).size

const floatMatMuls = distinct(/\/blocks\.\d+\/attn\/MatMul(?:_\d+)?(?=[^A-Za-z_])/g)
const quantMatMuls = distinct(/\/blocks\.\d+\/attn\/[A-Za-z0-9_./]*?MatMul_quant/g)
const softmax = distinct(/\/blocks\.\d+\/attn\/Softmax(?:_\d+)?(?=[^A-Za-z_])/g)
const quantised = distinct(/[A-Za-z0-9_./]+_output_0_QuantizeLinear/g)

console.log(
  `  ${floatMatMuls} float matmuls and ${quantMatMuls} quantised ones inside attention, ` +
    `${softmax} softmax nodes, ${quantised} activation tensors quantised at runtime`,
)

/*
 * Two per block that stay in float are the scores and the values, the two with
 * no weight matrix. They are what makes the picture float arithmetic, and the
 * whole argument of the comment rests on them.
 */
if (floatMatMuls < softmax * 2) {
  fail(
    `${floatMatMuls} matmuls inside attention are in float and there are ${softmax} blocks`,
    'Two per block carry the field itself. If they are quantised, the picture is int8 arithmetic and the page should say so.',
  )
}
if (quantMatMuls < softmax * 2) {
  fail(
    `only ${quantMatMuls} matmuls inside attention are quantised`,
    'The projections are where the size comes from. If they are float too, the graph is not the one that was measured.',
  )
}
if (quantised === 0) {
  fail('no activation tensor is quantised at runtime', 'Then this is not a dynamically quantised graph and every number about it describes something else.')
}

/*
 * And the measurement the finding asked for, in the file that will run it. The
 * numbers cannot be produced here: meta.json records the weights and the held
 * out rows as obtainable: false, and inventing them is the one thing this
 * repository refuses.
 */
const py = readFileSync(resolve(root, 'tools/quantize.py'), 'utf8')
for (const [needle, why] of [
  ['def attention_drift(', 'the share of query rows whose strongest key moves between the two graphs'],
  ['ATTENTION_BUDGET', 'a budget of its own, so the number has a line to cross'],
  ['"attentionDrift"', 'recorded in the quantisation block, beside the accuracy it was traded for'],
  ['and attention_ok', 'and the ship decision reads it, or the budget is decoration'],
]) {
  if (!py.includes(needle)) fail(`quantize.py no longer carries ${JSON.stringify(needle)}`, why)
}

/*
 * The sentence that argued instead of measuring. Quoting it to correct it is
 * what the file does now, so the pattern asks for the claim standing alone.
 */
const flat = py.replace(/\s+/g, ' ')
if (/so only the weights are quantised/.test(flat) && !/not what this option does/.test(flat)) {
  fail(
    'quantize.py still says only the weights are quantised',
    `The graph has ${quantised} activation tensors quantised at runtime, six of them inside attention.`,
  )
}

if (failed > 0) {
  console.error('\nThe budget is spent on the answer, and the picture is the headline.')
  process.exit(1)
}

console.log('quant: the field is float arithmetic out of int8 projections, and the drift has a number and a budget')
