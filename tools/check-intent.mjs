/**
 * The sentence about where the intent comes from is held to the graph.
 *
 *   npm run check:intent            # or against another graph: node tools/check-intent.mjs path.onnx
 *
 * WDR-F5. The attention note said "The first position is the sentence vector,
 * which is what the intent is read from". It is not. `tools/export_onnx.py:201`
 * is `intent_logits = self.intent_head(cls + mean)`, where `mean` is the pad
 * masked average over every position, and the deep reviewer's mutation test
 * moved the logits by 2.6 and 3.4 when either half was dropped.
 *
 * That sentence is the page's only explanation of how the picture connects to
 * the answer. A visitor who takes it at face value reads the cls row of the
 * field as the whole decision and ignores the other rows, which is the opposite
 * of what the page is for.
 *
 * ## Measured on the artifact rather than on the exporter
 *
 * The exporter is source; the graph is what a visitor downloads. Read out of
 * `public/model/router.int8.onnx` at tick 158, from the bytes around the node
 * that feeds the intent head:
 *
 *   /Add_2          inputs /Gather_1_output_0 and /Div_output_0
 *   /Add_2_output_0 is what /intent_head/intent_head.0/Gemm consumes
 *
 * A Gather at position zero, a Div that is the masked mean, added, and the sum
 * is what the head reads. So the page now says the intent is read from the first
 * position and the average of every position together, and this gate holds that
 * sentence to those nodes: re-export with cls only, or with a different pooling,
 * and the sentence has to move with it.
 *
 * The parse is deliberately shallow. ONNX is protobuf and the node names are
 * plain strings in it, so finding the intent head's first Gemm and reading the
 * names immediately before it is enough to see what feeds it, without a
 * dependency that would cost forty packages to check one sentence.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const model = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'public/model/router.int8.onnx')

let failed = 0
const fail = (what, detail) => {
  failed++
  console.error(`FAIL  ${what}`)
  if (detail) console.error(`      ${detail}`)
}

const bytes = readFileSync(model)
const text = bytes.toString('latin1')

/** The strings in a window of the file, in the order they appear. */
const stringsAround = (needle, before, after) => {
  const at = text.indexOf(needle)
  if (at < 0) return null
  return text.slice(Math.max(0, at - before), at + after).match(/[ -~]{5,60}/g) ?? []
}

const HEAD = '/intent_head/intent_head.0/Gemm'
const around = stringsAround(HEAD, 320, 60)
if (!around) {
  fail(`${model} has no ${HEAD}, so this is not the graph this gate knows how to read`)
} else {
  /*
   * What the head consumes. The quantiser rewrites the tensor name, so the
   * input arrives as `<name>_quantized` and the original is beside it.
   */
  const feeds = around.filter((s) => /_output_0$/.test(s) && !s.includes('intent_head'))
  if (feeds.length === 0) {
    fail('nothing that looks like a tensor feeds the intent head', around.slice(0, 6).join(', '))
  } else {
    const source = feeds[0]
    const add = stringsAround(`${source.replace('_output_0', '')}"`, 200, 40)
    const inputs = (add ?? []).filter((s) => /_output_0$/.test(s) && s !== source)
    const pooled = inputs.some((s) => /Gather/.test(s))
    const meaned = inputs.some((s) => /Div|ReduceMean/.test(s))

    if (!source.includes('Add')) {
      fail(
        `the intent head reads ${source}, which is not an addition`,
        'The page says the intent comes from the first position and the average together. If the graph stopped adding them, the sentence is now the wrong one.',
      )
    } else if (!pooled || !meaned) {
      fail(
        `${source} is fed by ${inputs.join(' and ') || 'nothing this gate could read'}`,
        'Expected a Gather, which is the first position, and a Div, which is the masked mean over every position.',
      )
    } else {
      console.log(`  ok      the intent head reads ${source}, fed by ${inputs.join(' and ')}`)
    }
  }
}

/*
 * And the sentence. A gate that reads the graph and leaves the prose alone is
 * the finding with an extra step: the defect was never in the arithmetic.
 */
const main = readFileSync(resolve(root, 'src/main.ts'), 'utf8').replace(/\s+/g, ' ')
const OLD = 'The first position is the sentence vector, which is what the intent is read from'
if (main.includes(OLD)) {
  fail('the attention note says the intent is read from the first position', 'The graph adds the average of every position to it before the head sees anything.')
}
for (const [phrase, why] of [
  ['cls token', 'the first position has a name, and it is not "the sentence vector"'],
  ['average of every position', 'this is the half the old sentence left out, and it is half the input'],
]) {
  if (!main.includes(phrase)) {
    fail(`the attention note does not say ${JSON.stringify(phrase)}`, why)
  }
}

if (failed > 0) {
  console.error('\nThe one sentence explaining how the picture connects to the answer.')
  process.exit(1)
}

console.log('intent: the graph adds the first position and the average, and the page says so')
