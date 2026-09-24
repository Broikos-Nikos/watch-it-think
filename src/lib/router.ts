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
// for and which is a second multi megabyte file to serve.
//
// This line used to end "five million parameters at a 64 token context are a
// millisecond of CPU", which had never been measured and is wrong. Measured,
// int8, native onnxruntime at one thread, 200 reps a length after warmup:
//
//   T=6   0.57 ms      T=14  0.94 ms      T=32  1.80 ms      T=64  3.66 ms
//
// Attention is quadratic in the token count, so there is no such thing as one
// number here. wasm is several times slower again: the page's own live figure
// is about 2.9 ms on a six token sentence, so call it 15 to 20 ms at a full
// context. The case against the WebGPU bridge survives that, because 20 ms on
// the worst input a visitor can type is still a page that answers instantly,
// and the bridge costs a second multi megabyte download on every load. It is a
// weaker case than the one that was written here, and it is the true one.
// meta.json carries these numbers under quantisation.int8.byLength.
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

/** One graph's numbers, with the spread the single mean used to hide. */
export interface Graph {
  intentAccuracy: number
  tagAccuracy: number
  exactMatch: number
  latency?: { medianMs: number; p05Ms: number; p95Ms: number; firstRunMs: number; runs: number }
  /** The same weights scored the way the deployed assistant scores them. */
  withAbstain?: { threshold: number; intentAccuracy: number; abstained: number; rows: number }
  byLength?: { tokens: number; medianMs: number; p95Ms: number; reps: number }[]
}

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
  /**
   * Which files the numbers below were made from. `obtainable` is false for
   * the checkpoint and the test set: they are named and hashed here, and a
   * reader cannot fetch them from the repository that holds them.
   */
  inputs?: Record<
    string,
    { path?: string; bytes?: number; sha256?: string; obtainable?: boolean; note?: string }
  >
  quantisation?: {
    testSet?: { path: string; sha256: string; split: string; bytes: number; obtainable: boolean }
    rowsRead: number
    rowsEvaluated: number
    heldOutSentences: number
    measuredOn?: { runtime: string; threads: number; cpu: string; notThePage: string }
    crossCheck?: {
      reference: string
      seed: number
      rows: number
      argmaxDisagreements: number
      onnxArgmaxAccuracy: number
      referenceArgmaxAccuracy: number
    }
    fp32: Graph
    int8: Graph
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

  /**
   * @param onProgress called with the bytes of the graph that have arrived and
   *   the bytes expected. Both are uncompressed, and that is deliberate: see
   *   the comment on `total` below.
   */
  /**
   * Just the description, without the 5.28 MB.
   *
   * `meta.json` is 10 KB and arrives in a hundred milliseconds. Everything the
   * page says about itself before a sentence is typed, the parameter count, the
   * layers, the heads, the intent count, comes out of it, and until now all of
   * it waited for the graph. So the page spent the whole download with an empty
   * paragraph under its headline, and if the graph never arrived it stayed empty
   * for ever: the hostile stranger pass found a page that had forgotten how to
   * describe itself, twice, two days apart.
   */
  static async loadMeta(base = './model/'): Promise<Meta> {
    const res = await fetch(new URL(base + 'meta.json', document.baseURI).href)
    if (!res.ok) throw new Error(`meta.json did not arrive (${res.status})`)
    return (await res.json()) as Meta
  }

  static async load(
    base = './model/',
    onProgress?: (received: number, total: number) => void,
  ): Promise<Router> {
    const url = (name: string) => new URL(base + name, document.baseURI).href
    const [metaRes, tokRes] = await Promise.all([fetch(url('meta.json')), fetch(url('tokenizer.json'))])
    if (!metaRes.ok || !tokRes.ok) {
      throw new Error(`the model files did not arrive (${metaRes.status}, ${tokRes.status})`)
    }
    const meta = (await metaRes.json()) as Meta
    const tokenizer = new Tokenizer((await tokRes.json()) as TokenizerData)

    /*
     * The graph is fetched here rather than by onnxruntime, for one reason:
     * `InferenceSession.create(url)` fetches it internally and reports nothing,
     * so the page could not say how far along it was.
     *
     * Measured on the live host, this download is 41.2 seconds at 1.6 Mbit,
     * which is a phone on a train, and for all of it the page said "loading the
     * model" and nothing else. Three static words cannot distinguish a download
     * in progress from one that has stalled.
     *
     * `total` comes from meta.json rather than from Content-Length, and the
     * difference matters. GitHub Pages sends this file gzipped, so
     * Content-Length is the compressed size, 4,331,506 bytes, while the stream
     * below yields the decompressed bytes, 5,284,077. Dividing one by the other
     * runs the bar to 122 percent and then stops. `bytesInt8` is what the
     * quantiser recorded and it is exactly what the reader will deliver.
     */
    const total = meta.quantisation?.bytesInt8 ?? 0
    const res = await fetch(url('router.int8.onnx'))
    if (!res.ok) throw new Error(`the graph did not arrive (${res.status})`)

    let graph: Uint8Array
    if (res.body && total > 0 && onProgress) {
      const reader = res.body.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      onProgress(0, total)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress(received, total)
      }
      graph = new Uint8Array(received)
      let at = 0
      for (const c of chunks) {
        graph.set(c, at)
        at += c.length
      }
    } else {
      // No reader, no recorded size, or nobody listening: one allocation and no
      // progress, which is what this did before and is still correct.
      graph = new Uint8Array(await res.arrayBuffer())
    }

    const session = await ort.InferenceSession.create(graph, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    })
    return new Router(session, tokenizer, meta)
  }

  async run(text: string): Promise<Prediction> {
    const { words, ids, cases, wordIndex } = this.tokenizer.encodeText(text, this.meta.maxLen)
    /*
     * Words, not ids, and the difference is a whole screen of confident output.
     *
     * An input that normalises away to nothing still produces one id, the `<cls>`
     * token, so `ids.length === 0` never fired for it. The hostile stranger pass
     * pasted a single U+0085, which Python calls whitespace and JavaScript does
     * not, and got a verdict, a race of six intents with bars, an empty tag box,
     * and twenty five flat squares captioned "strongest single link 100
     * percent". The page was answering a sentence that did not exist.
     *
     * The page guards this too, with `hasWords`, and this is here as well
     * because a caller that forgets should get an error rather than a picture.
     */
    if (words.length === 0) {
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
