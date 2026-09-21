/**
 * The router, running in the visitor's browser.
 *
 * Five million parameters, trained from random init on a corpus its own
 * repository generates, quantised to int8 and served as 5.3 MB. Nothing is
 * recorded and nothing is sent anywhere: the weights arrive, and every sentence
 * after that is computed on the machine it was typed on.
 *
 * What comes out is deliberately more than the answer. The intent distribution
 * over all 44 candidates, the slot tag distribution at every position, and the
 * attention from all six layers and four heads, because the page exists to show
 * the working rather than the result.
 */

// The plain wasm build, not the default entry point. The default one reaches
// for the jsep variant, which carries the WebGPU bridge this page has no use
// for and which is a second multi megabyte file to serve. Five million
// parameters at a 64 token context are a millisecond of CPU.
import * as ort from 'onnxruntime-web/wasm'
import { Tokenizer, type TokenizerData } from './tokenizer'

/*
 * The runtime is named here file by file, and the two files come through the
 * bundler rather than from a hand copy in public/.
 *
 * Two reasons, both found by looking at what shipped. Given a directory,
 * onnxruntime picks a filename itself and asks for the jsep build, the one
 * carrying the WebGPU bridge this page has no use for; it falls back and works,
 * so the page looks fine while every load takes a 404 on the way. And a hand
 * copy in public/ does not stop the bundler emitting its own copy of the same
 * 14 MB file, so dist carried both.
 */
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url'
import mjsUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url'

ort.env.wasm.wasmPaths = { wasm: wasmUrl, mjs: mjsUrl }
ort.env.wasm.numThreads = 1

export interface Meta {
  parameters: number
  config: {
    vocab_size: number
    n_intents: number
    n_slot_tags: number
    d_model: number
    n_layers: number
    n_heads: number
    d_ff: number
    max_len: number
  }
  maxLen: number
  intents: string[]
  slotTags: string[]
  slots: string[]
  /**
   * One entry per gate, each carrying its own sample and its own tolerance.
   * They shared a single tolerance and a single sentence count until
   * 2026-09-21, and it was wrong for two of the four.
   */
  parity: Record<
    string,
    {
      value: number
      tolerance: number
      sentences: number
      note: string
      languages?: string[]
      sentenceTokens?: number[]
      fields?: number
      values?: number
      valueMean?: number
    }
  >
  quantisation?: {
    heldOutSentences: number
    fp32: { intentAccuracy: number; tagAccuracy: number; exactMatch: number }
    int8: { intentAccuracy: number; tagAccuracy: number; exactMatch: number }
    bytesInt8: number
    shrink: number
  }
}

export interface Prediction {
  words: string[]
  /** One entry per token position, including the leading <cls>. */
  tokens: { id: number; word: number }[]
  /** Probability per intent, in `meta.intents` order. */
  intents: Float32Array
  /** Per position, probability per slot tag. */
  slots: Float32Array
  /** [layer][head][query][key], already softmaxed by the model. */
  attention: Float32Array
  dims: { layers: number; heads: number; positions: number; tags: number }
  /** Milliseconds for the forward pass alone, not tokenization. */
  ms: number
}

function softmax(logits: Float32Array, from: number, count: number): void {
  let max = -Infinity
  for (let i = 0; i < count; i++) max = Math.max(max, logits[from + i])
  let sum = 0
  for (let i = 0; i < count; i++) {
    const e = Math.exp(logits[from + i] - max)
    logits[from + i] = e
    sum += e
  }
  for (let i = 0; i < count; i++) logits[from + i] /= sum
}

export class Router {
  private constructor(
    private readonly session: ort.InferenceSession,
    readonly tokenizer: Tokenizer,
    readonly meta: Meta,
  ) {}

  static async load(base = './model/'): Promise<Router> {
    const url = (name: string) => new URL(base + name, document.baseURI).href
    const [metaRes, tokRes] = await Promise.all([fetch(url('meta.json')), fetch(url('tokenizer.json'))])
    if (!metaRes.ok || !tokRes.ok) {
      throw new Error(`the model files did not arrive (${metaRes.status}, ${tokRes.status})`)
    }
    const meta = (await metaRes.json()) as Meta
    const tokenizer = new Tokenizer((await tokRes.json()) as TokenizerData)

    const session = await ort.InferenceSession.create(url('router.int8.onnx'), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return new Router(session, tokenizer, meta)
  }

  async run(text: string): Promise<Prediction> {
    const { words, ids, cases, wordIndex } = this.tokenizer.encodeText(text, this.meta.maxLen)
    if (ids.length === 0) {
      throw new Error('nothing to run on')
    }

    const feeds = {
      ids: new ort.Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]),
      cases: new ort.Tensor('int64', BigInt64Array.from(cases, BigInt), [1, cases.length]),
    }

    const started = performance.now()
    const out = await this.session.run(feeds)
    const ms = performance.now() - started

    const intents = Float32Array.from(out.intent_logits.data as Float32Array)
    softmax(intents, 0, intents.length)

    const slotDims = out.slot_logits.dims as number[]
    const tags = slotDims[2]
    const slots = Float32Array.from(out.slot_logits.data as Float32Array)
    for (let p = 0; p < ids.length; p++) softmax(slots, p * tags, tags)

    const attDims = out.attention.dims as number[]
    return {
      words,
      tokens: ids.map((id, i) => ({ id, word: wordIndex[i] })),
      intents,
      slots,
      attention: out.attention.data as Float32Array,
      dims: {
        layers: attDims[0],
        heads: attDims[2],
        positions: ids.length,
        tags,
      },
      ms,
    }
  }
}

/** The n most likely intents, highest first. */
export function topIntents(p: Prediction, meta: Meta, n: number) {
  return [...p.intents]
    .map((prob, i) => ({ intent: meta.intents[i], prob }))
    .sort((a, b) => b.prob - a.prob)
    .slice(0, n)
}

/** The tag the model gives each word, taken at the word's first token. */
export function wordTags(p: Prediction, meta: Meta): { word: string; tag: string; prob: number }[] {
  const out: { word: string; tag: string; prob: number }[] = []
  p.tokens.forEach((t, pos) => {
    if (t.word < 0) return
    let best = 0
    for (let k = 1; k < p.dims.tags; k++) {
      if (p.slots[pos * p.dims.tags + k] > p.slots[pos * p.dims.tags + best]) best = k
    }
    out[t.word] = {
      word: p.words[t.word],
      tag: meta.slotTags[best],
      prob: p.slots[pos * p.dims.tags + best],
    }
  })
  return out.filter(Boolean)
}
